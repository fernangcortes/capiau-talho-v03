"""Testes do glossario de audio (contrato N1 de BRIEFING8).

Por que existe: este dicionario e a FONTE UNICA das explicacoes da interface
(icone (i)) e do prompt do chat. Se uma chave sumir, um campo ficar vazio, um
"relacionado" apontar para o nada ou um caractere proibido de log cp1252
(seta unicode, travessao, emoji) escapar para para_prompt(), os dois
consumidores (rota M2 e chat M5/M6) quebram juntos. Estes testes sao a cerca.

Cobertura exigida pelo contrato: todas as chaves minimas por secao; nenhum
campo vazio; relacionados existentes; secao entre as quatro validas;
para_prompt() nao vazio e menor que o glossario inteiro; e todo "na_pratica"
comecando com verbo de acao (texto que manda fazer, nao enciclopedia).

cp1252: o texto e para a TELA, entao ACENTO e esperado; o que os testes
garantem e que NAO ha emoji, seta unicode, travessao ou simbolo matematico,
nem nas strings nem em nenhum byte dos dois arquivos.
"""
import json
import re
import unittest
from pathlib import Path

from src.nlp import audio_glossario
from src.nlp.audio_glossario import (
    GLOSSARIO,
    SECOES_VALIDAS,
    entrada,
    para_prompt,
    por_secao,
)

COBERTURA_MINIMA = {
    "diagnostico": (
        "loudness", "pico_real", "clipping", "piso_ruido",
        "dinamica_lra", "correlacao_canais", "momentos_estouro",
    ),
    "aovivo": ("hpf", "eq_bandas", "gate", "compressor", "makeup"),
    "tratamento": (
        "adeclip", "adeclick", "deesser", "afftdn", "anlmdn", "speechnorm",
        "loudnorm", "alimiter", "denoise_ia", "atenuacao", "previa_15s",
        "cache_cadeia",
    ),
    "nuvem": (
        "auphonic", "leveler", "autoeq", "bwe", "studiovoice",
        "denoisemethod", "dehum", "cota",
    ),
}

# Presets moram no painel de Tratamento (secao "tratamento"), mas o contrato
# exige um grupo proprio na cobertura.
PRESETS_MINIMOS = (
    "voz_limpa", "resgate_estourado", "ambiencia_preservada", "so_entrega",
    "previa_rapida", "resgate_ia", "voz_limpa_ia",
)

CAMPOS_TEXTO = ("titulo", "resumo", "detalhe", "na_pratica")

# Primeiro verbo do "na_pratica": instrucao acionavel comeca mandando fazer.
# Chaves minusculas, sem pontuacao (o teste normaliza antes de consultar).
VERBOS_DE_ACAO = frozenset({
    "aperte", "clique", "abra", "ajuste", "comece", "suba", "deixe",
    "mantenha", "marque", "aceite", "troque", "confira", "use", "faca",
    "faça", "mude", "reserve", "escolha", "prefira", "ouviu", "olhe",
    "veja", "aplique", "quer", "nao", "não", "instale", "baixe",
    "acompanhe", "resolva", "trate", "ouca", "ouça", "salve", "ligue",
    "desligue", "evite", "mande", "envie", "teste", "aguarde", "volte",
    "guarde", "posicione", "espera",
})

# Mesma cerca do modulo: setas, tracos nao-ascii, bullets, simbolos
# matematicos, dingbats/emoji. Acento latino NAO casa aqui (e bem-vindo).
_RE_PROIBIDO = re.compile(
    "[\u2190-\u21FF\u2010-\u2015\u2043\u2022\u2023\u25AA\u25CF"
    "\u2248\u2260\u2264\u2265\u2600-\u27BF\uFE0F\u2B00-\u2BFF"
    "\U0001F000-\U0001FAFF]"
)

_ARQUIVOS_DA_FONTE = (
    Path(audio_glossario.__file__),
    Path(__file__),
)


