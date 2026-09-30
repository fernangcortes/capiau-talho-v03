"""Sistema 1 de verdade: cliente do Jev, registro das decisões e (opcional) a Laya real.

O Jev usa HTTP falso; o banco é SQLite em memória com o schema do projeto.
A Laya real só roda com CAPIAU_TESTE_LAYA=1 (carrega ~680 MB e leva ~30 s).
"""
import contextlib
import json
import os
import sqlite3

import pytest

from src.db.schema import SCHEMA_SQL
from src.services.settings_service import ResolvedSettings, SettingsService
from src.services.system1_service import (
    JEV_ENDPOINT_PADRAO, MOTOR_JEV, MOTOR_LAYA, System1Indisponivel, System1JevClient,
    System1LayaEngine, System1Service, perguntas_triagem,
)
from tests.laya_falsa import laya_falsa

CHAVE = "ts_chave_de_teste_123"


class RespostaFalsa:
    def __init__(self, status_code, corpo):
        self.status_code = status_code
        self._corpo = corpo
        self.text = corpo if isinstance(corpo, str) else json.dumps(corpo)

    def json(self):
        if isinstance(self._corpo, str):
            raise ValueError("não é JSON")
        return self._corpo


class HttpFalso:
    def __init__(self, resposta):
        self.resposta = resposta
        self.pedidos = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.pedidos.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if isinstance(self.resposta, Exception):
            raise self.resposta
        return self.resposta


def resposta_jev(categoria="depoimento", confianca=0.97):
    return {"model": "jev-1.13.0",
            "answers": {"categoria": {"type": "choice", "choice": categoria, "confidence": confianca,
                                      "probabilities": {categoria: confianca}}},
            "usage": {"input_tokens": 300, "output_tokens": 30}}


def test_jev_chama_o_endpoint_documentado_com_bearer():
    http = HttpFalso(RespostaFalsa(200, resposta_jev()))
    dec = System1JevClient(api_key=CHAVE, http=http).evaluate_media_triage({"filename": "entrevista.mp4"})
    pedido = http.pedidos[0]
    assert pedido["url"] == JEV_ENDPOINT_PADRAO == "https://api.typesafe.ai/v1/systemone"
    assert pedido["headers"]["Authorization"] == f"Bearer {CHAVE}"
    assert pedido["json"]["model"] == "jev-latest"
    assert pedido["json"]["questions"] == perguntas_triagem()
    assert "entrevista.mp4" in pedido["json"]["state"]
    assert pedido["timeout"]
    assert dec.category == "depoimento" and dec.model == MOTOR_JEV
    assert "jev-1.13.0" in dec.reason


def test_jev_sem_chave_fica_indisponivel(monkeypatch):
    monkeypatch.setattr(SettingsService, "get_settings",
                        lambda project_id=None: ResolvedSettings({"api.typesafe_key": ""}))
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    monkeypatch.setattr("src.services.settings_service.CONFIG.TYPESAFE_API_KEY", "", raising=False)
    with pytest.raises(System1Indisponivel, match="sem chave"):
        System1JevClient(http=HttpFalso(RespostaFalsa(200, resposta_jev()))).evaluate_media_triage({})


def test_jev_erro_http_nao_vaza_a_chave():
    http = HttpFalso(RespostaFalsa(401, f"token invalido: {CHAVE}"))
    with pytest.raises(System1Indisponivel) as e:
        System1JevClient(api_key=CHAVE, http=http).evaluate_media_triage({"filename": "a.mp4"})
    assert "HTTP 401" in str(e.value)
    assert CHAVE not in str(e.value)


def test_jev_sem_rede_fica_indisponivel():
    http = HttpFalso(ConnectionError("sem rede"))
    with pytest.raises(System1Indisponivel, match="sem rede"):
        System1JevClient(api_key=CHAVE, http=http).evaluate_media_triage({"filename": "a.mp4"})


