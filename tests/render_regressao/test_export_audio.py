"""Testes de regressão Nível 1 de áudio sobre intermediário lossless (`PCM s16le`)."""
from __future__ import annotations

import copy
import math
import subprocess
from pathlib import Path
from typing import Dict

import numpy as np
import pytest

from . import ajudantes, fontes, metricas, referencias

pytestmark = [pytest.mark.needs_ffmpeg, pytest.mark.render_golden]

_SR = 48000


def _rms_intervalo_db(samples: np.ndarray, ini_s: float, fim_s: float, *, sr: int = _SR) -> float:
    i0 = max(0, int(round(ini_s * sr)))
    i1 = min(len(samples), int(round(fim_s * sr)))
    seg = np.asarray(samples[i0:i1], dtype=np.float64)
    if seg.size == 0:
        return -120.0
    rms = math.sqrt(float(np.mean(seg * seg)))
    return 20.0 * math.log10(max(rms, 1e-12))


def _fatiar(samples: np.ndarray, ini_s: float, fim_s: float, *, sr: int = _SR) -> np.ndarray:
    i0 = max(0, int(round(ini_s * sr)))
    i1 = min(len(samples), int(round(fim_s * sr)))
    return samples[i0:i1]


def test_13_audio_ganho_fade_e_mute(tmp_path: Path) -> None:
    """Ganho de clipe/makeup (±6 dB), curvas de fade in/out e regras de mudo."""
    wav_seno = fontes.gerar_wav_seno(tmp_path / "seno_1k.wav", freq_hz=1000.0, dbfs=-20.0, duracao_s=4.0)
    cenario = referencias.carregar_cenario("13_audio_ganho_fade_mute")

    def _render_var(nome: str, mut_seq=None, mut_ped=None) -> np.ndarray:
        res = ajudantes.renderizar_cenario(
            cenario,
            tmp_path / nome,
            modo="intermediario",
            fontes_override={"1": wav_seno},
            mutar_sequencia=mut_seq,
            mutar_pedido=mut_ped,
        )
        return ajudantes.extrair_audio(res["caminho"], sr=_SR)

    # 1. Referência plana (volume pista=1.0, clip=1.0, sem fades)
    ref_audio = _render_var(
        "ref_plano",
        mut_seq=lambda s: (
            s["tracks"][0].__setitem__("volume", 1.0),
            s["clips"][0].__setitem__("effects", []),
        ),
    )
    rms_ref = _rms_intervalo_db(ref_audio, 0.5, 2.5)
    # Seno com pico -20.0 dBFS tem RMS teórico de -20.0 - 3.0103 = -23.0103 dBFS
    assert rms_ref == pytest.approx(-23.01, abs=0.25)

    # 2. Ganho -6.02 dB via volume.level = 0.5 e +6 dB via audio_dynamics.makeup_db = +6.0
    a_menos6 = _render_var(
        "menos6",
        mut_seq=lambda s: (
            s["tracks"][0].__setitem__("volume", 1.0),
            s["clips"][0].__setitem__("effects", [{"type": "volume", "level": 0.5}]),
        ),
    )
    rms_m6 = _rms_intervalo_db(a_menos6, 0.5, 2.5)
    assert (rms_m6 - rms_ref) == pytest.approx(-6.02, abs=0.25)

    a_mais6 = _render_var(
        "mais6",
        mut_seq=lambda s: (
            s["tracks"][0].__setitem__("volume", 1.0),
            s["clips"][0].__setitem__(
                "effects",
                [{"type": "audio_dynamics", "gate_db": -90.0, "comp_ratio": 1.0, "makeup_db": 6.0}],
            ),
        ),
    )
    rms_p6 = _rms_intervalo_db(a_mais6, 0.5, 2.5)
    assert (rms_p6 - rms_ref) == pytest.approx(6.0, abs=0.25)

    # 3. Fades: entrada linear [0..0.5s) crescente e saída s_curve [2.5..3.0s) decrescente
    a_fades = _render_var(
        "fades",
        mut_seq=lambda s: (
            s["tracks"][0].__setitem__("volume", 1.0),
            s["clips"][0]["effects"][0].__setitem__("level", 1.0),
        ),
    )
    janelas = metricas.rms_janelas_db(a_fades, sr=_SR, janela_ms=50.0)
    # 0.5s = 10 janelas de 50 ms
    assert janelas[0] < janelas[4] < janelas[8] < janelas[15]
    assert all(janelas[k] <= janelas[k + 1] + 0.15 for k in range(9))
    assert janelas[-15] > janelas[-9] > janelas[-5] > janelas[-1]
    assert all(janelas[k] >= janelas[k + 1] - 0.15 for k in range(len(janelas) - 10, len(janelas) - 1))

    # 4. Pista muda -> silêncio digital; overrides.mute_audio -> sem fluxo de áudio
    a_muda = _render_var(
        "pista_muda",
        mut_seq=lambda s: s["tracks"][0].__setitem__("muted", True),
    )
    assert metricas.pico_dbfs(a_muda) <= -90.0

    res_mute_ov = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "override_mute",
        modo="intermediario",
        fontes_override={"1": wav_seno},
        mutar_pedido=lambda p: p["overrides"].__setitem__("mute_audio", True),
    )
    assert ajudantes.sondar_video(res_mute_ov["caminho"])["tem_audio"] is False


