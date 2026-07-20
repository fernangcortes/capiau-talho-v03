"""Testes do E2.D1 — Escala de plano por zero-shot CLIP.

- Contrato do classificador com CLIP REAL sobre fixtures sintéticas
- Migração das colunas shot_scale em media_segment
- Indexação com faceta usando Qdrant em memória (sem tocar no storage real)
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "shot_scale"


def _make_fixtures():
    """Duas imagens com enquadramentos inequívocos: um 'rosto' preenchendo o quadro
    (proporções de close) e uma 'paisagem' com horizonte e elementos pequenos."""
    from PIL import Image, ImageDraw
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    # Paisagem ampla: céu, chão, casinhas minúsculas na linha do horizonte
    wide = Image.new("RGB", (640, 360), (135, 190, 235))       # céu
    d = ImageDraw.Draw(wide)
    d.rectangle([0, 250, 640, 360], fill=(90, 140, 70))        # campo
    for x in range(40, 640, 90):                                # construções pequenas
        d.rectangle([x, 235, x + 24, 252], fill=(120, 100, 90))
    wide.save(FIXTURE_DIR / "wide_landscape.jpg")

    # Quadro cheio de "rosto": elipse cor de pele ocupando ~80% da altura
    face = Image.new("RGB", (640, 360), (40, 35, 35))
    d = ImageDraw.Draw(face)
    d.ellipse([200, 20, 440, 340], fill=(210, 165, 140))       # cabeça
    d.ellipse([255, 120, 285, 155], fill=(50, 40, 40))         # olho
    d.ellipse([355, 120, 385, 155], fill=(50, 40, 40))         # olho
    d.arc([270, 200, 370, 280], 20, 160, fill=(120, 60, 60), width=8)  # boca
    face.save(FIXTURE_DIR / "face_closeup.jpg")


class TestShotScaleClassifier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _make_fixtures()

    def test_classifier_contract_and_sanity(self):
        from sentence_transformers import SentenceTransformer
        from src.vision.shot_scale import ShotScaleClassifier, SHOT_SCALE_LABELS
        from PIL import Image

        enc = SentenceTransformer("clip-ViT-B-32", device="cpu")
        clf = ShotScaleClassifier.get_instance()

        with Image.open(FIXTURE_DIR / "wide_landscape.jpg") as im:
            wide_vec = enc.encode(im.convert("RGB"))
        with Image.open(FIXTURE_DIR / "face_closeup.jpg") as im:
            face_vec = enc.encode(im.convert("RGB"))

        wide_label, wide_score = clf.classify(np.asarray(wide_vec))
        face_label, face_score = clf.classify(np.asarray(face_vec))

        # Contrato: rótulo do vocabulário fechado + score plausível
        self.assertIn(wide_label, SHOT_SCALE_LABELS)
        self.assertIn(face_label, SHOT_SCALE_LABELS)
        self.assertGreater(wide_score, 0.0)
        self.assertLessEqual(wide_score, 1.0)

        # Sanidade: paisagem ampla NUNCA deve ser close/detalhe;
        # quadro dominado por um rosto NUNCA deve ser plano geral/aéreo.
        self.assertNotIn(wide_label, ("close", "detalhe"))
        self.assertNotIn(face_label, ("plano_geral", "aereo"))

        # Batch é consistente com a classificação individual
        batch = clf.classify_batch(np.vstack([wide_vec, face_vec]))
        self.assertEqual(batch[0][0], wide_label)
        self.assertEqual(batch[1][0], face_label)


class TestShotScaleMigrationAndIndexing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from src.config import CONFIG
        from src.db.schema import init_db
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_scale_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_scale.db"
        init_db(CONFIG.DB_PATH)
        _make_fixtures()

    @classmethod
    def tearDownClass(cls):
        from src.config import CONFIG
        CONFIG.DB_PATH = cls.original_db
        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_migration_added_columns(self):
        import sqlite3
        from src.config import CONFIG
        con = sqlite3.connect(CONFIG.DB_PATH)
        cols = [r[1] for r in con.execute("PRAGMA table_info(media_segment)")]
        con.close()
        self.assertIn("shot_scale", cols)
        self.assertIn("shot_scale_score", cols)

    def test_index_keyframe_writes_facet_to_memory_qdrant(self):
        """index_video_keyframe classifica e grava shot_scale no payload,
        usando um Qdrant EM MEMÓRIA (nunca o storage real — lock de processo único)."""
        from qdrant_client import QdrantClient
        from src.search.image_semantic import ImageSearch
        from src.search.semantic import SemanticSearch
        from src.vision.shot_scale import SHOT_SCALE_LABELS

        class _FakeSemantic:
            client = QdrantClient(":memory:")

        with patch.object(SemanticSearch, "get_instance", return_value=_FakeSemantic()):
            original = ImageSearch._instance
            ImageSearch._instance = None
            try:
                engine = ImageSearch.get_instance()
                label = engine.index_video_keyframe(
                    project_id=1, video_id=42,
                    frame_path=FIXTURE_DIR / "wide_landscape.jpg",
                    start_time=10.0, end_time=14.0, segment_id=7,
                )
                self.assertIn(label, SHOT_SCALE_LABELS)  # facetado, não só "indexed"

                points, _ = engine.client.scroll(engine.collection_name, with_payload=True, limit=10)
                self.assertEqual(len(points), 1)
                payload = points[0].payload
                self.assertEqual(payload["video_id"], 42)
                self.assertEqual(payload["segment_id"], 7)
                self.assertIn(payload.get("shot_scale"), SHOT_SCALE_LABELS)

                ok = engine.index_photo(1, 99, FIXTURE_DIR / "face_closeup.jpg")
                self.assertTrue(ok)
                points, _ = engine.client.scroll(engine.collection_name, with_payload=True, limit=10)
                photo_payloads = [p.payload for p in points if p.payload.get("photo_id") == 99]
                self.assertEqual(len(photo_payloads), 1)
                self.assertIn(photo_payloads[0].get("shot_scale"), SHOT_SCALE_LABELS)
            finally:
                ImageSearch._instance = original


if __name__ == "__main__":
    unittest.main()
