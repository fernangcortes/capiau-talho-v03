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

from src.search.semantic import SemanticSearch, QdrantUnavailableError


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
        self.collection_name = "capiau_images"
        self._img_encoder = None
        self._txt_encoder = None
        self._init_collection()

    @property
    def client(self):
        # Sempre lido do singleton (nunca guardado) — se o SemanticSearch reconectar
        # sozinho após uma queda (check_health), este client acompanha, em vez de
        # ficar apontando para uma conexão morta.
        return SemanticSearch.get_instance().client

    def _init_collection(self):
        if self.client is None:
            return
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
    @staticmethod
    def _shot_scale_facet(vec: np.ndarray, project_id: int) -> tuple:
        """(rotulo, score) da escala de plano, ou (None, None). Falha aqui NUNCA
        pode derrubar a indexação (lição do E2.A5: acessório não quebra o principal)."""
        try:
            from src.services.settings_service import SettingsService
            if not SettingsService.get_settings(project_id).get("clip.shot_scale_enabled"):
                return None, None
            from src.vision.shot_scale import ShotScaleClassifier
            label, score = ShotScaleClassifier.get_instance().classify(vec)
            return label, round(score, 3)
        except Exception as e:
            print(f"[ShotScale] Falha na classificacao de escala (indexacao segue sem faceta): {e}")
            return None, None

    def index_video_keyframe(
        self, project_id: int, video_id: int, frame_path: Path,
        start_time: float, end_time: float, segment_id: Optional[int] = None,
        category: Optional[str] = None, camera_motion: Optional[str] = None,
    ) -> Optional[str]:
        """Indexa o keyframe e retorna o rótulo de escala de plano (None se desativado/falha).

        Retorno truthy = sucesso na indexação (compatível com o uso booleano antigo);
        o rótulo permite ao chamador persistir a faceta em media_segment.
        """
        vec = self.embed_image_file(frame_path)
        if vec is None:
            return None
        shot_scale, scale_score = self._shot_scale_facet(vec, project_id)
        payload = {
            "project_id": project_id, "video_id": video_id,
            "media_type": "broll",
            "start_time": start_time, "end_time": end_time,
            "segment_id": segment_id,
        }
        if shot_scale:
            payload["shot_scale"] = shot_scale
        if category:
            payload["category"] = category
        if camera_motion:
            payload["camera_motion"] = camera_motion
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_vid_{video_id}_seg_{start_time:.2f}"))
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vec.tolist(), payload=payload)],
        )
        return shot_scale or "indexed"

    def index_photo(
        self, project_id: int, photo_id: int, image_path: Path,
        vector: Optional[np.ndarray] = None, category: Optional[str] = None,
        palette_temp: Optional[str] = None,
    ) -> bool:
        """Indexa a foto. `vector` reaproveita um embedding já calculado (ex: agrupamento de rajadas)."""
        vec = vector if vector is not None else self.embed_image_file(image_path)
        if vec is None:
            return False
        shot_scale, _ = self._shot_scale_facet(vec, project_id)
        payload = {
            "project_id": project_id, "photo_id": photo_id,
            "media_type": "photo",
        }
        if shot_scale:
            payload["shot_scale"] = shot_scale
        if category:
            payload["category"] = category
        if palette_temp:
            payload["palette_temp"] = palette_temp
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_photo_{photo_id}"))
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vec.tolist(), payload=payload)],
        )
        return True

    def sync_category_payload(self, project_id: int, category: str,
                              video_id: Optional[int] = None, photo_ids: Optional[list] = None) -> None:
        """Atualiza a faceta 'category' dos pontos já indexados (correção humana do E2.C2)."""
        from qdrant_client.models import MatchAny
        try:
            must = [FieldCondition(key="project_id", match=MatchValue(value=project_id))]
            if video_id is not None:
                must.append(FieldCondition(key="video_id", match=MatchValue(value=video_id)))
            elif photo_ids:
                must.append(FieldCondition(key="photo_id", match=MatchAny(any=list(photo_ids))))
            else:
                return
            self.client.set_payload(
                collection_name=self.collection_name,
                payload={"category": category},
                points=Filter(must=must),
            )
        except Exception as e:
            print(f"[CLIP] Falha ao sincronizar categoria no indice visual: {e}")

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
    def search_text(self, project_id: int, query: str, limit: int = 10,
                    shot_scale: Optional[str] = None, category: Optional[str] = None,
                    camera_motion: Optional[str] = None,
                    palette_temp: Optional[str] = None) -> List[Dict[str, Any]]:
        """Busca visual por texto em português, com filtros de faceta opcionais (E2.D3)."""
        vec = self.txt_encoder.encode(query)
        extra = []
        if shot_scale:
            extra.append(FieldCondition(key="shot_scale", match=MatchValue(value=shot_scale)))
        if category:
            extra.append(FieldCondition(key="category", match=MatchValue(value=category)))
        if camera_motion:
            extra.append(FieldCondition(key="camera_motion", match=MatchValue(value=camera_motion)))
        if palette_temp:
            extra.append(FieldCondition(key="palette_temp", match=MatchValue(value=palette_temp)))
        return self._query(project_id, vec, limit, extra_conditions=extra or None)

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

    def _video_keyframes(self, project_id: int, video_id: int) -> list:
        """Keyframes indexados de um vídeo, ordenados por start_time."""
        pts, _ = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=Filter(must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                FieldCondition(key="video_id", match=MatchValue(value=video_id)),
            ]),
            limit=500, with_vectors=True, with_payload=True,
        )
        return sorted(pts or [], key=lambda p: (p.payload or {}).get("start_time", 0.0))

    def similar_to_multiple_items(
        self, project_id: int, items: List[Dict[str, Any]],
        media_type_filter: Optional[str] = None, limit: int = 10,
    ) -> Dict[str, Any]:
        """Busca visual em lote com agregação automática (ver batch_utils):
        seleção coesa -> média dos vetores (tema comum); heterogênea -> união por melhor score.

        Retorna {"results", "mode_used", "cohesion", "warnings"}; cada result carrega
        "best_source" (item de origem mais parecido, para a explicação didática).
        media_type_filter: "photo" filtra no Qdrant; "interview"/"broll" só separa
        vídeos de fotos aqui (keyframes não guardam video_type — a rota refina via DB).
        """
        from src.search.batch_utils import (
            best_source_for_vector, merge_union_hits, pick_mode, sample_evenly,
        )
        if not items:
            raise ValueError("Nenhum item informado para a busca em lote.")

        vectors: List[np.ndarray] = []            # sub-vetores (keyframes contam individualmente)
        sources: List[Dict[str, Any]] = []        # item de origem de cada sub-vetor
        warnings: List[str] = []
        exclude_photos = set()
        exclude_whole_videos = set()
        exclude_moments = []  # {"video_id", "start_time"} (janela de ±0.5s)

        for item in items:
            kind, item_id = item.get("kind"), item.get("id")
            found = False
            try:
                if kind == "photo":
                    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"img_proj_{project_id}_photo_{item_id}"))
                    pts = self.client.retrieve(self.collection_name, ids=[point_id], with_vectors=True)
                    if pts and pts[0].vector:
                        vectors.append(np.array(pts[0].vector))
                        sources.append(item)
                        exclude_photos.add(item_id)
                        found = True
                elif kind == "video":
                    keyframes = self._video_keyframes(project_id, item_id)
                    timestamp = item.get("timestamp")
                    if timestamp is not None:
                        if keyframes:
                            ref = min(keyframes, key=lambda p: abs((p.payload or {}).get("start_time", 0.0) - timestamp))
                            if ref.vector:
                                vectors.append(np.array(ref.vector))
                                sources.append(item)
                                exclude_moments.append({
                                    "video_id": item_id,
                                    "start_time": (ref.payload or {}).get("start_time", 0.0),
                                })
                                found = True
                    else:
                        # Vídeo inteiro: amostra keyframes espaçados (não a média cega de todos)
                        for p in sample_evenly([p for p in keyframes if p.vector]):
                            vectors.append(np.array(p.vector))
                            sources.append(item)
                            found = True
                        if found:
                            exclude_whole_videos.add(item_id)
            except Exception as e:
                print(f"[CLIP] Erro ao recuperar vetor de {kind} {item_id}: {e}")
            if not found:
                warnings.append(f"item_sem_indice:{kind}:{item_id}")

        if not vectors:
            return {"results": [], "mode_used": "media", "cohesion": 0.0, "warnings": warnings}

        mode, cohesion = pick_mode(vectors)

        # Filtro por tipo no Qdrant: fotos são identificáveis; keyframes de vídeo são
        # todos "broll" no payload desta coleção, então interview/broll só separa vídeo
        # de foto — a rota completa o refino consultando o SQLite.
        extra_conditions = []
        if media_type_filter == "photo":
            extra_conditions.append(FieldCondition(key="media_type", match=MatchValue(value="photo")))
        fetch_limit = limit + len(vectors) * 3

        if mode == "media":
            mean_vector = np.mean(vectors, axis=0)
            hits = self._query(
                project_id, mean_vector, fetch_limit,
                extra_conditions=extra_conditions, with_vectors=True,
            )
            for h in hits:
                if h.get("vector") is not None:
                    h["best_source"] = best_source_for_vector(np.array(h.pop("vector")), vectors, sources)
                else:
                    h.pop("vector", None)
                    h["best_source"] = dict(sources[0])
        else:
            per_source = []
            for vec, src in zip(vectors, sources):
                per_source.append((src, self._query(
                    project_id, vec, fetch_limit, extra_conditions=extra_conditions,
                )))
            hits = merge_union_hits(per_source, fetch_limit)

        # Se o filtro pede vídeos, descarta fotos já aqui
        if media_type_filter in ("interview", "broll"):
            hits = [h for h in hits if h["payload"].get("photo_id") is None]

        results = []
        for r in hits:
            payload = r["payload"]
            if payload.get("photo_id") in exclude_photos:
                continue
            vid_id = payload.get("video_id")
            if vid_id is not None:
                if vid_id in exclude_whole_videos:
                    continue
                start_time = payload.get("start_time", 0.0)
                if any(ex["video_id"] == vid_id and abs(ex["start_time"] - start_time) < 0.5
                       for ex in exclude_moments):
                    continue
            results.append(r)

        return {
            "results": results[:limit],
            "mode_used": mode,
            "cohesion": cohesion,
            "warnings": warnings,
        }

    def _query(
        self, project_id: int, vector: np.ndarray, limit: int,
        extra_conditions: Optional[list] = None, with_vectors: bool = False,
    ) -> List[Dict[str, Any]]:
        sem = SemanticSearch.get_instance()
        if not sem.is_available or self.client is None:
            raise QdrantUnavailableError(sem.error_message or "Índice visual Qdrant indisponível.")

        try:
            conditions = [FieldCondition(key="project_id", match=MatchValue(value=project_id))]
            if extra_conditions:
                conditions.extend(extra_conditions)
            response = self.client.query_points(
                collection_name=self.collection_name,
                query=vector.tolist(),
                query_filter=Filter(must=conditions),
                limit=limit,
                with_vectors=with_vectors,
            )
            out = []
            for r in response.points:
                hit = {"id": r.id, "score": r.score, "payload": r.payload}
                if with_vectors:
                    hit["vector"] = r.vector
                out.append(hit)
            return out
        except QdrantUnavailableError:
            raise
        except Exception as e:
            sem.is_available = False
            sem.error_message = str(e)
            raise QdrantUnavailableError(f"Erro na consulta visual Qdrant: {e}") from e
