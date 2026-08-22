"""Importador de Timelines: o caminho inverso do exportador OTIO/XML/EDL.

Recebe um arquivo de timeline de um NLE externo (Kdenlive, Premiere, Resolve,
Final Cut) ou gerado pelo próprio CapIAu e recria a timeline no banco no formato
v2 multipista (tracks + clips com posição absoluta), religando cada clipe à
mídia já ingerida no projeto.

Arquitetura espelha o export (otio_export.py):

* `.otio` é JSON puro — parseado nativamente com a stdlib, SEM depender do
  pacote 'opentimelineio' (que não tem wheel para o Python 3.14). Assim o
  import funciona em qualquer ambiente onde o app roda.
* `.xml` (FCP7) e `.edl` (CMX 3600) exigem os adaptadores do OTIO: se o
  'opentimelineio' estiver importável, converte em processo; senão delega por
  subprocesso ao venv 3.12 de data/venv312 (mesmo worker do export).

Mídia externa nunca é copiada nem ingerida aqui: clipes cujo arquivo não
corresponde a nenhuma mídia do banco são reportados como `missing_media` na
resposta, para o editor religar manualmente depois.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Import opcional — mesma estratégia do export: sem o pacote, .otio continua
# funcionando (parse nativo) e xml/edl passam a usar o worker do venv 3.12.
try:
    import opentimelineio as otio
    OTIO_AVAILABLE = True
except ImportError:
    otio = None
    OTIO_AVAILABLE = False

_REPO_ROOT = Path(__file__).resolve().parents[2]

# Formatos aceitos no endpoint de importação
SUPPORTED_EXTENSIONS = [".otio", ".xml", ".edl"]

# Rótulos de pista gravados pelo nosso export ("{track_id} {name}") e usados
# pelos NLEs que preservam nomes. "V1", "A2" e "AI" viram IDs; o resto vira nome.
_TRACK_LABEL_RE = re.compile(r"^((?:V|A)\d{1,2}|AI)(?:\s+(.*))?$")

_DEFAULT_FPS = 24.0
_DEFAULT_WIDTH = 1920
_DEFAULT_HEIGHT = 1080


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de tempo (RationalTime no JSON do OTIO: {"OTIO_SCHEMA": "...",
# "rate": float, "value": float})
# ─────────────────────────────────────────────────────────────────────────────

def _rt_seconds(rt: Optional[Dict[str, Any]]) -> Optional[float]:
    """Converte um RationalTime do JSON OTIO em segundos."""
    if not isinstance(rt, dict):
        return None
    try:
        value = float(rt.get("value", 0.0))
        rate = float(rt.get("rate", 0.0) or 0.0)
    except (TypeError, ValueError):
        return None
    if rate <= 0:
        rate = _DEFAULT_FPS
    return value / rate


def _rt_rate(rt: Optional[Dict[str, Any]]) -> Optional[float]:
    if not isinstance(rt, dict):
        return None
    try:
        rate = float(rt.get("rate", 0.0))
    except (TypeError, ValueError):
        return None
    return rate if rate > 0 else None


def _range_duration(trange: Optional[Dict[str, Any]]) -> Optional[float]:
    if not isinstance(trange, dict):
        return None
    return _rt_seconds(trange.get("duration"))


def _range_start_rate(trange: Optional[Dict[str, Any]]) -> Optional[float]:
    if not isinstance(trange, dict):
        return None
    return _rt_rate(trange.get("start_time"))


def _target_url_to_path(target_url: str) -> str:
    """Converte o target_url de uma referência em caminho local absoluto.

    O nosso export grava caminho posix simples (`D:/.../clipe.mp4`) — volta
    igual. Ferramentas externas costumam gravar URI (`file:///D:/a%20b/c.mp4`);
    nesse caso decodifica o percent-encoding e remove o `file://`. URIs relativas
    (sem esquema, começando com `/`) são devolvidas como estão.
    """
    url = str(target_url or "").strip()
    if not url:
        return ""
    lowered = url.lower()
    if lowered.startswith("file:"):
        from urllib.parse import unquote, urlparse
        parsed = urlparse(url)
        path = unquote(parsed.path or "")
        # file:///D:/... -> parsed.path = "/D:/...": tira a barra inicial
        if re.match(r"^/[A-Za-z]:/", path):
            path = path[1:]
        # Variante não-canônica file://D:/... (drive no netloc)
        if parsed.netloc and re.match(r"^[A-Za-z]:$", parsed.netloc):
            path = f"{parsed.netloc}{path}"
        return Path(path).as_posix()
    return Path(url).as_posix()


# ─────────────────────────────────────────────────────────────────────────────
# Parse do JSON OTIO → IR (representação intermediária, formato interno v2)
# ─────────────────────────────────────────────────────────────────────────────

def parse_otio_text(text: str) -> Dict[str, Any]:
    return parse_otio_dict_to_ir(json.loads(text))


def parse_otio_dict_to_ir(data: Dict[str, Any]) -> Dict[str, Any]:
    """Converte o dicionário JSON de uma Timeline OTIO na IR interna.

    IR produzida (formato v2 + referências de mídia ainda não resolvidas):
    {
      "name", "fps", "width", "height",
      "tracks": [{id, name, kind, order}],   # order alto = mais abaixo na tela
      "clips":  [{media_path, media_name, in, out, track, timeline_start,
                  still, effects, source_name}],
      "warnings": [...]
    }
    """
    if not isinstance(data, dict):
        raise ValueError("Conteúdo OTIO inválido: raiz não é um objeto.")

    schema = str(data.get("OTIO_SCHEMA", ""))
    warnings: List[str] = []

    # Algumas ferramentas exportam uma coleção com várias timelines dentro;
    # usamos a primeira Timeline encontrada.
    if schema.startswith("SerializableCollection"):
        children = data.get("children") or []
        first_tl = next((c for c in children if str(c.get("OTIO_SCHEMA", "")).startswith("Timeline")), None)
        if first_tl is None:
            raise ValueError("A coleção OTIO não contém nenhuma Timeline.")
        if len(children) > 1:
            warnings.append(f"A coleção tinha {len(children)} timelines; apenas a primeira foi importada.")
        data = first_tl
        schema = str(data.get("OTIO_SCHEMA", ""))

    if not schema.startswith("Timeline"):
        raise ValueError(f"Arquivo não contém uma Timeline OpenTimelineIO (schema: '{schema or '?'}').")

    name = str(data.get("name") or "").strip() or "Timeline Importada"
    metadata = data.get("metadata") or {}
    capiau_meta = metadata.get("capiau") or {}

    rates_counter: Counter = Counter()

    stack = data.get("tracks") or {}
    raw_tracks = stack.get("children") or []
    n_tracks = max(1, len(raw_tracks))

    ir_tracks: List[Dict[str, Any]] = []
    ir_clips: List[Dict[str, Any]] = []
    used_ids = set()

    video_seq = [0]
    audio_seq = [0]

    def _next_track_id(kind: str) -> str:
        prefix = "A" if kind == "audio" else "V"
        seq = audio_seq if kind == "audio" else video_seq
        while True:
            seq[0] += 1
            tid = f"{prefix}{seq[0]}"
            if tid not in used_ids:
                return tid

    for idx, child in enumerate(raw_tracks):
        child_schema = str(child.get("OTIO_SCHEMA", ""))

        # Stack aninhado dentro do Stack principal (raro): achata best-effort.
        items: List[Dict[str, Any]] = []
        track_kind_raw = "Video"
        track_label = ""
        if child_schema.startswith("Track"):
            items = child.get("children") or []
            track_kind_raw = str(child.get("kind") or "Video")
            track_label = str(child.get("name") or "").strip()
        elif child_schema.startswith(("Stack", "Sequence")):
            nested = child.get("children") or []
            for sub in nested:
                if str(sub.get("OTIO_SCHEMA", "")).startswith("Track"):
                    items.extend(sub.get("children") or [])
                    if not track_label:
                        track_label = str(sub.get("name") or "").strip()
                    if str(sub.get("kind") or "").lower() == "audio":
                        track_kind_raw = "Audio"
                else:
                    items.append(sub)
            warnings.append("Stack aninhado foi achatado em uma única pista (best-effort).")
        else:
            continue

        kind = "audio" if track_kind_raw.lower() == "audio" else "video"

        match = _TRACK_LABEL_RE.match(track_label)
        if match:
            tid = match.group(1)
            tname = (match.group(2) or "").strip() or tid
        else:
            tid = _next_track_id(kind)
            tname = track_label or tid
        while tid in used_ids:
            tid = f"{tid}x"
        used_ids.add(tid)

        # Espelho do export: filhos do OTIO vão do fundo (order alto) pro topo.
        order = n_tracks - idx
        ir_tracks.append({"id": tid, "name": tname, "kind": kind, "order": order})

        playhead_s = 0.0
        for item in items:
            item_schema = str(item.get("OTIO_SCHEMA", ""))

            if item_schema.startswith("Gap"):
                dur = _range_duration(item.get("source_range")) or 0.0
                rate = _range_start_rate(item.get("source_range"))
                if rate:
                    rates_counter[rate] += 1
                playhead_s += dur
                continue

            if item_schema.startswith("Transition"):
                warnings.append(
                    f"Transição '{item.get('name') or item_schema}' ignorada "
                    "(cortes secos foram mantidos nas posições originais)."
                )
                continue

            if not item_schema.startswith("Clip"):
                continue

            clip_entry = _clip_from_otio(item, tid, playhead_s, rates_counter, warnings)
            if clip_entry is not None:
                ir_clips.append(clip_entry)
                playhead_s += clip_entry["out"] - clip_entry["in"]

    fps = _DEFAULT_FPS
    global_start = data.get("global_start_time")
    if rates_counter:
        fps = rates_counter.most_common(1)[0][0]
    elif _rt_rate(global_start):
        fps = _rt_rate(global_start)

    width = int(capiau_meta.get("width") or _DEFAULT_WIDTH)
    height = int(capiau_meta.get("height") or _DEFAULT_HEIGHT)

    return {
        "name": name,
        "fps": float(fps),
        "width": width,
        "height": height,
        "tracks": sorted(ir_tracks, key=lambda t: t["order"]),
        "clips": ir_clips,
        "warnings": warnings,
    }


def _clip_from_otio(
    clip: Dict[str, Any],
    track_id: str,
    playhead_s: float,
    rates_counter: Counter,
    warnings: List[str],
) -> Optional[Dict[str, Any]]:
    """Extrai um clipe da IR a partir de um item Clip do JSON OTIO.

    Retorna None quando a mídia é uma referência ausente/offline — nesse caso um
    aviso é acumulado e o buraco permanece na posição da timeline.
    """
    source_range = clip.get("source_range")

    # Referência de mídia em dois formatos: o clássico `media_reference`
    # (singular) e o do OTIO 0.18+ com múltiplas referências
    # (`media_references` dict + `active_media_reference_key`) — é o que o
    # nosso próprio exportador 0.18.1 grava.
    media_reference = clip.get("media_reference")
    if not media_reference:
        refs = clip.get("media_references")
        if isinstance(refs, dict) and refs:
            active_key = clip.get("active_media_reference_key")
            media_reference = refs.get(active_key) or next(iter(refs.values()))

    media_reference = media_reference or {}
    ref_schema = str(media_reference.get("OTIO_SCHEMA", ""))

    media_path = ""
    if ref_schema.startswith("ExternalReference") or (
        not ref_schema and media_reference.get("target_url")
    ):
        media_path = _target_url_to_path(media_reference.get("target_url"))
    elif ref_schema.startswith("ImageSequenceReference"):
        # Melhor esforço: base + primeiro arquivo da sequência.
        base = str(media_reference.get("target_url_base") or "")
        prefix = str(media_reference.get("name_prefix") or "")
        ext = str(media_reference.get("name_suffix") or "")
        start_num = media_reference.get("start_frame") or ""
        digits = int(media_reference.get("frame_zero_padding") or 0)
        frame = str(start_num).zfill(digits) if digits else str(start_num)
        media_path = _target_url_to_path(f"{base}{prefix}{frame}{ext}")
        warnings.append(f"Sequência de imagem '{clip.get('name')}' importada como clipe único.")

    in_s = _rt_seconds(source_range.get("start_time")) if isinstance(source_range, dict) else None
    duration_s = _range_duration(source_range)

    if duration_s is None:
        duration_s = _range_duration(media_reference.get("available_range"))
    if in_s is None:
        avail_start = _rt_seconds((media_reference.get("available_range") or {}).get("start_time"))
        in_s = avail_start or 0.0
    if duration_s is None or duration_s <= 0:
        warnings.append(f"Clipe '{clip.get('name')}' sem duração válida foi ignorado.")
        return None

    for rt_src in (source_range, media_reference.get("available_range")):
        rate = _range_start_rate(rt_src)
        if rate:
            rates_counter[rate] += 1

    capiau_clip_meta = ((clip.get("metadata") or {}).get("capiau") or {})
    is_still = bool(capiau_clip_meta.get("still"))

    if not media_path:
        warnings.append(
            f"Clipe '{clip.get('name')}' está offline no arquivo original (mídia não anexada); "
            "posição preservada como lacuna."
        )
        return None

    return {
        "media_path": media_path,
        # Para religar, o nome do ARQUIVO importa mais que o rótulo do clipe.
        "media_name": str(Path(media_path).name or clip.get("name") or ""),
        "in": round(in_s, 6),
        "out": round(in_s + duration_s, 6),
        "track": track_id,
        "timeline_start": round(playhead_s, 6),
        "still": is_still,
        "effects": capiau_clip_meta.get("effects") if isinstance(capiau_clip_meta.get("effects"), list) else [],
        "source_name": str(clip.get("name") or ""),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Leitura de qualquer formato suportado (.otio | .xml | .edl) → IR
# ─────────────────────────────────────────────────────────────────────────────

def read_timeline_file_to_ir(path: Path) -> Dict[str, Any]:
    """Lê um arquivo de timeline e devolve a IR interna.

    `.otio` sempre resolve localmente (JSON nativo). `.xml`/`.edl` precisam dos
    adaptadores OTIO: usa o pacote local quando disponível; senão delega ao
    worker do venv 3.12 (mesmo mecanismo do export).
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Arquivo de timeline não encontrado: {path}")

    suffix = path.suffix.lower()
    if suffix == ".otio":
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="replace")
        return parse_otio_text(text)

    if OTIO_AVAILABLE:
        timeline = otio.adapters.read_from_file(str(path))
        raw_json = otio.adapters.write_to_string(timeline, adapter_name="otio_json")
        return parse_otio_text(raw_json)

    return _read_via_worker(path)


