"""Diagnóstico barato (< 100 ms, sem subprocesso) e completo do navegador headless."""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CANAIS_PADRAO = ("msedge", "chrome", "headless_shell", None)

_CACHE_LOCK = threading.Lock()
_CACHE_UTILIZAVEL: Optional[bool] = None


def _pasta_headless_shell_padrao() -> Path:
    env = os.environ.get("CAPIAU_HEADLESS_SHELL_DIR")
    if env:
        return Path(env)
    return Path.home() / ".cache" / "capiau" / "chrome-headless-shell"


def _localizar_headless_shell() -> Optional[Path]:
    raiz = _pasta_headless_shell_padrao()
    if not raiz.is_dir():
        return None
    padroes = (
        "*/chrome-headless-shell-win*/chrome-headless-shell.exe",
        "*/chrome-headless-shell-linux*/chrome-headless-shell",
        "*/chrome-headless-shell-mac*/chrome-headless-shell",
        "chrome-headless-shell.exe",
        "chrome-headless-shell",
    )
    for pat in padroes:
        encontrados = sorted(raiz.glob(pat), reverse=True)
        for cand in encontrados:
            if cand.is_file():
                return cand
    return None


def _localizar_playwright_chromium() -> Optional[Path]:
    pw_dirs: List[Path] = []
    env_pw = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_pw and env_pw != "0":
        pw_dirs.append(Path(env_pw))
    else:
        if os.name == "nt" and os.environ.get("LocalAppData"):
            pw_dirs.append(Path(os.environ["LocalAppData"]) / "ms-playwright")
        elif sys.platform == "darwin":
            pw_dirs.append(Path.home() / "Library" / "Caches" / "ms-playwright")
        else:
            pw_dirs.append(Path.home() / ".cache" / "ms-playwright")

    padroes = (
        "chromium-*/chrome-win*/chrome.exe",
        "chromium-*/chrome-linux*/chrome",
        "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
        "chromium_headless_shell-*/chrome-headless-shell-win*/chrome-headless-shell.exe",
        "chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell",
        "chromium_headless_shell-*/chrome-headless-shell-mac*/chrome-headless-shell",
    )
    for pw_dir in pw_dirs:
        if not pw_dir.is_dir():
            continue
        for pat in padroes:
            encontrados = sorted(pw_dir.glob(pat), reverse=True)
            for cand in encontrados:
                if cand.is_file():
                    return cand
    return None


def _localizar_msedge() -> Optional[Path]:
    for cmd in ("msedge", "microsoft-edge"):
        achado = shutil.which(cmd)
        if achado:
            return Path(achado)
    if os.name == "nt":
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
            base = os.environ.get(var)
            if not base:
                continue
            cand = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if cand.is_file():
                return cand
    elif sys.platform == "darwin":
        cand = Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
        if cand.is_file():
            return cand
    else:
        for p in (Path("/opt/microsoft/msedge/msedge"), Path("/usr/bin/microsoft-edge")):
            if p.is_file():
                return p
    return None


def _localizar_chrome() -> Optional[Path]:
    for cmd in ("chrome", "google-chrome", "chromium", "chromium-browser"):
        achado = shutil.which(cmd)
        if achado:
            return Path(achado)
    if os.name == "nt":
        for var in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData"):
            base = os.environ.get(var)
            if not base:
                continue
            cand = Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if cand.is_file():
                return cand
    elif sys.platform == "darwin":
        for cand in (
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        ):
            if cand.is_file():
                return cand
    else:
        for p in (
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/chromium"),
            Path("/usr/bin/chromium-browser"),
        ):
            if p.is_file():
                return p
    return None


def localizar_executavel_instalado(
    preferir: str = "auto",
    caminho_config: str = "",
) -> Tuple[Optional[str], Optional[Path]]:
    """Inspeciona executáveis sem abrir processos. Retorna `(canal, caminho)`."""
    if caminho_config:
        p = Path(caminho_config).expanduser()
        if p.is_file():
            return "caminho", p
        return None, None

    pref = str(preferir or "auto").strip().lower()
    ordem = (
        [pref]
        if pref in ("msedge", "chrome", "headless_shell", "playwright")
        else ["msedge", "chrome", "headless_shell", "playwright"]
    )
    for item in ordem:
        if item == "msedge":
            p = _localizar_msedge()
            if p:
                return "msedge", p
        elif item == "chrome":
            p = _localizar_chrome()
            if p:
                return "chrome", p
        elif item == "headless_shell":
            p = _localizar_headless_shell()
            if p:
                return "headless_shell", p
        elif item == "playwright":
            p = _localizar_playwright_chromium()
            if p:
                return "playwright", p
    return None, None


