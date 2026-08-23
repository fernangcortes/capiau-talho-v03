"""Roteador FastAPI para gerenciamento de Mídias, Ingestão, Conversões e Visão."""
import os
import json
import re
import sqlite3
import subprocess
import sys
import time
import cv2
import numpy as np
from pathlib import Path
from typing import Optional, List
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

# ── E2.C2: Fila de revisão de triagem + correção de categoria ────────────────

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

    ⚠️ Rodar acervo inteiro por aqui derruba a interface: o lote consome o GIL
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

    # Não exibível no browser (RAW/TIFF/HEIC…) → proxy webp
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



