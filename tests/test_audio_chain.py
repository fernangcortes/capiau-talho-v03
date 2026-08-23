"""Testes da cadeia ffmpeg renderizada (contrato F1 da ETAPA 3 de PLANO_AJUSTES_DE_AUDIO).

Por que existe: o Tipo B gera ARQUIVO e o clipe passa a apontar para ele, entao
a mesma intencao precisa virar sempre a MESMA lista canonica (o cache depende
disso), o loudnorm precisa ir em DUAS passagens (1 passagem errou 0,7 LU na
medicao do plano) e o renderizador precisa recusar destino em F:/ e destino
igual a origem ANTES de chamar qualquer ffmpeg.

Fixtures: os arquivos de audio sinteticos sao gerados dentro do proprio repo
(tests/_tmp_audio_chain) - por onda com wave/struct (sem ffmpeg) ou por lavfi
(quando o teste exige ffmpeg de verdade), porque o temp do sistema pode estar
indisponivel nesta maquina.
"""
import hashlib
import json
import shutil
import subprocess
import unittest
import wave
from pathlib import Path

from src.media.audio_chain import (
    ALVO_LUFS_PADRAO,
    CADEIA_ORDEM,
    PRESETS_CADEIA,
    TETO_DBTP_PADRAO,
    _extrair_medidas_loudnorm,
    hash_cadeia,
    montar_filtros,
    normalizar_cadeia,
    renderizar,
)

TMP = Path(__file__).parent / "_tmp_audio_chain"

MEDIDAS_JULIA_VIRSHNA = {
    # Numeros reais da 1a passagem sobre a janela estourada da entrevista
    # (secao 1 do plano: I -10,4 LUFS | TP +1,5 dBTP).
    "measured_I": -10.42,
    "measured_LRA": 4.50,
    "measured_TP": 1.51,
    "measured_thresh": -20.24,
    "target_offset": -0.05,
}


def _wav_teste(nome: str, segundos: float = 1.0, taxa: int = 48000) -> Path:
    """WAV mono de senoide escrito so com a stdlib (nao depende de ffmpeg)."""
    import math
    import struct
    caminho = TMP / nome
    n = int(segundos * taxa)
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        quadros = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / taxa)))
            for i in range(n))
        w.writeframes(quadros)
    return caminho


