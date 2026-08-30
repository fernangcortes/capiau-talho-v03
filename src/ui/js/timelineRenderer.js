// Renderizador de Alta Performance via Canvas (CapIAu-Talho)
// v2: Multipista dinâmica com pista de IA, scroll vertical e cores por pista.
import { STATE } from "./state.js";
import { TIMELINE_STATE, framesToTimecode, framesToSeconds, formatRulerTimecode, evaluateFadeCurve } from "./timelineState.js";
import { WaveformManager } from "./waveformManager.js";
import { getAllKeyframeTimelineFrames } from "./keyframeEngine.js";

// Paleta de cores para pistas de vídeo (V1 roxo/íris clássico NLE, V2 ciano B-roll, etc.)
const TRACK_PALETTE = [
    { bg: "rgba(139, 92, 246, 0.12)", clipBg: "rgba(139, 92, 246, 0.25)", border: "rgba(139, 92, 246, 0.7)", wave: "rgba(139, 92, 246, 0.4)" }, // roxo (V1)
    { bg: "rgba(6, 182, 212, 0.12)", clipBg: "rgba(6, 182, 212, 0.25)", border: "rgba(6, 182, 212, 0.7)", wave: "rgba(6, 182, 212, 0.4)" },   // ciano (V2)
    { bg: "rgba(236, 72, 153, 0.12)", clipBg: "rgba(236, 72, 153, 0.22)", border: "rgba(236, 72, 153, 0.65)", wave: "rgba(236, 72, 153, 0.4)" }, // rosa
    { bg: "rgba(245, 158, 11, 0.10)", clipBg: "rgba(245, 158, 11, 0.20)", border: "rgba(245, 158, 11, 0.6)", wave: "rgba(245, 158, 11, 0.4)" },  // âmbar
    { bg: "rgba(59, 130, 246, 0.10)", clipBg: "rgba(59, 130, 246, 0.20)", border: "rgba(59, 130, 246, 0.6)", wave: "rgba(59, 130, 246, 0.4)" }   // azul
];

const AI_TRACK_STYLE = {
    bg: "rgba(34, 197, 94, 0.06)",
    clipBg: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.6)"
};

// Pistas de texto e títulos (âmbar / dourado sutil com badge)
const TEXT_TRACK_STYLE = {
    bg: "rgba(245, 158, 11, 0.07)",
    clipBg: "rgba(245, 158, 11, 0.22)",
    border: "rgba(245, 158, 11, 0.75)",
    wave: null
};

// Pistas de áudio (verde-esmeralda, como nos NLEs)
const AUDIO_TRACK_STYLE = {
    bg: "rgba(16, 185, 129, 0.07)",
    clipBg: "rgba(16, 185, 129, 0.18)",
    border: "rgba(16, 185, 129, 0.6)",
    wave: "rgba(110, 231, 183, 0.55)"
};

// ── Diagnóstico de áudio (faixa fina na base do clipe) ──────────────────────
// Rampa de cor do envelope: abaixo deste piso em dBFS o balde fica transparente
// e esquenta até vermelho pleno em 0 dBFS. O teto_dbtp padrão é -1.5, então a
// zona "quase/estouro" (> -1.5) já aparece bem quente na tira.
const AUDIO_DIAG_PISO_DB = -12.0;
const AUDIO_DIAG_ALPHA_MAX = 0.7;
// Clipe mais estreito que isto na tela não ganha tira (não faria sentido ler).
const AUDIO_DIAG_LARGURA_MIN_PX = 24;

/**
 * Fração [0..1] de um instante t (segundos ABSOLUTOS da fonte) dentro do trecho
 * [inS, outS] exibido pelo clipe. Retorna null quando t está fora do trecho ou o
 * trecho é inválido — nesses casos nada é desenhado.
 */
export function fracaoNoTrecho(t, inS, outS) {
    const span = outS - inS;
    if (!Number.isFinite(t) || !Number.isFinite(inS) || !Number.isFinite(outS) || span <= 0) return null;
    if (t < inS || t > outS) return null;
    return (t - inS) / span;
}

/**
 * Janela horizontal de um balde [t0, t1] como frações do clipe, com clamp nas
 * bordas (baldes que transpõem in/out entram parcialmente). Baldes totalmente
 * fora do trecho voltam null — descarte cedo sem tocar no canvas.
 */
export function janelaBalde(t0, t1, inS, outS) {
    const span = outS - inS;
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || !Number.isFinite(inS) || !Number.isFinite(outS) || span <= 0) return null;
    const u0 = (t0 - inS) / span;
    const u1 = (t1 - inS) / span;
    if (u1 <= 0 || u0 >= 1) return null; // inteiramente antes/depois do trecho
    return {
        u0: Math.min(Math.max(u0, 0), 1),
        u1: Math.min(Math.max(u1, 0), 1)
    };
}

export class CapiauTimelineRenderer {
    constructor() {
        this.canvas = document.getElementById("timeline-canvas");
        if (!this.canvas) {
            console.error("Elemento timeline-canvas não encontrado!");
            return;
        }
        this.ctx = this.canvas.getContext("2d");

        // Configurações visuais
        this.rulerHeight = 30;

        // Cores do tema (Sintonizado com CSS Glassmorphism)
        this.colors = {
            bg: "#111827",            // Fundo escuro base (gray-900)
            rulerBg: "#0f172a",       // Fundo da régua (slate-900)
            rulerTicks: "#475569",    // Linhas de escala (slate-600)
            rulerText: "#94a3b8",     // Texto do timecode (slate-400)
            textPrimary: "#f8fafc",
            textSecondary: "#cbd5e1",
            playhead: "#ef4444",      // Vermelho vibrante
            borderGlass: "rgba(255, 255, 255, 0.08)",
            selection: "rgba(255, 255, 255, 0.85)",
            lockedOverlay: "rgba(0, 0, 0, 0.25)",
            ghostGreenBg: "rgba(34, 197, 94, 0.12)", // Sugestões de inserção
            ghostGreenBorder: "rgba(34, 197, 94, 0.6)",
            ghostAmberBg: "rgba(245, 158, 11, 0.12)", // Sugestões de substituição
            ghostAmberBorder: "rgba(245, 158, 11, 0.6)",
            ghostRedHachure: "rgba(239, 68, 68, 0.25)", // Sugestões de remoção
            ghostRedBorder: "rgba(239, 68, 68, 0.6)"
        };

        this.isDirty = true; // Flag para solicitar redesenho reativo
        this.audioDiagCount = -1; // Contagem de análises publicadas em STATE.audioDiag (-1 força 1º redraw)
        this.photoThumbCache = {}; // Cache de miniaturas (Image) de fotos por id
        this.videoThumbCache = {}; // Cache de miniaturas de vídeo: key "video_id_time" -> { img: Image, loaded: boolean, timestamp: float }
        this.init();
    }

    // ── GEOMETRIA DAS PISTAS ────────────────────────────────────────────

    /**
     * Retorna a lista de lanes visíveis: [{track, top, height}] já com scroll vertical aplicado.
     */
    getTrackLanes() {
        const viewportH = Math.max(0, (this.height || 200) - (this.rulerHeight || 30));
        TIMELINE_STATE.clampScrollTop(viewportH);
        const lanes = [];
        let y = this.rulerHeight - TIMELINE_STATE.scrollTop;
        for (const track of TIMELINE_STATE.tracks) {
            const h = TIMELINE_STATE.trackHeight(track);
            lanes.push({ track, top: y, height: h });
            y += h;
        }
        return lanes;
    }

    /** Retorna a lane de uma pista pelo id ou nome da pista (ou null). */
    getLane(trackId) {
        if (!trackId) return null;
        const lanes = this.getTrackLanes();
        const target = String(trackId).trim().toLowerCase();

        let lane = lanes.find(l => String(l.track.id).toLowerCase() === target);
        if (lane) return lane;

        lane = lanes.find(l => l.track.name && String(l.track.name).toLowerCase() === target);
        if (lane) return lane;

        if (target.includes("broll") || target.includes("b-roll")) {
            lane = lanes.find(l => String(l.track.id).toLowerCase() === "v2" || (l.track.name && l.track.name.toLowerCase().includes("b-roll")));
            if (lane) return lane;
        }
        if (target.includes("fala") || target.includes("main")) {
            lane = lanes.find(l => String(l.track.id).toLowerCase() === "v1" || (l.track.name && l.track.name.toLowerCase().includes("fala")));
            if (lane) return lane;
        }

        return lanes.find(l => l.track.kind === "video") || lanes[0] || null;
    }

    /** Retorna a pista sob a coordenada Y do canvas (ou null se fora). */
    getTrackAtY(y) {
        if (y < this.rulerHeight) return null;
        for (const lane of this.getTrackLanes()) {
            if (y >= lane.top && y < lane.top + lane.height) return lane.track;
        }
        return null;
    }

