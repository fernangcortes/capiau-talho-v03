"""Fontes enviadas pelo usuario: guardadas por projeto e usadas pelo render de titulos.

Fonte de teste: a Outfit do app (src/ui/fonts) copiada com um nome de familia que nao
existe no sistema, entao so aparece se o arquivo do projeto for registrado de verdade.
"""
import shutil
from pathlib import Path

import pytest

from src.services import fontes_projeto

OUTFIT = Path(__file__).resolve().parents[1] / "src" / "ui" / "fonts" / "outfit-var.woff2"
FAMILIA = "FonteTesteTalho"


@pytest.fixture
def raiz(tmp_path, monkeypatch):
    monkeypatch.setattr(fontes_projeto, "pasta_raiz", lambda: tmp_path / "fontes")
    return tmp_path / "fontes"


def test_salvar_listar_e_servir_por_projeto(raiz):
    f = fontes_projeto.salvar(7, f"{FAMILIA}.woff2", OUTFIT.read_bytes())
    assert f["familia"] == FAMILIA and f["arquivo"] == f"{FAMILIA}.woff2"
    assert (raiz / "7" / f"{FAMILIA}.woff2").is_file()
    assert [x["familia"] for x in fontes_projeto.listar(7)] == [FAMILIA]
    assert fontes_projeto.listar(8) == []                      # outro projeto nao ve
    assert fontes_projeto.caminho(7, f"{FAMILIA}.woff2") is not None
    assert fontes_projeto.caminho(8, f"{FAMILIA}.woff2") is None
    assert fontes_projeto.remover(7, f"{FAMILIA}.woff2") and fontes_projeto.listar(7) == []


def test_mesmo_nome_substitui_mesmo_com_outra_extensao(raiz):
    fontes_projeto.salvar(1, "Minha Fonte.woff2", OUTFIT.read_bytes())
    fontes_projeto.salvar(1, "Minha Fonte.ttf", b"\x00\x01\x00\x00" + b"x" * 100)
    assert [x["arquivo"] for x in fontes_projeto.listar(1)] == ["Minha Fonte.ttf"]


def test_nome_da_familia_segue_a_regra_do_editor():
    assert fontes_projeto.familia_do_arquivo("Açaí Bold!.otf") == "Aa Bold"
    assert fontes_projeto.familia_do_arquivo("C:/x/Serif-Pro.ttf") == "Serif-Pro"


@pytest.mark.parametrize("nome,dados", [
    ("fonte.exe", b"\x00\x01\x00\x00abc"),          # extensao
    ("fonte.ttf", b"<html>nao sou fonte</html>"),   # conteudo
    ("fonte.ttf", b""),                             # vazio
    ("!!!.ttf", b"\x00\x01\x00\x00abc"),            # nome sem letras
])
def test_recusa_arquivo_que_nao_e_fonte(raiz, nome, dados):
    with pytest.raises(fontes_projeto.FonteInvalida):
        fontes_projeto.salvar(1, nome, dados)
    assert fontes_projeto.listar(1) == []


def test_caminho_nao_sai_da_pasta_do_projeto(raiz):
    fontes_projeto.salvar(1, "Boa.woff2", OUTFIT.read_bytes())
    (raiz / "2").mkdir(parents=True)
    shutil.copy(OUTFIT, raiz / "2" / "Alheia.woff2")
    assert fontes_projeto.caminho(1, "../2/Alheia.woff2") is None
    assert fontes_projeto.caminho(1, "..\\2\\Alheia.woff2") is None


def test_rotas_upload_lista_e_arquivo(raiz):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.routes import projects

    app = FastAPI()
    app.include_router(projects.router)
    cli = TestClient(app)
    r = cli.post("/api/project/3/fonts",
                 files={"file": (f"{FAMILIA}.woff2", OUTFIT.read_bytes(), "font/woff2")})
    assert r.status_code == 200, r.text
    assert r.json()["familia"] == FAMILIA and r.json()["url"].startswith(f"/api/project/3/fonts/{FAMILIA}.woff2")
    assert [f["familia"] for f in cli.get("/api/project/3/fonts").json()] == [FAMILIA]
    arq = cli.get(f"/api/project/3/fonts/{FAMILIA}.woff2")
    assert arq.status_code == 200 and arq.content == OUTFIT.read_bytes()
    assert cli.get(f"/api/project/4/fonts/{FAMILIA}.woff2").status_code == 404
    ruim = cli.post("/api/project/3/fonts", files={"file": ("x.ttf", b"nada", "font/ttf")})
    assert ruim.status_code == 400 and "fonte" in ruim.json()["detail"]
    assert cli.delete(f"/api/project/3/fonts/{FAMILIA}.woff2").status_code == 200
    assert cli.get("/api/project/3/fonts").json() == []


# ---------------------------------------------------------------------------
# Render com navegador de verdade
# ---------------------------------------------------------------------------

def _navegador_ok():
    from src.export.video_render import titulos
    if not titulos.playwright_instalado():
        return False
    try:
        with titulos.GeradorTitulos(Path(".")) as g:
            g._abrir(64, 64)
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _navegador_ok(), reason="playwright/Edge/Chrome indisponivel")
def test_render_usa_a_fonte_enviada_ao_projeto(raiz, tmp_path):
    from PIL import Image, ImageChops
    from src.export.video_render import titulos

    fontes_projeto.salvar(5, f"{FAMILIA} X.woff2", OUTFIT.read_bytes())   # espaco no nome
    clip = {"id": "gc", "type": "text", "text": "Fonte do projeto", "fontFamily": f"{FAMILIA} X",
            "fontSize": 72, "backgroundColor": "transparent", "keyframes": {}}
    ref = dict(clip, fontFamily="Outfit")   # a mesma fonte pelo nome original do app

    with titulos.GeradorTitulos(tmp_path / "sem") as g:
        (sem, _), = g.quadros(clip, 1280, 720, 30.0, 0, 1)
        assert any(FAMILIA in a for a in g.avisos)                 # sem o projeto: substituto
    with titulos.GeradorTitulos(tmp_path / "com", fontes=fontes_projeto.listar(5)) as g:
        (com, _), = g.quadros(clip, 1280, 720, 30.0, 0, 1)
        (outfit, _), = g.quadros(ref, 1280, 720, 30.0, 0, 1)
        assert g.avisos == []
        assert g._pagina.evaluate(
            # nome com espaco: o Chromium devolve a familia entre aspas
            "() => [...document.fonts].some(f => f.family.replace(/[\"']/g, '') === "
            f"'{FAMILIA} X' && f.status === 'loaded')")

    a, b, c = (Image.open(p) for p in (com, outfit, sem))
    assert ImageChops.difference(a, b).getbbox() is None           # identico a Outfit
    assert ImageChops.difference(a, c).getbbox() is not None       # e diferente do substituto
