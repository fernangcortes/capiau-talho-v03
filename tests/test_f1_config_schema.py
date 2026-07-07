"""Teste de unidade para as configurações, esquemas e rotas do Componente 1 da Fase 1."""
import unittest
from fastapi.testclient import TestClient
from src.config import CONFIG
from src.api.schemas import ChatPayload
from src.api.server import app

class TestF1Component1(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_config_agent_models(self):
        # Verificar se AGENT_MODEL e AGENT_MODELS estão definidos
        self.assertIsNotNone(CONFIG.AGENT_MODEL)
        self.assertIsInstance(CONFIG.AGENT_MODELS, list)
        self.assertIn("deepseek/deepseek-v4-flash", CONFIG.AGENT_MODELS)
        self.assertIn("google/gemini-3.5-flash", CONFIG.AGENT_MODELS)
        self.assertIn("anthropic/claude-5-sonnet", CONFIG.AGENT_MODELS)

    def test_chat_payload_schema_expansion(self):
        # Validar que o payload do chat aceita as novas chaves
        payload_data = {
            "message": "Olá agente!",
            "history": [{"role": "user", "content": "Oi"}],
            "clips": [
                {"id": "cut_1", "video_id": 1, "in_s": 0.0, "out_s": 5.0, "timeline_start_s": 0.0, "track": "V1"}
            ],
            "tracks": [
                {"id": "V1", "name": "Video 1", "kind": "video", "order": 0, "volume": 1.0, "muted": False, "locked": False, "magnetic": True}
            ],
            "fps": 30.0,
            "agent_model": "deepseek/deepseek-v4-flash",
            "custom_api_key": "sk-or-custom-key-123"
        }
        payload = ChatPayload(**payload_data)
        self.assertEqual(payload.message, "Olá agente!")
        self.assertEqual(payload.agent_model, "deepseek/deepseek-v4-flash")
        self.assertEqual(payload.custom_api_key, "sk-or-custom-key-123")
        self.assertEqual(len(payload.clips), 1)
        self.assertEqual(payload.fps, 30.0)

    def test_api_get_agent_models(self):
        # Validar o novo endpoint exposto
        response = self.client.get("/api/agent/models")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("models", data)
        self.assertIn("default", data)
        self.assertEqual(data["default"], CONFIG.AGENT_MODEL)
        self.assertListEqual(data["models"], CONFIG.AGENT_MODELS)

if __name__ == "__main__":
    unittest.main()
