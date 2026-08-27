"""Exportador de Legendas e Títulos para SRT, VTT, ASS e Composição FFmpeg Burn-in (CapIAu-Talho)."""
import re
from pathlib import Path


def _format_srt_time(seconds: float) -> str:
    """Converte segundos para o formato SRT HH:MM:SS,mmm."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _format_vtt_time(seconds: float) -> str:
    """Converte segundos para o formato WebVTT HH:MM:SS.mmm."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_s = total_ms // 1000
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _format_ass_time(seconds: float) -> str:
    """Converte segundos para o formato ASS H:MM:SS.cc (centésimos de segundo)."""
    if seconds < 0:
        seconds = 0.0
    total_cs = int(round(seconds * 100))
    cs = total_cs % 100
    total_s = total_cs // 100
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def generate_srt(timeline_cuts: list, fps: float = 24.0) -> str:
    """Gera conteúdo SRT a partir dos clipes de texto da timeline."""
    text_clips = [c for c in timeline_cuts if c.get("type") == "text"]
    text_clips.sort(key=lambda c: float(c.get("timeline_start", 0.0) or 0.0))

    srt_entries = []
    idx = 1
    for clip in text_clips:
        start_s = float(clip.get("timeline_start", 0.0) or 0.0)
        in_s = float(clip.get("in", 0.0) or 0.0)
        out_s = float(clip.get("out", 0.0) or 0.0)
        dur_s = max(0.1, out_s - in_s)
        end_s = start_s + dur_s

        main_text = str(clip.get("text", "")).strip()
        sub_text = str(clip.get("subtext", "")).strip()

        full_text = main_text
        if sub_text:
            full_text = f"{main_text}\n{sub_text}"

        if not full_text:
            continue

        start_tc = _format_srt_time(start_s)
        end_tc = _format_srt_time(end_s)

        srt_entries.append(f"{idx}\n{start_tc} --> {end_tc}\n{full_text}\n")
        idx += 1

    return "\n".join(srt_entries)


def generate_vtt(timeline_cuts: list, fps: float = 24.0) -> str:
    """Gera conteúdo WebVTT a partir dos clipes de texto da timeline."""
    text_clips = [c for c in timeline_cuts if c.get("type") == "text"]
    text_clips.sort(key=lambda c: float(c.get("timeline_start", 0.0) or 0.0))

    vtt_lines = ["WEBVTT\n"]
    idx = 1
    for clip in text_clips:
        start_s = float(clip.get("timeline_start", 0.0) or 0.0)
        in_s = float(clip.get("in", 0.0) or 0.0)
        out_s = float(clip.get("out", 0.0) or 0.0)
        dur_s = max(0.1, out_s - in_s)
        end_s = start_s + dur_s

        main_text = str(clip.get("text", "")).strip()
        sub_text = str(clip.get("subtext", "")).strip()

        full_text = main_text
        if sub_text:
            full_text = f"{main_text}\n{sub_text}"

        if not full_text:
            continue

        start_tc = _format_vtt_time(start_s)
        end_tc = _format_vtt_time(end_s)

        vtt_lines.append(f"{idx}\n{start_tc} --> {end_tc}\n{full_text}\n")
        idx += 1

    return "\n".join(vtt_lines)


def generate_ass(timeline_cuts: list, fps: float = 24.0, video_w: int = 1920, video_h: int = 1080) -> str:
    """Gera arquivo Advanced SubStation Alpha (.ass) estilizado com posicionamento e keyframes."""
    header = f"""[Script Info]
Title: CapIAu Talho Subtitles & Titles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: {video_w}
PlayResY: {video_h}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Outfit,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,2,2,40,40,40,1
Style: LowerThird,Cinzel,40,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,1,0,1,1,2,1,120,40,90,1
Style: Chapter,Playfair Display,56,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,2,0,1,1,3,5,40,40,40,1
Style: Quote,Cormorant Garamond,46,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,1,0,0,100,100,1,0,1,1,2,5,80,80,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    text_clips = [c for c in timeline_cuts if c.get("type") == "text"]
    text_clips.sort(key=lambda c: float(c.get("timeline_start", 0.0) or 0.0))

    for clip in text_clips:
        start_s = float(clip.get("timeline_start", 0.0) or 0.0)
        in_s = float(clip.get("in", 0.0) or 0.0)
        out_s = float(clip.get("out", 0.0) or 0.0)
        dur_s = max(0.1, out_s - in_s)
        end_s = start_s + dur_s

        category = clip.get("textCategory", "lower_third")
        style_name = "Default"
        if category == "lower_third":
            style_name = "LowerThird"
        elif category == "chapter":
            style_name = "Chapter"
        elif category == "quote":
            style_name = "Quote"

        main_text = str(clip.get("text", "")).replace("\n", "\\N").strip()
        sub_text = str(clip.get("subtext", "")).replace("\n", "\\N").strip()

        line_content = main_text
        if sub_text:
            line_content = f"{main_text}\\N{{\\fs28\\c&H06B6D4&}}{sub_text}"

        start_tc = _format_ass_time(start_s)
        end_tc = _format_ass_time(end_s)

        # Efeitos de fade suave
        fade_tag = "{\\fad(300,300)}"

        events.append(f"Dialogue: 0,{start_tc},{end_tc},{style_name},,0,0,0,,{fade_tag}{line_content}")

    return header + "\n".join(events) + "\n"
