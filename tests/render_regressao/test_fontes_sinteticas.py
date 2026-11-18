"""Testes das fontes sintéticas determinísticas e código de barras de 11 bits."""
from __future__ import annotations

import pytest
from PIL import Image
import numpy as np

from . import ajudantes, fontes, oraculos

pytestmark = [pytest.mark.needs_ffmpeg]


@pytest.mark.parametrize(
    "nome,fid_esperado,n_esperado",
    [
        ("barras_a.mp4", 0, 144),
        ("barras_b.mp4", 1, 144),
        ("barras_a.webm", 0, 144),
        ("barras_b.webm", 1, 144),
        ("barras_25.mp4", 0, 100),
        ("barras_2997.mp4", 0, 120),
        ("barras_60.mp4", 0, 180),
    ],
)
def test_fontes_barras_leitura_exata_de_todos_os_quadros(
    fontes_sinteticas, nome: str, fid_esperado: int, n_esperado: int
):
    caminho = fontes_sinteticas[nome]
    quadros = ajudantes.extrair_quadros(caminho)
    assert len(quadros) == n_esperado
    ids = fontes.ler_ids(quadros)
    assert ids == [(i, fid_esperado) for i in range(n_esperado)]


def test_etiquetas_de_cor_e_marcadores(fontes_sinteticas):
    s_tag = ajudantes.sondar_video(fontes_sinteticas["smpte_hd_709.mp4"])
    s_sem = ajudantes.sondar_video(fontes_sinteticas["smpte_hd_semtag.mp4"])
    assert s_tag["color_space"] == "bt709"
    assert s_tag["width"] == 1280 and s_tag["height"] == 720
    assert s_sem["color_space"] in (None, "unknown")

    foto_rgb = np.asarray(Image.open(fontes_sinteticas["foto.png"]).convert("RGB"), dtype=np.uint8)
    assert foto_rgb.shape == (180, 320, 3)
    cx, cy = oraculos.centroide_marcador(foto_rgb, cor_alvo=(0, 255, 255), tolerancia=30.0)
    assert cx == pytest.approx(159.5, abs=1.0)
    assert cy == pytest.approx(89.5, abs=1.0)
