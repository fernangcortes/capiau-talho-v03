"""Serviço de Ingestão de Mídias coordenando hashes, metadados e geração de proxies."""
import os
import shutil
import time
from pathlib import Path
from typing import Dict, Any

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.core.tasks import TASK_MANAGER
from src.core.exceptions import IngestError
from src.media.ffmpeg import get_media_metadata, generate_video_proxy
from src.media.image_processing import generate_photo_proxy
from src.vision.face_engine import process_photo_faces

SUPPORTED_VIDEO = {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
SUPPORTED_AUDIO = {'.wav', '.mp3', '.m4a', '.bwf'}
SUPPORTED_PHOTO = {
    '.jpg', '.jpeg', '.png', '.tiff',
    '.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'
}

def compute_hash(filepath: Path) -> str:
    """Calcula hash SHA-256 parcial/rápido de arquivos grandes para deduplicação."""
    import hashlib
    h = hashlib.sha256()
    bytes_read = 0
    max_bytes = 10 * 1024 * 1024  # Limite de leitura de 10MB para performance
    with open(filepath, 'rb') as f:
        while bytes_read < max_bytes:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
            bytes_read += len(chunk)
    return h.hexdigest()[:32]

class IngestService:
    @staticmethod
    def ingest_file(filepath: Path, project_id: int = 1, copy_original: bool = True) -> bool:
        """Ingere um único arquivo de mídia (copiando, extraindo metadados e enfileirando proxy)."""
        if not filepath.exists():
            raise IngestError(f"Arquivo não encontrado: {filepath}")
            
        ext = filepath.suffix.lower()
        if ext not in SUPPORTED_VIDEO and ext not in SUPPORTED_AUDIO and ext not in SUPPORTED_PHOTO:
            return False
            
        file_hash = compute_hash(filepath)
        filename = filepath.name
        
        # Define diretório de destino original se solicitado copiar
        if copy_original:
            dest_dir = CONFIG.ORIGINALS_DIR
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest_path = dest_dir / filename
            
            # Resolve colisões de nome físico mantendo o hash intacto
            counter = 1
            while dest_path.exists():
                name_stem = filepath.stem
                dest_path = dest_dir / f"{name_stem}_{counter}{ext}"
                counter += 1
                
            shutil.copy2(filepath, dest_path)
            target_path = dest_path
        else:
            target_path = filepath
            
        # Inserção no banco SQLite
        with get_db() as conn:
            if ext in SUPPORTED_VIDEO or ext in SUPPORTED_AUDIO:
                # Determina tipo de vídeo inicial com base na nomenclatura da pasta/arquivo
                filepath_lower = str(filepath).lower()
                if any(k in filepath_lower for k in ["interview", "depoimento", "entrevista"]):
                    video_type = "interview"
                elif any(k in filepath_lower for k in ["broll", "b-roll", "bastidores"]):
                    video_type = "broll"
                else:
                    video_type = "unknown"
                
                # Extrai metadados técnicos
                meta = get_media_metadata(target_path)
                media_id = MediaRepository.add_video(
                    conn,
                    project_id=project_id,
                    filename=filename,
                    filepath=str(target_path).replace('\\', '/'),
                    file_hash=file_hash,
                    video_type=video_type,
                    duration=meta['duration'],
                    fps=meta['fps'],
                    resolution=meta['resolution'],
                    codec=meta['codec'],
                    bitrate=meta['bitrate']
                )
                
                # Agenda geração de proxy de vídeo em background
                TASK_MANAGER.executor.submit(
                    IngestService._generate_video_proxy_task,
                    media_id,
                    target_path,
                    meta['duration']
                )
            else:
                # Inserção de foto
                media_id = MediaRepository.add_photo(
                    conn,
                    project_id=project_id,
                    filename=filename,
                    filepath=str(target_path).replace('\\', '/'),
                    file_hash=file_hash
                )
                
                # Agenda geração de proxy e detecção de rostos da foto
                TASK_MANAGER.executor.submit(
                    IngestService._generate_photo_proxy_task,
                    project_id,
                    media_id,
                    target_path
                )
        return True

    @staticmethod
    def ingest_external_path(path_obj: Path, project_id: int) -> Dict[str, Any]:
        """Varre recursivamente uma pasta externa ou ingere arquivo individual in-place (sem cópia)."""
        ingested_count = 0
        if path_obj.is_file():
            if IngestService.ingest_file(path_obj, project_id, copy_original=False):
                ingested_count = 1
        elif path_obj.is_dir():
            for root, _, files in os.walk(path_obj):
                for f in files:
                    filepath = Path(root) / f
                    try:
                        if IngestService.ingest_file(filepath, project_id, copy_original=False):
                            ingested_count += 1
                    except Exception as ex:
                        print(f"[IngestService] Erro ao ingerir {filepath.name}: {ex}")
                        
        return {
            "status": "success",
            "ingested_count": ingested_count
        }

    @staticmethod
    def _generate_video_proxy_task(video_id: int, original_path: Path, duration: float) -> None:
        """Tarefa executada em ThreadPool para processar o proxy de vídeo pelo FFmpeg."""
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        
        # Callbacks para reportar ao TaskManager
        def on_start(proc: Any) -> None:
            TASK_MANAGER.register_process(video_id, proc)
            TASK_MANAGER.update_progress(str(video_id), 0.0, "running")
            
        def on_prog(percent: float) -> None:
            TASK_MANAGER.update_progress(str(video_id), percent, "running")

        try:
            # Garante limpeza de qualquer arquivo temporário prévio
            if proxy_path.exists():
                try:
                    proxy_path.unlink()
                except Exception:
                    time.sleep(0.5)
                    try:
                        proxy_path.unlink()
                    except Exception:
                        pass

            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'transcribing')
                
            success = generate_video_proxy(
                original_path,
                proxy_path,
                duration,
                resolution=CONFIG.PROXY_RESOLUTION,
                preset=CONFIG.PROXY_PRESET,
                crf=CONFIG.PROXY_CRF,
                on_process_start=on_start,
                on_progress=on_prog
            )
            
            with get_db() as conn:
                if success:
                    MediaRepository.update_video_status(conn, video_id, 'ingested')
                    TASK_MANAGER.update_progress(str(video_id), 100.0, "finished")
                else:
                    # Verifica se foi cancelado de forma manual
                    current_prog = TASK_MANAGER.get_progress().get(str(video_id), {})
                    if current_prog.get("status") == "cancelled":
                        return
                    MediaRepository.update_video_status(
                        conn, video_id, 'error',
                        error_message="Falha na compressão do proxy pelo FFmpeg"
                    )
                    TASK_MANAGER.update_progress(str(video_id), 0.0, "failed")
        except Exception as e:
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'error', error_message=str(e))
            TASK_MANAGER.update_progress(str(video_id), 0.0, "failed")
        finally:
            TASK_MANAGER.unregister_process(video_id)

    @staticmethod
    def _generate_photo_proxy_task(project_id: int, photo_id: int, original_path: Path) -> None:
        """Tarefa em background para processamento de fotos e reconhecimento facial."""
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
        
        try:
            with get_db() as conn:
                MediaRepository.update_photo_status(conn, photo_id, 'pending')
                
            success = generate_photo_proxy(original_path, proxy_path)
            
            with get_db() as conn:
                if success:
                    MediaRepository.update_photo_status(conn, photo_id, 'ingested')
                    
                    # Roda detecção facial no proxy gerado
                    try:
                        process_photo_faces(project_id, photo_id, proxy_path)
                    except Exception as fe:
                        print(f"[IngestService] Erro na detecção de rostos da foto {photo_id}: {fe}")
                else:
                    MediaRepository.update_photo_status(conn, photo_id, 'error')
        except Exception as e:
            print(f"[IngestService] Falha crítica no processamento da foto {photo_id}: {e}")
            with get_db() as conn:
                MediaRepository.update_photo_status(conn, photo_id, 'error')
