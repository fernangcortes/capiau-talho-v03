"""Resolucao de fonte de midia: original x proxy x WAV tratado (pacote C).

DECISAO DE PRODUTO DO DONO DO PROJETO (PLANO_EXPORTACAO_VIDEO.md secao 2),
que este modulo apenas executa -- nao reabre:

    master   = ORIGINAL
    rascunho = PROXY
    original ausente NUNCA cai calado para o proxy.

Contexto da maquina: os originais vivem num HD externo (drive F:) que pode
estar desconectado; os proxies sao locais (CONFIG.PROXIES_DIR). O preview do
player roda em proxy (`player.js:1954`: proxy_path || filepath), ou seja, a
tela mostra 720p. O master tem de sair MELHOR que a tela; quando nao puder,
este modulo RECUSA ou marca a queda para proxy -- nunca engole.

Guarda de disponibilidade (o cuidado mais fino daqui): consultar arquivo em
drive morto pode TRAVAR segundos por chamada. Um timeline com 40 clipes faria
40 consultas caras. Entao cada letra de drive e testada UMA vez por resolucao,
com timeout curto em thread separada; drive mudo => todos os originais dele
viram "indisponiveis" sem tentar arquivo por arquivo.

O WAV tratado segue `_bloco_audio_tratado` (src/export/otio_export.py),
INCLUSIVE o caso patologico: bloco declarado "ready" mas arquivo sumido volta
ao original E registra o motivo -- apontar para arquivo inexistente e pior que
nao tratar.

Este modulo NUNCA escreve em F: (guarda copiada de _assegurar_destino_seguro,
src/export/audio_stems.py:129).
"""
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.config import CONFIG

# Status possiveis de uma fonte resolvida
ST_OK = "ok"
ST_INDISPONIVEL = "original_indisponivel"   # master quis original, nao deu; ha proxy
ST_AUSENTE = "ausente"                       # nem original nem proxy
ST_SEM_REFERENCIA = "sem_referencia"         # clipe sem video_id/photo_id nenhum
ST_PISTA_IGNORADA = "pista_ignorada"         # pista de IA: regra P1 do modelo


# ---------------------------------------------------------------------------
# Estruturas de resposta
# ---------------------------------------------------------------------------

@dataclass
class FonteClipe:
    """A decisao de fonte para UM clipe, com o rastro do por que."""
    clipe_id: str
    tipo_midia: str                     # "video" | "foto"
    caminho: Optional[Path]             # o arquivo que vai no -i (None se ausente)
    classe: str                         # "original" | "proxy" | "tratado" | ""
    status: str                         # ST_*
    motivo: str                         # texto humano para log/banner
    wav_tratado: Optional[Path] = None  # quando audio_render ready E existe
    motivo_tratado: Optional[str] = None  # bloco ready mas ref quebrada, etc.


@dataclass
class RelatorioMidia:
    """Agregado por render: quem falta, quem caiu para proxy, o que recusa."""
    kind_render: str = "master"
    fontes: Dict[str, FonteClipe] = field(default_factory=dict)
    ausentes: List[str] = field(default_factory=list)               # ids de clipe
    originais_indisponiveis: List[str] = field(default_factory=list)
    sem_referencia: List[str] = field(default_factory=list)
    clipes_proxy: List[str] = field(default_factory=list)           # saem de proxy NESTE render
    usa_proxy_fallback: bool = False    # master aceitou cair para proxy (marca no nome)
    drives_fora: List[str] = field(default_factory=list)            # letras que nao responderam
    drives_verificados: Dict[str, bool] = field(default_factory=dict)
    recusas: List[str] = field(default_factory=list)                # nao vazio => RECUSADO

    @property
    def recusado(self) -> bool:
        return bool(self.recusas)

    def callback_tratado(self) -> Callable[[Any], Optional[Path]]:
        """Callable para grafo_audio_completo(resolver_tratado=...).

        Aceita tanto o objeto Clipe quanto o id em texto, porque o contrato do
        pacote B ainda nao esta em disco para cravar uma das duas formas.
        """
        def _resolver(alvo: Any) -> Optional[Path]:
            clipe_id = getattr(alvo, "id", None) or str(alvo)
            fonte = self.fontes.get(str(clipe_id))
            return fonte.wav_tratado if fonte else None
        return _resolver


