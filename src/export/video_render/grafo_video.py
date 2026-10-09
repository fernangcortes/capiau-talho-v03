"""Cadeia por clipe e composicao em camadas do video (pacote A).

Consome os contratos (`modelo.py`, `fade.py`) e os blocos de `cor.py` e
`geometria.py`. Tudo aqui e PURO: entra `Sequencia`, sai STRING de
filter_complex e a lista de entradas para `-i`. Quem roda o ffmpeg e o pacote C.

Ordem da cadeia de UM clipe (= ordem CSS, secao 3.1 do plano):

    trim/setpts (ou nada na foto, que entra com -loop 1 -t)
    -> format=rgba
    -> enquadramento (fit/fill)           [geometria.filtro_fit]
    -> cor + blur                         [cor.cadeia_cor]
    -> alfa (opacity x fades)             [_montar_alfa]
    -> crop + pad transparente            [geometria.filtros_crop]
    -> scale/rotate (ou janela Ken Burns) [geometria]
    -> setpts de reposicao na camada

Composicao (secao 4.1): cada pista de video produz UMA camada RGBA do tamanho
e da duracao INTEIROS do render. A camada comeca num pad TRANSPARENTE (nao
preto!) e recebe cada clipe por `overlay` com `enable=between(t,ini,fim)`; as
camadas sao empilhadas do fundo para a frente sobre uma base PRETA final. O
pad transparente e obrigatorio: se a camada fosse preta, a pista de cima
taparia a de baixo nos vazios dela. Isso resolve de graca gaps (a base preta
aparece), fotos, fade por clipe (o alfa compoe contra o que esta embaixo:
dissolvencia com clipe embaixo, fade para preto sem) e a ordem das pistas
(`pistas_video()` devolve topo->fundo; empilha com reversed()).

Mesclagem (blend mode != normal) NAO passa pela camada da pista: o player
mescla com tudo o que esta embaixo, entao o clipe e composto direto no
acumulado, so na janela dele (`_compor_em_janela` + `_corpo_blend`): lut2 com
a formula W3C em RGB e o alfa do clipe, para fade e opacidade continuarem
valendo. Camada de ajuste com mesclagem usa o mesmo caminho.

Decisoes e paridades registradas:

- P4/P1: quem chama passa os clipes JA resolvidos por `seq.clipes_da_pista()`
  (que aplica P4) e as pistas vem de `pistas_video()` (que exclui IA).

- `disabled`: o player procura o PRIMEIRO bloco do tipo e testa `.disabled`
  NELE (player.js:2166, 2181, 2208, 2254). Espelhamos com
  `Clipe.efeito(tipo, incluir_bypass=True)` + teste manual - e nao "procura o
  proximo nao-desabilitado", que seria outro comportamento.

- EXCECAO DE PARIDADE, declarada: o player NAO testa `disabled` no bloco
  `fit` (linha 2167 usa `fit.mode` direto). Um fit desabilitado ainda muda o
  object-fit la. Reproduzimos igual e o caso vai para o banner de fidelidade -
  provavelmente e um oversight do player, mas paridade e paridade.

- Escopo: categoria desmarcada (`Escopo.efeito_ligado`) e bloco `disabled`
  sao tratados NO MESMO PONTO: ambos tiram o bloco da cadeia, sem aviso - um
  por escolha do editor, outro por decisao do proprio clipe.

- Tempo: o pacote C busca a midia com -ss/-t, entao o stream do clipe comeca
  em t=0 LOCAL. Fade e Ken Burns medem tempo desde o inicio ORIGINAL do clipe
  (o player usa timelineStartFrame), entao as expressoes recebem o delta ja
  cortado (`delta_tempo`). O overlay precisa do instante NA CAMADA, entao a
  cadeia termina com `setpts=PTS+<inicio_na_camada>/TB` - sem isso todo clipe
  apareceria em t=0 da camada, colado no anterior.

- Contrato com o pacote C: `entradas` traz campos alem dos pedidos na tarefa
  (`clipe_id`, `video_id`, `photo_id`, `pista_id`) porque o grafo NAO resolve
  caminho de midia (isso e trabalho do `midia.py`): `caminho` sai None e o C
  preenche a partir dos ids. Relatado ao integrador.
"""
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import cor, fade, geometria, modelo

_EPS_TEMPO = 1e-6

# Modos de mesclagem = formulas da W3C (Compositing and Blending Level 1), as
# mesmas do mix-blend-mode do player e do globalCompositeOperation do
# renderCache. Uma expressao por canal para o `lut2` em gbrap: x = fundo (Cb),
# y = clipe (Cs), 8 bits. Nao usar o filtro `blend` do ffmpeg: ele ignora o
# alfa (fade e opacidade sumiam), roda em YUV quando nao forcado e o softlight
# dele e outra formula (medido no ffmpeg 5.1 em 09/10/2026: verde multiply
# sobre vermelho dava (0,123,0) em vez de (0,38,0)).
_SL_B = "(x/255)"
_SL_S = "(y/255)"
EXPR_BLEND = {
    "multiply": "x*y/255",
    "screen": "x+y-x*y/255",
    # overlay e hard-light com os papeis trocados: overlay decide pelo FUNDO.
    "overlay": "if(lte(x,127.5),2*x*y/255,255-2*(255-x)*(255-y)/255)",
    "hard-light": "if(lte(y,127.5),2*x*y/255,255-2*(255-x)*(255-y)/255)",
    "darken": "min(x,y)",
    "lighten": "max(x,y)",
    "difference": "abs(x-y)",
    "exclusion": "x+y-2*x*y/255",
    "soft-light": (
        f"255*if(lte({_SL_S},0.5),"
        f"{_SL_B}-(1-2*{_SL_S})*{_SL_B}*(1-{_SL_B}),"
        f"{_SL_B}+(2*{_SL_S}-1)*(if(lte({_SL_B},0.25),"
        f"((16*{_SL_B}-12)*{_SL_B}+4)*{_SL_B},sqrt({_SL_B}))-{_SL_B}))"
    ),
    "color-dodge": "if(eq(x,0),0,if(eq(y,255),255,min(255,255*x/(255-y))))",
    "color-burn": "if(eq(x,255),255,if(eq(y,0),0,255-min(255,255*(255-x)/y)))",
}
_APELIDOS_BLEND = {
    "softlight": "soft-light",
    "hardlight": "hard-light",
    "colordodge": "color-dodge",
    "colorburn": "color-burn",
}


def mapear_blend_mode(modo: Optional[str]) -> str:
    """Nome CSS do modo, ou "normal" quando o motor nao o reproduz.

    Os modos nao separaveis do CSS (hue, saturation, color, luminosity) nao
    cabem numa tabela por canal e caem em normal.
    """
    if not modo:
        return "normal"
    modo_norm = str(modo).strip().lower()
    modo_norm = _APELIDOS_BLEND.get(modo_norm, modo_norm)
    return modo_norm if modo_norm in EXPR_BLEND else "normal"


def _filtro_lut2_blend(modo: str) -> str:
    """lut2 que entrega B(fundo, clipe) nas cores e o alfa do CLIPE.

    O fundo e opaco (alfa 255), entao c3 = y devolve o alfa do clipe -- fade,
    opacidade e areas transparentes -- para o overlay seguinte compor
    (1 - a) * fundo + a * B(fundo, clipe), como o navegador.
    """
    e = f"clip(round({EXPR_BLEND[modo]}),0,255)"
    return f"lut2=c0='{e}':c1='{e}':c2='{e}':c3='y'"


