"""Oráculos analíticos e metamórficos da regressão do render (Frente B)."""
from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from src.export.video_render import cor as _cor
from src.export.video_render import fade as _fade


def _modo_w3c(modo: str, cb: float, cs: float) -> float:
    """Fórmula W3C Compositing & Blending Level 1 por canal [0..255]."""
    b, s = cb / 255.0, cs / 255.0
    if modo == "normal":
        r = s
    elif modo == "multiply":
        r = b * s
    elif modo == "screen":
        r = b + s - b * s
    elif modo == "overlay":
        r = 2 * b * s if b <= 0.5 else 1 - 2 * (1 - b) * (1 - s)
    elif modo == "hard-light":
        r = 2 * b * s if s <= 0.5 else 1 - 2 * (1 - b) * (1 - s)
    elif modo == "darken":
        r = min(b, s)
    elif modo == "lighten":
        r = max(b, s)
    elif modo == "difference":
        r = abs(b - s)
    elif modo == "exclusion":
        r = b + s - 2 * b * s
    elif modo == "soft-light":
        if s <= 0.5:
            r = b - (1 - 2 * s) * b * (1 - b)
        else:
            d = ((16 * b - 12) * b + 4) * b if b <= 0.25 else math.sqrt(b)
            r = b + (2 * s - 1) * (d - b)
    else:
        raise ValueError(modo)
    return r * 255.0


def _esperado(modo: str, fundo: Tuple[float, float, float], cor_s: Tuple[float, float, float], a: float) -> Tuple[float, ...]:
    return tuple((1 - a) * fundo[i] + a * _modo_w3c(modo, fundo[i], cor_s[i]) for i in range(3))


def blend_w3c_numpy(
    modo: str,
    fundo_rgb: np.ndarray,
    topo_rgb: np.ndarray,
    alpha: float | np.ndarray = 1.0,
) -> np.ndarray:
    """Versão vetorizada em NumPy da composição W3C por canal."""
    b = np.asarray(fundo_rgb, dtype=np.float64) / 255.0
    s = np.asarray(topo_rgb, dtype=np.float64) / 255.0
    m = str(modo or "normal").strip().lower()
    if m == "softlight":
        m = "soft-light"
    elif m == "hardlight":
        m = "hard-light"

    if m == "normal":
        r = s
    elif m == "multiply":
        r = b * s
    elif m == "screen":
        r = b + s - b * s
    elif m == "overlay":
        r = np.where(b <= 0.5, 2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s))
    elif m == "hard-light":
        r = np.where(s <= 0.5, 2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s))
    elif m == "darken":
        r = np.minimum(b, s)
    elif m == "lighten":
        r = np.maximum(b, s)
    elif m == "difference":
        r = np.abs(b - s)
    elif m == "exclusion":
        r = b + s - 2.0 * b * s
    elif m == "soft-light":
        d = np.where(b <= 0.25, ((16.0 * b - 12.0) * b + 4.0) * b, np.sqrt(np.maximum(b, 0.0)))
        r = np.where(
            s <= 0.5,
            b - (1.0 - 2.0 * s) * b * (1.0 - b),
            b + (2.0 * s - 1.0) * (d - b),
        )
    else:
        raise ValueError(f"Modo de blend desconhecido no oráculo: {modo!r}")

    a = np.asarray(alpha, dtype=np.float64)
    if a.ndim == 2:
        a = a[..., None]
    out = ((1.0 - a) * b + a * r) * 255.0
    return np.clip(np.round(out), 0, 255).astype(np.uint8)


def ids_esperados_clipe(
    clipe: Any,
    fps: float,
    n_quadros: int,
    *,
    formula: str = "export",
) -> List[int]:
    """Índices de quadro de origem esperados para um clipe em `[0, n_quadros)`."""
    if n_quadros <= 0:
        return []
    if getattr(clipe, "congelado", False):
        alvo = int(round(float(clipe.congelar_em_s) * fps))
        return [alvo] * n_quadros

    vel = float(getattr(clipe, "velocidade", 1.0))
    in_s = float(clipe.in_s)
    out_s = float(clipe.out_s)
    reverso = bool(getattr(clipe, "reverso", False))
    saida: List[int] = []

    if not reverso:
        for q in range(n_quadros):
            t_fonte = in_s + (q / fps) * vel
            idx = int(math.floor(t_fonte * fps + 1e-6))
            max_idx = max(0, int(round(out_s * fps)) - 1)
            saida.append(min(max(0, idx), max_idx))
        return saida

    if formula == "player":
        # player.js:4540 -> outSec - offsetSec
        for q in range(n_quadros):
            t_fonte = out_s - (q / fps) * vel
            idx = int(round(t_fonte * fps))
            saida.append(max(0, idx))
        return saida

    # formula == "export": reverse do FFmpeg sobre o trecho [in_s, out_s)
    primeiro_reverso = max(0, int(round(out_s * fps)) - 1)
    min_idx = max(0, int(round(in_s * fps)))
    for q in range(n_quadros):
        idx = int(round(primeiro_reverso - q * vel))
        saida.append(max(min_idx, idx))
    return saida


