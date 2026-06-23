"""Backend Azure Face API - Tier 1 (cloud free tier).

Usa o Azure Cognitive Services Face API para deteccao e reconhecimento facial.
Free tier: 30,000 transacoes/mes. Ideal para refinar deteccoes duvidosas.
Documentacao: https://docs.microsoft.com/azure/cognitive-services/face/
"""
import os
import time
import json
import requests
from pathlib import Path
from typing import List, Optional

from src.vision.backends.base import FaceBackend, FaceDetection, FaceRecognition, BackendResult


class AzureBackend(FaceBackend):
    """Backend Azure Face API - Tier 1 (cloud, free tier disponivel).
    
    Tier 1: Melhor precisao que local, atributos de qualidade (blur, noise, exposure).
    Free tier: 30,000 transacoes/mes.
    Ideal para refinar deteccoes com confianca < 0.7 do Tier 0.
    """

    def __init__(self):
        self.endpoint = os.getenv("AZURE_FACE_ENDPOINT", "").rstrip("/")
        self.key = os.getenv("AZURE_FACE_KEY", "")
        self._available = None

    @property
    def name(self) -> str:
        return "Azure Face API"

    @property
    def tier(self) -> int:
        return 1

    @property
    def model_name(self) -> str:
        return "azure_face"

    @property
    def model_version(self) -> str:
        return "v1.0"

    @property
    def is_available(self) -> bool:
        if self._available is None:
            self._available = bool(self.endpoint and self.key and self._test_connection())
        return self._available

    @property
    def is_free(self) -> bool:
        return True  # Dentro do free tier

    def _throttle(self):
        """Aplica throttling para respeitar o limite de 20 chamadas por minuto do Azure Free Tier."""
        now = time.time()
        if not hasattr(self, "_call_times"):
            self._call_times = []
        
        # Filtra chamadas feitas nos últimos 60 segundos
        self._call_times = [t for t in self._call_times if now - t < 60.0]
        
        # Se atingiu o limite de 20, aguarda o tempo necessário para liberar a chamada mais antiga
        if len(self._call_times) >= 20:
            sleep_time = 60.0 - (now - self._call_times[0])
            if sleep_time > 0:
                print(f"[AZURE_BACKEND] Throttling ativo: limite de 20 chamadas/min atingido. Aguardando {sleep_time:.2f}s...")
                time.sleep(sleep_time)
                now = time.time()
                self._call_times = [t for t in self._call_times if now - t < 60.0]
                
        self._call_times.append(now)

    def _test_connection(self) -> bool:
        """Testa conexao com a API Azure e loga detalhes de erro se falhar."""
        try:
            headers = {"Ocp-Apim-Subscription-Key": self.key}
            r = requests.post(f"{self.endpoint}/face/v1.0/detect", headers=headers, timeout=5)
            if r.status_code not in [200, 400]:
                print(f"[AZURE_BACKEND] Conexão falhou (Status HTTP {r.status_code}): {r.text}")
                return False
            return True
        except Exception as e:
            print(f"[AZURE_BACKEND] Exceção no teste de conexão: {e}")
            return False

    def _call_detect(self, image_path: Path) -> List[dict]:
        """Chama Azure Face Detect API com throttling."""
        self._throttle()
        headers = {
            "Ocp-Apim-Subscription-Key": self.key,
            "Content-Type": "application/octet-stream"
        }
        params = {
            "returnFaceId": "true",
            "returnFaceAttributes": "qualityForRecognition,blur,noise,exposure,age,gender,emotion",
            "detectionModel": "detection_03",
            "recognitionModel": "recognition_04"
        }
        
        with open(image_path, "rb") as f:
            data = f.read()
        
        r = requests.post(
            f"{self.endpoint}/face/v1.0/detect",
            headers=headers, params=params, data=data, timeout=30
        )
        r.raise_for_status()
        return r.json()

    def detect(self, image_path: Path) -> List[FaceDetection]:
        """Detecta rostos via Azure Face API."""
        faces_data = self._call_detect(image_path)
        
        results = []
        for face in faces_data:
            rect = face.get("faceRectangle", {})
            attrs = face.get("faceAttributes", {})
            quality = attrs.get("qualityForRecognition", "low")
            blur = attrs.get("blur", {})
            
            # Quality score
            quality_score = {"high": 1.0, "medium": 0.6, "low": 0.2}.get(quality, 0.0)
            
            results.append(FaceDetection(
                box=[
                    rect.get("left", 0) / 1000.0,  # Normalizado aproximadamente
                    rect.get("top", 0) / 1000.0,
                    rect.get("width", 0) / 1000.0,
                    rect.get("height", 0) / 1000.0
                ],
                confidence=round(face.get("faceId", "") and 0.9 or 0.5, 4),
                quality_score=round(quality_score, 4),
                blur_score=round(blur.get("value", 15.0), 2),
                face_size_px=max(rect.get("width", 0), rect.get("height", 0))
            ))
        
        return results

    def recognize(self, image_path: Path, detections: List[FaceDetection]) -> List[FaceRecognition]:
        """Azure Face API retorna faceId que pode ser usado em Face Collections.
        Por padrao, retornamos reconhecimentos parciais (sem person_id)."""
        faces_data = self._call_detect(image_path)
        
        results = []
        for face in faces_data:
            attrs = face.get("faceAttributes", {})
            
            # Extrair atributos
            attributes = {}
            if "age" in attrs:
                attributes["age"] = attrs["age"]
            if "gender" in attrs:
                attributes["gender"] = attrs["gender"]
            if "emotion" in attrs:
                attributes["emotion"] = attrs["emotion"]
            
            quality = attrs.get("qualityForRecognition", "low")
            quality_score = {"high": 1.0, "medium": 0.6, "low": 0.2}.get(quality, 0.0)
            
            results.append(FaceRecognition(
                confidence=round(quality_score, 4),
                attributes=attributes,
                raw_response=json.dumps(face, ensure_ascii=False)
            ))
        
        return results

    def detect_and_recognize(self, image_path: Path) -> BackendResult:
        """Executa deteccao + reconhecimento via Azure Face API."""
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
                cost_usd=0.0,  # Free tier
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

    def add_face_to_collection(self, face_id: str, person_id: str, collection_id: str = "capiau_default") -> bool:
        """Adiciona um faceId a uma Face Collection (LargePersonGroup) com throttling."""
        self._throttle()
        try:
            headers = {"Ocp-Apim-Subscription-Key": self.key, "Content-Type": "application/json"}
            
            # Criar grupo se nao existir
            requests.put(
                f"{self.endpoint}/face/v1.0/largepersongroups/{collection_id}",
                headers=headers,
                json={"name": collection_id, "recognitionModel": "recognition_04"},
                timeout=10
            )
            
            # Adicionar face a pessoa
            r = requests.post(
                f"{self.endpoint}/face/v1.0/largepersongroups/{collection_id}/persons/{person_id}/persistedfaces",
                headers=headers,
                json={"faceId": face_id},
                timeout=10
            )
            return r.status_code == 200
        except Exception as e:
            print(f"[AZURE_BACKEND] Erro ao adicionar face a collection: {e}")
            return False

    def search_face_in_collection(self, face_id: str, collection_id: str = "capiau_default") -> Optional[str]:
        """Busca um faceId em uma Face Collection com throttling. Retorna personId se encontrado."""
        self._throttle()
        try:
            headers = {"Ocp-Apim-Subscription-Key": self.key, "Content-Type": "application/json"}
            
            r = requests.post(
                f"{self.endpoint}/face/v1.0/largepersongroups/{collection_id}/identify",
                headers=headers,
                json={"faceIds": [face_id], "maxNumOfCandidatesReturned": 1},
                timeout=10
            )
            
            if r.status_code == 200:
                results = r.json()
                if results and results[0].get("candidates"):
                    return results[0]["candidates"][0].get("personId")
            return None
        except Exception as e:
            print(f"[AZURE_BACKEND] Erro na busca: {e}")
            return None
