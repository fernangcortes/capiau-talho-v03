"""Testes do Bloco 0C — Higiene Operacional, Segurança Básica & Schema."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent


def test_sec01_cors_restrito_a_origens_locais():
    from src.api.server import ORIGENS_LOCAIS_CORS, app

    assert "*" not in ORIGENS_LOCAIS_CORS
    assert any(o.startswith("http://127.0.0.1:") for o in ORIGENS_LOCAIS_CORS)
    assert any(o.startswith("http://localhost:") for o in ORIGENS_LOCAIS_CORS)

    client = TestClient(app)

    r_local = client.get("/api/modelos", headers={"Origin": ORIGENS_LOCAIS_CORS[0]})
    assert r_local.status_code == 200
    assert r_local.headers.get("access-control-allow-origin") == ORIGENS_LOCAIS_CORS[0]

    r_ext = client.get("/api/modelos", headers={"Origin": "https://atacante.exemplo"})
    assert r_ext.status_code == 200
    assert r_ext.headers.get("access-control-allow-origin") is None


def test_reload_removido_do_modo_padrao_e_compose_local():
    launch_ps1 = (RAIZ / "scripts" / "launch_capiau.ps1").read_text(encoding="utf-8")
    run_local_ps1 = (RAIZ / "scripts" / "run-local.ps1").read_text(encoding="utf-8")
    dockerfile = (RAIZ / "Dockerfile").read_text(encoding="utf-8")
    compose = (RAIZ / "docker-compose.yml").read_text(encoding="utf-8")

    assert "param([switch]$Dev)" in launch_ps1
    assert "if ($Dev)" in launch_ps1
    assert "--port 8000 --reload" not in launch_ps1

    assert "param([switch]$Dev)" in run_local_ps1
    assert "if ($Dev)" in run_local_ps1
    assert "--port 8000 --reload" not in run_local_ps1

    assert "--reload" not in dockerfile
    assert "--reload" not in compose
    assert '"127.0.0.1:8000:8000"' in compose


def test_sec03_timeline_ai_escapa_reason(monkeypatch):
    from src.services.timeline_ai import TimelineAIService

    class _FakeResp:
        status_code = 200

        @staticmethod
        def json():
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({
                                "suggestions": [
                                    {
                                        "action": "INSERT",
                                        "track": "V2",
                                        "timeline_start_s": 0.0,
                                        "type": "video",
                                        "video_id": 1,
                                        "source_in_s": 0.0,
                                        "source_out_s": 2.0,
                                        "reason": '<img src=x onerror="alert(1)"> Corte <script>xss()</script>',
                                    }
                                ]
                            })
                        }
                    }
                ]
            }

    class _FakeSettings:
        @staticmethod
        def api_key(provider):
            return "fake-key"

        @staticmethod
        def get(key):
            defaults = {
                "timeline.max_candidate_videos": 10,
                "timeline.temperature": 0.3,
                "timeline.timeout": 10,
                "timeline.default_persona": "diretora",
                "timeline.max_suggestions": 5,
                "llm.text_model": "deepseek/deepseek-v4.1-flash",
                "timeline.photo_default_duration": 4.0,
            }
            return defaults[key]

    class _FakeCursor:
        def __init__(self):
            self._q = ""

        def execute(self, sql, params=()):
            self._q = sql

        def fetchall(self):
            if "FROM video" in self._q:
                return [{"id": 1, "duration": 10.0}]
            return []

    class _FakeConn:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def cursor(self):
            return _FakeCursor()

    monkeypatch.setattr("src.services.timeline_ai.SettingsService.get_settings", lambda project_id=None: _FakeSettings())
    monkeypatch.setattr(TimelineAIService, "build_timeline_context", staticmethod(lambda *a, **kw: "ctx"))
    monkeypatch.setattr(TimelineAIService, "build_candidates_context", staticmethod(lambda *a, **kw: "cand"))
    monkeypatch.setattr("src.services.timeline_ai.get_timeline_suggestion_prompt", lambda *a, **kw: "prompt")
    monkeypatch.setattr("src.services.timeline_ai.requests.post", lambda *a, **kw: _FakeResp())
    monkeypatch.setattr("src.services.timeline_ai.get_db", lambda: _FakeConn())

    res = TimelineAIService.suggest(
        project_id=1,
        persona="diretora",
        clips=[{"id": "c1", "video_id": 1, "in_s": 0.0, "out_s": 5.0, "timeline_start_s": 0.0, "track": "V1"}],
        tracks=[{"id": "V1", "kind": "video"}, {"id": "V2", "kind": "video"}],
        brief="inserir B-roll",
    )
    assert len(res["suggestions"]) == 1
    reason = res["suggestions"][0]["reason"]
    assert "<script>" not in reason
    assert "<img" not in reason
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in reason


def test_schema_face_embedding_em_banco_novo_e_migrado(tmp_path):
    from src.db.schema import SCHEMA_SQL, init_db

    assert "embedding BLOB" in SCHEMA_SQL

    db_novo = tmp_path / "novo.db"
    init_db(db_novo)
    conn = sqlite3.connect(db_novo)
    cols_novo = {r[1] for r in conn.execute("PRAGMA table_info(face)").fetchall()}
    assert "embedding" in cols_novo
    conn.execute(
        """
        INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp, embedding)
        VALUES (?, NULL, ?, ?, ?, ?, ?)
        """,
        (1, "[0.1, 0.2, 0.3, 0.4]", None, None, None, json.dumps([0.0] * 512)),
    )
    conn.commit()
    conn.close()

    # Banco antigo criado sem coluna embedding na tabela face
    db_antigo = tmp_path / "antigo.db"
    conn_old = sqlite3.connect(db_antigo)
    conn_old.executescript("""
        CREATE TABLE project (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT);
        CREATE TABLE face (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            cluster_id INTEGER,
            name TEXT,
            bounding_box TEXT,
            photo_id INTEGER,
            video_id INTEGER,
            timestamp REAL,
            quality_score REAL,
            blur_score REAL,
            face_size_px INTEGER,
            crop_path TEXT
        );
    """)
    conn_old.commit()
    conn_old.close()

    init_db(db_antigo)
    conn_mig = sqlite3.connect(db_antigo)
    cols_mig = {r[1] for r in conn_mig.execute("PRAGMA table_info(face)").fetchall()}
    conn_mig.close()
    assert "embedding" in cols_mig


def test_resolve_ai_device_auto_cpu_cuda_directml(monkeypatch):
    from src.services.settings_service import resolve_ai_device

    assert resolve_ai_device("auto") == "cpu"
    assert resolve_ai_device("cpu") == "cpu"
    assert resolve_ai_device("desconhecido") == "cpu"

    import torch
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert resolve_ai_device("cuda") == "cuda"
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert resolve_ai_device("cuda") == "cpu"

    monkeypatch.setitem(sys.modules, "torch_directml", types.SimpleNamespace(is_available=lambda: True))
    assert resolve_ai_device("directml") == "directml"
    monkeypatch.setitem(sys.modules, "torch_directml", types.SimpleNamespace(is_available=lambda: False))
    assert resolve_ai_device("directml") == "cpu"
    monkeypatch.setitem(sys.modules, "torch_directml", None)
    assert resolve_ai_device("directml") == "cpu"


def test_defeitos_12_13_14_e_dependencias(monkeypatch):
    from src.export.video_render import titulos
    from src.services.settings_registry import get_registry_map

    # Defeito #13: ajuda de transcription.engine não promete fallback silencioso para AssemblyAI
    reg = get_registry_map()
    help_asr = reg["transcription.engine"]["help"]
    assert "para com erro" in help_asr
    assert "a transcrição sai pela AssemblyAI" not in help_asr
    assert set(reg["hardware.ai_device"]["enum"]) == set(reg["hardware.ai_device"]["enum_labels"])
    assert "indisponível nesta máquina" in reg["hardware.ai_device"]["enum_labels"]["directml"]

    # Defeito #14: modelos_locais não cita requirements-opcional.txt; requirements.txt declara pacotes
    modelos_src = (RAIZ / "src" / "services" / "modelos_locais.py").read_text(encoding="utf-8")
    assert "requirements-opcional.txt" not in modelos_src

    reqs = (RAIZ / "requirements.txt").read_text(encoding="utf-8")
    for pkg in ("pypdf", "sherpa-onnx", "soundfile", "pytest", "syrupy"):
        assert pkg in reqs, f"{pkg} ausente em requirements.txt"

    # Defeito #12: titulos.playwright_instalado() exige pacote E executável real
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    assert titulos.playwright_instalado() is False

    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(titulos, "_navegador_executavel_disponivel", lambda: False)
    assert titulos.playwright_instalado() is False

    monkeypatch.setattr(titulos, "_navegador_executavel_disponivel", lambda: True)
    assert titulos.playwright_instalado() is True


def test_navegador_executavel_disponivel_sem_binarios(monkeypatch, tmp_path):
    from src.export.video_render import titulos

    monkeypatch.setattr(titulos.shutil, "which", lambda cmd: None)
    for var in ("ProgramFiles", "ProgramFiles(x86)", "LocalAppData", "PLAYWRIGHT_BROWSERS_PATH"):
        monkeypatch.setenv(var, str(tmp_path / f"vazio_{var}"))
    monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path / "home_vazio"))
    if titulos.os.name != "nt":
        # Em POSIX, _navegador_executavel_disponivel também verifica caminhos absolutos do sistema;
        # aqui o teste principal cobre Windows/ambiente isolado quando PATH/cache estão vazios.
        return
    assert titulos._navegador_executavel_disponivel() is False


def test_docs_sincronia_bloco_0c():
    gitignore = (RAIZ / ".gitignore").read_text(encoding="utf-8")
    assert "docs/PLANO_*.md" not in gitignore
    assert "docs/HANDOFF_*.md" not in gitignore
    assert "docs/Pesquisas/" not in gitignore

    face_pipe = (RAIZ / "src" / "vision" / "face_pipeline.py").read_text(encoding="utf-8")
    assert "SCRFD + ArcFace 512-d" in face_pipe
    assert "Tier 0: YuNet + SFace" not in face_pipe
