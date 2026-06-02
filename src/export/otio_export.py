"""Exportador de Timelines em formatos OpenTimelineIO, XML e EDL para editores profissionais."""
import sqlite3
import json
from pathlib import Path
import opentimelineio as otio
from src.config import CONFIG
from src.db.operations import get_connection

def generate_otio_timeline(timeline_id: int) -> otio.schema.Timeline:
    """Carrega os cortes salvos na tabela 'timeline' e monta uma timeline do OpenTimelineIO."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name, sequence_json FROM timeline WHERE id = ?", (timeline_id,))
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Timeline com ID {timeline_id} não encontrada.")
            
        timeline_name = row['name']
        cuts = json.loads(row['sequence_json']) # Lista contendo [{video_id, in, out, track}, ...]
        
        # 1. Criar o objeto de timeline do OTIO
        otio_timeline = otio.schema.Timeline(name=timeline_name)
        track_map = {}
        
        # 2. Iterar sobre os cortes e adicionar aos tracks do OTIO
        for cut in cuts:
            video_id = cut['video_id']
            in_s = float(cut['in'])
            out_s = float(cut['out'])
            track_name = str(cut.get('track', 'V1')) # Default track
            
            # Carregar caminho e framerate do vídeo no SQLite
            cursor.execute("SELECT filename, filepath, fps FROM video WHERE id = ?", (video_id,))
            v_row = cursor.fetchone()
            if not v_row:
                continue
                
            filepath = v_row['filepath']
            fps = float(v_row['fps']) if v_row['fps'] else 24.0
            
            # Criar ou recuperar a trilha (Track) na timeline
            if track_name not in track_map:
                track = otio.schema.Track(name=track_name, kind=otio.schema.TrackKind.Video)
                otio_timeline.tracks.append(track)
                track_map[track_name] = track
            else:
                track = track_map[track_name]
                
            # Criar a referência de mídia (MediaReference)
            media_ref = otio.schema.ExternalReference(
                target_url=Path(filepath).as_uri(),
                available_range=otio.opentime.TimeRange(
                    start_time=otio.opentime.RationalTime(0, fps),
                    duration=otio.opentime.RationalTime(int(out_s * fps), fps)
                )
            )
            
            # Criar o clipe de corte (Clip) com in/out selecionados
            clip_range = otio.opentime.TimeRange(
                start_time=otio.opentime.RationalTime(int(in_s * fps), fps),
                duration=otio.opentime.RationalTime(int((out_s - in_s) * fps), fps)
            )
            
            clip = otio.schema.Clip(
                name=v_row['filename'],
                media_reference=media_ref,
                source_range=clip_range
            )
            
            # Anexar à trilha
            track.append(clip)
            
        return otio_timeline
    finally:
        conn.close()

def export_timeline_file(timeline_id: int, output_format: str = "otio") -> Path:
    """Exporta a timeline selecionada para o formato especificado (.otio, .xml ou .edl).
    
    Salva o arquivo em data/exports/ e retorna o caminho.
    """
    otio_timeline = generate_otio_timeline(timeline_id)
    
    CONFIG.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"timeline_{timeline_id}.{output_format}"
    output_path = CONFIG.EXPORTS_DIR / filename
    
    # Resolver o adaptador do OTIO correto
    adapter_name = "otio_json" if output_format == "otio" else "fcp_xml" if output_format == "xml" else "cmx_3600"
    
    # Exporta para disco usando a API do OpenTimelineIO
    print(f"[EXPORT] Exportando timeline {timeline_id} para {output_path.name}...")
    otio.adapters.write_to_file(otio_timeline, str(output_path), adapter_name=adapter_name)
    print("  ✅ Timeline salva com sucesso!")
    
    return output_path