def test_14_audio_crossfade_com_e_sem_handles(tmp_path: Path) -> None:
    """Crossfade equal_power mantém nível no ruído descorrelacionado e funciona com/sem handles."""
    wav_440 = fontes.gerar_wav_seno(tmp_path / "s440.wav", freq_hz=440.0, dbfs=-18.0, duracao_s=4.0)
    wav_1760 = fontes.gerar_wav_seno(tmp_path / "s1760.wav", freq_hz=1760.0, dbfs=-18.0, duracao_s=4.0)
    ruido_a = fontes.gerar_wav_ruido(tmp_path / "ra.wav", seed=111, rms_dbfs=-18.0, duracao_s=4.0)
    ruido_b = fontes.gerar_wav_ruido(tmp_path / "rb.wav", seed=222, rms_dbfs=-18.0, duracao_s=4.0)

    cenario = referencias.carregar_cenario("14_audio_crossfade")

    # 1. Senos 440 -> 1760 Hz: antes [0.2..1.2) = 440 Hz, depois [2.6..3.6) = 1760 Hz
    res_seno = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "senos",
        modo="intermediario",
        fontes_override={"1": wav_440, "2": wav_1760},
    )
    audio_s = ajudantes.extrair_audio(res_seno["caminho"], sr=_SR)
    assert metricas.frequencia_dominante_hz(_fatiar(audio_s, 0.2, 1.2), sr=_SR) == pytest.approx(440.0, abs=20.0)
    assert metricas.frequencia_dominante_hz(_fatiar(audio_s, 2.6, 3.6), sr=_SR) == pytest.approx(1760.0, abs=30.0)

    # 2. Ruído descorrelacionado em equal_power: nível na transição não afunda nem dá salto
    res_ruido = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "ruidos",
        modo="intermediario",
        fontes_override={"1": ruido_a, "2": ruido_b},
    )
    audio_r = ajudantes.extrair_audio(res_ruido["caminho"], sr=_SR)
    rms_antes = _rms_intervalo_db(audio_r, 0.2, 1.2)
    rms_trans = _rms_intervalo_db(audio_r, 1.6, 2.4)
    rms_depois = _rms_intervalo_db(audio_r, 2.8, 3.8)
    assert abs(rms_trans - rms_antes) <= 2.5
    assert abs(rms_trans - rms_depois) <= 2.5

    # 3. Sem handles: fontes exatamente de 2.0 s com in=0, out=2.0 e hard_boundaries
    wav_2a = fontes.gerar_wav_ruido(tmp_path / "r2a.wav", seed=333, rms_dbfs=-18.0, duracao_s=2.0)
    wav_2b = fontes.gerar_wav_ruido(tmp_path / "r2b.wav", seed=444, rms_dbfs=-18.0, duracao_s=2.0)

    def _sem_handles(s: dict) -> None:
        s["clips"][0]["hard_boundaries"] = True
        s["clips"][1]["in"] = 0.0
        s["clips"][1]["out"] = 2.0
        s["clips"][1]["hard_boundaries"] = True

    res_nh = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "sem_handles",
        modo="intermediario",
        fontes_override={"1": wav_2a, "2": wav_2b},
        mutar_sequencia=_sem_handles,
    )
    audio_nh = ajudantes.extrair_audio(res_nh["caminho"], sr=_SR)
    assert len(audio_nh) >= int(_SR * 3.9)
    assert np.all(np.isfinite(audio_nh))


