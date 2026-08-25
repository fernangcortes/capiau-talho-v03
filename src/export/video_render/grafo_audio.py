"""Grafo de AUDIO do render: cadeia por clipe + mixagem por pista (pacote B).

CONTRATO E2 (player.js:2623, `_topologiaAudioAoVivo`) - ordem FECHADA:

    fonte -> volume -> hpf -> low -> mid -> high -> gate -> comp -> makeup -> destino

e blocos desligados simplesmente SAEM da lista (nao viram filtro identidade):

    hpf          so com audio_eq ativo E hpf > 0        (hpf 0 = desligado na tela)
    low/mid/high so com audio_eq ativo                  (ganho 0 = neutro: sai tambem,
                                                         ver _filtros_eq)
    gate         so com audio_dynamics ativo E gate_db > -90   (-90 = desligado)
    comp         so com audio_dynamics ativo E comp_ratio > 1  (ratio 1 = transparente)
    makeup       ganho 0 dB e identidade: filtro omitido

AS TRES REGRAS QUE ESTE MODULO EXISTE PARA NAO ERRAR
----------------------------------------------------
1. P3 - audio NAO sai de pista de video. Os <video> do player levam
   `el.muted = true` (player.js:1925 e 2051); TODO o som vem das pistas
   kind:"audio" (syncAudioTracks, player.js:2285), tocadas pelo clipe parceiro
   (`link_id`) que aponta para a MESMA midia. Iterar tambem sobre as pistas de
   video dobraria o audio inteiro. Aqui a unica fonte de clipes e
   `Sequencia.pistas_audio()`.

2. O fade vem ANTES da cadeia de EQ/dinamica, nao depois. Na tela o ganho da
   entrada do grafo e `el.volume = clamp(pista.volume x volume.do.clipe x fator
   de fade, 0, 1)` (player.js:2397) e atua ANTES do grafo WebAudio (comentario
   em player.js:2406: "el.volume atua ANTES do grafo e nao e duplicado"). O
   fade ENTRA no gate e no compressor; po-lo no fim muda como a dinamica reage.

3. O WAV tratado (`audio_render` status ready) comeca em ZERO e contem SOMENTE
   o trecho [in,out] da fonte. Trocar a referencia sem zerar os dois ranges toca
   o trecho errado (o player faz `baseFonte = tratado ? 0 : cut.in` em
   player.js:2345). Aqui a troca acontece ao montar as ENTRADAS (ss/t devolvidos
   em "entradas"); a string do filtro e identica nos dois casos. E quando um
   recorte da regra P4 perdeu o comeco, o offset dentro do WAV avanca o mesmo
   tanto que o player avancaria na tela (ver `_recortes_da_pista`).

PUREZA
------
Nenhuma funcao abre arquivo, chama subprocesso ou consulta banco. Os unicos
caminhos que aparecem aqui chegam PRONTOS por callback, injetados pelo pacote C:

    resolver_midia(clipe)   -> str|None   caminho da midia ORIGINAL do clipe
                                           (midia.py resolve original/proxy)
    resolver_tratado(clipe) -> Path|None  caminho do WAV tratado, JA validado no
                                           disco (mesma semantica de
                                           `_bloco_audio_tratado` em
                                           src/export/otio_export.py: bloco
                                           ready + arquivo existente; caso
                                           contrario None e o render segue no
                                           ORIGINAL - apontar para arquivo
                                           sumido e pior que nao tratar)

Nos testes passamos lambda; nada toca no sistema de arquivos por conta propia.

DIVERGENCIAS DE PARIDADE CONHECIDAS (medidas; ver scratch/render_agentes/audio_b/)
-----------------------------------------------------------------------------------
- Joelho do compressor: o DynamicsCompressorNode usa joelho de 30 dB; o
  acompressor do ffmpeg aceita no maximo 8. Implementa-se knee=8 e a diferenca
  fica VISIVEL no banner de fidelidade (medicao 5 do relatorio).
- Detector do gate: o worklet decide pelo pico de cada BLOCO de 128 amostras;
  o agate decide por amostra. Medicao 4 do relatorio quantifica.
"""
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import fade
from . import modelo

