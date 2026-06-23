"""Backend InsightFace - Tier 3 (GPU local, state-of-the-art).

Usa InsightFace com modelo 'buffalo_l' para deteccao (RetinaFace) e 
reconhecimento (ArcFace) em GPU local. Precisa de GPU NVIDIA + CUDA.

Embedding: 512 dimensoes (mais expressivo que SFace 128-d).
Precisao: 99.86% LFW - state-of-the-art open-source.
Documentacao: https://github.com/deepinsight/insightface
"""
import os
import time
import json
from pathlib import Path
from typing import List, Optional

import numpy as np

from src.vision.backends.base import FaceBackend, FaceDetection, FaceRecognition, BackendResult


class InsightFaceBackend(FaceBackend):
    """Backend InsightFace - Tier 3 (GPU local, maxima precisao).
    
    Tier 3: State-of-the-art, embeddings 512-d, RetinaFace detection.
    Requer GPU NVIDIA + CUDA.
    Ideal para arquivos especificos que precisam de maxima precisao.
    """

    def __init__(self, ctx_id: int = 0, det_size: tuple = (640, 640)):
        self.ctx_id = ctx_id  # 0 = GPU, -1 = CPU
        self.det_size = det_size
        self._app = None
        self._available = None

    def _get_app(self):
        """Lazy loading do InsightFace app."""
        if self._app is None:
            try:
                from insightface.app import FaceAnalysis
                self._app = FaceAnalysis(name="buffalo_l")
                self._app.prepare(ctx_id=self.ctx_id, det_size=self.det_size)
            except ImportError:
                print("[INSIGHTFACE_BACKEND] insightface nao instalado.")
                print("[INSIGHTFACE_BACKEND] Instale: pip install insightface onnxruntime-gpu")
                raise
        return self._app

    @property
    def name(self) -> str:
        return "InsightFace (ArcFace + RetinaFace)"

    @property
    def tier(self) -> int:
        return 3

    @property
    def model_name(self) -> str:
        return "insightface_buffalo_l"

    @property
    def model_version(self) -> str:
        return "buffalo_l_v2"

    @property
    def is_available(self) -> bool:
        if self._available is None:
            try:
                self._get_app()
                self._available = True
            except Exception:
                self._available = False
        return self._available

    @property
    def is_free(self) -> bool:
        return True  # Custo = energia eletrica

    def get_embedding_dimension(self) -> int:
        return 512

    def detect(self, image_path: Path) -> List[FaceDetection]:
        """Detecta rostos com RetinaFace via InsightFace."""
        import cv2
        
        img = cv2.imread(str(image_path))
        if img is None:
            return []
        
        app = self._get_app()
        faces = app.get(img)
        
        height, width = img.shape[:2]
        results = []
        
        for face in faces:
            bbox = face.bbox.astype(int)
            x, y, x2, y2 = bbox[0], bbox[1], bbox[2], bbox[3]
            w, h = x2 - x, y2 - y
            
            # Quality baseada em det_score e tamanho
            det_score = float(face.det_score)
            size_score = min(1.0, max(w, h) / 200.0)
            quality = (det_score * 0.6) + (size_score * 0.4)
            
            # Landmarks (5 pontos)
            landmarks = face.kps.tolist() if hasattr(face, 'kps') else None
            
            results.append(FaceDetection(
                box=[
                    round(float(x) / width, 4),
                    round(float(y) / height, 4),
                    round(float(w) / width, 4),
                    round(float(h) / height, 4)
                ],
                confidence=round(det_score, 4),
                landmarks=landmarks,
                quality_score=round(quality, 4),
                blur_score=None,  # RetinaFace nao calcula blur
                face_size_px=max(w, h)
            ))
        
        return results

    def recognize(self, image_path: Path, detections: List[FaceDetection]) -> List[FaceRecognition]:
        """Extrai embeddings ArcFace (512-d) para cada deteccao."""
        import cv2
        
        img = cv2.imread(str(image_path))
        if img is None:
            return [FaceRecognition(confidence=0.0) for _ in detections]
        
        app = self._get_app()
        faces = app.get(img)
        
        results = []
        for face in faces:
            try:
                embedding = face.embedding.tolist() if hasattr(face, 'embedding') else None
                det_score = float(face.det_score)
                
                # Atributos disponiveis
                attrs = {}
                if hasattr(face, 'age') and face.age is not None:
                    attrs["age"] = float(face.age)
                if hasattr(face, 'gender') and face.gender is not None:
                    attrs["gender"] = "masculino" if face.gender == 1 else "feminino"
                
                results.append(FaceRecognition(
                    embedding=embedding,
                    confidence=round(det_score, 4),
                    attributes=attrs
                ))
            except Exception as e:
                print(f"[INSIGHTFACE_BACKEND] Erro no embedding: {e}")
                results.append(FaceRecognition(confidence=0.0))
        
        return results

    def detect_and_recognize(self, image_path: Path) -> BackendResult:
        """Executa deteccao + reconhecimento via InsightFace."""
        start = time.time()
        
        try:
            detections = self.detect(image_path)
            recognitions = self.recognize(image_path, detections) if detections else []
            elapsed_ms = int((time.time() - start) * 1000)
            
            return BackendResult(
                tier=self.tier,
                model_name=self.model_name,
                model_version=self.model_version,
                detections=detections,
                recognitions=recognitions,
                processing_time_ms=elapsed_ms,
                cost_usd=0.0,
                error=None
            )
        except Exception as e:
            return BackendResult(
                tier=self.tier,
                model_name=self.model_name,
                model_version=self.model_version,
                detections=[],
                recognitions=[],
                processing_time_ms=int((time.time() - start) * 1000),
                cost_usd=0.0,
                error=str(e)
            )

    def compute_similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        """Computa similaridade cosseno entre dois embeddings ArcFace."""
        e1 = np.array(embedding1, dtype=np.float32)
        e2 = np.array(embedding2, dtype=np.float32)
        
        # Normalizar
        e1 = e1 / np.linalg.norm(e1)
        e2 = e2 / np.linalg.norm(e2)
        
        # Similaridade cosseno
        similarity = np.dot(e1, e2)
        return float(similarity)
