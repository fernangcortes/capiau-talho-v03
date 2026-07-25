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
from concurrent.futures import ThreadPoolExecutor
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
    project_id: Optional[int] = None,
    task_key: Optional[str] = None
) -> Optional[str]:
    """Reescreve a descrição via LLM, com retry no modelo principal e fallback automático.

    Retorna None se principal + reserva falharem (o chamador cai pro fallback regex,
    a última rede de segurança).
    """
    from src.services.settings_service import SettingsService
    from src.core.tasks import TASK_MANAGER
    S = SettingsService.get_settings(project_id)
    api_key = S.api_key("openrouter")
    if not api_key or api_key == "your_openrouter_api_key_here":
        msg = "[WARN] Chave API OpenRouter não configurada. Usando substituição por regex."
        if task_key:
            TASK_MANAGER.add_log(task_key, msg, "WARN")
        else:
            print(f"[ENRICH] {msg}", flush=True)
        return None
    if not original or (not entities and not replacements):
        return None

    prompt = get_enrichment_rewrite_prompt(original, entities, replacements, project_id=project_id)
    primary = S.get("llm.text_model")
    fallback = S.get("llm.text_model_fallback")
    retries = max(1, S.get("enrichment.max_retries"))

    cascade = [
        primary,
        fallback,
        "google/gemini-2.5-flash",
        "openrouter/free",
        "meta-llama/llama-3.3-70b-instruct:free"
    ]
    models_to_try = []
    for m in cascade:
        if m and isinstance(m, str) and m not in models_to_try:
            models_to_try.append(m)

    base_payload = {
        "messages": [{"role": "user", "content": prompt}],
        "temperature": S.get("enrichment.temperature"),
        "max_tokens": S.get("enrichment.max_tokens"),
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = S.get("enrichment.timeout")

    def _attempt(model: str) -> Optional[str]:
        try:
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[LLM] Chamando modelo {model}...", "LLM")
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json={**base_payload, "model": model},
                timeout=timeout
            )
            if response.status_code != 200:
                err_msg = f"Falha LLM (modelo {model}, status {response.status_code}): {response.text[:200]}"
                if task_key:
                    TASK_MANAGER.add_log(task_key, f"[WARN] {err_msg}", "WARN")
                else:
                    print(f"[ENRICH] {err_msg}", flush=True)
                return None
            res_json = response.json()
            if "choices" not in res_json or not res_json["choices"]:
                err_msg = f"Resposta sem 'choices' do modelo {model}: {res_json.get('error', res_json)}"
                if task_key:
                    TASK_MANAGER.add_log(task_key, f"[WARN] {err_msg}", "WARN")
                else:
                    print(f"[ENRICH] {err_msg}", flush=True)
                return None
            msg = res_json["choices"][0].get("message", {})
            raw_content = msg.get("content")
            if not isinstance(raw_content, str) or not raw_content.strip():
                err_msg = f"Resposta sem conteúdo do modelo {model}: {res_json.get('error', res_json)}"
                if task_key:
                    TASK_MANAGER.add_log(task_key, f"[WARN] {err_msg}", "WARN")
                else:
                    print(f"[ENRICH] {err_msg}", flush=True)
                return None
            content = raw_content.strip()
            data = extract_json_from_markdown(content)
            rewritten = data.get("descricao") or data.get("description")
            if isinstance(rewritten, str) and rewritten.strip():
                if task_key:
                    TASK_MANAGER.add_log(task_key, f"[LLM] Resposta válida recebida de {model}.", "SUCCESS")
                return rewritten.strip()
            return None
        except Exception as e:
            err_msg = f"Erro ao chamar {model}: {e}"
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[WARN] {err_msg}", "WARN")
            else:
                print(f"[ENRICH] {err_msg}", flush=True)
            return None

    for idx, model in enumerate(models_to_try):
        if idx > 0:
            msg = f"Alternando para modelo de reserva {model} (tentativa anterior indisponível)."
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[LLM] {msg}", "LLM")
            else:
                print(f"[ENRICH] {msg}", flush=True)
        for attempt in range(1, retries + 1):
            result = _attempt(model)
            if result is not None:
                return result
            msg = f"Tentativa {attempt}/{retries} falhou em {model}."
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[WARN] {msg}", "WARN")
            else:
                print(f"[ENRICH] {msg}", flush=True)

    return None