# ---------------------------------------------------------------------------
# Limites copiados DE _efeitosAudioAoVivo (player.js:2537-2555). Mudar qualquer
# um deles cria divergencia silenciosa com a tela.
# ---------------------------------------------------------------------------
HPF_MAX_HZ = 20000.0
EQ_GAIN_MIN_DB = -12.0
EQ_GAIN_MAX_DB = 12.0
GATE_DB_MIN = -90.0          # clamp inferior...
GATE_DB_DESLIGADO = -90.0    # ...e o valor que desliga o bloco na topologia
COMP_RATIO_MIN = 1.0         # ratio 1 = compressor transparente (sai da cadeia)
COMP_RATIO_MAX = 20.0
COMP_THRESH_MIN_DB = -60.0
COMP_THRESH_MAX_DB = 0.0
MAKEUP_MIN_DB = -12.0
MAKEUP_MAX_DB = 12.0

# Defaults quando o campo falta (mesmos do player.js:2551-2554).
DEFAULT_GATE_DB = -45.0
DEFAULT_COMP_RATIO = 2.0
DEFAULT_COMP_THRESH_DB = -18.0
DEFAULT_MAKEUP_DB = 0.0

# Formato de saida do motor (secao 4 da tarefa): 48 kHz estereo fltp.
SAMPLE_RATE_SAIDA = 48000

# Guarda de estouro do mix final: somar pistas pode passar de 0 dBFS e clipping
# digital e IRREVERSIVEL. alimiter no fim, em -0.2 dBTP (limit linear 0.977).
# Se a soma nao passa de 0, ele e transparente (medido). level=disabled porque
# o "auto level" padrao REERGUE o sinal ate o limite - desfaria a paridade de
# volume de tudo que esta abaixo do teto; latency=1 compensa o lookahead interno
# para nao atrasar o audio contra o video.
TETO_MIX_DBTP = -0.2
LIMITE_MIX_LINEAR = 0.977

# Tolerancia temporal (evita adelay/apad disparados por erro de 1e-13).
_EPS_TEMPO = 1e-9


# ---------------------------------------------------------------------------
# Formatadores (numeros para dentro de opcao/expression do ffmpeg)
# ---------------------------------------------------------------------------

def _num(valor: float) -> str:
    """Numero para dentro de expressao ffmpeg: ponto decimal, sem notacao cientifica.

    Mesmo criterio do fade._n (contrato): notacao 1e-05 quebra o parser de
    expressoes do ffmpeg em varias versoes. Duplicado aqui de proposito: `_n`
    e privado do contrato congelado e este modulo nao deve espiar privados dele.
    """
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    return texto if texto not in ("", "-") else "0"


def _linear_de_db(db: float) -> str:
    """dBFS -> amplitude linear como OPCAO de filtro (strtod aceita exponencial).

    O threshold de agate/acompressor e LINEAR no ffmpeg (10^(dB/20)); o worklet
    e o DynamicsCompressor recebem dB. Formato round-trip (repr): arredondar
    aqui seria trocar silenciosamente o limiar escolhido pelo usuario.
    """
    valor = 10.0 ** (float(db) / 20.0)
    return repr(valor)


def _clamp(valor: float, minimo: float, maximo: float) -> float:
    return max(minimo, min(maximo, valor))


def _numero(valor, padrao: float) -> float:
    """Espelho do `num(v, def)` do player (player.js:2537): numero finito ou default."""
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return float(padrao)
    if v != v or v in (float("inf"), float("-inf")):  # NaN / infinito
        return float(padrao)
    return v


def _rotulo_seguro(texto: str) -> str:
    """Texto vira rotulo ffmpeg seguro (so [a-zA-Z0-9_])."""
    limpo = "".join(ch if ch.isalnum() else "_" for ch in str(texto))[:40]
    return limpo or "p"


# ---------------------------------------------------------------------------
# Blocos de efeito: ativo = existe, sem disabled (P5) e categoria ligada no escopo
# ---------------------------------------------------------------------------

def _bloco_ativo(clipe: modelo.Clipe, tipo_efeito: str,
                 escopo: modelo.Escopo) -> Optional[Dict[str, Any]]:
    """Primeiro bloco ATIVO do tipo pedido, ou None.

    Os dois desligadores caem no mesmo ponto, como na tela: `disabled: true` e
    decisao do clipe (regra P5); categoria desmarcada no escopo e escolha do
    editor. Qualquer dos dois = bloco fora da cadeia SEM aviso.
    """
    if not escopo.efeito_ligado(tipo_efeito):
        return None
    return clipe.efeito(tipo_efeito)


