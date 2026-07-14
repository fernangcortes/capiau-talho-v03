"""Repositório de acesso a dados para as configurações da IA (overrides globais e por projeto).

As tabelas guardam APENAS overrides: a ausência de linha significa "usar o valor
da camada anterior" (projeto -> global -> default do código).
"""
import sqlite3
import json
from typing import Any, Dict


class SettingsRepository:
    @staticmethod
    def get_all_global(conn: sqlite3.Connection) -> Dict[str, Any]:
        """Retorna todos os overrides globais como dict key -> valor desserializado."""
        cursor = conn.cursor()
        cursor.execute("SELECT key, value_json FROM app_setting")
        return {r["key"]: json.loads(r["value_json"]) for r in cursor.fetchall()}

    @staticmethod
    def get_all_project(conn: sqlite3.Connection, project_id: int) -> Dict[str, Any]:
        """Retorna todos os overrides do projeto como dict key -> valor desserializado."""
        cursor = conn.cursor()
        cursor.execute("SELECT key, value_json FROM project_setting WHERE project_id = ?", (project_id,))
        return {r["key"]: json.loads(r["value_json"]) for r in cursor.fetchall()}

    @staticmethod
    def upsert_global(conn: sqlite3.Connection, key: str, value: Any) -> None:
        """Insere ou atualiza um override global."""
        conn.execute("""
            INSERT INTO app_setting (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
        """, (key, json.dumps(value)))

    @staticmethod
    def upsert_project(conn: sqlite3.Connection, project_id: int, key: str, value: Any) -> None:
        """Insere ou atualiza um override do projeto."""
        conn.execute("""
            INSERT INTO project_setting (project_id, key, value_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(project_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
        """, (project_id, key, json.dumps(value)))

    @staticmethod
    def delete_global(conn: sqlite3.Connection, key: str) -> None:
        """Remove um override global (volta ao default do código)."""
        conn.execute("DELETE FROM app_setting WHERE key = ?", (key,))

    @staticmethod
    def delete_project(conn: sqlite3.Connection, project_id: int, key: str) -> None:
        """Remove um override do projeto (volta ao global/default)."""
        conn.execute("DELETE FROM project_setting WHERE project_id = ? AND key = ?", (project_id, key))

    @staticmethod
    def delete_all_global(conn: sqlite3.Connection) -> None:
        """Remove todos os overrides globais."""
        conn.execute("DELETE FROM app_setting")

    @staticmethod
    def delete_all_project(conn: sqlite3.Connection, project_id: int) -> None:
        """Remove todos os overrides do projeto."""
        conn.execute("DELETE FROM project_setting WHERE project_id = ?", (project_id,))
