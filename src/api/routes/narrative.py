"""Roteador FastAPI para gerenciamento de Timelines, Transcrições, Temas e Chat RAG."""
import importlib
import json
import re
import shutil
import sqlite3
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Tuple
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, BackgroundTasks, UploadFile
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
    AddThemeSegmentPayload,
    RenderPedidoPayload,
    pedido_render_do_payload
)
from src.core.tasks import TASK_MANAGER
from src.export.video_render import modelo as modelo_render
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.narrative import NarrativeRepository
from src.db.repositories.media import MediaRepository
from src.db.connection import get_db
from src.export.audio_stems import TIPOS_EFEITO_TIPO_A, relatorio_efeitos
from src.services.pipeline import PipelineService
from src.services.rag import RAGService
from src.services.timeline_ai import TimelineAIService
from src.search.semantic import SemanticSearch
from src.export.otio_export import export_timeline_file
from src.export.otio_import import SUPPORTED_EXTENSIONS, import_timeline_file

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
    data = RAGService.search_hybrid(project_id, query, media_type=media_type, limit=limit, offset=offset, return_meta=True)
    return {
        "query": query,
        "results": data.get("results", []),
        "index_status": data.get("index_status", "ok"),
        "warning": data.get("warning")
    }

@router.get("/api/search/visual")
def search_visual(
    query: str = Query(..., min_length=1, alias="q"),
    project_id: int = Query(1),
    limit: int = Query(20),
    shot_scale: Optional[str] = Query(None, description="Faceta E2.D3: detalhe|close|plano_medio|plano_americano|plano_geral|aereo"),
    category: Optional[str] = Query(None, description="Faceta E2.D3: categoria da triagem (obra, processo...)"),
    camera_motion: Optional[str] = Query(None, description="Faceta E2.D3: static|pan|tilt|walk|handheld|whip"),
    palette_temp: Optional[str] = Query(None, description="Faceta E2.D2: quente|neutro|frio"),
):
    """Busca visual pura por CLIP local (texto → imagem, sem custo de API), com facetas."""
    from src.search.image_semantic import ImageSearch, QdrantUnavailableError
    index_status = "ok"
    warning = None
    results = []
    try:
        results = ImageSearch.get_instance().search_text(
            project_id, query, limit=limit,
            shot_scale=shot_scale, category=category, camera_motion=camera_motion,
            palette_temp=palette_temp,
        )
        for r in results:
            r["explanation"] = f"Correspondência visual (CLIP) de {r['score']*100:.0f}% com os termos da busca."
    except QdrantUnavailableError as qe:
        index_status = "unavailable"
        warning = f"Índice de busca indisponível — {qe}"
    except Exception as e:
        index_status = "error"
        warning = f"Erro inesperado na busca visual: {e}"
        print(f"[SearchVisual] Erro inesperado ({type(e).__name__}): {e}")

    return {
        "query": query,
        "results": results,
        "index_status": index_status,
        "warning": warning,
        "facets": {
            "shot_scale": shot_scale, "category": category, "camera_motion": camera_motion,
            "palette_temp": palette_temp,
        }
    }

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

@router.post("/api/project/{project_id}/facets/backfill-shot-scale")
def backfill_shot_scale(project_id: int):
    """Backfill das facetas visuais (E2.D1/D3) para o acervo JÁ indexado.

    Reusa os vetores CLIP gravados na coleção de imagens — não re-extrai nenhum
    frame e não gasta API. Grava por ponto: shot_scale (zero-shot), category
    (triagem no SQLite) e camera_motion (media_segment.motion_label); e persiste
    shot_scale em media_segment (keyframes com segment_id).
    """
    import numpy as np
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    from src.search.image_semantic import ImageSearch
    from src.vision.shot_scale import ShotScaleClassifier
    from src.db.connection import get_db

    img = ImageSearch.get_instance()
    classifier = ShotScaleClassifier.get_instance()

    # Mapas de facetas vindas do SQLite (uma leitura, usada para todos os pontos)
    with get_db() as conn:
        video_cat = {r["id"]: r["category"] for r in conn.execute(
            "SELECT id, category FROM video WHERE project_id = ? AND category IS NOT NULL", (project_id,))}
        photo_cat = {r["id"]: r["category"] for r in conn.execute(
            "SELECT id, category FROM photo WHERE project_id = ? AND category IS NOT NULL", (project_id,))}
        seg_motion = {r["id"]: r["motion_label"] for r in conn.execute(
            "SELECT id, motion_label FROM media_segment WHERE project_id = ? AND motion_label IS NOT NULL", (project_id,))}

    total = 0
    distribution: dict = {}
    segment_updates: list = []
    offset = None
    while True:
        points, offset = img.client.scroll(
            collection_name=img.collection_name,
            scroll_filter=Filter(must=[FieldCondition(key="project_id", match=MatchValue(value=project_id))]),
            limit=256, with_vectors=True, with_payload=True, offset=offset,
        )
        if not points:
            break
        vecs = np.asarray([p.vector for p in points], dtype=np.float32)
        labels = classifier.classify_batch(vecs)
        # set_payload agrupado por conteúdo idêntico (poucos grupos: escala × categoria × movimento)
        by_facets: dict = {}
        for point, (label, score) in zip(points, labels):
            payload = point.payload or {}
            category = video_cat.get(payload.get("video_id")) if payload.get("video_id") is not None \
                else photo_cat.get(payload.get("photo_id"))
            motion = seg_motion.get(payload.get("segment_id"))
            by_facets.setdefault((label, category, motion), []).append(point.id)
            distribution[label] = distribution.get(label, 0) + 1
            if payload.get("segment_id"):
                segment_updates.append((label, round(score, 3), payload["segment_id"]))
            total += 1
        for (label, category, motion), ids in by_facets.items():
            facet_payload = {"shot_scale": label}
            if category:
                facet_payload["category"] = category
            if motion:
                facet_payload["camera_motion"] = motion
            img.client.set_payload(
                collection_name=img.collection_name,
                payload=facet_payload, points=ids,
            )
        if offset is None:
            break

    if segment_updates:
        with get_db() as conn:
            conn.executemany(
                "UPDATE media_segment SET shot_scale = ?, shot_scale_score = ? WHERE id = ?",
                segment_updates,
            )
            conn.commit()

    return {
        "status": "success",
        "points_classified": total,
        "segments_updated": len(segment_updates),
        "distribution": dict(sorted(distribution.items(), key=lambda kv: -kv[1])),
    }

