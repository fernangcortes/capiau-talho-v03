"""Serviço de Sincronização, Importação e Exportação física de Projetos (ZIP)."""
import base64
import json
import logging
import os
import shutil
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.narrative import NarrativeRepository
from src.db.schema import SCHEMA_VERSION
from src.search.semantic import QdrantUnavailableError, SemanticSearch

logger = logging.getLogger(__name__)


def _encode_json_safe(value: Any) -> Any:
    """Converte BLOBs (bytes/bytearray/memoryview) para estrutura serializável em JSON."""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"__bytes_b64__": base64.b64encode(bytes(value)).decode("ascii")}
    return value


def _decode_json_safe(value: Any) -> Any:
    """Restaura BLOBs codificados com `__bytes_b64__` para `bytes`."""
    if isinstance(value, dict) and set(value.keys()) == {"__bytes_b64__"}:
        return base64.b64decode(value["__bytes_b64__"].encode("ascii"))
    return value


def _row_to_json_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {k: _encode_json_safe(row[k]) for k in row.keys()}


def _parse_tags_list(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(x) for x in parsed] if isinstance(parsed, list) else []
    except (ValueError, TypeError):
        return []


def _remap_int_id(raw_id: Any, id_map: Dict[int, int]) -> Any:
    if raw_id is None:
        return None
    try:
        key = int(raw_id)
    except (TypeError, ValueError):
        return raw_id
    return id_map.get(key, raw_id)


def _remap_clip_ids(
    clip: Dict[str, Any],
    video_id_map: Dict[int, int],
    photo_id_map: Dict[int, int],
) -> None:
    """Remapeia video_id, photo_id e alternatives[].video_id/photo_id de um clipe."""
    if not isinstance(clip, dict):
        return
    if "video_id" in clip and clip["video_id"] is not None:
        clip["video_id"] = _remap_int_id(clip["video_id"], video_id_map)
    if "photo_id" in clip and clip["photo_id"] is not None:
        clip["photo_id"] = _remap_int_id(clip["photo_id"], photo_id_map)
    alts = clip.get("alternatives")
    if isinstance(alts, list):
        for alt in alts:
            if not isinstance(alt, dict):
                continue
            if "video_id" in alt and alt["video_id"] is not None:
                alt["video_id"] = _remap_int_id(alt["video_id"], video_id_map)
            if "photo_id" in alt and alt["photo_id"] is not None:
                alt["photo_id"] = _remap_int_id(alt["photo_id"], photo_id_map)


def _remap_timeline_sequence(
    sequence_json: Optional[str],
    video_id_map: Dict[int, int],
    photo_id_map: Dict[int, int],
) -> Optional[str]:
    """Remapeia referências de mídia em sequence_json v1 (lista) ou v2 (dict com clips)."""
    if not sequence_json:
        return sequence_json
    try:
        seq = json.loads(sequence_json)
    except Exception:
        return sequence_json

    if isinstance(seq, dict):
        clips = seq.get("clips")
        if isinstance(clips, list):
            for clip in clips:
                _remap_clip_ids(clip, video_id_map, photo_id_map)
        return json.dumps(seq, ensure_ascii=False)

    if isinstance(seq, list):
        for clip in seq:
            _remap_clip_ids(clip, video_id_map, photo_id_map)
        return json.dumps(seq, ensure_ascii=False)

    return sequence_json


def _get_table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}


def _insert_mapped_row(
    cursor: sqlite3.Cursor,
    table_name: str,
    target_cols: set[str],
    row_dict: Dict[str, Any],
    overrides: Optional[Dict[str, Any]] = None,
    omit_id: bool = True,
) -> int:
    """Insere linha preservando todas as colunas existentes no schema alvo."""
    payload: Dict[str, Any] = {}
    for col, val in row_dict.items():
        if omit_id and col == "id":
            continue
        if col not in target_cols:
            continue
        if col == "created_at" and val is None:
            continue
        payload[col] = _decode_json_safe(val)

    if overrides:
        for col, val in overrides.items():
            if col in target_cols:
                payload[col] = val

    if not payload:
        cursor.execute(f"INSERT INTO {table_name} DEFAULT VALUES")
        return int(cursor.lastrowid)

    cols_sql = ", ".join(payload.keys())
    placeholders = ", ".join("?" for _ in payload)
    cursor.execute(
        f"INSERT INTO {table_name} ({cols_sql}) VALUES ({placeholders})",
        tuple(payload.values()),
    )
    return int(cursor.lastrowid)


def _atomic_copy_file(src: Path, dest: Path, created_files: List[Path]) -> None:
    """Copia arquivo via arquivo temporário no diretório de destino + os.replace sem sobrescrever."""
    if dest.exists():
        raise FileExistsError(
            f"Destino de proxy já existe e não será sobrescrito para proteger outro projeto: {dest}"
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=dest.parent,
        prefix=f".{dest.name}.",
        suffix=".tmp",
    )
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        shutil.copyfile(src, tmp_path)
        os.replace(tmp_path, dest)
        created_files.append(dest)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _ensure_qdrant_available(search_engine: Any) -> None:
    """Valida se a instância do Qdrant está realmente operacional (não falha em silêncio)."""
    if search_engine is None:
        raise QdrantUnavailableError("Instância do SemanticSearch indisponível.")
    if hasattr(search_engine, "is_available") and not search_engine.is_available:
        raise QdrantUnavailableError(
            getattr(search_engine, "error_message", None) or "Qdrant indisponível."
        )
    if hasattr(search_engine, "client") and search_engine.client is None:
        raise QdrantUnavailableError(
            getattr(search_engine, "error_message", None) or "Cliente Qdrant indisponível."
        )


