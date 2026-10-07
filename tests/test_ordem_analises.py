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
    conn.execute("ALTER TABLE video ADD COLUMN metadata_origem TEXT DEFAULT 'ia'")  # idem, só por migração
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'teste')")
    conn.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, duration, category, video_type, status)
                    VALUES (7, 1, 'take.mp4', 'C:/nao/existe/take.mp4', 'h7', 20.0, 'cena', 'broll', 'analyzed')""")
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
    monkeypatch.setattr(mod, "detectar_natureza", lambda caminho: "video")
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
        lambda *a, **k: (ordem.append("triagem"), {"categoria": "cena", "confianca": 0.9})[1]))


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


# ---------------------------------------------------------------------------
# Item 4: piso de esforço quando a triagem é incerta
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("categoria,conf,laya,esperado", [
    ("convivio", 0.9, None, "triagem"),          # firme: economiza
    ("convivio", 0.9, "convivio", "triagem"),   # Laya concorda
    ("convivio", 0.4, None, "completo"),         # abaixo do limiar
    ("convivio", None, None, "completo"),        # confiança vazia = incerta
    ("convivio", 0.9, "cena", "completo"),       # Laya discorda
    ("convivio", 0.95, "terceiros", "completo"),
    ("teste", 0.3, None, "completo"),           # reduzido também sobe
    ("convivio", 1.0, "cena", "triagem"),        # correção humana manda
    ("cena", 0.2, "convivio", "completo"),         # piso nunca corta
    (None, None, None, "completo"),
])
def test_piso_de_esforco(categoria, conf, laya, esperado):
    from src.services.analysis_policy import get_profile
    assert get_profile(categoria, None, confianca=conf, limiar=0.55, categoria_laya=laya).effort == esperado


def test_get_profile_sem_confianca_mantem_comportamento_antigo():
    from src.services.analysis_policy import get_profile
    assert get_profile("convivio").effort == "triagem"
    assert get_profile("convivio", '{"convivio": "completo"}').effort == "completo"


def _laya(conn, video_id, categoria):
    conn.execute("""INSERT INTO system1_decisao (project_id, media_kind, media_id, tarefa, motor, modo,
                    estado_json, perguntas_json, categoria, confianca)
                    VALUES (1, 'video', ?, 'triagem', 'laya-multilingual', 'sombra', '{}', '[]', ?, 0.6)""",
                 (video_id, categoria))
    conn.commit()


@pytest.mark.parametrize("laya,quadros", [("convivio", 2), ("cena", 6)])
def test_pipeline_aplica_o_piso_com_a_discordancia_da_laya(banco, monkeypatch, tmp_path, laya, quadros):
    from pathlib import Path
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 0.92, duration = 60 WHERE id = 7")
    banco.commit()
    _laya(banco, 7, laya)
    capturados = []
    P = _pipeline_falso(banco, monkeypatch, tmp_path, capturados)
    _detector(monkeypatch, [])
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 60.0) is True
    assert len(capturados) == quadros


def test_fila_de_revisao_inclui_discordancia_e_confianca_vazia(banco, monkeypatch):
    from src.api.routes.media import triage_review_queue
    monkeypatch.setattr(SettingsService, "get_settings", _settings())
    banco.execute("UPDATE video SET category_confidence = 1.0 WHERE id = 7")
    linhas = [  # id, categoria, confiança, laya
        (20, "cena", 0.95, "cena"),      # firme e concorda: fora
        (21, "cena", 0.95, "convivio"),   # discorda: dentro
        (22, "cena", None, None),        # vazia: dentro
        (23, "cena", 0.30, None),        # baixa: dentro
        (24, "cena", 1.0, "convivio"),    # humana: fora
    ]
    for vid, cat, conf, laya in linhas:
        banco.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence)
                         VALUES (?, 1, 'v', 'v', ?, ?, ?)""", (vid, f"h{vid}", cat, conf))
        if laya:
            _laya(banco, vid, laya)
    banco.commit()
    fila = triage_review_queue(1, conn=banco)
    assert sorted(v["id"] for v in fila["videos"]) == [21, 22, 23]
    assert {v["id"]: v["categoria_laya"] for v in fila["videos"]}[21] == "convivio"


