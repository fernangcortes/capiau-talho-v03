"""Taxonomia de triagem em dois eixos (docs/planos/REVISAO_CATEGORIAS.md, proposta B).

Banco SQLite em memória; visão, Laya e ffmpeg falsos. Nada toca o banco real nem a rede.
"""
import json
import sqlite3

import pytest

from src.db.schema import SCHEMA_SQL, migrar_taxonomia_categorias
from src.nlp.prompt_registry import CATEGORIAS_ANTIGAS, TRIAGE_CATEGORIES, normalizar_categoria
from src.services.settings_service import SettingsService
from tests.test_ordem_analises import _settings, banco  # noqa: F401 (fixture)


# ---------------------------------------------------------------------------
# Chaves
# ---------------------------------------------------------------------------

def test_taxonomia_nova_tem_as_oito_chaves():
    assert set(TRIAGE_CATEGORIES) == {"cena", "bastidor", "depoimento", "convivio", "evento",
                                      "teste", "documento", "terceiros"}


@pytest.mark.parametrize("entrada,esperado", [
    ("cena", "cena"), ("Convívio", "convivio"), (" BASTIDOR ", "bastidor"),
    ("obra", "cena"), ("processo", "bastidor"), ("cotidiano", "convivio"),
    ("tecnico", "teste"), ("técnico", "teste"), ("arquivo", "terceiros"),
    ("pessoal", None), ("Trilha", None), ("", None), (None, None),
])
def test_normalizar_categoria(entrada, esperado):
    assert normalizar_categoria(entrada) == esperado


def test_nomes_antigos_apontam_para_chaves_que_existem():
    assert set(CATEGORIAS_ANTIGAS.values()) <= set(TRIAGE_CATEGORIES)


# ---------------------------------------------------------------------------
# Migração dos dados
# ---------------------------------------------------------------------------

def test_migracao_traduz_as_chaves_e_pessoal_vira_fora_do_projeto():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
    for vid, cat in [(1, "obra"), (2, "processo"), (3, "pessoal"), (4, "depoimento"), (5, "Trilha")]:
        conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence) "
                     "VALUES (?, 1, 'v', 'v', ?, ?, 0.9)", (vid, f"h{vid}", cat))
    conn.execute("INSERT INTO photo (id, project_id, filename, filepath, hash, category) VALUES (1, 1, 'f', 'f', 'hf', 'cotidiano')")
    conn.execute("INSERT INTO triage_feedback (project_id, media_kind, media_id, wrong_category, right_category) "
                 "VALUES (1, 'video', 1, 'tecnico', 'arquivo')")
    conn.execute("INSERT INTO system1_decisao (project_id, media_kind, media_id, tarefa, motor, modo, estado_json, "
                 "perguntas_json, categoria) VALUES (1, 'video', 1, 'triagem', 'laya-multilingual', 'sombra', '{}', '[]', 'arquivo')")

    for _ in range(2):  # idempotente
        migrar_taxonomia_categorias(conn)

    v = {r["id"]: dict(r) for r in conn.execute("SELECT id, category, category_confidence, fora_do_projeto FROM video")}
    assert [v[i]["category"] for i in (1, 2, 4)] == ["cena", "bastidor", "depoimento"]
    assert v[3]["category"] is None and v[3]["fora_do_projeto"] == 1 and v[3]["category_confidence"] is None
    assert v[5]["category"] == "Trilha", "valor fora das duas taxonomias não é tocado"
    assert conn.execute("SELECT category FROM photo").fetchone()[0] == "convivio"
    assert tuple(conn.execute("SELECT wrong_category, right_category FROM triage_feedback").fetchone()) == ("teste", "terceiros")
    assert conn.execute("SELECT categoria FROM system1_decisao").fetchone()[0] == "terceiros"


# ---------------------------------------------------------------------------
# Esforço: misto e fora do projeto
# ---------------------------------------------------------------------------

def test_misto_recebe_o_perfil_mais_caro():
    from src.services.analysis_policy import get_profile
    assert get_profile("convivio", secundarias=["cena"]).effort == "completo"
    assert get_profile("convivio", secundarias=["documento"]).effort == "reduzido"
    assert get_profile("convivio").effort == "triagem"


