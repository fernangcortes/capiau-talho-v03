"""Testes do servico de nuvem de audio (ETAPA 5 de PLANO_AJUSTES_DE_AUDIO).

Cobre o miolo provavel da etapa sem NENHUMA requisicao de rede: o transporte
HTTP e um duble (TransporteFalso) roteirizado resposta a resposta. Cenarios de
montar_algorithms usam as medicoes reais do plano (secao 1: entrevista Julia +
Virshna com piso -27 dB, LRA 4,5, true peak +1,5 dBTP) e os perfis de preset
da secao 7 (voz_limpa, resgate_estourado, ambiencia_preservada, arquivo).

Tambem cobre: caminho sem chave (erro acionavel, zero rede), timeout, espera
crescente so em erro transitorio e a garantia de NUNCA reenviar um submit
(aceito ou ambiguo) para nao gastar a cota de 2 h/mes duas vezes.

Rodada de ajuste manual da nuvem (contrato L1 do briefing): dehum/dehumamount
no bloco automatico (Auto nos dois), sobrescrita manual via ``overrides``
validada contra ``campos_ajustaveis()`` - campo desconhecido ou valor fora da
grade levanta erro dizendo o campo e os valores aceitos; silence_cutter e
filler_cutter ficam SEMPRE False e fora do catalogo ajustavel.

Padrao da casa: unittest.TestCase, roda com
    python -m unittest tests.test_audio_cloud
"""
import json
import shutil
import unittest
import uuid
from datetime import date
from pathlib import Path
from unittest import mock

from src.services.audio_cloud import (
    GRADE_DEHUM,
    GRADE_DEHUMAMOUNT,
    GRADE_MAXLRA,
    AudioCloudAuthError,
    AudioCloudConfigError,
    AudioCloudError,
    AudioCloudOverrideInvalidoError,
    AudioCloudProvider,
    AudioCloudQuotaExceededError,
    AudioCloudTransientError,
    AuphonicProvider,
    COTA_MENSAL_SEGUNDOS,
    RegistroDeCota,
    RespostaNuvem,
    campos_ajustaveis,
    duracao_wav_segundos,
    montar_algorithms,
)

CHAVE_TESTE = "chave-de-teste"

# Rascunho DENTRO do workspace (o sandbox nega escrita no Temp da maquina).
BASE_RASCUNHO = Path(__file__).resolve().parent / "_tmp_audio_cloud"


def _pasta_teste() -> Path:
    pasta = BASE_RASCUNHO / uuid.uuid4().hex[:12]
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


def _wav_temporario(pasta: Path, duracao_s: float = 1.0) -> Path:
    """WAV mono 8 kHz real (stdlib wave) para estimativa de duracao/cota."""
    caminho = pasta / f"trecho_{uuid.uuid4().hex[:6]}.wav"
    import wave

    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * int(8000 * duracao_s))
    return caminho

# Diagnostico real da entrevista Julia + Virshna (secao 1 do plano).
DIAG_JULIA_VIRSHNA = {
    "lufs": -10.4, "tp": 1.5, "nf": -27.0, "lra": 4.5, "clip_pct": 0.00651,
}

CHAVES_BLOCO = {
    "loudnesstarget", "normloudness", "maxpeak", "denoise", "denoiseamount",
    "denoisemethod", "filtering", "filtermethod", "leveler", "levelerstrength",
    "dehum", "dehumamount",
    "silence_cutter", "filler_cutter",
}


class TransporteFalso:
    """Duble de transporte HTTP: roteiriza respostas/erros e conta chamadas."""

    def __init__(self, resultados=None):
        self.resultados = list(resultados or [])
        self.chamadas = []          # [(metodo, url)]
        self.posts = 0
        self.gets = 0
        self.ultimo_post_kwargs = {}

    def _proximo(self, metodo, url):
        self.chamadas.append((metodo, url))
        if not self.resultados:
            raise AssertionError(f"duble sem resposta roteirizada para {metodo} {url}")
        item = self.resultados.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url, **kwargs):
        self.posts += 1
        self.ultimo_post_kwargs = kwargs
        return self._proximo("POST", url)

    def get(self, url, **kwargs):
        self.gets += 1
        return self._proximo("GET", url)


def _provedor(transporte, cota_path, esperas, **extras):
    return AuphonicProvider(
        api_key=CHAVE_TESTE,
        transporte=transporte,
        cota_path=cota_path,
        espera_fn=esperas.append,
        **extras,
    )


# ---------------------------------------------------------------------------
# montar_algorithms: a tabela da secao 8, cenario por cenario
# ---------------------------------------------------------------------------


