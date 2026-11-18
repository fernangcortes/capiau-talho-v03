"""Modelos locais opcionais: estado e download a pedido do usuário.

Nada aqui roda sozinho: a interface lista (GET) e o usuário escolhe baixar (POST).
Ver src/services/modelos_locais.py.
"""
from fastapi import APIRouter, Depends, HTTPException

from src.api.security import require_local_auth
from src.navegador import diagnosticar as _diagnosticar_navegador
from src.navegador import diagnostico_barato as _diagnostico_barato_navegador
from src.services import modelos_locais

router = APIRouter(tags=["Modelos locais"])


@router.get("/api/modelos")
def listar_modelos():
    return {"modelos": modelos_locais.listar()}


@router.post("/api/modelos/{modelo_id}/baixar", dependencies=[Depends(require_local_auth)])
def baixar_modelo(modelo_id: str):
    if modelo_id not in modelos_locais.CATALOGO:
        raise HTTPException(404, f"Modelo desconhecido: '{modelo_id}'")
    try:
        tarefa = modelos_locais.baixar(modelo_id)
    except modelos_locais.ModeloNaoBaixado as e:
        raise HTTPException(409, str(e))
    return {"id": modelo_id, "download": tarefa}


@router.get("/api/navegador/diagnostico")
def diagnosticar_navegador_barato():
    """Diagnóstico barato (< 100 ms, sem lançar processo) do navegador headless."""
    return _diagnostico_barato_navegador()


@router.post("/api/navegador/testar", dependencies=[Depends(require_local_auth)])
def testar_navegador_completo():
    """Diagnóstico completo do navegador headless (síncrono, sob demanda)."""
    return _diagnosticar_navegador()
