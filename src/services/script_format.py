"""Deteccao do formato de um roteiro e segmentacao em cenas (P2.1a).

POR QUE ISTO NAO E UM REGEX SO
------------------------------
A primeira versao deste modulo usaria um unico padrao, `^(INT|EXT|INT/EXT|I/E)[.\\s]`,
calibrado medindo o roteiro real do usuario (111 ancoras). Testado contra variacoes
normais de formatacao, ele falha em 7 de 10 casos - inclusive no `.fdx`, que e o
formato com a MELHOR estrutura disponivel (o Final Draft marca cada paragrafo como
"Scene Heading", e o upload grava isso como prefixo `SCENE HEADING: ...`, que um regex
ancorado em INT/EXT nunca casaria).

Pior: a falha e silenciosa. Medido no roteiro real, numerando as cenas (um draft de
producao comum, `12. INT. CASA - DIA`), o mesmo arquivo cai de 111 cenas (mediana de
609 chars) para 7 cenas (a maior com 31.706 chars). Um fallback do tipo
`if len(ancoras) < 3` NAO dispara nesse caso, entao o pipeline gastaria API e gravaria
uma estrutura inutil sem nenhum aviso - a mesma classe de bug do E2.A5 e do E2.B4.

Dai a cascata:
  Camada 0  estrutura nativa do formato (.fdx, .fountain) - confianca maxima
  Camada 1  biblioteca de padroes candidatos que competem por pontuacao
  Camada 2  VALIDACAO do resultado (cobertura, dispersao, densidade)
  Camada 3  o LLM le uma amostra e identifica a convencao do documento
  Camada 4  modo 'prose': documento sem cenas nao ganha cenas inventadas

A numeracao e sempre atribuida por POSICAO (1..N) pelo Python, nunca pelo LLM:
roteiros reais frequentemente nao tem numero no texto e repetem headings.
"""
import re
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Um heading de cena e uma linha curta; paragrafos de acao longos que por acaso
# comecem com "INTERIOR..." nao sao ancora.
MAX_HEADING_LEN = 120

# Numero de cena na margem esquerda: "12.", "12)", "12 ", e tambem "13A." -- cenas
# inseridas em revisao ganham sufixo de letra em qualquer roteiro de producao.
_NUM_PREFIX = r"(?:\d{1,4}[A-Za-z]{0,2}\s*[.):\-]?\s+)?"

_SLUG_WORDS = r"(?:INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\.?\/E\.?|INT|EXT|EST|INTERIOR|EXTERIOR)"


@dataclass
class StructureReport:
    """Resultado da deteccao: o que foi encontrado e o quanto se pode confiar."""
    strategy: str
    anchors: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    stats: Dict[str, Any] = field(default_factory=dict)
    issues: List[str] = field(default_factory=list)
    needs_review: bool = False

    @property
    def scene_count(self) -> int:
        return len(self.anchors)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "strategy": self.strategy,
            "scene_count": self.scene_count,
            "confidence": round(self.confidence, 3),
            "stats": self.stats,
            "issues": self.issues,
            "needs_review": self.needs_review,
            "sample": [
                {"number": a["number"], "heading": a["heading"]}
                for a in self.anchors[:5]
            ],
        }


# ── Camada 0 e 1: padroes candidatos ─────────────────────────────────────────