def test_categoria_fora_da_lista_nao_vira_decisao():
    http = HttpFalso(RespostaFalsa(200, resposta_jev(categoria="inventada")))
    with pytest.raises(System1Indisponivel, match="fora da lista"):
        System1JevClient(api_key=CHAVE, http=http).evaluate_media_triage({"filename": "a.mp4"})


@pytest.fixture
def banco_memoria(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)

    @contextlib.contextmanager
    def get_db_falso():
        yield conn

    monkeypatch.setattr("src.db.connection.get_db", get_db_falso)
    return conn


def _config(**extra):
    base = {"triage.system1_enabled": True, "triage.escalation_threshold": 0.88,
            "triage.system1_mode": "sombra", "triage.system1_compare_jev": True}
    base.update(extra)
    return lambda project_id=None: ResolvedSettings(base)


def test_comparacao_registra_laya_e_jev_lado_a_lado(banco_memoria, monkeypatch):
    monkeypatch.setattr(SettingsService, "get_settings", _config())
    jev = System1JevClient(api_key=CHAVE, http=HttpFalso(RespostaFalsa(200, resposta_jev("depoimento", 0.97))))
    svc = System1Service(laya=laya_falsa(padrao=("processo", 0.55)), jev=jev)

    dec = svc.evaluate_triage({"filename": "entrevista.mp4"}, project_id=None, media_id=42)
    assert dec.model == MOTOR_LAYA and dec.category == "processo"

    linhas = {r["motor"]: dict(r) for r in banco_memoria.execute("SELECT * FROM system1_decisao")}
    assert set(linhas) == {MOTOR_LAYA, MOTOR_JEV}
    assert linhas[MOTOR_LAYA]["categoria"] == "processo" and linhas[MOTOR_LAYA]["confianca"] == 0.55
    assert linhas[MOTOR_JEV]["categoria"] == "depoimento"
    assert all(l["modo"] == "sombra" and l["media_id"] == 42 and l["erro"] is None for l in linhas.values())
    assert linhas[MOTOR_LAYA]["estado_json"] == linhas[MOTOR_JEV]["estado_json"]


def test_jev_falhando_fica_registrado_com_o_motivo(banco_memoria, monkeypatch):
    monkeypatch.setattr(SettingsService, "get_settings", _config())
    jev = System1JevClient(api_key=CHAVE, http=HttpFalso(RespostaFalsa(503, "fora")))
    svc = System1Service(laya=laya_falsa(padrao=("obra", 0.9)), jev=jev)

    dec = svc.evaluate_triage({"filename": "take.mp4"}, media_id=7)
    assert dec.category == "obra"
    linha = dict(banco_memoria.execute("SELECT * FROM system1_decisao WHERE motor = ?", (MOTOR_JEV,)).fetchone())
    assert linha["categoria"] is None and "HTTP 503" in linha["erro"]


def test_sem_comparacao_nao_chama_o_jev(banco_memoria, monkeypatch):
    monkeypatch.setattr(SettingsService, "get_settings", _config(**{"triage.system1_compare_jev": False}))
    http = HttpFalso(RespostaFalsa(200, resposta_jev()))
    svc = System1Service(laya=laya_falsa(), jev=System1JevClient(api_key=CHAVE, http=http))
    svc.evaluate_triage({"filename": "x.mp4"}, media_id=1)
    assert http.pedidos == []
    assert banco_memoria.execute("SELECT count(*) FROM system1_decisao").fetchone()[0] == 1


@pytest.mark.skipif(os.getenv("CAPIAU_TESTE_LAYA") != "1", reason="Laya real: rode com CAPIAU_TESTE_LAYA=1")
def test_laya_real_responde_categoria_valida():
    dec = System1LayaEngine().evaluate_media_triage({
        "filename": "entrevista_diretora_01.mp4", "folder": "entrevistas", "duration_s": 600,
        "has_audio": True,
        "speech": "Quando eu comecei a pensar nesse filme, a ideia era falar da minha avó e da cidade onde ela cresceu.",
    })
    assert dec.model == MOTOR_LAYA
    assert dec.category is not None
    assert 0.0 <= dec.confidence <= 1.0
    assert dec.inference_time_ms > 0


