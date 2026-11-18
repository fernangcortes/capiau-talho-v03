"""Exceções públicas do módulo comum de navegador headless (`src/navegador`)."""
from __future__ import annotations


class NavegadorIndisponivel(RuntimeError):
    """Pacote Playwright ou executável Edge/Chrome/Headless Shell indisponível."""


class CapturaCancelada(Exception):
    """Captura interrompida por cancelamento cooperativo ou `abortar()`."""


class BeginFrameIndisponivel(RuntimeError):
    """Modo BeginFrame não suportado pelo navegador atual ou sonda falhou."""
