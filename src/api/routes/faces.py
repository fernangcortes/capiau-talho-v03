"""Rotas FastAPI para reconhecimento facial em cascata.

Endpoints para deteccao, refinamento, clustering, desambiguacao manual
e consulta de faces com resolucao de conflitos por precedencia.
"""
from typing import List, Optional, Dict, Any
from pathlib import Path
import json
import sqlite3
import cv2
import numpy as np
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse, RedirectResponse

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.entities import EntityRepository
from src.nlp.enrichment_engine import enrich_after_face_labeling, enrich_photo, enrich_video_frames, enrich_in_background
from src.services.face_service import get_face_service, FaceService
from src.vision.face_pipeline import get_pipeline, FacePipeline
from src.vision.cv_utils import imread_unicode, imwrite_unicode

router = APIRouter(prefix="/api/faces", tags=["Faces"])


# ── Schemas Pydantic ──

class FaceDetectionResponse(BaseModel):
    face_id: int
    bounding_box: List[float]
    quality_score: Optional[float]
    confidence: float
    crop_path: Optional[str]
    model: str
    tier: int

class FaceDetailResponse(BaseModel):
    id: int
    project_id: int
    name: Optional[str]
    cluster_id: Optional[int]
    bounding_box: List[float]
    photo_id: Optional[int]
    video_id: Optional[int]
    timestamp: Optional[float]
    quality_score: Optional[float]
    crop_path: Optional[str]
    recognition: Optional[dict]
    all_recognitions: List[dict]

class PersonCreateRequest(BaseModel):
    name: str
    aliases: Optional[List[str]] = []
    bio: Optional[str] = ""

class PersonResponse(BaseModel):
    id: int
    project_id: int
    name: str
    aliases: Optional[str]
    bio: Optional[str]

class ClusterResult(BaseModel):
    total_faces: int
    clustered_faces: int
    clusters_created: int
    noise_faces: int

class MergeClustersRequest(BaseModel):
    src_cluster_id: int
    dest_cluster_id: int
    name: str

class ReassignFacesRequest(BaseModel):
    face_ids: List[int]
    target_cluster_id: int
    target_name: str

class DissociateFacesRequest(BaseModel):
    face_ids: List[int]

class ConfirmIdentityRequest(BaseModel):
    face_id: int
    person_id: int
    user_id: Optional[str] = "manual"

class PipelineStatusResponse(BaseModel):
    available_tiers: List[int]
    backends: List[dict]

class LabelFaceRequest(BaseModel):
    name: str

class RenameNameRequest(BaseModel):
    old_name: str
    new_name: str

class DeleteNameRequest(BaseModel):
    name: str

class MergeNamesRequest(BaseModel):
    src_name: str
    dest_name: str

class RejectFaceRequest(BaseModel):
    name: Optional[str] = None

class S3StatusResponse(BaseModel):
    enabled: bool
    bucket_name: Optional[str] = None
    region: str
    connection_ok: bool
    total_size_gb: float
    cost_limit_reached: bool

class ManualFaceCreate(BaseModel):
    project_id: int
    video_id: Optional[int] = None
    photo_id: Optional[int] = None
    timestamp: Optional[float] = None
    bounding_box: List[float]
    name: str
    text_to_replace: Optional[str] = None
    entity_type: Optional[str] = None  # 'person' | 'object' | 'location' (heurística se ausente)


# ── Helpers ──

def _clear_old_name_mentions(conn: sqlite3.Connection, project_id: int, face_ids: List[int], new_name: Optional[str]) -> None:
    """Remove as menções das entidades antigas de rostos que mudaram de nome,
    se não restar nenhum outro rosto com o mesmo nome na respectiva foto/frame de vídeo.
    """
    if not face_ids or not project_id:
        return
    cursor = conn.cursor()
    # 1. Obter informações de cada face antes de atualizar
    qmarks = ",".join("?" * len(face_ids))
    cursor.execute(f"SELECT id, name, photo_id, video_id, timestamp FROM face WHERE id IN ({qmarks})", face_ids)
    face_rows = [dict(r) for r in cursor.fetchall()]
    
    for r in face_rows:
        fid = r["id"]
        old_name = r["name"]
        
        # Se não tinha nome antigo, ou se o nome antigo é igual ao novo nome (normalizado), não faz nada
        if not old_name or (new_name and old_name.strip().lower() == new_name.strip().lower()):
            continue
            
        # Obter o id da entidade correspondente ao nome antigo na tabela entity
        cursor.execute("SELECT id FROM entity WHERE project_id = ? AND name = ? COLLATE NOCASE", (project_id, old_name))
        ent_row = cursor.fetchone()
        if not ent_row:
            continue
            
        entity_id = ent_row["id"]
        photo_id = r["photo_id"]
        video_id = r["video_id"]
        timestamp = r["timestamp"]
        
        # Verificar se restou alguma OUTRA face na mesma foto/frame com esse mesmo nome antigo
        if photo_id is not None:
            cursor.execute("SELECT id FROM face WHERE photo_id = ? AND name = ? AND id != ?", (photo_id, old_name, fid))
        else:
            cursor.execute("SELECT id FROM face WHERE video_id = ? AND ABS(timestamp - ?) <= 0.1 AND name = ? AND id != ?", (video_id, timestamp, old_name, fid))
            
        other_face = cursor.fetchone()
        if not other_face:
            # Deleta a menção da entidade antiga pois não há mais rostos com ela nessa mídia/frame
            if photo_id is not None:
                cursor.execute("""
                    DELETE FROM entity_mention 
                    WHERE entity_id = ? AND project_id = ? AND photo_id = ?
                """, (entity_id, project_id, photo_id))
            else:
                cursor.execute("""
                    DELETE FROM entity_mention 
                    WHERE entity_id = ? AND project_id = ? AND video_id = ? AND ABS(timestamp - ?) <= 0.1
                """, (entity_id, project_id, video_id, timestamp))


def _register_person_entity_mentions(project_id: int, name: str, face_ids: List[int]) -> None:
    """Registra a pessoa na camada de entidades + uma menção por face rotulada."""
    try:
        with get_db() as conn:
            entity_id = EntityRepository.upsert_entity(conn, project_id, name, "person")
            cursor = conn.cursor()
            qmarks = ",".join("?" * len(face_ids))
            cursor.execute(f"SELECT photo_id, video_id, timestamp FROM face WHERE id IN ({qmarks})", face_ids)
            for r in cursor.fetchall():
                EntityRepository.add_mention(
                    conn, entity_id, project_id,
                    photo_id=r["photo_id"], video_id=r["video_id"], timestamp=r["timestamp"],
                    source="face_recognition", status="confirmed"
                )
            conn.commit()
    except Exception as e:
        print(f"[Entities] Falha ao registrar menções da pessoa '{name}': {e}")


