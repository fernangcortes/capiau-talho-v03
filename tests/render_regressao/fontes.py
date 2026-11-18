"""Mídias sintéticas determinísticas e código de barras de 11 bits para a regressão."""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

PASTA_MIDIA = Path(__file__).resolve().parent / "midia"

BARCODE_X0 = 24
BARCODE_Y0 = 4
BARCODE_Y1 = 16
BARCODE_CELULA_W = 16
BARCODE_TOTAL_BITS = 11  # 10 bits quadro_idx (MSB) + 1 bit fonte_id

_LARGURA_PADRAO = 320
_ALTURA_PADRAO = 180


def gerar_quadro_barras(
    quadro_idx: int,
    fonte_id: int,
    largura: int = _LARGURA_PADRAO,
    altura: int = _ALTURA_PADRAO,
) -> np.ndarray:
    """Gera um quadro RGB uint8 com gradiente distinto, 4 marcadores 8x8 e código de barras."""
    x = np.linspace(0.0, 1.0, largura, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, altura, dtype=np.float32)[:, None]

    if int(fonte_id) == 0:
        r = 18.0 + 72.0 * x + 15.0 * y
        g = 28.0 + 25.0 * x + 85.0 * y
        b = 68.0 + 75.0 * (1.0 - x) + 12.0 * y
    else:
        r = 68.0 + 72.0 * x + 15.0 * (1.0 - y)
        g = 34.0 + 82.0 * (1.0 - y) + 14.0 * x
        b = 20.0 + 52.0 * y + 20.0 * x

    img = np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)

    # 4 marcadores de canto 8x8 em magenta vivo (longe do código de barras)
    for mx, my in ((4, 4), (largura - 12, 4), (4, altura - 12), (largura - 12, altura - 12)):
        img[my : my + 8, mx : mx + 8] = (255, 64, 255)

    # Código de barras de 11 bits: 10 bits de quadro_idx + 1 bit fonte_id
    idx_clamp = int(quadro_idx) & 0x3FF
    bits = [(idx_clamp >> (9 - i)) & 1 for i in range(10)]
    bits.append(1 if int(fonte_id) else 0)
    for i, bit in enumerate(bits):
        cx0 = BARCODE_X0 + i * BARCODE_CELULA_W
        cx1 = cx0 + BARCODE_CELULA_W
        val = 235 if bit else 16
        img[BARCODE_Y0:BARCODE_Y1, cx0:cx1] = (val, val, val)

    return img


def ler_codigo_barras(quadro_rgb: np.ndarray) -> Tuple[int, int]:
    """Lê `(quadro_idx, fonte_id)` do código de barras de 11 bits de um quadro RGB."""
    arr = np.asarray(quadro_rgb, dtype=np.float32)
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    bits: List[int] = []
    y_a, y_b = BARCODE_Y0 + 3, BARCODE_Y1 - 3
    for i in range(BARCODE_TOTAL_BITS):
        x_a = BARCODE_X0 + i * BARCODE_CELULA_W + 4
        x_b = BARCODE_X0 + (i + 1) * BARCODE_CELULA_W - 4
        media = float(luma[y_a:y_b, x_a:x_b].mean())
        bits.append(1 if media >= 125.0 else 0)

    quadro_idx = 0
    for b in bits[:10]:
        quadro_idx = (quadro_idx << 1) | b
    return quadro_idx, bits[10]


def ler_ids(quadros_rgb: np.ndarray) -> List[Tuple[int, int]]:
    """Lê `[(quadro_idx, fonte_id), ...]` de todos os quadros de um lote `(N, H, W, 3)`."""
    return [ler_codigo_barras(quadros_rgb[i]) for i in range(len(quadros_rgb))]


def ler_alpha_dissolve(
    quadro_rgb: np.ndarray,
    luma_a: float = 16.0,
    luma_b: float = 235.0,
) -> float:
    """Estima α(t) a partir da célula 11 (bit de fonte: A=0 preto, B=1 branco)."""
    arr = np.asarray(quadro_rgb, dtype=np.float32)
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    x_a = BARCODE_X0 + 10 * BARCODE_CELULA_W + 4
    x_b = BARCODE_X0 + 11 * BARCODE_CELULA_W - 4
    media = float(luma[BARCODE_Y0 + 3 : BARCODE_Y1 - 3, x_a:x_b].mean())
    denom = max(1e-6, float(luma_b - luma_a))
    return float(np.clip((media - luma_a) / denom, 0.0, 1.0))


