"""Repositório de acesso a dados para Projetos, Documentos de Apoio e Timelines."""
import sqlite3
import json
from typing import List, Dict, Any, Optional

class ProjectRepository:
    @staticmethod
    def create(conn: sqlite3.Connection, name: str, description: str = "", drive_link: str = "") -> int:
        """Cria um novo projeto e retorna seu ID."""
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO project (name, description, drive_link) VALUES (?, ?, ?)",
            (name, description, drive_link)
        )
        return cursor.lastrowid

    @staticmethod
    def list_all(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
        """Retorna uma lista com todos os projetos cadastrados."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description, drive_link, created_at FROM project ORDER BY id DESC")
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def delete(conn: sqlite3.Connection, project_id: int) -> None:
        """Deleta um projeto pelo ID (chaves estrangeiras realizam cascateamento automático)."""
        conn.execute("DELETE FROM project WHERE id = ?", (project_id,))

    @staticmethod
    def update_drive_link(conn: sqlite3.Connection, project_id: int, link: str) -> None:
        """Atualiza o link do Google Drive de um projeto."""
        conn.execute("UPDATE project SET drive_link = ? WHERE id = ?", (link, project_id))

    @staticmethod
    def hash_doc_bytes(data: bytes) -> str:
        """SHA-256 completo dos bytes do arquivo enviado (dedupe de upload idêntico, P1.1).

        Diferente de compute_hash() de ingest.py (parcial/truncado para mídia grande):
        documentos de texto são pequenos, então o hash cobre o arquivo inteiro sem truncar.
        """
        import hashlib
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def hash_doc_content(content: str) -> str:
        """SHA-256 do texto normalizado (minúsculas + espaços colapsados) — reconhece o
        mesmo conteúdo mesmo vindo de formatos diferentes (ex: .txt vs .pdf do mesmo roteiro)."""
        import hashlib
        import re
        normalized = re.sub(r"\s+", " ", content.lower()).strip()
        return hashlib.sha256(normalized.encode("utf-8")).hexdigest()

    @staticmethod
    def add_document(
        conn: sqlite3.Connection, project_id: int, filename: str, filepath: Optional[str], content: str,
        doc_type: str = "other", byte_hash: Optional[str] = None, content_hash: Optional[str] = None
    ) -> int:
        """Insere um novo documento de contexto de produção no banco."""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO production_doc (project_id, filename, filepath, content, doc_type, byte_hash, content_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (project_id, filename, filepath, content, doc_type, byte_hash, content_hash))
        return cursor.lastrowid

    @staticmethod
    def list_documents(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Lista os documentos de contexto associados ao projeto."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, project_id, filename, filepath, content, doc_type, created_at
            FROM production_doc
            WHERE project_id = ?
            ORDER BY id DESC
        """, (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def find_document_by_byte_hash(conn: sqlite3.Connection, project_id: int, byte_hash: str) -> Optional[Dict[str, Any]]:
        """Busca um doc do projeto com bytes idênticos (upload exato repetido)."""
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, filename FROM production_doc WHERE project_id = ? AND byte_hash = ?",
            (project_id, byte_hash)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def find_document_by_content_hash(conn: sqlite3.Connection, project_id: int, content_hash: str) -> Optional[Dict[str, Any]]:
        """Busca um doc do projeto com o mesmo texto normalizado (mesmo conteúdo, outro formato)."""
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, filename FROM production_doc WHERE project_id = ? AND content_hash = ?",
            (project_id, content_hash)
        )
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def document_belongs_to_project(conn: sqlite3.Connection, project_id: int, doc_id: int) -> bool:
        """Confere se um doc pertence ao projeto (usado antes de substituir uma versão, P1.2)."""
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM production_doc WHERE id = ? AND project_id = ?", (doc_id, project_id))
        return cursor.fetchone() is not None

    @staticmethod
    def list_documents_for_similarity(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Retorna id, filename, content de todos os docs do projeto — usado para checar
        similaridade de texto contra versões existentes no upload (P1.2)."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, filename, content FROM production_doc WHERE project_id = ?", (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def delete_document(conn: sqlite3.Connection, doc_id: int) -> None:
        """Deleta um documento pelo ID."""
        conn.execute("DELETE FROM production_doc WHERE id = ?", (doc_id,))

    # Trilhas padrão para timelines legadas (v1) e novas sem definição explícita
    DEFAULT_TRACKS = [
        {"id": "AI", "name": "IA — Sugestões", "kind": "ai", "order": 0, "volume": 1.0, "muted": False, "locked": True, "magnetic": False},
        {"id": "V2", "name": "B-Roll", "kind": "video", "order": 1, "volume": 1.0, "muted": False, "locked": False, "magnetic": False},
        {"id": "V1", "name": "Falas", "kind": "video", "order": 2, "volume": 1.0, "muted": False, "locked": False, "magnetic": True},
        {"id": "A1", "name": "Áudio Falas", "kind": "audio", "order": 3, "volume": 1.0, "muted": False, "locked": False, "magnetic": False},
        {"id": "A2", "name": "Áudio B-Roll", "kind": "audio", "order": 4, "volume": 1.0, "muted": False, "locked": False, "magnetic": False},
    ]

    @staticmethod
    def save_timeline(
        conn: sqlite3.Connection,
        project_id: int,
        name: str,
        description: str,
        cuts: List[Dict[str, Any]],
        tracks: Optional[List[Dict[str, Any]]] = None,
        fps: float = 24.0,
        width: Optional[int] = 1920,
        height: Optional[int] = 1080
    ) -> int:
        """Salva uma timeline no formato v2 multipista (tracks + clips com posição absoluta)."""
        payload = {
            "version": 2,
            "fps": fps,
            "width": width,
            "height": height,
            "tracks": tracks if tracks else ProjectRepository.DEFAULT_TRACKS,
            "clips": cuts
        }
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO timeline (project_id, name, description, sequence_json)
            VALUES (?, ?, ?, ?)
        """, (project_id, name, description, json.dumps(payload)))
        return cursor.lastrowid

    @staticmethod
    def list_timelines(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Retorna todas as timelines cadastradas em um projeto."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, name, description, created_at
            FROM timeline
            WHERE project_id = ?
            ORDER BY id DESC
        """, (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def parse_sequence(sequence_json: str) -> Dict[str, Any]:
        """Interpreta o sequence_json em qualquer versão e normaliza para o formato v2.

        v1 (legado): lista simples [{video_id, in, out, track}] — posições são
        reconstruídas sequencialmente por trilha.
        v2: {version: 2, fps, tracks: [...], clips: [{..., timeline_start}]}
        """
        data = json.loads(sequence_json)

        if isinstance(data, dict) and data.get("version") == 2:
            data.setdefault("tracks", ProjectRepository.DEFAULT_TRACKS)
            data.setdefault("clips", [])
            data.setdefault("fps", 24.0)
            return data

        # Migração v1 → v2: layout sequencial por trilha
        clips = []
        track_cursor: Dict[str, float] = {}
        for cut in (data if isinstance(data, list) else []):
            track = cut.get("track", "V1")
            in_s = float(cut.get("in", 0.0))
            out_s = float(cut.get("out", 0.0))
            start = track_cursor.get(track, 0.0)
            clips.append({
                "type": cut.get("type", "video"),
                "video_id": cut.get("video_id"),
                "photo_id": cut.get("photo_id"),
                "in": in_s,
                "out": out_s,
                "track": track,
                "timeline_start": start
            })
            track_cursor[track] = start + (out_s - in_s)

        return {
            "version": 2,
            "fps": 24.0,
            "tracks": ProjectRepository.DEFAULT_TRACKS,
            "clips": clips
        }

    @staticmethod
    def get_timeline(conn: sqlite3.Connection, timeline_id: int) -> Optional[Dict[str, Any]]:
        """Retorna os dados detalhados e cortes de uma timeline pelo ID (normalizado para v2)."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description, sequence_json FROM timeline WHERE id = ?", (timeline_id,))
        row = cursor.fetchone()
        if not row:
            return None
        result = dict(row)
        try:
            result["sequence"] = ProjectRepository.parse_sequence(result.pop("sequence_json"))
        except Exception:
            result["sequence"] = {"version": 2, "fps": 24.0, "tracks": ProjectRepository.DEFAULT_TRACKS, "clips": []}
        return result
