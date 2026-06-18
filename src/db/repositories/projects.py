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
    def add_document(conn: sqlite3.Connection, project_id: int, filename: str, filepath: Optional[str], content: str, doc_type: str = "other") -> int:
        """Insere um novo documento de contexto de produção no banco."""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO production_doc (project_id, filename, filepath, content, doc_type)
            VALUES (?, ?, ?, ?, ?)
        """, (project_id, filename, filepath, content, doc_type))
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
    def delete_document(conn: sqlite3.Connection, doc_id: int) -> None:
        """Deleta um documento pelo ID."""
        conn.execute("DELETE FROM production_doc WHERE id = ?", (doc_id,))

    @staticmethod
    def save_timeline(conn: sqlite3.Connection, project_id: int, name: str, description: str, cuts: List[Dict[str, Any]]) -> int:
        """Cria ou atualiza uma timeline de pré-edição."""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO timeline (project_id, name, description, sequence_json)
            VALUES (?, ?, ?, ?)
        """, (project_id, name, description, json.dumps(cuts)))
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
    def get_timeline(conn: sqlite3.Connection, timeline_id: int) -> Optional[Dict[str, Any]]:
        """Retorna os dados detalhados e cortes de uma timeline pelo ID."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, sequence_json FROM timeline WHERE id = ?", (timeline_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
