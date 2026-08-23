"""Cadeia ffmpeg RENDERIZADA de audio (contrato F1 da ETAPA 3 de PLANO_AJUSTES_DE_AUDIO).

Tipo B do plano (secao 2): tratamento que GERA ARQUIVO. Roda offline, produz um
WAV 48 kHz 24 bits em data/audio_tratado/<video_id>/<chain_hash>.wav, e o clipe
passa a APONTAR para ele. O original nunca e tocado.

O passo de IA existe e tem lugar fixo na ordem canonica: "denoise_ia" (entre o
denoise classico e o speechnorm), gerado pela intencao {"denoise_ia": True,
"denoise_ia_db": <dB opcional>} de normalizar_cadeia. ELE NAO RODA AQUI: este
modulo so executa ffmpeg (filtros a 31-44x tempo real) e o denoise por IA roda
a ~0,7x tempo real - cerca de 50 VEZES mais lento que o resto da cadeia (~11
min para uma entrevista de 22 min). Quem executa o passo de IA e o worker de
audio (src/worker_audio.py: dividir_cadeia parte a cadeia no "denoise_ia" e
chama src/media/audio_denoise.denoisar). Por isso montar_filtros e renderizar
RECUSAM qualquer cadeia que contenha o passo, com mensagem clara - nunca pulam
a IA em silencio devolvendo audio sem tratar como se tivesse tratado.

Pecas do contrato F1:
- normalizar_cadeia(opcoes): intencao -> lista canonica ORDENADA. A mesma
  intencao sempre gera exatamente a mesma lista (ordem incluida) - e isso que
  faz o hash servir de chave de cache.
- hash_cadeia(video_id, in_s, out_s, cadeia): sha256 hexdigest de
  "render|<video_id>|<in>|<out>|<cadeia unida por |>".
- montar_filtros(cadeia, medidas=None): string do -af. Com medidas=None o
  loudnorm sai na forma da PRIMEIRA passagem (print_format=json, que mede);
  com medidas (resultado dessa primeira passagem) sai a forma LINEAR da
  segunda. Uma passagem so nao serve: errou 0,7 LU na medicao real do plano.
- renderizar(...): roda o ffmpeg de verdade (duas passagens quando ha
  loudnorm) com guarda de seguranca: nunca escreve dentro de F:/ (acervo e
  somente leitura) e nunca sobrescreve o arquivo de origem.
"""
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Ordem canonica (secao 6 do plano): reparo de clipping SEMPRE primeiro;
# nivelamento/loudness perto do fim; limitador por ultimo. "denoise_ia" e o
# passo de IA da ETAPA 4: gerado pela intencao de normalizar_cadeia e executado
# APENAS pelo worker de audio - o ffmpeg deste modulo nunca o roda.
# ---------------------------------------------------------------------------
CADEIA_ORDEM: Tuple[str, ...] = (
    "adeclip",      # reparo de clipping
    "adeclick",     # reparo de clicks/estouros impulsivos
    "deesser",
    "anlmdn",       # denoise classico (Non-Local Means)
    "afftdn",       # denoise classico (FFT) - fallback sem IA da secao 6
    "denoise_ia",   # denoise por IA (DPDFNet/GTCRN) - roda NO WORKER, ~50x mais lento
    "speechnorm",
    "loudnorm",     # EBU R128, SEMPRE 2 passagens neste modulo
    "alimiter",     # teto de pico, sempre por ultimo
)

_PASSO_IA_RESERVADO = "denoise_ia"
# Mesmo token de worker_audio.SEM_LIMITE (gramatica do passo de IA que o worker
# ja sabe ler em parametros_ia); repetido aqui para audio_chain nao depender do
# worker (que importa CADEIA_ORDEM daqui).
_TOKEN_SEM_LIMITE_IA = "sem_limite"

# Defaults do projeto (mesmos valores dos limiares da ETAPA 1 e da UI da secao 4).
ALVO_LUFS_PADRAO = -16.0
TETO_DBTP_PADRAO = -1.5
_LRA_ALVO = 11.0            # alvo de Loudness Range do loudnorm (default do filtro)
_AFFTDN_NR_PADRAO_DB = 12.0 # reducao padrao do denoise classico FFT