# ---------------------------------------------------------------------------
# Caminhos convencionais (puros; usados aqui e nos testes)
# ---------------------------------------------------------------------------

def caminho_proxy_video(video_id: int) -> Path:
    return CONFIG.PROXIES_DIR / f"proxy_vid_{int(video_id)}.mp4"


def caminho_proxy_foto(photo_id: int) -> Path:
    return CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{int(photo_id)}.webp"


def assegurar_destino_seguro(destino) -> Path:
    """Valida e cria a pasta de destino. Recusa o drive F: (acervo, so leitura).

    Copia da guarda de src/export/audio_stems.py:129 -- mesma regra, mesmo
    motivo: o drive F: e o acervo bruto; escrever la nunca.
    """
    pasta = Path(destino).resolve()
    if pasta.drive.upper().startswith("F"):
        raise ValueError(
            f"Destino dentro do drive F:/ (acervo bruto, somente leitura) e proibido: {pasta}")
    pasta.mkdir(parents=True, exist_ok=True)
    return pasta


# ---------------------------------------------------------------------------
# Guardas de disco
# ---------------------------------------------------------------------------

def _drive_de(caminho: Path) -> str:
    return (caminho.drive or "C").rstrip(":").upper()


def _probe_drive(letra: str, resultado: List[bool]) -> None:
    try:
        resultado.append(os.path.exists(f"{letra}:\\"))
    except OSError:
        resultado.append(False)


def drive_responde(letra: str, timeout_s: float = 1.5) -> bool:
    """True se a RAIZ do drive responde dentro do timeout.

    Em thread separada porque `os.path.exists` numa unidade morta pode bloquear
    por segundos (requisicao ao volume que nunca retorna). Estourou o timeout =>
    trata-se como fora. A thread daemon pode ficar presa na chamada nativa ate o
    SO desistir; ela morre com o processo e nao segura a resolucao.
    """
    letra = (letra or "").rstrip(":").upper()
    if not letra:
        return False
    resultado: List[bool] = []
    t = threading.Thread(target=_probe_drive, args=(letra, resultado), daemon=True)
    t.start()
    t.join(timeout_s)
    return bool(resultado and resultado[0])


# ---------------------------------------------------------------------------
# WAV tratado (contrato F3/H1, copiado de otio_export._bloco_audio_tratado)
# ---------------------------------------------------------------------------

def wav_tratado_do_clipe(clipe) -> Tuple[Optional[Path], Optional[str]]:
    """(caminho, None) se ha tratamento pronto NO DISCO; (None, motivo) se o
    bloco declara ready mas o arquivo sumiu; (None, None) se nao ha tratamento.

    O WAV contem SOMENTE o trecho [in,out] da fonte e comeca em ZERO: quem
    trocar a fonte precisa zerar os dois ranges (responsabilidade do grafo de
    audio, que recebe este caminho via resolver_tratado).
    """
    for e in (clipe.effects or []):
        if not isinstance(e, dict) or e.get("type") != "audio_render":
            continue
        if e.get("status") != "ready":
            continue
        ref = e.get("ref")
        if not isinstance(ref, str) or not ref.strip():
            return None, "audio_render pronto sem 'ref' no bloco de efeitos"
        candidato = Path(ref)
        if not candidato.is_absolute():
            # Contrato F3: ref relativa ao BASE_DIR (data/audio_tratado/<id>/<hash>.wav).
            candidato = CONFIG.BASE_DIR / candidato
        if not candidato.is_file():
            return None, f"ref de audio tratado nao encontrada no disco: {ref}"
        return candidato, None
    return None, None


# ---------------------------------------------------------------------------
# Carga de metadados (banco) com injecao para testes
# ---------------------------------------------------------------------------

def _carregar_do_banco(tipo: str, midia_id: int) -> Optional[Dict[str, Any]]:
    """Linha de video/photo pelo id; None se sumiu do banco. Import tardio:
    testes sem banco injetam `buscar_midia` e nunca chegam aqui."""
    from src.db.connection import get_db
    from src.db.repositories.media import MediaRepository
    with get_db() as conn:
        if tipo == "foto":
            return MediaRepository.get_photo(conn, int(midia_id))
        return MediaRepository.get_video(conn, int(midia_id))


