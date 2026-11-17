"""Testes do Estágio 1B — Banco, Schema Versionado, Backup WAL-safe e SyncService (DATA-01, DATA-02, NUV.43)."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.config import CONFIG
from src.db.backup import create_consistent_sqlite_backup, restore_sqlite_backup
from src.db.connection import get_db
from src.db.operations import get_connection
from src.db.repositories.media import MediaRepository
from src.db.schema import SCHEMA_VERSION, get_schema_version, init_db
from src.search.semantic import QdrantUnavailableError, SemanticSearch
from src.services.sync import SyncService


@pytest.fixture
def isolated_env(tmp_path, monkeypatch):
    """Isola DB_PATH, QDRANT_DB_PATH e PROXIES_DIR em diretório temporário."""
    db_path = tmp_path / "capiau_test.db"
    qdrant_path = tmp_path / "qdrant_test"
    proxies_dir = tmp_path / "proxies"
    proxies_dir.mkdir(parents=True, exist_ok=True)
    (proxies_dir / "photos").mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(CONFIG, "DB_PATH", db_path)
    monkeypatch.setattr(CONFIG, "QDRANT_DB_PATH", qdrant_path)
    monkeypatch.setattr(CONFIG, "PROXIES_DIR", proxies_dir)
    SemanticSearch._instance = None
    yield SimpleNamespace(
        root=tmp_path,
        db_path=db_path,
        qdrant_path=qdrant_path,
        proxies_dir=proxies_dir,
    )
    SemanticSearch._instance = None


class _FakeQdrantAvailable:
    def __init__(self):
        self.is_available = True
        self.client = object()
        self.error_message = None
        self.calls = []
        self.vision_frames = {}

    def get_video_vision_frames(self, project_id: int, video_id: int):
        return self.vision_frames.get((project_id, video_id), [])

    def index_broll_descriptions(self, project_id: int, video_id: int, descriptions: list):
        self.calls.append(("broll", project_id, video_id, len(descriptions)))

    def index_photo_description(self, project_id: int, photo_id: int, description: str, tags: list):
        self.calls.append(("photo", project_id, photo_id, description))

    def index_production_doc(self, project_id: int, doc_id: int, filename: str, content: str):
        self.calls.append(("doc", project_id, doc_id, filename))

    def index_transcript_chunks(self, project_id: int, video_id: int, dialogues: list, video_type: str = "interview"):
        self.calls.append(("transcript", project_id, video_id, len(dialogues)))


class _FakeQdrantUnavailable:
    is_available = False
    client = None
    error_message = "Qdrant travado por outro processo"

    def get_video_vision_frames(self, project_id: int, video_id: int):
        raise QdrantUnavailableError(self.error_message)

    def index_broll_descriptions(self, *a, **kw):
        raise QdrantUnavailableError(self.error_message)

    def index_photo_description(self, *a, **kw):
        raise QdrantUnavailableError(self.error_message)

    def index_production_doc(self, *a, **kw):
        raise QdrantUnavailableError(self.error_message)

    def index_transcript_chunks(self, *a, **kw):
        raise QdrantUnavailableError(self.error_message)


def test_sync_cobre_todas_tabelas_do_schema(isolated_env):
    init_db(isolated_env.db_path)

    with get_db(isolated_env.db_path) as conn:
        actual_tables = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        conn.execute(
            "INSERT OR REPLACE INTO app_setting (key, value_json) VALUES (?, ?)",
            ("api.openrouter_key", json.dumps("sk-segredo-global")),
        )
        proj_id = conn.execute(
            "INSERT INTO project (name, description) VALUES (?, ?)",
            ("Projeto Cobertura", "Teste schema"),
        ).lastrowid
        conn.commit()

    assert len(SyncService.PROJECT_TABLES) == 29
    assert set(SyncService.PROJECT_TABLES).isdisjoint(SyncService.GLOBAL_EXCLUDED_TABLES)
    assert "app_setting" in SyncService.GLOBAL_EXCLUDED_TABLES
    assert "qdrant_outbox" in SyncService.GLOBAL_EXCLUDED_TABLES
    assert (set(SyncService.PROJECT_TABLES) | set(SyncService.GLOBAL_EXCLUDED_TABLES)) == actual_tables

    exported = SyncService.get_project_all_data(proj_id)
    assert exported is not None
    manifest = exported["manifest"]
    assert manifest["format"] == "capiau-project"
    assert manifest["format_version"] == 2
    assert manifest["schema_version"] == SCHEMA_VERSION
    assert set(manifest["tables"].keys()) == set(SyncService.PROJECT_TABLES)
    assert "app_setting" not in exported
    assert "qdrant_outbox" not in exported
    assert "sk-segredo-global" not in json.dumps(exported)


def test_roundtrip_completo_29_tabelas_v2_burst_linked_entity(isolated_env, monkeypatch):
    init_db(isolated_env.db_path)
    fake_qdrant = _FakeQdrantAvailable()
    monkeypatch.setattr(SemanticSearch, "get_instance", classmethod(lambda cls: fake_qdrant))

    with get_db(isolated_env.db_path) as conn:
        cur = conn.cursor()
        p_id = cur.execute(
            "INSERT INTO project (name, description, drive_link, objetivo) VALUES (?, ?, ?, ?)",
            ("Doc Bastidores", "Longa metragem", "https://drive.example/1", "Making of completo"),
        ).lastrowid

        cur.execute(
            "INSERT INTO media_bin (project_id, name, path, parent_path, color) VALUES (?, ?, ?, ?, ?)",
            (p_id, "Diaria 01", "diaria_01", "root", "#ff9900"),
        )

        vid_int_id = cur.execute(
            """
            INSERT INTO video (
                project_id, filename, filepath, hash, video_type, virtual_folder,
                duration, fps, resolution, codec, bitrate, title, category, category_confidence,
                description, summary, tags, esforco_analisado, categorias_secundarias,
                fora_do_projeto, categoria_resumo, analise_desatualizada, natureza, triagem_detalhe,
                metadata_origem, color_range, color_space, color_transfer, color_primaries,
                pix_fmt, field_order, color_profile, color_profile_origem, proxy_color_range,
                proxy_pix_fmt, palette_temp, palette_hex, status, crucial_moments,
                hover_loop_duration, rotation, thumbnail_time
            ) VALUES (
                ?, 'entrevista.mp4', '/orig/entrevista.mp4', 'hash_vid_shared', 'interview', 'diaria_01',
                42.5, 24.0, '1920x1080', 'h264', 8000000, 'Entrevista Diretora', 'depoimento', 0.95,
                'Diretora fala no set', 'Resumo entrevista', '["diretora","set"]', 'completo', '["processo"]',
                0, 'depoimento', NULL, 'video', '{"margem": 0.4}',
                'humano', 'tv', 'bt709', 'bt709', 'bt709',
                'yuv420p', 'progressive', 'rec709', 'tag', 'tv',
                'yuv420p', 'warm', '["#ffaa00"]', 'analyzed', '[10.5, 25.0]',
                3.5, 90, 4.2
            )
            """,
            (p_id,),
        ).lastrowid

        vid_broll_id = cur.execute(
            """
            INSERT INTO video (
                project_id, filename, filepath, hash, video_type, duration, status, palette_temp
            ) VALUES (?, 'broll.mp4', '/orig/broll.mp4', 'hash_broll_shared', 'broll', 15.0, 'analyzed', 'cool')
            """,
            (p_id,),
        ).lastrowid

        fake_qdrant.vision_frames[(p_id, vid_broll_id)] = [
            {"timestamp": 2.0, "description": "Grua subindo", "tags": ["grua", "set"]},
        ]

        photo_leader_id = cur.execute(
            """
            INSERT INTO photo (
                project_id, filename, filepath, hash, virtual_folder, title, category,
                category_confidence, description, raw_description, tags, status,
                palette_temp, palette_hex, color_profile, color_profile_origem, raw_params_json, rotation
            ) VALUES (
                ?, 'foto1.cr2', '/orig/foto1.cr2', 'hash_photo_shared', 'diaria_01', 'Claquete', 'processo',
                0.88, 'Claquete na cena 1', 'Raw claquete', '["claquete"]', 'analyzed',
                'neutral', '["#333333"]', 'raw', 'heuristica', '{"wb":"auto"}', 180
            )
            """,
            (p_id,),
        ).lastrowid

        photo_burst_id = cur.execute(
            """
            INSERT INTO photo (
                project_id, filename, filepath, hash, burst_group_id, status
            ) VALUES (?, 'foto2.cr2', '/orig/foto2.cr2', 'hash_photo_2', ?, 'ingested')
            """,
            (p_id, photo_leader_id),
        ).lastrowid

        doc_id = cur.execute(
            """
            INSERT INTO production_doc (project_id, filename, filepath, content, doc_type, byte_hash, content_hash)
            VALUES (?, 'roteiro.fountain', '/docs/roteiro.fountain', 'INT. ESTUDIO - DIA', 'script', 'bh1', 'ch1')
            """,
            (p_id,),
        ).lastrowid

        person_id = cur.execute(
            "INSERT INTO person (project_id, name, aliases, bio, metadata) VALUES (?, ?, ?, ?, ?)",
            (p_id, "Joana", '["Jo"]', "Diretora de fotografia", '{"dept":"fotografia"}'),
        ).lastrowid

        face_id = cur.execute(
            """
            INSERT INTO face (project_id, cluster_id, name, bounding_box, photo_id, video_id, timestamp, quality_score, embedding)
            VALUES (?, 3, 'Joana', '[0.1,0.1,0.3,0.3]', ?, ?, 5.0, 0.91, ?)
            """,
            (p_id, photo_leader_id, vid_int_id, b"\x01\x02\x03\x04"),
        ).lastrowid

        cur.execute(
            """
            INSERT INTO face_recognition (face_id, tier, model, model_version, person_id, embedding, similarity, confidence, status)
            VALUES (?, 1, 'insightface_buffalo_l', '1.0', ?, '[0.1,0.2]', 0.92, 0.94, 'confirmed')
            """,
            (face_id, person_id),
        )

        theme_id = cur.execute(
            "INSERT INTO theme (project_id, title, description, embedding, pinned) VALUES (?, ?, ?, ?, ?)",
            (p_id, "Iluminação", "Discussão sobre luz", "[0.5,0.5]", 1),
        ).lastrowid

        tr_id = cur.execute(
            """
            INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence, search_text)
            VALUES (?, 'Luz', 1.0, 1.5, 'Joana', 0.99, 'luz')
            """,
            (vid_int_id,),
        ).lastrowid

        cur.execute(
            "INSERT INTO transcript_theme (transcript_id, theme_id, relevance) VALUES (?, ?, ?)",
            (tr_id, theme_id, 0.87),
        )

        seq_v2 = {
            "version": 2,
            "fps": 24.0,
            "tracks": [{"id": "V1", "kind": "video"}],
            "clips": [
                {
                    "id": "c1",
                    "type": "video",
                    "video_id": vid_int_id,
                    "in": 0.0,
                    "out": 5.0,
                    "track": "V1",
                    "alternatives": [
                        {"video_id": vid_broll_id, "in_s": 1.0, "out_s": 4.0},
                        {"photo_id": photo_leader_id, "duration_s": 3.0},
                    ],
                },
                {
                    "id": "c2",
                    "type": "photo",
                    "photo_id": photo_burst_id,
                    "in": 0.0,
                    "out": 4.0,
                    "track": "V2",
                    "alternatives": [{"photo_id": photo_leader_id}],
                },
            ],
        }
        cur.execute(
            "INSERT INTO timeline (project_id, name, description, sequence_json) VALUES (?, ?, ?, ?)",
            (p_id, "Corte v2", "Timeline principal", json.dumps(seq_v2)),
        )
        cur.execute(
            "INSERT INTO timeline (project_id, name, description, sequence_json) VALUES (?, ?, ?, ?)",
            (p_id, "Corte v1", "Legado", json.dumps([{"video_id": vid_broll_id, "photo_id": photo_leader_id, "in": 0, "out": 2}])),
        )

        # Inserir personagem ANTES do ator para validar remapeamento de linked_entity_id em 2 passes
        char_ent_id = cur.execute(
            """
            INSERT INTO entity (project_id, entity_type, name, aliases, description, status, realm, role, linked_entity_id)
            VALUES (?, 'person', 'Protagonista', '["Heroi"]', 'Personagem', 'confirmed', 'story', 'protagonista', NULL)
            """,
            (p_id,),
        ).lastrowid
        actor_ent_id = cur.execute(
            """
            INSERT INTO entity (project_id, entity_type, name, status, realm, role)
            VALUES (?, 'person', 'Joana Atriz', 'confirmed', 'production', 'atriz')
            """,
            (p_id,),
        ).lastrowid
        cur.execute("UPDATE entity SET linked_entity_id = ? WHERE id = ?", (actor_ent_id, char_ent_id))

        cur.execute(
            """
            INSERT INTO entity_mention (entity_id, project_id, photo_id, video_id, timestamp, source, status, text_to_replace, confidence)
            VALUES (?, ?, ?, ?, 2.0, 'human_audit', 'confirmed', 'mulher', 0.95)
            """,
            (actor_ent_id, p_id, photo_leader_id, vid_int_id),
        )

        cur.execute(
            """
            INSERT INTO theme_segment (theme_id, project_id, video_id, photo_id, start_time, end_time, speaker_id, text_excerpt, relevance)
            VALUES (?, ?, ?, ?, 1.0, 2.0, 'Joana', 'Luz natural', 0.9)
            """,
            (theme_id, p_id, vid_int_id, photo_leader_id),
        )

        seg_id = cur.execute(
            """
            INSERT INTO media_segment (project_id, video_id, kind, start_time, end_time, reason, motion_label, shot_scale, shot_scale_score)
            VALUES (?, ?, 'shot', 0.0, 5.0, 'corte', 'pan', 'plano_medio', 0.81)
            """,
            (p_id, vid_broll_id),
        ).lastrowid

        cur.execute(
            """
            INSERT INTO video_keyframe (project_id, video_id, timestamp, start_time, end_time, segment_id, descricao, tags, pessoas, objetos)
            VALUES (?, ?, 2.0, 0.0, 5.0, ?, 'Grua subindo', '["grua"]', '[]', '["grua"]')
            """,
            (p_id, vid_broll_id, seg_id),
        )

        cur.execute(
            "INSERT INTO triage_feedback (project_id, media_kind, media_id, wrong_category, right_category, note) VALUES (?, 'video', ?, 'obra', 'depoimento', 'ajuste')",
            (p_id, vid_int_id),
        )
        cur.execute(
            "INSERT INTO triage_feedback (project_id, media_kind, media_id, wrong_category, right_category, note) VALUES (?, 'photo', ?, 'obra', 'processo', 'ajuste foto')",
            (p_id, photo_leader_id),
        )

        cur.execute(
            """
            INSERT INTO system1_decisao (project_id, media_kind, media_id, tarefa, motor, modo, estado_json, perguntas_json, categoria, confianca)
            VALUES (?, 'photo', ?, 'triagem', 'laya-multilingual', 'sombra', '{}', '[]', 'processo', 0.85)
            """,
            (p_id, photo_burst_id),
        )

        scene_id = cur.execute(
            """
            INSERT INTO scene (project_id, doc_id, number, heading, synopsis, characters_json, props_json, location, status)
            VALUES (?, ?, 1, 'INT. ESTUDIO - DIA', 'Preparo de luz', '["Protagonista"]', '["claquete"]', 'ESTUDIO', 'confirmed')
            """,
            (p_id, doc_id),
        ).lastrowid

        cur.execute(
            """
            INSERT INTO script_extraction (project_id, doc_id, content_hash, status, strategy, model, chunks, calls)
            VALUES (?, ?, 'ch1', 'done', 'fountain', 'deepseek', 1, 1)
            """,
            (p_id, doc_id),
        )

        cur.execute(
            """
            INSERT INTO relation (project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
            VALUES (?, 'video', ?, 'belongs_to_theme', 'theme', ?, 0.95)
            """,
            (p_id, str(vid_int_id), str(theme_id)),
        )

        cur.execute(
            "INSERT INTO project_setting (project_id, key, value_json) VALUES (?, ?, ?)",
            (p_id, "timeline.fps", json.dumps(24.0)),
        )

        cur.execute(
            "INSERT INTO transcript_entity (video_id, entity_type, text, start_time, end_time) VALUES (?, 'location', 'estúdio', 1.0, 1.4)",
            (vid_int_id,),
        )

        cur.execute(
            "INSERT INTO video_metadata_history (video_id, title, description, summary, tags, origem) VALUES (?, 'Antigo', 'Desc antiga', 'Sum antigo', '[]', 'ia')",
            (vid_int_id,),
        )

        cur.execute(
            "INSERT INTO audio_render (video_id, in_s, out_s, chain_hash, chain_json, path, status, analysis_json) VALUES (?, 0.0, 5.0, 'ch_audio_1', '[]', '/cache/a.wav', 'ready', '{}')",
            (vid_int_id,),
        )

        cur.execute(
            """
            INSERT INTO detected_object (project_id, photo_id, video_id, timestamp, label, category, realm, bounding_box, confidence, detector_model, entity_id, scene_id, status)
            VALUES (?, ?, ?, 2.0, 'claquete', 'equipamento', 'production', '[100,100,300,300]', 0.9, 'gemini_spatial', ?, ?, 'confirmed')
            """,
            (p_id, photo_leader_id, vid_broll_id, actor_ent_id, scene_id),
        )

        utt_id = cur.execute(
            "INSERT INTO dialogue_utterance (video_id, speaker_id, start_s, end_s, text, confidence) VALUES (?, 'Joana', 1.0, 2.0, 'Luz pronta', 0.98)",
            (vid_int_id,),
        ).lastrowid

        cur.execute(
            "INSERT INTO dialogue_word (utterance_id, video_id, word, start_s, end_s, confidence) VALUES (?, ?, 'Luz', 1.0, 1.5, 0.99)",
            (utt_id, vid_int_id),
        )
        conn.commit()

    exported = SyncService.get_project_all_data(p_id)
    assert exported is not None
    assert exported["qdrant_status"] == "ok"
    assert exported["qdrant_errors"] == []
    assert all(exported["manifest"]["tables"][t] >= 1 for t in SyncService.PROJECT_TABLES)

    # Importar para novo projeto no MESMO banco (sem mutar hashes nem title)
    report = SyncService.import_project_package(exported)
    new_pid = report["project_id"]
    assert new_pid != p_id
    assert report["qdrant_status"] == "ok"
    assert report["qdrant_errors"] == []

    vmap = report["video_id_map"]
    pmap = report["photo_id_map"]

    with get_db(isolated_env.db_path) as conn:
        # Hashes e title intactos
        v_rows = conn.execute("SELECT * FROM video WHERE project_id = ? ORDER BY id", (new_pid,)).fetchall()
        assert {r["hash"] for r in v_rows} == {"hash_vid_shared", "hash_broll_shared"}
        int_row = [r for r in v_rows if r["hash"] == "hash_vid_shared"][0]
        assert int_row["color_profile"] == "rec709"
        assert int_row["palette_temp"] == "warm"
        assert int_row["crucial_moments"] == "[10.5, 25.0]"
        assert int_row["metadata_origem"] == "humano"

        # MediaRepository checa duplicidade por projeto
        assert MediaRepository.add_video(conn, new_pid, "x.mp4", "/x", "hash_vid_shared") == int_row["id"]
        assert MediaRepository.add_photo(conn, new_pid, "y.cr2", "/y", "hash_photo_shared") == pmap[photo_leader_id]

        # Tema preservado sem "(Imp ...)"
        theme_row = conn.execute("SELECT * FROM theme WHERE project_id = ?", (new_pid,)).fetchone()
        assert theme_row["title"] == "Iluminação"
        assert theme_row["pinned"] == 1

        # burst_group_id remapeado
        new_burst = conn.execute("SELECT burst_group_id FROM photo WHERE id = ?", (pmap[photo_burst_id],)).fetchone()
        assert new_burst["burst_group_id"] == pmap[photo_leader_id]

        # entity.linked_entity_id remapeado
        ent_char = conn.execute("SELECT linked_entity_id FROM entity WHERE project_id = ? AND name = 'Protagonista'", (new_pid,)).fetchone()
        ent_actor = conn.execute("SELECT id FROM entity WHERE project_id = ? AND name = 'Joana Atriz'", (new_pid,)).fetchone()
        assert ent_char["linked_entity_id"] == ent_actor["id"]

        # face.embedding BLOB preservado
        face_row = conn.execute("SELECT embedding, photo_id, video_id FROM face WHERE project_id = ?", (new_pid,)).fetchone()
        assert bytes(face_row["embedding"]) == b"\x01\x02\x03\x04"
        assert face_row["photo_id"] == pmap[photo_leader_id]
        assert face_row["video_id"] == vmap[vid_int_id]

        # Timeline v2 e v1 remapeadas incluindo alternatives[]
        tl_v2 = conn.execute("SELECT sequence_json FROM timeline WHERE project_id = ? AND name = 'Corte v2'", (new_pid,)).fetchone()
        parsed_v2 = json.loads(tl_v2["sequence_json"])
        assert parsed_v2["version"] == 2
        assert parsed_v2["clips"][0]["video_id"] == vmap[vid_int_id]
        assert parsed_v2["clips"][0]["alternatives"][0]["video_id"] == vmap[vid_broll_id]
        assert parsed_v2["clips"][0]["alternatives"][1]["photo_id"] == pmap[photo_leader_id]
        assert parsed_v2["clips"][1]["photo_id"] == pmap[photo_burst_id]
        assert parsed_v2["clips"][1]["alternatives"][0]["photo_id"] == pmap[photo_leader_id]

        tl_v1 = conn.execute("SELECT sequence_json FROM timeline WHERE project_id = ? AND name = 'Corte v1'", (new_pid,)).fetchone()
        parsed_v1 = json.loads(tl_v1["sequence_json"])
        assert parsed_v1[0]["video_id"] == vmap[vid_broll_id]
        assert parsed_v1[0]["photo_id"] == pmap[photo_leader_id]

        # Chaves estrangeiras de todas as tabelas auxiliares remapeadas
        kf_row = conn.execute("SELECT video_id, segment_id FROM video_keyframe WHERE project_id = ?", (new_pid,)).fetchone()
        seg_row = conn.execute("SELECT id FROM media_segment WHERE project_id = ?", (new_pid,)).fetchone()
        assert kf_row["video_id"] == vmap[vid_broll_id]
        assert kf_row["segment_id"] == seg_row["id"]

        tf_vid = conn.execute("SELECT media_id FROM triage_feedback WHERE project_id = ? AND media_kind = 'video'", (new_pid,)).fetchone()
        tf_photo = conn.execute("SELECT media_id FROM triage_feedback WHERE project_id = ? AND media_kind = 'photo'", (new_pid,)).fetchone()
        assert tf_vid["media_id"] == vmap[vid_int_id]
        assert tf_photo["media_id"] == pmap[photo_leader_id]

        s1_row = conn.execute("SELECT media_id FROM system1_decisao WHERE project_id = ?", (new_pid,)).fetchone()
        assert s1_row["media_id"] == pmap[photo_burst_id]

        new_doc = conn.execute("SELECT id FROM production_doc WHERE project_id = ?", (new_pid,)).fetchone()
        sc_row = conn.execute("SELECT id, doc_id FROM scene WHERE project_id = ?", (new_pid,)).fetchone()
        se_row = conn.execute("SELECT doc_id FROM script_extraction WHERE project_id = ?", (new_pid,)).fetchone()
        assert sc_row["doc_id"] == new_doc["id"]
        assert se_row["doc_id"] == new_doc["id"]

        do_row = conn.execute("SELECT video_id, photo_id, entity_id, scene_id FROM detected_object WHERE project_id = ?", (new_pid,)).fetchone()
        assert do_row["video_id"] == vmap[vid_broll_id]
        assert do_row["photo_id"] == pmap[photo_leader_id]
        assert do_row["entity_id"] == ent_actor["id"]
        assert do_row["scene_id"] == sc_row["id"]

        dw_row = conn.execute(
            "SELECT dw.video_id, dw.utterance_id, du.video_id as du_vid FROM dialogue_word dw JOIN dialogue_utterance du ON du.id = dw.utterance_id WHERE dw.video_id = ?",
            (vmap[vid_int_id],),
        ).fetchone()
        assert dw_row is not None
        assert dw_row["du_vid"] == vmap[vid_int_id]

        assert conn.execute("SELECT value_json FROM project_setting WHERE project_id = ? AND key = 'timeline.fps'", (new_pid,)).fetchone()["value_json"] == "24.0"
        assert conn.execute("SELECT COUNT(*) FROM video_metadata_history WHERE video_id = ?", (vmap[vid_int_id],)).fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM audio_render WHERE video_id = ?", (vmap[vid_int_id],)).fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM transcript_entity WHERE video_id = ?", (vmap[vid_int_id],)).fetchone()[0] == 1


def test_import_proxies_antes_do_commit_e_rollback_em_falha(isolated_env, monkeypatch):
    init_db(isolated_env.db_path)
    fake_qdrant = _FakeQdrantAvailable()
    monkeypatch.setattr(SemanticSearch, "get_instance", classmethod(lambda cls: fake_qdrant))

    # Simula proxies já existentes do projeto 1 que NÃO podem ser sobrescritos
    existing_vid = isolated_env.proxies_dir / "proxy_vid_1.mp4"
    existing_photo = isolated_env.proxies_dir / "photos" / "proxy_photo_1.webp"
    existing_vid.write_bytes(b"proj1-video-intacto")
    existing_photo.write_bytes(b"proj1-photo-intacta")

    with get_db(isolated_env.db_path) as conn:
        conn.execute("INSERT INTO project (id, name) VALUES (10, 'Existente')")
        conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (1, 10, 'a.mp4', '/a.mp4', 'h1')")
        conn.execute("INSERT INTO photo (id, project_id, filename, filepath, hash) VALUES (1, 10, 'p1.jpg', '/p1.jpg', 'hp1')")
        conn.commit()

    staging = isolated_env.root / "staging_proxies"
    (staging / "photos").mkdir(parents=True)
    (staging / "proxy_vid_1.mp4").write_bytes(b"novo-video-proxy")
    (staging / "photos" / "proxy_photo_1.webp").write_bytes(b"nova-foto-proxy")
    (staging / "photos" / "photo_2.webp").write_bytes(b"legado-foto-proxy")

    package = {
        "manifest": {"format": "capiau-project", "format_version": 2, "schema_version": SCHEMA_VERSION},
        "project": {"name": "Importado Com Proxies"},
        "videos": [{"id": 1, "filename": "v.mp4", "filepath": "/v.mp4", "hash": "h1", "video_type": "interview", "status": "ingested"}],
        "photos": [
            {"id": 1, "filename": "p1.jpg", "filepath": "/p1.jpg", "hash": "hp1", "status": "ingested"},
            {"id": 2, "filename": "p2.jpg", "filepath": "/p2.jpg", "hash": "hp2", "status": "ingested"},
        ],
    }

    report = SyncService.import_project_package(
        package,
        staging_proxies_dir=staging,
        proxies_dest_dir=isolated_env.proxies_dir,
    )
    new_vid_id = report["video_id_map"][1]
    new_p1_id = report["photo_id_map"][1]
    new_p2_id = report["photo_id_map"][2]

    # Projeto 1 preservado
    assert existing_vid.read_bytes() == b"proj1-video-intacto"
    assert existing_photo.read_bytes() == b"proj1-photo-intacta"

    # Novos IDs copiados corretamente (incluindo fallback photo_2.webp -> proxy_photo_{new}.webp)
    assert (isolated_env.proxies_dir / f"proxy_vid_{new_vid_id}.mp4").read_bytes() == b"novo-video-proxy"
    assert (isolated_env.proxies_dir / "photos" / f"proxy_photo_{new_p1_id}.webp").read_bytes() == b"nova-foto-proxy"
    assert (isolated_env.proxies_dir / "photos" / f"proxy_photo_{new_p2_id}.webp").read_bytes() == b"legado-foto-proxy"

    # Agora testa falha no segundo arquivo: deve remover primeiro arquivo e dar rollback no SQLite
    copy_calls = {"n": 0}
    orig_copyfile = __import__("shutil").copyfile

    def _failing_copyfile(src, dst, *a, **kw):
        copy_calls["n"] += 1
        if copy_calls["n"] >= 2:
            raise OSError("disco cheio simulado")
        return orig_copyfile(src, dst, *a, **kw)

    monkeypatch.setattr("src.services.sync.shutil.copyfile", _failing_copyfile)
    with get_db(isolated_env.db_path) as conn:
        projects_before = conn.execute("SELECT COUNT(*) FROM project").fetchone()[0]
    files_before = set(isolated_env.proxies_dir.rglob("*"))

    package_fail = {
        "manifest": {"format": "capiau-project", "format_version": 2, "schema_version": SCHEMA_VERSION},
        "project": {"name": "Importado Deve Falhar"},
        "videos": [{"id": 1, "filename": "vf.mp4", "filepath": "/vf.mp4", "hash": "hf1", "video_type": "broll", "status": "ingested"}],
        "photos": [{"id": 1, "filename": "pf.jpg", "filepath": "/pf.jpg", "hash": "hpf1", "status": "ingested"}],
    }
    with pytest.raises(OSError, match="disco cheio simulado"):
        SyncService.import_project_package(
            package_fail,
            staging_proxies_dir=staging,
            proxies_dest_dir=isolated_env.proxies_dir,
        )

    with get_db(isolated_env.db_path) as conn:
        projects_after = conn.execute("SELECT COUNT(*) FROM project").fetchone()[0]
        assert projects_after == projects_before
        assert conn.execute("SELECT COUNT(*) FROM project WHERE name = 'Importado Deve Falhar'").fetchone()[0] == 0
    assert set(isolated_env.proxies_dir.rglob("*")) == files_before


def test_qdrant_indisponivel_export_degraded_e_import_outbox_idempotente(isolated_env, monkeypatch):
    init_db(isolated_env.db_path)

    # 1. Export com B-roll e Qdrant indisponível -> não engole erro silenciosamente
    down_qdrant = _FakeQdrantUnavailable()
    monkeypatch.setattr(SemanticSearch, "get_instance", classmethod(lambda cls: down_qdrant))

    with get_db(isolated_env.db_path) as conn:
        p_id = conn.execute("INSERT INTO project (name) VALUES ('Qdrant Down')").lastrowid
        conn.execute(
            "INSERT INTO video (project_id, filename, filepath, hash, video_type, status) VALUES (?, 'b.mp4', '/b.mp4', 'hb', 'broll', 'analyzed')",
            (p_id,),
        )
        conn.commit()

    exported = SyncService.get_project_all_data(p_id)
    assert exported["qdrant_status"] == "degraded"
    assert len(exported["qdrant_errors"]) >= 1

    # 2. Import com Qdrant indisponível -> SQLite persiste, outbox registra pending, retorna pending_reindex
    package = {
        "manifest": {"format": "capiau-project", "format_version": 2, "schema_version": SCHEMA_VERSION},
        "project": {"name": "Projeto Reindex Outbox"},
        "videos": [
            {"id": 1, "filename": "ent.mp4", "filepath": "/ent.mp4", "hash": "h_ent", "video_type": "interview", "status": "analyzed"},
            {"id": 2, "filename": "broll.mp4", "filepath": "/broll.mp4", "hash": "h_brl", "video_type": "broll", "status": "analyzed"},
        ],
        "photos": [
            {"id": 1, "filename": "f.jpg", "filepath": "/f.jpg", "hash": "h_f", "description": "Câmera no tripé", "tags": '["camera"]', "status": "analyzed"},
        ],
        "production_docs": [
            {"id": 1, "filename": "pauta.txt", "content": "Pauta completa da filmagem.", "doc_type": "notes"},
        ],
        "transcripts": [
            {"id": 1, "video_id": 1, "word": "Ação", "start_time": 0.5, "end_time": 1.0, "speaker_id": "Diretor"},
        ],
        "broll_frames": {
            "2": [{"timestamp": 1.0, "description": "Plano aberto", "tags": ["set"]}],
        },
    }

    report = SyncService.import_project_package(package)
    new_pid = report["project_id"]
    assert report["qdrant_status"] == "pending_reindex"
    assert len(report["qdrant_errors"]) == 4

    with get_db(isolated_env.db_path) as conn:
        pending_rows = conn.execute(
            "SELECT operation, status FROM qdrant_outbox WHERE project_id = ? ORDER BY id",
            (new_pid,),
        ).fetchall()
        assert len(pending_rows) == 4
        assert {r["operation"] for r in pending_rows} == {"index_broll", "index_photo", "index_doc", "index_transcript"}
        assert all(r["status"] == "pending" for r in pending_rows)

    # 3. Qdrant volta e process_qdrant_outbox reconcilia de forma idempotente
    up_qdrant = _FakeQdrantAvailable()
    monkeypatch.setattr(SemanticSearch, "get_instance", classmethod(lambda cls: up_qdrant))

    res1 = SyncService.process_qdrant_outbox(project_id=new_pid)
    assert res1["processed"] == 4
    assert res1["succeeded"] == 4
    assert res1["failed"] == 0
    assert res1["remaining_pending"] == 0
    assert {c[0] for c in up_qdrant.calls} == {"broll", "photo", "doc", "transcript"}

    # Segunda execução não reprocessa itens já marcados como 'done'
    up_qdrant.calls.clear()
    res2 = SyncService.process_qdrant_outbox(project_id=new_pid)
    assert res2["processed"] == 0
    assert res2["succeeded"] == 0
    assert up_qdrant.calls == []


def test_migracao_v0_para_v1_com_backup_automatico_e_unicidade_por_projeto(tmp_path):
    legacy_db = tmp_path / "legacy_v0.db"
    conn = sqlite3.connect(legacy_db)
    conn.executescript(
        """
        PRAGMA user_version = 0;
        CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT);
        CREATE TABLE video (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            hash TEXT UNIQUE NOT NULL,
            video_type TEXT DEFAULT 'unknown',
            duration REAL DEFAULT 10.0,
            status TEXT DEFAULT 'analyzed'
        );
        CREATE TABLE photo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            hash TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'analyzed'
        );
        CREATE TABLE theme (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            title TEXT NOT NULL UNIQUE,
            description TEXT
        );
        CREATE TABLE transcript (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id INTEGER NOT NULL REFERENCES video(id) ON DELETE CASCADE,
            word TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            speaker_id TEXT NOT NULL
        );
        INSERT INTO project (id, name, description) VALUES (1, 'Proj 1', 'Orig');
        INSERT INTO video (id, project_id, filename, filepath, hash, duration) VALUES (1, 1, 'v.mp4', '/v.mp4', 'same_hash', 20.0);
        INSERT INTO photo (id, project_id, filename, filepath, hash) VALUES (1, 1, 'p.jpg', '/p.jpg', 'same_photo_hash');
        INSERT INTO theme (id, project_id, title, description) VALUES (1, 1, 'Tema Unico', 'Desc');
        INSERT INTO transcript (id, video_id, word, start_time, end_time, speaker_id) VALUES (1, 1, 'Oi', 0.1, 0.4, 'A');
        """
    )
    conn.commit()
    conn.close()

    init_db(legacy_db)

    # Backup pré-migração criado automaticamente e íntegro
    backups = list(tmp_path.glob("legacy_v0.db.pre_v1_*.bak"))
    assert len(backups) == 1
    bkp_conn = sqlite3.connect(backups[0])
    assert bkp_conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert bkp_conn.execute("SELECT COUNT(*) FROM transcript").fetchone()[0] == 1
    bkp_conn.close()

    mig_conn = sqlite3.connect(legacy_db)
    mig_conn.execute("PRAGMA foreign_keys = ON")
    assert get_schema_version(mig_conn) == 1
    assert mig_conn.execute("PRAGMA foreign_key_check").fetchall() == []

    # Dados e filhos preservados
    assert mig_conn.execute("SELECT word FROM transcript WHERE video_id = 1").fetchone()[0] == "Oi"

    # Índices recriados
    idx_names = {
        r[0]
        for r in mig_conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
    }
    for expected_idx in (
        "idx_video_project",
        "idx_video_hash",
        "idx_video_virtual_folder",
        "idx_video_color_profile",
        "idx_photo_project",
        "idx_photo_virtual_folder",
        "idx_photo_burst_group",
    ):
        assert expected_idx in idx_names

    # Agora é possível ter mesmo hash/title em projeto 2, mas não duplicado no mesmo projeto
    mig_conn.execute("INSERT INTO project (id, name) VALUES (2, 'Proj 2')")
    mig_conn.execute("INSERT INTO video (project_id, filename, filepath, hash) VALUES (2, 'v.mp4', '/v.mp4', 'same_hash')")
    mig_conn.execute("INSERT INTO photo (project_id, filename, filepath, hash) VALUES (2, 'p.jpg', '/p.jpg', 'same_photo_hash')")
    mig_conn.execute("INSERT INTO theme (project_id, title) VALUES (2, 'Tema Unico')")
    mig_conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        mig_conn.execute("INSERT INTO video (project_id, filename, filepath, hash) VALUES (2, 'v2.mp4', '/v2.mp4', 'same_hash')")
    with pytest.raises(sqlite3.IntegrityError):
        mig_conn.execute("INSERT INTO theme (project_id, title) VALUES (2, 'Tema Unico')")
    mig_conn.close()

    # Segunda execução de init_db não cria novo backup quando user_version == 1
    init_db(legacy_db)
    assert len(list(tmp_path.glob("legacy_v0.db.pre_v1_*.bak"))) == 1


def test_backup_wal_consistente_restore_e_pragmas_conexao(tmp_path):
    db_path = tmp_path / "wal_db.db"
    init_db(db_path)

    # get_connection com WAL e busy_timeout em arquivo, e seguro em :memory:
    conn = get_connection(db_path)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        conn.execute("INSERT INTO project (name) VALUES ('Projeto WAL 1')")
        conn.commit()
    finally:
        conn.close()

    mem_conn = get_connection(Path(":memory:"))
    try:
        assert mem_conn.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
        assert mem_conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "memory"
    finally:
        mem_conn.close()

    with get_db(":memory:") as ctx_mem:
        assert ctx_mem.execute("PRAGMA busy_timeout").fetchone()[0] == 30000

    # Mantém escrita recente em WAL com leitor aberto e cria backup consistente
    writer = get_connection(db_path)
    writer.execute("INSERT INTO project (name) VALUES ('Projeto No WAL')")
    writer.commit()

    backup_file = tmp_path / "backups" / "capiau_backup.db"
    meta = create_consistent_sqlite_backup(db_path, backup_file)
    writer.close()

    assert backup_file.exists()
    assert meta["integrity"] == "ok"
    assert meta["size_bytes"] == backup_file.stat().st_size
    assert meta["sha256"] == hashlib.sha256(backup_file.read_bytes()).hexdigest()

    # Modifica o banco principal e restaura do backup
    mod_conn = get_connection(db_path)
    mod_conn.execute("DELETE FROM project")
    mod_conn.execute("INSERT INTO project (name) VALUES ('Dados Errados')")
    mod_conn.commit()
    mod_conn.close()

    res_meta = restore_sqlite_backup(backup_file, db_path)
    assert res_meta["integrity"] == "ok"

    check_conn = get_connection(db_path)
    names = [r["name"] for r in check_conn.execute("SELECT name FROM project ORDER BY id").fetchall()]
    assert "Projeto No WAL" in names
    assert "Dados Errados" not in names
    assert check_conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    check_conn.close()

    # Backup corrompido deve levantar RuntimeError sem estragar target_db
    corrupt_bkp = tmp_path / "corrupt.db"
    corrupt_bkp.write_bytes(b"nao eh um sqlite valido")
    with pytest.raises(RuntimeError):
        restore_sqlite_backup(corrupt_bkp, db_path)

    # Integridade falha no create_consistent_sqlite_backup também levanta RuntimeError
    with pytest.raises(RuntimeError):
        create_consistent_sqlite_backup(corrupt_bkp, tmp_path / "fail_out.db")

    # Falha explícita de PRAGMA integrity_check durante backup não deixa arquivo destino nem .tmp órfão
    fail_dest = tmp_path / "backups" / "integrity_fail.db"
    with pytest.MonkeyPatch.context() as mp:
        def _fake_fail(conn_arg, label):
            raise RuntimeError(f"{label}: PRAGMA integrity_check falhou: row corruption")

        mp.setattr("src.db.backup._check_sqlite_integrity", _fake_fail)
        with pytest.raises(RuntimeError, match="PRAGMA integrity_check falhou"):
            create_consistent_sqlite_backup(db_path, fail_dest)
    assert not fail_dest.exists()
    assert list((tmp_path / "backups").glob("*.tmp")) == []


def test_migracao_seletiva_reconstroi_apenas_tabela_afetada(tmp_path, monkeypatch):
    import src.db.schema as schema_mod

    db_path = tmp_path / "partial_v0.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        PRAGMA user_version = 0;
        CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT);
        CREATE TABLE video (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            hash TEXT NOT NULL,
            duration REAL DEFAULT 10.0,
            UNIQUE(project_id, hash)
        );
        CREATE TABLE photo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            hash TEXT NOT NULL,
            UNIQUE(project_id, hash)
        );
        CREATE TABLE theme (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            title TEXT NOT NULL UNIQUE,
            description TEXT
        );
        INSERT INTO project (id, name) VALUES (1, 'P1');
        INSERT INTO theme (id, project_id, title) VALUES (1, 1, 'Tema');
        """
    )
    conn.commit()
    conn.close()

    rebuilt = []
    orig_rebuild = schema_mod._rebuild_table_scoped_unique

    def _spy_rebuild(c, tbl, cols_spec, uniq_expr):
        rebuilt.append(tbl)
        return orig_rebuild(c, tbl, cols_spec, uniq_expr)

    monkeypatch.setattr(schema_mod, "_rebuild_table_scoped_unique", _spy_rebuild)
    init_db(db_path)
    assert rebuilt == ["theme"]
    check = sqlite3.connect(db_path)
    assert get_schema_version(check) == 1
    check.close()
