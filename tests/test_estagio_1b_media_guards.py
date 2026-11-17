"""Testes do Estagio 1B (SEC-02 / NUV prep): remocao de eval() e guardas configuraveis."""
from __future__ import annotations

import builtins
import json
import os
import subprocess
from pathlib import Path

import pytest

from src.core.storage_guards import (
    _has_readonly_volume_marker,
    check_readonly_destination,
    ensure_writable_destination,
    get_readonly_drives,
    get_readonly_paths,
)
from src.export.audio_stems import _assegurar_destino_seguro
from src.export.video_render.midia import assegurar_destino_seguro
from src.media.audio_chain import _validar_destino, renderizar
from src.media.audio_denoise import denoisar
from src.media.ffmpeg import _parse_frame_rate, get_media_metadata


@pytest.fixture(autouse=True)
def _limpar_env_storage_guards(monkeypatch):
    monkeypatch.delenv("CAPIAU_READONLY_DRIVES", raising=False)
    monkeypatch.delenv("CAPIAU_READONLY_PATHS", raising=False)


# ---------------------------------------------------------------------------
# 1. Parser seguro de frame rate em src/media/ffmpeg.py (fim do eval())
# ---------------------------------------------------------------------------

class TestParseFrameRate:
    @pytest.mark.parametrize(
        "raw, esperado",
        [
            ("24000/1001", 24000 / 1001),
            ("30/1", 30.0),
            ("25/1", 25.0),
            (" 60 / 1 ", 60.0),
            ("29.97", 29.97),
            ("30.0/1.0", 30.0),
            (24, 24.0),
            (23.976, 23.976),
        ],
    )
    def test_entradas_validas(self, raw, esperado):
        assert _parse_frame_rate(raw) == pytest.approx(esperado)

    @pytest.mark.parametrize(
        "raw",
        [
            "0/0",
            "30/0",
            "0/1",
            "0",
            "",
            "   ",
            None,
            False,
            True,
            "-24/1",
            "-29.97",
            "abc",
            "1/2/3",
            "30/",
            "/1",
            "inf",
            "-inf",
            "nan",
            "1e9999999",
            "__import__('os').system('echo pwned')",
        ],
    )
    def test_entradas_invalidas_e_maliciosas_retornam_zero(self, raw, monkeypatch):
        def _proibido(*_args, **_kwargs):
            raise AssertionError("eval() ou os.system() jamais devem ser chamados")

        monkeypatch.setattr(os, "system", _proibido)
        monkeypatch.setattr(builtins, "eval", _proibido)

        assert _parse_frame_rate(raw) == 0.0

    @pytest.mark.parametrize(
        "r_frame_rate, fps_esperado",
        [
            ("24000/1001", 23.976),
            ("30/1", 30.0),
            ("0/0", 0.0),
            ("__import__('os').system('echo pwned')", 0.0),
        ],
    )
    def test_get_media_metadata_usa_parser_seguro(
        self, r_frame_rate, fps_esperado, monkeypatch, tmp_path
    ):
        def _proibido(*_args, **_kwargs):
            raise AssertionError("eval() ou os.system() jamais devem ser chamados")

        monkeypatch.setattr(os, "system", _proibido)
        monkeypatch.setattr(builtins, "eval", _proibido)

        payload_ffprobe = {
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": r_frame_rate,
                }
            ],
            "format": {"duration": "12.5", "bit_rate": "5000000"},
        }

        def _fake_run(cmd, **_kwargs):
            return subprocess.CompletedProcess(
                cmd, 0, stdout=json.dumps(payload_ffprobe), stderr=""
            )

        monkeypatch.setattr(subprocess, "run", _fake_run)

        meta = get_media_metadata(tmp_path / "clipe.mp4")
        assert meta["fps"] == fps_esperado
        assert meta["duration"] == 12.5
        assert meta["resolution"] == "1920x1080"
        assert meta["codec"] == "h264"


