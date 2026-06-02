"""Teste de integração para o pipeline de Ingestão e Proxying do CapIAu."""
import unittest
import os
import shutil
from pathlib import Path
from unittest.mock import patch
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import get_connection
from src.ingest.watcher import ingest_file

class TestIngestPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Pasta de testes dedicada
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_ingest"
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        cls.original_originals = CONFIG.ORIGINALS_DIR
        cls.original_proxies = CONFIG.PROXIES_DIR
        
        CONFIG.DB_PATH = cls.test_dir / "test_ingest.db"
        CONFIG.ORIGINALS_DIR = cls.test_dir / "originals"
        CONFIG.PROXIES_DIR = cls.test_dir / "proxies"
        
        # Garantir a criação das subpastas
        CONFIG.ORIGINALS_DIR.mkdir(exist_ok=True)
        CONFIG.PROXIES_DIR.mkdir(exist_ok=True)
        
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.ORIGINALS_DIR = cls.original_originals
        CONFIG.PROXIES_DIR = cls.original_proxies
        
        # Limpar arquivos de teste
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    @patch('src.ingest.watcher.generate_proxy', return_value=True)
    def test_video_ingest(self, mock_proxy):
        print("\n[TEST] 1. Criando arquivo de mídia simulado...")
        # Cria um arquivo de texto simulando uma mídia WAV curta ou apenas um container
        dummy_file = self.test_dir / "depoimento_ator.mp4"
        with open(dummy_file, "wb") as f:
            # Escreve dados binários simulados
            f.write(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom")
            
        print("[TEST] 2. Ingerindo mídia simulada (Mocking FFmpeg Proxy)...")
        # Ingerir o arquivo criado
        success = ingest_file(dummy_file, project_id=1)
        
        self.assertTrue(success, "A ingestão do vídeo simulado deveria ser bem-sucedida.")
        
        # O arquivo simulado não tem streams de vídeo reais para o FFmpeg converter, 
        # então verificamos se a ingestão catalogou os metadados técnicos básicos no SQLite
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

if __name__ == "__main__":
    unittest.main()
