"""Testes unitários e de integração para o OnboardingAgentService e rotas de Onboarding.

Verifica:
1. Usuário faz perguntas ou pede explicações ("me explique melhor isso aqui") -> NUNCA define como título.
2. Usuário cola chave de API (OpenRouter ou Gemini) diretamente no chat -> Detecta, salva e confirma.
3. Reconhecimento de nomes de projeto legítimos e perfis de IA.
4. Intenção de pular ingestão e transição direta para NLE.
5. Endpoints HTTP /api/onboarding/chat e /api/onboarding/api-key via FastAPI TestClient.
"""
import pytest
from fastapi.testclient import TestClient

from src.services.onboarding_agent import OnboardingAgentService
from src.api.server import app


@pytest.fixture(autouse=True)
def mock_external_requests(monkeypatch):
    """Evita chamadas de rede externas para OpenRouter durante a execução dos testes."""
    class MockResp:
        status_code = 401
        def json(self):
            return {}
    monkeypatch.setattr("requests.post", lambda *a, **kw: MockResp())


def test_question_not_set_as_project_name():
    """Garante que 'me explique melhor isso aqui' jamais seja adotado como nome do projeto."""
    queries = [
        "me explique melhor isso aqui",
        "como funciona o programa?",
        "o que é isso aqui?",
        "ajuda",
        "qual a diferença entre os perfis?",
    ]
    for q in queries:
        res = OnboardingAgentService.chat(q)
        assert res["suggested_project_name"] is None, f"Query '{q}' não pode virar nome de projeto!"
        assert res["step"] == "discussing"
        assert "CapIAu-Talho" in res["reply"] or "Talho" in res["reply"]
        assert len(res["reply"]) > 50


def test_api_key_pasted_in_chat():
    """Garante que colar chave OpenRouter ou Gemini é reconhecido e não tratado como título."""
    or_key = "sk-or-v1-abcdef0123456789abcdef0123456789abcdef"
    res_or = OnboardingAgentService.chat(or_key)
    assert res_or["api_status"] == "ok"
    assert "Openrouter" in res_or["reply"] or "OpenRouter" in res_or["reply"]
    assert res_or["suggested_project_name"] is None

    gemini_key = "AIzaSyD_TestKey123456789012345678901234567"
    res_gem = OnboardingAgentService.chat(gemini_key)
    assert res_gem["api_status"] == "ok"
    assert "Gemini" in res_gem["reply"]
    assert res_gem["suggested_project_name"] is None


def test_project_name_and_profile_progression():
    """Valida progressão: nome do projeto -> escolha de perfil -> pular mídia."""
    # 1. Definir nome
    res_name = OnboardingAgentService.chat("Memórias do Quilombo")
    assert res_name["suggested_project_name"] == "Memórias do Quilombo"
    assert res_name["step"] == "name_set"

    # 2. Perfil inválido quando nome já foi definido
    res_invalid_prof = OnboardingAgentService.chat(
        "perfil_inexistente_xyz",
        current_project_name="Memórias do Quilombo"
    )
    assert res_invalid_prof["suggested_project_name"] == "Memórias do Quilombo"
    assert res_invalid_prof["detected_profile"] is None
    assert res_invalid_prof["step"] == "awaiting_profile"

    # 3. Definir perfil
    res_prof = OnboardingAgentService.chat(
        "doc_offline_eco",
        current_project_name="Memórias do Quilombo"
    )
    assert res_prof["detected_profile"] == "doc_offline_eco"
    assert res_prof["step"] == "profile_set"

    # 4. Pular mídia para criação
    res_skip = OnboardingAgentService.chat(
        "pular ingestão por enquanto",
        current_project_name="Memórias do Quilombo",
        current_profile="doc_offline_eco"
    )
    assert res_skip["ready_to_create"] is True
    assert res_skip["step"] == "ready"


def test_onboarding_http_endpoints():
    """Testa endpoints /api/onboarding/chat e /api/onboarding/api-key com TestClient."""
    client = TestClient(app)

    # 1. Endpoint Chat com dúvida do usuário
    resp_chat = client.post("/api/onboarding/chat", json={
        "message": "me explique melhor isso aqui",
        "history": []
    })
    assert resp_chat.status_code == 200
    data = resp_chat.json()
    assert data["step"] == "discussing"
    assert data["suggested_project_name"] is None
    assert "CapIAu-Talho" in data["reply"]

    # 2. Endpoint Chat salvando chave de API
    resp_key = client.post("/api/onboarding/api-key", json={
        "provider": "openrouter",
        "api_key": "sk-or-v1-test-http-key-0123456789"
    })
    assert resp_key.status_code == 200
    data_key = resp_key.json()
    assert data_key["ok"] is True
    assert data_key["provider"] == "openrouter"
