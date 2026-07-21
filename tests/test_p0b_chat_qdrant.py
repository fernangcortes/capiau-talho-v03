"""Testes para o fim da degradacao silenciosa do chat quando o Qdrant esta indisponivel.

Antes desta correcao, RAGService.chat e ChatAgentService.chat_with_agent chamavam
search_hybrid() sem return_meta=True (ou engoliam a excecao num try/except Exception:
pass sem warning): o usuario conversava com um chat sem contexto do acervo e nunca
sabia. NUNCA subir uma 2a instancia real do Qdrant neste arquivo (lock de processo
unico) -- o client e sempre mockado, como em test_p0_qdrant_unavailable.py.
"""
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from src.api.server import app
from src.services.rag import RAGService
from src.services.chat_agent import ChatAgentService
from src.services.settings_service import ResolvedSettings
from src.search.semantic import QdrantUnavailableError

client = TestClient(app)


def _fake_openrouter_response(text="Resposta de teste do assistente."):
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = {
        "choices": [{"message": {"role": "assistant", "content": text}}]
    }
    return resp


class TestChatQdrantWarning(unittest.TestCase):
    def test_rag_chat_reports_index_unavailable(self):
        """RAGService.chat deve propagar index_status/warning quando o Qdrant esta fora,
        em vez de responder normalmente sem avisar (a degradacao silenciosa original)."""
        with patch.object(ResolvedSettings, "api_key", return_value="test-key-123"), \
             patch("src.search.semantic.SemanticSearch.search",
                   side_effect=QdrantUnavailableError("Qdrant em uso por outro processo")), \
             patch("src.search.image_semantic.ImageSearch.search_text", return_value=[]), \
             patch("src.services.rag.requests.post", return_value=_fake_openrouter_response()):
            res = RAGService.chat(project_id=1, message="o que aparece na entrevista?", history=[])
            self.assertEqual(res["index_status"], "unavailable")
            self.assertIn("Qdrant em uso", res["warning"])
            # a resposta do LLM continua chegando -- o ponto e o usuario SABER
            # que ela pode estar sem contexto do acervo, nao ficar sem resposta
            self.assertEqual(res["response"], "Resposta de teste do assistente.")

    def test_rag_chat_happy_path_no_warning(self):
        """Caminho feliz: indice disponivel, sem warning no retorno."""
        with patch.object(ResolvedSettings, "api_key", return_value="test-key-123"), \
             patch("src.search.semantic.SemanticSearch.search", return_value=[]), \
             patch("src.search.image_semantic.ImageSearch.search_text", return_value=[]), \
             patch("src.services.rag.requests.post", return_value=_fake_openrouter_response()):
            res = RAGService.chat(project_id=1, message="ola", history=[])
            self.assertEqual(res["index_status"], "ok")
            self.assertIsNone(res["warning"])

    def test_chat_endpoint_carries_index_status(self):
        """A rota HTTP /api/project/{id}/chat (caminho RAG legado, sem timeline) tambem
        deve expor index_status/warning -- e o campo que o chat.js le para o banner."""
        with patch.object(ResolvedSettings, "api_key", return_value="test-key-123"), \
             patch("src.search.semantic.SemanticSearch.search",
                   side_effect=QdrantUnavailableError("Qdrant em uso por outro processo")), \
             patch("src.search.image_semantic.ImageSearch.search_text", return_value=[]), \
             patch("src.services.rag.requests.post", return_value=_fake_openrouter_response()):
            response = client.post("/api/project/1/chat", json={"message": "teste", "history": []})
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["index_status"], "unavailable")
            self.assertIn("Qdrant em uso", data["warning"])

    def test_chat_agent_reports_index_unavailable(self):
        """ChatAgentService.chat_with_agent tambem deve propagar o aviso: antes desta
        correcao o try/except Exception: pass ao redor da busca RAG inicial engolia
        QdrantUnavailableError sem nenhum warning chegar ao frontend."""
        with patch.object(ResolvedSettings, "api_key", return_value="test-key-123"), \
             patch("src.search.semantic.SemanticSearch.search",
                   side_effect=QdrantUnavailableError("Qdrant em uso por outro processo")), \
             patch("src.search.image_semantic.ImageSearch.search_text", return_value=[]), \
             patch("src.services.chat_agent.requests.post", return_value=_fake_openrouter_response()):
            res = ChatAgentService.chat_with_agent(
                project_id=1, message="o que temos de b-roll?", history=[],
                clips=[], tracks=[],
            )
            self.assertEqual(res["index_status"], "unavailable")
            self.assertIn("Qdrant em uso", res["warning"])

    def test_chat_agent_happy_path_no_warning(self):
        """Caminho feliz do agente de edicao: indice disponivel, sem warning."""
        with patch.object(ResolvedSettings, "api_key", return_value="test-key-123"), \
             patch("src.search.semantic.SemanticSearch.search", return_value=[]), \
             patch("src.search.image_semantic.ImageSearch.search_text", return_value=[]), \
             patch("src.services.chat_agent.requests.post", return_value=_fake_openrouter_response()):
            res = ChatAgentService.chat_with_agent(
                project_id=1, message="ola", history=[],
                clips=[], tracks=[],
            )
            self.assertEqual(res["index_status"], "ok")
            self.assertIsNone(res["warning"])


if __name__ == "__main__":
    unittest.main()
