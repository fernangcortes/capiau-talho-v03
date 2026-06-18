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

    @staticmethod
    def update_video_metadata(conn: sqlite3.Connection, video_id: int, description: str, summary: str, tags: List[str]) -> None:
        """Atualiza a decupagem editorial e tags do vídeo."""
        conn.execute("""
            UPDATE video 
            SET description = ?, summary = ?, tags = ? 
            WHERE id = ?
        """, (description, summary, json.dumps(tags), video_id))

    @staticmethod
    def delete_video(conn: sqlite3.Connection, video_id: int) -> None:
        """Deleta o vídeo e suas dependências."""
        conn.execute("DELETE FROM video WHERE id = ?", (video_id,))

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
        """Insere um registro de detecção facial."""
        cursor = conn.cursor()
        bbox_str = json.dumps(bounding_box)
        emb_str = json.dumps(embedding) if embedding else None
        cursor.execute("""
            INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (project_id, name, bbox_str, photo_id, video_id, timestamp, emb_str))
        return cursor.lastrowid

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
        """Agrega e ordena uma lista única de falantes e rostos rotulados do projeto."""
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
            WHERE project_id = ? AND name IS NOT NULL
            ORDER BY name
        """, (project_id,))
        faces = [r['name'] for r in cursor.fetchall()]
        
        return sorted(list(set(speakers + faces)))

    @staticmethod
    def reset_stuck_tasks(conn: sqlite3.Connection) -> None:
        """Reseta status temporários causados por interrupções do servidor."""
        conn.execute("UPDATE video SET status = 'ingested' WHERE status IN ('transcribing', 'analyzing')")
        conn.execute("UPDATE photo SET status = 'error' WHERE status = 'pending'")
