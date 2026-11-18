"""Métricas de imagem e áudio em NumPy/Pillow para a regressão do render (Frente B).

As funções de envelope RMS, correlação por atraso e resíduo nulo de áudio foram
adaptadas de HyperFrames (`packages/producer/src/utils/audioRegression.ts`),
Copyright 2026 HeyGen, Inc., sob licença Apache-2.0 — reescritas em Python/NumPy
para o pipeline determinístico do CapIAu-Talho.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# Métricas de imagem (NumPy)
# ---------------------------------------------------------------------------

def luma_bt709(img_rgb: np.ndarray) -> np.ndarray:
    arr = np.asarray(img_rgb, dtype=np.float64)
    return 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]


def max_abs(a: np.ndarray, b: np.ndarray) -> int:
    arr_a = np.asarray(a, dtype=np.int32)
    arr_b = np.asarray(b, dtype=np.int32)
    return int(np.max(np.abs(arr_a - arr_b)))


def fracao_acima_de(a: np.ndarray, b: np.ndarray, niveis: int = 4) -> float:
    diff = np.abs(np.asarray(a, dtype=np.int32) - np.asarray(b, dtype=np.int32))
    if diff.ndim >= 3:
        diff = np.max(diff, axis=-1)
    return float(np.mean(diff > int(niveis)))


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    arr_a = np.asarray(a, dtype=np.float64)
    arr_b = np.asarray(b, dtype=np.float64)
    mse = float(np.mean((arr_a - arr_b) ** 2))
    if mse <= 0.0:
        return float("inf")
    return float(10.0 * math.log10((255.0 ** 2) / mse))


def psnr_luma(a_rgb: np.ndarray, b_rgb: np.ndarray) -> float:
    return psnr(luma_bt709(a_rgb), luma_bt709(b_rgb))


def psnr_blocos_8x8(a_rgb: np.ndarray, b_rgb: np.ndarray) -> float:
    """PSNR sobre a média de blocos 8x8 em luma (filtra ruído de croma por pixel)."""
    la = luma_bt709(a_rgb)
    lb = luma_bt709(b_rgb)
    h, w = la.shape[:2]
    hc = (h // 8) * 8
    wc = (w // 8) * 8
    if hc == 0 or wc == 0:
        return psnr(la, lb)
    ba = la[:hc, :wc].reshape(hc // 8, 8, wc // 8, 8).mean(axis=(1, 3))
    bb = lb[:hc, :wc].reshape(hc // 8, 8, wc // 8, 8).mean(axis=(1, 3))
    return psnr(ba, bb)


def _filtro_media_uniforme_2d(mat: np.ndarray, k: int = 7) -> np.ndarray:
    """Média deslizante 2D uniforme `k x k` usando imagem integral (sem SciPy)."""
    r = k // 2
    padded = np.pad(mat, ((r, r), (r, r)), mode="edge")
    cs = np.pad(padded, ((1, 0), (1, 0)), mode="constant", constant_values=0.0)
    cs = cs.cumsum(axis=0).cumsum(axis=1)
    h, w = mat.shape
    soma = cs[k : k + h, k : k + w] - cs[:h, k : k + w] - cs[k : k + h, :w] + cs[:h, :w]
    return soma / float(k * k)


def ssim_luma(
    a_rgb: np.ndarray,
    b_rgb: np.ndarray,
    *,
    mascara: Optional[np.ndarray] = None,
    janela: int = 7,
) -> float:
    """SSIM de luma (janela uniforme 7x7); aceita máscara booleana opcional."""
    x = luma_bt709(a_rgb)
    y = luma_bt709(b_rgb)
    c1 = (0.01 * 255.0) ** 2
    c2 = (0.03 * 255.0) ** 2

    mu_x = _filtro_media_uniforme_2d(x, k=janela)
    mu_y = _filtro_media_uniforme_2d(y, k=janela)
    mu_x2 = mu_x * mu_x
    mu_y2 = mu_y * mu_y
    mu_xy = mu_x * mu_y

    sig_x2 = _filtro_media_uniforme_2d(x * x, k=janela) - mu_x2
    sig_y2 = _filtro_media_uniforme_2d(y * y, k=janela) - mu_y2
    sig_xy = _filtro_media_uniforme_2d(x * y, k=janela) - mu_xy

    num = (2.0 * mu_xy + c1) * (2.0 * sig_xy + c2)
    den = (mu_x2 + mu_y2 + c1) * (sig_x2 + sig_y2 + c2)
    mapa = num / np.maximum(den, 1e-12)
    if mascara is not None:
        m = np.asarray(mascara, dtype=bool)
        if np.any(m):
            return float(np.mean(mapa[m]))
    return float(np.mean(mapa))


def mapa_diferenca_x8(a_rgb: np.ndarray, b_rgb: np.ndarray) -> np.ndarray:
    diff = np.abs(np.asarray(a_rgb, dtype=np.int32) - np.asarray(b_rgb, dtype=np.int32))
    return np.clip(diff * 8, 0, 255).astype(np.uint8)


def montar_tira_miniaturas(
    quadros_rgb: Sequence[np.ndarray] | np.ndarray,
    *,
    thumb_w: int = 32,
    thumb_h: int = 18,
    colunas: int = 12,
) -> Image.Image:
    """Gera tira de miniaturas de luma (32x18 por quadro, 12 colunas)."""
    n = len(quadros_rgb)
    if n == 0:
        return Image.new("L", (thumb_w, thumb_h), 0)
    cols = max(1, int(colunas))
    linhas = math.ceil(n / cols)
    tira = Image.new("L", (cols * thumb_w, linhas * thumb_h), 0)
    for idx in range(n):
        luma = np.clip(luma_bt709(quadros_rgb[idx]), 0, 255).round().astype(np.uint8)
        mini = Image.fromarray(luma, "L").resize((thumb_w, thumb_h), Image.Resampling.BILINEAR)
        c = idx % cols
        r = idx // cols
        tira.paste(mini, (c * thumb_w, r * thumb_h))
    return tira


def comparar_tira_miniaturas(tira_ref: Image.Image, tira_atual: Image.Image) -> Dict[str, Any]:
    """Compara tiras de miniaturas por célula 32x18; devolve fração de quadros com erro > 2 níveis."""
    a = np.asarray(tira_ref.convert("L"), dtype=np.float64)
    b = np.asarray(tira_atual.convert("L"), dtype=np.float64)
    if a.shape != b.shape:
        return {"mesmo_tamanho": False, "fracao_falha": 1.0, "erro_medio_max": 255.0}
    h, w = a.shape
    tw, th = 32, 18
    cols = max(1, w // tw)
    rows = max(1, h // th)
    erros: List[float] = []
    for r in range(rows):
        for c in range(cols):
            bl_a = a[r * th : (r + 1) * th, c * tw : (c + 1) * tw]
            bl_b = b[r * th : (r + 1) * th, c * tw : (c + 1) * tw]
            erros.append(float(np.mean(np.abs(bl_a - bl_b))))
    falhos = sum(1 for e in erros if e > 2.0)
    return {
        "mesmo_tamanho": True,
        "total_celulas": len(erros),
        "celulas_falhas": falhos,
        "fracao_falha": falhos / max(1, len(erros)),
        "erro_medio_max": max(erros) if erros else 0.0,
    }


# ---------------------------------------------------------------------------
# Métricas de áudio (adaptadas de HyperFrames — Copyright 2026 HeyGen, Inc.)
# ---------------------------------------------------------------------------

def _para_mono(audio: np.ndarray) -> np.ndarray:
    arr = np.asarray(audio, dtype=np.float64)
    if arr.ndim == 1:
        return arr
    return np.mean(arr, axis=1)


def _reamostrar_linear(sinal: np.ndarray, sr_orig: int, sr_alvo: int) -> np.ndarray:
    if sr_orig == sr_alvo or len(sinal) == 0:
        return sinal
    n_out = max(1, int(round(len(sinal) * float(sr_alvo) / float(sr_orig))))
    xp = np.linspace(0.0, 1.0, len(sinal), endpoint=False)
    x = np.linspace(0.0, 1.0, n_out, endpoint=False)
    return np.interp(x, xp, sinal)


def build_rms_envelope(
    samples: np.ndarray,
    *,
    sr: int = 48000,
    target_sr: int = 16000,
    window_size: int = 2048,
    hop_size: int = 1024,
) -> np.ndarray:
    """Adaptado de HyperFrames `buildRmsEnvelope` (mono 16 kHz, janela 2048, hop 1024)."""
    mono = _para_mono(samples)
    if sr != target_sr:
        mono = _reamostrar_linear(mono, sr, target_sr)
    if len(mono) < window_size:
        rms = float(np.sqrt(np.mean(mono ** 2))) if len(mono) else 0.0
        return np.array([rms], dtype=np.float64)
    n_janelas = 1 + (len(mono) - window_size) // hop_size
    out = np.empty(n_janelas, dtype=np.float64)
    for i in range(n_janelas):
        seg = mono[i * hop_size : i * hop_size + window_size]
        out[i] = math.sqrt(float(np.mean(seg * seg)))
    return out


def correlation_at_lag(a: np.ndarray, b: np.ndarray, lag: int) -> float:
    """Adaptado de HyperFrames `correlationAtLag` (cosseno/Pearson sobre sobreposição)."""
    if lag >= 0:
        sa = a[lag:]
        sb = b[: len(sa)]
    else:
        sb = b[-lag:]
        sa = a[: len(sb)]
    n = min(len(sa), len(sb))
    if n == 0:
        return 0.0
    sa = sa[:n]
    sb = sb[:n]
    norm = math.sqrt(float(np.sum(sa * sa)) * float(np.sum(sb * sb)))
    if norm <= 1e-12:
        return 1.0 if float(np.max(np.abs(sa - sb))) <= 1e-9 else 0.0
    return float(np.sum(sa * sb) / norm)


def compare_audio_envelopes(
    ref_samples: np.ndarray,
    cur_samples: np.ndarray,
    *,
    sr: int = 48000,
    max_lag_windows: int = 2,
) -> Dict[str, Any]:
    """Adaptado de HyperFrames `compareAudioEnvelopes` (folga estrita de lag no Talho)."""
    env_a = build_rms_envelope(ref_samples, sr=sr)
    env_b = build_rms_envelope(cur_samples, sr=sr)
    melhor_corr = -1.0
    melhor_lag = 0
    for lag in range(-max_lag_windows, max_lag_windows + 1):
        c = correlation_at_lag(env_a, env_b, lag)
        if c > melhor_corr:
            melhor_corr = c
            melhor_lag = lag
    return {
        "correlacao": float(melhor_corr),
        "lag_janelas": int(melhor_lag),
        "janelas_ref": int(len(env_a)),
        "janelas_atual": int(len(env_b)),
    }


def compute_audio_residual_rms_db(
    ref_samples: np.ndarray,
    cur_samples: np.ndarray,
    *,
    sr: int = 48000,
    tolerancia_duracao_ms: float = 5.0,
) -> Dict[str, Any]:
    """Adaptado de HyperFrames `computeAudioResidualRmsDb`: pré-checa duração, subtrai e mede SNR."""
    a = np.asarray(ref_samples, dtype=np.float64)
    b = np.asarray(cur_samples, dtype=np.float64)
    dur_diff_ms = abs(len(a) - len(b)) * 1000.0 / float(sr)
    n = min(len(a), len(b))
    if n == 0:
        return {
            "ok_duracao": dur_diff_ms <= tolerancia_duracao_ms,
            "diff_duracao_ms": dur_diff_ms,
            "residuo_max": 0.0,
            "residuo_rms_db": -120.0,
            "snr_db": 120.0,
        }
    res = a[:n] - b[:n]
    rms_res = math.sqrt(float(np.mean(res * res)))
    rms_ref = math.sqrt(float(np.mean(a[:n] * a[:n])))
    res_db = 20.0 * math.log10(max(rms_res, 1e-12))
    snr_db = 20.0 * math.log10(max(rms_ref, 1e-12) / max(rms_res, 1e-12))
    return {
        "ok_duracao": dur_diff_ms <= tolerancia_duracao_ms,
        "diff_duracao_ms": round(dur_diff_ms, 3),
        "diff_amostras": abs(len(a) - len(b)),
        "residuo_max": float(np.max(np.abs(res))),
        "residuo_rms_db": round(res_db, 2),
        "snr_db": round(snr_db, 2),
    }


def rms_janelas_db(
    samples: np.ndarray,
    *,
    sr: int = 48000,
    janela_ms: float = 50.0,
) -> np.ndarray:
    """RMS em dBFS por janela contígua de `janela_ms`."""
    mono = _para_mono(samples)
    tam = max(1, int(round(sr * float(janela_ms) / 1000.0)))
    n_jan = max(1, len(mono) // tam)
    if len(mono) < tam:
        rms = math.sqrt(float(np.mean(mono * mono))) if len(mono) else 0.0
        return np.array([20.0 * math.log10(max(rms, 1e-12))], dtype=np.float64)
    blocos = mono[: n_jan * tam].reshape((n_jan, tam))
    rms = np.sqrt(np.mean(blocos * blocos, axis=1))
    return 20.0 * np.log10(np.maximum(rms, 1e-12))


def pico_dbfs(samples: np.ndarray) -> float:
    arr = np.asarray(samples, dtype=np.float64)
    if arr.size == 0:
        return -120.0
    pico = float(np.max(np.abs(arr)))
    return 20.0 * math.log10(max(pico, 1e-12))


def frequencia_dominante_hz(samples: np.ndarray, *, sr: int = 48000) -> float:
    mono = _para_mono(samples)
    if len(mono) < 16:
        return 0.0
    jan = mono * np.hanning(len(mono))
    esp = np.abs(np.fft.rfft(jan))
    freqs = np.fft.rfftfreq(len(mono), d=1.0 / float(sr))
    idx = int(np.argmax(esp[1:]) + 1)
    return float(freqs[idx])


def instante_inicio_som_s(
    samples: np.ndarray,
    *,
    sr: int = 48000,
    limiar_dbfs: float = -40.0,
) -> Optional[float]:
    mono = _para_mono(samples)
    if len(mono) == 0:
        return None
    limiar = 10.0 ** (float(limiar_dbfs) / 20.0)
    idx = np.flatnonzero(np.abs(mono) >= limiar)
    if len(idx) == 0:
        return None
    return float(idx[0]) / float(sr)
