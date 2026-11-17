"""Núcleo de segurança HTTP, validação de origem/token local e saneamento de uploads/ZIPs."""
from __future__ import annotations

import hmac
import ipaddress
import ntpath
import os
import re
import secrets
import shutil
import threading
import zipfile
import zlib
from pathlib import Path
from typing import Iterable, List, Optional, Set
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, UploadFile

from src.config import CONFIG

# ── Limites padrão (podem ser sobrescritos via variáveis CAPIAU_*) ────────────
DEFAULT_MAX_UPLOAD_FILES = 100
DEFAULT_MAX_MEDIA_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024
DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024
DEFAULT_MAX_DOC_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_TIMELINE_UPLOAD_BYTES = 50 * 1024 * 1024
DEFAULT_MAX_IMPORT_ZIP_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_MAX_ZIP_MEMBERS = 10000
DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
DEFAULT_MAX_ZIP_RATIO = 50.0

UPLOAD_CHUNK_SIZE = 64 * 1024
_ZIP_RATIO_MIN_CHECK_BYTES = 1024 * 1024  # 1 MB
_DRIVE_PREFIX_RE = re.compile(r"^[A-Za-z]:")
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})

_TOKEN_LOCK = threading.Lock()
_PROCESS_LOCAL_TOKEN: Optional[str] = None


def _read_int_limit(env_name: str, default: int) -> int:
    raw = os.getenv(env_name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw.strip())
        return value if value > 0 else default
    except ValueError:
        return default


def _read_float_limit(env_name: str, default: float) -> float:
    raw = os.getenv(env_name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw.strip())
        return value if value > 0 else default
    except ValueError:
        return default


def get_max_upload_files() -> int:
    return _read_int_limit("CAPIAU_MAX_UPLOAD_FILES", DEFAULT_MAX_UPLOAD_FILES)


def get_max_media_upload_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_MEDIA_UPLOAD_BYTES", DEFAULT_MAX_MEDIA_UPLOAD_BYTES)


def get_max_total_upload_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_TOTAL_UPLOAD_BYTES", DEFAULT_MAX_TOTAL_UPLOAD_BYTES)


def get_max_doc_upload_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_DOC_UPLOAD_BYTES", DEFAULT_MAX_DOC_UPLOAD_BYTES)


def get_max_timeline_upload_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_TIMELINE_UPLOAD_BYTES", DEFAULT_MAX_TIMELINE_UPLOAD_BYTES)


def get_max_import_zip_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_IMPORT_ZIP_BYTES", DEFAULT_MAX_IMPORT_ZIP_BYTES)


def get_max_zip_members() -> int:
    return _read_int_limit("CAPIAU_MAX_ZIP_MEMBERS", DEFAULT_MAX_ZIP_MEMBERS)


def get_max_zip_uncompressed_bytes() -> int:
    return _read_int_limit("CAPIAU_MAX_ZIP_UNCOMPRESSED_BYTES", DEFAULT_MAX_ZIP_UNCOMPRESSED_BYTES)


def get_max_zip_ratio() -> float:
    return _read_float_limit("CAPIAU_MAX_ZIP_RATIO", DEFAULT_MAX_ZIP_RATIO)


def _local_token_file_path() -> Path:
    return Path(CONFIG.DB_PATH).parent / ".local_token"


def _persist_local_token(token: str) -> None:
    token_path = _local_token_file_path()
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(token, encoding="utf-8")
    if os.name != "nt":
        os.chmod(token_path, 0o600)


def get_local_token() -> str:
    """Retorna o token local da sessão (CAPIAU_LOCAL_TOKEN ou gerado uma vez por processo)."""
    global _PROCESS_LOCAL_TOKEN

    env_token = (os.getenv("CAPIAU_LOCAL_TOKEN") or "").strip()
    if env_token:
        return env_token

    with _TOKEN_LOCK:
        if _PROCESS_LOCAL_TOKEN is None:
            _PROCESS_LOCAL_TOKEN = secrets.token_urlsafe(32)
            _persist_local_token(_PROCESS_LOCAL_TOKEN)
        else:
            token_path = _local_token_file_path()
            if not token_path.exists():
                _persist_local_token(_PROCESS_LOCAL_TOKEN)
        return _PROCESS_LOCAL_TOKEN


def _get_client_host(request: Request) -> str:
    client = getattr(request, "client", None)
    if client is None:
        return ""
    host = getattr(client, "host", None)
    if host is None and isinstance(client, (tuple, list)) and client:
        host = client[0]
    return (str(host or "").strip().lower()).strip("[]")


