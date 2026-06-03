"""Módulo para geração automática de resumos, descrições e tags editoriais para vídeos (Entrevistas e B-rolls)."""
import os
import json
import requests
from pathlib import Path
from src.config import CONFIG
from src.db.operations import get_connection, update_video_metadata, get_video_transcript, add_relation

def generate_video_summary(video_id: int, video_type: str, project_id: int, visual_descriptions: list = None) -> bool:
    """Gera sumário, descrição e tags para um vídeo de entrevista ou B-roll e salva no SQLite.
    
    Para entrevistas: lê a transcrição do banco.
    Para B-rolls: consome a lista de descrições de frames passadas em visual_descriptions.
    """
    print(f"\n[SUMMARY] Iniciando sumarização por IA para Vídeo ID: {video_id} ({video_type})...")
    
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        print("  [WARNING] [SUMMARY] Chave do OpenRouter não configurada. Sumarização ignorada.")
        return False
        
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    prompt = ""
    if video_type == "interview":
        dialogues = get_video_transcript(video_id)
        if not dialogues:
            print("  [SUMMARY] Nenhuma transcrição encontrada para este vídeo de entrevista.")
            return False
            
        formatted_transcript = ""
        for block in dialogues:
            formatted_transcript += f"[{block['speaker_id']} | {block['start_time']:.1f}s - {block['end_time']:.1f}s]: \"{block['text']}\"\n\n"
            
        prompt = f"""Você é um editor sênior de documentários de cinema.
Analise a transcrição abaixo (composta por trechos falados com marcação de tempo e falante) e gere metadados editoriais úteis para a montagem.

TRANSCRIÇÃO DO VÍDEO:
{formatted_transcript[:25000]}

Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais de código como ```json, responda apenas o JSON puro):
{{
  "description": "Uma frase concisa resumindo quem é o entrevistado e o tema principal discutido (ex: Entrevista com o Diretor de Fotografia sobre a escolha da câmera RED e o tom sombrio)",
  "summary": "Um resumo detalhado em tópicos (bullet points) destacando as principais ideias, reflexões ou histórias contadas na entrevista, adequado para entender o conteúdo sem assistir todo o clipe",
  "tags": ["tag1", "tag2", "tag3"]
}}"""

    elif video_type == "broll":
        if not visual_descriptions:
            print("  [SUMMARY] Nenhuma descrição visual fornecida para este B-roll.")
            return False
            
        formatted_visuals = ""
        for frame in visual_descriptions:
            formatted_visuals += f"[Tempo: {frame['timestamp']:.1f}s]: {frame['description']} (Tags visuais: {', '.join(frame['tags'])})\n"
            
        prompt = f"""Você é um editor sênior de documentários de cinema.
Analise a sequência de ações visuais descritas abaixo, capturadas em frames a cada 10 segundos em um vídeo de B-roll (material de cobertura / bastidores), e gere metadados editoriais úteis.

SEQUÊNCIA DE AÇÕES VISUAIS:
{formatted_visuals[:25000]}

Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais de código como ```json, responda apenas o JSON puro):
{{
  "description": "Uma frase concisa descrevendo o conteúdo visual e a ação geral ocorrendo neste B-roll (ex: Bastidores da equipe preparando a iluminação e tripé da câmera no set de gravação externo)",
  "summary": "Um resumo do desenrolar da ação ou cenário apresentado neste clipe, descrevendo sua utilidade e valor editorial/estético para a edição (ex: Sequência útil para transições, mostrando a interação informal entre o diretor e atores antes do 'ação')",
  "tags": ["tag1", "tag2", "tag3"]
}}"""
    else:
        print(f"  [SUMMARY] Tipo de vídeo desconhecido '{video_type}'.")
        return False
        
    payload = {
        "model": CONFIG.TEXT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            res_json = response.json()
            content = res_json['choices'][0]['message']['content'].strip()
            
            # Limpar formatações markdown do JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
                
            data = json.loads(content.strip())
            
            desc = data.get("description", "")
            if isinstance(desc, list):
                desc = " ".join([str(x) for x in desc])
            elif not isinstance(desc, str):
                desc = str(desc)
                
            summary = data.get("summary", "")
            if isinstance(summary, list):
                summary = "\n".join([f"- {x}" if not str(x).strip().startswith("-") else str(x).strip() for x in summary])
            elif not isinstance(summary, str):
                summary = str(summary)
                
            tags = data.get("tags", [])
            if not isinstance(tags, list):
                tags = [str(tags)] if tags else []
                
            # Salvar no SQLite
            update_video_metadata(video_id, desc, summary, tags)
            print(f"  [SUCCESS] Metadados salvos no SQLite! Descrição: \"{desc[:60]}...\" | {len(tags)} tags")
            
            # Salvar relações de tags no grafo SQLite
            for tag in tags:
                add_relation(
                    project_id=project_id,
                    subject_type="video",
                    subject_id=str(video_id),
                    predicate="features_element",
                    object_type="theme",
                    object_id=tag,
                    weight=1.0
                )
            return True
        else:
            print(f"  [SUMMARY] Erro na API do OpenRouter (Status: {response.status_code}): {response.text}")
            return False
    except Exception as e:
        print(f"  [SUMMARY] Erro crítico ao chamar IA de sumarização: {e}")
        return False
