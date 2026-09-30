"""Dublê da Laya para testes: responde o que o teste roteirizou, sem carregar o modelo.

Serve para conferir a ligação do Sistema 1 (limiar, escalação, registro), não a
qualidade da classificação -- essa é medida com scripts/system1_avaliar.py.
"""
from typing import Dict, Tuple

from src.services.system1_service import System1LayaEngine


class RouterFalso:
    """Mesma assinatura de laya.Router.predict. ``regras``: trecho do estado -> (categoria, confiança)."""

    def __init__(self, regras: Dict[str, Tuple[str, float]], padrao: Tuple[str, float] = ("processo", 0.5)):
        self.regras = regras
        self.padrao = padrao
        self.chamadas = []

    def predict(self, state, questions, model=None, **_):
        self.chamadas.append((state, questions, model))
        categoria, confianca = next((v for k, v in self.regras.items() if k in state), self.padrao)
        return {"model": "laya-falsa",
                "answers": {"categoria": {"type": "choice", "choice": categoria, "confidence": confianca,
                                          "probabilities": {categoria: confianca}}}}


def laya_falsa(regras: Dict[str, Tuple[str, float]] = None, padrao: Tuple[str, float] = ("processo", 0.5),
               escalation_threshold: float = 0.88) -> System1LayaEngine:
    return System1LayaEngine(escalation_threshold=escalation_threshold, router=RouterFalso(regras or {}, padrao))
