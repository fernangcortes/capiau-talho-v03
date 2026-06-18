"""Monitor de pasta de ingestão (watch/) e interface de compatibilidade delegada."""
import time
from pathlib import Path
from typing import Dict, Any, Optional

from src.config import CONFIG
from src.core.tasks import TASK_MANAGER
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.services.ingest import IngestService, compute_hash
from src.media.ffmpeg import get_media_metadata, generate_video_proxy
from src.media.image_processing import generate_photo_proxy

# Mapeamentos de compatibilidade para código legado
PROXY_EXECUTOR = TASK_MANAGER.executor
ACTIVE_CONVERSIONS = TASK_MANAGER.active_processes
CONVERSION_PROGRESS = TASK_MANAGER.progress

SUPPORTED_VIDEO = {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
SUPPORTED_AUDIO = {'.wav', '.mp3', '.m4a', '.bwf'}
SUPPORTED_PHOTO = {
    '.jpg', '.jpeg', '.png', '.tiff',
    '.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'
}

def cancel_conversion(video_id: int) -> bool:
    """Cancela uma conversão ativa e atualiza o status de progresso."""
    success = TASK_MANAGER.cancel_process(video_id)
    TASK_MANAGER.update_progress(str(video_id), 0.0, "cancelled")
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    return success

def delete_proxy_file(video_id: int) -> bool:
    """Exclui o arquivo proxy de vídeo e reseta o status."""
    cancel_conversion(video_id)
    proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
    if proxy_path.exists():
        try:
            proxy_path.unlink()
        except Exception as e:
            print(f"[WatcherCompat] Não foi possível apagar o proxy físico: {e}")
            
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, 'ingested')
    TASK_MANAGER.remove_progress(str(video_id))
    return True

def ingest_file(filepath: Path, project_id: int = 1, copy_original: bool = True) -> bool:
    """Delega ingestão de arquivos para IngestService."""
    return IngestService.ingest_file(filepath, project_id, copy_original)

def ingest_external_path(target_path: Path, project_id: int = 1) -> dict:
    """Delega escaneamento in-place para IngestService."""
    return IngestService.ingest_external_path(target_path, project_id)

def scan_watch_folder(project_id: int = 1) -> None:
    """Escaneia a pasta watch/ e ingere novos arquivos encontrados."""
    watch_path = CONFIG.WATCH_FOLDER
    if not watch_path.exists():
        return
        
    files = [f for f in watch_path.iterdir() if f.is_file()]
    if not files:
        return
        
    print(f"\n[WATCH] Escaneando pasta watch: {watch_path}... (Detectados {len(files)} arquivos)")
    for f in files:
        try:
            success = ingest_file(f, project_id)
            if success:
                f.unlink()
                print(f"  [OK] Removido da pasta watch: {f.name}")
        except Exception as e:
            print(f"  [ERRO] Falha ao processar arquivo {f.name} do watch: {e}")

def watch_folder_loop(interval: int = 5) -> None:
    """Loop contínuo de monitoramento da pasta watch/."""
    print("="*60)
    print(f"       MONITOR DE INGESTÃO MODULAR 24/7")
    print(f"       Monitorando: {CONFIG.WATCH_FOLDER}")
    print("="*60)
    try:
        while True:
            scan_watch_folder()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\n[WATCH] Monitoramento abortado pelo usuário.")
