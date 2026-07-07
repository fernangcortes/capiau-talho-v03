// Controlador de Interatividade, Cliques e Atalhos da Timeline (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, secondsToFrames, framesToSeconds } from "./timelineState.js";

export class CapiauTimelineInteraction {
    constructor(renderer) {
        this.renderer = renderer;
        this.canvas = renderer.canvas;
        
        // Estado local de interação
        this.dragState = null; // null, "scrub", "drag-clip", "trim-left", "trim-right", "pan"
        this.draggedClipId = null;
        this.dragStartMouseX = 0;
        this.dragStartClipFrame = 0;
        this.dragStartInFrame = 0;
        this.dragStartOutFrame = 0;
        
        // Posição do mouse
        this.mouseX = 0;
        this.mouseY = 0;

        // Guarda referências bound para permitir remoção
        this.boundMouseDown = (e) => this.onMouseDown(e);
        this.boundMouseMove = (e) => this.onMouseMove(e);
        this.boundMouseUp = () => this.onMouseUp();
        this.boundWheel = (e) => this.onWheel(e);
        this.boundMouseLeave = () => this.hideHoverPreview();
        this.boundKeyDown = (e) => this.onKeyDown(e);

        this.init();
    }

    init() {
        if (!this.canvas) return;
        const win = this.canvas.ownerDocument.defaultView || window;

        // Mouse Listeners
        this.canvas.addEventListener("mousedown", this.boundMouseDown);
        this.canvas.addEventListener("mousemove", this.boundMouseMove);
        win.addEventListener("mouseup", this.boundMouseUp);
        this.canvas.addEventListener("wheel", this.boundWheel);
        this.canvas.addEventListener("mouseleave", this.boundMouseLeave);
        
        // Keyboard Listener global
        win.addEventListener("keydown", this.boundKeyDown);
    }

    removeListeners() {
        if (!this.canvas) return;
        const win = this.canvas.ownerDocument.defaultView || window;
        this.canvas.removeEventListener("mousedown", this.boundMouseDown);
        this.canvas.removeEventListener("mousemove", this.boundMouseMove);
        win.removeEventListener("mouseup", this.boundMouseUp);
        this.canvas.removeEventListener("wheel", this.boundWheel);
        this.canvas.removeEventListener("mouseleave", this.boundMouseLeave);
        win.removeEventListener("keydown", this.boundKeyDown);
    }

    setCanvas(canvas) {
        if (!canvas) return;
        this.removeListeners();
        this.canvas = canvas;
        this.init();
    }

    /**
     * Mapeia coordenadas x/y relativas ao canvas para frame e track (dinâmico multipista).
     */
    getCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const frame = Math.round(TIMELINE_STATE.scrollLeftFrame + (x / TIMELINE_STATE.zoom));

        const trackObj = this.renderer.getTrackAtY(y);
        const track = trackObj ? trackObj.id : null;

