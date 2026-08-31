"""Serviço de Ingestão de Mídias coordenando hashes, metadados e geração de proxies."""
import os
import shutil
import time
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple, Union

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.core.tasks import TASK_MANAGER
from src.core.exceptions import IngestError
from src.media.ffmpeg import get_media_metadata, generate_video_proxy, extract_thumbnail_frame
from src.media.image_processing import generate_photo_proxy
from src.vision.face_engine import process_photo_faces

SUPPORTED_VIDEO = {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
SUPPORTED_AUDIO = {'.wav', '.mp3', '.m4a', '.bwf'}
SUPPORTED_PHOTO = {
    '.jpg', '.jpeg', '.png', '.tiff',
    '.arw', '.cr2', '.nef', '.dng', '.pef', '.raf', '.orf', '.rw2', '.raw'
}

def _registrar_cor_video(conn, video_id: int, filename: str, meta: Dict[str, Any]) -> None:
    """Grava o bloco de cor do vídeo na ingestão (Fase 0 de docs/PLANO_COR_OCIO.md).

    As tags já vieram no `meta` do FFprobe -- não há chamada extra a disco aqui.
    Falha NUNCA derruba a ingestão: cor é acessório, mídia ingerida é o principal
    (mesma regra do E2.A5 escrita em image_semantic.py).
    """
    try:
        from src.color import deteccao
        MediaRepository.update_video_color(conn, video_id, deteccao.resolver(meta))
    except Exception as e:
        print(f"[Cor] Falha ao registrar cor de {filename} (ingestão segue): {e}")


def _registrar_cor_foto(conn, photo_id: int, filename: str, caminho: Path) -> None:
    """Idem para foto: perfil pela extensão (RAW) ou pelo EXIF (JPEG/PNG)."""
    try:
        from src.color import deteccao
        MediaRepository.update_photo_color(conn, photo_id, deteccao.resolver_foto(caminho))
    except Exception as e:
        print(f"[Cor] Falha ao registrar cor de {filename} (ingestão segue): {e}")


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
    def ingest_file(filepath: Path, project_id: int = 1, copy_original: bool = True, virtual_folder: str = "root") -> Optional[int]:
        """Ingere um único arquivo de mídia (copiando, extraindo metadados e enfileirando proxy). Retorna o ID da mídia."""
        if not filepath.exists():
            raise IngestError(f"Arquivo não encontrado: {filepath}")
            
        ext = filepath.suffix.lower()
        if ext not in SUPPORTED_VIDEO and ext not in SUPPORTED_AUDIO and ext not in SUPPORTED_PHOTO:
            return None
            
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
        media_id = None
        media_type = None
        duration = None
        
        with get_db() as conn:
            # Garante que o project_id exista no banco para evitar violação de FOREIGN KEY
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM project WHERE id = ?", (project_id,))
            if not cursor.fetchone():
                cursor.execute("SELECT id FROM project ORDER BY id DESC LIMIT 1")
                p_row = cursor.fetchone()
                if p_row:
                    project_id = p_row["id"]

            if ext in SUPPORTED_VIDEO or ext in SUPPORTED_AUDIO:
                media_type = "video"
                # Determina tipo de vídeo inicial com base na nomenclatura da pasta/arquivo
                filepath_lower = str(filepath).lower()
                if any(k in filepath_lower for k in ["interview", "depoimento", "entrevista"]):
                    video_type = "interview"
                elif any(k in filepath_lower for k in ["broll", "b-roll", "bastidores"]):
                    video_type = "broll"
                else:
                    video_type = "unknown"
                
                # Extrai metadados técnicos e data de gravação
                meta = get_media_metadata(target_path)
                duration = meta['duration']
                recorded_at = meta.get('creation_time')
                if not recorded_at:
                    try:
                        import datetime
                        mtime = target_path.stat().st_mtime
                        recorded_at = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        recorded_at = None

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
                    bitrate=meta['bitrate'],
                    virtual_folder=virtual_folder or "root",
                    recorded_at=recorded_at
                )
                _registrar_cor_video(conn, media_id, filename, meta)
            else:
                media_type = "photo"
                recorded_at = None
                try:
                    from PIL import Image, ExifTags
                    with Image.open(target_path) as img:
                        exif = img._getexif()
                        if exif:
                            for tag, val in exif.items():
                                if ExifTags.TAGS.get(tag) in ('DateTimeOriginal', 'DateTimeDigitized', 'DateTime'):
                                    recorded_at = str(val).replace(':', '-', 2)
                                    break
                except Exception:
                    pass
                if not recorded_at:
                    try:
                        import datetime
                        mtime = target_path.stat().st_mtime
                        recorded_at = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
                    except Exception:
                        recorded_at = None

                # Inserção de foto
                media_id = MediaRepository.add_photo(
                    conn,
                    project_id=project_id,
                    filename=filename,
                    filepath=str(target_path).replace('\\', '/'),
                    file_hash=file_hash,
                    virtual_folder=virtual_folder or "root",
                    recorded_at=recorded_at
                )
                _registrar_cor_foto(conn, media_id, filename, target_path)
                
        # Agenda as tarefas em background APÓS fechar a conexão do banco para evitar database is locked
        if media_type == "video":
            TASK_MANAGER.executor.submit(
                IngestService._generate_video_proxy_task,
                media_id,
                target_path,
                duration
            )
        elif media_type == "photo":
            TASK_MANAGER.executor.submit(
                IngestService._generate_photo_proxy_task,
                project_id,
                media_id,
                target_path
            )
        return media_id


    @staticmethod
    def ingest_external_path(path_obj: Path, project_id: int, target_virtual_folder: str = "root", preserve_subfolders: bool = True) -> Dict[str, Any]:
        """Varre recursivamente uma pasta externa ou ingere arquivo individual in-place (sem cópia)."""
        ingested_count = 0
        ingested_ids = []
        if path_obj.is_file():
            mid = IngestService.ingest_file(path_obj, project_id, copy_original=False, virtual_folder=target_virtual_folder)
            if mid:
                ingested_count = 1
                ingested_ids.append(mid)
        elif path_obj.is_dir():
            base_folder = target_virtual_folder or "root"
            pending_bins: Dict[str, str] = {}   # path -> nome do bin (deduplicado por pasta, nao por arquivo)

            def virtual_folder_for(file_path: Path) -> str:
                """Mapeia a subpasta de disco para o bin virtual correspondente, registrando os ancestrais."""
                if not preserve_subfolders:
                    return base_folder
                try:
                    rel = file_path.parent.relative_to(path_obj)
                except ValueError:
                    return base_folder
                parts = [p for p in rel.as_posix().split("/") if p and p != "."]
                if not parts:
                    return base_folder
                current = base_folder
                for part in parts:
                    current = f"{current}/{part}"
                    pending_bins.setdefault(current, part)
                return current

            for root, _, files in os.walk(path_obj):
                for f in files:
                    filepath = Path(root) / f
                    try:
                        mid = IngestService.ingest_file(
                            filepath, project_id, copy_original=False,
                            virtual_folder=virtual_folder_for(filepath)
                        )
                        if mid:
                            ingested_count += 1
                            ingested_ids.append(mid)
                    except Exception as ex:
                        print(f"[IngestService] Erro ao ingerir {filepath.name}: {ex}")

            # Registra todos os bins descobertos em uma unica transacao (era 1 commit por arquivo)
            if pending_bins:
                try:
                    with get_db() as conn:
                        for bin_path, bin_name in sorted(pending_bins.items()):
                            parent = bin_path.rsplit("/", 1)[0] if "/" in bin_path else "root"
                            conn.execute("""
                                INSERT INTO media_bin (project_id, name, path, parent_path, color)
                                VALUES (?, ?, ?, ?, ?)
                                ON CONFLICT(project_id, path) DO UPDATE SET
                                    name = excluded.name,
                                    parent_path = excluded.parent_path
                            """, (project_id, bin_name, bin_path, parent, "#8b5cf6"))
                except Exception as ex:
                    print(f"[IngestService] Erro ao registrar bins virtuais: {ex}")

        return {
            "status": "success",
            "ingested_count": ingested_count,
            "media_ids": ingested_ids
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
                    
                    # Gera a miniatura principal da capa (thumb_{video_id}.jpg)
                    try:
                        thumb_main = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}.jpg"
                        if not thumb_main.exists() or thumb_main.stat().st_size == 0:
                            target_time = max(1.0, duration * 0.1)
                            success_thumb = extract_frame(proxy_path, target_time, thumb_main)
                            if not success_thumb or not thumb_main.exists():
                                extract_frame(proxy_path, 0.0, thumb_main)
                    except Exception as th_err:
                        print(f"[IngestService] Erro ao extrair thumbnail principal: {th_err}")

                    # Dispara a geração de miniaturas progressivas em segundo plano
                    TASK_MANAGER.executor.submit(
                        IngestService._generate_timeline_thumbnails_task,
                        video_id, proxy_path, duration
                    )

                    # Dispara a extração de waveform de áudio real em segundo plano
                    TASK_MANAGER.executor.submit(
                        IngestService._generate_waveform_task,
                        video_id, original_path
                    )
                    
                    # S3 Upload in background
                    try:
                        from src.services.s3_service import S3Service
                        s3_service = S3Service.get_instance()
                        if s3_service.enabled:
                            TASK_MANAGER.executor.submit(
                                s3_service.upload_file,
                                proxy_path,
                                f"proxies/proxy_vid_{video_id}.mp4"
                            )
                    except Exception as s3_err:
                        print(f"[IngestService] Erro ao disparar upload do proxy de video para S3: {s3_err}")
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
                else:
                    MediaRepository.update_photo_status(conn, photo_id, 'error')
                    
            if success:
                # Roda detecção facial no proxy gerado (fora da transação de status)
                try:
                    process_photo_faces(project_id, photo_id, proxy_path)
                except Exception as fe:
                    print(f"[IngestService] Erro na detecção de rostos da foto {photo_id}: {fe}")
        except Exception as e:
            print(f"[IngestService] Falha crítica no processamento da foto {photo_id}: {e}")
            with get_db() as conn:
                MediaRepository.update_photo_status(conn, photo_id, 'error')

    @staticmethod
    def _generate_timeline_thumbnails_task(video_id: int, filepath: Path, duration: float) -> None:
        """Gera miniaturas de forma progressiva (subdivisão BFS) com throttling inteligente."""
        from src.media.ffmpeg import extract_thumbnail_frame
        
        task_key = f"thumbs-{video_id}"
        TASK_MANAGER.update_progress(task_key, 0.0, "running", task_type="thumbnails")
        
        # Miniaturas cobrem 100% da duração do vídeo (do segundo 0 até o final da mídia)
        max_sec = int(round(duration)) if duration > 0 else 0
        timestamps = list(range(0, max_sec + 1))
        if not timestamps:
            timestamps = [0.0]
            
        n = len(timestamps)
        
        # Algoritmo BFS para ordenar timestamps de forma progressiva (subdivisão binária)
        # Queremos: meio, início útil, fim útil, e depois metades recursivas.
        order_indices = []
        if n > 0:
            if n == 1:
                order_indices = [0]
            elif n == 2:
                order_indices = [0, 1]
            else:
                first = 0
                last = n - 1
                mid = (n - 1) // 2
                
                order_indices = [mid, first, last]
                visited = {mid, first, last}
                
                queue = [(first, mid), (mid, last)]
                while queue:
                    left, right = queue.pop(0)
                    if right - left <= 1:
                        continue
                    m = (left + right) // 2
                    if m not in visited:
                        order_indices.append(m)
                        visited.add(m)
                    queue.append((left, m))
                    queue.append((m, right))
                    
                # Adiciona qualquer restante que possa ter escapado
                for i in range(n):
                    if i not in visited:
                        order_indices.append(i)
                        
        ordered_timestamps = [float(timestamps[idx]) for idx in order_indices]
        
        # Cria diretório de miniaturas se não existir
        CONFIG.THUMBNAILS_DIR.mkdir(parents=True, exist_ok=True)
        
        successful_extractions = 0
        total_to_extract = len(ordered_timestamps)
        
        try:
            for idx, timestamp in enumerate(ordered_timestamps):
                # Check for cancellation or pause (Option B: exit thread to release slot)
                progress_pct = (successful_extractions / max(1, total_to_extract)) * 100.0
                if task_key in TASK_MANAGER.cancelled_tasks:
                    TASK_MANAGER.update_progress(task_key, round(progress_pct, 1), "cancelled", task_type="thumbnails")
                    print(f"[IngestService] Geração de miniaturas para o vídeo ID {video_id} cancelada.")
                    return
                if task_key in TASK_MANAGER.paused_tasks:
                    TASK_MANAGER.update_progress(task_key, round(progress_pct, 1), "paused", task_type="thumbnails")
                    print(f"[IngestService] Geração de miniaturas para o vídeo ID {video_id} pausada (thread liberada).")
                    return

                # O nome do arquivo segue o padrão de índice baseado no tempo arredondado
                # index = round(time / 1.0) + 1
                file_idx = int(round(timestamp)) + 1
                out_path = CONFIG.THUMBNAILS_DIR / f"thumb_{video_id}_seq_{file_idx:04d}.jpg"
                
                # Se já existir, pula a extração física, mas conta como sucesso
                if out_path.exists() and out_path.stat().st_size > 0:
                    successful_extractions += 1
                else:
                    target_timestamp = min(timestamp, max(0.0, duration - 0.05))
                    success = extract_thumbnail_frame(filepath, target_timestamp, out_path, width=120)
                    if success:
                        successful_extractions += 1
                
                # Reporta o progresso da tarefa
                progress_pct = (successful_extractions / total_to_extract) * 100.0
                TASK_MANAGER.update_progress(task_key, round(progress_pct, 1), "running", task_type="thumbnails")
                
                # Throttling cooperativo com base na atividade do usuário
                if TASK_MANAGER.is_user_active():
                    time.sleep(0.3)  # desacelera
                else:
                    time.sleep(0.02) # velocidade total
                    
            TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="thumbnails")
            print(f"[IngestService] Miniaturas geradas com sucesso para o vídeo ID {video_id} ({successful_extractions}/{total_to_extract} frames).")
        except Exception as e:
            print(f"[IngestService] Erro ao gerar miniaturas para o vídeo ID {video_id}: {e}")
            TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="thumbnails")

    @staticmethod
    def _generate_waveform_task(video_id: int, original_path: Path) -> None:
        """Extrai e armazena em cache a waveform de áudio real do vídeo."""
        try:
            from src.media.audio_waveform import get_or_generate_waveform
            get_or_generate_waveform(video_id, force=True)
            print(f"[IngestService] Waveform de áudio gerada com sucesso para o vídeo ID {video_id}.")
        except Exception as ex:
            print(f"[IngestService] Erro ao extrair waveform para o vídeo ID {video_id}: {ex}")


