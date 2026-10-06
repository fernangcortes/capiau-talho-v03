"""Bancada de calibração da visão (scripts/visao_calibrar.py).

Sem rede, sem modelo, sem ffmpeg e sem o banco real: o banco é um arquivo SQLite
temporário com o schema do projeto, e segmentação, extração de quadro e visão são falsas.
"""
import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest

from src.db.schema import SCHEMA_SQL

RAIZ = Path(__file__).resolve().parent.parent


def _carregar_script():
    spec = importlib.util.spec_from_file_location("visao_calibrar", RAIZ / "scripts" / "visao_calibrar.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["visao_calibrar"] = mod
    spec.loader.exec_module(mod)
    return mod


vc = _carregar_script()

SEGMENTOS = [
    {"start": 0.0, "end": 10.0, "kind": "shot", "reason": "", "motion_label": ""},
    {"start": 10.0, "end": 20.0, "kind": "shot", "reason": "", "motion_label": ""},
    {"start": 20.0, "end": 60.0, "kind": "shot", "reason": "", "motion_label": ""},
]


@pytest.fixture
def banco(tmp_path):
    caminho = tmp_path / "capiau_teste.db"
    conn = sqlite3.connect(caminho)
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'teste')")
    conn.execute("""INSERT INTO video (id, project_id, filename, filepath, hash, duration, category)
                    VALUES (7, 1, 'a.mp4', 'C:/nao/existe/a.mp4', 'h7', 60.0, 'cena')""")
    conn.commit()
    conn.close()
    return caminho


@pytest.fixture
def falsos(monkeypatch, tmp_path):
    """Troca segmentação, extração e visão por falsos e registra o que foi chamado."""
    reg = {"segmentacoes": 0, "frames": [], "visoes": [], "categorias": []}

    def segmentar_falso(video_path, duration, **kw):
        reg["segmentacoes"] += 1
        return [dict(s) for s in SEGMENTOS]

    def frame_falso(video, ts, saida, proxy_fallback_path=None):
        saida.parent.mkdir(parents=True, exist_ok=True)
        saida.write_bytes(b"\xff\xd8jpeg")
        reg["frames"].append((ts, saida))
        return True

    def prompt_falso(known_entities=None, detected_people=None, project_id=None, category=None):
        reg["categorias"].append(category)
        return "prompt"

    def visao_falsa(b64, ext="jpeg", prompt=None, project_id=None):
        reg["visoes"].append(prompt)
        n = len(reg["visoes"])
        return {"descricao": f"cena numero{n} com objeto{n} unico{n}", "tags": []}

    monkeypatch.setattr(vc, "segment_video", segmentar_falso)
    monkeypatch.setattr(vc, "extract_frame", frame_falso)
    monkeypatch.setattr(vc, "get_vision_prompt", prompt_falso)
    monkeypatch.setattr(vc.PipelineService, "call_openrouter_vision", staticmethod(visao_falsa))
    monkeypatch.setattr(vc.CONFIG, "PROXIES_DIR", tmp_path / "proxies")
    return reg


def _quadros(res, rotulo, vid="7"):
    return res["videos"][vid]["densidades"][rotulo]["quadros"]


def test_dry_run_nao_chama_visao_nem_extrai_frame_e_conta_quadros(banco, falsos):
    dens = vc.parse_densidades("plano,8,4")
    res = vc.rodar(banco, 1, [7], dens, executar=False)
    assert falsos["frames"] == [] and falsos["visoes"] == []
    assert falsos["segmentacoes"] == 1, "uma segmentação por vídeo, para todas as densidades"
    assert res["executado"] is False
    assert _quadros(res, "plano") == 3
    assert res["videos"]["7"]["chamadas_unicas"] >= _quadros(res, "4s")


def test_plano_e_um_quadro_por_segmento_e_intervalo_menor_gera_mais(banco, falsos):
    res = vc.rodar(banco, 1, [7], vc.parse_densidades("plano,8,4"))
    assert _quadros(res, "plano") == len(SEGMENTOS)
    assert _quadros(res, "plano") < _quadros(res, "8s") < _quadros(res, "4s")


