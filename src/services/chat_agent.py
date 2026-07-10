"""Serviço de Agente de Edição NLE (Fase 1) com suporte a Function-Calling e Cópia-Sombra."""
import json
import time
import random
import copy
import requests
from typing import List, Dict, Any, Optional
from pathlib import Path

from src.config import CONFIG
from src.db.connection import get_db
from src.services.rag import RAGService
from src.services.settings_service import SettingsService
from src.db.repositories.projects import ProjectRepository
from src.nlp.prompt_templates import get_agent_system_prompt

class TimelineShadowCopy:
    """Simulação em memória da timeline (cópia-sombra) para validação de mutações do agente."""

    def __init__(self, clips: List[Dict[str, Any]], tracks: List[Dict[str, Any]], fps: float = 24.0):
        self.fps = float(fps) or 24.0
        self.tracks = copy.deepcopy(tracks or [])
        self.clips = []
        
        # Conformar clipes vindos do frontend
        for index, c in enumerate(clips or []):
            self.clips.append({
                "id": c.get("id") or f"cut_{int(time.time())}_{random.randint(100,999)}_{index}",
                "video_id": int(c.get("video_id", 0)),
                "in": float(c.get("in_s") if c.get("in_s") is not None else c.get("in", 0.0)),
                "out": float(c.get("out_s") if c.get("out_s") is not None else c.get("out", 0.0)),
                "timeline_start": float(c.get("timeline_start_s") if c.get("timeline_start_s") is not None else c.get("timeline_start", 0.0)),
                "track": c.get("track") or "V1",
                "link_id": c.get("link_id"),
                "effects": c.get("effects") or [],
                "alternatives": c.get("alternatives") or [],
                "origin": c.get("origin") or "user"
            })
        self.recalculate_timeline()

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        return next((t for t in self.tracks if t["id"] == track_id), None)

    def get_track_kind(self, track_id: str) -> str:
        t = self.get_track(track_id)
        return t.get("kind", "video") if t else "video"

    def is_track_locked(self, track_id: str) -> bool:
        t = self.get_track(track_id)
        return bool(t.get("locked")) if t else False

    def get_paired_audio_track(self, video_track_id: str) -> Optional[str]:
        """V1 -> A1, V2 -> A2, etc. Caso não exista por padrão, retorna a primeira de áudio."""
        audio_tracks = [t for t in self.tracks if t.get("kind") == "audio"]
        if not audio_tracks:
            return None
        num = "".join(filter(str.isdigit, video_track_id))
        if num:
            direct = next((t for t in audio_tracks if t["id"] == f"A{num}"), None)
            if direct:
                return direct["id"]
        return audio_tracks[0]["id"]

    def recalculate_timeline(self):
        """Re-aplica as posições nas pistas magnéticas (ripple) e sincroniza os pares A/V."""
        # 1. Pistas Magnéticas
        for track in self.tracks:
            if track.get("magnetic"):
                track_clips = [c for c in self.clips if c["track"] == track["id"]]
                # Ordena pelo timeline_start atual
                track_clips.sort(key=lambda c: c["timeline_start"])
                cursor = 0.0
                for c in track_clips:
                    c["timeline_start"] = cursor
                    cursor += (c["out"] - c["in"])

        # 2. Sincronia A/V (invariante: timeline_start_a = timeline_start_v - in_v + in_a)
        video_clips_by_link = {
            c["link_id"]: c for c in self.clips 
            if c["link_id"] and self.get_track_kind(c["track"]) == "video"
        }
        for c in self.clips:
            if not c["link_id"] or self.get_track_kind(c["track"]) != "audio":
                continue
            v_partner = video_clips_by_link.get(c["link_id"])
            if not v_partner:
                continue
            
            start = v_partner["timeline_start"] - v_partner["in"] + c["in"]
            if start < 0:
                c["in"] -= start  # Ajusta o in point para não começar antes de 0s na timeline
                start = 0.0
            c["timeline_start"] = start

    # --- OPERAÇÕES DE MUTAÇÃO ---

    def insert_clip(self, project_id: int, track: str, video_id: int, in_s: float, out_s: float, 
                    timeline_start: Optional[float] = None, mode: str = "insert", 
                    alternatives: Optional[List[Dict[str, Any]]] = None) -> str:
        
        t_obj = self.get_track(track)
        if not t_obj:
            return f"Erro: Pista {track} não existe."
        if t_obj.get("locked"):
            return f"Erro: Pista {track} está travada."
        if t_obj.get("kind", "video") != "video":
            return f"Erro: Não é possível inserir clipe de vídeo na pista de áudio/sugestão {track}."

        # Verificar se o vídeo existe no banco e obter duração
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT duration, filename, video_type, description FROM video WHERE id = ?", (video_id,))
            vrow = cursor.fetchone()
            if not vrow:
                return f"Erro: Vídeo ID {video_id} não encontrado no projeto."
            max_duration = float(vrow["duration"] or 10000.0)
            video_desc = vrow["description"] or ""
            video_type = vrow["video_type"] or "video"

        # Validação de limites
        in_s = max(0.0, float(in_s))
        out_s = min(max_duration, float(out_s))
        if in_s >= out_s:
            return f"Erro: Ponto de entrada ({in_s}s) deve ser menor que o de saída ({out_s}s)."
        
        duration = out_s - in_s
        
        if timeline_start is None:
            if t_obj.get("magnetic"):
                # Insere ao final por padrão
                track_clips = [c for c in self.clips if c["track"] == track]
                timeline_start = sum((c["out"] - c["in"]) for c in track_clips)
            else:
                timeline_start = 0.0
        else:
            timeline_start = max(0.0, float(timeline_start))

        # Fallback de busca semântica para alternativas caso não fornecidas
        if not alternatives:
            alternatives = []
            try:
                similar_hits = RAGService.search_hybrid(project_id, video_desc, media_type=video_type, limit=4)
                for hit in similar_hits:
                    p = hit.get("payload", {})
                    alt_vid = p.get("video_id")
                    if alt_vid and alt_vid != video_id:
                        alt_in = float(p.get("start_time", 0.0))
                        alt_out = float(p.get("end_time", alt_in + 5.0))
                        alternatives.append({
                            "video_id": int(alt_vid),
                            "in_s": alt_in,
                            "out_s": alt_out,
                            "ideal_duration_s": alt_out - alt_in,
                            "reason": f"Trecho similar: {p.get('text', '')[:50]}..."
                        })
            except Exception as e:
                print(f"[ShadowTimeline] Falha na busca semântica de alternativas: {e}")

        # Gerar link_id se houver faixa de áudio correspondente
        paired_audio = self.get_paired_audio_track(track)
        link_id = f"link_{int(time.time())}_{random.randint(100,999)}" if paired_audio else None

        stamp = f"{int(time.time())}_{random.randint(100,999)}"
        new_video_clip = {
            "id": f"cut_{stamp}_v",
            "video_id": video_id,
            "in": in_s,
            "out": out_s,
            "timeline_start": timeline_start,
            "track": track,
            "link_id": link_id,
            "effects": [],
            "alternatives": alternatives,
            "origin": "ai"
        }

        # Tratar o ripple edit (mode = 'insert') ou sobreposição (mode = 'overwrite')
        if mode == "insert" and not t_obj.get("magnetic"):
            # Empurra os clipes à direita na pista de vídeo
            for c in self.clips:
                if c["track"] == track and c["timeline_start"] >= timeline_start - 0.01:
                    c["timeline_start"] += duration
        elif mode == "overwrite":
            # Deletar/recortar clipes que sobrepõem na pista de vídeo
            self._overwrite_range(track, timeline_start, timeline_start + duration)
            if paired_audio:
                self._overwrite_range(paired_audio, timeline_start, timeline_start + duration)

        self.clips.append(new_video_clip)

        # Inserir áudio correspondente
        if paired_audio:
            new_audio_clip = {
                "id": f"cut_{stamp}_a",
                "video_id": video_id,
                "in": in_s,
                "out": out_s,
                "timeline_start": timeline_start,
                "track": paired_audio,
                "link_id": link_id,
                "effects": [],
                "alternatives": [],
                "origin": "ai"
            }
            self.clips.append(new_audio_clip)

        self.recalculate_timeline()
        return "success"

    def _overwrite_range(self, track_id: str, start: float, end: float):
        """Remove ou encurta clipes na pista dada que colidem com o intervalo [start, end]."""
        to_remove = []
        for c in self.clips:
            if c["track"] != track_id:
                continue
            c_start = c["timeline_start"]
            c_end = c_start + (c["out"] - c["in"])
            
            # Totalmente dentro -> deletar
            if c_start >= start and c_end <= end:
                to_remove.append(c)
            # Corta a cauda
            elif c_start < start and c_end > start and c_end <= end:
                c["out"] = c["in"] + (start - c_start)
            # Corta a cabeça
            elif c_start >= start and c_start < end and c_end > end:
                c["in"] += (end - c_start)
                c["timeline_start"] = end
            # Clipe engloba todo o overwrite -> divide em dois ou encurta
            elif c_start < start and c_end > end:
                c["out"] = c["in"] + (start - c_start)

        for r in to_remove:
            self.clips.remove(r)

    def move_clip(self, clip_id: str, to_track: str, to_s: float) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        
        orig_track = clip["track"]
        if self.is_track_locked(orig_track) or self.is_track_locked(to_track):
            return "Erro: Uma das pistas está travada."
        
        if self.get_track_kind(orig_track) != self.get_track_kind(to_track):
            return f"Erro: Não é possível mover clipe de {self.get_track_kind(orig_track)} para {self.get_track_kind(to_track)}."

        # Se for áudio vinculado, movemos o vídeo parceiro
        if self.get_track_kind(orig_track) == "audio" and clip["link_id"]:
            video_partner = next((c for c in self.clips if c["link_id"] == clip["link_id"] and self.get_track_kind(c["track"]) == "video"), None)
            if video_partner:
                delta = to_s - clip["timeline_start"]
                video_partner["timeline_start"] = max(0.0, video_partner["timeline_start"] + delta)
                self.recalculate_timeline()
                return "success"

        # Se for vídeo vinculado, movemos também seu áudio parceiro para a trilha pareada de destino
        if self.get_track_kind(orig_track) == "video" and clip["link_id"]:
            audio_partner = next((c for c in self.clips if c["link_id"] == clip["link_id"] and self.get_track_kind(c["track"]) == "audio"), None)
            if audio_partner:
                to_audio_track = self.get_paired_audio_track(to_track)
                if to_audio_track and not self.is_track_locked(audio_partner["track"]) and not self.is_track_locked(to_audio_track):
                    audio_partner["track"] = to_audio_track

        clip["track"] = to_track
        clip["timeline_start"] = max(0.0, float(to_s))
        self.recalculate_timeline()
        return "success"

    def delete_clip(self, clip_id: str, delete_partner: bool = True) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        
        if self.is_track_locked(clip["track"]):
            return f"Erro: Pista {clip['track']} está travada."

        link_id = clip["link_id"]
        self.clips.remove(clip)

        if delete_partner and link_id:
            partners = [c for c in self.clips if c["link_id"] == link_id]
            for p in partners:
                if not self.is_track_locked(p["track"]):
                    self.clips.remove(p)
                else:
                    p["link_id"] = None  # Desvincula se o parceiro está travado

        self.recalculate_timeline()
        return "success"

    def trim_clip(self, clip_id: str, edge: str, delta_s: float) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        
        if self.is_track_locked(clip["track"]):
            return f"Erro: Pista {clip['track']} está travada."
        
        # Descobrir duração máxima do vídeo fonte
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT duration FROM video WHERE id = ?", (clip["video_id"],))
            row = cursor.fetchone()
            max_duration = float(row["duration"]) if (row and row["duration"]) else 10000.0

        if edge == "left":
            new_in = max(0.0, clip["in"] + delta_s)
            if new_in >= clip["out"] - 0.5:
                return "Erro: Trim inválido, o clipe precisa ter ao menos 0.5s."
            clip["in"] = new_in
            # Trims livres deslocam o início da timeline
            t_obj = self.get_track(clip["track"])
            if t_obj and not t_obj.get("magnetic"):
                clip["timeline_start"] = max(0.0, clip["timeline_start"] + delta_s)
        else: # right
            new_out = min(max_duration, clip["out"] + delta_s)
            if new_out <= clip["in"] + 0.5:
                return "Erro: Trim inválido, o clipe precisa ter ao menos 0.5s."
            clip["out"] = new_out

        self.recalculate_timeline()
        return "success"

    def split_clip(self, clip_id: str, at_s: float) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        
        if self.is_track_locked(clip["track"]):
            return "Erro: Pista travada."

        duration = clip["out"] - clip["in"]
        start = clip["timeline_start"]
        end = start + duration

        if at_s <= start + 0.25 or at_s >= end - 0.25:
            return "Erro: Ponto de split muito próximo das bordas (mínimo 0.25s restando)."

        offset = at_s - start
        split_source = clip["in"] + offset

        # Criar segunda parte
        stamp = f"{int(time.time())}_{random.randint(100,999)}"
        clip2 = {
            "id": f"cut_{stamp}_v",
            "video_id": clip["video_id"],
            "in": split_source,
            "out": clip["out"],
            "timeline_start": at_s,
            "track": clip["track"],
            "link_id": None,
            "effects": copy.deepcopy(clip["effects"]),
            "alternatives": copy.deepcopy(clip["alternatives"])
        }
        
        # Encurtar primeira parte
        clip["out"] = split_source

        # Lidar com par A/V vinculado
        if clip["link_id"]:
            partner = next((c for c in self.clips if c["link_id"] == clip["link_id"] and c["id"] != clip["id"]), None)
            if partner and not self.is_track_locked(partner["track"]):
                # Dividir o parceiro também
                partner2 = {
                    "id": f"cut_{stamp}_a",
                    "video_id": partner["video_id"],
                    "in": split_source,
                    "out": partner["out"],
                    "timeline_start": at_s,
                    "track": partner["track"],
                    "link_id": None,
                    "effects": copy.deepcopy(partner["effects"]),
                    "alternatives": []
                }
                partner["out"] = split_source
                
                # Criar novos links para cada metade
                link1 = f"link_{stamp}_1"
                link2 = f"link_{stamp}_2"
                clip["link_id"] = link1
                partner["link_id"] = link1
                clip2["link_id"] = link2
                partner2["link_id"] = link2
                
                self.clips.append(partner2)
        
        self.clips.append(clip2)
        self.recalculate_timeline()
        return "success"

    def set_av_offset(self, clip_id: str, audio_lead_s: float) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip or not clip["link_id"]:
            return "Erro: Clipe não vinculado."
        
        video_partner = next((c for c in self.clips if c["link_id"] == clip["link_id"] and self.get_track_kind(c["track"]) == "video"), None)
        audio_partner = next((c for c in self.clips if c["link_id"] == clip["link_id"] and self.get_track_kind(c["track"]) == "audio"), None)
        
        if not video_partner or not audio_partner:
            return "Erro: Parceiro A/V não localizado."
            
        if self.is_track_locked(audio_partner["track"]):
            return "Erro: Trilha de áudio parceira está travada."

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT duration FROM video WHERE id = ?", (audio_partner["video_id"],))
            row = cursor.fetchone()
            max_duration = float(row["duration"]) if (row and row["duration"]) else 10000.0

        # Nudge nos limites de in/out do áudio para criar o delay/lead
        # audio_lead_s positivo = áudio entra antes (J-cut) -> decrementa in
        # audio_lead_s negativo = áudio termina depois (L-cut) -> incrementa out
        if audio_lead_s > 0:
            audio_partner["in"] = max(0.0, video_partner["in"] - audio_lead_s)
        elif audio_lead_s < 0:
            audio_partner["out"] = min(max_duration, video_partner["out"] - audio_lead_s)
            
        self.recalculate_timeline()
        return "success"

    def add_effect(self, clip_id: str, effect_name: str, params: Dict[str, Any]) -> str:
        clip = next((c for c in self.clips if c["id"] == clip_id), None)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        if self.is_track_locked(clip["track"]):
            return "Erro: Pista travada."
            
        clip.setdefault("effects", []).append({
            "effect": effect_name,
            "params": params
        })
        return "success"

    def serialize_cuts_to_frontend(self) -> List[Dict[str, Any]]:
        """Devolve os clipes convertidos de volta ao formato que o frontend espera (in/out/timeline_start em segundos)."""
        return [
            {
                "id": c["id"],
                "video_id": c["video_id"],
                "in": c["in"],
                "out": c["out"],
                "timeline_start": c["timeline_start"],
                "track": c["track"],
                "link_id": c["link_id"],
                "effects": c["effects"],
                "alternatives": c["alternatives"],
                "origin": c.get("origin", "user")
            }
            for c in self.clips
        ]

