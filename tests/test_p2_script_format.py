"""Testes da deteccao em cascata do formato de roteiro (P2.1a, Commit 2).

Modulo puro: nao toca em banco, Qdrant nem API. A deteccao por LLM (camada 3) e
mockada quando exercitada -- nenhum teste faz chamada de rede.

Os numeros de calibracao citados aqui foram medidos no roteiro real do projeto
(doc id 3, 130.603 chars, 111 cenas), nao chutados.
"""
import unittest
from unittest.mock import patch

from src.services.script_format import (
    detect_structure,
    validate_segmentation,
    segment_stats,
    _extract_anchors,
    CANDIDATE_PATTERNS,
)

CORPO = "\n".join([
    "Daniel entra na sala e olha pela janela.",
    "",
    "DANIEL",
    "Alguem esteve aqui.",
    "",
    "Ele caminha ate a mesa e pega o envelope.",
    "",
])


def _roteiro(headings, corpo=CORPO):
    """Monta um roteiro sintetico com os cabecalhos dados."""
    return "\n".join(f"{h}\n\n{corpo}" for h in headings)


class TestVariantesDeFormatacao(unittest.TestCase):
    """A tabela de variantes que quebrava o regex unico do plano original.

    Cada uma destas linhas falhava com `^\\s*(INT|EXT|INT/EXT|I/E)[.\\s]`, exceto as
    duas ultimas. Todas precisam funcionar agora.
    """

    def _detecta(self, headings, filename="roteiro.txt"):
        texto = _roteiro(headings)
        return detect_structure(texto, filename, allow_llm=False)

    def test_slugline_padrao(self):
        r = self._detecta(["INT. CASA DO ENGEL - NOITE", "EXT. A COLINA - CHUVA - NOITE",
                           "INT. CARRO DO DANIEL - NOITE", "EXT. VARANDA - DIA"])
        self.assertEqual(r.strategy, "sluglines")
        self.assertEqual(r.scene_count, 4)
        self.assertFalse(r.needs_review)

    def test_fdx_achatado_pelo_upload(self):
        """O .fdx e o formato com a melhor estrutura (o Final Draft marca cada paragrafo)
        e era o UNICO que o desenho anterior quebrava por completo: o upload grava
        'SCENE HEADING: INT. ...' e um regex ancorado em INT/EXT nunca casaria."""
        r = self._detecta([
            "SCENE HEADING: INT. CASA DO ENGEL - NOITE",
            "SCENE HEADING: EXT. A COLINA - NOITE",
            "SCENE HEADING: INT. COZINHA - DIA",
            "SCENE HEADING: EXT. VARANDA - DIA",
        ], filename="roteiro.fdx")
        self.assertEqual(r.strategy, "fdx")
        self.assertEqual(r.scene_count, 4)
        self.assertEqual(r.anchors[0]["heading"], "INT. CASA DO ENGEL - NOITE")

    def test_portugues_por_extenso(self):
        r = self._detecta(["INTERIOR - CASA DO ENGEL - NOITE", "EXTERIOR - A COLINA - NOITE",
                           "INTERIOR - COZINHA - DIA", "EXTERIOR - VARANDA - DIA"])
        self.assertEqual(r.scene_count, 4)
        self.assertFalse(r.needs_review)

    def test_roteiro_numerado(self):
        """Qualquer draft que passou por producao tem numero de cena."""
        r = self._detecta(["12. INT. CASA DO ENGEL - NOITE", "13. EXT. A COLINA - NOITE",
                           "14. INT. COZINHA - DIA", "15. EXT. VARANDA - DIA"])
        self.assertEqual(r.scene_count, 4)
        self.assertFalse(r.needs_review)

    def test_numero_nas_duas_margens(self):
        r = self._detecta(["12  INT. CASA DO ENGEL - NOITE          12",
                           "13  EXT. A COLINA - NOITE               13",
                           "14  INT. COZINHA - DIA                  14",
                           "15  EXT. VARANDA - DIA                  15"])
        self.assertEqual(r.scene_count, 4)
        # O numero da margem direita nao pode sujar o texto do heading: ele vira
        # scene.heading e alimenta as queries de busca do P3.
        self.assertEqual(r.anchors[0]["heading"], "INT. CASA DO ENGEL - NOITE")

    def test_margem_direita_nao_mutila_cena_numerada(self):
        """O strip do numero de margem exige 2+ espacos antes -- 'CENA 12' fica intacto."""
        r = self._detecta(["CENA 12", "CENA 13", "CENA 14", "CENA 15"])
        self.assertEqual(r.strategy, "cena_numerada")
        self.assertEqual(r.anchors[0]["heading"], "CENA 12")

    def test_fountain_heading_forcado(self):
        r = self._detecta([".DE VOLTA A COLINA", ".NA MANHA SEGUINTE",
                           ".TRES ANOS DEPOIS", ".O ULTIMO DIA"], filename="roteiro.fountain")
        self.assertEqual(r.strategy, "fountain")
        self.assertEqual(r.scene_count, 4)
        self.assertEqual(r.anchors[0]["heading"], "DE VOLTA A COLINA")

    def test_fountain_misto_pega_sluglines_e_forcados(self):
        """Um .fountain real MISTURA os dois estilos. Antes da correção, o padrão que só
        via headings forçados pegava 3 de 12 cenas e o bônus de formato nativo fazia
        essa detecção esparsa VENCER a de sluglines — buraco silencioso."""
        headings = [f".FLASHBACK {i}" if i % 4 == 0 else f"INT. SALA {i} - DIA"
                    for i in range(1, 13)]
        r = self._detecta(headings, filename="roteiro.fountain")
        self.assertEqual(r.strategy, "fountain")
        self.assertEqual(r.scene_count, 12)
        self.assertFalse(r.needs_review)

    def test_ponto_no_inicio_em_txt_nao_e_fountain(self):
        """Linha começando com ponto num .txt qualquer (ex: nomes de arquivo) não pode
        virar cena: o candidato fountain só roda em arquivos .fountain."""
        corpo_com_dots = CORPO + "\n.gitignore\n.env na raiz do projeto\n"
        texto = "\n".join(f"INT. LOCACAO {i} - DIA\n\n{corpo_com_dots}" for i in range(1, 7))
        r = detect_structure(texto, "roteiro.txt", allow_llm=False)
        self.assertEqual(r.strategy, "sluglines")
        self.assertEqual(r.scene_count, 6)

    def test_establishing_shot(self):
        r = self._detecta(["EST. A COLINA - AMANHECER", "INT. CASA - DIA",
                           "EST. A CIDADE - TARDE", "EXT. RUA - NOITE"])
        self.assertEqual(r.scene_count, 4)

    def test_estilo_cena_numerada(self):
        r = self._detecta(["CENA 12 - CASA DO ENGEL - NOITE", "CENA 13 - A COLINA",
                           "CENA 14 - COZINHA", "CENA 15 - VARANDA"])
        self.assertEqual(r.strategy, "cena_numerada")
        self.assertEqual(r.scene_count, 4)

    def test_pdf_com_recuo(self):
        r = self._detecta(["          INT. CASA DO ENGEL - NOITE", "          EXT. A COLINA - NOITE",
                           "          INT. COZINHA - DIA", "          EXT. VARANDA - DIA"])
        self.assertEqual(r.scene_count, 4)

    def test_minusculas(self):
        r = self._detecta(["Int. Casa do Engel - Noite", "Ext. A Colina - Noite",
                           "Int. Cozinha - Dia", "Ext. Varanda - Dia"])
        self.assertEqual(r.scene_count, 4)

    def test_markdown_de_tratamento(self):
        r = self._detecta(["## Abertura na colina", "## A chegada de Daniel",
                           "## O envelope", "## Desfecho"], filename="tratamento.md")
        self.assertEqual(r.strategy, "markdown")
        self.assertEqual(r.scene_count, 4)