def test_executar_chama_visao_sem_categoria_e_apaga_os_quadros(banco, falsos):
    res = vc.rodar(banco, 1, [7], vc.parse_densidades("plano,8"), executar=True)
    assert falsos["visoes"], "a visão foi chamada"
    assert falsos["categorias"] and all(c is None for c in falsos["categorias"]), "prompt SEM categoria"
    assert falsos["frames"], "extraiu quadros"
    assert not any(saida.exists() for _, saida in falsos["frames"]), "quadros temporários apagados"
    assert len(falsos["visoes"]) == res["videos"]["7"]["chamadas_unicas"]
    info = res["videos"]["7"]
    assert info["densidades"]["8s"]["descricoes"], "descrições guardadas no resultado"
    assert info["mais_densa"] == "8s"
    # leitura às cegas: pares sem rótulo, gabarito separado
    par = res["cego"]["7"][0]
    assert set(par) == {"par", "A", "B", "voto"}
    assert set(res["gabarito_cego"]["7"]["1"].values()) == {"plano", "8s"}


def test_densidade_igual_a_mais_densa_perde_zero():
    densa = [{"timestamp": 1.0, "descricao": "homem de camisa azul ajusta o microfone"},
             {"timestamp": 20.0, "descricao": "mulher caminha no corredor escuro"}]
    r = vc.novidades_perdidas(densa, list(densa))
    assert r["fracao"] == 0.0 and r["perdidas"] == 0 and r["total"] == 2


def test_descricao_nova_sem_par_proximo_conta_como_perdida():
    densa = [{"timestamp": 1.0, "descricao": "homem de camisa azul ajusta o microfone"},
             {"timestamp": 20.0, "descricao": "mulher caminha no corredor escuro"}]
    menor = [{"timestamp": 2.0, "descricao": "homem de camisa azul ajustando o microfone"}]
    r = vc.novidades_perdidas(densa, menor)
    assert r["perdidas"] == 1 and r["fracao"] == 0.5
    assert r["exemplos"][0]["timestamp"] == 20.0


def test_par_perto_mas_com_conteudo_diferente_ou_longe_mas_igual_nao_cobre():
    densa = [{"timestamp": 10.0, "descricao": "cachorro correndo no parque verde"}]
    assert vc.novidades_perdidas(densa, [{"timestamp": 11.0, "descricao": "carro vermelho parado na garagem"}])["perdidas"] == 1
    assert vc.novidades_perdidas(densa, [{"timestamp": 40.0, "descricao": "cachorro correndo no parque verde"}])["perdidas"] == 1


def test_sugestao_e_a_menor_densidade_abaixo_do_limite():
    info = {"densidades": {
        "plano": {"intervalo": None, "quadros": 3, "novidades_perdidas": {"fracao": 0.40}},
        "8s": {"intervalo": 8.0, "quadros": 9, "novidades_perdidas": {"fracao": 0.05}},
        "4s": {"intervalo": 4.0, "quadros": 17, "novidades_perdidas": {"fracao": 0.0}}}}
    assert vc.indice_mais_densa(info) == "4s"
    assert vc.sugerir(info, 0.10) == "8s"
    assert vc.sugerir(info, 0.50) == "plano"


def test_cego_e_reproduzivel_com_a_mesma_semente():
    d = {"plano": [{"timestamp": 1.0, "descricao": "a"}],
         "4s": [{"timestamp": 1.0, "descricao": "a"}, {"timestamp": 5.0, "descricao": "b"}]}
    assert vc.montar_cego(7, d) == vc.montar_cego(7, d)


def test_banco_abre_so_em_modo_leitura(banco, falsos, monkeypatch):
    chamadas = []
    original = sqlite3.connect

    def espiao(*a, **k):
        chamadas.append((a, k))
        return original(*a, **k)

    monkeypatch.setattr(vc.sqlite3, "connect", espiao)
    vc.rodar(banco, 1, [7], vc.parse_densidades("plano"))
    assert chamadas, "abriu o banco"
    for a, k in chamadas:
        assert "mode=ro" in a[0] and k.get("uri") is True

    conn = vc.abrir_banco_leitura(banco)
    with pytest.raises(sqlite3.OperationalError):
        conn.execute("INSERT INTO project (id, name) VALUES (2, 'x')")
    conn.close()
    verifica = original(banco)
    assert verifica.execute("SELECT count(*) FROM project").fetchone()[0] == 1
    verifica.close()


def test_resumo_md_traz_tabela_e_sugestao(banco, falsos):
    res = vc.rodar(banco, 1, [7], vc.parse_densidades("plano,8"), executar=True)
    md = vc.resumo_md(res)
    assert "| Densidade | Quadros | Novidades perdidas |" in md and "Sugestão" in md


def test_densidade_invalida_e_recusada():
    with pytest.raises(ValueError):
        vc.parse_densidades("plano,abc")
    with pytest.raises(ValueError):
        vc.parse_densidades("0")