def test_fora_do_projeto_firme_recebe_o_minimo_e_incerto_nao():
    from src.services.analysis_policy import get_profile
    assert get_profile("cena", confianca=0.9, limiar=0.55, fora_do_projeto=True).effort == "triagem"
    assert get_profile("cena", confianca=0.3, limiar=0.55, fora_do_projeto=True).effort == "completo"


def test_override_com_nome_antigo_ainda_vale():
    from src.services.analysis_policy import resolve_effort, validate_overrides
    assert resolve_effort("convivio", '{"cotidiano": "completo"}') == "completo"
    assert validate_overrides('{"obra": "triagem"}')[0]
    assert not validate_overrides('{"pessoal": "triagem"}')[0]


# ---------------------------------------------------------------------------
# Triagem por visão: prompt e o que grava
# ---------------------------------------------------------------------------

def _triagem(banco, monkeypatch, tmp_path, resposta, objetivo=None):  # noqa: F811
    from pathlib import Path
    from src.services import pipeline as mod
    if objetivo:
        banco.execute("UPDATE project SET objetivo = ? WHERE id = 1", (objetivo,))
        banco.commit()
    prompts = []

    def frame(video, ts, saida, proxy_fallback_path=None):
        saida.parent.mkdir(parents=True, exist_ok=True)
        saida.write_bytes(b"jpg")
        return True

    monkeypatch.setattr(SettingsService, "get_settings", _settings())
    monkeypatch.setattr(mod.CONFIG, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(mod, "extract_frame", frame)
    monkeypatch.setattr(mod.PipelineService, "call_openrouter_vision_multi",
                        staticmethod(lambda imgs, prompt, project_id=None: (prompts.append(prompt), resposta)[1]))
    r = mod.PipelineService.triage_video(7, Path("C:/v/take.mp4"), 40.0, 1)
    return r, prompts[0]


def test_triagem_grava_misto_fora_do_projeto_e_normaliza(banco, monkeypatch, tmp_path):  # noqa: F811
    r, prompt = _triagem(banco, monkeypatch, tmp_path, {
        "categoria": "Convívio", "categorias_secundarias": ["bastidor", "convivio", "xyz", "processo"],
        "fora_do_projeto": True, "confianca": 0.8, "titulo": "Almoço da equipe"})
    linha = banco.execute("SELECT category, categorias_secundarias, fora_do_projeto, title FROM video WHERE id = 7").fetchone()
    assert linha["category"] == "convivio"
    assert json.loads(linha["categorias_secundarias"]) == ["bastidor"], "sem repetir a principal, sem lixo, sem duplicar"
    assert linha["fora_do_projeto"] == 1 and linha["title"] == "Almoço da equipe"
    assert r["categorias_secundarias"] == ["bastidor"] and r["fora_do_projeto"] is True


def test_prompt_da_triagem_tem_regras_objetivo_e_nao_fala_em_arquivo(banco, monkeypatch, tmp_path):  # noqa: F811
    _, prompt = _triagem(banco, monkeypatch, tmp_path, {"categoria": "cena", "confianca": 0.9},
                         objetivo="making of do longa MONSTRO")
    assert "Objetivo do projeto: making of do longa MONSTRO" in prompt
    assert "REGRAS DE DESEMPATE" in prompt and "'terceiros'" in prompt
    assert "categorias_secundarias" in prompt and "fora_do_projeto" in prompt
    assert "este arquivo" not in prompt.lower() and "do arquivo como um todo" not in prompt.lower()
    for chave in TRIAGE_CATEGORIES:
        assert f'"{chave}"' in prompt


def test_triagem_com_categoria_fora_da_lista_nao_grava(banco, monkeypatch, tmp_path):  # noqa: F811
    r, _ = _triagem(banco, monkeypatch, tmp_path, {"categoria": "pessoal", "confianca": 0.9})
    assert r == {}
    assert banco.execute("SELECT category FROM video WHERE id = 7").fetchone()[0] == "cena", "fica a que tinha"


# ---------------------------------------------------------------------------
# Laya: pergunta sem "arquivo" e objetivo no estado
# ---------------------------------------------------------------------------

def test_laya_recebe_objetivo_e_pergunta_sem_a_palavra_arquivo():
    from src.services.system1_service import estado_triagem, perguntas_triagem
    pergunta = perguntas_triagem()["categoria"]
    assert "arquivo" not in pergunta["instructions"].lower()
    assert set(pergunta["criteria"]) == set(TRIAGE_CATEGORIES)
    estado = estado_triagem({"objetivo": "making of do longa MONSTRO", "filename": "take.mp4"})
    assert "objetivo do projeto: making of do longa MONSTRO" in estado
    assert "arquivo:" not in estado


def test_laya_com_nome_antigo_e_normalizada():
    from tests.laya_falsa import laya_falsa
    dec = laya_falsa(padrao=("obra", 0.95)).evaluate_media_triage({"filename": "take.mp4"})
    assert dec.category == "cena"


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------

def test_correcao_aceita_nome_antigo_vindo_da_biblioteca(banco, monkeypatch):  # noqa: F811
    from tests.test_ordem_analises import _corrigir
    r = _corrigir(banco, monkeypatch, "processo")
    assert r["category"] == "bastidor"
    assert banco.execute("SELECT category FROM video WHERE id = 7").fetchone()[0] == "bastidor"


def test_rota_do_objetivo_do_projeto(banco):  # noqa: F811
    from fastapi import HTTPException
    from src.api.routes.projects import update_objetivo
    from src.api.schemas import ProjectObjetivoUpdate
    assert update_objetivo(1, ProjectObjetivoUpdate(objetivo="  making of do longa MONSTRO "), conn=banco)["objetivo"] \
        == "making of do longa MONSTRO"
    assert banco.execute("SELECT objetivo FROM project WHERE id = 1").fetchone()[0] == "making of do longa MONSTRO"
    with pytest.raises(HTTPException):
        update_objetivo(99, ProjectObjetivoUpdate(objetivo="x"), conn=banco)


def test_fila_de_revisao_inclui_video_misto(banco, monkeypatch):  # noqa: F811
    from src.api.routes.media import triage_review_queue
    monkeypatch.setattr(SettingsService, "get_settings", _settings())
    banco.execute("UPDATE video SET category_confidence = 1.0 WHERE id = 7")
    banco.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence,
                     categorias_secundarias) VALUES (30, 1, 'v', 'v', 'h30', 'convivio', 0.9, '["cena"]')""")
    banco.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence,
                     categorias_secundarias) VALUES (31, 1, 'v', 'v', 'h31', 'convivio', 0.9, '[]')""")
    banco.commit()
    assert [v["id"] for v in triage_review_queue(1, conn=banco)["videos"]] == [30]