def test_15_audio_jl_cut_sincronizacao_subquadro(tmp_path: Path) -> None:
    """J-cut e L-cut posicionam o início sonoro exatamente no deslocamento configurado (< 2 ms)."""
    impulso = fontes.gerar_wav_impulso(
        tmp_path / "impulso.wav", inicio_silencio_s=1.0, duracao_s=3.0, dbfs=-12.0
    )
    cenario = referencias.carregar_cenario("15_audio_jl_cut")

    # Visual cut em V1 às 1.5 s (quadro 36: barras_a -> barras_b)
    def _cfg(timeline_audio_s: float):
        def _mut(s: dict) -> None:
            s["clips"] = [
                {"id": "v1", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 1.5, "video_id": 1},
                {"id": "v2", "type": "video", "track": "V1", "timeline_start": 1.5, "in": 0.0, "out": 1.5, "video_id": 2},
                {"id": "a_cut", "type": "audio", "track": "A1", "timeline_start": timeline_audio_s, "in": 1.0, "out": 2.0, "video_id": 3},
            ]
        return _mut

    fontes_map: Dict[str, Path] = {
        "1": ajudantes.resolver_caminhos_fontes(cenario)["1"],
        "2": ajudantes.resolver_caminhos_fontes({"fontes": {"2": "barras_b.mp4"}})["2"],
        "3": impulso,
    }

    # J-cut: áudio entra em 1.0 s (0.5 s ANTES do corte visual em 1.5 s)
    res_j = ajudantes.renderizar_cenario(
        cenario, tmp_path / "j_cut", modo="intermediario", fontes_override=fontes_map, mutar_sequencia=_cfg(1.0)
    )
    q_j = ajudantes.extrair_quadros(res_j["caminho"], indices=[35, 36])
    ids_j = fontes.ler_ids(q_j)
    assert ids_j[0] == (35, 0) and ids_j[1] == (0, 1)
    audio_j = ajudantes.extrair_audio(res_j["caminho"], sr=_SR)
    t_ini_j = metricas.instante_inicio_som_s(audio_j, sr=_SR, limiar_dbfs=-30.0)
    assert t_ini_j is not None and abs(t_ini_j - 1.0) <= 0.002

    # L-cut: áudio entra em 1.8 s (0.3 s APÓS o corte visual em 1.5 s)
    res_l = ajudantes.renderizar_cenario(
        cenario, tmp_path / "l_cut", modo="intermediario", fontes_override=fontes_map, mutar_sequencia=_cfg(1.8)
    )
    audio_l = ajudantes.extrair_audio(res_l["caminho"], sr=_SR)
    t_ini_l = metricas.instante_inicio_som_s(audio_l, sr=_SR, limiar_dbfs=-30.0)
    assert t_ini_l is not None and abs(t_ini_l - 1.8) <= 0.002


