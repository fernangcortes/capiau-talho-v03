"""
Teste unitário para tratamento de respostas nulas/sem conteúdo do OpenRouter (DeepSeek v4 / R1).
Garante que 'NoneType' object has no attribute 'strip' não aconteça quando 'content' é None.
"""
import unittest
from unittest.mock import patch, MagicMock

from src.nlp.enrichment_engine import rewrite_description_llm


class TestEnrichmentNullResponse(unittest.TestCase):
    @patch("src.nlp.enrichment_engine.requests.post")
    @patch("src.services.settings_service.SettingsService.get_settings")
    def test_rewrite_description_llm_handles_none_content(self, mock_get_settings, mock_post):
        mock_settings = MagicMock()
        mock_settings.api_key.return_value = "fake_openrouter_key"
        mock_settings.get.side_effect = lambda key: {
            "llm.text_model": "deepseek/deepseek-v4-flash",
            "llm.text_model_fallback": "meta-llama/llama-3.3-70b-instruct",
            "enrichment.max_retries": 1,
            "enrichment.temperature": 0.3,
            "enrichment.max_tokens": 500,
            "enrichment.timeout": 10,
        }.get(key)
        mock_get_settings.return_value = mock_settings

        # Simula resposta do OpenRouter/DeepSeek onde 'content' é None/null no JSON
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": "gen-12345",
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": None
                    }
                }
            ]
        }
        mock_post.return_value = mock_response

        # Deve tratar silenciosamente o content=None e retornar None em vez de estourar AttributeError
        result = rewrite_description_llm(
            original="Foto de João no estúdio",
            entities=[{"id": 1, "name": "João", "entity_type": "person"}],
            replacements={"João": "João da Silva"},
            project_id=1
        )
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
