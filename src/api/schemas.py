"""Modelos Pydantic unificados para validação de requisições e respostas da API."""
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class ProjectCreate(BaseModel):
    name: str
    description: str = ""

class ProjectDriveLinkUpdate(BaseModel):
    drive_link: str

class ProjectExportOptions(BaseModel):
    include_metadata: bool = True
    include_proxies: bool = False
    include_photos: bool = False
    include_docs: bool = False

class ExternalPathIngest(BaseModel):
    path: str
    project_id: int = 1

class CutItem(BaseModel):
    video_id: int
    in_time: float  # mapeado de 'in' por ser palavra reservada
    out_time: float # mapeado de 'out'
    track: str = "V1"

class TimelineCreate(BaseModel):
    name: str
    description: str = ""
    cuts: List[CutItem]
    project_id: int = 1

class LabelFacePayload(BaseModel):
    name: str

class SplitTranscriptPayload(BaseModel):
    start_time: float
    new_speaker_id: str

class ChatPayload(BaseModel):
    message: str
    history: List[Dict[str, str]] = []

class MergeClustersPayload(BaseModel):
    src_cluster_id: int
    dest_cluster_id: int
    name: str

class ReassignFacesPayload(BaseModel):
    face_ids: List[int]
    target_cluster_id: int
    target_name: str

class SearchResultItem(BaseModel):
    id: str
    media_type: str
    text: str

class SearchCategorizePayload(BaseModel):
    query: str
    results: List[SearchResultItem]

