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
from pathlib import Path
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


def test_velocidade_2x_ocupa_metade_do_tempo():
    # Tela: 10 s de fonte a 200% ocupam 5 s na timeline (timelineState:5681-5688)
    c = _video("rapido", 0.0, 0.0, 10.0, speed=2.0, source_duration_frames=300,
               reverse=False)
    r = _render([c])
    assert r["seq"].duracao_s() == pytest.approx(5.0)
    assert "setpts=0.5*" in r["video"]["filter_complex"]


def test_reverso_inverte_video_e_audio():
    r = _render(_par_av("rev", 0.0, 0.0, 4.0, speed=1.0, reverse=True))
    assert "reverse" in r["video"]["filter_complex"]
    assert "areverse" in r["audio"]["filter_complex"]


def test_freeze_frame_segura_um_quadro():
    c = _video("gelo", 0.0, 2.0, 5.0, is_freeze=True, freeze_time=2.0, freeze_frame=60)
    r = _render([c])
    e = _entrada(r["video"], "gelo")
    assert e["ss"] == pytest.approx(2.0)
    assert e["t"] <= 2.0 / FPS  # le um quadro so; o resto e o quadro repetido
    assert r["seq"].duracao_s() == pytest.approx(3.0)


def test_titulo_aparece_no_video(tmp_path):
    """Titulo sai do banco com texto/estilo e vira camada sobreposta no comando.

    O navegador e trocado por um gerador falso (a foto real e coberta em
    test_render_titulos.py); aqui importa o caminho banco -> comando.
    """
    import types
    from src.export.video_render import comando, titulos

    titulo = {"id": "gc", "type": "text", "textCategory": "lower_third",
              "text": "Fulana de Tal", "subtext": "Diretora", "fontFamily": "Inter",
              "fontSize": 48, "color": "#ffffff", "in": 0.0, "out": 3.0,
              "track": "T1", "timeline_start": 1.0, "effects": []}
    seq = _salvar_e_ler(_par_av("fala", 0.0, 0.0, 5.0) + [titulo])

    vistos = []

    class GeradorFalso:
        avisos = []

        def grupos(self, clipe, largura, altura, fps, inicio, fim):
            vistos.append(clipe)
            png = tmp_path / "t.png"
            png.write_bytes(b"")
            return [{"png": png, "n": fim - inicio, "mascara": None, "sigma": None}]

    fn = lambda s, e, a, b: titulos.preparar_titulos(s, e, a, b, GeradorFalso(), tmp_path)
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload
    ped = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))
    rel = types.SimpleNamespace(fontes={cid: types.SimpleNamespace(caminho=str(tmp_path / "m.mp4"),
                                                                    wav_tratado=None)
                                        for cid in ("fala", "fala_a")})
    r = comando.montar_comando(seq, ped, str(tmp_path / "o.mp4"), rel_midia=rel,
                               destino_validado=True, titulos=fn)

    assert vistos and vistos[0]["text"] == "Fulana de Tal" and vistos[0]["subtext"] == "Diretora"
    cmd = r["cmd"]
    i = cmd.index("concat")
    assert cmd[i - 1] == "-f" and cmd[i + 4].endswith(".ffconcat")
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "overlay=x=0:y=0:eof_action=pass:enable='between(t,1,4)'" in fc
    assert not any("titulo" in a.lower() and "nao" in a.lower() for a in r["avisos"])


def test_titulo_sem_gerador_avisa_em_vez_de_sumir(tmp_path):
    import types
    from src.export.video_render import comando
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload
    titulo = {"id": "gc", "type": "text", "text": "Oi", "in": 0.0, "out": 2.0,
              "track": "T1", "timeline_start": 0.0, "effects": []}
    seq = _salvar_e_ler(_par_av("fala", 0.0, 0.0, 3.0) + [titulo])
    rel = types.SimpleNamespace(fontes={cid: types.SimpleNamespace(caminho=str(tmp_path / "m.mp4"),
                                                                    wav_tratado=None)
                                        for cid in ("fala", "fala_a")})
    r = comando.montar_comando(seq, pedido_render_do_payload(1, RenderPedidoPayload(kind="master")),
                               str(tmp_path / "o.mp4"), rel_midia=rel, destino_validado=True)
    assert any("NAO aparecem" in a for a in r["avisos"])


def test_rotacao_do_clipe_chega_ao_render():
    r = _render([_video("giro", 0.0, 0.0, 4.0, rotation=90)])
    assert "rotate" in r["video"]["filter_complex"]


def test_pista_oculta_persiste():
    pistas = [dict(p, hidden=True) if p["id"] == "V2" else p for p in PISTAS]
    seq = _salvar_e_ler(_par_av("c1", 0.0, 0.0, 5.0), pistas)
    assert seq.pista("V2").hidden is True


