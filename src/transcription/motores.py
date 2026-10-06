"""Motores de transcrição e de diarização, escolhidos pelas Configurações.

``resolver_motores`` traduz ``transcription.engine`` e ``diarization.engine``
no que roda DE FATO. Motor escolhido que ainda não tem código cai num caminho
que funciona e gera um aviso: nunca finge que rodou o motor pedido.

Todo motor de transcrição recebe o caminho do áudio e devolve ``ResultadoASR``
com palavras no formato do banco (word, start_time, end_time, speaker_id,
confidence; tempos em segundos). O pipeline não sabe qual motor rodou.
"""
import mimetypes
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

MOTOR_ASSEMBLYAI = "assemblyai_universal_35"
MOTOR_DEEPGRAM = "deepgram_nova_3"
MOTOR_WHISPER = "whisper_turbo"
MOTOR_CANARY = "nvidia_canary"
DIARIZADOR_NEMOTRON = "nemotron_3_diarization"
DIARIZADOR_PYANNOTE = "pyannote_40"
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
TRANSCRICAO_COM_DIARIZACAO = {MOTOR_ASSEMBLYAI: True, MOTOR_DEEPGRAM: True, MOTOR_WHISPER: False, MOTOR_CANARY: False}
TRANSCRICAO_LIGADOS = set(TRANSCRICAO_COM_DIARIZACAO)
# Diarizadores separados (rodam sobre o áudio, depois da transcrição).
DIARIZADORES_SEPARADOS = {DIARIZADOR_NEMOTRON, DIARIZADOR_PYANNOTE}
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
    # Sem smart_format: ele liga a conversão para numerais, que em português troca o
    # artigo "uma" por "1" ("1 marca chinesa") -- medido em clipe real em 05/10/2026.
    params = {"model": DEEPGRAM_MODELO, "language": opcoes.idioma, "punctuate": "true"}
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


# -- Whisper Turbo (local, CPU) --------------------------------------------------------

WHISPER_MODELO = "large-v3-turbo"  # faster-whisper: mobiuslabsgmbh/faster-whisper-large-v3-turbo
_whisper_modelo = None
_whisper_trava = threading.Lock()


def _carregar_whisper():
    global _whisper_modelo
    with _whisper_trava:
        if _whisper_modelo is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as e:
                raise ErroASR("pacote 'faster-whisper' não instalado (uv pip install faster-whisper)") from e
            threads = max(1, (os.cpu_count() or 2) // 2)
            _whisper_modelo = WhisperModel(WHISPER_MODELO, device="cpu", compute_type="int8", cpu_threads=threads)
        return _whisper_modelo


def palavras_whisper(segmentos) -> List[Dict[str, Any]]:
    """Segmentos do faster-whisper -> palavras do banco. Sem diarização: falante desconhecido."""
    palavras = []
    for seg in segmentos:
        for w in (getattr(seg, "words", None) or []):
            texto = (w.word or "").strip()
            if texto:
                palavras.append({"word": texto, "start_time": float(w.start), "end_time": float(w.end),
                                 "speaker_id": "Desconhecido", "confidence": float(w.probability)})
    return palavras


def audio_16k(audio: Path):
    """Decodifica com o ffmpeg para float32 mono 16 kHz.

    O faster-whisper 1.2.1 decodificaria pelo PyAV, mas chama av.open com um
    argumento (metadata_errors) que o PyAV 19 removeu; o ffmpeg do projeto evita isso.
    """
    import subprocess
    import numpy as np
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(audio), "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"]
    kw = {}
    if os.name == "nt":
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode != 0:
        raise ErroASR(f"ffmpeg não decodificou o áudio: {r.stderr.decode(errors='replace')[:200]}")
    return np.frombuffer(r.stdout, dtype=np.float32)


def transcrever_whisper(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: Optional[str] = None,
                        modelo: Any = None) -> ResultadoASR:
    modelo = modelo or _carregar_whisper()
    amostras = audio_16k(audio)
    try:
        segmentos, info = modelo.transcribe(amostras, language=opcoes.idioma, word_timestamps=True,
                                            vad_filter=True, beam_size=5)
        palavras = palavras_whisper(segmentos)  # o gerador só roda aqui
    except Exception as e:
        raise ErroASR(f"Falha no Whisper local: {e}") from e
    avisos = []
    if opcoes.detectar_entidades:
        avisos.append("Detecção de entidades faladas só existe na AssemblyAI; ficou de fora nesta transcrição.")
    return ResultadoASR(palavras=palavras, motor=MOTOR_WHISPER, modelo_usado=f"faster-whisper {WHISPER_MODELO}",
                        avisos=avisos)


