"""Geometria do enquadramento: fit, crop, transform e ken_burns.

Moldura = sequencia.largura x sequencia.altura (W x H). O elemento do player
ocupa 100% da moldura (player.js aplica object-fit/transform num <img>/<video>
que preenche a caixa).

ORDEM DE APLICACAO - a ordem da especificacao CSS, que NAO e a ordem em que o
JS escreve as propriedades (PLANO_EXPORTACAO_VIDEO.md secao 3.1):

    1. conteudo na caixa W x H   (object-fit: contain | cover)
    2. cor + blur                (cor.py)
    3. opacidade                 (alfa: transform.opacity x fade)
    4. clip-path inset           (crop: recorta, NAO redimensiona)
    5. transform                 (translate -> scale -> rotate, origem centro)
    6. composicao sobre as camadas de baixo

Errar a ordem 4 com 5 faz o crop acompanhar a escala em vez de ficar preso a
moldura - erro que so aparece quando o clipe tem crop E zoom ao mesmo tempo.
Este modulo fornece um bloco por passo; quem monta a cadeia na ordem certa e
grafo_video.py.

Decisoes registradas:

- fit SEM bloco = "fill" (cover), igual ao player (`fitMode = fit ? mode :
  "fill"`). O pad do modo "fit" e TRANSPARENTE (color=black@0) porque a caixa
  do elemento e transparente fora da imagem na tela. Item em aberto 4 do plano:
  `letterbox_transparente=True` deixa o comportamento reversivel com uma flag.

- crop reproduz clip-path: inset(t% r% b% l%): recorta a regiao visivel e volta
  ao tamanho da moldura com pad transparente NA POSICAO ORIGINAL - o conteudo
  nao muda de lugar, so aparece menos dele.

- transform: CSS compoe translate(x%,y%) scale(s) rotate(r) da direita para a
  esquerda (rotaciona primeiro). Escala uniforme comuta com rotacao, entao
  scale->rotate produz o mesmo pixels; o translate vira OFFSET DE OVERLAY,
  devolvido junto com os filtros, porque quem posiciona e o overlay do pacote
  de composicao, nao um filtro interno.

- ken_burns: zoompan esta FORA de questao (quantiza zoom em pixel inteiro e
  treme em escala fracionaria - exatamente o caso de panoramica lenta sobre
  foto). Implementamos como JANELA DE CORTE MOVEL sobre a imagem ja
  enquadrada, invertendo translate+scale:

      largura da janela = W/s        altura = H/s
      x = W/2 - (tx/100)*W/s - W/(2s)     y = simetrico

  A animacao mora no CROP (aceita expressoes em t); o scale de volta a W x H e
  fixo. Supersample antes do crop elimina o degrau de pixel inteiro.

- DESVIO DO PLANO, declarado: a secao 3.4 pedia cair no "caminho generico"
  (scale fixo + overlay com x/y expresso) quando alguma escala interpolada
  fica < 1. Esse caminho NAO consegue animar a escala (o scale do ffmpeg nao
  aceita t), entao perderia o movimento - falha de paridade. Em vez disso o
  mesmo mecanismo de janela cobre os dois casos: o fator de supersample passa
  a ser max(2, 1/escala_minima) e a imagem recebe pad TRANSPARENTE suficiente
  para a maior janela. Escala < 1 vira janela maior que a foto com transparencia
  ao redor, identico ao CSS (elemento menor que a caixa mostrando o fundo).
  Custo: memoria do frame intermediario sobe com 1/s_min; por isso existe
  `fator_supersample_max` (default 8): abaixo de escala 1/8 o afastamento para
  de crescer e o resultado fica MAIOR que a tela - divergencia declarada, caso
  criativo raro (zoom-out de 8x numa foto).

Toda funcao aqui e PURA: dict entra, string/lista sai.
"""
import math
from typing import List, Optional, Tuple

_EPS = 1e-9

# Piso de seguranca para escala: scale=iw*0 daria largura zero e o ffmpeg
# recusa. Na tela scale 0 deixaria o elemento invisivel; 1% da moldura e a
# fresta minima que conseguimos desenhar sem inventar fonte nova.
_ESCALA_MINIMA = 0.01


