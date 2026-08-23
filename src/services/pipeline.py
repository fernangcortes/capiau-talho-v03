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
    get_vision_prompt,
    get_triage_prompt,
    get_interview_summary_prompt,
    get_broll_summary_prompt,
    get_theme_clustering_prompt
)
from src.nlp.prompt_registry import TRIAGE_CATEGORIES
from src.services.analysis_policy import get_profile

# Tags de categoria são proibidas como tag de busca: se quase tudo é "making of",
# a tag não discrimina nada — a categoria vive no campo próprio (video/photo.category)
GENERIC_TAG_BLOCKLIST = {
    "making of", "making-of", "makingof", "bastidores", "set de filmagem",
    "set", "filmagem", "cinema", "filme", "video", "vídeo", "foto", "fotografia",
    "imagem", "audiovisual", "b-roll", "broll", "producao", "produção",
    "entrevista", "depoimento", "gravacao", "gravação",
}
from src.db.repositories.entities import EntityRepository
from src.nlp.json_parser import extract_json_from_markdown
from src.media.ffmpeg import extract_audio_mono, extract_frame, has_audio_stream
from src.search.semantic import SemanticSearch
from src.vision.face_engine import process_video_frame_faces, process_photo_faces
from src.core.tasks import TASK_MANAGER
from src.services.settings_service import SettingsService

