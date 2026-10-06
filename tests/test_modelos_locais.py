"""Catálogo de modelos locais: nada baixa sozinho, o motor avisa o que falta.

Usa um cache falso do Hugging Face numa pasta temporária; nenhum download real.
"""
import pytest

from src.services import modelos_locais as ML


@pytest.fixture
def cache_vazio(monkeypatch, tmp_path):
    monkeypatch.setattr(ML, "_cache_hf", lambda: tmp_path / "hub")
    monkeypatch.setenv("CAPIAU_ULTRALYTICS_DIR", str(tmp_path / "ultra"))
    return tmp_path / "hub"


def _por_no_cache(hub, repo, arquivo, revisao="abc123"):
    p = hub / ("models--" + repo.replace("/", "--")) / "snapshots" / revisao / arquivo
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"x")


def test_todo_modelo_tem_tamanho_uso_e_configuracao():
    for m in ML.CATALOGO.values():
        assert m.tamanho_mb > 0 and m.uso and m.configuracao, m.id
        assert m.ambiente in ("principal", "nemo")
        assert m.id == "yolo_world" or (m.repo and m.marcadores), m.id


def test_baixado_procura_em_qualquer_revisao(cache_vazio):
    laya = ML.CATALOGO["laya_multilingual"]
    assert ML.baixado(laya) is False
    _por_no_cache(cache_vazio, laya.repo, "multilingual/model.safetensors", revisao="revisao_fixada_da_laya")
    assert ML.baixado(laya) is True


def test_exigir_diz_tamanho_e_onde_baixar(cache_vazio):
    with pytest.raises(ML.ModeloNaoBaixado) as e:
        ML.exigir("whisper_turbo")
    assert "1,6 GB" in str(e.value) and "Modelos locais" in str(e.value)


def test_pacote_ausente_vem_antes_do_download(monkeypatch, cache_vazio):
    monkeypatch.setattr(ML.importlib.util, "find_spec", lambda nome: None)
    with pytest.raises(ML.ModeloNaoBaixado, match="falta instalar faster_whisper"):
        ML.exigir("whisper_turbo")
    with pytest.raises(ML.ModeloNaoBaixado, match="instale antes"):
        ML.baixar("whisper_turbo")


def test_motores_recusam_modelo_nao_baixado_sem_baixar(monkeypatch, cache_vazio, tmp_path):
    from src.transcription import motores
    from src.vision import detectores as D
    monkeypatch.setattr(motores, "_whisper_modelo", None)
    with pytest.raises(motores.ErroASR, match="não está baixado"):
        motores._carregar_whisper()
    monkeypatch.setattr(D, "_modelos", {})
    img = tmp_path / "q.jpg"
    img.write_bytes(b"x")
    with pytest.raises(D.DetectorIndisponivel, match="não está baixado"):
        D.detectar("owlv2", img, ["câmera"])
    with pytest.raises(D.DetectorIndisponivel, match="não está baixado"):
        D.detectar("yolo_world", img, ["câmera"])


def test_laya_nao_baixada_vira_indisponivel(monkeypatch, cache_vazio):
    from src.services.system1_service import System1Indisponivel, System1LayaEngine
    monkeypatch.setattr(System1LayaEngine, "_router_compartilhado", None)
    with pytest.raises(System1Indisponivel, match="não está baixado"):
        System1LayaEngine().evaluate_media_triage({"filename": "a.mp4"})


def test_rota_lista_e_recusa_modelo_desconhecido(cache_vazio):
    from fastapi.testclient import TestClient
    from src.api.server import app
    c = TestClient(app)
    r = c.get("/api/modelos")
    assert r.status_code == 200
    ids = {m["id"] for m in r.json()["modelos"]}
    assert {"whisper_turbo", "laya_multilingual", "yolo_world"} <= ids
    assert c.post("/api/modelos/nao_existe/baixar").status_code == 404


def test_download_roda_em_segundo_plano_e_registra_falha(monkeypatch, cache_vazio):
    import threading
    terminou = threading.Event()

    def falha(m):
        raise RuntimeError("403 Client Error: gated repo")
    monkeypatch.setattr(ML, "_baixar_hf", falha)
    estados = []
    t = ML.baixar("pyannote_community1", ao_mudar=lambda e: (estados.append(e), terminou.set()))
    assert t["status"] == "baixando"
    assert terminou.wait(5)
    assert estados[-1]["status"] == "falhou" and "aceite os termos" in estados[-1]["erro"]