def _n(valor: float) -> str:
    """Numero para dentro de opcao/expressao ffmpeg (mesmo padrao de cor.py)."""
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    if texto in ("", "-", "-0"):
        return "0"
    return texto


def _num_param(efeito: Optional[dict], chave: str, padrao: float) -> float:
    if not isinstance(efeito, dict):
        return padrao
    try:
        return float(efeito.get(chave))
    except (TypeError, ValueError):
        return padrao


# ---------------------------------------------------------------------------
# 1. Enquadramento (object-fit)
# ---------------------------------------------------------------------------

def filtro_fit(modo: Optional[str], largura: int, altura: int,
               letterbox_transparente: bool = True) -> List[str]:
    """Modo de enquadramento -> filtros que deixam o conteudo NA CAIXA W x H.

    "fit"   = object-fit: contain -> scale decrease + pad (barras).
    outro   = object-fit: cover   -> scale increase + crop central.
    Sem bloco o player usa cover, entao quem chama passa "fill" nesse caso.
    """
    w = int(largura)
    h = int(altura)
    if str(modo or "").strip().lower() == "fit":
        # contain: cabe inteira, barras onde sobrar. Pad transparente porque a
        # caixa do elemento nao tem fundo proprio na tela (item aberto 12.4).
        cor = "black@0" if letterbox_transparente else "black"
        return [
            f"scale={w}:{h}:force_original_aspect_ratio=decrease",
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={cor}",
        ]
    # cover: cobre a moldura e recorta o excesso, centrado (default do crop).
    return [
        f"scale={w}:{h}:force_original_aspect_ratio=increase",
        f"crop={w}:{h}",
    ]


# ---------------------------------------------------------------------------
# 4. clip-path inset (crop)
# ---------------------------------------------------------------------------

def filtros_crop(top: float, right: float, bottom: float, left: float,
                 largura: int, altura: int) -> List[str]:
    """Percentuais de inset -> crop da regiao visível + pad de volta a moldura.

    clip-path: inset() recorta e mantem a CAIXA do tamanho original - por isso
    o crop vem seguido de pad W x H com a sobra transparente na posicao de
    origem, e por isso este bloco vem ANTES do transform.

    Guarda documentada: inset com left+right >= 100 (ou top+bottom >= 100) na
    tela faz o elemento sumir. Recortar a zero px nao existe no filtro, entao
    mantemos uma fresta de 2 px na posicao certa - divergencia conhecida,
    caso patologico (editor cortou mais que o total).
    """
    t = min(max(_num_param({"v": top}, "v", 0.0), 0.0), 100.0)
    r = min(max(_num_param({"v": right}, "v", 0.0), 0.0), 100.0)
    b = min(max(_num_param({"v": bottom}, "v", 0.0), 0.0), 100.0)
    l = min(max(_num_param({"v": left}, "v", 0.0), 0.0), 100.0)

    if _neutro_zero(t) and _neutro_zero(r) and _neutro_zero(b) and _neutro_zero(l):
        return []

    w_vis = round(largura * (1.0 - (l + r) / 100.0))
    h_vis = round(altura * (1.0 - (t + b) / 100.0))
    x = round(largura * l / 100.0)
    y = round(altura * t / 100.0)

    w_vis = max(2, min(w_vis, largura))
    h_vis = max(2, min(h_vis, altura))
    x = max(0, min(x, largura - w_vis))
    y = max(0, min(y, altura - h_vis))

    return [
        f"crop={w_vis}:{h_vis}:{x}:{y}",
        f"pad={int(largura)}:{int(altura)}:{x}:{y}:color=black@0",
    ]


def _neutro_zero(v: float) -> bool:
    return abs(float(v)) <= _EPS


# ---------------------------------------------------------------------------
# 5. transform (translate -> scale -> rotate, origem no centro)
# ---------------------------------------------------------------------------

