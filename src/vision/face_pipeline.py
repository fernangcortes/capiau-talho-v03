"""Orquestrador de Pipeline de Reconhecimento Facial em Cascata (Tiered).

Implementa a arquitetura em camadas onde resultados rapidos e 'bons o suficiente'
sao obtidos no inicio, com refinamento progressivo ate precisao maxima.

Pipeline:
  Tier 0: YuNet + SFace (local, CPU) - rapido, offline, gratuito
  Tier 1: Azure Face API (cloud, free tier) - refina deteccoes duvidosas
  Tier 2: AWS Rekognition (cloud, pago) - material critico, Face Collections
  Tier 3: InsightFace + GPU (local) - maxima precisao, arquivos especificos
  Tier 4: Manual (operador humano) - 100% precisao contextual

A regra de precedencia resolve conflitos:
  1. Manual confirmado (status='confirmed') sempre ganha
  2. Tier mais alto prevalece (se nao manual)
  3. Mais recente prevalece (mesmo tier)
  4. Maior confidence score
"""
import json
import time
from pathlib import Path
from typing import List, Optional, Dict, Any

from src.vision.backends.base import FaceBackend, BackendResult, FaceDetection, FaceRecognition
from src.vision.backends.local_backend import LocalBackend
from src.vision.backends.azure_backend import AzureBackend
from src.vision.backends.aws_backend import AWSBackend
from src.vision.backends.insightface_backend import InsightFaceBackend


