"""Teste unitário/integração para o Banco de Dados e Busca Semântica do CapIAu-Talho."""
import unittest
import os
import shutil
from pathlib import Path
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_video, save_transcript_words, get_video_transcript
from src.search.semantic import SemanticSearch

class TestDatabaseAndSemantic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Usar paths de teste temporários para não sobrescrever o DB de produção
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test"
        cls.test_dir.mkdir(exist_ok=True)
        
        # Sobrescrever temporariamente os caminhos da CONFIG
        cls.original_db = CONFIG.DB_PATH
        cls.original_qdrant = CONFIG.QDRANT_DB_PATH
        
        CONFIG.DB_PATH = cls.test_dir / "test_capiau.db"
        CONFIG.QDRANT_DB_PATH = cls.test_dir / "test_qdrant.db"
        
        # Remover arquivos antigos de teste se houver
        if CONFIG.DB_PATH.exists():
            CONFIG.DB_PATH.unlink()
        if CONFIG.QDRANT_DB_PATH.exists():
            # Qdrant local cria uma pasta no path do arquivo se for embutido
            shutil.rmtree(CONFIG.QDRANT_DB_PATH, ignore_errors=True)

    @classmethod
    def tearDownClass(cls):
        # Restaurar caminhos originais
        CONFIG.DB_PATH = cls.original_db
        CONFIG.QDRANT_DB_PATH = cls.original_qdrant
        
        # Limpar diretório de teste
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_database_flow(self):
        print("\n[TEST] 1. Inicializando Banco SQLite...")
        init_db(CONFIG.DB_PATH)
        self.assertTrue(CONFIG.DB_PATH.exists(), "O arquivo SQLite de teste não foi criado.")
        
        print("[TEST] 2. Adicionando Vídeo de Teste...")
        video_id = add_video(
            project_id=1,
            filename="entrevista_diretor.mp4",
            filepath="/videos/entrevista_diretor.mp4",
            file_hash="mockhash123456",
            video_type="interview",
            duration=120.5,
            fps=24.0,
            resolution="1920x1080",
            codec="h264",
            bitrate=5000000
        )
        self.assertEqual(video_id, 1, "O ID do vídeo inserido deveria ser 1.")
        
        print("[TEST] 3. Salvando Transcrição de Teste...")
        mock_words = [
            {"word": "Olá", "start_time": 0.5, "end_time": 1.0, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "eu", "start_time": 1.1, "end_time": 1.3, "speaker_id": "Diretor", "confidence": 0.98},
            {"word": "sou", "start_time": 1.4, "end_time": 1.6, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "o", "start_time": 1.7, "end_time": 1.8, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "diretor", "start_time": 1.9, "end_time": 2.5, "speaker_id": "Diretor", "confidence": 0.97},
            {"word": "e", "start_time": 2.6, "end_time": 2.8, "speaker_id": "Diretor", "confidence": 0.95},
            {"word": "escolhi", "start_time": 2.9, "end_time": 3.4, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "usar", "start_time": 3.5, "end_time": 3.8, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "lentes", "start_time": 3.9, "end_time": 4.3, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "anamórficas", "start_time": 4.4, "end_time": 5.2, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "para", "start_time": 5.3, "end_time": 5.5, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "obter", "start_time": 5.6, "end_time": 6.0, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "uma", "start_time": 6.1, "end_time": 6.3, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "estética", "start_time": 6.4, "end_time": 6.8, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "cinematográfica", "start_time": 6.9, "end_time": 8.0, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": ".", "start_time": 8.0, "end_time": 8.1, "speaker_id": "Diretor", "confidence": 1.0}
        ]
        save_transcript_words(video_id, mock_words)
        
        dialogues = get_video_transcript(video_id)
        self.assertEqual(len(dialogues), 1, "Deveria ter agrupado as palavras em um único bloco de diálogo.")
        self.assertEqual(dialogues[0]['speaker_id'], "Diretor")
        self.assertIn("lentes anamórficas", dialogues[0]['text'])
        print(f"  Diálogo Agrupado: {dialogues[0]['text']}")
        
        print("[TEST] 4. Inicializando Qdrant Local e Indexando...")
        # Força o reset do singleton para carregar as novas configs de teste
        SemanticSearch._instance = None
        search_engine = SemanticSearch.get_instance()
        search_engine.index_transcript_chunks(1, video_id, dialogues)
        
        print("[TEST] 5. Efetuando Busca Semântica em CPU...")
        # Pesquisa semântica por conceito relacionado que não usa a palavra exata
        query = "escolha do tipo de objetiva para o filme"
        results = search_engine.search(1, query, limit=1)

        
        self.assertGreater(len(results), 0, "A busca semântica deveria retornar pelo menos um resultado.")
        best_match = results[0]
        print(f"  Query: \"{query}\"")
        print(f"  Resultado Encontrado: \"{best_match['payload']['text']}\" (Score: {best_match['score']:.4f})")
        
        # Validar se o match encontrou o texto correto (que fala de lentes)
        self.assertIn("lentes", best_match['payload']['text'])
        self.assertEqual(best_match['payload']['video_id'], video_id)
        self.assertEqual(best_match['payload']['start_time'], 0.5)
        print("  [OK] Sucesso no teste de banco e busca vetorial!")

if __name__ == "__main__":
    unittest.main()
