"""Regressão A/B bit-a-bit e cancelamento da migração de `titulos.py` sobre `src/navegador/`."""
from __future__ import annotations

import json
import mimetypes
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote, unquote, urlparse

import pytest
from PIL import Image, ImageChops

from src.export.video_render import execucao, titulos
from src.navegador import CapturaCancelada, Navegador, navegador_utilizavel, orfaos
from src.services import fontes_projeto

OUTFIT = Path(__file__).resolve().parents[1] / "src" / "ui" / "fonts" / "outfit-var.woff2"


class _GeradorTitulosLegadoCongelado:
    """Cópia congelada do caminho anterior (`http://titulos.capiau` via `page.route`)."""

    def __init__(self, pasta_cache: Path, canais=titulos.CANAIS, fontes=None):
        self.pasta_cache = Path(pasta_cache)
        self.canais = canais
        self.fontes = list(fontes or [])
        self._pw = None
        self._navegador = None
        self._pagina = None
        self.avisos: List[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.fechar()

    def fechar(self) -> None:
        try:
            if self._navegador is not None:
                self._navegador.close()
        finally:
            if self._pw is not None:
                self._pw.stop()
            self._pw = self._navegador = self._pagina = None

    def _servir(self, route) -> None:
        rel = unquote(urlparse(route.request.url).path).lstrip("/")
        if rel.startswith(titulos.PREFIXO_FONTES):
            nome = rel[len(titulos.PREFIXO_FONTES):]
            f = next((f for f in self.fontes if f["arquivo"] == nome), None)
            if f is None or not Path(f["caminho"]).is_file():
                route.fulfill(status=404, body="")
                return
            route.fulfill(
                status=200,
                body=Path(f["caminho"]).read_bytes(),
                headers={"Content-Type": "application/octet-stream"},
            )
            return
        alvo = (titulos.RAIZ_UI / rel).resolve()
        if titulos.RAIZ_UI not in alvo.parents or not alvo.is_file():
            route.fulfill(status=404, body="")
            return
        tipo = mimetypes.guess_type(alvo.name)[0] or "application/octet-stream"
        if alvo.suffix == ".js":
            tipo = "text/javascript"
        route.fulfill(status=200, body=alvo.read_bytes(), headers={"Content-Type": tipo})

    def _abrir(self, largura: int, altura: int):
        if self._pagina is not None:
            self._pagina.set_viewport_size({"width": largura, "height": altura})
            return self._pagina
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        args = []
        if os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY"):
            args.append("--proxy-bypass-list=127.0.0.1;localhost;<-loopback>")
        for canal in self.canais:
            try:
                kw: Dict[str, Any] = {"headless": True}
                if args:
                    kw["args"] = args
                if canal:
                    kw["channel"] = canal
                self._navegador = self._pw.chromium.launch(**kw)
                break
            except Exception:
                pass
        assert self._navegador is not None
        self._pagina = self._navegador.new_page(viewport={"width": largura, "height": altura})
        self._pagina.route(f"{titulos.HOST_INTERNO}/**", self._servir)
        self._pagina.goto(titulos.PAGINA)
        self._pagina.wait_for_function("window.RENDER_TITULOS_PRONTO === true", timeout=15000)
        return self._pagina

    def grupos(self, clipe: Dict[str, Any], largura: int, altura: int, fps: float, inicio: int, fim: int):
        if fim <= inicio:
            return []
        pagina = self._abrir(int(largura), int(altura))
        fontes = [
            {"familia": f["familia"], "url": f"{titulos.HOST_INTERNO}/{titulos.PREFIXO_FONTES}{quote(f['arquivo'])}"}
            for f in self.fontes
        ]
        prep = pagina.evaluate(
            "([c, w, h, f]) => window.RENDER_TITULOS.preparar(c, w, h, f)",
            [clipe, int(largura), int(altura), fontes],
        )
        chaves = pagina.evaluate(
            "([c, f, a, b]) => window.RENDER_TITULOS.estados(c, f, a, b)",
            [clipe, float(fps), int(inicio), int(fim)],
        )
        pasta = self.pasta_cache / titulos._hash(clipe, largura, altura)
        pasta.mkdir(parents=True, exist_ok=True)
        caixa = bool(prep.get("caixa"))
        desfoque_px = float(prep.get("desfoquePx") or 0)
        saida = []
        for ini, n, chave in titulos.agrupar_estados(chaves):
            rel = (inicio + ini) / float(fps)
            png = pasta / f"{titulos._hash(chave)}.png"
            if not png.is_file():
                pagina.evaluate("([c, t]) => window.RENDER_TITULOS.desenhar(c, t)", [clipe, rel])
                pagina.screenshot(path=str(png), omit_background=True)
            mascara = sigma = None
            if caixa and desfoque_px > 0:
                mascara = pasta / f"{titulos._hash(chave)}_desfoque.png"
                if not mascara.is_file():
                    pagina.evaluate("([c, t]) => window.RENDER_TITULOS.mascara(c, t)", [clipe, rel])
                    bruta = pagina.screenshot(omit_background=True)
                    titulos._gravar_mascara_desfoque(bruta, png, mascara)
                escala = abs(float(json.loads(chave).get("scale", 1) or 0))
                sigma = round(titulos.FATOR_SIGMA_DESFOQUE * desfoque_px * escala, 3)
            saida.append({"png": png, "n": n, "mascara": mascara, "sigma": sigma})
        return saida


@pytest.mark.skipif(not navegador_utilizavel(), reason="playwright/Edge/Chrome indisponível")
def test_paridade_bit_a_bit_caminho_antigo_vs_navegador_comum(tmp_path, monkeypatch):
    monkeypatch.setattr(fontes_projeto, "pasta_raiz", lambda: tmp_path / "fontes_proj")
    fontes_projeto.salvar(1, "RegressaoFonte.woff2", OUTFIT.read_bytes())
    fontes = fontes_projeto.listar(1)

    corpus = [
        {
            "id": "t_simples",
            "type": "text",
            "text": "CapIAu Talho",
            "subtext": "Edição Documental",
            "fontFamily": "Inter",
            "fontSize": 48,
            "backgroundColor": "transparent",
            "keyframes": {},
        },
        {
            "id": "t_caixa_blur",
            "type": "text",
            "text": "Fulana de Tal",
            "fontFamily": "RegressaoFonte",
            "fontSize": 40,
            "backgroundColor": "rgba(0,0,0,0.55)",
            "boxPadding": 14,
            "boxBorderRadius": 10,
            "scale": 1.2,
            "rotation": 5,
            "posY": 24,
            "keyframes": {
                "opacity": [
                    {"time_offset_s": 0.0, "value": 0.0},
                    {"time_offset_s": 0.3, "value": 1.0, "easing": "linear"},
                ]
            },
        },
    ]

    for largura, altura in ((640, 360), (1920, 1080)):
        grupos_leg: List[Any] = []
        with _GeradorTitulosLegadoCongelado(tmp_path / f"leg_{largura}", fontes=fontes) as leg:
            for clipe in corpus:
                fim_q = 5 if clipe["id"] == "t_caixa_blur" else 1
                grupos_leg.append(leg.grupos(clipe, largura, altura, 24.0, 0, fim_q))

        grupos_n1: List[Any] = []
        with titulos.GeradorTitulos(tmp_path / f"novo1_{largura}", fontes=fontes) as n1:
            for clipe in corpus:
                fim_q = 5 if clipe["id"] == "t_caixa_blur" else 1
                grupos_n1.append(n1.grupos(clipe, largura, altura, 24.0, 0, fim_q))

        grupos_n2: List[Any] = []
        with titulos.GeradorTitulos(tmp_path / f"novo2_{largura}", fontes=fontes) as n2:
            for clipe in corpus:
                fim_q = 5 if clipe["id"] == "t_caixa_blur" else 1
                grupos_n2.append(n2.grupos(clipe, largura, altura, 24.0, 0, fim_q))

        for g_leg, g_n1, g_n2 in zip(grupos_leg, grupos_n1, grupos_n2):
            assert len(g_leg) == len(g_n1) == len(g_n2)
            for a, b, c in zip(g_leg, g_n1, g_n2):
                assert a["n"] == b["n"] == c["n"]
                assert a["sigma"] == b["sigma"] == c["sigma"]
                im_leg = Image.open(a["png"]).convert("RGBA")
                im_n1 = Image.open(b["png"]).convert("RGBA")
                im_n2 = Image.open(c["png"]).convert("RGBA")
                assert ImageChops.difference(im_n1, im_n2).getbbox() is None
                assert ImageChops.difference(im_leg, im_n1).getbbox() is None

                if a["mascara"] is not None:
                    m_leg = Image.open(a["mascara"]).convert("L")
                    m_n1 = Image.open(b["mascara"]).convert("L")
                    m_n2 = Image.open(c["mascara"]).convert("L")
                    assert ImageChops.difference(m_n1, m_n2).getbbox() is None
                    assert ImageChops.difference(m_leg, m_n1).getbbox() is None


@pytest.mark.skipif(not navegador_utilizavel(), reason="playwright/Edge/Chrome indisponível")
def test_cache_titulos_inclui_assinatura_e_cancela_via_execucao(tmp_path):
    clipe = {
        "id": "t_assin",
        "type": "text",
        "text": "Cache Assinatura",
        "fontFamily": "Inter",
        "fontSize": 36,
        "backgroundColor": "transparent",
        "keyframes": {},
    }
    pasta_cache = tmp_path / "cache"
    with Navegador(tmp_path / "n1") as nav1, titulos.GeradorTitulos(pasta_cache, navegador=nav1) as g1:
        g1.grupos(clipe, 320, 180, 24.0, 0, 1)
    pastas_1 = [p.name for p in pasta_cache.iterdir() if p.is_dir()]
    assert len(pastas_1) == 1

    with Navegador(tmp_path / "n2") as nav2:
        nav2.assinatura = lambda: "assinatura_alterada_999"  # type: ignore[method-assign]
        with titulos.GeradorTitulos(pasta_cache, navegador=nav2) as g2:
            g2.grupos(clipe, 320, 180, 24.0, 0, 1)
    pastas_2 = [p.name for p in pasta_cache.iterdir() if p.is_dir()]
    assert len(pastas_2) == 2

    # Cancelamento via execucao.cancelar_render abortando o navegador do job
    clipe_anim = {
        "id": "t_cancel",
        "type": "text",
        "text": "Cancelável",
        "fontFamily": "Inter",
        "fontSize": 36,
        "backgroundColor": "transparent",
        "keyframes": {
            "opacity": [
                {"time_offset_s": 0.0, "value": 0.0},
                {"time_offset_s": 1.0, "value": 1.0, "easing": "linear"},
            ]
        },
    }
    timeline_id = 987654
    nav_cancel = Navegador(tmp_path / "nc", rotulo="cancel_exec")
    execucao._registrar_navegador(timeline_id, nav_cancel)
    pids: List[int] = []
    try:
        _ = nav_cancel.info
        pids = list(nav_cancel._pids)
        with titulos.GeradorTitulos(tmp_path / "cache_c", navegador=nav_cancel) as g_c:
            t_cancel = threading.Timer(0.15, execucao.cancelar_render, args=(timeline_id,))
            t_cancel.start()
            with pytest.raises(CapturaCancelada):
                g_c.grupos(clipe_anim, 640, 360, 30.0, 0, 60)
            t_cancel.join(timeout=3.0)
    finally:
        execucao._desregistrar_navegador(timeline_id)
        nav_cancel.fechar()

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if not any(orfaos.processo_vivo(p) for p in pids):
            break
        time.sleep(0.1)
    assert not any(orfaos.processo_vivo(p) for p in pids)