class TesteMontarAlgorithms(unittest.TestCase):
    def test_entrevista_limpa_nao_toca_no_timbre(self):
        # Voz bem captada: piso -52 dB, LRA 7, sem clipping.
        diag = {"lufs": -18.0, "tp": -1.0, "nf": -52.0, "lra": 7.0, "clip_pct": 0.0}
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertFalse(bloco["denoise"])          # material limpo: sem denoise
        # -1 = Off. ZERO significa "automatico" no Auphonic, nao "desligado".
        self.assertEqual(bloco["denoiseamount"], -1)
        self.assertEqual(bloco["filtermethod"], "autoeq")  # padrao de entrevista
        self.assertTrue(bloco["leveler"])           # LRA 7: leveler moderado
        self.assertEqual(bloco["levelerstrength"], 40)   # grade de 10 em 10
        self.assertEqual(bloco["loudnesstarget"], -16.0)
        self.assertEqual(bloco["maxpeak"], -1.5)
        self.assertTrue(bloco["normloudness"])

    def test_entrevista_estourada_julia_virshna(self):
        # O caso real: piso -27, LRA 4,5, tp +1,5, clip 0,651%.
        bloco = montar_algorithms(DIAG_JULIA_VIRSHNA, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(bloco, {
            "loudnesstarget": -16.0,
            "normloudness": True,
            "maxpeak": -1.5,
            "denoise": True,
            "denoiseamount": 18,        # clamp(-27 - (-45), 6, 18) = 18, regra corrigida
            "denoisemethod": "static",  # preserva a ambiencia da sala
            "filtering": True,          # sem isto o filtermethod fica inerte
            "filtermethod": "autoeq",
            "leveler": False,           # LRA 4,5 < 5: ja esmagada, nao comprimir de novo
            "levelerstrength": 0,
            "dehum": 0,                 # Auto nos dois: detector do Auphonic decide
            "dehumamount": 0,
            "silence_cutter": False,
            "filler_cutter": False,
        })
        self.assertFalse(bloco["denoisemethod"] == "speech_isolation")  # resgate comum

    def test_dehum_auto_no_bloco_automatico_em_todo_cenario(self):
        # Contrato L1: zumbido de rede fica em Auto (0) nos dois campos - a
        # deteccao local ja foi tentada e falhou na verificacao. E dehumamount
        # NAO e a mesma coisa que denoiseamount: um pode ter valor enquanto o
        # outro segue em Auto.
        cenarios = [
            DIAG_JULIA_VIRSHNA,
            {"lufs": -18.0, "tp": -1.0, "nf": -52.0, "lra": 7.0, "clip_pct": 0.0},
            {},
        ]
        for diag in cenarios:
            bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
            self.assertEqual(bloco["dehum"], 0, f"diag={diag}")
            self.assertEqual(bloco["dehumamount"], 0, f"diag={diag}")
        # Prova de que sao campos distintos: denoiseamount ativo nao arrasta
        # o dehumamount.
        bloco = montar_algorithms(DIAG_JULIA_VIRSHNA, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(bloco["denoiseamount"], 18)
        self.assertEqual(bloco["dehumamount"], 0)

    def test_material_de_arquivo_sem_agudos_usa_bwe(self):
        # Fita antiga digitalizada: sem agudos, ruido de fita baixo, LRA alto.
        diag = {"lufs": -20.0, "tp": -2.0, "nf": -60.0, "lra": 14.0, "clip_pct": 0.0,
                "sem_agudos": True}
        bloco = montar_algorithms(diag, alvo_lufs=-20.0, teto_dbtp=-2.0)
        self.assertEqual(bloco["filtermethod"], "bwe")
        self.assertFalse(bloco["denoise"])
        self.assertTrue(bloco["leveler"])
        self.assertEqual(bloco["levelerstrength"], 100)  # LRA >= 12 satura

    def test_plano_de_rua_preserva_ambiencia(self):
        # Som direto de rua: ruido leve (-38), dinamica natural, nada agressivo.
        diag = {"lufs": -22.0, "tp": -0.5, "nf": -38.0, "lra": 9.0, "clip_pct": 0.0}
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.0)
        self.assertTrue(bloco["denoise"])
        self.assertEqual(bloco["denoiseamount"], 6)      # faixa -45..-35: denoise leve
        self.assertEqual(bloco["denoisemethod"], "static")  # static preserva ambiencia
        self.assertTrue(bloco["leveler"])
        # A grade do Auphonic anda de 10 em 10: 64 nunca foi um valor aceito.
        self.assertEqual(bloco["levelerstrength"], 60)

    def test_ruido_variavel_troca_para_dynamic(self):
        diag = dict(DIAG_JULIA_VIRSHNA, ruido_variavel=True)
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(bloco["denoisemethod"], "dynamic")

    def test_resgate_extremo_usa_speech_isolation_e_studiovoice(self):
        diag = dict(DIAG_JULIA_VIRSHNA, resgate_extremo=True)
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(bloco["denoisemethod"], "speech_isolation")
        self.assertEqual(bloco["filtermethod"], "studiovoice")
        self.assertEqual(bloco["denoiseamount"], 18)

    def test_resgate_extremo_derivado_das_medidas_sem_dica(self):
        # tp estourado + piso pessimo (-22) + clipping audivel => extremo sozinho.
        diag = {"lufs": -8.0, "tp": 1.2, "nf": -22.0, "lra": 4.0, "clip_pct": 0.002}
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.0)
        self.assertEqual(bloco["denoisemethod"], "speech_isolation")
        self.assertEqual(bloco["filtermethod"], "studiovoice")

    def test_documentario_nunca_corta_automatico(self):
        # Regra em negrito da secao 8: em NENHUM cenario silence/filler cutter liga.
        cenarios = [
            {"lufs": -18.0, "tp": -1.0, "nf": -52.0, "lra": 7.0, "clip_pct": 0.0},
            dict(DIAG_JULIA_VIRSHNA),
            {"lufs": -20.0, "tp": -2.0, "nf": -60.0, "lra": 14.0, "clip_pct": 0.0,
             "sem_agudos": True},
            {"lufs": -22.0, "tp": -0.5, "nf": -38.0, "lra": 9.0, "clip_pct": 0.0},
            dict(DIAG_JULIA_VIRSHNA, resgate_extremo=True),
            {},  # diag vazio tambem
        ]
        for diag in cenarios:
            bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
            self.assertFalse(bloco["silence_cutter"], f"diag={diag}")
            self.assertFalse(bloco["filler_cutter"], f"diag={diag}")

    def test_clamps_de_alvo_e_teto(self):
        bloco = montar_algorithms({}, alvo_lufs=-12.0, teto_dbtp=2.0)
        self.assertEqual(bloco["loudnesstarget"], -13.0)  # faixa Auphonic -31..-13
        self.assertEqual(bloco["maxpeak"], 0.0)
        bloco = montar_algorithms({}, alvo_lufs=-40.0, teto_dbtp=-9.0)
        self.assertEqual(bloco["loudnesstarget"], -31.0)
        self.assertEqual(bloco["maxpeak"], -9.0)   # -9 esta na grade aceita

    def test_formato_do_bloco_e_diag_intacto(self):
        diag = dict(DIAG_JULIA_VIRSHNA)
        copia = dict(diag)
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(set(bloco), CHAVES_BLOCO)   # so campos do Auphonic
        self.assertEqual(diag, copia)                # funcao pura: nao altera a entrada


