"""Worker de audio tratado em lote (fila `audio_render`), FORA do processo do servidor.

Irmao de src/worker_vision.py e src/worker_transcricao.py -- mesma infraestrutura,
mesmo motivo: lote pesado dentro do servidor sufoca o event loop e derruba a
interface (medido em 15/07/2026, cabecalho de worker_vision.py). Aqui o peso e o
denoise por IA local, a 1,2x tempo real (RTF 0,82 do DPDFNet): a entrevista de
962 s sao ~13 min de CPU por clipe. Nunca dentro do FastAPI.

Uso:
    python -m src.worker_audio                 # processa a fila pendente e sai
    python -m src.worker_audio --motor gtcrn   # previa 16 kHz (nunca entrega)
    python -m src.worker_audio --autoteste     # autoteste com dubles e banco temporario

Fila: linhas da tabela audio_render com status='pending' (docs/PLANO_AJUSTES_DE_AUDIO.md,
secao 3). Cada linha traz video_id, in_s/out_s, chain_hash e chain_json; quem enfileira
(e a rota de render ou o dono do projeto) ja fixou a identidade (video, intervalo, cadeia).
O worker NAO recalcula hash: consome o chain_hash da linha como chave unica e grava o WAV
derivado em data/audio_tratado/<video_id>/<chain_hash>.wav, o mesmo formato de ref que a
rota usa (clip.effects.ref).

ORDEM OBRIGATORIA dentro de um item (secao 6 do plano):
    1. reparo de clipping (adeclip+adeclick) ANTES do denoise -- "sempre";
    2. denoise de IA no meio (passo reservado "denoise_ia" da ordem canonica);
    3. speechnorm/loudnorm 2 passes/alimiter DEPOIS.
A cadeia nao e reimplementada: as partes ffmpeg passam por src/media/audio_chain.renderizar
(que conhece CADEIA_ORDEM e refaz a ordem internamente) e so o passo de IA passa por
src/media/audio_denoise.denoisar. A lista vem de chain_json partida no passo "denoise_ia";
a propria CADEIA_ORDEM decide o que e anterior e posterior a IA.

INTERROMPVEL E RETOMAVEL (o contrato desta casa):
- Matar o processo no meio NAO deixa linha travada em 'running' para nunca: a guarda de
  PID garante UM worker de audio vivo por vez; entao 'running' numa rodada nova so pode
  ser orfa de uma morte. No arranque todas as 'running' voltam a 'pending' com nota no
  analysis_json, e a fila segue dali.
- Nenhum arquivo definitivo nasce pela metade: renderizar grava "<dest>.parcial.wav" e
  renomeia no fim; denoisar grava em temporario no proprio diretorio e renomeia via
  os.replace. Os temporarios intermediarios deste worker usam o prefixo ".worker_audio_"
  e sao apagados no finally; sobras de uma morte sao varridas no arranque (so com mais
  de 1 h de idade, para nunca pegar um arquivo que outro processo esteja escrevendo).
- Ctrl+C devolve o item corrente para 'pending' antes de sair.

Degradacao honesta (briefing da ETAPA 4): sem sherpa-onnx ou sem modelo em data/models/,
audio_denoise.motor_disponivel responde o que falta ANTES de processar e o item vai para
'failed' com esse motivo claro no analysis_json -- nunca ImportError cru, nunca sucesso
falso. A cadeia sem passo de IA funciona HOJE, sem dependencia nenhuma.

CAMINHO DA NUVEM (H5, engine auphonic -- secao 8 do plano): item cujo chain_json traz o
passo reservado "auphonic" (mesma convencao do "daw" do watcher: a tabela audio_render
nao tem coluna engine) extrai o trecho para WAV com o MESMO corte de transporte do
caminho local, monta o bloco algorithms com montar_algorithms(diag, alvo_lufs, teto_dbtp,
overrides) sobre a pre-analise ja salva em analysis_json, faz submit -> poll -> fetch para
data/audio_tratado/<video_id>/<chain_hash>.wav e grava path/status/analise como o local.
SOBRESCRITA MANUAL (L3): a rota grava o override do dono na analysis_json da linha;
aqui ele e lido ANTES de marcar running e passado a montar_algorithms, com auditoria no
log (uma linha por campo: automatico -> manual). Override invalido (linha antiga, banco
editado a mao) vira 'failed' com motivo legivel SEM marcar running e SEM submit -- o
envio seria recusado pela nuvem e gastaria cota do mesmo jeito. Item sem override segue
exatamente como antes.
O submit acontece UMA UNICA VEZ por producao: o uuid vai para analysis_json logo apos o
aceite (e sobrevive a morte do processo), entao morte, Ctrl+C ou cancelamento no meio do
poll fazem a rodada seguinte REACOMPANHAR a mesma producao em vez de reenviar --
reenviar gastaria a cota gratuita do mes (2 h) duas vezes. Falha da nuvem vira 'failed'
com motivo legivel; o fetch grava em temporario e renomeia no fim (nunca WAV pela metade
no lugar definitivo). Nenhum teste toca a API real: duble de provedor.
"""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.core.tasks import (TASK_MANAGER, WORKER_LOGS_DIR, clear_worker_pid,
                            worker_is_running, worker_progress_file,
                            write_worker_pid)
from src.db.connection import get_db

# Identifica este worker no arquivo de progresso e no de PID (B1/B2), igual a
# WORKER_TYPE="vision" e WORKER_TYPE="asr" dos irmaos.
WORKER_TYPE = "audio"

# Raiz do repositorio (src/worker_audio.py -> parents[1]; um nivel acima de
# src/media/audio_denoise.py, que usa parents[2] por estar um nivel mais fundo).
# O autoteste aponta esta constante para um diretorio temporario; o resto do
# modulo le o valor na hora do uso (mesma convencao de _RAIZ_PROJETO da audio_denoise).
_RAIZ_PROJETO = Path(__file__).resolve().parents[1]

# Passo reservado a IA na ordem canonica de src/media/audio_chain.py (CADEIA_ORDEM).
PASSO_IA = "denoise_ia"
# Parametro especial do passo de IA (modo explicito e avisado do plano; nunca default).
SEM_LIMITE_TOKEN = "sem_limite"
# Atenuacao default quando nem o passo nem a analise dizem nada (tabela de Riscos
# do plano: "Default 12 dB").
_ATENUACAO_DEFAULT_DB = 12.0

# Prefixo dos arquivos intermediarios deste worker (sempre DENTRO do diretorio de
# destino, mesmo volume do rename final). Varredura de arranque reconhece sobras por ele.
PREFIXO_TEMP = ".worker_audio_"
# Sobras mais novas que isso NAO sao apagadas: podem ser de um processo vivo
# (ex.: previa sincrona do servidor escrevendo .parcial.wav no mesmo diretorio).
_IDADE_MINIMA_LIXO_S = 3600.0


def _log(mensagem: str) -> None:
    """Log proprio: stdout (console/launch_detached) + data/logs/worker_audio.log.

    Falha aqui nunca derruba a rodada (mesma licao do bug de log do E2.A5)."""
    linha = f"[{time.strftime('%H:%M:%S')}] {mensagem}"
    print(linha, flush=True)
    try:
        arquivo = Path(WORKER_LOGS_DIR) / f"{WORKER_TYPE}_worker.log"
        arquivo.parent.mkdir(parents=True, exist_ok=True)
        with open(arquivo, "a", encoding="utf-8") as fh:
            fh.write(linha + "\n")
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Cadeia: partir no passo de IA (sem reimplementar nada do audio_chain)
# ---------------------------------------------------------------------------

def _base_passo(passo: str) -> str:
    return str(passo).strip().split(":")[0].strip().lower()


def dividir_cadeia(cadeia: List[str]) -> Tuple[List[str], Optional[str], List[str]]:
    """Parte a cadeia canonica em (antes_da_ia, passo_ia, depois_da_ia).

    A fronteira e a posicao de PASSO_IA em CADEIA_ORDEM -- exatamente o lugar
    que a Etapa 3 reservou ("use-o, nao invente outro encaixe"). Passos fora da
    ordem canonica recusam o item com mensagem clara (renderizar tambem recusaria;
    aqui o erro chega antes de gastar CPU). Dois passos de IA nao existem na
    ordem canonica: recusa.
    """
    from src.media.audio_chain import CADEIA_ORDEM
    pos_ia = CADEIA_ORDEM.index(PASSO_IA)
    pre: List[str] = []
    post: List[str] = []
    passo_ia: Optional[str] = None
    for passo in (cadeia or []):
        nome = _base_passo(passo)
        if not nome:
            raise ValueError("Passo vazio na cadeia.")
        if nome == PASSO_IA:
            if passo_ia is not None:
                raise ValueError(f"Passo repetido na cadeia: {nome}.")
            passo_ia = str(passo).strip()
        elif nome in CADEIA_ORDEM:
            (pre if CADEIA_ORDEM.index(nome) < pos_ia else post).append(str(passo).strip())
        else:
            raise ValueError(
                f"Passo desconhecido na cadeia: {nome!r}. "
                f"Passos validos: {', '.join(CADEIA_ORDEM)}.")
    return pre, passo_ia, post


def parametros_ia(passo_ia: str) -> Tuple[Optional[float], bool]:
    """Parametros do passo "denoise_ia[:<dB>|sem_limite]" -> (atenuacao|None, sem_limite).

    Sem parametro -> (None, False): a atenuacao sai da regra da secao 7 sobre a
    analise 'antes' (audio_denoise.atenuacao_recomendada) ou do default de 12 dB.
    """
    partes = str(passo_ia).split(":")[1:]
    if not partes or not partes[0].strip():
        return None, False
    token = partes[0].strip().lower()
    if len(partes) > 1:
        raise ValueError(f"Passo {PASSO_IA} aceita no maximo 1 parametro: {passo_ia!r}.")
    if token == SEM_LIMITE_TOKEN:
        return None, True
    try:
        return float(token), False
    except ValueError:
        raise ValueError(
            f"Parametro de {PASSO_IA} invalido: {partes[0]!r} "
            f"(use dB numerico ou '{SEM_LIMITE_TOKEN}').")


# ---------------------------------------------------------------------------
# Plano de um item: atenuacao, canais e janela
# ---------------------------------------------------------------------------

def diag_antes(analysis_json: Optional[str]) -> Optional[Dict[str, Any]]:
    """Diagnostico 'antes' de uma linha da audio_render.

    Aceita os dois formatos que a casa grava: o diag puro da Etapa 1 (chaves
    lufs_i/noise_floor_db/...) e o dict de render {"antes": ..., "depois": ...}.
    JSON ausente/corrompido -> None (o item segue; perde so a dosagem automatica).
    """
    if not analysis_json:
        return None
    try:
        dados = json.loads(analysis_json)
    except ValueError:
        return None
    if isinstance(dados, dict):
        if isinstance(dados.get("antes"), dict):
            return dados["antes"]
        if "noise_floor_db" in dados or "lufs_i" in dados or "ok" in dados:
            return dados
    return None


