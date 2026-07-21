"""Testes do executor/rotas da extração estruturada de roteiro (P2.1c/P2.3, Commit 4).

Banco temporário isolado (padrão de test_p1_doc_dedupe.py). A extração de roteiro
NUNCA toca no Qdrant (não há indexação nesta etapa), então só o LLM de texto
(src.nlp.llm_text.call_text_llm) é mockado -- nenhuma chamada de rede real.
"""
import re
import unittest
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.entities import EntityRepository
from src.db.repositories.scenes import SceneRepository
from src.db.repositories.settings import SettingsRepository
from src.services.settings_service import SettingsService
from src.core.tasks import TASK_MANAGER
from src.services.script_extract import extraction_task_key, run_script_extraction
from src.api.server import app

client = TestClient(app)

# 3 cenas sluglines simples -- cabe num unico chunk com o chunk_chars default (24000).
SMALL_SCRIPT = """INT. CASA DO ENGEL - NOITE

Daniel entra na sala e observa o envelope sobre a mesa com atencao.

EXT. A COLINA - CHUVA - NOITE

Sob a chuva, Daniel caminha em direcao a colina, decidido.

INT. COZINHA DOS DEGARA - DIA

Maria prepara o cafe da manha enquanto conversa com Daniel sobre o passado.
"""

# 6 cenas maiores -- com chunk_chars=8000 (minimo permitido pelo registry) vira 3 chunks
# de 2 cenas cada (medido: 17.182 chars totais).
_BODY = "Personagem observa o ambiente com atencao redobrada e caminha devagar. " * 40
BIG_SCRIPT = "\n\n".join(f"INT. LOCACAO {i} - DIA\n\n{_BODY}" for i in range(1, 7))

PROSE_DOC = "Este documento descreve a proposta do documentario sobre o making of. " * 300