class TestNormalizarCadeia(unittest.TestCase):
    def test_ordem_canonica_do_resgate(self):
        cadeia = normalizar_cadeia({"reparo_clipping": True, "limitador": True,
                                    "loudnorm": True, "denoise_classico": "afftdn"})
        self.assertEqual(
            cadeia,
            ["adeclip", "adeclick", "afftdn:12", "loudnorm:-16:-1.5",
             "alimiter:-1.5"])

    def test_mesma_intencao_mesma_lista_independente_da_ordem_do_dict(self):
        a = normalizar_cadeia({"reparo_clipping": True, "loudnorm": True,
                               "limitador": True})
        b = normalizar_cadeia({"limitador": True, "loudnorm": True,
                               "reparo_clipping": True})
        self.assertEqual(a, b)
        self.assertEqual(a, ["adeclip", "adeclick", "loudnorm:-16:-1.5",
                             "alimiter:-1.5"])

    def test_defaults_de_alvo_e_teto(self):
        self.assertEqual(normalizar_cadeia({"loudnorm": True}),
                         [f"loudnorm:{ALVO_LUFS_PADRAO:g}:{TETO_DBTP_PADRAO:g}"])

    def test_parametros_customizados(self):
        cadeia = normalizar_cadeia({"loudnorm": True, "alvo_lufs": -14,
                                    "teto_dbtp": -2.0, "limitador": True,
                                    "denoise_classico": "anlmdn"})
        self.assertEqual(
            cadeia, ["anlmdn", "loudnorm:-14:-2", "alimiter:-2"])

    def test_afftdn_com_nr_customizado(self):
        self.assertEqual(normalizar_cadeia({"denoise_classico": "afftdn",
                                            "denoise_nr_db": 18}),
                         ["afftdn:18"])

    def test_chave_desconhecida_levanta(self):
        # "denoise_ia" virou opcao valida na ETAPA 4; o exemplo de chave
        # desconhecida acompanhou.
        with self.assertRaises(ValueError) as ctx:
            normalizar_cadeia({"denoise_ia_magica": True})
        self.assertIn("Opcoes desconhecidas", str(ctx.exception))

    def test_denoise_classico_invalido_levanta(self):
        with self.assertRaises(ValueError):
            normalizar_cadeia({"denoise_classico": "rnnoise"})

    PRESETS_CLASSICOS = ("so_entrega", "resgate_estourado",
                         "ambiencia_preservada", "previa_rapida")

    def test_presets_classicos_normalizam_sem_erro_e_sem_ia(self):
        self.assertEqual(set(self.PRESETS_CLASSICOS) & set(PRESETS_CADEIA),
                         set(self.PRESETS_CLASSICOS))
        for nome in self.PRESETS_CLASSICOS:
            cadeia = normalizar_cadeia(PRESETS_CADEIA[nome])
            self.assertTrue(cadeia, f"preset {nome} gerou cadeia vazia")
            self.assertNotIn("denoise_ia", "|".join(cadeia),
                             f"preset classico {nome} nao pode depender de IA")
            nomes = {p.split(":")[0] for p in cadeia}
            self.assertTrue(nomes <= set(CADEIA_ORDEM),
                            f"preset {nome} gerou passo fora da ordem canonica")

    def test_denoise_ia_gera_o_passo_na_posicao_canonica(self):
        cadeia = normalizar_cadeia({"reparo_clipping": True, "denoise_ia": True,
                                    "speechnorm": True, "loudnorm": True})
        # Depois do reparo de clipping, antes do speechnorm/loudnorm.
        self.assertEqual(
            cadeia,
            ["adeclip", "adeclick", "denoise_ia", "speechnorm",
             "loudnorm:-16:-1.5"])
        indices = [CADEIA_ORDEM.index(p.split(":")[0]) for p in cadeia]
        self.assertEqual(indices, sorted(indices))

    def test_denoise_ia_fica_depois_do_classico_e_antes_do_loudnorm(self):
        cadeia = normalizar_cadeia({"reparo_clipping": True,
                                    "denoise_classico": "afftdn",
                                    "denoise_ia": True, "limitador": True})
        self.assertEqual(
            cadeia,
            ["adeclip", "adeclick", "afftdn:12", "denoise_ia", "alimiter:-1.5"])

    def test_denoise_ia_db_vira_o_parametro_que_o_worker_le(self):
        # Formato consumido por worker_audio.parametros_ia: "denoise_ia:<dB>".
        self.assertEqual(
            normalizar_cadeia({"denoise_ia": True, "denoise_ia_db": 12}),
            ["denoise_ia:12"])
        # Sem dB o passo sai nu: quem dosa e o worker (analise 'antes' ou 12 dB).
        self.assertEqual(normalizar_cadeia({"denoise_ia": True}), ["denoise_ia"])
        # Mesmo espirito do denoise_nr_db: sem o denoise ligado, dB sozinho nao gera passo.
        self.assertEqual(normalizar_cadeia({"denoise_ia_db": 6.0}), [])

    def test_denoise_ia_db_invalido_levanta(self):
        for ruim in (0, -3, "chiado"):
            with self.assertRaises(ValueError):
                normalizar_cadeia({"denoise_ia": True, "denoise_ia_db": ruim})