def _rewrite_with_fallback(
    original: str,
    entities: List[Dict[str, str]],
    replacements: Dict[str, str],
    project_id: Optional[int] = None,
    task_key: Optional[str] = None
) -> str:
    """Tenta LLM; se indisponível, cai para a substituição por regex legada."""
    rewritten = rewrite_description_llm(original, entities, replacements, project_id=project_id, task_key=task_key)
    if rewritten:
        return rewritten
    # Fallback: regex legada
    from src.services.rag import enrich_description
    names = [e["name"] for e in entities]
    return enrich_description(original, names, text_replacements=replacements)


def enrich_video_frames(project_id: int, video_id: int, only_timestamps: Optional[List[float]] = None, tolerance: float = 5.0, task_key: Optional[str] = None) -> int:
    """Enriquece e reindexa as descrições de frames de um vídeo B-roll.

    only_timestamps: restringe aos frames próximos desses tempos. None = varre o vídeo inteiro.
    Retorna o número de frames reescritos.
    """
    from src.search.semantic import SemanticSearch
    from src.core.tasks import TASK_MANAGER
    search_engine = SemanticSearch.get_instance()
    points = search_engine.get_video_vision_points(project_id, video_id)
    if not points:
        msg = f"[VIDEO #{video_id}] Nenhum ponto de visão encontrado no Qdrant."
        if task_key: TASK_MANAGER.add_log(task_key, msg, "INFO")
        return 0

    if task_key:
        TASK_MANAGER.add_log(task_key, f"[VIDEO #{video_id}] Verificando {len(points)} pontos de visão no banco...", "SCAN")

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

    if not tasks:
        msg = f"[VIDEO #{video_id}] Todos os frames já estão com descrições atualizadas."
        if task_key: TASK_MANAGER.add_log(task_key, msg, "INFO")
        return 0

    if task_key:
        TASK_MANAGER.add_log(task_key, f"[VIDEO #{video_id}] {len(tasks)} frames requerem reescrita por LLM.", "SCAN")

    # 2. Executa as chamadas HTTP (OpenRouter) em paralelo com ThreadPoolExecutor
    updated = 0
    def _process_task(task):
        if task_key and TASK_MANAGER.is_cancelled(task_key):
            return False
        raw_text = task["raw_text"]
        entities = task["entities"]
        replacements = task["replacements"]
        point = task["point"]
        payload = task["payload"]
        key = task["key"]
        ts = payload.get('start_time', 0.0)

        names = [e["name"] for e in entities]
        if task_key:
            TASK_MANAGER.add_log(task_key, f"[FRAME @ {ts:.1f}s] Reescrevendo com entidades: {names}", "FRAME")

        enriched = _rewrite_with_fallback(raw_text, entities, replacements, project_id=project_id, task_key=task_key)
        if not enriched or enriched == payload.get("text"):
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[FRAME @ {ts:.1f}s] Sem alterações na descrição.", "INFO")
            return False

        new_payload = dict(payload)
        new_payload["enrich_key"] = key
        new_payload["entity_names"] = names
        try:
            search_engine.update_point_text(point.id, new_payload, enriched)
            msg = f"[ENRICH] Vídeo #{video_id} @ {ts:.1f}s: \"{enriched[:70]}...\""
            if task_key:
                TASK_MANAGER.add_log(task_key, msg, "ENRICH")
            else:
                print(f"[ENRICH] {msg}", flush=True)
            return True
        except Exception as e:
            err_msg = f"Falha ao reindexar frame {ts:.1f}s do vídeo #{video_id}: {e}"
            if task_key:
                TASK_MANAGER.add_log(task_key, f"[ERROR] {err_msg}", "ERROR")
            else:
                print(f"[ENRICH] {err_msg}", flush=True)
            return False

    if tasks:
        max_w = min(len(tasks), 5)
        with ThreadPoolExecutor(max_workers=max_w) as pool:
            results = pool.map(_process_task, tasks)
            updated = sum(1 for r in results if r)

    return updated


