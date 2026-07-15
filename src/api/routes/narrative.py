"""Roteador FastAPI para gerenciamento de Timelines, Transcrições, Temas e Chat RAG."""
import sqlite3
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse

from src.api.dependencies import get_db_conn
from src.api.schemas import (
    TimelineCreate,
    TimelineAISuggestPayload,
    SplitTranscriptPayload,
    ChatPayload,
    SearchCategorizePayload,
    RenameSpeakerPayload,
    EditDialoguePayload,
    AddThemeSegmentPayload
)
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.narrative import NarrativeRepository
from src.db.repositories.media import MediaRepository
from src.services.pipeline import PipelineService
from src.services.rag import RAGService
from src.services.timeline_ai import TimelineAIService
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
    """Retorna os temas catalogados com contagem de segmentos (trechos com timecode)."""
    themes = NarrativeRepository.get_themes(conn, project_id)
    cursor = conn.cursor()
    for t in themes:
        cursor.execute("SELECT COUNT(*) as cnt FROM theme_segment WHERE theme_id = ?", (t["id"],))
        row = cursor.fetchone()
        t["segments_count"] = row["cnt"] if row else 0
    return {"themes": themes}

@router.get("/api/theme/{theme_id}/segments")
def get_theme_segments(theme_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna os trechos exatos (mídia + intervalo de tempo) vinculados a um tema."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.id, s.video_id, s.photo_id, s.start_time, s.end_time, s.speaker_id,
               s.text_excerpt, s.relevance,
               v.filename as video_filename, v.video_type,
               p.filename as photo_filename
        FROM theme_segment s
        LEFT JOIN video v ON s.video_id = v.id
        LEFT JOIN photo p ON s.photo_id = p.id
        WHERE s.theme_id = ?
        ORDER BY s.relevance DESC, s.video_id, s.start_time
    """, (theme_id,))
    segments = [dict(r) for r in cursor.fetchall()]
    return {"theme_id": theme_id, "segments": segments}

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

@router.get("/api/search/visual")
def search_visual(
    query: str = Query(..., min_length=1, alias="q"),
    project_id: int = Query(1),
    limit: int = Query(20)
):
    """Busca visual pura por CLIP local (texto → imagem, sem custo de API)."""
    from src.search.image_semantic import ImageSearch
    results = ImageSearch.get_instance().search_text(project_id, query, limit=limit)
    return {"query": query, "results": results}

@router.post("/api/search/categorize")
def categorize_search(payload: SearchCategorizePayload):
    """Agrupa os resultados da busca em categorias semânticas via LLM."""
    results_dicts = [{"id": r.id, "media_type": r.media_type, "text": r.text} for r in payload.results]
    return RAGService.categorize_results_with_llm(payload.query, results_dicts)

@router.post("/api/search/reindex")
def reindex_embeddings(conn: sqlite3.Connection = Depends(get_db_conn)):
    """Re-embeda todo o acervo com o modelo de embeddings atual (após troca de modelo).

    Também invalida os centroides de temas (modelo antigo), que serão recomputados
    na próxima rodada de clustering. Progresso na aba Tarefas.
    """
    # Centroides de temas foram gerados com o modelo antigo — invalidar
    conn.execute("UPDATE theme SET embedding = NULL")
    conn.commit()

    import threading

    def _run():
        try:
            SemanticSearch.get_instance().reindex_all()
        except Exception as e:
            print(f"[Reindex] Erro crítico: {e}")

    threading.Thread(target=_run, daemon=True).start()
    return {
        "status": "success",
        "message": "Reindexação total iniciada em background (modelo: veja EMBEDDING_MODEL). Acompanhe na aba Tarefas."
    }

@router.post("/api/timeline")
def save_timeline(timeline: TimelineCreate, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Salva um novo rascunho de timeline (formato v2 multipista)."""
    try:
        cuts_dict = [
            {
                "id": c.id,
                "type": c.type or "video",
                "video_id": c.video_id,
                "photo_id": c.photo_id,
                "in": c.in_time,
                "out": c.out_time,
                "track": c.track,
                "timeline_start": c.timeline_start,
                "link_id": c.link_id,
                "effects": c.effects or [],
                "alternatives": c.alternatives or [],
                "origin": c.origin or "user"
            }
            for c in timeline.cuts
        ]
        tracks_dict = [t.dict() for t in timeline.tracks] if timeline.tracks else None
        timeline_id = ProjectRepository.save_timeline(
            conn, timeline.project_id, timeline.name, timeline.description,
            cuts_dict, tracks=tracks_dict, fps=timeline.fps,
            width=timeline.width, height=timeline.height
        )
        conn.commit()
        return {"status": "success", "timeline_id": timeline_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/timeline")
def list_timelines(project_id: int = Query(1), conn: sqlite3.Connection = Depends(get_db_conn)):
    """Retorna todas as timelines cadastradas do projeto."""
    return ProjectRepository.list_timelines(conn, project_id)

@router.get("/api/timeline/{timeline_id}")
def get_timeline_detail(timeline_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Carrega uma timeline salva (normalizada para o formato v2 com trilhas e posições)."""
    result = ProjectRepository.get_timeline(conn, timeline_id)
    if not result:
        raise HTTPException(status_code=404, detail="Timeline não encontrada.")
    return result

@router.post("/api/timeline/ai-suggest")
def timeline_ai_suggest(payload: TimelineAISuggestPayload):
    """Analisa o corte ATUAL da timeline (transcrições dos trechos, descrições visuais,
    lacunas de cobertura) e retorna sugestões estruturadas de edição para a pista de IA."""
    clips = [c.dict() for c in payload.clips]
    tracks = [t.dict() for t in payload.tracks]
    result = TimelineAIService.suggest(
        project_id=payload.project_id,
        persona=payload.persona,
        clips=clips,
        tracks=tracks,
        fps=payload.fps,
        brief=payload.brief
    )
    return result

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

@router.post("/api/video/{video_id}/rename-speaker")
def rename_speaker(video_id: int, payload: RenameSpeakerPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Renomeia um falante local ou globalmente e atualiza o índice semântico."""
    try:
        NarrativeRepository.rename_speaker(
            conn,
            video_id=video_id,
            old_speaker_id=payload.old_speaker_id,
            new_speaker_id=payload.new_speaker_id,
            global_rename=payload.global_rename,
            start_time=payload.start_time,
            end_time=payload.end_time
        )
        conn.commit()
        
        # Re-indexa o diálogo no Qdrant
        dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
        if dialogues:
            video = MediaRepository.get_video(conn, video_id)
            proj_id = video['project_id'] if video else 1
            v_type = video['video_type'] if video else 'interview'
            
            search_engine = SemanticSearch.get_instance()
            search_engine.index_transcript_chunks(proj_id, video_id, dialogues, v_type)
            
        return {"status": "success", "message": "Falante renomeado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/video/{video_id}/edit-dialogue")
def edit_dialogue(video_id: int, payload: EditDialoguePayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Atualiza o diálogo em um trecho específico e re-indexa no Qdrant."""
    try:
        NarrativeRepository.edit_dialogue_segment(
            conn,
            video_id=video_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
            new_text=payload.new_text,
            speaker_id=payload.speaker_id
        )
        conn.commit()
        
        # Re-indexa o diálogo no Qdrant
        dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
        if dialogues:
            video = MediaRepository.get_video(conn, video_id)
            proj_id = video['project_id'] if video else 1
            v_type = video['video_type'] if video else 'interview'
            
            search_engine = SemanticSearch.get_instance()
            search_engine.index_transcript_chunks(proj_id, video_id, dialogues, v_type)
            
        return {"status": "success", "message": "Diálogo editado com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/theme/segment")
def add_theme_segment(payload: AddThemeSegmentPayload, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Associa um trecho de vídeo a um tema narrativo."""
    try:
        segment_id = NarrativeRepository.add_theme_segment_manual(
            conn,
            theme_id=payload.theme_id,
            project_id=payload.project_id,
            video_id=payload.video_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
            speaker_id=payload.speaker_id,
            text_excerpt=payload.text_excerpt
        )
        conn.commit()
        return {"status": "success", "segment_id": segment_id, "message": "Segmento vinculado ao tema com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/api/theme/segment/{segment_id}")
def delete_theme_segment(segment_id: int, conn: sqlite3.Connection = Depends(get_db_conn)):
    """Remove uma associação de tema segmentado."""
    try:
        NarrativeRepository.delete_theme_segment(conn, segment_id)
        conn.commit()
        return {"status": "success", "message": "Segmento desvinculado do tema com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/video/{video_id}/diarization-clues")
def get_diarization_clues(
    video_id: int,
    silence_threshold: float = Query(1.2),
    enable_silence: bool = Query(True),
    enable_questions: bool = Query(True),
    enable_faces: bool = Query(True),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Calcula e retorna pistas de diarização baseadas em silêncios, perguntas e rostos."""
    try:
        clues = []
        words = NarrativeRepository.get_transcript_words(conn, video_id)
        if not words:
            return []
            
        dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
        
        # Helper para encontrar o texto ao redor de um timestamp
        def get_context_text(words_list, index, num_words=5):
            start_idx = max(0, index - num_words)
            end_idx = min(len(words_list), index + num_words + 1)
            return " ".join([words_list[i]['word'] for i in range(start_idx, end_idx)])

        # 1. Pistas de Silêncio
        if enable_silence and silence_threshold > 0:
            for i in range(len(words) - 1):
                w1 = words[i]
                w2 = words[i+1]
                if w1['speaker_id'] == w2['speaker_id']:
                    gap = w2['start_time'] - w1['end_time']
                    if gap >= silence_threshold:
                        clues.append({
                            "type": "silence",
                            "timestamp": round((w1['end_time'] + w2['start_time']) / 2, 2),
                            "duration": round(gap, 2),
                            "context": get_context_text(words, i, 4),
                            "speaker_id": w1['speaker_id']
                        })

        # 2. Pistas de Pergunta
        if enable_questions:
            for i in range(len(words) - 1):
                w1 = words[i]
                w2 = words[i+1]
                if "?" in w1['word'] and w1['speaker_id'] == w2['speaker_id']:
                    clues.append({
                        "type": "question",
                        "timestamp": round(w1['end_time'], 2),
                        "context": get_context_text(words, i, 4),
                        "speaker_id": w1['speaker_id']
                    })

        # 3. Pistas de Rostos
        if enable_faces:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, name, timestamp 
                FROM face 
                WHERE video_id = ? AND name IS NOT NULL AND name != ""
                ORDER BY timestamp
            """, (video_id,))
            faces = [dict(r) for r in cursor.fetchall()]
            
            for f in faces:
                f_time = f['timestamp']
                for dial in dialogues:
                    if dial['start_time'] <= f_time <= dial['end_time']:
                        if dial['speaker_id'] != f['name']:
                            clues.append({
                                "type": "face",
                                "timestamp": round(f_time, 2),
                                "face_id": f['id'],
                                "face_name": f['name'],
                                "speaker_id": dial['speaker_id'],
                                "context": dial['text']
                            })
                            break
                            
        clues = sorted(clues, key=lambda x: x['timestamp'])
        return clues
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/project/{project_id}/chat")
def chatbot_rag(project_id: int, payload: ChatPayload):
    """Interface chatbot RAG (legado) ou Agente de Edição ativo (se timeline for enviada)."""
    if payload.clips is not None:
        from src.services.chat_agent import ChatAgentService
        # Converte TimelineAISuggestClip em dict para o serviço
        clips_dicts = [c.dict() for c in payload.clips]
        tracks_dicts = [t.dict() for t in payload.tracks] if payload.tracks else []
        res = ChatAgentService.chat_with_agent(
            project_id=project_id,
            message=payload.message,
            history=payload.history,
            clips=clips_dicts,
            tracks=tracks_dicts,
            fps=payload.fps,
            agent_model=payload.agent_model,
            custom_api_key=payload.custom_api_key
        )
        return res
    
    res = RAGService.chat(project_id, payload.message, payload.history)
    return res

@router.get("/api/agent/models")
def get_agent_models():
    """Retorna os modelos de agente de edição configurados e o padrão do sistema (Fase 1)."""
    from src.config import CONFIG
    return {
        "models": CONFIG.AGENT_MODELS,
        "default": CONFIG.AGENT_MODEL
    }