CANDIDATE_PATTERNS: List[Dict[str, Any]] = [
    {
        # .fdx: o upload (routes/projects.py) grava "SCENE HEADING: INT. CASA - DIA".
        # E a ancora mais confiavel que existe: veio marcada pelo proprio Final Draft.
        "id": "fdx",
        "regex": re.compile(r"^\s*SCENE HEADING\s*:\s*(?P<heading>.+)$", re.IGNORECASE),
        "native": True,
    },
    {
        # Fountain: heading forcado com ponto no inicio (".DE VOLTA A COLINA").
        # Exige maiuscula depois do ponto para nao capturar "...reticencias".
        "id": "fountain_forced",
        "regex": re.compile(r"^\.(?P<heading>[^\s.].*)$"),
        "native": True,
    },
    {
        # Sluglines classicas, multilingues, tolerando numero nas duas margens.
        "id": "sluglines",
        "regex": re.compile(rf"^\s*{_NUM_PREFIX}(?P<heading>{_SLUG_WORDS}[\s.\-].*)$", re.IGNORECASE),
        "native": False,
    },
    {
        "id": "cena_numerada",
        "regex": re.compile(r"^\s*(?P<heading>(?:CENA|SCENE|SEQU[EÊ]NCIA|SEQ)\s*\d+.*)$", re.IGNORECASE),
        "native": False,
    },
    {
        "id": "markdown",
        "regex": re.compile(r"^\s*#{1,3}\s+(?P<heading>.+)$"),
        "native": False,
    },
]

# Linha toda em maiusculas, curta, isolada. Fraco e generico: so entra se nada
# melhor pontuar, porque casa tambem com nomes de personagem em roteiro formatado.
_CAPS_LINE = re.compile(r"^\s*(?P<heading>[^a-z]{4,%d})\s*$" % MAX_HEADING_LEN)


def _extract_anchors(content: str, pattern: re.Pattern, require_caps: bool = False) -> List[Dict[str, Any]]:
    """Aplica um padrao ao documento e devolve as ancoras numeradas por posicao."""
    anchors: List[Dict[str, Any]] = []
    offset = 0
    for line in content.splitlines(keepends=True):
        stripped = line.strip()
        if stripped and len(stripped) <= MAX_HEADING_LEN:
            m = pattern.match(stripped)
            if m:
                heading = (m.groupdict().get("heading") or stripped).strip()
                if not require_caps or heading == heading.upper():
                    anchors.append({
                        "number": len(anchors) + 1,
                        "heading": heading,
                        "start": offset,
                        "end": None,
                    })
        offset += len(line)

    for i, a in enumerate(anchors):
        a["end"] = anchors[i + 1]["start"] if i + 1 < len(anchors) else len(content)
    return anchors


# ── Camada 2: validacao ──────────────────────────────────────────────────────

def segment_stats(anchors: List[Dict[str, Any]], content: str) -> Dict[str, Any]:
    """Metricas que dizem se uma segmentacao e plausivel."""
    total = len(content) or 1
    if not anchors:
        return {"scenes": 0, "coverage": 0.0, "median_len": 0, "max_len": 0, "ratio": 0.0, "density": 0.0}

    lengths = [a["end"] - a["start"] for a in anchors]
    median = statistics.median(lengths)
    covered = sum(lengths)
    return {
        "scenes": len(anchors),
        "coverage": round(covered / total, 3),
        "median_len": int(median),
        "max_len": int(max(lengths)),
        "ratio": round(max(lengths) / median, 2) if median else 0.0,
        "density": round(len(anchors) / (total / 10000), 2),
    }


def validate_segmentation(
    anchors: List[Dict[str, Any]], content: str,
    min_coverage: float = 0.6, max_median_chars: int = 4000,
    max_scene_ratio: float = 25.0, min_scenes: int = 3
) -> Tuple[bool, List[str], Dict[str, Any]]:
    """Reprova segmentacoes implausiveis ANTES de gastar API.

    Calibracao medida no acervo real (nao chutada): o roteiro do projeto, bem
    segmentado, da mediana de 610 chars por cena e dispersao 9,3; a segmentacao
    quebrada de um draft numerado dava mediana de 10.810 chars com dispersao 2,9.
    Ou seja, a DISPERSAO nao separa os dois casos (o quebrado ate parece mais
    uniforme, porque junta tudo em poucos blocos grandes) - quem separa e o TAMANHO
    MEDIANO da cena. A dispersao fica como rede secundaria, com limite folgado, para
    pegar outro defeito: uma regiao inteira de cenas nao reconhecida no meio do texto.
    """
    stats = segment_stats(anchors, content)
    issues: List[str] = []

    if stats["scenes"] < min_scenes:
        issues.append(f"poucas cenas detectadas ({stats['scenes']})")
    if stats["coverage"] < min_coverage:
        issues.append(f"cobertura baixa do texto ({stats['coverage']:.0%})")
    if stats["median_len"] > max_median_chars:
        issues.append(
            f"cenas grandes demais para serem cenas (mediana de {stats['median_len']} chars) "
            "- provavel padrao de cena nao reconhecido"
        )
    if stats["ratio"] > max_scene_ratio:
        issues.append(
            f"uma cena destoa muito das outras ({stats['max_len']} chars contra mediana "
            f"de {stats['median_len']}) - provavel trecho com cenas nao reconhecidas"
        )

    return (not issues), issues, stats


