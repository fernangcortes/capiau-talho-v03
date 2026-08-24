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
from typing import Any, Dict, List, Optional, Tuple

from . import cor, fade, geometria

_EPS_TEMPO = 1e-6


def _n(valor: float) -> str:
    texto = f"{float(valor):.9f}".rstrip("0").rstrip(".")
    if texto in ("", "-", "-0"):
        return "0"
    return texto


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

    efeitos_cf = clipe.efeitos("crossfade") if escopo.efeito_ligado("crossfade") else []

    rampas: List[Tuple[str, float]] = []
    for cf in efeitos_cf:
        lado = str(cf.get("side") or "").strip().lower()
        if lado not in ("in", "out"):
            continue  # o player so trata esses dois lados
        rampas.append((lado, fade.normalizar_duracao(cf.get("duration_s"))))

    if not rampas:
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        return inline, grafico, ""

    # Janelas em tempo DE CLIPE; a sobreposicao decide atalho x geq (dois
    # fades `fade=` encadeados se MULTIPLICARIAM onde cruzam; o player faz min).
    janelas = sorted(
        (0.0, d) if lado == "in" else (dur_clipe - d, dur_clipe)
        for (lado, d) in rampas
    )
    sobrepoem = any(janelas[i + 1][0] < janelas[i][1] - 1e-9
                    for i in range(len(janelas) - 1))
    tudo_atalho = all(
        fade.usa_atalho_linear(cf.get("curve"), cf.get("tension"))
        for cf in efeitos_cf
    )

    if tudo_atalho and not sobrepoem:
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        for (lado, d) in rampas:
            if lado == "in":
                inline.append(f"fade=t=in:st={_n(delta)}:d={_n(d)}:alpha=1")
            else:
                # st pode dar negativo quando a faixa entra no meio do fade;
                # o filtro cobre (fica no meio-da-rampa em t=0), como na tela.
                inline.append(
                    f"fade=t=out:st={_n(dur_clipe - d - delta)}:d={_n(d)}:alpha=1"
                )
        return inline, grafico, ""

    # --- caminho geq -------------------------------------------------------
    lo = max(min(j[0] for j in janelas) - delta, 0.0)          # tempo de stream
    hi = max(min(max(j[1] for j in janelas) - delta, dur_stream), 0.0)

    if hi <= lo + _EPS_TEMPO:
        # O trecho renderizado nem alcaca a janela do fade.
        if not op_neutra:
            inline.append(f"colorchannelmixer=aa={_n(opacidade)}")
        return inline, grafico, ""

    termos: List[str] = []
    # ATENCAO: var_tempo="T" e MAIUSCULO no geq - medido no ffmpeg 7.1.4:
    # 't' minusculo da "Undefined constant". O docstring de fade.py sugere "t"
    # para geq; divergencia do contrato, contornada aqui sem editar o modulo
    # (o parametro existe justamente para isso). Relatado ao integrador.
    for cf in efeitos_cf:
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
                 deslocamento_camada: Optional[float] = None
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
    bloco_fit = clipe.efeito("fit", incluir_bypass=True) if escopo.efeito_ligado("fit") else None
    modo_fit = str((bloco_fit or {}).get("mode") or "fill")

    linear: List[str] = []
    declaracoes: List[str] = []

    if not clipe.e_foto:
        # Video chega com -ss antes do -i: garantir base temporal em zero para
        # os st/expressoes de fade e KB.
        linear.append("setpts=PTS-STARTPTS")
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
        linear.append(f"setpts=PTS+{_n(deslocamento_camada)}/TB")

    # Sem filtro nenhum o rotulo de entrada encostaria no de saida ("[a][b]"),
    # que tambem e grafo invalido: `null` e a passagem explicita.
    cauda = ",".join(linear) if linear else "null"
    declaracoes.append(f"{atual}{cauda}{sai}")
    return ";".join(declaracoes), offset


# ---------------------------------------------------------------------------
# Camada de pista e grafo completo
# ---------------------------------------------------------------------------

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

    for i, c in enumerate(clipes):
        ini = max(c.inicio_s, inicio_s)
        fim = min(c.fim_s, fim_s)
        if fim - ini <= _EPS_TEMPO:
            continue  # fora da faixa pedida
        usada = True
        delta = ini - c.inicio_s          # pedaco aparado no comeco (regra P4)
        loc = ini - inicio_s              # instante do clipe DENTRO da camada

        # O rotulo de entrada e o INDICE REAL do input, nao um simbolo: o k-esimo
        # item de `entradas` vira o k-esimo -i do lado do pacote C, e o grafo tem
        # de apontar para ele como "[N:v]". Com rotulo simbolico o ffmpeg trata o
        # pad como desconectado, inventa streams de saida soltos e o encode morre
        # com "Could not open encoder before EOF" (medido em 24/08/2026).
        ent = f"{indice_base + len(entradas)}:v"
        sai = f"{prefixo}c{i}s"
        cadeia, (ox, oy) = cadeia_clipe(
            c, seq, escopo, _col(ent), _col(sai),
            delta_tempo=delta, duracao_stream=fim - ini,
            deslocamento_camada=loc,
        )
        declaracoes.append(cadeia)

        depois = f"{prefixo}c{i}l"
        declaracoes.append(
            f"{_col(acumulado)}{_col(sai)}"
            f"overlay=x={_n(ox)}:y={_n(oy)}:"
            f"enable='between(t,{_n(loc)},{_n(loc + (fim - ini))})'"
            f"{_col(depois)}"
        )
        acumulado = depois

        entradas.append({
            "tipo": "foto" if c.e_foto else "video",
            "caminho": None,             # midia.py resolve; ver docstring
            "ss": round(c.in_s + delta, 6),
            "t": round(fim - ini, 6),
            "loop": bool(c.e_foto),
            "clipe_id": c.id,
            "video_id": c.video_id,
            "photo_id": c.photo_id,
            "pista_id": pista.id,
        })

    return declaracoes, acumulado, entradas, usada


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
        linhas, rotulo, ents, usada = camada_pista(
            pista, clipes, seq, escopo, inicio, fim, prefixo=prefixo,
            indice_base=indice_base + len(entradas),
        )
        if not usada:
            continue  # pista sem clipe na faixa: nem camada nem entradas
        declaracoes.extend(linhas)
        entradas.extend(ents)
        depois = f"_apos_t{indice}"
        declaracoes.append(
            f"{_col(acumulado)}{_col(rotulo)}overlay=x=0:y=0{_col(depois)}"
        )
        acumulado = depois

    declaracoes.append(f"{_col(acumulado)}null[vout]")
    return {
        "filter_complex": ";\n".join(declaracoes),
        "entradas": entradas,
        "rotulo_video": "[vout]",
    }
