"""Testes de regressão Nível 1 quadro a quadro sobre intermediário lossless (`FFV1`)."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import pytest
from PIL import Image

from . import ajudantes, metricas, oraculos, referencias
from .fontes import ler_alpha_dissolve, ler_ids

pytestmark = [pytest.mark.needs_ffmpeg, pytest.mark.render_golden]


def _variancia_laplaciano(rgb: np.ndarray) -> float:
    """Mede energia de alta frequência (nitidez/bordas) sobre a luma."""
    arr = np.asarray(rgb, dtype=np.float64)
    luma = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
    lap = (
        luma[0:-2, 1:-1]
        + luma[2:, 1:-1]
        + luma[1:-1, 0:-2]
        + luma[1:-1, 2:]
        - 4.0 * luma[1:-1, 1:-1]
    )
    return float(np.var(lap))


def test_01_canonico_cascata_ouro_barras_e_bypass(tmp_path: Path) -> None:
    """Cenário canônico: 144 quadros, referência dourada, barcodes intactos e bypass P5."""
    cenario = referencias.carregar_cenario("01_canonico_cascata")

    res = ajudantes.renderizar_cenario(cenario, tmp_path / "canon", modo="intermediario")
    quadros = ajudantes.extrair_quadros(res["caminho"])
    assert len(quadros) == 144

    comp = referencias.comparar_contra_referencia(cenario, quadros)
    assert comp["ok"] is True, f"Falha contra referência dourada: {comp}"

    # Fora da camada de ajuste [2.0s..4.5s) (quadros 48..107), barcodes preservam ID exato
    ids_ini = ler_ids(quadros[:48])
    assert ids_ini == [(i, 0) for i in range(48)]
    ids_fim = ler_ids(quadros[108:144])
    assert ids_fim == [(i - 48, 1) for i in range(108, 144)]

    # Regra P5 (bypass): adj_v2 disabled=true == sequência sem V2
    res_dis = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "bypass_disabled",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][2].__setitem__("disabled", True),
        nome_saida="bypass_disabled.mkv",
    )
    res_sem = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "bypass_sem_v2",
        modo="intermediario",
        mutar_sequencia=lambda s: (
            s["tracks"].__setitem__(0, s["tracks"][1]),
            s["tracks"].pop(1),
            s["clips"].pop(2),
        ),
        nome_saida="bypass_sem_v2.mkv",
    )
    q_dis = ajudantes.extrair_quadros(res_dis["caminho"])
    q_sem = ajudantes.extrair_quadros(res_sem["caminho"])
    assert metricas.max_abs(q_dis, q_sem) == 0


def test_03_velocidade_reverso_freeze_export(tmp_path: Path) -> None:
    """Velocidades 0.5x/2x, reverso e freeze batem exatamente com o oráculo do export."""
    cenario = referencias.carregar_cenario("03_velocidade_reverso_freeze")
    res = ajudantes.renderizar_cenario(cenario, tmp_path, modo="intermediario")
    quadros = ajudantes.extrair_quadros(res["caminho"])
    assert len(quadros) == 120

    ids_obtidos = ler_ids(quadros)
    ids_esp = oraculos.ids_esperados_sequencia(res["sequencia"], "V1", formula="export")
    assert ids_obtidos == ids_esp


@pytest.mark.xfail(
    strict=True,
    reason="REVERSO_UM_QUADRO: player.js usa out - offset enquanto export usa reverse (Estágio 2C)",
)
def test_03_reverso_paridade_formula_player(tmp_path: Path) -> None:
    """Documenta divergência de 1 quadro entre formula='player' e o reverse do FFmpeg."""
    cenario = referencias.carregar_cenario("03_velocidade_reverso_freeze")
    res = ajudantes.renderizar_cenario(cenario, tmp_path, modo="intermediario")
    quadros = ajudantes.extrair_quadros(res["caminho"])
    ids_obtidos = ler_ids(quadros[48:96])
    ids_player = oraculos.ids_esperados_sequencia(
        res["sequencia"], "V1", inicio_s=2.0, fim_s=4.0, formula="player"
    )
    assert ids_obtidos == ids_player


def test_04_corte_trim_razor_e_metamorfico(tmp_path: Path) -> None:
    """Gap inicial preto, trim com in>0 e equivalência razor [0,4) == [0,2) + [2,4)."""
    cenario = referencias.carregar_cenario("04_corte_trim_razor")
    res = ajudantes.renderizar_cenario(cenario, tmp_path / "cenario", modo="intermediario")
    quadros = ajudantes.extrair_quadros(res["caminho"])
    assert len(quadros) == 96

    # Gap [0.0, 0.5) preto puro
    assert int(quadros[:12].max()) == 0
    assert ler_ids(quadros[12:36]) == [(i, 0) for i in range(24, 48)]
    assert ler_ids(quadros[36:60]) == [(i, 0) for i in range(48, 72)]
    assert ler_ids(quadros[60:96]) == [(i, 1) for i in range(12, 48)]

    # Metamórfico Razor: cortar em t=2.0s sem transição == clipe contínuo
    base = {
        "schema": 1,
        "id": "razor_cmp",
        "fps": 24,
        "resolucao": [320, 180],
        "fontes": {"1": "barras_a.mp4"},
        "sequencia": {
            "version": 2,
            "fps": 24,
            "width": 320,
            "height": 180,
            "tracks": [{"id": "V1", "kind": "video", "order": 0}],
            "clips": [
                {"id": "u", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 4.0, "video_id": 1}
            ],
        },
        "pedido": {"kind": "master", "overrides": {"mute_audio": True}},
    }
    res_unico = ajudantes.renderizar_cenario(base, tmp_path / "razor_1", modo="intermediario")
    res_partido = ajudantes.renderizar_cenario(
        base,
        tmp_path / "razor_2",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"].__setitem__(
            slice(None),
            [
                {"id": "p1", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 2.0, "video_id": 1},
                {"id": "p2", "type": "video", "track": "V1", "timeline_start": 2.0, "in": 2.0, "out": 4.0, "video_id": 1},
            ],
        ),
    )
    assert metricas.max_abs(
        ajudantes.extrair_quadros(res_unico["caminho"]),
        ajudantes.extrair_quadros(res_partido["caminho"]),
    ) == 0


def test_05_dissolve_handles_tpad_e_dips(tmp_path: Path) -> None:
    """Dissolve com handles (rampa α), hard_boundaries (tpad=clone), dip black e dip white."""
    cenario = referencias.carregar_cenario("05_dissolve_dip_handles")

    # 1. Com handles: α(t) cresce monotonicamente de ~0 a ~1 na janela [36..60)
    res_h = ajudantes.renderizar_cenario(cenario, tmp_path / "handles", modo="intermediario")
    q_h = ajudantes.extrair_quadros(res_h["caminho"])
    assert len(q_h) == 96
    alphas = [ler_alpha_dissolve(q_h[i]) for i in range(36, 60)]
    assert alphas[0] <= 0.08
    assert alphas[-1] >= 0.90
    assert all(alphas[k] <= alphas[k + 1] + 0.01 for k in range(len(alphas) - 1))
    esperado_rampa = [(k + 0.5) / 24.0 for k in range(24)]
    assert max(abs(a - e) for a, e in zip(alphas, esperado_rampa)) <= 0.06

    # 2. Sem handles (hard_boundaries=True): A congela último quadro (47) na extensão da cauda
    cenario_tpad = copy.deepcopy(cenario)
    cenario_tpad["sequencia"]["clips"] = [
        {
            "id": "a_hb",
            "type": "video",
            "track": "V1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 2.0,
            "video_id": 1,
            "hard_boundaries": True,
            "effects": [
                {"type": "crossfade", "side": "out", "duration_s": 0.5, "transitionId": "tr_hb", "transitionType": "video_cross_dissolve"}
            ],
        },
        {
            "id": "b_matte",
            "type": "video",
            "kind": "color_matte",
            "color": "#000000",
            "track": "V1",
            "timeline_start": 2.0,
            "in": 0.0,
            "out": 2.0,
            "effects": [
                {"type": "fit", "mode": "fill"},
                {"type": "crossfade", "side": "in", "duration_s": 0.5, "transitionId": "tr_hb", "transitionType": "video_cross_dissolve"},
            ],
        },
    ]
    res_hb = ajudantes.renderizar_cenario(cenario_tpad, tmp_path / "tpad_clone", modo="intermediario")
    q_hb = ajudantes.extrair_quadros(res_hb["caminho"])
    # Quadro 47 (antes da linha de corte) vs 52 (na extensão da cauda sobre preto) têm mesmos bits 0..9 = 47
    for idx in (48, 50, 52):
        # Escala a luma inversa à atenuação residual da transição só para checar os bits de quadro
        fator = max(0.1, float(q_hb[idx, 4:16, 24:200].max()) / 235.0)
        reconstruido = np.clip(q_hb[idx].astype(np.float32) / fator, 0, 255).astype(np.uint8)
        idx_lido, fid_lido = ler_ids(reconstruido[None, ...])[0]
        assert (idx_lido, fid_lido) == (47, 0)

    # 3. video_dip_black e video_dip_white atingem preto/branco no centro da transição (quadro 48)
    for tipo_dip, espera_branco in (("video_dip_black", False), ("video_dip_white", True)):
        cen_dip = copy.deepcopy(cenario)
        cen_dip["sequencia"]["clips"][0]["effects"][0]["transitionType"] = tipo_dip
        cen_dip["sequencia"]["clips"][1]["effects"][0]["transitionType"] = tipo_dip
        res_d = ajudantes.renderizar_cenario(cen_dip, tmp_path / tipo_dip, modo="intermediario")
        q_mid = ajudantes.extrair_quadros(res_d["caminho"], indices=[48])[0]
        luma_media = float(q_mid.mean())
        if espera_branco:
            assert luma_media > 230.0
        else:
            assert luma_media < 25.0


def test_07_ajuste_escopo_tres_pistas_e_bypass(tmp_path: Path) -> None:
    """Empilhamento V3 > V2 > V1, ajuste seletivo abaixo e bypass disabled=true."""
    cenario = referencias.carregar_cenario("07_ajuste_e_pistas")
    res = ajudantes.renderizar_cenario(cenario, tmp_path / "3pistas", modo="intermediario")
    q30 = ajudantes.extrair_quadros(res["caminho"], indices=[30])[0]  # t = 1.25s

    # V3 color_matte #00ff88 em scale=0.35, x=+25% -> centro x=240, y=90
    px_v3 = q30[88:93, 238:243].mean(axis=(0, 1))
    assert px_v3[0] < 15 and px_v3[1] > 235 and 115 < px_v3[2] < 155

    # V2 scale=0.5, x=-20% -> canto esquerdo [96, 90] e topo esquerdo em [16..164, 45..135] vem de barras_b
    # Canto superior esquerdo fora de V2 e V3 ([4,4]..[30,30]) vem de V1 (barras_a, código de barras frame 30)
    assert ler_ids(q30[None, ...])[0] == (30, 0)

    # Adiciona camada de ajuste em V_ADJ entre V3 e V2 (ordem: V3=0, V_ADJ=1, V2=2, V1=3) e testa bypass
    cen_adj = copy.deepcopy(cenario)
    cen_adj["sequencia"]["tracks"] = [
        {"id": "V3", "kind": "video", "order": 0},
        {"id": "V_ADJ", "kind": "video", "order": 1},
        {"id": "V2", "kind": "video", "order": 2},
        {"id": "V1", "kind": "video", "order": 3},
    ]
    adj_clip = {
        "id": "adj_mid",
        "type": "adjustment",
        "kind": "adjustment",
        "track": "V_ADJ",
        "timeline_start": 0.5,
        "in": 0.0,
        "out": 2.0,
        "blend_mode": "multiply",
        "effects": [
            {"type": "color", "brightness": -35.0},
            {"type": "crop", "top": 10.0, "right": 10.0, "bottom": 10.0, "left": 10.0},
            {"type": "crossfade", "side": "in", "duration_s": 0.4, "curve": "linear"},
        ],
    }
    cen_adj["sequencia"]["clips"].append(adj_clip)
    res_adj = ajudantes.renderizar_cenario(cen_adj, tmp_path / "com_adj", modo="intermediario")
    q_adj = ajudantes.extrair_quadros(res_adj["caminho"], indices=[30])[0]
    # V3 está acima de V_ADJ, logo #00ff88 permanece intacto em x=240, y=90
    px_v3_apos = q_adj[88:93, 238:243].mean(axis=(0, 1))
    assert np.allclose(px_v3_apos, px_v3, atol=2.0)
    # Enquanto a região dentro do crop sobre V1/V2 (ex.: x=40, y=90) escurece bastante
    assert float(q_adj[85:95, 35:45].mean()) < float(q30[85:95, 35:45].mean()) * 0.65

    # Disabled == sem camada de ajuste
    cen_dis = copy.deepcopy(cen_adj)
    cen_dis["sequencia"]["clips"][-1]["disabled"] = True
    res_dis = ajudantes.renderizar_cenario(cen_dis, tmp_path / "dis_adj", modo="intermediario")
    q_dis = ajudantes.extrair_quadros(res_dis["caminho"], indices=[30])[0]
    assert metricas.max_abs(q_dis, q30) == 0


@pytest.mark.parametrize(
    "modo_blend",
    ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "soft-light"],
)
def test_08_blend_modes_w3c_por_pixel(tmp_path: Path, modo_blend: str) -> None:
    """Todos os modos W3C batem pixel a pixel com `oraculos.blend_w3c_numpy`."""
    cenario = referencias.carregar_cenario("08_blend_modes")

    res_base = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / f"base_{modo_blend}",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"].pop(1),
    )
    q_base = ajudantes.extrair_quadros(res_base["caminho"], indices=[0])[0]

    def _mut(s: dict) -> None:
        s["clips"][1]["blend_mode"] = modo_blend
        s["clips"][1]["effects"].append({"type": "transform", "opacity": 0.8})

    res_mix = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / f"mix_{modo_blend}",
        modo="intermediario",
        mutar_sequencia=_mut,
    )
    q_mix = ajudantes.extrair_quadros(res_mix["caminho"], indices=[0])[0]

    topo_rgb = np.full_like(q_base, (0x33, 0x66, 0xCC), dtype=np.uint8)
    esperado = oraculos.blend_w3c_numpy(modo_blend, q_base, topo_rgb, alpha=0.8)

    # Região interior contínua [25:160, 20:300] longe de artefatos de subamostragem de borda
    reg_obt = q_mix[25:160, 20:300]
    reg_esp = esperado[25:160, 20:300]
    assert metricas.max_abs(reg_obt, reg_esp) <= 6
    assert metricas.psnr(reg_obt, reg_esp) >= 42.0


@pytest.mark.parametrize(
    "efeito_color",
    [
        {"type": "color", "brightness": 30.0},
        {"type": "color", "contrast": 40.0},
        {"type": "color", "saturation": 160.0},
        {"type": "color", "hue": 60.0},
        {"type": "color", "sepia": 75.0, "grayscale": 20.0},
        {"type": "color", "brightness": 50.0, "contrast": -40.0, "saturation": 130.0, "hue": 35.0, "sepia": 20.0, "grayscale": 10.0},
    ],
)
def test_09_cor_css_filters_e_grampeamento(tmp_path: Path, efeito_color: Dict[str, Any]) -> None:
    """Brightness/contrast/saturate/hue/sepia/grayscale reproduzem `aplicar_cor_css_numpy`."""
    cenario = referencias.carregar_cenario("09_cor_css")
    raw_foto = np.asarray(
        Image.open(ajudantes.resolver_caminhos_fontes(cenario)["1"]).convert("RGB"),
        dtype=np.uint8,
    )

    res_cor = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "cor",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "fit", "mode": "fill"}, efeito_color]
        ),
    )
    q_cor = ajudantes.extrair_quadros(res_cor["caminho"], indices=[0])[0]

    esperado = oraculos.aplicar_cor_css_numpy(raw_foto, efeito_color)
    # Faixa de gradiente contínua [48:80, 55:145] livre dos marcadores (evita rung 4:2:0 em bordas secas)
    reg_obt = q_cor[48:80, 55:145]
    reg_esp = esperado[48:80, 55:145]
    assert metricas.max_abs(reg_obt, reg_esp) <= 6
    assert metricas.psnr(reg_obt, reg_esp) >= 40.0
    assert metricas.ssim_luma(reg_obt, reg_esp) >= 0.99


def test_09_cor_blur_reduz_alta_frequencia(tmp_path: Path) -> None:
    """`blur` em `color` reduz drasticamente a variância do Laplaciano nas bordas dos marcadores."""
    cenario = referencias.carregar_cenario("09_cor_css")
    res_base = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "sem_blur",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "fit", "mode": "fill"}]
        ),
    )
    res_blur = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "com_blur",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects", [{"type": "fit", "mode": "fill"}, {"type": "color", "blur": 6.0}]
        ),
    )
    q_base = ajudantes.extrair_quadros(res_base["caminho"], indices=[0])[0]
    q_blur = ajudantes.extrair_quadros(res_blur["caminho"], indices=[0])[0]
    assert _variancia_laplaciano(q_blur) < 0.25 * _variancia_laplaciano(q_base)


@pytest.mark.parametrize(
    "curve,tension",
    [
        ("linear", 0.0),
        ("s_curve", 0.0),
        ("s_curve", 0.4),
        ("logarithmic", 0.0),
        ("exponential", 0.0),
        ("equal_power", 0.0),
        ("custom", 0.5),
        ("custom", -0.5),
    ],
)
def test_10_fade_curvas_parametricas(tmp_path: Path, curve: str, tension: float) -> None:
    """Todas as curvas paramétricas de fade em vídeo seguem `oraculos.avaliar_fade_curva`."""
    cenario = referencias.carregar_cenario("10_fade_curvas")

    def _mut(s: dict) -> None:
        s["clips"][0]["out"] = 1.0
        s["clips"][0]["effects"] = [
            {"type": "fit", "mode": "fill"},
            {"type": "crossfade", "side": "in", "duration_s": 1.0, "curve": curve, "tension": tension},
        ]

    res = ajudantes.renderizar_cenario(cenario, tmp_path, modo="intermediario", mutar_sequencia=_mut)
    quadros = ajudantes.extrair_quadros(res["caminho"])
    assert len(quadros) == 24

    lumas_norm = [float(quadros[q, 60:120, 100:220].mean()) / 255.0 for q in range(24)]
    assert all(lumas_norm[k] <= lumas_norm[k + 1] + 0.01 for k in range(23))

    # Tolerância cobre arredondamento uint8 + quantização t=q/24 vs centro do quadro
    erros = [
        min(
            abs(lumas_norm[q] - oraculos.avaliar_fade_curva(q / 24.0, curve=curve, tension=tension)),
            abs(lumas_norm[q] - oraculos.avaliar_fade_curva((q + 0.5) / 24.0, curve=curve, tension=tension)),
        )
        for q in range(24)
    ]
    assert max(erros) <= 0.035


def _gerar_foto_assimetrica(destino: Path) -> Path:
    """Foto 320x180 com fundo escuro e marcador ciano excêntrico em (+80, 0) a partir do centro."""
    img = np.full((180, 320, 3), 24, dtype=np.uint8)
    # Marcador ciano de 10x10 centrado em (240, 90) -> dx = +80, dy = 0 em relação a (160, 90)
    img[85:95, 235:245] = (0, 255, 255)
    Image.fromarray(img, "RGB").save(destino, format="PNG")
    return destino


def test_11_geometria_escala_translacao_rotacoes_e_crop(tmp_path: Path) -> None:
    """`transform` (scale/x/y/90/180/270/15°) posiciona centroide em <=1.5px e `crop` zera fora."""
    cenario = referencias.carregar_cenario("11_geometria")

    # 1. Scale 0.5 + x=15% + y=-10% sobre foto.png (marcador central em 159.5, 89.5 -> 207.5, 71.5)
    res_pos = ajudantes.renderizar_cenario(cenario, tmp_path / "pos", modo="intermediario")
    q_pos = ajudantes.extrair_quadros(res_pos["caminho"], indices=[0])[0]
    cx, cy = oraculos.centroide_marcador(q_pos, cor_alvo=(0, 255, 255), tolerancia=60.0)
    assert cx == pytest.approx(207.5, abs=1.5)
    assert cy == pytest.approx(71.5, abs=1.5)

    # 2. Rotações 90°, 180°, 270°, 15° (sentido horário) sobre marcador em (+80, 0)
    foto_asym = _gerar_foto_assimetrica(tmp_path / "asym.png")
    rotacoes = [
        (90.0, 159.5, 169.5),
        (180.0, 79.5, 89.5),
        (270.0, 159.5, 9.5),
        (15.0, 159.5 + 80.0 * np.cos(np.deg2rad(15.0)), 89.5 + 80.0 * np.sin(np.deg2rad(15.0))),
    ]
    for ang, esp_x, esp_y in rotacoes:
        res_rot = ajudantes.renderizar_cenario(
            cenario,
            tmp_path / f"rot_{int(ang)}",
            modo="intermediario",
            fontes_override={"1": foto_asym},
            mutar_sequencia=lambda s, a=ang: s["clips"][0].__setitem__(
                "effects",
                [{"type": "fit", "mode": "fill"}, {"type": "transform", "scale": 1.0, "x": 0.0, "y": 0.0, "rotation": a}],
            ),
        )
        q_rot = ajudantes.extrair_quadros(res_rot["caminho"], indices=[0])[0]
        rcx, rcy = oraculos.centroide_marcador(q_rot, cor_alvo=(0, 255, 255), tolerancia=80.0)
        assert rcx == pytest.approx(esp_x, abs=1.5)
        assert rcy == pytest.approx(esp_y, abs=1.5)

    # 3. Crop inset 20% em todos os lados zera a moldura externa e preserva centro
    res_crop = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "crop",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][0].__setitem__(
            "effects",
            [{"type": "fit", "mode": "fill"}, {"type": "crop", "top": 20.0, "right": 20.0, "bottom": 20.0, "left": 20.0}],
        ),
    )
    q_crop = ajudantes.extrair_quadros(res_crop["caminho"], indices=[0])[0]
    # Borda superior [0..30] e inferior [150..180] permanecem pretas (max <= 2)
    assert int(q_crop[:30, :].max()) <= 2
    assert int(q_crop[150:, :].max()) <= 2
    assert int(q_crop[:, :55].max()) <= 2
    assert int(q_crop[:, 265:].max()) <= 2
    assert int(q_crop[85:95, 155:165].mean()) > 100


def _distancia_marcadores_topo(quadro_rgb: np.ndarray) -> float:
    """Mede a distância horizontal entre os marcadores brancos superior-esquerdo e superior-direito."""
    cx_e, _ = oraculos.centroide_marcador(
        quadro_rgb, cor_alvo=(255, 255, 255), tolerancia=60.0, regiao=(0, 0, 150, 85)
    )
    cx_d, _ = oraculos.centroide_marcador(
        quadro_rgb, cor_alvo=(255, 255, 255), tolerancia=60.0, regiao=(170, 0, 320, 85)
    )
    assert cx_e is not None and cx_d is not None
    return float(cx_d - cx_e)


def test_12_matte_foto_estatica_e_ken_burns(tmp_path: Path) -> None:
    """Color matte exato, foto parada, Ken Burns monotônico e identidade sem deriva."""
    cenario = referencias.carregar_cenario("12_matte_foto_kenburns")

    # 1. Color matte sólido #ff3300 com tolerância ±1
    cen_matte = {
        "schema": 1,
        "id": "matte_puro",
        "fps": 24,
        "resolucao": [320, 180],
        "fontes": {},
        "sequencia": {
            "version": 2,
            "fps": 24,
            "width": 320,
            "height": 180,
            "tracks": [{"id": "V1", "kind": "video", "order": 0}],
            "clips": [
                {"id": "m1", "type": "video", "kind": "color_matte", "color": "#ff3300", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 0.5, "effects": [{"type": "fit", "mode": "fill"}]}
            ],
        },
        "pedido": {"kind": "master", "overrides": {"mute_audio": True}},
    }
    res_m = ajudantes.renderizar_cenario(cen_matte, tmp_path / "matte", modo="intermediario")
    q_m = ajudantes.extrair_quadros(res_m["caminho"], indices=[0])[0]
    assert np.allclose(q_m[80:100, 150:170].mean(axis=(0, 1)), (255, 51, 0), atol=2.5)

    # 2. Foto estática + Ken Burns identidade não derivam
    cen_id = copy.deepcopy(cenario)
    cen_id["sequencia"]["clips"] = [cen_id["sequencia"]["clips"][0]]
    cen_id["sequencia"]["clips"][0]["out"] = 1.0
    cen_id["sequencia"]["clips"][0]["effects"][1] = {
        "type": "ken_burns",
        "easing": "linear",
        "from": {"scale": 1.0, "x": 0.0, "y": 0.0},
        "to": {"scale": 1.0, "x": 0.0, "y": 0.0},
    }
    res_id = ajudantes.renderizar_cenario(cen_id, tmp_path / "kb_id", modo="intermediario")
    q_id = ajudantes.extrair_quadros(res_id["caminho"], indices=[0, 23])
    assert metricas.max_abs(q_id[0], q_id[1]) == 0

    # 3. Cenário padrão: Ken Burns 1.0 -> 1.6 afasta os marcadores brancos de q=0 para q=19
    res_kb = ajudantes.renderizar_cenario(cenario, tmp_path / "kb", modo="intermediario")
    q_kb = ajudantes.extrair_quadros(res_kb["caminho"], indices=[0, 10, 19])
    d0 = _distancia_marcadores_topo(q_kb[0])
    d10 = _distancia_marcadores_topo(q_kb[1])
    d19 = _distancia_marcadores_topo(q_kb[2])
    assert d10 > d0 + 5.0
    assert d19 > d10 + 10.0


@pytest.mark.needs_browser
def test_17_titulo_caixa_desfoque_ouro_bypass_e_blur(tmp_path: Path) -> None:
    """Título com navegador comum: referência dourada, bypass disabled=true e backdrop-filter blur."""
    cenario = referencias.carregar_cenario("17_titulo_caixa_desfoque")
    res = ajudantes.renderizar_cenario(cenario, tmp_path / "titulo_ouro", modo="intermediario")
    quadros = ajudantes.extrair_quadros(res["caminho"])
    assert len(quadros) == 24

    comp = referencias.comparar_contra_referencia(cenario, quadros)
    assert comp["ok"] is True, f"Título divergiu da referência dourada: {comp}"

    # Bypass: título disabled=true == sequência sem título
    res_dis = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "titulo_disabled",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][1].__setitem__("disabled", True),
    )
    res_sem = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "titulo_sem",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"].pop(1),
    )
    assert metricas.max_abs(
        ajudantes.extrair_quadros(res_dis["caminho"]),
        ajudantes.extrair_quadros(res_sem["caminho"]),
    ) == 0

    # Backdrop-filter blur: sobre fundo bicolor branco/preto dividido ao meio, a caixa desfoca a borda
    cen_blur = copy.deepcopy(cenario)
    cen_blur["sequencia"]["tracks"] = [
        {"id": "T1", "kind": "text", "order": 0},
        {"id": "V2", "kind": "video", "order": 1},
        {"id": "V1", "kind": "video", "order": 2},
    ]
    cen_blur["sequencia"]["clips"] = [
        {"id": "bg_preto", "type": "video", "kind": "color_matte", "color": "#000000", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 0.25, "effects": [{"type": "fit", "mode": "fill"}]},
        {
            "id": "bg_branco",
            "type": "video",
            "kind": "color_matte",
            "color": "#ffffff",
            "track": "V2",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 0.25,
            "effects": [{"type": "fit", "mode": "fill"}, {"type": "crop", "top": 0.0, "right": 0.0, "bottom": 50.0, "left": 0.0}],
        },
        {
            "id": "gc_caixa",
            "type": "text",
            "track": "T1",
            "timeline_start": 0.0,
            "in": 0.0,
            "out": 0.25,
            "text": "Fulana de Tal",
            "color": "rgba(0,0,0,0)",
            "fontFamily": "Inter",
            "fontSize": 60,
            "backgroundColor": "rgba(0,0,0,0.45)",
            "boxPadding": 24,
            "boxBorderRadius": 0,
        },
    ]
    res_caixa = ajudantes.renderizar_cenario(cen_blur, tmp_path / "caixa_blur", modo="intermediario")
    res_sem_caixa = ajudantes.renderizar_cenario(
        cen_blur,
        tmp_path / "sem_caixa_blur",
        modo="intermediario",
        mutar_sequencia=lambda s: s["clips"][2].__setitem__("bgMode", "transparent"),
    )
    cmd_str = " ".join(res_caixa["cmd"])
    assert "gblur@tdf" in cmd_str and "=sigma=" in cmd_str
    q_cb = ajudantes.extrair_quadros(res_caixa["caminho"], indices=[0])[0]
    q_sb = ajudantes.extrair_quadros(res_sem_caixa["caminho"], indices=[0])[0]
    # Faixa central da caixa atravessando y=180 (transição branco->preto) em 640x360
    var_cb = _variancia_laplaciano(q_cb[160:200, 260:380])
    var_sb = _variancia_laplaciano(q_sb[160:200, 260:380])
    assert var_cb < 0.25 * var_sb