def plano_item(diag: Optional[Dict[str, Any]], aten_pedida: Optional[float],
               sem_limite_pedida: bool) -> Dict[str, Any]:
    """Atenuacao efetiva + por_canal, DECIDIDOS pelas funcoes da audio_denoise.

    Nenhuma regra nova aqui: por_canal e plano_de_processamento (correlacao L/R
    < 0,95 -> canal a canal); a atenuacao pedida no passo ganha de tudo, senao
    vale atenuacao_recomendada(noise_floor) com clamp [6, 18]; sem medida nenhuma,
    o default do plano (12 dB). Atenuacao SEM limite so existe se pedida no passo
    e sempre carrega o aviso de destruicao de ambiencia (que denoisar registra).
    """
    from src.media.audio_denoise import atenuacao_recomendada, plano_de_processamento
    plano_diag = plano_de_processamento(diag if diag else {"ok": True})
    aten_enviada: Optional[float] = None
    if sem_limite_pedida:
        # "Sem limite" e modo explicito e avisado; o motor so aceita dB, entao o
        # valor ENVIADO vai alto de proposito (pedido explicito cru, ou teto
        # altissimo quando nada foi pedido). O aviso de destruicao de ambiencia
        # vem do proprio denoisar, que registra sempre nesse modo.
        atenuacao = None  # denoisar recebe sem_limite=True, sem clamp nenhum
        aten_enviada = float(aten_pedida) if aten_pedida is not None else 1000.0
    elif aten_pedida is not None:
        atenuacao = float(aten_pedida)
        aten_enviada = atenuacao
    else:
        piso = diag.get("noise_floor_db") if diag else None
        atenuacao = (atenuacao_recomendada(piso) if piso is not None
                     else _ATENUACAO_DEFAULT_DB)
        aten_enviada = atenuacao
    return {"atenuacao_db": atenuacao,
            "atenuacao_enviada_db": aten_enviada,
            "sem_limite": bool(sem_limite_pedida),
            "por_canal": bool(plano_diag["por_canal"]),
            "duas_fontes": bool(plano_diag["duas_fontes"])}


def janela_do_item(in_s, out_s, duracao_video) -> Tuple[float, float, float]:
    """Janela concreta (in, out, duracao) de um item da fila.

    NULL na tabela significa 'arquivo inteiro': in=NULL -> 0; out=NULL -> duracao
    cadastrada do video (mesmo fallback da rota de render). Impossivel fechar a
    janela -> ValueError com mensagem clara (o item vai para failed, nao trava).
    """
    inicio = 0.0 if in_s is None else float(in_s)
    if out_s is not None:
        fim = float(out_s)
    elif duracao_video is not None and float(duracao_video) > 0:
        fim = float(duracao_video)
    else:
        raise ValueError("out_s e NULL e o video nao tem duracao cadastrada "
                         "para fechar a janela.")
    if inicio < 0 or fim - inicio <= 1e-6:
        raise ValueError(f"Janela invalida: out ({fim}) precisa ser maior que in ({inicio}).")
    return inicio, fim, fim - inicio


# ---------------------------------------------------------------------------
# Transporte: corte de janela sem filtros (unico ffmpeg cru deste worker)
# ---------------------------------------------------------------------------

def _startupinfo():
    startupinfo = None
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo


def cortar_janela(src: Path, dest: Path, in_s: float, out_s: float) -> Optional[str]:
    """Decodifica so a janela para WAV 48 kHz 24 bits, SEM filtro nenhum.

    Por que existe: quando a cadeia comeca no passo de IA (nada antes dele), o
    denoisar -- que processa o arquivo inteiro que recebe -- precisa receber ja
    a janela certa, e renderizar exige pelo menos um filtro. Este corte e
    TRANSPORTE (nenhuma decisao de cadeia), no mesmo espirito do
    audio_denoise._decodificar_wav; a cadeia em si continua toda no audio_chain.
    Devolve None ou o motivo do erro. Formato identico ao de entrega do F1.
    """
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", repr(float(in_s)),
           "-t", repr(float(out_s) - float(in_s)), "-i", str(src),
           "-map", "0:a:0", "-vn", "-ar", "48000", "-c:a", "pcm_s24le",
           str(dest)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              startupinfo=_startupinfo(), timeout=900.0)
    except FileNotFoundError:
        return "ffmpeg nao encontrado no PATH desta maquina."
    except subprocess.TimeoutExpired:
        return "ffmpeg excedeu o tempo de corte da janela."
    except OSError as e:
        return f"Falha ao executar o ffmpeg: {e}"
    if proc.returncode != 0:
        linhas = [ln for ln in (proc.stderr or "").strip().splitlines() if ln.strip()]
        return ("FFmpeg falhou ao cortar a janela: " +
                (linhas[-1] if linhas else f"codigo {proc.returncode}"))
    if not dest.exists() or dest.stat().st_size == 0:
        return "FFmpeg terminou sem gravar o corte da janela."
    return None


# ---------------------------------------------------------------------------
# Caminho da nuvem (Auphonic): submit UNICO -> poll -> fetch (contrato H5)
# ---------------------------------------------------------------------------

# Passo reservado ao motor de nuvem na chain_json, no mesmo molde do "daw" do
# watcher (a tabela audio_render nao tem coluna engine). Item de nuvem e SEMPRE
# um unico passo: "auphonic" ou "auphonic:<alvo_lufs>:<teto_dbtp>".
PASSO_NUVEM = "auphonic"
# Espera entre consultas de poll: a nuvem leva minutos por producao; 10 s nao
# atrasa o resultado e nao martela a API. Lido no momento do uso (o autoteste
# encolhe para nao dormir de verdade).
INTERVALO_POLL_S = 10.0
# Fatia maxima de cada espera: mantem o laco responsivo a cancelamento/Ctrl+C.
FATIA_ESPERA_S = 2.0
# Alvos default quando o passo nao traz ":alvo:teto" e as chaves audio.analise.*
# ainda nao estao no settings_registry desta maquina: os MESMOS numeros do
# loudnorm local (audio_chain.ALVO_LUFS_PADRAO / TETO_DBTP_PADRAO).
_ALVO_LUFS_DEFAULT = -16.0
_TETO_DBTP_DEFAULT = -1.5


class _ItemCancelado(Exception):
    """Sinal interno: a tarefa foi cancelada durante a espera do poll.

    NAO e falha do trabalho: a linha volta a 'pending' com o uuid da producao
    guardado, e a rodada seguinte reacompanha a mesma producao na nuvem."""


def passo_nuvem(cadeia: List[str]) -> Optional[str]:
    """Devolve o passo "auphonic..." se a cadeia for de nuvem; None se local.

    Contrato com a rota (H4/J3): engine auphonic entra na fila como UM unico
    passo reservado em chain_json. Passos locais juntos recusam o item com
    motivo claro -- a nuvem aplica os proprios algoritmos, misturar com a
    cadeia ffmpeg local nao tem sentido definido.
    """
    achados = [str(p).strip() for p in (cadeia or [])
               if _base_passo(str(p)) == PASSO_NUVEM]
    if not achados:
        return None
    if len(achados) > 1 or len(cadeia or []) != 1:
        raise ValueError(
            f"Item de nuvem ({PASSO_NUVEM}) aceita um unico passo, sem passos "
            f"locais junto; recebi: {cadeia}.")
    return achados[0]


def parametros_nuvem(passo: str) -> Tuple[Optional[float], Optional[float]]:
    """Params do passo "auphonic[:<alvo_lufs>[:<teto_dbtp>]]".

    Sem parametro -> (None, None): os alvos saem das chaves audio.analise.*
    alvo_lufs/teto_dbtp (as mesmas que avaliam o resultado local), com default
    -16/-1.5 se nem o registro existir.
    """
    partes = str(passo).split(":")[1:]
    if len(partes) > 2:
        raise ValueError(
            f"Passo {PASSO_NUVEM} aceita no maximo 2 parametros "
            f"(alvo_lufs, teto_dbtp): {passo!r}.")
    valores: List[Optional[float]] = []
    for bruto in partes:
        if not bruto.strip():
            raise ValueError(f"Parametro vazio no passo {passo!r}.")
        try:
            valores.append(float(bruto))
        except ValueError:
            raise ValueError(
                f"Parametro de {PASSO_NUVEM} invalido: {bruto!r} (use numero).")
    while len(valores) < 2:
        valores.append(None)
    return valores[0], valores[1]


def alvos_nuvem(alvo_pedida: Optional[float], teto_pedida: Optional[float],
                project_id: Optional[int]) -> Tuple[float, float]:
    """Alvo LUFS e teto dBTP efetivos: passo > settings_registry > default.

    Chaves audio.analise.alvo_lufs / audio.analise.teto_dbtp (mesma leitura de
    _limiares_audio da rota): tratar na nuvem mira o mesmo alvo de entrega do
    projeto que o caminho local. KeyError (chave fora do registro desta maquina)
    ou banco de settings indisponivel cae no default da casa, como faz o
    watcher para audio.daw.pasta_retorno; outros erros sobem (item falha com
    motivo, nada engolido).
    """
    alvo: Optional[float] = alvo_pedida
    teto: Optional[float] = teto_pedida
    if alvo is None or teto is None:
        try:
            from src.services.settings_service import SettingsService

            S = SettingsService.get_settings(project_id)
            if alvo is None:
                try:
                    alvo = float(S.get("audio.analise.alvo_lufs"))
                except KeyError:
                    alvo = _ALVO_LUFS_DEFAULT
            if teto is None:
                try:
                    teto = float(S.get("audio.analise.teto_dbtp"))
                except KeyError:
                    teto = _TETO_DBTP_DEFAULT
        except sqlite3.Error:
            alvo = alvo if alvo is not None else _ALVO_LUFS_DEFAULT
            teto = teto if teto is not None else _TETO_DBTP_DEFAULT
    return float(alvo), float(teto)