def _parametros_fx(clipe: modelo.Clipe, escopo: modelo.Escopo) -> Dict[str, Any]:
    """Porte de _efeitosAudioAoVivo (player.js:2537-2555) + escopo.

    Devolve os parametros JA normalizados/clampados, com os mesmos defaults do
    player quando o campo falta. eq_on/dyn_on falsos deixam os valores no estado
    "desligado" da topologia (hpf 0, gate_db -90, ratio 1, makeup 0), que e o
    que faz os blocos sairem da cadeia.
    """
    eq = _bloco_ativo(clipe, "audio_eq", escopo)
    dyn = _bloco_ativo(clipe, "audio_dynamics", escopo)
    eq_on = eq is not None
    dyn_on = dyn is not None
    return {
        "eq_on": eq_on,
        "dyn_on": dyn_on,
        "hpf_hz": _clamp(_numero(eq.get("hpf"), 0.0), 0.0, HPF_MAX_HZ) if eq_on else 0.0,
        "low_db": _clamp(_numero(eq.get("low"), 0.0), EQ_GAIN_MIN_DB, EQ_GAIN_MAX_DB) if eq_on else 0.0,
        "mid_db": _clamp(_numero(eq.get("mid"), 0.0), EQ_GAIN_MIN_DB, EQ_GAIN_MAX_DB) if eq_on else 0.0,
        "high_db": _clamp(_numero(eq.get("high"), 0.0), EQ_GAIN_MIN_DB, EQ_GAIN_MAX_DB) if eq_on else 0.0,
        "gate_db": _clamp(_numero(dyn.get("gate_db"), DEFAULT_GATE_DB), GATE_DB_MIN, 0.0) if dyn_on else GATE_DB_DESLIGADO,
        "comp_ratio": _clamp(_numero(dyn.get("comp_ratio"), DEFAULT_COMP_RATIO), COMP_RATIO_MIN, COMP_RATIO_MAX) if dyn_on else 1.0,
        "comp_thresh_db": _clamp(_numero(dyn.get("comp_thresh_db"), DEFAULT_COMP_THRESH_DB), COMP_THRESH_MIN_DB, COMP_THRESH_MAX_DB) if dyn_on else 0.0,
        "makeup_db": _clamp(_numero(dyn.get("makeup_db"), DEFAULT_MAKEUP_DB), MAKEUP_MIN_DB, MAKEUP_MAX_DB) if dyn_on else 0.0,
    }


# ---------------------------------------------------------------------------
# Volume + fades (o estagio que vem ANTES do EQ/dinamica - armadilha 2)
# ---------------------------------------------------------------------------

def _fades_ativos(clipe: modelo.Clipe) -> List[Dict[str, Any]]:
    """Crossfades validos do clipe: sem disabled e com side conhecido."""
    resultado: List[Dict[str, Any]] = []
    for efeito in clipe.effects:
        if not isinstance(efeito, dict) or efeito.get("type") != "crossfade":
            continue
        if efeito.get("disabled"):
            continue
        lado = str(efeito.get("side") or "").lower()
        if lado not in ("in", "out"):
            continue
        resultado.append(efeito)
    return resultado


def _expressao_progresso_local(lado: str, d_norm: float, offset_ini_s: float,
                               offset_fim_s: float) -> str:
    """Progresso p em [0,1] em funcao de t (segundos no stream JA cortado).

    O fade ancora no CLIPE na timeline, nao no recorte da janela de render:
    num render por segmentos que entra no meio de um fade, a expressao precisa
    CONTINUAR a curva, nao recomecala - por isso o offset pode ser negativo e
    entra com parenteses proprias: `(t-(-0.3))` e valido para o parser.
    """
    if lado == "out":
        bruto = f"(({_num(offset_fim_s)}-t)/{_num(d_norm)})"
    else:
        bruto = f"((t-({_num(offset_ini_s)}))/{_num(d_norm)})"
    return f"clip({bruto},0,1)"


