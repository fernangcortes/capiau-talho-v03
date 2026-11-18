"""Testes de regressão Nível 1 sobre a saída real MP4 (`H.264 + AAC`) e Video Receipts."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pytest

from src.export.video_render import execucao, midia, modelo, recibo

from . import ajudantes, metricas, referencias
from .fontes import ler_ids

pytestmark = [pytest.mark.needs_ffmpeg, pytest.mark.render_golden]


@pytest.mark.parametrize(
    "fps,fonte_nome,duracao_s,quadros_esperados",
    [
        (24, "barras_a.mp4", 4.0, 96),
        (25, "barras_25.mp4", 4.0, 100),
        (29.97, "barras_2997.mp4", 4.0, 120),
        (60, "barras_a.mp4", 4.0, 240),
        (60, "barras_60.mp4", 3.0, 180),
    ],
)
def test_02_contagem_quadros_e_duracao_multiplos_fps(
    tmp_path: Path,
    fps: float,
    fonte_nome: str,
    duracao_s: float,
    quadros_esperados: int,
) -> None:
    """P6/P8/tempo real: MP4 final mantém contagem exata CFR e duração dentro de 1 quadro."""
    cenario = referencias.carregar_cenario("02_contagem_e_tempo")

    def _mut_seq(seq_d: dict) -> None:
        seq_d["fps"] = fps
        seq_d["clips"][0]["out"] = duracao_s

    def _mut_ped(ped_d: dict) -> None:
        ov = dict(ped_d.get("overrides") or {})
        ov["fps"] = fps
        ped_d["overrides"] = ov

    mapa_midia = ajudantes.resolver_caminhos_fontes({"fontes": {"1": fonte_nome}})
    res = ajudantes.renderizar_cenario(
        cenario,
        tmp_path,
        modo="real",
        mutar_sequencia=_mut_seq,
        mutar_pedido=_mut_ped,
        fontes_override={"1": mapa_midia["1"]},
        nome_saida=f"contagem_{str(fps).replace('.', '_')}_{fonte_nome}.mp4",
    )

    info = ajudantes.sondar_video(res["caminho"])
    assert info["codec_name"] == "h264"
    assert info["pix_fmt"] == "yuv420p"
    assert info["width"] == 320
    assert info["height"] == 180
    assert info["nb_read_frames"] == quadros_esperados
    assert info["duration"] is not None
    assert abs(info["duration"] - duracao_s) <= (1.0 / fps) + 0.005


def test_02_subfaixa_in_out_preserva_ids_barras(tmp_path: Path) -> None:
    """Faixa IN/OUT [1.0s, 2.5s) @ 24fps produz exatamente 36 quadros com IDs [24..59]."""
    cenario = referencias.carregar_cenario("02_contagem_e_tempo")

    def _mut_ped(ped_d: dict) -> None:
        ped_d["faixa"] = {"modo": "in_out", "inicio_s": 1.0, "fim_s": 2.5}

    res = ajudantes.renderizar_cenario(
        cenario,
        tmp_path,
        modo="real",
        mutar_pedido=_mut_ped,
        nome_saida="in_out_1_25.mp4",
    )
    info = ajudantes.sondar_video(res["caminho"])
    assert info["nb_read_frames"] == 36
    assert abs(info["duration"] - 1.5) <= (1.0 / 24.0) + 0.005

    quadros = ajudantes.extrair_quadros(res["caminho"])
    ids = ler_ids(quadros)
    assert len(ids) == 36
    esperados = [(idx, 0) for idx in range(24, 60)]
    assert ids == esperados


def test_02_execucao_real_grava_video_receipt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Kinocut Video Receipt: `execucao.executar_agora` grava `.receipt.json` íntegro no MP4 real."""
    cenario = referencias.carregar_cenario("02_contagem_e_tempo")
    seq, pedido = ajudantes.construir_seq_e_pedido(cenario)
    dir_saida = tmp_path / "exports_reais"
    pedido.saida = modelo.Saida(diretorio=str(dir_saida), nome_arquivo="02_receipt_master.mp4")

    fontes = ajudantes.resolver_caminhos_fontes(cenario)
    orig_resolver = midia.resolver_fontes
    monkeypatch.setattr(
        midia,
        "resolver_fontes",
        lambda s, p, **kw: orig_resolver(
            s,
            p,
            buscar_midia=lambda _t, mid: {
                "id": int(mid),
                "filepath": str(fontes[str(mid)]),
                "duration": 6.0,
            },
            checar_drive=lambda _l: True,
        ),
    )

    res = execucao.executar_agora(seq, pedido)
    assert res["ok"] is True
    destino = dir_saida / "02_receipt_master.mp4"
    assert destino.is_file()
    info = ajudantes.sondar_video(destino)
    assert info["nb_read_frames"] == 96

    caminho_recibo = Path(res["caminho_recibo"])
    assert caminho_recibo == recibo.caminho_recibo_para(destino)
    assert caminho_recibo.is_file()

    dados = json.loads(caminho_recibo.read_text(encoding="utf-8"))
    assert dados["schema_version"] == 1
    assert len(dados["timeline"]["sequence_sha256"]) == 64
    assert dados["execucao"]["encoder"] == "libx264"
    assert len(dados["execucao"]["comandos_ffmpeg"]) >= 1
    assert len(dados["proveniencia_midia"]) == 1
    assert len(dados["proveniencia_midia"][0]["sha256"]) == 64
    assert dados["saida"]["probe"]["nb_frames"] == 96


