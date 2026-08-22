"""Worker de transcricao ASR em lote, FORA do processo do servidor web.

Uso:
    python -m src.worker_transcricao --project 2
    python -m src.worker_transcricao --project 2 --ids 5,14,17,18
    python -m src.worker_transcricao --project 2 --force
    python -m src.worker_transcricao --project 2 --dry-run

Por que existe, pela mesma licao do src/worker_vision.py: lote pesado dentro do
servidor sufoca o event loop e derruba a interface. Aqui o lote roda em processo
proprio e a interface fica intacta.

E ha uma segunda razao, aprendida em 22/08/2026: a rota individual
POST /api/video/{id}/transcribe cria uma BackgroundTask por REQUISICAO. Disparar
varias em sequencia rapida faz o servidor atender as requisicoes em paralelo, e
onze gravacoes concorrentes estouram o busy_timeout do SQLite -- mesmo com WAL
ligado, porque cada transacao grava milhares de palavras. Resultado: dois videos
terminaram em 'database is locked' e quatro nem rodaram. Este worker percorre a
fila num unico processo, uma transcricao por vez, e o problema nao existe.
(A rota de lote /transcribe-all ja e sequencial e nunca teve esse defeito; o
ganho dela para ca e nao ocupar o servidor.)

ATENCAO -- o Qdrant roda embutido (QdrantClient(path=...)) com trava de arquivo
exclusiva: enquanto este worker roda, a BUSCA do servidor fica indisponivel. O
resto da interface (biblioteca, rostos, tarefas) funciona normal.

Retomada: videos com status='transcribed' sao pulados sem --force. Videos que
ficaram presos em 'transcribing' por uma rodada interrompida SAO reprocessados,
porque nao ha como saber se o pipeline chegou ao fim.
"""
import argparse
import sqlite3
import sys
import time
from pathlib import Path
from typing import List, Optional

from src.core.tasks import TASK_MANAGER, WORKER_PROGRESS_FILE
from src.db.connection import get_db
from src.services.pipeline import PipelineService

# Status que indica trabalho concluido; qualquer outro entra na fila.
CONCLUIDO = "transcribed"


def selecionar(project_id: int, ids: Optional[List[int]], force: bool) -> List[sqlite3.Row]:
    """Monta a fila de videos a transcrever, na ordem em que serao processados."""
    with get_db() as conn:
        if ids:
            marcas = ",".join("?" * len(ids))
            sql = (f"select id, filename, filepath, status, duration from video "
                   f"where project_id = ? and id in ({marcas}) order by id")
            linhas = conn.execute(sql, (project_id, *ids)).fetchall()
        else:
            sql = ("select id, filename, filepath, status, duration from video "
                   "where project_id = ? and video_type in ('interview','broll','unknown') "
                   "order by id")
            linhas = conn.execute(sql, (project_id,)).fetchall()

    if force:
        return list(linhas)
    return [r for r in linhas if r["status"] != CONCLUIDO]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transcricao ASR em lote, em processo separado do servidor."
    )
    parser.add_argument("--project", type=int, required=True, help="ID do projeto")
    parser.add_argument("--ids", type=str, default=None,
                        help="Lista de IDs separados por virgula (ex: 5,14,17,18). "
                             "Sem isso, pega a fila inteira do projeto.")
    parser.add_argument("--force", action="store_true",
                        help="Reprocessa tambem os que ja estao com status='transcribed'.")
    parser.add_argument("--dry-run", action="store_true",
                        help="So mostra o que seria transcrito, sem enviar nada nem gastar.")
    args = parser.parse_args()

    ids = None
    if args.ids:
        try:
            ids = [int(x) for x in args.ids.split(",") if x.strip()]
        except ValueError:
            print("--ids aceita apenas numeros separados por virgula.", file=sys.stderr)
            return 2

    fila = selecionar(args.project, ids, args.force)
    if not fila:
        print("Nada a transcrever. (Use --force para reprocessar os ja concluidos.)")
        return 0

    horas = sum((r["duration"] or 0) for r in fila) / 3600
    print(f"Fila: {len(fila)} videos, {horas:.2f} h de audio")
    for r in fila:
        marca = " [reprocessa]" if r["status"] == CONCLUIDO else ""
        print(f"  id={r['id']:<5} {r['status']:<13} {r['filename'][:52]}{marca}")
    print()

    if args.dry_run:
        print("--dry-run: nada foi enviado.")
        return 0

    # Espelha o progresso em disco: e o unico jeito da tela de Tarefas do servidor
    # enxergar esta rodada, ja que ela acontece em outro processo.
    TASK_MANAGER.enable_file_sink(WORKER_PROGRESS_FILE)
    print(f"[Worker] Progresso espelhado em: {WORKER_PROGRESS_FILE}")
    print()

    ok, falhas = 0, []
    inicio = time.time()

    for pos, r in enumerate(fila, 1):
        vid, nome = r["id"], r["filename"]
        caminho = Path(r["filepath"])
        print(f"[{pos}/{len(fila)}] id={vid} {nome}", flush=True)

        if not caminho.exists():
            print("        arquivo nao encontrado -- pulado", flush=True)
            falhas.append((vid, "arquivo ausente"))
            continue

        try:
            # Sequencial de proposito: uma gravacao por vez no SQLite.
            PipelineService.transcribe_video(vid, caminho)
        except Exception as e:  # noqa: BLE001 - um video ruim nao pode parar a fila
            print(f"        ERRO: {e}", flush=True)
            falhas.append((vid, str(e)))
            continue

        with get_db() as conn:
            st = conn.execute("select status, error_message from video where id=?", (vid,)).fetchone()
            pal = conn.execute("select count(*) from transcript where video_id=?", (vid,)).fetchone()[0]
            ent = conn.execute("select count(*) from transcript_entity where video_id=?", (vid,)).fetchone()[0]

        if st["status"] == CONCLUIDO:
            ok += 1
            print(f"        {pal} palavras, {ent} entidades", flush=True)
        else:
            falhas.append((vid, st["error_message"] or f"status={st['status']}"))
            print(f"        terminou em '{st['status']}': {st['error_message'] or 'sem mensagem'}", flush=True)

    print()
    print(f"=== FIM === {ok} concluidos, {len(falhas)} com problema, "
          f"{(time.time() - inicio) / 60:.1f} min")
    for vid, msg in falhas:
        print(f"  id={vid}: {msg}")
    return 0 if not falhas else 1


if __name__ == "__main__":
    sys.exit(main())
