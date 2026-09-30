"""Escolha do motor de transcrição/diarização (src/transcription/motores.py).

Sem rede e sem banco: só a tradução Configurações -> o que roda de fato, e a
prova de que o SDK instalado da AssemblyAI aceita a configuração montada.
"""
import assemblyai as aai

from src.services.settings_registry import get_registry_map
from src.transcription.motores import (
    DIARIZACAO_LIGADOS, MODELO_PRINCIPAL, MOTOR_ASSEMBLYAI, TRANSCRICAO_LIGADOS,
    aviso_modelo_usado, montar_config_assemblyai, resolver_motores,
)

REGISTRY_BY_KEY = get_registry_map()


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
        rotulos = REGISTRY_BY_KEY[chave]["enum_labels"]
        for opcao, rotulo in rotulos.items():
            assert ("em teste" in rotulo) == (opcao not in ligados), (chave, opcao)


def test_assemblyai_escolhida_nao_gera_aviso():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, MOTOR_ASSEMBLYAI)
    assert (plano.transcricao, plano.diarizacao, plano.avisos) == (MOTOR_ASSEMBLYAI, MOTOR_ASSEMBLYAI, [])


def test_motor_sem_codigo_cai_na_assemblyai_e_avisa():
    plano = resolver_motores("nvidia_canary", "nemotron_3_diarization")
    assert plano.transcricao == MOTOR_ASSEMBLYAI
    assert plano.diarizacao == MOTOR_ASSEMBLYAI
    assert len(plano.avisos) == 2
    assert "nvidia_canary" in plano.avisos[0]
    assert "nemotron_3_diarization" in plano.avisos[1]


def test_valor_vazio_usa_assemblyai_sem_aviso():
    plano = resolver_motores(None, "")
    assert plano.transcricao == MOTOR_ASSEMBLYAI and plano.diarizacao == MOTOR_ASSEMBLYAI
    assert plano.avisos == []


def test_config_pede_o_35_pro_e_teto_de_falantes():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, MOTOR_ASSEMBLYAI)
    cfg = montar_config_assemblyai(plano, "pt", True, True, 8)
    assert cfg["speech_models"][0] == MODELO_PRINCIPAL
    assert cfg["speaker_labels"] is True
    assert cfg["speaker_options"] == {"max_speakers_expected": 8}
    assert "speakers_expected" not in cfg  # contagem exata forçaria o número


def test_diarizacao_none_desliga_falantes():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, "none")
    cfg = montar_config_assemblyai(plano, "pt", True, False, 8)
    assert cfg["speaker_labels"] is False
    assert "speaker_options" not in cfg


def test_speaker_labels_desligado_nas_configuracoes_vence():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, MOTOR_ASSEMBLYAI)
    cfg = montar_config_assemblyai(plano, "pt", False, True, 8)
    assert cfg["speaker_labels"] is False
    assert "speaker_options" not in cfg


def test_sdk_instalado_aceita_a_config():
    plano = resolver_motores(MOTOR_ASSEMBLYAI, MOTOR_ASSEMBLYAI)
    cfg = montar_config_assemblyai(plano, "pt", True, True, 4)
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
