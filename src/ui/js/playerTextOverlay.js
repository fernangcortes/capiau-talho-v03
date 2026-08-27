// playerTextOverlay.js - Manipulação Direta de Texto e Títulos no Player do CapIAu-Talho
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";
import { evaluateClipTransform, evaluateClipProperty, hasKeyframes, addOrUpdateKeyframe } from "./keyframeEngine.js";
import { getActiveElement } from "./workspaceManager.js";

export class PlayerTextOverlayManager {
    constructor() {
        this.activeClipId = null;
        this.isDragging = false;
        this.isInlineEditing = false;
        this._dragCleanup = null;
        this.textLayer = null;
        this.interactiveLayer = null;
        this.safeAreasLayer = null;
    }

    el(id) {
        return getActiveElement(id);
    }

    init() {
        this.ensureLayers();

        STATE.on("timelineCutsUpdated", () => {
            if (!this.isDragging) this.sync();
        });
        STATE.on("timelinePlayheadChanged", () => {
            if (!this.isDragging) this.sync();
        });
        STATE.on("timelineSelectionChanged", (selectedId) => {
            this.activeClipId = selectedId;
            if (!this.isDragging) this.sync();
        });
        STATE.on("previewZoomChanged", () => {
            if (!this.isDragging) this.sync();
        });
        STATE.on("timelinePropertiesChanged", () => {
            if (!this.isDragging) this.sync();
        });
    }

    ensureLayers() {
        const viewport = this.el("program-player-viewport");
        if (!viewport) return;

        if (!this.el("program-safe-areas")) {
            const safeDiv = document.createElement("div");
            safeDiv.id = "program-safe-areas";
            safeDiv.className = "program-safe-areas-layer";
            safeDiv.style.cssText = "position: absolute; inset: 0; pointer-events: none; z-index: 35; display: none;";
            safeDiv.innerHTML = `
                <div class="safe-area-box action-safe" title="Action Safe (90%)" data-tooltip="Action Safe (90%)"></div>
                <div class="safe-area-box title-safe" title="Title Safe (80%)" data-tooltip="Title Safe (80%)"></div>
            `;
            viewport.appendChild(safeDiv);
        }

        if (!this.el("program-text-layer")) {
            const textDiv = document.createElement("div");
            textDiv.id = "program-text-layer";
            textDiv.className = "program-text-layer";
            textDiv.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 40;";
            viewport.appendChild(textDiv);
        }

        if (!this.el("program-text-interactive-overlay")) {
            const interDiv = document.createElement("div");
            interDiv.id = "program-text-interactive-overlay";
            interDiv.className = "program-text-interactive-overlay";
            interDiv.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 55;";
            viewport.appendChild(interDiv);
        }

        this.textLayer = this.el("program-text-layer");
        this.interactiveLayer = this.el("program-text-interactive-overlay");
        this.safeAreasLayer = this.el("program-safe-areas");
    }

