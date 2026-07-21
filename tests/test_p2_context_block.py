"""Testes do bloco compacto de contexto do roteiro (P2.4, Commit 5).

Banco temporario isolado. Nenhum teste aqui toca Qdrant nem LLM -- estas funcoes so
montam texto de prompt a partir do SQLite.
"""
import unittest
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.entities import EntityRepository
from src.db.repositories.settings import SettingsRepository
from src.services.settings_service import SettingsService
from src.nlp.prompt_templates import (
    _script_context_block,
    get_triage_prompt,
    get_vision_prompt,
    get_photo_vision_prompt,
)

ANTI_BIAS_MARKER = "UNIVERSO DO FILME"


class TestP2ContextBlock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_context_block_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_context.db"
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        SettingsService.invalidate()
        self.project_id = add_project("Projeto Teste Contexto", "Um monstro assombra a casa da colina.", "")

    def _enable_block(self, max_chars=None):
        with get_db() as conn:
            SettingsRepository.upsert_project(conn, self.project_id, "context.script_block_enabled", True)
            if max_chars is not None:
                SettingsRepository.upsert_project(conn, self.project_id, "context.script_block_max_chars", max_chars)
            conn.commit()
        SettingsService.invalidate(self.project_id)

    def _confirm(self, name, entity_type, description=""):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, name, entity_type, description)
            conn.commit()

    def _suggest(self, name, entity_type, description=""):
        with get_db() as conn:
            eid = EntityRepository.upsert_suggested_entity(conn, self.project_id, name, entity_type, description)
            conn.commit()
        return eid

    # ── Gate ─────────────────────────────────────────────────────────────────

    def test_gate_off_by_default_returns_empty(self):
        self._confirm("Daniel", "person", "protagonista")
        self.assertEqual(_script_context_block(self.project_id), "")

    def test_gate_on_with_no_confirmed_entities_returns_empty(self):
        self._enable_block()
        self.assertEqual(_script_context_block(self.project_id), "")

    def test_project_id_none_returns_empty_without_crash(self):
        self.assertEqual(_script_context_block(None), "")

    # ── Conteudo ─────────────────────────────────────────────────────────────

    def test_gate_on_includes_confirmed_entities_and_anti_bias_header(self):
        self._enable_block()
        self._confirm("Daniel", "person", "protagonista, filho dos Degará")
        self._confirm("Casa da Colina", "location")
        self._confirm("Envelope", "object", "pista central")

        block = _script_context_block(self.project_id)
        self.assertIn(ANTI_BIAS_MARKER, block)
        self.assertIn("PODE OU NÃO ter relação", block)
        self.assertIn("Daniel", block)
        self.assertIn("protagonista, filho dos Degará", block)
        self.assertIn("Casa da Colina", block)
        self.assertIn("Envelope", block)

    def test_logline_is_first_sentence_of_project_description(self):
        self._enable_block()
        self._confirm("Daniel", "person")
        block = _script_context_block(self.project_id)
        self.assertIn("Um monstro assombra a casa da colina.", block)

    def test_legacy_entity_without_status_counts_as_confirmed(self):
        """Entidades criadas antes do P2.2 (status NULL) precisam continuar aparecendo."""
        self._enable_block()
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Legado", "person", "")
            conn.execute("UPDATE entity SET status = NULL WHERE project_id = ? AND name = 'Legado'", (self.project_id,))
            conn.commit()
        block = _script_context_block(self.project_id)
        self.assertIn("Legado", block)

    # ── Curadoria: so confirmed entra ───────────────────────────────────────

    def test_suggested_entity_excluded_from_block(self):
        self._enable_block()
        self._confirm("Confirmado", "person")
        self._suggest("Ainda Nao Confirmado", "person")

        block = _script_context_block(self.project_id)
        self.assertIn("Confirmado", block)
        self.assertNotIn("Ainda Nao Confirmado", block)

    def test_rejected_entity_excluded_from_block(self):
        self._enable_block()
        eid = self._suggest("Sera Rejeitado", "person")
        with get_db() as conn:
            EntityRepository.set_entities_status(conn, self.project_id, [eid], "rejected")
            conn.commit()

        block = _script_context_block(self.project_id)
        self.assertNotIn("Sera Rejeitado", block)

    # ── Degradacao segura ────────────────────────────────────────────────────

    def test_settings_failure_degrades_to_empty(self):
        self._confirm("Daniel", "person")
        with patch("src.services.settings_service.SettingsService.get_settings", side_effect=RuntimeError("boom")):
            self.assertEqual(_script_context_block(self.project_id), "")

    def test_db_failure_degrades_to_empty(self):
        self._enable_block()
        self._confirm("Daniel", "person")
        with patch("src.db.connection.get_db", side_effect=RuntimeError("boom")):
            self.assertEqual(_script_context_block(self.project_id), "")

    # ── Corte por orcamento ──────────────────────────────────────────────────

    def test_block_respects_max_chars_budget(self):
        self._enable_block(max_chars=1000)
        for i in range(60):
            self._confirm(f"Personagem Numero {i:03d} Com Nome Razoavelmente Longo", "person")

        block = _script_context_block(self.project_id)
        self.assertLessEqual(len(block), 1000)
        self.assertFalse(block.rstrip("\n").endswith(","), "corte nao pode parar no meio de uma lista")

    # ── Integracao com os prompts ────────────────────────────────────────────

    def test_triage_prompt_includes_block_when_enabled(self):
        self._enable_block()
        self._confirm("Daniel", "person", "protagonista")
        prompt = get_triage_prompt(project_id=self.project_id)
        self.assertIn(ANTI_BIAS_MARKER, prompt)
        self.assertIn("Daniel", prompt)

    def test_triage_prompt_excludes_block_when_disabled(self):
        self._confirm("Daniel", "person", "protagonista")
        prompt = get_triage_prompt(project_id=self.project_id)
        self.assertNotIn(ANTI_BIAS_MARKER, prompt)

    def test_vision_prompt_includes_block_when_enabled(self):
        self._enable_block()
        self._confirm("Daniel", "person", "protagonista")
        prompt = get_vision_prompt(project_id=self.project_id)
        self.assertIn(ANTI_BIAS_MARKER, prompt)

    def test_photo_vision_prompt_includes_block_exactly_once(self):
        """Regressao: get_photo_vision_prompt monta 'base' chamando get_vision_prompt
        internamente. Se o bloco fosse injetado nas duas funcoes, apareceria 2x no
        prompt final da foto -- confirmando que a injecao vive so em get_vision_prompt."""
        self._enable_block()
        self._confirm("Daniel", "person", "protagonista")
        prompt = get_photo_vision_prompt(project_id=self.project_id)
        self.assertEqual(prompt.count(ANTI_BIAS_MARKER), 1)

    def test_photo_vision_prompt_excludes_block_when_disabled(self):
        self._confirm("Daniel", "person", "protagonista")
        prompt = get_photo_vision_prompt(project_id=self.project_id)
        self.assertNotIn(ANTI_BIAS_MARKER, prompt)


if __name__ == "__main__":
    unittest.main()
