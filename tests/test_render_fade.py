"""Testes do contrato de curvas de fade do motor de render.

Duas camadas de prova:

1. A expressao ffmpeg gerada bate com o gabarito Python (`fade.avaliar`), que por
   sua vez e o porte linha a linha de `evaluateFadeCurve` do player.
2. O ffmpeg DE VERDADE avalia essa expressao e produz os mesmos numeros. Isso
   pega o que a camada 1 nao pega: erro de sintaxe, funcao inexistente no
   avaliador do ffmpeg, e o escape de virgula/dois-pontos dentro do argumento de
   filtro (que sao separadores na sintaxe de filtro e precisam de barra invertida).

A tolerancia e apertada de proposito. A divergencia real medida em 24/08/2026 e
3,7e-10 na camada 1; um passo de 8 bits e 3,9e-3. Tolerancia frouxa aqui esconde
exatamente o tipo de erro que este teste existe para achar.
"""
import shutil
import struct
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

from src.export.video_render import fade

# Vocabulario do avaliador de expressao do ffmpeg que as curvas usam.
_VOCABULARIO = {
    "_pow": lambda a, b: a ** b,
    "_clip": lambda v, a, b: max(a, min(b, v)),
    "_min": min,
    "_max": max,
}


def _avaliar_expressao(expr: str, t: float = 0.0) -> float:
    """Avalia uma expressao ffmpeg em Python, com o mesmo vocabulario."""
    seguro = (expr.replace("pow(", "_pow(")
                  .replace("clip(", "_clip(")
                  .replace("min(", "_min(")
                  .replace("max(", "_max("))
    return eval(seguro, {"__builtins__": {}}, dict(_VOCABULARIO, t=t))


def _tem_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


class TestCurvasContraGabarito(unittest.TestCase):
    """Camada 1: expressao gerada x `fade.avaliar`."""

    CASOS = [
        ("linear", 0.0), ("linear", 0.6), ("linear", -0.6),
        ("s_curve", 0.0), ("s_curve", 0.5), ("s_curve", -0.5),
        ("exponential", 0.0), ("exponential", 0.3),
        ("logarithmic", 0.0), ("logarithmic", 0.3),
        ("custom", 0.9),
        ("curva_que_nao_existe", 0.0),  # cai em linear, como no player
    ]

    def test_expressao_bate_com_gabarito(self):
        pior = 0.0
        for curva, tensao in self.CASOS:
            for i in range(21):
                p = i / 20.0
                obtido = _avaliar_expressao(fade.expressao(curva, tensao, repr(p)))
                pior = max(pior, abs(obtido - fade.avaliar(p, curva, tensao)))
        self.assertLess(pior, 1e-8, f"divergencia expressao/gabarito: {pior:.3e}")

    def test_extremos_sao_exatos(self):
        """Fade tem de comecar em 0 e terminar em 1 -- em toda curva.

        Se p=1 nao der exatamente 1, o clipe fica com um veu permanente; se p=0
        nao der 0, o fade nunca fecha. Sao os dois unicos pontos em que erro de
        arredondamento e visivel.
        """
        for curva, tensao in self.CASOS:
            self.assertAlmostEqual(fade.avaliar(0.0, curva, tensao), 0.0, places=12,
                                   msg=f"{curva}/{tensao} nao comeca em 0")
            self.assertAlmostEqual(fade.avaliar(1.0, curva, tensao), 1.0, places=12,
                                   msg=f"{curva}/{tensao} nao termina em 1")

    def test_curvas_sao_monotonas(self):
        """Nenhuma curva pode voltar atras: fade que oscila e pumping audivel."""
        for curva, tensao in self.CASOS:
            anterior = -1.0
            for i in range(101):
                atual = fade.avaliar(i / 100.0, curva, tensao)
                self.assertGreaterEqual(atual, anterior - 1e-12,
                                        f"{curva}/{tensao} nao e monotona em p={i/100}")
                anterior = atual

    def test_progresso_preso_entre_zero_e_um(self):
        """Fora da janela do fade o progresso satura, nao extrapola."""
        expr_in = fade.expressao_progresso(0.0, 1.0, "in")
        self.assertAlmostEqual(_avaliar_expressao(expr_in, t=-5.0), 0.0, places=9)
        self.assertAlmostEqual(_avaliar_expressao(expr_in, t=99.0), 1.0, places=9)
        expr_out = fade.expressao_progresso(0.0, 1.0, "out", fim_s=10.0)
        self.assertAlmostEqual(_avaliar_expressao(expr_out, t=0.0), 1.0, places=9)
        self.assertAlmostEqual(_avaliar_expressao(expr_out, t=99.0), 0.0, places=9)

    def test_fade_de_saida_exige_fim(self):
        with self.assertRaises(ValueError):
            fade.expressao_progresso(0.0, 1.0, "out")


