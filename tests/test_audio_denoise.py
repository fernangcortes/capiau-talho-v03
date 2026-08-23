"""Testes do denoise por IA local (ETAPA 4 de docs/PLANO_AJUSTES_DE_AUDIO.md).

Por que existe: sherpa-onnx e o modelo ONNX NAO estao instalados nesta maquina
(decisao do dono do projeto), entao TODA a logica que nao depende do modelo tem
que provar-se hoje: regra de atenacao da secao 7 nos limites, decisao de canais
separados na fronteira 0,95, estimativa de tempo pelos RTF medidos, guardas de
caminho (F:/ so leitura; original jamais sobrescrito), validacao de hash do
modelo contra lado-car .sha256, fatiamento em blocos e o fluxo completo de
denoisar() com DUBLE no lugar do motor de IA (incluindo o caminho de
dependencia ausente, que devolve {"ok": False, "erro": motivo} sem excecao e
sem escrever nada em disco).

Escrito em unittest.TestCase no padrao dos outros testes da casa: pytest roda
esses casos sem mudanca nenhuma. Nenhum teste depende de sherpa-onnx,
soundfile ou de rede; o que continua incognita ate a instalacao esta listado
no docstring da classe TestForaDeAlcanceHoje.
"""
import hashlib
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.media import audio_denoise
from src.media.audio_denoise import (
    _fatiar,
    atenuacao_recomendada,
    denoisar,
    hash_modelo_confere,
    motor_disponivel,
    plano_de_processamento,
)

# Diagnostico real medido em 23/08/2026 no trecho 6:45-8:15 da entrevista
# Julia + Virshna (secoes 1 e 5 do plano): piso -27 dB, correlacao L/R
# 0,99937 (mono duplicado), estereo, janela de 90 s.
DIAG_ENTREVISTA = {
    "ok": True,
    "lufs_i": -10.4,
    "lra": 4.5,
    "true_peak_db": 1.5,
    "clip_pct": 0.651,
    "noise_floor_db": -27.0,
    "stereo_corr": 0.99937,
    "canais": 2,
    "duracao_s": 90.0,
}

# Diretorios temporarios dos testes ficam DENTRO do repositorio (data/tmp/):
# o ambiente de execucao nega criacao de arquivos na %TEMP% do sistema e o
# proprio plano manda derivados para data/. Limpos no tearDown de cada classe.
# Nota: usa Path.mkdir com nome unico, NAO tempfile.mkdtemp - diretorios
# nascidos de mkdtemp receberam PermissionError ao criar arquivos dentro,
# de forma estavel nesta maquina (verificado em 23/08/2026).
_BASE_TMP = Path(__file__).resolve().parents[1] / "data" / "tmp" / "testes_audio_denoise"


def _dir_temporario(prefixo: str) -> Path:
    import uuid
    _BASE_TMP.mkdir(parents=True, exist_ok=True)
    caminho = _BASE_TMP / f"{prefixo}{uuid.uuid4().hex[:12]}"
    caminho.mkdir()
    return caminho


def _limpar_dir_temporario(caminho: Path) -> None:
    shutil.rmtree(caminho, ignore_errors=True)
    try:
        caminho.parent.rmdir()   # remove data/tmp/testes_... se ficar vazio
        caminho.parent.parent.rmdir()
    except OSError:
        pass


def _diagnostico(**mudancas):
    diag = dict(DIAG_ENTREVISTA)
    for chave, valor in mudancas.items():
        if valor is None:
            diag.pop(chave, None)
        else:
            diag[chave] = valor
    return diag


