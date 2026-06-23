"""Motor de Visão Multimodal do CaIAu Talho para analisar frames de B-roll e Fotos de set via OpenRouter."""
import os
import sys
import base64
import requests
import json
import subprocess
from pathlib import Path
from src.config import CONFIG
from src.db.operations import add_relation, update_photo_analysis
from src.search.semantic import SemanticSearch

def extract_frame_ffmpeg(video_path: Path, timestamp: float, output_path: Path) -> bool:
    """Extrai um único frame de alta qualidade de um timestamp usando o FFmpeg (muito leve, com fallback de busca lenta)."""
    cmd_fast = [
        'ffmpeg', '-y',
        '-ss', str(timestamp),     # Posiciona no segundo exato de forma rápida
        '-i', str(video_path),
        '-vframes', '1',           # Extrai exatamente 1 frame
        '-q:v', '2',               # Qualidade alta (2-31, onde 2 é excelente)
        str(output_path)
    ]
    try:
        # Silencia a saída do FFmpeg
        subprocess.run(cmd_fast, capture_output=True, check=True)
        if output_path.exists():
            return True
    except Exception:
        # Fallback de busca lenta (-ss depois do -i) para arquivos .MTS com index corrompido
        cmd_slow = [
            'ffmpeg', '-y',
            '-i', str(video_path),
            '-ss', str(timestamp),
            '-vframes', '1',
            '-q:v', '2',
            str(output_path)
        ]
        try:
            subprocess.run(cmd_slow, capture_output=True, check=True)
            return output_path.exists()
        except Exception as e:
            print(f"[VISION] Falha critica ao extrair frame a {timestamp}s (busca rapida e lenta falharam): {e}")
            return False
    return False

def encode_image_base64(image_path: Path) -> str:
    """Codifica um arquivo de imagem local para base64 para envio na API."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def call_openrouter_vision(base64_image: str, extension: str = "jpeg") -> dict:
    """Envia uma imagem base64 para a API do OpenRouter usando o modelo mais custo-benefício (Gemini 2.5 Flash)."""
    api_key = CONFIG.OPENROUTER_API_KEY
    if not api_key or api_key == "your_openrouter_api_key_here":
        print("[VISION] [ERROR] Chave do OpenRouter não configurada no .env")
        return {"descricao": "Análise indisponível", "tags": []}

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    mime_type = f"image/{extension}"
    if extension == "jpg":
        mime_type = "image/jpeg"
        
    prompt = """Você é um assistente especialista em cinema. Analise esta imagem de bastidores (making of) ou set de filmagem.
