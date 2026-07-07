"""Motor de Agrupamento Temático v2: clustering híbrido por embeddings + nomeação por LLM.

Diferenças em relação ao clustering legado (uma única chamada de LLM com texto truncado):
1. Agrupa por EMBEDDINGS locais (MiniLM, já usado na busca) — sem limite de 30k caracteres.
2. Inclui TODAS as mídias: blocos de entrevista, frames de b-roll (descrições enriquecidas) e fotos.
3. O LLM apenas NOMEIA os clusters (barato), reutilizando títulos de temas existentes.
4. Persiste temas por SEGMENTO (theme_segment: vídeo + intervalo de tempo exato), não por vídeo inteiro.
5. Guarda o centroide de cada tema para atribuição incremental de mídias novas sem re-clusterizar.
"""
import json
import requests
import numpy as np
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.nlp.prompt_templates import get_theme_naming_prompt
from src.nlp.json_parser import extract_json_from_markdown

# Similaridade mínima para: fundir cluster em tema existente / atribuição incremental
THEME_MATCH_THRESHOLD = 0.60
# Distância máxima (1 - similaridade cosseno) para juntar itens no mesmo cluster
CLUSTER_DISTANCE_THRESHOLD = 0.45
MIN_ITEM_CHARS = 40   # ignora textos muito curtos (ruído)
MAX_CLUSTERS = 40     # teto de clusters por rodada (mantém os maiores)
NAMING_BATCH_SIZE = 18  # clusters por chamada de LLM na nomeação (projetos grandes)
# Merge de temas: similaridade mínima entre TÍTULOS (embeddings) para fundir
TITLE_MERGE_THRESHOLD = 0.82
# Merge de temas: similaridade mínima entre CENTROIDES de conteúdo para fundir
CENTROID_MERGE_THRESHOLD = 0.86


# ── Coleta de itens ──────────────────────────────────────────────────────────

def _collect_project_items(project_id: int) -> List[Dict[str, Any]]:
    """Reúne os itens de conteúdo do projeto: blocos de fala, frames de b-roll e fotos."""
    items: List[Dict[str, Any]] = []

    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Blocos de diálogo de entrevistas (agrupados por falante contínuo)
        cursor.execute("""
            SELECT t.video_id, t.word, t.start_time, t.end_time, t.speaker_id
            FROM transcript t
            JOIN video v ON t.video_id = v.id
            WHERE v.project_id = ? AND v.video_type = 'interview'
            ORDER BY t.video_id, t.start_time
        """, (project_id,))
        rows = cursor.fetchall()

        current = None
        for r in rows:
            if current is None or current["speaker_id"] != r["speaker_id"] or current["video_id"] != r["video_id"]:
                if current and len(current["text"]) >= MIN_ITEM_CHARS:
                    items.append(current)
                current = {
                    "kind": "dialogue",
                    "video_id": r["video_id"],
                    "photo_id": None,
                    "speaker_id": r["speaker_id"],
                    "start_time": r["start_time"],
                    "end_time": r["end_time"],
                    "text": r["word"]
                }
            else:
                current["end_time"] = r["end_time"]
                word = r["word"]
                current["text"] += word if word in [".", ",", "!", "?", ";", ":"] else " " + word
        if current and len(current["text"]) >= MIN_ITEM_CHARS:
            items.append(current)

        # 2. Fotos de set analisadas (descrição enriquecida se disponível)
        cursor.execute("""
            SELECT id, description FROM photo
            WHERE project_id = ? AND description IS NOT NULL AND description != ''
        """, (project_id,))
        for r in cursor.fetchall():
            if len(r["description"]) >= MIN_ITEM_CHARS:
                items.append({
                    "kind": "photo",
                    "video_id": None,
                    "photo_id": r["id"],
                    "speaker_id": None,
                    "start_time": None,
                    "end_time": None,
                    "text": r["description"]
                })

        # 3. Frames de b-roll indexados no Qdrant (texto já enriquecido com nomes)
        cursor.execute("SELECT id FROM video WHERE project_id = ? AND video_type = 'broll'", (project_id,))
        broll_ids = [r["id"] for r in cursor.fetchall()]

    try:
        from src.search.semantic import SemanticSearch
        search_engine = SemanticSearch.get_instance()
        for vid in broll_ids:
            for frame in search_engine.get_video_vision_frames(project_id, vid):
                text = frame.get("description", "")
                if len(text) >= MIN_ITEM_CHARS:
                    items.append({
                        "kind": "broll",
                        "video_id": vid,
                        "photo_id": None,
                        "speaker_id": None,
                        "start_time": frame.get("timestamp", 0.0),
                        "end_time": frame.get("timestamp", 0.0) + CONFIG.FRAME_INTERVAL,
                        "text": text
                    })
    except Exception as e:
        print(f"[THEME] Falha ao coletar frames de b-roll: {e}")

    return items