def _todos_os_textos():
    """Todo texto do glossario mais a saida condensada, rotulados."""
    pares = []
    for chave, item in GLOSSARIO.items():
        for campo in CAMPOS_TEXTO:
            pares.append((f"{chave}.{campo}", item[campo]))
        pares.append((f"{chave}.secao", item["secao"]))
        for i, rel in enumerate(item["relacionado"]):
            pares.append((f"{chave}.relacionado[{i}]", rel))
    pares.append(("para_prompt()", para_prompt()))
    return pares


class TestCoberturaMinima(unittest.TestCase):
    """O contrato fixa as chaves minimas por secao; nenhuma pode faltar."""

    def test_todas_as_chaves_da_cobertura_minima_existem(self):
        faltando = []
        for secao, chaves in COBERTURA_MINIMA.items():
            for chave in chaves:
                if chave not in GLOSSARIO:
                    faltando.append(chave)
                    continue
                self.assertEqual(
                    GLOSSARIO[chave]["secao"], secao,
                    f"'{chave}' deveria pertencer a secao '{secao}'.")
        self.assertEqual(faltando, [], f"Chaves ausentes: {faltando}")

    def test_presets_existem_e_ficam_no_tratamento(self):
        for chave in PRESETS_MINIMOS:
            self.assertIn(chave, GLOSSARIO)
            self.assertEqual(GLOSSARIO[chave]["secao"], "tratamento")


class TestFormato(unittest.TestCase):
    """Contrato estrutural: campos, secao, relacionados e consultas."""

    def test_nenhum_campo_vazio(self):
        vazios = []
        for chave, item in GLOSSARIO.items():
            for campo in CAMPOS_TEXTO:
                valor = item.get(campo)
                if not isinstance(valor, str) or not valor.strip():
                    vazios.append(f"{chave}.{campo}")
            if not isinstance(item.get("relacionado"), list) \
                    or not item["relacionado"]:
                vazios.append(f"{chave}.relacionado")
            if item.get("secao") not in SECOES_VALIDAS:
                vazios.append(f"{chave}.secao")
        self.assertEqual(vazios, [], f"Campos vazios/invalidos: {vazios}")

    def test_todo_relacionado_aponta_para_chave_existente(self):
        inexistentes = [
            f"{chave} -> {rel}"
            for chave, item in GLOSSARIO.items()
            for rel in item["relacionado"]
            if rel not in GLOSSARIO or rel == chave
        ]
        self.assertEqual(inexistentes,
                         [], f"Relacionados quebrados: {inexistentes}")

    def test_toda_secao_e_uma_das_quatro(self):
        secoes = {item["secao"] for item in GLOSSARIO.values()}
        self.assertTrue(secoes <= set(SECOES_VALIDAS),
                        f"Secoes invalidas: {secoes - set(SECOES_VALIDAS)}")

    def test_entrada_conhecida_devolve_copia_independente(self):
        copia = entrada("loudness")
        self.assertIsNotNone(copia)
        copia["titulo"] = "X"
        copia["relacionado"].append("chave_fantasma")
        self.assertNotEqual(GLOSSARIO["loudness"]["titulo"], "X")
        self.assertNotIn("chave_fantasma", GLOSSARIO["loudness"]["relacionado"])

    def test_entrada_desconhecida_devolve_none_sem_excecao(self):
        self.assertIsNone(entrada("nao_existo"))
        self.assertIsNone(entrada(None))
        self.assertIsNone(entrada(123))

    def test_por_secao_filtra_somente_a_secao_pedida(self):
        da_secao = por_secao("nuvem")
        self.assertEqual(
            set(da_secao), set(COBERTURA_MINIMA["nuvem"]))
        for chave, item in da_secao.items():
            self.assertEqual(item["secao"], "nuvem")

    def test_por_secao_invalida_levanta_value_error_com_as_validas(self):
        with self.assertRaises(ValueError) as ctx:
            por_secao("home")
        for secao in SECOES_VALIDAS:
            self.assertIn(secao, str(ctx.exception))


