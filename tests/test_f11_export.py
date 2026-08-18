"""Testes da exportação de timeline: escolha no diálogo e endereço da mídia (18/08/2026).

Dois defeitos corrigidos no mesmo dia:

1. A exportação mandava sempre `timelines[0]` — a de maior id, NÃO a que está na tela.
   O usuário exportou uma timeline velha achando ser a atual e só percebeu ao abrir o
   arquivo no Kdenlive. O diálogo novo mostra nome, data e `clip_count` antes de gerar.

2. O `target_url` saía como URI `file:///...` percent-encoded em TODOS os formatos. O
   importador de OTIO do Kdenlive 26.04.3 não trata isso como URI: concatena a pasta do
   projeto na frente e não decodifica, produzindo
   `C:/Users/FGC/Downloads/file:///D:/.../V%C3%ADdeos/...` e falhando ao abrir.
"""
import json
import sqlite3
import unittest
from pathlib import Path

from src.db.repositories.projects import ProjectRepository
from src.export.otio_export import _media_target_url


class TestEnderecoDaMidia(unittest.TestCase):
    """Cada formato precisa do dialeto que o seu consumidor entende."""

    CAMINHO = "D:\\makinof-monstro\\Vídeos\\MONSTRO_2026-03-13\\MONSTRO_MVI_3132.MOV"

    def test_otio_usa_caminho_absoluto_simples(self):
        # É o que o .otio leva: sem esquema de URI e sem percent-encoding.
        url = _media_target_url(self.CAMINHO, as_uri=False)
        self.assertFalse(url.startswith("file:"), f"não pode ter esquema de URI: {url}")
        self.assertNotIn("%", url, f"não pode vir percent-encoded: {url}")
        self.assertIn("Vídeos", url, "o acento precisa sobreviver literal")
        self.assertTrue(url.startswith("D:/"), f"precisa ser absoluto com drive: {url}")
        self.assertNotIn("\\", url, "barras invertidas viram barras normais")

    def test_xml_mantem_a_uri_para_premiere_e_resolve(self):
        url = _media_target_url(self.CAMINHO, as_uri=True)
        self.assertTrue(url.startswith("file:///D:/"), f"precisa ser URI absoluta: {url}")
        self.assertIn("%C3%ADdeos", url, "o acento vem percent-encoded na URI")

    def test_o_caminho_simples_aponta_de_volta_para_o_mesmo_arquivo(self):
        # Regressão do bug do Kdenlive: o endereço gravado tem que resolver para o
        # MESMO arquivo sem o editor precisar decodificar nada.
        url = _media_target_url(self.CAMINHO, as_uri=False)
        self.assertEqual(Path(url), Path(self.CAMINHO))

    def test_as_duas_formas_descrevem_o_mesmo_arquivo(self):
        import urllib.parse
        import urllib.request
        uri = _media_target_url(self.CAMINHO, as_uri=True)
        decodificado = urllib.request.url2pathname(urllib.parse.urlparse(uri).path)
        self.assertEqual(Path(decodificado), Path(_media_target_url(self.CAMINHO, as_uri=False)))


class TestContagemDeClipes(unittest.TestCase):
    """`_count_clips` precisa entender os dois formatos de sequence_json e nunca levantar."""

    def test_formato_v2_conta_a_lista_clips(self):
        seq = json.dumps({
            "version": 2,
            "fps": 25.0,
            "tracks": [{"id": "V1", "kind": "video"}],
            "clips": [{"video_id": 1}, {"video_id": 2}, {"video_id": 3}],
        })
        self.assertEqual(ProjectRepository._count_clips(seq), 3)

    def test_formato_v1_conta_a_lista_raiz(self):
        seq = json.dumps([{"video_id": 1}, {"video_id": 2}])
        self.assertEqual(ProjectRepository._count_clips(seq), 2)

    def test_v2_sem_clipes(self):
        self.assertEqual(ProjectRepository._count_clips(json.dumps({"version": 2, "clips": []})), 0)

    def test_json_corrompido_devolve_zero_em_vez_de_levantar(self):
        # Contagem é informação de tela: não pode derrubar a listagem de timelines.
        self.assertEqual(ProjectRepository._count_clips("{isso nao e json"), 0)

    def test_valores_vazios_devolvem_zero(self):
        for entrada in (None, "", "null"):
            with self.subTest(entrada=entrada):
                self.assertEqual(ProjectRepository._count_clips(entrada), 0)

    def test_clips_de_tipo_errado_devolve_zero(self):
        # 'clips' presente mas não sendo lista não pode virar TypeError no len()
        self.assertEqual(ProjectRepository._count_clips(json.dumps({"clips": "quatro"})), 0)


class TestListagemDeTimelines(unittest.TestCase):
    """`list_timelines` precisa devolver clip_count junto e não vazar o sequence_json."""

    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("""
            CREATE TABLE timeline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT,
                description TEXT,
                sequence_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.executemany(
            "INSERT INTO timeline (project_id, name, description, sequence_json) VALUES (?, ?, ?, ?)",
            [
                (7, "rascunho v1", "", json.dumps([{"video_id": 1}])),
                (7, "corte final", "", json.dumps({"version": 2, "clips": [{"video_id": 1}, {"video_id": 2}]})),
                (7, "vazia", "", json.dumps({"version": 2, "clips": []})),
                (99, "de outro projeto", "", json.dumps({"version": 2, "clips": [{"video_id": 9}]})),
            ],
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_devolve_clip_count_por_timeline(self):
        linhas = ProjectRepository.list_timelines(self.conn, 7)
        por_nome = {t["name"]: t["clip_count"] for t in linhas}
        self.assertEqual(por_nome, {"rascunho v1": 1, "corte final": 2, "vazia": 0})

    def test_nao_vaza_o_sequence_json_para_a_listagem(self):
        # A listagem alimenta um diálogo; mandar o JSON inteiro de cada timeline
        # seria carregar o acervo de cortes à toa em cada abertura.
        for t in ProjectRepository.list_timelines(self.conn, 7):
            self.assertNotIn("sequence_json", t)

    def test_filtra_por_projeto(self):
        nomes = [t["name"] for t in ProjectRepository.list_timelines(self.conn, 7)]
        self.assertNotIn("de outro projeto", nomes)

    def test_timeline_vazia_e_distinguivel_das_demais(self):
        # É exatamente o caso que passou despercebido: sem clip_count, uma timeline
        # sem cortes parecia igual a qualquer outra na hora de exportar.
        linhas = ProjectRepository.list_timelines(self.conn, 7)
        vazias = [t["name"] for t in linhas if t["clip_count"] == 0]
        self.assertEqual(vazias, ["vazia"])


if __name__ == "__main__":
    unittest.main()
