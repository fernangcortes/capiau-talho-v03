"""Exportador de Timelines em formatos OpenTimelineIO, XML e EDL para editores profissionais.

O 'opentimelineio' não tem wheel para o Python 3.14 (verificado em 19/07/2026, v0.18.1).
Quando o import falha, a exportação é delegada por subprocesso a um venv Python 3.12
dedicado ('data/venv312', criado via uv) que roda ESTE mesmo módulo como worker.
"""
import os
import sys
import sqlite3
import json
import subprocess
from pathlib import Path

# Import opcional: sem o pacote (ex.: Python sem wheel disponível), o app sobe
# normalmente e a exportação passa a usar o worker 3.12 (se existir).
try:
    import opentimelineio as otio
    OTIO_AVAILABLE = True
except ImportError:
    otio = None
    OTIO_AVAILABLE = False
    print("[EXPORT] Aviso: 'opentimelineio' sem wheel neste Python; exportacao usara o worker do venv 3.12 (data/venv312) se ele existir.")

from src.config import CONFIG
from src.db.connection import get_db

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_WORKER_PYTHON = _REPO_ROOT / "data" / "venv312" / "Scripts" / "python.exe"

def generate_otio_timeline(timeline_id: int) -> "otio.schema.Timeline":
    """Carrega os cortes salvos na tabela 'timeline' e monta uma timeline do OpenTimelineIO.

    Suporta o formato v2 multipista (tracks nomeadas + posições absolutas com Gaps)
    e o formato legado v1 (lista sequencial de cortes).
    """
    if not OTIO_AVAILABLE:
        raise RuntimeError(
            "Exportação indisponível: o pacote 'opentimelineio' não está instalado neste Python. "
            "Instale com: pip install opentimelineio"
        )
    from src.db.repositories.projects import ProjectRepository

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name, sequence_json FROM timeline WHERE id = ?", (timeline_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Timeline com ID {timeline_id} não encontrada.")

        timeline_name = row['name']
        sequence = ProjectRepository.parse_sequence(row['sequence_json'])
        clips = sequence.get("clips", [])
        tracks_meta = sequence.get("tracks", [])
        timeline_fps = float(sequence.get("fps", 24.0)) or 24.0

        # 1. Criar o objeto de timeline do OTIO
        otio_timeline = otio.schema.Timeline(name=timeline_name)
        track_map = {}
        track_names = {t.get("id"): (t.get("name") or t.get("id")) for t in tracks_meta}
        track_kinds = {t.get("id"): (t.get("kind") or "video") for t in tracks_meta}
        # Pistas de IA (sugestões não aceitas) não são exportadas
        ai_track_ids = {t.get("id") for t in tracks_meta if t.get("kind") == "ai"}

        # 2. Agrupar clipes por trilha, ordenados pela posição na timeline
        clips_by_track = {}
        for cut in clips:
            track_id = str(cut.get('track', 'V1'))
            if track_id in ai_track_ids:
                continue
            clips_by_track.setdefault(track_id, []).append(cut)

        # Ordena as trilhas conforme a ordem definida (de baixo para cima no OTIO)
        track_order = {t.get("id"): t.get("order", idx) for idx, t in enumerate(tracks_meta)}
        sorted_track_ids = sorted(clips_by_track.keys(), key=lambda tid: -track_order.get(tid, 0))

        for track_id in sorted_track_ids:
            track_label = f"{track_id} {track_names.get(track_id, '')}".strip()
            otio_kind = otio.schema.TrackKind.Audio if track_kinds.get(track_id) == "audio" else otio.schema.TrackKind.Video
            track = otio.schema.Track(name=track_label, kind=otio_kind)
            otio_timeline.tracks.append(track)
            track_map[track_id] = track

            track_clips = sorted(clips_by_track[track_id], key=lambda c: float(c.get('timeline_start', 0.0) or 0.0))
            playhead_s = 0.0

            for cut in track_clips:
                in_s = float(cut.get('in', 0.0))
                out_s = float(cut.get('out', 0.0))
                start_s = float(cut.get('timeline_start', playhead_s) or playhead_s)
                is_photo = cut.get('type') == 'photo'

                if is_photo:
                    # Foto still: referencia o arquivo original; fps = fps da timeline
                    cursor.execute("SELECT filename, filepath FROM photo WHERE id = ?", (cut.get('photo_id'),))
                    p_row = cursor.fetchone()
                    if not p_row:
                        continue
                    filepath = p_row['filepath']
                    fps = timeline_fps
                    clip_name = p_row['filename']
                else:
                    video_id = cut.get('video_id')
                    cursor.execute("SELECT filename, filepath, fps FROM video WHERE id = ?", (video_id,))
                    v_row = cursor.fetchone()
                    if not v_row:
                        continue
                    filepath = v_row['filepath']
                    fps = float(v_row['fps']) if v_row['fps'] else timeline_fps
                    clip_name = v_row['filename']

                # Gap para posicionar o clipe no ponto correto da timeline
                if start_s > playhead_s + (1.0 / timeline_fps):
                    gap_dur = start_s - playhead_s
                    track.append(otio.schema.Gap(
                        source_range=otio.opentime.TimeRange(
                            start_time=otio.opentime.RationalTime(0, timeline_fps),
                            duration=otio.opentime.RationalTime(int(gap_dur * timeline_fps), timeline_fps)
                        )
                    ))
                    playhead_s = start_s

                if is_photo:
                    # Still congelado: source do 0 à duração do clipe na timeline.
                    dur_frames = max(1, int((out_s - in_s) * fps))
                    media_ref = otio.schema.ExternalReference(
                        target_url=Path(filepath).as_uri(),
                        available_range=otio.opentime.TimeRange(
                            start_time=otio.opentime.RationalTime(0, fps),
                            duration=otio.opentime.RationalTime(dur_frames, fps)
                        )
                    )
                    clip_range = otio.opentime.TimeRange(
                        start_time=otio.opentime.RationalTime(0, fps),
                        duration=otio.opentime.RationalTime(dur_frames, fps)
                    )
                    clip = otio.schema.Clip(
                        name=clip_name,
                        media_reference=media_ref,
                        source_range=clip_range
                    )
                    # Enquadramento/Ken Burns preservados como metadados (best-effort;
                    # FCPXML/EDL não renderizam o movimento, mas mantêm posição+duração).
                    clip.metadata["capiau"] = {"still": True, "effects": cut.get('effects') or []}
                    track.append(clip)
                    playhead_s += (out_s - in_s)
                else:
                    media_ref = otio.schema.ExternalReference(
                        target_url=Path(filepath).as_uri(),
                        available_range=otio.opentime.TimeRange(
                            start_time=otio.opentime.RationalTime(0, fps),
                            duration=otio.opentime.RationalTime(int(out_s * fps), fps)
                        )
                    )

                    clip_range = otio.opentime.TimeRange(
                        start_time=otio.opentime.RationalTime(int(in_s * fps), fps),
                        duration=otio.opentime.RationalTime(int((out_s - in_s) * fps), fps)
                    )

                    clip = otio.schema.Clip(
                        name=clip_name,
                        media_reference=media_ref,
                        source_range=clip_range
                    )

                    track.append(clip)
                    playhead_s += (out_s - in_s)

        return otio_timeline

