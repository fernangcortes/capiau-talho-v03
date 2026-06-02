"""Utilitários de operações e queries para o SQLite do CapIAu."""
import sqlite3
import json
from pathlib import Path
from src.config import CONFIG

def get_connection(db_path: Path = None):
    """Retorna uma conexão aberta com o banco SQLite com chaves estrangeiras ativas."""
    if db_path is None:
        db_path = CONFIG.DB_PATH
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON") # Garante cascateamento de deleção
    conn.row_factory = sqlite3.Row
    return conn

def add_video(project_id: int, filename: str, filepath: str, file_hash: str, video_type: str = "unknown", 
              duration: float = 0.0, fps: float = 0.0, resolution: str = "", codec: str = "", bitrate: int = 0) -> int:
    """Adiciona um novo vídeo ao banco ou retorna o ID se já existir."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM video WHERE hash = ?", (file_hash,))
        row = cursor.fetchone()
        if row:
            return row['id']
            
        cursor.execute("""
            INSERT INTO video (project_id, filename, filepath, hash, video_type, duration, fps, resolution, codec, bitrate, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested')
        """, (project_id, filename, filepath, file_hash, video_type, duration, fps, resolution, codec, bitrate))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def add_photo(project_id: int, filename: str, filepath: str, file_hash: str, description: str = "", tags: list = None) -> int:
    """Adiciona uma foto de set ao banco."""
    conn = get_connection()
    if tags is None:
        tags = []
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM photo WHERE hash = ?", (file_hash,))
        row = cursor.fetchone()
        if row:
            return row['id']
            
        cursor.execute("""
            INSERT INTO photo (project_id, filename, filepath, hash, description, tags, status)
            VALUES (?, ?, ?, ?, ?, ?, 'ingested')
        """, (project_id, filename, filepath, file_hash, description, json.dumps(tags)))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def update_video_status(video_id: int, status: str, error_message: str = None):
    """Atualiza o status de processamento do vídeo."""
    conn = get_connection()
    try:
        conn.execute("UPDATE video SET status = ?, error_message = ? WHERE id = ?", (status, error_message, video_id))
        conn.commit()
    finally:
        conn.close()

def update_photo_analysis(photo_id: int, description: str, tags: list, status: str = "analyzed"):
    """Atualiza a descrição e as tags visuais da foto analisada."""
    conn = get_connection()
    try:
        conn.execute("UPDATE photo SET description = ?, tags = ?, status = ? WHERE id = ?", 
                     (description, json.dumps(tags), status, photo_id))
        conn.commit()
    finally:
        conn.close()

def save_transcript_words(video_id: int, words: list):
    """Salva a lista de palavras transcritas de forma atômica no SQLite.
    
    Cada item de 'words' deve ser um dicionário contendo:
    {'word': str, 'start_time': float, 'end_time': float, 'speaker_id': str, 'confidence': float}
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # Limpar transcrição antiga se houver
        cursor.execute("DELETE FROM transcript WHERE video_id = ?", (video_id,))
        
        # Batch insert para máxima velocidade
        query = """
            INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence, search_text)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        data = [
            (
                video_id,
                w['word'],
                w['start_time'],
                w['end_time'],
                w['speaker_id'],
                w.get('confidence', 1.0),
                w['word'].lower().strip()
            )
            for w in words
        ]
        cursor.executemany(query, data)
        conn.commit()
        print(f"[DB] {len(words)} palavras salvas para vídeo ID: {video_id}")
    finally:
        conn.close()

def get_video_transcript(video_id: int):
    """Retorna a transcrição completa de um vídeo agrupada em blocos de falas sequenciais."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT word, start_time, end_time, speaker_id, confidence 
            FROM transcript 
            WHERE video_id = ? 
            ORDER BY start_time
        """, (video_id,))
        rows = cursor.fetchall()
        
        if not rows:
            return []
            
        # Agrupar palavras seguidas do mesmo falante em blocos/parágrafos de diálogo
        dialogues = []
        current_speaker = None
        current_dialogue = {
            "speaker_id": "",
            "start_time": 0.0,
            "end_time": 0.0,
            "text": ""
        }
        
        for r in rows:
            speaker = r['speaker_id']
            word = r['word']
            start = r['start_time']
            end = r['end_time']
            
            if current_speaker != speaker:
                if current_speaker is not None:
                    dialogues.append(current_dialogue)
                current_speaker = speaker
                current_dialogue = {
                    "speaker_id": speaker,
                    "start_time": start,
                    "end_time": end,
                    "text": word
                }
            else:
                current_dialogue["end_time"] = end
                # Adicionar espaço antes de palavras normais, mas tratar pontuação
                if word in [".", ",", "!", "?", ";", ":"]:
                    current_dialogue["text"] += word
                else:
                    current_dialogue["text"] += " " + word
                    
        if current_speaker is not None:
            dialogues.append(current_dialogue)
            
        return dialogues
    finally:
        conn.close()

def add_relation(project_id: int, subject_type: str, subject_id: str, predicate: str, object_type: str, object_id: str, weight: float = 1.0):
    """Adiciona uma tripla no grafo relacional do SQLite."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        # Evitar duplicatas exatas de relações
        cursor.execute("""
            SELECT id FROM relation 
            WHERE project_id = ? AND subject_type = ? AND subject_id = ? 
              AND predicate = ? AND object_type = ? AND object_id = ?
        """, (project_id, subject_type, str(subject_id), predicate, object_type, str(object_id)))
        if cursor.fetchone():
            return
            
        cursor.execute("""
            INSERT INTO relation (project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (project_id, subject_type, str(subject_id), predicate, object_type, str(object_id), weight))
        conn.commit()
    finally:
        conn.close()

def get_themes(project_id: int):
    """Retorna todos os temas cadastrados do projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, description FROM theme WHERE project_id = ? ORDER BY title", (project_id,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

def add_theme(project_id: int, title: str, description: str = "") -> int:
    """Adiciona um novo tema narrativo."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM theme WHERE project_id = ? AND title = ?", (project_id, title))
        row = cursor.fetchone()
        if row:
            return row['id']
        cursor.execute("INSERT INTO theme (project_id, title, description) VALUES (?, ?, ?)", (project_id, title, description))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def add_project(name: str, description: str = "") -> int:
    """Cria um novo projeto no banco de dados e retorna seu ID."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO project (name, description) VALUES (?, ?)", (name, description))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def get_projects() -> list:
    """Retorna uma lista com todos os projetos cadastrados."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description, created_at FROM project ORDER BY id DESC")
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

def delete_project(project_id: int):
    """Deleta um projeto pelo ID. A deleção em cascata limpará todas as tabelas relacionadas."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM project WHERE id = ?", (project_id,))
        conn.commit()
    finally:
        conn.close()

