"""Modelos locais opcionais: estado e download a pedido do usuário.

Nada aqui roda sozinho: a interface lista (GET) e o usuário escolhe baixar (POST).
Ver src/services/modelos_locais.py.
"""
from fastapi import APIRouter, HTTPException

from src.services import modelos_locais

router = APIRouter(tags=["Modelos locais"])


@router.get("/api/modelos")
def listar_modelos():
    return {"modelos": modelos_locais.listar()}


@router.post("/api/modelos/{modelo_id}/baixar")
def baixar_modelo(modelo_id: str):
    if modelo_id not in modelos_locais.CATALOGO:
        raise HTTPException(404, f"Modelo desconhecido: '{modelo_id}'")
    try:
        tarefa = modelos_locais.baixar(modelo_id)
    except modelos_locais.ModeloNaoBaixado as e:
        raise HTTPException(409, str(e))
    return {"id": modelo_id, "download": tarefa}
