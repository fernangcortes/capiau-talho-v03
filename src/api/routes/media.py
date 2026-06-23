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
def trigger_vision_photo(photo_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Inicia a análise visual e tags por IA da foto bastidores."""
    photo = MediaRepository.get_photo(conn, photo_id)
    if not photo:
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    filepath = Path(photo['filepath'])
    
    background_tasks.add_task(PipelineService.analyze_photo_vision, photo_id, filepath)
    return {"status": "success", "message": "Análise visual da foto de set iniciada."}

@router.post("/api/project/{project_id}/analyze-all-vision")
def trigger_all_vision(project_id: int, background_tasks: BackgroundTasks, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Analisa de forma assíncrona todas as mídias pendentes de visão, aplicando detecção facial e burst-sequencing de fotos."""
    cursor = conn.cursor()
    cursor.execute("SELECT id, filepath, duration FROM video WHERE project_id = ? AND video_type = 'broll' AND status IN ('ingested', 'error')", (project_id,))
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

@router.post("/api/face/{face_id}/label")
def label_face(face_id: int, payload: LabelFacePayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Rotula um rosto específico. Propaga em lote para o cluster, com detecção de conflitos."""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id, cluster_id, name FROM face WHERE id = ?", (face_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Face não encontrada.")
            
        project_id = row["project_id"]
        current_cluster_id = row["cluster_id"]
        new_name = payload.name.strip()
        
        if not new_name:
            # Limpar nome se vazio
            cursor.execute("UPDATE face SET name = NULL WHERE id = ?", (face_id,))
            conn.commit()
            return {"status": "success", "message": "Rótulo removido."}
            
        # Se a face faz parte de um cluster, verificar se o novo nome já pertence a OUTRO cluster
        if current_cluster_id is not None and current_cluster_id >= 0:
            cursor.execute("""
                SELECT DISTINCT cluster_id FROM face 
                WHERE project_id = ? AND name = ? AND cluster_id != ? AND cluster_id >= 0
            """, (project_id, new_name, current_cluster_id))
            conflict_row = cursor.fetchone()
            
            if conflict_row:
                other_cluster_id = conflict_row["cluster_id"]
                return {
                    "status": "conflict",
                    "message": f"O nome '{new_name}' já está associado a outro grupo de rostos (Grupo {other_cluster_id + 1}).",
                    "current_cluster_id": current_cluster_id,
                    "existing_cluster_id": other_cluster_id,
                    "target_name": new_name
                }
                
            # Sem conflitos: atualizar todas as faces do mesmo cluster
            cursor.execute("""
                UPDATE face SET name = ? WHERE project_id = ? AND cluster_id = ?
            """, (new_name, project_id, current_cluster_id))
            conn.commit()
            return {
                "status": "success", 
                "message": f"Todas as faces do Grupo {current_cluster_id + 1} foram rotuladas como '{new_name}'."
            }
        else:
            # Rosto isolado/ruído: atualizar apenas este rosto individualmente
            cursor.execute("UPDATE face SET name = ? WHERE id = ?", (new_name, face_id))
            conn.commit()
            return {"status": "success", "message": f"Rosto ID {face_id} rotulado individualmente como '{new_name}'."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/video/{video_id}/faces")
def get_video_faces(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna todos os rostos identificados nos frames do vídeo."""
    faces = MediaRepository.get_video_faces(conn, video_id)
    for f in faces:
        try:
            f['bounding_box'] = json.loads(f['bounding_box']) if f.get('bounding_box') else []
        except Exception:
            pass
    return faces

@router.get("/api/photo/{photo_id}/faces")
def get_photo_faces(photo_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna todos os rostos detectados em uma foto bastidores."""
    faces = MediaRepository.get_photo_faces(conn, photo_id)
    for f in faces:
        try:
            f['bounding_box'] = json.loads(f['bounding_box']) if f.get('bounding_box') else []
        except Exception:
            pass
    return faces

@router.get("/api/project/{project_id}/speakers")
def get_project_speakers(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Agrega e ordena uma lista consolidada de falantes diarizados e rostos rotulados."""
    return MediaRepository.get_project_speakers_and_labeled_faces(conn, project_id)

@router.get("/api/project/{project_id}/face-clusters")
def list_project_face_clusters(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Lista todos os grupos de rostos agrupados no projeto."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                cluster_id,
                name,
                MIN(id) as rep_face_id,
                COUNT(*) as occurrences
            FROM face
            WHERE project_id = ? AND cluster_id IS NOT NULL AND cluster_id >= 0
            GROUP BY cluster_id, name
            ORDER BY occurrences DESC
        """, (project_id,))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/project/{project_id}/unlabeled-faces")
def list_unlabeled_faces(project_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna rostos que não foram rotulados (ou possuem placeholders genéricos) para desambiguação rápida."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, bounding_box, photo_id, video_id, timestamp, name, cluster_id
            FROM face
            WHERE project_id = ? AND (name IS NULL OR name LIKE 'Pessoa Desconhecida%')
            ORDER BY cluster_id DESC, id DESC
            LIMIT 100
        """, (project_id,))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/project/{project_id}/face-clusters/{cluster_id}/faces")

def list_cluster_faces(project_id: int, cluster_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna todas as faces individuais pertencentes a um cluster específico."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, bounding_box, photo_id, video_id, timestamp, name 
            FROM face 
            WHERE project_id = ? AND cluster_id = ?
        """, (project_id, cluster_id))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/project/{project_id}/faces/cluster")
def cluster_project_faces(project_id: int, eps: float = 0.38, min_samples: int = 3):
    """Dispara o agrupamento DBSCAN local de rostos no projeto."""
    from src.vision.face_engine import cluster_faces_dbscan
    return cluster_faces_dbscan(project_id, eps, min_samples)

@router.post("/api/project/{project_id}/faces/merge")
def merge_project_clusters(project_id: int, payload: MergeClustersPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Mescla duas classes de clusters de faces (Resolução de conflito: fusão total)."""
    try:
        from src.vision.face_engine import merge_clusters
        merge_clusters(project_id, payload.src_cluster_id, payload.dest_cluster_id, payload.name)
        return {"status": "success", "message": f"Clusters mesclados com sucesso sob o nome '{payload.name}'."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/project/{project_id}/faces/reassign")
def reassign_project_faces(project_id: int, payload: ReassignFacesPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Reatribui faces de forma unitária (Resolução de conflito: desambiguação manual)."""
    try:
        from src.vision.face_engine import reassign_faces
        reassign_faces(project_id, payload.face_ids, payload.target_cluster_id, payload.target_name)
        return {"status": "success", "message": f"{len(payload.face_ids)} faces reatribuídas com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/face/{face_id}/thumbnail")
def get_face_thumbnail(face_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Corta dinamicamente e retorna o thumbnail JPEG da face."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT f.bounding_box, f.photo_id, f.video_id, f.timestamp, 
                   p.filepath as photo_path, v.filepath as video_path
            FROM face f
            LEFT JOIN photo p ON f.photo_id = p.id
            LEFT JOIN video v ON f.video_id = v.id
            WHERE f.id = ?
        """, (face_id,))
        row = cursor.fetchone()
        
        if not row or not row["bounding_box"]:
            raise HTTPException(status_code=404, detail="Face ou bounding box não encontrada.")
            
        bbox = json.loads(row["bounding_box"])
        rx, ry, rw, rh = bbox
        
        img_path = None
        temp_frame_path = None
        
        if row["photo_id"] is not None:
            img_path = Path(row["photo_path"])
            if not img_path.exists():
                img_path = Path("c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP") / img_path
        elif row["video_id"] is not None:
            video_path = Path(row["video_path"])
            if not video_path.exists():
                video_path = Path("c:/Users/FGC/Desktop/Capiau-Talho-Kimi_MVP") / video_path
                
            if video_path.exists():
                from src.vision.multimodal_engine import extract_frame_ffmpeg
                temp_dir = CONFIG.CACHE_DIR / "temp_crops"
                temp_dir.mkdir(exist_ok=True, parents=True)
                temp_frame_path = temp_dir / f"crop_vid_{row['video_id']}_ts_{int(row['timestamp'])}s.jpg"
                
                success = extract_frame_ffmpeg(video_path, row["timestamp"], temp_frame_path)
                if success and temp_frame_path.exists():
                    img_path = temp_frame_path
                    
        if not img_path or not img_path.exists():
            raise HTTPException(status_code=404, detail="Arquivo de mídia de origem não encontrado.")
            
        img = cv2.imread(str(img_path))
        if img is None:
            raise HTTPException(status_code=500, detail="Erro ao carregar imagem.")
            
        height, width = img.shape[:2]
        
        # Adiciona margem de 15% para contexto visual do rosto
        margin = 0.15
        x = int((rx - margin * rw) * width)
        y = int((ry - margin * rh) * height)
        w = int((rw + 2 * margin * rw) * width)
        h = int((rh + 2 * margin * rh) * height)
        
        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(width, x + w), min(height, y + h)
        
        crop_img = img[y1:y2, x1:x2]
        if crop_img.size == 0:
            crop_img = img
            
        crop_img = cv2.resize(crop_img, (96, 96))
        
        retval, buf = cv2.imencode(".jpg", crop_img)
        if not retval:
            raise HTTPException(status_code=500, detail="Erro ao codificar thumbnail.")
            
        if temp_frame_path and temp_frame_path.exists():
            try:
                temp_frame_path.unlink()
            except Exception:
                pass
                
        from fastapi.responses import Response
        return Response(content=buf.tobytes(), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

