// Controlador de Interatividade, Cliques e Atalhos da Timeline (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, secondsToFrames, framesToSeconds } from "./timelineState.js";
import { setTabVisibility } from "./tabsCustomization.js";

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
        this.boundMouseUp = (e) => this.onMouseUp(e);
        this.boundWheel = (e) => this.onWheel(e);
        this.boundMouseLeave = () => this.hideHoverPreview();
        this.boundKeyDown = (e) => this.onKeyDown(e);
        this.boundDragOver = (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
        this.boundDrop = (e) => this.onDrop(e);

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

        // Arrastar-e-soltar de mídias da biblioteca para a timeline
        this.canvas.addEventListener("dragover", this.boundDragOver);
        this.canvas.addEventListener("drop", this.boundDrop);

        // Keyboard Listener global
        win.addEventListener("keydown", this.boundKeyDown);

        // Ouvir mudança de abas no painel esquerdo para atualizar ajustes
        STATE.on("leftTabChanged", (tabId) => {
            if (tabId === "tab-adjustments") {
                this.refreshClipInspector();
            }
        });

        // Ouvir restauração do histórico (undo/redo) para sincronizar o painel
        STATE.on("timelineRestored", () => {
            this.refreshClipInspector();
            if (this.renderer) {
                this.renderer.requestRedraw();
            }
        });
    }

    removeListeners() {
        if (!this.canvas) return;
        const win = this.canvas.ownerDocument.defaultView || window;
        this.canvas.removeEventListener("mousedown", this.boundMouseDown);
        this.canvas.removeEventListener("mousemove", this.boundMouseMove);
        win.removeEventListener("mouseup", this.boundMouseUp);
        this.canvas.removeEventListener("wheel", this.boundWheel);
        this.canvas.removeEventListener("mouseleave", this.boundMouseLeave);
        this.canvas.removeEventListener("dragover", this.boundDragOver);
        this.canvas.removeEventListener("drop", this.boundDrop);
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
        this.mouseDownX = e.clientX;
        this.mouseDownY = e.clientY;

        // Se o source estiver maximizado, mostra o program ao interagir com a timeline
        const sourcePanel = document.getElementById("source-player-panel");
        if (sourcePanel && sourcePanel.classList.contains("maximized")) {
            const btnExpandSource = document.getElementById("btn-expand-source");
            if (btnExpandSource) btnExpandSource.click();
            const programPanel = document.getElementById("program-player-panel");
            if (programPanel && !programPanel.classList.contains("maximized")) {
                const btnExpandProgram = document.getElementById("btn-expand-program");
                if (btnExpandProgram) btnExpandProgram.click();
            }
        }
        
        const { x, y, frame, track } = this.getCoordinates(e.clientX, e.clientY);
        this.hideHoverPreview();
        
        if (track) {
            const hit = this.findClipAt(frame, track, y);
            this.mouseDownClip = hit && hit.type === "clip" ? hit.data : null;
        } else {
            this.mouseDownClip = null;
        }
        
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
                        this.refreshClipInspector();
                        this.renderer.requestRedraw();
                        return;
                    }
                    TIMELINE_STATE.selectedClipId = clip.id;
                    TIMELINE_STATE.selectedTrack = track;

                    // Abre a transação de histórico: o drag/trim vira 1 passo de undo
                    TIMELINE_HISTORY.begin();

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
            this.refreshClipInspector();
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

            // Trilha de destino: qualquer pista não travada sob o mouse
            // (moveClip garante que o tipo da pista combina com o do clipe)
            let targetTrack = null;
            const trackObj = track ? TIMELINE_STATE.getTrack(track) : null;
            if (trackObj && trackObj.kind !== "ai" && !trackObj.locked) {
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

    onMouseUp(e) {
        // Fecha a transação do drag/trim (no-op se nada mudou)
        TIMELINE_HISTORY.commit();
        this.dragState = null;
        this.draggedClipId = null;
        this.mouseDownClip = null;
        if (this.canvas) this.canvas.style.cursor = "default";
    }

    /**
     * Soltura de mídia da biblioteca na timeline (foto ou vídeo).
     * A posição/pista vêm da coordenada do drop; pista de destino precisa ser de vídeo.
     */
    onDrop(e) {
        e.preventDefault();
        let payload = null;
        try {
            const raw = e.dataTransfer.getData("application/x-capiau-media");
            if (raw) payload = JSON.parse(raw);
        } catch (_) { payload = null; }
        if (!payload || payload.id === undefined || payload.id === null) return;

        const { frame, track } = this.getCoordinates(e.clientX, e.clientY);
        const trackObj = track ? TIMELINE_STATE.getTrack(track) : null;
        const targetTrack = (trackObj && trackObj.kind === "video" && !trackObj.locked) ? track : null;
        const dropFrame = Math.max(0, frame);

        if (payload.type === "photo") {
            TIMELINE_STATE.addPhotoCut(payload.id, { track: targetTrack, timelineStartFrame: dropFrame });
        } else {
            const video = STATE.allVideos.find(v => v.id === payload.id);
            const dur = (video && video.duration) ? video.duration : 5.0;
            TIMELINE_STATE.addCut(payload.id, 0, dur, targetTrack, dropFrame);
        }
    }

    // ── INSPETOR E AJUSTES DE CLIPE DE TIMELINE ──

    /** Mostra os ajustes se houver um clipe selecionado; senão limpa. */
    refreshClipInspector() {
        const clip = STATE.activeTimelineCuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        if (clip) {
            this.showClipInspector(clip);
        } else {
            this.renderAdjustmentsPanel(null);
        }
        STATE.emit("timelineSelectionChanged", TIMELINE_STATE.selectedClipId);
    }

    showClipInspector(clip) {
        // Renderiza o painel de ajustes na aba correspondente
        this.renderAdjustmentsPanel(clip);

        // Abre automaticamente a aba de ajustes no menu esquerdo
        const tabBtn = this.canvas.ownerDocument.querySelector('.sidebar-left .tab-btn[data-tab="tab-adjustments"]');
        if (tabBtn) {
            if (tabBtn.style.display === "none") {
                setTabVisibility("tab-adjustments", true);
            }
            if (!tabBtn.classList.contains("active")) {
                tabBtn.click();
            }
        }
    }

    _mutateClipEffects(clipId, fn) {
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const clip = cuts.find(c => c.id === clipId);
            if (!clip) return;
            clip.effects = clip.effects ? clip.effects.map(e => ({ ...e })) : [];
            fn(clip);
            STATE.activeTimelineCuts = cuts; // dispara recomposição do Program + redraw
        });
        const selected = STATE.activeTimelineCuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        if (selected) {
            this.showClipInspector(selected);
        } else {
            const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
            if (clip) this.showClipInspector(clip);
        }
    }

    setClipFit(clipId, mode) {
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "fit");
            clip.effects.push({ type: "fit", mode });
        });
    }

    setClipKenBurns(clipId, preset) {
        const presets = {
            none: null,
            zoomIn: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.25, x: 0, y: 0 } },
            zoomOut: { from: { scale: 1.25, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 } },
            panRight: { from: { scale: 1.18, x: 6, y: 0 }, to: { scale: 1.18, x: -6, y: 0 } },
            panLeft: { from: { scale: 1.18, x: -6, y: 0 }, to: { scale: 1.18, x: 6, y: 0 } }
        };
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "ken_burns");
            const cfg = presets[preset];
            if (cfg) clip.effects.push({ type: "ken_burns", preset, easing: "easeInOut", ...cfg });
        });
    }

    setClipTransform(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let tf = clip.effects.find(e => e.type === "transform");
            if (!tf) {
                tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                clip.effects.push(tf);
            }
            tf[key] = value;
        });
    }

    setClipColor(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let col = clip.effects.find(e => e.type === "color");
            if (!col) {
                col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                clip.effects.push(col);
            }
            col[key] = value;
        });
    }

    setClipCrop(clipId, key, value) {
        this._mutateClipEffects(clipId, (clip) => {
            let crop = clip.effects.find(e => e.type === "crop");
            if (!crop) {
                crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                clip.effects.push(crop);
            }
            crop[key] = value;
        });
    }

    setClipVolume(clipId, level) {
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "volume");
            clip.effects.push({ type: "volume", level });
        });
    }

    setClipFade(clipId, side, dur) {
        this._mutateClipEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => !(e.type === "crossfade" && e.side === side));
            if (dur > 0) clip.effects.push({ type: "crossfade", side, duration_s: dur });
        });
    }

    renderAdjustmentsPanel(clip) {
        const container = this.canvas.ownerDocument.getElementById("adjustments-panel-content");
        if (!container) return;

        if (!clip) {
            const currentRes = `${TIMELINE_STATE.width}x${TIMELINE_STATE.height}`;
            const presetVal = ["1920x1080", "1080x1920", "3840x2160", "1080x1080"].includes(currentRes) ? currentRes : "custom";

            const gcd = (a, b) => b ? gcd(b, a % b) : a;
            const getAspectRatioText = (w, h) => {
                if (!w || !h) return "Desconhecido";
                const divisor = gcd(w, h);
                const rw = w / divisor;
                const rh = h / divisor;
                if (rw === 16 && rh === 9) return "16:9 (Widescreen)";
                if (rw === 9 && rh === 16) return "9:16 (Vertical)";
                if (rw === 4 && rh === 3) return "4:3 (Clássico)";
                if (rw === 1 && rh === 1) return "1:1 (Quadrado)";
                if (rw === 21 && rh === 9) return "21:9 (Ultrawide)";
                return `${rw}:${rh}`;
            };

            const html = `
                <div class="adjustments-section" style="padding: 16px;">
                    <div style="font-size:11px; font-weight:bold; color:var(--color-cyan); display:flex; gap: 6px; align-items:center; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px; margin-bottom: 12px;">
                        <i class="fa-solid fa-gear"></i>
                        <span>Configurações da Sequência</span>
                    </div>

                    <!-- Preset Selection -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Formato</label>
                        <div class="control-wrap" style="flex:1;">
                            <select id="seq-preset" class="nle-select" style="width:100%; height:24px; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 4px;">
                                <option value="1920x1080">Horizontal (1920×1080 - 16:9)</option>
                                <option value="1080x1920">Vertical (1080×1920 - 9:16)</option>
                                <option value="3840x2160">Ultra HD (3840×2160 - 4K)</option>
                                <option value="1080x1080">Quadrado (1080×1080 - 1:1)</option>
                                <option value="custom">Personalizado</option>
                            </select>
                        </div>
                    </div>

                    <!-- Dimensions -->
                    <div class="adjustments-row" id="seq-dims-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Resolução</label>
                        <div class="control-wrap" style="flex:1; display:flex; gap:6px; align-items:center;">
                            <input id="seq-width" type="number" class="nle-input" style="width:65px; height:24px; text-align:center; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px;" min="2" step="2" value="${TIMELINE_STATE.width}">
                            <span style="color:var(--text-muted); font-size:10px;">×</span>
                            <input id="seq-height" type="number" class="nle-input" style="width:65px; height:24px; text-align:center; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px;" min="2" step="2" value="${TIMELINE_STATE.height}">
                        </div>
                    </div>

                    <!-- Aspect Ratio display -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Proporção</label>
                        <div class="control-wrap" style="flex:1;">
                            <span id="seq-aspect-ratio" style="color:var(--text-secondary); font-size:11px; font-weight:bold;">${getAspectRatioText(TIMELINE_STATE.width, TIMELINE_STATE.height)}</span>
                        </div>
                    </div>

                    <!-- FPS Selection -->
                    <div class="adjustments-row" style="margin-bottom: 12px;">
                        <label style="font-size:10px; text-transform:uppercase; color:var(--text-muted); width: 80px;">Taxa (FPS)</label>
                        <div class="control-wrap" style="flex:1;">
                            <select id="seq-fps" class="nle-select" style="width:100%; height:24px; font-size:11px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; border-radius:4px; padding:0 4px;">
                                <option value="23.976">23.976 fps</option>
                                <option value="24">24 fps</option>
                                <option value="25">25 fps</option>
                                <option value="29.97">29.97 fps</option>
                                <option value="30">30 fps</option>
                                <option value="50">50 fps</option>
                                <option value="60">60 fps</option>
                            </select>
                        </div>
                    </div>

                    <!-- Warning message when clips exist -->
                    ${STATE.activeTimelineCuts.length > 0 ? `
                        <div id="seq-warning" style="margin-top:16px; padding:10px; border-radius:6px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.25); color:#facc15; font-size:10px; line-height:1.4; display:flex; gap:6px;">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size:12px; margin-top:2px;"></i>
                            <span><strong>Aviso:</strong> A timeline possui clipes. Alterar o FPS irá reescalar os frames físicos para manter a sincronia em segundos.</span>
                        </div>
                    ` : ''}
                </div>
            `;

            container.innerHTML = html;

            const presetSelect = container.querySelector("#seq-preset");
            if (presetSelect) presetSelect.value = presetVal;

            const fpsSelect = container.querySelector("#seq-fps");
            if (fpsSelect) {
                const exists = Array.from(fpsSelect.options).some(opt => parseFloat(opt.value) === TIMELINE_STATE.fps);
                if (!exists) {
                    const opt = this.canvas.ownerDocument.createElement("option");
                    opt.value = TIMELINE_STATE.fps;
                    opt.textContent = `${TIMELINE_STATE.fps} fps`;
                    fpsSelect.appendChild(opt);
                }
                fpsSelect.value = TIMELINE_STATE.fps;
            }

            const widthInput = container.querySelector("#seq-width");
            const heightInput = container.querySelector("#seq-height");

            const updateDimInputsState = () => {
                if (presetSelect.value === "custom") {
                    widthInput.removeAttribute("disabled");
                    heightInput.removeAttribute("disabled");
                    widthInput.style.opacity = "1";
                    heightInput.style.opacity = "1";
                } else {
                    widthInput.setAttribute("disabled", "true");
                    heightInput.setAttribute("disabled", "true");
                    widthInput.style.opacity = "0.5";
                    heightInput.style.opacity = "0.5";
                    const [w, h] = presetSelect.value.split("x").map(Number);
                    widthInput.value = w;
                    heightInput.value = h;
                }
            };
            
            updateDimInputsState();

            const applySettings = () => {
                let wVal = parseInt(widthInput.value) || 1920;
                let hVal = parseInt(heightInput.value) || 1080;
                
                const w = wVal % 2 === 0 ? wVal : wVal + 1;
                const h = hVal % 2 === 0 ? hVal : hVal + 1;
                
                if (w !== wVal) widthInput.value = w;
                if (h !== hVal) heightInput.value = h;

                const fps = parseFloat(fpsSelect.value) || 24;

                TIMELINE_STATE.setTimelineProperties({ width: w, height: h, fps });

                const aspectSpan = container.querySelector("#seq-aspect-ratio");
                if (aspectSpan) aspectSpan.textContent = getAspectRatioText(w, h);
            };

            presetSelect.onchange = () => {
                updateDimInputsState();
                applySettings();
            };

            widthInput.onchange = applySettings;
            heightInput.onchange = applySettings;
            fpsSelect.onchange = applySettings;

            return;
        }

        const effects = clip.effects || [];
        const isPhoto = clip.type === "photo";
        const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
        let partnerAudioClip = null;
        if (!isAudioTrack && clip.type === "video" && clip.link_id) {
            partnerAudioClip = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
        }
        
        let filename = "Clipe de Áudio";
        if (isPhoto) {
            const photoData = STATE.allPhotos.find(p => String(p.id) === String(clip.photo_id));
            filename = photoData ? photoData.filename : "Foto";
        } else {
            const videoData = STATE.allVideos.find(v => String(v.id) === String(clip.video_id));
            if (isAudioTrack) {
                filename = videoData ? `${videoData.filename} (Áudio)` : "Áudio";
            } else {
                filename = videoData ? videoData.filename : "Vídeo";
            }
        }

        // Obter valores de efeito
        const fit = effects.find(e => e.type === "fit");
        const fitMode = fit ? fit.mode : "fill";

        const kb = effects.find(e => e.type === "ken_burns");
        const kbPreset = kb ? (kb.preset || "none") : "none";

        const tf = effects.find(e => e.type === "transform") || {};
        const scale = tf.scale !== undefined ? tf.scale : 1.0;
        const x = tf.x !== undefined ? tf.x : 0;
        const y = tf.y !== undefined ? tf.y : 0;
        const rotation = tf.rotation !== undefined ? tf.rotation : 0;
        const opacity = tf.opacity !== undefined ? tf.opacity : 1.0;

        const col = effects.find(e => e.type === "color") || {};
        const brightness = col.brightness !== undefined ? col.brightness : 0;
        const contrast = col.contrast !== undefined ? col.contrast : 0;
        const saturation = col.saturation !== undefined ? col.saturation : 100;
        const hue = col.hue !== undefined ? col.hue : 0;
        const sepia = col.sepia !== undefined ? col.sepia : 0;
        const grayscale = col.grayscale !== undefined ? col.grayscale : 0;
        const blur = col.blur !== undefined ? col.blur : 0;

        const cropEffect = effects.find(e => e.type === "crop") || {};
        const cropTop = cropEffect.top !== undefined ? cropEffect.top : 0;
        const cropRight = cropEffect.right !== undefined ? cropEffect.right : 0;
        const cropBottom = cropEffect.bottom !== undefined ? cropEffect.bottom : 0;
        const cropLeft = cropEffect.left !== undefined ? cropEffect.left : 0;

        let level = 1.0;
        if (isAudioTrack) {
            const vol = effects.find(e => e.type === "volume") || {};
            level = vol.level !== undefined ? vol.level : 1.0;
        } else if (partnerAudioClip) {
            const partnerEffects = partnerAudioClip.effects || [];
            const vol = partnerEffects.find(e => e.type === "volume") || {};
            level = vol.level !== undefined ? vol.level : 1.0;
        }

        const fadeIn = effects.find(e => e.type === "crossfade" && e.side === "in");
        const fadeOut = effects.find(e => e.type === "crossfade" && e.side === "out");
        const fadeInDur = fadeIn ? fadeIn.duration_s : 0;
        const fadeOutDur = fadeOut ? fadeOut.duration_s : 0;

        // Renderizar seções
        let html = `
            <div style="font-size:11px; font-weight:bold; color:var(--color-cyan); display:flex; gap: 6px; align-items:center; border-bottom: 1px solid var(--border-glass); padding-bottom: 8px; margin-bottom: 4px;">
                <i class="fa-solid fa-sliders"></i>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${filename}</span>
                <span style="font-size:8.5px; padding:2px 6px; border-radius:4px; font-weight:bold; background:rgba(6,182,212,0.1); color:var(--color-cyan); text-transform:uppercase; letter-spacing:0.5px;">${clip.track}</span>
            </div>
        `;

        if (!isAudioTrack) {
            // ── SEÇÃO: ENQUADRAMENTO ──
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title"><i class="fa-solid fa-crop"></i> Enquadramento</div>
                    <div style="display:flex; gap:6px;">
                        <button class="nle-select-btn ${fitMode === 'fill' ? 'active' : ''}" data-action="fit:fill" style="flex:1; padding:4px 6px; font-size:10px; border-radius:4px; border:1px solid ${fitMode === 'fill' ? 'var(--color-cyan)' : 'rgba(255,255,255,0.15)'}; background:${fitMode === 'fill' ? 'rgba(6,182,212,0.2)' : 'transparent'}; color:#fff; cursor:pointer;">Preencher</button>
                        <button class="nle-select-btn ${fitMode === 'fit' ? 'active' : ''}" data-action="fit:fit" style="flex:1; padding:4px 6px; font-size:10px; border-radius:4px; border:1px solid ${fitMode === 'fit' ? 'var(--color-cyan)' : 'rgba(255,255,255,0.15)'}; background:${fitMode === 'fit' ? 'rgba(6,182,212,0.2)' : 'transparent'}; color:#fff; cursor:pointer;">Ajustar</button>
                    </div>
                </div>
            `;

            // ── SEÇÃO: MOVIMENTO (KEN BURNS) ──
            if (isPhoto) {
                html += `
                    <div class="adjustments-section">
                        <div class="adjustments-section-title"><i class="fa-solid fa-circle-nodes"></i> Movimento (Ken Burns)</div>
                        <div class="adjustments-row" style="margin-bottom:0;">
                            <select id="adj-kb-preset" class="nle-select" style="width:100%;">
                                <option value="none" ${kbPreset === 'none' ? 'selected' : ''}>Nenhum</option>
                                <option value="zoomIn" ${kbPreset === 'zoomIn' ? 'selected' : ''}>Zoom In</option>
                                <option value="zoomOut" ${kbPreset === 'zoomOut' ? 'selected' : ''}>Zoom Out</option>
                                <option value="panRight" ${kbPreset === 'panRight' ? 'selected' : ''}>Pan Direita →</option>
                                <option value="panLeft" ${kbPreset === 'panLeft' ? 'selected' : ''}>Pan Esquerda ←</option>
                            </select>
                        </div>
                    </div>
                `;
            }

            // ── SEÇÃO: GEOMETRIA ──
            const tfDisabled = tf.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-arrows-up-down-left-right"></i> Transformações
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="transform" title="${tfDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${tfDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${tfDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="transform" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${tfDisabled ? 0.4 : 1}; pointer-events:${tfDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Posição X</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="x" min="-100" max="100" value="${x}">
                                <span class="value-disp">${x}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Posição Y</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="y" min="-100" max="100" value="${y}">
                                <span class="value-disp">${y}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Escala</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="scale" min="50" max="300" value="${Math.round(scale * 100)}">
                                <span class="value-disp">${Math.round(scale * 100)}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Rotação</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="rotation" min="-180" max="180" value="${rotation}">
                                <span class="value-disp">${rotation}°</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Opacidade</label>
                            <div class="control-wrap">
                                <input type="range" data-prop="opacity" min="0" max="100" value="${Math.round(opacity * 100)}">
                                <span class="value-disp">${Math.round(opacity * 100)}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // ── SEÇÃO: CORTE (CROP) ──
            const cropDisabled = cropEffect.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-scissors"></i> Recorte (Crop)
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="crop" title="${cropDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${cropDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${cropDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="crop" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${cropDisabled ? 0.4 : 1}; pointer-events:${cropDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Esquerda</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="left" min="0" max="100" value="${cropLeft}">
                                <span class="value-disp">${cropLeft}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Direita</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="right" min="0" max="100" value="${cropRight}">
                                <span class="value-disp">${cropRight}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Topo</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="top" min="0" max="100" value="${cropTop}">
                                <span class="value-disp">${cropTop}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Base</label>
                            <div class="control-wrap">
                                <input type="range" data-crop="bottom" min="0" max="100" value="${cropBottom}">
                                <span class="value-disp">${cropBottom}%</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // ── SEÇÃO: CORES & FILTROS ──
            const colDisabled = col.disabled === true;
            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-palette"></i> Efeitos de Cor
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="color" title="${colDisabled ? 'Ativar efeito' : 'Desativar efeito'}" style="background:none; border:none; color:${colDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${colDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="color" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${colDisabled ? 0.4 : 1}; pointer-events:${colDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Brilho</label>
                            <div class="control-wrap">
                                <input type="range" data-color="brightness" min="-100" max="100" value="${brightness}">
                                <span class="value-disp">${brightness}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Contraste</label>
                            <div class="control-wrap">
                                <input type="range" data-color="contrast" min="-100" max="100" value="${contrast}">
                                <span class="value-disp">${contrast}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Saturação</label>
                            <div class="control-wrap">
                                <input type="range" data-color="saturation" min="0" max="200" value="${saturation}">
                                <span class="value-disp">${saturation}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Matiz</label>
                            <div class="control-wrap">
                                <input type="range" data-color="hue" min="-180" max="180" value="${hue}">
                                <span class="value-disp">${hue}°</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Sépia</label>
                            <div class="control-wrap">
                                <input type="range" data-color="sepia" min="0" max="100" value="${sepia}">
                                <span class="value-disp">${sepia}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Cinzas</label>
                            <div class="control-wrap">
                                <input type="range" data-color="grayscale" min="0" max="100" value="${grayscale}">
                                <span class="value-disp">${grayscale}%</span>
                            </div>
                        </div>
                        <div class="adjustments-row">
                            <label>Desfoque</label>
                            <div class="control-wrap">
                                <input type="range" data-color="blur" min="0" max="20" value="${blur}">
                                <span class="value-disp">${blur}px</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // ── SEÇÃO: VOLUME DE ÁUDIO ──
        if (isAudioTrack || partnerAudioClip) {
            const dbVal = level > 0 ? (20 * Math.log10(level)).toFixed(1) : "-inf";
            const targetVolClip = isAudioTrack ? clip : partnerAudioClip;
            const volEffect = targetVolClip ? (targetVolClip.effects || []).find(e => e.type === "volume") : null;
            const volDisabled = volEffect ? volEffect.disabled === true : false;

            html += `
                <div class="adjustments-section">
                    <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <span style="display:flex; gap:6px; align-items:center;">
                            <i class="fa-solid fa-volume-high"></i> Áudio / Volume
                        </span>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button class="btn-adj-bypass" data-section="volume" title="${volDisabled ? 'Ativar volume' : 'Desativar volume'}" style="background:none; border:none; color:${volDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${volDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                            <button class="btn-adj-reset" data-section="volume" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                        </div>
                    </div>
                    <div class="adjustments-section-body" style="opacity:${volDisabled ? 0.4 : 1}; pointer-events:${volDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                        <div class="adjustments-row">
                            <label>Nível</label>
                            <div class="control-wrap">
                                <input id="adj-volume-slider" type="range" min="0" max="200" value="${Math.round(level * 100)}">
                                <span class="value-disp" style="min-width: 60px;">${Math.round(level * 100)}% (${dbVal} dB)</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // ── SEÇÃO: TRANSIÇÕES (FADES) ──
        const fadesDisabled = (fadeIn && fadeIn.disabled === true) || (fadeOut && fadeOut.disabled === true);
        html += `
            <div class="adjustments-section">
                <div class="adjustments-section-title" style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <span style="display:flex; gap:6px; align-items:center;">
                        <i class="fa-solid fa-circle-half-stroke"></i> Transições (Dissolve)
                    </span>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="btn-adj-bypass" data-section="fades" title="${fadesDisabled ? 'Ativar transições' : 'Desativar transições'}" style="background:none; border:none; color:${fadesDisabled ? 'var(--text-muted)' : 'var(--color-cyan)'}; cursor:pointer; font-size:10px;"><i class="fa-solid ${fadesDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>
                        <button class="btn-adj-reset" data-section="fades" title="Resetar padrão" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:10px;"><i class="fa-solid fa-arrow-rotate-left"></i></button>
                    </div>
                </div>
                <div class="adjustments-section-body" style="opacity:${fadesDisabled ? 0.4 : 1}; pointer-events:${fadesDisabled ? 'none' : 'auto'}; transition:opacity 0.2s;">
                    <div class="adjustments-row">
                        <label>Fade In (s)</label>
                        <div class="control-wrap">
                            <input id="adj-fadein" type="number" min="0" step="0.1" value="${fadeInDur}">
                        </div>
                    </div>
                    <div class="adjustments-row">
                        <label>Fade Out (s)</label>
                        <div class="control-wrap">
                            <input id="adj-fadeout" type="number" min="0" step="0.1" value="${fadeOutDur}">
                        </div>
                    </div>
                </div>
            </div>
        `;

        const savedScrollTop = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = savedScrollTop;

        // Acoplar listeners
        this.attachAdjustmentsListeners(container, clip.id);
    }

    attachAdjustmentsListeners(container, clipId) {
        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (!clip) return;

        // Enquadramento (fit/fill)
        container.querySelectorAll(".nle-select-btn").forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.action;
                const [kind, val] = action.split(":");
                if (kind === "fit") {
                    this.setClipFit(clipId, val);
                }
            };
        });

        // Presets Ken Burns
        const kbSelect = container.querySelector("#adj-kb-preset");
        if (kbSelect) {
            kbSelect.onchange = () => {
                this.setClipKenBurns(clipId, kbSelect.value);
            };
        }

        // Transformações (Geometria)
        container.querySelectorAll("input[data-prop]").forEach(slider => {
            const prop = slider.dataset.prop;
            const disp = slider.nextElementSibling;

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                let val = parseFloat(slider.value);
                if (prop === "scale") val = val / 100;
                else if (prop === "opacity") val = val / 100;

                if (disp) {
                    disp.textContent = slider.value + (prop === "rotation" ? "°" : "%");
                }

                // Mutação rápida sem Undo/Redo no meio do arrasto para feedback em tempo real
                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let tf = targetClip.effects.find(e => e.type === "transform");
                    if (!tf) {
                        tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                        targetClip.effects.push(tf);
                    }
                    tf[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                let val = parseFloat(slider.value);
                if (prop === "scale") val = val / 100;
                else if (prop === "opacity") val = val / 100;
                this.setClipTransform(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };
        });

        // Recorte (Crop)
        container.querySelectorAll("input[data-crop]").forEach(slider => {
            const prop = slider.dataset.crop;
            const disp = slider.nextElementSibling;

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(slider.value);

                if (disp) {
                    disp.textContent = slider.value + "%";
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let crop = targetClip.effects.find(e => e.type === "crop");
                    if (!crop) {
                        crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                        targetClip.effects.push(crop);
                    }
                    crop[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                const val = parseFloat(slider.value);
                this.setClipCrop(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };
        });

        // Efeitos de Cor
        container.querySelectorAll("input[data-color]").forEach(slider => {
            const prop = slider.dataset.color;
            const disp = slider.nextElementSibling;

            slider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(slider.value);
                if (disp) {
                    disp.textContent = slider.value + (prop === "blur" ? "px" : prop === "hue" ? "°" : "%");
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === clipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let col = targetClip.effects.find(e => e.type === "color");
                    if (!col) {
                        col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                        targetClip.effects.push(col);
                    }
                    col[prop] = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            slider.onchange = () => {
                const val = parseFloat(slider.value);
                this.setClipColor(clipId, prop, val);
                TIMELINE_HISTORY.commit();
            };
        });

        // Volume de Áudio
        const volSlider = container.querySelector("#adj-volume-slider");
        if (volSlider) {
            const disp = volSlider.nextElementSibling;
            volSlider.oninput = () => {
                TIMELINE_HISTORY.begin();
                const val = parseFloat(volSlider.value) / 100;
                const dbVal = val > 0 ? (20 * Math.log10(val)).toFixed(1) : "-inf";
                if (disp) {
                    disp.textContent = `${volSlider.value}% (${dbVal} dB)`;
                }

                const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (!isAudioTrack && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) {
                        targetClipId = partner.id;
                    }
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    let vol = targetClip.effects.find(e => e.type === "volume");
                    if (!vol) {
                        vol = { type: "volume", level: 1.0 };
                        targetClip.effects.push(vol);
                    }
                    vol.level = val;
                    STATE.activeTimelineCuts = cuts;
                }
            };

            volSlider.onchange = () => {
                const val = parseFloat(volSlider.value) / 100;

                const isAudioTrack = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (!isAudioTrack && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) {
                        targetClipId = partner.id;
                    }
                }

                this.setClipVolume(targetClipId, val);
                TIMELINE_HISTORY.commit();
            };
        }

        // Fades
        const fi = container.querySelector("#adj-fadein");
        const fo = container.querySelector("#adj-fadeout");
        if (fi) {
            fi.onchange = () => {
                this.setClipFade(clipId, "in", parseFloat(fi.value) || 0);
            };
        }
        if (fo) {
            fo.onchange = () => {
                this.setClipFade(clipId, "out", parseFloat(fo.value) || 0);
            };
        }

        // Ouvintes de Bypass (Ativar/Desativar Efeito)
        container.querySelectorAll(".btn-adj-bypass").forEach(btn => {
            btn.onclick = () => {
                const section = btn.dataset.section;
                TIMELINE_HISTORY.begin();

                const isAudio = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (section === "volume" && !isAudio && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) targetClipId = partner.id;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    if (section === "transform") {
                        let tf = targetClip.effects.find(e => e.type === "transform");
                        if (!tf) {
                            tf = { type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 };
                            targetClip.effects.push(tf);
                        }
                        tf.disabled = !tf.disabled;
                    } else if (section === "crop") {
                        let crop = targetClip.effects.find(e => e.type === "crop");
                        if (!crop) {
                            crop = { type: "crop", top: 0, right: 0, bottom: 0, left: 0 };
                            targetClip.effects.push(crop);
                        }
                        crop.disabled = !crop.disabled;
                    } else if (section === "color") {
                        let col = targetClip.effects.find(e => e.type === "color");
                        if (!col) {
                            col = { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 };
                            targetClip.effects.push(col);
                        }
                        col.disabled = !col.disabled;
                    } else if (section === "volume") {
                        let vol = targetClip.effects.find(e => e.type === "volume");
                        if (!vol) {
                            vol = { type: "volume", level: 1.0 };
                            targetClip.effects.push(vol);
                        }
                        vol.disabled = !vol.disabled;
                    } else if (section === "fades") {
                        const fades = targetClip.effects.filter(e => e.type === "crossfade");
                        fades.forEach(f => { f.disabled = !f.disabled; });
                    }
                    STATE.activeTimelineCuts = cuts;
                    this.refreshClipInspector();
                }

                TIMELINE_HISTORY.commit();
            };
        });

        // Ouvintes de Reset (Redefinir Padrão)
        container.querySelectorAll(".btn-adj-reset").forEach(btn => {
            btn.onclick = () => {
                const section = btn.dataset.section;
                TIMELINE_HISTORY.begin();

                const isAudio = TIMELINE_STATE.trackKindOf(clip.track) === "audio";
                let targetClipId = clipId;
                if (section === "volume" && !isAudio && clip.type === "video" && clip.link_id) {
                    const partner = STATE.activeTimelineCuts.find(c => c.link_id === clip.link_id && TIMELINE_STATE.trackKindOf(c.track) === "audio");
                    if (partner) targetClipId = partner.id;
                }

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => c.id === targetClipId);
                if (targetClip) {
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(e => ({ ...e })) : [];
                    if (section === "transform") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "transform");
                        targetClip.effects.push({ type: "transform", scale: 1.0, x: 0, y: 0, rotation: 0, opacity: 1.0 });
                    } else if (section === "crop") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "crop");
                        targetClip.effects.push({ type: "crop", top: 0, right: 0, bottom: 0, left: 0 });
                    } else if (section === "color") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "color");
                        targetClip.effects.push({ type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0 });
                    } else if (section === "volume") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "volume");
                        targetClip.effects.push({ type: "volume", level: 1.0 });
                    } else if (section === "fades") {
                        targetClip.effects = targetClip.effects.filter(e => e.type !== "crossfade");
                    }
                    STATE.activeTimelineCuts = cuts;
                    this.refreshClipInspector();
                }

                TIMELINE_HISTORY.commit();
            };
        });
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

        // Toggle do popup de alternativas com a tecla 'A'
        if (e.key.toLowerCase() === "a" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.activeFocusedPlayer === "source") {
                return; // Let the media library inspector handle it
            }
            const popup = this.canvas.ownerDocument.querySelector("#timeline-alternatives-popup");
            if (popup && popup.style.display === "flex") {
                this.hideAlternativesPopup();
                e.preventDefault();
                return;
            } else if (selectedId) {
                const clip = cuts.find(c => c.id === selectedId);
                if (clip && clip.origin === "ai" && clip.alternatives && clip.alternatives.length > 0) {
                    this.showAlternativesPopup(clip);
                    e.preventDefault();
                    return;
                }
            }
        }

        // Fechar popup de alternativas com a tecla 'Escape'
        if (e.key === "Escape") {
            const popup = this.canvas.ownerDocument.querySelector("#timeline-alternatives-popup");
            if (popup && popup.style.display === "flex") {
                this.hideAlternativesPopup();
                e.preventDefault();
                return;
            }
        }

        // Undo / Redo globais da timeline
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) TIMELINE_HISTORY.redo();
            else TIMELINE_HISTORY.undo();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            TIMELINE_HISTORY.redo();
            return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
            if (selectedId) {
                const idx = cuts.findIndex(c => c.id === selectedId);
                if (idx !== -1) {
                    TIMELINE_HISTORY.record(() => {
                        const clip = cuts[idx];
                        const linkId = clip.link_id;
                        if (e.altKey || !linkId) {
                            // Alt+Delete: apaga só o selecionado e desvincula o par
                            cuts.splice(idx, 1);
                            if (linkId) {
                                cuts.forEach(c => { if (c.link_id === linkId) c.link_id = null; });
                            }
                        } else {
                            // Delete: apaga o clipe e o par A/V vinculado
                            for (let i = cuts.length - 1; i >= 0; i--) {
                                if (cuts[i].link_id === linkId) cuts.splice(i, 1);
                            }
                        }
                        STATE.activeTimelineCuts = cuts;
                        TIMELINE_STATE.selectedClipId = null;
                    });
                    this.refreshClipInspector();
                    e.preventDefault();
                }
            } else if (TIMELINE_STATE.selectedGhostClipId) {
                // Rejeitar sugestão fantasma
                TIMELINE_STATE.rejectGhostSuggestion(TIMELINE_STATE.selectedGhostClipId);
                TIMELINE_STATE.selectedGhostClipId = null;
                e.preventDefault();
            }
        }
        else if (e.key.toLowerCase() === "u" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // U: desvincula o par A/V do clipe selecionado
            if (selectedId) {
                const clip = cuts.find(c => c.id === selectedId);
                if (clip && clip.link_id) {
                    TIMELINE_HISTORY.record(() => {
                        const linkId = clip.link_id;
                        cuts.forEach(c => { if (c.link_id === linkId) c.link_id = null; });
                        STATE.activeTimelineCuts = cuts;
                    });
                    e.preventDefault();
                }
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
        else if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Z: divide o clipe selecionado no playhead
            if (selectedId) {
                TIMELINE_STATE.splitClip(selectedId, TIMELINE_STATE.playheadFrame);
                e.preventDefault();
            }
        }
        else if (e.key === "ArrowLeft") {
            if (selectedId) {
                if (e.altKey) {
                    this.nudgeTrim(selectedId, "left", -1);
                } else if (e.shiftKey) {
                    this.nudgeTrim(selectedId, "right", -1);
                } else {
                    this.nudgeSelection(selectedId, -1); // 1 frame para trás
                }
            }
            e.preventDefault();
        }
        else if (e.key === "ArrowRight") {
            if (selectedId) {
                if (e.altKey) {
                    this.nudgeTrim(selectedId, "left", 1);
                } else if (e.shiftKey) {
                    this.nudgeTrim(selectedId, "right", 1);
                } else {
                    this.nudgeSelection(selectedId, 1); // 1 frame para frente
                }
            }
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
        if (clip && clip.type === "photo") {
            const photo = STATE.allPhotos.find(p => p.id === clip.photo_id);
            if (photo) STATE.activePhoto = photo;
            return;
        }
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

        const clipKind = TIMELINE_STATE.trackKindOf(clip.track);

        // Trilha final do clipe: precisa ser do mesmo tipo (vídeo↔vídeo, áudio↔áudio) e estar livre
        let finalTrackId = clip.track;
        if (targetTrack && targetTrack !== clip.track) {
            const t = TIMELINE_STATE.getTrack(targetTrack);
            if (t && !t.locked && (t.kind || "video") === clipKind) {
                console.log(`[Timeline] Transpondo clipe ${clipId} de ${clip.track} para ${targetTrack}`);
                finalTrackId = targetTrack;
            }
        }
        const finalTrack = TIMELINE_STATE.getTrack(finalTrackId);
        if (finalTrack && finalTrack.locked) return;
        if (finalTrackId !== clip.track) clip.track = finalTrackId;

        if (clipKind === "audio") {
            if (clip.link_id) {
                // Áudio vinculado: o par se move junto — o delta horizontal é aplicado
                // ao vídeo par e a passada de sincronia A/V reancora o áudio.
                const partner = cuts.find(c => c.id !== clip.id && c.link_id === clip.link_id &&
                    TIMELINE_STATE.trackKindOf(c.track) === "video");
                if (partner) {
                    const partnerTrack = TIMELINE_STATE.getTrack(partner.track);
                    if (partnerTrack && !partnerTrack.magnetic && !partnerTrack.locked) {
                        const delta = targetStartFrame - clip.timelineStartFrame;
                        partner.timelineStartFrame = Math.max(0, partner.timelineStartFrame + delta);
                    }
                    // Em pista magnética o vídeo é rippleado: o áudio fica ancorado
                    STATE.activeTimelineCuts = cuts;
                    return;
                }
            }
            // Áudio destacado: posicionamento livre
            clip.timelineStartFrame = Math.max(0, targetStartFrame);
            STATE.activeTimelineCuts = cuts;
            return;
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

        const kind = trackObj ? (trackObj.kind || "video") : "video";

        TIMELINE_HISTORY.record(() => {
            if (kind === "video" && (trackObj ? trackObj.magnetic : clip.track === "V1")) {
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
                // Pistas livres (e áudio vinculado/destacado): desloca no tempo via moveClip
                this.moveClip(clipId, Math.max(0, clip.timelineStartFrame + deltaFrames), null);
            }
        });
    }

    nudgeTrim(clipId, edge, deltaFrames) {
        const cuts = [...STATE.activeTimelineCuts];
        const clip = cuts.find(c => c.id === clipId);
        if (!clip) return;

        const fps = TIMELINE_STATE.fps; // frames sempre em fps da timeline

        TIMELINE_HISTORY.record(() => {
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
        });
    }

    // --- POPUPS E INTERACTION IA CONTEXTUAL ---

    /**
     * Posiciona um popup `position: fixed` próximo ao cursor, sem sair da viewport.
     * Os popups vivem no <body> da janela do canvas: dentro do container da timeline
     * (overflow: hidden) eles eram cortados ao abrir acima das pistas superiores.
     */
    _placeFixedPopup(popup, clientX, clientY, offsetX = 12) {
        const win = this.canvas.ownerDocument.defaultView || window;
        popup.style.visibility = "hidden";
        popup.style.display = "flex";
        const w = popup.offsetWidth || 300;
        const h = popup.offsetHeight || 150;

        let left = clientX + offsetX;
        if (left + w > win.innerWidth - 8) left = Math.max(8, clientX - w - offsetX);

        let top = clientY - h - 12; // preferência: acima do cursor
        if (top < 8) top = Math.min(clientY + 16, win.innerHeight - h - 8);
        top = Math.max(8, Math.min(top, win.innerHeight - h - 8));

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.visibility = "visible";
    }

    showGhostActionsPopup(clientX, clientY, ghost) {
        const doc = this.canvas.ownerDocument;
        let popup = doc.querySelector("#ghost-action-popup");
        if (!popup) {
            popup = doc.createElement("div");
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
                z-index: 10001;
                font-family: sans-serif;
                min-width: 220px;
                backdrop-filter: blur(8px);
            `;
            doc.body.appendChild(popup);
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

        this._placeFixedPopup(popup, clientX, clientY);

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
                this.canvas.ownerDocument.removeEventListener("mousedown", closeHandler);
            }
        };
        setTimeout(() => this.canvas.ownerDocument.addEventListener("mousedown", closeHandler), 10);
    }

    /**
     * Atualiza a exibição do popup flutuante de preview com o vídeo proxy correspondente.
     */
    updateHoverPreview(clientX, clientY, frame, track) {
        const doc = this.canvas.ownerDocument;
        // Reutiliza o card estático do index.html; em popouts, cria um no body da janela
        let previewCard = doc.querySelector("#timeline-preview-card");
        if (!previewCard) {
            previewCard = doc.createElement("div");
            previewCard.id = "timeline-preview-card";
            previewCard.style.cssText = `
                position: fixed;
                width: 200px;
                height: 145px;
                background: rgba(15, 23, 42, 0.95);
                border: 1px solid var(--border-glass);
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6);
                z-index: 10000;
                display: none;
                flex-direction: column;
                pointer-events: none;
                backdrop-filter: blur(8px);
            `;
            previewCard.innerHTML = `<video autoplay muted loop playsinline style="width: 100%; height: 112px; object-fit: cover; background: #000;"></video><img class="preview-img" style="width: 100%; height: 112px; object-fit: cover; background: #000; display: none;"><div class="preview-info" style="flex: 1; font-size: 10px; color: var(--text-secondary); padding: 6px 8px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; font-family: monospace;">00:00:00:00</div>`;
            doc.body.appendChild(previewCard);
        }

        // Se estiver arrastando ou fazendo scrub, ou fora das trilhas, esconde o preview normal
        if (this.dragState || !track) {
            previewCard.style.display = "none";
            return;
        }

        const hit = this.findClipAt(frame, track);
        if (hit && hit.type === "clip") {
            const clip = hit.data;

            // Preview de FOTO (still): mostra a imagem no card, oculta o vídeo
            if (clip.type === "photo") {
                const photo = STATE.allPhotos.find(p => p.id === clip.photo_id);
                if (photo) {
                    const imgEl = previewCard.querySelector(".preview-img");
                    const videoEl = previewCard.querySelector("video");
                    const infoEl = previewCard.querySelector(".preview-info");
                    if (videoEl) { videoEl.pause(); videoEl.style.display = "none"; }
                    const src = (photo.proxy_path || photo.filepath || `/originals/${photo.filename}`).replace(/\\/g, "/");
                    if (imgEl) {
                        if (imgEl.src.indexOf(src) === -1) imgEl.src = src;
                        imgEl.style.display = "block";
                    }
                    const durS = clip.out - clip.in;
                    infoEl.textContent = `${photo.filename} (${durS.toFixed(1)}s)`;
                    this._placeFixedPopup(previewCard, clientX, clientY, 15);
                    return;
                }
            }

            const video = STATE.allVideos.find(v => v.id === clip.video_id);
            if (video) {
                const imgEl = previewCard.querySelector(".preview-img");
                if (imgEl) imgEl.style.display = "none";
                const vEl = previewCard.querySelector("video");
                if (vEl) vEl.style.display = "block";
                const videoSrc = video.proxy_path || video.filepath || `/originals/${video.filename}`;
                const videoEl = previewCard.querySelector("video");
                const infoEl = previewCard.querySelector(".preview-info");
                
                const inSeconds = clip.in;
                const outSeconds = clip.out;
                const targetSrc = `${videoSrc}#t=${inSeconds.toFixed(1)},${outSeconds.toFixed(1)}`;
                
                const fullTargetSrc = window.location.origin + targetSrc;
                if (videoEl.src !== fullTargetSrc && !videoEl.src.endsWith(targetSrc)) {
                    videoEl.src = targetSrc;
                    videoEl.load();
                    videoEl.play().catch(() => {});
                }

                const duration = outSeconds - inSeconds;
                infoEl.textContent = `${video.filename} (${duration.toFixed(1)}s)`;

                this._placeFixedPopup(previewCard, clientX, clientY, 15);
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
        const previewCard = this.canvas.ownerDocument.querySelector("#timeline-preview-card");
        if (previewCard) {
            previewCard.style.display = "none";
            const videoEl = previewCard.querySelector("video");
            if (videoEl) {
                videoEl.pause();
                videoEl.src = "";
            }
        }
    }

    /**
     * Exibe o carrossel popup de mídias alternativas como modal com backdrop desfocado.
     */
    showAlternativesPopup(clip) {
        const doc = this.canvas.ownerDocument;
        
        // Criar backdrop se não existir
        let backdrop = doc.querySelector("#timeline-alternatives-backdrop");
        if (!backdrop) {
            backdrop = doc.createElement("div");
            backdrop.id = "timeline-alternatives-backdrop";
            backdrop.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(5px);
                z-index: 9999;
                display: none;
            `;
            backdrop.addEventListener("click", () => this.hideAlternativesPopup());
            doc.body.appendChild(backdrop);
        }

        // Criar popup se não existir
        let popup = doc.querySelector("#timeline-alternatives-popup");
        if (!popup) {
            popup = doc.createElement("div");
            popup.id = "timeline-alternatives-popup";
            popup.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(15, 23, 42, 0.98);
                border: 1px solid var(--color-cyan);
                border-radius: 12px;
                padding: 20px;
                display: none;
                flex-direction: column;
                gap: 15px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
                z-index: 10000;
                font-family: sans-serif;
                width: 720px;
                max-width: 90vw;
                backdrop-filter: blur(10px);
                color: #fff;
            `;
            doc.body.appendChild(popup);
        }

        if (popup.dataset.clipId === clip.id && popup.style.display === "flex") {
            return;
        }
        popup.dataset.clipId = clip.id;

        // Renderiza lista de alternativas
        let altsHtml = "";
        const activeAlts = (clip.alternatives || []).filter(alt => alt.video_id !== clip.video_id);
        
        activeAlts.forEach((alt, idx) => {
            const video = STATE.allVideos.find(v => v.id === alt.video_id);
            if (!video) return;
            const videoSrc = video.proxy_path || video.filepath || `/originals/${video.filename}`;
            const targetSrc = `${videoSrc}#t=${alt.in_s.toFixed(1)},${alt.out_s.toFixed(1)}`;
            
            altsHtml += `
                <div class="alt-card" style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                    <div style="position: relative; border-radius: 6px; overflow: hidden; background: #000; aspect-ratio: 16/9;">
                        <video src="${targetSrc}" autoplay loop muted playsinline style="width: 100%; height: 100%; object-fit: cover;"></video>
                        <div style="position: absolute; top: 8px; left: 8px; font-size: 10px; font-weight: bold; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; color: #fff;">
                            Candidato #${idx + 1}
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #e2e8f0; line-height: 1.4; flex-grow: 1; min-height: 36px;">
                        "${alt.reason || 'Sem justificativa.'}"
                    </div>
                    <div style="font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                        <span>Duração Ideal: ${alt.ideal_duration_s ? alt.ideal_duration_s.toFixed(1) + 's' : 'N/A'}</span>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-alt-swap-fixed btn-icon" data-video-id="${alt.video_id}" data-in="${alt.in_s}" data-out="${alt.out_s}" title="Slot Fixo (substitui mantendo a duração atual)" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #fff; cursor: pointer; outline: none; transition: all 0.2s;">
                                <i class="fa-solid fa-arrows-left-right"></i>
                            </button>
                            <button class="btn-alt-swap-ripple btn-icon" data-video-id="${alt.video_id}" data-in="${alt.in_s}" data-out="${alt.out_s}" title="Ripple (aplica duração ideal e empurra os seguintes)" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 15px; background: rgba(6,182,212,0.1); border: 1px solid rgba(6,182,212,0.3); border-radius: 6px; color: var(--color-cyan); cursor: pointer; outline: none; transition: all 0.2s;">
                                <i class="fa-solid fa-angles-right"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        popup.innerHTML = `
            <style>
                .btn-alt-swap-fixed:hover {
                    background: rgba(255,255,255,0.15) !important;
                    border-color: rgba(255,255,255,0.3) !important;
                }
                .btn-alt-swap-ripple:hover {
                    background: rgba(6,182,212,0.25) !important;
                    border-color: rgba(6,182,212,0.6) !important;
                }
                .btn-close-alts:hover {
                    color: #fff !important;
                }
            </style>
            <div style="font-size: 14px; color: var(--color-cyan); font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
                <span><i class="fa-solid fa-wand-magic-sparkles"></i> Opções Alternativas da IA</span>
                <span style="font-size: 11px; color: var(--text-secondary); cursor: pointer; padding: 4px;" class="btn-close-alts"><i class="fa-solid fa-xmark"></i></span>
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: -5px;">
                Atalho: pressione <kbd style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">A</kbd> para fechar ou clique fora.
            </div>
            <div style="max-height: 400px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; padding-right: 4px; margin-top: 10px;">
                ${altsHtml || '<div style="grid-column: 1/-1; font-size: 12px; color: var(--text-secondary); text-align: center; padding: 20px 0;">Nenhum clipe alternativo configurado no acervo.</div>'}
            </div>
        `;

        backdrop.style.display = "block";
        popup.style.display = "flex";

        // Listeners dos botões
        popup.querySelector(".btn-close-alts").onclick = () => this.hideAlternativesPopup();

        popup.querySelectorAll(".btn-alt-swap-fixed").forEach(btn => {
            btn.onclick = () => {
                const vid = parseInt(btn.dataset.videoId);
                const inS = parseFloat(btn.dataset.in);
                const outS = parseFloat(btn.dataset.out);
                TIMELINE_STATE.replaceClipWithAlternative(clip.id, vid, inS, outS, false);
                this.hideAlternativesPopup();
            };
        });

        popup.querySelectorAll(".btn-alt-swap-ripple").forEach(btn => {
            btn.onclick = () => {
                const vid = parseInt(btn.dataset.videoId);
                const inS = parseFloat(btn.dataset.in);
                const outS = parseFloat(btn.dataset.out);
                TIMELINE_STATE.replaceClipWithAlternative(clip.id, vid, inS, outS, true);
                this.hideAlternativesPopup();
            };
        });
    }

    /**
     * Oculta o popup flutuante de alternativas.
     */
    hideAlternativesPopup() {
        const doc = this.canvas.ownerDocument;
        const popup = doc.querySelector("#timeline-alternatives-popup");
        const backdrop = doc.querySelector("#timeline-alternatives-backdrop");
        if (popup) {
            popup.style.display = "none";
            // Limpar sources e pausar para economizar recursos
            popup.querySelectorAll("video").forEach(v => {
                v.pause();
                v.src = "";
            });
        }
        if (backdrop) {
            backdrop.style.display = "none";
        }
    }
}