# ---------------------------------------------------------------------------
# Overrides: sobrescrita manual DEPOIS da decisao automatica, sempre validada
# ---------------------------------------------------------------------------


class TesteOverridesManuais(unittest.TestCase):
    """Contrato L1: override e aplicado depois da decisao automatica.

    Nada sai daqui invalidado: producao recusada pelo Auphonic gasta o envio
    do mesmo jeito, entao campo desconhecido ou valor fora da grade levanta
    erro dizendo o campo e os valores aceitos - nunca ignora calado.
    """

    def _monta(self, **overrides):
        return montar_algorithms(DIAG_JULIA_VIRSHNA, -16.0, -1.5, overrides)

    def test_override_valido_substitui_a_decisao_automatica(self):
        # A automacao escolheu denoiseamount 18 e static; o dono discordou.
        bloco = self._monta(denoiseamount=6, denoisemethod="dynamic")
        self.assertEqual(bloco["denoiseamount"], 6)
        self.assertEqual(bloco["denoisemethod"], "dynamic")
        # O resto segue decidido pela medicao.
        self.assertTrue(bloco["denoise"])
        self.assertEqual(bloco["filtermethod"], "autoeq")
        self.assertFalse(bloco["leveler"])

    def test_override_de_campo_fora_do_bloco_automatico_entra(self):
        # gate/compressor/msclassifier/maxlra/loudnessmethod nao sao decididos
        # pela pre-analise; via override, entram no bloco.
        bloco = self._monta(gate=True, compressor="medium", msclassifier="speech",
                            maxlra=8, loudnessmethod="dialog")
        self.assertTrue(bloco["gate"])
        self.assertEqual(bloco["compressor"], "medium")
        self.assertEqual(bloco["msclassifier"], "speech")
        self.assertEqual(bloco["maxlra"], 8)
        self.assertEqual(bloco["loudnessmethod"], "dialog")

    def test_campo_desconhecido_levanta_erro_com_campos_aceitos(self):
        with self.assertRaises(AudioCloudOverrideInvalidoError) as ctx:
            self._monta(nivel_inexistente=3)
        msg = str(ctx.exception)
        self.assertIn("nivel_inexistente", msg)     # diz O CAMPO...
        self.assertIn("leveler", msg)               # ...e os campos aceitos
        self.assertIn("desconhecido", msg)

    def test_valor_fora_da_grade_levanta_erro_com_valores_aceitos(self):
        # 55 nao e degrau do levelerstrength (vai de 10 em 10).
        with self.assertRaises(AudioCloudOverrideInvalidoError) as ctx:
            self._monta(levelerstrength=55)
        msg = str(ctx.exception)
        self.assertIn("levelerstrength", msg)
        self.assertIn("55", msg)                    # diz o valor recusado...
        self.assertIn("50", msg)                    # ...e a grade aceita
        self.assertIn("60", msg)

    def test_override_tentando_ligar_os_cortadores_e_recusado(self):
        # Regra em NEGRITO do plano: documentario nunca corta automatico,
        # nem por sobrescrita manual. Nem True, nem False manual.
        for campo in ("silence_cutter", "filler_cutter"):
            for valor in (True, False):
                with self.subTest(campo=campo, valor=valor):
                    with self.assertRaises(AudioCloudOverrideInvalidoError) as ctx:
                        self._monta(**{campo: valor})
                    msg = str(ctx.exception)
                    self.assertIn(campo, msg)
                    self.assertIn("nunca", msg.lower())
                    self.assertIn("recusada", msg.lower())

    def test_bool_com_numero_e_recusado(self):
        # Em Python bool e subclasse de int; denoise=1 burlaria a checagem se
        # fosse aceito por igualdade numerica. Erro honesto, sem calado.
        with self.assertRaises(AudioCloudOverrideInvalidoError) as ctx:
            self._monta(denoise=1)
        self.assertIn("true ou false", str(ctx.exception))
        # E numero em campo de grade tambem nao vira boleano por igualdade:
        with self.assertRaises(AudioCloudOverrideInvalidoError):
            self._monta(dehum=False)   # False == 0 enganaria a grade (0, 50, 60)

    def test_overrides_vazio_ou_none_mudam_nada(self):
        base = montar_algorithms(DIAG_JULIA_VIRSHNA, -16.0, -1.5)
        self.assertEqual(montar_algorithms(DIAG_JULIA_VIRSHNA, -16.0, -1.5, None), base)
        self.assertEqual(montar_algorithms(DIAG_JULIA_VIRSHNA, -16.0, -1.5, {}), base)

    def test_erro_de_override_e_da_familia_do_modulo(self):
        # A rota (L2) pode capturar AudioCloudError e responder 400.
        with self.assertRaises(AudioCloudError):
            self._monta(campo_errado=True)


