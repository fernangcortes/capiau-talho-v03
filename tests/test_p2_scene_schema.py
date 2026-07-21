"""Testes do schema e repositorios de cena/extracao de roteiro (P2.2, Commit 1).

Banco temporario isolado (padrao de test_p1_doc_dedupe.py). Nao toca no Qdrant: este
commit e puramente SQLite, entao nao ha nada a mockar alem do proprio CONFIG.DB_PATH.
"""
import unittest
import shutil
import tempfile
from pathlib import Path

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.scenes import SceneRepository
from src.db.repositories.entities import EntityRepository
from src.db.repositories.projects import ProjectRepository


class TestP2SceneSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_scene_schema_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_scenes.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Cenas", "P2", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _novo_doc(self, filename="roteiro.txt", content="INT. CASA - DIA\nTexto."):
        with get_db() as conn:
            doc_id = ProjectRepository.add_document(
                conn, self.project_id, filename, None, content, "script",
                ProjectRepository.hash_doc_bytes(content.encode("utf-8")),
                ProjectRepository.hash_doc_content(content),
            )
            conn.commit()
        return doc_id

    # ── Migracao ─────────────────────────────────────────────────────────────

    def test_migracao_e_idempotente(self):
        """init_db roda de novo no mesmo banco sem erro (padrao PRAGMA table_info)."""
        init_db(CONFIG.DB_PATH)
        with get_db() as conn:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(entity)").fetchall()]
            self.assertIn("status", cols)
            tabelas = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            self.assertIn("scene", tabelas)
            self.assertIn("script_extraction", tabelas)

    def test_entidade_existente_nasce_confirmada(self):
        """Entidades criadas pelo caminho normal (auditoria humana) contam como confirmadas
        e continuam entrando nos prompts -- o default 'confirmed' da migracao existe para
        nao esconder do pipeline o que ja estava no banco."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Daniel Auditado", "person", "")
            conn.commit()
            nomes = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Daniel Auditado", nomes)

    # ── Curadoria de entidades ───────────────────────────────────────────────

    def test_entidade_sugerida_nao_entra_nos_prompts(self):
        """Regra central do P2.2: o que o roteiro sugeriu so influencia analises depois
        que o usuario confirmar."""
        with get_db() as conn:
            ent_id = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Personagem Sugerido", "person", "extraido do roteiro"
            )
            conn.commit()
            nomes = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
            self.assertNotIn("Personagem Sugerido", nomes)

            EntityRepository.set_entities_status(conn, self.project_id, [ent_id], "confirmed")
            conn.commit()
            nomes_depois = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
            self.assertIn("Personagem Sugerido", nomes_depois)

    def test_sugestao_nao_rebaixa_entidade_confirmada(self):
        """Re-extrair o roteiro nao pode devolver para a fila de curadoria um nome que o
        usuario ja confirmou."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Ja Confirmado", "person", "")
            conn.commit()
            EntityRepository.upsert_suggested_entity(conn, self.project_id, "ja confirmado", "person", "")
            conn.commit()
            nomes = [e["name"] for e in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Ja Confirmado", nomes)

    def test_rejeitada_permanece_rejeitada_apos_reextracao(self):
        """Uma entidade rejeitada funciona como lapide: re-extrair nao a ressuscita."""
        with get_db() as conn:
            ent_id = EntityRepository.upsert_suggested_entity(conn, self.project_id, "Ruido Extraido", "object", "")
            conn.commit()
            EntityRepository.set_entities_status(conn, self.project_id, [ent_id], "rejected")
            conn.commit()

            EntityRepository.upsert_suggested_entity(conn, self.project_id, "Ruido Extraido", "object", "")
            conn.commit()
            status = conn.execute("SELECT status FROM entity WHERE id = ?", (ent_id,)).fetchone()["status"]
        self.assertEqual(status, "rejected")

    def test_list_entities_filtra_por_status(self):
        with get_db() as conn:
            EntityRepository.upsert_suggested_entity(conn, self.project_id, "Filtro Sugerido", "location", "")
            conn.commit()
            sugeridas = [e["name"] for e in EntityRepository.list_entities(conn, self.project_id, status="suggested")]
            confirmadas = [e["name"] for e in EntityRepository.list_entities(conn, self.project_id, status="confirmed")]
        self.assertIn("Filtro Sugerido", sugeridas)
        self.assertNotIn("Filtro Sugerido", confirmadas)

    # ── Cenas ────────────────────────────────────────────────────────────────

    def test_replace_scenes_grava_e_decodifica_json(self):
        doc_id = self._novo_doc("cenas.txt", "INT. COZINHA - DIA\nAlgo acontece.")
        cenas = [
            {"number": 1, "heading": "INT. COZINHA - DIA", "synopsis": "Daniel faz cafe.",
             "characters": ["DANIEL"], "props": ["cafeteira"], "location": "Cozinha"},
            {"number": 2, "heading": "EXT. COLINA - NOITE", "synopsis": "A colina sob chuva.",
             "characters": [], "props": [], "location": "Colina"},
        ]
        with get_db() as conn:
            n = SceneRepository.replace_scenes_for_doc(conn, self.project_id, doc_id, cenas)
            conn.commit()
            lidas = SceneRepository.list_scenes(conn, self.project_id, doc_id=doc_id)

        self.assertEqual(n, 2)
        self.assertEqual(len(lidas), 2)
        self.assertEqual(lidas[0]["characters"], ["DANIEL"])
        self.assertEqual(lidas[0]["props"], ["cafeteira"])
        self.assertEqual(lidas[1]["characters"], [])
        self.assertEqual(lidas[0]["status"], "suggested")

    def test_reextracao_substitui_em_vez_de_duplicar(self):
        """Numeracao estavel entre rodadas: reextrair reescreve as mesmas cenas."""
        doc_id = self._novo_doc("reextrai.txt")
        cenas = [{"number": 1, "heading": "INT. A - DIA", "synopsis": "v1", "characters": [], "props": [], "location": "A"}]
        with get_db() as conn:
            SceneRepository.replace_scenes_for_doc(conn, self.project_id, doc_id, cenas)
            conn.commit()
            cenas[0]["synopsis"] = "v2"
            SceneRepository.replace_scenes_for_doc(conn, self.project_id, doc_id, cenas)
            conn.commit()
            lidas = SceneRepository.list_scenes(conn, self.project_id, doc_id=doc_id)

        self.assertEqual(len(lidas), 1)
        self.assertEqual(lidas[0]["synopsis"], "v2")

    def test_cena_rejeitada_sai_da_listagem_padrao(self):
        doc_id = self._novo_doc("rejeita.txt")
        with get_db() as conn:
            SceneRepository.replace_scenes_for_doc(conn, self.project_id, doc_id, [
                {"number": 1, "heading": "INT. A - DIA", "synopsis": "fica", "characters": [], "props": [], "location": "A"},
                {"number": 2, "heading": "INT. B - DIA", "synopsis": "sai", "characters": [], "props": [], "location": "B"},
            ])
            conn.commit()
            todas = SceneRepository.list_scenes(conn, self.project_id, doc_id=doc_id)
            alvo = [c["id"] for c in todas if c["number"] == 2]
            SceneRepository.set_scenes_status(conn, self.project_id, alvo, "rejected")
            conn.commit()

            visiveis = SceneRepository.list_scenes(conn, self.project_id, doc_id=doc_id)
            com_rejeitadas = SceneRepository.list_scenes(conn, self.project_id, doc_id=doc_id, include_rejected=True)

        self.assertEqual([c["number"] for c in visiveis], [1])
        self.assertEqual([c["number"] for c in com_rejeitadas], [1, 2])

    def test_apagar_doc_apaga_cenas_em_cascata(self):
        """PRAGMA foreign_keys = ON esta ativo em toda conexao (db/connection.py:15), entao
        substituir/apagar um roteiro limpa as cenas sem delete manual."""
        doc_id = self._novo_doc("cascata.txt")
        with get_db() as conn:
            SceneRepository.replace_scenes_for_doc(conn, self.project_id, doc_id, [
                {"number": 1, "heading": "INT. A - DIA", "synopsis": "x", "characters": [], "props": [], "location": "A"},
            ])
            conn.commit()
            ProjectRepository.delete_document(conn, doc_id)
            conn.commit()
            restantes = conn.execute("SELECT COUNT(*) c FROM scene WHERE doc_id = ?", (doc_id,)).fetchone()["c"]
        self.assertEqual(restantes, 0)

    # ── Rodadas de extracao ──────────────────────────────────────────────────

    def test_cache_encontra_extracao_da_mesma_versao(self):
        doc_id = self._novo_doc("cache.txt", "INT. CACHE - DIA\nConteudo.")
        content_hash = ProjectRepository.hash_doc_content("INT. CACHE - DIA\nConteudo.")
        with get_db() as conn:
            self.assertIsNone(SceneRepository.find_extraction(conn, doc_id, content_hash))

            ext_id = SceneRepository.create_extraction(conn, self.project_id, doc_id, content_hash, "sluglines")
            conn.commit()
            # rodada ainda 'running' nao serve de cache
            self.assertIsNone(SceneRepository.find_extraction(conn, doc_id, content_hash))

            SceneRepository.finish_extraction(
                conn, ext_id, "done", strategy="sluglines", model="deepseek/deepseek-chat",
                chunks=6, calls=6, prompt_tokens=40213, completion_tokens=4890,
            )
            conn.commit()
            achou = SceneRepository.find_extraction(conn, doc_id, content_hash)

        self.assertIsNotNone(achou)
        self.assertEqual(achou["calls"], 6)
        self.assertEqual(achou["prompt_tokens"], 40213)
        self.assertEqual(achou["strategy"], "sluglines")

    def test_cache_nao_serve_para_outra_versao_do_texto(self):
        doc_id = self._novo_doc("versao.txt", "INT. V1 - DIA\nTexto.")
        hash_v1 = ProjectRepository.hash_doc_content("INT. V1 - DIA\nTexto.")
        hash_v2 = ProjectRepository.hash_doc_content("INT. V2 - DIA\nOutro texto.")
        with get_db() as conn:
            ext_id = SceneRepository.create_extraction(conn, self.project_id, doc_id, hash_v1)
            SceneRepository.finish_extraction(conn, ext_id, "done", chunks=1, calls=1)
            conn.commit()
            self.assertIsNotNone(SceneRepository.find_extraction(conn, doc_id, hash_v1))
            self.assertIsNone(SceneRepository.find_extraction(conn, doc_id, hash_v2))

    def test_extracao_com_erro_nao_vira_cache(self):
        doc_id = self._novo_doc("erro.txt", "INT. ERRO - DIA\nTexto.")
        content_hash = ProjectRepository.hash_doc_content("INT. ERRO - DIA\nTexto.")
        with get_db() as conn:
            ext_id = SceneRepository.create_extraction(conn, self.project_id, doc_id, content_hash)
            SceneRepository.finish_extraction(conn, ext_id, "error", error="chunk 3 falhou")
            conn.commit()
            self.assertIsNone(SceneRepository.find_extraction(conn, doc_id, content_hash))
            ultima = SceneRepository.latest_extraction(conn, doc_id)
        self.assertEqual(ultima["status"], "error")
        self.assertIn("chunk 3", ultima["error"])


if __name__ == "__main__":
    unittest.main()
