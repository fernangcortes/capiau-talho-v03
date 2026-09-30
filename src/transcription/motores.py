"""Escolha do motor de transcrição e de diarização a partir das Configurações.

Lê ``transcription.engine`` e ``diarization.engine`` e devolve o que vai rodar
DE FATO. Motor escolhido que ainda não tem código cai num caminho que funciona
(AssemblyAI) e gera um aviso: nunca finge que rodou o motor pedido.

Função pura, sem rede: o pipeline chama, os testes também.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

MOTOR_ASSEMBLYAI = "assemblyai_universal_35"
SEM_DIARIZACAO = "none"

# Ordem de prioridade mandada à AssemblyAI: o 3.5 Pro atende as 18 línguas dele
# (pt, en e es entre elas); fora delas a API cai sozinha no universal-2.
MODELOS_ASSEMBLYAI = ["universal-3-5-pro", "universal-2"]
MODELO_PRINCIPAL = MODELOS_ASSEMBLYAI[0]

# O que tem código de verdade hoje. Um motor novo só entra aqui junto com o
# código dele e o teste.
TRANSCRICAO_LIGADOS = {MOTOR_ASSEMBLYAI}
DIARIZACAO_LIGADOS = {MOTOR_ASSEMBLYAI, SEM_DIARIZACAO}


@dataclass
class PlanoASR:
    transcricao: str
    diarizacao: str
    avisos: List[str] = field(default_factory=list)


def resolver_motores(escolha_transcricao: Optional[str], escolha_diarizacao: Optional[str]) -> PlanoASR:
    """Traduz a escolha das Configurações no motor que realmente vai rodar."""
    avisos: List[str] = []

    transcricao = escolha_transcricao or MOTOR_ASSEMBLYAI
    if transcricao not in TRANSCRICAO_LIGADOS:
        avisos.append(f"Motor de transcrição '{transcricao}' ainda não está ligado; usando AssemblyAI Universal-3.5.")
        transcricao = MOTOR_ASSEMBLYAI

    diarizacao = escolha_diarizacao or MOTOR_ASSEMBLYAI
    if diarizacao not in DIARIZACAO_LIGADOS:
        avisos.append(f"Motor de diarização '{diarizacao}' ainda não está ligado; usando a diarização da AssemblyAI.")
        diarizacao = MOTOR_ASSEMBLYAI

    return PlanoASR(transcricao=transcricao, diarizacao=diarizacao, avisos=avisos)


def montar_config_assemblyai(plano: PlanoASR, idioma: str, separar_falantes: bool,
                             detectar_entidades: bool, max_falantes: Optional[int]) -> Dict[str, Any]:
    """Argumentos do ``aai.TranscriptionConfig`` para o plano resolvido.

    A diarização só liga quando o motor de diarização é a própria AssemblyAI e
    ``asr.speaker_labels`` está ligado. ``max_falantes`` vira teto (não número
    exato): ``speakers_expected`` forçaria a contagem.
    """
    diarizar = bool(separar_falantes) and plano.diarizacao == MOTOR_ASSEMBLYAI
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