class TestNormalizacao(unittest.TestCase):
    """Os defaults do player, que sao cheios de armadilha de JavaScript."""

    def test_duracao_zero_vira_meio_segundo(self):
        """`Math.max(0.05, cf.duration_s || 0.5)`: 0 e falsy no JS, entao vira 0.5.

        Quem porta isso na cabeca escreve max(0.05, 0) = 0.05 e erra por 10x.
        """
        self.assertEqual(fade.normalizar_duracao(0), 0.5)
        self.assertEqual(fade.normalizar_duracao(None), 0.5)
        self.assertEqual(fade.normalizar_duracao("nao e numero"), 0.5)
        self.assertEqual(fade.normalizar_duracao(0.01), 0.05)   # piso
        self.assertEqual(fade.normalizar_duracao(2.5), 2.5)

    def test_tensao_presa_e_tolerante(self):
        self.assertEqual(fade.normalizar_tensao(5), 1.0)
        self.assertEqual(fade.normalizar_tensao(-5), -1.0)
        self.assertEqual(fade.normalizar_tensao(None), 0.0)
        self.assertEqual(fade.normalizar_tensao(float("nan")), 0.0)
        self.assertEqual(fade.normalizar_tensao(float("inf")), 0.0)

    def test_atalho_linear_so_sem_tensao(self):
        """`fade=curve=tri` so pode substituir a expressao quando de fato e reta."""
        self.assertTrue(fade.usa_atalho_linear("linear", 0))
        self.assertTrue(fade.usa_atalho_linear("linear", 0.005))
        self.assertTrue(fade.usa_atalho_linear("custom", 0))
        self.assertFalse(fade.usa_atalho_linear("linear", 0.5))
        self.assertFalse(fade.usa_atalho_linear("s_curve", 0))

    def test_notacao_cientifica_nunca_aparece(self):
        """Notacao 1e-05 quebra o parser de expressao de varias builds do ffmpeg."""
        for tensao in (0.999999, -0.999999, 1e-7):
            texto = fade.expressao("s_curve", tensao, "t")
            self.assertNotIn("e-", texto)
            self.assertNotIn("E-", texto)