def _expressao_fade_combinada(fades: List[Dict[str, Any]], offset_ini_s: float,
                              offset_fim_s: float) -> str:
    """Fator combinado dos crossfades como expressao ffmpeg.

    O player pega o MENOR fator entre os fades ativos no instante
    (`fadeVol = Math.min(...)`, player.js:2387/2392), NAO o produto -
    fade.fator_combinado() e o gabarito numerico disso. Com dois lados ativos
    no MESMO instante (clipe curto com in+out sobrepostos) min e produto
    divergem de verdade, entao compomos com min(), que o avaliador do ffmpeg
    tem. Cada curva individual vem de fade.expressao() (contrato congelado).
    """
    exprs: List[str] = []
    for efeito in fades:
        d = fade.normalizar_duracao(efeito.get("duration_s"))
        lado = str(efeito.get("side") or "").lower()
        p_expr = _expressao_progresso_local(lado, d, offset_ini_s, offset_fim_s)
        exprs.append(fade.expressao(str(efeito.get("curve") or "linear"),
                                    efeito.get("tension"), p_expr))
    if len(exprs) == 1:
        return exprs[0]
    return "min(" + ",".join(exprs) + ")"


def _atalhos_afade(fades: List[Dict[str, Any]], produto: float,
                   offset_ini_s: float, offset_fim_s: float) -> Optional[List[str]]:
    """Quando TODOS os fades sao reta pura, devolve [volume?, afade...]; senao None.

    afade=curve=tri e matematicamente identico a curva linear sem tensao
    (fade.usa_atalho_linear diz isso) e muito mais barato que eval=frame.
    Condicoes, todas obrigatorias:

    - produto <= 1: com afade o clamp de el.volume cai sobre o ganho fixo ANTES
      do fade; na tela ele cai sobre o produto COM fade. Com produto <= 1 e
      fator em [0,1] o clamp nunca age nos dois casos; acima de 1 diverge, e o
      caminho certo e a expressao com clip() envolvendo tudo (_estagio_volume).
    - janelas validas: st >= 0 (afade nao aceita inicio negativo; fade que ja
      estava no meio quando a janela de render abriu precisa de expressao).
    - sem sobreposicao in/out: afades encadeados se MULTIPLICAM e a tela faz
      min; janelas disjuntas <=> um dos fatores vale exatamente 1 em cada
      instante <=> produto == min.
    """
    if not fades or produto > 1.0:
        return None
    fim_janela_in: Optional[float] = None
    inicio_janela_out: Optional[float] = None
    filtros: List[str] = []
    for efeito in fades:
        if not fade.usa_atalho_linear(str(efeito.get("curve") or "linear"),
                                      efeito.get("tension")):
            return None
        d = fade.normalizar_duracao(efeito.get("duration_s"))
        lado = str(efeito.get("side") or "").lower()
        if lado == "in":
            if offset_ini_s < 0.0:
                return None
            fim_janela_in = offset_ini_s + d
            filtros.append(f"afade=t=in:st={_num(offset_ini_s)}:d={_num(d)}:curve=tri")
        else:
            st = offset_fim_s - d
            if st < 0.0:
                return None
            inicio_janela_out = st
            filtros.append(f"afade=t=out:st={_num(st)}:d={_num(d)}:curve=tri")
    if (fim_janela_in is not None and inicio_janela_out is not None
            and inicio_janela_out < fim_janela_in - _EPS_TEMPO):
        return None  # in e out se sobrepoe: min != produto, vai de expressao
    return filtros


def _estagio_volume(clipe: modelo.Clipe, pista: modelo.Pista, escopo: modelo.Escopo,
                    offset_ini_s: float, offset_fim_s: float) -> List[str]:
    """O ganho de ENTRADA do grafo: pista x clipe x fade, com o clamp da tela.

    A tela calcula `el.volume = Math.max(0, Math.min(1.0, vol*clipVol*fadeVol))`
    (player.js:2397): o clamp em [0,1] cai sobre o PRODUTO, inclusive o fade.
    Casos, do barato para o caro:

    - sem volume e sem fade: nenhum filtro (transparencia bit-a-bit);
    - sem fade: constante ja clampada;
    - fades lineares simples: volume fixo + afade(s) (_atalhos_afade);
    - caso geral: UMA expressao `clip(produto*fator,0,1)` avaliada por frame -
      reproduz o clamp da tela exatamente, inclusive com produto > 1.
    """
    bloco_volume = _bloco_ativo(clipe, "volume", escopo)
    vol_val = bloco_volume.get("level") if (bloco_volume is not None and bloco_volume.get("level") is not None) else (bloco_volume.get("gain") if bloco_volume is not None else None)
    vol_clipe = _numero(vol_val, 1.0) if bloco_volume is not None else 1.0
    vol_pista = _numero(pista.volume, 1.0)
    produto = vol_pista * vol_clipe

    fades = _fades_ativos(clipe)
    if not fades:
        if produto == 1.0:
            return []
        # O player clampa el.volume em [0,1]: pista 2.0 com clipe 1.0 toca a 1.0
        # NA TELA, e o arquivo tem de bater com a tela, nao com a intencao.
        return [f"volume={_num(_clamp(produto, 0.0, 1.0))}"]

    atalho = _atalhos_afade(fades, produto, offset_ini_s, offset_fim_s)
    if atalho is not None:
        prefixo: List[str] = []
        if produto != 1.0:
            prefixo.append(f"volume={_num(_clamp(produto, 0.0, 1.0))}")
        return prefixo + atalho

    expr = _expressao_fade_combinada(fades, offset_ini_s, offset_fim_s)
    return [f"volume=volume='clip(({_num(produto)})*({expr}),0,1)':eval=frame"]


