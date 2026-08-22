"""Testes do importador de timelines (caminho inverso do export OTIO/XML/EDL) - Fase 0c.

Roda no Python principal SEM opentimelineio: o parser de .otio é JSON nativo,
então os fixtures são dicionários OTIO escritos à mão no mesmo formato que o
exportador (src/export/otio_export.py) e o Kdenlive produzem.
"""
import json
import os
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path

from src.config import CONFIG
from src.db.connection import get_db
from src.db.operations import add_project, add_photo, add_video
from src.db.repositories.projects import ProjectRepository
from src.db.schema import init_db
from src.export.otio_import import (
    import_timeline_file,
    parse_otio_dict_to_ir,
    read_timeline_file_to_ir,
)


def _make_temp_dir(prefix: str) -> Path:
    """Diretório temporário único com permissões padrão de pasta.

    Diferente de tempfile.mkdtemp (que cria com modo 0700): em ambientes com
    sandbox de arquivos, pastas 0700 impedem que o sqlite3 crie o arquivo do
    banco dentro delas. O nome único via uuid preserva a semântica do mkdtemp.
    """
    base = Path(os.environ.get("CAPIAU_TEST_TMP") or tempfile.gettempdir())
    d = base / f"{prefix}{uuid.uuid4().hex[:12]}"
    d.mkdir(parents=True)
    return d


def _rt(rate: float, seconds: float) -> dict:
    # RationalTime guarda value em UNIDADES DE FRAME: segundos × rate,
    # exatamente como o exportador grava (RationalTime(int(s*fps), fps)).
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": rate, "value": round(seconds * rate)}


def _trange(rate: float, start: float, duration: float) -> dict:
    return {
        "OTIO_SCHEMA": "TimeRange.1",
        "start_time": _rt(rate, start),
        "duration": _rt(rate, duration),
    }


def _clip(name: str, target_url: str, rate: float, start: float, duration: float,
          metadata: dict = None) -> dict:
    ref = {
        "OTIO_SCHEMA": "ExternalReference.1",
        "target_url": target_url,
        "available_range": _trange(rate, 0, start + duration),
    }
    clip = {
        "OTIO_SCHEMA": "Clip.2",
        "name": name,
        "source_range": _trange(rate, start, duration),
        "media_reference": ref,
    }
    if metadata:
        clip["metadata"] = metadata
    return clip


