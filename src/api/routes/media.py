"""Roteador FastAPI para gerenciamento de Mídias, Ingestão, Conversões e Visão."""
import os
import json
import hashlib
import math
import re
import sqlite3
import subprocess
import sys
import time
import cv2
import numpy as np
from pathlib import Path
from typing import Any, Dict, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse, FileResponse

from src.config import CONFIG
from src.db.connection import get_db
from src.api.dependencies import get_db_conn
from src.api.schemas import CategoryUpdate, TitleUpdate, ExternalPathIngest, LabelFacePayload, MergeClustersPayload, ReassignFacesPayload
from src.db.repositories.media import MediaRepository
from src.core.tasks import (TASK_MANAGER, read_worker_progress, WORKER_LOGS_DIR,
                            worker_is_running, write_worker_pid)
from src.services.ingest import IngestService
from src.services.pipeline import PipelineService
from src.services.burst_service import group_photo_bursts, replicate_to_members
from src.services.settings_service import SettingsService
from src.nlp.prompt_registry import TRIAGE_CATEGORIES
from src.services.vision_batch import run_vision_batch
from src.search.semantic import SemanticSearch

router = APIRouter(tags=["Media & Ingestion"])

# Preco por hora da configuracao atual do AssemblyAI (Universal-3.5 Pro):
# transcricao 0,21 + diarizacao 0,02 + entity_detection 0,08. Serve so para a
# previa do botao -- ver docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md.
ASR_PRECO_HORA_USD = 0.31

# Teto de tamanho do analysis_json gravado no cache (audio_render.analysis_json).
# Medido: 600 baldes de envelope + 200 momentos somam ~62 kB (o diag antigo tinha
# ~120 bytes); 256 kB da ~4x de folga sobre esse pior caso e continua trivial para
# o SQLite e para a resposta HTTP. Acima disso o diagnostico veio anomalo (dados
# crescidos, versao futura com mais baldes): responde normal, mas NAO cacheia,
# para nao engolir uma linha gigante que todo hit teria de carregar.
ANALISE_AUDIO_CACHE_TETO_BYTES = 262144

