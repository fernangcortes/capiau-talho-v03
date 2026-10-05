"""Detectores de objetos (src/vision/detectores.py) sem carregar modelos nem usar rede."""
import json

import pytest

from src.services.settings_service import ResolvedSettings, SettingsService
from src.vision import detectores as D


def test_traducao_volta_para_o_nome_em_portugues():
    en, volta, avisos = D.traduzir_classes(["Tripé", "claquete", "câmera", "camera", "zabumba"])
    assert en == ["tripod", "clapperboard", "camera", "zabumba"]
    assert volta["tripod"] == "Tripé" and volta["camera"] == "câmera"
    assert len(avisos) == 1 and "zabumba" in avisos[0]


def test_classes_da_configuracao():
    assert D.classes_da_configuracao(" câmera, tripé ,,claquete ") == ["câmera", "tripé", "claquete"]


def test_caixa_em_pixels_vira_canonico_0_1000():
    # x1, y1, x2, y2 numa imagem 2000 x 1000
    assert D._caixa(500, 100, 1500, 900, 2000, 1000) == [100, 250, 900, 750]


def test_rotulo_do_grounding_dino_volta_para_a_classe():
    assert D._mais_proxima("boom", ["boom microphone", "tripod"]) == "boom microphone"
    assert D._mais_proxima("tripod", ["boom microphone", "tripod"]) == "tripod"


def test_dino_x_e_lista_vazia_ficam_indisponiveis(tmp_path):
    with pytest.raises(D.DetectorIndisponivel, match="DINO-X"):
        D.detectar("dino_x", tmp_path / "x.jpg", ["câmera"])
    with pytest.raises(D.DetectorIndisponivel, match="classes vazia"):
        D.detectar("owlv2", tmp_path / "x.jpg", [])


class _Resp:
    def __init__(self, status, conteudo):
        self.status_code = status
        self.text = conteudo if status != 200 else ""
        self._c = conteudo

    def json(self):
        return {"choices": [{"message": {"content": self._c}}]}


class _Http:
    def __init__(self, resp):
        self.resp, self.pedidos = resp, []

    def post(self, url, **kw):
        self.pedidos.append((url, kw))
        return self.resp


@pytest.fixture
def imagem(tmp_path):
    p = tmp_path / "q.jpg"
    p.write_bytes(b"\xff\xd8fakejpeg")
    return p


@pytest.fixture
def config(monkeypatch):
    def com(modelo="google/gemini-2.5-flash"):
        monkeypatch.setattr(SettingsService, "get_settings", lambda project_id=None: ResolvedSettings(
            {"api.openrouter_key": "or_chave_teste", "llm.vision_model": modelo}))
    return com


def test_gemini_filtra_caixa_invalida_classe_fora_e_confianca_baixa(config, imagem):
    config()
    resposta = json.dumps({"objetos": [
        {"label": "Tripé", "box_2d": [100, 200, 800, 400], "confidence": 0.9},
        {"label": "figurino", "box_2d": [309, 385, 999, 78, 999, 999], "confidence": 0.9},  # 6 números
        {"label": "baleia", "box_2d": [0, 0, 10, 10], "confidence": 0.9},                 # fora da lista
        {"label": "câmera", "box_2d": [0, 0, 10, 10], "confidence": 0.1},                 # abaixo do mínimo
    ]})
    http = _Http(_Resp(200, resposta))
    dets, modelo, avisos = D._gemini(imagem, ["tripé", "figurino", "câmera"], 0.3, None, http=http)
    assert [(d.label, d.box, d.confidence) for d in dets] == [("tripé", [100, 200, 800, 400], 0.9)]
    corpo = http.pedidos[0][1]["json"]
    assert corpo["model"] == "google/gemini-2.5-flash"
    assert corpo["response_format"] == {"type": "json_object"}
    assert any("declarada pelo próprio modelo" in a for a in avisos)


def test_gemini_com_modelo_de_visao_nao_gemini_avisa_e_usa_o_padrao(config, imagem):
    config("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
    http = _Http(_Resp(200, '{"objetos": []}'))
    dets, modelo, avisos = D._gemini(imagem, ["câmera"], 0.3, None, http=http)
    assert dets == [] and modelo == D.MODELO_GEMINI_PADRAO
    assert any("não é Gemini" in a for a in avisos)


def test_gemini_json_quebrado_vira_indisponivel_sem_vazar_chave(config, imagem):
    config()
    with pytest.raises(D.DetectorIndisponivel, match="JSON inválido"):
        D._gemini(imagem, ["câmera"], 0.3, None, http=_Http(_Resp(200, '```json\n[{"label": "câm')))
    with pytest.raises(D.DetectorIndisponivel) as e:
        D._gemini(imagem, ["câmera"], 0.3, None, http=_Http(_Resp(401, "chave or_chave_teste recusada")))
    assert "HTTP 401" in str(e.value) and "or_chave_teste" not in str(e.value)


def test_pipeline_grava_caixas_e_avisa_indisponivel_uma_vez(monkeypatch, tmp_path):
    import contextlib
    import sqlite3
    from src.db.schema import SCHEMA_SQL
    from src.services import pipeline
    from src.services.pipeline import PipelineService

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
    conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (5, 1, 'a.mp4', '/a.mp4', 'h')")

    @contextlib.contextmanager
    def get_db_falso():
        yield conn
    monkeypatch.setattr(pipeline, "get_db", get_db_falso)
    S = ResolvedSettings({"object.classes_filter": "tripé,figurino", "object.min_confidence": 0.5})

    monkeypatch.setattr(D, "detectar", lambda motor, img, classes, conf, pid: D.ResultadoDeteccao(
        motor=motor, modelo="m", latencia_ms=12.0, avisos=[], deteccoes=[
            D.Deteccao("tripé", [1, 2, 3, 4], 0.8), D.Deteccao("figurino", [5, 6, 7, 8], None)]))
    n = PipelineService._detectar_objetos_frame(1, 5, 2.5, tmp_path / "f.jpg", S, "florence_2", set())
    assert n == 2
    linhas = [dict(r) for r in conn.execute("SELECT * FROM detected_object ORDER BY id")]
    assert [(l["label"], l["category"], l["confidence"]) for l in linhas] == [
        ("tripé", "equipamento", 0.8), ("figurino", "figurino", D.CONFIANCA_NAO_INFORMADA)]
    assert json.loads(linhas[1]["raw_payload"]) == {"confianca_informada": False}
    assert linhas[0]["execution_mode"] == "local_cpu" and linhas[0]["bounding_box"] == "[1, 2, 3, 4]"

    def sem_chave(*a):
        raise D.DetectorIndisponivel("sem chave")
    monkeypatch.setattr(D, "detectar", sem_chave)
    avisos = set()
    assert PipelineService._detectar_objetos_frame(1, 5, 3.0, tmp_path / "f.jpg", S, "gemini_spatial", avisos) == 0
    PipelineService._detectar_objetos_frame(1, 5, 4.0, tmp_path / "f.jpg", S, "gemini_spatial", avisos)
    assert avisos == {"sem chave"}