# ---------------------------------------------------------------------------
# Triagem com um quadro por plano
# ---------------------------------------------------------------------------

def test_sem_planos_a_triagem_usa_as_posicoes_fixas():
    from src.services.pipeline import PipelineService as P
    assert P._instantes_da_triagem(100.0) == [10.0, 35.0, 60.0, 85.0]
    assert P._instantes_da_triagem(10.0) == [2.0, 7.0]


def test_com_muitos_planos_olha_o_meio_dos_seis_mais_longos_em_ordem():
    from src.services.pipeline import PipelineService as P
    duracoes = [5, 30, 2, 20, 8, 1, 25, 3, 12, 4]  # 10 planos
    shots, t = [], 0.0
    for d in duracoes:
        shots.append({"start": t, "end": t + d})
        t += d
    instantes = P._instantes_da_triagem(t, shots)
    longos = sorted(shots, key=lambda s: s["end"] - s["start"], reverse=True)[:6]
    assert instantes == sorted((s["start"] + s["end"]) / 2 for s in longos)


def test_plano_sequencia_completa_com_posicoes_fixas_sem_repetir_o_meio():
    from src.services.pipeline import PipelineService as P
    instantes = P._instantes_da_triagem(100.0, [{"start": 0.0, "end": 100.0}])
    assert 50.0 in instantes and len(instantes) == 4
    assert all(abs(a - b) >= 2.0 for i, a in enumerate(instantes) for b in instantes[i + 1:])