class TestFatorCombinado(unittest.TestCase):
    """O player usa Math.min dos fades ativos, NAO o produto (player.js:2380)."""

    def test_menor_fator_vence(self):
        efeitos = [
            {"type": "crossfade", "side": "in", "duration_s": 1.0},
            {"type": "crossfade", "side": "out", "duration_s": 1.0},
        ]
        # Clipe de 5 s: meio do fade de entrada.
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 0.5, 4.5), 0.5, places=9)
        # Miolo: nenhum fade ativo.
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 2.5, 2.5), 1.0, places=9)
        # Meio do fade de saida.
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 4.5, 0.5), 0.5, places=9)

    def test_clipe_curto_com_fades_sobrepostos(self):
        """Clipe de 1 s com fade de 1 s dos dois lados: o min importa de verdade.

        Se alguem tivesse multiplicado em vez de tomar o minimo, o meio daria
        0,25 em vez de 0,5 -- e o clipe sumiria quase por completo.
        """
        efeitos = [
            {"type": "crossfade", "side": "in", "duration_s": 1.0},
            {"type": "crossfade", "side": "out", "duration_s": 1.0},
        ]
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 0.5, 0.5), 0.5, places=9)

    def test_disabled_e_bypass(self):
        """Regra P5: bloco desligado sai da cadeia, nao vira silencio."""
        efeitos = [{"type": "crossfade", "side": "in", "duration_s": 1.0, "disabled": True}]
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 0.0, 9.0), 1.0, places=9)

    def test_ignora_efeito_de_outro_tipo(self):
        efeitos = [{"type": "color", "brightness": 50}, {"type": "volume", "level": 0.1}]
        self.assertAlmostEqual(fade.fator_combinado(efeitos, 0.0, 9.0), 1.0, places=9)

    def test_lista_vazia_ou_nula(self):
        self.assertEqual(fade.fator_combinado([], 0.0, 1.0), 1.0)
        self.assertEqual(fade.fator_combinado(None, 0.0, 1.0), 1.0)


@unittest.skipUnless(_tem_ffmpeg(), "ffmpeg nao encontrado no PATH")
class TestContraFFmpegReal(unittest.TestCase):
    """Camada 2: o ffmpeg de verdade avalia a expressao e devolve os mesmos numeros.

    Usa `aevalsrc`, que avalia uma expressao por amostra com `t` disponivel, e le
    o WAV resultante amostra a amostra. Prova sintaxe E numeros de uma vez.
    """

    @classmethod
    def setUpClass(cls):
        cls.dir = Path(tempfile.mkdtemp(prefix="capiau_fade_"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    @staticmethod
    def _escapar(expr: str) -> str:
        """Virgula e dois-pontos sao separadores na sintaxe de filtro do ffmpeg.

        Dentro de um argumento eles PRECISAM de barra invertida, senao o ffmpeg
        corta a expressao ao meio e reclama de opcao desconhecida. Toda expressao
        de curva tem virgula (o `clip(x,0,1)`), entao isso nunca e opcional.
        """
        return expr.replace("\\", "\\\\").replace(",", "\\,").replace(":", "\\:")

    def _curva_pelo_ffmpeg(self, curva, tensao, amostras=1000):
        expr = fade.expressao(curva, tensao,
                              fade.expressao_progresso(0.0, 1.0, "in"))
        destino = self.dir / f"curva_{curva}_{tensao}.wav"
        cmd = ["ffmpeg", "-y", "-v", "error", "-f", "lavfi",
               "-i", f"aevalsrc={self._escapar(expr)}:s={amostras}:d=1",
               "-c:a", "pcm_s16le", str(destino)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0,
                         f"ffmpeg recusou a expressao de {curva}/{tensao}: {res.stderr}")
        with wave.open(str(destino)) as w:
            n = w.getnframes()
            cru = w.readframes(n)
        return [v / 32767.0 for v in struct.unpack("<%dh" % n, cru)]

    def test_ffmpeg_reproduz_o_gabarito(self):
        """Tolerancia = 1 passo de 16 bits (3,05e-5), que e o piso da medicao.

        A divergencia medida em 24/08/2026 foi 1,97e-5 -- ou seja, o erro e todo
        de quantizacao do WAV, e nenhum da expressao.
        """
        passo_16_bits = 1.0 / 32767.0
        for curva, tensao in [("linear", 0.0), ("s_curve", 0.5),
                              ("exponential", 0.3), ("logarithmic", 0.3),
                              ("linear", -0.6)]:
            valores = self._curva_pelo_ffmpeg(curva, tensao)
            pior = max(abs(valores[i] - fade.avaliar(i / len(valores), curva, tensao))
                       for i in range(0, len(valores), 10))
            self.assertLess(pior, 2 * passo_16_bits,
                            f"{curva}/{tensao}: ffmpeg divergiu {pior:.3e}")


if __name__ == "__main__":
    unittest.main()
