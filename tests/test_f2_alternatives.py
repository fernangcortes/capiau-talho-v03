"""Teste unitário para validação das mídias alternativas e origens dos clipes (Fase 2)."""
import unittest
import shutil
import tempfile
from pathlib import Path
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project, add_video
from src.services.chat_agent import TimelineShadowCopy, ChatAgentService
from src.services.rag import RAGService
from unittest.mock import patch, MagicMock

class TestF2Alternatives(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Diretorio proprio desta execucao, fora da arvore do repositorio
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_f2_alternatives_"))
        
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_capiau_f2.db"
        
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    @patch("src.services.rag.RAGService.search_hybrid")
    def test_shadow_copy_alternatives_fallback(self, mock_search):
        # 1. Setup mock do RAG para retornar vídeos parecidos
        mock_search.return_value = [
            {"payload": {"video_id": 99, "start_time": 2.0, "end_time": 8.0, "text": "Cena alternativa 1"}},
            {"payload": {"video_id": 100, "start_time": 1.0, "end_time": 5.0, "text": "Cena alternativa 2"}}
        ]

        # 2. Setup projeto e vídeos
        proj_id = add_project("Teste F2", "Desc", "http://drive.com")
        v_id = add_video(
            project_id=proj_id,
            filename="video_principal.mp4",
            filepath="/originals/video_principal.mp4",
            file_hash="hash_vp",
            video_type="broll",
            duration=120.0,
            fps=24.0
        )

        tracks = [{"id": "V1", "name": "Video 1", "kind": "video", "magnetic": False, "locked": False}]
        
        shadow = TimelineShadowCopy(clips=[], tracks=tracks, fps=24.0)
        
        # 3. Inserir clipe sem alternativas especificadas (deve buscar via fallback do RAG)
        res = shadow.insert_clip(
            project_id=proj_id,
            track="V1",
            video_id=v_id,
            in_s=10.0,
            out_s=20.0,
            timeline_start=0.0
        )
        self.assertEqual(res, "success")
        self.assertEqual(len(shadow.clips), 1)
        
        clip = shadow.clips[0]
        # Deve ter marcado a origem como "ai"
        self.assertEqual(clip["origin"], "ai")
        # Deve ter carregado as alternativas vindas do mock RAG
        self.assertEqual(len(clip["alternatives"]), 2)
        self.assertEqual(clip["alternatives"][0]["video_id"], 99)
        self.assertEqual(clip["alternatives"][0]["in_s"], 2.0)
        self.assertEqual(clip["alternatives"][1]["video_id"], 100)

        # 4. Validar a serialização para o frontend
        serialized = shadow.serialize_cuts_to_frontend()
        self.assertEqual(len(serialized), 1)
        self.assertEqual(serialized[0]["origin"], "ai")
        self.assertEqual(len(serialized[0]["alternatives"]), 2)

if __name__ == "__main__":
    unittest.main()
