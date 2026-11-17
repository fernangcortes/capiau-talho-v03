"""Guardas configuraveis de armazenamento somente leitura (Estagio 1B / SEC-02).

Centraliza a protecao contra escrita no acervo bruto (antes espalhada com
hardcodes de ``F:/``) permitindo configurar via ambiente e marcadores de volume:
- ``CAPIAU_READONLY_DRIVES``: lista de letras de drive protegidas (default ``"F"``
  quando a variavel nao esta definida; ``""`` desativa o bloqueio por letra).
- ``CAPIAU_READONLY_PATHS``: caminhos absolutos protegidos separados por
  ``os.pathsep`` (funciona em Windows, macOS e Linux).
- Marcadores no sistema de arquivos em qualquer ancestral do destino:
  ``.capiau-readonly`` ou ``.capiau-volume`` JSON com ``"read_only": true``.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional, Tuple, Union

READONLY_DRIVES_ENV = "CAPIAU_READONLY_DRIVES"
READONLY_PATHS_ENV = "CAPIAU_READONLY_PATHS"
DEFAULT_READONLY_DRIVES: Tuple[str, ...] = ("F",)
READONLY_MARKER_FILENAME = ".capiau-readonly"
VOLUME_MARKER_FILENAME = ".capiau-volume"

_DRIVE_SPLIT_RE = re.compile(r"[,;\s]+")


def _resolve_path(path: Union[str, os.PathLike]) -> Path:
    """Resolve caminho de forma tolerante caso o volume nao exista."""
    p = Path(path)
    try:
        return p.resolve()
    except OSError:
        return Path(os.path.abspath(str(p)))


def get_readonly_drives() -> tuple[str, ...]:
    """Retorna letras de drive protegidas a partir de ``CAPIAU_READONLY_DRIVES``.

    Se a variavel nao estiver definida no ambiente, assume ``("F",)`` para
    preservar o contrato de protecao do acervo bruto. Se estiver definida como
    string vazia (``""``), retorna ``()``.
    """
    raw = os.getenv(READONLY_DRIVES_ENV)
    if raw is None:
        return DEFAULT_READONLY_DRIVES
    stripped = raw.strip()
    if not stripped:
        return ()

    drives: list[str] = []
    seen: set[str] = set()
    for token in _DRIVE_SPLIT_RE.split(stripped):
        letter = token.strip().rstrip(":/\\").upper()
        if not letter or letter in seen:
            continue
        seen.add(letter)
        drives.append(letter)
    return tuple(drives)


def get_readonly_paths() -> tuple[Path, ...]:
    """Retorna caminhos somente leitura de ``CAPIAU_READONLY_PATHS`` (``os.pathsep``)."""
    raw = os.getenv(READONLY_PATHS_ENV)
    if not raw or not raw.strip():
        return ()

    paths: list[Path] = []
    seen: set[Path] = set()
    for token in raw.split(os.pathsep):
        cleaned = token.strip()
        if not cleaned:
            continue
        resolved = _resolve_path(cleaned)
        if resolved in seen:
            continue
        seen.add(resolved)
        paths.append(resolved)
    return tuple(paths)


def _has_readonly_volume_marker(path: Path) -> Optional[Path]:
    """Verifica se algum ancestral do destino contem marcador somente leitura.

    Aceita ``.capiau-readonly`` (arquivo sentinela) ou ``.capiau-volume``
    (JSON contendo ``"read_only": true``). Retorna o caminho do marcador
    encontrado ou ``None``.
    """
    resolved = _resolve_path(path)
    for candidate in (resolved, *resolved.parents):
        try:
            if not candidate.is_dir():
                continue
            ro_marker = candidate / READONLY_MARKER_FILENAME
            if ro_marker.is_file():
                return ro_marker
            vol_marker = candidate / VOLUME_MARKER_FILENAME
            if vol_marker.is_file():
                try:
                    payload = json.loads(vol_marker.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                    payload = None
                if isinstance(payload, dict) and payload.get("read_only") is True:
                    return vol_marker
        except OSError:
            continue
    return None


def check_readonly_destination(dest: Union[str, os.PathLike]) -> Optional[str]:
    """Retorna motivo claro se ``dest`` for somente leitura, ou ``None`` se gravavel."""
    resolved = _resolve_path(dest)

    drive_letter = resolved.drive.rstrip(":").upper()
    if drive_letter and drive_letter in get_readonly_drives():
        return (
            f"Destino dentro do drive {drive_letter}:/ "
            f"(acervo bruto, somente leitura) e proibido: {resolved}"
        )

    for ro_path in get_readonly_paths():
        try:
            if resolved.is_relative_to(ro_path):
                return (
                    f"Destino dentro da pasta protegida '{ro_path}' "
                    f"(somente leitura) e proibido: {resolved}"
                )
        except ValueError:
            continue

    marker = _has_readonly_volume_marker(resolved)
    if marker is not None:
        return (
            f"Destino dentro do volume protegido '{marker.parent}' "
            f"(somente leitura via {marker.name}) e proibido: {resolved}"
        )

    return None


def ensure_writable_destination(dest: Union[str, os.PathLike]) -> Path:
    """Resolve ``dest``, recusa destinos somente leitura e cria o diretorio."""
    resolved = _resolve_path(dest)
    reason = check_readonly_destination(resolved)
    if reason:
        raise ValueError(reason)
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved
