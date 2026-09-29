"""Auditoria: cada recurso do editor chega ao arquivo exportado?

O render le o BANCO, nunca a tela. Entao cada teste faz o caminho inteiro:

    clipe como a UI guarda -> TimelineCreate (schema) -> rota save_timeline
    -> banco -> leitura do render -> modelo.normalizar -> grafos de video/audio

O payload enviado aqui e o clipe inteiro, como esta em STATE.activeTimelineCuts
-- o mesmo que src/ui/js/timelinePersistencia.js (corteParaSalvar) manda,
menos os frames derivados. O lado JS dessa ponte tem autoteste proprio
(tests/autoteste_timeline_persistencia.mjs).

Recurso que hoje NAO renderiza fica em xfail(strict=True): a suite segue verde
e o teste passa a falhar no dia em que o recurso for consertado, obrigando a
tirar a marca (e a lista de lacunas nunca fica mentindo).
"""
import sqlite3

import pytest

from src.api.routes import narrative
from src.api.schemas import TimelineCreate
from src.export.video_render import grafo_audio, grafo_video, modelo

FPS = 30.0

PISTAS = [
    {"id": "T1", "name": "Titulos", "kind": "text", "order": 0},
    {"id": "V2", "name": "B-Roll", "kind": "video", "order": 1},
    {"id": "V1", "name": "Falas", "kind": "video", "order": 2},
    {"id": "A1", "name": "Audio", "kind": "audio", "order": 3},
]


# ---------------------------------------------------------------------------
# Caminho completo tela -> banco -> render
# ---------------------------------------------------------------------------

def _payload_ui(clipe: dict) -> dict:
    """O clipe inteiro da tela, com in/out renomeados como a rota espera."""
    corpo = dict(clipe)
    corpo["in_time"] = corpo.pop("in")
    corpo["out_time"] = corpo.pop("out")
    return corpo


def _salvar_e_ler(clipes, pistas=None):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE timeline (id INTEGER PRIMARY KEY, project_id INTEGER, "
                 "name TEXT, description TEXT, sequence_json TEXT, created_at TEXT)")
    corpo = TimelineCreate(name="auditoria", cuts=[_payload_ui(c) for c in clipes],
                           tracks=pistas or PISTAS, fps=FPS)
    tid = narrative.save_timeline(corpo, conn)["timeline_id"]
    dados = narrative._carregar_timeline_render(tid, conn)
    return modelo.normalizar(dados["sequencia"], nome=dados["nome"], timeline_id=tid)


def _render(clipes, pistas=None):
    seq = _salvar_e_ler(clipes, pistas)
    fim = seq.duracao_s()
    escopo = modelo.Escopo()
    return {
        "seq": seq,
        "video": grafo_video.grafo_completo(seq, escopo, 0.0, fim),
        "audio": grafo_audio.grafo_audio_completo(seq, escopo, 0.0, fim),
    }


def _video(cid, inicio, ent, sai, pista="V1", **extra):
    c = {"id": cid, "type": "video", "video_id": 1, "in": ent, "out": sai,
         "track": pista, "timeline_start": inicio, "effects": []}
    c.update(extra)
    return c


def _par_av(cid, inicio, ent, sai, **extra):
    """Clipe de video + parceiro de audio, como o editor cria (link_id comum)."""
    link = f"link_{cid}"
    return [_video(cid, inicio, ent, sai, link_id=link, **extra),
            _video(f"{cid}_a", inicio, ent, sai, pista="A1", link_id=link, **extra)]


def _ids_entradas(grafo):
    return [e.get("clipe_id") for e in grafo["entradas"]]


def _entrada(grafo, cid):
    return next(e for e in grafo["entradas"] if e.get("clipe_id") == cid)


# ---------------------------------------------------------------------------
# O que JA renderiza (regressao)
# ---------------------------------------------------------------------------

def test_corte_simples_com_audio_vinculado():
    r = _render(_par_av("c1", 0.0, 3.0, 8.0))
    assert abs(r["seq"].duracao_s() - 5.0) < 1e-6
    assert _entrada(r["video"], "c1")["ss"] == pytest.approx(3.0)
    assert _entrada(r["audio"], "c1_a")["ss"] == pytest.approx(3.0)


