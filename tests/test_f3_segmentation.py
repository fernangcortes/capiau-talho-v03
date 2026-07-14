"""Testes da segmentação real (E2.A): shots, beats e integração com o schema."""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.vision.segmentation import detect_shots, segment_video, _hsv_embedding, _cosine_distance
import numpy as np

FIXTURE = Path(__file__).parent / "fixtures" / "two_scenes.mp4"


def _make_fixture():
    """Gera um vídeo sintético de 6s com corte duro no meio (vermelho → azul)."""
    FIXTURE.parent.mkdir(exist_ok=True)
    if FIXTURE.exists():
        return
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=red:size=320x180:duration=3:rate=12",
        "-f", "lavfi", "-i", "color=c=blue:size=320x180:duration=3:rate=12",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1[out]",
        "-map", "[out]", str(FIXTURE),
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


class TestSegmentation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _make_fixture()

    def test_detect_shots_finds_hard_cut(self):
        shots = detect_shots(FIXTURE)
        self.assertGreaterEqual(len(shots), 2, "corte duro vermelho→azul deve gerar 2+ shots")
        # o primeiro corte deve estar perto de 3s
        self.assertAlmostEqual(shots[0]["end"], 3.0, delta=0.5)

    def test_detect_shots_missing_file(self):
        self.assertEqual(detect_shots(Path("nao_existe.mp4")), [])

    def test_segment_video_covers_duration(self):
        segs = segment_video(FIXTURE, 6.0, motion_enabled=False)
        self.assertGreaterEqual(len(segs), 2)
        self.assertAlmostEqual(segs[0]["start"], 0.0, delta=0.1)
        self.assertAlmostEqual(segs[-1]["end"], 6.0, delta=0.5)
        for s in segs:
            self.assertIn(s["kind"], ("shot", "beat"))
            self.assertLess(s["start"], s["end"])

    def test_hsv_embedding_drift(self):
        red = np.zeros((90, 160, 3), dtype=np.uint8); red[:, :, 2] = 255
        blue = np.zeros((90, 160, 3), dtype=np.uint8); blue[:, :, 0] = 255
        d_same = _cosine_distance(_hsv_embedding(red), _hsv_embedding(red))
        d_diff = _cosine_distance(_hsv_embedding(red), _hsv_embedding(blue))
        self.assertLess(d_same, 0.01)
        self.assertGreater(d_diff, 0.35, "cores opostas devem ultrapassar o drift threshold default")

    def test_media_segment_persistence(self):
        """replace/get de segmentos no banco em memória com o schema real."""
        import sqlite3
        from src.db.schema import SCHEMA_SQL
        from src.db.repositories.media import MediaRepository

        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA_SQL)
        conn.execute("INSERT INTO project (id, name) VALUES (1, 'teste')")
        conn.execute(
            "INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (1, 1, 'v.mp4', '/v.mp4', 'h1')"
        )
        segs = [
            {"start": 0.0, "end": 3.0, "kind": "shot", "reason": "corte", "motion_label": "static"},
            {"start": 3.0, "end": 6.0, "kind": "beat", "reason": "deriva", "motion_label": "pan"},
        ]
        MediaRepository.replace_video_segments(conn, 1, 1, segs)
        rows = MediaRepository.get_video_segments(conn, 1)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["kind"], "shot")
        self.assertEqual(rows[1]["motion_label"], "pan")
        # substituição não duplica
        MediaRepository.replace_video_segments(conn, 1, 1, segs)
        self.assertEqual(len(MediaRepository.get_video_segments(conn, 1)), 2)
        conn.close()


