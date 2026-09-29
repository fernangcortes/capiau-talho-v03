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
    """Registra o que foi pedido e devolve um PNG por grupo de 10 quadros.

    Titulo com backgroundColor ganha mascara; o sigma vem de `escalas` (um por grupo).
    """

    def __init__(self, pasta: Path, escalas=None):
        self.pasta, self.pedidos, self.avisos = pasta, [], []
        self.escalas = escalas

    def grupos(self, clipe, largura, altura, fps, inicio, fim):
        self.pedidos.append((clipe["id"], largura, altura, fps, inicio, fim))
        caixa = clipe.get("backgroundColor") not in (None, "", "transparent")
        saida = []
        for i, q in enumerate(range(inicio, fim, 10)):
            png = self.pasta / f"{clipe['id']}_{q}.png"
            png.write_bytes(b"")
            m = None
            if caixa:
                m = self.pasta / f"{clipe['id']}_{q}_mascara.png"
                m.write_bytes(b"")
            escala = self.escalas[i] if self.escalas else 1.0
            saida.append({"png": png, "n": min(10, fim - q), "mascara": m,
                          "sigma": round(10.5 * escala, 3) if caixa else None})
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
    (k, loc, dur, desfoque), = res["camadas"]
    assert (k, loc, dur, desfoque) == (0, 0.0, 3.0, None)   # sem caixa: sem desfoque
    assert res["entradas"][0]["tipo"] == "titulo"


def test_caixa_ganha_mascara_e_sigma_por_escala(tmp_path):
    # 3 grupos de 10 quadros; a escala muda no segundo e volta no terceiro
    g = _Falso(tmp_path, escalas=[1.0, 1.5, 1.5])
    seq = _seq(_titulo("gc", 0.0, 1.0, backgroundColor="rgba(0,0,0,0.5)"))
    res = titulos.preparar_titulos(seq, modelo.Escopo(), 0.0, 1.0, g, tmp_path)
    (k, loc, dur, desfoque), = res["camadas"]
    assert [e["clipe_id"] for e in res["entradas"]] == ["gc", "gc"]
    assert desfoque["mascara"] == 1 and k == 0
    lista_m = Path(res["entradas"][1]["caminho"]).read_text()
    assert "_mascara.png" in lista_m
    # sigma so e reenviado quando muda (em segundos relativos a camada)
    assert desfoque["sigmas"] == [(0.0, 10.5), (pytest.approx(10 / 30), 15.75)]


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


@pytest.mark.skipif(not _navegador_ok(), reason="playwright/Edge/Chrome indisponivel")
def test_desfoque_da_caixa_igual_ao_preview(tmp_path):
    """Mede o desfoque do arquivo contra o backdrop-filter do Chromium sobre um xadrez.

    "Preview" = a mesma pagina com o xadrez atras do titulo (o navegador desfoca).
    Arquivo = xadrez + mascara + foto do titulo pelo grafo de comando.py no ffmpeg.
    """
    import base64
    import subprocess
    import numpy as np
    from PIL import Image, ImageFilter
    from src.export.video_render import comando

    W, H = 640, 360
    y, x = np.mgrid[0:H, 0:W]
    chk = (((x // 12) + (y // 12)) % 2).astype(np.uint8) * 255
    rgb = np.stack([chk, np.where((x // 80) % 2 == 0, chk, 255 - chk),
                    (x * 255 // W).astype(np.uint8)], -1).astype(np.uint8)
    xadrez = tmp_path / "xadrez.png"
    Image.fromarray(rgb, "RGB").save(xadrez)

    clip = _titulo("gc", 0, 1.0, text="Fulana", fontFamily="Inter", fontSize=40,
                   backgroundColor="rgba(0,0,0,0.45)", boxPadding=14, boxBorderRadius=10,
                   scale=1.2, rotation=5)
    with titulos.GeradorTitulos(tmp_path / "cache") as g:
        (grupo,) = g.grupos(clip, W, H, 30.0, 0, 1)
        p = g._pagina
        url = "data:image/png;base64," + base64.b64encode(xadrez.read_bytes()).decode()
        p.evaluate("(u) => { document.getElementById('palco').style.background = `url(${u})`; }", url)
        p.evaluate("([c, t]) => window.RENDER_TITULOS.desenhar(c, t)", [clip, 0])
        preview = tmp_path / "preview.png"
        p.screenshot(path=str(preview))
    assert grupo["mascara"] is not None and grupo["sigma"] == pytest.approx(1.05 * 10 * 1.2)

    filtros = []
    atual = comando._desfoque_caixa(filtros, "[0:v]", 0, 2, 0.0, 1.0, [(0.0, grupo["sigma"])])
    filtros.append(f"{atual}[1:v]overlay=0:0:format=rgb")
    arquivo = tmp_path / "arquivo.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-t", "1", "-i", str(xadrez),
                    "-i", str(grupo["png"]), "-i", str(grupo["mascara"]),
                    "-filter_complex", ";".join(filtros), "-frames:v", "1", str(arquivo)],
                   check=True)

    alfa = Image.open(grupo["mascara"]).convert("L")
    interior = np.array(alfa.filter(ImageFilter.MinFilter(21))) > 0   # longe da borda
    assert interior.sum() > 2000
    ref = np.array(Image.open(preview).convert("RGB")).astype(float)
    sem = np.array(Image.open(xadrez).convert("RGB")).astype(float)
    com = np.array(Image.open(arquivo).convert("RGB")).astype(float)
    # sem desfoque o xadrez atravessa a caixa: longe do preview
    foto = np.array(Image.open(grupo["png"]).convert("RGBA")).astype(float)
    a = foto[..., 3:4] / 255.0
    sem = sem * (1 - a) + foto[..., :3] * a
    erro_sem = np.abs(sem - ref).mean(-1)[interior].mean()
    erro_com = np.abs(com - ref).mean(-1)[interior].mean()
    assert erro_sem > 15
    assert erro_com < 3, (erro_sem, erro_com)


def test_mascara_desfoque_nao_conta_a_opacidade_duas_vezes(tmp_path):
    """Opacidade o, foto com alfa a_t: a camada desfocada entra com (o - a_t)/(1 - a_t)."""
    import io
    import numpy as np
    from PIL import Image

    def rgba(alfa):
        im = Image.new("RGBA", (4, 1))
        im.putdata([(255, 255, 255, a) for a in alfa])
        return im

    cobertura = io.BytesIO()
    rgba([0, 128, 128, 255]).save(cobertura, format="PNG")    # fora | caixa o=.5 | caixa o=.5 | caixa o=1
    foto = tmp_path / "t.png"
    rgba([0, 29, 128, 115]).save(foto)                         # nada | fundo .45*.5 | texto | fundo .45
    destino = tmp_path / "m.png"
    titulos._gravar_mascara_desfoque(cobertura.getvalue(), foto, destino)
    w = np.asarray(Image.open(destino), dtype=float) / 255
    assert Image.open(destino).mode == "L"
    assert w[0, 0] == 0                                        # fora da caixa
    assert w[0, 1] == pytest.approx((0.502 - 0.114) / (1 - 0.114), abs=0.01)
    assert w[0, 2] == 0                                        # texto tampa tudo o que esta atras
    assert w[0, 3] == pytest.approx(1.0, abs=0.01)             # opacidade 1: desfoque inteiro
