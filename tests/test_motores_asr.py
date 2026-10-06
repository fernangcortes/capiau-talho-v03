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
    plano = resolver_motores("motor_que_nao_existe", "diarizador_que_nao_existe")
    assert plano.transcricao == MOTOR_ASSEMBLYAI
    assert plano.diarizacao == DIARIZACAO_PROPRIA
    assert len(plano.avisos) == 2
    assert "motor_que_nao_existe" in plano.avisos[0]
    assert "diarizador_que_nao_existe" in plano.avisos[1]


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
    assert params == {"model": "nova-3", "language": "pt", "punctuate": "true", "diarize_model": "latest"}
    assert "smart_format" not in params  # numerais: "uma" virava "1"
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


# -- Whisper Turbo (local) ------------------------------------------------------------

class _PalavraW:
    def __init__(self, word, start, end, probability):
        self.word, self.start, self.end, self.probability = word, start, end, probability


class _SegW:
    def __init__(self, words):
        self.words = words


class _WhisperFalso:
    def __init__(self):
        self.chamadas = []

    def transcribe(self, audio, **kw):
        self.chamadas.append((audio, kw))
        segs = (s for s in [_SegW([_PalavraW(" Oi,", 0.0, 0.3, 0.9), _PalavraW(" ", 0.3, 0.3, 0.1)]),
                            _SegW([_PalavraW(" tudo", 0.4, 0.7, 0.8)])])
        return segs, None


def test_whisper_sem_diarizacao_propria_avisa_e_fica_sem_falante(monkeypatch, audio):
    from src.transcription import motores
    monkeypatch.setattr(motores, "audio_16k", lambda a: "AMOSTRAS")
    plano = resolver_motores("whisper_turbo", "mesmo_motor")
    assert plano.diarizacao == SEM_DIARIZACAO
    assert any("não separa falantes" in a for a in plano.avisos)

    falso = _WhisperFalso()
    r = motores.transcrever_whisper(audio, plano, OpcoesASR(idioma="pt"), modelo=falso)
    amostras, kw = falso.chamadas[0]
    assert amostras == "AMOSTRAS"
    assert kw["language"] == "pt" and kw["word_timestamps"] is True
    assert [p["word"] for p in r.palavras] == ["Oi,", "tudo"]
    assert {p["speaker_id"] for p in r.palavras} == {"Desconhecido"}
    assert r.motor == "whisper_turbo"


# -- Nemotron 3 Diarization (diarizador separado) ----------------------------------------

def test_nemotron_com_whisper_e_com_assemblyai():
    plano = resolver_motores("whisper_turbo", "nemotron_3_diarization")
    assert plano.diarizacao == "nemotron_3_diarization" and plano.avisos == []
    plano_aai = resolver_motores(MOTOR_ASSEMBLYAI, "nemotron_3_diarization")
    # A AssemblyAI não cobra a diarização dela quando o Nemotron vai separar os falantes
    assert montar_config_assemblyai(plano_aai, "pt", True, False, 8)["speaker_labels"] is False


def test_atribuir_falantes_por_sobreposicao_e_folga():
    from src.transcription.motores import atribuir_falantes
    palavras = [
        {"word": "a", "start_time": 0.0, "end_time": 0.4, "speaker_id": "x", "confidence": 1},
        {"word": "b", "start_time": 1.0, "end_time": 1.6, "speaker_id": "x", "confidence": 1},  # sobreposta
        {"word": "c", "start_time": 2.3, "end_time": 2.5, "speaker_id": "x", "confidence": 1},  # 0,3 s depois
        {"word": "d", "start_time": 9.0, "end_time": 9.2, "speaker_id": "x", "confidence": 1},  # longe
    ]
    segmentos = [{"inicio": 0.0, "fim": 1.2, "falante": 0}, {"inicio": 1.1, "fim": 2.0, "falante": 1}]
    r = atribuir_falantes(palavras, segmentos)
    assert [p["speaker_id"] for p in r] == ["Falante A", "Falante B", "Falante B", "Desconhecido"]
    assert palavras[0]["speaker_id"] == "x"  # não altera a lista original


def test_transcrever_aplica_o_diarizador_separado(monkeypatch, audio):
    from src.transcription import motores
    monkeypatch.setattr(motores, "audio_16k", lambda a: "AMOSTRAS")
    monkeypatch.setattr(motores, "_carregar_whisper", lambda: _WhisperFalso())
    monkeypatch.setattr(motores, "diarizar_nemotron",
                        lambda a: ([{"inicio": 0.0, "fim": 1.0, "falante": 2}], "nvidia/Nemotron-3-Diarization"))
    r = motores.transcrever(audio, resolver_motores("whisper_turbo", "nemotron_3_diarization"), OpcoesASR(), None)
    assert {p["speaker_id"] for p in r.palavras} == {"Falante C"}
    assert r.modelo_usado.endswith("+ nvidia/Nemotron-3-Diarization")


