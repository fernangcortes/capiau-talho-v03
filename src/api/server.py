"""Servidor REST FastAPI para controle de pipeline e comunicação com a UI Web."""
import os
import sys
import json
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import get_connection, add_relation, get_themes
from src.ingest.watcher import scan_watch_folder, ingest_file
from src.transcription.asr_engine import transcribe_video_api
from src.vision.multimodal_engine import analyze_broll_video, analyze_set_photo
from src.nlp.theme_cluster import extract_makingof_themes
from src.search.semantic import SemanticSearch
from src.export.otio_export import export_timeline_file

import logging

class EndpointFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Silenciar logs para as rotas de polling periódico no console do Uvicorn
        msg = record.getMessage()
        return "/api/conversions" not in msg and "/api/videos" not in msg

# Adicionar o filtro ao logger de acesso do uvicorn
logging.getLogger("uvicorn.access").addFilter(EndpointFilter())

# Inicializar bancos físicos no startup
from src.db.operations import reset_stuck_tasks
init_db()
reset_stuck_tasks()

app = FastAPI(
    title="CaIAu Talho — Motor de Inteligência Cinematográfica",
    description="Backend de processamento inteligente híbrido para Making Of e Documentários.",
    version="1.0"
)

# Habilitar CORS para desenvolvimento
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modelos Pydantic para requisições
class ProjectCreate(BaseModel):
    name: str
    description: str = ""

class ExternalPathIngest(BaseModel):
    path: str
    project_id: int = 1


class CutItem(BaseModel):
    video_id: int
    in_time: float # renomeado de 'in' por ser palavra reservada em Python
    out_time: float # renomeado de 'out'
    track: str = "V1"

class TimelineCreate(BaseModel):
    name: str
    description: str = ""
    cuts: List[CutItem]
    project_id: int = 1

# ── Endpoints de Projetos e Mídias ───────────────────────────


@app.post("/api/projects")
def create_project(project: ProjectCreate):
    """Cria um novo projeto de documentário."""
    from src.db.operations import add_project
    try:
        project_id = add_project(project.name, project.description)
        return {"status": "success", "project_id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects")
def list_projects():
    """Retorna a lista de todos os projetos cadastrados."""
    from src.db.operations import get_projects
    return get_projects()

@app.delete("/api/projects/{project_id}")
def remove_project(project_id: int):
    """Remove um projeto e todas as suas mídias de forma física em cascata."""
    from src.db.operations import delete_project
    try:
        delete_project(project_id)
        return {"status": "success", "message": f"Projeto {project_id} deletado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/videos")
def list_videos(project_id: int = Query(1)):
    """Retorna a lista de vídeos cadastrados do projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM video WHERE project_id = ? ORDER BY id DESC", (project_id,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

@app.get("/api/photos")
def list_photos(project_id: int = Query(1)):
    """Retorna a lista de fotos cadastradas do projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM photo WHERE project_id = ? ORDER BY id DESC", (project_id,))
        rows = [dict(r) for r in cursor.fetchall()]
        # Adicionar o caminho do proxy para cada foto se ele existir no disco
        for row in rows:
            photo_id = row['id']
            proxy_relative_path = f"photos/proxy_photo_{photo_id}.webp"
            proxy_full_path = CONFIG.PROXIES_DIR / proxy_relative_path
            if proxy_full_path.exists():
                row['proxy_path'] = f"/proxies/{proxy_relative_path}"
            else:
                row['proxy_path'] = None
            
            # Desserializar as tags do SQLite (salvas como string JSON)
            if row.get('tags'):
                try:
                    row['tags'] = json.loads(row['tags'])
                except Exception:
                    row['tags'] = []
            else:
                row['tags'] = []
        return rows
    finally:
        conn.close()


@app.get("/api/video/{video_id}/transcript")
def get_transcript(video_id: int):
    """Retorna os blocos de falas de um depoimento específico junto com as palavras individuais."""
    from src.db.operations import get_video_transcript, get_video_transcript_words
    dialogues = get_video_transcript(video_id)
    words = get_video_transcript_words(video_id)
    return {"video_id": video_id, "dialogues": dialogues, "words": words}

@app.get("/api/video/{video_id}/vision")
def get_video_vision(video_id: int, project_id: int = Query(1)):
    """Retorna a descrição visual real de frames de bastidores armazenados no Qdrant."""
    search_engine = SemanticSearch.get_instance()
    try:
        frames = search_engine.get_video_vision_frames(project_id, video_id)
        return {"video_id": video_id, "frames": frames}
    except Exception as e:
        return {"video_id": video_id, "frames": []}


# ── Endpoints de Processamento e Pipeline (Assíncronos) ───────

@app.post("/api/ingest/select-folder")
def select_folder_dialog():
    """Abre uma caixa de diálogo nativa do Windows para seleção de diretório."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw() # Oculta a janela principal do Tkinter
        root.attributes('-topmost', True) # Garante que o diálogo fique por cima do navegador!
        folder_path = filedialog.askdirectory(parent=root, title="Selecione a Pasta de Mídias (HD/Pasta Externa)")
        root.destroy()
        if folder_path:
            # Padroniza barras para evitar problemas com JSON e caminhos
            folder_path = folder_path.replace('\\', '/')
            return {"status": "success", "path": folder_path}
        return {"status": "cancelled", "path": ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao abrir seletor nativo: {str(e)}")

@app.post("/api/ingest/external")
def trigger_external_ingest(payload: ExternalPathIngest, background_tasks: BackgroundTasks):
    """Dispara uma ingestão assíncrona baseada em link (in-place) para uma pasta ou arquivo externo."""
    from src.ingest.watcher import ingest_external_path
    
    path_obj = Path(payload.path)
    if not path_obj.exists():
        raise HTTPException(status_code=404, detail="O caminho do arquivo ou diretório especificado não existe.")
        
    def bg_task():
        print(f"[API] Iniciando ingestão externa in-place de: {payload.path}")
        res = ingest_external_path(path_obj, payload.project_id)
        print(f"[API] Ingestão concluída: {res['ingested_count']} mídias adicionadas.")
        
    background_tasks.add_task(bg_task)
    return {
        "status": "success",
        "message": f"Ingestão externa in-place iniciada para o projeto {payload.project_id}."
    }



@app.post("/api/video/{video_id}/transcribe")
def trigger_transcribe(video_id: int, background_tasks: BackgroundTasks):
    """Dispara o processo de transcrição AssemblyAI (ASR) em background."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filepath FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        filepath = Path(row['filepath'])
    finally:
        conn.close()
        
    background_tasks.add_task(transcribe_video_api, video_id, filepath)
    return {"status": "success", "message": "Transcrição ASR iniciada em background."}

