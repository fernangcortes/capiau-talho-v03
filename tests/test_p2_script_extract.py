"""Testes da parte pura da extracao de roteiro (P2.1b, Commit 3): chunking, split e
fusao. Modulo puro -- nenhum teste aqui chama LLM nem toca em banco/Qdrant.
"""
import unittest

from src.services.script_extract import build_chunks, split_chunk, merge_chunk_results, ScriptChunk
from src.services.script_format import detect_structure


def _anchors(headings_and_lens):
    """Monta ancoras sinteticas: lista de (heading, tamanho_em_chars)."""
    anchors = []
    offset = 0
    for i, (heading, length) in enumerate(headings_and_lens, start=1):
        anchors.append({"number": i, "heading": heading, "start": offset, "end": offset + length})
        offset += length
    return anchors


def _content_for(anchors):
    """Gera um texto cujo tamanho bate com os offsets das ancoras (conteudo em si nao importa)."""
    total = anchors[-1]["end"] if anchors else 0
    return "x" * total


class TestBuildChunks(unittest.TestCase):
    def test_documento_sem_ancoras_nao_gera_chunks(self):
        self.assertEqual(build_chunks("qualquer coisa", [], chunk_chars=1000), [])

    def test_particao_cobre_todas_as_cenas_sem_duplicar(self):
        """Toda cena real precisa aparecer em exatamente um chunk como alvo."""
        anchors = _anchors([(f"INT. LOCAL {i} - DIA", 500) for i in range(1, 31)])
        content = _content_for(anchors)
        chunks = build_chunks(content, anchors, chunk_chars=3000)

        todos = [n for ch in chunks for n in ch.target_numbers]
        self.assertEqual(sorted(todos), list(range(1, 31)))
        self.assertEqual(len(todos), len(set(todos)), "cena apareceu como alvo em mais de um chunk")

    def test_fronteira_e_sempre_limite_de_cena(self):
        """Nenhum chunk pode conter uma fracao de cena -- o orcamento e respeitado por
        cena inteira, nunca cortando o texto no meio de uma."""
        anchors = _anchors([(f"INT. L{i}", 700) for i in range(1, 21)])
        content = _content_for(anchors)
        chunks = build_chunks(content, anchors, chunk_chars=2500)

        for ch in chunks:
            # cada numero-alvo do chunk precisa ter sua ancora inteira representada no texto
            for num in ch.target_numbers:
                self.assertIn(f"=== CENA {num} ===", ch.text)

    def test_cena_maior_que_o_orcamento_nao_trava_e_entra_sozinha(self):
        """Uma cena gigante (maior que chunk_chars) nao pode gerar loop infinito nem
        ficar de fora: ela vira um chunk proprio."""
        anchors = _anchors([("INT. NORMAL - DIA", 100), ("INT. GIGANTE - DIA", 50000), ("INT. NORMAL2 - DIA", 100)])
        content = _content_for(anchors)
        chunks = build_chunks(content, anchors, chunk_chars=1000)

        todos = [n for ch in chunks for n in ch.target_numbers]
        self.assertEqual(sorted(todos), [1, 2, 3])
        gigante_chunk = next(ch for ch in chunks if 2 in ch.target_numbers)
        self.assertEqual(gigante_chunk.target_numbers, [2], "cena gigante deveria estar sozinha no chunk")

    def test_sobreposicao_ultima_cena_vira_contexto_do_proximo(self):
        anchors = _anchors([(f"INT. L{i}", 900) for i in range(1, 7)])
        content = _content_for(anchors)
        chunks = build_chunks(content, anchors, chunk_chars=2000)
        self.assertGreaterEqual(len(chunks), 2)

        self.assertIsNone(chunks[0].context_number)
        for i in range(1, len(chunks)):
            self.assertEqual(chunks[i].context_number, chunks[i - 1].target_numbers[-1])
            self.assertIn(f"=== CENA {chunks[i].context_number} {'[CONTEXTO]'} ===", chunks[i].text)
            # a cena de contexto NAO pode estar na lista de alvo do mesmo chunk
            self.assertNotIn(chunks[i].context_number, chunks[i].target_numbers)

    def test_dimensionamento_no_roteiro_real(self):
        """Sem gastar API: confirma que o dimensionamento medido (130.603 chars / 24k
        ~= 6 chunks de 18-20 cenas) continua valendo apos qualquer mudanca de codigo."""
        import sqlite3
        from src.config import CONFIG
        conn = sqlite3.connect(str(CONFIG.DB_PATH))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT content FROM production_doc WHERE id = 3").fetchone()
        conn.close()
        if not row:
            self.skipTest("doc real id=3 nao presente neste banco")

        r = detect_structure(row["content"], "roteiro.txt", allow_llm=False)
        chunks = build_chunks(row["content"], r.anchors, chunk_chars=24000)

        self.assertEqual(r.scene_count, 111)
        self.assertEqual(len(chunks), 6)
        for ch in chunks:
            self.assertTrue(10 <= ch.target_count <= 30, f"chunk com {ch.target_count} cenas foge do esperado")


