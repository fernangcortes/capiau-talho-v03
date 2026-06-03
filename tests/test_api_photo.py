"""Teste de API para os endpoints de fotos de set do CaIAu Talho."""
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_photo, get_connection
from src.api.server import app

class TestPhotoAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Pasta temporária para a execução do teste
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_api"
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        cls.original_proxies = CONFIG.PROXIES_DIR
        
        CONFIG.DB_PATH = cls.test_dir / "test_api.db"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        
        CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
        (CONFIG.PROXIES_DIR / "photos").mkdir(parents=True, exist_ok=True)
        
        init_db(CONFIG.DB_PATH)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.PROXIES_DIR = cls.original_proxies
        
        import shutil
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_list_photos(self):
        # Inserir foto de teste
        photo_id = add_photo(
            project_id=1,
            filename="foto_api_teste.jpg",
            filepath=str(self.test_dir / "foto_api_teste.jpg"),
            file_hash="dummy_hash_123",
            description="Foto de teste API",
            tags=["teste"]
        )
        
        response = self.client.get("/api/photos?project_id=1")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(len(data) > 0)
        # Filtra a foto criada por ID
        created_photo = next((p for p in data if p['id'] == photo_id), None)
        self.assertIsNotNone(created_photo)
        self.assertEqual(created_photo['filename'], "foto_api_teste.jpg")

    def test_delete_photo(self):
        # Inserir foto para deleção
        photo_id = add_photo(
            project_id=1,
            filename="foto_deletar.jpg",
            filepath=str(self.test_dir / "foto_deletar.jpg"),
            file_hash="delete_hash_123",
            description="Foto a deletar",
            tags=[]
        )
        # Criar arquivo proxy simulado
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
        with open(proxy_path, "wb") as f:
            f.write(b"SIMULATED WEBP")
        self.assertTrue(proxy_path.exists())

        response = self.client.delete(f"/api/photo/{photo_id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(proxy_path.exists())

        # Verificar no banco
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM photo WHERE id = ?", (photo_id,))
            row = cursor.fetchone()
            self.assertIsNone(row)
        finally:
            conn.close()

if __name__ == "__main__":
    unittest.main()
