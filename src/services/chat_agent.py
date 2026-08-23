"""Serviço de Agente de Edição NLE (Fase 1) com suporte a Function-Calling e Cópia-Sombra."""
import json
import time
import random
import copy
import math
import requests
from typing import List, Dict, Any, Optional
from pathlib import Path

from src.media import audio_analysis, audio_chain

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

    # -- Ferramentas de audio do agente (BRIEFING8): contrato E1 ---------------
    # Formato EXATO que o painel usa para o ajuste ao vivo
    # (timelineInteraction.js, _audioAoVivoDefaults/_construirEfeitoAudioAoVivo):
    # um unico objeto por tipo dentro de clip.effects, campos chapados + disabled.
    # Os limites sao os mesmos clamps dos sliders do painel; divergir aqui faria
    # o efeito gravado pelo agente ser re-clampado (ou recusado) pela UI.
    LIMITES_AUDIO_AO_VIVO = {
        "hpf": (0.0, 300.0), "low": (-12.0, 12.0), "mid": (-12.0, 12.0),
        "high": (-12.0, 12.0), "gate_db": (-90.0, -20.0), "comp_ratio": (1.0, 20.0),
        "comp_thresh_db": (-60.0, 0.0), "makeup_db": (-12.0, 12.0),
    }
    CAMPOS_INTEIROS_AUDIO_AO_VIVO = frozenset(("hpf", "gate_db", "comp_thresh_db"))
    DEFAULTS_AUDIO_EQ = {"type": "audio_eq", "hpf": 80, "low": 0, "mid": 0,
                         "high": 0, "disabled": False}
    DEFAULTS_AUDIO_DYNAMICS = {"type": "audio_dynamics", "gate_db": -45,
                               "comp_ratio": 2.0, "comp_thresh_db": -18,
                               "makeup_db": 0, "disabled": False}

    def encontrar_clip(self, clip_id: str) -> Optional[Dict[str, Any]]:
        """Clipe pelo id (ou None), mesmo criterio das mutacoes acima."""
        return next((c for c in self.clips if c["id"] == clip_id), None)

    @staticmethod
    def _js_round(valor: float) -> float:
        """Arredonda como o Math.round do slider do painel: metades sobem."""
        return float(math.floor(float(valor) + 0.5))

    @classmethod
    def _clampar_audio_ao_vivo(cls, campo: str, bruto) -> Optional[float]:
        """Clampa ao intervalo E1 e aplica o passo do slider (inteiro em Hz/dBFS;
        0,5 em dB e na razao). Valor nao-numerico/NaN volta como None (ignorado)."""
        try:
            valor = float(bruto)
        except (TypeError, ValueError):
            return None
        if valor != valor:  # NaN
            return None
        limite = cls.LIMITES_AUDIO_AO_VIVO.get(campo)
        if not limite:
            return None
        valor = min(max(valor, limite[0]), limite[1])
        if campo in cls.CAMPOS_INTEIROS_AUDIO_AO_VIVO:
            return int(cls._js_round(valor))
        return cls._js_round(valor * 2.0) / 2.0

    def ajustar_audio_ao_vivo(self, clip_id: str, valores: Optional[Dict[str, Any]] = None,
                              reverter: Optional[str] = None) -> str:
        """Grava os efeitos audio_eq / audio_dynamics (contrato E1) no clipe.

        Reversivel por construcao: efeito vive em clip.effects, nao gera arquivo,
        nao renderiza nada e `reverter` remove. Quando o alvo e um clipe de video
        vinculado, aplica no PARCEIRO DE AUDIO, exatamente como o painel faz
        (timelineInteraction.js redireciona as secoes volume/eq/dinamica)."""
        clip = self.encontrar_clip(clip_id)
        if not clip:
            return f"Erro: Clipe {clip_id} não encontrado."
        if self.is_track_locked(clip["track"]):
            return "Erro: Pista travada."

        # Redireciona ao PARCEIRO DE AUDIO quando o alvo e um clipe de video
        # vinculado - mesmo comportamento do painel (timelineInteraction.js,
        # secoes volume/audio_eq/audio_dynamics), para o efeito valer no som.
        if self.get_track_kind(clip["track"]) == "video" and clip["link_id"]:
            parceiro = next((c for c in self.clips
                             if c["link_id"] == clip["link_id"]
                             and self.get_track_kind(c["track"]) == "audio"), None)
            if parceiro:
                clip = parceiro

        destinos_reverter = {"eq": ("audio_eq",), "dinamica": ("audio_dynamics",),
                             "todos": ("audio_eq", "audio_dynamics")}
        if reverter:
            tipos = destinos_reverter.get(reverter)
            if not tipos:
                return ("Erro: 'reverter' aceita apenas: "
                        f"{', '.join(sorted(destinos_reverter))}.")
            clip["effects"] = [e for e in clip.setdefault("effects", [])
                               if not (isinstance(e, dict) and e.get("type") in tipos)]
            return "success"

        if not valores:
            return ("Erro: informe ao menos um parametro de audio (hpf, low, mid, "
                    "high, gate_db, comp_ratio, comp_thresh_db, makeup_db).")

        alterados = 0
        for campo, bruto in valores.items():
            if campo not in self.LIMITES_AUDIO_AO_VIVO:
                continue
            pronto = self._clampar_audio_ao_vivo(campo, bruto)
            if pronto is None:
                continue
            tipo = "audio_eq" if campo in ("hpf", "low", "mid", "high") else "audio_dynamics"
            padrao = dict(self.DEFAULTS_AUDIO_EQ if tipo == "audio_eq"
                          else self.DEFAULTS_AUDIO_DYNAMICS)
            efeitos = clip.setdefault("effects", [])
            i = next((k for k, e in enumerate(efeitos)
                      if isinstance(e, dict) and e.get("type") == tipo), -1)
            if i >= 0 and isinstance(efeitos[i], dict):
                padrao.update(efeitos[i])
            padrao[campo] = pronto
            if i >= 0:
                efeitos[i] = padrao
            else:
                efeitos.append(padrao)
            alterados += 1

        if not alterados:
            return ("Erro: nenhum parametro valido recebido. Campos aceitos: "
                    f"{', '.join(sorted(self.LIMITES_AUDIO_AO_VIVO))}.")
        return "success"

