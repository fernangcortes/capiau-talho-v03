"""Serviço de busca híbrida inteligente e Chatbot RAG (Retrieval-Augmented Generation)."""
import json
import requests
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.search.semantic import SemanticSearch
from src.services.settings_service import SettingsService
from src.nlp.prompt_templates import get_chatbot_system_prompt

def enrich_description(text: str, names: List[str], text_replacements: Optional[Dict[str, str]] = None) -> str:
    """Enriquece descrições visuais substituindo termos genéricos (incluindo plurais e objetos) pelos nomes rotulados."""
    if not text:
        return text
        
    import re
    
    modified_text = text
    
    # 0. Substituição direta de trechos de texto vinculados manualmente
    if text_replacements:
        for target, replacement in text_replacements.items():
            if target:
                pattern = re.compile(re.escape(target), re.IGNORECASE)
                modified_text = pattern.sub(replacement, modified_text)
                
    if not names:
        return modified_text

    clean_names = []
    for n in names:
        if n and n not in clean_names:
            clean_names.append(n)

    # Idempotência: nomes que já constam no texto (ex: descrição persistida já
    # enriquecida pelo enrichment_engine) não devem ser inseridos novamente
    clean_names = [
        n for n in clean_names
        if not re.search(rf'\b{re.escape(n)}\b', modified_text, re.IGNORECASE)
    ]

    if not clean_names:
        return modified_text
    
    # 1. Substituição de termos plurais se houver múltiplos nomes
    num_names = len(clean_names)
    if num_names >= 2:
        names_joined = ", ".join(clean_names[:-1]) + " e " + clean_names[-1]
        plural_terms = [
            r"\b[dD]uas mulheres\b", r"\b[dD]ois homens\b", r"\b[dD]uas pessoas\b", 
            r"\b[dD]ois rapazes\b", r"\b[dD]uas moças\b", r"\b[tT]rês mulheres\b", 
            r"\b[tT]rês homens\b", r"\b[tT]rês pessoas\b", r"\b[vV]árias pessoas\b", 
            r"\b[aA]lgumas pessoas\b", r"\b[pP]essoas\b", r"\b[mM]ulheres\b", r"\b[hH]omens\b"
        ]
        for term in plural_terms:
            match = re.search(term, modified_text)
            if match:
                start, end = match.span()
                modified_text = modified_text[:start] + names_joined + modified_text[end:]
                return modified_text

    # 2. Casamento de substantivos específicos (ex: objetos como 'abajur' ou 'câmera')
    articles = ["de um", "de uma", "um", "uma", "o", "a", "este", "esta", "esse", "essa", "do", "da"]
    sorted_names = sorted(clean_names, key=len, reverse=True)
    
    for name in sorted_names:
        # Extrai palavras significativas do nome
        name_words = [w.lower() for w in re.split(r'\W+', name) if len(w) > 2]
        matched = False
        for word in name_words:
            if word in ["de", "da", "do", "com", "para", "em", "um", "uma"]:
                continue
            # Busca pela palavra com limites de palavra
            pattern = re.compile(rf'\b{word}\b', re.IGNORECASE)
            match = pattern.search(modified_text)
            if match:
                start, end = match.span()
                # Verifica se há artigo precedente
                preceding_text = modified_text[:start].rstrip()
                found_article_len = 0
                for art in sorted(articles, key=len, reverse=True):
                    if preceding_text.lower().endswith(" " + art) or preceding_text.lower() == art:
                        found_article_len = len(art)
                        break
                
                if found_article_len > 0:
                    article_start = len(preceding_text) - found_article_len
                    modified_text = modified_text[:article_start] + name + modified_text[end:]
                else:
                    modified_text = modified_text[:start] + name + modified_text[end:]
                matched = True
                break
        if matched:
            continue

        # 3. Fallback: Termos genéricos de pessoas (singular)
        generic_terms = [
            "um homem", "uma mulher", "uma pessoa", "o homem", "a mulher", "o diretor", "a diretora",
            "o ator", "a atriz", "um rapaz", "uma moça", "um operador", "o operador", "um fotógrafo",
            "o fotógrafo", "um entrevistado", "o entrevistado", "um técnico", "o técnico", "o editor",
            "um editor", "a editora", "a repórter", "o repórter", "uma figura", "a pessoa", "o sujeito",
            "o indivíduo", "o personagem", "um personagem"
        ]
        
        text_lower = modified_text.lower()
        best_match_idx = -1
        best_match_term = None
        best_match_len = 0
        
        for term in generic_terms:
            idx = text_lower.find(term)
            if idx != -1:
                if best_match_idx == -1 or idx < best_match_idx:
                    best_match_idx = idx
                    best_match_term = term
                    best_match_len = len(term)
                    
        if best_match_idx != -1:
            original_chunk = modified_text[best_match_idx : best_match_idx + best_match_len]
            replacement_name = name
            if original_chunk and original_chunk[0].isupper():
                replacement_name = name[0].upper() + name[1:] if len(name) > 0 else name
            modified_text = modified_text[:best_match_idx] + replacement_name + modified_text[best_match_idx + best_match_len:]
        else:
            # Prepend
            modified_text = f"{name}, {modified_text[0].lower() + modified_text[1:] if modified_text else ''}"
            
    return modified_text

