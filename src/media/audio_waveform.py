"""Módulo de extração e gerenciamento de formas de onda (Waveforms) de áudio reais.

Extrai picos Min/Max normalizados (-1.0 a 1.0) em alta resolução (ex: 100 Hz = 10ms por balde)
diretamente do stream PCM de áudio via FFmpeg, gravando em cache JSON compacto.
"""
import os
import json
import math
import subprocess
import numpy as np
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from src.config import CONFIG
from src.db.connection import get_db
from src.media.ffmpeg import has_audio_stream

DEFAULT_SAMPLE_RATE = 100  # 100 picos/segundo (1 amostra a cada 10ms)
PCM_AUDIO_SAMPLE_RATE = 8000  # Taxa de reamostragem leve para decodificação rápida


def _startupinfo():
    """Startup info para ocultar janela de console no Windows."""
    if os.name == 'nt':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        return startupinfo
    return None


def get_waveform_cache_path(video_id: int) -> Path:
    """Retorna o caminho do arquivo de cache de waveform para um vídeo."""
    CONFIG.WAVEFORMS_DIR.mkdir(parents=True, exist_ok=True)
    return CONFIG.WAVEFORMS_DIR / f"waveform_{video_id}.json"


def extract_waveform_peaks(
    media_path: Path,
    output_path: Optional[Path] = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE
) -> Dict[str, Any]:
    """
    Extrai os picos Min/Max do arquivo de áudio ou vídeo via FFmpeg streaming f32le.
    
    Retorna dicionário com:
    - video_id: id ou None
    - sample_rate: amostras por segundo (ex: 100)
    - duration: duração total em segundos
    - peaks: lista plana [min0, max0, min1, max1, ...] com valores entre -1.0 e 1.0
    """
    media_path = Path(media_path)
    if not media_path.exists():
        return {
            "sample_rate": sample_rate,
            "duration": 0.0,
            "peaks": [],
            "error": f"Arquivo não encontrado: {media_path}"
        }

    # Verifica se há stream de áudio
    if not has_audio_stream(media_path):
        return {
            "sample_rate": sample_rate,
            "duration": 0.0,
            "peaks": [],
            "error": "Sem stream de áudio detectada"
        }

    # Calcula o tamanho do bloco de áudio por pico
    # Ex: 8000 Hz / 100 picos/s = 80 amostras por balde
    samples_per_bucket = max(1, PCM_AUDIO_SAMPLE_RATE // sample_rate)

    cmd = [
        'ffmpeg', '-v', 'error', '-y',
        '-i', str(media_path),
        '-vn',
        '-ac', '1',
        '-ar', str(PCM_AUDIO_SAMPLE_RATE),
        '-f', 'f32le',
        '-'
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=_startupinfo()
        )
        
        raw_audio, stderr = proc.communicate(timeout=120)
        
        if proc.returncode != 0 and not raw_audio:
            err_msg = stderr.decode('utf-8', errors='ignore').strip()
            return {
                "sample_rate": sample_rate,
                "duration": 0.0,
                "peaks": [],
                "error": f"FFmpeg falhou: {err_msg}"
            }

        # Converte bytes brutos float32 le em array numpy
        if not raw_audio:
            return {
                "sample_rate": sample_rate,
                "duration": 0.0,
                "peaks": [],
                "error": "Nenhum dado de áudio extraído"
            }

        audio_data = np.frombuffer(raw_audio, dtype=np.float32)
        total_audio_samples = len(audio_data)
        
        if total_audio_samples == 0:
            return {
                "sample_rate": sample_rate,
                "duration": 0.0,
                "peaks": [],
                "error": "Buffer de áudio vazio"
            }

        # Duração total em segundos
        duration = round(total_audio_samples / PCM_AUDIO_SAMPLE_RATE, 3)

        # Trunca para múltiplos exatos de samples_per_bucket
        num_buckets = total_audio_samples // samples_per_bucket
        remainder = total_audio_samples % samples_per_bucket
        
        if num_buckets == 0 and remainder > 0:
            # Áudio muito curto (< 10ms)
            min_val = float(np.min(audio_data))
            max_val = float(np.max(audio_data))
            peaks = [round(max(-1.0, min(1.0, min_val)), 3), round(max(-1.0, min(1.0, max_val)), 3)]
        else:
            main_data = audio_data[:num_buckets * samples_per_bucket].reshape(num_buckets, samples_per_bucket)
            mins = np.min(main_data, axis=1)
            maxs = np.max(main_data, axis=1)
            
            # Garante limites [-1.0, 1.0] e arredondamento a 3 casas decimais
            mins = np.clip(mins, -1.0, 1.0)
            maxs = np.clip(maxs, -1.0, 1.0)
            
            # Se houver resto no fim
            if remainder > 0:
                rem_data = audio_data[num_buckets * samples_per_bucket:]
                rem_min = float(np.clip(np.min(rem_data), -1.0, 1.0))
                rem_max = float(np.clip(np.max(rem_data), -1.0, 1.0))
                mins = np.append(mins, rem_min)
                maxs = np.append(maxs, rem_max)
                num_buckets += 1

            # Intercala mins e maxs em lista plana: [min0, max0, min1, max1, ...]
            # Usando np.column_stack para velocidade máxima
            interleaved = np.column_stack((mins, maxs)).reshape(-1)
            peaks = [round(float(v), 3) for v in interleaved]

        result = {
            "sample_rate": sample_rate,
            "duration": duration,
            "peaks": peaks
        }

        # Salva em arquivo de cache se solicitado
        if output_path:
            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(result, f)

        return result

    except subprocess.TimeoutExpired:
        proc.kill()
        return {
            "sample_rate": sample_rate,
            "duration": 0.0,
            "peaks": [],
            "error": "Timeout ao extrair áudio com FFmpeg"
        }
    except Exception as e:
        return {
            "sample_rate": sample_rate,
            "duration": 0.0,
            "peaks": [],
            "error": str(e)
        }


def get_or_generate_waveform(
    video_id: int,
    conn=None,
    force: bool = False,
    sample_rate: int = DEFAULT_SAMPLE_RATE
) -> Dict[str, Any]:
    """
    Recupera a waveform do cache ou gera no momento da requisição se ainda não existir.
    """
    cache_path = get_waveform_cache_path(video_id)
    
    if not force and cache_path.exists() and cache_path.stat().st_size > 10:
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                data["video_id"] = video_id
                return data
        except Exception:
            pass  # Se o cache estiver corrompido, regenera

    # Busca o caminho do arquivo no banco
    close_conn = False
    if conn is None:
        db_gen = get_db()
        conn = next(db_gen)
        close_conn = True

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT filepath, filename FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if not row:
            return {
                "video_id": video_id,
                "sample_rate": sample_rate,
                "duration": 0.0,
                "peaks": [],
                "error": f"Vídeo com ID {video_id} não encontrado no banco"
            }

        filepath_str = row[0] or ""
        media_path = Path(filepath_str)
        if not media_path.exists():
            # Fallback para data/originals se filepath for relativo ou mudou de pasta
            alt_path = CONFIG.ORIGINALS_DIR / row[1]
            if alt_path.exists():
                media_path = alt_path

        waveform_data = extract_waveform_peaks(
            media_path=media_path,
            output_path=cache_path,
            sample_rate=sample_rate
        )
        waveform_data["video_id"] = video_id
        return waveform_data

    finally:
        if close_conn:
            try:
                conn.close()
            except Exception:
                pass


def batch_generate_project_waveforms(
    project_id: int = 1,
    conn=None,
    force: bool = False,
    sample_rate: int = DEFAULT_SAMPLE_RATE
) -> Dict[str, Any]:
    """
    Gera waveforms para todos os vídeos de um projeto que ainda não possuem cache.
    """
    close_conn = False
    if conn is None:
        db_gen = get_db()
        conn = next(db_gen)
        close_conn = True

    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, filepath, filename FROM video WHERE project_id = ?", (project_id,))
        videos = cursor.fetchall()

        total = len(videos)
        generated = 0
        skipped = 0
        errors = []

        for vid_id, filepath_str, filename in videos:
            cache_path = get_waveform_cache_path(vid_id)
            if not force and cache_path.exists() and cache_path.stat().st_size > 10:
                skipped += 1
                continue

            media_path = Path(filepath_str) if filepath_str else Path("")
            if not media_path.exists():
                alt_path = CONFIG.ORIGINALS_DIR / filename
                if alt_path.exists():
                    media_path = alt_path

            if not media_path.exists():
                errors.append({"video_id": vid_id, "error": f"Arquivo não encontrado: {filename}"})
                continue

            res = extract_waveform_peaks(media_path, output_path=cache_path, sample_rate=sample_rate)
            if res.get("error"):
                errors.append({"video_id": vid_id, "error": res["error"]})
            else:
                generated += 1

        return {
            "project_id": project_id,
            "total_videos": total,
            "generated": generated,
            "skipped": skipped,
            "errors": errors
        }

    finally:
        if close_conn:
            try:
                conn.close()
            except Exception:
                pass