def filtros_transform(scale: float, tx: float, ty: float, rotacao_graus: float,
                      largura: int, altura: int
                      ) -> Tuple[List[str], Tuple[float, float]]:
    """Transform do CSS -> filtros + offset de overlay.

    Devolve (filtros, (x_overlay, y_overlay)). O offset posiciona o resultado
    sobre a moldura:

        x = (W - w')/2 + tx/100*W      y = (H - h')/2 + ty/100*H

    com w', h' sendo as dimensoes DEPOIS do rotate (quando ha rotacao o canvas
    vira o quadrado da diagonal, para nada ser cortado - o corte final acontece
    no overlay contra a moldura, igual ao overflow do CSS).

    Sentido da rotacao: constante SENTIDO_ROTACAO abaixo. A doc do ffmpeg diz
    horario para angulo positivo, igual ao CSS, e o probe com quadro assimetrico
    (ver relatorio do pacote) confirmou - mas o valor fica isolado aqui para
    inverter num lugar so se alguma versao do ffmpeg provar o contrario.
    """
    s = max(float(scale), _ESCALA_MINIMA)
    w_out = round(largura * s)
    h_out = round(altura * s)
    filtros: List[str] = []

    if not _neutro_zero(s - 1.0):
        filtros.append(f"scale={_n(largura * s)}:{_n(altura * s)}")

    if not _neutro_zero(rotacao_graus):
        diag = math.ceil(math.hypot(w_out, h_out))
        angulo = SENTIDO_ROTACAO * rotacao_graus
        # Fill 0x00000000 = preto com alfa 0: preserva a transparencia dos
        # cantos (a composicao em camadas depende dela). Testado no ffmpeg
        # 7.1; `c=none` tambem funciona, mas o literal RGBA nao depende de
        # parser de cor aceitar "none".
        filtros.append(
            f"rotate={_n(angulo)}*PI/180:c=0x00000000:ow={diag}:oh={diag}"
        )
        w_out = h_out = diag

    ox = (largura - w_out) / 2.0 + tx / 100.0 * largura
    oy = (altura - h_out) / 2.0 + ty / 100.0 * altura
    return filtros, (ox, oy)


def transform_neutra(scale: float, tx: float, ty: float, rotacao_graus: float) -> bool:
    return (_neutro_zero(scale - 1.0) and _neutro_zero(tx) and _neutro_zero(ty)
            and _neutro_zero(rotacao_graus))


# Multiplicador do angulo dentro do rotate (ver docstring de filtros_transform).
SENTIDO_ROTACAO = 1.0


# ---------------------------------------------------------------------------
# ken_burns (so em foto; em video o bloco e ignorado - regra P6)
# ---------------------------------------------------------------------------

def easing_expr(easing: Optional[str], p: str) -> str:
    """Curva de progresso como expressao ffmpeg, porte do player.js:2190."""
    if str(easing or "").strip().lower() == "easeinout":
        return f"(if(lt({p},0.5),2*{p}*{p},1-pow(-2*{p}+2,2)/2))"
    return f"({p})"


def valores_kb(bloco: Optional[dict], progresso: float) -> Tuple[float, float, float]:
    """(scale, tx, ty) interpolados num progresso dado - gabarito em Python
    do mesmo calculo que a expressao ffmpeg faz. Serve ao pacote F conferir
    a expressao ponto a ponto sem renderizar nada."""
    if not isinstance(bloco, dict):
        return 1.0, 0.0, 0.0
    de = bloco.get("from") or {}
    para = bloco.get("to") or {}

    def _de(d, chave):
        try:
            return float(d.get(chave))
        except (TypeError, ValueError, AttributeError):
            return None

    fs = _de(de, "scale")
    if fs is None:
        fs = 1.0
    ts = _de(para, "scale")
    if ts is None:
        ts = 1.0
    fx = _de(de, "x")
    fx = 0.0 if fx is None else fx
    txx = _de(para, "x")
    txx = 0.0 if txx is None else txx
    fy = _de(de, "y")
    fy = 0.0 if fy is None else fy
    tyy = _de(para, "y")
    tyy = 0.0 if tyy is None else tyy

    p = min(max(float(progresso), 0.0), 1.0)
    if _e_easeinout(bloco):
        ease = (2 * p * p) if p < 0.5 else (1 - math.pow(-2 * p + 2, 2) / 2)
    else:
        ease = p
    return (fs + (ts - fs) * ease,
            fx + (txx - fx) * ease,
            fy + (tyy - fy) * ease)


