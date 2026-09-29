"""Freeze frame no render (Task 12).

No player (_targetSecondsFor) o clipe `is_freeze` mostra sempre o quadro
`freeze_time`, e ele nasce sem parceiro de audio (createFreezeFrameCut). `in`/`out`
continuam medindo a duracao na timeline: in = freeze_time, out = freeze_time + dur.
"""
import pytest

from src.export.video_render import grafo_audio, grafo_video, modelo


def _seq(*clipes):
    return modelo.normalizar({
        "version": 2, "fps": 30,
        "tracks": [{"id": "V1", "kind": "video"}, {"id": "A1", "kind": "audio"}],
        "clips": list(clipes),
    })


def _gelo(cid="g", inicio=0.0, ft=7.5, dur=3.0, pista="V1", **extra):
    c = {"id": cid, "type": "video", "video_id": 1, "track": pista, "timeline_start": inicio,
         "in": ft, "out": ft + dur, "is_freeze": True, "freeze_time": ft, "effects": []}
    c.update(extra)
    return c


def _entrada(g, cid):
    return next(e for e in g["entradas"] if e["clipe_id"] == cid)


def test_modelo_marca_congelado_com_duracao_da_timeline():
    c = _seq(_gelo()).clipes[0]
    assert c.congelado and c.congelar_em_s == 7.5
    assert c.duracao_s == pytest.approx(3.0)


def test_entrada_le_um_quadro_mesmo_com_janela_no_meio():
    """Render por faixa que entra no meio do freeze continua lendo o MESMO quadro."""
    g = grafo_video.grafo_completo(_seq(_gelo()), modelo.Escopo(), 1.2, 3.0)
    e = _entrada(g, "g")
    assert e["ss"] == pytest.approx(7.5)
    assert e["t"] == pytest.approx(modelo.JANELA_QUADRO_CONGELADO_S)


def test_grafo_segura_o_quadro_pela_duracao_da_janela():
    fc = grafo_video.grafo_completo(_seq(_gelo()), modelo.Escopo(), 1.2, 3.0)["filter_complex"]
    assert "trim=end_frame=1" in fc
    assert "tpad=stop_mode=clone:stop_duration=1.8" in fc
    assert fc.index("trim=end_frame=1") < fc.index("tpad=")


def test_freeze_ignora_velocidade_e_reverso():
    c = _seq(_gelo(speed=2.0, reverse=True)).clipes[0]
    assert (c.velocidade, c.reverso) == (1.0, False)
    fc = grafo_video.grafo_completo(_seq(_gelo(speed=2.0, reverse=True)),
                                    modelo.Escopo(), 0, 3)["filter_complex"]
    assert "reverse" not in fc and "setpts=0.5" not in fc


def test_regra_p4_mantem_congelamento_no_recorte():
    # "b" (indice 0) toma [0, 1]; o freeze perde a cabeca e segue congelado em 7.5
    seq = _seq({"id": "b", "type": "video", "video_id": 2, "track": "V1",
                "timeline_start": 0, "in": 0, "out": 1}, _gelo())
    r = next(x for x in seq.clipes_da_pista("V1") if x.id.startswith("g"))
    assert r.congelado and r.congelar_em_s == 7.5
    assert (r.inicio_s, r.duracao_s) == pytest.approx((1.0, 2.0))


def test_freeze_nao_gera_audio():
    seq = _seq(_gelo(pista="A1"),
               {"id": "a", "type": "video", "video_id": 1, "track": "A1",
                "timeline_start": 3, "in": 0, "out": 2})
    g = grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), 0, 5)
    assert [e["clipe_id"] for e in g["entradas"]] == ["a"]


def test_freeze_de_foto_e_foto_comum():
    foto = {"id": "f", "type": "photo", "photo_id": 3, "track": "V1", "timeline_start": 0,
            "in": 0, "out": 4, "is_freeze": True, "freeze_time": 0}
    c = _seq(foto).clipes[0]
    assert not c.congelado and c.e_foto
