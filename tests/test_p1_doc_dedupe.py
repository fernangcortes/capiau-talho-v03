"""Testes para dedupe/versao de documentos no upload (P1 / E3.C0).

Banco temporario isolado (padrao de test_f0b_export_bridge.py); SemanticSearch mockado
por completo (get_instance retorna um MagicMock) para nunca tocar no Qdrant real -
nem em modo leitura, para nao disputar o lock de arquivo com uma instancia real aberta.
"""
import unittest
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.operations import add_project
from src.api.server import app


class TestP1DocDedupe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_doc_dedupe_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_docs.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Dedupe Docs", "P1", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        self.client = TestClient(app)
        self.qdrant_patch = patch("src.search.semantic.SemanticSearch.get_instance")
        mock_get_instance = self.qdrant_patch.start()
        self.mock_engine = MagicMock()
        mock_get_instance.return_value = self.mock_engine

    def tearDown(self):
        self.qdrant_patch.stop()

    def _upload(self, filename, text, doc_type="script", replace_doc_id=None):
        url = f"/api/project/{self.project_id}/docs?doc_type={doc_type}"
        if replace_doc_id:
            url += f"&replace_doc_id={replace_doc_id}"
        files = {"file": (filename, text.encode("utf-8"), "text/plain")}
        return self.client.post(url, files=files)

    def test_upload_normal_grava_hashes(self):
        """Caminho feliz: upload novo grava byte_hash/content_hash e indexa sem 409."""
        response = self._upload("roteiro_v1.txt", "INT. CASA - DIA\nCena de teste com texto suficiente.")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("doc_id", data)

    def test_upload_bytes_identicos_retorna_409_identical(self):
        """Reenviar exatamente o mesmo arquivo (mesmos bytes) e recusado como duplicata exata."""
        text = "INT. CASA - DIA\nMesmo arquivo enviado duas vezes."
        r1 = self._upload("roteiro_a.txt", text)
        self.assertEqual(r1.status_code, 200)
        r2 = self._upload("roteiro_a.txt", text)
        self.assertEqual(r2.status_code, 409)
        detail = r2.json()["detail"]
        self.assertEqual(detail["reason"], "identical")
        self.assertEqual(detail["existing_id"], r1.json()["doc_id"])

    def test_upload_mesmo_conteudo_outro_arquivo_retorna_409_same_content(self):
        """Mesmo texto normalizado vindo de um 'arquivo' diferente (bytes diferentes) e
        reconhecido como o mesmo conteudo, nao como duplicata exata de bytes."""
        text = "INT. QUARTO - NOITE\nConteudo identico em outro arquivo."
        r1 = self._upload("original.txt", text)
        self.assertEqual(r1.status_code, 200)
        r2 = self._upload("copia_renomeada.txt", text + "   ")  # espaco extra: bytes != mas normaliza igual
        self.assertEqual(r2.status_code, 409)
        self.assertEqual(r2.json()["detail"]["reason"], "same_content")

    def test_upload_texto_parecido_retorna_409_near_version(self):
        """Texto majoritariamente igual com um trecho novo no final e tratado como
        possivel nova versao (nao identico, nao 100% diferente)."""
        original = "INT. CASA - DIA\n" + ("Uma cena bem longa e detalhada sobre o making of. " * 40)
        r1 = self._upload("roteiro_v4.txt", original)
        self.assertEqual(r1.status_code, 200)
        v5 = original + "\n\nEXT. RUA - NOITE\nUma cena nova adicionada ao final do roteiro."
        r2 = self._upload("roteiro_v5.txt", v5)
        self.assertEqual(r2.status_code, 409)
        detail = r2.json()["detail"]
        self.assertEqual(detail["reason"], "near_version")
        self.assertIn("similarity", detail)
        self.assertEqual(detail["existing_id"], r1.json()["doc_id"])

    def test_replace_doc_id_apaga_versao_antiga_e_indexa_nova(self):
        """Confirmando a substituicao (replace_doc_id): a versao antiga sai do banco e
        delete_production_doc_vectors e chamado antes de indexar a nova."""
        original = "INT. CASA - DIA\n" + ("Texto original da versao antiga do roteiro. " * 40)
        r1 = self._upload("roteiro_v1.txt", original)
        old_id = r1.json()["doc_id"]

        v2 = original + "\n\nEXT. RUA - NOITE\nCena adicional na nova versao do roteiro."
        r2 = self._upload("roteiro_v2.txt", v2)
        self.assertEqual(r2.status_code, 409)
        existing_id = r2.json()["detail"]["existing_id"]
        self.assertEqual(existing_id, old_id)

        r3 = self._upload("roteiro_v2.txt", v2, replace_doc_id=existing_id)
        self.assertEqual(r3.status_code, 200)
        new_id = r3.json()["doc_id"]
        self.assertNotEqual(new_id, old_id)
        self.mock_engine.delete_production_doc_vectors.assert_any_call(self.project_id, old_id)

        list_resp = self.client.get(f"/api/project/{self.project_id}/docs")
        ids = [d["id"] for d in list_resp.json()]
        self.assertNotIn(old_id, ids)
        self.assertIn(new_id, ids)

    def test_migration_e_idempotente_em_banco_existente(self):
        """Rodar init_db de novo no mesmo banco (já migrado) não falha nem duplica coluna/índice."""
        init_db(CONFIG.DB_PATH)  # não deve levantar exceção
        response = self._upload("roteiro_pos_remigrar.txt", "INT. SET - DIA\nMais um documento de teste.")
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