def _score(stats: Dict[str, Any], native: bool, ok: bool) -> float:
    """Nota de um candidato: cobertura pesa mais, depois cenas de tamanho plausivel."""
    if stats["scenes"] == 0:
        return 0.0
    score = stats["coverage"] * 0.6
    # Cena de tamanho tipico de roteiro (algumas centenas de chars) vale mais que
    # blocao de milhares - e o mesmo sinal que a validacao usa.
    if stats["median_len"]:
        score += min(1.0, 2000.0 / stats["median_len"]) * 0.25
    score += min(1.0, stats["scenes"] / 20.0) * 0.15
    if native:
        score += 0.25  # estrutura declarada pelo proprio formato vale mais que heuristica
    if not ok:
        score *= 0.4
    return min(1.0, score)


# ── Camada 3: o LLM identifica a convencao ───────────────────────────────────

def _detect_via_llm(content: str, project_id: Optional[int]) -> Optional[Dict[str, Any]]:
    """Manda uma amostra ao modelo de texto barato e pergunta qual e o delimitador de cena.

    So roda quando as heuristicas locais falham. Uma chamada por documento. E isto que
    permite atender um formato que ninguem previu, em vez de tentar enumerar todos.
    """
    try:
        from src.nlp.llm_text import call_text_llm
        from src.nlp.prompt_registry import get_prompt

        sample = content[:6000]
        prompt = get_prompt("script_format_detect", project_id=project_id, sample=sample)
        data, _usage = call_text_llm(
            prompt, project_id=project_id, log_prefix="ScriptFormat",
            max_tokens=400, temperature=0.0, timeout=60,
        )
        if not data:
            return None

        raw = (data.get("regex") or "").strip()
        if not raw:
            return None
        return {"regex": re.compile(raw, re.IGNORECASE), "explanation": data.get("explanation", "")}
    except re.error as e:
        print(f"[ScriptFormat] Regex invalido devolvido pelo LLM: {e}")
        return None
    except Exception as e:
        print(f"[ScriptFormat] Deteccao por LLM indisponivel: {e}")
        return None


# ── Orquestracao ─────────────────────────────────────────────────────────────

def detect_structure_for_project(content: str, filename: str, project_id: Optional[int]) -> StructureReport:
    """detect_structure() com os parametros vindos das configuracoes do projeto.

    Falha de leitura de settings nao pode derrubar a deteccao: cai nos defaults.
    """
    forced, min_cov, max_median, max_ratio, allow_llm = "auto", 0.6, 4000, 25.0, True
    try:
        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        forced = S.get("script.anchor_strategy")
        min_cov = S.get("script.min_coverage")
        max_median = S.get("script.max_median_chars")
        max_ratio = S.get("script.max_scene_ratio")
        allow_llm = S.get("script.llm_format_detection")
    except Exception as e:
        print(f"[ScriptFormat] Configuracoes indisponiveis, usando defaults: {e}")

    return detect_structure(
        content, filename=filename, project_id=project_id, forced_strategy=forced,
        min_coverage=min_cov, max_median_chars=max_median, max_scene_ratio=max_ratio,
        allow_llm=allow_llm,
    )


