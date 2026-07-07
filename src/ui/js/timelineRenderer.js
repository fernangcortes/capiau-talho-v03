// Renderizador de Alta Performance via Canvas (CapIAu-Talho)
// v2: Multipista dinâmica com pista de IA, scroll vertical e cores por pista.
import { STATE } from "./state.js";
import { TIMELINE_STATE, framesToTimecode, framesToSeconds } from "./timelineState.js";

// Paleta rotativa para pistas de vídeo adicionais
const TRACK_PALETTE = [
    { bg: "rgba(6, 182, 212, 0.15)", clipBg: "rgba(6, 182, 212, 0.25)", border: "rgba(6, 182, 212, 0.7)", wave: "rgba(6, 182, 212, 0.4)" },   // ciano
    { bg: "rgba(139, 92, 246, 0.15)", clipBg: "rgba(139, 92, 246, 0.25)", border: "rgba(139, 92, 246, 0.7)", wave: "rgba(139, 92, 246, 0.4)" }, // roxo
    { bg: "rgba(236, 72, 153, 0.12)", clipBg: "rgba(236, 72, 153, 0.22)", border: "rgba(236, 72, 153, 0.65)", wave: "rgba(236, 72, 153, 0.4)" }, // rosa
    { bg: "rgba(245, 158, 11, 0.10)", clipBg: "rgba(245, 158, 11, 0.20)", border: "rgba(245, 158, 11, 0.6)", wave: "rgba(245, 158, 11, 0.4)" },  // âmbar
    { bg: "rgba(16, 185, 129, 0.10)", clipBg: "rgba(16, 185, 129, 0.20)", border: "rgba(16, 185, 129, 0.6)", wave: "rgba(16, 185, 129, 0.4)" }   // esmeralda
];

const AI_TRACK_STYLE = {
    bg: "rgba(34, 197, 94, 0.06)",
    clipBg: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.6)"
};