# ---------------------------------------------------------------------------
# Item 5: correção humana de categoria marca análise desatualizada (só marca)
# ---------------------------------------------------------------------------

def _corrigir(banco, monkeypatch, categoria):
    from src.api.routes.media import update_video_category
    from src.api.schemas import CategoryUpdate

    class SemClip:
        @staticmethod
        def get_instance():
            raise RuntimeError("CLIP fora do teste")

    monkeypatch.setattr(SettingsService, "get_settings", _settings())
    monkeypatch.setattr("src.search.image_semantic.ImageSearch", SemClip)
    return update_video_category(7, CategoryUpdate(category=categoria), conn=banco)


def _marca(banco):
    return banco.execute("SELECT analise_desatualizada FROM video WHERE id = 7").fetchone()[0]


def test_subir_esforco_marca_e_oferece_reanalise_sem_rodar_nada(banco, monkeypatch):
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 0.9, "
                  "esforco_analisado = 'triagem', description = 'almoço' WHERE id = 7")
    banco.commit()
    r = _corrigir(banco, monkeypatch, "cena")
    assert "triagem" in r["analise_desatualizada"] and "completo" in r["analise_desatualizada"]
    assert r["reanalise"] == {"metodo": "POST", "rota": "/api/video/7/analyze-vision"}
    assert _marca(banco) == r["analise_desatualizada"]
    assert banco.execute("SELECT status, description FROM video WHERE id = 7").fetchone()[:] == ("analyzed", "almoço")

    # Voltar à categoria antiga desfaz a marca
    r = _corrigir(banco, monkeypatch, "convivio")
    assert r["analise_desatualizada"] is None and "reanalise" not in r and _marca(banco) is None


def test_descer_esforco_nao_marca_nem_apaga(banco, monkeypatch):
    banco.execute("UPDATE video SET esforco_analisado = 'completo', description = 'take 3' WHERE id = 7")
    banco.commit()
    r = _corrigir(banco, monkeypatch, "convivio")
    assert r["analise_desatualizada"] is None and _marca(banco) is None
    assert banco.execute("SELECT description FROM video WHERE id = 7").fetchone()[0] == "take 3"


def test_analise_antiga_sem_esforco_registrado_usa_o_perfil_da_categoria_anterior(banco, monkeypatch):
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 0.9, esforco_analisado = NULL WHERE id = 7")
    banco.commit()
    assert _corrigir(banco, monkeypatch, "bastidor")["analise_desatualizada"]


def test_video_que_nunca_passou_pela_visao_nao_fica_desatualizado(banco, monkeypatch):
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 0.9, "
                  "esforco_analisado = NULL, status = 'transcribed' WHERE id = 7")
    banco.commit()
    assert _corrigir(banco, monkeypatch, "cena")["analise_desatualizada"] is None


def test_analise_de_visao_registra_esforco_e_limpa_a_marca(banco, monkeypatch, tmp_path):
    from pathlib import Path
    banco.execute("UPDATE video SET category_confidence = 1.0, analise_desatualizada = 'x' WHERE id = 7")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    _detector(monkeypatch, [])
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    assert banco.execute("SELECT esforco_analisado, analise_desatualizada FROM video WHERE id = 7").fetchone()[:] \
        == ("completo", None)


# ---------------------------------------------------------------------------
# Item 6: um resumo só (fala + imagem + categoria), temas uma vez
# ---------------------------------------------------------------------------

class _RespostaLLM:
    status_code = 200

    def json(self):
        return {"choices": [{"message": {"content": json.dumps(
            {"titulo": "Ensaio no galpão", "description": "d", "summary": "s", "tags": ["ensaio"]})}}]}