    sync() {
        if (this.isDragging || this.isInlineEditing) return;

        this.ensureLayers();
        if (!this.textLayer || !this.interactiveLayer) return;

        const currentFrame = TIMELINE_STATE.playheadFrame || 0;
        const cuts = STATE.activeTimelineCuts || [];
        const fps = TIMELINE_STATE.fps || 24;

        // Pistas de texto ativas e não ocultas
        const textTracks = TIMELINE_STATE.getTextTracks ? TIMELINE_STATE.getTextTracks().filter(t => !TIMELINE_STATE.muteHiddenTracksPlayback || !t.hidden) : [];
        const textTrackIds = new Set(textTracks.map(t => t.id));

        // Clipes de texto visíveis no playhead atual
        const visibleTextClips = cuts.filter(c =>
            c.type === "text" &&
            (textTrackIds.size === 0 || textTrackIds.has(c.track)) &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        this.renderTextLayer(visibleTextClips, currentFrame, fps);

        // Se o clipe selecionado for de texto e estiver visível, renderiza a bounding box interativa
        const selectedId = TIMELINE_STATE.selectedClipId;
        const selectedClip = cuts.find(c => String(c.id) === String(selectedId) && c.type === "text");

        if (selectedClip && visibleTextClips.some(c => String(c.id) === String(selectedClip.id))) {
            const clipStart = selectedClip.timelineStartFrame !== undefined ? selectedClip.timelineStartFrame : Math.round((selectedClip.timeline_start || 0) * fps);
            const relTimeS = Math.max(0, (currentFrame - clipStart) / fps);
            this.renderBoundingBox(selectedClip, relTimeS);
        } else {
            this.interactiveLayer.innerHTML = "";
            this.interactiveLayer.style.pointerEvents = "none";
        }
    }

    renderTextLayer(visibleClips, currentFrame, fps) {
        if (!this.textLayer) return;
        this.textLayer.innerHTML = "";

        visibleClips.forEach(clip => {
            const clipStart = clip.timelineStartFrame !== undefined ? clip.timelineStartFrame : Math.round((clip.timeline_start || 0) * fps);
            const relTimeS = Math.max(0, (currentFrame - clipStart) / fps);

            // Avalia transformações com interpolação de keyframes
            const tf = evaluateClipTransform(clip, relTimeS);
            const fontSize = evaluateClipProperty(clip, "fontSize", relTimeS, clip.fontSize || 36);
            const tracking = evaluateClipProperty(clip, "tracking", relTimeS, clip.tracking || 0);

            const el = document.createElement("div");
            el.className = "player-text-rendered-item";
            el.dataset.clipId = String(clip.id);

            // Alinhamento horizontal
            let textAlign = clip.alignment || "center";
            let justifyVal = textAlign === "left" ? "flex-start" : (textAlign === "right" ? "flex-end" : "center");

            const posX = tf.x;
            const posY = tf.y;

            // Estilos CSS do elemento de texto
            el.style.position = "absolute";
            el.style.left = `calc(50% + ${posX}%)`;
            el.style.top = `calc(50% + ${posY}%)`;
            el.style.transform = `translate(-50%, -50%) scale(${tf.scale}) rotate(${tf.rotation}deg)`;
            el.style.opacity = tf.opacity;
            el.style.transformOrigin = "center center";
            el.style.fontFamily = clip.fontFamily ? `"${clip.fontFamily}", sans-serif` : "var(--font-heading)";
            el.style.fontSize = `${fontSize}px`;
            el.style.letterSpacing = `${tracking}px`;
            el.style.color = clip.color || "#ffffff";
            el.style.textAlign = textAlign;
            el.style.display = "flex";
            el.style.flexDirection = "column";
            el.style.alignItems = justifyVal;
            el.style.pointerEvents = "auto";
            el.style.cursor = "move";
            el.style.userSelect = "none";
            el.style.whiteSpace = "pre-wrap";
            el.style.wordBreak = "break-word";
            el.style.maxWidth = "90%";
            el.style.lineHeight = String(clip.lineHeight || 1.2);

            const bgVal = clip.backgroundColor;
            const isTransparent = !bgVal || bgVal === "transparent" || bgVal === "#00000000" || clip.bgMode === "transparent";

            if (!isTransparent) {
                el.style.backgroundColor = bgVal;
                el.style.padding = `${clip.boxPadding !== undefined ? clip.boxPadding : 8}px 14px`;
                el.style.borderRadius = `${clip.boxBorderRadius !== undefined ? clip.boxBorderRadius : 4}px`;
                el.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)";
                el.style.backdropFilter = "blur(10px)";
                el.style.webkitBackdropFilter = "blur(10px)";
                el.style.textShadow = "0 1px 4px rgba(0,0,0,0.6)";
            } else {
                el.style.backgroundColor = "transparent";
                el.style.padding = "0";
                el.style.borderRadius = "0";
                el.style.boxShadow = "none";
                el.style.backdropFilter = "none";
                el.style.webkitBackdropFilter = "none";
                el.style.textShadow = "0 2px 10px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.9)";
            }

            // Conteúdo principal e subtexto (Lower Third)
            const mainTextSpan = document.createElement("span");
            mainTextSpan.className = "text-main-body";
            mainTextSpan.textContent = clip.text || "";
            el.appendChild(mainTextSpan);

            if (clip.subtext && clip.subtext.trim()) {
                const subSpan = document.createElement("span");
                subSpan.className = "text-sub-body";
                subSpan.style.fontSize = `${Math.max(12, Math.round(fontSize * 0.55))}px`;
                subSpan.style.opacity = "0.88";
                subSpan.style.marginTop = "4px";
                subSpan.style.fontWeight = "400";
                subSpan.textContent = clip.subtext;
                el.appendChild(subSpan);
            }

            // Mousedown seleciona o clipe e inicia o arraste imediatamente
            el.onmousedown = (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                if (String(TIMELINE_STATE.selectedClipId) !== String(clip.id)) {
                    TIMELINE_STATE.selectClip(clip.id);
                }
                this.startDirectDrag(clip, relTimeS, e);
            };

            // Duplo clique abre edição inline diretamente na tela
            el.ondblclick = (e) => {
                e.stopPropagation();
                this.startInlineEdit(clip, el, relTimeS);
            };

            this.textLayer.appendChild(el);
        });
    }

    renderBoundingBox(clip, relTimeS) {
        if (!this.interactiveLayer) return;
        this.interactiveLayer.innerHTML = "";
        this.interactiveLayer.style.pointerEvents = "auto";

        const tf = evaluateClipTransform(clip, relTimeS);
        const renderedEl = this.textLayer ? this.textLayer.querySelector(`[data-clip-id="${clip.id}"]`) : null;
        if (!renderedEl) return;

        const viewport = this.el("program-player-viewport");
        if (!viewport) return;

        let unscaledW = renderedEl.offsetWidth;
        let unscaledH = renderedEl.offsetHeight;
        if (!unscaledW || !unscaledH) {
            const r = renderedEl.getBoundingClientRect();
            const curScale = tf.scale || 1.0;
            unscaledW = Math.max(40, r.width / curScale);
            unscaledH = Math.max(24, r.height / curScale);
        }

        const posX = tf.x;
        const posY = tf.y;

        const box = document.createElement("div");
        box.className = "text-bounding-box active";
        box.dataset.clipId = String(clip.id);
        box.style.position = "absolute";
        box.style.left = `calc(50% + ${posX}%)`;
        box.style.top = `calc(50% + ${posY}%)`;
        box.style.width = `${Math.max(40, unscaledW)}px`;
        box.style.height = `${Math.max(24, unscaledH)}px`;
        box.style.transform = `translate(-50%, -50%) scale(${tf.scale}) rotate(${tf.rotation}deg)`;
        box.style.transformOrigin = "center center";
        box.style.border = "1.5px dashed var(--color-cyan)";
        box.style.boxShadow = "0 0 10px rgba(6, 182, 212, 0.4), inset 0 0 10px rgba(6, 182, 212, 0.08)";
        box.style.cursor = "move";
        box.style.boxSizing = "border-box";
        box.style.pointerEvents = "auto";

        // Alças de Redimensionamento e Rotação
        box.innerHTML = `
            <!-- Centro (Âncora) -->
            <div class="transform-anchor" style="position:absolute; top:calc(50% - 4px); left:calc(50% - 4px); width:8px; height:8px; pointer-events:none;"></div>

            <!-- Alça de Rotação -->
            <div class="transform-rot-line" style="position:absolute; top:-24px; left:50%; width:1px; height:20px; background:var(--color-cyan);"></div>
            <div class="transform-handle-rot" data-handle="rot" style="position:absolute; top:-30px; left:calc(50% - 4px); width:8px; height:8px; border-radius:50%; background:var(--color-cyan); border:1px solid #fff; cursor:grab; pointer-events:auto;" title="Girar Texto"></div>

            <!-- 8 Alças de Redimensionamento -->
            <div class="transform-handle tl" data-handle="tl"></div>
            <div class="transform-handle tc" data-handle="tc"></div>
            <div class="transform-handle tr" data-handle="tr"></div>
            <div class="transform-handle ml" data-handle="ml"></div>
            <div class="transform-handle mr" data-handle="mr"></div>
            <div class="transform-handle bl" data-handle="bl"></div>
            <div class="transform-handle bc" data-handle="bc"></div>
            <div class="transform-handle br" data-handle="br"></div>
        `;

        this.attachInteractiveBoxListeners(box, clip, relTimeS);
        this.interactiveLayer.appendChild(box);
    }

    startDirectDrag(clip, relTimeS, startEv) {
        const box = this.interactiveLayer ? this.interactiveLayer.querySelector(`[data-clip-id="${clip.id}"]`) : null;
        if (box && box._startDrag) {
            box._startDrag(startEv);
        }
    }

