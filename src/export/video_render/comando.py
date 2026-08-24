"""Presets, encoder e a linha de comando completa do ffmpeg (pacote C).

Este modulo e PURA montagem: nao toca disco, nao sobe processo. Quem executa e
`execucao.py`; quem decide SE o comando pode rodar (midia existe, HD conectado)
e `midia.py`. Separar montagem de execucao permite testar a linha inteira sem
ffmpeg nenhum na maquina.

Decisoes registradas (PLANO_EXPORTACAO_VIDEO.md secoes 2, 4.3 e 9):

- ENCODER: reusa `resolve_encoder_pipeline` de src/media/ffmpeg.py (que ja
  detecta NVENC/QSV/AMF com cache). Em encoder por HARDWARE os argumentos
  voltam prontos (-cq/-global_quality/-qp) e sao usados INTACTOS: acrescentar
  -crf por cima seria ignorado pelo encoder e so confundiria o log. Em CPU
  (libx264) o -crf devolvido pela funcao e TROCADO pelo das configuracoes
  (render.master_crf / render.draft_crf), porque aquele valor fixo (23) nao
  conhece a intencao de qualidade do preset.

- DECODE POR SOFTWARE: `hardware.hwaccel_decode` NAO vira `-hwaccel` aqui. O
  filter_complex do render trabalha com frames em memoria do sistema (geq,
  lutrgb, overlay com alfa); alimentar o grafo com frames de superficie de GPU
  exigiria hwdownload em cada camada ou quebraria. O proxy interno da casa
  (generate_video_proxy) tambem decodifica em software -- mesmo padrao.

- INDICE DAS ENTRADAS: os dois grafos (video = pacote A, audio = pacote B)
  devolvem "entradas" que viram -i NA ORDEM, video primeiro. Os rotulos
  [N:v]/[N:a] dentro dos filter_complex precisam apontar para indices desse
  vetor concatenado. `_validar_indices` confere isso e FALHA ALTO se algum
  pacote apontar para entrada inexistente -- um indice errado renderizaria
  midia trocada em silencio, exatamente o que o plano proibe.

- CASAMENTO entrada -> clipe: cada entrada tem {"tipo","ss","t","loop"} e um
  caminho que pode vir None (os grafos nao tocam disco). O casamento tenta
  (1) id embutido no caminho sugerido (proxy_vid_12.mp4 etc.) e (2) chave
  (tipo, ss, t). E a costura mais fragil do pacote ate A/B aterrissarem; ver
  `casar_entradas`.
"""
import datetime
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.config import CONFIG

# Import protegido dos grafos dos pacotes A/B: eles sao escritos EM PARALELO e
# podem nao existir -- ou estar PELA METADE no disco (SyntaxError transitorio,
# peguei um desses ao vivo). O modulo precisa importar e ser testavel mesmo
# assim; qualquer falha aqui vira None + aviso, e quem chamar os grafos sem
# eles recebe um erro claro dizendo qual pacote falta.
try:
    from . import grafo_video  # type: ignore
except Exception as _erro_grafo_video:  # ImportError, SyntaxError, o que vier
    grafo_video = None  # type: ignore[assignment]
    print(f"[RenderComando] grafo_video (pacote A) indisponivel agora "
          f"({_erro_grafo_video.__class__.__name__}: {_erro_grafo_video}). "
          "O modulo importa do mesmo jeito; o render recusa ao ser acionado.")

try:
    from . import grafo_audio  # type: ignore
except Exception as _erro_grafo_audio:
    grafo_audio = None  # type: ignore[assignment]
    print(f"[RenderComando] grafo_audio (pacote B) indisponivel agora "
          f"({_erro_grafo_audio.__class__.__name__}: {_erro_grafo_audio}). "
          "O modulo importa do mesmo jeito; o render com audio recusa ao ser acionado.")


# ---------------------------------------------------------------------------
# Configuracoes (secao 9 do plano). O pacote D registra as chaves; aqui so LE.
# ---------------------------------------------------------------------------