def test_planos_sao_detectados_uma_vez_e_servem_a_triagem_e_a_segmentacao(banco, monkeypatch, tmp_path):  # noqa: F811
    from pathlib import Path
    from src.services import pipeline as mod
    from tests.test_ordem_analises import _detector, _pipeline_falso
    banco.execute("UPDATE video SET category = NULL WHERE id = 7"); banco.commit()
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    _detector(monkeypatch, [])
    monkeypatch.setattr(SettingsService, "get_settings", _settings(**{
        "vision.use_segments": True, "clip.enabled": False, "vision.frame_interval": 10,
        "object.detector_engine": "none"}))
    planos = [{"start": 0.0, "end": 8.0}, {"start": 8.0, "end": 20.0}]
    chamadas = {"detect": 0, "segment_shots": None, "triagem_shots": None}

    def detect(path, threshold=27.0):
        chamadas["detect"] += 1
        return planos

    def segment(path, duration, shots=None, **kw):
        chamadas["segment_shots"] = shots
        return [{"start": s["start"], "end": s["end"], "kind": "shot", "reason": "", "motion_label": ""} for s in shots]

    def triagem(vid, fp, d, pid, shots=None):
        chamadas["triagem_shots"] = shots
        return {"categoria": "cena", "confianca": 0.9}

    monkeypatch.setattr("src.vision.segmentation.detect_shots", detect)
    monkeypatch.setattr("src.vision.segmentation.segment_video", segment)
    monkeypatch.setattr(P, "triage_system1", staticmethod(lambda *a, **k: None))
    monkeypatch.setattr(P, "triage_video", staticmethod(triagem))
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    assert chamadas["detect"] == 1, "um decode só para achar os planos"
    assert chamadas["triagem_shots"] == planos and chamadas["segment_shots"] == planos


# ---------------------------------------------------------------------------
# Categoria fora do prompt da visão; o resumo com imagem confere
# ---------------------------------------------------------------------------

def test_prompt_da_visao_nao_recebe_mais_a_categoria():
    from src.nlp.prompt_templates import get_vision_prompt
    assert get_vision_prompt([], [], category="cena") == get_vision_prompt([], [])
    assert "CLASSIFICAÇÃO" not in get_vision_prompt([], [], category="cena")


def _resumo(banco, monkeypatch, resposta, com_quadros=True):  # noqa: F811
    from src.services import pipeline as mod
    from src.services.pipeline import PipelineService

    class R:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(resposta)}}]}

    prompts = []
    monkeypatch.setattr(SettingsService, "get_settings", _settings(**{"api.openrouter_key": "sk-teste"}))
    monkeypatch.setattr(mod.requests, "post", lambda url, headers=None, json=None, timeout=None:
                        (prompts.append(json["messages"][0]["content"]), R())[1])
    monkeypatch.setattr("src.services.pipeline.SemanticSearch.get_instance",
                        staticmethod(lambda: (_ for _ in ()).throw(RuntimeError("sem Qdrant"))))
    banco.execute("INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id) VALUES (7, 'oi', 0, 1, 'A')")
    banco.commit()
    quadros = [{"timestamp": 1.0, "description": "atores em cena com claquete", "tags": []}] if com_quadros else []
    assert PipelineService.generate_video_summary(7, None, 1, quadros) is True
    return prompts[0], dict(banco.execute(
        "SELECT category, category_confidence, categorias_secundarias, categoria_resumo, analise_desatualizada "
        "FROM video WHERE id = 7").fetchone())


BASE = {"titulo": "t", "description": "d", "summary": "s", "tags": []}


def test_resumo_concorda_e_junta_secundarias(banco, monkeypatch):  # noqa: F811
    banco.execute("UPDATE video SET category = 'cena', category_confidence = 0.9, categorias_secundarias = '[]', "
                  "esforco_analisado = 'completo' WHERE id = 7")
    prompt, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "cena", "categorias_secundarias": ["bastidor"]})
    assert "CLASSIFIQUE TAMBÉM O VÍDEO" in prompt and "'cena'" in prompt
    assert v["category"] == "cena" and json.loads(v["categorias_secundarias"]) == ["bastidor"]
    assert v["categoria_resumo"] == "cena" and v["analise_desatualizada"] is None


