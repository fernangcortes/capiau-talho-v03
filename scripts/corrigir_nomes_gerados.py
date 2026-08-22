# -*- coding: utf-8 -*-
"""
Corrige grafias de nome proprio nos textos que a IA gera a partir da transcricao.

O ASR erra nome proprio com frequencia, e o resumo automatico herda o erro: a
legenda ouve "Baiar" no lugar de Bayard, "Wambi" no lugar de Zambier, "Virginia"
no lugar de Virshna. Como `generate_video_summary` reescreve title/description/
summary/tags a cada transcricao, o erro volta toda vez que o video e reprocessado
-- corrigir a mao nao resolve, so adia.

A fonte de verdade dos nomes e a tabela `person`, preenchida pelo usuario.
GRAFIAS_ERRADAS abaixo mapeia o que o ASR costuma ouvir para o nome real.

Uso:
    python -m scripts.corrigir_nomes_gerados --project 2 --dry-run
    python -m scripts.corrigir_nomes_gerados --project 2
    python -m scripts.corrigir_nomes_gerados --project 2 --ids 7,16,19

Depois de rodar, vale conferir com:
    python -m scripts.proteger_metadados conferir
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path
from typing import List, Optional

RAIZ = Path(__file__).resolve().parent.parent
DB = RAIZ / "data" / "capiau.db"

CAMPOS = ("title", "description", "summary", "tags")

# O que o ASR ouve  ->  o nome real (conferido com a tabela person pelo usuario).
# Chave e regex com \b para nao casar dentro de outra palavra.
GRAFIAS_ERRADAS = {
    r"\bBaiar\b": "Bayard",
    r"\bYasmin\b": "Yasmim",
    r"\bWambier\b": "Zambier",
    r"\bWambi\b": "Zambier",
    r"\bVirg[íi]nia\b": "Virshna",
    r"\bEmily Montenegro\b": "Millie",
    r"\bEmily\b": "Millie",
    r"\bJohnny Schneider\b": "Jones Schneider",
    r"\bJohnny\b": "Jones",
    r"\bEmíli[ao] Montenegro\b": "Millie",
    r"\bEmília\b": "Millie",
    r"\bMili\b": "Millie",
    r"\bTiago Mois[ée]s\b": "Thiago Moyses",
    # "Pamela Sheila" saiu de uma brincadeira da entrevistada, que emenda
    # "Mentira" logo depois e se apresenta como Suzana. A IA tomou como fato.
    r"\s*\(Pamela Sheila\)": "",
}


def alvos(conn: sqlite3.Connection, project_id: int, ids: Optional[List[int]]) -> list:
    if ids:
        marcas = ",".join("?" * len(ids))
        return conn.execute(
            f"select id, filename, {', '.join(CAMPOS)} from video "
            f"where project_id = ? and id in ({marcas}) order by id",
            (project_id, *ids),
        ).fetchall()
    return conn.execute(
        f"select id, filename, {', '.join(CAMPOS)} from video "
        f"where project_id = ? order by id",
        (project_id,),
    ).fetchall()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--ids", type=str, default=None, help="IDs separados por virgula")
    ap.add_argument("--dry-run", action="store_true", help="so mostra, nao grava")
    args = ap.parse_args()

    ids = None
    if args.ids:
        try:
            ids = [int(x) for x in args.ids.split(",") if x.strip()]
        except ValueError:
            print("--ids aceita apenas numeros separados por virgula.", file=sys.stderr)
            return 2

    conn = sqlite3.connect(DB, timeout=30)
    conn.row_factory = sqlite3.Row

    trocas_total = 0
    videos_tocados = 0
    pendentes = []

    for r in alvos(conn, args.project, ids):
        novos = {}
        trocas_video = []
        for campo in CAMPOS:
            texto = r[campo]
            if not texto:
                continue
            saida = texto
            for padrao, certo in GRAFIAS_ERRADAS.items():
                achados = re.findall(padrao, saida, flags=re.IGNORECASE)
                if not achados:
                    continue
                saida = re.sub(padrao, certo, saida, flags=re.IGNORECASE)
                for a in achados:
                    trocas_video.append((campo, a, certo))
            if saida != texto:
                novos[campo] = saida

        if not novos:
            continue

        videos_tocados += 1
        trocas_total += len(trocas_video)
        print(f"id={r['id']:<5} {r['filename'][:48]}")
        for campo, achou, certo in trocas_video:
            print(f'    {campo:<12} "{achou}" -> "{certo}"')

        if not args.dry_run:
            sets = ", ".join(f"{c} = ?" for c in novos)
            conn.execute(
                f"update video set {sets} where id = ?",
                (*novos.values(), r["id"]),
            )
            pendentes.append(r["id"])

    if not args.dry_run:
        conn.commit()

    conn.close()
    print()
    if args.dry_run:
        print(f"--dry-run: {trocas_total} correcoes em {videos_tocados} videos (nada gravado).")
    else:
        print(f"{trocas_total} correcoes gravadas em {videos_tocados} videos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