def _recover_photo_faces_task(project_id: int) -> None:
    """Recuperação completa de rostos em fotos (para acervos ingeridos antes da detecção):

    1. Detecta rostos localmente (YuNet/SFace) em todas as fotos SEM detecção prévia.
    2. Re-clusteriza o projeto inteiro — fotos herdam os nomes já rotulados nos vídeos.
    3. Registra as menções na camada de entidades.
    4. Re-enriquece as descrições do projeto (nomes entram no texto + reindexação).

    NÃO refaz nenhuma análise de visão paga — só detecção local + reescrita barata.
    """
    from src.core.tasks import TASK_MANAGER
    from src.vision.face_engine import process_photo_faces
    from src.nlp.enrichment_engine import enrich_project

    task_key = f"recover-faces-{project_id}"
    try:
        TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="faces")

        # 1. Fotos sem nenhuma face detectada
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT p.id, p.filepath FROM photo p
                WHERE p.project_id = ? AND p.status != 'error'
                  AND NOT EXISTS (SELECT 1 FROM face f WHERE f.photo_id = p.id)
                ORDER BY p.id
            """, (project_id,))
            pending = [(r["id"], r["filepath"]) for r in cursor.fetchall()]

        total = len(pending)
        print(f"[RECOVER] {total} fotos sem detecção facial. Iniciando varredura local...")

        detected_photos = 0
        for idx, (photo_id, filepath) in enumerate(pending):
            if idx % 10 == 0:
                TASK_MANAGER.update_progress(task_key, (idx / max(total, 1)) * 70.0, "running", task_type="faces")
            proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
            target = proxy if proxy.exists() else Path(filepath)
            if not target.exists():
                continue
            try:
                process_photo_faces(project_id, photo_id, target)
                detected_photos += 1
            except Exception as fe:
                print(f"[RECOVER] Falha na foto {photo_id}: {fe}")

        # 2. Re-clustering global (nomes reais propagam para as novas faces)
        TASK_MANAGER.update_progress(task_key, 75.0, "running", task_type="faces")
        service = get_face_service()
        cluster_result = service.cluster_project_faces(project_id)
        print(f"[RECOVER] Clustering: {cluster_result}")

        # 3. Menções de entidades para as faces nomeadas (fotos e vídeos)
        TASK_MANAGER.update_progress(task_key, 85.0, "running", task_type="faces")
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, name, photo_id, video_id, timestamp FROM face
                WHERE project_id = ? AND name IS NOT NULL AND name != ''
                  AND name NOT LIKE 'Pessoa Desconhecida%'
                  AND name NOT IN ('Não Relevante', 'Não é Rosto')
            """, (project_id,))
            named = cursor.fetchall()
            for r in named:
                entity_id = EntityRepository.upsert_entity(conn, project_id, r["name"], "person")
                EntityRepository.add_mention(
                    conn, entity_id, project_id,
                    photo_id=r["photo_id"], video_id=r["video_id"], timestamp=r["timestamp"],
                    source="face_recognition", status="confirmed"
                )
            conn.commit()

        # 4. Reescrita das descrições com os nomes + reindexação semântica
        TASK_MANAGER.update_progress(task_key, 90.0, "running", task_type="faces")
        enrich_result = enrich_project(project_id)

        TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="faces")
        print(f"[RECOVER] Concluído: {detected_photos} fotos varridas, "
              f"{len(named)} faces nomeadas, enriquecimento: {enrich_result}")
    except Exception as e:
        print(f"[RECOVER] Erro crítico na recuperação de rostos: {e}")
        TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="faces")


@router.post("/project/{project_id}/recover-photo-faces")
def recover_photo_faces(project_id: int):
    """Dispara em background: detecção facial nas fotos sem detecção + re-clustering
    (herança de nomes) + menções de entidades + enriquecimento das descrições."""
    import threading
    threading.Thread(target=_recover_photo_faces_task, args=(project_id,), daemon=True).start()
    return {
        "status": "success",
        "message": "Recuperação de rostos iniciada em background. Acompanhe na aba Tarefas. "
                   "Ao final, as descrições de fotos e vídeos serão reescritas com os nomes."
    }


# ── Rotas ──

@router.get("/pipeline/status", response_model=PipelineStatusResponse)
def get_pipeline_status():
    """Retorna status dos backends disponiveis no pipeline."""
    pipeline = get_pipeline()
    
    backends = []
    for tier in pipeline.available_tiers:
        backend = pipeline.get_backend(tier)
        backends.append({
            "tier": backend.tier,
            "name": backend.name,
            "model": backend.model_name,
            "available": backend.is_available,
            "free": backend.is_free
        })
    
    return PipelineStatusResponse(
        available_tiers=pipeline.available_tiers,
        backends=backends
    )


@router.get("/pipeline/s3/status", response_model=S3StatusResponse)
def get_s3_status():
    """Retorna o status da integracao S3, tamanho do bucket e travas de seguranca."""
    from src.services.s3_service import S3Service
    s3_service = S3Service.get_instance()
    
    total_size_gb = 0.0
    cost_limit_reached = False
    connection_ok = False
    
    if s3_service.enabled:
        connection_ok = True
        total_size_gb = s3_service.get_bucket_total_size_gb()
        cost_limit_reached = total_size_gb >= 150.0
        
    return S3StatusResponse(
        enabled=s3_service.enabled,
        bucket_name=s3_service.bucket_name,
        region=s3_service.region,
        connection_ok=connection_ok,
        total_size_gb=round(total_size_gb, 4),
        cost_limit_reached=cost_limit_reached
    )


