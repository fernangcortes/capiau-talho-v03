"""Roteador FastAPI para gerenciamento de Mídias, Ingestão, Conversões e Visão."""
import os
import json
import sqlite3
import subprocess
import cv2
import numpy as np
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import JSONResponse

from src.config import CONFIG
from src.db.connection import get_db
from src.api.dependencies import get_db_conn
from src.api.schemas import ExternalPathIngest, LabelFacePayload, MergeClustersPayload, ReassignFacesPayload
from src.db.repositories.media import MediaRepository
from src.core.tasks import TASK_MANAGER, read_worker_progress
from src.services.ingest import IngestService
from src.services.pipeline import PipelineService
from src.services.burst_service import group_photo_bursts, replicate_to_members
from src.services.vision_batch import run_vision_batch
from src.search.semantic import SemanticSearch

router = APIRouter(tags=["Media & Ingestion"])

@router.get("/api/videos")
def list_videos(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Lista todos os vídeos cadastrados no projeto."""
    videos = MediaRepository.list_videos(conn, project_id)
    for v in videos:
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
    results = []

    try:
        if payload.search_type == "textual":
            from src.search.semantic import SemanticSearch
            data = SemanticSearch.get_instance().similar_to_multiple_items(
                payload.project_id, items_list, media_type_filter=media_filter, limit=payload.limit
            )

            cursor = conn.cursor()
            for h in data["results"]:
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
            from src.search.image_semantic import ImageSearch
            # interview/broll: o Qdrant visual não distingue o tipo do vídeo — pede um
            # lote maior e refina pelo SQLite abaixo, para não voltar menos que o limit
            fetch_limit = payload.limit * 3 if media_filter in ("interview", "broll") else payload.limit
            data = ImageSearch.get_instance().similar_to_multiple_items(
                payload.project_id, items_list, media_type_filter=media_filter, limit=fetch_limit
            )

            # _enrich_image_hits reconstrói os hits: preserva best_source pela ordem
            enriched_hits = _enrich_image_hits(conn, data["results"])
            for enriched, original in zip(enriched_hits, data["results"]):
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

    return {
        "results": results[:payload.limit],
        "mode_used": data.get("mode_used", "media"),
        "cohesion": data.get("cohesion", 0.0),
        "warnings": data.get("warnings", []),
    }

@router.get("/api/media/photo/{photo_id}/similar")
def photo_similar(photo_id: int, project_id: int = Query(1), limit: int = Query(12), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Fotos visualmente próximas via CLIP local (E2.B6)."""
    from src.search.image_semantic import ImageSearch
    hits = ImageSearch.get_instance().similar_to_photo(project_id, photo_id, limit=limit)
    results = _enrich_image_hits(conn, hits)
    for r in results:
        r["explanation"] = "Aparência parecida com a foto de origem — composição, cores e enquadramento (CLIP local)."
    return {"photo_id": photo_id, "results": results}

@router.get("/api/media/video/{video_id}/similar")
def video_similar(video_id: int, project_id: int = Query(1), timestamp: float = Query(0.0), limit: int = Query(12), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Trechos/fotos visualmente próximos do keyframe indexado mais perto do timestamp (E2.B6)."""
    from src.search.image_semantic import ImageSearch
    hits = ImageSearch.get_instance().similar_to_video_moment(project_id, video_id, timestamp=timestamp, limit=limit)
    results = _enrich_image_hits(conn, hits)
    moment = f"{int(timestamp // 60):02d}:{int(timestamp % 60):02d}"
    for r in results:
        r["explanation"] = f"Aparência parecida com o frame de {moment} do vídeo de origem — composição, cores e enquadramento (CLIP local)."
    return {"video_id": video_id, "timestamp": timestamp, "results": results}

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
def get_all_conversions():
    """Retorna o progresso em tempo real das conversões de vídeo/foto em execução.

    Inclui o progresso do worker de lote, que roda FORA deste processo — sem essa
    fusão a tela de Tarefas ficaria vazia durante toda a rodada do acervo.
    """
    progress = TASK_MANAGER.get_progress()
    progress.update(read_worker_progress())
    return progress

@router.post("/api/video/{video_id}/cancel-conversion")
def cancel_conversion(video_id: int):
    """Cancela o processo ativo de codificação de proxy de um vídeo."""
    success = TASK_MANAGER.cancel_process(video_id)
    TASK_MANAGER.update_progress(str(video_id), 0.0, "cancelled")
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    if success:
        return {"status": "success", "message": f"Conversão do vídeo ID {video_id} cancelada."}
    raise HTTPException(status_code=400, detail="Nenhuma conversão ativa rodando para este vídeo.")

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
    """Retorna o thumbnail do vídeo. Se não existir, gera a partir de 10% da duração."""
    from fastapi.responses import FileResponse
    from src.media.ffmpeg import extract_frame
    
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return FileResponse(thumb_path)
        
    # Se não existe, busca metadados do vídeo para gerar
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    video_path = Path(video['filepath'])
    if not video_path.exists():
        # Tenta com o proxy de vídeo se o original não existir
        proxy_rel = f"proxy_vid_{video_id}.mp4"
        proxy_path = CONFIG.PROXIES_DIR / proxy_rel
        if proxy_path.exists():
            video_path = proxy_path
        else:
            raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado: {video_path}")
        
    duration = video.get('duration') or 0.0
    # Gera a 10% do tempo (ou a 1.0s de fallback)
    target_time = max(1.0, duration * 0.1)
    
    success = extract_frame(video_path, target_time, thumb_path)
    if success and thumb_path.exists():
        return FileResponse(thumb_path)
        
    raise HTTPException(status_code=500, detail="Não foi possível gerar a miniatura do vídeo.")


@router.post("/api/video/{video_id}/thumbnail")
def set_video_thumbnail(video_id: int, timestamp: float = Query(...), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Extrai e define uma miniatura específica no timestamp fornecido."""
    from src.media.ffmpeg import extract_frame
    
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    video_path = Path(video['filepath'])
    if not video_path.exists():
        # Tenta com o proxy de vídeo se o original não existir
        proxy_rel = f"proxy_vid_{video_id}.mp4"
        proxy_path = CONFIG.PROXIES_DIR / proxy_rel
        if proxy_path.exists():
            video_path = proxy_path
        else:
            raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado: {video_path}")
        
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
    success = extract_frame(video_path, timestamp, thumb_path)
    if success and thumb_path.exists():
        return {"status": "success", "message": "Miniatura atualizada com sucesso."}
        
    raise HTTPException(status_code=500, detail="Falha ao extrair frame no timestamp fornecido.")


@router.get("/api/video/{video_id}/thumbnail-at")
def get_video_thumbnail_at(video_id: int, time: float = Query(...), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna o thumbnail do vídeo no timestamp fornecido (com cache progressivo)."""
    from fastapi.responses import FileResponse
    from src.media.ffmpeg import extract_thumbnail_frame
    
    # O nome do arquivo segue o padrão de índice baseado no tempo arredondado (1 frame por segundo)
    file_idx = int(round(time)) + 1
    thumb_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_{file_idx:04d}.jpg"
    
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return FileResponse(thumb_path)
        
    # Se não existir, extrai na hora
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        
    video_path = Path(video['filepath'])
    if not video_path.exists():
        proxy_rel = f"proxy_vid_{video_id}.mp4"
        proxy_path = CONFIG.PROXIES_DIR / proxy_rel
        if proxy_path.exists():
            video_path = proxy_path
        else:
            raise HTTPException(status_code=404, detail=f"Arquivo original/proxy não encontrado: {video_path}")
            
    # Dispara a geração progressiva de miniaturas em segundo plano apenas se ainda não foi iniciada (não está no progresso)
    task_key = f"thumbs-{video_id}"
    if task_key not in TASK_MANAGER.get_progress():
        duration = video.get('duration') or 0.0
        if duration > 0:
            TASK_MANAGER.executor.submit(
                IngestService._generate_timeline_thumbnails_task,
                video_id, video_path, duration
            )
            
    success = extract_thumbnail_frame(video_path, time, thumb_path, width=120)
    if success and thumb_path.exists():
        return FileResponse(thumb_path)

    # Fallback para thumbnail genérica do vídeo se a extração no tempo falhar
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
        
    video_path = Path(video['filepath'])
    if not video_path.exists():
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        if proxy_path.exists():
            video_path = proxy_path
            
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


@router.delete("/api/task/{task_key}")
def dismiss_task(task_key: str):
    """Remove a tarefa da lista de progresso/tarefas em segundo plano."""
    TASK_MANAGER.remove_progress(task_key)
    return {"status": "success", "message": f"Tarefa {task_key} removida."}


@router.post("/api/editor/heartbeat")
def editor_heartbeat():
    """Reporta atividade do usuário no editor para desacelerar tarefas de segundo plano."""
    TASK_MANAGER.report_user_activity()
    return {"status": "success", "user_active": TASK_MANAGER.is_user_active()}


