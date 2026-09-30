"""Escolha e execução dos motores de transcrição/diarização (src/transcription/motores.py).

Sem rede e sem banco: tradução Configurações -> o que roda de fato, prova de que
o SDK instalado da AssemblyAI aceita a configuração montada, e o Deepgram com
HTTP falso.
"""
from pathlib import Path

import assemblyai as aai
import pytest

from src.services.settings_registry import get_registry_map
from src.transcription.motores import (
    DEEPGRAM_URL, DIARIZACAO_LIGADOS, DIARIZACAO_PROPRIA, MODELO_PRINCIPAL, MOTOR_ASSEMBLYAI,
    MOTOR_DEEPGRAM, SEM_DIARIZACAO, TRANSCRICAO_LIGADOS, ErroASR, OpcoesASR, aviso_modelo_usado,
    montar_config_assemblyai, parametros_deepgram, resolver_motores, transcrever, transcrever_deepgram,
)

REGISTRY_BY_KEY = get_registry_map()


# -- Configurações -----------------------------------------------------------------

def test_padrao_das_configuracoes_e_um_motor_ligado():
    assert REGISTRY_BY_KEY["transcription.engine"]["default"] in TRANSCRICAO_LIGADOS
    assert REGISTRY_BY_KEY["diarization.engine"]["default"] in DIARIZACAO_LIGADOS


def test_toda_opcao_da_lista_tem_rotulo():
    for chave in ("transcription.engine", "diarization.engine"):
        entrada = REGISTRY_BY_KEY[chave]
        assert set(entrada["enum"]) == set(entrada["enum_labels"])


def test_opcoes_sem_codigo_estao_marcadas_em_teste():
    for chave, ligados in (("transcription.engine", TRANSCRICAO_LIGADOS),
                           ("diarization.engine", DIARIZACAO_LIGADOS)):
        for opcao, rotulo in REGISTRY_BY_KEY[chave]["enum_labels"].items():
            assert ("em teste" in rotulo) == (opcao not in ligados), (chave, opcao)


# -- Resolução do plano ------------------------------------------------------------

@pytest.mark.parametrize("motor", [MOTOR_ASSEMBLYAI, MOTOR_DEEPGRAM])
def test_motor_ligado_com_diarizacao_do_mesmo_motor_nao_avisa(motor):
    plano = resolver_motores(motor, "mesmo_motor")
    assert (plano.transcricao, plano.diarizacao, plano.avisos) == (motor, DIARIZACAO_PROPRIA, [])


def test_valor_antigo_da_diarizacao_conta_como_mesmo_motor():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, "assemblyai_universal_35")
    assert plano.diarizacao == DIARIZACAO_PROPRIA and plano.avisos == []


def test_diarizacao_de_outro_motor_de_nuvem_usa_a_do_motor_escolhido_e_avisa():
    plano = resolver_motores(MOTOR_DEEPGRAM, "assemblyai_universal_35")
    assert plano.transcricao == MOTOR_DEEPGRAM and plano.diarizacao == DIARIZACAO_PROPRIA
    assert len(plano.avisos) == 1 and "deepgram_nova_3" in plano.avisos[0]


def test_motor_sem_codigo_cai_na_assemblyai_e_avisa():
    plano = resolver_motores("nvidia_canary", "nemotron_3_diarization")
    assert plano.transcricao == MOTOR_ASSEMBLYAI
    assert plano.diarizacao == DIARIZACAO_PROPRIA
    assert len(plano.avisos) == 2
    assert "nvidia_canary" in plano.avisos[0]
    assert "nemotron_3_diarization" in plano.avisos[1]


def test_valor_vazio_usa_assemblyai_sem_aviso():
    plano = resolver_motores(None, "")
    assert plano.transcricao == MOTOR_ASSEMBLYAI and plano.diarizacao == DIARIZACAO_PROPRIA
    assert plano.avisos == []


def test_none_desliga_diarizacao():
    assert resolver_motores(MOTOR_DEEPGRAM, "none").diarizacao == SEM_DIARIZACAO


# -- AssemblyAI -----------------------------------------------------------------------

def test_config_pede_o_35_pro_e_teto_de_falantes():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, "mesmo_motor")
    cfg = montar_config_assemblyai(plano, "pt", True, True, 8)
    assert cfg["speech_models"][0] == MODELO_PRINCIPAL
    assert cfg["speaker_labels"] is True
    assert cfg["speaker_options"] == {"max_speakers_expected": 8}
    assert "speakers_expected" not in cfg  # contagem exata forçaria o número


def test_diarizacao_none_desliga_falantes():
    cfg = montar_config_assemblyai(resolver_motores(MOTOR_ASSEMBLYAI, "none"), "pt", True, False, 8)
    assert cfg["speaker_labels"] is False and "speaker_options" not in cfg