# ---------------------------------------------------------------------------
# 2. Guardas configuraveis de armazenamento somente leitura (storage_guards)
# ---------------------------------------------------------------------------

class TestStorageGuards:
    def test_default_preserva_drive_f_sem_env(self):
        assert get_readonly_drives() == ("F",)
        motivo = check_readonly_destination("F:/acervo/bruto/saida.wav")
        assert motivo is not None
        assert "somente leitura" in motivo
        assert "F:/" in motivo

        with pytest.raises(ValueError, match="somente leitura"):
            ensure_writable_destination("F:/acervo/nova_pasta")

    def test_capiau_readonly_drives_vazio_libera_drive_f(self, monkeypatch):
        monkeypatch.setenv("CAPIAU_READONLY_DRIVES", "")
        assert get_readonly_drives() == ()
        assert check_readonly_destination("F:/qualquer/pasta/saida.wav") is None

    def test_capiau_readonly_drives_customizado(self, monkeypatch):
        monkeypatch.setenv("CAPIAU_READONLY_DRIVES", "d:, G:/ ; d")
        assert get_readonly_drives() == ("D", "G")

        motivo_d = check_readonly_destination("D:/bruto/clip.wav")
        motivo_g = check_readonly_destination("g:/bruto/clip.wav")
        assert motivo_d is not None and "D:/" in motivo_d and "somente leitura" in motivo_d
        assert motivo_g is not None and "G:/" in motivo_g and "somente leitura" in motivo_g
        assert check_readonly_destination("F:/livre/clip.wav") is None

    def test_capiau_readonly_paths_bloqueia_qualquer_diretorio_os_independente(
        self, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("CAPIAU_READONLY_DRIVES", "")
        ro1 = tmp_path / "acervo_1"
        ro2 = tmp_path / "acervo_2"
        sibling = tmp_path / "acervo_1_derivados"
        ro1.mkdir()
        ro2.mkdir()

        monkeypatch.setenv("CAPIAU_READONLY_PATHS", os.pathsep.join([str(ro1), str(ro2)]))
        assert get_readonly_paths() == (ro1.resolve(), ro2.resolve())

        for alvo in (ro1, ro1 / "sub" / "stem.wav", ro2 / "out"):
            motivo = check_readonly_destination(alvo)
            assert motivo is not None
            assert "somente leitura" in motivo

        with pytest.raises(ValueError, match="somente leitura"):
            ensure_writable_destination(ro1 / "sub_nao_criada")
        assert not (ro1 / "sub_nao_criada").exists()

        # Mesmo prefixo textual sem ser subpasta nao pode ser bloqueado
        assert check_readonly_destination(sibling / "ok.wav") is None
        criado = ensure_writable_destination(sibling)
        assert criado == sibling.resolve() and criado.is_dir()

    def test_marcador_capiau_volume_read_only_true_bloqueia_ancestrais(self, tmp_path):
        vol_ro = tmp_path / "hd_bruto"
        vol_ro.mkdir()
        (vol_ro / ".capiau-volume").write_text(
            json.dumps({"id": "vol-1", "label": "Acervo Bruto", "read_only": True}),
            encoding="utf-8",
        )

        destino_aninhado = vol_ro / "dia_01" / "renders" / "saida.wav"
        marcador = _has_readonly_volume_marker(destino_aninhado)
        assert marcador == (vol_ro / ".capiau-volume").resolve()

        motivo = check_readonly_destination(destino_aninhado)
        assert motivo is not None
        assert "somente leitura" in motivo
        assert str(vol_ro.resolve()) in motivo

        with pytest.raises(ValueError, match="somente leitura"):
            ensure_writable_destination(vol_ro / "nova_pasta")
        assert not (vol_ro / "nova_pasta").exists()

    def test_marcador_capiau_volume_read_only_false_permite_escrita(self, tmp_path):
        vol_rw = tmp_path / "hd_trabalho"
        vol_rw.mkdir()
        (vol_rw / ".capiau-volume").write_text(
            json.dumps({"id": "vol-2", "label": "Trabalho", "read_only": False}),
            encoding="utf-8",
        )

        destino = vol_rw / "renders" / "sub"
        assert _has_readonly_volume_marker(destino) is None
        assert check_readonly_destination(destino) is None
        criado = ensure_writable_destination(destino)
        assert criado == destino.resolve() and criado.is_dir()

    def test_marcador_capiau_readonly_bloqueia_ancestrais(self, tmp_path):
        raiz = tmp_path / "volume_sentinela"
        raiz.mkdir()
        (raiz / ".capiau-readonly").write_text("", encoding="utf-8")

        alvo = raiz / "sub" / "arquivo.wav"
        assert _has_readonly_volume_marker(alvo) == (raiz / ".capiau-readonly").resolve()
        motivo = check_readonly_destination(alvo)
        assert motivo is not None and "somente leitura" in motivo


# ---------------------------------------------------------------------------
# 3. Delegacao dos 4 consumidores sem duplicacao
# ---------------------------------------------------------------------------

class TestConsumidoresDelegamStorageGuards:
    def test_audio_stems_e_video_render_delegam_a_ensure_writable_destination(
        self, monkeypatch, tmp_path
    ):
        ro_dir = tmp_path / "acervo_ro"
        ro_dir.mkdir()
        (ro_dir / ".capiau-volume").write_text(
            json.dumps({"read_only": True}), encoding="utf-8"
        )

        with pytest.raises(ValueError, match="somente leitura"):
            _assegurar_destino_seguro(ro_dir / "stems")
        with pytest.raises(ValueError, match="somente leitura"):
            assegurar_destino_seguro(ro_dir / "renders")

        ro_env = tmp_path / "bloqueado_env"
        ro_env.mkdir()
        monkeypatch.setenv("CAPIAU_READONLY_PATHS", str(ro_env))
        with pytest.raises(ValueError, match="somente leitura"):
            _assegurar_destino_seguro(ro_env / "stems")
        with pytest.raises(ValueError, match="somente leitura"):
            assegurar_destino_seguro(ro_env / "renders")

        writable = tmp_path / "gravavel"
        assert _assegurar_destino_seguro(writable / "stems").is_dir()
        assert assegurar_destino_seguro(writable / "renders").is_dir()

    def test_audio_denoise_e_audio_chain_delegam_a_check_readonly_destination(
        self, monkeypatch, tmp_path
    ):
        origem = tmp_path / "origem.wav"
        origem.write_bytes(b"RIFF-fake")

        vol_ro = tmp_path / "vol_ro"
        vol_ro.mkdir()
        (vol_ro / ".capiau-volume").write_text(
            json.dumps({"read_only": True}), encoding="utf-8"
        )

        res_denoise = denoisar(origem, vol_ro / "tratado.wav", 12.0)
        assert res_denoise["ok"] is False
        assert "somente leitura" in res_denoise["erro"]

        res_chain = renderizar(origem, vol_ro / "chain.wav", 0, 1, ["adeclip"])
        assert res_chain["ok"] is False
        assert "somente leitura" in res_chain["erro"]

        ro_env = tmp_path / "env_ro"
        ro_env.mkdir()
        monkeypatch.setenv("CAPIAU_READONLY_PATHS", str(ro_env))
        assert "somente leitura" in (_validar_destino(ro_env / "x.wav", origem) or "")

        # Provar que liberar CAPIAU_READONLY_DRIVES="" remove o bloqueio de F:/ nos consumidores
        monkeypatch.setenv("CAPIAU_READONLY_DRIVES", "")
        assert _validar_destino("F:/livre/chain.wav", origem) is None
        res_denoise_f = denoisar(tmp_path / "inexistente.wav", "F:/livre/denoise.wav", 12.0)
        assert res_denoise_f["ok"] is False
        assert "nao encontrado" in res_denoise_f["erro"]
