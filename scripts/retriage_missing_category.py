"""Backfill de categoria para videos que ficaram 'analyzed' sem categoria.

Contexto (17/07/2026): a chamada de visao nao definia `max_tokens`, entao a
OpenRouter reservava credito contra o teto de saida do MODELO inteiro
(65k+ tokens no Gemini 2.5 Flash) em vez do que a resposta realmente usa
(uma descricao curta). Isso derrubou 66 triagens com erro 402 mesmo com
saldo real disponivel -- corrigido em src/services/pipeline.py
(vision.max_tokens, default 800).

O problema: esses videos ja receberam a analise de visao COMPLETA (cara,
paga) antes da triagem falhar -- o piso de seguranca "sem categoria = esforco
completo" ja rodou. So falta a categoria/titulo em si. Resetar o status para
'ingested' e rodar analyze-all-vision de novo pagaria a analise cara outra
vez a toa. Este script chama so PipelineService.triage_video() -- a chamada
barata multi-imagem -- para cada video, sem tocar no resto.

Uso:
    python scripts/retriage_missing_category.py --project 2
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.db.connection import get_db
from src.services.pipeline import PipelineService


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", type=int, required=True)
    args = parser.parse_args()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, filename, filepath, duration FROM video "
            "WHERE project_id = ? AND status = 'analyzed' AND category IS NULL",
            (args.project,),
        )
        rows = cursor.fetchall()

    print(f"[Retriage] {len(rows)} videos sem categoria para re-triar.")

    ok, falhou = 0, 0
    for idx, v in enumerate(rows, start=1):
        print(f"[Retriage] ({idx}/{len(rows)}) Video {v['id']}: {v['filename']}")
        try:
            result = PipelineService.triage_video(
                v["id"], Path(v["filepath"]), v["duration"], args.project
            )
            if result:
                ok += 1
            else:
                falhou += 1
                print(f"[Retriage]   -> sem resultado (ver log de erro acima)")
        except Exception as e:
            falhou += 1
            print(f"[Retriage]   -> excecao: {e}")
        time.sleep(0.5)  # folga entre chamadas

    print(f"[Retriage] Concluido: {ok} ok, {falhou} falharam.")


if __name__ == "__main__":
    main()