DEFAULTS_RENDER: Dict[str, Any] = {
    "render.output_dir": "data/exports/renders",
    "render.threads": 0,            # 0 = ffmpeg decide
    "render.segment_max_clips": 40,
    "render.segment_max_seconds": 90.0,
    "render.draft_height": 540,
    "render.draft_crf": 30,
    "render.master_crf": 18,
    "render.audio_bitrate": 192,
    "render.supersample_kenburns": 2,
    "render.allow_proxy_fallback": False,
}

# Coercao por tipo declarado no registry: valores vindos do banco chegam como
# texto e o motor nao pode descobrir isso em producao do pior jeito.
_TIPO_DAS_CHAVES: Dict[str, type] = {
    "render.output_dir": str,
    "render.threads": int,
    "render.segment_max_clips": int,
    "render.segment_max_seconds": float,
    "render.draft_height": int,
    "render.draft_crf": int,
    "render.master_crf": int,
    "render.audio_bitrate": int,
    "render.supersample_kenburns": int,
    "render.allow_proxy_fallback": bool,
}


def _coagir(chave: str, valor: Any):
    """Converte o valor bruto para o tipo declarado; lixo volta ao default."""
    alvo = _TIPO_DAS_CHAVES.get(chave)
    try:
        if alvo is bool:
            if isinstance(valor, bool):
                return valor
            return str(valor).strip().lower() in ("1", "true", "yes", "sim", "on")
        if alvo is int:
            return int(float(valor))
        if alvo is float:
            return float(valor)
        return str(valor)
    except (TypeError, ValueError):
        return DEFAULTS_RENDER[chave]


def config_render(project_id: Optional[int] = None) -> Dict[str, Any]:
    """Le as configuracoes `render.*` com fallback integral aos defaults.

    Mesmo padrao de get_hardware_settings (src/media/ffmpeg.py): se o
    SettingsService nao estiver disponivel (testes fora do servidor, banco
    ausente, pacote D ainda nao aterrissou), devolve os defaults da secao 9.
    Nunca levanta: um render nao pode cair por causa de leitura de preferencia.
    """
    cfg: Dict[str, Any] = dict(DEFAULTS_RENDER)
    try:
        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        for chave in list(cfg.keys()):
            try:
                valor = S.get(chave)
            except Exception:
                continue  # chave ainda nao registrada pelo pacote D: default
            if valor is not None:
                cfg[chave] = _coagir(chave, valor)
    except Exception:
        pass
    # Caminho relativo e ancorado no BASE_DIR, como as demais pastas do app.
    pasta = Path(str(cfg["render.output_dir"]))
    if not pasta.is_absolute():
        cfg["render.output_dir"] = str(CONFIG.BASE_DIR / pasta)
    return cfg


# ---------------------------------------------------------------------------
# Presets (secao "Presets" da tarefa). Valores medidos ficam para depois;
# nada aqui e imutavel: overrides do Pedido e configuracoes falam mais alto.
# ---------------------------------------------------------------------------

PRESETS: Dict[str, Dict[str, Any]] = {
    "master_1080": {
        "largura": 1920, "altura": 1080,
        "faststart": False, "yuv420p": False,
        "crf": None,           # None => usa render.master_crf
        "audio_kbps": None,    # None => usa render.audio_bitrate
    },
    "youtube_1080": {
        "largura": 1920, "altura": 1080,
        "faststart": True, "yuv420p": True,
        "crf": None, "audio_kbps": None,
    },
    "reels_916": {
        "largura": 1080, "altura": 1920,
        "faststart": False, "yuv420p": False,
        "crf": None, "audio_kbps": None,
    },
    "whatsapp_leve": {
        "largura": 854, "altura": 480,
        "faststart": True,     # leve = tocar bem em celular: moov no inicio
        "yuv420p": True,       # idem: compatibilidade maxima
        "crf": 28,             # CRF alto de proposito: arquivo pequeno
        "audio_kbps": 96,
    },
}
PRESET_PADRAO = "master_1080"


def _par(valor) -> Optional[Tuple[int, int]]:
    """'1920x1080' -> (1920, 1080); lixo -> None."""
    m = re.fullmatch(r"\s*(\d{2,5})\s*[xX]\s*(\d{2,5})\s*", str(valor or ""))
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def _par_impar(n: int) -> int:
    """H.264 quer dimensoes pares: arredonda para baixo ao par mais proximo."""
    return n if n % 2 == 0 else n - 1


