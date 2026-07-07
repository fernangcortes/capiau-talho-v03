"""Repositório de acesso a dados para Entidades Nomeadas (Pessoas, Objetos, Locações) e suas Menções."""
import sqlite3
import json
from typing import List, Dict, Any, Optional

class EntityRepository:
    @staticmethod
    def upsert_entity(conn: sqlite3.Connection, project_id: int, name: str, entity_type: str = "other", description: str = "") -> int:
        """Cria a entidade se não existir (por nome canônico) e retorna seu ID."""
        name = (name or "").strip()
        if not name:
            raise ValueError("Nome de entidade vazio.")

        cursor = conn.cursor()
        cursor.execute("SELECT id, entity_type FROM entity WHERE project_id = ? AND name = ? COLLATE NOCASE", (project_id, name))
        row = cursor.fetchone()
        if row:
            # Promove 'other' para um tipo mais específico se descoberto depois
            if entity_type != "other" and row["entity_type"] == "other":
                cursor.execute("UPDATE entity SET entity_type = ? WHERE id = ?", (entity_type, row["id"]))
            return row["id"]

        cursor.execute(
            "INSERT INTO entity (project_id, entity_type, name, description) VALUES (?, ?, ?, ?)",
            (project_id, entity_type, name, description)
        )
        return cursor.lastrowid

    @staticmethod
    def add_mention(
        conn: sqlite3.Connection,
        entity_id: int,
        project_id: int,
        photo_id: Optional[int] = None,
        video_id: Optional[int] = None,
        timestamp: Optional[float] = None,
        source: str = "human_audit",
        status: str = "confirmed",
        text_to_replace: Optional[str] = None
    ) -> int:
        """Registra uma menção da entidade em uma mídia, evitando duplicatas exatas."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id FROM entity_mention
            WHERE entity_id = ?
              AND IFNULL(photo_id, -1) = IFNULL(?, -1)
              AND IFNULL(video_id, -1) = IFNULL(?, -1)
              AND IFNULL(timestamp, -1.0) = IFNULL(?, -1.0)
        """, (entity_id, photo_id, video_id, timestamp))
        row = cursor.fetchone()
        if row:
            # Atualiza o status/fonte se a menção foi confirmada por humano depois
            if status == "confirmed":
                cursor.execute(
                    "UPDATE entity_mention SET status = ?, source = ?, text_to_replace = IFNULL(?, text_to_replace) WHERE id = ?",
                    (status, source, text_to_replace, row["id"])
                )
            return row["id"]

        cursor.execute("""
            INSERT INTO entity_mention (entity_id, project_id, photo_id, video_id, timestamp, source, status, text_to_replace)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (entity_id, project_id, photo_id, video_id, timestamp, source, status, text_to_replace))
        return cursor.lastrowid

    @staticmethod
    def list_entities(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Lista todas as entidades do projeto com contagem de menções."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT e.id, e.entity_type, e.name, e.aliases, e.description, e.created_at,
                   COUNT(m.id) as mention_count
            FROM entity e
            LEFT JOIN entity_mention m ON m.entity_id = e.id AND m.status != 'rejected'
            WHERE e.project_id = ?
            GROUP BY e.id
            ORDER BY mention_count DESC, e.name
        """, (project_id,))
        results = []
        for r in cursor.fetchall():
            d = dict(r)
            try:
                d["aliases"] = json.loads(d["aliases"]) if d["aliases"] else []
            except Exception:
                d["aliases"] = []
            results.append(d)
        return results

    @staticmethod
    def get_known_names(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, str]]:
        """Retorna nomes canônicos + tipos para injetar como contexto no prompt de visão."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT name, entity_type FROM entity WHERE project_id = ?
            UNION
            SELECT DISTINCT name, 'person' as entity_type FROM person
            WHERE project_id = ? AND name IS NOT NULL AND name != ''
              AND name NOT IN ('Não Relevante', 'Não é Rosto')
        """, (project_id, project_id))
        seen = set()
        results = []
        for r in cursor.fetchall():
            key = r["name"].strip().lower()
            if key and key not in seen:
                seen.add(key)
                results.append({"name": r["name"].strip(), "entity_type": r["entity_type"]})
        return results

    @staticmethod
    def get_entities_for_media(
        conn: sqlite3.Connection,
        photo_id: Optional[int] = None,
        video_id: Optional[int] = None,
        timestamp: Optional[float] = None,
        tolerance: float = 5.0
    ) -> Dict[str, Any]:
        """Coleta entidades confirmadas para um frame/foto, unificando a tabela nova
        (entity_mention) com o legado (face.name).

        Retorna {"entities": [{name, entity_type}], "replacements": {trecho: nome}}
        """
        names: List[Dict[str, str]] = []
        replacements: Dict[str, str] = {}
        seen = set()

        cursor = conn.cursor()

        def _push(name: str, etype: str):
            key = (name or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                names.append({"name": name.strip(), "entity_type": etype})

        # 1. Fonte nova: entity_mention
        if photo_id is not None:
            cursor.execute("""
                SELECT e.name, e.entity_type, m.text_to_replace
                FROM entity_mention m JOIN entity e ON e.id = m.entity_id
                WHERE m.photo_id = ? AND m.status != 'rejected'
            """, (photo_id,))
        elif video_id is not None and timestamp is not None:
            cursor.execute("""
                SELECT e.name, e.entity_type, m.text_to_replace
                FROM entity_mention m JOIN entity e ON e.id = m.entity_id
                WHERE m.video_id = ? AND m.status != 'rejected'
                  AND m.timestamp IS NOT NULL AND ABS(m.timestamp - ?) <= ?
            """, (video_id, timestamp, tolerance))
        else:
            cursor = None

        if cursor is not None:
            for r in cursor.fetchall():
                if r["text_to_replace"]:
                    replacements[r["text_to_replace"]] = r["name"]
                _push(r["name"], r["entity_type"])

        # 2. Fonte legada: face.name (inclui o hack crop_path='text:...')
        cursor = conn.cursor()
        if photo_id is not None:
            cursor.execute("""
                SELECT DISTINCT name, crop_path FROM face
                WHERE photo_id = ? AND name IS NOT NULL AND name != ''
                  AND name NOT IN ('Não Relevante', 'Não é Rosto')
            """, (photo_id,))
        elif video_id is not None and timestamp is not None:
            cursor.execute("""
                SELECT DISTINCT name, crop_path FROM face
                WHERE video_id = ? AND ABS(timestamp - ?) <= ?
                  AND name IS NOT NULL AND name != ''
                  AND name NOT IN ('Não Relevante', 'Não é Rosto')
            """, (video_id, timestamp, tolerance))
        else:
            cursor = None

        if cursor is not None:
            for r in cursor.fetchall():
                crop = r["crop_path"] or ""
                if crop.startswith("text:"):
                    replacements[crop[5:]] = r["name"]
                    _push(r["name"], "object")
                else:
                    _push(r["name"], "person")

        return {"entities": names, "replacements": replacements}

    @staticmethod
    def rename_entity(conn: sqlite3.Connection, entity_id: int, new_name: str, entity_type: Optional[str] = None) -> None:
        """Renomeia uma entidade (dispara re-enriquecimento externo pelas rotas)."""
        cursor = conn.cursor()
        cursor.execute("UPDATE entity SET name = ? WHERE id = ?", (new_name.strip(), entity_id))
        if entity_type:
            cursor.execute("UPDATE entity SET entity_type = ? WHERE id = ?", (entity_type, entity_id))

    @staticmethod
    def delete_entity(conn: sqlite3.Connection, entity_id: int) -> None:
        conn.execute("DELETE FROM entity WHERE id = ?", (entity_id,))

    @staticmethod
    def get_affected_media(conn: sqlite3.Connection, entity_id: int) -> List[Dict[str, Any]]:
        """Retorna as mídias/timestamps onde a entidade aparece (para re-enriquecer)."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT project_id, photo_id, video_id, timestamp
            FROM entity_mention WHERE entity_id = ? AND status != 'rejected'
        """, (entity_id,))
        return [dict(r) for r in cursor.fetchall()]
