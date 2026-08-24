"""Relatorio pre-export de FIDELIDADE (pacote C): a peca de honestidade.

Responde, ANTES de renderizar: "o que, nesta timeline, o motor ainda nao sabe
reproduzir igual a tela?" Nada aqui impede ou conserta nada: so descreve. Quem
decide bloquear e a politica (nivel "block"); quem mostra o banner ambar e o
modal (pacote E), alimentado pelo preflight (pacote D).

A distincao que norteia este modulo (plano, secao 2 -- vale reler):

    FIDELIDADE = capacidade do motor. Limitacao => aviso explicito.
    ESCOPO     = escolha do editor. Toggle desligado / efeito `disabled:true`
                 e DELIBERADO => NUNCA vira banner.

Por isso os avisos abaixo checam SEMPRE o escopo antes de reclamar: um clipe
com `audio_dynamics` desligado na categoria "audio_fx" nao tem divergencia
nenhuma -- o editor pediu para sair, e sai.
"""
from typing import Any, Dict, List, Optional

from .comando import (
    config_render,
    parametros_saida,
    tamanho_estimado_bytes,
    _clipes_em_cena,
)
from .modelo import EFEITOS_POR_CATEGORIA

# Tipos de efeito que o motor CONHECE. Fora desta lista = o grafo ignora o bloco,
# e ignorar em silencio e exatamente o que o plano proibe.
TIPOS_EFEITO_CONHECIDOS = frozenset(
    {t for tipos in EFEITOS_POR_CATEGORIA.values() for t in tipos} | {"audio_render"}
)

# Kinds de pista que o motor conhece (P1/P2/P3 do modelo.py).
KINDS_PISTA_CONHECIDOS = frozenset({"video", "audio", "ai"})

# ---------------------------------------------------------------------------
# TEXTOS EM PONTO UNICO. O pacote B esta medindo as divergencias reais de
# audio; quando o numero chegar, atualize AQUI e so aqui.
# ---------------------------------------------------------------------------

# Medido em 24/08/2026 (senoide de fundo de escala, varredura de -36 a 0 dBFS,
# limiar -18 dB, razao 4:1, curva estatica conferida contra o ffmpeg real):
# a maior diferenca de ganho entre as duas curvas e 2,06 dB, no limiar. Nos
# extremos elas convergem (0,00 dB acima de -4 e abaixo de -32 dBFS). O que muda
# nao e a compressao no pico, e ONDE ela comeca: 11 dB antes na tela.
TEXTO_JOELHO_COMPRESSOR = (
    "O compressor da tela (WebAudio) tem joelho de 30 dB; o do ffmpeg vai ate 8. "
    "Medido: a diferenca maxima de ganho e de 2,1 dB, bem em cima do limiar, e "
    "cai a zero nos extremos. Na pratica o arquivo comeca a comprimir mais tarde "
    "e solta mais cedo: a compressao age de -22 a -14 dBFS, contra -33 a -3 na "
    "tela. Em voz com dinamica larga isso soa como um pouco menos de 'cola'."
)

TEXTO_DETECTOR_GATE = (
    "O gate ao vivo decide por bloco de 128 amostras (AudioWorklet); o agate do "
    "ffmpeg decide por amostra. A diferenca tende a ser inaudivel, mas o plano "
    "exige medicao (secao 12.2), nao suposicao. Enquanto nao medida, fica no "
    "banner."
)

# O aviso do gate segue o plano (secao 3.6: "duas divergencias conhecidas vao
# para o banner"). Se o dia-a-dia mostrar que ele so faz ruido, basta trocar
# para False -- num lugar so, como tudo neste modulo.
EXIBIR_AVISO_GATE = True


def _aviso(nivel: str, codigo: str, titulo: str, detalhe: str,
           clipes: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "nivel": nivel,          # "block" | "warn"
        "codigo": codigo,
        "titulo": titulo,
        "detalhe": detalhe,
        "clipes": list(clipes or []),
    }


def _numero(valor) -> Optional[float]:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return None
    return None if n != n else n


def _faixa_efetiva(seq, pedido):
    try:
        return pedido.faixa.resolver(seq.duracao_s())
    except ValueError:
        # Faixa IN/OUT vazia: quem valida e execucao/midia; aqui o resumo
        # precisa de numeros plausiveis para o modal abrir sem quebrar.
        return 0.0, min(pedido.faixa.fim_s if pedido.faixa.fim_s else seq.duracao_s(),
                        seq.duracao_s())


