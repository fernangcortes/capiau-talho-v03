"""Streaming do chat do Welcome Hub (OnboardingAgentService.chat_stream e /api/onboarding/chat/stream).

A OpenRouter é simulada: nenhum teste sai para a rede nem grava no banco.
"""
import json

import pytest
import requests
from fastapi.testclient import TestClient

from src.api.server import app
from src.services import onboarding_agent
from src.services.onboarding_agent import OnboardingAgentService

KEY = "sk-or-v1-teste-streaming-000000000000"


class FakeStream:
    """Imita requests.Response em stream: as linhas saem como bytes UTF-8 e são decodificadas com
    `encoding`, que começa em ISO-8859-1 como no requests quando o cabeçalho não traz charset."""

    def __init__(self, status_code=200, lines=None, text="", raise_on_iter=None):
        self.status_code = status_code
        self._lines = lines or []
        self.text = text
        self._raise = raise_on_iter
        self.encoding = "ISO-8859-1"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def iter_lines(self, decode_unicode=True):
        for line in self._lines:
            yield line.encode("utf-8").decode(self.encoding)
        if self._raise:
            raise self._raise


def sse(content, model="deepseek/deepseek-v4.1-flash"):
    return "data: " + json.dumps({"model": model, "choices": [{"delta": {"content": content}}]})


def run(monkeypatch, fake, **kw):
    monkeypatch.setattr(onboarding_agent.requests, "post", lambda *a, **k: fake)
    return list(OnboardingAgentService.chat_stream("Como funciona?", [], custom_api_key=KEY, **kw))


def test_texto_sai_aos_poucos_e_o_bloco_de_acao_nao_aparece(monkeypatch):
    action = '```json:action\n{"step": "discussing", "chips": [{"label": "Ver perfis", "value": "perfis"}]}\n```'
    pieces = ["O Talho ", "organiza o ", "material.\n\n", "``", "`json:ac", action[len("```json:ac"):]]
    fake = FakeStream(lines=[": OPENROUTER PROCESSING"] + [sse(p) for p in pieces] + ["data: [DONE]"])
    events = run(monkeypatch, fake)

    assert events[0]["type"] == "start" and events[0]["model"]
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert len(deltas) >= 3, "o texto deve chegar em vários pedaços"
    streamed = "".join(deltas)
    assert "json:action" not in streamed and "`" not in streamed
    assert streamed.strip() == "O Talho organiza o material."

    done = events[-1]
    assert done["type"] == "done"
    assert done["api_status"] == "ok"
    assert done["reply"] == "O Talho organiza o material."
    assert done["chips"] == [{"label": "Ver perfis", "value": "perfis"}]
    assert done["model"] == "deepseek/deepseek-v4.1-flash"


def test_acentos_chegam_inteiros(monkeypatch):
    fake = FakeStream(lines=[sse("Documentário "), sse("é ação"), "data: [DONE]"])
    events = run(monkeypatch, fake)
    assert events[-1]["reply"] == "Documentário é ação"


def test_chave_recusada_cai_no_assistente_local_com_aviso(monkeypatch):
    events = run(monkeypatch, FakeStream(status_code=401, text="unauthorized"))
    assert [e["type"] for e in events] == ["start", "done"]
    assert events[-1]["api_status"] == "expired_key"
    assert "recusada" in events[-1]["reply"]
    assert events[-1]["model"] is None


def test_modelo_inexistente_avisa_qual_modelo_falhou(monkeypatch):
    events = run(monkeypatch, FakeStream(status_code=400, text="not a valid model ID"))
    done = events[-1]
    assert done["api_status"] == "model_error"
    assert done["requested_model"] in done["reply"]


def test_timeout_antes_da_primeira_palavra(monkeypatch):
    def boom(*a, **k):
        raise requests.Timeout()
    monkeypatch.setattr(onboarding_agent.requests, "post", boom)
    events = list(OnboardingAgentService.chat_stream("oi", [], custom_api_key=KEY))
    assert events[-1]["api_status"] == "timeout"


def test_queda_no_meio_mantem_o_que_ja_chegou(monkeypatch):
    fake = FakeStream(lines=[sse("Primeira parte "), sse("da resposta")], raise_on_iter=requests.ConnectionError("caiu"))
    events = run(monkeypatch, fake)
    assert events[-1]["type"] == "done"
    assert events[-1]["api_status"] == "ok"
    assert events[-1]["reply"] == "Primeira parte da resposta"


def test_rota_http_envia_eventos_sse(monkeypatch):
    fake = FakeStream(lines=[sse("Oi. "), sse("Tudo certo."), "data: [DONE]"])
    monkeypatch.setattr(onboarding_agent.requests, "post", lambda *a, **k: fake)
    client = TestClient(app)
    with client.stream("POST", "/api/onboarding/chat/stream",
                       json={"message": "oi", "history": [], "custom_api_key": KEY}) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        events = [json.loads(line[5:]) for line in resp.iter_lines() if line.startswith("data:")]
    assert [e["type"] for e in events][0] == "start"
    assert events[-1]["reply"] == "Oi. Tudo certo."
