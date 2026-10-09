"""Blend mode e fade no export, medidos no PIXEL (ffmpeg de verdade).

O player compoe com mix-blend-mode (DOM) e globalCompositeOperation (render
cache): o fundo e tudo o que esta embaixo e a saida e
(1 - a) * fundo + a * B(fundo, clipe), com a = opacidade x fade. Estes testes
trocam as midias por cores solidas lavfi e comparam o quadro exportado com a
formula da W3C -- a asercao de texto do grafo deixou passar o blend errado
(verde multiply sobre vermelho saia (0,123,0) em vez de (0,38,0)).
"""
import math
import shutil
import subprocess

import pytest

from src.export.video_render import grafo_video, modelo

W, H, FPS = 160, 90, 30
VERMELHO = (200, 40, 40)
AZUL = (40, 40, 200)
CORES_VIDEO = {1: VERMELHO, 2: AZUL}
TOLERANCIA = 6  # ida e volta por yuv420p

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg ausente")


def _modo_w3c(modo, cb, cs):
    b, s = cb / 255, cs / 255
    if modo == "normal":
        r = s
    elif modo == "multiply":
        r = b * s
    elif modo == "screen":
        r = b + s - b * s
    elif modo == "overlay":
        r = 2 * b * s if b <= 0.5 else 1 - 2 * (1 - b) * (1 - s)
    elif modo == "darken":
        r = min(b, s)
    elif modo == "lighten":
        r = max(b, s)
    elif modo == "difference":
        r = abs(b - s)
    elif modo == "soft-light":
        if s <= 0.5:
            r = b - (1 - 2 * s) * b * (1 - b)
        else:
            d = ((16 * b - 12) * b + 4) * b if b <= 0.25 else math.sqrt(b)
            r = b + (2 * s - 1) * (d - b)
    else:
        raise ValueError(modo)
    return r * 255


def _esperado(modo, fundo, cor, a):
    return tuple((1 - a) * fundo[i] + a * _modo_w3c(modo, fundo[i], cor[i]) for i in range(3))


def _matte(modo="normal", cor="#00ff00", ini=2.0, dur=4.0, fade_in=None, fade_out=None, **tf):
    efeitos = [{"type": "fit", "mode": "fill"},
               {"type": "transform", "opacity": 1, "scale": 1, "x": 0, "y": 0,
                "rotation": 0, "blend_mode": modo, **tf}]
    if fade_in:
        efeitos.append({"type": "crossfade", "side": "in", "duration_s": fade_in})
    if fade_out:
        efeitos.append({"type": "crossfade", "side": "out", "duration_s": fade_out})
    return {"id": "cut_matte_t", "kind": "color_matte", "color": cor, "blend_mode": modo,
            "type": "video", "in": 0, "out": dur, "track": "V2", "timeline_start": ini,
            "effects": efeitos}


def _seq(*clipes_v2, fps=FPS):
    return {"fps": fps, "width": W, "height": H,
            "tracks": [{"id": "V2", "kind": "video"}, {"id": "V1", "kind": "video"}],
            "clips": [{"id": "v1", "type": "video", "video_id": 1, "in": 0, "out": 10,
                       "track": "V1", "timeline_start": 0, "effects": []}, *clipes_v2]}


