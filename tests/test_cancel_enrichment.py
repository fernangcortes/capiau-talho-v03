import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from src.core.tasks import TASK_MANAGER
from src.nlp.enrichment_engine import enrich_photo, enrich_project
from src.api.server import app


class TestCancelEnrichment(unittest.TestCase):
    def setUp(self):
        TASK_MANAGER.cancelled_tasks.clear()
        TASK_MANAGER.progress.clear()
        self.client = TestClient(app)

    def test_cancel_task_flag(self):
        task_key = "enrich-project-99"
        TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="enrich")
        self.assertFalse(TASK_MANAGER.is_cancelled(task_key))

        TASK_MANAGER.cancel_task(task_key)
        self.assertTrue(TASK_MANAGER.is_cancelled(task_key))
        self.assertEqual(TASK_MANAGER.progress[task_key]["status"], "cancelled")

    @patch("src.nlp.enrichment_engine.get_db")
    def test_enrich_photo_aborts_when_cancelled(self, mock_db):
        task_key = "enrich-photo-1"
        TASK_MANAGER.cancel_task(task_key)

        res = enrich_photo(project_id=1, photo_id=1, task_key=task_key)
        self.assertFalse(res)
        mock_db.assert_not_called()

    def test_api_cancel_enrichment_endpoint(self):
        res = self.client.post("/api/entities/project/123/enrich/cancel")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "success")
        self.assertTrue(TASK_MANAGER.is_cancelled("enrich-project-123"))

    def test_api_cancel_task_generic_endpoint_post(self):
        res = self.client.post("/api/task/enrich-project-456/cancel")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "success")
        self.assertTrue(TASK_MANAGER.is_cancelled("enrich-project-456"))

    def test_api_cancel_task_generic_endpoint_delete(self):
        res = self.client.delete("/api/task/enrich-project-789/cancel")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "success")
        self.assertTrue(TASK_MANAGER.is_cancelled("enrich-project-789"))


if __name__ == "__main__":
    unittest.main()