# Quantas opcoes cada passo aceita depois dos ":" (ex.: "loudnorm:-16:-1.5").
_PARAMS_POR_PASSO: Dict[str, Tuple[int, int]] = {
    "adeclip": (0, 0),
    "adeclick": (0, 0),
    "deesser": (0, 0),
    "anlmdn": (0, 0),
    "afftdn": (0, 1),   # [nr_db]
    "denoise_ia": (0, 1),  # [atenuacao_db | "sem_limite"] - gramatica do worker
    "speechnorm": (0, 0),
    "loudnorm": (0, 2), # [alvo_lufs, teto_dbtp]
    "alimiter": (0, 1), # [teto_dbtp]
}

_CHAVES_OPCOES = (
    "reparo_clipping",   # bool -> adeclip + adeclick
    "deesser",           # bool
    "denoise_classico",  # None | "anlmdn" | "afftdn"
    "denoise_nr_db",     # float, so afeta o afftdn
    "denoise_ia",        # bool -> passo "denoise_ia" (CARO: roda no worker a
                         #         ~0,7x tempo real, ~50x mais lento que o ffmpeg)
    "denoise_ia_db",     # float opcional -> "denoise_ia:<dB>" (so se denoise_ia)
    "speechnorm",        # bool
    "loudnorm",          # bool
    "alvo_lufs",         # float (loudnorm)
    "teto_dbtp",         # float (loudnorm e alimiter)
    "limitador",         # bool -> alimiter
)

PRESETS_CADEIA: Dict[str, Dict[str, Any]] = {
    # Secao 7 do plano. Os valores sao a INTENCAO; a lista canonica sai de
    # normalizar_cadeia(PRESETS_CADEIA[nome]).
    #
    # CUSTO (medido nesta maquina): os QUATRO presets classicos abaixo so usam
    # filtros ffmpeg, a 31-44x tempo real (uma entrevista de 22 min trata em
    # segundos). Os DOIS presets *_ia no fim incluem o passo "denoise_ia", que
    # roda a ~0,7x tempo real no worker (~11 min para os mesmos 22 min) - a IA
    # e cerca de 50 VEZES mais lenta que o resto da cadeia. Por decisao do dono
    # esse custo e uma ESCOLHA VISIVEL: preset separado, nome distinto. NENHUM
    # preset classico foi alterado para usar IA.
    "so_entrega": {
        "loudnorm": True, "limitador": True,
    },  # apenas loudnorm 2 passes + limiter; nao toca no timbre
    "resgate_estourado": {
        "reparo_clipping": True,
        "denoise_classico": "afftdn",   # substituto sem IA do denoise 12-18 dB
        "loudnorm": True, "limitador": True,
    },  # caso Julia + Virshna; sem speechnorm porque LRA < 5 bloqueia (secao 7)
    "ambiencia_preservada": {
        "denoise_classico": "afftdn", "denoise_nr_db": 6.0,
        "loudnorm": True,
    },  # denoise leve 6 dB, SEM speechnorm e SEM limiter (plano de rua/feira);
        # loudnorm fica porque entrega sem loudness alvo volta fora de spec
    "previa_rapida": {
        "loudnorm": True,
    },  # GTCRN + loudnorm no plano; GTCRN e IA (ETAPA 4), entao hoje roda
        # so o loudnorm 2 passes - a ~90x tempo real ja serve de previa

    # ---- Presets de IA (CAROS - veja o custo no comentario acima). Restauram
    # ---- a intencao ORIGINAL da secao 7, que descrevia voz_limpa e
    # ---- resgate_estourado com denoise por IA antes de o motor existir.
    "resgate_ia": {
        "reparo_clipping": True,
        "denoise_ia": True,
        "denoise_ia_db": 18.0,   # atenuacao ALTA: piso -27 dB pede o teto do clamp [6, 18]
        "loudnorm": True, "limitador": True,
    },  # caso Julia + Virshna (estourado E ruidoso), agora com IA de verdade;
        # sem speechnorm, igual ao resgate_estourado, porque LRA < 5 bloqueia
        # (secao 7). CARO: ~11 min de worker para 22 min de audio.
    "voz_limpa_ia": {
        "denoise_ia": True,
        "denoise_ia_db": 6.0,    # denoise LEVE da secao 7 ("denoise leve (6 dB)")
        "loudnorm": True,
    },  # entrevista ja bem captada onde so incomoda o chiado; SEM limitador e
        # SEM compressao. Continua caro: o passo de IA domina o custo.
}

