"""Testes do modelo de entidades reformulado (E3.C / E-A1, 21/07): realm (produção
real x obra ficcional), role e linked_entity_id, com backfill migrado do estado
anterior (só status suggested/confirmed).

Banco temporário isolado. Nenhum teste aqui toca Qdrant nem LLM.
"""
import unittest
import shutil
import sqlite3
import tempfile
from pathlib import Path

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.entities import EntityRepository


class TestE3CEntitySchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_entities_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_e3c.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste E3.C", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    # ── Migração ─────────────────────────────────────────────────────────────

    def test_migracao_e_idempotente(self):
        init_db(CONFIG.DB_PATH)  # roda de novo no mesmo banco
        with get_db() as conn:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(entity)").fetchall()]
        for col in ("realm", "role", "linked_entity_id"):
            self.assertIn(col, cols)

    def test_realm_default_e_production(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Equipe Padrao", "person", "")
            conn.commit()
            row = conn.execute(
                "SELECT realm FROM entity WHERE project_id = ? AND name = 'Equipe Padrao'", (self.project_id,)
            ).fetchone()
        self.assertEqual(row["realm"], "production")

    def test_check_constraint_rejeita_realm_invalido(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Alvo Constraint", "person", "")
            conn.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "UPDATE entity SET realm = 'invalido' WHERE project_id = ? AND name = 'Alvo Constraint'",
                    (self.project_id,)
                )

    def test_linked_entity_id_vira_null_quando_vinculada_e_apagada(self):
        """ON DELETE SET NULL: apagar a pessoa real nao pode deixar o personagem
        apontando para um id fantasma."""
        with get_db() as conn:
            ator_id = EntityRepository.upsert_entity(conn, self.project_id, "Ator Vinculavel", "person", "")
            personagem_id = EntityRepository.upsert_entity(conn, self.project_id, "Personagem Vinculavel", "person", "")
            conn.execute("UPDATE entity SET linked_entity_id = ? WHERE id = ?", (ator_id, personagem_id))
            conn.commit()

            conn.execute("DELETE FROM entity WHERE id = ?", (ator_id,))
            conn.commit()
            row = conn.execute("SELECT linked_entity_id FROM entity WHERE id = ?", (personagem_id,)).fetchone()
        self.assertIsNone(row["linked_entity_id"])

    # ── Backfill (migração de um banco no estado anterior ao E3.C) ──────────

    def test_backfill_promove_suggested_existente_para_story(self):
        """Simula o cenario real: um banco que ja tinha entidades suggested (do P2,
        antes do realm existir) precisa ve-las viraram 'story' na migracao, sem
        precisar de re-extracao."""
        db_path = self.test_dir / "test_backfill.db"
        init_db(db_path)
        pid = add_project("Backfill", "", "")

        # Simula o estado ANTERIOR ao E3.C: reverte a coluna realm manualmente para
        # forcar a migracao a rodar de novo neste banco especifico.
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("ALTER TABLE entity RENAME TO entity_new")
        conn.execute("""
            CREATE TABLE entity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                entity_type TEXT CHECK(entity_type IN ('person','object','location','other')) DEFAULT 'other',
                name TEXT NOT NULL,
                aliases TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'confirmed',
                UNIQUE(project_id, name)
            )
        """)
        conn.execute("""
            INSERT INTO entity (id, project_id, entity_type, name, aliases, description, created_at, status)
            SELECT id, project_id, entity_type, name, aliases, description, created_at, status FROM entity_new
        """)
        conn.execute("DROP TABLE entity_new")
        conn.execute("INSERT INTO entity (project_id, entity_type, name, status) VALUES (?, 'person', 'Personagem Legado', 'suggested')", (pid,))
        conn.execute("INSERT INTO entity (project_id, entity_type, name, status) VALUES (?, 'person', 'Equipe Legada', 'confirmed')", (pid,))
        conn.commit()
        conn.close()

        # Roda a migracao real de verdade sobre este banco "antigo"
        init_db(db_path)

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        legado_suggested = conn.execute("SELECT realm FROM entity WHERE name = 'Personagem Legado'").fetchone()
        legado_confirmed = conn.execute("SELECT realm FROM entity WHERE name = 'Equipe Legada'").fetchone()
        conn.close()

        self.assertEqual(legado_suggested["realm"], "story")
        self.assertEqual(legado_confirmed["realm"], "production")

    # ── upsert_suggested_entity com realm ────────────────────────────────────

    def test_upsert_suggested_default_realm_e_story(self):
        with get_db() as conn:
            eid = EntityRepository.upsert_suggested_entity(conn, self.project_id, "Personagem Default", "person", "")
            conn.commit()
            row = conn.execute("SELECT realm FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "story")

    def test_upsert_suggested_realm_explicito_production(self):
        """O extrator de documentos de producao (E-C, futuro) vai chamar isto com
        realm='production' para pessoas de equipe extraidas de ficha tecnica."""
        with get_db() as conn:
            eid = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Tecnico Sugerido", "person", "", realm="production"
            )
            conn.commit()
            row = conn.execute("SELECT realm FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "production")

    def test_upsert_suggested_nao_sobrescreve_realm_existente(self):
        """O caso Daniel: uma pessoa real ja confirmada (realm=production) nao pode
        virar 'story' silenciosamente so porque o roteiro tambem tem um personagem
        com o mesmo nome. Ligar os dois e decisao humana (vinculo), nao automatica."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Daniel Duplicado", "person", "")
            conn.commit()
            eid = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Daniel Duplicado", "person", "personagem do romance", realm="story"
            )
            conn.commit()
            row = conn.execute("SELECT realm, status FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "production", "realm da entidade existente nao pode ser sobrescrito")
        self.assertEqual(row["status"], "confirmed", "status da entidade existente tambem nao pode ser sobrescrito")


if __name__ == "__main__":
    unittest.main()