@router.post("/api/project/{project_id}/facets/backfill-palette")
def backfill_palette(project_id: int):
    """Backfill de paleta/temperatura de cor das FOTOS (E2.D2) a partir dos proxies locais.

    OpenCV puro (k-means), custo zero de API. Grava palette_temp/palette_hex no
    SQLite e a faceta palette_temp no payload Qdrant das fotos indexadas.
    Vídeos ficam de fora: keyframes não são retidos em disco — a faceta deles
    entra incrementalmente nas próximas análises.
    """
    import json as _json
    from src.config import CONFIG as _CONFIG
    from src.vision.palette import classify_palette_file
    from src.search.image_semantic import ImageSearch
    from src.db.connection import get_db
    from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny

    with get_db() as conn:
        photos = [dict(r) for r in conn.execute(
            "SELECT id FROM photo WHERE project_id = ? ORDER BY id", (project_id,))]

    updates = []
    distribution: dict = {}
    missing_proxy = 0
    for p in photos:
        proxy = _CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{p['id']}.webp"
        if not proxy.exists():
            missing_proxy += 1
            continue
        palette = classify_palette_file(proxy)
        if not palette:
            continue
        updates.append((palette["palette_temp"], _json.dumps(palette["palette_hex"]), p["id"]))
        distribution[palette["palette_temp"]] = distribution.get(palette["palette_temp"], 0) + 1

    if updates:
        with get_db() as conn:
            conn.executemany(
                "UPDATE photo SET palette_temp = ?, palette_hex = ? WHERE id = ?", updates)
            conn.commit()

        # Faceta no índice visual, agrupada por temperatura (3 chamadas)
        img = ImageSearch.get_instance()
        by_temp: dict = {}
        for temp, _hex, pid in updates:
            by_temp.setdefault(temp, []).append(pid)
        for temp, pids in by_temp.items():
            try:
                img.client.set_payload(
                    collection_name=img.collection_name,
                    payload={"palette_temp": temp},
                    points=Filter(must=[
                        FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                        FieldCondition(key="photo_id", match=MatchAny(any=pids)),
                    ]),
                )
            except Exception as e:
                print(f"[Palette] Falha ao facetar '{temp}' no indice visual: {e}")

    return {
        "status": "success",
        "photos_updated": len(updates),
        "missing_proxy": missing_proxy,
        "distribution": dict(sorted(distribution.items(), key=lambda kv: -kv[1])),
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

def _carregar_sequencia_para_relatorio(timeline_id: int) -> dict:
    """Le a MESMA sequencia que o export leu, pelo mesmo caminho.

    Reproduz exatamente o acesso de `generate_otio_timeline` (SELECT em
    timeline.sequence_json + ProjectRepository.parse_sequence), para o relatorio
    de efeitos enxergar o que foi exportado. E uma segunda leitura leve de uma
    unica linha porque `export_timeline_file` devolve apenas o Path do arquivo
    gerado e nao pode ter sua assinatura alterada (propriedade do agente J1).
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT sequence_json FROM timeline WHERE id = ?", (timeline_id,))
        row = cursor.fetchone()
    if not row:
        raise ValueError(f"Timeline com ID {timeline_id} não encontrada.")
    return ProjectRepository.parse_sequence(row["sequence_json"])


def _tem_efeito_tipo_a(sequencia: dict) -> bool:
    """True se algum clipe FORA de pista de IA tem efeito de Tipo A.

    Espelha o filtro do proprio `relatorio_efeitos` (pistas kind=ai ignoradas):
    como ele grava arquivo mesmo sem nada a relatar, a rota consulta antes para
    nao deixar .txt de acompanhamento numa pasta de export limpa.
    """
    trilhas_ia = {
        str(t.get("id"))
        for t in (sequencia.get("tracks") or [])
        if str(t.get("kind") or "").lower() == "ai"
    }
    for cut in sequencia.get("clips") or []:
        if not isinstance(cut, dict) or str(cut.get("track", "")) in trilhas_ia:
            continue
        for efeito in cut.get("effects") or []:
            if isinstance(efeito, dict) and efeito.get("type") in TIPOS_EFEITO_TIPO_A:
                return True
    return False


@router.get("/api/timeline/{timeline_id}/export/{export_format}")
def export_timeline(timeline_id: int, export_format: str):
    """Exporta a timeline em formato XML/EDL/OTIO e retorna o arquivo para download."""
    if export_format not in ["otio", "xml", "edl"]:
        raise HTTPException(status_code=400, detail="Formato inválido. Use 'otio', 'xml' ou 'edl'.")

    try:
        file_path = export_timeline_file(timeline_id, export_format)
        if not file_path.exists():
            raise HTTPException(status_code=500, detail="O arquivo de timeline não pôde ser gerado.")

        # Acompanhante da secao 10 do plano: relatorio .txt dos efeitos de Tipo A
        # na MESMA pasta do export, com nome derivado dele. O export e o principal:
        # falha ESPERADA aqui (dado invalido, disco cheio, banco travado) vira log e
        # a resposta segue intacta; bug inesperado sobe para o handler de 500.
        relatorio_path: Optional[Path] = None
        try:
            sequencia = _carregar_sequencia_para_relatorio(timeline_id)
            if _tem_efeito_tipo_a(sequencia):
                relatorio_path = relatorio_efeitos(
                    sequencia,
                    file_path.parent,
                    sobrescrever=True,
                    fps=sequencia.get("fps"),
                    nome_arquivo=f"{file_path.stem}_efeitos_audio.txt",
                )
        except (TypeError, ValueError, OSError, sqlite3.Error) as e:
            print(f"[EXPORT] Aviso: relatorio de efeitos de audio nao gerado "
                  f"({type(e).__name__}: {e})")

        media_type = "application/xml" if export_format == "xml" else "text/plain"
        headers = {"X-Capiau-Relatorio-Efeitos": relatorio_path.name} if relatorio_path else None
        return FileResponse(path=str(file_path), filename=file_path.name,
                            media_type=media_type, headers=headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/timeline/import")
async def import_timeline(
    project_id: int = Form(...),
    name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_db_conn)
):
    """Importa um arquivo de timeline (.otio/.xml/.edl) e recria a timeline no projeto.

    É o caminho inverso do export: cada clipe é religado à mídia já ingerida
    (por caminho; fallback por nome único de arquivo). Clipes cuja mídia não
    existe no acervo voltam como `missing_media` — não quebram a importação.
    """
    original_name = Path(file.filename or "").name
    ext = Path(original_name).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Formato '{ext or '?'}' não suportado. Use um dos: {', '.join(SUPPORTED_EXTENSIONS)}."
        )

    proj = conn.execute("SELECT id FROM project WHERE id = ?", (project_id,)).fetchone()
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")

    tmp_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(prefix="capiau_import_", suffix=ext, delete=False) as buf:
            shutil.copyfileobj(file.file, buf)
            tmp_path = Path(buf.name)

        summary = import_timeline_file(
            conn, project_id, tmp_path,
            name_override=name,
            source_filename=original_name
        )
        conn.commit()
        return summary
    except (ValueError, RuntimeError) as e:
        # Conteúdo inválido ou dependência de conversão ausente: erro do cliente.
        conn.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Falha ao importar timeline: {e}")
    finally:
        if tmp_path is not None:
            Path(tmp_path).unlink(missing_ok=True)

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


# ===========================================================================
# Render de vídeo da timeline (docs/PLANO_EXPORTACAO_VIDEO.md, seções 5 e 6;
# pacote D). Três rotas:
#   POST .../render/preflight  -> o que o modal chama AO ABRIR (barato: só banco
#                                 e metadado, nada de abrir mídia nem ffmpeg).
#   POST .../render            -> valida, recusa em bloqueio e ENFILEIRA sem
#                                 segurar o request (padrão da rota de áudio).
#   GET  .../render/ultimo     -> estado do último render para reabrir o modal.
# O trabalho pesado é do pacote C (src/export/video_render/{midia,fidelidade,
# execucao}.py), que está sendo escrito EM PARALELO. Nada aqui pode impedir o
# servidor de subir: os imports desses módulos ficam dentro dos handlers sob
# guarda de ImportError com HTTP 503 legível -- mesma doutrina da rota de
# áudio, que importa src/media/audio_chain.py (contrato F1) dentro do handler.
# Cancelamento NÃO tem rota própria de propósito: já existe a genérica
# POST /api/task/{task_key}/cancel (media.py), usada por todo o app.
# ===========================================================================

def _modulo_motor(nome: str):
    """Importa um módulo do motor (pacote C) sob guarda, ou 503 com motivo claro.

    Por que 503 e não 500: o módulo ausente é estado ESPERADO desta instalação
    enquanto o pacote C não chega ao disco -- a rota existe, o motor é quem
    ainda não está disponível. A mensagem nomeia o arquivo exato para o
    revisor conciliar sem caçar o erro no traceback.
    """
    caminho = f"src.export.video_render.{nome}"
    try:
        return importlib.import_module(caminho)
    except (ImportError, SyntaxError) as err:
        # SyntaxError junto do ImportError: os modulos do motor sao escritos em
        # paralelo e um arquivo pego EM MEIO A ESCRITA quebra na compilacao -- e
        # o mesmo estado esperado de "ainda nao disponivel", com o erro real
        # ecoado na mensagem em vez de escondido.
        raise HTTPException(
            status_code=503,
            detail=(f"O motor de render de vídeo ainda não está disponível nesta "
                    f"instalação (módulo '{caminho}' ausente ou com erro de "
                    f"importação: {err}). O servidor segue no ar; só esta rota "
                    f"fica fora até o módulo do pacote C existir."))


def _motor_presente(nome: str) -> bool:
    """True se o módulo do motor pode ser importado, SEM importá-lo.

    find_spec não executa o módulo: serve para o preflight avisar 'motor
    instalado/não instalado' de graça, sem risco de disparar efeito colateral.
    """
    import importlib.util
    try:
        return importlib.util.find_spec(f"src.export.video_render.{nome}") is not None
    except (ImportError, ValueError):
        return False


def _carregar_timeline_render(timeline_id: int, conn: sqlite3.Connection) -> dict:
    """(nome, sequence_json normalizado v2) da timeline, ou 404.

    Leitura única e leve: SELECT de uma linha + parse_sequence (json.loads puro,
    sem tocar disco/mídia). É o mesmo acesso do export OTIO, então preflight e
    render enxergam exatamente a sequência que seria exportada.
    """
    row = conn.execute(
        "SELECT id, name, sequence_json FROM timeline WHERE id = ?", (timeline_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404,
                            detail=f"Timeline {timeline_id} não encontrada.")
    try:
        sequencia = ProjectRepository.parse_sequence(row["sequence_json"])
    except Exception as err:
        raise HTTPException(
            status_code=500,
            detail=f"sequence_json da timeline {timeline_id} está corrompido: {err}")
    return {"nome": str(row["name"] or ""), "sequencia": sequencia}


def _montar_seq_e_pedido(timeline_id: int, payload: RenderPedidoPayload,
                         dados: dict) -> Tuple["modelo_render.Sequencia", "modelo_render.Pedido"]:
    """Normaliza a sequência e converte o corpo em Pedido; ValueError vira 400.

    A conversão mora em schemas.pedido_render_do_payload (ponto único); aqui só
    traduzimos os erros dela e o clamp da faixa contra a duração real.
    """
    seq = modelo_render.normalizar(dados["sequencia"], nome=dados["nome"],
                                   timeline_id=timeline_id)
    try:
        pedido = pedido_render_do_payload(timeline_id, payload)
        # Validação antecipada da faixa contra a duração REAL (in_out vazio ou
        # além do fim): falhar aqui é barato, falhar no worker custa uma fila.
        pedido.faixa.resolver(seq.duracao_s())
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    return seq, pedido


def _chamar_midia(seq: "modelo_render.Sequencia",
                  pedido: "modelo_render.Pedido"):
    """Chama o resolver de fontes do pacote C. -> (bruto | None, erro | None).

    Exatamente UM dos dois volta preenchido: o relatório bruto quando o módulo
    respondeu (vai cru para o fidelidade, que o contrato manda ele receber);
    ou uma resposta degrada LEGÍVEL (disponivel=false + motivo) para o cliente,
    enquanto src/export/video_render/midia.py não existir nesta instalação.
    Módulo presente sem a função combinada NÃO é adaptado em silêncio -- vira
    motivo explícito para o pacote C/revisor conciliarem o nome. Exceção DENTRO
    do resolver não é engolida: bug de motor tem de aparecer como 500.
    """
    try:
        from src.export.video_render import midia
    except (ImportError, SyntaxError) as err:
        # SyntaxError: modulo do motor pego em meio a escrita (mesmo tratamento
        # de _modulo_motor -- estado esperado, erro real ecoado).
        return None, {"disponivel": False,
                      "motivo": ("Módulo 'src/export/video_render/midia.py' ainda não "
                                 f"está utilizável nesta instalação ({err}). O relatório "
                                 "de mídia fica em branco -- isto NÃO significa que não "
                                 "falta nada; significa que ainda não dá para saber.")}
    resolver = getattr(midia, "resolver_fontes", None)
    if not callable(resolver):
        return None, {"disponivel": False,
                      "motivo": ("Módulo 'midia' presente mas sem a função esperada "
                                 "resolver_fontes(seq, pedido). Sem adaptação "
                                 "silenciosa: o pacote C publica este nome (ou relata "
                                 "a mudança) e o revisor concilia este ponto.")}
    return resolver(seq, pedido), None


def _empacotar_relatorio_motor(bruto) -> dict:
    """Resposta do motor em formato JSON-serializável, SEM inventar campo.

    dict -> como veio; dataclass -> fields + properties públicas (o RelatorioMidia
    entregue pelo pacote C em 24/08 expõe 'recusado' como PROPERTY, que asdict()
    não traz); qualquer outra coisa -> repr marcado, nunca silêncio.
    """
    import dataclasses
    if isinstance(bruto, dict):
        return {"disponivel": True, **bruto}
    if dataclasses.is_dataclass(bruto) and not isinstance(bruto, type):
        corpo = dataclasses.asdict(bruto)
        for nome in dir(bruto):
            if nome.startswith("_") or nome in corpo:
                continue
            atributo = getattr(bruto, nome)
            if callable(atributo):
                continue
            corpo[nome] = atributo
        return {"disponivel": True, **corpo}
    return {"disponivel": True, "relatorio": repr(bruto)}


def _chamar_fidelidade(seq: "modelo_render.Sequencia",
                       pedido: "modelo_render.Pedido",
                       relatorio_midia_bruto) -> dict:
    """Banner âmbar do pacote C (limitações do motor para ESTE pedido).

    Recebe o relatório de mídia BRUTO porque o contrato combinado é
    relatorio(seq, pedido, relatorio_midia). Mesma disciplina da mídia:
    ausência degrada com motivo legível; divergência de interface fica
    explícita; exceção real sobe como 500.
    """
    try:
        from src.export.video_render import fidelidade
    except (ImportError, SyntaxError) as err:
        # Mesmo tratamento de _chamar_midia: arquivo em meio a escrita e estado
        # esperado, com o erro real na mensagem.
        return {"disponivel": False,
                "motivo": ("Módulo 'src/export/video_render/fidelidade.py' ainda não "
                           f"está utilizável nesta instalação ({err}). O banner de "
                           "fidelidade fica em branco -- nenhuma limitação foi "
                           "verificada.")}
    gerar = getattr(fidelidade, "relatorio", None)
    if not callable(gerar):
        return {"disponivel": False,
                "motivo": ("Módulo 'fidelidade' presente mas sem a função esperada "
                           "relatorio(seq, pedido, relatorio_midia). Sem adaptação "
                           "silenciosa: conciliar nome com o pacote C.")}
    return _empacotar_relatorio_motor(gerar(seq, pedido, relatorio_midia_bruto))


def _bloqueios_de_midia(resposta_midia) -> list:
    """Bloqueios no formato QUE O PACOTE C ENTREGOU (midia.py, 24/08).

    Lá a recusa é sinalizada pelo agregado 'recusas' (lista de textos humanos;
    'recusado' é a property que resume). Cada texto vira um item de nível
    'block' na resposta do preflight e na guarda da rota de render.
    """
    if not isinstance(resposta_midia, dict) or not resposta_midia.get("disponivel"):
        return []
    recusas = resposta_midia.get("recusas")
    if not isinstance(recusas, list):
        return bool(resposta_midia.get("recusado")) and \
            [{"origem": "midia", "nivel": "block",
              "mensagem": "O relatório de mídia marcou recusa sem listar os motivos."}] or []
    return [{"origem": "midia", "nivel": "block", "mensagem": str(r)}
            for r in recusas if r]


def _avisos_bloqueantes(relatorio) -> list:
    """Extrai avisos de nível 'block' do formato contratado do fidelidade
    ('dict com avisos'; severidade em 'nivel', com 'level' aceito também POR
    ENQUANTO enquanto o módulo não chega ao disco -- quando chegar, o revisor
    concilia e isto aqui fica de uma forma só).

    Qualquer outra forma (sem lista 'avisos', sem severidade) NÃO bloqueia:
    recusar render por um campo que não sabemos ler seria pior que deixar
    passar com o aviso visível no preflight.
    """
    if not isinstance(relatorio, dict):
        return []
    avisos = relatorio.get("avisos")
    if not isinstance(avisos, list):
        return []
    bloqueios = []
    for aviso in avisos:
        if not isinstance(aviso, dict):
            continue
        nivel = str(aviso.get("nivel") or aviso.get("level") or "").strip().lower()
        if nivel == "block":
            bloqueios.append(aviso)
    return bloqueios


_SLUG_SEGURO = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


def _resolver_saida(pedido: "modelo_render.Pedido", nome_timeline: str) -> dict:
    """Pasta resolvida + nome sugerido, na ordem: override do pedido > Configurações.

    Pasta relativa nas configurações é ancorada na raiz do app (CONFIG.BASE_DIR),
    igual às demais pastas de data/. Extensão sai do container do override (o
    plano trava MP4 nesta rodada, mas o campo já aceita mov/mkv/webm sem mentir
    na sugestão).
    """
    from src.config import CONFIG
    from src.services.settings_service import SettingsService

    pasta = pedido.saida.diretorio or str(
        SettingsService.get_settings().get("render.output_dir") or "data/exports/renders")
    caminho = Path(pasta)
    if not caminho.is_absolute():
        caminho = CONFIG.BASE_DIR / caminho

    ext = str(pedido.overrides.get("container") or "mp4").lower().lstrip(".")
    slug = _SLUG_SEGURO.sub("_", (nome_timeline or "").strip()).strip(" .") \
        or f"timeline_{pedido.timeline_id}"
    carimbo = datetime.now().strftime("%Y-%m-%d_%H%M")
    nome = pedido.saida.nome_arquivo or f"{slug}_{carimbo}.{ext}"
    if "." not in Path(nome).name:
        nome = f"{nome}.{ext}"
    return {
        "diretorio": str(caminho),
        "nome_arquivo_sugerido": Path(nome).name,
        "caminho_previsto": str(caminho / Path(nome).name),
    }


def _contexto_preflight(timeline_id: int, payload: RenderPedidoPayload,
                        conn: sqlite3.Connection) -> Tuple[dict, "modelo_render.Pedido"]:
    """Tudo que o preflight responde, compartilhado com a rota de render.

    Barato de propósito: SELECT no banco, normalização em memória e checagens
    de existência feitas pelo próprio pacote C quando ele estiver presente.
    Nenhum ffprobe, nenhum decode, nenhum ffmpeg neste caminho.
    """
    dados = _carregar_timeline_render(timeline_id, conn)
    seq, pedido = _montar_seq_e_pedido(timeline_id, payload, dados)

    duracao = seq.duracao_s()
    ids_ia = {p.id for p in seq.pistas if p.e_ia}          # P1: pista IA nunca renderiza
    clipes_no_render = [c for c in seq.clipes if c.track not in ids_ia]

    por_pista: dict = {}
    for clipe in seq.clipes:
        por_pista[clipe.track] = por_pista.get(clipe.track, 0) + 1

    pistas = [{
        "id": p.id, "nome": p.nome, "kind": p.kind,
        "muted": p.muted, "hidden": p.hidden, "locked": p.locked,
        # P7/P8: hidden inicializa o toggle do escopo; locked é só edição.
        "incluida_no_escopo": pedido.escopo.pista_ligada(p.id),
        # P1: pista de IA NUNCA entra no render -- explícito aqui para o modal
        # não montar um toggle que promete o que o motor não faz.
        "entra_no_render": not p.e_ia,
        "clipes": por_pista.get(p.id, 0),
    } for p in sorted(seq.pistas, key=lambda p: p.ordem)]

    ini_s, fim_s = pedido.faixa.resolver(duracao)

    midia_bruto, midia_erro = _chamar_midia(seq, pedido)
    midia_resp = midia_erro if midia_erro is not None \
        else _empacotar_relatorio_motor(midia_bruto)
    fidelidade_resp = _chamar_fidelidade(seq, pedido, midia_bruto)
    # Cada fonte de bloqueio e lida COMO ELA E: a midia entregue pelo pacote C
    # recusa pelo agregado 'recusas'/'recusado'; o fidelidade (contrato do
    # pacote D) por avisos de nivel 'block'. Nenhum e forcado no formato do outro.
    bloqueios = _bloqueios_de_midia(midia_resp) + _avisos_bloqueantes(fidelidade_resp)

    resposta = {
        "ok": True,
        "timeline_id": timeline_id,
        "nome": dados["nome"],
        "kind": pedido.kind,
        "duracao_s": round(duracao, 3),
        "fps": seq.fps,
        "resolucao": {"largura": seq.largura, "altura": seq.altura},
        "clipes_total": len(seq.clipes),
        "clipes_no_render": len(clipes_no_render),
        "clipes_por_pista": por_pista,
        "faixa": {"modo": pedido.faixa.modo,
                  "inicio_s": round(ini_s, 3), "fim_s": round(fim_s, 3)},
        # As pistas REAIS, dinâmicas -- o modal NUNCA assume V1/V2/A1/A2.
        "pistas": pistas,
        "categorias_escopo": {c: pedido.escopo.categoria_ligada(c)
                              for c in modelo_render.CATEGORIAS},
        "midia": midia_resp,
        "fidelidade": fidelidade_resp,
        "bloqueios": bloqueios,
        "saida": _resolver_saida(pedido, dados["nome"]),
        "motor_disponivel": _motor_presente("execucao"),
    }
    return resposta, pedido


@router.post("/api/timeline/{timeline_id}/render/preflight")
def render_preflight(timeline_id: int,
                     payload: Optional[RenderPedidoPayload] = None,
                     conn: sqlite3.Connection = Depends(get_db_conn)):
    """Diagnóstico do modal de exportação: NÃO renderiza nada.

    Chamado ao ABRIR o modal com o mesmo corpo do render (preflight depende do
    kind e do escopo escolhidos). Corpo ausente vale master/full/tudo-ligado,
    para a primeira abertura funcionar antes de qualquer interação. Devolve
    duração/contagens/fps/resolução, as pistas REAIS para montar os toggles de
    escopo, o relatório de mídia, os avisos de fidelidade (banner âmbar), os
    bloqueios de nível 'block' e a saída sugerida.
    """
    payload = payload or RenderPedidoPayload(kind=modelo_render.TIPO_MASTER)
    contexto, _pedido = _contexto_preflight(timeline_id, payload, conn)
    return contexto


@router.post("/api/timeline/{timeline_id}/render")
def render_timeline_video(timeline_id: int,
                          payload: RenderPedidoPayload,
                          conn: sqlite3.Connection = Depends(get_db_conn)):
    """Valida, recusa em bloqueio e ENFILEIRA o render -- nunca segura o request.

    Guardas ANTES de qualquer custo (espírito da rota de áudio): timeline
    existe? tem clipe fora da pista de IA? faixa IN-OUT é válida? há aviso de
    nível 'block'? já não há render desta timeline na fila? Só depois disso o
    pacote C entra, via execucao.enfileirar(pedido), que devolve task_key e a
    saída prevista. O cliente acompanha pelo TASK_MANAGER (GET /api/tasks) e
    cancela pela genérica POST /api/task/{task_key}/cancel.
    """
    contexto, pedido = _contexto_preflight(timeline_id, payload, conn)

    if contexto["clipes_no_render"] == 0:
        raise HTTPException(
            status_code=400,
            detail=("Esta timeline não tem clipe nenhum fora da pista de IA; "
                    "não há o que renderizar."))

    if contexto["bloqueios"]:
        raise HTTPException(
            status_code=400,
            detail=("Render recusado pelo preflight (midia ausente/indisponivel ou "
                    "aviso de nivel 'block'): "
                    + json.dumps(contexto["bloqueios"], ensure_ascii=False,
                                 default=str)[:1500]))

    # Um render por timeline por vez (a fila é sequencial): duplicar entrada só
    # criaria dois trabalhos disputando a mesma chave e a mesma saída.
    progresso_atual = TASK_MANAGER.get_progress().get(pedido.chave_tarefa)
    if progresso_atual and progresso_atual.get("status") in ("running", "pending"):
        raise HTTPException(
            status_code=409,
            detail=(f"Já existe um render desta timeline em andamento "
                    f"({pedido.chave_tarefa}). Acompanhe na aba Tarefas ou cancele "
                    f"por POST /api/task/{pedido.chave_tarefa}/cancel."))

    modulo_execucao = _modulo_motor("execucao")   # 503 legível se o pacote C não chegou
    enfileirar = getattr(modulo_execucao, "enfileirar", None)
    if not callable(enfileirar):
        raise HTTPException(
            status_code=503,
            detail=("Módulo 'execucao' presente mas sem a função esperada "
                    "enfileirar(pedido) -> {'task_key', 'saida_prevista'}. Sem "
                    "adaptação silenciosa: conciliar a interface com o pacote C."))
    despacho = enfileirar(pedido)
    task_key = (despacho or {}).get("task_key")
    saida_prevista = (despacho or {}).get("saida_prevista")
    if not task_key or not saida_prevista:
        raise HTTPException(
            status_code=503,
            detail=(f"'execucao.enfileirar' devolveu {despacho!r}; o contrato combina "
                    "em {'task_key': str, 'saida_prevista': str}. Sem adaptação "
                    "silenciosa: conciliar com o pacote C."))

    aviso_registro = _gravar_registro_ultimo(pedido, task_key, saida_prevista)

    resposta = {"ok": True, "status": "pending",
                "task_key": task_key, "saida_prevista": saida_prevista,
                # Alias do §6 do plano (output_path_previsto) para consumidores
                # que seguiram o plano à letra; mesmo valor de saida_prevista.
                "output_path_previsto": saida_prevista,
                "chave_tarefa": pedido.chave_tarefa,
                "acompanhamento": "GET /api/tasks (aba Tarefas) ou GET .../render/ultimo",
                "cancelamento": f"POST /api/task/{task_key}/cancel"}
    if aviso_registro:
        resposta["aviso_registro"] = aviso_registro
    return resposta


def _caminho_registro_ultimo(timeline_id: int) -> "Path":
    """Arquivo .ultimo_<id>.json na MESMA pasta configurada como destino.

    JSON simples de propósito (decisão da tarefa): resultado de último render
    não merece tabela nova no banco. Enquanto o pacote C não persiste resultado
    próprio, este registro guarda o último ENFILEIRAMENTO (parâmetros + task_key
    + saída prevista); o estado vivo vem do TASK_MANAGER na leitura.
    """
    from src.config import CONFIG
    from src.services.settings_service import SettingsService
    pasta = Path(str(SettingsService.get_settings().get("render.output_dir")
                     or "data/exports/renders"))
    if not pasta.is_absolute():
        pasta = CONFIG.BASE_DIR / pasta
    return pasta / f".ultimo_{int(timeline_id)}.json"


def _gravar_registro_ultimo(pedido: "modelo_render.Pedido", task_key: str,
                            saida_prevista: str) -> Optional[str]:
    """Grava o registro do enfileiramento. Falha de disco NÃO derruba o render:
    o trabalho já está na fila; devolve o aviso para a resposta em vez de 500.
    """
    registro = {
        "timeline_id": pedido.timeline_id,
        "task_key": task_key,
        "saida_prevista": saida_prevista,
        "kind": pedido.kind,
        "preset": pedido.preset,
        "faixa": {"modo": pedido.faixa.modo,
                  "inicio_s": pedido.faixa.inicio_s,
                  "fim_s": pedido.faixa.fim_s},
        "escopo": {"categorias": pedido.escopo.categorias,
                   "pistas": pedido.escopo.pistas},
        "overrides": pedido.overrides,
        "allow_proxy_fallback": pedido.permitir_fallback_proxy,
        "pos": {"abrir_pasta": pedido.pos.abrir_pasta,
                "copiar_caminho": pedido.pos.copiar_caminho,
                "salvar_como": pedido.pos.salvar_como,
                "ingerir": pedido.pos.ingerir},
        "enfileirado_em": datetime.now().isoformat(timespec="seconds"),
        "fonte": "pacote-d",
    }
    try:
        caminho = _caminho_registro_ultimo(pedido.timeline_id)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text(json.dumps(registro, ensure_ascii=False, indent=2),
                           encoding="utf-8")
    except OSError as err:
        print(f"[RenderVideo] Aviso: registro .ultimo_{pedido.timeline_id}.json nao "
              f"gravado ({type(err).__name__}: {err})")
        return f"Registro local não gravado ({err}); o render continua normalmente."
    return None


@router.get("/api/timeline/{timeline_id}/render/ultimo")
def ultimo_render_timeline(timeline_id: int):
    """Resultado do último render, para o modal reabrir com estado.

    Combina três fontes, sem tabela nova no banco:
      1. registro local .ultimo_<id>.json (parâmetros do último enfileiramento);
      2. estado vivo do TASK_MANAGER pela chave render_timeline_<id> (morre ao
         reiniciar o servidor);
      3. stat do arquivo previsto (existência, tamanho, data), que sobrevive.
    404 só quando NENHUMA das três sabe algo desta timeline.
    """
    registro = None
    try:
        caminho = _caminho_registro_ultimo(timeline_id)
        if caminho.exists():
            registro = json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        print(f"[RenderVideo] Aviso: registro .ultimo_{timeline_id}.json ilegivel "
              f"({type(err).__name__}: {err})")

    task_key = (registro or {}).get("task_key") or f"render_timeline_{timeline_id}"
    progresso = TASK_MANAGER.get_progress().get(task_key)

    arquivo = None
    previsto = (registro or {}).get("saida_prevista")
    if previsto:
        previsto_path = Path(previsto)
        arquivo = {"path": previsto, "existe": previsto_path.exists()}
        if arquivo["existe"]:
            try:
                stat = previsto_path.stat()
                arquivo["tamanho_bytes"] = stat.st_size
                arquivo["modificado_em"] = datetime.fromtimestamp(
                    stat.st_mtime).isoformat(timespec="seconds")
            except OSError as err:
                arquivo["erro_stat"] = str(err)

    if registro is None and progresso is None and not (arquivo and arquivo["existe"]):
        raise HTTPException(
            status_code=404,
            detail=f"Nenhum render encontrado para a timeline {timeline_id} "
                   "(sem registro local, sem tarefa viva e sem arquivo na saída prevista).")

    if progresso:
        estado = progresso.get("status")
    elif arquivo and arquivo.get("existe"):
        # Servidor reiniciou entre o render e esta consulta: o TASK_MANAGER não
        # lembra mais, mas o arquivo está lá. Não afirmamos 'finished' -- só o
        # que a evidência permite.
        estado = "arquivo_presente_sem_registro_de_tarefa"
    else:
        estado = "desconhecido"

    return {
        "ok": True,
        "timeline_id": timeline_id,
        "estado": estado,
        "registro": registro,
        "tarefa": progresso,
        "arquivo": arquivo,
        "fonte": "registro_local(.ultimo_.json) + TASK_MANAGER + stat do arquivo",
    }