class TestNumeracaoDeterministica(unittest.TestCase):
    def test_numeracao_e_por_posicao_nao_pelo_texto(self):
        """O roteiro real nao tem numero nenhum no texto e repete cabecalhos identicos
        (INT. CARRO DO DANIEL - CHUVA - NOITE aparece 2x). A identidade da cena e a
        posicao, nunca o texto do cabecalho."""
        r = detect_structure(_roteiro([
            "INT. CARRO DO DANIEL - CHUVA - NOITE",
            "EXT. A COLINA - NOITE",
            "INT. CARRO DO DANIEL - CHUVA - NOITE",
            "EXT. VARANDA - DIA",
        ]), "roteiro.txt", allow_llm=False)

        self.assertEqual([a["number"] for a in r.anchors], [1, 2, 3, 4])
        self.assertEqual(r.anchors[0]["heading"], r.anchors[2]["heading"])
        self.assertNotEqual(r.anchors[0]["start"], r.anchors[2]["start"])

    def test_numeracao_ignora_o_numero_escrito_no_roteiro(self):
        """Roteiro numerado a partir de 12: as cenas viram 1..N mesmo assim, porque
        numeracao de roteiro pula, repete e recomeca em drafts revisados."""
        r = detect_structure(_roteiro([
            "12. INT. CASA - NOITE", "13. EXT. COLINA - NOITE",
            "13A. INT. COZINHA - DIA", "14. EXT. VARANDA - DIA",
        ]), "roteiro.txt", allow_llm=False)
        self.assertEqual([a["number"] for a in r.anchors], [1, 2, 3, 4])

    def test_ancoras_cobrem_o_texto_sem_buraco(self):
        texto = _roteiro(["INT. A - DIA", "INT. B - DIA", "INT. C - DIA"])
        r = detect_structure(texto, "roteiro.txt", allow_llm=False)
        for i, a in enumerate(r.anchors[:-1]):
            self.assertEqual(a["end"], r.anchors[i + 1]["start"])
        self.assertEqual(r.anchors[-1]["end"], len(texto))


