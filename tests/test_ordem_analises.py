"""Ordem das análises da ingestão (docs/ORDEM_DAS_ANALISES.md).

Banco SQLite em memória com o schema do projeto; detector de rosto, ffmpeg e
chamadas de IA são falsos. Nada aqui toca o banco real nem a rede.
"""
import contextlib
import json
import sqlite3

import pytest

from src.db.schema import SCHEMA_SQL
from src.services.settings_registry import SETTINGS_REGISTRY
from src.services.settings_service import ResolvedSettings, SettingsService

CAIXA_THIAGO = [0.40, 0.20, 0.20, 0.30]


@pytest.fixture
def banco(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_SQL)
    # Coluna legada que o face_engine ainda usa (o banco real tem; o SCHEMA_SQL não)
    conn.execute("ALTER TABLE face ADD COLUMN embedding TEXT")
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'teste')")
    conn.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, duration, category, video_type, status)
                    VALUES (7, 1, 'take.mp4', 'C:/nao/existe/take.mp4', 'h7', 20.0, 'obra', 'broll', 'analyzed')""")
    conn.commit()

    @contextlib.contextmanager
    def get_db_falso():
        yield conn

    for alvo in ("src.db.connection.get_db", "src.services.pipeline.get_db", "src.vision.face_engine.get_db"):
        monkeypatch.setattr(alvo, get_db_falso)
    return conn


def _settings(**extra):
    valores = {e["key"]: e["default"] for e in SETTINGS_REGISTRY}
    valores.update(extra)
    return lambda project_id=None: ResolvedSettings(valores)


def _face_nomeada(conn, nome="Thiago Moyses", ts=10.0, caixa=CAIXA_THIAGO, confirmada=True):
    cur = conn.execute("""INSERT INTO face (project_id, name, bounding_box, video_id, timestamp, embedding, cluster_id)
                          VALUES (1, ?, ?, 7, ?, '[]', 3)""", (nome, json.dumps(caixa), ts))
    if confirmada:
        conn.execute("""INSERT INTO face_recognition (face_id, tier, model, status)
                        VALUES (?, 4, 'manual', 'confirmed')""", (cur.lastrowid,))
    conn.commit()
    return cur.lastrowid


def _detector(monkeypatch, caixas):
    monkeypatch.setattr("src.vision.face_engine.detect_and_embed_faces",
                        lambda image_path: [{"box": list(c), "embedding": [0.1] * 128} for c in caixas])


# ---------------------------------------------------------------------------
# Bug 1: reanálise do frame não pode apagar rosto nomeado
# ---------------------------------------------------------------------------

def test_reanalise_preserva_face_nomeada_e_troca_so_as_automaticas(banco, monkeypatch, tmp_path):
    from src.vision.face_engine import process_video_frame_faces
    nomeada = _face_nomeada(banco)
    descarte = _face_nomeada(banco, nome="Não Relevante", caixa=[0.0, 0.0, 0.1, 0.1], confirmada=False)
    banco.execute("""INSERT INTO face (project_id, name, bounding_box, video_id, timestamp, embedding)
                     VALUES (1, NULL, '[0.7, 0.7, 0.1, 0.1]', 7, 10.0, '[]')""")
    banco.execute("""INSERT INTO face (project_id, name, bounding_box, video_id, timestamp, embedding)
                     VALUES (1, 'Pessoa Desconhecida (Grupo 4)', '[0.5, 0.5, 0.1, 0.1]', 7, 10.0, '[]')""")
    banco.commit()

    # Detecção nova: o Thiago levemente deslocado + um rosto novo
    _detector(monkeypatch, [[0.41, 0.21, 0.20, 0.30], [0.05, 0.60, 0.10, 0.15]])
    process_video_frame_faces(1, 7, 10.0, tmp_path / "frame.jpg")

    faces = {r["id"]: dict(r) for r in banco.execute("SELECT * FROM face WHERE video_id = 7")}
    assert faces[nomeada]["name"] == "Thiago Moyses", "face nomeada sobrevive com o mesmo id"
    assert faces[descarte]["name"] == "Não Relevante", "descarte humano também é curadoria"
    assert banco.execute("SELECT status FROM face_recognition WHERE face_id = ?", (nomeada,)).fetchone()[0] == "confirmed"
    sem_nome = [f for f in faces.values() if not f["name"]]
    assert len(sem_nome) == 1, "só o rosto novo entra; o Thiago não vira duplicata sem nome"
    assert json.loads(sem_nome[0]["bounding_box"]) == [0.05, 0.60, 0.10, 0.15]
    assert not any((f["name"] or "").startswith("Pessoa Desconhecida") for f in faces.values()), \
        "nome provisório de cluster é automático e sai"


def test_reanalise_de_foto_preserva_face_nomeada(banco, monkeypatch, tmp_path):
    from src.vision.face_engine import process_photo_faces
    banco.execute("INSERT INTO photo (id, project_id, filename, filepath, hash) VALUES (3, 1, 'f.jpg', 'f.jpg', 'hf')")
    banco.execute("""INSERT INTO face (project_id, name, bounding_box, photo_id, embedding)
                     VALUES (1, 'Suzana', ?, 3, '[]')""", (json.dumps(CAIXA_THIAGO),))
    banco.commit()
    _detector(monkeypatch, [CAIXA_THIAGO])
    process_photo_faces(1, 3, tmp_path / "f.jpg")
    nomes = [r[0] for r in banco.execute("SELECT name FROM face WHERE photo_id = 3")]
    assert nomes == ["Suzana"]


def _pipeline_falso(banco, monkeypatch, tmp_path, capturados):
    """Monta analyze_video_vision com tudo externo falso; captura o que vai ao prompt."""
    from src.services import pipeline as mod
    P = mod.PipelineService

    class BuscaFalsa:
        def delete_video_broll_points(self, *a, **k): pass
        def index_broll_descriptions(self, *a, **k): pass

    class TarefasFalsas:
        logs = []
        def update_progress(self, *a, **k): pass
        def add_log(self, task_key, msg, level="INFO"): self.logs.append(msg)
        def is_cancelled(self, *a, **k): return False

    def frame_falso(video, ts, saida, proxy_fallback_path=None):
        saida.parent.mkdir(parents=True, exist_ok=True)
        saida.write_bytes(b"\xff\xd8jpeg")
        return True

    def prompt_falso(known_entities, detected_people, project_id=None, category=None):
        capturados.append({"pessoas": list(detected_people), "categoria": category})
        return "prompt"

    monkeypatch.setattr(SettingsService, "get_settings", _settings(**{
        "vision.use_segments": False, "clip.enabled": False, "vision.frame_interval": 10,
        "object.detector_engine": "none"}))
    monkeypatch.setattr(mod.CONFIG, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(mod, "TASK_MANAGER", TarefasFalsas())
    monkeypatch.setattr(mod.SemanticSearch, "get_instance", staticmethod(lambda: BuscaFalsa()))
    monkeypatch.setattr(mod, "extract_frame", frame_falso)
    monkeypatch.setattr(mod, "get_vision_prompt", prompt_falso)
    monkeypatch.setattr(P, "_resolve_analysis_source", staticmethod(lambda vid, fp, d: fp))
    monkeypatch.setattr(P, "call_openrouter_vision",
                        staticmethod(lambda *a, **k: {"descricao": "set de filmagem", "tags": []}))
    monkeypatch.setattr(P, "generate_video_summary", staticmethod(lambda *a, **k: True))
    monkeypatch.setattr(P, "_register_auto_mentions", staticmethod(lambda *a, **k: None))
    monkeypatch.setattr("src.nlp.enrichment_engine.enrich_video_frames", lambda *a, **k: None)
    monkeypatch.setattr("src.nlp.theme_engine.assign_media_to_themes", lambda *a, **k: None)
    # Padrão: vídeo mudo (sem ASR). Os testes da ordem trocam isto.
    monkeypatch.setattr(mod, "has_audio_stream", lambda path: False)
    P.logs = TarefasFalsas.logs
    return P


def test_nome_confirmado_chega_ao_prompt_de_visao_na_reanalise(banco, monkeypatch, tmp_path):
    from pathlib import Path
    _face_nomeada(banco, ts=10.0)
    _detector(monkeypatch, [[0.41, 0.21, 0.20, 0.30]])
    capturados = []
    P = _pipeline_falso(banco, monkeypatch, tmp_path, capturados)

    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    por_quadro = [c["pessoas"] for c in capturados]
    assert por_quadro[0] == [], "quadro 0s não tem ninguém nomeado"
    assert [p["name"] for p in por_quadro[1]] == ["Thiago Moyses"], \
        "o nome confirmado no quadro 10s precisa chegar a detected_people"
    assert banco.execute("SELECT count(*) FROM face WHERE video_id = 7 AND name = 'Thiago Moyses'").fetchone()[0] == 1


# ---------------------------------------------------------------------------
# Bug 2: analyze_video_all chamava extract_frame com argumentos trocados
# ---------------------------------------------------------------------------

def test_analyze_video_all_extrai_frame_do_rosto_na_ordem_certa(monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    P = mod.PipelineService

    @contextlib.contextmanager
    def db():
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA_SQL)
        conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
        conn.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, duration)
                        VALUES (9, 1, 'a.mp4', 'C:/v/a.mp4', 'h', 8.0)""")
        yield conn

    class TarefasFalsas:
        def update_progress(self, *a, **k): pass
        def add_log(self, *a, **k): pass

    chamadas, rostos = [], []

    def frame_falso(video_path, timestamp, output_path, proxy_fallback_path=None):
        chamadas.append((video_path, timestamp, output_path))
        assert isinstance(timestamp, float) and isinstance(output_path, Path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"jpg")
        return True

    monkeypatch.setattr(mod, "get_db", db)
    monkeypatch.setattr(mod, "TASK_MANAGER", TarefasFalsas())
    monkeypatch.setattr(mod.CONFIG, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(mod, "extract_frame", frame_falso)
    monkeypatch.setattr(mod, "process_video_frame_faces", lambda *a: rostos.append((*a, a[3].exists())))
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: True))
    monkeypatch.setattr(P, "analyze_video_vision", staticmethod(lambda *a, **k: True))

    P.analyze_video_all(9)
    quadro = tmp_path / "rosto_vid_9" / "frame_1000.jpg"
    assert chamadas == [(Path("C:/v/a.mp4"), 1.0, quadro)]
    assert rostos == [(1, 9, 1.0, quadro, True)], "o rosto desse fluxo agora roda, com o quadro no disco"
    assert not quadro.exists(), "o quadro temporário é apagado depois"


