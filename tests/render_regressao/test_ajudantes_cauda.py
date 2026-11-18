"""Testes da cauda intermediária, determinismo, métricas cruzadas e guarda de referências."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from src.export.video_render import comando, midia, modelo

from . import ajudantes, fontes, metricas, referencias

pytestmark = [pytest.mark.needs_ffmpeg]


def _cenario_simples(tmp_path: Path) -> dict:
    wav_path = fontes.gerar_wav_seno(tmp_path / "tom_1k.wav", duracao_s=2.0)
    return {
        "schema": 1,
        "id": "teste_infra_simples",
        "fps": 24,
        "resolucao": [320, 180],
        "fontes": {"1": "barras_a.mp4", "2": str(wav_path)},
        "sequencia": {
            "version": 2,
            "fps": 24,
            "width": 320,
            "height": 180,
            "tracks": [
                {"id": "V1", "kind": "video", "order": 0},
                {"id": "A1", "kind": "audio", "order": 1},
            ],
            "clips": [
                {"id": "v1", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 2.0, "video_id": 1},
                {"id": "a1", "type": "audio", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 2.0, "video_id": 2},
            ],
        },
        "pedido": {"kind": "master", "faixa": None, "overrides": {}},
    }


def test_guarda_cauda_comando_e_resolucao_obrigatoria(fontes_sinteticas, tmp_path):
    cen = _cenario_simples(tmp_path)
    seq, pedido = ajudantes.construir_seq_e_pedido(cen)
    assert pedido.overrides["resolution"] == "320x180"

    rel = midia.resolver_fontes(
        seq,
        pedido,
        buscar_midia=lambda _t, mid: {"id": mid, "filepath": str(fontes_sinteticas["barras_a.mp4"]), "duration": 6.0},
        checar_drive=lambda _l: True,
    )
    res_cmd = comando.montar_comando(seq, pedido, tmp_path / "orig.mp4", rel_midia=rel, destino_validado=True)
    cmd = res_cmd["cmd"]
    idx_cv = cmd.index("-c:v")
    assert "-r" in cmd[idx_cv:] and "-t" in cmd[idx_cv:]

    cmd_ffv1 = ajudantes.comando_intermediario(cmd, tmp_path / "inter.mkv")
    assert cmd_ffv1[cmd_ffv1.index("-c:v") + 1] == "ffv1"
    assert cmd_ffv1[cmd_ffv1.index("-c:a") + 1] == "pcm_s16le"
    assert cmd_ffv1[cmd_ffv1.index("-r") + 1] == cmd[cmd.index("-r") + 1]
    assert cmd_ffv1[cmd_ffv1.index("-t") + 1] == cmd[cmd.index("-t") + 1]
    assert "-fps_mode" in cmd_ffv1 and "cfr" in cmd_ffv1


def test_determinismo_entre_1_e_8_threads(fontes_sinteticas, tmp_path):
    cen = _cenario_simples(tmp_path)
    r1 = ajudantes.renderizar_cenario(cen, tmp_path / "t1", threads=1, filter_threads=1)
    r8 = ajudantes.renderizar_cenario(cen, tmp_path / "t8", threads=8, filter_threads=8)

    assert ajudantes.framemd5_video(r1["caminho"]) == ajudantes.framemd5_video(r8["caminho"])
    a1 = ajudantes.extrair_audio(r1["caminho"])
    a8 = ajudantes.extrair_audio(r8["caminho"])
    assert hashlib.sha1(a1.tobytes()).hexdigest() == hashlib.sha1(a8.tobytes()).hexdigest()
    res = metricas.compute_audio_residual_rms_db(a1, a8)
    assert res["residuo_max"] == 0.0


def test_metricas_imagem_conhecidas_e_validacao_cruzada_ffmpeg(fontes_sinteticas, tmp_path):
    q = ajudantes.extrair_quadros(fontes_sinteticas["barras_a.mp4"], [0, 5])
    a, b_deslocado = q[0], q[1]
    assert metricas.psnr(a, a) == float("inf")
    assert metricas.max_abs(a, a) == 0
    assert metricas.ssim_luma(a, a) == pytest.approx(1.0, abs=1e-6)

    mais_1 = np.clip(a.astype(np.int32) + 1, 0, 255).astype(np.uint8)
    assert metricas.max_abs(a, mais_1) == 1
    assert metricas.psnr(a, mais_1) == pytest.approx(48.13, abs=0.2)
    assert metricas.psnr(a, b_deslocado) < 40.0

    # Matriz 601 vs 709 no SMPTE HD -> queda severa (~25-30 dB)
    hd_709 = ajudantes.extrair_quadros(fontes_sinteticas["smpte_hd_709.mp4"], [0], matriz_in="bt709")[0]
    hd_601 = ajudantes.extrair_quadros(fontes_sinteticas["smpte_hd_709.mp4"], [0], matriz_in="bt601")[0]
    psnr_matriz = metricas.psnr(hd_709, hd_601)
    assert 22.0 <= psnr_matriz <= 32.0

    # Validação cruzada PSNR e SSIM contra os filtros do próprio FFmpeg
    p1 = tmp_path / "img1.png"
    p2 = tmp_path / "img2.png"
    Image.fromarray(a, "RGB").save(p1)
    rng = np.random.default_rng(7)
    ruido = np.clip(a.astype(np.int32) + rng.integers(-6, 7, size=a.shape), 0, 255).astype(np.uint8)
    Image.fromarray(ruido, "RGB").save(p2)

    proc_psnr = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-v", "info",
            "-i", str(p1), "-i", str(p2),
            "-filter_complex", "[0:v][1:v]psnr",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    proc_ssim = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-v", "info",
            "-i", str(p1), "-i", str(p2),
            "-filter_complex",
            "[0:v]scale=out_color_matrix=bt709:out_range=pc,format=yuv444p[s0];"
            "[1:v]scale=out_color_matrix=bt709:out_range=pc,format=yuv444p[s1];"
            "[s0][s1]ssim",
            "-f", "null", "-",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    m_psnr = re.search(r"average:(\d+\.\d+)", proc_psnr.stderr)
    m_ssim = re.search(r"Y:(\d+\.\d+)", proc_ssim.stderr)
    assert m_psnr and m_ssim
    ff_psnr = float(m_psnr.group(1))
    ff_ssim = float(m_ssim.group(1))

    assert abs(metricas.psnr(a, ruido) - ff_psnr) <= 0.05
    assert abs(metricas.ssim_luma(a, ruido) - ff_ssim) <= 0.02


def test_guarda_referencias_e_fluxo_aprovacao_em_tmp(fontes_sinteticas, tmp_path):
    # O pytest NUNCA pode escrever diretamente na pasta versionada referencias/
    assert referencias._PERMITIR_ESCRITA_REFERENCIAS is False
    with pytest.raises(PermissionError):
        referencias.exigir_permissao_escrita_referencias(referencias.PASTA_REFERENCIAS / "qualquer" / "APROVADO.json")

    # Simula gerar + aprovar em pastas temporárias (usando cenário 01 ou cenário sintético em tmp)
    cen_dir = tmp_path / "cenarios"
    cen_dir.mkdir()
    cid = "tmp_cen_aprov"
    cen_obj = {
        "schema": 1,
        "id": cid,
        "fps": 24,
        "resolucao": [320, 180],
        "fontes": {"1": "barras_a.mp4"},
        "sequencia": {
            "version": 2,
            "fps": 24,
            "width": 320,
            "height": 180,
            "tracks": [{"id": "V1", "kind": "video", "order": 0}],
            "clips": [{"id": "v1", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 1.0, "video_id": 1}],
        },
        "pedido": {"kind": "master", "faixa": None, "overrides": {}},
        "quadros_chave": [0, 12],
    }
    (cen_dir / f"{cid}.json").write_text(json.dumps(cen_obj), encoding="utf-8")

    # Valida schema maior recusado
    invalido = dict(cen_obj, schema=999)
    with pytest.raises(ValueError, match="schema=999"):
        referencias._validar_cenario(invalido)

    refs_tmp = tmp_path / "refs"
    saida_tmp = tmp_path / "_saida"
    old_cen, old_ref, old_saida = referencias.PASTA_CENARIOS, referencias.PASTA_REFERENCIAS, referencias.PASTA_SAIDA
    try:
        referencias.PASTA_CENARIOS = cen_dir
        referencias.PASTA_REFERENCIAS = refs_tmp
        referencias.PASTA_SAIDA = saida_tmp

        gen = referencias.gerar_candidata(cid, pasta_saida=saida_tmp)
        assert gen["quadros_chave_gravados"] == ["quadro_0000.png", "quadro_0012.png"]
        assert (saida_tmp / cid / "tira.png").is_file()

        with referencias.autorizar_escrita_referencias():
            apr = referencias.aprovar_candidata(cid, motivo="aprovação de teste", sim=True, pasta_refs=refs_tmp, pasta_saida=saida_tmp)
        assert apr["aprovado"] is True
        assert (refs_tmp / cid / "APROVADO.json").is_file()
        assert (refs_tmp / "APROVACOES.jsonl").is_file()

        # Perfil estrito no mesmo ambiente; deriva quando ffmpeg muda
        assert referencias.perfil_tolerancia(cid, pasta_refs=refs_tmp)["perfil"] == "estrito"
        assert (
            referencias.perfil_tolerancia(
                cid,
                pasta_refs=refs_tmp,
                ambiente_atual={"ffmpeg_version": "ffmpeg-outro", "ffmpeg_buildconf_sha1": "abc"},
            )["perfil"]
            == "deriva"
        )
    finally:
        referencias.PASTA_CENARIOS = old_cen
        referencias.PASTA_REFERENCIAS = old_ref
        referencias.PASTA_SAIDA = old_saida
