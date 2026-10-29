"""Camada 1 do áudio: natureza do material pelo arquivo (docs/planos/PLANO_AUDIO_CATEGORIAS.md).

Fixtures geradas pelo ffmpeg na hora (tom, imagem parada, vídeo em movimento, capa
de MP3). Sem ffmpeg no PATH os testes são pulados. Nada aqui toca o banco real.
"""
import contextlib
import shutil
import sqlite3
import subprocess

import pytest

from src.db.schema import SCHEMA_SQL
from src.media.natureza import detectar_natureza

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
                                reason="ffmpeg/ffprobe fora do PATH")

TOM = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000"]


def _ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture(scope="module")
def arquivos(tmp_path_factory):
    d = tmp_path_factory.mktemp("natureza")
    a = {nome: d / nome for nome in ("tom.wav", "parada.mp4", "movimento.mp4", "capa.mp3",
                                     "parada_muda.mp4", "parada_curta.mp4", "capa.png")}
    _ffmpeg(*TOM, "-t", "3", str(a["tom.wav"]))
    _ffmpeg("-f", "lavfi", "-i", "color=c=navy:s=320x180:r=25", *TOM, "-t", "8", "-shortest",
            "-pix_fmt", "yuv420p", str(a["parada.mp4"]))
    _ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25", *TOM, "-t", "8", "-shortest",
            "-pix_fmt", "yuv420p", str(a["movimento.mp4"]))
    _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", str(a["capa.png"]))
    _ffmpeg(*TOM, "-i", str(a["capa.png"]), "-t", "3", "-map", "0:a", "-map", "1:v", "-c:v", "png",
            "-disposition:v", "attached_pic", str(a["capa.mp3"]))
    _ffmpeg("-f", "lavfi", "-i", "color=c=navy:s=320x180:r=25", "-t", "8", "-pix_fmt", "yuv420p",
            str(a["parada_muda.mp4"]))
    _ffmpeg("-f", "lavfi", "-i", "color=c=navy:s=320x180:r=25", *TOM, "-t", "1", "-shortest",
            "-pix_fmt", "yuv420p", str(a["parada_curta.mp4"]))
    return a


@pytest.mark.parametrize("nome, esperado", [
    ("tom.wav", "audio"),          # sem faixa de imagem
    ("parada.mp4", "audio"),       # imagem parada com som (o caso do vídeo 555)
    ("capa.mp3", "audio"),         # capa embutida não é imagem do material
    ("movimento.mp4", "video"),
    ("parada_muda.mp4", "video"),  # sem som não é material de áudio
    ("parada_curta.mp4", "video"), # curto demais para concluir
])
def test_natureza_pelo_arquivo(arquivos, nome, esperado):
    assert detectar_natureza(arquivos[nome]) == esperado


def test_arquivo_ilegivel_fica_video(tmp_path):
    assert detectar_natureza(tmp_path / "nao_existe.mp4") == "video"


def test_ingestao_grava_a_natureza_da_imagem_parada(arquivos, monkeypatch):
    from src.services import ingest as mod
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA_SQL)
    conn.execute("INSERT INTO project (id, name) VALUES (1, 'p')")
    for vid, nome in ((1, "parada.mp4"), (2, "movimento.mp4")):
        conn.execute("INSERT INTO video (id, project_id, filename, filepath, hash) VALUES (?, 1, ?, ?, ?)",
                     (vid, nome, str(arquivos[nome]), f"h{vid}"))

    @contextlib.contextmanager
    def get_db_falso():
        yield conn

    monkeypatch.setattr(mod, "get_db", get_db_falso)
    mod.IngestService._registrar_natureza(1, arquivos["parada.mp4"])
    mod.IngestService._registrar_natureza(2, arquivos["movimento.mp4"])
    nat = dict(conn.execute("SELECT id, natureza FROM video").fetchall())
    assert nat == {1: "audio", 2: "video"}
