"""Rotas FastAPI para reconhecimento facial em cascata.

Endpoints para deteccao, refinamento, clustering, desambiguacao manual
e consulta de faces com resolucao de conflitos por precedencia.
"""
from typing import List, Optional, Dict, Any
from pathlib import Path
import json
import cv2
import numpy as np
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse, RedirectResponse

from src.config import CONFIG
from src.db.connection import get_db
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

class ConfirmIdentityRequest(BaseModel):
    face_id: int
    person_id: int
    user_id: Optional[str] = "manual"

class PipelineStatusResponse(BaseModel):
    available_tiers: List[int]
    backends: List[dict]

class LabelFaceRequest(BaseModel):
    name: str

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


@router.get("/pipeline/s3/status", response_model=S3StatusResponse)
async def get_s3_status():
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
async def install_insightface(gpu: bool = Query(False, description="Instalar versão com suporte a GPU (onnxruntime-gpu)")):
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
async def add_manual_face(payload: ManualFaceCreate):
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
        
        # Se for um objeto/tag (não apenas pessoa), também podemos adicionar um relacionamento de narrativa
        if payload.video_id:
            cursor.execute("""
                INSERT INTO relation (project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
                VALUES (?, 'video', ?, 'features_element', 'theme', ?, 1.0)
            """, (payload.project_id, str(payload.video_id), payload.name))
            
            # Também indexa o novo tema/objeto no Qdrant para busca semântica
            try:
                from src.search.semantic import SemanticSearch
                search_engine = SemanticSearch.get_instance()
                search_engine.index_video_dialogue(
                    project_id=payload.project_id,
                    video_id=payload.video_id,
                    speaker_id="object_tag",
                    start_time=payload.timestamp,
                    end_time=payload.timestamp + 2.0,
                    text=f"[Elemento/Objeto detectado: {payload.name}]"
                )
            except Exception as qdrant_err:
                print(f"[Qdrant] Falha ao indexar objeto manual no Qdrant: {qdrant_err}")
                
        conn.commit()
    return {"status": "success", "face_id": face_id, "person_id": person_id}