@router.get("/api/videos")
def list_videos(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Lista todos os vídeos cadastrados no projeto."""
    videos = MediaRepository.list_videos(conn, project_id)
    for v in videos:
        # Injeta a versão da miniatura (mtime do arquivo no disco) para invalidação de cache no navegador
        thumb_file = CONFIG.THUMBNAILS_DIR / f"thumb_{v['id']}.jpg"
        if thumb_file.exists():
            v['thumb_version'] = int(thumb_file.stat().st_mtime)
        else:
            v['thumb_version'] = 0

        # Injeta caminho do proxy se existir
        proxy_rel = f"proxy_vid_{v['id']}.mp4"
        if (CONFIG.PROXIES_DIR / proxy_rel).exists():
            v['proxy_path'] = f"/proxies/{proxy_rel}"
        else:
            from src.services.s3_service import S3Service
            s3_service = S3Service.get_instance()
            if s3_service.enabled:
                s3_key = f"proxies/{proxy_rel}"
                presigned_url = s3_service.generate_presigned_url(s3_key)
                if presigned_url:
                    v['proxy_path'] = presigned_url
                else:
                    v['proxy_path'] = None
            else:
                v['proxy_path'] = None
    return videos

@router.get("/api/photos")
def list_photos(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Lista todas as fotos e injeta caminhos relativos de proxies se existirem."""
    photos = MediaRepository.list_photos(conn, project_id)
    for p in photos:
        # Injeta caminho do proxy se existir
        proxy_rel = f"photos/proxy_photo_{p['id']}.webp"
        if (CONFIG.PROXIES_DIR / proxy_rel).exists():
            p['proxy_path'] = f"/proxies/{proxy_rel}"
        else:
            p['proxy_path'] = None
            
        # Desserializa tags JSON
        try:
            p['tags'] = json.loads(p['tags']) if p.get('tags') else []
        except Exception:
            p['tags'] = []
    return photos

# -- E2.C2: Fila de revisão de triagem + correção de categoria -----------------

def _record_triage_feedback(cursor, project_id: int, media_kind: str, media_id: int,
                            wrong: Optional[str], right: str, note: str) -> None:
    """Registra a correção humana. Alimenta o few-shot do prompt de triagem (E2.C3)."""
    cursor.execute(
        "INSERT INTO triage_feedback (project_id, media_kind, media_id, wrong_category, right_category, note) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (project_id, media_kind, media_id, wrong, right, note or None)
    )

@router.get("/api/project/{project_id}/triage/review")
def triage_review_queue(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Mídias cuja triagem merece revisão humana: confiança abaixo de
    `triage.min_confidence`, ou analisadas sem categoria (triagem falhou).
    Entrevistas sem categoria ficam de fora — não passam por triagem de visão."""
    S = SettingsService.get_settings(project_id)
    min_conf = S.get("triage.min_confidence")
    cursor = conn.cursor()

    cursor.execute(
        """SELECT id, filename, title, category, category_confidence, video_type, duration, status
           FROM video
           WHERE project_id = ?
             AND ((category IS NOT NULL AND category_confidence < ?)
                  OR (category IS NULL AND video_type != 'interview'
                      AND description IS NOT NULL AND description != ''))
           ORDER BY category_confidence ASC""",
        (project_id, min_conf)
    )
    videos = [dict(r) for r in cursor.fetchall()]

    cursor.execute(
        """SELECT id, filename, title, category, category_confidence, burst_group_id, status
           FROM photo
           WHERE project_id = ?
             AND ((category IS NOT NULL AND category_confidence < ?)
                  OR (category IS NULL AND description IS NOT NULL AND description != ''))
           ORDER BY category_confidence ASC""",
        (project_id, min_conf)
    )
    photos = [dict(r) for r in cursor.fetchall()]

    return {
        "status": "success",
        "threshold": min_conf,
        "videos": videos,
        "photos": photos,
        "total": len(videos) + len(photos),
    }

@router.patch("/api/video/{video_id}/category")
def update_video_category(video_id: int, payload: CategoryUpdate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Correção humana de categoria: persiste com confiança 1.0, registra o
    feedback (few-shot do E2.C3) e re-deriva video_type quando aplicável."""
    category = payload.category.strip().lower()
    if category not in TRIAGE_CATEGORIES:
        raise HTTPException(400, f"Categoria inválida '{category}'. Válidas: {', '.join(sorted(TRIAGE_CATEGORIES))}")

    cursor = conn.cursor()
    cursor.execute("SELECT project_id, category, video_type FROM video WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Vídeo não encontrado")

    old_category = row["category"]
    if old_category != category:
        _record_triage_feedback(cursor, row["project_id"], "video", video_id, old_category, category, payload.note)

    # 'depoimento' é fala dirigida à câmera -> interview; o resto -> broll.
    derived_type = "interview" if category == "depoimento" else "broll"
    cursor.execute(
        "UPDATE video SET category = ?, category_confidence = 1.0, video_type = ? WHERE id = ?",
        (category, derived_type, video_id)
    )
    conn.commit()

    # Correção reflete na faceta 'category' do índice visual (E2.D3); falha não bloqueia
    try:
        from src.search.image_semantic import ImageSearch
        ImageSearch.get_instance().sync_category_payload(row["project_id"], category, video_id=video_id)
    except Exception as sync_err:
        print(f"[Triage] Falha ao sincronizar faceta de categoria do video {video_id}: {sync_err}")

    return {"status": "success", "id": video_id, "category": category,
            "previous_category": old_category, "video_type": derived_type}

@router.patch("/api/photo/{photo_id}/category")
def update_photo_category(photo_id: int, payload: CategoryUpdate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Correção humana de categoria da foto. Fotos de rajada compartilham a mesma
    cena por construção (CLIP > limiar), então a correção propaga ao grupo inteiro."""
    category = payload.category.strip().lower()
    if category not in TRIAGE_CATEGORIES:
        raise HTTPException(400, f"Categoria inválida '{category}'. Válidas: {', '.join(sorted(TRIAGE_CATEGORIES))}")

    cursor = conn.cursor()
    cursor.execute("SELECT project_id, category, burst_group_id FROM photo WHERE id = ?", (photo_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Foto não encontrada")

    old_category = row["category"]
    if old_category != category:
        _record_triage_feedback(cursor, row["project_id"], "photo", photo_id, old_category, category, payload.note)

    if row["burst_group_id"] is not None:
        cursor.execute(
            "SELECT id FROM photo WHERE project_id = ? AND burst_group_id = ?",
            (row["project_id"], row["burst_group_id"])
        )
        target_ids = [r["id"] for r in cursor.fetchall()]
        cursor.execute(
            "UPDATE photo SET category = ?, category_confidence = 1.0 WHERE project_id = ? AND burst_group_id = ?",
            (category, row["project_id"], row["burst_group_id"])
        )
    else:
        target_ids = [photo_id]
        cursor.execute(
            "UPDATE photo SET category = ?, category_confidence = 1.0 WHERE id = ?",
            (category, photo_id)
        )
    updated_count = cursor.rowcount
    conn.commit()

    # Correção reflete na faceta 'category' do índice visual (E2.D3); falha não bloqueia
    try:
        from src.search.image_semantic import ImageSearch
        ImageSearch.get_instance().sync_category_payload(row["project_id"], category, photo_ids=target_ids)
    except Exception as sync_err:
        print(f"[Triage] Falha ao sincronizar faceta de categoria das fotos {target_ids}: {sync_err}")

    return {"status": "success", "id": photo_id, "category": category,
            "previous_category": old_category, "updated_count": updated_count}

@router.patch("/api/video/{video_id}/title")
def update_video_title(video_id: int, payload: TitleUpdate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Atualização manual/humana do título executivo do vídeo."""
    title = payload.title.strip()
    cursor = conn.cursor()
    cursor.execute("SELECT id, project_id, filename FROM video WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Vídeo não encontrado")

    MediaRepository.update_video_title(conn, video_id, title)
    conn.commit()

    return {"status": "success", "id": video_id, "title": title}

@router.get("/api/video/{video_id}/metadata-history")
def list_video_metadata_history(
    video_id: int,
    limit: int = Query(50, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Versões anteriores da decupagem editorial, mais recente primeiro.

    Só a versão corrente (devolvida em `atual`) vive na tabela video e alimenta a
    busca; o histórico existe para leitura e restauração pela interface."""
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, title, description, summary, tags, metadata_origem FROM video WHERE id = ?",
        (video_id,)
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Vídeo não encontrado")

    atual = dict(row)
    atual["tags"] = MediaRepository._parse_tags(atual.get("tags"))
    atual["origem"] = atual.pop("metadata_origem", None) or "ia"

    return {
        "video_id": video_id,
        "atual": atual,
        "versions": MediaRepository.list_metadata_history(conn, video_id, limit)
    }

@router.post("/api/video/{video_id}/metadata-history/{history_id}/restore")
def restore_video_metadata_version(
    video_id: int,
    history_id: int,
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Restaura uma versão arquivada. A versão atual é arquivada antes, então dá para voltar."""
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM video WHERE id = ?", (video_id,))
    if not cursor.fetchone():
        raise HTTPException(404, "Vídeo não encontrado")

    try:
        MediaRepository.restore_metadata_version(conn, video_id, history_id)
    except ValueError as err:
        raise HTTPException(404, str(err))
    conn.commit()

    cursor.execute(
        "SELECT id, title, description, summary, tags, metadata_origem FROM video WHERE id = ?",
        (video_id,)
    )
    atual = dict(cursor.fetchone())
    atual["tags"] = MediaRepository._parse_tags(atual.get("tags"))
    atual["origem"] = atual.pop("metadata_origem", None) or "humano"

    return {"status": "success", "id": video_id, "restored_from": history_id, "video": atual}

@router.patch("/api/photo/{photo_id}/title")
def update_photo_title(photo_id: int, payload: TitleUpdate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Atualização manual/humana do título da foto."""
    title = payload.title.strip()
    cursor = conn.cursor()
    cursor.execute("SELECT id, project_id, filename FROM photo WHERE id = ?", (photo_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(404, "Foto não encontrada")

    MediaRepository.update_photo_title(conn, photo_id, title)
    conn.commit()

    return {"status": "success", "id": photo_id, "title": title}

@router.api_route("/api/project/{project_id}/regenerate-titles", methods=["GET", "POST"])
def regenerate_project_titles(project_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Dispara a regeneração em lote dos títulos executivos curtos (3 a 6 palavras) via IA."""
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM video WHERE project_id = ?", (project_id,))
    rows = cursor.fetchall()
    video_ids = [r["id"] for r in rows]

    # Se o project_id passado não tiver vídeos (ex: id 1 vs id 2), busca o projeto que possui os vídeos
    if not video_ids:
        cursor.execute("SELECT id, project_id FROM video LIMIT 1")
        sample = cursor.fetchone()
        if sample:
            real_proj_id = sample["project_id"]
            cursor.execute("SELECT id FROM video WHERE project_id = ?", (real_proj_id,))
            rows = cursor.fetchall()
            video_ids = [r["id"] for r in rows]
            project_id = real_proj_id

    if not video_ids:
        return {"status": "success", "message": "Nenhum vídeo encontrado no banco de dados.", "count": 0}

    background_tasks.add_task(PipelineService.regenerate_executive_titles, project_id, video_ids)
    return {"status": "success", "message": f"Regenerando títulos executivos para {len(video_ids)} vídeos em segundo plano.", "count": len(video_ids)}

def _enrich_image_hits(conn: sqlite3.Connection, hits: List[dict]) -> List[dict]:
    """Decora hits da coleção CLIP com metadados do banco (fotos ganham nome/proxy/título).

    Os cards da UI de busca esperam esses campos no payload; hits de vídeo já
    carregam video_id/start_time e são resolvidos pelo frontend."""
    results = []
    cursor = conn.cursor()
    for h in hits:
        p = dict(h["payload"])
        pid = p.get("photo_id")
        if pid:
            cursor.execute("SELECT filename, filepath, title, description FROM photo WHERE id = ?", (pid,))
            row = cursor.fetchone()
            if row:
                p.update({"filename": row["filename"], "filepath": row["filepath"],
                          "title": row["title"], "description": row["description"]})
                p.setdefault("text", row["title"] or row["description"] or row["filename"])
            proxy_rel = f"photos/proxy_photo_{pid}.webp"
            if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                p["proxy_path"] = f"/proxies/{proxy_rel}"
        results.append({"id": h.get("id"), "score": h["score"], "payload": p})
    return results

from pydantic import BaseModel, Field
from typing import Literal

class SimilarItem(BaseModel):
    kind: Literal["photo", "video"]
    id: int
    timestamp: Optional[float] = None

class SimilarBatchRequest(BaseModel):
    project_id: int = 1
    items: List[SimilarItem] = Field(min_length=1, max_length=20)
    search_type: Literal["visual", "textual"] = "visual"
    # None/"all" = sem filtro; as abas do painel de resultados re-consultam com filtro
    media_type_filter: Optional[Literal["all", "interview", "broll", "photo"]] = None
    limit: int = Field(default=12, ge=1, le=60)

def _source_labels(conn: sqlite3.Connection, items: List[SimilarItem]) -> dict:
    """Rótulo legível de cada item de origem, para 'mais parecido com: X'."""
    labels = {}
    cursor = conn.cursor()
    for item in items:
        key = (item.kind, item.id)
        if key in labels:
            continue
        table = "photo" if item.kind == "photo" else "video"
        cursor.execute(f"SELECT filename, title FROM {table} WHERE id = ?", (item.id,))
        row = cursor.fetchone()
        labels[key] = (row["title"] or row["filename"]) if row else f"{item.kind} {item.id}"
    return labels

def _attach_best_source_label(result: dict, labels: dict) -> str:
    """Anexa o rótulo ao best_source do hit e o retorna (fallback: primeiro item)."""
    bs = result.get("best_source") or {}
    label = labels.get((bs.get("kind"), bs.get("id"))) or next(iter(labels.values()), "seleção")
    bs["label"] = label
    result["best_source"] = bs
    return label

@router.post("/api/media/similar-batch")
def similar_batch(payload: SimilarBatchRequest, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Busca de mídias por similaridade multimodal (visual ou textual) em lote (E2.B6).

    Resposta: {results, mode_used ("media"|"uniao"), cohesion, warnings} — cada result
    carrega best_source e explanation didática ("por que este item apareceu").
    """
    items_list = [item.model_dump() for item in payload.items]
    media_filter = payload.media_type_filter if payload.media_type_filter not in (None, "all") else None
    labels = _source_labels(conn, payload.items)
    index_status = "ok"
    warning_msg = None
    data = {}
    results = []

    try:
        if payload.search_type == "textual":
            from src.search.semantic import SemanticSearch, QdrantUnavailableError
            data = SemanticSearch.get_instance().similar_to_multiple_items(
                payload.project_id, items_list, media_type_filter=media_filter, limit=payload.limit
            )

            cursor = conn.cursor()
            for h in data.get("results", []):
                p = dict(h["payload"])
                vid_id = p.get("video_id")
                photo_id = p.get("photo_id")

                if photo_id:
                    cursor.execute("SELECT filename, filepath, title, description, tags FROM photo WHERE id = ?", (photo_id,))
                    row = cursor.fetchone()
                    if row:
                        p.update({
                            "filename": row["filename"], "filepath": row["filepath"],
                            "title": row["title"], "description": row["description"]
                        })
                        p.setdefault("text", row["title"] or row["description"] or row["filename"])
                    proxy_rel = f"photos/proxy_photo_{photo_id}.webp"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        p["proxy_path"] = f"/proxies/{proxy_rel}"
                elif vid_id:
                    cursor.execute("SELECT filename, title, video_type FROM video WHERE id = ?", (vid_id,))
                    row = cursor.fetchone()
                    if row:
                        p["filename"] = row["filename"]
                        p["title"] = row["title"] or row["filename"]
                        p["video_type"] = row["video_type"]
                    proxy_rel = f"proxy_vid_{vid_id}.mp4"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        p["proxy_path"] = f"/proxies/{proxy_rel}"

                source_label = _attach_best_source_label(h, labels)
                snippet = (h.get("matched_text") or p.get("text", "") or p.get("description", "") or "")[:90]
                explanation = f"Tema em comum com \"{source_label}\" — trecho que casou: '{snippet}...'"

                results.append({
                    "id": h.get("id"),
                    "score": h["score"],
                    "explanation": explanation,
                    "best_source": h["best_source"],
                    "matched_text": h.get("matched_text", ""),
                    "payload": p
                })

        else:
            from src.search.image_semantic import ImageSearch, QdrantUnavailableError
            fetch_limit = payload.limit * 3 if media_filter in ("interview", "broll") else payload.limit
            data = ImageSearch.get_instance().similar_to_multiple_items(
                payload.project_id, items_list, media_type_filter=media_filter, limit=fetch_limit
            )

            enriched_hits = _enrich_image_hits(conn, data.get("results", []))
            for enriched, original in zip(enriched_hits, data.get("results", [])):
                enriched["best_source"] = original.get("best_source")

            if media_filter in ("interview", "broll"):
                cursor = conn.cursor()
                filtered = []
                for r in enriched_hits:
                    vid_id = r["payload"].get("video_id")
                    if vid_id is None:
                        continue
                    cursor.execute("SELECT video_type FROM video WHERE id = ?", (vid_id,))
                    row = cursor.fetchone()
                    if row and row["video_type"] == media_filter:
                        filtered.append(r)
                enriched_hits = filtered

            for r in enriched_hits:
                source_label = _attach_best_source_label(r, labels)
                bs = r["best_source"]
                moment = ""
                if bs.get("kind") == "video" and bs.get("timestamp") is not None:
                    ts = float(bs["timestamp"])
                    moment = f" (momento {int(ts // 60):02d}:{int(ts % 60):02d})"
                r["explanation"] = f"Visualmente mais parecido com \"{source_label}\"{moment} — composição, cores e enquadramento."
                results.append(r)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except QdrantUnavailableError as qe:
        index_status = "unavailable"
        warning_msg = f"Índice de busca indisponível — {qe}"
    except Exception as e:
        index_status = "error"
        warning_msg = f"Erro inesperado na busca de similares: {e}"
        print(f"[SimilarBatch] Erro inesperado ({type(e).__name__}): {e}")

    return {
        "results": results[:payload.limit],
        "mode_used": data.get("mode_used", "media"),
        "cohesion": data.get("cohesion", 0.0),
        "warnings": data.get("warnings", []),
        "index_status": index_status,
        "warning": warning_msg,
    }

@router.get("/api/media/photo/{photo_id}/similar")
def photo_similar(photo_id: int, project_id: int = Query(1), limit: int = Query(12), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Fotos visualmente próximas via CLIP local (E2.B6)."""
    from src.search.image_semantic import ImageSearch, QdrantUnavailableError
    index_status = "ok"
    warning = None
    results = []
    try:
        hits = ImageSearch.get_instance().similar_to_photo(project_id, photo_id, limit=limit)
        results = _enrich_image_hits(conn, hits)
        for r in results:
            r["explanation"] = "Aparência parecida com a foto de origem — composição, cores e enquadramento (CLIP local)."
    except QdrantUnavailableError as qe:
        index_status = "unavailable"
        warning = f"Índice de busca indisponível — {qe}"
    except Exception as e:
        index_status = "error"
        warning = f"Erro inesperado ao buscar similares: {e}"
        print(f"[PhotoSimilar] Erro inesperado ({type(e).__name__}): {e}")
    return {"photo_id": photo_id, "results": results, "index_status": index_status, "warning": warning}

@router.get("/api/media/video/{video_id}/similar")
def video_similar(video_id: int, project_id: int = Query(1), timestamp: float = Query(0.0), limit: int = Query(12), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Trechos/fotos visualmente próximos do keyframe indexado mais perto do timestamp (E2.B6)."""
    from src.search.image_semantic import ImageSearch, QdrantUnavailableError
    index_status = "ok"
    warning = None
    results = []
    try:
        hits = ImageSearch.get_instance().similar_to_video_moment(project_id, video_id, timestamp=timestamp, limit=limit)
        results = _enrich_image_hits(conn, hits)
        moment = f"{int(timestamp // 60):02d}:{int(timestamp % 60):02d}"
        for r in results:
            r["explanation"] = f"Aparência parecida com o frame de {moment} do vídeo de origem — composição, cores e enquadramento (CLIP local)."
    except QdrantUnavailableError as qe:
        index_status = "unavailable"
        warning = f"Índice de busca indisponível — {qe}"
    except Exception as e:
        index_status = "error"
        warning = f"Erro inesperado ao buscar similares: {e}"
        print(f"[VideoSimilar] Erro inesperado ({type(e).__name__}): {e}")
    return {"video_id": video_id, "timestamp": timestamp, "results": results, "index_status": index_status, "warning": warning}

@router.post("/api/ingest/select-folder")
def select_folder_dialog():
    """Abre uma caixa de diálogo nativa do Windows para seleção de diretório."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder_path = filedialog.askdirectory(parent=root, title="Selecione a Pasta de Mídias (HD/Pasta Externa)")
        root.destroy()
        if folder_path:
            return {"status": "success", "path": folder_path.replace('\\', '/')}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao abrir seletor: {str(e)}")

@router.post("/api/ingest/external")
def trigger_external_ingest(payload: ExternalPathIngest, background_tasks: BackgroundTasks):
    """Varre uma pasta ou arquivo externo inserindo os caminhos em formato Link (in-place)."""
    path_obj = Path(payload.path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail="O caminho especificado não existe.")
        
    def bg_task():
        print(f"[API] Ingestão externa in-place em background para: {payload.path}")
        IngestService.ingest_external_path(path_obj, payload.project_id)
        
    background_tasks.add_task(bg_task)
    return {"status": "success", "message": f"Ingestão externa iniciada para projeto {payload.project_id}."}

@router.post("/api/project/{project_id}/scan-watch")
def trigger_scan_watch(project_id: int, background_tasks: BackgroundTasks):
    """Escaneia a pasta watch/ em background e registra os novos arquivos."""
    from src.ingest.watcher import scan_watch_folder
    background_tasks.add_task(scan_watch_folder, project_id)
    return {"status": "success", "message": "Varredura da pasta watch/ iniciada."}

@router.post("/api/video/{video_id}/transcribe")
def trigger_transcribe(video_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Inicia a transcrição ASR AssemblyAI e indexação semântica em background."""
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    filepath = Path(video['filepath'])
    
    background_tasks.add_task(PipelineService.transcribe_video, video_id, filepath)
    return {"status": "success", "message": "Transcrição ASR iniciada em background."}

@router.post("/api/project/{project_id}/transcribe-all")
def trigger_transcribe_all(project_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Inicia transcrição ASR em lote para todos os depoimentos pendentes do projeto."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, filepath
        FROM video
        WHERE project_id = ? AND status != 'transcribed' AND video_type IN ('interview', 'broll', 'unknown')
    """, (project_id,))
    rows = cursor.fetchall()
    
    if not rows:
        return {"status": "success", "message": "Nenhum clipe elegível para transcrição.", "count": 0}
        
    def transcribe_all():
        for r in rows:
            try:
                PipelineService.transcribe_video(r['id'], Path(r['filepath']))
            except Exception as e:
                print(f"[ASRBatch] Erro no vídeo ID {r['id']}: {e}")
                
    background_tasks.add_task(transcribe_all)
    return {"status": "success", "message": f"Transcrição em lote de {len(rows)} vídeos iniciada.", "count": len(rows)}

@router.post("/api/project/{project_id}/transcribe-worker")
def launch_transcription_worker(
    project_id: int,
    force: bool = Query(False, description="Reprocessa também os já transcritos."),
    ids: Optional[str] = Query(None, description="IDs separados por vírgula. Sem isso, a fila inteira."),
    dry_run: bool = Query(False, description="Só devolve o tamanho da fila e o custo; não lança nada."),
):
    """Lança o worker de transcrição em PROCESSO SEPARADO e devolve o PID.

    Por que não usar /transcribe-all: aquela rota roda o lote dentro do servidor e
    sufoca o event loop — a interface inteira para de responder (medido em 15/07 na
    rodada de visão, mesma lição no cabeçalho de src/worker_vision.py).

    Por que desgrudado: processo preso ao console morre junto quando o console
    fecha. Ver o cabeçalho de scripts/launch_detached.py.
    """
    from src.worker_transcricao import selecionar, WORKER_TYPE

    # Guarda 1: instância única. Dois workers do mesmo tipo levam de volta ao
    # problema de concorrência no SQLite, só que por outro caminho.
    # Em dry_run não checamos: a prévia é só leitura e deve funcionar sempre.
    em_execucao = None if dry_run else worker_is_running(WORKER_TYPE)
    if em_execucao:
        raise HTTPException(
            status_code=409,
            detail=(f"Já existe um worker de transcrição rodando (PID {em_execucao['pid']}). "
                    f"Espere terminar, ou encerre o processo e apague "
                    f"{Path(em_execucao.get('progress_file', '')).with_name(f'worker_{WORKER_TYPE}.pid')}.")
        )

    lista_ids = None
    if ids:
        try:
            lista_ids = [int(x) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400, "O parâmetro 'ids' aceita apenas números separados por vírgula.")

    fila = selecionar(project_id, lista_ids, force)
    if not fila:
        return {"status": "success", "count": 0,
                "message": "Nenhum clipe elegível para transcrição."}

    horas = sum((r["duration"] or 0) for r in fila) / 3600
    custo = round(horas * ASR_PRECO_HORA_USD, 2)

    if dry_run:
        return {
            "status": "success",
            "dry_run": True,
            "count": len(fila),
            "horas": round(horas, 2),
            "custo_estimado_usd": custo,
            "message": f"{len(fila)} clipe(s), {horas:.2f} h de áudio, ~US$ {custo:.2f}.",
        }

    carimbo = time.strftime("%Y%m%d_%H%M%S")
    log_out = WORKER_LOGS_DIR / f"worker_{WORKER_TYPE}_{carimbo}.out.log"
    log_err = WORKER_LOGS_DIR / f"worker_{WORKER_TYPE}_{carimbo}.err.log"

    comando = [sys.executable, "-m", "src.worker_transcricao", "--project", str(project_id)]
    if lista_ids:
        comando += ["--ids", ",".join(str(i) for i in lista_ids)]
    if force:
        comando.append("--force")

    # Guarda 3: solta a trava do Qdrant ANTES de lancar. O Qdrant embutido e
    # exclusivo e o servidor sempre a abriu primeiro; sem soltar, o worker
    # transcreve mas nao indexa. A busca volta sozinha ao fim da rodada.
    try:
        SemanticSearch.get_instance().suspend_for_worker()
    except Exception as err:
        print(f"[Worker ASR] Aviso: falha ao liberar a trava do Qdrant: {err}")

    lancador = [sys.executable, str(CONFIG.BASE_DIR / "scripts" / "launch_detached.py"),
                *comando, "--stdout", str(log_out), "--stderr", str(log_err)]

    try:
        resultado = subprocess.run(lancador, capture_output=True, text=True, timeout=30)
    except Exception as err:
        raise HTTPException(500, f"Falha ao lançar o worker: {err}")

    if resultado.returncode != 0:
        raise HTTPException(500, f"O lançador falhou: {resultado.stderr.strip() or 'sem mensagem'}")

    achado = re.search(r"PID:\s*(\d+)", resultado.stdout or "")
    if not achado:
        raise HTTPException(500, f"O lançador não devolveu PID: {resultado.stdout.strip()!r}")
    pid = int(achado.group(1))

    # Fecha a janela de corrida: o worker também grava o PID, mas leva segundos
    # para subir, e nesse intervalo um segundo pedido passaria pela guarda.
    write_worker_pid(WORKER_TYPE, pid)

    return {
        "status": "success",
        "pid": pid,
        "count": len(fila),
        "horas": round(horas, 2),
        "custo_estimado_usd": custo,
        "log_stdout": str(log_out),
        "log_stderr": str(log_err),
        # Guarda 3: o Qdrant roda embutido, com trava de arquivo exclusiva.
        "busca_indisponivel": True,
        "aviso_busca": ("A busca semântica fica indisponível enquanto o worker roda "
                        "(o Qdrant é embutido e tem trava exclusiva). O resto da "
                        "interface continua funcionando."),
        "message": f"Worker de transcrição iniciado (PID {pid}): {len(fila)} vídeo(s), {horas:.2f} h de áudio.",
    }

@router.post("/api/video/{video_id}/analyze-vision")
def trigger_vision_video(
    video_id: int,
    background_tasks: BackgroundTasks,
    beat_embedder: Optional[str] = Query(None, description="Força 'hsv' ou 'clip' na deriva dos beats desta análise."),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Inicia a decupagem visual multimodal do B-roll via OpenRouter Vision.

    `beat_embedder=clip` reanalisa este vídeo com beats de melhor qualidade (mais
    lento); sem o parâmetro usa o método padrão do projeto (HSV).
    """
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    if beat_embedder not in (None, "hsv", "clip"):
        raise HTTPException(status_code=400, detail="beat_embedder deve ser 'hsv' ou 'clip'.")
    filepath = Path(video['filepath'])
    duration = video['duration']

    background_tasks.add_task(PipelineService.analyze_video_vision, video_id, filepath, duration, beat_embedder)
    msg = "Reanálise com beats CLIP iniciada." if beat_embedder == "clip" else "Decupagem visual do B-roll iniciada."
    return {"status": "success", "message": msg}

@router.post("/api/photo/{photo_id}/analyze-vision")
def trigger_vision_photo(photo_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Inicia a análise visual e tags por IA da foto bastidores de forma síncrona."""
    photo = MediaRepository.get_photo(conn, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    filepath = Path(photo['filepath'])
    
    success = PipelineService.analyze_photo_vision(photo_id, filepath)
    if not success:
        raise HTTPException(status_code=500, detail="Erro durante a análise de visão da foto.")
        
    # Recarrega a foto pós-análise
    updated = MediaRepository.get_photo(conn, photo_id)
    if updated:
        proxy_rel = f"photos/proxy_photo_{updated['id']}.webp"
        if (CONFIG.PROXIES_DIR / proxy_rel).exists():
            updated['proxy_path'] = f"/proxies/{proxy_rel}"
        else:
            updated['proxy_path'] = None
            
        try:
            updated['tags'] = json.loads(updated['tags']) if updated.get('tags') else []
        except Exception:
            updated['tags'] = []
            
    return {"status": "success", "photo": updated}

@router.post("/api/project/{project_id}/analyze-all-vision")
def trigger_all_vision(
    project_id: int,
    force: bool = Query(False, description="Forçar reanálise de mídias já analisadas"),
    background_tasks: BackgroundTasks = None,
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Analisa de forma assíncrona todas as mídias pendentes ou todas (se force=True) de visão, aplicando detecção facial e burst-sequencing de fotos.

    ATENCAO: Rodar acervo inteiro por aqui derruba a interface: o lote consome o GIL
    deste processo e o event loop para de responder a QUALQUER rota (medido em
    15/07 — servidor mudo por horas). Para rodadas grandes use o worker em
    processo separado: `python -m src.worker_vision --project N --force-photos`.
    """
    background_tasks.add_task(run_vision_batch, project_id, force, force)
    return {"status": "success", "message": "Análise visual em lote iniciada em background."}

@router.get("/api/conversions")
async def get_all_conversions():
    """Retorna o progresso em tempo real das conversões de vídeo/foto em execução.

    Inclui o progresso do worker de lote, que roda FORA deste processo — sem essa
    fusão a tela de Tarefas ficaria vazia durante toda a rodada do acervo.
    """
    progress = TASK_MANAGER.get_progress()
    progress.update(read_worker_progress())
    return progress

@router.post("/api/video/{video_id}/cancel-conversion")
def cancel_conversion(video_id: int):
    """Cancela o processo ativo de codificação ou análise visual de um vídeo."""
    success = TASK_MANAGER.cancel_process(video_id)
    TASK_MANAGER.cancel_task(str(video_id))
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    return {"status": "success", "message": f"Tarefa do vídeo ID {video_id} cancelada com sucesso."}

class OverrideStatusRequest(BaseModel):
    status: Optional[str] = None

@router.api_route("/api/video/{video_id}/override-status", methods=["POST", "PUT"])
def override_video_status(
    video_id: int,
    payload: Optional[OverrideStatusRequest] = None,
    status: Optional[str] = Query(None),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Permite ao usuário alternar manualmente o status de uma mídia entre 'error' e 'analyzed'."""
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    
    raw_status = (payload.status if payload and payload.status else status) or ""
    target_status = raw_status.lower().strip()
    if target_status not in ("error", "analyzed"):
        raise HTTPException(status_code=400, detail="O parâmetro status deve ser 'error' ou 'analyzed'.")
        
    if target_status == "error":
        err_msg = "Marcado manualmente como falha visual pelo usuário."
        MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
    else:
        MediaRepository.update_video_status(conn, video_id, 'analyzed', error_message=None)
        
    updated = MediaRepository.get_video(conn, video_id)
    return {"status": "success", "video": updated}

@router.delete("/api/video/{video_id}/proxy")
def delete_proxy(video_id: int):
    """Cancela conversões e apaga o arquivo proxy MP4 físico do disco."""
    TASK_MANAGER.cancel_process(video_id)
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    TASK_MANAGER.remove_progress(str(video_id))
    return {"status": "success", "message": "Proxy físico removido."}

@router.post("/api/video/{video_id}/retry")
def retry_video_proxy(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Reinicia a codificação de proxy de um vídeo individual."""
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    TASK_MANAGER.cancel_process(video_id)
    TASK_MANAGER.executor.submit(
        IngestService._generate_video_proxy_task,
        video_id, Path(video['filepath']), video['duration']
    )
    return {"status": "success", "message": "Conversão reiniciada."}

@router.post("/api/project/{project_id}/retry-failed")
def retry_failed_conversions(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Efetua retry em lote de todas as mídias falhas (status error) ou com proxies físicos ausentes."""
    videos = MediaRepository.list_videos(conn, project_id)
    photos = MediaRepository.list_photos(conn, project_id)
    count = 0
    
    # Retry vídeos falhos ou sem proxy
    for v in videos:
        proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{v['id']}.mp4"
        is_missing = not proxy.exists() or proxy.stat().st_size == 0
        if v['status'] == 'error' or is_missing:
            TASK_MANAGER.executor.submit(
                IngestService._generate_video_proxy_task,
                v['id'], Path(v['filepath']), v['duration']
            )
            count += 1
            
    # Retry fotos falhas ou sem proxy
    for p in photos:
        proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{p['id']}.webp"
        is_missing = not proxy.exists() or proxy.stat().st_size == 0
        if p['status'] == 'error' or is_missing:
            TASK_MANAGER.executor.submit(
                IngestService._generate_photo_proxy_task,
                project_id, p['id'], Path(p['filepath'])
            )
            count += 1
            
    return {"status": "success", "message": f"Reiniciadas {count} conversões falhas.", "count": count}

@router.post("/api/project/open-proxies-folder")
def open_proxies_folder():
    """Abre a pasta local de proxies no Windows Explorer."""
    try:
        import subprocess
        subprocess.Popen(['explorer', str(CONFIG.PROXIES_DIR)])
        return {"status": "success", "message": "Explorer aberto."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/video/{video_id}")
def delete_video(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Deleta o vídeo do banco e apaga seu proxy físico correspondente."""
    # Apaga proxy
    TASK_MANAGER.cancel_process(video_id)
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    MediaRepository.delete_video(conn, video_id)
    conn.commit()
    return {"status": "success", "message": f"Vídeo ID {video_id} removido."}

@router.post("/api/photo/{photo_id}/retry")
def retry_photo_proxy(photo_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Reinicia a geração de proxy e análise de uma foto individual."""
    photo = MediaRepository.get_photo(conn, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
        
    TASK_MANAGER.executor.submit(
        IngestService._generate_photo_proxy_task,
        photo['project_id'], photo_id, Path(photo['filepath'])
    )
    return {"status": "success", "message": "Geração do proxy da foto reiniciada."}

@router.delete("/api/photo/{photo_id}/proxy")
def delete_photo_proxy(photo_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Cancela tarefas e apaga o arquivo proxy WebP físico da foto no disco."""
    TASK_MANAGER.cancel_process(photo_id)
    proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    cursor = conn.cursor()
    cursor.execute("UPDATE photo SET status = 'pending' WHERE id = ?", (photo_id,))
    conn.commit()
    return {"status": "success", "message": "Proxy físico da foto removido."}

@router.delete("/api/photo/{photo_id}")
def delete_photo(photo_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Exclui a foto do banco e remove o proxy físico WebP."""
    # Apaga proxy
    proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    MediaRepository.delete_photo(conn, photo_id)
    conn.commit()
    return {"status": "success", "message": f"Foto ID {photo_id} removida."}


@router.get("/api/video/{video_id}/stream")
def stream_video(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna o arquivo de vídeo original ou proxy para streaming no player/card."""
    from fastapi.responses import FileResponse
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        return FileResponse(proxy_path, media_type="video/mp4")
        
    video_path = Path(video['filepath'])
    if video_path.exists():
        return FileResponse(video_path, media_type="video/mp4")
        
    raise HTTPException(status_code=404, detail="Arquivo de vídeo não encontrado no servidor.")


@router.get("/api/photo/{photo_id}/file")
def get_photo_file(photo_id: int, raw: bool = Query(False, description="RAW em resolução total (sem tratamento)"),
                   conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna uma imagem exibível no browser.

    O original pode ser RAW/TIFF (ex.: .CR2), que o navegador não renderiza em <img>.
    Por padrão serve o proxy .webp (rápido). Com ``raw=true``, para fotos RAW, serve a
    decodificação em resolução total (sem tratamento) — usada no zoom nativo do inspetor.
    Formatos web (jpg/png/webp) são servidos direto, em resolução total.
    """
    from fastapi.responses import FileResponse
    from src.media.image_processing import decode_raw_to_jpeg, RAW_EXTENSIONS
    cursor = conn.cursor()
    cursor.execute("SELECT filepath FROM photo WHERE id = ?", (photo_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")

    WEB_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}
    photo_path = Path(row["filepath"])
    ext = photo_path.suffix.lower()

    # RAW nativo em resolução total (opt-in) — decodifica com cache
    if raw and ext in RAW_EXTENSIONS and photo_path.exists():
        full = CONFIG.BASE_DIR / "data" / "cache" / "raw" / f"full_photo_{photo_id}.jpg"
        if full.exists() or decode_raw_to_jpeg(photo_path, full):
            return FileResponse(full, media_type="image/jpeg")

    if photo_path.exists() and ext in WEB_EXT:
        return FileResponse(photo_path)

    # Não exibível no browser (RAW/TIFF/HEIC…) -> proxy webp
    proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    if proxy.exists():
        return FileResponse(proxy, media_type="image/webp")

    if photo_path.exists():
        return FileResponse(photo_path)  # último recurso
    raise HTTPException(status_code=404, detail="Arquivo de foto não encontrado.")


@router.get("/api/video/{video_id}/thumbnail")
def get_video_thumbnail(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    from src.media.ffmpeg import extract_frame
    
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
    cache_headers = {"Cache-Control": "no-cache, max-age=0, must-revalidate"}
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return FileResponse(thumb_path, headers=cache_headers)
        
    # Se não existe, busca metadados do vídeo para gerar a partir do proxy ou original
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    video_path = Path(video['filepath'])
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        video_path = proxy_path
    elif not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado para o vídeo {video_id}")
        
    duration = video.get('duration') or 0.0
    target_time = max(1.0, duration * 0.1)
    
    success = extract_frame(video_path, target_time, thumb_path, proxy_fallback_path=proxy_path)
    if success and thumb_path.exists():
        return FileResponse(thumb_path, headers=cache_headers)
        
    raise HTTPException(status_code=404, detail="Não foi possível gerar a miniatura do vídeo.")


@router.post("/api/video/{video_id}/thumbnail")
def set_video_thumbnail(video_id: int, timestamp: float = Query(...), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Extrai e define uma miniatura específica no timestamp fornecido."""
    from src.media.ffmpeg import extract_frame
    
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    video_path = Path(video['filepath'])
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    # Prefere o proxy 720p local se existir (busca 100x mais rápida e 100% confiável)
    if proxy_path.exists():
        video_path = proxy_path
    elif not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado: {video_path}")
        
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
    success = extract_frame(video_path, timestamp, thumb_path, proxy_fallback_path=proxy_path)
    if success and thumb_path.exists():
        try:
            cursor = conn.cursor()
            cursor.execute("UPDATE video SET created_at = CURRENT_TIMESTAMP WHERE id = ?", (video_id,))
        except Exception:
            pass
        return {"status": "success", "message": "Miniatura atualizada com sucesso."}
        
    raise HTTPException(status_code=500, detail="Falha ao extrair frame no timestamp fornecido.")


@router.get("/api/video/{video_id}/thumbnail-at")
def get_video_thumbnail_at(video_id: int, time: float = Query(...), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna o thumbnail do vídeo no timestamp fornecido (com cache progressivo).

    NUNCA extrai frame dentro da requisição. Rota síncrona roda no threadpool que o
    FastAPI compartilha entre TODAS as rotas síncronas; chamar ffmpeg aqui fazia cada
    miniatura faltante segurar uma thread por centenas de ms. Soltar um vídeo na
    timeline dispara dezenas dessas de uma vez, o pool enchia e rotas sem relação
    ficavam esperando — medido em 18/08: a exportação leva 13 ms, mas demorava
    "muito" porque estava na fila atrás das miniaturas, não porque fosse lenta.

    Cache miss agora devolve a miniatura genérica na hora e deixa a extração para a
    fila de fundo (`_generate_timeline_thumbnails_task`), que já existia e preenche o
    cache progressivamente. O front-end reconsulta e as miniaturas vão aparecendo.
    """
    from fastapi.responses import FileResponse

    # Cache miss: identifica a mídia só para poder enfileirar a geração em segundo plano
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    duration = video.get('duration') or 0.0
    if duration > 0:
        time = min(max(0.0, time), duration)

    # O nome do arquivo segue o padrão de índice baseado no tempo arredondado (1 frame por segundo)
    file_idx = int(round(time)) + 1
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_{file_idx:04d}.jpg"
    
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return FileResponse(thumb_path)

    # Prioriza o proxy 720p local para extração rápida via FFmpeg
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        video_path = proxy_path
    else:
        video_path = Path(video['filepath'])
        if not video_path.exists():
            raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado para o vídeo {video_id}")

    # Dispara a geração progressiva de miniaturas em segundo plano se a tarefa não estiver rodando no momento
    duration = video.get('duration') or 0.0
    task_key = f"thumbs-{video_id}"
    task_info = TASK_MANAGER.get_progress().get(task_key)
    is_running = task_info and task_info.get("status") == "running"
    if not is_running and duration > 0:
        TASK_MANAGER.executor.submit(
            IngestService._generate_timeline_thumbnails_task,
            video_id, video_path, duration
        )

    # Com a fila de fundo a caminho, responde 404 em vez da miniatura genérica: o
    # timelineRenderer guarda a imagem em cache PARA SEMPRE por (vídeo, segundo), então
    # entregar a genérica aqui congelaria o mesmo quadro ao longo do clipe inteiro até
    # o F5. O 404 faz o front reagendar o pedido, e ele exibe a vizinha mais próxima
    # enquanto espera (getClosestLoadedVideoThumb).
    if duration > 0:
        raise HTTPException(status_code=404, detail="Miniatura ainda em geração.")

    # Sem duração não há geração progressiva possível: a genérica é o melhor que existe
    main_thumb = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
    if main_thumb.exists():
        return FileResponse(main_thumb)
        
    raise HTTPException(status_code=404, detail="Não foi possível gerar a miniatura do vídeo no tempo especificado.")



@router.post("/api/video/{video_id}/pause-thumbnails")
def pause_video_thumbnails(video_id: int):
    """Pausa a geração progressiva de miniaturas de um vídeo."""
    task_key = f"thumbs-{video_id}"
    TASK_MANAGER.pause_task(task_key)
    return {"status": "success", "message": f"Geração de miniaturas do vídeo ID {video_id} pausada."}


@router.post("/api/video/{video_id}/resume-thumbnails")
def resume_video_thumbnails(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retoma a geração progressiva de miniaturas de um vídeo."""
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        video_path = proxy_path
    else:
        video_path = Path(video['filepath'])
        if not video_path.exists():
            raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado para o vídeo {video_id}")
            
    task_key = f"thumbs-{video_id}"
    with TASK_MANAGER._lock:
        TASK_MANAGER.paused_tasks.discard(task_key)
        TASK_MANAGER.cancelled_tasks.discard(task_key)
        # Mantém o progresso existente para não zerar na barra de progresso do UI ao reiniciar
        pct = 0.0
        if task_key in TASK_MANAGER.progress:
            pct = TASK_MANAGER.progress[task_key].get("percent", 0.0)
        TASK_MANAGER.progress[task_key] = {
            "percent": pct,
            "status": "running",
            "type": "thumbnails"
        }
        
    duration = video.get('duration') or 0.0
    if duration > 0:
        TASK_MANAGER.executor.submit(
            IngestService._generate_timeline_thumbnails_task,
            video_id, video_path, duration
        )
    return {"status": "success", "message": f"Geração de miniaturas do vídeo ID {video_id} retomada."}


@router.post("/api/video/{video_id}/cancel-thumbnails")
def cancel_video_thumbnails(video_id: int):
    """Cancela a geração progressiva de miniaturas de um vídeo."""
    task_key = f"thumbs-{video_id}"
    TASK_MANAGER.cancel_task(task_key)
    return {"status": "success", "message": f"Geração de miniaturas do vídeo ID {video_id} cancelada."}


@router.api_route("/api/task/{task_key}/cancel", methods=["POST", "DELETE"])
def cancel_task_generic(task_key: str):
    """Cancela qualquer tarefa em segundo plano via seu task_key."""
    TASK_MANAGER.cancel_task(task_key)
    if task_key.isdigit():
        TASK_MANAGER.cancel_process(int(task_key))
    return {"status": "success", "message": f"Tarefa '{task_key}' cancelada com sucesso."}


@router.api_route("/api/task/{task_key}", methods=["DELETE", "POST"])
def dismiss_or_cancel_task(task_key: str):
    """Remove ou cancela a tarefa da lista de progresso em segundo plano."""
    if task_key.endswith("/cancel"):
        clean_key = task_key[:-7]
        TASK_MANAGER.cancel_task(clean_key)
        if clean_key.isdigit():
            TASK_MANAGER.cancel_process(int(clean_key))
        return {"status": "success", "message": f"Tarefa '{clean_key}' cancelada com sucesso."}

    TASK_MANAGER.cancel_task(task_key)
    TASK_MANAGER.remove_progress(task_key)
    return {"status": "success", "message": f"Tarefa {task_key} removida/cancelada."}




@router.post("/api/editor/heartbeat")
def editor_heartbeat():
    """Reporta atividade do usuário no editor para desacelerar tarefas de segundo plano."""
    TASK_MANAGER.report_user_activity()
    return {"status": "success", "user_active": TASK_MANAGER.is_user_active()}


@router.get("/api/media/failed-count")
def get_failed_media_count(project_id: Optional[int] = None):
    """Retorna o número de vídeos afetados por falhas visuais ou status de erro."""
    from src.services.pipeline import PipelineService
    failed_ids = PipelineService.get_failed_video_ids(project_id)
    return {"count": len(failed_ids), "ids": failed_ids}


class ReanalyzeFailedRequest(BaseModel):
    media_ids: Optional[List[int]] = None

@router.post("/api/media/reanalyze-failed")
def reanalyze_failed_media(req: Optional[ReanalyzeFailedRequest] = None, project_id: Optional[int] = None):
    """Dispara a reanálise em lote das mídias afetadas por falha visual."""
    from src.services.pipeline import PipelineService
    m_ids = req.media_ids if req else None
    reanalyzed = PipelineService.reanalyze_failed_videos(project_id, media_ids=m_ids)
    return {"status": "success", "count": len(reanalyzed), "ids": reanalyzed}


@router.post("/api/media/cancel-all-analyses")
def cancel_all_analyses(project_id: Optional[int] = None):
    """Cancela todas as análises de visão/reanálises em andamento no projeto ou globalmente."""
    cancelled_ids = []
    with get_db() as conn:
        query = "SELECT id FROM video WHERE status IN ('analyzing', 'processing', 'pending')"
        params = []
        if project_id:
            query += " AND project_id = ?"
            params.append(project_id)
        rows = conn.execute(query, params).fetchall()
        for r in rows:
            vid = r["id"]
            TASK_MANAGER.cancel_process(vid)
            TASK_MANAGER.cancel_task(str(vid))
            MediaRepository.update_video_status(conn, vid, 'error', error_message="Análise cancelada pelo usuário")
            cancelled_ids.append(vid)
    return {"status": "success", "count": len(cancelled_ids), "ids": cancelled_ids}


# -- ETAPA 1 do plano de audio: pre-analise (docs/PLANO_AJUSTES_DE_AUDIO.md, secao 5)

def _hash_analise_audio(video_id: int, in_s: Optional[float], out_s: Optional[float]) -> str:
    """chain_hash fixo do contrato C2 para a pre-analise pura (ETAPA 1 ainda
    nao renderiza nada; da Etapa 3 em diante a cadeia entra no hash)."""
    base = f"analysis|{video_id}|{in_s}|{out_s}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _json_seguro_para_resposta(valor):
    """Copia dicts/listas/tuplas trocando float nao-finito por None.

    O ffmpeg pode reportar piso de ruido -inf e o JSON nao tem infinito: o
    JSONResponse padrao serializa com allow_nan=False e estouraria erro 500.
    A partir da rodada 2 as series envelope/momentos (listas de dicts dentro de
    diag) passam pelo mesmo caminho: a recursao ja cobre listas aninhadas, e
    tupla e tratada como lista por defensibilidade.
    O cache em audio_render.analysis_json guarda o valor real (json.dumps/
    json.loads do Python round-tripam -inf), so a resposta HTTP e sanitizada."""
    if isinstance(valor, float):
        return valor if math.isfinite(valor) else None
    if isinstance(valor, dict):
        return {chave: _json_seguro_para_resposta(v) for chave, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        return [_json_seguro_para_resposta(v) for v in valor]
    return valor


def _garantir_envelope_momentos(diag: dict) -> dict:
    """Garante envelope/momentos como listas em um diag vindo do cache antigo.

    Linhas gravadas antes dessas chaves existirem (rodada 1) nao tem as series;
    um hit de cache velho devolve listas vazias em vez de quebrar a UI ou forcar
    reanalise. Se vierem como lista (modulo novo), passa intocado."""
    if not isinstance(diag.get("envelope"), list):
        diag["envelope"] = []
    if not isinstance(diag.get("momentos"), list):
        diag["momentos"] = []
    return diag


def _limiares_audio(project_id: Optional[int]) -> Optional[dict]:
    """Limiares de avaliacao vindos das configuracoes audio.analise.* (contrato C4).
    Chave ainda ausente do registro (migracao pendente) fica de fora e o avaliar
    aplica o proprio default da secao 7 do plano; outros erros sobem normais."""
    S = SettingsService.get_settings(project_id)
    limiares = {}
    for nome in ("alvo_lufs", "teto_dbtp", "clip_pct_grave", "piso_ruido_alto",
                 "piso_ruido_medio", "lra_esmagado", "lra_amplo", "correlacao_estereo"):
        try:
            limiares[nome] = S.get(f"audio.analise.{nome}")
        except KeyError:
            continue  # chave ainda nao registrada neste banco; default cobre
    return limiares or None


def _audio_cache_obter(conn: sqlite3.Connection, video_id: int, chain_hash: str):
    """Le a linha de cache na tabela audio_render (contrato C2).

    A tabela pode ainda nao existir no banco (a migracao roda fora da rota):
    ausencia de tabela = cache vazio, a analise segue. Outro erro de sqlite
    sobe; nada engolido em silencio."""
    try:
        return conn.execute(
            "SELECT analysis_json FROM audio_render WHERE video_id = ? AND chain_hash = ?",
            (video_id, chain_hash),
        ).fetchone()
    except sqlite3.OperationalError as err:
        if "no such table" in str(err).lower():
            return None
        raise


def _fonte_disponivel(video: dict, video_id: int) -> Optional[str]:
    """Origem acessivel agora, na preferencia da rota: 'original' | 'proxy' | None.

    O bruto vive num HD externo que pode estar desligado; o proxy e local."""
    if Path(video["filepath"]).exists():
        return "original"
    if (CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4").exists():
        return "proxy"
    return None


def _audio_cache_gravar(conn: sqlite3.Connection, video_id: int, in_s: Optional[float],
                        out_s: Optional[float], chain_hash: str, analysis_json: str) -> None:
    """Grava o diagnostico como linha 'ready' na audio_render (contrato C2)."""
    try:
        conn.execute(
            "INSERT OR REPLACE INTO audio_render "
            "(video_id, in_s, out_s, chain_hash, chain_json, status, analysis_json) "
            "VALUES (?, ?, ?, ?, '[]', 'ready', ?)",
            (video_id, in_s, out_s, chain_hash, analysis_json),
        )
        conn.commit()
    except sqlite3.OperationalError as err:
        if "no such table" in str(err).lower():
            print(f"[AudioAnalysis] Tabela audio_render ainda nao existe no banco; "
                  f"analise do video {video_id} concluiu sem cache.")
            return
        raise


@router.get("/api/video/{video_id}/audio/analysis")
def get_video_audio_analysis(
    video_id: int,
    in_s: Optional[float] = Query(None, alias="in", description="Inicio do intervalo em segundos (padrao: 0)."),
    out_s: Optional[float] = Query(None, alias="out", description="Fim do intervalo em segundos (padrao: fim do arquivo)."),
    refresh: bool = Query(False, description="Ignora o cache e reanalisa com ffmpeg."),
    conn: sqlite3.Connection = Depends(get_db_conn),
):
    """Pre-analise de audio do clipe (docs/PLANO_AJUSTES_DE_AUDIO.md, secao 5).

    Um passe de ffmpeg (ebur128 + astats) devolve LUFS-I, LRA, true peak, piso
    de ruido, clipping e correlacao estereo, mais a avaliacao com selos e preset
    sugerido. A ~90x tempo real (secao 5), um clipe de 90 s leva ~1 s: chamada
    sincrona, sem worker, com cache na tabela audio_render (contrato C2).

    O original tem preferencia sobre o proxy porque os numeros divergem; quando
    o HD do acervo esta desligado, cai para o proxy local e a resposta declara
    em 'fonte' qual dos dois gerou os numeros guardados.
    """
    # Import local (padrao deste arquivo para modulos pesados/opcionais): enquanto
    # o modulo do contrato C1 nao existir, o servidor sobe e so esta rota falha.
    # parse_ffmpeg_audio_report entra por fidelidade ao contrato C1; a rota usa os wrappers.
    from src.media.audio_analysis import analisar_intervalo, avaliar, parse_ffmpeg_audio_report  # noqa: F401

    # Teto do intervalo numa chamada sincrona. Medido nesta maquina: 90 s de audio
    # em 2,9 s (~31x tempo real, nao os 90x estimados na secao 5 do plano), entao o
    # default de 2400 s custa ~80 s de CPU presos num thread do FastAPI. Esse teto
    # cobre a entrevista mais longa do acervo (2016 s) com folga - um teto menor
    # barra justamente as entrevistas inteiras, que sao o material principal.
    # Configuravel em audio.analise.teto_intervalo_s; acima dele recusa com
    # mensagem em vez de travar o servidor, e quem precisa de mais pede por trechos.
    ANALISE_AUDIO_TETO_PADRAO_S = 2400.0

    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    try:
        teto_intervalo_s = float(
            SettingsService.get_settings(video.get("project_id")).get("audio.analise.teto_intervalo_s")
        )
    except KeyError:
        teto_intervalo_s = ANALISE_AUDIO_TETO_PADRAO_S  # chave ainda nao registrada neste banco

    if in_s is not None and in_s < 0:
        raise HTTPException(status_code=400, detail="O parâmetro 'in' não pode ser negativo.")
    if in_s is not None and out_s is not None and out_s <= in_s:
        raise HTTPException(status_code=400, detail="O parâmetro 'out' deve ser maior que 'in'.")
    duracao_pedida = (out_s if out_s is not None else (video.get("duration") or 0.0)) - (in_s or 0.0)
    if duracao_pedida > teto_intervalo_s:
        raise HTTPException(
            status_code=400,
            detail=(f"Intervalo de {duracao_pedida:.0f} s passa do teto de {teto_intervalo_s:.0f} s para análise "
                    "síncrona. Analise por trechos usando 'in' e 'out', ou aumente o teto em "
                    "Configurações > Áudio (modo Profissional)."),
        )

    # Cache antes de tudo que gera custo: hit nao precisa nem localizar arquivo.
    chain_hash = _hash_analise_audio(video_id, in_s, out_s)
    if not refresh:
        linha_cache = _audio_cache_obter(conn, video_id, chain_hash)
        if linha_cache and linha_cache["analysis_json"]:
            try:
                diag_cache = json.loads(linha_cache["analysis_json"])
            except ValueError as err:
                raise HTTPException(status_code=500, detail=(
                    f"Cache de análise corrompido para o vídeo {video_id} "
                    f"(hash {chain_hash[:12]}): {err}"))
            fonte_cache = diag_cache.pop("fonte", None) or _fonte_disponivel(video, video_id)
            _garantir_envelope_momentos(diag_cache)  # linha da rodada 1: series ausentes
            return {
                "ok": True, "video_id": video_id, "in_s": in_s, "out_s": out_s,
                "cached": True, "fonte": fonte_cache,
                "diag": _json_seguro_para_resposta(diag_cache),
                "avaliacao": _json_seguro_para_resposta(
                    avaliar(diag_cache, _limiares_audio(video.get("project_id")))),
            }

    # Origem: original primeiro; proxy local quando o bruto esta inacessivel.
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    fonte = _fonte_disponivel(video, video_id)
    if fonte is None:
        return {
            "ok": False, "video_id": video_id, "in_s": in_s, "out_s": out_s, "cached": False,
            "erro": (f"Nem o original ({video.get('filepath')}) nem o proxy ({proxy_path}) "
                     "estão acessíveis. Ligue o HD do acervo ou gere o proxy do vídeo."),
        }
    src_path = Path(video["filepath"]) if fonte == "original" else proxy_path

    diag = analisar_intervalo(src_path, in_s, out_s)
    if not diag.get("ok"):
        return {
            "ok": False, "video_id": video_id, "in_s": in_s, "out_s": out_s, "cached": False,
            "erro": diag.get("erro") or "ffmpeg não devolveu dados de áudio (o arquivo tem faixa de áudio?).",
        }

    # A fonte viaja dentro do JSON cacheado: um hit futuro precisa declarar a
    # origem real dos numeros guardados, nao a situacao atual dos arquivos.
    diag["fonte"] = fonte
    # O envelope/momentos engordaram o analysis_json de ~120 bytes para ~62 kB.
    # Acima do teto (constante ANALISE_AUDIO_CACHE_TETO_BYTES) responde sem
    # cachear: a proxima chamada paga o ffmpeg de novo, mas nenhuma linha
    # anomala fica no banco para todo hit carregar. Abaixo, valor real entra
    # inteiro no cache (-inf incluido; a sanitizacao e so na resposta HTTP).
    analysis_json = json.dumps(diag)
    tamanho_analysis = len(analysis_json.encode("utf-8"))
    if tamanho_analysis > ANALISE_AUDIO_CACHE_TETO_BYTES:
        print(f"[AudioAnalysis] analysis_json do video {video_id} tem {tamanho_analysis} bytes "
              f"(teto {ANALISE_AUDIO_CACHE_TETO_BYTES}); analise concluiu SEM gravar cache.")
    else:
        _audio_cache_gravar(conn, video_id, in_s, out_s, chain_hash, analysis_json)
    diag_resposta = {chave: valor for chave, valor in diag.items() if chave != "fonte"}
    _garantir_envelope_momentos(diag_resposta)

    return {
        "ok": True, "video_id": video_id, "in_s": in_s, "out_s": out_s,
        "cached": False, "fonte": fonte,
        "diag": _json_seguro_para_resposta(diag_resposta),
        "avaliacao": _json_seguro_para_resposta(
            avaliar(diag, _limiares_audio(video.get("project_id")))),
    }


# -- ETAPA 3 do plano de audio: cadeia ffmpeg RENDERIZADA (contrato F2) --------
# Tipo B do plano (docs/PLANO_AJUSTES_DE_AUDIO.md, secoes 3 e 6): tratamento que
# GERA ARQUIVO. O original nunca e tocado -- o clipe guarda um ponteiro
# {"type":"audio_render","ref":...}, e o WAV tratado vive em
# data/audio_tratado/<video_id>/<chain_hash>.wav. Os renders usam chain_hash do
# contrato F1 ("render|..."), que nunca colide com o hash "analysis|..." da
# pre-analise da ETAPA 1 acima -- mesma tabela, espacos de cache separados.

RE_HASH_CADEIA_AUDIO = re.compile(r"^[0-9a-f]{64}$")

AUDIO_TRATADO_DIR = CONFIG.BASE_DIR / "data" / "audio_tratado"

# Duracao da previa sincrona ("Prever 15 s" do plano, secao 6).
PREVIA_AUDIO_S = 15.0


def _ref_audio_tratado(video_id: int, chain_hash: str) -> str:
    """Caminho RELATIVO ao BASE_DIR no formato do contrato F3 (clip.effects.ref)."""
    return f"data/audio_tratado/{video_id}/{chain_hash}.wav"


def _exige_hash_valido(chain_hash: str) -> None:
    """Guarda 1 de travessia de caminho: chain_hash precisa ser hexdigest sha256."""
    if not isinstance(chain_hash, str) or not RE_HASH_CADEIA_AUDIO.fullmatch(chain_hash):
        raise HTTPException(
            status_code=400,
            detail=("chain_hash inválido: esperado sha256 hexdigest de 64 caracteres "
                    "[0-9a-f]."),
        )


def _wav_do_render(video_id: int, chain_hash: str) -> Path:
    """Caminho ABSOLUTO do WAV derivado, com a guarda 2 de travessia.

    O hash ja passou pelo regex antes de chegar aqui; a checagem de contencao em
    data/audio_tratado fica como segunda barreira (defesa em profundidade) porque
    custa nada e o erro desse tipo e leitura de arquivo arbitrario."""
    if not RE_HASH_CADEIA_AUDIO.fullmatch(str(chain_hash)):
        raise ValueError(f"chain_hash invalido: {chain_hash!r}")
    base = AUDIO_TRATADO_DIR.resolve()
    candidato = (base / str(video_id) / f"{chain_hash}.wav").resolve()
    if not candidato.is_relative_to(base):
        raise ValueError("caminho fora de data/audio_tratado")
    return candidato


def _task_key_render(video_id: int, chain_hash: str) -> str:
    """Chave do progresso na tela de Tarefas (TaskManager) para um render."""
    return f"audio-render-{video_id}-{chain_hash[:12]}"


def _sem_tabela_audio_render(err: sqlite3.OperationalError) -> bool:
    return "no such table" in str(err).lower()


def _render_cache_obter(conn: sqlite3.Connection, video_id: int, chain_hash: str):
    """Le a linha de render na audio_render; tabela ausente = cache vazio
    (mesma tolerancia da _audio_cache_obter da pre-analise). Outro erro sobe."""
    try:
        return conn.execute(
            "SELECT * FROM audio_render WHERE video_id = ? AND chain_hash = ?",
            (video_id, chain_hash),
        ).fetchone()
    except sqlite3.OperationalError as err:
        if _sem_tabela_audio_render(err):
            return None
        raise


def _render_cache_gravar(conn: sqlite3.Connection, video_id: int, in_s: Optional[float],
                         out_s: Optional[float], chain_hash: str, cadeia: list,
                         path_ref: str, status: str,
                         analysis_json: Optional[str] = None) -> None:
    """Upsert da linha de render. O indice unico (video_id, chain_hash) garante
    uma linha por intencao: reaplicar a mesma cadeia ATUALIZA a linha em vez de
    duplicar ou mentir sobre o estado anterior."""
    try:
        conn.execute(
            "INSERT INTO audio_render "
            "(video_id, in_s, out_s, chain_hash, chain_json, path, status, analysis_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id, chain_hash) DO UPDATE SET "
            "in_s=excluded.in_s, out_s=excluded.out_s, chain_json=excluded.chain_json, "
            "path=excluded.path, status=excluded.status, analysis_json=excluded.analysis_json, "
            "created_at=CURRENT_TIMESTAMP",
            (video_id, in_s, out_s, chain_hash, json.dumps(list(cadeia)),
             path_ref, status, analysis_json),
        )
        conn.commit()
    except sqlite3.OperationalError as err:
        if _sem_tabela_audio_render(err):
            print(f"[AudioRender] Tabela audio_render ainda nao existe; render do "
                  f"video {video_id} segue sem cache persistente.")
            return
        raise


def _corrigir_ready_sem_arquivo(conn: sqlite3.Connection, video_id: int, chain_hash: str) -> None:
    """Linha dizia ready mas o WAV sumiu do disco: corrige o estado para failed
    em vez de mentir. O cliente reaplica o POST e a linha volta a renderizar."""
    msg = "Arquivo derivado ausente no disco; estado 'ready' corrigido para 'failed'. Aplique a cadeia novamente."
    try:
        conn.execute(
            "UPDATE audio_render SET status = 'failed', analysis_json = ? "
            "WHERE video_id = ? AND chain_hash = ?",
            (json.dumps({"antes": None, "depois": None, "erro": msg}), video_id, chain_hash),
        )
        conn.commit()
    except sqlite3.OperationalError as err:
        if _sem_tabela_audio_render(err):
            return
        raise
    print(f"[AudioRender] Video {video_id}: WAV do hash {chain_hash[:12]} sumiu; "
          f"linha corrigida para failed.")


def _parse_analysis_render(linha):
    """(antes, depois, erro) vindos do analysis_json de uma linha de render.

    Formato gravado nesta etapa: {"antes": diag|None, "depois": diag|None,
    "erro": str|None, "render": {...}}. JSON corrompido estoura ValueError --
    a rota converte para 500, mesmo trato do cache da pre-analise."""
    bruto = linha["analysis_json"]
    if not bruto:
        return None, None, None
    dados = json.loads(bruto)
    if not isinstance(dados, dict):
        raise ValueError("analysis_json de render nao e um objeto JSON")
    if not ({"antes", "depois", "erro"} & set(dados)):
        return None, dados, None  # diag puro (legado): trata como 'depois'
    return dados.get("antes"), dados.get("depois"), dados.get("erro")


def _diag_antes_do_cache(conn: sqlite3.Connection, video_id: int,
                         in_s: float, out_s: Optional[float]):
    """Reaproveita a pre-analise da ETAPA 1 como 'analise_antes' do render.

    Procura a linha de analise do MESMO intervalo; as variantes com None
    (quando a rota de analise foi chamada sem 'in'/'out') entram na busca
    porque 0/fim-do-arquivo e o mesmo intervalo com outro spelling de hash.
    Sem hit devolve None -- a UI mostra so a analise de depois."""
    candidatos = [(in_s, out_s)]
    if in_s == 0.0:
        candidatos.append((None, out_s))
        candidatos.append((None, None))
    for ini, fim in candidatos:
        linha = _audio_cache_obter(conn, video_id, _hash_analise_audio(video_id, ini, fim))
        if linha and linha["analysis_json"]:
            try:
                diag = json.loads(linha["analysis_json"])
            except ValueError:
                continue  # cache de analise corrompido nao bloqueia o render
            if isinstance(diag, dict):
                return diag
    return None


def _resolver_cadeia(audio_chain_mod, payload) -> list:
    """Converte {cadeia|preset} do corpo na lista canonica do contrato F1.

    Exatamente uma das fontes e obrigatoria. normalizar_cadeia recebe um dict de
    opcoes; como o F1 esta sendo escrito em paralelo a esta rota, preset e
    tentado primeiro como opcao nativa e, se o modulo ainda nao o tratar, via
    PRESETS_CADEIA[preset] entregue como 'cadeia'. Qualquer recusa vira ValueError
    (que a rota converte em 400) -- nunca excecao crua do modulo."""
    tem_cadeia = payload.cadeia is not None
    tem_preset = bool(payload.preset)
    if tem_cadeia == tem_preset:
        raise ValueError("Informe exatamente um de 'cadeia' (lista de passos) ou 'preset'.")
    if tem_cadeia:
        # 'cadeia' ja chega canonica (["adeclip", "loudnorm:-16:-1.5", ...]).
        # normalizar_cadeia NAO serve aqui: ela recebe dicionario de intencao
        # (reparo_clipping, loudnorm, ...), nao a lista pronta. Validamos os
        # passos contra CADEIA_ORDEM e reordenamos, porque o hash de cache
        # depende da ordem.
        if not payload.cadeia or not all(isinstance(p, str) and p.strip() for p in payload.cadeia):
            raise ValueError("'cadeia' deve ser uma lista de passos nao vazios.")
        ordem = tuple(getattr(audio_chain_mod, "CADEIA_ORDEM", ()) or ())
        if ordem:
            posicao = {nome: i for i, nome in enumerate(ordem)}
            desconhecidos = sorted({p.split(":", 1)[0] for p in payload.cadeia} - set(posicao))
            if desconhecidos:
                raise ValueError(
                    f"Passos desconhecidos na cadeia: {', '.join(desconhecidos)}. "
                    f"Passos validos: {', '.join(ordem)}.")
            cadeia = sorted(payload.cadeia, key=lambda p: posicao[p.split(":", 1)[0]])
        else:
            cadeia = list(payload.cadeia)  # montador sem CADEIA_ORDEM (dublê de teste)
    else:
        presets = getattr(audio_chain_mod, "PRESETS_CADEIA", {}) or {}
        if payload.preset not in presets:
            raise ValueError(
                f"Preset desconhecido '{payload.preset}'. Válidos: {', '.join(sorted(presets))}.")
        # Cada preset JA E um dicionario de opcoes no formato que normalizar_cadeia
        # espera ({"reparo_clipping": True, "denoise_classico": "afftdn", ...}).
        opcoes_preset = presets[payload.preset]
        try:
            cadeia = audio_chain_mod.normalizar_cadeia(
                dict(opcoes_preset) if isinstance(opcoes_preset, dict) else opcoes_preset)
        except (KeyError, TypeError, ValueError) as err:
            raise ValueError(
                f"Preset '{payload.preset}' recusado pelo montador (F1): {err}") from err
    if not isinstance(cadeia, (list, tuple)) or not cadeia \
            or not all(isinstance(p, str) and p for p in cadeia):
        raise ValueError("normalizar_cadeia devolveu algo que nao e uma lista de strings.")
    return list(cadeia)

# -- ETAPA 5 / contrato H4: motor "auphonic" no render + rota de cota ----------
# Contexto que decide tudo aqui: o dono tem o free tier do Auphonic (2 h/mes,
# recorrentes) e NAO vai contratar plano. Gastar cota a toa inutiliza o mes
# inteiro dele. Por isso as DUAS guardas de _guardas_nuvem rodam ANTES de
# qualquer despacho de nuvem, e a rota GET /api/audio/nuvem/cota e o que a
# interface consulta para ligar/desligar o radio "Auphonic" (contrato H6).
# Quem submete/pesquisa/baixa na nuvem e o worker de audio (contrato H5); a
# rota so valida, marca o motor na linha da audio_render e o acorda.

ENGINE_LOCAL = "local"
ENGINE_AUPHONIC = "auphonic"
ENGINES_VALIDOS = (ENGINE_LOCAL, ENGINE_AUPHONIC)

# Defaults das chaves audio.nuvem.* (settings_registry). KeyError cai aqui
# enquanto o registro nao existir neste banco (mesmo padrao de _limiares_audio).
NUVEM_ALVO_MIN_PADRAO = 120.0
NUVEM_AVISAR_PCT_PADRAO = 80.0


def _min_txt_pt(segundos: float) -> str:
    """Segundos -> texto humano em minutos com decimal pt-BR ('89,5 min')."""
    minutos = max(0.0, float(segundos)) / 60.0
    return f"{minutos:.1f}".replace(".", ",") + " min"


def _setting_nuvem(project_id: Optional[int], chave: str, padrao: float) -> float:
    """Valor float de uma chave audio.nuvem.*; chave ausente do registro cai no
    default. Outros erros sobem normais (mesma postura de _limiares_audio)."""
    try:
        return float(SettingsService.get_settings(project_id).get(chave))
    except KeyError:
        return padrao


# -- Sobrescrita manual dos ajustes da nuvem (contrato L2) ----------------------
# A grade da verdade mora em audio_cloud.campos_ajustaveis() (contrato L1): ela e
# do Auphonic e pode mudar, entao nada fica hardcoded aqui. A rota so valida contra
# ela e recusa com 400 dizendo o campo e os valores aceitos -- producao recusada
# LA na nuvem por parametro invalido gastaria cota do mesmo jeito (2 h/mes free),
# entao nada sai daqui sem validar.

def _grade_campos_ajustaveis():
    """campos_ajustaveis() do audio_cloud, ou None se o modulo ainda nao o expuser
    (escrita em paralelo / instalacao antiga). Cada chamador decide o que fazer com
    None: a rota GET de campos degrada com ok=false legivel; a de render RECUSA o
    override, porque enviar valor nao validado para a nuvem pode gastar cota."""
    from src.services import audio_cloud
    funcao = getattr(audio_cloud, "campos_ajustaveis", None)
    if not callable(funcao):
        return None
    return funcao()


def _formatar_valores_grade(valores) -> str:
    """Grade -> texto humano para mensagem de erro ('-13, -14...' | '"classic", ...')."""
    partes = []
    for v in valores:
        if isinstance(v, bool):
            partes.append("true" if v else "false")
        elif isinstance(v, str):
            partes.append(f'"{v}"')
        else:
            partes.append(str(v))
    return ", ".join(partes)


def _validar_override_algorithms(override: Optional[Dict[str, Any]], engine: str) -> Optional[Dict[str, Any]]:
    """Valida {campo: valor} contra a grade viva do Auphonic; devolve o dict limpo,
    ou None quando nao ha override. Recusa com 400:
    - override presente com motor local -> pedido incoerente (recusado, nunca
      ignorado: silencio faria o usuario achar que aplicou);
    - campo desconhecido -> mensagem lista TODOS os campos aceitos;
    - valor fora da grade (ou bool fora de true/false) -> mensagem lista os
      valores aceitos daquele campo.
    A mensagem basta para corrigir sem abrir a documentacao do Auphonic. Sem grade
    disponivel tambem recusa: melhor barrar aqui do que arriscar cota."""
    if override is None:
        return None
    if engine != ENGINE_AUPHONIC:
        raise HTTPException(
            status_code=400,
            detail=("'algorithms_override' só vale com engine='auphonic' — esses "
                    "ajustes são processados lá na nuvem. Remova o campo ou troque o "
                    "motor; com ffmpeg local ele seria ignorado e você ficaria "
                    "acreditando que aplicou."))
    if not isinstance(override, dict) or not all(isinstance(k, str) for k in override):
        raise HTTPException(
            status_code=400,
            detail=("'algorithms_override' deve ser um objeto {campo: valor}, ex.: "
                    '{"denoiseamount": 12, "levelerstrength": 40}.'))
    if not override:
        return None  # {} = nada alterado = exatamente o pedido de hoje
    grade = _grade_campos_ajustaveis()
    if not isinstance(grade, dict) or not grade:
        raise HTTPException(
            status_code=400,
            detail=("Não foi possível validar 'algorithms_override': a grade de campos "
                    "ajustáveis do Auphonic não está disponível nesta instalação. Nada "
                    "foi enviado para a nuvem; tente de novo mais tarde ou processe sem "
                    "sobrescrita."))
    for campo, valor in override.items():
        spec = grade.get(campo)
        if not isinstance(spec, dict):
            raise HTTPException(
                status_code=400,
                detail=(f"Campo desconhecido em 'algorithms_override': '{campo}'. Campos "
                        f"aceitos pelo Auphonic: {', '.join(str(c) for c in grade)}. A lista "
                        f"viva, com rótulos e descrições, está em GET /api/audio/nuvem/campos."))
        if spec.get("tipo") == "bool":
            if not isinstance(valor, bool):
                raise HTTPException(
                    status_code=400,
                    detail=(f"'{campo}' é liga/desliga: envie true ou false "
                            f"(recebido: {_formatar_valores_grade([valor])})."))
            continue
        valores = spec.get("valores")
        if valor not in (valores or ()):
            aceitos = (_formatar_valores_grade(valores)
                       if isinstance(valores, (list, tuple)) and valores else "(indisponível)")
            rotulo = spec.get("rotulo") or campo
            raise HTTPException(
                status_code=400,
                detail=(f"Valor inválido para '{campo}' ({rotulo}): "
                        f"{_formatar_valores_grade([valor])}. Valores aceitos: {aceitos}."))
    return dict(override)


def _alvos_nuvem_do_projeto(project_id: Optional[int]) -> tuple:
    """Alvo de loudness e teto de pico do projeto, para montar o bloco da nuvem.

    Mesma ordem que o worker usa: configuracao do projeto primeiro, defaults do
    plano depois (-16 LUFS, -1,5 dBTP). Chave ausente no banco nao e erro - o
    default cobre, como no resto do modulo."""
    alvo, teto = -16.0, -1.5
    try:
        S = SettingsService.get_settings(project_id)
    except Exception as err:
        print(f"[AudioCloud] Configuracoes indisponiveis, usando alvos padrao: {err}")
        return alvo, teto
    for chave, nome in (("audio.analise.alvo_lufs", "alvo"), ("audio.analise.teto_dbtp", "teto")):
        try:
            valor = float(S.get(chave))
        except (KeyError, TypeError, ValueError):
            continue
        if nome == "alvo":
            alvo = valor
        else:
            teto = valor
    return alvo, teto


def _chave_nuvem_resolvida(project_id: Optional[int]) -> str:
    """Espelho da ordem de resolucao do AuphonicProvider._resolver_chave:
    valor do banco ('api.auphonic_key') primeiro, variavel de ambiente
    AUPHONIC_API_KEY depois. Espelhar e proposito: a guarda da rota recusa
    EXATAMENTE quando o provider tambem recusaria."""
    from src.services.audio_cloud import ENV_FALLBACK, KEY_SETTINGS

    try:
        S = SettingsService.get_settings(project_id)
        try:
            valor = S.get(KEY_SETTINGS)
        except KeyError:
            valor = ""  # registro ainda nao cadastrado neste banco; default cobre
        if valor:
            return str(valor)
    except Exception:
        valor = None  # sem banco/settings acessiveis: mesma saida do provider
    return os.getenv(ENV_FALLBACK, "") or ""


def _guardas_nuvem(project_id: Optional[int], custo_segundos: float) -> dict:
    """As duas guardas OBRIGATORIAS antes de despachar qualquer coisa para a nuvem.

    1. sem chave configurada -> 400 dizendo ONDE configurar;
    2. cota insuficiente para a duracao pedida -> 400 com quanto resta e quanto
       o pedido custaria.
    Custo = janela inteira [in, out]: e isso que o worker extrai e submete.
    Leitura de cota e LOCAL (RegistroDeCota, JSON em data/audio_cloud):
    nenhuma requisicao de rede acontece dentro desta funcao."""
    from src.services.audio_cloud import RegistroDeCota

    if not _chave_nuvem_resolvida(project_id):
        raise HTTPException(
            status_code=400,
            detail=("Motor 'auphonic' sem chave de API configurada. Cadastre-a em "
                    "Configurações > Modelos & Chaves (campo 'Chave Auphonic', chave "
                    "'api.auphonic_key') ou defina a variável de ambiente "
                    "AUPHONIC_API_KEY. Nada foi enviado para a nuvem."))

    alvo_min = _setting_nuvem(project_id, "audio.nuvem.alvo_minutos_mes",
                              NUVEM_ALVO_MIN_PADRAO)
    avisar_pct = _setting_nuvem(project_id, "audio.nuvem.avisar_em_pct",
                                NUVEM_AVISAR_PCT_PADRAO)
    limite_segundos = alvo_min * 60.0
    if limite_segundos <= 0:
        limite_segundos = NUVEM_ALVO_MIN_PADRAO * 60.0  # config quebrada: default honesto
    retrato = RegistroDeCota().status(
        limite_segundos=limite_segundos,
        perto_do_limite_a_partir=min(max(avisar_pct, 0.0), 100.0) / 100.0,
    )
    restante = float(retrato["restante_segundos"])
    custo = max(0.0, float(custo_segundos))
    if custo > restante:
        raise HTTPException(
            status_code=400,
            detail=(f"Cota do Auphonic insuficiente: o trecho pede {_min_txt_pt(custo)} e "
                    f"restam {_min_txt_pt(restante)} dos {_min_txt_pt(limite_segundos)} "
                    f"grátis do mês {retrato['mes']} (já usado "
                    f"{_min_txt_pt(retrato['usado_segundos'])}). Nada foi enviado para a "
                    f"nuvem; espere virar o mês, processe localmente ou reduza o intervalo."))
    return retrato


def _despachar_worker_audio() -> dict:
    """Acorda o worker de audio em processo separado, no padrao de
    launch_transcription_worker (launch_detached.py + guarda de PID). O submit/
    poll/fetch na nuvem e dele (contrato H5); se ja ha um vivo, nao se lanca
    outro -- a linha pending recem-gravada entra na fila que ele consome."""
    from src.worker_audio import WORKER_TYPE as WORKER_TYPE_AUDIO

    vivo = worker_is_running(WORKER_TYPE_AUDIO)
    if vivo:
        return {"lancado": False, "pid": vivo.get("pid"),
                "motivo": "worker de áudio já está rodando e consome a fila pendente."}

    carimbo = time.strftime("%Y%m%d_%H%M%S")
    log_out = WORKER_LOGS_DIR / f"worker_{WORKER_TYPE_AUDIO}_{carimbo}.out.log"
    log_err = WORKER_LOGS_DIR / f"worker_{WORKER_TYPE_AUDIO}_{carimbo}.err.log"
    lancador = [sys.executable, str(CONFIG.BASE_DIR / "scripts" / "launch_detached.py"),
                sys.executable, "-m", "src.worker_audio",
                "--stdout", str(log_out), "--stderr", str(log_err)]
    try:
        resultado = subprocess.run(lancador, capture_output=True, text=True, timeout=30)
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Falha ao lançar o worker de áudio: {err}")
    if resultado.returncode != 0:
        raise HTTPException(status_code=500, detail=(
            f"O lançador do worker de áudio falhou: "
            f"{resultado.stderr.strip() or 'sem mensagem'}"))
    achado = re.search(r"PID:\s*(\d+)", resultado.stdout or "")
    if not achado:
        raise HTTPException(status_code=500, detail=(
            f"O lançador não devolveu PID: {resultado.stdout.strip()!r}"))
    pid = int(achado.group(1))
    # NAO gravamos o arquivo de PID aqui. Quem registra e o proprio worker, na
    # guarda_de_instancia dele. Gravar em nome dele criava o registro que o
    # fazia recusar a si mesmo: ele subia, lia o proprio PID no arquivo,
    # concluia que outro worker ja tinha a fila e saia - a linha ficava em
    # 'pending' para sempre e TODO despacho automatico morria em silencio
    # (achado em 23/08/2026; valia para o passo de IA e para o caminho da nuvem).
    # A corrida de dois POSTs quase simultaneos continua coberta: o segundo
    # worker sobe, ve o registro do primeiro e sai sozinho.
    return {"lancado": True, "pid": pid}


from pydantic import ConfigDict

from pydantic import ConfigDict

class AudioRenderRequest(BaseModel):
    """Corpo do POST .../audio/render (contrato F2). 'in'/'out' sao os nomes do
    contrato; em Python viram in_s/out_s via alias."""
    model_config = ConfigDict(populate_by_name=True)
    in_s: Optional[float] = Field(None, alias="in", ge=0,
                                  description="Início do intervalo em segundos (padrão: 0).")
    out_s: Optional[float] = Field(None, alias="out",
                                   description="Fim do intervalo em segundos (padrão: fim do arquivo).")
    cadeia: Optional[List[str]] = Field(
        None, description="Passos na ordem canônica; ex.: ['adeclip','speechnorm','loudnorm:-16'].")
    preset: Optional[str] = Field(
        None, description="Chave de PRESETS_CADEIA; ex.: 'so_entrega'.")
    engine: Optional[str] = Field(
        None, description=("Motor do tratamento: 'local' (padrão, ffmpeg desta máquina) ou "
                           "'auphonic' (nuvem; passa pelas guardas de chave e cota antes de "
                           "qualquer despacho). Ausente = 'local' = comportamento de hoje."))
    algorithms_override: Optional[Dict[str, Any]] = Field(
        None, description=("Sobrescrita manual dos ajustes da nuvem ({campo: valor}), só com "
                           "engine='auphonic' — com 'local' o pedido é recusado (400), porque "
                           "ignorar em silêncio faria você achar que aplicou. Validado contra a "
                           "grade viva do Auphonic antes de qualquer despacho; campos e valores "
                           "aceitos saem de GET /api/audio/nuvem/campos."))
    previa: bool = Field(False, description="true: renderiza só 15 s a partir de 'in'. "
                                            "Síncrona com cadeia sem IA; com o passo de IA "
                                            "(denoise_ia) vai para a fila do worker e devolve pending.")


def _render_previa_sincrona(conn: sqlite3.Connection, audio_chain_mod, video_id: int,
                            origem: Path, in_s: float, out_final: float,
                            cadeia: list, chain_hash: str, path_ref: str) -> dict:
    """Previa de 15 s: SINCRONA de proposito (secao 6 do plano: a ~90x tempo real,
    15 s custam menos de 1 s). Grava a linha ready direto, ja com a analise do
    WAV gerado para o A/B da previa."""
    dest = _wav_do_render(video_id, chain_hash)
    dest.parent.mkdir(parents=True, exist_ok=True)
    resultado = audio_chain_mod.renderizar(origem, dest, in_s, out_final, cadeia)
    if not resultado.get("ok"):
        erro = resultado.get("erro") or "ffmpeg terminou sem sucesso e sem mensagem."
        _render_cache_gravar(conn, video_id, in_s, out_final, chain_hash, cadeia,
                             path_ref, "failed",
                             json.dumps({"antes": None, "depois": None, "erro": erro}))
        return {"ok": False, "video_id": video_id, "chain_hash": chain_hash,
                "status": "failed", "path": None, "cached": False, "erro": erro}

    # Import local (padrao da casa): analisar_intervalo existe desde a Etapa 1.
    from src.media.audio_analysis import analisar_intervalo
    diag_depois = analisar_intervalo(dest)  # o WAV cobre exatamente a janela pedida
    analysis = {
        "antes": _diag_antes_do_cache(conn, video_id, in_s, out_final),
        "depois": diag_depois if diag_depois.get("ok") else None,
        "render": {"duracao_render_s": resultado.get("duracao_render_s"),
                   "medidas_loudnorm": resultado.get("medidas_loudnorm")},
    }
    if not diag_depois.get("ok"):
        analysis["aviso_analise"] = diag_depois.get("erro")
    _render_cache_gravar(conn, video_id, in_s, out_final, chain_hash, cadeia,
                         path_ref, "ready", json.dumps(analysis))
    return {"ok": True, "video_id": video_id, "chain_hash": chain_hash,
            "status": "ready", "path": path_ref, "cached": False}


def _tarefa_render_audio(video_id: int, src_path: Path, in_s: float, out_s: float,
                         cadeia: list, chain_hash: str, task_key: str) -> None:
    """Render completo em segundo plano, no padrao de tarefa da casa
    (TASK_MANAGER.executor.submit, como os proxies e miniaturas).

    Por que nao worker em processo separado: o peso aqui e o FFmpeg, que ja e um
    SUBPROCESSO propio (~90x tempo real) -- o Python do servidor nao consome o
    GIL durante o render. O sufoco medido em 15/07 (cabecalho de worker_vision.py)
    era processamento Python no request; submit na executor + progresso na tela
    de Tarefas reproduz o padrao dos proxies sem criar uma nova infraestrutura.
    """
    from src.media.audio_chain import renderizar        # contrato F1, import local
    from src.media.audio_analysis import analisar_intervalo

    def _progresso(valor) -> None:
        """Adaptador do callback do F1 para a tela de Tarefas; aceita 0-1 ou 0-100."""
        try:
            fracao = float(valor)
        except (TypeError, ValueError):
            return
        if fracao > 1.0:
            fracao /= 100.0
        fracao = min(max(fracao, 0.0), 1.0)
        TASK_MANAGER.update_progress(task_key, fracao * 100.0, "running", "audio")

    path_ref = _ref_audio_tratado(video_id, chain_hash)
    TASK_MANAGER.update_progress(
        task_key, 0.0, "running", "audio", label=f"Audio tratado (video {video_id})",
        log_message=f"Render de audio iniciado: {len(cadeia)} passo(s), {max(out_s - in_s, 0.0):.0f}s de janela.")

    try:
        dest = _wav_do_render(video_id, chain_hash)
        dest.parent.mkdir(parents=True, exist_ok=True)
        resultado = renderizar(src_path, dest, in_s, out_s, cadeia, progresso=_progresso)
    except Exception as err:
        # Deliberado: excecao que escapasse morreria calada dentro da thread e a
        # linha ficaria 'running' para sempre -- mentir sobre o estado e pior.
        # O erro NAO e engolido: vai para o banco, para a tela de Tarefas e para o log.
        import traceback
        print(f"[AudioRender] Video {video_id}: render falhou: {err}")
        traceback.print_exc()
        with get_db() as conn_err:
            _render_cache_gravar(conn_err, video_id, in_s, out_s, chain_hash, cadeia,
                                 path_ref, "failed",
                                 json.dumps({"antes": None, "depois": None, "erro": str(err)}))
        TASK_MANAGER.update_progress(task_key, 100.0, "failed", "audio",
                                     log_message=f"Falha no render de audio: {err}")
        return

    if not resultado.get("ok"):
        erro = resultado.get("erro") or "ffmpeg terminou sem sucesso e sem mensagem."
        print(f"[AudioRender] Video {video_id}: {erro}")
        with get_db() as conn_err:
            _render_cache_gravar(conn_err, video_id, in_s, out_s, chain_hash, cadeia,
                                 path_ref, "failed",
                                 json.dumps({"antes": None, "depois": None, "erro": erro}))
        TASK_MANAGER.update_progress(task_key, 100.0, "failed", "audio",
                                     log_message=f"Falha no render de audio: {erro}")
        return

    diag_depois = analisar_intervalo(dest)  # analise de DEPOIS roda sobre o WAV
    with get_db() as conn_ok:
        analysis = {
            "antes": _diag_antes_do_cache(conn_ok, video_id, in_s, out_s),
            "depois": diag_depois if diag_depois.get("ok") else None,
            "render": {"duracao_render_s": resultado.get("duracao_render_s"),
                       "medidas_loudnorm": resultado.get("medidas_loudnorm")},
        }
        if not diag_depois.get("ok"):
            analysis["aviso_analise"] = diag_depois.get("erro")
        _render_cache_gravar(conn_ok, video_id, in_s, out_s, chain_hash, cadeia,
                             path_ref, "ready", json.dumps(analysis))
    TASK_MANAGER.update_progress(
        task_key, 100.0, "finished", "audio",
        log_message=f"WAV tratado pronto: {path_ref}")


# -- ETAPA 4 na rota: cadeias com o passo de IA vao para o worker ---------------
# O renderizar do audio_chain RECUSA qualquer cadeia que contenha o passo de IA
# ("denoise_ia"): o ffmpeg dele nao roda IA (a ~0,7x tempo real, ~50x mais lento
# que os filtros); quem parte a cadeia (worker_audio.dividir_cadeia) e executa o
# denoisar e o worker de audio. Entao estes pedidos NAO podem chamar renderizar
# inline -- nem no render completo, nem na previa de 15 s (segurar o HTTP por
# ~21 s de maquina e o sufoco que esta casa ja aprendeu a evitar). Mesmo caminho
# do motor auphonic: linha 'pending' na audio_render + _despachar_worker_audio.
# Cadeia SEM IA segue byte a byte como sempre (mesmos hashes e respostas).

# Motor de IA que o worker lancado vai usar: o despacho roda
# `python -m src.worker_audio` sem --motor, e o default do parser la e dpdfnet.
# Espelhar o default aqui e o que permite recusar ANTES de enfileirar exatamente
# quando o worker falharia minutos depois.
MOTOR_IA_PADRAO_WORKER = "dpdfnet"

# Fator tempo real do denoise por IA nesta maquina (briefing do dono: previa de
# 15 s custa ~21 s -> ~0,7x). Serve SO para a estimativa devolvida na resposta;
# o trabalho em si nao depende dela.
IA_FATOR_TEMPO_REAL = 0.7

MOTIVO_FILA_IA = (
    "A cadeia inclui o passo de IA (denoise_ia), que roda no worker de áudio a "
    "cerca de 0,7x tempo real (~50x mais lento que o ffmpeg local) -- nada roda "
    "dentro desta requisição. Acompanhe pelo GET .../audio/render/{chain_hash}."
)


def _token_passo_ia(audio_chain_mod) -> str:
    """Token reservado do passo de IA na gramatica da casa ("denoise_ia").

    Lido do PROPRIO audio_chain (_PASSO_IA_RESERVADO, a constante que a
    normalizar_cadeia usa para GERAR o passo); se o modulo ainda nao o expuser,
    cai no PASSO_IA do worker de audio -- mesmo token por contrato. A gramatica
    nunca e reimplementada aqui: mudou la, muda aqui junto.
    """
    token = getattr(audio_chain_mod, "_PASSO_IA_RESERVADO", None)
    if isinstance(token, str) and token.strip():
        return token.strip()
    try:
        from src.worker_audio import PASSO_IA as token_worker
    except Exception:
        return "denoise_ia"
    return str(token_worker)


def _cadeia_contem_ia(audio_chain_mod, cadeia) -> bool:
    """True se algum passo da cadeia canonica e o passo reservado de IA.

    O passo sai de normalizar_cadeia como "denoise_ia", "denoise_ia:<dB>" ou
    "denoise_ia:sem_limite"; a identificacao compara so o nome-base contra o
    token do modulo (mesma extracao usada pelo resto desta rota e pelo worker).
    """
    token = _token_passo_ia(audio_chain_mod)
    return any(str(p).split(":", 1)[0].strip().lower() == token
               for p in (cadeia or []))


def _motor_ia_do_worker() -> dict:
    """Da para denoisar hoje, com o MESMO motor que o worker despachado usara?

    Espelho exato da guarda do worker (processar_item -> audio_denoise.
    motor_disponivel(args.motor)): recusar AQUI evita enfileirar um trabalho que
    so viraria 'failed' minutos depois."""
    from src.media.audio_denoise import motor_disponivel

    return motor_disponivel(MOTOR_IA_PADRAO_WORKER)


def _enfileirar_render_ia(conn: sqlite3.Connection, video_id: int,
                          in_s: float, out_final: float, cadeia: list,
                          chain_hash: str, path_ref: str, fonte: str,
                          previa: bool) -> dict:
    """Enfileira um render COM passo de IA e acorda o worker de audio.

    Mesmo caminho do motor auphonic (linha 'pending' gravada na audio_render +
    _despachar_worker_audio); a diferenca e que a chain_json gravada e a cadeia
    local INTEIRA, com o denoise_ia no lugar -- dividir_cadeia do worker e quem
    a parte em pre-IA / IA / pos-IA. O chamador JA garantiu motor_disponivel()
    ok e fonte acessivel; nada aqui chama renderizar.
    """
    bloco_analise = {
        "antes": _diag_antes_do_cache(conn, video_id, in_s, out_final),
        "depois": None, "erro": None,
        "engine": ENGINE_LOCAL, "fila": "worker_audio",
    }
    _render_cache_gravar(conn, video_id, in_s, out_final, chain_hash, cadeia,
                         path_ref, "pending", json.dumps(bloco_analise))
    despacho_worker = _despachar_worker_audio()
    janela_s = max(0.0, float(out_final) - float(in_s))
    return {
        "ok": True, "video_id": video_id, "chain_hash": chain_hash,
        "status": "pending", "path": path_ref, "cached": False,
        "fonte": fonte, "engine": ENGINE_LOCAL,
        "previa": bool(previa),
        "fila": "worker_audio",
        "motivo": MOTIVO_FILA_IA,
        # Chave de progresso que o PROPrio worker usa na tela de Tarefas; o
        # /api/conversions funde o progresso dele, entao a barra funciona igual.
        "task_key": f"audio-{video_id}-{str(chain_hash)[:8]}",
        "estimativa_processamento_s": round(janela_s / IA_FATOR_TEMPO_REAL, 1),
        "worker": despacho_worker,
    }


@router.post("/api/video/{video_id}/audio/render")
def render_audio_video(video_id: int, payload: AudioRenderRequest,
                       conn: sqlite3.Connection = Depends(get_db_conn)):
    """Aplica a cadeia ffmpeg e gera o WAV tratado (Tipo B, secao 6 do plano).

    engine='auphonic' (contrato H4) valida chave e cota ANTES de tudo, grava a
    linha com o motor marcado e acorda o worker de audio, que faz submit ->
    poll -> fetch na nuvem; ausente/'local' = comportamento de sempre.
    'algorithms_override' (contrato L2) sobrescreve ajustes da nuvem por clipe:
    validado contra a grade viva do Auphonic antes de qualquer coisa, entra no
    chain_hash (overrides diferentes = resultados diferentes) e viaja ao worker
    dentro do analysis_json da linha.

    previa=true roda SINCRONO (15 s a ~90x tempo real custam menos de 1 s) --
    EXCETO quando a cadeia tem o passo de IA (denoise_ia): ai vai para a fila do
    worker de audio como o render completo, porque 15 s de IA custam ~21 s de
    maquina. Render completo NUNCA segura o request: entra na fila do TASK_MANAGER
    (ou do worker, com IA/nuvem) e o cliente acompanha pelo GET .../render/{chain_hash}. Cache de verdade na
    audio_render: hit so vale com status ready E arquivo no disco."""
    # Import local (mesmo padrao da rota de analise acima): src/media/audio_chain.py
    # e o contrato F1; enquanto o modulo nao existir, o servidor sobe e so esta
    # rota falha.
    from src.media import audio_chain as audio_chain_mod

    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    in_s = float(payload.in_s) if payload.in_s is not None else 0.0
    if in_s < 0:
        raise HTTPException(status_code=400, detail="O parâmetro 'in' não pode ser negativo.")
    duracao = float(video.get("duration") or 0.0)
    if payload.out_s is not None:
        out_base = float(payload.out_s)
    elif duracao > 0:
        out_base = duracao
    else:
        raise HTTPException(status_code=400,
                            detail="'out' ausente e o vídeo não tem duração cadastrada para usar como fim.")
    if out_base <= in_s:
        raise HTTPException(status_code=400, detail="O parâmetro 'out' deve ser maior que 'in'.")

    # Contrato H4: motor do render. Ausente = "local" = o comportamento de hoje,
    # sem nenhuma mudanca; pedido "auphonic" passa pelas guardas de chave e cota
    # antes de resolver cadeia, consultar cache ou despachar coisa alguma.
    engine = (payload.engine or ENGINE_LOCAL).strip().lower()
    if engine not in ENGINES_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=(f"engine inválida '{payload.engine}'. Válidas: "
                    f"{', '.join(ENGINES_VALIDOS)}."))
    if engine == ENGINE_AUPHONIC and payload.previa:
        raise HTTPException(
            status_code=400,
            detail=("Prévia de 15 s é síncrona e só existe no motor local; na nuvem ela "
                    "gastaria cota para um resultado que só fica pronto minutos depois. "
                    "Use o motor local para prever ou aplique direto na nuvem."))

    # Contrato L2: sobrescrita manual dos ajustes da nuvem. Validada AQUI -- antes
    # das guardas de cota e de qualquer despacho (validar e CPU local; gastar cota
    # com recusa vinda da nuvem e o cenario que o dono nao pode pagar). Devolve
    # None quando nao ha override: dai NADA abaixo muda, nem hash nem linha.
    override_nuvem = _validar_override_algorithms(payload.algorithms_override, engine)

    out_final = min(out_base, in_s + PREVIA_AUDIO_S) if payload.previa else out_base
    if out_final - in_s <= 1e-6:
        raise HTTPException(status_code=400, detail="Janela vazia: 'in' está no fim do arquivo.")

    retrato_cota_nuvem = None
    if engine == ENGINE_AUPHONIC:
        # Guardas H4 ANTES de QUALQUER trabalho de nuvem; custo = janela inteira
        # pedida (previa ja foi rejeitada acima). Sem chave ou sem cota: 400 e
        # nada sai do lugar -- nem rede, nem linha no banco, nem worker.
        retrato_cota_nuvem = _guardas_nuvem(video.get("project_id"), out_base - in_s)

    try:
        cadeia = _resolver_cadeia(audio_chain_mod, payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    if engine == ENGINE_AUPHONIC:
        # Namespace de cache proprio para a nuvem, na mesma disciplina dos
        # espacos "analysis|" e "render|" da casa: parte do hash F1 CANONICO
        # (que tambem continua validando/recusando cadeia invalida antes) e
        # deriva com semente propria. Um render de nuvem nunca colide com o
        # WAV local de cadeia igual -- nem no cache da audio_render, nem no
        # disco. O ramo local abaixo repete a chamada ORIGINAL, byte a byte.
        hash_local_equiv = audio_chain_mod.hash_cadeia(video_id, in_s, out_final, cadeia)
        # DECISAO DE CACHE (contrato L2): o override ENTRA no hash. Dois pedidos
        # com a mesma cadeia e overrides diferentes produzem WAVs diferentes --
        # tratar como o mesmo cache devolveria o arquivo ERRADO no hit (a linha
        # ready de um viraria resposta do outro). Serializacao canonica
        # (sort_keys) para o hash depender so do conteudo, nao da ordem em que a
        # interface mandou as chaves. Sem override o sufixo nao existe e o hash
        # continua byte a byte o de hoje.
        base_hash_nuvem = f"{ENGINE_AUPHONIC}|{hash_local_equiv}"
        if override_nuvem:
            base_hash_nuvem += "|override|" + json.dumps(override_nuvem, sort_keys=True)
        chain_hash = hashlib.sha256(base_hash_nuvem.encode("utf-8")).hexdigest()
    else:
        chain_hash = audio_chain_mod.hash_cadeia(video_id, in_s, out_final, cadeia)
    path_ref = _ref_audio_tratado(video_id, chain_hash)

    # Cache antes de qualquer custo: hit nao localiza arquivo nem resolve fonte.
    linha = _render_cache_obter(conn, video_id, chain_hash)
    if linha is not None and linha["status"] == "ready":
        wav_ok = False
        if linha["path"] == path_ref:
            try:
                wav_ok = _wav_do_render(video_id, chain_hash).exists()
            except ValueError:
                wav_ok = False
        if wav_ok:
            return {"ok": True, "video_id": video_id, "chain_hash": chain_hash,
                    "status": "ready", "path": path_ref, "cached": True}
        _corrigir_ready_sem_arquivo(conn, video_id, chain_hash)
    elif linha is not None and linha["status"] in ("pending", "running"):
        # Mesmo render em voo: nao re-despacha nem duplica fila.
        resposta_voo = {"ok": True, "video_id": video_id, "chain_hash": chain_hash,
                        "status": linha["status"],
                        "path": path_ref if linha["path"] == path_ref else None,
                        "cached": False}
        # Pedido de IA ja na fila: a interface continua sabendo por que pending.
        if engine == ENGINE_LOCAL and _cadeia_contem_ia(audio_chain_mod, cadeia):
            resposta_voo.update({"engine": ENGINE_LOCAL, "fila": "worker_audio",
                                 "motivo": MOTIVO_FILA_IA})
        return resposta_voo

    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    fonte = _fonte_disponivel(video, video_id)
    if fonte is None:
        return {"ok": False, "video_id": video_id, "chain_hash": chain_hash,
                "status": linha["status"] if linha else None, "path": None,
                "cached": False,
                "erro": (f"Nem o original ({video.get('filepath')}) nem o proxy ({proxy_path}) "
                         "estão acessíveis. Ligue o HD do acervo ou gere o proxy do vídeo.")}

    origem = Path(video["filepath"]) if fonte == "original" else proxy_path

    if engine == ENGINE_AUPHONIC:
        # Contrato H4/H5: a rota valida, marca o motor na linha e despacha; o
        # trabalho de nuvem em si (extrair o WAV, montar algorithms com
        # montar_algorithms, submit -> poll -> fetch) e do worker de audio.
        # Marcador na chain_json no padrao do retorno DAW do watcher.py
        # ('["daw"]'): aqui vai ['auphonic', <passos...>]; analysis_json repete
        # o motor e ja leva o diag 'antes' (cache da ETAPA 1) de que o H5
        # precisa. A hash propia garante que a linha nunca recai no fluxo
        # local do worker por engano.
        cadeia_linha = [ENGINE_AUPHONIC] + list(cadeia)
        bloco_analise = {
            "antes": _diag_antes_do_cache(conn, video_id, in_s, out_final),
            "depois": None, "erro": None, "engine": ENGINE_AUPHONIC,
        }
        if override_nuvem:
            # Contrato L2->L3: o override VIAJA DENTRO deste bloco (analysis_json
            # da linha audio_render) -- o MESMO canal que ja leva o diag 'antes'
            # ao worker; a tabela nao ganhou coluna. O K3 le
            # analysis_json["algorithms_override"] e passa a montar_algorithms.
            bloco_analise["algorithms_override"] = override_nuvem
        analise_enfileirada = json.dumps(bloco_analise)
        _render_cache_gravar(conn, video_id, in_s, out_final, chain_hash,
                             cadeia_linha, path_ref, "pending", analise_enfileirada)
        despacho_worker = _despachar_worker_audio()
        resposta_nuvem = {"ok": True, "video_id": video_id, "chain_hash": chain_hash,
                          "status": "pending", "path": path_ref, "cached": False,
                          "fonte": fonte, "engine": ENGINE_AUPHONIC,
                          "cota": {"restante_min": round(float(retrato_cota_nuvem["restante_segundos"]) / 60.0, 2),
                                   "custo_estimado_min": round((out_final - in_s) / 60.0, 2),
                                   "avisar": bool(retrato_cota_nuvem["perto_do_limite"])},
                          "worker": despacho_worker}
        if override_nuvem:
            resposta_nuvem["algorithms_override"] = dict(override_nuvem)  # eco: UI confirma o que foi gravado
        return resposta_nuvem

    # ETAPA 4 chegou a rota: cadeia com o passo de IA NAO passa pelo renderizar
    # inline (ele recusa: quem executa a IA e o worker, via dividir_cadeia +
    # audio_denoise.denoisar). Vale TAMBEM para a previa de 15 s: 15 s de IA
    # custam ~21 s de maquina (0,7x tempo real) -- tempo demais para segurar o
    # HTTP; previa SEM IA continua sincrona e instantanea logo abaixo.
    # Recusa ANTES de enfileirar quando o motor de IA esta indisponivel na
    # maquina (dependencia ou modelo ausentes): trabalho que falharia minutos
    # depois nao entra na fila.
    if engine == ENGINE_LOCAL and _cadeia_contem_ia(audio_chain_mod, cadeia):
        disponibilidade = _motor_ia_do_worker()
        if not disponibilidade.get("ok"):
            raise HTTPException(
                status_code=400,
                detail=(f"Este preset usa denoise por IA, mas o motor de IA não está "
                        f"disponível nesta máquina: "
                        f"{disponibilidade.get('motivo') or 'motivo desconhecido'}. "
                        f"Nada foi enfileirado. Instale/configure o que falta (modelo "
                        f"esperado: {disponibilidade.get('caminho_modelo') or '?'}) ou "
                        f"escolha um dos presets clássicos, que rodam só com ffmpeg."))
        return _enfileirar_render_ia(conn, video_id, in_s, out_final, cadeia,
                                     chain_hash, path_ref, fonte,
                                     previa=bool(payload.previa))

    if payload.previa:
        return _render_previa_sincrona(conn, audio_chain_mod, video_id, origem,
                                       in_s, out_final, cadeia, chain_hash, path_ref)

    task_key = _task_key_render(video_id, chain_hash)
    _render_cache_gravar(conn, video_id, in_s, out_final, chain_hash, cadeia,
                         path_ref, "pending")
    TASK_MANAGER.executor.submit(_tarefa_render_audio, video_id, origem,
                                 in_s, out_final, cadeia, chain_hash, task_key)
    return {"ok": True, "video_id": video_id, "chain_hash": chain_hash,
            "status": "pending", "path": path_ref, "cached": False,
            "task_key": task_key, "fonte": fonte}


@router.get("/api/video/{video_id}/audio/render/{chain_hash}")
def status_render_audio(video_id: int, chain_hash: str,
                        conn: sqlite3.Connection = Depends(get_db_conn)):
    """Estado do render (contrato F2): status, path, progresso na tela de Tarefas
    e as analises antes/depois. O cliente faz polling deste GET apos o POST."""
    _exige_hash_valido(chain_hash)
    linha = _render_cache_obter(conn, video_id, chain_hash)
    if linha is None:
        raise HTTPException(status_code=404,
                            detail="Nenhum render encontrado para este chain_hash; poste /audio/render primeiro.")

    status = linha["status"]
    path_ref = linha["path"]
    wav_no_disco = False
    if status == "ready":
        try:
            wav_no_disco = (path_ref == _ref_audio_tratado(video_id, chain_hash)
                            and _wav_do_render(video_id, chain_hash).exists())
        except ValueError:
            wav_no_disco = False
        if not wav_no_disco:
            _corrigir_ready_sem_arquivo(conn, video_id, chain_hash)
            status = "failed"

    try:
        antes, depois, erro = _parse_analysis_render(linha)
    except ValueError as err:
        raise HTTPException(status_code=500,
                            detail=f"analysis_json de render corrompido (hash {chain_hash[:12]}): {err}")

    return {
        "ok": True, "video_id": video_id, "chain_hash": chain_hash,
        "status": status,
        "path": path_ref if wav_no_disco else None,
        "cached": wav_no_disco,
        "analise_antes": _json_seguro_para_resposta(antes),
        "analise_depois": _json_seguro_para_resposta(depois),
        "progresso": TASK_MANAGER.get_progress().get(_task_key_render(video_id, chain_hash)),
        **({"erro": erro} if (erro and status == "failed") else {}),
    }


@router.get("/api/audio/tratado/{video_id}/{chain_hash}.wav")
def servir_audio_tratado(video_id: int, chain_hash: str,
                         conn: sqlite3.Connection = Depends(get_db_conn)):
    """Serve o WAV tratado para o player (A/B do contrato F4).

    Guarda obrigatoria contra travessia de caminho: chain_hash tem de casar com
    [0-9a-f]{64} E o caminho final resolvido tem de estar dentro de
    data/audio_tratado. Fora disso e 400/404 -- nunca leitura de arquivo
    arbitrario."""
    hash_limpo = chain_hash[:-4] if chain_hash.endswith(".wav") else chain_hash
    _exige_hash_valido(hash_limpo)
    try:
        wav = _wav_do_render(video_id, hash_limpo)
    except ValueError:
        raise HTTPException(status_code=400, detail="Caminho fora de data/audio_tratado.")

    linha = _render_cache_obter(conn, video_id, hash_limpo)
    if linha is None or linha["status"] != "ready":
        raise HTTPException(status_code=404,
                            detail="Nenhum WAV tratado pronto para este chain_hash.")
    if not wav.exists():
        _corrigir_ready_sem_arquivo(conn, video_id, hash_limpo)
        raise HTTPException(status_code=404, detail="O WAV tratado não está mais no disco.")
    return FileResponse(wav, media_type="audio/wav")


@router.get("/api/audio/nuvem/cota")
def cota_audio_nuvem(project_id: int = Query(1)):
    """Retrato da cota gratuita mensal do Auphonic (contratos H4 e H6).

    E ESTA rota que a interface consulta para decidir se o radio "Auphonic"
    liga -- entao ausencia de chave NAO e erro de servidor: devolve ok=false
    com motivo legivel (e os numeros locais mesmo assim, para o title do
    botao). Toda leitura e local: JSON de consumo em data/audio_cloud mais as
    chaves audio.nuvem.* do settings_registry. Nenhuma rede acontece aqui.
    """
    from src.services.audio_cloud import ENV_FALLBACK, KEY_SETTINGS, RegistroDeCota

    tem_chave = bool(_chave_nuvem_resolvida(project_id))
    alvo_min = _setting_nuvem(project_id, "audio.nuvem.alvo_minutos_mes",
                              NUVEM_ALVO_MIN_PADRAO)
    if alvo_min <= 0:
        alvo_min = NUVEM_ALVO_MIN_PADRAO  # config quebrada: default honesto
    avisar_pct = min(max(_setting_nuvem(project_id, "audio.nuvem.avisar_em_pct",
                                        NUVEM_AVISAR_PCT_PADRAO), 0.0), 100.0)
    retrato = RegistroDeCota().status(limite_segundos=alvo_min * 60.0,
                                      perto_do_limite_a_partir=avisar_pct / 100.0)

    resposta = {
        "ok": tem_chave,
        "usados_min": round(float(retrato["usado_segundos"]) / 60.0, 2),
        "total_min": round(float(retrato["limite_segundos"]) / 60.0, 2),
        "restante_min": round(float(retrato["restante_segundos"]) / 60.0, 2),
        "avisar": bool(retrato["perto_do_limite"]),
        "mes": retrato["mes"],
        "estourado": bool(retrato["estourado"]),
    }
    if not tem_chave:
        resposta["motivo"] = (
            f"Chave do Auphonic não configurada. Cadastre-a em Configurações > "
            f"Modelos & Chaves (campo 'Chave Auphonic', chave '{KEY_SETTINGS}') ou "
            f"defina a variável de ambiente {ENV_FALLBACK}; enquanto isso o motor "
            f"de nuvem fica desligado.")
    return resposta


@router.get("/api/audio/nuvem/campos")
def campos_ajustaveis_audio_nuvem(
    video_id: Optional[int] = Query(None, description="Clipe alvo: faz a rota devolver tambem o que a medicao decidiu."),
    in_s: Optional[float] = Query(None, alias="in"),
    out_s: Optional[float] = Query(None, alias="out"),
    conn: sqlite3.Connection = Depends(get_db_conn),
):
    """Grade viva dos campos ajustáveis do Auphonic (contratos L1 e L2/L4).

    Fonte única para a interface montar a área "Ajustes da nuvem": a grade é DO
    Auphonic (SELECTs e chaves deles) e pode mudar, então nunca fica hardcoded
    no JS. Ausência de campos_ajustaveis no audio_cloud (módulo em escrita,
    instalação antiga) não é erro de servidor: devolve ok=false legível e a
    interface mantém os ajustes manuais desligados, com o automático de sempre.
    """
    grade = _grade_campos_ajustaveis()
    if not isinstance(grade, dict) or not grade:
        return {"ok": False, "total": 0, "campos": {},
                "motivo": ("A lista de ajustes da nuvem ainda não está disponível nesta "
                           "instalação (módulo audio_cloud sem 'campos_ajustaveis'). "
                           "Atualize o sistema; até lá o processamento segue 100% "
                           "automático, como hoje.")}
    resposta = {"ok": True, "total": len(grade), "campos": grade, "automatico": None}

    # Com o clipe identificado, devolvemos TAMBEM o que a medicao decidiu para
    # ele. Sem isto a interface so consegue escrever "Automatico" em cada campo,
    # e o usuario nao tem como julgar se discorda da maquina - que e o ponto
    # inteiro da tela de ajuste manual. O calculo e local e barato: reusa o
    # diagnostico ja cacheado, nunca dispara ffmpeg nem toca na rede.
    if video_id is None:
        return resposta
    try:
        from src.media import audio_analysis  # noqa: F401  (mesmo padrao das outras rotas)
        from src.services import audio_cloud
    except ImportError as err:
        resposta["motivo_automatico"] = f"Modulo de audio indisponivel: {err}"
        return resposta

    linha = _audio_cache_obter(conn, video_id, _hash_analise_audio(video_id, in_s, out_s))
    if not linha or not linha["analysis_json"]:
        resposta["motivo_automatico"] = ("Este trecho ainda nao foi analisado. Use Analisar no "
                                         "painel de diagnostico para a medicao decidir os ajustes.")
        return resposta
    try:
        diag = json.loads(linha["analysis_json"])
    except (json.JSONDecodeError, TypeError) as err:
        resposta["motivo_automatico"] = f"Diagnostico gravado ilegivel: {err}"
        return resposta

    video = MediaRepository.get_video(conn, video_id)
    alvo, teto = _alvos_nuvem_do_projeto(video.get("project_id") if video else None)
    # montar_algorithms fala o dialeto de analysis_before (lufs/tp/nf/lra/clip_pct),
    # nao o do diagnostico cru - a conversao vive no worker, entao repetimos o
    # de-para minimo aqui em vez de importar o worker dentro da rota.
    ponte = {
        "lufs": diag.get("lufs_i"),
        "tp": diag.get("true_peak_db"),
        "nf": diag.get("noise_floor_db"),
        "lra": diag.get("lra"),
        "clip_pct": (diag.get("clip_pct") or 0.0) / 100.0,
    }
    resposta["automatico"] = audio_cloud.montar_algorithms(ponte, alvo, teto)
    return resposta


# -- Glossario de audio para a interface (contrato N1) --------------------------
# Fonte unica do texto: src/nlp/audio_glossario.py (escrito em paralelo por outro
# agente). A explicacao que o icone (i) abre e a mesma que o prompt do chat embute,
# entao aqui so SERVIMOS o dicionario -- nada de texto duplicado nesta rota.
# Leitura pura em memoria: sem banco, sem disco, sem rede, porque a interface
# consulta a cada abertura do painel.

def _modulo_glossario():
    """Modulo do contrato N1, ou None quando ainda indisponivel nesta instalacao.

    Enquanto src/nlp/audio_glossario.py nao existir com as tres pecas do contrato
    (GLOSSARIO, entrada, por_secao), a rota degrada com ok=false legivel em vez de
    estourar 500 -- mesmo padrao de _grade_campos_ajustaveis() acima."""
    try:
        from src.nlp import audio_glossario
    except ImportError:
        return None
    if not callable(getattr(audio_glossario, "entrada", None)) \
            or not callable(getattr(audio_glossario, "por_secao", None)) \
            or not isinstance(getattr(audio_glossario, "GLOSSARIO", None), dict) \
            or not audio_glossario.GLOSSARIO:
        return None
    return audio_glossario


@router.get("/api/audio/glossario")
def glossario_audio(secao: Optional[str] = None):
    """Serve o glossário de áudio para a interface (contrato N1).

    GET /api/audio/glossario            -> {ok, total, entradas: {...}}
    GET /api/audio/glossario?secao=X    -> só as entradas daquela seção

    'secao' vem como query param opcional (default puro, sem wrapper Query, no
    padrão de get_failed_media_count: a função continua chamável direto nos
    testes, fora da injeção do FastAPI).

    Módulo ausente/incompleto devolve ok=false com motivo legível -- a interface
    esconde os ícones e o painel segue inteiro; nunca 500. Seção inválida é 400
    listando as válidas: isso só chega aqui por erro de código no front, e um
    painel silenciosamente vazio é mais difícil de diagnosticar do que um 400 na
    aba de rede (mesmo critério das rotas que recusam categoria/engine inválida).
    """
    modulo = _modulo_glossario()
    if modulo is None:
        return {
            "ok": False, "total": 0, "entradas": {},
            "motivo": ("O glossário de áudio não está disponível nesta instalação "
                       "(módulo 'src.nlp.audio_glossario' ausente ou incompleto). As "
                       "explicações ficam desligadas; todo o resto do painel continua "
                       "funcionando."),
        }

    if secao is not None:
        pedida = secao.strip()
        # As seções válidas saem DO dicionário vivo, nunca de lista fixa aqui: se o
        # glossário ganhar uma seção nova, esta rota acompanha sem edição.
        secoes_validas = sorted({
            item["secao"] for item in modulo.GLOSSARIO.values()
            if isinstance(item, dict) and item.get("secao")
        })
        if pedida not in secoes_validas:
            raise HTTPException(
                status_code=400,
                detail=(f"Seção '{pedida}' não existe no glossário. Seções válidas: "
                        f"{', '.join(secoes_validas)}."))
        entradas = dict(modulo.por_secao(pedida) or {})
    else:
        entradas = dict(modulo.GLOSSARIO)

    return {"ok": True, "total": len(entradas), "entradas": entradas}


# -- Waveforms de Áudio Reais (Picos Min/Max para NLE Timeline & Inspetor) ----

@router.get("/api/videos/{video_id}/waveform")
def get_video_waveform(
    video_id: int,
    force: bool = Query(False, description="Força a regeneração do cache"),
    sample_rate: int = Query(100, description="Picos por segundo (ex: 100 = 10ms por balde)"),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """
    Retorna os picos Min/Max normalizados (-1.0 a 1.0) do arquivo de áudio/vídeo.
    Lê do cache em disco ou gera instantaneamente caso ainda não exista.
    """
    from src.media.audio_waveform import get_or_generate_waveform
    data = get_or_generate_waveform(video_id, conn=conn, force=force, sample_rate=sample_rate)
    if data.get("error") and "não encontrado no banco" in str(data.get("error")):
        raise HTTPException(status_code=404, detail=data["error"])
    return data


@router.post("/api/projects/{project_id}/generate-waveforms")
def generate_project_waveforms(
    project_id: int,
    background_tasks: BackgroundTasks,
    force: bool = Query(False, description="Força a regeneração de todos os vídeos"),
    sample_rate: int = Query(100, description="Picos por segundo")
):
    """
    Gera waveforms em background para todos os vídeos cadastrados no projeto.
    Acompanhe o progresso em tempo real na aba Tarefas (GET /api/conversions).
    """
    from src.media.audio_waveform import batch_generate_project_waveforms
    task_key = f"waveforms_proj_{project_id}"
    TASK_MANAGER.update_progress(
        task_key=task_key,
        percent=0.0,
        status="running",
        task_type="waveforms",
        label=f"Waveforms do Projeto (Iniciando...)",
        log_message=f"[INIT] Solicitação de extração de waveforms para o projeto {project_id}."
    )
    background_tasks.add_task(batch_generate_project_waveforms, project_id, None, force, sample_rate)
    return {"ok": True, "task_key": task_key, "message": "Geração de waveforms do projeto iniciada em background."}


class RelinkVideoPayload(BaseModel):
    new_filepath: str


class RelinkProjectPayload(BaseModel):
    search_dir: str


@router.post("/api/video/{video_id}/relink")
def relink_video_file(
    video_id: int,
    payload: RelinkVideoPayload,
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """
    Relinca o caminho do arquivo de vídeo original com um novo arquivo no disco.
    """
    new_path = Path(payload.new_filepath)
    if not new_path.exists():
        raise HTTPException(status_code=400, detail=f"O caminho especificado não existe: {payload.new_filepath}")

    cursor = conn.cursor()
    cursor.execute("SELECT id, filename FROM video WHERE id = ?", (video_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")

    cursor.execute(
        "UPDATE video SET filepath = ?, status = 'ingested', error_message = NULL WHERE id = ?",
        (str(new_path), video_id)
    )

    # Invalida o cache de waveform para regenerar do novo arquivo
    from src.media.audio_waveform import get_waveform_cache_path
    cache_file = get_waveform_cache_path(video_id)
    if cache_file.exists():
        try:
            cache_file.unlink()
        except Exception:
            pass

    return {"ok": True, "video_id": video_id, "filepath": str(new_path), "message": "Vídeo relincado com sucesso."}


@router.post("/api/projects/{project_id}/relink")
def relink_project_media(
    project_id: int,
    payload: RelinkProjectPayload,
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """
    Varre um diretório recursivamente buscando arquivos originais para reconectar
    mídias desconectadas do projeto pelo nome de arquivo (filename).
    """
    search_path = Path(payload.search_dir)
    if not search_path.exists() or not search_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Diretório de busca inválido ou inexistente: {payload.search_dir}")

    found_files = {}
    for root, _, files in os.walk(search_path):
        for f in files:
            found_files[f.lower()] = Path(root) / f

    cursor = conn.cursor()
    cursor.execute("SELECT id, filename, filepath FROM video WHERE project_id = ?", (project_id,))
    videos = cursor.fetchall()

    relinked_videos = []
    for v in videos:
        cur_path = Path(v["filepath"]) if v["filepath"] else Path("")
        if not cur_path.exists():
            fn = (v["filename"] or "").lower()
            if fn in found_files:
                new_fpath = str(found_files[fn])
                cursor.execute(
                    "UPDATE video SET filepath = ?, status = 'ingested', error_message = NULL WHERE id = ?",
                    (new_fpath, v["id"])
                )
                relinked_videos.append({"id": v["id"], "filename": v["filename"], "new_filepath": new_fpath})
                from src.media.audio_waveform import get_waveform_cache_path
                cw = get_waveform_cache_path(v["id"])
                if cw.exists():
                    cw.unlink(missing_ok=True)

    cursor.execute("SELECT id, filename, filepath FROM photo WHERE project_id = ?", (project_id,))
    photos = cursor.fetchall()
    relinked_photos = []
    for p in photos:
        cur_path = Path(p["filepath"]) if p["filepath"] else Path("")
        if not cur_path.exists():
            fn = (p["filename"] or "").lower()
            if fn in found_files:
                new_fpath = str(found_files[fn])
                cursor.execute(
                    "UPDATE photo SET filepath = ?, status = 'ingested', error_message = NULL WHERE id = ?",
                    (new_fpath, p["id"])
                )
                relinked_photos.append({"id": p["id"], "filename": p["filename"], "new_filepath": new_fpath})

    return {
        "ok": True,
        "project_id": project_id,
        "search_dir": str(search_path),
        "relinked_videos_count": len(relinked_videos),
        "relinked_photos_count": len(relinked_photos),
        "total_relinked": len(relinked_videos) + len(relinked_photos),
        "relinked_videos": relinked_videos,
        "relinked_photos": relinked_photos
    }
