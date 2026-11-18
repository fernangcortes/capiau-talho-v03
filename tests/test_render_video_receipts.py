"""Testes de Video Receipts JSON por exportação (`src/export/video_render/recibo.py`)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from src.api.routes import narrative
from src.export.video_render import comando, execucao, midia, modelo, recibo


def _tem_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def test_hash_rapido_arquivo_pequeno_e_grande(tmp_path):
    peq = tmp_path / "pequeno.bin"
    peq.write_bytes(b"capiau-talho" * 100)
    h_peq = recibo.hash_rapido_arquivo(peq, limite_completo_bytes=4096)
    assert h_peq is not None
    assert not h_peq.startswith("fast64k:")

    grd = tmp_path / "grande.bin"
    grd.write_bytes(b"A" * 2048 + b"B" * 4096 + b"C" * 2048)
    h_grd = recibo.hash_rapido_arquivo(grd, limite_completo_bytes=4096)
    assert h_grd is not None and h_grd.startswith("fast64k:")
    assert recibo.hash_rapido_arquivo(tmp_path / "nao_existe.bin") is None


@pytest.mark.skipif(not _tem_ffmpeg(), reason="ffmpeg/ffprobe ausentes")
def test_execucao_gera_video_receipt_e_expoe_no_ultimo_render(tmp_path, monkeypatch):
    fonte = tmp_path / "fonte_recibo.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            str(fonte),
        ],
        check=True,
    )

    seq = modelo.normalizar(
        {
            "version": 2,
            "fps": 24,
            "width": 320,
            "height": 180,
            "tracks": [
                {"id": "V1", "kind": "video", "order": 0},
                {"id": "A1", "kind": "audio", "order": 1},
            ],
            "clips": [
                {"id": "v1", "type": "video", "track": "V1", "timeline_start": 0.0, "in": 0.0, "out": 1.5, "video_id": 1},
                {"id": "a1", "type": "audio", "track": "A1", "timeline_start": 0.0, "in": 0.0, "out": 1.5, "video_id": 1},
            ],
        },
        nome="Recibo Teste",
        timeline_id=77,
    )
    dir_saida = tmp_path / "renders"
    pedido = modelo.Pedido(
        timeline_id=77,
        kind="master",
        overrides={"resolution": "320x180", "fps": 24},
        saida=modelo.Saida(diretorio=str(dir_saida), nome_arquivo="saida_recibo.mp4"),
    )

    monkeypatch.setattr("src.media.ffmpeg.get_hardware_settings", lambda *_a, **_kw: ("cpu", "none"))
    orig_resolver = midia.resolver_fontes
    monkeypatch.setattr(
        midia,
        "resolver_fontes",
        lambda s, p, **kw: orig_resolver(
            s,
            p,
            buscar_midia=lambda _t, _i: {"id": 1, "filepath": str(fonte), "duration": 2.0},
            checar_drive=lambda _l: True,
        ),
    )

    res = execucao.executar_agora(seq, pedido)
    assert res["ok"] is True
    destino = dir_saida / "saida_recibo.mp4"
    recibo_path = recibo.caminho_recibo_para(destino)
    assert res["caminho_recibo"] == str(recibo_path)
    assert recibo_path.is_file()

    dados = json.loads(recibo_path.read_text(encoding="utf-8"))
    assert dados["schema_version"] == 1
    assert dados["timeline"]["timeline_id"] == 77
    assert len(dados["timeline"]["sequence_sha256"]) == 64
    assert dados["execucao"]["encoder"] == "libx264"
    assert len(dados["execucao"]["comandos_ffmpeg"]) == 1
    assert len(dados["proveniencia_midia"]) == 2
    assert all(len(item["sha256"]) == 64 for item in dados["proveniencia_midia"])
    assert dados["saida"]["tamanho_bytes"] == destino.stat().st_size
    assert len(dados["saida"]["sha256"]) == 64
    assert dados["saida"]["probe"]["width"] == 320
    assert dados["saida"]["probe"]["height"] == 180
    assert dados["saida"]["probe"]["nb_frames"] == 36

    # Verifica exposição em GET /api/timeline/{id}/render/ultimo
    reg_ultimo = tmp_path / ".ultimo_77.json"
    reg_ultimo.write_text(
        json.dumps({"timeline_id": 77, "task_key": "render_timeline_77", "saida_prevista": str(destino)}),
        encoding="utf-8",
    )
    monkeypatch.setattr(narrative, "_caminho_registro_ultimo", lambda tid: reg_ultimo)
    resp = narrative.ultimo_render_timeline(77)
    assert resp["receipt_path"] == str(recibo_path)
    assert resp["recibo"]["saida"]["sha256"] == dados["saida"]["sha256"]
