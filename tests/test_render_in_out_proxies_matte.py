"""Testes de ponta a ponta para render com faixa In/Out parcial, proxies e color_matte.

Valida a correção do bug onde cortes In/Out geravam opções de filtro 'fade' com
st negativo no FFmpeg ('Value ... for parameter st out of range: Result too large')
e garante a integridade da composição de cor sólida lavfi combinada com pistas de vídeo.
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
import pytest

from src.export.video_render import modelo, comando, grafo_video, midia
from src.api.routes import narrative


def _tem_ffmpeg():
    return shutil.which("ffmpeg") is not None


def test_in_out_com_fade_in_ultrapassado_nao_emite_st_negativo():
    """Garante que quando o IN do export está após o término do fade-in, nenhum filtro inválido é gerado."""
    seq = modelo.normalizar({
        "version": 2, "fps": 30, "width": 1280, "height": 720,
        "tracks": [{"id": "V1", "kind": "video", "order": 0}],
        "clips": [{
            "id": "c1", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 40.0,
            "video_id": 100,
            "effects": [{"type": "crossfade", "side": "in", "duration_s": 2.5}]
        }]
    })

    faixa = modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=15.0, fim_s=20.0)
    pedido = modelo.Pedido(timeline_id=1, faixa=faixa)

    g = grafo_video.grafo_completo(seq, pedido.escopo, 15.0, 20.0)
    fc = g["filter_complex"]
    assert "fade=t=in" not in fc
    assert "st=-" not in fc


def test_in_out_cortando_meio_do_fade_in_usa_geq_sem_quebrar_ffmpeg():
    """Quando o IN cai no meio do fade-in, deve usar geq e ser executável no FFmpeg."""
    seq = modelo.normalizar({
        "version": 2, "fps": 30, "width": 320, "height": 240,
        "tracks": [{"id": "V1", "kind": "video", "order": 0}],
        "clips": [{
            "id": "c1", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 10.0,
            "video_id": 100,
            "effects": [{"type": "crossfade", "side": "in", "duration_s": 4.0}]
        }]
    })

    # In em 2.0s: o fade-in vai até 4.0s (restam 2s de fade no stream [0, 3s])
    g = grafo_video.grafo_completo(seq, modelo.Escopo(), 2.0, 5.0)
    fc = g["filter_complex"]
    assert "fade=t=in:st=-" not in fc
    assert "geq=" in fc

    if _tem_ffmpeg():
        # Testa sintaxe real no FFmpeg
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=red:s=320x240:r=30:d=3",
            "-filter_complex", fc.replace("0:v", "0:v"),
            "-map", "[vout]", "-t", "3", "-f", "null", "-"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        assert res.returncode == 0, f"FFmpeg falhou com: {res.stderr}"


def test_in_out_com_color_matte_e_proxies_montagem_completa():
    """Valida a combinação exata reportada: color_matte (V2) sobre vídeo (V1) com proxies e faixa In/Out."""
    seq = modelo.normalizar({
        "version": 2, "fps": 24, "width": 1280, "height": 720,
        "tracks": [
            {"id": "V2", "kind": "video", "order": 0},
            {"id": "V1", "kind": "video", "order": 1},
            {"id": "A1", "kind": "audio", "order": 2},
        ],
        "clips": [
            {
                "id": "v1_video", "track": "V1", "timeline_start": 50.0, "in": 10.0, "out": 50.0,
                "video_id": 357,
                "effects": [{"type": "crossfade", "side": "in", "duration_s": 2.0}]
            },
            {
                "id": "v2_matte", "track": "V2", "timeline_start": 75.0, "in": 0.0, "out": 5.0,
                "kind": "color_matte", "color": "#0047bb", "blend_mode": "multiply",
                "effects": [
                    {"type": "fit", "mode": "fill"},
                    {"type": "crossfade", "side": "in", "duration_s": 1.5, "curve": "custom", "tension": 0.2},
                    {"type": "crossfade", "side": "out", "duration_s": 1.5, "curve": "custom", "tension": 0.2},
                ]
            },
            {
                "id": "a1_audio", "track": "A1", "timeline_start": 50.0, "in": 10.0, "out": 50.0,
                "video_id": 357,
                "effects": [{"type": "crossfade", "side": "in", "duration_s": 2.0}]
            }
        ]
    })

    pedido = modelo.Pedido(
        timeline_id=54,
        kind="master",
        faixa=modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=74.0, fim_s=78.0),
        usar_proxies=True
    )

    with tempfile.TemporaryDirectory() as tmpdir:
        fake_proxy = Path(tmpdir) / "proxy_vid_357.mp4"
        fake_proxy.write_bytes(b"dummy")

        def buscar_midia(tipo, midia_id):
            return {
                "id": midia_id, "filepath": str(fake_proxy),
                "proxy_path": str(fake_proxy), "duration": 60.0
            }

        rel_midia = midia.resolver_fontes(seq, pedido, buscar_midia=buscar_midia)
        assert not rel_midia.recusas
        assert rel_midia.fontes["v1_video"].classe == "proxy"
        assert rel_midia.fontes["v2_matte"].classe == "gerador"

        cmd_res = comando.montar_comando(
            seq, pedido, Path(tmpdir) / "out.mp4",
            rel_midia=rel_midia, inicio_s=74.0, fim_s=78.0
        )

        fc = cmd_res["cmd"][cmd_res["cmd"].index("-filter_complex") + 1]
        assert "st=-" not in fc
        assert "fade=t=in:st=-" not in fc
        assert "color=c=0x0047bb" in fc.lower()
        assert "blend=all_mode=" not in fc
        assert grafo_video._filtro_lut2_blend("multiply") in fc


def test_api_ultimo_render_timeline_estrutura_retorno(tmp_path, monkeypatch):
    """Garante que ultimo_render_timeline expõe output_path e tamanho_mb sem quebrar a UI em [object Object]."""
    json_path = tmp_path / ".ultimo_99.json"
    dummy_out = tmp_path / "video_teste.mp4"
    dummy_out.write_bytes(b"0" * (2 * 1024 * 1024))  # 2MB

    registro = {
        "timeline_id": 99,
        "task_key": "render_timeline_99",
        "saida_prevista": str(dummy_out)
    }
    json_path.write_text(json.dumps(registro), encoding="utf-8")

    monkeypatch.setattr(narrative, "_caminho_registro_ultimo", lambda tid: json_path)

    resp = narrative.ultimo_render_timeline(99)
    assert resp["ok"] is True
    assert resp["timeline_id"] == 99
    assert resp["output_path"] == str(dummy_out)
    assert resp["tamanho_mb"] == 2.0
    assert isinstance(resp["arquivo"], dict)
    assert resp["arquivo"]["path"] == str(dummy_out)
    assert resp["arquivo"]["existe"] is True


def test_in_out_execucao_real_ffmpeg_com_matte_e_video(tmp_path):
    """Execução real do FFmpeg gerando MP4 válido com proxy de vídeo, color_matte e In/Out restrito."""
    if not _tem_ffmpeg():
        pytest.skip("FFmpeg não disponível no sistema")

    dummy_media = tmp_path / "proxy_vid_1.mp4"
    # Gera mídia de teste real rápida com vídeo e áudio
    init_cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=4",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(dummy_media)
    ]
    subprocess.run(init_cmd, check=True)

    seq = modelo.normalizar({
        "version": 2, "fps": 24, "width": 320, "height": 240,
        "tracks": [
            {"id": "V2", "kind": "video", "order": 0},
            {"id": "V1", "kind": "video", "order": 1},
            {"id": "A1", "kind": "audio", "order": 2},
        ],
        "clips": [
            {
                "id": "c_v1", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 4.0,
                "video_id": 1,
                "effects": [{"type": "crossfade", "side": "in", "duration_s": 1.0}]
            },
            {
                "id": "c_a1", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 4.0,
                "video_id": 1,
                "effects": [{"type": "crossfade", "side": "in", "duration_s": 1.0}]
            },
            {
                "id": "c_v2", "track": "V2", "timeline_start": 1.5, "in": 0.0, "out": 2.0,
                "kind": "color_matte", "color": "#ff0000", "blend_mode": "multiply",
                "effects": [
                    {"type": "crossfade", "side": "in", "duration_s": 0.5},
                    {"type": "crossfade", "side": "out", "duration_s": 0.5},
                ]
            }
        ]
    })

    # In/Out de 1.2s a 3.0s: corta no meio do clipe V1 (fade-in já concluído) e cobre o matte V2
    pedido = modelo.Pedido(
        timeline_id=10,
        kind="master",
        faixa=modelo.Faixa(modo=modelo.MODO_FAIXA_IN_OUT, inicio_s=1.2, fim_s=3.0),
        usar_proxies=True
    )

    def buscar_midia(tipo, midia_id):
        return {"id": midia_id, "filepath": str(dummy_media), "proxy_path": str(dummy_media), "duration": 4.0}

    rel_midia = midia.resolver_fontes(seq, pedido, buscar_midia=buscar_midia)
    out_mp4 = tmp_path / "resultado.mp4"
    cmd_res = comando.montar_comando(seq, pedido, out_mp4, rel_midia=rel_midia, inicio_s=1.2, fim_s=3.0)

    p = subprocess.run(cmd_res["cmd"], capture_output=True, text=True)
    assert p.returncode == 0, f"FFmpeg falhou com código {p.returncode}: {p.stderr}"
    assert out_mp4.exists()
    assert out_mp4.stat().st_size > 1000