def is_loopback_client(request: Request) -> bool:
    """Retorna True se o cliente conectado for loopback local ou TestClient."""
    host = _get_client_host(request)
    if not host:
        return False
    if host in {"127.0.0.1", "::1", "localhost", "testclient"}:
        return True
    try:
        addr = ipaddress.ip_address(host.split("%", 1)[0])
        if addr.is_loopback:
            return True
        if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped and addr.ipv4_mapped.is_loopback:
            return True
    except ValueError:
        pass
    return False


def _extract_host_without_port(host_header: str) -> Optional[str]:
    raw = (host_header or "").strip().lower()
    if not raw or any(ch in raw for ch in ("/", "\\", "@", " ", "\t", "\r", "\n")):
        return None
    if raw.startswith("["):
        end = raw.find("]")
        if end == -1:
            return None
        host_part = raw[1:end]
        rest = raw[end + 1:]
        if rest:
            if not rest.startswith(":") or not rest[1:].isdigit():
                return None
        return host_part or None
    if raw == "::1":
        return "::1"
    if ":" in raw:
        host_part, port_part = raw.rsplit(":", 1)
        if ":" in host_part or not port_part.isdigit() or not host_part:
            return None
        return host_part
    return raw


def _get_extra_allowed_hosts() -> Set[str]:
    raw = os.getenv("CAPIAU_ALLOWED_HOSTS", "")
    if not raw:
        return set()
    entries: Set[str] = set()
    for part in re.split(r"[\s,;]+", raw):
        cleaned = part.strip().lower()
        if cleaned:
            entries.add(cleaned)
    return entries


def _is_allowed_host(host_header: str, request: Request) -> bool:
    raw_host = (host_header or "").strip().lower()
    hostname = _extract_host_without_port(raw_host)
    if not hostname:
        return False

    if hostname in _LOOPBACK_HOSTS:
        return True

    if hostname == "testserver" and _get_client_host(request) == "testclient":
        return True

    extra_hosts = _get_extra_allowed_hosts()
    if raw_host in extra_hosts or hostname in extra_hosts:
        return True

    return False


def _is_allowed_local_origin(origin_header: str) -> bool:
    raw = (origin_header or "").strip()
    if not raw or raw.lower() == "null":
        return False
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return False

    if parsed.scheme.lower() != "http":
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        return False

    try:
        _ = parsed.port
    except ValueError:
        return False

    hostname = (parsed.hostname or "").lower()
    return hostname in _LOOPBACK_HOSTS


def validate_local_host_and_origin(request: Request) -> None:
    """Valida cabeçalhos Host e Origin para impedir DNS rebinding e CSRF cross-origin."""
    host_header = request.headers.get("host", "")
    if not _is_allowed_host(host_header, request):
        raise HTTPException(status_code=403, detail="Cabeçalho Host não autorizado para esta API.")

    if "origin" in request.headers:
        origin_header = request.headers.get("origin", "")
        if not _is_allowed_local_origin(origin_header):
            raise HTTPException(status_code=403, detail="Cabeçalho Origin externo não autorizado.")


def require_local_auth(request: Request) -> str:
    """Valida Host/Origin locais e exige Bearer token ou X-Capiau-Token igual ao token local."""
    validate_local_host_and_origin(request)

    token: Optional[str] = None
    auth_header = request.headers.get("authorization")
    if auth_header:
        parts = auth_header.strip().split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1].strip()

    if not token:
        x_token = request.headers.get("x-capiau-token")
        if x_token:
            token = x_token.strip()

    expected = get_local_token()
    if not token or not expected or not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=401,
            detail="Autenticação local obrigatória ou token inválido.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return token


def validate_upload_filename(
    filename: Optional[str],
    allowed_exts: Optional[Iterable[str]] = None,
) -> str:
    """Valida nome bruto de arquivo enviado antes de qualquer operação de disco."""
    if not isinstance(filename, str) or not filename.strip():
        raise HTTPException(status_code=400, detail="Nome de arquivo ausente ou vazio.")

    if "\x00" in filename or any(ord(ch) < 32 for ch in filename):
        raise HTTPException(status_code=400, detail="Nome de arquivo contém caracteres inválidos.")

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo contém sequência de caminho não permitida.")

    drive, _ = ntpath.splitdrive(filename)
    if drive or _DRIVE_PREFIX_RE.match(filename) or ":" in filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo contém prefixo de drive ou ':' inválido.")

    if filename in (".", "..") or Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")

    if allowed_exts is not None:
        normalized_exts = {
            (ext.lower() if ext.startswith(".") else f".{ext.lower()}")
            for ext in allowed_exts
            if ext
        }
        ext = Path(filename).suffix.lower()
        if not ext or ext not in normalized_exts:
            raise HTTPException(
                status_code=400,
                detail=f"Extensão de arquivo não permitida: '{ext or 'sem extensão'}'.",
            )

    return filename