# ---------------------------------------------------------------------------
# EQ e dinamica (traducao WebAudio -> ffmpeg, tabela 3.6 do plano)
# ---------------------------------------------------------------------------

def _filtros_eq(params: Dict[str, Any]) -> List[str]:
    """hpf/low/mid/high na ordem da topologia.

    Ganho 0 sai da cadeia: shelf/pico com ganho 0 tem resposta plana
    (identidade matematica) e sair encurta o grafo sem mudar audio. O hpf 0 ja
    e "desligado" por regra da propria topologia (player.js:2625).

    Width dos shelves: WebAudio lowshelf/highshelf ignora Q e usa S=1, que
    corresponde a Q = 1/sqrt(2) ~ 0.7071 (tabela 3.6). Mid peaking Q=1.0.
    """
    if not params["eq_on"]:
        return []
    filtros: List[str] = []
    if params["hpf_hz"] > 0:
        filtros.append(f"highpass=f={_num(params['hpf_hz'])}:width_type=q:width=1")
    if params["low_db"] != 0.0:
        filtros.append(f"bass=g={_num(params['low_db'])}:f=250:width_type=q:width=0.7071")
    if params["mid_db"] != 0.0:
        filtros.append(f"equalizer=f=1000:width_type=q:width=1:g={_num(params['mid_db'])}")
    if params["high_db"] != 0.0:
        filtros.append(f"treble=g={_num(params['high_db'])}:f=3000:width_type=q:width=0.7071")
    return filtros


def _filtros_dinamica(params: Dict[str, Any]) -> List[str]:
    """gate (worklet proprio da casa) -> comp -> makeup, nessa ordem.

    gate: o worklet (src/ui/js/audioGateWorklet.js) tem alvo BINARIO (1 acima
    do limiar, 0 abaixo), detector de PICO absoluto e suavizacao one-pole de
    5 ms/80 ms. No agate: detection=peak, range=0 (range e o GANHO RESIDUAL
    minimo do gate fechado: zero = pode fechar de vez), ratio alto aproximando
    o alvo binario, knee no minimo permitido (1). threshold em LINEAR;
    attack/release em MILISSEGUNDOS (5/80 = 0.005 s / 0.080 s do worklet).

    comp: DynamicsCompressorNode com joelho padrao de 30 dB; o acompressor
    aceita no maximo 8 - implementa-se knee=8 e a diferenca MEDIDA (medicao 5)
    vai para o banner de fidelidade. attack/release sao os defaults WebAudio
    que o player nao muda (0.003 s / 0.25 s -> 3 ms / 250 ms).

    makeup: GainNode linear -> volume=<dB>dB; 0 dB sai da cadeia (identidade).
    """
    filtros: List[str] = []
    if params["gate_db"] > GATE_DB_DESLIGADO:
        filtros.append(
            f"agate=threshold={_linear_de_db(params['gate_db'])}"
            ":ratio=9000:attack=5:release=80:knee=1:detection=peak:range=0"
        )
    if params["comp_ratio"] > 1.0:
        filtros.append(
            f"acompressor=threshold={_linear_de_db(params['comp_thresh_db'])}"
            f":ratio={_num(params['comp_ratio'])}:attack=3:release=250:knee=8"
        )
    if params["makeup_db"] != 0.0:
        filtros.append(f"volume={_num(params['makeup_db'])}dB")
    return filtros


