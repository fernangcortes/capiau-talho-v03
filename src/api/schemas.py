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
    timeline_start: Optional[float] = None  # posição absoluta na timeline (segundos, formato v2)
    id: Optional[str] = None                # id estável do clipe no frontend
    link_id: Optional[str] = None           # vínculo A/V: par vídeo+áudio compartilham o mesmo link_id
    effects: Optional[List[Dict[str, Any]]] = None       # efeitos MLT aplicados (fade, volume, speed...)
    alternatives: Optional[List[Dict[str, Any]]] = None  # candidatos do carrossel de alternativas da IA
    origin: Optional[str] = None                          # "user" | "ai"

class TrackItem(BaseModel):
    id: str
    name: str = ""
    kind: str = "video"  # 'video' | 'audio' | 'ai'
    order: int = 0
    volume: float = 1.0
    muted: bool = False
    locked: bool = False
    magnetic: bool = False

class TimelineCreate(BaseModel):
    name: str
    description: str = ""
    cuts: List[CutItem]
    project_id: int = 1
    tracks: Optional[List[TrackItem]] = None  # formato v2 multipista
    fps: float = 24.0

class TimelineAISuggestClip(BaseModel):
    id: str
    video_id: int
    in_s: float
    out_s: float
    timeline_start_s: float = 0.0
    track: str = "V1"
    link_id: Optional[str] = None
    origin: Optional[str] = "user"
    alternatives: Optional[List[Dict[str, Any]]] = None
    effects: Optional[List[Dict[str, Any]]] = None  # preserva efeitos ao passar pelo agente

class TimelineAISuggestPayload(BaseModel):
    project_id: int = 1
    persona: str = "diretora"
    fps: float = 24.0
    brief: str = ""
    clips: List[TimelineAISuggestClip]
    tracks: List[TrackItem] = []

class LabelFacePayload(BaseModel):
    name: str

class SplitTranscriptPayload(BaseModel):
    start_time: float
    new_speaker_id: str

class ChatPayload(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    # Fase 1: Snapshot da timeline para o agente de edição
    clips: Optional[List[TimelineAISuggestClip]] = None
    tracks: Optional[List[TrackItem]] = None
    fps: float = 24.0
    agent_model: Optional[str] = None
    custom_api_key: Optional[str] = None  # Permite ao usuário passar sua própria chave OpenRouter via UI

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

