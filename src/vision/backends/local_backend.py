"""Backend local YuNet + SFace - Tier 0 (rapido, offline, sem custo).

Usa os modelos ONNX da OpenCV Zoo para deteccao e reconhecimento facial
100% local em CPU. Eh o backend padrao e mais rapido do pipeline.
"""
import cv2
import json
import time
import numpy as np
from pathlib import Path
from typing import List, Optional

from src.vision.backends.base import FaceBackend, FaceDetection, FaceRecognition, BackendResult

_detector = None
_recognizer = None


def _download_models():
    """Baixa modelos ONNX da OpenCV Zoo se nao existirem."""
    import requests
    models_dir = Path("data/models")
    models_dir.mkdir(parents=True, exist_ok=True)
    yunet_path = models_dir / "face_detection_yunet_2023mar.onnx"
    sface_path = models_dir / "face_recognition_sface_2021dec.onnx"
    urls = {
        yunet_path: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        sface_path: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
    }
    for path, url in urls.items():
        if not path.exists():
            print(f"[LOCAL_BACKEND] Baixando {path.name}...")
            r = requests.get(url, stream=True, timeout=60)
            r.raise_for_status()
            with open(path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)


def _get_models():
    """Lazy loading dos modelos YuNet e SFace."""
    global _detector, _recognizer
    if _detector is None or _recognizer is None:
        _download_models()
        models_dir = Path("data/models")
        _detector = cv2.FaceDetectorYN.create(
            model=str(models_dir / "face_detection_yunet_2023mar.onnx"),
            config="", input_size=(320, 320),
            score_threshold=0.6, nms_threshold=0.3, top_k=5000,
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU
        )
        _recognizer = cv2.FaceRecognizerSF.create(
            model=str(models_dir / "face_recognition_sface_2021dec.onnx"),
            config="",
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU
        )
    return _detector, _recognizer


def _is_blurry(crop_img: np.ndarray, threshold: float = 15.0) -> bool:
    """Verifica se a imagem esta desfocada via variancia do Laplaciano."""
    if crop_img is None or crop_img.size == 0:
        return True
    try:
        gray = cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY)
        variance = cv2.Laplacian(gray, cv2.CV_64F).var()
        return variance < threshold
    except Exception:
        return True