    attachInteractiveBoxListeners(box, clip, relTimeS) {
        if (this._dragCleanup) {
            this._dragCleanup();
            this._dragCleanup = null;
        }

        const viewport = this.el("program-player-viewport");
        if (!viewport) return;

        const onMouseDown = (e) => {
            const handleType = e.target.dataset.handle;
            if (e.button !== 0) return;

            e.preventDefault();
            e.stopPropagation();

            this.isDragging = true;

            const startMouseX = e.clientX;
            const startMouseY = e.clientY;

            const tf = evaluateClipTransform(clip, relTimeS);
            const initialX = tf.x;
            const initialY = tf.y;
            const initialScale = tf.scale || 1.0;
            const initialRot = tf.rotation || 0;

            const vRect = viewport.getBoundingClientRect();
            const vW = vRect.width > 0 ? vRect.width : (viewport.clientWidth || 1920);
            const vH = vRect.height > 0 ? vRect.height : (viewport.clientHeight || 1080);

            const boxRect = box.getBoundingClientRect();
            const boxCenterX = boxRect.left + boxRect.width / 2;
            const boxCenterY = boxRect.top + boxRect.height / 2;
            const initialAngle = Math.atan2(startMouseY - boxCenterY, startMouseX - boxCenterX) * (180 / Math.PI);
            const initialDist = Math.hypot(startMouseX - boxCenterX, startMouseY - boxCenterY);

            TIMELINE_HISTORY.begin();
            this.showSafeAreas(true);

            const renderedEl = this.textLayer ? this.textLayer.querySelector(`[data-clip-id="${clip.id}"]`) : null;

            const onMouseMove = (moveEv) => {
                const deltaX = moveEv.clientX - startMouseX;
                const deltaY = moveEv.clientY - startMouseY;

                const cuts = [...STATE.activeTimelineCuts];
                const targetClip = cuts.find(c => String(c.id) === String(clip.id));
                if (!targetClip) return;

                if (!handleType) {
                    // Mover texto com snap magnético
                    const deltaXPct = (deltaX / vW) * 100;
                    const deltaYPct = (deltaY / vH) * 100;
                    let rawX = initialX + deltaXPct;
                    let rawY = initialY + deltaYPct;

                    const snap = this.calculateTextSnap(rawX, rawY, vW, vH);
                    let finalX = snap.x;
                    let finalY = snap.y;

                    this.showSnapGuides(snap.guides);

                    targetClip.posX = finalX;
                    targetClip.posY = finalY;
                    targetClip.x = finalX;
                    targetClip.y = finalY;

                    targetClip.effects = targetClip.effects ? targetClip.effects.map(ef => ({ ...ef })) : [];
                    let localTf = targetClip.effects.find(ef => ef.type === "transform");
                    if (!localTf) {
                        localTf = { type: "transform", scale: initialScale, x: finalX, y: finalY, rotation: initialRot, opacity: tf.opacity };
                        targetClip.effects.push(localTf);
                    } else {
                        localTf.x = finalX;
                        localTf.y = finalY;
                        localTf.posX = finalX;
                        localTf.posY = finalY;
                    }

                    if (hasKeyframes(targetClip, "x") || hasKeyframes(targetClip, "posX")) {
                        addOrUpdateKeyframe(targetClip, "posX", relTimeS, finalX, "linear");
                        addOrUpdateKeyframe(targetClip, "x", relTimeS, finalX, "linear");
                    }
                    if (hasKeyframes(targetClip, "y") || hasKeyframes(targetClip, "posY")) {
                        addOrUpdateKeyframe(targetClip, "posY", relTimeS, finalY, "linear");
                        addOrUpdateKeyframe(targetClip, "y", relTimeS, finalY, "linear");
                    }

                    // Atualiza visual ao vivo sem recriar elementos
                    box.style.left = `calc(50% + ${finalX}%)`;
                    box.style.top = `calc(50% + ${finalY}%)`;
                    if (renderedEl) {
                        renderedEl.style.left = `calc(50% + ${finalX}%)`;
                        renderedEl.style.top = `calc(50% + ${finalY}%)`;
                    }

                } else if (handleType === "rot") {
                    // Rotação
                    const curAngle = Math.atan2(moveEv.clientY - boxCenterY, moveEv.clientX - boxCenterX) * (180 / Math.PI);
                    let angleDiff = curAngle - initialAngle;
                    let newRot = Math.round(initialRot + angleDiff);

                    const snapAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180, 270, 360, -270, -360];
                    for (const sa of snapAngles) {
                        if (Math.abs(newRot - sa) <= 3) {
                            newRot = sa;
                            this.showSnapGuides(["center-x", "center-y"]);
                            break;
                        }
                    }

                    targetClip.rotation = newRot;
                    targetClip.effects = targetClip.effects ? targetClip.effects.map(ef => ({ ...ef })) : [];
                    let localTf = targetClip.effects.find(ef => ef.type === "transform");
                    if (localTf) localTf.rotation = newRot;

                    if (hasKeyframes(targetClip, "rotation")) {
                        addOrUpdateKeyframe(targetClip, "rotation", relTimeS, newRot, "linear");
                    }

                    const curScale = targetClip.scale !== undefined ? targetClip.scale : initialScale;
                    box.style.transform = `translate(-50%, -50%) scale(${curScale}) rotate(${newRot}deg)`;
                    if (renderedEl) {
                        renderedEl.style.transform = `translate(-50%, -50%) scale(${curScale}) rotate(${newRot}deg)`;
                    }

                } else {
                    // Redimensionamento / Escala proporcional a partir do centro
                    const currentDist = Math.hypot(moveEv.clientX - boxCenterX, moveEv.clientY - boxCenterY);
                    if (initialDist > 4) {
                        const ratio = currentDist / initialDist;
                        let newScale = Math.max(0.1, Math.min(5.0, parseFloat((initialScale * ratio).toFixed(3))));

                        if (Math.abs(newScale - 1.0) <= 0.03) {
                            newScale = 1.0;
                            this.showSnapGuides(["center-x", "center-y"]);
                        }

                        targetClip.scale = newScale;
                        targetClip.effects = targetClip.effects ? targetClip.effects.map(ef => ({ ...ef })) : [];
                        let localTf = targetClip.effects.find(ef => ef.type === "transform");
                        if (localTf) localTf.scale = newScale;

                        if (hasKeyframes(targetClip, "scale")) {
                            addOrUpdateKeyframe(targetClip, "scale", relTimeS, newScale, "linear");
                        }

                        const curRot = targetClip.rotation !== undefined ? targetClip.rotation : initialRot;
                        box.style.transform = `translate(-50%, -50%) scale(${newScale}) rotate(${curRot}deg)`;
                        if (renderedEl) {
                            renderedEl.style.transform = `translate(-50%, -50%) scale(${newScale}) rotate(${curRot}deg)`;
                        }
                    }
                }

                STATE.activeTimelineCuts = cuts;
            };

            const onMouseUp = () => {
                this.isDragging = false;
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                this.showSafeAreas(false);
                this.hideSnapGuides();
                TIMELINE_HISTORY.commit();
                STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
                this.sync();

                const interaction = window.timelineInteraction || window.panelsManager?.timelineInteraction;
                if (interaction && typeof interaction.refreshClipInspector === "function") {
                    interaction.refreshClipInspector();
                }
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };

        box.addEventListener("mousedown", onMouseDown);
        box._startDrag = onMouseDown;
        this._dragCleanup = () => box.removeEventListener("mousedown", onMouseDown);
    }

    calculateTextSnap(rawX, rawY, vW = 1920, vH = 1080) {
        const tolX = 1.8;
        const tolY = 1.8;
        const activeGuides = [];
        let snappedX = rawX;
        let snappedY = rawY;

        if (Math.abs(rawX) <= tolX) {
            snappedX = 0;
            activeGuides.push("center-x");
        }

        if (Math.abs(rawY) <= tolY) {
            snappedY = 0;
            activeGuides.push("center-y");
        } else if (Math.abs(rawY - 32) <= tolY) {
            snappedY = 32;
            activeGuides.push("title-safe-bottom");
        } else if (Math.abs(rawY - 40) <= tolY) {
            snappedY = 40;
            activeGuides.push("action-safe-bottom");
        } else if (Math.abs(rawY - (-32)) <= tolY) {
            snappedY = -32;
            activeGuides.push("title-safe-top");
        }

        return { x: snappedX, y: snappedY, guides: activeGuides };
    }

    showSafeAreas(show) {
        const el = this.el("program-safe-areas");
        if (el) {
            el.style.display = show ? "block" : "none";
        }
    }

    showSnapGuides(guides = []) {
        const container = this.el("program-snap-guides");
        if (!container) return;

        container.querySelectorAll(".snap-guide-line").forEach(line => {
            const g = line.dataset.guide;
            if (guides.includes(g)) {
                line.classList.add("snap-active");
            } else {
                line.classList.remove("snap-active");
            }
        });
    }

    hideSnapGuides() {
        const container = this.el("program-snap-guides");
        if (!container) return;
        container.querySelectorAll(".snap-guide-line").forEach(line => {
            line.classList.remove("snap-active");
        });
    }