def parametros_saida(pedido, cfg: Optional[Dict[str, Any]] = None,
                     project_id: Optional[int] = None) -> Dict[str, Any]:
    """Resolve preset + rascunho + overrides nos numeros finais de saida.

    Um ponto so para comando.montar_comando e fidelidade.relatorio: os dois
    precisam exatamente dos mesmos numeros (a estimativa de tamanho do modal
    tem de descrever o arquivo que este comando vai produzir).
    """
    cfg = cfg or config_render(project_id)
    nome_preset = str(getattr(pedido, "preset", "") or PRESET_PADRAO)
    avisos: List[str] = []
    if nome_preset not in PRESETS:
        avisos.append(
            f"Preset desconhecido {nome_preset!r}; usando {PRESET_PADRAO!r}.")
        nome_preset = PRESET_PADRAO
    preset = dict(PRESETS[nome_preset])

    largura, altura = int(preset["largura"]), int(preset["altura"])

    ov = dict(getattr(pedido, "overrides", {}) or {})
    if ov.get("resolution"):
        par = _par(ov.get("resolution"))
        if par:
            largura, altura = par
        else:
            avisos.append(f"override.resolution invalido ({ov.get('resolution')!r}); mantendo preset.")
    fps = float(ov["fps"]) if ov.get("fps") else 0.0

    rascunho = getattr(pedido, "e_rascunho", False)
    if rascunho:
        # Rascunho: mesma FILTER_COMPLEX, moldura menor. Altura alvo vem da
        # configuracao; a largura acompanha a proporcao DO PRESET e ambas caem
        # em numero par (exigencia do H.264).
        altura_draft = int(cfg["render.draft_height"])
        escala = altura_draft / float(altura) if altura else 1.0
        largura = _par_impar(max(2, int(round(largura * escala))))
        altura = _par_impar(max(2, altura_draft))
        crf = int(cfg["render.draft_crf"])
        preset_muito_rapido = True
    else:
        crf = int(preset["crf"]) if preset["crf"] is not None else int(cfg["render.master_crf"])
        preset_muito_rapido = False

    if ov.get("crf") is not None:
        crf = int(ov["crf"])

    audio_kbps = int(preset["audio_kbps"]) if preset.get("audio_kbps") is not None \
        else int(cfg["render.audio_bitrate"])
    if ov.get("audio_bitrate"):
        audio_kbps = int(ov["audio_bitrate"])

    fps_final = fps if fps and fps > 0 else 0.0  # 0 = fps da timeline (quem sabe e a seq)

    return {
        "preset": nome_preset,
        "rascunho": rascunho,
        "largura": largura,
        "altura": altura,
        "fps": fps_final,                 # 0 => usar o fps da Sequencia
        "crf": crf,
        "audio_kbps": audio_kbps,
        "faststart": bool(preset["faststart"]),
        "yuv420p": bool(preset["yuv420p"]),
        "preset_x264_muito_rapido": preset_muito_rapido,
        "mute_audio": bool(ov.get("mute_audio")),
        "avisos": avisos,
    }


def _resolver_encoder(param: Dict[str, Any], project_id: Optional[int] = None
                      ) -> Tuple[str, List[str], bool]:
    """(nome_do_encoder, args, e_hardware) via src/media/ffmpeg.py.

    Hardware: args devolvidos por resolve_encoder_pipeline INTACTOS (eles ja
    trazem -cq/-global_quality/-qp; CRF de preset nao se aplica). CPU: troca o
    -crf fixo daquela funcao pelo resolvido nas configuracoes/overrides e, no
    rascunho, o preset por veryfast (custo menor, fidelidade identica).
    """
    from src.media.ffmpeg import get_hardware_settings, resolve_encoder_pipeline

    pref, _hwaccel = get_hardware_settings(project_id)
    nome, args, e_hw = resolve_encoder_pipeline(pref)

    if e_hw:
        return nome, list(args), True

    ajustados: List[str] = []
    i = 0
    while i < len(args):
        token = args[i]
        if token == "-crf":
            ajustados += ["-crf", str(int(param["crf"]))]
            i += 2
            continue
        if token == "-preset" and param.get("preset_x264_muito_rapido"):
            ajustados += ["-preset", "veryfast"]
            i += 2
            continue
        ajustados.append(token)
        i += 1
    if "-crf" not in ajustados:
        ajustados += ["-crf", str(int(param["crf"]))]
    return nome, ajustados, False