class TestPresetsDeIA(unittest.TestCase):
    """Os dois presets de IA restauram a intencao ORIGINAL da secao 7 do plano
    sem tocar nos quatro classicos: o custo da IA (~0,7x tempo real contra
    31-44x do ffmpeg, ~50x mais lenta - ~11 min para 22 min de audio) tem que
    ser uma escolha VISIVEL do dono, nunca um efeito colateral silencioso."""

    CLASSICOS = {
        "so_entrega": ["loudnorm:-16:-1.5", "alimiter:-1.5"],
        "resgate_estourado": ["adeclip", "adeclick", "afftdn:12",
                              "loudnorm:-16:-1.5", "alimiter:-1.5"],
        "ambiencia_preservada": ["afftdn:6", "loudnorm:-16:-1.5"],
        "previa_rapida": ["loudnorm:-16:-1.5"],
    }

    def test_os_quatro_presets_antigos_produzem_exatamente_a_mesma_cadeia(self):
        for nome, esperado in self.CLASSICOS.items():
            self.assertEqual(normalizar_cadeia(PRESETS_CADEIA[nome]), esperado,
                             f"preset classico {nome} mudou")

    def test_presets_antigos_nao_ganharam_chave_de_ia(self):
        for nome in self.CLASSICOS:
            self.assertNotIn("denoise_ia", PRESETS_CADEIA[nome], nome)
            self.assertNotIn("denoise_ia_db", PRESETS_CADEIA[nome], nome)

    def test_resgate_ia_e_o_resgate_com_ia_no_lugar_do_afftdn(self):
        cadeia = normalizar_cadeia(PRESETS_CADEIA["resgate_ia"])
        self.assertEqual(
            cadeia,
            ["adeclip", "adeclick", "denoise_ia:18", "loudnorm:-16:-1.5",
             "alimiter:-1.5"])
        nomes = [p.split(":")[0] for p in cadeia]
        # Mesmo esqueleto do caso Julia + Virshna: reparo antes, loudness no
        # alvo, limitador por fim; sem speechnorm (LRA < 5 bloqueia, secao 7).
        self.assertEqual(nomes[0:2], ["adeclip", "adeclick"])
        self.assertIn("loudnorm", nomes)
        self.assertEqual(nomes[-1], "alimiter")
        self.assertNotIn("speechnorm", nomes)

    def test_voz_limpa_ia_e_denoise_leve_com_loudnorm_so_isso(self):
        cadeia = normalizar_cadeia(PRESETS_CADEIA["voz_limpa_ia"])
        self.assertEqual(cadeia, ["denoise_ia:6", "loudnorm:-16:-1.5"])
        nomes = {p.split(":")[0] for p in cadeia}
        self.assertNotIn("alimiter", nomes)
        self.assertNotIn("speechnorm", nomes)

    def test_todo_preset_com_ia_carrega_o_sufixo_visivel(self):
        com_ia = sorted(nome for nome, op in PRESETS_CADEIA.items()
                        if op.get("denoise_ia"))
        self.assertEqual(com_ia, ["resgate_ia", "voz_limpa_ia"])
        for nome in com_ia:
            self.assertTrue(nome.endswith("_ia"), nome)


class TestHashCadeia(unittest.TestCase):
    CADEIA = ["adeclip", "adeclick", "loudnorm:-16:-1.5", "alimiter:-1.5"]

    def test_formato_literal_travado(self):
        esperado = hashlib.sha256(
            ("render|6|405|495|" + "|".join(self.CADEIA))
            .encode("utf-8")).hexdigest()
        self.assertEqual(hash_cadeia(6, 405, 495, self.CADEIA), esperado)
        self.assertEqual(len(esperado), 64)

    def test_int_e_float_dao_o_mesmo_hash(self):
        self.assertEqual(hash_cadeia(6, 405, 495, self.CADEIA),
                         hash_cadeia(6, 405.0, 495.0, self.CADEIA))

    def test_muda_quando_muda_qualquer_componente(self):
        base = hash_cadeia(6, 405, 495, self.CADEIA)
        outros = {
            "video_id": hash_cadeia(7, 405, 495, self.CADEIA),
            "in": hash_cadeia(6, 406, 495, self.CADEIA),
            "out": hash_cadeia(6, 405, 494, self.CADEIA),
            "cadeia": hash_cadeia(6, 405, 495, self.CADEIA[:-1]),
        }
        for campo, hash_outro in outros.items():
            self.assertNotEqual(base, hash_outro,
                                f"hash deveria mudar com {campo}")

    def test_passo_desconhecido_levanta(self):
        with self.assertRaises(ValueError):
            hash_cadeia(6, 0, 1, ["filtromagico"])

    def test_hash_muda_quando_a_cadeia_ganha_o_passo_de_ia(self):
        sem = ["adeclip", "adeclick", "loudnorm:-16:-1.5", "alimiter:-1.5"]
        com = ["adeclip", "adeclick", "denoise_ia:18",
               "loudnorm:-16:-1.5", "alimiter:-1.5"]
        base = hash_cadeia(6, 405, 495, sem)
        com_ia = hash_cadeia(6, 405, 495, com)
        self.assertNotEqual(base, com_ia)
        # dB diferente = cadeia diferente = cache diferente.
        self.assertNotEqual(com_ia,
                            hash_cadeia(6, 405, 495, sem[:2] + ["denoise_ia"]
                                        + sem[2:]))

    def test_hash_aceita_a_gramatica_do_worker_para_o_passo_de_ia(self):
        # A chain_json gravada no banco pode trazer os tres formatos que
        # worker_audio.parametros_ia le; o hash precisa consumir a mesma
        # gramatica sem levantar.
        for passo in ("denoise_ia", "denoise_ia:12", "denoise_ia:sem_limite"):
            self.assertEqual(len(hash_cadeia(6, 0, 1, [passo])), 64)


