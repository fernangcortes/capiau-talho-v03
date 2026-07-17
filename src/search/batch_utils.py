"""Utilitários compartilhados da busca por similaridade em lote (visual e textual).

A seleção do usuário pode ser coesa (itens sobre o mesmo assunto/aparência) ou
heterogênea (ex: uma entrevista + um plano de drone). A média de vetores só faz
sentido no primeiro caso — no segundo, o centroide cai num "meio-termo" que não
parece com nenhum item. Por isso a agregação é automática:

- coesão >= COHESION_THRESHOLD  -> modo "media" (centroide, busca o tema comum)
- coesão <  COHESION_THRESHOLD  -> modo "uniao" (uma busca por item, melhor score)
"""
from typing import Any, Dict, List, Tuple

import numpy as np

# Similaridade cosseno média par-a-par mínima para usar o centroide.
# Valor inicial — calibrar com material real do projeto (ver plano v2, Fase 1).
COHESION_THRESHOLD = 0.60

# Máximo de keyframes amostrados quando o usuário seleciona um vídeo inteiro
# (evita que um B-roll longo e variado dilua a média num vetor "sem cara").
MAX_KEYFRAMES_PER_VIDEO = 8


def normalize(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32)
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def sample_evenly(points: list, max_count: int = MAX_KEYFRAMES_PER_VIDEO) -> list:
    """Amostra até max_count elementos espaçados uniformemente na lista."""
    if len(points) <= max_count:
        return points
    idxs = np.linspace(0, len(points) - 1, max_count).astype(int)
    return [points[i] for i in idxs]


def compute_cohesion(vectors: List[np.ndarray]) -> float:
    """Similaridade cosseno média entre todos os pares (1.0 para 0 ou 1 vetor)."""
    if len(vectors) <= 1:
        return 1.0
    normed = [normalize(v) for v in vectors]
    sims = []
    for i in range(len(normed)):
        for j in range(i + 1, len(normed)):
            sims.append(float(np.dot(normed[i], normed[j])))
    return float(np.mean(sims))


def pick_mode(vectors: List[np.ndarray]) -> Tuple[str, float]:
    """Decide entre "media" e "uniao" pela coesão da seleção."""
    cohesion = compute_cohesion(vectors)
    return ("media" if cohesion >= COHESION_THRESHOLD else "uniao"), cohesion


def best_source_for_vector(
    hit_vector: np.ndarray,
    source_vectors: List[np.ndarray],
    source_items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Item de origem mais parecido com o hit ("mais parecido com: X")."""
    hv = normalize(hit_vector)
    best_idx, best_sim = 0, -2.0
    for idx, sv in enumerate(source_vectors):
        sim = float(np.dot(hv, normalize(sv)))
        if sim > best_sim:
            best_sim, best_idx = sim, idx
    return dict(source_items[best_idx])


def merge_union_hits(per_source_hits: List[Tuple[Dict[str, Any], list]], limit: int) -> list:
    """Modo "uniao": junta os hits de cada item de origem pelo MAIOR score, sem duplicatas.

    per_source_hits: [(item_de_origem, hits_do_item), ...] onde cada hit é
    {"id", "score", "payload"}. Anota best_source = item cuja busca deu o maior score.
    """
    merged: Dict[Any, Dict[str, Any]] = {}
    for source_item, hits in per_source_hits:
        for h in hits:
            existing = merged.get(h["id"])
            if existing is None or h["score"] > existing["score"]:
                h = dict(h)
                h["best_source"] = dict(source_item)
                merged[h["id"]] = h
    ranked = sorted(merged.values(), key=lambda r: r["score"], reverse=True)
    return ranked[:limit]
