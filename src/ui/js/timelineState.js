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
export const TRACK_HEIGHTS = { ai: 44, text: 52, video: 72, audio: 48 };

// Duração padrão (segundos) de uma foto (still) ao ser inserida na timeline.
export const PHOTO_DEFAULT_DURATION = 5;

/**
 * Pistas padrão (ordem do array = ordem visual de cima para baixo).
 * "AI" é a pista de sugestões: somente leitura, recebe os ghost clips.
 * "T1" é a pista de títulos, legendas e GCs (sobreposta ao vídeo).
 * "V1" é magnética (ripple) por padrão; "V2" é livre.
 * "A1"/"A2" são pistas de áudio reais: recebem o áudio vinculado (link_id)
 * dos clipes de vídeo, com trims independentes (L-cuts / J-cuts).
 */
function defaultTracks() {
    return [
        { id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, syncLocked: false, hidden: false, thumbnailsEnabled: false },
        { id: "T1", name: "Títulos & GCs", kind: "text", volume: 1.0, muted: false, locked: false, syncLocked: true, hidden: false, thumbnailsEnabled: false },
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
        this.selectedClipIds = new Set(); // IDs de múltiplos clipes selecionados
        this.activeTool = "select"; // Ferramenta ativa: "select" (V), "track-forward" (T), "track-backward" (Shift+T)
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

        // Pontos de Entrada e Saída (IN / OUT / LOOP)
        this.inFrame = null; // Ponto IN marcado na timeline (em frames)
        this.outFrame = null; // Ponto OUT marcado na timeline (em frames)
        this.isLooping = false; // Modo de reprodução em loop contínuo entre In e Out (ou timeline)

        // Manipulador de Fade ativo no hover ({ clipId, side: "in"|"out", type: "duration"|"curve" })
        this.hoveredFadeHandle = null;

        // Modo de Colisão e Movimentação na Mesma Pista (Task 3.5):
        // "clamp" (Bloqueio Físico rígido - Padrão), "overwrite" (Sobrescrita / Shift), "ripple" (Inserção Magnética / Ctrl)
        this._dragCollisionMode = this.loadDragCollisionMode();
    }

    /** Carrega a preferência de modo de colisão do localStorage (default: 'clamp'). */
    loadDragCollisionMode() {
        try {
            if (typeof localStorage !== "undefined") {
                const saved = localStorage.getItem("capiau_collision_mode_v1");
                if (saved && ["clamp", "overwrite", "ripple"].includes(saved)) {
                    return saved;
                }
            }
        } catch (_) {}
        return "clamp";
    }

    /** Modo de colisão ativo. */
    get dragCollisionMode() {
        return this._dragCollisionMode || "clamp";
    }

    /** Define e persiste o modo de colisão de pistas. */
    setDragCollisionMode(mode) {
        if (!["clamp", "overwrite", "ripple"].includes(mode)) return;
        this._dragCollisionMode = mode;
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem("capiau_collision_mode_v1", mode);
            }
        } catch (_) {}
        STATE.emit("timelineCollisionModeChanged", mode);
    }

    /** Atalho reativo para a lista ativa de cortes na timeline. */
    get cuts() {
        return (STATE && STATE.activeTimelineCuts) || [];
    }

    // ── PONTOS DE ENTRADA E SAÍDA (IN / OUT / LOOP) ───────────────────────

    /**
     * Define o ponto IN na timeline.
     * @param {number} [frame=this.playheadFrame] Frame absoluto.
     */
    setInPoint(frame = this.playheadFrame) {
        const f = Math.max(0, Math.round(Number(frame) || 0));
        this.inFrame = f;
        if (this.outFrame !== null && this.outFrame <= this.inFrame) {
            this.outFrame = null;
        }
        STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        return this.inFrame;
    }

    /**
     * Define o ponto OUT na timeline.
     * @param {number} [frame=this.playheadFrame] Frame absoluto.
     */
    setOutPoint(frame = this.playheadFrame) {
        const f = Math.max(0, Math.round(Number(frame) || 0));
        this.outFrame = f;
        if (this.inFrame !== null && this.inFrame >= this.outFrame) {
            this.inFrame = null;
        }
        STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        return this.outFrame;
    }

    /** Limpa o ponto IN. */
    clearInPoint() {
        if (this.inFrame !== null) {
            this.inFrame = null;
            STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        }
    }

    /** Limpa o ponto OUT. */
    clearOutPoint() {
        if (this.outFrame !== null) {
            this.outFrame = null;
            STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        }
    }

    /** Limpa ambos os pontos IN e OUT. */
    clearInOut() {
        if (this.inFrame !== null || this.outFrame !== null) {
            this.inFrame = null;
            this.outFrame = null;
            STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        }
    }

    /**
     * Marca pontos IN e OUT em torno do clipe selecionado ou sob o playhead.
     * @param {string} [clipId=null] ID do clipe (opcional).
     */
    markClip(clipId = null) {
        const cuts = STATE.activeTimelineCuts || [];
        let targetCut = null;
        if (clipId) {
            targetCut = cuts.find(c => c.id === clipId);
        } else if (this.selectedClipId) {
            targetCut = cuts.find(c => c.id === this.selectedClipId);
        } else {
            const targetTrack = this.selectedTrack || "V1";
            targetCut = cuts.find(c => c.track === targetTrack && this.playheadFrame >= c.timelineStartFrame && this.playheadFrame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
            if (!targetCut) {
                targetCut = cuts.find(c => this.playheadFrame >= c.timelineStartFrame && this.playheadFrame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
            }
        }

        if (targetCut) {
            const start = targetCut.timelineStartFrame;
            const end = targetCut.timelineStartFrame + (targetCut.outFrame - targetCut.inFrame);
            this.inFrame = start;
            this.outFrame = end;
            STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
            return true;
        }
        return false;
    }

    /**
     * Alterna ou define o estado de reprodução em loop.
     * @param {boolean} [forceState=null]
     */
    toggleLoop(forceState = null) {
        this.isLooping = (forceState !== null) ? Boolean(forceState) : !this.isLooping;
        STATE.emit("timelineLoopChanged", this.isLooping);
        return this.isLooping;
    }

    /** Retorna true se houver ponto IN ou OUT definido. */
    hasInOut() {
        return this.inFrame !== null || this.outFrame !== null;
    }

    /**
     * Retorna os frames efetivos de início e fim da região de trabalho.
     * Se ambos null, retorna [0, maxDuration].
     */
    getEffectiveInOutFrames() {
        const cuts = STATE.activeTimelineCuts || [];
        const maxDuration = cuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + ((c.outFrame || 0) - (c.inFrame || 0))), 0);
        const start = (this.inFrame !== null) ? this.inFrame : 0;
        const end = (this.outFrame !== null) ? this.outFrame : maxDuration;
        return { startFrame: start, endFrame: Math.max(start, end), durationFrames: Math.max(0, end - start) };
    }

    /** Move a agulha para o ponto IN (ou 0). */
    seekToIn() {
        const target = (this.inFrame !== null) ? this.inFrame : 0;
        this.setPlayheadFrame(target);
        if (window.timelineInteraction && typeof window.timelineInteraction.ensureFrameVisible === "function") {
            window.timelineInteraction.ensureFrameVisible(target);
        }
        return target;
    }

    /** Move a agulha para o ponto OUT (ou duração máxima). */
    seekToOut() {
        const cuts = STATE.activeTimelineCuts || [];
        const maxDuration = cuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + ((c.outFrame || 0) - (c.inFrame || 0))), 0);
        const target = (this.outFrame !== null) ? this.outFrame : maxDuration;
        this.setPlayheadFrame(target);
        if (window.timelineInteraction && typeof window.timelineInteraction.ensureFrameVisible === "function") {
            window.timelineInteraction.ensureFrameVisible(target);
        }
        return target;
    }

    /**
     * Lift Delete no intervalo IN-OUT:
     * Remove o conteúdo das pistas destravadas dentro do intervalo [inFrame, outFrame],
     * deixando o espaço vazio (gap).
     * @param {number} [inF=this.inFrame] Frame inicial do intervalo.
     * @param {number} [outF=this.outFrame] Frame final do intervalo.
     * @returns {boolean} True se a operação foi realizada com sucesso.
     */
    liftRange(inF = this.inFrame, outF = this.outFrame) {
        const range = this.getEffectiveInOutFrames();
        const startF = (inF !== null && inF !== undefined) ? inF : range.startFrame;
        const endF = (outF !== null && outF !== undefined) ? outF : range.endFrame;

        if (startF >= endF) return false;

        const cuts = STATE.activeTimelineCuts || [];
        if (cuts.length === 0) return false;

        const activeTrackIds = this.tracks
            .filter(t => t.kind !== "ai" && !t.locked)
            .map(t => t.id);

        let modified = false;

        TIMELINE_HISTORY.record(() => {
            const newCuts = [];

            for (const cut of cuts) {
                if (!activeTrackIds.includes(cut.track)) {
                    newCuts.push(cut);
                    continue;
                }

                const cStart = cut.timelineStartFrame !== undefined ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * this.fps);
                const cIn = cut.inFrame !== undefined ? cut.inFrame : Math.round((cut.in || 0) * this.fps);
                const cOut = cut.outFrame !== undefined ? cut.outFrame : Math.round((cut.out || 0) * this.fps);
                const cDur = cOut - cIn;
                const cEnd = cStart + cDur;

                // 1. Clipe totalmente fora do intervalo: mantém intacto
                if (cEnd <= startF || cStart >= endF) {
                    newCuts.push(cut);
                    continue;
                }

                modified = true;

                // 2. Clipe totalmente contido dentro do intervalo: é removido completamente
                if (cStart >= startF && cEnd <= endF) {
                    continue;
                }

                // 3. Clipe atravessa todo o intervalo (começa antes e termina depois): divide em 2 partes
                if (cStart < startF && cEnd > endF) {
                    const leftDur = startF - cStart;
                    const leftCut = {
                        ...JSON.parse(JSON.stringify(cut)),
                        id: `cut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        timelineStartFrame: cStart,
                        timeline_start: cStart / this.fps,
                        inFrame: cIn,
                        in: cIn / this.fps,
                        outFrame: cIn + leftDur,
                        out: (cIn + leftDur) / this.fps
                    };
                    newCuts.push(leftCut);

                    const rightOffset = endF - cStart;
                    const rightDur = cEnd - endF;
                    const rightCut = {
                        ...JSON.parse(JSON.stringify(cut)),
                        id: `cut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        timelineStartFrame: endF,
                        timeline_start: endF / this.fps,
                        inFrame: cIn + rightOffset,
                        in: (cIn + rightOffset) / this.fps,
                        outFrame: cIn + rightOffset + rightDur,
                        out: (cIn + rightOffset + rightDur) / this.fps
                    };
                    newCuts.push(rightCut);
                    continue;
                }

                // 4. Clipe começa antes do In e termina dentro do intervalo: apara a cauda
                if (cStart < startF && cEnd <= endF) {
                    const newDur = startF - cStart;
                    const trimmedCut = {
                        ...cut,
                        outFrame: cIn + newDur,
                        out: (cIn + newDur) / this.fps
                    };
                    newCuts.push(trimmedCut);
                    continue;
                }

                // 5. Clipe começa dentro do intervalo e termina depois do Out: apara a cabeça
                if (cStart >= startF && cEnd > endF) {
                    const cutOffset = endF - cStart;
                    const newDur = cEnd - endF;
                    const trimmedCut = {
                        ...cut,
                        timelineStartFrame: endF,
                        timeline_start: endF / this.fps,
                        inFrame: cIn + cutOffset,
                        in: (cIn + cutOffset) / this.fps
                    };
                    newCuts.push(trimmedCut);
                    continue;
                }
            }

            if (modified) {
                this.clearClipSelection();
                STATE.activeTimelineCuts = newCuts;
            }
        });

        return modified;
    }

    /**
     * Extract (Ripple Delete) no intervalo IN-OUT:
     * Remove o conteúdo das pistas destravadas dentro de [inFrame, outFrame]
     * e fecha o espaço puxando todos os clipes à direita para a esquerda pela duração do intervalo.
     * @param {number} [inF=this.inFrame] Frame inicial do intervalo.
     * @param {number} [outF=this.outFrame] Frame final do intervalo.
     * @returns {boolean} True se a operação foi realizada com sucesso.
     */
    extractRange(inF = this.inFrame, outF = this.outFrame) {
        const range = this.getEffectiveInOutFrames();
        const startF = (inF !== null && inF !== undefined) ? inF : range.startFrame;
        const endF = (outF !== null && outF !== undefined) ? outF : range.endFrame;

        if (startF >= endF) return false;

        const cuts = STATE.activeTimelineCuts || [];
        if (cuts.length === 0) return false;

        const durationFrames = endF - startF;
        const activeTrackIds = this.tracks
            .filter(t => t.kind !== "ai" && !t.locked)
            .map(t => t.id);
        const syncTrackIds = this.getSyncLockedTrackIds();

        let modified = false;

        TIMELINE_HISTORY.record(() => {
            const intermediateCuts = [];

            for (const cut of cuts) {
                if (!activeTrackIds.includes(cut.track)) {
                    intermediateCuts.push(cut);
                    continue;
                }

                const cStart = cut.timelineStartFrame !== undefined ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * this.fps);
                const cIn = cut.inFrame !== undefined ? cut.inFrame : Math.round((cut.in || 0) * this.fps);
                const cOut = cut.outFrame !== undefined ? cut.outFrame : Math.round((cut.out || 0) * this.fps);
                const cDur = cOut - cIn;
                const cEnd = cStart + cDur;

                if (cEnd <= startF || cStart >= endF) {
                    intermediateCuts.push(cut);
                    continue;
                }

                modified = true;

                if (cStart >= startF && cEnd <= endF) {
                    continue;
                }

                if (cStart < startF && cEnd > endF) {
                    const leftDur = startF - cStart;
                    const leftCut = {
                        ...JSON.parse(JSON.stringify(cut)),
                        id: `cut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        timelineStartFrame: cStart,
                        timeline_start: cStart / this.fps,
                        inFrame: cIn,
                        in: cIn / this.fps,
                        outFrame: cIn + leftDur,
                        out: (cIn + leftDur) / this.fps
                    };
                    intermediateCuts.push(leftCut);

                    const rightOffset = endF - cStart;
                    const rightDur = cEnd - endF;
                    const rightCut = {
                        ...JSON.parse(JSON.stringify(cut)),
                        id: `cut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        timelineStartFrame: endF,
                        timeline_start: endF / this.fps,
                        inFrame: cIn + rightOffset,
                        in: (cIn + rightOffset) / this.fps,
                        outFrame: cIn + rightOffset + rightDur,
                        out: (cIn + rightOffset + rightDur) / this.fps
                    };
                    intermediateCuts.push(rightCut);
                    continue;
                }

                if (cStart < startF && cEnd <= endF) {
                    const newDur = startF - cStart;
                    const trimmedCut = {
                        ...cut,
                        outFrame: cIn + newDur,
                        out: (cIn + newDur) / this.fps
                    };
                    intermediateCuts.push(trimmedCut);
                    continue;
                }

                if (cStart >= startF && cEnd > endF) {
                    const cutOffset = endF - cStart;
                    const newDur = cEnd - endF;
                    const trimmedCut = {
                        ...cut,
                        timelineStartFrame: endF,
                        timeline_start: endF / this.fps,
                        inFrame: cIn + cutOffset,
                        in: (cIn + cutOffset) / this.fps
                    };
                    intermediateCuts.push(trimmedCut);
                    continue;
                }
            }

            const finalCuts = intermediateCuts.map(c => {
                const cStart = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * this.fps);
                if (syncTrackIds.includes(c.track) && cStart >= endF - 1) {
                    const newStart = Math.max(0, cStart - durationFrames);
                    return {
                        ...c,
                        timelineStartFrame: newStart,
                        timeline_start: newStart / this.fps
                    };
                }
                return c;
            });

            if (this.outFrame !== null) {
                this.outFrame = Math.max(this.inFrame !== null ? this.inFrame : 0, this.outFrame - durationFrames);
            }

            this.clearClipSelection();
            STATE.activeTimelineCuts = finalCuts;
            STATE.emit("timelineInOutChanged", { inFrame: this.inFrame, outFrame: this.outFrame });
        });

        return modified;
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

    /** Pistas de texto em ordem visual (de cima para baixo). */
    getTextTracks() {
        return this.tracks.filter(t => t.kind === "text");
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

    /** Adiciona uma nova pista de texto/títulos (inserida no grupo de pistas de texto ou abaixo de IA). */
    addTextTrack(name = null) {
        let n = 1;
        while (this.tracks.some(t => t.id === `T${n}`)) n++;
        const track = {
            id: `T${n}`,
            name: name || `T${n} Texto`,
            kind: "text",
            volume: 1.0,
            muted: false,
            locked: false,
            syncLocked: true,
            magnetic: false,
            hidden: false,
            thumbnailsEnabled: false
        };
        TIMELINE_HISTORY.record(() => {
            const textTracks = this.getTextTracks();
            let insertIdx = 0;
            if (textTracks.length > 0) {
                const lastTextTrack = textTracks[textTracks.length - 1];
                insertIdx = this.tracks.findIndex(t => t.id === lastTextTrack.id) + 1;
            } else {
                const aiIdx = this.tracks.findIndex(t => t.kind === "ai");
                insertIdx = aiIdx >= 0 ? aiIdx + 1 : 0;
            }
            this.tracks.splice(insertIdx, 0, track);
            STATE.emit("timelineTracksChanged", this.tracks);
        });
        return track;
    }

    /** Adiciona uma nova pista de vídeo (logo abaixo da pista de IA/Texto). */
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
     * @param {string[]} [ignoredClipIds=[]] - IDs de clipes a ignorar (ex: clipe em arraste).
     * @param {boolean} [includeEndGap=false] - Se true, inclui o gap infinito além do último clipe.
     * @returns {Array<{ trackId: string, startFrame: number, endFrame: number, durationFrames: number }>}
     */
    getTrackGaps(trackId, ignoredClipIds = [], includeEndGap = false) {
        const cuts = (STATE.activeTimelineCuts || [])
            .filter(c => c.track === trackId && !ignoredClipIds.includes(c.id))
            .sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));

        if (!cuts.length) {
            if (includeEndGap) {
                return [{
                    trackId,
                    startFrame: 0,
                    endFrame: Infinity,
                    durationFrames: Infinity
                }];
            }
            return [];
        }
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

        if (includeEndGap) {
            const lastCut = cuts[cuts.length - 1];
            const lastEnd = (lastCut.timelineStartFrame || 0) + (lastCut.outFrame - lastCut.inFrame);
            gaps.push({
                trackId,
                startFrame: lastEnd,
                endFrame: Infinity,
                durationFrames: Infinity
            });
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

    /**
     * Localiza os vizinhos imediatos de uma coordenada de tempo em uma pista.
     * @param {string} trackId - ID da pista.
     * @param {number} frame - Coordenada temporal de referência.
     * @param {string[]} [ignoredClipIds=[]] - Clipes ignorados no cálculo.
     * @returns {{ prevClip: Object|null, nextClip: Object|null, prevEnd: number, nextStart: number }}
     */
    getTrackClipNeighbors(trackId, frame, ignoredClipIds = []) {
        const cuts = (STATE.activeTimelineCuts || [])
            .filter(c => c.track === trackId && !ignoredClipIds.includes(c.id))
            .sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));

        let prevClip = null;
        let nextClip = null;
        let prevEnd = 0;
        let nextStart = Infinity;

        for (const c of cuts) {
            const cStart = c.timelineStartFrame || 0;
            const cDur = c.outFrame - c.inFrame;
            const cEnd = cStart + cDur;

            if (cEnd <= frame) {
                prevClip = c;
                prevEnd = Math.max(prevEnd, cEnd);
            } else if (cStart >= frame) {
                if (!nextClip || cStart < nextStart) {
                    nextClip = c;
                    nextStart = cStart;
                }
            }
        }

        return { prevClip, nextClip, prevEnd, nextStart };
    }

    /**
     * Remove ou fatia clipes existentes no intervalo [startFrame, startFrame + durationFrames] da pista especificada.
     * Suporta encadeamento multipistas atômico via sourceCuts e preservação de vínculo A/V via splitLinkMap.
     * @param {string} trackId - ID da pista.
     * @param {number} startFrame - Frame inicial da sobrescrita.
     * @param {number} durationFrames - Duração em frames.
     * @param {string[]} [ignoredClipIds=[]] - IDs de clipes a ignorar.
     * @param {Array<Object>|null} [sourceCuts=null] - Lista base de cortes (se omitida, usa STATE.activeTimelineCuts).
     * @param {Map<string, string>|null} [splitLinkMap=null] - Mapa compartilhado para sincronizar link_id em splits A/V.
     * @returns {Array<Object>} Lista atualizada de cortes.
     */
    overwriteTimeRange(trackId, startFrame, durationFrames, ignoredClipIds = [], sourceCuts = null, splitLinkMap = null) {
        const cuts = sourceCuts || STATE.activeTimelineCuts || [];
        const endFrame = startFrame + durationFrames;
        const fps = this.fps || 24;
        const newCuts = [];

        for (const c of cuts) {
            if (c.track !== trackId || ignoredClipIds.includes(c.id)) {
                newCuts.push(c);
                continue;
            }

            const cStart = c.timelineStartFrame || 0;
            const cDur = c.outFrame - c.inFrame;
            const cEnd = cStart + cDur;

            // Se não há interseção, mantém intacto
            if (cEnd <= startFrame || cStart >= endFrame) {
                newCuts.push(c);
                continue;
            }

            // Caso 1: Totalmente encoberto -> removido
            if (cStart >= startFrame && cEnd <= endFrame) {
                continue;
            }

            // Caso 2: Novo clipe cai no meio de c -> fatia em dois (esquerda e direita)
            if (cStart < startFrame && cEnd > endFrame) {
                const leftDur = startFrame - cStart;
                const rightOffset = endFrame - cStart;

                // Parte esquerda
                newCuts.push({
                    ...c,
                    outFrame: c.inFrame + leftDur,
                    out: (c.inFrame + leftDur) / fps
                });

                // Parte direita: reutiliza stamp compartilhado via splitLinkMap para par A/V
                let stamp = null;
                if (c.link_id && splitLinkMap) {
                    if (splitLinkMap.has(c.link_id)) {
                        stamp = splitLinkMap.get(c.link_id);
                    } else {
                        stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                        splitLinkMap.set(c.link_id, stamp);
                    }
                } else {
                    stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                }
                const isAudio = this.trackKindOf(trackId) === "audio";
                newCuts.push({
                    ...c,
                    id: `cut_${stamp}_${isAudio ? "a" : "v"}`,
                    timelineStartFrame: endFrame,
                    timeline_start: endFrame / fps,
                    inFrame: c.inFrame + rightOffset,
                    in: (c.inFrame + rightOffset) / fps,
                    link_id: c.link_id ? `link_${stamp}` : null
                });
                continue;
            }

            // Caso 3: Cobre a cauda de c -> tail trim
            if (cStart < startFrame && cEnd <= endFrame) {
                const leftDur = startFrame - cStart;
                newCuts.push({
                    ...c,
                    outFrame: c.inFrame + leftDur,
                    out: (c.inFrame + leftDur) / fps
                });
                continue;
            }

            // Caso 4: Cobre a cabeça de c -> head trim
            if (cStart >= startFrame && cEnd > endFrame) {
                const offset = endFrame - cStart;
                newCuts.push({
                    ...c,
                    timelineStartFrame: endFrame,
                    timeline_start: endFrame / fps,
                    inFrame: c.inFrame + offset,
                    in: (c.inFrame + offset) / fps
                });
                continue;
            }
        }

        return newCuts;
    }

    /**
     * Simula dinamicamente e sem destruir o estado o resultado de uma sobrescrita em tempo real.
     * Retorna os cortes simulados e os dados dos clipes Outgoing e Incoming para o preview 2-Up.
     * @param {string} draggedClipId - ID do clipe sendo arrastado.
     * @param {number} targetStartFrame - Ponto de início simulado na timeline.
     * @param {string} targetTrack - Pista de destino simulada.
     * @param {Array<Object>|null} [sourceCuts=null] - Lista base de cortes intacta antes do arraste.
     * @returns {{ simulatedCuts: Array<Object>, outgoingClip: Object|null, outgoingTime: number, incomingClip: Object|null, incomingTime: number }}
     */
    simulateOverwrite(draggedClipId, targetStartFrame, targetTrack = null, sourceCuts = null, isMovingBackwards = false) {
        const base = (sourceCuts || STATE.activeTimelineCuts || []).map(c => ({ ...c }));
        const clip = base.find(c => c.id === draggedClipId);
        if (!clip) return { simulatedCuts: base, outgoingClip: null, outgoingTime: 0, incomingClip: null, incomingTime: 0 };

        const fps = this.fps || 24;
        const clipKind = this.trackKindOf(clip.track);
        let finalTrackId = clip.track;
        if (targetTrack && targetTrack !== clip.track) {
            const t = this.getTrack(targetTrack);
            if (t && !t.locked && (t.kind || "video") === clipKind) {
                finalTrackId = targetTrack;
            }
        }

        const partner = clip.link_id
            ? base.find(c => c.id !== clip.id && c.link_id === clip.link_id)
            : null;

        let partnerTrackId = partner ? partner.track : null;
        if (clipKind === "video" && finalTrackId !== clip.track && partner) {
            const newAudioTrack = this.pairedAudioTrackId(finalTrackId);
            if (newAudioTrack) partnerTrackId = newAudioTrack;
        }

        const duration = clip.outFrame - clip.inFrame;
        const finalStart = Math.max(0, targetStartFrame);
        const endFrame = finalStart + duration;

        clip.timelineStartFrame = finalStart;
        clip.timeline_start = finalStart / fps;
        clip.track = finalTrackId;

        if (partner) {
            partner.timelineStartFrame = finalStart;
            partner.timeline_start = finalStart / fps;
            if (partnerTrackId) partner.track = partnerTrackId;
        }

        const ignored = [clip.id];
        if (partner) ignored.push(partner.id);

        // Identifica o clipe subjacente na pista de vídeo que será cortado para o 2-Up
        const videoTrack = clipKind === "video" ? finalTrackId : (partner ? partner.track : finalTrackId);
        const underlyingVideoCuts = base.filter(c => c.track === videoTrack && !ignored.includes(c.id));

        const draggedVideoClip = clipKind === "video" ? clip : partner;
        const draggedInFrame = (draggedVideoClip && draggedVideoClip.inFrame !== undefined)
            ? draggedVideoClip.inFrame
            : Math.round(((draggedVideoClip && draggedVideoClip.in) || 0) * fps);
        const draggedOutFrame = (draggedVideoClip && draggedVideoClip.outFrame !== undefined)
            ? draggedVideoClip.outFrame
            : (draggedInFrame + duration);

        const draggedHeadTime = draggedInFrame / fps;
        const draggedTailTime = Math.max(draggedInFrame, draggedOutFrame - 1) / fps;

        // 1. Procura colisão na cabeça (finalStart): clipe anterior cuja cauda é cortada em finalStart
        const cutAtHead = underlyingVideoCuts.find(c => {
            const cStart = c.timelineStartFrame || 0;
            const cEnd = cStart + (c.outFrame - c.inFrame);
            return cStart < finalStart && cEnd > finalStart;
        });

        // 2. Procura colisão na cauda (endFrame): clipe seguinte cuja cabeça é cortada em endFrame
        const cutAtTail = underlyingVideoCuts.find(c => {
            const cStart = c.timelineStartFrame || 0;
            const cEnd = cStart + (c.outFrame - c.inFrame);
            return cStart < endFrame && cEnd > endFrame;
        });

        let outgoingClip = null;
        let outgoingTime = 0;
        let incomingClip = null;
        let incomingTime = 0;

        let isBackwards = false;
        if (cutAtHead && !cutAtTail) {
            isBackwards = true;
        } else if (cutAtTail && !cutAtHead) {
            isBackwards = false;
        } else {
            isBackwards = Boolean(isMovingBackwards);
        }

        if (isBackwards) {
            // Emenda no início do clipe arrastado (finalStart):
            // Lado Esquerdo (Outgoing): clipe anterior aparado na cauda em finalStart
            if (cutAtHead) {
                outgoingClip = cutAtHead;
                const offset = finalStart - (cutAtHead.timelineStartFrame || 0);
                const cutFrame = cutAtHead.inFrame + Math.max(0, offset - 1);
                outgoingTime = cutFrame / fps;
            } else {
                const prevCut = underlyingVideoCuts.find(c => {
                    const cEnd = (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame);
                    return cEnd === finalStart;
                });
                if (prevCut) {
                    outgoingClip = prevCut;
                    outgoingTime = Math.max(prevCut.inFrame, prevCut.outFrame - 1) / fps;
                }
            }

            // Lado Direito (Incoming): o clipe arrastado começando no seu inFrame (cabeça com corte preservado!)
            incomingClip = draggedVideoClip;
            incomingTime = draggedHeadTime;
        } else {
            // Emenda no final do clipe arrastado (endFrame):
            // Lado Esquerdo (Outgoing): o clipe arrastado terminando na sua cauda
            outgoingClip = draggedVideoClip;
            outgoingTime = draggedTailTime;

            // Lado Direito (Incoming): clipe seguinte começando ou continuando em endFrame
            if (cutAtTail) {
                incomingClip = cutAtTail;
                const offset = endFrame - (cutAtTail.timelineStartFrame || 0);
                const cutFrame = cutAtTail.inFrame + offset;
                incomingTime = cutFrame / fps;
            } else {
                const nextCut = underlyingVideoCuts.find(c => (c.timelineStartFrame || 0) === endFrame);
                if (nextCut) {
                    incomingClip = nextCut;
                    incomingTime = nextCut.inFrame / fps;
                }
            }
        }

        // Aplica o corte simulado atômico em todas as pistas
        const splitLinkMap = new Map();
        let cuts = this.overwriteTimeRange(clip.track, finalStart, duration, ignored, base, splitLinkMap);
        if (partner) {
            const pDur = partner.outFrame - partner.inFrame;
            cuts = this.overwriteTimeRange(partner.track, finalStart, pDur, ignored, cuts, splitLinkMap);
        }

        return {
            simulatedCuts: cuts,
            outgoingClip,
            outgoingTime,
            incomingClip,
            incomingTime
        };
    }

    /**
     * Simula dinamicamente a inserção Ripple em tempo real (tecla Ctrl) sem alterar o estado persistente.
     * Suporta Ripple Swap / Rearrange Edit para clipes já existentes na timeline (fechando o espaço na origem
     * sem criar buracos vazios e sem expandir a timeline desnecessariamente).
     * @param {string} draggedClipId - ID do clipe sendo arrastado.
     * @param {number} targetStartFrame - Ponto de inserção magnética.
     * @param {string|null} [targetTrack=null] - Pista destino sob o mouse.
     * @param {Array<Object>|null} [sourceCuts=null] - Lista original de cortes intacta no início do arraste.
     * @param {boolean} [isMovingBackwards=false] - Direção do mouse (true = recuo/esquerda, false = avanço/direita).
     * @returns {{ simulatedCuts: Array<Object>, outgoingClip: Object|null, outgoingTime: number, incomingClip: Object|null, incomingTime: number }}
     */
    simulateRipple(draggedClipId, targetStartFrame, targetTrack = null, sourceCuts = null, isMovingBackwards = false) {
        const rawSource = sourceCuts || STATE.activeTimelineCuts || [];
        const base = rawSource.map(c => ({ ...c }));
        const clip = base.find(c => c.id === draggedClipId);
        if (!clip) return { simulatedCuts: base, outgoingClip: null, outgoingTime: 0, incomingClip: null, incomingTime: 0 };

        const fps = this.fps || 24;
        const clipKind = this.trackKindOf(clip.track);
        let finalTrackId = clip.track;
        if (targetTrack && targetTrack !== clip.track) {
            const t = this.getTrack(targetTrack);
            if (t && !t.locked && (t.kind || "video") === clipKind) {
                finalTrackId = targetTrack;
            }
        }

        const partner = clip.link_id
            ? base.find(c => c.id !== clip.id && c.link_id === clip.link_id)
            : null;

        let partnerTrackId = partner ? partner.track : null;
        if (clipKind === "video" && finalTrackId !== clip.track && partner) {
            const newAudioTrack = this.pairedAudioTrackId(finalTrackId);
            if (newAudioTrack) partnerTrackId = newAudioTrack;
        }

        const clipIn = clip.inFrame !== undefined ? clip.inFrame : Math.round(((clip.in || 0) * fps));
        const clipOut = clip.outFrame !== undefined ? clip.outFrame : Math.round(((clip.out || 0) * fps));
        const duration = Math.max(1, clipOut - clipIn);
        const origTrack = clip.track;
        const isFromTimeline = clip.timelineStartFrame !== undefined && clip.timelineStartFrame !== null && Number.isFinite(clip.timelineStartFrame);
        const origStart = isFromTimeline ? clip.timelineStartFrame : 0;
        const origEnd = origStart + duration;

        const partnerIn = partner ? (partner.inFrame !== undefined ? partner.inFrame : Math.round(((partner.in || 0) * fps))) : 0;
        const partnerOut = partner ? (partner.outFrame !== undefined ? partner.outFrame : Math.round(((partner.out || 0) * fps))) : 0;
        const partnerDur = partner ? Math.max(1, partnerOut - partnerIn) : 0;
        const origPartnerTrack = partner ? partner.track : null;
        const isPartnerFromTimeline = partner && partner.timelineStartFrame !== undefined && partner.timelineStartFrame !== null && Number.isFinite(partner.timelineStartFrame);
        const origPartnerStart = isPartnerFromTimeline ? partner.timelineStartFrame : 0;
        const origPartnerEnd = origPartnerStart + partnerDur;

        // FASE 1: RIPPLE EXTRACT NA ORIGEM (se o clipe já pertencia à timeline original)
        // Extrai o clipe e fecha o buraco deixado por ele: clipes posteriores na pista de origem recuam
        const compactedCuts = [];

        for (const c of base) {
            if (c.id === clip.id || (partner && c.id === partner.id)) {
                // Não inclui os clipes arrastados na base compactada da fase 1
                continue;
            }

            let cStart = c.timelineStartFrame ?? 0;

            // Fecha o espaço na pista original do clipe
            if (isFromTimeline && c.track === origTrack && cStart >= origEnd) {
                cStart = Math.max(0, cStart - duration);
                c.timelineStartFrame = cStart;
                c.timeline_start = cStart / fps;
            }

            // Fecha o espaço na pista original do parceiro A/V
            if (isFromTimeline && partner && isPartnerFromTimeline && c.track === origPartnerTrack && cStart >= origPartnerEnd) {
                cStart = Math.max(0, cStart - partnerDur);
                c.timelineStartFrame = cStart;
                c.timeline_start = cStart / fps;
            }

            compactedCuts.push(c);
        }

        // FASE 2: MAPEAMENTO DE COORDENADA DE INSERÇÃO NA TIMELINE COMPACTADA
        let insertFrame = Math.max(0, targetStartFrame);

        if (isFromTimeline && finalTrackId === origTrack) {
            if (targetStartFrame <= origStart) {
                // Arrastando para trás (ou na mesma posição de início original):
                insertFrame = targetStartFrame;
            } else if (targetStartFrame < origEnd) {
                // Dentro da zona original do clipe: volta para a posição original
                insertFrame = origStart;
            } else {
                // Arrastando para a frente além da sua posição original:
                // Como os clipes após origEnd recuaram duration na timeline compactada,
                // compensamos duration para mapear sobre os mesmos clipes sem buracos
                insertFrame = Math.max(origStart, targetStartFrame - duration);
            }
        }

        insertFrame = Math.max(0, insertFrame);
        const endFrame = insertFrame + duration;

        // FASE 3: METADADOS DO MONITOR 2-UP CONTEXTUAL
        const videoTrack = clipKind === "video" ? finalTrackId : (partner ? partner.track : finalTrackId);
        const underlyingVideoCuts = compactedCuts.filter(c => c.track === videoTrack);

        const draggedVideoClip = clipKind === "video" ? clip : partner;
        const draggedInFrame = (draggedVideoClip && draggedVideoClip.inFrame !== undefined)
            ? draggedVideoClip.inFrame
            : Math.round(((draggedVideoClip && draggedVideoClip.in) || 0) * fps);
        const draggedOutFrame = (draggedVideoClip && draggedVideoClip.outFrame !== undefined)
            ? draggedVideoClip.outFrame
            : (draggedInFrame + duration);

        const draggedHeadTime = draggedInFrame / fps;
        const draggedTailTime = Math.max(draggedInFrame, draggedOutFrame - 1) / fps;

        const cutAtStart = underlyingVideoCuts.find(c => {
            const cStart = c.timelineStartFrame || 0;
            const cEnd = cStart + (c.outFrame - c.inFrame);
            return cStart < insertFrame && cEnd > insertFrame;
        });

        const cutTouchingBefore = underlyingVideoCuts.find(c => {
            const cEnd = (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame);
            return cEnd === insertFrame;
        });

        const cutStartingAtStart = underlyingVideoCuts.find(c => (c.timelineStartFrame || 0) === insertFrame);

        let outgoingClip = null;
        let outgoingTime = 0;
        let incomingClip = null;
        let incomingTime = 0;

        const hasLeftNeighbor = Boolean(cutAtStart || cutTouchingBefore);
        const hasRightNeighbor = Boolean(cutAtStart || cutStartingAtStart);

        let showHead = false;
        if (hasLeftNeighbor && !hasRightNeighbor) {
            showHead = true;
        } else if (hasRightNeighbor && !hasLeftNeighbor) {
            showHead = false;
        } else if (hasLeftNeighbor && hasRightNeighbor) {
            showHead = Boolean(isMovingBackwards);
        } else {
            showHead = Boolean(isMovingBackwards);
        }

        if (showHead) {
            // Emenda Head (insertFrame):
            if (cutAtStart) {
                outgoingClip = cutAtStart;
                const offset = insertFrame - (cutAtStart.timelineStartFrame || 0);
                const cutFrame = cutAtStart.inFrame + Math.max(0, offset - 1);
                outgoingTime = cutFrame / fps;
            } else if (cutTouchingBefore) {
                outgoingClip = cutTouchingBefore;
                outgoingTime = Math.max(cutTouchingBefore.inFrame, cutTouchingBefore.outFrame - 1) / fps;
            }
            incomingClip = draggedVideoClip;
            incomingTime = draggedHeadTime;
        } else {
            // Emenda Tail (endFrame):
            outgoingClip = draggedVideoClip;
            outgoingTime = draggedTailTime;

            if (cutAtStart) {
                incomingClip = cutAtStart;
                const offset = insertFrame - (cutAtStart.timelineStartFrame || 0);
                const cutFrame = cutAtStart.inFrame + offset;
                incomingTime = cutFrame / fps;
            } else if (cutStartingAtStart) {
                incomingClip = cutStartingAtStart;
                incomingTime = cutStartingAtStart.inFrame / fps;
            }
        }

        // FASE 4: RIPPLE INSERT NA TIMELINE COMPACTADA
        clip.timelineStartFrame = insertFrame;
        clip.timeline_start = insertFrame / fps;
        clip.track = finalTrackId;

        if (partner) {
            partner.timelineStartFrame = insertFrame;
            partner.timeline_start = insertFrame / fps;
            if (partnerTrackId) partner.track = partnerTrackId;
        }

        compactedCuts.push(clip);
        if (partner) compactedCuts.push(partner);

        const ignored = [clip.id];
        if (partner) ignored.push(partner.id);

        const splitLinkMap = new Map();
        let cuts = this.rippleInsertTimeRange(finalTrackId, insertFrame, duration, ignored, compactedCuts, splitLinkMap);
        if (partner) {
            cuts = this.rippleInsertTimeRange(partnerTrackId || partner.track, insertFrame, partnerDur, ignored, cuts, splitLinkMap);
        }

        return {
            simulatedCuts: cuts,
            outgoingClip,
            outgoingTime,
            incomingClip,
            incomingTime
        };
    }

    /**
     * Abre espaço magnético (Ripple) inserindo durationFrames no ponto startFrame da pista.
     * Clipes subsequentes são empurrados e clipes cortados no meio são divididos.
     * Suporta encadeamento multipistas atômico via sourceCuts e preservação de vínculo A/V via splitLinkMap.
     * @param {string} trackId - ID da pista.
     * @param {number} startFrame - Ponto de inserção.
     * @param {number} durationFrames - Quantidade de frames a abrir.
     * @param {string[]} [ignoredClipIds=[]] - Clipes a ignorar.
     * @param {Array<Object>|null} [sourceCuts=null] - Lista base de cortes.
     * @param {Map<string, string>|null} [splitLinkMap=null] - Mapa compartilhado para sincronizar link_id em splits A/V.
     * @returns {Array<Object>} Lista atualizada de cortes.
     */
    rippleInsertTimeRange(trackId, startFrame, durationFrames, ignoredClipIds = [], sourceCuts = null, splitLinkMap = null) {
        const cuts = sourceCuts || STATE.activeTimelineCuts || [];
        const fps = this.fps || 24;
        const newCuts = [];

        for (const c of cuts) {
            if (c.track !== trackId || ignoredClipIds.includes(c.id)) {
                newCuts.push(c);
                continue;
            }

            const cIn = c.inFrame !== undefined ? c.inFrame : Math.round(((c.in || 0) * fps));
            const cOut = c.outFrame !== undefined ? c.outFrame : Math.round(((c.out || 0) * fps));
            const cDur = Math.max(1, cOut - cIn);
            const cStart = c.timelineStartFrame || 0;
            const cEnd = cStart + cDur;

            if (cStart >= startFrame) {
                newCuts.push({
                    ...c,
                    inFrame: cIn,
                    outFrame: cOut,
                    in: c.in !== undefined ? c.in : cIn / fps,
                    out: c.out !== undefined ? c.out : cOut / fps,
                    timelineStartFrame: cStart + durationFrames,
                    timeline_start: (cStart + durationFrames) / fps
                });
            } else if (cStart < startFrame && cEnd > startFrame) {
                const leftDur = startFrame - cStart;
                // Parte esquerda permanece
                newCuts.push({
                    ...c,
                    inFrame: cIn,
                    in: c.in !== undefined ? c.in : cIn / fps,
                    outFrame: cIn + leftDur,
                    out: (cIn + leftDur) / fps
                });

                // Parte direita empurrada: reutiliza stamp compartilhado via splitLinkMap
                let stamp = null;
                if (c.link_id && splitLinkMap) {
                    if (splitLinkMap.has(c.link_id)) {
                        stamp = splitLinkMap.get(c.link_id);
                    } else {
                        stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                        splitLinkMap.set(c.link_id, stamp);
                    }
                } else {
                    stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                }
                const isAudio = this.trackKindOf(trackId) === "audio";
                newCuts.push({
                    ...c,
                    id: `cut_${stamp}_${isAudio ? "a" : "v"}`,
                    timelineStartFrame: startFrame + durationFrames,
                    timeline_start: (startFrame + durationFrames) / fps,
                    inFrame: cIn + leftDur,
                    in: (cIn + leftDur) / fps,
                    outFrame: cOut,
                    out: c.out !== undefined ? c.out : cOut / fps,
                    link_id: c.link_id ? `link_${stamp}` : null
                });
            } else {
                newCuts.push(c);
            }
        }

        return newCuts;
    }

    // ── FERRAMENTAS DE EDIÇÃO E SELEÇÃO (NLE TOOLS) ───────────────────

    /**
     * Define a ferramenta ativa ("select", "marquee", "blade", "slip", "slide", "rolling", "rate-stretch", "hand", "zoom", "track-forward", "track-backward").
     */
    setTool(tool) {
        const validTools = [
            "select", "marquee", "blade", "slip", "slide", "rolling", "rate-stretch", "hand", "zoom",
            "track-forward", "track-backward"
        ];
        if (!validTools.includes(tool)) return;
        this.activeTool = tool;
        STATE.emit("timelineToolChanged", this.activeTool);
    }

    /**
     * Seleciona todos os clipes nas pistas ativas a partir de fromFrame para a frente.
     * @param {number} fromFrame Frame inicial de corte.
     * @param {string|null} targetTrackId Se especificado (Shift pressionado), filtra apenas nesta pista.
     */
    selectTracksForward(fromFrame, targetTrackId = null) {
        const cuts = STATE.activeTimelineCuts || [];
        let activeTracks;
        if (targetTrackId) {
            const t = this.getTrack(targetTrackId);
            if (!t || t.locked || t.kind === "ai") {
                this.clearClipSelection();
                return [];
            }
            activeTracks = [targetTrackId];
        } else {
            activeTracks = this.tracks
                .filter(t => t.kind !== "ai" && !t.locked)
                .map(t => t.id);
        }

        const selected = cuts.filter(c => {
            if (!activeTracks.includes(c.track)) return false;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * this.fps);
            const inF = c.inFrame !== undefined ? c.inFrame : Math.round((c.in || 0) * this.fps);
            const outF = c.outFrame !== undefined ? c.outFrame : Math.round((c.out || 0) * this.fps);
            const end = start + Math.max(1, outF - inF);
            return start >= fromFrame || (start <= fromFrame && end > fromFrame);
        });

        const ids = selected.map(c => c.id);
        this.selectClips(ids);
        return selected;
    }

    /**
     * Seleciona todos os clipes nas pistas ativas a partir de fromFrame para trás.
     * @param {number} fromFrame Frame final de corte.
     * @param {string|null} targetTrackId Se especificado (Shift pressionado), filtra apenas nesta pista.
     */
    selectTracksBackward(fromFrame, targetTrackId = null) {
        const cuts = STATE.activeTimelineCuts || [];
        let activeTracks;
        if (targetTrackId) {
            const t = this.getTrack(targetTrackId);
            if (!t || t.locked || t.kind === "ai") {
                this.clearClipSelection();
                return [];
            }
            activeTracks = [targetTrackId];
        } else {
            activeTracks = this.tracks
                .filter(t => t.kind !== "ai" && !t.locked)
                .map(t => t.id);
        }

        const selected = cuts.filter(c => {
            if (!activeTracks.includes(c.track)) return false;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * this.fps);
            const inF = c.inFrame !== undefined ? c.inFrame : Math.round((c.in || 0) * this.fps);
            const outF = c.outFrame !== undefined ? c.outFrame : Math.round((c.out || 0) * this.fps);
            const end = start + Math.max(1, outF - inF);
            return end <= fromFrame || (start <= fromFrame && end > fromFrame);
        });

        const ids = selected.map(c => c.id);
        this.selectClips(ids);
        return selected;
    }

    /**
     * Seleciona um clipe específico, substituindo a seleção ou adicionando em modo multi.
     */
    selectClip(clipId, multi = false) {
        if (!multi) {
            this.selectedClipIds.clear();
        }
        if (clipId) {
            this.selectedClipIds.add(clipId);
            this.selectedClipId = clipId;
            const cut = (STATE.activeTimelineCuts || []).find(c => c.id === clipId);
            if (cut && cut.track) this.selectedTrack = cut.track;
        } else if (!multi) {
            this.selectedClipId = null;
        }
        this.clearSelectedGap();
        this.selectedGhostClipId = null;
        STATE.emit("timelineSelectionChanged", this.selectedClipId);
    }

    /**
     * Define uma lista de IDs de clipes selecionados.
     */
    selectClips(clipIds) {
        this.selectedClipIds = new Set(clipIds);
        this.selectedClipId = clipIds.length > 0 ? clipIds[0] : null;
        if (this.selectedClipId) {
            const cut = (STATE.activeTimelineCuts || []).find(c => c.id === this.selectedClipId);
            if (cut && cut.track) this.selectedTrack = cut.track;
        }
        this.clearSelectedGap();
        this.selectedGhostClipId = null;
        STATE.emit("timelineSelectionChanged", this.selectedClipId);
    }

    /**
     * Limpa a seleção de clipes ativa.
     */
    clearClipSelection() {
        this.selectedClipIds.clear();
        this.selectedClipId = null;
        STATE.emit("timelineSelectionChanged", null);
    }

    /**
     * Alterna a seleção de um clipe (Shift+Clique).
     */
    toggleClipSelection(clipId) {
        if (!clipId) return;
        if (this.selectedClipIds.has(clipId)) {
            this.selectedClipIds.delete(clipId);
            this.selectedClipId = this.selectedClipIds.size > 0 ? Array.from(this.selectedClipIds)[0] : null;
        } else {
            this.selectedClipIds.add(clipId);
            this.selectedClipId = clipId;
        }
        if (this.selectedClipId) {
            const cut = (STATE.activeTimelineCuts || []).find(c => c.id === this.selectedClipId);
            if (cut && cut.track) this.selectedTrack = cut.track;
        }
        this.clearSelectedGap();
        this.selectedGhostClipId = null;
        STATE.emit("timelineSelectionChanged", this.selectedClipId);
    }

    /**
     * Aplica resultado de seleção por retângulo / caixa (Marquee Selection) aos conjuntos de seleção ativos.
     * @param {Array<string>} clipIds IDs dos clipes interceptados pela caixa.
     * @param {Array<string>} markerIds IDs dos marcadores interceptados pela caixa.
     * @param {"replace"|"add"|"subtract"} mode Modo de combinação com a seleção inicial ("replace", "add", "subtract").
     * @param {Set<string>|Array<string>|null} initialClipIds Seleção inicial de clipes no início do arraste.
     * @param {Set<string>|Array<string>|null} initialMarkerIds Seleção inicial de marcadores no início do arraste.
     */
    applyMarqueeSelection(clipIds = [], markerIds = [], mode = "replace", initialClipIds = null, initialMarkerIds = null) {
        const baseClips = initialClipIds ? new Set(initialClipIds) : new Set(this.selectedClipIds || []);
        if (!initialClipIds && this.selectedClipId) baseClips.add(this.selectedClipId);

        const baseMarkers = initialMarkerIds ? new Set(initialMarkerIds) : new Set(this.selectedMarkerIds || []);

        let nextClips = new Set();
        let nextMarkers = new Set();

        if (mode === "add") {
            nextClips = new Set([...baseClips, ...clipIds]);
            nextMarkers = new Set([...baseMarkers, ...markerIds]);
        } else if (mode === "subtract") {
            nextClips = new Set(baseClips);
            for (const cid of clipIds) nextClips.delete(cid);
            nextMarkers = new Set(baseMarkers);
            for (const mid of markerIds) nextMarkers.delete(mid);
        } else {
            // "replace"
            nextClips = new Set(clipIds);
            nextMarkers = new Set(markerIds);
        }

        this.selectedClipIds = nextClips;
        this.selectedClipId = nextClips.size > 0 ? Array.from(nextClips)[0] : null;
        if (this.selectedClipId) {
            const cut = (STATE.activeTimelineCuts || []).find(c => c.id === this.selectedClipId);
            if (cut && cut.track) this.selectedTrack = cut.track;
        }
        this.selectedMarkerIds = nextMarkers;
        this.clearSelectedGap();
        this.selectedGhostClipId = null;
        STATE.emit("timelineSelectionChanged", this.selectedClipId);

        return {
            selectedClipIds: Array.from(nextClips),
            selectedMarkerIds: Array.from(nextMarkers)
        };
    }

    /**
     * Lift Delete de todos os clipes atualmente selecionados.
     */
    liftDeleteSelectedClips() {
        if (!this.selectedClipIds || this.selectedClipIds.size === 0) {
            if (this.selectedClipId) return this.liftDeleteClip(this.selectedClipId);
            return false;
        }
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const toDeleteIds = new Set(this.selectedClipIds);

            // Inclui parceiros vinculados (link_id)
            cuts.forEach(c => {
                if (toDeleteIds.has(c.id) && c.link_id) {
                    cuts.forEach(partner => {
                        if (partner.link_id === c.link_id) toDeleteIds.add(partner.id);
                    });
                }
            });

            const remaining = cuts.filter(c => !toDeleteIds.has(c.id));
            this.clearClipSelection();
            STATE.activeTimelineCuts = remaining;
        });
        return true;
    }

    /**
     * Ripple Delete de todos os clipes selecionados.
     */
    rippleDeleteSelectedClips() {
        if (!this.selectedClipIds || this.selectedClipIds.size === 0) {
            if (this.selectedClipId) return this.rippleDeleteClip(this.selectedClipId);
            return false;
        }
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const toDeleteIds = new Set(this.selectedClipIds);

            cuts.forEach(c => {
                if (toDeleteIds.has(c.id) && c.link_id) {
                    cuts.forEach(partner => {
                        if (partner.link_id === c.link_id) toDeleteIds.add(partner.id);
                    });
                }
            });

            const selectedCuts = cuts.filter(c => toDeleteIds.has(c.id));
            if (selectedCuts.length === 0) return;

            let minStart = Infinity;
            let maxEnd = -Infinity;
            selectedCuts.forEach(c => {
                const start = c.timelineStartFrame || 0;
                const dur = c.outFrame - c.inFrame;
                if (start < minStart) minStart = start;
                if (start + dur > maxEnd) maxEnd = start + dur;
            });

            const durationFrames = Math.max(0, maxEnd - minStart);
            const syncTracks = this.getSyncLockedTrackIds();
            const remaining = cuts.filter(c => !toDeleteIds.has(c.id));

            remaining.forEach(c => {
                if (syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= maxEnd - 1) {
                    c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) - durationFrames);
                    c.timeline_start = c.timelineStartFrame / this.fps;
                }
            });

            this.clearClipSelection();
            STATE.activeTimelineCuts = remaining;
        });
        return true;
    }

    /**
     * Nudge (deslocamento) de 1 ou N frames para todos os clipes selecionados.
     */
    nudgeSelectedClips(deltaFrames) {
        if (!this.selectedClipIds || this.selectedClipIds.size === 0) {
            if (this.selectedClipId) {
                const cut = STATE.activeTimelineCuts.find(c => c.id === this.selectedClipId);
                if (cut) {
                    const newStart = Math.max(0, (cut.timelineStartFrame || 0) + deltaFrames);
                    TIMELINE_HISTORY.record(() => {
                        cut.timelineStartFrame = newStart;
                        cut.timeline_start = newStart / this.fps;
                        STATE.activeTimelineCuts = [...STATE.activeTimelineCuts];
                    });
                    return true;
                }
            }
            return false;
        }

        const cuts = STATE.activeTimelineCuts;
        const selectedCuts = cuts.filter(c => this.selectedClipIds.has(c.id));
        if (selectedCuts.length === 0) return false;

        const minStart = Math.min(...selectedCuts.map(c => c.timelineStartFrame || 0));
        const effectiveDelta = Math.max(-minStart, deltaFrames);
        if (effectiveDelta === 0 && deltaFrames < 0) return false;

        TIMELINE_HISTORY.record(() => {
            selectedCuts.forEach(c => {
                c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) + effectiveDelta);
                c.timeline_start = c.timelineStartFrame / this.fps;
            });
            STATE.activeTimelineCuts = [...cuts];
        });
        return true;
    }

    selectGap(gap) {
        this.selectedGap = gap;
        if (gap) {
            this.selectedClipId = null;
            this.selectedClipIds.clear();
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
     * Ripple Trim / Ripple Delete até a posição da agulha (playhead).
     * @param {"head"|"tail"|"left"|"right"} side - "head"/"left": Início até a agulha (Q); "tail"/"right": Agulha até o fim (W).
     * @param {string|null} targetClipId - ID opcional de um clipe específico.
     * @returns {boolean} true se realizou o corte com sucesso, false caso contrário.
     */
    rippleTrimToPlayhead(side = "head", targetClipId = null) {
        const isHead = side === "head" || side === "left" || side === "prev";
        const playhead = this.playheadFrame;
        const cuts = [...STATE.activeTimelineCuts];
        if (cuts.length === 0) return false;

        // 1. Determina clipes candidatos
        let candidates = [];
        if (targetClipId) {
            const c = cuts.find(item => item.id === targetClipId);
            if (c) candidates.push(c);
        } else if (this.selectedClipIds && this.selectedClipIds.size > 0) {
            candidates = cuts.filter(c => this.selectedClipIds.has(c.id));
        } else if (this.selectedClipId) {
            const c = cuts.find(item => item.id === this.selectedClipId);
            if (c) candidates.push(c);
        }

        const coversPlayhead = (c) => {
            const start = c.timelineStartFrame || 0;
            const dur = (c.outFrame || 0) - (c.inFrame || 0);
            const end = start + dur;
            return start < playhead && playhead < end;
        };

        let intersecting = candidates.filter(coversPlayhead);

        // Se nenhum clipe selecionado intersecta a agulha, busca na pista ativa ou pistas sincronizadas
        if (intersecting.length === 0) {
            if (this.selectedTrack) {
                const trackClip = cuts.find(c => c.track === this.selectedTrack && coversPlayhead(c));
                if (trackClip) intersecting.push(trackClip);
            }
            if (intersecting.length === 0) {
                const syncTracks = this.getSyncLockedTrackIds();
                intersecting = cuts.filter(c => syncTracks.includes(c.track) && coversPlayhead(c));
            }
            if (intersecting.length === 0) {
                intersecting = cuts.filter(coversPlayhead);
            }
        }

        if (intersecting.length === 0) {
            // Se a agulha estiver em um gap selecionado e for corte de início
            if (isHead && this.selectedGap) {
                const gap = this.selectedGap;
                this.rippleDeleteGap(gap.trackId, gap.startFrame, gap.durationFrames);
                return true;
            }
            return false;
        }

        // Inclui parceiros vinculados (link_id) para manter sincronismo de áudio e vídeo
        const targetIds = new Set(intersecting.map(c => c.id));
        cuts.forEach(c => {
            if (c.link_id && intersecting.some(t => t.link_id === c.link_id)) {
                targetIds.add(c.id);
            }
        });
        const finalTargets = cuts.filter(c => targetIds.has(c.id));

        TIMELINE_HISTORY.record(() => {
            const fps = this.fps;
            const syncTracks = this.getSyncLockedTrackIds();

            if (isHead) {
                // --- RIPPLE TRIM DO INÍCIO ATÉ A AGULHA (Q) ---
                // O trecho [cStart .. playhead] é descartado, mantendo [playhead .. cEnd]
                let maxTrimDuration = 0;
                let minStart = Infinity;
                let maxEnd = -Infinity;

                finalTargets.forEach(c => {
                    const cStart = c.timelineStartFrame || 0;
                    const cDur = (c.outFrame || 0) - (c.inFrame || 0);
                    const cEnd = cStart + cDur;
                    if (cStart < playhead && playhead < cEnd) {
                        const delta = playhead - cStart;
                        if (delta > maxTrimDuration) maxTrimDuration = delta;
                        if (cStart < minStart) minStart = cStart;
                        if (cEnd > maxEnd) maxEnd = cEnd;

                        c.inFrame += delta;
                        c.in = c.inFrame / fps;
                        // O clipe resultante recua para cStart (fechando o início descartado)
                        c.timelineStartFrame = cStart;
                        c.timeline_start = cStart / fps;
                    }
                });

                if (maxTrimDuration <= 0) return;

                // Desloca todos os clipes subsequentes nas pistas com Sync Lock ativo
                cuts.forEach(c => {
                    if (!targetIds.has(c.id) && syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= minStart + maxTrimDuration - 1) {
                        c.timelineStartFrame = Math.max(minStart, (c.timelineStartFrame || 0) - maxTrimDuration);
                        c.timeline_start = c.timelineStartFrame / fps;
                    }
                });

                STATE.activeTimelineCuts = cuts;

                // Posiciona a agulha no início do clipe resultante
                if (minStart !== Infinity) {
                    this.setPlayheadFrame(minStart);
                }
            } else {
                // --- RIPPLE TRIM DA AGULHA ATÉ O FIM (W) ---
                // O trecho [playhead .. cEnd] é descartado, mantendo [cStart .. playhead]
                let maxTrimDuration = 0;
                let minStart = Infinity;
                let maxEnd = -Infinity;

                finalTargets.forEach(c => {
                    const cStart = c.timelineStartFrame || 0;
                    const cDur = (c.outFrame || 0) - (c.inFrame || 0);
                    const cEnd = cStart + cDur;
                    if (cStart < playhead && playhead < cEnd) {
                        const delta = cEnd - playhead;
                        if (delta > maxTrimDuration) maxTrimDuration = delta;
                        if (cStart < minStart) minStart = cStart;
                        if (cEnd > maxEnd) maxEnd = cEnd;

                        c.outFrame = c.inFrame + (playhead - cStart);
                        c.out = c.outFrame / fps;
                        c.timelineStartFrame = cStart;
                        c.timeline_start = cStart / fps;
                    }
                });

                if (maxTrimDuration <= 0) return;

                // Desloca todos os clipes subsequentes nas pistas com Sync Lock ativo
                cuts.forEach(c => {
                    if (!targetIds.has(c.id) && syncTracks.includes(c.track) && (c.timelineStartFrame || 0) >= playhead - 1) {
                        c.timelineStartFrame = Math.max(playhead, (c.timelineStartFrame || 0) - maxTrimDuration);
                        c.timeline_start = c.timelineStartFrame / fps;
                    }
                });

                STATE.activeTimelineCuts = cuts;

                // A agulha permanece na posição do playhead
                this.setPlayheadFrame(playhead);
            }
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
        const newFrame = Math.max(0, val);
        if (this.playheadFrame === newFrame) return;
        this.playheadFrame = newFrame;
        STATE.emit("timelinePlayheadChanged", this.playheadFrame);
    }

    /**
     * Retorna a duração total da timeline em frames (posição final do último clipe).
     * @returns {number}
     */
    getDurationFrames() {
        const cuts = STATE.activeTimelineCuts || [];
        let maxFrame = 0;
        cuts.forEach(cut => {
            const start = typeof cut.timelineStartFrame === "number" ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * this.fps);
            const inF = cut.inFrame !== undefined ? cut.inFrame : Math.round((cut.in || 0) * this.fps);
            const outF = cut.outFrame !== undefined ? cut.outFrame : Math.round((cut.out || 0) * this.fps);
            const dur = Math.max(0, outF - inF);
            const end = start + dur;
            if (end > maxFrame) maxFrame = end;
        });
        return maxFrame;
    }

    /**
     * Retorna todos os pontos de corte da timeline (inícios e fins de cada clipe, além do frame 0),
     * ordenados de forma crescente e sem duplicatas.
     * @returns {number[]}
     */
    getAllEditPointFrames() {
        const cuts = STATE.activeTimelineCuts || [];
        const points = new Set([0]);
        cuts.forEach(cut => {
            const start = typeof cut.timelineStartFrame === "number" ? cut.timelineStartFrame : Math.round((cut.timeline_start || 0) * this.fps);
            const inF = cut.inFrame !== undefined ? cut.inFrame : Math.round((cut.in || 0) * this.fps);
            const outF = cut.outFrame !== undefined ? cut.outFrame : Math.round((cut.out || 0) * this.fps);
            const dur = Math.max(0, outF - inF);
            if (typeof start === "number" && !isNaN(start) && start >= 0) {
                const s = Math.round(start);
                points.add(s);
                points.add(Math.round(s + dur));
            }
        });
        return Array.from(points).sort((a, b) => a - b);
    }

    /**
     * Retorna todos os frames de início dos clipes presentes na timeline.
     * Mantido para compatibilidade.
     * @returns {number[]}
     */
    getAllClipStartFrames() {
        return this.getAllEditPointFrames();
    }

    /**
     * Retorna o ponto de corte anterior (início ou fim de clipe) ao frame informado.
     * Se o playhead já estiver no primeiro ponto ou antes, retorna 0 (início da timeline).
     * @param {number} currentFrame
     * @returns {number}
     */
    getPrevEditPointFrame(currentFrame = this.playheadFrame) {
        const points = this.getAllEditPointFrames();
        const cur = Math.round(currentFrame);
        const prev = points.filter(p => p < cur);
        if (prev.length > 0) {
            return prev[prev.length - 1];
        }
        return 0;
    }

    getPrevClipStartFrame(currentFrame = this.playheadFrame) {
        return this.getPrevEditPointFrame(currentFrame);
    }

    /**
     * Retorna o próximo ponto de corte (início ou fim de clipe) posterior ao frame informado.
     * Se não houver corte seguinte, retorna a duração total da timeline (fim do último clipe).
     * @param {number} currentFrame
     * @returns {number}
     */
    getNextEditPointFrame(currentFrame = this.playheadFrame) {
        const points = this.getAllEditPointFrames();
        const cur = Math.round(currentFrame);
        const next = points.find(p => p > cur);
        if (next !== undefined) {
            return next;
        }
        const totalDur = this.getDurationFrames();
        return cur < totalDur ? totalDur : cur;
    }

    getNextClipStartFrame(currentFrame = this.playheadFrame) {
        return this.getNextEditPointFrame(currentFrame);
    }

    /**
     * Move a agulha (playhead) para o ponto de corte anterior (início/fim de clipe ou início da timeline).
     * @returns {number} O frame para onde a agulha foi movida.
     */
    moveToPrevEditPoint() {
        const targetFrame = this.getPrevEditPointFrame(this.playheadFrame);
        this.setPlayheadFrame(targetFrame);
        return targetFrame;
    }

    moveToPrevClipStart() {
        return this.moveToPrevEditPoint();
    }

    /**
     * Move a agulha (playhead) para o próximo ponto de corte (início/fim de clipe ou fim da timeline).
     * @returns {number} O frame para onde a agulha foi movida.
     */
    moveToNextEditPoint() {
        const targetFrame = this.getNextEditPointFrame(this.playheadFrame);
        this.setPlayheadFrame(targetFrame);
        return targetFrame;
    }

    moveToNextClipStart() {
        return this.moveToNextEditPoint();
    }

    // ── CLIPES ──────────────────────────────────────────────────────────

    /**
     * Retorna a duração máxima em frames da mídia bruta do clipe.
     * Para mídias com fim determinado (vídeo, áudio), retorna o número total de frames.
     * Para fotos e títulos (geradores estáticos), retorna Infinity.
     * @param {Object} clip - Corte da timeline.
     * @returns {number} Duração máxima em frames ou Infinity.
     */
    getMaxMediaFrames(clip) {
        if (!clip) return Infinity;
        if (clip.type === "photo" || clip.photo_id || clip.type === "text" || clip.textCategory) {
            return Infinity;
        }
        const fps = this.fps || 24;
        if (clip.mediaDurationFrames !== undefined && clip.mediaDurationFrames !== null && Number.isFinite(clip.mediaDurationFrames)) {
            return clip.mediaDurationFrames;
        }
        if (clip.sourceDuration !== undefined && clip.sourceDuration !== null && Number.isFinite(clip.sourceDuration)) {
            return Math.round(clip.sourceDuration * fps);
        }
        if (clip.media_duration !== undefined && clip.media_duration !== null && Number.isFinite(clip.media_duration)) {
            return Math.round(clip.media_duration * fps);
        }
        if (clip.video_id && typeof STATE !== "undefined" && Array.isArray(STATE.allVideos)) {
            const v = STATE.allVideos.find(vid => String(vid.id) === String(clip.video_id));
            if (v && v.duration && Number.isFinite(v.duration)) {
                return Math.round(v.duration * fps);
            }
        }
        return Infinity;
    }

    /**
     * Garante que cortes vindos do JSON de salvamento ou de arrays dinâmicos
     * tenham sempre inFrame e outFrame inteiros válidos, in e out consistentes em segundos,
     * e respeitem rigidamente os limites de mídia bruta para evitar quadros congelados.
     * 
     * IMPORTANTE: frames de clipe são SEMPRE em fps da TIMELINE (não do vídeo fonte).
     * Misturar unidades fazia clipes de vídeos 30fps ocuparem mais timeline do que
     * têm de mídia (fim congelado) e desalinhava o playhead do Program.
     */
    conformCuts(cuts) {
        const fps = this.fps || 24;
        return cuts.map((cut, index) => {
            let inFrame = cut.inFrame !== undefined ? cut.inFrame : secondsToFrames(cut.in, fps);
            let outFrame = cut.outFrame !== undefined ? cut.outFrame : secondsToFrames(cut.out, fps);

            const maxMedia = this.getMaxMediaFrames(cut);
            if (Number.isFinite(maxMedia) && maxMedia > 0) {
                if (outFrame > maxMedia) outFrame = maxMedia;
            }
            if (inFrame < 0) inFrame = 0;

            const isText = cut.type === "text";
            const defaultTrack = isText ? "T1" : "V1";

            return {
                ...cut,
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: cut.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : framesToSeconds(inFrame, fps),
                out: cut.out !== undefined ? cut.out : framesToSeconds(outFrame, fps),
                track: cut.track || defaultTrack,
                timelineStartFrame: cut.timelineStartFrame,
                link_id: cut.link_id || null,
                // Garante objeto de keyframes inicializado se aplicável
                keyframes: cut.keyframes || {}
            };
        });
    }

    /**
     * Inserção avançada de mídias (vídeos ou fotos) na timeline com suporte a múltiplos modos:
     * - "playhead": na posição atual da agulha (padrão / duplo clique)
     * - "end": no final do último clipe da timeline (Shift + duplo clique)
     * - "first_gap": no primeiro espaço vazio a partir do frame 0 (Ctrl + duplo clique) -> agulha vai pro início
     * - "next_gap": no próximo espaço vazio após a agulha (Ctrl + Shift + duplo clique) -> agulha vai pro início
     * - "start": no início da timeline / Frame 0 (Alt + Shift + duplo clique) -> agulha vai pro início
     * - "ripple": ripple insert abrindo espaço na agulha (Alt + duplo clique)
     * - "overlay": sobreposição em pista superior / B-Roll (Ctrl + Alt + duplo clique)
     * - "replace": substitui o clipe selecionado na timeline mantendo posição
     *
     * @param {Object} params
     * @param {"video"|"photo"} [params.type="video"] Tipo da mídia
     * @param {number|string} params.id ID do vídeo ou foto
     * @param {number} [params.inSec] Ponto IN em segundos
     * @param {number} [params.outSec] Ponto OUT em segundos
     * @param {string} [params.mode="playhead"] Modo de inserção
     * @param {string} [params.targetTrack=null] Pista de destino opcional
     * @param {number} [params.timelineStartFrame=null] Frame inicial explícito
     * @returns {Object|null} Novo clipe adicionado ou substituído
     */
    insertMedia({ type = "video", id, inSec = null, outSec = null, mode = "playhead", targetTrack = null, timelineStartFrame = null } = {}) {
        if (!id) return null;
        const isVideo = type === "video";
        const video = isVideo ? (STATE.allVideos || []).find(v => v.id === id) : null;
        const photo = !isVideo ? (STATE.allPhotos || []).find(p => p.id === id) : null;

        // Auto-configuração no primeiro clipe de vídeo da timeline (Fase 2.3)
        if ((STATE.activeTimelineCuts || []).length === 0 && video) {
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

        const fps = this.fps || 24;

        // 1. Determina limites de tempo (In / Out)
        let actualInSec = 0.0;
        let actualOutSec = 5.0;

        if (isVideo) {
            const vidDur = (video && video.duration && video.duration > 0) ? video.duration : 5.0;
            actualInSec = (inSec !== null && inSec !== undefined) ? Number(inSec) : 0.0;
            actualOutSec = (outSec !== null && outSec !== undefined) ? Number(outSec) : vidDur;
            if (actualOutSec <= actualInSec) actualOutSec = actualInSec + vidDur;
        } else {
            actualInSec = 0.0;
            actualOutSec = (outSec !== null && outSec !== undefined) ? Number(outSec) : PHOTO_DEFAULT_DURATION;
        }

        const inFrame = Math.max(0, secondsToFrames(actualInSec, fps));
        const outFrame = Math.max(inFrame + 1, secondsToFrames(actualOutSec, fps));
        const durFrames = outFrame - inFrame;
        const effDurSec = durFrames / fps;

        // 2. Determina Pista de Destino
        let track = targetTrack;
        const videoTracks = this.getVideoTracks().filter(t => !t.locked);

        if (mode === "overlay") {
            const activeTrackId = this.selectedTrack || "V1";
            const curIdx = videoTracks.findIndex(t => t.id === activeTrackId);
            if (curIdx > 0) {
                track = videoTracks[curIdx - 1].id;
            } else if (videoTracks.some(t => t.id === "V2") && activeTrackId !== "V2") {
                track = "V2";
            } else {
                const newT = this.addVideoTrack();
                track = newT ? newT.id : (videoTracks[0] || { id: "V1" }).id;
            }
        } else if (!track) {
            if (this.selectedTrack) {
                const tObj = this.getTrack(this.selectedTrack);
                if (tObj && tObj.kind === "video" && !tObj.locked) {
                    track = this.selectedTrack;
                }
            }
            if (!track) {
                const v2 = videoTracks.find(t => t.id === "V2");
                const v1 = videoTracks.find(t => t.id === "V1");
                if (!isVideo || (video && video.video_type === "broll")) {
                    track = (v2 || v1 || videoTracks[0] || { id: "V1" }).id;
                } else {
                    track = (v1 || videoTracks[0] || { id: "V1" }).id;
                }
            }
        }

        // 3. Determina Start Frame & Posição da Agulha
        const currentCuts = this.conformCuts(STATE.activeTimelineCuts || []);
        let startFrame = 0;
        let setPlayheadAtStart = false;

        if (timelineStartFrame !== null && timelineStartFrame !== undefined) {
            startFrame = Math.max(0, Math.round(timelineStartFrame));
        } else if (mode === "end") {
            const lastFrame = currentCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
            startFrame = lastFrame;
        } else if (mode === "start") {
            startFrame = 0;
            setPlayheadAtStart = true;
        } else if (mode === "first_gap") {
            const gaps = this.getTrackGaps(track);
            if (gaps.length > 0) {
                startFrame = gaps[0].startFrame;
            } else {
                const trackCuts = currentCuts.filter(c => c.track === track);
                startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
            }
            setPlayheadAtStart = true;
        } else if (mode === "next_gap") {
            const curPlayhead = (this.playheadFrame !== null && this.playheadFrame !== undefined) ? this.playheadFrame : 0;
            const gaps = this.getTrackGaps(track);
            const nextGap = gaps.find(g => g.endFrame > curPlayhead);
            if (nextGap) {
                startFrame = Math.max(curPlayhead, nextGap.startFrame);
            } else {
                const trackCuts = currentCuts.filter(c => c.track === track);
                startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
            }
            setPlayheadAtStart = true;
        } else if (mode === "replace") {
            const selClip = currentCuts.find(c => c.id === this.selectedClipId);
            if (selClip) {
                startFrame = selClip.timelineStartFrame || 0;
                track = selClip.track || track;
            } else {
                startFrame = (this.playheadFrame !== null && this.playheadFrame !== undefined) ? this.playheadFrame : 0;
            }
        } else {
            // "playhead", "ripple", "overlay"
            startFrame = (this.playheadFrame !== null && this.playheadFrame !== undefined) ? this.playheadFrame : 0;
        }

        startFrame = Math.max(0, Math.round(startFrame));

        // Prevenção de Sobreposição na Ingestão (Task 3.5):
        // Se estiver em modo clamp e inserindo na agulha, nunca coloca um clipe em cima de outro.
        if (this.dragCollisionMode === "clamp" && (mode === "playhead" || mode === "overlay")) {
            const hasCollision = (tId, sf, dur) => {
                const cutsOnTrack = currentCuts.filter(c => c.track === tId);
                return cutsOnTrack.some(c => {
                    const cStart = c.timelineStartFrame || 0;
                    const cEnd = cStart + (c.outFrame - c.inFrame);
                    return sf < cEnd && (sf + dur) > cStart;
                });
            };

            const audioTId = isVideo ? this.pairedAudioTrackId(track) : null;
            const isCollision = hasCollision(track, startFrame, durFrames) ||
                (audioTId && hasCollision(audioTId, startFrame, durFrames));

            if (isCollision) {
                // 1. Tenta achar uma pista de vídeo alternativa livre no ponto da agulha
                let placedOnAlternative = false;
                for (const altTrack of videoTracks) {
                    const altAudio = this.pairedAudioTrackId(altTrack.id);
                    if (!hasCollision(altTrack.id, startFrame, durFrames) &&
                        (!altAudio || !hasCollision(altAudio, startFrame, durFrames))) {
                        track = altTrack.id;
                        placedOnAlternative = true;
                        break;
                    }
                }

                // 2. Se todas as pistas estiverem ocupadas no ponto da agulha:
                if (!placedOnAlternative) {
                    // Busca o primeiro gap disponível a partir da agulha que caiba o clipe
                    const gaps = this.getTrackGaps(track, [], true);
                    const gapAfterPlayhead = gaps.find(g => g.startFrame >= startFrame && g.durationFrames >= durFrames);
                    if (gapAfterPlayhead) {
                        startFrame = gapAfterPlayhead.startFrame;
                    } else {
                        // Sem gaps suficientes: posiciona no final da timeline nessa pista
                        const trackCuts = currentCuts.filter(c => c.track === track);
                        startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
                    }
                }
            }
        }

        // 4. Executa a Ingestão com Histórico (Undo/Redo)
        const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const audioTrackId = isVideo ? this.pairedAudioTrackId(track) : null;
        const linkId = audioTrackId ? `link_${stamp}` : null;

        let createdCut = null;

        TIMELINE_HISTORY.record(() => {
            let workingCuts = [...currentCuts];

            // A) Modo Replace: Remove o clipe selecionado e parceiro de áudio
            if (mode === "replace" && this.selectedClipId) {
                const selId = this.selectedClipId;
                const selClip = workingCuts.find(c => c.id === selId);
                const partnerLinkId = selClip?.link_id;
                workingCuts = workingCuts.filter(c => c.id !== selId && (!partnerLinkId || c.link_id !== partnerLinkId));
            }

            // B) Modo Ripple: Empurra clipes subsequentes e divide cortes intersectados
            if (mode === "ripple") {
                const splitAndShift = [];
                for (const c of workingCuts) {
                    const cStart = c.timelineStartFrame || 0;
                    const cDur = c.outFrame - c.inFrame;
                    const cEnd = cStart + cDur;

                    if (cStart >= startFrame) {
                        splitAndShift.push({
                            ...c,
                            timelineStartFrame: cStart + durFrames,
                            timeline_start: (cStart + durFrames) / fps
                        });
                    } else if (cStart < startFrame && cEnd > startFrame) {
                        const offsetFrames = startFrame - cStart;
                        const newLink = c.link_id ? `link_${Date.now()}_${Math.floor(Math.random()*900+100)}` : null;

                        splitAndShift.push({
                            ...c,
                            outFrame: c.inFrame + offsetFrames,
                            out: (c.inFrame + offsetFrames) / fps
                        });

                        splitAndShift.push({
                            ...c,
                            id: `cut_${Date.now()}_${Math.floor(Math.random()*900+100)}_${c.id.endsWith("_a") ? "a" : "v"}`,
                            timelineStartFrame: startFrame + durFrames,
                            timeline_start: (startFrame + durFrames) / fps,
                            inFrame: c.inFrame + offsetFrames,
                            in: (c.inFrame + offsetFrames) / fps,
                            link_id: newLink
                        });
                    } else {
                        splitAndShift.push(c);
                    }
                }
                workingCuts = splitAndShift;
            }

            // C) Criação do novo corte
            if (isVideo) {
                createdCut = {
                    id: `cut_${stamp}`,
                    type: "video",
                    video_id: id,
                    inFrame: inFrame,
                    outFrame: outFrame,
                    in: actualInSec,
                    out: actualOutSec,
                    track: track,
                    timelineStartFrame: startFrame,
                    timeline_start: startFrame / fps,
                    link_id: linkId
                };
                workingCuts.push(createdCut);

                if (audioTrackId) {
                    workingCuts.push({
                        id: `cut_${stamp}_a`,
                        type: "video",
                        video_id: id,
                        inFrame: inFrame,
                        outFrame: outFrame,
                        in: actualInSec,
                        out: actualOutSec,
                        track: audioTrackId,
                        timelineStartFrame: startFrame,
                        timeline_start: startFrame / fps,
                        link_id: linkId
                    });
                }
            } else {
                createdCut = {
                    id: `cut_${stamp}`,
                    type: "photo",
                    photo_id: id,
                    video_id: null,
                    inFrame: 0,
                    outFrame: durFrames,
                    in: 0,
                    out: effDurSec,
                    track: track,
                    timelineStartFrame: startFrame,
                    timeline_start: startFrame / fps,
                    link_id: null,
                    effects: [{ type: "fit", mode: "fill" }]
                };
                workingCuts.push(createdCut);
            }

            STATE.activeTimelineCuts = workingCuts;
        });

        // 5. Ajuste da Agulha (Playhead), Seleção e Centralização
        if (createdCut) {
            this.selectedClipId = createdCut.id;
            this.selectedClipIds = new Set([createdCut.id]);
            this.selectedTrack = track;
            STATE.emit("timelineClipSelected", createdCut.id);
        }

        if (typeof this.setPlayheadFrame === "function") {
            this.setPlayheadFrame(startFrame);
        }
        if (typeof window !== "undefined" && window.TIMELINE_INTERACTION && typeof window.TIMELINE_INTERACTION.ensureFrameVisible === "function") {
            window.TIMELINE_INTERACTION.ensureFrameVisible(startFrame);
        }

        // 6. Foco e Notificação
        window.activeFocusedPlayer = "program";
        const mediaTitle = isVideo ? (video?.title || video?.filename || "Vídeo") : (photo?.title || photo?.filename || "Foto");
        const modeLabels = {
            playhead: "na agulha",
            end: "no final da timeline",
            first_gap: "no 1º espaço vazio",
            next_gap: "no próximo espaço vazio",
            start: "no início da timeline (Frame 0)",
            ripple: "com empurrão (Ripple Insert)",
            overlay: `sobreposto em ${track}`,
            replace: "substituindo clipe"
        };
        const label = modeLabels[mode] || "na timeline";

        STATE.emit("statusChanged", { text: `"${mediaTitle}" inserido ${label}.`, active: true });
        if (typeof window.showToast === "function") {
            window.showToast(`${isVideo ? 'Vídeo' : 'Foto'} inserido ${label}!`, "success");
        }

        return createdCut;
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
        const trackCuts = (STATE.activeTimelineCuts || []).filter(c => c.track === track);
        const durFrames = outFrame - inFrame;

        if (startFrame === null || startFrame === undefined) {
            startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
        } else if (this.dragCollisionMode === "clamp") {
            const hasCollision = trackCuts.some(c => {
                const cStart = c.timelineStartFrame || 0;
                const cEnd = cStart + (c.outFrame - c.inFrame);
                return startFrame < cEnd && (startFrame + durFrames) > cStart;
            });
            if (hasCollision) {
                // Tenta achar outra pista de vídeo livre no mesmo startFrame
                const videoTracks = this.getVideoTracks().filter(t => !t.locked);
                let placed = false;
                for (const alt of videoTracks) {
                    const altCuts = (STATE.activeTimelineCuts || []).filter(c => c.track === alt.id);
                    if (!altCuts.some(c => startFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame)) && (startFrame + durFrames) > c.timelineStartFrame)) {
                        track = alt.id;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    const gaps = this.getTrackGaps(track, [], true);
                    const fitGap = gaps.find(g => g.startFrame >= startFrame && g.durationFrames >= durFrames);
                    if (fitGap) {
                        startFrame = fitGap.startFrame;
                    } else {
                        startFrame = trackCuts.reduce((max, c) => Math.max(max, (c.timelineStartFrame || 0) + (c.outFrame - c.inFrame)), 0);
                    }
                }
            }
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
            this.selectedClipId = newCut.id;
            this.selectedClipIds = new Set([newCut.id]);
            this.selectedTrack = track;
            if (typeof this.setPlayheadFrame === "function") {
                this.setPlayheadFrame(Math.max(0, Math.round(startFrame)));
            }
            if (typeof window !== "undefined" && window.TIMELINE_INTERACTION && typeof window.TIMELINE_INTERACTION.ensureFrameVisible === "function") {
                window.TIMELINE_INTERACTION.ensureFrameVisible(Math.max(0, Math.round(startFrame)));
            }
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
     * Adiciona um novo clipe de TEXTO / TÍTULO / GC à timeline.
     * Suporta presets, keyframes paramétricos e personalização de tipografia.
     */
    addTextClip(textData = {}, startFrame = null, durationFrames = null, trackId = null) {
        const fps = this.fps || 24;
        const sFrame = startFrame !== null && startFrame !== undefined ? Math.round(startFrame) : this.playheadFrame;
        const durFrames = durationFrames !== null && durationFrames !== undefined ? Math.max(1, Math.round(durationFrames)) : Math.round(4 * fps); // 4s padrão

        let targetTrack = trackId;
        if (!targetTrack) {
            const textTracks = this.getTextTracks().filter(t => !t.locked && !t.hidden);
            targetTrack = textTracks.length > 0 ? textTracks[0].id : (this.getTextTracks()[0] || {}).id;
            if (!targetTrack) {
                const newT = this.addTextTrack();
                targetTrack = newT.id;
            }
        }

        const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const newClip = {
            id: textData.id || `txt_${stamp}`,
            type: "text",
            textCategory: textData.textCategory || textData.category || "lower_third",
            text: textData.text || "Novo Texto",
            subtext: textData.subtext || "",
            fontFamily: textData.fontFamily || "Outfit",
            fontSize: textData.fontSize !== undefined ? textData.fontSize : 36,
            fontWeight: textData.fontWeight || "700",
            fontStyle: textData.fontStyle || "normal",
            color: textData.color || "#ffffff",
            backgroundColor: textData.backgroundColor || "transparent",
            boxPadding: textData.boxPadding !== undefined ? textData.boxPadding : 8,
            boxBorderRadius: textData.boxBorderRadius !== undefined ? textData.boxBorderRadius : 4,
            alignment: textData.alignment || "center",
            posX: textData.posX !== undefined ? textData.posX : 0,
            posY: textData.posY !== undefined ? textData.posY : 360,
            scale: textData.scale !== undefined ? textData.scale : 1.0,
            rotation: textData.rotation !== undefined ? textData.rotation : 0,
            opacity: textData.opacity !== undefined ? textData.opacity : 1.0,
            tracking: textData.tracking !== undefined ? textData.tracking : 0,
            lineHeight: textData.lineHeight !== undefined ? textData.lineHeight : 1.2,
            keyframes: textData.keyframes ? JSON.parse(JSON.stringify(textData.keyframes)) : {},
            track: targetTrack,
            inFrame: 0,
            outFrame: durFrames,
            in: 0,
            out: durFrames / fps,
            timelineStartFrame: Math.max(0, sFrame),
            timeline_start: Math.max(0, sFrame) / fps,
            link_id: null
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts || []);
            currentCuts.push(newClip);
            STATE.activeTimelineCuts = currentCuts;
            this.selectedClipId = newClip.id;
            this.selectedClipIds.clear();
            this.selectedClipIds.add(newClip.id);
            STATE.emit("timelineSelectedClipChanged", newClip.id);
        });

        return newClip;
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
     * Divide um clipe específico no frame indicado (Lâmina / Blade Tool).
     * @param {string} clipId ID do clipe a ser fatiado.
     * @param {number} splitFrame Posição do frame onde o corte ocorrerá.
     * @param {boolean} splitLinked Se true (padrão), fatia também o clipe parceiro vinculado (ex: áudio/vídeo).
     * @returns {object|null} Retorna os clipes criados ou null se a operação não puder ser executada.
     */
    splitClipAtFrame(clipId, splitFrame, splitLinked = true) {
        let result = null;
        TIMELINE_HISTORY.record(() => {
            const currentCuts = [...STATE.activeTimelineCuts];
            const targetIdx = currentCuts.findIndex(c => c.id === clipId);
            if (targetIdx === -1) return;

            const clip = currentCuts[targetIdx];
            const track = this.getTrack(clip.track);
            if (track && track.locked) return;

            const fps = this.fps || 24;

            // Verifica se o frame intersecta o clipe estritamente
            const startFrame = clip.timelineStartFrame !== undefined ? clip.timelineStartFrame : Math.round((clip.timeline_start || 0) * fps);
            const durationFrames = clip.outFrame - clip.inFrame;
            const endFrame = startFrame + durationFrames;

            if (splitFrame <= startFrame || splitFrame >= endFrame) {
                return; // Ponto fora dos limites do clipe
            }

            // Descobrir se há clipe parceiro vinculado
            const partner = (splitLinked && clip.link_id)
                ? currentCuts.find(c => c.link_id === clip.link_id && c.id !== clip.id)
                : null;

            const partnerTrack = partner ? this.getTrack(partner.track) : null;
            const canSplitPartner = partner && (!partnerTrack || !partnerTrack.locked);

            const newLinkPartner = (clip.link_id && canSplitPartner)
                ? `link_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`
                : null;

            const doSplit = (c, linkId) => {
                const cStart = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                const offsetFrames = splitFrame - cStart;

                // Criar o segundo clipe (parte direita)
                const secondClip = {
                    ...c,
                    id: `cut_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}_${c.id.endsWith("_a") ? "a" : "v"}`,
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
                return secondClip;
            };

            const rightTarget = doSplit(clip, newLinkPartner);
            let rightPartner = null;

            if (canSplitPartner) {
                const pStart = partner.timelineStartFrame !== undefined ? partner.timelineStartFrame : Math.round((partner.timeline_start || 0) * fps);
                const pEnd = pStart + (partner.outFrame - partner.inFrame);
                if (splitFrame > pStart && splitFrame < pEnd) {
                    rightPartner = doSplit(partner, newLinkPartner);
                }
            }

            STATE.activeTimelineCuts = currentCuts;
            result = {
                leftClip: clip,
                rightClip: rightTarget,
                partnerRightClip: rightPartner
            };
        });
        return result;
    }

    /**
     * Divide todos os clipes que interceptam o frame em todas as pistas destravadas (Lâmina Global / Shift+C).
     * @param {number} splitFrame Frame onde o corte global ocorrerá.
     * @returns {Array<object>} Lista dos novos clipes gerados no lado direito.
     */
    splitAllTracksAtFrame(splitFrame) {
        let createdClips = [];
        TIMELINE_HISTORY.record(() => {
            const currentCuts = [...STATE.activeTimelineCuts];
            const fps = this.fps || 24;

            // Conjunto de IDs de pistas destravadas e ativas (não IA)
            const unlockedTrackIds = new Set(
                this.tracks.filter(t => !t.locked && t.kind !== "ai").map(t => t.id)
            );

            // Filtra clipes que cruzam o frame nas pistas destravadas
            const targets = currentCuts.filter(c => {
                if (!unlockedTrackIds.has(c.track)) return false;
                const s = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                const e = s + (c.outFrame - c.inFrame);
                return splitFrame > s && splitFrame < e;
            });

            if (targets.length === 0) return;

            // Mapa para compartilhar novos IDs de link entre parceiros divididos juntos
            const linkMap = new Map();

            for (const c of targets) {
                const cStart = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                const offsetFrames = splitFrame - cStart;

                let newLinkId = null;
                if (c.link_id) {
                    if (!linkMap.has(c.link_id)) {
                        linkMap.set(c.link_id, `link_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`);
                    }
                    newLinkId = linkMap.get(c.link_id);
                }

                const secondClip = {
                    ...c,
                    id: `cut_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}_${c.id.endsWith("_a") ? "a" : "v"}`,
                    timelineStartFrame: splitFrame,
                    timeline_start: splitFrame / fps,
                    inFrame: c.inFrame + offsetFrames,
                    in: (c.inFrame + offsetFrames) / fps,
                    link_id: newLinkId
                };

                c.outFrame = c.inFrame + offsetFrames;
                c.out = c.outFrame / fps;

                currentCuts.push(secondClip);
                createdClips.push(secondClip);
            }

            STATE.activeTimelineCuts = currentCuts;
        });
        return createdClips;
    }

    /**
     * Divide um clipe em dois no frame especificado (mantido para compatibilidade com btn-split-playhead).
     */
    splitClip(clipId, splitFrame) {
        return this.splitClipAtFrame(clipId, splitFrame, true);
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

    /**
     * Desliza o conteúdo interno de um clipe (Slip Tool), alterando inFrame e outFrame
     * sem alterar timelineStartFrame nem a duração do clipe na timeline.
     * 
     * @param {string} clipId ID do clipe a ser deslizado.
     * @param {number} deltaFrames Deslocamento relativo em frames (positivo avança no tempo do vídeo, negativo recua).
     * @param {boolean} [slipLinked=true] Se true, desliza também o par A/V vinculado sincronizadamente.
     * @param {number|null} [baseIn=null] Ponto IN de referência original (usado em arrasto contínuo).
     * @param {number|null} [baseOut=null] Ponto OUT de referência original (usado em arrasto contínuo).
     * @param {number|null} [partnerBaseIn=null] Ponto IN de referência do parceiro (usado em arrasto contínuo).
     * @param {number|null} [partnerBaseOut=null] Ponto OUT de referência do parceiro (usado em arrasto contínuo).
     * @returns {object|null} Objeto com dados do slip ou null se a operação não puder ser executada.
     */
    slipClip(clipId, deltaFrames, slipLinked = true, baseIn = null, baseOut = null, partnerBaseIn = null, partnerBaseOut = null) {
        if (!clipId) return null;

        let result = null;
        const doSlip = () => {
            const cuts = [...STATE.activeTimelineCuts];
            const clip = cuts.find(c => c.id === clipId);
            if (!clip) return;

            const trackObj = this.getTrack(clip.track);
            if (trackObj && trackObj.locked) return;

            const fps = this.fps || 24;

            const refIn = (baseIn !== null && baseIn !== undefined) ? baseIn : clip.inFrame;
            const refOut = (baseOut !== null && baseOut !== undefined) ? baseOut : clip.outFrame;
            const duration = refOut - refIn;
            if (duration <= 0) return;

            const maxMediaFrames = this.getMaxMediaFrames(clip);

            // Limites do clipe principal:
            // newIn = refIn + delta >= 0 => delta >= -refIn
            let minDelta = -refIn;
            // newOut = refOut + delta <= maxMediaFrames => delta <= maxMediaFrames - refOut
            let maxDelta = Number.isFinite(maxMediaFrames) ? (maxMediaFrames - refOut) : Infinity;

            // Parceiro vinculado (áudio/vídeo)
            let partner = null;
            let partnerRefIn = 0;
            let partnerRefOut = 0;
            if (slipLinked && clip.link_id) {
                partner = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id);
                if (partner) {
                    const partnerTrack = this.getTrack(partner.track);
                    if (partnerTrack && partnerTrack.locked) {
                        partner = null; // Pista do parceiro travada: não move parceiro
                    } else {
                        partnerRefIn = (partnerBaseIn !== null && partnerBaseIn !== undefined) ? partnerBaseIn : partner.inFrame;
                        partnerRefOut = (partnerBaseOut !== null && partnerBaseOut !== undefined) ? partnerBaseOut : partner.outFrame;
                        const partnerMaxFrames = this.getMaxMediaFrames(partner);

                        minDelta = Math.max(minDelta, -partnerRefIn);
                        if (Number.isFinite(partnerMaxFrames)) {
                            maxDelta = Math.min(maxDelta, partnerMaxFrames - partnerRefOut);
                        }
                    }
                }
            }

            if (minDelta > maxDelta) {
                return;
            }

            const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaFrames));

            // Aplica ao clipe principal (timelineStartFrame e duração permanecem intactos)
            clip.inFrame = refIn + clampedDelta;
            clip.outFrame = refOut + clampedDelta;
            clip.in = clip.inFrame / fps;
            clip.out = clip.outFrame / fps;

            if (partner) {
                partner.inFrame = partnerRefIn + clampedDelta;
                partner.outFrame = partnerRefOut + clampedDelta;
                partner.in = partner.inFrame / fps;
                partner.out = partner.outFrame / fps;
                const videoCut = (this.trackKindOf(clip.track) === "video") ? clip : partner;
                const audioCut = (this.trackKindOf(clip.track) === "audio") ? clip : partner;
                if (videoCut && audioCut) {
                    audioCut.syncOffset = (audioCut.timelineStartFrame - audioCut.inFrame) - (videoCut.timelineStartFrame - videoCut.inFrame);
                }
            } else if (clip.link_id) {
                // Modo independente J/L Slip (Alt pressionado): parceiro permanece estático e syncOffset é mantido
                const other = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id);
                if (other) {
                    if (partnerBaseIn !== null && partnerBaseIn !== undefined) {
                        other.inFrame = partnerBaseIn;
                        other.outFrame = partnerBaseOut;
                        other.in = other.inFrame / fps;
                        other.out = other.outFrame / fps;
                    }
                    const videoCut = (this.trackKindOf(clip.track) === "video") ? clip : other;
                    const audioCut = (this.trackKindOf(clip.track) === "audio") ? clip : other;
                    if (videoCut && audioCut) {
                        audioCut.syncOffset = (audioCut.timelineStartFrame - audioCut.inFrame) - (videoCut.timelineStartFrame - videoCut.inFrame);
                    }
                }
            }

            STATE.activeTimelineCuts = cuts;
            result = {
                clipId: clip.id,
                appliedDelta: clampedDelta,
                inFrame: clip.inFrame,
                outFrame: clip.outFrame,
                duration: duration,
                timelineStartFrame: clip.timelineStartFrame,
                partnerClipId: partner ? partner.id : null,
                partnerInFrame: partner ? partner.inFrame : null,
                partnerOutFrame: partner ? partner.outFrame : null
            };
        };

        if (TIMELINE_HISTORY.pending) {
            doSlip();
        } else {
            TIMELINE_HISTORY.record(doSlip);
        }

        return result;
    }

    /**
     * Move a posição física do clipe na timeline mantendo seu conteúdo (in/out) e duração intactos,
     * compensando o movimento ajustando simultaneamente o OUT do vizinho anterior e o IN do vizinho posterior.
     * A duração total da timeline não se altera.
     * 
     * @param {string} clipId ID do clipe a ser deslizado.
     * @param {number} deltaFrames Deslocamento relativo em frames (positivo avança na timeline, negativo recua).
     * @param {boolean} [slideLinked=true] Se true, move também o par A/V vinculado sincronizadamente.
     * @param {Object|null} [baseRef=null] Referência original para arrasto contínuo estável.
     * @returns {Object|null} Metadados do resultado do slide ou null se a operação não puder ser executada.
     */
    slideClip(clipId, deltaFrames, slideLinked = true, baseRef = null) {
        if (!clipId) return null;

        let result = null;
        const doSlide = () => {
            const cuts = [...STATE.activeTimelineCuts];
            const clip = cuts.find(c => c.id === clipId);
            if (!clip) return;

            const trackObj = this.getTrack(clip.track);
            if (trackObj && trackObj.locked) return;

            const fps = this.fps || 24;

            // Clipes na mesma pista ordenados
            const cutsOnTrack = cuts
                .filter(c => c.track === clip.track)
                .sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));
            const clipIdx = cutsOnTrack.findIndex(c => c.id === clip.id);
            if (clipIdx <= 0 || clipIdx >= cutsOnTrack.length - 1) {
                // Não tem vizinho anterior ou posterior na mesma pista
                return;
            }

            const leftClip = cutsOnTrack[clipIdx - 1];
            const rightClip = cutsOnTrack[clipIdx + 1];

            const refClipStart = (baseRef && baseRef.clipStart !== undefined && baseRef.clipStart !== null)
                ? baseRef.clipStart : clip.timelineStartFrame;
            const refLeftOut = (baseRef && baseRef.leftOut !== undefined && baseRef.leftOut !== null)
                ? baseRef.leftOut : leftClip.outFrame;
            const refLeftIn = (baseRef && baseRef.leftIn !== undefined && baseRef.leftIn !== null)
                ? baseRef.leftIn : leftClip.inFrame;
            const refLeftStart = (baseRef && baseRef.leftStart !== undefined && baseRef.leftStart !== null)
                ? baseRef.leftStart : leftClip.timelineStartFrame;
            const refRightIn = (baseRef && baseRef.rightIn !== undefined && baseRef.rightIn !== null)
                ? baseRef.rightIn : rightClip.inFrame;
            const refRightOut = (baseRef && baseRef.rightOut !== undefined && baseRef.rightOut !== null)
                ? baseRef.rightOut : rightClip.outFrame;
            const refRightStart = (baseRef && baseRef.rightStart !== undefined && baseRef.rightStart !== null)
                ? baseRef.rightStart : rightClip.timelineStartFrame;

            const clipDur = clip.outFrame - clip.inFrame;
            const leftDur = refLeftOut - refLeftIn;
            const rightDur = refRightOut - refRightIn;

            if (clipDur <= 0 || leftDur <= 0 || rightDur <= 0) return;

            const maxLeftMedia = this.getMaxMediaFrames(leftClip);
            const minDur = 1;

            // Limites do clipe principal:
            // delta > 0 (direita):
            // - Left expande: refLeftOut + delta <= maxLeftMedia => delta <= maxLeftMedia - refLeftOut
            // - Right encolhe: rightDur - delta >= minDur => delta <= rightDur - minDur
            let maxDelta = Math.min(
                Number.isFinite(maxLeftMedia) ? (maxLeftMedia - refLeftOut) : Infinity,
                rightDur - minDur
            );

            // delta < 0 (esquerda):
            // - Left encolhe: leftDur + delta >= minDur => delta >= minDur - leftDur
            // - Right expande: refRightIn + delta >= 0 => delta >= -refRightIn
            let minDelta = Math.max(
                minDur - leftDur,
                -refRightIn
            );

            // Parceiro vinculado (áudio/vídeo)
            let partner = null;
            let partnerLeft = null;
            let partnerRight = null;
            let refPartnerClipStart = 0;
            let refPartnerLeftOut = 0;
            let refPartnerLeftIn = 0;
            let refPartnerLeftStart = 0;
            let refPartnerRightIn = 0;
            let refPartnerRightOut = 0;
            let refPartnerRightStart = 0;

            if (slideLinked && clip.link_id) {
                partner = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id);
                if (partner) {
                    const pTrack = this.getTrack(partner.track);
                    if (pTrack && pTrack.locked) {
                        partner = null;
                    } else {
                        const pCuts = cuts
                            .filter(c => c.track === partner.track)
                            .sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));
                        const pIdx = pCuts.findIndex(c => c.id === partner.id);
                        if (pIdx > 0 && pIdx < pCuts.length - 1) {
                            partnerLeft = pCuts[pIdx - 1];
                            partnerRight = pCuts[pIdx + 1];

                            refPartnerClipStart = (baseRef && baseRef.partnerClipStart !== undefined && baseRef.partnerClipStart !== null)
                                ? baseRef.partnerClipStart : partner.timelineStartFrame;
                            refPartnerLeftOut = (baseRef && baseRef.partnerLeftOut !== undefined && baseRef.partnerLeftOut !== null)
                                ? baseRef.partnerLeftOut : partnerLeft.outFrame;
                            refPartnerLeftIn = (baseRef && baseRef.partnerLeftIn !== undefined && baseRef.partnerLeftIn !== null)
                                ? baseRef.partnerLeftIn : partnerLeft.inFrame;
                            refPartnerLeftStart = (baseRef && baseRef.partnerLeftStart !== undefined && baseRef.partnerLeftStart !== null)
                                ? baseRef.partnerLeftStart : partnerLeft.timelineStartFrame;
                            refPartnerRightIn = (baseRef && baseRef.partnerRightIn !== undefined && baseRef.partnerRightIn !== null)
                                ? baseRef.partnerRightIn : partnerRight.inFrame;
                            refPartnerRightOut = (baseRef && baseRef.partnerRightOut !== undefined && baseRef.partnerRightOut !== null)
                                ? baseRef.partnerRightOut : partnerRight.outFrame;
                            refPartnerRightStart = (baseRef && baseRef.partnerRightStart !== undefined && baseRef.partnerRightStart !== null)
                                ? baseRef.partnerRightStart : partnerRight.timelineStartFrame;

                            const pLeftDur = refPartnerLeftOut - refPartnerLeftIn;
                            const pRightDur = refPartnerRightOut - refPartnerRightIn;
                            const maxPartnerLeftMedia = this.getMaxMediaFrames(partnerLeft);

                            if (pLeftDur > 0 && pRightDur > 0) {
                                maxDelta = Math.min(
                                    maxDelta,
                                    Number.isFinite(maxPartnerLeftMedia) ? (maxPartnerLeftMedia - refPartnerLeftOut) : Infinity,
                                    pRightDur - minDur
                                );
                                minDelta = Math.max(
                                    minDelta,
                                    minDur - pLeftDur,
                                    -refPartnerRightIn
                                );
                            }
                        }
                    }
                }
            }

            if (minDelta > maxDelta) {
                return;
            }

            const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaFrames));

            // Aplica ao clipe principal e seus vizinhos
            clip.timelineStartFrame = refClipStart + clampedDelta;
            clip.timeline_start = clip.timelineStartFrame / fps;

            leftClip.outFrame = refLeftOut + clampedDelta;
            leftClip.out = leftClip.outFrame / fps;

            rightClip.inFrame = refRightIn + clampedDelta;
            rightClip.in = rightClip.inFrame / fps;
            rightClip.timelineStartFrame = refRightStart + clampedDelta;
            rightClip.timeline_start = rightClip.timelineStartFrame / fps;

            if (partner && partnerLeft && partnerRight) {
                partner.timelineStartFrame = refPartnerClipStart + clampedDelta;
                partner.timeline_start = partner.timelineStartFrame / fps;

                partnerLeft.outFrame = refPartnerLeftOut + clampedDelta;
                partnerLeft.out = partnerLeft.outFrame / fps;

                partnerRight.inFrame = refPartnerRightIn + clampedDelta;
                partnerRight.in = partnerRight.inFrame / fps;
                partnerRight.timelineStartFrame = refPartnerRightStart + clampedDelta;
                partnerRight.timeline_start = partnerRight.timelineStartFrame / fps;

                const videoCut = (this.trackKindOf(clip.track) === "video") ? clip : partner;
                const audioCut = (this.trackKindOf(clip.track) === "audio") ? clip : partner;
                if (videoCut && audioCut) {
                    audioCut.syncOffset = (audioCut.timelineStartFrame - audioCut.inFrame) - (videoCut.timelineStartFrame - videoCut.inFrame);
                }
            } else if (clip.link_id) {
                // Modo independente (Alt)
                const other = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id);
                if (other) {
                    const videoCut = (this.trackKindOf(clip.track) === "video") ? clip : other;
                    const audioCut = (this.trackKindOf(clip.track) === "audio") ? clip : other;
                    if (videoCut && audioCut) {
                        audioCut.syncOffset = (audioCut.timelineStartFrame - audioCut.inFrame) - (videoCut.timelineStartFrame - videoCut.inFrame);
                    }
                }
            }

            STATE.activeTimelineCuts = cuts;
            result = {
                clipId: clip.id,
                appliedDelta: clampedDelta,
                timelineStartFrame: clip.timelineStartFrame,
                inFrame: clip.inFrame,
                outFrame: clip.outFrame,
                duration: clipDur,
                leftClipId: leftClip.id,
                leftClip: leftClip,
                leftOutFrame: leftClip.outFrame,
                leftDuration: leftClip.outFrame - leftClip.inFrame,
                rightClipId: rightClip.id,
                rightClip: rightClip,
                rightInFrame: rightClip.inFrame,
                rightTimelineStartFrame: rightClip.timelineStartFrame,
                rightDuration: rightClip.outFrame - rightClip.inFrame,
                partnerClipId: partner ? partner.id : null,
                partnerTimelineStartFrame: partner ? partner.timelineStartFrame : null,
                partnerLeftClipId: partnerLeft ? partnerLeft.id : null,
                partnerLeftOutFrame: partnerLeft ? partnerLeft.outFrame : null,
                partnerRightClipId: partnerRight ? partnerRight.id : null,
                partnerRightInFrame: partnerRight ? partnerRight.inFrame : null
            };
        };

        if (TIMELINE_HISTORY.pending) {
            doSlide();
        } else {
            TIMELINE_HISTORY.record(doSlide);
        }

        return result;
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
            selectedClipIds: Array.from(TIMELINE_STATE.selectedClipIds || []),
            activeTool: TIMELINE_STATE.activeTool || "select",
            selectedGhostClipId: TIMELINE_STATE.selectedGhostClipId,
            inFrame: TIMELINE_STATE.inFrame,
            outFrame: TIMELINE_STATE.outFrame
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
        TIMELINE_STATE.selectedClipIds = new Set(snap.selectedClipIds || (snap.selectedClipId ? [snap.selectedClipId] : []));
        if (snap.activeTool) {
            TIMELINE_STATE.activeTool = snap.activeTool;
            STATE.emit("timelineToolChanged", TIMELINE_STATE.activeTool);
        }
        TIMELINE_STATE.selectedGhostClipId = snap.selectedGhostClipId !== undefined ? snap.selectedGhostClipId : null;
        TIMELINE_STATE.setTracks(snap.tracks);
        STATE.activeTimelineCuts = snap.cuts || [];
        TIMELINE_STATE.ghostTrack = snap.ghosts || [];
        if (snap.inFrame !== undefined) TIMELINE_STATE.inFrame = snap.inFrame;
        if (snap.outFrame !== undefined) TIMELINE_STATE.outFrame = snap.outFrame;
        STATE.emit("timelineInOutChanged", { inFrame: TIMELINE_STATE.inFrame, outFrame: TIMELINE_STATE.outFrame });
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
