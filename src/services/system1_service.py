"""src/services/system1_service.py — Sistema 1: decisões rápidas tipadas (Laya local, Jev em nuvem).

- Laya (``pip install laya``, pesos convaiinnovations/laya, Apache-2.0): roda na
  CPU, checkpoint ``multilingual`` (~680 MB, baixado no primeiro uso para o
  cache do Hugging Face). ~200 ms por decisão depois de carregado.
- Jev (TypeSafe, ``POST https://api.typesafe.ai/v1/systemone``): mesmo formato
  de pergunta da Laya; chave em ``api.typesafe_key`` ou ``TYPESAFE_API_KEY``.

Os dois recebem o MESMO estado e as MESMAS perguntas; cada decisão vai para a
tabela ``system1_decisao`` para comparar entre si, com a triagem por visão e
com a correção humana (``triage_feedback``), e para virar dado de treino.

Regra da casa: nada aqui inventa resultado. Motor que não roda (pacote ausente,
modelo não baixado, sem chave, erro de rede) levanta ``System1Indisponivel``
com o motivo; quem chama escala para a triagem por visão e registra o motivo.
Latência é sempre a medida.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from src.nlp.prompt_registry import TRIAGE_CATEGORIES

MOTOR_LAYA = "laya-multilingual"
MOTOR_JEV = "jev-latest"

JEV_ENDPOINT_PADRAO = "https://api.typesafe.ai/v1/systemone"
JEV_MODELO = "jev-latest"
JEV_TIMEOUT_S = 20.0

# Trecho de fala mandado como contexto: o bastante para decidir, curto para o
# limite de 1.024 tokens do checkpoint multilíngue.
FALA_MAX_CHARS = 1200


class System1Indisponivel(RuntimeError):
    """O motor pedido não pode responder agora. A mensagem diz por quê."""


class TriageDecision(BaseModel):
    """Decisão de triagem emitida pelo Sistema 1."""
    category: Optional[str] = Field(None, description="Categoria Eixo A; None quando o motor não respondeu")
    confidence: float = Field(0.0, ge=0.0, le=1.0, description="Confiança calibrada informada pelo motor")
    escalate_to_system2: bool = Field(..., description="Se True, a triagem por visão decide")
    inference_time_ms: Optional[float] = Field(None, description="Latência medida; None quando não rodou")
    model: str = Field(..., description="Motor que decidiu (ou tentou)")
    reason: str = Field(default="", description="Motivo da escalação ou da decisão")
    probabilities: Dict[str, float] = Field(default_factory=dict)


class SafetyAuditDecision(BaseModel):
    """Decisão do porteiro de segurança antes de mutações na timeline."""
    allow_execution: bool = Field(..., description="Se a operação pode prosseguir sem bloqueio")
    requires_confirmation: bool = Field(..., description="Se deve exibir ghost preview no NLE")
    risk_level: str = Field(..., description="'safe', 'warning', 'destructive'")
    reason: str = Field(..., description="Justificativa da auditoria")
    audit_time_ms: float = Field(default=0.0, description="Latência medida da auditoria em ms")
    model: str = Field(default="regras_locais", description="Quem auditou")


class RAGRoutingDecision(BaseModel):
    """Roteamento de intenção de busca para coleções vetoriais."""
    target_collection: str = Field(..., description="capiau_making_of ou capiau_images")
    intent: str = Field(..., description="'textual', 'visual_clip' ou 'hybrid'")
    confidence: float = Field(..., ge=0.0, le=1.0)
    routing_time_ms: float = Field(default=0.0, description="Latência medida em ms")


# -- Estado e perguntas da triagem ------------------------------------------------

def perguntas_triagem() -> Dict[str, Any]:
    """Pergunta única de escolha com as categorias do Eixo A (as mesmas da visão)."""
    return {
        "categoria": {
            "type": "choice",
            "instructions": ("Que tipo de material é este arquivo, dentro do acervo de uma produção "
                             "audiovisual (filme, making of, documentário)?"),
            "criteria": dict(TRIAGE_CATEGORIES),
        }
    }


def estado_triagem(media_state: Dict[str, Any]) -> str:
    """Texto de estado mandado igual aos dois motores.

    Só o que a ingestão sabe sem olhar frames: nome, pasta, duração, se tem
    áudio e o começo da fala (quando já existe transcrição).
    """
    linhas = []
    nome = media_state.get("filename") or ""
    pasta = media_state.get("folder") or ""
    if nome:
        linhas.append(f"arquivo: {nome}")
    if pasta:
        linhas.append(f"pasta: {pasta}")
    duracao = media_state.get("duration_s")
    if duracao:
        linhas.append(f"duração: {float(duracao):.0f} s")
    if "has_audio" in media_state:
        linhas.append(f"tem áudio: {'sim' if media_state.get('has_audio') else 'não'}")
    fala = (media_state.get("speech") or "").strip()
    linhas.append(f"fala: {fala[:FALA_MAX_CHARS]}" if fala else "fala: (sem transcrição)")
    return "\n".join(linhas)


PERGUNTAS_CORTE: Dict[str, Any] = {
    "remove_fala_importante": {
        "type": "noul",
        "instructions": "Algum dos trechos removidos contém fala com informação ou emoção importante para o filme?",
    },
    "corte_justificado": {
        "type": "noul",
        "instructions": "A justificativa do assistente de edição explica bem por que estes trechos devem sair?",
    },
}

TRECHO_MAX_CHARS = 400
TRECHOS_MAX = 10


def estado_corte(trechos: list, justificativa: str) -> str:
    """Texto de estado da auditoria: justificativa + fala de cada trecho que sai."""
    linhas = [f"justificativa: {(justificativa or '(nenhuma)').strip()[:600]}", "trechos que saem:"]
    for t in trechos[:TRECHOS_MAX]:
        fala = (t.get("fala") or "").strip()[:TRECHO_MAX_CHARS] or "(sem fala transcrita)"
        linhas.append(f"- {t.get('acao', 'DELETE')} vídeo {t.get('video_id')}, "
                      f"{float(t.get('in_s') or 0):.1f}-{float(t.get('out_s') or 0):.1f} s: {fala}")
    return "\n".join(linhas)


def _decisao_de_resposta(resposta: Dict[str, Any], motor: str, latencia_ms: float,
                         limiar: float) -> TriageDecision:
    ans = (resposta.get("answers") or {}).get("categoria") or {}
    categoria = ans.get("choice")
    if categoria not in TRIAGE_CATEGORIES:
        raise System1Indisponivel(f"{motor} devolveu categoria fora da lista: {categoria!r}")
    confianca = float(ans.get("confidence") or 0.0)
    return TriageDecision(
        category=categoria,
        confidence=confianca,
        escalate_to_system2=confianca < limiar,
        inference_time_ms=round(latencia_ms, 1),
        model=motor,
        reason=f"{motor}: '{categoria}' com confiança {confianca:.2f} (limiar {limiar:.2f})",
        probabilities={k: float(v) for k, v in (ans.get("probabilities") or {}).items()},
    )


# -- Laya (local) ---------------------------------------------------------------------

class System1LayaEngine:
    """Laya local na CPU. O Router é carregado uma vez por processo, sob trava."""

    CHECKPOINT = "multilingual"
    DEFAULT_THRESHOLD: float = 0.88

    _router_compartilhado: Any = None
    _trava = threading.Lock()

    def __init__(self, escalation_threshold: float = DEFAULT_THRESHOLD, router: Any = None):
        self.escalation_threshold = escalation_threshold
        self._router = router  # injetável nos testes

    def _obter_router(self) -> Any:
        if self._router is not None:
            return self._router
        cls = System1LayaEngine
        with cls._trava:
            if cls._router_compartilhado is None:
                try:
                    from laya import Router
                except ImportError as e:
                    raise System1Indisponivel("pacote 'laya' não instalado (uv pip install laya)") from e
                try:
                    cls._router_compartilhado = Router(device="cpu", max_loaded=1)
                except Exception as e:
                    raise System1Indisponivel(f"falha ao carregar a Laya: {e}") from e
            return cls._router_compartilhado

    def system_one(self, state: Any, questions: Dict[str, Any]) -> Dict[str, Any]:
        router = self._obter_router()
        try:
            return router.predict(state, questions, model=self.CHECKPOINT)
        except Exception as e:
            raise System1Indisponivel(f"erro na inferência da Laya: {e}") from e

    def evaluate_media_triage(self, media_state: Dict[str, Any]) -> TriageDecision:
        self._obter_router()  # carga (dezenas de segundos na 1a vez) fica fora da latência medida
        t0 = time.perf_counter()
        resposta = self.system_one(estado_triagem(media_state), perguntas_triagem())
        return _decisao_de_resposta(resposta, MOTOR_LAYA, (time.perf_counter() - t0) * 1000.0,
                                    self.escalation_threshold)

    def classify_triage(self, media_state: Dict[str, Any]) -> TriageDecision:
        return self.evaluate_media_triage(media_state)


# -- Jev (nuvem) ----------------------------------------------------------------------

class System1JevClient:
    """Cliente do Jev (TypeSafe). A chave nunca vai para log nem para mensagem de erro."""

    def __init__(self, api_key: Optional[str] = None, endpoint: Optional[str] = None,
                 escalation_threshold: float = System1LayaEngine.DEFAULT_THRESHOLD, http: Any = None):
        self._api_key = api_key
        self.endpoint = endpoint or os.getenv("TYPESAFE_ENDPOINT") or JEV_ENDPOINT_PADRAO
        self.escalation_threshold = escalation_threshold
        self._http = http  # injetável nos testes (precisa de .post)

    def _chave(self, project_id: Optional[int] = None) -> str:
        if self._api_key:
            return self._api_key
        try:
            from src.services.settings_service import SettingsService
            chave = SettingsService.get_settings(project_id).api_key("typesafe")
        except Exception:
            chave = os.getenv("TYPESAFE_API_KEY", "")
        if not chave:
            raise System1Indisponivel("sem chave do TypeSafe (Configurações > api.typesafe_key ou TYPESAFE_API_KEY)")
        return chave

    def system_one(self, state: Any, questions: Dict[str, Any], project_id: Optional[int] = None) -> Dict[str, Any]:
        chave = self._chave(project_id)
        http = self._http
        if http is None:
            import requests as http
        corpo = {"state": state, "model": JEV_MODELO, "questions": questions}
        try:
            r = http.post(self.endpoint, json=corpo, timeout=JEV_TIMEOUT_S,
                          headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"})
        except Exception as e:
            raise System1Indisponivel(f"Jev fora do ar ou sem rede: {type(e).__name__}") from e
        if r.status_code != 200:
            detalhe = (getattr(r, "text", "") or "")[:200].replace(chave, "***")
            raise System1Indisponivel(f"Jev respondeu HTTP {r.status_code}: {detalhe}")
        try:
            return r.json()
        except Exception as e:
            raise System1Indisponivel("Jev devolveu resposta que não é JSON") from e

    def evaluate_media_triage(self, media_state: Dict[str, Any], project_id: Optional[int] = None) -> TriageDecision:
        t0 = time.perf_counter()
        resposta = self.system_one(estado_triagem(media_state), perguntas_triagem(), project_id)
        decisao = _decisao_de_resposta(resposta, MOTOR_JEV, (time.perf_counter() - t0) * 1000.0,
                                       self.escalation_threshold)
        if resposta.get("model"):
            decisao.reason += f" [{resposta['model']}]"
        return decisao

    def auditar_cortes(self, trechos: list, justificativa: str, project_id: Optional[int] = None) -> Dict[str, Any]:
        """Segunda opinião sobre trechos que sairão da timeline (probabilidades do Jev)."""
        t0 = time.perf_counter()
        resposta = self.system_one(estado_corte(trechos, justificativa), PERGUNTAS_CORTE, project_id)
        answers = resposta.get("answers") or {}
        try:
            p_fala = float(answers["remove_fala_importante"]["noul"])
            p_just = float(answers["corte_justificado"]["noul"])
        except (KeyError, TypeError, ValueError) as e:
            raise System1Indisponivel("Jev devolveu resposta sem as probabilidades pedidas") from e
        return {"modelo": resposta.get("model") or MOTOR_JEV, "p_fala_importante": p_fala,
                "p_justificado": p_just, "latencia_ms": round((time.perf_counter() - t0) * 1000.0, 1)}

    def audit_timeline_mutation(self, mutation_request: Dict[str, Any]) -> SafetyAuditDecision:
        """Regras locais de risco da proposta de edição (contagem de exclusões/substituições).

        É o piso determinístico que vale com ou sem chave; a opinião do Jev
        vem à parte, em ``System1Service.auditar_cortes_jev``.
        """
        t0 = time.perf_counter()
        operations = mutation_request.get("operations", [])
        rationale = str(mutation_request.get("rationale", "")).strip()

        def pronto(**kw) -> SafetyAuditDecision:
            return SafetyAuditDecision(audit_time_ms=round((time.perf_counter() - t0) * 1000.0, 3), **kw)

        if not operations:
            return pronto(allow_execution=True, requires_confirmation=False, risk_level="safe",
                          reason="Nenhuma operação solicitada.")

        acoes = [str(op.get("action", "")).upper() for op in operations]
        delete_count, replace_count, insert_count = acoes.count("DELETE"), acoes.count("REPLACE"), acoes.count("INSERT")

        if delete_count >= 3 or (delete_count > 0 and len(rationale) < 10):
            return pronto(allow_execution=False, requires_confirmation=True, risk_level="destructive",
                          reason=f"Operação contém {delete_count} exclusões potencialmente destrutivas na timeline sem justificativa suficiente.")
        if replace_count > 0 or insert_count >= 4 or delete_count > 0:
            return pronto(allow_execution=True, requires_confirmation=True, risk_level="warning",
                          reason=f"Proposta com {replace_count} substituições e {insert_count} inserções requer visualização na ghost track antes do corte real.")
        return pronto(allow_execution=True, requires_confirmation=False, risk_level="safe",
                      reason="Edição pontual com baixo risco estrutural para a timeline.")


# -- Registro das decisões ----------------------------------------------------------

def registrar_decisao(conn, *, project_id: Optional[int], media_kind: str, media_id: int, motor: str,
                      modo: str, estado: str, perguntas: Dict[str, Any],
                      decisao: Optional[TriageDecision] = None, erro: Optional[str] = None,
                      modelo_resposta: Optional[str] = None) -> None:
    conn.execute(
        "INSERT INTO system1_decisao (project_id, media_kind, media_id, tarefa, motor, modo, modelo_resposta, "
        "estado_json, perguntas_json, resposta_json, categoria, confianca, latencia_ms, erro) "
        "VALUES (?, ?, ?, 'triagem', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, media_kind, media_id, motor, modo, modelo_resposta,
         json.dumps(estado, ensure_ascii=False), json.dumps(perguntas, ensure_ascii=False),
         json.dumps(decisao.probabilities, ensure_ascii=False) if decisao else None,
         decisao.category if decisao else None,
         decisao.confidence if decisao else None,
         decisao.inference_time_ms if decisao else None,
         erro),
    )


# -- Orquestrador -------------------------------------------------------------------

class System1Service:
    """Lê as Configurações, roda a Laya (e o Jev, se a comparação estiver ligada) e registra."""

    def __init__(self, escalation_threshold: float = 0.88, laya: Optional[System1LayaEngine] = None,
                 jev: Optional[System1JevClient] = None):
        self.escalation_threshold = escalation_threshold
        self.laya = laya or System1LayaEngine(escalation_threshold=escalation_threshold)
        self.jev = jev or System1JevClient(escalation_threshold=escalation_threshold)

    def evaluate_triage(self, media_state: Dict[str, Any], project_id: Optional[int] = None,
                        media_kind: str = "video", media_id: Optional[int] = None,
                        modo: Optional[str] = None, comparar_jev: Optional[bool] = None,
                        registrar: bool = True) -> Optional[TriageDecision]:
        """Decisão da Laya para a mídia. None quando o Sistema 1 está desligado.

        ``modo``/``comparar_jev`` explícitos valem sobre as Configurações (script de avaliação).
        Com ``media_id`` e ``registrar``, cada motor que rodou (ou falhou) vira uma linha.
        """
        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        if not S.get("triage.system1_enabled"):
            return None
        limiar = float(S.get("triage.escalation_threshold"))
        modo = modo or S.get("triage.system1_mode")
        if comparar_jev is None:
            comparar_jev = bool(S.get("triage.system1_compare_jev"))

        self.laya.escalation_threshold = limiar
        self.jev.escalation_threshold = limiar
        estado, perguntas = estado_triagem(media_state), perguntas_triagem()

        try:
            decisao = self.laya.evaluate_media_triage(media_state)
            erro_laya = None
        except System1Indisponivel as e:
            erro_laya = str(e)
            decisao = TriageDecision(escalate_to_system2=True, model=MOTOR_LAYA,
                                     reason=f"Laya indisponível: {e}")
            print(f"[SYSTEM1] AVISO: Laya indisponível ({e}); a triagem por visão decide.")

        jev_decisao, erro_jev = None, None
        if comparar_jev:
            try:
                jev_decisao = self.jev.evaluate_media_triage(media_state, project_id)
            except System1Indisponivel as e:
                erro_jev = str(e)
                print(f"[SYSTEM1] AVISO: comparação com o Jev pulada ({e}).")

        if registrar and media_id is not None:
            from src.db.connection import get_db
            with get_db() as conn:
                registrar_decisao(conn, project_id=project_id, media_kind=media_kind, media_id=media_id,
                                  motor=MOTOR_LAYA, modo=modo, estado=estado, perguntas=perguntas,
                                  decisao=None if erro_laya else decisao, erro=erro_laya)
                if comparar_jev:
                    registrar_decisao(conn, project_id=project_id, media_kind=media_kind, media_id=media_id,
                                      motor=MOTOR_JEV, modo=modo, estado=estado, perguntas=perguntas,
                                      decisao=jev_decisao, erro=erro_jev)
                conn.commit()
        return decisao

    def audit_timeline_mutation(self, mutation_request: Dict[str, Any], project_id: Optional[int] = None) -> SafetyAuditDecision:
        return self.jev.audit_timeline_mutation(mutation_request)

    def auditar_cortes_jev(self, project_id: Optional[int], operations: list,
                           justificativa: str) -> Optional[Dict[str, Any]]:
        """Segunda opinião do Jev para propostas que tiram material (DELETE/REPLACE).

        None quando ``agent.jev_audit`` está desligado ou nada sai da timeline.
        Com o Jev indisponível devolve {"erro": motivo} -- quem chama avisa.
        """
        from src.services.settings_service import SettingsService
        if not SettingsService.get_settings(project_id).get("agent.jev_audit"):
            return None
        saem = [op for op in operations
                if str(op.get("action", "")).upper() in ("DELETE", "REPLACE") and op.get("video_id")]
        if not saem:
            return None

        from src.db.connection import get_db
        trechos = []
        with get_db() as conn:
            for op in saem[:TRECHOS_MAX]:
                in_s, out_s = float(op.get("in_s") or 0.0), float(op.get("out_s") or 0.0)
                palavras = conn.execute(
                    "SELECT word FROM transcript WHERE video_id = ? AND end_time > ? AND start_time < ? "
                    "ORDER BY start_time", (op["video_id"], in_s, out_s)).fetchall()
                trechos.append({"acao": str(op.get("action")).upper(), "video_id": op["video_id"],
                                "in_s": in_s, "out_s": out_s, "fala": " ".join(p[0] for p in palavras)})
        try:
            return self.jev.auditar_cortes(trechos, justificativa, project_id)
        except System1Indisponivel as e:
            print(f"[SYSTEM1] AVISO: segunda opinião do Jev indisponível ({e}).")
            return {"erro": str(e)}

    def route_rag_query(self, query: str) -> RAGRoutingDecision:
        """Roteia a busca por palavras-chave (regra local, não é modelo)."""
        t0 = time.perf_counter()
        q = query.lower().strip()
        visual_keywords = [
            "foto", "imagem", "enquadramento", "plano geral", "close", "luz", "cor",
            "enquadrado", "câmera", "tripé", "figurino", "adereço", "prop", "composição"
        ]
        textual_keywords = [
            "falou", "disse", "entrevista", "depoimento", "conversa", "tema", "opinião",
            "explicou", "comentou", "áudio", "transcrição", "frase", "citação"
        ]
        visual_score = sum(1 for k in visual_keywords if k in q)
        textual_score = sum(1 for k in textual_keywords if k in q)

        if visual_score > textual_score and visual_score >= 1:
            target, intent, conf = "capiau_images", "visual_clip", min(0.98, 0.75 + 0.1 * visual_score)
        elif textual_score > visual_score and textual_score >= 1:
            target, intent, conf = "capiau_making_of", "textual", min(0.98, 0.75 + 0.1 * textual_score)
        else:
            target, intent, conf = "capiau_making_of", "hybrid", 0.85

        return RAGRoutingDecision(target_collection=target, intent=intent, confidence=conf,
                                  routing_time_ms=round((time.perf_counter() - t0) * 1000.0, 3))