class TestAtenuacaoRecomendada(unittest.TestCase):
    """Regra da secao 7 ja corrigida: clamp(piso - (-45), 6, 18)."""

    def test_limites_pedidos_pelo_briefing(self):
        self.assertEqual(atenuacao_recomendada(-27.0), 18.0)   # teto
        self.assertEqual(atenuacao_recomendada(-50.0), 6.0)    # piso
        self.assertEqual(atenuacao_recomendada(-39.0), 6.0)    # exatamente o piso

    def test_meio_da_faixa_nao_arredonda(self):
        # -38,5 - (-45) = 6,5 dB: valor continuo, quem arredonda e a UI/cadeia.
        self.assertAlmostEqual(atenuacao_recomendada(-38.5), 6.5)

    def test_extrapolados_presos_no_clamp(self):
        self.assertEqual(atenuacao_recomendada(-60.0), 6.0)
        self.assertEqual(atenuacao_recomendada(-20.0), 18.0)

    def test_sem_medida_devolve_o_minimo_conservador(self):
        self.assertEqual(atenuacao_recomendada(None), 6.0)
        self.assertEqual(atenuacao_recomendada(float("nan")), 6.0)
        # -inf pelo proprio clamp cai no minimo (silencio digital nao pede denoise).
        self.assertEqual(atenuacao_recomendada(float("-inf")), 6.0)

    def test_limiares_sobrescritaveis(self):
        self.assertEqual(
            atenuacao_recomendada(-27.0, {"max_db": 12.0}), 12.0)
        # Alvo -40: piso -30 precisa de 10 dB para chegar la.
        self.assertEqual(
            atenuacao_recomendada(-30.0, {"piso_alvo_db": -40.0}), 10.0)


class TestPlanoDeProcessamento(unittest.TestCase):

    def test_entrevista_real_julia_virshna(self):
        plano = plano_de_processamento(_diagnostico())
        self.assertTrue(plano["ok"])
        self.assertTrue(plano["processa"])
        self.assertEqual(plano["nivel"], "forte")
        self.assertEqual(plano["atenuacao_db"], 18.0)          # piso -27 -> teto
        self.assertFalse(plano["por_canal"])                   # corr 0,99937 >= 0,95
        self.assertFalse(plano["duas_fontes"])
        self.assertEqual(plano["motor_entrega"], "dpdfnet")
        self.assertEqual(plano["motor_previa"], "gtcrn")
        # Estimativa pelos RTF medidos (secao 1): 90 s x 0,82 e x 0,28.
        self.assertAlmostEqual(plano["tempo_estimado_s"]["dpdfnet"], 73.8)
        self.assertAlmostEqual(plano["tempo_estimado_s"]["gtcrn"], 25.2)
        self.assertEqual(plano["saida_hz"]["dpdfnet"], 48000)
        self.assertEqual(plano["saida_hz"]["gtcrn"], 16000)
        self.assertIn("16 kHz", plano["aviso_gtcrn"])

    def test_fronteira_de_correlacao_095(self):
        # Exatamente 0,95 NAO separa canais (a regra e estrita: < 0,95).
        plano = plano_de_processamento(_diagnostico(stereo_corr=0.95))
        self.assertFalse(plano["por_canal"])
        # Um decimo abaixo: duas fontes distintas, canal a canal.
        plano = plano_de_processamento(_diagnostico(stereo_corr=0.9499))
        self.assertTrue(plano["duas_fontes"])
        self.assertTrue(plano["por_canal"])

    def test_mono_nunca_separa_canais(self):
        plano = plano_de_processamento(_diagnostico(canais=1, stereo_corr=0.5))
        self.assertFalse(plano["por_canal"])

    def test_correlacao_ausente_vai_para_o_lado_seguro(self):
        plano = plano_de_processamento(_diagnostico(stereo_corr=None))
        self.assertTrue(plano["por_canal"])
        self.assertTrue(any("assumindo fontes distintas" in a for a in plano["avisos"]))

    def test_ruido_moderado_e_leve_opcional_com_atenuacao_dosada(self):
        plano = plano_de_processamento(_diagnostico(noise_floor_db=-38.0))
        self.assertEqual(plano["nivel"], "leve_opcional")
        self.assertTrue(plano["processa"])
        self.assertAlmostEqual(plano["atenuacao_db"], 7.0)

    def test_ruido_baixo_nao_processa_mas_guarda_a_dose(self):
        plano = plano_de_processamento(_diagnostico(noise_floor_db=-46.0))
        self.assertEqual(plano["nivel"], "nenhum")
        self.assertFalse(plano["processa"])
        self.assertEqual(plano["atenuacao_db"], 6.0)

    def test_piso_nao_medido_e_aviso_honesto(self):
        plano = plano_de_processamento(_diagnostico(noise_floor_db=None))
        self.assertIsNone(plano["atenuacao_db"])
        self.assertFalse(plano["processa"])
        self.assertTrue(any("Piso de ruido nao medido" in a for a in plano["avisos"]))

    def test_diagnostico_fallido_propaga_erro(self):
        plano = plano_de_processamento({"ok": False, "erro": "ffmpeg ausente"})
        self.assertFalse(plano["ok"])
        self.assertEqual(plano["erro"], "ffmpeg ausente")