# ---------------------------------------------------------------------------
# Grafos (pacotes A/B) com falha clara enquanto nao existirem
# ---------------------------------------------------------------------------

def _chamar_grafo_video(seq, escopo, inicio_s: float, fim_s: float) -> Dict[str, Any]:
    if grafo_video is None:
        raise RuntimeError(
            "grafo_video (pacote A) ainda nao esta no disco: "
            "src/export/video_render/grafo_video.py ausente. O motor de execucao "
            "importa sem ele justamente para poder ser testado antes; para renderizar "
            "de verdade o pacote A precisa aterrissar primeiro.")
    return grafo_video.grafo_completo(seq, escopo, inicio_s, fim_s)


def _chamar_grafo_audio(seq, escopo, inicio_s: float, fim_s: float, resolver_tratado):
    if grafo_audio is None:
        raise RuntimeError(
            "grafo_audio (pacote B) ainda nao esta no disco: "
            "src/export/video_render/grafo_audio.py ausente. O motor importa sem ele "
            "para poder ser testado antes; para renderizar com som o pacote B precisa "
            "aterrissar primeiro.")
    return grafo_audio.grafo_audio_completo(seq, escopo, inicio_s, fim_s,
                                            resolver_tratado=resolver_tratado)


_PADRAO_ENTRADA_RE = re.compile(r"\[(\d+):(v|a)(?::\d+)?\]")


def _validar_indices(filtro_concatenado: str, total_entradas: int) -> None:
    """Falha ALTO se algum rotulo [N:...] apontar para entrada inexistente.

    Indice errado aqui nao explode o ffmpeg: ele abre a midia ERRADA e o arquivo
    sai com conteudo trocado em silencio. Melhor recusar o render do que entregar
    isso. Rotulos nao numerados ([vout], [aout]) passam direto.
    """
    problemas: List[str] = []
    for m in _RE_INDICE.finditer(filtro_concatenado or ""):
        idx = int(m.group(1))
        if idx >= total_entradas:
            problemas.append(f"[{m.group(1)}:{m.group(2)}]")
    if problemas:
        raise ValueError(
            f"filter_complex usa indices de entrada fora do vetor ({len(entradas_total)} "
            f"entradas): {', '.join(sorted(set(problemas)))}. O contrato e: entradas do "
            "grafo_video primeiro, depois as do grafo_audio, numeracao global.")


# expressao compilada uma vez
_RE_INDICE = re.compile(r"\[(\d+):(v|a)(?::\d+)?\]")


# ---------------------------------------------------------------------------
# Casamento entradas -> caminhos resolvidos (a costura com midia.py)
# ---------------------------------------------------------------------------

_RE_ID_VID = re.compile(r"(?:proxy_vid_|video[_-]?)(\d+)\.(?:mp4|mov|mkv|webp|jpg|jpeg|png)", re.IGNORECASE)
_RE_ID_FOTO = re.compile(r"(?:proxy_photo_|photo[_-]?)(\d+)\.\w+", re.IGNORECASE)


def _chave(tipo: str, ss: float, t: float) -> Tuple[str, int, int]:
    return (tipo, int(round(float(ss) * 10000)), int(round(float(t) * 10000)))


def _clipes_em_cena(seq) -> List[Any]:
    """Clipes apos a regra P4 (um por pista por instante), em ordem de tempo.

    Os grafos A/B recebem a MESMA Sequencia e portanto enxergam estes recortes
    -- inclusive os aparados por sobreposicao, cujo id ganha sufixo "__<ms>".
    O casamento entrada->clipe precisa usar ESTES tempos (e os que aparecem nas
    "entradas"); a fonte resolvida fica no id BASE, sem sufixo.
    """
    em_cena: List[Any] = []
    for pista in seq.pistas:
        if pista.e_ia:
            continue  # regra P1
        em_cena.extend(seq.clipes_da_pista(pista.id))
    em_cena.sort(key=lambda c: (c.inicio_s, c.indice))
    return em_cena