def _enqueue_qdrant_outbox(
    conn: sqlite3.Connection,
    project_id: int,
    media_kind: str,
    media_id: Optional[int],
    operation: str,
    error_message: str,
) -> None:
    """Registra operação pendente em `qdrant_outbox` sem duplicar pendência idêntica."""
    cursor = conn.cursor()
    existing = cursor.execute(
        """
        SELECT id FROM qdrant_outbox
        WHERE project_id = ? AND media_kind = ? AND IFNULL(media_id, -1) = IFNULL(?, -1)
          AND operation = ? AND status = 'pending'
        ORDER BY id ASC LIMIT 1
        """,
        (project_id, media_kind, media_id, operation),
    ).fetchone()
    if existing:
        cursor.execute(
            """
            UPDATE qdrant_outbox
            SET attempts = attempts + 1,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (error_message, existing["id"]),
        )
    else:
        cursor.execute(
            """
            INSERT INTO qdrant_outbox (project_id, media_kind, media_id, operation, status, attempts, last_error)
            VALUES (?, ?, ?, ?, 'pending', 1, ?)
            """,
            (project_id, media_kind, media_id, operation, error_message),
        )


class SyncService:
    # Ordem topológica das 29 tabelas pertencentes a um projeto
    PROJECT_TABLES: Tuple[str, ...] = (
        "project",
        "media_bin",
        "video",
        "photo",
        "production_doc",
        "person",
        "face",
        "face_recognition",
        "theme",
        "transcript",
        "transcript_theme",
        "timeline",
        "entity",
        "entity_mention",
        "theme_segment",
        "media_segment",
        "video_keyframe",
        "triage_feedback",
        "system1_decisao",
        "scene",
        "script_extraction",
        "relation",
        "project_setting",
        "transcript_entity",
        "video_metadata_history",
        "audio_render",
        "detected_object",
        "dialogue_utterance",
        "dialogue_word",
    )

    GLOBAL_EXCLUDED_TABLES: Dict[str, str] = {
        "app_setting": "Configuração global da instância (inclui credenciais/chaves); excluída por segurança.",
        "qdrant_outbox": "Fila operacional local de reconciliação vetorial com o Qdrant.",
    }

    # Mapeamento tabela SQLite -> chave no JSON exportado (preserva chaves legadas)
    TABLE_EXPORT_KEYS: Dict[str, str] = {
        "project": "project",
        "media_bin": "media_bin",
        "video": "videos",
        "photo": "photos",
        "production_doc": "production_docs",
        "person": "people",
        "face": "faces",
        "face_recognition": "face_recognitions",
        "theme": "themes",
        "transcript": "transcripts",
        "transcript_theme": "transcript_themes",
        "timeline": "timelines",
        "entity": "entity",
        "entity_mention": "entity_mention",
        "theme_segment": "theme_segment",
        "media_segment": "media_segment",
        "video_keyframe": "video_keyframe",
        "triage_feedback": "triage_feedback",
        "system1_decisao": "system1_decisao",
        "scene": "scene",
        "script_extraction": "script_extraction",
        "relation": "relations",
        "project_setting": "project_setting",
        "transcript_entity": "transcript_entity",
        "video_metadata_history": "video_metadata_history",
        "audio_render": "audio_render",
        "detected_object": "detected_object",
        "dialogue_utterance": "dialogue_utterance",
        "dialogue_word": "dialogue_word",
    }

    last_import_report: Optional[Dict[str, Any]] = None

    @classmethod
    def _extract_table_rows(cls, data: Dict[str, Any], table_name: str) -> List[Dict[str, Any]]:
        """Lê registros de uma tabela tolerando chaves legadas, singulares, plurais ou `tables`."""
        export_key = cls.TABLE_EXPORT_KEYS.get(table_name, table_name)
        candidates = [export_key, table_name]
        if not export_key.endswith("s"):
            candidates.append(f"{export_key}s")
        for key in candidates:
            val = data.get(key)
            if isinstance(val, list):
                return val
        tables_dict = data.get("tables")
        if isinstance(tables_dict, dict):
            val = tables_dict.get(table_name)
            if isinstance(val, list):
                return val
        return []

    @classmethod
    def get_project_all_data(cls, project_id: int) -> Optional[Dict[str, Any]]:
        """Coleta todas as 29 tabelas relacionais do projeto e broll_frames do Qdrant."""
        with get_db() as conn:
            cursor = conn.cursor()

            cursor.execute("SELECT * FROM project WHERE id = ?", (project_id,))
            project_row = cursor.fetchone()
            if not project_row:
                return None
            project_data = _row_to_json_dict(project_row)

            existing_tables = {
                r[0]
                for r in cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }

            def query_table(table_name: str, sql: str, params: tuple) -> List[Dict[str, Any]]:
                if table_name not in existing_tables:
                    return []
                cursor.execute(sql, params)
                return [_row_to_json_dict(r) for r in cursor.fetchall()]

            by_project_queries: Dict[str, Tuple[str, tuple]] = {
                "media_bin": ("SELECT * FROM media_bin WHERE project_id = ? ORDER BY id", (project_id,)),
                "video": ("SELECT * FROM video WHERE project_id = ? ORDER BY id", (project_id,)),
                "photo": ("SELECT * FROM photo WHERE project_id = ? ORDER BY id", (project_id,)),
                "production_doc": ("SELECT * FROM production_doc WHERE project_id = ? ORDER BY id", (project_id,)),
                "person": ("SELECT * FROM person WHERE project_id = ? ORDER BY id", (project_id,)),
                "face": ("SELECT * FROM face WHERE project_id = ? ORDER BY id", (project_id,)),
                "face_recognition": (
                    "SELECT * FROM face_recognition WHERE face_id IN (SELECT id FROM face WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "theme": ("SELECT * FROM theme WHERE project_id = ? ORDER BY id", (project_id,)),
                "transcript": (
                    "SELECT * FROM transcript WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "transcript_theme": (
                    "SELECT * FROM transcript_theme WHERE theme_id IN (SELECT id FROM theme WHERE project_id = ?) "
                    "AND transcript_id IN (SELECT id FROM transcript WHERE video_id IN (SELECT id FROM video WHERE project_id = ?))",
                    (project_id, project_id),
                ),
                "timeline": ("SELECT * FROM timeline WHERE project_id = ? ORDER BY id", (project_id,)),
                "entity": ("SELECT * FROM entity WHERE project_id = ? ORDER BY id", (project_id,)),
                "entity_mention": ("SELECT * FROM entity_mention WHERE project_id = ? ORDER BY id", (project_id,)),
                "theme_segment": ("SELECT * FROM theme_segment WHERE project_id = ? ORDER BY id", (project_id,)),
                "media_segment": ("SELECT * FROM media_segment WHERE project_id = ? ORDER BY id", (project_id,)),
                "video_keyframe": ("SELECT * FROM video_keyframe WHERE project_id = ? ORDER BY id", (project_id,)),
                "triage_feedback": ("SELECT * FROM triage_feedback WHERE project_id = ? ORDER BY id", (project_id,)),
                "system1_decisao": ("SELECT * FROM system1_decisao WHERE project_id = ? ORDER BY id", (project_id,)),
                "scene": ("SELECT * FROM scene WHERE project_id = ? ORDER BY id", (project_id,)),
                "script_extraction": ("SELECT * FROM script_extraction WHERE project_id = ? ORDER BY id", (project_id,)),
                "relation": ("SELECT * FROM relation WHERE project_id = ? ORDER BY id", (project_id,)),
                "project_setting": ("SELECT * FROM project_setting WHERE project_id = ? ORDER BY key", (project_id,)),
                "transcript_entity": (
                    "SELECT * FROM transcript_entity WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "video_metadata_history": (
                    "SELECT * FROM video_metadata_history WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "audio_render": (
                    "SELECT * FROM audio_render WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "detected_object": ("SELECT * FROM detected_object WHERE project_id = ? ORDER BY id", (project_id,)),
                "dialogue_utterance": (
                    "SELECT * FROM dialogue_utterance WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
                "dialogue_word": (
                    "SELECT * FROM dialogue_word WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) ORDER BY id",
                    (project_id,),
                ),
            }

            exported: Dict[str, Any] = {"project": project_data}
            table_counts: Dict[str, int] = {"project": 1}

            for table_name in cls.PROJECT_TABLES:
                if table_name == "project":
                    continue
                sql, params = by_project_queries[table_name]
                rows = query_table(table_name, sql, params)
                export_key = cls.TABLE_EXPORT_KEYS[table_name]
                exported[export_key] = rows
                table_counts[table_name] = len(rows)

        # Coleta descrições do Qdrant para B-rolls (sem engolir erros silenciosamente)
        broll_frames: Dict[str, Any] = {}
        qdrant_status = "ok"
        qdrant_errors: List[str] = []

        broll_videos = [v for v in exported.get("videos", []) if v.get("video_type") == "broll"]
        if broll_videos:
            try:
                search_engine = SemanticSearch.get_instance()
                _ensure_qdrant_available(search_engine)
                for v in broll_videos:
                    try:
                        frames = search_engine.get_video_vision_frames(project_id, v["id"])
                        if frames:
                            broll_frames[str(v["id"])] = frames
                    except Exception as q_err:
                        msg = f"Erro ao carregar frames do Qdrant para vídeo {v['id']}: {q_err}"
                        qdrant_status = "degraded"
                        qdrant_errors.append(msg)
                        logger.warning("[SyncService] %s", msg)
                        print(f"[SyncService] [AVISO] {msg}")
            except Exception as q_err:
                msg = f"Qdrant indisponível ao exportar broll_frames do projeto {project_id}: {q_err}"
                qdrant_status = "degraded"
                qdrant_errors.append(msg)
                logger.warning("[SyncService] %s", msg)
                print(f"[SyncService] [AVISO] {msg}")

        exported["broll_frames"] = broll_frames
        exported["qdrant_status"] = qdrant_status
        exported["qdrant_errors"] = qdrant_errors
        exported["manifest"] = {
            "format": "capiau-project",
            "format_version": 2,
            "schema_version": SCHEMA_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "tables": table_counts,
            "excluded_tables": dict(cls.GLOBAL_EXCLUDED_TABLES),
            "derived_rebuildable": ["qdrant_vectors"],
            "qdrant_status": qdrant_status,
            "qdrant_errors": qdrant_errors,
        }
        return exported

    @classmethod
    def import_project_package(
        cls,
        data: Dict[str, Any],
        staging_proxies_dir: Optional[Path] = None,
        proxies_dest_dir: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Importa pacote completo de projeto com remapeamento de IDs, cópia atômica de proxies e outbox Qdrant."""
        if not isinstance(data, dict) or not isinstance(data.get("project"), dict):
            raise ValueError("Pacote de projeto inválido: objeto 'project' ausente.")

        warnings: List[str] = []
        manifest = data.get("manifest")
        if manifest is None:
            warnings.append("Pacote legado sem manifesto v2; importado em modo de compatibilidade.")
        elif isinstance(manifest, dict):
            fmt = manifest.get("format")
            if fmt and fmt != "capiau-project":
                raise ValueError(f"Formato de pacote não suportado: '{fmt}'.")
            fmt_ver = manifest.get("format_version", 1)
            if isinstance(fmt_ver, int) and fmt_ver > 2:
                raise ValueError(f"Versão de formato não suportada: {fmt_ver}.")
            pkg_schema = manifest.get("schema_version")
            if isinstance(pkg_schema, int) and pkg_schema > SCHEMA_VERSION:
                raise ValueError(
                    f"Versão de schema do pacote ({pkg_schema}) é mais nova que a suportada ({SCHEMA_VERSION})."
                )
        else:
            raise ValueError("Manifesto do pacote inválido.")

        staging_dir = Path(staging_proxies_dir) if staging_proxies_dir is not None else None
        dest_dir = Path(proxies_dest_dir) if proxies_dest_dir is not None else CONFIG.PROXIES_DIR

        created_files: List[Path] = []
        copied_files: List[str] = []

        video_id_map: Dict[int, int] = {}
        photo_id_map: Dict[int, int] = {}
        doc_id_map: Dict[int, int] = {}
        person_id_map: Dict[int, int] = {}
        face_id_map: Dict[int, int] = {}
        theme_id_map: Dict[int, int] = {}
        transcript_id_map: Dict[int, int] = {}
        entity_id_map: Dict[int, int] = {}
        media_segment_id_map: Dict[int, int] = {}
        scene_id_map: Dict[int, int] = {}
        utterance_id_map: Dict[int, int] = {}

        # Itens a reindexar no Qdrant após o commit SQLite
        broll_index_jobs: List[Tuple[int, List[Dict[str, Any]]]] = []
        photo_index_jobs: List[Tuple[int, str, List[str]]] = []
        doc_index_jobs: List[Tuple[int, str, str]] = []
        interview_video_ids: List[int] = []

        with get_db() as conn:
            cursor = conn.cursor()
            cols_cache: Dict[str, set[str]] = {
                t: _get_table_columns(conn, t) for t in cls.PROJECT_TABLES
            }

            try:
                # 1. project
                proj = dict(data["project"])
                if not proj.get("name"):
                    proj["name"] = "Projeto Importado"
                new_project_id = _insert_mapped_row(
                    cursor, "project", cols_cache["project"], proj
                )

                # 2. media_bin
                for mb in cls._extract_table_rows(data, "media_bin"):
                    _insert_mapped_row(
                        cursor,
                        "media_bin",
                        cols_cache["media_bin"],
                        mb,
                        overrides={"project_id": new_project_id},
                    )

                # 3. video (SEM mutar hash — unicidade é por projeto)
                broll_frames_data = data.get("broll_frames") or {}
                for v in cls._extract_table_rows(data, "video"):
                    old_vid_id = v.get("id")
                    new_vid_id = _insert_mapped_row(
                        cursor,
                        "video",
                        cols_cache["video"],
                        v,
                        overrides={"project_id": new_project_id},
                    )
                    if old_vid_id is not None:
                        video_id_map[int(old_vid_id)] = new_vid_id
                    if v.get("video_type") == "interview":
                        interview_video_ids.append(new_vid_id)

                # 4. photo (SEM mutar hash; burst_group_id em 2 passes)
                photo_burst_links: List[Tuple[int, int]] = []
                for p in cls._extract_table_rows(data, "photo"):
                    old_photo_id = p.get("id")
                    old_burst_id = p.get("burst_group_id")
                    new_photo_id = _insert_mapped_row(
                        cursor,
                        "photo",
                        cols_cache["photo"],
                        p,
                        overrides={"project_id": new_project_id, "burst_group_id": None},
                    )
                    if old_photo_id is not None:
                        photo_id_map[int(old_photo_id)] = new_photo_id
                    if old_burst_id is not None:
                        photo_burst_links.append((new_photo_id, int(old_burst_id)))
                    if p.get("status") == "analyzed" and p.get("description"):
                        photo_index_jobs.append(
                            (new_photo_id, p["description"], _parse_tags_list(p.get("tags")))
                        )

                for new_photo_id, old_burst_id in photo_burst_links:
                    mapped_burst = photo_id_map.get(old_burst_id)
                    if mapped_burst is not None:
                        cursor.execute(
                            "UPDATE photo SET burst_group_id = ? WHERE id = ?",
                            (mapped_burst, new_photo_id),
                        )

                # 5. production_doc
                for doc in cls._extract_table_rows(data, "production_doc"):
                    old_doc_id = doc.get("id")
                    new_doc_id = _insert_mapped_row(
                        cursor,
                        "production_doc",
                        cols_cache["production_doc"],
                        doc,
                        overrides={"project_id": new_project_id},
                    )
                    if old_doc_id is not None:
                        doc_id_map[int(old_doc_id)] = new_doc_id
                    if doc.get("content"):
                        doc_index_jobs.append(
                            (new_doc_id, doc.get("filename", "doc"), doc["content"])
                        )

                # 6. person
                for person in cls._extract_table_rows(data, "person"):
                    old_person_id = person.get("id")
                    new_person_id = _insert_mapped_row(
                        cursor,
                        "person",
                        cols_cache["person"],
                        person,
                        overrides={"project_id": new_project_id},
                    )
                    if old_person_id is not None:
                        person_id_map[int(old_person_id)] = new_person_id

                # 7. face
                for face in cls._extract_table_rows(data, "face"):
                    old_face_id = face.get("id")
                    old_vid = face.get("video_id")
                    old_photo = face.get("photo_id")
                    new_face_id = _insert_mapped_row(
                        cursor,
                        "face",
                        cols_cache["face"],
                        face,
                        overrides={
                            "project_id": new_project_id,
                            "video_id": video_id_map.get(int(old_vid)) if old_vid is not None else None,
                            "photo_id": photo_id_map.get(int(old_photo)) if old_photo is not None else None,
                        },
                    )
                    if old_face_id is not None:
                        face_id_map[int(old_face_id)] = new_face_id

                # 8. face_recognition
                for rec in cls._extract_table_rows(data, "face_recognition"):
                    old_face_id = rec.get("face_id")
                    new_face_id = face_id_map.get(int(old_face_id)) if old_face_id is not None else None
                    if not new_face_id:
                        continue
                    old_person_id = rec.get("person_id")
                    new_person_id = (
                        person_id_map.get(int(old_person_id)) if old_person_id is not None else None
                    )
                    _insert_mapped_row(
                        cursor,
                        "face_recognition",
                        cols_cache["face_recognition"],
                        rec,
                        overrides={"face_id": new_face_id, "person_id": new_person_id},
                    )

                # 9. theme (SEM mutar title — unicidade é por projeto)
                for theme in cls._extract_table_rows(data, "theme"):
                    old_theme_id = theme.get("id")
                    new_theme_id = _insert_mapped_row(
                        cursor,
                        "theme",
                        cols_cache["theme"],
                        theme,
                        overrides={"project_id": new_project_id},
                    )
                    if old_theme_id is not None:
                        theme_id_map[int(old_theme_id)] = new_theme_id

                # 10. transcript
                for tr in cls._extract_table_rows(data, "transcript"):
                    old_tr_id = tr.get("id")
                    old_vid = tr.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    new_tr_id = _insert_mapped_row(
                        cursor,
                        "transcript",
                        cols_cache["transcript"],
                        tr,
                        overrides={"video_id": new_vid},
                    )
                    if old_tr_id is not None:
                        transcript_id_map[int(old_tr_id)] = new_tr_id

                # 11. transcript_theme
                for tt in cls._extract_table_rows(data, "transcript_theme"):
                    old_tr = tt.get("transcript_id")
                    old_th = tt.get("theme_id")
                    new_tr = transcript_id_map.get(int(old_tr)) if old_tr is not None else None
                    new_th = theme_id_map.get(int(old_th)) if old_th is not None else None
                    if new_tr and new_th:
                        NarrativeRepository.add_transcript_theme(
                            conn, new_tr, new_th, tt.get("relevance", 1.0)
                        )

                # 12. timeline (suporta v1 lista e v2 dict + alternatives[])
                for tl in cls._extract_table_rows(data, "timeline"):
                    updated_seq = _remap_timeline_sequence(
                        tl.get("sequence_json"), video_id_map, photo_id_map
                    )
                    _insert_mapped_row(
                        cursor,
                        "timeline",
                        cols_cache["timeline"],
                        tl,
                        overrides={
                            "project_id": new_project_id,
                            "sequence_json": updated_seq,
                        },
                    )

                # 13. entity (2 passes para linked_entity_id auto-referenciado)
                entity_links: List[Tuple[int, int]] = []
                for ent in cls._extract_table_rows(data, "entity"):
                    old_ent_id = ent.get("id")
                    old_linked = ent.get("linked_entity_id")
                    new_ent_id = _insert_mapped_row(
                        cursor,
                        "entity",
                        cols_cache["entity"],
                        ent,
                        overrides={"project_id": new_project_id, "linked_entity_id": None},
                    )
                    if old_ent_id is not None:
                        entity_id_map[int(old_ent_id)] = new_ent_id
                    if old_linked is not None:
                        entity_links.append((new_ent_id, int(old_linked)))

                for new_ent_id, old_linked in entity_links:
                    mapped_linked = entity_id_map.get(old_linked)
                    if mapped_linked is not None:
                        cursor.execute(
                            "UPDATE entity SET linked_entity_id = ? WHERE id = ?",
                            (mapped_linked, new_ent_id),
                        )

                # 14. entity_mention
                for em in cls._extract_table_rows(data, "entity_mention"):
                    old_ent_id = em.get("entity_id")
                    new_ent_id = entity_id_map.get(int(old_ent_id)) if old_ent_id is not None else None
                    if not new_ent_id:
                        continue
                    old_vid = em.get("video_id")
                    old_photo = em.get("photo_id")
                    _insert_mapped_row(
                        cursor,
                        "entity_mention",
                        cols_cache["entity_mention"],
                        em,
                        overrides={
                            "entity_id": new_ent_id,
                            "project_id": new_project_id,
                            "video_id": video_id_map.get(int(old_vid)) if old_vid is not None else None,
                            "photo_id": photo_id_map.get(int(old_photo)) if old_photo is not None else None,
                        },
                    )

                # 15. theme_segment
                for ts_row in cls._extract_table_rows(data, "theme_segment"):
                    old_th_id = ts_row.get("theme_id")
                    new_th_id = theme_id_map.get(int(old_th_id)) if old_th_id is not None else None
                    if not new_th_id:
                        continue
                    old_vid = ts_row.get("video_id")
                    old_photo = ts_row.get("photo_id")
                    _insert_mapped_row(
                        cursor,
                        "theme_segment",
                        cols_cache["theme_segment"],
                        ts_row,
                        overrides={
                            "theme_id": new_th_id,
                            "project_id": new_project_id,
                            "video_id": video_id_map.get(int(old_vid)) if old_vid is not None else None,
                            "photo_id": photo_id_map.get(int(old_photo)) if old_photo is not None else None,
                        },
                    )

                # 16. media_segment
                for ms in cls._extract_table_rows(data, "media_segment"):
                    old_seg_id = ms.get("id")
                    old_vid = ms.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    new_seg_id = _insert_mapped_row(
                        cursor,
                        "media_segment",
                        cols_cache["media_segment"],
                        ms,
                        overrides={"project_id": new_project_id, "video_id": new_vid},
                    )
                    if old_seg_id is not None:
                        media_segment_id_map[int(old_seg_id)] = new_seg_id

                # 17. video_keyframe
                keyframes_by_new_vid: Dict[int, List[Dict[str, Any]]] = {}
                for kf in cls._extract_table_rows(data, "video_keyframe"):
                    old_vid = kf.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    old_seg = kf.get("segment_id")
                    new_seg = media_segment_id_map.get(int(old_seg)) if old_seg is not None else None
                    _insert_mapped_row(
                        cursor,
                        "video_keyframe",
                        cols_cache["video_keyframe"],
                        kf,
                        overrides={
                            "project_id": new_project_id,
                            "video_id": new_vid,
                            "segment_id": new_seg,
                        },
                    )
                    ts_val = kf.get("timestamp", 0.0) or 0.0
                    st_val = kf.get("start_time")
                    et_val = kf.get("end_time")
                    keyframes_by_new_vid.setdefault(new_vid, []).append(
                        {
                            "timestamp": ts_val,
                            "start_time": st_val if st_val is not None else ts_val,
                            "end_time": et_val if et_val is not None else ts_val + CONFIG.FRAME_INTERVAL,
                            "description": kf.get("descricao") or "",
                            "tags": _parse_tags_list(kf.get("tags")),
                        }
                    )

                # Prepara jobs de B-roll para Qdrant e garante cópia em video_keyframe se só veio em broll_frames
                for v in cls._extract_table_rows(data, "video"):
                    if v.get("video_type") != "broll":
                        continue
                    old_vid_id = v.get("id")
                    if old_vid_id is None:
                        continue
                    new_vid_id = video_id_map.get(int(old_vid_id))
                    if not new_vid_id:
                        continue
                    old_vid_str = str(old_vid_id)
                    if old_vid_str in broll_frames_data and isinstance(broll_frames_data[old_vid_str], list):
                        frames_list = [
                            {
                                "timestamp": f["timestamp"],
                                "start_time": f.get("start_time", f["timestamp"]),
                                "end_time": f.get("end_time", f["timestamp"] + CONFIG.FRAME_INTERVAL),
                                "description": f.get("description", ""),
                                "tags": f.get("tags", []),
                            }
                            for f in broll_frames_data[old_vid_str]
                        ]
                        if frames_list:
                            broll_index_jobs.append((new_vid_id, frames_list))
                            if new_vid_id not in keyframes_by_new_vid:
                                for f in frames_list:
                                    _insert_mapped_row(
                                        cursor,
                                        "video_keyframe",
                                        cols_cache["video_keyframe"],
                                        {
                                            "timestamp": f["timestamp"],
                                            "start_time": f["start_time"],
                                            "end_time": f["end_time"],
                                            "descricao": f["description"],
                                            "tags": json.dumps(f["tags"], ensure_ascii=False),
                                        },
                                        overrides={"project_id": new_project_id, "video_id": new_vid_id},
                                    )
                    elif new_vid_id in keyframes_by_new_vid:
                        broll_index_jobs.append((new_vid_id, keyframes_by_new_vid[new_vid_id]))

                # 18. triage_feedback
                for tf in cls._extract_table_rows(data, "triage_feedback"):
                    kind = tf.get("media_kind")
                    old_mid = tf.get("media_id")
                    if old_mid is None:
                        continue
                    new_mid = (
                        video_id_map.get(int(old_mid))
                        if kind == "video"
                        else photo_id_map.get(int(old_mid))
                    )
                    if not new_mid:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "triage_feedback",
                        cols_cache["triage_feedback"],
                        tf,
                        overrides={"project_id": new_project_id, "media_id": new_mid},
                    )

                # 19. system1_decisao
                for s1 in cls._extract_table_rows(data, "system1_decisao"):
                    kind = s1.get("media_kind")
                    old_mid = s1.get("media_id")
                    if old_mid is None:
                        continue
                    new_mid = (
                        video_id_map.get(int(old_mid))
                        if kind == "video"
                        else photo_id_map.get(int(old_mid))
                    )
                    if not new_mid:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "system1_decisao",
                        cols_cache["system1_decisao"],
                        s1,
                        overrides={"project_id": new_project_id, "media_id": new_mid},
                    )

                # 20. scene
                for sc in cls._extract_table_rows(data, "scene"):
                    old_sc_id = sc.get("id")
                    old_doc_id = sc.get("doc_id")
                    new_doc_id = doc_id_map.get(int(old_doc_id)) if old_doc_id is not None else None
                    if not new_doc_id:
                        continue
                    new_sc_id = _insert_mapped_row(
                        cursor,
                        "scene",
                        cols_cache["scene"],
                        sc,
                        overrides={"project_id": new_project_id, "doc_id": new_doc_id},
                    )
                    if old_sc_id is not None:
                        scene_id_map[int(old_sc_id)] = new_sc_id

                # 21. script_extraction
                for se in cls._extract_table_rows(data, "script_extraction"):
                    old_doc_id = se.get("doc_id")
                    new_doc_id = doc_id_map.get(int(old_doc_id)) if old_doc_id is not None else None
                    if not new_doc_id:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "script_extraction",
                        cols_cache["script_extraction"],
                        se,
                        overrides={"project_id": new_project_id, "doc_id": new_doc_id},
                    )

                # 22. relation
                for r in cls._extract_table_rows(data, "relation"):
                    sub_id = str(r["subject_id"])
                    obj_id = str(r["object_id"])
                    try:
                        if r["subject_type"] == "video" and int(sub_id) in video_id_map:
                            sub_id = str(video_id_map[int(sub_id)])
                        elif r["subject_type"] == "photo" and int(sub_id) in photo_id_map:
                            sub_id = str(photo_id_map[int(sub_id)])
                        elif r["subject_type"] == "theme" and int(sub_id) in theme_id_map:
                            sub_id = str(theme_id_map[int(sub_id)])
                    except (TypeError, ValueError):
                        pass

                    try:
                        if r["object_type"] == "video" and int(obj_id) in video_id_map:
                            obj_id = str(video_id_map[int(obj_id)])
                        elif r["object_type"] == "photo" and int(obj_id) in photo_id_map:
                            obj_id = str(photo_id_map[int(obj_id)])
                        elif r["object_type"] == "theme" and int(obj_id) in theme_id_map:
                            obj_id = str(theme_id_map[int(obj_id)])
                    except (TypeError, ValueError):
                        pass

                    NarrativeRepository.add_relation(
                        conn,
                        new_project_id,
                        r["subject_type"],
                        sub_id,
                        r["predicate"],
                        r["object_type"],
                        obj_id,
                        r.get("weight", 1.0),
                    )

                # 23. project_setting
                for ps in cls._extract_table_rows(data, "project_setting"):
                    _insert_mapped_row(
                        cursor,
                        "project_setting",
                        cols_cache["project_setting"],
                        ps,
                        overrides={"project_id": new_project_id},
                        omit_id=False,
                    )

                # 24. transcript_entity
                for te in cls._extract_table_rows(data, "transcript_entity"):
                    old_vid = te.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "transcript_entity",
                        cols_cache["transcript_entity"],
                        te,
                        overrides={"video_id": new_vid},
                    )

                # 25. video_metadata_history
                for vmh in cls._extract_table_rows(data, "video_metadata_history"):
                    old_vid = vmh.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "video_metadata_history",
                        cols_cache["video_metadata_history"],
                        vmh,
                        overrides={"video_id": new_vid},
                    )

                # 26. audio_render
                for ar in cls._extract_table_rows(data, "audio_render"):
                    old_vid = ar.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    _insert_mapped_row(
                        cursor,
                        "audio_render",
                        cols_cache["audio_render"],
                        ar,
                        overrides={"video_id": new_vid},
                    )

                # 27. detected_object
                for do in cls._extract_table_rows(data, "detected_object"):
                    old_vid = do.get("video_id")
                    old_photo = do.get("photo_id")
                    old_ent = do.get("entity_id")
                    old_sc = do.get("scene_id")
                    _insert_mapped_row(
                        cursor,
                        "detected_object",
                        cols_cache["detected_object"],
                        do,
                        overrides={
                            "project_id": new_project_id,
                            "video_id": video_id_map.get(int(old_vid)) if old_vid is not None else None,
                            "photo_id": photo_id_map.get(int(old_photo)) if old_photo is not None else None,
                            "entity_id": entity_id_map.get(int(old_ent)) if old_ent is not None else None,
                            "scene_id": scene_id_map.get(int(old_sc)) if old_sc is not None else None,
                        },
                    )

                # 28. dialogue_utterance
                for du in cls._extract_table_rows(data, "dialogue_utterance"):
                    old_du_id = du.get("id")
                    old_vid = du.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    new_du_id = _insert_mapped_row(
                        cursor,
                        "dialogue_utterance",
                        cols_cache["dialogue_utterance"],
                        du,
                        overrides={"video_id": new_vid},
                    )
                    if old_du_id is not None:
                        utterance_id_map[int(old_du_id)] = new_du_id

                # 29. dialogue_word
                for dw in cls._extract_table_rows(data, "dialogue_word"):
                    old_vid = dw.get("video_id")
                    new_vid = video_id_map.get(int(old_vid)) if old_vid is not None else None
                    if not new_vid:
                        continue
                    old_utt = dw.get("utterance_id")
                    new_utt = utterance_id_map.get(int(old_utt)) if old_utt is not None else None
                    _insert_mapped_row(
                        cursor,
                        "dialogue_word",
                        cols_cache["dialogue_word"],
                        dw,
                        overrides={"video_id": new_vid, "utterance_id": new_utt},
                    )

                # Copia física atômica de proxies ANTES do commit do SQLite
                if staging_dir is not None and staging_dir.exists():
                    for old_vid_id, new_vid_id in video_id_map.items():
                        src_vid = staging_dir / f"proxy_vid_{old_vid_id}.mp4"
                        if src_vid.is_file():
                            dest_vid = dest_dir / f"proxy_vid_{new_vid_id}.mp4"
                            _atomic_copy_file(src_vid, dest_vid, created_files)
                            copied_files.append(str(dest_vid))

                    photos_staging = staging_dir / "photos"
                    if photos_staging.exists():
                        for old_photo_id, new_photo_id in photo_id_map.items():
                            canonical_src = photos_staging / f"proxy_photo_{old_photo_id}.webp"
                            legacy_src = photos_staging / f"photo_{old_photo_id}.webp"
                            src_photo = canonical_src if canonical_src.is_file() else legacy_src
                            if src_photo.is_file():
                                dest_photo = dest_dir / "photos" / f"proxy_photo_{new_photo_id}.webp"
                                _atomic_copy_file(src_photo, dest_photo, created_files)
                                copied_files.append(str(dest_photo))

                # Prepara diálogos das entrevistas antes do commit (usados após o commit)
                interview_dialogues: List[Tuple[int, List[Dict[str, Any]]]] = []
                for new_vid_id in interview_video_ids:
                    dialogues = NarrativeRepository.get_transcript_dialogues(conn, new_vid_id)
                    if dialogues:
                        interview_dialogues.append((new_vid_id, dialogues))

                conn.commit()
            except Exception:
                for created_path in created_files:
                    created_path.unlink(missing_ok=True)
                conn.rollback()
                raise

        # Reindexação no Qdrant FORA da transação SQLite (após conn.commit)
        qdrant_errors: List[str] = []
        pending_outbox_items: List[Tuple[str, int, str, str]] = []

        def _obtain_search_engine() -> Any:
            se = SemanticSearch.get_instance()
            _ensure_qdrant_available(se)
            return se

        search_engine: Any = None
        init_err: Optional[str] = None
        try:
            search_engine = _obtain_search_engine()
        except Exception as q_err:
            init_err = str(q_err)

        for new_vid_id, frames in broll_index_jobs:
            if init_err is not None:
                pending_outbox_items.append(("video", new_vid_id, "index_broll", init_err))
                continue
            try:
                _ensure_qdrant_available(search_engine)
                search_engine.index_broll_descriptions(new_project_id, new_vid_id, frames)
            except Exception as q_err:
                pending_outbox_items.append(("video", new_vid_id, "index_broll", str(q_err)))

        for new_photo_id, desc, tags_list in photo_index_jobs:
            if init_err is not None:
                pending_outbox_items.append(("photo", new_photo_id, "index_photo", init_err))
                continue
            try:
                _ensure_qdrant_available(search_engine)
                search_engine.index_photo_description(new_project_id, new_photo_id, desc, tags_list)
            except Exception as q_err:
                pending_outbox_items.append(("photo", new_photo_id, "index_photo", str(q_err)))

        for new_doc_id, fname, content in doc_index_jobs:
            if init_err is not None:
                pending_outbox_items.append(("doc", new_doc_id, "index_doc", init_err))
                continue
            try:
                _ensure_qdrant_available(search_engine)
                search_engine.index_production_doc(new_project_id, new_doc_id, fname, content)
            except Exception as q_err:
                pending_outbox_items.append(("doc", new_doc_id, "index_doc", str(q_err)))

        for new_vid_id, dialogues in interview_dialogues:
            if init_err is not None:
                pending_outbox_items.append(("video", new_vid_id, "index_transcript", init_err))
                continue
            try:
                _ensure_qdrant_available(search_engine)
                search_engine.index_transcript_chunks(new_project_id, new_vid_id, dialogues, "interview")
            except Exception as q_err:
                pending_outbox_items.append(("video", new_vid_id, "index_transcript", str(q_err)))

        if pending_outbox_items:
            with get_db() as outbox_conn:
                for media_kind, media_id, operation, err_msg in pending_outbox_items:
                    _enqueue_qdrant_outbox(
                        outbox_conn,
                        new_project_id,
                        media_kind,
                        media_id,
                        operation,
                        err_msg,
                    )
                    formatted = f"{media_kind}:{media_id} ({operation}): {err_msg}"
                    qdrant_errors.append(formatted)
                    logger.warning("[SyncService] Qdrant pendente -> outbox: %s", formatted)
                outbox_conn.commit()
            qdrant_status = "pending_reindex"
        else:
            qdrant_status = "ok"

        report = {
            "project_id": new_project_id,
            "video_id_map": video_id_map,
            "photo_id_map": photo_id_map,
            "copied_files": copied_files,
            "qdrant_status": qdrant_status,
            "qdrant_errors": qdrant_errors,
            "warnings": warnings,
        }
        cls.last_import_report = report
        return report

    @classmethod
    def import_project_all_data(cls, data: Dict[str, Any]) -> int:
        """Importa todos os registros de um projeto (compatibilidade legada retornando project_id)."""
        report = cls.import_project_package(data)
        cls.last_import_report = report
        return int(report["project_id"])

    @classmethod
    def process_qdrant_outbox(cls, project_id: Optional[int] = None) -> Dict[str, Any]:
        """Reconcilia de forma idempotente as pendências em `qdrant_outbox` a partir do SQLite."""
        with get_db() as conn:
            cursor = conn.cursor()
            if project_id is not None:
                rows = cursor.execute(
                    "SELECT * FROM qdrant_outbox WHERE status = 'pending' AND project_id = ? ORDER BY id ASC",
                    (project_id,),
                ).fetchall()
            else:
                rows = cursor.execute(
                    "SELECT * FROM qdrant_outbox WHERE status = 'pending' ORDER BY id ASC"
                ).fetchall()
            pending_rows = [dict(r) for r in rows]

        if not pending_rows:
            return {
                "processed": 0,
                "succeeded": 0,
                "failed": 0,
                "remaining_pending": 0,
                "errors": [],
            }

        errors: List[str] = []
        succeeded = 0
        failed = 0

        try:
            search_engine = SemanticSearch.get_instance()
            _ensure_qdrant_available(search_engine)
        except Exception as q_err:
            err_msg = str(q_err)
            with get_db() as conn:
                for item in pending_rows:
                    conn.execute(
                        """
                        UPDATE qdrant_outbox
                        SET attempts = attempts + 1,
                            last_error = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (err_msg, item["id"]),
                    )
                conn.commit()
            return {
                "processed": len(pending_rows),
                "succeeded": 0,
                "failed": len(pending_rows),
                "remaining_pending": len(pending_rows),
                "errors": [err_msg],
            }

        with get_db() as conn:
            for item in pending_rows:
                outbox_id = item["id"]
                proj_id = item["project_id"]
                media_id = item["media_id"]
                op = item["operation"]
                try:
                    _ensure_qdrant_available(search_engine)
                    if op == "index_broll" and media_id is not None:
                        kf_rows = conn.execute(
                            "SELECT * FROM video_keyframe WHERE project_id = ? AND video_id = ? ORDER BY timestamp ASC",
                            (proj_id, media_id),
                        ).fetchall()
                        frames = [
                            {
                                "timestamp": r["timestamp"],
                                "start_time": r["start_time"] if r["start_time"] is not None else r["timestamp"],
                                "end_time": (
                                    r["end_time"]
                                    if r["end_time"] is not None
                                    else r["timestamp"] + CONFIG.FRAME_INTERVAL
                                ),
                                "description": r["descricao"] or "",
                                "tags": _parse_tags_list(r["tags"]),
                            }
                            for r in kf_rows
                        ]
                        if frames:
                            search_engine.index_broll_descriptions(proj_id, media_id, frames)
                    elif op == "index_photo" and media_id is not None:
                        p_row = conn.execute(
                            "SELECT description, tags, status FROM photo WHERE id = ? AND project_id = ?",
                            (media_id, proj_id),
                        ).fetchone()
                        if p_row and p_row["description"]:
                            search_engine.index_photo_description(
                                proj_id,
                                media_id,
                                p_row["description"],
                                _parse_tags_list(p_row["tags"]),
                            )
                    elif op == "index_doc" and media_id is not None:
                        d_row = conn.execute(
                            "SELECT filename, content FROM production_doc WHERE id = ? AND project_id = ?",
                            (media_id, proj_id),
                        ).fetchone()
                        if d_row and d_row["content"]:
                            search_engine.index_production_doc(
                                proj_id,
                                media_id,
                                d_row["filename"],
                                d_row["content"],
                            )
                    elif op == "index_transcript" and media_id is not None:
                        dialogues = NarrativeRepository.get_transcript_dialogues(conn, media_id)
                        if dialogues:
                            search_engine.index_transcript_chunks(
                                proj_id, media_id, dialogues, "interview"
                            )
                    else:
                        raise ValueError(f"Operação de outbox desconhecida: {op}")

                    conn.execute(
                        """
                        UPDATE qdrant_outbox
                        SET status = 'done',
                            attempts = attempts + 1,
                            last_error = NULL,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (outbox_id,),
                    )
                    succeeded += 1
                except Exception as exc:
                    err_str = str(exc)
                    errors.append(f"outbox:{outbox_id} ({op}): {err_str}")
                    conn.execute(
                        """
                        UPDATE qdrant_outbox
                        SET attempts = attempts + 1,
                            last_error = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (err_str, outbox_id),
                    )
                    failed += 1

            if project_id is not None:
                rem_row = conn.execute(
                    "SELECT COUNT(*) FROM qdrant_outbox WHERE status = 'pending' AND project_id = ?",
                    (project_id,),
                ).fetchone()
            else:
                rem_row = conn.execute(
                    "SELECT COUNT(*) FROM qdrant_outbox WHERE status = 'pending'"
                ).fetchone()
            remaining_pending = int(rem_row[0]) if rem_row else 0
            conn.commit()

        return {
            "processed": len(pending_rows),
            "succeeded": succeeded,
            "failed": failed,
            "remaining_pending": remaining_pending,
            "errors": errors,
        }
