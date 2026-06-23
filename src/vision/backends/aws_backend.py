"""Backend AWS Rekognition - Tier 2 (cloud pago, alta precisao).

Usa AWS Rekognition para deteccao e reconhecimento facial via Face Collections.
Custo: $1.00 por 1,000 transacoes (ate 1M/mes).
Free tier: 5,000 analises/mes por 12 meses.
Documentacao: https://aws.amazon.com/rekognition/
"""
import os
import time
import json
from pathlib import Path
from typing import List, Optional, Dict

from src.vision.backends.base import FaceBackend, FaceDetection, FaceRecognition, BackendResult


class AWSBackend(FaceBackend):
    """Backend AWS Rekognition - Tier 2 (cloud pago).
    
    Tier 2: Alta precisao, Face Collections, analise de video nativa.
    Custo: $0.001/imagem (ate 1M), $0.10/min video.
    Ideal para material critico e grandes volumes.
    """

    def __init__(self):
        self._client = None
        self._available = None

    def _get_client(self):
        """Lazy import e inicializacao do cliente boto3."""
        if self._client is None:
            try:
                import boto3
                self._client = boto3.client(
                    'rekognition',
                    region_name=os.getenv("AWS_REGION", "us-east-1"),
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
                )
            except ImportError:
                print("[AWS_BACKEND] boto3 nao instalado. Instale com: pip install boto3")
                raise
        return self._client

    @property
    def name(self) -> str:
        return "AWS Rekognition"

    @property
    def tier(self) -> int:
        return 2

    @property
    def model_name(self) -> str:
        return "aws_rekognition"

    @property
    def model_version(self) -> str:
        return "v2025"

    @property
    def is_available(self) -> bool:
        if self._available is None:
            try:
                self._get_client().describe_collections(MaxResults=1)
                self._available = True
            except Exception:
                self._available = False
        return self._available

    @property
    def is_free(self) -> bool:
        return False  # Pago (ou free tier limitado)

    def detect(self, image_path: Path) -> List[FaceDetection]:
        """Detecta rostos via AWS Rekognition DetectFaces."""
        client = self._get_client()
        
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        
        response = client.detect_faces(
            Image={"Bytes": image_bytes},
            Attributes=["DEFAULT"]
        )
        
        results = []
        for detail in response.get("FaceDetails", []):
            bbox = detail.get("BoundingBox", {})
            quality = detail.get("Quality", {})
            
            # Quality score
            brightness = quality.get("Brightness", 50.0)
            sharpness = quality.get("Sharpness", 50.0)
            quality_score = (brightness / 100.0 * 0.5) + (sharpness / 100.0 * 0.5)
            
            results.append(FaceDetection(
                box=[
                    round(bbox.get("Left", 0), 4),
                    round(bbox.get("Top", 0), 4),
                    round(bbox.get("Width", 0), 4),
                    round(bbox.get("Height", 0), 4)
                ],
                confidence=round(detail.get("Confidence", 0) / 100.0, 4),
                quality_score=round(quality_score, 4),
                blur_score=round(100.0 - sharpness, 2),  # inverso: maior = mais borrado
                face_size_px=int(bbox.get("Width", 0) * bbox.get("Height", 0) * 1000000)
            ))
        
        return results

    def recognize(self, image_path: Path, detections: List[FaceDetection]) -> List[FaceRecognition]:
        """AWS Rekognition retorna atributos e pode buscar em Face Collections."""
        client = self._get_client()
        
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        
        response = client.detect_faces(
            Image={"Bytes": image_bytes},
            Attributes=["ALL"]
        )
        
        results = []
        for detail in response.get("FaceDetails", []):
            attrs: Dict = {}
            
            # Extrair atributos
            if "AgeRange" in detail:
                attrs["age_range"] = detail["AgeRange"]
            if "Gender" in detail:
                attrs["gender"] = detail["Gender"]
            if "Emotions" in detail:
                attrs["emotions"] = [{"type": e["Type"], "confidence": e["Confidence"]} 
                                     for e in detail["Emotions"]]
            if "Smile" in detail:
                attrs["smile"] = detail["Smile"]
            
            results.append(FaceRecognition(
                confidence=round(detail.get("Confidence", 0) / 100.0, 4),
                attributes=attrs,
                raw_response=json.dumps(detail, ensure_ascii=False, default=str)
            ))
        
        return results

    def detect_and_recognize(self, image_path: Path) -> BackendResult:
        """Executa deteccao + reconhecimento via AWS Rekognition."""
        start = time.time()
        
        try:
            detections = self.detect(image_path)
            recognitions = self.recognize(image_path, detections) if detections else []
            elapsed_ms = int((time.time() - start) * 1000)
            
            # Custo estimado: $0.001 por imagem
            cost = 0.001 if detections else 0.0
            
            return BackendResult(
                tier=self.tier,
                model_name=self.model_name,
                model_version=self.model_version,
                detections=detections,
                recognitions=recognitions,
                processing_time_ms=elapsed_ms,
                cost_usd=cost,
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

    def create_collection(self, collection_id: str) -> bool:
        """Cria uma Face Collection no AWS Rekognition."""
        try:
            client = self._get_client()
            client.create_collection(CollectionId=collection_id)
            return True
        except client.exceptions.ResourceAlreadyExistsException:
            return True  # Ja existe
        except Exception as e:
            print(f"[AWS_BACKEND] Erro ao criar collection: {e}")
            return False

    def index_face(self, collection_id: str, image_path: Path, external_id: str) -> Optional[str]:
        """Indexa um rosto em uma Face Collection. Retorna FaceId."""
        try:
            client = self._get_client()
            with open(image_path, "rb") as f:
                image_bytes = f.read()
            
            response = client.index_faces(
                CollectionId=collection_id,
                Image={"Bytes": image_bytes},
                ExternalImageId=external_id
            )
            
            if response.get("FaceRecords"):
                return response["FaceRecords"][0]["Face"]["FaceId"]
            return None
        except Exception as e:
            print(f"[AWS_BACKEND] Erro ao indexar face: {e}")
            return None

    def search_face(self, collection_id: str, image_path: Path, threshold: float = 85.0) -> List[dict]:
        """Busca um rosto em uma Face Collection. Retorna matches."""
        try:
            client = self._get_client()
            with open(image_path, "rb") as f:
                image_bytes = f.read()
            
            response = client.search_faces_by_image(
                CollectionId=collection_id,
                Image={"Bytes": image_bytes},
                FaceMatchThreshold=threshold,
                MaxFaces=5
            )
            
            matches = []
            for match in response.get("FaceMatches", []):
                matches.append({
                    "face_id": match["Face"]["FaceId"],
                    "external_id": match["Face"].get("ExternalImageId"),
                    "similarity": match["Similarity"]
                })
            return matches
        except Exception as e:
            print(f"[AWS_BACKEND] Erro na busca: {e}")
            return []
