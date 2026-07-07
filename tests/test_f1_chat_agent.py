"""Teste unitário para validação das mutações na TimelineShadowCopy e integridade do ChatAgentService (Fase 1)."""
import unittest
import shutil
from pathlib import Path
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project, add_video
from src.db.connection import get_db
from src.services.chat_agent import TimelineShadowCopy, ChatAgentService

class TestF1ChatAgent(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Configurar caminhos temporários
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_chat_agent"
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_capiau_agent.db"
        
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_shadow_copy_mutations(self):
        # 1. Setup projeto e vídeos
        proj_id = add_project("Teste Agente", "Rascunho", "http://drive.com")
        
        v1_id = add_video(
            project_id=proj_id,
            filename="entrevista1.mp4",
            filepath="/originals/entrevista1.mp4",
            file_hash="hash_e1",
            video_type="interview",
            duration=30.0,
            fps=24.0
        )
        v2_id = add_video(
            project_id=proj_id,
            filename="broll1.mp4",
            filepath="/originals/broll1.mp4",
            file_hash="hash_b1",
            video_type="broll",
            duration=20.0,
            fps=24.0
        )

        # 2. Inicializar cópia-sombra com 1 track de vídeo e 1 de áudio
        tracks = [
            {"id": "V1", "name": "Falas", "kind": "video", "magnetic": True, "locked": False},
            {"id": "V2", "name": "B-Roll", "kind": "video", "magnetic": False, "locked": False},
            {"id": "A1", "name": "Áudio Falas", "kind": "audio", "magnetic": False, "locked": False},
            {"id": "A2", "name": "Áudio B-Roll", "kind": "audio", "magnetic": False, "locked": False}
        ]
        
        # Iniciar vazia
        shadow = TimelineShadowCopy(clips=[], tracks=tracks, fps=24.0)
        self.assertEqual(len(shadow.clips), 0)

        # 3. Testar insert_clip na trilha magnética V1 (deve criar par A/V vinculado e colocar em timeline_start=0)
        res = shadow.insert_clip(
            project_id=proj_id,
            track="V1",
            video_id=v1_id,
            in_s=5.0,
            out_s=15.0
        )
        self.assertEqual(res, "success")
        # Deve ter criado 2 clipes (um vídeo em V1 e um áudio em A1)
        self.assertEqual(len(shadow.clips), 2)
        v_clip = next(c for c in shadow.clips if c["track"] == "V1")
        a_clip = next(c for c in shadow.clips if c["track"] == "A1")
        self.assertEqual(v_clip["timeline_start"], 0.0)
        self.assertEqual(a_clip["timeline_start"], 0.0)
        self.assertIsNotNone(v_clip["link_id"])
        self.assertEqual(v_clip["link_id"], a_clip["link_id"])

        # 4. Inserir mais um clipe em V1 (deve colar após o primeiro devido à pista magnética)
        res = shadow.insert_clip(
            project_id=proj_id,
            track="V1",
            video_id=v1_id,
            in_s=0.0,
            out_s=10.0
        )
        self.assertEqual(res, "success")
        self.assertEqual(len(shadow.clips), 4)
        
        # Ordenando clipes de V1 por timeline_start
        v_clips = sorted([c for c in shadow.clips if c["track"] == "V1"], key=lambda c: c["timeline_start"])
        self.assertEqual(v_clips[0]["timeline_start"], 0.0)
        self.assertEqual(v_clips[1]["timeline_start"], 10.0) # 0.0 + (15.0 - 5.0)

        # 5. Testar mover clipe de V1 para V2
        # (V2 é livre. Mover um clipe de V1 deve fazer o ripple reajustar o outro)
        target_clip_id = v_clips[0]["id"]
        res = shadow.move_clip(target_clip_id, "V2", 5.0)
        self.assertEqual(res, "success")
        
        # Clipes na timeline
        v1_clips = [c for c in shadow.clips if c["track"] == "V1"]
        v2_clips = [c for c in shadow.clips if c["track"] == "V2"]
        self.assertEqual(len(v1_clips), 1)
        self.assertEqual(len(v2_clips), 1)
        # O clipe que ficou em V1 deve ter sofrido ripple e ido para 0.0
        self.assertEqual(v1_clips[0]["timeline_start"], 0.0)
        # O clipe movido para V2 deve estar em 5.0
        self.assertEqual(v2_clips[0]["timeline_start"], 5.0)

        # 6. Testar trim_clip
        # Encurtar o clipe de V2 (in 5.0 -> 7.0, edge='left')
        res = shadow.trim_clip(v2_clips[0]["id"], "left", 2.0)
        self.assertEqual(res, "success")
        self.assertEqual(v2_clips[0]["in"], 7.0)
        # Em trilha livre (V2), o timeline_start do vídeo deve ter andado 2.0s
        self.assertEqual(v2_clips[0]["timeline_start"], 7.0)
        # E o áudio parceiro deve ter se reancorado em 5.0s (J-cut: entra 2s antes do vídeo)
        a2_clip = next(c for c in shadow.clips if c["link_id"] == v2_clips[0]["link_id"] and c["track"] == "A2")
        self.assertEqual(a2_clip["timeline_start"], 5.0)

        # 7. Testar split_clip
        # Dividir o clipe em V1 (que tem duração 10s e começa no tempo 0.0, dividindo no segundo 4.0)
        v1_clip_before_split = v1_clips[0]
        res = shadow.split_clip(v1_clip_before_split["id"], 4.0)
        self.assertEqual(res, "success")
        # Deve ter gerado mais clipes
        v1_clips_after = sorted([c for c in shadow.clips if c["track"] == "V1"], key=lambda c: c["timeline_start"])
        self.assertEqual(len(v1_clips_after), 2)
        self.assertEqual(v1_clips_after[0]["out"], 4.0)
        self.assertEqual(v1_clips_after[1]["in"], 4.0)
        self.assertEqual(v1_clips_after[1]["timeline_start"], 4.0)

        # 8. Testar delete_clip
        # Apagar a segunda metade de V1
        res = shadow.delete_clip(v1_clips_after[1]["id"])
        self.assertEqual(res, "success")
        
        # 9. Testar set_av_offset (L/J cuts)
        # Setar offset no clipe de V2 para criar J-cut de 1.5s (como timeline_start é 7.0s, o áudio pode começar em 5.5s)
        v2_rem = [c for c in shadow.clips if c["track"] == "V2"][0]
        res = shadow.set_av_offset(v2_rem["id"], 1.5)
        self.assertEqual(res, "success")
        
        a2_rem = next(c for c in shadow.clips if c["link_id"] == v2_rem["link_id"] and c["track"] == "A2")
        # Áudio deve começar 1.5s antes na timeline (J-cut)
        self.assertEqual(a2_rem["in"], max(0.0, v2_rem["in"] - 1.5))
        self.assertEqual(a2_rem["timeline_start"], v2_rem["timeline_start"] - 1.5)

        # 10. Testar serialize
        serialized = shadow.serialize_cuts_to_frontend()
        self.assertEqual(len(serialized), len(shadow.clips))
        self.assertIn("link_id", serialized[0])

    def test_chat_agent_fallback_msg(self):
        # Testar se ChatAgentService retorna erro amigável se a API Key for inválida
        res = ChatAgentService.chat_with_agent(
            project_id=1,
            message="Olá",
            history=[],
            clips=[],
            tracks=[],
            custom_api_key="your_openrouter_api_key_here"
        )
        self.assertIn("Configure a chave", res["response"])

if __name__ == "__main__":
    unittest.main()