@router.post("/pipeline/install-insightface")
def install_insightface(gpu: bool = Query(False, description="Instalar versão com suporte a GPU (onnxruntime-gpu)")):
    """Instala o InsightFace e dependências de runtime (onnxruntime) no Python local."""
    import subprocess
    import sys
    package = "onnxruntime-gpu" if gpu else "onnxruntime"
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "insightface", package])
        
        # Reinicializa os backends do pipeline para recarregar o InsightFace
        pipeline = get_pipeline()
        pipeline._init_backends()
        return {
            "status": "success", 
            "message": f"InsightFace e {package} instalados com sucesso! O backend local Tier 3 foi re-ativado."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha na instalação: {str(e)}")


@router.post("/face")
def add_manual_face(payload: ManualFaceCreate):
    """Insere manualmente uma face ou objeto desenhado pelo usuario no frame/foto."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Encontrar ou criar a pessoa/objeto no banco
        cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (payload.project_id, payload.name))
        row = cursor.fetchone()
        if row:
            person_id = row["id"]
        else:
            cursor.execute("INSERT INTO person (project_id, name) VALUES (?, ?)", (payload.project_id, payload.name))
            person_id = cursor.lastrowid
            
        crop_path = f"text:{payload.text_to_replace}" if payload.text_to_replace else None

        # Inserir na tabela face
        cursor.execute("""
            INSERT INTO face (project_id, cluster_id, bounding_box, photo_id, video_id, timestamp, name, crop_path)
            VALUES (?, -1, ?, ?, ?, ?, ?, ?)
        """, (payload.project_id, json.dumps(payload.bounding_box), payload.photo_id, payload.video_id, payload.timestamp, payload.name, crop_path))
        face_id = cursor.lastrowid
        
        # Inserir o vinculo na tabela face_recognition como manual/confirmado (Tier 4)
        cursor.execute("""
            INSERT INTO face_recognition (face_id, tier, model, model_version, person_id, confidence, status, recognized_by)
            VALUES (?, 4, 'manual', 'v1.0', ?, 1.0, 'confirmed', 'user')
        """, (face_id, person_id))
        
        # ── Camada de Entidades: registra a entidade canônica + menção confirmada ──
        # Heurística de tipo: com trecho de texto vinculado ou bounding box vazia = objeto;
        # caso contrário (rosto desenhado/pessoa), pessoa.
        entity_type = payload.entity_type
        if entity_type not in ("person", "object", "location", "other"):
            is_boxless = not payload.bounding_box or all(v == 0 for v in payload.bounding_box)
            entity_type = "object" if (payload.text_to_replace or is_boxless) else "person"

        try:
            entity_id = EntityRepository.upsert_entity(conn, payload.project_id, payload.name, entity_type)
            EntityRepository.add_mention(
                conn, entity_id, payload.project_id,
                photo_id=payload.photo_id, video_id=payload.video_id,
                timestamp=payload.timestamp,
                source="text_link" if payload.text_to_replace else "human_audit",
                status="confirmed",
                text_to_replace=payload.text_to_replace
            )
        except Exception as ent_err:
            print(f"[Entities] Falha ao registrar entidade manual: {ent_err}")

        # Grafo relacional + indexação semântica da anotação para busca
        if payload.video_id:
            cursor.execute("""
                INSERT INTO relation (project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
                VALUES (?, 'video', ?, 'features_element', 'theme', ?, 1.0)
            """, (payload.project_id, str(payload.video_id), payload.name))

            try:
                from src.search.semantic import SemanticSearch
                search_engine = SemanticSearch.get_instance()
                search_engine.index_annotation(
                    project_id=payload.project_id,
                    video_id=payload.video_id,
                    start_time=payload.timestamp or 0.0,
                    end_time=(payload.timestamp or 0.0) + 2.0,
                    text=f"Elemento/Objeto marcado pelo usuário: {payload.name}"
                )
            except Exception as qdrant_err:
                print(f"[Qdrant] Falha ao indexar objeto manual no Qdrant: {qdrant_err}")

        conn.commit()

    # Reescreve e reindexa as descrições afetadas em background (LLM + Qdrant)
    # if payload.photo_id:
    #     enrich_in_background(enrich_photo, payload.project_id, payload.photo_id)
    # elif payload.video_id and payload.timestamp is not None:
    #     enrich_in_background(enrich_video_frames, payload.project_id, payload.video_id, [payload.timestamp])
    pass

    return {"status": "success", "face_id": face_id, "person_id": person_id}


@router.post("/photo/{photo_id}/detect", response_model=dict)
def detect_faces_photo(
    photo_id: int,
    project_id: int = Query(..., description="ID do projeto"),
    image_path: str = Query(..., description="Caminho absoluto da imagem")
):
    """Executa deteccao facial Tier 0 em uma foto."""
    service = get_face_service()
    path = Path(image_path)
    
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Imagem nao encontrada: {image_path}")
    
    count = service.detect_faces_in_photo(project_id, photo_id, path)
    
    return {
        "photo_id": photo_id,
        "faces_detected": count,
        "tier": 0,
        "model": "yunet_sface",
        "message": f"{count} rostos detectados e salvos"
    }


@router.post("/video/{video_id}/frame/detect", response_model=dict)
def detect_faces_video_frame(
    video_id: int,
    project_id: int = Query(..., description="ID do projeto"),
    timestamp: float = Query(..., description="Timestamp do frame em segundos"),
    image_path: str = Query(..., description="Caminho absoluto do frame")
):
    """Executa deteccao facial Tier 0 em um frame de video."""
    service = get_face_service()
    path = Path(image_path)
    
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Frame nao encontrado: {image_path}")
    
    count = service.detect_faces_in_video_frame(project_id, video_id, timestamp, path)
    
    return {
        "video_id": video_id,
        "timestamp": timestamp,
        "faces_detected": count,
        "tier": 0,
        "model": "yunet_sface"
    }


@router.post("/face/{face_id}/refine", response_model=dict)
def refine_face(
    face_id: int,
    image_path: str = Query(..., description="Caminho da imagem para reprocessar"),
    max_tier: int = Query(2, description="Tier maximo para refinamento (1-2)")
):
    """Refina uma face com tiers superiores (Azure/AWS)."""
    service = get_face_service()
    path = Path(image_path)
    
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Imagem nao encontrada: {image_path}")
    
    result = service.refine_face(face_id, path, max_tier=max_tier)
    
    if result is None:
        return {"message": "Nenhum backend disponivel para refinamento", "refined": False}
    
    if result.error:
        return {"refined": False, "error": result.error, "tier": result.tier}
    
    return {
        "face_id": face_id,
        "refined": True,
        "tier": result.tier,
        "model": result.model_name,
        "detections": len(result.detections),
        "processing_time_ms": result.processing_time_ms,
        "cost_usd": result.cost_usd
    }


@router.post("/face/{face_id}/precise", response_model=dict)
def process_face_precise(
    face_id: int,
    image_path: str = Query(..., description="Caminho da imagem para processamento de precisao")
):
    """Processa uma face com Tier 3 (InsightFace GPU) para maxima precisao."""
    service = get_face_service()
    path = Path(image_path)
    
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Imagem nao encontrada: {image_path}")
    
    result = service.process_with_precision(face_id, path)
    
    if result is None:
        return {"message": "InsightFace indisponivel (GPU/CPU fallback falhou)", "processed": False}
    
    if result.error:
        return {"processed": False, "error": result.error}
    
    return {
        "face_id": face_id,
        "processed": True,
        "tier": result.tier,
        "model": result.model_name,
        "detections": len(result.detections),
        "processing_time_ms": result.processing_time_ms,
        "embeddings_512d": len([r for r in result.recognitions if r.embedding])
    }


@router.get("/project/{project_id}/faces", response_model=List[dict])
def get_project_faces(
    project_id: int,
    media_type: Optional[str] = Query(None, description="Filtrar por 'video' ou 'photo'"),
    media_id: Optional[int] = Query(None, description="ID da midia especifica")
):
    """Retorna todas as faces do projeto com reconhecimento autoritativo."""
    service = get_face_service()
    faces = service.get_project_faces(project_id, media_type, media_id)
    return faces


@router.get("/face/{face_id}", response_model=dict)
def get_face_detail(face_id: int):
    """Retorna detalhes completos de uma face com todos os reconhecimentos."""
    service = get_face_service()
    face = service.get_face_detail(face_id)
    
    if not face:
        raise HTTPException(status_code=404, detail=f"Face {face_id} nao encontrada")
    
    return face


@router.post("/project/{project_id}/faces/cluster", response_model=ClusterResult)
def cluster_faces(
    project_id: int,
    eps: float = Query(0.38, description="Distancia maxima DBSCAN"),
    min_samples: int = Query(2, description="Minimo de amostras por cluster")
):
    """Clusteriza todas as faces do projeto usando DBSCAN."""
    service = get_face_service()
    result = service.cluster_project_faces(project_id, eps=eps, min_samples=min_samples)
    return ClusterResult(
        total_faces=result["total"],
        clustered_faces=result["clustered"],
        clusters_created=result["clusters"],
        noise_faces=result["noise"]
    )


@router.post("/project/{project_id}/people", response_model=PersonResponse)
def create_person(project_id: int, request: PersonCreateRequest):
    """Cria uma nova pessoa no projeto."""
    service = get_face_service()
    person_id = service.create_person(
        project_id=project_id,
        name=request.name,
        aliases=request.aliases,
        bio=request.bio
    )
    return PersonResponse(
        id=person_id,
        project_id=project_id,
        name=request.name,
        aliases=json.dumps(request.aliases),
        bio=request.bio
    )


@router.get("/project/{project_id}/people", response_model=List[PersonResponse])
def get_project_people(project_id: int):
    """Retorna todas as pessoas identificadas no projeto."""
    service = get_face_service()
    people = service.get_project_people(project_id)
    return [PersonResponse(
        id=p["id"],
        project_id=p["project_id"],
        name=p["name"],
        aliases=p.get("aliases"),
        bio=p.get("bio")
    ) for p in people]


@router.post("/project/{project_id}/faces/merge")
def merge_project_clusters(project_id: int, request: MergeClustersRequest):
    """Mescla dois clusters em um unico."""
    service = get_face_service()
    
    # Limpar menções antigas das faces do cluster de origem antes de mesclar/renomear
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM face WHERE project_id = ? AND cluster_id = ?", (project_id, request.src_cluster_id))
        src_face_ids = [r["id"] for r in cursor.fetchall()]
        _clear_old_name_mentions(conn, project_id, src_face_ids, request.name)
        conn.commit()

    service.merge_clusters(project_id, request.src_cluster_id, request.dest_cluster_id, request.name)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE face SET name = ? WHERE project_id = ? AND cluster_id = ?",
                       (request.name, project_id, request.dest_cluster_id))
        cursor.execute("SELECT id FROM face WHERE project_id = ? AND cluster_id = ?", (project_id, request.dest_cluster_id))
        merged_face_ids = [r["id"] for r in cursor.fetchall()]
        conn.commit()

    if merged_face_ids:
        _register_person_entity_mentions(project_id, request.name, merged_face_ids)
    # enrich_in_background(enrich_after_face_labeling, project_id, cluster_id=request.dest_cluster_id)
    pass

    return {"status": "success", "message": f"Cluster {request.src_cluster_id} mesclado com {request.dest_cluster_id}"}


@router.post("/project/{project_id}/faces/reassign")
def reassign_project_faces(project_id: int, request: ReassignFacesRequest):
    """Reatribui faces de forma unitaria (desambiguacao manual)."""
    service = get_face_service()
    
    target_cluster_id = request.target_cluster_id
    target_name = request.target_name.strip()
    
    # Se target_cluster_id nao for informado ou for negativo/invalido, tenta descobrir ou criar novo
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Limpar menções antigas das faces antes de aplicar novo nome/reassociar
        _clear_old_name_mentions(conn, project_id, request.face_ids, target_name)
        
        # Se tem nome, verificar se ja existe um cluster_id associado a esse nome
        if target_name:
            cursor.execute("""
                SELECT DISTINCT cluster_id FROM face 
                WHERE project_id = ? AND name = ? AND cluster_id IS NOT NULL AND cluster_id >= 0
                LIMIT 1
            """, (project_id, target_name))
            row = cursor.fetchone()
            if row:
                target_cluster_id = row["cluster_id"]
            elif target_cluster_id is None or target_cluster_id < 0:
                # Gerar um novo cluster_id unico para o projeto
                cursor.execute("SELECT MAX(cluster_id) as max_cid FROM face WHERE project_id = ? AND cluster_id IS NOT NULL", (project_id,))
                max_row = cursor.fetchone()
                max_cid = max_row["max_cid"] if max_row and max_row["max_cid"] is not None else -1
                target_cluster_id = max_cid + 1

    # Encontrar ou criar a pessoa no banco
    if target_name:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, target_name))
            row = cursor.fetchone()
            if row:
                person_id = row["id"]
            else:
                cursor.execute("INSERT INTO person (project_id, name) VALUES (?, ?)", (project_id, target_name))
                person_id = cursor.lastrowid
                conn.commit()
    else:
        person_id = None
        
    for fid in request.face_ids:
        # Reatribuir a face para o cluster e nome corretos
        service.reassign_face(fid, target_cluster_id, target_name)
        if person_id is not None:
            service.confirm_face_identity(fid, person_id)
            
    if target_name:
        _register_person_entity_mentions(project_id, target_name, request.face_ids)
    # enrich_in_background(enrich_after_face_labeling, project_id, face_ids=request.face_ids)
    pass

    return {"status": "success", "message": f"{len(request.face_ids)} faces reatribuídas com sucesso.", "target_cluster_id": target_cluster_id}


@router.post("/confirm-identity")
def confirm_identity(request: ConfirmIdentityRequest):
    """Operador confirma manualmente a identidade de uma face (Tier 4)."""
    service = get_face_service()
    success = service.confirm_face_identity(
        request.face_id, request.person_id, request.user_id
    )
    
    if not success:
        raise HTTPException(status_code=500, detail="Erro ao confirmar identidade")
    
    return {
        "face_id": request.face_id,
        "person_id": request.person_id,
        "status": "confirmed",
        "tier": 4,
        "message": "Identidade confirmada manualmente"
    }


# ── NOVAS ROTAS PORTADAS DE MEDIA.PY ──

@router.get("/project/{project_id}/face-clusters")
def list_project_face_clusters(project_id: int):
    """Lista todos os grupos de rostos agrupados no projeto."""
    try:
        with get_db() as conn:
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


@router.get("/project/{project_id}/unlabeled-faces")
def list_unlabeled_faces(project_id: int):
    """Retorna rostos nao rotulados (ou placeholders) para desambiguacao rapida."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT f.id, f.bounding_box, f.photo_id, f.video_id, f.timestamp, f.name, f.cluster_id,
                       p.filename as photo_filename, p.filepath as photo_filepath,
                       v.filename as video_filename, v.filepath as video_filepath
                FROM face f
                LEFT JOIN photo p ON f.photo_id = p.id
                LEFT JOIN video v ON f.video_id = v.id
                WHERE f.project_id = ? AND (f.name IS NULL OR TRIM(f.name) = '' OR f.name LIKE 'Pessoa Desconhecida%')
                ORDER BY f.cluster_id DESC, f.id DESC
                LIMIT 1000
            """, (project_id,))
            rows = cursor.fetchall()
            
            res = []
            for r in rows:
                row_dict = dict(r)
                if row_dict["video_id"] is not None:
                    proxy_rel = f"proxy_vid_{row_dict['video_id']}.mp4"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        row_dict["video_proxy_path"] = f"/proxies/{proxy_rel}"
                    else:
                        from src.services.s3_service import S3Service
                        s3_service = S3Service.get_instance()
                        if s3_service.enabled:
                            s3_key = f"proxies/{proxy_rel}"
                            presigned_url = s3_service.generate_presigned_url(s3_key)
                            row_dict["video_proxy_path"] = presigned_url
                        else:
                            row_dict["video_proxy_path"] = None
                else:
                    row_dict["video_proxy_path"] = None
                
                if row_dict["photo_id"] is not None:
                    proxy_rel = f"photos/proxy_photo_{row_dict['photo_id']}.webp"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        row_dict["photo_proxy_path"] = f"/proxies/{proxy_rel}"
                    else:
                        row_dict["photo_proxy_path"] = None
                else:
                    row_dict["photo_proxy_path"] = None
                    
                res.append(row_dict)
            return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/project/{project_id}/face-clusters/{cluster_id}/faces")
def list_cluster_faces(project_id: int, cluster_id: int, name: Optional[str] = None):
    """Retorna todas as faces individuais de um cluster com paths de midias para preview."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            if name is not None:
                if name == "":
                    cursor.execute("""
                        SELECT f.id, f.bounding_box, f.photo_id, f.video_id, f.timestamp, f.name, f.cluster_id,
                               p.filename as photo_filename, p.filepath as photo_filepath,
                               v.filename as video_filename, v.filepath as video_filepath
                        FROM face f
                        LEFT JOIN photo p ON f.photo_id = p.id
                        LEFT JOIN video v ON f.video_id = v.id
                        WHERE f.project_id = ? AND f.cluster_id = ? AND f.name IS NULL
                        ORDER BY f.id DESC
                    """, (project_id, cluster_id))
                else:
                    cursor.execute("""
                        SELECT f.id, f.bounding_box, f.photo_id, f.video_id, f.timestamp, f.name, f.cluster_id,
                               p.filename as photo_filename, p.filepath as photo_filepath,
                               v.filename as video_filename, v.filepath as video_filepath
                        FROM face f
                        LEFT JOIN photo p ON f.photo_id = p.id
                        LEFT JOIN video v ON f.video_id = v.id
                        WHERE f.project_id = ? AND f.cluster_id = ? AND f.name = ?
                        ORDER BY f.id DESC
                    """, (project_id, cluster_id, name))
            else:
                cursor.execute("""
                    SELECT f.id, f.bounding_box, f.photo_id, f.video_id, f.timestamp, f.name, f.cluster_id,
                           p.filename as photo_filename, p.filepath as photo_filepath,
                           v.filename as video_filename, v.filepath as video_filepath
                    FROM face f
                    LEFT JOIN photo p ON f.photo_id = p.id
                    LEFT JOIN video v ON f.video_id = v.id
                    WHERE f.project_id = ? AND f.cluster_id = ?
                    ORDER BY f.id DESC
                """, (project_id, cluster_id))
            rows = cursor.fetchall()
            
            res = []
            for r in rows:
                row_dict = dict(r)
                if row_dict["video_id"] is not None:
                    proxy_rel = f"proxy_vid_{row_dict['video_id']}.mp4"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        row_dict["video_proxy_path"] = f"/proxies/{proxy_rel}"
                    else:
                        from src.services.s3_service import S3Service
                        s3_service = S3Service.get_instance()
                        if s3_service.enabled:
                            s3_key = f"proxies/{proxy_rel}"
                            presigned_url = s3_service.generate_presigned_url(s3_key)
                            row_dict["video_proxy_path"] = presigned_url
                        else:
                            row_dict["video_proxy_path"] = None
                else:
                    row_dict["video_proxy_path"] = None
                
                if row_dict["photo_id"] is not None:
                    proxy_rel = f"photos/proxy_photo_{row_dict['photo_id']}.webp"
                    if (CONFIG.PROXIES_DIR / proxy_rel).exists():
                        row_dict["photo_proxy_path"] = f"/proxies/{proxy_rel}"
                    else:
                        row_dict["photo_proxy_path"] = None
                else:
                    row_dict["photo_proxy_path"] = None
                    
                res.append(row_dict)
            return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/project/{project_id}/faces/dissociate")
def dissociate_project_faces(project_id: int, request: DissociateFacesRequest):
    """Remove a identificação de um conjunto de faces, voltando a serem desconhecidas."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Limpar as menções antigas antes de desassociar
            _clear_old_name_mentions(conn, project_id, request.face_ids, None)
            
            for fid in request.face_ids:
                # 1. Recuperar info da face
                cursor.execute("SELECT name, photo_id, video_id, timestamp, cluster_id FROM face WHERE id = ?", (fid,))
                face_row = cursor.fetchone()
                if not face_row:
                    continue
                
                cluster_id = face_row["cluster_id"]
                
                # 2. Desconfirmar/supersede reconhecimento manual do usuário
                cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE face_id = ?", (fid,))
                
                # 3. Atualizar nome na face para o placeholder padrão se tiver cluster_id, senão NULL
                if cluster_id is not None and cluster_id >= 0:
                    placeholder_name = f"Pessoa Desconhecida (Grupo {cluster_id + 1})"
                else:
                    placeholder_name = None
                
                cursor.execute("UPDATE face SET name = ? WHERE id = ?", (placeholder_name, fid))
            
            conn.commit()
            
        # Re-enriquecer em background
        # enrich_in_background(enrich_after_face_labeling, project_id, face_ids=request.face_ids)
        pass
        
        return {"status": "success", "message": f"{len(request.face_ids)} faces desassociadas com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/face/{face_id}/label")
def label_face(face_id: int, payload: LabelFaceRequest):
    """Rotula uma face ou cluster de faces inteiro, gerenciando conflitos."""
    service = get_face_service()
    face = service._get_face(face_id)
    if not face:
        raise HTTPException(status_code=404, detail="Face nao encontrada")
    
    project_id = face["project_id"]
    current_cluster_id = face["cluster_id"]
    new_name = payload.name.strip()
    
    if not new_name:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE face SET name = NULL WHERE id = ?", (face_id,))
            cursor.execute("""
                UPDATE face_recognition 
                SET status = 'superseded' 
                WHERE face_id = ? AND status = 'confirmed'
            """, (face_id,))
            conn.commit()
        return {"status": "success", "message": "Rotulo removido com sucesso."}
    
    # Verificar conflito entre clusters
    if current_cluster_id is not None and current_cluster_id >= 0:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT cluster_id FROM face 
                WHERE project_id = ? AND name = ? AND cluster_id != ? AND cluster_id >= 0
            """, (project_id, new_name, current_cluster_id))
            row_conflict = cursor.fetchone()
            if row_conflict:
                existing_cluster_id = row_conflict["cluster_id"]
                return {
                    "status": "conflict",
                    "message": f"O nome '{new_name}' ja esta associado ao Grupo {existing_cluster_id + 1}. Deseja mesclar os grupos?",
                    "target_name": new_name,
                    "current_cluster_id": current_cluster_id,
                    "existing_cluster_id": existing_cluster_id
                }
    
    # Encontrar ou criar a pessoa no banco
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, new_name))
        row = cursor.fetchone()
        if row:
            person_id = row["id"]
        else:
            cursor.execute("INSERT INTO person (project_id, name) VALUES (?, ?)", (project_id, new_name))
            person_id = cursor.lastrowid
            conn.commit()
    
    # Confirmar identidade de todas as faces no mesmo cluster (ou apenas esta)
    if current_cluster_id is not None and current_cluster_id >= 0:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM face WHERE project_id = ? AND cluster_id = ?", (project_id, current_cluster_id))
            face_ids = [r["id"] for r in cursor.fetchall()]
            
            # Limpar menções antigas das faces do grupo que mudarão de nome
            _clear_old_name_mentions(conn, project_id, face_ids, new_name)
            conn.commit()

        for fid in face_ids:
            service.confirm_face_identity(fid, person_id)

        # Atualizar cache de nomes na tabela face
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE face SET name = ? WHERE project_id = ? AND cluster_id = ?", (new_name, project_id, current_cluster_id))
            conn.commit()

        _register_person_entity_mentions(project_id, new_name, face_ids)
        # enrich_in_background(enrich_after_face_labeling, project_id, cluster_id=current_cluster_id)

        return {"status": "success", "message": f"Todas as faces do Grupo {current_cluster_id + 1} foram rotuladas como '{new_name}'."}
    else:
        with get_db() as conn:
            # Limpar menção antiga da face individual
            _clear_old_name_mentions(conn, project_id, [face_id], new_name)
            conn.commit()

        service.confirm_face_identity(face_id, person_id)
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE face SET name = ? WHERE id = ?", (new_name, face_id))
            conn.commit()

        _register_person_entity_mentions(project_id, new_name, [face_id])
        # enrich_in_background(enrich_after_face_labeling, project_id, face_ids=[face_id])

        return {"status": "success", "message": f"Rosto ID {face_id} rotulado individualmente como '{new_name}'."}