_TIMEOUT_FFMPEG_RENDER_S = 900.0
_SAIDA_SAMPLE_RATE = 48000


def _startupinfo():
    """Mesmo jeito de invocar subprocesso de src/media/ffmpeg.py."""
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return startupinfo


def _num(valor) -> str:
    """Numero canonico para compor passo/hash: 405 e 405.0 viram "405"."""
    f = float(valor)
    if f != f or f in (float("inf"), float("-inf")):
        raise ValueError(f"Numero invalido na cadeia: {valor!r}")
    texto = f"{f:.6f}".rstrip("0").rstrip(".")
    return "0" if texto in ("", "-0") else texto


def _parte(nome: str, params: List[str]) -> str:
    """Junta nome + params num passo canonico, ex.: "loudnorm:-16:-1.5"."""
    return ":".join([nome] + list(params))


def _partir_passo(passo: str) -> Tuple[str, List[str]]:
    """Valida um passo "nome[:p1[:p2]]" contra CADEIA_ORDEM e devolve (nome, params).

    Aceita o passo de IA na gramatica que o worker ja le (worker_audio.
    parametros_ia): "denoise_ia", "denoise_ia:<dB>" ou
    "denoise_ia:sem_limite" - unico parametro nao numerico do catalogo.
    Quem RECUSA o passo de IA e montar_filtros/renderizar (ele nao roda no
    ffmpeg); hash_cadeia/normalizar_cadeia precisam aceita-lo porque o hash e a
    chave de cache de cadeias que INCLUEM IA.
    """
    partes = str(passo).strip().split(":")
    nome = partes[0].strip().lower()
    params = [p for p in partes[1:]]
    if nome not in CADEIA_ORDEM:
        raise ValueError(
            f"Passo desconhecido na cadeia: {nome!r}. "
            f"Passos validos: {', '.join(CADEIA_ORDEM)}.")
    minimo, maximo = _PARAMS_POR_PASSO[nome]
    if not (minimo <= len(params) <= maximo):
        raise ValueError(
            f"Passo {nome} aceita de {minimo} a {maximo} parametro(s), "
            f"recebeu {len(params)}: {passo!r}.")
    for p in params:
        if nome == _PASSO_IA_RESERVADO and p.strip().lower() == _TOKEN_SEM_LIMITE_IA:
            continue  # "sem_limite" e literal na gramatica do worker, nao numero
        float(p)  # todo outro parametro desta etapa e numerico; ValueError propaga
    return nome, params


