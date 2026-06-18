"""Gerenciador de conexões SQLite com suporte a transações e chaves estrangeiras."""
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Generator, Optional
from src.config import CONFIG

@contextmanager
def get_db(db_path: Optional[Path] = None) -> Generator[sqlite3.Connection, None, None]:
    """Context manager para fornecer conexões ativas com o banco relacional SQLite."""
    if db_path is None:
        db_path = CONFIG.DB_PATH
    
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")  # Garante deleção em cascata física
    conn.row_factory = sqlite3.Row            # Permite indexar colunas por nome
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
