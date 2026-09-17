"""Testes de backend para miniaturas de alta nitidez (HQ), LQ sob demanda e momentos cruciais."""
import unittest
import tempfile
import sqlite3
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_video
from src.db.repositories.media import MediaRepository
from src.api.server import app
from src.media.ffmpeg import extract_thumbnail_frame
from src.services.ingest import IngestService


class TestVideoThumbnailQuality(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_thumb_hq_test_"))
        cls.original_db = CONFIG.DB_PATH
        cls.original_proxies = CONFIG.PROXIES_DIR
        cls.original_thumbnails = CONFIG.THUMBNAILS_DIR
        cls.original_originals = CONFIG.ORIGINALS_DIR

        CONFIG.DB_PATH = cls.test_dir / "test_thumb_hq.db"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        CONFIG.THUMBNAILS_DIR = CONFIG.PROXIES_DIR / "thumbnails"
        CONFIG.ORIGINALS_DIR = cls.test_dir / "originals"

        CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG.ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)

        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.PROXIES_DIR = cls.original_proxies
        CONFIG.THUMBNAILS_DIR = cls.original_thumbnails
        CONFIG.ORIGINALS_DIR = cls.original_originals

        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_extract_thumbnail_frame_lq_and_hq(self):
        """Verifica se extract_thumbnail_frame suporta os novos argumentos de largura e qualidade."""
        out_lq = CONFIG.THUMBNAILS_DIR / "sample_lq.jpg"
        out_hq = CONFIG.THUMBNAILS_DIR / "sample_hq.jpg"

        def fake_subprocess_run(cmd, *args, **kwargs):
            target_file = Path(cmd[-1])
            if any("640" in str(arg) for arg in cmd):
                img = Image.new("RGB", (640, 360), color=(100, 150, 200))
            else:
                img = Image.new("RGB", (160, 90), color=(100, 150, 200))
            img.save(target_file, "JPEG")
            return None

        dummy_video = self.test_dir / "dummy_sample.mp4"
        dummy_video.write_bytes(b"dummy video")

        with patch("subprocess.run", side_effect=fake_subprocess_run):
            # LQ
            ok_lq = extract_thumbnail_frame(dummy_video, 1.0, out_lq, width=160, quality=5)
            self.assertTrue(ok_lq)
            self.assertTrue(out_lq.exists())
            with Image.open(out_lq) as img:
                self.assertEqual(img.size, (160, 90))

            # HQ
            ok_hq = extract_thumbnail_frame(dummy_video, 1.0, out_hq, width=640, quality=2)
            self.assertTrue(ok_hq)
            self.assertTrue(out_hq.exists())
            with Image.open(out_hq) as img:
                self.assertEqual(img.size, (640, 360))

    def test_thumbnail_at_endpoint_low_and_hq(self):
        """Testa o endpoint GET /api/video/{id}/thumbnail-at com quality='low' e quality='hq'."""
        dummy_video = self.test_dir / "test_vid_endpoint.mp4"
        dummy_video.write_bytes(b"video payload")

        video_id = add_video(
            project_id=1,
            filename="test_vid_endpoint.mp4",
            filepath=str(dummy_video),
            file_hash="hash_test_hq_1",
            video_type="broll",
            duration=30.0
        )

        def fake_extract_thumbnail(video_path, timestamp, output_path, width=120, quality=5, proxy_fallback_path=None):
            w = 640 if width >= 400 else 160
            h = 360 if width >= 400 else 90
            img = Image.new("RGB", (w, h), color=(50, 80, 120))
            output_path.parent.mkdir(parents=True, exist_ok=True)
            img.save(output_path, "JPEG")
            return True

        with patch("src.media.ffmpeg.extract_thumbnail_frame", side_effect=fake_extract_thumbnail):
            # 1. Requisição LQ inicial (scrubbing rápido)
            resp_lq = self.client.get(f"/api/video/{video_id}/thumbnail-at?time=4.0&quality=low")
            self.assertEqual(resp_lq.status_code, 200)
            self.assertEqual(resp_lq.headers.get("x-thumbnail-quality"), "low")

            lq_file = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_0005.jpg"
            self.assertTrue(lq_file.exists())
            with Image.open(lq_file) as img:
                self.assertEqual(img.size, (160, 90))

            # 2. Requisição HQ progressiva (hover/repouso)
            resp_hq = self.client.get(f"/api/video/{video_id}/thumbnail-at?time=4.0&quality=hq")
            self.assertEqual(resp_hq.status_code, 200)
            self.assertEqual(resp_hq.headers.get("x-thumbnail-quality"), "hq")

            hq_file = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_0005_hq.jpg"
            self.assertTrue(hq_file.exists())
            with Image.open(hq_file) as img:
                self.assertEqual(img.size, (640, 360))

            # 3. Hit de cache para HQ (já existente)
            resp_hq_cache = self.client.get(f"/api/video/{video_id}/thumbnail-at?time=4.0&quality=hq")
            self.assertEqual(resp_hq_cache.status_code, 200)
            self.assertEqual(resp_hq_cache.headers.get("x-thumbnail-quality"), "hq")

    def test_pregenerate_crucial_thumbnails(self):
        """Testa IngestService.pregenerate_crucial_thumbnails gerando miniaturas HQ e LQ para instantes cruciais."""
        dummy_video = self.test_dir / "test_crucial_vid.mp4"
        dummy_video.write_bytes(b"crucial video content")

        video_id = add_video(
            project_id=1,
            filename="test_crucial_vid.mp4",
            filepath=str(dummy_video),
            file_hash="hash_crucial_1",
            video_type="interview",
            duration=60.0
        )

        crucial_moments = [3.0, 10.5]

        def fake_extract_thumbnail(video_path, timestamp, output_path, width=120, quality=5, proxy_fallback_path=None):
            w = 640 if width >= 400 else 160
            h = 360 if width >= 400 else 90
            img = Image.new("RGB", (w, h), color=(200, 100, 50))
            output_path.parent.mkdir(parents=True, exist_ok=True)
            img.save(output_path, "JPEG")
            return True

        with patch("src.media.ffmpeg.extract_thumbnail_frame", side_effect=fake_extract_thumbnail):
            IngestService.pregenerate_crucial_thumbnails(video_id, dummy_video, crucial_moments)

            # Instante 3.0 -> file_idx 4
            self.assertTrue((CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_0004_hq.jpg").exists())
            self.assertTrue((CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_0004.jpg").exists())

            # Instante 10.5 -> file_idx 12 (round(10.5) + 1)
            file_idx_10 = int(round(10.5)) + 1
            self.assertTrue((CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_{file_idx_10:04d}_hq.jpg").exists())
            self.assertTrue((CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_{file_idx_10:04d}.jpg").exists())

    def test_post_crucial_moments_triggers_pregeneration(self):
        """Verifica se POST /api/video/{id}/crucial-moments agenda a pré-geração HQ das miniaturas."""
        dummy_video = self.test_dir / "test_post_crucial.mp4"
        dummy_video.write_bytes(b"post crucial content")

        video_id = add_video(
            project_id=1,
            filename="test_post_crucial.mp4",
            filepath=str(dummy_video),
            file_hash="hash_post_crucial_1",
            video_type="broll",
            duration=50.0
        )

        with patch.object(IngestService, "pregenerate_crucial_thumbnails") as mock_pregen:
            resp = self.client.post(
                f"/api/video/{video_id}/crucial-moments",
                json={"action": "set", "moments": [2.0, 7.5]}
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data.get("crucial_moments"), [2.0, 7.5])

            import time
            time.sleep(0.2)
            self.assertTrue(mock_pregen.called)


if __name__ == "__main__":
    unittest.main()
