"""Motor ASR (reconhecimento de fala) do CapIAu-Talho integrado com AssemblyAI."""
import os
import sys
import wave
import subprocess
from pathlib import Path
import numpy as np
import scipy.signal
import assemblyai as aai
from src.config import CONFIG
from src.db.operations import save_transcript_words, get_video_transcript, update_video_status
from src.search.semantic import SemanticSearch

def detect_voice_activity_offline(video_path: Path, video_id: int) -> bool:
    """Verifica se há atividade de voz (diálogo) no áudio do vídeo de forma local e offline.
    
    Usa um filtro passa-faixa (300Hz-3000Hz), energia RMS e ZCR (Zero Crossing Rate).
    """
    temp_wav_path = CONFIG.CACHE_DIR / f"vad_temp_{video_id}.wav"
    if temp_wav_path.exists():
        try:
            temp_wav_path.unlink()
        except Exception:
            pass
        
    print(f"  [VAD] Extraindo áudio de {video_path.name} para VAD...")
    
    cmd = [
        'ffmpeg', '-y', '-i', str(video_path),
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        str(temp_wav_path)
    ]
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, startupinfo=startupinfo, check=True)
        
        if not temp_wav_path.exists() or temp_wav_path.stat().st_size == 0:
            print("  [VAD] Erro: Arquivo temporário de áudio não foi gerado.")
            return False
            
        with wave.open(str(temp_wav_path), 'rb') as w:
            n_frames = w.getnframes()
            if n_frames == 0:
                return False
            frames = w.readframes(n_frames)
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
            
        fs = 16000
        if len(audio) < fs * 2:  # Clipes com menos de 2s
            return False
            
        # Filtro passa-faixa Butterworth (300Hz - 3000Hz)
        nyq = 0.5 * fs
        low = 300.0 / nyq
        high = 3000.0 / nyq
        b, a = scipy.signal.butter(4, [low, high], btype='band')
        filtered = scipy.signal.lfilter(b, a, audio)
        
        # Calcular RMS e ZCR em janelas de 100ms
        frame_size = int(fs * 0.1)  # 100ms
        n_samples = len(filtered)
        energies = []
        zcrs = []
        
        for i in range(0, n_samples - frame_size, frame_size):
            frame = filtered[i:i+frame_size]
            rms = np.sqrt(np.mean(frame ** 2))
            energies.append(rms)
            zcr = np.sum(np.abs(np.diff(frame > 0))) / len(frame)
            zcrs.append(zcr)
            
        energies = np.array(energies)
        zcrs = np.array(zcrs)
        
        mean_energy = np.mean(energies) if len(energies) > 0 else 0
        max_energy = np.max(energies) if len(energies) > 0 else 0
        
        # Critério adaptativo para voz
        energy_threshold = max(250.0, mean_energy * 1.5)
        speech_frames = 0
        for rms, zcr in zip(energies, zcrs):
            if rms > energy_threshold and 0.06 <= zcr <= 0.35:
                speech_frames += 1
                
        total_frames = len(energies)
        speech_ratio = speech_frames / total_frames if total_frames > 0 else 0.0
        
        has_speech = speech_ratio > 0.04 and max_energy > 350.0
        print(f"  [VAD] Resultado do B-Roll: Voz Detectada = {has_speech} (Ratio: {speech_ratio:.3f}, Energia Máx: {max_energy:.1f})")
        return has_speech
        
    except Exception as e:
        print(f"  [VAD] Erro na análise VAD para {video_path.name}: {e}")
        return False
    finally:
        if temp_wav_path.exists():
            try:
                temp_wav_path.unlink()
            except Exception:
                pass

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
        
    # Verificar se o vídeo é do tipo 'broll' e se possui voz antes de enviar para transcrição
    from src.db.operations import get_connection
    conn = get_connection()
    video_type = "interview"
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT video_type FROM video WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if row:
            video_type = row['video_type']
    except Exception as e:
        print(f"  [ASSEMBLY] Erro ao consultar tipo de vídeo: {e}")
    finally:
        conn.close()

    if video_type == "broll":
        has_voice = detect_voice_activity_offline(video_path, video_id)
        if not has_voice:
            print(f"  [ASSEMBLY] Nenhum diálogo detectado no B-Roll {video_path.name}. Pulando transcrição em nuvem.")
            save_transcript_words(video_id, [])
            update_video_status(video_id, 'transcribed')
            return True

    print(f"\n[ASSEMBLY] Enviando para transcrição na nuvem: {video_path.name}...")
    update_video_status(video_id, 'transcribing')
    
    # Verificar se o arquivo possui pelo menos uma stream de áudio
    import json
    import subprocess
    probe_cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=codec_type', '-of', 'json', str(video_path)
    ]
    has_audio = False
    try:
        startupinfo = None
        if os.name == 'nt':
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, startupinfo=startupinfo, check=True)
        probe_data = json.loads(probe_res.stdout)
        if probe_data.get('streams'):
            has_audio = True
    except Exception as e:
        print(f"  [ASSEMBLY] Aviso: Erro ao verificar faixa de áudio via ffprobe: {e}. Prosseguindo por padrão.")
        has_audio = True
        
    if not has_audio:
        print(f"  [ASSEMBLY] O arquivo '{video_path.name}' não possui faixa de áudio. Definindo transcrição como vazia.")
        save_transcript_words(video_id, [])
        update_video_status(video_id, 'transcribed')
        return True
        
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
        
        # Gerar resumo editorial automático por IA
        try:
            from src.nlp.summary_engine import generate_video_summary
            generate_video_summary(video_id, "interview", project_id)
        except Exception as sum_err:
            print(f"  [ASSEMBLY] Aviso: Erro na geração automática do resumo: {sum_err}")

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