def _read_via_worker(path: Path) -> Dict[str, Any]:
    """Converte .xml/.edl num subprocesso do venv 3.12 (que tem os adaptadores)."""
    from src.export.otio_export import _resolve_worker_python

    worker_py = _resolve_worker_python()
    if worker_py is None:
        raise RuntimeError(
            f"Importação de '{path.suffix.lower()}' exige o pacote 'opentimelineio', indisponível neste Python. "
            "Converta a timeline para .otio no seu editor (o formato abre sem dependências) ou provisione o "
            "venv de exportação: uv venv data/venv312 --python 3.12 && uv pip install --python "
            "data/venv312/Scripts/python.exe opentimelineio otio-fcp-adapter otio-cmx3600-adapter python-dotenv"
        )

    env = os.environ.copy()
    env["CAPIAU_OTIO_WORKER"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        [str(worker_py), "-m", "src.export.otio_import", str(path)],
        cwd=str(_REPO_ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=120, env=env,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-600:]
        raise RuntimeError(f"Worker de importação (venv 3.12) falhou: {tail}")

    # Contrato de saída: última linha stdout começa com '{' (espelha o export).
    for line in reversed((proc.stdout or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            payload = json.loads(line)
            if "ir" not in payload:
                raise RuntimeError("Worker de importação devolveu payload inesperado.")
            return payload["ir"]
    raise RuntimeError("Worker de importação não devolveu o JSON da timeline.")


if __name__ == "__main__":
    # Modo worker: `python -m src.export.otio_import <arquivo>`
    # Executado pelo venv 3.12 quando o Python principal não tem opentimelineio.
    if not OTIO_AVAILABLE:
        print("[IMPORT-WORKER] Este Python tambem nao tem o opentimelineio instalado.", file=sys.stderr)
        sys.exit(3)
    if len(sys.argv) < 2:
        print("Uso: python -m src.export.otio_import <arquivo.otio|xml|edl>", file=sys.stderr)
        sys.exit(2)
    _ir = read_timeline_file_to_ir(Path(sys.argv[1]))
    # Última linha em JSON: contrato de saída lido pelo processo pai
    print(json.dumps({"ir": _ir}, ensure_ascii=False))


# ─────────────────────────────────────────────────────────────────────────────
# Mídia: casamento por caminho (com fallback por nome de arquivo)
# ─────────────────────────────────────────────────────────────────────────────

def _norm_path(p: str) -> str:
    """Normaliza caminho para comparação: posix + casefold (Windows é insensível)."""
    try:
        return os.path.normcase(Path(p).as_posix())
    except (TypeError, ValueError):
        return os.path.normcase(str(p or ""))


def _load_project_media(conn: sqlite3.Connection, project_id: int) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Índices de mídia do projeto e globais: exato (caminho normalizado) e basename."""

    def _bucket(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        exact: Dict[str, List[Dict[str, Any]]] = {}
        by_name: Dict[str, List[Dict[str, Any]]] = {}
        for r in rows:
            fp = _norm_path(r["filepath"])
            exact.setdefault(fp, []).append(r)
            by_name.setdefault(os.path.normcase(Path(r["filepath"]).name), []).append(r)
        return {"exact": exact, "by_name": by_name}

    project_media: Dict[str, Dict[str, Any]] = {}
    global_media: Dict[str, Dict[str, Any]] = {}
    for table in ("video", "photo"):
        # Tabela fixa por design (sem input do usuário) — nome não vem de input.
        all_rows = [dict(r) for r in conn.execute(
            f"SELECT id, filepath, filename FROM {table}"
        )]
        proj_rows = [dict(r) for r in conn.execute(
            f"SELECT id, filepath, filename FROM {table} WHERE project_id = ?", (project_id,)
        )]
        project_media[table] = _bucket(proj_rows)
        global_media[table] = _bucket(all_rows)
    return {"project": project_media, "global": global_media}


def _resolve_media(
    media_path: str,
    media_index: Dict[str, Any],
) -> Tuple[Optional[Tuple[str, int]], str]:
    """Casa um caminho de mídia da IR com (tabela, id) do banco.

    Ordem: caminho exato no projeto → exato global → basename único no projeto →
    basename único global. Retorna também COMO casou ('exact'|'basename'|'').
    """
    norm = _norm_path(media_path)
    base = os.path.normcase(Path(media_path).name)

    project = media_index["project"]
    glob = media_index["global"]

    for table in ("video", "photo"):
        hit = project[table]["exact"].get(norm)
        if hit:
            return (table, hit[0]["id"]), "exact"
    for table in ("video", "photo"):
        hit = glob[table]["exact"].get(norm)
        if hit:
            return (table, hit[0]["id"]), "exact_global"
    for table in ("video", "photo"):
        cands = project[table]["by_name"].get(base) or []
        if len(cands) == 1:
            return (table, cands[0]["id"]), "basename"
    for table in ("video", "photo"):
        cands = glob[table]["by_name"].get(base) or []
        if len(cands) == 1:
            return (table, cands[0]["id"]), "basename_global"
    return None, ""


# ─────────────────────────────────────────────────────────────────────────────
# Importação propriamente dita: IR → timeline v2 no banco
# ─────────────────────────────────────────────────────────────────────────────

def import_timeline_from_ir(
    conn: sqlite3.Connection,
    project_id: int,
    ir: Dict[str, Any],
    name_override: Optional[str] = None,
    source_filename: str = "",
    source_format: str = "",
) -> Dict[str, Any]:
    """Religa a IR às mídias do banco e grava a timeline (formato v2 multipista).

    Clipes sem mídia correspondente ficam de fora e são reportados; as pistas e
    as posições absolutas (inclusive lacunas) são preservadas.
    """
    from src.db.repositories.projects import ProjectRepository

    clips_ir = ir.get("clips") or []
    tracks_ir = ir.get("tracks") or []

    media_index = _load_project_media(conn, project_id)

    resolution_cache: Dict[str, Optional[Tuple[str, int]]] = {}
    missing_media: List[Dict[str, str]] = []
    matched_exact = 0
    matched_basename = 0

    cuts: List[Dict[str, Any]] = []
    for clip in clips_ir:
        mpath = clip.get("media_path") or ""
        if not mpath:
            continue
        if mpath not in resolution_cache:
            resolved, how = _resolve_media(mpath, media_index)
            resolution_cache[mpath] = resolved
            if how.startswith("exact"):
                matched_exact += 1
            elif how.startswith("basename"):
                matched_basename += 1
            else:
                missing_media.append({
                    "path": mpath,
                    "name": clip.get("media_name") or Path(mpath).name,
                })

        resolved = resolution_cache.get(mpath)
        if resolved is None:
            continue  # sem mídia: fica de fora; posição vira lacuna naturalmente

        table, mid = resolved
        cut: Dict[str, Any] = {
            "type": "photo" if table == "photo" else "video",
            "video_id": mid if table == "video" else None,
            "photo_id": mid if table == "photo" else None,
            "in": float(clip.get("in", 0.0)),
            "out": float(clip.get("out", 0.0)),
            "track": clip.get("track", "V1"),
            "timeline_start": float(clip.get("timeline_start", 0.0)),
            "link_id": None,
            "effects": clip.get("effects") or [],
            "alternatives": [],
            "origin": "user",
        }
        cuts.append(cut)

    # Pista de IA padrão na frente (a UI a recria de qualquer forma; manter no
    # banco espelha DEFAULT_TRACKS e sobrevive a exports futuros).
    tracks_out: List[Dict[str, Any]] = [{
        "id": "AI", "name": "IA — Sugestões", "kind": "ai", "order": 0,
        "volume": 1.0, "muted": False, "locked": True, "magnetic": False,
    }]
    existing_ids = {"AI"}
    next_order = 0
    for t in sorted(tracks_ir, key=lambda x: x.get("order", 0)):
        tid = str(t.get("id"))
        while tid in existing_ids:
            tid = f"{tid}x"
        existing_ids.add(tid)
        next_order += 1
        tracks_out.append({
            "id": tid,
            "name": str(t.get("name") or tid),
            "kind": t.get("kind") if t.get("kind") in ("video", "audio") else "video",
            "order": next_order,
            "volume": 1.0, "muted": False, "locked": False, "magnetic": False,
        })

    final_name = (name_override or "").strip() or str(ir.get("name") or "").strip() or "Timeline Importada"
    stamp = datetime.now().strftime("%d/%m %H:%M")
    origin_bits = [b for b in (source_filename or "", source_format) if b]
    description = f"Importada de {' · '.join(origin_bits)} em {stamp}" if origin_bits else f"Importada em {stamp}"

    timeline_id = ProjectRepository.save_timeline(
        conn,
        project_id,
        final_name,
        description,
        cuts,
        tracks=tracks_out,
        fps=float(ir.get("fps") or _DEFAULT_FPS),
        width=int(ir.get("width") or _DEFAULT_WIDTH),
        height=int(ir.get("height") or _DEFAULT_HEIGHT),
    )

    warnings = list(ir.get("warnings") or [])
    if missing_media:
        warnings.insert(0,
            f"{len(missing_media)} clipe(s) sem mídia correspondente no acervo "
            "(religáveis manualmente depois).")

    return {
        "status": "success",
        "timeline_id": timeline_id,
        "name": final_name,
        "fps": float(ir.get("fps") or _DEFAULT_FPS),
        "tracks": len(tracks_out) - 1,  # sem contar a pista de IA
        "clips_imported": len(cuts),
        "clips_skipped": len(missing_media),
        "matched_exact": matched_exact,
        "matched_basename": matched_basename,
        "missing_media": missing_media,
        "warnings": warnings,
    }


def import_timeline_file(
    conn: sqlite3.Connection,
    project_id: int,
    file_path: Path,
    name_override: Optional[str] = None,
    source_filename: str = "",
) -> Dict[str, Any]:
    """Orquestra leitura (qualquer formato suportado) + gravação no projeto."""
    path = Path(file_path)
    fmt = path.suffix.lower().lstrip(".")
    ir = read_timeline_file_to_ir(path)
    return import_timeline_from_ir(
        conn, project_id, ir,
        name_override=name_override,
        source_filename=source_filename or path.name,
        source_format=f".{fmt}",
    )