def normalizar_cadeia(opcoes: Optional[Dict[str, Any]]) -> List[str]:
    """Transforma a intencao do usuario na lista canonica ORDENADA de passos.

    Ex.: {"reparo_clipping": True, "loudnorm": True, "limitador": True} ->
        ["adeclip", "adeclick", "loudnorm:-16:-1.5", "alimiter:-1.5"]

    {"denoise_ia": True, "denoise_ia_db": 12} -> ["denoise_ia:12"] (sem
    denoise_ia_db sai o passo nu "denoise_ia": a atenuacao entao e decidida
    pelo worker, a partir da analise 'antes' ou do default de 12 dB). O passo
    nasce na posicao canonica (apos o denoise classico, antes do speechnorm/
    loudnorm) no formato que worker_audio.dividir_cadeia/parametros_ia ja
    sabem partir. ATENCAO AO CUSTO: o passo de IA roda no worker a ~0,7x
    tempo real (~50x mais lento que os filtros ffmpeg daqui).

    A ordem vem de CADEIA_ORDEM (secao 6 do plano) e a geracao nao depende da
    ordem das chaves do dict de entrada - duas chamadas com a mesma intencao
    devolvem exatamente a mesma lista, que e o que torna o hash um cache.
    """
    o = dict(opcoes or {})
    desconhecidas = sorted(set(o) - set(_CHAVES_OPCOES))
    if desconhecidas:
        raise ValueError(
            f"Opcoes desconhecidas: {', '.join(desconhecidas)}. "
            f"Opcoes validas: {', '.join(_CHAVES_OPCOES)}.")

    alvo = float(o.get("alvo_lufs", ALVO_LUFS_PADRAO))
    teto = float(o.get("teto_dbtp", TETO_DBTP_PADRAO))

    cadeia: List[str] = []
    if o.get("reparo_clipping"):
        # Secao 6: reparo de clipping vem antes de qualquer outra coisa.
        cadeia += ["adeclip", "adeclick"]
    if o.get("deesser"):
        cadeia.append("deesser")

    denoise = o.get("denoise_classico") or None
    if denoise is not None:
        denoise = str(denoise).strip().lower()
        if denoise == "anlmdn":
            cadeia.append("anlmdn")
        elif denoise == "afftdn":
            nr = o.get("denoise_nr_db")
            cadeia.append(_parte("afftdn", [_num(nr if nr is not None
                                            else _AFFTDN_NR_PADRAO_DB)]))
        else:
            raise ValueError(
                f"denoise_classico invalido: {denoise!r}. "
                "Use 'afftdn' ou 'anlmdn'.")

    if o.get("denoise_ia"):
        # ETAPA 4 chegou: intencao -> passo de IA na posicao canonica (apos o
        # denoise classico, antes do speechnorm/loudnorm). CARO: quem executa
        # e o worker de audio a ~0,7x tempo real - nunca este modulo.
        db = o.get("denoise_ia_db")
        if db is not None:
            try:
                db_num = float(db)
            except (TypeError, ValueError):
                raise ValueError(
                    f"denoise_ia_db invalido: {db!r} (use numero em dB, ex.: 12).")
            if db_num <= 0:
                raise ValueError(
                    f"denoise_ia_db invalido: {db_num:g} dB nao reduz ruido "
                    "algum (use valor positivo, ex.: 6 a 18).")
            cadeia.append(_parte(_PASSO_IA_RESERVADO, [_num(db_num)]))
        else:
            cadeia.append(_PASSO_IA_RESERVADO)

    if o.get("speechnorm"):
        cadeia.append("speechnorm")
    if o.get("loudnorm"):
        cadeia.append(_parte("loudnorm", [_num(alvo), _num(teto)]))
    if o.get("limitador"):
        cadeia.append(_parte("alimiter", [_num(teto)]))
    return cadeia


def hash_cadeia(video_id: int, in_s, out_s, cadeia: List[str]) -> str:
    """sha256 hexdigest de "render|<video_id>|<in>|<out>|<cadeia unida por |>".

    Mesma cadeia/intervalo -> mesmo hash, independentemente de in/out chegarem
    como int ou float (405 e 405.0 produzem o mesmo hash).
    """
    passos = [_parte(*_partir_passo(p)) for p in (cadeia or [])]
    carga = "render|{}|{}|{}|{}".format(
        int(video_id), _num(in_s), _num(out_s), "|".join(passos))
    return hashlib.sha256(carga.encode("utf-8")).hexdigest()


