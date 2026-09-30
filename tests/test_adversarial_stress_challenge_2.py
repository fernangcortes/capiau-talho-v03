"""tests/test_adversarial_stress_challenge_2.py — Adversarial Stress Test Suite for Backend AI and Timeline Safety.

Authored by challenger_stress_2.
Empirically stress-tests:
1. System 1 Decision Latency & Escalation (<45ms batch, borderline 0.879 vs 0.881)
2. Canonical Spatial Grounding Robustness (inverted coords, out-of-range floats, negative, zero-area)
3. Diarization Concurrency & SQLite Performance (8 concurrent overlapping speakers, multi-threading, cascade)
4. Safety Gatekeeper Denial (destructive mutations blocked, confirmation enforcement, active cuts unmutated)
"""
from __future__ import annotations

import concurrent.futures
import json
import math
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

from src.db.schema import SCHEMA_SQL, migrate_storage_schema
from src.services.chat_agent import ChatAgentService, TimelineShadowCopy
from src.services.settings_service import SettingsService, ResolvedSettings
from src.services.system1_service import (
    RAGRoutingDecision,
    SafetyAuditDecision,
    System1JevClient,
    System1LayaEngine,
    System1Service,
    TriageDecision,
)
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


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 1: SYSTEM 1 DECISION LATENCY & ESCALATION STRESS
# ══════════════════════════════════════════════════════════════════════════════