@app.post("/api/project/{project_id}/transcribe-all")
def trigger_transcribe_all(project_id: int, background_tasks: BackgroundTasks):
    """Dispara o processo de transcrição em lote para todos os vídeos elegíveis do projeto (não transcritos)."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filepath, filename FROM video WHERE project_id = ? AND status != 'transcribed' AND video_type IN ('interview', 'broll')", (project_id,))
        rows = cursor.fetchall()
        if not rows:
            return {"status": "success", "message": "Todos os vídeos elegíveis já possuem transcrições.", "count": 0}
        videos_to_transcribe = [(r['id'], Path(r['filepath'])) for r in rows]
    finally:
        conn.close()
        
    def transcribe_all_task():
        print(f"[ASR_BATCH] Iniciando lote de transcrição com {len(videos_to_transcribe)} vídeos para o projeto {project_id}")
        for vid_id, filepath in videos_to_transcribe:
            try:
                transcribe_video_api(vid_id, filepath)
            except Exception as e:
                print(f"[ASR_BATCH] Erro no vídeo ID {vid_id}: {e}")
                
    background_tasks.add_task(transcribe_all_task)
    return {
        "status": "success",
        "message": f"Transcrição em lote de {len(videos_to_transcribe)} vídeos iniciada em background.",
        "count": len(videos_to_transcribe)
    }

@app.post("/api/video/{video_id}/analyze-vision")
def trigger_vision_video(video_id: int, background_tasks: BackgroundTasks):
    """Dispara a extração e descrição visual do B-Roll em background."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filepath, duration FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        filepath = Path(row['filepath'])
        duration = row['duration']
    finally:
        conn.close()
        
    background_tasks.add_task(analyze_broll_video, video_id, filepath, duration)
    return {"status": "success", "message": "Análise visual do B-Roll iniciada."}

