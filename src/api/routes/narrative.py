"""Roteador FastAPI para gerenciamento de Timelines, Transcrições, Temas e Chat RAG."""
import sqlite3
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse

from src.api.dependencies import get_db_conn
from src.api.schemas import TimelineCreate, SplitTranscriptPayload, ChatPayload, SearchCategorizePayload
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.narrative import NarrativeRepository
from src.services.pipeline import PipelineService
from src.services.rag import RAGService
from src.search.semantic import SemanticSearch
from src.export.otio_export import export_timeline_file

router = APIRouter(tags=["Narratives & Search"])

@router.get("/api/video/{video_id}/transcript")
def get_transcript(video_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna a transcrição interativa agrupada por blocos de diálogos e palavras individuais."""
    dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
    words = NarrativeRepository.get_transcript_words(conn, video_id)
    return {"video_id": video_id, "dialogues": dialogues, "words": words}

@router.get("/api/video/{video_id}/vision")
def get_video_vision(video_id: int, project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna descrições de frames de B-roll enriquecidas com rostos/objetos do banco de dados (tolerância 5.0s)."""
    try:
        search_engine = SemanticSearch.get_instance()
        frames = search_engine.get_video_vision_frames(project_id, video_id)
        if not frames:
            return {"video_id": video_id, "frames": []}
            
        # Buscar todas as faces/objetos rotulados neste vídeo de uma só vez
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT name, timestamp, crop_path FROM face 
            WHERE video_id = ? AND name IS NOT NULL AND name != '' AND name != 'Não Relevante' AND name != 'Não é Rosto'
        """, (video_id,))
        faces = cursor.fetchall()
        
        # Associar cada face/objeto ao frame de B-Roll mais próximo (limite de 5.0 segundos)
        frame_names = {i: [] for i in range(len(frames))}
        frame_replacements = {i: {} for i in range(len(frames))}
        for face in faces:
            face_name = face[0]
            face_ts = face[1]
            face_crop = face[2]
            
            # Encontrar o frame mais próximo
            best_idx = -1
            min_diff = 5.0  # Limite máximo de 5 segundos de tolerância
            for idx, frame in enumerate(frames):
                diff = abs(frame["timestamp"] - face_ts)
                if diff < min_diff:
                    min_diff = diff
                    best_idx = idx
            
            if best_idx != -1:
                if face_crop and face_crop.startswith("text:"):
                    target_text = face_crop[5:]
                    frame_replacements[best_idx][target_text] = face_name
                else:
                    if face_name not in frame_names[best_idx]:
                        frame_names[best_idx].append(face_name)
                    
        # Enriquecer as descrições dos frames
        from src.services.rag import enrich_description
        for idx in range(len(frames)):
            names = frame_names[idx]
            replacements = frame_replacements[idx]
            if names or replacements:
                frames[idx]["description"] = enrich_description(
                    frames[idx]["description"], 
                    names, 
                    text_replacements=replacements
                )
                
        return {"video_id": video_id, "frames": frames}
    except Exception as e:
        print(f"[NarrativeAPI] Erro ao buscar vision frames: {e}")
        return {"video_id": video_id, "frames": []}


@router.post("/api/project/cluster-themes")
def trigger_clustering(background_tasks: BackgroundTasks, project_id: int = Query(1)):
    """Dispara processamento de clustering de temas em background."""
    from src.core.tasks import TASK_MANAGER
    TASK_MANAGER.register_clustering(project_id)
    
    def run_clustering():
        try:
            PipelineService.run_project_theme_clustering(project_id)
        finally:
            TASK_MANAGER.unregister_clustering(project_id)
            
    background_tasks.add_task(run_clustering)
    return {"status": "success", "message": f"Processamento de temas iniciado para projeto {project_id}."}

@router.get("/api/themes")
def get_project_themes(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna os temas e tópicos catalogados no SQLite."""
    themes = NarrativeRepository.get_themes(conn, project_id)
    return {"themes": themes}

@router.get("/api/search")
def search_media(
    query: str = Query(..., min_length=1),
    project_id: int = Query(1),
    media_type: Optional[str] = None,
    limit: int = Query(30),
    offset: int = Query(0)
):
    """Busca híbrida inteligente cruzando metadados relacionais e Qdrant vetorial."""
    results = RAGService.search_hybrid(project_id, query, media_type=media_type, limit=limit, offset=offset)
    return {"query": query, "results": results}

@router.post("/api/search/categorize")
def categorize_search(payload: SearchCategorizePayload):
    """Agrupa os resultados da busca em categorias semânticas via LLM."""
    results_dicts = [{"id": r.id, "media_type": r.media_type, "text": r.text} for r in payload.results]
    return RAGService.categorize_results_with_llm(payload.query, results_dicts)

@router.post("/api/timeline")
def save_timeline(timeline: TimelineCreate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Salva um novo rascunho de timeline."""
    try:
        cuts_dict = [
            {"video_id": c.video_id, "in": c.in_time, "out": c.out_time, "track": c.track}
            for c in timeline.cuts
        ]
        timeline_id = ProjectRepository.save_timeline(conn, timeline.project_id, timeline.name, timeline.description, cuts_dict)
        conn.commit()
        return {"status": "success", "timeline_id": timeline_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/timeline")
def list_timelines(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna todas as timelines cadastradas do projeto."""
    return ProjectRepository.list_timelines(conn, project_id)

@router.get("/api/timeline/{timeline_id}/export/{export_format}")
def export_timeline(timeline_id: int, export_format: str):
    """Exporta a timeline em formato XML/EDL/OTIO e retorna o arquivo para download."""
    if export_format not in ["otio", "xml", "edl"]:
        raise HTTPException(status_code=400, detail="Formato inválido. Use 'otio', 'xml' ou 'edl'.")
        
    try:
        file_path = export_timeline_file(timeline_id, export_format)
        if not file_path.exists():
            raise HTTPException(status_code=500, detail="O arquivo de timeline não pôde ser gerado.")
            
        media_type = "application/xml" if export_format == "xml" else "text/plain"
        return FileResponse(path=str(file_path), filename=file_path.name, media_type=media_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/video/{video_id}/split-transcript")
def split_transcript(video_id: int, payload: SplitTranscriptPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Divide a fala em um timestamp específico e atualiza falantes subsequentes."""
    try:
        actual_time = NarrativeRepository.split_transcript(conn, video_id, payload.start_time, payload.new_speaker_id)
        conn.commit()
        
        # Re-indexa o diálogo no Qdrant
        dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
        if dialogues:
            video = MediaRepository.get_video(conn, video_id)
            proj_id = video['project_id'] if video else 1
            v_type = video['video_type'] if video else 'interview'
            
            search_engine = SemanticSearch.get_instance()
            search_engine.index_transcript_chunks(proj_id, video_id, dialogues, v_type)
            
        return {"status": "success", "message": f"Transcrição dividida em {actual_time}s. Novo falante: {payload.new_speaker_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/project/{project_id}/chat")
def chatbot_rag(project_id: int, payload: ChatPayload):
    """Interface chatbot RAG com busca híbrida de contexto no Qdrant e SQLite."""
    res = RAGService.chat(project_id, payload.message, payload.history)
    return res
