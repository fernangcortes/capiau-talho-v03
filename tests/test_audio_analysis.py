"""Testes da pre-analise de audio (contrato C1 da ETAPA 1 de PLANO_AJUSTES_DE_AUDIO).

Por que existe: o diagnostico do painel "Ajustes" (secao 4 do plano) precisa ler
o stderr bruto do ffmpeg (ebur128 + astats) sem quebrar em saida vazia, em piso
de ruido "-inf" e em arquivo sem faixa de audio, e classificar o resultado nos
selos da secao 7 com os limiares do contrato C4.

Fixture principal: numeros reais medidos em 23/08/2026 no trecho 6:45-8:15 da
entrevista "arte julia e virshna" (secao 1 do plano):
    LUFS-I -10.4 | true peak +1.5 dBTP | piso -27.0 dB | LRA 4.5 | 669 amostras
estouradas -> clip_pct ~0,65%. A saida real completa do ffmpeg (sine sintetizado
por lavfi, sem depender do acervo) esta em tests/fixtures/audio_ebur128_astats_mono.txt.

Escrito em unittest.TestCase no padrao dos outros testes da casa: pytest roda
esses casos sem mudanca nenhuma.
"""
import math
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.media.audio_analysis import (
    LIMIARES_PADRAO,
    avaliar,
    parse_ffmpeg_audio_report,
    analisar_intervalo,
    extrair_serie,
    resumir_serie,
    momentos_problematicos,
)

FIXTURE_MONO_REAL = Path(__file__).parent / "fixtures" / "audio_ebur128_astats_mono.txt"

# Relatorio no formato real do ffmpeg 7.x com os numeros medidos da entrevista
# Julia + Virshna (janela curta de clipe: 102768 amostras x 669 estouradas =
# clip_pct 0,651%, igual ao exemplo analysis_before da secao 3 do plano).
SAIDA_JULIA_VIRSHNA = """\
[Parsed_ebur128_0 @ 00000219e4f5b080] Summary:

  Integrated loudness:
    I:         -10.4 LUFS
    Threshold: -20.2 LUFS

  Loudness range:
    LRA:         4.5 LU
    Threshold: -30.1 LUFS
    LRA low:   -16.9 LUFS
    LRA high:  -12.4 LUFS

  True peak:
    Peak:      +1.5 dBFS
[Parsed_astats_1 @ 00000219e4f5c140] Channel: 1
[Parsed_astats_1 @ 00000219e4f5c140] Peak level dB: 1.502310
[Parsed_astats_1 @ 00000219e4f5c140] RMS level dB: -13.842117
[Parsed_astats_1 @ 00000219e4f5c140] Crest factor: 2.641003
[Parsed_astats_1 @ 00000219e4f5c140] Flat factor: 0.996089
[Parsed_astats_1 @ 00000219e4f5c140] Peak count: 401
[Parsed_astats_1 @ 00000219e4f5c140] Abs Peak count: 401
[Parsed_astats_1 @ 00000219e4f5c140] Noise floor dB: -26.987442
[Parsed_astats_1 @ 00000219e4f5c140] Channel: 2
[Parsed_astats_1 @ 00000219e4f5c140] Peak level dB: 1.498112
[Parsed_astats_1 @ 00000219e4f5c140] RMS level dB: -13.901554
[Parsed_astats_1 @ 00000219e4f5c140] Crest factor: 2.638921
[Parsed_astats_1 @ 00000219e4f5c140] Flat factor: 0.991204
[Parsed_astats_1 @ 00000219e4f5c140] Peak count: 268
[Parsed_astats_1 @ 00000219e4f5c140] Abs Peak count: 268
[Parsed_astats_1 @ 00000219e4f5c140] Noise floor dB: -27.034561
[Parsed_astats_1 @ 00000219e4f5c140] Overall
[Parsed_astats_1 @ 00000219e4f5c140] Peak level dB: 1.502310
[Parsed_astats_1 @ 00000219e4f5c140] RMS level dB: -13.842117
[Parsed_astats_1 @ 00000219e4f5c140] Crest factor: 2.641003
[Parsed_astats_1 @ 00000219e4f5c140] Flat factor: 0.996089
[Parsed_astats_1 @ 00000219e4f5c140] Peak count: 669.000000
[Parsed_astats_1 @ 00000219e4f5c140] Abs Peak count: 669.000000
[Parsed_astats_1 @ 00000219e4f5c140] Noise floor dB: -27.034561
[Parsed_astats_1 @ 00000219e4f5c140] Number of samples: 102768
"""