    startInlineEdit(clip, textElement, relTimeS) {
        if (this.isInlineEditing) return;
        this.isInlineEditing = true;

        if (this.interactiveLayer) {
            this.interactiveLayer.innerHTML = "";
            this.interactiveLayer.style.pointerEvents = "none";
        }

        const rect = textElement.getBoundingClientRect();
        const viewport = this.el("program-player-viewport");
        if (!viewport) return;

        const inputContainer = document.createElement("div");
        inputContainer.className = "text-inline-editor-container";
        inputContainer.style.position = "absolute";
        inputContainer.style.left = `${textElement.style.left}`;
        inputContainer.style.top = `${textElement.style.top}`;
        inputContainer.style.transform = textElement.style.transform;
        inputContainer.style.transformOrigin = "center center";
        inputContainer.style.zIndex = "80";
        inputContainer.style.minWidth = `${Math.max(160, rect.width)}px`;
        inputContainer.style.display = "flex";
        inputContainer.style.flexDirection = "column";
        inputContainer.style.gap = "4px";

        const textarea = document.createElement("textarea");
        textarea.className = "text-inline-editor-main";
        textarea.value = clip.text || "";
        textarea.rows = Math.max(1, (clip.text || "").split("\n").length);
        textarea.style.width = "100%";
        textarea.style.background = "rgba(10, 8, 16, 0.9)";
        textarea.style.border = "1.5px solid var(--color-cyan)";
        textarea.style.borderRadius = "4px";
        textarea.style.padding = "6px 10px";
        textarea.style.fontFamily = textElement.style.fontFamily;
        textarea.style.fontSize = textElement.style.fontSize;
        textarea.style.color = "#ffffff";
        textarea.style.textAlign = textElement.style.textAlign;
        textarea.style.outline = "none";
        textarea.style.resize = "none";
        textarea.style.boxShadow = "0 8px 30px rgba(0,0,0,0.8), 0 0 15px rgba(6,182,212,0.5)";

        inputContainer.appendChild(textarea);

        let subInput = null;
        if (clip.textCategory === "lower_third" || clip.subtext !== undefined) {
            subInput = document.createElement("input");
            subInput.type = "text";
            subInput.className = "text-inline-editor-sub";
            subInput.value = clip.subtext || "";
            subInput.placeholder = "Subtexto / Cargo...";
            subInput.style.width = "100%";
            subInput.style.background = "rgba(10, 8, 16, 0.9)";
            subInput.style.border = "1px solid rgba(255,255,255,0.2)";
            subInput.style.borderRadius = "4px";
            subInput.style.padding = "4px 8px";
            subInput.style.fontSize = `${Math.max(12, Math.round(parseFloat(textElement.style.fontSize) * 0.6))}px`;
            subInput.style.color = "#e2e8f0";
            subInput.style.textAlign = textElement.style.textAlign;
            subInput.style.outline = "none";
            inputContainer.appendChild(subInput);
        }

        viewport.appendChild(inputContainer);
        textarea.focus();
        textarea.select();

        const commitChanges = () => {
            if (!this.isInlineEditing) return;
            this.isInlineEditing = false;

            const cuts = [...STATE.activeTimelineCuts];
            const targetClip = cuts.find(c => String(c.id) === String(clip.id));
            if (targetClip) {
                targetClip.text = textarea.value;
                if (subInput) {
                    targetClip.subtext = subInput.value;
                }
                STATE.activeTimelineCuts = cuts;
                STATE.emit("timelineCutsUpdated", cuts);
            }

            if (inputContainer.parentNode) {
                inputContainer.parentNode.removeChild(inputContainer);
            }
            this.sync();
        };

        const cancelChanges = () => {
            if (!this.isInlineEditing) return;
            this.isInlineEditing = false;
            if (inputContainer.parentNode) {
                inputContainer.parentNode.removeChild(inputContainer);
            }
            this.sync();
        };

        textarea.onkeydown = (e) => {
            if (e.key === "Escape") {
                cancelChanges();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !subInput)) {
                e.preventDefault();
                commitChanges();
            }
        };

        if (subInput) {
            subInput.onkeydown = (e) => {
                if (e.key === "Escape") {
                    cancelChanges();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitChanges();
                }
            };
        }

        const handleOutsideClick = (e) => {
            if (!inputContainer.contains(e.target)) {
                document.removeEventListener("mousedown", handleOutsideClick);
                commitChanges();
            }
        };

        setTimeout(() => {
            document.addEventListener("mousedown", handleOutsideClick);
        }, 100);
    }
}
