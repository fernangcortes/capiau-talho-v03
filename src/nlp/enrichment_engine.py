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
    replacements: Optional[Dict[str, str]] = None
) -> Optional[str]:
    """Reescreve a descrição via LLM. Retorna None em falha (chamador usa fallback regex)."""
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        return None
    if not original or (not entities and not replacements):
        return None

    prompt = get_enrichment_rewrite_prompt(original, entities, replacements)
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": CONFIG.TEXT_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1
            },
            timeout=25
        )
        if response.status_code != 200:
            print(f"[ENRICH] Falha LLM (status {response.status_code}): {response.text[:200]}")
            return None
        content = response.json()["choices"][0]["message"]["content"].strip()
        data = extract_json_from_markdown(content)
        rewritten = data.get("descricao") or data.get("description")
        if isinstance(rewritten, str) and rewritten.strip():
            return rewritten.strip()
        return None
    except Exception as e:
        print(f"[ENRICH] Erro crítico na reescrita LLM: {e}")
        return None


def _rewrite_with_fallback(
    original: str,
    entities: List[Dict[str, str]],
    replacements: Dict[str, str]
) -> str:
    """Tenta LLM; se indisponível, cai para a substituição por regex legada."""
    rewritten = rewrite_description_llm(original, entities, replacements)
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

    updated = 0
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

            enriched = _rewrite_with_fallback(raw_text, entities, replacements)
            if not enriched or enriched == payload.get("text"):
                continue

            new_payload = dict(payload)
            new_payload["enrich_key"] = key
            new_payload["entity_names"] = [e["name"] for e in entities]
            try:
                search_engine.update_point_text(point.id, new_payload, enriched)
                updated += 1
                print(f"[ENRICH] Vídeo {video_id} @ {ts:.0f}s: \"{enriched[:80]}\"")
            except Exception as e:
                print(f"[ENRICH] Falha ao reindexar frame {ts}s do vídeo {video_id}: {e}")

    return updated


def enrich_photo(project_id: int, photo_id: int) -> bool:
    """Enriquece a descrição de uma foto de set, persiste no SQLite e reindexa no Qdrant."""
    from src.search.semantic import SemanticSearch

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

        enriched = _rewrite_with_fallback(raw, entities, replacements)
        if not enriched:
            return False

        # Persiste: descrição oficial = enriquecida; original preservada em raw_description
        cursor.execute(
            "UPDATE photo SET description = ?, raw_description = ? WHERE id = ?",
            (enriched, raw, photo_id)
        )
        conn.commit()

    # Reindexa no Qdrant mantendo o mesmo ID de ponto
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
                tags = json.loads(row["tags"]) if row["tags"] else []
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
    photos_done = 0
    frames_done = 0
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM photo WHERE project_id = ?", (project_id,))
        photo_ids = [r["id"] for r in cursor.fetchall()]
        cursor.execute("SELECT id FROM video WHERE project_id = ?", (project_id,))
        video_ids = [r["id"] for r in cursor.fetchall()]

    for pid in photo_ids:
        if enrich_photo(project_id, pid):
            photos_done += 1
    for vid in video_ids:
        frames_done += enrich_video_frames(project_id, vid)

    print(f"[ENRICH] Projeto {project_id}: {photos_done} fotos e {frames_done} frames enriquecidos.")
    return {"photos": photos_done, "frames": frames_done}


def enrich_in_background(fn, *args, **kwargs) -> None:
    """Executa uma função de enriquecimento em thread daemon (não bloqueia a resposta HTTP)."""
    def _runner():
        try:
            fn(*args, **kwargs)
        except Exception as e:
            print(f"[ENRICH] Erro em background: {e}")

    threading.Thread(target=_runner, daemon=True).start()