# --- SERVIÇO DO AGENTE DE CHAT ---

# -- Ferramentas de audio do agente (BRIEFING8) --------------------------------
# O agente conversava sobre audio mas nao enxergava nada: add_effect so tem
# fades/volume/speed. Aqui ele passa a MEDIR (pre-analise da ETAPA 1), EXPLICAR
# e PEDIR tratamento, com as travas que o dono exige:
#   - previa de 15 s e o DEFAULT; render completo so com confirmacao explicita
#     do usuario na conversa (confirmacao_usuario=true junto de previa=false);
#   - motor Auphonic NUNCA parte do agente: gasta a cota gratuita de 2 h/mes.
#     O agente recomenda e explica; quem aperta o botao e o usuario no painel;
#   - corte automatico de silencio/hesitacao NAO existe nas cadeias desta casa
#     (CADEIA_ORDEM nao tem passo de silencio) e nenhuma ferramenta aqui inventa.
# Medicao e render NAO sao reimplementados: src/media/audio_analysis.py mede,
# src/media/audio_chain.py monta/roda a cadeia, e o cache e a MESMA tabela
# audio_render do painel, tocada pelos proprios helpers de src/api/routes/media.py
# (import TARDIO dentro das funcoes: aquele modulo arrasta cv2/fastapi e seria
# peso morto no import deste servico).

# Teto padrao de janela para analise DENTRO do chat (segundos). E menor que o
# teto do painel (2400 s la): aqui a analise roda presa ao turno da conversa e
# o usuario fica olhando spinner. Configuravel em audio.analise.teto_agente_s;
# cai neste default enquanto a chave nao existir no registro.
AGENTE_ANALISE_TETO_S_PADRAO = 300.0
# Velocidades medidas (plano secoes 5-6 e briefing), so para o TEXTO de custo;
# nenhuma logica de controle depende delas.
FFMPEG_VEZES_TEMPO_REAL_MIN = 31.0
FFMPEG_VEZES_TEMPO_REAL_MAX = 44.0
DENOISE_IA_VEZES_TEMPO_REAL = 0.7
# Momentos de estouro que entram no retorno da analise (o total vai junto;
# envelope/momentos completos ficam de fora: estouram a janela do LLM).
AGENTE_MOMENTOS_EXEMPLO_MAX = 5


def _duracao_legivel(segundos: float) -> str:
    """Segundos -> texto humano pt-BR ('90 s' | '4,5 min'), sem unicode solto."""
    segundos = max(0.0, float(segundos))
    if segundos < 120.0:
        return f"{segundos:.0f} s"
    return f"{segundos / 60.0:.1f}".replace(".", ",") + " min"


# Texto fixo por preset (mesma voz do glossario: linguagem simples primeiro).
# Chave ausente => preset sem texto (nao deveria acontecer; PRESETS_CADEIA manda).
AGENTE_TEXTO_PRESETS = {
    "so_entrega": (
        "preset 'so_entrega': ajusta o volume medio para o alvo da casa "
        "(-16 LUFS, o quanto o som fica alto na media) e segura o pico em "
        "-1,5 dBTP com limitador, sem mexer no timbre."
    ),
    "resgate_estourado": (
        "preset 'resgate_estourado': repara o clipping (amostras cortadas no "
        "topo da onda), tira ruido por FFT e entrega no alvo de volume com "
        "limitador. E o caso da entrevista estourada."
    ),
    "ambiencia_preservada": (
        "preset 'ambiencia_preservada': denoise leve de 6 dB (para nao matar o "
        "som do lugar) e ajuste de volume; SEM compressor de fala e SEM "
        "limitador. Para plano de rua/feira."
    ),
    "previa_rapida": (
        "preset 'previa_rapida': so o ajuste de volume (loudnorm em 2 passes); "
        "serve para ouvir rapidamente como fica a entrega."
    ),
}

