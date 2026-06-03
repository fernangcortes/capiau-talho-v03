"""Utilitários de operações e queries para o SQLite do CaIAu Talho."""
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
            VALUES (?, ?, ?, ?, ?, ?, 'pending')
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

def update_photo_status(photo_id: int, status: str):
    """Atualiza o status de processamento da foto."""
    conn = get_connection()
    try:
        conn.execute("UPDATE photo SET status = ? WHERE id = ?", (status, photo_id))
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


def add_project(name: str, description: str = "", drive_link: str = "") -> int:
    """Cria um novo projeto no banco de dados e retorna seu ID."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO project (name, description, drive_link) VALUES (?, ?, ?)", (name, description, drive_link))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def get_projects() -> list:
    """Retorna uma lista com todos os projetos cadastrados."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, description, drive_link, created_at FROM project ORDER BY id DESC")
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


def get_video_transcript_words(video_id: int):
    """Retorna todas as palavras individuais da transcrição de um vídeo ordenadas por tempo."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, word, start_time, end_time, speaker_id, confidence 
            FROM transcript 
            WHERE video_id = ? 
            ORDER BY start_time
        """, (video_id,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()



def reset_stuck_tasks():
    """Reseta status temporários (transcribing, analyzing, pending) após reinicialização do servidor."""
    conn = get_connection()
    try:
        # Resetar vídeos que estavam convertendo, transcrevendo ou analisando de volta para ingested
        conn.execute("UPDATE video SET status = 'ingested' WHERE status IN ('transcribing', 'analyzing')")
        # Marcar fotos que estavam pendentes como error (já que o processo foi abortado no restart)
        conn.execute("UPDATE photo SET status = 'error' WHERE status = 'pending'")
        conn.commit()
        print("[DB] Status de tarefas interrompidas resetados com sucesso.")
    except Exception as e:
        print(f"[DB] Erro ao resetar status de tarefas interrompidas: {e}")
    finally:
        conn.close()

def add_production_doc(project_id: int, filename: str, filepath: str, content: str, doc_type: str = "other") -> int:
    """Adiciona um novo documento de contexto ao banco de dados."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO production_doc (project_id, filename, filepath, content, doc_type)
            VALUES (?, ?, ?, ?, ?)
        """, (project_id, filename, filepath, content, doc_type))
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()

