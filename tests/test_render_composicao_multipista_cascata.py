"""Testes de renderização para composição multipista em cascata (Diretriz 10 do Plano Mestre NLE).

Valida a interação no grafo FFmpeg de uma Camada de Ajuste (com Fade Bézier e Modo de Mesclagem)
na pista V2 sobreposta a uma junção Cross Dissolve (com Color Grading e handles/tpad) na pista V1.
"""
import pytest

from src.export.video_render import grafo_video, modelo

FPS = 24.0
W = 1920
H = 1080


def _seq(clipes, tracks=None, fps=24, w=1920, h=1080):
    tr = tracks or [
        {"id": "V2", "kind": "video", "order": 1},
        {"id": "V1", "kind": "video", "order": 2},
    ]
    return modelo.normalizar({
        "version": 2, "fps": fps, "width": w, "height": h,
        "tracks": tr,
        "clips": clipes,
    })


def _cf(lado, dur, tid="tr_cascata_1", tipo="video_cross_dissolve", curva="linear"):
    return {
        "type": "crossfade",
        "side": lado,
        "duration_s": dur,
        "transitionId": tid,
        "transitionType": tipo,
        "curve": curva,
        "tension": 0.0,
    }


def test_composicao_multipista_cascata_padrao():
    """Valida o cenário canônico: Camada de Ajuste (soft-light + fade Bézier) sobre Cross Dissolve."""
    clipes = [
        # Pista V1: Clipe A (0-5s) e Clipe B (5-10s) com Cross Dissolve de 1s (halfA=0.5s, halfB=0.5s)
        {
            "id": "clip_a",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 5.0,
            "video_id": 1,
            "effects": [
                {"type": "color", "brightness": 10.0, "disabled": False},
                _cf("out", 0.5, tid="tr_1")
            ]
        },
        {
            "id": "clip_b",
            "track": "V1",
            "timeline_start": 5.0,
            "in": 2.0,
            "out": 7.0,
            "video_id": 2,
            "effects": [
                {"type": "color", "contrast": 15.0, "disabled": False},
                _cf("in", 0.5, tid="tr_1")
            ]
        },
        # Pista V2: Camada de Ajuste (3-7s) sobreposta à junção de 5s
        {
            "id": "adj_v2",
            "type": "adjustment",
            "kind": "adjustment",
            "track": "V2",
            "timeline_start": 3.0,
            "in": 0.0,
            "out": 4.0,
            "blend_mode": "soft-light",
            "effects": [
                {"type": "color", "saturation": 1.5, "disabled": False},
                _cf("in", 1.0, tid="", tipo="crossfade", curva="bezier"),
                _cf("out", 1.0, tid="", tipo="crossfade", curva="bezier")
            ]
        }
    ]

    seq = _seq(clipes)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 10.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # 1. Pista V1: Clipe A e B estendidos na junção
    # Clipe A estende até corte + halfB = 5.5s
    assert ent["clip_a"]["t"] == pytest.approx(5.5)
    # Clipe B recua de in=2.0 para ss=1.5s e t=5.5s
    assert ent["clip_b"]["ss"] == pytest.approx(1.5)
    assert ent["clip_b"]["t"] == pytest.approx(5.5)

    # 2. Pista V1: Clipe A permanece ativo até 5.5s e Clipe B sobrepõe a partir de 4.5s
    assert "between(t,0,5.5)" in fc
    assert "between(t,4.5,10)" in fc
    assert "fade=t=in:st=0:d=1:alpha=1" in fc

    # 3. Pista V2: Camada de Ajuste divide fluxo acumulado com split
    assert "split" in fc

    # 4. Pista V2: Gradação de cor aplicada na cadeia da camada de ajuste
    assert "colorchannelmixer" in fc or "eq=" in fc

    # 5. Pista V2: Modo de mesclagem softlight mapeado e habilitado na janela [3, 7]
    assert "blend=all_mode=softlight:enable='between(t,3,7)'" in fc

    # 6. Ausência de tempos negativos st < 0
    assert "st=-" not in fc


