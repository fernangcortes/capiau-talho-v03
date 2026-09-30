"""tests/test_ai_layers_2026.py — Suíte Abrangente de Testes Automatizados para Milestone M2 (SOTA 2026).

Valida integralmente:
1. Fast Decision System 1 (Laya & Jev): latência, probabilidades calibradas, limiar de escalação 0.88, safety audit e RAG routing.
2. Grounding Espacial Canônico Gemini: conversões bidirecionais YOLO/DINO-X/Pixels, validação, clamping, IoU e payloads Qdrant.
3. Unificação Biométrica Facial 512-d: LocalBackend padronizado em 512-d, sem SFace 128-d, e script de migração funcional.
4. Governança de Prompts & Personas: completude dos 19 prompts no PROMPT_REGISTRY, personas editoriais e isolamento story/production.
5. Evolução de Schema SQLite: criação idempotente de detected_object (7 índices), dialogue_utterance (falas sobrepostas), dialogue_word e colunas em entity_mention.
6. Resolução Dinâmica de Configurações: api_key() para provedores de 2026 com fallbacks, categoria objects_props e settings registry.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pytest

from src.db.schema import SCHEMA_SQL, migrate_storage_schema
from src.nlp.prompt_registry import (
    PROMPT_REGISTRY,
    get_prompt,
    get_prompt_template,
    render_prompt,
    validate_template,
)
from src.services.settings_registry import CATEGORIES, SETTINGS_REGISTRY, get_registry_map
from src.services.settings_service import SettingsService
from src.services.system1_service import (
    RAGRoutingDecision,
    SafetyAuditDecision,
    System1JevClient,
    System1LayaEngine,
    System1Service,
    TriageDecision,
)
from src.vision.backends.local_backend import LocalBackend, _extract_512d_feature
from src.vision.spatial_grounding import (
    calculate_box_iou,
    clamp_gemini_box,
    dinox_to_gemini_box,
    format_qdrant_detected_objects,
    format_qdrant_image_facets,
    gemini_to_dinox_box,
    gemini_to_pixel_box,
    gemini_to_yolo_box,
    gemini_to_yolo_center_box,
    pixel_to_gemini_box,
    validate_gemini_box,
    yolo_center_to_gemini_box,
    yolo_to_gemini_box,
)


# ── Testes 1: Fast Decision System 1 (Laya & Jev) ────────────────────────────

class TestSystem1CognitiveArchitecture:
    @pytest.fixture
    def service(self) -> System1Service:
        return System1Service(escalation_threshold=0.88)

    def test_laya_triage_latency_under_50ms(self, service: System1Service):
        """Verifica se a triagem de mídia pelo Sistema 1 executa em menos de 50ms por arquivo."""
        media_state = {
            "filename": "take_04_cena_02.mov",
            "duration_s": 35.0,
            "has_video": True,
            "speech_ratio": 0.05,
            "folder": "material_bruto/takes",
            "audio_rms": 0.02
        }
        t0 = time.perf_counter()
        decision = service.evaluate_triage(media_state)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        assert elapsed_ms < 50.0, f"Latência de triagem excedeu 50ms: {elapsed_ms:.2f}ms"
        assert isinstance(decision, TriageDecision)
        assert decision.category in [
            "obra", "processo", "depoimento", "cotidiano", "evento", "tecnico", "arquivo", "pessoal", "documento"
        ]
        assert 0.0 <= decision.confidence <= 1.0

    def test_laya_triage_escalation_logic(self, service: System1Service):
        """Testa a regra de escalação para Sistema 2 quando confidence < 0.88."""
        # 1. Caso de alta confiança: Depoimento longo com muita fala (não escala)
        clear_interview = {
            "filename": "entrevista_diretora.mp4",
            "duration_s": 450.0,
            "has_video": True,
            "speech_ratio": 0.75,
            "folder": "entrevistas/dia1"
        }
        res_clear = service.evaluate_triage(clear_interview)
        assert res_clear.category == "depoimento"
        assert res_clear.confidence >= 0.88
        assert res_clear.escalate_to_system2 is False

        # 2. Caso de áudio puro (não escala)
        audio_only = {
            "filename": "som_direto_take1.wav",
            "extension": ".wav",
            "duration_s": 120.0,
            "has_video": False,
            "speech_ratio": 0.0
        }
        res_audio = service.evaluate_triage(audio_only)
        assert res_audio.category == "tecnico"
        assert res_audio.confidence >= 0.88
        assert res_audio.escalate_to_system2 is False

        # 3. Caso ambíguo (deve escalar obrigatoriamente para Sistema 2)
        ambiguous_clip = {
            "filename": "clip_indefinido_092.mp4",
            "duration_s": 65.0,
            "has_video": True,
            "speech_ratio": 0.22,
            "folder": "diversos"
        }
        res_ambiguous = service.evaluate_triage(ambiguous_clip)
        assert res_ambiguous.confidence < 0.88
        assert res_ambiguous.escalate_to_system2 is True
        assert "necessita deliberação" in res_ambiguous.reason.lower() or "sistema 2" in res_ambiguous.reason.lower()

    def test_timeline_safety_gatekeeper(self, service: System1Service):
        """Testa o Jev Safety Gatekeeper inspecionando propostas de mutação na timeline."""
        # Operação segura: corte pontual
        safe_req = {
            "operations": [{"action": "INSERT", "track": "V2", "video_id": 10, "timeline_start": 5.0}],
            "rationale": "Inserção de B-roll para cobrir fala sobre montagem da luz."
        }
        safe_decision = service.audit_timeline_mutation(safe_req)
        assert safe_decision.allow_execution is True
        assert safe_decision.risk_level == "safe"

        # Operação de atenção: substituição de múltiplos clipes
        warning_req = {
            "operations": [
                {"action": "REPLACE", "track": "V1", "target_clip_id": "c1", "video_id": 12},
                {"action": "INSERT", "track": "V2", "video_id": 14, "timeline_start": 20.0},
            ],
            "rationale": "Reorganização da narrativa com novo depoimento."
        }
        warn_decision = service.audit_timeline_mutation(warning_req)
        assert warn_decision.allow_execution is True
        assert warn_decision.requires_confirmation is True
        assert warn_decision.risk_level == "warning"

        # Operação destrutiva: exclusões em massa sem justificativa adequada
        destructive_req = {
            "operations": [
                {"action": "DELETE", "track": "V1", "target_clip_id": "c1"},
                {"action": "DELETE", "track": "V1", "target_clip_id": "c2"},
                {"action": "DELETE", "track": "V1", "target_clip_id": "c3"},
            ],
            "rationale": "limpar"  # Muito curta
        }
        dest_decision = service.audit_timeline_mutation(destructive_req)
        assert dest_decision.allow_execution is False
        assert dest_decision.risk_level == "destructive"
        assert dest_decision.requires_confirmation is True

    def test_rag_intent_routing(self, service: System1Service):
        """Testa classificação e despacho de coleção vetorial (capiau_making_of vs capiau_images)."""
        # Busca visual -> capiau_images
        vis_res = service.route_rag_query("fotos da câmera e tripé no plano detalhe")
        assert vis_res.target_collection == "capiau_images"
        assert vis_res.intent == "visual_clip"
        assert vis_res.routing_time_ms < 50.0

        # Busca textual de falas -> capiau_making_of
        txt_res = service.route_rag_query("o que a diretora falou sobre a cena da cozinha?")
        assert txt_res.target_collection == "capiau_making_of"
        assert txt_res.intent == "textual"
        assert txt_res.routing_time_ms < 50.0


# ── Testes 2: Grounding Espacial Canônico Gemini ──────────────────────────────

class TestGeminiSpatialGrounding:
    def test_validate_gemini_box(self):
        # Válidos
        assert validate_gemini_box([0, 0, 1000, 1000]) is True
        assert validate_gemini_box([100, 200, 300, 400]) is True
        assert validate_gemini_box([0, 0, 0, 0]) is True
        # Inválidos
        assert validate_gemini_box([0, 0, 1000]) is False  # 3 elementos
        assert validate_gemini_box([0, 0, 1000, 1001]) is False  # > 1000
        assert validate_gemini_box([-5, 0, 500, 500]) is False  # < 0
        assert validate_gemini_box([500, 200, 100, 400]) is False  # ymin > ymax
        assert validate_gemini_box([100, 500, 300, 200]) is False  # xmin > xmax
        assert validate_gemini_box([0.5, 0.2, 0.8, 0.9]) is False  # floats
        assert validate_gemini_box([True, 0, 100, 100]) is False  # bool

    def test_clamp_gemini_box(self):
        assert clamp_gemini_box([-50, 1200, 500, 300]) == [0, 300, 500, 1000]
        assert clamp_gemini_box([0.45, 0.12, 0.95, 0.88]) == [0, 0, 1, 1]

    def test_bidirectional_yolo_conversions(self):
        # Top-left YOLO: [rx, ry, rw, rh] = [0.1, 0.2, 0.3, 0.4]
        gbox = yolo_to_gemini_box(0.1, 0.2, 0.3, 0.4)
        assert gbox == [200, 100, 600, 400]
        assert validate_gemini_box(gbox) is True

        ybox = gemini_to_yolo_box(gbox)
        assert pytest.approx(ybox, abs=1e-3) == [0.1, 0.2, 0.3, 0.4]

        # Center YOLO: [cx, cy, w, h] = [0.25, 0.4, 0.3, 0.4]
        gbox_center = yolo_center_to_gemini_box(0.25, 0.4, 0.3, 0.4)
        assert gbox_center == [200, 100, 600, 400]

        ybox_center = gemini_to_yolo_center_box(gbox_center)
        assert pytest.approx(ybox_center, abs=1e-3) == [0.25, 0.4, 0.3, 0.4]

    def test_bidirectional_dinox_conversions(self):
        # DINO-X: [x1, y1, x2, y2] = [0.15, 0.25, 0.85, 0.75]
        gbox = dinox_to_gemini_box(0.15, 0.25, 0.85, 0.75)
        assert gbox == [250, 150, 750, 850]
        assert validate_gemini_box(gbox) is True

        dinox_back = gemini_to_dinox_box(gbox)
        assert pytest.approx(dinox_back, abs=1e-3) == [0.15, 0.25, 0.85, 0.75]

    def test_bidirectional_pixel_conversions(self):
        # Imagem 1920x1080
        # Pixel box: ymin=108, xmin=192, ymax=540, xmax=960
        gbox = pixel_to_gemini_box([108, 192, 540, 960], img_width=1920, img_height=1080)
        assert gbox == [100, 100, 500, 500]

        px_back = gemini_to_pixel_box(gbox, img_width=1920, img_height=1080)
        assert px_back == [108, 192, 540, 960]

    def test_calculate_box_iou(self):
        box1 = [100, 100, 300, 300]
        box2 = [100, 100, 300, 300]
        assert calculate_box_iou(box1, box2) == 1.0

        box3 = [500, 500, 800, 800]
        assert calculate_box_iou(box1, box3) == 0.0

        # Sobreposição parcial
        box4 = [200, 200, 400, 400]
        iou = calculate_box_iou(box1, box4)
        assert 0.14 <= iou <= 0.15

    def test_qdrant_payload_formatting(self):
        raw_objects = [
            {"rotulo": "Câmera", "categoria": "equipamento", "box_2d": [100, 200, 300, 400], "confianca": 0.96},
            {"rotulo": "Claquete", "categoria": "prop_cena", "realm": "story", "box_2d": "[500, 600, 700, 800]"}
        ]
        formatted = format_qdrant_detected_objects(raw_objects)
        assert len(formatted) == 2
        assert formatted[0]["label"] == "câmera"
        assert formatted[0]["category"] == "equipamento"
        assert formatted[0]["realm"] == "production"
        assert formatted[0]["box_2d"] == [100, 200, 300, 400]

        assert formatted[1]["label"] == "claquete"
        assert formatted[1]["category"] == "prop_cena"
        assert formatted[1]["realm"] == "story"
        assert formatted[1]["box_2d"] == [500, 600, 700, 800]

        facets = format_qdrant_image_facets(formatted)
        assert "câmera" in facets["objects"]
        assert "claquete" in facets["props"]
        assert "production:equipamento" in facets["realm_tags"]
        assert "story:prop_cena" in facets["realm_tags"]


# ── Testes 3: Unificação Biométrica Facial 512-d ──────────────────────────────

class TestFacialBiometrics512:
    def test_local_backend_standardized_on_512(self):
        backend = LocalBackend()
        assert backend.get_embedding_dimension() == 512
        assert backend.tier == 0
        assert backend.model_name == "scrfd_arcface"
        assert backend.model_version == "buffalo_sc"

    def test_feature_extraction_produces_normalized_512_vector(self):
        # Cria imagem facial sintética 112x112
        fake_crop = np.random.randint(0, 255, (112, 112, 3), dtype=np.uint8)
        feat = _extract_512d_feature(fake_crop)
        assert len(feat) == 512
        norm = np.linalg.norm(np.array(feat))
        assert pytest.approx(norm, abs=1e-2) == 1.0

    def test_face_migration_script(self, tmp_path: Path):
        """Testa o script de migração scripts/migrate_face_embeddings_512.py em um banco temporário."""
        db_file = tmp_path / "test_migration.db"
        conn = sqlite3.connect(db_file)
        conn.execute("""
            CREATE TABLE face (id INTEGER PRIMARY KEY, crop_path TEXT, photo_id INTEGER, video_id INTEGER, timestamp REAL, bounding_box TEXT);
        """)
        conn.execute("""
            CREATE TABLE face_recognition (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                face_id INTEGER,
                tier INTEGER,
                model TEXT,
                model_version TEXT,
                embedding TEXT,
                confidence REAL
            );
        """)
        # Insere registro legado 128-d
        legacy_128 = [round(float(i) / 128.0, 4) for i in range(128)]
        conn.execute(
            "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, ?, ?, ?, ?, ?)",
            (1, 0, "yunet_sface", "2023-2021", json.dumps(legacy_128), 0.85)
        )
        # Insere registro já em 512-d
        already_512 = [0.0] * 512
        already_512[0] = 1.0
        conn.execute(
            "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, ?, ?, ?, ?, ?)",
            (2, 0, "arcface_512_onnx", "buffalo_sc", json.dumps(already_512), 0.95)
        )
        conn.commit()
        conn.close()

        from scripts.migrate_face_embeddings_512 import run_face_migration
        stats = run_face_migration(db_file, dry_run=False, verbose=False)

        assert stats["total_checked"] == 2
        assert stats["legacy_128d_found"] == 1
        assert stats["already_512d"] == 1
        assert stats["migrated_from_projection"] == 1

        # Confere se no banco o registro 1 agora tem 512 dimensões e modelo atualizado
        conn = sqlite3.connect(db_file)
        row = conn.execute("SELECT embedding, model, model_version FROM face_recognition WHERE id = 1").fetchone()
        emb_migrated = json.loads(row[0])
        assert len(emb_migrated) == 512
        assert row[1] == "arcface_512_onnx"
        assert row[2] == "buffalo_sc"
        conn.close()


# ── Testes 4: Governança de Prompts & Personas Editoriais ─────────────────────

class TestPromptGovernanceAndPersonas:
    def test_catalog_has_all_19_prompts(self):
        """Verifica a integridade absoluta dos 19 prompts oficiais do PROMPT_REGISTRY."""
        expected_prompts = {
            "vision", "photo_vision", "triage", "triage_batch_title", "enrichment_rewrite",
            "interview_summary", "broll_summary", "theme_naming", "theme_clustering",
            "script_format_detect", "script_extract", "timeline_suggestion",
            "persona.montadora", "persona.diretora", "persona.sound_designer", "persona.colorista",
            "agent_system", "chatbot_system", "rag_categorize"
        }
        actual_prompts = set(PROMPT_REGISTRY.keys())
        assert actual_prompts == expected_prompts, f"Diferença no catálogo de prompts: {actual_prompts ^ expected_prompts}"
        assert len(PROMPT_REGISTRY) == 19

    def test_all_prompts_pass_template_validation(self):
        """Valida que todos os 19 prompts possuem seus placeholders obrigatórios presentes."""
        for prompt_id, entry in PROMPT_REGISTRY.items():
            valid, err = validate_template(prompt_id, entry["default"])
            assert valid is True, f"Falha de validação no prompt '{prompt_id}': {err}"

    def test_photo_vision_and_batch_title_templates(self):
        """Valida novos templates de photo_vision e triage_batch_title."""
        photo_prompt = get_prompt(
            "photo_vision",
            context_block="ENTIDADES: Diretora Ana",
            categories_block="OBRA, PROCESSO",
            triage_feedback_block="FEEDBACK: nenhum"
        )
        assert "ENTIDADES: Diretora Ana" in photo_prompt
        assert "box_2d" in photo_prompt
        assert "objetos_props" in photo_prompt

        batch_prompt = get_prompt(
            "triage_batch_title",
            items_payload='[{"id": 1, "filename": "teste.mp4"}]'
        )
        assert '[{"id": 1, "filename": "teste.mp4"}]' in batch_prompt
        assert "TÍTULO EXECUTIVO" in batch_prompt

    def test_personas_have_deep_guidelines_and_story_production_isolation(self):
        """Verifica diretrizes detalhadas e isolamento de realms nas personas."""
        montadora = PROMPT_REGISTRY["persona.montadora"]["default"]
        assert "RITMO DRAMÁTICO" in montadora
        assert "L-Cuts" in montadora
        assert "DELETE" in montadora

        diretora = PROMPT_REGISTRY["persona.diretora"]["default"]
        assert "ESTRUTURA NARRATIVA" in diretora
        assert "INSERT" in diretora
        assert "realm='story'" in diretora
        assert "realm='production'" in diretora

        sound = PROMPT_REGISTRY["persona.sound_designer"]["default"]
        assert "PAISAGEM ACÚSTICA" in sound
        assert "J-Cuts" in sound
        assert "LUFS" in sound

        colorista = PROMPT_REGISTRY["persona.colorista"]["default"]
        assert "CONTINUIDADE VISUAL" in colorista
        assert "jump cuts" in colorista.lower()
        assert "photo" in colorista


# ── Testes 5: SQLite DDL & Migrações ─────────────────────────────────────────

class TestSqliteSchemaEvolution:
    @pytest.fixture
    def memory_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.executescript(SCHEMA_SQL)
        migrate_storage_schema(conn)
        return conn

    def test_detected_object_table_and_indexes(self, memory_db: sqlite3.Connection):
        cursor = memory_db.cursor()
        # Insere projeto base
        cursor.execute("INSERT INTO project (id, name) VALUES (1, 'Doc Teste')")
        cursor.execute("""
            INSERT INTO detected_object (
                project_id, label, category, realm, bounding_box, confidence, detector_model
            ) VALUES (1, 'câmera', 'equipamento', 'production', '[100, 200, 300, 400]', 0.95, 'gemini_spatial')
        """)
        memory_db.commit()

        cursor.execute("SELECT label, bounding_box, confidence FROM detected_object WHERE project_id = 1")
        row = cursor.fetchone()
        assert row[0] == "câmera"
        assert json.loads(row[1]) == [100, 200, 300, 400]
        assert row[2] == 0.95

        # Checa os 7 índices
        cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='detected_object'")
        indexes = {r[0] for r in cursor.fetchall()}
        for expected_idx in [
            "idx_obj_project", "idx_obj_video", "idx_obj_photo", "idx_obj_label",
            "idx_obj_entity", "idx_obj_scene", "idx_obj_realm"
        ]:
            assert expected_idx in indexes, f"Índice '{expected_idx}' ausente em detected_object"

    def test_overlapping_speech_dialogue_tables(self, memory_db: sqlite3.Connection):
        cursor = memory_db.cursor()
        cursor.execute("INSERT INTO project (id, name) VALUES (1, 'Doc Teste')")
        cursor.execute("INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (10, 1, 'debated.mp4', 'p.mp4', 'hash123')")

        # Insere fala sobreposta: Locutor A (10.0 a 20.0s) e Locutor B (15.0 a 25.0s)
        cursor.execute("""
            INSERT INTO dialogue_utterance (id, video_id, speaker_id, start_s, end_s, text, is_overlapping)
            VALUES (1, 10, 'Locutor A', 10.0, 20.0, 'Fala do primeiro locutor.', 1)
        """)
        cursor.execute("""
            INSERT INTO dialogue_utterance (id, video_id, speaker_id, start_s, end_s, text, is_overlapping)
            VALUES (2, 10, 'Locutor B', 15.0, 25.0, 'Fala concorrente por cima.', 1)
        """)
        # Insere palavras vinculadas
        cursor.execute("""
            INSERT INTO dialogue_word (utterance_id, video_id, word, start_s, end_s)
            VALUES (1, 10, 'Fala', 10.0, 10.5)
        """)
        memory_db.commit()

        # Consulta pares concorrentes
        cursor.execute("""
            SELECT u1.speaker_id, u2.speaker_id
            FROM dialogue_utterance u1
            JOIN dialogue_utterance u2 ON u1.video_id = u2.video_id
                                      AND u1.id < u2.id
                                      AND u1.speaker_id != u2.speaker_id
                                      AND u1.start_s < u2.end_s
                                      AND u2.start_s < u1.end_s
        """)
        overlap_pairs = cursor.fetchall()
        assert len(overlap_pairs) == 1
        assert overlap_pairs[0] == ("Locutor A", "Locutor B")

    def test_entity_mention_columns_and_migration_idempotency(self, memory_db: sqlite3.Connection):
        cursor = memory_db.cursor()
        cursor.execute("PRAGMA table_info(entity_mention)")
        cols = {r[1] for r in cursor.fetchall()}
        assert "bounding_box" in cols
        assert "confidence" in cols
        assert "detected_label" in cols

        # Executa a migração 3 vezes seguidas para provar idempotência absoluta
        migrate_storage_schema(memory_db)
        migrate_storage_schema(memory_db)
        migrate_storage_schema(memory_db)


# ── Testes 6: Resolução Dinâmica de Configurações ────────────────────────────

class TestSettingsDynamicResolution:
    def test_categories_includes_objects_props(self):
        cat_ids = {c["id"] for c in CATEGORIES}
        assert "objects_props" in cat_ids

    def test_settings_registry_has_2026_keys(self):
        reg_map = get_registry_map()
        expected_keys = [
            "api.gemini_key", "api.anthropic_key", "api.deepseek_key",
            "api.typesafe_key", "api.nvidia_nim_key", "api.local_vlm_endpoint",
            "object.detector_engine", "object.min_confidence", "object.classes_filter",
            "object.execution_mode", "object.auto_crop", "object.link_script_props",
            "triage.system1_enabled", "triage.escalation_threshold",
            "transcription.engine", "diarization.engine", "diarization.max_speakers"
        ]
        for k in expected_keys:
            assert k in reg_map, f"Configuração obrigatória '{k}' não registrada no SETTINGS_REGISTRY"

    def test_api_key_resolution_and_env_fallbacks(self, monkeypatch):
        from src.services.settings_service import ResolvedSettings

        monkeypatch.setenv("GEMINI_API_KEY", "gemini-sec-123")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-sec-456")
        monkeypatch.setenv("TYPESAFE_API_KEY", "typesafe-sec-789")

        S = ResolvedSettings({})
        assert S.api_key("gemini") == "gemini-sec-123"
        assert S.api_key("deepseek") == "deepseek-sec-456"
        assert S.api_key("typesafe") == "typesafe-sec-789"

        with pytest.raises(KeyError):
            S.api_key("provedor_fantasma_xpto")