def get_production_docs(project_id: int) -> list:
    """Retorna a lista de todos os documentos de contexto associados ao projeto."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, project_id, filename, filepath, content, doc_type, created_at FROM production_doc WHERE project_id = ? ORDER BY id DESC", (project_id,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

def delete_production_doc(doc_id: int):
    """Deleta um documento pelo ID do banco de dados."""
    conn = get_connection()
    try:
        conn.execute("DELETE FROM production_doc WHERE id = ?", (doc_id,))
        conn.commit()
    finally:
        conn.close()

def update_video_metadata(video_id: int, description: str, summary: str, tags: list):
    """Atualiza a descrição, sumário e tags editoriais do vídeo."""
    conn = get_connection()
    try:
        conn.execute("""
            UPDATE video 
            SET description = ?, summary = ?, tags = ? 
            WHERE id = ?
        """, (description, summary, json.dumps(tags), video_id))
        conn.commit()
    finally:
        conn.close()


def update_project_drive_link(project_id: int, link: str):
    """Atualiza o link do Google Drive de um projeto."""
    conn = get_connection()
    try:
        conn.execute("UPDATE project SET drive_link = ? WHERE id = ?", (link, project_id))
        conn.commit()
    finally:
        conn.close()


def get_project_all_data(project_id: int) -> dict:
    """Coleta todos os dados de todas as tabelas relacionados a um project_id para fins de exportação."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # 1. Dados do Projeto
        cursor.execute("SELECT * FROM project WHERE id = ?", (project_id,))
        project_row = cursor.fetchone()
        if not project_row:
            return None
        project_data = dict(project_row)
        
        # Helper para obter lista de dicts
        def query_all(sql, params):
            cursor.execute(sql, params)
            return [dict(r) for r in cursor.fetchall()]
            
        videos = query_all("SELECT * FROM video WHERE project_id = ?", (project_id,))
        photos = query_all("SELECT * FROM photo WHERE project_id = ?", (project_id,))
        docs = query_all("SELECT * FROM production_doc WHERE project_id = ?", (project_id,))
        faces = query_all("SELECT * FROM face WHERE project_id = ?", (project_id,))
        themes = query_all("SELECT * FROM theme WHERE project_id = ?", (project_id,))
        timelines = query_all("SELECT * FROM timeline WHERE project_id = ?", (project_id,))
        relations = query_all("SELECT * FROM relation WHERE project_id = ?", (project_id,))
        
        # Transcripts linkados aos vídeos do projeto
        video_ids = [v['id'] for v in videos]
        transcripts = []
        if video_ids:
            transcripts = query_all("""
                SELECT * FROM transcript 
                WHERE video_id IN (SELECT id FROM video WHERE project_id = ?)
            """, (project_id,))
            
        # transcript_theme link
        transcript_themes = query_all("""
            SELECT * FROM transcript_theme 
            WHERE theme_id IN (SELECT id FROM theme WHERE project_id = ?)
        """, (project_id,))
        
        # Obter descrições de frames do Qdrant para B-rolls
        from src.search.semantic import SemanticSearch
        search_engine = SemanticSearch.get_instance()
        broll_frames = {}
        for v in videos:
            if v["video_type"] == "broll":
                try:
                    frames = search_engine.get_video_vision_frames(project_id, v["id"])
                    if frames:
                        broll_frames[str(v["id"])] = frames
                except Exception as q_err:
                    print(f"[EXPORT] Erro ao carregar frames do Qdrant para vídeo {v['id']}: {q_err}")
        
        return {
            "project": project_data,
            "videos": videos,
            "photos": photos,
            "production_docs": docs,
            "faces": faces,
            "themes": themes,
            "timelines": timelines,
            "relations": relations,
            "transcripts": transcripts,
            "transcript_themes": transcript_themes,
            "broll_frames": broll_frames
        }
    finally:
        conn.close()