def enrich_photo(project_id: int, photo_id: int, task_key: Optional[str] = None) -> bool:
    """Enriquece a descrição de uma foto de set, persiste no SQLite e reindexa no Qdrant."""
    from src.search.semantic import SemanticSearch
    from src.core.tasks import TASK_MANAGER

    if task_key and TASK_MANAGER.is_cancelled(task_key):
        return False

    if task_key:
        TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Verificando foto na base de dados...", "SCAN")

    # 1. Ler dados do banco de forma rápida e fechar a conexão
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT description, raw_description, tags FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        if not row:
            if task_key: TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Foto não encontrada no banco.", "WARN")
            return False

        raw = row["raw_description"] or row["description"]
        if not raw:
            if task_key: TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Foto sem descrição original para enriquecer.", "INFO")
            return False

        data = EntityRepository.get_entities_for_media(conn, photo_id=photo_id)
        entities = data["entities"]
        replacements = data["replacements"]
        if not entities and not replacements:
            if task_key: TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Nenhuma entidade/rótulo vinculado a esta foto.", "INFO")
            return False
        
        tags_raw = row["tags"]

    names = [e["name"] for e in entities]
    if task_key:
        TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Solicitando reescrita LLM para entidades: {names}", "PHOTO")

    # 2. Executar reescrita LLM (chamada HTTP) fora da transação do banco
    enriched = _rewrite_with_fallback(raw, entities, replacements, project_id=project_id, task_key=task_key)
    if not enriched:
        if task_key: TASK_MANAGER.add_log(task_key, f"[PHOTO #{photo_id}] Reescrita LLM não retornou alterações.", "INFO")
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
        
        msg = f"[ENRICH] Foto #{photo_id} atualizada: \"{enriched[:70]}...\""
        if task_key:
            TASK_MANAGER.add_log(task_key, msg, "ENRICH")
        else:
            print(f"[ENRICH] {msg}", flush=True)
        return True
    except Exception as e:
        err_msg = f"Falha ao reindexar foto #{photo_id}: {e}"
        if task_key:
            TASK_MANAGER.add_log(task_key, f"[ERROR] {err_msg}", "ERROR")
        else:
            print(f"[ENRICH] {err_msg}", flush=True)
        return False


def enrich_after_face_labeling(project_id: int, face_ids: Optional[List[int]] = None, cluster_id: Optional[int] = None) -> Dict[str, int]:
    """Descobre as mídias afetadas por uma rotulagem de rosto(s) e as re-enriquece."""
    from src.core.tasks import TASK_MANAGER
    task_key = f"enrich-faces-{project_id}"
    TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="enrich", label="Sincronização de Descrições (Rostos)")
    TASK_MANAGER.add_log(task_key, f"[INIT] Buscando mídias afetadas pela rotulagem de rostos...", "INIT")

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
            TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="enrich")
            return {"photos": 0, "frames": 0}

        for r in cursor.fetchall():
            if r["photo_id"] is not None:
                affected_photos.add(r["photo_id"])
            elif r["video_id"] is not None and r["timestamp"] is not None:
                affected_videos.setdefault(r["video_id"], []).append(r["timestamp"])

    TASK_MANAGER.add_log(task_key, f"[SCAN] Afetados: {len(affected_photos)} fotos e {len(affected_videos)} vídeos.", "SCAN")

    total_tasks = len(affected_photos) + len(affected_videos)
    done_count = 0
    photos_done = 0
    frames_done = 0

    for pid in affected_photos:
        if TASK_MANAGER.is_cancelled(task_key):
            TASK_MANAGER.add_log(task_key, "[CANCEL] Sincronização de descrições cancelada.", "WARN")
            TASK_MANAGER.update_progress(task_key, round((done_count / max(total_tasks, 1)) * 100.0, 1), "cancelled", task_type="enrich")
            return {"photos": photos_done, "frames": frames_done}

        if enrich_photo(project_id, pid, task_key=task_key):
            photos_done += 1
        done_count += 1
        pct = round((done_count / max(total_tasks, 1)) * 100.0, 1)
        TASK_MANAGER.update_progress(task_key, pct, "running", task_type="enrich")

    for vid, stamps in affected_videos.items():
        if TASK_MANAGER.is_cancelled(task_key):
            TASK_MANAGER.add_log(task_key, "[CANCEL] Sincronização de descrições cancelada.", "WARN")
            TASK_MANAGER.update_progress(task_key, round((done_count / max(total_tasks, 1)) * 100.0, 1), "cancelled", task_type="enrich")
            return {"photos": photos_done, "frames": frames_done}

        frames_done += enrich_video_frames(project_id, vid, only_timestamps=stamps, task_key=task_key)
        done_count += 1
        pct = round((done_count / max(total_tasks, 1)) * 100.0, 1)
        TASK_MANAGER.update_progress(task_key, pct, "running", task_type="enrich")

    msg = f"[FINISHED] Sincronização concluída: {photos_done} fotos e {frames_done} frames re-enriquecidos."
    TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="enrich", log_message=msg)
    return {"photos": photos_done, "frames": frames_done}


