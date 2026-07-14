"""Exportador de Timelines em formatos OpenTimelineIO, XML e EDL para editores profissionais."""
import sqlite3
import json
from pathlib import Path

# Import opcional: sem o pacote (ex.: Python sem wheel disponível), o app sobe
# normalmente e apenas a exportação OTIO/XML/EDL fica indisponível com erro claro.
try:
    import opentimelineio as otio
    OTIO_AVAILABLE = True
except ImportError:
    otio = None
    OTIO_AVAILABLE = False
    print("[EXPORT] Aviso: 'opentimelineio' não instalado — exportação de timeline desabilitada até instalar o pacote.")

from src.config import CONFIG
from src.db.connection import get_db

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

def export_timeline_file(timeline_id: int, output_format: str = "otio") -> Path:
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