@app.post("/api/photo/{photo_id}/analyze-vision")
def trigger_vision_photo(photo_id: int, background_tasks: BackgroundTasks):
    """Dispara a descrição da foto de set em nuvem."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filepath FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Foto não encontrada.")
        filepath = Path(row['filepath'])
    finally:
        conn.close()
        
    background_tasks.add_task(analyze_set_photo, photo_id, filepath)
    return {"status": "success", "message": "Análise da foto de set iniciada."}

ACTIVE_CLUSTERING = set()

@app.post("/api/project/cluster-themes")
def trigger_clustering(background_tasks: BackgroundTasks, project_id: int = Query(1)):
    """Processa o clustering temático de falas."""
    ACTIVE_CLUSTERING.add(project_id)
    
    def run_clustering():
        try:
            extract_makingof_themes(project_id)
        finally:
            ACTIVE_CLUSTERING.discard(project_id)
            
    background_tasks.add_task(run_clustering)
    return {"status": "success", "message": f"Processamento de temas iniciado para projeto {project_id}."}


# ── Endpoints de Busca e Inteligência ────────────────────────

@app.get("/api/search")
def search_media(query: str = Query(..., min_length=1), project_id: int = Query(1), media_type: Optional[str] = None):
    """Busca híbrida inteligente cruzando metadados relacionais do SQLite (falantes, rostos) e Qdrant."""
    search_engine = SemanticSearch.get_instance()
    
    # 1. Buscar rostos rotulados com este nome no SQLite
    conn = get_connection()
    face_results = []
    speaker_results = []
    try:
        cursor = conn.cursor()
        
        # Buscar fotos com rosto rotulado
        if not media_type or media_type == "photo":
            cursor.execute("""
                SELECT f.id as face_id, f.photo_id, p.filename, p.filepath, p.description, p.tags
                FROM face f
                JOIN photo p ON f.photo_id = p.id
                WHERE f.project_id = ? AND f.name LIKE ?
            """, (project_id, f"%{query}%"))
            photo_rows = cursor.fetchall()
            for pr in photo_rows:
                face_results.append({
                    "score": 1.0,
                    "payload": {
                        "media_type": "photo",
                        "photo_id": pr["photo_id"],
                        "filename": pr["filename"],
                        "filepath": pr["filepath"],
                        "text": f"Rosto de {query} identificado nesta foto de bastidores. Descrição: {pr['description'] or ''}",
                        "tags": json.loads(pr["tags"]) if pr["tags"] else []
                    }
                })
            
        # Buscar vídeos com rosto rotulado
        if not media_type or media_type in ["video", "broll"]:
            cursor.execute("""
                SELECT f.id as face_id, f.video_id, f.timestamp, v.filename, v.filepath, v.description, v.tags
                FROM face f
                JOIN video v ON f.video_id = v.id
                WHERE f.project_id = ? AND f.name LIKE ?
            """, (project_id, f"%{query}%"))
            video_face_rows = cursor.fetchall()
            for vr in video_face_rows:
                face_results.append({
                    "score": 1.0,
                    "payload": {
                        "media_type": "broll",
                        "video_id": vr["video_id"],
                        "filename": vr["filename"],
                        "filepath": vr["filepath"],
                        "start_time": max(0.0, vr["timestamp"] - 3.0),
                        "end_time": vr["timestamp"] + 7.0,
                        "text": f"Rosto de {query} identificado no timecode {vr['timestamp']}s nestes bastidores.",
                        "tags": json.loads(vr["tags"]) if vr["tags"] else []
                    }
                })

        # Buscar falas do falante (speaker_id) no SQLite
        if not media_type or media_type in ["video", "interview"]:
            cursor.execute("""
                SELECT DISTINCT video_id, speaker_id, MIN(start_time) as min_start, MAX(end_time) as max_end
                FROM transcript
                WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) AND speaker_id LIKE ?
                GROUP BY video_id, speaker_id
            """, (project_id, f"%{query}%"))
            speaker_rows = cursor.fetchall()
            for sr in speaker_rows:
                cursor.execute("""
                    SELECT word, start_time, end_time FROM transcript
                    WHERE video_id = ? AND speaker_id = ?
                    ORDER BY start_time LIMIT 25
                """, (sr["video_id"], sr["speaker_id"]))
                words = cursor.fetchall()
                phrase = " ".join([w["word"] for w in words])
                
                speaker_results.append({
                    "score": 0.95,
                    "payload": {
                        "media_type": "interview",
                        "video_id": sr["video_id"],
                        "speaker_id": sr["speaker_id"],
                        "start_time": sr["min_start"],
                        "end_time": sr["max_end"],
                        "text": f"Depoimento de {sr['speaker_id']}: \"{phrase}...\""
                    }
                })
    except Exception as db_err:
        print(f"[SEARCH_ENHANCEMENT] Erro ao estender busca com SQLite: {db_err}")
    finally:
        conn.close()

    # 2. Executar a busca semântica no Qdrant
    results = []
    try:
        results = search_engine.search(project_id, query, media_type=media_type, limit=12)
    except Exception as qdrant_err:
        print(f"[SEARCH_QDRANT] Erro na busca Qdrant: {qdrant_err}")
        
    # 3. Mesclar resultados e remover duplicados por ID de mídia/tipo
    seen_media = set()
    final_results = []
    
    # Adicionar matches de rosto/falante primeiro (prioridade)
    for r in face_results + speaker_results:
        media_id = r["payload"].get("photo_id") or r["payload"].get("video_id") or r["payload"].get("doc_id")
        key = (r["payload"]["media_type"], media_id)
        if key not in seen_media:
            seen_media.add(key)
            final_results.append(r)
            
    # Adicionar resultados semânticos
    for r in results:
        r_dict = dict(r) if hasattr(r, 'dict') else r
        payload = r_dict.get("payload", {})
        media_id = payload.get("photo_id") or payload.get("video_id") or payload.get("doc_id")
        key = (payload.get("media_type"), media_id)
        if key not in seen_media:
            seen_media.add(key)
            final_results.append(r_dict)
            
    # Enriquecer os resultados de fotos com informações em tempo real do SQLite (como filename, filepath e proxy_path)
    conn = get_connection()
    try:
        cursor = conn.cursor()
        for r in final_results:
            payload = r.get("payload", {})
            if payload.get("media_type") == "photo":
                photo_id = payload.get("photo_id")
                if photo_id:
                    cursor.execute("SELECT filename, filepath, status FROM photo WHERE id = ?", (photo_id,))
                    photo_row = cursor.fetchone()
                    if photo_row:
                        payload["filename"] = photo_row["filename"]
                        payload["filepath"] = photo_row["filepath"]
                        payload["status"] = photo_row["status"]
                        # Injetar o proxy path
                        proxy_relative_path = f"photos/proxy_photo_{photo_id}.webp"
                        proxy_full_path = CONFIG.PROXIES_DIR / proxy_relative_path
                        if proxy_full_path.exists():
                            payload["proxy_path"] = f"/proxies/{proxy_relative_path}"
                        else:
                            payload["proxy_path"] = None
    finally:
        conn.close()
        
    return {"query": query, "results": final_results[:12]}

@app.get("/api/themes")
def get_project_themes(project_id: int = Query(1)):
    """Retorna os temas e tópicos catalogados no SQLite."""
    themes = get_themes(project_id)
    return {"themes": themes}


# ── Endpoints de Timeline e Exportação ────────────────────────

@app.post("/api/timeline")
def save_timeline(timeline: TimelineCreate):
    """Salva um novo rascunho de timeline."""
    conn = get_connection()
    try:
        # Converter CutItem de volta para estrutura SQLite compatível
        cuts_dict = [
            {"video_id": c.video_id, "in": c.in_time, "out": c.out_time, "track": c.track}
            for c in timeline.cuts
        ]
        
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO timeline (project_id, name, description, sequence_json)
            VALUES (?, ?, ?, ?)
        """, (timeline.project_id, timeline.name, timeline.description, json.dumps(cuts_dict)))
        conn.commit()
        return {"status": "success", "timeline_id": cursor.lastrowid}
    finally:
        conn.close()

