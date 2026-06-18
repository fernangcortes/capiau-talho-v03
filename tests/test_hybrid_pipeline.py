"""Teste de integração para o pipeline de Ingestão e Proxying do CaIAu Talho."""
import unittest
import os
import shutil
import time
from pathlib import Path
from unittest.mock import patch, MagicMock
from PIL import Image

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import get_connection
from src.ingest.watcher import ingest_file, generate_photo_proxy

class TestIngestPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Pasta de testes dedicada - limpa se já existir para evitar banco sujo
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_ingest"
        if cls.test_dir.exists():
            shutil.rmtree(cls.test_dir, ignore_errors=True)
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        cls.original_originals = CONFIG.ORIGINALS_DIR
        cls.original_proxies = CONFIG.PROXIES_DIR
        
        CONFIG.DB_PATH = cls.test_dir / "test_ingest.db"
        CONFIG.ORIGINALS_DIR = cls.test_dir / "originals"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        
        # Garantir a criação das subpastas
        CONFIG.ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG.PROXIES_DIR.mkdir(parents=True, exist_ok=True)
        (CONFIG.PROXIES_DIR / "photos").mkdir(parents=True, exist_ok=True)
        
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.ORIGINALS_DIR = cls.original_originals
        CONFIG.PROXIES_DIR = cls.original_proxies
        
        # Limpar arquivos de teste
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    @patch('src.services.ingest.generate_video_proxy', return_value=True)
    def test_video_ingest(self, mock_proxy):
        print("\n[TEST] 1. Criando arquivo de vídeo simulado...")
        dummy_file = self.test_dir / "depoimento_ator.mp4"
        with open(dummy_file, "wb") as f:
            f.write(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")
            
        print("[TEST] 2. Ingerindo vídeo simulado (Mocking FFmpeg Proxy)...")
        success = ingest_file(dummy_file, project_id=1)
        self.assertTrue(success, "A ingestão do vídeo simulado deveria ser bem-sucedida.")
        
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM video WHERE filename = ?", ("depoimento_ator.mp4",))
            row = cursor.fetchone()
            
            self.assertIsNotNone(row, "O vídeo deveria estar catalogado na tabela do SQLite.")
            self.assertEqual(row['video_type'], 'interview', "O tipo do vídeo deveria ser 'interview' por causa do nome.")
            print(f"  Vídeo catalogado com Sucesso: {row['filename']} (Hash: {row['hash']})")
        finally:
            conn.close()

    def test_photo_ingest_jpg(self):
        print("\n[TEST] 3. Criando foto JPG simulada...")
        dummy_jpg = self.test_dir / "foto_set_teste.jpg"
        img = Image.new('RGB', (2000, 1500), color='blue')
        img.save(dummy_jpg, 'JPEG')
        
        print("[TEST] 4. Ingerindo foto JPG...")
        success = ingest_file(dummy_jpg, project_id=1, copy_original=True)
        self.assertTrue(success, "A ingestão da foto JPG deveria ser bem-sucedida.")
        
        # Como o processamento do proxy roda em background no ThreadPoolExecutor,
        # aguardamos até 2 segundos para o status atualizar no banco
        photo_row = None
        for _ in range(20):
            time.sleep(0.1)
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM photo WHERE filename = ?", ("foto_set_teste.jpg",))
                photo_row = cursor.fetchone()
                if photo_row and photo_row['status'] == 'ingested':
                    break
            finally:
                conn.close()
                
        self.assertIsNotNone(photo_row, "A foto deveria estar catalogada no SQLite.")
        self.assertEqual(photo_row['status'], 'ingested', "O status da foto deveria ser atualizado para 'ingested'.")
        
        # Verificar se o arquivo proxy WebP foi fisicamente criado na pasta proxies/photos
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_row['id']}.webp"
        self.assertTrue(proxy_path.exists(), "O arquivo proxy WebP correspondente deveria existir no disco.")
        self.assertTrue(proxy_path.stat().st_size > 0, "O tamanho do proxy WebP deve ser maior que zero.")
        
        # Verificar se a resolução do proxy está reduzida para <= 1024px
        proxy_img = Image.open(proxy_path)
        self.assertLessEqual(max(proxy_img.size), 1024, "O proxy deve ser redimensionado para um limite máximo de 1024px.")
        print(f"  Proxy de foto JPG gerado com sucesso: {proxy_path.name} (Tamanho: {proxy_img.size})")

    @patch('rawpy.imread')
    def test_photo_ingest_raw(self, mock_rawpy_read):
        print("\n[TEST] 5. Configurando mock para rawpy e criando arquivo RAW simulado...")
        # Configurar mock do rawpy para retornar um array numpy de imagem simulado
        import numpy as np
        mock_raw = MagicMock()
        mock_raw.postprocess.return_value = np.zeros((3000, 4000, 3), dtype=np.uint8)
        
        # Configura o context manager mockado
        mock_rawpy_read.return_value.__enter__.return_value = mock_raw
        
        dummy_raw = self.test_dir / "foto_set_camera.arw"
        with open(dummy_raw, "wb") as f:
            f.write(b"SIMULATED RAW DATA")
            
        print("[TEST] 6. Ingerindo foto RAW (.ARW)...")
        success = ingest_file(dummy_raw, project_id=1, copy_original=True)
        self.assertTrue(success, "A ingestão do arquivo RAW simulado deveria retornar True.")
        
        # Aguardar o processamento em background
        photo_row = None
        for _ in range(20):
            time.sleep(0.1)
            conn = get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM photo WHERE filename = ?", ("foto_set_camera.arw",))
                photo_row = cursor.fetchone()
                if photo_row and photo_row['status'] == 'ingested':
                    break
            finally:
                conn.close()
                
        self.assertIsNotNone(photo_row, "A foto RAW deveria estar catalogada no SQLite.")
        self.assertEqual(photo_row['status'], 'ingested', "O status da foto RAW deveria ter sido atualizado para 'ingested' pelo pipeline.")
        
        # Verificar o proxy gerado
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_row['id']}.webp"
        self.assertTrue(proxy_path.exists(), "O arquivo proxy WebP para o RAW deveria existir no disco.")
        
        proxy_img = Image.open(proxy_path)
        self.assertLessEqual(max(proxy_img.size), 1024, "O proxy do RAW deve ser redimensionado para <= 1024px.")
        print(f"  Proxy de foto RAW (.ARW) gerado via Mock com sucesso: {proxy_path.name} (Tamanho: {proxy_img.size})")

if __name__ == "__main__":
    unittest.main()