def test_color_matte_chega_ao_render():
    matte = {
        "id": "matte_1", "type": "color_matte", "kind": "color_matte",
        "color": "#00FF00", "color_name": "Verde",
        "in": 0.0, "out": 4.0, "track": "V1", "timeline_start": 0.0,
        "effects": []
    }
    r = _render([matte])
    fc = r["video"]["filter_complex"]
    assert "color=c=0x00FF00" in fc or "color=" in fc


def test_color_matte_fade_in_fade_out_no_render():
    matte = {
        "id": "matte_fade", "type": "color_matte", "kind": "color_matte",
        "color": "#FF0000", "color_name": "Vermelho",
        "in": 0.0, "out": 4.0, "track": "V1", "timeline_start": 0.0,
        "fade_in": 1.0, "fade_out": 1.0,
        "effects": []
    }
    r = _render([matte])
    fc = r["video"]["filter_complex"]
    assert "color=c=0xFF0000" in fc or "color=" in fc
    assert "fade=t=in" in fc or "geq=" in fc
    assert "fade=t=out" in fc or "geq=" in fc


def test_camada_de_ajuste_propaga_efeitos_no_render():
    base = _video("v1", 0.0, 0.0, 5.0, pista="V1")
    adj = {
        "id": "adj_1", "type": "adjustment", "kind": "adjustment",
        "in": 0.0, "out": 5.0, "track": "V2", "timeline_start": 0.0,
        "effects": [{"type": "color", "saturation": 0.0, "disabled": False}]
    }
    r = _render([base, adj])
    fc = r["video"]["filter_complex"]
    assert "split" in fc
    assert "colorchannelmixer" in fc or "eq=" in fc


def test_blend_modes_color_matte_e_clipes():
    """Valida mapeamento de blend modes para blend=all_mode=... no render FFmpeg."""
    base = _video("v1", 0.0, 0.0, 5.0, pista="V1")
    matte_mult = {
        "id": "matte_mult", "type": "color_matte", "kind": "color_matte",
        "color": "#FF0000", "color_name": "Vermelho",
        "in": 0.0, "out": 5.0, "track": "V2", "timeline_start": 0.0,
        "blend_mode": "multiply",
        "effects": []
    }
    r = _render([base, matte_mult])
    fc = r["video"]["filter_complex"]
    assert "blend=all_mode=multiply" in fc

    # Teste de modo soft-light mapeado para softlight
    matte_soft = {
        "id": "matte_soft", "type": "color_matte", "kind": "color_matte",
        "color": "#0000FF", "color_name": "Azul",
        "in": 0.0, "out": 5.0, "track": "V2", "timeline_start": 0.0,
        "blend_mode": "soft-light",
        "effects": []
    }
    r2 = _render([base, matte_soft])
    fc2 = r2["video"]["filter_complex"]
    assert "blend=all_mode=softlight" in fc2


def test_color_matte_nao_gera_aviso_sem_referencia_de_midia():
    """Clipes de cor sólida (color_matte) são sintéticos e não devem ser apontados como sem mídia."""
    from src.export.video_render import midia, fidelidade
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    matte = {
        "id": "cut_matte_1791504784785_273", "type": "color_matte", "kind": "color_matte",
        "color": "#00FF00", "color_name": "Verde Chroma",
        "in": 0.0, "out": 5.0, "track": "V1", "timeline_start": 0.0,
        "effects": [
            {"type": "crossfade", "side": "in", "duration_s": 1.0, "curve": "linear", "tension": 0.0, "disabled": False},
            {"type": "crossfade", "side": "out", "duration_s": 1.0, "curve": "linear", "tension": 0.0, "disabled": False}
        ]
    }
    seq = _salvar_e_ler([matte])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))

    rel_midia = midia.resolver_fontes(seq, pedido)
    assert "cut_matte_1791504784785_273" not in rel_midia.sem_referencia
    fonte = rel_midia.fontes.get("cut_matte_1791504784785_273")
    assert fonte is not None
    assert fonte.status == "ok"
    assert fonte.classe == "gerador"

    rel_fid = fidelidade.relatorio(seq, pedido, rel_midia)
    codigos_avisos = [a["codigo"] for a in rel_fid.get("avisos", [])]
    assert "CLIPE_SEM_REFERENCIA_DE_MIDIA" not in codigos_avisos


