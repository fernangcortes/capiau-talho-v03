"""FaceService - Camada de negocio para reconhecimento facial.

Orquestra o FacePipeline com persistencia no SQLite, aplicando a hierarquia
de precedencia para resolver conflitos entre diferentes tiers e modelos.

Hierarquia de precedencia:
  1. Manual confirmado (status='confirmed') sempre ganha
  2. Tier mais alto prevalece (se nao manual)
  3. Mais recente prevalece (mesmo tier)
  4. Maior confidence score
"""
import json
import cv2
import numpy as np
from pathlib import Path
from src.vision.cv_utils import imread_unicode
from typing import List, Optional, Dict, Any, Tuple

from src.config import CONFIG
from src.db.connection import get_db
from src.vision.face_pipeline import get_pipeline, FacePipeline
from src.vision.backends.base import BackendResult


class FaceService:
    """Servico de reconhecimento facial com persistencia versionada.
    
    Gerencia deteccao, reconhecimento, clustering e resolucao de conflitos
    entre multiplos backends (Tier 0-4).
    """

    def __init__(self):
        self.pipeline = get_pipeline()
        self.models_dir = Path("data/models")
        self.crops_dir = Path("data/crops")
        self.crops_dir.mkdir(parents=True, exist_ok=True)

    # ── Deteccao e Persistencia ──

    def detect_faces_in_photo(self, project_id: int, photo_id: int, image_path: Path) -> int:
        """Executa Tier 0 (local rapido) em uma foto e persiste deteccoes.
        
        Returns:
            Numero de rostos detectados
        """
        # Limpar deteccoes anteriores da mesma foto (apenas Tier 0 auto)
        self._clear_auto_detections(photo_id=photo_id)
        
        # Executar pipeline Tier 0
        result = self.pipeline.process_first_pass(image_path, project_id=project_id)
        
        if result.error:
            print(f"[FACE_SERVICE] Erro na deteccao: {result.error}")
            return 0
        
        # Salvar cada deteccao + reconhecimento
        count = 0
        for det, rec in zip(result.detections, result.recognitions):
            # Extrair crop do rosto
            crop_path = self._save_face_crop(image_path, det.box, photo_id=photo_id, face_idx=count)
            
            # Inserir face (entidade fisica)
            face_id = self._insert_face(
                project_id=project_id,
                photo_id=photo_id,
                video_id=None,
                timestamp=None,
                bounding_box=det.box,
                quality_score=det.quality_score,
                blur_score=det.blur_score,
                face_size_px=det.face_size_px,
                crop_path=str(crop_path) if crop_path else None
            )
            
            # Inserir reconhecimento (Tier 0)
            self._insert_recognition(
                face_id=face_id,
                tier=result.tier,
                model=result.model_name,
                model_version=result.model_version,
                embedding=rec.embedding,
                confidence=rec.confidence,
                status="auto",
                processing_time_ms=result.processing_time_ms
            )
            count += 1
        
        print(f"[FACE_SERVICE] {count} rostos detectados na foto {photo_id}")
        return count

    def detect_faces_in_video_frame(
        self,
        project_id: int,
        video_id: int,
        timestamp: float,
        image_path: Path
    ) -> int:
        """Executa Tier 0 em um frame de video e persiste deteccoes."""
        self._clear_auto_detections(video_id=video_id, timestamp=timestamp)
        
        result = self.pipeline.process_first_pass(image_path, project_id=project_id)
        
        if result.error:
            return 0
        
        count = 0
        for det, rec in zip(result.detections, result.recognitions):
            crop_path = self._save_face_crop(image_path, det.box, video_id=video_id, timestamp=timestamp, face_idx=count)
            
            face_id = self._insert_face(
                project_id=project_id,
                photo_id=None,
                video_id=video_id,
                timestamp=timestamp,
                bounding_box=det.box,
                quality_score=det.quality_score,
                blur_score=det.blur_score,
                face_size_px=det.face_size_px,
                crop_path=str(crop_path) if crop_path else None
            )
            
            self._insert_recognition(
                face_id=face_id,
                tier=result.tier,
                model=result.model_name,
                model_version=result.model_version,
                embedding=rec.embedding,
                confidence=rec.confidence,
                status="auto",
                processing_time_ms=result.processing_time_ms
            )
            count += 1
        
        return count

    # ── Refinamento com Tiers Superiores ──

    def refine_face(self, face_id: int, image_path: Path, max_tier: int = 2) -> Optional[BackendResult]:
        """Refina uma face especifica com tiers superiores (1-2).
        
        Usado para faces com baixa confianca do Tier 0.
        """
        face = self._get_face(face_id)
        if not face:
            return None
        
        # Executar pipeline do Tier 1 ate max_tier
        results = self.pipeline.process(image_path, min_tier=1, max_tier=max_tier)
        
        for result in results:
            if result.error:
                continue
            
            # Salvar reconhecimento do tier superior
            for rec in result.recognitions:
                self._insert_recognition(
                    face_id=face_id,
                    tier=result.tier,
                    model=result.model_name,
                    model_version=result.model_version,
                    embedding=rec.embedding,
                    confidence=rec.confidence,
                    status="auto",
                    processing_time_ms=result.processing_time_ms,
                    cost_usd=result.cost_usd,
                    raw_response=rec.raw_response
                )
        
        return results[0] if results else None

    def process_with_precision(self, face_id: int, image_path: Path) -> Optional[BackendResult]:
        """Processa uma face com Tier 3 (InsightFace GPU) para maxima precisao."""
        result = self.pipeline.process_precise(image_path)
        
        if result and not result.error:
            for rec in result.recognitions:
                self._insert_recognition(
                    face_id=face_id,
                    tier=result.tier,
                    model=result.model_name,
                    model_version=result.model_version,
                    embedding=rec.embedding,
                    confidence=rec.confidence,
                    status="auto",
                    processing_time_ms=result.processing_time_ms
                )
        
        return result

    # ── Clustering ──

    def cluster_project_faces(self, project_id: int, eps: Optional[float] = None, min_samples: Optional[int] = None) -> Dict[str, Any]:
        """Clusteriza todas as faces do projeto usando DBSCAN nos embeddings.
        
        Usa os embeddings autoritativos (get_authoritative_recognition) para
        cada face, garantindo que o melhor reconhecimento prevaleca.
        """
        # Cancelar qualquer tarefa de enriquecimento ativa para o projeto
        from src.core.tasks import TASK_MANAGER
        task_key = f"enrich-project-{project_id}"
        TASK_MANAGER.cancelled_tasks.add(task_key)

        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        if eps is None:
            eps = S.get("faces.dbscan_eps")
        if min_samples is None:
            min_samples = S.get("faces.dbscan_min_samples")

        # --- Autocura: Restaurar consistência de faces manualmente confirmadas ou rejeitadas ---
        with get_db() as conn:
            cursor = conn.cursor()
            
            # 1. Recuperar confirmações manuais no projeto, ordenadas para pegar a mais recente primeiro
            cursor.execute("""
                SELECT fr.face_id, fr.person_id, p.name as person_name, fr.id as rec_id
                FROM face_recognition fr
                JOIN person p ON fr.person_id = p.id
                JOIN face f ON fr.face_id = f.id
                WHERE f.project_id = ? AND fr.status = 'confirmed'
                ORDER BY fr.face_id, fr.recognized_at DESC, fr.id DESC
            """, (project_id,))
            
            rows = cursor.fetchall()
            seen_faces = set()
            for row in rows:
                fid = row["face_id"]
                rec_id = row["rec_id"]
                p_name = row["person_name"]
                
                if fid in seen_faces:
                    # Este é um duplicado mais antigo! Vamos desativá-lo para limpar o banco
                    cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE id = ?", (rec_id,))
                    continue
                seen_faces.add(fid)
                
                # Achar o cluster_id desse nome no projeto
                cursor.execute("""
                    SELECT DISTINCT cluster_id FROM face
                    WHERE project_id = ? AND name = ? AND cluster_id IS NOT NULL AND cluster_id >= 0
                    LIMIT 1
                """, (project_id, p_name))
                c_row = cursor.fetchone()
                
                if c_row:
                    actual_cluster_id = c_row["cluster_id"]
                else:
                    # Se não existir, gera um novo
                    cursor.execute("SELECT MAX(cluster_id) as max_cid FROM face WHERE project_id = ? AND cluster_id IS NOT NULL", (project_id,))
                    max_row = cursor.fetchone()
                    max_cid = max_row["max_cid"] if max_row and max_row["max_cid"] is not None else -1
                    actual_cluster_id = max_cid + 1
                
                # Restaurar no banco
                cursor.execute("""
                    UPDATE face
                    SET name = ?, cluster_id = ?
                    WHERE id = ?
                """, (p_name, actual_cluster_id, fid))
                
            # 2. Recuperar rejeições manuais no projeto para restaurar cluster_id = -1
            cursor.execute("""
                SELECT fr.face_id, fr.id as rec_id
                FROM face_recognition fr
                JOIN face f ON fr.face_id = f.id
                WHERE f.project_id = ? AND fr.status = 'rejected'
                ORDER BY fr.face_id, fr.recognized_at DESC, fr.id DESC
            """, (project_id,))
            
            rejected_rows = cursor.fetchall()
            seen_rejected = set()
            for row in rejected_rows:
                fid = row["face_id"]
                rec_id = row["rec_id"]
                
                if fid in seen_rejected or fid in seen_faces:
                    # Registro duplicado ou anulado por uma confirmação posterior
                    cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE id = ?", (rec_id,))
                    continue
                seen_rejected.add(fid)
                
                cursor.execute("SELECT name FROM face WHERE id = ?", (fid,))
                f_row = cursor.fetchone()
                current_name = f_row["name"] if f_row else None
                if not current_name or current_name.startswith("Pessoa Desconhecida") or current_name == "":
                    current_name = "Não Relevante"
                
                cursor.execute("""
                    UPDATE face
                    SET name = ?, cluster_id = -1
                    WHERE id = ?
                """, (current_name, fid))
                
            conn.commit()

        faces_data = self._get_faces_with_embeddings(project_id)
        
        if not faces_data:
            return {"total": 0, "clustered": 0, "clusters": 0, "noise": 0}
        
        face_ids = [f["face_id"] for f in faces_data]
        embeddings = [json.loads(f["embedding"]) for f in faces_data]
        
        # Clusterizar
        labels = self.pipeline.cluster_embeddings(embeddings, eps=eps, min_samples=min_samples)
        
        # Atualizar cluster_id no banco
        with get_db() as conn:
            cursor = conn.cursor()
            
            clusters_map = {}
            for i, label in enumerate(labels):
                if label >= 0:
                    if label not in clusters_map:
                        clusters_map[label] = []
                    clusters_map[label].append(face_ids[i])
            
            # Atualizar faces com cluster_id
            for cluster_id, f_ids in clusters_map.items():
                # Verificar se ja existe nome no cluster
                cluster_name = self._get_cluster_suggested_name(conn, cluster_id, f_ids)

                # Se o cluster tem um nome real, tenta achar o cluster_id existente para esse nome no projeto
                actual_cluster_id = cluster_id
                if not cluster_name.startswith("Pessoa Desconhecida") and cluster_name not in ("Não Relevante", "Não é Rosto"):
                    cursor.execute("""
                        SELECT DISTINCT cluster_id FROM face
                        WHERE project_id = ? AND name = ? AND cluster_id IS NOT NULL AND cluster_id >= 0
                        LIMIT 1
                    """, (project_id, cluster_name))
                    row = cursor.fetchone()
                    if row:
                        actual_cluster_id = row["cluster_id"]

                # Atualizar cada face individualmente, pulando as que têm confirmação manual
                for f_id in f_ids:
                    # Verificar se tem confirmação manual ativa
                    cursor.execute("""
                        SELECT 1 FROM face_recognition
                        WHERE face_id = ? AND status = 'confirmed'
                        LIMIT 1
                    """, (f_id,))
                    is_confirmed = cursor.fetchone() is not None
                    
                    if not is_confirmed:
                        cursor.execute("""
                            UPDATE face
                            SET cluster_id = ?, name = COALESCE(name, ?)
                            WHERE id = ?
                        """, (actual_cluster_id, cluster_name, f_id))
                        
                        if not cluster_name.startswith("Pessoa Desconhecida") and cluster_name not in ("Não Relevante", "Não é Rosto"):
                            cursor.execute("""
                                UPDATE face
                                SET name = ?
                                WHERE id = ? AND name LIKE 'Pessoa Desconhecida%'
                            """, (cluster_name, f_id))
            
            # Ruído: cluster_id = -1
            noise_ids = [face_ids[i] for i, l in enumerate(labels) if l == -1]
            for f_id in noise_ids:
                # Verificar se tem confirmação manual ativa antes de marcar como ruído
                cursor.execute("""
                    SELECT 1 FROM face_recognition
                    WHERE face_id = ? AND status = 'confirmed'
                    LIMIT 1
                """, (f_id,))
                is_confirmed = cursor.fetchone() is not None
                if not is_confirmed:
                    cursor.execute("UPDATE face SET cluster_id = -1 WHERE id = ?", (f_id,))
            
            conn.commit()
        
        total = len(face_ids)
        clustered = sum(len(ids) for ids in clusters_map.values())
        
        return {
            "total": total,
            "clustered": clustered,
            "clusters": len(clusters_map),
            "noise": total - clustered
        }

    # ── Desambiguacao Manual ──

    def confirm_face_identity(self, face_id: int, person_id: int, user_id: str = "manual") -> bool:
        """Operador confirma manualmente a identidade de uma face.
        
        Cria um reconhecimento Tier 4 (manual) com status='confirmed'.
        Este sempre prevalece sobre reconhecimentos automaticos.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Marcar reconhecimentos anteriores como 'superseded' se houver conflito
            cursor.execute("""
                UPDATE face_recognition 
                SET status = 'superseded'
                WHERE face_id = ? AND status != 'superseded'
            """, (face_id,))
            
            # Inserir reconhecimento manual confirmado
            cursor.execute("""
                INSERT INTO face_recognition 
                (face_id, tier, model, model_version, person_id, confidence, 
                 status, recognized_by, recognized_at)
                VALUES (?, 4, 'manual', 'v1.0', ?, 1.0, 'confirmed', ?, datetime('now'))
            """, (face_id, person_id, user_id))
            
            # Atualizar nome na tabela face
            cursor.execute("SELECT name FROM person WHERE id = ?", (person_id,))
            row = cursor.fetchone()
            if row:
                cursor.execute("UPDATE face SET name = ? WHERE id = ?", (row["name"], face_id))
            
            conn.commit()
            return True

    def create_person(self, project_id: int, name: str, aliases: List[str] = None, bio: str = "") -> int:
        """Cria uma nova pessoa no projeto."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO person (project_id, name, aliases, bio)
                VALUES (?, ?, ?, ?)
            """, (project_id, name, json.dumps(aliases or []), bio))
            conn.commit()
            return cursor.lastrowid

    def merge_clusters(self, project_id: int, cluster_src: int, cluster_dest: int, name: str) -> None:
        """Mescla dois clusters."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE face 
                SET cluster_id = ?, name = ?
                WHERE project_id = ? AND cluster_id = ?
            """, (cluster_dest, name, project_id, cluster_src))
            conn.commit()

    def reassign_face(self, face_id: int, target_cluster_id: int, target_name: str) -> None:
        """Reatribui uma face para outro cluster."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE face SET cluster_id = ?, name = ? WHERE id = ?
            """, (target_cluster_id, target_name, face_id))
            conn.commit()

    # ── Precedencia e Resolucao de Conflitos ──

    def get_authoritative_recognition(self, face_id: int) -> Optional[Dict[str, Any]]:
        """Retorna o reconhecimento autoritativo para uma face,
        aplicando a hierarquia de precedencia.
        
        Ordem: confirmed > reviewed > auto (por tier DESC, data DESC)
        """
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT fr.*, p.name as person_name
                FROM face_recognition fr
                LEFT JOIN person p ON fr.person_id = p.id
                WHERE fr.face_id = ?
                ORDER BY 
                    CASE fr.status
                        WHEN 'confirmed' THEN 1
                        WHEN 'reviewed' THEN 2
                        WHEN 'auto' THEN 3
                        WHEN 'rejected' THEN 5
                        WHEN 'superseded' THEN 6
                    END,
                    fr.tier DESC,
                    fr.recognized_at DESC
                LIMIT 1
            """, (face_id,))
            
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None

    def get_face_detail(self, face_id: int) -> Optional[Dict[str, Any]]:
        """Retorna detalhes completos de uma face com seu reconhecimento autoritativo."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT f.*, v.filename as video_filename, p.filename as photo_filename
                FROM face f
                LEFT JOIN video v ON f.video_id = v.id
                LEFT JOIN photo p ON f.photo_id = p.id
                WHERE f.id = ?
            """, (face_id,))
            
            face_row = cursor.fetchone()
            if not face_row:
                return None
            
            face = dict(face_row)
            face["authoritative_recognition"] = self.get_authoritative_recognition(face_id)
            
            # Todos os reconhecimentos
            cursor.execute("""
                SELECT fr.*, p.name as person_name
                FROM face_recognition fr
                LEFT JOIN person p ON fr.person_id = p.id
                WHERE fr.face_id = ?
                ORDER BY fr.tier DESC, fr.recognized_at DESC
            """, (face_id,))
            face["all_recognitions"] = [dict(r) for r in cursor.fetchall()]
            
            return face

    def get_project_faces(self, project_id: int, media_type: str = None, media_id: int = None) -> List[Dict[str, Any]]:
        """Retorna todas as faces de um projeto com reconhecimento autoritativo."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            query = """
                SELECT f.*, v.filename as video_filename, ph.filename as photo_filename
                FROM face f
                LEFT JOIN video v ON f.video_id = v.id
                LEFT JOIN photo ph ON f.photo_id = ph.id
                WHERE f.project_id = ?
            """
            params = [project_id]
            
            if media_type == "video" and media_id:
                query += " AND f.video_id = ?"
                params.append(media_id)
            elif media_type == "photo" and media_id:
                query += " AND f.photo_id = ?"
                params.append(media_id)
            
            cursor.execute(query, params)
            faces = [dict(r) for r in cursor.fetchall()]
            
            # Adicionar reconhecimento autoritativo
            for face in faces:
                face["recognition"] = self.get_authoritative_recognition(face["id"])
            
            return faces

    def get_project_people(self, project_id: int) -> List[Dict[str, Any]]:
        """Retorna todas as pessoas identificadas no projeto."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM person WHERE project_id = ?", (project_id,))
            return [dict(r) for r in cursor.fetchall()]

    # ── Helpers Privados ──

    def _insert_face(
        self, project_id: int, photo_id: Optional[int], video_id: Optional[int],
        timestamp: Optional[float], bounding_box: List[float], quality_score: Optional[float],
        blur_score: Optional[float], face_size_px: Optional[int], crop_path: Optional[str]
    ) -> int:
        """Insere uma face no banco e retorna o ID."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO face (project_id, cluster_id, bounding_box, photo_id, video_id, 
                                timestamp, quality_score, blur_score, face_size_px, crop_path)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (project_id, json.dumps(bounding_box), photo_id, video_id,
                  timestamp, quality_score, blur_score, face_size_px, crop_path))
            conn.commit()
            return cursor.lastrowid

    def _insert_recognition(
        self, face_id: int, tier: int, model: str, model_version: str,
        embedding: Optional[List[float]], confidence: float, status: str,
        recognized_by: str = None, raw_response: str = None,
        processing_time_ms: int = 0, cost_usd: float = 0.0
    ) -> None:
        """Insere um reconhecimento versionado no banco."""
        embedding_json = json.dumps(embedding) if embedding else None
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO face_recognition 
                (face_id, tier, model, model_version, embedding, similarity, confidence,
                 status, recognized_by, raw_response, cost_usd, processing_time_ms)
                VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
            """, (face_id, tier, model, model_version, embedding_json, confidence,
                  status, recognized_by, raw_response, cost_usd, processing_time_ms))
            conn.commit()

    def _get_face(self, face_id: int) -> Optional[Dict[str, Any]]:
        """Retorna uma face pelo ID."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM face WHERE id = ?", (face_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def _get_faces_with_embeddings(self, project_id: int) -> List[Dict[str, Any]]:
        """Retorna faces com seus embeddings autoritativos para clustering.

        Prioriza embeddings versionados (face_recognition); faz FALLBACK para a
        coluna legada face.embedding — onde o pipeline local (YuNet/SFace) grava.
        Sem o fallback, projetos com dados legados clusterizavam 0 faces.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT f.id as face_id, fr.embedding
                FROM face f
                JOIN face_recognition fr ON f.id = fr.face_id
                WHERE f.project_id = ? AND fr.embedding IS NOT NULL
                AND fr.status NOT IN ('rejected', 'superseded')
                AND NOT EXISTS (
                    SELECT 1 FROM face_recognition fr2 
                    WHERE fr2.face_id = f.id AND fr2.status IN ('confirmed', 'rejected')
                )
                ORDER BY fr.tier DESC, fr.recognized_at DESC
            """, (project_id,))

            # Pegar o embedding mais recente de cada face
            seen = set()
            results = []
            for row in cursor.fetchall():
                if row["face_id"] not in seen:
                    seen.add(row["face_id"])
                    results.append(dict(row))

            # Fallback legado: faces com embedding direto na tabela face
            try:
                cursor.execute("""
                    SELECT id as face_id, embedding
                    FROM face
                    WHERE project_id = ? AND embedding IS NOT NULL
                    AND NOT EXISTS (
                        SELECT 1 FROM face_recognition fr2 
                        WHERE fr2.face_id = face.id AND fr2.status IN ('confirmed', 'rejected')
                    )
                """, (project_id,))
                for row in cursor.fetchall():
                    if row["face_id"] not in seen:
                        seen.add(row["face_id"])
                        results.append(dict(row))
            except Exception:
                pass  # coluna legada pode não existir em bancos novos

            return results

    def _get_cluster_suggested_name(self, conn, cluster_id: int, face_ids: List[int]) -> str:
        """Sugere nome para cluster baseado em nomes existentes.

        Prefere nomes REAIS dados pelo usuário; placeholders ('Pessoa Desconhecida...')
        e descartes só são usados se não houver alternativa.
        """
        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in face_ids)
        cursor.execute(f"""
            SELECT name, COUNT(*) as cnt FROM face
            WHERE id IN ({placeholders}) AND name IS NOT NULL AND name != ''
            GROUP BY name ORDER BY cnt DESC
        """, face_ids)

        real_names = []
        for r in cursor.fetchall():
            n = r["name"]
            if n.startswith("Pessoa Desconhecida") or n in ("Não Relevante", "Não é Rosto"):
                continue
            real_names.append(n)

        if real_names:
            return real_names[0]  # nome real mais frequente no cluster
        return f"Pessoa Desconhecida (Grupo {cluster_id + 1})"

    def _clear_auto_detections(self, photo_id: Optional[int] = None, video_id: Optional[int] = None, timestamp: Optional[float] = None) -> None:
        """Limpa deteccoes automaticas anteriores (Tier 0 'auto') para evitar duplicatas."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            if photo_id:
                # Deletar faces da foto que tem apenas reconhecimentos 'auto' do Tier 0
                cursor.execute("""
                    DELETE FROM face 
                    WHERE photo_id = ? AND id IN (
                        SELECT f.id FROM face f
                        JOIN face_recognition fr ON f.id = fr.face_id
                        WHERE f.photo_id = ? AND fr.tier = 0 AND fr.status = 'auto'
                    )
                """, (photo_id, photo_id))
            elif video_id and timestamp is not None:
                cursor.execute("""
                    DELETE FROM face 
                    WHERE video_id = ? AND timestamp = ? AND id IN (
                        SELECT f.id FROM face f
                        JOIN face_recognition fr ON f.id = fr.face_id
                        WHERE f.video_id = ? AND f.timestamp = ? AND fr.tier = 0 AND fr.status = 'auto'
                    )
                """, (video_id, timestamp, video_id, timestamp))
            
            conn.commit()

    def _save_face_crop(
        self, image_path: Path, box: List[float],
        photo_id: Optional[int] = None, video_id: Optional[int] = None,
        timestamp: Optional[float] = None, face_idx: int = 0
    ) -> Optional[Path]:
        """Salva o crop do rosto para referencia visual."""
        try:
            img = imread_unicode(image_path)
            if img is None:
                return None
            
            h, w = img.shape[:2]
            x, y, bw, bh = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
            
            # Adicionar padding de 20%
            pad_x, pad_y = int(bw * 0.2), int(bh * 0.2)
            x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
            x2, y2 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
            
            crop = img[y1:y2, x1:x2]
            if crop.size == 0:
                return None
            
            # Nome do arquivo
            if photo_id:
                filename = f"face_photo_{photo_id}_{face_idx}.jpg"
            else:
                filename = f"face_vid_{video_id}_{int(timestamp)}_{face_idx}.jpg"
            
            crop_path = self.crops_dir / filename
            cv2.imwrite(str(crop_path), crop)
            
            # S3 Upload in background
            try:
                from src.services.s3_service import S3Service
                s3_service = S3Service.get_instance()
                if s3_service.enabled:
                    from src.core.tasks import TASK_MANAGER
                    TASK_MANAGER.executor.submit(s3_service.upload_file, crop_path, f"crops/{filename}")
            except Exception as s3_err:
                print(f"[FACE_SERVICE] Erro ao disparar upload do crop para S3: {s3_err}")
                
            return crop_path
            
        except Exception as e:
            print(f"[FACE_SERVICE] Erro ao salvar crop: {e}")
            return None


# Singleton
_FACE_SERVICE = None

def get_face_service() -> FaceService:
    """Retorna instancia singleton do FaceService."""
    global _FACE_SERVICE
    if _FACE_SERVICE is None:
        _FACE_SERVICE = FaceService()
    return _FACE_SERVICE