class TestValidacao(unittest.TestCase):
    """A camada que faltava no desenho original: reprovar segmentacao implausivel."""

    def test_reprova_cenas_grandes_demais(self):
        """O modo de falha perigoso: poucos cabecalhos reconhecidos produzem blocos
        gigantes. Medido no roteiro real, a versao quebrada dava mediana de 10.810
        chars contra 610 da segmentacao correta."""
        conteudo = "INT. UNICA - DIA\n" + ("Texto de acao muito longo. " * 900)
        anchors = _extract_anchors(conteudo, next(p for p in CANDIDATE_PATTERNS if p["id"] == "sluglines")["regex"])
        ok, issues, stats = validate_segmentation(anchors, conteudo)
        self.assertFalse(ok)
        self.assertTrue(any("grandes demais" in i or "poucas cenas" in i for i in issues))

    def test_dispersao_sozinha_nao_serve_de_criterio(self):
        """Achado da calibracao: a segmentacao QUEBRADA tinha dispersao MENOR (2,9) que a
        correta (9,3) -- juntar tudo em poucos blocos deixa o resultado mais 'uniforme'.
        Por isso o discriminador principal e a mediana, nao a dispersao, e o limite de
        dispersao ficou folgado (25) para nao reprovar roteiro bom: uma cena longa no
        meio de cenas curtas e normal (no roteiro real, 5.663 chars contra mediana 610)."""
        saudavel = _roteiro(["INT. A - DIA"] * 20) + ("cauda longa de acao. " * 70)
        anchors = _extract_anchors(saudavel, next(p for p in CANDIDATE_PATTERNS if p["id"] == "sluglines")["regex"])
        stats = segment_stats(anchors, saudavel)
        self.assertGreater(stats["ratio"], 8.0, "fixture precisa ter dispersao acima do limite antigo")
        ok, issues, _ = validate_segmentation(anchors, saudavel)
        self.assertTrue(ok, f"roteiro saudavel com uma cena longa nao pode reprovar: {issues}")

    def test_reprova_cobertura_baixa(self):
        conteudo = ("Prosa solta sem cabecalho nenhum. " * 500) + "\nINT. A - DIA\nfim\nINT. B - DIA\nfim\nINT. C - DIA\nfim"
        anchors = _extract_anchors(conteudo, next(p for p in CANDIDATE_PATTERNS if p["id"] == "sluglines")["regex"])
        ok, issues, _ = validate_segmentation(anchors, conteudo)
        self.assertFalse(ok)
        self.assertTrue(any("cobertura" in i for i in issues))


class TestCompeticaoEntrePadroes(unittest.TestCase):
    def test_padrao_certo_vence_o_que_casa_por_acaso(self):
        """Roteiro em CENA N com algumas mencoes soltas a INT./EXT. no meio da acao:
        sluglines casaria com poucas linhas e criaria blocos gigantes; a competicao
        precisa escolher cena_numerada."""
        blocos = []
        for i in range(1, 13):
            blocos.append(f"CENA {i} - LOCACAO {i}")
            blocos.append("Daniel atravessa o corredor.")
            if i % 6 == 0:
                blocos.append("INT. mencao solta dentro da acao - DIA")
            blocos.append("")
        texto = "\n".join(blocos)

        r = detect_structure(texto, "roteiro.txt", allow_llm=False)
        self.assertEqual(r.strategy, "cena_numerada")
        self.assertEqual(r.scene_count, 12)


class TestModoProsa(unittest.TestCase):
    def test_documento_sem_cenas_nao_ganha_cenas_inventadas(self):
        """Um tratamento ou escaleta de making-of nao tem cena. Inventar estrutura aqui
        faria o P3 sugerir material para cenas que nao existem."""
        prosa = "Este documento descreve a proposta do documentario. " * 300
        r = detect_structure(prosa, "tratamento.txt", allow_llm=False)
        self.assertEqual(r.strategy, "prose")
        self.assertEqual(r.scene_count, 0)
        self.assertFalse(r.needs_review)

    def test_documento_vazio_nao_quebra(self):
        r = detect_structure("", "vazio.txt", allow_llm=False)
        self.assertEqual(r.strategy, "prose")
        self.assertEqual(r.scene_count, 0)