# ── Embeddings e clustering ──────────────────────────────────────────────────

def _embed_texts(texts: List[str]) -> np.ndarray:
    """Embeda os textos com o mesmo modelo local da busca (normalizado L2)."""
    from src.search.semantic import SemanticSearch
    encoder = SemanticSearch.get_instance().encoder
    vectors = encoder.encode(texts, show_progress_bar=False)
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


def _cluster_embeddings(vectors: np.ndarray) -> np.ndarray:
    """Clustering aglomerativo por cosseno; fallback para DBSCAN NumPy local."""
    n = vectors.shape[0]
    if n < 2:
        return np.zeros(n, dtype=int)
    try:
        from sklearn.cluster import AgglomerativeClustering
        clustering = AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=CLUSTER_DISTANCE_THRESHOLD,
            metric="cosine",
            linkage="average"
        )
        return clustering.fit_predict(vectors)
    except Exception as e:
        print(f"[THEME] sklearn indisponível ({e}), usando DBSCAN NumPy local.")
        from src.vision.face_engine import dbscan_numpy
        distances = 1.0 - (vectors @ vectors.T)
        return dbscan_numpy(distances, eps=CLUSTER_DISTANCE_THRESHOLD, min_samples=2)


# ── Nomeação por LLM ─────────────────────────────────────────────────────────

def _name_clusters_llm(clusters: Dict[int, List[Dict[str, Any]]], existing_titles: List[str]) -> Dict[int, Dict[str, str]]:
    """Envia amostras representativas de cada cluster para o LLM nomear.

    Em lotes de NAMING_BATCH_SIZE para escalar a projetos com muitos clusters
    sem estourar o contexto do modelo.
    """
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        return {}

    cluster_ids = list(clusters.keys())
    result: Dict[int, Dict[str, str]] = {}

    for batch_start in range(0, len(cluster_ids), NAMING_BATCH_SIZE):
        batch_ids = cluster_ids[batch_start:batch_start + NAMING_BATCH_SIZE]
        blocks = []
        for cid in batch_ids:
            cluster_items = clusters[cid]
            samples = [it["text"][:280] for it in cluster_items[:6]]
            sample_lines = "\n".join([f'  - "{s}"' for s in samples])
            blocks.append(f"[Grupo {cid} | {len(cluster_items)} trechos]:\n{sample_lines}")

        prompt = get_theme_naming_prompt("\n\n".join(blocks), existing_titles)

        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": CONFIG.TEXT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3
                },
                timeout=90
            )
            if response.status_code != 200:
                print(f"[THEME] Falha LLM na nomeação (status {response.status_code}) no lote {batch_start}")
                continue
            content = response.json()["choices"][0]["message"]["content"].strip()
            data = extract_json_from_markdown(content)
            for c in data.get("clusters", []):
                try:
                    result[int(c["cluster_id"])] = {
                        "title": str(c.get("title", "")).strip(),
                        "description": str(c.get("description", "")).strip()
                    }
                except Exception:
                    continue
            # Títulos recém-criados também valem como "existentes" para os próximos lotes
            existing_titles = list(existing_titles) + [v["title"] for v in result.values() if v.get("title")]
        except Exception as e:
            print(f"[THEME] Erro crítico na nomeação por LLM (lote {batch_start}): {e}")
            continue

    return result