def import_project_all_data(data: dict) -> int:
    """Importa todos os registros de um projeto para o SQLite, mapeando chaves primárias e resolvendo conflitos de hash."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # 1. Inserir Projeto
        proj = data["project"]
        cursor.execute(
            "INSERT INTO project (name, description, drive_link) VALUES (?, ?, ?)",
            (proj.get("name", "Projeto Importado"), proj.get("description", ""), proj.get("drive_link", ""))
        )
        new_project_id = cursor.lastrowid
        
        # Mapeamentos de IDs antigos para novos
        video_id_map = {}
        photo_id_map = {}
        theme_id_map = {}
        transcript_id_map = {}
        
        # 2. Inserir Vídeos e frames do B-roll no Qdrant
        for v in data.get("videos", []):
            old_vid_id = v["id"]
            v_hash = v["hash"]
            cursor.execute("SELECT id FROM video WHERE hash = ?", (v_hash,))
            if cursor.fetchone():
                v_hash = f"{v_hash}_imp_{new_project_id}"
                
            cursor.execute("""
                INSERT INTO video (project_id, filename, filepath, hash, video_type, duration, fps, resolution, codec, bitrate, description, summary, tags, status, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                new_project_id, v["filename"], v["filepath"], v_hash, v["video_type"],
                v["duration"], v["fps"], v["resolution"], v["codec"], v["bitrate"],
                v.get("description", ""), v.get("summary", ""), v.get("tags", "[]"),
                v["status"], v.get("error_message", "")
            ))
            new_vid_id = cursor.lastrowid
            video_id_map[old_vid_id] = new_vid_id
            
            # Se for B-roll e existirem frames exportados, indexamos no Qdrant
            broll_frames_data = data.get("broll_frames", {})
            old_vid_id_str = str(old_vid_id)
            if v["video_type"] == "broll" and old_vid_id_str in broll_frames_data:
                try:
                    from src.search.semantic import SemanticSearch
                    search_engine = SemanticSearch.get_instance()
                    descriptions_to_index = []
                    for f in broll_frames_data[old_vid_id_str]:
                        descriptions_to_index.append({
                            "timestamp": f["timestamp"],
                            "description": f["description"],
                            "tags": f["tags"]
                        })
                    search_engine.index_broll_descriptions(new_project_id, new_vid_id, descriptions_to_index)
                except Exception as q_err:
                    print(f"[IMPORT] Erro ao reindexar frames do B-roll {new_vid_id} no Qdrant: {q_err}")
            
        # 3. Inserir Fotos e indexar no Qdrant
        for p in data.get("photos", []):
            old_photo_id = p["id"]
            p_hash = p["hash"]
            cursor.execute("SELECT id FROM photo WHERE hash = ?", (p_hash,))
            if cursor.fetchone():
                p_hash = f"{p_hash}_imp_{new_project_id}"
                
            cursor.execute("""
                INSERT INTO photo (project_id, filename, filepath, hash, description, tags, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                new_project_id, p["filename"], p["filepath"], p_hash,
                p.get("description", ""), p.get("tags", "[]"), p["status"]
            ))
            new_photo_id = cursor.lastrowid
            photo_id_map[old_photo_id] = new_photo_id
            
            # Reindexar no Qdrant se estiver analisada
            if p["status"] == "analyzed" and p.get("description"):
                try:
                    from src.search.semantic import SemanticSearch
                    search_engine = SemanticSearch.get_instance()
                    tags_list = json.loads(p.get("tags", "[]"))
                    search_engine.index_photo_description(new_project_id, new_photo_id, p["description"], tags_list)
                except Exception as q_err:
                    print(f"[IMPORT] Erro ao reindexar foto {new_photo_id} no Qdrant: {q_err}")
            
        # 4. Inserir Documentos de Produção e indexar no Qdrant
        for doc in data.get("production_docs", []):
            cursor.execute("""
                INSERT INTO production_doc (project_id, filename, filepath, content, doc_type)
                VALUES (?, ?, ?, ?, ?)
            """, (
                new_project_id, doc["filename"], doc.get("filepath", ""),
                doc["content"], doc["doc_type"]
            ))
            new_doc_id = cursor.lastrowid
            
            try:
                from src.search.semantic import SemanticSearch
                search_engine = SemanticSearch.get_instance()
                search_engine.index_production_doc(new_project_id, new_doc_id, doc["filename"], doc["content"])
            except Exception as q_err:
                print(f"[IMPORT] Erro ao reindexar documento {new_doc_id} no Qdrant: {q_err}")
            
        # 5. Inserir Temas
        for t in data.get("themes", []):
            old_theme_id = t["id"]
            title = t["title"]
            cursor.execute("SELECT id FROM theme WHERE title = ?", (title,))
            if cursor.fetchone():
                title = f"{title} (Imp {new_project_id})"
                
            cursor.execute("""
                INSERT INTO theme (project_id, title, description)
                VALUES (?, ?, ?)
            """, (new_project_id, title, t.get("description", "")))
            theme_id_map[old_theme_id] = cursor.lastrowid
            
        # 6. Inserir Timelines
        for tl in data.get("timelines", []):
            try:
                seq = json.loads(tl["sequence_json"])
                for item in seq:
                    old_vid = item.get("video_id")
                    if old_vid in video_id_map:
                        item["video_id"] = video_id_map[old_vid]
                updated_seq_json = json.dumps(seq)
            except Exception:
                updated_seq_json = tl["sequence_json"]
                
            cursor.execute("""
                INSERT INTO timeline (project_id, name, description, sequence_json)
                VALUES (?, ?, ?, ?)
            """, (new_project_id, tl["name"], tl.get("description", ""), updated_seq_json))
            
        # 7. Inserir Relações do Grafo
        for r in data.get("relations", []):
            sub_id = r["subject_id"]
            obj_id = r["object_id"]
            
            try:
                if r["subject_type"] == "video" and int(sub_id) in video_id_map:
                    sub_id = str(video_id_map[int(sub_id)])
                elif r["subject_type"] == "photo" and int(sub_id) in photo_id_map:
                    sub_id = str(photo_id_map[int(sub_id)])
                elif r["subject_type"] == "theme" and int(sub_id) in theme_id_map:
                    sub_id = str(theme_id_map[int(sub_id)])
            except Exception:
                pass
                
            try:
                if r["object_type"] == "video" and int(obj_id) in video_id_map:
                    obj_id = str(video_id_map[int(obj_id)])
                elif r["object_type"] == "photo" and int(obj_id) in photo_id_map:
                    obj_id = str(photo_id_map[int(obj_id)])
                elif r["object_type"] == "theme" and int(obj_id) in theme_id_map:
                    obj_id = str(theme_id_map[int(obj_id)])
            except Exception:
                pass
                
            cursor.execute("""
                INSERT INTO relation (project_id, subject_type, subject_id, predicate, object_type, object_id, weight)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (new_project_id, r["subject_type"], sub_id, r["predicate"], r["object_type"], obj_id, r.get("weight", 1.0)))
            
        # 8. Inserir Rostos
        for face in data.get("faces", []):
            face_vid = face.get("video_id")
            face_photo = face.get("photo_id")
            
            new_vid_id = video_id_map.get(face_vid) if face_vid else None
            new_photo_id = photo_id_map.get(face_photo) if face_photo else None
            
            cursor.execute("""
                INSERT INTO face (project_id, name, bounding_box, photo_id, video_id, timestamp, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                new_project_id, face.get("name"), face.get("bounding_box"),
                new_photo_id, new_vid_id, face.get("timestamp"), face.get("embedding")
            ))
            
        # 9. Inserir Transcrições
        for tr in data.get("transcripts", []):
            old_tr_id = tr["id"]
            old_tr_vid = tr["video_id"]
            new_tr_vid = video_id_map.get(old_tr_vid)
            if not new_tr_vid:
                continue
                
            cursor.execute("""
                INSERT INTO transcript (video_id, word, start_time, end_time, speaker_id, confidence, search_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                new_tr_vid, tr["word"], tr["start_time"], tr["end_time"],
                tr["speaker_id"], tr.get("confidence", 1.0), tr.get("search_text", "")
            ))
            transcript_id_map[old_tr_id] = cursor.lastrowid
            
        # 10. Inserir Conexões transcript <-> theme
        for tt in data.get("transcript_themes", []):
            old_tr = tt["transcript_id"]
            old_theme = tt["theme_id"]
            
            new_tr = transcript_id_map.get(old_tr)
            new_theme = theme_id_map.get(old_theme)
            
            if new_tr and new_theme:
                cursor.execute("""
                    INSERT OR IGNORE INTO transcript_theme (transcript_id, theme_id, relevance)
                    VALUES (?, ?, ?)
                """, (new_tr, new_theme, tt.get("relevance", 1.0)))
                
        # 11. Reindexar falas agregadas no Qdrant
        try:
            from src.search.semantic import SemanticSearch
            search_engine = SemanticSearch.get_instance()
            for old_vid_id, new_vid_id in video_id_map.items():
                cursor.execute("SELECT video_type FROM video WHERE id = ?", (new_vid_id,))
                row = cursor.fetchone()
                if row and row[0] == "interview":
                    from src.db.operations import get_video_transcript
                    dialogues = get_video_transcript(new_vid_id)
                    if dialogues:
                        search_engine.index_transcript_chunks(new_project_id, new_vid_id, dialogues)
        except Exception as q_err:
            print(f"[IMPORT] Erro ao reindexar falas ASR no Qdrant: {q_err}")
                
        conn.commit()
        return new_project_id
    finally:
        conn.close()