class TestSplitChunk(unittest.TestCase):
    def test_chunk_de_uma_cena_nao_e_dividido(self):
        """Split so faz sentido para chunk com 2+ cenas -- 1 cena que falha e outro tipo
        de erro, dividir nao ajudaria."""
        anchors = _anchors([("INT. UNICA - DIA", 100)])
        chunk = ScriptChunk(index=0, text="=== CENA 1 ===\nx", target_numbers=[1], context_number=None)
        partes = split_chunk(_content_for(anchors), anchors, chunk)
        self.assertEqual(len(partes), 1)
        self.assertIs(partes[0], chunk)

    def test_divide_ao_meio_preservando_particao(self):
        anchors = _anchors([(f"INT. L{i}", 200) for i in range(1, 9)])
        content = _content_for(anchors)
        chunk = ScriptChunk(index=2, text="", target_numbers=[3, 4, 5, 6, 7, 8], context_number=2)

        partes = split_chunk(content, anchors, chunk)
        self.assertEqual(len(partes), 2)
        self.assertEqual(partes[0].target_numbers, [3, 4, 5])
        self.assertEqual(partes[1].target_numbers, [6, 7, 8])
        # a particao continua exata: nada duplicado, nada perdido
        self.assertEqual(sorted(partes[0].target_numbers + partes[1].target_numbers), [3, 4, 5, 6, 7, 8])

    def test_segunda_metade_usa_a_primeira_como_contexto(self):
        """Continuidade preservada dentro do proprio split: a segunda metade nao perde
        o fio da meada so porque o chunk foi dividido."""
        anchors = _anchors([(f"INT. L{i}", 200) for i in range(1, 7)])
        content = _content_for(anchors)
        chunk = ScriptChunk(index=1, text="", target_numbers=[2, 3, 4, 5], context_number=1)

        primeira, segunda = split_chunk(content, anchors, chunk)
        self.assertEqual(primeira.target_numbers, [2, 3])
        self.assertEqual(segunda.target_numbers, [4, 5])
        self.assertEqual(primeira.context_number, 1, "primeira metade mantem o contexto original do chunk")
        self.assertEqual(segunda.context_number, 3, "segunda metade usa a ultima cena da primeira como contexto")
        self.assertIn("=== CENA 3 [CONTEXTO] ===", segunda.text)

    def test_split_de_chunk_impar_nao_perde_cena(self):
        anchors = _anchors([(f"INT. L{i}", 150) for i in range(1, 6)])
        chunk = ScriptChunk(index=0, text="", target_numbers=[1, 2, 3, 4, 5], context_number=None)
        primeira, segunda = split_chunk(_content_for(anchors), anchors, chunk)
        self.assertEqual(primeira.target_numbers + segunda.target_numbers, [1, 2, 3, 4, 5])