def _n(valor: float) -> str:
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    if texto in ("", "-", "-0"):
        return "0"
    return texto


def _enable_janela(ini: float, fim: float, fps: float) -> str:
    """`enable` do overlay para um clipe que ocupa [ini, fim) no render.

    O player mostra o clipe em `frame >= inicio && frame < inicio + duracao`.
    `between(t,ini,fim)` e fechado nas duas pontas e o overlay repete o ultimo
    quadro do clipe depois do EOF (eof_action=repeat): o clipe ganhava um
    quadro a mais no fim (medido em 09/10/2026: cor solida ainda na tela no
    quadro em que ja tinha acabado). Meio quadro de folga nas duas pontas
    inclui o primeiro quadro e exclui o seguinte ao ultimo, sem depender de
    t cair exatamente no decimal.
    """
    meio = 0.5 / float(fps)
    return f"enable='between(t,{_n(ini - meio)},{_n(fim - meio)})'"


def _col(rotulo: str) -> str:
    """Garante colchetes num rotulo de stream."""
    r = str(rotulo).strip()
    return r if r.startswith("[") else f"[{r}]"


def _sem_colchete(rotulo: str) -> str:
    return str(rotulo).strip().strip("[]")


def _num(bloco: Optional[dict], chave: str, padrao: float) -> float:
    if not isinstance(bloco, dict):
        return padrao
    try:
        return float(bloco.get(chave))
    except (TypeError, ValueError):
        return padrao


def _bloco_ativo(clipe, tipo: str) -> Optional[dict]:
    """Primeiro bloco do tipo; `disabled: true` o torna AUSENTE (P5).

    Espelho do player: `effects.find(...)` pega o primeiro e o `if (!x.disabled)`
    decide; um segundo bloco do mesmo tipo nunca e considerado.
    """
    bruto = clipe.efeito(tipo, incluir_bypass=True)
    if bruto is None or bruto.get("disabled"):
        return None
    return bruto


# ---------------------------------------------------------------------------
# Alfa: opacity do transform x crossfades
# ---------------------------------------------------------------------------

def _montar_alfa(clipe, escopo, delta: float, dur_clipe: float, dur_stream: float,
                 opacidade: float, rotulo_base: str
                 ) -> Tuple[List[str], List[str], str]:
    """Alfa do clipe -> (filtros_inline, declaracoes_de_grafico, rotulo_cabeca).

    `rotulo_cabeca` so importa no caminho de grafico: e o filtro (opacity
    constante) que gruda ANTES do split, no consumo do rotulo corrente.

    - Sem fades e opacity 1: nada (caminho da maioria dos clipes).
    - Opacity constante != 1: `colorchannelmixer=aa=<op>` multiplica o alfa
      sem custo relevante (nada de geq para fator fixo).
    - Fade linear com tensao ~0 e janelas sem sobreposicao: atalho
      `fade=t=in|out:...:alpha=1` (matematicamente identico a curva tri e
      ordens de grandeza mais barato; `fade.usa_atalho_linear` diz quando vale).
    - Caso contrario (curva parametrica ou janelas cruzadas): geq no canal alfa
      RESTRITO a janela: split -> trim das pecas -> geq so onde ha fade ->
      concat de volta. geq e caro por pixel; limitado aos ~0,5 s de fade o
      custo some. Varios fades ativos viram min(...) numa unica expressao,
      reproduzindo o Math.min do player (NAO produto).
    """
    inline: List[str] = []
    grafico: List[str] = []
    op_neutra = abs(opacidade - 1.0) <= 1e-9

    todos_cf = clipe.efeitos("crossfade") if escopo.efeito_ligado("crossfade") else []
    efeitos_cf = [
        cf for cf in todos_cf
        if not cf.get("transitionId") or cf.get("is_transition")
    ]

    # Filtra apenas os fades que de fato intersectam a janela do stream [0.0, dur_stream].
    # Em tempo de stream (t = tempo_clipe - delta):
    # - fade "in": intervalo de fade no stream e [-delta, d - delta].
    #   Se d - delta <= 0, o fade-in ja terminou antes do stream comecar (alpha = 1.0 constante).
    # - fade "out": intervalo de fade no stream e [dur_clipe - d - delta, dur_clipe - delta].
    #   Se dur_clipe - d - delta >= dur_stream, o fade-out so comecaria apos o stream terminar (alpha = 1.0 constante).
    #   Se dur_clipe - delta <= 0, o clipe todo ja terminou antes do stream comecar.
    efeitos_cf_ativos: List[Dict[str, Any]] = []
    rampas: List[Tuple[str, float]] = []
    st_rampas: List[float] = []

    for cf in efeitos_cf:
        lado = str(cf.get("side") or "").strip().lower()
        if lado not in ("in", "out"):
            continue  # o player so trata esses dois lados
        d = fade.normalizar_duracao(cf.get("duration_s"))
        if lado == "in":
            if d - delta <= 1e-9:
                continue  # fade-in concluido antes do inicio do stream
            st = -delta
        else:
            if (dur_clipe - d - delta) >= dur_stream - 1e-9:
                continue  # fade-out so comeca apos o fim do stream
            if (dur_clipe - delta) <= 1e-9:
                continue  # clipe concluido antes do inicio do stream
            st = dur_clipe - d - delta

        efeitos_cf_ativos.append(cf)
        rampas.append((lado, d))
        st_rampas.append(st)

    if not rampas:
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        return inline, grafico, ""

    # Janelas no tempo do clipe para detectar sobreposicao
    janelas = sorted(
        (0.0, d) if lado == "in" else (dur_clipe - d, dur_clipe)
        for (lado, d) in rampas
    )
    sobrepoem = any(janelas[i + 1][0] < janelas[i][1] - 1e-9
                    for i in range(len(janelas) - 1))
    tudo_atalho = all(
        fade.usa_atalho_linear(cf.get("curve"), cf.get("tension"))
        for cf in efeitos_cf_ativos
    )
    # O filtro builtin 'fade' do FFmpeg EXIGE st >= 0 (valor negativo causa erro
    # 'Value ... for parameter st out of range [0 - ...] Result too large').
    # Se st < 0 (o stream comecou no meio de um fade em andamento), o atalho nao
    # pode ser usado e cai no caminho geq abaixo, que avalia a curva com precisao.
    st_validos = all(st >= -1e-9 for st in st_rampas)

    if tudo_atalho and st_validos and not sobrepoem:
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        for (lado, d), st in zip(rampas, st_rampas):
            st_limpo = max(0.0, st)
            if lado == "in":
                inline.append(f"fade=t=in:st={_n(st_limpo)}:d={_n(d)}:alpha=1")
            else:
                inline.append(f"fade=t=out:st={_n(st_limpo)}:d={_n(d)}:alpha=1")
        return inline, grafico, ""

    # --- caminho geq -------------------------------------------------------
    lo = max(min(j[0] for j in janelas) - delta, 0.0)          # tempo de stream
    hi = max(min(max(j[1] for j in janelas) - delta, dur_stream), 0.0)

    if hi <= lo + _EPS_TEMPO:
        # O trecho renderizado nem alcanca a janela do fade.
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        return inline, grafico, ""

    termos: List[str] = []
    # ATENCAO: var_tempo="T" e MAIUSCULO no geq - medido no ffmpeg 7.1.4:
    # 't' minusculo da "Undefined constant". O docstring de fade.py sugere "t"
    # para geq; divergencia do contrato, contornada aqui sem editar o modulo
    # (o parametro existe justamente para isso). Relatado ao integrador.
    for cf in efeitos_cf_ativos:
        lado = str(cf.get("side") or "").strip().lower()
        if lado not in ("in", "out"):
            continue
        d = fade.normalizar_duracao(cf.get("duration_s"))
        if lado == "in":
            prog = fade.expressao_progresso(-delta, d, "in", var_tempo="T")
        else:
            # O fim do clipe no tempo do stream vai em `fim_s`, NAO em `inicio_s`
            # (que e o primeiro posicional). Trocado, o fade de saida levantava
            # ValueError e nenhum clipe com fade-out chegava a renderizar.
            prog = fade.expressao_progresso(0.0, d, "out",
                                            fim_s=dur_clipe - delta, var_tempo="T")
        termos.append(fade.expressao(cf.get("curve"), cf.get("tension"), prog))

    fator = termos[0] if len(termos) == 1 else "min(" + ",".join(termos) + ")"
    peso = "" if op_neutra else f"{_n(opacidade)}*"
    expr_alfa = f"'255*{peso}{fator}'"

    base = _sem_colchete(rotulo_base)
    pecas: List[str] = []
    rotulos: List[str] = []
    if lo > _EPS_TEMPO:
        rotulos.append(f"{base}_fx0")
        pecas.append(f"trim=start=0:end={_n(lo)},setpts=PTS-STARTPTS")
    rotulos.append(f"{base}_fxm")
    pecas.append(
        f"trim=start={_n(lo)}:end={_n(hi)},setpts=PTS-STARTPTS,"
        f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a={expr_alfa}"
    )
    if hi < dur_stream - _EPS_TEMPO:
        rotulos.append(f"{base}_fxf")
        pecas.append(f"trim=start={_n(hi)},setpts=PTS-STARTPTS")

    n = len(pecas)
    cabeca = "" if op_neutra else f"colorchannelmixer=aa={_n(opacidade)},"
    grafico.append(f"{cabeca}split={n}" + "".join(_col(r) for r in rotulos))
    # Cada peca PRECISA de rotulo de saida proprio. Sem ele a declaracao termina
    # solta: o ffmpeg auto-mapeia o pad como stream de saida extra (aparecem
    # vost#0:1, #0:2...) e o concat, que tentaria reconsumir os rotulos do split
    # ja gastos, nunca recebe frame -- o encode morre em "Could not open encoder
    # before EOF". Medido em 24/08/2026.
    saidas = [f"{r}o" for r in rotulos]
    for rot, sai_peca, peca in zip(rotulos, saidas, pecas):
        grafico.append(f"{_col(rot)}{peca}{_col(sai_peca)}")
    saida = f"{base}_fxs"
    grafico.append(
        "".join(_col(s) for s in saidas) + f"concat=n={n}:v=1:a=0{_col(saida)}"
    )
    return [], grafico, saida


