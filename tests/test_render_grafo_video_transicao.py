"""Testes do grafo de vídeo para transições de junção (Cross Dissolve, Dips, tpad e handles)."""
import pytest

from src.export.video_render import grafo_video, modelo


def _seq(clipes, fps=30, w=1920, h=1080):
    return modelo.normalizar({
        "version": 2, "fps": fps, "width": w, "height": h,
        "tracks": [{"id": "V1", "kind": "video"}],
        "clips": clipes,
    })


def _janela(ini, fim, fps=30):
    """enable do overlay de um clipe em [ini, fim): meio quadro de folga (ver grafo_video)."""
    return grafo_video._enable_janela(ini, fim, fps)


def _cf(lado, dur, tid="tr1", tipo="video_cross_dissolve"):
    return {
        "type": "crossfade",
        "side": lado,
        "duration_s": dur,
        "transitionId": tid,
        "transitionType": tipo,
        "curve": "linear",
        "tension": 0.0,
    }


def test_video_cross_dissolve_com_folga_estende_fontes_sem_tpad():
    """Clip B com in=5.0 tem folga para recuar; Clip A sem hard_boundaries estende o out."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "video_id": 1, "effects": [_cf("out", 1.0)]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
         "video_id": 2, "effects": [_cf("in", 0.5)]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # A estende até corte + halfB = 10.5s (t_fonte passa de 10.0 para 10.5)
    assert ent["a"]["t"] == pytest.approx(10.5)
    assert ent["a"]["ss"] == pytest.approx(0.0)

    # B recua até corte - halfA = 9.0s (ss passa de 5.0 para 4.0, t passa de 10.0 para 11.0)
    assert ent["b"]["ss"] == pytest.approx(4.0)
    assert ent["b"]["t"] == pytest.approx(11.0)

    # Sem tpad porque ambas têm folga de mídia
    assert "tpad" not in fc

    # Clip A permanece visível na camada até 10.5s
    assert _janela(0, 10.5) in fc

    # Clip B começa em 9.0s e sobrepõe até 20.0s
    assert _janela(9, 20) in fc

    # Clip B tem fade de entrada cobrindo a janela inteira da transição (span = 1.5s)
    assert "fade=t=in:st=0:d=1.5:alpha=1" in fc


def test_video_cross_dissolve_hard_boundaries_usa_tpad_clone():
    """Clipes com hard_boundaries=True não leem fora de [in, out] e usam tpad=clone."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "video_id": 1, "hard_boundaries": True, "effects": [_cf("out", 1.0)]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
         "video_id": 2, "hard_boundaries": True, "effects": [_cf("in", 0.5)]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # Entradas de mídia não violam os limites in/out autorados
    assert ent["a"]["t"] == pytest.approx(10.0)
    assert ent["b"]["ss"] == pytest.approx(5.0)
    assert ent["b"]["t"] == pytest.approx(10.0)

    # Clip A congela o último quadro pelo halfB (0.5s)
    assert "tpad=stop_mode=clone:stop_duration=0.5" in fc

    # Clip B congela o primeiro quadro pelo halfA (1.0s)
    assert "tpad=start_mode=clone:start_duration=1" in fc

    # Transição é contínua: enable de A até 10.5s e B com fade de 1.5s a partir de 9.0s
    assert _janela(0, 10.5) in fc
    assert _janela(9, 20) in fc
    assert "fade=t=in:st=0:d=1.5:alpha=1" in fc


