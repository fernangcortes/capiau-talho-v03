"""Titulos (clipes de texto) no render: fotografados num navegador headless.

POR QUE NAVEGADOR
-----------------
O player desenha o titulo com DOM/CSS (flex, pre-wrap, caixa com raio, box-shadow,
text-shadow, subtexto, keyframes com easing). drawtext do ffmpeg nao reproduz isso;
reescrever a tipografia do CSS em Python seria outra fonte de divergencia. Aqui o
MESMO codigo do preview (src/ui/js/tituloRender.js + keyframeEngine.js) monta o
titulo em src/ui/render_titulos.html, e o Edge/Chrome headless (playwright) tira a
foto com fundo transparente, no tamanho do quadro da sequencia.

QUADROS
-------
Um titulo com fade/deslize muda em poucos quadros (entrada e saida) e fica parado
no meio. A pagina devolve a chave do estado visual de cada quadro; quadros
consecutivos iguais viram UMA imagem com duracao longa. As imagens vao para uma
lista ffconcat (`file`/`duration`), que o comando abre com `-f concat`.

CACHE
-----
PNG nomeado pelo hash de (clipe, quadro, estado): render por segmentos e exports
repetidos reaproveitam as fotos.

DESFOQUE ATRAS DA CAIXA
-----------------------
Na tela a caixa translucida usa backdrop-filter: blur() e desfoca o video que passa
por baixo; a foto isolada nao tem esse video. Por isso a pagina fotografa tambem uma
MASCARA da caixa em cada estado (mesma forma, transformacao, raio e opacidade, opaca,
sem texto nem sombras). O comando desfoca o video ja composto, recorta pela mascara
(alphamerge) e sobrepoe ANTES da foto do titulo.

A mascara gravada NAO e a cobertura crua: na tela o resultado e
o * (caixa sobre video desfocado) + (1 - o) * video, com o = opacidade do titulo.
Sobrepor o desfoque com alfa o e depois a foto (alfa a_t) contaria a opacidade duas
vezes (medido: erro 8-11/255 com opacidade 0,25-0,5). A alfa certa da camada
desfocada e w = (o - a_t) / (1 - a_t), por pixel; e ela que vai para o PNG (cinza).

Sigma do gblur: o blur(Npx) do Chromium, medido contra um xadrez (interior da caixa),
equivale a gblur(steps=4) com sigma ~= 1.05 * N * escala do titulo (o raio acompanha
o transform: scale; rotacao nao muda). Escala animada troca o sigma por sendcmd.

LIMITES CONHECIDOS
- Fonte enviada por upload vive so na sessao do editor; o navegador do render cai
  num substituto. `preparar` informa quando isso acontece.
"""
from __future__ import annotations

import hashlib
import json
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Tuple

RAIZ_UI = Path(__file__).resolve().parents[2] / "ui"
HOST_INTERNO = "http://titulos.capiau"
PAGINA = f"{HOST_INTERNO}/render_titulos.html"

# Ordem de tentativa: navegadores ja instalados primeiro (nao exige download).
CANAIS = ("msedge", "chrome", None)

# blur(Npx) do Chromium ~= gblur(sigma = FATOR * N * escala, steps = PASSOS). Medido.
FATOR_SIGMA_DESFOQUE = 1.05
PASSOS_GBLUR = 4


class TitulosIndisponiveis(RuntimeError):
    """Nao ha como fotografar titulos (playwright ou navegador ausentes)."""


def playwright_instalado() -> bool:
    import importlib.util
    return importlib.util.find_spec("playwright") is not None