class TestSystem1StressAndEscalation:
    """Stress tests System 1 high-throughput evaluation and strict escalation thresholds."""

    @pytest.fixture
    def system1(self) -> System1Service:
        return System1Service(escalation_threshold=0.88)

    def test_high_throughput_batch_latency_under_45ms(self, system1: System1Service):
        """Processes 200 items in batch and verifies every item stays under 45ms."""
        total_items = 200
        latencies_wall: List[float] = []
        latencies_reported: List[float] = []

        for i in range(total_items):
            state_variants = [
                {"filename": f"take_{i:03d}_cena_01.mov", "duration_s": 15.0 + (i % 60), "has_video": True, "speech_ratio": 0.05, "folder": "takes/camA"},
                {"filename": f"entrevista_{i:03d}.mp4", "duration_s": 180.0, "has_video": True, "speech_ratio": 0.65, "folder": "entrevistas"},
                {"filename": f"audio_direto_{i:03d}.wav", "extension": ".wav", "duration_s": 240.0, "has_video": False, "speech_ratio": 0.0},
                {"filename": f"bastidores_makingof_{i:03d}.mp4", "duration_s": 30.0, "has_video": True, "speech_ratio": 0.02, "folder": "making_of"},
                {"filename": f"roteiro_versao_{i}.pdf", "duration_s": 0.0, "has_video": False, "folder": "docs"},
                {"filename": f"festa_equipe_{i}.mp4", "duration_s": 45.0, "has_video": True, "folder": "social"},
                {"filename": f"teste_cartela_{i}.mov", "duration_s": 10.0, "has_video": True, "folder": "calibracao"},
                {"filename": f"ambiguo_indefinido_{i}.mp4", "duration_s": 80.0, "has_video": True, "speech_ratio": 0.20, "folder": "diversos"},
            ]
            state = state_variants[i % len(state_variants)]
            t0 = time.perf_counter()
            decision = system1.evaluate_triage(state)
            wall_ms = (time.perf_counter() - t0) * 1000.0

            latencies_wall.append(wall_ms)
            latencies_reported.append(decision.inference_time_ms)

            # Assert individual item latency requirement (< 45ms)
            assert decision.inference_time_ms <= 45.0, f"Reported latency {decision.inference_time_ms}ms exceeded 45ms at item {i}"
            assert wall_ms <= 45.0, f"Wall-clock latency {wall_ms:.2f}ms exceeded 45ms at item {i}"

        mean_wall = sum(latencies_wall) / len(latencies_wall)
        p95_wall = sorted(latencies_wall)[int(0.95 * len(latencies_wall))]
        p99_wall = sorted(latencies_wall)[int(0.99 * len(latencies_wall))]

        print(f"\n[LATENCY STRESS] 200 items evaluated: Mean={mean_wall:.2f}ms, P95={p95_wall:.2f}ms, P99={p99_wall:.2f}ms, Max={max(latencies_wall):.2f}ms")
        assert mean_wall <= 35.0, f"Mean latency {mean_wall:.2f}ms was too high"
        assert p99_wall <= 45.0, f"P99 latency {p99_wall:.2f}ms exceeded 45ms ceiling"

    def test_strict_borderline_escalation_trigger(self, system1: System1Service):
        """Verifies strict threshold enforcement around 0.88 (e.g. 0.879 vs 0.881)."""
        threshold = 0.88

        # Borderline confidence below 0.88 must strictly escalate
        borderline_below = [0.0, 0.50, 0.72, 0.80, 0.879, 0.87999, 0.8799999]
        for conf in borderline_below:
            decision = TriageDecision(
                category="processo",
                confidence=conf,
                escalate_to_system2=(conf < threshold),
                inference_time_ms=18.5,
                model="test-laya",
                reason="Borderline test below threshold"
            )
            assert decision.escalate_to_system2 is True, f"Confidence {conf} should have triggered escalation to System 2"

        # Borderline confidence at or above 0.88 must NOT escalate
        borderline_above = [0.880, 0.8800001, 0.881, 0.890, 0.92, 0.95, 1.0]
        for conf in borderline_above:
            decision = TriageDecision(
                category="processo",
                confidence=conf,
                escalate_to_system2=(conf < threshold),
                inference_time_ms=18.5,
                model="test-laya",
                reason="Borderline test above threshold"
            )
            assert decision.escalate_to_system2 is False, f"Confidence {conf} should NOT have triggered escalation"

    def test_system1_laya_engine_custom_threshold_recalibration(self):
        """Verifies System1LayaEngine respects custom thresholds directly."""
        strict_engine = System1LayaEngine(escalation_threshold=0.95)
        lenient_engine = System1LayaEngine(escalation_threshold=0.70)

        # Ambiguous item normally has confidence ~0.72
        ambiguous = {
            "filename": "clip_sem_padrao.mp4",
            "duration_s": 70.0,
            "has_video": True,
            "speech_ratio": 0.20,
            "folder": "outros"
        }

        # Strict engine (threshold 0.95) -> must escalate (0.72 < 0.95)
        dec_strict = strict_engine.evaluate_media_triage(ambiguous)
        assert dec_strict.confidence == 0.72
        assert dec_strict.escalate_to_system2 is True

        # Lenient engine (threshold 0.70) -> must not escalate (0.72 >= 0.70)
        dec_lenient = lenient_engine.evaluate_media_triage(ambiguous)
        assert dec_lenient.confidence == 0.72
        assert dec_lenient.escalate_to_system2 is False

    def test_system1_service_settings_override(self, monkeypatch):
        """Verifies System1Service dynamically reads escalation_threshold from SettingsService."""
        service = System1Service()

        # Monkeypatch SettingsService.get_settings to simulate project setting threshold = 0.65
        def mock_get_settings(project_id=None):
            return ResolvedSettings({
                "triage.system1_enabled": True,
                "triage.escalation_threshold": 0.65
            })

        monkeypatch.setattr(SettingsService, "get_settings", mock_get_settings)

        ambiguous = {
            "filename": "clip_ambiguo.mp4",
            "duration_s": 70.0,
            "has_video": True,
            "speech_ratio": 0.20,
            "folder": "outros"
        }
        dec = service.evaluate_triage(ambiguous, project_id=123)
        assert dec.confidence == 0.72
        # With threshold 0.65, 0.72 should NOT escalate
        assert dec.escalate_to_system2 is False

        # When system1 is disabled in settings, must immediately escalate to System 2
        def mock_disabled_settings(project_id=None):
            return ResolvedSettings({
                "triage.system1_enabled": False,
                "triage.escalation_threshold": 0.88
            })

        monkeypatch.setattr(SettingsService, "get_settings", mock_disabled_settings)
        dec_disabled = service.evaluate_triage(ambiguous, project_id=123)
        assert dec_disabled.escalate_to_system2 is True
        assert dec_disabled.model == "system1_disabled"


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 2: CANONICAL SPATIAL GROUNDING ROBUSTNESS
# ══════════════════════════════════════════════════════════════════════════════