# ---------------------------------------------------------------------------
# campos_ajustaveis: fonte unica de verdade para rota (L2) e interface (L4)
# ---------------------------------------------------------------------------


class TesteCamposAjustaveis(unittest.TestCase):
    ROTULOS_OBRIGATORIOS = {
        "denoise": "Reducao de ruido",
        "denoisemethod": "Metodo de reducao",
        "filtering": "Realce de voz",
        "leveler": "Nivelador",
        "levelerstrength": "Forca do nivelador",
        "dehum": "Zumbido da rede eletrica",
        "loudnesstarget": "Alvo de volume",
        "maxpeak": "Teto de pico",
    }

    def test_nao_expoe_os_dois_cortadores(self):
        catalogo = campos_ajustaveis()
        self.assertNotIn("silence_cutter", catalogo)
        self.assertNotIn("filler_cutter", catalogo)

    def test_formato_do_contrato(self):
        for campo, spec in campos_ajustaveis().items():
            with self.subTest(campo=campo):
                self.assertIn(spec["tipo"], ("bool", "select"))
                if spec["tipo"] == "bool":
                    self.assertIsNone(spec["valores"])
                else:
                    self.assertIsInstance(spec["valores"], tuple)
                    self.assertTrue(spec["valores"],
                                    f"{campo}: grade vazia")
                self.assertIsInstance(spec["rotulo"], str)
                self.assertTrue(spec["rotulo"].strip())
                self.assertIsInstance(spec["ajuda"], str)
                self.assertTrue(spec["ajuda"].strip())

    def test_rotulos_obrigatorios_em_portugues_claro(self):
        catalogo = campos_ajustaveis()
        for campo, rotulo in self.ROTULOS_OBRIGATORIOS.items():
            self.assertEqual(catalogo[campo]["rotulo"], rotulo,
                             f"rotulo de {campo}")

    def test_cobre_o_bloco_automatico_e_os_campos_somente_de_override(self):
        catalogo = set(campos_ajustaveis())
        esperados = (CHAVES_BLOCO - {"silence_cutter", "filler_cutter"}) | {
            "gate", "compressor", "msclassifier", "maxlra", "loudnessmethod",
        }
        self.assertEqual(catalogo, esperados)

    def test_grades_da_interface_sao_as_conferidas_no_catalogo(self):
        catalogo = campos_ajustaveis()
        self.assertEqual(catalogo["dehum"]["valores"], GRADE_DEHUM)
        self.assertEqual(catalogo["dehumamount"]["valores"], GRADE_DEHUMAMOUNT)
        self.assertEqual(catalogo["maxlra"]["valores"], GRADE_MAXLRA)
        # denoiseamount inclui os marcadores especiais 0 (Auto) e -1 (Off).
        valores = catalogo["denoiseamount"]["valores"]
        self.assertIn(0, valores)
        self.assertIn(-1, valores)
        self.assertIn(36, valores)

    def test_mutar_o_retorno_nao_corrompe_a_proxima_chamada(self):
        primeira = campos_ajustaveis()
        primeira["leveler"]["rotulo"] = "apagado"
        segunda = campos_ajustaveis()
        self.assertNotEqual(segunda["leveler"]["rotulo"], "apagado")