def test_video_cross_dissolve_sem_folga_de_cabeca_usa_tpad():
    """Clip B com in=0.0 não pode ler antes de 0; usa tpad start_mode=clone."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "video_id": 1, "effects": [_cf("out", 1.0)]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 0.0, "out": 10.0,
         "video_id": 2, "effects": [_cf("in", 0.5)]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # ss de B não fica negativo
    assert ent["b"]["ss"] >= 0.0
    assert ent["b"]["t"] == pytest.approx(10.0)

    # tpad start clona o início de B
    assert "tpad=start_mode=clone:start_duration=1" in fc


def test_video_dip_to_black_nao_estende_clipes():
    """Dip to black realiza mergulho no preto no ponto de corte sem estender mídia."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "video_id": 1, "effects": [_cf("out", 1.0, tipo="video_dip_black")]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
         "video_id": 2, "effects": [_cf("in", 0.5, tipo="video_dip_black")]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # Duração das entradas não é estendida
    assert ent["a"]["t"] == pytest.approx(10.0)
    assert ent["b"]["ss"] == pytest.approx(5.0)
    assert ent["b"]["t"] == pytest.approx(10.0)

    # Sem tpad
    assert "tpad" not in fc

    # A faz fade out de 1.0s até o corte 10.0s
    assert "fade=t=out:st=9:d=1:alpha=1" in fc

    # B faz fade in de 0.5s a partir do corte 10.0s
    assert "fade=t=in:st=0:d=0.5:alpha=1" in fc


def test_escopo_sem_transicoes_desliga_cross_dissolve():
    """Quando categoria transitions está desmarcada, clipes não são estendidos."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "video_id": 1, "effects": [_cf("out", 1.0)]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
         "video_id": 2, "effects": [_cf("in", 0.5)]},
    ])
    escopo = modelo.Escopo(categorias={modelo.CATEGORIA_TRANSICOES: False})
    g = grafo_video.grafo_completo(seq, escopo, 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    assert ent["a"]["t"] == pytest.approx(10.0)
    assert ent["b"]["ss"] == pytest.approx(5.0)
    assert "tpad" not in fc
    assert "fade" not in fc


def test_cross_dissolve_com_clipe_curto_limita_half_pela_duracao_do_clipe():
    """Quando o clipe A é curto (1s), halfA não pode vazar para antes do clipe A."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 1.0,
         "video_id": 1, "effects": [_cf("out", 3.0)]},
        {"id": "b", "track": "V1", "timeline_start": 1.0, "in": 0.0, "out": 10.0,
         "video_id": 2, "effects": [_cf("in", 0.5)]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 15.0)
    fc = g["filter_complex"]

    # halfA limitado a 1.0s (duração de A). B recua até corte - 1.0 = 0.0s, fade in com span 1.5s
    assert "fade=t=in:st=0:d=1.5:alpha=1" in fc
    # Clip B não começa antes de 0
    assert "st=-" not in fc


def test_cross_dissolve_com_folga_de_cauda_parcial_combina_midia_e_tpad():
    """Clip A tem 0.2s de folga de cauda na mídia; o restante de 0.3s usa tpad clone."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
         "source_duration_seconds": 10.2, "video_id": 1, "effects": [_cf("out", 1.0)]},
        {"id": "b", "track": "V1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
         "video_id": 2, "effects": [_cf("in", 0.5)]},
    ])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 20.0)
    fc = g["filter_complex"]
    ent = {e["clipe_id"]: e for e in g["entradas"]}

    # Clip A consome a sobra de mídia de 0.2s (t passa de 10.0 para 10.2)
    assert ent["a"]["t"] == pytest.approx(10.2)

    # Restante de halfB (0.5 - 0.2 = 0.3s) é clonado por tpad stop
    assert "tpad=stop_mode=clone:stop_duration=0.3" in fc


def test_in_out_range_corte_apos_fade_in_descarta_fade_e_nao_gera_st_negativo():
    """Quando o intervalo In/Out começa depois que o fade-in já terminou, nenhum fade é emitido."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 20.0,
         "video_id": 1, "effects": [{"type": "crossfade", "side": "in", "duration_s": 2.0}]},
    ])
    # Render de 5s a 10s: delta=5s, fade-in terminou em 2s
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 5.0, 10.0)
    fc = g["filter_complex"]
    # Fade in já terminou: não deve haver filtro fade nem st negativo
    assert "fade=t=in" not in fc
    assert "st=-" not in fc