class TestKeyframePlanner(unittest.TestCase):
    """Planejador de keyframes (E2.A5 revisado): cobertura + dedup + teto."""

    def _plan(self, segs, dur, interval=10.0, min_gap=2.0, cap=26):
        from src.services.pipeline import PipelineService
        return PipelineService._plan_keyframes(segs, dur, interval, min_gap, cap)

    def test_long_shot_gets_coverage(self):
        """Um shot de ~115s deve virar vários keyframes com gap <= intervalo, não 1 só."""
        segs = [{"start": 0.0, "end": 20.0}, {"start": 20.0, "end": 135.3}]
        jobs = self._plan(segs, 135.3)
        long_kf = [j for j in jobs if 20.0 <= j["timestamp"] <= 135.3]
        self.assertGreaterEqual(len(long_kf), 10, "shot longo precisa de cobertura densa")
        gaps = [jobs[i]["timestamp"] - jobs[i - 1]["timestamp"] for i in range(1, len(jobs))]
        self.assertLessEqual(max(gaps), 12.0, "nenhum buraco muito maior que o intervalo")

    def test_short_static_shot_single_frame(self):
        """Shot curto (< intervalo) fica com 1 keyframe (não super-amostra)."""
        self.assertEqual(len(self._plan([{"start": 0.0, "end": 8.0}], 8.0)), 1)

    def test_min_gap_merges_rapid_cuts(self):
        """Cortes de ~1s viram keyframes fundidos, respeitando o min_gap."""
        segs = [{"start": t, "end": t + 1.0} for t in range(0, 10)]  # 10 cortes de 1s
        jobs = self._plan(segs, 10.0, min_gap=2.0)
        gaps = [jobs[i]["timestamp"] - jobs[i - 1]["timestamp"] for i in range(1, len(jobs))]
        self.assertTrue(all(g >= 2.0 - 0.01 for g in gaps), "nenhum par mais perto que min_gap")
        self.assertLess(len(jobs), 10, "cortes rápidos devem ser fundidos")

    def test_each_keyframe_has_own_window(self):
        """Keyframes de um mesmo shot longo têm janelas distintas (clique não repete o frame)."""
        jobs = self._plan([{"start": 0.0, "end": 100.0}], 100.0)
        starts = [round(j["start"], 1) for j in jobs]
        self.assertEqual(len(starts), len(set(starts)), "janelas [start] devem ser distintas")

    def test_cost_ceiling_respected(self):
        segs = [{"start": t, "end": t + 0.5} for t in range(0, 400)]  # patológico
        self.assertLessEqual(len(self._plan(segs, 200.0, cap=26)), 26)

    def test_ceiling_sacrifices_redundancy_not_coverage(self):
        """Teto apertado corta fatia extra de plano longo, não corte distinto.

        Regressão de qualidade: a subamostragem uniforme por índice apagava shots
        curtos inteiros (material que a busca nunca encontraria) enquanto mantinha
        fatias quase idênticas do mesmo plano longo.
        """
        # 1 plano de 200s (muitas fatias redundantes) + 12 cortes distintos de 4s
        segs = [{"start": 0.0, "end": 200.0}]
        segs += [{"start": 200.0 + i * 4, "end": 204.0 + i * 4} for i in range(12)]
        dur = 248.0
        jobs = self._plan(segs, dur, interval=10.0, min_gap=2.0, cap=16)
        self.assertLessEqual(len(jobs), 16)

        def coberto(seg):
            return any(seg["start"] - 0.01 <= j["timestamp"] <= seg["end"] + 0.01 for j in jobs)

        curtos = segs[1:]
        cobertos = [s for s in curtos if coberto(s)]
        self.assertEqual(len(cobertos), len(curtos),
                         "todo corte distinto precisa de ao menos 1 keyframe: sem frame, "
                         "o trecho não é descrito nem indexado e some da busca")

    def test_no_segment_left_blind_when_budget_allows(self):
        """Havendo orçamento para 1 por trecho, nenhum trecho fica sem keyframe."""
        segs = [{"start": float(i * 6), "end": float(i * 6 + 6)} for i in range(20)]
        jobs = self._plan(segs, 120.0, interval=10.0, min_gap=2.0, cap=20)
        for s in segs:
            self.assertTrue(
                any(s["start"] - 0.01 <= j["timestamp"] <= s["end"] + 0.01 for j in jobs),
                f"trecho {s['start']}-{s['end']}s ficou invisível para a busca")


if __name__ == "__main__":
    unittest.main()