class TestMotorDisponivel(unittest.TestCase):
    def setUp(self):
        self.raiz_tmp = _dir_temporario("denoise_raiz_")
        self._raiz_original = audio_denoise._RAIZ_PROJETO

    def tearDown(self):
        audio_denoise._RAIZ_PROJETO = self._raiz_original
        _limpar_dir_temporario(self.raiz_tmp)

    def test_estrutura_do_contrato(self):
        disp = motor_disponivel()
        self.assertEqual(set(disp), {"ok", "sherpa_onnx", "modelo",
                                     "motivo", "caminho_modelo"})
        self.assertIsInstance(disp["ok"], bool)
        self.assertIsInstance(disp["sherpa_onnx"], bool)
        self.assertIsInstance(disp["modelo"], bool)
        self.assertTrue(disp["caminho_modelo"].endswith("dpdfnet2_48khz_hr.onnx"))
        # Consistencia interna vale em qualquer maquina, hoje ou depois de
        # instalar a dependencia: ok sse tudo presente e motivo vazio.
        self.assertEqual(disp["ok"],
                         disp["sherpa_onnx"] and disp["modelo"] and disp["motivo"] is None)
        if not disp["ok"]:
            self.assertTrue(disp["motivo"])
        else:
            self.assertIsNone(disp["motivo"])

    def test_gtcrn_aponta_para_o_modelo_certo(self):
        disp = motor_disponivel(motor="gtcrn")
        self.assertTrue(disp["caminho_modelo"].endswith("gtcrn_simple.onnx"))

    def test_motor_desconhecido_vira_motivo_nao_excecao(self):
        disp = motor_disponivel(motor="hal_9000")
        self.assertFalse(disp["ok"])
        self.assertIn("motor desconhecido", disp["motivo"])

    def test_raiz_vazia_reporta_modelo_ausente_sempre(self):
        # Deterministico para sempre: nem importa se um dia sherpa-onnx for
        # instalado - sem arquivo em data/models/, modelo=False e ok=False.
        audio_denoise._RAIZ_PROJETO = self.raiz_tmp
        disp = motor_disponivel()
        self.assertFalse(disp["modelo"])
        self.assertFalse(disp["ok"])
        self.assertIn("modelo ausente", disp["motivo"])
        self.assertIn("data/models/", disp["motivo"])


class TestHashModelo(unittest.TestCase):
    def setUp(self):
        self.dir_tmp = _dir_temporario("denoise_hash_")

    def tearDown(self):
        _limpar_dir_temporario(self.dir_tmp)

    def test_lado_car_valido_confere(self):
        modelo = self.dir_tmp / "dpdfnet2_48khz_hr.onnx"
        modelo.write_bytes(b"MODELO-FAKE-ONNX")
        digesto = hashlib.sha256(modelo.read_bytes()).hexdigest()
        Path(str(modelo) + ".sha256").write_text(digesto + "\n", encoding="ascii")
        confere, motivo = hash_modelo_confere(caminho=modelo)
        self.assertTrue(confere)
        self.assertIsNone(motivo)

    def test_hash_divergente_rejeita(self):
        modelo = self.dir_tmp / "dpdfnet2_48khz_hr.onnx"
        modelo.write_bytes(b"MODELO-FAKE-ONNX")
        outro = hashlib.sha256(b"outra-copia").hexdigest()
        Path(str(modelo) + ".sha256").write_text(outro, encoding="ascii")
        confere, motivo = hash_modelo_confere(caminho=modelo)
        self.assertFalse(confere)
        self.assertIn("nao confere", motivo)

    def test_sem_lado_car_nao_bloqueia(self):
        modelo = self.dir_tmp / "gtcrn_simple.onnx"
        modelo.write_bytes(b"x")
        confere, motivo = hash_modelo_confere(caminho=modelo)
        self.assertTrue(confere)
        self.assertIsNone(motivo)   # release k2-fsa nao publica hash do dpdfnet