# ---------------------------------------------------------------------------
# O resolver
# ---------------------------------------------------------------------------

def resolver_fontes(seq, pedido, *,
                    buscar_midia: Optional[Callable[[str, int], Optional[Dict[str, Any]]]] = None,
                    checar_drive: Optional[Callable[[str], bool]] = None,
                    timeout_drive_s: float = 1.5) -> RelatorioMidia:
    """Resolve original x proxy x tratado para todo clipe da sequencia.

    `buscar_midia(tipo, id)` e `checar_drive(letra)` existem para os testes
    simularem HD fora e midia apagada SEM tocar no banco nem depender de o F:
    estar conectado. Em producao vale a carga real.

    Politica (secao 2 do plano):
      - midia totalmente ausente (nem proxy)          -> RECUSADO, listando;
      - master, original indisponivel, sem permissao   -> RECUSADO (HD parece fora);
      - master, original indisponivel, COM permissao   -> proxy + sufixo _proxy;
      - rascunho                                        -> proxy; sem proxy, original
        (rascunho nao pode falhar por falta de proxy).
    """
    buscar = buscar_midia or _carregar_do_banco
    rel = RelatorioMidia(kind_render=str(getattr(pedido, "kind", "master")))
    master = rel.kind_render != "draft"

    cache_drives: Dict[str, bool] = {}

    def _drive_ok(letra: str) -> bool:
        letra = (letra or "").upper()
        if letra not in cache_drives:
            checa = checar_drive or (lambda l: drive_responde(l, timeout_drive_s))
            cache_drives[letra] = bool(checa(letra))
        return cache_drives[letra]

    cache_midias: Dict[Tuple[str, int], Optional[Dict[str, Any]]] = {}

    def _midia(tipo: str, midia_id: Optional[int]) -> Optional[Dict[str, Any]]:
        if midia_id is None:
            return None
        chave = (tipo, int(midia_id))
        if chave not in cache_midias:
            try:
                cache_midias[chave] = buscar(tipo, int(midia_id))
            except Exception as e:
                # Banco fora do ar e condicao de recusa, nao de crash: registra
                # como midia desconhecida e deixa a politica decidir.
                cache_midias[chave] = None
                rel.recusas.append(f"Falha ao consultar {tipo} {midia_id} no banco: {e}")
        return cache_midias[chave]

    pistas_ia = {p.id for p in seq.pistas if p.e_ia}

    for clipe in seq.clipes:
        if clipe.track in pistas_ia:
            rel.fontes[clipe.id] = FonteClipe(
                clipe.id, "video", None, "", ST_PISTA_IGNORADA,
                "Pista de IA nao entra no render (regra P1).")
            continue

        e_foto = clipe.e_foto
        tipo_midia = "foto" if e_foto else "video"
        midia_id = clipe.photo_id if e_foto else clipe.video_id

        if midia_id is None:
            # Sem referencia nenhuma: na tela o player tambem mostra nada
            # (player.js:_videoSrcForCut devolve null). Render preto aqui e
            # PARIDADE, nao mentira -- por isso WARN no banner, nao bloqueio.
            rel.sem_referencia.append(clipe.id)
            rel.fontes[clipe.id] = FonteClipe(
                clipe.id, tipo_midia, None, "", ST_SEM_REFERENCIA,
                "Clipe sem video_id/photo_id; na tela ele tambem aparece vazio.")
            continue

        linha = _midia(tipo_midia, midia_id)
        original_bruto = (linha or {}).get("filepath")
        original = Path(original_bruto) if original_bruto else None
        proxy = caminho_proxy_foto(midia_id) if e_foto else caminho_proxy_video(midia_id)

        # --- WAV tratado primeiro: quando pronto NO DISCO ele SUBSTITUI a fonte
        # inteira (original nem e consultado para tocar).
        wav, motivo_wav = wav_tratado_do_clipe(clipe)
        if wav is not None:
            rel.fontes[clipe.id] = FonteClipe(
                clipe.id, tipo_midia, wav, "tratado", ST_OK,
                "Fonte trocada pelo WAV tratado (audio_render ready); "
                "o WAV comeca em ZERO e cobre so [in,out].",
                wav_tratado=wav)
            continue
        # motivo_wav != None aqui: o bloco dizia ready e o arquivo sumiu. Mantem
        # a fonte normal e registra o motivo no campo abaixo -- apontar para
        # arquivo inexistente e pior que nao tratar (mesma decisao do OTIO).

        existe_original: Optional[bool]  # None = nao deu para perguntar (drive fora)
        if original is None:
            existe_original = False
            motivo_original = "clipe aponta para midia sem filepath no banco"
        else:
            letra = _drive_de(original)
            if not _drive_ok(letra):
                existe_original = None
                rel.drives_fora.append(letra)
                motivo_original = f"drive {letra}: nao respondeu (parece desconectado)"
            else:
                try:
                    existe_original = original.is_file()
                except OSError:
                    existe_original = None
                    motivo_original = f"consulta ao arquivo falhou ({original})"
                else:
                    motivo_original = "" if existe_original else \
                        f"arquivo original nao encontrado: {original}"

        proxy_existe = _arquivo_existe_local(proxy)

        if master:
            if existe_original:
                fonte = FonteClipe(clipe.id, tipo_midia, original, "original", ST_OK,
                                   "Master sai do ORIGINAL.")
            elif proxy_existe:
                fonte = FonteClipe(clipe.id, tipo_midia, proxy, "proxy", ST_INDISPONIVEL,
                                   (motivo_original or "original indisponivel")
                                   + "; proxy local disponivel.")
                rel.originais_indisponiveis.append(clipe.id)
            else:
                fonte = FonteClipe(clipe.id, tipo_midia, None, "", ST_AUSENTE,
                                   (motivo_original or "original indisponivel")
                                   + f"; e sem proxy ({proxy}).")
                rel.ausentes.append(clipe.id)
        else:  # rascunho
            if proxy_existe:
                fonte = FonteClipe(clipe.id, tipo_midia, proxy, "proxy", ST_OK,
                                   "Rascunho sai do PROXY.")
                rel.clipes_proxy.append(clipe.id)
            elif existe_original:
                fonte = FonteClipe(clipe.id, tipo_midia, original, "original", ST_OK,
                                   "Rascunho sem proxy; usando o original "
                                   "(rascunho nao falha por falta de proxy).")
            else:  # original sumido ou drive mudo, e sem proxy
                fonte = FonteClipe(clipe.id, tipo_midia, None, "", ST_AUSENTE,
                                   (motivo_original or "original indisponivel")
                                   + f"; e sem proxy ({proxy}).")
                rel.ausentes.append(clipe.id)

        fonte.motivo_tratado = motivo_wav
        rel.fontes[clipe.id] = fonte

    # ---- Politica agregada -------------------------------------------------
    if rel.ausentes:
        rel.recusas.append(
            "Midia AUSENTE (nem original nem proxy) nos clipes: "
            + ", ".join(rel.ausentes)
            + ". Renderizar preto no lugar deles seria mentir.")

    if master and rel.originais_indisponiveis:
        if not bool(getattr(pedido, "permitir_fallback_proxy", False)):
            letras = sorted(set(rel.drives_fora)) or ["?"]
            rel.recusas.append(
                "MASTER sem original disponivel e fallback para proxy nao permitido "
                f"(permitir_fallback_proxy=False). Clipes afetados: "
                + ", ".join(rel.originais_indisponiveis)
                + f". Drive(s) envolvido(s): {', '.join(letras)} -- o HD dos originais "
                  "parece desconectado; conecte-o ou autorize o fallback para proxy.")
        else:
            rel.usa_proxy_fallback = True
            rel.clipes_proxy = sorted(set(rel.originais_indisponiveis))

    if not master:
        # No rascunho tudo que sai de proxy ja foi anotado clipe a clipe.
        rel.clipes_proxy = sorted(set(rel.clipes_proxy))

    rel.drives_verificados = dict(cache_drives)
    rel.drives_fora = sorted(set(rel.drives_fora))
    return rel


def _arquivo_existe_local(caminho: Path) -> bool:
    """exists() tolerante: proxies sao LOCAIS, entao consulta direta e barata."""
    try:
        return caminho.is_file()
    except OSError:
        return False
