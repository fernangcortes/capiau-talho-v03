"""Busca visual local por embeddings CLIP (E2.B): imagens ficam pesquisáveis por texto
em português sem custo de API.

- Imagem: clip-ViT-B-32 (512d) | Texto: clip-ViT-B-32-multilingual-v1 (mesmo espaço vetorial)
- Coleção Qdrant separada 'capiau_images' (cosine), no MESMO cliente do SemanticSearch
  (o Qdrant local em modo arquivo só permite um cliente por caminho).
"""
import uuid
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from src.search.semantic import SemanticSearch


class ImageSearch:
    _instance = None

    IMAGE_MODEL = "clip-ViT-B-32"
    TEXT_MODEL = "sentence-transformers/clip-ViT-B-32-multilingual-v1"

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        # Reutiliza o cliente Qdrant já aberto (lock de arquivo do modo local)
        self.client = SemanticSearch.get_instance().client
        self.collection_name = "capiau_images"
        self._img_encoder = None
        self._txt_encoder = None
        self._init_collection()

    def _init_collection(self):
        try:
            collections = [c.name for c in self.client.get_collections().collections]
            if self.collection_name not in collections:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=512, distance=Distance.COSINE),
                )
                print(f"[QDRANT] Coleção '{self.collection_name}' criada (CLIP 512d).")
        except Exception as e:
            print(f"[QDRANT] Erro ao inicializar coleção de imagens: {e}")

    # Modelos carregados sob demanda (evita ~1GB de RAM quando a busca visual não é usada)
    @property
    def img_encoder(self):
        if self._img_encoder is None:
            from sentence_transformers import SentenceTransformer
            print("[CLIP] Carregando modelo de imagem em CPU...")
            self._img_encoder = SentenceTransformer(self.IMAGE_MODEL, device="cpu")
        return self._img_encoder

    @property
    def txt_encoder(self):
        if self._txt_encoder is None:
            from sentence_transformers import SentenceTransformer
            print("[CLIP] Carregando modelo de texto multilíngue em CPU...")
            self._txt_encoder = SentenceTransformer(self.TEXT_MODEL, device="cpu")
        return self._txt_encoder

    def embed_image_file(self, image_path: Path) -> Optional[np.ndarray]:
        """Embedding CLIP de um arquivo de imagem (None em falha)."""
        try:
            from PIL import Image
            with Image.open(image_path) as img:
                return self.img_encoder.encode(img.convert("RGB"))
        except Exception as e:
            print(f"[CLIP] Falha ao embedar {image_path.name}: {e}")
            return None

    def embed_frame_bgr(self, frame_bgr: np.ndarray) -> np.ndarray:
        """Embedding CLIP de um frame OpenCV (BGR) — usado nos beats da segmentação."""
        from PIL import Image
        rgb = frame_bgr[:, :, ::-1]
        return self.img_encoder.encode(Image.fromarray(rgb))

    # ── Indexação ────────────────────────────────────────────────────────────
    def index_video_keyframe(
        self, project_id: int, video_id: int, frame_path: Path,
        start_time: float, end_time: float, segment_id: Optional[int] = None,
    ) -> bool:
        vec = self.embed_image_file(frame_path)
        if vec is None:
            return False
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_vid_{video_id}_seg_{start_time:.2f}"))
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vec.tolist(), payload={
                "project_id": project_id, "video_id": video_id,
                "media_type": "broll",
                "start_time": start_time, "end_time": end_time,
                "segment_id": segment_id,
            })],
        )
        return True

    def index_photo(
        self, project_id: int, photo_id: int, image_path: Path,
        vector: Optional[np.ndarray] = None,
    ) -> bool:
        """Indexa a foto. `vector` reaproveita um embedding já calculado (ex: agrupamento de rajadas)."""
        vec = vector if vector is not None else self.embed_image_file(image_path)
        if vec is None:
            return False
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_photo_{photo_id}"))
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vec.tolist(), payload={
                "project_id": project_id, "photo_id": photo_id,
                "media_type": "photo",
            })],
        )
        return True

    def delete_video_images(self, project_id: int, video_id: int) -> None:
        """Remove os keyframes visuais de um vídeo — evita órfãos ao reanalisar/re-segmentar."""
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(must=[
                    FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                    FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                ]),
            )
        except Exception as e:
            print(f"[CLIP] Erro ao limpar imagens do vídeo {video_id}: {e}")

    # ── Busca ────────────────────────────────────────────────────────────────
    def search_text(self, project_id: int, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Busca visual por texto em português (espaço vetorial compartilhado)."""
        vec = self.txt_encoder.encode(query)
        return self._query(project_id, vec, limit)

    def similar_to_photo(self, project_id: int, photo_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Imagens visualmente próximas de uma foto já indexada."""
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_photo_{photo_id}"))
        try:
            pts = self.client.retrieve(self.collection_name, ids=[point_id], with_vectors=True)
            if not pts:
                return []
            results = self._query(project_id, np.array(pts[0].vector), limit + 1)
            return [r for r in results if r["payload"].get("photo_id") != photo_id][:limit]
        except Exception as e:
            print(f"[CLIP] Falha em similares da foto {photo_id}: {e}")
            return []

    def similar_to_video_moment(
        self, project_id: int, video_id: int, timestamp: float = 0.0, limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Imagens próximas do keyframe indexado mais perto do timestamp dado."""
        try:
            pts, _ = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(must=[
                    FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                    FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                ]),
                limit=500, with_vectors=True, with_payload=True,
            )
            if not pts:
                return []
            ref = min(pts, key=lambda p: abs((p.payload or {}).get("start_time", 0.0) - timestamp))
            results = self._query(project_id, np.array(ref.vector), limit + 3)
            # remove o próprio vídeo de origem no mesmo trecho
            ref_start = (ref.payload or {}).get("start_time", 0.0)
            return [
                r for r in results
                if not (r["payload"].get("video_id") == video_id
                        and abs(r["payload"].get("start_time", 0.0) - ref_start) < 0.5)
            ][:limit]
        except Exception as e:
            print(f"[CLIP] Falha em similares do vídeo {video_id}: {e}")
            return []

    def _query(self, project_id: int, vector: np.ndarray, limit: int) -> List[Dict[str, Any]]:
        response = self.client.query_points(
            collection_name=self.collection_name,
            query=vector.tolist(),
            query_filter=Filter(must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id)),
            ]),
            limit=limit,
        )
        return [{"id": r.id, "score": r.score, "payload": r.payload} for r in response.points]
