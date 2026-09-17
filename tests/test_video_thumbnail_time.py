"""Testes de backend para thumbnail_time e hover play na galeria clean."""
import unittest
import tempfile
import sqlite3
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_video
from src.db.repositories.media import MediaRepository
from src.api.server import app

class TestVideoThumbnailTime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_thumb_test_"))
        cls.original_db = CONFIG.DB_PATH
        cls.original_proxies = CONFIG.PROXIES_DIR
        cls.original_thumbnails = CONFIG.THUMBNAILS_DIR

        CONFIG.DB_PATH = cls.test_dir / "test_thumb.db"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        CONFIG.THUMBNAILS_DIR = CONFIG.PROXIES_DIR / "thumbnails"

        CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)

        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.PROXIES_DIR = cls.original_proxies
        CONFIG.THUMBNAILS_DIR = cls.original_thumbnails

        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_schema_has_thumbnail_time_column(self):
        """Verifica se a tabela video possui a coluna thumbnail_time."""
        conn = sqlite3.connect(CONFIG.DB_PATH)
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(video)")
        cols = [row[1] for row in cursor.fetchall()]
        conn.close()
        self.assertIn("thumbnail_time", cols)

    def test_media_repository_set_thumbnail_time(self):
        """Testa gravação e leitura do thumbnail_time no MediaRepository."""
        conn = sqlite3.connect(CONFIG.DB_PATH)
        conn.row_factory = sqlite3.Row

        video_id = add_video(
            project_id=1,
            filename="video_repo_test.mp4",
            filepath=str(self.test_dir / "video_repo_test.mp4"),
            file_hash="hash_repo_test_1",
            video_type="broll",
            duration=120.0
        )

        # Inicialmente deve ser None
        v = MediaRepository.get_video(conn, video_id)
        self.assertIsNone(v.get("thumbnail_time"))

        # Atualiza para 42.5 segundos
        MediaRepository.set_thumbnail_time(conn, video_id, 42.5)
        conn.commit()

        v_updated = MediaRepository.get_video(conn, video_id)
        self.assertEqual(v_updated.get("thumbnail_time"), 42.5)
        conn.close()

    def test_list_videos_returns_thumbnail_time(self):
        """Verifica se GET /api/videos retorna o campo thumbnail_time."""
        conn = sqlite3.connect(CONFIG.DB_PATH)
        video_id = add_video(
            project_id=1,
            filename="video_list_test.mp4",
            filepath=str(self.test_dir / "video_list_test.mp4"),
            file_hash="hash_list_test_2",
            video_type="interview",
            duration=60.0
        )
        MediaRepository.set_thumbnail_time(conn, video_id, 15.75)
        conn.commit()
        conn.close()

        response = self.client.get("/api/videos?project_id=1")
        self.assertEqual(response.status_code, 200)
        videos = response.json()
        target = next((v for v in videos if v["id"] == video_id), None)
        self.assertIsNotNone(target)
        self.assertEqual(target.get("thumbnail_time"), 15.75)

    def test_post_video_thumbnail_endpoint(self):
        """Testa se POST /api/video/{id}/thumbnail persiste thumbnail_time no banco."""
        dummy_video_path = self.test_dir / "test_endpoint_vid.mp4"
        dummy_video_path.write_bytes(b"dummy video content")

        video_id = add_video(
            project_id=1,
            filename="test_endpoint_vid.mp4",
            filepath=str(dummy_video_path),
            file_hash="hash_endpoint_test_3",
            video_type="broll",
            duration=30.0
        )

        # Mock de extração de frame para simular geração com sucesso do thumbnail
        def fake_extract_frame(video_path, timestamp, thumb_path, proxy_fallback_path=None):
            thumb_path.write_bytes(b"dummy jpeg thumb")
            return True

        with patch("src.media.ffmpeg.extract_frame", side_effect=fake_extract_frame):
            response = self.client.post(f"/api/video/{video_id}/thumbnail?timestamp=8.5")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data.get("status"), "success")
            self.assertEqual(data.get("thumbnail_time"), 8.5)

        # Verifica no banco se foi gravado
        conn = sqlite3.connect(CONFIG.DB_PATH)
        conn.row_factory = sqlite3.Row
        v = MediaRepository.get_video(conn, video_id)
        conn.close()
        self.assertEqual(v.get("thumbnail_time"), 8.5)

if __name__ == "__main__":
    unittest.main()