def gerar_foto_sintetica(destino: Path, largura: int = 320, altura: int = 180) -> Path:
    """Gera `foto.png` determinística com 4 marcadores brancos e 1 marcador ciano central."""
    x = np.linspace(0.0, 1.0, largura, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, altura, dtype=np.float32)[:, None]
    r = 18.0 + 70.0 * x + 0.0 * y
    g = 28.0 + 0.0 * x + 70.0 * y
    b = 38.0 + 60.0 * (1.0 - x) + 0.0 * y
    img = np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)

    for mx, my in ((40, 36), (largura - 48, 36), (40, altura - 44), (largura - 48, altura - 44)):
        img[my : my + 8, mx : mx + 8] = (255, 255, 255)
    # Marcador ciano exatamente centrado em (160, 90) no 320x180
    cx0, cy0 = largura // 2 - 5, altura // 2 - 5
    img[cy0 : cy0 + 10, cx0 : cx0 + 10] = (0, 255, 255)

    destino.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGB").save(destino, format="PNG")
    return destino


def _codificar_video_barras(
    destino: Path,
    *,
    fonte_id: int,
    fps_str: str,
    n_quadros: int,
    codec: str = "h264",
    largura: int = _LARGURA_PADRAO,
    altura: int = _ALTURA_PADRAO,
) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    bruto = b"".join(
        gerar_quadro_barras(i, fonte_id, largura=largura, altura=altura).tobytes()
        for i in range(n_quadros)
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-v", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{largura}x{altura}", "-framerate", str(fps_str),
        "-i", "-",
        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
    ]
    if codec == "vp9":
        cmd += ["-c:v", "libvpx-vp9", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p"]
    else:
        cmd += [
            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "12",
            "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709",
            "-color_trc", "bt709", "-color_range", "tv",
        ]
    cmd += ["-threads", "1", str(destino)]
    subprocess.run(cmd, input=bruto, check=True, capture_output=True)
    return destino


def _codificar_smpte_hd(destino: Path, *, etiquetado: bool) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    vf = (
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
        if etiquetado
        else "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=unknown:color_primaries=unknown:color_trc=unknown"
    )
    cmd = [
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", "smptehdbars=size=1280x720:rate=24:duration=1",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p",
    ]
    if etiquetado:
        cmd += [
            "-colorspace", "bt709", "-color_primaries", "bt709",
            "-color_trc", "bt709", "-color_range", "tv",
        ]
    cmd += ["-threads", "1", str(destino)]
    subprocess.run(cmd, check=True, capture_output=True)
    return destino


def mapa_midias_sinteticas() -> Dict[str, Path]:
    return {
        "barras_a.mp4": PASTA_MIDIA / "barras_a.mp4",
        "barras_b.mp4": PASTA_MIDIA / "barras_b.mp4",
        "barras_a.webm": PASTA_MIDIA / "barras_a.webm",
        "barras_b.webm": PASTA_MIDIA / "barras_b.webm",
        "barras_25.mp4": PASTA_MIDIA / "barras_25.mp4",
        "barras_2997.mp4": PASTA_MIDIA / "barras_2997.mp4",
        "barras_60.mp4": PASTA_MIDIA / "barras_60.mp4",
        "smpte_hd_709.mp4": PASTA_MIDIA / "smpte_hd_709.mp4",
        "smpte_hd_semtag.mp4": PASTA_MIDIA / "smpte_hd_semtag.mp4",
        "foto.png": PASTA_MIDIA / "foto.png",
    }


def garantir_midias_sinteticas(*, forcar: bool = False) -> Dict[str, Path]:
    """Gera em `tests/render_regressao/midia/` os arquivos sintéticos que faltarem."""
    PASTA_MIDIA.mkdir(parents=True, exist_ok=True)
    mapa = mapa_midias_sinteticas()

    specs_video = [
        ("barras_a.mp4", 0, "24", 144, "h264"),
        ("barras_b.mp4", 1, "24", 144, "h264"),
        ("barras_a.webm", 0, "24", 144, "vp9"),
        ("barras_b.webm", 1, "24", 144, "vp9"),
        ("barras_25.mp4", 0, "25", 100, "h264"),
        ("barras_2997.mp4", 0, "30000/1001", 120, "h264"),
        ("barras_60.mp4", 0, "60", 180, "h264"),
    ]
    for nome, fid, fps_s, n_q, codec in specs_video:
        alvo = mapa[nome]
        if forcar or not alvo.is_file():
            _codificar_video_barras(alvo, fonte_id=fid, fps_str=fps_s, n_quadros=n_q, codec=codec)

    if forcar or not mapa["smpte_hd_709.mp4"].is_file():
        _codificar_smpte_hd(mapa["smpte_hd_709.mp4"], etiquetado=True)
    if forcar or not mapa["smpte_hd_semtag.mp4"].is_file():
        _codificar_smpte_hd(mapa["smpte_hd_semtag.mp4"], etiquetado=False)
    if forcar or not mapa["foto.png"].is_file():
        gerar_foto_sintetica(mapa["foto.png"])

    return mapa


# ---------------------------------------------------------------------------
# Áudio sintético (gerado em tmp_path, nunca versionado)
# ---------------------------------------------------------------------------

def _escrever_wav_pcm16(destino: Path, samples: np.ndarray, sr: int = 48000) -> Path:
    destino.parent.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(samples, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr[:, None]
    pcm = np.clip(arr * 32767.0, -32768.0, 32767.0).round().astype("<i2")
    with wave.open(str(destino), "wb") as wf:
        wf.setnchannels(pcm.shape[1])
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(pcm.tobytes())
    return destino


def gerar_wav_seno(
    destino: Path,
    *,
    freq_hz: float = 1000.0,
    dbfs: float = -20.0,
    duracao_s: float = 4.0,
    sr: int = 48000,
    canais: int = 2,
) -> Path:
    n = int(round(duracao_s * sr))
    t = np.arange(n, dtype=np.float64) / float(sr)
    amp = 10.0 ** (float(dbfs) / 20.0)
    onda = amp * np.sin(2.0 * np.pi * float(freq_hz) * t)
    sinal = np.tile(onda[:, None], (1, canais))
    return _escrever_wav_pcm16(destino, sinal, sr=sr)


def gerar_wav_ruido(
    destino: Path,
    *,
    seed: int = 12345,
    rms_dbfs: float = -18.0,
    duracao_s: float = 4.0,
    sr: int = 48000,
    canais: int = 2,
) -> Path:
    n = int(round(duracao_s * sr))
    rng = np.random.default_rng(int(seed))
    bruto = rng.standard_normal((n, canais))
    rms_atual = np.sqrt(np.mean(bruto ** 2, axis=0, keepdims=True))
    alvo = 10.0 ** (float(rms_dbfs) / 20.0)
    sinal = np.clip(bruto * (alvo / np.maximum(rms_atual, 1e-12)), -0.99, 0.99)
    return _escrever_wav_pcm16(destino, sinal, sr=sr)


def gerar_wav_degraus(
    destino: Path,
    *,
    degraus_db: Sequence[float] = (-36.0, -24.0, -18.0, -12.0, -6.0, -1.0),
    dur_degrau_s: float = 0.5,
    freq_hz: float = 1000.0,
    sr: int = 48000,
    canais: int = 2,
) -> Path:
    partes = []
    n_seg = int(round(dur_degrau_s * sr))
    t = np.arange(n_seg, dtype=np.float64) / float(sr)
    base = np.sin(2.0 * np.pi * float(freq_hz) * t)
    for db in degraus_db:
        amp = 10.0 ** (float(db) / 20.0)
        partes.append(np.tile((amp * base)[:, None], (1, canais)))
    return _escrever_wav_pcm16(destino, np.vstack(partes), sr=sr)


def gerar_wav_rajadas_eq(
    destino: Path,
    *,
    freqs_hz: Sequence[float] = (100.0, 1000.0, 8000.0),
    dbfs: float = -18.0,
    dur_cada_s: float = 0.8,
    silencio_s: float = 0.2,
    sr: int = 48000,
    canais: int = 2,
) -> Path:
    partes = []
    n_ton = int(round(dur_cada_s * sr))
    n_sil = int(round(silencio_s * sr))
    amp = 10.0 ** (float(dbfs) / 20.0)
    t = np.arange(n_ton, dtype=np.float64) / float(sr)
    sil = np.zeros((n_sil, canais), dtype=np.float64)
    for f in freqs_hz:
        onda = amp * np.sin(2.0 * np.pi * float(f) * t)
        partes.append(np.tile(onda[:, None], (1, canais)))
        if n_sil > 0:
            partes.append(sil)
    return _escrever_wav_pcm16(destino, np.vstack(partes), sr=sr)


def gerar_wav_impulso(
    destino: Path,
    *,
    inicio_silencio_s: float = 1.0,
    duracao_s: float = 3.0,
    freq_hz: float = 1000.0,
    dbfs: float = -12.0,
    sr: int = 48000,
    canais: int = 2,
) -> Path:
    n_total = int(round(duracao_s * sr))
    n_sil = min(n_total, max(0, int(round(inicio_silencio_s * sr))))
    sinal = np.zeros((n_total, canais), dtype=np.float64)
    t = np.arange(n_total - n_sil, dtype=np.float64) / float(sr)
    amp = 10.0 ** (float(dbfs) / 20.0)
    onda = amp * np.sin(2.0 * np.pi * float(freq_hz) * t)
    sinal[n_sil:, :] = onda[:, None]
    return _escrever_wav_pcm16(destino, sinal, sr=sr)
