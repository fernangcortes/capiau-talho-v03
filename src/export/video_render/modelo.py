"""Modelo do render: o `sequence_json` normalizado no que o motor precisa.

CONTRATO CONGELADO. Todos os pacotes (video, audio, midia, comando, execucao,
API) consomem estas estruturas; elas nao mudam sem revisao do dono do plano.

Duas fontes de verdade que este modulo reconcilia:

1. O que esta NO BANCO (`timeline.sequence_json`, formato v2 gravado por
   `ProjectRepository.save_timeline`): tempos em SEGUNDOS, posicao no campo
   `timeline_start`, mais `fps`, `width`, `height`, `tracks`, `clips`.
2. O que o PLAYER faz com isso em memoria (`src/ui/js/player.js`): tempos em
   FRAMES (`timelineStartFrame`, `inFrame`, `outFrame`).

O render le do banco (seconds) e deriva os frames com o fps da propria
sequencia. Nunca o contrario: o banco e a fonte, a tela e a consumidora.

REGRAS DE PARIDADE que este modulo cristaliza (todas medidas no player em
24/08/2026 -- mudar qualquer uma quebra a paridade com a tela):

  P1. Pista `kind == "ai"` NUNCA entra no render (mesma regra do export OTIO).
  P2. VIDEO sai so de pistas `kind == "video"`.
  P3. AUDIO sai so de pistas `kind == "audio"`. Os elementos <video> do player
      recebem `el.muted = true` (player.js:1925 e 2051): um clipe de video NAO
      contribui com o proprio audio. Quem toca e o clipe parceiro (`link_id`) na
      pista de audio. Somar o audio do clipe de video seria dobrar tudo.
  P4. Numa mesma pista, em cada instante toca UM clipe so. O player resolve
      sobreposicao com `cuts.find(...)`: vence o PRIMEIRO da lista `clips`, nao
      o de cima nem o mais recente. `resolver_sobreposicoes()` reproduz isso.
  P5. Efeito com `disabled: true` e BYPASS -- sai da cadeia, o clipe segue
      normal. Nunca vira mudo, preto ou zero.
  P6. `ken_burns` so tem efeito quando `cut.type == "photo"` (player.js:2190).
      Em clipe de video o bloco existe no JSON e e ignorado.
  P7. `hidden` na pista: o player so silencia/esconde quando a preferencia
      `muteHiddenTracksPlayback` esta ligada. No render isso vira o DEFAULT do
      escopo (desmarcado), nao uma regra do motor.
  P8. `locked` na pista nao afeta render nenhum: e trava de edicao, nao de
      visibilidade.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

FPS_PADRAO = 24.0
LARGURA_PADRAO = 1920
ALTURA_PADRAO = 1080

TIPO_DRAFT = "draft"
TIPO_MASTER = "master"
TIPOS_RENDER = (TIPO_DRAFT, TIPO_MASTER)

MODO_FAIXA_COMPLETA = "full"
MODO_FAIXA_IN_OUT = "in_out"

# Categorias de escopo expostas na UI (secao "Incluir no render").
CATEGORIA_COR = "color"
CATEGORIA_TRANSICOES = "transitions"
CATEGORIA_MOVIMENTO = "motion"
CATEGORIA_AUDIO_FX = "audio_fx"
CATEGORIAS = (CATEGORIA_COR, CATEGORIA_TRANSICOES, CATEGORIA_MOVIMENTO, CATEGORIA_AUDIO_FX)

# Quais tipos de efeito cada categoria liga/desliga. Desligar uma categoria e
# escolha criativa do editor: o efeito sai da cadeia SEM aviso (o aviso e so
# para limitacao do motor -- ver fidelidade.py).
EFEITOS_POR_CATEGORIA = {
    CATEGORIA_COR:        ("color",),
    CATEGORIA_TRANSICOES: ("crossfade",),
    CATEGORIA_MOVIMENTO:  ("fit", "transform", "crop", "ken_burns"),
    CATEGORIA_AUDIO_FX:   ("audio_eq", "audio_dynamics", "volume"),
}


# ---------------------------------------------------------------------------
# Estruturas
# ---------------------------------------------------------------------------

@dataclass
class Pista:
    """Uma pista da timeline, com o que o render precisa saber dela."""
    id: str
    nome: str
    kind: str               # "video" | "audio" | "ai" | (futuro: "text")
    volume: float = 1.0
    muted: bool = False
    hidden: bool = False
    locked: bool = False
    ordem: int = 0          # menor = mais acima na tela = mais na frente na composicao

    @property
    def e_video(self) -> bool:
        return self.kind == "video"

    @property
    def e_audio(self) -> bool:
        return self.kind == "audio"

    @property
    def e_ia(self) -> bool:
        return self.kind == "ai"


@dataclass
class Clipe:
    """Um corte posicionado na timeline, com tempos ja em segundos."""
    id: str
    tipo: str                        # "video" | "photo"
    track: str
    inicio_s: float                  # posicao na timeline (timeline_start)
    in_s: float                      # ponto de entrada NA MIDIA
    out_s: float                     # ponto de saida NA MIDIA
    video_id: Optional[int] = None
    photo_id: Optional[int] = None
    link_id: Optional[str] = None
    nome: Optional[str] = None
    origem: str = "user"
    effects: List[Dict[str, Any]] = field(default_factory=list)
    indice: int = 0                  # posicao original na lista `clips` (regra P4)

    @property
    def duracao_s(self) -> float:
        """Duracao ocupada na timeline. Sempre out - in: o motor nao faz retime."""
        return max(0.0, self.out_s - self.in_s)

    @property
    def fim_s(self) -> float:
        return self.inicio_s + self.duracao_s

    @property
    def e_foto(self) -> bool:
        return self.tipo == "photo"

    def efeito(self, tipo: str, incluir_bypass: bool = False) -> Optional[Dict[str, Any]]:
        """Primeiro efeito do tipo pedido, ou None.

        Por padrao respeita a regra P5: bloco com `disabled: true` e como se nao
        existisse. `incluir_bypass=True` devolve mesmo assim -- serve so para o
        relatorio de fidelidade, que precisa listar o que foi bypassado.
        """
        for e in self.effects:
            if not isinstance(e, dict) or e.get("type") != tipo:
                continue
            if e.get("disabled") and not incluir_bypass:
                return None
            return e
        return None

    def efeitos(self, tipo: str, incluir_bypass: bool = False) -> List[Dict[str, Any]]:
        """Todos os efeitos do tipo pedido (crossfade tem dois: side in e out)."""
        return [e for e in self.effects
                if isinstance(e, dict) and e.get("type") == tipo
                and (incluir_bypass or not e.get("disabled"))]


@dataclass
class Sequencia:
    """A timeline inteira, normalizada."""
    fps: float = FPS_PADRAO
    largura: int = LARGURA_PADRAO
    altura: int = ALTURA_PADRAO
    pistas: List[Pista] = field(default_factory=list)
    clipes: List[Clipe] = field(default_factory=list)
    nome: str = ""
    timeline_id: Optional[int] = None

    def pista(self, track_id: str) -> Optional[Pista]:
        return next((p for p in self.pistas if p.id == str(track_id)), None)

    def pistas_video(self) -> List[Pista]:
        """Pistas de video da frente para o fundo (ordem visual: topo primeiro).

        A composicao do render e o inverso disso: desenha do fundo para a frente.
        Use `reversed(...)` na hora de empilhar os overlays.
        """
        return sorted([p for p in self.pistas if p.e_video], key=lambda p: p.ordem)

    def pistas_audio(self) -> List[Pista]:
        return sorted([p for p in self.pistas if p.e_audio], key=lambda p: p.ordem)

    def clipes_da_pista(self, track_id: str) -> List[Clipe]:
        """Clipes de uma pista, em ordem de tempo, sem sobreposicao (regra P4)."""
        crus = [c for c in self.clipes if c.track == str(track_id)]
        return resolver_sobreposicoes(crus)

    def duracao_s(self) -> float:
        """Fim do ultimo clipe de pista nao-IA. Timeline vazia = 0."""
        ids_ia = {p.id for p in self.pistas if p.e_ia}
        fins = [c.fim_s for c in self.clipes if c.track not in ids_ia]
        return max(fins) if fins else 0.0

    def frames(self, segundos: float) -> int:
        """Segundos -> frame da timeline, arredondando como o player (round)."""
        return int(round(float(segundos) * self.fps))


# ---------------------------------------------------------------------------
# Normalizacao
# ---------------------------------------------------------------------------

def normalizar(sequencia, *, nome: str = "", timeline_id: Optional[int] = None) -> Sequencia:
    """Aceita o dict v2 do banco (ou a lista v1 legada) e devolve a `Sequencia`.

    Nao consulta banco, nao toca disco: funcao pura, testavel sem fixture. Quem
    carrega o `sequence_json` e resolve caminhos de midia e `midia.py`.

    Pistas de IA sao MANTIDAS na lista (o relatorio precisa saber que existem),
    mas `clipes_da_pista` e os grafos as ignoram pela regra P1.
    """
    bruto = _como_dict_v2(sequencia)

    fps = _float_positivo(bruto.get("fps"), FPS_PADRAO)
    largura = _int_positivo(bruto.get("width"), LARGURA_PADRAO)
    altura = _int_positivo(bruto.get("height"), ALTURA_PADRAO)

    pistas: List[Pista] = []
    for ordem, t in enumerate(bruto.get("tracks") or []):
        if not isinstance(t, dict) or t.get("id") is None:
            continue
        pistas.append(Pista(
            id=str(t.get("id")),
            nome=str(t.get("name") or t.get("id")),
            kind=str(t.get("kind") or "video").lower(),
            volume=_float_nao_negativo(t.get("volume"), 1.0),
            muted=bool(t.get("muted")),
            hidden=bool(t.get("hidden")),
            locked=bool(t.get("locked")),
            # `order` explicito manda; sem ele vale a posicao no array, que e a
            # ordem visual de cima para baixo (defaultTracks em timelineState.js).
            ordem=_int_ou(t.get("order"), ordem),
        ))

    clipes: List[Clipe] = []
    for indice, c in enumerate(bruto.get("clips") or []):
        clipe = _clipe(c, indice)
        if clipe is not None:
            clipes.append(clipe)

    return Sequencia(fps=fps, largura=largura, altura=altura,
                     pistas=pistas, clipes=clipes,
                     nome=str(nome or ""), timeline_id=timeline_id)


def _clipe(c, indice: int) -> Optional[Clipe]:
    """Um item de `clips` -> Clipe. None quando o item nao da render nenhum."""
    if not isinstance(c, dict):
        return None

    in_s = _float_nao_negativo(c.get("in"), 0.0)
    out_s = _float_nao_negativo(c.get("out"), 0.0)
    if out_s <= in_s:
        return None  # corte de duracao zero ou invertido: nao existe na tela

    # Posicao na timeline: o banco grava `timeline_start` (segundos); o estado da
    # tela usa `timelineStartFrame`. Aceitar os dois deixa o motor funcionar tanto
    # com a linha do banco quanto com um payload vindo direto da UI.
    inicio = c.get("timeline_start")
    if inicio is None:
        inicio = c.get("timeline_start_s")
    if inicio is None and c.get("timelineStartFrame") is not None:
        # Sem fps aqui: quem chamar com payload de tela precisa converter antes.
        # Deixar explodir e melhor que inventar 24 fps e desalinhar tudo.
        raise ValueError(
            "clipe com 'timelineStartFrame' e sem 'timeline_start': converta "
            "frames para segundos antes de normalizar (o modelo trabalha em segundos)."
        )

    efeitos = c.get("effects")
    if not isinstance(efeitos, list):
        efeitos = []

    return Clipe(
        id=str(c.get("id") or f"cut_{indice}"),
        tipo=str(c.get("type") or "video").lower(),
        track=str(c.get("track") or "V1"),
        inicio_s=_float_nao_negativo(inicio, 0.0),
        in_s=in_s,
        out_s=out_s,
        video_id=_int_ou_none(c.get("video_id")),
        photo_id=_int_ou_none(c.get("photo_id")),
        link_id=(str(c["link_id"]) if c.get("link_id") else None),
        nome=(str(c["name"]) if c.get("name") else None),
        origem=str(c.get("origin") or "user"),
        effects=[e for e in efeitos if isinstance(e, dict)],
        indice=indice,
    )


def resolver_sobreposicoes(clipes: List[Clipe]) -> List[Clipe]:
    """Aplica a regra P4: numa pista, so um clipe toca por instante.

    O player varre a lista `clips` na ordem original e para no primeiro cujo
    intervalo cobre o frame atual. Consequencia: quando dois clipes da mesma
    pista se sobrepoem, o de MENOR indice ganha, e o outro fica com a sobra --
    inclusive partido ao meio, se o vencedor estiver no meio dele.

    Devolve os clipes ordenados por tempo, com os intervalos ja aparados para
    nao se sobreporem. Clipe totalmente coberto por um de indice menor some.

    Aparar significa mexer em `inicio_s` e no `in_s` juntos: cortar 0,4 s do
    comeco na timeline tem de avancar 0,4 s dentro da midia, senao o trecho
    exibido nao e o mesmo que estava na tela.
    """
    por_prioridade = sorted(clipes, key=lambda c: c.indice)
    donos: List[Tuple[float, float]] = []   # janelas ja tomadas, em ordem
    resultado: List[Clipe] = []

    for clipe in por_prioridade:
        pedacos = [(clipe.inicio_s, clipe.fim_s)]
        for (dono_ini, dono_fim) in donos:
            novos: List[Tuple[float, float]] = []
            for (ini, fim) in pedacos:
                if dono_fim <= ini or dono_ini >= fim:
                    novos.append((ini, fim))       # nao encosta
                    continue
                if ini < dono_ini:
                    novos.append((ini, dono_ini))  # sobra da esquerda
                if dono_fim < fim:
                    novos.append((dono_fim, fim))  # sobra da direita
            pedacos = novos
            if not pedacos:
                break

        for (ini, fim) in pedacos:
            if fim - ini <= 1e-9:
                continue
            recorte = Clipe(
                id=clipe.id if (ini == clipe.inicio_s and fim == clipe.fim_s)
                   else f"{clipe.id}__{_ms(ini)}",
                tipo=clipe.tipo, track=clipe.track,
                inicio_s=ini,
                in_s=clipe.in_s + (ini - clipe.inicio_s),
                out_s=clipe.in_s + (fim - clipe.inicio_s),
                video_id=clipe.video_id, photo_id=clipe.photo_id,
                link_id=clipe.link_id, nome=clipe.nome, origem=clipe.origem,
                effects=clipe.effects, indice=clipe.indice,
            )
            resultado.append(recorte)
            donos.append((ini, fim))
        donos.sort()

    resultado.sort(key=lambda c: (c.inicio_s, c.indice))
    return resultado


# ---------------------------------------------------------------------------
# Pedido de render
# ---------------------------------------------------------------------------

@dataclass
class Faixa:
    """Trecho da timeline a renderizar."""
    modo: str = MODO_FAIXA_COMPLETA
    inicio_s: float = 0.0
    fim_s: Optional[float] = None

    def resolver(self, duracao_total_s: float) -> Tuple[float, float]:
        """(inicio, fim) efetivos em segundos, ja presos na duracao da timeline."""
        if self.modo == MODO_FAIXA_IN_OUT:
            ini = max(0.0, float(self.inicio_s))
            fim = float(self.fim_s) if self.fim_s is not None else duracao_total_s
            fim = min(fim, duracao_total_s)
            if fim <= ini:
                raise ValueError("Faixa IN-OUT vazia: o OUT precisa vir depois do IN.")
            return ini, fim
        return 0.0, duracao_total_s


@dataclass
class Escopo:
    """Escolha criativa do editor: o que ele QUER no arquivo.

    Nao confundir com fidelidade (o que o motor SABE fazer). Desligar aqui e
    deliberado e nao gera aviso; limitacao de motor gera (fidelidade.py).
    """
    categorias: Dict[str, bool] = field(default_factory=dict)
    pistas: Dict[str, bool] = field(default_factory=dict)

    def categoria_ligada(self, categoria: str) -> bool:
        """Tudo ligado por padrao: chave ausente = True."""
        return bool(self.categorias.get(categoria, True))

    def pista_ligada(self, track_id: str) -> bool:
        return bool(self.pistas.get(str(track_id), True))

    def efeito_ligado(self, tipo_efeito: str) -> bool:
        """False quando a categoria dona deste tipo de efeito foi desmarcada."""
        for categoria, tipos in EFEITOS_POR_CATEGORIA.items():
            if tipo_efeito in tipos and not self.categoria_ligada(categoria):
                return False
        return True


@dataclass
class Saida:
    """Onde o arquivo cai e como se chama. None = usar Configuracoes + sugestao."""
    diretorio: Optional[str] = None
    nome_arquivo: Optional[str] = None


@dataclass
class PosRender:
    """Preferencias de pos-conclusao, persistidas por usuario/projeto."""
    abrir_pasta: bool = False
    copiar_caminho: bool = False
    salvar_como: bool = False
    ingerir: bool = False


@dataclass
class Pedido:
    """O pedido completo de render, validado. Corpo do POST vira isto."""
    timeline_id: int
    kind: str = TIPO_MASTER
    preset: str = "master_1080"
    faixa: Faixa = field(default_factory=Faixa)
    escopo: Escopo = field(default_factory=Escopo)
    overrides: Dict[str, Any] = field(default_factory=dict)
    saida: Saida = field(default_factory=Saida)
    pos: PosRender = field(default_factory=PosRender)
    # Preenchido por midia.py quando o HD dos originais esta fora e o usuario
    # aceitou seguir em proxy: o nome do arquivo ganha marca e o log avisa.
    permitir_fallback_proxy: bool = False

    @property
    def e_rascunho(self) -> bool:
        return self.kind == TIPO_DRAFT

    @property
    def chave_tarefa(self) -> str:
        """Chave no TASK_MANAGER. Uma por timeline: a fila e sequencial."""
        return f"render_timeline_{self.timeline_id}"


# ---------------------------------------------------------------------------
# Conversores tolerantes
# ---------------------------------------------------------------------------

def _como_dict_v2(sequencia) -> Dict[str, Any]:
    if isinstance(sequencia, list):
        return {"version": 2, "fps": FPS_PADRAO, "tracks": [], "clips": sequencia}
    if isinstance(sequencia, dict):
        return sequencia
    raise TypeError(f"Sequencia invalida: {type(sequencia).__name__}")


def _float_positivo(valor, padrao: float) -> float:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return padrao
    return n if n > 0 else padrao


def _float_nao_negativo(valor, padrao: float) -> float:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return padrao
    return n if n >= 0 else padrao


def _int_positivo(valor, padrao: int) -> int:
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return padrao
    return n if n > 0 else padrao


def _int_ou(valor, padrao: int) -> int:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return padrao


def _int_ou_none(valor) -> Optional[int]:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def _ms(segundos: float) -> int:
    return int(round(float(segundos) * 1000))
