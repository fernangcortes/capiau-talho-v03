"""Testes do histórico de decupagem editorial (Entrega A, 22/08/2026):
- A1: captura automática em MediaRepository antes de cada sobrescrita, as duas
  regras de higiene (versão vazia / nada mudou), poda e cascata no DELETE.
- A2: rotas de leitura e restauração, incluindo os 404.

O motivo de existir: o pipeline chamava update_video_metadata ao final de cada
transcrição e regravava description/summary/tags incondicionalmente. Doze títulos
corrigidos à mão foram sobrescritos numa rodada só. Ver
docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md.

Banco temporário isolado. As rotas são chamadas como funções (recebem a conexão
por Depends) para não subir TestClient nem encostar em Qdrant.
"""
import shutil
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from src.config import CONFIG
from src.db.schema import init_db
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.api.routes.media import list_video_metadata_history, restore_video_metadata_version


class TestMetadataHistory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_metadata_history_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_metadata_history.db"
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        """Cada teste começa com um vídeo novo, sem histórico."""
        self.ctx = get_db(CONFIG.DB_PATH)
        self.conn = self.ctx.__enter__()
        cur = self.conn.cursor()
        cur.execute("INSERT OR IGNORE INTO project (id, name) VALUES (1, 'Teste')")
        cur.execute(
            "INSERT INTO video (project_id, filename, filepath, hash, status) VALUES (1,?,?,?,'ingested')",
            (f"v{id(self)}.mp4", f"/x/v{id(self)}.mp4", f"hash_{id(self)}")
        )
        self.vid = cur.lastrowid
        self.conn.commit()

    def tearDown(self):
        self.ctx.__exit__(None, None, None)

    # ── A1: captura automática ───────────────────────────────────────────────

    def test_primeira_gravacao_nao_gera_lixo(self):
        """Vídeo sem decupagem nenhuma não deve virar uma versão vazia no histórico."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        self.assertEqual(MediaRepository.list_metadata_history(self.conn, self.vid), [])

    def test_sobrescrita_arquiva_versao_anterior(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")

        hist = MediaRepository.list_metadata_history(self.conn, self.vid)
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["title"], "T1")
        self.assertEqual(hist[0]["description"], "D1")
        self.assertEqual(hist[0]["tags"], ["a"], "tags voltam como lista, não como JSON cru")
        self.assertEqual(hist[0]["origem"], "ia")

    def test_regravar_identico_nao_duplica(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        self.assertEqual(len(MediaRepository.list_metadata_history(self.conn, self.vid)), 1)

    def test_titulo_vazio_preserva_o_atual_e_nao_conta_como_mudanca(self):
        """Em update_video_metadata, título vazio cai no COALESCE/NULLIF e mantém o atual."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="")

        atual = self.conn.execute("SELECT title FROM video WHERE id=?", (self.vid,)).fetchone()[0]
        self.assertEqual(atual, "T2")
        self.assertEqual(len(MediaRepository.list_metadata_history(self.conn, self.vid)), 1)

    def test_edicao_manual_de_titulo_tambem_arquiva(self):
        """update_video_title é o segundo caminho de escrita (edição inline do inspetor)."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_title(self.conn, self.vid, "Corrigido à mão")

        hist = MediaRepository.list_metadata_history(self.conn, self.vid)
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["title"], "T1")
        self.assertEqual(hist[0]["origem"], "ia", "a versão arquivada guarda quem a escreveu")

        origem = self.conn.execute(
            "SELECT metadata_origem FROM video WHERE id=?", (self.vid,)
        ).fetchone()[0]
        self.assertEqual(origem, "humano")

    def test_titulo_vazio_em_update_video_title_e_literal(self):
        """Ali o valor é gravado como veio — inclusive vazio —, então tem de arquivar."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_title(self.conn, self.vid, "")

        atual = self.conn.execute("SELECT title FROM video WHERE id=?", (self.vid,)).fetchone()[0]
        self.assertEqual(atual, "")
        hist = MediaRepository.list_metadata_history(self.conn, self.vid)
        self.assertEqual(len(hist), 1)
        self.assertEqual(hist[0]["title"], "T1")

    def test_regeneracao_em_lote_nao_vira_humano(self):
        """A regeneração de títulos do pipeline é IA e passa origem explícita."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_title(self.conn, self.vid, "Título em lote", origem="ia")

        origem = self.conn.execute(
            "SELECT metadata_origem FROM video WHERE id=?", (self.vid,)
        ).fetchone()[0]
        self.assertEqual(origem, "ia")

    def test_cenario_real_pipeline_sobrescreve_titulo_humano(self):
        """O bug de 22/08: a IA regrava por cima da correção manual."""
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_title(self.conn, self.vid, "Bayard")
        MediaRepository.update_video_metadata(self.conn, self.vid, "Desc IA", "Res IA", ["ia"], title="Baiar")

        hist = MediaRepository.list_metadata_history(self.conn, self.vid)
        self.assertEqual(hist[0]["title"], "Bayard")
        self.assertEqual(hist[0]["origem"], "humano")

    def test_poda_mantem_apenas_as_n_ultimas(self):
        for i in range(MediaRepository.METADATA_HISTORY_KEEP + 12):
            MediaRepository.update_video_metadata(self.conn, self.vid, f"D{i}", f"S{i}", [f"t{i}"], title=f"T{i}")

        total = self.conn.execute(
            "SELECT COUNT(*) FROM video_metadata_history WHERE video_id=?", (self.vid,)
        ).fetchone()[0]
        self.assertEqual(total, MediaRepository.METADATA_HISTORY_KEEP)

    def test_delete_do_video_leva_o_historico(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        self.conn.execute("DELETE FROM video WHERE id=?", (self.vid,))

        restante = self.conn.execute(
            "SELECT COUNT(*) FROM video_metadata_history WHERE video_id=?", (self.vid,)
        ).fetchone()[0]
        self.assertEqual(restante, 0)

    # ── A2: rotas ────────────────────────────────────────────────────────────

    def test_rota_lista_atual_e_versoes(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")

        resp = list_video_metadata_history(self.vid, limit=50, conn=self.conn)
        self.assertEqual(resp["atual"]["title"], "T2")
        self.assertEqual(resp["atual"]["origem"], "ia")
        self.assertNotIn("metadata_origem", resp["atual"], "coluna interna sai como 'origem'")
        self.assertEqual(len(resp["versions"]), 1)
        self.assertEqual(resp["versions"][0]["title"], "T1")

    def test_rota_lista_404_em_video_inexistente(self):
        with self.assertRaises(HTTPException) as ctx:
            list_video_metadata_history(999999, limit=50, conn=self.conn)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_rota_restaura_e_mantem_reversivel(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        alvo = MediaRepository.list_metadata_history(self.conn, self.vid)[0]["id"]

        res = restore_video_metadata_version(self.vid, alvo, conn=self.conn)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["restored_from"], alvo)
        self.assertEqual(res["video"]["title"], "T1")
        self.assertEqual(res["video"]["tags"], ["a"])
        self.assertEqual(res["video"]["origem"], "humano")

        # A versão que estava no ar foi para o histórico: dá para voltar atrás
        titulos = [v["title"] for v in MediaRepository.list_metadata_history(self.conn, self.vid)]
        self.assertIn("T2", titulos)

    def test_rota_restaura_404_em_versao_de_outro_video(self):
        MediaRepository.update_video_metadata(self.conn, self.vid, "D1", "S1", ["a"], title="T1")
        MediaRepository.update_video_metadata(self.conn, self.vid, "D2", "S2", ["b"], title="T2")
        alvo = MediaRepository.list_metadata_history(self.conn, self.vid)[0]["id"]

        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO video (project_id, filename, filepath, hash, status) VALUES (1,?,?,?,'ingested')",
            (f"outro{id(self)}.mp4", f"/x/outro{id(self)}.mp4", f"outro_{id(self)}")
        )
        outro = cur.lastrowid

        with self.assertRaises(HTTPException) as ctx:
            restore_video_metadata_version(outro, alvo, conn=self.conn)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_rota_restaura_404_em_historico_inexistente(self):
        with self.assertRaises(HTTPException) as ctx:
            restore_video_metadata_version(self.vid, 888888, conn=self.conn)
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
