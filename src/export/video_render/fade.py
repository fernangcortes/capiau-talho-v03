"""Curvas de fade: porte exato de `evaluateFadeCurve` do player para o render.

CONTRATO CONGELADO. Os pacotes de video e de audio dependem deste modulo; ele
nao muda sem revisao do dono do plano.

A fonte da verdade e `src/ui/js/timelineState.js` (funcao `evaluateFadeCurve`,
por volta da linha 128). O player avalia a curva por frame e multiplica o
resultado na opacidade (video) e no volume (audio). O render precisa produzir
NUMERO IDENTICO no mesmo instante -- senao o fade do arquivo nao e o fade que o
editor viu na tela.

Por que expressao e nao o filtro `fade` do ffmpeg
-------------------------------------------------
O `fade`/`afade` do ffmpeg so aceita curvas de um catalogo fixo (tri, qsin, esin,
log, exp, cub...). A familia daqui e parametrica: alem do tipo, tem uma tensao
continua k em [-1, 1] que deforma a curva. Nenhuma curva do catalogo reproduz
isso. Entao a curva vira uma EXPRESSAO em `t`, avaliada pelo proprio ffmpeg:

  - audio: `volume=volume='<expr>':eval=frame`  (exato e barato)
  - video: `geq` no canal alfa, restrito a janela do fade (ver grafo_video.py)

Unico atalho permitido: curva "linear" com tensao ~0 e matematicamente igual a
`fade=curve=tri`, que e ordens de grandeza mais barato. `usa_atalho_linear()`
diz quando o atalho vale.
"""
from typing import Optional

# Fora desta faixa a tensao e ignorada pelo player (clamp em [-1, 1]).
TENSAO_MIN = -1.0
TENSAO_MAX = 1.0

# O player trata |k| < 0.01 como "sem tensao" (timelineState.js). O render usa o
# MESMO limiar: mudar isso aqui cria divergencia silenciosa com a tela.
LIMIAR_TENSAO_NULA = 0.01

# Duracao minima de fade aceita pelo player: `Math.max(0.05, cf.duration_s || 0.5)`.
DURACAO_MINIMA_S = 0.05
DURACAO_PADRAO_S = 0.5

CURVAS_CONHECIDAS = ("linear", "exponential", "logarithmic", "s_curve", "custom")


def _clamp(valor: float, minimo: float, maximo: float) -> float:
    return max(minimo, min(maximo, valor))


def normalizar_tensao(tension) -> float:
    """Tensao como o player le: numero finito, preso em [-1, 1], invalido = 0."""
    try:
        k = float(tension)
    except (TypeError, ValueError):
        return 0.0
    if k != k or k in (float("inf"), float("-inf")):  # NaN / infinito
        return 0.0
    return _clamp(k, TENSAO_MIN, TENSAO_MAX)


def normalizar_duracao(duration_s) -> float:
    """Duracao do fade como o player le: `max(0.05, duration_s || 0.5)`.

    Cuidado com o `||` do JavaScript: 0 e falsy, entao duracao 0 vira 0.5 la --
    e precisa virar 0.5 aqui tambem, nao 0.05.
    """
    try:
        d = float(duration_s)
    except (TypeError, ValueError):
        d = 0.0
    if not d:  # 0, None, NaN -> mesmo caminho do falsy do JS
        d = DURACAO_PADRAO_S
    return max(DURACAO_MINIMA_S, d)


def normalizar_curva(curve) -> str:
    """Nome da curva; qualquer coisa fora do catalogo cai em 'linear'.

    O player nao valida o nome: o `if` dele testa s_curve, exponential e
    logarithmic e o `else` final e o ramo linear/custom. Ou seja, nome
    desconhecido JA se comporta como linear na tela. Espelhado aqui de proposito.
    """
    nome = str(curve or "linear").strip().lower()
    return nome if nome in CURVAS_CONHECIDAS else "linear"


def avaliar(progress: float, curve: str = "linear", tension: float = 0.0) -> float:
    """Fator de atenuacao em [0, 1] para um progresso p em [0, 1].

    Porte linha a linha de `evaluateFadeCurve`. Serve de gabarito nos testes:
    a expressao ffmpeg gerada por `expressao()` tem de bater com esta funcao.
    """
    try:
        p = float(progress)
    except (TypeError, ValueError):
        p = 0.0
    if p != p:
        p = 0.0
    p = _clamp(p, 0.0, 1.0)
    k = normalizar_tensao(tension)
    tipo = normalizar_curva(curve)

    if tipo == "s_curve":
        base_s = p * p * (3 - 2 * p)
        if abs(k) < LIMIAR_TENSAO_NULA:
            return base_s
        if k > 0:
            return base_s ** (1.0 / (1 + k * 1.5))
        return base_s ** (1 + abs(k) * 1.5)

    if tipo == "exponential":
        return p ** (2.0 + abs(k) * 2.0)

    if tipo == "logarithmic":
        return 1.0 - (1.0 - p) ** (2.0 + abs(k) * 2.0)

    # linear / custom
    if abs(k) < LIMIAR_TENSAO_NULA:
        return p
    if k > 0:
        return p ** (1.0 / (1.0 + k * 2.5))
    return p ** (1.0 + abs(k) * 2.5)