# Piso de ruido "-inf": o parser deve devolver float("-inf"), nunca None.
SAIDA_PISO_INFINITO = """\
[Parsed_ebur128_0 @ aaa] Summary:
  Integrated loudness:
    I:         -70.0 LUFS
  Loudness range:
    LRA:         0.0 LU
  True peak:
    Peak:      -18.1 dBFS
[Parsed_astats_1 @ bbb] Channel: 1
[Parsed_astats_1 @ bbb] Peak level dB: -18.063921
[Parsed_astats_1 @ bbb] RMS level dB: -21.074024
[Parsed_astats_1 @ bbb] Peak count: 0
[Parsed_astats_1 @ bbb] Noise floor dB: -inf
[Parsed_astats_1 @ bbb] Number of samples: 48000
"""

# Canal diz uma coisa, Overall diz outra: o Overall vence (contrato C1).
SAIDA_OVERALL_VENCE = """\
[Parsed_astats_1 @ ccc] Channel: 1
[Parsed_astats_1 @ ccc] RMS level dB: -10.500000
[Parsed_astats_1 @ ccc] Peak count: 30
[Parsed_astats_1 @ ccc] Number of samples: 6000
[Parsed_astats_1 @ ccc] Overall
[Parsed_astats_1 @ ccc] RMS level dB: -20.250000
[Parsed_astats_1 @ ccc] Peak count: 30
[Parsed_astats_1 @ ccc] Number of samples: 6000
"""


def _diag(**sobrescritas):
    """Diagnostico manual pronto para avaliar(), com valores saudaveis por padrao."""
    base = {
        "lufs_i": -16.2, "lra": 8.0, "true_peak_db": -3.7, "rms_db": -18.4,
        "peak_db": -3.7, "crest_factor": 4.2, "noise_floor_db": -55.0,
        "n_samples": 48000, "peak_count": 0, "clip_pct": 0.0,
        "stereo_corr": None, "canais": 2,
    }
    base.update(sobrescritas)
    return base


class TestLimiaresPadrao(unittest.TestCase):

    def test_defaults_sao_os_do_contrato_c4(self):
        esperado = {
            "alvo_lufs": -16.0, "teto_dbtp": -1.5, "clip_pct_grave": 0.05,
            "piso_ruido_alto": -35.0, "piso_ruido_medio": -45.0,
            "lra_esmagado": 5.0, "lra_amplo": 12.0, "correlacao_estereo": 0.95,
        }
        self.assertEqual(LIMIARES_PADRAO, esperado)