# -- Diarizador separado: Nemotron 3 (no .venv-nemo) -------------------------------------

RAIZ = Path(__file__).resolve().parents[2]
WORKER_NEMO = Path(__file__).with_name("venv_nemo_worker.py")
NEMO_TIMEOUT_S = 1800


def python_venv_nemo() -> Path:
    """Intérprete do ambiente separado (transformers >= 5.18). CAPIAU_VENV_NEMO troca o caminho."""
    base = Path(os.getenv("CAPIAU_VENV_NEMO") or (RAIZ / ".venv-nemo"))
    return base / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _rodar_worker_nemo(tarefa: str, audio: Path, *extra: str) -> Dict[str, Any]:
    import json
    import subprocess
    import tempfile

    py = python_venv_nemo()
    if not py.exists():
        raise ErroASR(f"Ambiente .venv-nemo não encontrado em {py.parent.parent} (ver docs: ambiente separado do NeMo)")
    with tempfile.TemporaryDirectory(prefix="capiau_nemo_") as tmp:
        wav, saida = Path(tmp) / "audio.wav", Path(tmp) / "saida.json"
        kw = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        conv = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(audio),
                               "-ac", "1", "-ar", "16000", str(wav)], capture_output=True, **kw)
        if conv.returncode != 0:
            raise ErroASR(f"ffmpeg não converteu o áudio para o {tarefa}: {conv.stderr.decode(errors='replace')[:200]}")
        try:
            r = subprocess.run([str(py), str(WORKER_NEMO), tarefa, str(wav), str(saida), *extra],
                               capture_output=True, timeout=NEMO_TIMEOUT_S, **kw)
        except subprocess.TimeoutExpired as e:
            raise ErroASR(f"{tarefa} no .venv-nemo passou de {NEMO_TIMEOUT_S} s") from e
        if r.returncode != 0 or not saida.exists():
            cauda = r.stderr.decode(errors="replace").strip().splitlines()[-3:]
            raise ErroASR(f"{tarefa} no .venv-nemo falhou: {' | '.join(cauda)[:300]}")
        return json.loads(saida.read_text(encoding="utf-8"))


def diarizar_nemotron(audio: Path):
    """Segmentos [{inicio, fim, falante}] do Nemotron 3 Diarization (até 8 falantes, fala sobreposta)."""
    r = _rodar_worker_nemo("diarizar", audio)
    return r["segmentos"], r.get("modelo") or "nemotron-3-diarization"


def transcrever_canary(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: Optional[str] = None) -> ResultadoASR:
    """NVIDIA Canary 1B v2 pelo NeMo no .venv-nemo (CPU). Sem diarização própria."""
    r = _rodar_worker_nemo("canary", audio, opcoes.idioma)
    palavras = [{"word": w["word"], "start_time": w["start"], "end_time": w["end"],
                 "speaker_id": "Desconhecido", "confidence": 1.0} for w in r["palavras"]]
    avisos = ["O Canary não informa confiança por palavra; gravada como 1.0."]
    if opcoes.detectar_entidades:
        avisos.append("Detecção de entidades faladas só existe na AssemblyAI; ficou de fora nesta transcrição.")
    return ResultadoASR(palavras=palavras, motor=MOTOR_CANARY, modelo_usado=r.get("modelo"), avisos=avisos)


def diarizar_pyannote(audio: Path):
    """Segmentos do pyannote community-1 (repositório com aceite de termos no Hugging Face)."""
    r = _rodar_worker_nemo("pyannote", audio)
    return r["segmentos"], r.get("modelo") or "pyannote/speaker-diarization-community-1"


def diarizar_separado(motor: str, audio: Path):
    if motor == DIARIZADOR_PYANNOTE:
        return diarizar_pyannote(audio)
    return diarizar_nemotron(audio)


