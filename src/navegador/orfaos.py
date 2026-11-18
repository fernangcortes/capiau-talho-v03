"""Registro, varredura e encerramento de árvores de processos do navegador."""
from __future__ import annotations

import atexit
import json
import os
import signal
import subprocess
import threading
import time
import weakref
from pathlib import Path
from typing import Any, List, Optional, Sequence

_NOMES_NAVEGADOR = ("msedge", "chrome", "chromium", "headless_shell", "headless-shell")

_ATIVOS_LOCK = threading.Lock()
_ATIVOS: "weakref.WeakSet[Any]" = weakref.WeakSet()


def pasta_pids() -> Path:
    from src.config import CONFIG

    return Path(CONFIG.CACHE_DIR) / "navegador" / "pids"


def processo_vivo(pid: int) -> bool:
    """Verifica se um PID está em execução sem risco de matá-lo no Windows."""
    pid = int(pid)
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False

    import ctypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        codigo = ctypes.c_ulong()
        if kernel32.GetExitCodeProcess(handle, ctypes.byref(codigo)):
            return codigo.value == STILL_ACTIVE
        return True
    finally:
        kernel32.CloseHandle(handle)


def caminho_executavel_pid(pid: int) -> Optional[str]:
    """Devolve o caminho do executável de um PID ativo, ou None se indisponível."""
    pid = int(pid)
    if pid <= 0:
        return None
    if os.name == "nt":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            tamanho = ctypes.c_ulong(1024)
            buf = ctypes.create_unicode_buffer(tamanho.value)
            if kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(tamanho)):
                return buf.value
            return None
        finally:
            kernel32.CloseHandle(handle)

    proc_exe = Path(f"/proc/{pid}/exe")
    try:
        if proc_exe.exists():
            return os.readlink(proc_exe)
    except OSError:
        pass
    try:
        res = subprocess.run(
            ["ps", "-p", str(pid), "-o", "comm="],
            capture_output=True,
            text=True,
            timeout=2.0,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()[0].strip()
    except Exception:
        pass
    return None


def _imagem_corresponde(exe_atual: Optional[str], exe_registrado: Optional[str]) -> bool:
    if not exe_atual:
        return False
    nome_atual = Path(exe_atual).name.lower()
    if exe_registrado:
        reg_str = str(exe_registrado).strip()
        if os.sep in reg_str or "/" in reg_str:
            norm_atual = os.path.normcase(os.path.abspath(exe_atual))
            norm_reg = os.path.normcase(os.path.abspath(reg_str))
            if norm_atual == norm_reg:
                return True
            return nome_atual == Path(reg_str).name.lower() and any(
                chave in nome_atual for chave in _NOMES_NAVEGADOR
            )
        return nome_atual == Path(reg_str).name.lower()
    return any(chave in nome_atual for chave in _NOMES_NAVEGADOR)


def matar_arvore_pid(pid: int) -> bool:
    """Encerra o processo (e árvore quando possível) sem travar em subprocesso externo."""
    pid = int(pid)
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        PROCESS_TERMINATE = 0x0001
        SYNCHRONIZE = 0x00100000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, False, pid)
        if not handle:
            return not processo_vivo(pid)
        try:
            ok = bool(kernel32.TerminateProcess(handle, 1))
            if ok:
                kernel32.WaitForSingleObject(handle, 2000)
            return ok or not processo_vivo(pid)
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, signal.SIGKILL)
        return True
    except ProcessLookupError:
        return True
    except OSError:
        return False


def registrar_pids(
    token: str,
    pids: Sequence[int],
    executavel: Optional[str] = None,
    *,
    pid_dono: Optional[int] = None,
    pasta: Optional[Path] = None,
) -> Path:
    """Persiste os PIDs de uma instância do navegador para limpeza de órfãos."""
    dir_pids = Path(pasta) if pasta is not None else pasta_pids()
    dir_pids.mkdir(parents=True, exist_ok=True)
    dono = int(pid_dono if pid_dono is not None else os.getpid())
    limpo_pids = []
    vistos = set()
    for p in pids:
        try:
            n = int(p)
        except (TypeError, ValueError):
            continue
        if n > 0 and n not in vistos:
            vistos.add(n)
            limpo_pids.append(n)
    dados = {
        "pid_dono": dono,
        "token": str(token),
        "criado_em": time.time(),
        "executavel": str(executavel) if executavel else None,
        "pids": limpo_pids,
    }
    destino = dir_pids / f"{dono}-{token}.json"
    tmp = destino.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, destino)
    return destino


def remover_registro(caminho: Optional[Path]) -> None:
    if caminho is None:
        return
    try:
        Path(caminho).unlink(missing_ok=True)
    except OSError:
        pass


def varrer_orfaos(pasta: Optional[Path] = None) -> List[int]:
    """Mata apenas PIDs cujo dono morreu E cuja imagem do executável confere."""
    dir_pids = Path(pasta) if pasta is not None else pasta_pids()
    if not dir_pids.is_dir():
        return []

    encerrados: List[int] = []
    for arq in sorted(dir_pids.glob("*.json")):
        try:
            dados = json.loads(arq.read_text(encoding="utf-8"))
        except Exception:
            remover_registro(arq)
            continue

        if not isinstance(dados, dict):
            remover_registro(arq)
            continue

        try:
            pid_dono = int(dados.get("pid_dono") or 0)
        except (TypeError, ValueError):
            pid_dono = 0

        if pid_dono > 0 and processo_vivo(pid_dono):
            continue  # dono ativo: não mexe

        exe_reg = dados.get("executavel")
        for pid_raw in dados.get("pids") or []:
            try:
                pid = int(pid_raw)
            except (TypeError, ValueError):
                continue
            if pid <= 0 or not processo_vivo(pid):
                continue
            exe_atual = caminho_executavel_pid(pid)
            if not _imagem_corresponde(exe_atual, exe_reg):
                continue
            if matar_arvore_pid(pid):
                encerrados.append(pid)

        remover_registro(arq)

    return encerrados


def registrar_instancia(navegador: Any) -> None:
    with _ATIVOS_LOCK:
        _ATIVOS.add(navegador)


def desregistrar_instancia(navegador: Any) -> None:
    with _ATIVOS_LOCK:
        _ATIVOS.discard(navegador)


def abortar_todos() -> int:
    """Aborta todas as instâncias vivas de `Navegador` neste processo."""
    with _ATIVOS_LOCK:
        instancias = list(_ATIVOS)
    total = 0
    for nav in instancias:
        try:
            nav.abortar()
            total += 1
        except Exception:
            pass
    return total


atexit.register(abortar_todos)