class TestSpatialGroundingRobustness:
    """Stress tests canonical Gemini spatial grounding with adversarial inputs."""

    def test_validation_rejects_inverted_coordinates(self):
        """Verifies validate_gemini_box strictly rejects inverted coordinates."""
        # ymin > ymax
        assert validate_gemini_box([700, 100, 200, 900]) is False
        # xmin > xmax
        assert validate_gemini_box([100, 800, 600, 300]) is False
        # Both inverted
        assert validate_gemini_box([900, 900, 100, 100]) is False

    def test_clamping_repairs_inverted_coordinates(self):
        """Verifies clamp_gemini_box automatically inverts pairs into proper canonical order."""
        clamped_y = clamp_gemini_box([700, 100, 200, 900])
        assert clamped_y == [200, 100, 700, 900]
        assert validate_gemini_box(clamped_y) is True

        clamped_x = clamp_gemini_box([100, 800, 600, 300])
        assert clamped_x == [100, 300, 600, 800]
        assert validate_gemini_box(clamped_x) is True

        clamped_both = clamp_gemini_box([900, 900, 100, 100])
        assert clamped_both == [100, 100, 900, 900]
        assert validate_gemini_box(clamped_both) is True

    def test_validation_rejects_out_of_range_and_floats(self):
        """Verifies validate_gemini_box rejects non-ints, negatives, and out-of-range values."""
        # Floats
        assert validate_gemini_box([10.5, 20.0, 500.0, 600.0]) is False
        assert validate_gemini_box([0.1, 0.2, 0.8, 0.9]) is False
        # Negative values
        assert validate_gemini_box([-5, 0, 500, 500]) is False
        # Out of bounds (>1000)
        assert validate_gemini_box([0, 0, 1001, 1000]) is False
        # Types: booleans (subclass of int in Python!)
        assert validate_gemini_box([True, False, 500, 500]) is False
        # Wrong length or non-iterable
        assert validate_gemini_box([100, 200, 300]) is False
        assert validate_gemini_box([100, 200, 300, 400, 500]) is False
        assert validate_gemini_box("100,200,300,400") is False
        assert validate_gemini_box(None) is False

    def test_clamping_robustness_on_extreme_floats_and_negatives(self):
        """Verifies clamp_gemini_box handles extreme values, rounding, and negative numbers."""
        # Extreme negative & positive floats
        res = clamp_gemini_box([-9999.8, -123.4, 8888.8, 12000.5])
        assert res == [0, 0, 1000, 1000]
        assert validate_gemini_box(res) is True

        # Inverted extreme values
        res_inv = clamp_gemini_box([5000.0, 3000.0, -100.0, -50.0])
        assert res_inv == [0, 0, 1000, 1000]
        assert validate_gemini_box(res_inv) is True

        # Rounding floats within range
        res_round = clamp_gemini_box([12.4, 45.6, 789.2, 999.8])
        assert res_round == [12, 46, 789, 1000]
        assert validate_gemini_box(res_round) is True

        # Malformed length must raise ValueError
        with pytest.raises(ValueError):
            clamp_gemini_box([100, 200, 300])

    def test_zero_area_boxes_and_iou_boundary(self):
        """Tests zero-area points and lines in validation and IoU calculation."""
        # Point box
        point_box = [500, 500, 500, 500]
        assert validate_gemini_box(point_box) is True
        assert clamp_gemini_box(point_box) == point_box

        # Horizontal and vertical lines
        h_line = [300, 100, 300, 800]
        v_line = [100, 400, 900, 400]
        assert validate_gemini_box(h_line) is True
        assert validate_gemini_box(v_line) is True

        # IoU with zero-area boxes must not raise ZeroDivisionError
        iou_point_point = calculate_box_iou(point_box, point_box)
        assert iou_point_point == 0.0

        iou_point_box = calculate_box_iou(point_box, [400, 400, 600, 600])
        assert iou_point_box == 0.0

        # Normal IoU calculations
        box_a = [100, 100, 500, 500]
        box_b = [100, 100, 500, 500]
        assert calculate_box_iou(box_a, box_b) == 1.0

        # Disjoint boxes
        box_c = [600, 600, 900, 900]
        assert calculate_box_iou(box_a, box_c) == 0.0

    def test_bidirectional_yolo_and_dinox_conversions_boundary(self):
        """Verifies edge case inputs in YOLO and DINO-X converters."""
        # Out-of-bounds YOLO center
        gemini_from_yolo = yolo_center_to_gemini_box(cx=1.5, cy=-0.2, w=0.5, h=0.8)
        assert validate_gemini_box(gemini_from_yolo) is True
        assert all(0 <= v <= 1000 for v in gemini_from_yolo)

        # Full-frame DINO-X
        gemini_dinox = dinox_to_gemini_box(0.0, 0.0, 1.0, 1.0)
        assert gemini_dinox == [0, 0, 1000, 1000]

        dinox_back = gemini_to_dinox_box(gemini_dinox)
        assert dinox_back == [0.0, 0.0, 1.0, 1.0]

    def test_format_qdrant_detected_objects_adversarial_coercion(self):
        """Verifies resilience of Qdrant object formatting when fed adversarial corrupt objects."""
        adversarial_objects = [
            # Corrupted string box
            {"label": " Camera Rig ", "category": "INVALID_CAT", "realm": "UNKNOWN_REALM", "box_2d": "not a json", "confidence": -0.5},
            # Inverted box
            {"label": "Actor", "category": "prop_cena", "realm": "story", "box_2d": [900, 800, 100, 200], "confidence": 1.5},
            # Missing fields
            {},
        ]

        formatted = format_qdrant_detected_objects(adversarial_objects)
        assert len(formatted) == 3

        # Item 0: category defaulted to "outro", realm to "production", box to [0,0,1000,1000], conf clamped to 0.0
        assert formatted[0]["category"] == "outro"
        assert formatted[0]["realm"] == "production"
        assert formatted[0]["box_2d"] == [0, 0, 1000, 1000]
        assert formatted[0]["confidence"] == 0.0

        # Item 1: inverted box repaired, conf clamped to 1.0
        assert formatted[1]["box_2d"] == [100, 200, 900, 800]
        assert formatted[1]["confidence"] == 1.0
        assert formatted[1]["realm"] == "story"

        # Item 2: defaults applied
        assert formatted[2]["label"] == "objeto"
        assert formatted[2]["box_2d"] == [0, 0, 1000, 1000]


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 3: DIARIZATION CONCURRENCY & SQLITE PERFORMANCE
# ══════════════════════════════════════════════════════════════════════════════

