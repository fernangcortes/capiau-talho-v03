"""Motores de transcrição e de diarização, escolhidos pelas Configurações.

``resolver_motores`` traduz ``transcription.engine`` e ``diarization.engine``
no que roda DE FATO. Motor escolhido que ainda não tem código cai num caminho
que funciona e gera um aviso: nunca finge que rodou o motor pedido.

Todo motor de transcrição recebe o caminho do áudio e devolve ``ResultadoASR``
com palavras no formato do banco (word, start_time, end_time, speaker_id,
confidence; tempos em segundos). O pipeline não sabe qual motor rodou.
"""
import mimetypes
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

MOTOR_ASSEMBLYAI = "assemblyai_universal_35"
MOTOR_DEEPGRAM = "deepgram_nova_3"
SEM_DIARIZACAO = "none"
DIARIZACAO_MESMO_MOTOR = "mesmo_motor"  # opção das Configurações: a do motor de transcrição
DIARIZACAO_PROPRIA = "propria"  # no plano: a do próprio motor de transcrição

# Ordem de prioridade mandada à AssemblyAI: o 3.5 Pro atende as 18 línguas dele
# (pt, en e es entre elas); fora delas a API cai sozinha no universal-2.
MODELOS_ASSEMBLYAI = ["universal-3-5-pro", "universal-2"]
MODELO_PRINCIPAL = MODELOS_ASSEMBLYAI[0]

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_MODELO = "nova-3"
DEEPGRAM_TIMEOUT_S = (15, 1800)  # (conexão, leitura): áudio longo leva minutos
# Fixo: o mimetypes do Windows lê o registro e devolve 'audio/mp3', fora do padrão.
TIPOS_AUDIO = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4",
               ".mov": "video/quicktime", ".flac": "audio/flac", ".ogg": "audio/ogg"}

# Motores de transcrição com código hoje, e se trazem diarização junto.
# Um motor novo só entra aqui junto com o código dele e o teste.
TRANSCRICAO_COM_DIARIZACAO = {MOTOR_ASSEMBLYAI: True, MOTOR_DEEPGRAM: True}
TRANSCRICAO_LIGADOS = set(TRANSCRICAO_COM_DIARIZACAO)
# Diarizadores separados (rodam sobre o áudio, depois da transcrição).
DIARIZADORES_SEPARADOS: set = set()
# Valores antigos de diarization.engine que significam "a da própria transcrição X".
DIARIZACAO_DE_TRANSCRICAO = {MOTOR_ASSEMBLYAI, MOTOR_DEEPGRAM}
DIARIZACAO_LIGADOS = {DIARIZACAO_MESMO_MOTOR, SEM_DIARIZACAO} | DIARIZADORES_SEPARADOS

# Chave de API por motor de nuvem (nome do provedor em ResolvedSettings.api_key).
CHAVE_DO_MOTOR = {MOTOR_ASSEMBLYAI: "assemblyai", MOTOR_DEEPGRAM: "deepgram"}


class ErroASR(RuntimeError):
    """Falha do motor de transcrição, com mensagem que pode ir para a tela."""


@dataclass
class PlanoASR:
    transcricao: str
    diarizacao: str  # DIARIZACAO_PROPRIA, um diarizador separado ou SEM_DIARIZACAO
    avisos: List[str] = field(default_factory=list)


@dataclass
class OpcoesASR:
    idioma: str = "pt"
    diarizar: bool = True
    max_falantes: Optional[int] = None
    detectar_entidades: bool = False


@dataclass
class ResultadoASR:
    palavras: List[Dict[str, Any]]
    motor: str
    modelo_usado: Optional[str] = None
    entidades: List[Dict[str, Any]] = field(default_factory=list)
    avisos: List[str] = field(default_factory=list)


