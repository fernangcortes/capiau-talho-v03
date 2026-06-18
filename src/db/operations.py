"""Fachada de compatibilidade para operações legadas do banco de dados (SQLite)."""
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.media import MediaRepository
from src.db.repositories.narrative import NarrativeRepository
from src.services.sync import SyncService

def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Retorna uma conexão ativa com o SQLite configurada (compatibilidade legado)."""
    if db_path is None:
        db_path = CONFIG.DB_PATH
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn

def add_video(
    project_id: int,
    filename: str,
    filepath: str,
    file_hash: str,
    video_type: str = "unknown", 
    duration: float = 0.0,
    fps: float = 0.0,
    resolution: str = "",
    codec: str = "",
    bitrate: int = 0
) -> int:
    with get_db() as conn:
        res = MediaRepository.add_video(conn, project_id, filename, filepath, file_hash, video_type, duration, fps, resolution, codec, bitrate)
        conn.commit()
        return res

def add_photo(project_id: int, filename: str, filepath: str, file_hash: str, description: str = "", tags: Optional[List[str]] = None) -> int:
    with get_db() as conn:
        res = MediaRepository.add_photo(conn, project_id, filename, filepath, file_hash, description, tags)
        conn.commit()
        return res

def update_video_status(video_id: int, status: str, error_message: Optional[str] = None) -> None:
    with get_db() as conn:
        MediaRepository.update_video_status(conn, video_id, status, error_message)
        conn.commit()

def update_photo_status(photo_id: int, status: str) -> None:
    with get_db() as conn:
        MediaRepository.update_photo_status(conn, photo_id, status)
        conn.commit()

def update_photo_analysis(photo_id: int, description: str, tags: List[str], status: str = "analyzed") -> None:
    with get_db() as conn:
        MediaRepository.update_photo_analysis(conn, photo_id, description, tags, status)
        conn.commit()

def save_transcript_words(video_id: int, words: List[Dict[str, Any]]) -> None:
    with get_db() as conn:
        NarrativeRepository.save_transcript_words(conn, video_id, words)
        conn.commit()

def get_video_transcript(video_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        return NarrativeRepository.get_transcript_dialogues(conn, video_id)

def add_relation(
    project_id: int,
    subject_type: str,
    subject_id: str,
    predicate: str,
    object_type: str,
    object_id: str,
    weight: float = 1.0
) -> None:
    with get_db() as conn:
        NarrativeRepository.add_relation(conn, project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
        conn.commit()

def get_themes(project_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        return NarrativeRepository.get_themes(conn, project_id)

def add_theme(project_id: int, title: str, description: str = "") -> int:
    with get_db() as conn:
        res = NarrativeRepository.add_theme(conn, project_id, title, description)
        conn.commit()
        return res

def add_project(name: str, description: str = "", drive_link: str = "") -> int:
    with get_db() as conn:
        res = ProjectRepository.create(conn, name, description, drive_link)
        conn.commit()
        return res

def get_projects() -> List[Dict[str, Any]]:
    with get_db() as conn:
        return ProjectRepository.list_all(conn)

def delete_project(project_id: int) -> None:
    with get_db() as conn:
        ProjectRepository.delete(conn, project_id)
        conn.commit()

def get_video_transcript_words(video_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        return NarrativeRepository.get_transcript_words(conn, video_id)

def reset_stuck_tasks() -> None:
    with get_db() as conn:
        MediaRepository.reset_stuck_tasks(conn)
        conn.commit()

def add_production_doc(project_id: int, filename: str, filepath: Optional[str], content: str, doc_type: str = "other") -> int:
    with get_db() as conn:
        res = ProjectRepository.add_document(conn, project_id, filename, filepath, content, doc_type)
        conn.commit()
        return res

def get_production_docs(project_id: int) -> List[Dict[str, Any]]:
    with get_db() as conn:
        return ProjectRepository.list_documents(conn, project_id)

def delete_production_doc(doc_id: int) -> None:
    with get_db() as conn:
        ProjectRepository.delete_document(conn, doc_id)
        conn.commit()

def update_video_metadata(video_id: int, description: str, summary: str, tags: List[str]) -> None:
    with get_db() as conn:
        MediaRepository.update_video_metadata(conn, video_id, description, summary, tags)
        conn.commit()

def update_project_drive_link(project_id: int, link: str) -> None:
    with get_db() as conn:
        ProjectRepository.update_drive_link(conn, project_id, link)
        conn.commit()

def get_project_all_data(project_id: int) -> Optional[Dict[str, Any]]:
    return SyncService.get_project_all_data(project_id)

def import_project_all_data(data: Dict[str, Any]) -> int:
    return SyncService.import_project_all_data(data)