class TestTextoParaTelaELog(unittest.TestCase):
    """Acento na tela e bem-vindo; seta/travessao/emoji/simbolo, nunca."""

    def test_nenhum_caractere_proibido_em_texto_algum(self):
        proibidos = [(rotulo, _RE_PROIBIDO.search(texto).group(0))
                     for rotulo, texto in _todos_os_textos()
                     if _RE_PROIBIDO.search(texto)]
        self.assertEqual(proibidos, [], f"Caracteres proibidos: {proibidos}")

    def test_todo_texto_e_codificavel_em_cp1252(self):
        fora = []
        for rotulo, texto in _todos_os_textos():
            try:
                texto.encode("cp1252")
            except UnicodeEncodeError as e:
                fora.append(f"{rotulo}: {e}")
        self.assertEqual(fora, [], f"Textos fora de cp1252: {fora}")

    def test_arquivos_da_fonte_limpos_byte_a_byte(self):
        # Varre o codigo-fonte INTEIRO dos dois arquivos (strings, comentarios
        # e docstrings): nada de emoji/seta/travessao em lugar algum.
        problemas = []
        for caminho in _ARQUIVOS_DA_FONTE:
            fonte = caminho.read_bytes().decode("utf-8")
            achou = _RE_PROIBIDO.search(fonte)
            if achou:
                problemas.append(f"{caminho.name}: U+{ord(achou.group(0)):04X}")
            try:
                fonte.encode("cp1252")
            except UnicodeEncodeError as e:
                problemas.append(f"{caminho.name}: {e}")
        self.assertEqual(problemas, [], f"Fontes sujas: {problemas}")

    def test_resumo_cabe_em_uma_linha_sem_quebra(self):
        com_quebra = [chave for chave, item in GLOSSARIO.items()
                      if "\n" in item["resumo"]]
        self.assertEqual(com_quebra, [])


class TestPromptCondensado(unittest.TestCase):
    """para_prompt(): a versao que viaja no prompt do chat (M5/M6)."""

    def test_para_prompt_nao_vazio_e_menor_que_o_glossario_inteiro(self):
        condensado = para_prompt()
        self.assertTrue(condensado.strip())
        tamanho_glossario = len(json.dumps(GLOSSARIO, ensure_ascii=False))
        self.assertLess(
            len(condensado), tamanho_glossario,
            "A versao condensada precisa ser menor que o glossario inteiro.")

    def test_para_prompt_cita_todas_as_chaves(self):
        condensado = para_prompt()
        ausentes = [chave for chave in GLOSSARIO
                    if f"\n{chave}: " not in f"\n{condensado}"]
        self.assertEqual(ausentes, [],
                         f"Chaves fora do prompt: {ausentes}")

    def test_para_prompt_traz_os_numeros_reais_da_casa(self):
        condensado = para_prompt()
        for numero in ("-16 LUFS", "-1,5 dBTP", "-7,4 LUFS", "+1,7 dBTP",
                       "-26,9 dB", "4,5", "31x-44x", "2 h/mes"):
            self.assertIn(numero, condensado,
                          f"Falta o numero real '{numero}' no prompt.")

    def test_para_prompt_e_deterministico(self):
        self.assertEqual(para_prompt(), para_prompt())


class TestInstrucaoAcionavel(unittest.TestCase):
    """'na_pratica' manda fazer: primeiro verbo sempre de acao."""

    def test_na_pratica_comeca_com_verbo_de_acao(self):
        falhas = []
        for chave, item in GLOSSARIO.items():
            primeira = re.split(r"[\s,.!?]", item["na_pratica"].strip(),
                                maxsplit=1)[0].lower().strip(",.;:!?")
            if primeira not in VERBOS_DE_ACAO:
                falhas.append(f"{chave}: começa com '{primeira}'")
        self.assertEqual(falhas, [],
                         f"'na_pratica' sem verbo de acao: {falhas}")

    def test_na_pratica_termina_em_decisao_ou_acao(self):
        # Toda entrada termina em ponto final e a frase final contem verbo
        # de acao da lista em alguma posicao (decisao, nao definicao).
        falhas = []
        for chave, item in GLOSSARIO.items():
            texto = item["na_pratica"].strip()
            if not texto.endswith("."):
                falhas.append(f"{chave}: nao termina em ponto final")
                continue
            palavras = {p.strip(",.;:!?").lower() for p in texto.split()}
            if not (palavras & VERBOS_DE_ACAO):
                falhas.append(f"{chave}: sem verbo de acao")
        self.assertEqual(falhas, [], f"Entradas sem decisao: {falhas}")