@router.get("/face/{face_id}/thumbnail")
def get_face_thumbnail(face_id: int):
    """Retorna o thumbnail da face, priorizando cache/crop_path para máxima velocidade."""
    try:
        # 1. Tentar ler os dados da face, incluindo o crop_path pré-salvo
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT f.bounding_box, f.photo_id, f.video_id, f.timestamp, f.crop_path,
                       p.filepath as photo_path, v.filepath as video_path
                FROM face f
                LEFT JOIN photo p ON f.photo_id = p.id
                LEFT JOIN video v ON f.video_id = v.id
                WHERE f.id = ?
            """, (face_id,))
            row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Face não encontrada.")

        # Cache headers padrão de 7 dias para thumbnails
        cache_headers = {"Cache-Control": "public, max-age=604800, immutable"}

        # 2. Prioridade Máxima: se já existe crop_path gravado no DB e o arquivo existe
        if row["crop_path"]:
            crop_p = Path(row["crop_path"])
            if not crop_p.exists():
                # Tenta resolver relativo ao BASE_DIR ou usando apenas o nome
                crop_p = CONFIG.BASE_DIR / crop_p
                if not crop_p.exists():
                    crop_p = CONFIG.BASE_DIR / "data/crops" / Path(row["crop_path"]).name
            
            if crop_p.exists():
                return FileResponse(str(crop_p), media_type="image/jpeg", headers=cache_headers)
            else:
                # Tenta buscar no S3 se ativado
                from src.services.s3_service import S3Service
                s3_service = S3Service.get_instance()
                if s3_service.enabled:
                    s3_key = f"crops/{crop_p.name}"
                    presigned_url = s3_service.generate_presigned_url(s3_key)
                    if presigned_url:
                        from fastapi.responses import RedirectResponse
                        return RedirectResponse(presigned_url)

        # 3. Segunda Prioridade: verificar se já existe crop dinâmico em temp_crops
        temp_dir = CONFIG.CACHE_DIR / "temp_crops"
        temp_dir.mkdir(exist_ok=True, parents=True)
        out_crop_path = temp_dir / f"face_thumb_{face_id}.jpg"
        if out_crop_path.exists():
            return FileResponse(str(out_crop_path), media_type="image/jpeg", headers=cache_headers)

        # 4. Fallback: extração e corte dinâmicos (lento, apenas se não tiver crop em disco)
        if not row["bounding_box"]:
            raise HTTPException(status_code=404, detail="Bounding box não encontrada para corte dinâmico.")

        bbox = json.loads(row["bounding_box"])
        rx, ry, rw, rh = bbox

        img_path = None
        temp_frame_path = None

        if row["photo_id"] is not None:
            proxy_rel = f"photos/proxy_photo_{row['photo_id']}.webp"
            proxy_path = CONFIG.PROXIES_DIR / proxy_rel
            if proxy_path.exists():
                img_path = proxy_path
            else:
                img_path = Path(row["photo_path"])
                if not img_path.exists():
                    proj_rel_path = CONFIG.BASE_DIR / img_path
                    if proj_rel_path.exists():
                        img_path = proj_rel_path
                    else:
                        orig_path = CONFIG.ORIGINALS_DIR / img_path.name
                        if orig_path.exists():
                            img_path = orig_path
        elif row["video_id"] is not None:
            video_path = Path(row["video_path"])
            if not video_path.exists():
                proj_rel_path = CONFIG.BASE_DIR / video_path
                if proj_rel_path.exists():
                    video_path = proj_rel_path
                else:
                    orig_path = CONFIG.ORIGINALS_DIR / video_path.name
                    if orig_path.exists():
                        video_path = orig_path
                    else:
                        proxy_rel = f"proxy_vid_{row['video_id']}.mp4"
                        proxy_path = CONFIG.PROXIES_DIR / proxy_rel
                        if proxy_path.exists():
                            video_path = proxy_path
                
            if video_path.exists():
                from src.vision.multimodal_engine import extract_frame_ffmpeg
                temp_frame_path = temp_dir / f"crop_vid_{row['video_id']}_ts_{int(row['timestamp'])}s.jpg"
                
                # Só extrai se o frame base temporário não existir
                if not temp_frame_path.exists():
                    extract_frame_ffmpeg(video_path, row["timestamp"], temp_frame_path)
                
                if temp_frame_path.exists():
                    img_path = temp_frame_path

        if not img_path or not img_path.exists():
            raise HTTPException(status_code=404, detail="Mídia física original não encontrada para corte dinâmico.")

        img = None
        ext = img_path.suffix.lower()
        raw_extensions = {'.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'}
        if ext in raw_extensions:
            try:
                import rawpy
                with rawpy.imread(str(img_path)) as raw:
                    rgb = raw.postprocess(half_size=True, use_camera_wb=True)
                    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            except Exception as raw_err:
                print(f"[Faces API] Erro ao ler RAW {img_path.name} via rawpy: {raw_err}")
                img = None
        
        if img is None:
            img = imread_unicode(img_path)
            
        if img is None:
            raise HTTPException(status_code=500, detail="Erro ao ler imagem original para corte dinâmico.")

        h, w = img.shape[:2]
        x, y, bw, bh = int(rx * w), int(ry * h), int(rw * w), int(rh * h)
        
        pad_x, pad_y = int(bw * 0.2), int(bh * 0.2)
        x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
        x2, y2 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
        
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            raise HTTPException(status_code=500, detail="Crop dinâmico inválido.")
            
        imwrite_unicode(out_crop_path, crop)
        return FileResponse(str(out_crop_path), media_type="image/jpeg", headers=cache_headers)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/{video_id}/faces", response_model=List[dict])
def get_video_faces_compat(video_id: int):
    """Retorna rostos do video com compatibilidade."""
    service = get_face_service()
    # Buscar projeto associado ao video
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video nao encontrado")
        project_id = row["project_id"]
        
    faces = service.get_project_faces(project_id, "video", video_id)
    res = []
    for f in faces:
        rec = f.get("recognition")
        if rec and rec.get("recognized_by") == "user":
            res.append({
                "id": f["id"],
                "name": f["name"],
                "bounding_box": json.loads(f["bounding_box"]),
                "timestamp": f["timestamp"]
            })
    return res


@router.get("/photo/{photo_id}/faces", response_model=List[dict])
def get_photo_faces_compat(photo_id: int):
    """Retorna rostos da foto com compatibilidade."""
    service = get_face_service()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Foto nao encontrada")
        project_id = row["project_id"]
        
    faces = service.get_project_faces(project_id, "photo", photo_id)
    return [{
        "id": f["id"],
        "name": f["name"],
        "bounding_box": json.loads(f["bounding_box"])
    } for f in faces]


@router.post("/face/{face_id}/reject")
def reject_face(face_id: int, payload: Optional[RejectFaceRequest] = None):
    """Marca uma face como rejeitada/nao relevante (nao e rosto) e opcionalmente especifica o objeto."""
    target_name = "Não Relevante"
    if payload and payload.name:
        stripped = payload.name.strip()
        if stripped:
            target_name = stripped

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id FROM face WHERE id = ?", (face_id,))
        face_row_init = cursor.fetchone()
        if not face_row_init:
            raise HTTPException(status_code=404, detail="Face nao encontrada")
        
        project_id = face_row_init["project_id"]
        
        # Limpar menções antigas da face
        _clear_old_name_mentions(conn, project_id, [face_id], target_name)
        
        # Marcar reconhecimentos anteriores como 'superseded'
        cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE face_id = ?", (face_id,))
        
        # Inserir um registro com status 'rejected'
        cursor.execute("""
            INSERT INTO face_recognition (face_id, tier, model, model_version, person_id, confidence, status, recognized_by)
            VALUES (?, 4, 'manual', 'v1.0', NULL, 0.0, 'rejected', 'user')
        """, (face_id,))
        
        # Limpar o nome e salvar o nome do objeto (ou 'Não Relevante')
        cursor.execute("UPDATE face SET name = ? WHERE id = ?", (target_name, face_id))
        cursor.execute("SELECT project_id, photo_id, video_id, timestamp FROM face WHERE id = ?", (face_id,))
        face_row = cursor.fetchone()
        conn.commit()

    # Se o usuário identificou um OBJETO (não apenas descartou), registra como entidade
    if target_name != "Não Relevante" and face_row:
        try:
            with get_db() as conn:
                entity_id = EntityRepository.upsert_entity(conn, face_row["project_id"], target_name, "object")
                EntityRepository.add_mention(
                    conn, entity_id, face_row["project_id"],
                    photo_id=face_row["photo_id"], video_id=face_row["video_id"],
                    timestamp=face_row["timestamp"], source="human_audit", status="confirmed"
                )
                conn.commit()
            # enrich_in_background(enrich_after_face_labeling, face_row["project_id"], face_ids=[face_id])
        except Exception as e:
            print(f"[Entities] Falha ao registrar objeto rejeitado: {e}")

    return {"status": "success", "message": f"Face rejeitada com sucesso (rotulada como '{target_name}')."}


@router.post("/project/{project_id}/names/rename")
def rename_project_name(project_id: int, request: RenameNameRequest):
    """Renomeia uma pessoa/falante globalmente no projeto, atualizando rostos, falas e entidades."""
    old_name = request.old_name.strip()
    new_name = request.new_name.strip()
    if not old_name or not new_name:
        raise HTTPException(status_code=400, detail="Nomes antigo e novo não podem ser vazios.")
    if old_name == new_name:
        return {"status": "success", "message": "Nomes são idênticos, nada a fazer."}

    from src.db.repositories.narrative import NarrativeRepository
    from src.db.repositories.media import MediaRepository
    from src.search.semantic import SemanticSearch

    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Atualizar na tabela face
        cursor.execute("""
            UPDATE face 
            SET name = ? 
            WHERE project_id = ? AND name = ?
        """, (new_name, project_id, old_name))
        
        # 2. Atualizar na tabela transcript (falas de videos do projeto)
        cursor.execute("""
            UPDATE transcript 
            SET speaker_id = ? 
            WHERE speaker_id = ? AND video_id IN (SELECT id FROM video WHERE project_id = ?)
        """, (new_name, old_name, project_id))
        
        # 3. Atualizar na tabela person (se existir)
        cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, new_name))
        new_person_row = cursor.fetchone()
        
        cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, old_name))
        old_person_row = cursor.fetchone()
        
        if old_person_row:
            old_pid = old_person_row["id"]
            if new_person_row:
                new_pid = new_person_row["id"]
                # Mesclar reconhecimentos e deletar registro antigo
                cursor.execute("UPDATE face_recognition SET person_id = ? WHERE person_id = ?", (new_pid, old_pid))
                cursor.execute("DELETE FROM person WHERE id = ?", (old_pid,))
            else:
                cursor.execute("UPDATE person SET name = ? WHERE id = ?", (new_name, old_pid))
        
        # 4. Atualizar na tabela entity
        cursor.execute("SELECT id FROM entity WHERE project_id = ? AND name = ?", (project_id, new_name))
        new_entity_row = cursor.fetchone()
        
        cursor.execute("SELECT id FROM entity WHERE project_id = ? AND name = ?", (project_id, old_name))
        old_entity_row = cursor.fetchone()
        
        if old_entity_row:
            old_eid = old_entity_row["id"]
            if new_entity_row:
                new_eid = new_entity_row["id"]
                cursor.execute("UPDATE entity_mention SET entity_id = ? WHERE entity_id = ?", (new_eid, old_eid))
                cursor.execute("DELETE FROM entity WHERE id = ?", (old_eid,))
            else:
                cursor.execute("UPDATE entity SET name = ? WHERE id = ?", (new_name, old_eid))
                
        # Obter videos afetados para reindexação do Qdrant
        cursor.execute("""
            SELECT DISTINCT video_id FROM transcript 
            WHERE speaker_id = ? AND video_id IN (SELECT id FROM video WHERE project_id = ?)
        """, (new_name, project_id))
        video_ids = [r["video_id"] for r in cursor.fetchall()]
        
        conn.commit()

    # Reindexar fora do bloco do banco para evitar manter conexão travada
    try:
        search_engine = SemanticSearch.get_instance()
        with get_db() as conn:
            for vid in video_ids:
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, vid)
                if dialogues:
                    video = MediaRepository.get_video(conn, vid)
                    v_type = video['video_type'] if video else 'interview'
                    search_engine.index_transcript_chunks(project_id, vid, dialogues, v_type)
    except Exception as e:
        print(f"[Names] Erro ao reindexar transcrições no Qdrant: {e}")

    return {"status": "success", "message": f"Nome renomeado de '{old_name}' para '{new_name}' com sucesso."}


@router.post("/project/{project_id}/names/delete")
def delete_project_name(project_id: int, request: DeleteNameRequest):
    """Remove a associação de um nome/falante globalmente no projeto (faces, falas, pessoa, entidades)."""
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome não pode ser vazio.")

    from src.db.repositories.narrative import NarrativeRepository
    from src.db.repositories.media import MediaRepository
    from src.search.semantic import SemanticSearch

    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Resetar na tabela face (desassociar, name = NULL)
        cursor.execute("""
            UPDATE face 
            SET name = NULL 
            WHERE project_id = ? AND name = ?
        """, (project_id, name))
        
        # 2. Resetar na tabela transcript (voltar para 'Desconhecido')
        cursor.execute("""
            UPDATE transcript 
            SET speaker_id = 'Desconhecido' 
            WHERE speaker_id = ? AND video_id IN (SELECT id FROM video WHERE project_id = ?)
        """, (name, project_id))
        
        # 3. Remover da tabela person e resetar reconhecimentos
        cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, name))
        person_row = cursor.fetchone()
        if person_row:
            pid = person_row["id"]
            cursor.execute("UPDATE face_recognition SET person_id = NULL, status = 'auto' WHERE person_id = ?", (pid,))
            cursor.execute("DELETE FROM person WHERE id = ?", (pid,))
            
        # 4. Remover da tabela entity e entity_mention
        cursor.execute("SELECT id FROM entity WHERE project_id = ? AND name = ?", (project_id, name))
        entity_row = cursor.fetchone()
        if entity_row:
            eid = entity_row["id"]
            cursor.execute("DELETE FROM entity_mention WHERE entity_id = ?", (eid,))
            cursor.execute("DELETE FROM entity WHERE id = ?", (eid,))
            
        # Obter videos afetados para reindexação do Qdrant
        cursor.execute("""
            SELECT DISTINCT video_id FROM transcript 
            WHERE speaker_id = 'Desconhecido' AND video_id IN (SELECT id FROM video WHERE project_id = ?)
        """, (project_id,))
        video_ids = [r["video_id"] for r in cursor.fetchall()]
        
        conn.commit()

    # Reindexar
    try:
        search_engine = SemanticSearch.get_instance()
        with get_db() as conn:
            for vid in video_ids:
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, vid)
                if dialogues:
                    video = MediaRepository.get_video(conn, vid)
                    v_type = video['video_type'] if video else 'interview'
                    search_engine.index_transcript_chunks(project_id, vid, dialogues, v_type)
    except Exception as e:
        print(f"[Names] Erro ao reindexar transcrições no Qdrant: {e}")

    return {"status": "success", "message": f"Associação do nome '{name}' removida com sucesso."}


@router.post("/project/{project_id}/names/merge")
def merge_project_names(project_id: int, request: MergeNamesRequest):
    """Mescla as ocorrências de um nome (src_name) em outro (dest_name)."""
    src_name = request.src_name.strip()
    dest_name = request.dest_name.strip()
    if not src_name or not dest_name:
        raise HTTPException(status_code=400, detail="Nomes de origem e destino não podem ser vazios.")
    if src_name == dest_name:
        return {"status": "success", "message": "Nomes são idênticos, nada a fazer."}
        
    return rename_project_name(project_id, RenameNameRequest(old_name=src_name, new_name=dest_name))
