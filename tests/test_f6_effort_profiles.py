"""Testes dos perfis de esforço por categoria (E2.C1)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.nlp.prompt_registry import TRIAGE_CATEGORIES
from src.services.analysis_policy import (
    DEFAULT_EFFORT_BY_CATEGORY,
    EFFORT_FULL,
    EFFORT_REDUCED,
    EFFORT_TRIAGE,
    get_profile,
    parse_overrides,
    resolve_effort,
    validate_overrides,
)
from src.services.pipeline import PipelineService


class TestEffortMap(unittest.TestCase):
    def test_every_triage_category_has_an_effort(self):
        """O mapa não pode esquecer nenhuma das 9 categorias da taxonomia."""
        self.assertEqual(set(DEFAULT_EFFORT_BY_CATEGORY), set(TRIAGE_CATEGORIES))

    def test_plan_categories(self):
        for cat in ("obra", "processo", "depoimento", "evento"):
            self.assertEqual(resolve_effort(cat), EFFORT_FULL)
        for cat in ("tecnico", "arquivo"):
            self.assertEqual(resolve_effort(cat), EFFORT_REDUCED)
        for cat in ("cotidiano", "pessoal"):
            self.assertEqual(resolve_effort(cat), EFFORT_TRIAGE)

    def test_unknown_or_missing_category_is_full(self):
        """Sem categoria não se economiza às cegas: mantém o comportamento antigo."""
        self.assertEqual(resolve_effort(None), EFFORT_FULL)
        self.assertEqual(resolve_effort(""), EFFORT_FULL)
        self.assertEqual(resolve_effort("categoria_que_nao_existe"), EFFORT_FULL)

    def test_category_case_and_space_tolerant(self):
        self.assertEqual(resolve_effort("  Cotidiano "), EFFORT_TRIAGE)


class TestOverrides(unittest.TestCase):
    def test_override_wins_over_default(self):
        self.assertEqual(resolve_effort("cotidiano", '{"cotidiano": "completo"}'), EFFORT_FULL)
        self.assertEqual(resolve_effort("obra", '{"obra": "triagem"}'), EFFORT_TRIAGE)

    def test_override_of_other_category_does_not_leak(self):
        self.assertEqual(resolve_effort("obra", '{"cotidiano": "completo"}'), EFFORT_FULL)

    def test_invalid_json_falls_back_to_defaults(self):
        """Setting corrompido não pode derrubar a análise — só volta ao mapa padrão."""
        self.assertEqual(parse_overrides("isto nao e json"), {})
        self.assertEqual(resolve_effort("cotidiano", "isto nao e json"), EFFORT_TRIAGE)
        self.assertEqual(parse_overrides('["lista"]'), {})
        self.assertEqual(parse_overrides(""), {})
        self.assertEqual(parse_overrides(None), {})

    def test_unknown_effort_is_ignored(self):
        self.assertEqual(parse_overrides('{"cotidiano": "turbo"}'), {})

    def test_validate_overrides_rejects_bad_input(self):
        self.assertTrue(validate_overrides("")[0])
        self.assertTrue(validate_overrides('{"cotidiano": "completo"}')[0])
        self.assertFalse(validate_overrides("{nao json}")[0])
        self.assertFalse(validate_overrides('["lista"]')[0])
        self.assertFalse(validate_overrides('{"xpto": "completo"}')[0])
        self.assertFalse(validate_overrides('{"cotidiano": "turbo"}')[0])

    def test_setting_is_validated_on_write(self):
        from src.services.settings_registry import validate_value
        ok, _ = validate_value("analysis.effort_overrides", '{"cotidiano": "completo"}')
        self.assertTrue(ok)
        ok, msg = validate_value("analysis.effort_overrides", '{"cotidiano": "turbo"}')
        self.assertFalse(ok, "esforço inválido deve ser rejeitado na escrita, não ignorado depois")


class TestProfileEffectOnKeyframes(unittest.TestCase):
    """O perfil precisa mudar o custo de verdade no planejador de keyframes."""

    # Plano-sequência de 300s partido em 3 shots longos
    SEGMENTS = [
        {"start": 0.0, "end": 100.0},
        {"start": 100.0, "end": 200.0},
        {"start": 200.0, "end": 300.0},
    ]
    DURATION = 300.0
    INTERVAL = 10.0

    def _plan(self, category):
        profile = get_profile(category)
        max_frames = 38  # teto global do pipeline p/ 300s @10s
        if profile.max_keyframes is not None:
            max_frames = min(max_frames, profile.max_keyframes)
        return PipelineService._plan_keyframes(
            self.SEGMENTS, self.DURATION, self.INTERVAL, 2.0, max_frames,
            coverage_floor=profile.coverage_floor,
        )

    def test_full_effort_keeps_coverage(self):
        self.assertGreaterEqual(len(self._plan("obra")), 30)

    def test_reduced_effort_is_one_keyframe_per_shot(self):
        self.assertEqual(len(self._plan("tecnico")), len(self.SEGMENTS))

    def test_triage_effort_caps_at_two_keyframes(self):
        """Aceite E2.C1: cotidiano consome <= 3 chamadas de visão (1 triagem + 2 keyframes)."""
        jobs = self._plan("cotidiano")
        self.assertEqual(len(jobs), 2)
        self.assertLessEqual(1 + len(jobs), 3)

    def test_triage_effort_caps_even_on_fragmented_video(self):
        """Vídeo com 60 cortes classificado 'pessoal' continua em 2 keyframes."""
        segs = [{"start": float(t), "end": float(t + 5)} for t in range(0, 300, 5)]
        profile = get_profile("pessoal")
        jobs = PipelineService._plan_keyframes(
            segs, 300.0, 10.0, 2.0, min(38, profile.max_keyframes),
            coverage_floor=profile.coverage_floor,
        )
        self.assertEqual(len(jobs), 2)

    def test_reduced_keyframes_keep_real_windows(self):
        """Mesmo no esforço reduzido a janela do keyframe é a do segmento (E2.A6)."""
        jobs = self._plan("arquivo")
        self.assertAlmostEqual(jobs[0]["start"], 0.0, delta=0.01)
        self.assertAlmostEqual(jobs[0]["end"], 100.0, delta=0.01)

    def test_full_effort_matches_legacy_default(self):
        """Paridade: perfil completo == chamada sem o parâmetro novo (comportamento antigo)."""
        legacy = PipelineService._plan_keyframes(self.SEGMENTS, self.DURATION, self.INTERVAL, 2.0, 38)
        self.assertEqual([j["timestamp"] for j in legacy], [j["timestamp"] for j in self._plan("obra")])


class TestFallbackRespectsProfile(unittest.TestCase):
    """O relógio fixo legado também tem que respeitar o teto do perfil.

    Sem isto, uma falha de segmentação devolve o vídeo barato ao custo cheio em
    silêncio — a mesma classe de degradação que escondeu o bug do E2.A5.
    """

    def _fallback(self, duration, interval, profile):
        """Relógio fixo legado + o teto do perfil, usando o helper real do pipeline."""
        jobs, t = [], 0.0
        while t < duration:
            jobs.append({"timestamp": t, "start": t, "end": min(t + interval, duration)})
            t += interval
        if profile.max_keyframes is not None:
            jobs = PipelineService._subsample_uniform(jobs, profile.max_keyframes)
        return jobs

    def test_fallback_capped_for_triage_effort(self):
        jobs = self._fallback(300.0, 10.0, get_profile("cotidiano"))
        self.assertEqual(len(jobs), 2)
        self.assertEqual(jobs[0]["timestamp"], 0.0, "mantém a ponta inicial")
        self.assertEqual(jobs[-1]["timestamp"], 290.0, "mantém a ponta final")

    def test_fallback_untouched_for_full_effort(self):
        self.assertEqual(len(self._fallback(300.0, 10.0, get_profile("obra"))), 30)

    def test_subsample_uniform_keeps_ends_and_spreads(self):
        jobs = [{"timestamp": float(t)} for t in range(100)]
        out = PipelineService._subsample_uniform(jobs, 5)
        self.assertEqual([j["timestamp"] for j in out], [0.0, 24.0, 49.0, 74.0, 99.0])
        self.assertIs(PipelineService._subsample_uniform(jobs, 0), jobs, "0 = sem teto")
        self.assertIs(PipelineService._subsample_uniform(jobs, 500), jobs, "teto maior que a lista = intocada")

    def test_pipeline_fallback_source_has_the_cap(self):
        """Guarda o código real: o trecho de fallback precisa aplicar max_keyframes."""
        import inspect
        src = inspect.getsource(PipelineService.analyze_video_vision)
        fallback = src.split("Fallback: relógio fixo legado")[1][:900]
        self.assertIn("profile.max_keyframes", fallback,
                      "o fallback do relógio fixo deve respeitar o teto do perfil de esforço")


class TestSegmentationRespectsProfile(unittest.TestCase):
    def test_beats_disabled_returns_shots_only(self):
        """detect_beats_enabled=False para na granularidade de shot (e poupa decode)."""
        from src.vision.segmentation import segment_video
        from tests.test_f3_segmentation import FIXTURE, _make_fixture
        _make_fixture()
        segs = segment_video(FIXTURE, 6.0, min_beat_shot_s=1.0, motion_enabled=False,
                             detect_beats_enabled=False)
        self.assertTrue(segs)
        self.assertTrue(all(s["kind"] == "shot" for s in segs), "nenhum beat quando desligado")


if __name__ == "__main__":
    unittest.main()