def _id_base(clipe_id: str) -> str:
    """'cut_7__1234' (pedaco aparado pela regra P4) volta a ser 'cut_7'."""
    return str(clipe_id).split("__", 1)[0]


def casar_entradas(entradas: List[Dict[str, Any]], seq, rel_midia) -> Tuple[List[str], List[str]]:
    """Devolve (caminhos_por_indice, avisos) para a lista de entradas dos grafos.

    Estrategia, da mais forte para a mais fraca:
      1. Se o caminho sugerido pela entrada embute um id (proxy_vid_12.mp4),
         casa com o clipe desse id cujo (ss,t) tambem bate.
      2. Senao, chave exata (tipo, ss, t) contra os clipes resolvidos por
         midia.py, consumindo em ordem de timeline quando houver empate.
      3. Sem candidato: mantem o caminho da propria entrada SE for um arquivo
         existente; senao marca como nao resolvido (execucao recusa depois --
         nunca entra -i de midia inexistente).

    Pedido registrado aos pacotes A/B (ver relatorio): incluir "clipe_id" em
    cada entrada tornaria este casamento exato e eliminaria a heuristica 2.
    """
    fontes = getattr(rel_midia, "fontes", {}) or {}
    por_clipe: Dict[Tuple[str, int, int], List[Dict[str, Any]]] = {}

    for clipe in _clipes_em_cena(seq):
        base_id = _id_base(clipe.id)
        fonte = fontes.get(base_id)
        if fonte is None or not fonte.caminho:
            continue
        tipo_entrada = "foto" if clipe.e_foto else (
            "audio" if _pista_e_audio(seq, clipe) else "video")
        # rotulo unico: dois pedacos aparados do mesmo clipe compartilham o id
        item = {"rotulo": f"{clipe.id}@{clipe.in_s:.4f}",
                "base_id": base_id,
                "caminho": Path(fonte.caminho)}
        por_clipe.setdefault(_chave(tipo_entrada, clipe.in_s, clipe.duracao_s), []).append(item)
        # WAV tratado comeca em ZERO: o grafo de audio pode emitir ss=0/t=duracao.
        if fonte.wav_tratado is not None:
            por_clipe.setdefault(_chave("audio", 0.0, clipe.duracao_s), []).append(item)

    caminhos: List[str] = []
    avisos: List[str] = []
    consumidos: set = set()  # rotulos ja usados por alguma entrada

    for i, ent in enumerate(entradas or []):
        tipo = str(ent.get("tipo") or "video").lower()
        ss = float(ent.get("ss") or 0.0)
        t = float(ent.get("t") or 0.0)
        sugestao = ent.get("caminho")

        item_escolhido: Optional[Dict[str, Any]] = None

        # 1. id embutido na sugestao
        if isinstance(sugestao, str) and sugestao.strip():
            m = _RE_ID_VID.search(sugestao) or _RE_ID_FOTO.search(sugestao)
            if m:
                alvo_id = m.group(1)
                for chave, itens in sorted(por_clipe.items()):
                    for it in itens:
                        if (it["base_id"].endswith(alvo_id) and chave[0] == tipo
                                and _proximo(chave[1], ss) and _proximo(chave[2], t)
                                and it["rotulo"] not in consumidos):
                            item_escolhido = it
                            break
                    if item_escolhido:
                        break

        # 2. chave exata (com consumo ordenado)
        if item_escolhido is None:
            for it in por_clipe.get(_chave(tipo, ss, t)) or []:
                if it["rotulo"] not in consumidos:
                    item_escolhido = it
                    break

        # 3. sugestao utilizavel
        if item_escolhido is None and isinstance(sugestao, str) and sugestao.strip():
            p = Path(sugestao)
            if tipo != "cor" and p.is_file():
                avisos.append(
                    f"entrada {i} ({tipo}, ss={ss:g}s) sem clipe casado; usado o caminho "
                    f"sugerido pelo proprio grafo ({sugestao}).")
                caminhos.append(str(p))
                continue

        if item_escolhido is None:
            if tipo == "cor":
                caminhos.append("")
                continue
            avisos.append(
                f"entrada {i} ({tipo}, ss={ss:g}s, t={t:g}s) SEM midia resolvida.")
            caminhos.append("")
            continue

        consumidos.add(item_escolhido["rotulo"])
        caminhos.append(str(item_escolhido["caminho"]))
    return caminhos, avisos