def diag_para_algorithms(diag: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Diagnostico da casa -> chaves que montar_algorithms le (docstring dele).

    lufs_i->lufs, true_peak_db->tp, noise_floor_db->nf, lra->lra. CUIDADO com
    clip_pct: a audio_analysis grava PORCENTAGEM (100 * clipadas/amostras) e
    montar_algorithms espera FRACAO ("0.00651 = 0,651%") -- divide por 100 aqui,
    senao o gatilho de resgate extremo dispararia 100x cedo demais. Medida
    ausente (None) fica ausente: montar_algorithms decide sem inventar numero.
    Dicas opcionais (ruido_variavel/sem_agudos/resgate_extremo) so passam se
    vierem no diag. Funcao pura: nao altera ``diag``.
    """
    if not isinstance(diag, dict):
        return {}
    saida: Dict[str, Any] = {}
    for destino, origem in (("lufs", "lufs_i"), ("tp", "true_peak_db"),
                            ("nf", "noise_floor_db"), ("lra", "lra")):
        valor = diag.get(origem)
        if isinstance(valor, (int, float)) and not isinstance(valor, bool):
            saida[destino] = float(valor)
    clip = diag.get("clip_pct")
    if isinstance(clip, (int, float)) and not isinstance(clip, bool):
        saida["clip_pct"] = float(clip) / 100.0
    for dica in ("ruido_variavel", "sem_agudos", "resgate_extremo"):
        if dica in diag:
            saida[dica] = bool(diag[dica])
    return saida


def estado_nuvem(analysis_json: Optional[str]) -> Optional[Dict[str, Any]]:
    """Bloco "nuvem" persistido em analysis_json (uuid da producao), se houver.

    JSON ausente/corrompido/bloco ausente -> None: primeira tentativa de verdade.
    """
    if not analysis_json:
        return None
    try:
        dados = json.loads(analysis_json)
    except ValueError:
        return None
    if isinstance(dados, dict) and isinstance(dados.get("nuvem"), dict):
        return dados["nuvem"]
    return None


# Chave pela qual a rota (contrato L2) grava a sobrescrita manual do dono na
# analysis_json da linha, junto da pre-analise que este worker ja le.
CHAVE_SOBRESCRITA = "algorithms_override"


def override_nuvem(analysis_json: Optional[str]) -> Optional[Dict[str, Any]]:
    """Sobrescrita manual gravada pela rota junto da linha (contrato L2).

    Le a CHAVE_SOBRESCRITA na analysis_json, direto na raiz ou dentro do bloco
    "nuvem" (os dois lugares que fazem sentido para uma linha desta fila);
    ausente/corrompido -> None, e o item segue 100% automatico como sempre.
    O CONTEUDO NAO e validado aqui: quem conhece a grade e o campos_ajustaveis/
    montar_algorithms da audio_cloud (fonte unica, contrato L1) -- valor ruim
    desce como erro de validacao e vira 'failed' antes de qualquer submit.
    """
    if not analysis_json:
        return None
    try:
        dados = json.loads(analysis_json)
    except ValueError:
        return None
    if not isinstance(dados, dict):
        return None
    for onde in (dados, dados.get("nuvem")):
        if isinstance(onde, dict) and CHAVE_SOBRESCRITA in onde:
            return onde[CHAVE_SOBRESCRITA]
    return None


def algoritmos_com_sobrescrita(vid: int, diag: Optional[Dict[str, Any]],
                               alvo: float, teto: float,
                               sobrescrita: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Bloco algorithms da medicao + sobrescrita manual, COM auditoria no log.

    Motivo da funcao existir: quando o resultado volta ruim, o dono precisa
    saber se quem decidiu foi a medicao ou ele mesmo. Sem sobrescrita, nem log
    de decisao manual existe (comportamento de hoje, intocado). Com sobrescrita,
    UMA linha por campo mostra valor automatico -> valor manual.

    Validacao ANTES de sair daqui: montar_algorithms (contrato L1) levanta erro
    em campo desconhecido ou valor fora da grade; o erro sobe como ValueError
    com motivo legivel e o chamador falha o item SEM submit -- producao recusada
    pelo Auphonic gastaria cota gratuita do mesmo jeito. Nunca se ignora override
    invalido em silencio: o dono acreditaria que mandou algo que nao foi.
    """
    from src.services import audio_cloud

    diag_conv = diag_para_algorithms(diag)
    base = audio_cloud.montar_algorithms(diag_conv, alvo, teto)
    if not sobrescrita:
        _log(f"[Nuvem] video={vid}: decisao 100% automatica (medicao local); "
             f"{len(base)} campos enviados, nenhum sobrescrito.")
        return base
    if not isinstance(sobrescrita, dict):
        raise ValueError(
            "Sobrescrita manual malformada (esperado objeto {campo: valor}): "
            f"{sobrescrita!r}. Nada foi enviado a nuvem.")
    try:
        final = audio_cloud.montar_algorithms(diag_conv, alvo, teto,
                                              overrides=dict(sobrescrita))
    except (audio_cloud.AudioCloudError, TypeError, ValueError, KeyError,
            LookupError) as e:
        raise ValueError(
            "Sobrescrita manual recusada ANTES de enviar a nuvem "
            f"(campos: {', '.join(sorted(str(c) for c in sobrescrita))}): {e}") from e
    for campo in sorted(sobrescrita):
        _log(f"[Nuvem] video={vid} SOBRESCRITO pelo dono | {campo}: "
             f"{base.get(campo, '(campo novo fora do bloco automatico)')}"
             f" -> {sobrescrita[campo]}")
    _log(f"[Nuvem] video={vid}: {len(sobrescrita)} campo(s) sobrescrito(s); "
         f"os demais {len(final)} seguem a medicao automatica.")
    return final


def salvar_estado_nuvem(id_linha: int, vid: int, diag: Optional[Dict[str, Any]],
                        estado: Dict[str, Any]) -> None:
    """Grava o bloco nuvem em analysis_json MANTENDO a linha 'running'.

    Chamado IMEDIATAMENTE depois de um submit aceito, antes de qualquer espera:
    dali em diante o uuid sobrevive a morte do processo e a rodada seguinte
    volta a acompanhar a MESMA producao -- nunca um novo submit (cota em dobro).
    """
    analysis = {"antes": diag, "depois": None, "erro": None, "nuvem": estado}
    with get_db() as conn:
        conn.execute(
            "UPDATE audio_render SET analysis_json = ? WHERE id = ?",
            (json.dumps(analysis, ensure_ascii=False), id_linha))
    uuid = str(estado.get("uuid") or "")
    _log(f"[Nuvem] video={vid}: producao {uuid[:8]} registrada no banco "
         f"(retomavel sem novo submit).")


def _espera_cancelavel(task_key: str, segundos: float) -> None:
    """Espera do poll em fatias curtas, NUNCA laco cego.

    Ctrl+C quebra o time.sleep nativamente (sobe para o main, linha volta a ser
    retomada pelo arranque) e o cancelamento via TASK_MANAGER e percebido no
    maximo em FATIA_ESPERA_S segundos."""
    fim = time.monotonic() + max(0.0, float(segundos))
    while True:
        if TASK_MANAGER.is_cancelled(task_key):
            raise _ItemCancelado()
        restante = fim - time.monotonic()
        if restante <= 0.0:
            return
        time.sleep(min(restante, FATIA_ESPERA_S))


def processar_item_auphonic(linha: sqlite3.Row,
                            args: argparse.Namespace) -> Dict[str, Any]:
    """Item de engine auphonic (H5): extrai trecho WAV, montar_algorithms sobre
    a pre-analise salva, submit -> poll -> fetch para
    data/audio_tratado/<video_id>/<chain_hash>.wav, grava path/status e roda a
    analise de depois.

    Regras que dao nome a esta funcao:
    - sobrescrita manual do dono (L3) lida na analysis_json AINDA EM 'pending':
      valida vai ao montar_algorithms com auditoria automatico -> manual no log
      e fica gravada no bloco nuvem; invalida vira 'failed' legivel SEM marcar
      running e SEM submit (producao recusada gastaria cota do mesmo jeito);
    - submit UMA unica vez por producao; o uuid persiste em analysis_json logo
      apos o aceite, e retomada (morte/Ctrl+C/cancelamento) REACOMPANHA a
      producao existente -- reenviar gastaria cota duas vezes;
    - poll respeita progresso (TASK_MANAGER) e interrupcao (Ctrl+C nativo +
      is_cancelled em fatias curtas); item sempre cancelavel;
    - falha da nuvem (rede/chave/cota/producao rejeitada) vira 'failed' com o
      motivo legivel do provedor; fetch grava em temporario e renomeia no fim,
      logo nunca ha WAV pela metade no lugar definitivo.
    """
    from src.media import audio_analysis
    from src.services import audio_cloud

    vid = int(linha["video_id"])
    chain_hash = str(linha["chain_hash"])
    task_key = f"audio-{vid}-{chain_hash[:8]}"
    dest = _raiz_audio_tratado() / str(vid) / f"{chain_hash}.wav"
    ref_relativa = f"data/audio_tratado/{vid}/{chain_hash}.wav"
    diag = diag_antes(linha["analysis_json"])
    tempos: Dict[str, float] = {}
    avisos: List[str] = []

    try:
        cadeia = json.loads(linha["chain_json"] or "[]")
        if not isinstance(cadeia, list) or not all(isinstance(p, str) for p in cadeia):
            raise ValueError("chain_json nao e uma lista de passos.")
        passo = passo_nuvem(cadeia)
        if not passo:
            raise ValueError(
                f"Item roteado para a nuvem sem o passo {PASSO_NUVEM}: {cadeia}.")
        in_s, out_s, duracao = janela_do_item(linha["in_s"], linha["out_s"],
                                              linha["duracao_video"])
        origem_txt = linha["src_filepath"]
        if not origem_txt:
            raise ValueError(f"Video {vid} nao encontrado na tabela video.")
        origem = Path(origem_txt)
        if not origem.exists():
            raise ValueError(f"Arquivo de origem nao encontrado: {origem}")
        alvo_ped, teto_ped = parametros_nuvem(passo)
        projeto = linha["project_id"]
        # Estado da nuvem e sobrescrita manual lidos AQUI, ainda em 'pending':
        # override invalido falha o item com motivo legivel SEM nunca marcar
        # running e SEM chegar perto de submit/gasto de cota.
        anterior = estado_nuvem(linha["analysis_json"])
        uuid = str((anterior or {}).get("uuid") or "")
        retomada = bool(uuid)
        sobrescrita = override_nuvem(linha["analysis_json"])
        if retomada:
            # Producao ja existe na nuvem com a configuracao do submit original;
            # nada aqui mudaria ela -- so registramos que ela nasceu sobrescrita.
            algoritmos: Optional[Dict[str, Any]] = None
            if sobrescrita:
                _log(f"[Nuvem] video={vid}: producao {uuid[:8]} ja submetida com "
                     f"sobrescrita manual ({', '.join(sorted(str(c) for c in sobrescrita))}"
                     f"); reacompanhando sem alterar nada.")
        else:
            alvo, teto = alvos_nuvem(alvo_ped, teto_ped, projeto)
            algoritmos = algoritmos_com_sobrescrita(vid, diag, alvo, teto,
                                                    sobrescrita)
    except (ValueError, TypeError) as e:
        _falhar(linha, task_key, diag, str(e), tempos, avisos)
        return {"status": "failed", "erro": str(e)}


    # --- marca running (a partir dai, morte = retomada no proximo arranque) ---
    with get_db() as conn:
        _marcar(conn, linha["id"], "running", None, None)

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_wav = dest.with_name(f"{PREFIXO_TEMP}{chain_hash[:12]}_pre.wav")
    tmp_baixa = dest.with_name(f"{PREFIXO_TEMP}{chain_hash[:12]}_nuvem.wav")

    def _prog(inicio: float, fim: float):
        def cb(valor) -> None:
            try:
                fracao = float(valor)
            except (TypeError, ValueError):
                return
            if fracao > 1.0:
                fracao /= 100.0
            fracao = min(max(fracao, 0.0), 1.0)
            TASK_MANAGER.update_progress(
                task_key, (inicio + (fim - inicio) * fracao) * 100.0,
                "running", "audio")
        return cb

    try:
        # Mesmo padrao de chave/cota da rota: chave vem de settings/env dentro
        # do provider; o registro de cota fica na data/ deste repositorio (no
        # autoteste, na data/ temporaria, porque _RAIZ_PROJETO e redirecionado).
        provedor = audio_cloud.AuphonicProvider(
            project_id=int(projeto) if projeto is not None else None,
            cota_path=Path(_RAIZ_PROJETO) / "data" / "audio_cloud" / "cota_auphonic.json")

        TASK_MANAGER.update_progress(
            task_key, 0.0, "running", "audio",
            label=f"Tratamento na nuvem (video {vid})",
            log_message=(f"Retomando producao {uuid[:8]} na nuvem." if retomada
                         else f"Auphonic: janela de {duracao:.0f}s enviada ao provedor."))

        if not retomada:
            # ---- 1. extracao do trecho: MESMO corte de transporte do local ---
            t0 = time.perf_counter()
            erro_corte = cortar_janela(origem, tmp_wav, in_s, out_s)
            tempos["corte_janela_s"] = round(time.perf_counter() - t0, 3)
            if erro_corte:
                raise ValueError(erro_corte)
            TASK_MANAGER.update_progress(task_key, 5.0, "running", "audio")

            # ---- 2. submit UNICO; uuid persistido antes de qualquer espera --
            # (o bloco algorithms ja saiu da pre-analise + sobrescrita la atras,
            # validado antes de marcar running; aqui so vai para a nuvem.)
            t0 = time.perf_counter()
            uuid = provedor.submit(tmp_wav, algoritmos)
            tempos["submit_s"] = round(time.perf_counter() - t0, 3)
            if not uuid:
                raise ValueError("Provedor aceitou a producao mas devolveu uuid vazio.")
            salvar_estado_nuvem(linha["id"], vid, diag, {
                "engine": PASSO_NUVEM, "uuid": uuid, "algoritmos": algoritmos,
                "alvo_lufs": alvo, "teto_dbtp": teto,
                "submetido_em": time.strftime("%Y-%m-%dT%H:%M:%S"),
                **({"sobrescrita": dict(sobrescrita)} if sobrescrita else {})})
            TASK_MANAGER.update_progress(
                task_key, 10.0, "running", "audio",
                log_message=f"Producao {uuid[:8]} aceita; acompanhando a nuvem.")
        else:
            avisos.append(
                f"Producao {uuid} retomada de rodada anterior; submit NAO reenviado.")
            _log(f"[Nuvem] video={vid}: reacompanhando producao {uuid} (sem novo submit).")

        # ---- 4. poll ate concluir: longo, mas nunca laco cego ----------------
        st_final = "processando"
        polls = 0
        while True:
            estado = provedor.poll(uuid)
            polls += 1
            _prog(0.15, 0.95)(estado.get("progress") or 0.0)
            st_final = str(estado.get("status") or "processando")
            if st_final in ("concluido", "concluido_com_avisos"):
                if st_final == "concluido_com_avisos":
                    avisos.append("Auphonic concluiu com avisos.")
                break
            if st_final == "erro":
                raise ValueError(
                    f"Auphonic rejeitou a producao {uuid} (status de erro no provedor); "
                    f"confira o painel antes de reaplicar a cadeia.")
            _espera_cancelavel(task_key, INTERVALO_POLL_S)

        # ---- 5. fetch em temporario + rename atomico (nunca arquivo pela metade)
        TASK_MANAGER.update_progress(task_key, 95.0, "running", "audio")
        t0 = time.perf_counter()
        baixado = provedor.fetch(uuid, tmp_baixa)
        tempos["fetch_s"] = round(time.perf_counter() - t0, 3)
        if not Path(baixado).exists() or Path(baixado).stat().st_size == 0:
            raise ValueError("Provedor terminou o download sem gravar bytes.")
        os.replace(str(baixado), str(dest))
        if not dest.exists() or dest.stat().st_size == 0:
            raise ValueError("Download da nuvem nao chegou ao destino definitivo.")

        # ---- 6. analise de DEPOIS (tolerante: vira aviso, nao erro) ----------
        diag_depois = audio_analysis.analisar_intervalo(dest)
        analysis: Dict[str, Any] = {
            "antes": diag,
            "depois": diag_depois if diag_depois.get("ok") else None,
            "erro": None,
            "nuvem": {
                **(anterior or {}),
                # Auditoria sobrevive ao fim do item: o que foi enviado (e o
                # que foi sobrescrito pelo dono) continua legiveis no banco.
                **({"algoritmos": algoritmos,
                    "sobrescrita": dict(sobrescrita)} if not retomada else {}),
                "uuid": uuid, "concluido": st_final,
            },
            "render": {
                "engine": PASSO_NUVEM, "motor": PASSO_NUVEM,
                "cadeia": [passo], "polls": polls,
                "tempos_s": tempos, "avisos": avisos,
                **({"aviso_analise": diag_depois.get("erro")}
                   if not diag_depois.get("ok") else {}),
            },
        }
        with get_db() as conn:
            _marcar(conn, linha["id"], "ready", ref_relativa,
                    json.dumps(analysis, ensure_ascii=False))
        TASK_MANAGER.update_progress(
            task_key, 100.0, "finished", "audio",
            log_message=f"WAV tratado (nuvem) pronto: {ref_relativa}")
        _log(f"[OK] video={vid} hash={chain_hash[:12]} -> {ref_relativa} "
             f"(auphonic, producao {uuid[:8]}, {duracao:.0f}s)")
        return {"status": "ready", "path": ref_relativa}

    except _ItemCancelado:
        # Cancelamento NAO e falha: devolve a fila GUARDANDO o uuid; a rodada
        # seguinte reacompanha a mesma producao (nunca reenvia submit).
        nota = {"antes": diag, "depois": None,
                "erro": "Cancelado pelo usuario durante o acompanhamento da nuvem.",
                "nuvem": {**(anterior or {}),
                          **({"sobrescrita": dict(sobrescrita)}
                             if (sobrescrita and not retomada) else {}),
                          "uuid": uuid}}
        try:
            with get_db() as conn:
                conn.execute(
                    "UPDATE audio_render SET status = 'pending', analysis_json = ? "
                    "WHERE id = ?",
                    (json.dumps(nota, ensure_ascii=False), linha["id"]))
        except sqlite3.Error as e:
            _log(f"[ERRO] video={vid}: cancelado e nao consegui registrar: {e}")
        TASK_MANAGER.update_progress(
            task_key, 100.0, "cancelled", "audio",
            log_message=(f"Nuvem (video {vid}): cancelado; producao {uuid[:8] or '?'} "
                         f"continua no Auphonic e sera reacompanhada."))
        _log(f"[CANCEL] video={vid}: item devolvido a fila; producao "
             f"{uuid or '?'} preservada (sem novo submit).")
        return {"status": "cancelado"}
    except (audio_cloud.AudioCloudError, ValueError, RuntimeError, OSError) as e:
        _falhar(linha, task_key, diag, str(e), tempos, avisos)
        return {"status": "failed", "erro": str(e)}
    finally:
        for lixo in (tmp_wav, tmp_baixa):
            try:
                lixo.unlink()
            except FileNotFoundError:
                pass


# ---------------------------------------------------------------------------
# Estado no banco e no disco
# ---------------------------------------------------------------------------

def retomar_interrompidos(conn: sqlite3.Connection) -> int:
    """Devolve 'running' orfas para 'pending'. So e chamado com a guarda de PID
    na mao: sem outro worker de audio vivo, todo 'running' e de uma morte."""
    linhas = conn.execute(
        "SELECT id, video_id, chain_hash, analysis_json FROM audio_render "
        "WHERE status = 'running'"
    ).fetchall()
    for linha in linhas:
        nota: Dict[str, Any] = {
            "antes": None, "depois": None,
            "erro": ("Rodada anterior interrompida no meio (worker morto); "
                     "linha devolvida a fila pelo worker de audio."),
        }
        # Producao de nuvem JA SUBMETIDA sobrevive a morte do processo: o bloco
        # "nuvem" (uuid) volta para a fila junto com a linha e a rodada nova
        # REACOMPANHA a mesma producao em vez de reenviar o submit -- reenviar
        # gastaria a cota gratuita do mes duas vezes. Linha local (sem bloco
        # nuvem) continua gravando exatamente a mesma nota de antes.
        prev_nuvem = estado_nuvem(linha["analysis_json"])
        if prev_nuvem and prev_nuvem.get("uuid"):
            nota["nuvem"] = prev_nuvem
            _log(f"[Retomada] video={linha['video_id']} "
                 f"hash={linha['chain_hash'][:12]} running->pending; producao "
                 f"{str(prev_nuvem['uuid'])[:8]} sera reacompanhada "
                 f"(sem novo submit).")
        else:
            _log(f"[Retomada] video={linha['video_id']} "
                 f"hash={linha['chain_hash'][:12]} running->pending (rodada anterior morreu).")
        conn.execute(
            "UPDATE audio_render SET status = 'pending', analysis_json = ? WHERE id = ?",
            (json.dumps(nota, ensure_ascii=False), linha["id"]))
    if linhas:
        conn.commit()
    return len(linhas)


def limpar_temporarios(idade_minima_s: float = _IDADE_MINIMA_LIXO_S) -> Tuple[int, int]:
    """Apaga sobras de rodadas mortas: .parcial.wav do renderizar e temporarios
    com PREFIXO_TEMP, dentro de data/audio_tratado. Arquivos mais novos que
    idade_minima_s sao deixados (podem pertencer a um processo vivo)."""
    agora = time.time()
    apagados = pulados = 0
    raiz = Path(_raiz_audio_tratado())
    if not raiz.is_dir():
        return 0, 0
    for padrao in ("*/*.parcial.wav", f"*/{PREFIXO_TEMP}*"):
        for candidato in raiz.glob(padrao):
            try:
                if not candidato.is_file():
                    continue
                if agora - candidato.stat().st_mtime < idade_minima_s:
                    pulados += 1
                    continue
                candidato.unlink()
                apagados += 1
            except OSError as e:
                pulados += 1
                _log(f"[Lixo] Nao consegui apagar {candidato.name}: {e}")
    return apagados, pulados


def _raiz_audio_tratado() -> Path:
    return Path(_RAIZ_PROJETO) / "data" / "audio_tratado"


# ---------------------------------------------------------------------------
# Processamento de um item
# ---------------------------------------------------------------------------

def _marcar(conn: sqlite3.Connection, id_linha: int, status: str,
            path_ref: Optional[str], analysis: Optional[str]) -> None:
    conn.execute(
        "UPDATE audio_render SET status = ?, path = COALESCE(?, path), "
        "analysis_json = ? WHERE id = ?",
        (status, path_ref, analysis, id_linha))


def processar_item(linha: sqlite3.Row, args: argparse.Namespace) -> Dict[str, Any]:
    """Processa UMA linha pending da fila e devolve {'status': ready|failed, ...}.

    Excecao que escape daqui e deliberadamente capturada pelo chamador (padrao do
    worker_transcricao: um item ruim nao pode parar a fila); o erro vai para o
    banco, para o log e para a tela de Tarefas -- nunca engolido.
    """
    from src.media import audio_analysis, audio_chain, audio_denoise

    vid = int(linha["video_id"])
    chain_hash = str(linha["chain_hash"])

    # Roteamento por engine (H5): passo reservado "auphonic" na chain_json,
    # mesma convencao do "daw" do watcher. JSON corrompido segue para o caminho
    # local de sempre, que ja recusa cadeia ruim com motivo claro; item de
    # nuvem tem funcao propria (submit unico, poll cancelavel, fetch).
    try:
        cadeia_rota = json.loads(linha["chain_json"] or "[]")
    except ValueError:
        cadeia_rota = None
    if isinstance(cadeia_rota, list) and any(
            _base_passo(str(p)) == PASSO_NUVEM for p in cadeia_rota):
        return processar_item_auphonic(linha, args)

    task_key = f"audio-{vid}-{chain_hash[:8]}"
    dest = _raiz_audio_tratado() / str(vid) / f"{chain_hash}.wav"
    ref_relativa = f"data/audio_tratado/{vid}/{chain_hash}.wav"
    tempos: Dict[str, float] = {}
    avisos: List[str] = []

    # --- estado 'antes' + janela, ANTES de marcar running ---
    diag = diag_antes(linha["analysis_json"])
    try:
        cadeia = json.loads(linha["chain_json"] or "[]")
        if not isinstance(cadeia, list) or not all(isinstance(p, str) for p in cadeia):
            raise ValueError("chain_json nao e uma lista de passos.")
        pre, passo_ia, post = dividir_cadeia(cadeia)
        if not cadeia:
            raise ValueError("Cadeia vazia na linha da fila: nada para renderizar.")
        if not passo_ia and not (pre or post):
            raise ValueError("Cadeia sem passos utilizaveis.")
        in_s, out_s, duracao = janela_do_item(linha["in_s"], linha["out_s"],
                                              linha["duracao_video"])
        origem_txt = linha["src_filepath"]
        if not origem_txt:
            raise ValueError(f"Video {vid} nao encontrado na tabela video.")
        origem = Path(origem_txt)
        if not origem.exists():
            raise ValueError(f"Arquivo de origem nao encontrado: {origem}")
        if passo_ia:
            aten_pedida, sem_limite = parametros_ia(passo_ia)
            plano = plano_item(diag, aten_pedida, sem_limite)
            disp = audio_denoise.motor_disponivel(args.motor)
            if not disp["ok"]:
                raise ValueError(f"Denoise indisponivel: {disp['motivo']}")
        else:
            plano = {"atenuacao_db": None, "sem_limite": False,
                     "por_canal": False, "duas_fontes": False}
    except (ValueError, TypeError) as e:
        _falhar(linha, task_key, diag, str(e), tempos, avisos)
        return {"status": "failed", "erro": str(e)}

    # --- marca running (a partir dai, morte = retomada no proximo arranque) ---
    with get_db() as conn:
        _marcar(conn, linha["id"], "running", None, None)
    TASK_MANAGER.update_progress(task_key, 0.0, "running", "audio",
                                 label=f"Denoise de audio (video {vid})",
                                 log_message=f"Cadeia com {len(cadeia)} passo(s), "
                                             f"janela {duracao:.0f}s.")

    dest.parent.mkdir(parents=True, exist_ok=True)
    sufixo = f"{PREFIXO_TEMP}{chain_hash[:12]}"
    tmp_pre = dest.with_name(sufixo + "_pre.wav")
    tmp_pos = dest.with_name(sufixo + "_pos.wav")

    def _progresso_etapa(frac_inicio: float, frac_fim: float):
        def cb(valor) -> None:
            try:
                fracao = float(valor)
            except (TypeError, ValueError):
                return
            if fracao > 1.0:
                fracao /= 100.0
            fracao = min(max(fracao, 0.0), 1.0)
            TASK_MANAGER.update_progress(task_key,
                                         (frac_inicio + (frac_fim - frac_inicio) * fracao) * 100.0,
                                         "running", "audio")
        return cb

    try:
        medidas = None
        if not passo_ia:
            # ---- cadeia sem IA: um render so, identico ao caminho da rota ----
            t0 = time.perf_counter()
            r_unico = audio_chain.renderizar(origem, dest, in_s, out_s, cadeia,
                                             progresso=_progresso_etapa(0.0, 1.0))
            tempos["render_s"] = round(time.perf_counter() - t0, 3)
            if not r_unico.get("ok"):
                raise ValueError(r_unico.get("erro") or "ffmpeg falhou no render.")
            medidas = r_unico.get("medidas_loudnorm")
        else:
            # ---- 1. ffmpeg ANTES da IA (reparo de clipping sempre primeiro) ----
            fonte = origem
            if pre:
                t0 = time.perf_counter()
                r_pre = audio_chain.renderizar(fonte, tmp_pre, in_s, out_s, pre,
                                               progresso=_progresso_etapa(0.0, 0.15))
                tempos["pre_render_s"] = round(time.perf_counter() - t0, 3)
                if not r_pre.get("ok"):
                    raise ValueError(r_pre.get("erro") or "ffmpeg falhou na etapa pre-IA.")
                fonte = tmp_pre
            else:
                # Cadeia comeca na IA: entrega a janela certa ao denoisar.
                t0 = time.perf_counter()
                erro_corte = cortar_janela(fonte, tmp_pre, in_s, out_s)
                tempos["corte_janela_s"] = round(time.perf_counter() - t0, 3)
                if erro_corte:
                    raise ValueError(erro_corte)
                fonte = tmp_pre

            # ---- 2. denoise de IA no meio ----
            def _cb_ia(fracao, _etiqueta=None):
                _progresso_etapa(0.15, 0.85)(fracao)
            t0 = time.perf_counter()
            resultado_ia = audio_denoise.denoisar(
                fonte, tmp_pos, plano["atenuacao_enviada_db"],
                motor=args.motor, por_canal=plano["por_canal"],
                progresso=_cb_ia, sem_limite=plano["sem_limite"])
            tempos["denoise_ia_s"] = round(time.perf_counter() - t0, 3)
            avisos.extend(resultado_ia.get("avisos") or [])
            if not resultado_ia.get("ok"):
                raise ValueError(resultado_ia.get("erro") or "denoisar falhou sem mensagem.")
            fonte = tmp_pos

            # ---- 3. loudnorm/limitador DEPOIS (sobre o intermediario inteiro) ----
            if post:
                t0 = time.perf_counter()
                r_post = audio_chain.renderizar(fonte, dest, 0.0, duracao, post,
                                                progresso=_progresso_etapa(0.85, 1.0))
                tempos["post_render_s"] = round(time.perf_counter() - t0, 3)
                if not r_post.get("ok"):
                    raise ValueError(r_post.get("erro") or "ffmpeg falhou na etapa pos-IA.")
                medidas = r_post.get("medidas_loudnorm")
            else:
                os.replace(str(fonte), str(dest))  # denoisar ja entregou o formato

        if not dest.exists() or dest.stat().st_size == 0:
            raise ValueError("Etapa final terminou sem gravar o WAV derivado.")

        # ---- analise de DEPOIS (tolerante: falha dela vira aviso, nao erro) ----
        diag_depois = audio_analysis.analisar_intervalo(dest)
        analysis: Dict[str, Any] = {
            "antes": diag,
            "depois": diag_depois if diag_depois.get("ok") else None,
            "erro": None,
            "render": {
                "motor": args.motor if passo_ia else None,
                "atenuacao_db": plano["atenuacao_enviada_db"],
                "sem_limite": plano["sem_limite"],
                "por_canal": plano["por_canal"],
                "duas_fontes": plano["duas_fontes"],
                "cadeia_pre": pre, "cadeia_ia": [passo_ia] if passo_ia else [],
                "cadeia_post": post,
                "tempos_s": tempos,
                **({"medidas_loudnorm": medidas} if medidas else {}),
                **({"aviso_analise": diag_depois.get("erro")}
                   if not diag_depois.get("ok") else {}),
            },
        }
        analysis["render"].setdefault("avisos", avisos)
        with get_db() as conn:
            _marcar(conn, linha["id"], "ready", ref_relativa,
                    json.dumps(analysis, ensure_ascii=False))
        TASK_MANAGER.update_progress(task_key, 100.0, "finished", "audio",
                                     log_message=f"WAV tratado pronto: {ref_relativa}")
        _log(f"[OK] video={vid} hash={chain_hash[:12]} -> {ref_relativa} "
             f"({'IA ' + args.motor + ', ' if passo_ia else ''}{len(cadeia)} passos, "
             f"{duracao:.0f}s)")
        return {"status": "ready", "path": ref_relativa}
    except (ValueError, RuntimeError, OSError) as e:
        _falhar(linha, task_key, diag, str(e), tempos, avisos)
        return {"status": "failed", "erro": str(e)}
    finally:
        for lixo in (tmp_pre, tmp_pos):
            try:
                lixo.unlink()
            except FileNotFoundError:
                pass


def _falhar(linha: sqlite3.Row, task_key: str,
            diag: Optional[Dict[str, Any]], erro: str,
            tempos: Dict[str, float], avisos: List[str]) -> None:
    """Estado 'failed' com o motivo claro no analysis_json (mesma forma da rota)."""
    vid = int(linha["video_id"])
    analysis = {"antes": diag, "depois": None, "erro": erro,
                "render": {"tempos_s": tempos, "avisos": avisos}}
    try:
        with get_db() as conn:
            _marcar(conn, linha["id"], "failed", None,
                    json.dumps(analysis, ensure_ascii=False))
    except sqlite3.Error as e:
        _log(f"[ERRO] video={vid}: falhou E nao consegui registrar: {e}; motivo: {erro}")
    TASK_MANAGER.update_progress(task_key, 100.0, "failed", "audio",
                                 log_message=f"Falha no audio do video {vid}: {erro}")
    _log(f"[FALHA] video={vid}: {erro}")


# ---------------------------------------------------------------------------
# Fila, guarda de PID e main
# ---------------------------------------------------------------------------

def guarda_de_instancia() -> Optional[str]:
    """Recusa um segundo worker do MESMO tipo. Escreve o nosso PID e confere se
    ainda somos nos: fecha a janela de corrida do lancamento manual (a rota fecha
    a dela regravando o pid logo apos o spawn, docstring de write_worker_pid).
    Registro orfao (dono morto) e substituido sem ceremony, como nos irmaos."""
    dono = worker_is_running(WORKER_TYPE)
    if dono:
        return (f"Ja existe um worker de audio rodando (PID {dono['pid']}, "
                f"iniciado em {time.strftime('%H:%M:%S', time.localtime(dono.get('iniciado_em', 0)))}). "
                "Recusado para nao duplicar a fila.")
    write_worker_pid(WORKER_TYPE)
    dono = worker_is_running(WORKER_TYPE)
    if dono and int(dono.get("pid", 0)) != os.getpid():
        clear_worker_pid(WORKER_TYPE, only_if_owner=True)
        return f"Perdeu a corrida da guarda para o PID {dono['pid']}. Recusado."
    return None


def selecionar_fila(conn: sqlite3.Connection) -> List[sqlite3.Row]:
    """Itens pending, mais antigo primeiro, com filepath/duracao do video."""
    return conn.execute(
        "SELECT r.id, r.video_id, r.in_s, r.out_s, r.chain_hash, r.chain_json, "
        "       r.analysis_json, "
        "       v.filepath AS src_filepath, v.duration AS duracao_video, "
        "       v.project_id AS project_id "
        "FROM audio_render r LEFT JOIN video v ON v.id = r.video_id "
        "WHERE r.status = 'pending' ORDER BY r.id"
    ).fetchall()


def rodar_fila(args: argparse.Namespace) -> int:
    """Uma rodada completa. Pressupoe guarda de PID ja tomada pelo chamador."""
    progresso_arquivo = worker_progress_file(WORKER_TYPE)
    TASK_MANAGER.enable_file_sink(progresso_arquivo)
    _log(f"[Worker] Progresso espelhado em: {progresso_arquivo}")

    apagados, pulados = limpar_temporarios()
    if apagados or pulados:
        _log(f"[Lixo] {apagados} sobra(s) de rodadas mortas apagada(s), "
             f"{pulados} recente(s) preservada(s).")

    with get_db() as conn:
        retomadas = retomar_interrompidos(conn)
        fila = selecionar_fila(conn)
    if retomadas:
        _log(f"[Retomada] {retomadas} linha(s) 'running' orfa(s) devolvida(s) a fila.")
    if not fila:
        _log("[Worker] Fila vazia: nenhum item pending.")
        return 0

    _log(f"[Worker] Fila: {len(fila)} item(ns).")
    falhas = 0
    for pos, linha in enumerate(fila, 1):
        vid = linha["video_id"]
        _log(f"[{pos}/{len(fila)}] video={vid} hash={linha['chain_hash'][:12]}")
        try:
            resumo = processar_item(linha, args)
        except Exception as e:  # noqa: BLE001 - um item ruim nao pode parar a fila
            traceback.print_exc()
            _falhar(linha, f"audio-{vid}-{str(linha['chain_hash'])[:8]}",
                    None, f"Excecao nao tratada: {e}", {}, [])
            resumo = {"status": "failed", "erro": str(e)}
        # 'cancelado' nao e problema do trabalho (item voltou a fila e sera
        # reacompanhado); so 'failed' conta como falha. Itens locais so produzem
        # ready|failed, entao a contagem deles continua igual.
        if resumo["status"] == "failed":
            falhas += 1
    _log(f"=== FIM === {len(fila) - falhas} prontos, {falhas} com problema.")
    return 0 if not falhas else 1


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audio tratado em lote (fila audio_render) em processo separado do servidor.")
    parser.add_argument("--motor", choices=("dpdfnet", "gtcrn"), default="dpdfnet",
                        help="Motor de IA para o passo denoise_ia (default dpdfnet, "
                             "48 kHz, entrega; gtcrn so previa, 16 kHz).")
    parser.add_argument("--autoteste", action="store_true",
                        help="Autoteste completo com dubles e banco SQLite temporario.")
    args = parser.parse_args(argv)

    if args.autoteste:
        return _autoteste()

    motivo = guarda_de_instancia()
    if motivo:
        _log(f"[Guarda] {motivo}")
        return 3
    try:
        return rodar_fila(args)
    except KeyboardInterrupt:
        _log("[Worker] Interrompido pelo teclado; itens 'running' viram 'pending' "
             "no proximo arranque.")
        return 130
    finally:
        clear_worker_pid(WORKER_TYPE, only_if_owner=True)


# ---------------------------------------------------------------------------
# Autoteste: dubles no lugar de audio_chain/audio_denoise + banco temporario
# ---------------------------------------------------------------------------

def _autoteste() -> int:
    """Prova, hoje e sem dependencia de IA: pega pending, marca running, marca
    ready com path, marca failed com erro, guarda de PID recusa segundo worker e
    retomada apos morte simulada; e o caminho auphonic (H5) com DUBLE de
    provedor -- submit uma unica vez, retomada apos morte NAO reenvia, poll ate
    ready com fetch gravando o arquivo, falha da nuvem virando failed com
    motivo e cancelamento preservando a producao; e a SOBRESCRITA MANUAL (L3):
    override valido chega ao montar_algorithms/submit com log automatico ->
    manual e trilha no banco, override invalido vira failed SEM submeter, item
    sem override segue identico e o caminho local ignora a chave. Tudo em
    temporario; nada real e tocado (nenhuma requisicao ao auphonic.com)."""
    import shutil

    from src.media import audio_analysis, audio_chain, audio_denoise
    from src.services import audio_cloud as audio_cloud_mod
    from src.core import tasks as core_tasks
    from src.db.schema import init_db

    # Temporario DENTRO do projeto (data/): a casa ja escreve tudo derivado ai,
    # e o autoteste apaga o diretorio inteiro no fim.
    base = Path(_RAIZ_PROJETO) / "data" / "_autoteste_worker_audio"
    shutil.rmtree(base, ignore_errors=True)
    raiz = base / "repo"
    banco = base / "capiau_teste.db"
    logs_dir = base / "data" / "logs"
    (raiz / "acervo").mkdir(parents=True)
    logs_dir.mkdir(parents=True)

    # --- costuras de injecao (mesma tecnica dos testes da audio_denoise) ---
    import src.config as config_mod
    raiz_real = _RAIZ_PROJETO
    logs_real = core_tasks.WORKER_LOGS_DIR
    db_real = config_mod.CONFIG.DB_PATH
    rends: List[Dict[str, Any]] = []          # registro de chamadas aos dubles
    # dest exato em que o duble de renderizar deve falhar (item B).
    comportamento = {"falhar_dest": ""}
    globals()["_RAIZ_PROJETO"] = raiz          # data/ do worker vira temporario
    globals()["WORKER_LOGS_DIR"] = logs_dir    # log proprio tambem vai p/ temporario
    core_tasks.WORKER_LOGS_DIR = logs_dir      # progresso/pid vao para temporario
    config_mod.CONFIG.DB_PATH = banco          # get_db() le na hora da chamada
    init_db(banco)

    def dub_renderizar(src, dest, in_s, out_s, cadeia, progresso=None):
        rends.append({"tipo": "renderizar", "src": str(src), "dest": str(dest),
                      "in": float(in_s), "out": float(out_s),
                      "cadeia": list(cadeia)})
        assert Path(str(dest)).parent.is_dir(), "destino sem diretorio criado"
        # Prova de estado: enquanto roda, a linha JA esta 'running' no banco.
        c = sqlite3.connect(banco)
        try:
            st = c.execute("SELECT status FROM audio_render WHERE status='running'"
                           ).fetchall()
        finally:
            c.close()  # with nao fecha conexao sqlite: sem isso o .db trava no rmtree
        assert st, "duble de renderizar rodou sem linha 'running' no banco"
        if str(dest) == comportamento["falhar_dest"]:
            return {"ok": False, "erro": "boom do duble de renderizar"}
        Path(str(dest)).write_bytes(b"WAVFAKE")
        return {"ok": True, "path": str(dest), "duracao_render_s": 0.01,
                "medidas_loudnorm": {"measured_I": -16.0}}

    def dub_denoisar(src, dest, atenuacao_db, motor="dpdfnet", por_canal=False,
                     progresso=None, *, sem_limite=False):
        rends.append({"tipo": "denoisar", "src": str(src), "dest": str(dest),
                      "atenuacao_db": atenuacao_db, "motor": motor,
                      "por_canal": bool(por_canal), "sem_limite": bool(sem_limite)})
        if progresso is not None:
            progresso(0.5, "metade")
        Path(str(dest)).write_bytes(b"WAVIA")
        return {"ok": True, "atenuacao_db": atenuacao_db, "saida_hz": 48000,
                "duracao_s": 10.0, "tempo_decorrido_s": 0.02, "avisos": [], "erro": None}

    def dub_analisar(caminho, in_s=None, out_s=None):
        return {"ok": True, "lufs_i": -15.9, "true_peak_db": -3.7,
                "noise_floor_db": -41.0, "lra": 5.0, "canais": 1}

    # A motor_disponivel REAL e mantida de lado: o autoteste prova com ela que,
    # sem sherpa-onnx/modelo, a resposta e honesta (motivo claro, ok=False).
    real_motor_disponivel = audio_denoise.motor_disponivel

    def dub_motor_disponivel(motor="dpdfnet", raiz=None):
        return {"ok": True, "sherpa_onnx": True, "modelo": True, "motivo": None,
                "caminho_modelo": "data/models/dpdfnet2_48khz_hr.onnx"}

    # ---- duble do PROVEDOR DE NUVEM: nenhuma rede, nenhum auphonic.com real --
    provider_real = audio_cloud_mod.AuphonicProvider
    real_cortar_janela = cortar_janela
    nuvem_chamadas: List[Dict[str, Any]] = []
    # Roteiro de poll: respostas consumidas em ordem; Exception no roteiro e
    # levantada (morte simulada), str vira status; esgotado -> concluido 100%.
    nuvem_cfg: Dict[str, Any] = {"roteiro": [], "falhar_submit": "",
                                 "cancelar_no_poll": None}
    contador_uuid = [0]

    class DubleProvider:
        """Dublé do AuphonicProvider: registra chamadas e segue o roteiro."""

        def __init__(self, api_key=None, project_id=None, transporte=None,
                     timeout=120.0, max_tentativas=3, espera_base=1.0,
                     espera_fn=None, cota_path=None):
            self.project_id = project_id
            self.cota_path = cota_path

        def submit(self, wav, algorithms):
            conteudo = Path(str(wav)).read_bytes() if Path(str(wav)).exists() else None
            nuvem_chamadas.append({"tipo": "submit", "wav": str(wav),
                                   "bytes": conteudo,
                                   "algoritmos": dict(algorithms or {})})
            if nuvem_cfg["falhar_submit"]:
                raise audio_cloud_mod.AudioCloudError(nuvem_cfg["falhar_submit"])
            contador_uuid[0] += 1
            return f"uuid-duble-{contador_uuid[0]:04d}"

        def poll(self, uuid):
            nuvem_chamadas.append({"tipo": "poll", "uuid": str(uuid)})
            alvo_cancel = nuvem_cfg["cancelar_no_poll"]
            if alvo_cancel is not None:
                core_tasks.TASK_MANAGER.cancel_task(alvo_cancel)
                nuvem_cfg["cancelar_no_poll"] = None
            if nuvem_cfg["roteiro"]:
                passo_roteiro = nuvem_cfg["roteiro"].pop(0)
                if isinstance(passo_roteiro, BaseException):
                    raise passo_roteiro
                return {"status": passo_roteiro, "progress": 40.0}
            return {"status": "concluido", "progress": 100.0}

        def fetch(self, uuid, dest):
            nuvem_chamadas.append({"tipo": "fetch", "uuid": str(uuid)})
            Path(str(dest)).write_bytes(b"WAVNUVEM")
            return Path(str(dest))

    def dub_cortar_janela(src, dest, in_s, out_s):
        """Dublé do corte de transporte: grava bytes falsos e registra a janela."""
        nuvem_chamadas.append({"tipo": "cortar", "src": str(src),
                               "in": float(in_s), "out": float(out_s)})
        Path(str(dest)).write_bytes(b"WAVJANELA-FALSA-48K24")
        return None

    reais = (audio_chain.renderizar, audio_denoise.denoisar,
             audio_analysis.analisar_intervalo, audio_denoise.motor_disponivel)
    audio_chain.renderizar = dub_renderizar              # type: ignore[assignment]
    audio_denoise.denoisar = dub_denoisar                # type: ignore[assignment]
    audio_analysis.analisar_intervalo = dub_analisar     # type: ignore[assignment]
    audio_denoise.motor_disponivel = dub_motor_disponivel  # type: ignore[assignment]
    audio_cloud_mod.AuphonicProvider = DubleProvider     # type: ignore[assignment]
    globals()["cortar_janela"] = dub_cortar_janela
    globals()["INTERVALO_POLL_S"] = 0.01   # espera do poll encolhe no teste
    globals()["FATIA_ESPERA_S"] = 0.005

    def restaurar():
        (audio_chain.renderizar,
         audio_denoise.denoisar,
         audio_analysis.analisar_intervalo,
         audio_denoise.motor_disponivel) = reais  # type: ignore[misc]
        audio_cloud_mod.AuphonicProvider = provider_real  # type: ignore[assignment]
        globals()["cortar_janela"] = real_cortar_janela
        globals()["_RAIZ_PROJETO"] = raiz_real
        globals()["WORKER_LOGS_DIR"] = logs_real
        core_tasks.WORKER_LOGS_DIR = logs_real
        config_mod.CONFIG.DB_PATH = db_real
        shutil.rmtree(base, ignore_errors=True)

    resultados: List[Tuple[str, bool, str]] = []

    def checar(nome: str, condicao: bool, detalhe: str = "") -> None:
        resultados.append((nome, bool(condicao), detalhe))

    # montar_algorithms REAL (funcao pura, sem rede): o teste prova a traducao
    # pre-analise -> bloco algorithms de ponta a ponta.
    from src.services.audio_cloud import montar_algorithms as montar_algorithms_mod

    def _levanta(fn, excecao) -> bool:
        try:
            fn()
        except excecao:
            return True
        return False

    try:
        with get_db() as conn:
            # init_db ja cria o projeto padrao (id 1): o video referencia ele.
            conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash, duration) "
                         "VALUES (7, 1, 'entrevista.mts', ?, 'h7', 962.0)",
                         (str(raiz / "acervo" / "entrevista.mts"),))
            (raiz / "acervo" / "entrevista.mts").write_bytes(b"ORIGINAL-NUNCA-TOCADO")
            # Item A: cadeia completa com IA no meio (ordem da secao 6).
            # A linha traz uma sobrescrita manual gravada pela rota; o caminho
            # LOCAL nao pode nem ler nem falhar por causa dela (contrato L3).
            cadeia_a = ["adeclip", "adeclick", "denoise_ia:12", "speechnorm",
                        "loudnorm:-16:-1.5", "alimiter:-1.5"]
            hash_a = "a" * 64
            conn.execute("INSERT INTO audio_render (video_id, in_s, out_s, chain_hash, "
                         "chain_json, status, analysis_json) VALUES (7, 405.0, 425.0, "
                         "?, ?, 'pending', ?)",
                         (hash_a, json.dumps(cadeia_a),
                          json.dumps({CHAVE_SOBRESCRITA: {"gate": True}})))
            # Item B: falha no meio (doble configurado para errar).
            hash_b = "b" * 64
            conn.execute("INSERT INTO audio_render (video_id, in_s, out_s, chain_hash, "
                         "chain_json, status) VALUES (7, 0.0, 30.0, ?, "
                         "'[\"loudnorm:-16\"]', 'pending')", (hash_b,))
            # Item C: morte simulada -- running orfa + sobra velha no disco.
            hash_c = "c" * 64
            conn.execute("INSERT INTO audio_render (video_id, in_s, out_s, chain_hash, "
                         "chain_json, status) VALUES (7, 0.0, 20.0, ?, "
                         "'[\"adeclip\",\"denoise_ia\",\"loudnorm:-16\"]', 'running')",
                         (hash_c,))
            lixo_velho = (_raiz_audio_tratado() / "7")
            lixo_velho.mkdir(parents=True, exist_ok=True)
            sobra = lixo_velho / f".worker_audio_{hash_c[:12]}_pos.wav"
            sobra.write_bytes(b"METADE-DE-UM-WAV")
            velho = time.time() - 7200
            os.utime(sobra, (velho, velho))
            conn.commit()

        args = argparse.Namespace(motor="dpdfnet")
        # O item B falha de proposito: o duble recusa exatamente o dest dele.
        comportamento["falhar_dest"] = str(_raiz_audio_tratado() / "7" / f"{hash_b}.wav")
        rc = rodar_fila(args)
        comportamento["falhar_dest"] = ""

        with get_db() as conn:
            linhas = {r["chain_hash"]: r for r in
                      conn.execute("SELECT * FROM audio_render").fetchall()}
        la, lb, lc = linhas[hash_a], linhas[hash_b], linhas[hash_c]

        checar("fila terminou com codigo 1 (um item falhou de proposito)", rc == 1,
               f"rc={rc}")
        disp_real = real_motor_disponivel()
        if disp_real["ok"]:
            # Maquina COM sherpa-onnx + modelo no disco (ex.: a do dono, que ja
            # tratou uma entrevista inteira): o honesto e dizer que esta pronto.
            checar("(0) com dependencia instalada, motor_disponivel confirma modelo",
                   bool(disp_real.get("caminho_modelo")),
                   str(disp_real.get("caminho_modelo")))
        else:
            checar("(0) sem dependencia, degradacao e honesta (sherpa+modelo no motivo)",
                   "sherpa-onnx nao instalado" in (disp_real["motivo"] or "")
                   and "modelo ausente" in (disp_real["motivo"] or ""),
                   str(disp_real.get("motivo")))
        checar("(1) pending foi pego e terminou ready", la["status"] == "ready",
               la["status"])
        checar("(1) marca running durante o processo",
               any(r["tipo"] == "renderizar" for r in rends),
               f"{sum(1 for r in rends)} chamadas registradas")
        checar("(1) ready com path relativo padrao da casa",
               la["path"] == f"data/audio_tratado/7/{hash_a}.wav", str(la["path"]))
        checar("(1) WAV derivado existe no disco",
               (_raiz_audio_tratado() / "7" / f"{hash_a}.wav").is_file())
        checar("(1) analysis_json guarda antes/depois/render",
               all(k in json.loads(la["analysis_json"]) for k in ("antes", "depois", "render")))
        def _tem_passo(r, nome):
            return any(_base_passo(p) == nome for p in r.get("cadeia", []))
        ia_idx = [i for i, r in enumerate(rends) if r["tipo"] == "denoisar"]
        pre_idx = [i for i, r in enumerate(rends)
                   if r["tipo"] == "renderizar" and r["cadeia"][0] == "adeclip"]
        post_idx = [i for i, r in enumerate(rends)
                    if r["tipo"] == "renderizar" and _tem_passo(r, "loudnorm")]
        checar("(2) ordem: clipping PRE, IA no MEIO, loudnorm/limiter DEPOIS",
               bool(pre_idx and ia_idx and post_idx)
               and pre_idx[-1] < ia_idx[-1] < post_idx[-1],
               " -> ".join(r["tipo"] for r in rends))
        checar("(2) etapa pre-IA cobre a janela pedida",
               any(r["in"] == 405.0 and r["out"] == 425.0 for r in rends
                   if r["tipo"] == "renderizar"))
        checar("(2) etapa pos-IA roda sobre o intermediario inteiro",
               any(r["in"] == 0.0 and r["out"] == 20.0 for r in rends
                   if r["tipo"] == "renderizar" and _tem_passo(r, "loudnorm")))
        checar("(2) atenuacao veio do passo (12 dB)",
               any(r["atenuacao_db"] == 12.0 and r["motor"] == "dpdfnet"
                   for r in rends if r["tipo"] == "denoisar"))
        checar("(2) original nunca tocado",
               (raiz / "acervo" / "entrevista.mts").read_bytes() == b"ORIGINAL-NUNCA-TOCADO")

        dados_b = json.loads(lb["analysis_json"]) if lb["analysis_json"] else {}
        checar("(3) item com defeito marca failed com erro",
               lb["status"] == "failed" and "boom do duble" in (dados_b.get("erro") or ""),
               f"{lb['status']} / {dados_b.get('erro')}")

        # Guarda de PID: segundo worker recusado enquanto um vive.
        core_tasks.write_worker_pid(WORKER_TYPE)   # pid = processo do teste (vivo)
        motivo = guarda_de_instancia()
        checar("(4) guarda de PID recusa segundo worker",
               motivo is not None and str(os.getpid()) in motivo, motivo or "None")
        core_tasks.clear_worker_pid(WORKER_TYPE)

        # Retomada: morte simulada ja preparada no item C ('running' orfa + sobra).
        with get_db() as conn:
            conn.execute("UPDATE audio_render SET status='running' WHERE chain_hash=?",
                         (hash_c,))
        rc_c = rodar_fila(args)
        with get_db() as conn:
            lc = conn.execute("SELECT * FROM audio_render WHERE chain_hash=?",
                              (hash_c,)).fetchone()
        checar("(5) morte simulada: 'running' orfa retomada e concluida",
               rc_c == 0 and lc["status"] == "ready", lc["status"])
        checar("(5) sobra de arquivo pela metade foi varrida",
               not sobra.exists())

        # Unidade: divisao de cadeia e parametros.
        pre_u, ia_u, post_u = dividir_cadeia(cadeia_a)
        checar("unidade: dividir_cadeia parte no denoise_ia",
               pre_u == ["adeclip", "adeclick"] and ia_u == "denoise_ia:12"
               and post_u == ["speechnorm", "loudnorm:-16:-1.5", "alimiter:-1.5"])
        checar("unidade: parametros_ia le dB e sem_limite",
               parametros_ia("denoise_ia:12") == (12.0, False)
               and parametros_ia("denoise_ia:sem_limite") == (None, True))
        checar("unidade: janela_do_item resolve NULL com duracao do video",
               janela_do_item(None, None, 962.0) == (0.0, 962.0, 962.0))

        # =====================================================================
        # CAMINHO DA NUVEM (H5) -- duble de provedor, NENHUMA rede real.
        # Item D: submit unico -> MORTE no meio do poll -> retomada SEM
        #         reenvio -> poll ate ready com fetch gravando o WAV.
        # Item E: nuvem recusa o submit -> failed com motivo legivel.
        # Item F: cancelamento durante o poll -> pending com uuid preservado.
        # =====================================================================
        hash_d = "d" * 64
        hash_e = "e" * 64
        hash_f = "f" * 64

        def _inserir_nuvem(hash_nuvem: str, in_s: float, out_s: float,
                           passo_json: str,
                           analise: Optional[Dict[str, Any]] = None) -> None:
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO audio_render (video_id, in_s, out_s, chain_hash, "
                    "chain_json, status, analysis_json) VALUES (7, ?, ?, ?, ?, "
                    "'pending', ?)",
                    (in_s, out_s, hash_nuvem, passo_json,
                     json.dumps(analise if analise is not None else
                                {"lufs_i": -23.8, "true_peak_db": 0.4,
                                 "noise_floor_db": -38.0, "lra": 9.0,
                                 "clip_pct": 0.651})))

        def _linha(hash_nuvem: str) -> sqlite3.Row:
            with get_db() as conn:
                return conn.execute("SELECT * FROM audio_render WHERE chain_hash=?",
                                    (hash_nuvem,)).fetchone()

        # ---- D, fase 1: submit aceito e MORTE simulada durante o poll -------
        _inserir_nuvem(hash_d, 100.0, 160.0, '["auphonic:-16:-1.5"]')
        nuvem_cfg["roteiro"] = [KeyboardInterrupt("morte simulada no meio do poll")]
        try:
            rodar_fila(args)          # a morte sobe como KeyboardInterrupt
            morto = False
        except KeyboardInterrupt:
            morto = True              # mesmo efeito de matar o processo
        ld1 = _linha(hash_d)
        estado_d1 = estado_nuvem(ld1["analysis_json"])
        submits_d = sum(1 for c in nuvem_chamadas if c["tipo"] == "submit")
        checar("(6) auphonic: submetido UMA unica vez; uuid sobreviveu a morte",
               morto and submits_d == 1 and ld1["status"] == "running"
               and bool(estado_d1 and estado_d1.get("uuid")),
               f"morto={morto} submits={submits_d} status={ld1['status']} "
               f"estado={bool(estado_d1)}")
        sub_d = next(c for c in nuvem_chamadas if c["tipo"] == "submit")
        checar("(6) auphonic: extraiu a janela certa para WAV antes do submit",
               any(c["tipo"] == "cortar" and c["in"] == 100.0 and c["out"] == 160.0
                   for c in nuvem_chamadas)
               and sub_d["bytes"] == b"WAVJANELA-FALSA-48K24"
               and f".worker_audio_{hash_d[:12]}" in Path(sub_d["wav"]).name,
               str(sub_d["wav"]))
        checar("(6) auphonic: algorithms saem da pre-analise (secao 8 + L1: dehum Auto)",
               sub_d["algoritmos"] == {
                   "loudnesstarget": -16, "normloudness": True, "maxpeak": -1.5,
                   "denoise": True, "denoiseamount": 6,
                   "denoisemethod": "static", "filtering": True,
                   "filtermethod": "autoeq",
                   "leveler": True, "levelerstrength": 60,
                   "dehum": 0, "dehumamount": 0,
                   "silence_cutter": False, "filler_cutter": False},
               json.dumps(sub_d["algoritmos"], sort_keys=True))

        # ---- D, fase 2: novo "processo" retoma e REACOMPANHA sem reenviar ---
        nuvem_cfg["roteiro"] = ["processando"]
        rc_d2 = rodar_fila(args)
        ld2 = _linha(hash_d)
        polls_d = sum(1 for c in nuvem_chamadas if c["tipo"] == "poll")
        fetches_d = [c for c in nuvem_chamadas if c["tipo"] == "fetch"]
        dest_d = _raiz_audio_tratado() / "7" / f"{hash_d}.wav"
        dados_d = json.loads(ld2["analysis_json"]) if ld2["analysis_json"] else {}
        checar("(7) retomada apos morte: poll ate ready SEM reenviar o submit",
               rc_d2 == 0 and ld2["status"] == "ready" and submits_d == sum(
                   1 for c in nuvem_chamadas if c["tipo"] == "submit")
               and polls_d >= 3 and len(fetches_d) == 1
               and fetches_d[0]["uuid"] == estado_d1.get("uuid"),
               f"rc={rc_d2} status={ld2['status']} submits={submits_d} "
               f"polls={polls_d} fetch={len(fetches_d)}")
        checar("(7) fetch gravou o WAV definitivo no padrao da casa",
               ld2["path"] == f"data/audio_tratado/7/{hash_d}.wav"
               and dest_d.is_file() and dest_d.read_bytes() == b"WAVNUVEM",
               str(ld2["path"]))
        checar("(7) analise de depois rodou e aviso de nao-reenvio registrado",
               (dados_d.get("depois") or {}).get("ok") is True
               and (dados_d.get("render") or {}).get("engine") == "auphonic"
               and any("NAO reenviado" in a for a in
                       (dados_d.get("render") or {}).get("avisos", []))
               and (dados_d.get("nuvem") or {}).get("concluido") == "concluido",
               str((dados_d.get("render") or {}).get("avisos")))
        sobras_nuvem = [p.name for p in (_raiz_audio_tratado() / "7").glob(
            f"{PREFIXO_TEMP}*")] if (_raiz_audio_tratado() / "7").is_dir() else []
        checar("(7) nenhum temporario sobrou do caminho da nuvem",
               not sobras_nuvem, ", ".join(sobras_nuvem))

        # ---- E: falha da nuvem vira failed com motivo legivel ----------------
        _inserir_nuvem(hash_e, 200.0, 230.0, '["auphonic"]')
        nuvem_cfg["falhar_submit"] = "Cota gratuita esgotada no duble."
        rc_e = rodar_fila(args)
        nuvem_cfg["falhar_submit"] = ""
        le = _linha(hash_e)
        dados_e = json.loads(le["analysis_json"]) if le["analysis_json"] else {}
        checar("(8) falha da nuvem: failed com motivo legivel, sem arquivo",
               rc_e == 1 and le["status"] == "failed"
               and "Cota gratuita esgotada no duble." in (dados_e.get("erro") or "")
               and not (_raiz_audio_tratado() / "7" / f"{hash_e}.wav").exists()
               and not estado_nuvem(le["analysis_json"]),
               f"{le['status']} / {dados_e.get('erro')}")

        # ---- F: cancelamento no meio do poll preserva a producao -------------
        _inserir_nuvem(hash_f, 300.0, 330.0, '["auphonic"]')
        nuvem_cfg["roteiro"] = ["processando"]
        nuvem_cfg["cancelar_no_poll"] = f"audio-7-{hash_f[:8]}"
        rc_f = rodar_fila(args)
        lf = _linha(hash_f)
        estado_f = estado_nuvem(lf["analysis_json"])
        checar("(9) item cancelavel: volta a pending com uuid preservado, sem falha",
               rc_f == 0 and lf["status"] == "pending"
               and bool(estado_f and estado_f.get("uuid"))
               and "Cancelado pelo usuario" in (lf["analysis_json"] or ""),
               f"rc={rc_f} status={lf['status']} uuid={bool(estado_f)}")

        # =====================================================================
        # SOBRESCRITA MANUAL (L3): o dono discorda da maquina num clipe.
        # Item G: override INVALIDO na linha (a rota valida antes; linha antiga
        #         ou banco editado a mao nao passou por la) -> failed legivel
        #         SEM submit, SEM corte, SEM fetch -- producao recusada pela
        #         nuvem gastaria cota gratuita do mesmo jeito.
        # Item H: override VALIDO -> valores chegam ao montar_algorithms/submit,
        #         o log mostra automatico -> manual e o banco guarda a trilha.
        # =====================================================================
        hash_g = "g" * 64
        hash_h = "h" * 64

        def _linhas_log() -> List[str]:
            arquivo_log = Path(logs_dir) / f"{WORKER_TYPE}_worker.log"
            if not arquivo_log.exists():
                return []
            return arquivo_log.read_text(encoding="utf-8").splitlines()

        diag_nuvem = {"lufs_i": -23.8, "true_peak_db": 0.4,
                      "noise_floor_db": -38.0, "lra": 9.0, "clip_pct": 0.651}
        _inserir_nuvem(hash_g, 400.0, 430.0, '["auphonic:-16:-1.5"]',
                       analise={**diag_nuvem,
                                CHAVE_SOBRESCRITA: {"levelerstrength": 999}})
        _inserir_nuvem(hash_h, 500.0, 540.0, '["auphonic:-16:-1.5"]',
                       analise={**diag_nuvem,
                                CHAVE_SOBRESCRITA: {"loudnesstarget": -19,
                                                    "dehum": 60,
                                                    "levelerstrength": 80}})
        submits_antes = sum(1 for c in nuvem_chamadas if c["tipo"] == "submit")
        rc_gh = rodar_fila(args)   # F retomado; G falha antes da nuvem; H submete
        submits_depois = sum(1 for c in nuvem_chamadas if c["tipo"] == "submit")

        lg = _linha(hash_g)
        dados_g = json.loads(lg["analysis_json"]) if lg["analysis_json"] else {}
        checar("(10) override invalido: failed legivel ANTES da nuvem (sem submit/corte)",
               lg["status"] == "failed" and rc_gh == 1
               and "Sobrescrita manual recusada ANTES de enviar a nuvem" in (dados_g.get("erro") or "")
               and "levelerstrength" in (dados_g.get("erro") or "")
               and submits_depois - submits_antes == 1
               and not any(c["tipo"] == "cortar" and c["in"] == 400.0
                           for c in nuvem_chamadas)
               and not any(hash_g[:12] in str(c.get("wav", ""))
                           for c in nuvem_chamadas),
               f"rc={rc_gh} {lg['status']} / {dados_g.get('erro')}")

        sub_h = next(c for c in nuvem_chamadas
                     if c["tipo"] == "submit" and hash_h[:12] in str(c.get("wav", "")))
        checar("(11) sobrescrita chega ao montar_algorithms/submit (manual vence)",
               sub_h["algoritmos"]["loudnesstarget"] == -19
               and sub_h["algoritmos"]["dehum"] == 60
               and sub_h["algoritmos"]["levelerstrength"] == 80
               and sub_h["algoritmos"]["maxpeak"] == -1.5           # intocado: medicao
               and sub_h["algoritmos"]["denoiseamount"] == 6        # intocado: medicao
               and sub_h["algoritmos"]["silence_cutter"] is False,  # inegociavel
               json.dumps(sub_h["algoritmos"], sort_keys=True))

        linhas_sobr = [ln for ln in _linhas_log() if "SOBRESCRITO" in ln]
        checar("(11) log audita cada campo: automatico -> manual",
               any("loudnesstarget" in ln and "-> -19" in ln for ln in linhas_sobr)
               and any("dehum" in ln and "-> 60" in ln for ln in linhas_sobr)
               and any("levelerstrength" in ln and "-> 80" in ln for ln in linhas_sobr),
               " | ".join(linhas_sobr[-3:]))

        lh = _linha(hash_h)
        dados_h = json.loads(lh["analysis_json"]) if lh["analysis_json"] else {}
        checar("(12) sobrescrita fica no banco para auditoria posterior",
               lh["status"] == "ready"
               and (dados_h.get("nuvem") or {}).get("sobrescrita")
               == {"loudnesstarget": -19, "dehum": 60, "levelerstrength": 80}
               and (dados_h.get("nuvem") or {}).get("algoritmos") == sub_h["algoritmos"],
               json.dumps((dados_h.get("nuvem") or {}), sort_keys=True))

        checar("(13) sem override: bloco enviado identico ao automatico puro (hoje)",
               sub_d["algoritmos"] == montar_algorithms_mod(
                   diag_para_algorithms(diag_nuvem), -16.0, -1.5)
               and not (dados_d.get("nuvem") or {}).get("sobrescrita"),
               json.dumps(sub_d["algoritmos"], sort_keys=True))

        # Unidade: contrato do passo de nuvem e adapter da pre-analise.
        checar("unidade: passo_nuvem recusa cadeia misturada",
               passo_nuvem(["auphonic"]) == "auphonic"
               and _levanta(lambda: passo_nuvem(["auphonic", "adeclip"]),
                            ValueError))
        checar("unidade: parametros_nuvem le alvo/teto",
               parametros_nuvem("auphonic:-20:-2") == (-20.0, -2.0)
               and parametros_nuvem("auphonic") == (None, None))
        checar("unidade: alvos_nuvem - passo ganha; settings cobrem o resto",
               alvos_nuvem(-20.0, -2.0, None) == (-20.0, -2.0)
               and alvos_nuvem(None, None, 1) == (-16.0, -1.5))
        alg_u = montar_algorithms_mod(diag_para_algorithms(
            {"lufs_i": -23.8, "true_peak_db": 0.4, "noise_floor_db": -38.0,
             "lra": 9.0, "clip_pct": 0.651}), -16.0, -1.5)
        checar("unidade: diag_para_algorithms converte (% -> fracao, chaves)",
               alg_u["denoise"] is True and alg_u["denoiseamount"] == 6
               and alg_u["levelerstrength"] == 60
               and alg_u["filtering"] is True
               and alg_u["loudnesstarget"] == -16,
               json.dumps(alg_u, sort_keys=True))
        dados_a_render = (json.loads(la["analysis_json"]) or {}).get("render") or {}
        checar("(14) caminho local ignora override na linha (A segue como antes)",
               la["status"] == "ready"
               and "engine" not in dados_a_render
               and not any(hash_a[:12] in str(c.get("wav", ""))
                           for c in nuvem_chamadas if c["tipo"] == "submit"),
               la["status"])
        checar("(L) caminho local intacto: A pronto, B failed, C retomado como antes",
               la["status"] == "ready" and lb["status"] == "failed"
               and lc["status"] == "ready",
               f"{la['status']}/{lb['status']}/{lc['status']}")
    finally:
        restaurar()

    ok_total = all(r[1] for r in resultados)
    print()
    print("=" * 62)
    for nome, ok, detalhe in resultados:
        marca = "PASSOU" if ok else "FALHOU"
        extra = f"  [{detalhe}]" if detalhe and not ok else ""
        print(f"  [{marca}] {nome}{extra}")
    print("=" * 62)
    print(f"AUTOTESTE {'OK' if ok_total else 'COM FALHAS'}: "
          f"{sum(1 for _, ok, _ in resultados if ok)}/{len(resultados)} checks.")
    # Segunda passada de limpeza: se alguma conexao sqlite ainda estivesse
    # fechando, o rmtree do restaurar deixa o .db para tras.
    for _ in range(3):
        if not base.exists():
            break
        shutil.rmtree(base, ignore_errors=True)
        time.sleep(0.2)
    print(f"[Limpeza] temporario removido: {not base.exists()} ({base})")
    return 0 if ok_total else 1


if __name__ == "__main__":
    sys.exit(main())
