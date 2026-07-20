"""Testes do E2.C3 — Correções humanas viram few-shot no prompt de triagem.

Ciclo completo: PATCH /category (E2.C2) grava triage_feedback -> os prompts de
triagem (vídeo) e de visão de foto passam a citar as correções como exemplos.
"""
import unittest
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project, add_video, add_photo, get_connection
from src.api.server import app
from src.nlp.prompt_templates import get_triage_prompt, get_photo_vision_prompt


class TestTriageFewShot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_fewshot_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_fewshot.db"
        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)
        cls.proj = add_project("Fewshot", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _fix_video(self, name, wrong, right, note=""):
        vid = add_video(self.proj, name, f"/x/{name}", f"h_{name}", "broll", 30.0)
        conn = get_connection()
        try:
            conn.execute("UPDATE video SET category=?, category_confidence=0.6, title=? WHERE id=?",
                         (wrong, name.replace(".mp4", ""), vid))
            conn.commit()
        finally:
            conn.close()
        resp = self.client.patch(f"/api/video/{vid}/category", json={"category": right, "note": note})
        self.assertEqual(resp.status_code, 200)
        return vid

    def test_corrections_appear_in_both_prompts(self):
        self._fix_video("conversa_cozinha.mp4", "cotidiano", "processo", "discutem o plano de filmagem")

        prompt = get_triage_prompt(filename="novo.mp4", project_id=self.proj)
        self.assertIn("CORREÇÕES RECENTES DO USUÁRIO", prompt)
        self.assertIn("conversa_cozinha", prompt)
        self.assertIn("'cotidiano'", prompt)
        self.assertIn("'processo'", prompt)
        self.assertIn("discutem o plano de filmagem", prompt)

        photo_prompt = get_photo_vision_prompt(project_id=self.proj)
        self.assertIn("CORREÇÕES RECENTES DO USUÁRIO", photo_prompt)
        self.assertIn("conversa_cozinha", photo_prompt)

    def test_photo_corrections_and_no_category_case(self):
        pid = add_photo(self.proj, "doc_mesa.jpg", "/x/doc_mesa.jpg", "h_doc", description="Papel na mesa")
        # foto analisada mas sem categoria (triagem falhou) -> wrong = NULL
        resp = self.client.patch(f"/api/photo/{pid}/category", json={"category": "documento"})
        self.assertEqual(resp.status_code, 200)

        prompt = get_triage_prompt(project_id=self.proj)
        self.assertIn("doc_mesa.jpg", prompt)
        self.assertIn("sem categoria", prompt)  # wrong_category NULL vira texto legivel
        self.assertIn("'documento'", prompt)

    def test_limit_respected_most_recent_first(self):
        for i in range(8):
            self._fix_video(f"serie_{i}.mp4", "cotidiano", "processo")
        prompt = get_triage_prompt(project_id=self.proj)
        # default = 6 exemplos: os 2 mais antigos da serie ficam de fora
        self.assertIn("serie_7", prompt)
        self.assertIn("serie_2", prompt)
        self.assertNotIn("serie_1", prompt)
        self.assertNotIn("serie_0", prompt)

    def _set_project_override(self, key, value_json):
        conn = get_connection()
        try:
            if value_json is None:
                conn.execute("DELETE FROM project_setting WHERE project_id=? AND key=?", (self.proj, key))
            else:
                conn.execute(
                    "INSERT INTO project_setting (project_id, key, value_json) VALUES (?, ?, ?) "
                    "ON CONFLICT(project_id, key) DO UPDATE SET value_json=excluded.value_json",
                    (self.proj, key, value_json))
            conn.commit()
        finally:
            conn.close()
        from src.services.settings_service import SettingsService
        SettingsService.invalidate(self.proj)

    def test_setting_zero_disables_block(self):
        self._set_project_override("triage.feedback_examples", "0")
        try:
            prompt = get_triage_prompt(project_id=self.proj)
            self.assertNotIn("CORREÇÕES RECENTES DO USUÁRIO", prompt)
        finally:
            self._set_project_override("triage.feedback_examples", None)

    def test_project_without_corrections_has_no_block(self):
        other = add_project("Sem correções", "", "")
        prompt = get_triage_prompt(project_id=other)
        self.assertNotIn("CORREÇÕES RECENTES DO USUÁRIO", prompt)


if __name__ == "__main__":
    unittest.main()
