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


if __name__ == "__main__":
    unittest.main()
