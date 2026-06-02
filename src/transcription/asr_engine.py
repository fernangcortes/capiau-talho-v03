"""Motor ASR (reconhecimento de fala) do CapIAu integrado com AssemblyAI."""
import os
import sys
from pathlib import Path
import assemblyai as aai
from src.config import CONFIG
from src.db.operations import save_transcript_words, get_video_transcript, update_video_status
from src.search.semantic import SemanticSearch

def transcribe_video_api(video_id: int, video_path: Path) -> bool:
    """Transcreve um vídeo completo usando a API AssemblyAI com pt-BR e diarização.
    
    Salva os resultados no SQLite e indexa semanticamente no Qdrant local.
    """
    api_key = CONFIG.ASSEMBLYAI_API_KEY
    if not api_key or api_key == "your_assemblyai_api_key_here":
        err_msg = "Chave ASSEMBLYAI_API_KEY não configurada no arquivo .env"
        print(f"[ASSEMBLY] [ERRO]: {err_msg}")
        update_video_status(video_id, 'error', error_message=err_msg)
        return False
        
    print(f"\n[ASSEMBLY] Enviando para transcrição na nuvem: {video_path.name}...")
    update_video_status(video_id, 'transcribing')
    
    aai.settings.api_key = api_key
    
    config = aai.TranscriptionConfig(
        language_code="pt",           # Idioma Português do Brasil
        speaker_labels=True,          # Ativa diarização (separar falantes)
        punctuate=True,
        format_text=True
    )
    
    # ── Extrair Áudio Leve (MP3) do Vídeo se for um vídeo ────────────────────────
    ext = video_path.suffix.lower()
    is_video = ext in {'.mp4', '.mov', '.mxf', '.mts', '.mkv', '.avi'}
    
    upload_path = video_path
    temp_audio_path = None
    
    if is_video:
        temp_audio_path = CONFIG.CACHE_DIR / f"aai_temp_audio_{video_id}.mp3"
        print(f"  [ASSEMBLY] Extraindo áudio mono de 16kHz do vídeo...")
        cmd = [
            'ffmpeg', '-y', '-i', str(video_path),
            '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1',
            str(temp_audio_path)
        ]
        try:
            startupinfo = None
            if os.name == 'nt':
                import subprocess
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
            # Executar ffmpeg silenciosamente
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
            if temp_audio_path.exists() and temp_audio_path.stat().st_size > 0:
                upload_path = temp_audio_path
                print(f"  [ASSEMBLY] Áudio extraído com sucesso: {temp_audio_path.name} ({temp_audio_path.stat().st_size / 1024 / 1024:.2f} MB)")
            else:
                print(f"  [ASSEMBLY] Aviso: Falha ao extrair áudio com FFmpeg. Enviando arquivo de vídeo original...")
        except Exception as ffmpeg_err:
            print(f"  [ASSEMBLY] Erro na extração de áudio: {ffmpeg_err}. Enviando arquivo de vídeo original...")
    
    try:
        transcriber = aai.Transcriber()
        # Envia e aguarda a conclusão da transcrição (AssemblyAI processa em nuvem)
        transcript = transcriber.transcribe(str(upload_path), config=config)
        
        if transcript.status == aai.TranscriptStatus.error:
            err_msg = f"Falha na API AssemblyAI: {transcript.error}"
            print(f"[ASSEMBLY] [ERRO]: {err_msg}")
            update_video_status(video_id, 'error', error_message=err_msg)
            return False
            
        print("  [OK] Transcrição concluída! Salvando no banco de dados...")
        
        # Mapear palavras palavra-a-palavra com speaker_id
        words = []
        for word in transcript.words:
            # AssemblyAI entrega timestamps em milissegundos
            start_s = word.start / 1000.0
            end_s = word.end / 1000.0
            speaker = f"Falante {word.speaker}" if word.speaker else "Desconhecido"
            words.append({
                "word": word.text,
                "start_time": start_s,
                "end_time": end_s,
                "speaker_id": speaker,
                "confidence": getattr(word, "confidence", 1.0)
            })
            
        # Salva no SQLite
        save_transcript_words(video_id, words)
        
        # Gera os blocos agregados de diálogo
        dialogues = get_video_transcript(video_id)
        
        # Buscar project_id do vídeo no SQLite
        from src.db.operations import get_connection
        conn = get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT project_id FROM video WHERE id = ?", (video_id,))
            row = cursor.fetchone()
            project_id = row['project_id'] if row else 1
        finally:
            conn.close()
            
        # Indexa os trechos semanticamente no Qdrant CPU local para buscas instantâneas
        print(f"  [ASSEMBLY] Indexando diálogos no Qdrant local para projeto ID {project_id}...")
        search_engine = SemanticSearch.get_instance()
        search_engine.index_transcript_chunks(project_id, video_id, dialogues)

        
        update_video_status(video_id, 'transcribed')
        print(f"  [SUCESSO] Transcrição e busca semântica finalizadas para Vídeo ID: {video_id}!")
        return True
        
    except Exception as e:
        err_msg = f"Erro inesperado no pipeline de ASR: {e}"
        print(f"[ASSEMBLY] [ERRO]: {err_msg}")
        update_video_status(video_id, 'error', error_message=err_msg)
        return False
    finally:
        if temp_audio_path and temp_audio_path.exists():
            try:
                temp_audio_path.unlink()
                print(f"  [ASSEMBLY] Arquivo de áudio temporário removido: {temp_audio_path.name}")
            except Exception as clean_err:
                print(f"  [ASSEMBLY] Aviso: Não foi possível deletar o arquivo de áudio temporário: {clean_err}")