def test_camada_ajuste_e_titulo_nao_geram_aviso_sem_referencia():
    """Camadas de ajuste e títulos também são geradores sintéticos sem video_id/photo_id."""
    from src.export.video_render import midia, fidelidade
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    adj = {
        "id": "cut_adj_999", "type": "adjustment", "kind": "adjustment",
        "in": 0.0, "out": 4.0, "track": "V2", "timeline_start": 0.0,
        "effects": [{"type": "color", "saturation": 0.5, "disabled": False}]
    }
    titulo = {
        "id": "title_1", "type": "text", "text": "Título de Teste",
        "in": 0.0, "out": 3.0, "track": "T1", "timeline_start": 0.0,
        "effects": []
    }
    seq = _salvar_e_ler([adj, titulo])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))

    rel_midia = midia.resolver_fontes(seq, pedido)
    assert "cut_adj_999" not in rel_midia.sem_referencia
    assert "title_1" not in rel_midia.sem_referencia

    rel_fid = fidelidade.relatorio(seq, pedido, rel_midia)
    codigos_avisos = [a["codigo"] for a in rel_fid.get("avisos", [])]
    assert "CLIPE_SEM_REFERENCIA_DE_MIDIA" not in codigos_avisos


def test_clipe_sem_midia_legitimo_continua_gerando_aviso():
    """Garante que clipes de vídeo reais que de fato perderam referência continuem alertando."""
    from src.export.video_render import midia, fidelidade
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    quebrado = {
        "id": "cut_orfa_123", "type": "video", "kind": "media",
        "video_id": None, "photo_id": None,
        "in": 0.0, "out": 4.0, "track": "V1", "timeline_start": 0.0,
        "effects": []
    }
    seq = _salvar_e_ler([quebrado])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))

    rel_midia = midia.resolver_fontes(seq, pedido)
    assert "cut_orfa_123" in rel_midia.sem_referencia

    rel_fid = fidelidade.relatorio(seq, pedido, rel_midia)
    codigos_avisos = [a["codigo"] for a in rel_fid.get("avisos", [])]
    assert "CLIPE_SEM_REFERENCIA_DE_MIDIA" in codigos_avisos


def test_color_matte_montar_comando_completo(tmp_path):
    """Garante que comando.montar_comando processa color_matte sem exceção de mídia não resolvida."""
    from src.export.video_render import comando, midia
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    matte = {
        "id": "cut_matte_1791504784785_273", "type": "color_matte", "kind": "color_matte",
        "color": "#00FF00", "color_name": "Verde Chroma",
        "in": 0.0, "out": 5.0, "track": "V1", "timeline_start": 0.0,
        "effects": [
            {"type": "crossfade", "side": "in", "duration_s": 1.0, "curve": "linear", "tension": 0.0, "disabled": False},
            {"type": "crossfade", "side": "out", "duration_s": 1.0, "curve": "linear", "tension": 0.0, "disabled": False}
        ]
    }
    seq = _salvar_e_ler([matte])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))
    rel_midia = midia.resolver_fontes(seq, pedido)

    res = comando.montar_comando(
        seq, pedido, str(tmp_path / "saida.mp4"),
        rel_midia=rel_midia, destino_validado=True
    )
    assert res is not None
    assert "cmd" in res
    cmd_str = " ".join(res["cmd"])
    assert "color=c=0x00FF00" in cmd_str


def test_color_matte_formato_ui_nao_gera_aviso_sem_referencia():
    """Formato real da UI (type='video', kind='color_matte', video_id=None) não gera aviso sem_referência."""
    from src.export.video_render import midia, fidelidade
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    matte_ui = {
        "id": "cut_matte_1791504784785_273",
        "type": "video",
        "kind": "color_matte",
        "color": "#10B981",
        "color_name": "Esmeralda",
        "video_id": None,
        "photo_id": None,
        "in": 0.0,
        "out": 3.0,
        "track": "V1",
        "timeline_start": 0.0,
        "effects": []
    }
    matte_sem_kind = {
        "id": "cut_matte_9999999999999_111",
        "type": "video",
        "color": "#3B82F6",
        "video_id": None,
        "in": 3.0,
        "out": 6.0,
        "track": "V1",
        "timeline_start": 3.0,
        "effects": []
    }
    seq = _salvar_e_ler([matte_ui, matte_sem_kind])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(kind="master"))

    rel_midia = midia.resolver_fontes(seq, pedido)
    assert "cut_matte_1791504784785_273" not in rel_midia.sem_referencia
    assert "cut_matte_9999999999999_111" not in rel_midia.sem_referencia

    rel_fid = fidelidade.relatorio(seq, pedido, rel_midia)
    codigos_avisos = [a["codigo"] for a in rel_fid.get("avisos", [])]
    assert "CLIPE_SEM_REFERENCIA_DE_MIDIA" not in codigos_avisos