def test_resumo_discorda_marca_desatualizada_quando_pede_mais_esforco(banco, monkeypatch):  # noqa: F811
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 0.9, esforco_analisado = 'triagem' "
                  "WHERE id = 7")
    _, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "cena"})
    assert v["category"] == "convivio", "a triagem não é trocada sozinha"
    assert v["categoria_resumo"] == "cena"
    assert "convivio" in v["analise_desatualizada"] and "completo" in v["analise_desatualizada"]


def test_resumo_discorda_sem_pedir_mais_esforco_so_registra(banco, monkeypatch):  # noqa: F811
    banco.execute("UPDATE video SET category = 'cena', category_confidence = 0.9, esforco_analisado = 'completo' "
                  "WHERE id = 7")
    _, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "convivio"})
    assert v["categoria_resumo"] == "convivio" and v["analise_desatualizada"] is None


def test_correcao_humana_nunca_e_trocada_nem_marcada(banco, monkeypatch):  # noqa: F811
    banco.execute("UPDATE video SET category = 'convivio', category_confidence = 1.0, esforco_analisado = 'triagem' "
                  "WHERE id = 7")
    _, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "cena"})
    assert v["category"] == "convivio" and v["analise_desatualizada"] is None


def test_video_sem_categoria_fica_com_a_do_resumo_como_incerta(banco, monkeypatch):  # noqa: F811
    banco.execute("UPDATE video SET category = NULL, category_confidence = NULL WHERE id = 7")
    _, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "bastidor", "categorias_secundarias": ["cena"]})
    assert v["category"] == "bastidor" and v["category_confidence"] is None
    assert json.loads(v["categorias_secundarias"]) == ["cena"]


def test_resumo_so_de_fala_nao_julga_categoria(banco, monkeypatch):  # noqa: F811
    prompt, v = _resumo(banco, monkeypatch, {**BASE, "categoria": "teste"}, com_quadros=False)
    assert "CLASSIFIQUE" not in prompt
    assert v["categoria_resumo"] is None and v["category"] == "cena"


def test_marca_do_resumo_sobrevive_ao_fim_da_analise(banco, monkeypatch, tmp_path):  # noqa: F811
    from pathlib import Path
    from tests.test_ordem_analises import _detector, _pipeline_falso
    P = _pipeline_falso(banco, monkeypatch, tmp_path, [])
    _detector(monkeypatch, [])

    def resumo_que_marca(video_id, *a, **k):
        banco.execute("UPDATE video SET analise_desatualizada = 'resumo discorda' WHERE id = ?", (video_id,))
        return True

    monkeypatch.setattr(P, "generate_video_summary", staticmethod(resumo_que_marca))
    assert P.analyze_video_vision(7, Path("C:/nao/existe/take.mp4"), 20.0) is True
    row = banco.execute("SELECT esforco_analisado, analise_desatualizada FROM video WHERE id = 7").fetchone()
    assert tuple(row) == ("completo", "resumo discorda")


def test_fila_de_revisao_inclui_divergencia_do_resumo(banco, monkeypatch):  # noqa: F811
    from src.api.routes.media import triage_review_queue
    monkeypatch.setattr(SettingsService, "get_settings", _settings())
    banco.execute("UPDATE video SET category_confidence = 1.0, categoria_resumo = 'convivio' WHERE id = 7")  # humana: fora
    banco.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence,
                     categoria_resumo) VALUES (40, 1, 'v', 'v', 'h40', 'convivio', 0.9, 'cena')""")
    banco.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, category, category_confidence,
                     categoria_resumo) VALUES (41, 1, 'v', 'v', 'h41', 'convivio', 0.9, 'convivio')""")
    banco.commit()
    fila = triage_review_queue(1, conn=banco)["videos"]
    assert [v["id"] for v in fila] == [40] and fila[0]["categoria_resumo"] == "cena"