def test_in_out_range_corte_no_meio_do_fade_in_usa_geq_sem_st_negativo():
    """Quando o intervalo In/Out começa no meio do fade-in, cai no geq sem emitir fade=t=in com st negativo."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 20.0,
         "video_id": 1, "effects": [{"type": "crossfade", "side": "in", "duration_s": 3.0}]},
    ])
    # Render de 1s a 5s: delta=1s, fade-in vai até 3s (restam 2s de fade na janela)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 1.0, 5.0)
    fc = g["filter_complex"]
    # FFmpeg rejeitaria fade=t=in:st=-1 com 'out of range'. Deve usar geq com expressão contínua
    assert "fade=t=in:st=-" not in fc
    assert "geq=" in fc
    assert "trim=start=0:end=2" in fc


def test_in_out_range_corte_antes_do_fade_out_descarta_fade():
    """Quando o intervalo In/Out termina antes do fade-out começar, o fade-out é omitido."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 20.0,
         "video_id": 1, "effects": [{"type": "crossfade", "side": "out", "duration_s": 2.0}]},
    ])
    # Render de 0s a 15s: fade-out só começaria em 18s (dur_clipe 20s - 2s)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 15.0)
    fc = g["filter_complex"]
    assert "fade=t=out" not in fc


def test_in_out_range_corte_no_meio_do_fade_out_usa_geq_sem_st_negativo():
    """Quando o intervalo In/Out começa no meio do fade-out, cai no geq sem st negativo no filtro fade."""
    seq = _seq([
        {"id": "a", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 20.0,
         "video_id": 1, "effects": [{"type": "crossfade", "side": "out", "duration_s": 4.0}]},
    ])
    # Fade-out é de 16s a 20s. Render de 18s a 20s: delta=18s, dur_clipe-d-delta = 20-4-18 = -2s
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 18.0, 20.0)
    fc = g["filter_complex"]
    assert "fade=t=out:st=-" not in fc
    assert "geq=" in fc


def test_composicao_color_matte_com_video_e_in_out_range():
    """Valida composição multipista com color_matte (V2) e vídeo (V1) em intervalo In/Out delimitado."""
    seq = modelo.normalizar({
        "version": 2, "fps": 30, "width": 1920, "height": 1080,
        "tracks": [
            {"id": "V2", "kind": "video", "order": 0},
            {"id": "V1", "kind": "video", "order": 1},
        ],
        "clips": [
            {
                "id": "v1_clip", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 30.0,
                "video_id": 1, "effects": [{"type": "crossfade", "side": "in", "duration_s": 2.0}]
            },
            {
                "id": "v2_matte", "track": "V2", "timeline_start": 10.0, "in": 0.0, "out": 5.0,
                "kind": "color_matte", "color": "#0047bb", "blend_mode": "multiply",
                "effects": [
                    {"type": "fit", "mode": "fill"},
                    {"type": "crossfade", "side": "in", "duration_s": 1.0},
                    {"type": "crossfade", "side": "out", "duration_s": 1.0},
                ]
            }
        ]
    })
    # Exporta trecho 8.0s a 14.0s (pega parte do vídeo e parte do matte)
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 8.0, 14.0)
    fc = g["filter_complex"]
    assert "color=c=0x0047bb" in fc.lower()
    # Multiply W3C em RGB (lut2) so na janela do matte: render comeca em 8, matte em 10
    assert "blend=all_mode=" not in fc
    assert grafo_video._filtro_lut2_blend("multiply") in fc
    assert "trim=end=2,setpts=PTS-STARTPTS" in fc
    assert "trim=start=2,setpts=PTS-STARTPTS" in fc
    # Vídeo em V1: delta=8s > d=2s, fade-in já terminou, não deve ter st=-
    assert "st=-" not in fc