def resolver_motores(escolha_transcricao: Optional[str], escolha_diarizacao: Optional[str]) -> PlanoASR:
    """Traduz a escolha das Configurações no que realmente vai rodar."""
    avisos: List[str] = []

    transcricao = escolha_transcricao or MOTOR_ASSEMBLYAI
    if transcricao not in TRANSCRICAO_LIGADOS:
        avisos.append(f"Motor de transcrição '{transcricao}' ainda não está ligado; usando AssemblyAI Universal-3.5.")
        transcricao = MOTOR_ASSEMBLYAI
    tem_propria = TRANSCRICAO_COM_DIARIZACAO.get(transcricao, False)

    def cair_na_propria(motivo: str) -> str:
        if tem_propria:
            avisos.append(f"{motivo}; usando a diarização do próprio {transcricao}.")
            return DIARIZACAO_PROPRIA
        avisos.append(f"{motivo}; transcrição sem separar falantes.")
        return SEM_DIARIZACAO

    escolha = escolha_diarizacao or DIARIZACAO_MESMO_MOTOR
    if escolha == SEM_DIARIZACAO:
        diarizacao = SEM_DIARIZACAO
    elif escolha in (DIARIZACAO_MESMO_MOTOR, transcricao):
        diarizacao = DIARIZACAO_PROPRIA if tem_propria else cair_na_propria(f"'{transcricao}' não separa falantes")
    elif escolha in DIARIZACAO_DE_TRANSCRICAO:
        diarizacao = cair_na_propria(f"A diarização '{escolha}' só vem junto da transcrição '{escolha}'")
    elif escolha in DIARIZADORES_SEPARADOS:
        diarizacao = escolha
    else:
        diarizacao = cair_na_propria(f"Motor de diarização '{escolha}' ainda não está ligado")

    return PlanoASR(transcricao=transcricao, diarizacao=diarizacao, avisos=avisos)


# -- AssemblyAI ---------------------------------------------------------------------

def montar_config_assemblyai(plano: PlanoASR, idioma: str, separar_falantes: bool,
                             detectar_entidades: bool, max_falantes: Optional[int]) -> Dict[str, Any]:
    """Argumentos do ``aai.TranscriptionConfig`` para o plano resolvido.

    ``max_falantes`` vira teto (não número exato): ``speakers_expected``
    forçaria a contagem.
    """
    diarizar = bool(separar_falantes) and plano.diarizacao == DIARIZACAO_PROPRIA
    cfg: Dict[str, Any] = {
        "speech_models": list(MODELOS_ASSEMBLYAI),
        "language_code": idioma,
        "speaker_labels": diarizar,
        "entity_detection": bool(detectar_entidades),
        "punctuate": True,
        "format_text": True,
    }
    if diarizar and max_falantes:
        cfg["speaker_options"] = {"max_speakers_expected": int(max_falantes)}
    return cfg


def aviso_modelo_usado(modelo_usado: Optional[str]) -> Optional[str]:
    """Aviso quando a AssemblyAI respondeu com outro modelo que não o 3.5 Pro."""
    if modelo_usado and modelo_usado != MODELO_PRINCIPAL:
        return f"A AssemblyAI transcreveu com '{modelo_usado}', não com o {MODELO_PRINCIPAL} (idioma fora da lista dele?)."
    return None


def transcrever_assemblyai(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: str) -> ResultadoASR:
    import assemblyai as aai

    cfg = montar_config_assemblyai(plano, opcoes.idioma, opcoes.diarizar, opcoes.detectar_entidades,
                                   opcoes.max_falantes)
    if "speaker_options" in cfg:
        cfg["speaker_options"] = aai.SpeakerOptions(**cfg["speaker_options"])
    aai.settings.api_key = chave
    transcript = aai.Transcriber().transcribe(str(audio), config=aai.TranscriptionConfig(**cfg))
    if transcript.status == aai.TranscriptStatus.error:
        raise ErroASR(f"Falha na API AssemblyAI: {transcript.error}")

    palavras = [{
        "word": w.text,
        "start_time": w.start / 1000.0,
        "end_time": w.end / 1000.0,
        "speaker_id": f"Falante {w.speaker}" if w.speaker else "Desconhecido",
        "confidence": getattr(w, "confidence", 1.0),
    } for w in (transcript.words or [])]

    # A AssemblyAI entrega timestamps em milissegundos, igual as palavras.
    entidades = []
    for ent in (getattr(transcript, "entities", None) or []):
        tipo = getattr(ent, "entity_type", None)
        entidades.append({
            "entity_type": getattr(tipo, "value", None) or str(tipo),
            "text": getattr(ent, "text", ""),
            "start_time": (ent.start / 1000.0) if getattr(ent, "start", None) is not None else None,
            "end_time": (ent.end / 1000.0) if getattr(ent, "end", None) is not None else None,
        })

    modelo = getattr(transcript, "speech_model_used", None)
    aviso = aviso_modelo_usado(modelo)
    return ResultadoASR(palavras=palavras, motor=MOTOR_ASSEMBLYAI, modelo_usado=modelo,
                        entidades=entidades, avisos=[aviso] if aviso else [])