@app.get("/api/timeline")
def list_timelines(project_id: int = Query(1)):
    """Retorna todas as timelines salvas para o projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description, created_at FROM timeline WHERE project_id = ? ORDER BY id DESC", (project_id,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


@app.get("/api/timeline/{timeline_id}/export/{export_format}")
def export_timeline(timeline_id: int, export_format: str):
    """Gera o arquivo OTIO/XML no disco e retorna para download."""
    if export_format not in ["otio", "xml", "edl"]:
        raise HTTPException(status_code=400, detail="Formato inválido. Use 'otio', 'xml' ou 'edl'.")
        
    try:
        file_path = export_timeline_file(timeline_id, export_format)
        if not file_path.exists():
            raise HTTPException(status_code=500, detail="O arquivo não foi gerado.")
            
        media_type = "application/xml" if export_format == "xml" else "text/plain"
        return FileResponse(
            path=str(file_path),
            filename=file_path.name,
            media_type=media_type
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Endpoints de Gerenciamento Ativo de Proxies (Pausar/Cancelar/Status/Progresso) ──

@app.get("/api/conversions")
def get_all_conversions():
    """Retorna o progresso atual e status de todas as conversões de proxy em andamento/recentes."""
    from src.ingest.watcher import CONVERSION_PROGRESS
    res = CONVERSION_PROGRESS.copy()
    if ACTIVE_CLUSTERING:
        for pid in ACTIVE_CLUSTERING:
            res[f"cluster-{pid}"] = {"status": "running", "percent": 0, "type": "clustering"}
    return res

@app.post("/api/video/{video_id}/cancel-conversion")
def api_cancel_conversion(video_id: int):
    """Cancela o processo ativo de conversão de proxy de um vídeo específico."""
    from src.ingest.watcher import cancel_conversion
    success = cancel_conversion(video_id)
    if success:
        return {"status": "success", "message": f"Conversão do vídeo ID {video_id} cancelada com sucesso."}
    else:
        raise HTTPException(status_code=400, detail="Não há nenhuma conversão de proxy ativa rodando para este vídeo.")

@app.delete("/api/video/{video_id}/proxy")
def api_delete_proxy(video_id: int):
    """Cancela conversões e deleta fisicamente o arquivo proxy associado ao vídeo do HD."""
    from src.ingest.watcher import delete_proxy_file
    success = delete_proxy_file(video_id)
    if success:
        return {"status": "success", "message": f"Proxy do vídeo ID {video_id} deletado fisicamente com sucesso."}
    else:
        raise HTTPException(status_code=400, detail="Não foi possível deletar o proxy do disco ou ele não existe.")

@app.post("/api/video/{video_id}/retry")
def api_retry_single_video(video_id: int):
    """Reinicia a conversão de proxy ou transcrição de um vídeo individual falho."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filepath, filename, duration FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Vídeo não encontrado.")
        filepath = Path(row['filepath'])
        duration = row['duration']
    finally:
        conn.close()
        
    from src.ingest.watcher import generate_proxy, update_video_status, PROXY_EXECUTOR
    
    def retry_single_video_task(vid_id: int, path: Path, dur: float):
        import time
        try:
            proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{vid_id}.mp4"
            if proxy_path.exists():
                for _ in range(5):
                    try:
                        proxy_path.unlink()
                        break
                    except Exception:
                        time.sleep(0.5)
            update_video_status(vid_id, 'transcribing')
            success = generate_proxy(path, proxy_path, vid_id, dur)
            if success:
                update_video_status(vid_id, 'ingested')
            else:
                update_video_status(vid_id, 'error', error_message="Falha na geração do proxy pelo FFmpeg")
        except Exception as e:
            print(f"[RETRY_SINGLE] Erro ao reprocessar proxy ID {vid_id}: {e}")
            update_video_status(vid_id, 'error', error_message=str(e))
            
    PROXY_EXECUTOR.submit(retry_single_video_task, video_id, filepath, duration)
    return {"status": "success", "message": f"Reiniciada conversão para o vídeo ID {video_id} em background."}