class TestMergeChunkResults(unittest.TestCase):
    ANCHORS = _anchors([("INT. A - DIA", 10), ("INT. B - DIA", 10), ("INT. C - DIA", 10)])

    def test_fusao_basica_ordena_por_numero(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[2, 1], context_number=None)
        data = {"cenas": [
            {"numero": 2, "sinopse": "cena dois", "personagens": [], "props": [], "locacao": "B"},
            {"numero": 1, "sinopse": "cena um", "personagens": [], "props": [], "locacao": "A"},
        ], "personagens": [], "objetos_chave": []}

        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual([s["number"] for s in result["scenes"]], [1, 2])
        self.assertEqual(result["scenes"][0]["synopsis"], "cena um")

    def test_vazamento_de_contexto_nao_vence_a_versao_autoritativa(self):
        """O modelo do 2o chunk desobedece e devolve a cena de contexto tambem -- a
        versao correta (vinda do chunk onde a cena era alvo) tem que vencer, nao
        importa a ordem de chegada."""
        c1 = ScriptChunk(index=0, text="", target_numbers=[1, 2], context_number=None)
        c2 = ScriptChunk(index=1, text="", target_numbers=[3], context_number=2)
        data1 = {"cenas": [
            {"numero": 1, "sinopse": "s1", "personagens": [], "props": [], "locacao": "A"},
            {"numero": 2, "sinopse": "s2-certa", "personagens": [], "props": [], "locacao": "B"},
        ], "personagens": [], "objetos_chave": []}
        data2 = {"cenas": [
            {"numero": 3, "sinopse": "s3", "personagens": [], "props": [], "locacao": "C"},
            {"numero": 2, "sinopse": "s2-vazada-errada", "personagens": [], "props": [], "locacao": "B"},
        ], "personagens": [], "objetos_chave": []}

        result = merge_chunk_results([(c1, data1), (c2, data2)], self.ANCHORS)
        cena2 = next(s for s in result["scenes"] if s["number"] == 2)
        self.assertEqual(cena2["synopsis"], "s2-certa")

    def test_vazamento_chegando_antes_da_versao_autoritativa_tambem_perde(self):
        """Mesmo resultado do teste anterior, mas com a ORDEM invertida na lista de
        chunk_results -- a regra e por papel (alvo vs. vazado), nao por ordem de chegada."""
        c1 = ScriptChunk(index=0, text="", target_numbers=[1, 2], context_number=None)
        c2 = ScriptChunk(index=1, text="", target_numbers=[3], context_number=2)
        data1 = {"cenas": [{"numero": 2, "sinopse": "s2-certa", "personagens": [], "props": [], "locacao": "B"}],
                 "personagens": [], "objetos_chave": []}
        data2 = {"cenas": [{"numero": 2, "sinopse": "s2-vazada-errada", "personagens": [], "props": [], "locacao": "B"}],
                 "personagens": [], "objetos_chave": []}

        # chunk vazado (c2) processado ANTES do chunk autoritativo (c1) na lista
        result = merge_chunk_results([(c2, data2), (c1, data1)], self.ANCHORS)
        cena2 = next(s for s in result["scenes"] if s["number"] == 2)
        self.assertEqual(cena2["synopsis"], "s2-certa")

    def test_numero_fora_das_ancoras_e_descartado(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {"cenas": [
            {"numero": 1, "sinopse": "valida", "personagens": [], "props": [], "locacao": "A"},
            {"numero": 999, "sinopse": "inventada", "personagens": [], "props": [], "locacao": "?"},
        ], "personagens": [], "objetos_chave": []}
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual(len(result["scenes"]), 1)
        self.assertEqual(result["scenes"][0]["number"], 1)

    def test_numero_nao_numerico_e_descartado_sem_derrubar(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {"cenas": [
            {"numero": "doze", "sinopse": "lixo", "personagens": [], "props": [], "locacao": "?"},
            {"numero": 1, "sinopse": "valida", "personagens": [], "props": [], "locacao": "A"},
        ], "personagens": [], "objetos_chave": []}
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual(len(result["scenes"]), 1)

    def test_chunk_sem_resultado_e_ignorado_sem_quebrar(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        c2 = ScriptChunk(index=1, text="", target_numbers=[2], context_number=1)
        data1 = {"cenas": [{"numero": 1, "sinopse": "s1", "personagens": [], "props": [], "locacao": "A"}],
                 "personagens": [], "objetos_chave": []}
        result = merge_chunk_results([(c1, data1), (c2, None)], self.ANCHORS)
        self.assertEqual(len(result["scenes"]), 1)

    def test_personagens_dedupe_case_insensitive_e_preserva_melhor_descricao(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {"cenas": [], "personagens": [
            {"nome": "Daniel", "descricao": "protagonista, filho dos Degara"},
            {"nome": "DANIEL", "descricao": ""},
            {"nome": "daniel", "descricao": "ignorado pois ja tem descricao melhor"},
        ], "objetos_chave": []}
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual(len(result["characters"]), 1)
        self.assertEqual(result["characters"][0]["name"], "Daniel")
        self.assertEqual(result["characters"][0]["description"], "protagonista, filho dos Degara")

    def test_objetos_chave_deduplicam_como_personagens(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {"cenas": [], "personagens": [], "objetos_chave": [
            {"nome": "envelope", "descricao": ""},
            {"nome": "Envelope", "descricao": "carta do pai"},
        ]}
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual(len(result["key_objects"]), 1)
        self.assertEqual(result["key_objects"][0]["description"], "carta do pai")

    def test_campos_malformados_nao_derrubam_a_fusao(self):
        """JSON tecnicamente valido mas com tipos errados (personagens como string em
        vez de lista, cena que nao e dict) nao pode gerar excecao nao tratada."""
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {
            "cenas": ["isto nao e um dict", {"numero": 1, "sinopse": "ok", "personagens": "nao-lista", "props": None, "locacao": "A"}],
            "personagens": "tambem nao e lista",
            "objetos_chave": None,
        }
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertEqual(len(result["scenes"]), 1)
        self.assertEqual(result["scenes"][0]["characters"], [])
        self.assertEqual(result["characters"], [])

    def test_sinopse_e_heading_ausentes_viram_none_nao_string_vazia_falsy(self):
        c1 = ScriptChunk(index=0, text="", target_numbers=[1], context_number=None)
        data = {"cenas": [{"numero": 1, "personagens": [], "props": [], "locacao": None}],
                "personagens": [], "objetos_chave": []}
        result = merge_chunk_results([(c1, data)], self.ANCHORS)
        self.assertIsNone(result["scenes"][0]["synopsis"])
        self.assertIsNone(result["scenes"][0]["heading"])
        self.assertIsNone(result["scenes"][0]["location"])


if __name__ == "__main__":
    unittest.main()
