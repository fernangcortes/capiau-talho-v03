"""Wrapper de utilidades técnicas para execução de comandos FFmpeg e FFprobe."""
import os
import sys
import json
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, Callable

# Metadados de COR lidos da stream de vídeo (Fase 0 de docs/PLANO_COR_OCIO.md).
# Ausência de tag é informação: a camcorder AVCHD do acervo não etiqueta nada e a
# Canon etiqueta full range. Por isso o valor ausente vira None e NUNCA um default
# inventado -- quem decide o que fazer com o silêncio é src/color/deteccao.py.
COLOR_KEYS = (
    'color_range', 'color_space', 'color_transfer', 'color_primaries',
    'pix_fmt', 'bits_per_raw_sample', 'field_order',
)

# Devolvido quando o FFprobe falha, para que nenhum chamador precise usar .get()
# defensivo: as chaves existem sempre, o valor é que pode ser None.
EMPTY_COLOR: Dict[str, Any] = {k: None for k in COLOR_KEYS}


def _extract_color_metadata(video_stream: Dict[str, Any]) -> Dict[str, Any]:
    """Tags de cor da stream de vídeo. Chave ausente no FFprobe -> None."""
    out: Dict[str, Any] = {}
    for key in COLOR_KEYS:
        value = video_stream.get(key)
        out[key] = value if value not in ("", None) else None
    if out['bits_per_raw_sample'] is not None:
        try:
            out['bits_per_raw_sample'] = int(out['bits_per_raw_sample'])
        except (TypeError, ValueError):
            out['bits_per_raw_sample'] = None
    return out


