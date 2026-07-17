"""Banco de dados vetorial local Qdrant embutido (100% CPU, sem Docker)."""
import os
from pathlib import Path
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, MatchAny
from sentence_transformers import SentenceTransformer
from src.config import CONFIG
import uuid

class SemanticSearch:
    _instance = None

    @classmethod
    def get_instance(cls):
        """Retorna uma única instância compartilhada do buscador (Singleton)."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        # Inicializa o banco de dados Qdrant local baseado em arquivo no disco
        db_file_path = CONFIG.QDRANT_DB_PATH
        db_file_path.parent.mkdir(parents=True, exist_ok=True)
        
        print(f"[QDRANT] Conectando ao banco local em: {db_file_path}")
        self.client = QdrantClient(path=str(db_file_path))
        
        # Carrega o modelo leve de embeddings (MiniLM) que roda de forma super veloz na CPU
        print("[QDRANT] Carregando modelo sentence-transformers local em CPU...")
        self.encoder = SentenceTransformer(CONFIG.embedding_model, device="cpu")
        
        self.collection_name = "capiau_making_of"
        self._init_collection()

    def _init_collection(self):
        """Inicializa a coleção vetorial se ela não existir no arquivo local."""
        try:
            collections = [c.name for c in self.client.get_collections().collections]
            if self.collection_name not in collections:
                # all-MiniLM-L6-v2 gera vetores de 384 dimensões
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=384, distance=Distance.COSINE)
                )
                print(f"[QDRANT] Coleção '{self.collection_name}' criada com sucesso.")
            else:
                print(f"[QDRANT] Coleção '{self.collection_name}' já existe.")
        except Exception as e:
            print(f"[QDRANT] Erro ao inicializar a coleção: {e}")

    def index_transcript_chunks(self, project_id: int, video_id: int, dialogues: list, video_type: str = "interview") -> None:
        """Indexa os parágrafos de transcrição de depoimentos isolados por project_id.
        
        'dialogues' deve ser uma lista de dicionários contendo:
        {'speaker_id': str, 'start_time': float, 'end_time': float, 'text': str}
        """
        points = []
        for idx, dial in enumerate(dialogues):
            text_to_embed = f"{dial['speaker_id']}: \"{dial['text']}\""
            # Gera embedding usando a CPU local
            vector = self.encoder.encode(text_to_embed).tolist()
            
            # ID único do ponto no formato string UUID v5
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_vid_{video_id}_chunk_{idx}"))
            
            points.append(PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "project_id": project_id,
                    "video_id": video_id,
                    "media_type": video_type,
                    "speaker_id": dial['speaker_id'],
                    "start_time": dial['start_time'],
                    "end_time": dial['end_time'],
                    "text": dial['text']
                }
            ))
            
        if points:
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            print(f"[QDRANT] {len(points)} falas indexadas ({video_type}) para projeto {project_id}, vídeo {video_id}")

    def index_broll_descriptions(self, project_id: int, video_id: int, descriptions: list):
        """Indexa as análises visuais de frames do B-Roll isolados por project_id.
        
        'descriptions' deve ser uma lista de dicionários contendo:
        {'timestamp': float, 'description': str, 'tags': list}
        """
        points = []
        for idx, desc in enumerate(descriptions):
            text_to_embed = f"B-Roll frame {desc['timestamp']}s: {desc['description']}. Elementos: {', '.join(desc['tags'])}"
            vector = self.encoder.encode(text_to_embed).tolist()

            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_vid_{video_id}_broll_{idx}"))

            payload = {
                "project_id": project_id,
                "video_id": video_id,
                "media_type": "broll",
                # Fronteiras reais do segmento (shot/beat) quando disponíveis;
                # fallback: janela legada timestamp + FRAME_INTERVAL
                "start_time": desc.get('start_time', desc['timestamp']),
                "end_time": desc.get('end_time', desc['timestamp'] + CONFIG.FRAME_INTERVAL),
                "text": desc['description'],
                "raw_text": desc['description'],
                "tags": desc['tags']
            }
            # Saída estruturada da visão (pessoas/objetos citados) para busca e auditoria
            if desc.get('people'):
                payload["people"] = desc['people']
            if desc.get('objects'):
                payload["objects"] = desc['objects']

            points.append(PointStruct(
                id=point_id,
                vector=vector,
                payload=payload
            ))
            
        if points:
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            print(f"[QDRANT] {len(points)} frames de B-roll indexados para projeto {project_id}, vídeo {video_id}")

    def delete_video_broll_points(self, project_id: int, video_id: int) -> None:
        """Remove os pontos de B-roll (frames) de um vídeo — evita órfãos ao reanalisar."""
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(must=[
                    FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                    FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                    FieldCondition(key="media_type", match=MatchValue(value="broll")),
                ]),
            )
        except Exception as e:
            print(f"[QDRANT] Erro ao limpar frames do vídeo {video_id}: {e}")

    def index_photo_description(self, project_id: int, photo_id: int, description: str, tags: list):
        """Indexa a descrição de uma foto isolada por project_id."""
        text_to_embed = f"Foto: {description}. Tags: {', '.join(tags)}"
        vector = self.encoder.encode(text_to_embed).tolist()
        
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_photo_{photo_id}"))
        
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "project_id": project_id,
                    "photo_id": photo_id,
                    "media_type": "photo",
                    "text": description,
                    "raw_text": description,
                    "tags": tags
                }
            )]
        )
        print(f"[QDRANT] Foto ID {photo_id} do projeto {project_id} indexada com sucesso.")

    def search(self, project_id: int, query: str, media_type: str = None, limit: int = 10):
        """Pesquisa semântica em toda a biblioteca isolada estritamente por project_id.
        
        'media_type' pode ser 'interview', 'broll' ou 'photo' para filtrar resultados.
        """
        query_vector = self.encoder.encode(query).tolist()
        
        # Filtro estrito por project_id
        conditions = [
            FieldCondition(
                key="project_id",
                match=MatchValue(value=project_id)
            )
        ]
        
        # Filtro adicional opcional por tipo de mídia
        if media_type:
            if media_type == "interview":
                conditions.append(
                    FieldCondition(
                        key="media_type",
                        match=MatchAny(any=["interview", "video"])
                    )
                )
            else:
                conditions.append(
                    FieldCondition(
                        key="media_type",
                        match=MatchValue(value=media_type)
                    )
                )
            
        query_filter = Filter(must=conditions)
            
        response = self.client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            query_filter=query_filter,
            limit=limit
        )
        results = response.points
        
        formatted_results = []
        for r in results:
            formatted_results.append({
                "id": r.id,
                "score": r.score,
                "payload": r.payload
            })
            
        return formatted_results

    def _batch_filter_conditions(self, project_id: int, media_type_filter: str = None) -> list:
        """Condições de filtro compartilhadas da busca em lote (mesma regra do search())."""
        conditions = [FieldCondition(key="project_id", match=MatchValue(value=project_id))]
        if media_type_filter and media_type_filter != "all":
            if media_type_filter == "interview":
                conditions.append(FieldCondition(key="media_type", match=MatchAny(any=["interview", "video"])))
            else:
                conditions.append(FieldCondition(key="media_type", match=MatchValue(value=media_type_filter)))
        return conditions

    def similar_to_multiple_items(
        self, project_id: int, items: list, media_type_filter: str = None, limit: int = 10
    ):
        """Busca textual (transcrições/descrições) em lote com agregação automática
        (ver batch_utils): seleção coesa -> média dos vetores; heterogênea -> união.

        Retorna {"results", "mode_used", "cohesion", "warnings"}; cada result carrega
        "best_source" e "matched_text" (trecho que casou, para a explicação didática).
        """
        import numpy as np
        from src.search.batch_utils import (
            best_source_for_vector, merge_union_hits, pick_mode,
        )
        if not items:
            raise ValueError("Nenhum item informado para a busca em lote.")

        vectors = []          # um vetor textual por item de origem
        sources = []
        warnings = []
        exclude_points = set()

        if any(i.get("kind") == "photo" for i in items):
            warnings.append("photos_use_descriptions")

        for item in items:
            kind = item.get("kind")
            item_id = item.get("id")
            found = False
            try:
                if kind == "photo":
                    point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_photo_{item_id}"))
                    pts = self.client.retrieve(self.collection_name, ids=[point_id], with_vectors=True)
                    if pts and pts[0].vector:
                        vectors.append(np.array(pts[0].vector))
                        sources.append(item)
                        exclude_points.add(point_id)
                        found = True
                elif kind == "video":
                    pts, _ = self.client.scroll(
                        collection_name=self.collection_name,
                        scroll_filter=Filter(must=[
                            FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                            FieldCondition(key="video_id", match=MatchValue(value=item_id)),
                        ]),
                        limit=500, with_vectors=True, with_payload=True,
                    )
                    timestamp = item.get("timestamp")
                    if timestamp is not None:
                        # Momento específico: o trecho indexado mais próximo do timestamp
                        if pts:
                            ref = min(pts, key=lambda p: abs((p.payload or {}).get("start_time", 0.0) - timestamp))
                            if ref and ref.vector:
                                vectors.append(np.array(ref.vector))
                                sources.append(item)
                                exclude_points.add(ref.id)
                                found = True
                    else:
                        # Vídeo inteiro: média dos trechos = "sobre o que o vídeo fala"
                        vid_vecs = [np.array(p.vector) for p in pts if p.vector]
                        if vid_vecs:
                            vectors.append(np.mean(vid_vecs, axis=0))
                            sources.append(item)
                            exclude_points.update(p.id for p in pts)
                            found = True
            except Exception as e:
                print(f"[QDRANT] Erro ao recuperar vetor texto de {kind} {item_id}: {e}")
            if not found:
                warnings.append(f"item_sem_indice:{kind}:{item_id}")

        if not vectors:
            return {"results": [], "mode_used": "media", "cohesion": 0.0, "warnings": warnings}

        mode, cohesion = pick_mode(vectors)
        conditions = self._batch_filter_conditions(project_id, media_type_filter)
        fetch_limit = limit + len(exclude_points) + len(vectors) * 3

        def _run_query(vec):
            response = self.client.query_points(
                collection_name=self.collection_name,
                query=vec.tolist(),
                query_filter=Filter(must=conditions),
                limit=fetch_limit,
                with_vectors=(mode == "media"),
            )
            hits = []
            for r in response.points:
                hit = {"id": r.id, "score": r.score, "payload": r.payload}
                if mode == "media":
                    hit["vector"] = r.vector
                hits.append(hit)
            return hits

        if mode == "media":
            hits = _run_query(np.mean(vectors, axis=0))
            for h in hits:
                vec = h.pop("vector", None)
                h["best_source"] = (
                    best_source_for_vector(np.array(vec), vectors, sources)
                    if vec is not None else dict(sources[0])
                )
        else:
            per_source = [(src, _run_query(vec)) for vec, src in zip(vectors, sources)]
            hits = merge_union_hits(per_source, fetch_limit)

        results = []
        for r in hits:
            if r["id"] in exclude_points:
                continue
            r["matched_text"] = (r["payload"] or {}).get("text", "")
            results.append(r)

        return {
            "results": results[:limit],
            "mode_used": mode,
            "cohesion": cohesion,
            "warnings": warnings,
        }

    def get_video_vision_frames(self, project_id: int, video_id: int):
        """Recupera todas as descrições de frames do B-Roll indexadas no Qdrant para este vídeo."""
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        query_filter = Filter(
            must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                FieldCondition(key="media_type", match=MatchValue(value="broll"))
             ]
        )
        try:
            response = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=query_filter,
                limit=100,
                with_payload=True
            )
            points = response[0]
            frames = []
            for p in points:
                frames.append({
                    "timestamp": p.payload.get("start_time", 0.0),
                    "description": p.payload.get("text", ""),
                    "tags": p.payload.get("tags", [])
                })
            frames.sort(key=lambda x: x["timestamp"])
            return frames
        except Exception as e:
            print(f"[QDRANT] Erro ao recuperar frames do vídeo: {e}")
            return []

    def get_video_vision_frame_description(self, project_id: int, video_id: int, timestamp: float) -> str:
        """Recupera a descrição de um único frame de B-Roll indexado no Qdrant."""
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        try:
            response = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                        FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                        FieldCondition(key="media_type", match=MatchValue(value="broll"))
                    ]
                ),
                limit=1000,
                with_payload=True
            )
            points = response[0]
            if not points:
                return ""
                
            best_desc = ""
            min_diff = 999.0
            for p in points:
                p_ts = p.payload.get("start_time", 0.0)
                diff = abs(p_ts - timestamp)
                if diff < min_diff and diff < 1.0: # 1s tolerance
                    min_diff = diff
                    best_desc = p.payload.get("text", "")
            return best_desc
        except Exception as e:
            print(f"[QDRANT] Erro ao recuperar frame description: {e}")
            return ""


    def get_video_vision_points(self, project_id: int, video_id: int):
        """Recupera os pontos brutos (com IDs) das descrições de frames do B-Roll para reindexação."""
        query_filter = Filter(
            must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                FieldCondition(key="video_id", match=MatchValue(value=video_id)),
                FieldCondition(key="media_type", match=MatchValue(value="broll"))
            ]
        )
        try:
            response = self.client.scroll(
                collection_name=self.collection_name,
                scroll_filter=query_filter,
                limit=2000,
                with_payload=True
            )
            return response[0]
        except Exception as e:
            print(f"[QDRANT] Erro ao recuperar pontos do vídeo {video_id}: {e}")
            return []

    def _build_embed_text(self, payload: dict) -> str:
        """Reconstrói o texto de embedding canônico de um ponto a partir do payload.

        Mantém o MESMO formato usado na indexação original de cada tipo de mídia,
        garantindo que reindexações produzam vetores comparáveis.
        """
        media_type = payload.get("media_type", "")
        text = payload.get("text", "") or ""
        tags = payload.get("tags") or []

        if media_type in ("interview", "video"):
            speaker = payload.get("speaker_id", "")
            return f"{speaker}: \"{text}\"" if speaker else text
        if media_type == "broll":
            ts = payload.get("start_time", 0.0)
            return f"B-Roll frame {ts}s: {text}. Elementos: {', '.join(tags)}"
        if media_type == "photo":
            return f"Foto: {text}. Tags: {', '.join(tags)}"
        if media_type == "doc":
            return f"Documento '{payload.get('filename', '')}' | Parágrafo: {text}"
        return text

    def update_point_text(self, point_id, payload: dict, enriched_text: str):
        """Reescreve o texto de um ponto existente (mantendo o ID) e re-embeda o vetor.

        Usado pelo motor de enriquecimento: a busca semântica passa a enxergar os
        nomes reais de pessoas/objetos em vez dos termos genéricos originais.
        """
        new_payload = dict(payload)
        # Preserva o texto original da visão apenas na primeira reescrita
        if "raw_text" not in new_payload or not new_payload.get("raw_text"):
            new_payload["raw_text"] = new_payload.get("text", "")
        new_payload["text"] = enriched_text

        vector = self.encoder.encode(self._build_embed_text(new_payload)).tolist()
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(id=point_id, vector=vector, payload=new_payload)]
        )

    def reindex_all(self) -> int:
        """Re-embeda TODOS os pontos da coleção com o modelo de embeddings atual.

        Necessário após trocar CONFIG.embedding_model (ex: migração para o modelo
        multilíngue). Mantém IDs e payloads; só os vetores são recalculados.
        Progresso visível na aba Tarefas (TASK_MANAGER).
        """
        from src.core.tasks import TASK_MANAGER
        task_key = "reindex-embeddings"
        TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="index")

        try:
            total = self.client.count(self.collection_name).count
        except Exception:
            total = 0

        print(f"[QDRANT] Reindexação total iniciada: {total} pontos com o modelo '{CONFIG.embedding_model}'...")

        done = 0
        offset = None
        try:
            while True:
                points, offset = self.client.scroll(
                    collection_name=self.collection_name,
                    limit=256,
                    offset=offset,
                    with_payload=True
                )
                if not points:
                    break

                texts = [self._build_embed_text(p.payload or {}) for p in points]
                vectors = self.encoder.encode(texts, show_progress_bar=False)

                self.client.upsert(
                    collection_name=self.collection_name,
                    points=[
                        PointStruct(id=p.id, vector=v.tolist(), payload=p.payload or {})
                        for p, v in zip(points, vectors)
                    ]
                )
                done += len(points)
                percent = min(99.0, (done / max(total, 1)) * 100.0)
                TASK_MANAGER.update_progress(task_key, percent, "running", task_type="index")

                if offset is None:
                    break

            TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="index")
            print(f"[QDRANT] Reindexação concluída: {done} pontos re-embedados.")
            return done
        except Exception as e:
            print(f"[QDRANT] Erro na reindexação: {e}")
            TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="index")
            return done

    def get_photo_point(self, project_id: int, photo_id: int):
        """Recupera o ponto indexado de uma foto (ou None)."""
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_photo_{photo_id}"))
        try:
            points = self.client.retrieve(
                collection_name=self.collection_name,
                ids=[point_id],
                with_payload=True
            )
            return points[0] if points else None
        except Exception as e:
            print(f"[QDRANT] Erro ao recuperar ponto da foto {photo_id}: {e}")
            return None

    def index_annotation(self, project_id: int, video_id: int, start_time: float, end_time: float, text: str):
        """Indexa uma anotação manual (objeto/elemento marcado pelo usuário) como ponto pesquisável."""
        vector = self.encoder.encode(text).tolist()
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_vid_{video_id}_annot_{start_time}"))
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "project_id": project_id,
                    "video_id": video_id,
                    "media_type": "broll",
                    "start_time": start_time,
                    "end_time": end_time,
                    "text": text,
                    "tags": []
                }
            )]
        )

    def index_production_doc(self, project_id: int, doc_id: int, filename: str, content: str):
        """Indexa um documento de contexto fatiando-o em parágrafos no Qdrant local."""
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        
        points = []
        for idx, text in enumerate(paragraphs):
            if len(text) < 10:
                continue
                
            text_to_embed = f"Documento '{filename}' | Parágrafo: {text}"
            vector = self.encoder.encode(text_to_embed).tolist()
            
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"proj_{project_id}_doc_{doc_id}_para_{idx}"))
            
            points.append(PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "project_id": project_id,
                    "doc_id": doc_id,
                    "media_type": "doc",
                    "filename": filename,
                    "text": text
                }
            ))
            
        if points:
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            print(f"[QDRANT] {len(points)} parágrafos indexados para o documento ID {doc_id} no projeto {project_id}")

    def delete_production_doc_vectors(self, project_id: int, doc_id: int):
        """Remove todos os vetores indexados de um documento de produção."""
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(key="project_id", match=MatchValue(value=project_id)),
                        FieldCondition(key="doc_id", match=MatchValue(value=doc_id)),
                        FieldCondition(key="media_type", match=MatchValue(value="doc"))
                    ]
                )
            )
            print(f"[QDRANT] Vetores do documento ID {doc_id} removidos com sucesso.")
        except Exception as e:
            print(f"[QDRANT] Erro ao remover vetores do documento ID {doc_id}: {e}")