def _resolve_worker_python() -> "Path | None":
    """Python do venv de exportação: override em settings ou o default data/venv312."""
    try:
        from src.services.settings_service import SettingsService
        configured = str(SettingsService.get_settings(None).get("export.worker_python") or "").strip()
        if configured:
            p = Path(configured)
            if p.exists():
                return p
            print(f"[EXPORT] Aviso: export.worker_python aponta para caminho inexistente: {configured}")
    except Exception:
        pass  # settings indisponiveis (ex.: worker standalone) -> usa default
    if _DEFAULT_WORKER_PYTHON.exists():
        return _DEFAULT_WORKER_PYTHON
    return None


def _export_via_worker(timeline_id: int, output_format: str) -> Path:
    """Roda a exportação num subprocesso do venv 3.12 (que tem o opentimelineio)."""
    worker_py = _resolve_worker_python()
    if worker_py is None:
        raise RuntimeError(
            "Exportação indisponível: 'opentimelineio' não tem wheel neste Python e o venv de "
            "exportação não foi encontrado. Crie-o com: uv venv data/venv312 --python 3.12 && "
            "uv pip install --python data/venv312/Scripts/python.exe opentimelineio otio-fcp-adapter otio-cmx3600-adapter python-dotenv"
        )

    env = os.environ.copy()
    env["CAPIAU_OTIO_WORKER"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # O worker herda os caminhos ativos (testes usam DB/exports temporarios)
    env["CAPIAU_DB_PATH"] = str(CONFIG.DB_PATH)
    env["CAPIAU_EXPORTS_DIR"] = str(CONFIG.EXPORTS_DIR)

    proc = subprocess.run(
        [str(worker_py), "-m", "src.export.otio_export", str(timeline_id), output_format],
        cwd=str(_REPO_ROOT), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=180, env=env,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip()[-600:]
        raise RuntimeError(f"Worker de exportacao (venv 3.12) falhou: {tail}")

    for line in reversed((proc.stdout or "").strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return Path(json.loads(line)["path"])
    raise RuntimeError("Worker de exportacao nao devolveu o caminho do arquivo gerado.")


def export_timeline_file(timeline_id: int, output_format: str = "otio") -> Path:
    """Exporta a timeline para .otio, .xml ou .edl e retorna o caminho em data/exports/.

    Com o otio importável, roda no próprio processo; sem ele, delega ao worker 3.12.
    """
    if not OTIO_AVAILABLE:
        return _export_via_worker(timeline_id, output_format)
    return _export_in_process(timeline_id, output_format)


def _export_in_process(timeline_id: int, output_format: str = "otio") -> Path:
    """Exporta a timeline selecionada para o formato especificado (.otio, .xml ou .edl).

    Salva o arquivo em data/exports/ e retorna o caminho.
    """
    otio_timeline = generate_otio_timeline(timeline_id)

    # EDL (CMX 3600) suporta apenas UMA trilha de vídeo: achata as pistas de VÍDEO
    # (clipe da pista mais alta prevalece, como na visualização do programa)
    if output_format == "edl" and len(otio_timeline.tracks) > 1:
        try:
            video_tracks = [t for t in otio_timeline.tracks if t.kind == otio.schema.TrackKind.Video]
            flat_track = otio.algorithms.flatten_stack(video_tracks)
            flat_timeline = otio.schema.Timeline(name=otio_timeline.name)
            flat_timeline.tracks.append(flat_track)
            otio_timeline = flat_timeline
            print("[EXPORT] Timeline multipista achatada em trilha única para EDL.")
        except Exception as flatten_err:
            print(f"[EXPORT] Falha ao achatar timeline para EDL: {flatten_err}")

    CONFIG.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"timeline_{timeline_id}.{output_format}"
    output_path = CONFIG.EXPORTS_DIR / filename

    # Resolver o adaptador do OTIO correto
    adapter_name = "otio_json" if output_format == "otio" else "fcp_xml" if output_format == "xml" else "cmx_3600"
    
    # Exporta para disco usando a API do OpenTimelineIO
    print(f"[EXPORT] Exportando timeline {timeline_id} para {output_path.name}...")
    otio.adapters.write_to_file(otio_timeline, str(output_path), adapter_name=adapter_name)
    print("  [OK] Timeline salva com sucesso!")

    return output_path


if __name__ == "__main__":
    # Modo worker: `python -m src.export.otio_export <timeline_id> <formato>`
    # Executado pelo venv 3.12 quando o Python principal nao tem o opentimelineio.
    if os.environ.get("CAPIAU_DB_PATH"):
        CONFIG.DB_PATH = Path(os.environ["CAPIAU_DB_PATH"])
    if os.environ.get("CAPIAU_EXPORTS_DIR"):
        CONFIG.EXPORTS_DIR = Path(os.environ["CAPIAU_EXPORTS_DIR"])

    if not OTIO_AVAILABLE:
        # Nunca re-delegar daqui: worker sem otio e erro de configuracao, nao fallback.
        print("[EXPORT-WORKER] Este Python tambem nao tem o opentimelineio instalado.", file=sys.stderr)
        sys.exit(3)
    if len(sys.argv) < 3:
        print("Uso: python -m src.export.otio_export <timeline_id> <otio|xml|edl>", file=sys.stderr)
        sys.exit(2)

    _result_path = _export_in_process(int(sys.argv[1]), sys.argv[2])
    # Ultima linha em JSON: contrato de saida lido pelo processo pai
    print(json.dumps({"path": str(_result_path)}))
