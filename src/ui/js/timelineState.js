// Gerenciador de Estado da Timeline em Frames Absolutos (CapIAu-Talho)
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

// --- CLASSE DE ESTADO DA TIMELINE ---

export class CapiauTimelineState {
    constructor() {
        this.fps = 24; // FPS padrão da timeline (conforme padrão do player)
        this.zoom = 0.5; // Pixels por frame (0.5px/frame = 12px/s em 24fps)
        this.scrollLeftFrame = 0; // Posição do scroll horizontal em frames
        this.playheadFrame = 0; // Posição atual do cursor de reprodução em frames
        
        this.selectedClipId = null; // ID do clipe comum selecionado
        this.selectedTrack = "V1"; // Track focada ativa ("V1", "V2" ou "Ghost")
        
        this.ghostTrack = []; // Lista de sugestões da IA (Ghost Clips)
        this.selectedGhostClipId = null; // ID da sugestão de IA ativa
        
        // Volumes e Mutes de Trilha
        this.trackVolumes = { V1: 1.0, V2: 1.0 };
        this.trackMuted = { V1: false, V2: false };
    }

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
     * Define a posição do playhead.
     */
    setPlayheadFrame(val) {
        this.playheadFrame = Math.max(0, val);
        STATE.emit("timelinePlayheadChanged", this.playheadFrame);
    }

    /**
     * Inicializa a lista de cortes com frames calculados se ainda não existirem.
     */
    conformCuts(cuts) {
        return cuts.map((cut, index) => {
            const video = STATE.allVideos.find(v => v.id === cut.video_id);
            const videoFps = video && video.fps ? video.fps : this.fps;
            
            const inFrame = cut.inFrame !== undefined ? cut.inFrame : secondsToFrames(cut.in, videoFps);
            const outFrame = cut.outFrame !== undefined ? cut.outFrame : secondsToFrames(cut.out, videoFps);
            
            return {
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: cut.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : framesToSeconds(inFrame, videoFps),
                out: cut.out !== undefined ? cut.out : framesToSeconds(outFrame, videoFps),
                track: cut.track || "V1"
            };
        });
    }

    /**
     * Adiciona um novo corte à timeline de forma compatível e reativa.
     */
    addCut(videoId, inSec, outSec, track = "V1") {
        const video = STATE.allVideos.find(v => v.id === videoId);
        const videoFps = video && video.fps ? video.fps : this.fps;
        
        const inFrame = secondsToFrames(inSec, videoFps);
        const outFrame = secondsToFrames(outSec, videoFps);
        
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

    /**
     * Define as sugestões fantasma da IA.
     */
    setGhostSuggestions(suggestions) {
        this.ghostTrack = suggestions.map((s, index) => {
            const video = STATE.allVideos.find(v => v.id === s.video_id);
            const videoFps = video && video.fps ? video.fps : this.fps;
            
            const inFrame = s.inFrame !== undefined ? s.inFrame : secondsToFrames(s.in, videoFps);
            const outFrame = s.outFrame !== undefined ? s.outFrame : secondsToFrames(s.out, videoFps);
            
            return {
                id: s.id || `ghost_${index}_${Date.now()}`,
                video_id: s.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: s.in !== undefined ? s.in : framesToSeconds(inFrame, videoFps),
                out: s.out !== undefined ? s.out : framesToSeconds(outFrame, videoFps),
                track: s.track || "V2", // sugestões de b-roll por padrão vão para V2
                action: s.action || "INSERT", // "INSERT", "DELETE", "REPLACE"
                reason: s.reason || "Recomendação semântica da IA",
                targetClipId: s.targetClipId || null // Para exclusões ou substituições
            };
        });
        STATE.emit("timelineGhostUpdated", this.ghostTrack);
    }

    /**
     * Aceita uma sugestão da IA e a integra como corte real na timeline principal.
     */
    acceptGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;
        
        const suggestion = this.ghostTrack[index];
        const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
        
        if (suggestion.action === "INSERT") {
            // Insere o clipe na trilha correta
            currentCuts.push({
                id: `cut_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: suggestion.video_id,
                inFrame: suggestion.inFrame,
                outFrame: suggestion.outFrame,
                in: suggestion.in,
                out: suggestion.out,
                track: suggestion.track
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
                    track: suggestion.track
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