def _amostrar_barras_smpte_hd(quadro_rgb: np.ndarray) -> Dict[str, Tuple[int, int, int]]:
    """Amostra os centros horizontais das 6 barras cromáticas SMPTE HD (1280x720, y=150)."""
    # smptehdbars 1280x720: [0..160)=cinza, [160..1120)=7 barras (~137.14px cada):
    # branca(0), amarela(1), ciano(2), verde(3), magenta(4), vermelha(5), azul(6)
    largura_barra = 960.0 / 7.0
    nomes = ("amarelo", "ciano", "verde", "magenta", "vermelho", "azul")
    y = 150
    amostras: Dict[str, Tuple[int, int, int]] = {}
    for idx_rel, nome in enumerate(nomes, start=1):
        cx = int(round(160.0 + (idx_rel + 0.5) * largura_barra))
        px = quadro_rgb[y - 2 : y + 3, cx - 2 : cx + 3].mean(axis=(0, 1))
        amostras[nome] = (int(round(px[0])), int(round(px[1])), int(round(px[2])))
    return amostras


def test_06_cor_hd_matriz_e_fidelidade_cromatica(tmp_path: Path) -> None:
    """HD SMPTE etiquetada BT.709 preserva cromaticidade BT.709 esperada na saída real."""
    cenario = referencias.carregar_cenario("06_cor_hd_matriz")
    fontes = ajudantes.resolver_caminhos_fontes(cenario)

    res_709 = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "com_tag",
        modo="real",
        nome_saida="smpte_out_709.mp4",
    )
    info_709 = ajudantes.sondar_video(res_709["caminho"])
    assert info_709["width"] == 1280 and info_709["height"] == 720

    q_src = ajudantes.extrair_quadros(fontes["1"], indices=[0], matriz_in="bt709")[0]
    q_709 = ajudantes.extrair_quadros(res_709["caminho"], indices=[0], matriz_in="bt709")[0]

    assert metricas.psnr(q_src, q_709) >= 42.0
    assert metricas.ssim_luma(q_src, q_709) >= 0.995

    barras_src = _amostrar_barras_smpte_hd(q_src)
    barras = _amostrar_barras_smpte_hd(q_709)
    for nome in barras:
        for ch in range(3):
            assert abs(barras[nome][ch] - barras_src[nome][ch]) <= 4
    # Verifica canais dominantes nas barras 75% (evita inversão R/B ou shift severo 601<->709)
    r_y, g_y, b_y = barras["amarelo"]
    assert r_y > 160 and g_y > 160 and b_y < 40
    r_c, g_c, b_c = barras["ciano"]
    assert r_c < 40 and g_c > 160 and b_c > 160
    r_g, g_g, b_g = barras["verde"]
    assert g_g > 160 and r_g < 40 and b_g < 40
    r_m, g_m, b_m = barras["magenta"]
    assert r_m > 160 and b_m > 160 and g_m < 40
    r_r, g_r, b_r = barras["vermelho"]
    assert r_r > 160 and g_r < 40 and b_r < 40
    r_b, g_b, b_b = barras["azul"]
    assert b_b > 160 and r_b < 40 and g_b < 40


@pytest.mark.xfail(
    strict=True,
    reason="HD_SEM_ETIQUETA_BT709: comando.py ainda não emite -colorspace bt709 / out_color_matrix=bt709 (Estágio 4A Frente G1a)",
)
def test_06_cor_hd_semtag_recebe_etiqueta_e_matriz_bt709(tmp_path: Path) -> None:
    """Divergência conhecida: fonte HD sem metadado BT.709 sai sem tag e sofre shift 601/709."""
    cenario = referencias.carregar_cenario("06_cor_hd_matriz")
    res_709 = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "com_tag",
        modo="real",
        nome_saida="smpte_out_709.mp4",
    )
    res_semtag = ajudantes.renderizar_cenario(
        cenario,
        tmp_path / "sem_tag",
        modo="real",
        mutar_sequencia=lambda s: s["clips"][0].__setitem__("video_id", 2),
        nome_saida="smpte_out_semtag.mp4",
    )
    info_sem = ajudantes.sondar_video(res_semtag["caminho"])
    q_709 = ajudantes.extrair_quadros(res_709["caminho"], indices=[0], matriz_in="bt709")[0]
    q_sem = ajudantes.extrair_quadros(res_semtag["caminho"], indices=[0], matriz_in="bt709")[0]
    assert info_sem["color_space"] == "bt709"
    assert metricas.psnr(q_709, q_sem) >= 50.0
