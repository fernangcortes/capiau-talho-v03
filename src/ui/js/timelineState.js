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

    const fpsVal = Number(fps) > 0 ? Number(fps) : 24;
    const totalIntFrames = Math.max(0, Math.round(Number(totalFrames) || 0));
    const totalSeconds = Math.floor(totalIntFrames / fpsVal);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const f = Math.min(Math.floor(fpsVal) - 1, Math.max(0, Math.floor(totalIntFrames % fpsVal)));

    const pad = (n) => String(Math.floor(Math.abs(Number(n) || 0))).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * Converte frames para timecode adaptativo de régua (omite horas zeradas e quadros quando distante).
 * @param {number} totalFrames - Total de frames.
 * @param {number} fps - Taxa de quadros.
 * @param {boolean} showFrames - Se deve incluir o sufixo :FF de quadros.
 * @param {boolean} forceHours - Se deve forçar o prefixo HH: de horas mesmo se 0.
 * @returns {string} Timecode formatado para régua.
 */
export function formatRulerTimecode(totalFrames, fps = 24, showFrames = false, forceHours = false) {
    if (isNaN(totalFrames) || totalFrames < 0) totalFrames = 0;

    const fpsVal = Number(fps) > 0 ? Number(fps) : 24;
    const totalIntFrames = Math.max(0, Math.round(Number(totalFrames) || 0));
    const totalSeconds = Math.floor(totalIntFrames / fpsVal);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const f = Math.min(Math.floor(fpsVal) - 1, Math.max(0, Math.floor(totalIntFrames % fpsVal)));

    const pad = (n) => String(Math.floor(Math.abs(Number(n) || 0))).padStart(2, '0');

    let result = "";
    if (h > 0 || forceHours) {
        result += `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
        result += `${pad(m)}:${pad(s)}`;
    }

    if (showFrames) {
        result += `:${pad(f)}`;
    }

    return result;
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

// --- CURVAS DE TRANSIÇÃO (FADES) ---

export const FADE_CURVE_PRESETS = {
    linear: { id: "linear", name: "Linear", label: "Linear" },
    exponential: { id: "exponential", name: "Exponencial (Ease-In)", label: "Exponencial" },
    logarithmic: { id: "logarithmic", name: "Logarítmica (Ease-Out)", label: "Logarítmica" },
    s_curve: { id: "s_curve", name: "Curva em S (Suave)", label: "Curva em S" }
};

/**
 * Avalia o valor de atenuação do fade [0.0 a 1.0] dado um progresso p [0.0 a 1.0].
 * 0.0 = silêncio / preto total; 1.0 = ganho / opacidade plena.
 * Suporta presets e ajuste paramétrico contínuo de tensão k [-1.0 a +1.0].
 *
 * @param {number} progress - Progresso normalizado [0..1]
 * @param {string} [curveType="linear"] - Tipo de curva ("linear", "exponential", "logarithmic", "s_curve", "custom")
 * @param {number} [tension=0.0] - Tensão da curva [-1..1] (0 = padrão da curva ou linear)
 * @returns {number} Fator atenuado [0..1]
 */
export function evaluateFadeCurve(progress, curveType = "linear", tension = 0.0) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const k = Math.max(-1, Math.min(1, Number(tension) || 0));

    if (curveType === "s_curve") {
        // Base Hermite Smoothstep: 3p^2 - 2p^3
        const baseS = p * p * (3 - 2 * p);
        if (Math.abs(k) < 0.01) return baseS;
        // Modulação da curva em S pela tensão
        if (k > 0) {
            const exp = 1 + k * 1.5;
            return Math.pow(baseS, 1 / exp);
        } else {
            const exp = 1 + Math.abs(k) * 1.5;
            return Math.pow(baseS, exp);
        }
    }

    if (curveType === "exponential") {
        // Curva côncava (ease-in / subida íngreme no final)
        const exp = 2.0 + Math.abs(k) * 2.0;
        return Math.pow(p, exp);
    }

    if (curveType === "logarithmic") {
        // Curva convexa (ease-out / resposta logarítmica de volume natural)
        const exp = 2.0 + Math.abs(k) * 2.0;
        return 1.0 - Math.pow(1.0 - p, exp);
    }

    // Linear ou custom baseado em tensão contínua
    if (Math.abs(k) < 0.01) {
        return p;
    } else if (k > 0) {
        // Tensão positiva: dobra para cima (convexa / logarítmica)
        const exp = 1.0 / (1.0 + k * 2.5);
        return Math.pow(p, exp);
    } else {
        // Tensão negativa: dobra para baixo (côncava / exponencial)
        const exp = 1.0 + Math.abs(k) * 2.5;
        return Math.pow(p, exp);
    }
}

// --- MODELO DE PISTAS ---

// Alturas por tipo de pista (px no canvas)
export const TRACK_HEIGHTS = { ai: 44, video: 72, audio: 48 };

// Duração padrão (segundos) de uma foto (still) ao ser inserida na timeline.
export const PHOTO_DEFAULT_DURATION = 5;

/**
 * Pistas padrão (ordem do array = ordem visual de cima para baixo).
 * "AI" é a pista de sugestões: somente leitura, recebe os ghost clips.
 * "V1" é magnética (ripple) por padrão; "V2" é livre.
 * "A1"/"A2" são pistas de áudio reais: recebem o áudio vinculado (link_id)
 * dos clipes de vídeo, com trims independentes (L-cuts / J-cuts).
 */
function defaultTracks() {
    return [
        { id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, syncLocked: false, hidden: false, thumbnailsEnabled: false },
        { id: "V2", name: "B-Roll", kind: "video", volume: 1.0, muted: false, locked: false, syncLocked: true, hidden: false, thumbnailsEnabled: true },
        { id: "V1", name: "Falas", kind: "video", volume: 1.0, muted: false, locked: false, syncLocked: true, hidden: false, thumbnailsEnabled: true },
        { id: "A1", name: "Áudio Falas", kind: "audio", volume: 1.0, muted: false, locked: false, syncLocked: true, hidden: false, thumbnailsEnabled: false },
        { id: "A2", name: "Áudio B-Roll", kind: "audio", volume: 1.0, muted: false, locked: false, syncLocked: true, hidden: false, thumbnailsEnabled: false }
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
        this.selectedGap = null; // Gap selecionado: { trackId, startFrame, endFrame, durationFrames }
        this.snappingEnabled = true; // Encaixe magnético global ativo por padrão

        this.width = 1920; // Largura padrão da sequência (Fase 1)
        this.height = 1080; // Altura padrão da sequência (Fase 1)
        this.previewZoom = "fit"; // Zoom de visualização (Fase 1)
        this.previewPanX = 0; // Posição horizontal de pan do preview
        this.previewPanY = 0; // Posição vertical de pan do preview

        this.tracks = defaultTracks(); // Lista dinâmica de pistas (ordem visual)
        this.trackHeightScale = 1.0; // Fator de escala vertical das pistas (compacto ↔ alto)

        this.hoverPreviewEnabled = true;
        this.globalThumbnailsInterval = 1.0; // 1.0 para alta densidade, 2.0 para média densidade
        this.muteHiddenTracksPlayback = true;

        this.ghostTrack = []; // Lista de sugestões da IA (Ghost Clips)
        this.selectedGhostClipId = null; // ID da sugestão de IA ativa
        this.aiAnalysisRunning = false; // Flag de análise de IA em andamento

        this.markers = []; // Lista de marcadores na timeline [{ id, frame, label, color, comment }]
        this.hoveredMarkerId = null; // ID do marcador sobre o qual o mouse está iterando (para mostrar rótulo no hover)
        this.selectedMarkerIds = new Set(); // Conjunto de IDs de marcadores selecionados na timeline

        // Manipulador de Fade ativo no hover ({ clipId, side: "in"|"out", type: "duration"|"curve" })
        this.hoveredFadeHandle = null;
    }

    /** Atalho reativo para a lista ativa de cortes na timeline. */
    get cuts() {
        return (STATE && STATE.activeTimelineCuts) || [];
    }

    // ── MARCADORES DA TIMELINE ──────────────────────────────────────────

    /**
     * Retorna a lista de marcadores ordenada por frame (atualizando posições de marcadores vinculados a clipes).
     */
    getMarkersSorted() {
        const cuts = STATE.activeTimelineCuts || [];
        const fps = this.fps || 24;
        this.markers.forEach(m => {
            if (m.clipId) {
                let cut = cuts.find(c => String(c.id) === String(m.clipId));
                if (!cut) {
                    // Fallback se o ID do clipe foi re-gerado ao carregar: localiza o clipe por intersecção de frame
                    cut = cuts.find(c => {
                        const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                        const inF = c.inFrame !== undefined ? c.inFrame : Math.round((c.in || 0) * fps);
                        const outF = c.outFrame !== undefined ? c.outFrame : Math.round((c.out || 0) * fps);
                        const dur = Math.max(1, outF - inF);
                        return m.frame >= start && m.frame <= start + dur;
                    });
                    if (cut) {
                        const start = cut.timelineStartFrame !== undefined ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * fps);
                        m.clipId = cut.id;
                        m.offsetFrame = Math.max(0, Math.round(m.frame - start));
                    }
                }
                if (cut) {
                    const start = cut.timelineStartFrame !== undefined ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * fps);
                    m.frame = start + (m.offsetFrame || 0);
                }
            }
        });
        return [...this.markers].sort((a, b) => a.frame - b.frame);
    }

    /**
     * Seleciona ou deseleciona marcadores (suporta seleção única e múltipla com Shift).
     */
    selectMarker(id, multi = false) {
        if (!multi) {
            this.selectedMarkerIds.clear();
        }
        if (id) {
            if (multi && this.selectedMarkerIds.has(id)) {
                this.selectedMarkerIds.delete(id);
            } else {
                this.selectedMarkerIds.add(id);
            }
        }
        STATE.emit("timelineMarkersChanged", this.markers);
    }

    /**
     * Limpa a seleção de marcadores.
     */
    clearSelectedMarkers() {
        if (this.selectedMarkerIds.size > 0) {
            this.selectedMarkerIds.clear();
            STATE.emit("timelineMarkersChanged", this.markers);
        }
    }

    /**
     * Remove todos os marcadores atualmente selecionados em lote.
     */
    removeSelectedMarkers() {
        if (this.selectedMarkerIds.size === 0) return 0;
        const count = this.selectedMarkerIds.size;
        const idsToRemove = new Set(this.selectedMarkerIds);
        this.markers = this.markers.filter(m => !idsToRemove.has(m.id));
        this.selectedMarkerIds.clear();
        STATE.emit("timelineMarkersChanged", this.markers);
        return count;
    }

    /**
     * Retorna um marcador existente próximo a um frame específico dentro da tolerância.
     */
    getMarkerAtFrame(frame, toleranceFrames = 3) {
        return this.getMarkersSorted().find(m => Math.abs(m.frame - frame) <= toleranceFrames) || null;
    }

    /**
     * Retorna o marcador por ID.
     */
    getMarker(id) {
        return this.markers.find(m => m.id === id) || null;
    }

    /**
     * Retorna o próximo marcador após o frame informado.
     */
    getNextMarker(currentFrame) {
        const sorted = this.getMarkersSorted();
        return sorted.find(m => m.frame > currentFrame) || null;
    }

    /**
     * Retorna o marcador anterior ao frame informado.
     */
    getPrevMarker(currentFrame) {
        const sorted = this.getMarkersSorted();
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (sorted[i].frame < currentFrame) return sorted[i];
        }
        return null;
    }

    /**
     * Adiciona um novo marcador na timeline (auto-vincula ao clipe sob o frame se houver).
     */
    addMarker({ frame = this.playheadFrame, label = "", color = "#06b6d4", comment = "", clipId = undefined, offsetFrame = null } = {}) {
        const existing = this.getMarkerAtFrame(frame, 2);
        if (existing) {
            this.selectMarker(existing.id, false);
            return existing;
        }

        const id = `marker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const markerCount = this.markers.length + 1;
        const finalLabel = label || `Marcador ${markerCount}`;

        let finalClipId = clipId;
        let finalOffset = offsetFrame;

        // Se clipId não foi explicitamente passado, auto-vincula ao clipe sob o frame se houver
        if (finalClipId === undefined) {
            const cuts = STATE.activeTimelineCuts || [];
            const fps = this.fps || 24;
            const videoCuts = cuts.filter(c => c.type !== "audio" && (!c.track || !String(c.track).toLowerCase().startsWith("a")));
            const searchCuts = videoCuts.length > 0 ? videoCuts : cuts;
            
            const cutUnder = searchCuts.find(c => {
                const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                const inF = c.inFrame !== undefined ? c.inFrame : Math.round((c.in || 0) * fps);
                const outF = c.outFrame !== undefined ? c.outFrame : Math.round((c.out || 0) * fps);
                const dur = Math.max(1, outF - inF);
                return frame >= start && frame <= start + dur;
            });

            if (cutUnder) {
                const start = cutUnder.timelineStartFrame !== undefined ? cutUnder.timelineStartFrame : Math.round((cutUnder.timeline_start || 0) * fps);
                finalClipId = cutUnder.id;
                finalOffset = Math.max(0, Math.round(frame - start));
            } else {
                finalClipId = null;
                finalOffset = null;
            }
        }

        const marker = {
            id,
            frame: Math.max(0, Math.round(frame)),
            label: finalLabel,
            color: color || "#06b6d4",
            comment: comment || "",
            clipId: finalClipId,
            offsetFrame: finalOffset
        };

        this.markers.push(marker);
        this.selectMarker(id, false);
        STATE.emit("timelineMarkersChanged", this.markers);
        return marker;
    }

    /**
     * Atualiza dados de um marcador existente.
     */
    updateMarker(id, updates = {}) {
        const marker = this.getMarker(id);
        if (!marker) return null;

        if (updates.frame !== undefined) {
            marker.frame = Math.max(0, Math.round(updates.frame));
            if (marker.clipId) {
                const cuts = STATE.activeTimelineCuts || [];
                let cut = cuts.find(c => String(c.id) === String(marker.clipId));
                if (!cut) {
                    cut = cuts.find(c => marker.frame >= c.timelineStartFrame && marker.frame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
                    if (cut) marker.clipId = cut.id;
                }
                if (cut) {
                    marker.offsetFrame = Math.max(0, Math.round(marker.frame - cut.timelineStartFrame));
                }
            }
        }
        if (updates.label !== undefined) marker.label = updates.label;
        if (updates.color !== undefined) marker.color = updates.color;
        if (updates.comment !== undefined) marker.comment = updates.comment;

        if (updates.clipId !== undefined) {
            marker.clipId = updates.clipId;
            if (updates.clipId) {
                const cuts = STATE.activeTimelineCuts || [];
                let cut = cuts.find(c => String(c.id) === String(updates.clipId));
                if (!cut) {
                    const searchFrame = updates.frame !== undefined ? updates.frame : marker.frame;
                    cut = cuts.find(c => searchFrame >= c.timelineStartFrame && searchFrame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
                    if (cut) marker.clipId = cut.id;
                }
                if (cut) {
                    marker.offsetFrame = updates.offsetFrame !== undefined ? updates.offsetFrame : Math.max(0, Math.round((updates.frame !== undefined ? updates.frame : marker.frame) - cut.timelineStartFrame));
                }
            } else {
                marker.offsetFrame = null;
            }
        }

        STATE.emit("timelineMarkersChanged", this.markers);
        return marker;
    }

    /**
     * Remove um marcador pelo ID.
     */
    removeMarker(id) {
        const idx = this.markers.findIndex(m => m.id === id);
        if (idx !== -1) {
            const removed = this.markers.splice(idx, 1)[0];
            this.selectedMarkerIds.delete(id);
            STATE.emit("timelineMarkersChanged", this.markers);
            return removed;
        }
        return null;
    }

    /**
     * Define todos os marcadores (usado ao restaurar/carregar projeto).
     */
    setMarkers(markers = []) {
        if (!Array.isArray(markers)) {
            this.markers = [];
        } else {
            this.markers = markers.map(m => ({
                id: m.id || `marker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                frame: Math.max(0, Math.round(m.frame || 0)),
                label: m.label || "Marcador",
                color: m.color || "#06b6d4",
                comment: m.comment || "",
                clipId: m.clipId || null,
                offsetFrame: m.offsetFrame !== undefined ? m.offsetFrame : null
            }));
        }
        STATE.emit("timelineMarkersChanged", this.markers);
    }

    // ── PISTAS ──────────────────────────────────────────────────────────

    getTrack(id) {
        return this.tracks.find(t => t.id === id) || null;
    }

    /** Pistas de vídeo em ordem visual (de cima para baixo). */
    getVideoTracks() {
        return this.tracks.filter(t => t.kind === "video");
    }

    /** Pistas de áudio em ordem visual (de cima para baixo). */
    getAudioTracks() {
        return this.tracks.filter(t => t.kind === "audio");
    }

    getAiTrack() {
        return this.tracks.find(t => t.kind === "ai") || null;
    }

    /** Tipo (kind) da pista pelo id, com fallback "video" para pistas desconhecidas. */
    trackKindOf(trackId) {
        const t = this.getTrack(trackId);
        return t ? (t.kind || "video") : "video";
    }

    /**
     * Pista de áudio pareada de uma pista de vídeo (para onde vai o áudio vinculado):
     * V1→A1 por sufixo numérico; senão por índice (base→topo); senão a primeira de áudio.
     */
    pairedAudioTrackId(videoTrackId) {
        const audioTracks = this.getAudioTracks();
        if (!audioTracks.length) return null;
        const num = String(videoTrackId).replace(/\D/g, "");
        if (num) {
            const direct = audioTracks.find(t => t.id === `A${num}`);
            if (direct) return direct.id;
        }
        const videoTracks = this.getVideoTracks();
        const idxFromBottom = [...videoTracks].reverse().findIndex(t => t.id === videoTrackId);
        if (idxFromBottom >= 0 && idxFromBottom < audioTracks.length) return audioTracks[idxFromBottom].id;
        return audioTracks[0].id;
    }

    trackHeight(track) {
        if (track.hidden) {
            return 4; // Restore line height as per design system
        }
        const scale = this.trackHeightScale || 1.0;
        // Override por pista (arraste individual) ajusta a altura base (escala 1.0)
        if (track.heightPx != null && isFinite(track.heightPx)) {
            return Math.min(240, Math.max(22, Math.round(track.heightPx * scale)));
        }
        const base = TRACK_HEIGHTS[track.kind] || TRACK_HEIGHTS.video;
        // Aplica a escala vertical global, com piso para manter as pistas clicáveis/legíveis.
        return Math.max(22, Math.round(base * scale));
    }

    /**
     * Escala vertical GLOBAL das pistas (slider). Aplica escala a todas as pistas (inclusive com override).
     * Clampeia entre 0.5 (compacto) e 1.7 (alto) e re-renderiza pistas + cabeçalhos.
     */
    setTrackHeightScale(scale) {
        const clamped = Math.min(1.7, Math.max(0.5, scale));
        if (clamped === this.trackHeightScale) return;
        this.trackHeightScale = clamped;
        this.clampScrollTop();
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    /** Define a altura base (px em escala 1.0) de UMA pista específica (arraste individual). */
    setTrackHeight(trackId, px) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;
        const scale = this.trackHeightScale || 1.0;
        track.heightPx = Math.min(240, Math.max(22, Math.round(px / scale)));
        this.clampScrollTop();
        STATE.emit("timelineTracksChanged", this.tracks);
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
                syncLocked: t.syncLocked !== undefined ? !!t.syncLocked : (t.sync_locked !== undefined ? !!t.sync_locked : (t.kind !== "ai")),
                magnetic: !!t.magnetic,
                heightPx: t.heightPx != null ? Number(t.heightPx) : null,
                hidden: !!t.hidden,
                thumbnailsEnabled: t.thumbnailsEnabled !== undefined ? !!t.thumbnailsEnabled : (t.kind === "video" || !t.kind)
            }));
            if (!this.tracks.some(t => t.kind === "ai")) {
                this.tracks.unshift({ id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, syncLocked: false, hidden: false, thumbnailsEnabled: false });
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
            syncLocked: true,
            magnetic: false,
            hidden: false,
            thumbnailsEnabled: true
        };
        TIMELINE_HISTORY.record(() => {
            // Insere abaixo da pista de IA (índice 1) para ficar no topo das pistas de vídeo
            const aiIdx = this.tracks.findIndex(t => t.kind === "ai");
            this.tracks.splice(aiIdx >= 0 ? aiIdx + 1 : 0, 0, track);
            STATE.emit("timelineTracksChanged", this.tracks);
        });
        return track;
    }

    /** Adiciona uma nova pista de áudio (sempre na base da timeline). */
    addAudioTrack(name = null) {
        let n = 1;
        while (this.tracks.some(t => t.id === `A${n}`)) n++;
        const track = {
            id: `A${n}`,
            name: name || `Áudio ${n}`,
            kind: "audio",
            volume: 1.0,
            muted: false,
            locked: false,
            syncLocked: true,
            magnetic: false,
            hidden: false,
            thumbnailsEnabled: false
        };
        TIMELINE_HISTORY.record(() => {
            this.tracks.push(track);
            STATE.emit("timelineTracksChanged", this.tracks);
        });
        return track;
    }

    /** Remove uma pista (os clipes dela vão para a pista mais próxima do mesmo tipo). */
    removeTrack(trackId) {
        const idx = this.tracks.findIndex(t => t.id === trackId);
        if (idx === -1) return false;
        const track = this.tracks[idx];
        if (track.kind === "ai") return false; // pista de IA é permanente
        if (track.kind === "video" && this.getVideoTracks().length <= 1) return false; // sempre resta 1 pista de vídeo

        TIMELINE_HISTORY.record(() => {
            this.tracks.splice(idx, 1);
            const sameKind = this.tracks.filter(t => t.kind === track.kind);
            const fallback = sameKind.length ? sameKind[sameKind.length - 1] : null;

            let cuts = [...STATE.activeTimelineCuts];
            let changed = false;
            if (fallback) {
                // Move os clipes órfãos para outra pista do mesmo tipo
                cuts.forEach(c => {
                    if (c.track === trackId) {
                        c.track = fallback.id;
                        changed = true;
                    }
                });
            } else {
                // Última pista de áudio removida: clipes dela saem e os pares ficam desvinculados
                const removedLinks = new Set(cuts.filter(c => c.track === trackId && c.link_id).map(c => c.link_id));
                const before = cuts.length;
                cuts = cuts.filter(c => c.track !== trackId);
                changed = cuts.length !== before;
                cuts.forEach(c => {
                    if (c.link_id && removedLinks.has(c.link_id)) c.link_id = null;
                });
            }
            STATE.emit("timelineTracksChanged", this.tracks);
            if (changed) STATE.activeTimelineCuts = cuts;
            else STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
        });
        return true;
    }

    renameTrack(trackId, newName) {
        const track = this.getTrack(trackId);
        if (!track || !newName) return;
        TIMELINE_HISTORY.record(() => {
            track.name = newName.trim();
            STATE.emit("timelineTracksChanged", this.tracks);
        });
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

    toggleTrackVisibility(trackId) {
        const track = this.getTrack(trackId);
        if (!track) return;
        track.hidden = !track.hidden;
        STATE.emit("timelineTracksChanged", this.tracks);
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackThumbnails(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind !== "video") return;
        track.thumbnailsEnabled = !track.thumbnailsEnabled;
        STATE.emit("timelineTracksChanged", this.tracks);
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleHoverPreview(enabled) {
        this.hoverPreviewEnabled = enabled !== undefined ? !!enabled : !this.hoverPreviewEnabled;
    }

    setGlobalThumbnailsInterval(val) {
        this.globalThumbnailsInterval = Number(val) || 1.0;
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    setMuteHiddenTracksPlayback(enabled) {
        this.muteHiddenTracksPlayback = !!enabled;
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackSyncLock(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind === "ai") return;
        TIMELINE_HISTORY.record(() => {
            track.syncLocked = track.syncLocked !== undefined ? !track.syncLocked : false;
            STATE.emit("timelineTracksChanged", this.tracks);
        });
    }

    toggleTrackMagnetic(trackId) {
        // Redireciona para sync lock
        return this.toggleTrackSyncLock(trackId);
    }

    toggleSnapping(enabled) {
        this.snappingEnabled = enabled !== undefined ? !!enabled : !this.snappingEnabled;
        STATE.emit("timelineSnappingChanged", this.snappingEnabled);
        return this.snappingEnabled;
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
            syncLocked: t.syncLocked !== undefined ? !!t.syncLocked : (t.kind !== "ai"),
            sync_locked: t.syncLocked !== undefined ? !!t.syncLocked : (t.kind !== "ai"),
            magnetic: !!t.magnetic,
            hidden: !!t.hidden,
            thumbnailsEnabled: !!t.thumbnailsEnabled
        }));
    }

    // ── GAPS E CONTROLE DE RIPPLE / SYNC LOCK ────────────────────────────

    /**
     * Retorna a lista ordenada de gaps (espaços vazios) em uma pista.
     * @param {string} trackId - ID da pista.
     * @returns {Array<{ trackId: string, startFrame: number, endFrame: number, durationFrames: number }>}
     */
    getTrackGaps(trackId) {
        const cuts = (STATE.activeTimelineCuts || [])
            .filter(c => c.track === trackId)
            .sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));

        if (!cuts.length) return [];
        const gaps = [];

        // Gap inicial (se o primeiro clipe não começa no frame 0)
        const firstStart = cuts[0].timelineStartFrame || 0;
        if (firstStart > 0) {
            gaps.push({
                trackId,
                startFrame: 0,
                endFrame: firstStart,
                durationFrames: firstStart
            });
        }

        // Gaps intermediários entre clipes da pista
        for (let i = 0; i < cuts.length - 1; i++) {
            const current = cuts[i];
            const next = cuts[i + 1];
            const currentEnd = (current.timelineStartFrame || 0) + (current.outFrame - current.inFrame);
            const nextStart = next.timelineStartFrame || 0;

            if (nextStart > currentEnd) {
                gaps.push({
                    trackId,
                    startFrame: currentEnd,
                    endFrame: nextStart,
                    durationFrames: nextStart - currentEnd
                });
            }
        }

        return gaps;
    }

    /**
     * Retorna o gap sob determinado frame em uma pista (ou null se for ocupado por clipe).
     */
    getGapAt(frame, trackId) {
        if (!trackId) return null;
        const gaps = this.getTrackGaps(trackId);
        return gaps.find(g => frame >= g.startFrame && frame < g.endFrame) || null;
    }

    selectGap(gap) {
        this.selectedGap = gap;
        if (gap) {
            this.selectedClipId = null;
            this.selectedGhostClipId = null;
        }
        STATE.emit("timelineGapSelected", this.selectedGap);
    }

    clearSelectedGap() {
        if (this.selectedGap) {
            this.selectedGap = null;
            STATE.emit("timelineGapSelected", null);
        }
    }

    /**
     * Retorna os IDs das pistas que estão com Sync Lock ativo e não travadas.
     */
    getSyncLockedTrackIds() {
        return this.tracks
            .filter(t => t.kind !== "ai" && !t.locked && (t.syncLocked !== undefined ? t.syncLocked : true))
            .map(t => t.id);
    }

    /**
     * Ripple Delete de um Gap: fecha o espaço vazio puxando os clipes posteriores nas pistas sincronizadas.
     */
    rippleDeleteGap(trackId, startFrame, durationFrames) {
        if (!durationFrames || durationFrames <= 0) return;
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const syncTracks = this.getSyncLockedTrackIds();
            const targetTracks = Array.from(new Set([...syncTracks, trackId]));

            cuts.forEach(c => {
                if (targetTracks.includes(c.track) && (c.timelineStartFrame || 0) >= startFrame + durationFrames - 1) {
                    c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) - durationFrames);
                    c.timeline_start = c.timelineStartFrame / this.fps;
                }
            });

            this.clearSelectedGap();
            STATE.activeTimelineCuts = cuts;
        });
    }

    /**
     * Lift Delete de um clipe: apaga o clipe (e áudio vinculado) deixando o espaço vazio intacto.
     */
    liftDeleteClip(clipId) {
        const cuts = [...STATE.activeTimelineCuts];
        const idx = cuts.findIndex(c => c.id === clipId);
        if (idx === -1) return false;

        TIMELINE_HISTORY.record(() => {
            const clip = cuts[idx];
            const linkId = clip.link_id;
            if (linkId) {
                for (let i = cuts.length - 1; i >= 0; i--) {
                    if (cuts[i].link_id === linkId) cuts.splice(i, 1);
                }
            } else {
                cuts.splice(idx, 1);
            }
            if (this.selectedClipId === clipId) this.selectedClipId = null;
            STATE.activeTimelineCuts = cuts;
        });
        return true;
    }

    /**
     * Ripple Delete de um clipe: apaga o clipe e fecha o buraco em todas as pistas com Sync Lock.
     */
    rippleDeleteClip(clipId) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return false;

        TIMELINE_HISTORY.record(() => {
            const startFrame = clip.timelineStartFrame || 0;
            const durationFrames = clip.outFrame - clip.inFrame;
            const linkId = clip.link_id;
            const syncTracks = this.getSyncLockedTrackIds();

            if (linkId) {
                for (let i = cuts.length - 1; i >= 0; i--) {
                    if (cuts[i].link_id === linkId) cuts.splice(i, 1);
                }
            } else {
                const idx = cuts.findIndex(c => c.id === clipId);
                if (idx !== -1) cuts.splice(idx, 1);
            }

            // Puxa os clipes posteriores nas pistas sincronizadas
            cuts.forEach(c => {
                if (syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= startFrame + durationFrames - 1) {
                    c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) - durationFrames);
                    c.timeline_start = c.timelineStartFrame / this.fps;
                }
            });

            if (this.selectedClipId === clipId) this.selectedClipId = null;
            STATE.activeTimelineCuts = cuts;
        });
        return true;
    }

    /**
     * Inserção com Ripple: insere um clipe abrindo espaço nas pistas sincronizadas.
     */
    insertClipWithRipple(clipData, targetFrame, targetTrackId) {
        TIMELINE_HISTORY.record(() => {
            const cuts = this.conformCuts(STATE.activeTimelineCuts);
            const durationFrames = clipData.outFrame - clipData.inFrame;
            const syncTracks = this.getSyncLockedTrackIds();

            // 1. Desloca clipes posteriores
            cuts.forEach(c => {
                if (syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= targetFrame) {
                    c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) + durationFrames);
                    c.timeline_start = c.timelineStartFrame / this.fps;
                }
            });

            // 2. Insere clipe de vídeo e áudio vinculado
            const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const audioTrackId = this.pairedAudioTrackId(targetTrackId);
            const linkId = audioTrackId ? `link_${stamp}` : null;

            const newClip = {
                ...clipData,
                id: clipData.id || `cut_${stamp}`,
                track: targetTrackId,
                timelineStartFrame: targetFrame,
                timeline_start: targetFrame / this.fps,
                link_id: linkId
            };
            cuts.push(newClip);

            if (audioTrackId && clipData.type !== "photo") {
                cuts.push({
                    ...clipData,
                    id: `cut_${stamp}_a`,
                    track: audioTrackId,
                    timelineStartFrame: targetFrame,
                    timeline_start: targetFrame / this.fps,
                    link_id: linkId
                });
            }

            STATE.activeTimelineCuts = cuts;
        });
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
     * Re-clampeia o scrollTop baseado na altura total atual das pistas e na viewport.
     */
    clampScrollTop(viewportHeight = this.lastViewportHeight || 0) {
        if (viewportHeight > 0) this.lastViewportHeight = viewportHeight;
        const vh = this.lastViewportHeight || 0;
        const maxScroll = Math.max(0, this.totalTracksHeight() - vh);
        const clamped = Math.max(0, Math.min(maxScroll, this.scrollTop));
        if (clamped !== this.scrollTop) {
            this.scrollTop = clamped;
            STATE.emit("timelineVScrollChanged", this.scrollTop);
        }
    }

    /**
     * Define o scroll vertical das pistas em pixels.
     */
    setScrollTop(val, viewportHeight = this.lastViewportHeight || 0) {
        if (viewportHeight > 0) this.lastViewportHeight = viewportHeight;
        const vh = this.lastViewportHeight || 0;
        const maxScroll = Math.max(0, this.totalTracksHeight() - vh);
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
                ...cut,
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: cut.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : framesToSeconds(inFrame, fps),
                out: cut.out !== undefined ? cut.out : framesToSeconds(outFrame, fps),
                track: cut.track || "V1",
                timelineStartFrame: cut.timelineStartFrame,
                link_id: cut.link_id || null
            };
        });
    }

    /**
     * Adiciona um novo corte à timeline de forma compatível e reativa.
     */
    addCut(videoId, inSec, outSec, track = null, timelineStartFrame = null) {
        const video = STATE.allVideos.find(v => v.id === videoId);

        // Pista inexistente/travada vira roteamento automático
        if (track) {
            const t = this.getTrack(track);
            if (!t || t.kind !== "video" || t.locked) track = null;
        }

        // Sem pista definida: entrevistas vão para V1 (falas); b-rolls para V2
        if (!track) {
            const videoTracks = this.getVideoTracks().filter(t => !t.locked);
            const v2 = videoTracks.find(t => t.id === "V2");
            const v1 = videoTracks.find(t => t.id === "V1");
            if (video && video.video_type === "broll" && v2) {
                track = v2.id;
            } else {
                track = (v1 || videoTracks[0] || { id: "V1" }).id;
            }
        }
        // Auto-configuração no primeiro clipe de vídeo (Fase 2.3)
        if (STATE.activeTimelineCuts.length === 0 && video) {
            let w = 1920, h = 1080;
            if (video.resolution && video.resolution.includes("x")) {
                const parts = video.resolution.split("x").map(Number);
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    w = parts[0];
                    h = parts[1];
                }
            }
            const fps = parseFloat(video.fps) || 24;

            this.width = w;
            this.height = h;
            this.fps = fps;

            STATE.emit("timelineFpsChanged", this.fps);
            STATE.emit("timelinePropertiesChanged", { width: w, height: h, fps });
        }

        const inFrame = secondsToFrames(inSec, this.fps);
        const outFrame = secondsToFrames(outSec, this.fps);
        const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Par A/V: o áudio nasce vinculado (link_id) na pista de áudio pareada
        const audioTrackId = this.pairedAudioTrackId(track);
        const linkId = audioTrackId ? `link_${stamp}` : null;

        // Se timelineStartFrame não foi passado, anexa ao final dos clipes existentes na pista
        let startFrame = timelineStartFrame;
        if (startFrame === null || startFrame === undefined) {
            const trackCuts = (STATE.activeTimelineCuts || []).filter(c => c.track === track);
            startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
        }

        const newCut = {
            id: `cut_${stamp}`,
            type: "video",
            video_id: videoId,
            inFrame: inFrame,
            outFrame: outFrame,
            in: inSec,
            out: outSec,
            track: track,
            timelineStartFrame: Math.max(0, Math.round(startFrame)),
            timeline_start: Math.max(0, Math.round(startFrame)) / this.fps,
            link_id: linkId
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            currentCuts.push(newCut);
            if (audioTrackId) {
                currentCuts.push({
                    id: `cut_${stamp}_a`,
                    type: "video",
                    video_id: videoId,
                    inFrame: inFrame,
                    outFrame: outFrame,
                    in: inSec,
                    out: outSec,
                    track: audioTrackId,
                    timelineStartFrame: Math.max(0, Math.round(startFrame)),
                    timeline_start: Math.max(0, Math.round(startFrame)) / this.fps,
                    link_id: linkId
                });
            }

            // Atualiza o estado global reativo
            STATE.activeTimelineCuts = currentCuts;
        });
        return newCut;
    }

    /**
     * Adiciona uma FOTO (still) como clipe na timeline.
     * Fotos não têm faixa de áudio (link_id sempre null) e usam uma duração padrão
     * (ajustável depois pelo trim). Enquadramento default = "fill" (editável por clipe).
     */
    addPhotoCut(photoId, { durationSec = PHOTO_DEFAULT_DURATION, track = null, timelineStartFrame = null } = {}) {
        // Roteamento: fotos vão para uma pista de vídeo LIVRE (como B-roll V2); fallback = V1
        if (track) {
            const t = this.getTrack(track);
            if (!t || t.kind !== "video" || t.locked) track = null;
        }
        if (!track) {
            const videoTracks = this.getVideoTracks().filter(t => !t.locked);
            const v2 = videoTracks.find(t => t.id === "V2");
            const v1 = videoTracks.find(t => t.id === "V1");
            track = (v2 || v1 || videoTracks[0] || { id: "V1" }).id;
        }

        const dur = Math.max(0.1, Number(durationSec) || PHOTO_DEFAULT_DURATION);
        const outFrame = secondsToFrames(dur, this.fps);
        const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        let startFrame = timelineStartFrame;
        if (startFrame === null || startFrame === undefined) {
            const trackCuts = (STATE.activeTimelineCuts || []).filter(c => c.track === track);
            startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
        }

        const newCut = {
            id: `cut_${stamp}`,
            type: "photo",
            photo_id: photoId,
            video_id: null,
            inFrame: 0,
            outFrame: outFrame,
            in: 0,
            out: dur,
            track: track,
            timelineStartFrame: Math.max(0, Math.round(startFrame)),
            timeline_start: Math.max(0, Math.round(startFrame)) / this.fps,
            link_id: null,
            effects: [{ type: "fit", mode: "fill" }]
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            currentCuts.push(newCut);
            STATE.activeTimelineCuts = currentCuts;
        });
        return newCut;
    }

    /**
     * Migração A/V: garante que existam pistas de áudio e cria clipes de áudio
     * vinculados para clipes de vídeo sem par (timelines antigas v1/v2 sem áudio).
     */
    migrateCutsToAV(cuts) {
        if (!this.getAudioTracks().length) {
            this.tracks.push(
                { id: "A1", name: "Áudio Falas", kind: "audio", volume: 1.0, muted: false, locked: false, syncLocked: true, magnetic: false },
                { id: "A2", name: "Áudio B-Roll", kind: "audio", volume: 1.0, muted: false, locked: false, syncLocked: true, magnetic: false }
            );
            STATE.emit("timelineTracksChanged", this.tracks);
        }

        const result = [...cuts];
        cuts.forEach((cut, idx) => {
            // Fotos (stills) não têm áudio: nunca ganham par A/V
            if (this.trackKindOf(cut.track) !== "video" || cut.link_id || cut.type === "photo") return;
            const audioTrackId = this.pairedAudioTrackId(cut.track);
            if (!audioTrackId) return;
            const linkId = `link_migr_${idx}_${Date.now()}`;
            cut.link_id = linkId;
            result.push({
                ...cut,
                id: `${cut.id || `cut_migr_${idx}`}_a`,
                track: audioTrackId,
                link_id: linkId
            });
        });
        return result;
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
                type: s.type || "video",
                video_id: s.video_id ?? null,
                photo_id: s.photo_id ?? null,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: s.in !== undefined ? s.in : framesToSeconds(inFrame, fps),
                out: s.out !== undefined ? s.out : framesToSeconds(outFrame, fps),
                // O backend envia timelineStartFrame: null + posição em segundos
                // (timeline_start ou timeline_start_s) — null NÃO pode virar frame 0
                timelineStartFrame: (s.timelineStartFrame !== undefined && s.timelineStartFrame !== null)
                    ? Math.round(s.timelineStartFrame)
                    : secondsToFrames(
                        (s.timeline_start_s !== undefined && s.timeline_start_s !== null)
                            ? s.timeline_start_s
                            : (s.timeline_start || 0),
                        fps
                    ),
                track: this.getTrack(s.track) ? s.track : fallbackTrack, // pista de DESTINO ao aceitar
                action: s.action || "INSERT", // "INSERT", "DELETE", "REPLACE"
                reason: s.reason || "Recomendação semântica da IA",
                persona: s.persona || null,
                targetClipId: s.targetClipId || s.target_clip_id || null, // Para exclusões ou substituições
                origin: s.origin || "ai",
                alternatives: s.alternatives || []
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

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            // Monta o(s) clipe(s) da sugestão: foto = still único (sem áudio); vídeo = par A/V
            const buildPair = (timelineStartFrame) => {
                if (suggestion.type === "photo") {
                    return [{
                        id: `cut_${stamp}`,
                        type: "photo",
                        photo_id: suggestion.photo_id,
                        video_id: null,
                        inFrame: suggestion.inFrame,
                        outFrame: suggestion.outFrame,
                        in: suggestion.in,
                        out: suggestion.out,
                        track: suggestion.track,
                        link_id: null,
                        origin: suggestion.origin || "ai",
                        effects: [{ type: "fit", mode: "fill" }],
                        timelineStartFrame
                    }];
                }
                const audioTrackId = this.pairedAudioTrackId(suggestion.track);
                const linkId = audioTrackId ? `link_${stamp}` : null;
                const base = {
                    type: "video",
                    video_id: suggestion.video_id,
                    inFrame: suggestion.inFrame,
                    outFrame: suggestion.outFrame,
                    in: suggestion.in,
                    out: suggestion.out,
                    link_id: linkId,
                    origin: suggestion.origin || "ai",
                    alternatives: suggestion.alternatives || []
                };
                const pair = [{ ...base, id: `cut_${stamp}`, track: suggestion.track, timelineStartFrame }];
                if (audioTrackId) {
                    pair.push({ ...base, id: `cut_${stamp}_a`, track: audioTrackId, timelineStartFrame });
                }
                return pair;
            };

            // Remove um clipe e o par vinculado a ele (mantendo a ordem dos demais)
            const removeWithPartner = (clipId) => {
                const target = currentCuts.find(c => c.id === clipId);
                if (!target) return;
                const removeIds = new Set([target.id]);
                if (target.link_id) {
                    currentCuts.forEach(c => { if (c.link_id === target.link_id) removeIds.add(c.id); });
                }
                for (let i = currentCuts.length - 1; i >= 0; i--) {
                    if (removeIds.has(currentCuts[i].id)) currentCuts.splice(i, 1);
                }
            };

            // REPLACE sem alvo válido degrada para INSERT na posição do ghost —
            // aceitar uma sugestão nunca pode ser um no-op silencioso
            let action = suggestion.action;
            if (action === "REPLACE" &&
                (!suggestion.targetClipId || !currentCuts.some(c => c.id === suggestion.targetClipId))) {
                console.warn(`[Timeline] REPLACE sem clipe alvo (${suggestion.targetClipId}); inserindo na posição sugerida.`);
                action = "INSERT";
            }

            if (action === "INSERT") {
                currentCuts.push(...buildPair(suggestion.timelineStartFrame));
            } else if (action === "DELETE" && suggestion.targetClipId) {
                removeWithPartner(suggestion.targetClipId);
            } else if (action === "REPLACE" && suggestion.targetClipId) {
                // Substitui no mesmo índice (preserva a ordem do ripple na pista magnética)
                const targetIdx = currentCuts.findIndex(c => c.id === suggestion.targetClipId);
                if (targetIdx !== -1) {
                    const old = currentCuts[targetIdx];
                    const pair = buildPair(old.timelineStartFrame);
                    currentCuts[targetIdx] = pair[0];
                    if (old.link_id) {
                        for (let i = currentCuts.length - 1; i >= 0; i--) {
                            const c = currentCuts[i];
                            if (c.link_id === old.link_id && c.id !== pair[0].id) currentCuts.splice(i, 1);
                        }
                    }
                    if (pair[1]) currentCuts.push(pair[1]);
                }
            }

            // Remove da lista de sugestões
            this.ghostTrack.splice(index, 1);

            // Ordena os cortes por início na timeline para que a inserção na pista magnética respeite a ordem cronológica
            currentCuts.sort((a, b) => {
                const startA = a.timelineStartFrame !== undefined ? a.timelineStartFrame : (a.timeline_start || 0) * this.fps;
                const startB = b.timelineStartFrame !== undefined ? b.timelineStartFrame : (b.timeline_start || 0) * this.fps;
                return startA - startB;
            });

            // Emite eventos
            STATE.activeTimelineCuts = currentCuts;
            STATE.emit("timelineGhostUpdated", this.ghostTrack);
        });
    }

    /**
     * Rejeita e descarta uma sugestão de IA.
     */
    rejectGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;

        TIMELINE_HISTORY.record(() => {
            this.ghostTrack.splice(index, 1);
            STATE.emit("timelineGhostUpdated", this.ghostTrack);
        });
    }

    /**
     * Substitui a mídia de um clipe na timeline por uma candidata do carrossel de alternativas.
     */
    replaceClipWithAlternative(clipId, alternativeVideoId, newIn, newOut, useIdealDuration) {
        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            const targetIdx = currentCuts.findIndex(c => c.id === clipId);
            if (targetIdx === -1) return;

            const targetVideoClip = currentCuts[targetIdx];
            const oldDuration = targetVideoClip.out - targetVideoClip.in;

            // Determinar nova duração do slot
            let newDuration = oldDuration;
            if (useIdealDuration) {
                newDuration = newOut - newIn;
            } else {
                newOut = newIn + oldDuration;
            }
            const delta = newDuration - oldDuration;

            // Encontrar parceiro de áudio
            const audioPartner = targetVideoClip.link_id
                ? currentCuts.find(c => c.link_id === targetVideoClip.link_id && c.id !== targetVideoClip.id)
                : null;

            // A mídia atual vira alternativa (a troca é reversível pelo carrossel)
            const alts = targetVideoClip.alternatives || [];
            if (!alts.some(a => a.video_id === targetVideoClip.video_id)) {
                alts.push({
                    video_id: targetVideoClip.video_id,
                    in_s: targetVideoClip.in,
                    out_s: targetVideoClip.out,
                    ideal_duration_s: oldDuration,
                    reason: "Escolha anterior neste slot"
                });
            }
            targetVideoClip.alternatives = alts;

            // Atualizar o vídeo original
            targetVideoClip.video_id = alternativeVideoId;
            targetVideoClip.in = newIn;
            targetVideoClip.out = newOut;
            targetVideoClip.inFrame = Math.round(newIn * this.fps);
            targetVideoClip.outFrame = Math.round(newOut * this.fps);

            // Atualizar o áudio parceiro
            if (audioPartner) {
                audioPartner.video_id = alternativeVideoId;
                audioPartner.in = newIn;
                audioPartner.out = newOut;
                audioPartner.inFrame = Math.round(newIn * this.fps);
                audioPartner.outFrame = Math.round(newOut * this.fps);
            }

            // Se for alteração de duração com ripple, empurra clipes seguintes nas pistas sincronizadas (Sync Lock)
            if (delta !== 0) {
                const deltaFrames = Math.round(delta * this.fps);
                const targetEndFrame = (targetVideoClip.timelineStartFrame || 0) + Math.round(oldDuration * this.fps);
                const syncTracks = this.getSyncLockedTrackIds();

                currentCuts.forEach(c => {
                    if (c.id !== targetVideoClip.id && (!targetVideoClip.link_id || c.link_id !== targetVideoClip.link_id) &&
                        syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= targetEndFrame - 1) {
                        c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) + deltaFrames);
                        c.timeline_start = c.timelineStartFrame / this.fps;
                    }
                });
            }

            // Ordena os cortes por início na timeline para que a inserção na pista magnética respeite a ordem cronológica
            currentCuts.sort((a, b) => {
                const startA = a.timelineStartFrame !== undefined ? a.timelineStartFrame : (a.timeline_start || 0) * this.fps;
                const startB = b.timelineStartFrame !== undefined ? b.timelineStartFrame : (b.timeline_start || 0) * this.fps;
                return startA - startB;
            });

            // Atualiza os cortes
            STATE.activeTimelineCuts = currentCuts;
        });
    }

    /**
     * Divide um clipe em dois no frame especificado (playhead).
     */
    splitClip(clipId, splitFrame) {
        TIMELINE_HISTORY.record(() => {
            const currentCuts = [...STATE.activeTimelineCuts];
            const targetIdx = currentCuts.findIndex(c => c.id === clipId);
            if (targetIdx === -1) return;

            const clip = currentCuts[targetIdx];
            const fps = this.fps;

            // Verifica se o frame intersecta o clipe
            const startFrame = clip.timelineStartFrame || 0;
            const durationFrames = clip.outFrame - clip.inFrame;
            const endFrame = startFrame + durationFrames;

            if (splitFrame <= startFrame || splitFrame >= endFrame) {
                return; // Fora do clipe
            }

            // Descobrir se há clipe parceiro vinculado
            const partner = clip.link_id 
                ? currentCuts.find(c => c.link_id === clip.link_id && c.id !== clip.id)
                : null;

            const newLinkPartner = clip.link_id ? `link_${Date.now()}_${Math.floor(Math.random()*900+100)}` : null;

            const doSplit = (c, linkId) => {
                const cStart = c.timelineStartFrame || 0;
                const offsetFrames = splitFrame - cStart;
                
                // Criar o segundo clipe (parte direita)
                const secondClip = {
                    ...c,
                    id: `cut_${Date.now()}_${Math.floor(Math.random()*900+100)}_${c.id.endsWith("_a") ? "a" : "v"}`,
                    timelineStartFrame: splitFrame,
                    timeline_start: splitFrame / fps,
                    inFrame: c.inFrame + offsetFrames,
                    in: (c.inFrame + offsetFrames) / fps,
                    link_id: linkId
                };

                // Modificar o primeiro clipe (parte esquerda)
                c.outFrame = c.inFrame + offsetFrames;
                c.out = c.outFrame / fps;

                currentCuts.push(secondClip);
            };

            doSplit(clip, newLinkPartner);
            if (partner) {
                doSplit(partner, newLinkPartner);
            }

            STATE.activeTimelineCuts = currentCuts;
        });
    }

    /**
     * Define as propriedades da sequência (largura, altura e fps) e reescala clipes.
     */
    setTimelineProperties({ width, height, fps }) {
        const newW = parseInt(width);
        const newH = parseInt(height);
        const newFps = parseFloat(fps);

        if (isNaN(newW) || newW <= 0 || newW % 2 !== 0) return false;
        if (isNaN(newH) || newH <= 0 || newH % 2 !== 0) return false;
        if (isNaN(newFps) || newFps <= 0) return false;

        const oldFps = this.fps;
        const fpsChanged = oldFps !== newFps;

        TIMELINE_HISTORY.record(() => {
            this.width = newW;
            this.height = newH;
            this.fps = newFps;

            if (fpsChanged && STATE.activeTimelineCuts.length > 0) {
                const cuts = STATE.activeTimelineCuts.map(cut => {
                    return {
                        ...cut,
                        inFrame: Math.round(cut.in * newFps),
                        outFrame: Math.round(cut.out * newFps),
                        timelineStartFrame: Math.round(cut.timeline_start * newFps)
                    };
                });
                STATE.activeTimelineCuts = cuts;
            }

            STATE.emit("timelineFpsChanged", this.fps);
            STATE.emit("timelinePropertiesChanged", { width: this.width, height: this.height, fps: this.fps });
        });
        return true;
    }
}

export const TIMELINE_STATE = new CapiauTimelineState();
window.TIMELINE_STATE = TIMELINE_STATE;

// --- HISTÓRICO DE UNDO/REDO (snapshots de clipes, pistas e sugestões) ---

class TimelineHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null; // snapshot pré-transação (para drags contínuos)
        this.limit = 100;
    }

    _capture() {
        return JSON.parse(JSON.stringify({
            cuts: STATE.activeTimelineCuts,
            tracks: TIMELINE_STATE.tracks,
            ghosts: TIMELINE_STATE.ghostTrack,
            selectedClipId: TIMELINE_STATE.selectedClipId,
            selectedGhostClipId: TIMELINE_STATE.selectedGhostClipId
        }));
    }

    /** Abre uma transação (ex: mousedown de um drag/trim). Idempotente. */
    begin() {
        if (!this.pending) this.pending = this._capture();
    }

    /** Fecha a transação: empilha o estado anterior somente se algo mudou. */
    commit() {
        if (!this.pending) return;
        const before = this.pending;
        this.pending = null;
        if (JSON.stringify(before) === JSON.stringify(this._capture())) return;
        this.undoStack.push(before);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack = [];
        this._notify();
    }

    /** Envolve uma operação pontual numa transação própria (ou adere à transação aberta). */
    record(fn) {
        if (this.pending) {
            fn();
            return;
        }
        this.begin();
        try {
            fn();
        } finally {
            this.commit();
        }
    }

    _restore(snap) {
        TIMELINE_STATE.selectedClipId = snap.selectedClipId !== undefined ? snap.selectedClipId : null;
        TIMELINE_STATE.selectedGhostClipId = snap.selectedGhostClipId !== undefined ? snap.selectedGhostClipId : null;
        TIMELINE_STATE.setTracks(snap.tracks);
        STATE.activeTimelineCuts = snap.cuts || [];
        TIMELINE_STATE.ghostTrack = snap.ghosts || [];
        STATE.emit("timelineGhostUpdated", TIMELINE_STATE.ghostTrack);
        STATE.emit("timelineRestored");
        this._notify();
    }

    undo() {
        if (!this.undoStack.length) return false;
        const current = this._capture();
        const snap = this.undoStack.pop();
        this.redoStack.push(current);
        this._restore(snap);
        return true;
    }

    redo() {
        if (!this.redoStack.length) return false;
        const current = this._capture();
        const snap = this.redoStack.pop();
        this.undoStack.push(current);
        this._restore(snap);
        return true;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
        this._notify();
    }

    _notify() {
        STATE.emit("timelineHistoryChanged", {
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0
        });
    }
}

export const TIMELINE_HISTORY = new TimelineHistory();
window.TIMELINE_HISTORY = TIMELINE_HISTORY;