# ── Persistência ─────────────────────────────────────────────────────────────

def _load_existing_themes(conn) -> List[Dict[str, Any]]:
    cursor = conn.cursor()
    cursor.execute("SELECT id, project_id, title, description, embedding, pinned FROM theme")
    themes = []
    for r in cursor.fetchall():
        d = dict(r)
        try:
            d["centroid"] = np.array(json.loads(d["embedding"]), dtype=np.float32) if d["embedding"] else None
        except Exception:
            d["centroid"] = None
        themes.append(d)
    return themes


def _match_existing_theme(centroid: np.ndarray, title: str, existing: List[Dict[str, Any]], project_id: int) -> Optional[int]:
    """Retorna o ID de um tema existente equivalente (por título exato ou centroide próximo)."""
    title_lower = (title or "").strip().lower()
    for t in existing:
        if t["project_id"] != project_id:
            continue
        if title_lower and t["title"].strip().lower() == title_lower:
            return t["id"]
    best_id, best_sim = None, 0.0
    for t in existing:
        if t["project_id"] != project_id or t["centroid"] is None:
            continue
        denom = (np.linalg.norm(t["centroid"]) * np.linalg.norm(centroid)) or 1.0
        sim = float(np.dot(t["centroid"], centroid) / denom)
        if sim > best_sim:
            best_sim, best_id = sim, t["id"]
    if best_id is not None and best_sim >= THEME_MATCH_THRESHOLD + 0.15:
        return best_id
    return None


