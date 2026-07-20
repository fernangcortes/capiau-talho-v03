"""Teste da ponte de exportacao OTIO via worker Python 3.12 (E1.T6).

Roda no Python principal (3.14, SEM opentimelineio): export_timeline_file deve
delegar ao venv data/venv312 por subprocesso e produzir .otio/.xml/.edl validos.
Se o venv nao existir nesta maquina, os testes sao pulados com aviso claro.
"""
import unittest
import shutil
import tempfile
from pathlib import Path

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project, add_video
from src.db.repositories.projects import ProjectRepository
from src.db.connection import get_db
from src.export.otio_export import export_timeline_file, OTIO_AVAILABLE, _resolve_worker_python

_WORKER = _resolve_worker_python()


@unittest.skipIf(_WORKER is None and not OTIO_AVAILABLE,
                 "Nem opentimelineio local nem venv de exportacao (data/venv312) disponiveis")
class TestExportBridge(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_export_bridge_"))
        cls.original_db = CONFIG.DB_PATH
        cls.original_exports = CONFIG.EXPORTS_DIR
        CONFIG.DB_PATH = cls.test_dir / "test_bridge.db"
        CONFIG.EXPORTS_DIR = cls.test_dir / "exports"
        CONFIG.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        init_db(CONFIG.DB_PATH)

        proj_id = add_project("Teste Ponte Export", "E1.T6", "")
        v1 = add_video(proj_id, "fala.mp4", str(cls.test_dir / "fala.mp4"), "h1",
                       "interview", 60.0, 24.0)
        v2 = add_video(proj_id, "broll.mp4", str(cls.test_dir / "broll.mp4"), "h2",
                       "broll", 30.0, 24.0)
        tracks = [
            {"id": "V2", "name": "B-Roll", "kind": "video"},
            {"id": "V1", "name": "Falas", "kind": "video"},
            {"id": "A1", "name": "Audio Falas", "kind": "audio"},
        ]
        cuts = [
            {"id": "c1", "video_id": v1, "in": 0.0, "out": 10.0, "track": "V1", "timeline_start": 0.0},
            {"id": "c1a", "video_id": v1, "in": 0.0, "out": 10.0, "track": "A1", "timeline_start": 0.0},
            {"id": "c2", "video_id": v2, "in": 1.0, "out": 4.0, "track": "V2", "timeline_start": 5.0},
        ]
        with get_db() as conn:
            cls.timeline_id = ProjectRepository.save_timeline(
                conn=conn, project_id=proj_id, name="TL Ponte",
                description="teste", cuts=cuts, tracks=tracks, fps=24.0)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        CONFIG.EXPORTS_DIR = cls.original_exports
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_export_otio_json(self):
        path = export_timeline_file(self.timeline_id, "otio")
        self.assertTrue(path.exists())
        content = path.read_text(encoding="utf-8")
        self.assertIn('"OTIO_SCHEMA"', content)
        self.assertIn("TL Ponte", content)

    def test_export_fcp_xml(self):
        path = export_timeline_file(self.timeline_id, "xml")
        self.assertTrue(path.exists())
        content = path.read_text(encoding="utf-8", errors="replace")
        self.assertIn("xmeml", content)          # formato FCP7 XML
        self.assertIn("fala.mp4", content)

    def test_export_edl_flattened(self):
        path = export_timeline_file(self.timeline_id, "edl")
        self.assertTrue(path.exists())
        content = path.read_text(encoding="utf-8", errors="replace")
        self.assertIn("TITLE:", content)          # cabecalho CMX3600
        # achatamento: o corte da V2 (mais alta) prevalece sobre a V1 no trecho 5-8s
        self.assertIn("broll", content.lower())

    def test_worker_error_is_clear_for_missing_timeline(self):
        with self.assertRaises(Exception) as ctx:
            export_timeline_file(999999, "otio")
        self.assertIn("999999", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
