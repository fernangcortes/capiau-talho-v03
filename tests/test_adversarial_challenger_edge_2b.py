"""tests/test_adversarial_challenger_edge_2b.py — Empirical Adversarial Challenge.

Challenger Agent: challenger_edge_2b
Tests Requirement 3: 512-d Biometrics Vector Consistency & DBSCAN Clustering Post-Migration.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pytest

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.vision.backends.local_backend import LocalBackend, _extract_512d_feature
from scripts.migrate_face_embeddings_512 import project_128_to_512, run_face_migration
from src.vision.face_pipeline import FacePipeline
from src.services.face_service import FaceService
from src.db.schema import SCHEMA_SQL


class TestAdversarialLocalBackend512:
    """Stress tests LocalBackend face embedding extraction dimension and normalization."""

    def test_local_backend_metadata_and_dimensions(self):
        backend = LocalBackend()
        assert backend.get_embedding_dimension() == 512, "Backend dimension must be strictly 512"
        assert backend.tier == 0, "Tier must be 0"
        assert backend.model_name == "scrfd_arcface", "Model name must be scrfd_arcface"
        assert backend.model_version == "buffalo_sc", "Model version must be buffalo_sc"

    @pytest.mark.parametrize("shape", [
        (112, 112, 3),   # Standard ArcFace input
        (1, 1, 3),       # Minimum valid image
        (10, 10, 3),     # Tiny crop
        (500, 500, 3),   # High resolution crop
        (50, 200, 3),    # Non-square vertical
        (200, 50, 3),    # Non-square horizontal
    ])
    def test_extract_feature_various_dimensions(self, shape):
        """Stress-test _extract_512d_feature with synthetic crops of varying resolutions."""
        np.random.seed(42)
        crop = np.random.randint(0, 256, shape, dtype=np.uint8)
        feat = _extract_512d_feature(crop)

        assert isinstance(feat, list), "Output must be a list"
        assert len(feat) == 512, f"Feature dimension must be exactly 512, got {len(feat)}"
        assert all(isinstance(x, float) for x in feat), "All elements must be floats"
        assert np.isfinite(feat).all(), "Feature vector must contain no NaN or Inf"

        norm = np.linalg.norm(np.array(feat, dtype=np.float32))
        assert abs(norm - 1.0) < 1e-3, f"L2 norm must be approximately 1.0, got {norm}"

    def test_extract_feature_edge_cases_pixel_values(self):
        """Stress-test _extract_512d_feature with extreme pixel distributions."""
        # 1. Solid black image
        black_crop = np.zeros((112, 112, 3), dtype=np.uint8)
        feat_black = _extract_512d_feature(black_crop)
        assert len(feat_black) == 512
        assert abs(np.linalg.norm(feat_black) - 1.0) < 1e-3

        # 2. Solid white image
        white_crop = np.full((112, 112, 3), 255, dtype=np.uint8)
        feat_white = _extract_512d_feature(white_crop)
        assert len(feat_white) == 512
        assert abs(np.linalg.norm(feat_white) - 1.0) < 1e-3

        # 3. None / Empty array fallback
        feat_none = _extract_512d_feature(None)
        assert len(feat_none) == 512
        assert abs(np.linalg.norm(feat_none) - 1.0) < 1e-4
        assert feat_none[0] == 1.0

        feat_empty = _extract_512d_feature(np.zeros((0, 0, 3), dtype=np.uint8))
        assert len(feat_empty) == 512
        assert abs(np.linalg.norm(feat_empty) - 1.0) < 1e-4
        assert feat_empty[0] == 1.0


class TestAdversarialFaceMigrationAndDBSCAN:
    """Stress tests migration script and verifies post-migration vectors pass DBSCAN clustering."""

    def test_project_128_to_512_properties(self):
        """Verifies harmonic projection preserves normalization and determinism."""
        # Standard 128-d vector
        np.random.seed(101)
        v128 = np.random.randn(128).astype(np.float32)
        v128 /= np.linalg.norm(v128)

        v512_a = project_128_to_512(v128.tolist())
        v512_b = project_128_to_512(v128.tolist())

        assert len(v512_a) == 512, "Must project to 512 dimensions"
        assert v512_a == v512_b, "Projection must be 100% deterministic"
        assert abs(np.linalg.norm(v512_a) - 1.0) < 1e-3, "L2 norm must be 1.0"

        # Zero vector fallback
        v_zero = [0.0] * 128
        v512_zero = project_128_to_512(v_zero)
        assert len(v512_zero) == 512
        assert abs(np.linalg.norm(v512_zero) - 1.0) < 1e-3

    def test_end_to_end_migration_and_dbscan_clustering(self, tmp_path: Path):
        """Executes full migration on mock SQLite DB and validates DBSCAN clustering with no dimension mismatch."""
        db_file = tmp_path / "test_biometrics_migration.db"
        conn = sqlite3.connect(db_file)
        
        # Cria tabelas essenciais
        conn.execute("""
            CREATE TABLE project (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.execute("""
            CREATE TABLE face (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES project(id),
                cluster_id INTEGER,
                name TEXT,
                bounding_box TEXT,
                photo_id INTEGER,
                video_id INTEGER,
                timestamp REAL,
                quality_score REAL,
                blur_score REAL,
                face_size_px INTEGER,
                crop_path TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.execute("""
            CREATE TABLE face_recognition (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                face_id INTEGER NOT NULL REFERENCES face(id),
                tier INTEGER,
                model TEXT,
                model_version TEXT,
                person_id INTEGER,
                embedding TEXT,
                similarity REAL,
                confidence REAL,
                status TEXT DEFAULT 'auto',
                recognized_by TEXT,
                recognized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                raw_response TEXT,
                cost_usd REAL DEFAULT 0.0,
                processing_time_ms INTEGER
            );
        """)

        # Insere projeto
        conn.execute("INSERT INTO project (id, name) VALUES (1, 'Doc Migracao')")

        # Gera centroides ortogonais para 2 pessoas no espaço 128-d
        np.random.seed(2026)
        center_a_128 = np.random.randn(128).astype(np.float32)
        center_a_128 /= np.linalg.norm(center_a_128)

        center_b_128 = np.random.randn(128).astype(np.float32)
        # Torna center_b estritamente ortogonal a center_a
        center_b_128 -= np.dot(center_b_128, center_a_128) * center_a_128
        center_b_128 /= np.linalg.norm(center_b_128)

        # Usar face_ids altos (>=990000) para evitar colisão com data/cache/ local
        BASE_FID = 990000

        # 10 faces da Pessoa A (128-d legado)
        for i in range(1, 11):
            fid = BASE_FID + i
            noise = np.random.randn(128).astype(np.float32) * 0.03
            vec = center_a_128 + noise
            vec /= np.linalg.norm(vec)
            conn.execute("INSERT INTO face (id, project_id, name) VALUES (?, 1, ?)", (fid, "Pessoa A"))
            conn.execute(
                "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.90)",
                (fid, json.dumps([round(float(x), 5) for x in vec.tolist()]))
            )

        # 10 faces da Pessoa B (128-d legado)
        for i in range(11, 21):
            fid = BASE_FID + i
            noise = np.random.randn(128).astype(np.float32) * 0.03
            vec = center_b_128 + noise
            vec /= np.linalg.norm(vec)
            conn.execute("INSERT INTO face (id, project_id, name) VALUES (?, 1, ?)", (fid, "Pessoa B"))
            conn.execute(
                "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.90)",
                (fid, json.dumps([round(float(x), 5) for x in vec.tolist()]))
            )

        # 5 faces da Pessoa C (JÁ em 512-d canônico)
        center_c_512 = np.random.randn(512).astype(np.float32)
        center_c_512 /= np.linalg.norm(center_c_512)
        for i in range(21, 26):
            fid = BASE_FID + i
            noise = np.random.randn(512).astype(np.float32) * 0.03
            vec = center_c_512 + noise
            vec /= np.linalg.norm(vec)
            conn.execute("INSERT INTO face (id, project_id, name) VALUES (?, 1, ?)", (fid, "Pessoa C"))
            conn.execute(
                "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, 0, 'arcface_512_onnx', 'buffalo_sc', ?, 0.95)",
                (fid, json.dumps([round(float(x), 5) for x in vec.tolist()]))
            )

        # 2 outliers aleatórios (128-d legado)
        for i in range(26, 28):
            fid = BASE_FID + i
            outlier = np.random.randn(128).astype(np.float32)
            outlier /= np.linalg.norm(outlier)
            conn.execute("INSERT INTO face (id, project_id, name) VALUES (?, 1, ?)", (fid, f"Ruido_{fid}"))
            conn.execute(
                "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, 0, 'yunet_sface', 'v1.0', ?, 0.50)",
                (fid, json.dumps([round(float(x), 5) for x in outlier.tolist()]))
            )

        # 1 registro corrompido
        conn.execute("INSERT INTO face (id, project_id, name) VALUES (?, 1, 'Corrompido')", (BASE_FID + 28,))
        conn.execute(
            "INSERT INTO face_recognition (face_id, tier, model, model_version, embedding, confidence) VALUES (?, 0, 'yunet_sface', 'v1.0', 'dados_corrompidos_json_invalido', 0.10)",
            (BASE_FID + 28,)
        )

        conn.commit()
        conn.close()

        # Executa a migração autônoma
        stats = run_face_migration(db_file, dry_run=False, verbose=False)

        assert stats["total_checked"] == 28, "Total de registros examinados deve ser 28"
        assert stats["legacy_128d_found"] == 22, "Deve encontrar exatamente 22 registros legados 128-d (10+10+2)"
        assert stats["already_512d"] == 5, "Deve manter os 5 registros que já estavam em 512-d"
        assert stats["migrated_from_crop"] + stats["migrated_from_projection"] == 22, "Todos os 22 legados devem ser migrados"
        assert stats["migrated_from_projection"] == 22, "Sem crops em disco, todos os 22 devem vir via projeção harmônica"
        assert stats["errors"] == 1, "Exatamente 1 registro corrompido deve ser computado como erro"

        # Valida que no banco TODOS os registros válidos agora são estritamente 512-d
        conn = sqlite3.connect(db_file)
        rows = conn.execute("SELECT id, face_id, embedding, model, model_version FROM face_recognition WHERE id <= 27").fetchall()
        conn.close()

        all_migrated_embeddings = []
        for r_id, f_id, emb_str, model, version in rows:
            emb = json.loads(emb_str)
            assert len(emb) == 512, f"Registro {r_id} (Face {f_id}) deve ter 512 dimensões, mas tem {len(emb)}"
            norm = np.linalg.norm(np.array(emb, dtype=np.float32))
            assert abs(norm - 1.0) < 1e-3, f"Registro {r_id} deve ter norma L2 unitária"
            assert model == "arcface_512_onnx"
            assert version == "buffalo_sc"
            all_migrated_embeddings.append(emb)

        # Teste Crítico: Passar os vetores pós-migração pelo DBSCAN do FacePipeline
        # Não pode ocorrer ValueError de mismatch dimensional!
        pipeline = FacePipeline()
        labels = pipeline.cluster_embeddings(all_migrated_embeddings, eps=0.38, min_samples=2)

        assert len(labels) == 27, "DBSCAN deve retornar label para cada embedding"
        labels_arr = np.array(labels)

        # Checa agrupamento da Pessoa A (índices 0..9)
        labels_a = labels_arr[0:10]
        assert (labels_a >= 0).all(), "Todas as faces da Pessoa A devem formar um cluster válido (não ruído)"
        assert len(set(labels_a)) == 1, "Todas as faces da Pessoa A devem pertencer ao mesmo cluster"
        cluster_a = labels_a[0]

        # Checa agrupamento da Pessoa B (índices 10..19)
        labels_b = labels_arr[10:20]
        assert (labels_b >= 0).all(), "Todas as faces da Pessoa B devem formar um cluster válido"
        assert len(set(labels_b)) == 1, "Todas as faces da Pessoa B devem pertencer ao mesmo cluster"
        cluster_b = labels_b[0]

        # Checa agrupamento da Pessoa C (índices 20..24)
        labels_c = labels_arr[20:25]
        assert (labels_c >= 0).all(), "Todas as faces da Pessoa C devem formar um cluster válido"
        assert len(set(labels_c)) == 1, "Todas as faces da Pessoa C devem pertencer ao mesmo cluster"
        cluster_c = labels_c[0]

        # Os 3 clusters devem ser mutuamente exclusivos
        assert cluster_a != cluster_b, "Cluster da Pessoa A deve ser diferente do cluster da Pessoa B"
        assert cluster_a != cluster_c, "Cluster da Pessoa A deve ser diferente do cluster da Pessoa C"
        assert cluster_b != cluster_c, "Cluster da Pessoa B deve ser diferente do cluster da Pessoa C"

        print("\n>>> SUCESSO: Todos os vetores pós-migração passaram no DBSCAN sem colisão dimensional! <<<")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
