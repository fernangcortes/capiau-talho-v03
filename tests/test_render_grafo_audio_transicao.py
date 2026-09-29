"""Grafo de audio do render: fades no tempo LOCAL do ramo e crossfade de transicao.

Dois defeitos medidos num export real (timeline 39, 29/09/2026):
1. O fade-in de um clipe no meio da janela era avaliado com o relogio da
   janela, nao do ramo: fator 0 o clipe inteiro, que saia MUDO.
2. Crossfade com `transitionId` virava dois fades de borda (A sumia antes do
   corte, B nascia depois dele). O player toca os DOIS clipes juntos na janela
   [corte - halfA, corte + halfB], lendo a sobra da midia.
"""
import re

from src.export.video_render import grafo_audio, modelo


def _seq(efeitos_a, efeitos_b):
    return modelo.normalizar({
        "version": 2, "fps": 30,
        "tracks": [{"id": "A1", "kind": "audio"}],
        "clips": [
            {"id": "a", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
             "video_id": 1, "effects": efeitos_a},
            {"id": "b", "track": "A1", "timeline_start": 10.0, "in": 5.0, "out": 15.0,
             "video_id": 2, "effects": efeitos_b},
        ],
    })


def _cf(lado, dur, tid=None):
    ef = {"type": "crossfade", "side": lado, "duration_s": dur, "curve": "equal_power"}
    if tid:
        ef["transitionId"] = tid
    return ef


def _grafo(seq, ini, fim):
    return grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), ini, fim)


def test_fade_de_borda_no_meio_da_janela_usa_tempo_local():
    """Fade-in de B (sem transicao) comeca em t=0 do ramo de B, nao em t=8."""
    g = _grafo(_seq([], [_cf("in", 0.5)]), 2.0, 14.0)
    ramo_b = g["filter_complex"].split(";")[1]
    # afade (atalho linear nao vale para equal_power) ou expressao: o inicio
    # tem de ser 0 no relogio local, nunca o offset da janela (8 s).
    assert "t-(0)" in ramo_b
    assert "t-(8)" not in ramo_b


def test_transicao_estende_os_dois_clipes_e_cruza_os_ganhos():
    g = _grafo(_seq([_cf("out", 1.0, "tr1")], [_cf("in", 0.5, "tr1")]), 0.0, 20.0)
    ent = {e["clipe_id"]: e for e in g["entradas"]}
    # A toca ate corte + halfB; B comeca em corte - halfA, lendo 1 s antes do IN.
    assert abs(ent["a"]["t"] - 10.5) < 1e-6
    assert abs(ent["b"]["ss"] - 4.0) < 1e-6
    assert abs(ent["b"]["t"] - 11.0) < 1e-6

    ramo_a, ramo_b = g["filter_complex"].split(";")[:2]
    # janela [9, 10.5], span 1.5: A com curva(1-p), B com curva(p)
    assert "(1-clip(((t-(9))/1.5),0,1))" in ramo_a
    assert "clip(((t-(0))/1.5),0,1)" in ramo_b
    assert "adelay=delays=9000" in ramo_b


def test_transicao_sem_folga_de_midia_nao_le_antes_do_zero():
    seq = _seq([_cf("out", 1.0, "tr1")], [_cf("in", 0.5, "tr1")])
    seq.clipes[1].in_s = 0.3  # so ha 0,3 s de midia antes do IN de B
    seq.clipes[1].out_s = 10.3
    g = _grafo(seq, 0.0, 20.0)
    b = next(e for e in g["entradas"] if e["clipe_id"] == "b")
    assert b["ss"] >= 0.0
    assert abs(b["t"] - 10.3) < 1e-6


def test_lado_de_transicao_sem_parceiro_nao_vira_fade():
    """Como o player: crossfade com transitionId nunca e fade de borda."""
    g = _grafo(_seq([_cf("out", 1.0, "orfa")], []), 0.0, 20.0)
    ramo_a = g["filter_complex"].split(";")[0]
    assert "volume" not in ramo_a and "afade" not in ramo_a


def test_escopo_sem_transicoes_desliga_o_crossfade():
    seq = _seq([_cf("out", 1.0, "tr1")], [_cf("in", 0.5, "tr1")])
    escopo = modelo.Escopo(categorias={modelo.CATEGORIA_TRANSICOES: False})
    g = grafo_audio.grafo_audio_completo(seq, escopo, 0.0, 20.0)
    ent = {e["clipe_id"]: e for e in g["entradas"]}
    assert abs(ent["a"]["t"] - 10.0) < 1e-6
    assert abs(ent["b"]["ss"] - 5.0) < 1e-6
    assert not re.search(r"volume=volume", g["filter_complex"])
