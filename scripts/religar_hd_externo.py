# -*- coding: utf-8 -*-
"""
Religa o acervo do Making Of quando o HD externo voltar a ser conectado.

Contexto: os brutos das entrevistas vivem em
    <DRIVE>:/Making Off - O Monstro/Entrevistas/entrevistas-completas/
e o banco `data/capiau.db` guarda esse caminho em `video.filepath` com a letra F:.
Se o Windows montar o disco com outra letra, os caminhos do banco quebram.

Uso:
    python -m scripts.religar_hd_externo              # so diagnostica, nao grava nada
    python -m scripts.religar_hd_externo --aplicar    # grava as correcoes de caminho

Este script NAO renomeia arquivos. Veja a nota em RENOMEAR_ARQUIVOS no fim.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import string
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DB = RAIZ / "data" / "capiau.db"
PROXIES = RAIZ / "data" / "proxies"
SUBPASTA = "Making Off - O Monstro/Entrevistas/entrevistas-completas"

# clipes que dependem do HD para ficarem completos
PENDENTES = {
    "entrevista-atriz-luciana.mov": "nunca foi ingerida no Talho; 5 cortes na timeline do Kdenlive",
    "entrevista-maquiagem-milli-e-patricia.mov": "proxy local cobre so 472s de 726.8s (65%)",
}


def achar_drive() -> Path | None:
    """Procura a pasta do acervo em todas as letras de unidade montadas."""
    for letra in string.ascii_uppercase:
        alvo = Path(f"{letra}:/") / SUBPASTA
        if alvo.is_dir():
            return alvo
    return None


def duracao(caminho: Path) -> float | None:
    """Duracao em segundos via ffprobe, ou None se nao der para ler."""
    try:
        saida = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(caminho)],
            capture_output=True, text=True, timeout=60,
        ).stdout.strip()
        return float(saida)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true",
                    help="grava as correcoes de caminho no banco (sem isso, so mostra)")
    args = ap.parse_args()

    acervo = achar_drive()
    if acervo is None:
        print("O HD do acervo nao esta conectado.")
        print(f"Procurei por '{SUBPASTA}' em todas as unidades montadas.")
        return 1

    letra = str(acervo)[0]
    print(f"Acervo encontrado em: {acervo}")
    print(f"Letra da unidade    : {letra}:")
    print()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    linhas = conn.execute(
        "select id, filename, filepath, duration, title from video "
        "where filepath like '%entrevistas-completas%' order by id"
    ).fetchall()

    corrigir: list[tuple[str, int]] = []
    print(f"{'id':<4} {'arquivo':<45} {'disco':<8} {'caminho':<9} obs")
    print("-" * 96)
    for r in linhas:
        novo = str(acervo / r["filename"]).replace("\\", "/")
        existe = os.path.exists(novo)
        precisa = novo != r["filepath"]
        if existe and precisa:
            corrigir.append((novo, r["id"]))
        obs = PENDENTES.get(r["filename"], "")
        print(f"{r['id']:<4} {r['filename'][:45]:<45} "
              f"{'ok' if existe else 'AUSENTE':<8} "
              f"{'corrigir' if precisa else 'ok':<9} {obs}")

    print()
    if corrigir:
        if args.aplicar:
            conn.executemany("update video set filepath=? where id=?", corrigir)
            conn.commit()
            print(f"{len(corrigir)} caminhos corrigidos no banco.")
        else:
            print(f"{len(corrigir)} caminhos precisam de correcao. "
                  f"Rode de novo com --aplicar para gravar.")
    else:
        print("Todos os caminhos do banco ja estao corretos.")

    # confere os dois pendentes conhecidos
    print()
    print("=== PENDENCIAS QUE O HD RESOLVE ===")
    for nome, motivo in PENDENTES.items():
        alvo = acervo / nome
        if not alvo.exists():
            print(f"  {nome}: AINDA NAO ENCONTRADO no acervo ({motivo})")
            continue
        d = duracao(alvo)
        linha = conn.execute("select id from video where filename=?", (nome,)).fetchone()
        vid = linha["id"] if linha else None
        proxy = PROXIES / f"proxy_vid_{vid}.mp4" if vid else None
        dp = duracao(proxy) if proxy and proxy.exists() else None
        if d and dp and dp < d * 0.98:
            print(f"  {nome}: original {d:.0f}s, proxy {dp:.0f}s "
                  f"({100 * dp / d:.0f}%) -> REGERAR o proxy")
        elif vid is None:
            print(f"  {nome}: arquivo existe mas nao esta no banco -> INGERIR no Talho")
        else:
            print(f"  {nome}: ok")

    conn.close()
    return 0


# NOTA SOBRE RENOMEAR OS ARQUIVOS
# -------------------------------
# E tentador renomear os brutos para bater com quem realmente fala neles
# (JUNCAO_1780253665735.mp4 -> entrevista-som-bruno-zambier.mp4, e assim por diante).
# Nao faca isso sem tratar os projetos do Kdenlive junto: os arquivos
# .kdenlive em Desktop/mkof-monstro referenciam os nomes ANTIGOS, e renomear
# no disco quebraria todos os links de novo — o mesmo problema que motivou
# este script.
#
# Se um dia for renomear, os tres lugares tem que mudar na mesma passada:
#   1. o arquivo no HD
#   2. video.filename e video.filepath no capiau.db
#   3. resource / kdenlive:originalurl / kdenlive:proxy em cada .kdenlive
#
# Enquanto isso nao acontecer, a identificacao correta de cada entrevista vive
# em video.title e video.description, que ja estao preenchidos e nao quebram nada.

if __name__ == "__main__":
    sys.exit(main())
