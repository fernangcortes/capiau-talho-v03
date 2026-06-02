"""Serviço de Ingestão automatizada de mídias (Vídeos, Áudios e Fotos) com FFmpeg/FFprobe."""
import os
import sys
import time
import shutil
import hashlib
import subprocess
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from src.config import CONFIG
from src.db.operations import add_video, add_photo, update_video_status

# Limitar a no máximo 2 conversões FFmpeg simultâneas para poupar a CPU
PROXY_EXECUTOR = ThreadPoolExecutor(max_workers=2)

SUPPORTED_VIDEO = {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
SUPPORTED_AUDIO = {'.wav', '.mp3', '.m4a', '.bwf'}
SUPPORTED_PHOTO = {'.jpg', '.jpeg', '.png', '.tiff'}

def compute_hash(filepath: Path) -> str:
    """Calcula um hash SHA-256 parcial/completo de forma rápida para deduplicação."""
    h = hashlib.sha256()
    # Para arquivos muito grandes, ler em chunks de 64KB até no máximo 10MB para performance
    bytes_read = 0
    max_bytes = 10 * 1024 * 1024 # 10MB
    with open(filepath, 'rb') as f:
        while bytes_read < max_bytes:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
            bytes_read += len(chunk)
    return h.hexdigest()[:32]

def get_media_metadata(filepath: Path) -> dict:
    """Extrai metadados técnicos detalhados via FFprobe em formato JSON."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', str(filepath)
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
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
        print(f"[INGEST] Erro ao executar FFprobe no arquivo {filepath.name}: {e}")
        # Metadados de fallback se o ffprobe falhar
        return {
            'duration': 0.0,
            'fps': 0.0,
            'resolution': 'unknown',
            'codec': 'unknown',
            'bitrate': 0
        }

# Dicionários globais para controle de subprocessos FFmpeg e progresso em tempo real
ACTIVE_CONVERSIONS = {}   # video_id: subprocess.Popen
CONVERSION_PROGRESS = {}  # video_id: {"percent": float, "status": str}

def cancel_conversion(video_id: int) -> bool:
    """Cancela uma conversão de proxy em andamento e limpa o arquivo temporário."""
    process = ACTIVE_CONVERSIONS.get(video_id)
    if process:
        print(f"[INGEST] Cancelando conversão ativa do vídeo ID {video_id}...")
        try:
            if os.name == 'nt':
                # No Windows, taskkill com /T garante a morte de subprocessos filhos órfãos
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(process.pid)], capture_output=True)
            else:
                process.kill()
            process.wait(timeout=2)
        except Exception as e:
            print(f"[INGEST] Erro ao encerrar processo FFmpeg do vídeo {video_id}: {e}")
            
        if video_id in ACTIVE_CONVERSIONS:
            del ACTIVE_CONVERSIONS[video_id]
            
    # Forçar a reconfiguração no banco de dados e progresso para limpar qualquer travamento
    try:
        CONVERSION_PROGRESS[video_id] = {"percent": 0.0, "status": "cancelled"}
        update_video_status(video_id, 'ingested') # Força a voltar para status inicial para permitir reprocessar
        
        # Deletar arquivo proxy incompleto se existir
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        if proxy_path.exists():
            try:
                time.sleep(0.5)
                proxy_path.unlink()
            except Exception as ex:
                print(f"[INGEST] Aviso: Não foi possível deletar o proxy temporário parcial (bloqueado pelo SO): {ex}")
        return True
    except Exception as e:
        print(f"[INGEST] Erro crítico ao resetar status de cancelamento para o vídeo {video_id}: {e}")
        return False

def delete_proxy_file(video_id: int) -> bool:
    """Para qualquer conversão ativa e remove fisicamente o arquivo proxy gerado do disco."""
    cancel_conversion(video_id)
    
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    file_deleted = False
    
    if proxy_path.exists():
        try:
            proxy_path.unlink()
            file_deleted = True
            print(f"[INGEST] Proxy do vídeo ID {video_id} excluído com sucesso.")
        except Exception as e:
            print(f"[INGEST] Aviso: O arquivo proxy ID {video_id} está bloqueado por outro processo (WinError 32). Ignorando deleção física.")
            # No Windows, se o arquivo estiver bloqueado pelo player do navegador ou uvicorn serving,
            # ignoramos a falha física no momento para não travar a aplicação, pois o arquivo será limpo quando o servidor desligar.
            
    # Sempre resetamos o status no SQLite para permitir reprocessar
    try:
        update_video_status(video_id, 'ingested')
        if video_id in CONVERSION_PROGRESS:
            del CONVERSION_PROGRESS[video_id]
        return True
    except Exception as db_err:
        print(f"[INGEST] Erro ao reconfigurar status no banco de dados para ID {video_id}: {db_err}")
        return False

def generate_proxy(original_path: Path, proxy_path: Path, video_id: int, duration: float, target_res: str = None) -> bool:
    """Gera um proxy MP4 H.264 leve via FFmpeg com monitoramento em tempo real do progresso.
    
    Se target_res for "360p", gera em 640x360. Por padrão usa 1280x720 (720p).
    """
    if target_res is None:
        target_res = CONFIG.PROXY_RESOLUTION
        
    res_width, res_height = target_res.split('x') if 'x' in target_res else (1280, 720)
    
    # Comando FFmpeg com a opção '-progress pipe:1' para reportar progresso no stdout
    cmd = [
        'ffmpeg', '-y', '-i', str(original_path),
        '-progress', 'pipe:1',
        '-vf', f'scale={res_width}:{res_height}:force_original_aspect_ratio=decrease,pad={res_width}:{res_height}:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264',
        '-preset', CONFIG.PROXY_PRESET,
        '-crf', str(CONFIG.PROXY_CRF),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        str(proxy_path)
    ]
    
    print(f"[INGEST] FFmpeg gerando proxy ({target_res}) para vídeo ID {video_id}...")
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
        
        ACTIVE_CONVERSIONS[video_id] = process
        CONVERSION_PROGRESS[video_id] = {"percent": 0.0, "status": "running"}
        
        # Ler o progresso em tempo real da saída do stdout do FFmpeg
        while True:
            line = process.stdout.readline()
            if not line:
                break
            
            line = line.strip()
            if line.startswith("out_time_us="):
                try:
                    time_us = int(line.split("=")[1])
                    current_time = time_us / 1000000.0
                    if duration > 0:
                        percent = min((current_time / duration) * 100.0, 100.0)
                        CONVERSION_PROGRESS[video_id]["percent"] = round(percent, 1)
                except Exception:
                    pass
            elif line.startswith("progress="):
                progress_val = line.split("=")[1].strip()
                if progress_val == "end":
                    CONVERSION_PROGRESS[video_id]["percent"] = 100.0
                    
        process.communicate()
        returncode = process.returncode
        
        if video_id in ACTIVE_CONVERSIONS:
            del ACTIVE_CONVERSIONS[video_id]
            
        if returncode == 0:
            CONVERSION_PROGRESS[video_id] = {"percent": 100.0, "status": "finished"}
            print(f"  [OK] Proxy gerado com sucesso: {proxy_path.name}")
            return True
        else:
            # Se foi cancelado intencionalmente, o status já foi atualizado
            if CONVERSION_PROGRESS.get(video_id, {}).get("status") == "cancelled":
                return False
                
            CONVERSION_PROGRESS[video_id] = {"percent": 0.0, "status": "failed"}
            print(f"  [FALHA] FFmpeg retornou código de erro {returncode} para o vídeo {video_id}")
            return False
            
    except Exception as e:
        print(f"  [EXCEÇÃO] Falha ao executar subprocesso FFmpeg: {e}")
        if video_id in ACTIVE_CONVERSIONS:
            del ACTIVE_CONVERSIONS[video_id]
        CONVERSION_PROGRESS[video_id] = {"percent": 0.0, "status": "failed"}
        return False

def ingest_file(filepath: Path, project_id: int = 1, copy_original: bool = True) -> bool:
    """Ingere um único arquivo de mídia, catalogando no SQLite e gerando proxies."""
    ext = filepath.suffix.lower()
    
    if ext in SUPPORTED_VIDEO or ext in SUPPORTED_AUDIO:
        # Ingestão de Vídeo/Áudio
        print(f"\n[INGEST] Processando Vídeo/Áudio: {filepath.name}")
        file_hash = compute_hash(filepath)
        
        # Copiar para pasta oficial de originais somente se copy_original for True
        if copy_original:
            originals_path = CONFIG.ORIGINALS_DIR / filepath.name
            try:
                if not originals_path.exists():
                    shutil.copy2(filepath, originals_path)
                    print(f"  -> Arquivo copiado para originais: {originals_path.name}")
            except Exception as e:
                print(f"  [ERRO] Erro ao copiar mídia original: {e}")
                return False
        else:
            originals_path = filepath
            print(f"  -> Processando mídia em modo Link (sem cópia): {originals_path}")

            
        # Extrair metadados técnicos via FFprobe
        meta = get_media_metadata(originals_path)
        
        video_type = "interview" if "entrevista" in filepath.name.lower() or "depoimento" in filepath.name.lower() else "broll"
        
        # Registrar no banco SQLite
        video_id = add_video(
            project_id=project_id,
            filename=filepath.name,
            filepath=str(originals_path),
            file_hash=file_hash,
            video_type=video_type,
            duration=meta['duration'],
            fps=meta['fps'],
            resolution=meta['resolution'],
            codec=meta['codec'],
            bitrate=meta['bitrate']
        )
        
        # Gerar proxy MP4 em 720p para o player Web
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        if not proxy_path.exists():
            update_video_status(video_id, 'transcribing')
            
            def bg_proxy_task(vid_id, orig_path, px_path, dur):
                try:
                    success = generate_proxy(orig_path, px_path, vid_id, dur)
                    if success:
                        update_video_status(vid_id, 'ingested')
                    else:
                        update_video_status(vid_id, 'error', error_message="Falha na geração do proxy pelo FFmpeg")
                except Exception as e:
                    print(f"[BG_PROXY] Erro no ID {vid_id}: {e}")
                    update_video_status(vid_id, 'error', error_message=str(e))
            
            PROXY_EXECUTOR.submit(bg_proxy_task, video_id, originals_path, proxy_path, meta['duration'])
        else:
            update_video_status(video_id, 'ingested')
            
        print(f"  [OK] Vídeo ID: {video_id} catalogado e adicionado à fila de proxies.")
        return True
        
    elif ext in SUPPORTED_PHOTO:
        # Ingestão de Fotos de Set
        print(f"\n[INGEST] Processando Foto de Set: {filepath.name}")
        file_hash = compute_hash(filepath)
        
        if copy_original:
            photo_dest = CONFIG.ORIGINALS_DIR / filepath.name
            try:
                if not photo_dest.exists():
                    shutil.copy2(filepath, photo_dest)
                    print(f"  -> Foto copiada para originais: {photo_dest.name}")
            except Exception as e:
                print(f"  [ERRO] Erro ao copiar foto: {e}")
                return False
        else:
            photo_dest = filepath
            print(f"  -> Processando foto em modo Link (sem cópia): {photo_dest}")

            
        photo_id = add_photo(
            project_id=project_id,
            filename=filepath.name,
            filepath=str(photo_dest),
            file_hash=file_hash,
            description="Foto de set importada.",
            tags=[]
        )
        print(f"  [OK] Foto ID: {photo_id} registrada no SQLite.")
        return True
        
    return False

def scan_watch_folder(project_id: int = 1):
    """Efetua um escaneamento completo na pasta watch/ para processar novas mídias."""
    watch_path = CONFIG.WATCH_FOLDER
    
    files = [f for f in watch_path.iterdir() if f.is_file()]
    if not files:
        return
        
    print(f"\n[WATCH] Escaneando pasta watch: {watch_path}... (Detectados {len(files)} arquivos)")
        
    for f in files:
        try:
            success = ingest_file(f, project_id)
            if success:
                # Opcional: remover da pasta 'watch' original após o processamento completo
                f.unlink()
                print(f"  [REMOVIDO] Arquivo original removido da pasta watch: {f.name}")
        except Exception as e:
            print(f"  [ERRO] Erro ao processar o arquivo {f.name}: {e}")

def watch_folder_loop(interval: int = 5):
    """Monitora a pasta watch/ em loop contínuo."""
    print("="*60)
    print(f"       SERVIÇO MONITOR DE INGESTÃO CAPIAU 24/7")
    print(f"       Monitorando: {CONFIG.WATCH_FOLDER}")
    print("="*60)
    
    try:
        while True:
            scan_watch_folder()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[WATCH] Monitoramento finalizado pelo usuário.")

def ingest_external_path(target_path: Path, project_id: int = 1) -> dict:
    """Ingere arquivos de um diretório ou arquivo externo em modo 'Link' (sem copiar o arquivo original)."""
    if not target_path.exists():
        return {"status": "error", "message": "O caminho especificado não existe."}
        
    ingested_count = 0
    errors = []
    
    if target_path.is_file():
        ext = target_path.suffix.lower()
        if ext in SUPPORTED_VIDEO or ext in SUPPORTED_AUDIO or ext in SUPPORTED_PHOTO:
            try:
                success = ingest_file(target_path, project_id, copy_original=False)
                if success:
                    ingested_count += 1
            except Exception as e:
                errors.append(f"Erro no arquivo {target_path.name}: {str(e)}")
    elif target_path.is_dir():
        # Escanear recursivamente todos os subdiretórios
        for root, _, files in os.walk(target_path):
            for file in files:
                filepath = Path(root) / file
                ext = filepath.suffix.lower()
                if ext in SUPPORTED_VIDEO or ext in SUPPORTED_AUDIO or ext in SUPPORTED_PHOTO:
                    try:
                        success = ingest_file(filepath, project_id, copy_original=False)
                        if success:
                            ingested_count += 1
                    except Exception as e:
                        errors.append(f"Erro no arquivo {filepath.name}: {str(e)}")
                        
    return {
        "status": "success",
        "ingested_count": ingested_count,
        "errors": errors
    }

        
if __name__ == "__main__":
    scan_watch_folder()