# ---------------------------------------------------------------------------
# Caminho sem chave: erro acionavel, zero rede
# ---------------------------------------------------------------------------


class TesteSemChave(unittest.TestCase):
    def setUp(self):
        self.tmp = _pasta_teste()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        # A chave e resolvida de forma PREGUICOSA, na hora da chamada - nao na
        # construcao. Se os mocks so envolverem o construtor, o metodo acaba
        # encontrando a chave real do usuario no banco e o cenario "sem chave"
        # deixa de existir (foi o que aconteceu quando o dono configurou a dele).
        # Por isso os patches ficam ativos durante o teste INTEIRO.
        p1 = mock.patch("src.services.settings_service.SettingsService.get_settings",
                        side_effect=RuntimeError("sem settings no teste"))
        p2 = mock.patch.dict("os.environ", {"AUPHONIC_API_KEY": ""}, clear=False)
        p1.start(); self.addCleanup(p1.stop)
        p2.start(); self.addCleanup(p2.stop)

    def _provedor_sem_chave(self, transporte):
        return AuphonicProvider(api_key="", transporte=transporte,
                                cota_path=self.tmp / "cota.json")

    def test_submit_sem_chave_explica_onde_configurar(self):
        transporte = TransporteFalso()
        provedor = self._provedor_sem_chave(transporte)
        with self.assertRaises(AudioCloudConfigError) as ctx:
            provedor.submit(_wav_temporario(self.tmp), {})
        msg = str(ctx.exception)
        self.assertIn("api.auphonic_key", msg)
        self.assertIn("AUPHONIC_API_KEY", msg)
        self.assertEqual(transporte.posts, 0)   # nada saiu da maquina

    def test_poll_e_fetch_sem_chave_nao_chamam_rede(self):
        transporte = TransporteFalso()
        provedor = self._provedor_sem_chave(transporte)
        with self.assertRaises(AudioCloudConfigError):
            provedor.poll("uuid-qualquer")
        with self.assertRaises(AudioCloudConfigError):
            provedor.fetch("uuid-qualquer", self.tmp / "saida.wav")
        self.assertEqual(transporte.chamadas, [])


# ---------------------------------------------------------------------------
# submit: uma tentativa, nunca reenvio, cota
# ---------------------------------------------------------------------------


