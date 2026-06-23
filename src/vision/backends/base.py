"""Interface base para todos os backends de reconhecimento facial.

Todos os adaptadores (local, cloud, manual) devem implementar esta interface
para serem orquestrados pelo FacePipeline de cascata.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict, Any
import numpy as np


@dataclass
class FaceDetection:
    """Representa uma deteccao facial unica."""
    box: List[float]  # [x, y, w, h] relativos (0-1)
    confidence: float  # confianca da deteccao (0-1)
    landmarks: Optional[List[List[float]]] = None  # 5 pontos faciais
    quality_score: Optional[float] = None  # qualidade da imagem (0-1)
    blur_score: Optional[float] = None  # variancia do Laplaciano
    face_size_px: Optional[int] = None  # tamanho em pixels


@dataclass
class FaceRecognition:
    """Resultado de um reconhecimento facial por um backend especifico."""
    person_name: Optional[str] = None  # nome identificado (None = desconhecido)
    person_id: Optional[int] = None  # ID interno da pessoa
    embedding: Optional[List[float]] = None  # vetor de embedding
    similarity: Optional[float] = None  # similaridade com referencia (0-1)
    confidence: float = 0.0  # confianca geral do reconhecimento
    attributes: Dict[str, Any] = field(default_factory=dict)  # idade, emocao, etc.
    raw_response: Optional[str] = None  # resposta raw da API (para audit)


@dataclass
class BackendResult:
    """Resultado completo de processamento por um backend."""
    tier: int  # 0=local rapido, 1=cloud free, 2=cloud pago, 3=gpu local, 4=manual
    model_name: str  # identificador do modelo
    model_version: str  # versao do modelo
    detections: List[FaceDetection]  # todas as deteccoes
    recognitions: List[FaceRecognition]  # reconhecimentos (mesmo length que detections)
    processing_time_ms: int = 0  # tempo de processamento
    cost_usd: float = 0.0  # custo (0.0 para local)
    error: Optional[str] = None  # erro, se houver


class FaceBackend(ABC):
    """Interface base que todos os backends de reconhecimento facial devem implementar."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Nome humano-readavel do backend."""
        pass

    @property
    @abstractmethod
    def tier(self) -> int:
        """Tier da cascata (0-4)."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Identificador tecnico do modelo."""
        pass

    @property
    @abstractmethod
    def model_version(self) -> str:
        """Versao do modelo."""
        pass

    @property
    @abstractmethod
    def is_available(self) -> bool:
        """Verifica se o backend esta disponivel (credenciais, hardware, etc)."""
        pass

    @property
    @abstractmethod
    def is_free(self) -> bool:
        """True se o backend nao tem custo por chamada."""
        pass

    @abstractmethod
    def detect(self, image_path: Path) -> List[FaceDetection]:
        """Detecta rostos em uma imagem. Retorna lista de FaceDetection."""
        pass

    @abstractmethod
    def recognize(self, image_path: Path, detections: List[FaceDetection]) -> List[FaceRecognition]:
        """Reconhece rostos previamente detectados. Retorna lista de FaceRecognition."""
        pass

    @abstractmethod
    def detect_and_recognize(self, image_path: Path) -> BackendResult:
        """Executa deteccao + reconhecimento em uma imagem. Metodo principal."""
        pass

    def get_embedding_dimension(self) -> int:
        """Retorna a dimensao dos embeddings deste backend. Padrao: 128."""
        return 128

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name='{self.name}', tier={self.tier}, available={self.is_available})"
