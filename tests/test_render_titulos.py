"""Titulos no render (src/export/video_render/titulos.py).

As partes puras (agrupamento, ffconcat, janelas, ordem das pistas) rodam sempre.
O teste com navegador de verdade roda quando playwright + Edge/Chrome existem;
senao e pulado (o preflight avisa esse caso ao usuario).
"""
from pathlib import Path

import pytest

from src.export.video_render import modelo, titulos


def _seq(*clipes, pistas=None):
    return modelo.normalizar({
        "version": 2, "fps": 30, "width": 1920, "height": 1080,
        "tracks": pistas or [{"id": "T2", "kind": "text", "order": 0},
                             {"id": "T1", "kind": "text", "order": 1},
                             {"id": "V1", "kind": "video", "order": 2}],
        "clips": list(clipes),
    })


def _titulo(cid, inicio, dur, pista="T1", **extra):
    c = {"id": cid, "type": "text", "track": pista, "timeline_start": inicio,
         "in": 0.0, "out": dur, "text": cid}
    c.update(extra)
    return c


class _Falso:
    """Registra o que foi pedido e devolve um PNG por grupo de 10 quadros."""

    def __init__(self, pasta: Path):
        self.pasta, self.pedidos, self.avisos = pasta, [], []

    def quadros(self, clipe, largura, altura, fps, inicio, fim):
        self.pedidos.append((clipe["id"], largura, altura, fps, inicio, fim))
        saida = []
        for q in range(inicio, fim, 10):
            png = self.pasta / f"{clipe['id']}_{q}.png"
            png.write_bytes(b"")
            saida.append((png, min(10, fim - q)))
        return saida


def test_agrupar_estados_junta_repeticoes():
    assert titulos.agrupar_estados(["a", "a", "b", "b", "b", "a"]) == [
        (0, 2, "a"), (2, 3, "b"), (5, 1, "a")]
    assert titulos.agrupar_estados([]) == []


def test_ffconcat_repete_o_ultimo_arquivo(tmp_path):
    a, b = tmp_path / "a.png", tmp_path / "b.png"
    txt = titulos.escrever_ffconcat(tmp_path / "l.ffconcat", [(a, 0.5), (b, 1.25)]).read_text()
    linhas = txt.strip().splitlines()
    assert linhas[0] == "ffconcat version 1.0"
    assert linhas[-1] == f"file '{b.as_posix()}'"          # sem isso o concat ignora a ultima duracao
    assert "duration 1.250000" in txt


def test_janela_pede_so_os_quadros_visiveis(tmp_path):
    g = _Falso(tmp_path)
    res = titulos.preparar_titulos(_seq(_titulo("gc", 2.0, 4.0)), modelo.Escopo(),
                                   3.0, 10.0, g, tmp_path)
    assert g.pedidos == [("gc", 1920, 1080, 30.0, 30, 120)]  # 1 s ja passou; ate o fim
    (k, loc, dur), = res["camadas"]
    assert (k, loc, dur) == (0, 0.0, 3.0)
    assert res["entradas"][0]["tipo"] == "titulo"


def test_ordem_das_pistas_de_texto_e_escopo(tmp_path):
    g = _Falso(tmp_path)
    seq = _seq(_titulo("cima", 0, 2, pista="T2"), _titulo("baixo", 0, 2, pista="T1"))
    res = titulos.preparar_titulos(seq, modelo.Escopo(), 0, 2, g, tmp_path)
    # a de baixo entra primeiro (fica embaixo na composicao)
    assert [e["clipe_id"] for e in res["entradas"]] == ["baixo", "cima"]
    desligada = modelo.Escopo(pistas={"T2": False})
    res2 = titulos.preparar_titulos(seq, desligada, 0, 2, _Falso(tmp_path), tmp_path)
    assert [e["clipe_id"] for e in res2["entradas"]] == ["baixo"]


def test_titulo_desativado_nao_entra(tmp_path):
    g = _Falso(tmp_path)
    seq = _seq(_titulo("gc", 0, 2, disabled=True))
    assert titulos.preparar_titulos(seq, modelo.Escopo(), 0, 2, g, tmp_path)["entradas"] == []


def test_modelo_guarda_o_clipe_bruto_ate_no_recorte():
    seq = _seq(_titulo("a", 0, 4), _titulo("b", 1, 1))  # b sobrepoe a: regra P4 recorta
    recortes = seq.clipes_da_pista("T1")
    assert all(r.bruto and r.bruto["type"] == "text" for r in recortes)


# ---------------------------------------------------------------------------
# Com navegador de verdade
# ---------------------------------------------------------------------------

def _navegador_ok():
    if not titulos.playwright_instalado():
        return False
    try:
        with titulos.GeradorTitulos(Path(".")) as g:
            g._abrir(64, 64)
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _navegador_ok(), reason="playwright/Edge/Chrome indisponivel")
def test_foto_real_do_titulo_com_fade(tmp_path):
    from PIL import Image
    clip = _titulo("gc", 0, 1.0, text="Fulana de Tal", fontFamily="Inter", fontSize=48,
                   backgroundColor="rgba(0,0,0,0.75)", posY=30,
                   keyframes={"opacity": [{"time_offset_s": 0, "value": 0},
                                          {"time_offset_s": 0.3, "value": 1, "easing": "linear"}]})
    with titulos.GeradorTitulos(tmp_path) as g:
        fotos = g.quadros(clip, 1920, 1080, 30.0, 0, 30)
        assert g.avisos == []
    # fade de 0,3 s a 30 fps: ~9 quadros distintos + o resto parado numa imagem so
    assert 5 <= len(fotos) <= 12 and sum(n for _, n in fotos) == 30
    assert fotos[-1][1] >= 20
    primeira, ultima = Image.open(fotos[0][0]), Image.open(fotos[-1][0])
    assert primeira.size == (1920, 1080) and primeira.mode == "RGBA"
    assert primeira.getchannel("A").getextrema()[1] == 0          # opacidade 0: nada desenhado
    caixa = ultima.getbbox()
    assert caixa and caixa[1] > 540                                 # posY 30: metade de baixo
    assert ultima.getchannel("A").getextrema()[1] == 255