def test_16_audio_eq_compressor_e_noise_gate(tmp_path: Path) -> None:
    """EQ por banda (HPF/low/high), compressor em degraus e noise gate preservam resposta."""
    rajadas = fontes.gerar_wav_rajadas_eq(
        tmp_path / "rajadas_eq.wav", freqs_hz=(100.0, 1000.0, 8000.0), dbfs=-18.0, dur_cada_s=0.8, silencio_s=0.2
    )
    degraus = fontes.gerar_wav_degraus(
        tmp_path / "degraus.wav", degraus_db=(-36.0, -24.0, -18.0, -12.0, -6.0, -1.0), dur_degrau_s=0.5
    )
    cenario = referencias.carregar_cenario("16_audio_eq_dinamica_gate")

    # 1. EQ: 100 Hz em [0.0..0.8), 1 kHz em [1.0..1.8), 8 kHz em [2.0..2.8)
    res_dry_eq = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "eq_dry",
        modo="intermediario",
        fontes_override={"1": rajadas},
        mutar_sequencia=lambda s: s["clips"][0].__setitem__("effects", []),
    )
    res_fx_eq = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "eq_on",
        modo="intermediario",
        fontes_override={"1": rajadas},
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "audio_eq", "hpf": 250.0, "low": -9.0, "mid": 0.0, "high": 6.0}]
        ),
    )
    a_dry = ajudantes.extrair_audio(res_dry_eq["caminho"], sr=_SR)
    a_eq = ajudantes.extrair_audio(res_fx_eq["caminho"], sr=_SR)

    delta_100 = _rms_intervalo_db(a_eq, 0.15, 0.65) - _rms_intervalo_db(a_dry, 0.15, 0.65)
    delta_1k = _rms_intervalo_db(a_eq, 1.15, 1.65) - _rms_intervalo_db(a_dry, 1.15, 1.65)
    delta_8k = _rms_intervalo_db(a_eq, 2.15, 2.65) - _rms_intervalo_db(a_dry, 2.15, 2.65)
    assert delta_100 <= -8.0
    assert abs(delta_1k) <= 2.0
    assert delta_8k >= 4.0

    # 2. Compressor: reduz faixa dinâmica entre degrau -24 dB ([0.6..0.9s]) e -1 dB ([2.6..2.9s])
    res_dry_deg = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "deg_dry",
        modo="intermediario",
        fontes_override={"1": degraus},
        mutar_sequencia=lambda s: s["clips"][0].__setitem__("effects", []),
    )
    res_comp = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "deg_comp",
        modo="intermediario",
        fontes_override={"1": degraus},
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "audio_dynamics", "gate_db": -90.0, "comp_ratio": 6.0, "comp_thresh_db": -24.0, "makeup_db": 0.0}]
        ),
    )
    ad = ajudantes.extrair_audio(res_dry_deg["caminho"], sr=_SR)
    ac = ajudantes.extrair_audio(res_comp["caminho"], sr=_SR)
    span_dry = _rms_intervalo_db(ad, 2.6, 2.9) - _rms_intervalo_db(ad, 0.6, 0.9)
    span_comp = _rms_intervalo_db(ac, 2.6, 2.9) - _rms_intervalo_db(ac, 0.6, 0.9)
    assert span_comp < span_dry - 6.0

    # 3. Noise gate: degrau fraco (-36 dBFS em [0.1..0.4s]) cai >= 20 dB; forte (-12 dBFS em [1.6..1.9s]) intacto
    res_gate = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "deg_gate",
        modo="intermediario",
        fontes_override={"1": degraus},
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "audio_dynamics", "gate_db": -28.0, "comp_ratio": 1.0, "comp_thresh_db": -18.0, "makeup_db": 0.0}]
        ),
    )
    ag = ajudantes.extrair_audio(res_gate["caminho"], sr=_SR)
    atenuacao_baixo = _rms_intervalo_db(ag, 0.15, 0.4) - _rms_intervalo_db(ad, 0.15, 0.4)
    desvio_alto = abs(_rms_intervalo_db(ag, 1.65, 1.9) - _rms_intervalo_db(ad, 1.65, 1.9))
    assert atenuacao_baixo <= -20.0
    assert desvio_alto <= 1.0