class TesteSubmit(unittest.TestCase):
    def setUp(self):
        self.tmp = _pasta_teste()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cota_path = self.tmp / "cota.json"

    def test_submit_aceito_devolve_uuid_e_registra_cota(self):
        wav = _wav_temporario(self.tmp, 1.0)
        transporte = TransporteFalso([
            RespostaNuvem(200, json.dumps({"uuid": "uuid-abc-123"}).encode()),
        ])
        provedor = _provedor(transporte, self.cota_path, [])
        algoritmos = montar_algorithms(DIAG_JULIA_VIRSHNA, -16.0, -1.5)
        uuid = provedor.submit(wav, algoritmos)
        self.assertEqual(uuid, "uuid-abc-123")
        self.assertEqual(transporte.posts, 1)
        metodo, url = transporte.chamadas[0]
        self.assertEqual(url, "https://auphonic.com/api/simple/productions.json")
        # Bearer + bloco algorithms em JSON no formulario multipart
        self.assertEqual(transporte.ultimo_post_kwargs["headers"]["Authorization"],
                         f"Bearer {CHAVE_TESTE}")
        self.assertIn("input_file", transporte.ultimo_post_kwargs["files"])
        formulario = transporte.ultimo_post_kwargs["data"]
        self.assertEqual(json.loads(formulario["algorithms"]), algoritmos)
        self.assertIn(uuid, provedor.producoes_aceitas)
        self.assertAlmostEqual(provedor.quota_status()["usado_segundos"], 1.0, delta=0.05)

    def test_submit_com_erro_5xx_nao_reenvia(self):
        transporte = TransporteFalso([RespostaNuvem(502, b"bad gateway")])
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudTransientError) as ctx:
            provedor.submit(_wav_temporario(self.tmp), {})
        self.assertIn("NAO reenvie", str(ctx.exception))
        self.assertEqual(transporte.posts, 1)  # UMA tentativa, sem retry

    def test_submit_com_timeout_nao_reenvia_e_avisa_sobre_cota(self):
        transporte = TransporteFalso([TimeoutError("estouro de tempo")])
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudTransientError) as ctx:
            provedor.submit(_wav_temporario(self.tmp), {})
        self.assertIn("pode ter sido criada", str(ctx.exception))
        self.assertEqual(transporte.posts, 1)

    def test_submit_com_chave_invalida_erro_claro(self):
        transporte = TransporteFalso([RespostaNuvem(401, b'{"error": "bad key"}')])
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudAuthError):
            provedor.submit(_wav_temporario(self.tmp), {})
        self.assertEqual(transporte.posts, 1)

    def test_submit_com_cota_esgotada_nao_sai_da_maquina(self):
        mes = date.today().strftime("%Y-%m")
        RegistroDeCota(self.cota_path).registrar(COTA_MENSAL_SEGUNDOS + 1, mes=mes)
        transporte = TransporteFalso()
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudQuotaExceededError):
            provedor.submit(_wav_temporario(self.tmp), {})
        self.assertEqual(transporte.posts, 0)  # bloqueio antes de qualquer rede

    def test_submit_wav_inexistente_erro_claro(self):
        transporte = TransporteFalso()
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudError) as ctx:
            provedor.submit(self.tmp / "fantasma.wav", {})
        self.assertIn("fantasma.wav", str(ctx.exception))
        self.assertEqual(transporte.posts, 0)


# ---------------------------------------------------------------------------
# poll/fetch: retry transitorio com espera crescente
# ---------------------------------------------------------------------------