# ---------------------------------------------------------------------------
# Cadeia por clipe
# ---------------------------------------------------------------------------

def cadeia_clipe_audio(clipe: modelo.Clipe, pista: modelo.Pista, seq: modelo.Sequencia,
                       escopo: modelo.Escopo, rotulo_entrada: str, rotulo_saida: str,
                       inicio_render_s: float = 0.0, *,
                       fim_render_s: Optional[float] = None) -> str:
    """Ramo completo de UM clipe (ja resolvido pela regra P4) em uma string.

        [entrada]atrim -> asetpts -> volume/fade -> eq -> dinamica
                  -> adelay -> apad? -> [saida]

    - atrim trabalha em tempo RELATIVO a entrada: o contrato com o pacote C e
      que cada entrada seja aberta com `-ss <ss> -t <t>` (como anunciamos em
      entradas[]), o que rebasa os carimbos em zero. O atrim existe para aparar
      a folga de container do -t e garantir comprimento deterministico.
    - adelay posiciona o ramo na timeline (ms inteiros; all=1 aplica a TODOS os
      canais sem depender do layout da fonte); 0 ms = filtro omitido.
    - apad=whole_dur iguala o comprimento de todos os ramos ao da janela (amix
      soma por PTS e o duration=longest cobre o maior; apadar todo ramo que
      acaba antes evita surpresa com inputs vazios). Omitido quando o ramo ja
      termina exatamente na borda: assim um clipe unico sem efeitos atravessa o
      grafo sem NENHUM filtro que toque nas amostras - e a transparencia
      bit-a-bit da medicao 1 fica alcancavel.
    - Clipe totalmente fora da janela levanta ValueError; quem monta a camada
      pula esses antes (render por segmentos faz isso o tempo inteiro).
    - A STRING e identica para fonte original e WAV tratado: a troca acontece
      nas ENTRADAS (ss/t), nunca aqui (armadilha 3).
    """
    ini_render = float(inicio_render_s)
    fim_render = float(fim_render_s) if fim_render_s is not None else clipe.fim_s
    head = max(0.0, ini_render - clipe.inicio_s)
    tail = max(0.0, clipe.fim_s - fim_render)
    duracao = clipe.duracao_s - head - tail
    if duracao <= _EPS_TEMPO:
        raise ValueError(
            f"clipe {clipe.id!r} fora da janela de render "
            f"[{ini_render}, {fim_render}] (duracao efetiva {duracao}).")

    params = _parametros_fx(clipe, escopo)
    partes: List[str] = [
        f"{rotulo_entrada}atrim=start=0:end={_num(duracao)}",
        "asetpts=PTS-STARTPTS",
    ]
    partes += _estagio_volume(clipe, pista, escopo,
                              clipe.inicio_s - ini_render,
                              clipe.fim_s - ini_render)
    partes += _filtros_eq(params)
    partes += _filtros_dinamica(params)

    delay_ms = int(round(max(0.0, clipe.inicio_s + head - ini_render) * 1000.0))
    if delay_ms > 0:
        partes.append(f"adelay=delays={delay_ms}:all=1")
    fim_ramo_s = delay_ms / 1000.0 + duracao
    duracao_janela = fim_render - ini_render
    if fim_ramo_s < duracao_janela - _EPS_TEMPO:
        partes.append(f"apad=whole_dur={_num(duracao_janela)}")
    # O rotulo de saida COLA no ultimo filtro, sem virgula. Juntar com virgula
    # cria um filtro vazio antes do rotulo e o ffmpeg recusa o grafo inteiro com
    # "No such filter: ''" -- medido em 24/08/2026.
    return ",".join(partes) + rotulo_saida


# ---------------------------------------------------------------------------
# Recortes por pista (P4) e pareamento com o clipe original
# ---------------------------------------------------------------------------