def relatorio(seq, pedido, relatorio_midia) -> Dict[str, Any]:
    """Monta o relatorio completo do preflight.

    Devolve:
      {
        "pode_renderizar": bool,          # False quando ha aviso nivel block
        "avisos": [{nivel, codigo, titulo, detalhe, clipes}, ...],
        "resumo": {duracao_s, contagem_clipes, contagem_pistas_video/audio,
                   por_pista: {track_id: {"nome", "clipes"}}, fps,
                   largura, altura, largura_saida, altura_saida,
                   preset, rascunho, tamanho_estimado_bytes, tamanho_estimado_mb}
      }
    """
    cfg = config_render()
    param = parametros_saida(pedido, cfg)
    inicio, fim = _faixa_efetiva(seq, pedido)

    em_cena = [c for c in _clipes_em_cena(seq)
               if c.fim_s > inicio + 1e-9 and c.inicio_s < fim - 1e-9]

    avisos: List[Dict[str, Any]] = []

    # ------------------------------------------------------------------ BLOCK
    if getattr(relatorio_midia, "ausentes", None):
        ids = sorted(set(relatorio_midia.ausentes))
        avisos.append(_aviso(
            "block", "MIDIA_AUSENTE",
            "Midia ausente (nem original nem proxy)",
            "Os clipes abaixo nao tem arquivo nenhum no disco. Renderizar preto "
            "no lugar deles seria mentir: reconecte o HD, restaure os arquivos "
            "ou remova os clipes da timeline.",
            ids))

    if (relatorio_midia.originais_indisponiveis
            and not relatorio_midia.usa_proxy_fallback
            and str(getattr(pedido, "kind", "master")) == "master"):
        letras = sorted(set(getattr(relatorio_midia, "drives_fora", [])))
        avisos.append(_aviso(
            "block", "MASTER_SEM_ORIGINAL_SEM_FALLBACK",
            "Original indisponivel e fallback para proxy nao autorizado",
            "O master sai do ORIGINAL por decisao de produto. Os originais dos "
            "clipes listados nao responderam"
            + (f" (drive(s) {', '.join(letras)} parece(m) desconectado(s))"
               if letras else "")
            + ". Conecte o HD, ou refaca o pedido com permitir_fallback_proxy=true "
              "(o arquivo sai de proxy, com sufixo '_proxy' no nome e aviso no log).",
            sorted(set(relatorio_midia.originais_indisponiveis))))

    # ------------------------------------------------------------------- WARN
    if getattr(relatorio_midia, "usa_proxy_fallback", False):
        avisos.append(_aviso(
            "warn", "MASTER_CAINDO_PARA_PROXY",
            "Master saindo de PROXY (original indisponivel)",
            "Com autorizacao explicita, estes clipes vao renderizar do proxy 720p "
            "em vez do original. O arquivo tera sufixo '_proxy' no nome e o log da "
            "tarefa registra a mesma lista. Geometrica e colorimetria sao as mesmas; "
            "a resolucao da fonte e que e menor.",
            sorted(set(relatorio_midia.clipes_proxy))))

    # audio_dynamics: so interessa se a categoria esta LIGADA (escopo desligado
    # e escolha do editor, nao limitacao do motor) e o bloco nao esta bypassed.
    clipes_comp: List[str] = []
    clipes_gate: List[str] = []
    for clipe in em_cena:
        din = clipe.efeito("audio_dynamics")  # ja respeita disabled:true (regra P5)
        if din is None or not pedido.escopo.categoria_ligada("audio_fx"):
            continue
        ratio = _numero(din.get("comp_ratio"))
        if ratio is not None and ratio > 1.0:
            clipes_comp.append(clipe.id)
        gate_db = _numero(din.get("gate_db"))
        if gate_db is not None and gate_db > -90.0:
            clipes_gate.append(clipe.id)

    if clipes_comp:
        avisos.append(_aviso(
            "warn", "JOELHO_COMPRESSOR_LIMITADO",
            "Compressor com knee diferente do navegador",
            TEXTO_JOELHO_COMPRESSOR,
            sorted(set(clipes_comp))))
    if EXIBIR_AVISO_GATE and clipes_gate:
        avisos.append(_aviso(
            "warn", "DETECTOR_GATE_DIVERGENTE",
            "Gate com detector diferente do navegador",
            TEXTO_DETECTOR_GATE,
            sorted(set(clipes_gate))))

    # Pista com kind desconhecido (ex.: "text" do plano futuro): seus clipes
    # seriam simplesmente ignorados pelo grafo. Avisar, nunca engolir.
    clipes_pista_desconhecida: List[str] = []
    pistas_desconhecidas: List[str] = []
    for pista in seq.pistas:
        if str(pista.kind).lower() not in KINDS_PISTA_CONHECIDOS:
            pistas_desconhecidas.append(f"{pista.nome} (kind={pista.kind})")
            clipes_pista_desconhecida.extend(c.id for c in em_cena if c.track == pista.id)
    if clipes_pista_desconhecida:
        avisos.append(_aviso(
            "warn", "PISTA_KIND_DESCONHECIDO",
            "Pista de tipo desconhecido sera ignorada",
            "As pistas abaixo tem kind fora do que o motor conhece "
            f"({', '.join(sorted(KINDS_PISTA_CONHECIDOS))}): "
            f"{', '.join(pistas_desconhecidas)}. Os clipes delas NAO entram no "
            "arquivo -- mesmo comportamento da regra das pistas de IA (P1), mas "
            "declarado aqui em vez de ignorado em silencio.",
            sorted(set(clipes_pista_desconhecida))))

    # Efeito de tipo desconhecido: seria descartado pelo grafo. disabled:true
    # NAO gera aviso (bypass deliberado, regra P5); categoria desmarcada tambem
    # nao aparece aqui porque tipos desconhecidos nao pertencem a categoria nenhuma.
    por_tipo: Dict[str, List[str]] = {}
    for clipe in em_cena:
        for e in clipe.effects or []:
            if not isinstance(e, dict):
                continue
            tipo = str(e.get("type") or "").strip()
            if not tipo or tipo in TIPOS_EFEITO_CONHECIDOS:
                continue
            if e.get("disabled"):
                continue  # bypass deliberado: escolha do editor, nao limitacao
            por_tipo.setdefault(tipo, []).append(clipe.id)
    if por_tipo:
        resumo_tipos = "; ".join(
            f"{tipo}: {', '.join(sorted(set(ids)))}" for tipo, ids in sorted(por_tipo.items()))
        avisos.append(_aviso(
            "warn", "EFEITO_TIPO_DESCONHECIDO",
            "Efeito desconhecido sera descartado",
            "Estes blocos de efeito nao existem no vocabulario do motor e serao "
            "ignorados no render (na tela o player tambem os ignora, entao e "
            "paridade -- mas o plano exige dizer, nao calar): " + resumo_tipos,
            sorted({cid for ids in por_tipo.values() for cid in ids})))

    # Clipe sem referencia nenhuma de midia: na tela ele tambem aparece vazio
    # (player.js:_videoSrcForCut devolve null), entao e PARIDADE, nao falha --
    # porem merece banner porque provavelmente e dado quebrado na timeline.
    if getattr(relatorio_midia, "sem_referencia", None):
        avisos.append(_aviso(
            "warn", "CLIPE_SEM_REFERENCIA_DE_MIDIA",
            "Clipe sem video_id/photo_id",
            "Estes clipes nao apontam para midia nenhuma e saem pretos no arquivo "
            "-- igual aparecem na tela. Provavelmente dado quebrado na timeline.",
            sorted(set(relatorio_midia.sem_referencia))))

    # Bloco audio_render declarado ready mas o WAV sumiu do disco: fonte voltou
    # ao original (mesma decisao do export OTIO). O render segue CORRETO, porem
    # sem o tratamento -- o editor precisa saber disso antes de exportar.
    sem_tratamento = [
        (fonte.clipe_id, fonte.motivo_tratado)
        for fonte in (relatorio_midia.fontes or {}).values()
        if getattr(fonte, "motivo_tratado", None)
    ]
    if sem_tratamento:
        avisos.append(_aviso(
            "warn", "WAV_TRATADO_INDISPONIVEL",
            "Audio tratado declarado pronto sumiu do disco",
            "O bloco audio_render destes clipes diz 'ready', mas o arquivo nao "
            "esta mais no disco. A fonte volta ao ORIGINAL (apontar para arquivo "
            "inexistente seria pior) e o render sai SEM o tratamento: "
            + "; ".join(f"{cid} ({motivo})" for cid, motivo in sem_tratamento),
            [cid for cid, _ in sem_tratamento]))

    # ------------------------------------------------------------------ RESUMO
    duracao = max(0.0, fim - inicio)
    por_pista: Dict[str, Dict[str, Any]] = {}
    for pista in seq.pistas:
        if pista.e_ia:
            continue
        n = sum(1 for c in em_cena if c.track == pista.id)
        if n:
            por_pista[pista.id] = {"nome": pista.nome, "kind": pista.kind, "clipes": n}

    estimado = tamanho_estimado_bytes(seq, param, duracao)
    resumo = {
        "duracao_s": round(duracao, 3),
        "contagem_clipes": len(em_cena),
        "por_pista": por_pista,
        "fps": float(seq.fps),
        "largura": int(seq.largura),
        "altura": int(seq.altura),
        "largura_saida": param["largura"],
        "altura_saida": param["altura"],
        "preset": param["preset"],
        "rascunho": bool(param["rascunho"]),
        "encoder": param.get("encoder"),
        "tamanho_estimado_bytes": estimado,
        "tamanho_estimado_mb": round(estimado / (1024 * 1024), 1),
    }

    return {
        "pode_renderizar": not any(a["nivel"] == "block" for a in avisos),
        "avisos": avisos,
        "resumo": resumo,
    }