def get_media_metadata(filepath: Path) -> Dict[str, Any]:
    """Extrai metadados técnicos (duração, fps, resolução, codec, bitrate e cor) via FFprobe."""
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
            'bitrate': bitrate,
            **_extract_color_metadata(video_stream),
        }
    except Exception as e:
        print(f"[FFmpeg] Erro ao executar FFprobe no arquivo {filepath.name}: {e}")
        return {
            'duration': 0.0,
            'fps': 0.0,
            'resolution': 'unknown',
            'codec': 'unknown',
            'bitrate': 0,
            **EMPTY_COLOR,
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

def is_solid_green_or_corrupted(image_path: Path) -> bool:
    """Valida se o frame extraído é uma imagem válida e não uma tela verde de erro do FFmpeg ou imagem corrompida."""
    try:
        if not image_path.exists() or image_path.stat().st_size < 1000:
            return True
        from PIL import Image
        import numpy as np
        
        with Image.open(image_path) as img:
            img_rgb = img.convert('RGB')
            img_small = img_rgb.resize((64, 64))
            arr = np.array(img_small, dtype=np.float32)
            
            r_mean = np.mean(arr[:, :, 0])
            g_mean = np.mean(arr[:, :, 1])
            b_mean = np.mean(arr[:, :, 2])
            
            # Detecta tela verde pura do FFmpeg (YUV 0x00 / falta de I-frame)
            if g_mean > 135 and r_mean < 60 and b_mean < 60:
                return True
                
            # Detecta imagens de cor sólida / totalmente uniformes
            std_dev = np.std(arr)
            if std_dev < 1.0:
                return True
                
            return False
    except Exception as e:
        print(f"[FFmpeg] Erro ao validar integridade do frame {image_path.name}: {e}")
        return False

def extract_frame(video_path: Path, timestamp: float, output_path: Path, proxy_fallback_path: Optional[Path] = None) -> bool:
    """Extrai um único frame JPEG de alta qualidade a partir de um timestamp com validação visual e fallback para busca lenta / proxy."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    # Tentativa 1: Busca rápida (-ss antes de -i) no arquivo alvo
    cmd_fast = [
        'ffmpeg', '-y',
        '-ss', str(timestamp),
        '-i', str(video_path),
        '-vframes', '1',
        '-q:v', '2',
        str(output_path)
    ]
    try:
        subprocess.run(cmd_fast, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
        if output_path.exists() and not is_solid_green_or_corrupted(output_path):
            return True
    except Exception:
        pass

    # Tentativa 2: Busca lenta (-ss depois de -i) no arquivo alvo (resolve H.264/MTS com busca rápida corrompida)
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
        if output_path.exists() and not is_solid_green_or_corrupted(output_path):
            return True
    except Exception:
        pass

    # Tentativa 3: Se o vídeo original falhou e temos um proxy 720p disponível, extrai do proxy
    if proxy_fallback_path and proxy_fallback_path.exists() and proxy_fallback_path != video_path:
        cmd_proxy = [
            'ffmpeg', '-y',
            '-ss', str(timestamp),
            '-i', str(proxy_fallback_path),
            '-vframes', '1',
            '-q:v', '2',
            str(output_path)
        ]
        try:
            subprocess.run(cmd_proxy, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
            if output_path.exists() and not is_solid_green_or_corrupted(output_path):
                return True
        except Exception:
            pass

    print(f"[FFmpeg] Falha ao extrair frame válido a {timestamp:.1f}s de {video_path.name}")
    if output_path.exists():
        try:
            output_path.unlink()
        except Exception:
            pass
    return False

_HW_ENCODERS_CACHE: Optional[Dict[str, bool]] = None

def get_hardware_settings(project_id: Optional[int] = None) -> tuple:
    """Retorna (encoder_pref, hwaccel_decode) com fallback gracioso se SettingsService não estiver disponível."""
    try:
        from src.services.settings_service import SettingsService
        S = SettingsService.get_settings(project_id)
        return S.get("hardware.video_encoder"), S.get("hardware.hwaccel_decode")
    except Exception:
        return "auto", "auto"

def probe_hw_encoder(encoder_name: str) -> bool:
    """Testa rapidamente se um encoder de hardware específico está funcional no sistema."""
    startupinfo = None
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    
    cmd = [
        'ffmpeg', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=15',
        '-c:v', encoder_name, '-f', 'null', '-'
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, timeout=4)
        return res.returncode == 0
    except Exception:
        return False

def get_available_hw_encoders() -> Dict[str, bool]:
    """Retorna o mapa de encoders de hardware suportados (com cache em memória)."""
    global _HW_ENCODERS_CACHE
    if _HW_ENCODERS_CACHE is not None:
        return _HW_ENCODERS_CACHE
    
    encoders = {}
    for enc in ["h264_qsv", "h264_nvenc", "h264_amf"]:
        encoders[enc] = probe_hw_encoder(enc)
    _HW_ENCODERS_CACHE = encoders
    active = [k for k, v in encoders.items() if v]
    print(f"[FFmpeg] Aceleradores de vídeo por hardware detectados: {active if active else 'Nenhum (usando CPU libx264)'}")
    return encoders

def resolve_encoder_pipeline(encoder_pref: str = "auto") -> tuple:
    """Resolve (encoder_name, extra_args, is_hardware)."""
    if encoder_pref == "cpu":
        return "libx264", ["-preset", "fast", "-crf", "23"], False
        
    avail = get_available_hw_encoders()
    
    if encoder_pref == "qsv" and avail.get("h264_qsv"):
        return "h264_qsv", ["-global_quality", "25", "-preset", "medium"], True
    elif encoder_pref == "amf" and avail.get("h264_amf"):
        return "h264_amf", ["-quality", "speed", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23"], True
    elif encoder_pref == "nvenc" and avail.get("h264_nvenc"):
        return "h264_nvenc", ["-preset", "p4", "-cq", "23"], True
    elif encoder_pref == "auto":
        if avail.get("h264_qsv"):
            return "h264_qsv", ["-global_quality", "25", "-preset", "medium"], True
        elif avail.get("h264_nvenc"):
            return "h264_nvenc", ["-preset", "p4", "-cq", "23"], True
        elif avail.get("h264_amf"):
            return "h264_amf", ["-quality", "speed", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23"], True

    return "libx264", ["-preset", "fast", "-crf", "23"], False

def generate_video_proxy(
    original_path: Path,
    proxy_path: Path,
    duration: float,
    resolution: str = "1280x720",
    preset: str = "fast",
    crf: int = 23,
    on_process_start: Optional[Callable[[subprocess.Popen], None]] = None,
    on_progress: Optional[Callable[[float], None]] = None,
    project_id: Optional[int] = None
) -> bool:
    """Gera um proxy MP4 H.264 usando aceleração por hardware (GPU) com fallback automático e transparente para CPU."""
    res_width, res_height = resolution.split('x') if 'x' in resolution else ("1280", "720")
    
    enc_pref, _ = get_hardware_settings(project_id)
    encoder_name, enc_args, is_hw = resolve_encoder_pipeline(enc_pref)
    
    scale_filter = f"scale={res_width}:{res_height}:force_original_aspect_ratio=decrease,pad={res_width}:{res_height}:(ow-iw)/2:(oh-ih)/2"
    
    def _build_cmd(codec: str, extra_args: list) -> list:
        return [
            'ffmpeg', '-y', '-i', str(original_path),
            '-progress', 'pipe:1',
            '-vf', scale_filter,
            '-c:v', codec,
            *extra_args,
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            str(proxy_path)
        ]

    cmd = _build_cmd(encoder_name, enc_args)
    
    def _run_ffmpeg_process(exec_cmd: list) -> bool:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        process = subprocess.Popen(
            exec_cmd,
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

    try:
        ok = _run_ffmpeg_process(cmd)
        if ok and proxy_path.exists() and proxy_path.stat().st_size > 0:
            return True
            
        if is_hw:
            print(f"[FFmpeg] Aceleração de hardware ({encoder_name}) falhou ao gerar proxy para {original_path.name}. Executando fallback para CPU (libx264)...")
            fallback_cmd = _build_cmd('libx264', ['-preset', preset, '-crf', str(crf)])
            return _run_ffmpeg_process(fallback_cmd)
        return False
    except Exception as e:
        print(f"[FFmpeg] Erro na geração de proxy para {original_path.name}: {e}")
        if is_hw:
            try:
                print(f"[FFmpeg] Tentando fallback para CPU (libx264)...")
                fallback_cmd = _build_cmd('libx264', ['-preset', preset, '-crf', str(crf)])
                return _run_ffmpeg_process(fallback_cmd)
            except Exception as fe:
                print(f"[FFmpeg] Fallback também falhou: {fe}")
        return False


def extract_thumbnail_frame(video_path: Path, timestamp: float, output_path: Path, width: int = 120) -> bool:
    """Extrai um único frame JPEG em baixa resolução de forma rápida, com tratamento para MTS e busca lenta como fallback."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
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
