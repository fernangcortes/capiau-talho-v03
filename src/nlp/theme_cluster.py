"""Módulo de Inteligência Editorial (Clustering de Temas Narrativos e Making Of)."""
import os
import sys
import json
import requests
import sqlite3
from src.config import CONFIG
from src.db.operations import get_connection, add_theme, add_relation

def extract_makingof_themes(project_id: int = 1) -> dict:
    """Carrega todas as falas de entrevistas no SQLite, envia para o DeepSeek Chat,
    extrai os temas principais e mapeia no banco relacional.
    """
    print(f"\n[NLP] Iniciando agrupamento (clustering) temático de entrevistas para projeto: {project_id}...")
    
    # 1. Carregar todos os diálogos de entrevistas gravados no SQLite
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT t.id, t.video_id, t.word, t.start_time, t.end_time, t.speaker_id, v.filename
            FROM transcript t
            JOIN video v ON t.video_id = v.id
            WHERE v.project_id = ? AND v.video_type = 'interview'
            ORDER BY t.video_id, t.start_time
        """, (project_id,))
        rows = cursor.fetchall()
    finally:
        conn.close()
        
    if not rows:
        print("  [NLP] Nenhuma fala de entrevista encontrada para processar.")
        return {"themes": []}
        
    # Agrupar falas em blocos para reduzir tokens no prompt
    dialogue_blocks = []
    current_block = []
    current_speaker = None
    current_video = None
    
    for r in rows:
        speaker = r['speaker_id']
        word = r['word']
        vid = r['video_id']
        
        if (current_speaker != speaker) or (current_video != vid):
            if current_block:
                dialogue_blocks.append({
                    "id": len(dialogue_blocks) + 1,
                    "video_id": current_video,
                    "speaker": current_speaker,
                    "text": " ".join(current_block)
                })
            current_speaker = speaker
            current_video = vid
            current_block = [word]
        else:
            current_block.append(word)
            
    if current_block:
        dialogue_blocks.append({
            "id": len(dialogue_blocks) + 1,
            "video_id": current_video,
            "speaker": current_speaker,
            "text": " ".join(current_block)
        })
        
    print(f"  [NLP] Agrupados {len(dialogue_blocks)} blocos de falas de depoimentos.")
    
    # Consolidar blocos em texto formatado para o LLM
    formatted_transcript = ""
    for block in dialogue_blocks:
        formatted_transcript += f"[Bloco ID: {block['id']} | Vídeo ID: {block['video_id']} | Falante: {block['speaker']}]:\n\"{block['text']}\"\n\n"
        
    # Chamar o DeepSeek V3 (via OpenRouter) para processar o clustering
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        print("  ❌ [NLP] Chave do OpenRouter não configurada. Abortando clustering.")
        return {"themes": []}
        
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    prompt = f"""Você é um editor sênior de documentários de cinema. 
Analise a transcrição abaixo (composta de trechos de making of e bastidores de um filme) e identifique de 5 a 8 temas/tópicos narrativos principais abordados (ex: "Direção de Atores", "Desafios de Efeitos Especiais", "Desenvolvimento de Roteiro", "Luz e Fotografia", etc.).

Para cada tema identificado:
1. Crie um título claro e profissional.
2. Escreva uma breve descrição do que se trata o tema.
3. Forneça uma lista de quais 'Bloco ID' se encaixam nesse tema.

TRANSCRIÇÃO DE ENTRADAS:
{formatted_transcript[:30000]} -- limita a 30k tokens para evitar limites básicos

Responda estritamente em Português e em formato JSON puro, sem marcações markdown de blocos ou explicações extras. Use o seguinte formato:
{{
  "themes": [
    {{
      "titulo": "Nome do Tema",
      "descricao": "Explicação curta do tema",
      "blocos_relacionados": [1, 5, 12]
    }}
  ]
}}"""

    payload = {
        "model": CONFIG.TEXT_MODEL, # Modelo dinâmico lido do .env
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3
    }

    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=40)
        if response.status_code == 200:
            res_json = response.json()
            content = res_json['choices'][0]['message']['content'].strip()
            
            # Tratar markdown
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
                
            result = json.loads(content.strip())
            
            # 3. Salvar os temas propostos e criar as relações no SQLite
            conn = get_connection()
            try:
                cursor = conn.cursor()
                for theme_data in result.get("themes", []):
                    title = theme_data["titulo"]
                    desc = theme_data["descricao"]
                    blocos = theme_data.get("blocos_relacionados", [])
                    
                    # Registrar Tema no banco
                    theme_id = add_theme(project_id, title, desc)
                    print(f"  ✅ Tema catalogado: \"{title}\" (ID: {theme_id})")
                    
                    # Mapear relações no grafo
                    for b_id in blocos:
                        # Encontrar qual bloco corresponde a esse ID
                        match_block = next((b for b in dialogue_blocks if b['id'] == b_id), None)
                        if match_block:
                            # Adicionar relação SQLite: Bloco pertence ao tema
                            add_relation(
                                project_id=project_id,
                                subject_type="video",
                                subject_id=str(match_block['video_id']),
                                predicate="belongs_to_theme",
                                object_type="theme",
                                object_id=str(theme_id),
                                weight=1.0
                            )
                            # Adicionar relação do falante com o tema
                            add_relation(
                                project_id=project_id,
                                subject_type="speaker",
                                subject_id=match_block['speaker'],
                                predicate="discusses_theme",
                                object_type="theme",
                                object_id=str(theme_id),
                                weight=1.0
                            )
                print("  🎉 Agrupamento temático processado com sucesso!")
                return result
            except Exception as db_err:
                print(f"  ❌ Erro ao salvar relações de temas no banco: {db_err}")
                return {"themes": []}
        else:
            print(f"  ❌ [NLP] Falha no OpenRouter (Status {response.status_code}): {response.text}")
            return {"themes": []}
    except Exception as e:
        print(f"  ❌ [NLP] Erro crítico ao conectar à API do OpenRouter: {e}")
        return {"themes": []}