def detect_structure(
    content: str, filename: str = "", project_id: Optional[int] = None,
    forced_strategy: Optional[str] = None,
    min_coverage: float = 0.6, max_median_chars: int = 4000, max_scene_ratio: float = 25.0,
    allow_llm: bool = True,
) -> StructureReport:
    """Descobre como o documento separa cenas e devolve as ancoras numeradas 1..N."""
    content = content or ""
    ext = Path(filename or "").suffix.lower()

    if forced_strategy and forced_strategy not in ("auto", ""):
        if forced_strategy == "prose":
            return StructureReport(strategy="prose", confidence=1.0, stats=segment_stats([], content))
        pattern = next((p for p in CANDIDATE_PATTERNS if p["id"] == forced_strategy), None)
        if pattern:
            anchors = _extract_anchors(content, pattern["regex"])
            ok, issues, stats = validate_segmentation(anchors, content, min_coverage, max_median_chars, max_scene_ratio)
            return StructureReport(
                strategy=forced_strategy, anchors=anchors,
                confidence=_score(stats, pattern["native"], ok),
                stats=stats, issues=issues, needs_review=not ok,
            )

    # Camadas 0 e 1: todos os candidatos competem; o formato do arquivo so da preferencia.
    results = []
    for pattern in CANDIDATE_PATTERNS:
        anchors = _extract_anchors(content, pattern["regex"])
        if not anchors:
            continue
        native = pattern["native"] and (
            (pattern["id"] == "fdx" and ext == ".fdx")
            or (pattern["id"] == "fountain_forced" and ext == ".fountain")
            or pattern["id"] == "fdx"  # o prefixo SCENE HEADING: e inequivoco em qualquer extensao
        )
        ok, issues, stats = validate_segmentation(anchors, content, min_coverage, max_median_chars, max_scene_ratio)
        results.append({
            "id": pattern["id"], "anchors": anchors, "ok": ok, "issues": issues,
            "stats": stats, "score": _score(stats, native, ok),
        })

    caps = _extract_anchors(content, _CAPS_LINE, require_caps=True)
    if caps:
        ok, issues, stats = validate_segmentation(caps, content, min_coverage, max_median_chars, max_scene_ratio)
        results.append({
            "id": "caps_isolado", "anchors": caps, "ok": ok, "issues": issues,
            "stats": stats, "score": _score(stats, False, ok) * 0.6,
        })

    results.sort(key=lambda r: r["score"], reverse=True)
    best = results[0] if results else None

    if best and best["ok"]:
        return StructureReport(
            strategy=best["id"], anchors=best["anchors"], confidence=best["score"],
            stats=best["stats"], issues=[], needs_review=False,
        )

    # Camada 3: nenhuma heuristica convenceu -- perguntar ao LLM qual e a convencao.
    if allow_llm:
        detected = _detect_via_llm(content, project_id)
        if detected:
            anchors = _extract_anchors(content, detected["regex"])
            ok, issues, stats = validate_segmentation(anchors, content, min_coverage, max_median_chars, max_scene_ratio)
            if ok:
                return StructureReport(
                    strategy="llm", anchors=anchors, confidence=_score(stats, False, ok),
                    stats=stats, issues=[], needs_review=True,
                )

    # Melhor esforco: se algum candidato achou algo, devolve marcado para revisao.
    if best and best["stats"]["scenes"] > 0:
        return StructureReport(
            strategy=best["id"], anchors=best["anchors"], confidence=best["score"],
            stats=best["stats"], issues=best["issues"], needs_review=True,
        )

    # Camada 4: documento sem estrutura de cena (tratamento, escaleta, ficha tecnica).
    # Nao inventa cenas: o P3 nao pode casar material com cena que nao existe.
    return StructureReport(
        strategy="prose", anchors=[], confidence=0.5,
        stats=segment_stats([], content),
        issues=["nenhum padrao de cena reconhecido; tratado como documento em prosa"],
        needs_review=False,
    )
