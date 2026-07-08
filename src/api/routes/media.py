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
from src.core.tasks import TASK_MANAGER
from src.services.ingest import IngestService
from src.services.pipeline import PipelineService
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
        WHERE project_id = ? AND status != 'transcribed' AND video_type IN ('interview', 'broll')
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
def trigger_vision_video(video_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Inicia a decupagem visual multimodal do B-roll via OpenRouter Vision."""
    video = MediaRepository.get_video(conn, video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
    filepath = Path(video['filepath'])
    duration = video['duration']
    
    background_tasks.add_task(PipelineService.analyze_video_vision, video_id, filepath, duration)
    return {"status": "success", "message": "Decupagem visual do B-roll iniciada."}

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
    """Analisa de forma assíncrona todas as mídias pendentes ou todas (se force=True) de visão, aplicando detecção facial e burst-sequencing de fotos."""
    cursor = conn.cursor()
    if force:
        cursor.execute("SELECT id, filepath, duration FROM video WHERE project_id = ? AND video_type = 'broll'", (project_id,))
        video_rows = cursor.fetchall()
        
        cursor.execute("SELECT id, filepath FROM photo WHERE project_id = ?", (project_id,))
        photo_rows = cursor.fetchall()
    else:
        cursor.execute("SELECT id, filepath, duration FROM video WHERE project_id = ? AND video_type = 'broll' AND status IN ('ingested', 'analyzing', 'error')", (project_id,))
        video_rows = cursor.fetchall()
        
        cursor.execute("SELECT id, filepath FROM photo WHERE project_id = ? AND status IN ('ingested', 'pending', 'error')", (project_id,))
        photo_rows = cursor.fetchall()
    
    def bg_vision_all():
        # 1. Processa B-rolls
        for v in video_rows:
            try:
                PipelineService.analyze_video_vision(v['id'], Path(v['filepath']), v['duration'])
            except Exception as e:
                print(f"[VisionBatch] Erro no vídeo ID {v['id']}: {e}")
                
        # 2. Processa fotos sequencialmente
        photos_with_time = []
        for p in photo_rows:
            path = Path(p['filepath'])
            mtime = path.stat().st_mtime if path.exists() else 0.0
            photos_with_time.append({
                "id": p["id"],
                "filepath": path,
                "mtime": mtime,
                "parent_dir": str(path.parent)
            })
            
        photos_with_time.sort(key=lambda x: (x["parent_dir"], x["mtime"]))
        last_analyzed = None
        
        for p in photos_with_time:
            photo_id = p["id"]
            filepath = p["filepath"]
            
            # Detecta burst sequencial (fotos tiradas no mesmo diretório com intervalo menor que 5s)
            is_sequence = False
            if last_analyzed and last_analyzed["parent_dir"] == p["parent_dir"]:
                time_diff = abs(p["mtime"] - last_analyzed["mtime"])
                if time_diff < 5.0:
                    is_sequence = True
                    
            if is_sequence:
                # Reutiliza metadados para economizar tokens
                try:
                    with get_db() as con:
                        cur = con.cursor()
                        cur.execute("SELECT description, tags FROM photo WHERE id = ?", (last_analyzed["id"],))
                        row = cur.fetchone()
                        if row:
                            desc = f"{row[0]} (Foto em sequência)"
                            tags = json.loads(row[1]) if row[1] else []
                            
                            MediaRepository.update_photo_analysis(con, photo_id, desc, tags)
                            
                            # Indexa no Qdrant
                            search_engine = SemanticSearch.get_instance()
                            search_engine.index_photo_description(project_id, photo_id, desc, tags)
                            con.commit()
                except Exception as ex:
                    print(f"[VisionBatch] Falha ao replicar metadados da foto {photo_id}: {ex}")
            else:
                try:
                    PipelineService.analyze_photo_vision(photo_id, filepath)
                    last_analyzed = p
                except Exception as ex:
                    print(f"[VisionBatch] Falha na análise da foto {photo_id}: {ex}")
                    
    background_tasks.add_task(bg_vision_all)
    return {"status": "success", "message": "Análise visual em lote iniciada em background."}

@router.get("/api/conversions")
def get_all_conversions():
    """Retorna o progresso em tempo real das conversões de vídeo/foto em execução."""
    return TASK_MANAGER.get_progress()

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