def test_color_matte_execucao_render_termina_com_sucesso(tmp_path):
    """Execução real do ffmpeg termina com sucesso e gera arquivo utilizável."""
    from src.export.video_render import execucao, modelo
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    matte = {
        "id": "cut_matte_1791504784785_273",
        "type": "video",
        "kind": "color_matte",
        "color": "#00FF00",
        "color_name": "Verde",
        "in": 0.0,
        "out": 1.0,
        "track": "V1",
        "timeline_start": 0.0,
        "effects": []
    }
    seq = _salvar_e_ler([matte])
    saida = tmp_path / "saida_matte.mp4"
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(
        kind="draft",
        output={"dir": str(tmp_path), "filename": "saida_matte.mp4"}
    ))
    res = execucao.executar_agora(seq, pedido)
    assert res.get("ok") is True
    assert res.get("cancelado") is False
    caminho = res.get("caminho")
    assert caminho is not None
    p = Path(caminho)
    assert p.exists()
    assert p.stat().st_size > 0


def test_color_matte_hex_curto_e_nomes_execucao_ffmpeg(tmp_path):
    """Cores hex curtas (#fff, #000) e formatos de cor web não devem quebrar o ffmpeg."""
    from src.export.video_render import execucao, modelo
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    matte_fff = {
        "id": "cut_matte_fff",
        "type": "video",
        "kind": "color_matte",
        "color": "#fff",
        "color_name": "Branco",
        "in": 0.0,
        "out": 0.5,
        "track": "V1",
        "timeline_start": 0.0,
        "effects": []
    }
    seq = _salvar_e_ler([matte_fff])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(
        kind="draft",
        output={"dir": str(tmp_path), "filename": "saida_fff.mp4"}
    ))
    res = execucao.executar_agora(seq, pedido)
    assert res.get("ok") is True
    p = Path(res.get("caminho"))
    assert p.exists()
    assert p.stat().st_size > 0


def test_color_matte_transicao_cross_dissolve_ffmpeg(tmp_path):
    """Dois color mattes adjacentes com cross dissolve executam perfeitamente no FFmpeg."""
    from src.export.video_render import execucao, modelo
    from src.api.schemas import RenderPedidoPayload, pedido_render_do_payload

    m1 = {
        "id": "matte_red", "type": "color_matte", "kind": "color_matte", "color": "#FF0000",
        "timeline_start": 0.0, "in": 0.0, "out": 1.5, "track": "V1",
        "effects": [{"type": "crossfade", "side": "out", "duration_s": 0.5, "transitionId": "tr_m", "transitionType": "video_cross_dissolve", "curve": "linear", "tension": 0.0}]
    }
    m2 = {
        "id": "matte_blue", "type": "color_matte", "kind": "color_matte", "color": "#0000FF",
        "timeline_start": 1.5, "in": 0.0, "out": 1.5, "track": "V1",
        "effects": [{"type": "crossfade", "side": "in", "duration_s": 0.5, "transitionId": "tr_m", "transitionType": "video_cross_dissolve", "curve": "linear", "tension": 0.0}]
    }
    seq = _salvar_e_ler([m1, m2])
    pedido = pedido_render_do_payload(1, RenderPedidoPayload(
        kind="draft",
        output={"dir": str(tmp_path), "filename": "saida_trans.mp4"}
    ))
    res = execucao.executar_agora(seq, pedido)
    assert res.get("ok") is True
    p = Path(res.get("caminho"))
    assert p.exists()
    assert p.stat().st_size > 0


def test_clipes_em_cena_inclui_geradores_sinteticos():
    """_clipes_em_cena deve contar todos os cortes ativos na cena para logging e segmentação."""
    from src.export.video_render import comando, modelo

    m = {"id": "matte_1", "type": "color_matte", "color": "#000", "timeline_start": 0.0, "in": 0.0, "out": 2.0, "track": "V1"}
    adj = {"id": "adj_1", "type": "adjustment", "timeline_start": 2.0, "in": 0.0, "out": 2.0, "track": "V2"}
    seq = modelo.normalizar({
        "version": 2, "fps": 24, "width": 1920, "height": 1080,
        "tracks": [{"id": "V1", "kind": "video"}, {"id": "V2", "kind": "video"}],
        "clips": [m, adj]
    })
    em_cena = comando._clipes_em_cena(seq)
    assert len(em_cena) == 2
    assert any(c.id == "matte_1" for c in em_cena)
    assert any(c.id == "adj_1" for c in em_cena)


def test_modelo_normalizar_aceita_in_time_out_time():
    """normalizar() deve tolerar cortes com in_time e out_time (formato schema da API / persistência)."""
    from src.export.video_render import modelo

    cut = {
        "id": "c1", "type": "video", "in_time": 1.0, "out_time": 4.0, "track": "V1", "timeline_start": 0.0
    }
    seq = modelo.normalizar({
        "version": 2, "fps": 24, "width": 1920, "height": 1080,
        "tracks": [{"id": "V1", "kind": "video"}],
        "clips": [cut]
    })
    assert len(seq.clipes) == 1
    assert seq.clipes[0].in_s == 1.0
    assert seq.clipes[0].out_s == 4.0