def atribuir_falantes(palavras: List[Dict[str, Any]], segmentos: List[Dict[str, Any]],
                      folga_s: float = 0.5) -> List[Dict[str, Any]]:
    """Cada palavra recebe o falante com mais sobreposição no tempo.

    Sem sobreposição, vale o segmento mais próximo até ``folga_s``; além disso,
    "Desconhecido". Na fala sobreposta vence quem cobre mais da palavra.
    """
    saida = []
    for p in palavras:
        ini, fim = float(p["start_time"]), float(p["end_time"])
        melhor, melhor_sobre, perto, perto_dist = None, 0.0, None, folga_s
        for s in segmentos:
            sobre = min(fim, s["fim"]) - max(ini, s["inicio"])
            if sobre > melhor_sobre:
                melhor, melhor_sobre = s["falante"], sobre
            elif melhor is None:
                dist = max(s["inicio"] - fim, ini - s["fim"], 0.0)
                if dist <= perto_dist:
                    perto, perto_dist = s["falante"], dist
        falante = melhor if melhor is not None else perto
        nova = dict(p)
        nova["speaker_id"] = _falante_deepgram(falante)  # mesmo formato: 0 -> "Falante A"
        saida.append(nova)
    return saida


# -- Checagem de alucinação ---------------------------------------------------------

def repeticao_em_loop(palavras: List[Dict[str, Any]], max_n: int = 4, limite: int = 6) -> Optional[str]:
    """Trecho de 1 a ``max_n`` palavras repetido em sequência ``limite`` vezes ou mais.

    Modelos de ASR entram em loop em áudio ruidoso (medido: Canary repetiu
    "Não é possível." dezenas de vezes num clipe de making of). Devolve o trecho.
    """
    textos = [str(p.get("word", "")).strip().lower().strip(".,!?;:") for p in palavras]
    for n in range(1, max_n + 1):
        i = 0
        while i + n <= len(textos):
            bloco, reps, j = textos[i:i + n], 1, i + n
            while textos[j:j + n] == bloco:
                reps, j = reps + 1, j + n
            if reps >= limite and any(bloco):
                return " ".join(bloco)
            i += 1
    return None


# -- Preço (só para a prévia do botão de transcrever) -----------------------------------

# US$ por hora de áudio, conferidos nas páginas de preço em 05/10/2026.
# AssemblyAI Universal-3.5 Pro: transcrição 0,21 + diarização 0,02 + entidades 0,08.
# Deepgram Nova-3 pré-gravado, monolíngue: US$ 0,0043/min, diarização incluída.
PRECO_HORA_USD = {
    MOTOR_ASSEMBLYAI: {"base": 0.21, "diarizacao": 0.02, "entidades": 0.08},
    MOTOR_DEEPGRAM: {"base": 0.0043 * 60},
}


def preco_hora_usd(plano: PlanoASR, opcoes: OpcoesASR) -> float:
    """Custo por hora de áudio do plano; motores locais custam 0 (só CPU)."""
    tabela = PRECO_HORA_USD.get(plano.transcricao)
    if not tabela:
        return 0.0
    total = tabela["base"]
    if opcoes.diarizar and plano.diarizacao == DIARIZACAO_PROPRIA:
        total += tabela.get("diarizacao", 0.0)
    if opcoes.detectar_entidades:
        total += tabela.get("entidades", 0.0)
    return round(total, 4)


# -- Despacho -----------------------------------------------------------------------

MOTORES: Dict[str, Callable[..., ResultadoASR]] = {
    MOTOR_ASSEMBLYAI: transcrever_assemblyai,
    MOTOR_DEEPGRAM: transcrever_deepgram,
    MOTOR_WHISPER: transcrever_whisper,
    MOTOR_CANARY: transcrever_canary,
}


def transcrever(audio: Path, plano: PlanoASR, opcoes: OpcoesASR, chave: Optional[str]) -> ResultadoASR:
    """Roda o motor do plano. Motor de nuvem sem chave levanta ErroASR com instrução."""
    provedor = CHAVE_DO_MOTOR.get(plano.transcricao)
    if provedor and not chave:
        raise ErroASR(f"Chave '{provedor}' não configurada (painel de configurações da IA ou .env)")
    resultado = MOTORES[plano.transcricao](audio, plano, opcoes, chave)
    resultado.avisos = list(plano.avisos) + list(resultado.avisos)
    loop = repeticao_em_loop(resultado.palavras)
    if loop:
        resultado.avisos.append(f"Possível alucinação do {resultado.motor}: '{loop}' repetido em sequência; confira o trecho.")
    if plano.diarizacao in DIARIZADORES_SEPARADOS and resultado.palavras:
        segmentos, modelo = diarizar_separado(plano.diarizacao, audio)
        resultado.palavras = atribuir_falantes(resultado.palavras, segmentos)
        resultado.modelo_usado = f"{resultado.modelo_usado or resultado.motor} + {modelo}"
    return resultado