# --- SERVIÇO DO AGENTE DE CHAT ---

class ChatAgentService:
    """Orquestrador do loop de Agente de Edição com function-calling via OpenRouter."""

    # Definição das ferramentas OpenAI/OpenRouter
    TOOLS = [
        {
            "type": "function",
            "function": {
                "name": "get_timeline_state",
                "description": "Retorna o estado atual da timeline (pistas, clipes e lacunas de fala).",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_media",
                "description": "Busca mídias (entrevistas, b-rolls, fotos) no acervo através do motor RAG do projeto.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Termo de busca cinematográfica ou falado."},
                        "media_type": {"type": "string", "enum": ["interview", "broll", "photo", "doc"], "description": "Filtro de mídia opcional."}
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_transcript",
                "description": "Retorna o diálogo exato transcrito de um vídeo específico (com timestamps).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "video_id": {"type": "integer", "description": "ID numérico do vídeo."},
                        "start_time": {"type": "number", "description": "Tempo inicial opcional em segundos."},
                        "end_time": {"type": "number", "description": "Tempo final opcional em segundos."}
                    },
                    "required": ["video_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "analyze_coverage",
                "description": "Retorna as falas da timeline que estão sem cobertura visual (jump cuts ou sem b-roll por cima).",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        {
            "type": "function",
            "function": {
                "name": "insert_clip",
                "description": "Insere um clipe de vídeo na timeline (cria par áudio-vídeo automaticamente se houver trilha parceira).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "track": {"type": "string", "description": "Pista de destino (ex: V1, V2)."},
                        "video_id": {"type": "integer", "description": "ID do vídeo a inserir."},
                        "in_s": {"type": "number", "description": "Ponto de entrada no vídeo original (segundos)."},
                        "out_s": {"type": "number", "description": "Ponto de saída no vídeo original (segundos)."},
                        "timeline_start": {"type": "number", "description": "Início absoluto na timeline em segundos (opcional para pistas magnéticas)."},
                        "mode": {"type": "string", "enum": ["insert", "overwrite"], "description": "Modo ripple (insert) ou sobreposição (overwrite). Padrão 'insert'."},
                        "alternatives": {
                            "type": "array",
                            "description": "Lista de opções alternativas de mídias de fallback sugeridas.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "video_id": {"type": "integer"},
                                    "in_s": {"type": "number"},
                                    "out_s": {"type": "number"},
                                    "ideal_duration_s": {"type": "number"},
                                    "reason": {"type": "string"}
                                },
                                "required": ["video_id", "in_s", "out_s", "ideal_duration_s", "reason"]
                            }
                        }
                    },
                    "required": ["track", "video_id", "in_s", "out_s"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "move_clip",
                "description": "Move um clipe de trilha e de início absoluto de tempo.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID estável do clipe (ex: cut_...)."},
                        "to_track": {"type": "string", "description": "ID da trilha de destino (V1, V2, A1, A2)."},
                        "to_s": {"type": "number", "description": "Nova posição em segundos na timeline."}
                    },
                    "required": ["clip_id", "to_track", "to_s"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "delete_clip",
                "description": "Deleta um clipe e seu parceiro A/V se vinculado.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe a remover."},
                        "delete_partner": {"type": "boolean", "description": "Se verdadeiro, remove também o áudio/vídeo linkado. Padrão True."}
                    },
                    "required": ["clip_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "trim_clip",
                "description": "Modifica os limites de corte (trim) da borda esquerda (in) ou direita (out) de um clipe.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe."},
                        "edge": {"type": "string", "enum": ["left", "right"], "description": "Borda a ajustar."},
                        "delta_s": {"type": "number", "description": "Delta em segundos (positivo estica, negativo encolhe)."}
                    },
                    "required": ["clip_id", "edge", "delta_s"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "split_clip",
                "description": "Divide (splicing) um clipe em dois no timestamp da timeline indicado.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe."},
                        "at_s": {"type": "number", "description": "Tempo absoluto na timeline onde fazer o corte."}
                    },
                    "required": ["clip_id", "at_s"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "set_av_offset",
                "description": "Ajusta o delay/offset de áudio de um par vinculado para criar J-cuts ou L-cuts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe."},
                        "audio_lead_s": {"type": "number", "description": "Delta em segundos. Positivo = J-cut (áudio antes); Negativo = L-cut (áudio depois)."}
                    },
                    "required": ["clip_id", "audio_lead_s"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "add_effect",
                "description": "Aplica efeitos compatíveis com MLT XML no clipe selecionado.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe."},
                        "effect_name": {"type": "string", "enum": ["fade_in_video", "fade_out_video", "fade_in_audio", "fade_out_audio", "volume", "speed"]},
                        "params": {"type": "object", "description": "Parâmetros do efeito (ex: duration, level, speed_ratio)."}
                    },
                    "required": ["clip_id", "effect_name", "params"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "propose_bulk_edit",
                "description": (
                    "Envia um lote de edições estruturadas como sugestões 'preview' para a ghost track da timeline. "
                    "REGRAS OBRIGATÓRIAS: INSERT exige video_id + in_s + out_s + timeline_start; "
                    "REPLACE exige target_clip_id + video_id + in_s + out_s; "
                    "DELETE exige target_clip_id. Operações incompletas são rejeitadas."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "operations": {
                            "type": "array",
                            "description": "Array contendo operações de edição em massa a propor.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "action": {"type": "string", "enum": ["INSERT", "DELETE", "REPLACE"]},
                                    "track": {"type": "string", "description": "Pista de destino (ex: V2 para b-roll)."},
                                    "video_id": {"type": "integer", "description": "ID do vídeo fonte (obrigatório em INSERT/REPLACE; use IDs retornados por search_media)."},
                                    "in_s": {"type": "number", "description": "Ponto de entrada no vídeo fonte, em segundos (obrigatório em INSERT/REPLACE)."},
                                    "out_s": {"type": "number", "description": "Ponto de saída no vídeo fonte, em segundos (obrigatório em INSERT/REPLACE)."},
                                    "timeline_start": {"type": "number", "description": "Posição ABSOLUTA na timeline em segundos onde a sugestão entra (obrigatório em INSERT; ex: para cobrir a fala dos 12s aos 18s, use 12.0)."},
                                    "target_clip_id": {"type": "string", "description": "ID exato do clipe alvo vindo de get_timeline_state (obrigatório em DELETE/REPLACE)."}
                                },
                                "required": ["action", "track"]
                            }
                        },
                        "rationale": {"type": "string", "description": "Explicação narratológica de por que essas edições fazem sentido."}
                    },
                    "required": ["operations", "rationale"]
                }
            }
        }
    ]

    @staticmethod
    def chat_with_agent(
        project_id: int,
        message: str,
        history: List[Dict[str, str]],
        clips: List[Dict[str, Any]],
        tracks: List[Dict[str, Any]],
        fps: float = 24.0,
        agent_model: Optional[str] = None,
        custom_api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Loop principal do Agente de Edição. Executa chamadas OpenRouter e aplica tools na cópia-sombra."""
        
        # Configurações resolvidas (default -> global -> projeto), uma vez por chamada
        S = SettingsService.get_settings(project_id)

        # Chave API: custom por requisição > painel de configurações > .env
        api_key = custom_api_key or S.api_key("openrouter")
        if not api_key or api_key == "your_openrouter_api_key_here":
            return {
                "response": "Olá! Configure a chave do OpenRouter no painel de configurações da IA (engrenagem no topo) ou no `.env` para liberar a IA.",
                "operations": [],
                "final_cuts": clips,
                "final_tracks": tracks
            }

        # Modelo do agente: override por requisição > configurações
        model_name = agent_model or S.get("agent.model")

        # Inicializa a cópia-sombra
        shadow_timeline = TimelineShadowCopy(clips, tracks, fps)

        # Monta os contextos iniciais para o prompt de sistema
        from src.services.timeline_ai import TimelineAIService
        # Ajusta chaves para build_timeline_context
        normalized_clips = []
        for c in shadow_timeline.serialize_cuts_to_frontend():
            normalized_clips.append({
                "id": c["id"],
                "video_id": c["video_id"],
                "in_s": c["in"],
                "out_s": c["out"],
                "timeline_start_s": c["timeline_start"],
                "track": c["track"],
                "link_id": c["link_id"]
            })
        
        timeline_context = TimelineAIService.build_timeline_context(project_id, normalized_clips, shadow_timeline.tracks, fps)
        
        # Contexto de busca de RAG inicial
        context_items = []
        try:
            raw_results = RAGService.search_hybrid(project_id, message, limit=10)
            with get_db() as conn:
                cursor = conn.cursor()
                for r in raw_results:
                    p = r.get("payload", {})
                    m_type = p.get("media_type")
                    text = p.get("text", "")
                    if m_type in ["interview", "broll", "video"]:
                        vid = p.get("video_id")
                        cursor.execute("SELECT filename FROM video WHERE id = ?", (vid,))
                        row = cursor.fetchone()
                        fname = row["filename"] if row else "Video"
                        start = p.get("start_time", 0.0)
                        end = p.get("end_time", start + 10.0)
                        context_items.append(f'- [Vídeo ID {vid} | Arquivo: {fname} | Tempo: {start:.1f}s - {end:.1f}s]: "{text}"')
        except Exception:
            pass
        context_str = "\n".join(context_items)

        system_prompt = get_agent_system_prompt(timeline_context, context_str, project_id=project_id)

        # Prepara mensagens para o LLM
        messages = [{"role": "system", "content": system_prompt}]
        
        # Histórico resumido para não estourar a janela em loops longos
        for h in history[-S.get("agent.history_window"):] if S.get("agent.history_window") > 0 else []:
            messages.append({
                "role": h.get("role", "user"),
                "content": h.get("content", "")
            })
        messages.append({"role": "user", "content": message})

        accumulated_ops = []
        bulk_operations = []  # Armazena propostas de bulk_edit
        steps = 0
        max_steps = S.get("agent.max_steps")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        while steps < max_steps:
            payload = {
                "model": model_name,
                "messages": messages,
                "tools": ChatAgentService.TOOLS,
                "tool_choice": "auto",
                "temperature": S.get("agent.temperature")
            }

            try:
                response = requests.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=S.get("agent.timeout")
                )
                if response.status_code != 200:
                    return {
                        "response": f"Erro de comunicação com OpenRouter (Status {response.status_code}): {response.text}",
                        "operations": [],
                        "final_cuts": clips,
                        "final_tracks": tracks
                    }
                
                res_json = response.json()
                choice = res_json['choices'][0]
                message_obj = choice['message']
                
                # Armazena a mensagem gerada na conversa interna
                # Importante: Se vier tool_calls, precisamos passá-la integralmente de volta
                messages.append(message_obj)

                tool_calls = message_obj.get("tool_calls")
                if not tool_calls:
                    # Agente retornou a resposta de texto final
                    break

                for tool_call in tool_calls:
                    func_name = tool_call["function"]["name"]
                    raw_args = tool_call["function"]["arguments"]
                    call_id = tool_call["id"]
                    
                    try:
                        args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                    except Exception:
                        args = {}

                    print(f"[AgentLoop] Chamando ferramenta: {func_name} com argumentos: {args}")
                    tool_result = ""

                    # --- EXECUÇÃO DE TOOLS ---
                    if func_name == "get_timeline_state":
                        # Recalcular contexto com a shadow copy atualizada
                        current_clips = []
                        for c in shadow_timeline.serialize_cuts_to_frontend():
                            current_clips.append({
                                "id": c["id"],
                                "video_id": c["video_id"],
                                "in_s": c["in"],
                                "out_s": c["out"],
                                "timeline_start_s": c["timeline_start"],
                                "track": c["track"],
                                "link_id": c["link_id"]
                            })
                        tool_result = TimelineAIService.build_timeline_context(project_id, current_clips, shadow_timeline.tracks, fps)

                    elif func_name == "search_media":
                        q = args.get("query", "")
                        mtype = args.get("media_type")
                        search_hits = RAGService.search_hybrid(project_id, q, media_type=mtype, limit=8)
                        # Simplifica o retorno para economizar tokens
                        simplified = []
                        for h in search_hits:
                            p = h.get("payload", {})
                            m = p.get("media_type", "video")
                            mid = p.get("photo_id") or p.get("video_id") or 0
                            simplified.append({
                                "media_type": m,
                                "id": mid,
                                "filename": p.get("filename"),
                                "start_time": p.get("start_time", 0.0),
                                "end_time": p.get("end_time", 5.0),
                                "text": p.get("text", "")[:120]
                            })
                        tool_result = json.dumps(simplified)

                    elif func_name == "get_transcript":
                        vid = int(args.get("video_id", 0))
                        s_time = args.get("start_time")
                        e_time = args.get("end_time")
                        with get_db() as conn:
                            cursor = conn.cursor()
                            if s_time is not None and e_time is not None:
                                cursor.execute("SELECT word, speaker_id, start_time FROM transcript WHERE video_id = ? AND start_time >= ? AND end_time <= ? ORDER BY start_time", (vid, s_time, e_time))
                            else:
                                cursor.execute("SELECT word, speaker_id, start_time FROM transcript WHERE video_id = ? ORDER BY start_time LIMIT 200", (vid,))
                            t_rows = cursor.fetchall()
                            
                        # Agrupa palavras por falante para ler mais fácil
                        lines_grouped = []
                        last_spk = None
                        curr_words = []
                        for tr in t_rows:
                            spk = tr["speaker_id"]
                            w = tr["word"]
                            ts = tr["start_time"]
                            if last_spk != spk:
                                if curr_words:
                                    lines_grouped.append(f"{last_spk}: {''.join(curr_words)}")
                                last_spk = spk
                                curr_words = [f" [{ts:.1f}s] {w}"]
                            else:
                                curr_words.append(w if w in [".", ",", "!", "?", ";"] else " " + w)
                        if curr_words:
                            lines_grouped.append(f"{last_spk}: {''.join(curr_words)}")
                        tool_result = "\n".join(lines_grouped) if lines_grouped else "(nenhuma transcrição encontrada)"

                    elif func_name == "analyze_coverage":
                        # Identificar falas e b-rolls na shadow copy
                        shadow_cuts_frontend = shadow_timeline.serialize_cuts_to_frontend()
                        curr_clips = []
                        for c in shadow_cuts_frontend:
                            curr_clips.append({
                                "id": c["id"],
                                "video_id": c["video_id"],
                                "in_s": c["in"],
                                "out_s": c["out"],
                                "timeline_start_s": c["timeline_start"],
                                "track": c["track"],
                                "link_id": c["link_id"]
                            })
                        
                        # Calcula lacunas
                        speech_spans = []
                        coverage_spans = []
                        track_names = {t["id"]: t.get("name", t["id"]) for t in shadow_timeline.tracks}
                        
                        with get_db() as conn:
                            cursor = conn.cursor()
                            for clip in curr_clips:
                                vid = clip["video_id"]
                                cursor.execute("SELECT video_type FROM video WHERE id = ?", (vid,))
                                r = cursor.fetchone()
                                vtype = r["video_type"] if r else "unknown"
                                
                                dur = clip["out_s"] - clip["in_s"]
                                tl_start = clip["timeline_start_s"]
                                tl_end = tl_start + dur
                                if vtype == "interview":
                                    speech_spans.append((tl_start, tl_end))
                                else:
                                    coverage_spans.append((tl_start, tl_end))
                                    
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
                                
                        significant = [g for g in gaps if (g[1] - g[0]) >= S.get("timeline.min_gap_s")]
                        tool_result = json.dumps([{"start_s": g[0], "end_s": g[1], "duration_s": g[1] - g[0]} for g in significant])

                    elif func_name == "insert_clip":
                        res_mut = shadow_timeline.insert_clip(
                            project_id=project_id,
                            track=args["track"],
                            video_id=int(args["video_id"]),
                            in_s=float(args["in_s"]),
                            out_s=float(args["out_s"]),
                            timeline_start=args.get("timeline_start"),
                            mode=args.get("mode", "insert"),
                            alternatives=args.get("alternatives")
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "INSERT", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "move_clip":
                        res_mut = shadow_timeline.move_clip(
                            clip_id=args["clip_id"],
                            to_track=args["to_track"],
                            to_s=float(args["to_s"])
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "MOVE", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "delete_clip":
                        res_mut = shadow_timeline.delete_clip(
                            clip_id=args["clip_id"],
                            delete_partner=args.get("delete_partner", True)
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "DELETE", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "trim_clip":
                        res_mut = shadow_timeline.trim_clip(
                            clip_id=args["clip_id"],
                            edge=args["edge"],
                            delta_s=float(args["delta_s"])
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "TRIM", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "split_clip":
                        res_mut = shadow_timeline.split_clip(
                            clip_id=args["clip_id"],
                            at_s=float(args["at_s"])
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "SPLIT", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "set_av_offset":
                        res_mut = shadow_timeline.set_av_offset(
                            clip_id=args["clip_id"],
                            audio_lead_s=float(args["audio_lead_s"])
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "SET_AV_OFFSET", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "add_effect":
                        res_mut = shadow_timeline.add_effect(
                            clip_id=args["clip_id"],
                            effect_name=args["effect_name"],
                            params=args["params"]
                        )
                        if res_mut == "success":
                            accumulated_ops.append({"action": "ADD_EFFECT", "params": args})
                            tool_result = "success"
                        else:
                            tool_result = res_mut

                    elif func_name == "propose_bulk_edit":
                        # Valida e sanea cada operação antes de virarem ghost clips:
                        # ops incompletas geravam sugestões em 0s ou aceites que não faziam nada.
                        ops = args.get("operations", [])
                        rationale = args.get("rationale", "")
                        accepted_ops = []
                        op_errors = []

                        with get_db() as conn:
                            cursor = conn.cursor()
                            for op_idx, op in enumerate(ops):
                                action = (op.get("action") or "INSERT").upper()
                                op["action"] = action

                                if action in ("DELETE", "REPLACE"):
                                    target_id = op.get("target_clip_id")
                                    target = next((c for c in shadow_timeline.clips if c["id"] == target_id), None)
                                    if not target:
                                        op_errors.append(
                                            f"op {op_idx} ({action}): target_clip_id ausente ou inexistente "
                                            f"('{target_id}') — use os ids exatos do get_timeline_state"
                                        )
                                        continue
                                    # Alinha o ghost ao clipe alvo (posição/duração do hachurado)
                                    op.setdefault("track", target["track"])
                                    if op.get("timeline_start") is None:
                                        op["timeline_start"] = target["timeline_start"]
                                    if action == "DELETE":
                                        op["in_s"] = target["in"]
                                        op["out_s"] = target["out"]
                                        op["video_id"] = target["video_id"]
                                        accepted_ops.append(op)
                                        continue

                                # INSERT e REPLACE precisam de um vídeo fonte válido
                                vid_id = op.get("video_id")
                                if not vid_id:
                                    op_errors.append(f"op {op_idx} ({action}): video_id é obrigatório")
                                    continue
                                cursor.execute("SELECT duration FROM video WHERE id = ?", (vid_id,))
                                vrow = cursor.fetchone()
                                if not vrow:
                                    op_errors.append(f"op {op_idx} ({action}): video_id {vid_id} não existe no projeto")
                                    continue
                                max_dur = float(vrow["duration"] or 10000.0)

                                in_s = max(0.0, float(op.get("in_s") or 0.0))
                                out_s = float(op.get("out_s") or 0.0)
                                if out_s <= in_s:
                                    out_s = min(max_dur, in_s + 5.0)
                                out_s = min(max_dur, out_s)
                                if out_s - in_s < 0.5:
                                    op_errors.append(f"op {op_idx} ({action}): trecho fonte inválido ({in_s}s-{out_s}s)")
                                    continue
                                op["in_s"] = in_s
                                op["out_s"] = out_s

                                if action == "INSERT" and op.get("timeline_start") is None:
                                    op_errors.append(
                                        f"op {op_idx} (INSERT): timeline_start é obrigatório "
                                        f"(posição absoluta em segundos na timeline)"
                                    )
                                    continue

                                accepted_ops.append(op)

                        bulk_operations.extend(accepted_ops)
                        tool_result = f"{len(accepted_ops)} edições aceitas como sugestões (preview) para o usuário."
                        if op_errors:
                            tool_result += (
                                " OPERAÇÕES REJEITADAS: " + "; ".join(op_errors) +
                                ". Corrija os campos e reenvie SOMENTE as operações rejeitadas."
                            )

                    else:
                        tool_result = f"Erro: Ferramenta {func_name} desconhecida."

                    # Devolve o resultado da tool para o LLM
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": func_name,
                        "content": tool_result
                    })

                steps += 1

            except Exception as e:
                return {
                    "response": f"Erro crítico durante o loop do agente: {str(e)}",
                    "operations": [],
                    "final_cuts": clips,
                    "final_tracks": tracks
                }

        # --- FIM DO LOOP: CLASSIFICAÇÃO DE RISCO ---
        # Regras de risco:
        # 1. Se propose_bulk_edit foi chamado ou se acumulamos operações em lote via bulk_operations:
        #    estas viram sugestões de ghost clips (preview).
        # 2. Se a quantidade de operações diretas executadas no shadow copy for > 2:
        #    para segurança do usuário, também as classificamos como preview e geramos como sugestões.
        # 3. Caso contrário, são marcadas como direct e aplicadas imediatamente.
        
        final_cuts_frontend = shadow_timeline.serialize_cuts_to_frontend()
        final_tracks_frontend = shadow_timeline.tracks

        # Prepara a resposta final de operações
        ops_output = []
        suggestions_output = []

        is_preview = len(bulk_operations) > 0 or len(accumulated_ops) > 2
        
        # Converte as operações acumuladas para a resposta
        for op in accumulated_ops:
            op["risk"] = "preview" if is_preview else "direct"
            ops_output.append(op)

        # Se houver propostas de bulk_edit, elas são formatadas como sugestões fantasma (preview)
        # O frontend recebe em suggestions[] no mesmo formato de timelineGhost
        for idx, op in enumerate(bulk_operations):
            action = op.get("action", "INSERT")
            video_id = op.get("video_id")
            
            # Recuperar in/out do banco se omitido
            in_s = op.get("in_s", 0.0)
            out_s = op.get("out_s", in_s + 5.0)
            
            # Buscar alternativas se for uma inserção
            alts = op.get("alternatives") or []
            if action == "INSERT" and not alts and video_id:
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT description, video_type FROM video WHERE id = ?", (video_id,))
                        vrow = cursor.fetchone()
                        if vrow:
                            vdesc = vrow["description"] or ""
                            vtype = vrow["video_type"] or "video"
                            similar_hits = RAGService.search_hybrid(project_id, vdesc, media_type=vtype, limit=4)
                            for hit in similar_hits:
                                p = hit.get("payload", {})
                                alt_vid = p.get("video_id")
                                if alt_vid and alt_vid != video_id:
                                    alt_in = float(p.get("start_time", 0.0))
                                    alt_out = float(p.get("end_time", alt_in + 5.0))
                                    alts.append({
                                        "video_id": int(alt_vid),
                                        "in_s": alt_in,
                                        "out_s": alt_out,
                                        "ideal_duration_s": alt_out - alt_in,
                                        "reason": f"Trecho similar: {p.get('text', '')[:50]}..."
                                    })
                except Exception as e:
                    print(f"[AgentLoop] Falha ao buscar alternativas para ghost suggestion: {e}")

            # Montar sugestão no formato aceito pelo timelineGhost
            suggestions_output.append({
                "id": f"ghost_{int(time.time())}_{idx}",
                "action": action,
                "video_id": video_id,
                "in": in_s,
                "out": out_s,
                "track": op.get("track", "V2"),
                "timelineStartFrame": None,  # será calculado no frontend
                "timeline_start": op.get("timeline_start", 0.0),
                "targetClipId": op.get("target_clip_id"),
                "alternatives": alts,
                "origin": "ai"
            })

        final_response = "Operação concluída."
        if messages:
            last_msg = messages[-1]
            if last_msg.get("role") == "assistant" and last_msg.get("content"):
                final_response = last_msg.get("content")

        return {
            "response": final_response,
            "operations": ops_output,
            "suggestions": suggestions_output,
            # Se for direct, o frontend pode apenas engolir final_cuts para atualizar tudo em sync
            "final_cuts": final_cuts_frontend if not is_preview else clips,
            "final_tracks": final_tracks_frontend
        }
