"""Testes de paridade EQ (Q-factor WebAudio) e compensacao mono (-3 dB)."""
import math
import shutil
import subprocess
import numpy as np
import pytest

from src.export.video_render import grafo_audio, modelo


def _tem_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _seq_audio(clips, tracks=None):
    return modelo.normalizar({
        "version": 2,
        "fps": 24,
        "tracks": tracks or [{"id": "A1", "kind": "audio"}],
        "clips": clips,
    })


def _biquad_ir(b0: float, b1: float, b2: float, a0: float, a1: float, a2: float, n: int = 4096) -> np.ndarray:
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros(n, dtype=np.float64)
    x = np.zeros(n, dtype=np.float64)
    x[0] = 1.0
    for i in range(n):
        y[i] = (
            b0 * x[i]
            + (b1 * x[i - 1] if i >= 1 else 0.0)
            + (b2 * x[i - 2] if i >= 2 else 0.0)
            - (a1 * y[i - 1] if i >= 1 else 0.0)
            - (a2 * y[i - 2] if i >= 2 else 0.0)
        )
    return y


def _webaudio_highpass_ir(f0: float, sr: int = 48000, q_db: float = 1.0, n: int = 4096) -> np.ndarray:
    w0 = 2.0 * math.pi * f0 / sr
    alpha = math.sin(w0) / (2.0 * (10.0 ** (q_db / 20.0)))
    cosw0 = math.cos(w0)
    b0 = (1.0 + cosw0) / 2.0
    b1 = -(1.0 + cosw0)
    b2 = (1.0 + cosw0) / 2.0
    a0 = 1.0 + alpha
    a1 = -2.0 * cosw0
    a2 = 1.0 - alpha
    return _biquad_ir(b0, b1, b2, a0, a1, a2, n=n)


def _webaudio_lowshelf_ir(f0: float, db: float, sr: int = 48000, n: int = 4096) -> np.ndarray:
    A = 10.0 ** (db / 40.0)
    w0 = 2.0 * math.pi * f0 / sr
    cosw0 = math.cos(w0)
    alpha = math.sin(w0) / 2.0 * math.sqrt(2.0)
    sqA = 2.0 * math.sqrt(A) * alpha
    b0 = A * ((A + 1.0) - (A - 1.0) * cosw0 + sqA)
    b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosw0)
    b2 = A * ((A + 1.0) - (A - 1.0) * cosw0 - sqA)
    a0 = (A + 1.0) + (A - 1.0) * cosw0 + sqA
    a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosw0)
    a2 = (A + 1.0) + (A - 1.0) * cosw0 - sqA
    return _biquad_ir(b0, b1, b2, a0, a1, a2, n=n)


def _webaudio_highshelf_ir(f0: float, db: float, sr: int = 48000, n: int = 4096) -> np.ndarray:
    A = 10.0 ** (db / 40.0)
    w0 = 2.0 * math.pi * f0 / sr
    cosw0 = math.cos(w0)
    alpha = math.sin(w0) / 2.0 * math.sqrt(2.0)
    sqA = 2.0 * math.sqrt(A) * alpha
    b0 = A * ((A + 1.0) + (A - 1.0) * cosw0 + sqA)
    b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0)
    b2 = A * ((A + 1.0) + (A - 1.0) * cosw0 - sqA)
    a0 = (A + 1.0) - (A - 1.0) * cosw0 + sqA
    a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosw0)
    a2 = (A + 1.0) - (A - 1.0) * cosw0 - sqA
    return _biquad_ir(b0, b1, b2, a0, a1, a2, n=n)


def _ffmpeg_ir(filtro: str, sr: int = 48000, n: int = 4096) -> np.ndarray:
    imp = np.zeros(n, dtype=np.float32)
    imp[0] = 1.0
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error",
            "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
            "-af", filtro, "-f", "f32le", "pipe:1",
        ],
        input=imp.tobytes(),
        capture_output=True,
        check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32)[:n]


def test_filtros_eq_usam_larguras_webaudio():
    params = {
        "eq_on": True,
        "hpf_hz": 80.0,
        "low_db": 6.0,
        "mid_db": -3.0,
        "high_db": 4.0,
    }
    filtros = grafo_audio._filtros_eq(params)
    assert filtros == [
        "highpass=f=80:width_type=q:width=1.122018",
        "bass=g=6:f=250:width_type=q:width=0.5",
        "equalizer=f=1000:width_type=q:width=1:g=-3",
        "treble=g=4:f=3000:width_type=q:width=0.5",
    ]


@pytest.mark.skipif(not _tem_ffmpeg(), reason="FFmpeg indisponivel")
@pytest.mark.parametrize("freq", [60.0, 80.0, 120.0, 200.0])
def test_eq_highpass_resposta_em_frequencia_paridade_webaudio(freq):
    sr, n = 48000, 4096
    flt = grafo_audio._filtros_eq({"eq_on": True, "hpf_hz": freq, "low_db": 0.0, "mid_db": 0.0, "high_db": 0.0})[0]
    y_ff = _ffmpeg_ir(flt, sr=sr, n=n)
    y_wa = _webaudio_highpass_ir(freq, sr=sr, q_db=1.0, n=n)
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    mask = (freqs >= 20.0) & (freqs <= 20000.0)
    h_ff = np.maximum(np.abs(np.fft.rfft(y_ff)), 1e-12)
    h_wa = np.maximum(np.abs(np.fft.rfft(y_wa)), 1e-12)
    diff_db = np.max(np.abs(20.0 * np.log10(h_wa[mask] / h_ff[mask])))
    assert diff_db <= 0.05


