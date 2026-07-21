"""Testes unitários para validar a detecção de indisponibilidade do Qdrant (P0)."""
import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from src.api.server import app
from src.search.semantic import SemanticSearch, QdrantUnavailableError
from src.search.image_semantic import ImageSearch

client = TestClient(app)


class TestP0QdrantUnavailable(unittest.TestCase):
    def test_semantic_search_unavailable_raises_exception(self):
        """Valida que quando is_available é False, o método search lança QdrantUnavailableError."""
        instance = SemanticSearch.get_instance()
        with patch.object(instance, 'is_available', False), \
             patch.object(instance, 'error_message', 'Trava de arquivo no Qdrant'):
            with self.assertRaises(QdrantUnavailableError) as ctx:
                instance.search(1, "teste")
            self.assertIn("Trava de arquivo no Qdrant", str(ctx.exception))

    def test_api_search_returns_index_status_unavailable(self):
        """Valida que a rota /api/search responde com index_status=unavailable e warning sem quebrar."""
        with patch("src.search.semantic.SemanticSearch.search", side_effect=QdrantUnavailableError("Qdrant em uso por outro processo")):
            response = client.get("/api/search?query=teste&project_id=1")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["index_status"], "unavailable")
            self.assertIn("warning", data)
            self.assertIn("Qdrant em uso", data["warning"])
            self.assertEqual(data["results"], [])

    def test_api_search_visual_returns_index_status_unavailable(self):
        """Valida que a rota /api/search/visual responde com index_status=unavailable em falha do Qdrant."""
        with patch("src.search.image_semantic.ImageSearch.search_text", side_effect=QdrantUnavailableError("Qdrant em uso por outro processo")):
            response = client.get("/api/search/visual?q=teste&project_id=1")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["index_status"], "unavailable")
            self.assertIn("warning", data)
            self.assertIn("Qdrant em uso", data["warning"])
            self.assertEqual(data["results"], [])

    def test_api_health_endpoint_degraded(self):
        """Valida que /api/health identifica degradação quando o Qdrant está indisponível."""
        instance = SemanticSearch.get_instance()
        with patch.object(instance, 'check_health', return_value=(False, "Trava no Qdrant")):
            response = client.get("/api/health")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["status"], "degraded")
            self.assertEqual(data["db"], "ok")
            self.assertEqual(data["qdrant"], "unavailable")
            self.assertEqual(data["qdrant_error"], "Trava no Qdrant")
            self.assertIn("port", data)

    def test_similar_batch_happy_path_returns_results(self):
        """Regressão: commit P0.2 removeu 'results = []' de similar_batch, causando NameError
        (HTTP 500) em toda chamada. Este teste falha se a variável sumir de novo."""
        fake_data = {
            "results": [{
                "id": "pt1", "score": 0.87,
                "best_source": {"kind": "photo", "id": 1},
                "matched_text": "trecho de teste",
                "payload": {"photo_id": 999999},
            }],
            "mode_used": "media", "cohesion": 0.8, "warnings": [],
        }
        with patch("src.search.semantic.SemanticSearch.similar_to_multiple_items", return_value=fake_data):
            response = client.post("/api/media/similar-batch", json={
                "project_id": 1,
                "items": [{"kind": "photo", "id": 1}],
                "search_type": "textual",
                "limit": 5,
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["index_status"], "ok")
            self.assertEqual(len(data["results"]), 1)

    def test_similar_batch_returns_index_status_unavailable(self):
        """Valida que similar_batch também reporta index_status=unavailable (não só 200 vazio)."""
        with patch(
            "src.search.semantic.SemanticSearch.similar_to_multiple_items",
            side_effect=QdrantUnavailableError("Qdrant em uso por outro processo"),
        ):
            response = client.post("/api/media/similar-batch", json={
                "project_id": 1,
                "items": [{"kind": "photo", "id": 1}],
                "search_type": "textual",
                "limit": 5,
            })
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["index_status"], "unavailable")
            self.assertEqual(data["results"], [])

    def test_semantic_result_keeps_conceptual_explanation(self):
        """Regressão: commit P0.1 removeu o 'else' que gerava a explicação didática
        'Correspondência conceitual (Semântica)' para hits sem match_source (face/speaker/clip)."""
        fake_hit = {
            "score": 0.42,
            "payload": {"media_type": "doc", "doc_id": 999999, "text": "um trecho qualquer do roteiro"},
        }
        with patch("src.search.semantic.SemanticSearch.search", return_value=[fake_hit]):
            response = client.get("/api/search?query=conceito+abstrato+de+teste&project_id=1")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            matching = [r for r in data["results"] if r["payload"].get("doc_id") == 999999]
            self.assertEqual(len(matching), 1)
            self.assertIn("Semântica", matching[0]["explanation"])

    def test_check_health_recovers_after_reconnect(self):
        """Endurecimento P0-A4: check_health tenta reconectar sozinho (em vez de exigir
        restart manual) quando o Qdrant volta a responder — ex. instância zumbi derrubada."""
        instance = SemanticSearch.get_instance()
        fake_client = MagicMock()
        fake_collections_response = MagicMock()
        fake_collections_response.collections = []
        fake_client.get_collections.return_value = fake_collections_response

        with patch.object(instance, "is_available", False), \
             patch.object(instance, "client", None), \
             patch("src.search.semantic.QdrantClient", return_value=fake_client):
            is_ok, err = instance.check_health()
            self.assertTrue(is_ok)
            self.assertIsNone(err)
            self.assertIs(instance.client, fake_client)


if __name__ == "__main__":
    unittest.main()