def run_theme_clustering_v2(project_id: int) -> Dict[str, Any]:
    """Pipeline completo: coleta → embeddings → clusters → nomeação → theme + theme_segment."""
    print(f"\n[THEME] Iniciando clustering temático v2 (embeddings) para projeto {project_id}...")

    items = _collect_project_items(project_id)
    if len(items) < 2:
        print("[THEME] Conteúdo insuficiente para clusterizar.")
        return {"themes": [], "segments": 0}

    print(f"[THEME] {len(items)} itens coletados (falas, b-rolls, fotos). Gerando embeddings locais...")
    vectors = _embed_texts([it["text"] for it in items])
    labels = _cluster_embeddings(vectors)

    clusters: Dict[int, List[int]] = {}
    for idx, label in enumerate(labels):
        if label < 0:
            continue  # ruído
        clusters.setdefault(int(label), []).append(idx)

    # Filtra clusters minúsculos (1 item) — permanecem "sem tema" até a próxima rodada
    clusters = {cid: idxs for cid, idxs in clusters.items() if len(idxs) >= 2}
    if not clusters:
        print("[THEME] Nenhum cluster relevante encontrado.")
        return {"themes": [], "segments": 0}

    # Teto de clusters por rodada: mantém os maiores (projetos muito grandes)
    if len(clusters) > MAX_CLUSTERS:
        keep = sorted(clusters.keys(), key=lambda cid: -len(clusters[cid]))[:MAX_CLUSTERS]
        clusters = {cid: clusters[cid] for cid in keep}
        print(f"[THEME] Limitado aos {MAX_CLUSTERS} maiores clusters.")

    print(f"[THEME] {len(clusters)} clusters formados. Nomeando via LLM...")

    with get_db() as conn:
        existing = _load_existing_themes(conn)
    existing_titles = [t["title"] for t in existing if t["project_id"] == project_id]

    cluster_samples = {cid: [items[i] for i in idxs] for cid, idxs in clusters.items()}
    names = _name_clusters_llm(cluster_samples, existing_titles)

    created_themes = []
    total_segments = 0

    with get_db() as conn:
        cursor = conn.cursor()

        # Rodada de clustering é um REBUILD completo do mapa temático:
        # todos os segmentos são regenerados (evita segmentos órfãos de rodadas
        # anteriores apontando itens que agora pertencem a outro tema)
        cursor.execute("DELETE FROM theme_segment WHERE project_id = ?", (project_id,))

        for cid, idxs in clusters.items():
            centroid = vectors[idxs].mean(axis=0)
            norm = np.linalg.norm(centroid) or 1.0
            centroid = centroid / norm

            meta = names.get(cid, {})
            title = meta.get("title") or f"Tema {cid + 1}"
            description = meta.get("description", "")

            theme_id = _match_existing_theme(centroid, title, existing, project_id)
            if theme_id is None:
                # add_theme com dedupe por título dentro do projeto
                cursor.execute("SELECT id FROM theme WHERE project_id = ? AND title = ?", (project_id, title))
                row = cursor.fetchone()
                if row:
                    theme_id = row["id"]
                else:
                    try:
                        cursor.execute(
                            "INSERT INTO theme (project_id, title, description, embedding) VALUES (?, ?, ?, ?)",
                            (project_id, title, description, json.dumps(centroid.tolist()))
                        )
                        theme_id = cursor.lastrowid
                    except Exception:
                        # Título colide com tema de outro projeto (UNIQUE global legado): sufixa
                        title = f"{title} ({project_id})"
                        cursor.execute(
                            "INSERT INTO theme (project_id, title, description, embedding) VALUES (?, ?, ?, ?)",
                            (project_id, title, description, json.dumps(centroid.tolist()))
                        )
                        theme_id = cursor.lastrowid
                print(f"[THEME] Tema catalogado: \"{title}\" (ID {theme_id}, {len(idxs)} segmentos)")
            else:
                # Atualiza centroide/descrição do tema reaproveitado (se não fixado)
                cursor.execute("SELECT pinned FROM theme WHERE id = ?", (theme_id,))
                prow = cursor.fetchone()
                if prow and not prow["pinned"]:
                    cursor.execute(
                        "UPDATE theme SET embedding = ?, description = CASE WHEN description IS NULL OR description = '' THEN ? ELSE description END WHERE id = ?",
                        (json.dumps(centroid.tolist()), description, theme_id)
                    )
                print(f"[THEME] Cluster {cid} fundido ao tema existente ID {theme_id} ({len(idxs)} segmentos)")

            for i in idxs:
                it = items[i]
                cursor.execute("""
                    INSERT INTO theme_segment (theme_id, project_id, video_id, photo_id, start_time, end_time, speaker_id, text_excerpt, relevance)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    theme_id, project_id, it["video_id"], it["photo_id"],
                    it["start_time"], it["end_time"], it["speaker_id"],
                    it["text"][:300], 1.0
                ))
                total_segments += 1

                # Mantém o grafo relacional legado consistente
                if it["video_id"]:
                    from src.db.repositories.narrative import NarrativeRepository
                    NarrativeRepository.add_relation(
                        conn, project_id, "video", str(it["video_id"]),
                        "belongs_to_theme", "theme", str(theme_id)
                    )

            created_themes.append({"id": theme_id, "title": title, "description": description, "segments": len(idxs)})

        conn.commit()

    # Pós-processamento: funde temas redundantes e remove temas órfãos
    merged = merge_similar_themes(project_id)
    removed = cleanup_empty_themes(project_id)

    print(f"[THEME] Clustering v2 concluído: {len(created_themes)} temas, {total_segments} segmentos, "
          f"{merged} fusões, {removed} temas órfãos removidos.")
    return {"themes": created_themes, "segments": total_segments, "merged": merged, "removed": removed}


# ── Fusão e limpeza de temas ─────────────────────────────────────────────────

def _normalize_title(title: str) -> str:
    """Normaliza título para comparação: minúsculas, sem acentos e sem pontuação."""
    import unicodedata
    import re
    t = unicodedata.normalize("NFKD", (title or "").lower())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def merge_similar_themes(project_id: int) -> int:
    """Funde temas redundantes do projeto (ex: 'Dinâmica da Equipe e Ambiente de
    Trabalho' vs '... e Ambiente de Gravação').

    Critérios de fusão (union-find):
    - título normalizado idêntico; OU
    - similaridade de embedding entre TÍTULOS >= TITLE_MERGE_THRESHOLD; OU
    - similaridade entre CENTROIDES de conteúdo >= CENTROID_MERGE_THRESHOLD.

    O tema canônico de cada grupo é o fixado (pinned) ou o com mais segmentos.
    Segmentos, relações e vínculos de transcrição são reapontados; duplicatas apagadas.
    Retorna o número de temas absorvidos.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.title, t.description, t.embedding, t.pinned,
                   (SELECT COUNT(*) FROM theme_segment s WHERE s.theme_id = t.id) as seg_count
            FROM theme t WHERE t.project_id = ?
        """, (project_id,))
        themes = [dict(r) for r in cursor.fetchall()]

    if len(themes) < 2:
        return 0

    for t in themes:
        try:
            t["centroid"] = np.array(json.loads(t["embedding"]), dtype=np.float32) if t["embedding"] else None
        except Exception:
            t["centroid"] = None
        t["norm_title"] = _normalize_title(t["title"])

    # Embeddings dos títulos (modelo local)
    title_vectors = _embed_texts([t["title"] for t in themes])

    n = len(themes)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            # Dois temas fixados pelo usuário nunca se fundem entre si
            if themes[i]["pinned"] and themes[j]["pinned"]:
                continue

            same_norm = themes[i]["norm_title"] and themes[i]["norm_title"] == themes[j]["norm_title"]
            title_sim = float(np.dot(title_vectors[i], title_vectors[j]))

            centroid_sim = -1.0
            if themes[i]["centroid"] is not None and themes[j]["centroid"] is not None:
                ci, cj = themes[i]["centroid"], themes[j]["centroid"]
                denom = (np.linalg.norm(ci) * np.linalg.norm(cj)) or 1.0
                centroid_sim = float(np.dot(ci, cj) / denom)

            if same_norm or title_sim >= TITLE_MERGE_THRESHOLD or centroid_sim >= CENTROID_MERGE_THRESHOLD:
                union(i, j)

    # Agrupa por raiz
    groups: Dict[int, List[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    merged_count = 0
    with get_db() as conn:
        cursor = conn.cursor()
        for _, members in groups.items():
            if len(members) < 2:
                continue

            # Canônico: pinned > mais segmentos > menor id
            members_sorted = sorted(
                members,
                key=lambda i: (-int(themes[i]["pinned"] or 0), -themes[i]["seg_count"], themes[i]["id"])
            )
            canon = themes[members_sorted[0]]
            dups = [themes[i] for i in members_sorted[1:]]

            centroids = [c for c in [canon["centroid"]] + [d["centroid"] for d in dups] if c is not None]

            for dup in dups:
                cursor.execute("UPDATE theme_segment SET theme_id = ? WHERE theme_id = ?", (canon["id"], dup["id"]))
                cursor.execute("UPDATE transcript_theme SET theme_id = ? WHERE theme_id = ?", (canon["id"], dup["id"]))
                cursor.execute("""
                    UPDATE OR IGNORE relation SET object_id = ?
                    WHERE project_id = ? AND object_type = 'theme' AND object_id = ?
                """, (str(canon["id"]), project_id, str(dup["id"])))
                cursor.execute("DELETE FROM theme WHERE id = ?", (dup["id"],))
                merged_count += 1
                print(f"[THEME] Fusão: \"{dup['title']}\" → \"{canon['title']}\"")

            # Atualiza centroide do canônico (média dos membros)
            if centroids and not canon["pinned"]:
                merged_centroid = np.mean(np.stack(centroids), axis=0)
                norm = np.linalg.norm(merged_centroid) or 1.0
                merged_centroid = merged_centroid / norm
                cursor.execute("UPDATE theme SET embedding = ? WHERE id = ?",
                               (json.dumps(merged_centroid.tolist()), canon["id"]))
        conn.commit()

    if merged_count:
        print(f"[THEME] {merged_count} temas redundantes fundidos.")
    return merged_count


def cleanup_empty_themes(project_id: int) -> int:
    """Remove temas sem nenhum segmento (e não fixados) — restos de rodadas legadas."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.title FROM theme t
            WHERE t.project_id = ? AND IFNULL(t.pinned, 0) = 0
              AND NOT EXISTS (SELECT 1 FROM theme_segment s WHERE s.theme_id = t.id)
        """, (project_id,))
        orphans = [dict(r) for r in cursor.fetchall()]
        for o in orphans:
            cursor.execute("DELETE FROM theme WHERE id = ?", (o["id"],))
            print(f"[THEME] Tema órfão removido: \"{o['title']}\"")
        conn.commit()
    return len(orphans)


# ── Atribuição incremental ───────────────────────────────────────────────────

def assign_media_to_themes(project_id: int, video_id: Optional[int] = None, photo_id: Optional[int] = None) -> int:
    """Atribui mídia recém-analisada aos temas existentes por similaridade de centroide.

    Evita re-clusterizar o projeto inteiro a cada ingestão. Retorna segmentos criados.
    """
    with get_db() as conn:
        themes = [t for t in _load_existing_themes(conn) if t["project_id"] == project_id and t["centroid"] is not None]
    if not themes:
        return 0

    # Coleta apenas os itens da mídia alvo
    all_items = _collect_project_items(project_id)
    if video_id is not None:
        items = [it for it in all_items if it["video_id"] == video_id]
    elif photo_id is not None:
        items = [it for it in all_items if it["photo_id"] == photo_id]
    else:
        return 0
    if not items:
        return 0

    vectors = _embed_texts([it["text"] for it in items])
    centroids = np.stack([t["centroid"] for t in themes])
    c_norms = np.linalg.norm(centroids, axis=1, keepdims=True)
    c_norms[c_norms == 0] = 1.0
    centroids = centroids / c_norms

    sims = vectors @ centroids.T  # [n_items, n_themes]

    created = 0
    with get_db() as conn:
        cursor = conn.cursor()
        for i, it in enumerate(items):
            best_idx = int(np.argmax(sims[i]))
            best_sim = float(sims[i][best_idx])
            if best_sim < THEME_MATCH_THRESHOLD:
                continue
            theme_id = themes[best_idx]["id"]

            # Não duplica segmento já registrado
            cursor.execute("""
                SELECT id FROM theme_segment
                WHERE theme_id = ? AND IFNULL(video_id, -1) = IFNULL(?, -1)
                  AND IFNULL(photo_id, -1) = IFNULL(?, -1)
                  AND IFNULL(start_time, -1.0) = IFNULL(?, -1.0)
            """, (theme_id, it["video_id"], it["photo_id"], it["start_time"]))
            if cursor.fetchone():
                continue

            cursor.execute("""
                INSERT INTO theme_segment (theme_id, project_id, video_id, photo_id, start_time, end_time, speaker_id, text_excerpt, relevance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                theme_id, project_id, it["video_id"], it["photo_id"],
                it["start_time"], it["end_time"], it["speaker_id"],
                it["text"][:300], best_sim
            ))
            created += 1
        conn.commit()

    if created:
        print(f"[THEME] Atribuição incremental: {created} novos segmentos vinculados a temas existentes.")
    return created
