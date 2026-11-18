"""Módulo comum de navegador headless do CapIAu-Talho."""
from __future__ import annotations

from .diagnostico import diagnosticar, diagnostico_barato, navegador_utilizavel
from .erros import BeginFrameIndisponivel, CapturaCancelada, NavegadorIndisponivel
from .lancador import (
    InfoNavegador,
    Navegador,
    Pagina,
    PedidoQuadro,
    Quadro,
    QuadroGravado,
    calcular_assinatura,
)
from .servidor import Saida, ServidorLocal

__all__ = [
    "BeginFrameIndisponivel",
    "CapturaCancelada",
    "InfoNavegador",
    "Navegador",
    "NavegadorIndisponivel",
    "Pagina",
    "PedidoQuadro",
    "Quadro",
    "QuadroGravado",
    "Saida",
    "ServidorLocal",
    "calcular_assinatura",
    "diagnosticar",
    "diagnostico_barato",
    "navegador_utilizavel",
]