@router.post("/photo/{photo_id}/detect", response_model=dict)
async def detect_faces_photo(
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
async def process_face_precise(
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


@router.post("/project/{project_id}/faces/cluster", response_model=ClusterResult)
async def cluster_faces(
    project_id: int,
    eps: float = Query(0.38, description="Distancia maxima DBSCAN"),
    min_samples: int = Query(3, description="Minimo de amostras por cluster")
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


@router.post("/project/{project_id}/faces/merge")
async def merge_project_clusters(project_id: int, request: MergeClustersRequest):
    """Mescla dois clusters em um unico."""
    service = get_face_service()
    service.merge_clusters(project_id, request.src_cluster_id, request.dest_cluster_id, request.name)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE face SET name = ? WHERE project_id = ? AND cluster_id = ?", 
                       (request.name, project_id, request.dest_cluster_id))
        conn.commit()
    return {"status": "success", "message": f"Cluster {request.src_cluster_id} mesclado com {request.dest_cluster_id}"}


@router.post("/project/{project_id}/faces/reassign")
async def reassign_project_faces(project_id: int, request: ReassignFacesRequest):
    """Reatribui faces de forma unitaria (desambiguacao manual)."""
    service = get_face_service()
    for fid in request.face_ids:
        service.reassign_face(fid, request.target_cluster_id, request.target_name)
    return {"status": "success", "message": f"{len(request.face_ids)} faces reatribuídas com sucesso."}


@router.post("/confirm-identity")
async def confirm_identity(request: ConfirmIdentityRequest):
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
async def list_project_face_clusters(project_id: int):
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
async def list_unlabeled_faces(project_id: int):
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
                WHERE f.project_id = ? AND (f.name IS NULL OR f.name LIKE 'Pessoa Desconhecida%')
                ORDER BY f.cluster_id DESC, f.id DESC
                LIMIT 100
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
async def list_cluster_faces(project_id: int, cluster_id: int):
    """Retorna todas as faces individuais de um cluster."""
    try:
        with get_db() as conn:
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


@router.post("/face/{face_id}/label")
async def label_face(face_id: int, payload: LabelFaceRequest):
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
        
        for fid in face_ids:
            service.confirm_face_identity(fid, person_id)
        
        # Atualizar cache de nomes na tabela face
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE face SET name = ? WHERE project_id = ? AND cluster_id = ?", (new_name, project_id, current_cluster_id))
            conn.commit()
            
        return {"status": "success", "message": f"Todas as faces do Grupo {current_cluster_id + 1} foram rotuladas como '{new_name}'."}
    else:
        service.confirm_face_identity(face_id, person_id)
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE face SET name = ? WHERE id = ?", (new_name, face_id))
            conn.commit()
        return {"status": "success", "message": f"Rosto ID {face_id} rotulado individualmente como '{new_name}'."}


@router.get("/face/{face_id}/thumbnail")
async def get_face_thumbnail(face_id: int):
    """Corta dinamicamente e retorna o thumbnail JPEG da face."""
    try:
        with get_db() as conn:
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
            raise HTTPException(status_code=404, detail="Face ou bounding box nao encontrada.")
            
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
        
        # Fallback para crop_path salvo localmente no ingest
        if not img_path or not img_path.exists():
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT crop_path FROM face WHERE id = ?", (face_id,))
                crop_row = cursor.fetchone()
            if crop_row and crop_row["crop_path"]:
                crop_p = Path(crop_row["crop_path"])
                if crop_p.exists():
                    return FileResponse(str(crop_p))
                else:
                    # Se nao existe localmente, mas S3 esta ativo, redirecionar para a URL assinada
                    from src.services.s3_service import S3Service
                    s3_service = S3Service.get_instance()
                    if s3_service.enabled:
                        s3_key = f"crops/{crop_p.name}"
                        presigned_url = s3_service.generate_presigned_url(s3_key)
                        if presigned_url:
                            return RedirectResponse(presigned_url)
            raise HTTPException(status_code=404, detail="Midia fisica para crop nao encontrada.")
        
        img = cv2.imread(str(img_path))
        if img is None:
            raise HTTPException(status_code=500, detail="Erro ao ler imagem original.")
            
        h, w = img.shape[:2]
        x, y, bw, bh = int(rx * w), int(ry * h), int(rw * w), int(rh * h)
        
        pad_x, pad_y = int(bw * 0.2), int(bh * 0.2)
        x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
        x2, y2 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
        
        crop = img[y1:y2, x1:x2]
        if crop.size == 0:
            raise HTTPException(status_code=500, detail="Crop invalido.")
            
        temp_dir = CONFIG.CACHE_DIR / "temp_crops"
        temp_dir.mkdir(exist_ok=True, parents=True)
        out_crop_path = temp_dir / f"face_thumb_{face_id}.jpg"
        cv2.imwrite(str(out_crop_path), crop)
        
        return FileResponse(str(out_crop_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video/{video_id}/faces", response_model=List[dict])
async def get_video_faces_compat(video_id: int):
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
async def get_photo_faces_compat(photo_id: int):
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
async def reject_face(face_id: int, payload: Optional[RejectFaceRequest] = None):
    """Marca uma face como rejeitada/nao relevante (nao e rosto) e opcionalmente especifica o objeto."""
    target_name = "Não Relevante"
    if payload and payload.name:
        stripped = payload.name.strip()
        if stripped:
            target_name = stripped

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM face WHERE id = ?", (face_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Face nao encontrada")
        
        # Marcar reconhecimentos anteriores como 'superseded'
        cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE face_id = ?", (face_id,))
        
        # Inserir um registro com status 'rejected'
        cursor.execute("""
            INSERT INTO face_recognition (face_id, tier, model, model_version, person_id, confidence, status, recognized_by)
            VALUES (?, 4, 'manual', 'v1.0', NULL, 0.0, 'rejected', 'user')
        """, (face_id,))
        
        # Limpar o nome e salvar o nome do objeto (ou 'Não Relevante')
        cursor.execute("UPDATE face SET name = ? WHERE id = ?", (target_name, face_id))
        conn.commit()
        
    return {"status": "success", "message": f"Face rejeitada com sucesso (rotulada como '{target_name}')."}
