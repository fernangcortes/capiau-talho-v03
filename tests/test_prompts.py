"""Teste de unidade para o prompt registry e endpoints de prompts editáveis."""
import unittest
from fastapi.testclient import TestClient
from src.nlp.prompt_registry import PROMPT_REGISTRY, get_prompt, validate_template, render_prompt
from src.api.server import app

class TestPrompts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_prompt_registry_keys(self):
        self.assertIn("vision", PROMPT_REGISTRY)
        self.assertIn("enrichment_rewrite", PROMPT_REGISTRY)
        self.assertIn("timeline_suggestion", PROMPT_REGISTRY)
        self.assertIn("rag_categorize", PROMPT_REGISTRY)

    def test_safe_prompt_rendering(self):
        # Testa se a substituição de placeholders baseada em regex não quebra os colchetes normais de JSON
        template = '{"name": "{name_placeholder}", "age": {age_placeholder}, "extra": "normal {bracket}"}'
        vars_dict = {
            "name_placeholder": "CapIAu",
            "age_placeholder": 3,
            "another_var": "unused"
        }
        rendered = render_prompt(template, vars_dict)
        self.assertEqual(rendered, '{"name": "CapIAu", "age": 3, "extra": "normal {bracket}"}')

    def test_validate_template(self):
        # vision requer {context_block}
        ok, err = validate_template("vision", "Um prompt qualquer {context_block}")
        self.assertTrue(ok)

        ok, err = validate_template("vision", "Um prompt sem placeholders")
        self.assertFalse(ok)
        self.assertIn("Placeholder obrigatório", err)

    def test_api_endpoints_flow(self):
        # 1. GET lista de prompts
        response = self.client.get("/api/settings/prompts")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "success")
        
        # Encontra o prompt 'vision' e valida campos
        vision_item = next((p for p in data["prompts"] if p["id"] == "vision"), None)
        self.assertIsNotNone(vision_item)
        self.assertEqual(vision_item["origin"], "default")
        self.assertFalse(vision_item["is_modified"])

        # 2. PUT para atualizar com template inválido (deve dar erro 422)
        response = self.client.put("/api/settings/prompts/vision", json={
            "template": "Template inválido sem placeholders obrigatórios",
            "scope": "global"
        })
        self.assertEqual(response.status_code, 422)

        # 3. PUT para atualizar com template válido
        valid_template = PROMPT_REGISTRY["vision"]["default"] + "\n# Modificação de Teste"
        response = self.client.put("/api/settings/prompts/vision", json={
            "template": valid_template,
            "scope": "global"
        })
        self.assertEqual(response.status_code, 200)

        # 4. GET para verificar se alterou para 'global'
        response = self.client.get("/api/settings/prompts")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        vision_item = next((p for p in data["prompts"] if p["id"] == "vision"), None)
        self.assertEqual(vision_item["origin"], "global")
        self.assertTrue(vision_item["is_modified"])

        # 5. DELETE para restaurar
        response = self.client.delete("/api/settings/prompts/vision?scope=global")
        self.assertEqual(response.status_code, 200)

        # 6. GET para garantir que voltou a ser 'default'
        response = self.client.get("/api/settings/prompts")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        vision_item = next((p for p in data["prompts"] if p["id"] == "vision"), None)
        self.assertEqual(vision_item["origin"], "default")
        self.assertFalse(vision_item["is_modified"])

if __name__ == "__main__":
    unittest.main()
