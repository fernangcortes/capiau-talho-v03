"""Traducao dos filtros CSS de cor para filtros ffmpeg.

Fonte da verdade: ``player.js:2204-2227`` (``applyMediaEffects``). O player monta
o shorthand:

    brightness(1+b/100) contrast(1+c/100) saturate(s/100) hue-rotate(h deg)
    sepia(p%) grayscale(g%) blur(r px)

Na especificacao Filter Effects essas seis funcoes sao DUAS feComponentTransfer
afins por canal (brightness, contrast) seguidas de QUATRO feColorMatrix 3x3
(saturate, hue-rotate, sepia, grayscale), todas em sRGB nao-linear - que e
exatamente como o pixel ja esta armazenado depois do decode. Por isso esta
traducao NAO usa o filtro `eq`: ele trabalha em YUV com brilho ADITIVO, enquanto
o brightness() do CSS e MULTIPLICATIVO em sRGB. Um pelo outro erra a imagem
inteira (PLANO_EXPORTACAO_VIDEO.md, secao 3.3).

Decisoes registradas (o "por que", nao o "o que"):

1. brightness e contrast viram DOIS lutrgb encadeados, nao um. E tentador
   compor os dois numa afim so (val*kb*kc + 127.5*(1-kc)), mas o CSS GRAMPEIA o
   resultado de cada funcao antes de passar a seguinte: um canal que o
   brightness estoura acima de 255 e grampeado ANTES do contrast agir. Com um
   LUT so, o excesso atravessa e a imagem clareia demais - medido no teste de
   grampeamento (ver tests do pacote F): RGB 200 com brightness 50 e contrast
   -40 da 255->255->153 nos dois LUTs e 300->183 num LUT so, 30 níveis fora.
   Estagio identidade (fator 1) nao entra na cadeia.

2. saturate, hue-rotate, sepia e grayscale viram UM colorchannelmixer CADA, na
   ordem do shorthand, pulando os que forem identidade. Mesmo motivo da decisao
   1: o CSS grampeia entre funcoes; compor as quatro numa matriz so diverge
   quando um intermediario sai da gama. Na pratica quase todo clipe mexe em uma
   so, entao a cadeia real costuma ter um estagio.

3. O alfa NAO e tocado. Os coeficientes de/para alfa do colorchannelmixer ficam
   em identidade (ra=ga=ba=0, ar=ag=ab=0, aa=1): o alfa carrega o fade e a
   mascara de crop, e a cor nao pode mexer nele.

4. blur vai de gblur=sigma no FIM da cadeia de cor. Ele faz parte do `filter:`
   do CSS, entao roda ANTES do clip-path: o borrao vaza ate a borda do recorte
   e so depois e cortado.

Toda funcao aqui e PURA: recebe dict, devolve string/lista. Nada de disco,
subprocess ou banco - quem executa e o pacote C.
"""
from math import cos, radians, sin
from typing import List, Optional, Tuple

# Matriz sepia pura (a=1) da especificacao Filter Effects.
_SEPIA_BASE = (
    (0.393, 0.769, 0.189),
    (0.349, 0.686, 0.168),
    (0.272, 0.534, 0.131),
)

# Tolerancia para considerar um parametro neutro. Parametros chegam de JSON de
# UI; 1e-9 so filtra lixo de ponto flutuante, nao mudanca real de valor.
_EPS = 1e-9


def _n(valor: float) -> str:
    """Numero para dentro de opcao/expressao ffmpeg.

    Ponto decimal e sem notacao cientifica (1e-05 quebra o parser de expressao
    em varias versoes). Mesmo formato de fade._n, reimplementado aqui para nao
    acoplar este modulo ao contrato de curvas.
    """
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    if texto in ("", "-", "-0"):
        return "0"
    return texto


def _num_param(efeito: dict, chave: str, padrao: float) -> float:
    """Le um parametro numerico do bloco como o player le.

    O player usa `col.x !== undefined ? col.x : padrao` sem validar tipo; um
    valor nao-numerico na tela vira NaN e desliga a funcao inteira. Aqui, valor
    invalido volta ao padrao neutro (comportamento mais seguro e mais proximo
    do que a UI realmente grava).
    """
    try:
        return float(efeito.get(chave))
    except (TypeError, ValueError):
        return padrao


def _neutro(valor: float, referencia: float = 0.0) -> bool:
    return abs(float(valor) - referencia) <= _EPS


# ---------------------------------------------------------------------------
# Matrizes 3x3 (expostas para o pacote F conferir contra valores a mao)
# ---------------------------------------------------------------------------

def matriz_saturate(k: float) -> Tuple[Tuple[float, float, float], ...]:
    """feColorMatrix type="saturate" com saturacao k (1 = identidade).

    grayscale(a%) e a MESMA matriz com k = 1 - a/100 - definicao literal da
    especificacao, reproduzida aqui em vez de inventar matriz propia.
    """
    return (
        (0.213 + 0.787 * k, 0.715 - 0.715 * k, 0.072 - 0.072 * k),
        (0.213 - 0.213 * k, 0.715 + 0.285 * k, 0.072 - 0.072 * k),
        (0.213 - 0.213 * k, 0.715 - 0.715 * k, 0.072 + 0.928 * k),
    )


def matriz_sepia(a: float) -> Tuple[Tuple[float, float, float], ...]:
    """feColorMatrix sepia com forca a em [0, 1]: (1-a)*I + a*sepia_pura."""
    return tuple(
        tuple((1.0 - a) * identidade + a * base
              for identidade, base in zip(linha_i, linha_s))
        for linha_i, linha_s in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), _SEPIA_BASE)
    )


