"""Testes do E2.C2 — Fila de revisao de triagem e correcao humana de categoria.

Cobre:
- GET /api/project/{id}/triage/review respeita triage.min_confidence e exclui entrevistas
- PATCH /api/video/{id}/category persiste, grava confianca 1.0 e re-deriva video_type
- PATCH /api/photo/{id}/category propaga para o grupo de rajada inteiro
- Correcoes sao registradas em triage_feedback (materia-prima do few-shot E2.C3)
- Categoria invalida e mídia inexistente sao rejeitadas
"""
import unittest
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_video, add_photo, get_connection
from src.api.server import app


def _set_video(video_id, **cols):
    conn = get_connection()
    try:
        sets = ", ".join([f"{k} = ?" for k in cols])
        conn.execute(f"UPDATE video SET {sets} WHERE id = ?", (*cols.values(), video_id))
        conn.commit()
    finally:
        conn.close()


def _set_photo(photo_id, **cols):
    conn = get_connection()
    try:
        sets = ", ".join([f"{k} = ?" for k in cols])
        conn.execute(f"UPDATE photo SET {sets} WHERE id = ?", (*cols.values(), photo_id))
        conn.commit()
    finally:
        conn.close()


def _get_row(table, row_id):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


class TestTriageReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_triage_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_triage.db"
        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    # ── Fila de revisao ─────────────────────────────────────────────────────

    def test_review_queue_thresholds_and_interviews(self):
        # Confianca baixa -> entra na fila
        v_low = add_video(1, "low_conf.mp4", "/x/low_conf.mp4", "h_low", "broll", 30.0)
        _set_video(v_low, category="processo", category_confidence=0.4,
                   description="Equipe montando o set")

        # Confianca alta -> fora da fila
        v_high = add_video(1, "high_conf.mp4", "/x/high_conf.mp4", "h_high", "broll", 30.0)
        _set_video(v_high, category="obra", category_confidence=0.95,
                   description="Take da cena 12")

        # Analisado sem categoria (triagem falhou) -> entra na fila
        v_nocat = add_video(1, "nocat.mp4", "/x/nocat.mp4", "h_nocat", "broll", 30.0)
        _set_video(v_nocat, description="Descricao gerada mas sem categoria")

        # Entrevista sem categoria -> fora da fila (nao passa por triagem de visao)
        v_interview = add_video(1, "entrevista.mov", "/x/entrevista.mov", "h_int", "interview", 600.0)
        _set_video(v_interview, description="Entrevista com fulano")

        # Video nem analisado ainda -> fora da fila
        add_video(1, "pendente.mp4", "/x/pendente.mp4", "h_pend", "broll", 30.0)

        resp = self.client.get("/api/project/1/triage/review")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        ids = {v["id"] for v in data["videos"]}
        self.assertIn(v_low, ids)
        self.assertIn(v_nocat, ids)
        self.assertNotIn(v_high, ids)
        self.assertNotIn(v_interview, ids)
        # Default do registry
        self.assertAlmostEqual(data["threshold"], 0.55)

    def test_review_queue_photos(self):
        p_low = add_photo(1, "p_low.jpg", "/x/p_low.jpg", "ph_low", description="Foto do set")
        _set_photo(p_low, category="cotidiano", category_confidence=0.3)

        p_high = add_photo(1, "p_high.jpg", "/x/p_high.jpg", "ph_high", description="Foto da cena")
        _set_photo(p_high, category="obra", category_confidence=0.9)

        resp = self.client.get("/api/project/1/triage/review")
        self.assertEqual(resp.status_code, 200)
        ids = {p["id"] for p in resp.json()["photos"]}
        self.assertIn(p_low, ids)
        self.assertNotIn(p_high, ids)

    # ── PATCH video ─────────────────────────────────────────────────────────

    def test_patch_video_category_persists_and_derives_type(self):
        vid = add_video(1, "corrigir.mp4", "/x/corrigir.mp4", "h_fix", "broll", 30.0)
        _set_video(vid, category="cotidiano", category_confidence=0.5,
                   description="Na verdade e uma fala dirigida a camera")

        resp = self.client.patch(f"/api/video/{vid}/category",
                                 json={"category": "depoimento", "note": "e entrevista"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["category"], "depoimento")
        self.assertEqual(body["video_type"], "interview")
        self.assertEqual(body["previous_category"], "cotidiano")

        row = _get_row("video", vid)
        self.assertEqual(row["category"], "depoimento")
        self.assertEqual(row["video_type"], "interview")
        self.assertEqual(row["category_confidence"], 1.0)

        # Correcao registrada para o few-shot (E2.C3)
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM triage_feedback WHERE media_kind='video' AND media_id=?", (vid,))
            fb = cur.fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(fb)
        self.assertEqual(fb["wrong_category"], "cotidiano")
        self.assertEqual(fb["right_category"], "depoimento")
        self.assertEqual(fb["note"], "e entrevista")

    def test_patch_video_same_category_confirms_without_feedback(self):
        vid = add_video(1, "confirmar.mp4", "/x/confirmar.mp4", "h_conf", "broll", 30.0)
        _set_video(vid, category="processo", category_confidence=0.5, description="Set sendo montado")

        resp = self.client.patch(f"/api/video/{vid}/category", json={"category": "processo"})
        self.assertEqual(resp.status_code, 200)

        row = _get_row("video", vid)
        self.assertEqual(row["category_confidence"], 1.0)  # confirmacao humana vale 1.0

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) c FROM triage_feedback WHERE media_kind='video' AND media_id=?", (vid,))
            count = cur.fetchone()["c"]
        finally:
            conn.close()
        self.assertEqual(count, 0)  # confirmar nao e corrigir: sem few-shot

    def test_patch_video_invalid_category_and_missing_video(self):
        vid = add_video(1, "invalido.mp4", "/x/invalido.mp4", "h_inv", "broll", 30.0)
        resp = self.client.patch(f"/api/video/{vid}/category", json={"category": "making_of"})
        self.assertEqual(resp.status_code, 400)

        resp = self.client.patch("/api/video/999999/category", json={"category": "obra"})
        self.assertEqual(resp.status_code, 404)

    # ── PATCH foto + rajada ─────────────────────────────────────────────────

    def test_patch_photo_propagates_to_burst_group(self):
        leader = add_photo(1, "burst1.jpg", "/x/burst1.jpg", "b1", description="Rajada frame 1")
        m2 = add_photo(1, "burst2.jpg", "/x/burst2.jpg", "b2", description="Rajada frame 2")
        m3 = add_photo(1, "burst3.jpg", "/x/burst3.jpg", "b3", description="Rajada frame 3")
        solo = add_photo(1, "solo.jpg", "/x/solo.jpg", "s1", description="Foto avulsa")
        for pid in (leader, m2, m3):
            _set_photo(pid, category="cotidiano", category_confidence=0.6, burst_group_id=leader)
        _set_photo(solo, category="cotidiano", category_confidence=0.6)

        # Corrigir um MEMBRO deve propagar ao grupo inteiro (mesma cena por construcao)
        resp = self.client.patch(f"/api/photo/{m2}/category", json={"category": "processo"})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["updated_count"], 3)

        for pid in (leader, m2, m3):
            row = _get_row("photo", pid)
            self.assertEqual(row["category"], "processo")
            self.assertEqual(row["category_confidence"], 1.0)
        # Foto fora do grupo nao muda
        self.assertEqual(_get_row("photo", solo)["category"], "cotidiano")

    def test_patch_photo_solo_updates_one(self):
        pid = add_photo(1, "uma.jpg", "/x/uma.jpg", "u1", description="Foto")
        _set_photo(pid, category="pessoal", category_confidence=0.5)

        resp = self.client.patch(f"/api/photo/{pid}/category", json={"category": "obra"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["updated_count"], 1)
        row = _get_row("photo", pid)
        self.assertEqual(row["category"], "obra")

    def test_patch_photo_invalid_category_and_missing_photo(self):
        pid = add_photo(1, "inv.jpg", "/x/inv.jpg", "i1", description="Foto")
        resp = self.client.patch(f"/api/photo/{pid}/category", json={"category": "bastidores"})
        self.assertEqual(resp.status_code, 400)

        resp = self.client.patch("/api/photo/999999/category", json={"category": "obra"})
        self.assertEqual(resp.status_code, 404)

    # ── Fila reflete correcao ───────────────────────────────────────────────

    def test_corrected_media_leaves_review_queue(self):
        vid = add_video(1, "sai_da_fila.mp4", "/x/sai.mp4", "h_out", "broll", 30.0)
        _set_video(vid, category="tecnico", category_confidence=0.2, description="Teste de camera")

        ids = {v["id"] for v in self.client.get("/api/project/1/triage/review").json()["videos"]}
        self.assertIn(vid, ids)

        self.client.patch(f"/api/video/{vid}/category", json={"category": "tecnico"})

        ids = {v["id"] for v in self.client.get("/api/project/1/triage/review").json()["videos"]}
        self.assertNotIn(vid, ids)


if __name__ == "__main__":
    unittest.main()