# ---------------------------------------------------------------------------
# Item 3: transcrição antes da Laya e da triagem
# ---------------------------------------------------------------------------

def _ordem_falsa(monkeypatch, P, ordem, asr_ok=True, grava_fala=True, banco=None):
    def asr(video_id, path, finalizar=True):
        ordem.append(("asr", finalizar))
        if grava_fala and banco is not None:
            banco.execute("INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id) "
                          "VALUES (?, 'ola', 0, 1, 'A')", (video_id,))
        return asr_ok
    monkeypatch.setattr(P, "transcribe_video", staticmethod(asr))
    monkeypatch.setattr(P, "triage_system1", staticmethod(lambda *a, **k: ordem.append("laya")))
    monkeypatch.setattr(P, "triage_video", staticmethod(
        lambda *a, **k: (ordem.append("triagem"), {"categoria": "obra", "confianca": 0.9})[1]))


def test_sem_transcricao_e_com_audio_transcreve_antes_da_laya_e_da_triagem(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    banco.execute("UPDATE video SET category = NULL WHERE id = 7"); banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    monkeypatch.setattr(mod, "has_audio_stream", lambda path: True)
    ordem = []
    _ordem_falsa(monkeypatch, P, ordem, banco=banco)
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    assert ordem == [("asr", False), "laya", "triagem"], "fala primeiro; resumo e temas ficam para o fim"


def test_com_transcricao_nao_transcreve_de_novo(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    banco.execute("INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id) VALUES (7, 'oi', 0, 1, 'A')")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    monkeypatch.setattr(mod, "has_audio_stream", lambda path: True)
    ordem = []
    _ordem_falsa(monkeypatch, P, ordem, banco=banco)
    P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0)
    assert ("asr", False) not in ordem


def test_asr_falhando_registra_triagem_sem_transcricao_e_a_visao_segue(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    banco.execute("UPDATE video SET category = NULL WHERE id = 7"); banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    monkeypatch.setattr(mod, "has_audio_stream", lambda path: True)
    ordem = []
    _ordem_falsa(monkeypatch, P, ordem, asr_ok=False, grava_fala=False, banco=banco)
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    assert any("triagem_sem_transcricao" in m for m in P.logs)
    assert ordem[1:] == ["laya", "triagem"]


def test_video_mudo_nao_chama_asr(banco, monkeypatch, tmp_path):
    from pathlib import Path
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    ordem = []
    _ordem_falsa(monkeypatch, P, ordem, banco=banco)
    P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0)
    assert ordem == [] and any("sem áudio" in m for m in P.logs)


@pytest.mark.parametrize("tem_fala,forcar,espera_asr", [(True, False, False), (False, False, True), (True, True, True)])
def test_analyze_video_all_nao_paga_asr_de_novo(monkeypatch, tem_fala, forcar, espera_asr):
    from src.services import pipeline as mod
    P = mod.PipelineService

    class TarefasFalsas:
        def update_progress(self, *a, **k): pass
        def add_log(self, *a, **k): pass

    @contextlib.contextmanager
    def db():
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA_SQL)
        conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
        conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash, duration) VALUES (9, 1, 'a', 'a.mp4', 'h', 0)")
        yield conn

    chamadas = []
    monkeypatch.setattr(mod, "get_db", db)
    monkeypatch.setattr(mod, "TASK_MANAGER", TarefasFalsas())
    monkeypatch.setattr(mod, "extract_frame", lambda *a, **k: False)
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: tem_fala))
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: chamadas.append("asr")))
    monkeypatch.setattr(P, "analyze_video_vision", staticmethod(lambda *a, **k: True))
    P.analyze_video_all(9, forcar_asr=forcar)
    assert (chamadas == ["asr"]) is espera_asr