class TestePollEFetch(unittest.TestCase):
    def setUp(self):
        self.tmp = _pasta_teste()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cota_path = self.tmp / "cota.json"

    def test_poll_normaliza_status_e_progresso(self):
        corpo = json.dumps({"status": {"status": 3, "progress": 100}}).encode()
        transporte = TransporteFalso([RespostaNuvem(200, corpo)])
        provedor = _provedor(transporte, self.cota_path, [])
        estado = provedor.poll("uuid-1")
        self.assertEqual(estado["status"], "concluido")
        self.assertEqual(estado["progress"], 100.0)

    def test_poll_repete_transitorio_com_espera_crescente(self):
        corpo = json.dumps({"status": {"status": 2, "progress": 50}}).encode()
        transporte = TransporteFalso([
            TimeoutError("t1"), ConnectionError("t2"), RespostaNuvem(200, corpo),
        ])
        esperas = []
        provedor = _provedor(transporte, self.cota_path, esperas)
        estado = provedor.poll("uuid-2")
        self.assertEqual(estado["status"], "processando")
        self.assertEqual(estado["progress"], 50.0)
        self.assertEqual(transporte.gets, 3)
        self.assertEqual(esperas, [1.0, 2.0])  # espera crescente 1s, 2s

    def test_poll_4xx_nao_se_repete(self):
        transporte = TransporteFalso([RespostaNuvem(404, b"{}")])
        esperas = []
        provedor = _provedor(transporte, self.cota_path, esperas)
        with self.assertRaises(AudioCloudError):
            provedor.poll("uuid-inexistente")
        self.assertEqual(transporte.gets, 1)
        self.assertEqual(esperas, [])

    def test_poll_esgota_tentativas_e_levanta_transitorio(self):
        transporte = TransporteFalso([TimeoutError("t1"), TimeoutError("t2"),
                                      TimeoutError("t3")])
        esperas = []
        provedor = _provedor(transporte, self.cota_path, esperas)
        with self.assertRaises(AudioCloudTransientError):
            provedor.poll("uuid-3")
        self.assertEqual(transporte.gets, 3)
        self.assertEqual(esperas, [1.0, 2.0])

    def test_fetch_grava_o_arquivo_e_devolve_o_caminho(self):
        destino = self.tmp / "saida" / "tratado.wav"
        chunks = iter([b"cabecalho", b"+dados", b"+fim"])
        transporte = TransporteFalso([RespostaNuvem(200, b"", chunks=chunks)])
        provedor = _provedor(transporte, self.cota_path, [])
        resultado = provedor.fetch("uuid-4", destino)
        self.assertEqual(resultado, destino)
        self.assertEqual(destino.read_bytes(), b"cabecalho+dados+fim")

    def test_fetch_com_queda_no_meio_apaga_parcial_e_refaz(self):
        destino = self.tmp / "tratado.wav"

        def chunks_com_queda():
            yield b"parte-"
            raise TimeoutError("rede caiu")

        chunks_bons = iter([b"parte-", b"final"])
        transporte = TransporteFalso([
            RespostaNuvem(200, b"", chunks=chunks_com_queda()),
            RespostaNuvem(200, b"", chunks=chunks_bons),
        ])
        esperas = []
        provedor = _provedor(transporte, self.cota_path, esperas)
        resultado = provedor.fetch("uuid-5", destino)
        self.assertEqual(destino.read_bytes(), b"parte-final")  # refaz do zero
        self.assertEqual(transporte.gets, 2)
        self.assertEqual(esperas, [1.0])

    def test_fetch_que_sempre_falha_nao_deixa_arquivo_parcial(self):
        destino = self.tmp / "tratado.wav"

        def chunks_com_queda():
            yield b"pedaco"
            raise ConnectionError("cai de novo")

        transporte = TransporteFalso([
            RespostaNuvem(200, b"", chunks=chunks_com_queda()),
            RespostaNuvem(200, b"", chunks=chunks_com_queda()),
            RespostaNuvem(200, b"", chunks=chunks_com_queda()),
        ])
        provedor = _provedor(transporte, self.cota_path, [])
        with self.assertRaises(AudioCloudTransientError):
            provedor.fetch("uuid-6", destino)
        self.assertFalse(destino.exists())  # nunca sobra WAV corrompido


# ---------------------------------------------------------------------------
# Protocolo e cota
# ---------------------------------------------------------------------------


class TesteProtocolo(unittest.TestCase):
    def test_auphonic_provider_satisfaz_o_protocolo_da_secao_8(self):
        provedor = AuphonicProvider(api_key="x")
        self.assertIsInstance(provedor, AudioCloudProvider)
        for metodo in ("submit", "poll", "fetch"):
            self.assertTrue(callable(getattr(provedor, metodo)))


class TesteCota(unittest.TestCase):
    def setUp(self):
        self.tmp = _pasta_teste()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.cota = RegistroDeCota(self.tmp / "cota.json")

    def test_cota_nova_tem_2_horas_inteiras(self):
        r = self.cota.status()
        self.assertEqual(r["limite_segundos"], 7200.0)
        self.assertEqual(r["restante_segundos"], 7200.0)
        self.assertFalse(r["perto_do_limite"])
        self.assertFalse(r["estourado"])

    def test_consumo_soma_e_avisa_quando_perto_do_fim(self):
        self.cota.registrar(3600.0)   # 1 h
        r = self.cota.status()
        self.assertAlmostEqual(r["usado_segundos"], 3600.0)
        self.assertFalse(r["perto_do_limite"])
        self.cota.registrar(2500.0)   # total 6100 s = 84,7%
        r = self.cota.status()
        self.assertAlmostEqual(r["usado_segundos"], 6100.0)
        self.assertTrue(r["perto_do_limite"])
        self.assertFalse(r["estourado"])

    def test_mes_anterior_nao_conta_no_atual(self):
        self.cota.registrar(7200.0, mes="2000-01")  # mes velho: rollover natural
        r = self.cota.status()
        self.assertEqual(r["restante_segundos"], 7200.0)

    def test_arquivo_corrompido_recomeca_do_zero(self):
        self.cota.path.write_text("isto nao e json", encoding="utf-8")
        r = self.cota.status()
        self.assertEqual(r["usado_segundos"], 0.0)

    def test_duracao_wav_para_estimativa_de_cota(self):
        wav = _wav_temporario(self.tmp, 2.5)
        self.assertAlmostEqual(duracao_wav_segundos(wav), 2.5, delta=0.001)
        self.assertIsNone(duracao_wav_segundos(self.tmp / "nao-existe.wav"))

    def test_mensagem_cota_para_a_ui(self):
        provedor = AuphonicProvider(api_key="x", cota_path=self.tmp / "cota2.json")
        texto = provedor.mensagem_cota()
        self.assertIn("2h", texto)
        provedor.cota.registrar(7000.0)
        texto = provedor.mensagem_cota()
        self.assertIn("ATENCAO", texto)