class TestMontarFiltros(unittest.TestCase):
    def test_reordena_para_a_ordem_canonica(self):
        # Fora de ordem de proposito: limiter antes do reparo de clipping.
        string = montar_filtros(["alimiter:-1.5", "loudnorm:-16:-1.5",
                                 "adeclick", "adeclip"])
        self.assertEqual(string,
                         "adeclip,adeclick,loudnorm=I=-16:LRA=11:TP=-1.5"
                         ":print_format=json,"
                         "alimiter=limit=%.6f:level=disabled"
                         % (10 ** (-1.5 / 20)))

    def test_loudnorm_primeira_passagem_medida_json(self):
        af = montar_filtros(["loudnorm:-16:-1.5"])
        self.assertIn("loudnorm=I=-16:LRA=11:TP=-1.5", af)
        self.assertIn("print_format=json", af)
        self.assertNotIn("measured_I", af)

    def test_loudnorm_segunda_passagem_usa_as_medidas(self):
        af = montar_filtros(["loudnorm:-16:-1.5"], MEDIDAS_JULIA_VIRSHNA)
        self.assertIn("linear=true", af)
        self.assertIn("measured_I=-10.42", af)
        self.assertIn("measured_LRA=4.50", af)
        self.assertIn("measured_TP=1.51", af)
        self.assertIn("measured_thresh=-20.24", af)
        self.assertIn("offset=-0.05", af)
        self.assertNotIn("print_format=json", af)

    def test_loudnorm_sem_todas_as_medidas_levanta(self):
        incompletas = dict(MEDIDAS_JULIA_VIRSHNA)
        del incompletas["target_offset"]
        with self.assertRaises(ValueError) as ctx:
            montar_filtros(["loudnorm"], incompletas)
        self.assertIn("target_offset", str(ctx.exception))

    def test_passo_repetido_levanta(self):
        with self.assertRaises(ValueError) as ctx:
            montar_filtros(["adeclip", "adeclip"])
        self.assertIn("repetido", str(ctx.exception))

    def test_passo_desconhecido_levanta(self):
        with self.assertRaises(ValueError):
            montar_filtros(["dpdfnet:12"])

    def test_passo_de_ia_e_recusado_no_ffmpeg(self):
        # O lugar existe na ordem canonica, mas o ffmpeg deste modulo nunca
        # roda IA: quem executa e o worker de audio.
        self.assertIn("denoise_ia", CADEIA_ORDEM)
        with self.assertRaises(ValueError) as ctx:
            montar_filtros(["denoise_ia"])
        self.assertIn("worker", str(ctx.exception))
        with self.assertRaises(ValueError) as ctx:
            montar_filtros(["adeclip", "denoise_ia:12", "loudnorm:-16"])
        self.assertIn("denoise_ia", str(ctx.exception))

    def test_alimiter_converte_dbtp_para_linear(self):
        af = montar_filtros(["alimiter:-1.5"])
        self.assertAlmostEqual(float(10 ** (-1.5 / 20)), 0.841395, places=6)
        self.assertIn(f"alimiter=limit={10 ** (-1.5 / 20):.6f}", af)
        self.assertIn("level=disabled", af)