class LocalBackend(FaceBackend):
    """Backend local YuNet (deteccao) + SFace (reconhecimento).
    
    Tier 0: Rápido, offline, sem custo. Processa em CPU.
    Embedding: 128 dimensoes.
    Ideal para primeira passada em todos os arquivos.
    """

    @property
    def name(self) -> str:
        return "YuNet + SFace (Local CPU)"

    @property
    def tier(self) -> int:
        return 0

    @property
    def model_name(self) -> str:
        return "yunet_sface"

    @property
    def model_version(self) -> str:
        return "2023-2021"

    @property
    def is_available(self) -> bool:
        try:
            _get_models()
            return True
        except Exception:
            return False

    @property
    def is_free(self) -> bool:
        return True

    def get_embedding_dimension(self) -> int:
        return 128

    def detect(self, image_path: Path) -> List[FaceDetection]:
        """Detecta rostos com YuNet."""
        img = cv2.imread(str(image_path))
        if img is None:
            return []
        
        height, width = img.shape[:2]
        if height == 0 or width == 0:
            return []
        
        detector, _ = _get_models()
        detector.setInputSize((width, height))
        
        retval, faces = detector.detect(img)
        if faces is None or len(faces) == 0:
            return []
        
        total_faces = len(faces)
        results = []
        
        for face in faces:
            x, y, w, h = map(int, face[0:4])
            confidence = float(face[14])
            
            if confidence < 0.6:
                continue
            
            x1, y1 = max(0, x), max(0, y)
            x2, y2 = min(width, x + w), min(height, y + h)
            if x2 <= x1 or y2 <= y1:
                continue
            
            crop_img = img[y1:y2, x1:x2]
            
            # Heuristica de multidao vs nitidez
            is_small = (w < 40 or h < 40)
            blurry = _is_blurry(crop_img, threshold=15.0)
            
            if is_small and blurry and total_faces > 8:
                continue
            
            # Landmarks (5 pontos)
            landmarks = None
            if len(face) >= 15:
                landmarks = [
                    [float(face[4]), float(face[5])],   # olho direito
                    [float(face[6]), float(face[7])],   # olho esquerdo
                    [float(face[8]), float(face[9])],   # nariz
                    [float(face[10]), float(face[11])], # boca direita
                    [float(face[12]), float(face[13])], # boca esquerda
                ]
            
            # Quality score baseado em tamanho e nitidez
            size_score = min(1.0, max(w, h) / 200.0)
            blur_var = cv2.Laplacian(cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() if crop_img.size > 0 else 0
            quality = (confidence * 0.4) + (size_score * 0.4) + (min(1.0, blur_var / 100.0) * 0.2)
            
            rx, ry, rw, rh = float(x) / width, float(y) / height, float(w) / width, float(h) / height
            
            results.append(FaceDetection(
                box=[round(rx, 4), round(ry, 4), round(rw, 4), round(rh, 4)],
                confidence=round(confidence, 4),
                landmarks=landmarks,
                quality_score=round(quality, 4),
                blur_score=round(blur_var, 2),
                face_size_px=max(w, h)
            ))
        
        return results

    def recognize(self, image_path: Path, detections: List[FaceDetection]) -> List[FaceRecognition]:
        """Extrai embeddings SFace para cada deteccao."""
        img = cv2.imread(str(image_path))
        if img is None:
            return [FaceRecognition(confidence=0.0) for _ in detections]
        
        _, recognizer = _get_models()
        results = []
        height, width = img.shape[:2]
        
        for det in detections:
            try:
                # Reconstruir face array para alignCrop
                x, y, w, h = det.box[0] * width, det.box[1] * height, det.box[2] * width, det.box[3] * height
                
                face_array = np.array([
                    x, y, w, h,
                    det.landmarks[0][0] if det.landmarks else x + w * 0.3,
                    det.landmarks[0][1] if det.landmarks else y + h * 0.3,
                    det.landmarks[1][0] if det.landmarks else x + w * 0.7,
                    det.landmarks[1][1] if det.landmarks else y + h * 0.3,
                    det.landmarks[2][0] if det.landmarks else x + w * 0.5,
                    det.landmarks[2][1] if det.landmarks else y + h * 0.5,
                    det.landmarks[3][0] if det.landmarks else x + w * 0.3,
                    det.landmarks[3][1] if det.landmarks else y + h * 0.8,
                    det.landmarks[4][0] if det.landmarks else x + w * 0.7,
                    det.landmarks[4][1] if det.landmarks else y + h * 0.8,
                    det.confidence
                ], dtype=np.float32)
                
                aligned = recognizer.alignCrop(img, face_array)
                if aligned is None or aligned.size == 0:
                    results.append(FaceRecognition(confidence=0.0))
                    continue
                
                feat = recognizer.feature(aligned)
                if feat is None:
                    results.append(FaceRecognition(confidence=0.0))
                    continue
                
                # Normalizacao L2
                norm = np.linalg.norm(feat)
                if norm > 0:
                    feat = feat / norm
                
                embedding_list = feat.flatten().tolist()
                
                results.append(FaceRecognition(
                    embedding=embedding_list,
                    confidence=round(det.confidence, 4)
                ))
            except Exception as e:
                print(f"[LOCAL_BACKEND] Erro no embedding: {e}")
                results.append(FaceRecognition(confidence=0.0))
        
        return results

    def detect_and_recognize(self, image_path: Path) -> BackendResult:
        """Executa deteccao + reconhecimento completo."""
        start = time.time()
        
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
            cost_usd=0.0
        )