def test_corte_jl_audio_desencontrado_do_video():
    """J/L-cut: o audio comeca antes do video; posicoes absolutas bastam."""
    clipes = [_video("v", 2.0, 10.0, 15.0, link_id=None),
              _video("a", 1.0, 9.0, 15.0, pista="A1", link_id=None)]
    r = _render(clipes)
    assert "adelay=delays=1000" in r["audio"]["filter_complex"]


def test_subclipe_renderiza_a_midia_mestre():
    """Subclipe entra com video_id do MESTRE e in/out absolutos (timelineState:3582)."""
    c = _video("sub", 0.0, 40.0, 44.0, is_subclip=True, subclip_id="subclip_9",
               parent_video_id=1)
    r = _render([c])
    e = _entrada(r["video"], "sub")
    assert e["ss"] == pytest.approx(40.0) and e["t"] == pytest.approx(4.0)


def test_foto_com_ken_burns():
    foto = {"id": "f", "type": "photo", "photo_id": 7, "in": 0.0, "out": 4.0,
            "track": "V1", "timeline_start": 0.0,
            "effects": [{"type": "ken_burns", "start_scale": 1.0, "end_scale": 1.2}]}
    r = _render([foto])
    assert _entrada(r["video"], "f")["loop"] is True


def test_crossfade_de_audio_da_transicao():
    a = _video("a", 0.0, 0.0, 10.0, pista="A1", effects=[
        {"type": "crossfade", "side": "out", "duration_s": 1.0,
         "curve": "equal_power", "transitionId": "tr"}])
    b = _video("b", 10.0, 5.0, 15.0, pista="A1", effects=[
        {"type": "crossfade", "side": "in", "duration_s": 1.0,
         "curve": "equal_power", "transitionId": "tr"}])
    r = _render([a, b])
    assert _entrada(r["audio"], "a")["t"] == pytest.approx(11.0)
    assert _entrada(r["audio"], "b")["ss"] == pytest.approx(4.0)


def test_pista_muda_fica_fora_da_mixagem():
    pistas = [dict(p, muted=True) if p["id"] == "A1" else p for p in PISTAS]
    r = _render(_par_av("c1", 0.0, 0.0, 5.0), pistas)
    assert r["audio"]["silencio"] is True


# ---------------------------------------------------------------------------
# Persistencia: o que o editor guarda no clipe sobrevive ao banco
# ---------------------------------------------------------------------------

def test_campos_do_editor_sobrevivem_ao_salvamento():
    """Antes o schema descartava tudo fora de in/out/track/link/effects."""
    titulo = {"id": "gc", "type": "text", "text": "Fulana", "fontFamily": "Inter",
              "posX": 0.1, "in": 0.0, "out": 3.0, "track": "T1",
              "timeline_start": 0.0, "effects": []}
    clipes = [_video("rapido", 0.0, 0.0, 10.0, speed=2.0, reverse=True,
                     source_duration_frames=300, rotation=90, name="Fala 1"),
              _video("gelo", 5.0, 2.0, 5.0, is_freeze=True, freeze_time=2.0),
              _video("sub", 8.0, 40.0, 44.0, is_subclip=True, parent_video_id=1,
                     hard_boundaries=True, disabled=True),
              titulo]
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE timeline (id INTEGER PRIMARY KEY, project_id INTEGER, "
                 "name TEXT, description TEXT, sequence_json TEXT, created_at TEXT)")
    corpo = TimelineCreate(name="t", cuts=[_payload_ui(c) for c in clipes],
                           tracks=PISTAS, fps=FPS)
    tid = narrative.save_timeline(corpo, conn)["timeline_id"]
    salvos = {c["id"]: c for c in
              narrative._carregar_timeline_render(tid, conn)["sequencia"]["clips"]}

    assert salvos["rapido"]["speed"] == 2.0 and salvos["rapido"]["reverse"] is True
    assert salvos["rapido"]["rotation"] == 90 and salvos["rapido"]["name"] == "Fala 1"
    assert salvos["gelo"]["is_freeze"] is True and salvos["gelo"]["freeze_time"] == 2.0
    assert salvos["sub"]["disabled"] is True and salvos["sub"]["hard_boundaries"] is True
    assert salvos["gc"]["text"] == "Fulana" and salvos["gc"]["posX"] == 0.1
    # in/out vem dos campos oficiais (in_time/out_time), nunca de um extra
    assert salvos["rapido"]["in"] == 0.0 and salvos["rapido"]["out"] == 10.0