def _proximo(a: int, b: float, tolerancia_ms: int = 100) -> bool:
    return abs(a - int(round(float(b) * 10000))) <= tolerancia_ms * 10


def _pista_e_audio(seq, clipe) -> bool:
    pista = seq.pista(clipe.track)
    return bool(pista and pista.e_audio)


# ---------------------------------------------------------------------------
# Nome de arquivo
# ---------------------------------------------------------------------------

_CARACTERES_ILEGAIS = '\\/:*?"<>|'


def sanear_nome(texto: str) -> str:
    """Torna o texto um nome de arquivo valido no Windows.

    Ilegais: \\ / : * ? " < > | (mais caracteres de controle). Tambem remove
    pontos/espacos do fim, que o Explorer descarta e que deixariam nomes
    instaveis entre "existe" e "nao existe".
    """
    limpo = "".join("_" if (ch in _CARACTERES_ILEGAIS or ord(ch) < 32) else ch
                    for ch in str(texto or ""))
    limpo = re.sub(r"\s+", " ", limpo).strip()
    return limpo.rstrip(" .") or "timeline"


def nome_arquivo(nome_timeline: str, kind: str, sufixo_proxy: bool = False,
                 agora: Optional[datetime.datetime] = None) -> str:
    """<timeline>_<yyyy-mm-dd_hhmm>[_rascunho][_proxy].mp4, saneado.

    Sufixo no fim, antes da extensao (le-se naturalmente na pasta de saida).
    O trecho de timeline e truncado para o conjunto caber folgado no limite
    de ~255 chars do NTFS mesmo com pastas profundas.
    """
    ts = (agora or datetime.datetime.now()).strftime("%Y-%m-%d_%H%M")
    base = sanear_nome(nome_timeline)[:120]
    sufixo = "_rascunho" if kind == "draft" else ""
    if sufixo_proxy:
        sufixo += "_proxy"
    return f"{base}_{ts}{sufixo}.mp4"


# ---------------------------------------------------------------------------
# O comando
# ---------------------------------------------------------------------------

def _fmt(valor: float) -> str:
    """Numero curto e estavel para a CLI do ffmpeg (sem lixo de ponto flutuante)."""
    texto = f"{float(valor):.6f}".rstrip("0").rstrip(".")
    return texto if texto not in ("", "-0") else "0"