def _recortes_da_pista(seq: modelo.Sequencia,
                       pista: modelo.Pista) -> List[Tuple[modelo.Clipe, modelo.Clipe]]:
    """Clipes audiveis da pista ja resolvidos pela regra P4, pareados com o ORIGINAL.

    Devolve pares (recorte, clipe_bruto): o recorte e o que toca (intervalos
    aparados por resolver_sobreposicoes) e o bruto e o clipe como foi AUTORADO.
    O par existe por causa do WAV tratado + P4: quando um recorte perdeu o
    comeco para um clipe de indice menor, o player continua ancorando a fonte
    no corte original (targetSeconds = baseFonte + frame - timelineStartFrame
    do corte original, player.js:2344-2349). Logo o offset dentro do WAV e
    recorte.in_s - bruto.in_s, que vale 0 no caso comum e avanca o tanto
    perdido nos raros recortes "sem cabeca". Sem isso, trocar a fonte pelo WAV
    num recorte aparado tocaria o trecho errado.

    O pareamento usa o id: recortes inalterados mantem o id; recortes aparados
    recebem "<id>__<ms>" em resolver_sobreposicoes. Ids repetidos sao casados
    na ordem dos indices, sem consumir o mesmo bruto duas vezes.
    """
    brutos = sorted([c for c in seq.clipes if c.track == str(pista.id)],
                    key=lambda c: c.indice)
    recortes = modelo.resolver_sobreposicoes(brutos)
    disponiveis = list(brutos)
    return _parear(recortes, disponiveis)


def _parear(recortes, brutos):
    pares = []
    usados = set()
    for recorte in recortes:
        base_id = recorte.id.split("__", 1)[0]
        bruto = next((b for b in brutos
                      if id(b) not in usados and b.id == recorte.id), None)
        if bruto is None:
            bruto = next((b for b in brutos
                          if id(b) not in usados and b.id == base_id), None)
        if bruto is not None:
            usados.add(id(bruto))
        pares.append((recorte, bruto))
    return pares


# ---------------------------------------------------------------------------
# Camada de uma pista e mixagem final
# ---------------------------------------------------------------------------

def _entrada_do_recorte(recorte: modelo.Clipe, bruto: Optional[modelo.Clipe],
                        pista: modelo.Pista, inicio_s: float, fim_s: float,
                        resolver_tratado: Optional[Callable]) -> Optional[Dict[str, Any]]:
    """Descreve o `-i` de um recorte, ja com a janela de render aplicada.

    Aqui mora a armadilha 3 (WAV tratado). O WAV derivado cobre exatamente o
    trecho [in, out] do corte ORIGINAL e comeca em ZERO; o arquivo original e a
    midia inteira. Logo o ponto de entrada e:

        original -> recorte.in_s
        tratado  -> recorte.in_s - bruto.in_s   (0 no caso comum; avanca o
                                                 tanto perdido quando a regra
                                                 P4 comeu a cabeca do recorte)

    E o mesmo mapa que o player faz com `baseFonte` (player.js:2345).

    Devolve None quando o recorte esta inteiramente fora da janela do render --
    quem chama simplesmente nao cria ramo para ele (render por segmentos passa
    por esse caso o tempo todo).
    """
    head = max(0.0, inicio_s - recorte.inicio_s)
    tail = max(0.0, recorte.fim_s - fim_s)
    duracao = recorte.duracao_s - head - tail
    if duracao <= _EPS_TEMPO:
        return None

    caminho, tratado = None, False
    if resolver_tratado is not None:
        alvo = resolver_tratado(bruto if bruto is not None else recorte)
        if alvo:
            caminho, tratado = str(alvo), True

    if tratado:
        base = recorte.in_s - (bruto.in_s if bruto is not None else recorte.in_s)
    else:
        base = recorte.in_s

    return {
        "tipo": "audio",
        "caminho": caminho,
        "ss": round(base + head, 9),
        "t": round(duracao, 9),
        "tratado": tratado,
        "clipe_id": recorte.id,
        "video_id": recorte.video_id,
        "photo_id": recorte.photo_id,
        "pista_id": pista.id,
    }