class TestFatiamento(unittest.TestCase):

    def test_blocos_cobrem_tudo_sem_sobreposicao(self):
        blocos = list(_fatiar(305, 100))
        self.assertEqual(blocos, [(0, 100), (100, 200), (200, 300), (300, 305)])
        cobertos = [i for ini, fim in blocos for i in range(ini, fim)]
        self.assertEqual(cobertos, list(range(305)))

    def test_amostra_menor_que_o_bloco(self):
        self.assertEqual(list(_fatiar(10, 100)), [(0, 10)])
        self.assertEqual(list(_fatiar(0, 100)), [])


class _MotorFalso:
    """Duble do OfflineSpeechDenoiser: registra chamadas e abafa o bloco."""

    def __init__(self, fator=0.5):
        self.fator = fator
        self.chamadas = []

    def run(self, bloco, sr):
        import numpy as np
        self.chamadas.append((bloco.shape, sr))
        resultado = type("Enhanced", (), {})()
        resultado.samples = np.asarray(bloco, dtype=np.float32) * self.fator
        resultado.sample_rate = sr
        return resultado


class TestDenoisar(unittest.TestCase):
    def setUp(self):
        self.dir_tmp = _dir_temporario("denoise_teste_")
        self.origem = self.dir_tmp / "original.wav"
        self.origem.write_bytes(b"ORIGINAL-NUNCA-TOCADO")
        self.destino = self.dir_tmp / "derivado" / "tratado.wav"
        self.patches = []
        self._raiz_original = audio_denoise._RAIZ_PROJETO

    def tearDown(self):
        audio_denoise._RAIZ_PROJETO = self._raiz_original
        for p in self.patches:
            p.stop()
        _limpar_dir_temporario(self.dir_tmp)

    def _preparar_modelo_fake(self):
        """Raiz temporaria com modelo fake + lado-car sha256 correto."""
        audio_denoise._RAIZ_PROJETO = self.dir_tmp / "raiz_projeto"
        modelo = audio_denoise.caminho_modelo("dpdfnet")
        modelo.parent.mkdir(parents=True, exist_ok=True)
        modelo.write_bytes(b"MODELO-FAKE-ONNX")
        digesto = hashlib.sha256(modelo.read_bytes()).hexdigest()
        Path(str(modelo) + ".sha256").write_text(digesto + "\n", encoding="ascii")

    def _instalar_dubles(self, forma=(48000,), sr=48000, gravar=None):
        import numpy as np

        motor_falso = _MotorFalso()

        def ler_wav_fake(caminho, always_2d):
            return np.zeros(forma, dtype=np.float32), sr

        if gravar is None:
            def gravar(caminho, dados, taxa):
                # O duble cria o arquivo mesmo, para provar o rename atomico.
                with open(caminho, "wb") as fh:
                    fh.write(b"WAV-FALSO")

        patchers = [
            mock.patch.object(
                audio_denoise, "motor_disponivel",
                lambda motor="dpdfnet", raiz=None: {
                    "ok": True, "sherpa_onnx": True, "modelo": True,
                    "motivo": None, "caminho_modelo": "fake.onnx"}),
            mock.patch.object(
                audio_denoise, "_decodificar_wav", lambda src, tmp, hz: None),
            mock.patch.object(audio_denoise, "_ler_wav", ler_wav_fake),
            mock.patch.object(audio_denoise, "_gravar_wav", gravar),
            mock.patch.object(
                audio_denoise, "_carregar_denoise",
                lambda caminho, motor, att, sem_limite: (motor_falso, [])),
        ]
        for p in patchers:
            p.start()
            self.patches.append(p)
        return motor_falso

    def test_recusa_escrever_no_acervo_f(self):
        res = denoisar(self.origem, "F:/talho/tratado.wav", 12.0)
        self.assertFalse(res["ok"])
        self.assertIn("F:", res["erro"])
        self.assertIn("somente leitura", res["erro"])

    def test_original_nunca_sobrescrito(self):
        antes = self.origem.read_bytes()
        res = denoisar(self.origem, self.origem, 12.0)
        self.assertFalse(res["ok"])
        self.assertIn("jamais", res["erro"])
        self.assertEqual(self.origem.read_bytes(), antes)

    def test_origem_inexistente(self):
        res = denoisar(self.dir_tmp / "fantasma.mts", self.destino, 12.0)
        self.assertFalse(res["ok"])
        self.assertIn("nao encontrado", res["erro"])

    def test_atenuacoes_invalidas(self):
        for valor in (0, -3, "abc", float("nan")):
            res = denoisar(self.origem, self.destino, valor)
            self.assertFalse(res["ok"], f"valor {valor!r} deveria ser recusado")
            self.assertIn("Atenuacao invalida", res["erro"])

    def test_fora_da_faixa_e_preso_no_teto_com_aviso_mesmo_sem_processar(self):
        # A checagem de atenacao roda ANTES da disponibilidade: o aviso aparece
        # mesmo hoje, sem sherpa-onnx na maquina.
        res = denoisar(self.origem, self.destino, 30.0)
        self.assertEqual(res["atenuacao_db"], 18.0)
        self.assertTrue(any("fora de [6, 18]" in a for a in res["avisos"]))
        self.assertFalse(self.destino.exists())

    def test_sem_limite_so_por_parametro_explicito_e_avisa(self):
        # Default: preso no teto, nunca sem limite.
        res = denoisar(self.origem, self.destino, 30.0)
        self.assertFalse(res["sem_limite"])
        self.assertEqual(res["atenuacao_db"], 18.0)
        # Explicito: passa o valor pedido, com o aviso forte registrado.
        res = denoisar(self.origem, self.destino, 40.0, sem_limite=True)
        self.assertTrue(res["sem_limite"])
        self.assertEqual(res["atenuacao_db"], 40.0)
        self.assertTrue(any("ambiencia sera DESTRUIDA" in a for a in res["avisos"]))
        self.assertFalse(res["ok"])   # segue indisponivel hoje, mas avisou

    def test_dependencia_ausente_ok_false_motivo_e_nada_em_disco(self):
        audio_denoise._RAIZ_PROJETO = self.dir_tmp / "raiz_sem_nada"
        res = denoisar(self.origem, self.destino, 12.0)
        self.assertFalse(res["ok"])
        self.assertTrue(res["erro"])
        # Hoje falta sherpa-onnx E soundfile E o modelo; depois de instalar,
        # sobra so o "modelo ausente". O ponto fixo: motivo claro e zero escrita.
        self.assertNotIn("Traceback", str(res["erro"]))
        self.assertFalse(self.destino.exists())
        lixo = [p.name for p in self.destino.parent.iterdir()] \
            if self.destino.parent.exists() else []
        self.assertEqual(lixo, [])

    def test_fluxo_completo_com_duble_mono(self):
        self._preparar_modelo_fake()
        motor_falso = self._instalar_dubles(forma=(48000,))
        etapas = []
        res = denoisar(self.origem, self.destino, 12.0,
                       progresso=lambda frac, texto: etapas.append(frac))
        self.assertTrue(res["ok"], res["erro"])
        self.assertEqual(res["motor"], "dpdfnet")
        self.assertEqual(res["saida_hz"], 48000)
        self.assertAlmostEqual(res["duracao_s"], 1.0)   # 48000 amostras / 48 kHz
        self.assertTrue(self.destino.exists())
        self.assertEqual(self.destino.read_bytes(), b"WAV-FALSO")
        # Um bloco so (30 s > 1 s), canal unico, progresso termina em 100%.
        self.assertEqual(len(motor_falso.chamadas), 1)
        self.assertEqual(etapas[-1], 1.0)
        # Nenhum temporario ".denoise_*" sobrando ao lado do destino.
        sobras = [p.name for p in self.destino.parent.iterdir()]
        self.assertEqual(sobras, ["tratado.wav"])

    def test_fluxo_com_duble_por_canal(self):
        self._preparar_modelo_fake()
        motor_falso = self._instalar_dubles(forma=(48000, 2))
        res = denoisar(self.origem, self.destino, 12.0, por_canal=True)
        self.assertTrue(res["ok"], res["erro"])
        self.assertTrue(res["por_canal"])
        # Duas fontes -> o motor mono roda uma vez POR canal.
        self.assertEqual(len(motor_falso.chamadas), 2)
        formas = {forma for forma, _ in motor_falso.chamadas}
        self.assertEqual(formas, {(48000,)})

    def test_gtcrn_carrega_aviso_de_previa(self):
        self._preparar_modelo_fake()
        self._instalar_dubles(forma=(16000,), sr=16000)
        res = denoisar(self.origem, self.destino, 12.0, motor="gtcrn")
        self.assertTrue(res["ok"], res["erro"])
        self.assertTrue(any("16 kHz" in a and "PREVIA" in a for a in res["avisos"]))
        self.assertEqual(res["saida_hz"], 16000)

    def test_motor_desconhecido_recusado(self):
        res = denoisar(self.origem, self.destino, 12.0, motor="elevenlabs")
        self.assertFalse(res["ok"])
        self.assertIn("Motor desconhecido", res["erro"])

    def test_falha_no_meio_nao_deixa_arquivo_pela_metade(self):
        self._preparar_modelo_fake()

        def gravar_quebrado(caminho, dados, taxa):
            raise ValueError("disco cheio simulado")

        self._instalar_dubles(forma=(48000,), gravar=gravar_quebrado)
        res = denoisar(self.origem, self.destino, 12.0)
        self.assertFalse(res["ok"])
        self.assertIn("disco cheio simulado", res["erro"])
        self.assertFalse(self.destino.exists())
        sobras = [p.name for p in self.destino.parent.iterdir()] \
            if self.destino.parent.exists() else []
        self.assertEqual(sobras, [])   # temporarios limpos no finally


class TestContratoDeImportacaoPreguicoso(unittest.TestCase):
    """O modulo inteiro importa e responde sem NENHUMA dependencia opcional.

    O que ESTE teste NAO pode provar nesta maquina (sherpa-onnx e soundfile
    ausentes, modelo nao baixado): que o OfflineSpeechDenoiser aceita os nomes
    de classe/campo usados em _carregar_denoise (costura unica de integracao:
    qualquer desvio de versao se corrige num lugar so); que o ffmpeg decodifica
    pcm_f32le e o soundfile le/grava PCM_24 no par real (os dubles substituem
    exatamente essas costuras); qualidade perceptiva do denoise e RTF reais.
    """

    def test_modulo_importa_sem_dependencias_e_expoe_a_api(self):
        for nome in ("motor_disponivel", "atenuacao_recomendada",
                     "plano_de_processamento", "denoisar", "hash_modelo_confere"):
            self.assertTrue(callable(getattr(audio_denoise, nome)), nome)

    def test_checar_import_reporta_ausencia_sem_excecao(self):
        ok, motivo = audio_denoise._checar_import("modulo_certamente_inexistente_xyz")
        self.assertFalse(ok)
        self.assertIn("modulo_certamente_inexistente_xyz", motivo)
