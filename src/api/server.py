"""Servidor REST FastAPI para controle de pipeline e comunicação com a UI Web."""
import os
import sys
import json
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
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
init_db()

app = FastAPI(
    title="CapIAu — Motor de Inteligência Cinematográfica",
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
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


@app.get("/api/video/{video_id}/transcript")
def get_transcript(video_id: int):
    """Retorna os blocos de falas de um depoimento específico."""
    from src.db.operations import get_video_transcript
    dialogues = get_video_transcript(video_id)
    return {"video_id": video_id, "dialogues": dialogues}

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
        cursor.execute("SELECT id, filepath, filename FROM video WHERE project_id = ? AND status != 'transcribed'", (project_id,))
        rows = cursor.fetchall()
        if not rows:
            return {"status": "success", "message": "Todos os vídeos já possuem transcrições.", "count": 0}
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

@app.post("/api/project/cluster-themes")
def trigger_clustering(background_tasks: BackgroundTasks, project_id: int = Query(1)):
    """Processa o clustering temático de falas."""
    background_tasks.add_task(extract_makingof_themes, project_id)
    return {"status": "success", "message": f"Processamento de temas iniciado para projeto {project_id}."}


# ── Endpoints de Busca e Inteligência ────────────────────────

@app.get("/api/search")
def search_media(query: str = Query(..., min_length=2), project_id: int = Query(1), media_type: Optional[str] = None):
    """Busca semântica no Qdrant local (file-based em CPU)."""
    search_engine = SemanticSearch.get_instance()
    results = search_engine.search(project_id, query, media_type=media_type, limit=12)
    return {"query": query, "results": results}

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
    return CONVERSION_PROGRESS

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
    """Reinicia todas as conversões de proxy falhas ou que não possuam arquivo físico."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filepath, filename, duration FROM video WHERE project_id = ?", (project_id,))
        rows = cursor.fetchall()
    finally:
        conn.close()
        
    count = 0
    from src.ingest.watcher import generate_proxy, update_video_status, ACTIVE_CONVERSIONS, PROXY_EXECUTOR
    
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

    for r in rows:
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
                
            if status == 'error' or is_missing:
                PROXY_EXECUTOR.submit(retry_single_video_task, video_id, filepath, duration)
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
