"""Repositório de acesso a dados para Mídias (Vídeos, Fotos e Reconhecimento Facial)."""
import sqlite3
import json
from typing import List, Dict, Any, Optional

class MediaRepository:
    @staticmethod
    def add_video(
        conn: sqlite3.Connection,
        project_id: int,
        filename: str,
        filepath: str,
        file_hash: str,
        video_type: str = "unknown",
        duration: float = 0.0,
        fps: float = 0.0,
        resolution: str = "",
        codec: str = "",
        bitrate: int = 0
    ) -> int:
        """Adiciona um vídeo ou retorna o ID se já existir com o mesmo hash."""
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM video WHERE hash = ?", (file_hash,))
        row = cursor.fetchone()
        if row:
            return row['id']
            
        cursor.execute("""
            INSERT INTO video (project_id, filename, filepath, hash, video_type, duration, fps, resolution, codec, bitrate, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested')
        """, (project_id, filename, filepath, file_hash, video_type, duration, fps, resolution, codec, bitrate))
        return cursor.lastrowid

    @staticmethod
    def list_videos(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Retorna todos os vídeos cadastrados do projeto."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM video WHERE project_id = ? ORDER BY id DESC", (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_video(conn: sqlite3.Connection, video_id: int) -> Optional[Dict[str, Any]]:
        """Retorna os metadados de um vídeo específico pelo ID."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def update_video_status(conn: sqlite3.Connection, video_id: int, status: str, error_message: Optional[str] = None) -> None:
        """Atualiza o status de processamento e possíveis erros de conversão do vídeo."""
        conn.execute("UPDATE video SET status = ?, error_message = ? WHERE id = ?", (status, error_message, video_id))

    # Quantas versões anteriores de decupagem manter por vídeo. Sem poda, um acervo
    # reprocessado várias vezes cresce sem limite.
    METADATA_HISTORY_KEEP = 20

    @staticmethod
    def _parse_tags(raw: Any) -> List[str]:
        """Converte a coluna `tags` (JSON em texto) para lista, tolerando lixo."""
        if isinstance(raw, list):
            return raw
        if not raw:
            return []
        try:
            valor = json.loads(raw)
            return valor if isinstance(valor, list) else []
        except (ValueError, TypeError):
            return []

    @staticmethod
    def _archive_metadata_version(
        conn: sqlite3.Connection,
        video_id: int,
        title: Optional[str],
        description: Optional[str],
        summary: Optional[str],
        tags_json: Optional[str],
        title_vazio_mantem: bool = True
    ) -> None:
        """Arquiva a decupagem CORRENTE do vídeo antes de ela ser sobrescrita.

        Os parâmetros são os valores que vão ENTRAR — servem só para decidir se
        houve mudança.

        `title_vazio_mantem` distingue os dois caminhos de escrita: em
        update_video_metadata um título vazio preserva o atual (COALESCE/NULLIF),
        enquanto update_video_title grava literalmente o que recebe — inclusive
        vazio, e nesse caso a versão anterior precisa ser arquivada.

        Duas regras de higiene: não arquiva versão totalmente vazia (evita lixo na
        primeira gravação de cada mídia) e não arquiva quando nada mudou."""
        cursor = conn.cursor()
        cursor.execute(
            "SELECT title, description, summary, tags, metadata_origem FROM video WHERE id = ?",
            (video_id,)
        )
        row = cursor.fetchone()
        if row is None:
            return

        atual_title, atual_desc, atual_summary, atual_tags, atual_origem = (
            row[0], row[1], row[2], row[3], row[4]
        )

        if not any([atual_title, atual_desc, atual_summary, atual_tags]):
            return  # nada de valor a preservar

        efetivo_title = atual_title if (title_vazio_mantem and not title) else title
        if (atual_title, atual_desc, atual_summary, atual_tags) == (
            efetivo_title, description, summary, tags_json
        ):
            return  # nada mudou

        cursor.execute("""
            INSERT INTO video_metadata_history (video_id, title, description, summary, tags, origem)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (video_id, atual_title, atual_desc, atual_summary, atual_tags, atual_origem or "ia"))

        cursor.execute("""
            DELETE FROM video_metadata_history
            WHERE video_id = ? AND id NOT IN (
                SELECT id FROM video_metadata_history
                WHERE video_id = ? ORDER BY id DESC LIMIT ?
            )
        """, (video_id, video_id, MediaRepository.METADATA_HISTORY_KEEP))

    @staticmethod
    def _try_archive(
        conn: sqlite3.Connection,
        video_id: int,
        title: Optional[str],
        description: Optional[str],
        summary: Optional[str],
        tags_json: Optional[str],
        title_vazio_mantem: bool = True
    ) -> None:
        """Chama o arquivamento sem deixar que ele derrube a gravação.

        Se o banco for antigo (sem a tabela/coluna de histórico), avisa alto no
        console e segue — uma rodada de ASR paga não pode morrer por causa disso."""
        try:
            MediaRepository._archive_metadata_version(
                conn, video_id, title, description, summary, tags_json, title_vazio_mantem
            )
        except sqlite3.OperationalError as err:
            print(f"[HISTORICO] Nao foi possivel arquivar a decupagem do video {video_id}: {err}. "
                  f"Rode init_db() para criar video_metadata_history.")

    @staticmethod
    def update_video_metadata(
        conn: sqlite3.Connection,
        video_id: int,
        description: str,
        summary: str,
        tags: List[str],
        title: Optional[str] = None,
        origem: str = "ia"
    ) -> None:
        """Atualiza a decupagem editorial, tags e título curto do vídeo.

        Toda gravação de decupagem passa por aqui — pipeline de ASR, análise de
        visão ou edição manual —, então é aqui que a versão anterior é arquivada.
        Nenhum chamador precisa saber que o histórico existe."""
        tags_json = json.dumps(tags)
        novo_title = (title or "").strip() or None
        MediaRepository._try_archive(conn, video_id, novo_title, description, summary, tags_json)
        conn.execute("""
            UPDATE video
            SET description = ?, summary = ?, tags = ?,
                title = COALESCE(NULLIF(?, ''), title),
                metadata_origem = ?
            WHERE id = ?
        """, (description, summary, tags_json, title or "", origem, video_id))

    @staticmethod
    def update_video_title(conn: sqlite3.Connection, video_id: int, title: str, origem: str = "humano") -> None:
        """Atualiza diretamente o título executivo do vídeo.

        Caminho de escrita separado de update_video_metadata (a edição inline do
        inspetor cai aqui), por isso arquiva também."""
        cursor = conn.cursor()
        cursor.execute("SELECT description, summary, tags FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if row is not None:
            MediaRepository._try_archive(
                conn, video_id, title, row[0], row[1], row[2], title_vazio_mantem=False
            )
        conn.execute(
            "UPDATE video SET title = ?, metadata_origem = ? WHERE id = ?",
            (title, origem, video_id)
        )

    @staticmethod
    def list_metadata_history(conn: sqlite3.Connection, video_id: int, limit: int = 50) -> List[Dict[str, Any]]:
        """Lista as versões anteriores da decupagem, mais recente primeiro."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, video_id, title, description, summary, tags, origem, created_at
            FROM video_metadata_history
            WHERE video_id = ?
            ORDER BY id DESC
            LIMIT ?
        """, (video_id, limit))
        versoes = []
        for r in cursor.fetchall():
            item = dict(r)
            item["tags"] = MediaRepository._parse_tags(item.get("tags"))
            versoes.append(item)
        return versoes

    @staticmethod
    def get_metadata_history_entry(conn: sqlite3.Connection, history_id: int) -> Optional[Dict[str, Any]]:
        """Retorna uma versão arquivada específica (tags ainda em JSON cru)."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM video_metadata_history WHERE id = ?", (history_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def restore_metadata_version(conn: sqlite3.Connection, video_id: int, history_id: int) -> Dict[str, Any]:
        """Restaura uma versão arquivada como decupagem corrente do vídeo.

        A restauração é ela mesma uma gravação: passa por update_video_metadata,
        que arquiva a versão atual antes — ou seja, restaurar é reversível."""
        versao = MediaRepository.get_metadata_history_entry(conn, history_id)
        if versao is None or versao["video_id"] != video_id:
            raise ValueError("Versão de histórico não pertence a este vídeo")

        MediaRepository.update_video_metadata(
            conn,
            video_id,
            description=versao.get("description") or "",
            summary=versao.get("summary") or "",
            tags=MediaRepository._parse_tags(versao.get("tags")),
            title=versao.get("title"),
            origem="humano"
        )
        return versao

    @staticmethod
    def update_photo_title(conn: sqlite3.Connection, photo_id: int, title: str) -> None:
        """Atualiza diretamente o título da foto."""
        conn.execute("UPDATE photo SET title = ? WHERE id = ?", (title, photo_id))

    @staticmethod
    def delete_video(conn: sqlite3.Connection, video_id: int) -> None:
        """Deleta o vídeo e suas dependências."""
        conn.execute("DELETE FROM video WHERE id = ?", (video_id,))

    @staticmethod
    def replace_video_segments(
        conn: sqlite3.Connection,
        project_id: int,
        video_id: int,
        segments: List[Dict[str, Any]]
    ) -> None:
        """Substitui os segmentos (shots/beats) do vídeo pela nova segmentação.

        Grava o id inserido em cada dict de `segments` (chave 'id') para que o
        chamador possa vincular keyframes/vetores ao segmento de origem."""
        conn.execute("DELETE FROM media_segment WHERE video_id = ?", (video_id,))
        for s in segments:
            cursor = conn.execute("""
                INSERT INTO media_segment (project_id, video_id, kind, start_time, end_time, reason, motion_label)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (project_id, video_id, s["kind"], s["start"], s["end"],
                  s.get("reason", ""), s.get("motion_label", "")))
            s["id"] = cursor.lastrowid

    @staticmethod
    def get_video_segments(conn: sqlite3.Connection, video_id: int) -> List[Dict[str, Any]]:
        """Retorna os segmentos do vídeo ordenados no tempo."""
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM media_segment WHERE video_id = ? ORDER BY start_time", (video_id,)
        )
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def add_photo(
        conn: sqlite3.Connection,
        project_id: int,
        filename: str,
        filepath: str,
        file_hash: str,
        description: str = "",
        tags: Optional[List[str]] = None
    ) -> int:
        """Adiciona uma foto ou retorna o ID se já existir."""
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM photo WHERE hash = ?", (file_hash,))
        row = cursor.fetchone()
        if row:
            return row['id']
            
        tags_str = json.dumps(tags if tags else [])
        cursor.execute("""
            INSERT INTO photo (project_id, filename, filepath, hash, description, tags, status)
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
        """, (project_id, filename, filepath, file_hash, description, tags_str))
        return cursor.lastrowid

    @staticmethod
    def list_photos(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Retorna todas as fotos registradas no projeto."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM photo WHERE project_id = ? ORDER BY id DESC", (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_photo(conn: sqlite3.Connection, photo_id: int) -> Optional[Dict[str, Any]]:
        """Retorna os metadados de uma foto pelo ID."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def update_photo_status(conn: sqlite3.Connection, photo_id: int, status: str) -> None:
        """Atualiza o status de processamento da foto."""
        conn.execute("UPDATE photo SET status = ? WHERE id = ?", (status, photo_id))

    @staticmethod
    def update_photo_analysis(conn: sqlite3.Connection, photo_id: int, description: str, tags: List[str], status: str = "analyzed") -> None:
        """Salva a descrição e tags geradas pela IA para a foto."""
        conn.execute(
            "UPDATE photo SET description = ?, tags = ?, status = ? WHERE id = ?",
            (description, json.dumps(tags), status, photo_id)
        )

    @staticmethod
    def delete_photo(conn: sqlite3.Connection, photo_id: int) -> None:
        """Deleta a foto pelo ID."""
        conn.execute("DELETE FROM photo WHERE id = ?", (photo_id,))

    @staticmethod
    def add_face(
        conn: sqlite3.Connection,
        project_id: int,
        name: Optional[str],
        bounding_box: List[float],
        photo_id: Optional[int] = None,
        video_id: Optional[int] = None,
        timestamp: Optional[float] = None,
        embedding: Optional[List[float]] = None
    ) -> int:
        """Insere um registro de detecção facial e seu embedding associado na tabela de reconhecimentos."""
        cursor = conn.cursor()
        bbox_str = json.dumps(bounding_box)
        cursor.execute("""
            INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (project_id, name, bbox_str, photo_id, video_id, timestamp))
        face_id = cursor.lastrowid
        
        if embedding:
            emb_str = json.dumps(embedding)
            cursor.execute("""
                INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence, status)
                VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.8, 'auto')
            """, (face_id, emb_str))
            
        return face_id

    @staticmethod
    def delete_faces_by_source(conn: sqlite3.Connection, photo_id: Optional[int] = None, video_id: Optional[int] = None, timestamp: Optional[float] = None) -> None:
        """Remove detecções faciais associadas a um frame ou foto específica para evitar duplicatas."""
        if photo_id:
            conn.execute("DELETE FROM face WHERE photo_id = ?", (photo_id,))
        elif video_id:
            if timestamp is not None:
                conn.execute("DELETE FROM face WHERE video_id = ? AND timestamp = ?", (video_id, timestamp))
            else:
                conn.execute("DELETE FROM face WHERE video_id = ?", (video_id,))

    @staticmethod
    def label_face(conn: sqlite3.Connection, face_id: int, name: str) -> None:
        """Define ou altera o nome (rótulo) de um rosto específico."""
        conn.execute("UPDATE face SET name = ? WHERE id = ?", (name, face_id))

    @staticmethod
    def get_video_faces(conn: sqlite3.Connection, video_id: int) -> List[Dict[str, Any]]:
        """Retorna todos os rostos identificados em frames de um vídeo."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, bounding_box, timestamp FROM face WHERE video_id = ? ORDER BY timestamp", (video_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_photo_faces(conn: sqlite3.Connection, photo_id: int) -> List[Dict[str, Any]]:
        """Retorna todos os rostos detectados em uma foto de set."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, bounding_box FROM face WHERE photo_id = ?", (photo_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_project_speakers_and_labeled_faces(conn: sqlite3.Connection, project_id: int) -> List[str]:
        """Agrega e ordena uma lista única de falantes, rostos rotulados e entidades do projeto."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT speaker_id 
            FROM transcript 
            WHERE video_id IN (SELECT id FROM video WHERE project_id = ?)
            ORDER BY speaker_id
        """, (project_id,))
        speakers = [r['speaker_id'] for r in cursor.fetchall()]
        
        cursor.execute("""
            SELECT DISTINCT name 
            FROM face 
            WHERE project_id = ? AND name IS NOT NULL AND name != ''
            ORDER BY name
        """, (project_id,))
        faces = [r['name'] for r in cursor.fetchall()]

        cursor.execute("""
            SELECT DISTINCT name 
            FROM entity 
            WHERE project_id = ? AND name IS NOT NULL AND name != ''
              AND name NOT IN ('Não Relevante', 'Não é Rosto')
            ORDER BY name
        """, (project_id,))
        entities = [r['name'] for r in cursor.fetchall()]
        
        return sorted(list(set(speakers + faces + entities)))

    @staticmethod
    def reset_stuck_tasks(conn: sqlite3.Connection) -> None:
        """Reseta status temporários causados por interrupções do servidor."""
        conn.execute("UPDATE video SET status = 'ingested' WHERE status IN ('transcribing', 'analyzing')")
        conn.execute("UPDATE photo SET status = 'error' WHERE status = 'pending'")
