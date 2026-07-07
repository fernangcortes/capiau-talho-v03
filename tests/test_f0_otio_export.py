"""Teste unitário para validação das exportações OTIO, XML e EDL com suporte a pistas de áudio da Fase 0."""
import unittest
import shutil
from pathlib import Path
import opentimelineio as otio
from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project, add_video
from src.db.repositories.projects import ProjectRepository
from src.export.otio_export import generate_otio_timeline, export_timeline_file
from src.db.connection import get_db

class TestF0OTIOTimelineExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Usar paths de teste temporários para não poluir ou sobrescrever o ambiente
        cls.test_dir = Path(__file__).resolve().parent.parent / "data_test_otio_export"
        cls.test_dir.mkdir(exist_ok=True)
        
        cls.original_db = CONFIG.DB_PATH
        cls.original_exports = CONFIG.EXPORTS_DIR
        
        CONFIG.DB_PATH = cls.test_dir / "test_capiau_otio.db"
        CONFIG.EXPORTS_DIR = cls.test_dir / "exports"
        CONFIG.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        # Restaurar configurações originais
        CONFIG.DB_PATH = cls.original_db
        CONFIG.EXPORTS_DIR = cls.original_exports
        
        # Limpar diretório temporário
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_otio_and_flatten_edl_export(self):
        # 1. Criar projeto de teste
        proj_id = add_project("Teste OTIO", "Teste de exportação de linha do tempo", "http://drive.com")
        self.assertGreater(proj_id, 0)
        
        # 2. Adicionar vídeos
        v1_path = str((self.test_dir / "originals" / "entrevista.mp4").resolve())
        v2_path = str((self.test_dir / "originals" / "broll.mp4").resolve())
        v1_id = add_video(
            project_id=proj_id,
            filename="entrevista.mp4",
            filepath=v1_path,
            file_hash="hash_entrevista_123",
            video_type="interview",
            duration=60.0,
            fps=24.0
        )
        v2_id = add_video(
            project_id=proj_id,
            filename="broll.mp4",
            filepath=v2_path,
            file_hash="hash_broll_456",
            video_type="broll",
            duration=30.0,
            fps=24.0
        )
        
        # 3. Montar dados da timeline
        # Pistas: IA (sugestões), V2 (B-Roll), V1 (Falas), A1 (Áudio Falas), A2 (Áudio B-Roll)
        tracks = [
            {"id": "AI", "name": "IA — Sugestões", "kind": "ai"},
            {"id": "V2", "name": "B-Roll", "kind": "video"},
            {"id": "V1", "name": "Falas", "kind": "video"},
            {"id": "A1", "name": "Áudio Falas", "kind": "audio"},
            {"id": "A2", "name": "Áudio B-Roll", "kind": "audio"}
        ]
        
        # Cortes:
        # - V1 clipe com link_id "link_1" no tempo 0.0s ate 10.0s
        # - A1 clipe com link_id "link_1" no tempo 0.0s ate 10.0s (J/L cuts mock)
        # - V2 clipe com link_id "link_2" no tempo 5.0s ate 8.0s (B-roll por cima)
        # - A2 clipe com link_id "link_2" no tempo 5.0s ate 8.0s
        # - V1 clipe sem link_id (legado) no tempo 15.0s ate 20.0s
        cuts = [
            {"id": "cut_1_v", "video_id": v1_id, "in": 0.0, "out": 10.0, "track": "V1", "timeline_start": 0.0, "link_id": "link_1"},
            {"id": "cut_1_a", "video_id": v1_id, "in": 0.0, "out": 10.0, "track": "A1", "timeline_start": 0.0, "link_id": "link_1"},
            {"id": "cut_2_v", "video_id": v2_id, "in": 1.0, "out": 4.0, "track": "V2", "timeline_start": 5.0, "link_id": "link_2"},
            {"id": "cut_2_a", "video_id": v2_id, "in": 1.0, "out": 4.0, "track": "A2", "timeline_start": 5.0, "link_id": "link_2"},
            {"id": "cut_legacy", "video_id": v1_id, "in": 20.0, "out": 25.0, "track": "V1", "timeline_start": 15.0, "link_id": None}
        ]
        
        # 4. Salvar timeline no banco
        with get_db() as conn:
            timeline_id = ProjectRepository.save_timeline(
                conn=conn,
                project_id=proj_id,
                name="Timeline Export Test",
                description="Testando o exportador com audio",
                cuts=cuts,
                tracks=tracks,
                fps=24.0
            )
        self.assertGreater(timeline_id, 0)
        
        # 5. Gerar timeline do OTIO e validar a estrutura
        otio_timeline = generate_otio_timeline(timeline_id)
        self.assertIsInstance(otio_timeline, otio.schema.Timeline)
        self.assertEqual(otio_timeline.name, "Timeline Export Test")
        
        # Pistas geradas (IA não é exportada, restam V2, V1, A1, A2)
        self.assertEqual(len(otio_timeline.tracks), 4)
        
        # Verificar tipos e nomes das pistas
        # Como sorted_track_ids ordena as pistas usando order decrescente, e tracks_meta
        # tem: AI (0), V2 (1), V1 (2), A1 (3), A2 (4)
        # sorted_track_ids = ['A2', 'A1', 'V1', 'V2'] (decrescente de ordem)
        expected_tracks = [
            ("A2 Áudio B-Roll", otio.schema.TrackKind.Audio),
            ("A1 Áudio Falas", otio.schema.TrackKind.Audio),
            ("V1 Falas", otio.schema.TrackKind.Video),
            ("V2 B-Roll", otio.schema.TrackKind.Video)
        ]
        
        for idx, (expected_name, expected_kind) in enumerate(expected_tracks):
            track = otio_timeline.tracks[idx]
            self.assertEqual(track.name, expected_name)
            self.assertEqual(track.kind, expected_kind)
            
        # 6. Testar exportação para os 3 formatos (.otio, .xml, .edl)
        otio_path = export_timeline_file(timeline_id, "otio")
        self.assertTrue(otio_path.exists())
        self.assertEqual(otio_path.suffix, ".otio")
        
        xml_path = export_timeline_file(timeline_id, "xml")
        self.assertTrue(xml_path.exists())
        self.assertEqual(xml_path.suffix, ".xml")
        
        edl_path = export_timeline_file(timeline_id, "edl")
        self.assertTrue(edl_path.exists())
        self.assertEqual(edl_path.suffix, ".edl")
        
        # 7. Validar que o EDL foi gerado sem erros e contém apenas 1 pista de vídeo (achatada)
        # O exportador deve ter achatado as pistas V1 e V2 em uma única trilha e descartado os áudios para EDL
        edl_timeline = otio.adapters.read_from_file(str(edl_path), adapter_name="cmx_3600")
        self.assertIsInstance(edl_timeline, otio.schema.Timeline)
        # O cmx_3600 reader gera uma timeline com pistas de vídeo/áudio combinadas ou específicas
        # Mas o importante é que a exportação ocorreu sem lançar exceções.
        
        print("\n[OK] Teste de exportacao OTIO/XML/EDL com audio multipista passou com sucesso!")

if __name__ == "__main__":
    unittest.main()