def _llm_falso(monkeypatch):
    from src.services import pipeline as mod
    prompts = []
    monkeypatch.setattr(SettingsService, "get_settings", _settings(**{"api.openrouter_key": "sk-teste"}))
    monkeypatch.setattr(mod.requests, "post",
                        lambda url, headers=None, json=None, timeout=None: (prompts.append(json["messages"][0]["content"]), _RespostaLLM())[1])
    return prompts


def _fala(banco, video_id=7, texto="a gente montou a luz de madrugada"):
    for i, w in enumerate(texto.split()):
        banco.execute("INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id) VALUES (?, ?, ?, ?, 'A')",
                      (video_id, w, float(i), float(i) + 0.5))
    banco.commit()


def test_visao_guarda_a_descricao_de_cada_keyframe_no_sqlite(banco, monkeypatch, tmp_path):
    from pathlib import Path
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    _detector(monkeypatch, [])
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    linhas = banco.execute("SELECT timestamp, descricao FROM video_keyframe WHERE video_id = 7 ORDER BY timestamp").fetchall()
    assert [tuple(l) for l in linhas] == [(0.0, "set de filmagem"), (10.0, "set de filmagem")]
    # Reanálise substitui, não duplica
    P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0)
    assert banco.execute("SELECT count(*) FROM video_keyframe WHERE video_id = 7").fetchone()[0] == 2


def test_resumo_mescla_fala_imagem_e_categoria(banco, monkeypatch):
    from src.services.pipeline import PipelineService
    _fala(banco)
    PipelineService._gravar_keyframes(1, 7, [{"timestamp": 3.0, "description": "refletor sendo içado", "tags": ["luz"]}])
    prompts = _llm_falso(monkeypatch)
    # O fluxo de ASR pede 'interview', mas a imagem já gravada entra junto
    assert PipelineService.generate_video_summary(7, "interview", 1) is True
    p = prompts[0]
    assert "madrugada" in p and "refletor sendo içado" in p, "fala e imagem no mesmo resumo"
    # Com imagem, o resumo julga a categoria em vez de recebê-la (docs/REVISAO_CATEGORIAS.md, seção 11)
    assert "CLASSIFIQUE TAMBÉM O VÍDEO" in p and "CLASSIFICAÇÃO DO ARQUIVO" not in p
    assert banco.execute("SELECT title FROM video WHERE id = 7").fetchone()[0] == "Ensaio no galpão"


def test_resumo_so_de_fala_recebe_a_categoria(banco, monkeypatch):
    from src.services.pipeline import PipelineService
    monkeypatch.setattr("src.services.pipeline.SemanticSearch.get_instance",
                        staticmethod(lambda: (_ for _ in ()).throw(RuntimeError("sem Qdrant"))))
    _fala(banco)
    prompts = _llm_falso(monkeypatch)
    assert PipelineService.generate_video_summary(7, "interview", 1) is True
    assert "CLASSIFICAÇÃO DO ARQUIVO" in prompts[0] and "QUADROS" not in prompts[0]


def test_resumo_usa_o_qdrant_para_analises_antigas_sem_keyframes_no_sqlite(banco, monkeypatch):
    from src.services.pipeline import PipelineService

    class BuscaFalsa:
        def get_video_vision_frames(self, project_id, video_id):
            return [{"timestamp": 1.0, "description": "claquete batendo", "tags": []}]

    monkeypatch.setattr("src.services.pipeline.SemanticSearch.get_instance", staticmethod(lambda: BuscaFalsa()))
    _fala(banco)
    prompts = _llm_falso(monkeypatch)
    PipelineService.generate_video_summary(7, "interview", 1)
    assert "claquete batendo" in prompts[0] and "madrugada" in prompts[0]


def test_visao_com_finalizar_false_nao_resume_nem_atribui_temas(banco, monkeypatch, tmp_path):
    from pathlib import Path
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    _detector(monkeypatch, [])
    chamadas = []
    monkeypatch.setattr(P, "generate_video_summary", staticmethod(lambda *a, **k: chamadas.append("resumo")))
    monkeypatch.setattr("src.nlp.theme_engine.assign_media_to_themes", lambda *a, **k: chamadas.append("temas"))
    P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0, finalizar=False)
    assert chamadas == []
    P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0)
    assert chamadas == ["resumo", "temas"]