def _e_easeinout(bloco: dict) -> bool:
    return str(bloco.get("easing") or "").strip().lower() == "easeinout"


def janela_visivel(scale: float, tx: float, ty: float,
                   largura: int, altura: int) -> Tuple[float, float, float, float]:
    """Regiao da imagem enquadrada que aparece na moldura, invertendo
    translate+scale: (x, y, largura_janela, altura_janela).

    Valida para qualquer scale > 0; com scale < 1 a janela e maior que a
    moldura e as bordas negativas sao exatamente a transparencia que o CSS
    mostra ao redor do elemento encolhido.
    """
    s = max(float(scale), _ESCALA_MINIMA)
    w = largura / s
    h = altura / s
    x = largura / 2.0 - (tx / 100.0) * largura / s - largura / (2.0 * s)
    y = altura / 2.0 - (ty / 100.0) * altura / s - altura / (2.0 * s)
    return x, y, w, h


def filtros_ken_burns(bloco_kb: dict, duracao_clipe_s: float, delta_tempo_s: float,
                      largura: int, altura: int, rotacao_graus: float = 0.0,
                      fator_supersample: float = 2.0,
                      fator_supersample_max: float = 8.0,
                      fps: float = 25.0) -> List[str]:
    """Bloco ken_burns -> cadeia que anima scale/x/y SEM tremor.

    Pipeline (tudo depois do fit/cor/alfa/crop do clipe):

      [rotate, se o transform trouxe rotacao - a rotacao comuta com a escala]
      -> scale FIXO de supersample (fator K)
      -> pad transparente com folga para a maior janela
      -> crop com EXPRESSOES em t (a animacao vive aqui)
      -> scale de volta a W x H (fixo)

    `delta_tempo_s` e o tanto ja cortado do começo do clipe pela faixa de
    render: o stream local comeca em t=0 mas o Ken Burns mede o progresso desde
    o inicio ORIGINAL do clipe (player usa timelineStartFrame), entao o
    progresso embutido nas expressoes e p=(t+delta)/duracao.
    """
    w = int(largura)
    h = int(altura)
    dur = max(float(duracao_clipe_s), 1e-6)
    delta = max(float(delta_tempo_s or 0.0), 0.0)

    filtros: List[str] = []

    # Rotacao vem do transform (KB substitui so scale/x/y - player.js:2189).
    canvas_w, canvas_h = w, h
    if not _neutro_zero(rotacao_graus):
        diag = math.ceil(math.hypot(w, h))
        filtros.append(
            f"rotate={_n(SENTIDO_ROTACAO * rotacao_graus)}*PI/180:"
            f"c=0x00000000:ow={diag}:oh={diag}"
        )
        canvas_w = canvas_h = diag

    de = bloque_from_to(bloco_kb)

    # Extremos do movimento: as duas easings (linear e easeInOut) sao
    # monotonicas, entao a janela extrema acontece nos extremos de p (0 e 1),
    # que valem exatamente from e to. E disso sai a folga do pad.
    janelas = [janela_visivel(s, tx, ty, canvas_w, canvas_h)
               for (s, tx, ty) in de]
    s_min = min(de[0][0], de[1][0])

    k = max(float(fator_supersample), 1.0 / max(s_min, _ESCALA_MINIMA))
    k_clamp = float(fator_supersample_max)
    if k > k_clamp:
        k = k_clamp  # zoom-out profundo demais: divergencia declarada no docstring
    kw = math.ceil(canvas_w * k)
    kh = math.ceil(canvas_h * k)

    filtros.append(f"scale={kw}:{kh}")

    # Folga do pad: cobre a uniao das duas janelas extremas (em coords K).
    rets_k = []
    for (x, y, jw, jh) in janelas:
        rets_k.append((x * k, y * k, jw * k, jh * k))
    m_left = max(0, math.ceil(-min(r[0] for r in rets_k)))
    m_top = max(0, math.ceil(-min(r[1] for r in rets_k)))
    m_right = max(0, math.ceil(max(r[0] + r[2] for r in rets_k) - kw))
    m_bottom = max(0, math.ceil(max(r[1] + r[3] for r in rets_k) - kh))

    pw = kw + m_left + m_right
    ph = kh + m_top + m_bottom
    # O zoompan recorta uma janela com a MESMA proporcao da entrada (iw/z x ih/z).
    # Se o pad desproporcionar a moldura, a janela sai esticada. Cresce o lado que
    # falta, distribuindo a folga dos dois lados para o centro nao migrar.
    alvo = canvas_w / float(canvas_h)
    if pw / float(ph) > alvo:
        novo = int(math.ceil(pw / alvo))
        extra = novo - ph
        m_top += extra // 2
        ph = novo
    elif pw / float(ph) < alvo:
        novo = int(math.ceil(ph * alvo))
        extra = novo - pw
        m_left += extra // 2
        pw = novo
    if pw != kw or ph != kh:
        filtros.append(f"pad={pw}:{ph}:{m_left}:{m_top}:color=black@0")

    # Expressoes animadas. p preso em [0,1]; E = curva; s/tx/ty interpolam
    # entre from e to exatamente como player.js:2194-2199.
    # `time` = carimbo de saida em segundos do zoompan (o `t` do crop nao existe
    # aqui). Conferido nesta build em 24/08/2026.
    p = f"clip((time+{_n(delta)})/{_n(dur)},0,1)"
    e = easing_expr(bloco_kb.get("easing"), p)
    (fs, fx, fy), (ts, txx, tyy) = de[0], de[1]
    s_e = f"max({_n(fs)}+({_n(ts)}-{_n(fs)})*{e},{_ESCALA_MINIMA})"
    tx_e = f"{_n(fx)}+({_n(txx)}-{_n(fx)})*{e}"
    ty_e = f"{_n(fy)}+({_n(tyy)}-{_n(fy)})*{e}"

    x_e = f"({m_left}+{_n(k)}*(({canvas_w}/2)-({tx_e})/100*{canvas_w}/{s_e}-{canvas_w}/(2*{s_e})))"
    y_e = f"({m_top}+{_n(k)}*(({canvas_h}/2)-({ty_e})/100*{canvas_h}/{s_e}-{canvas_h}/(2*{s_e})))"

    # POR QUE zoompan E NAO crop COM EXPRESSAO
    # ----------------------------------------
    # O plano mandava animar `crop` e evitar o zoompan por causa do tremor. Nao
    # da: o `crop` avalia w/h UMA VEZ, na configuracao do filtro, onde `t` nem
    # existe -- o tamanho do quadro de saida nao pode variar por frame. Medido
    # em 24/08/2026: "Error when evaluating the expression '360/(1+0.3*t)'" e
    # "Failed to configure input pad". A especificacao do plano era impossivel.
    #
    # O zoompan e o filtro certo: saida de tamanho FIXO (s=WxH) com janela movel
    # por frame. O tremor que motivava evita-lo vem da quantizacao de z e de x/y
    # em pixel inteiro -- e por isso o supersample (fator k) vem ANTES: no
    # espaco ampliado, um pixel inteiro vale uma fracao de pixel na saida.
    #
    # z e relativo a ENTRADA do zoompan (janela = iw/z), e a entrada aqui e a
    # imagem ja supersamplada e padeada; dai o fator pw/kw.
    z_e = f"({s_e})*{pw}/{kw}"
    filtros.append(
        f"zoompan=z='{z_e}':x='{x_e}':y='{y_e}':d=1:s={w}x{h}:fps={_n(fps)}"
    )
    return filtros


def bloque_from_to(bloco: dict) -> Tuple[Tuple[float, float, float],
                                         Tuple[float, float, float]]:
    """((from.scale, from.x, from.y), (to.scale, to.x, to.y)) com os mesmos
    defaults do player (?? 1 / ?? 0)."""
    def _triplo(d) -> Tuple[float, float, float]:
        d = d if isinstance(d, dict) else {}
        vals = []
        for chave, padrao in (("scale", 1.0), ("x", 0.0), ("y", 0.0)):
            try:
                v = float(d.get(chave))
            except (TypeError, ValueError):
                v = padrao
            vals.append(v)
        return tuple(vals)  # type: ignore[return-value]

    return _triplo(bloco.get("from")), _triplo(bloco.get("to"))
