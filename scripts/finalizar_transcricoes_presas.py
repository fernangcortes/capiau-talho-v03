# -*- coding: utf-8 -*-
"""
Fecha transcricoes que gravaram no banco mas nao concluiram o pos-processamento.

Quando uma rodada de ASR e interrompida (servidor fechado, 'database is locked',
queda de energia), o video pode ficar num estado meio-termo: as palavras e as
entidades ja estao no SQLite, mas a indexacao no Qdrant, o resumo e a atribuicao
de temas nao rodaram, e o status ficou preso em 'transcribing' ou 'error'.

Re-transcrever esses videos seria pagar de novo a AssemblyAI pelo mesmo audio.
Este script roda SO as etapas seguintes, com custo zero de ASR:

    1. indexacao semantica no Qdrant
    2. geracao de resumo/descricao/tags por IA   (usa o LLM, tem custo)
    3. atribuicao incremental aos temas
    4. status -> 'transcribed'

ATENCAO: a etapa 2 sobrescreve `title`, `description`, `summary` e `tags`. Rode
`python -m scripts.proteger_metadados salvar` antes se houver decupagem feita a
mao, e `restaurar` depois. Use --sem-resumo para pular essa etapa por completo.

O Qdrant tem trava de arquivo exclusiva: o servidor precisa estar parado.

Uso:
    python -m scripts.finalizar_transcricoes_presas --project 2
    python -m scripts.finalizar_transcricoes_presas --project 2 --ids 7,8,12,13,16
    python -m scripts.finalizar_transcricoes_presas --project 2 --dry-run
    python -m scripts.finalizar_transcricoes_presas --project 2 --sem-resumo
"""
from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.db.repositories.narrative import NarrativeRepository
from src.search.semantic import SemanticSearch
from src.services.pipeline import PipelineService


def candidatos(project_id: int, ids: Optional[List[int]]) -> list:
    """Videos com transcricao no banco mas que nao chegaram a 'transcribed'."""
    with get_db() as conn:
        if ids:
            marcas = ",".join("?" * len(ids))
            linhas = conn.execute(
                f"select id, filename, status, video_type, project_id from video "
                f"where project_id = ? and id in ({marcas}) order by id",
                (project_id, *ids),
            ).fetchall()
        else:
            linhas = conn.execute(
                "select id, filename, status, video_type, project_id from video "
                "where project_id = ? and status in ('transcribing','error') order by id",
                (project_id,),
            ).fetchall()

        saida = []
        for r in linhas:
            palavras = conn.execute(
                "select count(*) from transcript where video_id = ?", (r["id"],)
            ).fetchone()[0]
            entidades = conn.execute(
                "select count(*) from transcript_entity where video_id = ?", (r["id"],)
            ).fetchone()[0]
            # Sem palavras nao ha o que finalizar: esse precisa transcrever de verdade.
            if palavras > 0:
                saida.append((r, palavras, entidades))
    return saida


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", type=int, required=True)
    ap.add_argument("--ids", type=str, default=None,
                    help="IDs separados por virgula; sem isso pega todos os presos do projeto.")
    ap.add_argument("--dry-run", action="store_true", help="so lista, nao altera nada")
    ap.add_argument("--sem-resumo", action="store_true",
                    help="pula a geracao de resumo, preservando title/description/summary/tags")
    args = ap.parse_args()

    ids = None
    if args.ids:
        try:
            ids = [int(x) for x in args.ids.split(",") if x.strip()]
        except ValueError:
            print("--ids aceita apenas numeros separados por virgula.", file=sys.stderr)
            return 2

    fila = candidatos(args.project, ids)
    if not fila:
        print("Nenhuma transcricao presa encontrada.")
        return 0

    print(f"{len(fila)} videos com transcricao gravada mas pos-processamento pendente:")
    for r, palavras, entidades in fila:
        print(f"  id={r['id']:<5} {r['status']:<13} {palavras:>6} palavras "
              f"{entidades:>5} entidades  {r['filename'][:44]}")
    print()

    if args.dry_run:
        print("--dry-run: nada foi alterado.")
        return 0

    if args.sem_resumo:
        print("--sem-resumo: title/description/summary/tags serao preservados.")
        print()

    ok, falhas = 0, []
    for r, _palavras, _entidades in fila:
        vid = r["id"]
        print(f"[id={vid}] {r['filename'][:56]}", flush=True)

        try:
            with get_db() as conn:
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, vid)

            SemanticSearch.get_instance().index_transcript_chunks(
                r["project_id"], vid, dialogues, r["video_type"]
            )
            print("        indexado no Qdrant", flush=True)

            if not args.sem_resumo:
                try:
                    PipelineService.generate_video_summary(vid, "interview", r["project_id"])
                    print("        resumo gerado", flush=True)
                except Exception as e:  # noqa: BLE001 - resumo e acessorio
                    print(f"        aviso: resumo falhou ({e})", flush=True)

            try:
                from src.nlp.theme_engine import assign_media_to_themes
                assign_media_to_themes(r["project_id"], video_id=vid)
                print("        temas atribuidos", flush=True)
            except Exception as e:  # noqa: BLE001 - temas sao acessorios
                print(f"        aviso: temas falharam ({e})", flush=True)

            with get_db() as conn:
                MediaRepository.update_video_status(conn, vid, "transcribed")
            print("        status -> transcribed", flush=True)
            ok += 1

        except Exception as e:  # noqa: BLE001 - um video ruim nao para a fila
            print(f"        ERRO: {e}", flush=True)
            falhas.append((vid, str(e)))

    print()
    print(f"=== FIM === {ok} finalizados, {len(falhas)} com erro")
    for vid, msg in falhas:
        print(f"  id={vid}: {msg}")
    return 0 if not falhas else 1


if __name__ == "__main__":
    sys.exit(main())
