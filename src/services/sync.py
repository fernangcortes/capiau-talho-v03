"""Serviço de Sincronização, Importação e Exportação física de Projetos (ZIP)."""
import json
import sqlite3
from typing import Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.projects import ProjectRepository
from src.db.repositories.media import MediaRepository
from src.db.repositories.narrative import NarrativeRepository
from src.search.semantic import SemanticSearch

class SyncService:
    @staticmethod
    def get_project_all_data(project_id: int) -> Optional[Dict[str, Any]]:
        """Coleta todos os dados relacionais do SQLite para exportação."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # 1. Dados Básicos do Projeto
            cursor.execute("SELECT * FROM project WHERE id = ?", (project_id,))
            project_row = cursor.fetchone()
            if not project_row:
                return None
            project_data = dict(project_row)
            
            def query_all(sql: str, params: tuple) -> list:
                cursor.execute(sql, params)
                return [dict(r) for r in cursor.fetchall()]
                
            videos = query_all("SELECT * FROM video WHERE project_id = ?", (project_id,))
            photos = query_all("SELECT * FROM photo WHERE project_id = ?", (project_id,))
            docs = query_all("SELECT * FROM production_doc WHERE project_id = ?", (project_id,))
            faces = query_all("SELECT * FROM face WHERE project_id = ?", (project_id,))
            people = query_all("SELECT * FROM person WHERE project_id = ?", (project_id,))
            
            face_recognitions = []
            if faces:
                face_ids = [f['id'] for f in faces]
                placeholders = ",".join("?" for _ in face_ids)
                face_recognitions = query_all(f"""
                    SELECT * FROM face_recognition 
                    WHERE face_id IN ({placeholders})
                """, tuple(face_ids))

            themes = query_all("SELECT * FROM theme WHERE project_id = ?", (project_id,))
            timelines = query_all("SELECT * FROM timeline WHERE project_id = ?", (project_id,))
            relations = query_all("SELECT * FROM relation WHERE project_id = ?", (project_id,))
            
            # Transcrições associadas aos vídeos do projeto
            transcripts = []
            video_ids = [v['id'] for v in videos]
            if video_ids:
                transcripts = query_all("""
                    SELECT * FROM transcript 
                    WHERE video_id IN (SELECT id FROM video WHERE project_id = ?)
                """, (project_id,))
                
            transcript_themes = query_all("""
                SELECT * FROM transcript_theme 
                WHERE theme_id IN (SELECT id FROM theme WHERE project_id = ?)
            """, (project_id,))
            
            # Coleta as descrições do Qdrant para B-rolls
            search_engine = SemanticSearch.get_instance()
            broll_frames = {}
            for v in videos:
                if v["video_type"] == "broll":
                    try:
                        frames = search_engine.get_video_vision_frames(project_id, v["id"])
                        if frames:
                            broll_frames[str(v["id"])] = frames
                    except Exception as q_err:
                        print(f"[SyncService] Erro ao carregar frames do Qdrant para vídeo {v['id']}: {q_err}")
                        
            return {
                "project": project_data,
                "videos": videos,
                "photos": photos,
                "production_docs": docs,
                "faces": faces,
                "people": people,
                "face_recognitions": face_recognitions,
                "themes": themes,
                "timelines": timelines,
                "relations": relations,
                "transcripts": transcripts,
                "transcript_themes": transcript_themes,
                "broll_frames": broll_frames
            }

    @staticmethod
    def import_project_all_data(data: Dict[str, Any]) -> int:
        """Importa todos os registros de um projeto do ZIP, remontando chaves primárias e Qdrant."""
        with get_db() as conn:
            cursor = conn.cursor()
            
            # 1. Inserção do Projeto
            proj = data["project"]
            new_project_id = ProjectRepository.create(
                conn,
                proj.get("name", "Projeto Importado"),
                proj.get("description", ""),
                proj.get("drive_link", "")
            )
            
            video_id_map = {}
            photo_id_map = {}
            theme_id_map = {}
            transcript_id_map = {}
            
            # 2. Inserção de Vídeos e indexação de B-roll
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
                
                # Indexa frames do B-roll no Qdrant
                broll_frames_data = data.get("broll_frames", {})
                old_vid_id_str = str(old_vid_id)
                if v["video_type"] == "broll" and old_vid_id_str in broll_frames_data:
                    try:
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
                        print(f"[SyncService] Erro ao reindexar B-roll {new_vid_id} no Qdrant: {q_err}")
                        
            # 3. Inserção de Fotos
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
                
                # Reindexa fotos no Qdrant se analisadas
                if p["status"] == "analyzed" and p.get("description"):
                    try:
                        search_engine = SemanticSearch.get_instance()
                        tags_list = json.loads(p.get("tags", "[]"))
                        search_engine.index_photo_description(new_project_id, new_photo_id, p["description"], tags_list)
                    except Exception as q_err:
                        print(f"[SyncService] Erro ao reindexar foto {new_photo_id} no Qdrant: {q_err}")
                        
            # 4. Inserção de Documentos de Produção
            for doc in data.get("production_docs", []):
                new_doc_id = ProjectRepository.add_document(
                    conn,
                    new_project_id,
                    doc["filename"],
                    doc.get("filepath"),
                    doc["content"],
                    doc["doc_type"]
                )
                try:
                    search_engine = SemanticSearch.get_instance()
                    search_engine.index_production_doc(new_project_id, new_doc_id, doc["filename"], doc["content"])
                except Exception as q_err:
                    print(f"[SyncService] Erro ao reindexar doc {new_doc_id} no Qdrant: {q_err}")
                    
            # 5. Temas
            for t in data.get("themes", []):
                old_theme_id = t["id"]
                title = t["title"]
                cursor.execute("SELECT id FROM theme WHERE title = ?", (title,))
                if cursor.fetchone():
                    title = f"{title} (Imp {new_project_id})"
                    
                new_theme_id = NarrativeRepository.add_theme(conn, new_project_id, title, t.get("description", ""))
                theme_id_map[old_theme_id] = new_theme_id
                
            # 6. Timelines
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
                
            # 7. Relações do Grafo
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
                    
                NarrativeRepository.add_relation(
                    conn, new_project_id, r["subject_type"], sub_id,
                    r["predicate"], r["object_type"], obj_id, r.get("weight", 1.0)
                )
                
            # 8. Pessoas (Identificadas)
            person_id_map = {}
            for person in data.get("people", []):
                old_person_id = person["id"]
                cursor.execute("""
                    INSERT INTO person (project_id, name, aliases, bio, profile_image_path, metadata)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (new_project_id, person.get("name"), person.get("aliases"), 
                      person.get("bio"), person.get("profile_image_path"), person.get("metadata")))
                person_id_map[old_person_id] = cursor.lastrowid

            # 8.1. Rostos
            face_id_map = {}
            for face in data.get("faces", []):
                old_face_id = face["id"]
                face_vid = face.get("video_id")
                face_photo = face.get("photo_id")
                
                new_vid_id = video_id_map.get(face_vid) if face_vid else None
                new_photo_id = photo_id_map.get(face_photo) if face_photo else None
                
                cursor.execute("""
                    INSERT INTO face (project_id, cluster_id, name, bounding_box, photo_id, video_id, 
                                    timestamp, quality_score, blur_score, face_size_px, crop_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (new_project_id, face.get("cluster_id"), face.get("name"), face.get("bounding_box"),
                      new_photo_id, new_vid_id, face.get("timestamp"), face.get("quality_score"),
                      face.get("blur_score"), face.get("face_size_px"), face.get("crop_path")))
                
                new_face_id = cursor.lastrowid
                face_id_map[old_face_id] = new_face_id
                
            # 8.2. Reconhecimentos Faciais
            for rec in data.get("face_recognitions", []):
                old_face_id = rec["face_id"]
                old_person_id = rec.get("person_id")
                
                new_face_id = face_id_map.get(old_face_id)
                new_person_id = person_id_map.get(old_person_id) if old_person_id else None
                
                if new_face_id:
                    cursor.execute("""
                        INSERT INTO face_recognition 
                        (face_id, tier, model, model_version, person_id, embedding, similarity, 
                         confidence, status, recognized_by, recognized_at, raw_response, cost_usd, processing_time_ms)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (new_face_id, rec.get("tier"), rec.get("model"), rec.get("model_version"),
                          new_person_id, rec.get("embedding"), rec.get("similarity"), rec.get("confidence"),
                          rec.get("status"), rec.get("recognized_by"), rec.get("recognized_at"),
                          rec.get("raw_response"), rec.get("cost_usd", 0.0), rec.get("processing_time_ms")))
                
            # 9. Transcrições palavra-a-palavra
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
                
            # 10. Conexão transcript <-> theme
            for tt in data.get("transcript_themes", []):
                old_tr = tt["transcript_id"]
                old_theme = tt["theme_id"]
                
                new_tr = transcript_id_map.get(old_tr)
                new_theme = theme_id_map.get(old_theme)
                
                if new_tr and new_theme:
                    NarrativeRepository.add_transcript_theme(conn, new_tr, new_theme, tt.get("relevance", 1.0))
                    
            # 11. Reindexa falas agregadas no Qdrant
            try:
                search_engine = SemanticSearch.get_instance()
                for old_vid_id, new_vid_id in video_id_map.items():
                    cursor.execute("SELECT video_type FROM video WHERE id = ?", (new_vid_id,))
                    row = cursor.fetchone()
                    if row and row[0] == "interview":
                        dialogues = NarrativeRepository.get_transcript_dialogues(conn, new_vid_id)
                        if dialogues:
                            search_engine.index_transcript_chunks(new_project_id, new_vid_id, dialogues, "interview")
            except Exception as q_err:
                print(f"[SyncService] Erro ao reindexar ASR no Qdrant: {q_err}")
                
            conn.commit()
            return new_project_id