# ---------------------------------------------------------------------------
# Cadeia de um clipe
# ---------------------------------------------------------------------------

def cadeia_clipe(clipe, seq, escopo, rotulo_entrada, rotulo_saida,
                 delta_tempo: float = 0.0, duracao_stream: Optional[float] = None,
                 deslocamento_camada: Optional[float] = None,
                 tpad_start_s: float = 0.0, tpad_stop_s: float = 0.0
                 ) -> Tuple[str, Tuple[float, float]]:
    """Um clipe -> trecho de filter_complex que consome `rotulo_entrada` e
    produz `rotulo_saida`, mais o offset (x, y) do overlay NA MOLDURA.

    `delta_tempo`: segundos ja cortados do COMECO do clipe pela faixa de render
    (fade/KB continuam medindo desde o inicio original, como o player).
    `duracao_stream`: duracao decodificada; default = restante do clipe.
    `deslocamento_camada`: se informado, fecha a cadeia com
    `setpts=PTS+<deslocamento>/TB` para o clipe entrar no instante certo.
    """
    w, h = int(seq.largura), int(seq.altura)
    ent = _col(rotulo_entrada)
    sai = _col(rotulo_saida)
    # Base dos rotulos DERIVADOS (_pre, _fx0, _fxm...). O rotulo de entrada e um
    # indice de input real ("[0:v]"), e dois-pontos nao pode aparecer em NOME de
    # rotulo -- "0:v_pre" quebra o parser. Trocado por underscore.
    base_lbl = _sem_colchete(ent).replace(":", "_")
    delta = max(float(delta_tempo or 0.0), 0.0)
    dur_clipe = clipe.duracao_s
    dur_stream = float(duracao_stream) if duracao_stream else max(dur_clipe - delta, _EPS_TEMPO)

    # ---- blocos (mesmo ponto trata escopo e disabled) ---------------------
    bloco_tf = _bloco_ativo(clipe, "transform") if escopo.efeito_ligado("transform") else None
    bloco_cor = _bloco_ativo(clipe, "color") if escopo.efeito_ligado("color") else None
    bloco_crop = _bloco_ativo(clipe, "crop") if escopo.efeito_ligado("crop") else None
    # P6: ken_burns so existe para foto; em video o bloco e ignorado.
    bloco_kb = (_bloco_ativo(clipe, "ken_burns")
                if (clipe.e_foto and escopo.efeito_ligado("ken_burns")) else None)
    # Paridade bruta com player.js:2166-2168: fit NAO testa disabled.
    # Sem bloco o padrao NLE e "fit" (contain), igual ao player atualizado.
    bloco_fit = clipe.efeito("fit", incluir_bypass=True) if escopo.efeito_ligado("fit") else None
    modo_fit = str((bloco_fit or {}).get("mode") or "fit")

    linear: List[str] = []
    declaracoes: List[str] = []

    if not clipe.e_foto and not clipe.e_color_matte:
        # Video chega com -ss antes do -i: garantir base temporal em zero para
        # os st/expressoes de fade e KB.
        linear.append("setpts=PTS-STARTPTS")
        if clipe.congelado:
            # Freeze frame: a entrada traz so o quadro do congelamento; ele se repete
            # pela duracao do trecho (medido: 91 quadros identicos em 3 s a 30 fps).
            linear.append("trim=end_frame=1")
            linear.append(f"tpad=stop_mode=clone:stop_duration={_n(dur_stream)}")
        # Retime ANTES de tudo: daqui em diante o stream esta no tempo da
        # TIMELINE, e fades/KB/deslocamento medem como no player. A entrada ja
        # traz o trecho da fonte certo (Clipe.trecho_fonte); `reverse` inverte
        # esse trecho e o setpts o encaixa na duracao da timeline.
        if clipe.reverso:
            linear.append("reverse")
        if abs(clipe.velocidade - 1.0) > 1e-9:
            linear.append(f"setpts={_n(1.0 / clipe.velocidade)}*PTS")
        if tpad_start_s > _EPS_TEMPO:
            linear.append(f"tpad=start_mode=clone:start_duration={_n(tpad_start_s)}")
        if tpad_stop_s > _EPS_TEMPO:
            linear.append(f"tpad=stop_mode=clone:stop_duration={_n(tpad_stop_s)}")
    linear.append("format=rgba")
    linear.extend(geometria.filtro_fit(modo_fit, w, h))
    linear.extend(cor.cadeia_cor(bloco_cor))

    # ---- alfa -------------------------------------------------------------
    opacidade = _num(bloco_tf, "opacity", 1.0)
    inline_alfa, grafico_alfa, saida_alfa = _montar_alfa(
        clipe, escopo, delta, dur_clipe, dur_stream, opacidade,
        rotulo_base=base_lbl,
    )

    # ATENCAO: `atual` e SEMPRE um rotulo entre colchetes. O primeiro filtro cola
    # nele SEM virgula -- "[rot],filtro" cria um filtro vazio e o ffmpeg recusa o
    # grafo inteiro com "No such filter: ''" (medido em 24/08/2026).
    atual = ent
    if grafico_alfa:
        if linear:
            rot_pre = f"{base_lbl}_pre"
            declaracoes.append(f"{atual}{','.join(linear)}{_col(rot_pre)}")
            atual = _col(rot_pre)
            linear = []
        primeiro, resto = grafico_alfa[0], grafico_alfa[1:]
        declaracoes.append(f"{atual}{primeiro}")
        declaracoes.extend(resto)
        atual = _col(saida_alfa)
    else:
        linear.extend(inline_alfa)

    # ---- crop ANTES do transform (ordem CSS 4 -> 5) -----------------------
    if bloco_crop:
        linear.extend(geometria.filtros_crop(
            _num(bloco_crop, "top", 0.0), _num(bloco_crop, "right", 0.0),
            _num(bloco_crop, "bottom", 0.0), _num(bloco_crop, "left", 0.0), w, h,
        ))

    # ---- transform / ken burns -------------------------------------------
    offset: Tuple[float, float] = (0.0, 0.0)
    rotacao = _num(bloco_tf, "rotation", 0.0)
    if bloco_kb:
        # KB substitui scale/x/y; rotation (aqui) e opacity (no alfa) continuam
        # vindo do transform, igual ao player.js:2189-2202.
        linear.extend(geometria.filtros_ken_burns(
            bloco_kb, dur_clipe, delta, w, h, rotacao_graus=rotacao,
            fps=float(seq.fps),
        ))
    elif bloco_tf:
        s = _num(bloco_tf, "scale", 1.0)
        tx = _num(bloco_tf, "x", 0.0)
        ty = _num(bloco_tf, "y", 0.0)
        if not geometria.transform_neutra(s, tx, ty, rotacao):
            filtros_tf, offset = geometria.filtros_transform(s, tx, ty, rotacao, w, h)
            linear.extend(filtros_tf)

    if deslocamento_camada is not None and abs(float(deslocamento_camada)) > 0:
        # round(): o setpts TRUNCA o resultado. Na cor solida o time base e
        # 1/fps, e 1.033333333 s a 30 fps virava 30,99999 -> quadro 30, um
        # quadro adiantado (fade e fim do clipe deslocados).
        linear.append(f"setpts=PTS+round({_n(deslocamento_camada)}/TB)")

    # Sem filtro nenhum o rotulo de entrada encostaria no de saida ("[a][b]"),
    # que tambem e grafo invalido: `null` e a passagem explicita.
    cauda = ",".join(linear) if linear else "null"
    declaracoes.append(f"{atual}{cauda}{sai}")
    return ";".join(declaracoes), offset