def enrich_project(project_id: int, task_key: Optional[str] = None) -> Dict[str, int]:
    """Re-enriquecimento completo do projeto (todas as fotos e vídeos com entidades)."""
    from src.core.tasks import TASK_MANAGER
    if not task_key:
        task_key = f"enrich-project-{project_id}"
    
    TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="enrich", label="Sincronização de Descrições (Projeto)")
    TASK_MANAGER.add_log(task_key, f"[INIT] Iniciando varredura completa de enriquecimento do projeto #{project_id}...", "INIT")

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

        TASK_MANAGER.add_log(task_key, f"[SCAN] Total a verificar no projeto: {len(photo_ids)} fotos e {len(video_ids)} vídeos.", "SCAN")

        if photo_ids:
            for idx, pid in enumerate(photo_ids):
                if TASK_MANAGER.is_cancelled(task_key):
                    TASK_MANAGER.add_log(task_key, "[CANCEL] Tarefa cancelada durante o processamento de fotos.", "WARN")
                    TASK_MANAGER.update_progress(task_key, round((processed / max(total_items, 1)) * 100.0, 1), "cancelled", task_type="enrich")
                    return {"photos": photos_done, "frames": frames_done}

                if enrich_photo(project_id, pid, task_key=task_key):
                    photos_done += 1
                processed += 1
                percent = round((processed / max(total_items, 1)) * 100.0, 1)
                TASK_MANAGER.update_progress(task_key, percent, "running", task_type="enrich")

        for vid in video_ids:
            if TASK_MANAGER.is_cancelled(task_key):
                TASK_MANAGER.add_log(task_key, "[CANCEL] Tarefa cancelada durante o processamento de vídeos.", "WARN")
                TASK_MANAGER.update_progress(task_key, round((processed / max(total_items, 1)) * 100.0, 1), "cancelled", task_type="enrich")
                return {"photos": photos_done, "frames": frames_done}

            frames_done += enrich_video_frames(project_id, vid, task_key=task_key)
            processed += 1
            percent = round((processed / max(total_items, 1)) * 100.0, 1)
            TASK_MANAGER.update_progress(task_key, percent, "running", task_type="enrich")

        summary = f"[FINISHED] Sincronização do Projeto #{project_id} finalizada: {photos_done} fotos e {frames_done} frames atualizados no Qdrant."
        TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="enrich", log_message=summary)
    except Exception as e:
        err_summary = f"[ERROR] Erro no enriquecimento do projeto #{project_id}: {e}"
        TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="enrich", log_message=err_summary)

    return {"photos": photos_done, "frames": frames_done}


def enrich_in_background(fn, *args, **kwargs) -> None:
    """Executa uma função de enriquecimento em thread daemon (não bloqueia a resposta HTTP)."""
    def _runner():
        try:
            fn(*args, **kwargs)
        except Exception as e:
            print(f"[ENRICH] Erro em background: {e}")

    threading.Thread(target=_runner, daemon=True).start()