    /** Estilo visual de uma pista de vídeo pelo identificador ou índice entre as pistas de vídeo. */
    getTrackStyle(track) {
        if (track.kind === "ai") return AI_TRACK_STYLE;
        if (track.kind === "text") return TEXT_TRACK_STYLE;
        if (track.kind === "audio") return AUDIO_TRACK_STYLE;
        if (track.id === "V1") return TRACK_PALETTE[0]; // roxo clássico NLE para pista principal
        if (track.id === "V2") return TRACK_PALETTE[1]; // ciano para B-Roll
        const otherVideoTracks = TIMELINE_STATE.getVideoTracks().filter(t => t.id !== "V1" && t.id !== "V2");
        const idx = otherVideoTracks.findIndex(t => t.id === track.id);
        const paletteIdx = idx >= 0 ? 2 + (idx % (TRACK_PALETTE.length - 2)) : 0;
        return TRACK_PALETTE[paletteIdx];
    }

    // ── CICLO DE VIDA ───────────────────────────────────────────────────

    setCanvas(canvas) {
        if (!canvas) return;

        // Remove listener de resize e para de observar
        if (this.canvas) {
            const oldWin = this.canvas.ownerDocument.defaultView || window;
            oldWin.removeEventListener("resize", this.boundResize);
            if (this.resizeObserver) {
                this.resizeObserver.unobserve(this.canvas.parentNode);
            }
        }

        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        // Adiciona o listener na nova janela do canvas
        const newWin = canvas.ownerDocument.defaultView || window;
        newWin.addEventListener("resize", this.boundResize);

        if (this.resizeObserver) {
            this.resizeObserver.observe(this.canvas.parentNode);
        }

        this.resize();
        this.requestRedraw();
    }

    init() {
        this.boundResize = () => {
            this.resize();
            this.requestRedraw();
        };

        // Ajustar tamanho do Canvas e High-DPI
        this.resize();

        const win = this.canvas ? (this.canvas.ownerDocument.defaultView || window) : window;
        win.addEventListener("resize", this.boundResize);

        // ResizeObserver para detectar mudanças de tamanho do contêiner da timeline
        this.resizeObserver = new ResizeObserver(() => {
            this.resize();
            this.requestRedraw();
        });
        if (this.canvas && this.canvas.parentNode) {
            this.resizeObserver.observe(this.canvas.parentNode);
        }

        // Ouvintes de evento do estado para redesenho reativo
        STATE.on("timelineCutsUpdated", (cuts) => {
            WaveformManager.preloadForClips(cuts || TIMELINE_STATE.cuts);
            this.requestRedraw();
        });
        STATE.on("timelineGhostUpdated", () => this.requestRedraw());
        STATE.on("timelineTracksChanged", () => this.requestRedraw());
        STATE.on("timelineFpsChanged", () => this.requestRedraw());
        STATE.on("timelineZoomChanged", () => this.requestRedraw());
        STATE.on("timelineScrollChanged", () => this.requestRedraw());
        STATE.on("timelineVScrollChanged", () => this.requestRedraw());
        STATE.on("timelinePlayheadChanged", () => this.requestRedraw());
        STATE.on("timelineMarkersChanged", () => this.requestRedraw());
        STATE.on("timelineGapSelected", () => this.requestRedraw());
        STATE.on("timelineSnappingChanged", () => this.requestRedraw());
        STATE.on("activeVideoChanged", () => this.requestRedraw());
        STATE.on("waveformLoaded", () => this.requestRedraw());
        WaveformManager.addListener(() => this.requestRedraw());

        // Guias de interação e drop
        this.activeSnapFrame = null;
        this.dropIndicator = null;
        this.hoveredGap = null;

        // Inicia o render loop
        this.renderLoop();
    }

    /**
     * Ajusta a resolução lógica do canvas baseado no tamanho real e pixelRatio do dispositivo.
     */
    resize() {
        const rect = this.canvas.parentNode.getBoundingClientRect();
        this.width = rect.width;
        this.height = rect.height || 200; // Altura padrão do wrapper
        const viewportH = Math.max(0, this.height - this.rulerHeight);
        TIMELINE_STATE.clampScrollTop(viewportH);

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;

        this.ctx.scale(dpr, dpr);
        this.requestRedraw();
    }

    /**
     * Sinaliza que um redesenho é necessário no próximo frame.
     */
    requestRedraw() {
        this.isDirty = true;
    }

    /**
     * Render loop reativo baseado em requestAnimationFrame.
     */
    renderLoop() {
        // O diagnóstico é publicado por chave DENTRO do mesmo objeto STATE.audioDiag
        // (contrato D3), sem evento dedicado: comparar só a contagem de entradas é
        // barato e pede um redesenho quando uma análise nova chega.
        const diagCount = STATE.audioDiag ? Object.keys(STATE.audioDiag).length : 0;
        if (diagCount !== this.audioDiagCount) {
            this.audioDiagCount = diagCount;
            this.isDirty = true;
        }
        // Animação contínua sutil enquanto houver extração de waveforms em voo
        if (WaveformManager && typeof WaveformManager.hasInFlight === "function" && WaveformManager.hasInFlight()) {
            this.isDirty = true;
        }
        if (this.isDirty) {
            this.draw();
            this.isDirty = false;
        }
        requestAnimationFrame(() => this.renderLoop());
    }

    /**
     * Método principal de desenho.
     */
    draw() {
        const ctx = this.ctx;
        if (!ctx) return;

        // Limpa o canvas
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, this.width, this.height);

        // Desenha trilhas de fundo
        this.drawTracksBackground();

        // Desenha os gaps (espaços vazios selecionados / hover)
        this.drawGaps();

        // Desenha os clipes salvos
        this.drawClips();

        // Desenha as sugestões fantasma da IA (Ghost Clips)
        this.drawGhostClips();

        // Desenha guias de snapping e indicador de inserção/drop
        this.drawDropAndSnapGuides();

        // Desenha a grade e a régua de tempo (por cima das pistas roladas)
        this.drawRuler();

        // Desenha marcadores na timeline
        this.drawMarkers();