class ChatAgentService:
    """Orquestrador do loop de Agente de Edição com function-calling via OpenRouter."""

    # Nomes das ferramentas de audio; o despacho do laco usa este conjunto.
    FERRAMENTAS_AUDIO = frozenset((
        "analisar_audio", "sugerir_tratamento_audio",
        "aplicar_tratamento_audio", "ajustar_audio_ao_vivo",
    ))

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
        },
        {
            "type": "function",
            "function": {
                "name": "analisar_audio",
                "description": (
                    "Mede o audio REAL do trecho do clipe com ffmpeg (com cache na tabela "
                    "audio_render) e devolve o diagnostico: loudness medio (LUFS), pico real "
                    "(dBTP), clipping, piso de ruido, dinamica (LRA), correlacao entre canais, "
                    "selos de severidade, preset sugerido e onde estourou. Somente medicao: "
                    "nao altera nada no projeto."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe na timeline (ex: cut_...)."}
                    },
                    "required": ["clip_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "sugerir_tratamento_audio",
                "description": (
                    "A partir da medicao do trecho, explica em portugues simples o que o material "
                    "tem de problema, qual preset resolve, quanto tempo custa (ffmpeg roda a 31-44x "
                    "o tempo do trecho; denoise por IA a ~0,7x) e o que o tratamento NAO resolve. "
                    "NAO aplica nada. Use antes de aplicar_tratamento_audio."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe na timeline (ex: cut_...)."}
                    },
                    "required": ["clip_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "aplicar_tratamento_audio",
                "description": (
                    "Dispara o tratamento de audio do trecho do clipe e gera um WAV tratado em "
                    "data/audio_tratado (o original NUNCA e tocado; nada muda na timeline). REGRAS "
                    "INEGOCIAVEIS: 1) previa de 15 s e o PADRAO e roda sincrona/barata; render "
                    "completo so com confirmacao_usuario=true depois de pedido explicito do usuario. "
                    "2) O motor de nuvem Auphonic NAO pode ser escolhido pelo agente (gasta a cota "
                    "gratuita de 2 h/mes do dono): recomende e deixe o USUARIO acionar no painel. "
                    "3) Nenhum preset corta silencio ou hesitacao."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe na timeline (ex: cut_...)."},
                        "preset": {
                            "type": "string",
                            "enum": sorted(audio_chain.PRESETS_CADEIA),
                            "description": ("Preset local de tratamento (fonte da verdade: "
                                            "PRESETS_CADEIA em src/media/audio_chain.py). 'auphonic' "
                                            "NAO e opcao aqui: recusa automatica.")
                        },
                        "previa": {
                            "type": "boolean",
                            "description": ("DEFAULT true: renderiza so 15 s a partir do inicio do "
                                            "clipe (sincrono, custa segundos) para o usuario ouvir o A/B.")
                        },
                        "confirmacao_usuario": {
                            "type": "boolean",
                            "description": ("Deve vir true junto de previa=false SOMENTE depois que o "
                                            "usuario pedir explicitamente o render completo na conversa. "
                                            "Sem ela o render completo e recusado.")
                        }
                    },
                    "required": ["clip_id", "preset"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "ajustar_audio_ao_vivo",
                "description": (
                    "Grava no clipe os efeitos AO VIVO e REVERSIVEIS do contrato E1: audio_eq "
                    "(corte de graves/HPF e bandas de grave, medio e agudo) e audio_dynamics "
                    "(gate, compressor, limiar e ganho/makeup). Nao gera arquivo e nao renderiza "
                    "nada; o player aplica na hora e o usuario pode reverter no painel ou pedindo "
                    "'reverter'. Nunca liga corte automatico de silencio ou hesitacao."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "clip_id": {"type": "string", "description": "ID do clipe na timeline (ex: cut_...)."},
                        "hpf": {"type": "integer", "minimum": 0, "maximum": 300,
                                "description": "Corte de graves em Hz (HPF); tira o rumble. 0 = desligado."},
                        "low": {"type": "number", "minimum": -12, "maximum": 12,
                                "description": "Ganho dos graves em dB (-12 a +12)."},
                        "mid": {"type": "number", "minimum": -12, "maximum": 12,
                                "description": "Ganho dos medios em dB (-12 a +12)."},
                        "high": {"type": "number", "minimum": -12, "maximum": 12,
                                 "description": "Ganho dos agudos em dB (-12 a +12)."},
                        "gate_db": {"type": "integer", "minimum": -90, "maximum": -20,
                                    "description": "Gate em dBFS: abaixo deste nivel o som muda. -90 = desligado."},
                        "comp_ratio": {"type": "number", "minimum": 1, "maximum": 20,
                                       "description": "Razao do compressor (ex: 2 = 2:1, suave)."},
                        "comp_thresh_db": {"type": "integer", "minimum": -60, "maximum": 0,
                                           "description": "Limiar do compressor em dBFS."},
                        "makeup_db": {"type": "number", "minimum": -12, "maximum": 12,
                                      "description": "Ganho de compensacao (makeup) apos comprimir, em dB."},
                        "reverter": {
                            "type": "string",
                            "enum": ["eq", "dinamica", "todos"],
                            "description": "Remove os efeitos gravados: 'eq', 'dinamica' ou 'todos'."
                        }
                    },
                    "required": ["clip_id"]
                }
            }
        }
    ]

    # ---- Implementacao das ferramentas de audio (BRIEFING8) ------------------

    @staticmethod
    def _contexto_clipe_audio(project_id: int, shadow_timeline: "TimelineShadowCopy",
                              clip_id: Optional[str]) -> tuple:
        """Resolve clipe + linha do video no banco. Devolve (ctx, None) ou (None, erro)."""
        if not clip_id:
            return None, "clip_id e obrigatorio."
        clip = shadow_timeline.encontrar_clip(str(clip_id))
        if not clip:
            return None, f"Clipe {clip_id} nao encontrado na timeline atual."
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, filename, filepath, duration, project_id FROM video WHERE id = ?",
                (int(clip["video_id"]),),
            )
            linha = cursor.fetchone()
        if not linha:
            return None, (f"O video {clip['video_id']} do clipe {clip_id} "
                          "nao esta mais no banco do projeto.")
        video = {chave: linha[chave] for chave in linha.keys()}
        in_s = float(clip["in"])
        out_s = float(clip["out"])
        if out_s <= in_s:
            return None, (f"Janela invalida no clipe {clip_id}: "
                          f"fim ({out_s:g}s) <= inicio ({in_s:g}s).")
        return {
            "clip": clip, "video": video, "video_id": int(clip["video_id"]),
            "in_s": in_s, "out_s": out_s,
            "duracao_s": out_s - in_s,
            # O video pode pertencer a outro projeto; settings seguem o DELE.
            "project_id": video.get("project_id", project_id),
        }, None

    @staticmethod
    def _teto_analise_agente(project_id: Optional[int]) -> float:
        """Teto de janela para analise dentro do chat; chave ausente -> default."""
        try:
            return float(SettingsService.get_settings(project_id).get("audio.analise.teto_agente_s"))
        except (KeyError, TypeError, ValueError):
            return AGENTE_ANALISE_TETO_S_PADRAO

    @staticmethod
    def _medidas_compactas(diag: Dict[str, Any]) -> Dict[str, Any]:
        """So as medicoes que interessam a conversa, com apelidos legiveis."""
        chaves = (
            ("lufs_i", "loudness_lufs"), ("true_peak_db", "pico_real_dbtp"),
            ("lra", "dinamica_lra"), ("rms_db", "rms_db"), ("peak_db", "pico_amostra_db"),
            ("noise_floor_db", "piso_ruido_db"), ("clip_pct", "clipping_pct"),
            ("stereo_corr", "correlacao_canais"), ("crest_factor", "crest_factor"),
        )
        return {apelido: diag.get(chave) for chave, apelido in chaves}

    @staticmethod
    def _diagnostico_do_clipe(project_id: int, shadow_timeline: "TimelineShadowCopy",
                              clip_id: Optional[str]) -> str:
        """Mede (ou le do cache da audio_render) o trecho do clipe.

        Reaproveita SEM reimplementar: analisar_intervalo/avaliar vem de
        src/media/audio_analysis.py e o cache e tocado pelos helpers da rota
        (mesmo hash 'analysis|...', mesma tabela). Retorna JSON compacto em uma
        string - envelope/momentos completos ficam de fora (so contagens), porque
        a serie inteira nao cabe na conversa."""
        ctx, erro = ChatAgentService._contexto_clipe_audio(project_id, shadow_timeline, clip_id)
        if erro:
            return f"Erro: {erro}"
        if ctx["duracao_s"] > ChatAgentService._teto_analise_agente(ctx["project_id"]):
            teto = ChatAgentService._teto_analise_agente(ctx["project_id"])
            return (
                f"Erro: o trecho do clipe tem {_duracao_legivel(ctx['duracao_s'])} e a analise "
                f"dentro do chat fica limitada a {_duracao_legivel(teto)} para nao travar a "
                f"conversa (chave audio.analise.teto_agente_s). Sugira ao usuario medir um trecho "
                f"representativo pelo painel de Ajustes de Audio, ou divida o clipe e analise "
                f"uma parte."
            )

        from src.api.routes.media import (
            ANALISE_AUDIO_CACHE_TETO_BYTES, _audio_cache_gravar, _audio_cache_obter,
            _fonte_disponivel, _hash_analise_audio, _json_seguro_para_resposta,
            _limiares_audio,
        )

        cached = False
        with get_db() as conn:
            chain_hash = _hash_analise_audio(ctx["video_id"], ctx["in_s"], ctx["out_s"])
            linha = _audio_cache_obter(conn, ctx["video_id"], chain_hash)
            diag = None
            if linha and linha["analysis_json"]:
                try:
                    diag = json.loads(linha["analysis_json"])
                    cached = True
                except ValueError:
                    diag = None  # cache corrompido: remeasure em vez de mentir
            fonte = (diag or {}).get("fonte")
            if diag is None:
                fonte = _fonte_disponivel(ctx["video"], ctx["video_id"])
                if fonte is None:
                    return (
                        f"Erro: nem o original ({ctx['video'].get('filepath')}) nem o proxy local "
                        f"estao acessiveis para medir o clipe {ctx['clip']['id']}. Peca ao usuario "
                        f"ligar o HD do acervo ou gerar o proxy do video."
                    )
                origem = (Path(ctx["video"]["filepath"]) if fonte == "original"
                          else CONFIG.PROXIES_DIR / f"proxy_vid_{ctx['video_id']}.mp4")
                diag_medido = audio_analysis.analisar_intervalo(origem, ctx["in_s"], ctx["out_s"])
                if not diag_medido.get("ok"):
                    return (f"Erro: a medicao falhou: "
                            f"{diag_medido.get('erro') or 'ffmpeg nao devolveu dados de audio'}.")
                diag_medido["fonte"] = fonte
                analysis_json = json.dumps(diag_medido)
                if len(analysis_json.encode("utf-8")) <= ANALISE_AUDIO_CACHE_TETO_BYTES:
                    _audio_cache_gravar(conn, ctx["video_id"], ctx["in_s"], ctx["out_s"],
                                        chain_hash, analysis_json)
                diag = diag_medido

        avaliacao = audio_analysis.avaliar(diag, _limiares_audio(ctx["project_id"]))
        momentos_estouro = [m for m in (diag.get("momentos") or [])
                            if isinstance(m, dict) and m.get("tipo") == "estouro"]
        resposta = {
            "ok": True,
            "clipe": {"id": ctx["clip"]["id"], "video_id": ctx["video_id"],
                      "filename": ctx["video"].get("filename"),
                      "janela_s": [round(ctx["in_s"], 3), round(ctx["out_s"], 3)],
                      "duracao_s": round(ctx["duracao_s"], 3)},
            "fonte": fonte, "cached": cached,
            "medidas": ChatAgentService._medidas_compactas(diag),
            "avaliacao": {
                "selos": [{"metrica": s.get("metrica"), "severidade": s.get("severidade"),
                           "texto": s.get("texto")} for s in avaliacao.get("selos", [])],
                "preset_sugerido": avaliacao.get("preset_sugerido"),
                "cadeia_sugerida": avaliacao.get("cadeia_sugerida", []),
            },
            "estouros": {"total": len(momentos_estouro),
                         "exemplos": momentos_estouro[:AGENTE_MOMENTOS_EXEMPLO_MAX]},
        }
        return json.dumps(_json_seguro_para_resposta(resposta), ensure_ascii=False)

    @staticmethod
    def _texto_custo_tempo(duracao_s: float, cadeia: List[str]) -> str:
        """Custo humano em tempo, com os fatores medidos (so texto de custo)."""
        partes = [
            f"Tempo de processamento local: de {_duracao_legivel(duracao_s / FFMPEG_VEZES_TEMPO_REAL_MAX)} "
            f"a {_duracao_legivel(duracao_s / FFMPEG_VEZES_TEMPO_REAL_MIN)} "
            "(o ffmpeg roda a 31-44x o tempo do trecho)."
        ]
        if any(str(p).split(":")[0] == "denoise_ia" for p in cadeia):
            partes.append(
                f"A etapa de denoise por IA roda a ~0,7x o tempo real "
                f"({_duracao_legivel(duracao_s / DENOISE_IA_VEZES_TEMPO_REAL)} so ela)."
            )
        return " ".join(partes)

    @staticmethod
    def _tool_sugerir_tratamento_audio(project_id: int, shadow_timeline: "TimelineShadowCopy",
                                       clip_id: Optional[str]) -> str:
        """Explica o diagnostico e o preset em portugues; NAO aplica nada."""
        bruto = ChatAgentService._diagnostico_do_clipe(project_id, shadow_timeline, clip_id)
        try:
            dados = json.loads(bruto)
        except ValueError:
            return bruto  # era mensagem de erro, segue como veio
        if not dados.get("ok"):
            return bruto

        av = dados["avaliacao"]
        selos = av.get("selos", [])
        graves = [s["texto"] for s in selos if s.get("severidade") == "grave"]
        atencoes = [s["texto"] for s in selos if s.get("severidade") == "atencao"]
        bons = [s["texto"] for s in selos if s.get("severidade") == "ok"]

        linhas = []
        if graves:
            linhas.append("GRAVE no material: " + "; ".join(graves) + ".")
        if atencoes:
            linhas.append("Chama atencao: " + "; ".join(atencoes) + ".")
        if bons and not graves and not atencoes:
            linhas.append("Boa noticia: " + "; ".join(bons) + ". Nada urgente aqui.")

        preset = av.get("preset_sugerido")
        if preset:
            linhas.append("O que resolve: " + AGENTE_TEXTO_PRESETS.get(
                preset, f"preset '{preset}' (veja PRESETS_CADEIA)."))
            linhas.append(ChatAgentService._texto_custo_tempo(
                float(dados["clipe"]["duracao_s"]), av.get("cadeia_sugerida") or []))
        else:
            linhas.append(
                "Nenhum tratamento necessario agora: o material ja esta dentro do alvo da casa "
                "(-16 LUFS de loudness medio, pico abaixo de -1,5 dBTP). Se quiser conferir a "
                "entrega mesmo assim, o 'previa_rapida' custa segundos.")

        limites = []
        medidas = dados.get("medidas", {})
        if (medidas.get("clipping_pct") or 0.0) > 0 or (medidas.get("pico_real_dbtp") or -99) > 0:
            limites.append(
                "o reparo de clipping reconstrui as amostras cortadas, mas distorcao forte que ja "
                "ficou gravada no arquivo nao volta 100% - ouca a previa antes de apostar nela")
        if (medidas.get("piso_ruido_db") is not None
                and medidas.get("piso_ruido_db") != float("-inf")
                and medidas.get("piso_ruido_db", -99) > -35.0):
            limites.append(
                "o denoise classico segura cerca de 12 dB de ruido; ruido muito acima disso pede "
                "denoise por IA (mais lento) ou nuvem")
        if (medidas.get("dinamica_lra") is not None and medidas.get("dinamica_lra") < 5.0):
            limites.append("dinamica esmagada nao se recria; o tratamento evita comprimir ainda mais")
        if medidas.get("correlacao_canais") is not None and medidas.get("correlacao_canais") >= 0.95:
            limites.append("canais identicos (mono duplicado) continuam mono; nada vira estereo verdadeiro")
        if limites:
            linhas.append("O que o tratamento NAO resolve: " + "; ".join(limites) + ".")
        linhas.append(
            "Regra da casa: nenhum tratamento corta silencio ou hesitacao automaticamente "
            "(decisao editorial do documentario) - isso segue manual.")

        if graves or preset == "resgate_estourado":
            linhas.append(
                "Para um caso assim existe tambem o motor de nuvem (Auphonic), que costuma se sair "
                "melhor em captacao estourada/ruidosa. Mas ele gasta a cota gratuita do dono "
                "(2 horas por mes), entao eu NAO aciono por conta propria: sugira ao usuario ligar "
                "o radio 'Auphonic' no painel de Ajustes de Audio se quiser usar a nuvem.")

        linhas.append(
            "Decisao: peca-me 'aplica a previa' (15 s, custa segundos) para ouvir o A/B; o render "
            "completo do trecho so roda com confirmacao explicita sua.")
        return "\n".join(linhas)

    @staticmethod
    def _recusa_auphonic(preset_bruto: str) -> str:
        """Mensagem fixa de recusa do motor de nuvem (regra do dono)."""
        return (
            f"Recusado: '{preset_bruto}' e o motor de NUVEM (Auphonic) e o agente NAO pode aciona-lo - "
            "cada minuto enviado consome a cota gratuita do dono (2 horas por mes, que nao renovam "
            "por uso). Recomendacao: para material estourado ou muito ruidoso o Auphonic costuma "
            "ficar melhor que o ffmpeg local; explique isso ao usuario e peca que ELE ligue o radio "
            "'Auphonic' no painel de Ajustes de Audio (Configuracoes > Modelos & Chaves guarda a "
            "chave). Enquanto isso, ofereca um preset LOCAL (so_entrega, resgate_estourado, "
            "ambiencia_preservada, previa_rapida) - nada foi enviado para a nuvem."
        )

    @staticmethod
    def _tool_aplicar_tratamento_audio(project_id: int, shadow_timeline: "TimelineShadowCopy",
                                       args: Dict[str, Any]) -> str:
        """Dispara o tratamento via audio_chain + cache audio_render (contrato F2).

        previa=true (DEFAULT) renderiza 15 s sincronos; render completo exige
        confirmacao_usuario=true e entra na fila do TaskManager (nunca trava o
        request). Auphonic recusado sempre."""
        clip_id = args.get("clip_id")
        ctx, erro = ChatAgentService._contexto_clipe_audio(project_id, shadow_timeline, clip_id)
        if erro:
            return f"Erro: {erro}"

        preset_bruto = str(args.get("preset") or "").strip()
        if preset_bruto.lower() in ("auphonic", "nuvem", "cloud"):
            return ChatAgentService._recusa_auphonic(preset_bruto)
        presets_validos = sorted(audio_chain.PRESETS_CADEIA)
        if preset_bruto not in audio_chain.PRESETS_CADEIA:
            return (
                f"Erro: preset desconhecido '{preset_bruto}'. Validos (locais): "
                f"{', '.join(presets_validos)}. O motor de nuvem (Auphonic) nao e opcao do agente: "
                f"gasta a cota gratuita do dono - recomende e deixe o USUARIO acionar no painel."
            )

        previa = args.get("previa", True)
        previa = True if previa is None else bool(previa)

        from src.api.routes.media import (
            PREVIA_AUDIO_S, _diag_antes_do_cache, _fonte_disponivel, _ref_audio_tratado,
            _render_cache_gravar, _render_cache_obter, _task_key_render, _tarefa_render_audio,
            _wav_do_render,
        )

        fonte = _fonte_disponivel(ctx["video"], ctx["video_id"])
        if fonte is None:
            return (
                f"Erro: nem o original ({ctx['video'].get('filepath')}) nem o proxy local estao "
                f"acessiveis para processar o clipe {ctx['clip']['id']}. Peca ao usuario ligar o HD "
                f"do acervo ou gerar o proxy."
            )
        origem = (Path(ctx["video"]["filepath"]) if fonte == "original"
                  else CONFIG.PROXIES_DIR / f"proxy_vid_{ctx['video_id']}.mp4")

        try:
            cadeia = audio_chain.normalizar_cadeia(dict(audio_chain.PRESETS_CADEIA[preset_bruto]))
        except (KeyError, TypeError, ValueError) as err:
            return f"Erro: o montador de cadeia recusou o preset '{preset_bruto}': {err}"

        out_base = ctx["out_s"]
        in_s = ctx["in_s"]
        out_final = min(out_base, in_s + PREVIA_AUDIO_S) if previa else out_base

        if not previa and not bool(args.get("confirmacao_usuario")):
            duracao_total = out_base - in_s
            return (
                f"Confirmacao necessaria: o render completo de {_duracao_legivel(duracao_total)} ocupa "
                f"a maquina por cerca de {_duracao_legivel(duracao_total / FFMPEG_VEZES_TEMPO_REAL_MAX)} "
                f"a {_duracao_legivel(duracao_total / FFMPEG_VEZES_TEMPO_REAL_MIN)} "
                "(ffmpeg a 31-44x o tempo do trecho). Nada foi iniciado. Se o usuario ja pediu o "
                "render completo na conversa, reenvie com previa=false e confirmacao_usuario=true; "
                "senao, ofereca primeiro a previa de 15 s."
            )

        chain_hash = audio_chain.hash_cadeia(ctx["video_id"], in_s, out_final, cadeia)
        path_ref = _ref_audio_tratado(ctx["video_id"], chain_hash)

        with get_db() as conn:
            linha = _render_cache_obter(conn, ctx["video_id"], chain_hash)
            if linha is not None and linha["status"] == "ready":
                wav_ok = False
                if linha["path"] == path_ref:
                    try:
                        wav_ok = _wav_do_render(ctx["video_id"], chain_hash).exists()
                    except ValueError:
                        wav_ok = False
                if wav_ok:
                    return (
                        f"Ja estava pronto (cache): '{preset_bruto}' sobre "
                        f"{_duracao_legivel(out_final - in_s)} do clipe {ctx['clip']['id']} -> "
                        f"{path_ref}. Nada foi recalculado; o usuario pode ouvir o A/B pelo player."
                    )
            elif linha is not None and linha["status"] in ("pending", "running"):
                return (
                    f"Este render ('{preset_bruto}', hash {chain_hash[:12]}) ja esta em andamento "
                    f"(status: {linha['status']}). Nao duplicuei a fila; acompanhe pela tela de Tarefas."
                )

        if previa:
            dest = _wav_do_render(ctx["video_id"], chain_hash)
            dest.parent.mkdir(parents=True, exist_ok=True)
            resultado = audio_chain.renderizar(origem, dest, in_s, out_final, cadeia)
            if not resultado.get("ok"):
                erro_render = resultado.get("erro") or "ffmpeg terminou sem sucesso e sem mensagem."
                with get_db() as conn:
                    _render_cache_gravar(conn, ctx["video_id"], in_s, out_final, chain_hash,
                                         cadeia, path_ref, "failed",
                                         json.dumps({"antes": None, "depois": None,
                                                     "erro": erro_render}))
                return f"Erro: a previa falhou ({erro_render}). Nada foi aplicado ao projeto."

            diag_depois = audio_analysis.analisar_intervalo(dest)
            with get_db() as conn:
                bloco = {
                    "antes": _diag_antes_do_cache(conn, ctx["video_id"], in_s, out_final),
                    "depois": diag_depois if diag_depois.get("ok") else None,
                    "render": {"duracao_render_s": resultado.get("duracao_render_s"),
                               "medidas_loudnorm": resultado.get("medidas_loudnorm")},
                }
                if not diag_depois.get("ok"):
                    bloco["aviso_analise"] = diag_depois.get("erro")
                _render_cache_gravar(conn, ctx["video_id"], in_s, out_final, chain_hash,
                                     cadeia, path_ref, "ready", json.dumps(bloco))

            antes = (bloco.get("antes") or {})
            resumo_ab = ""
            if antes.get("lufs_i") is not None and diag_depois.get("lufs_i") is not None:
                resumo_ab = (f" A/B desta janela: loudness {antes['lufs_i']:g} LUFS -> "
                             f"{diag_depois['lufs_i']:g} LUFS; pico real "
                             f"{antes.get('true_peak_db', float('nan')):g} -> "
                             f"{diag_depois.get('true_peak_db', float('nan')):g} dBTP.")
            return (
                f"Previa de 15 s pronta: preset '{preset_bruto}' sobre o inicio do clipe "
                f"{ctx['clip']['id']} -> {path_ref}.{resumo_ab} O original nao foi tocado e a "
                f"timeline nao mudou. Para o trecho inteiro, precisa do ok explicito do usuario "
                f"(render completo) ou do botao do painel."
            )

        # Render completo: enfileira como o botao do painel faz (TaskManager),
        # gravando ANTES a linha pending que o worker/tarefa consome.
        task_key = _task_key_render(ctx["video_id"], chain_hash)
        with get_db() as conn:
            _render_cache_gravar(conn, ctx["video_id"], in_s, out_final, chain_hash,
                                 cadeia, path_ref, "pending")
        from src.core.tasks import TASK_MANAGER
        TASK_MANAGER.executor.submit(_tarefa_render_audio, ctx["video_id"], origem,
                                     in_s, out_final, cadeia, chain_hash, task_key)
        return (
            f"Render completo ENFILEIRADO: preset '{preset_bruto}' sobre "
            f"{_duracao_legivel(out_final - in_s)} do clipe {ctx['clip']['id']} "
            f"(tarefa {task_key}; estimativa de "
            f"{_duracao_legivel((out_final - in_s) / FFMPEG_VEZES_TEMPO_REAL_MAX)} a "
            f"{_duracao_legivel((out_final - in_s) / FFMPEG_VEZES_TEMPO_REAL_MIN)}). "
            f"Acompanhe na tela de Tarefas; o WAV sai em {path_ref}."
        )

    @staticmethod
    def _despachar_ferramenta_de_audio(func_name: str, project_id: int,
                                       shadow_timeline: "TimelineShadowCopy",
                                       args: Dict[str, Any]) -> str:
        """Roteia UMA chamada de ferramenta de audio para sua implementacao.

        Separado do laco gigante de proposito: assim o roteamento e testavel sem
        LLM/rede (o autoteste chama este metodo diretamente com dubles)."""
        if func_name == "analisar_audio":
            return ChatAgentService._diagnostico_do_clipe(project_id, shadow_timeline,
                                                          args.get("clip_id"))
        if func_name == "sugerir_tratamento_audio":
            return ChatAgentService._tool_sugerir_tratamento_audio(project_id, shadow_timeline,
                                                                   args.get("clip_id"))
        if func_name == "aplicar_tratamento_audio":
            return ChatAgentService._tool_aplicar_tratamento_audio(project_id, shadow_timeline, args)
        if func_name == "ajustar_audio_ao_vivo":
            valores = {campo: args[campo]
                       for campo in TimelineShadowCopy.LIMITES_AUDIO_AO_VIVO if campo in args}
            return shadow_timeline.ajustar_audio_ao_vivo(args.get("clip_id"), valores=valores,
                                                         reverter=args.get("reverter"))
        return f"Erro: ferramenta de audio desconhecida: {func_name}"

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
        index_status = "ok"
        index_warning = None
        try:
            search_meta = RAGService.search_hybrid(project_id, message, limit=10, return_meta=True)
            raw_results = search_meta["results"]
            index_status = search_meta["index_status"]
            index_warning = search_meta["warning"]
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
        if index_status != "ok":
            context_str += f"\n\n[AVISO DE SISTEMA: o índice de busca do acervo está indisponível agora ({index_warning or 'motivo desconhecido'}). Informe o usuário, de forma breve, que sugestões de mídia podem estar limitadas até o índice voltar.]"

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
                        "final_tracks": tracks,
                        "index_status": index_status,
                        "warning": index_warning
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
                        search_meta = RAGService.search_hybrid(project_id, q, media_type=mtype, limit=8, return_meta=True)
                        if search_meta["index_status"] != "ok":
                            tool_result = (
                                f"Índice de busca indisponível agora ({search_meta['warning'] or 'motivo desconhecido'}). "
                                "Nenhum resultado de mídia pode ser retornado neste momento — avise o usuário."
                            )
                        else:
                            # Simplifica o retorno para economizar tokens
                            simplified = []
                            for h in search_meta["results"]:
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

                    elif func_name in ChatAgentService.FERRAMENTAS_AUDIO:
                        tool_result = ChatAgentService._despachar_ferramenta_de_audio(
                            func_name, project_id, shadow_timeline, args
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
                    "final_tracks": tracks,
                    "index_status": index_status,
                    "warning": index_warning
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
            "final_tracks": final_tracks_frontend,
            "index_status": index_status,
            "warning": index_warning
        }