        return { x, y, frame, track, trackObj };
    }

    /**
     * Encontra qual clipe (comum ou ghost) está sob o mouse.
     */
    findClipAt(frame, track, y = null) {
        if (!track) return null;

        const trackObj = TIMELINE_STATE.getTrack(track);
        const cuts = STATE.activeTimelineCuts;

        // Pista de IA: hit-test somente nos ghost clips (INSERT/REPLACE)
        if (trackObj && trackObj.kind === "ai") {
            const ghost = TIMELINE_STATE.ghostTrack.find(g =>
                g.action !== "DELETE" &&
                frame >= g.timelineStartFrame &&
                frame <= g.timelineStartFrame + Math.max(g.outFrame - g.inFrame, Math.round(20 / TIMELINE_STATE.zoom))
            );
            if (ghost) return { type: "ghost", data: ghost };
            return null;
        }

        // Ghosts de DELETE são desenhados sobre o clipe alvo na pista original
        const deleteGhost = TIMELINE_STATE.ghostTrack.find(g => {
            if (g.action !== "DELETE" || !g.targetClipId) return false;
            const target = cuts.find(c => c.id === g.targetClipId);
            return target && target.track === track &&
                frame >= g.timelineStartFrame &&
                frame <= g.timelineStartFrame + (g.outFrame - g.inFrame);
        });
        if (deleteGhost) return { type: "ghost", data: deleteGhost };

        const clip = cuts.find(c => c.track === track && frame >= c.timelineStartFrame && frame <= c.timelineStartFrame + (c.outFrame - c.inFrame));
        if (clip) return { type: "clip", data: clip };

        return null;
    }

    /**
     * Verifica se o mouse está sobre a borda esquerda ou direita de um clipe para trim.
     */
    checkTrimZone(x, clip) {
        const zoom = TIMELINE_STATE.zoom;
        const scrollLeft = TIMELINE_STATE.scrollLeftFrame;
        
        const startX = (clip.timelineStartFrame - scrollLeft) * zoom;
        const endX = startX + (clip.outFrame - clip.inFrame) * zoom;
        
        const tolerance = 6; // tolerância em pixels nas bordas
        
        if (Math.abs(x - startX) <= tolerance) return "left";
        if (Math.abs(x - endX) <= tolerance) return "right";
        return null;
    }

    onMouseDown(e) {
        window.activeFocusedPlayer = "program";
        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        this.hideHoverPreview();
        
        // 1. Clique na régua de tempo (Scrubbing / Mover Playhead)
        if (y < this.renderer.rulerHeight) {
            this.dragState = "scrub";
            this.updatePlayhead(frame);
            return;
        }

        // 2. Clique com botão do meio (Scroll/Pan) ou Barra de Espaço pressionada
        if (e.button === 1 || (e.button === 0 && e.spaceKey)) {
            this.dragState = "pan";
            this.dragStartMouseX = e.clientX;
            this.dragStartClipFrame = TIMELINE_STATE.scrollLeftFrame;
            this.canvas.style.cursor = "grabbing";
            return;
        }

        // 3. Clique nas trilhas
        if (track) {
            const hit = this.findClipAt(frame, track, y);

            if (hit) {
                if (hit.type === "clip") {
                    const clip = hit.data;
                    const clipTrack = TIMELINE_STATE.getTrack(clip.track);
                    if (clipTrack && clipTrack.locked) {
                        // Pista travada: apenas seleciona, sem permitir arrastes
                        TIMELINE_STATE.selectedClipId = clip.id;
                        TIMELINE_STATE.selectedTrack = track;
                        this.syncPlayerToClip(clip);
                        this.renderer.requestRedraw();
                        return;
                    }
                    TIMELINE_STATE.selectedClipId = clip.id;
                    TIMELINE_STATE.selectedTrack = track;

                    const trimEdge = this.checkTrimZone(x, clip);

                    if (trimEdge === "left") {
                        this.dragState = "trim-left";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartClipFrame = clip.timelineStartFrame;
                        this.dragStartInFrame = clip.inFrame;
                    } else if (trimEdge === "right") {
                        this.dragState = "trim-right";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartOutFrame = clip.outFrame;
                    } else {
                        // Drag normal do clipe
                        this.dragState = "drag-clip";
                        this.draggedClipId = clip.id;
                        this.dragStartMouseX = e.clientX;
                        this.dragStartClipFrame = clip.timelineStartFrame;
                    }
                    
                    // Sincroniza player com o início do clipe
                    this.syncPlayerToClip(clip);
                } else if (hit.type === "ghost") {
                    const ghost = hit.data;
                    TIMELINE_STATE.selectedGhostClipId = ghost.id;
                    TIMELINE_STATE.selectedTrack = "Ghost";
                    
                    // Sincroniza player com o preview da sugestão
                    this.syncPlayerToClip(ghost);
                    
                    // Se clicou na sugestão, mostra opções contextuais (✓ / ✗)
                    this.showGhostActionsPopup(e.clientX, e.clientY, ghost);
                }
            } else {
                // Deselecionar
                TIMELINE_STATE.selectedClipId = null;
                TIMELINE_STATE.selectedGhostClipId = null;
            }
            this.renderer.requestRedraw();
        }
    }

    onMouseMove(e) {
        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        this.mouseX = x;
        this.mouseY = y;

        // Atualiza cursores dinâmicos de trim
        if (!this.dragState && track) {
            const hit = this.findClipAt(frame, track);
            if (hit && hit.type === "clip") {
                const edge = this.checkTrimZone(x, hit.data);
                this.canvas.style.cursor = edge ? "w-resize" : "grab";
            } else {
                this.canvas.style.cursor = "default";
            }
        }

        if (!this.dragState) {
            this.updateHoverPreview(e.clientX, e.clientY, frame, track);
            return;
        }

        // Processar arrastes baseados no estado
        if (this.dragState === "scrub") {
            this.updatePlayhead(frame);
        } 
        else if (this.dragState === "pan") {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = dx / TIMELINE_STATE.zoom;
            TIMELINE_STATE.setScrollLeftFrame(this.dragStartClipFrame - deltaFrames);
        }
        else if (this.dragState === "drag-clip" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            const targetStart = Math.max(0, this.dragStartClipFrame + deltaFrames);

            // Trilha de destino: qualquer pista de vídeo não travada sob o mouse
            let targetTrack = null;
            const trackObj = track ? TIMELINE_STATE.getTrack(track) : null;
            if (trackObj && trackObj.kind === "video" && !trackObj.locked) {
                targetTrack = track;
            }
            this.moveClip(this.draggedClipId, targetStart, targetTrack);
        }
        else if (this.dragState === "trim-left" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            
            this.trimClipLeft(this.draggedClipId, deltaFrames);
        }
        else if (this.dragState === "trim-right" && this.draggedClipId) {
            const dx = e.clientX - this.dragStartMouseX;
            const deltaFrames = Math.round(dx / TIMELINE_STATE.zoom);
            
            this.trimClipRight(this.draggedClipId, deltaFrames);
        }
    }

    onMouseUp() {
        this.dragState = null;
        this.draggedClipId = null;
        if (this.canvas) this.canvas.style.cursor = "default";
    }

    onWheel(e) {
        e.preventDefault();

        if (e.ctrlKey) {
            // Zoom horizontal centralizado no mouse
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;

            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

            const oldZoom = TIMELINE_STATE.zoom;
            const newZoom = Math.max(0.01, Math.min(5.0, oldZoom * zoomFactor));

            const mouseFrame = TIMELINE_STATE.scrollLeftFrame + (mouseX / oldZoom);
            const newScrollLeft = mouseFrame - (mouseX / newZoom);

            TIMELINE_STATE.setZoom(newZoom);
            TIMELINE_STATE.setScrollLeftFrame(newScrollLeft);
        } else if (e.shiftKey) {
            // Shift + roda = scroll horizontal
            const deltaFrames = (e.deltaY || e.deltaX) / TIMELINE_STATE.zoom;
            TIMELINE_STATE.setScrollLeftFrame(TIMELINE_STATE.scrollLeftFrame + deltaFrames);
        } else {
            // Roda simples: scroll vertical das pistas quando excedem a área visível
            const viewportH = (this.renderer.height || 200) - this.renderer.rulerHeight;
            const overflow = TIMELINE_STATE.totalTracksHeight() > viewportH;
            if (overflow && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                TIMELINE_STATE.setScrollTop(TIMELINE_STATE.scrollTop + e.deltaY * 0.5, viewportH);
            } else {
                const deltaFrames = (e.deltaX || e.deltaY) / TIMELINE_STATE.zoom;
                TIMELINE_STATE.setScrollLeftFrame(TIMELINE_STATE.scrollLeftFrame + deltaFrames);
            }
        }
    }

    onKeyDown(e) {
        // Ignora atalhos se o usuário estiver digitando em campos de formulário
        if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
            return;
        }

        const selectedId = TIMELINE_STATE.selectedClipId;
        const cuts = [...STATE.activeTimelineCuts];

        if (e.key === "Delete" || e.key === "Backspace") {
            if (selectedId) {
                const idx = cuts.findIndex(c => c.id === selectedId);
                if (idx !== -1) {
                    cuts.splice(idx, 1);
                    STATE.activeTimelineCuts = cuts;
                    TIMELINE_STATE.selectedClipId = null;
                    e.preventDefault();
                }
            } else if (TIMELINE_STATE.selectedGhostClipId) {
                // Rejeitar sugestão fantasma
                TIMELINE_STATE.rejectGhostSuggestion(TIMELINE_STATE.selectedGhostClipId);
                TIMELINE_STATE.selectedGhostClipId = null;
                e.preventDefault();
            }
        }
        else if (e.key === "Enter" || e.key.toLowerCase() === "y") {
            if (TIMELINE_STATE.selectedGhostClipId) {
                // Aceitar sugestão fantasma
                TIMELINE_STATE.acceptGhostSuggestion(TIMELINE_STATE.selectedGhostClipId);
                TIMELINE_STATE.selectedGhostClipId = null;
                e.preventDefault();
            }
        }
        else if (e.key === "ArrowLeft") {
            this.nudgeSelection(selectedId, -1); // 1 frame para trás
            e.preventDefault();
        }
        else if (e.key === "ArrowRight") {
            this.nudgeSelection(selectedId, 1);  // 1 frame para frente
            e.preventDefault();
        }
        else if (e.key === "[") {
            if (selectedId) this.nudgeTrim(selectedId, "left", -1);
            e.preventDefault();
        }
        else if (e.key === "]") {
            if (selectedId) this.nudgeTrim(selectedId, "right", 1);
            e.preventDefault();
        }
    }

    // --- MÉTODOS AUXILIARES DE EDICAO ---

    updatePlayhead(frame) {
        TIMELINE_STATE.setPlayheadFrame(frame);
    }

    syncPlayerToClip(clip) {
        const video = STATE.allVideos.find(v => v.id === clip.video_id);
        if (video) {
            STATE.activeVideo = video;
            const player = document.getElementById("source-video");
            if (player) {
                player.currentTime = clip.in;
            }
        }
    }

    /**
     * Insere um clipe magneticamente na sequência da pista alvo (ordenado pelo centro do drop).
     */
    _insertMagnetic(cuts, clip, trackId, targetStartFrame) {
        const duration = clip.outFrame - clip.inFrame;
        const targetCenter = targetStartFrame + duration / 2;

        const idx = cuts.findIndex(c => c.id === clip.id);
        if (idx !== -1) cuts.splice(idx, 1);

        const trackCuts = cuts.filter(c => c.track === trackId);
        const otherCuts = cuts.filter(c => c.track !== trackId);

        let inserted = false;
        let currentOffset = 0;
        for (let i = 0; i < trackCuts.length; i++) {
            const c = trackCuts[i];
            const cDur = c.outFrame - c.inFrame;
            if (targetCenter < currentOffset + cDur / 2) {
                trackCuts.splice(i, 0, clip);
                inserted = true;
                break;
            }
            currentOffset += cDur;
        }
        if (!inserted) {
            trackCuts.push(clip);
        }
        STATE.activeTimelineCuts = [...trackCuts, ...otherCuts];
    }

    moveClip(clipId, targetStartFrame, targetTrack) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        // Trilha final do clipe (a atual, ou a nova sob o mouse)
        const finalTrackId = (targetTrack && targetTrack !== clip.track) ? targetTrack : clip.track;
        const finalTrack = TIMELINE_STATE.getTrack(finalTrackId);
        if (finalTrack && (finalTrack.locked || finalTrack.kind !== "video")) return;

        if (targetTrack && targetTrack !== clip.track) {
            console.log(`[Timeline] Transpondo clipe ${clipId} de ${clip.track} para ${targetTrack}`);
            clip.track = targetTrack;
        }

        const isMagnetic = finalTrack ? !!finalTrack.magnetic : (finalTrackId === "V1");

        if (isMagnetic) {
            // Pista magnética: reordena a sequência (ripple)
            this._insertMagnetic(cuts, clip, finalTrackId, targetStartFrame);
        } else {
            // Pista livre: posicionamento absoluto
            clip.timelineStartFrame = targetStartFrame;
            STATE.activeTimelineCuts = cuts;
        }
    }

    trimClipLeft(clipId, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const maxStart = clip.outFrame - 12; // Mínimo de 12 frames de duração
        const targetIn = Math.min(maxStart, Math.max(0, this.dragStartInFrame + deltaFrames));

        clip.inFrame = targetIn;
        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline
        clip.in = targetIn / fps;

        const trackObj = TIMELINE_STATE.getTrack(clip.track);
        if (!trackObj || !trackObj.magnetic) {
            // Pista livre: desloca o início na timeline proporcionalmente
            const targetStart = Math.max(0, this.dragStartClipFrame + deltaFrames);
            clip.timelineStartFrame = targetStart;
        }

        STATE.activeTimelineCuts = cuts;
    }

    trimClipRight(clipId, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const minOut = clip.inFrame + 12; // Mínimo de 12 frames
        const targetOut = Math.max(minOut, this.dragStartOutFrame + deltaFrames);

        clip.outFrame = targetOut;
        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline
        clip.out = targetOut / fps;

        STATE.activeTimelineCuts = cuts;
    }

    nudgeSelection(clipId, deltaFrames) {
        if (!clipId) return;
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const trackObj = TIMELINE_STATE.getTrack(clip.track);
        if (trackObj && trackObj.locked) return;

        if (trackObj ? trackObj.magnetic : clip.track === "V1") {
            // Pista magnética: reordena na sequência (move posições na array)
            const idx = cuts.findIndex(c => c.id === clipId);
            const targetIdx = idx + deltaFrames;
            if (targetIdx >= 0 && targetIdx < cuts.length) {
                // Swap
                cuts[idx] = cuts[targetIdx];
                cuts[targetIdx] = clip;
                STATE.activeTimelineCuts = cuts;
            }
        } else {
            // Pista livre desloca de fato no tempo
            clip.timelineStartFrame = Math.max(0, clip.timelineStartFrame + deltaFrames);
            STATE.activeTimelineCuts = cuts;
        }
    }

    nudgeTrim(clipId, edge, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline

        if (edge === "left") {
            clip.inFrame = Math.max(0, clip.inFrame + deltaFrames);
            clip.in = clip.inFrame / fps;
            const trackObj = TIMELINE_STATE.getTrack(clip.track);
            if (!trackObj || !trackObj.magnetic) {
                clip.timelineStartFrame = Math.max(0, clip.timelineStartFrame + deltaFrames);
            }
        } else {
            clip.outFrame = Math.max(clip.inFrame + 12, clip.outFrame + deltaFrames);
            clip.out = clip.outFrame / fps;
        }
        STATE.activeTimelineCuts = cuts;
    }

    // --- POPUPS E INTERACTION IA CONTEXTUAL ---

    showGhostActionsPopup(clientX, clientY, ghost) {
        // Criar ou reusar pop-up de aprovação contextual
        let popup = document.getElementById("ghost-action-popup");
        if (!popup) {
            popup = document.createElement("div");
            popup.id = "ghost-action-popup";
            popup.style.cssText = `
                position: fixed;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid var(--border-glass);
                border-radius: 8px;
                padding: 10px 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                z-index: 9999;
                font-family: sans-serif;
                min-width: 220px;
                backdrop-filter: blur(8px);
            `;
            document.body.appendChild(popup);
        }

        popup.innerHTML = `
            <div style="font-size: 11px; color: var(--color-cyan); font-weight: bold; margin-bottom: 2px;">SUGESTÃO DE CORTE IA</div>
            <div style="font-size: 12px; color: #fff; line-height: 1.4; margin-bottom: 6px;">"${ghost.reason}"</div>
            <div style="display: flex; gap: 8px;">
                <button id="btn-popup-accept" class="btn-primary" style="flex: 1; height: 26px; font-size: 11px; font-weight: bold; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 4px;">
                    <i class="fa-solid fa-check"></i> Aceitar (Y)
                </button>
                <button id="btn-popup-reject" class="btn-secondary" style="flex: 1; height: 26px; font-size: 11px; font-weight: bold; padding: 0 10px; display: flex; align-items: center; justify-content: center; gap: 4px; border-radius: 4px; border-color: rgba(239, 68, 68, 0.3); color: #ef4444; background: rgba(239, 68, 68, 0.08);">
                    <i class="fa-solid fa-xmark"></i> Rejeitar (N)
                </button>
            </div>
        `;

        popup.style.left = `${clientX}px`;
        popup.style.top = `${clientY - 110}px`;
        popup.style.display = "flex";

        // Listeners dos botões
        popup.querySelector("#btn-popup-accept").onclick = () => {
            TIMELINE_STATE.acceptGhostSuggestion(ghost.id);
            popup.style.display = "none";
        };
        popup.querySelector("#btn-popup-reject").onclick = () => {
            TIMELINE_STATE.rejectGhostSuggestion(ghost.id);
            popup.style.display = "none";
        };

        // Fecha popup se clicar fora
        const closeHandler = (event) => {
            if (!popup.contains(event.target) && event.target.id !== this.canvas.id) {
                popup.style.display = "none";
                document.removeEventListener("mousedown", closeHandler);
            }
        };
        setTimeout(() => document.addEventListener("mousedown", closeHandler), 10);
    }

    /**
     * Atualiza a exibição do popup flutuante de preview com o vídeo proxy correspondente.
     */
    updateHoverPreview(clientX, clientY, frame, track) {
        const previewCard = document.getElementById("timeline-preview-card");
        if (!previewCard) return;

        // Se estiver arrastando ou fazendo scrub, ou fora das trilhas, esconde
        if (this.dragState || !track) {
            previewCard.style.display = "none";
            return;
        }

        const hit = this.findClipAt(frame, track);
        if (hit) {
            const clip = hit.data;
            const video = STATE.allVideos.find(v => v.id === clip.video_id);
            if (video) {
                const videoSrc = video.proxy_path || video.filepath || `/originals/${video.filename}`;
                const videoEl = previewCard.querySelector("video");
                const infoEl = previewCard.querySelector(".preview-info");
                
                // Formata o fragmento de tempo em segundos (in, out) para tocar a região precisa
                const inSeconds = clip.in;
                const outSeconds = clip.out;
                const targetSrc = `${videoSrc}#t=${inSeconds.toFixed(1)},${outSeconds.toFixed(1)}`;
                
                // Evita recarregar a mesma URL repetidamente se já estiver tocando
                const fullTargetSrc = window.location.origin + targetSrc;
                if (videoEl.src !== fullTargetSrc && !videoEl.src.endsWith(targetSrc)) {
                    videoEl.src = targetSrc;
                    videoEl.load();
                    videoEl.play().catch(() => {});
                }

                // Exibe o nome do vídeo e duração do trecho
                const duration = outSeconds - inSeconds;
                infoEl.textContent = `${video.filename} (${duration.toFixed(1)}s)`;

                // Posiciona o card acima e ligeiramente à direita do cursor do mouse
                previewCard.style.left = `${clientX + 15}px`;
                previewCard.style.top = `${clientY - 160}px`;
                previewCard.style.display = "flex";
                return;
            }
        }

        // Se não houver clipe sob o cursor, esconde
        previewCard.style.display = "none";
    }

    /**
     * Esconde o card de preview.
     */
    hideHoverPreview() {
        const previewCard = document.getElementById("timeline-preview-card");
        if (previewCard) {
            previewCard.style.display = "none";
            const videoEl = previewCard.querySelector("video");
            if (videoEl) {
                videoEl.pause();
                videoEl.src = "";
            }
        }
    }
}