# Frases que SO eram verdade quando nenhum preset alcancava a IA. O motor
# (sherpa-onnx + DPDFNet) esta instalado e DOIS presets passam por ele; se
# algum texto voltar a afirma-las, o mundo regrediu e este teste grita.
_RE_IA_NAO_INSTALADA = re.compile(
    r"ainda sem preset que o use"
    r"|nenhum preset[^.;]{0,90}passa por ela ainda"
    r"|nenhum preset[^.;]{0,90}rotei[a-z]* pel[oa]"
    r"|o que falta [^.;]{0,40}preset"
    r"|instalad[oa],? mas fora"
    r"|fora d[oa]s? presets? atuais"
    r"|quando o motor de ia entrar"
    r"|pendentes? de decis[aã]o de instala"
    r"|seguem pendentes"
    r"|esperando depend[eê]ncia"
    r"|precisa ser instalad"
)


class TestPresetsDeIA(unittest.TestCase):
    """Os dois presets que atravessam o denoise por IA (ETAPA 4 real)."""

    CHAVES_IA = ("resgate_ia", "voz_limpa_ia")

    def test_presets_de_ia_existem_com_todos_os_campos(self):
        for chave in self.CHAVES_IA:
            self.assertIn(chave, GLOSSARIO)
            item = GLOSSARIO[chave]
            for campo in CAMPOS_TEXTO:
                self.assertIsInstance(item.get(campo), str)
                self.assertTrue(item[campo].strip(), f"{chave}.{campo} vazio")
            self.assertEqual(item["secao"], "tratamento")
            self.assertTrue(item["relacionado"])

    def test_relacionados_dos_presets_de_ia_apontam_para_chaves_reais(self):
        quebrados = [f"{chave} -> {rel}"
                     for chave in self.CHAVES_IA
                     for rel in GLOSSARIO[chave]["relacionado"]
                     if rel not in GLOSSARIO or rel == chave]
        self.assertEqual(quebrados, [], f"Relacionados quebrados: {quebrados}")

    def test_nenhum_texto_afirma_que_a_ia_nao_esta_instalada(self):
        regressoes = []
        for rotulo, texto in _todos_os_textos():
            achou = _RE_IA_NAO_INSTALADA.search(texto.lower())
            if achou:
                regressoes.append(f"{rotulo}: '{achou.group(0)}'")
        self.assertEqual(
            regressoes, [],
            f"Textos afirmando que a IA nao alcancava preset algum: "
            f"{regressoes}")

    def test_presets_de_ia_trazem_custo_com_numero_e_prever(self):
        # O custo E o argumento central: 0,7x tempo real, 15 minutos nos
        # mesmos 22, cerca de 45x mais lento que os filtros ffmpeg.
        for chave in self.CHAVES_IA:
            texto = " ".join(GLOSSARIO[chave][c] for c in CAMPOS_TEXTO)
            self.assertIn("0,7x", texto, f"{chave}: falta o custo 0,7x")
            self.assertIn("15 minutos", texto, f"{chave}: falta os 15 min")
            self.assertIn("45", texto, f"{chave}: falta o fator ~45x")
            self.assertIn("Prever 15 s", GLOSSARIO[chave]["na_pratica"],
                          f"{chave}: na_pratica sem 'Prever 15 s'")


if __name__ == "__main__":
    unittest.main()
