"""Placeholders de cluster ("Pessoa Desconhecida (Grupo N)") e rótulos de triagem
("Não Relevante", "Não é Rosto") não identificam ninguém: não viram entidade, não
entram no prompt de visão, e uma foto que perde todas as entidades volta à
descrição original.

Banco temporário isolado. Qdrant e LLM são simulados.
"""
import unittest
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.entities import EntityRepository, is_identifying_name
from src.api.server import app


class TestPlaceholderEntities(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_placeholder_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_placeholder.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Placeholder", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_is_identifying_name(self):
        self.assertTrue(is_identifying_name("Maria"))
        for n in (None, "", "  ", "Não Relevante", "Não é Rosto", "Pessoa Desconhecida (Grupo 31)"):
            self.assertFalse(is_identifying_name(n), n)

    def test_upsert_recusa_placeholder(self):
        with get_db() as conn:
            with self.assertRaises(ValueError):
                EntityRepository.upsert_entity(conn, self.project_id, "Pessoa Desconhecida (Grupo 2)", "person")
            with self.assertRaises(ValueError):
                EntityRepository.upsert_entity(conn, self.project_id, "Não é Rosto", "object")

    def test_rota_de_criacao_devolve_400(self):
        resp = TestClient(app).post("/api/entities", json={
            "project_id": self.project_id, "name": "Pessoa Desconhecida (Grupo 7)", "entity_type": "person",
        })
        self.assertEqual(resp.status_code, 400)

    def test_get_known_names_ignora_placeholder_de_person(self):
        with get_db() as conn:
            conn.execute("INSERT INTO person (project_id, name) VALUES (?, ?)",
                         (self.project_id, "Pessoa Desconhecida (Grupo 9)"))
            conn.execute("INSERT INTO person (project_id, name) VALUES (?, ?)", (self.project_id, "Joana"))
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Joana", names)
        self.assertNotIn("Pessoa Desconhecida (Grupo 9)", names)

    def _add_photo(self, tag: str, description: str, raw: str) -> int:
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO photo (project_id, filename, filepath, hash, description, raw_description) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (self.project_id, f"{tag}.jpg", f"/tmp/{tag}.jpg", f"hash-{tag}", description, raw),
            )
            conn.commit()
            return cur.lastrowid

    @patch("src.search.semantic.SemanticSearch.get_instance")
    def test_foto_sem_entidades_volta_a_descricao_original(self, mock_search):
        from src.nlp.enrichment_engine import enrich_photo
        mock_search.return_value = MagicMock(get_photo_point=MagicMock(return_value=None))
        photo_id = self._add_photo("restaura", "Beltrano sorri para a câmera.", "Um homem sorri para a câmera.")

        self.assertTrue(enrich_photo(self.project_id, photo_id))
        with get_db() as conn:
            desc = conn.execute("SELECT description FROM photo WHERE id = ?", (photo_id,)).fetchone()["description"]
        self.assertEqual(desc, "Um homem sorri para a câmera.")

    @patch("src.search.semantic.SemanticSearch.get_instance")
    def test_foto_ja_original_nao_faz_nada(self, mock_search):
        from src.nlp.enrichment_engine import enrich_photo
        photo_id = self._add_photo("igual", "Um carro na rua.", "Um carro na rua.")
        self.assertFalse(enrich_photo(self.project_id, photo_id))
        mock_search.assert_not_called()


if __name__ == "__main__":
    unittest.main()
