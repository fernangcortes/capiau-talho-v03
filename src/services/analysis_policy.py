"""Perfis de esforço de análise por categoria (E2.C1 do plano).

A triagem (Eixo A) já diz o que o material é antes da varredura cara. Este módulo
traduz essa categoria em quanto esforço de visão o vídeo merece: material que vai
ao corte recebe a análise completa; teste de câmera e registro pessoal recebem o
mínimo para continuar buscável.

Sem viés de conteúdo: o mapa fala de categorias da taxonomia, nunca de "making of".
O usuário pode redefinir qualquer categoria pelo setting `analysis.effort_overrides`
(JSON `{"categoria": "esforço"}`); vazio = o mapa padrão abaixo.
"""
import json
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

# ── Níveis de esforço ────────────────────────────────────────────────────────

EFFORT_FULL = "completo"
EFFORT_REDUCED = "reduzido"
EFFORT_TRIAGE = "triagem"

EFFORT_LEVELS: Tuple[str, ...] = (EFFORT_FULL, EFFORT_REDUCED, EFFORT_TRIAGE)

EFFORT_LABELS: Dict[str, str] = {
    EFFORT_FULL: "completo (shots + beats + cobertura por intervalo)",
    EFFORT_REDUCED: "reduzido (1 keyframe por shot, sem beats)",
    EFFORT_TRIAGE: "triagem (2 keyframes, sem beats)",
}


@dataclass(frozen=True)
class EffortProfile:
    """O que cada nível de esforço liga ou desliga na análise de visão."""

    effort: str
    detect_beats: bool          # subdividir planos longos por deriva visual (E2.A3)
    coverage_floor: bool        # fatiar segmento longo em keyframes de ~frame_interval
    max_keyframes: Optional[int]  # teto próprio do perfil (None = teto global do pipeline)

    @property
    def label(self) -> str:
        return EFFORT_LABELS.get(self.effort, self.effort)


PROFILES: Dict[str, EffortProfile] = {
    # Comportamento atual do pipeline (paridade: nada muda para estas categorias)
    EFFORT_FULL: EffortProfile(EFFORT_FULL, detect_beats=True, coverage_floor=True, max_keyframes=None),
    # 1 keyframe por shot: sem beats e sem piso de cobertura (um teste de câmera de
    # 5 min não precisa de um frame a cada 10s)
    EFFORT_REDUCED: EffortProfile(EFFORT_REDUCED, detect_beats=False, coverage_floor=False, max_keyframes=None),
    # Só o suficiente para o material existir na busca
    EFFORT_TRIAGE: EffortProfile(EFFORT_TRIAGE, detect_beats=False, coverage_floor=False, max_keyframes=2),
}

# ── Mapa categoria -> esforço ────────────────────────────────────────────────

# Números provisórios (os mesmos da taxonomia anterior, com as chaves novas): a calibração
# por categoria está em docs/planos/REVISAO_CATEGORIAS.md, seção 12.
DEFAULT_EFFORT_BY_CATEGORY: Dict[str, str] = {
    "cena": EFFORT_FULL,
    "bastidor": EFFORT_FULL,
    "depoimento": EFFORT_FULL,
    "evento": EFFORT_FULL,
    "teste": EFFORT_REDUCED,
    "terceiros": EFFORT_REDUCED,
    # Documento filmado é conteúdo estático: 1 frame por plano basta para ler a página.
    "documento": EFFORT_REDUCED,
    "convivio": EFFORT_TRIAGE,
}

# Marca do eixo 2: material sem relação com o projeto recebe só o mínimo para existir na busca
EFFORT_FORA_DO_PROJETO = EFFORT_TRIAGE


def _chave(categoria: Any) -> str:
    """Chave canônica (aceita nome antigo, caixa e acento); desconhecida volta como veio."""
    from src.nlp.prompt_registry import normalizar_categoria
    bruta = str(categoria).strip().lower()
    return normalizar_categoria(bruta) or bruta

# Categoria ausente (triagem falhou, vídeo antigo) ou desconhecida: nunca economizar
# às cegas — o default é o comportamento de antes do E2.C1.
FALLBACK_EFFORT = EFFORT_FULL