def montar_filtros(cadeia: List[str], medidas: Optional[Dict[str, float]] = None) -> str:
    """Monta a string do -af do ffmpeg a partir da lista canonica de passos.

    - Reordena para CADEIA_ORDEM mesmo se a lista vier fora de ordem (a ordem
      da secao 6 vale no grafro de filtros, nao so na lista).
    - loudnorm SEM medidas = primeira passagem (print_format=json, mede e nao
      escreve arquivo util); COM medidas = segunda passagem linear usando
      measured_I/measured_LRA/measured_TP/measured_thresh/offset.
    - Recusa passo repetido, desconhecido e o passo de IA ("denoise_ia"): ele
      nao e filtro do ffmpeg - quem o executa e o worker de audio.
    """
    nomes_params = [_partir_passo(p) for p in (cadeia or [])]
    nomes = [n for n, _ in nomes_params]
    if len(set(nomes)) != len(nomes):
        repetidos = sorted({n for n in nomes if nomes.count(n) > 1})
        raise ValueError(f"Passo repetido na cadeia: {', '.join(repetidos)}.")
    if _PASSO_IA_RESERVADO in nomes:
        raise ValueError(
            f"{_PASSO_IA_RESERVADO} nao e um filtro do ffmpeg: quem executa o "
            "passo de IA e o worker de audio (src/worker_audio.py), que parte a "
            "cadeia em dividir_cadeia e chama src/media/audio_denoise.denoisar. "
            "O ffmpeg deste modulo nunca roda IA (e ~50x mais lento que os "
            "filtros daqui).")
    nomes_params.sort(key=lambda np: CADEIA_ORDEM.index(np[0]))

    partes: List[str] = []
    for nome, params in nomes_params:
        if nome == "loudnorm":
            alvo = _num(params[0]) if len(params) > 0 else _num(ALVO_LUFS_PADRAO)
            teto = _num(params[1]) if len(params) > 1 else _num(TETO_DBTP_PADRAO)
            partes.append(_filtro_loudnorm(alvo, teto, medidas))
        elif nome == "alimiter":
            teto = float(params[0]) if params else TETO_DBTP_PADRAO
            partes.append(_filtro_alimiter(teto))
        elif nome == "afftdn":
            nr = _num(params[0]) if params else _num(_AFFTDN_NR_PADRAO_DB)
            partes.append(f"afftdn=nr={nr}")
        else:
            # adeclip, adeclick, deesser, anlmdn, speechnorm: defaults do ffmpeg.
            partes.append(nome)
    return ",".join(partes)


def _filtro_loudnorm(alvo: str, teto: str, medidas: Optional[Dict[str, float]]) -> str:
    """Primeira passagem (mede, print_format=json) ou segunda (linear, usa medidas)."""
    base = f"loudnorm=I={alvo}:LRA={_num(_LRA_ALVO)}:TP={teto}"
    if not medidas:
        return f"{base}:print_format=json"
    faltando = [c for c in ("measured_I", "measured_LRA", "measured_TP",
                            "measured_thresh", "target_offset")
                if c not in medidas]
    if faltando:
        raise ValueError(
            "Medidas da primeira passagem incompletas, faltou: "
            f"{', '.join(faltando)}.")
    return (base + ":linear=true"
            + f":measured_I={float(medidas['measured_I']):.2f}"
            + f":measured_LRA={float(medidas['measured_LRA']):.2f}"
            + f":measured_TP={float(medidas['measured_TP']):.2f}"
            + f":measured_thresh={float(medidas['measured_thresh']):.2f}"
            + f":offset={float(medidas['target_offset']):.2f}")


def _filtro_alimiter(teto_dbtp: float) -> str:
    """alimiter com limite em amplitude linear e auto-level DESATIVADO.

    O "level" padrao do alimiter reergue o sinal ate o limite, o que
    desfaria a folga de pico que a entrega quer; desativado ele so segura
    picos acima do teto.
    """
    limite_linear = 10.0 ** (float(teto_dbtp) / 20.0)
    return f"alimiter=limit={limite_linear:.6f}:level=disabled"


# ---------------------------------------------------------------------------
# Renderizacao de verdade
# ---------------------------------------------------------------------------

_CHAVES_MEDIDAS = ("measured_I", "measured_LRA", "measured_TP",
                   "measured_thresh", "target_offset")

# Prefixo de log do ffmpeg, ex.: "[Parsed_loudnorm_0 @ 00000281c7e3c2c0] "
_RE_PREFIXO_FFMPEG = re.compile(r"\[[^\]]*\]\s?")