# -- Deepgram -----------------------------------------------------------------------

def parametros_deepgram(plano: PlanoASR, opcoes: OpcoesASR) -> Dict[str, str]:
    params = {"model": DEEPGRAM_MODELO, "language": opcoes.idioma,
              "punctuate": "true", "smart_format": "true"}
    if opcoes.diarizar and plano.diarizacao == DIARIZACAO_PROPRIA:
        params["diarize_model"] = "latest"
    return params


def _falante_deepgram(indice: Optional[int]) -> str:
    # Deepgram numera a partir de 0; o banco guarda "Falante A", como a AssemblyAI.
    if indice is None:
        return "Desconhecido"
    indice = int(indice)
    return f"Falante {chr(ord('A') + indice)}" if indice < 26 else f"Falante {indice + 1}"


def palavras_deepgram(resposta: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        palavras = resposta["results"]["channels"][0]["alternatives"][0].get("words") or []
    except (KeyError, IndexError, TypeError) as e:
        raise ErroASR("Deepgram devolveu resposta sem palavras") from e
    return [{
        "word": p.get("punctuated_word") or p.get("word", ""),
        "start_time": float(p["start"]),
        "end_time": float(p["end"]),
        "speaker_id": _falante_deepgram(p.get("speaker")),
        "confidence": float(p.get("confidence", 1.0)),
    } for p in palavras]


def modelo_deepgram(resposta: Dict[str, Any]) -> Optional[str]:
    info = (resposta.get("metadata") or {}).get("model_info") or {}
    nomes = [f"{m.get('name')} {m.get('version', '')}".strip() for m in info.values() if isinstance(m, dict)]
    return ", ".join(nomes) or None


def transcrever_deepgram(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: str,
                         http: Any = None) -> ResultadoASR:
    if http is None:
        import requests as http
    tipo = TIPOS_AUDIO.get(audio.suffix.lower()) or mimetypes.guess_type(str(audio))[0] or "application/octet-stream"
    try:
        with open(audio, "rb") as f:
            r = http.post(DEEPGRAM_URL, params=parametros_deepgram(plano, opcoes), data=f,
                          headers={"Authorization": f"Token {chave}", "Content-Type": tipo},
                          timeout=DEEPGRAM_TIMEOUT_S)
    except OSError as e:
        raise ErroASR(f"Deepgram fora do ar ou sem rede: {type(e).__name__}") from e
    except Exception as e:
        raise ErroASR(f"Falha ao chamar o Deepgram: {type(e).__name__}") from e
    if r.status_code != 200:
        detalhe = (getattr(r, "text", "") or "")[:200].replace(chave, "***")
        raise ErroASR(f"Deepgram respondeu HTTP {r.status_code}: {detalhe}")
    resposta = r.json()
    avisos = []
    if opcoes.detectar_entidades:
        avisos.append("Detecção de entidades faladas só existe na AssemblyAI; ficou de fora nesta transcrição.")
    return ResultadoASR(palavras=palavras_deepgram(resposta), motor=MOTOR_DEEPGRAM,
                        modelo_usado=modelo_deepgram(resposta), avisos=avisos)


# -- Despacho -----------------------------------------------------------------------

MOTORES: Dict[str, Callable[..., ResultadoASR]] = {
    MOTOR_ASSEMBLYAI: transcrever_assemblyai,
    MOTOR_DEEPGRAM: transcrever_deepgram,
}


def transcrever(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: Optional[str]) -> ResultadoASR:
    """Roda o motor do plano. Motor de nuvem sem chave levanta ErroASR com instrução."""
    provedor = CHAVE_DO_MOTOR.get(plano.transcricao)
    if provedor and not chave:
        raise ErroASR(f"Chave '{provedor}' não configurada (painel de configurações da IA ou .env)")
    resultado = MOTORES[plano.transcricao](audio, plano, opcoes, chave)
    resultado.avisos = list(plano.avisos) + list(resultado.avisos)
    return resultado