def usa_atalho_linear(curve: str, tension) -> bool:
    """True quando a curva e exatamente a reta e o filtro `fade`/`afade` serve.

    Nesse caso `fade=curve=tri` (video) e `afade=curve=tri` (audio) produzem o
    MESMO numero da expressao, por muito menos CPU.
    """
    return (normalizar_curva(curve) in ("linear", "custom")
            and abs(normalizar_tensao(tension)) < LIMIAR_TENSAO_NULA)


def expressao_progresso(inicio_s: float, duracao_s: float, lado: str,
                        fim_s: Optional[float] = None, var_tempo: str = "t") -> str:
    """Expressao ffmpeg do progresso p do fade, ja presa em [0, 1].

    `lado="in"`  -> p = (t - inicio) / d           (0 no comeco, 1 ao fim do fade)
    `lado="out"` -> p = (fim - t) / d              (1 ate o fim do fade, 0 no fim)

    `var_tempo` e a variavel de tempo do filtro de destino: "t" no `volume` e no
    `geq`, "T" em alguns contextos de `drawtext`. Sempre em SEGUNDOS relativos ao
    stream ja cortado (depois de atrim/trim + setpts/asetpts zerando a base).
    """
    d = normalizar_duracao(duracao_s)
    if str(lado).lower() == "out":
        if fim_s is None:
            raise ValueError("fade de saida exige 'fim_s' (instante final do clipe).")
        bruto = f"(({_n(fim_s)}-{var_tempo})/{_n(d)})"
    else:
        bruto = f"(({var_tempo}-{_n(inicio_s)})/{_n(d)})"
    return f"clip({bruto},0,1)"


def expressao(curve: str, tension, progresso_expr: str) -> str:
    """Curva como expressao ffmpeg, dado um sub-expressao de progresso ja em [0,1].

    Devolve algo que avalia para o fator em [0, 1]. Combine com
    `expressao_progresso()`:

        p = fade.expressao_progresso(0.0, 0.8, "in")
        f = fade.expressao(cf["curve"], cf["tension"], p)
        # -> volume=volume='<f>':eval=frame

    Sintaxe usada: pow(), clip() e aritmetica basica -- tudo suportado pelo
    avaliador de expressoes do ffmpeg (ffmpeg-utils, secao "Expression
    Evaluation"). Sem `if()` aninhado: os ramos sao resolvidos AQUI, em Python,
    porque a curva e a tensao sao constantes do clipe, nao variam por frame.
    """
    k = normalizar_tensao(tension)
    tipo = normalizar_curva(curve)
    p = f"({progresso_expr})"

    if tipo == "s_curve":
        base_s = f"({p}*{p}*(3-2*{p}))"
        if abs(k) < LIMIAR_TENSAO_NULA:
            return base_s
        expo = (1.0 / (1 + k * 1.5)) if k > 0 else (1 + abs(k) * 1.5)
        return f"pow({base_s},{_n(expo)})"

    if tipo == "exponential":
        return f"pow({p},{_n(2.0 + abs(k) * 2.0)})"

    if tipo == "logarithmic":
        return f"(1-pow((1-{p}),{_n(2.0 + abs(k) * 2.0)}))"

    # linear / custom
    if abs(k) < LIMIAR_TENSAO_NULA:
        return p
    expo = (1.0 / (1.0 + k * 2.5)) if k > 0 else (1.0 + abs(k) * 2.5)
    return f"pow({p},{_n(expo)})"


def fator_combinado(efeitos, t_desde_inicio: float, t_ate_fim: float) -> float:
    """Fator de fade do clipe inteiro num instante, como o player calcula.

    O player NAO soma nem multiplica os crossfades: ele pega o MENOR fator entre
    todos os que estao ativos naquele instante (`fadeVol = Math.min(...)` em
    player.js). Fora da janela do fade o fator daquele efeito e 1 (nao entra na
    conta). Efeito com `disabled: true` e ignorado por completo.

    `t_desde_inicio` e `t_ate_fim` em segundos, medidos como no player:
        tIn  = (frameAtual - inicioDoClipe) / fps
        tOut = (inicioDoClipe + duracao - frameAtual) / fps
    """
    fator = 1.0
    for efeito in (efeitos or []):
        if not isinstance(efeito, dict) or efeito.get("type") != "crossfade":
            continue
        if efeito.get("disabled"):
            continue
        d = normalizar_duracao(efeito.get("duration_s"))
        lado = str(efeito.get("side") or "").lower()
        if lado == "in" and t_desde_inicio < d:
            p = _clamp(t_desde_inicio / d, 0.0, 1.0)
            fator = min(fator, avaliar(p, efeito.get("curve"), efeito.get("tension")))
        elif lado == "out" and t_ate_fim < d:
            p = _clamp(t_ate_fim / d, 0.0, 1.0)
            fator = min(fator, avaliar(p, efeito.get("curve"), efeito.get("tension")))
    return fator


def _n(valor: float) -> str:
    """Numero para dentro de expressao ffmpeg: ponto decimal, sem notacao 1e-05.

    Notacao cientifica quebra o parser de expressao do ffmpeg em varias versoes.
    9 casas porque estes numeros tambem viram EXPOENTE: com 6 casas, o expoente
    da s_curve com tensao 0,5 (1/1,75 = 0,571428...) arredondava e a curva saia
    ~3e-7 fora do gabarito. Invisivel num alfa de 8 bits (1/255 = 3,9e-3), mas
    barato de eliminar -- e sem isso o teste de paridade precisa de tolerancia
    frouxa, que e justamente onde erro de verdade se esconde.
    """
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    return texto if texto not in ("", "-") else "0"