def camada_pista_audio(pista: modelo.Pista, seq: modelo.Sequencia,
                       escopo: modelo.Escopo, inicio_s: float, fim_s: float,
                       indice_base: int,
                       resolver_tratado: Optional[Callable] = None
                       ) -> Tuple[List[Dict[str, Any]], List[str], Optional[str]]:
    """Uma pista de audio inteira em (entradas, filtros, rotulo).

    Rotulo None = a pista nao produz som nenhum nesta janela (sem clipe, ou
    todos fora da faixa). Quem chama ignora a pista; um ramo mudo a mais so
    custaria CPU.

    amix com normalize=0 -- SEMPRE. O default do filtro e normalize=1, que
    DIVIDE pelo numero de entradas: com ele, dois clipes em sequencia na mesma
    pista sairiam 6 dB abaixo da fonte, e um trecho com um clipe so nao bateria
    com a tela. Com um ramo unico o amix nem entra: o ramo vira a saida direta,
    para o caso simples atravessar sem nenhum filtro tocando as amostras.
    """
    entradas: List[Dict[str, Any]] = []
    filtros: List[str] = []
    ramos: List[str] = []
    marca = _rotulo_seguro(pista.id)

    for (recorte, bruto) in _recortes_da_pista(seq, pista):
        entrada = _entrada_do_recorte(recorte, bruto, pista,
                                      inicio_s, fim_s, resolver_tratado)
        if entrada is None:
            continue
        indice = indice_base + len(entradas)
        rotulo_saida = f"[a{marca}_{len(ramos)}]"
        filtros.append(cadeia_clipe_audio(
            recorte, pista, seq, escopo,
            f"[{indice}:a]", rotulo_saida,
            inicio_s, fim_render_s=fim_s))
        entradas.append(entrada)
        ramos.append(rotulo_saida)

    if not ramos:
        return [], [], None

    rotulo_pista = f"[apista_{marca}]"
    if len(ramos) == 1:
        # anull existe so para renomear o rotulo sem tocar nas amostras.
        filtros.append(f"{ramos[0]}anull{rotulo_pista}")
    else:
        filtros.append(f"{''.join(ramos)}amix=inputs={len(ramos)}"
                       f":normalize=0:duration=longest{rotulo_pista}")
    return entradas, filtros, rotulo_pista


def grafo_audio_completo(seq: modelo.Sequencia, escopo: modelo.Escopo,
                         inicio_s: float, fim_s: float,
                         resolver_tratado: Optional[Callable] = None,
                         indice_base: int = 0) -> Dict[str, Any]:
    """Grafo de audio da timeline inteira na janela [inicio_s, fim_s].

    Regra P3: itera SO `seq.pistas_audio()`. Um clipe de video e seu parceiro de
    `link_id` na pista de audio apontam para a MESMA midia -- os <video> do
    player sao muted (player.js:1925 e 2051) e todo o som vem da pista de audio.
    Somar os dois dobraria o audio inteiro.

    Pista muda ou desligada no escopo sai da mixagem INTEIRA, em vez de entrar
    com volume 0: ramo a menos nao custa CPU nem acumula ruido de mistura.

    Timeline sem nenhuma pista audivel devolve silencio de `anullsrc` com a
    duracao da janela. Um MP4 com trilha muda e melhor que um MP4 sem trilha
    nenhuma: varios players engasgam quando o arquivo nao tem o stream que o
    resto do fluxo espera.
    """
    duracao = max(0.0, float(fim_s) - float(inicio_s))
    entradas: List[Dict[str, Any]] = []
    filtros: List[str] = []
    rotulos_pista: List[str] = []

    for pista in seq.pistas_audio():
        if pista.muted or not escopo.pista_ligada(pista.id):
            continue
        ent, filt, rotulo = camada_pista_audio(
            pista, seq, escopo, inicio_s, fim_s,
            indice_base + len(entradas), resolver_tratado)
        if rotulo is None:
            continue
        entradas.extend(ent)
        filtros.extend(filt)
        rotulos_pista.append(rotulo)

    rotulo_saida = "[aout]"
    if not rotulos_pista:
        filtros.append(
            f"anullsrc=r={SAMPLE_RATE_SAIDA}:cl=stereo,"
            f"atrim=start=0:end={_num(duracao)},asetpts=PTS-STARTPTS{rotulo_saida}")
        return {"filter_complex": ";".join(filtros),
                "entradas": entradas, "rotulo_audio": rotulo_saida,
                "silencio": True}

    if len(rotulos_pista) == 1:
        entrada_final = rotulos_pista[0]
    else:
        entrada_final = "[amixado]"
        filtros.append(f"{''.join(rotulos_pista)}amix=inputs={len(rotulos_pista)}"
                       f":normalize=0:duration=longest{entrada_final}")

    filtros.append(
        f"{entrada_final}aresample={SAMPLE_RATE_SAIDA},"
        f"aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"alimiter=limit={LIMITE_MIX_LINEAR}:level=disabled:latency=1{rotulo_saida}")

    return {"filter_complex": ";".join(filtros),
            "entradas": entradas, "rotulo_audio": rotulo_saida,
            "silencio": False}