def renderizar(src, dest, in_s, out_s, cadeia: List[str],
               progresso: Optional[Callable[[float], None]] = None) -> Dict[str, Any]:
    """Roda o ffmpeg sobre o intervalo e grava WAV 48 kHz 24 bits em dest.

    Quando a cadeia tem loudnorm roda as DUAS passagens: a primeira mede com
    print_format=json e a segunda aplica os valores medidos (uma passagem so
    errou 0,7 LU na medicao real do plano).

    Guarda de seguranca (secao 2 do plano): nunca escreve dentro de F:/ e
    nunca sobrescreve o arquivo de origem; a checagem roda ANTES de qualquer
    ffmpeg. Grava em "<dest>.parcial.wav" e renomeia no fim, para nenhum
    player ler um WAV pela metade.

    Guarda da IA: uma cadeia que contenha "denoise_ia" e RECUSADA com mensagem
    clara antes de qualquer ffmpeg. Este modulo so sabe filtros do ffmpeg;
    quem parte a cadeia e executa o passo de IA (a ~0,7x tempo real, ~50x mais
    lento que os filtros) e o worker de audio (src/worker_audio.py). Recusar -
    e nao pular o passo em silencio - evita devolver audio SEM o tratamento de
    IA como se tivesse sido tratado.

    progresso: callable opcional que recebe percentual 0..100; None ignora.

    Devolve {"ok", "erro", "path", "duracao_render_s", "medidas_loudnorm"}.
    """
    inicio = time.perf_counter()
    resultado: Dict[str, Any] = {"ok": False, "erro": None, "path": None,
                                 "duracao_render_s": 0.0,
                                 "medidas_loudnorm": None}

    def _fim(erro: Optional[str]) -> Dict[str, Any]:
        resultado["erro"] = erro
        resultado["duracao_render_s"] = round(time.perf_counter() - inicio, 3)
        return resultado

    passos: List[str] = []
    try:
        passos = [_parte(*_partir_passo(p)) for p in (cadeia or [])]
    except ValueError as e:
        return _fim(str(e))
    if not passos:
        return _fim("Cadeia vazia: nada para renderizar.")
    passo_ia = next((p for p in passos
                     if p.split(":")[0] == _PASSO_IA_RESERVADO), None)
    if passo_ia is not None:
        # Antes de qualquer ffmpeg e de qualquer checagem de arquivo: falhar
        # aqui e o contrato - pular a IA em silencio devolveria audio sem
        # tratar dizendo que tratou.
        return _fim(
            f"A cadeia contem {passo_ia!r}: o renderizar NAO executa IA. O "
            "denoise por IA roda no worker de audio (src/worker_audio.py), que "
            "parte a cadeia em dividir_cadeia e chama audio_denoise.denoisar "
            "(~0,7x tempo real, cerca de 50x mais lento que os filtros ffmpeg "
            "daqui). Enfileire o item para o worker em vez de chamar "
            "renderizar direto.")
    tem_loudnorm = any(p.split(":")[0] == "loudnorm" for p in passos)
    try:
        filtros_passe1 = montar_filtros(passos)
    except ValueError as e:
        return _fim(str(e))

    origem = Path(src)
    if not origem.exists():
        return _fim(f"Arquivo de origem nao encontrado: {origem}")

    if in_s is None or out_s is None:
        return _fim("Intervalo incompleto: in_s e out_s sao obrigatorios.")
    inicio_s, fim_s = float(in_s), float(out_s)
    duracao = fim_s - inicio_s
    if inicio_s < 0 or duracao <= 0:
        return _fim(f"Intervalo invalido: out ({fim_s}) precisa ser maior "
                    f"que in ({inicio_s}) e in >= 0.")

    erro_guarda = _validar_destino(dest, origem)
    if erro_guarda:
        return _fim(erro_guarda)
    destino = Path(dest).resolve()
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_name(destino.stem + ".parcial.wav")

    total_passagens = 2 if tem_loudnorm else 1
    base_cmd = ["ffmpeg", "-y", "-v", "info", "-nostats",
                "-ss", str(inicio_s), "-t", str(duracao),
                "-i", str(origem), "-map", "0:a:0", "-vn"]

    medidas: Optional[Dict[str, float]] = None
    if tem_loudnorm:
        # Primeira passagem: mede (nao grava arquivo; -f null).
        rc, stderr_texto, cronometrado = _rodar_ffmpeg(
            base_cmd + ["-af", filtros_passe1, "-f", "null", "-"],
            duracao, progresso, 0.0, 1.0 / total_passagens)
        if rc != 0:
            motivo = _ultima_linha_util(stderr_texto) or f"codigo {rc}"
            extra = " (tempo limite excedido)" if cronometrado else ""
            return _fim(f"FFmpeg falhou na 1a passagem do loudnorm{extra}: {motivo}")
        medidas = _extrair_medidas_loudnorm(stderr_texto)
        if medidas is None:
            return _fim("A 1a passagem do loudnorm nao produziu medicoes "
                        "validas (print_format=json ausente no stderr).")
        resultado["medidas_loudnorm"] = dict(medidas)

    filtros_finais = montar_filtros(passos, medidas)
    saida_args = ["-ar", str(_SAIDA_SAMPLE_RATE), "-c:a", "pcm_s24le", str(parcial)]
    rc, stderr_texto, cronometrado = _rodar_ffmpeg(
        base_cmd + ["-af", filtros_finais] + saida_args,
        duracao, progresso,
        (total_passagens - 1) / total_passagens, 1.0)
    if rc != 0:
        motivo = _ultima_linha_util(stderr_texto) or f"codigo {rc}"
        extra = " (tempo limite excedido)" if cronometrado else ""
        _apagar_quiet(parcial)
        return _fim(f"FFmpeg falhou ao gravar o WAV tratado{extra}: {motivo}")
    if not parcial.exists() or parcial.stat().st_size == 0:
        _apagar_quiet(parcial)
        return _fim("FFmpeg terminou sem gravar o WAV tratado.")
    os.replace(parcial, destino)

    resultado["ok"] = True
    resultado["path"] = str(destino)
    return _fim(None)