# ---------------------------------------------------------------------------
# Camada de pista e grafo completo
# ---------------------------------------------------------------------------

_TOLERANCIA_CORTE_S = 0.1


def _numero(valor: Any, padrao: float) -> float:
    try:
        v = float(valor)
    except (TypeError, ValueError):
        return float(padrao)
    if v != v or v in (float("inf"), float("-inf")):
        return float(padrao)
    return v


def _transicoes_da_pista(clipes: List[Any],
                         escopo: Any) -> List[Tuple[Any, List[Dict[str, Any]]]]:
    """Emparelha os dois lados de cada transição de vídeo da pista.

    Reaplica a arquitetura de grafo_audio:
    - Clipe A (sai): estende temporalmente até corte + halfB.
    - Clipe B (entra): recua temporalmente até corte - halfA.
    - Se não houver folga de mídia na fonte ou hard_boundaries estiver ativo:
      usa tpad=clone para congelar os quadros de borda.
    """
    lados: Dict[str, Dict[str, Tuple[int, Dict[str, Any]]]] = {}
    if escopo.efeito_ligado("crossfade"):
        for i, c in enumerate(clipes):
            for ef in c.effects:
                if not isinstance(ef, dict) or ef.get("disabled") or not ef.get("transitionId"):
                    continue
                tipo_ef = str(ef.get("type") or "").lower()
                if tipo_ef not in ("crossfade", "video_cross_dissolve", "video_dip_black", "video_dip_white"):
                    continue
                lado = str(ef.get("side") or "").lower()
                if lado in ("in", "out"):
                    lados.setdefault(str(ef["transitionId"]), {})[lado] = (i, ef)

    por_indice: Dict[int, List[Dict[str, Any]]] = {}
    for tid, par in lados.items():
        if "out" not in par or "in" not in par:
            continue
        ia, ef_a = par["out"]
        ib, ef_b = par["in"]
        a = clipes[ia]
        b = clipes[ib]
        if ia == ib or abs(a.fim_s - b.inicio_s) > _TOLERANCIA_CORTE_S:
            continue
        corte = b.inicio_s
        half_a = min(max(0.0, _numero(ef_a.get("duration_s"), 0.0)), a.duracao_s, b.duracao_s)
        half_b = min(max(0.0, _numero(ef_b.get("duration_s"), 0.0)), b.duracao_s, a.duracao_s)
        if half_a + half_b <= _EPS_TEMPO:
            continue

        tipo_trans = str(ef_a.get("transitionType") or ef_b.get("transitionType") or ef_a.get("type") or "video_cross_dissolve").lower()

        if tipo_trans == "video_dip_black":
            base = {
                "inicio_s": corte - half_a,
                "span_s": half_a + half_b,
                "curve": str(ef_a.get("curve") or "linear"),
                "tension": _numero(ef_a.get("tension"), 0.0),
                "type": tipo_trans,
                "half_a": half_a,
                "half_b": half_b,
                "estende_ini_s": 0.0,
                "estende_fim_s": 0.0,
                "extensao_midia_ini_s": 0.0,
                "extensao_midia_fim_s": 0.0,
                "tpad_start_s": 0.0,
                "tpad_stop_s": 0.0,
            }
            por_indice.setdefault(ia, []).append({**base, "papel": "sai"})
            por_indice.setdefault(ib, []).append({**base, "papel": "entra"})
            continue

        # Cross Dissolve / Dip to White
        # 1. Folga para B (cabeça)
        if getattr(b, "hard_boundaries", False) or b.reverso:
            folga_b = 0.0
        elif b.e_foto or b.e_color_matte or b.congelado:
            folga_b = half_a
        else:
            folga_b = b.in_s / b.velocidade

        ext_midia_b = min(half_a, max(0.0, folga_b))
        tpad_start_b = half_a - ext_midia_b

        # 2. Folga para A (cauda)
        if getattr(a, "hard_boundaries", False) or a.reverso:
            folga_a = 0.0
        elif a.e_foto or a.e_color_matte or a.congelado:
            folga_a = half_b
        elif getattr(a, "duracao_midia_s", None) is not None:
            folga_a = max(0.0, a.duracao_midia_s - a.out_s) / a.velocidade
        else:
            folga_a = half_b

        ext_midia_a = min(half_b, max(0.0, folga_a))
        tpad_stop_a = half_b - ext_midia_a

        base = {
            "inicio_s": corte - half_a,
            "span_s": half_a + half_b,
            "curve": str(ef_a.get("curve") or "linear"),
            "tension": _numero(ef_a.get("tension"), 0.0),
            "type": tipo_trans,
            "half_a": half_a,
            "half_b": half_b,
        }
        por_indice.setdefault(ia, []).append({
            **base,
            "papel": "sai",
            "estende_ini_s": 0.0,
            "estende_fim_s": half_b,
            "extensao_midia_ini_s": 0.0,
            "extensao_midia_fim_s": ext_midia_a,
            "tpad_start_s": 0.0,
            "tpad_stop_s": tpad_stop_a,
        })
        por_indice.setdefault(ib, []).append({
            **base,
            "papel": "entra",
            "estende_ini_s": half_a,
            "estende_fim_s": 0.0,
            "extensao_midia_ini_s": ext_midia_b,
            "extensao_midia_fim_s": 0.0,
            "tpad_start_s": tpad_start_b,
            "tpad_stop_s": 0.0,
        })

    return [(c, por_indice.get(i, [])) for i, c in enumerate(clipes)]


