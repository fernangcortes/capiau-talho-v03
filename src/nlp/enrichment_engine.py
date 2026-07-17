"""Motor de Enriquecimento de Descrições: reescreve descrições de visão com nomes reais
de pessoas e objetos (confirmados por auditoria humana ou reconhecimento facial),
PERSISTE o resultado e REINDEXA os embeddings no Qdrant.

Antes deste módulo, o enriquecimento era feito por regex em tempo de leitura e nunca
era salvo — a busca vetorial continuava enxergando apenas os termos genéricos.
"""
import json
import hashlib
import threading
import requests
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.entities import EntityRepository
from src.nlp.prompt_templates import get_enrichment_rewrite_prompt
from src.nlp.json_parser import extract_json_from_markdown


def _enrich_key(raw_text: str, entities: List[Dict[str, str]], replacements: Dict[str, str]) -> str:
    """Hash de idempotência: evita reescrever o mesmo frame com as mesmas entidades."""
    names = sorted([e["name"].lower() for e in entities])
    repl = sorted([f"{k}->{v}" for k, v in (replacements or {}).items()])
    base = (raw_text or "") + "|" + ",".join(names) + "|" + ",".join(repl)
    return hashlib.md5(base.encode("utf-8")).hexdigest()


def rewrite_description_llm(
    original: str,
    entities: List[Dict[str, str]],
    replacements: Optional[Dict[str, str]] = None,
    project_id: Optional[int] = None
) -> Optional[str]:
    """Reescreve a descrição via LLM, com retry no modelo principal e fallback automático.

    Retorna None se principal + reserva falharem (o chamador cai pro fallback regex,
    a última rede de segurança). Achado em 17/07: uma falha de parsing JSON aqui foi
    transitória (finish_reason='stop', resposta bem formada ao repetir a mesma chamada
    minutos depois) — por isso a defesa é retry+fallback, não só um teto de tokens maior.
    """
    from src.services.settings_service import SettingsService
    S = SettingsService.get_settings(project_id)
    api_key = S.api_key("openrouter")
    if not api_key or api_key == "your_openrouter_api_key_here":
        return None
    if not original or (not entities and not replacements):
        return None

    prompt = get_enrichment_rewrite_prompt(original, entities, replacements, project_id=project_id)
    primary = S.get("llm.text_model")
    fallback = S.get("llm.text_model_fallback")
    retries = max(1, S.get("enrichment.max_retries"))
    base_payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": S.get("enrichment.temperature"),
        "max_tokens": S.get("enrichment.max_tokens"),
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = S.get("enrichment.timeout")

    def _attempt(model: str) -> Optional[str]:
        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json={**base_payload, "model": model},
                timeout=timeout
            )
            if response.status_code != 200:
                print(f"[ENRICH] Falha LLM (modelo {model}, status {response.status_code}): {response.text[:200]}")
                return None
            res_json = response.json()
            if "choices" not in res_json:
                print(f"[ENRICH] Resposta sem 'choices' do modelo {model}: {res_json.get('error', res_json)}")
                return None
            content = res_json["choices"][0]["message"]["content"].strip()
            data = extract_json_from_markdown(content)
            rewritten = data.get("descricao") or data.get("description")
            if isinstance(rewritten, str) and rewritten.strip():
                return rewritten.strip()
            return None
        except Exception as e:
            print(f"[ENRICH] Erro ao chamar {model}: {e}")
            return None

    for attempt in range(1, retries + 1):
        result = _attempt(primary)
        if result is not None:
            return result
        print(f"[ENRICH] Tentativa {attempt}/{retries} falhou em {primary}.")

    if fallback and fallback != primary:
        print(f"[ENRICH] {retries} tentativa(s) esgotada(s) em {primary}; usando reserva {fallback}.")
        result = _attempt(fallback)
        if result is not None:
            return result

    return None


def _rewrite_with_fallback(
    original: str,
    entities: List[Dict[str, str]],
    replacements: Dict[str, str],
    project_id: Optional[int] = None
) -> str:
    """Tenta LLM; se indisponível, cai para a substituição por regex legada."""
    rewritten = rewrite_description_llm(original, entities, replacements, project_id=project_id)
    if rewritten:
        return rewritten
    # Fallback: regex legada (import tardio para evitar ciclo)
    from src.services.rag import enrich_description
    names = [e["name"] for e in entities]
    return enrich_description(original, names, text_replacements=replacements)


