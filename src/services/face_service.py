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
from src.vision.cv_utils import imread_unicode, imwrite_unicode
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

    def cluster_project_faces(self, project_id: int, eps: Optional[float] = None, min_samples: Optional[int] = None, lock_labeled: bool = True) -> Dict[str, Any]:
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
        
        if lock_labeled:
            with get_db() as conn:
                cursor = conn.cursor()
                # Obter IDs de faces que estão verdadeiramente travadas (possuem confirmação manual explícita pelo usuário)
                cursor.execute("""
                    SELECT f.id FROM face f
                    JOIN face_recognition fr ON f.id = fr.face_id
                    WHERE f.project_id = ? AND fr.status = 'confirmed'
                """, (project_id,))
                locked_ids = {r["id"] for r in cursor.fetchall()}

            faces_data = [f for f in faces_data if f["face_id"] not in locked_ids]
        
        if not faces_data:
            return {"total": 0, "clustered": 0, "clusters": 0, "noise": 0}
        
        face_ids = [f["face_id"] for f in faces_data]
        embeddings = [json.loads(f["embedding"]) for f in faces_data]
        
        # Clusterizar
        labels = self.pipeline.cluster_embeddings(embeddings, eps=eps, min_samples=min_samples)
        
        # Atualizar cluster_id no banco
        with get_db() as conn:
            cursor = conn.cursor()

            cid_offset = 0
            if lock_labeled:
                cursor.execute("SELECT MAX(cluster_id) as max_cid FROM face WHERE project_id = ? AND cluster_id IS NOT NULL AND cluster_id >= 0", (project_id,))
                max_row = cursor.fetchone()
                if max_row and max_row["max_cid"] is not None:
                    cid_offset = max_row["max_cid"] + 1
            
            clusters_map = {}
            for i, label in enumerate(labels):
                if label >= 0:
                    if label not in clusters_map:
                        clusters_map[label] = []
                    clusters_map[label].append(face_ids[i])
            
            # Atualizar faces com cluster_id
            for cluster_id, f_ids in clusters_map.items():
                target_cluster_id = cluster_id + cid_offset if lock_labeled else cluster_id

                # Verificar se ja existe nome no cluster
                cluster_name = self._get_cluster_suggested_name(conn, target_cluster_id, f_ids)

                # Se o cluster tem um nome real, tenta achar o cluster_id existente para esse nome no projeto
                actual_cluster_id = target_cluster_id
                if not cluster_name.startswith("Pessoa Desconhecida") and cluster_name not in ("Não Relevante", "Não é Rosto"):
                    cursor.execute("""
                        SELECT DISTINCT cluster_id FROM face
                        WHERE project_id = ? AND name = ? AND cluster_id IS NOT NULL AND cluster_id >= 0
                        LIMIT 1
                    """, (project_id, cluster_name))
                    row = cursor.fetchone()
                    if row:
                        actual_cluster_id = row["cluster_id"]

                # Se o cluster_name sugerido for um placeholder, verificar se já existe um nome real
                # associado a esse actual_cluster_id no banco de dados (ex: por confirmações manuais)
                if cluster_name.startswith("Pessoa Desconhecida") or cluster_name in ("Não Relevante", "Não é Rosto"):
                    cursor.execute("""
                        SELECT name FROM face
                        WHERE project_id = ? AND cluster_id = ? AND name IS NOT NULL AND name != ''
                          AND name NOT LIKE 'Pessoa Desconhecida%' AND name NOT IN ('Não Relevante', 'Não é Rosto')
                        LIMIT 1
                    """, (project_id, actual_cluster_id))
                    row_real = cursor.fetchone()
                    if row_real:
                        cluster_name = row_real["name"]

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
                            SET cluster_id = ?,
                                name = CASE 
                                    WHEN name IS NULL OR TRIM(name) = '' OR name LIKE 'Pessoa Desconhecida%' THEN ?
                                    ELSE name 
                                END
                            WHERE id = ?
                        """, (actual_cluster_id, cluster_name, f_id))

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

    def confirm_cluster_faces(self, project_id: int, cluster_id: int, target_name: Optional[str] = None) -> Dict[str, Any]:
        """Confirma manualmente TODOS os rostos pertencentes a um determinado cluster (Tier 4 / status='confirmed').

        Usado pelo operador ao validar que o grupo inteiro de uma pessoa está correto.
        """
        with get_db() as conn:
            cursor = conn.cursor()

            # Buscar todas as faces do cluster
            cursor.execute("""
                SELECT id, name FROM face
                WHERE project_id = ? AND cluster_id = ?
            """, (project_id, cluster_id))
            faces = cursor.fetchall()

            if not faces:
                return {"status": "error", "message": "Nenhum rosto encontrado no cluster", "confirmed_count": 0}

            # Definir o nome canônico do grupo
            name_to_use = target_name
            if not name_to_use:
                # Tenta pegar o primeiro nome válido que não seja placeholder
                for f in faces:
                    n = f["name"]
                    if n and not n.startswith("Pessoa Desconhecida") and n not in ("Não Relevante", "Não é Rosto"):
                        name_to_use = n
                        break

            if not name_to_use or name_to_use.startswith("Pessoa Desconhecida"):
                return {"status": "error", "message": "Defina um nome válido para o grupo antes de confirmá-lo", "confirmed_count": 0}

            # Encontrar ou criar o person_id correspondente
            cursor.execute("SELECT id FROM person WHERE project_id = ? AND name = ?", (project_id, name_to_use))
            p_row = cursor.fetchone()
            if p_row:
                person_id = p_row["id"]
            else:
                cursor.execute("""
                    INSERT INTO person (project_id, name, aliases, bio)
                    VALUES (?, ?, '[]', '')
                """, (project_id, name_to_use))
                person_id = cursor.lastrowid

            confirmed_count = 0
            for f in faces:
                f_id = f["id"]
                cursor.execute("UPDATE face_recognition SET status = 'superseded' WHERE face_id = ? AND status != 'superseded'", (f_id,))
                cursor.execute("""
                    INSERT INTO face_recognition 
                    (face_id, tier, model, model_version, person_id, confidence, status, recognized_by, recognized_at)
                    VALUES (?, 4, 'manual', 'v1.0', ?, 1.0, 'confirmed', 'user_cluster_confirm', datetime('now'))
                """, (f_id, person_id))
                cursor.execute("UPDATE face SET name = ? WHERE id = ?", (name_to_use, f_id))
                confirmed_count += 1

            conn.commit()
            return {
                "status": "success",
                "confirmed_count": confirmed_count,
                "cluster_id": cluster_id,
                "name": name_to_use
            }

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
                SELECT f.*, 
                       v.filename as video_filename, v.filepath as video_filepath,
                       p.filename as photo_filename, p.filepath as photo_filepath
                FROM face f
                LEFT JOIN video v ON f.video_id = v.id
                LEFT JOIN photo p ON f.photo_id = p.id
                WHERE f.id = ?
            """, (face_id,))
            
            face_row = cursor.fetchone()
            if not face_row:
                return None
            
            face = dict(face_row)
            if face.get("bounding_box") and isinstance(face["bounding_box"], str):
                try:
                    face["bounding_box"] = json.loads(face["bounding_box"])
                except Exception:
                    pass
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


    # Formatos RAW que o cv2 não lê e que exigem decodificação dedicada (rawpy)
    RAW_EXT = {".arw", ".cr2", ".cr3", ".nef", ".dng", ".pef", ".raf", ".orf", ".rw2", ".raw"}
    CV2_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

    def enhance_face(self, face_id: int, use_raw: bool = False) -> Dict[str, Any]:
        """Extrai a mídia de origem do rosto e devolve um crop restaurado/realçado.

        Foto → usa o original (formatos web) ou o proxy webp. Se ``use_raw`` e a foto
        for RAW (CR2/NEF/…), decodifica o RAW em resolução total (mais lento, mais
        nítido). Vídeo → extrai o frame no timestamp (com cache).
        """
        face = self.get_face_detail(face_id)
        if not face:
            return {"status": "error", "message": "Face não encontrada."}

        image_path = None
        with get_db() as conn:
            cursor = conn.cursor()
            if face.get("photo_id"):
                cursor.execute("SELECT filepath FROM photo WHERE id = ?", (face["photo_id"],))
                p = cursor.fetchone()
                orig = p["filepath"] if p else None
                proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{face['photo_id']}.webp"
                ext = Path(orig).suffix.lower() if orig else ""
                if orig and Path(orig).exists() and ext in self.CV2_EXT:
                    image_path = orig
                elif use_raw and orig and Path(orig).exists() and ext in self.RAW_EXT:
                    # Opt-in: decodifica o RAW em resolução total (melhor crop possível)
                    image_path = self._decode_raw_photo(face["photo_id"], orig)
                    if not image_path and proxy.exists():
                        image_path = str(proxy)  # RAW falhou → cai no proxy
                elif proxy.exists():
                    image_path = str(proxy)
                elif orig and Path(orig).exists():
                    image_path = orig  # último recurso (pode falhar na leitura)
            elif face.get("video_id"):
                cursor.execute("SELECT filepath FROM video WHERE id = ?", (face["video_id"],))
                v = cursor.fetchone()
                image_path = self._extract_video_frame(
                    face["video_id"], v["filepath"] if v else None, face.get("timestamp"))

        if not image_path:
            image_path = face.get("crop_path")

        if not image_path or not Path(image_path).exists():
            return {"status": "error", "message": "Mídia de origem do rosto não encontrada no disco."}

        box = face.get("bounding_box")
        if isinstance(box, str):
            try:
                box = json.loads(box)
            except Exception:
                box = None
        if not isinstance(box, list):
            box = None

        from src.vision.face_enhancer import enhance_face_crop
        return enhance_face_crop(image_path, box=box)

    def get_context_media(self, face_id: int, window_seconds: float = 2.5) -> Dict[str, Any]:
        """Retorna mídias de contexto temporal para a fase 3 da desambiguação rápida.
        
        Foto: Retorna fotos vizinhas da mesma rajada (burst_group_id) ou da vizinhança temporal/ID,
              com as bounding_boxes de rostos já detectados nessas fotos.
        Vídeo: Retorna a janela de tempo (window_seconds ao redor do timestamp), stream_url, duração
               e rostos no trecho.
        """
        face = self.get_face_detail(face_id)
        if not face:
            return {"status": "error", "message": f"Face {face_id} não encontrada."}

        project_id = face["project_id"]

        with get_db() as conn:
            cursor = conn.cursor()

            if face.get("photo_id"):
                photo_id = face["photo_id"]
                cursor.execute("SELECT * FROM photo WHERE id = ?", (photo_id,))
                cur_photo = cursor.fetchone()
                if not cur_photo:
                    return {"status": "error", "message": f"Foto {photo_id} não encontrada."}

                burst_id = cur_photo["burst_group_id"]
                related_photos_rows = []

                if burst_id is not None:
                    # Todas as fotos da mesma rajada
                    cursor.execute("""
                        SELECT id, filename, filepath, burst_group_id, created_at
                        FROM photo
                        WHERE project_id = ? AND (burst_group_id = ? OR id = ?)
                        ORDER BY id ASC
                    """, (project_id, burst_id, burst_id))
                    related_photos_rows = cursor.fetchall()

                # Se não tem rajada ou tem apenas 1 foto na rajada, busca fotos vizinhas por ID / pasta
                if len(related_photos_rows) <= 1:
                    cursor.execute("""
                        SELECT id, filename, filepath, burst_group_id, created_at
                        FROM photo
                        WHERE project_id = ? AND id BETWEEN ? AND ?
                        ORDER BY id ASC
                    """, (project_id, max(1, photo_id - 6), photo_id + 6))
                    related_photos_rows = cursor.fetchall()

                # Se ainda tiver poucas, pega as mais próximas em ordem
                if len(related_photos_rows) <= 1:
                    cursor.execute("""
                        SELECT id, filename, filepath, burst_group_id, created_at
                        FROM photo
                        WHERE project_id = ?
                        ORDER BY id ASC
                        LIMIT 12
                    """, (project_id,))
                    related_photos_rows = cursor.fetchall()

                # Para cada foto, busca os rostos detectados
                photos_data = []
                cur_mtime = None
                cur_path = Path(cur_photo["filepath"]) if cur_photo["filepath"] else None
                if cur_path and cur_path.exists():
                    try:
                        cur_mtime = cur_path.stat().st_mtime
                    except Exception:
                        pass

                for pr in related_photos_rows:
                    pid = pr["id"]
                    cursor.execute("""
                        SELECT id, bounding_box, cluster_id, name, quality_score
                        FROM face
                        WHERE photo_id = ?
                    """, (pid,))
                    face_rows = cursor.fetchall()
                    faces_in_photo = []
                    for fr in face_rows:
                        f_box = fr["bounding_box"]
                        if isinstance(f_box, str):
                            try:
                                f_box = json.loads(f_box)
                            except Exception:
                                f_box = None
                        faces_in_photo.append({
                            "id": fr["id"],
                            "bounding_box": f_box,
                            "cluster_id": fr["cluster_id"],
                            "name": fr["name"],
                            "quality_score": fr["quality_score"],
                            "is_matching_cluster": (fr["cluster_id"] == face.get("cluster_id") if face.get("cluster_id") is not None else False)
                        })

                    # Delta de tempo relativo em segundos
                    delta_sec = 0.0
                    p_path = Path(pr["filepath"]) if pr["filepath"] else None
                    if p_path and p_path.exists() and cur_mtime is not None:
                        try:
                            delta_sec = p_path.stat().st_mtime - cur_mtime
                        except Exception:
                            pass

                    # Proxy URL
                    proxy_file = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{pid}.webp"
                    proxy_url = f"/proxies/photos/proxy_photo_{pid}.webp" if proxy_file.exists() else f"/api/photo/{pid}/file"

                    photos_data.append({
                        "id": pid,
                        "filename": pr["filename"],
                        "is_current": (pid == photo_id),
                        "file_url": f"/api/photo/{pid}/file",
                        "proxy_url": proxy_url,
                        "delta_seconds": round(delta_sec, 1),
                        "faces": faces_in_photo
                    })

                return {
                    "status": "ok",
                    "type": "photo",
                    "face_id": face_id,
                    "current_photo_id": photo_id,
                    "current_box": face.get("bounding_box"),
                    "photos": photos_data
                }

            elif face.get("video_id"):
                video_id = face["video_id"]
                cursor.execute("SELECT * FROM video WHERE id = ?", (video_id,))
                video = cursor.fetchone()
                if not video:
                    return {"status": "error", "message": f"Vídeo {video_id} não encontrado."}

                ts = float(face.get("timestamp") or 0.0)
                dur = float(video["duration"] or 100.0)
                w_sec = float(window_seconds)

                win_start = max(0.0, ts - w_sec)
                win_end = min(dur, ts + w_sec)

                # Busca outros rostos detectados nesse vídeo dentro da janela
                cursor.execute("""
                    SELECT id, bounding_box, timestamp, cluster_id, name, quality_score
                    FROM face
                    WHERE video_id = ? AND timestamp BETWEEN ? AND ?
                    ORDER BY timestamp ASC
                """, (video_id, win_start, win_end))
                nearby_faces = []
                for fr in cursor.fetchall():
                    f_box = fr["bounding_box"]
                    if isinstance(f_box, str):
                        try:
                            f_box = json.loads(f_box)
                        except Exception:
                            f_box = None
                    nearby_faces.append({
                        "id": fr["id"],
                        "bounding_box": f_box,
                        "timestamp": float(fr["timestamp"] or 0.0),
                        "cluster_id": fr["cluster_id"],
                        "name": fr["name"],
                        "is_current": (fr["id"] == face_id)
                    })

                proxy_rel = f"proxy_vid_{video_id}.mp4"
                stream_url = f"/proxies/{proxy_rel}" if (CONFIG.PROXIES_DIR / proxy_rel).exists() else f"/api/video/{video_id}/stream"

                return {
                    "status": "ok",
                    "type": "video",
                    "face_id": face_id,
                    "video_id": video_id,
                    "filename": video["filename"],
                    "stream_url": stream_url,
                    "current_timestamp": ts,
                    "window_seconds": w_sec,
                    "window_start": round(win_start, 2),
                    "window_end": round(win_end, 2),
                    "duration": dur,
                    "fps": float(video["fps"] or 30.0),
                    "current_box": face.get("bounding_box"),
                    "faces": nearby_faces
                }

        return {"status": "error", "message": "Face não associada a foto ou vídeo."}

    def _extract_video_frame(self, video_id: int, original_path: Optional[str],
                             timestamp: Optional[float]) -> Optional[str]:
        """Extrai (com cache) o frame do vídeo no timestamp; devolve o caminho do JPG ou None.

        Prioriza o proxy mp4 (busca rápida/confiável via cv2 — evita o seek lento e
        falho em .MTS/AVCHD). Para o original usa cv2 em formatos amigáveis e ffmpeg
        para MTS. Assim o aprimoramento de rostos de vídeo fica rápido e robusto.
        """
        if timestamp is None:
            return None
        frame_dir = Path("data/cache/frames")
        frame_dir.mkdir(parents=True, exist_ok=True)
        frame_path = frame_dir / f"frame_vid_{video_id}_{int(timestamp)}.jpg"
        if frame_path.exists():
            return str(frame_path)

        # 1) Proxy mp4 — melhor opção quando existe (rápido e seekável)
        proxy = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        if proxy.exists() and self._cv2_grab_frame(str(proxy), timestamp, frame_path):
            return str(frame_path)

        # 2) Original — cv2 p/ formatos amigáveis, ffmpeg p/ MTS/AVCHD (seek confiável)
        if original_path and Path(original_path).exists():
            ext = Path(original_path).suffix.lower()
            if ext not in (".mts", ".m2ts", ".ts") and self._cv2_grab_frame(original_path, timestamp, frame_path):
                return str(frame_path)
            try:
                from src.media.ffmpeg import extract_thumbnail_frame
                if extract_thumbnail_frame(Path(original_path), float(timestamp), frame_path, width=1600) and frame_path.exists():
                    return str(frame_path)
            except Exception as ex:
                print(f"[FACE_SERVICE] ffmpeg frame falhou (vid {video_id} @ {timestamp}s): {ex}")
        return None

    def _decode_raw_photo(self, photo_id: int, raw_path: str) -> Optional[str]:
        """Decodifica um RAW (CR2/NEF/…) em resolução total; devolve um JPEG (com cache)."""
        from src.media.image_processing import decode_raw_to_jpeg
        out = Path("data/cache/raw") / f"full_photo_{photo_id}.jpg"
        if out.exists():
            return str(out)
        if decode_raw_to_jpeg(Path(raw_path), out):
            return str(out)
        return None

    def _cv2_grab_frame(self, src: str, timestamp: float, out_path: Path) -> bool:
        """Lê um frame no timestamp via cv2 e salva em out_path. True se ok."""
        try:
            cap = cv2.VideoCapture(src)
            cap.set(cv2.CAP_PROP_POS_MSEC, float(timestamp) * 1000)
            ret, frame = cap.read()
            cap.release()
            if ret and frame is not None:
                imwrite_unicode(out_path, frame)
                return True
        except Exception as ex:
            print(f"[FACE_SERVICE] cv2 frame falhou ({src}): {ex}")
        return False


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
            SELECT f.name, COUNT(*) as cnt 
            FROM face f
            JOIN face_recognition fr ON f.id = fr.face_id
            WHERE f.id IN ({placeholders}) AND fr.status = 'confirmed' AND f.name IS NOT NULL AND f.name != ''
            GROUP BY f.name ORDER BY cnt DESC
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

    def reset_unconfirmed_face_clusters(self, project_id: int) -> int:
        """Limpa o nome e cluster_id de todas as faces do projeto que NÃO possuem confirmação manual explícita.
        
        Isso desata agrupamentos automáticos poluídos, liberando as faces para uma nova re-clusterização limpa.
        """
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE face
                SET name = NULL, cluster_id = NULL
                WHERE project_id = ?
                  AND id NOT IN (
                      SELECT face_id FROM face_recognition WHERE status = 'confirmed'
                  )
            """, (project_id,))
            affected = cursor.rowcount
            conn.commit()
            return affected

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
            imwrite_unicode(crop_path, crop)
            
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