class RAGService:

    @staticmethod
    def _mmr_rerank(results: List[Dict[str, Any]], query: str, lambda_: float = 0.7, pool: int = 40) -> List[Dict[str, Any]]:
        """Re-ranking Maximal Marginal Relevance: diversifica os resultados do topo.

        Resultados quase idênticos entre si (ex: vários frames do mesmo assunto)
        deixam de monopolizar as primeiras posições. Resultados de match exato
        (rostos/falantes, score >= 0.95) ficam fixados no topo, fora do MMR.
        """
        if len(results) < 3 or lambda_ >= 0.999:
            return results

        pinned = [r for r in results if r.get("score", 0.0) >= 0.95]
        rest = [r for r in results if r.get("score", 0.0) < 0.95]
        if len(rest) < 3:
            return results

        head = rest[:pool]
        tail = rest[pool:]
        try:
            import numpy as np
            engine = SemanticSearch.get_instance()
            texts = [str(r.get("payload", {}).get("text", ""))[:400] or " " for r in head]
            vecs = engine.encoder.encode([query] + texts, show_progress_bar=False)
            vecs = np.asarray(vecs, dtype=np.float32)
            norms = np.linalg.norm(vecs, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            vecs = vecs / norms
            qv, dv = vecs[0], vecs[1:]
            rel = dv @ qv

            selected: List[int] = []
            remaining = list(range(len(head)))
            while remaining:
                if not selected:
                    best = max(remaining, key=lambda i: float(rel[i]))
                else:
                    def mmr_score(i: int) -> float:
                        max_sim = max(float(dv[i] @ dv[j]) for j in selected)
                        return lambda_ * float(rel[i]) - (1.0 - lambda_) * max_sim
                    best = max(remaining, key=mmr_score)
                selected.append(best)
                remaining.remove(best)

            return pinned + [head[i] for i in selected] + tail
        except Exception as e:
            print(f"[RAGSearch] Falha no re-ranking MMR (mantendo ordem original): {e}")
            return results

    @staticmethod
    def search_hybrid(project_id: int, query: str, media_type: Optional[str] = None, limit: int = 30, offset: int = 0) -> List[Dict[str, Any]]:
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
                    WHERE f.project_id = ? AND f.name LIKE ? AND f.name != 'Não Relevante' AND f.name != 'Não é Rosto'
                """, (project_id, f"%{query}%"))
                photo_rows = cursor.fetchall()
                for pr in photo_rows:
                    # Obter todos os rostos rotulados nesta foto
                    cursor.execute("SELECT DISTINCT name FROM face WHERE photo_id = ? AND name IS NOT NULL AND name != 'Não Relevante' AND name != 'Não é Rosto'", (pr["photo_id"],))
                    names = [r["name"] for r in cursor.fetchall()]
                    
                    raw_desc = pr["description"] or "Foto sem descrição."
                    enriched_desc = enrich_description(raw_desc, names)
                    
                    face_results.append({
                        "score": 1.0,
                        "payload": {
                            "media_type": "photo",
                            "match_source": "face",
                            "photo_id": pr["photo_id"],
                            "filename": pr["filename"],
                            "filepath": pr["filepath"],
                            "text": enriched_desc,
                            "tags": json.loads(pr["tags"]) if pr["tags"] else []
                        }
                    })
                
            if not media_type or media_type in ["video", "broll"]:
                cursor.execute("""
                    SELECT f.id as face_id, f.video_id, f.timestamp, v.filename, v.filepath, v.description, v.tags
                    FROM face f
                    JOIN video v ON f.video_id = v.id
                    WHERE f.project_id = ? AND f.name LIKE ? AND f.name != 'Não Relevante' AND f.name != 'Não é Rosto'
                """, (project_id, f"%{query}%"))
                video_face_rows = cursor.fetchall()
                for vr in video_face_rows:
                    # Obter a descrição real do frame a partir do Qdrant
                    frame_desc = ""
                    try:
                        search_engine = SemanticSearch.get_instance()
                        frame_desc = search_engine.get_video_vision_frame_description(project_id, vr["video_id"], vr["timestamp"])
                    except Exception:
                        pass
                    
                    if not frame_desc:
                        frame_desc = vr["description"] or "Trecho de vídeo sem descrição."
                        
                    # Obter os rostos rotulados no mesmo frame com 5s de tolerância
                    cursor.execute("""
                        SELECT DISTINCT name, crop_path FROM face 
                        WHERE video_id = ? AND ABS(timestamp - ?) <= 5.0 AND name IS NOT NULL AND name != '' AND name != 'Não Relevante' AND name != 'Não é Rosto'
                    """, (vr["video_id"], vr["timestamp"]))
                    face_rows = cursor.fetchall()
                    names = []
                    replacements = {}
                    for f_row in face_rows:
                        face_name = f_row["name"]
                        face_crop = f_row["crop_path"]
                        if face_crop and face_crop.startswith("text:"):
                            replacements[face_crop[5:]] = face_name
                        else:
                            if face_name not in names:
                                names.append(face_name)
                    
                    enriched_desc = enrich_description(frame_desc, names, text_replacements=replacements)
                    
                    face_results.append({
                        "score": 1.0,
                        "payload": {
                            "media_type": "broll",
                            "match_source": "face",
                            "video_id": vr["video_id"],
                            "filename": vr["filename"],
                            "filepath": vr["filepath"],
                            "start_time": max(0.0, vr["timestamp"] - 3.0),
                            "end_time": vr["timestamp"] + 7.0,
                            "text": enriched_desc,
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
                            "match_source": "speaker",
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
            qdrant_limit = max(200, offset * 5 + limit * 10)
            results = search_engine.search(project_id, query, media_type=media_type, limit=qdrant_limit)
        except Exception as qdrant_err:
            print(f"[RAGSearch] Erro ao pesquisar no Qdrant: {qdrant_err}")

        # 3b. Busca visual CLIP local — entra na fusão com peso configurável (E2.B3)
        visual_results = []
        try:
            S_clip = SettingsService.get_settings(project_id)
            img_weight = S_clip.get("search.image_weight")
            if S_clip.get("clip.enabled") and img_weight > 0 and media_type != "interview":
                from src.search.image_semantic import ImageSearch
                for vh in ImageSearch.get_instance().search_text(project_id, query, limit=30):
                    vp = dict(vh.get("payload") or {})
                    if media_type and vp.get("media_type") != media_type:
                        continue
                    vp.setdefault("text", "")
                    vp["match_source"] = "clip"
                    visual_results.append({"score": vh["score"] * img_weight, "payload": vp})
        except Exception as clip_err:
            print(f"[RAGSearch] Busca visual indisponível: {clip_err}")

        # 4. Mescla resultados agrupando ocorrências por mídia
        media_groups = {} # key -> list of results
        all_candidates = face_results + speaker_results + results + visual_results
        
        for r in all_candidates:
            payload = r.get("payload", {})
            m_type = payload.get("media_type", "unknown")
            if m_type == "video":
                payload["media_type"] = "interview"
                m_type = "interview"
                
            media_id = payload.get("photo_id") or payload.get("video_id") or payload.get("doc_id") or 0
            group_key = (m_type, media_id)
            
            if group_key not in media_groups:
                media_groups[group_key] = []
                
            # Evitar exatamente o mesmo timestamp (com 1 decimal de tolerância)
            start_time = payload.get("start_time", 0.0)
            if not any(round(existing["payload"].get("start_time", 0.0), 1) == round(start_time, 1) for existing in media_groups[group_key]):
                media_groups[group_key].append(r)
                
        # Selecionar o melhor resultado de cada mídia e agrupar os outros
        final_results = []
        for group_key, items in media_groups.items():
            items.sort(key=lambda x: x.get("score", 0.0), reverse=True)
            
            main_item = items[0]
            other_occurrences = []
            for item_idx, item in enumerate(items[1:]):
                payload_sub = item.get("payload", {})
                other_occurrences.append({
                    "id": f"{group_key[0]}_{group_key[1]}_{payload_sub.get('start_time', 0.0)}_sub_{item_idx}",
                    "score": item.get("score", 0.0),
                    "start_time": payload_sub.get("start_time", 0.0),
                    "end_time": payload_sub.get("end_time", 0.0),
                    "text": payload_sub.get("text", "")
                })
            
            main_item["other_occurrences"] = other_occurrences
            final_results.append(main_item)

        # 5. Enriquecimento de metadados estáticos e caminhos de proxy no SQLite
        with get_db() as conn:
            cursor = conn.cursor()
            for r in final_results:
                payload = r.get("payload", {})
                m_type = payload.get("media_type")
                if m_type == "photo":
                    photo_id = payload.get("photo_id")
                    if photo_id:
                        cursor.execute("SELECT filename, filepath, status, description, tags FROM photo WHERE id = ?", (photo_id,))
                        photo_row = cursor.fetchone()
                        if photo_row:
                            payload["filename"] = photo_row["filename"]
                            payload["filepath"] = photo_row["filepath"]
                            payload["status"] = photo_row["status"]
                            payload["tags"] = json.loads(photo_row["tags"]) if photo_row["tags"] else []
                            
                            # Enriquece com rostos conhecidos
                            cursor.execute("SELECT DISTINCT name FROM face WHERE photo_id = ? AND name IS NOT NULL AND name != 'Não Relevante' AND name != 'Não é Rosto'", (photo_id,))
                            names = [f_row["name"] for f_row in cursor.fetchall()]
                            raw_desc = photo_row["description"] or payload.get("text") or "Foto sem descrição."
                            payload["text"] = enrich_description(raw_desc, names)
                            
                            proxy_relative = f"photos/proxy_photo_{photo_id}.webp"
                            if (CONFIG.PROXIES_DIR / proxy_relative).exists():
                                payload["proxy_path"] = f"/proxies/{proxy_relative}"
                            else:
                                payload["proxy_path"] = None
                elif m_type == "broll" or m_type == "video":
                    video_id = payload.get("video_id")
                    timestamp = payload.get("start_time")
                    if video_id and timestamp is not None:
                        # Enriquece com rostos conhecidos no frame com 5s de tolerância
                        cursor.execute("SELECT DISTINCT name, crop_path FROM face WHERE video_id = ? AND ABS(timestamp - ?) <= 5.0 AND name IS NOT NULL AND name != '' AND name != 'Não Relevante' AND name != 'Não é Rosto'", (video_id, timestamp))
                        face_rows = cursor.fetchall()
                        names = []
                        replacements = {}
                        for f_row in face_rows:
                            face_name = f_row[0]
                            face_crop = f_row[1]
                            if face_crop and face_crop.startswith("text:"):
                                replacements[face_crop[5:]] = face_name
                            else:
                                if face_name not in names:
                                    names.append(face_name)
                        
                        raw_desc = payload.get("text", "")
                        payload["text"] = enrich_description(raw_desc, names, text_replacements=replacements)


        # 6. Diversificação MMR: evita que resultados quase idênticos monopolizem o topo
        try:
            S = SettingsService.get_settings(project_id)
            final_results = RAGService._mmr_rerank(final_results, query, lambda_=S.get("search.mmr_lambda"))
        except Exception as mmr_err:
            print(f"[RAGSearch] MMR indisponível: {mmr_err}")

        # 7. Atribui IDs estáveis para referência no frontend e categorização e adiciona explicações didáticas
        for idx, r in enumerate(final_results):
            payload = r.get("payload", {})
            m_type = payload.get("media_type", "unknown")
            if m_type == "video":
                payload["media_type"] = "interview"
                m_type = "interview"
            media_id = payload.get("photo_id") or payload.get("video_id") or payload.get("doc_id") or 0
            start_time = payload.get("start_time", 0.0)
            r["id"] = f"{m_type}_{media_id}_{start_time}_{idx}"
            
            # Adiciona explicação didática da relevância (match_source marca a origem
            # do resultado — mais confiável que comparar o score com valores-sentinela)
            score_val = r.get("score", 0.0)
            if payload.get("match_source") == "face":
                r["explanation"] = "Presença confirmada do personagem no frame (reconhecimento facial)."
            elif payload.get("match_source") == "speaker":
                r["explanation"] = "Trecho do depoimento falado pelo personagem pesquisado."
            elif payload.get("match_source") == "clip":
                r["explanation"] = f"Correspondência visual (CLIP) de {score_val*100:.0f}% com os termos da busca."
            else:
                r["explanation"] = f"Correspondência conceitual (Semântica) de {score_val*100:.0f}% no texto do trecho."

        return final_results[offset : offset + limit]

    @staticmethod
    def categorize_results_with_llm(query: str, items: List[Dict[str, Any]], project_id: Optional[int] = None) -> Dict[str, Any]:
        """Usa LLM para agrupar semanticamente resultados de busca em categorias de desambiguação."""
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {"categories": []}

        # Preparar texto dos itens para o prompt do LLM
        items_desc = []
        for idx, item in enumerate(items):
            item_id = item.get("id", f"item_{idx}")
            media_type = item.get("media_type", "unknown")
            text = item.get("text", "")
            items_desc.append(f"- ID: {item_id} | Tipo: {media_type} | Texto: {text}")

        items_str = "\n".join(items_desc)

        from src.nlp.prompt_registry import get_prompt
        system_prompt = get_prompt("rag_categorize", project_id=project_id)

        user_content = f"Termo buscado: '{query}'\n\nResultados encontrados:\n{items_str}"

        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": S.get("llm.text_model"),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            "temperature": S.get("chat.categorize_temperature"),
            "response_format": {"type": "json_object"}
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=S.get("chat.categorize_timeout"))
            if response.status_code == 200:
                res_json = response.json()
                ai_text = res_json['choices'][0]['message']['content'].strip()
                # Tentar decodificar o JSON retornado
                return json.loads(ai_text)
            return {"categories": []}
        except Exception as e:
            print(f"[RAGSearch] Erro ao categorizar com LLM: {e}")
            return {"categories": []}

    @staticmethod
    def chat(project_id: int, message: str, history: List[Dict[str, str]]) -> Dict[str, Any]:
        """Processa a mensagem RAG gerando respostas contextualizadas com mídias citadas."""
        S = SettingsService.get_settings(project_id)
        raw_results = RAGService.search_hybrid(project_id, message, limit=S.get("chat.search_limit"))
        
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
        system_prompt = get_chatbot_system_prompt(context_str, project_id=project_id)
        
        messages = [{"role": "system", "content": system_prompt}]
        history_window = S.get("chat.history_window")
        for h in (history[-history_window:] if history_window > 0 else []):
            messages.append({
                "role": h.get("role", "user"),
                "content": h.get("content", "")
            })
        messages.append({"role": "user", "content": message})
        
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {
                "response": "Olá! Sou o assistente de edição do CapIAu-Talho. Configure a chave OpenRouter no painel de configurações da IA (engrenagem no topo) ou no `.env` para conversar.",
                "context_used": []
            }
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": S.get("llm.text_model"),
            "messages": messages,
            "temperature": S.get("chat.temperature")
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=S.get("chat.timeout"))
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