@app.post("/api/project/{project_id}/retry-failed")
def api_retry_failed_project(project_id: int):
    """Reinicia todas as conversões de proxy falhas ou que não possuam arquivo físico (vídeos e fotos)."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filepath, filename, duration FROM video WHERE project_id = ?", (project_id,))
        video_rows = cursor.fetchall()
        
        cursor.execute("SELECT id, filepath, filename, status FROM photo WHERE project_id = ?", (project_id,))
        photo_rows = cursor.fetchall()
    finally:
        conn.close()
        
    count = 0
    from src.ingest.watcher import generate_proxy, update_video_status, ACTIVE_CONVERSIONS, PROXY_EXECUTOR
    from src.db.operations import update_photo_status
    from src.ingest.watcher import generate_photo_proxy
    
    # 1. Reprocessar vídeos falhos
    def retry_single_video_task(video_id: int, filepath: Path, duration: float):
        import time
        try:
            proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
            if proxy_path.exists():
                for _ in range(5):
                    try:
                        proxy_path.unlink()
                        break
                    except Exception:
                        time.sleep(0.5)
            update_video_status(video_id, 'transcribing')
            success = generate_proxy(filepath, proxy_path, video_id, duration)
            if success:
                update_video_status(video_id, 'ingested')
            else:
                update_video_status(video_id, 'error', error_message="Falha na geração do proxy pelo FFmpeg")
        except Exception as e:
            print(f"[RETRY] Erro ao reprocessar proxy ID {video_id}: {e}")
            update_video_status(video_id, 'error', error_message=str(e))
 
    for r in video_rows:
        video_id = r['id']
        filepath = Path(r['filepath'])
        duration = r['duration']
        
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        is_missing = not proxy_path.exists() or proxy_path.stat().st_size == 0
        
        if video_id not in ACTIVE_CONVERSIONS:
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT status FROM video WHERE id = ?", (video_id,))
                status_row = cursor.fetchone()
                status = status_row['status'] if status_row else 'ingested'
            finally:
                conn.close()
                
            if status == 'error' or status == 'transcribing' or is_missing:
                PROXY_EXECUTOR.submit(retry_single_video_task, video_id, filepath, duration)
                count += 1
                
    # 2. Reprocessar fotos falhas
    def retry_single_photo_task(photo_id: int, filepath: Path, proxy_path: Path):
        try:
            update_photo_status(photo_id, 'pending')
            success = generate_photo_proxy(filepath, proxy_path)
            if success:
                update_photo_status(photo_id, 'ingested')
                try:
                    from src.vision.face_engine import process_photo_faces
                    process_photo_faces(project_id, photo_id, proxy_path)
                except Exception as fe:
                    print(f"[RETRY_BATCH] Erro ao detectar rostos na foto: {fe}")
            else:
                update_photo_status(photo_id, 'error')
        except Exception as e:
            print(f"[RETRY] Erro ao reprocessar proxy de foto ID {photo_id}: {e}")
            update_photo_status(photo_id, 'error')

    for pr in photo_rows:
        photo_id = pr['id']
        filepath = Path(pr['filepath'])
        status = pr['status']
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
        is_missing = not proxy_path.exists() or proxy_path.stat().st_size == 0
        
        if status == 'error' or status == 'pending' or is_missing:
            # Se já existir o arquivo proxy (corrompido), tenta remover
            if proxy_path.exists():
                try:
                    proxy_path.unlink()
                except Exception:
                    pass
            PROXY_EXECUTOR.submit(retry_single_photo_task, photo_id, filepath, proxy_path)
            count += 1
                
    return {"status": "success", "message": f"Reiniciadas {count} conversões em background.", "count": count}

@app.post("/api/project/open-proxies-folder")
def open_proxies_folder():
    """Abre a pasta local de proxies no Windows Explorer trazendo-a para o primeiro plano."""
    try:
        import subprocess
        # Popen garante a inicialização como janela ativa em primeiro plano no Windows
        subprocess.Popen(['explorer', str(CONFIG.PROXIES_DIR)])
        return {"status": "success", "message": "Pasta de proxies aberta no Windows Explorer."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao abrir pasta: {str(e)}")

@app.delete("/api/video/{video_id}")
def api_delete_video(video_id: int):
    """Deleta o vídeo completamente do banco de dados (SQLite) e remove o proxy físico."""
    from src.ingest.watcher import delete_proxy_file
    # Remover o arquivo físico de proxy se existir
    delete_proxy_file(video_id)
    
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM video WHERE id = ?", (video_id,))
        conn.commit()
        return {"status": "success", "message": f"Vídeo ID {video_id} removido completamente da biblioteca."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover vídeo do banco de dados: {str(e)}")
    finally:
        conn.close()

@app.post("/api/photo/{photo_id}/retry")
def api_retry_single_photo(photo_id: int):
    """Reinicia a conversão de um único proxy de foto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filepath, filename, project_id FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Foto não encontrada.")
        filepath = Path(row['filepath'])
        project_id = row['project_id']
    finally:
        conn.close()
        
    from src.ingest.watcher import generate_photo_proxy, update_photo_status, PROXY_EXECUTOR
    proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    
    # Remover proxy corrompido se existir
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    def retry_task(p_id, proj_id, orig_path, px_path):
        try:
            update_photo_status(p_id, 'pending')
            success = generate_photo_proxy(orig_path, px_path)
            if success:
                update_photo_status(p_id, 'ingested')
                try:
                    from src.vision.face_engine import process_photo_faces
                    process_photo_faces(proj_id, p_id, px_path)
                except Exception as fe:
                    print(f"[RETRY_SINGLE] Erro ao detectar rostos: {fe}")
            else:
                update_photo_status(p_id, 'error')
        except Exception as e:
            print(f"[RETRY_PHOTO] Erro ID {p_id}: {e}")
            update_photo_status(p_id, 'error')
            
    PROXY_EXECUTOR.submit(retry_task, photo_id, project_id, filepath, proxy_path)
    return {"status": "success", "message": f"Reiniciada conversão para foto ID {photo_id} em background."}