def test_analyze_video_all_resume_e_atribui_temas_uma_vez_no_fim(monkeypatch):
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

    ordem = []
    monkeypatch.setattr(mod, "get_db", db)
    monkeypatch.setattr(mod, "TASK_MANAGER", TarefasFalsas())
    monkeypatch.setattr(mod, "extract_frame", lambda *a, **k: False)
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: False))
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda vid, fp, finalizar=True: ordem.append(("asr", finalizar))))
    monkeypatch.setattr(P, "analyze_video_vision",
                        staticmethod(lambda vid, fp, d, finalizar=True: ordem.append(("visao", finalizar))))
    monkeypatch.setattr(P, "generate_video_summary", staticmethod(lambda *a, **k: ordem.append("resumo")))
    monkeypatch.setattr("src.nlp.theme_engine.assign_media_to_themes", lambda *a, **k: ordem.append("temas"))
    P.analyze_video_all(9)
    assert ordem == [("asr", False), ("visao", False), "resumo", "temas"]


# ---------------------------------------------------------------------------
# Camada 1 do áudio (docs/PLANO_AUDIO_CATEGORIAS.md): áudio não passa pela visão
# ---------------------------------------------------------------------------

def _visao_proibida(monkeypatch, P, chamadas, tipo_de_som=None):
    """Qualquer passo de imagem anota a chamada: o teste confere que nenhum rodou.
    O classificador de som devolve `tipo_de_som` sem gravar nada (None = sem modelo)."""
    def anota(nome, retorno=None):
        return staticmethod(lambda *a, **k: chamadas.append(nome) or retorno)
    monkeypatch.setattr(P, "classificar_audio",
                        staticmethod(lambda *a, **k: chamadas.append(("tipo_de_som", tipo_de_som)) or tipo_de_som))
    monkeypatch.setattr(P, "triage_system1", anota("laya"))
    monkeypatch.setattr(P, "triage_video", anota("triagem", {}))
    monkeypatch.setattr(P, "_detectar_planos", anota("planos"))
    monkeypatch.setattr(P, "call_openrouter_vision", anota("visao", {"descricao": "x", "tags": []}))


def test_material_de_audio_nao_passa_pela_visao_e_vai_ao_asr(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    banco.execute("UPDATE video SET natureza = 'audio', category = NULL WHERE id = 7")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas)
    monkeypatch.setattr(mod, "detectar_natureza", lambda caminho: chamadas.append("sondagem") or "video")
    monkeypatch.setattr(P, "transcribe_video",
                        staticmethod(lambda vid, fp, finalizar=True: chamadas.append(("asr", finalizar)) or True))
    monkeypatch.setattr(P, "generate_video_summary", staticmethod(lambda *a, **k: chamadas.append("resumo")))

    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.wav"), 20.0) is True
    assert chamadas == [("tipo_de_som", None), ("asr", False), "resumo"], \
        "marca 'audio' gravada não é sondada de novo; sem modelo, o ASR decide pelo VAD"
    row = banco.execute("SELECT status, esforco_analisado, category FROM video WHERE id = 7").fetchone()
    assert row["status"] == "analyzed"
    assert row["esforco_analisado"] is None, "não houve análise de visão"
    assert row["category"] is None, "sem modelo, sem categoria"
    assert banco.execute("SELECT count(*) FROM video_keyframe WHERE video_id = 7").fetchone()[0] == 0


def test_analise_descobre_imagem_parada_e_grava_a_natureza(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.services import pipeline as mod
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas)
    monkeypatch.setattr(mod, "detectar_natureza", lambda caminho: "audio")
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: True))
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: chamadas.append("asr")))

    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0, finalizar=False) is True
    assert chamadas == [("tipo_de_som", None)], "'cena' não vale para áudio; com transcrição gravada, nem ASR"
    assert banco.execute("SELECT natureza FROM video WHERE id = 7").fetchone()[0] == "audio"
    assert any("material de áudio" in m for m in P.logs)


