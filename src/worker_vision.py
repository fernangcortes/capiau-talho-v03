"""Worker de analise de visao em lote, FORA do processo do servidor web.

Uso:
    python -m src.worker_vision --project 2 --force-photos

Por que existe: rodar o lote dentro do servidor (BackgroundTasks) sufoca o
event loop e derruba a interface inteira. Medido em 15/07/2026 na rodada do
E1.T5: o servidor parou de responder a QUALQUER rota -- inclusive /docs, que
nem toca o banco -- por horas, enquanto o lote seguia normal e 3 dos 4 nucleos
da maquina estavam ociosos. Num processo proprio o lote nao concorre pelo GIL
do servidor e a interface fica intacta.

ATENCAO -- o Qdrant roda embutido (QdrantClient(path=...)) com trava de arquivo
exclusiva: enquanto este worker roda, a BUSCA do servidor fica indisponivel.
O resto da interface (biblioteca, rostos, tarefas) funciona normal. Rodar o
Qdrant como servico e o que destrava os dois ao mesmo tempo -- fica para o E4.D.

Retomada de rodada interrompida: os videos ja concluidos ficam com
status='analyzed' e sao pulados sem --force-videos. As fotos, porem, ficam
'analyzed' desde a Etapa 1, entao a fase de fotos exige --force-photos para
nao ser pulada inteira.
"""
import argparse

from src.services.vision_batch import run_vision_batch


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analise de visao em lote, em processo separado do servidor."
    )
    parser.add_argument("--project", type=int, required=True, help="ID do projeto")
    parser.add_argument(
        "--force-videos", action="store_true",
        help="Reanalisa tambem os videos ja com status='analyzed'."
    )
    parser.add_argument(
        "--force-photos", action="store_true",
        help="Reanalisa tambem as fotos ja com status='analyzed'."
    )
    args = parser.parse_args()

    run_vision_batch(
        args.project,
        force_videos=args.force_videos,
        force_photos=args.force_photos,
    )


if __name__ == "__main__":
    main()