@app.delete("/api/photo/{photo_id}")
def api_delete_photo(photo_id: int):
    """Remove a foto completamente do projeto e apaga o proxy correspondente."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM photo WHERE id = ?", (photo_id,))
        conn.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover foto do banco: {str(e)}")
    finally:
        conn.close()
        
    # Deletar arquivo físico de proxy se existir
    proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception:
            pass
            
    return {"status": "success", "message": f"Foto ID {photo_id} removida com sucesso."}

# ── Modelos Pydantic Adicionais ──────────────────────────────
class SplitTranscriptPayload(BaseModel):
    start_time: float
    new_speaker_id: str

# ── Endpoints de Documentos de Contexto e Visão em Lote ───────

@app.post("/api/project/{project_id}/docs")
async def upload_document(project_id: int, doc_type: str = "other", file: UploadFile = File(...)):
    """Faz upload de um documento de roteiro ou contexto e indexa no Qdrant."""
    filename = file.filename
    file_bytes = await file.read()
    
    # 1. Decodificar / Extrair conteúdo com base no formato
    content = ""
    ext = Path(filename).suffix.lower()
    
    if ext in [".txt", ".fountain"]:
        try:
            content = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = file_bytes.decode("latin-1", errors="ignore")
    elif ext == ".fdx":
        try:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(file_bytes)
            paragraphs = []
            for p in root.findall(".//Paragraph"):
                text_elems = p.findall(".//Text")
                text = "".join([t.text for t in text_elems if t.text])
                ptype = p.attrib.get("Type", "")
                if text.strip():
                    if ptype:
                        paragraphs.append(f"{ptype.upper()}: {text.strip()}")
                    else:
                        paragraphs.append(text.strip())
            content = "\n\n".join(paragraphs)
            if not content.strip():
                content = file_bytes.decode("utf-8", errors="ignore")
        except Exception as e:
            content = file_bytes.decode("utf-8", errors="ignore")
    elif ext == ".pdf":
        try:
            import pypdf
            from io import BytesIO
            reader = pypdf.PdfReader(BytesIO(file_bytes))
            pages_text = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)
            content = "\n\n".join(pages_text)
            if not content.strip():
                raise Exception("Nenhum texto pôde ser extraído do PDF.")
        except ImportError:
            raise HTTPException(
                status_code=400, 
                detail="Para processar arquivos PDF, instale a biblioteca 'pypdf' no servidor (pip install pypdf)."
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erro ao processar PDF: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Formato de arquivo não suportado. Use .txt, .fountain, .fdx ou .pdf.")

    if not content.strip():
        raise HTTPException(status_code=400, detail="O arquivo está vazio ou não pôde ser decodificado.")
        
    # 2. Salvar no SQLite
    from src.db.operations import add_production_doc
    try:
        doc_id = add_production_doc(
            project_id=project_id,
            filename=filename,
            filepath=None,
            content=content,
            doc_type=doc_type
        )
        
        # 3. Indexar no Qdrant
        search_engine = SemanticSearch.get_instance()
        search_engine.index_production_doc(project_id, doc_id, filename, content)
        
        return {"status": "success", "doc_id": doc_id, "filename": filename, "message": "Documento indexado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar documento: {str(e)}")

@app.get("/api/project/{project_id}/docs")
def list_documents(project_id: int):
    """Lista todos os documentos de contexto importados no projeto."""
    from src.db.operations import get_production_docs
    return get_production_docs(project_id)

@app.delete("/api/docs/{doc_id}")
def remove_document(doc_id: int, project_id: int = Query(1)):
    """Remove um documento de contexto do banco de dados e limpa os vetores no Qdrant."""
    from src.db.operations import delete_production_doc
    try:
        # Remover do Qdrant primeiro
        search_engine = SemanticSearch.get_instance()
        search_engine.delete_production_doc_vectors(project_id, doc_id)
        
        # Remover do SQLite
        delete_production_doc(doc_id)
        return {"status": "success", "message": f"Documento ID {doc_id} removido."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover documento: {str(e)}")

# ── Endpoints de Reconhecimento Facial (Fase 3) ──────────────────────────

class LabelFacePayload(BaseModel):
    name: str

@app.post("/api/face/{face_id}/label")
def label_face(face_id: int, payload: LabelFacePayload):
    """Atribui um nome a um rosto detectado."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE face SET name = ? WHERE id = ?", (payload.name, face_id))
        conn.commit()
        return {"status": "success", "message": f"Rosto ID {face_id} rotulado como '{payload.name}'."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@app.get("/api/video/{video_id}/faces")
def get_video_faces(video_id: int):
    """Retorna todos os rostos detectados em um vídeo."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, bounding_box, timestamp FROM face WHERE video_id = ? ORDER BY timestamp", (video_id,))
        rows = cursor.fetchall()
        
        result = []
        for r in rows:
            row_dict = dict(r)
            if row_dict.get('bounding_box'):
                try:
                    row_dict['bounding_box'] = json.loads(row_dict['bounding_box'])
                except Exception:
                    pass
            result.append(row_dict)
        return result
    finally:
        conn.close()

@app.get("/api/photo/{photo_id}/faces")
def get_photo_faces(photo_id: int):
    """Retorna todos os rostos detectados em uma foto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, bounding_box FROM face WHERE photo_id = ?", (photo_id,))
        rows = cursor.fetchall()
        
        result = []
        for r in rows:
            row_dict = dict(r)
            if row_dict.get('bounding_box'):
                try:
                    row_dict['bounding_box'] = json.loads(row_dict['bounding_box'])
                except Exception:
                    pass
            result.append(row_dict)
        return result
    finally:
        conn.close()

@app.get("/api/project/{project_id}/speakers")
def get_project_speakers(project_id: int):
    """Retorna a lista de nomes únicos de falantes diarizados do projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT speaker_id 
            FROM transcript 
            WHERE video_id IN (SELECT id FROM video WHERE project_id = ?)
            ORDER BY speaker_id
        """, (project_id,))
        speakers = [r['speaker_id'] for r in cursor.fetchall()]
        
        cursor.execute("""
            SELECT DISTINCT name 
            FROM face 
            WHERE project_id = ? AND name IS NOT NULL
            ORDER BY name
        """, (project_id,))
        faces = [r['name'] for r in cursor.fetchall()]
        
        all_names = sorted(list(set(speakers + faces)))
        return all_names
    finally:
        conn.close()

