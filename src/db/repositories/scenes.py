"""Repositório de acesso a dados para Cenas extraídas de roteiro e rodadas de extração (P2)."""
import sqlite3
import json
from typing import List, Dict, Any, Optional

VALID_SCENE_STATUS = ("suggested", "confirmed", "rejected")
VALID_EXTRACTION_STATUS = ("running", "done", "error")


class SceneRepository:
    # ── Cenas ────────────────────────────────────────────────────────────────

    @staticmethod
    def replace_scenes_for_doc(
        conn: sqlite3.Connection, project_id: int, doc_id: int, scenes: List[Dict[str, Any]]
    ) -> int:
        """Substitui em bloco as cenas de um documento (re-extração é sempre integral).

        As cenas chegam já numeradas pela posição no documento (script_format.py), então
        `number` é estável entre rodadas: reextrair o mesmo roteiro reescreve as mesmas
        linhas em vez de duplicá-las.
        """
        cursor = conn.cursor()
        cursor.execute("DELETE FROM scene WHERE project_id = ? AND doc_id = ?", (project_id, doc_id))

        rows = []
        for s in scenes:
            number = s.get("number")
            if number is None:
                continue
            rows.append((
                project_id, doc_id, int(number),
                s.get("heading"), s.get("synopsis"),
                json.dumps(s.get("characters") or [], ensure_ascii=False),
                json.dumps(s.get("props") or [], ensure_ascii=False),
                s.get("location"),
            ))

        if rows:
            cursor.executemany("""
                INSERT INTO scene (project_id, doc_id, number, heading, synopsis,
                                   characters_json, props_json, location)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, rows)
        return len(rows)

    @staticmethod
    def list_scenes(
        conn: sqlite3.Connection, project_id: int,
        doc_id: Optional[int] = None, include_rejected: bool = False
    ) -> List[Dict[str, Any]]:
        """Lista as cenas do projeto (ou de um documento), já com os JSON decodificados."""
        cursor = conn.cursor()
        params: List[Any] = [project_id]
        where = "WHERE project_id = ?"
        if doc_id is not None:
            where += " AND doc_id = ?"
            params.append(doc_id)
        if not include_rejected:
            where += " AND status != 'rejected'"

        cursor.execute(f"""
            SELECT id, project_id, doc_id, number, heading, synopsis,
                   characters_json, props_json, location, status, created_at
            FROM scene {where}
            ORDER BY doc_id, number
        """, params)

        results = []
        for r in cursor.fetchall():
            d = dict(r)
            for src, dest in (("characters_json", "characters"), ("props_json", "props")):
                try:
                    d[dest] = json.loads(d[src]) if d[src] else []
                except Exception:
                    d[dest] = []
                d.pop(src, None)
            results.append(d)
        return results

    @staticmethod
    def set_scenes_status(conn: sqlite3.Connection, project_id: int, scene_ids: List[int], status: str) -> int:
        """Aceita/rejeita cenas em massa na curadoria. Retorna quantas linhas mudaram."""
        if status not in VALID_SCENE_STATUS:
            raise ValueError(f"Status invalido para cena: '{status}'")
        if not scene_ids:
            return 0

        cursor = conn.cursor()
        placeholders = ",".join("?" for _ in scene_ids)
        cursor.execute(
            f"UPDATE scene SET status = ? WHERE project_id = ? AND id IN ({placeholders})",
            [status, project_id, *scene_ids]
        )
        return cursor.rowcount

    # ── Rodadas de extração (cache + custo) ──────────────────────────────────

    @staticmethod
    def find_extraction(conn: sqlite3.Connection, doc_id: int, content_hash: str) -> Optional[Dict[str, Any]]:
        """Extração concluída para esta versão exata do documento (cache do P2.3)."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM script_extraction
            WHERE doc_id = ? AND content_hash = ? AND status = 'done'
            ORDER BY id DESC LIMIT 1
        """, (doc_id, content_hash))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def latest_extraction(conn: sqlite3.Connection, doc_id: int) -> Optional[Dict[str, Any]]:
        """Última rodada de extração do documento, em qualquer status (para a UI)."""
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM script_extraction WHERE doc_id = ? ORDER BY id DESC LIMIT 1", (doc_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    def create_extraction(
        conn: sqlite3.Connection, project_id: int, doc_id: int, content_hash: str, strategy: Optional[str] = None
    ) -> int:
        """Abre uma rodada de extração em status 'running'."""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO script_extraction (project_id, doc_id, content_hash, status, strategy)
            VALUES (?, ?, ?, 'running', ?)
        """, (project_id, doc_id, content_hash, strategy))
        return cursor.lastrowid

    @staticmethod
    def finish_extraction(
        conn: sqlite3.Connection, extraction_id: int, status: str,
        strategy: Optional[str] = None, model: Optional[str] = None,
        chunks: int = 0, calls: int = 0,
        prompt_tokens: int = 0, completion_tokens: int = 0,
        error: Optional[str] = None
    ) -> None:
        """Fecha a rodada gravando o custo real medido (tokens vindos do usage da API)."""
        if status not in VALID_EXTRACTION_STATUS:
            raise ValueError(f"Status invalido para extracao: '{status}'")
        conn.execute("""
            UPDATE script_extraction
            SET status = ?, strategy = IFNULL(?, strategy), model = ?, chunks = ?, calls = ?,
                prompt_tokens = ?, completion_tokens = ?, error = ?
            WHERE id = ?
        """, (status, strategy, model, chunks, calls, prompt_tokens, completion_tokens, error, extraction_id))