class TesteGradeDoAuphonic(unittest.TestCase):
    """Os campos numericos do Auphonic sao SELECT, nao faixa continua.

    Este teste existe porque a primeira versao mandava valores fora da grade
    (levelerstrength 53, 86, 36; denoiseamount 10, 11, 13...) - a tabela em prosa
    do plano descrevia a intencao ("proporcional ao LRA") sem dizer que o campo
    e discreto. Producao recusada gasta o envio do mesmo jeito, e a cota do free
    tier e de 2 h por mes.

    Grades conferidas em 23/08/2026 em https://auphonic.com/api/info/algorithms.json
    (endpoint publico de informacao; nao consome cota).
    """

    GRADES = {
        "loudnesstarget": {-13, -14, -15, -16, -18, -19, -20, -23, -24, -26, -27, -31},
        "maxpeak": {0.0, -0.5, -1.0, -1.5, -2.0, -3.0, -4.0, -5.0, -6.0, -9.0},
        "denoiseamount": {0, -1, 3, 6, 9, 12, 15, 18, 24, 30, 36, 100},
        "levelerstrength": {0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120},
        "denoisemethod": {"classic", "static", "dynamic", "speech_isolation"},
        "filtermethod": {"hipfilter", "autoeq", "bwe", "studiovoice"},
        # Campos novos do bloco automatico (zumbido da rede eletrica).
        "dehum": {0, 50, 60},
        "dehumamount": {0, -1, 3, 6, 9, 12, 15, 18, 24, 30, 100},
    }

    def _conferir(self, bloco, contexto):
        for campo, aceitos in self.GRADES.items():
            self.assertIn(bloco[campo], aceitos,
                          f"{campo}={bloco[campo]!r} fora da grade do Auphonic ({contexto})")

    def test_varredura_de_piso_de_ruido_fica_na_grade(self):
        for decimo in range(-600, -200, 3):          # piso de -60,0 a -20,0 dB
            diag = {"lufs": -18.0, "tp": -1.0, "nf": decimo / 10.0,
                    "lra": 8.0, "clip_pct": 0.0}
            bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
            self._conferir(bloco, f"piso {decimo / 10.0} dB")

    def test_varredura_de_lra_fica_na_grade(self):
        for decimo in range(0, 300, 2):              # LRA de 0,0 a 30,0
            diag = {"lufs": -18.0, "tp": -1.0, "nf": -33.0,
                    "lra": decimo / 10.0, "clip_pct": 0.0}
            bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
            self._conferir(bloco, f"LRA {decimo / 10.0}")

    def test_alvos_pedidos_fora_da_grade_sao_encaixados(self):
        # O usuario pode configurar -17 LUFS; o Auphonic nao aceita -17.
        bloco = montar_algorithms({}, alvo_lufs=-17.0, teto_dbtp=-1.2)
        self._conferir(bloco, "alvos fora da grade")

    def test_filtering_acompanha_o_filtermethod(self):
        """filtermethod sem filtering=True fica inerte no Auphonic."""
        diag = {"lufs": -18.0, "tp": -1.0, "nf": -52.0, "lra": 7.0, "clip_pct": 0.0}
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertEqual(bloco["filtermethod"], "autoeq")
        self.assertTrue(bloco["filtering"])

    def test_denoise_desligado_manda_off_e_nao_automatico(self):
        """No Auphonic, denoiseamount 0 significa AUTOMATICO; desligado e -1."""
        diag = {"lufs": -18.0, "tp": -1.0, "nf": -60.0, "lra": 7.0, "clip_pct": 0.0}
        bloco = montar_algorithms(diag, alvo_lufs=-16.0, teto_dbtp=-1.5)
        self.assertFalse(bloco["denoise"])
        self.assertEqual(bloco["denoiseamount"], -1)

if __name__ == "__main__":
    unittest.main()