def test_asr_falhando_no_material_de_audio_nao_cai_na_visao(banco, monkeypatch, tmp_path):
    from pathlib import Path
    banco.execute("UPDATE video SET natureza = 'audio' WHERE id = 7")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas)
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: False))
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.wav"), 20.0) is False
    assert chamadas == [("tipo_de_som", None)]


def test_analyze_video_all_nao_procura_rosto_em_material_de_audio(banco, monkeypatch, tmp_path):
    from src.services import pipeline as mod
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    banco.execute("UPDATE video SET natureza = 'audio' WHERE id = 7")
    banco.commit()
    quadros = []
    monkeypatch.setattr(mod, "extract_frame", lambda *a, **k: quadros.append(a) or False)
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: True))
    monkeypatch.setattr(P, "analyze_video_vision", staticmethod(lambda *a, **k: True))
    assert P.analyze_video_all(7)["status"] == "success"
    assert quadros == []


def test_migracao_marca_audio_pela_extensao_e_e_idempotente():
    from src.db.schema import migrar_natureza
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute("ALTER TABLE video DROP COLUMN natureza")  # banco de antes da coluna
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
    for i, nome in enumerate(["ENTREVISTA ARTE.WAV", "trilha.mp3", "take.MTS", "voz.m4a", "parada.mp4"]):
        conn.execute("INSERT INTO video (project_id, filename, filepath, hash) VALUES (1, ?, ?, ?)", (nome, nome, f"h{i}"))
    migrar_natureza(conn)
    migrar_natureza(conn)
    nat = {r["filename"]: r["natureza"] for r in conn.execute("SELECT filename, natureza FROM video")}
    assert nat == {"ENTREVISTA ARTE.WAV": "audio", "trilha.mp3": "audio", "take.MTS": "video",
                   "voz.m4a": "audio", "parada.mp4": "video"}, "imagem parada só a análise descobre"

# ---------------------------------------------------------------------------
# Camada 2 do áudio: tipo de som decide o que vai ao ASR
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("tipo, vai_ao_asr", [
    ("trilha", False), ("efeito", False), ("ambiente", False), ("room_tone", False),
    ("depoimento", True), ("locucao", True), (None, True),
])
def test_tipo_de_som_decide_o_asr(banco, monkeypatch, tmp_path, tipo, vai_ao_asr):
    from pathlib import Path
    banco.execute("UPDATE video SET natureza = 'audio', category = NULL WHERE id = 7")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas, tipo_de_som=tipo)
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: chamadas.append("asr") or True))
    assert P.analyze_video_vision(7, Path("C:/nao/existe/x.wav"), 20.0, finalizar=False) is True
    assert ("asr" in chamadas) is vai_ao_asr
    assert chamadas[0] == ("tipo_de_som", tipo)


def test_categoria_antiga_de_audio_e_normalizada_sem_reclassificar(banco, monkeypatch, tmp_path):
    from pathlib import Path
    banco.execute("UPDATE video SET natureza = 'audio', category = 'Trilha' WHERE id = 7")  # o caso do 555
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas, tipo_de_som="depoimento")
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: chamadas.append("asr") or True))
    P.analyze_video_vision(7, Path("C:/nao/existe/x.mp4"), 20.0, finalizar=False)
    assert chamadas == [], "já tinha categoria de áudio: nem classificador nem Whisper"
    assert banco.execute("SELECT category FROM video WHERE id = 7").fetchone()[0] == "trilha"


def test_correcao_humana_vale_mesmo_com_categoria_de_imagem(banco, monkeypatch, tmp_path):
    from pathlib import Path
    banco.execute("UPDATE video SET natureza = 'audio', category = 'cena', category_confidence = 1.0 WHERE id = 7")
    banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    chamadas = []
    _visao_proibida(monkeypatch, P, chamadas, tipo_de_som="trilha")
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: True))
    P.analyze_video_vision(7, Path("C:/nao/existe/x.mp4"), 20.0, finalizar=False)
    assert chamadas == []
    assert banco.execute("SELECT category FROM video WHERE id = 7").fetchone()[0] == "cena"