def resolve_confined_path(base_dir: Path, filename: str) -> Path:
    """Resolve destino dentro de base_dir garantindo confinamento estrito."""
    if not isinstance(filename, str) or not filename or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido para resolução de caminho.")

    base_resolved = Path(base_dir).resolve()
    target = (base_resolved / filename).resolve()
    if target == base_resolved or not target.is_relative_to(base_resolved):
        raise HTTPException(status_code=400, detail="Caminho de destino fora do diretório permitido.")
    return target


async def read_upload_bounded(
    upload: UploadFile,
    max_bytes: int,
    label: str = "arquivo",
) -> bytes:
    """Lê um UploadFile em chunks de 64 KB respeitando max_bytes."""
    if max_bytes < 0:
        raise HTTPException(status_code=413, detail=f"{label} excede o limite permitido.")

    buffer = bytearray()
    total = 0
    while True:
        chunk = await upload.read(UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"{label} excede o limite máximo de {max_bytes} bytes.",
            )
        buffer.extend(chunk)
    return bytes(buffer)


async def stream_upload_to_file(
    upload: UploadFile,
    dest_path: Path,
    max_bytes: int,
    label: str = "arquivo",
) -> int:
    """Grava UploadFile em streaming de 64 KB em dest_path; remove arquivo em caso de erro ou 413."""
    dest_path = Path(dest_path)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    handle = None
    try:
        handle = open(dest_path, "wb")
        while True:
            chunk = await upload.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"{label} excede o limite máximo de {max_bytes} bytes.",
                )
            handle.write(chunk)
        handle.flush()
        return total
    except Exception:
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass
            handle = None
        try:
            if dest_path.exists():
                dest_path.unlink()
        except OSError:
            pass
        raise
    finally:
        if handle is not None:
            try:
                handle.close()
            except OSError:
                pass


def _validate_zip_member_path(raw_name: str, staging_resolved: Path) -> Path:
    if not raw_name or "\x00" in raw_name or any(ord(ch) < 32 for ch in raw_name):
        raise HTTPException(status_code=400, detail="Entrada inválida no arquivo ZIP.")

    if "\\" in raw_name:
        raise HTTPException(status_code=400, detail=f"Separador inválido no ZIP: {raw_name}")

    if raw_name.startswith("/"):
        raise HTTPException(status_code=400, detail=f"Caminho absoluto não permitido no ZIP: {raw_name}")

    drive, _ = ntpath.splitdrive(raw_name)
    if drive or _DRIVE_PREFIX_RE.match(raw_name):
        raise HTTPException(status_code=400, detail=f"Prefixo de drive não permitido no ZIP: {raw_name}")

    parts = [part for part in raw_name.split("/") if part not in ("", ".")]
    if any(part == ".." for part in raw_name.split("/")):
        raise HTTPException(status_code=400, detail=f"Path traversal detectado no ZIP: {raw_name}")

    if not parts:
        return staging_resolved

    target = staging_resolved.joinpath(*parts).resolve()
    if target == staging_resolved or not target.is_relative_to(staging_resolved):
        raise HTTPException(status_code=400, detail=f"Entrada do ZIP escapa do diretório de destino: {raw_name}")
    return target