# ---------------------------------------------------------------------------
# O que NAO renderiza hoje (lacunas conhecidas)
# ---------------------------------------------------------------------------

def test_clipe_desativado_nao_entra_no_render():
    clipes = _par_av("liga", 0.0, 0.0, 5.0) + _par_av("desliga", 5.0, 0.0, 5.0, disabled=True)
    r = _render(clipes)
    assert "desliga" not in _ids_entradas(r["video"])
    assert "desliga_a" not in _ids_entradas(r["audio"])


@pytest.mark.xfail(strict=True, reason=(
    "Velocidade (Task 13/14): `speed` ja chega ao banco, mas o motor nao faz "
    "retime (modelo.Clipe.duracao_s = out - in). Um clipe a 200% sai em 100% "
    "com o DOBRO da duracao, empurrando tudo que vem depois."))
def test_velocidade_2x_ocupa_metade_do_tempo():
    # Tela: 10 s de fonte a 200% ocupam 5 s na timeline (timelineState:5681-5688)
    c = _video("rapido", 0.0, 0.0, 10.0, speed=2.0, source_duration_frames=300,
               reverse=False)
    r = _render([c])
    assert r["seq"].duracao_s() == pytest.approx(5.0)
    assert "setpts=0.5*" in r["video"]["filter_complex"]


@pytest.mark.xfail(strict=True, reason=(
    "Reverso (Task 13): `reverse` ja chega ao banco, mas o motor nao tem "
    "reverse/areverse."))
def test_reverso_inverte_video_e_audio():
    r = _render(_par_av("rev", 0.0, 0.0, 4.0, speed=1.0, reverse=True))
    assert "reverse" in r["video"]["filter_complex"]
    assert "areverse" in r["audio"]["filter_complex"]


@pytest.mark.xfail(strict=True, reason=(
    "Freeze frame (Task 12): `is_freeze`/`freeze_time` ja chegam ao banco, mas "
    "o motor le o trecho normal [freeze_time, freeze_time + dur] e o video "
    "ANDA em vez de congelar."))
def test_freeze_frame_segura_um_quadro():
    c = _video("gelo", 0.0, 2.0, 5.0, is_freeze=True, freeze_time=2.0, freeze_frame=60)
    r = _render([c])
    e = _entrada(r["video"], "gelo")
    assert e["ss"] == pytest.approx(2.0)
    assert e["t"] <= 2.0 / FPS  # le um quadro so; o resto e o quadro repetido
    assert r["seq"].duracao_s() == pytest.approx(3.0)


@pytest.mark.xfail(strict=True, reason=(
    "Titulos/GCs (pista T1): texto, fonte e posicao ja chegam ao banco, mas o "
    "motor nao desenha texto (sem drawtext/overlay)."))
def test_titulo_aparece_no_video():
    titulo = {"id": "gc", "type": "text", "textCategory": "lower_third",
              "text": "Fulana de Tal", "subtext": "Diretora", "fontFamily": "Inter",
              "fontSize": 48, "color": "#ffffff", "in": 0.0, "out": 3.0,
              "track": "T1", "timeline_start": 0.0, "effects": []}
    r = _render(_par_av("fala", 0.0, 0.0, 5.0) + [titulo])
    assert "drawtext" in r["video"]["filter_complex"] or "gc" in _ids_entradas(r["video"])


def test_rotacao_do_clipe_chega_ao_render():
    r = _render([_video("giro", 0.0, 0.0, 4.0, rotation=90)])
    assert "rotate" in r["video"]["filter_complex"]


def test_pista_oculta_persiste():
    pistas = [dict(p, hidden=True) if p["id"] == "V2" else p for p in PISTAS]
    seq = _salvar_e_ler(_par_av("c1", 0.0, 0.0, 5.0), pistas)
    assert seq.pista("V2").hidden is True