def _estender(clipe: Any, transicoes: List[Dict[str, Any]]) -> Tuple[Any, float, float]:
    """Alonga o clipe para cobrir as janelas de transição e sintetiza os fades.

    Devolve (clipe_estendido, tpad_start_s, tpad_stop_s).
    """
    ini = max((t["estende_ini_s"] for t in transicoes), default=0.0)
    fim = max((t["estende_fim_s"] for t in transicoes), default=0.0)
    tpad_start = max((t.get("tpad_start_s", 0.0) for t in transicoes), default=0.0)
    tpad_stop = max((t.get("tpad_stop_s", 0.0) for t in transicoes), default=0.0)
    ext_ini = max((t.get("extensao_midia_ini_s", 0.0) for t in transicoes), default=0.0)
    ext_fim = max((t.get("extensao_midia_fim_s", 0.0) for t in transicoes), default=0.0)

    import dataclasses
    novos_efeitos = []
    for ef in clipe.effects:
        if isinstance(ef, dict) and ef.get("transitionId"):
            continue
        novos_efeitos.append(ef)

    for t in transicoes:
        if t["papel"] == "entra" and t.get("type", "video_cross_dissolve") != "video_dip_black":
            # Clipe B dissolve suavemente por cima do Clipe A ao longo de todo o envelope
            novos_efeitos.append({
                "type": "crossfade",
                "side": "in",
                "duration_s": t["span_s"],
                "curve": t.get("curve", "linear"),
                "tension": t.get("tension", 0.0),
                "is_transition": True,
                "disabled": False,
            })
        elif t.get("type") == "video_dip_black":
            lado = "out" if t["papel"] == "sai" else "in"
            dur = t["half_a"] if t["papel"] == "sai" else t["half_b"]
            novos_efeitos.append({
                "type": "crossfade",
                "side": lado,
                "duration_s": dur,
                "curve": t.get("curve", "linear"),
                "tension": t.get("tension", 0.0),
                "is_transition": True,
                "disabled": False,
            })

    if ini <= _EPS_TEMPO and fim <= _EPS_TEMPO:
        return dataclasses.replace(clipe, effects=novos_efeitos), tpad_start, tpad_stop

    v = clipe.velocidade
    mais_cedo, mais_tarde = (ext_fim * v, ext_ini * v) if clipe.reverso else (ext_ini * v, ext_fim * v)
    dur_timeline = clipe.duracao_s + ini + fim
    clipe_estendido = dataclasses.replace(
        clipe,
        inicio_s=clipe.inicio_s - ini,
        in_s=clipe.in_s - mais_cedo,
        out_s=clipe.out_s + mais_tarde,
        effects=novos_efeitos,
        duracao_timeline_s=dur_timeline,
    )
    return clipe_estendido, tpad_start, tpad_stop


def normalizar_cor_lavfi(cor: Optional[str]) -> str:
    """Normaliza representação de cor para o filtro lavfi color do FFmpeg (ex: 0xRRGGBB ou nome)."""
    if not cor:
        return "0x000000"
    s = str(cor).strip()
    hex_str = s.lstrip("#")
    if hex_str.lower().startswith("0x"):
        hex_str = hex_str[2:]
    if all(ch in "0123456789abcdefABCDEF" for ch in hex_str) and len(hex_str) in (3, 4, 6, 8):
        if len(hex_str) == 3:
            return "0x" + "".join(ch * 2 for ch in hex_str)
        if len(hex_str) == 4:
            return "0x" + "".join(ch * 2 for ch in hex_str)
        return "0x" + hex_str
    import re
    m_rgb = re.match(r"^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d\.]+))?\s*\)$", s, re.IGNORECASE)
    if m_rgb:
        r, g, b = int(m_rgb.group(1)), int(m_rgb.group(2)), int(m_rgb.group(3))
        r, g, b = max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b))
        if m_rgb.group(4) is not None:
            a = float(m_rgb.group(4))
            a_int = max(0, min(255, int(round(a * 255 if a <= 1.0 else a))))
            return f"0x{r:02X}{g:02X}{b:02X}{a_int:02X}"
        return f"0x{r:02X}{g:02X}{b:02X}"
    return s


def camada_pista(pista, clipes, seq, escopo, inicio_s: float, fim_s: float,
                 prefixo: str = "pista", indice_base: int = 0
                 ) -> Tuple[List[str], str, List[Dict[str, Any]], bool]:
    """Uma pista de video -> (declaracoes, rotulo_final, entradas, usada).

    A camada e um pad transparente W x H da duracao INTEIRA do render; cada
    clipe entra por overlay com enable. `entradas` segue o contrato combinado
    com o pacote C (campos extras documentados no docstring do modulo).
    """
    w, h = int(seq.largura), int(seq.altura)
    dur = float(fim_s) - float(inicio_s)
    base = f"{prefixo}_vazio"
    declaracoes = [
        f"color=c=black@0:s={w}x{h}:r={_n(seq.fps)}:d={_n(dur)}{_col(base)}"
    ]
    entradas: List[Dict[str, Any]] = []
    acumulado = base
    usada = False

    pares_com_trans = _transicoes_da_pista(clipes, escopo)
    for i, (c_orig, transicoes) in enumerate(pares_com_trans):
        if c_orig.e_ajuste:
            continue  # camadas de ajuste sao compostas no grafo_completo sobre o acumulado
        if mapear_blend_mode(c_orig.blend_mode) != "normal":
            # Mesclagem age sobre TUDO o que esta embaixo, nao sobre esta camada
            # transparente: grafo_completo compoe o clipe direto no acumulado.
            continue
        fonte = _fonte_do_clipe(
            c_orig, transicoes, pista, seq, escopo, inicio_s, fim_s,
            rotulo=f"{prefixo}c{i}", indice_entrada=indice_base + len(entradas),
        )
        if fonte is None:
            continue  # fora da faixa pedida
        usada = True
        declaracoes.extend(fonte["declaracoes"])
        ox, oy = fonte["offset"]
        loc, dur_total = fonte["loc"], fonte["dur"]

        depois = f"{prefixo}c{i}l"
        declaracoes.append(
            f"{_col(acumulado)}{_col(fonte['rotulo'])}"
            f"overlay=x={_n(ox)}:y={_n(oy)}:"
            f"{_enable_janela(loc, loc + dur_total, seq.fps)}"
            f"{_col(depois)}"
        )
        acumulado = depois
        if fonte["entrada"] is not None:
            entradas.append(fonte["entrada"])

    return declaracoes, acumulado, entradas, usada


