"""Lançador comum de navegador headless (`Navegador` e `Pagina`) sobre Playwright."""
from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

from . import diagnostico, orfaos
from .erros import CapturaCancelada, NavegadorIndisponivel
from .servidor import ServidorLocal

RAIZ_UI = Path(__file__).resolve().parents[1] / "ui"
VERSAO_MODULO = "1"

_VARREDURA_LOCK = threading.Lock()
_VARREDURA_FEITA = False


def calcular_assinatura(
    canal: str,
    versao: str,
    modo_captura: str = "screenshot",
    args_extra: Sequence[str] = (),
) -> str:
    """Assinatura estável do renderizador para invalidar cache ao trocar navegador/modo."""
    versao_maior = str(versao or "").split(".", 1)[0]
    h = hashlib.sha1()
    partes = [
        str(canal or ""),
        versao_maior,
        str(modo_captura or "screenshot"),
        "|".join(str(a) for a in (args_extra or ())),
        VERSAO_MODULO,
    ]
    for p in partes:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


@dataclass(frozen=True)
class InfoNavegador:
    canal: str
    caminho: Optional[str]
    versao: str
    headless_shell: bool
    capturas: Tuple[str, ...]
    gpu: str
    contexto_seguro: bool
    sandbox: bool


@dataclass(frozen=True)
class Quadro:
    dados: Optional[bytes]
    caminho: Optional[Path]
    formato: str
    largura: int
    altura: int
    ms: float
    com_dano: Optional[bool] = None


@dataclass(frozen=True)
class PedidoQuadro:
    indice: int
    js_antes: Optional[str] = None
    arg: Any = None
    chave: Optional[str] = None


@dataclass(frozen=True)
class QuadroGravado:
    indice: int
    caminho: Path
    repete_anterior: bool
    ms: float
    com_dano: Optional[bool] = None