@pytest.mark.skipif(not _tem_ffmpeg(), reason="FFmpeg indisponivel")
@pytest.mark.parametrize("ganho", [-12.0, -6.0, 6.0, 12.0])
def test_eq_shelves_resposta_em_frequencia_paridade_webaudio(ganho):
    sr, n = 48000, 4096
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    mask = (freqs >= 20.0) & (freqs <= 20000.0)

    flt_low = grafo_audio._filtros_eq({"eq_on": True, "hpf_hz": 0.0, "low_db": ganho, "mid_db": 0.0, "high_db": 0.0})[0]
    h_ff_low = np.maximum(np.abs(np.fft.rfft(_ffmpeg_ir(flt_low, sr=sr, n=n))), 1e-12)
    h_wa_low = np.maximum(np.abs(np.fft.rfft(_webaudio_lowshelf_ir(250.0, ganho, sr=sr, n=n))), 1e-12)
    assert np.max(np.abs(20.0 * np.log10(h_wa_low[mask] / h_ff_low[mask]))) <= 0.05

    flt_high = grafo_audio._filtros_eq({"eq_on": True, "hpf_hz": 0.0, "low_db": 0.0, "mid_db": 0.0, "high_db": ganho})[0]
    h_ff_high = np.maximum(np.abs(np.fft.rfft(_ffmpeg_ir(flt_high, sr=sr, n=n))), 1e-12)
    h_wa_high = np.maximum(np.abs(np.fft.rfft(_webaudio_highshelf_ir(3000.0, ganho, sr=sr, n=n))), 1e-12)
    assert np.max(np.abs(20.0 * np.log10(h_wa_high[mask] / h_ff_high[mask]))) <= 0.05


@pytest.mark.skipif(not _tem_ffmpeg(), reason="FFmpeg indisponivel")
def test_mono_nao_perde_3db_e_estereo_permanece_inalterado(tmp_path):
    mono_wav = tmp_path / "mono.wav"
    stereo_wav = tmp_path / "stereo.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.5:c=mono:s=48000:d=0.5", str(mono_wav)],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.5|0.25:c=stereo:s=48000:d=0.5", str(stereo_wav)],
        check=True,
    )

    # 1. Mono puro -> (0.5, 0.5)
    seq_m = _seq_audio([{"id": "m", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 0.5, "video_id": 1}])
    gm = grafo_audio.grafo_audio_completo(seq_m, modelo.Escopo(), 0.0, 0.5)
    raw_m = subprocess.check_output(
        ["ffmpeg", "-v", "error", "-i", str(mono_wav), "-filter_complex", gm["filter_complex"],
         "-map", gm["rotulo_audio"], "-f", "f32le", "-"],
    )
    arr_m = np.frombuffer(raw_m, dtype=np.float32).reshape(-1, 2)
    assert np.allclose(arr_m[1000:-1000, 0], 0.5, atol=1e-4)
    assert np.allclose(arr_m[1000:-1000, 1], 0.5, atol=1e-4)

    # 2. Estereo puro -> (0.5, 0.25)
    seq_s = _seq_audio([{"id": "s", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 0.5, "video_id": 2}])
    gs = grafo_audio.grafo_audio_completo(seq_s, modelo.Escopo(), 0.0, 0.5)
    raw_s = subprocess.check_output(
        ["ffmpeg", "-v", "error", "-i", str(stereo_wav), "-filter_complex", gs["filter_complex"],
         "-map", gs["rotulo_audio"], "-f", "f32le", "-"],
    )
    arr_s = np.frombuffer(raw_s, dtype=np.float32).reshape(-1, 2)
    assert np.allclose(arr_s[1000:-1000, 0], 0.5, atol=1e-4)
    assert np.allclose(arr_s[1000:-1000, 1], 0.25, atol=1e-4)


@pytest.mark.skipif(not _tem_ffmpeg(), reason="FFmpeg indisponivel")
def test_amix_mono_e_estereo_preserva_ganho_e_canais(tmp_path):
    mono_wav = tmp_path / "mono.wav"
    stereo_wav = tmp_path / "stereo.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.5:c=mono:s=48000:d=0.5", str(mono_wav)],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.25|0.125:c=stereo:s=48000:d=0.5", str(stereo_wav)],
        check=True,
    )
    seq = _seq_audio(
        [
            {"id": "s", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 0.5, "video_id": 1},
            {"id": "m", "track": "A2", "timeline_start": 0.0, "in": 0.0, "out": 0.5, "video_id": 2},
        ],
        tracks=[{"id": "A1", "kind": "audio"}, {"id": "A2", "kind": "audio"}],
    )
    g = grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), 0.0, 0.5)
    raw = subprocess.check_output(
        ["ffmpeg", "-v", "error", "-i", str(stereo_wav), "-i", str(mono_wav),
         "-filter_complex", g["filter_complex"], "-map", g["rotulo_audio"], "-f", "f32le", "-"],
    )
    arr = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    assert np.allclose(arr[1000:-1000, 0], 0.75, atol=1e-4)
    assert np.allclose(arr[1000:-1000, 1], 0.625, atol=1e-4)