def _fonte_do_clipe(c_orig, transicoes, pista, seq, escopo, inicio_s: float, fim_s: float,
                    rotulo: str, indice_entrada: int,
                    deslocamento: Optional[Callable[[float], float]] = None
                    ) -> Optional[Dict[str, Any]]:
    """Cadeia de um clipe de video, foto ou cor solida, pronta para compor.

    Devolve None quando o clipe nao toca a faixa pedida; senao um dict com
    `declaracoes`, `rotulo` (saida da cadeia), `offset` (x, y na moldura),
    `loc`/`dur` (janela no tempo do render) e `entrada` (o -i que a cadeia
    consome, ou None na cor solida, que nasce de um `color` no proprio grafo).

    `deslocamento(loc)` diz onde o clipe comeca no stream de destino; o padrao
    e `loc` (camada da pista, que tem a duracao inteira do render).
    """
    w, h = int(seq.largura), int(seq.altura)
    c, tpad_start_s, tpad_stop_s = _estender(c_orig, transicoes)
    ini = max(c.inicio_s, inicio_s)
    fim = min(c.fim_s, fim_s)
    if fim - ini <= _EPS_TEMPO:
        return None
    delta = ini - c.inicio_s          # pedaco aparado no comeco (regra P4 / render range)
    loc = ini - inicio_s              # instante do clipe DENTRO da camada
    dur_total = fim - ini
    desloc = deslocamento(loc) if deslocamento else loc

    # Determina quanto de tpad é ativo dentro da janela de render
    tpad_start_ativo = max(0.0, tpad_start_s - delta) if delta < tpad_start_s else 0.0
    delta_midia = max(0.0, delta - tpad_start_s)
    tpad_stop_ativo = max(0.0, tpad_stop_s - max(0.0, c.fim_s - fim))
    dur_midia = max(0.0, dur_total - tpad_start_ativo - tpad_stop_ativo)

    declaracoes: List[str] = []
    sai = f"{rotulo}s"
    if c.e_color_matte:
        rot_cor = f"{rotulo}_cor"
        declaracoes.append(
            f"color=c={normalizar_cor_lavfi(c.cor)}:s={w}x{h}:r={_n(seq.fps)}:"
            f"d={_n(dur_total)}{_col(rot_cor)}"
        )
        cadeia, offset = cadeia_clipe(
            c, seq, escopo, _col(rot_cor), _col(sai),
            delta_tempo=delta, duracao_stream=dur_total,
            deslocamento_camada=desloc,
        )
        declaracoes.append(cadeia)
        return {"declaracoes": declaracoes, "rotulo": sai, "offset": offset,
                "loc": loc, "dur": dur_total, "entrada": None}

    # O rotulo de entrada e o INDICE REAL do input, nao um simbolo: o k-esimo
    # item de `entradas` vira o k-esimo -i do lado do pacote C, e o grafo tem
    # de apontar para ele como "[N:v]". Com rotulo simbolico o ffmpeg trata o
    # pad como desconectado, inventa streams de saida soltos e o encode morre
    # com "Could not open encoder before EOF" (medido em 24/08/2026).
    ent = f"{indice_entrada}:v"
    cadeia, offset = cadeia_clipe(
        c, seq, escopo, _col(ent), _col(sai),
        delta_tempo=delta, duracao_stream=dur_total,
        deslocamento_camada=desloc,
        tpad_start_s=tpad_start_ativo,
        tpad_stop_s=tpad_stop_ativo,
    )
    declaracoes.append(cadeia)

    # Trecho da FONTE que cobre a janela (velocidade e reverso inclusos).
    if dur_midia > _EPS_TEMPO:
        ss_fonte, t_fonte = c.trecho_fonte(delta_midia, dur_midia)
    else:
        ss_fonte, t_fonte = c.trecho_fonte(0.0, modelo.JANELA_QUADRO_CONGELADO_S)

    entrada = {
        "tipo": "foto" if c.e_foto else "video",
        "caminho": None,             # midia.py resolve; ver docstring
        "ss": round(ss_fonte, 6),
        "t": round(t_fonte, 6),
        "loop": bool(c.e_foto),
        "clipe_id": c.id,
        "video_id": c.video_id,
        "photo_id": c.photo_id,
        "pista_id": pista.id,
    }
    return {"declaracoes": declaracoes, "rotulo": sai, "offset": offset,
            "loc": loc, "dur": dur_total, "entrada": entrada}


# ---------------------------------------------------------------------------
# Mesclagem (blend mode): composicao numa janela do acumulado
# ---------------------------------------------------------------------------

