// Controlador de Interatividade, Cliques e Atalhos da Timeline (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, secondsToFrames, framesToSeconds } from "./timelineState.js";

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
                        this.refreshPhotoInspector();
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
            this.refreshPhotoInspector();
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

    onMouseUp() {
        // Fecha a transação do drag/trim (no-op se nada mudou)
        TIMELINE_HISTORY.commit();
        this.dragState = null;
        this.draggedClipId = null;
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

    // ── INSPETOR DE CLIPE DE FOTO (enquadramento / Ken Burns / fades) ──

    /** Mostra o inspetor se o clipe selecionado for foto; senão oculta. */
    refreshPhotoInspector() {
        const clip = STATE.activeTimelineCuts.find(c => c.id === TIMELINE_STATE.selectedClipId);
        if (clip && clip.type === "photo") this.showPhotoInspector(clip);
        else this.hidePhotoInspector();
    }

    hidePhotoInspector() {
        const panel = this.canvas.ownerDocument.querySelector("#timeline-photo-inspector");
        if (panel) panel.style.display = "none";
    }

    /** Aplica uma mutação nos effects do clipe de foto (com undo) e re-renderiza o painel. */
    _mutatePhotoEffects(clipId, fn) {
        TIMELINE_HISTORY.record(() => {
            const cuts = [...STATE.activeTimelineCuts];
            const clip = cuts.find(c => c.id === clipId);
            if (!clip || clip.type !== "photo") return;
            clip.effects = clip.effects ? clip.effects.map(e => ({ ...e })) : [];
            fn(clip);
            STATE.activeTimelineCuts = cuts; // dispara recomposição do Program + redraw
        });
        const clip = STATE.activeTimelineCuts.find(c => c.id === clipId);
        if (clip) this.showPhotoInspector(clip);
    }

    setPhotoFit(clipId, mode) {
        this._mutatePhotoEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "fit");
            clip.effects.push({ type: "fit", mode });
        });
    }

    setPhotoKenBurns(clipId, preset) {
        const presets = {
            none: null,
            zoomIn: { from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.25, x: 0, y: 0 } },
            zoomOut: { from: { scale: 1.25, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 } },
            panRight: { from: { scale: 1.18, x: 6, y: 0 }, to: { scale: 1.18, x: -6, y: 0 } },
            panLeft: { from: { scale: 1.18, x: -6, y: 0 }, to: { scale: 1.18, x: 6, y: 0 } }
        };
        this._mutatePhotoEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => e.type !== "ken_burns");
            const cfg = presets[preset];
            if (cfg) clip.effects.push({ type: "ken_burns", preset, easing: "easeInOut", ...cfg });
        });
    }

    setPhotoFade(clipId, side, dur) {
        this._mutatePhotoEffects(clipId, (clip) => {
            clip.effects = clip.effects.filter(e => !(e.type === "crossfade" && e.side === side));
            if (dur > 0) clip.effects.push({ type: "crossfade", side, duration_s: dur });
        });
    }

    /** Painel flutuante de ajustes do clipe de foto selecionado. */
    showPhotoInspector(clip) {
        const doc = this.canvas.ownerDocument;
        const win = doc.defaultView || window;
        let panel = doc.querySelector("#timeline-photo-inspector");
        if (!panel) {
            panel = doc.createElement("div");
            panel.id = "timeline-photo-inspector";
            panel.style.cssText = `position: fixed; z-index: 10002; background: rgba(15,23,42,0.97); border: 1px solid var(--color-cyan); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 12px 30px rgba(0,0,0,0.6); font-family: sans-serif; width: 300px; backdrop-filter: blur(8px); color: #fff;`;
            doc.body.appendChild(panel);
        }
        panel.dataset.clipId = clip.id;

        const eff = clip.effects || [];
        const fit = eff.find(e => e.type === "fit");
        const fitMode = fit ? fit.mode : "fill";
        const kb = eff.find(e => e.type === "ken_burns");
        const kbPreset = kb ? (kb.preset || "custom") : "none";
        const fadeIn = eff.find(e => e.type === "crossfade" && e.side === "in");
        const fadeOut = eff.find(e => e.type === "crossfade" && e.side === "out");

        const btn = (label, active, act) => `<button data-act="${act}" style="flex:1; min-width:56px; padding:4px 6px; font-size:10px; border-radius:5px; cursor:pointer; border:1px solid ${active ? 'var(--color-cyan)' : 'rgba(255,255,255,0.15)'}; background:${active ? 'rgba(6,182,212,0.25)' : 'rgba(255,255,255,0.05)'}; color:#fff;">${label}</button>`;

        panel.innerHTML = `
            <div style="font-size:11px; font-weight:bold; color:var(--color-cyan); display:flex; justify-content:space-between; align-items:center;">
                <span><i class="fa-solid fa-image"></i> Foto — Ajustes</span>
                <span id="photo-insp-close" style="cursor:pointer; color:var(--text-secondary);"><i class="fa-solid fa-xmark"></i></span>
            </div>
            <div style="font-size:10px; color:var(--text-secondary);">Enquadramento</div>
            <div style="display:flex; gap:6px;">${btn("Preencher (fill)", fitMode === "fill", "fit:fill")}${btn("Ajustar (fit)", fitMode === "fit", "fit:fit")}</div>
            <div style="font-size:10px; color:var(--text-secondary);">Movimento (Ken Burns)</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${btn("Nenhum", kbPreset === "none", "kb:none")}
                ${btn("Zoom In", kbPreset === "zoomIn", "kb:zoomIn")}
                ${btn("Zoom Out", kbPreset === "zoomOut", "kb:zoomOut")}
                ${btn("Pan →", kbPreset === "panRight", "kb:panRight")}
                ${btn("Pan ←", kbPreset === "panLeft", "kb:panLeft")}
            </div>
            <div style="font-size:10px; color:var(--text-secondary);">Transições (dissolve, s)</div>
            <div style="display:flex; gap:6px; align-items:center;">
                <span style="font-size:10px;">In</span>
                <input id="photo-insp-fadein" type="number" min="0" step="0.1" value="${fadeIn ? fadeIn.duration_s : 0}" style="width:56px; height:24px; font-size:11px; text-align:center; background:rgba(255,255,255,0.05); border:1px solid var(--border-glass); border-radius:5px; color:#fff;">
                <span style="font-size:10px;">Out</span>
                <input id="photo-insp-fadeout" type="number" min="0" step="0.1" value="${fadeOut ? fadeOut.duration_s : 0}" style="width:56px; height:24px; font-size:11px; text-align:center; background:rgba(255,255,255,0.05); border:1px solid var(--border-glass); border-radius:5px; color:#fff;">
            </div>
        `;

        // Posiciona acima (à direita) do canvas da timeline
        const rect = this.canvas.getBoundingClientRect();
        let top = rect.top - 232;
        if (top < 8) top = Math.min(rect.top + 8, win.innerHeight - 244);
        panel.style.top = `${Math.max(8, top)}px`;
        panel.style.left = `${Math.max(8, Math.min(rect.right - 312, win.innerWidth - 312))}px`;
        panel.style.display = "flex";

        panel.querySelector("#photo-insp-close").onclick = () => this.hidePhotoInspector();
        panel.querySelectorAll("button[data-act]").forEach(b => {
            b.onclick = () => {
                const [kind, val] = b.dataset.act.split(":");
                if (kind === "fit") this.setPhotoFit(clip.id, val);
                else if (kind === "kb") this.setPhotoKenBurns(clip.id, val);
            };
        });
        const fi = panel.querySelector("#photo-insp-fadein");
        const fo = panel.querySelector("#photo-insp-fadeout");
        fi.onchange = () => this.setPhotoFade(clip.id, "in", parseFloat(fi.value) || 0);
        fo.onchange = () => this.setPhotoFade(clip.id, "out", parseFloat(fo.value) || 0);
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
                    this.hidePhotoInspector();
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