class TestGuardasRenderizar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        TMP.mkdir(parents=True, exist_ok=True)
        cls.addClassCleanup(shutil.rmtree, TMP, True)
        cls.origem = _wav_teste("origem_guarda.wav")

    def test_recusa_destino_em_F(self):
        r = renderizar(self.origem, "F:/capiau_nunca/x.wav", 0, 1, ["adeclip"])
        self.assertFalse(r["ok"])
        self.assertIn("F:/", r["erro"])
        self.assertIsNone(r["path"])

    def test_recusa_sobrescrever_a_origem(self):
        r = renderizar(self.origem, self.origem, 0, 1, ["adeclip"])
        self.assertFalse(r["ok"])
        self.assertIn("nunca", r["erro"])
        self.assertTrue(self.origem.exists())  # original intacto

    def test_recusa_origem_ausente(self):
        r = renderizar(TMP / "fantasma.wav", TMP / "qualquer.wav", 0, 1,
                       ["adeclip"])
        self.assertFalse(r["ok"])
        self.assertIn("nao encontrado", r["erro"])

    def test_recusa_intervalo_invalido(self):
        for in_s, out_s in ((10, 10), (10, 5), (None, 5), (-1, 5)):
            r = renderizar(self.origem, TMP / "x.wav", in_s, out_s, ["adeclip"])
            self.assertFalse(r["ok"], f"deveria recusar in={in_s} out={out_s}")
            self.assertIsNotNone(r["erro"])

    def test_recusa_cadeia_vazia(self):
        r = renderizar(self.origem, TMP / "x.wav", 0, 1, [])
        self.assertFalse(r["ok"])
        self.assertIn("vazia", r["erro"])

    def test_recusa_passo_desconhecido_antes_do_ffmpeg(self):
        r = renderizar(self.origem, TMP / "x.wav", 0, 1, ["volumefantasma"])
        self.assertFalse(r["ok"])
        self.assertIn("desconhecido", r["erro"])

    def test_recusa_passo_de_ia_antes_do_ffmpeg_com_mensagem_clara(self):
        # O renderizar NAO executa IA: recusar (e nao pular o passo em
        # silencio) e o contrato - a mensagem aponta quem executa de verdade.
        dest = TMP / "ia_nunca_renderizada.wav"
        r = renderizar(self.origem, dest, 0, 1,
                       ["adeclip", "denoise_ia:18", "loudnorm:-16:-1.5"])
        self.assertFalse(r["ok"])
        self.assertIn("denoise_ia", r["erro"])
        self.assertIn("worker", r["erro"])
        self.assertIsNone(r["path"])
        self.assertFalse(dest.exists())      # nada foi renderizado
        self.assertFalse((TMP / "ia_nunca_renderizada.parcial.wav").exists())
        # Passo nu tambem recusa (mesma guarda, sem parametro).
        r2 = renderizar(self.origem, dest, 0, 1, ["denoise_ia"])
        self.assertFalse(r2["ok"])
        self.assertIn("denoise_ia", r2["erro"])


def _ffmpeg_disponivel() -> bool:
    return shutil.which("ffmpeg") is not None


@unittest.skipUnless(_ffmpeg_disponivel(), "ffmpeg nao encontrado no PATH")
class TestRenderReal(unittest.TestCase):
    """Renderiza de verdade (lavfi sintetico, sem tocar no acervo de F:/)."""

    @classmethod
    def setUpClass(cls):
        TMP.mkdir(parents=True, exist_ok=True)
        cls.fonte = TMP / "sine_fonte.wav"
        proc = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
             "-i", "sine=frequency=440:sample_rate=48000:duration=3",
             "-af", "volume=4dB", "-c:a", "pcm_s16le", str(cls.fonte)],
            capture_output=True, text=True)
        if proc.returncode != 0 or not cls.fonte.exists():
            raise AssertionError(f"ffmpeg nao gerou a midia de teste: "
                                 f"{proc.stderr.strip()}")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TMP, ignore_errors=True)

    def _sondar(self, caminho: Path) -> dict:
        proc = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json",
             "-show_streams", str(caminho)],
            capture_output=True, text=True)
        dados = json.loads(proc.stdout or "{}")
        return (dados.get("streams") or [{}])[0]

    def test_renderiza_wav_48k_24bits_com_loudnorm_2_passagens(self):
        dest = TMP / "tratado_loudnorm.wav"
        percentos = []
        r = renderizar(self.fonte, dest, 0, 3,
                       ["loudnorm:-16:-1.5", "alimiter:-1.5"],
                       progresso=percentos.append)
        self.assertTrue(r["ok"], f"render falhou: {r['erro']}")
        self.assertTrue(dest.exists())
        self.assertEqual(r["path"], str(dest.resolve()))
        stream = self._sondar(dest)
        self.assertEqual(stream.get("codec_name"), "pcm_s24le")
        self.assertEqual(stream.get("sample_rate"), "48000")
        medidas = r["medidas_loudnorm"]
        self.assertIsNotNone(medidas)
        for chave in ("measured_I", "measured_LRA", "measured_TP",
                      "measured_thresh", "target_offset"):
            self.assertIn(chave, medidas)
        self.assertTrue(percentos, "progresso nunca foi chamado")
        self.assertEqual(percentos[-1], 100.0)

    def test_renderiza_cadeia_sem_loudnorm_em_uma_passagem(self):
        dest = TMP / "tratado_simples.wav"
        percentos = []
        r = renderizar(self.fonte, dest, 0.5, 2.5,
                       ["adeclip", "adeclick"],
                       progresso=percentos.append)
        self.assertTrue(r["ok"], f"render falhou: {r['erro']}")
        self.assertIsNone(r["medidas_loudnorm"])
        self.assertEqual(percentos[-1], 100.0)
        stream = self._sondar(dest)
        self.assertEqual(stream.get("codec_name"), "pcm_s24le")

    def test_arquivo_parcial_nao_sobra_apos_falha(self):
        # Intervalo impossivel ja foi barrado antes; para sobrar .parcial seria
        # preciso falha no ffmpeg em si - simulada aqui por destino invalido
        # depois da guarda: diretorio como arquivo de saida.
        alvo_dir = TMP / "pasta_saida"
        alvo_dir.mkdir(exist_ok=True)
        r = renderizar(self.fonte, alvo_dir, 0, 1, ["adeclip"])
        self.assertFalse(r["ok"])
        self.assertFalse((alvo_dir / "pasta.parcial.wav").exists())