def enrich_video_frames(project_id: int, video_id: int, only_timestamps: Optional[List[float]] = None, tolerance: float = 5.0) -> int:
    """Enriquece e reindexa as descrições de frames de um vídeo B-roll.

    only_timestamps: restringe aos frames próximos desses tempos (após rotular um rosto,
    por exemplo). None = varre o vídeo inteiro.
    Retorna o número de frames reescritos.
    """
    from src.search.semantic import SemanticSearch
    search_engine = SemanticSearch.get_instance()
    points = search_engine.get_video_vision_points(project_id, video_id)
    if not points:
        return 0

    # 1. Coleta todas as informações necessárias do SQLite de forma rápida
    tasks = []
    with get_db() as conn:
        for point in points:
            payload = point.payload or {}
            ts = payload.get("start_time", 0.0)

            if only_timestamps is not None:
                if not any(abs(ts - t) <= tolerance for t in only_timestamps):
                    continue

            data = EntityRepository.get_entities_for_media(conn, video_id=video_id, timestamp=ts, tolerance=tolerance)
            entities = data["entities"]
            replacements = data["replacements"]
            if not entities and not replacements:
                continue

            raw_text = payload.get("raw_text") or payload.get("text") or ""
            if not raw_text:
                continue

            key = _enrich_key(raw_text, entities, replacements)
            if payload.get("enrich_key") == key:
                continue  # já enriquecido com este mesmo conjunto de entidades

            tasks.append({
                "point": point,
                "payload": payload,
                "raw_text": raw_text,
                "entities": entities,
                "replacements": replacements,
                "key": key
            })

    # 2. Executa as chamadas HTTP (OpenRouter) e indexação (Qdrant) fora de transações do SQLite
    updated = 0
    for task in tasks:
        raw_text = task["raw_text"]
        entities = task["entities"]
        replacements = task["replacements"]
        point = task["point"]
        payload = task["payload"]
        key = task["key"]

        enriched = _rewrite_with_fallback(raw_text, entities, replacements, project_id=project_id)
        if not enriched or enriched == payload.get("text"):
            continue

        new_payload = dict(payload)
        new_payload["enrich_key"] = key
        new_payload["entity_names"] = [e["name"] for e in entities]
        try:
            search_engine.update_point_text(point.id, new_payload, enriched)
            updated += 1
            print(f"[ENRICH] Vídeo {video_id} @ {payload.get('start_time', 0.0):.0f}s: \"{enriched[:80]}\"")
        except Exception as e:
            print(f"[ENRICH] Falha ao reindexar frame {payload.get('start_time', 0.0)}s do vídeo {video_id}: {e}")

    return updated


def enrich_photo(project_id: int, photo_id: int) -> bool:
    """Enriquece a descrição de uma foto de set, persiste no SQLite e reindexa no Qdrant."""
    from src.search.semantic import SemanticSearch

    # 1. Ler dados do banco de forma rápida e fechar a conexão
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT description, raw_description, tags FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        if not row:
            return False

        raw = row["raw_description"] or row["description"]
        if not raw:
            return False

        data = EntityRepository.get_entities_for_media(conn, photo_id=photo_id)
        entities = data["entities"]
        replacements = data["replacements"]
        if not entities and not replacements:
            return False
        
        tags_raw = row["tags"]

    # 2. Executar reescrita LLM (chamada HTTP) fora da transação do banco
    enriched = _rewrite_with_fallback(raw, entities, replacements, project_id=project_id)
    if not enriched:
        return False

    # 3. Persiste no SQLite em uma nova transação curta
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE photo SET description = ?, raw_description = ? WHERE id = ?",
            (enriched, raw, photo_id)
        )
        conn.commit()

    # 4. Reindexa no Qdrant mantendo o mesmo ID de ponto
    try:
        search_engine = SemanticSearch.get_instance()
        point = search_engine.get_photo_point(project_id, photo_id)
        if point:
            payload = dict(point.payload or {})
            if not payload.get("raw_text"):
                payload["raw_text"] = raw
            payload["entity_names"] = [e["name"] for e in entities]
            search_engine.update_point_text(point.id, payload, enriched)
        else:
            tags = []
            try:
                tags = json.loads(tags_raw) if tags_raw else []
            except Exception:
                pass
            search_engine.index_photo_description(project_id, photo_id, enriched, tags)
        print(f"[ENRICH] Foto {photo_id}: \"{enriched[:80]}\"")
        return True
    except Exception as e:
        print(f"[ENRICH] Falha ao reindexar foto {photo_id}: {e}")
        return False