@app.post("/api/project/{project_id}/analyze-all-vision")
def trigger_all_vision(project_id: int, background_tasks: BackgroundTasks):
    """Dispara a decupagem visual de todas as mídias (B-rolls e fotos) pendentes em background."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # 1. Buscar B-rolls pendentes/ingested
        cursor.execute("""
            SELECT id, filepath, duration 
            FROM video 
            WHERE project_id = ? AND video_type = 'broll' AND status IN ('ingested', 'error')
        """, (project_id,))
        video_rows = cursor.fetchall()
        
        # 2. Buscar Fotos pendentes/ingested/error que não foram analisadas
        cursor.execute("""
            SELECT id, filepath 
            FROM photo 
            WHERE project_id = ? AND status IN ('ingested', 'pending', 'error')
        """, (project_id,))
        photo_rows = cursor.fetchall()
    finally:
        conn.close()
        
    def bg_analyze_all():
        print(f"[VISION_BATCH] Iniciando lote de visão com {len(video_rows)} vídeos e {len(photo_rows)} fotos para projeto {project_id}")
        
        # Analisar vídeos B-Roll
        for v in video_rows:
            try:
                analyze_broll_video(v['id'], Path(v['filepath']), v['duration'])
            except Exception as e:
                print(f"[VISION_BATCH] Erro no vídeo ID {v['id']}: {e}")
                
        # Analisar fotos de set (com detecção inteligente de sequências/bursts)
        photos_with_time = []
        for p in photo_rows:
            path = Path(p['filepath'])
            mtime = 0.0
            try:
                if path.exists():
                    mtime = path.stat().st_mtime
            except Exception:
                pass
            photos_with_time.append({
                "id": p["id"],
                "filepath": path,
                "mtime": mtime,
                "parent_dir": str(path.parent)
            })
            
        # Ordenar por diretório pai e tempo de modificação
        photos_with_time.sort(key=lambda x: (x["parent_dir"], x["mtime"]))
        
        last_analyzed_photo = None
        
        for p in photos_with_time:
            photo_id = p["id"]
            filepath = p["filepath"]
            
            # Detectar sequência temporal (intervalo menor que 5 segundos no mesmo diretório)
            is_sequence = False
            time_diff = 0.0
            if last_analyzed_photo and last_analyzed_photo["parent_dir"] == p["parent_dir"]:
                time_diff = abs(p["mtime"] - last_analyzed_photo["mtime"])
                if time_diff < 5.0:
                    is_sequence = True
                    
            if is_sequence:
                print(f"  [VISION_BATCH] Foto ID {photo_id} ({filepath.name}) detectada em sequência com Foto ID {last_analyzed_photo['id']} (Diff: {time_diff:.1f}s). Reutilizando metadados.")
                try:
                    from src.db.operations import get_connection, update_photo_analysis, add_relation
                    conn = get_connection()
                    ref_desc = ""
                    ref_tags_str = ""
                    try:
                        cursor = conn.cursor()
                        cursor.execute("SELECT description, tags FROM photo WHERE id = ?", (last_analyzed_photo["id"],))
                        row = cursor.fetchone()
                        if row:
                            ref_desc = row["description"] or ""
                            ref_tags_str = row["tags"] or "[]"
                    finally:
                        conn.close()
                        
                    import json
                    try:
                        ref_tags = json.loads(ref_tags_str)
                    except Exception:
                        ref_tags = []
                        
                    desc = f"{ref_desc} (Foto em sequência)"
                    
                    # Salvar cópia no SQLite
                    update_photo_analysis(photo_id, desc, ref_tags)
                    
                    # Indexar no Qdrant
                    search_engine = SemanticSearch.get_instance()
                    search_engine.index_photo_description(project_id, photo_id, desc, ref_tags)
                    
                    # Salvar relações de tags no grafo relacional
                    for tag in ref_tags:
                        add_relation(
                            project_id=project_id,
                            subject_type="photo",
                            subject_id=str(photo_id),
                            predicate="features_element",
                            object_type="theme",
                            object_id=tag,
                            weight=1.0
                        )
                except Exception as seq_err:
                    print(f"  [VISION_BATCH] Erro ao replicar metadados na foto sequencial ID {photo_id}: {seq_err}")
            else:
                try:
                    analyze_set_photo(photo_id, filepath)
                    # Armazenar esta como última analisada
                    last_analyzed_photo = p
                except Exception as e:
                    print(f"[VISION_BATCH] Erro ao analisar foto ID {photo_id}: {e}")
                
    background_tasks.add_task(bg_analyze_all)
    return {
        "status": "success", 
        "message": f"Análise visual em lote de {len(video_rows)} vídeos e {len(photo_rows)} fotos iniciada em background."
    }

@app.post("/api/video/{video_id}/split-transcript")
def split_transcript(video_id: int, payload: SplitTranscriptPayload):
    """Divide a transcrição a partir de uma palavra, atribuindo a ela e às subsequentes um novo falante."""
    conn = get_connection()
    try:
        # 1. Encontrar o speaker atual da palavra neste timestamp
        cursor = conn.cursor()
        cursor.execute("""
            SELECT speaker_id 
            FROM transcript 
            WHERE video_id = ? AND start_time = ?
        """, (video_id, payload.start_time))
        word_row = cursor.fetchone()
        if not word_row:
            # Tentar achar a palavra mais próxima
            cursor.execute("""
                SELECT speaker_id, start_time 
                FROM transcript 
                WHERE video_id = ? AND start_time >= ? 
                ORDER BY start_time ASC LIMIT 1
            """, (video_id, payload.start_time))
            word_row = cursor.fetchone()
            
        if not word_row:
            raise HTTPException(status_code=404, detail="Nenhuma palavra encontrada neste timestamp.")
            
        current_speaker = word_row['speaker_id']
        actual_start_time = word_row['start_time']
        
        # 2. Atualizar as palavras subsequentes do mesmo falante a partir daquele ponto
        cursor.execute("""
            UPDATE transcript 
            SET speaker_id = ? 
            WHERE video_id = ? AND start_time >= ? AND speaker_id = ?
        """, (payload.new_speaker_id, video_id, actual_start_time, current_speaker))
        conn.commit()
        
        # 3. Recarregar os diálogos no SQLite e re-indexar no Qdrant
        from src.db.operations import get_video_transcript
        dialogues = get_video_transcript(video_id)
        if dialogues:
            search_engine = SemanticSearch.get_instance()
            cursor.execute("SELECT project_id FROM video WHERE id = ?", (video_id,))
            proj_row = cursor.fetchone()
            proj_id = proj_row['project_id'] if proj_row else 1
            search_engine.index_transcript_chunks(proj_id, video_id, dialogues)
            
        return {"status": "success", "message": f"Transcrição dividida em {actual_start_time}s. Novo falante: {payload.new_speaker_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

class ChatPayload(BaseModel):
    message: str
    history: List[dict] = []

@app.post("/api/project/{project_id}/chat")
def chatbot_rag(project_id: int, payload: ChatPayload):
    """Chatbot RAG que realiza busca híbrida no Qdrant/SQLite e responde usando DeepSeek."""
    import requests
    search_engine = SemanticSearch.get_instance()
    
    # 1. Pesquisa semântica no Qdrant
    raw_results = []
    try:
        raw_results = search_engine.search(project_id, payload.message, limit=15)
    except Exception as e:
        print(f"[CHAT] Erro ao buscar no Qdrant: {e}")
        
    # Enriquecer resultados com nomes de arquivos do SQLite
    conn = get_connection()
    context_items = []
    try:
        cursor = conn.cursor()
        for r in raw_results:
            p = r.get("payload", {})
            media_type = p.get("media_type")
            text = p.get("text", "")
            
            if media_type in ["interview", "broll", "video"]:
                vid = p.get("video_id")
                cursor.execute("SELECT filename FROM video WHERE id = ?", (vid,))
                row = cursor.fetchone()
                fname = row["filename"] if row else "Video"
                start = p.get("start_time", 0.0)
                end = p.get("end_time", start + 10.0)
                if media_type == "interview":
                    speaker = p.get("speaker_id", "Desconhecido")
                    context_items.append(f'- [Depoimento ID {vid} | Arquivo: {fname} | Falante: {speaker} | Tempo: {start:.1f}s - {end:.1f}s]: "{text}"')
                else:
                    context_items.append(f'- [B-Roll ID {vid} | Arquivo: {fname} | Tempo: {start:.1f}s]: "{text}"')
            elif media_type == "photo":
                phid = p.get("photo_id")
                cursor.execute("SELECT filename FROM photo WHERE id = ?", (phid,))
                row = cursor.fetchone()
                fname = row["filename"] if row else "Foto"
                context_items.append(f'- [Foto ID {phid} | Arquivo: {fname}]: "{text}"')
            elif media_type == "doc":
                docid = p.get("doc_id")
                fname = p.get("filename", "Documento")
                context_items.append(f'- [Documento ID {docid} | Arquivo: {fname}]: "{text}"')
    finally:
        conn.close()
        
    context_str = "\n".join(context_items)
    
    # 2. Construir instruções do sistema
    system_prompt = f"""Você é o Assistente IA do CaIAu Talho, um co-editor e assistente de roteiro/produção de cinema inteligente.