class Pagina:
    """Página aberta dentro de um `Navegador`."""

    def __init__(self, navegador: "Navegador", page_pw: Any,
                 largura: int, altura: int, rotulo: str = "") -> None:
        self._nav = navegador
        self.pw = page_pw
        self.largura = int(largura)
        self.altura = int(altura)
        self.rotulo = str(rotulo or "")
        self.modo = "screenshot"
        self._fechada = False

    def _checar(self) -> None:
        self._nav._checar_thread()
        self._nav._checar_cancelamento()
        if self._fechada:
            raise RuntimeError("Página já fechada.")

    def _converter_erro_aborto(self, exc: Exception) -> None:
        if self._nav._cancelado_ou_abortado():
            raise CapturaCancelada("Navegador cancelado ou abortado durante a operação.") from exc

    def abrir(
        self,
        url_relativa: str,
        *,
        pronto: Optional[str] = None,
        timeout_s: float = 15.0,
    ) -> None:
        self._checar()
        texto = str(url_relativa or "").strip()
        if texto.startswith(("http://", "https://")):
            alvo = texto
        else:
            alvo = f"{self._nav.servidor.url_base}/{texto.lstrip('/')}"
        try:
            self.pw.goto(alvo, timeout=float(timeout_s) * 1000.0)
            if pronto:
                self.esperar(pronto, timeout_s=timeout_s)
        except CapturaCancelada:
            raise
        except Exception as exc:
            self._converter_erro_aborto(exc)
            raise

    def avaliar(self, js: str, arg: Any = None) -> Any:
        self._checar()
        try:
            if arg is None:
                return self.pw.evaluate(js)
            return self.pw.evaluate(js, arg)
        except CapturaCancelada:
            raise
        except Exception as exc:
            self._converter_erro_aborto(exc)
            raise

    def esperar(self, js: str, *, timeout_s: float = 15.0, intervalo_ms: int = 25) -> None:
        """Aguarda predicado por polling em ms (nunca dependente de rAF)."""
        self._checar()
        try:
            self.pw.wait_for_function(
                js,
                timeout=float(timeout_s) * 1000.0,
                polling=max(5, int(intervalo_ms)),
            )
        except CapturaCancelada:
            raise
        except Exception as exc:
            self._converter_erro_aborto(exc)
            raise

    def redimensionar(self, largura: int, altura: int) -> None:
        self._checar()
        w, h = int(largura), int(altura)
        if w == self.largura and h == self.altura:
            return
        try:
            self.pw.set_viewport_size({"width": w, "height": h})
            self.largura, self.altura = w, h
        except CapturaCancelada:
            raise
        except Exception as exc:
            self._converter_erro_aborto(exc)
            raise

    def capturar(
        self,
        *,
        formato: str = "png",
        qualidade: int = 90,
        alfa: bool = True,
        recorte: Optional[Tuple[int, int, int, int]] = None,
        destino: Optional[Path] = None,
    ) -> Quadro:
        self._checar()
        fmt = str(formato or "png").strip().lower()
        if fmt not in ("png", "jpeg"):
            raise ValueError(f"Formato não suportado no backend screenshot: {fmt!r}")

        kwargs: Dict[str, Any] = {"type": fmt}
        if fmt == "png":
            kwargs["omit_background"] = bool(alfa)
        else:
            kwargs["quality"] = max(1, min(100, int(qualidade)))

        if recorte is not None:
            x, y, rw, rh = recorte
            kwargs["clip"] = {
                "x": float(x),
                "y": float(y),
                "width": float(rw),
                "height": float(rh),
            }

        destino_path = Path(destino) if destino is not None else None
        if destino_path is not None:
            destino_path.parent.mkdir(parents=True, exist_ok=True)
            kwargs["path"] = str(destino_path)

        t0 = time.perf_counter()
        try:
            raw = self.pw.screenshot(**kwargs)
        except CapturaCancelada:
            raise
        except Exception as exc:
            self._converter_erro_aborto(exc)
            raise
        ms = round((time.perf_counter() - t0) * 1000.0, 2)

        self._nav._checar_cancelamento()
        w_out = int(recorte[2]) if recorte is not None else self.largura
        h_out = int(recorte[3]) if recorte is not None else self.altura
        dados = bytes(raw) if raw is not None else (
            destino_path.read_bytes() if destino_path and destino_path.is_file() else None
        )
        return Quadro(
            dados=dados,
            caminho=destino_path,
            formato=fmt,
            largura=w_out,
            altura=h_out,
            ms=ms,
            com_dano=None,
        )

    def capturar_quadros(
        self,
        pedidos: Iterable[PedidoQuadro],
        pasta: Path,
        *,
        fps: float,
        formato: str = "png",
        dedupe: str = "chave",
        progresso: Optional[Callable[[int, int], None]] = None,
    ) -> Iterator[QuadroGravado]:
        self._checar()
        del fps  # reservado para modos futuros temporizados
        lista = list(pedidos)
        total = len(lista)
        pasta_out = Path(pasta)
        pasta_out.mkdir(parents=True, exist_ok=True)
        ext = "jpg" if str(formato).lower() == "jpeg" else "png"
        alfa = ext == "png"

        ultima_chave: Optional[str] = None
        ultimo_hash: Optional[str] = None
        ultimo_caminho: Optional[Path] = None

        for pos, ped in enumerate(lista, start=1):
            self._nav._checar_cancelamento()
            if dedupe == "chave" and ped.chave is not None and ped.chave == ultima_chave and ultimo_caminho is not None:
                if progresso:
                    progresso(pos, total)
                yield QuadroGravado(
                    indice=ped.indice,
                    caminho=ultimo_caminho,
                    repete_anterior=True,
                    ms=0.0,
                    com_dano=None,
                )
                continue

            if ped.js_antes:
                self.avaliar(ped.js_antes, ped.arg)

            quadro = self.capturar(formato=formato, alfa=alfa)
            bytes_img = quadro.dados or b""
            hash_atual = hashlib.sha1(bytes_img).hexdigest() if dedupe == "hash" else None

            if dedupe == "hash" and hash_atual == ultimo_hash and ultimo_caminho is not None:
                if progresso:
                    progresso(pos, total)
                yield QuadroGravado(
                    indice=ped.indice,
                    caminho=ultimo_caminho,
                    repete_anterior=True,
                    ms=quadro.ms,
                    com_dano=None,
                )
                continue

            destino = pasta_out / f"quadro_{ped.indice:06d}.{ext}"
            destino.write_bytes(bytes_img)
            ultima_chave = ped.chave
            ultimo_hash = hash_atual
            ultimo_caminho = destino
            if progresso:
                progresso(pos, total)
            yield QuadroGravado(
                indice=ped.indice,
                caminho=destino,
                repete_anterior=False,
                ms=quadro.ms,
                com_dano=None,
            )

    def fechar(self) -> None:
        if self._fechada:
            return
        self._fechada = True
        try:
            self.pw.close()
        except Exception:
            pass
        self._nav._paginas.discard(self)