def montar_comando(seq, pedido, destino, *, rel_midia=None,
                   cfg: Optional[Dict[str, Any]] = None,
                   project_id: Optional[int] = None,
                   destino_validado: bool = False,
                   inicio_s: Optional[float] = None, fim_s: Optional[float] = None,
                   agora: Optional[datetime.datetime] = None) -> Dict[str, Any]:
    """Monta a linha completa do ffmpeg para UMA janela da timeline.

    `inicio_s`/`fim_s` existem para a renderizacao em segmentos (execucao.py);
    sem eles usa a faixa do proprio pedido. Devolve:

        {"cmd": [...], "duracao_s": float, "parametros": {...},
         "avisos": [...], "rotulo_video": "[vout]", "rotulo_audio": "[aout]|None"}

    Levanta ValueError/ RuntimeError com mensagem acionavel quando algo do
    contrato entre pacotes estiver quebrado -- recusar e melhor que renderizar
    errado.
    """
    cfg = cfg or config_render(project_id)

    duracao_total = seq.duracao_s()
    if inicio_s is None or fim_s is None:
        inicio_s, fim_s = pedido.faixa.resolver(duracao_total)
    inicio_s, fim_s = float(inicio_s), float(fim_s)
    duracao_janela = fim_s - inicio_s
    if duracao_janela <= 0:
        raise ValueError(
            f"Janela de render vazia ({inicio_s:g}s a {fim_s:g}s): nada para gravar.")

    param = parametros_saida(pedido, cfg, project_id)

    filtro_video_res = _chamar_grafo_video(seq, pedido.escopo, inicio_s, fim_s)
    rotulo_video = str(filtro_video_res.get("rotulo_video") or "[vout]")
    filtro_video = str(filtro_video_res.get("filter_complex") or "")

    resolver_tratado = None
    if rel_midia is not None and hasattr(rel_midia, "callback_tratado"):
        resolver_tratado = rel_midia.callback_tratado()

    filtro_audio_res: Optional[Dict[str, Any]] = None
    try:
        filtro_audio_res = _chamar_grafo_audio(seq, pedido.escopo, inicio_s, fim_s,
                                               resolver_tratado)
    except RuntimeError:
        if param["mute_audio"]:
            raise  # o pedido PEDIA silencio total e nem assim deu: erro real
        # Sem pacote B e sem mute explicito: seguir SEM AUDIO em silencio seria
        # mentir. Recusa com a mensagem do _chamar_grafo_audio.
        raise

    entradas_total: List[Dict[str, Any]] = []
    filtros: List[str] = []
    rotulo_audio: Optional[str] = None
    offset = len(filtro_video_res.get("entradas") or [])

    entradas_total += list(filtro_video_res.get("entradas") or [])
    filtros.append(filtro_video)

    if filtro_audio_res is not None and not param["mute_audio"]:
        entradas_audio = list(filtro_audio_res.get("entradas") or [])
        rotulo_audio = filtro_audio_res.get("rotulo_audio") or "[aout]"
        # Renumeracao LOCAL -> GLOBAL: os grafos numeram as PROPRIAS entradas
        # a partir de zero; ao concatena-las depois das de video, todo indice
        # do filtro de audio avanca pelo tamanho do bloco de video. Trocar
        # "[N:" por "[N+offset:" e seguro porque o padrao e fechado.
        if offset:
            filtro_audio = _renumerar(str(filtro_audio_res.get("filter_complex") or ""), offset)
        else:
            filtro_audio = str(filtro_audio_res.get("filter_complex") or "")
        entradas_total += entradas_audio
        if filtro_audio:
            filtros.append(filtro_audio)

    # Validacao no texto FINAL (ja com a renumeracao do audio aplicada): um
    # indice fora do vetor aqui renderizaria midia trocada em silencio.
    _validar_indices(";".join(f for f in filtros if f), len(entradas_total))

    # Caminhos reais (midia.py decidiu original x proxy x WAV tratado)
    if rel_midia is None:
        from . import midia as _midia  # import tardio evita ciclo midia<->comando
        rel_midia = _midia.resolver_fontes(seq, pedido)
    caminhos, avisos_casamento = casar_entradas(entradas_total, seq, rel_midia)

    cmd: List[str] = ["ffmpeg", "-hide_banner", "-nostdin"]

    for i, ent in enumerate(entradas_total):
        tipo = str(ent.get("tipo") or "video").lower()
        caminho = caminhos[i]
        if tipo == "cor":
            # Fonte lavfi (base preta etc.): o "caminho" e a propria expressao.
            cmd += ["-f", "lavfi", "-i", str(ent.get("caminho") or "color=c=black")]
            continue
        if not caminho:
            raise ValueError(
                f"entrada {i} ({tipo}) ficou sem midia resolvida; render recusado "
                "(entrar -i de arquivo inexistente renderizaria preto/lixo).")
        ss = float(ent.get("ss") or 0.0)
        t = float(ent.get("t") or 0.0)
        if ent.get("loop"):
            cmd += ["-loop", "1"]
        if ss > 0:
            # Secao 4.3: seek de ENTRADA (antes do -i) e barato; o de saida
            # decodificaria tudo desde o comeco. -accurate_seek e o default,
            # explicito aqui porque o plano pede a dupla a olho nu.
            cmd += ["-ss", _fmt(ss), "-accurate_seek"]
        elif ss == 0 and tipo != "cor":
            cmd += ["-accurate_seek"]
        if t > 0:
            cmd += ["-t", _fmt(t)]
        cmd += ["-i", caminho]

    fps_saida = param["fps"] if param["fps"] > 0 else (float(seq.fps) or 24.0)

    # Cadeia final: adapta a composicao (moldura da TIMELINE) para a moldura do
    # PRESET. Reels 9:16 reenquadra com letterbox preto; quando as dims batem a
    # cadeia e passatempo minimo, mas fica SEMPRE presente para todos os
    # segmentos sairem com parametros identicos (concat -c copy exige isso).
    fim_v = rotulo_video.strip("[]")
    cadeia_final = (
        f"[{rotulo_video}]"
        f"scale={param['largura']}:{param['altura']}:force_original_aspect_ratio=decrease,"
        f"pad={param['largura']}:{param['altura']}:(ow-iw)/2:(oh-ih)/2:black,"
        f"fps={_fmt(fps_saida)}"
        + (",format=yuv420p" if param["yuv420p"] else "")
        + f"[{fim_v}_final]"
    )
    filtros.append(cadeia_final)

    cmd += ["-filter_complex", ";".join(f for f in filtros if f)]
    cmd += ["-map", f"[{fim_v}_final]"]
    if rotulo_audio and not param["mute_audio"]:
        cmd += ["-map", str(rotulo_audio)]

    nome_enc, args_enc, e_hw = _resolver_encoder(param, project_id)
    cmd += ["-c:v", nome_enc, *args_enc]
    if e_hw and param["rascunho"]:
        # Rascunho em hardware: os args do pipeline ja sao rapidos; nada a trocar
        # sem inventar flag de outra fabricante. Registrado no log de INIT.
        pass

    cmd += ["-c:a", "aac", "-b:a", f"{int(param['audio_kbps'])}k"]
    cmd += ["-r", _fmt(fps_saida)]
    cmd += ["-t", _fmt(duracao_janela)]
    if param["faststart"]:
        cmd += ["-movflags", "+faststart"]
    cmd += ["-threads", str(int(cfg["render.threads"]))]
    cmd += ["-progress", "pipe:1", "-nostats"]
    destino_path = Path(destino)
    if destino_validado:
        cmd += ["-y"]
    cmd += [str(destino_path)]

    avisos = list(param["avisos"]) + list(avisos_casamento)
    if e_hw:
        avisos.append(
            f"Encoder por hardware ({nome_enc}): qualidade controlada pelos args do "
            "pipeline da casa (-cq/-global_quality/-qp); CRF do preset nao se aplica.")

    return {
        "cmd": cmd,
        "duracao_s": duracao_janela,
        "parametros": {**param, "encoder": nome_enc, "encoder_hardware": e_hw},
        "avisos": avisos,
        "rotulo_video": f"[{fim_v}_final]",
        "rotulo_audio": rotulo_audio if not param["mute_audio"] else None,
    }