def _hash(*partes: Any) -> str:
    h = hashlib.sha1()
    for p in partes:
        h.update(json.dumps(p, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:20]


def agrupar_estados(chaves: List[str]) -> List[Tuple[int, int, str]]:
    """[chave por quadro] -> [(quadro_inicial, n_quadros, chave)] com repeticoes juntas."""
    grupos: List[Tuple[int, int, str]] = []
    for i, k in enumerate(chaves):
        if grupos and grupos[-1][2] == k:
            ini, n, _ = grupos[-1]
            grupos[-1] = (ini, n + 1, k)
        else:
            grupos.append((i, 1, k))
    return grupos


def escrever_ffconcat(destino: Path, itens: List[Tuple[Path, float]]) -> Path:
    """Lista ffconcat com duracoes. O ultimo arquivo se repete sem duracao: sem isso o
    demuxer ignora a duracao do ultimo item (comportamento documentado do concat)."""
    linhas = ["ffconcat version 1.0"]
    for caminho, dur in itens:
        linhas.append(f"file '{caminho.as_posix()}'")
        linhas.append(f"duration {dur:.6f}")
    if itens:
        linhas.append(f"file '{itens[-1][0].as_posix()}'")
    destino.write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return destino


class GeradorTitulos:
    """Fotografa titulos. Abre o navegador na primeira necessidade; `fechar()` encerra.

    Um gerador por job de render (a API sincrona do playwright pertence a thread que
    a criou). Uso: `with GeradorTitulos(pasta) as g: g.quadros(...)`.
    """

    def __init__(self, pasta_cache: Path, canais=CANAIS):
        self.pasta_cache = Path(pasta_cache)
        self.canais = canais
        self._pw = None
        self._navegador = None
        self._pagina = None
        self.avisos: List[str] = []

    # -- ciclo de vida ------------------------------------------------------
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
        """Serve src/ui por rota interna: o render nao depende do servidor estar no ar."""
        from urllib.parse import unquote, urlparse
        rel = unquote(urlparse(route.request.url).path).lstrip("/")
        alvo = (RAIZ_UI / rel).resolve()
        if RAIZ_UI not in alvo.parents or not alvo.is_file():
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
        if not playwright_instalado():
            raise TitulosIndisponiveis(
                "Pacote 'playwright' nao instalado no ambiente do Talho: sem ele os "
                "titulos nao sao desenhados no arquivo.")
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        erro = None
        for canal in self.canais:
            try:
                self._navegador = self._pw.chromium.launch(channel=canal, headless=True) \
                    if canal else self._pw.chromium.launch(headless=True)
                break
            except Exception as e:  # tenta o proximo navegador
                erro = e
        if self._navegador is None:
            self.fechar()
            raise TitulosIndisponiveis(
                f"Nenhum navegador disponivel para desenhar titulos (Edge/Chrome): {erro}")
        self._pagina = self._navegador.new_page(viewport={"width": largura, "height": altura})
        self._pagina.route(f"{HOST_INTERNO}/**", self._servir)
        self._pagina.goto(PAGINA)
        self._pagina.wait_for_function("window.RENDER_TITULOS_PRONTO === true", timeout=15000)
        return self._pagina

    # -- trabalho -----------------------------------------------------------
    def quadros(self, clipe: Dict[str, Any], largura: int, altura: int, fps: float,
                inicio: int, fim: int) -> List[Tuple[Path, int]]:
        """Fotos do titulo nos quadros [inicio, fim) relativos ao inicio do clipe.

        Devolve [(png, n_quadros)] em ordem, com estados repetidos agrupados.
        """
        return [(g["png"], g["n"]) for g in
                self.grupos(clipe, largura, altura, fps, inicio, fim)]

    def grupos(self, clipe: Dict[str, Any], largura: int, altura: int, fps: float,
               inicio: int, fim: int) -> List[Dict[str, Any]]:
        """Como `quadros`, com a mascara da caixa de cada estado.

        Devolve [{"png", "n", "mascara": Path|None, "sigma": float|None}]: mascara e
        sigma so existem quando o titulo tem caixa (desfoque do video atras).
        """
        if fim <= inicio:
            return []
        pagina = self._abrir(int(largura), int(altura))
        prep = pagina.evaluate("([c, w, h]) => window.RENDER_TITULOS.preparar(c, w, h)",
                               [clipe, int(largura), int(altura)])
        if not prep.get("fonteDisponivel", True):
            self.avisos.append(
                f"Titulo {clipe.get('id')}: fonte \"{prep.get('fonte')}\" indisponivel para o "
                "render; usado um substituto.")
        chaves = pagina.evaluate("([c, f, a, b]) => window.RENDER_TITULOS.estados(c, f, a, b)",
                                 [clipe, float(fps), int(inicio), int(fim)])
        base = _hash(clipe, largura, altura)
        pasta = self.pasta_cache / base
        pasta.mkdir(parents=True, exist_ok=True)

        caixa = bool(prep.get("caixa"))
        desfoque_px = float(prep.get("desfoquePx") or 0)
        saida: List[Dict[str, Any]] = []
        for ini, n, chave in agrupar_estados(chaves):
            rel = (inicio + ini) / float(fps)
            png = pasta / f"{_hash(chave)}.png"
            if not png.is_file():
                pagina.evaluate("([c, t]) => window.RENDER_TITULOS.desenhar(c, t)", [clipe, rel])
                pagina.screenshot(path=str(png), omit_background=True)
            mascara = sigma = None
            if caixa and desfoque_px > 0:
                mascara = pasta / f"{_hash(chave)}_desfoque.png"
                if not mascara.is_file():
                    pagina.evaluate("([c, t]) => window.RENDER_TITULOS.mascara(c, t)", [clipe, rel])
                    bruta = pagina.screenshot(omit_background=True)
                    _gravar_mascara_desfoque(bruta, png, mascara)
                escala = abs(float(json.loads(chave).get("scale", 1) or 0))
                sigma = round(FATOR_SIGMA_DESFOQUE * desfoque_px * escala, 3)
            saida.append({"png": png, "n": n, "mascara": mascara, "sigma": sigma})
        return saida


def _gravar_mascara_desfoque(cobertura_png: bytes, titulo_png: Path, destino: Path) -> None:
    """Alfa da camada desfocada: w = (o - a_t) / (1 - a_t) (ver docstring do modulo).

    `o` = alfa da mascara crua (cobertura da caixa x opacidade); `a_t` = alfa da foto
    do titulo. Grava em cinza (luma = alfa), como o alphamerge le.
    """
    import io
    import numpy as np
    from PIL import Image
    o = np.asarray(Image.open(io.BytesIO(cobertura_png)).getchannel("A"), dtype=np.float32) / 255.0
    a_t = np.asarray(Image.open(titulo_png).getchannel("A"), dtype=np.float32) / 255.0
    w = np.clip((o - a_t) / np.maximum(1.0 - a_t, 1e-6), 0.0, 1.0)
    w[a_t >= 1.0] = 0.0  # pixel totalmente coberto pelo titulo: o de baixo nao aparece
    Image.fromarray((w * 255.0 + 0.5).astype(np.uint8), "L").save(destino)


def preparar_titulos(seq, escopo, inicio_s: float, fim_s: float,
                     gerador: GeradorTitulos, pasta_listas: Path) -> Dict[str, Any]:
    """Titulos que aparecem na janela [inicio_s, fim_s) -> entradas e sobreposicoes.

    Devolve {"entradas": [...], "camadas": [(indice_local, loc_s, dur_s, desfoque)],
    "avisos": [...]}. `indice_local` e a posicao da entrada nesta lista; quem monta o
    comando soma o deslocamento das entradas anteriores. `desfoque` e None (titulo sem
    caixa) ou {"mascara": indice_local da lista de mascaras, "sigmas": [(t_rel_s, sigma)]}
    com o sigma do gblur a partir de cada instante (relativo ao inicio da camada).
    """
    fps = float(seq.fps)
    entradas: List[Dict[str, Any]] = []
    camadas: List[Tuple[int, float, float]] = []
    pasta_listas = Path(pasta_listas)
    pasta_listas.mkdir(parents=True, exist_ok=True)

    # Pistas de texto na ordem de EMPILHAMENTO: a de cima (ordem menor) por ultimo.
    pistas_texto = sorted([p for p in seq.pistas if p.kind == "text"],
                          key=lambda p: p.ordem, reverse=True)
    for pista in pistas_texto:
        if not escopo.pista_ligada(pista.id):
            continue
        for c in sorted([c for c in seq.clipes if c.track == pista.id and c.tipo == "text"],
                        key=lambda c: (c.inicio_s, c.indice)):
            ini = max(c.inicio_s, inicio_s)
            fim = min(c.fim_s, fim_s)
            if fim - ini <= 1e-9:
                continue
            # Quadros relativos ao inicio do clipe, como o player (round).
            q_ini = int(round((ini - c.inicio_s) * fps))
            q_fim = int(round((fim - c.inicio_s) * fps))
            fotos = gerador.grupos(c.bruto, seq.largura, seq.altura, fps, q_ini, q_fim)
            if not fotos:
                continue
            chave_lista = _hash(c.id, q_ini, q_fim, c.bruto)
            lista = escrever_ffconcat(
                pasta_listas / f"titulo_{chave_lista}.ffconcat",
                [(g["png"], g["n"] / fps) for g in fotos])
            k = len(entradas)
            entradas.append({
                "tipo": "titulo", "caminho": str(lista), "ss": 0.0,
                "t": round(fim - ini, 6), "clipe_id": c.id, "pista_id": pista.id,
            })
            desfoque = None
            if all(g["mascara"] is not None for g in fotos):
                lista_m = escrever_ffconcat(
                    pasta_listas / f"titulo_{chave_lista}_mascara.ffconcat",
                    [(g["mascara"], g["n"] / fps) for g in fotos])
                # Sigma a partir de cada instante da camada (so quando muda: escala animada)
                sigmas: List[Tuple[float, float]] = []
                t_rel = 0.0
                for g in fotos:
                    if not sigmas or abs(sigmas[-1][1] - g["sigma"]) > 1e-3:
                        sigmas.append((round(t_rel, 6), g["sigma"]))
                    t_rel += g["n"] / fps
                desfoque = {"mascara": len(entradas), "sigmas": sigmas}
                entradas.append({
                    "tipo": "titulo", "caminho": str(lista_m), "ss": 0.0,
                    "t": round(fim - ini, 6), "clipe_id": c.id, "pista_id": pista.id,
                })
            camadas.append((k, ini - inicio_s, fim - ini, desfoque))
    return {"entradas": entradas, "camadas": camadas, "avisos": list(gerador.avisos)}
