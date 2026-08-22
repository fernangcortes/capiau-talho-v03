# -*- coding: utf-8 -*-
"""
Registra a entrevista da Luciana no banco e adota o proxy ja gerado por fora.

O proxy e gerado antes, fora do servidor, com os mesmos parametros do Talho
(CONFIG.PROXY_RESOLUTION / PROXY_PRESET / PROXY_CRF), e salvo como
`data/proxies/_tmp_luciana.mp4`. Este script so faz o trabalho leve:
insere o registro, descobre o id atribuido e renomeia o proxy para o padrao
`proxy_vid_<id>.mp4`.

Uso:
    python -m scripts.finalizar_luciana
"""
from __future__ import annotations

import sqlite3
import subprocess
import sys
import hashlib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DB = RAIZ / "data" / "capiau.db"
PROXIES = RAIZ / "data" / "proxies"
TMP = PROXIES / "_tmp_luciana.mp4"

ORIGINAL = ("F:/Making Off - O Monstro/Entrevistas/entrevistas-completas/"
            "entrevista-atriz-luciana.mov")
FILENAME = "entrevista-atriz-luciana.mov"
PROJECT_ID = 2
TITULO = "Luciana: entrevista"
DESCRICAO = ("Entrevista com a atriz Luciana. Ingerida em 22/08/2026 a partir do HD F:. "
             "Proxy gerado por fora do servidor com os parametros padrao do Talho "
             "(1280x720, libx264 preset fast, crf 23, aac 128k).")


def ffprobe(campos: str, entrada: str, stream: bool = False) -> str:
    cmd = ["ffprobe", "-v", "error"]
    if stream:
        cmd += ["-select_streams", "v:0"]
    cmd += ["-show_entries", campos, "-of", "default=nw=1:nk=1", entrada]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120).stdout.strip()


def hash_parcial(caminho: str) -> str:
    """Mesma regra do IngestService.compute_hash: sha256 dos primeiros 10 MB."""
    h = hashlib.sha256()
    lidos = 0
    with open(caminho, "rb") as f:
        while lidos < 10 * 1024 * 1024:
            bloco = f.read(65536)
            if not bloco:
                break
            h.update(bloco)
            lidos += len(bloco)
    return h.hexdigest()[:32]


def main() -> int:
    if not TMP.exists():
        print(f"Proxy nao encontrado: {TMP}")
        print("Gere o proxy antes de rodar este script.")
        return 1
    if not Path(ORIGINAL).exists():
        print(f"Original nao encontrado: {ORIGINAL}")
        print("O HD F: precisa estar conectado.")
        return 1

    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row

    ja = conn.execute("select id from video where filename=?", (FILENAME,)).fetchone()
    if ja:
        print(f"A Luciana ja esta no banco com id={ja['id']}. Nada a fazer.")
        conn.close()
        return 0

    dur = float(ffprobe("format=duration", ORIGINAL))
    fps_raw = ffprobe("stream=r_frame_rate", ORIGINAL, stream=True)
    num, den = (fps_raw.split("/") + ["1"])[:2]
    fps = float(num) / float(den)
    largura = ffprobe("stream=width", ORIGINAL, stream=True)
    altura = ffprobe("stream=height", ORIGINAL, stream=True)
    codec = ffprobe("stream=codec_name", ORIGINAL, stream=True)
    bitrate_raw = ffprobe("format=bit_rate", ORIGINAL)
    bitrate = int(bitrate_raw) if bitrate_raw.isdigit() else None

    cur = conn.cursor()
    cur.execute(
        "insert into video (project_id, filename, filepath, hash, video_type, duration, "
        "fps, resolution, codec, bitrate, status, title, description, category) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (PROJECT_ID, FILENAME, ORIGINAL, hash_parcial(ORIGINAL), "interview", dur,
         fps, f"{largura}x{altura}", codec, bitrate, "ingested",
         TITULO, DESCRICAO, "depoimento"),
    )
    novo_id = cur.lastrowid
    conn.commit()

    destino = PROXIES / f"proxy_vid_{novo_id}.mp4"
    TMP.rename(destino)

    print(f"Luciana registrada com id={novo_id}")
    print(f"  duracao   : {dur:.1f}s ({dur / 60:.1f} min)")
    print(f"  resolucao : {largura}x{altura} @ {fps:.3f} fps")
    print(f"  codec     : {codec}")
    print(f"  proxy     : {destino.name} ({destino.stat().st_size / 1048576:.0f} MB)")
    print(f"  proxy dur : {ffprobe('format=duration', str(destino))}s")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
