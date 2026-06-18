"""Dependências comuns para injeção de recursos nas rotas do FastAPI."""
import sqlite3
from typing import Generator
from src.db.connection import get_db

def get_db_conn() -> Generator[sqlite3.Connection, None, None]:
    """Injeta uma conexão ativa com o banco SQLite configurado."""
    with get_db() as conn:
        yield conn