def _renderizar(seq_dict, ini, fim, fps=FPS):
    """Quadros RGB do grafo de video, com as midias trocadas por cor solida."""
    seq = modelo.normalizar(seq_dict)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), ini, fim)
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "error"]
    for e in g["entradas"]:
        r, gg, b = CORES_VIDEO[e["video_id"]]
        cmd += ["-f", "lavfi", "-i",
                f"color=c=0x{r:02x}{gg:02x}{b:02x}:s={W}x{H}:r={fps}:d={e['t']}"]
    cmd += ["-filter_complex", g["filter_complex"] + ";[vout]format=rgb24[fim]",
            "-map", "[fim]", "-t", str(fim - ini), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.run(cmd, capture_output=True)
    assert p.returncode == 0, p.stderr.decode(errors="replace")[-2000:]
    tam = W * H * 3
    quadros = len(p.stdout) // tam

    def pixel(quadro, x=W // 2, y=H // 2):
        o = quadro * tam + (y * W + x) * 3
        return tuple(p.stdout[o:o + 3])
    return pixel, quadros


def _perto(medido, esperado):
    return max(abs(m - e) for m, e in zip(medido, esperado)) <= TOLERANCIA


@pytest.mark.parametrize("modo", ["multiply", "screen", "overlay", "darken", "lighten",
                                  "difference", "soft-light"])
@pytest.mark.parametrize("cor", ["#00ff00", "#3366cc"])
def test_blend_bate_com_a_formula_do_navegador(modo, cor):
    pixel, n = _renderizar(_seq(_matte(modo, cor=cor)), 0, 8)
    assert n == 8 * FPS
    fundo = pixel(1 * FPS)
    assert _perto(fundo, VERMELHO)
    cs = tuple(int(cor[i:i + 2], 16) for i in (1, 3, 5))
    medido = pixel(4 * FPS)
    assert _perto(medido, _esperado(modo, fundo, cs, 1.0)), (modo, cor, medido)


def test_fade_modula_o_blend():
    """Fade de 1 s em multiply: meio da rampa = metade do efeito (o blend antigo ignorava)."""
    pixel, _ = _renderizar(_seq(_matte("multiply", fade_in=1, fade_out=1)), 0, 8)
    fundo = pixel(1 * FPS)
    verde = (0, 255, 0)
    for quadro, a in [(2 * FPS, 0.0), (int(2.5 * FPS), 0.5), (3 * FPS, 1.0),
                      (int(5.5 * FPS), 0.5), (6 * FPS, 0.0)]:
        medido = pixel(quadro)
        assert _perto(medido, _esperado("multiply", fundo, verde, a)), (quadro, medido)


def test_fade_de_cor_solida_normal_e_fim_sem_quadro_extra():
    """Cor solida normal com fade, e o quadro seguinte ao fim ja sem ela (o player
    mostra em [inicio, inicio + duracao))."""
    pixel, _ = _renderizar(_seq(_matte("normal", fade_in=1, fade_out=1)), 0, 8)
    fundo = pixel(1 * FPS)
    verde = (0, 255, 0)
    assert _perto(pixel(int(2.5 * FPS)), _esperado("normal", fundo, verde, 0.5))
    assert _perto(pixel(4 * FPS), verde)
    pixel, _ = _renderizar(_seq(_matte("normal")), 0, 8)
    assert _perto(pixel(6 * FPS - 1), verde)
    assert _perto(pixel(6 * FPS), VERMELHO)


@pytest.mark.parametrize("ini,fim", [(3.5, 5.5), (2 - 1 / FPS, 8), (0, 6 + 1 / FPS)])
def test_blend_em_faixa_in_out_mantem_quadros_e_tempo(ini, fim):
    """In/Out no meio do blend e cabeca/cauda de 1 quadro (concat estimaria
    duracao zero e atrasaria tudo um quadro)."""
    pixel, n = _renderizar(_seq(_matte("multiply")), ini, fim)
    assert n == round((fim - ini) * FPS)
    mult = _esperado("multiply", VERMELHO, (0, 255, 0), 1.0)
    for t_timeline in (2.0, 4.0, 6 - 1 / FPS):
        if ini <= t_timeline < fim:
            assert _perto(pixel(round((t_timeline - ini) * FPS)), mult), t_timeline
    for t_timeline in (2 - 1 / FPS, 6.0):
        if ini <= t_timeline < fim:
            assert _perto(pixel(round((t_timeline - ini) * FPS)), VERMELHO), t_timeline


def test_blend_com_escala_so_mexe_onde_o_clipe_esta():
    pixel, _ = _renderizar(_seq(_matte("multiply", scale=0.5)), 0, 8)
    mult = _esperado("multiply", VERMELHO, (0, 255, 0), 1.0)
    assert _perto(pixel(4 * FPS), mult)
    assert _perto(pixel(4 * FPS, 3, 3), VERMELHO)


def test_video_com_blend_e_pista_de_cima_normal():
    video_mult = {"id": "v2", "type": "video", "video_id": 2, "in": 0, "out": 3,
                  "track": "V2", "timeline_start": 3, "blend_mode": "multiply",
                  "effects": [{"type": "fit", "mode": "fill"}]}
    seq = _seq(_matte("screen", ini=1, dur=2), video_mult)
    seq["tracks"].insert(0, {"id": "V3", "kind": "video"})
    seq["clips"].append({**_matte("normal", cor="#ffffff", ini=5, dur=1), "id": "cut_matte_v3",
                         "track": "V3"})
    pixel, n = _renderizar(seq, 0, 8)
    assert n == 8 * FPS
    assert _perto(pixel(2 * FPS), _esperado("screen", VERMELHO, (0, 255, 0), 1.0))
    assert _perto(pixel(4 * FPS), _esperado("multiply", VERMELHO, AZUL, 1.0))
    assert _perto(pixel(int(5.5 * FPS)), (255, 255, 255))
    assert _perto(pixel(int(6.5 * FPS)), VERMELHO)


def test_camada_de_ajuste_com_blend_e_fade():
    """Ajuste em multiply sem efeito de cor: fundo x fundo, com fade de 1 s a partir de 2 s."""
    seq = _seq({"id": "cut_adj_1", "kind": "adjustment", "type": "adjustment", "in": 0,
                "out": 4, "track": "V2", "timeline_start": 2, "blend_mode": "multiply",
                "effects": [{"type": "crossfade", "side": "in", "duration_s": 1}]})
    pixel, n = _renderizar(seq, 0, 8)
    assert n == 8 * FPS
    fundo = pixel(1 * FPS)
    for quadro, a in [(2 * FPS, 0.0), (int(2.5 * FPS), 0.5), (4 * FPS, 1.0), (6 * FPS, 0.0)]:
        assert _perto(pixel(quadro), _esperado("multiply", fundo, fundo, a)), quadro


def test_mapeamento_de_modos():
    assert grafo_video.mapear_blend_mode("softlight") == "soft-light"
    assert grafo_video.mapear_blend_mode("Multiply") == "multiply"
    assert grafo_video.mapear_blend_mode("luminosity") == "normal"  # nao separavel
    assert grafo_video.mapear_blend_mode(None) == "normal"
