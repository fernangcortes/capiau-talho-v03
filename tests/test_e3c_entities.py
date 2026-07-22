"""Testes do modelo de entidades reformulado (E3.C, 21/07):
- E-A1: realm (produção real x obra ficcional), role e linked_entity_id, com
  backfill migrado do estado anterior (só status suggested/confirmed).
- E-A2: fusão de entidades (merge_entities), resolução por alias
  (find_entity_by_name) e o PATCH ampliado (update_entity_fields + rota).

Banco temporário isolado. Nenhum teste aqui toca Qdrant nem LLM.
"""
import unittest
import shutil
import sqlite3
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.operations import add_project
from src.db.repositories.entities import EntityRepository
from src.api.server import app


class TestE3CEntitySchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_entities_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_e3c.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste E3.C", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    # ── Migração ─────────────────────────────────────────────────────────────

    def test_migracao_e_idempotente(self):
        init_db(CONFIG.DB_PATH)  # roda de novo no mesmo banco
        with get_db() as conn:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(entity)").fetchall()]
        for col in ("realm", "role", "linked_entity_id"):
            self.assertIn(col, cols)

    def test_realm_default_e_production(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Equipe Padrao", "person", "")
            conn.commit()
            row = conn.execute(
                "SELECT realm FROM entity WHERE project_id = ? AND name = 'Equipe Padrao'", (self.project_id,)
            ).fetchone()
        self.assertEqual(row["realm"], "production")

    def test_check_constraint_rejeita_realm_invalido(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Alvo Constraint", "person", "")
            conn.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute(
                    "UPDATE entity SET realm = 'invalido' WHERE project_id = ? AND name = 'Alvo Constraint'",
                    (self.project_id,)
                )

    def test_linked_entity_id_vira_null_quando_vinculada_e_apagada(self):
        """ON DELETE SET NULL: apagar a pessoa real nao pode deixar o personagem
        apontando para um id fantasma."""
        with get_db() as conn:
            ator_id = EntityRepository.upsert_entity(conn, self.project_id, "Ator Vinculavel", "person", "")
            personagem_id = EntityRepository.upsert_entity(conn, self.project_id, "Personagem Vinculavel", "person", "")
            conn.execute("UPDATE entity SET linked_entity_id = ? WHERE id = ?", (ator_id, personagem_id))
            conn.commit()

            conn.execute("DELETE FROM entity WHERE id = ?", (ator_id,))
            conn.commit()
            row = conn.execute("SELECT linked_entity_id FROM entity WHERE id = ?", (personagem_id,)).fetchone()
        self.assertIsNone(row["linked_entity_id"])

    # ── Backfill (migração de um banco no estado anterior ao E3.C) ──────────

    def test_backfill_promove_suggested_existente_para_story(self):
        """Simula o cenario real: um banco que ja tinha entidades suggested (do P2,
        antes do realm existir) precisa ve-las viraram 'story' na migracao, sem
        precisar de re-extracao."""
        db_path = self.test_dir / "test_backfill.db"
        init_db(db_path)
        pid = add_project("Backfill", "", "")

        # Simula o estado ANTERIOR ao E3.C: reverte a coluna realm manualmente para
        # forcar a migracao a rodar de novo neste banco especifico.
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("ALTER TABLE entity RENAME TO entity_new")
        conn.execute("""
            CREATE TABLE entity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                entity_type TEXT CHECK(entity_type IN ('person','object','location','other')) DEFAULT 'other',
                name TEXT NOT NULL,
                aliases TEXT,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status TEXT DEFAULT 'confirmed',
                UNIQUE(project_id, name)
            )
        """)
        conn.execute("""
            INSERT INTO entity (id, project_id, entity_type, name, aliases, description, created_at, status)
            SELECT id, project_id, entity_type, name, aliases, description, created_at, status FROM entity_new
        """)
        conn.execute("DROP TABLE entity_new")
        conn.execute("INSERT INTO entity (project_id, entity_type, name, status) VALUES (?, 'person', 'Personagem Legado', 'suggested')", (pid,))
        conn.execute("INSERT INTO entity (project_id, entity_type, name, status) VALUES (?, 'person', 'Equipe Legada', 'confirmed')", (pid,))
        conn.commit()
        conn.close()

        # Roda a migracao real de verdade sobre este banco "antigo"
        init_db(db_path)

        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        legado_suggested = conn.execute("SELECT realm FROM entity WHERE name = 'Personagem Legado'").fetchone()
        legado_confirmed = conn.execute("SELECT realm FROM entity WHERE name = 'Equipe Legada'").fetchone()
        conn.close()

        self.assertEqual(legado_suggested["realm"], "story")
        self.assertEqual(legado_confirmed["realm"], "production")

    # ── upsert_suggested_entity com realm ────────────────────────────────────

    def test_upsert_suggested_default_realm_e_story(self):
        with get_db() as conn:
            eid = EntityRepository.upsert_suggested_entity(conn, self.project_id, "Personagem Default", "person", "")
            conn.commit()
            row = conn.execute("SELECT realm FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "story")

    def test_upsert_suggested_realm_explicito_production(self):
        """O extrator de documentos de producao (E-C, futuro) vai chamar isto com
        realm='production' para pessoas de equipe extraidas de ficha tecnica."""
        with get_db() as conn:
            eid = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Tecnico Sugerido", "person", "", realm="production"
            )
            conn.commit()
            row = conn.execute("SELECT realm FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "production")

    def test_upsert_suggested_nao_sobrescreve_realm_existente(self):
        """O caso Daniel: uma pessoa real ja confirmada (realm=production) nao pode
        virar 'story' silenciosamente so porque o roteiro tambem tem um personagem
        com o mesmo nome. Ligar os dois e decisao humana (vinculo), nao automatica."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Daniel Duplicado", "person", "")
            conn.commit()
            eid = EntityRepository.upsert_suggested_entity(
                conn, self.project_id, "Daniel Duplicado", "person", "personagem do romance", realm="story"
            )
            conn.commit()
            row = conn.execute("SELECT realm, status FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["realm"], "production", "realm da entidade existente nao pode ser sobrescrito")
        self.assertEqual(row["status"], "confirmed", "status da entidade existente tambem nao pode ser sobrescrito")


class TestE3CFindByName(unittest.TestCase):
    """find_entity_by_name: resolucao canonica + alias, usada pelo P3 (expansao
    personagem->ator) e pelo matching de documentos do E-C."""

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_findname_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_findname.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste FindName", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_resolve_por_nome_canonico_case_insensitive(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Sandro Osorio", "person", "")
            conn.commit()
            found = EntityRepository.find_entity_by_name(conn, self.project_id, "sandro osorio")
        self.assertIsNotNone(found)
        self.assertEqual(found["name"], "Sandro Osorio")

    def test_resolve_por_alias_case_insensitive(self):
        with get_db() as conn:
            eid = EntityRepository.upsert_entity(conn, self.project_id, "Sandro Osorio Mathias", "person", "")
            EntityRepository.update_entity_fields(conn, eid, aliases=["Sandro"])
            conn.commit()
            found = EntityRepository.find_entity_by_name(conn, self.project_id, "SANDRO")
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], eid)

    def test_nome_sem_correspondencia_retorna_none(self):
        with get_db() as conn:
            found = EntityRepository.find_entity_by_name(conn, self.project_id, "Ninguem Com Esse Nome")
        self.assertIsNone(found)

    def test_nome_vazio_retorna_none_sem_quebrar(self):
        with get_db() as conn:
            self.assertIsNone(EntityRepository.find_entity_by_name(conn, self.project_id, ""))
            self.assertIsNone(EntityRepository.find_entity_by_name(conn, self.project_id, None))


class TestE3CMergeEntities(unittest.TestCase):
    """merge_entities: a operacao mais arriscada do E-A2 (destrutiva por design,
    protegida por confirm() no frontend) -- cobertura pesada aqui de proposito."""

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_merge_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_merge.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Merge", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _make_photo(self, conn, tag):
        cursor = conn.execute(
            "INSERT INTO photo (project_id, filename, filepath, hash) VALUES (?, ?, ?, ?)",
            (self.project_id, f"foto_{tag}.jpg", f"/tmp/foto_{tag}.jpg", f"hash_photo_{tag}")
        )
        return cursor.lastrowid

    def _make_video(self, conn, tag):
        cursor = conn.execute(
            "INSERT INTO video (project_id, filename, filepath, hash) VALUES (?, ?, ?, ?)",
            (self.project_id, f"video_{tag}.mp4", f"/tmp/video_{tag}.mp4", f"hash_video_{tag}")
        )
        return cursor.lastrowid

    def test_mencoes_migram_para_a_sobrevivente(self):
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "ALFREDO", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Alfredo Degara", "person", "")
            photo_id = self._make_photo(conn, "alfredo")
            video_id = self._make_video(conn, "alfredo")
            EntityRepository.add_mention(conn, source, self.project_id, photo_id=photo_id)
            EntityRepository.add_mention(conn, source, self.project_id, video_id=video_id, timestamp=5.0)
            conn.commit()

            result = EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            mentions = conn.execute("SELECT * FROM entity_mention WHERE entity_id = ?", (target,)).fetchall()
        self.assertEqual(result["mentions_moved"], 2)
        self.assertEqual(result["mentions_deduped"], 0)
        self.assertEqual(len(mentions), 2)

    def test_mencao_duplicada_e_descartada_nao_duplicada(self):
        """Origem e destino mencionadas na MESMA foto: a fusao nao pode duplicar."""
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "Detetive Carlos", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Detetive Carlos Eduardo", "person", "")
            photo_id = self._make_photo(conn, "detetive")
            EntityRepository.add_mention(conn, source, self.project_id, photo_id=photo_id)
            EntityRepository.add_mention(conn, target, self.project_id, photo_id=photo_id)
            conn.commit()

            result = EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            mentions = conn.execute("SELECT * FROM entity_mention WHERE entity_id = ? AND photo_id = ?", (target, photo_id)).fetchall()
        self.assertEqual(result["mentions_moved"], 0)
        self.assertEqual(result["mentions_deduped"], 1)
        self.assertEqual(len(mentions), 1, "a mesma foto nao pode aparecer duas vezes para a sobrevivente")

    def test_nome_da_fundida_vira_alias_da_sobrevivente(self):
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "MABEL", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Mabel Aparecida", "person", "")
            conn.commit()

            result = EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            row = conn.execute("SELECT aliases FROM entity WHERE id = ?", (target,)).fetchone()
        import json
        self.assertIn("MABEL", json.loads(row["aliases"]))
        self.assertIn("MABEL", result["aliases_added"])

    def test_aliases_da_fundida_tambem_migram_transitivamente(self):
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "Sandro O.", "person", "")
            EntityRepository.update_entity_fields(conn, source, aliases=["Sandrinho"])
            target = EntityRepository.upsert_entity(conn, self.project_id, "Sandro Osorio", "person", "")
            conn.commit()

            EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            row = conn.execute("SELECT aliases FROM entity WHERE id = ?", (target,)).fetchone()
        import json
        aliases = json.loads(row["aliases"])
        self.assertIn("Sandro O.", aliases)
        self.assertIn("Sandrinho", aliases, "alias que a fundida ja tinha precisa migrar tambem")

    def test_alias_ja_existente_nao_duplica(self):
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "Apelido Repetido", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Nome Canonico", "person", "")
            EntityRepository.update_entity_fields(conn, target, aliases=["Apelido Repetido"])
            conn.commit()

            EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            row = conn.execute("SELECT aliases FROM entity WHERE id = ?", (target,)).fetchone()
        import json
        aliases = json.loads(row["aliases"])
        self.assertEqual(aliases.count("Apelido Repetido"), 1)

    def test_vinculos_de_terceiros_sao_redirecionados(self):
        """Se um personagem estava vinculado a fundida por engano, o vinculo segue
        a fusao ate a sobrevivente em vez de ficar orfao."""
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "Daniel Foto Errado", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Daniel Foto", "person", "")
            personagem = EntityRepository.upsert_entity(conn, self.project_id, "Personagem Daniel", "person", "")
            EntityRepository.update_entity_fields(conn, personagem, linked_entity_id=source)
            conn.commit()

            result = EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            row = conn.execute("SELECT linked_entity_id FROM entity WHERE id = ?", (personagem,)).fetchone()
        self.assertEqual(result["relinked_from_others"], 1)
        self.assertEqual(row["linked_entity_id"], target)

    def test_fundida_e_apagada(self):
        with get_db() as conn:
            source = EntityRepository.upsert_entity(conn, self.project_id, "Sera Apagada", "person", "")
            target = EntityRepository.upsert_entity(conn, self.project_id, "Vai Sobreviver", "person", "")
            conn.commit()
            EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()
            row = conn.execute("SELECT id FROM entity WHERE id = ?", (source,)).fetchone()
        self.assertIsNone(row)

    def test_fundir_suggested_em_rejected_nao_ressuscita_status(self):
        """Fundir nao e confirmar: o status da sobrevivente e preservado, mesmo que
        a origem estivesse 'suggested'."""
        with get_db() as conn:
            source = EntityRepository.upsert_suggested_entity(conn, self.project_id, "Carla Sugerida", "person", "")
            target = EntityRepository.upsert_suggested_entity(conn, self.project_id, "Carla Rejeitada", "person", "")
            EntityRepository.set_entities_status(conn, self.project_id, [target], "rejected")
            conn.commit()

            EntityRepository.merge_entities(conn, self.project_id, source, target)
            conn.commit()

            row = conn.execute("SELECT status FROM entity WHERE id = ?", (target,)).fetchone()
        self.assertEqual(row["status"], "rejected", "fusao nao pode promover o status da sobrevivente")

    def test_fundir_com_ela_mesma_levanta_erro(self):
        with get_db() as conn:
            eid = EntityRepository.upsert_entity(conn, self.project_id, "Sozinha", "person", "")
            conn.commit()
            with self.assertRaises(ValueError):
                EntityRepository.merge_entities(conn, self.project_id, eid, eid)

    def test_fundir_entidade_inexistente_levanta_erro(self):
        with get_db() as conn:
            target = EntityRepository.upsert_entity(conn, self.project_id, "Existe", "person", "")
            conn.commit()
            with self.assertRaises(ValueError):
                EntityRepository.merge_entities(conn, self.project_id, 999999, target)


class TestE3CEntityRoutesAPI(unittest.TestCase):
    """PATCH ampliado e POST /merge pela camada HTTP (payload real, exclude_unset)."""

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_routes_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_routes.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste Rotas E3C", "", "")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def _new_entity(self, name, entity_type="person"):
        with get_db() as conn:
            eid = EntityRepository.upsert_entity(conn, self.project_id, name, entity_type, "")
            conn.commit()
        return eid

    def test_patch_so_role_nao_toca_outros_campos(self):
        eid = self._new_entity("Radha Montadora Teste")
        with get_db() as conn:
            cursor = conn.execute(
                "INSERT INTO photo (project_id, filename, filepath, hash) VALUES (?, ?, ?, ?)",
                (self.project_id, "foto_role.jpg", "/tmp/foto_role.jpg", "hash_role_test")
            )
            EntityRepository.add_mention(conn, eid, self.project_id, photo_id=cursor.lastrowid)
            conn.commit()

        resp = self.client.patch(f"/api/entities/{eid}", json={"role": "Montadora"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["affected_media"], 0, "so o role mudou, nome nao mudou -- nao reenriquece")

        with get_db() as conn:
            row = conn.execute("SELECT role, name FROM entity WHERE id = ?", (eid,)).fetchone()
        self.assertEqual(row["role"], "Montadora")
        self.assertEqual(row["name"], "Radha Montadora Teste")

    def test_patch_linked_entity_id_null_desvincula(self):
        ator = self._new_entity("Ator Vinculo Teste")
        personagem = self._new_entity("Personagem Vinculo Teste")
        self.client.patch(f"/api/entities/{personagem}", json={"linked_entity_id": ator})
        with get_db() as conn:
            antes = conn.execute("SELECT linked_entity_id FROM entity WHERE id = ?", (personagem,)).fetchone()
        self.assertEqual(antes["linked_entity_id"], ator)

        resp = self.client.patch(f"/api/entities/{personagem}", json={"linked_entity_id": None})
        self.assertEqual(resp.status_code, 200)
        with get_db() as conn:
            depois = conn.execute("SELECT linked_entity_id FROM entity WHERE id = ?", (personagem,)).fetchone()
        self.assertIsNone(depois["linked_entity_id"], "linked_entity_id: null precisa desvincular, nao ser ignorado")

    def test_patch_linked_entity_id_de_outro_projeto_e_rejeitado(self):
        outro_projeto = add_project("Outro Projeto Merge", "", "")
        with get_db() as conn:
            estranho = EntityRepository.upsert_entity(conn, outro_projeto, "Entidade De Outro Projeto", "person", "")
            conn.commit()
        personagem = self._new_entity("Vitima De Vinculo Cruzado")

        resp = self.client.patch(f"/api/entities/{personagem}", json={"linked_entity_id": estranho})
        self.assertEqual(resp.status_code, 400)

    def test_patch_realm_invalido_e_rejeitado(self):
        eid = self._new_entity("Alvo Realm Invalido")
        resp = self.client.patch(f"/api/entities/{eid}", json={"realm": "inexistente"})
        self.assertEqual(resp.status_code, 400)

    def test_patch_payload_vazio_e_rejeitado(self):
        eid = self._new_entity("Alvo Payload Vazio")
        resp = self.client.patch(f"/api/entities/{eid}", json={})
        self.assertEqual(resp.status_code, 400)

    def test_merge_endpoint_feliz(self):
        source = self._new_entity("JONATHAN")
        target = self._new_entity("Jonathan Moris")
        resp = self.client.post("/api/entities/merge", json={
            "project_id": self.project_id, "source_id": source, "target_id": target,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["target_id"], target)
        with get_db() as conn:
            row = conn.execute("SELECT id FROM entity WHERE id = ?", (source,)).fetchone()
        self.assertIsNone(row)

    def test_merge_endpoint_mesma_entidade_400(self):
        eid = self._new_entity("Sozinha Na Rota")
        resp = self.client.post("/api/entities/merge", json={
            "project_id": self.project_id, "source_id": eid, "target_id": eid,
        })
        self.assertEqual(resp.status_code, 400)

    def test_list_entities_expoe_campos_novos(self):
        ator = self._new_entity("Ator Listagem Teste")
        personagem = self._new_entity("Personagem Listagem Teste")
        self.client.patch(f"/api/entities/{personagem}", json={"linked_entity_id": ator, "role": "Protagonista"})

        resp = self.client.get(f"/api/entities/project/{self.project_id}")
        entry = next(e for e in resp.json()["entities"] if e["id"] == personagem)
        self.assertEqual(entry["linked_entity_id"], ator)
        self.assertEqual(entry["linked_entity_name"], "Ator Listagem Teste")
        self.assertEqual(entry["role"], "Protagonista")
        self.assertEqual(entry["realm"], "production")


class TestE3CGetKnownNames(unittest.TestCase):
    """get_known_names (E-A3): personagem de ficcao nao existe fisicamente, entao
    fica de fora do vocabulario de reconhecimento visual -- so o ATOR (realm=
    production) pode ser "reconhecido" numa imagem. Objeto/locacao de realm='story'
    (props e cenarios do roteiro) continuam entrando: esses existem no set."""

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_e3c_knownnames_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_knownnames.db"
        init_db(CONFIG.DB_PATH)
        cls.project_id = add_project("Teste KnownNames", "", "")

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def test_personagem_story_confirmado_fica_de_fora(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Personagem Ficticio", "person", "", realm="story")
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertNotIn("Personagem Ficticio", names)

    def test_pessoa_production_confirmada_entra(self):
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Pessoa Real Equipe", "person", "", realm="production")
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Pessoa Real Equipe", names)

    def test_locacao_e_objeto_story_confirmados_entram(self):
        """Diferente de pessoa: prop e cenario existem fisicamente no set, entao
        'reconhecer' visualmente faz sentido mesmo sendo realm=story."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Envelope Do Roteiro", "object", "", realm="story")
            EntityRepository.upsert_entity(conn, self.project_id, "Casa Do Roteiro", "location", "", realm="story")
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Envelope Do Roteiro", names)
        self.assertIn("Casa Do Roteiro", names)

    def test_cenario_real_daniel_convivendo_sem_colisao(self):
        """O caso que motivou toda a mudanca: personagem 'Daniel' (story) fica fora
        do vocabulario; 'Daniel Ator' (production, rosto real) entra normalmente."""
        with get_db() as conn:
            EntityRepository.upsert_entity(conn, self.project_id, "Daniel", "person", "", realm="story")
            EntityRepository.upsert_entity(conn, self.project_id, "Daniel Ator", "person", "", realm="production")
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertNotIn("Daniel", names)
        self.assertIn("Daniel Ator", names)

    def test_face_gallery_person_nao_e_afetada_pelo_realm(self):
        """A tabela person (galeria de rostos) nao tem conceito de realm -- sempre
        representa gente real. Este branch da UNION continua intocado."""
        with get_db() as conn:
            conn.execute(
                "INSERT INTO person (project_id, name) VALUES (?, ?)",
                (self.project_id, "Pessoa Da Galeria De Rostos")
            )
            conn.commit()
            names = [n["name"] for n in EntityRepository.get_known_names(conn, self.project_id)]
        self.assertIn("Pessoa Da Galeria De Rostos", names)


if __name__ == "__main__":
    unittest.main()