Você ajuda o usuário a montar seu filme a partir do material de bastidores (making of), fotos de set e documentos de produção.

Ao responder às perguntas do usuário, use o contexto fornecido abaixo, que contém trechos de transcrição de depoimentos, descrições visuais de B-roll, descrições de fotos de set e documentos de produção.
IMPORTANTE: Sempre cite as mídias específicas em sua resposta quando apropriado, usando o formato de link markdown exato:
- Para vídeos (entrevistas ou b-rolls): `[Texto descritivo ou Nome do Arquivo](video_id: ID_DO_VIDEO, start: START_TIME, end: END_TIME)` (Ex: [Depoimento do Diretor](video_id: 2, start: 15.4, end: 28.0)). O player pulará para esse tempo.
- Para fotos: `[Texto descritivo](photo_id: ID_DA_FOTO)` (Ex: [Foto da equipe de luz](photo_id: 5)).
- Para documentos: `[Nome do Documento](doc_id: ID_DO_DOC)` (Ex: [Pauta de Entrevistas](doc_id: 1)).

Seja profissional, criativo, dê sugestões de montagem e de narrativa. Escreva sempre em Português.

CONTEXTO RELEVANTE DO PROJETO:
{context_str if context_str else "Nenhum material indexado ou correspondente encontrado no banco vetorial."}
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    # Adicionar histórico limitado
    for h in payload.history[-8:]:
        messages.append({
            "role": h.get("role", "user"),
            "content": h.get("content", "")
        })
        
    messages.append({"role": "user", "content": payload.message})
    
    # 3. Chamar API do OpenRouter
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        return {
            "response": "Olá! Sou o assistente de edição do CaIAu Talho. Para que eu possa responder às suas dúvidas e pesquisar as mídias, configure a chave `OPENROUTER_API_KEY` no arquivo `.env` do seu servidor.",
            "context_used": []
        }
        
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload_api = {
        "model": CONFIG.TEXT_MODEL,
        "messages": messages,
        "temperature": 0.5
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload_api, timeout=30)
        if response.status_code == 200:
            res_json = response.json()
            ai_text = res_json['choices'][0]['message']['content'].strip()
            return {
                "response": ai_text,
                "context_used": context_items
            }
        else:
            return {
                "response": f"Erro ao contatar o motor de IA (Status {response.status_code}): {response.text}",
                "context_used": []
            }
    except Exception as e:
        return {
            "response": f"Erro crítico na comunicação com o chatbot: {str(e)}",
            "context_used": []
        }

@app.on_event("shutdown")
def on_shutdown_cleanup():
    """Garante que nenhum processo filho FFmpeg continue rodando órfão no Windows/Linux ao desligar."""
    from src.ingest.watcher import ACTIVE_CONVERSIONS
    print(f"[SHUTDOWN] Finalizando {len(ACTIVE_CONVERSIONS)} processos FFmpeg ativos para evitar órfãos...")
    for video_id, process in list(ACTIVE_CONVERSIONS.items()):
        try:
            if os.name == 'nt':
                import subprocess
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True)
            else:
                process.kill()
        except Exception:
            pass
    ACTIVE_CONVERSIONS.clear()


# Servir proxies de vídeo locais na rota /proxies/
app.mount("/proxies", StaticFiles(directory=str(CONFIG.PROXIES_DIR)), name="proxies")

# Servir mídia original se necessário na rota /originals/
app.mount("/originals", StaticFiles(directory=str(CONFIG.ORIGINALS_DIR)), name="originals")

# Servir o Frontend Web estático na raiz '/'
frontend_dir = CONFIG.BASE_DIR / "src/ui"
frontend_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="ui")
