// Renderizador de Alta Performance via Canvas (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, framesToTimecode, framesToSeconds } from "./timelineState.js";

export class CapiauTimelineRenderer {
    constructor() {
        this.canvas = document.getElementById("timeline-canvas");
        if (!this.canvas) {
            console.error("Elemento timeline-canvas não encontrado!");
            return;
        }
        this.ctx = this.canvas.getContext("2d");
        
        // Configurações visuais (Layout vertical fixo)
        this.rulerHeight = 30;
        this.trackHeight = 85;
        
        // Cores do tema (Sintonizado com CSS Glassmorphism)
        this.colors = {
            bg: "#111827",            // Fundo escuro base (gray-900)
            rulerBg: "#0f172a",       // Fundo da régua (slate-900)
            rulerTicks: "#475569",    // Linhas de escala (slate-600)
            rulerText: "#94a3b8",     // Texto do timecode (slate-400)
            trackSpeech: "rgba(6, 182, 212, 0.15)", // V1: Ciano translúcido
            trackBroll: "rgba(139, 92, 246, 0.15)",  // V2: Roxo translúcido
            clipSpeechBg: "rgba(6, 182, 212, 0.25)",
            clipSpeechBorder: "rgba(6, 182, 212, 0.7)",
            clipBrollBg: "rgba(139, 92, 246, 0.25)",
            clipBrollBorder: "rgba(139, 92, 246, 0.7)",
            textPrimary: "#f8fafc",
            textSecondary: "#cbd5e1",
            playhead: "#ef4444",      // Vermelho vibrante
            borderGlass: "rgba(255, 255, 255, 0.08)",
            waveform: "rgba(6, 182, 212, 0.4)",      // Ondas em ciano
            ghostGreenBg: "rgba(34, 197, 94, 0.12)", // Sugestões de inserção
            ghostGreenBorder: "rgba(34, 197, 94, 0.6)",
            ghostRedHachure: "rgba(239, 68, 68, 0.25)", // Sugestões de remoção
            ghostRedBorder: "rgba(239, 68, 68, 0.6)"
        };

        this.isDirty = true; // Flag para solicitar redesenho reativo
        this.init();
    }

    setCanvas(canvas) {
        if (!canvas) return;
        
        // Remove listener de resize da janela antiga
        if (this.canvas) {
            const oldWin = this.canvas.ownerDocument.defaultView || window;
            oldWin.removeEventListener("resize", this.boundResize);
        }
        
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        
        // Adiciona o listener na nova janela do canvas
        const newWin = canvas.ownerDocument.defaultView || window;
        newWin.addEventListener("resize", this.boundResize);
        
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

        // Ouvintes de evento do estado para redesenho reativo
        STATE.on("timelineCutsUpdated", () => this.requestRedraw());
        STATE.on("timelineGhostUpdated", () => this.requestRedraw());
        STATE.on("timelineFpsChanged", () => this.requestRedraw());
        STATE.on("timelineZoomChanged", () => this.requestRedraw());
        STATE.on("timelineScrollChanged", () => this.requestRedraw());
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

        // Desenha a grade e a régua de tempo
        this.drawRuler();

        // Desenha os clipes salvos (V1 e V2)
        this.drawClips();

        // Desenha as sugestões fantasma da IA (Ghost Clips)
        this.drawGhostClips();

        // Desenha o cursor do Playhead (currentTime)
        this.drawPlayhead();
    }

    /**
     * Desenha as faixas de fundo e linhas horizontais divisórias.
     */
    drawTracksBackground() {
        const ctx = this.ctx;
        
        // Faixa V2 (Y: 30 a 115)
        ctx.fillStyle = this.colors.trackBroll;
        ctx.fillRect(0, this.rulerHeight, this.width, this.trackHeight);
        
        // Linha divisória horizontal Y: 115
        ctx.strokeStyle = this.colors.borderGlass;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.rulerHeight + this.trackHeight);
        ctx.lineTo(this.width, this.rulerHeight + this.trackHeight);
        ctx.stroke();

