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
    def call_openrouter_vision_multi(base64_images: List[str], prompt: str, project_id: Optional[int] = None) -> Dict[str, Any]:
        """Chama a API de visão com MÚLTIPLAS imagens em uma única requisição (triagem)."""
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {}

        content = [{"type": "text", "text": prompt}]
        for b64 in base64_images:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
            })

        payload = {
            "model": S.get("llm.vision_model"),
            "messages": [{"role": "user", "content": content}],
            "temperature": S.get("vision.temperature"),
            "max_tokens": S.get("vision.max_tokens")
        }
        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=max(S.get("vision.timeout"), 40)
            )
            if response.status_code == 200:
                res_json = response.json()
                return extract_json_from_markdown(res_json['choices'][0]['message']['content'].strip())
            print(f"[Triage] Falha na API de visão (status {response.status_code}): {response.text[:200]}")
            return {}
        except Exception as e:
            print(f"[Triage] Erro ao chamar visão multi-imagem: {e}")
            return {}

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
        (get_vision_prompt); sem ele, usa o prompt legado simples.
        """
        S = SettingsService.get_settings(project_id)
        api_key = S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {"descricao": "Análise indisponível", "tags": []}

        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        mime_type = "image/jpeg" if extension in ["jpeg", "jpg"] else f"image/{extension}"

        payload = {
            "model": S.get("llm.vision_model"),
            "messages": [
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
            ],
            "temperature": S.get("vision.temperature"),
            "max_tokens": S.get("vision.max_tokens")
        }

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=S.get("vision.timeout"))
            if response.status_code == 200:
                res_json = response.json()
                content = res_json['choices'][0]['message']['content'].strip()
                return extract_json_from_markdown(content)
            else:
                # 402 = credito insuficiente para o teto de tokens pedido, nao
                # necessariamente saldo zerado (ver vision.max_tokens). Logar o
                # status evita reincidir no mesmo diagnostico errado de novo.
                print(f"[Vision] Falha na API de visão (status {response.status_code}): {response.text[:300]}")
                # {} (nao um "descricao": "Analise falhou" fake) -- achado em 17/07:
                # esse placeholder era gravado por cima de descricoes BOAS ja existentes
                # (172 fotos perderam a analise real da Etapa 1 assim). Um dict vazio
                # deixa o chamador decidir nao escrever nada em cima do que ja existia.
                return {}
        except Exception as e:
            print(f"[Vision] Erro ao chamar OpenRouter: {e}")
            return {"descricao": "Análise indisponível por erro de requisição", "tags": []}

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
                timestamp = job["timestamp"]
                percent = (idx / total_stamps) * 100.0
                TASK_MANAGER.update_progress(str(video_id), percent, "running", task_type="vision")
                frame_path = video_cache_dir / f"frame_{idx}_{int(timestamp)}s.jpg"
                if not extract_frame(frame_source, timestamp, frame_path):
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
                        ImageSearch.get_instance().index_video_keyframe(
                            project_id, video_id, frame_path,
                            start_time=job["start"], end_time=job["end"],
                            segment_id=job.get("segment_id")
                        )
                    except Exception as clip_err:
                        print(f"[Vision] Falha na indexação CLIP do frame {timestamp:.1f}s: {clip_err}")

                try:
                    frame_path.unlink()
                except Exception:
                    pass

            if frames_ok == 0:
                # Nenhum frame extraído (proxy e original ilegíveis) — não marca como
                # 'analyzed' silenciosamente; sinaliza erro para o usuário reprocessar
                err_msg = f"Nenhum frame pôde ser extraído de {frame_source.name} (proxy/original ilegíveis)."
                print(f"[Vision] {err_msg}")
                with get_db() as conn:
                    MediaRepository.update_video_status(conn, video_id, 'error', error_message=err_msg)
                TASK_MANAGER.update_progress(str(video_id), 0.0, "failed", task_type="vision")
                return False

            if descriptions_indexed:
                search_engine = SemanticSearch.get_instance()
                search_engine.index_broll_descriptions(project_id, video_id, descriptions_indexed)

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

            # Indexação visual CLIP da foto (local, sem custo de API)
            if SettingsService.get_settings(project_id).get("clip.enabled"):
                try:
                    from src.search.image_semantic import ImageSearch
                    ImageSearch.get_instance().index_photo(project_id, photo_id, target_path)
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
                content = res_json['choices'][0]['message']['content'].strip()
                data = extract_json_from_markdown(content)

                desc = data.get("description", "")
                if isinstance(desc, list):
                    desc = " ".join([str(x) for x in desc])
                
                summary = data.get("summary", "")
                if isinstance(summary, list):
                    summary = "\n".join([f"- {x}" for x in summary])

                title = str(data.get("titulo", "") or "").strip()
                tags = PipelineService.clean_tags(data.get("tags", []))

                with get_db() as conn:
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