class TestF0COtioTimelineImport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = _make_temp_dir("capiau_otio_import_")

        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_capiau_otio_import.db"
        init_db(CONFIG.DB_PATH)

        # Acervo do projeto: 2 vídeos + 1 foto, como se tivessem sido ingestados
        proj_id = add_project("Projeto Import", "Round-trip do importador", "")
        cls.proj_id = proj_id
        cls.v1_path = str((cls.test_dir / "originals" / "entrevista.mp4").resolve())
        cls.v2_path = str((cls.test_dir / "originals" / "broll.mp4").resolve())
        cls.v1_id = add_video(
            project_id=proj_id, filename="entrevista.mp4", filepath=cls.v1_path,
            file_hash="h_entrevista", video_type="interview", duration=60.0, fps=24.0,
        )
        cls.v2_id = add_video(
            project_id=proj_id, filename="broll.mp4", filepath=cls.v2_path,
            file_hash="h_broll", video_type="broll", duration=30.0, fps=24.0,
        )
        cls.photo_path = str((cls.test_dir / "originals" / "set.jpg").resolve())
        cls.photo_id = add_photo(
            project_id=proj_id, filename="set.jpg", filepath=cls.photo_path,
            file_hash="h_set",
        )

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _otio_doc(self) -> dict:
        """Espelho fiel do que o exportador CapIAu grava em .otio."""
        return {
            "OTIO_SCHEMA": "Timeline.1",
            "name": "Doc Externo",
            "metadata": {},
            "global_start_time": _rt(24, 0),
            "tracks": {
                "OTIO_SCHEMA": "Stack.1",
                "children": [
                    {   # Fundo da pilha: áudio com gap inicial (espelho do export)
                        "OTIO_SCHEMA": "Track.1",
                        "name": "A2 Áudio B-Roll",
                        "kind": "Audio",
                        "children": [
                            {"OTIO_SCHEMA": "Gap.1", "source_range": _trange(24, 0, 5)},
                            _clip("entrevista.mp4", self.v1_path.replace("\\", "/"), 24, 10.0, 3.0),
                        ],
                    },
                    {
                        "OTIO_SCHEMA": "Track.1",
                        "name": "V1 Falas",
                        "kind": "Video",
                        "children": [
                            _clip("entrevista.mp4", self.v1_path.replace("\\", "/"), 24, 0.0, 8.0),
                            {"OTIO_SCHEMA": "Gap.1", "source_range": _trange(24, 0, 2)},
                            _clip("broll.mp4", self.v2_path.replace("\\", "/"), 24, 1.0, 4.0),
                        ],
                    },
                    {   # Topo: still de foto com metadados capiau preservados
                        "OTIO_SCHEMA": "Track.1",
                        "name": "V2 B-Roll",
                        "kind": "Video",
                        "children": [
                            _clip(
                                "set.jpg", self.photo_path.replace("\\", "/"), 24, 0.0, 4.0,
                                metadata={"capiau": {"still": True, "effects": [{"type": "ken_burns"}]}},
                            ),
                        ],
                    },
                ],
            },
        }

    def _write_otio(self, doc: dict, name: str = "doc_externo.otio") -> Path:
        path = self.test_dir / name
        path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        return path

    def test_parse_recupera_pistas_ids_e_posicoes(self):
        ir = parse_otio_dict_to_ir(self._otio_doc())

        # Rótulos "{id} {nome}" do nosso export viram id + nome separados
        por_id = {t["id"]: t for t in ir["tracks"]}
        self.assertEqual(set(por_id.keys()), {"A2", "V1", "V2"})
        self.assertEqual(por_id["V1"]["name"], "Falas")
        self.assertEqual(por_id["A2"]["kind"], "audio")
        self.assertEqual(por_id["V1"]["kind"], "video")

        # Ordem espelha a pilha OTIO: fundo (A2) tem order maior
        orders = [t["order"] for t in ir["tracks"]]
        self.assertEqual(orders, sorted(orders))
        self.assertGreater(
            next(t["order"] for t in ir["tracks"] if t["id"] == "A2"),
            next(t["order"] for t in ir["tracks"] if t["id"] == "V2"),
        )

        # Gaps preservados como posições absolutas
        v1 = [c for c in ir["clips"] if c["track"] == "V1"]
        self.assertEqual(len(v1), 2)
        self.assertAlmostEqual(v1[0]["timeline_start"], 0.0)
        self.assertAlmostEqual(v1[1]["timeline_start"], 10.0)  # 8s de clipe + 2s de gap
        self.assertAlmostEqual(v1[1]["in"], 1.0)
        a2 = [c for c in ir["clips"] if c["track"] == "A2"]
        self.assertAlmostEqual(a2[0]["timeline_start"], 5.0)

        # Still de foto marcado pelos metadados capiau
        stills = [c for c in ir["clips"] if c["still"]]
        self.assertEqual(len(stills), 1)
        self.assertEqual(stills[0]["effects"], [{"type": "ken_burns"}])

        # FPS detectado das durações
        self.assertAlmostEqual(ir["fps"], 24.0)

    def test_import_completo_religa_midia_e_grava_v2(self):
        path = self._write_otio(self._otio_doc(), "roundtrip.otio")

        with get_db() as conn:
            summary = import_timeline_file(conn, self.proj_id, path, source_filename="doc_externo.otio")
            conn.commit()

        self.assertEqual(summary["status"], "success")
        self.assertEqual(summary["clips_imported"], 4)
        self.assertEqual(summary["clips_skipped"], 0)
        self.assertEqual(summary["matched_exact"], 3)  # 3 caminhos únicos religados
        self.assertEqual(summary["missing_media"], [])

        with get_db() as conn:
            detail = ProjectRepository.get_timeline(conn, summary["timeline_id"])
        sequence = detail["sequence"]
        self.assertEqual(sequence["version"], 2)
        self.assertAlmostEqual(sequence["fps"], 24.0)

        cuts = sequence["clips"]
        self.assertEqual(len(cuts), 4)

        # Clipe religou com o video_id correto do banco
        v1_first = next(c for c in cuts if c["track"] == "V1"
                        and abs(c["timeline_start"]) < 1e-6)
        self.assertEqual(v1_first["video_id"], self.v1_id)
        self.assertIsNone(v1_first["photo_id"])

        # Foto casada na tabela photo vira clipe tipo photo, com efeitos preservados
        photo_cut = next(c for c in cuts if c["track"] == "V2")
        self.assertEqual(photo_cut["type"], "photo")
        self.assertEqual(photo_cut["photo_id"], self.photo_id)
        self.assertEqual(photo_cut["effects"], [{"type": "ken_burns"}])

        # Pistas gravadas: IA padrão + as 3 importadas, ordenadas por order
        trilhas = {t["id"]: t for t in sequence["tracks"]}
        self.assertEqual(trilhas["AI"]["kind"], "ai")
        self.assertEqual(trilhas["V1"]["name"], "Falas")
        self.assertEqual(trilhas["A2"]["kind"], "audio")
        self.assertLess(trilhas["V2"]["order"], trilhas["V1"]["order"])
        self.assertLess(trilhas["V1"]["order"], trilhas["A2"]["order"])

        # Descrição registra a origem
        self.assertIn("doc_externo.otio", detail.get("description") or "")

    def test_uri_com_esquema_e_percent_encoding_casa_por_nome(self):
        doc = self._otio_doc()
        # Estilo Premiere/Resolve: file:/// + percent-encoding, caminho inexistente aqui
        doc["tracks"]["children"][1]["children"][0]["media_reference"]["target_url"] = \
            "file:///D:/Pasta%20Com%20Espa%C3%A7os/OUTRO_LUGAR/entrevista.mp4"

        ir = parse_otio_dict_to_ir(doc)
        clip_v1 = next(c for c in ir["clips"] if c["track"] == "V1")
        self.assertEqual(clip_v1["media_path"], "D:/Pasta Com Espaços/OUTRO_LUGAR/entrevista.mp4")

        path = self._write_otio(doc, "com_uri.otio")
        with get_db() as conn:
            summary = import_timeline_file(conn, self.proj_id, path)
            conn.commit()

        # Caminho não existe no acervo, mas o basename é único → religa por nome
        self.assertEqual(summary["matched_basename"], 1)
        self.assertEqual(summary["clips_skipped"], 0)

    def test_midia_ausente_vira_lacuna_reportada(self):
        doc = self._otio_doc()
        doc["tracks"]["children"][1]["children"][2]["media_reference"]["target_url"] = \
            "X:/arquivo_desaparecido.mp4"

        path = self._write_otio(doc, "faltando.otio")
        with get_db() as conn:
            summary = import_timeline_file(conn, self.proj_id, path)
            conn.commit()

        self.assertEqual(summary["clips_imported"], 3)
        self.assertEqual(summary["clips_skipped"], 1)
        self.assertEqual(len(summary["missing_media"]), 1)
        self.assertEqual(summary["missing_media"][0]["name"], "arquivo_desaparecido.mp4")
        self.assertTrue(any("sem mídia" in w for w in summary["warnings"]))

        with get_db() as conn:
            detail = ProjectRepository.get_timeline(conn, summary["timeline_id"])
        self.assertEqual(len(detail["sequence"]["clips"]), 3)

    def test_arquivo_sem_timeline_levanta_value_error(self):
        path = self.test_dir / "lixo.otio"
        path.write_text(json.dumps({"OTIO_SCHEMA": "Stack.1", "children": []}), encoding="utf-8")
        with self.assertRaises(ValueError):
            read_timeline_file_to_ir(path)

    def test_extensao_nao_suportada_nao_passa_pelo_dispatcher(self):
        from src.export.otio_import import SUPPORTED_EXTENSIONS
        self.assertNotIn(".mp4", SUPPORTED_EXTENSIONS)


if __name__ == "__main__":
    unittest.main()