        // Faixa V1 (Y: 115 a 200)
        ctx.fillStyle = this.colors.trackSpeech;
        ctx.fillRect(0, this.rulerHeight + this.trackHeight, this.width, this.trackHeight);
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
        // Se o zoom for muito pequeno (ex: 0.05px/frame), desenha ticks a cada 5 segundos ou 10 segundos.
        // Se for grande (ex: 2px/frame), desenha ticks a cada frame ou a cada 5 frames.
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
                // Exibe apenas MM:SS ou MM:SS:FF dependendo do zoom para economizar espaço
                const displayTc = tc.substring(3); // Remove o HH: inicial para visual limpo
                ctx.fillText(displayTc, x + 4, this.rulerHeight - 16);
            }
        }
    }

    /**
     * Renderiza os blocos dos cortes de vídeo/áudio ativos.
     */
    drawClips() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const cuts = STATE.activeTimelineCuts;

        cuts.forEach((cut) => {
            const duration = cut.outFrame - cut.inFrame;
            const startX = (cut.timelineStartFrame - scrollLeft) * zoom;
            const width = duration * zoom;
            
            // Ignora se estiver fora do viewport visível
            if (startX + width < 0 || startX > this.width) return;

            // Determinar Y e cor baseados na trilha
            let y = this.rulerHeight;
            let bg = this.colors.clipBrollBg;
            let border = this.colors.clipBrollBorder;
            
            if (cut.track === "V1") {
                y = this.rulerHeight + this.trackHeight;
                bg = this.colors.clipSpeechBg;
                border = this.colors.clipSpeechBorder;
            }

            // Espaçamento interno vertical do clipe
            const clipY = y + 8;
            const clipHeight = this.trackHeight - 16;

            // Desenhar bloco do clipe
            ctx.fillStyle = bg;
            ctx.fillRect(startX, clipY, width, clipHeight);
            
            ctx.strokeStyle = border;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(startX, clipY, width, clipHeight);

            // Se for trilha V1 (Falas), desenha waveform realista de áudio
            if (cut.track === "V1") {
                this.drawWaveform(cut, startX, clipY, width, clipHeight);
            }

            // Desenhar texto descritivo do clipe (Nome do arquivo)
            const video = STATE.allVideos.find(v => v.id === cut.video_id);
            const name = video ? video.filename : `Vídeo ${cut.video_id}`;
            const label = `# ${name} [${framesToTimecode(cut.inFrame, TIMELINE_STATE.fps).substring(6)} -> ${framesToTimecode(cut.outFrame, TIMELINE_STATE.fps).substring(6)}]`;

            ctx.save();
            ctx.beginPath();
            ctx.rect(startX + 4, clipY, width - 8, clipHeight);
            ctx.clip(); // Limita o desenho do texto ao espaço do clipe

            ctx.fillStyle = this.colors.textPrimary;
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.fillText(label, startX + 8, clipY + 16);
            ctx.restore();
        });
    }

    /**
     * Desenha waveforms de áudio realistas dentro dos clipes de fala.
     */
    drawWaveform(cut, startX, clipY, width, clipHeight) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.colors.waveform;
        ctx.lineWidth = 1.2;

        const centerY = clipY + clipHeight / 2;
        const maxAmplitude = (clipHeight - 20) / 2;

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
     * Desenha as faixas translúcidas de sugestão da IA (Ghost Clips).
     */
    drawGhostClips() {
        const ctx = this.ctx;
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        const ghosts = TIMELINE_STATE.ghostTrack;

        ghosts.forEach((ghost) => {
            const duration = ghost.outFrame - ghost.inFrame;
            const startX = (ghost.timelineStartFrame - scrollLeft) * zoom;
            const width = duration * zoom;

            if (startX + width < 0 || startX > this.width) return;

            let y = this.rulerHeight;
            if (ghost.track === "V1") {
                y = this.rulerHeight + this.trackHeight;
            }

            const clipY = y + 8;
            const clipHeight = this.trackHeight - 16;

            if (ghost.action === "INSERT") {
                // Estilo verde pontilhado translúcido
                ctx.fillStyle = this.colors.ghostGreenBg;
                ctx.fillRect(startX, clipY, width, clipHeight);

                ctx.strokeStyle = this.colors.ghostGreenBorder;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]); // Borda pontilhada
                ctx.strokeRect(startX, clipY, width, clipHeight);
                ctx.setLineDash([]); // Restaura borda sólida

                // Texto descritivo da sugestão
                ctx.fillStyle = "#22c55e";
                ctx.font = "bold 9px Inter, sans-serif";
                ctx.fillText("[IA SUGESTÃO: B-ROLL]", startX + 8, clipY + 16);
            } else if (ghost.action === "DELETE") {
                // Desenha hachurado vermelho sobre o clipe original a ser deletado
                ctx.fillStyle = this.colors.ghostRedHachure;
                ctx.fillRect(startX, clipY, width, clipHeight);

                ctx.strokeStyle = this.colors.ghostRedBorder;
                ctx.lineWidth = 1.5;
                ctx.strokeRect(startX, clipY, width, clipHeight);

                // Desenha linhas diagonais de alerta vermelho
                ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
                ctx.lineWidth = 1;
                ctx.save();
                ctx.beginPath();
                ctx.rect(startX, clipY, width, clipHeight);
                ctx.clip();
                
                for (let offset = -clipHeight; offset < width; offset += 10) {
                    ctx.beginPath();
                    ctx.moveTo(startX + offset, clipY);
                    ctx.lineTo(startX + offset + clipHeight, clipY + clipHeight);
                    ctx.stroke();
                }
                ctx.restore();

                ctx.fillStyle = "#ef4444";
                ctx.font = "bold 9px Inter, sans-serif";
                ctx.fillText("[IA: SUGERE CORTE]", startX + 8, clipY + 16);
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