def enrich_after_face_labeling(project_id: int, face_ids: Optional[List[int]] = None, cluster_id: Optional[int] = None) -> Dict[str, int]:
    """Descobre as mídias afetadas por uma rotulagem de rosto(s) e as re-enriquece.

    Chamado após: rotular face/cluster, mesclar clusters, reatribuir faces, face manual.
    """
    affected_photos = set()
    affected_videos: Dict[int, List[float]] = {}

    with get_db() as conn:
        cursor = conn.cursor()
        if cluster_id is not None:
            cursor.execute(
                "SELECT photo_id, video_id, timestamp FROM face WHERE project_id = ? AND cluster_id = ?",
                (project_id, cluster_id)
            )
        elif face_ids:
            qmarks = ",".join("?" * len(face_ids))
            cursor.execute(f"SELECT photo_id, video_id, timestamp FROM face WHERE id IN ({qmarks})", face_ids)
        else:
            return {"photos": 0, "frames": 0}

        for r in cursor.fetchall():
            if r["photo_id"] is not None:
                affected_photos.add(r["photo_id"])
            elif r["video_id"] is not None and r["timestamp"] is not None:
                affected_videos.setdefault(r["video_id"], []).append(r["timestamp"])

    photos_done = 0
    frames_done = 0
    for pid in affected_photos:
        if enrich_photo(project_id, pid):
            photos_done += 1
    for vid, stamps in affected_videos.items():
        frames_done += enrich_video_frames(project_id, vid, only_timestamps=stamps)

    if photos_done or frames_done:
        print(f"[ENRICH] Rotulagem propagada: {photos_done} fotos e {frames_done} frames reescritos e reindexados.")
    return {"photos": photos_done, "frames": frames_done}


def enrich_project(project_id: int) -> Dict[str, int]:
    """Re-enriquecimento completo do projeto (todas as fotos e vídeos com entidades)."""
    from src.core.tasks import TASK_MANAGER
    task_key = f"enrich-project-{project_id}"
    TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="enrich")

    photos_done = 0
    frames_done = 0
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM photo WHERE project_id = ?", (project_id,))
            photo_ids = [r["id"] for r in cursor.fetchall()]
            cursor.execute("SELECT id FROM video WHERE project_id = ?", (project_id,))
            video_ids = [r["id"] for r in cursor.fetchall()]

        total_items = len(photo_ids) + len(video_ids)
        processed = 0

        for pid in photo_ids:
            if task_key in getattr(TASK_MANAGER, "cancelled_tasks", set()):
                print(f"[ENRICH] Cancelamento detectado para a tarefa {task_key}.")
                TASK_MANAGER.update_progress(task_key, percent if 'percent' in locals() else 0.0, "failed", task_type="enrich")
                return {"photos": photos_done, "frames": frames_done}
            if enrich_photo(project_id, pid):
                photos_done += 1
            processed += 1
            percent = round((processed / max(total_items, 1)) * 100.0, 1)
            TASK_MANAGER.update_progress(task_key, percent, "running", task_type="enrich")

        for vid in video_ids:
            if task_key in getattr(TASK_MANAGER, "cancelled_tasks", set()):
                print(f"[ENRICH] Cancelamento detectado para a tarefa {task_key}.")
                TASK_MANAGER.update_progress(task_key, percent if 'percent' in locals() else 0.0, "failed", task_type="enrich")
                return {"photos": photos_done, "frames": frames_done}
            frames_done += enrich_video_frames(project_id, vid)
            processed += 1
            percent = round((processed / max(total_items, 1)) * 100.0, 1)
            TASK_MANAGER.update_progress(task_key, percent, "running", task_type="enrich")

        TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="enrich")
        print(f"[ENRICH] Projeto {project_id}: {photos_done} fotos e {frames_done} frames enriquecidos.")
    except Exception as e:
        print(f"[ENRICH] Erro no enriquecimento do projeto {project_id}: {e}")
        TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="enrich")

    return {"photos": photos_done, "frames": frames_done}


def enrich_in_background(fn, *args, **kwargs) -> None:
    """Executa uma função de enriquecimento em thread daemon (não bloqueia a resposta HTTP)."""
    def _runner():
        try:
            fn(*args, **kwargs)
        except Exception as e:
            print(f"[ENRICH] Erro em background: {e}")

    threading.Thread(target=_runner, daemon=True).start()