class PipelineService:
    @staticmethod
    def clean_tags(tags: List[str]) -> List[str]:
        """Remove tags genéricas de categoria e duplicatas (case-insensitive)."""
        cleaned = []
        seen = set()
        for tag in tags or []:
            t = str(tag).strip()
            key = t.lower()
            if not t or key in GENERIC_TAG_BLOCKLIST or key in seen:
                continue
            seen.add(key)
            cleaned.append(t)
        return cleaned

    @staticmethod
    def _call_vision_api(messages: list, project_id: Optional[int], log_prefix: str, timeout_floor: float = 0.0) -> Dict[str, Any]:
        """Chama a API de visão com retry no modelo principal e fallback automático.

        Tenta 'llm.vision_model' até 'vision.max_retries' vezes; se todas falharem,
        tenta 'llm.vision_model_fallback' uma vez. Existe para permitir um modelo
        ':free' como padrão sem depender só dele: modelos grátis da OpenRouter falham
        sob carga com "Upstream idle timeout exceeded" (504) com frequência real —
        medido em 17/07/2026, ~metade das chamadas com o prompt de produção.

        Retorna {} se principal E reserva falharem — o chamador decide o que fazer
        (nunca sobrescrever dado bom com o resultado vazio, ver analyze_photo_vision).
        """
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {}

        primary = S.get("llm.vision_model")
        fallback = S.get("llm.vision_model_fallback")
        retries = max(1, S.get("vision.max_retries"))
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        base_payload = {
            "messages": messages,
            "temperature": S.get("vision.temperature"),
            "max_tokens": S.get("vision.max_tokens"),
        }
        timeout = max(S.get("vision.timeout"), timeout_floor)

        def _attempt(model: str) -> Optional[Dict[str, Any]]:
            payload = {**base_payload, "model": model}
            try:
                response = requests.post(url, headers=headers, json=payload, timeout=timeout)
                if response.status_code != 200:
                    print(f"[{log_prefix}] Falha na API de visão (modelo {model}, status {response.status_code}): {response.text[:300]}")
                    return None
                res_json = response.json()
                if "choices" not in res_json or not res_json["choices"]:
                    # status 200 com corpo de erro (ex.: "Upstream idle timeout
                    # exceeded") acontece de verdade com modelos ':free' sob carga.
                    print(f"[{log_prefix}] Resposta sem 'choices' do modelo {model}: {res_json.get('error', res_json)}")
                    return None
                msg = res_json["choices"][0].get("message", {})
                raw_content = msg.get("content")
                if not isinstance(raw_content, str) or not raw_content.strip():
                    print(f"[{log_prefix}] Resposta sem conteúdo do modelo {model}: {res_json.get('error', res_json)}")
                    return None
                return extract_json_from_markdown(raw_content.strip())
            except Exception as e:
                print(f"[{log_prefix}] Erro ao chamar {model}: {e}")
                return None

        for attempt in range(1, retries + 1):
            result = _attempt(primary)
            if result is not None:
                return result
            print(f"[{log_prefix}] Tentativa {attempt}/{retries} falhou em {primary}.")

        if fallback and fallback != primary:
            print(f"[{log_prefix}] {retries} tentativa(s) esgotada(s) em {primary}; usando reserva {fallback}.")
            result = _attempt(fallback)
            if result is not None:
                return result

        return {}

    @staticmethod
    def call_openrouter_vision_multi(base64_images: List[str], prompt: str, project_id: Optional[int] = None) -> Dict[str, Any]:
        """Chama a API de visão com MÚLTIPLAS imagens em uma única requisição (triagem)."""
        content = [{"type": "text", "text": prompt}]
        for b64 in base64_images:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
            })
        messages = [{"role": "user", "content": content}]
        return PipelineService._call_vision_api(messages, project_id, "Triage", timeout_floor=40)

    @staticmethod
    def triage_video(video_id: int, filepath: Path, duration: float, project_id: int) -> Dict[str, Any]:
        """Triagem do vídeo: 3-4 frames espalhados + contexto barato → categoria (Eixo A), título e confiança.

        Persiste category/category_confidence/title e deriva video_type quando o
        atual é 'unknown' (ou quando a triagem discorda com confiança alta).
        Retorna o dict da triagem ({} em falha — o pipeline segue sem categoria).
        """
        import base64

        # Frames espalhados pela duração (mínimo 1 para clipes muito curtos)
        fractions = [0.1, 0.35, 0.6, 0.85] if duration >= 20 else [0.2, 0.7]
        triage_dir = CONFIG.CACHE_DIR / f"triage_{video_id}"
        triage_dir.mkdir(exist_ok=True)

        base64_images = []
        try:
            for idx, frac in enumerate(fractions):
                ts = max(0.0, min(duration * frac, max(duration - 0.5, 0.0)))
                frame_path = triage_dir / f"triage_{idx}.jpg"
                if extract_frame(filepath, ts, frame_path):
                    with open(frame_path, "rb") as f:
                        base64_images.append(base64.b64encode(f.read()).decode("utf-8"))
            if not base64_images:
                return {}

            # Contexto barato: transcrição (se existir), entidades, pasta
            transcript_snippet = ""
            known_entities = []
            with get_db() as conn:
                try:
                    dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
                    if dialogues:
                        transcript_snippet = " ".join([d["text"] for d in dialogues[:6]])
                except Exception:
                    pass
                try:
                    known_entities = EntityRepository.get_known_names(conn, project_id)
                except Exception:
                    pass

            prompt = get_triage_prompt(
                filename=filepath.name,
                folder_hint=filepath.parent.name,
                transcript_snippet=transcript_snippet,
                known_entities=known_entities,
                project_id=project_id
            )
            result = PipelineService.call_openrouter_vision_multi(base64_images, prompt, project_id=project_id)

            category = str(result.get("categoria", "")).strip().lower()
            if category not in TRIAGE_CATEGORIES:
                return {}
            try:
                confidence = float(result.get("confianca", 0.0))
            except Exception:
                confidence = 0.0
            title = str(result.get("titulo", "")).strip()

            S = SettingsService.get_settings(project_id)
            min_conf = S.get("triage.min_confidence")

            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE video SET category = ?, category_confidence = ?, title = COALESCE(NULLIF(?, ''), title) WHERE id = ?",
                    (category, confidence, title, video_id)
                )
                # Deriva video_type por conteúdo: 'depoimento' → interview, resto → broll.
                # Só sobrescreve tipo já definido (por nome de arquivo) com confiança alta.
                derived_type = "interview" if category == "depoimento" else "broll"
                cursor.execute("SELECT video_type FROM video WHERE id = ?", (video_id,))
                row = cursor.fetchone()
                current_type = row["video_type"] if row else "unknown"
                if current_type == "unknown" and confidence >= min_conf:
                    cursor.execute("UPDATE video SET video_type = ? WHERE id = ?", (derived_type, video_id))
                elif current_type != derived_type and confidence >= 0.8:
                    cursor.execute("UPDATE video SET video_type = ? WHERE id = ?", (derived_type, video_id))
                conn.commit()

            print(f"[Triage] Vídeo {video_id}: categoria='{category}' (conf {confidence:.2f}) título='{title}'")
            return {"categoria": category, "confianca": confidence, "titulo": title}
        except Exception as e:
            print(f"[Triage] Falha na triagem do vídeo {video_id}: {e}")
            return {}
        finally:
            for f in triage_dir.glob("*"):
                try:
                    f.unlink()
                except Exception:
                    pass
            try:
                triage_dir.rmdir()
            except Exception:
                pass

    @staticmethod
    def detect_voice_activity_offline(video_path: Path, video_id: int, project_id: Optional[int] = None) -> bool:
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
            
            S = SettingsService.get_settings(project_id)
            energy_threshold = max(S.get("vad.energy_floor"), mean_energy * 1.5)
            speech_frames = 0
            for rms, zcr in zip(energies_np, zcrs_np):
                if rms > energy_threshold and 0.06 <= zcr <= 0.35:
                    speech_frames += 1

            total_frames = len(energies_np)
            speech_ratio = speech_frames / total_frames if total_frames > 0 else 0.0

            return speech_ratio > S.get("vad.speech_ratio_min") and max_energy > S.get("vad.max_energy_min")
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
        # Verifica tipo de vídeo no banco
        with get_db() as conn:
            video = MediaRepository.get_video(conn, video_id)
            if not video:
                return False
            video_type = video['video_type']
            project_id = video['project_id']

        # Configurações resolvidas do projeto (chave, idioma, diarização, VAD)
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("assemblyai")
        if not api_key or api_key == "your_assemblyai_api_key_here":
            err_msg = "AssemblyAI API Key não configurada (painel de configurações da IA ou .env)"
            with get_db() as conn:
                MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
            return False

        # Pula transcrição se for B-roll (ou tipo desconhecido) sem áudio de diálogo
        if video_type in ("broll", "unknown"):
            if not PipelineService.detect_voice_activity_offline(video_path, video_id, project_id):
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
                language_code=S.get("asr.language"),
                speaker_labels=S.get("asr.speaker_labels"),
                entity_detection=S.get("asr.entity_detection"),
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
                
            # Entidades faladas (nomes, lugares, organizacoes) quando a deteccao esta ligada.
            # A AssemblyAI entrega timestamps em milissegundos, igual as palavras.
            entidades = []
            for ent in (getattr(transcript, "entities", None) or []):
                tipo = getattr(ent, "entity_type", None)
                entidades.append({
                    "entity_type": getattr(tipo, "value", None) or str(tipo),
                    "text": getattr(ent, "text", ""),
                    "start_time": (ent.start / 1000.0) if getattr(ent, "start", None) is not None else None,
                    "end_time": (ent.end / 1000.0) if getattr(ent, "end", None) is not None else None,
                })

            with get_db() as conn:
                NarrativeRepository.save_transcript_words(conn, video_id, words)
                conn.execute("DELETE FROM transcript_entity WHERE video_id = ?", (video_id,))
                if entidades:
                    conn.executemany(
                        "INSERT INTO transcript_entity (video_id, entity_type, text, start_time, end_time) "
                        "VALUES (?, ?, ?, ?, ?)",
                        [(video_id, e["entity_type"], e["text"], e["start_time"], e["end_time"])
                         for e in entidades],
                    )
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)
                
            # Indexação semântica no Qdrant
            search_engine = SemanticSearch.get_instance()
            search_engine.index_transcript_chunks(project_id, video_id, dialogues, video_type)
            
            # Gera resumo automático
            try:
                PipelineService.generate_video_summary(video_id, "interview", project_id)
            except Exception as sum_err:
                print(f"[ASR] Aviso: Falha na geração do resumo: {sum_err}")

            # Atribuição incremental aos temas existentes (sem re-clusterizar tudo)
            try:
                from src.nlp.theme_engine import assign_media_to_themes
                assign_media_to_themes(project_id, video_id=video_id)
            except Exception as theme_err:
                print(f"[ASR] Aviso: Falha na atribuição incremental de temas: {theme_err}")

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
    def call_openrouter_vision(base64_image: str, extension: str = "jpeg", prompt: Optional[str] = None, project_id: Optional[int] = None) -> Dict[str, Any]:
        """Chama a API do OpenRouter Vision para analisar frames ou fotos.

        'prompt' permite injetar o prompt estruturado com entidades conhecidas do projeto
        (get_vision_prompt); sem ele, usa o prompt legado simples. {} em qualquer falha
        (principal + reserva esgotados, ou chave ausente) -- nunca um placeholder de
        texto fake: o chamador é quem decide não sobrescrever dado bom (ver
        analyze_photo_vision / analyze_video_vision).
        """
        mime_type = "image/jpeg" if extension in ["jpeg", "jpg"] else f"image/{extension}"
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt or VISION_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}
                    }
                ]
            }
        ]
        return PipelineService._call_vision_api(messages, project_id, "Vision")

    @staticmethod
    def _register_auto_mentions(
        conn,
        project_id: int,
        known_entities: List[Dict[str, str]],
        analysis: Dict[str, Any],
        video_id: Optional[int] = None,
        photo_id: Optional[int] = None,
        timestamp: Optional[float] = None
    ) -> None:
        """Cria menções automáticas (status='auto') quando a visão cita entidades já catalogadas.

        Só vincula matches exatos (case-insensitive) com o registro de entidades — nunca
        cria entidades novas a partir de palpites do modelo de visão.
        """
        try:
            cursor = conn.cursor()
            
            # Limpa menções anteriores do tipo 'vision_auto' para esta mídia específica
            if photo_id is not None:
                cursor.execute("DELETE FROM entity_mention WHERE photo_id = ? AND source = 'vision_auto'", (photo_id,))
            elif video_id is not None and timestamp is not None:
                cursor.execute("DELETE FROM entity_mention WHERE video_id = ? AND ABS(timestamp - ?) <= 0.1 AND source = 'vision_auto'", (video_id, timestamp))

            known_map = {e["name"].strip().lower(): e for e in (known_entities or [])}
            if not known_map:
                return

            cited = [str(p) for p in (analysis.get("pessoas") or [])] + \
                    [str(o) for o in (analysis.get("objetos") or [])]

            for raw_name in cited:
                key = raw_name.strip().lower()
                match = known_map.get(key)
                if not match:
                    continue
                entity_id = EntityRepository.upsert_entity(
                    conn, project_id, match["name"], match.get("entity_type", "other")
                )
                EntityRepository.add_mention(
                    conn, entity_id, project_id,
                    photo_id=photo_id, video_id=video_id, timestamp=timestamp,
                    source="vision_auto", status="auto"
                )
        except Exception as e:
            print(f"[Vision] Falha ao registrar menções automáticas: {e}")

    @staticmethod
    def _resolve_analysis_source(video_id: int, filepath: Path, duration: float) -> Path:
        """Fonte dos keyframes de análise.

        Padrão: o arquivo ORIGINAL em resolução plena (melhor detalhe para a descrição
        de visão e para o CLIP). Só cai para o proxy 720p se o original estiver ilegível
        — drive externo desconectado, arquivo movido/renomeado ou codec sem decoder —
        para a análise não zerar. (A segmentação continua no proxy por velocidade.)
        """
        proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
        if filepath.exists():
            # Existir não basta: confirma que o ffmpeg realmente decodifica um frame
            probe = CONFIG.CACHE_DIR / f"_probe_src_{video_id}.jpg"
            ok = extract_frame(filepath, max(0.0, min(1.0, duration / 2)), probe)
            try:
                probe.unlink()
            except Exception:
                pass
            if ok:
                return filepath
        if proxy_path.exists():
            print(f"[Vision] Original ilegível/ausente ({filepath.name}); usando proxy 720p do vídeo {video_id}.")
            return proxy_path
        return filepath

    @staticmethod
    def _subsample_uniform(jobs: List[Dict[str, Any]], max_frames: int) -> List[Dict[str, Any]]:
        """Teto de custo: no máximo `max_frames` keyframes, espalhados no tempo.

        Mantém as pontas (primeiro e último) e distribui o resto uniformemente.
        `max_frames <= 0` = sem teto.
        """
        if max_frames <= 0 or len(jobs) <= max_frames:
            return jobs
        idxs = sorted(set(np.linspace(0, len(jobs) - 1, max_frames).astype(int).tolist()))
        return [jobs[i] for i in idxs]

    @staticmethod
    def _cap_keeping_coverage(jobs: List[Dict[str, Any]], max_frames: int) -> List[Dict[str, Any]]:
        """Teto de custo priorizando COBERTURA: cada trecho distinto antes de fatia extra.

        Subamostrar uniforme por índice trata igual uma fatia redundante de um plano
        de 2 min e um corte distinto de 1s — e acaba apagando o corte enquanto mantém
        dez fatias quase iguais. O trecho apagado não é descrito nem indexado: vira
        material que a busca nunca encontra. Aqui o keyframe representante de cada
        segmento vem primeiro; as fatias extras disputam só o que sobra do orçamento.
        """
        if max_frames <= 0 or len(jobs) <= max_frames:
            return jobs
        representantes = [j for j in jobs if j.get("_representa_trecho")]
        extras = [j for j in jobs if not j.get("_representa_trecho")]

        if len(representantes) >= max_frames:
            # Nem 1 por trecho cabe no teto: aí não há escolha boa, só espalhar no tempo
            return PipelineService._subsample_uniform(representantes, max_frames)

        folga = max_frames - len(representantes)
        escolhidos = representantes + (PipelineService._subsample_uniform(extras, folga) if folga > 0 else [])
        escolhidos.sort(key=lambda j: j["timestamp"])
        return escolhidos

    @staticmethod
    def _plan_keyframes(segments: List[Dict[str, Any]], duration: float, interval: float,
                        min_gap: float, max_frames: int,
                        coverage_floor: bool = True) -> List[Dict[str, Any]]:
        """Escolhe os keyframes a analisar a partir dos segmentos (shots/beats).

        Resolve os dois extremos da segmentação bruta:
        - **Piso de cobertura:** segmento mais longo que `interval` é fatiado em vários
          keyframes de ~`interval` (um plano-sequência de 2 min não fica com 1 frame só).
          `coverage_floor=False` (perfis de esforço reduzido, E2.C1) desliga o piso:
          1 keyframe por segmento, no ponto médio.
        - **Teto de redundância:** keyframes a menos de `min_gap` do anterior são fundidos
          (cortes rápidos deixam de gerar frames quase idênticos).
        - **Teto de custo:** no máximo `max_frames`, subamostrados de forma uniforme.

        Cada keyframe carrega sua própria janela [start,end] para o player pular ao
        ponto exato ao clicar no resultado.
        """
        cap_ts = max(0.0, float(duration) - 0.5)
        raw: List[Dict[str, Any]] = []
        for seg in segments:
            s, e = float(seg["start"]), float(seg["end"])
            seg_dur = max(e - s, 0.0)
            # nº de fatias garantindo que nenhuma passe de `interval` (ceil com folga)
            n = max(1, int(np.ceil(seg_dur / interval - 1e-6))) if (interval > 0 and coverage_floor) else 1
            for i in range(n):
                w_start = s + seg_dur * i / n
                w_end = s + seg_dur * (i + 1) / n
                t = (w_start + w_end) / 2.0
                raw.append({"timestamp": min(t, cap_ts), "start": w_start, "end": w_end,
                            "segment_id": seg.get("id"),
                            "motion_label": seg.get("motion_label"),
                            # A fatia central representa o trecho: é a última a ser
                            # cortada pelo teto, para nenhum shot/beat sumir da busca.
                            "_representa_trecho": (i == n // 2)})

        raw.sort(key=lambda j: j["timestamp"])

        # Funde keyframes próximos demais (mantém o primeiro e estende sua janela)
        kept: List[Dict[str, Any]] = []
        for j in raw:
            if kept and (j["timestamp"] - kept[-1]["timestamp"]) < min_gap:
                kept[-1]["end"] = max(kept[-1]["end"], j["end"])
                # O sobrevivente herda a representação: sua janela agora cobre os dois
                # trechos, então ele não pode ser tratado como fatia descartável.
                kept[-1]["_representa_trecho"] = kept[-1]["_representa_trecho"] or j["_representa_trecho"]
                continue
            kept.append(j)

        # Teto de custo: corta redundância antes de cobertura
        return PipelineService._cap_keeping_coverage(kept, max_frames)

    @staticmethod
    def analyze_video_vision(video_id: int, filepath: Path, duration: float, beat_embedder: Optional[str] = None) -> bool:
        """Decupa frames-chave do vídeo B-roll enviando para LLM multimodal e Qdrant.

        `beat_embedder` ('hsv'|'clip') permite forçar o método de deriva dos beats
        nesta execução (reanálise sob demanda); None usa o setting do projeto.
        """
        with get_db() as conn:
            video = MediaRepository.get_video(conn, video_id)
            if not video:
                return False
            project_id = video['project_id']
            category = video.get('category')
            MediaRepository.update_video_status(conn, video_id, 'analyzing')
        TASK_MANAGER.update_progress(str(video_id), 0.0, "running", task_type="vision")

        # Fonte dos keyframes de análise: original em resolução plena por padrão;
        # cai para o proxy 720p só se o original estiver ilegível (offline, movido…)
        frame_source = PipelineService._resolve_analysis_source(video_id, filepath, duration)

        # Triagem antes da varredura: categoria (Eixo A) + título curto + video_type por conteúdo
        if not category:
            triage = PipelineService.triage_video(video_id, frame_source, duration, project_id)
            category = triage.get("categoria") or None

        # Reanálise limpa: remove vetores antigos deste vídeo (texto + imagem) para
        # não deixar frames órfãos quando a nova segmentação muda os keyframes
        try:
            SemanticSearch.get_instance().delete_video_broll_points(project_id, video_id)
            if SettingsService.get_settings(project_id).get("clip.enabled"):
                from src.search.image_semantic import ImageSearch
                ImageSearch.get_instance().delete_video_images(project_id, video_id)
        except Exception as clean_err:
            print(f"[Vision] Falha ao limpar índice antigo do vídeo {video_id}: {clean_err}")

        video_cache_dir = CONFIG.CACHE_DIR / f"vid_{video_id}"
        video_cache_dir.mkdir(exist_ok=True)

        descriptions_indexed = []
        S = SettingsService.get_settings(project_id)
        interval = S.get("vision.frame_interval")
        # Teto de custo (segurança): a cadência de cobertura é ~1 frame/interval; a folga
        # absorve os frames extras alinhados às fronteiras dos shots sem cortar a cobertura.
        max_frames = max(4, int(np.ceil(duration / interval)) + 8) if interval > 0 else 8

        # Perfil de esforço (E2.C1): a categoria da triagem decide quanta análise cara
        # este material merece. Sem categoria, o perfil é o completo (comportamento antigo).
        profile = get_profile(category, S.get("analysis.effort_overrides"))
        if profile.max_keyframes is not None:
            max_frames = min(max_frames, profile.max_keyframes)
        print(f"[Vision] Video {video_id}: categoria='{category or 'sem categoria'}' "
              f"-> esforco '{profile.effort}' ({profile.label})")

        # Cada job de frame carrega a janela real do trecho (para o payload do Qdrant)
        frame_jobs: List[Dict[str, Any]] = []
        seg_log = ""
        if S.get("vision.use_segments"):
            try:
                from src.vision.segmentation import segment_video
                # Segmentação é decode pesado e independe de resolução: roda no proxy
                # 720p (rápido) quando existir, senão na fonte dos keyframes.
                proxy_path = CONFIG.PROXIES_DIR / f"proxy_vid_{video_id}.mp4"
                seg_source = proxy_path if proxy_path.exists() else frame_source
                # Método de deriva dos beats: HSV (rápido, default) ou CLIP (preciso, lento).
                # O override tem prioridade sobre o setting (usado na reanálise sob demanda).
                chosen_embedder = beat_embedder or S.get("segment.beat_embedder")
                embed_fn = None
                if chosen_embedder == "clip":
                    try:
                        from src.search.image_semantic import ImageSearch
                        embed_fn = ImageSearch.get_instance().embed_frame_bgr
                    except Exception as clip_err:
                        print(f"[Vision] CLIP indisponível para beats (usando HSV): {clip_err}")
                segments = segment_video(
                    seg_source, duration,
                    detect_threshold=S.get("segment.detect_threshold"),
                    min_beat_shot_s=S.get("segment.min_beat_shot_s"),
                    sample_interval_s=S.get("segment.beat_sample_interval_s"),
                    drift_threshold=S.get("segment.beat_drift_threshold"),
                    motion_enabled=S.get("segment.motion_enabled"),
                    embed_fn=embed_fn,
                    detect_beats_enabled=profile.detect_beats,
                )
                if segments:
                    with get_db() as conn:
                        MediaRepository.replace_video_segments(conn, project_id, video_id, segments)
                        conn.commit()
                    min_gap = S.get("segment.min_keyframe_gap_s")
                    frame_jobs = PipelineService._plan_keyframes(
                        segments, duration, interval, min_gap, max_frames,
                        coverage_floor=profile.coverage_floor,
                    )
                    cobertura = f"cobertura <={interval}s, " if profile.coverage_floor else "1 keyframe/segmento, "
                    seg_log = (f"[Vision] Vídeo {video_id}: {len(segments)} segmentos -> {len(frame_jobs)} keyframes "
                               f"({cobertura}min {min_gap}s, esforco '{profile.effort}', "
                               f"baseline {max(1, int(duration / interval) + 1)})")
            except Exception as seg_err:
                print(f"[Vision] Falha na segmentação do vídeo {video_id}, usando relógio fixo: {seg_err}")
                frame_jobs = []

            # Fora do try: um erro ao logar não pode descartar os keyframes e
            # rebaixar a análise para o relógio fixo (era o que acontecia).
            if seg_log:
                print(seg_log)

        if not frame_jobs:
            # Fallback: relógio fixo legado (frame a cada N segundos)
            t = 0.0
            while t < duration:
                frame_jobs.append({"timestamp": t, "start": t, "end": min(t + interval, duration)})
                t += interval
            # O teto do perfil vale também aqui: sem isto, uma falha de segmentação
            # devolveria um vídeo 'cotidiano' ao custo cheio sem ninguém perceber
            # (mesma classe de degradação silenciosa do bug do E2.A5).
            if profile.max_keyframes is not None and len(frame_jobs) > profile.max_keyframes:
                frame_jobs = PipelineService._subsample_uniform(frame_jobs, profile.max_keyframes)
                print(f"[Vision] Video {video_id}: relogio fixo limitado a {len(frame_jobs)} keyframes "
                      f"pelo esforco '{profile.effort}'")

        # Entidades já catalogadas no projeto — o modelo de visão nomeia direto na análise
        known_entities = []
        try:
            with get_db() as conn:
                known_entities = EntityRepository.get_known_names(conn, project_id)
        except Exception as ent_err:
            print(f"[Vision] Falha ao carregar entidades conhecidas: {ent_err}")

        try:
            total_stamps = len(frame_jobs)
            frames_ok = 0
            for idx, job in enumerate(frame_jobs):
                if TASK_MANAGER.is_cancelled(str(video_id)):
                    print(f"[Vision] Análise do vídeo {video_id} foi cancelada pelo usuário. Encerrando thread.")
                    with get_db() as conn:
                        MediaRepository.update_video_status(conn, video_id, 'ingested')
                    return False
                timestamp = job["timestamp"]
                percent = (idx / total_stamps) * 100.0
                TASK_MANAGER.update_progress(str(video_id), percent, "running", task_type="vision")
                frame_path = video_cache_dir / f"frame_{idx}_{int(timestamp)}s.jpg"
                if not extract_frame(frame_source, timestamp, frame_path, proxy_fallback_path=proxy_path):
                    continue
                frames_ok += 1

                # Roda reconhecimento facial do frame
                try:
                    process_video_frame_faces(project_id, video_id, timestamp, frame_path)
                except Exception as fe:
                    print(f"[Vision] Falha facial no frame {timestamp}s: {fe}")

                # Pessoas confirmadas por rosto neste frame
                detected_people = []
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            SELECT name, bounding_box FROM face
                            WHERE video_id = ? AND ABS(timestamp - ?) <= 0.5
                              AND name IS NOT NULL AND name != ''
                              AND name NOT IN ('Não Relevante', 'Não é Rosto')
                        """, (video_id, timestamp))
                        for r in cursor.fetchall():
                            try:
                                bbox = json.loads(r["bounding_box"]) if r["bounding_box"] else None
                            except Exception:
                                bbox = None
                            detected_people.append({"name": r["name"], "bbox": bbox})
                except Exception as e:
                    print(f"[Vision] Falha ao recuperar faces para o vídeo: {e}")

                # Base64 encoding
                import base64
                with open(frame_path, "rb") as img_file:
                    base64_img = base64.b64encode(img_file.read()).decode('utf-8')

                vision_prompt = get_vision_prompt(known_entities, detected_people, project_id=project_id, category=category)
                analysis = PipelineService.call_openrouter_vision(base64_img, "jpg", prompt=vision_prompt, project_id=project_id)
                if not analysis:
                    # Chamada falhou -- pula este keyframe em vez de indexar uma
                    # descricao vazia (um "buraco" silencioso na busca e menos
                    # ruim que texto de erro poluindo o indice).
                    print(f"[Vision] Falha no keyframe {timestamp:.1f}s do vídeo {video_id}: pulando.")
                    try:
                        frame_path.unlink()
                    except Exception:
                        pass
                    continue
                frame_tags = PipelineService.clean_tags(analysis.get("tags", []))
                descriptions_indexed.append({
                    "timestamp": timestamp,
                    "start_time": job["start"],
                    "end_time": job["end"],
                    "description": analysis.get("descricao", ""),
                    "tags": frame_tags,
                    "people": analysis.get("pessoas", []) or [],
                    "objects": analysis.get("objetos", []) or []
                })

                # Registra no grafo relacional + menções automáticas de entidades reconhecidas
                with get_db() as conn:
                    for tag in frame_tags:
                        NarrativeRepository.add_relation(
                            conn, project_id, "video", str(video_id),
                            "features_element", "theme", tag
                        )
                    PipelineService._register_auto_mentions(
                        conn, project_id, known_entities, analysis,
                        video_id=video_id, timestamp=timestamp
                    )

                # Indexação visual CLIP do keyframe (local, sem custo de API) — reusa
                # o frame já extraído, antes de apagá-lo
                if S.get("clip.enabled"):
                    try:
                        from src.search.image_semantic import ImageSearch
                        from src.vision.shot_scale import SHOT_SCALE_LABELS
                        scale_label = ImageSearch.get_instance().index_video_keyframe(
                            project_id, video_id, frame_path,
                            start_time=job["start"], end_time=job["end"],
                            segment_id=job.get("segment_id"),
                            category=category,
                            camera_motion=job.get("motion_label"),
                        )
                        # Faceta de escala de plano (E2.D1) persiste no segmento
                        if scale_label in SHOT_SCALE_LABELS and job.get("segment_id"):
                            with get_db() as conn:
                                conn.execute(
                                    "UPDATE media_segment SET shot_scale = ? WHERE id = ?",
                                    (scale_label, job["segment_id"])
                                )
                                conn.commit()
                    except Exception as clip_err:
                        print(f"[Vision] Falha na indexação CLIP do frame {timestamp:.1f}s: {clip_err}")

                try:
                    frame_path.unlink()
                except Exception:
                    pass

            total_jobs = len(frame_jobs)
            successful_frames = len(descriptions_indexed)
            failed_frames = total_jobs - successful_frames
            failure_ratio = (failed_frames / total_jobs) if total_jobs > 0 else 1.0

            if successful_frames == 0 or failure_ratio > 0.20:
                # Mais de 20% dos frames falharam ou nenhum frame processado — sinaliza erro explícito
                err_msg = f"Falha na análise visual: {failed_frames} de {total_jobs} quadros falharam (taxa de erro > 20%)."
                print(f"[Vision] Vídeo {video_id}: {err_msg}")
                with get_db() as conn:
                    MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
                TASK_MANAGER.update_progress(str(video_id), 0.0, "failed", task_type="vision")
                return False

            if descriptions_indexed:
                try:
                    search_engine = SemanticSearch.get_instance()
                    search_engine.index_broll_descriptions(project_id, video_id, descriptions_indexed)
                except Exception as qdrant_err:
                    print(f"[Vision] Falha na indexação vetorial Qdrant do vídeo {video_id}: {qdrant_err}")

                try:
                    PipelineService.generate_video_summary(video_id, "broll", project_id, descriptions_indexed)
                except Exception as sum_err:
                    print(f"[Vision] Falha ao resumir B-roll: {sum_err}")

                # Enriquecimento pós-análise: aplica nomes confirmados anteriormente
                try:
                    from src.nlp.enrichment_engine import enrich_video_frames
                    enrich_video_frames(project_id, video_id)
                except Exception as enrich_err:
                    print(f"[Vision] Falha no enriquecimento pós-análise: {enrich_err}")

                # Atribuição incremental de temas existentes ao novo material
                try:
                    from src.nlp.theme_engine import assign_media_to_themes
                    assign_media_to_themes(project_id, video_id=video_id)
                except Exception as theme_err:
                    print(f"[Vision] Falha na atribuição incremental de temas: {theme_err}")

            with get_db() as conn:
                warn_msg = f"Aviso: {failed_frames} de {total_jobs} quadros falharam na análise visual." if failed_frames > 0 else None
                MediaRepository.update_video_status(conn, video_id, 'analyzed', error_message=warn_msg)
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

            known_entities = []
            detected_people = []
            with get_db() as conn:
                try:
                    known_entities = EntityRepository.get_known_names(conn, project_id)
                except Exception:
                    pass
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT name, bounding_box FROM face
                    WHERE photo_id = ? AND name IS NOT NULL AND name != ''
                      AND name NOT IN ('Não Relevante', 'Não é Rosto')
                """, (photo_id,))
                for r in cursor.fetchall():
                    try:
                        bbox = json.loads(r["bounding_box"]) if r["bounding_box"] else None
                    except Exception:
                        bbox = None
                    detected_people.append({"name": r["name"], "bbox": bbox})

            from src.nlp.prompt_templates import get_photo_vision_prompt
            vision_prompt = get_photo_vision_prompt(known_entities, detected_people, project_id=project_id)
            analysis = PipelineService.call_openrouter_vision(base64_img, ext, prompt=vision_prompt, project_id=project_id)
            if not analysis:
                # Chamada falhou (ver call_openrouter_vision) -- NAO sobrescreve a
                # descricao/tags que ja existiam. Devolve status a 'error' para a
                # foto ser retentada, mas sem apagar analise boa anterior.
                print(f"[Vision] Falha na análise da foto {photo_id}: mantendo dados anteriores.")
                with get_db() as conn:
                    MediaRepository.update_photo_status(conn, photo_id, 'error')
                TASK_MANAGER.update_progress(f"photo-{photo_id}", 0.0, "failed", task_type="vision")
                return False
            desc = analysis.get("descricao", "Foto analisada.")
            tags = PipelineService.clean_tags(analysis.get("tags", []))

            # Triagem embutida na mesma chamada: categoria + título
            category = str(analysis.get("categoria", "") or "").strip().lower()
            if category not in TRIAGE_CATEGORIES:
                category = None
            try:
                cat_conf = float(analysis.get("confianca", 0.0))
            except Exception:
                cat_conf = 0.0
            title = str(analysis.get("titulo", "") or "").strip()

            with get_db() as conn:
                MediaRepository.update_photo_analysis(conn, photo_id, desc, tags)
                # Preserva o texto bruto da visão como fonte para reescritas futuras.
                # burst_group_id volta a NULL: esta foto passou a ter análise própria
                # (a líder de rajada é remarcada logo depois, ao replicar para o grupo).
                conn.execute("UPDATE photo SET raw_description = ?, burst_group_id = NULL WHERE id = ?", (desc, photo_id))
                if category:
                    conn.execute(
                        "UPDATE photo SET category = ?, category_confidence = ?, title = COALESCE(NULLIF(?, ''), title) WHERE id = ?",
                        (category, cat_conf, title, photo_id)
                    )
                elif title:
                    conn.execute("UPDATE photo SET title = ? WHERE id = ?", (title, photo_id))

                for tag in tags:
                    NarrativeRepository.add_relation(
                        conn, project_id, "photo", str(photo_id),
                        "features_element", "theme", tag
                    )
                PipelineService._register_auto_mentions(
                    conn, project_id, known_entities, analysis, photo_id=photo_id
                )

            search_engine = SemanticSearch.get_instance()
            search_engine.index_photo_description(project_id, photo_id, desc, tags)

            # Paleta e temperatura de cor (E2.D2) — local; falha nunca bloqueia a análise
            palette_temp = None
            try:
                from src.vision.palette import classify_palette_file
                palette = classify_palette_file(target_path)
                if palette:
                    palette_temp = palette["palette_temp"]
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE photo SET palette_temp = ?, palette_hex = ? WHERE id = ?",
                            (palette_temp, json.dumps(palette["palette_hex"]), photo_id)
                        )
                        conn.commit()
            except Exception as pal_err:
                print(f"[Vision] Falha na paleta da foto {photo_id}: {pal_err}")

            # Indexação visual CLIP da foto (local, sem custo de API)
            if SettingsService.get_settings(project_id).get("clip.enabled"):
                try:
                    from src.search.image_semantic import ImageSearch
                    ImageSearch.get_instance().index_photo(project_id, photo_id, target_path,
                                                           category=category, palette_temp=palette_temp)
                except Exception as clip_err:
                    print(f"[Vision] Falha na indexação CLIP da foto {photo_id}: {clip_err}")

            # Enriquecimento imediato se já houver entidades confirmadas nesta foto
            try:
                from src.nlp.enrichment_engine import enrich_photo
                enrich_photo(project_id, photo_id)
            except Exception as enrich_err:
                print(f"[Vision] Falha no enriquecimento da foto {photo_id}: {enrich_err}")

            try:
                from src.nlp.theme_engine import assign_media_to_themes
                assign_media_to_themes(project_id, photo_id=photo_id)
            except Exception as theme_err:
                print(f"[Vision] Falha na atribuição de temas da foto {photo_id}: {theme_err}")

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
        """Agrupamento temático híbrido: embeddings locais + nomeação por LLM (v2).

        Cai para o clustering legado (LLM único com texto truncado) apenas se o v2 falhar.
        """
        try:
            from src.nlp.theme_engine import run_theme_clustering_v2
            return run_theme_clustering_v2(project_id)
        except Exception as e:
            print(f"[Clustering] Falha no clustering v2 ({e}), usando fallback legado...")
            return PipelineService._run_legacy_theme_clustering(project_id)

    @staticmethod
    def _run_legacy_theme_clustering(project_id: int) -> Dict[str, Any]:
        """Clustering legado: uma única chamada de LLM com a transcrição truncada em 30k chars."""
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
                msg = res_json.get('choices', [{}])[0].get('message', {})
                raw_content = msg.get('content')
                if not isinstance(raw_content, str) or not raw_content.strip():
                    return {"themes": []}
                data = extract_json_from_markdown(raw_content.strip())
                
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
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return False

        max_chars = S.get("summary.transcript_max_chars")

        # Categoria de triagem (quando existir) contextualiza o sumário
        category = None
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT category FROM video WHERE id = ?", (video_id,))
            row = cursor.fetchone()
            if row:
                category = row["category"]

        if video_type == "interview":
            with get_db() as conn:
                dialogues = NarrativeRepository.get_transcript_dialogues(conn, video_id)

            if not dialogues:
                return False

            formatted = ""
            for block in dialogues:
                formatted += f"[{block['speaker_id']} | {block['start_time']:.1f}s - {block['end_time']:.1f}s]: \"{block['text']}\"\n\n"
            prompt = get_interview_summary_prompt(formatted[:max_chars])
        elif video_type == "broll" and visual_descriptions:
            formatted = ""
            for frame in visual_descriptions:
                formatted += f"[Tempo: {frame['timestamp']:.1f}s]: {frame['description']} (Tags visuais: {', '.join(frame['tags'])})\n"
            prompt = get_broll_summary_prompt(formatted[:max_chars], project_id=project_id, category=category)
        else:
            return False
            
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": S.get("llm.text_model"),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": S.get("summary.temperature")
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=S.get("summary.timeout"))
            if response.status_code == 200:
                res_json = response.json()
                msg = res_json.get('choices', [{}])[0].get('message', {})
                raw_content = msg.get('content')
                if not isinstance(raw_content, str) or not raw_content.strip():
                    return False
                data = extract_json_from_markdown(raw_content.strip())

                desc = data.get("description", "")
                if isinstance(desc, list):
                    desc = " ".join([str(x) for x in desc])
                
                summary = data.get("summary", "")
                if isinstance(summary, list):
                    summary = "\n".join([f"- {x}" for x in summary])

                title = str(data.get("titulo", "") or "").strip()
                tags = PipelineService.clean_tags(data.get("tags", []))

                from src.nlp.name_fixer import carregar_regras, corrigir_decupagem, resumir_trocas

                with get_db() as conn:
                    # Corrige nome proprio ANTES de gravar: o ASR erra ("Baiar" por
                    # Bayard) e o resumo herda o erro. Corrigir depois nao resolve --
                    # o erro volta no proximo reprocessamento. As regras saem dos
                    # aliases de entity/person; ver src/nlp/name_fixer.py.
                    regras = carregar_regras(project_id, conn)
                    title, desc, summary, tags, trocas = corrigir_decupagem(
                        title, desc, summary, tags, regras
                    )
                    if trocas:
                        print(f"[Nomes] Video {video_id}: {resumir_trocas(trocas)}")

                    MediaRepository.update_video_metadata(conn, video_id, desc, summary, tags, title=title)

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

    @staticmethod
    def get_failed_video_ids(project_id: Optional[int] = None) -> List[int]:
        """Retorna IDs de todos os vídeos que falharam ou apresentam erro visual no sumário/descrição."""
        with get_db() as conn:
            cursor = conn.cursor()
            base_query = """
                SELECT id FROM video 
                WHERE (status = 'error' 
                   OR LOWER(summary) LIKE '%análise visual falhou%'
                   OR LOWER(summary) LIKE '%análise falhou%'
                   OR LOWER(summary) LIKE '%sistema de análise%falhou%'
                   OR LOWER(summary) LIKE '%chroma%'
                   OR LOWER(summary) LIKE '%croma%'
                   OR LOWER(summary) LIKE '%tela verde%'
                   OR LOWER(summary) LIKE '%artefato%'
                   OR LOWER(summary) LIKE '%distorção%'
                   OR LOWER(summary) LIKE '%distorcao%'
                   OR LOWER(summary) LIKE '%corrompido%'
                   OR LOWER(description) LIKE '%análise visual falhou%'
                   OR LOWER(description) LIKE '%análise falhou%'
                   OR LOWER(description) LIKE '%sistema de análise%falhou%'
                   OR LOWER(description) LIKE '%chroma%'
                   OR LOWER(description) LIKE '%croma%'
                   OR LOWER(description) LIKE '%tela verde%'
                   OR LOWER(description) LIKE '%artefato%'
                   OR LOWER(description) LIKE '%distorção%'
                   OR LOWER(description) LIKE '%distorcao%'
                   OR LOWER(description) LIKE '%corrompido%'
                   OR LOWER(title) LIKE '%falha visual%')
                  AND status NOT IN ('analyzing', 'processing', 'transcribing', 'pending')
            """
            if project_id:
                proj_rows = cursor.execute(base_query + " AND project_id = ?", (project_id,)).fetchall()
                if proj_rows:
                    return [r['id'] for r in proj_rows]
            
            # Se não passou project_id ou se o project_id atual não tem falhas isoladas, busca no acervo total
            all_rows = cursor.execute(base_query).fetchall()
            return [r['id'] for r in all_rows]

    @staticmethod
    def reanalyze_failed_videos(project_id: Optional[int] = None, media_ids: Optional[List[int]] = None) -> List[int]:
        """Dispara reanálise em lote das mídias afetadas por falha visual (ou apenas as selecionadas em media_ids)."""
        import threading
        from src.core.tasks import TASK_MANAGER
        if media_ids:
            affected_ids = list(media_ids)
        else:
            affected_ids = PipelineService.get_failed_video_ids(project_id)

        print(f"[Vision] Iniciando reanálise em lote de {len(affected_ids)} vídeos afetados...")
        
        with get_db() as conn:
            cursor = conn.cursor()
            for vid in affected_ids:
                row = cursor.execute("SELECT id, filepath, duration FROM video WHERE id = ?", (vid,)).fetchone()
                if not row:
                    continue
                v_path = Path(row["filepath"]) if row["filepath"] else Path(f"data/proxies/proxy_vid_{vid}.mp4")
                v_dur = float(row["duration"] or 0.0)
                
                MediaRepository.update_video_status(conn, vid, 'pending', error_message=None)
                TASK_MANAGER.update_progress(str(vid), 0.0, "running", task_type="vision")
                
                t = threading.Thread(
                    target=PipelineService.analyze_video_vision,
                    args=(vid, v_path, v_dur),
                    daemon=True
                )
                t.start()
                
        return affected_ids

    @staticmethod
    def regenerate_executive_titles(project_id: int = 1, video_ids: Optional[List[int]] = None) -> List[Dict[str, Any]]:
        """Gera ou regenera títulos executivos (3 a 6 palavras) para vídeos existentes em micro-lotes (chunks de 20)."""
        import json
        from src.services.settings_service import SettingsService
        import requests
        from src.nlp.json_parser import extract_json_from_markdown
        from src.core.tasks import TASK_MANAGER

        task_key = f"titles_proj_{project_id}"

        settings = SettingsService.get_settings(project_id)
        api_key = settings.api_key("openrouter")
        text_model = settings.get("llm.text_model")

        if not api_key or api_key == "your_openrouter_api_key_here":
            TASK_MANAGER.update_progress(task_key, 0.0, "failed", task_type="titles",
                                         label="Geração de Títulos (Sem Chave API)",
                                         log_message="[ERROR] Chave do OpenRouter não configurada.")
            return []

        with get_db() as conn:
            cursor = conn.cursor()
            if video_ids:
                placeholders = ",".join("?" * len(video_ids))
                query = f"SELECT id, filename, title, description, summary, video_type, category FROM video WHERE id IN ({placeholders}) AND project_id = ?"
                rows = cursor.execute(query, (*video_ids, project_id)).fetchall()
            else:
                query = "SELECT id, filename, title, description, summary, video_type, category FROM video WHERE project_id = ?"
                rows = cursor.execute(query, (project_id,)).fetchall()

            videos = [dict(r) for r in rows]

        total = len(videos)
        if total == 0:
            TASK_MANAGER.update_progress(task_key, 100.0, "finished", task_type="titles",
                                         label="Nenhum vídeo pendente",
                                         log_message="[FINISHED] Nenhum vídeo para processar no projeto.")
            return []

        TASK_MANAGER.update_progress(
            task_key, 0.0, "running", task_type="titles",
            label=f"Geração de Títulos IA ({total} vídeos)",
            log_message=f"[INIT] Iniciando geração em micro-lotes (20 por lote) para {total} vídeos..."
        )

        updated = []
        chunk_size = 20
        processed_count = 0

        for chunk_idx in range(0, total, chunk_size):
            if TASK_MANAGER.is_cancelled(task_key):
                TASK_MANAGER.update_progress(
                    task_key, (processed_count / total) * 100.0, "cancelled", task_type="titles",
                    label="Geração de Títulos Cancelada",
                    log_message=f"[CANCEL] Geração cancelada pelo usuário após processar {processed_count} vídeos."
                )
                break

            chunk = videos[chunk_idx:chunk_idx + chunk_size]
            items_payload = []

            for v in chunk:
                vid = v["id"]
                v_filename = v.get("filename", "") or f"Vídeo #{vid}"
                v_type = v.get("video_type", "broll")
                v_desc = v.get("description", "") or ""
                v_sum = v.get("summary", "") or ""
                v_cat = v.get("category", "") or ""

                content_preview = ""
                with get_db() as conn:
                    if v_type == "interview":
                        from src.db.operations import get_video_transcript
                        dialogues = get_video_transcript(vid)
                        if dialogues:
                            content_preview = " ".join([d.get("text", "") for d in dialogues[:4]])
                    else:
                        frames = MediaRepository.get_keyframes_with_vectors(conn, vid) if hasattr(MediaRepository, 'get_keyframes_with_vectors') else []
                        if frames:
                            content_preview = " | ".join([f.get("description", "") for f in frames[:4] if f.get("description")])

                if not content_preview:
                    content_preview = f"{v_sum} {v_desc}".strip()

                items_payload.append({
                    "id": vid,
                    "arquivo": v_filename,
                    "tipo": v_type,
                    "categoria": v_cat,
                    "contexto": content_preview[:400]
                })

            prompt = f"""Você é um editor sênior de cinema e vídeo.
Para cada clipe de vídeo da lista abaixo, gere um TÍTULO EXECUTIVO cinematográfico curto de 3 a 6 palavras.
Este título servirá de nome para o clipe na ilha de edição e na timeline.

REGRAS RÍGIDAS:
1. Cada título DEVE ter estritamente entre 3 e 6 palavras.
2. Seja direto, cinematográfico e específico sobre a AÇÃO ou CONVERSA CENTRAL (Exemplos: 'Ensaio do monólogo no camarim', 'Montagem da luz no galpão', 'Zé: Crítica ao primeiro corte', 'Detalhe das mãos no vinil').
3. PROIBIDO usar introduções genéricas como 'Este clipe mostra', 'Vídeo de', 'Sequência útil', 'Registro', 'Mostrando', etc.
4. Retorne OBRIGATORIAMENTE um array JSON contendo o objeto de cada clipe com as chaves 'id' e 'titulo'.

LISTA DE CLIPES A NOMEAR:
{json.dumps(items_payload, ensure_ascii=False, indent=2)}

Responda em formato JSON puro:
[
  {{"id": 123, "titulo": "Título Executivo"}},
  ...
]
"""
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": text_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2
            }

            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=40)
                if resp.status_code == 200:
                    res_data = resp.json()
                    msg = res_data.get('choices', [{}])[0].get('message', {})
                    raw_content = msg.get('content', '').strip()
                    data = extract_json_from_markdown(raw_content)
                    
                    if isinstance(data, list):
                        with get_db() as conn:
                            for item in data:
                                if isinstance(item, dict) and "id" in item:
                                    item_id = int(item["id"])
                                    new_title = str(item.get("titulo", "") or item.get("title", "") or "").strip()
                                    if new_title:
                                        MediaRepository.update_video_title(conn, item_id, new_title, origem="ia")
                                        updated.append({"id": item_id, "title": new_title})
                                        v_match = next((x for x in chunk if x["id"] == item_id), None)
                                        f_name = v_match.get("filename", f"Vídeo #{item_id}") if v_match else f"Vídeo #{item_id}"
                                        TASK_MANAGER.add_log(task_key, f"[SUCCESS] '{f_name}' -> '{new_title}'", "INFO")
                            conn.commit()
                    elif isinstance(data, dict):
                        arr = data.get("titulos") or data.get("titles") or [data]
                        if isinstance(arr, list):
                            with get_db() as conn:
                                for item in arr:
                                    if isinstance(item, dict) and "id" in item:
                                        item_id = int(item["id"])
                                        new_title = str(item.get("titulo", "") or item.get("title", "") or "").strip()
                                        if new_title:
                                            MediaRepository.update_video_title(conn, item_id, new_title, origem="ia")
                                            updated.append({"id": item_id, "title": new_title})
                                            TASK_MANAGER.add_log(task_key, f"[SUCCESS] ID {item_id} -> '{new_title}'", "INFO")
                                conn.commit()
            except Exception as e:
                TASK_MANAGER.add_log(task_key, f"[ERROR] Falha no micro-lote ({chunk_idx+1}-{chunk_idx+len(chunk)}): {e}", "WARN")

            processed_count += len(chunk)
            pct_done = min(100.0, (processed_count / total) * 100.0)
            TASK_MANAGER.update_progress(
                task_key, pct_done, "running", task_type="titles",
                label=f"Geração de Títulos IA ({processed_count}/{total})",
                log_message=f"[LLM] Micro-lote concluído ({processed_count}/{total} clipes processados)."
            )

        if not TASK_MANAGER.is_cancelled(task_key):
            TASK_MANAGER.update_progress(
                task_key, 100.0, "finished", task_type="titles",
                label="Geração de Títulos Concluída",
                log_message=f"[FINISHED] Processo finalizado! {len(updated)} de {total} títulos executivos gerados com sucesso."
            )

        return updated