        // Desenha o cursor do Playhead (currentTime)
        this.drawPlayhead();
    }

    /**
     * Desenha a seleção e destaque de gaps (espaços vazios entre clipes).
     */
    drawGaps() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const selectedGap = TIMELINE_STATE.selectedGap;
        const hoveredGap = this.hoveredGap;

        if (!selectedGap && !hoveredGap) return;

        const gapsToDraw = [];
        if (hoveredGap && (!selectedGap || selectedGap.trackId !== hoveredGap.trackId || selectedGap.startFrame !== hoveredGap.startFrame)) {
            gapsToDraw.push({ gap: hoveredGap, isSelected: false });
        }
        if (selectedGap) {
            gapsToDraw.push({ gap: selectedGap, isSelected: true });
        }

        gapsToDraw.forEach(({ gap, isSelected }) => {
            const lane = this.getLane(gap.trackId);
            if (!lane || lane.track.hidden) return;
            if (lane.top + lane.height < this.rulerHeight || lane.top > this.height) return;

            const startX = (gap.startFrame - scrollLeft) * zoom;
            const width = gap.durationFrames * zoom;

            if (startX + width < 0 || startX > this.width) return;

            const clipY = lane.top;
            const clipHeight = lane.height;

            ctx.save();
            if (isSelected) {
                ctx.fillStyle = "rgba(6, 182, 212, 0.15)";
                ctx.fillRect(startX, clipY, width, clipHeight);

                ctx.strokeStyle = "rgba(6, 182, 212, 0.85)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(startX + 1, clipY + 1, Math.max(1, width - 2), clipHeight - 2);
                ctx.setLineDash([]);

                // Badge de timecode do gap se couber na tela
                if (width >= 40) {
                    const badgeText = `Vazio: ${framesToTimecode(gap.durationFrames, TIMELINE_STATE.fps)}`;
                    ctx.font = "bold 9px Outfit, sans-serif";
                    const tw = ctx.measureText(badgeText).width;
                    const bx = startX + (width - tw) / 2;
                    const by = clipY + clipHeight / 2 + 3;

                    ctx.fillStyle = "rgba(18, 18, 24, 0.8)";
                    ctx.fillRect(bx - 4, by - 11, tw + 8, 14);
                    ctx.fillStyle = "#06b6d4";
                    ctx.fillText(badgeText, bx, by);
                }
            } else {
                ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
                ctx.fillRect(startX, clipY, width, clipHeight);
                ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 4]);
                ctx.strokeRect(startX, clipY, width, clipHeight);
                ctx.setLineDash([]);
            }
            ctx.restore();
        });
    }

    /**
     * Desenha guias visuais verticais de Snapping e indicadores de Inserção (Ripple Drop) / Overwrite.
     */
    drawDropAndSnapGuides() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;

        // 1. Linha vertical de Snapping
        if (this.activeSnapFrame !== null && this.activeSnapFrame !== undefined) {
            const snapX = (this.activeSnapFrame - scrollLeft) * zoom;
            if (snapX >= 0 && snapX <= this.width) {
                ctx.save();
                ctx.strokeStyle = "rgba(6, 182, 212, 0.9)";
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(snapX, this.rulerHeight);
                ctx.lineTo(snapX, this.height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        // 2. Indicador de Inserção (Ripple Drop Line) ou Overwrite Ghost
        if (this.dropIndicator) {
            const { type, frame, trackId, durationFrames } = this.dropIndicator;
            const startX = (frame - scrollLeft) * zoom;

            if (type === "insert") {
                // Barra vertical com setas nas extremidades
                const lane = this.getLane(trackId);
                const topY = lane ? lane.top : this.rulerHeight;
                const botY = lane ? lane.top + lane.height : this.height;

                ctx.save();
                ctx.strokeStyle = "#8b5cf6"; // Violeta vibrante
                ctx.fillStyle = "#8b5cf6";
                ctx.lineWidth = 2;

                ctx.beginPath();
                ctx.moveTo(startX, topY);
                ctx.lineTo(startX, botY);
                ctx.stroke();

                // Triângulo superior
                ctx.beginPath();
                ctx.moveTo(startX - 5, topY);
                ctx.lineTo(startX + 5, topY);
                ctx.lineTo(startX, topY + 7);
                ctx.closePath();
                ctx.fill();

                // Triângulo inferior
                ctx.beginPath();
                ctx.moveTo(startX - 5, botY);
                ctx.lineTo(startX + 5, botY);
                ctx.lineTo(startX, botY - 7);
                ctx.closePath();
                ctx.fill();

                // Etiqueta indicativa de Ripple Insert
                if (lane && lane.height > 24) {
                    ctx.font = "bold 9px Outfit, sans-serif";
                    ctx.fillStyle = "#8b5cf6";
                    ctx.textBaseline = "top";
                    ctx.fillText("[RIPPLE INSERT]", startX + 8, topY + 6);
                }

                ctx.restore();
            } else if (type === "overwrite") {
                const lane = this.getLane(trackId);
                if (lane && durationFrames > 0) {
                    const width = durationFrames * zoom;
                    const isPhoto = this.dropIndicator.mediaType === "photo";
                    const bgGrad = isPhoto ? "rgba(6, 182, 212, 0.22)" : "rgba(139, 92, 246, 0.25)";
                    const borderStroke = isPhoto ? "rgba(6, 182, 212, 0.85)" : "rgba(139, 92, 246, 0.9)";

                    ctx.save();
                    // Fundo translúcido do clipe fantasma
                    ctx.fillStyle = bgGrad;
                    ctx.fillRect(startX, lane.top, width, lane.height);

                    // Borda tracejada sutil de preview/ghost
                    ctx.strokeStyle = borderStroke;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 2]);
                    ctx.strokeRect(startX, lane.top, width, lane.height);
                    ctx.setLineDash([]);

                    // Renderizar texto e badges no clipe fantasma se houver espaço
                    if (width > 24 && lane.height > 20) {
                        const title = this.dropIndicator.title || (isPhoto ? "Foto" : "Vídeo");
                        const durSec = durationFrames / ((window.TIMELINE_STATE && window.TIMELINE_STATE.fps) ? window.TIMELINE_STATE.fps : 24);
                        const durText = `${durSec.toFixed(1)}s`;

                        ctx.font = "bold 10px Outfit, sans-serif";
                        ctx.textBaseline = "top";

                        // Badge / Tipo
                        const badgeText = isPhoto ? "[FOTO]" : "[VÍDEO]";
                        const badgeWidth = ctx.measureText(badgeText).width;

                        ctx.fillStyle = isPhoto ? "rgba(6, 182, 212, 0.9)" : "rgba(168, 85, 247, 0.9)";
                        ctx.fillText(badgeText, startX + 6, lane.top + 5);

                        // Título
                        if (width > badgeWidth + 50) {
                            ctx.fillStyle = "#e2e8f0";
                            ctx.font = "500 10px Outfit, sans-serif";
                            const maxTitleW = width - badgeWidth - 70;
                            let displayTitle = title;
                            if (ctx.measureText(displayTitle).width > maxTitleW && maxTitleW > 20) {
                                while (displayTitle.length > 3 && ctx.measureText(displayTitle + "…").width > maxTitleW) {
                                    displayTitle = displayTitle.slice(0, -1);
                                }
                                displayTitle += "…";
                            }
                            if (maxTitleW > 20) {
                                ctx.fillText(displayTitle, startX + badgeWidth + 10, lane.top + 5);
                            }
                        }

                        // Duração no canto inferior esquerdo
                        if (width > 60 && lane.height > 32) {
                            ctx.font = "10px monospace";
                            ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
                            ctx.textBaseline = "bottom";
                            ctx.fillText(durText, startX + 6, lane.top + lane.height - 4);
                        }
                    }

                    // Se for vídeo com áudio embutido e houver pista de áudio vinculada correspondente
                    if (!isPhoto && window.TIMELINE_STATE && typeof window.TIMELINE_STATE.pairedAudioTrackId === "function") {
                        const pairedAudioId = window.TIMELINE_STATE.pairedAudioTrackId(trackId);
                        if (pairedAudioId) {
                            const audioLane = this.getLane(pairedAudioId);
                            if (audioLane) {
                                ctx.fillStyle = "rgba(16, 185, 129, 0.18)"; // Verde Esmeralda / Áudio
                                ctx.fillRect(startX, audioLane.top, width, audioLane.height);
                                ctx.strokeStyle = "rgba(16, 185, 129, 0.75)";
                                ctx.lineWidth = 1.5;
                                ctx.setLineDash([4, 2]);
                                ctx.strokeRect(startX, audioLane.top, width, audioLane.height);
                                ctx.setLineDash([]);

                                if (width > 30 && audioLane.height > 18) {
                                    ctx.fillStyle = "rgba(16, 185, 129, 0.9)";
                                    ctx.font = "bold 9px Outfit, sans-serif";
                                    ctx.textBaseline = "top";
                                    ctx.fillText("[ÁUDIO]", startX + 6, audioLane.top + 4);
                                }
                            }
                        }
                    }

                    ctx.restore();
                }
            }
        }
    }

    /**
     * Desenha as faixas de fundo e linhas horizontais divisórias (dinâmico).
     */
    drawTracksBackground() {
        const ctx = this.ctx;

        for (const lane of this.getTrackLanes()) {
            if (lane.top + lane.height < this.rulerHeight || lane.top > this.height) continue;

            if (lane.track.hidden) {
                ctx.fillStyle = "rgba(6, 182, 212, 0.15)";
                ctx.fillRect(0, lane.top, this.width, lane.height);
                ctx.strokeStyle = "rgba(6, 182, 212, 0.3)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, lane.top + lane.height);
                ctx.lineTo(this.width, lane.top + lane.height);
                ctx.stroke();
                continue;
            }

            const style = this.getTrackStyle(lane.track);
            ctx.fillStyle = style.bg;
            ctx.fillRect(0, lane.top, this.width, lane.height);

            // Pista travada: leve escurecimento
            if (lane.track.locked && lane.track.kind !== "ai") {
                ctx.fillStyle = this.colors.lockedOverlay;
                ctx.fillRect(0, lane.top, this.width, lane.height);
            }

            // Divisória inferior
            ctx.strokeStyle = this.colors.borderGlass;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, lane.top + lane.height);
            ctx.lineTo(this.width, lane.top + lane.height);
            ctx.stroke();

            // Placeholder da pista de IA vazia
            if (lane.track.kind === "ai" && TIMELINE_STATE.ghostTrack.length === 0) {
                ctx.fillStyle = "rgba(34, 197, 94, 0.35)";
                ctx.font = "italic 10px Inter, sans-serif";
                const msg = TIMELINE_STATE.aiAnalysisRunning
                    ? "IA analisando o corte atual..."
                    : "Pista de IA — use ✨ Sugerir (ou o seletor de Persona) para analisar o corte atual";
                ctx.fillText(msg, 12, lane.top + lane.height / 2 + 3);
            }
        }
    }

    /**
     * Desenha a régua de tempo adaptativa com marcas de subdivisão e timecode dinâmico.
     */
    drawRuler() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const fps = TIMELINE_STATE.fps || 24;

        // Fundo da régua
        ctx.fillStyle = this.colors.rulerBg;
        ctx.fillRect(0, 0, this.width, this.rulerHeight);

        // Borda inferior da régua Y: 30
        ctx.strokeStyle = this.colors.borderGlass;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.rulerHeight);
        ctx.lineTo(this.width, this.rulerHeight);
        ctx.stroke();

        // 1. Candidatos a intervalo de rótulo (em frames)
        const rawCandidates = [
            1,
            2,
            5,
            Math.max(1, Math.round(fps / 4)),
            Math.max(1, Math.round(fps / 2)),
            fps * 1,
            fps * 2,
            fps * 5,
            fps * 10,
            fps * 15,
            fps * 30,
            fps * 60,
            fps * 120,
            fps * 300,
            fps * 600,
            fps * 900,
            fps * 1800,
            fps * 3600,
            fps * 7200,
            fps * 18000
        ];
        const candidates = [...new Set(rawCandidates.map(Math.round))].sort((a, b) => a - b);

        // 2. Determinar textInterval para garantir espaçamento mínimo de ~90px entre textos (evita sobreposição)
        const minTextPx = 90;
        let textInterval = candidates[candidates.length - 1];
        for (const c of candidates) {
            if (c * zoom >= minTextPx) {
                textInterval = c;
                break;
            }
        }

        // 3. Determinar subTickInterval (divisores exatos de textInterval com pelo menos 8px entre ticks)
        let subTickInterval = textInterval;
        if (textInterval > 1) {
            const divisors = [];
            for (let d = textInterval; d >= 1; d--) {
                if (textInterval % d === 0) {
                    divisors.push(d);
                }
            }
            for (const d of divisors) {
                if (d * zoom >= 8) {
                    subTickInterval = d;
                }
            }
        }

        // 4. Parâmetros de exibição do Timecode
        const startFrame = Math.max(0, scrollLeft);
        const endFrame = startFrame + Math.ceil(this.width / zoom);
        const showFrames = textInterval < fps;
        const forceHours = endFrame >= 3600 * fps;

        ctx.font = "9px 'Outfit', 'Inter', monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const firstTickFrame = Math.floor(startFrame / subTickInterval) * subTickInterval;

        for (let f = firstTickFrame; f <= endFrame; f += subTickInterval) {
            const x = (f - startFrame) * zoom;
            if (x < -15 || x > this.width + 15) continue;

            const isTextTick = (f % textInterval === 0);
            const tickSize = isTextTick ? 10 : 5;

            // Desenha tick
            ctx.strokeStyle = isTextTick ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.15)";
            ctx.lineWidth = isTextTick ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(x, this.rulerHeight - tickSize);
            ctx.lineTo(x, this.rulerHeight);
            ctx.stroke();

            // Desenha texto do timecode
            if (isTextTick) {
                const label = formatRulerTimecode(f, fps, showFrames, forceHours);
                ctx.fillStyle = this.colors.rulerText;
                ctx.fillText(label, x + 4, this.rulerHeight - 16);
            }
        }
    }

    /**
     * Desenha os marcadores da timeline (linhas guia verticais e bandeiras na régua).
     */
    drawMarkers() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const markers = TIMELINE_STATE.getMarkersSorted();

        const cuts = STATE.activeTimelineCuts || [];
        const lanes = this.getTrackLanes();
        const laneMap = {};
        lanes.forEach(l => { laneMap[l.track.id] = l; });

        // 1. Separar marcadores de clipe e marcadores de régua
        const clipMarkers = [];
        const rulerMarkers = [];

        markers.forEach(m => {
            if (m.clipId) clipMarkers.push(m);
            else rulerMarkers.push(m);
        });

        // 2. Renderizar Marcadores de Clipe (estritamente recortados na área de pistas, abaixo da régua)
        if (clipMarkers.length > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, this.rulerHeight, this.width, Math.max(0, this.height - this.rulerHeight));
            ctx.clip(); // Impede 100% qualquer vazamento para a régua da timeline!

            clipMarkers.forEach(marker => {
                let cut = cuts.find(c => String(c.id) === String(marker.clipId));
                if (!cut) {
                    // Fallback se o ID do clipe foi re-gerado: localiza o clipe por intersecção de frame
                    cut = cuts.find(c => marker.frame >= c.timelineStartFrame && marker.frame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
                    if (cut) {
                        marker.clipId = cut.id;
                        marker.offsetFrame = Math.max(0, Math.round(marker.frame - cut.timelineStartFrame));
                    }
                }
                if (!cut) return;

                const lane = this.getLane(cut.track);
                if (!lane || lane.track.hidden) return;
                if (lane.top + lane.height < this.rulerHeight || lane.top > this.height) return;

                const x = (marker.frame - scrollLeft) * zoom;
                if (x < -20 || x > this.width + 20) return;

                const clipX1 = (cut.timelineStartFrame - scrollLeft) * zoom;
                const clipX2 = (cut.timelineStartFrame + (cut.outFrame - cut.inFrame) - scrollLeft) * zoom;

                if (x >= clipX1 - 2 && x <= clipX2 + 2) {
                    const color = marker.color || "#06b6d4";
                    const isSelected = TIMELINE_STATE.selectedMarkerIds.has(marker.id);
                    const topY = Math.max(lane.top + 2, this.rulerHeight + 2);

                    ctx.save();

                    // Insígnia / Pin compacto no topo do clipe (Sem stem)
                    ctx.fillStyle = color;
                    ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(0, 0, 0, 0.7)";
                    ctx.lineWidth = isSelected ? 1.5 : 1;

                    const pinWidth = 8;
                    const pinHeight = 9;
                    const pinY = topY + 1;

                    ctx.beginPath();
                    ctx.moveTo(x - pinWidth / 2, pinY);
                    ctx.lineTo(x + pinWidth / 2, pinY);
                    ctx.lineTo(x + pinWidth / 2, pinY + 5);
                    ctx.lineTo(x, pinY + pinHeight);
                    ctx.lineTo(x - pinWidth / 2, pinY + 5);
                    ctx.closePath();

                    ctx.fill();
                    ctx.stroke();

                    ctx.restore();
                }
            });

            ctx.restore(); // Restaura região de clipping do canvas
        }

        // 3. Renderizar Marcadores de Régua (na régua da timeline)
        if (rulerMarkers.length > 0) {
            rulerMarkers.forEach(marker => {
                const x = (marker.frame - scrollLeft) * zoom;
                if (x < -20 || x > this.width + 20) return;

                const color = marker.color || "#06b6d4";
                const isSelected = TIMELINE_STATE.selectedMarkerIds.has(marker.id);

                ctx.save();
                ctx.fillStyle = color;
                ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(0, 0, 0, 0.6)";
                ctx.lineWidth = isSelected ? 1.5 : 1;

                const flagWidth = 8;
                const flagHeight = 10;
                const topY = 2;
                const bottomY = topY + flagHeight;

                ctx.beginPath();
                ctx.moveTo(x - flagWidth / 2, topY);
                ctx.lineTo(x + flagWidth / 2, topY);
                ctx.lineTo(x + flagWidth / 2, topY + 6);
                ctx.lineTo(x, bottomY);
                ctx.lineTo(x - flagWidth / 2, topY + 6);
                ctx.closePath();

                ctx.fill();
                ctx.stroke();

                ctx.restore();
            });
        }
    }

    /**
     * Renderiza os blocos dos cortes de vídeo/áudio ativos em suas pistas.
     */
    drawClips() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const cuts = STATE.activeTimelineCuts;
        const lanes = this.getTrackLanes();
        const laneMap = {};
        lanes.forEach(l => { laneMap[l.track.id] = l; });
        const fallbackLane = lanes.find(l => l.track.kind === "video");

        // Par A/V do clipe selecionado (recebe destaque tracejado)
        const selectedCut = cuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        const selectedLink = selectedCut ? selectedCut.link_id : null;

        cuts.forEach((cut) => {
            const lane = laneMap[cut.track] || fallbackLane;
            if (!lane) return;
            if (lane.top + lane.height < this.rulerHeight || lane.top > this.height) return;
            if (lane.track.hidden) return;

            const duration = cut.outFrame - cut.inFrame;
            const startX = (cut.timelineStartFrame - scrollLeft) * zoom;
            const width = duration * zoom;

            // Ignora se estiver fora do viewport visível
            if (startX + width < 0 || startX > this.width) return;

            const style = this.getTrackStyle(lane.track);
            const laneKind = lane.track.kind || "video";
            const isText = cut.type === "text" || laneKind === "text";
            const isPhoto = cut.type === "photo";
            const video = (isPhoto || isText) ? null : STATE.allVideos.find(v => String(v.id) === String(cut.video_id));
            const photo = isPhoto ? STATE.allPhotos.find(p => p.id === cut.photo_id) : null;

            // Espaçamento interno vertical do clipe
            const clipY = lane.top;
            const clipHeight = lane.height;

            // Desenhar bloco do clipe
            ctx.fillStyle = style.clipBg;
            ctx.fillRect(startX, clipY, width, clipHeight);

            // Estilização interna de clipe de texto
            if (isText) {
                ctx.save();
                ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
                ctx.fillRect(startX, clipY, width, clipHeight);
                // Faixa colorida sutil no topo do clipe de texto
                ctx.fillStyle = "rgba(245, 158, 11, 0.8)";
                ctx.fillRect(startX, clipY, width, 3);
                ctx.restore();
            }

            // Miniaturas para pista de vídeo (se habilitadas na pista e globalmente)
            if (laneKind === "video" && !isPhoto && !isText && lane.track.thumbnailsEnabled && TIMELINE_STATE.globalThumbnailsInterval > 0 && video) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, clipY, width, clipHeight);
                ctx.clip(); // Corta para caber no bloco do clipe

                const thumbWidth = 80;
                const durationSecs = duration / (TIMELINE_STATE?.fps || 24);
                const numThumbs = Math.max(1, Math.ceil(width / thumbWidth));

                for (let i = 0; i < numThumbs; i++) {
                    const xOffset = i * thumbWidth;
                    const ratio = (xOffset + thumbWidth / 2) / width;
                    const timeInClip = ratio * durationSecs;
                    const targetTime = cut.in + timeInClip;

                    const interval = TIMELINE_STATE.globalThumbnailsInterval || 1.0;
                    const roundedTime = Math.round(targetTime / interval) * interval;

                    let img = this.getVideoThumb(video.id, roundedTime);
                    if (!img) {
                        // Exibição progressiva de fallback (vizinho mais próximo)
                        img = this.getClosestLoadedVideoThumb(video.id, roundedTime);
                    }

                    if (img) {
                        this.drawImageCover(img, startX + xOffset, clipY, thumbWidth, clipHeight);
                    }
                }

                // Véu escuro para legibilidade do texto do rótulo
                ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
                ctx.fillRect(startX, clipY, width, clipHeight);
                ctx.restore();
            }

            // Miniatura da foto como fundo (cover) + véu escuro para legibilidade do rótulo
            if (isPhoto && photo) {
                const thumb = this.getPhotoThumb(photo);
                if (thumb) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(startX, clipY, width, clipHeight);
                    ctx.clip();
                    this.drawImageCover(thumb, startX, clipY, width, clipHeight);
                    ctx.fillStyle = "rgba(0,0,0,0.35)";
                    ctx.fillRect(startX, clipY, width, clipHeight);
                    ctx.restore();
                }
            }

            const isSelected = (TIMELINE_STATE.selectedClipIds && TIMELINE_STATE.selectedClipIds.has(cut.id)) || TIMELINE_STATE.selectedClipId === cut.id;
            const isPartner = !isSelected && selectedLink && cut.link_id === selectedLink;
            ctx.strokeStyle = (isSelected || isPartner) ? this.colors.selection : style.border;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            if (isPartner) ctx.setLineDash([4, 3]); // par A/V do selecionado: tracejado
            ctx.strokeRect(startX, clipY, width, clipHeight);
            if (isPartner) ctx.setLineDash([]);

            // Waveform apenas nos clipes das pistas de áudio (fotos/textos não têm áudio)
            if (laneKind === "audio") {
                this.drawWaveform(cut, startX, clipY, width, clipHeight, style.wave, lane.track);
                // Faixa de diagnóstico de áudio: só desenha algo depois que o
                // usuário analisou este clipe (entrada publicada em STATE.audioDiag).
                this.drawAudioDiagStrip(ctx, cut, startX, clipY, width, clipHeight);
            }

            // Rótulo do clipe
            let label;
            if (isText) {
                const cat = cut.textCategory || "text";
                let tag = "🅃";
                if (cat === "lower_third") tag = "🅶🄲";
                else if (cat === "quote") tag = "❝";
                else if (cat === "subtitle") tag = "🄻🄴🄶";
                else if (cat === "chapter" || cat === "title") tag = "🅃🄸🅃";
                const txt = cut.text || "Texto";
                const sub = cut.subtext ? ` • ${cut.subtext}` : "";
                label = `${tag} "${txt}"${sub}`;
            } else if (isPhoto) {
                const name = photo ? (photo.title || photo.filename) : `Foto ${cut.photo_id}`;
                const durS = framesToSeconds(cut.outFrame - cut.inFrame, TIMELINE_STATE.fps);
                label = `▣ ${name} [${durS.toFixed(1)}s]`;
            } else {
                const name = video ? (video.title || video.filename) : `Vídeo ${cut.video_id}`;
                const prefix = laneKind === "audio" ? (cut.link_id ? "♪⇅" : "♪") : "#";
                const fps = TIMELINE_STATE.fps || 24;
                const maxFrame = Math.max(cut.inFrame || 0, cut.outFrame || 0);
                const forceHours = maxFrame >= 3600 * fps;
                const inTc = formatRulerTimecode(cut.inFrame || 0, fps, true, forceHours);
                const outTc = formatRulerTimecode(cut.outFrame || 0, fps, true, forceHours);
                label = `${prefix} ${name} [${inTc} → ${outTc}]`;
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(startX + 4, clipY, width - 8, clipHeight);
            ctx.clip(); // Limita o desenho do texto ao espaço do clipe

            ctx.fillStyle = this.colors.textPrimary;
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.fillText(label, startX + 8, clipY + 14);
            ctx.restore();

            // Desenho dos Marcadores de Keyframe (losangos ◆) se houver canais de animação
            if (cut.keyframes && Object.keys(cut.keyframes).length > 0) {
                const fps = TIMELINE_STATE.fps || 24;
                const kfFrames = getAllKeyframeTimelineFrames(cut, fps);
                if (kfFrames.length > 0) {
                    const kfY = clipY + clipHeight - 7;
                    ctx.save();
                    kfFrames.forEach(f => {
                        const kfX = (f - scrollLeft) * zoom;
                        if (kfX >= startX - 2 && kfX <= startX + width + 2) {
                            ctx.fillStyle = "rgba(6, 182, 212, 0.95)";
                            ctx.strokeStyle = "#ffffff";
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(kfX, kfY - 4);
                            ctx.lineTo(kfX + 4, kfY);
                            ctx.lineTo(kfX, kfY + 4);
                            ctx.lineTo(kfX - 4, kfY);
                            ctx.closePath();
                            ctx.fill();
                            ctx.stroke();
                        }
                    });
                    ctx.restore();
                }
            }

            // Desenho dos Fades In / Out, curvas e manipuladores
            this.drawClipFades(cut, startX, clipY, width, clipHeight, laneKind);
        });
    }

    /**
     * Miniatura (Image) de uma foto, carregada sob demanda e cacheada por id.
     * Retorna null enquanto carrega (dispara redesenho ao concluir).
     */
    getPhotoThumb(photo) {
        if (!photo || !photo.proxy_path) return null;
        const key = photo.id;
        const cached = this.photoThumbCache[key];
        if (cached) return cached.loaded ? cached.img : null;
        const img = new Image();
        const entry = { img, loaded: false };
        this.photoThumbCache[key] = entry;
        img.onload = () => { entry.loaded = true; this.requestRedraw(); };
        img.onerror = () => { entry.loaded = false; };
        img.src = String(photo.proxy_path).replace(/\\/g, "/");
        return null;
    }

    getVideoThumb(videoId, timestamp) {
        if (!videoId) return null;
        const key = `${videoId}_${timestamp.toFixed(1)}`;
        const cached = this.videoThumbCache[key];
        if (cached) return cached.loaded ? cached.img : null;

        const img = new Image();
        const entry = { img, loaded: false, timestamp, tentativas: 0 };
        this.videoThumbCache[key] = entry;

        // O servidor responde 404 enquanto a fila de fundo ainda não gerou este segundo
        // (ele deixou de extrair o frame dentro da requisição, que era o que enchia o
        // threadpool do FastAPI e travava rotas sem relação — a exportação entre elas).
        // Sem reagendar, a entrada ficaria em cache como "falhou" para sempre e o clipe
        // nunca ganharia suas miniaturas até um F5.
        // Espera crescente até um teto: as miniaturas do FIM de um vídeo longo só ficam
        // prontas minutos depois, então uma janela curta desistiria cedo demais. Assim
        // são ~2 min de tentativas, com poucos pedidos.
        const MAX_TENTATIVAS = 14;
        const espera = (n) => Math.min(1000 * Math.pow(1.5, n - 1), 15000);

        const pedir = () => {
            entry.tentativas += 1;
            // O sufixo evita que o navegador reaproveite o 404 anterior do cache dele
            img.src = `/api/video/${videoId}/thumbnail-at?time=${timestamp.toFixed(1)}&tentativa=${entry.tentativas}`;
        };

        img.onload = () => {
            entry.loaded = true;
            this.requestRedraw();
        };
        img.onerror = () => {
            entry.loaded = false;
            if (entry.tentativas < MAX_TENTATIVAS) {
                setTimeout(pedir, espera(entry.tentativas));
            } else {
                // Desiste e mantém no cache como falha temporária para evitar loops infinitos de rede no canvas
                entry.failed = true;
            }
        };

        pedir();
        return null;
    }

    getClosestLoadedVideoThumb(videoId, timestamp) {
        let bestImg = null;
        let minDiff = Infinity;
        for (const key in this.videoThumbCache) {
            if (key.startsWith(`${videoId}_`)) {
                const entry = this.videoThumbCache[key];
                if (entry.loaded) {
                    const diff = Math.abs(entry.timestamp - timestamp);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestImg = entry.img;
                    }
                }
            }
        }
        return bestImg;
    }

    /** Desenha uma imagem cobrindo (cover) o retângulo dado, preservando proporção. */
    drawImageCover(img, x, y, w, h) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        const scale = Math.max(w / iw, h / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
        this.ctx.drawImage(img, dx, dy, dw, dh);
    }

    /**
     * Calcula o fator de ganho efetivo para o desenho da waveform do clipe de áudio.
     * Considera:
     * 1. Volume e mute da trilha (lane.track ou TIMELINE_STATE.getTrack)
     * 2. Volume do clipe ({ type: "volume", level, disabled })
     * 3. Ganho de maquiagem da dinâmica ({ type: "audio_dynamics", makeup_db, disabled })
     * 4. Tratamento de áudio ({ type: "audio_render", status: "ready", analysis_before, analysis_after, disabled }) quando em modo tratado
     */
    getClipEffectiveAudioGain(cut, track) {
        if (!track && typeof TIMELINE_STATE !== "undefined" && typeof TIMELINE_STATE.getTrack === "function") {
            track = TIMELINE_STATE.getTrack(cut.track);
        }

        // 1. Mute ou volume da trilha
        if (track) {
            if (track.muted === true) {
                return 0;
            }
            if (track.hidden === true && typeof TIMELINE_STATE !== "undefined" && TIMELINE_STATE.muteHiddenTracksPlayback) {
                return 0;
            }
        }
        const trackVol = (track && typeof track.volume === "number" && !isNaN(track.volume)) ? track.volume : 1.0;

        // 2. Volume do clipe
        const effects = Array.isArray(cut.effects) ? cut.effects : [];
        const volEff = effects.find(e => e && e.type === "volume");
        let clipVol = 1.0;
        if (volEff && volEff.disabled !== true) {
            const rawVol = volEff.level !== undefined ? volEff.level : (volEff.gain !== undefined ? volEff.gain : 1.0);
            clipVol = (typeof rawVol === "number" && Number.isFinite(rawVol)) ? rawVol : 1.0;
        }

        // 3. Ganho da dinâmica (makeup_db)
        const dynEff = effects.find(e => e && e.type === "audio_dynamics");
        let dynGain = 1.0;
        if (dynEff && dynEff.disabled !== true && typeof dynEff.makeup_db === "number" && !isNaN(dynEff.makeup_db) && dynEff.makeup_db !== 0) {
            dynGain = Math.pow(10, dynEff.makeup_db / 20);
        }

        // 4. Tratamento de áudio (audio_render) se estiver ativo e conectado como tratado
        let renderGain = 1.0;
        const renderEff = effects.find(e => e && e.type === "audio_render");
        if (renderEff && renderEff.status === "ready" && renderEff.disabled !== true) {
            const pp = (typeof window !== "undefined" && window.player && window.player.programPlayer) ? window.player.programPlayer : null;
            const usandoTratado = pp && typeof pp.fonteAudioTratadaAtual === "function" ? !!pp.fonteAudioTratadaAtual(cut.id) : true;
            if (usandoTratado && renderEff.analysis_before && renderEff.analysis_after) {
                const lufsBefore = Number(renderEff.analysis_before.lufs);
                const lufsAfter = Number(renderEff.analysis_after.lufs);
                if (Number.isFinite(lufsBefore) && Number.isFinite(lufsAfter)) {
                    const deltaLufs = lufsAfter - lufsBefore;
                    const clampedDelta = Math.max(-30, Math.min(30, deltaLufs));
                    renderGain = Math.pow(10, clampedDelta / 20);
                }
            }
        }

        const totalGain = trackVol * clipVol * dynGain * renderGain;
        return (typeof totalGain === "number" && !isNaN(totalGain)) ? Math.max(0, totalGain) : 1.0;
    }

    /**
     * Desenha waveforms de áudio fidedignas e reais dentro dos clipes da timeline,
     * adaptando a amplitude ao volume efetivo, respeitando fades e indicando saturação/clipping sutilmente.
     */
    drawWaveform(cut, startX, clipY, width, clipHeight, waveColor, track) {
        const ctx = this.ctx;
        const totalGain = this.getClipEffectiveAudioGain(cut, track);

        const centerY = clipY + clipHeight / 2;
        const maxAmplitude = (clipHeight - 16) / 2; // Margem para respeitar bordas do clipe e rótulos
        if (maxAmplitude <= 2) return;

        // Se o volume estiver mutado / zerado (silêncio total configurado)
        if (totalGain <= 0.001) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
            ctx.lineWidth = 1;
            ctx.moveTo(startX + 2, centerY);
            ctx.lineTo(startX + width - 2, centerY);
            ctx.stroke();
            ctx.restore();
            return;
        }

        // Fades de áudio configurados no clipe
        const fps = TIMELINE_STATE.fps || 24;
        const durFrames = cut.outFrame - cut.inFrame;
        const clipDurS = durFrames / fps;
        const inSec = (cut.inFrame || 0) / fps;
        const outSec = (cut.outFrame || 0) / fps;
        const effects = cut.effects || [];
        const fadeInEff = effects.find(e => e.type === "crossfade" && e.side === "in" && !e.disabled);
        const fadeOutEff = effects.find(e => e.type === "crossfade" && e.side === "out" && !e.disabled);
        const fadeInDur = fadeInEff ? Math.min(clipDurS, Math.max(0, fadeInEff.duration_s || 0)) : 0;
        const fadeOutDur = fadeOutEff ? Math.min(clipDurS - fadeInDur, Math.max(0, fadeOutEff.duration_s || 0)) : 0;

        // 1 ponto a cada 2 pixels para desenho suave e detalhado
        const numPoints = Math.max(10, Math.floor(width / 2));

        // Busca picos reais no WaveformManager
        const sampled = WaveformManager.getSampledEnvelope(cut.video_id, inSec, outSec, numPoints);

        const clippingPoints = [];

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = waveColor || "rgba(110, 231, 183, 0.65)";
        ctx.lineWidth = 1.3;

        if (sampled && sampled.hasData && sampled.peaks.length > 0) {
            const peaks = sampled.peaks;
            const count = peaks.length;

            for (let i = 0; i < count; i++) {
                const px = startX + (i / count) * width;
                const tSample = (i / count) * clipDurS;
                let fadeGain = 1.0;
                if (fadeInDur > 0 && tSample < fadeInDur) {
                    const p = tSample / fadeInDur;
                    fadeGain = Math.min(fadeGain, evaluateFadeCurve(p, fadeInEff.curve || "linear", fadeInEff.tension || 0));
                }
                if (fadeOutDur > 0 && (clipDurS - tSample) < fadeOutDur) {
                    const p = (clipDurS - tSample) / fadeOutDur;
                    fadeGain = Math.min(fadeGain, evaluateFadeCurve(p, fadeOutEff.curve || "linear", fadeOutEff.tension || 0));
                }

                const sampleGain = totalGain * fadeGain;
                const pMin = peaks[i].min; // amplitude mínima real (negativa, ex: -0.6)
                const pMax = peaks[i].max; // amplitude máxima real (positiva, ex: +0.7)

                const rawAmpPos = Math.abs(pMax) * maxAmplitude * sampleGain;
                const rawAmpNeg = Math.abs(pMin) * maxAmplitude * sampleGain;

                const isClipped = rawAmpPos >= maxAmplitude || rawAmpNeg >= maxAmplitude;
                const ampTop = Math.min(rawAmpPos, maxAmplitude);
                const ampBottom = Math.min(rawAmpNeg, maxAmplitude);

                if (ampTop <= 0.5 && ampBottom <= 0.5) {
                    // Silêncio real: linha reta fina no centro
                    ctx.moveTo(px, centerY - 0.5);
                    ctx.lineTo(px, centerY + 0.5);
                } else {
                    // Onda real bipolar espelhada
                    ctx.moveTo(px, centerY - ampTop);
                    ctx.lineTo(px, centerY + ampBottom);
                }

                if (isClipped) {
                    clippingPoints.push({ px, yTop: centerY - maxAmplitude, yBottom: centerY + maxAmplitude });
                }
            }
            ctx.stroke();
        } else {
            const isLoading = WaveformManager && typeof WaveformManager.isLoading === "function" && WaveformManager.isLoading(cut.video_id);
            if (isLoading) {
                // Animação sutil e elegante de onda pulsante / extração de áudio em tempo real
                const time = performance.now() / 350;
                const waveHeight = Math.min(5, Math.max(2, maxAmplitude * 0.35));

                ctx.save();
                // Linha de base suave
                ctx.beginPath();
                ctx.strokeStyle = "rgba(110, 231, 183, 0.2)";
                ctx.lineWidth = 1.0;
                ctx.moveTo(startX + 2, centerY);
                ctx.lineTo(startX + width - 2, centerY);
                ctx.stroke();

                // Onda senoidal sutil pontilhada em movimento (shimmer)
                ctx.beginPath();
                ctx.strokeStyle = "rgba(110, 231, 183, 0.6)";
                ctx.lineWidth = 1.3;
                ctx.setLineDash([4, 4]);
                ctx.lineDashOffset = -time * 8;

                const step = 4;
                ctx.moveTo(startX + 2, centerY);
                for (let x = startX + 2; x <= startX + width - 2; x += step) {
                    const phase = ((x - startX) / 16) + time;
                    const y = centerY + Math.sin(phase) * waveHeight;
                    ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // Rótulo discreto de status se houver espaço no clipe
                if (width >= 80 && clipHeight >= 28) {
                    ctx.fillStyle = "rgba(110, 231, 183, 0.75)";
                    ctx.font = "italic 9px Inter, sans-serif";
                    ctx.fillText("∿ gerando onda...", startX + 8, centerY + 14);
                }
                ctx.restore();
            } else {
                // Enquanto o arquivo de picos não existe ou está em repouso, exibe linha de base sutil
                ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
                ctx.lineWidth = 1.0;
                ctx.moveTo(startX + 2, centerY);
                ctx.lineTo(startX + width - 2, centerY);
                ctx.stroke();
            }
        }

        // Destaque sutil de saturação (clipping) nos pontos onde estourou
        if (clippingPoints.length > 0) {
            ctx.beginPath();
            ctx.strokeStyle = "rgba(244, 63, 94, 0.9)";
            ctx.lineWidth = 1.6;
            for (const pt of clippingPoints) {
                // Pequenos traços horizontais no topo e base marcando o teto saturado
                ctx.moveTo(pt.px - 1.2, pt.yTop);
                ctx.lineTo(pt.px + 1.2, pt.yTop);
                ctx.moveTo(pt.px - 1.2, pt.yBottom);
                ctx.lineTo(pt.px + 1.2, pt.yBottom);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * Desenha a representação gráfica de Fade In e Fade Out (rampas de sombreamento para vídeo/foto,
     * linhas de ganho/curva para áudio, puxadores nos cantos superiores e pontos de tensão central).
     */
    drawClipFades(cut, startX, clipY, width, clipHeight, laneKind) {
        const ctx = this.ctx;
        const fps = TIMELINE_STATE.fps || 24;
        const zoom = TIMELINE_STATE.zoom;
        const durFrames = cut.outFrame - cut.inFrame;
        const clipDurS = durFrames / fps;
        if (clipDurS <= 0 || width <= 4) return;

        const effects = cut.effects || [];
        const fadeInEff = effects.find(e => e.type === "crossfade" && e.side === "in" && !e.disabled);
        const fadeOutEff = effects.find(e => e.type === "crossfade" && e.side === "out" && !e.disabled);

        const fadeInDur = fadeInEff ? Math.min(clipDurS, Math.max(0, fadeInEff.duration_s || 0)) : 0;
        const fadeOutDur = fadeOutEff ? Math.min(clipDurS - fadeInDur, Math.max(0, fadeOutEff.duration_s || 0)) : 0;

        const wIn = Math.min(width, fadeInDur * fps * zoom);
        const wOut = Math.min(width - wIn, fadeOutDur * fps * zoom);

        const hoveredHandle = TIMELINE_STATE.hoveredFadeHandle;
        const isClipHovered = hoveredHandle && String(hoveredHandle.clipId) === String(cut.id);

        const isAudio = laneKind === "audio";
        const accentColor = isAudio ? "rgba(16, 185, 129, 0.9)" : "rgba(6, 182, 212, 0.9)";
        const lineColor = isAudio ? "rgba(110, 231, 183, 0.85)" : "rgba(255, 255, 255, 0.8)";

        // ── 1. FADE IN ──
        if (fadeInDur > 0 && wIn > 1) {
            const curveType = fadeInEff.curve || "linear";
            const tension = fadeInEff.tension || 0;

            // Para vídeo/foto: sombreamento de opacidade
            if (!isAudio) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(startX, clipY);
                const steps = Math.max(8, Math.min(60, Math.floor(wIn / 2)));
                for (let i = 0; i <= steps; i++) {
                    const progress = i / steps;
                    const factor = evaluateFadeCurve(progress, curveType, tension);
                    const px = startX + progress * wIn;
                    const py = clipY + (1 - factor) * clipHeight;
                    ctx.lineTo(px, py);
                }
                ctx.lineTo(startX, clipY + clipHeight);
                ctx.closePath();
                ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
                ctx.fill();
                ctx.restore();
            }

            // Linha da curva
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.5;
            const steps = Math.max(8, Math.min(60, Math.floor(wIn / 2)));
            for (let i = 0; i <= steps; i++) {
                const progress = i / steps;
                const factor = evaluateFadeCurve(progress, curveType, tension);
                const px = startX + progress * wIn;
                const py = clipY + (1 - factor) * (clipHeight - 4) + 2;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.restore();

            // Ponto de tensão central (se houver largura suficiente para manipular)
            if (wIn >= 16) {
                const factorMid = evaluateFadeCurve(0.5, curveType, tension);
                const pxMid = startX + 0.5 * wIn;
                const pyMid = clipY + (1 - factorMid) * (clipHeight - 4) + 2;
                const isCurveHovered = isClipHovered && hoveredHandle.side === "in" && hoveredHandle.type === "curve";

                ctx.save();
                ctx.beginPath();
                ctx.arc(pxMid, pyMid, isCurveHovered ? 4 : 2.5, 0, Math.PI * 2);
                ctx.fillStyle = isCurveHovered ? "#ffffff" : accentColor;
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }

            // Puxador de duração do Fade In (no topo final da rampa)
            const isDurHovered = isClipHovered && hoveredHandle.side === "in" && hoveredHandle.type === "duration";
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = isDurHovered ? "#ffffff" : accentColor;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
            ctx.lineWidth = 1;
            const hx = startX + wIn;
            const hy = clipY;
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx - 5, hy);
            ctx.lineTo(hx, hy + 7);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else {
            // Affordance sutil no canto superior esquerdo (quando não há fade in)
            const isCornerHovered = isClipHovered && hoveredHandle.side === "in" && hoveredHandle.type === "duration";
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = isCornerHovered ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.22)";
            ctx.moveTo(startX, clipY);
            ctx.lineTo(startX + 6, clipY);
            ctx.lineTo(startX, clipY + 6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        // ── 2. FADE OUT ──
        if (fadeOutDur > 0 && wOut > 1) {
            const curveType = fadeOutEff.curve || "linear";
            const tension = fadeOutEff.tension || 0;
            const startOutX = startX + width - wOut;

            // Para vídeo/foto: sombreamento de opacidade
            if (!isAudio) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(startOutX, clipY);
                const steps = Math.max(8, Math.min(60, Math.floor(wOut / 2)));
                for (let i = 0; i <= steps; i++) {
                    const progress = i / steps; // 0 no início do fade-out, 1 no fim do clipe
                    const factor = evaluateFadeCurve(1 - progress, curveType, tension);
                    const px = startOutX + progress * wOut;
                    const py = clipY + (1 - factor) * clipHeight;
                    ctx.lineTo(px, py);
                }
                ctx.lineTo(startX + width, clipY);
                ctx.closePath();
                ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
                ctx.fill();
                ctx.restore();
            }

            // Linha da curva
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1.5;
            const steps = Math.max(8, Math.min(60, Math.floor(wOut / 2)));
            for (let i = 0; i <= steps; i++) {
                const progress = i / steps;
                const factor = evaluateFadeCurve(1 - progress, curveType, tension);
                const px = startOutX + progress * wOut;
                const py = clipY + (1 - factor) * (clipHeight - 4) + 2;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            ctx.restore();

            // Ponto de tensão central
            if (wOut >= 16) {
                const factorMid = evaluateFadeCurve(0.5, curveType, tension);
                const pxMid = startOutX + 0.5 * wOut;
                const pyMid = clipY + (1 - factorMid) * (clipHeight - 4) + 2;
                const isCurveHovered = isClipHovered && hoveredHandle.side === "out" && hoveredHandle.type === "curve";

                ctx.save();
                ctx.beginPath();
                ctx.arc(pxMid, pyMid, isCurveHovered ? 4 : 2.5, 0, Math.PI * 2);
                ctx.fillStyle = isCurveHovered ? "#ffffff" : accentColor;
                ctx.fill();
                ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            }

            // Puxador de duração do Fade Out (no topo de início da rampa)
            const isDurHovered = isClipHovered && hoveredHandle.side === "out" && hoveredHandle.type === "duration";
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = isDurHovered ? "#ffffff" : accentColor;
            ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
            ctx.lineWidth = 1;
            const hx = startOutX;
            const hy = clipY;
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx + 5, hy);
            ctx.lineTo(hx, hy + 7);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else {
            // Affordance sutil no canto superior direito (quando não há fade out)
            const isCornerHovered = isClipHovered && hoveredHandle.side === "out" && hoveredHandle.type === "duration";
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = isCornerHovered ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.22)";
            ctx.moveTo(startX + width, clipY);
            ctx.lineTo(startX + width - 6, clipY);
            ctx.lineTo(startX + width, clipY + 6);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Diagnóstico publicado pelo painel de Ajustes para o trecho deste clipe
     * (chave "video_id|in|out" com 3 casas), ou null se ainda não analisado.
     */
    getAudioDiag(cut) {
        const store = STATE.audioDiag;
        if (!store) return null;
        const diag = store[`${cut.video_id}|${Number(cut.in).toFixed(3)}|${Number(cut.out).toFixed(3)}`];
        if (!diag || !Array.isArray(diag.envelope)) return null;
        return diag;
    }

    /**
     * Faixa fina de diagnóstico na base do clipe de áudio: intensidade por balde
     * (ftpk_max) do transparente ao vermelho + marcas verticais nos momentos
     * problemáticos ("estouro" nítida, "quase" discreta). Os tempos vêm em segundos
     * absolutos da fonte e o trecho exibido vai de cut.in a cut.out esticado na
     * largura do retângulo — logo, x é proporcional a (t - in) / (out - in).
     * A waveform ocupa o centro do clipe (±(altura-20)/2), então a margem inferior
     * fica livre e a tira não compete com ela. Sem diagnóstico: não desenha nada.
     */
    drawAudioDiagStrip(ctx, cut, startX, clipY, width, clipHeight) {
        if (!(width >= AUDIO_DIAG_LARGURA_MIN_PX)) return; // estreito demais na tela
        const diag = this.getAudioDiag(cut);
        if (!diag) return; // usuário ainda não analisou este clipe
        const momentos = Array.isArray(diag.momentos) ? diag.momentos : [];
        if (!Array.isArray(diag.envelope) || (diag.envelope.length === 0 && momentos.length === 0)) {
            return; // análise sem quadros/problemáticos: nada a pintar, nem save/clip
        }
        const inS = Number(cut.in);
        const outS = Number(cut.out);

        const stripH = Math.max(3, Math.min(6, Math.floor(clipHeight * 0.14)));
        const stripY = clipY + clipHeight - stripH - 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(startX, clipY, width, clipHeight);
        ctx.clip(); // nada vaza para fora do bloco do clipe

        // 1) Envelope por balde (<=600 baldes; baldes fora do trecho/viewport são descartados cedo)
        for (const b of diag.envelope) {
            const pk = Number(b && b.ftpk_max);
            if (!Number.isFinite(pk)) continue;
            const janela = janelaBalde(b.t0, b.t1, inS, outS);
            if (!janela) continue;
            const px0 = startX + janela.u0 * width;
            const px1 = startX + janela.u1 * width;
            if (px1 < 0 || px0 > this.width) continue; // fora da área visível (zoom/scroll)
            const intensidade = Math.min(1, Math.max(0, (pk - AUDIO_DIAG_PISO_DB) / -AUDIO_DIAG_PISO_DB));
            if (intensidade <= 0) continue; // silencioso: permanece transparente
            ctx.fillStyle = `rgba(239, 68, 68, ${(intensidade * AUDIO_DIAG_ALPHA_MAX).toFixed(3)})`;
            ctx.fillRect(px0, stripY, Math.max(px1 - px0, 1), stripH);
        }

        // 2) Marcas verticais dos momentos: "estouro" (grave) nítida em vermelho,
        // subindo um pouco acima da tira; "quase" (atenção) discreta em âmbar.
        for (const m of momentos) {
            const frac = fracaoNoTrecho(m && m.inicio, inS, outS);
            if (frac === null) continue; // momento fora do trecho do clipe
            const x = Math.round(startX + frac * width);
            if (x < 0 || x > this.width) continue; // fora do viewport
            const grave = m.tipo === "estouro";
            const wMarca = grave ? 2 : 1;
            ctx.fillStyle = grave ? "#ef4444" : "rgba(245, 158, 11, 0.55)";
            ctx.fillRect(x - Math.floor(wMarca / 2), grave ? stripY - 4 : stripY, wMarca, grave ? stripH + 4 : stripH);
        }

        ctx.restore();
    }

    /**
     * Retorna o retângulo de renderização de um ghost clip: {x, y, w, h}.
     * INSERT/REPLACE são desenhados na pista de IA; DELETE é desenhado
     * sobre o clipe alvo na pista original (hachurado).
     */
    getGhostRect(ghost) {
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const duration = ghost.outFrame - ghost.inFrame;

        if (ghost.action === "DELETE" && ghost.targetClipId) {
            const target = STATE.activeTimelineCuts.find(c => c.id === ghost.targetClipId);
            if (target) {
                const lane = this.getLane(target.track);
                if (lane) {
                    return {
                        x: (ghost.timelineStartFrame - scrollLeft) * zoom,
                        y: lane.top,
                        w: duration * zoom,
                        h: lane.height
                    };
                }
            }
        }

        const aiTrack = TIMELINE_STATE.getAiTrack();
        const lane = aiTrack ? this.getLane(aiTrack.id) : null;
        if (!lane) return null;
        return {
            x: (ghost.timelineStartFrame - scrollLeft) * zoom,
            y: lane.top,
            w: Math.max(duration * zoom, 20),
            h: lane.height
        };
    }

    /**
     * Desenha as sugestões de IA (Ghost Clips) na pista de IA (e hachuras de DELETE nas pistas alvo).
     */
    drawGhostClips() {
        const ctx = this.ctx;
        const ghosts = TIMELINE_STATE.ghostTrack;

        ghosts.forEach((ghost) => {
            const rect = this.getGhostRect(ghost);
            if (!rect) return;
            if (rect.x + rect.w < 0 || rect.x > this.width) return;
            if (rect.y + rect.h < this.rulerHeight || rect.y > this.height) return;

            const isSelected = TIMELINE_STATE.selectedGhostClipId === ghost.id;

            if (ghost.action === "DELETE") {
                // Hachurado vermelho sobre o trecho a remover
                ctx.fillStyle = this.colors.ghostRedHachure;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

                ctx.strokeStyle = isSelected ? this.colors.selection : this.colors.ghostRedBorder;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

                ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
                ctx.lineWidth = 1;
                ctx.save();
                ctx.beginPath();
                ctx.rect(rect.x, rect.y, rect.w, rect.h);
                ctx.clip();

                for (let offset = -rect.h; offset < rect.w; offset += 10) {
                    ctx.beginPath();
                    ctx.moveTo(rect.x + offset, rect.y);
                    ctx.lineTo(rect.x + offset + rect.h, rect.y + rect.h);
                    ctx.stroke();
                }
                ctx.restore();

                ctx.fillStyle = "#ef4444";
                ctx.font = "bold 9px Inter, sans-serif";
                ctx.fillText("[IA: SUGERE CORTE]", rect.x + 6, rect.y + 12);
            } else {
                // INSERT (verde) / REPLACE (âmbar) na pista de IA
                const isReplace = ghost.action === "REPLACE";
                ctx.fillStyle = isReplace ? this.colors.ghostAmberBg : this.colors.ghostGreenBg;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

                ctx.strokeStyle = isSelected ? this.colors.selection : (isReplace ? this.colors.ghostAmberBorder : this.colors.ghostGreenBorder);
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]); // Borda pontilhada
                ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
                ctx.setLineDash([]); // Restaura borda sólida

                // Rótulo: destino + duração (resolve mídia por vídeo ou foto)
                const isPhotoGhost = ghost.type === "photo";
                const media = isPhotoGhost
                    ? STATE.allPhotos.find(p => p.id === ghost.photo_id)
                    : STATE.allVideos.find(v => v.id === ghost.video_id);
                const mediaName = media ? (media.title || media.filename) : (isPhotoGhost ? "foto" : "clipe");
                const targetTrack = TIMELINE_STATE.getTrack(ghost.track);
                const trackName = targetTrack ? (targetTrack.name || targetTrack.id) : ghost.track;
                const durS = framesToSeconds(ghost.outFrame - ghost.inFrame, TIMELINE_STATE.fps);
                const label = isReplace
                    ? `[IA: SUBSTITUIR → ${trackName}]`
                    : `[IA: ${isPhotoGhost ? "▣" : "+"} ${mediaName.substring(0, 18)} → ${trackName} | ${durS.toFixed(1)}s]`;

                ctx.save();
                ctx.beginPath();
                ctx.rect(rect.x + 2, rect.y, Math.max(rect.w - 4, 16), rect.h);
                ctx.clip();
                ctx.fillStyle = isReplace ? "#f59e0b" : "#22c55e";
                ctx.font = "bold 9px Inter, sans-serif";
                ctx.fillText(label, rect.x + 6, rect.y + rect.h / 2 + 3);
                ctx.restore();
            }
        });
    }

    /**
     * Desenha a linha de Playhead vertical vermelha.
     */
    drawPlayhead() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const playhead = TIMELINE_STATE.playheadFrame;

        const x = (playhead - scrollLeft) * zoom;

        // Se estiver visível no canvas, desenha
        if (x >= 0 && x <= this.width) {
            ctx.strokeStyle = this.colors.playhead;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height);
            ctx.stroke();

            // Desenha pequena cabeça triangular no topo da régua
            ctx.fillStyle = this.colors.playhead;
            ctx.beginPath();
            ctx.moveTo(x - 5, 0);
            ctx.lineTo(x + 5, 0);
            ctx.lineTo(x, 8);
            ctx.closePath();
            ctx.fill();
        }
    }
}