def test_sem_venv_nemo_o_erro_diz_onde_procurou(monkeypatch, tmp_path, audio):
    from src.transcription import motores
    monkeypatch.setenv("CAPIAU_VENV_NEMO", str(tmp_path / "nao_existe"))
    with pytest.raises(ErroASR, match=".venv-nemo não encontrado"):
        motores.diarizar_nemotron(audio)


# -- Canary e checagem de alucinação ---------------------------------------------------------

def test_canary_ligado_sem_diarizacao_propria():
    plano = resolver_motores("nvidia_canary", "mesmo_motor")
    assert plano.transcricao == "nvidia_canary" and plano.diarizacao == SEM_DIARIZACAO


def test_canary_converte_a_saida_do_worker(monkeypatch, audio):
    from src.transcription import motores
    monkeypatch.setattr(motores, "_rodar_worker_nemo", lambda tarefa, a, *extra: {
        "modelo": "nvidia/canary-1b-v2", "palavras": [{"word": "Mas", "start": 0.0, "end": 0.08}]})
    r = motores.transcrever_canary(audio, resolver_motores("nvidia_canary", "none"), OpcoesASR(idioma="pt"))
    assert r.palavras == [{"word": "Mas", "start_time": 0.0, "end_time": 0.08,
                           "speaker_id": "Desconhecido", "confidence": 1.0}]
    assert any("confiança" in a for a in r.avisos)


def _p(texto):
    return [{"word": w} for w in texto.split()]


def test_repeticao_em_loop_acha_o_trecho_e_ignora_fala_normal():
    from src.transcription.motores import repeticao_em_loop
    assert repeticao_em_loop(_p("eu " + "Não é possível. " * 8)) == "não é possível"
    assert repeticao_em_loop(_p("sim sim sim, pode ir que eu vou depois")) is None
    assert repeticao_em_loop(_p("a b " * 5)) is None  # 5 < limite de 6


def test_transcrever_avisa_alucinacao(monkeypatch, audio):
    from src.transcription import motores
    monkeypatch.setattr(motores, "_rodar_worker_nemo", lambda tarefa, a, *extra: {
        "modelo": "c", "palavras": [{"word": "Não", "start": i, "end": i + 0.1} for i in range(10)]})
    r = motores.transcrever(audio, resolver_motores("nvidia_canary", "none"), OpcoesASR(), None)
    assert any("alucinação" in a for a in r.avisos)


def test_preco_por_hora_segue_o_motor_escolhido():
    from src.transcription.motores import preco_hora_usd
    completo = OpcoesASR(diarizar=True, detectar_entidades=True)
    assert preco_hora_usd(resolver_motores(MOTOR_ASSEMBLYAI, "mesmo_motor"), completo) == 0.31
    # Nemotron separa os falantes: a AssemblyAI não cobra a diarização dela
    assert preco_hora_usd(resolver_motores(MOTOR_ASSEMBLYAI, "nemotron_3_diarization"), completo) == 0.29
    assert preco_hora_usd(resolver_motores(MOTOR_DEEPGRAM, "mesmo_motor"), completo) == 0.258
    assert preco_hora_usd(resolver_motores("whisper_turbo", "nemotron_3_diarization"), completo) == 0.0


def test_pyannote_e_diarizador_separado(monkeypatch):
    from src.transcription import motores
    plano = resolver_motores("whisper_turbo", "pyannote_40")
    assert plano.diarizacao == "pyannote_40" and plano.avisos == []
    chamados = []
    monkeypatch.setattr(motores, "_rodar_worker_nemo", lambda tarefa, a, *e: chamados.append(tarefa) or
                        {"modelo": "m", "segmentos": []})
    motores.diarizar_separado("pyannote_40", Path("x.wav"))
    motores.diarizar_separado("nemotron_3_diarization", Path("x.wav"))
    assert chamados == ["pyannote", "diarizar"]


def test_sensevoice_so_nas_linguas_dele():
    assert resolver_motores("sensevoice", "none", "en").transcricao == "sensevoice"
    plano = resolver_motores("sensevoice", "none", "pt")
    assert plano.transcricao == MOTOR_ASSEMBLYAI
    assert any("SenseVoice só transcreve" in a for a in plano.avisos)


def test_sensevoice_converte_a_saida_do_worker(monkeypatch, audio):
    from src.transcription import motores
    pedidos = []
    monkeypatch.setattr(motores, "_rodar_worker_nemo", lambda tarefa, a, *extra: pedidos.append((tarefa, extra)) or {
        "modelo": "FunAudioLLM/SenseVoiceSmall", "palavras": [{"word": "hello", "start": 25.1, "end": 25.4}]})
    r = motores.transcrever_sensevoice(audio, resolver_motores("sensevoice", "none", "en"), OpcoesASR(idioma="en"))
    assert pedidos == [("sensevoice", ("en",))]
    assert r.palavras[0] == {"word": "hello", "start_time": 25.1, "end_time": 25.4,
                             "speaker_id": "Desconhecido", "confidence": 1.0}
    with pytest.raises(ErroASR, match="não transcreve 'pt'"):
        motores.transcrever_sensevoice(audio, resolver_motores("sensevoice", "none", "en"), OpcoesASR(idioma="pt"))