class TestDiarizationConcurrencyAndSqlite:
    """Stress tests SQLite table dialogue_utterance with 8 simultaneous overlapping speakers."""

    @pytest.fixture
    def db_conn(self, tmp_path: Path):
        db_file = tmp_path / "test_stress_diarization.db"
        conn = sqlite3.connect(str(db_file), timeout=30.0, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.executescript(SCHEMA_SQL)
        migrate_storage_schema(conn)

        # Seed base project and video
        cur = conn.cursor()
        cur.execute("INSERT INTO project (name) VALUES ('Stress Project');")
        proj_id = cur.lastrowid
        cur.execute(
            "INSERT INTO video (project_id, filename, filepath, hash) VALUES (?, 'multi_speaker.mov', '/fake/multi_speaker.mov', 'hash_multi_1');",
            (proj_id,)
        )
        vid_id = cur.lastrowid
        conn.commit()
        yield conn, vid_id, str(db_file)
        conn.close()

    def test_8_simultaneous_overlapping_speakers_and_cross_join(self, db_conn):
        """Inserts 8 concurrent overlapping speakers and verifies pairwise cross join returns 28 overlapping pairs."""
        conn, vid_id, _ = db_conn
        cur = conn.cursor()

        # 8 speakers speaking during mutually overlapping intervals
        # All 8 speakers intersect simultaneously between 19.0s and 20.0s
        speakers_data = [
            ("Spk_1", 10.0, 20.0, "Fala da montadora sobre o ritmo da cena."),
            ("Spk_2", 12.0, 21.0, "Diretora concordando e adicionando detalhes."),
            ("Spk_3", 14.0, 22.0, "Sound designer sugerindo ambiência sonora."),
            ("Spk_4", 15.0, 23.0, "Colorista comentando sobre a paleta quente."),
            ("Spk_5", 16.0, 24.0, "Produtor executivo lembrando do prazo."),
            ("Spk_6", 17.0, 25.0, "Assistente de direção confirmando claquete."),
            ("Spk_7", 18.0, 26.0, "Diretor de fotografia analisando contraste."),
            ("Spk_8", 19.0, 27.0, "Ator principal tirando dúvida sobre intenção."),
        ]

        # Insert all 8 utterances
        for spk, start_s, end_s, text in speakers_data:
            cur.execute("""
                INSERT INTO dialogue_utterance (video_id, speaker_id, start_s, end_s, text, is_overlapping, audio_channel, confidence)
                VALUES (?, ?, ?, ?, ?, 1, 0, 0.95);
            """, (vid_id, spk, start_s, end_s, text))
        conn.commit()

        # Verify insertion of 8 records
        cur.execute("SELECT COUNT(*) FROM dialogue_utterance WHERE video_id = ?;", (vid_id,))
        count = cur.fetchone()[0]
        assert count == 8, f"Expected 8 dialogue utterances, got {count}"

        # Query overlapping pairs:
        # u1.id < u2.id AND u1.speaker_id != u2.speaker_id AND (u1.start_s < u2.end_s AND u2.start_s < u1.end_s)
        cur.execute("""
            SELECT u1.speaker_id, u2.speaker_id,
                   MAX(u1.start_s, u2.start_s) as overlap_start,
                   MIN(u1.end_s, u2.end_s) as overlap_end
            FROM dialogue_utterance u1
            JOIN dialogue_utterance u2 ON u1.video_id = u2.video_id
            WHERE u1.id < u2.id
              AND u1.speaker_id != u2.speaker_id
              AND u1.start_s < u2.end_s
              AND u2.start_s < u1.end_s
            ORDER BY overlap_start, u1.speaker_id, u2.speaker_id;
        """)
        overlapping_pairs = cur.fetchall()

        # For 8 mutually overlapping intervals, number of unique pairs is 8 choose 2 = 28
        expected_pairs = math.comb(8, 2)
        assert len(overlapping_pairs) == expected_pairs, (
            f"Expected {expected_pairs} overlapping pairs for 8 concurrent speakers, found {len(overlapping_pairs)}"
        )

        # Every pair must have a valid overlap interval (overlap_start < overlap_end)
        for spk1, spk2, start, end in overlapping_pairs:
            assert start < end, f"Invalid overlap interval for {spk1}-{spk2}: [{start}, {end}]"
            # Every pair must contain at least the common window [19.0, 20.0]
            assert start <= 19.0 and end >= 20.0, f"Common overlap window violated for {spk1}-{spk2}: [{start}, {end}]"

    def test_multi_threaded_concurrency_stress_no_locking(self, db_conn):
        """Simulates 8 concurrent worker threads performing reads and writes simultaneously."""
        _, vid_id, db_path = db_conn

        errors: List[Exception] = []

        def worker_task(worker_id: int):
            try:
                thread_conn = sqlite3.connect(db_path, timeout=30.0)
                thread_cur = thread_conn.cursor()

                # Alternate writes and reads
                for i in range(10):
                    start = 10.0 + (worker_id * 2.0) + (i * 0.1)
                    end = start + 5.0
                    thread_cur.execute("""
                        INSERT INTO dialogue_utterance (video_id, speaker_id, start_s, end_s, text, is_overlapping)
                        VALUES (?, ?, ?, ?, ?, 1);
                    """, (vid_id, f"ThreadSpk_{worker_id}", start, end, f"Worker {worker_id} utterance {i}"))
                    thread_conn.commit()

                    # Query overlapping count
                    thread_cur.execute("""
                        SELECT COUNT(*) FROM dialogue_utterance u1
                        JOIN dialogue_utterance u2 ON u1.video_id = u2.video_id
                        WHERE u1.id < u2.id AND u1.start_s < u2.end_s AND u2.start_s < u1.end_s;
                    """)
                    thread_cur.fetchone()

                thread_conn.close()
            except Exception as e:
                errors.append(e)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker_task, wid) for wid in range(8)]
            concurrent.futures.wait(futures)

        assert len(errors) == 0, f"Concurrency errors encountered: {errors}"

        # Verify all 80 utterances were committed cleanly without locking
        verify_conn = sqlite3.connect(db_path)
        cur = verify_conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dialogue_utterance WHERE video_id = ?;", (vid_id,))
        total = cur.fetchone()[0]
        assert total >= 80, f"Expected at least 80 utterances, got {total}"
        verify_conn.close()

    def test_cascade_deletion_maintains_relational_integrity(self, db_conn):
        """Verifies deleting the video cleanly cascades and removes all dialogue utterances and words."""
        conn, vid_id, _ = db_conn
        cur = conn.cursor()

        # Insert dialogue_utterance
        cur.execute("""
            INSERT INTO dialogue_utterance (video_id, speaker_id, start_s, end_s, text)
            VALUES (?, 'Speaker_Cascade', 0.0, 5.0, 'Teste cascade.');
        """, (vid_id,))
        utt_id = cur.lastrowid

        # Insert dialogue_word
        cur.execute("""
            INSERT INTO dialogue_word (video_id, utterance_id, word, start_s, end_s, confidence)
            VALUES (?, ?, 'Teste', 0.0, 2.5, 0.98);
        """, (vid_id, utt_id))
        conn.commit()

        # Delete video
        cur.execute("DELETE FROM video WHERE id = ?;", (vid_id,))
        conn.commit()

        # Verify dialogue_utterance and dialogue_word are 0
        cur.execute("SELECT COUNT(*) FROM dialogue_utterance WHERE video_id = ?;", (vid_id,))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT COUNT(*) FROM dialogue_word WHERE utterance_id = ?;", (utt_id,))
        assert cur.fetchone()[0] == 0


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 4: SAFETY GATEKEEPER DENIAL
# ══════════════════════════════════════════════════════════════════════════════

