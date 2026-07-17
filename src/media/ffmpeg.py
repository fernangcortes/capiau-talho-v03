"""Wrapper de utilidades técnicas para execução de comandos FFmpeg e FFprobe."""
import os
import sys
import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, Callable

def get_media_metadata(filepath: Path) -> Dict[str, Any]:
    """Extrai metadados técnicos (duração, fps, resolução, codec e bitrate) via FFprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', str(filepath)
    ]
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        result = subprocess.run(cmd, capture_output=True, text=True, startupinfo=startupinfo, check=True)
        data = json.loads(result.stdout)
        
        video_stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), {})
        audio_stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'audio'), {})
        fmt = data.get('format', {})
        
        duration = float(fmt.get('duration', 0.0))
        bitrate = int(fmt.get('bit_rate', 0)) if fmt.get('bit_rate') else 0
        
        fps = 0.0
        if video_stream.get('r_frame_rate'):
            try:
                fps = eval(video_stream.get('r_frame_rate'))
            except Exception:
                fps = 0.0
                
        resolution = ""
        if video_stream.get('width') and video_stream.get('height'):
            resolution = f"{video_stream['width']}x{video_stream['height']}"
            
        codec = video_stream.get('codec_name', audio_stream.get('codec_name', 'unknown'))
        
        return {
            'duration': duration,
            'fps': round(fps, 3),
            'resolution': resolution,
            'codec': codec,
            'bitrate': bitrate
        }
    except Exception as e:
        print(f"[FFmpeg] Erro ao executar FFprobe no arquivo {filepath.name}: {e}")
        return {
            'duration': 0.0,
            'fps': 0.0,
            'resolution': 'unknown',
            'codec': 'unknown',
            'bitrate': 0
        }

def has_audio_stream(filepath: Path) -> bool:
    """Verifica se o arquivo de mídia possui pelo menos uma stream de áudio ativa."""
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=codec_type', '-of', 'json', str(filepath)
    ]
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        res = subprocess.run(cmd, capture_output=True, text=True, startupinfo=startupinfo, check=True)
        data = json.loads(res.stdout)
        return bool(data.get('streams'))
    except Exception as e:
        print(f"[FFmpeg] Erro ao checar streams de áudio para {filepath.name}: {e}")
        return False

def extract_audio_mono(video_path: Path, output_path: Path) -> bool:
    """Extrai áudio mono de 16kHz do vídeo em formato leve MP3 para transcrição (ASR)."""
    cmd = [
        'ffmpeg', '-y', '-i', str(video_path),
        '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1',
        str(output_path)
    ]
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
        return output_path.exists() and output_path.stat().st_size > 0
    except Exception as e:
        print(f"[FFmpeg] Falha ao extrair áudio de {video_path.name}: {e}")
        return False

def extract_frame(video_path: Path, timestamp: float, output_path: Path) -> bool:
    """Extrai um único frame JPEG de alta qualidade a partir de um timestamp com fallback de busca lenta para MTS."""
    cmd_fast = [
        'ffmpeg', '-y',
        '-ss', str(timestamp),
        '-i', str(video_path),
        '-vframes', '1',
        '-q:v', '2',
        str(output_path)
    ]
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        
    try:
        subprocess.run(cmd_fast, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
        if output_path.exists():
            return True
    except Exception:
        # Fallback de busca lenta (-ss depois do -i) para arquivos .MTS com index corrompido
        cmd_slow = [
            'ffmpeg', '-y',
            '-i', str(video_path),
            '-ss', str(timestamp),
            '-vframes', '1',
            '-q:v', '2',
            str(output_path)
        ]
        try:
            subprocess.run(cmd_slow, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
            return output_path.exists()
        except Exception as e:
            print(f"[FFmpeg] Falha critica ao extrair frame a {timestamp}s do video {video_path.name} (busca rapida e lenta falharam): {e}")
            return False
    return False

def generate_video_proxy(
    original_path: Path,
    proxy_path: Path,
    duration: float,
    resolution: str = "1280x720",
    preset: str = "fast",
    crf: int = 23,
    on_process_start: Optional[Callable[[subprocess.Popen], None]] = None,
    on_progress: Optional[Callable[[float], None]] = None
) -> bool:
    """Gera um proxy MP4 H.264 monitorando o progresso da conversão em tempo real."""
    res_width, res_height = resolution.split('x') if 'x' in resolution else ("1280", "720")
    
    cmd = [
        'ffmpeg', '-y', '-i', str(original_path),
        '-progress', 'pipe:1',
        '-vf', f'scale={res_width}:{res_height}:force_original_aspect_ratio=decrease,pad={res_width}:{res_height}:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264',
        '-preset', preset,
        '-crf', str(crf),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        str(proxy_path)
    ]
    
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            startupinfo=startupinfo
        )
        
        if on_process_start:
            on_process_start(process)
            
        while True:
            line = process.stdout.readline()
            if not line:
                break
                
            line = line.strip()
            if line.startswith("out_time_us=") and on_progress and duration > 0:
                try:
                    time_us = int(line.split("=")[1])
                    current_time = time_us / 1000000.0
                    percent = min((current_time / duration) * 100.0, 100.0)
                    on_progress(round(percent, 1))
                except Exception:
                    pass
            elif line.startswith("progress=") and line.split("=")[1].strip() == "end" and on_progress:
                on_progress(100.0)
                
        process.communicate()
        return process.returncode == 0
    except Exception as e:
        print(f"[FFmpeg] Erro ao gerar proxy para {original_path.name}: {e}")
        return False


def extract_thumbnail_frame(video_path: Path, timestamp: float, output_path: Path, width: int = 120) -> bool:
    """Extrai um único frame JPEG em baixa resolução de forma rápida, com tratamento para MTS e busca lenta como fallback."""
    is_mts = video_path.suffix.lower() == '.mts'
    
    cmd_fast = [
        'ffmpeg', '-y',
        '-ss', f"{timestamp:.3f}",
        '-i', str(video_path),
        '-vf', f'scale={width}:-1',
        '-vframes', '1',
        '-q:v', '5',
        str(output_path)
    ]
    
    cmd_slow = [
        'ffmpeg', '-y',
        '-i', str(video_path),
        '-ss', f"{timestamp:.3f}",
        '-vf', f'scale={width}:-1',
        '-vframes', '1',
        '-q:v', '5',
        str(output_path)
    ]
    
    startupinfo = None
    creationflags = 0
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        creationflags |= subprocess.BELOW_NORMAL_PRIORITY_CLASS
        
    try:
        # Se for MTS, não tenta a busca rápida (costuma gerar frames verdes)
        if is_mts:
            raise ValueError("MTS requer busca lenta para evitar frames verdes")
            
        if os.name == 'nt':
            subprocess.run(cmd_fast, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, creationflags=creationflags, check=True)
        else:
            cmd_unix = ['nice', '-n', '15'] + cmd_fast
            subprocess.run(cmd_unix, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            
        if output_path.exists() and output_path.stat().st_size > 0:
            return True
    except Exception:
        # Fallback de busca lenta
        try:
            if os.name == 'nt':
                subprocess.run(cmd_slow, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, creationflags=creationflags, check=True)
            else:
                cmd_unix = ['nice', '-n', '15'] + cmd_slow
                subprocess.run(cmd_unix, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return output_path.exists() and output_path.stat().st_size > 0
        except Exception as e:
            print(f"[FFmpeg] Falha ao extrair miniatura lenta a {timestamp}s de {video_path.name}: {e}")
            return False
    return False