def ids_esperados_sequencia(
    seq: Any,
    pista_id: str,
    inicio_s: float = 0.0,
    fim_s: Optional[float] = None,
    *,
    formula: str = "export",
    mapa_fonte_bit: Optional[Dict[int, int]] = None,
) -> List[Optional[Tuple[int, int]]]:
    """Devolve `[(quadro_origem, fonte_bit) | None, ...]` para uma pista na janela."""
    fps = float(seq.fps)
    ini_s = float(inicio_s)
    f_s = float(seq.duracao_s() if fim_s is None else fim_s)
    n_total = max(0, int(round((f_s - ini_s) * fps)))
    resultado: List[Optional[Tuple[int, int]]] = [None] * n_total
    mapa_bits = mapa_fonte_bit or {1: 0, 2: 1}

    clipes = seq.clipes_da_pista(str(pista_id))
    for c in clipes:
        c_ini = max(c.inicio_s, ini_s)
        c_fim = min(c.fim_s, f_s)
        if c_fim <= c_ini + 1e-9:
            continue
        q0 = int(round((c_ini - ini_s) * fps))
        q1 = min(n_total, int(round((c_fim - ini_s) * fps)))
        if q1 <= q0:
            continue
        fonte_bit = int(mapa_bits.get(int(c.video_id or 1), 0))
        delta_timeline = c_ini - c.inicio_s
        # Cria cópia leve ajustada à janela cortada
        if getattr(c, "congelado", False):
            ss, dur_fonte = c.congelar_em_s, (c_fim - c_ini)
            sub_in, sub_out = c.in_s, c.out_s
        else:
            ss, dur_fonte = c.trecho_fonte(delta_timeline, c_fim - c_ini)
            sub_in, sub_out = ss, ss + dur_fonte

        class _Sub:
            congelado = getattr(c, "congelado", False)
            congelar_em_s = getattr(c, "congelar_em_s", 0.0)
            velocidade = getattr(c, "velocidade", 1.0)
            reverso = getattr(c, "reverso", False)
            in_s = sub_in
            out_s = sub_out

        ids_sub = ids_esperados_clipe(_Sub(), fps, q1 - q0, formula=formula)
        for off, idx_src in enumerate(ids_sub):
            resultado[q0 + off] = (idx_src, fonte_bit)

    return resultado


def aplicar_cor_css_numpy(rgb_uint8: np.ndarray, efeito_color: Dict[str, Any]) -> np.ndarray:
    """Reproduz Filter Effects (sRGB, grampeando entre estágios) como `cor.py`."""
    if not isinstance(efeito_color, dict) or efeito_color.get("disabled"):
        return np.asarray(rgb_uint8, dtype=np.uint8).copy()

    img = np.asarray(rgb_uint8, dtype=np.float64).copy()

    def _num(chave: str, padrao: float) -> float:
        try:
            return float(efeito_color.get(chave))
        except (TypeError, ValueError):
            return padrao

    def _clamp_round(arr: np.ndarray) -> np.ndarray:
        return np.clip(np.round(arr), 0.0, 255.0)

    brilho = _num("brightness", 0.0)
    contraste = _num("contrast", 0.0)
    saturacao = _num("saturation", 100.0)
    matiz = _num("hue", 0.0)
    sepia = _num("sepia", 0.0)
    cinza = _num("grayscale", 0.0)

    kb = 1.0 + brilho / 100.0
    if abs(kb - 1.0) > 1e-9:
        img = _clamp_round(img * kb)

    kc = 1.0 + contraste / 100.0
    if abs(kc - 1.0) > 1e-9:
        img = _clamp_round(img * kc + 127.5 * (1.0 - kc))

    def _aplicar_matriz(arr: np.ndarray, m: Tuple[Tuple[float, float, float], ...]) -> np.ndarray:
        mat = np.asarray(m, dtype=np.float64)
        out = arr @ mat.T
        return _clamp_round(out)

    k_sat = saturacao / 100.0
    if abs(k_sat - 1.0) > 1e-9:
        img = _aplicar_matriz(img, _cor.matriz_saturate(k_sat))

    if abs(matiz % 360.0) > 1e-9 and abs(abs(matiz % 360.0) - 360.0) > 1e-9:
        img = _aplicar_matriz(img, _cor.matriz_hue(matiz))

    if abs(sepia) > 1e-9:
        img = _aplicar_matriz(img, _cor.matriz_sepia(min(max(sepia, 0.0), 100.0) / 100.0))

    if abs(cinza) > 1e-9:
        a = min(max(cinza, 0.0), 100.0) / 100.0
        img = _aplicar_matriz(img, _cor.matriz_saturate(1.0 - a))

    return img.astype(np.uint8)


def avaliar_fade_curva(progresso: float, curve: str = "linear", tension: float = 0.0) -> float:
    return float(_fade.avaliar(progresso, curve=curve, tension=tension))


def centroide_marcador(
    quadro_rgb: np.ndarray,
    *,
    cor_alvo: Tuple[int, int, int] = (0, 255, 255),
    tolerancia: float = 60.0,
    regiao: Optional[Tuple[int, int, int, int]] = None,
) -> Optional[Tuple[float, float]]:
    """Calcula `(cx, cy)` do marcador mais próximo de `cor_alvo` dentro da tolerância."""
    arr = np.asarray(quadro_rgb, dtype=np.float64)
    alvo = np.asarray(cor_alvo, dtype=np.float64)
    if regiao is not None:
        x0, y0, x1, y1 = regiao
        sub = arr[y0:y1, x0:x1]
        ox, oy = float(x0), float(y0)
    else:
        sub = arr
        ox, oy = 0.0, 0.0

    dist = np.linalg.norm(sub - alvo[None, None, :], axis=-1)
    ys, xs = np.nonzero(dist <= float(tolerancia))
    if len(xs) == 0:
        return None
    return float(xs.mean() + ox), float(ys.mean() + oy)


REGISTRO_ORACULOS: Dict[str, Callable[..., Any]] = {
    "blend_w3c": blend_w3c_numpy,
    "ids_esperados_clipe": ids_esperados_clipe,
    "ids_esperados_sequencia": ids_esperados_sequencia,
    "cor_css": aplicar_cor_css_numpy,
    "fade_curva": avaliar_fade_curva,
    "centroide_marcador": centroide_marcador,
}