// Pistas de áudio (verde-esmeralda, como nos NLEs)
const AUDIO_TRACK_STYLE = {
    bg: "rgba(16, 185, 129, 0.07)",
    clipBg: "rgba(16, 185, 129, 0.18)",
    border: "rgba(16, 185, 129, 0.6)",
    wave: "rgba(110, 231, 183, 0.55)"
};

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
        this.init();
    }

    // ── GEOMETRIA DAS PISTAS ────────────────────────────────────────────

    /**
     * Retorna a lista de lanes visíveis: [{track, top, height}] já com scroll vertical aplicado.
     */
    getTrackLanes() {
        const lanes = [];
        let y = this.rulerHeight - TIMELINE_STATE.scrollTop;
        for (const track of TIMELINE_STATE.tracks) {
            const h = TIMELINE_STATE.trackHeight(track);
            lanes.push({ track, top: y, height: h });
            y += h;
        }
        return lanes;
    }

    /** Retorna a lane de uma pista pelo id (ou null). */
    getLane(trackId) {
        return this.getTrackLanes().find(l => l.track.id === trackId) || null;
    }

    /** Retorna a pista sob a coordenada Y do canvas (ou null se fora). */
    getTrackAtY(y) {
        if (y < this.rulerHeight) return null;
        for (const lane of this.getTrackLanes()) {
            if (y >= lane.top && y < lane.top + lane.height) return lane.track;
        }
        return null;
    }

    /** Estilo visual de uma pista de vídeo pelo índice entre as pistas de vídeo. */
    getTrackStyle(track) {
        if (track.kind === "ai") return AI_TRACK_STYLE;
        if (track.kind === "audio") return AUDIO_TRACK_STYLE;
        const videoTracks = TIMELINE_STATE.getVideoTracks();
        const idx = videoTracks.findIndex(t => t.id === track.id);
        return TRACK_PALETTE[((idx % TRACK_PALETTE.length) + TRACK_PALETTE.length) % TRACK_PALETTE.length];
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
        STATE.on("timelineCutsUpdated", () => this.requestRedraw());
        STATE.on("timelineGhostUpdated", () => this.requestRedraw());
        STATE.on("timelineTracksChanged", () => this.requestRedraw());
        STATE.on("timelineFpsChanged", () => this.requestRedraw());
        STATE.on("timelineZoomChanged", () => this.requestRedraw());
        STATE.on("timelineScrollChanged", () => this.requestRedraw());
        STATE.on("timelineVScrollChanged", () => this.requestRedraw());
        STATE.on("timelinePlayheadChanged", () => this.requestRedraw());
        STATE.on("activeVideoChanged", () => this.requestRedraw());

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

        // Desenha os clipes salvos
        this.drawClips();

        // Desenha as sugestões fantasma da IA (Ghost Clips)
        this.drawGhostClips();

        // Desenha a grade e a régua de tempo (por cima das pistas roladas)
        this.drawRuler();

        // Desenha o cursor do Playhead (currentTime)
        this.drawPlayhead();
    }

    /**
     * Desenha as faixas de fundo e linhas horizontais divisórias (dinâmico).
     */
    drawTracksBackground() {
        const ctx = this.ctx;

        for (const lane of this.getTrackLanes()) {
            if (lane.top + lane.height < this.rulerHeight || lane.top > this.height) continue;

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
     * Desenha a régua de tempo com marcas de subdivisão de frames/segundos.
     */
    drawRuler() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const fps = TIMELINE_STATE.fps;

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

        // Determinar intervalo de escala baseado no zoom
        const framesPerSecond = fps;
        let tickInterval = 5; // A cada 5 frames por padrão
        let textInterval = framesPerSecond; // Texto a cada 1 segundo (24 frames)

        const pixelsPerSecond = zoom * framesPerSecond;
        if (pixelsPerSecond < 50) {
            tickInterval = framesPerSecond; // Ticks a cada 1 segundo
            textInterval = framesPerSecond * 5; // Texto a cada 5 segundos
        }
        if (pixelsPerSecond < 10) {
            tickInterval = framesPerSecond * 5;
            textInterval = framesPerSecond * 30; // Texto a cada 30 segundos
        }
        if (zoom > 1.0) {
            tickInterval = 1; // Tick a cada frame individual
            textInterval = 12; // Texto a cada meio segundo (12 frames)
        }

        // Calcula frames visíveis
        const startFrame = scrollLeft;
        const endFrame = startFrame + Math.ceil(this.width / zoom);

        ctx.fillStyle = this.colors.rulerText;
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        for (let f = Math.floor(startFrame / tickInterval) * tickInterval; f <= endFrame; f += tickInterval) {
            const x = (f - startFrame) * zoom;

            const isTextTick = f % textInterval === 0;
            const tickSize = isTextTick ? 12 : 6;

            // Desenha tick
            ctx.strokeStyle = this.colors.rulerTicks;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, this.rulerHeight - tickSize);
            ctx.lineTo(x, this.rulerHeight);
            ctx.stroke();

            // Desenha texto
            if (isTextTick) {
                const tc = framesToTimecode(f, fps);
                // Exibe apenas MM:SS ou MM:SS:FF dependendo do zoom para visual limpo
                const displayTc = tc.substring(3); // Remove o HH: inicial
                ctx.fillText(displayTc, x + 4, this.rulerHeight - 16);
            }
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

            const duration = cut.outFrame - cut.inFrame;
            const startX = (cut.timelineStartFrame - scrollLeft) * zoom;
            const width = duration * zoom;

            // Ignora se estiver fora do viewport visível
            if (startX + width < 0 || startX > this.width) return;

            const style = this.getTrackStyle(lane.track);
            const laneKind = lane.track.kind || "video";

            // Espaçamento interno vertical do clipe
            const clipY = lane.top + 6;
            const clipHeight = lane.height - 12;

            // Desenhar bloco do clipe
            ctx.fillStyle = style.clipBg;
            ctx.fillRect(startX, clipY, width, clipHeight);

            const isSelected = TIMELINE_STATE.selectedClipId === cut.id;
            const isPartner = !isSelected && selectedLink && cut.link_id === selectedLink;
            ctx.strokeStyle = (isSelected || isPartner) ? this.colors.selection : style.border;
            ctx.lineWidth = isSelected ? 2 : 1.5;
            if (isPartner) ctx.setLineDash([4, 3]); // par A/V do selecionado: tracejado
            ctx.strokeRect(startX, clipY, width, clipHeight);
            if (isPartner) ctx.setLineDash([]);

            // Waveform nos clipes das pistas de áudio
            const video = STATE.allVideos.find(v => v.id === cut.video_id);
            if (laneKind === "audio") {
                this.drawWaveform(cut, startX, clipY, width, clipHeight, style.wave);
            }

            // Desenhar texto descritivo do clipe (Nome do arquivo)
            const name = video ? video.filename : `Vídeo ${cut.video_id}`;
            const prefix = laneKind === "audio" ? (cut.link_id ? "♪⇅" : "♪") : "#";
            const label = `${prefix} ${name} [${framesToTimecode(cut.inFrame, TIMELINE_STATE.fps).substring(6)} -> ${framesToTimecode(cut.outFrame, TIMELINE_STATE.fps).substring(6)}]`;

            ctx.save();
            ctx.beginPath();
            ctx.rect(startX + 4, clipY, width - 8, clipHeight);
            ctx.clip(); // Limita o desenho do texto ao espaço do clipe

            ctx.fillStyle = this.colors.textPrimary;
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.fillText(label, startX + 8, clipY + 14);
            ctx.restore();
        });
    }

    /**
     * Desenha waveforms de áudio realistas dentro dos clipes de fala.
     */
    drawWaveform(cut, startX, clipY, width, clipHeight, waveColor) {
        const ctx = this.ctx;
        ctx.strokeStyle = waveColor || "rgba(6, 182, 212, 0.4)";
        ctx.lineWidth = 1.2;

        const centerY = clipY + clipHeight / 2;
        const maxAmplitude = (clipHeight - 20) / 2;
        if (maxAmplitude <= 2) return;

        // Se o vídeo não possui waveform_data real, gera picos estáveis determinísticos baseados no id
        let peaks = [];
        const numPoints = Math.max(10, Math.floor(width / 3)); // 1 ponto a cada 3px

        // Simulação pseudo-aleatória estável baseada no ID do clipe
        const seed = cut.video_id * 100 + cut.inFrame;
        const random = (s) => {
            const x = Math.sin(s) * 10000;
            return x - Math.floor(x);
        };

        for (let i = 0; i < numPoints; i++) {
            const phase = (i / numPoints) * Math.PI * 8;
            // Cria um sinal complexo de fala (altos e baixos, pausas de silêncio)
            let val = Math.abs(Math.sin(phase) * 0.4 + random(seed + i) * 0.3);
            if (i % 15 < 3) val = 0.02; // Simula silêncio/pausa entre palavras
            peaks.push(val);
        }

        ctx.beginPath();
        for (let i = 0; i < numPoints; i++) {
            const px = startX + (i / numPoints) * width;
            const amp = peaks[i] * maxAmplitude;
            ctx.moveTo(px, centerY - amp);
            ctx.lineTo(px, centerY + amp);
        }
        ctx.stroke();
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
                        y: lane.top + 6,
                        w: duration * zoom,
                        h: lane.height - 12
                    };
                }
            }
        }

        const aiTrack = TIMELINE_STATE.getAiTrack();
        const lane = aiTrack ? this.getLane(aiTrack.id) : null;
        if (!lane) return null;
        return {
            x: (ghost.timelineStartFrame - scrollLeft) * zoom,
            y: lane.top + 5,
            w: Math.max(duration * zoom, 20),
            h: lane.height - 10
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

                // Rótulo: destino + duração
                const video = STATE.allVideos.find(v => v.id === ghost.video_id);
                const targetTrack = TIMELINE_STATE.getTrack(ghost.track);
                const trackName = targetTrack ? (targetTrack.name || targetTrack.id) : ghost.track;
                const durS = framesToSeconds(ghost.outFrame - ghost.inFrame, TIMELINE_STATE.fps);
                const label = isReplace
                    ? `[IA: SUBSTITUIR → ${trackName}]`
                    : `[IA: + ${video ? video.filename.substring(0, 18) : "clipe"} → ${trackName} | ${durS.toFixed(1)}s]`;

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