def safe_extract_zip(
    zip_path: Path,
    staging_dir: Path,
    max_members: Optional[int] = None,
    max_uncompressed_bytes: Optional[int] = None,
    max_ratio: Optional[float] = None,
) -> List[str]:
    """Valida e extrai ZIP em staging_dir com proteção contra traversal, symlinks e zip-bomb."""
    zip_path = Path(zip_path)
    staging_dir = Path(staging_dir)

    if not zip_path.exists() or not zipfile.is_zipfile(zip_path):
        raise HTTPException(status_code=400, detail="Arquivo enviado não é um ZIP válido.")

    effective_max_members = max_members if max_members is not None else get_max_zip_members()
    effective_max_uncompressed = (
        max_uncompressed_bytes if max_uncompressed_bytes is not None else get_max_zip_uncompressed_bytes()
    )
    effective_max_ratio = max_ratio if max_ratio is not None else get_max_zip_ratio()

    zip_disk_size = max(zip_path.stat().st_size, 1)
    staging_existed = staging_dir.exists()
    staging_dir.mkdir(parents=True, exist_ok=True)
    staging_resolved = staging_dir.resolve()

    created_files: List[Path] = []
    created_dirs: List[Path] = []
    extracted_relpaths: List[str] = []

    try:
        try:
            zf_ctx = zipfile.ZipFile(zip_path, "r")
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="Arquivo ZIP corrompido ou inválido.") from exc

        with zf_ctx as zf:
            infos = zf.infolist()
            if len(infos) > effective_max_members:
                raise HTTPException(
                    status_code=413,
                    detail=f"ZIP excede o máximo permitido de {effective_max_members} membros.",
                )

            declared_total = 0
            validated_entries = []
            for info in infos:
                unix_mode = (info.external_attr >> 16) & 0o170000
                if unix_mode == 0o120000:
                    raise HTTPException(status_code=400, detail=f"Symlink não permitido no ZIP: {info.filename}")
                if unix_mode not in (0, 0o100000, 0o040000):
                    raise HTTPException(status_code=400, detail=f"Tipo de entrada não permitido no ZIP: {info.filename}")

                if info.file_size < 0 or info.compress_size < 0:
                    raise HTTPException(status_code=400, detail=f"Metadados inválidos no ZIP: {info.filename}")

                target = _validate_zip_member_path(info.filename, staging_resolved)
                declared_total += info.file_size
                if declared_total > effective_max_uncompressed:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Tamanho descomprimido declarado excede {effective_max_uncompressed} bytes.",
                    )
                if (max_ratio is not None or declared_total > _ZIP_RATIO_MIN_CHECK_BYTES) and (
                    declared_total / zip_disk_size > effective_max_ratio
                ):
                    raise HTTPException(
                        status_code=413,
                        detail="Razão de expansão declarada do ZIP excede o limite de segurança.",
                    )
                validated_entries.append((info, target))

            actual_total = 0
            for info, target in validated_entries:
                if target == staging_resolved:
                    continue

                if info.is_dir():
                    if not target.exists():
                        target.mkdir(parents=True, exist_ok=True)
                        created_dirs.append(target)
                    continue

                if not target.parent.exists():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    created_dirs.append(target.parent)

                out_handle = None
                try:
                    with zf.open(info, "r") as src:
                        out_handle = open(target, "wb")
                        created_files.append(target)
                        while True:
                            chunk = src.read(UPLOAD_CHUNK_SIZE)
                            if not chunk:
                                break
                            actual_total += len(chunk)
                            if actual_total > effective_max_uncompressed:
                                raise HTTPException(
                                    status_code=413,
                                    detail=f"ZIP excede o limite máximo descomprimido de {effective_max_uncompressed} bytes.",
                                )
                            if (max_ratio is not None or actual_total > _ZIP_RATIO_MIN_CHECK_BYTES) and (
                                actual_total / zip_disk_size > effective_max_ratio
                            ):
                                raise HTTPException(
                                    status_code=413,
                                    detail="Razão de expansão do ZIP excede o limite de segurança (possível zip-bomb).",
                                )
                            out_handle.write(chunk)
                        out_handle.flush()
                except HTTPException:
                    raise
                except (zipfile.BadZipFile, zlib.error, EOFError, RuntimeError) as exc:
                    raise HTTPException(status_code=400, detail="Arquivo ZIP corrompido ou criptografado.") from exc
                finally:
                    if out_handle is not None:
                        try:
                            out_handle.close()
                        except OSError:
                            pass

                extracted_relpaths.append(target.relative_to(staging_resolved).as_posix())

        return extracted_relpaths
    except Exception:
        for file_path in reversed(created_files):
            try:
                if file_path.exists():
                    file_path.unlink()
            except OSError:
                pass
        if not staging_existed:
            shutil.rmtree(staging_resolved, ignore_errors=True)
        else:
            for dir_path in reversed(created_dirs):
                try:
                    if dir_path.exists() and dir_path != staging_resolved:
                        shutil.rmtree(dir_path, ignore_errors=True)
                except OSError:
                    pass
        raise
