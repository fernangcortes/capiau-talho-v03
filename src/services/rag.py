"""Serviço de busca híbrida inteligente e Chatbot RAG (Retrieval-Augmented Generation)."""
import json
import requests
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.search.semantic import SemanticSearch
from src.nlp.prompt_templates import get_chatbot_system_prompt

class RAGService:
    @staticmethod
    def search_hybrid(project_id: int, query: str, media_type: Optional[str] = None, limit: int = 12) -> List[Dict[str, Any]]:
        """Realiza busca híbrida: cruzando rostos/falantes no SQLite e vetores no Qdrant."""
        face_results = []
        speaker_results = []
        
        with get_db() as conn:
            cursor = conn.cursor()
            
            # 1. Busca rostos identificados pelo nome no SQLite
            if not media_type or media_type == "photo":
                cursor.execute("""
                    SELECT f.id as face_id, f.photo_id, p.filename, p.filepath, p.description, p.tags
                    FROM face f
                    JOIN photo p ON f.photo_id = p.id
                    WHERE f.project_id = ? AND f.name LIKE ?
                """, (project_id, f"%{query}%"))
                photo_rows = cursor.fetchall()
                for pr in photo_rows:
                    face_results.append({
                        "score": 1.0,
                        "payload": {
                            "media_type": "photo",
                            "photo_id": pr["photo_id"],
                            "filename": pr["filename"],
                            "filepath": pr["filepath"],
                            "text": f"Rosto de {query} identificado nesta foto de bastidores. Descrição: {pr['description'] or ''}",
                            "tags": json.loads(pr["tags"]) if pr["tags"] else []
                        }
                    })
                
            if not media_type or media_type in ["video", "broll"]:
                cursor.execute("""
                    SELECT f.id as face_id, f.video_id, f.timestamp, v.filename, v.filepath, v.description, v.tags
                    FROM face f
                    JOIN video v ON f.video_id = v.id
                    WHERE f.project_id = ? AND f.name LIKE ?
                """, (project_id, f"%{query}%"))
                video_face_rows = cursor.fetchall()
                for vr in video_face_rows:
                    face_results.append({
                        "score": 1.0,
                        "payload": {
                            "media_type": "broll",
                            "video_id": vr["video_id"],
                            "filename": vr["filename"],
                            "filepath": vr["filepath"],
                            "start_time": max(0.0, vr["timestamp"] - 3.0),
                            "end_time": vr["timestamp"] + 7.0,
                            "text": f"Rosto de {query} identificado no timecode {vr['timestamp']}s nestes bastidores.",
                            "tags": json.loads(vr["tags"]) if vr["tags"] else []
                        }
                    })

            # 2. Busca trechos falados pelo nome do falante (speaker_id)
            if not media_type or media_type in ["video", "interview"]:
                cursor.execute("""
                    SELECT DISTINCT video_id, speaker_id, MIN(start_time) as min_start, MAX(end_time) as max_end
                    FROM transcript
                    WHERE video_id IN (SELECT id FROM video WHERE project_id = ?) AND speaker_id LIKE ?
                    GROUP BY video_id, speaker_id
                """, (project_id, f"%{query}%"))
                speaker_rows = cursor.fetchall()
                for sr in speaker_rows:
                    cursor.execute("""
                        SELECT word, start_time, end_time FROM transcript
                        WHERE video_id = ? AND speaker_id = ?
                        ORDER BY start_time LIMIT 25
                    """, (sr["video_id"], sr["speaker_id"]))
                    words = cursor.fetchall()
                    phrase = " ".join([w["word"] for w in words])
                    
                    speaker_results.append({
                        "score": 0.95,
                        "payload": {
                            "media_type": "interview",
                            "video_id": sr["video_id"],
                            "speaker_id": sr["speaker_id"],
                            "start_time": sr["min_start"],
                            "end_time": sr["max_end"],
                            "text": f"Depoimento de {sr['speaker_id']}: \"{phrase}...\""
                        }
                    })

        # 3. Busca semântica no Qdrant
        results = []
        try:
            search_engine = SemanticSearch.get_instance()
            results = search_engine.search(project_id, query, media_type=media_type, limit=limit)
        except Exception as qdrant_err:
            print(f"[RAGSearch] Erro ao pesquisar no Qdrant: {qdrant_err}")

        # 4. Mescla resultados removendo duplicatas
        seen_media = set()
        final_results = []
        
        # Adiciona resultados prioritários (SQLite rostos/falantes)
        for r in face_results + speaker_results:
            payload = r["payload"]
            media_id = payload.get("photo_id") or payload.get("video_id")
            key = (payload["media_type"], media_id)
            if key not in seen_media:
                seen_media.add(key)
                final_results.append(r)
                
        # Adiciona resultados semânticos
        for r in results:
            payload = r.get("payload", {})
            media_id = payload.get("photo_id") or payload.get("video_id") or payload.get("doc_id")
            key = (payload.get("media_type"), media_id)
            if key not in seen_media:
                seen_media.add(key)
                final_results.append(r)

        # 5. Enriquecimento de metadados estáticos e caminhos de proxy no SQLite
        with get_db() as conn:
            cursor = conn.cursor()
            for r in final_results:
                payload = r.get("payload", {})
                if payload.get("media_type") == "photo":
                    photo_id = payload.get("photo_id")
                    if photo_id:
                        cursor.execute("SELECT filename, filepath, status FROM photo WHERE id = ?", (photo_id,))
                        photo_row = cursor.fetchone()
                        if photo_row:
                            payload["filename"] = photo_row["filename"]
                            payload["filepath"] = photo_row["filepath"]
                            payload["status"] = photo_row["status"]
                            
                            proxy_relative = f"photos/proxy_photo_{photo_id}.webp"
                            if (CONFIG.PROXIES_DIR / proxy_relative).exists():
                                payload["proxy_path"] = f"/proxies/{proxy_relative}"
                            else:
                                payload["proxy_path"] = None

        return final_results[:limit]

    @staticmethod
    def chat(project_id: int, message: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
        """Processa a mensagem RAG gerando respostas contextualizadas com mídias citadas."""
        raw_results = RAGService.search_hybrid(project_id, message, limit=15)
        
        context_items = []
        with get_db() as conn:
            cursor = conn.cursor()
            for r in raw_results:
                p = r.get("payload", {})
                m_type = p.get("media_type")
                text = p.get("text", "")
                
                if m_type in ["interview", "broll", "video"]:
                    vid = p.get("video_id")
                    cursor.execute("SELECT filename FROM video WHERE id = ?", (vid,))
                    row = cursor.fetchone()
                    fname = row["filename"] if row else "Video"
                    start = p.get("start_time", 0.0)
                    end = p.get("end_time", start + 10.0)
                    if m_type == "interview":
                        speaker = p.get("speaker_id", "Desconhecido")
                        context_items.append(f'- [Depoimento ID {vid} | Arquivo: {fname} | Falante: {speaker} | Tempo: {start:.1f}s - {end:.1f}s]: "{text}"')
                    else:
                        context_items.append(f'- [B-Roll ID {vid} | Arquivo: {fname} | Tempo: {start:.1f}s]: "{text}"')
                elif m_type == "photo":
                    phid = p.get("photo_id")
                    cursor.execute("SELECT filename FROM photo WHERE id = ?", (phid,))
                    row = cursor.fetchone()
                    fname = row["filename"] if row else "Foto"
                    context_items.append(f'- [Foto ID {phid} | Arquivo: {fname}]: "{text}"')
                elif m_type == "doc":
                    docid = p.get("doc_id")
                    fname = p.get("filename", "Documento")
                    context_items.append(f'- [Documento ID {docid} | Arquivo: {fname}]: "{text}"')

        context_str = "\n".join(context_items)
        system_prompt = get_chatbot_system_prompt(context_str)
        
        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-8:]:
            messages.append({
                "role": h.get("role", "user"),
                "content": h.get("content", "")
            })
        messages.append({"role": "user", "content": message})
        
        api_key = CONFIG.OPENROUTER_API_KEY
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {
                "response": "Olá! Sou o assistente de edição do CaIAu Talho. Configure a chave `OPENROUTER_API_KEY` no arquivo `.env` para conversar.",
                "context_used": []
            }
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": CONFIG.TEXT_MODEL,
            "messages": messages,
            "temperature": 0.5
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            if response.status_code == 200:
                res_json = response.json()
                ai_text = res_json['choices'][0]['message']['content'].strip()
                return {
                    "response": ai_text,
                    "context_used": context_items
                }
            return {
                "response": f"Erro de comunicação com LLM (Status {response.status_code}): {response.text}",
                "context_used": []
            }
        except Exception as e:
            return {
                "response": f"Erro crítico de comunicação com chatbot: {str(e)}",
                "context_used": []
            }