def test_18_audio_velocidade_limiter_regras_p3_e_determinismo(tmp_path: Path) -> None:
    """2x pitch_correction on/off, teto `alimiter` (-0.2 dBTP), determinismo e regra P3."""
    seno_1k = fontes.gerar_wav_seno(tmp_path / "seno_1k.wav", freq_hz=1000.0, dbfs=-20.0, duracao_s=4.0)
    seno_m1 = fontes.gerar_wav_seno(tmp_path / "seno_m1db.wav", freq_hz=1000.0, dbfs=-1.0, duracao_s=2.0)
    cenario = referencias.carregar_cenario("18_audio_velocidade_mix_limiter")

    # 1. speed=2.0: pitch_correction=True preserva ~1000 Hz; False dobra para ~2000 Hz
    def _somente_a1(pitch: bool):
        def _mut(s: dict) -> None:
            s["tracks"] = [s["tracks"][0]]
            s["clips"] = [
                {"id": "a1", "type": "audio", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 2.0, "speed": 2.0, "pitch_correction": pitch, "video_id": 1}
            ]
        return _mut

    res_pitch_on = ajudantes.renderizar_cenario(
        cenario, tmp_path / "pitch_on", modo="intermediario", fontes_override={"1": seno_1k}, mutar_sequencia=_somente_a1(True)
    )
    res_pitch_off = ajudantes.renderizar_cenario(
        cenario, tmp_path / "pitch_off", modo="intermediario", fontes_override={"1": seno_1k}, mutar_sequencia=_somente_a1(False)
    )
    a_on = ajudantes.extrair_audio(res_pitch_on["caminho"], sr=_SR)
    a_off = ajudantes.extrair_audio(res_pitch_off["caminho"], sr=_SR)
    assert metricas.frequencia_dominante_hz(a_on, sr=_SR) == pytest.approx(1000.0, abs=25.0)
    assert metricas.frequencia_dominante_hz(a_off, sr=_SR) == pytest.approx(2000.0, abs=40.0)

    # 2. Mixagem A1 + A2 com seno -1.0 dBFS em fase: alimiter contém pico abaixo de 0 dBFS (~ -0.2 dBTP)
    def _mix_estouro(s: dict) -> None:
        s["clips"] = [
            {"id": "a1", "type": "audio", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 1.0, "video_id": 1},
            {"id": "a2", "type": "audio", "track": "A2", "timeline_start": 0.0, "in": 0.0, "out": 1.0, "video_id": 1},
        ]

    res_lim = ajudantes.renderizar_cenario(
        cenario, tmp_path / "limiter_1", modo="intermediario", fontes_override={"1": seno_m1}, mutar_sequencia=_mix_estouro
    )
    a_lim1 = ajudantes.extrair_audio(res_lim["caminho"], sr=_SR)
    pico = metricas.pico_dbfs(a_lim1)
    assert -0.35 <= pico <= -0.15
    assert float(np.max(np.abs(a_lim1))) < 0.99

    # 3. Determinismo em re-render usando compare_audio_envelopes e compute_audio_residual_rms_db
    res_lim2 = ajudantes.renderizar_cenario(
        cenario, tmp_path / "limiter_2", modo="intermediario", fontes_override={"1": seno_m1}, mutar_sequencia=_mix_estouro
    )
    a_lim2 = ajudantes.extrair_audio(res_lim2["caminho"], sr=_SR)
    env = metricas.compare_audio_envelopes(a_lim1, a_lim2, sr=_SR)
    assert env["correlacao"] >= 0.9999 and env["lag_janelas"] == 0
    null_res = metricas.compute_audio_residual_rms_db(a_lim1, a_lim2, sr=_SR)
    assert null_res["ok_duracao"] is True and null_res["residuo_rms_db"] <= -90.0

    # 4. Regra P3: clipe de vídeo em V1 com áudio embutido NÃO vaza som sem clipe parceiro em A1
    video_com_som = tmp_path / "barras_com_audio.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(ajudantes.resolver_caminhos_fontes({"fontes": {"1": "barras_a.mp4"}})["1"]),
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
            "-shortest", "-c:v", "copy", "-c:a", "aac",
            str(video_com_som),
        ],
        check=True,
    )
    cen_p3 = copy.deepcopy(cenario)
    cen_p3["sequencia"]["tracks"] = [{"id": "V1", "kind": "video", "order": 0}]
    cen_p3["sequencia"]["clips"] = [
        {"id": "v_com_som", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 1.0, "video_id": 1}
    ]
    res_p3 = ajudantes.renderizar_cenario(
        cen_p3, tmp_path / "regra_p3", modo="intermediario", fontes_override={"1": video_com_som}
    )
    a_p3 = ajudantes.extrair_audio(res_p3["caminho"], sr=_SR)
    assert metricas.pico_dbfs(a_p3) <= -90.0