def test_classificar_audio_grava_categoria_tipo_e_a_decisao(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.media import audio_classificador as AC
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    banco.execute("UPDATE video SET natureza = 'audio', category = NULL, video_type = 'unknown' WHERE id = 7")
    banco.commit()

    class Motor:
        nome = "motor-falso"

    sinais = {"frac_fala": 0.9, "latencia_ms": 12}
    monkeypatch.setattr(AC, "carregar_motor", lambda: Motor())
    monkeypatch.setattr(AC, "classificar", lambda c, d, m: AC.Resultado("depoimento", 0.9, "fala", dict(sinais)))
    assert P.classificar_audio(7, Path("x.wav"), 1, 20.0) == "depoimento"
    v = banco.execute("SELECT category, category_confidence, video_type FROM video WHERE id = 7").fetchone()
    assert tuple(v) == ("depoimento", 0.9, "interview")
    d = banco.execute("SELECT tarefa, motor, modo, categoria, confianca, latencia_ms, estado_json "
                      "FROM system1_decisao WHERE media_id = 7").fetchone()
    assert tuple(d)[:6] == ("tipo_de_som", "motor-falso", "decide", "depoimento", 0.9, 12)
    assert json.loads(d["estado_json"])["frac_fala"] == 0.9
    assert P._categoria_laya(7) is None, "a decisão do som não se passa pela Laya"


def test_sem_modelo_ou_desligado_o_audio_segue_sem_categoria(banco, monkeypatch, tmp_path):
    from pathlib import Path
    from src.media import audio_classificador as AC
    from src.services.modelos_locais import ModeloNaoBaixado
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])

    def sem_modelo():
        raise ModeloNaoBaixado("PANNs Cnn10 (AudioSet) não está baixado (25 MB)")

    monkeypatch.setattr(AC, "carregar_motor", sem_modelo)
    assert P.classificar_audio(7, Path("x.wav"), 1, 20.0) is None
    assert any("não está baixado" in m for m in P.logs)
    monkeypatch.setattr(SettingsService, "get_settings", _settings(**{"audio.classificar_tipo": False}))
    monkeypatch.setattr(AC, "carregar_motor", lambda: pytest.fail("desligado não carrega o modelo"))
    assert P.classificar_audio(7, Path("x.wav"), 1, 20.0) is None


def test_analyze_video_all_nao_transcreve_audio_antes_do_tipo_de_som(banco, monkeypatch, tmp_path):
    from src.services import pipeline as mod
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    monkeypatch.setattr(mod, "detectar_natureza", lambda caminho: "audio")
    monkeypatch.setattr(P, "_tem_transcricao", staticmethod(lambda vid: False))
    ordem = []
    monkeypatch.setattr(P, "transcribe_video", staticmethod(lambda *a, **k: ordem.append("asr_antes")))
    monkeypatch.setattr(P, "analyze_video_vision", staticmethod(lambda *a, **k: ordem.append("visao")))
    P.analyze_video_all(7)
    assert ordem == ["visao"], "o ASR do áudio roda dentro da visão, depois da classificação"
    assert banco.execute("SELECT natureza FROM video WHERE id = 7").fetchone()[0] == "audio"

def test_correcao_humana_de_audio_usa_a_taxonomia_de_audio(banco, monkeypatch):
    from fastapi import HTTPException
    banco.execute("UPDATE video SET natureza = 'audio', category = 'depoimento', status = 'analyzed' WHERE id = 7")
    banco.commit()
    r = _corrigir(banco, monkeypatch, "Room tone")
    assert (r["category"], r["video_type"], r["analise_desatualizada"]) == ("room_tone", "broll", None)
    assert _corrigir(banco, monkeypatch, "locução")["video_type"] == "interview"
    with pytest.raises(HTTPException) as e:
        _corrigir(banco, monkeypatch, "cena")
    assert "trilha" in e.value.detail, "a mensagem lista as categorias de áudio"
