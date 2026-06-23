"""Serviço de IA e Pipeline orquestrando ASR (transcrição), Visão Multimodal e Clustering."""
import os
import wave
import json
import time
import requests
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

import numpy as np
import scipy.signal
import assemblyai as aai

from src.config import CONFIG
from src.db.connection import get_db
from src.db.repositories.media import MediaRepository
from src.db.repositories.narrative import NarrativeRepository
from src.core.exceptions import PipelineError
from src.nlp.prompt_templates import (
    VISION_PROMPT,
    get_interview_summary_prompt,
    get_broll_summary_prompt,
    get_theme_clustering_prompt
)
from src.nlp.json_parser import extract_json_from_markdown
from src.media.ffmpeg import extract_audio_mono, extract_frame, has_audio_stream
from src.search.semantic import SemanticSearch
from src.vision.face_engine import process_video_frame_faces, process_photo_faces
from src.core.tasks import TASK_MANAGER

class PipelineService:
    @staticmethod
    def detect_voice_activity_offline(video_path: Path, video_id: int) -> bool:
        """Detecção local de voz (VAD) em CPU para pular ASR em B-rolls mudos."""
        temp_wav_path = CONFIG.CACHE_DIR / f"vad_temp_{video_id}.wav"
        if temp_wav_path.exists():
            try:
                temp_wav_path.unlink()
            except Exception:
                pass
            
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
                return False
                
            with wave.open(str(temp_wav_path), 'rb') as w:
                n_frames = w.getnframes()
                if n_frames == 0:
                    return False
                frames = w.readframes(n_frames)
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
                
            fs = 16000
            if len(audio) < fs * 2:
                return False
                
            # Filtro passa-faixa Butterworth (300Hz - 3000Hz)
            nyq = 0.5 * fs
            low = 300.0 / nyq
            high = 3000.0 / nyq
            b, a = scipy.signal.butter(4, [low, high], btype='band')
            filtered = scipy.signal.lfilter(b, a, audio)
            
            frame_size = int(fs * 0.1)  # frames de 100ms
            n_samples = len(filtered)
            energies = []
            zcrs = []
            
            for i in range(0, n_samples - frame_size, frame_size):
                frame = filtered[i:i+frame_size]
                rms = np.sqrt(np.mean(frame ** 2))
                energies.append(rms)
                zcr = np.sum(np.abs(np.diff(frame > 0))) / len(frame)
                zcrs.append(zcr)
                
            energies_np = np.array(energies)
            zcrs_np = np.array(zcrs)
            
            mean_energy = np.mean(energies_np) if len(energies_np) > 0 else 0
            max_energy = np.max(energies_np) if len(energies_np) > 0 else 0
            
            energy_threshold = max(250.0, mean_energy * 1.5)
            speech_frames = 0
            for rms, zcr in zip(energies_np, zcrs_np):
                if rms > energy_threshold and 0.06 <= zcr <= 0.35:
                    speech_frames += 1
                    
            total_frames = len(energies_np)
            speech_ratio = speech_frames / total_frames if total_frames > 0 else 0.0
            
            return speech_ratio > 0.04 and max_energy > 350.0
        except Exception as e:
            print(f"[VAD] Erro na análise offline VAD para {video_path.name}: {e}")
            return False
        finally:
            if temp_wav_path.exists():
                try:
                    temp_wav_path.unlink()
                except Exception:
                    pass

    @staticmethod
    def transcribe_video(video_id: int, video_path: Path) -> bool:
        """Executa o pipeline completo de transcrição AssemblyAI (nuvem) e indexação local (Qdrant)."""
        api_key = CONFIG.ASSEMBLYAI_API_KEY
        if not api_key or api_key == "your_assemblyai_api_key_here":
            err_msg = "AssemblyAI API Key não configurada no .env"
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
            return False

        # Verifica tipo de vídeo no banco
        with get_db() as conn:
            video = MediaRepository.get_video(conn, video_id)
            if not video:
                return False
            video_type = video['video_type']
            project_id = video['project_id']

        # Pula transcrição se for B-roll sem áudio de diálogo
        if video_type == "broll":
            if not PipelineService.detect_voice_activity_offline(video_path, video_id):
                with get_db() as conn:
                    NarrativeRepository.save_transcript_words(conn, video_id, [])
                    MediaRepository.update_video_status(conn, video_id, 'transcribed')
                return True

        with get_db() as conn:
            MediaRepository.update_video_status(conn, video_id, 'transcribing')
        TASK_MANAGER.update_progress(str(video_id), 0.0, "running", task_type="transcription")

        # Verifica stream de áudio física
        if not has_audio_stream(video_path):
            with get_db() as conn:
                NarrativeRepository.save_transcript_words(conn, video_id, [])
                MediaRepository.update_video_status(conn, video_id, 'transcribed')
            return True

        temp_audio_path = CONFIG.CACHE_DIR / f"aai_temp_audio_{video_id}.mp3"
        upload_path = video_path
        
        # Tenta extrair áudio leve MP3
        if extract_audio_mono(video_path, temp_audio_path):
            upload_path = temp_audio_path

        try:
            aai.settings.api_key = api_key
            config = aai.TranscriptionConfig(
                language_code="pt",
                speaker_labels=True,
                punctuate=True,
                format_text=True
            )
            
            transcriber = aai.Transcriber()
            transcript = transcriber.transcribe(str(upload_path), config=config)
            
            if transcript.status == aai.TranscriptStatus.error:
                raise PipelineError(f"Falha na API AssemblyAI: {transcript.error}")
                
            words = []
            for word in transcript.words:
                words.append({
                    "word": word.text,
                    "start_time": word.start / 1000.0,
                    "end_time": word.end / 1000.0,
                    "speaker_id": f"Falante {word.speaker}" if word.speaker else "Desconhecido",
                    "confidence": getattr(word, "confidence", 1.0)
                })
                
            with get_db() as conn:
                NarrativeRepository.save_transcript_words(conn, video_id, words)
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
                
            # Indexação semântica no Qdrant
            search_engine = SemanticSearch.get_instance()
            search_engine.index_transcript_chunks(project_id, video_id, dialogues, video_type)
            
            # Gera resumo automático
            try:
                PipelineService.generate_video_summary(video_id, "interview", project_id)
            except Exception as sum_err:
                print(f"[ASR] Aviso: Falha na geração do resumo: {sum_err}")
                
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'transcribed')
            TASK_MANAGER.update_progress(str(video_id), 100.0, "finished", task_type="transcription")
            return True
        except Exception as e:
            err_msg = str(e)
            print(f"[ASR] Erro inesperado no pipeline ASR: {err_msg}")
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
            TASK_MANAGER.update_progress(str(video_id), 0.0, "failed", task_type="transcription")
            return False
        finally:
            if temp_audio_path.exists():
                try:
                    temp_audio_path.unlink()
                except Exception:
                    pass

    @staticmethod
    def call_openrouter_vision(base64_image: str, extension: str = "jpeg") -> Dict[str, Any]:
        """Chama a API do OpenRouter Vision para analisar frames ou fotos."""
        api_key = CONFIG.OPENROUTER_API_KEY
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {"descricao": "Análise indisponível", "tags": []}
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        mime_type = "image/jpeg" if extension in ["jpeg", "jpg"] else f"image/{extension}"
        
        payload = {
            "model": CONFIG.VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
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
                return extract_json_from_markdown(content)
            else:
                return {"descricao": "Análise falhou", "tags": []}
        except Exception as e:
            print(f"[Vision] Erro ao chamar OpenRouter: {e}")
            return {"descricao": "Análise indisponível por erro de requisição", "tags": []}

    @staticmethod
    def analyze_video_vision(video_id: int, filepath: Path, duration: float) -> bool:
        """Decupa frames-chave do vídeo B-roll enviando para LLM multimodal e Qdrant."""
        with get_db() as conn:
            video = MediaRepository.get_video(conn, video_id)
            if not video:
                return False
            project_id = video['project_id']
            MediaRepository.update_video_status(conn, video_id, 'analyzing')
        TASK_MANAGER.update_progress(str(video_id), 0.0, "running", task_type="vision")
            
        video_cache_dir = CONFIG.CACHE_DIR / f"vid_{video_id}"
        video_cache_dir.mkdir(exist_ok=True)
        
        descriptions_indexed = []
        interval = CONFIG.FRAME_INTERVAL
        
        timestamps = []
        t = 0.0
        while t < duration:
            timestamps.append(t)
            t += interval
            
        try:
            total_stamps = len(timestamps)
            for idx, timestamp in enumerate(timestamps):
                percent = (idx / total_stamps) * 100.0
                TASK_MANAGER.update_progress(str(video_id), percent, "running", task_type="vision")
                frame_path = video_cache_dir / f"frame_{int(timestamp)}s.jpg"
                if not extract_frame(filepath, timestamp, frame_path):
                    continue
                    
                # Roda reconhecimento facial do frame
                try:
                    process_video_frame_faces(project_id, video_id, timestamp, frame_path)
                except Exception as fe:
                    print(f"[Vision] Falha facial no frame {timestamp}s: {fe}")
                    
                # Base64 encoding
                import base64
                with open(frame_path, "rb") as img_file:
                    base64_img = base64.b64encode(img_file.read()).decode('utf-8')
                    
                analysis = PipelineService.call_openrouter_vision(base64_img, "jpg")
                descriptions_indexed.append({
                    "timestamp": timestamp,
                    "description": analysis.get("descricao", ""),
                    "tags": analysis.get("tags", [])
                })
                
                # Registra no grafo relacional
                with get_db() as conn:
                    for tag in analysis.get("tags", []):
                        NarrativeRepository.add_relation(
                            conn, project_id, "video", str(video_id),
                            "features_element", "theme", tag
                        )
                
                try:
                    frame_path.unlink()
                except Exception:
                    pass
                    
            if descriptions_indexed:
                search_engine = SemanticSearch.get_instance()
                search_engine.index_broll_descriptions(project_id, video_id, descriptions_indexed)
                
                try:
                    PipelineService.generate_video_summary(video_id, "broll", project_id, descriptions_indexed)
                except Exception as sum_err:
                    print(f"[Vision] Falha ao resumir B-roll: {sum_err}")
                    
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'analyzed')
            TASK_MANAGER.update_progress(str(video_id), 100.0, "finished", task_type="vision")
            return True
        except Exception as e:
            err_msg = str(e)
            print(f"[Vision] Falha multimodal no vídeo {video_id}: {err_msg}")
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
            TASK_MANAGER.update_progress(str(video_id), 0.0, "failed", task_type="vision")
            return False
        finally:
            # Limpa pasta temporária
            for f in video_cache_dir.glob("*"):
                try:
                    f.unlink()
                except Exception:
                    pass
            try:
                video_cache_dir.rmdir()
            except Exception:
                pass

    @staticmethod
    def analyze_photo_vision(photo_id: int, filepath: Path) -> bool:
        """Analisa foto de set via API de Visão, SQLite e indexação Qdrant."""
        with get_db() as conn:
            photo = MediaRepository.get_photo(conn, photo_id)
            if not photo:
                return False
            project_id = photo['project_id']
            MediaRepository.update_photo_status(conn, photo_id, 'pending')
        TASK_MANAGER.update_progress(f"photo-{photo_id}", 0.0, "running", task_type="vision")
            
        try:
            proxy_path = CONFIG.PROXIES_DIR / "photos" / f"proxy_photo_{photo_id}.webp"
            target_path = proxy_path if proxy_path.exists() else filepath
            ext = target_path.suffix.lower().replace('.', '')
            
            import base64
            with open(target_path, "rb") as img_file:
                base64_img = base64.b64encode(img_file.read()).decode('utf-8')
                
            analysis = PipelineService.call_openrouter_vision(base64_img, ext)
            desc = analysis.get("descricao", "Foto de set analisada.")
            tags = analysis.get("tags", [])
            
            with get_db() as conn:
                MediaRepository.update_photo_analysis(conn, photo_id, desc, tags)
                
                for tag in tags:
                    NarrativeRepository.add_relation(
                        conn, project_id, "photo", str(photo_id),
                        "features_element", "theme", tag
                    )
                    
            search_engine = SemanticSearch.get_instance()
            search_engine.index_photo_description(project_id, photo_id, desc, tags)
            TASK_MANAGER.update_progress(f"photo-{photo_id}", 100.0, "finished", task_type="vision")
            return True
        except Exception as e:
            print(f"[Vision] Erro ao analisar foto {photo_id}: {e}")
            with get_db() as conn:
                MediaRepository.update_photo_status(conn, photo_id, 'error')
            TASK_MANAGER.update_progress(f"photo-{photo_id}", 0.0, "failed", task_type="vision")
            return False

    @staticmethod
    def run_project_theme_clustering(project_id: int) -> Dict[str, Any]:
        """Agrupa blocos falados em temas lógicos usando o DeepSeek Chat do OpenRouter."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT t.id, t.video_id, t.word, t.start_time, t.end_time, t.speaker_id
                FROM transcript t
                JOIN video v ON t.video_id = v.id
                WHERE v.project_id = ? AND v.video_type = 'interview'
                ORDER BY t.video_id, t.start_time
            """, (project_id,))
            rows = cursor.fetchall()
            
        if not rows:
            return {"themes": []}
            
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
            
        formatted_transcript = ""
        for block in dialogue_blocks:
            formatted_transcript += f"[Bloco ID: {block['id']} | Vídeo ID: {block['video_id']} | Falante: {block['speaker']}]:\n\"{block['text']}\"\n\n"
            
        prompt = get_theme_clustering_prompt(formatted_transcript[:30000])
        
        api_key = CONFIG.OPENROUTER_API_KEY
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {"themes": []}
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": CONFIG.TEXT_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=35)
            if response.status_code == 200:
                res_json = response.json()
                content = res_json['choices'][0]['message']['content'].strip()
                data = extract_json_from_markdown(content)
                
                with get_db() as conn:
                    for t in data.get("themes", []):
                        theme_id = NarrativeRepository.add_theme(conn, project_id, t["title"], t.get("description", ""))
                        
                        # Mapeia blocos do tema para transcript_id real aproximado no SQLite
                        for block_id in t.get("blocks", []):
                            target_block = next((b for b in dialogue_blocks if b["id"] == block_id), None)
                            if target_block:
                                cursor = conn.cursor()
                                cursor.execute("""
                                    SELECT id FROM transcript 
                                    WHERE video_id = ? AND speaker_id = ?
                                    ORDER BY start_time LIMIT 1
                                """, (target_block["video_id"], target_block["speaker"]))
                                row = cursor.fetchone()
                                if row:
                                    NarrativeRepository.add_transcript_theme(conn, row[0], theme_id)
                                    
                                # Registra no grafo relacional
                                NarrativeRepository.add_relation(
                                    conn, project_id, "video", str(target_block["video_id"]),
                                    "belongs_to_theme", "theme", str(theme_id)
                                )
                return data
            return {"themes": []}
        except Exception as e:
            print(f"[Clustering] Falha de clustering LLM: {e}")
            return {"themes": []}

    @staticmethod
    def generate_video_summary(video_id: int, video_type: str, project_id: int, visual_descriptions: Optional[List[Dict[str, Any]]] = None) -> bool:
        """Gera descrição, sumário em marcadores e tags por IA para o vídeo."""
        api_key = CONFIG.OPENROUTER_API_KEY
        if not api_key or api_key == "your_openrouter_api_key_here":
            return False
            
        if video_type == "interview":
            with get_db() as conn:
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
                
            if not dialogues:
                return False
                
            formatted = ""
            for block in dialogues:
                formatted += f"[{block['speaker_id']} | {block['start_time']:.1f}s - {block['end_time']:.1f}s]: \"{block['text']}\"\n\n"
            prompt = get_interview_summary_prompt(formatted[:25000])
        elif video_type == "broll" and visual_descriptions:
            formatted = ""
            for frame in visual_descriptions:
                formatted += f"[Tempo: {frame['timestamp']:.1f}s]: {frame['description']} (Tags visuais: {', '.join(frame['tags'])})\n"
            prompt = get_broll_summary_prompt(formatted[:25000])
        else:
            return False
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
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
                data = extract_json_from_markdown(content)
                
                desc = data.get("description", "")
                if isinstance(desc, list):
                    desc = " ".join([str(x) for x in desc])
                
                summary = data.get("summary", "")
                if isinstance(summary, list):
                    summary = "\n".join([f"- {x}" for x in summary])
                
                tags = data.get("tags", [])
                
                with get_db() as conn:
                    MediaRepository.update_video_metadata(conn, video_id, desc, summary, tags)
                    
                    for tag in tags:
                        NarrativeRepository.add_relation(
                            conn, project_id, "video", str(video_id),
                            "features_element", "theme", tag
                        )
                return True
            return False
        except Exception as e:
            print(f"[Summary] Falha ao gerar sumário de vídeo: {e}")
            return False
