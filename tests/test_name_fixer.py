"""Testes da correção de nome próprio (22/08/2026).

Por que existe: o ASR erra nome próprio e o resumo automático herda o erro.
Como generate_video_summary reescreve title/description/summary/tags a cada
transcrição, corrigir depois não resolve — o erro volta no reprocessamento
seguinte. Desde 22/08 a correção roda ANTES da gravação, dentro do pipeline.

Caso real que motivou: re-transcrever o vídeo 13 trocou "Jones Schneider" por
"Johnny Schneider" e "Thiago Moyses" por "Tiago Moisés".

Ver src/nlp/name_fixer.py e docs/PLANO_HISTORICO_METADADOS_E_WORKER_ASR.md.
"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from src.config import CONFIG
from src.db.connection import get_db
from src.db.schema import init_db
from src.nlp.name_fixer import (
    GRAFIAS_ERRADAS,
    carregar_regras,
    corrigir_decupagem,
    corrigir_tags,
    corrigir_texto,
    resumir_trocas,
    semear,
)


class TestNameFixer(unittest.TestCase):

    def test_corrige_e_relata_a_troca(self):
        saida, trocas = corrigir_texto("Baiar fala do personagem", "summary")
        self.assertEqual(saida, "Bayard fala do personagem")
        self.assertEqual(trocas, [("summary", "Baiar", "Bayard")])

    def test_texto_certo_passa_intacto(self):
        saida, trocas = corrigir_texto("Bayard fala do personagem")
        self.assertEqual(saida, "Bayard fala do personagem")
        self.assertEqual(trocas, [])

    def test_nome_composto_vem_antes_do_primeiro_nome(self):
        """A ordem do mapa importa: senão 'Johnny Schneider' viraria 'Jones Schneider'
        pela metade, ou 'Jones' sobrando com o sobrenome errado."""
        saida, _ = corrigir_texto("Johnny Schneider é o ator")
        self.assertEqual(saida, "Jones Schneider é o ator")

    def test_primeiro_nome_sozinho_tambem_corrige(self):
        saida, _ = corrigir_texto("O Johnny chegou")
        self.assertEqual(saida, "O Jones chegou")

    def test_nao_casa_dentro_de_outra_palavra(self):
        """As chaves usam \\b justamente para não estragar palavra maior."""
        saida, trocas = corrigir_texto("Baiarque não é nome de ninguém")
        self.assertEqual(saida, "Baiarque não é nome de ninguém")
        self.assertEqual(trocas, [])

    def test_caso_real_do_video_13(self):
        saida, _ = corrigir_texto("Johnny Schneider, ator, fala do diretor Tiago Moisés")
        self.assertEqual(saida, "Jones Schneider, ator, fala do diretor Thiago Moyses")

    def test_brincadeira_tomada_como_fato_e_removida(self):
        """A entrevistada emenda 'Mentira' logo depois; a IA gravou como fato."""
        saida, _ = corrigir_texto("Suzana (Pamela Sheila) é a AD")
        self.assertEqual(saida, "Suzana é a AD")

    def test_valor_nao_texto_volta_intacto(self):
        """A IA às vezes devolve None ou número no lugar de string."""
        for valor in (None, "", 42, [], {}):
            saida, trocas = corrigir_texto(valor)
            self.assertEqual(saida, valor)
            self.assertEqual(trocas, [])

    def test_tags_preservam_o_tipo_lista(self):
        saida, trocas = corrigir_tags(["Johnny Schneider", "arte", "Baiar"])
        self.assertEqual(saida, ["Jones Schneider", "arte", "Bayard"])
        self.assertEqual(len(trocas), 2)

    def test_tags_como_json_cru_tambem_funcionam(self):
        """O script retroativo corrige a coluna `tags` sem desserializar, para
        preservar o formato exato do JSON gravado."""
        saida, _ = corrigir_tags('["Johnny Schneider", "arte"]')
        self.assertEqual(saida, '["Jones Schneider", "arte"]')

    def test_decupagem_inteira_de_uma_vez(self):
        title, desc, summary, tags, trocas = corrigir_decupagem(
            title="Johnny Schneider sobre Sandro",
            description="Dirigido por Tiago Moisés",
            summary="Baiar e Yasmin no set",
            tags=["Johnny Schneider", "elenco"],
        )
        self.assertEqual(title, "Jones Schneider sobre Sandro")
        self.assertEqual(desc, "Dirigido por Thiago Moyses")
        self.assertEqual(summary, "Bayard e Yasmim no set")
        self.assertEqual(tags, ["Jones Schneider", "elenco"])
        self.assertEqual(len(trocas), 5)

    def test_decupagem_sem_erro_nao_reporta_troca(self):
        """Sem trocas o pipeline não imprime nada — e nada muda na gravação."""
        _, _, _, _, trocas = corrigir_decupagem(
            title="Jones Schneider", description="ok", summary="ok", tags=["arte"]
        )
        self.assertEqual(trocas, [])

    def test_corrigir_duas_vezes_e_estavel(self):
        """Rodar o script sobre texto já corrigido não pode mudar mais nada."""
        uma, _ = corrigir_texto("Johnny Schneider e Baiar")
        duas, trocas = corrigir_texto(uma)
        self.assertEqual(uma, duas)
        self.assertEqual(trocas, [])

    def test_resumo_das_trocas_e_legivel(self):
        _, trocas = corrigir_texto("Baiar", "title")
        self.assertEqual(resumir_trocas(trocas), "title: Baiar -> Bayard")

    def test_mapa_nao_tem_chave_vazia(self):
        for padrao, certo in GRAFIAS_ERRADAS.items():
            self.assertTrue(padrao.strip(), "padrão vazio casaria com tudo")
            self.assertIsInstance(certo, str)


class TestRegrasDoBanco(unittest.TestCase):
    """As regras saem dos `aliases` de entity/person, não de constante no código.

    O ganho: cadastrar um nome novo deixa de exigir mexer em código. Banco
    temporário; nenhum teste aqui toca no acervo real.
    """

    @classmethod
    def setUpClass(cls):
        cls.test_dir = Path(tempfile.mkdtemp(prefix="capiau_name_fixer_"))
        cls.original_db = CONFIG.DB_PATH
        CONFIG.DB_PATH = cls.test_dir / "test_names.db"
        init_db(CONFIG.DB_PATH)

    @classmethod
    def tearDownClass(cls):
        CONFIG.DB_PATH = cls.original_db
        shutil.rmtree(cls.test_dir, ignore_errors=True)

    def setUp(self):
        self.ctx = get_db(CONFIG.DB_PATH)
        self.conn = self.ctx.__enter__()
        self.conn.execute("INSERT OR IGNORE INTO project (id, name) VALUES (1, 'Teste')")
        self.conn.execute("DELETE FROM person WHERE project_id = 1")
        self.conn.execute("DELETE FROM entity WHERE project_id = 1")
        self.conn.commit()

    def tearDown(self):
        self.ctx.__exit__(None, None, None)

    def pessoa(self, nome, aliases=None):
        self.conn.execute(
            "INSERT INTO person (project_id, name, aliases) VALUES (1, ?, ?)",
            (nome, json.dumps(aliases, ensure_ascii=False) if aliases is not None else None),
        )
        self.conn.commit()

    def entidade(self, nome, aliases=None, status="confirmed"):
        self.conn.execute(
            "INSERT INTO entity (project_id, name, entity_type, status, aliases) "
            "VALUES (1, ?, 'person', ?, ?)",
            (nome, status, json.dumps(aliases, ensure_ascii=False) if aliases is not None else None),
        )
        self.conn.commit()

    # ── Origem das regras ────────────────────────────────────────────────────

    def test_sem_alias_nenhum_cai_na_semente(self):
        """Projeto novo ainda não semeado: deixar de corrigir seria pior."""
        self.pessoa("Bayard Tonelli")
        regras = carregar_regras(1, self.conn)
        saida, _ = corrigir_texto("Baiar chegou", "t", regras)
        self.assertEqual(saida, "Bayard chegou")

    def test_alias_em_texto_troca_pelo_nome_da_linha(self):
        self.pessoa("Thiago Moyses", ["Tiago Moisés"])
        regras = carregar_regras(1, self.conn)
        saida, trocas = corrigir_texto("O diretor Tiago Moisés", "t", regras)
        self.assertEqual(saida, "O diretor Thiago Moyses")
        self.assertEqual(trocas, [("t", "Tiago Moisés", "Thiago Moyses")])

    def test_alias_explicito_manda_no_substituto(self):
        """O nome do catálogo tem sufixo de função ("Jones Ator") e não serve em
        prosa; por isso o alias pode dizer o que escrever."""
        self.pessoa("Jones Ator", [{"errado": "Johnny", "certo": "Jones"}])
        regras = carregar_regras(1, self.conn)
        saida, _ = corrigir_texto("O ator Johnny falou", "t", regras)
        self.assertEqual(saida, "O ator Jones falou")
        self.assertNotIn("Jones Ator", saida)

    def test_alias_pode_ser_regex(self):
        self.pessoa("Virshna Arte", [{"errado": "Virg[íi]nia", "certo": "Virshna", "regex": True}])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Virginia e Virgínia", "t", regras)[0], "Virshna e Virshna")

    def test_alias_literal_nao_e_interpretado_como_regex(self):
        """Nome com parêntese/ponto não pode virar metacaractere."""
        self.pessoa("Ana (Som)", ["A.a"])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Aba veio", "t", regras)[0], "Aba veio")
        self.assertEqual(corrigir_texto("A.a veio", "t", regras)[0], "Ana (Som) veio")

    def test_entidade_sugerida_e_ignorada(self):
        """`suggested` é palpite da própria IA — não pode reescrever texto."""
        self.entidade("Alfredo Degaré", ["ALFREDO"], status="suggested")
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("ALFREDO entrou", "t", regras)[0], "ALFREDO entrou")

    def test_entidade_confirmada_vale(self):
        self.entidade("Alfredo Degaré", ["ALFREDO"], status="confirmed")
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("ALFREDO entrou", "t", regras)[0], "Alfredo Degaré entrou")

    def test_nome_composto_vem_antes_do_curto(self):
        """Ordem por tamanho: senão "Johnny Schneider" vira "Jones Schneider" pela metade."""
        self.pessoa("Jones Ator", [
            {"errado": "Johnny", "certo": "Jones"},
            {"errado": "Johnny Schneider", "certo": "Jones Schneider"},
        ])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(
            corrigir_texto("Johnny Schneider veio", "t", regras)[0],
            "Jones Schneider veio",
        )

    def test_regra_geral_sempre_vale(self):
        """A remoção da brincadeira não é apelido de pessoa e não cabe em aliases."""
        self.pessoa("Suzana", ["Susana"])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Suzana (Pamela Sheila) é a AD", "t", regras)[0],
                         "Suzana é a AD")

    def test_alias_ilegivel_nao_derruba_a_rodada(self):
        self.conn.execute(
            "INSERT INTO person (project_id, name, aliases) VALUES (1, 'X', 'nao e json')")
        self.pessoa("Thiago Moyses", ["Tiago Moisés"])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Tiago Moisés", "t", regras)[0], "Thiago Moyses")

    def test_regex_invalido_no_banco_nao_derruba(self):
        self.pessoa("Y", [{"errado": "[", "certo": "Z", "regex": True}])
        self.pessoa("Thiago Moyses", ["Tiago Moisés"])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Tiago Moisés", "t", regras)[0], "Thiago Moyses")

    def test_alias_vazio_e_descartado(self):
        """Alias vazio viraria \\b\\b e casaria em todo lugar."""
        self.pessoa("Z", ["", "   ", None, 42])
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("texto qualquer", "t", regras)[0], "texto qualquer")

    # ── Semeadura ────────────────────────────────────────────────────────────

    def test_semear_escolhe_o_dono_por_sobreposicao(self):
        """Com "primeiro que bate", a regra de Thiago ia parar em Cristina Moyses."""
        self.pessoa("Cristina Moyses")
        self.pessoa("Thiago Moyses")
        resultado = semear(self.conn, 1, "person", aplicar=False)
        donos = {certo: dono for _, certo, dono in resultado["casadas"]}
        self.assertEqual(donos.get("Thiago Moyses"), "Thiago Moyses")

    def test_semear_grava_e_e_idempotente(self):
        self.pessoa("Bayard Tonelli")
        primeira = semear(self.conn, 1, "person", aplicar=True)
        self.assertGreater(primeira["gravadas"], 0)

        segunda = semear(self.conn, 1, "person", aplicar=True)
        self.assertEqual(segunda["gravadas"], 0, "rodar de novo não duplica regra")

    def test_semear_relata_o_que_ficou_sem_dono(self):
        """Sem ninguém no catálogo, tudo fica órfão — e o script avisa em vez de
        inventar dono."""
        resultado = semear(self.conn, 1, "person", aplicar=False)
        self.assertEqual(resultado["casadas"], [])
        self.assertTrue(resultado["orfas"])

    def test_semeado_passa_a_valer_sem_mexer_em_codigo(self):
        self.pessoa("Bayard Tonelli")
        semear(self.conn, 1, "person", aplicar=True)
        regras = carregar_regras(1, self.conn)
        self.assertEqual(corrigir_texto("Baiar chegou", "t", regras)[0], "Bayard chegou")


if __name__ == "__main__":
    unittest.main()