class TestHeuristicaGenerica(unittest.TestCase):
    def test_caps_isolado_resolve_antes_de_gastar_llm(self):
        """Delimitador inventado, mas em maiusculas isoladas: o detector fraco de ultimo
        recurso resolve sozinho e a camada 3 (paga) nem precisa entrar. Como e o
        detector mais generico (casa tambem com nomes de personagem e transicoes),
        SEMPRE pede conferencia humana, mesmo validando."""
        texto = "\n".join(f"<<< BLOCO {i} >>>\n\nAcao da cena numero {i}.\n" for i in range(1, 13))
        r = detect_structure(texto, "estranho.txt", allow_llm=False)
        self.assertEqual(r.strategy, "caps_isolado")
        self.assertEqual(r.scene_count, 12)
        self.assertTrue(r.needs_review)


class TestDeteccaoPorLLM(unittest.TestCase):
    """Camada 3: formato que nenhuma heuristica conhece (delimitador com minusculas,
    entao nem o caps_isolado pega)."""

    TEXTO = "\n".join(f"--- Bloco {i} ---\n\nAcao da cena numero {i}.\n" for i in range(1, 13))

    def test_llm_resolve_formato_desconhecido(self):
        sem_llm = detect_structure(self.TEXTO, "estranho.txt", allow_llm=False)
        self.assertEqual(sem_llm.strategy, "prose")

        with patch("src.nlp.llm_text.call_text_llm",
                   return_value=({"regex": r"^---\s*(?P<heading>Bloco \d+)\s*---$",
                                  "explanation": "blocos delimitados por tracos"}, {})), \
             patch("src.nlp.prompt_registry.get_prompt", return_value="prompt de teste"):
            com_llm = detect_structure(self.TEXTO, "estranho.txt", allow_llm=True)

        self.assertEqual(com_llm.strategy, "llm")
        self.assertEqual(com_llm.scene_count, 12)
        self.assertTrue(com_llm.needs_review, "deteccao por LLM sempre pede conferencia humana")

    def test_regex_invalido_do_llm_nao_derruba(self):
        with patch("src.nlp.llm_text.call_text_llm",
                   return_value=({"regex": "((((sem fechar"}, {})), \
             patch("src.nlp.prompt_registry.get_prompt", return_value="prompt"):
            r = detect_structure(self.TEXTO, "estranho.txt", allow_llm=True)
        self.assertEqual(r.strategy, "prose")

    def test_llm_indisponivel_nao_derruba(self):
        with patch("src.nlp.llm_text.call_text_llm", side_effect=RuntimeError("sem rede")), \
             patch("src.nlp.prompt_registry.get_prompt", return_value="prompt"):
            r = detect_structure(self.TEXTO, "estranho.txt", allow_llm=True)
        self.assertEqual(r.strategy, "prose")

    def test_llm_devolvendo_vazio_vira_prosa(self):
        """O prompt manda devolver regex vazia quando o documento nao tem cenas."""
        with patch("src.nlp.llm_text.call_text_llm", return_value=({"regex": ""}, {})), \
             patch("src.nlp.prompt_registry.get_prompt", return_value="prompt"):
            r = detect_structure(self.TEXTO, "estranho.txt", allow_llm=True)
        self.assertEqual(r.strategy, "prose")


class TestEstrategiaForcada(unittest.TestCase):
    def test_usuario_pode_forcar_a_estrategia(self):
        """Saida de emergencia quando a deteccao automatica erra (script.anchor_strategy)."""
        texto = _roteiro(["CENA 1 - A", "CENA 2 - B", "CENA 3 - C", "CENA 4 - D"])
        r = detect_structure(texto, "roteiro.txt", forced_strategy="cena_numerada", allow_llm=False)
        self.assertEqual(r.strategy, "cena_numerada")
        self.assertEqual(r.scene_count, 4)

    def test_forcar_prosa_ignora_cabecalhos(self):
        texto = _roteiro(["INT. A - DIA", "INT. B - DIA", "INT. C - DIA"])
        r = detect_structure(texto, "roteiro.txt", forced_strategy="prose", allow_llm=False)
        self.assertEqual(r.strategy, "prose")
        self.assertEqual(r.scene_count, 0)


class TestRelatorio(unittest.TestCase):
    def test_to_dict_traz_amostra_para_a_ui(self):
        """A UI mostra 'detectei N cenas, as primeiras sao...' antes de gastar API."""
        r = detect_structure(_roteiro(["INT. A - DIA", "INT. B - DIA", "INT. C - DIA",
                                       "INT. D - DIA", "INT. E - DIA", "INT. F - DIA"]),
                             "roteiro.txt", allow_llm=False)
        d = r.to_dict()
        self.assertEqual(d["scene_count"], 6)
        self.assertEqual(len(d["sample"]), 5)
        self.assertEqual(d["sample"][0]["number"], 1)
        self.assertIn("coverage", d["stats"])


if __name__ == "__main__":
    unittest.main()