def test_composicao_multipista_com_hard_boundaries_e_tpad():
    """Valida congelamento de borda tpad=clone quando clipes não têm folga na fonte."""
    clipes = [
        {
            "id": "clip_a",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 5.0,
            "video_id": 1,
            "hard_boundaries": True,
            "effects": [_cf("out", 0.5, tid="tr_2")]
        },
        {
            "id": "clip_b",
            "track": "V1",
            "timeline_start": 5.0,
            "in": 0.0,
            "out": 5.0,
            "video_id": 2,
            "hard_boundaries": True,
            "effects": [_cf("in", 0.5, tid="tr_2")]
        },
        {
            "id": "adj_v2",
            "type": "adjustment",
            "kind": "adjustment",
            "track": "V2",
            "timeline_start": 2.0,
            "in": 0.0,
            "out": 6.0,
            "blend_mode": "overlay",
            "effects": [
                {"type": "color", "saturation": 0.5, "disabled": False}
            ]
        }
    ]

    seq = _seq(clipes)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 10.0)
    fc = g["filter_complex"]

    # Clipe A congela último quadro
    assert "tpad=stop_mode=clone:stop_duration=0.5" in fc
    # Clipe B congela primeiro quadro
    assert "tpad=start_mode=clone:start_duration=0.5" in fc

    # Camada de Ajuste aplica overlay blend mode na janela [2, 8]
    assert "blend=all_mode=overlay:enable='between(t,2,8)'" in fc


def test_composicao_multipista_camada_ajuste_com_overlay_normal():
    """Valida que Camada de Ajuste com blend_mode normal usa overlay padrão."""
    clipes = [
        {
            "id": "clip_a",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 5.0,
            "video_id": 1,
            "effects": [_cf("out", 0.5, tid="tr_3")]
        },
        {
            "id": "clip_b",
            "track": "V1",
            "timeline_start": 5.0,
            "in": 1.0,
            "out": 6.0,
            "video_id": 2,
            "effects": [_cf("in", 0.5, tid="tr_3")]
        },
        {
            "id": "adj_v2",
            "type": "adjustment",
            "kind": "adjustment",
            "track": "V2",
            "timeline_start": 2.0,
            "in": 0.0,
            "out": 6.0,
            "blend_mode": "normal",
            "effects": [
                {"type": "color", "contrast": 20.0, "disabled": False}
            ]
        }
    ]

    seq = _seq(clipes)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 10.0)
    fc = g["filter_complex"]

    # Não deve usar blend=all_mode, e sim overlay habilitado
    assert "blend=all_mode=" not in fc
    assert "overlay=x=0:y=0:enable='between(t,2,8)'" in fc


def test_composicao_multipista_bypass_camada_ajuste():
    """Valida que Camada de Ajuste com disabled=True é completamente omitida do grafo."""
    clipes = [
        {
            "id": "clip_a",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 5.0,
            "video_id": 1,
            "effects": [_cf("out", 0.5, tid="tr_4")]
        },
        {
            "id": "clip_b",
            "track": "V1",
            "timeline_start": 5.0,
            "in": 1.0,
            "out": 6.0,
            "video_id": 2,
            "effects": [_cf("in", 0.5, tid="tr_4")]
        },
        {
            "id": "adj_v2",
            "type": "adjustment",
            "kind": "adjustment",
            "track": "V2",
            "timeline_start": 2.0,
            "in": 0.0,
            "out": 6.0,
            "disabled": True,
            "blend_mode": "soft-light",
            "effects": [
                {"type": "color", "saturation": 2.0, "disabled": False}
            ]
        }
    ]

    seq = _seq(clipes)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 10.0)
    fc = g["filter_complex"]

    # Nenhum nó de ajuste gerado
    assert "split" not in fc
    assert "blend=all_mode=" not in fc

    # Transição inferior intacta
    assert "between(t,0,5.5)" in fc
    assert "between(t,4.5,10)" in fc
    assert "fade=t=in:st=0:d=1:alpha=1" in fc


def test_composicao_multipista_clipes_assimetricos_sem_st_negativo():
    """Valida clamping por min(half, a.duracao, b.duracao) prevenindo st < 0."""
    clipes = [
        # Clipe A muito curto (0.4s) seguido de Clipe B longo (6s) com transição de 1s
        {
            "id": "clip_a",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 0.4,
            "video_id": 1,
            "effects": [_cf("out", 1.0, tid="tr_5")]
        },
        {
            "id": "clip_b",
            "track": "V1",
            "timeline_start": 0.4,
            "in": 1.0,
            "out": 7.0,
            "video_id": 2,
            "effects": [_cf("in", 1.0, tid="tr_5")]
        },
        {
            "id": "adj_v2",
            "type": "adjustment",
            "kind": "adjustment",
            "track": "V2",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 5.0,
            "effects": [
                {"type": "color", "brightness": 5.0, "disabled": False}
            ]
        }
    ]

    seq = _seq(clipes)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 6.4)
    fc = g["filter_complex"]

    # Garante que nenhum offset de fade seja negativo
    assert "st=-" not in fc
    assert "fade=t=in:st=0:" in fc