def _compor_em_janela(acumulado: str, loc: float, dur: float, dur_render: float,
                      fps: float, pfx: str,
                      corpo: Callable[[str, float, float], Tuple[List[str], str]]
                      ) -> Tuple[List[str], str]:
    """Reprocessa so a janela [loc, loc + dur] do acumulado e devolve o novo.

    O acumulado e partido em cabeca | janela | cauda (trim) e remontado com
    concat. So a janela passa pelo `corpo`; o resto segue intocado, sem
    conversao de formato. Os pedacos andam juntos: o concat consome a cabeca
    enquanto os outros trims descartam os mesmos quadros, entao nada se acumula
    na memoria -- ao contrario de split + trim + overlay de volta, em que o
    framesync do overlay segura todos os quadros ate o comeco da janela.

    `corpo(rotulo_janela, inicio_relativo, duracao_clipe, duracao_janela)`
    recebe a janela com o tempo zerado (0 = inicio da janela), devolve
    (declaracoes, rotulo) e precisa entregar a MESMA quantidade de quadros.
    `inicio_relativo` e onde o clipe comeca dentro da janela (0, salvo quando a
    cabeca foi absorvida).

    Pedaco de 1 quadro no concat estraga o relogio (ffmpeg 5.1 estima a
    duracao do segmento pela media dos intervalos: com 1 quadro da zero, o
    quadro seguinte repete o PTS e tudo depois atrasa um quadro). Por isso
    cabeca curta demais entra na janela, e janela curta demais engole a cauda.
    """
    fps = float(fps)
    q = lambda s: int(round(float(s) * fps))   # noqa: E731 -- quadro do grid do render
    ws, we = float(loc), float(loc) + float(dur)
    if q(ws) < 2:
        ws = 0.0
    tem_cauda = q(dur_render) - q(we) >= 1
    if tem_cauda and q(we) - q(ws) < 2:
        tem_cauda = False
    if not tem_cauda:
        we = float(dur_render)

    declaracoes: List[str] = []
    pecas: List[str] = []
    rot_janela = f"{pfx}_jan"
    if ws > 0.0 or tem_cauda:
        saidas = ([f"{pfx}_p0"] if ws > 0.0 else []) + [f"{pfx}_p1"] + (
            [f"{pfx}_p2"] if tem_cauda else [])
        declaracoes.append(f"{_col(acumulado)}split={len(saidas)}" + "".join(_col(s) for s in saidas))
        if ws > 0.0:
            declaracoes.append(f"[{pfx}_p0]trim=end={_n(ws)},setpts=PTS-STARTPTS[{pfx}_q0]")
            pecas.append(f"{pfx}_q0")
        limites = []
        if ws > 0.0:
            limites.append(f"start={_n(ws)}")
        if tem_cauda:
            limites.append(f"end={_n(we)}")
        declaracoes.append(
            f"[{pfx}_p1]trim={':'.join(limites)},setpts=PTS-STARTPTS{_col(rot_janela)}")
    else:
        declaracoes.append(f"{_col(acumulado)}setpts=PTS-STARTPTS{_col(rot_janela)}")

    linhas, rot_corpo = corpo(rot_janela, float(loc) - ws, float(dur), we - ws)
    declaracoes.extend(linhas)
    pecas.append(_sem_colchete(rot_corpo))

    if tem_cauda:
        declaracoes.append(f"[{pfx}_p2]trim=start={_n(we)},setpts=PTS-STARTPTS[{pfx}_q2]")
        pecas.append(f"{pfx}_q2")

    # O concat devolve o relogio em microssegundos; as camadas de cima compoem
    # por PTS contra fontes em 1/fps, e um arredondamento de 1 us ali ja pegaria
    # o quadro anterior. settb devolve o mesmo time base do `color` de fundo.
    saida = f"{pfx}_out"
    junta = (f"concat=n={len(pecas)}:v=1:a=0," if len(pecas) > 1 else "")
    declaracoes.append(
        "".join(_col(p) for p in pecas) + f"{junta}settb=expr=1/{_n(fps)}{_col(saida)}"
    )
    return declaracoes, saida


def _corpo_blend(modo: str, pfx: str, fps: float, fonte_rgba, copia_do_fundo: bool = False):
    """Corpo de janela que mescla a fonte sobre o fundo como o navegador.

    fundo -> gbrap; fonte (tela cheia, com alfa) -> gbrap; lut2 com a formula
    do modo nas cores e o alfa da fonte; overlay do resultado sobre o fundo:
    (1 - a) * fundo + a * B(fundo, fonte). Tudo em RGB: em YUV o multiply
    multiplica croma e a cor desanda.

    `fonte_rgba(ini_rel, dur_clipe, dur_jan, rotulo_copia)` monta a fonte;
    com `copia_do_fundo` ela recebe uma terceira copia da janela (camada de
    ajuste, cuja fonte e o proprio fundo filtrado). O overlay final so vale na
    duracao do clipe: quando a janela absorveu cabeca ou cauda, o resto passa.
    """
    def corpo(rot_janela: str, ini_rel: float, dur_clipe: float, dur_jan: float):
        n = 3 if copia_do_fundo else 2
        linhas = [f"{_col(rot_janela)}split={n}[{pfx}_w1][{pfx}_w2]"
                  + (f"[{pfx}_w3]" if copia_do_fundo else ""),
                  f"[{pfx}_w1]format=gbrap[{pfx}_bd]"]
        fonte_linhas, rot_fonte = fonte_rgba(
            ini_rel, dur_clipe, dur_jan, f"{pfx}_w3" if copia_do_fundo else None)
        linhas.extend(fonte_linhas)
        linhas.append(f"[{pfx}_bd]{_col(rot_fonte)}{_filtro_lut2_blend(modo)}[{pfx}_bl]")
        linhas.append(
            f"[{pfx}_w2][{pfx}_bl]overlay=x=0:y=0:eof_action=pass:"
            f"{_enable_janela(ini_rel, ini_rel + dur_clipe, fps)},"
            f"format=yuv420p[{pfx}_mix]")
        return linhas, f"{pfx}_mix"
    return corpo


def compor_clipe_com_blend(c_orig, transicoes, pista, seq, escopo, acumulado: str,
                           inicio_s: float, fim_s: float, pfx: str, indice_entrada: int
                           ) -> Optional[Tuple[List[str], str, Optional[Dict[str, Any]]]]:
    """Clipe com mix-blend-mode -> (declaracoes, novo_acumulado, entrada).

    O fundo e tudo o que ja foi composto (pistas de baixo sobre o preto), o
    mesmo backdrop do player. O clipe e posto numa tela transparente do
    tamanho do quadro (transform/crop/fit inclusos) que cobre a janela inteira,
    entao fora do clipe o alfa e zero e o fundo passa intacto.
    """
    w, h = int(seq.largura), int(seq.altura)
    modo = mapear_blend_mode(c_orig.blend_mode)
    dur_render = float(fim_s) - float(inicio_s)

    # Sonda da janela: a cadeia de verdade so e montada dentro do corpo, quando
    # ja se sabe quanto do comeco da janela a cabeca absorvida ocupa.
    previa = _fonte_do_clipe(c_orig, transicoes, pista, seq, escopo, inicio_s, fim_s,
                             rotulo=f"{pfx}c", indice_entrada=indice_entrada)
    if previa is None:
        return None
    resultado: Dict[str, Any] = {}

    def fonte_rgba(ini_rel: float, _dur_clipe: float, dur_jan: float, _copia):
        fonte = _fonte_do_clipe(
            c_orig, transicoes, pista, seq, escopo, inicio_s, fim_s,
            rotulo=f"{pfx}c", indice_entrada=indice_entrada,
            deslocamento=lambda _loc: ini_rel,
        )
        resultado["entrada"] = fonte["entrada"]
        ox, oy = fonte["offset"]
        linhas = list(fonte["declaracoes"])
        # Tela um quadro mais longa que a janela: o lut2 nunca fica sem par.
        linhas.append(
            f"color=c=black@0:s={w}x{h}:r={_n(seq.fps)}:"
            f"d={_n(dur_jan + 1.0 / float(seq.fps))}[{pfx}_tela]")
        linhas.append(
            f"[{pfx}_tela]{_col(fonte['rotulo'])}overlay=x={_n(ox)}:y={_n(oy)}:"
            f"format=gbrp:eof_action=pass,format=gbrap[{pfx}_fonte]")
        return linhas, f"{pfx}_fonte"

    declaracoes, saida = _compor_em_janela(
        acumulado, previa["loc"], previa["dur"], dur_render, float(seq.fps), pfx,
        _corpo_blend(modo, pfx, float(seq.fps), fonte_rgba),
    )
    return declaracoes, saida, resultado.get("entrada")