def matriz_hue(graus: float) -> Tuple[Tuple[float, float, float], ...]:
    """feColorMatrix type="hueRotate" para angulo em graus."""
    t = radians(graus)
    c = cos(t)
    s = sin(t)
    return (
        (0.213 + c * 0.787 - s * 0.213,
         0.715 - c * 0.715 - s * 0.715,
         0.072 - c * 0.072 + s * 0.928),
        (0.213 - c * 0.213 + s * 0.143,
         0.715 + c * 0.285 + s * 0.140,
         0.072 - c * 0.072 - s * 0.283),
        (0.213 - c * 0.213 - s * 0.787,
         0.715 - c * 0.715 + s * 0.715,
         0.072 + c * 0.928 + s * 0.072),
    )


# ---------------------------------------------------------------------------
# Montagem dos filtros
# ---------------------------------------------------------------------------

def _mixer_de_matriz(m: Tuple[Tuple[float, float, float], ...]) -> str:
    """Matriz 3x3 -> colorchannelmixer com alfa em IDENTIDADE.

    Ordem das opcoes e a da doc do filtro: rr:rg:rb:ra gr:gg:gb:ga br:bg:bb:ba
    ar:ag:ab:aa (primeira letra = canal de SAIDA, segunda = canal de ENTRADA).
    ra/ga/ba = 0 e ar/ag/ab = 0 mantem o alfa imune a cor; aa = 1 preserva.
    """
    return (
        "colorchannelmixer="
        f"rr={_n(m[0][0])}:rg={_n(m[0][1])}:rb={_n(m[0][2])}:ra=0:"
        f"gr={_n(m[1][0])}:gg={_n(m[1][1])}:gb={_n(m[1][2])}:ga=0:"
        f"br={_n(m[2][0])}:bg={_n(m[2][1])}:bb={_n(m[2][2])}:ba=0:"
        f"ar=0:ag=0:ab=0:aa=1"
    )


def _lut_brilho(kb: float) -> str:
    """val' = clip(val*kb, 0, 255) por canal, um estagio so."""
    expr = f"clip(val*{_n(kb)},0,255)"
    return f"lutrgb=r='{expr}':g='{expr}':b='{expr}'"


def _lut_contraste(kc: float) -> str:
    """val' = clip(val*kc + 127.5*(1-kc), 0, 255) por canal.

    O termo constante centraliza o pivo do contraste em 127.5, como o
    contrast() do CSS (que pivota no cinza medio, nao no zero).
    """
    termo = 127.5 * (1.0 - kc)
    sinal = "+" if termo >= 0 else "-"
    expr = f"clip(val*{_n(kc)}{sinal}{_n(abs(termo))},0,255)"
    return f"lutrgb=r='{expr}':g='{expr}':b='{expr}'"


def cadeia_cor(efeito_color: Optional[dict]) -> List[str]:
    """Bloco {"type":"color"} -> lista de filtros ffmpeg NA ORDEM do shorthand.

    Devolve [] quando: nao ha bloco, o bloco esta `disabled` (regra P5: bypass,
    nunca preto) ou todos os parametros sao neutros. Quem chama tambem pode
    passar None apos consultar Escopo (categoria cor desmarcada = escolha
    criativa, mesmo ponto de tratamento).

    Ordem garantida: lutrgb brilho -> lutrgb contraste -> mixer saturate ->
    mixer hue-rotate -> mixer sepia -> mixer grayscale -> gblur. Cada estagio
    presente so existe se for diferente de identidade.
    """
    if not isinstance(efeito_color, dict) or efeito_color.get("disabled"):
        return []

    brilho = _num_param(efeito_color, "brightness", 0.0)
    contraste = _num_param(efeito_color, "contrast", 0.0)
    saturacao = _num_param(efeito_color, "saturation", 100.0)
    matiz = _num_param(efeito_color, "hue", 0.0)
    sepia = _num_param(efeito_color, "sepia", 0.0)
    escala_cinza = _num_param(efeito_color, "grayscale", 0.0)
    blur = _num_param(efeito_color, "blur", 0.0)

    if all(_neutro(v) for v in (brilho, contraste, matiz, sepia, escala_cinza, blur)) \
            and _neutro(saturacao, 100.0):
        return []

    filtros: List[str] = []

    kb = 1.0 + brilho / 100.0
    if not _neutro(kb, 1.0):
        filtros.append(_lut_brilho(kb))

    kc = 1.0 + contraste / 100.0
    if not _neutro(kc, 1.0):
        filtros.append(_lut_contraste(kc))

    # A partir daqui as quatro matrizes, na ordem escrita no shorthand do
    # player, pulando identidades.
    k_sat = saturacao / 100.0
    if not _neutro(k_sat, 1.0):
        filtros.append(_mixer_de_matriz(matriz_saturate(k_sat)))

    if not _neutro(matiz % 360.0) and not _neutro(abs(matiz % 360.0), 360.0):
        filtros.append(_mixer_de_matriz(matriz_hue(matiz)))

    if not _neutro(sepia):
        filtros.append(_mixer_de_matriz(matriz_sepia(min(max(sepia, 0.0), 100.0) / 100.0)))

    if not _neutro(escala_cinza):
        # grayscale(a%) == saturate(1 - a/100): definicao da especificacao.
        a = min(max(escala_cinza, 0.0), 100.0) / 100.0
        filtros.append(_mixer_de_matriz(matriz_saturate(1.0 - a)))

    if not _neutro(blur):
        sigma = max(blur, 0.0)
        filtros.append(f"gblur=sigma={_n(sigma)}")

    return filtros