class TestParseSaidaReal(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.texto = FIXTURE_MONO_REAL.read_text(encoding="utf-8")
        cls.diag = parse_ffmpeg_audio_report(cls.texto)

    def test_sumario_ebur128_da_saida_real(self):
        self.assertAlmostEqual(self.diag["lufs_i"], -21.8)
        self.assertAlmostEqual(self.diag["lra"], 0.0)
        self.assertAlmostEqual(self.diag["true_peak_db"], -18.1)

    def test_astats_overall_da_saida_real(self):
        self.assertAlmostEqual(self.diag["rms_db"], -21.074024, places=6)
        self.assertAlmostEqual(self.diag["peak_db"], -18.063921, places=6)
        self.assertAlmostEqual(self.diag["crest_factor"], 1.414181, places=6)
        self.assertAlmostEqual(self.diag["noise_floor_db"], -18.063921, places=6)
        self.assertEqual(self.diag["n_samples"], 48000)
        self.assertEqual(self.diag["peak_count"], 560)

    def test_derivados_da_saida_real(self):
        self.assertEqual(self.diag["canais"], 1)
        self.assertIsNone(self.diag["stereo_corr"])
        self.assertAlmostEqual(
            self.diag["clip_pct"],
            100.0 * self.diag["peak_count"] / self.diag["n_samples"])
        # As linhas por-janela ("t: 0.09 ... I: -70.0 LUFS ...") nao podem
        # contaminar a leitura do bloco Summary.
        self.assertNotEqual(self.diag["lufs_i"], -70.0)

    def test_todas_as_chaves_do_contrato_existem(self):
        esperadas = {"lufs_i", "lra", "true_peak_db", "rms_db", "peak_db",
                     "crest_factor", "noise_floor_db", "n_samples", "peak_count",
                     "clip_pct", "stereo_corr", "canais"}
        self.assertEqual(set(self.diag.keys()), esperadas)


class TestParseCasoJuliaVirshna(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.diag = parse_ffmpeg_audio_report(SAIDA_JULIA_VIRSHNA)

    def test_numeros_medidos_do_plano(self):
        self.assertAlmostEqual(self.diag["lufs_i"], -10.4)
        self.assertAlmostEqual(self.diag["true_peak_db"], 1.5)
        self.assertAlmostEqual(self.diag["lra"], 4.5)
        self.assertAlmostEqual(self.diag["noise_floor_db"], -27.034561)
        self.assertEqual(self.diag["peak_count"], 669)
        self.assertEqual(self.diag["n_samples"], 102768)

    def test_clip_pct_calculado(self):
        self.assertAlmostEqual(self.diag["clip_pct"], 100.0 * 669 / 102768)
        self.assertAlmostEqual(self.diag["clip_pct"], 0.651, places=2)

    def test_prefere_o_bloco_overall_e_conta_canais(self):
        # Overall soma os dois canais (401 + 268 = 669); o valor vem dele.
        self.assertEqual(self.diag["canais"], 2)
        self.assertAlmostEqual(self.diag["rms_db"], -13.842117)


class TestParseBordas(unittest.TestCase):

    def test_texto_vazio_nao_explode(self):
        diag = parse_ffmpeg_audio_report("")
        for chave in ("lufs_i", "lra", "true_peak_db", "rms_db", "peak_db",
                      "crest_factor", "noise_floor_db", "n_samples",
                      "peak_count", "clip_pct", "stereo_corr"):
            self.assertIsNone(diag[chave], chave)
        self.assertEqual(diag["canais"], 0)

    def test_texto_so_lixo_nao_explode(self):
        diag = parse_ffmpeg_audio_report("ffmpeg version 7.1.4\nqualquer coisa\n")
        self.assertIsNone(diag["lufs_i"])
        self.assertEqual(diag["canais"], 0)

    def test_piso_menos_infinito_vira_menos_infinito_float(self):
        diag = parse_ffmpeg_audio_report(SAIDA_PISO_INFINITO)
        self.assertEqual(diag["noise_floor_db"], float("-inf"))
        self.assertTrue(math.isinf(diag["noise_floor_db"]))
        self.assertFalse(math.isnan(diag["noise_floor_db"]))
        self.assertIsNotNone(diag["rms_db"])

    def test_stereo_corr_none_quando_nao_relatada(self):
        self.assertIsNone(parse_ffmpeg_audio_report(SAIDA_JULIA_VIRSHNA)["stereo_corr"])

    def test_stereo_corr_extraida_quando_reportada(self):
        texto = SAIDA_OVERALL_VENCE.replace(
            "[Parsed_astats_1 @ ccc] Number of samples: 6000\n",
            "[Parsed_astats_1 @ ccc] Number of samples: 6000\n"
            "[Parsed_astats_1 @ ccc] Stereo correlation: 0.99937\n")
        diag = parse_ffmpeg_audio_report(texto)
        self.assertAlmostEqual(diag["stereo_corr"], 0.99937)

    def test_overall_vence_canal(self):
        diag = parse_ffmpeg_audio_report(SAIDA_OVERALL_VENCE)
        self.assertAlmostEqual(diag["rms_db"], -20.25)
        self.assertEqual(diag["n_samples"], 6000)
        self.assertAlmostEqual(diag["clip_pct"], 0.5)  # 100 * 30 / 6000


class TestAvaliarJuliaVirshna(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.avaliacao = avaliar(parse_ffmpeg_audio_report(SAIDA_JULIA_VIRSHNA))

    def _selo(self, metrica):
        return next(s for s in self.avaliacao["selos"] if s["metrica"] == metrica)

    def test_preset_e_o_resgate_estourado(self):
        self.assertEqual(self.avaliacao["preset_sugerido"], "resgate_estourado")

    def test_clipping_grave(self):
        selo = self._selo("clipping")
        self.assertEqual(selo["severidade"], "grave")
        self.assertIn("GRAVE", selo["texto"])

    def test_ruido_alto(self):
        selo = self._selo("ruido")
        self.assertEqual(selo["severidade"], "atencao")
        self.assertIn("ALTO", selo["texto"])

    def test_dinamica_esmagada(self):
        selo = self._selo("dinamica")
        self.assertEqual(selo["severidade"], "atencao")
        self.assertIn("ESMAGADA", selo["texto"])

    def test_loudness_alto_e_pico_estourado(self):
        self.assertIn("ALTO", self._selo("loudness")["texto"])
        selo_pico = self._selo("pico_real")
        self.assertEqual(selo_pico["severidade"], "grave")
        self.assertIn("ESTOUROU", selo_pico["texto"])

    def test_severidades_validas_para_ui(self):
        for selo in self.avaliacao["selos"]:
            self.assertIn(selo["severidade"], ("ok", "atencao", "grave"))
            self.assertIsInstance(selo["texto"], str)
            self.assertTrue(selo["texto"])

    def test_cadeia_sugerida_do_resgate(self):
        cadeia = self.avaliacao["cadeia_sugerida"]
        self.assertEqual(cadeia[0], "adeclip")   # reparo antes do denoise, sempre
        self.assertEqual(cadeia[1], "adeclick")
        self.assertIn("dpdfnet:18", cadeia)      # piso -27 -> teto de 18 dB
        self.assertIn("loudnorm:-16", cadeia)    # alvo default do contrato C4
        self.assertEqual(cadeia[-1], "alimiter")

    def test_lra_esmagado_bloqueia_speechnorm(self):
        self.assertNotIn("speechnorm", self.avaliacao["cadeia_sugerida"])


class TestAvaliarCasosGerais(unittest.TestCase):

    def test_material_saudavel_nao_sugere_nada(self):
        avaliacao = avaliar(_diag())
        self.assertIsNone(avaliacao["preset_sugerido"])
        self.assertEqual(avaliacao["cadeia_sugerida"], [])
        for selo in avaliacao["selos"]:
            self.assertEqual(selo["severidade"], "ok", selo["metrica"])

    def test_limiares_sobrescritos_mudam_a_classificacao(self):
        apertado = avaliar(_diag(lra=8.0), {"lra_esmagado": 9.0})
        selo = next(s for s in apertado["selos"] if s["metrica"] == "dinamica")
        self.assertIn("ESMAGADA", selo["texto"])

        alvo_diferente = avaliar(_diag(lufs_i=-16.2), {"alvo_lufs": -14.0})
        selo = next(s for s in alvo_diferente["selos"] if s["metrica"] == "loudness")
        self.assertIn("BAIXO", selo["texto"])

    def test_atenuacao_do_denoise_e_clampada_em_6_18(self):
        for piso, esperado in ((-20.0, 18), (-34.9, 10), (-34.0, 11)):
            with self.subTest(piso=piso):
                diag = _diag(noise_floor_db=piso)
                cadeia = avaliar(diag)["cadeia_sugerida"]
                self.assertIn(f"dpdfnet:{esperado}", cadeia)

    def test_ruido_na_faixa_media_e_so_opcional(self):
        diag = _diag(noise_floor_db=-38.0)
        avaliacao = avaliar(diag)
        self.assertNotIn("dpdfnet", " ".join(avaliacao["cadeia_sugerida"]))
        selo = next(s for s in avaliacao["selos"] if s["metrica"] == "ruido")
        self.assertIn("opcional", selo["texto"])

    def test_correlacao_baixa_avisa_duas_fontes(self):
        diag = _diag(stereo_corr=0.87)
        selo = next(s for s in avaliar(diag)["selos"] if s["metrica"] == "estereo")
        self.assertIn("Duas fontes", selo["texto"])
        # Mono duplicado (0.99937, caso da entrevista) nao gera alerta.
        diag_mono = _diag(stereo_corr=0.99937)
        selos = [s for s in avaliar(diag_mono)["selos"] if s["metrica"] == "estereo"]
        self.assertEqual(selos[0]["severidade"], "ok")

    def test_diag_vazio_devolve_estrutura_sem_selos(self):
        from src.media.audio_analysis import diagnostico_vazio
        avaliacao = avaliar(diagnostico_vazio())
        self.assertEqual(avaliacao["selos"], [])
        self.assertIsNone(avaliacao["preset_sugerido"])
        self.assertEqual(avaliacao["cadeia_sugerida"], [])

    def test_pico_acima_do_teto_mas_abaixo_de_zero_e_atencao(self):
        diag = _diag(true_peak_db=-0.8)
        selo = next(s for s in avaliar(diag)["selos"] if s["metrica"] == "pico_real")
        self.assertEqual(selo["severidade"], "atencao")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                     "ffmpeg/ffprobe nao disponiveis no PATH")
class TestAnalisarIntervalo(unittest.TestCase):

    # Escapes hatches para ambientes com %TEMP% restrito (sandbox/CI): aponte
    # CAPIAU_TEST_TMPDIR para um diretorio que ja exista e os arquivos de teste
    # nascem la, sem subdiretorio novo. Fora disso vale o mkdtemp padrao.
    _TMP_BASE = os.environ.get("CAPIAU_TEST_TMPDIR")

    @classmethod
    def setUpClass(cls):
        cls.arquivos_criados = []
        if cls._TMP_BASE:
            cls.pasta = Path(cls._TMP_BASE)
            cls._limpar_pasta = False
        else:
            cls.pasta = Path(tempfile.mkdtemp(prefix="capiau_analise_audio_"))
            cls._limpar_pasta = True
        cls.wav = cls.pasta / "sine_2s.wav"
        cls.arquivos_criados.append(cls.wav)
        shutil_rodar([
            "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=2:sample_rate=48000",
            str(cls.wav),
        ])
        cls.mp4_sem_audio = cls.pasta / "sem_audio.mp4"
        cls.arquivos_criados.append(cls.mp4_sem_audio)
        shutil_rodar([
            "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
            "-i", "color=c=black:s=64x64:d=0.3", "-c:v", "libx264",
            "-preset", "ultrafast", str(cls.mp4_sem_audio),
        ])

    @classmethod
    def tearDownClass(cls):
        if cls._limpar_pasta:
            shutil.rmtree(cls.pasta, ignore_errors=True)
        else:
            for arquivo in cls.arquivos_criados:
                arquivo.unlink(missing_ok=True)

    def test_wav_sintetico_com_intervalo(self):
        r = analisar_intervalo(self.wav, 0.5, 1.5)
        self.assertTrue(r["ok"], r["erro"])
        self.assertIsNone(r["erro"])
        self.assertIsNotNone(r["lufs_i"])
        self.assertEqual(r["canais"], 1)
        self.assertAlmostEqual(r["duracao_s"], 1.0, delta=0.01)
        self.assertEqual(r["n_samples"], 48000)
        # Todas as chaves do contrato continuam presentes no dict final.
        for chave in ("lufs_i", "clip_pct", "noise_floor_db", "ok", "erro", "duracao_s"):
            self.assertIn(chave, r)

    def test_arquivo_inteiro_sem_intervalo(self):
        r = analisar_intervalo(self.wav)
        self.assertTrue(r["ok"], r["erro"])
        self.assertAlmostEqual(r["duracao_s"], 2.0, delta=0.01)

    def test_arquivo_sem_faixa_de_audio(self):
        r = analisar_intervalo(self.mp4_sem_audio)
        self.assertFalse(r["ok"])
        self.assertIsNotNone(r["erro"])
        self.assertIn("sem faixa de audio", r["erro"].lower())

    def test_arquivo_inexistente(self):
        r = analisar_intervalo(self.pasta / "nao_existe.mts")
        self.assertFalse(r["ok"])
        self.assertIn("nao encontrado", r["erro"].lower())

    def test_intervalo_invalido(self):
        r = analisar_intervalo(self.wav, 1.5, 0.5)
        self.assertFalse(r["ok"])
        self.assertIn("Intervalo invalido", r["erro"])


# =====================================================================
# Contrato D1 (rodada 2, "onde estourou"): serie de quadros do ebur128,
# envelope para a faixa e momentos agrupados para a lista da UI.
# =====================================================================

# Linha de quadro real desta maquina (ffmpeg 7.1.4), colada do stderr.
LINHA_QUADRO_REAL = (
    "[Parsed_ebur128_0 @ 0000021831113e00] t: 0.399979   TARGET:-23 LUFS"
    "    M:  -8.2 S:-120.7     I:  -8.2 LUFS       LRA:   0.0 LU"
    "  FTPK:  -1.9  -1.9 dBFS  TPK:   0.0   0.0 dBFS"
)

# Variacao real desta maquina: em silencio digital o M cola no dois-pontos
# e mono imprime um unico valor de FTPK (fixture audio_ebur128_astats_mono).
LINHA_QUADRO_SILENCIO_MONO = (
    "[Parsed_ebur128_0 @ 0000022669999780] t: 0.0999792  TARGET:-23 LUFS"
    "    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU"
    "  FTPK: -18.1 dBFS  TPK: -18.1 dBFS"
)


def _linha_quadro(t, m="-8.2", ftpk="-1.9  -1.9"):
    """Monta uma linha de quadro no formato real trocando so os campos uteis."""
    return (
        f"[Parsed_ebur128_0 @ 0000021831113e00] t: {t}   TARGET:-23 LUFS"
        f"    M:  {m} S:-120.7     I:  -8.2 LUFS       LRA:   0.0 LU"
        f"  FTPK:  {ftpk} dBFS  TPK:   0.0   0.0 dBFS"
    )


def _quadros(*pontos):
    """[(t, ftpk)] -> serie no formato do contrato D1."""
    return [{"t": t, "m": -8.0, "ftpk": ftpk} for t, ftpk in pontos]


class _ProcFalso:
    """Substituto de subprocess.CompletedProcess para os testes com mock."""

    def __init__(self, stdout="", stderr=""):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = 0


_STDERR_FALSO_COM_QUADROS = (
    _linha_quadro("0.100000")
    + "\n" + _linha_quadro("0.200000", m="-9.0", ftpk="-1.8  -1.7")
    + "\n" + _linha_quadro("2.050000", m="-3.0", ftpk="+2.5  +1.0")
    + "\n" + SAIDA_JULIA_VIRSHNA  # bloco Summary + astats para o parser antigo
)


class TestExtrairSerie(unittest.TestCase):

    def test_linha_real_desta_maquina(self):
        serie = extrair_serie(LINHA_QUADRO_REAL)
        self.assertEqual(len(serie), 1)
        self.assertAlmostEqual(serie[0]["t"], 0.399979, places=6)
        self.assertAlmostEqual(serie[0]["m"], -8.2, places=6)
        self.assertAlmostEqual(serie[0]["ftpk"], -1.9, places=6)

    def test_linha_real_em_silencio_mono_colada_no_dois_pontos(self):
        serie = extrair_serie(LINHA_QUADRO_SILENCIO_MONO)
        self.assertEqual(len(serie), 1)
        self.assertAlmostEqual(serie[0]["t"], 0.0999792, places=7)
        self.assertAlmostEqual(serie[0]["m"], -120.7, places=6)
        self.assertAlmostEqual(serie[0]["ftpk"], -18.1, places=6)

    def test_ftpk_pega_o_maior_canal(self):
        serie = extrair_serie(_linha_quadro("1.000000", ftpk="-6.0  +1.3"))
        self.assertAlmostEqual(serie[0]["ftpk"], 1.3, places=6)

    def test_m_em_silencio_digital_nao_vira_none(self):
        serie = extrair_serie(_linha_quadro("0.500000", m="-120.7"))
        self.assertAlmostEqual(serie[0]["m"], -120.7, places=6)

    def test_texto_sem_linhas_de_quadro_devolve_lista_vazia(self):
        for texto in ("", "lixo puro\n", "ffmpeg version 7.1.4\n", SAIDA_JULIA_VIRSHNA):
            with self.subTest(texto=texto[:30]):
                self.assertEqual(extrair_serie(texto), [])

    def test_varias_linhas_na_ordem_e_summary_de_fora(self):
        texto = "\n".join([
            "ffmpeg version 7.1.4-Jellyfin Copyright",
            _linha_quadro("0.100000"),
            "Output #0, null, to 'NUL':",
            _linha_quadro("0.200000"),
            _linha_quadro("0.300000"),
            SAIDA_JULIA_VIRSHNA,
        ])
        serie = extrair_serie(texto)
        self.assertEqual([quadro["t"] for quadro in serie], [0.1, 0.2, 0.3])
        # O bloco Summary do fim nao pode entrar como se fosse quadro.
        self.assertEqual(len(serie), 3)

    def test_ftpk_infinito_fica_na_serie_sem_estourar_nada(self):
        serie = extrair_serie(_linha_quadro("0.400000", ftpk="-inf  -inf"))
        self.assertEqual(serie[0]["ftpk"], float("-inf"))
        self.assertEqual(momentos_problematicos(serie), [])


class TestResumirSerie(unittest.TestCase):

    def test_serie_vazia_devolve_vazio(self):
        self.assertEqual(resumir_serie([]), [])
        self.assertEqual(resumir_serie([{"t": None, "m": None, "ftpk": None}]), [])

    def test_menos_quadros_que_baldes_um_balde_por_quadro(self):
        serie = _quadros(*[(round(0.1 * i, 1), -3.0 + i) for i in range(1, 13)])
        envelope = resumir_serie(serie, n_baldes=600)
        self.assertEqual(len(envelope), 12)
        self.assertAlmostEqual(envelope[0]["t0"], 0.1, places=6)
        self.assertAlmostEqual(envelope[-1]["t1"], 1.2, places=6)
        for balde, quadro in zip(envelope, serie):
            self.assertAlmostEqual(balde["ftpk_max"], quadro["ftpk"], places=6)
            self.assertAlmostEqual(balde["m_med"], quadro["m"], places=6)

    def test_agrega_varios_quadros_no_mesmo_balde(self):
        serie = _quadros(*[(round(0.1 * i, 1), float(i)) for i in range(1, 301)])
        envelope = resumir_serie(serie, n_baldes=100)
        self.assertEqual(len(envelope), 100)
        primeiro = envelope[0]
        self.assertAlmostEqual(primeiro["ftpk_max"], 3.0, places=6)
        self.assertAlmostEqual(primeiro["t0"], 0.1, places=6)
        self.assertAlmostEqual(envelope[-1]["t1"], 30.0, places=6)

    def test_balde_so_com_silencio_digital_vira_none_sem_menos_infinito(self):
        serie = _quadros((0.1, float("-inf")), (0.2, float("-inf")),
                         (0.3, -2.0), (0.4, float("-inf")))
        envelope = resumir_serie(serie, n_baldes=4)
        self.assertIsNone(envelope[0]["ftpk_max"])
        self.assertAlmostEqual(envelope[2]["ftpk_max"], -2.0, places=6)
        for balde in envelope:
            self.assertNotEqual(balde["ftpk_max"], float("-inf"))

    def test_n_baldes_menor_que_a_serie_corta_o_envelope(self):
        serie = _quadros(*[(round(0.1 * i, 1), float(i)) for i in range(1, 11)])
        envelope = resumir_serie(serie, n_baldes=3)
        self.assertEqual(len(envelope), 3)
        self.assertAlmostEqual(envelope[-1]["t1"], 1.0, places=6)
        self.assertAlmostEqual(max(balde["ftpk_max"] for balde in envelope), 10.0)

    def test_um_quadro_sozinho_nao_divide_por_zero(self):
        envelope = resumir_serie([{"t": 0.3, "m": -9.0, "ftpk": -1.0}], n_baldes=8)
        self.assertEqual(len(envelope), 1)
        self.assertAlmostEqual(envelope[0]["t0"], 0.3, places=6)
        self.assertAlmostEqual(envelope[0]["t1"], 0.3, places=6)
        self.assertAlmostEqual(envelope[0]["ftpk_max"], -1.0, places=6)


class TestMomentosProblematicos(unittest.TestCase):

    def test_serie_vazia_ou_saudavel_devolvem_vazio(self):
        self.assertEqual(momentos_problematicos([]), [])
        self.assertEqual(
            momentos_problematicos(_quadros((0.1, -20.0), (0.2, -18.0))), [])

    def test_estouro_acima_de_zero_e_grave(self):
        momentos = momentos_problematicos(_quadros((405.2, 1.7)))
        self.assertEqual(len(momentos), 1)
        momento = momentos[0]
        self.assertEqual(momento["tipo"], "estouro")
        self.assertEqual(momento["severidade"], "grave")
        self.assertAlmostEqual(momento["inicio"], 405.2, places=6)
        self.assertAlmostEqual(momento["fim"], 405.2, places=6)
        self.assertAlmostEqual(momento["pico"], 1.7, places=6)

    def test_entre_teto_e_zero_e_quase_com_atencao(self):
        momentos = momentos_problematicos(_quadros((1.0, -0.8), (50.0, 0.0)))
        self.assertEqual(len(momentos), 2)
        for momento in momentos:
            self.assertEqual(momento["tipo"], "quase")
            self.assertEqual(momento["severidade"], "atencao")

    def test_limites_exatos_nao_geram_falso_positivo_nem_falso_negativo(self):
        # FTPK igual ao teto (-1.5) fica FORA; 0.0 exato ainda e "quase"; acima de 0 estoura.
        self.assertEqual(momentos_problematicos(_quadros((1.0, -1.5))), [])
        por_pico = {momento["pico"]: momento["tipo"] for momento in
                    momentos_problematicos(_quadros((1.0, 0.0), (50.0, 0.1)))}
        self.assertEqual(por_pico[0.0], "quase")
        self.assertEqual(por_pico[0.1], "estouro")

    def test_vizinhos_a_menos_de_meio_segundo_juntam_no_mesmo_momento(self):
        serie = _quadros((10.0, 2.0), (10.3, 1.0), (10.7, 1.5), (11.3, 2.0))
        momentos = momentos_problematicos(serie)
        self.assertEqual(len(momentos), 2)
        self.assertAlmostEqual(momentos[0]["inicio"], 10.0, places=6)
        self.assertAlmostEqual(momentos[0]["fim"], 10.7, places=6)
        self.assertAlmostEqual(momentos[0]["pico"], 2.0, places=6)
        self.assertAlmostEqual(momentos[1]["inicio"], 11.3, places=6)

    def test_gap_exato_de_meio_segundo_separa_os_momentos(self):
        momentos = momentos_problematicos(_quadros((10.0, 2.0), (10.5, 2.0)))
        self.assertEqual(len(momentos), 2)

    def test_quase_e_estouro_vizinhos_viram_um_momento_grave(self):
        momentos = momentos_problematicos(_quadros((1.0, 1.0), (1.2, -0.5)))
        self.assertEqual(len(momentos), 1)
        self.assertEqual(momentos[0]["tipo"], "estouro")
        self.assertEqual(momentos[0]["severidade"], "grave")
        self.assertAlmostEqual(momentos[0]["pico"], 1.0, places=6)
        self.assertAlmostEqual(momentos[0]["fim"], 1.2, places=6)

    def test_limiares_sobrescritos_mudam_o_teto(self):
        serie = _quadros((1.0, -2.0))
        self.assertEqual(momentos_problematicos(serie), [])  # teto default -1.5
        apertado = momentos_problematicos(serie, {"teto_dbtp": -3.0})
        self.assertEqual(len(apertado), 1)
        self.assertEqual(apertado[0]["tipo"], "quase")

    def test_corte_pelo_maximo_mantem_os_de_maior_pico_e_ordena_por_tempo(self):
        serie = _quadros((1.0, 1.0), (2.0, 5.0), (3.0, 3.0))
        momentos = momentos_problematicos(serie, maximo=2)
        self.assertEqual([momento["inicio"] for momento in momentos], [2.0, 3.0])
        self.assertEqual([momento["pico"] for momento in momentos], [5.0, 3.0])

    def test_saida_ordenada_por_tempo_mesmo_com_entrada_fora_de_ordem(self):
        momentos = momentos_problematicos(_quadros((9.0, 2.0), (1.0, 1.0)))
        self.assertEqual([momento["inicio"] for momento in momentos], [1.0, 9.0])


class TestConversaoTempoAbsoluto(unittest.TestCase):
    """Ponto onde mais se erra: com -ss o ffmpeg imprime t comecando em ZERO.

    analisar_intervalo e quem sabe o in_s, entao e quem soma o deslocamento
    antes de devolver envelope/momentos (contrato D1).
    """

    def _rodar(self, in_s, out_s):
        chamadas = []

        def falso_run(cmd, **kwargs):
            chamadas.append(list(cmd))
            if cmd and cmd[0] == "ffprobe":
                return _ProcFalso(stdout=(
                    '{"streams":[{"codec_type":"audio","sample_rate":"48000"}]}'))
            return _ProcFalso(stderr=_STDERR_FALSO_COM_QUADROS)

        with mock.patch("src.media.audio_analysis.subprocess.run",
                        side_effect=falso_run):
            resultado = analisar_intervalo(FIXTURE_MONO_REAL, in_s, out_s)
        return resultado, chamadas

    def test_janela_com_in_s_soma_o_deslocamento_aos_tempos(self):
        resultado, chamadas = self._rodar(405.0, 495.0)
        self.assertTrue(resultado["ok"], resultado["erro"])
        cmd_ffmpeg = next(cmd for cmd in chamadas if cmd[0] == "ffmpeg")
        self.assertIn("-ss", cmd_ffmpeg)
        self.assertIn("405.0", cmd_ffmpeg)
        # O estouro estava em t=2.05 relativo; tem que sair em 407.05 absoluto.
        self.assertEqual(len(resultado["momentos"]), 1)
        momento = resultado["momentos"][0]
        self.assertAlmostEqual(momento["inicio"], 407.05, places=3)
        self.assertAlmostEqual(momento["fim"], 407.05, places=3)
        self.assertEqual(momento["tipo"], "estouro")
        self.assertTrue(resultado["envelope"])
        for balde in resultado["envelope"]:
            self.assertGreaterEqual(balde["t0"], 405.0)
            self.assertLessEqual(balde["t1"], 495.0)

    def test_sem_in_s_os_tempos_ficam_como_o_ffmpeg_imprimiu(self):
        resultado, _ = self._rodar(None, None)
        self.assertTrue(resultado["ok"], resultado["erro"])
        self.assertAlmostEqual(resultado["momentos"][0]["inicio"], 2.05, places=3)
        self.assertAlmostEqual(resultado["envelope"][0]["t0"], 0.1, places=3)

    def test_chaves_antigas_continuam_presentes_junto_das_novas(self):
        resultado, _ = self._rodar(405.0, 495.0)
        for chave in ("lufs_i", "lra", "true_peak_db", "clip_pct", "ok",
                      "erro", "duracao_s", "envelope", "momentos"):
            self.assertIn(chave, resultado)


@unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg nao disponivel no PATH")
class TestIntervaloRealComEstouro(unittest.TestCase):
    """Prova de fogo end-to-end: wav float32 com amostras acima de 0 dBFS tem
    que gerar momentos "estouro" ja em tempo ABSOLUTO dentro da janela pedida."""

    _TMP_BASE = os.environ.get("CAPIAU_TEST_TMPDIR")

    @classmethod
    def setUpClass(cls):
        cls.arquivos_criados = []
        if cls._TMP_BASE:
            cls.pasta = Path(cls._TMP_BASE)
            cls._limpar_pasta = False
        else:
            cls.pasta = Path(tempfile.mkdtemp(prefix="capiau_estouro_audio_"))
            cls._limpar_pasta = True
        cls.wav = cls.pasta / "estourado_float.wav"
        cls.arquivos_criados.append(cls.wav)
        # O sine do ffmpeg sai com pico por volta de -18 dBFS nesta maquina
        # (ver fixture mono); +24 dB poe as amostras em torno de +6 dBFS.
        shutil_rodar([
            "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=2:sample_rate=48000,volume=24dB",
            "-c:a", "pcm_f32le", str(cls.wav),
        ])

    @classmethod
    def tearDownClass(cls):
        if cls._limpar_pasta:
            shutil.rmtree(cls.pasta, ignore_errors=True)
        else:
            for arquivo in cls.arquivos_criados:
                arquivo.unlink(missing_ok=True)

    def test_estouro_achado_com_tempo_absoluto_na_janela(self):
        r = analisar_intervalo(self.wav, 0.5, 1.5)
        self.assertTrue(r["ok"], r["erro"])
        self.assertIn("envelope", r)
        self.assertIn("momentos", r)
        self.assertTrue(r["envelope"], "esperava quadros no envelope")
        self.assertTrue(r["momentos"],
                        "wav float estourado tem que gerar momentos de estouro")
        for momento in r["momentos"]:
            self.assertEqual(momento["tipo"], "estouro")
            self.assertGreater(momento["pico"], 0.0)
            # Tempo ABSOLUTO: dentro da janela 0.5-1.5, nunca relativo a zero.
            self.assertGreaterEqual(momento["inicio"], 0.5)
            self.assertLess(momento["inicio"], 1.5)
        for balde in r["envelope"]:
            self.assertGreaterEqual(balde["t0"], 0.5)


def shutil_rodar(cmd):
    """Gera midia de teste via ffmpeg; falha de geracao aborta o caso com motivo."""
    import subprocess
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AssertionError(f"ffmpeg nao gerou a midia de teste: {proc.stderr.strip()}")


if __name__ == "__main__":
    unittest.main()
