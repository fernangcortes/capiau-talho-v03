"""Testes do E2.D2 — Paleta e temperatura de cor (OpenCV puro, sem API).

Imagens sintéticas com temperatura inequívoca validam a classificação;
a migração das colunas em photo é conferida em banco novo.
"""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))


def _bgr(rgb):
    return (rgb[2], rgb[1], rgb[0])


def _flat_image(rgb, w=320, h=180):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = _bgr(rgb)
    return img


class TestPaletteClassification(unittest.TestCase):
    def test_sunset_is_warm(self):
        from src.vision.palette import classify_palette
        img = _flat_image((235, 120, 40))          # laranja de entardecer
        img[:60, :] = _bgr((250, 200, 90))         # céu dourado
        out = classify_palette(img)
        self.assertEqual(out["palette_temp"], "quente")
        self.assertEqual(len(out["palette_hex"]), 4)
        self.assertTrue(all(h.startswith("#") and len(h) == 7 for h in out["palette_hex"]))

    def test_blue_scene_is_cold(self):
        from src.vision.palette import classify_palette
        img = _flat_image((30, 80, 200))           # azul profundo
        img[100:, :] = _bgr((90, 150, 235))        # azul claro
        out = classify_palette(img)
        self.assertEqual(out["palette_temp"], "frio")

    def test_gray_scene_is_neutral(self):
        from src.vision.palette import classify_palette
        img = _flat_image((128, 128, 128))
        img[:90, :] = _bgr((80, 80, 82))
        out = classify_palette(img)
        self.assertEqual(out["palette_temp"], "neutro")

    def test_file_helper_handles_missing_and_accented_paths(self):
        from src.vision.palette import classify_palette_file
        self.assertIsNone(classify_palette_file(Path("nao_existe_ção.webp")))

        import cv2
        tmp = Path(tempfile.mkdtemp(prefix="capiau_paleta_ção_"))
        target = tmp / "fogo.png"
        ok, buf = cv2.imencode(".png", _flat_image((240, 100, 30)))
        self.assertTrue(ok)
        target.write_bytes(buf.tobytes())
        out = classify_palette_file(target)
        self.assertIsNotNone(out)
        self.assertEqual(out["palette_temp"], "quente")


class TestPaletteMigration(unittest.TestCase):
    def test_photo_columns_added(self):
        import sqlite3
        from src.config import CONFIG
        from src.db.schema import init_db
        test_dir = Path(tempfile.mkdtemp(prefix="capiau_paleta_db_"))
        original = CONFIG.DB_PATH
        try:
            CONFIG.DB_PATH = test_dir / "t.db"
            init_db(CONFIG.DB_PATH)
            con = sqlite3.connect(CONFIG.DB_PATH)
            cols = [r[1] for r in con.execute("PRAGMA table_info(photo)")]
            con.close()
            self.assertIn("palette_temp", cols)
            self.assertIn("palette_hex", cols)
        finally:
            CONFIG.DB_PATH = original
            import shutil
            shutil.rmtree(test_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