def resposta_corte(p_fala=0.8, p_just=0.3):
    return {"model": "jev-1.13.0", "answers": {
        "remove_fala_importante": {"type": "noul", "noul": p_fala},
        "corte_justificado": {"type": "noul", "noul": p_just}}}


def test_auditoria_de_corte_manda_a_fala_do_trecho(banco_memoria, monkeypatch):
    banco_memoria.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
    banco_memoria.execute("INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (9, 1, 'a.mp4', '/a.mp4', 'h')")
    for i, w in enumerate(["minha", "avó", "cantava", "fora"]):
        banco_memoria.execute("INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id) "
                              "VALUES (9, ?, ?, ?, 'A')", (w, 10 + i, 10.5 + i))
    monkeypatch.setattr(SettingsService, "get_settings", _config(**{"agent.jev_audit": True}))
    http = HttpFalso(RespostaFalsa(200, resposta_corte()))
    svc = System1Service(laya=laya_falsa(), jev=System1JevClient(api_key=CHAVE, http=http))

    ops = [{"action": "DELETE", "video_id": 9, "in_s": 10.0, "out_s": 12.9},
           {"action": "INSERT", "video_id": 9, "in_s": 0.0, "out_s": 5.0}]
    r = svc.auditar_cortes_jev(1, ops, "tirar gagueira")
    assert r["p_fala_importante"] == 0.8 and r["p_justificado"] == 0.3
    estado = http.pedidos[0]["json"]["state"]
    assert "minha avó cantava" in estado and "fora" not in estado
    assert "tirar gagueira" in estado
    assert set(http.pedidos[0]["json"]["questions"]) == {"remove_fala_importante", "corte_justificado"}


def test_auditoria_desligada_ou_so_insercao_nao_chama_o_jev(banco_memoria, monkeypatch):
    http = HttpFalso(RespostaFalsa(200, resposta_corte()))
    svc = System1Service(laya=laya_falsa(), jev=System1JevClient(api_key=CHAVE, http=http))
    delete = [{"action": "DELETE", "video_id": 9, "in_s": 0, "out_s": 1}]

    monkeypatch.setattr(SettingsService, "get_settings", _config(**{"agent.jev_audit": False}))
    assert svc.auditar_cortes_jev(1, delete, "x") is None
    monkeypatch.setattr(SettingsService, "get_settings", _config(**{"agent.jev_audit": True}))
    assert svc.auditar_cortes_jev(1, [{"action": "INSERT", "video_id": 9}], "x") is None
    assert http.pedidos == []


def test_segunda_opiniao_entra_no_resumo_e_so_sobe_o_risco(monkeypatch):
    from src.services.chat_agent import ChatAgentService
    monkeypatch.setattr(System1Service, "auditar_cortes_jev",
                        lambda self, *a: {"modelo": "jev-1.13.0", "p_fala_importante": 0.7, "p_justificado": 0.2})
    audit = {"risk_level": "safe", "reason": "Base."}
    ChatAgentService.segunda_opiniao_jev(1, audit, [], "")
    assert audit["risk_level"] == "warning" and "70%" in audit["reason"]

    audit = {"risk_level": "destructive", "reason": "Base."}
    monkeypatch.setattr(System1Service, "auditar_cortes_jev",
                        lambda self, *a: {"modelo": "j", "p_fala_importante": 0.1, "p_justificado": 0.9})
    ChatAgentService.segunda_opiniao_jev(1, audit, [], "")
    assert audit["risk_level"] == "destructive"

    monkeypatch.setattr(System1Service, "auditar_cortes_jev", lambda self, *a: {"erro": "sem chave do TypeSafe"})
    audit = {"risk_level": "warning", "reason": "Base."}
    ChatAgentService.segunda_opiniao_jev(1, audit, [], "")
    assert "indisponível" in audit["reason"] and audit["risk_level"] == "warning"
