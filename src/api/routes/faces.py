"""Rotas FastAPI para reconhecimento facial em cascata.

Endpoints para deteccao, refinamento, clustering, desambiguacao manual
e consulta de faces com resolucao de conflitos por precedencia.
"""
from typing import List, Optional
from pathlib import Path
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query

from src.services.face_service import get_face_service, FaceService
from src.vision.face_pipeline import get_pipeline, FacePipeline

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
    total: int
    clustered: int
    clusters: int
    noise: int

class MergeClustersRequest(BaseModel):
    cluster_src: int
    cluster_dest: int
    name: str

class ReassignFaceRequest(BaseModel):
    face_id: int
    target_cluster_id: int
    target_name: str

class ConfirmIdentityRequest(BaseModel):
    face_id: int
    person_id: int
    user_id: Optional[str] = "manual"

class PipelineStatusResponse(BaseModel):
    available_tiers: List[int]
    backends: List[dict]


# ── Rotas ──

@router.get("/pipeline/status", response_model=PipelineStatusResponse)
async def get_pipeline_status():
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


@router.post("/photo/{photo_id}/detect", response_model=dict)
async def detect_faces_photo(
    photo_id: int,
    project_id: int = Query(..., description="ID do projeto"),
    image_path: str = Query(..., description="Caminho absoluto da imagem")
):
    """Executa deteccao facial Tier 0 em uma foto.
    
    Primeira passada rapida - processa em CPU local.
    """
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
async def detect_faces_video_frame(
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
async def refine_face(
    face_id: int,
    image_path: str = Query(..., description="Caminho da imagem para reprocessar"),
    max_tier: int = Query(2, description="Tier maximo para refinamento (1-2)")
):
    """Refina uma face com tiers superiores (Azure/AWS).
    
    Usado quando o Tier 0 tem confianca baixa.
    """
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
async def process_face_precise(
    face_id: int,
    image_path: str = Query(..., description="Caminho da imagem para processamento de precisao")
):
    """Processa uma face com Tier 3 (InsightFace GPU) para maxima precisao.
    
    Requer GPU NVIDIA. Usado para arquivos especificos.
    """
    service = get_face_service()
    path = Path(image_path)
    
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Imagem nao encontrada: {image_path}")
    
    result = service.process_with_precision(face_id, path)
    
    if result is None:
        return {"message": "InsightFace indisponivel (GPU necessaria)", "processed": False}
    
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
async def get_project_faces(
    project_id: int,
    media_type: Optional[str] = Query(None, description="Filtrar por 'video' ou 'photo'"),
    media_id: Optional[int] = Query(None, description="ID da midia especifica")
):
    """Retorna todas as faces do projeto com reconhecimento autoritativo."""
    service = get_face_service()
    faces = service.get_project_faces(project_id, media_type, media_id)
    return faces


@router.get("/face/{face_id}", response_model=dict)
async def get_face_detail(face_id: int):
    """Retorna detalhes completos de uma face com todos os reconhecimentos."""
    service = get_face_service()
    face = service.get_face_detail(face_id)
    
    if not face:
        raise HTTPException(status_code=404, detail=f"Face {face_id} nao encontrada")
    
    return face


@router.post("/project/{project_id}/cluster", response_model=ClusterResult)
async def cluster_faces(
    project_id: int,
    eps: float = Query(0.38, description="Distancia maxima DBSCAN"),
    min_samples: int = Query(3, description="Minimo de amostras por cluster")
):
    """Clusteriza todas as faces do projeto usando DBSCAN."""
    service = get_face_service()
    result = service.cluster_project_faces(project_id, eps=eps, min_samples=min_samples)
    return ClusterResult(**result)


@router.post("/project/{project_id}/people", response_model=PersonResponse)
async def create_person(project_id: int, request: PersonCreateRequest):
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
async def get_project_people(project_id: int):
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


@router.post("/merge-clusters")
async def merge_clusters(project_id: int, request: MergeClustersRequest):
    """Mescla dois clusters em um unico."""
    service = get_face_service()
    service.merge_clusters(project_id, request.cluster_src, request.cluster_dest, request.name)
    return {"message": f"Cluster {request.cluster_src} mesclado com {request.cluster_dest}"}


@router.post("/reassign-face")
async def reassign_face(request: ReassignFaceRequest):
    """Reatribui uma face para outro cluster."""
    service = get_face_service()
    service.reassign_face(request.face_id, request.target_cluster_id, request.target_name)
    return {"message": f"Face {request.face_id} reatribuida ao cluster {request.target_cluster_id}"}


@router.post("/confirm-identity")
async def confirm_identity(request: ConfirmIdentityRequest):
    """Operador confirma manualmente a identidade de uma face (Tier 4).
    
    Este reconhecimento manual sempre prevalece sobre os automaticos.
    """
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
