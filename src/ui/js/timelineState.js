// Gerenciador de Estado da Timeline em Frames Absolutos (CapIAu-Talho)
// v2: Multipista dinâmica — o usuário cria quantas pistas quiser + pista de IA dedicada.
import { STATE } from "./state.js";

// --- UTILITÁRIOS DE CONVERSÃO DE TEMPO ---

/**
 * Converte frames para segundos.
 * @param {number} frames - Número de frames.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Segundos (float).
 */
export function framesToSeconds(frames, fps = 24) {
    return frames / fps;
}

/**
 * Converte segundos para frames (arredondado para inteiro).
 * @param {number} seconds - Segundos.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Frames (inteiro).
 */
export function secondsToFrames(seconds, fps = 24) {
    return Math.round(seconds * fps);
}

/**
 * Converte frames para Timecode formatado (HH:MM:SS:FF).
 * @param {number} totalFrames - Total de frames.
 * @param {number} fps - Taxa de quadros.
 * @returns {string} Timecode formatado.
 */
export function framesToTimecode(totalFrames, fps = 24) {
    if (isNaN(totalFrames) || totalFrames < 0) return "00:00:00:00";

    const h = Math.floor(totalFrames / (3600 * fps));
    let remaining = totalFrames % (3600 * fps);

    const m = Math.floor(remaining / (60 * fps));
    remaining = remaining % (60 * fps);

    const s = Math.floor(remaining / fps);
    const f = Math.round(remaining % fps);

    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * Converte um timecode formatado (HH:MM:SS:FF ou MM:SS) para frames.
 * @param {string} tc - String de timecode.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Frames.
 */
export function timecodeToFrames(tc, fps = 24) {
    if (!tc) return 0;
    const parts = tc.split(':').map(Number);
    if (parts.some(isNaN)) return 0;

    if (parts.length === 4) {
        // HH:MM:SS:FF
        const [h, m, s, f] = parts;
        return (h * 3600 + m * 60 + s) * fps + f;
    } else if (parts.length === 3) {
        // MM:SS:FF ou HH:MM:SS
        const [m, s, f] = parts;
        return (m * 60 + s) * fps + f;
    } else if (parts.length === 2) {
        // MM:SS
        const [m, s] = parts;
        return (m * 60 + s) * fps;
    }
    return 0;
}

// --- MODELO DE PISTAS ---

// Alturas por tipo de pista (px no canvas)
export const TRACK_HEIGHTS = { ai: 44, video: 72, audio: 56 };

/**
 * Pistas padrão (ordem do array = ordem visual de cima para baixo).
 * "AI" é a pista de sugestões: somente leitura, recebe os ghost clips.
 * "V1" é magnética (ripple) por padrão; "V2" é livre.
 */
function defaultTracks() {
    return [
        { id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, magnetic: false },
        { id: "V2", name: "B-Roll", kind: "video", volume: 1.0, muted: false, locked: false, magnetic: false },
        { id: "V1", name: "Falas", kind: "video", volume: 1.0, muted: false, locked: false, magnetic: true }
    ];
}

// --- CLASSE DE ESTADO DA TIMELINE ---

export class CapiauTimelineState {
    constructor() {
        this.fps = 24; // FPS padrão da timeline (conforme padrão do player)
        this.zoom = 0.5; // Pixels por frame (0.5px/frame = 12px/s em 24fps)
        this.scrollLeftFrame = 0; // Posição do scroll horizontal em frames
        this.scrollTop = 0; // Scroll vertical das pistas em pixels
        this.playheadFrame = 0; // Posição atual do cursor de reprodução em frames

        this.selectedClipId = null; // ID do clipe comum selecionado
        this.selectedTrack = "V1"; // Track focada ativa

        this.tracks = defaultTracks(); // Lista dinâmica de pistas (ordem visual)

        this.ghostTrack = []; // Lista de sugestões da IA (Ghost Clips)
        this.selectedGhostClipId = null; // ID da sugestão de IA ativa
        this.aiAnalysisRunning = false; // Flag de análise de IA em andamento
    }

    // ── PISTAS ──────────────────────────────────────────────────────────

    getTrack(id) {
        return this.tracks.find(t => t.id === id) || null;
    }

    /** Pistas de vídeo em ordem visual (de cima para baixo). */
    getVideoTracks() {
        return this.tracks.filter(t => t.kind === "video");
    }

    getAiTrack() {
        return this.tracks.find(t => t.kind === "ai") || null;
    }

    trackHeight(track) {
        return TRACK_HEIGHTS[track.kind] || TRACK_HEIGHTS.video;
    }

    /** Altura total ocupada por todas as pistas (px). */
    totalTracksHeight() {
        return this.tracks.reduce((sum, t) => sum + this.trackHeight(t), 0);
    }

    /** Substitui todo o conjunto de pistas (usado ao carregar timeline salva). */
    setTracks(tracks) {
        if (!Array.isArray(tracks) || tracks.length === 0) {
            this.tracks = defaultTracks();
        } else {
            // Normaliza e garante que exista uma pista de IA
            this.tracks = tracks.map(t => ({
                id: String(t.id),
                name: t.name || String(t.id),
                kind: t.kind || "video",
                volume: t.volume !== undefined ? Number(t.volume) : 1.0,
                muted: !!t.muted,
                locked: !!t.locked,
                magnetic: !!t.magnetic
            }));
            if (!this.tracks.some(t => t.kind === "ai")) {
                this.tracks.unshift({ id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, magnetic: false });
            }
        }
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    /** Adiciona uma nova pista de vídeo (logo abaixo da pista de IA). */
    addVideoTrack(name = null) {
        let n = 1;
        while (this.tracks.some(t => t.id === `V${n}`)) n++;
        const track = {
            id: `V${n}`,
            name: name || `V${n} Extra`,
            kind: "video",
            volume: 1.0,
            muted: false,
            locked: false,
            magnetic: false
        };
        // Insere abaixo da pista de IA (índice 1) para ficar no topo das pistas de vídeo
        const aiIdx = this.tracks.findIndex(t => t.kind === "ai");
        this.tracks.splice(aiIdx >= 0 ? aiIdx + 1 : 0, 0, track);
        STATE.emit("timelineTracksChanged", this.tracks);
        return track;
    }

    /** Remove uma pista (os clipes dela são movidos para a pista de vídeo mais próxima). */
    removeTrack(trackId) {
        const idx = this.tracks.findIndex(t => t.id === trackId);
        if (idx === -1) return false;
        const track = this.tracks[idx];
        if (track.kind === "ai") return false; // pista de IA é permanente
        if (this.getVideoTracks().length <= 1) return false; // sempre resta 1 pista de vídeo

        this.tracks.splice(idx, 1);
        const fallback = this.getVideoTracks()[this.getVideoTracks().length - 1];

        // Move os clipes órfãos
        const cuts = [...STATE.activeTimelineCuts];
        let moved = false;
        cuts.forEach(c => {
            if (c.track === trackId) {
                c.track = fallback.id;
                moved = true;
            }
        });
        STATE.emit("timelineTracksChanged", this.tracks);
        if (moved) STATE.activeTimelineCuts = cuts;
        else STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
        return true;
    }

    renameTrack(trackId, newName) {
        const track = this.getTrack(trackId);
        if (!track || !newName) return;
        track.name = newName.trim();
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    setTrackVolume(trackId, volume) {
        const track = this.getTrack(trackId);
        if (!track) return;
        track.volume = Math.max(0, Math.min(1, Number(volume)));
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackMute(trackId) {
        const track = this.getTrack(trackId);
        if (!track) return;
        track.muted = !track.muted;
        STATE.emit("timelineTracksChanged", this.tracks);
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackLock(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind === "ai") return;
        track.locked = !track.locked;
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    toggleTrackMagnetic(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind === "ai") return;
        track.magnetic = !track.magnetic;
        STATE.emit("timelineTracksChanged", this.tracks);
        // Reaplica o layout (o setter recalcula posições das pistas magnéticas)
        STATE.activeTimelineCuts = [...STATE.activeTimelineCuts];
    }

    /** Serializa as pistas para persistência/API. */
    serializeTracks() {
        return this.tracks.map((t, idx) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            order: idx,
            volume: t.volume,
            muted: t.muted,
            locked: t.locked,
            magnetic: t.magnetic
        }));
    }

    // ── SETTERS REATIVOS BÁSICOS ────────────────────────────────────────

    /**
     * Define o FPS do projeto/timeline.
     */
    setFps(val) {
        this.fps = Number(val) || 24;
        STATE.emit("timelineFpsChanged", this.fps);
    }

    /**
     * Define o nível de zoom.
     */
    setZoom(val) {
        // Limita o zoom entre 0.01 (100 frames por pixel) e 5.0 (5 pixels por frame)
        this.zoom = Math.max(0.01, Math.min(5.0, val));
        STATE.emit("timelineZoomChanged", this.zoom);
    }

    /**
     * Define o scroll horizontal em frames.
     */
    setScrollLeftFrame(val) {
        this.scrollLeftFrame = Math.max(0, Math.round(val));
        STATE.emit("timelineScrollChanged", this.scrollLeftFrame);
    }

    /**
     * Define o scroll vertical das pistas em pixels.
     */
    setScrollTop(val, viewportHeight = 0) {
        const maxScroll = Math.max(0, this.totalTracksHeight() - Math.max(0, viewportHeight));
        this.scrollTop = Math.max(0, Math.min(maxScroll, val));
        STATE.emit("timelineScrollChanged", this.scrollLeftFrame);
        STATE.emit("timelineVScrollChanged", this.scrollTop);
    }

    /**
     * Define a posição do playhead.
     */
    setPlayheadFrame(val) {
        this.playheadFrame = Math.max(0, val);
        STATE.emit("timelinePlayheadChanged", this.playheadFrame);
    }

    // ── CLIPES ──────────────────────────────────────────────────────────

    /**
     * Inicializa a lista de cortes com frames calculados se ainda não existirem.
     *
     * IMPORTANTE: frames de clipe são SEMPRE em fps da TIMELINE (não do vídeo fonte).
     * Misturar unidades fazia clipes de vídeos 30fps ocuparem mais timeline do que
     * têm de mídia (fim congelado) e desalinhava o playhead do Program.
     */
    conformCuts(cuts) {
        const fps = this.fps;
        return cuts.map((cut, index) => {
            const inFrame = cut.inFrame !== undefined ? cut.inFrame : secondsToFrames(cut.in, fps);
            const outFrame = cut.outFrame !== undefined ? cut.outFrame : secondsToFrames(cut.out, fps);

            return {
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: cut.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : framesToSeconds(inFrame, fps),
                out: cut.out !== undefined ? cut.out : framesToSeconds(outFrame, fps),
                track: cut.track || "V1",
                timelineStartFrame: cut.timelineStartFrame
            };
        });
    }

    /**
     * Adiciona um novo corte à timeline de forma compatível e reativa.
     */
    addCut(videoId, inSec, outSec, track = null) {
        const video = STATE.allVideos.find(v => v.id === videoId);

        // Pista inexistente/travada vira roteamento automático
        if (track) {
            const t = this.getTrack(track);
            if (!t || t.kind !== "video") track = null;
        }

        // Sem pista definida: entrevistas vão para a pista magnética (falas);
        // b-rolls para a pista livre mais próxima da base (ex: V2, não uma V3 recém-criada no topo)
        if (!track) {
            const videoTracks = this.getVideoTracks();
            const magnetic = videoTracks.find(t => t.magnetic);
            const freeTracks = videoTracks.filter(t => !t.magnetic && !t.locked);
            const free = freeTracks.length ? freeTracks[freeTracks.length - 1] : null;
            if (video && video.video_type === "broll" && free) {
                track = free.id;
            } else {
                track = (magnetic || videoTracks[videoTracks.length - 1] || { id: "V1" }).id;
            }
        }

        const inFrame = secondsToFrames(inSec, this.fps);
        const outFrame = secondsToFrames(outSec, this.fps);

        const newCut = {
            id: `cut_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            video_id: videoId,
            inFrame: inFrame,
            outFrame: outFrame,
            in: inSec,
            out: outSec,
            track: track
        };

        const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
        currentCuts.push(newCut);

        // Atualiza o estado global reativo
        STATE.activeTimelineCuts = currentCuts;
        return newCut;
    }

    // ── SUGESTÕES DE IA (GHOST CLIPS) ───────────────────────────────────

    /**
     * Define as sugestões fantasma da IA (renderizadas na pista de IA).
     */
    setGhostSuggestions(suggestions) {
        const videoTracks = this.getVideoTracks();
        const fallbackTrack = videoTracks.length ? videoTracks[0].id : "V2";

        this.ghostTrack = suggestions.map((s, index) => {
            const fps = this.fps;
            const inFrame = s.inFrame !== undefined ? s.inFrame : secondsToFrames(s.in, fps);
            const outFrame = s.outFrame !== undefined ? s.outFrame : secondsToFrames(s.out, fps);

            return {
                id: s.id || `ghost_${index}_${Date.now()}`,
                video_id: s.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: s.in !== undefined ? s.in : framesToSeconds(inFrame, fps),
                out: s.out !== undefined ? s.out : framesToSeconds(outFrame, fps),
                timelineStartFrame: s.timelineStartFrame !== undefined
                    ? Math.round(s.timelineStartFrame)
                    : secondsToFrames(s.timeline_start_s || 0, this.fps),
                track: this.getTrack(s.track) ? s.track : fallbackTrack, // pista de DESTINO ao aceitar
                action: s.action || "INSERT", // "INSERT", "DELETE", "REPLACE"
                reason: s.reason || "Recomendação semântica da IA",
                persona: s.persona || null,
                targetClipId: s.targetClipId || s.target_clip_id || null // Para exclusões ou substituições
            };
        });
        STATE.emit("timelineGhostUpdated", this.ghostTrack);
    }

    /**
     * Aceita uma sugestão da IA e a integra como corte real na pista de destino.
     */
    acceptGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;

        const suggestion = this.ghostTrack[index];
        const currentCuts = this.conformCuts(STATE.activeTimelineCuts);

        if (suggestion.action === "INSERT") {
            // Insere o clipe na trilha de destino, na posição sugerida
            currentCuts.push({
                id: `cut_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: suggestion.video_id,
                inFrame: suggestion.inFrame,
                outFrame: suggestion.outFrame,
                in: suggestion.in,
                out: suggestion.out,
                track: suggestion.track,
                timelineStartFrame: suggestion.timelineStartFrame
            });
        } else if (suggestion.action === "DELETE" && suggestion.targetClipId) {
            // Remove o clipe alvo
            const targetIdx = currentCuts.findIndex(c => c.id === suggestion.targetClipId);
            if (targetIdx !== -1) {
                currentCuts.splice(targetIdx, 1);
            }
        } else if (suggestion.action === "REPLACE" && suggestion.targetClipId) {
            // Substitui o clipe alvo
            const targetIdx = currentCuts.findIndex(c => c.id === suggestion.targetClipId);
            if (targetIdx !== -1) {
                currentCuts[targetIdx] = {
                    id: `cut_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                    video_id: suggestion.video_id,
                    inFrame: suggestion.inFrame,
                    outFrame: suggestion.outFrame,
                    in: suggestion.in,
                    out: suggestion.out,
                    track: suggestion.track,
                    timelineStartFrame: currentCuts[targetIdx].timelineStartFrame
                };
            }
        }

        // Remove da lista de sugestões
        this.ghostTrack.splice(index, 1);

        // Emite eventos
        STATE.activeTimelineCuts = currentCuts;
        STATE.emit("timelineGhostUpdated", this.ghostTrack);
    }

    /**
     * Rejeita e descarta uma sugestão de IA.
     */
    rejectGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;

        this.ghostTrack.splice(index, 1);
        STATE.emit("timelineGhostUpdated", this.ghostTrack);
    }
}

export const TIMELINE_STATE = new CapiauTimelineState();
window.TIMELINE_STATE = TIMELINE_STATE;
