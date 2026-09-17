"""Teste de API para os endpoints do Modo Galeria Clean (Momentos Cruciais, Duração do Hover e Rotação)."""
import unittest
import tempfile
import shutil
from pathlib import Path
from fastapi.testclient import TestClient
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_video, add_photo
from src.api.server import app

class TestGalleryModeAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_gallery_api_"))
        cls.original_db = CONFIG.DB_PATH
        cls.original_proxies = CONFIG.PROXIES_DIR
        cls.original_thumbs = CONFIG.THUMBNAILS_DIR

        CONFIG.DB_PATH = cls.test_dir / "test_gallery.db"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        CONFIG.THUMBNAILS_DIR = cls.test_dir / "thumbnails"

        CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
        (CONFIG.PROXIES_DIR / "photos").mkdir(parents=True, exist_ok=True)

        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.PROXIES_DIR = cls.original_proxies
        CONFIG.THUMBNAILS_DIR = cls.original_thumbs
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_crucial_moments_lifecycle(self):
        vid_id = add_video(
            project_id=1,
            filename="gallery_test_vid.mp4",
            filepath=str(self.test_dir / "gallery_test_vid.mp4"),
            file_hash="hash_gallery_1",
            video_type="broll",
            duration=45.0,
            fps=30.0,
            resolution="1920x1080",
            codec="h264"
        )

        # 1. Adiciona momento crucial via toggle
        resp1 = self.client.post(
            f"/api/video/{vid_id}/crucial-moments",
            json={"action": "toggle", "timestamp": 12.5}
        )
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(data1["status"], "success")
        self.assertIn(12.5, data1["crucial_moments"])

        # 2. Adiciona outro momento via toggle
        resp2 = self.client.post(
            f"/api/video/{vid_id}/crucial-moments",
            json={"action": "toggle", "timestamp": 25.0}
        )
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertIn(12.5, data2["crucial_moments"])
        self.assertIn(25.0, data2["crucial_moments"])

        # 3. Toggle no mesmo timestamp (com tolerância <= 0.6s) remove o momento
        resp3 = self.client.post(
            f"/api/video/{vid_id}/crucial-moments",
            json={"action": "toggle", "timestamp": 12.6}
        )
        self.assertEqual(resp3.status_code, 200)
        data3 = resp3.json()
        self.assertNotIn(12.5, data3["crucial_moments"])
        self.assertIn(25.0, data3["crucial_moments"])

        # 4. Set explícito de array de momentos
        resp4 = self.client.post(
            f"/api/video/{vid_id}/crucial-moments",
            json={"action": "set", "moments": [3.0, 7.5, 18.2]}
        )
        self.assertEqual(resp4.status_code, 200)
        data4 = resp4.json()
        self.assertEqual(data4["crucial_moments"], [3.0, 7.5, 18.2])

        # 5. List videos reflete os momentos cruciais desserializados
        list_resp = self.client.get("/api/videos?project_id=1")
        self.assertEqual(list_resp.status_code, 200)
        vids = list_resp.json()
        v = next((x for x in vids if x["id"] == vid_id), None)
        self.assertIsNotNone(v)
        self.assertEqual(v["crucial_moments"], [3.0, 7.5, 18.2])

    def test_hover_duration_lifecycle(self):
        vid_id = add_video(
            project_id=1,
            filename="hover_duration_test.mp4",
            filepath=str(self.test_dir / "hover_duration_test.mp4"),
            file_hash="hash_gallery_2",
            duration=30.0
        )

        resp = self.client.post(
            f"/api/video/{vid_id}/hover-duration",
            json={"hover_loop_duration": 5.5}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["hover_loop_duration"], 5.5)

        # Verifica persistência no banco
        list_resp = self.client.get("/api/videos?project_id=1")
        vids = list_resp.json()
        v = next((x for x in vids if x["id"] == vid_id), None)
        self.assertEqual(v["hover_loop_duration"], 5.5)

    def test_media_rotation_lifecycle(self):
        vid_id = add_video(
            project_id=1,
            filename="rotation_vid.mp4",
            filepath=str(self.test_dir / "rotation_vid.mp4"),
            file_hash="hash_gallery_3"
        )
        photo_id = add_photo(
            project_id=1,
            filename="rotation_photo.jpg",
            filepath=str(self.test_dir / "rotation_photo.jpg"),
            file_hash="hash_gallery_4"
        )

        # Gira vídeo +90 graus -> 90
        r1 = self.client.post(f"/api/media/video/{vid_id}/rotate", json={"rotation_delta": 90})
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["rotation"], 90)

        # Gira vídeo mais +90 graus -> 180
        r2 = self.client.post(f"/api/media/video/{vid_id}/rotate", json={"rotation_delta": 90})
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["rotation"], 180)

        # Define ângulo absoluto no vídeo -> 270
        r3 = self.client.post(f"/api/media/video/{vid_id}/rotate", json={"rotation": 270})
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json()["rotation"], 270)

        # Gira foto +90 graus -> 90
        rp1 = self.client.post(f"/api/media/photo/{photo_id}/rotate", json={"rotation_delta": 90})
        self.assertEqual(rp1.status_code, 200)
        self.assertEqual(rp1.json()["rotation"], 90)

        # Gira foto 360 -> normaliza para 0
        rp2 = self.client.post(f"/api/media/photo/{photo_id}/rotate", json={"rotation": 360})
        self.assertEqual(rp2.status_code, 200)
        self.assertEqual(rp2.json()["rotation"], 0)

    def test_gallery_zoom_and_aspect_ratio_contract(self):
        """Valida que o CSS e o JS mantêm a proporção nativa fiel no zoom máximo sem corte destrutivo."""
        css_path = Path("src/ui/styles.css")
        js_path = Path("src/ui/js/library.js")
        self.assertTrue(css_path.exists())
        self.assertTrue(js_path.exists())

        css_content = css_path.read_text(encoding="utf-8")
        js_content = js_path.read_text(encoding="utf-8")

        # 1. Regras do CSS
        # Em zoom máximo (.zoom-xl), item expande ocupando 100% da linha colado na margem direita
        self.assertIn(".zoom-xl .gallery-item", css_content)
        self.assertIn("min-width: 100% !important;", css_content)
        self.assertIn("width: 100% !important;", css_content)
        # aspect-ratio e height auto para manter proporção fiel ao esticar horizontalmente
        self.assertIn("aspect-ratio: var(--aspect, 1.777)", css_content)
        self.assertIn("height: auto;", css_content)
        # object-fit: contain no zoom máximo para prevenir cortes verticais/laterais
        self.assertIn("object-fit: contain !important;", css_content)
        # flex-grow ponderado por aspect e flex-basis calculado por aspect no estado normal
        self.assertIn("flex-grow: calc(var(--aspect, 1.777) * 100);", css_content)
        self.assertIn("flex-basis: calc(var(--gallery-item-height, 110px) * var(--aspect, 1.777));", css_content)

        # 2. Manipuladores no JS
        # O slider de zoom deve permitir até 300px no gallery-item-height
        self.assertIn('"--gallery-item-height", `${Math.max(60, Math.min(300, numericVal))}px`)', js_content)
        self.assertIn('"--gallery-item-height", `${Math.max(60, Math.min(300, savedZoom))}px`)', js_content)
        # O cálculo do aspect ratio deve considerar _naturalAspect, resolução e rotação
        self.assertIn("let aspect = item._naturalAspect || (isVideo ? (16 / 9) : (4 / 3));", js_content)
        self.assertIn("thumbImg.addEventListener(\"load\",", js_content)

