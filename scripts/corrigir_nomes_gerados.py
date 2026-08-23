# -*- coding: utf-8 -*-
"""
Corrige grafias de nome proprio no que JA ESTA GRAVADO de rodadas antigas.

Desde 22/08/2026 a correcao roda dentro do pipeline, antes da gravacao (ver
src/nlp/name_fixer.py), entao texto novo ja nasce certo. Este script continua
util para o acervo transcrito antes disso.

O mapa de grafias vive em src/nlp/name_fixer.py -- um so lugar para os dois
caminhos. A fonte de verdade dos nomes e a tabela `person`.

As correcoes passam por MediaRepository.update_video_metadata, entao entram no
historico de decupagem (origem 'humano') e sao reversiveis pela interface.

Uso:
    python -m scripts.corrigir_nomes_gerados --project 2 --dry-run
    python -m scripts.corrigir_nomes_gerados --project 2
    python -m scripts.corrigir_nomes_gerados --project 2 --ids 7,16,19

Depois de rodar, vale conferir com:
    python -m scripts.proteger_metadados conferir
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import List, Optional

RAIZ = Path(__file__).resolve().parent.parent
if str(RAIZ) not in sys.path:
    sys.path.insert(0, str(RAIZ))

from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.nlp.name_fixer import carregar_regras, corrigir_texto, semear

DB = RAIZ / "data" / "capiau.db"

CAMPOS = ("title", "description", "summary", "tags")

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


def semear_e_relatar(conn: sqlite3.Connection, project_id: int, tabela: str, dry_run: bool) -> int:
    """Mostra (e opcionalmente grava) o mapa embutido nos aliases do catalogo."""
    resultado = semear(conn, project_id, tabela, aplicar=not dry_run)

    print(f"Semeadura em `{tabela}` do projeto {project_id}:\n")
    for corpo, certo, dono in resultado["casadas"]:
        print(f'    "{corpo}" -> "{certo}"   (em: {dono})')

    if resultado["orfas"]:
        print("\n  Sem dono no catalogo -- continuam so na semente do codigo:")
        for corpo, certo in resultado["orfas"]:
            print(f'    "{corpo}" -> "{certo}"')

    print()
    if dry_run:
        print(f"--dry-run: {len(resultado['casadas'])} regra(s) seriam gravadas (nada gravado).")
    else:
        conn.commit()
        print(f"{resultado['gravadas']} regra(s) novas gravadas em `{tabela}`. "
              f"A partir de agora o banco manda: editar um nome nao exige mexer em codigo.")
    conn.close()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--ids", type=str, default=None, help="IDs separados por virgula")
    ap.add_argument("--dry-run", action="store_true", help="so mostra, nao grava")
    ap.add_argument("--semear", action="store_true",
                    help="Leva o mapa embutido para os aliases de person, para o "
                         "mapa deixar de morar no codigo. Combine com --dry-run "
                         "para so ver o que faria.")
    ap.add_argument("--tabela", choices=("person", "entity"), default="person",
                    help="Onde semear os aliases (padrao: person).")
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

    if args.semear:
        return semear_e_relatar(conn, args.project, args.tabela, args.dry_run)

    # As regras saem dos aliases do banco; sem nenhum cadastrado, da semente
    regras = carregar_regras(args.project, conn)

    trocas_total = 0
    videos_tocados = 0
    pendentes = []

    for r in alvos(conn, args.project, ids):
        novos = {}
        trocas_video = []
        for campo in CAMPOS:
            # tags e coluna JSON em texto; corrigir a string crua preserva o formato
            saida, trocas = corrigir_texto(r[campo], campo, regras)
            trocas_video.extend(trocas)
            if saida != r[campo]:
                novos[campo] = saida

        if not novos:
            continue

        videos_tocados += 1
        trocas_total += len(trocas_video)
        print(f"id={r['id']:<5} {r['filename'][:48]}")
        for campo, achou, certo in trocas_video:
            print(f'    {campo:<12} "{achou}" -> "{certo}"')

        if not args.dry_run:
            # Passa pelo repositorio, e nao por SQL cru: assim a versao anterior
            # vai para video_metadata_history e da para desfazer pela interface.
            with get_db() as gravacao:
                MediaRepository.update_video_metadata(
                    gravacao,
                    r["id"],
                    description=novos.get("description", r["description"]) or "",
                    summary=novos.get("summary", r["summary"]) or "",
                    tags=MediaRepository._parse_tags(novos.get("tags", r["tags"])),
                    title=novos.get("title", r["title"]),
                    origem="humano",
                )
                gravacao.commit()
            pendentes.append(r["id"])

    conn.close()
    print()
    if args.dry_run:
        print(f"--dry-run: {trocas_total} correcoes em {videos_tocados} videos (nada gravado).")
    else:
        print(f"{trocas_total} correcoes gravadas em {videos_tocados} videos "
              f"(versoes anteriores guardadas no historico de decupagem).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
