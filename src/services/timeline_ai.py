"""Serviço de Sugestões de IA para a Timeline (Pista de IA).

Substitui as antigas 'personas' simuladas do frontend: monta o contexto REAL do corte
atual (transcrições dos trechos usados, descrições visuais, lacunas de cobertura),
o catálogo de mídias candidatas, e pede ao LLM sugestões estruturadas de edição
(INSERT / DELETE / REPLACE) que viram ghost clips na pista de IA.
"""
import json
import requests
from typing import List, Dict, Any, Optional

from src.config import CONFIG
from src.db.connection import get_db
from src.nlp.prompt_templates import get_timeline_suggestion_prompt, TIMELINE_PERSONAS
from src.nlp.json_parser import extract_json_from_markdown

MAX_CANDIDATE_VIDEOS = 25
MAX_FRAMES_PER_CLIP = 8


class TimelineAIService:

    @staticmethod
    def _get_clip_transcript(conn, video_id: int, in_s: float, out_s: float) -> str:
        """Extrai o texto falado exatamente dentro do trecho [in_s, out_s] do vídeo."""
        cursor = conn.cursor()
        cursor.execute("""
            SELECT word, speaker_id FROM transcript
            WHERE video_id = ? AND start_time >= ? AND end_time <= ?
            ORDER BY start_time
        """, (video_id, max(0.0, in_s - 0.5), out_s + 0.5))
        rows = cursor.fetchall()
        if not rows:
            return ""
        words = []
        for r in rows:
            w = r["word"]
            words.append(w if w in [".", ",", "!", "?", ";", ":"] else " " + w)
        speaker = rows[0]["speaker_id"]
        return f"{speaker}: \"{(''.join(words)).strip()}\""

    @staticmethod
    def _get_clip_visuals(project_id: int, video_id: int, in_s: float, out_s: float) -> List[str]:
        """Descrições de frames (já enriquecidas com nomes) dentro do trecho."""
        try:
            from src.search.semantic import SemanticSearch
            frames = SemanticSearch.get_instance().get_video_vision_frames(project_id, video_id)
            hits = [
                f"{f['timestamp']:.0f}s: {f['description']}"
                for f in frames
                if in_s - 2.0 <= f.get("timestamp", 0.0) <= out_s + 2.0 and f.get("description")
            ]
            return hits[:MAX_FRAMES_PER_CLIP]
        except Exception:
            return []

    @staticmethod
    def build_timeline_context(project_id: int, clips: List[Dict[str, Any]], tracks: List[Dict[str, Any]], fps: float) -> str:
        """Serializa o estado atual da timeline em texto para o LLM, incluindo o conteúdo real dos trechos."""
        lines = []

        track_names = {t.get("id"): t.get("name", t.get("id")) for t in (tracks or [])}
        video_track_ids = [t.get("id") for t in (tracks or []) if t.get("kind", "video") == "video"]
        lines.append("TRILHAS DISPONÍVEIS: " + ", ".join(
            [f"{t.get('id')} ({t.get('name', '')}, tipo {t.get('kind', 'video')})" for t in (tracks or [])]
        ))
        lines.append("")

        with get_db() as conn:
            cursor = conn.cursor()
            sorted_clips = sorted(clips, key=lambda c: (c.get("timeline_start_s", 0.0)))

            speech_spans = []   # trechos com fala (para calcular lacunas de cobertura)
            coverage_spans = [] # trechos com b-roll por cima

            for clip in sorted_clips:
                vid = clip.get("video_id")
                in_s = float(clip.get("in_s", 0.0))
                out_s = float(clip.get("out_s", 0.0))
                tl_start = float(clip.get("timeline_start_s", 0.0))
                tl_end = tl_start + (out_s - in_s)
                track_id = clip.get("track", "V1")

                cursor.execute("SELECT filename, video_type, duration FROM video WHERE id = ?", (vid,))
                vrow = cursor.fetchone()
                fname = vrow["filename"] if vrow else f"Vídeo {vid}"
                vtype = vrow["video_type"] if vrow else "unknown"

                header = (
                    f"- [Clipe id={clip.get('id', '?')} | trilha {track_id} ({track_names.get(track_id, '')}) | "
                    f"timeline {tl_start:.1f}s → {tl_end:.1f}s | fonte: vídeo {vid} \"{fname}\" ({vtype}) trecho {in_s:.1f}s-{out_s:.1f}s]"
                )
                lines.append(header)

                if vtype == "interview":
                    speech = TimelineAIService._get_clip_transcript(conn, vid, in_s, out_s)
                    if speech:
                        lines.append(f"  FALA: {speech[:600]}")
                    speech_spans.append((tl_start, tl_end))
                else:
                    visuals = TimelineAIService._get_clip_visuals(project_id, vid, in_s, out_s)
                    if visuals:
                        lines.append("  VISUAL: " + " | ".join(visuals))
                    coverage_spans.append((tl_start, tl_end))
                lines.append("")

            # Lacunas: fala sem cobertura visual de b-roll
            gaps = []
            for (s_start, s_end) in speech_spans:
                cursor_pos = s_start
                for (c_start, c_end) in sorted(coverage_spans):
                    if c_end <= cursor_pos or c_start >= s_end:
                        continue
                    if c_start > cursor_pos:
                        gaps.append((cursor_pos, min(c_start, s_end)))
                    cursor_pos = max(cursor_pos, c_end)
                if cursor_pos < s_end:
                    gaps.append((cursor_pos, s_end))

            significant_gaps = [(g0, g1) for (g0, g1) in gaps if (g1 - g0) >= 3.0]
            if significant_gaps:
                lines.append("LACUNAS DE COBERTURA (fala sem b-roll por cima — candidatas a receber INSERT de b-roll):")
                for g0, g1 in significant_gaps[:10]:
                    lines.append(f"- {g0:.1f}s → {g1:.1f}s ({g1 - g0:.1f}s descobertos)")
                lines.append("")

        return "\n".join(lines)

    @staticmethod
    def build_candidates_context(project_id: int, exclude_video_ids: Optional[set] = None) -> str:
        """Catálogo resumido de mídias da biblioteca que podem ser inseridas."""
        lines = []
        exclude_video_ids = exclude_video_ids or set()

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, video_type, duration, description, summary, tags
                FROM video
                WHERE project_id = ? AND status IN ('transcribed', 'analyzed')
                ORDER BY video_type DESC, id
                LIMIT ?
            """, (project_id, MAX_CANDIDATE_VIDEOS * 2))
            rows = cursor.fetchall()

        count = 0
        for r in rows:
            if count >= MAX_CANDIDATE_VIDEOS:
                break
            desc = r["description"] or ""
            tags = ""
            try:
                tag_list = json.loads(r["tags"]) if r["tags"] else []
                tags = ", ".join(tag_list[:6])
            except Exception:
                pass
            duration = r["duration"] or 0.0
            marker = " (JÁ USADO NA TIMELINE)" if r["id"] in exclude_video_ids else ""
            lines.append(
                f"- [Vídeo id={r['id']} | \"{r['filename']}\" | {r['video_type']} | duração {duration:.0f}s]{marker}: "
                f"{desc[:220]}" + (f" Tags: {tags}." if tags else "")
            )
            count += 1

        return "\n".join(lines) if lines else "(nenhuma mídia analisada disponível)"

    @staticmethod
    def suggest(
        project_id: int,
        persona: str,
        clips: List[Dict[str, Any]],
        tracks: List[Dict[str, Any]],
        fps: float = 24.0,
        brief: str = ""
    ) -> Dict[str, Any]:
        """Gera sugestões de edição estruturadas para a pista de IA."""
        api_key = CONFIG.OPENROUTER_API_KEY
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {"suggestions": [], "error": "OPENROUTER_API_KEY não configurada no .env"}

        if not clips:
            return {"suggestions": [], "error": "Timeline vazia: adicione ao menos um clipe para a IA analisar o contexto."}

        if persona not in TIMELINE_PERSONAS:
            persona = "diretora"

        used_ids = {c.get("video_id") for c in clips}
        timeline_context = TimelineAIService.build_timeline_context(project_id, clips, tracks, fps)
        candidates_context = TimelineAIService.build_candidates_context(project_id, used_ids)

        prompt = get_timeline_suggestion_prompt(persona, timeline_context, candidates_context, brief)

        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": CONFIG.TEXT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4
                },
                timeout=60
            )
            if response.status_code != 200:
                return {"suggestions": [], "error": f"Falha no LLM (status {response.status_code}): {response.text[:200]}"}

            content = response.json()["choices"][0]["message"]["content"].strip()
            data = extract_json_from_markdown(content)
            raw_suggestions = data.get("suggestions", [])
        except Exception as e:
            return {"suggestions": [], "error": f"Erro crítico na chamada do LLM: {e}"}

        # ── Validação e saneamento das sugestões ──
        valid_track_ids = {t.get("id") for t in (tracks or [])}
        video_track_ids = [t.get("id") for t in (tracks or []) if t.get("kind", "video") == "video"]
        clip_ids = {str(c.get("id")) for c in clips}

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, duration FROM video WHERE project_id = ?", (project_id,))
            durations = {r["id"]: (r["duration"] or 0.0) for r in cursor.fetchall()}

        validated = []
        for s in raw_suggestions:
            try:
                action = str(s.get("action", "")).upper()
                if action not in ("INSERT", "DELETE", "REPLACE"):
                    continue

                target_clip_id = s.get("target_clip_id")
                if action in ("DELETE", "REPLACE"):
                    if not target_clip_id or str(target_clip_id) not in clip_ids:
                        continue

                video_id = s.get("video_id")
                in_s = float(s.get("source_in_s", 0.0) or 0.0)
                out_s = float(s.get("source_out_s", 0.0) or 0.0)

                if action in ("INSERT", "REPLACE"):
                    if video_id not in durations:
                        continue
                    dur = durations[video_id]
                    if dur > 0:
                        in_s = max(0.0, min(in_s, dur - 0.5))
                        out_s = max(in_s + 0.5, min(out_s, dur))
                    if out_s - in_s < 0.5:
                        out_s = in_s + min(5.0, dur - in_s if dur > 0 else 5.0)

                track = s.get("track")
                if track not in valid_track_ids:
                    track = video_track_ids[-1] if video_track_ids else "V2"

                validated.append({
                    "action": action,
                    "video_id": video_id,
                    "in": round(in_s, 2),
                    "out": round(out_s, 2),
                    "timeline_start_s": round(float(s.get("timeline_start_s", 0.0) or 0.0), 2),
                    "track": track,
                    "target_clip_id": target_clip_id,
                    "reason": str(s.get("reason", "Sugestão da IA"))[:300],
                    "persona": persona
                })
            except Exception:
                continue

        return {"suggestions": validated[:5], "persona": persona}
