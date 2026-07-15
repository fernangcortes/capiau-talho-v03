"""Execucao em lote da analise de visao (videos + fotos).

Extraido do endpoint analyze-all-vision para poder rodar TAMBEM fora do
processo do servidor web (ver src/worker_vision.py).

Por que a separacao existe: rodar o lote dentro do servidor via BackgroundTasks
sufoca o event loop e derruba a interface INTEIRA -- medido em 15/07/2026 na
rodada do E1.T5: servidor sem responder a nada (nem /docs) por horas, com
1,08 nucleo em uso e 3 dos 4 nucleos ociosos. A rodada em si seguia normal;
so a interface morria. Esta e a solucao paliativa ate o E4.D (fila persistente
+ worker) da Etapa 4.

Cuidado com log: o console desta maquina e cp1252 e nao codifica '->' unicode,
'<=' nem emoji. Ver a convencao em docs/PLANO_IMPLEMENTACAO.md.
"""
from pathlib import Path
from typing import Any, List

from src.core.tasks import TASK_MANAGER
from src.db.connection import get_db
from src.services.burst_service import group_photo_bursts, replicate_to_members
from src.services.pipeline import PipelineService

# Chave do item que resume a rodada inteira na tela de Tarefas. Sem ele a tela so
# mostraria a midia da vez, sem nocao de "quanto falta".
BATCH_KEY = "lote-visao"


def _select_videos(conn, project_id: int, force: bool) -> List[Any]:
    """Videos no escopo da visao. As entrevistas (video_type='interview') ficam
    de fora de proposito -- elas vao por transcricao."""
    cursor = conn.cursor()
    if force:
        cursor.execute(
            "SELECT id, filename, filepath, duration FROM video "
            "WHERE project_id = ? AND video_type IN ('broll', 'unknown')",
            (project_id,),
        )
    else:
        cursor.execute(
            "SELECT id, filename, filepath, duration FROM video "
            "WHERE project_id = ? AND video_type IN ('broll', 'unknown') "
            "AND status IN ('ingested', 'analyzing', 'error')",
            (project_id,),
        )
    return cursor.fetchall()


def _select_photos(conn, project_id: int, force: bool) -> List[Any]:
    cursor = conn.cursor()
    if force:
        cursor.execute("SELECT id, filepath FROM photo WHERE project_id = ?", (project_id,))
    else:
        cursor.execute(
            "SELECT id, filepath FROM photo WHERE project_id = ? "
            "AND status IN ('ingested', 'pending', 'error')",
            (project_id,),
        )
    return cursor.fetchall()


def run_vision_batch(project_id: int, force_videos: bool = False, force_photos: bool = False) -> None:
    """Analisa a visao de todos os videos e fotos pendentes (ou todos, se force).

    Os dois 'force' sao separados porque retomar uma rodada interrompida quase
    sempre quer regras diferentes: pular os videos ja refeitos (force_videos=False)
    mas ainda refazer as fotos (force_photos=True), ja que a fase de fotos --
    onde o agrupamento de rajadas economiza -- pode nem ter comecado.
    """
    with get_db() as conn:
        video_rows = _select_videos(conn, project_id, force_videos)
        photo_rows = _select_photos(conn, project_id, force_photos)

    print(f"[VisionBatch] Projeto {project_id}: {len(video_rows)} videos e "
          f"{len(photo_rows)} fotos na fila "
          f"(force_videos={force_videos}, force_photos={force_photos}).")

    total_units = len(video_rows) + len(photo_rows)
    done_units = 0

    def _publish(label: str, status: str = "running") -> None:
        pct = (done_units / total_units * 100.0) if total_units else 100.0
        TASK_MANAGER.update_progress(BATCH_KEY, pct, status, task_type="vision", label=label)

    # 1. Videos (b-roll)
    for idx, v in enumerate(video_rows, start=1):
        try:
            _publish(f"Lote de visão — vídeo {idx} de {len(video_rows)}: {v['filename']}")
            print(f"[VisionBatch] ({idx}/{len(video_rows)}) Video {v['id']}: {v['filename']}")
            PipelineService.analyze_video_vision(v['id'], Path(v['filepath']), v['duration'])
        except Exception as e:
            print(f"[VisionBatch] Erro no video ID {v['id']}: {e}")
        done_units += 1

    # 2. Fotos: agrupa rajadas por semelhanca visual (CLIP local) e analisa 1 por grupo
    photos_with_time = []
    offline = 0
    for p in photo_rows:
        path = Path(p['filepath'])
        exists = path.exists()
        if not exists:
            offline += 1
        mtime = path.stat().st_mtime if exists else 0.0
        photos_with_time.append({
            "id": p["id"],
            "filepath": path,
            "mtime": mtime,
            "parent_dir": str(path.parent),
        })

    # Original inacessivel (cartao/HD externo desconectado) => mtime 0 para todas:
    # a janela de tempo das rajadas vira inerte e o agrupamento passa a depender
    # so de pasta + CLIP. O proxy WebP local ainda permite agrupar, mas o usuario
    # precisa saber que uma salvaguarda saiu do ar -- degradacao silenciosa, nao.
    if offline:
        print(f"[VisionBatch] ATENCAO: {offline} de {len(photo_rows)} fotos estao com o "
              f"original inacessivel; sem mtime a janela 'burst.time_window_s' nao filtra "
              f"nada e as rajadas serao decididas so por pasta + semelhanca CLIP. "
              f"Conecte o drive de origem para o agrupamento por tempo valer.")

    photos_with_time.sort(key=lambda x: (x["parent_dir"], x["mtime"]))

    if not photos_with_time:
        print("[VisionBatch] Nenhuma foto na fila. Lote concluido.")
        _publish("Lote de visão concluído", status="finished")
        return

    _publish(f"Lote de visão — agrupando {len(photos_with_time)} fotos em rajadas")
    groups = group_photo_bursts(project_id, photos_with_time)
    print(f"[VisionBatch] {len(photos_with_time)} fotos agrupadas em {len(groups)} chamadas de visao.")

    for gidx, group in enumerate(groups, start=1):
        leader = group.leader
        try:
            _publish(f"Lote de visão — rajada {gidx} de {len(groups)} "
                     f"({len(photo_rows)} fotos no total)")
            print(f"[VisionBatch] ({gidx}/{len(groups)}) Foto lider {leader['id']} "
                  f"(+{len(group.members)} na rajada)")
            PipelineService.analyze_photo_vision(leader["id"], leader["filepath"])
        except Exception as ex:
            print(f"[VisionBatch] Falha na analise da foto {leader['id']}: {ex}")
            done_units += 1 + len(group.members)
            continue

        if group.members:
            for m in group.members:
                TASK_MANAGER.update_progress(f"photo-{m['id']}", 0.0, "running", task_type="vision")
            try:
                replicate_to_members(project_id, group)
            except Exception as ex:
                print(f"[VisionBatch] Falha ao replicar rajada da foto {leader['id']}: {ex}")
            for m in group.members:
                TASK_MANAGER.update_progress(f"photo-{m['id']}", 100.0, "finished", task_type="vision")

        done_units += 1 + len(group.members)

    _publish("Lote de visão concluído", status="finished")
    print("[VisionBatch] Lote concluido.")