def test_speaker_labels_desligado_nas_configuracoes_vence():
    cfg = montar_config_assemblyai(resolver_motores(MOTOR_ASSEMBLYAI, "mesmo_motor"), "pt", False, True, 8)
    assert cfg["speaker_labels"] is False and "speaker_options" not in cfg


def test_sdk_instalado_aceita_a_config():
    cfg = montar_config_assemblyai(resolver_motores(MOTOR_ASSEMBLYAI, "mesmo_motor"), "pt", True, True, 4)
    cfg["speaker_options"] = aai.SpeakerOptions(**cfg["speaker_options"])
    raw = aai.TranscriptionConfig(**cfg).raw
    assert raw.speech_models == ["universal-3-5-pro", "universal-2"]
    assert raw.language_code == "pt"
    assert raw.speaker_labels is True
    assert raw.speaker_options.max_speakers_expected == 4


def test_aviso_quando_a_api_usa_outro_modelo():
    assert aviso_modelo_usado(MODELO_PRINCIPAL) is None
    assert aviso_modelo_usado(None) is None
    assert "universal-2" in aviso_modelo_usado("universal-2")


def test_motor_de_nuvem_sem_chave_para_com_instrucao(tmp_path):
    with pytest.raises(ErroASR, match="deepgram"):
        transcrever(tmp_path / "a.mp3", resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"), OpcoesASR(), None)


# -- Deepgram -------------------------------------------------------------------------

CHAVE_DG = "dg_chave_de_teste_456"


class _Resp:
    def __init__(self, status, corpo):
        self.status_code, self._corpo = status, corpo
        self.text = corpo if isinstance(corpo, str) else ""

    def json(self):
        return self._corpo


class _Http:
    def __init__(self, resp):
        self.resp, self.pedidos = resp, []

    def post(self, url, **kw):
        kw["corpo"] = kw["data"].read()
        self.pedidos.append((url, kw))
        return self.resp


RESPOSTA_DG = {
    "metadata": {"model_info": {"u1": {"name": "general-nova-3", "version": "2026-01-01", "arch": "nova-3"}}},
    "results": {"channels": [{"alternatives": [{"words": [
        {"word": "oi", "punctuated_word": "Oi,", "start": 0.1, "end": 0.4, "confidence": 0.99, "speaker": 0},
        {"word": "tudo", "punctuated_word": "tudo", "start": 0.5, "end": 0.8, "confidence": 0.97, "speaker": 1},
    ]}]}]},
}


@pytest.fixture
def audio(tmp_path) -> Path:
    arq = tmp_path / "trecho.mp3"
    arq.write_bytes(b"ID3fake")
    return arq


def test_deepgram_parametros_documentados():
    params = parametros_deepgram(resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"), OpcoesASR(idioma="pt"))
    assert params == {"model": "nova-3", "language": "pt", "punctuate": "true",
                      "smart_format": "true", "diarize_model": "latest"}
    sem = parametros_deepgram(resolver_motores(MOTOR_DEEPGRAM, "none"), OpcoesASR(idioma="pt"))
    assert "diarize_model" not in sem


def test_deepgram_envia_o_audio_e_converte_as_palavras(audio):
    http = _Http(_Resp(200, RESPOSTA_DG))
    r = transcrever_deepgram(audio, resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"), OpcoesASR(), CHAVE_DG, http=http)
    url, kw = http.pedidos[0]
    assert url == DEEPGRAM_URL == "https://api.deepgram.com/v1/listen"
    assert kw["headers"]["Authorization"] == f"Token {CHAVE_DG}"
    assert kw["headers"]["Content-Type"] == "audio/mpeg"
    assert kw["corpo"] == b"ID3fake"
    assert kw["timeout"]
    assert r.motor == MOTOR_DEEPGRAM and r.modelo_usado == "general-nova-3 2026-01-01"
    assert r.palavras == [
        {"word": "Oi,", "start_time": 0.1, "end_time": 0.4, "speaker_id": "Falante A", "confidence": 0.99},
        {"word": "tudo", "start_time": 0.5, "end_time": 0.8, "speaker_id": "Falante B", "confidence": 0.97},
    ]


def test_deepgram_erro_http_nao_vaza_a_chave(audio):
    http = _Http(_Resp(401, f"chave invalida {CHAVE_DG}"))
    with pytest.raises(ErroASR) as e:
        transcrever_deepgram(audio, resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"), OpcoesASR(), CHAVE_DG, http=http)
    assert "HTTP 401" in str(e.value) and CHAVE_DG not in str(e.value)


def test_deepgram_avisa_que_entidades_so_existem_na_assemblyai(audio):
    http = _Http(_Resp(200, RESPOSTA_DG))
    r = transcrever_deepgram(audio, resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"),
                             OpcoesASR(detectar_entidades=True), CHAVE_DG, http=http)
    assert any("entidades" in a for a in r.avisos) and r.entidades == []