class FacePipeline:
    """Orquestrador de reconhecimento facial em cascata.
    
    Gerencia multiplos backends (Tier 0-3) com fallback automatico.
    Resultados sao versionados no banco (face_recognition table).
    
    Usage:
        pipeline = FacePipeline()
        # Primeira passada rapida em todos os arquivos
        result = pipeline.process(image_path, min_tier=0, max_tier=0)
        # Refinar deteccoes duvidosas com cloud free
        result = pipeline.process(image_path, min_tier=1, max_tier=1, force=True)
        # Maxima precisao para arquivo especifico
        result = pipeline.process(image_path, min_tier=3, max_tier=3, force=True)
    """

    def __init__(self):
        self._backends: Dict[int, FaceBackend] = {}
        self._init_backends()

    def _init_backends(self):
        """Inicializa todos os backends, mesmo os indisponíveis (para fins de status)."""
        backends = [
            LocalBackend(),      # Tier 0
            AzureBackend(),      # Tier 1
            AWSBackend(),        # Tier 2
            InsightFaceBackend() # Tier 3
        ]
        
        for backend in backends:
            self._backends[backend.tier] = backend
            if backend.is_available:
                print(f"[FACE_PIPELINE] Backend disponível: {backend.name} (Tier {backend.tier})")
            else:
                print(f"[FACE_PIPELINE] Backend indisponível: {backend.name} (Tier {backend.tier})")

    @property
    def available_backends(self) -> List[FaceBackend]:
        """Retorna lista de backends disponiveis, ordenados por tier."""
        return [self._backends[t] for t in sorted(self._backends.keys())]

    @property
    def available_tiers(self) -> List[int]:
        """Retorna lista de tiers disponiveis."""
        return sorted(self._backends.keys())

    def get_backend(self, tier: int) -> Optional[FaceBackend]:
        """Retorna o backend para um tier especifico."""
        return self._backends.get(tier)

    def process(
        self,
        image_path: Path,
        min_tier: int = 0,
        max_tier: int = 3,
        force: bool = False,
        quality_threshold: float = 0.0,
        project_id: Optional[int] = None
    ) -> List[BackendResult]:
        """Executa o pipeline de reconhecimento facial em cascata.
        
        Args:
            image_path: Caminho para a imagem a processar
            min_tier: Tier minimo a executar (0-3)
            max_tier: Tier maximo a executar (0-3)
            force: Se True, reprocessa mesmo se ja houver resultado do tier
            quality_threshold: Se > 0, sobe de tier se confidence < threshold
            project_id: ID do projeto para carregar as configurações do settings
            
        Returns:
            Lista de BackendResult, um por tier executado
        """
        if not image_path.exists():
            print(f"[FACE_PIPELINE] Arquivo nao encontrado: {image_path}")
            return []
        
        results = []
        should_continue = True
        
        for tier in range(min_tier, min(max_tier + 1, 4)):
            if not should_continue:
                break
            
            backend = self._backends.get(tier)
            if backend is None or not backend.is_available:
                print(f"[FACE_PIPELINE] Tier {tier} ({backend.name if backend else 'desconhecido'}) indisponível, pulando...")
                continue
            
            print(f"[FACE_PIPELINE] Executando Tier {tier}: {backend.name} para {image_path.name}")
            
            try:
                result = backend.detect_and_recognize(image_path, project_id=project_id)
                results.append(result)
                
                if result.error:
                    print(f"[FACE_PIPELINE] Tier {tier} erro: {result.error}")
                    continue
                
                # Se force=False e quality e boa o suficiente, para
                if not force and quality_threshold > 0:
                    avg_confidence = self._avg_confidence(result)
                    if avg_confidence >= quality_threshold:
                        print(f"[FACE_PIPELINE] Quality {avg_confidence:.2f} >= threshold {quality_threshold:.2f}, parando.")
                        should_continue = False
                
            except Exception as e:
                print(f"[FACE_PIPELINE] Erro critico no Tier {tier}: {e}")
                results.append(BackendResult(
                    tier=tier,
                    model_name=backend.model_name,
                    model_version=backend.model_version,
                    detections=[],
                    recognitions=[],
                    error=str(e)
                ))
        
        return results

    def process_first_pass(self, image_path: Path, project_id: Optional[int] = None) -> BackendResult:
        """Executa apenas Tier 0 (local rapido) - primeira passada em todos os arquivos.
        
        Retorna resultado em ~2-5 segundos por imagem.
        """
        results = self.process(image_path, min_tier=0, max_tier=0, project_id=project_id)
        return results[0] if results else BackendResult(
            tier=0, model_name="none", model_version="none",
            detections=[], recognitions=[], error="No backend available"
        )

    def process_refine(
        self,
        image_path: Path,
        current_confidence: float,
        confidence_threshold: float = 0.7,
        project_id: Optional[int] = None
    ) -> Optional[BackendResult]:
        """Refina deteccoes com baixa confianca usando Tier 1 (Azure free).
        
        Args:
            image_path: Caminho da imagem
            current_confidence: Confidencia atual do Tier 0
            confidence_threshold: Se confidence < threshold, refina
            project_id: ID do projeto
            
        Returns:
            BackendResult do Tier 1 se refinado, None se nao necessario
        """
        if current_confidence >= confidence_threshold:
            return None
        
        if 1 not in self._backends or not self._backends[1].is_available:
            print("[FACE_PIPELINE] Azure Face API indisponivel para refinamento")
            return None
        
        print(f"[FACE_PIPELINE] Refinando: confidence {current_confidence:.2f} < threshold {confidence_threshold:.2f}")
        results = self.process(image_path, min_tier=1, max_tier=1, project_id=project_id)
        return results[0] if results else None

    def process_precise(self, image_path: Path, project_id: Optional[int] = None) -> Optional[BackendResult]:
        """Executa Tier 3 (InsightFace GPU) para maxima precisao.
        Usado para arquivos especificos selecionados pelo usuario.
        """
        if 3 not in self._backends or not self._backends[3].is_available:
            print("[FACE_PIPELINE] InsightFace indisponivel (GPU/pacotes necessarios)")
            return None
        
        print(f"[FACE_PIPELINE] Processamento de precisao (Tier 3) para {image_path.name}")
        results = self.process(image_path, min_tier=3, max_tier=3, project_id=project_id)
        return results[0] if results else None

    def compare_embeddings(self, emb1: List[float], emb2: List[float], tier: int = 0) -> float:
        """Compara dois embeddings usando o backend do tier especificado.
        
        Retorna similaridade cosseno (0-1).
        """
        e1 = self._normalize(emb1)
        e2 = self._normalize(emb2)
        
        import numpy as np
        similarity = float(np.dot(e1, e2))
        return max(0.0, min(1.0, similarity))

    def cluster_embeddings(
        self,
        embeddings: List[List[float]],
        eps: float = 0.38,
        min_samples: int = 2
    ) -> List[int]:
        """Clusteriza embeddings usando DBSCAN (implementacao NumPy).
        
        Args:
            embeddings: Lista de vetores de embedding
            eps: Distancia maxima para vizinhanca
            min_samples: Minimo de amostras para formar cluster
            
        Returns:
            Lista de labels (-1 = ruido, 0+ = cluster_id)
        """
        import numpy as np
        
        if not embeddings:
            return []
        
        embeddings_arr = np.array(embeddings, dtype=np.float32)
        
        # Normalizar
        norms = np.linalg.norm(embeddings_arr, axis=1, keepdims=True)
        norms[norms == 0] = 1
        embeddings_arr = embeddings_arr / norms
        
        # Similaridade cosseno -> distancia
        similarities = np.dot(embeddings_arr, embeddings_arr.T)
        distances = 1.0 - np.clip(similarities, -1.0, 1.0)
        
        n = distances.shape[0]
        labels = -np.ones(n, dtype=int)
        cluster_id = 0
        
        neighbors_list = [np.where(distances[i] <= eps)[0] for i in range(n)]
        
        for i in range(n):
            if labels[i] != -1:
                continue
            
            neighbors = neighbors_list[i]
            if len(neighbors) < min_samples:
                continue
            
            labels[i] = cluster_id
            queue = list(neighbors)
            in_queue = set(neighbors)
            idx = 0
            
            while idx < len(queue):
                curr_point = queue[idx]
                idx += 1
                
                if labels[curr_point] == -1:
                    labels[curr_point] = cluster_id
                elif labels[curr_point] >= 0:
                    continue
                
                labels[curr_point] = cluster_id
                
                curr_neighbors = neighbors_list[curr_point]
                if len(curr_neighbors) >= min_samples:
                    for nb in curr_neighbors:
                        if nb not in in_queue:
                            in_queue.add(nb)
                            queue.append(nb)
            
            cluster_id += 1
        
        return labels.tolist()

    def _avg_confidence(self, result: BackendResult) -> float:
        """Calcula confianca media de um resultado."""
        if not result.recognitions:
            return 0.0
        return sum(r.confidence for r in result.recognitions) / len(result.recognitions)

    def _normalize(self, embedding: List[float]) -> Any:
        """Normaliza um embedding para vetor unitario."""
        import numpy as np
        arr = np.array(embedding, dtype=np.float32)
        norm = np.linalg.norm(arr)
        if norm > 0:
            arr = arr / norm
        return arr


# Singleton global
_PIPELINE = None

def get_pipeline() -> FacePipeline:
    """Retorna instancia singleton do FacePipeline."""
    global _PIPELINE
    if _PIPELINE is None:
        _PIPELINE = FacePipeline()
    return _PIPELINE
