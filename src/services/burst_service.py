"""Agrupamento de rajadas de fotos (E2.B4).

Fotógrafo de set dispara em rajada: 20 quadros quase idênticos do mesmo instante.
Analisar cada um pela API de visão é desperdício — a descrição sai igual.

Aqui as fotos vizinhas (mesma pasta, mesma janela de tempo) são comparadas por
embedding CLIP local; acima do limiar entram no mesmo grupo. A visão roda só na
foto líder e as demais herdam descrição/categoria/título. Todas continuam na
biblioteca e indexadas — o que cai é a conta de API, não o acervo.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.search.semantic import SemanticSearch
from src.services.settings_service import SettingsService


@dataclass
class BurstGroup:
    """Uma rajada: a foto líder (analisada pela API) e as que herdam dela."""
    leader: Dict[str, Any]
    members: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def size(self) -> int:
        return 1 + len(self.members)


def photo_image_path(photo_id: int, filepath: Path) -> Path:
    """Proxy WebP quando existir (mais leve para o CLIP), senão o original."""
    proxy = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
    return proxy if proxy.exists() else filepath


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else 0.0


def group_photo_bursts(project_id: int, photos: List[Dict[str, Any]]) -> List[BurstGroup]:
    """Agrupa fotos em rajadas por similaridade CLIP.

    `photos`: dicts com `id`, `filepath` (Path), `mtime` (float) e `parent_dir` (str),
    na ordem em que devem ser encadeadas (mesma pasta, por tempo).

    Cada foto é comparada com a líder do grupo corrente — não com a anterior — para
    que uma deriva lenta (a câmera passeando pela sala) não arraste o grupo inteiro
    para longe do que a descrição da líder afirma.

    Retorna 1 grupo por foto (todos com `members` vazio) se o CLIP estiver desligado
    ou indisponível: o chamador segue analisando tudo, como antes.
    """
    if not photos:
        return []

    S = SettingsService.get_settings(project_id)
    if not S.get("burst.enabled") or not S.get("clip.enabled"):
        return [BurstGroup(leader=p) for p in photos]

    # Sem default aqui: o default é o do settings_registry (fonte da verdade).
    # ResolvedSettings.get() é de 1 argumento — passar default levanta TypeError.
    threshold = float(S.get("burst.similarity_threshold"))
    window = float(S.get("burst.time_window_s"))
    max_size = int(S.get("burst.max_group_size"))

    try:
        from src.search.image_semantic import ImageSearch
        engine = ImageSearch.get_instance()
    except Exception as e:
        print(f"[Burst] CLIP indisponível ({e}); cada foto será analisada individualmente.")
        return [BurstGroup(leader=p) for p in photos]

    groups: List[BurstGroup] = []
    current: Optional[BurstGroup] = None
    leader_vec: Optional[np.ndarray] = None

    for p in photos:
        vec = engine.embed_image_file(photo_image_path(p["id"], p["filepath"]))
        p["clip_vector"] = vec

        if vec is None:  # foto ilegível: fica sozinha e a API decide o que fazer
            groups.append(BurstGroup(leader=p))
            current, leader_vec = None, None
            continue

        joined = False
        if current is not None and leader_vec is not None and current.size < max_size:
            same_dir = p["parent_dir"] == current.leader["parent_dir"]
            in_window = window <= 0 or abs(p["mtime"] - current.leader["mtime"]) <= window
            if same_dir and in_window and _cosine(vec, leader_vec) >= threshold:
                current.members.append(p)
                joined = True

        if not joined:
            current = BurstGroup(leader=p)
            leader_vec = vec
            groups.append(current)

    bursts = [g for g in groups if g.size > 1]
    if bursts:
        saved = sum(len(g.members) for g in bursts)
        print(
            f"[Burst] {len(photos)} fotos -> {len(groups)} chamadas de visão "
            f"({len(bursts)} rajadas, {saved} análises economizadas)."
        )
    return groups


def replicate_to_members(project_id: int, group: BurstGroup) -> int:
    """Copia a análise da líder para as fotos da rajada e as indexa. Retorna quantas herdaram."""
    if not group.members:
        return 0

    with get_db() as conn:
        leader = MediaRepository.get_photo(conn, group.leader["id"])
        if not leader or leader.get("status") != "analyzed":
            print(f"[Burst] Líder {group.leader['id']} não foi analisada; rajada mantida sem réplica.")
            return 0

        conn.execute(
            "UPDATE photo SET burst_group_id = ? WHERE id = ?",
            (leader["id"], leader["id"]),
        )

        try:
            tags = json.loads(leader["tags"]) if leader.get("tags") else []
        except Exception:
            tags = []

        base_desc = leader.get("description") or "Foto analisada."
        replicated = 0

        for idx, member in enumerate(group.members, start=2):
            # O sufixo é honesto sobre a origem: quem lê a descrição sabe que ela
            # descreve a rajada, não este quadro em particular.
            desc = f"{base_desc} (Quadro {idx} de {group.size} da mesma sequência)"
            try:
                MediaRepository.update_photo_analysis(conn, member["id"], desc, tags)
                conn.execute(
                    """UPDATE photo SET raw_description = ?, category = ?, category_confidence = ?,
                                        title = ?, burst_group_id = ?
                       WHERE id = ?""",
                    (
                        leader.get("raw_description"), leader.get("category"),
                        leader.get("category_confidence"), leader.get("title"),
                        leader["id"], member["id"],
                    ),
                )
                SemanticSearch.get_instance().index_photo_description(project_id, member["id"], desc, tags)

                if SettingsService.get_settings(project_id).get("clip.enabled"):
                    try:
                        from src.search.image_semantic import ImageSearch
                        ImageSearch.get_instance().index_photo(
                            project_id, member["id"],
                            photo_image_path(member["id"], member["filepath"]),
                            vector=member.get("clip_vector"),  # já calculado no agrupamento
                            category=leader.get("category"),
                        )
                    except Exception as clip_err:
                        print(f"[Burst] Falha ao indexar CLIP da foto {member['id']}: {clip_err}")
                replicated += 1
            except Exception as e:
                print(f"[Burst] Falha ao replicar metadados para a foto {member['id']}: {e}")

        conn.commit()
    return replicated
