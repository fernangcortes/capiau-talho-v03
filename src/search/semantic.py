"""Banco de dados vetorial local Qdrant embutido (100% CPU, sem Docker)."""
import os
from pathlib import Path
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
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

    def index_transcript_chunks(self, project_id: int, video_id: int, dialogues: list):
        """Indexa os parágrafos de transcrição de depoimentos isolados por project_id.
        
        'dialogues' deve ser uma lista de dicionários contendo:
        {'speaker_id': str, 'start_time': float, 'end_time': float, 'text': str}
        """
        # Obter o tipo real do vídeo (interview ou broll) no SQLite
        from src.db.operations import get_connection
        conn = get_connection()
        video_type = "interview"
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT video_type FROM video WHERE id = ?", (video_id,))
            row = cursor.fetchone()
            if row:
                video_type = row['video_type']
        except Exception as e:
            print(f"[QDRANT] Erro ao buscar tipo de vídeo no banco: {e}")
        finally:
            conn.close()

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
            
            points.append(PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "project_id": project_id,
                    "video_id": video_id,
                    "media_type": "broll",
                    "start_time": desc['timestamp'],
                    "end_time": desc['timestamp'] + CONFIG.FRAME_INTERVAL,
                    "text": desc['description'],
                    "tags": desc['tags']
                }
            ))
            
        if points:
            self.client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            print(f"[QDRANT] {len(points)} frames de B-roll indexados para projeto {project_id}, vídeo {video_id}")

    def index_photo_description(self, project_id: int, photo_id: int, description: str, tags: list):
        """Indexa a descrição de uma foto de set isolada por project_id."""
        text_to_embed = f"Foto de set: {description}. Tags: {', '.join(tags)}"
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