def parse_overrides(raw: Any) -> Dict[str, str]:
    """Lê o JSON do setting. Entrada inválida = {} (o mapa padrão vale)."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        data = raw
    else:
        try:
            data = json.loads(str(raw))
        except (ValueError, TypeError):
            print("[AnalysisPolicy] analysis.effort_overrides nao e um JSON valido; usando o mapa padrao")
            return {}
    if not isinstance(data, dict):
        print("[AnalysisPolicy] analysis.effort_overrides deve ser um objeto JSON; usando o mapa padrao")
        return {}

    clean: Dict[str, str] = {}
    for cat, effort in data.items():
        cat_key = _chave(cat)
        effort_key = str(effort).strip().lower()
        if effort_key not in EFFORT_LEVELS:
            print(f"[AnalysisPolicy] esforco '{effort}' desconhecido para '{cat}'; ignorado")
            continue
        clean[cat_key] = effort_key
    return clean


def validate_overrides(raw: str) -> Tuple[bool, str]:
    """Valida o JSON no momento da escrita (usado pelo painel de configurações).

    Retorna (True, "") ou (False, mensagem). Diferente do parse_overrides, aqui um
    valor inválido é rejeitado em vez de ignorado — o usuário precisa saber que o
    perfil que ele digitou não vale.
    """
    if not raw or not raw.strip():
        return True, ""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as e:
        return False, f"JSON invalido: {e}"
    if not isinstance(data, dict):
        return False, 'Use um objeto JSON, ex: {"convivio": "completo"}'

    known = set(DEFAULT_EFFORT_BY_CATEGORY)
    for cat, effort in data.items():
        if _chave(cat) not in known:
            return False, f"Categoria desconhecida: '{cat}' (use uma de: {', '.join(sorted(known))})"
        if str(effort).strip().lower() not in EFFORT_LEVELS:
            return False, f"Esforco invalido para '{cat}': use {' | '.join(EFFORT_LEVELS)}"
    return True, ""


def resolve_effort(category: Optional[str], overrides_raw: Any = None) -> str:
    """Categoria -> nível de esforço, com os overrides do usuário por cima."""
    if not category:
        return FALLBACK_EFFORT
    cat = _chave(category)
    overrides = parse_overrides(overrides_raw)
    if cat in overrides:
        return overrides[cat]
    return DEFAULT_EFFORT_BY_CATEGORY.get(cat, FALLBACK_EFFORT)


# Ordem de custo: serve para saber se uma mudança de categoria pede MAIS análise
EFFORT_RANK: Dict[str, int] = {EFFORT_TRIAGE: 0, EFFORT_REDUCED: 1, EFFORT_FULL: 2}

# Correção humana grava confiança 1.0 (media.py): ela manda, mesmo contra a Laya
CONFIANCA_HUMANA = 1.0

_NAO_INFORMADA = object()


def categoria_incerta(confianca: Any, limiar: Optional[float] = None,
                      categoria: Optional[str] = None, categoria_laya: Optional[str] = None) -> bool:
    """A categoria da triagem é firme o bastante para cortar esforço?

    Incerta quando: não há confiança registrada; a confiança está abaixo do limiar
    (`triage.min_confidence`); ou a Laya, que roda em sombra, discordou. A confiança
    que o modelo declara sai ~0,9 para quase tudo, então a discordância entre dois
    motores independentes é o sinal que de fato separa os casos duvidosos.
    """
    if confianca is None:
        return True
    try:
        conf = float(confianca)
    except (TypeError, ValueError):
        return True
    if conf >= CONFIANCA_HUMANA:
        return False
    if limiar is not None and conf < float(limiar):
        return True
    if categoria and categoria_laya:
        return _chave(categoria_laya) != _chave(categoria)
    return False


def get_profile(category: Optional[str], overrides_raw: Any = None, *, confianca: Any = _NAO_INFORMADA,
                limiar: Optional[float] = None, categoria_laya: Optional[str] = None,
                secundarias: Optional[list] = None, fora_do_projeto: bool = False) -> EffortProfile:
    """Perfil de esforço aplicável ao material desta categoria.

    Com `confianca` informada (pode ser None = vazia), categoria incerta usa o perfil
    completo: o piso só sobe o esforço, nunca corta. Sem `confianca`, comportamento antigo.
    Vídeo misto (`secundarias`) recebe o perfil mais caro entre as categorias que tem.
    Fora do projeto, com triagem firme, recebe o mínimo.
    """
    if (category and confianca is not _NAO_INFORMADA
            and categoria_incerta(confianca, limiar, category, categoria_laya)):
        return PROFILES[EFFORT_FULL]
    if fora_do_projeto:
        return PROFILES[EFFORT_FORA_DO_PROJETO]
    effort = resolve_effort(category, overrides_raw)
    for sec in secundarias or []:
        outro = resolve_effort(sec, overrides_raw)
        if EFFORT_RANK[outro] > EFFORT_RANK[effort]:
            effort = outro
    return PROFILES[effort]