class TestExtracaoMedidasLoudnorm(unittest.TestCase):
    """O JSON da 1a passagem chega com prefixos e quebras variaveis no pipe."""

    BRUTO = {"input_i": "-10.42", "input_lra": "4.50", "input_tp": "1.51",
             "input_thresh": "-20.24", "target_offset": "-0.05"}

    def _stderr(self, prefixado: bool) -> str:
        linhas = [f'"{k}" : "{v}",' for k, v in self.BRUTO.items()]
        corpo = "{" + "\n".join(linhas)[:-1] + "\n}"
        if not prefixado:
            return "[Parsed_loudnorm_0 @ aaa] \n" + corpo
        return "".join(f"[Parsed_loudnorm_0 @ aaa] {l}\n"
                       for l in corpo.splitlines())

    def test_prefixo_e_corpo_em_linhas_separadas_caso_real_do_pipe(self):
        medidas = _extrair_medidas_loudnorm(self._stderr(False))
        self.assertEqual(medidas["measured_I"], -10.42)
        self.assertEqual(medidas["target_offset"], -0.05)

    def test_prefixo_na_mesma_linha_de_cada_chave(self):
        medidas = _extrair_medidas_loudnorm(self._stderr(True))
        self.assertEqual(medidas["measured_TP"], 1.51)
        self.assertEqual(medidas["measured_thresh"], -20.24)

    def test_stderr_sem_json_devolve_none(self):
        self.assertIsNone(_extrair_medidas_loudnorm("saida sem medida nenhuma"))
        self.assertIsNone(_extrair_medidas_loudnorm(""))
        self.assertIsNone(_extrair_medidas_loudnorm(
            "[Parsed_loudnorm_0 @ aaa] chave perdida sem bloco json"))


class TestConvencaoCp1252(unittest.TestCase):
    """Nenhum glifo proibido no codigo: console cp1252 nao imprime setas etc."""

    def test_arquivos_decodificam_cp1252_sem_glifos_proibidos(self):
        proibidos = ("\u2192", "\u2264", "\u2265", "\u2014", "\u2022")
        for relativo in ("src/media/audio_chain.py", "tests/test_audio_chain.py"):
            caminho = Path(__file__).parent.parent / relativo
            bruto = caminho.read_bytes()
            texto = bruto.decode("cp1252")  # levanta se houver byte indefinido
            for glifo in proibidos:
                self.assertNotIn(glifo, texto,
                                 f"{relativo} contem glifo proibido "
                                 f"{glifo!r} (use '->' ou '<=')")


if __name__ == "__main__":
    unittest.main()
