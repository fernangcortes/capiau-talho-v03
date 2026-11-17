"""Helpers de autenticação local para testes de rotas protegidas."""
from typing import Dict, Mapping, Optional

from src.api.security import get_local_token


def auth_headers(extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
    """Retorna cabeçalhos HTTP com Bearer token local para o TestClient."""
    headers: Dict[str, str] = {"Authorization": f"Bearer {get_local_token()}"}
    if extra:
        headers.update(extra)
    return headers