def _renumerar(filtro: str, offset: int) -> str:
    """Avanca os indices [N:...] de um filter_complex em `offset` posicoes."""
    return _RE_INDICE.sub(lambda m: f"[{int(m.group(1)) + offset}:{m.group(2)}]", filtro or "")


# ---------------------------------------------------------------------------
# Estimativa de tamanho (fidelidade.py mostra no modal)
# ---------------------------------------------------------------------------

# Bits por pixel por frame para H.264 em CRF ~18 medidos informalmente no
# acervo da casa; GROSSEIRO de proposito (CRF nao determina bitrate). Serve
# para o modal mostrar uma ordem de grandeza honesta, nao uma promessa.
_BPP_MASTER = 0.10
_BPP_RASCUNHO = 0.05


def tamanho_estimado_bytes(seq, param: Dict[str, Any], duracao_s: float) -> int:
    if duracao_s <= 0:
        return 0
    fps = param["fps"] if param["fps"] > 0 else (float(seq.fps) or 24.0)
    bpp = _BPP_RASCUNHO if param["rascunho"] else _BPP_MASTER
    video_bps = param["largura"] * param["altura"] * fps * bpp
    audio_bps = int(param["audio_kbps"]) * 1000
    return int((video_bps + audio_bps) * duracao_s / 8.0)