Responda estritamente em Português e em formato JSON com a seguinte estrutura (não inclua marcações markdown adicionais, apenas o JSON puro):
{
  "descricao": "Uma frase concisa descrevendo o que está acontecendo e quem ou o que aparece na cena (ex: Diretor orientando ator com câmera à esquerda)",
  "tags": ["tag1", "tag2", "tag3"]
}"""

    payload = {
        "model": CONFIG.VISION_MODEL, # Modelo multimodal dinâmico lido do .env
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.2
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=20)
        if response.status_code == 200:
            res_json = response.json()
            content = res_json['choices'][0]['message']['content'].strip()
            # Tratar possíveis formatações markdown do JSON
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
                
            return json.loads(content.strip())
        else:
            print(f"[VISION] Erro na API do OpenRouter (Status: {response.status_code}): {response.text}")
            return {"descricao": "Análise falhou", "tags": []}
    except Exception as e:
        print(f"[VISION] Erro crítico ao chamar OpenRouter: {e}")
        return {"descricao": "Análise indisponível por erro de requisição", "tags": []}

def analyze_broll_video(video_id: int, filepath: Path, duration: float):
    """Varre um vídeo de B-Roll, extrai frames a cada X segundos e descreve-os via OpenRouter."""
    print(f"\n[VISION] Iniciando decupagem visual de B-Roll ID: {video_id} ({filepath.name})...")
    
    from src.db.operations import get_connection, update_video_status
    
    try:
        # Atualiza o status do vídeo para indicá-lo em processamento
        update_video_status(video_id, 'analyzing')
        
        # Obter project_id do SQLite
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT project_id FROM video WHERE id = ?", (video_id,))
            row = cursor.fetchone()
            project_id = row['project_id'] if row else 1
        finally:
            conn.close()
            
        # Criar diretório temporário no cache para frames extraídos
        video_cache_dir = CONFIG.CACHE_DIR / f"vid_{video_id}"
        video_cache_dir.mkdir(exist_ok=True)
        
        descriptions_indexed = []
        interval = CONFIG.FRAME_INTERVAL # 10 segundos
        
        # Mapear timestamps
        timestamps = []
        t = 0.0
        while t < duration:
            timestamps.append(t)
            t += interval
            
        for timestamp in timestamps:
            frame_name = f"frame_{int(timestamp)}s.jpg"
            frame_path = video_cache_dir / frame_name
            
            # 1. Extrair frame usando o FFmpeg local de forma ultrarrápida
            success = extract_frame_ffmpeg(filepath, timestamp, frame_path)
            if not success:
                continue
                
            # Detectar rostos no frame de vídeo
            try:
                from src.vision.face_engine import process_video_frame_faces
                process_video_frame_faces(project_id, video_id, timestamp, frame_path)
            except Exception as fe:
                print(f"[VISION] Erro ao detectar rostos no frame {timestamp}s: {fe}")
                
            # 2. Codificar para base64
            base64_img = encode_image_base64(frame_path)
            
            # 3. Chamar API de Visão do OpenRouter (Gemini 2.5 Flash)
            analysis = call_openrouter_vision(base64_img, "jpg")
            print(f"  Frame {timestamp}s: \"{analysis.get('descricao')}\" | Tags: {analysis.get('tags')}")
            
            descriptions_indexed.append({
                "timestamp": timestamp,
                "description": analysis.get("descricao", ""),
                "tags": analysis.get("tags", [])
            })
            
            # Registrar relações no grafo SQLite
            for tag in analysis.get("tags", []):
                add_relation(
                    project_id=project_id,
                    subject_type="video",
                    subject_id=str(video_id),
                    predicate="features_element",
                    object_type="theme",
                    object_id=tag,
                    weight=1.0
                )
                
            # Deletar arquivo temporário para economizar espaço em disco
            frame_path.unlink()
            
        # Indexar todas as descrições visuais no banco Qdrant local
        if descriptions_indexed:
            print(f"  [VISION] Indexando {len(descriptions_indexed)} frames visuais no Qdrant para projeto ID {project_id}...")
            search_engine = SemanticSearch.get_instance()
            search_engine.index_broll_descriptions(project_id, video_id, descriptions_indexed)
            
            # Gerar resumo editorial automático por IA
            try:
                from src.nlp.summary_engine import generate_video_summary
                generate_video_summary(video_id, "broll", project_id, visual_descriptions=descriptions_indexed)
            except Exception as sum_err:
                print(f"  [VISION] Aviso: Erro na geração automática do resumo: {sum_err}")
            
        # Limpar a pasta de cache do vídeo
        try:
            video_cache_dir.rmdir()
        except Exception:
            pass
            
        print(f"  [SUCCESS] Análise visual do vídeo {video_id} concluída!")
        update_video_status(video_id, 'analyzed')
        
    except Exception as e:
        print(f"  [ERROR] [VISION_ERROR] Erro ao analisar B-Roll ID {video_id}: {e}")
        update_video_status(video_id, 'error', error_message=str(e))

def analyze_set_photo(photo_id: int, filepath: Path):
    """Analisa uma foto de set importada usando a API de Visão e registra os dados."""
    print(f"\n[VISION] Analisando Foto de Set ID: {photo_id} ({filepath.name})...")
    
    # Obter project_id do SQLite
    from src.db.operations import get_connection
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT project_id FROM photo WHERE id = ?", (photo_id,))
        row = cursor.fetchone()
        project_id = row['project_id'] if row else 1
    finally:
        conn.close()
        
    try:
        # Se houver proxy gerado (WebP leve de 1024px), usá-lo para economizar tokens e rede
        proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
        if proxy_path.exists():
            print(f"  [VISION] Usando proxy WebP otimizado para a análise: {proxy_path.name}")
            base64_img = encode_image_base64(proxy_path)
            ext = "webp"
        else:
            print(f"  [VISION] Proxy não encontrado. Usando arquivo original: {filepath.name}")
            base64_img = encode_image_base64(filepath)
            ext = filepath.suffix.lower().replace('.', '')
            
        analysis = call_openrouter_vision(base64_img, ext)
        desc = analysis.get("descricao", "Foto de set analisada.")
        tags = analysis.get("tags", [])
        
        print(f"  Foto: \"{desc}\" | Tags: {tags}")
        
        # Atualizar no SQLite
        update_photo_analysis(photo_id, desc, tags)
        
        # Indexar no Qdrant
        search_engine = SemanticSearch.get_instance()
        search_engine.index_photo_description(project_id, photo_id, desc, tags)
        
        # Registrar no grafo relacional
        for tag in tags:
            add_relation(
                project_id=project_id,
                subject_type="photo",
                subject_id=str(photo_id),
                predicate="features_element",
                object_type="theme",
                object_id=tag,
                weight=1.0
            )
            
    except Exception as e:
        print(f"  [ERROR] Falha crítica ao processar a foto {filepath.name}: {e}")