def _fake_llm_response(prompt: str, project_id=None, log_prefix="", max_tokens=0,
                        temperature=0.0, timeout=0, retries=0):
    """Simula call_text_llm: le os numeros de cena-ALVO do proprio prompt (marcador
    '=== CENA N ===' sem [CONTEXTO]) e devolve uma cena sintetica para cada um."""
    numbers = [int(n) for n in re.findall(r"=== CENA (\d+) ===", prompt)]
    cenas = [
        {"numero": n, "heading": f"HEADING {n}", "sinopse": f"Sinopse da cena {n}.",
         "personagens": ["DANIEL"], "props": ["envelope"], "locacao": f"Local {n}"}
        for n in numbers
    ]
    data = {
        "personagens": [{"nome": "Daniel", "descricao": "protagonista"}],
        "cenas": cenas,
        "objetos_chave": [{"nome": "envelope", "descricao": "pista central da trama"}],
    }
    usage = {"prompt_tokens": 500 + len(prompt) // 4, "completion_tokens": 80 * max(1, len(numbers))}
    return data, usage


class TestP2ExtractionExecutor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_script_extract_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_extract.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Extracao Roteiro", "P2", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        SettingsService.invalidate()
        self.llm_patch = patch("src.nlp.llm_text.call_text_llm", side_effect=_fake_llm_response)
        self.mock_llm = self.llm_patch.start()

    def tearDown(self):
        self.llm_patch.stop()
        # Garante que uma tarefa marcada 'running' num teste nao vaze pro proximo.
        for key in list(TASK_MANAGER.get_progress().keys()):
            if key.startswith("extracao-roteiro-"):
                TASK_MANAGER.remove_progress(key)
        # self.project_id e compartilhado por TODOS os testes da classe: um override
        # de setting escrito num teste (chunk_chars, llm_format_detection) vazaria
        # para os testes seguintes sem isto -- SettingsService.invalidate() so limpa
        # o CACHE, a linha continuaria no banco.
        with get_db() as conn:
            SettingsRepository.delete_project(conn, self.project_id, "script_extract.chunk_chars")
            SettingsRepository.delete_project(conn, self.project_id, "script.llm_format_detection")
            conn.commit()
        SettingsService.invalidate(self.project_id)

    def _insert_doc(self, content: str, filename: str = "roteiro.txt", doc_type: str = "script") -> int:
        with get_db() as conn:
            doc_id = ProjectRepository.add_document(
                conn, self.project_id, filename, None, content, doc_type,
                ProjectRepository.hash_doc_bytes(content.encode("utf-8")),
                ProjectRepository.hash_doc_content(content),
            )
            conn.commit()
        return doc_id

    # ── Caminho feliz ────────────────────────────────────────────────────────

    def test_extract_structure_happy_path_persists_scenes_and_entities(self):
        doc_id = self._insert_doc(SMALL_SCRIPT)

        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.mock_llm.call_count, 1, "roteiro pequeno deveria caber em 1 chunk")

        scenes_resp = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}")
        scenes = scenes_resp.json()["scenes"]
        self.assertEqual(len(scenes), 3)
        self.assertEqual([s["number"] for s in scenes], [1, 2, 3])
        self.assertEqual(scenes[0]["status"], "suggested")
        self.assertEqual(scenes[0]["characters"], ["DANIEL"])

        with get_db() as conn:
            suggested_names = [e["name"] for e in EntityRepository.list_entities(conn, self.project_id, status="suggested")]
        self.assertIn("Daniel", suggested_names)
        self.assertIn("Local 1", suggested_names, "locacao das cenas devia virar entidade sugerida")
        self.assertIn("envelope", suggested_names)

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["status"], "done")
        self.assertEqual(ext["strategy"], "sluglines")
        self.assertEqual(ext["calls"], 1)
        self.assertGreater(ext["prompt_tokens"], 0)
        self.assertGreater(ext["completion_tokens"], 0)

        progress = TASK_MANAGER.get_progress()[extraction_task_key(doc_id)]
        self.assertEqual(progress["status"], "finished")

    def test_suggested_entities_excluded_from_known_names_until_confirmed(self):
        """Elo com a regra do Commit 1: o que o roteiro sugere nao pode influenciar
        analises de visao/triagem antes de confirmado pelo usuario."""
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="roteiro2.txt")
        client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")

        with get_db() as conn:
            known = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertNotIn("Daniel", known)
        self.assertNotIn("envelope", known)

    # ── Cache por content_hash (P2.3) ───────────────────────────────────────

    def test_cache_skips_second_call_without_force(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="cache.txt")
        client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(self.mock_llm.call_count, 1)

        resp2 = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(self.mock_llm.call_count, 1, "segunda rodada sem force nao pode chamar o LLM de novo")

    def test_force_reextracts_even_with_cache(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="force.txt")
        client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(self.mock_llm.call_count, 1)

        resp2 = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}&force=true")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(self.mock_llm.call_count, 2, "force=true precisa ignorar o cache")

    # ── Guarda contra rodada dupla (auditoria 21/07) ────────────────────────

    def test_409_when_extraction_already_running(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="duplo.txt")
        TASK_MANAGER.update_progress(extraction_task_key(doc_id), 40.0, "running", task_type="script_extract")

        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(self.mock_llm.call_count, 0, "rodada duplicada nao pode nem comecar a chamar o LLM")

    def test_404_for_doc_not_in_project(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="outro_projeto.txt")
        outro_projeto = add_project("Outro Projeto", "", "")
        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={outro_projeto}")
        self.assertEqual(resp.status_code, 404)

    # ── Falha persistente: nada parcial ─────────────────────────────────────

    def test_chunk_failure_persists_nothing_and_marks_failed(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="falha.txt")
        with patch("src.nlp.llm_text.call_text_llm", return_value=(None, {})):
            resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200, "o endpoint aceita a rodada; a falha e interna/assincrona")

        scenes = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]
        self.assertEqual(scenes, [], "nenhuma cena parcial pode sobreviver a uma rodada com falha")

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["status"], "error")
        self.assertIsNotNone(ext["error"])

        progress = TASK_MANAGER.get_progress()[extraction_task_key(doc_id)]
        self.assertEqual(progress["status"], "failed")

    def test_split_recovers_a_chunk_that_failed_by_truncation(self):
        """1a tentativa do chunk inteiro falha (simula truncamento); as 2 metades
        via split_chunk tem sucesso -- todas as cenas terminam persistidas."""
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="split.txt")
        calls = {"n": 0}

        def side_effect(prompt, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return None, {"prompt_tokens": 100, "completion_tokens": 50}
            return _fake_llm_response(prompt, **kwargs)

        with patch("src.nlp.llm_text.call_text_llm", side_effect=side_effect):
            resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)

        scenes = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]
        self.assertEqual([s["number"] for s in scenes], [1, 2, 3], "split precisa recuperar as 3 cenas")

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["status"], "done")
        self.assertEqual(calls["n"], 3, "1 falha do chunk inteiro + 2 metades")

    # ── Multi-chunk (orquestracao completa) ─────────────────────────────────

    def test_multi_chunk_orchestration_merges_all_scenes(self):
        doc_id = self._insert_doc(BIG_SCRIPT, filename="grande.txt")
        with get_db() as conn:
            SettingsRepository.upsert_project(conn, self.project_id, "script_extract.chunk_chars", 8000)
            conn.commit()
        SettingsService.invalidate(self.project_id)

        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.mock_llm.call_count, 3, "6 cenas / chunk_chars=8000 deveria virar 3 chunks")

        scenes = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]
        self.assertEqual([s["number"] for s in scenes], [1, 2, 3, 4, 5, 6])

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["chunks"], 3)
        self.assertEqual(ext["calls"], 3)

        progress = TASK_MANAGER.get_progress()[extraction_task_key(doc_id)]
        self.assertEqual(progress["percent"], 100.0)

    # ── Modo prosa: decisao de escopo do Commit 4 ───────────────────────────

    def test_prose_document_skips_scene_extraction_prompt(self):
        """Documento em prosa nunca chama o prompt script_extract (chunks=0, calls=0
        na rodada) -- mas a DETECCAO de formato (camada 3) pode gastar 1 chamada
        barata tentando achar um padrao de cena antes de desistir; isso e contabilizado
        em outro lugar (nao em script_extraction.calls), entao desligamos
        script.llm_format_detection aqui para isolar e provar a alegacao com precisao:
        zero chamadas de qualquer tipo quando a deteccao fica so nas heuristicas locais."""
        with get_db() as conn:
            SettingsRepository.upsert_project(conn, self.project_id, "script.llm_format_detection", False)
            conn.commit()
        SettingsService.invalidate(self.project_id)

        doc_id = self._insert_doc(PROSE_DOC, filename="tratamento.txt", doc_type="notes")
        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.mock_llm.call_count, 0)

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["status"], "done")
        self.assertEqual(ext["strategy"], "prose")
        self.assertEqual(ext["chunks"], 0)
        self.assertEqual(ext["calls"], 0)

        scenes = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]
        self.assertEqual(scenes, [])

    def test_prose_detection_may_cost_one_format_detection_call(self):
        """Com script.llm_format_detection no default (True), um documento ambiguo
        pode gastar 1 chamada de deteccao de formato (camada 3 do script_format.py)
        antes de desistir e virar 'prose' -- essa chamada e da deteccao, nao da
        extracao de cenas/entidades (que continua em 0)."""
        doc_id = self._insert_doc(PROSE_DOC, filename="tratamento2.txt", doc_type="notes")
        resp = client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertLessEqual(self.mock_llm.call_count, 1)

        ext = client.get(f"/api/docs/{doc_id}/extraction").json()
        self.assertEqual(ext["strategy"], "prose")
        self.assertEqual(ext["calls"], 0, "a chamada de deteccao de formato nao conta como chamada de extracao")

    # ── Preview sem custo ────────────────────────────────────────────────────

    def test_structure_preview_costs_nothing_by_default(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="preview.txt")
        resp = client.get(f"/api/docs/{doc_id}/structure-preview?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["strategy"], "sluglines")
        self.assertEqual(data["scene_count"], 3)
        self.assertEqual(len(data["sample"]), 3)
        self.assertEqual(self.mock_llm.call_count, 0, "preview default (llm=false) nao pode chamar API")

    def test_structure_preview_missing_doc_404(self):
        resp = client.get(f"/api/docs/999999/structure-preview?project_id={self.project_id}")
        self.assertEqual(resp.status_code, 404)

    # ── Curadoria em massa ───────────────────────────────────────────────────

    def test_bulk_scene_status(self):
        doc_id = self._insert_doc(SMALL_SCRIPT, filename="bulk_cenas.txt")
        client.post(f"/api/docs/{doc_id}/extract-structure?project_id={self.project_id}")
        scenes = client.get(f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]
        ids = [s["id"] for s in scenes[:2]]

        resp = client.post("/api/scenes/bulk-status", json={
            "project_id": self.project_id, "scene_ids": ids, "status": "confirmed",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["updated"], 2)

        depois = {s["id"]: s["status"] for s in client.get(
            f"/api/project/{self.project_id}/scenes?doc_id={doc_id}").json()["scenes"]}
        self.assertEqual(depois[ids[0]], "confirmed")
        self.assertEqual(depois[ids[1]], "confirmed")

    def test_bulk_entity_status_promotes_to_known_names(self):
        with get_db() as conn:
            ent_id = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Personagem Bulk", "person", "extraido do roteiro"
            )
            conn.commit()

        resp = client.post("/api/entities/bulk-status", json={
            "project_id": self.project_id, "entity_ids": [ent_id], "status": "confirmed",
        })
        self.assertEqual(resp.status_code, 200)

        with get_db() as conn:
            known = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Personagem Bulk", known)

    def test_bulk_status_rejects_invalid_status_value(self):
        resp = client.post("/api/scenes/bulk-status", json={
            "project_id": self.project_id, "scene_ids": [1], "status": "invalido",
        })
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