def _cadeia_ajuste(c, escopo, rot_entrada: str, rot_saida: str, delta: float,
                   dur_stream: float, w: int, h: int, pfx: str) -> List[str]:
    """Filtros da camada de ajuste sobre uma copia do fundo: cor, alfa, crop.

    `delta` segue a convencao de `_montar_alfa` (segundos do clipe ja passados
    no inicio do stream); negativo = o stream comeca ANTES do clipe.
    """
    bloco_cor = _bloco_ativo(c, "color") if escopo.efeito_ligado("color") else None
    bloco_crop = _bloco_ativo(c, "crop") if escopo.efeito_ligado("crop") else None
    bloco_tf = _bloco_ativo(c, "transform") if escopo.efeito_ligado("transform") else None

    declaracoes: List[str] = []
    filtros_adj = ["format=rgba"]
    if bloco_cor:
        filtros_adj.extend(cor.cadeia_cor(bloco_cor))

    opacidade = _num(bloco_tf, "opacity", 1.0)
    inline_alfa, grafico_alfa, saida_alfa = _montar_alfa(
        c, escopo, delta, c.duracao_s, dur_stream, opacidade, rotulo_base=pfx
    )
    atual_adj = _col(rot_entrada)
    if grafico_alfa:
        if filtros_adj:
            rot_pre = f"{pfx}_pre"
            declaracoes.append(f"{atual_adj}{','.join(filtros_adj)}{_col(rot_pre)}")
            atual_adj = _col(rot_pre)
            filtros_adj = []
        declaracoes.append(f"{atual_adj}{grafico_alfa[0]}")
        declaracoes.extend(grafico_alfa[1:])
        atual_adj = _col(saida_alfa)
    else:
        filtros_adj.extend(inline_alfa)

    if bloco_crop:
        filtros_adj.extend(geometria.filtros_crop(
            _num(bloco_crop, "top", 0.0), _num(bloco_crop, "right", 0.0),
            _num(bloco_crop, "bottom", 0.0), _num(bloco_crop, "left", 0.0), w, h,
        ))

    cauda_adj = ",".join(filtros_adj) if filtros_adj else "null"
    declaracoes.append(f"{atual_adj}{cauda_adj}{_col(rot_saida)}")
    return declaracoes


def grafo_completo(seq, escopo, inicio_s: float, fim_s: float,
                   indice_base: int = 0) -> Dict[str, Any]:
    """Sequencia inteira -> dict {"filter_complex", "entradas", "rotulo_video"}.

    Cada item de `entradas` vira um -i do lado do pacote C (com -ss/-t/-loop),
    NA ORDEM: o k-esimo item corresponde ao k-esimo input usado no grafo.
    """
    inicio = float(inicio_s)
    fim = float(fim_s)
    if fim - inicio <= _EPS_TEMPO:
        raise ValueError("faixa de render vazia: fim precisa vir depois do inicio.")

    w, h = int(seq.largura), int(seq.altura)
    dur = fim - inicio
    declaracoes: List[str] = [
        f"color=c=black:s={w}x{h}:r={_n(seq.fps)}:d={_n(dur)}[_fundo]"
    ]
    entradas: List[Dict[str, Any]] = []
    acumulado = "_fundo"

    # pistas_video() = topo->fundo; a composicao desenha do fundo para a frente.
    for indice, pista in enumerate(reversed(seq.pistas_video())):
        if not escopo.pista_ligada(pista.id):
            continue  # escolha do editor no escopo do render
        clipes = seq.clipes_da_pista(pista.id)   # regra P4 aplicada aqui
        prefixo = f"t{indice}"

        # 1. Clipes regulares (vídeo, foto, color_matte) na camada da pista
        clipes_camada = [c for c in clipes if not c.e_ajuste]
        if clipes_camada:
            linhas, rotulo, ents, usada = camada_pista(
                pista, clipes_camada, seq, escopo, inicio, fim, prefixo=prefixo,
                indice_base=indice_base + len(entradas),
            )
            if usada:
                declaracoes.extend(linhas)
                entradas.extend(ents)
                depois = f"_apos_t{indice}"
                declaracoes.append(
                    f"{_col(acumulado)}{_col(rotulo)}overlay=x=0:y=0{_col(depois)}"
                )
                acumulado = depois

            # Clipes com mix-blend-mode: cada um mescla com TUDO o que esta
            # embaixo (pistas inferiores e o resto desta), como no player.
            pares = _transicoes_da_pista(clipes_camada, escopo)
            for bi, (c_orig, transicoes) in enumerate(pares):
                if mapear_blend_mode(c_orig.blend_mode) == "normal":
                    continue
                composto = compor_clipe_com_blend(
                    c_orig, transicoes, pista, seq, escopo, acumulado, inicio, fim,
                    pfx=f"{prefixo}_bl{bi}",
                    indice_entrada=indice_base + len(entradas),
                )
                if composto is None:
                    continue  # fora da faixa pedida
                linhas_bl, acumulado, entrada_bl = composto
                declaracoes.extend(linhas_bl)
                if entrada_bl is not None:
                    entradas.append(entrada_bl)

        # 2. Camadas de ajuste (Adjustment Layer) propagam efeitos sobre o fluxo acumulado inferior
        clipes_ajuste = [c for c in clipes if c.e_ajuste]
        for ai, c in enumerate(clipes_ajuste):
            ini = max(c.inicio_s, inicio)
            fim_c = min(c.fim_s, fim)
            if fim_c - ini <= _EPS_TEMPO:
                continue
            dur_adj = fim_c - ini
            loc = ini - inicio
            delta = ini - c.inicio_s
            adj_pfx = f"{prefixo}_adj{ai}"

            modo_blend = mapear_blend_mode(c.blend_mode)
            if modo_blend != "normal":
                # backdrop-filter + mix-blend-mode: a fonte e o proprio fundo
                # filtrado, mesclado de volta sobre ele so na janela da camada.
                def fonte_ajuste(ini_rel, _dur_clipe, dur_jan, rot_copia,
                                 c=c, delta=delta, adj_pfx=adj_pfx):
                    linhas_aj = _cadeia_ajuste(
                        c, escopo, rot_copia, f"{adj_pfx}_out",
                        delta - ini_rel, dur_jan, w, h, adj_pfx)
                    linhas_aj.append(f"[{adj_pfx}_out]format=gbrap[{adj_pfx}_fonte]")
                    return linhas_aj, f"{adj_pfx}_fonte"

                linhas_aj, acumulado = _compor_em_janela(
                    acumulado, loc, dur_adj, dur, float(seq.fps), adj_pfx,
                    _corpo_blend(modo_blend, adj_pfx, float(seq.fps), fonte_ajuste,
                                 copia_do_fundo=True),
                )
                declaracoes.extend(linhas_aj)
                continue

            base_split = f"{adj_pfx}_base"
            in_split = f"{adj_pfx}_in"
            out_adj = f"{adj_pfx}_out"
            declaracoes.append(f"{_col(acumulado)}split{_col(base_split)}{_col(in_split)}")
            # A copia tem a duracao INTEIRA do render (t=0 no inicio do render),
            # entao o relogio do fade comeca `loc` segundos antes da camada.
            declaracoes.extend(_cadeia_ajuste(
                c, escopo, in_split, out_adj, delta - loc, dur, w, h, adj_pfx))

            depois_adj = f"_apos_{adj_pfx}"
            declaracoes.append(
                f"{_col(base_split)}{_col(out_adj)}overlay=x=0:y=0:"
                f"{_enable_janela(loc, loc + dur_adj, seq.fps)}{_col(depois_adj)}"
            )
            acumulado = depois_adj

    declaracoes.append(f"{_col(acumulado)}null[vout]")
    return {
        "filter_complex": ";\n".join(declaracoes),
        "entradas": entradas,
        "rotulo_video": "[vout]",
    }
