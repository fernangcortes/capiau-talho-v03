"""Utilitários de backup e restauração consistentes para SQLite (WAL-safe)."""
import hashlib
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Any, Dict


def _compute_sha256_and_size(file_path: Path) -> tuple[str, int]:
    """Calcula SHA-256 hexadecimal e tamanho em bytes de um arquivo."""
    digest = hashlib.sha256()
    size = 0
    with open(file_path, "rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _check_sqlite_integrity(conn: sqlite3.Connection, label: str) -> None:
    """Executa PRAGMA integrity_check e levanta RuntimeError se houver falha."""
    try:
        rows = conn.execute("PRAGMA integrity_check").fetchall()
    except sqlite3.DatabaseError as exc:
        raise RuntimeError(f"{label}: falha ao verificar integridade SQLite: {exc}") from exc

    if len(rows) != 1 or str(rows[0][0]).strip().lower() != "ok":
        details = "; ".join(str(r[0]) for r in rows) if rows else "resultado vazio"
        raise RuntimeError(f"{label}: PRAGMA integrity_check falhou: {details}")


def create_consistent_sqlite_backup(source_db: Path, dest_db: Path) -> Dict[str, Any]:
    """Cria backup consistente do SQLite via sqlite3.Connection.backup().

    Copia as páginas para um arquivo temporário no diretório de destino,
    valida `PRAGMA integrity_check`, calcula SHA-256 e tamanho em bytes
    e realiza substituição atômica via `os.replace`.
    """
    source_path = Path(source_db)
    dest_path = Path(dest_db)

    if not source_path.exists():
        raise FileNotFoundError(f"Banco SQLite de origem não encontrado: {source_path}")

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=dest_path.parent,
        prefix=f".{dest_path.name}.",
        suffix=".tmp",
    )
    os.close(fd)
    tmp_path = Path(tmp_name)

    src_conn: sqlite3.Connection | None = None
    dst_conn: sqlite3.Connection | None = None
    try:
        src_conn = sqlite3.connect(str(source_path), timeout=30.0)
        src_conn.execute("PRAGMA busy_timeout = 30000")

        dst_conn = sqlite3.connect(str(tmp_path), timeout=30.0)
        dst_conn.execute("PRAGMA busy_timeout = 30000")

        try:
            src_conn.backup(dst_conn)
        except sqlite3.DatabaseError as exc:
            raise RuntimeError(f"Backup SQLite falhou durante cópia/integridade: {exc}") from exc
        _check_sqlite_integrity(dst_conn, "Backup SQLite")

        dst_conn.close()
        dst_conn = None
        src_conn.close()
        src_conn = None

        sha256_hex, size_bytes = _compute_sha256_and_size(tmp_path)
        os.replace(tmp_path, dest_path)

        return {
            "source_db": str(source_path),
            "dest_db": str(dest_path),
            "path": str(dest_path),
            "sha256": sha256_hex,
            "size_bytes": size_bytes,
            "integrity": "ok",
        }
    except Exception:
        if dst_conn is not None:
            try:
                dst_conn.close()
            except Exception:
                pass
        if src_conn is not None:
            try:
                src_conn.close()
            except Exception:
                pass
        tmp_path.unlink(missing_ok=True)
        raise


def restore_sqlite_backup(backup_db: Path, target_db: Path) -> Dict[str, Any]:
    """Valida `PRAGMA integrity_check` do backup e restaura atomicamente para `target_db`."""
    backup_path = Path(backup_db)
    target_path = Path(target_db)

    if not backup_path.exists():
        raise FileNotFoundError(f"Arquivo de backup SQLite não encontrado: {backup_path}")

    target_path.parent.mkdir(parents=True, exist_ok=True)

    bkp_conn: sqlite3.Connection | None = None
    target_conn: sqlite3.Connection | None = None
    tmp_path: Path | None = None
    try:
        bkp_conn = sqlite3.connect(str(backup_path), timeout=30.0)
        bkp_conn.execute("PRAGMA busy_timeout = 30000")
        _check_sqlite_integrity(bkp_conn, "Validação do backup SQLite")

        sha256_hex, size_bytes = _compute_sha256_and_size(backup_path)

        if target_path.exists():
            try:
                target_conn = sqlite3.connect(str(target_path), timeout=30.0)
                target_conn.execute("PRAGMA busy_timeout = 30000")
                bkp_conn.backup(target_conn)
                _check_sqlite_integrity(target_conn, "Destino restaurado")
                try:
                    target_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                except sqlite3.DatabaseError:
                    pass
                target_conn.close()
                target_conn = None
                return {
                    "backup_db": str(backup_path),
                    "target_db": str(target_path),
                    "sha256": sha256_hex,
                    "size_bytes": size_bytes,
                    "integrity": "ok",
                }
            except sqlite3.DatabaseError:
                if target_conn is not None:
                    try:
                        target_conn.close()
                    except Exception:
                        pass
                    target_conn = None

        # Destino ainda não existe ou estava corrompido: cria em temp no mesmo diretório e substitui
        fd, tmp_name = tempfile.mkstemp(
            dir=target_path.parent,
            prefix=f".{target_path.name}.",
            suffix=".restore.tmp",
        )
        os.close(fd)
        tmp_path = Path(tmp_name)

        tmp_conn = sqlite3.connect(str(tmp_path), timeout=30.0)
        try:
            tmp_conn.execute("PRAGMA busy_timeout = 30000")
            bkp_conn.backup(tmp_conn)
            _check_sqlite_integrity(tmp_conn, "Staging de restauração")
        finally:
            tmp_conn.close()

        bkp_conn.close()
        bkp_conn = None

        os.replace(tmp_path, target_path)
        tmp_path = None
        for suffix in ("-wal", "-shm"):
            Path(f"{target_path}{suffix}").unlink(missing_ok=True)

        return {
            "backup_db": str(backup_path),
            "target_db": str(target_path),
            "sha256": sha256_hex,
            "size_bytes": size_bytes,
            "integrity": "ok",
        }
    finally:
        if target_conn is not None:
            try:
                target_conn.close()
            except Exception:
                pass
        if bkp_conn is not None:
            try:
                bkp_conn.close()
            except Exception:
                pass
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