def _validar_destino(dest, origem: Path) -> Optional[str]:
    """Guarda de seguranca: None se o destino pode ser escrito; senao o motivo.

    Regras do plano/briefing: NUNCA escrever dentro de F:/ (HD do acervo bruto,
    somente leitura) e NUNCA sobrescrever o arquivo de origem.
    """
    d = Path(dest).resolve()
    letra = d.drive.rstrip(":").upper()
    if letra == "F":
        return (f"Destino proibido: {d} esta dentro de F:/ "
                "(acervo bruto e somente leitura).")
    s = Path(origem).resolve()
    if d == s:
        return (f"Destino igual a origem ({d}): o original nunca e "
                "sobrescrito, o clipe passa a apontar para um novo WAV.")
    if d.exists():
        if d.is_dir():
            return f"Destino e um diretorio: {d}"
        try:
            if os.path.samefile(d, s):
                return (f"Destino e o mesmo arquivo da origem ({d}): "
                        "o original nunca e sobrescrito.")
        except OSError:
            pass
    return None


def _rodar_ffmpeg(cmd: List[str], duracao: float,
                  progresso: Optional[Callable[[float], None]],
                  frac_inicio: float, frac_fim: float) -> Tuple[int, str, bool]:
    """Roda um passe do ffmpeg reportando progresso na fatia [frac_inicio, frac_fim].

    Devolve (returncode, stderr_completo, estourou_tempo). O stderr e drenado
    por uma thread auxiliar (o loudnorm imprime o JSON dele por ali) enquanto
    o stdout alimenta o progresso via -progress pipe:1, no padrao de
    generate_video_proxy de src/media/ffmpeg.py.
    """
    if "-progress" not in cmd:
        cmd += ["-progress", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, startupinfo=_startupinfo())

    stderr_trove: List[str] = []
    cronometrado = [False]

    def _drenar_stderr():
        try:
            for linha in proc.stderr:
                stderr_trove.append(linha)
        except (ValueError, OSError):
            pass  # pipe fechado no kill; o retorno usa o que deu pra coletar

    dreno = threading.Thread(target=_drenar_stderr, daemon=True)
    dreno.start()

    def _avisar(frac):
        if progresso is not None:
            progresso(round(min(max(frac, 0.0), 1.0) * 100.0, 1))

    _avisar(frac_inicio)
    timer = threading.Timer(_TIMEOUT_FFMPEG_RENDER_S,
                            lambda: (cronometrado.__setitem__(0, True),
                                     proc.kill()))
    timer.daemon = True
    timer.start()
    try:
        for linha in proc.stdout:
            texto = linha.strip()
            if texto.startswith("out_time_us=") and duracao > 0:
                try:
                    atual = int(texto.split("=", 1)[1]) / 1_000_000.0
                    _avisar(frac_inicio +
                            (frac_fim - frac_inicio) * min(atual / duracao, 1.0))
                except ValueError:
                    continue
            elif texto.startswith("progress=") and texto.endswith("end"):
                _avisar(frac_fim)
        codigo = proc.wait()
    finally:
        timer.cancel()
        dreno.join(timeout=5.0)
    return codigo, "".join(stderr_trove), cronometrado[0]