def diagnostico_barato(
    *,
    preferir: str = "auto",
    caminho_config: str = "",
) -> Dict[str, Any]:
    """Checa pacote Playwright e presença de navegador sem lançar subprocessos (< 100 ms)."""
    t0 = time.perf_counter()
    pw_ok = importlib.util.find_spec("playwright") is not None
    canal, caminho = localizar_executavel_instalado(
        preferir=preferir,
        caminho_config=caminho_config,
    )
    exe_ok = canal is not None

    if not pw_ok:
        motivo = (
            "Pacote 'playwright' não está instalado no ambiente do Talho: "
            "sem ele os títulos não são desenhados no arquivo."
        )
    elif not exe_ok:
        motivo = (
            "Pacote 'playwright' está instalado, mas nenhum executável Edge, Chrome, "
            "Chromium ou Chrome Headless Shell foi encontrado nesta máquina."
        )
    else:
        motivo = None

    ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        "ok": bool(pw_ok and exe_ok),
        "playwright_instalado": pw_ok,
        "executavel_encontrado": exe_ok,
        "canal_provavel": canal,
        "caminho": str(caminho) if caminho else None,
        "motivo": motivo,
        "duracao_ms": ms,
    }


def navegador_utilizavel(*, forcar_rechecagem: bool = False) -> bool:
    """Confirma uma vez por processo se o navegador realmente abre; cacheia o resultado."""
    global _CACHE_UTILIZAVEL
    with _CACHE_LOCK:
        if _CACHE_UTILIZAVEL is not None and not forcar_rechecagem:
            return _CACHE_UTILIZAVEL

    barato = diagnostico_barato()
    if not barato["ok"]:
        with _CACHE_LOCK:
            _CACHE_UTILIZAVEL = False
        return False

    from .lancador import Navegador

    ok = False
    try:
        with tempfile.TemporaryDirectory(prefix="capiau_nav_probe_") as tmp:
            with Navegador(Path(tmp), rotulo="sonda") as nav:
                _ = nav.info
                ok = True
    except Exception:
        ok = False

    with _CACHE_LOCK:
        _CACHE_UTILIZAVEL = ok
    return ok


def diagnosticar(*, sondar_beginframe: bool = False, timeout_s: float = 30.0) -> Dict[str, Any]:
    """Executa diagnóstico completo lançando o navegador contra o servidor local."""
    barato = diagnostico_barato()
    if not barato["ok"]:
        return {
            **barato,
            "lancamento_ok": False,
            "contexto_seguro": False,
            "audio_worklet_disponivel": False,
        }

    from .lancador import Navegador

    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="capiau_nav_diag_") as tmp:
        tmp_path = Path(tmp)
        html = tmp_path / "diag.html"
        html.write_text(
            "<!DOCTYPE html><html><head><meta charset='utf-8'></head>"
            "<body><div id='ok'>ok</div><script>window.DIAG_PRONTO=true;</script></body></html>",
            encoding="utf-8",
        )
        with Navegador(tmp_path, rotulo="diagnostico") as nav:
            info = nav.info
            assinatura_nav = nav.assinatura()
            prefixo_url = nav.servidor.publicar_pasta("diag", tmp_path)
            pg = nav.pagina(128, 128, rotulo="diag")
            try:
                pg.abrir(
                    f"{prefixo_url}/diag.html",
                    pronto="window.DIAG_PRONTO === true",
                    timeout_s=timeout_s,
                )
                probe = pg.avaliar(
                    """() => {
                        const vid = document.createElement('video');
                        const audioOk = typeof OfflineAudioContext !== 'undefined'
                            && typeof new OfflineAudioContext(1, 1, 44100).audioWorklet === 'object';
                        return {
                            isSecureContext: window.isSecureContext === true,
                            audioWorklet: audioOk,
                            userAgent: navigator.userAgent,
                            canPlayH264: vid.canPlayType('video/mp4; codecs="avc1.640028"'),
                            canPlayVp9: vid.canPlayType('video/webm; codecs="vp9"'),
                            origin: window.location.origin,
                        };
                    }"""
                )
            finally:
                pg.fechar()

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    return {
        **barato,
        "lancamento_ok": True,
        "tempo_arranque_ms": elapsed_ms,
        "canal": info.canal,
        "versao": info.versao,
        "gpu": info.gpu,
        "sandbox": info.sandbox,
        "assinatura": assinatura_nav,
        "contexto_seguro": bool(probe.get("isSecureContext")),
        "audio_worklet_disponivel": bool(probe.get("audioWorklet")),
        "user_agent": probe.get("userAgent"),
        "can_play_h264": probe.get("canPlayH264"),
        "can_play_vp9": probe.get("canPlayVp9"),
        "origem": probe.get("origin"),
        "beginframe_sondado": bool(sondar_beginframe),
    }