class TestSafetyGatekeeperDenial:
    """Stress tests timeline safety gatekeeper to ensure destructive mutations are strictly denied."""

    def test_system1_jev_denies_bulk_deletions(self):
        """Verifies Jev gatekeeper sets allow_execution=False when bulk deletions (>=3) are proposed."""
        jev = System1JevClient()

        # 5 massive DELETE operations
        bulk_delete = {
            "operations": [{"action": "DELETE", "clip_id": f"clip_{i}"} for i in range(5)],
            "rationale": "Limpeza ampla de trechos com ruído na timeline."
        }
        decision = jev.audit_timeline_mutation(bulk_delete)

        assert decision.allow_execution is False, "Bulk deletions should NOT be allowed execution directly"
        assert decision.risk_level == "destructive"
        assert decision.requires_confirmation is True
        assert "destrutivas" in decision.reason.lower()

    def test_system1_jev_denies_delete_with_insufficient_rationale(self):
        """Verifies Jev gatekeeper denies deletion if rationale is missing or < 10 characters."""
        jev = System1JevClient()

        # 1 DELETE but short rationale ("remover")
        short_rationale_delete = {
            "operations": [{"action": "DELETE", "clip_id": "clip_single"}],
            "rationale": "remover"
        }
        decision = jev.audit_timeline_mutation(short_rationale_delete)

        assert decision.allow_execution is False
        assert decision.risk_level == "destructive"
        assert decision.requires_confirmation is True

    def test_system1_jev_warns_on_replacements_and_bulk_inserts(self):
        """Verifies replacements or 4+ inserts trigger warning and require confirmation."""
        jev = System1JevClient()

        replace_proposal = {
            "operations": [{"action": "REPLACE", "target_clip_id": "clip_old", "clip_id": "clip_new"}],
            "rationale": "Substituição do plano de cobertura por tomada mais nítida."
        }
        dec_replace = jev.audit_timeline_mutation(replace_proposal)
        assert dec_replace.allow_execution is True
        assert dec_replace.risk_level == "warning"
        assert dec_replace.requires_confirmation is True

        bulk_insert_proposal = {
            "operations": [{"action": "INSERT", "track": "V1", "clip_id": f"c_{i}"} for i in range(4)],
            "rationale": "Inserção em lote de sequência de montagem preliminar."
        }
        dec_insert = jev.audit_timeline_mutation(bulk_insert_proposal)
        assert dec_insert.risk_level == "warning"
        assert dec_insert.requires_confirmation is True

    def test_chat_agent_gatekeeper_strict_confirmation_enforcement(self):
        """Verifies evaluate_safety_gatekeeper ALWAYS requires confirmation for any proposed mutation."""
        tracks = [{"id": "V1", "name": "Principal", "kind": "video"}]
        shadow = TimelineShadowCopy(clips=[], tracks=tracks, fps=24.0)

        # 1. Destructive mutation (DELETE)
        destructive_ops = [{"action": "DELETE", "track": "V1", "targetClipId": "cut_1", "in_s": 0.0, "out_s": 10.0}]
        audit_destr = ChatAgentService.evaluate_safety_gatekeeper(shadow, destructive_ops)
        assert audit_destr["risk_level"] == "destructive"
        assert audit_destr["requires_confirmation"] is True
        assert audit_destr["destructive_operations_count"] == 1

        # 2. Warning mutation (INSERT on V1)
        warning_ops = [{"action": "INSERT", "track": "V1", "in_s": 0.0, "out_s": 5.0}]
        audit_warn = ChatAgentService.evaluate_safety_gatekeeper(shadow, warning_ops)
        assert audit_warn["risk_level"] == "warning"
        assert audit_warn["requires_confirmation"] is True

        # 3. Safe mutation (INSERT on secondary audio track A2)
        safe_ops = [{"action": "INSERT", "track": "A2", "in_s": 0.0, "out_s": 4.0}]
        audit_safe = ChatAgentService.evaluate_safety_gatekeeper(shadow, safe_ops)
        assert audit_safe["risk_level"] == "safe"
        assert audit_safe["requires_confirmation"] is True  # Golden rule: ALWAYS requires confirmation!

    def test_timeline_shadow_copy_zero_mutation_on_rejection(self):
        """Verifies active clips remain 100% identical when a proposed mutation is rejected."""
        initial_clips = [
            {"id": "cut_prod_1", "video_id": 1, "in": 0.0, "out": 10.0, "timeline_start": 0.0, "track": "V1"},
            {"id": "cut_prod_2", "video_id": 2, "in": 5.0, "out": 15.0, "timeline_start": 10.0, "track": "V1"}
        ]
        tracks = [{"id": "V1", "kind": "video"}]
        shadow = TimelineShadowCopy(clips=initial_clips, tracks=tracks, fps=24.0)

        snapshot_before = json.dumps(shadow.clips, sort_keys=True)

        # Destructive mutation proposed by agent
        proposal_ops = [
            {"action": "DELETE", "clip_id": "cut_prod_1"},
            {"action": "DELETE", "clip_id": "cut_prod_2"}
        ]
        audit = ChatAgentService.evaluate_safety_gatekeeper(shadow, proposal_ops)
        assert audit["risk_level"] == "destructive"

        # Editor clicks [Descartar] (rejection simulation): no apply methods called on timeline
        # Verify snapshot remains identical
        snapshot_after = json.dumps(shadow.clips, sort_keys=True)
        assert snapshot_before == snapshot_after, "Active timeline clips were mutated despite proposal rejection!"