class Navegador:
    """Instância síncrona de navegador headless vinculada a uma thread e a um `ServidorLocal`."""

    def __init__(
        self,
        pasta_trabalho: Path,
        *,
        preferir: str = "auto",
        captura: str = "auto",
        fontes: Sequence[Mapping[str, Any]] = (),
        cancelado: Optional[Callable[[], bool]] = None,
        args_extra: Sequence[str] = (),
        rotulo: str = "",
    ) -> None:
        self.pasta_trabalho = Path(pasta_trabalho)
        self.preferir = str(preferir or "auto")
        self.captura = str(captura or "auto")
        self.fontes = list(fontes or ())
        self._cancelado_fn = cancelado
        self.args_extra = tuple(str(a) for a in (args_extra or ()))
        self.rotulo = str(rotulo or "")

        self._thread_id = threading.get_ident()
        self._abort_lock = threading.Lock()
        self._abortado = False
        self._fechado = False
        self._token_pids = secrets.token_hex(6)
        self._pids: List[int] = []
        self._arq_pids: Optional[Path] = None

        self._servidor: Optional[ServidorLocal] = None
        self._pw: Any = None
        self._browser: Any = None
        self._info: Optional[InfoNavegador] = None
        self._paginas: set[Pagina] = set()

        global _VARREDURA_FEITA
        with _VARREDURA_LOCK:
            if not _VARREDURA_FEITA:
                _VARREDURA_FEITA = True
                try:
                    orfaos.varrer_orfaos()
                except Exception:
                    pass

        orfaos.registrar_instancia(self)

    def _checar_thread(self) -> None:
        if threading.get_ident() != self._thread_id:
            raise RuntimeError(
                "Navegador síncrono pertence à thread que o criou e não pode ser "
                "chamado de outra thread (use abortar() para encerrar de fora)."
            )
        if self._pw is None:
            try:
                loop = asyncio.get_running_loop()
                em_tarefa_async = asyncio.current_task(loop) is not None
            except RuntimeError:
                em_tarefa_async = False
            if em_tarefa_async:
                raise RuntimeError(
                    "Navegador síncrono não pode iniciar dentro de uma corrotina/event loop "
                    "asyncio ativo; use rota `def` ou `run_in_threadpool`."
                )

    def _cancelado_ou_abortado(self) -> bool:
        if self._abortado:
            return True
        if self._cancelado_fn is not None:
            try:
                return bool(self._cancelado_fn())
            except Exception:
                return False
        return False

    def _checar_cancelamento(self) -> None:
        if self._cancelado_ou_abortado():
            raise CapturaCancelada("Operação no navegador cancelada.")

    @property
    def servidor(self) -> ServidorLocal:
        if self._servidor is None:
            self.pasta_trabalho.mkdir(parents=True, exist_ok=True)
            srv = ServidorLocal(pasta_saidas=self.pasta_trabalho / "saidas")
            if RAIZ_UI.is_dir():
                srv.publicar_pasta("ui", RAIZ_UI)
            if self.fontes:
                mapa_fontes: Dict[str, Path] = {}
                for f in self.fontes:
                    arq = str(f.get("arquivo") or "").strip()
                    cam = f.get("caminho")
                    if arq and cam and Path(cam).is_file():
                        mapa_fontes[arq] = Path(cam)
                if mapa_fontes:
                    srv.publicar_mapa("fontes", mapa_fontes)
            self._servidor = srv
        return self._servidor

    def _candidatos_lancamento(self) -> List[Tuple[str, Dict[str, Any]]]:
        pref = self.preferir.strip()
        if pref and pref not in ("auto", "msedge", "chrome", "headless_shell", "playwright"):
            p = Path(pref).expanduser()
            if p.is_file():
                return [("caminho", {"executable_path": str(p)})]

        pref_lower = pref.lower()
        candidatos: List[Tuple[str, Dict[str, Any]]] = []
        if pref_lower in ("auto", "msedge"):
            candidatos.append(("msedge", {"channel": "msedge"}))
        if pref_lower in ("auto", "chrome"):
            candidatos.append(("chrome", {"channel": "chrome"}))
        if pref_lower in ("auto", "headless_shell"):
            _, cam_shell = diagnostico.localizar_executavel_instalado("headless_shell")
            if cam_shell is not None:
                candidatos.append(("headless_shell", {"executable_path": str(cam_shell)}))
        if pref_lower in ("auto", "playwright"):
            candidatos.append(("playwright", {}))

        if not candidatos:
            candidatos.append(("playwright", {}))
        return candidatos

    def _garantir_lancado(self) -> InfoNavegador:
        self._checar_thread()
        self._checar_cancelamento()
        if self._info is not None and self._browser is not None:
            return self._info

        barato = diagnostico.diagnostico_barato()
        if not barato["playwright_instalado"]:
            raise NavegadorIndisponivel(barato["motivo"] or "Playwright indisponível.")

        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        erros: List[str] = []
        canal_usado = ""
        caminho_usado: Optional[str] = None
        gpu_desc = "desconhecida"

        args_launch = list(self.args_extra)
        # No ambiente com HTTP_PROXY local, garante que 127.0.0.1 nunca tente passar por proxy.
        if (os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY")) and not any(
            a.startswith("--proxy-bypass-list") for a in args_launch
        ):
            args_launch.append("--proxy-bypass-list=127.0.0.1;localhost;<-loopback>")

        for canal, kwargs_extra in self._candidatos_lancamento():
            self._checar_cancelamento()
            try:
                launch_kwargs: Dict[str, Any] = {"headless": True, **kwargs_extra}
                if args_launch:
                    launch_kwargs["args"] = args_launch
                self._browser = self._pw.chromium.launch(**launch_kwargs)
                canal_usado = canal
                caminho_usado = kwargs_extra.get("executable_path")
                break
            except Exception as exc:
                erros.append(f"{canal}: {exc}")

        if self._browser is None:
            self.fechar()
            raise NavegadorIndisponivel(
                f"Nenhum navegador disponível para iniciar ({'; '.join(erros)})"
            )

        pids: List[int] = []
        try:
            cdp = self._browser.new_browser_cdp_session()
            try:
                pinfo = cdp.send("SystemInfo.getProcessInfo")
                for item in pinfo.get("processInfo") or []:
                    pid = int(item.get("id") or 0)
                    if pid > 0:
                        pids.append(pid)
            except Exception:
                pass
            try:
                sinfo = cdp.send("SystemInfo.getInfo")
                devs = (sinfo.get("gpu") or {}).get("devices") or []
                if devs:
                    d0 = devs[0]
                    gpu_desc = f"{d0.get('vendorString') or ''} {d0.get('deviceString') or ''}".strip() or "gpu"
            except Exception:
                pass
            try:
                cdp.detach()
            except Exception:
                pass
        except Exception:
            pass

        if pids and not caminho_usado:
            caminho_usado = orfaos.caminho_executavel_pid(pids[0])
        if pids:
            with self._abort_lock:
                self._pids = list(dict.fromkeys(pids))
            self._arq_pids = orfaos.registrar_pids(
                self._token_pids, self._pids, executavel=caminho_usado
            )

        versao = str(getattr(self._browser, "version", "") or "0")
        self._info = InfoNavegador(
            canal=canal_usado,
            caminho=caminho_usado,
            versao=versao,
            headless_shell=(canal_usado == "headless_shell"),
            capturas=("screenshot",),
            gpu=gpu_desc,
            contexto_seguro=True,
            sandbox=not any(a == "--no-sandbox" for a in args_launch),
        )
        return self._info

    @property
    def info(self) -> InfoNavegador:
        return self._garantir_lancado()

    def assinatura(self) -> str:
        inf = self.info
        return calcular_assinatura(
            inf.canal,
            inf.versao,
            modo_captura="screenshot",
            args_extra=self.args_extra,
        )

    def pagina(
        self,
        largura: int,
        altura: int,
        *,
        captura: Optional[str] = None,
        fundo_transparente: bool = True,
        rotulo: str = "",
    ) -> Pagina:
        del captura, fundo_transparente
        self._garantir_lancado()
        self._checar_cancelamento()
        page_pw = self._browser.new_page(viewport={"width": int(largura), "height": int(altura)})
        pg = Pagina(self, page_pw, int(largura), int(altura), rotulo=rotulo)
        self._paginas.add(pg)
        return pg

    def abortar(self) -> None:
        """Pode ser chamado de qualquer thread: marca aborto e mata a árvore do navegador."""
        with self._abort_lock:
            self._abortado = True
            pids = list(self._pids)
        for pid in pids:
            orfaos.matar_arvore_pid(pid)

    def fechar(self, *, forcar: bool = False) -> None:
        if self._fechado:
            return
        self._fechado = True

        for pg in list(self._paginas):
            try:
                pg._fechada = True
            except Exception:
                pass
        self._paginas.clear()

        if forcar or self._abortado:
            with self._abort_lock:
                pids = list(self._pids)
            for pid in pids:
                orfaos.matar_arvore_pid(pid)

        timer: Optional[threading.Timer] = None
        if self._browser is not None:
            def _matar_por_prazo() -> None:
                with self._abort_lock:
                    pids_t = list(self._pids)
                for pid in pids_t:
                    orfaos.matar_arvore_pid(pid)

            timer = threading.Timer(10.0, _matar_por_prazo)
            timer.daemon = True
            timer.start()
            try:
                if threading.get_ident() == self._thread_id:
                    self._browser.close()
            except Exception:
                _matar_por_prazo()
            finally:
                timer.cancel()

        if self._pw is not None:
            try:
                if threading.get_ident() == self._thread_id:
                    self._pw.stop()
            except Exception:
                pass

        self._browser = None
        self._pw = None

        if self._servidor is not None:
            try:
                self._servidor.parar()
            except Exception:
                pass
            self._servidor = None

        orfaos.remover_registro(self._arq_pids)
        self._arq_pids = None
        orfaos.desregistrar_instancia(self)

    def __enter__(self) -> "Navegador":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.fechar()