def _extrair_medidas_loudnorm(stderr_texto: str) -> Optional[Dict[str, float]]:
    """Extrai o bloco JSON do print_format=json da 1a passagem do loudnorm.

    O ffmpeg imprime o JSON no stderr com prefixo "[Parsed_loudnorm_N @ ...] ",
    mas pela pipe o prefixo chega de tres jeitos diferentes conforme o caso:
    colado em cada linha, em linha propria antes do corpo, ou misturado dentro
    do bloco. Entao a captura comeca na linha que contem o gancho
    "Parsed_loudnorm", remove os prefixos "[...]" de cada linha e junta da
    primeira "{" ate a "}" que fecha (o JSON do loudnorm nao tem chaves aninhadas). Devolve o dict com as
    chaves da 2a passagem (measured_I, measured_LRA, measured_TP,
    measured_thresh, target_offset) ou None se nao achou nada utilizavel.
    """
    texto = stderr_texto or ""
    linhas_json: List[str] = []
    gancho_visto = False
    for bruta in texto.splitlines():
        if not gancho_visto:
            if "Parsed_loudnorm" not in bruta:
                continue
            gancho_visto = True  # linha do gancho: comeca a capturar nela mesma
        limpa = _RE_PREFIXO_FFMPEG.sub("", bruta).strip()
        if not limpa:
            continue  # linha so de prefixo (corpo separado)
        if not linhas_json and not limpa.startswith("{"):
            continue  # lixo entre o gancho e o inicio do JSON
        linhas_json.append(limpa)
        if limpa.endswith("}"):
            break
    if not linhas_json:
        return None
    try:
        dados = json.loads("\n".join(linhas_json))
    except json.JSONDecodeError:
        return None
    medidas: Dict[str, float] = {}
    mapa = {"input_i": "measured_I", "input_lra": "measured_LRA",
            "input_tp": "measured_TP", "input_thresh": "measured_thresh",
            "target_offset": "target_offset"}
    for chave_bruta, chave in mapa.items():
        valor = _para_float(dados.get(chave_bruta))
        if valor is None:
            return None
        medidas[chave] = valor
    return medidas


def _para_float(token):
    """'-inf' vira float('-inf'); lixo vira None (mesmo criterio da etapa 1)."""
    texto = str(token).strip().lower()
    if texto in ("-inf", "-infinity"):
        return float("-inf")
    try:
        valor = float(texto)
    except ValueError:
        return None
    return None if valor != valor else valor


def _ultima_linha_util(stderr_texto):
    linhas = [l.strip() for l in (stderr_texto or "").splitlines() if l.strip()]
    return linhas[-1] if linhas else None


def _apagar_quiet(caminho: Path):
    try:
        if caminho.exists():
            caminho.unlink()
    except OSError as e:
        print(f"[AudioChain] Nao consegui apagar arquivo parcial "
              f"{caminho.name}: {e}")
