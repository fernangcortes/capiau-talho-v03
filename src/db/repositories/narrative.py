"""Repositório de acesso a dados para Transcrições, Temas e Relações Narrativas (Grafo)."""
import sqlite3
from typing import List, Dict, Any, Optional

class NarrativeRepository:
    @staticmethod
    def save_transcript_words(conn: sqlite3.Connection, video_id: int, words: List[Dict[str, Any]]) -> None:
        """Salva a lista palavra-a-palavra da transcrição de forma atômica no SQLite."""
        cursor = conn.cursor()
        
        # Deleta transcrições legadas do vídeo
        cursor.execute("DELETE FROM transcript WHERE video_id = ?", (video_id,))
        
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

    @staticmethod
    def get_transcript_words(conn: sqlite3.Connection, video_id: int) -> List[Dict[str, Any]]:
        """Retorna todas as palavras individuais da transcrição ordenadas por tempo."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, word, start_time, end_time, speaker_id, confidence 
            FROM transcript 
            WHERE video_id = ? 
            ORDER BY start_time
        """, (video_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def get_transcript_dialogues(conn: sqlite3.Connection, video_id: int) -> List[Dict[str, Any]]:
        """Retorna os blocos agrupados de falas contínuas do mesmo falante (parágrafos)."""
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
            
        dialogues = []
        current_speaker = None
        current_dialogue: Dict[str, Any] = {}
        
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
                # Trata formatação de espaços e pontuação
                if word in [".", ",", "!", "?", ";", ":"]:
                    current_dialogue["text"] += word
                else:
                    current_dialogue["text"] += " " + word
                    
        if current_speaker is not None:
            dialogues.append(current_dialogue)
            
        return dialogues

    @staticmethod
    def split_transcript(conn: sqlite3.Connection, video_id: int, start_time: float, new_speaker_id: str) -> float:
        """Divide o falante a partir de um timecode específico de palavra e retorna o timecode real aplicado."""
        cursor = conn.cursor()
        
        # Encontra a palavra exata no timecode ou a mais próxima subsequente
        cursor.execute("""
            SELECT speaker_id, start_time 
            FROM transcript 
            WHERE video_id = ? AND start_time >= ? 
            ORDER BY start_time ASC LIMIT 1
        """, (video_id, start_time))
        word_row = cursor.fetchone()
        
        if not word_row:
            raise ValueError("Nenhuma palavra encontrada a partir desse timecode.")
            
        current_speaker = word_row['speaker_id']
        actual_start_time = word_row['start_time']
        
        # Atualiza o falante de todas as palavras subsequentes do mesmo falante
        cursor.execute("""
            UPDATE transcript 
            SET speaker_id = ? 
            WHERE video_id = ? AND start_time >= ? AND speaker_id = ?
        """, (new_speaker_id, video_id, actual_start_time, current_speaker))
        
        return actual_start_time

    @staticmethod
    def add_theme(conn: sqlite3.Connection, project_id: int, title: str, description: str = "") -> int:
        """Adiciona um tema narrativo ou retorna o ID se já existir."""
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM theme WHERE project_id = ? AND title = ?", (project_id, title))
        row = cursor.fetchone()
        if row:
            return row['id']
            
        cursor.execute("INSERT INTO theme (project_id, title, description) VALUES (?, ?, ?)", (project_id, title, description))
        return cursor.lastrowid

    @staticmethod
    def get_themes(conn: sqlite3.Connection, project_id: int) -> List[Dict[str, Any]]:
        """Retorna todos os temas narrativos associados ao projeto."""
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, description FROM theme WHERE project_id = ? ORDER BY title", (project_id,))
        return [dict(r) for r in cursor.fetchall()]

    @staticmethod
    def add_relation(
        conn: sqlite3.Connection,
        project_id: int,
        subject_type: str,
        subject_id: str,
        predicate: str,
        object_type: str,
        object_id: str,
        weight: float = 1.0
    ) -> None:
        """Adiciona uma nova tripla no grafo relacional se não existir duplicata exata."""
        cursor = conn.cursor()
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

    @staticmethod
    def add_transcript_theme(conn: sqlite3.Connection, transcript_id: int, theme_id: int, relevance: float = 1.0) -> None:
        """Associa uma palavra/bloco de transcrição a um tema narrativo."""
        conn.execute("""
            INSERT OR IGNORE INTO transcript_theme (transcript_id, theme_id, relevance)
            VALUES (?, ?, ?)
        """, (transcript_id, theme_id, relevance))

    @staticmethod
    def rename_speaker(
        conn: sqlite3.Connection,
        video_id: int,
        old_speaker_id: str,
        new_speaker_id: str,
        global_rename: bool = False,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None
    ) -> None:
        """Atualiza o nome do falante na tabela transcript para o trecho indicado ou globalmente."""
        cursor = conn.cursor()
        if global_rename:
            cursor.execute("""
                UPDATE transcript 
                SET speaker_id = ? 
                WHERE video_id = ? AND speaker_id = ?
            """, (new_speaker_id, video_id, old_speaker_id))
        else:
            if start_time is None or end_time is None:
                raise ValueError("start_time e end_time são necessários para renomeação local.")
            cursor.execute("""
                UPDATE transcript 
                SET speaker_id = ? 
                WHERE video_id = ? AND speaker_id = ? AND start_time >= ? AND end_time <= ?
            """, (new_speaker_id, video_id, old_speaker_id, start_time - 0.05, end_time + 0.05))

    @staticmethod
    def edit_dialogue_segment(conn: sqlite3.Connection, video_id: int, start_time: float, end_time: float, new_text: str, speaker_id: str) -> None:
        """Apaga as palavras antigas no intervalo e insere as novas, distribuindo timestamps linearmente."""
        cursor = conn.cursor()
        cursor.execute("""
            DELETE FROM transcript
            WHERE video_id = ? AND start_time >= ? AND end_time <= ?
        """, (video_id, start_time - 0.05, end_time + 0.05))
        
        words = [w.strip() for w in new_text.split() if w.strip()]
        if not words:
            return
            
        duration = end_time - start_time
        if duration <= 0:
            duration = 1.0
            
        word_duration = duration / len(words)
        
        for idx, w in enumerate(words):
            w_start = start_time + (idx * word_duration)
            w_end = w_start + word_duration
            cursor.execute("""
                INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence)
                VALUES (?, ?, ?, ?, ?, 1.0)
            """, (video_id, w, round(w_start, 3), round(w_end, 3), speaker_id))

    @staticmethod
    def add_theme_segment_manual(conn: sqlite3.Connection, theme_id: int, project_id: int, video_id: int, start_time: float, end_time: float, speaker_id: str, text_excerpt: str) -> int:
        """Cria uma associação manual entre vídeo e tema."""
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO theme_segment (theme_id, project_id, video_id, start_time, end_time, speaker_id, text_excerpt, relevance)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1.0)
        """, (theme_id, project_id, video_id, start_time, end_time, speaker_id, text_excerpt))
        return cursor.lastrowid

    @staticmethod
    def delete_theme_segment(conn: sqlite3.Connection, segment_id: int) -> None:
        """Remove a associação entre trecho de vídeo e tema."""
        cursor = conn.cursor()
        cursor.execute("DELETE FROM theme_segment WHERE id = ?", (segment_id,))

