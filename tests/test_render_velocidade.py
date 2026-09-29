"""Velocidade e reverso no render (Task 13/14).

Mapa do player (_targetSecondsFor): fonte = in + (t - inicio) * speed; no
reverso, fonte = out - (t - inicio) * speed. `in`/`out` sao o trecho da FONTE;
na timeline o clipe ocupa (out - in) / speed.
"""
import pytest

from src.export.video_render import grafo_audio, grafo_video, modelo


def _seq(*clipes, fps=30):
    return modelo.normalizar({
        "version": 2, "fps": fps,
        "tracks": [{"id": "V1", "kind": "video"}, {"id": "A1", "kind": "audio"}],
        "clips": list(clipes),
    })


def _c(cid, pista, inicio, ent, sai, **extra):
    c = {"id": cid, "type": "video", "video_id": 1, "track": pista,
         "timeline_start": inicio, "in": ent, "out": sai, "effects": []}
    c.update(extra)
    return c


def _entrada(g, cid):
    return next(e for e in g["entradas"] if e["clipe_id"] == cid)


# --- modelo -----------------------------------------------------------------

def test_duracao_na_timeline_divide_pela_velocidade():
    seq = _seq(_c("a", "V1", 0, 10, 20, speed=2.0), _c("b", "V1", 0, 0, 3, speed=0.5))
    a, b = seq.clipes
    assert a.duracao_s == pytest.approx(5.0)
    assert b.duracao_s == pytest.approx(6.0)


@pytest.mark.parametrize("reverso,esperado", [(False, (13.0, 4.0)), (True, (13.0, 4.0))])
def test_trecho_fonte_meio_do_clipe(reverso, esperado):
    # 10..20 da fonte a 2x (5 s na timeline). Janela da timeline [1.5, 3.5]:
    # direto  -> fonte 10 + 3 = 13, 4 s de fonte
    # reverso -> fonte 20 - 7 = 13, 4 s de fonte (mesmo trecho, tocado ao contrario)
    c = _seq(_c("a", "V1", 0, 10, 20, speed=2.0, reverse=reverso)).clipes[0]
    assert c.trecho_fonte(1.5, 2.0) == pytest.approx(esperado)


def test_reverso_cabeca_da_timeline_e_o_fim_da_fonte():
    c = _seq(_c("a", "V1", 0, 10, 20, reverse=True)).clipes[0]
    assert c.trecho_fonte(0.0, 2.0) == pytest.approx((18.0, 2.0))


def test_p4_apara_reverso_pelo_lado_certo_da_fonte():
    # "b" (indice 0) cobre [0, 2] da timeline e vence; "a" reverso [0, 10] perde
    # a cabeca -> sobra timeline [2, 10] = fonte [10, 18] (o FIM foi o que saiu).
    seq = _seq(_c("b", "V1", 0, 50, 52), _c("a", "V1", 0, 10, 20, reverse=True))
    recortes = seq.clipes_da_pista("V1")
    a = next(r for r in recortes if r.id.startswith("a"))
    assert (a.inicio_s, a.in_s, a.out_s) == pytest.approx((2.0, 10.0, 18.0))
    assert a.reverso is True


def test_foto_ignora_velocidade():
    foto = {"id": "f", "type": "photo", "photo_id": 3, "track": "V1",
            "timeline_start": 0, "in": 0, "out": 4, "speed": 3.0, "reverse": True}
    c = _seq(foto).clipes[0]
    assert (c.velocidade, c.reverso, c.duracao_s) == (1.0, False, 4.0)


# --- grafo de video ---------------------------------------------------------

def test_video_janela_no_meio_de_clipe_acelerado():
    seq = _seq(_c("a", "V1", 0, 10, 20, speed=2.0))
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 1.0, 4.0)
    e = _entrada(g, "a")
    assert (e["ss"], e["t"]) == pytest.approx((12.0, 6.0))
    fc = g["filter_complex"]
    assert "setpts=0.5*PTS" in fc and "reverse" not in fc


def test_video_reverso_inverte_depois_do_trecho_certo():
    seq = _seq(_c("a", "V1", 0, 10, 20, reverse=True))
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 0.0, 10.0)
    fc = g["filter_complex"]
    assert fc.index("setpts=PTS-STARTPTS") < fc.index("reverse")
    assert _entrada(g, "a")["ss"] == pytest.approx(10.0)


# --- grafo de audio ---------------------------------------------------------

def test_atempo_encadeado_fora_de_meio_a_dois():
    assert grafo_audio._fatores_atempo(4.0) == pytest.approx([2.0, 2.0])
    assert grafo_audio._fatores_atempo(0.25) == pytest.approx([0.5, 0.5])
    f = grafo_audio._fatores_atempo(3.0)
    assert all(0.5 <= x <= 2.0 for x in f)
    produto = 1.0
    for x in f:
        produto *= x
    assert produto == pytest.approx(3.0)


def test_audio_acelerado_le_trecho_da_fonte_e_usa_atempo():
    seq = _seq(_c("a", "A1", 0, 10, 20, speed=2.0))
    g = grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), 0.0, 5.0)
    e = _entrada(g, "a")
    assert (e["ss"], e["t"]) == pytest.approx((10.0, 10.0))
    ramo = g["filter_complex"].split(";")[0]
    assert "atrim=start=0:end=10," in ramo and "atempo=2" in ramo


def test_audio_sem_correcao_de_tom_usa_asetrate():
    seq = _seq(_c("a", "A1", 0, 10, 20, speed=2.0, pitch_correction=False))
    ramo = grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), 0.0, 5.0)["filter_complex"]
    assert "asetrate=96000" in ramo and "atempo" not in ramo


def test_audio_reverso_areverse_antes_do_volume():
    seq = _seq(_c("a", "A1", 0, 0, 4, reverse=True, effects=[
        {"type": "crossfade", "side": "in", "duration_s": 0.5, "curve": "linear"}]))
    ramo = grafo_audio.grafo_audio_completo(seq, modelo.Escopo(), 0.0, 4.0)["filter_complex"]
    assert ramo.index("areverse") < ramo.index("afade")


def test_crossfade_em_clipe_acelerado_estende_na_escala_da_fonte():
    # A a 2x: 1 s de timeline alem do corte = 2 s de fonte.
    a = _c("a", "A1", 0, 0, 10, speed=2.0, effects=[
        {"type": "crossfade", "side": "out", "duration_s": 1.0, "curve": "equal_power",
         "transitionId": "tr"}])
    b = _c("b", "A1", 5, 20, 30, effects=[
        {"type": "crossfade", "side": "in", "duration_s": 1.0, "curve": "equal_power",
         "transitionId": "tr"}])
    g = grafo_audio.grafo_audio_completo(_seq(a, b), modelo.Escopo(), 0.0, 15.0)
    assert _entrada(g, "a")["t"] == pytest.approx(12.0)   # 10 s + 1 s de timeline * 2
    assert _entrada(g, "b")["ss"] == pytest.approx(19.0)  # 1 s antes do IN (b a 1x)
