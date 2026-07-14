"""Teste unitário para a funcionalidade de Exportação e Importação de Projetos (CapIAu-Talho)."""
import unittest
import os
import shutil
import json
import tempfile
from pathlib import Path
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import (
    add_project, add_video, add_photo, add_production_doc,
    save_transcript_words, get_project_all_data, import_project_all_data,
    get_connection
)
from src.search.semantic import SemanticSearch

class TestProjectExportImport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Diretorio proprio desta execucao, fora da arvore do repositorio.
        # Por ser sempre novo, nao ha resto de rodada anterior para limpar aqui.
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_export_"))

        # Sobrescrever temporariamente os caminhos da CONFIG
        cls.original_db = CONFIG.DB_PATH
        cls.original_qdrant = CONFIG.QDRANT_DB_PATH

        CONFIG.DB_PATH = cls.test_dir / "test_capiau.db"
        CONFIG.QDRANT_DB_PATH = cls.test_dir / "test_qdrant.db"

    @classmethod
    def tearDownClass(cls):
        # Restaurar caminhos originais
        CONFIG.DB_PATH = cls.original_db
        CONFIG.QDRANT_DB_PATH = cls.original_qdrant
        
        # Limpar diretório de teste
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_export_import_flow(self):
        print("\n[TEST] 1. Inicializando Banco de Teste...")
        init_db(CONFIG.DB_PATH)
        
        # Resetar singleton do Qdrant
        SemanticSearch._instance = None
        
        print("[TEST] 2. Criando Projeto Origem...")
        proj_id = add_project("Filme Origem", "Projeto de teste para exportar", "http://drive.com/folder1")
        self.assertGreater(proj_id, 0)
        
        print("[TEST] 3. Inserindo Mídias e Transcrições no Projeto...")
        # Adicionar vídeo
        video_id = add_video(
            project_id=proj_id,
            filename="bastidores.mp4",
            filepath="/mídias/bastidores.mp4",
            file_hash="hash_video_teste_123",
            video_type="interview",
            duration=30.0
        )
        self.assertGreater(video_id, 0)
        
        # Adicionar palavras transcritas
        mock_words = [
            {"word": "Ação", "start_time": 1.0, "end_time": 2.0, "speaker_id": "Diretor", "confidence": 0.99},
            {"word": "Gravando", "start_time": 2.1, "end_time": 3.0, "speaker_id": "Diretor", "confidence": 0.95}
        ]
        save_transcript_words(video_id, mock_words)
        
        # Adicionar foto
        photo_id = add_photo(
            project_id=proj_id,
            filename="claquete.jpg",
            filepath="/mídias/claquete.jpg",
            file_hash="hash_foto_teste_456",
            description="Foto da claquete no set",
            tags=["claquete", "set"]
        )
        self.assertGreater(photo_id, 0)
        
        # Adicionar documento de contexto
        doc_id = add_production_doc(
            project_id=proj_id,
            filename="roteiro.txt",
            filepath="/mídias/roteiro.txt",
            content="Cena 1. O diretor grita ação.",
            doc_type="script"
        )
        self.assertGreater(doc_id, 0)
        
        print("[TEST] 4. Coletando Dados para Exportação...")
        export_data = get_project_all_data(proj_id)
        
        # Verificar integridade da estrutura coletada
        self.assertEqual(export_data["project"]["name"], "Filme Origem")
        self.assertEqual(export_data["project"]["drive_link"], "http://drive.com/folder1")
        self.assertEqual(len(export_data["videos"]), 1)
        self.assertEqual(len(export_data["photos"]), 1)
        self.assertEqual(len(export_data["production_docs"]), 1)
        self.assertEqual(len(export_data["transcripts"]), 2)
        
        print("[TEST] 5. Importando Projeto em Novo Registro...")
        # Altera ligeiramente o nome do projeto no pacote para diferenciar
        export_data["project"]["name"] = "Filme Destino (Importado)"
        
        new_proj_id = import_project_all_data(export_data)
        self.assertNotEqual(proj_id, new_proj_id, "O projeto importado deveria ter um ID diferente.")
        
        # Verificar integridade dos dados importados no SQLite
        conn = get_connection()
        try:
            cursor = conn.cursor()
            
            # Verificar se o projeto destino existe
            cursor.execute("SELECT name, drive_link FROM project WHERE id = ?", (new_proj_id,))
            row = cursor.fetchone()
            self.assertEqual(row["name"], "Filme Destino (Importado)")
            self.assertEqual(row["drive_link"], "http://drive.com/folder1")
            
            # Verificar se mídias foram importadas com mapeamento e sem colisão de hash única
            cursor.execute("SELECT id, filepath, hash FROM video WHERE project_id = ?", (new_proj_id,))
            video_row = cursor.fetchone()
            self.assertIsNotNone(video_row)
            self.assertNotEqual(video_row["id"], video_id)
            self.assertIn("hash_video_teste_123_imp_", video_row["hash"])
            
            # Verificar se falas foram importadas vinculadas ao novo vídeo
            cursor.execute("SELECT COUNT(*) FROM transcript WHERE video_id = ?", (video_row["id"],))
            self.assertEqual(cursor.fetchone()[0], 2)
            
            # Verificar fotos
            cursor.execute("SELECT id, hash FROM photo WHERE project_id = ?", (new_proj_id,))
            photo_row = cursor.fetchone()
            self.assertIsNotNone(photo_row)
            self.assertNotEqual(photo_row["id"], photo_id)
            self.assertIn("hash_foto_teste_456_imp_", photo_row["hash"])
            
            print("  [OK] Todos os dados e chaves mapeados com sucesso!")
        finally:
            conn.close()

if __name__ == "__main__":
    unittest.main()
