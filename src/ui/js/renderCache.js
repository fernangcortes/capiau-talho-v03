// src/ui/js/renderCache.js
// Sistema de Render Cache NLE (Linha Vermelha / Amarela / Verde e Pré-renderização de Frames)
// Padrão clássico NLE (Adobe Premiere Pro, DaVinci Resolve, Final Cut Pro)
// Pré-computa trechos pesados (camadas de ajuste com filtros CSS cumulativos, transformações
// e composições multipista) para garantir playback a 60fps sem engasgos ou perda de quadros.

import { STATE } from "./state.js";
import { TIMELINE_STATE } from "./timelineState.js";

export class RenderCacheManager {
    constructor() {
        this._frames = new Map(); // frame -> ImageBitmap | HTMLCanvasElement | Object
        this._isRendering = false;
        this._cancelRequested = false;
        this._renderProgress = null;
        this._listenersAttached = false;
        this._canvas = null; // Canvas offscreen reutilizável

        this.initAutoInvalidation();
    }

    initAutoInvalidation() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        if (typeof STATE !== "undefined" && typeof STATE.on === "function") {
            STATE.on("timelineCutsChanged", () => this.invalidateAll());
            STATE.on("timelineTransitionsChanged", () => this.invalidateAll());
            STATE.on("timelineTracksChanged", () => this.invalidateAll());
        }
    }

    /**
     * Verifica se um frame da timeline contém efeitos pesados que demandam renderização prévia.
     * Retorna true se houver camada de ajuste, transição de junção, composição multipista
     * simultânea ou filtros CSS complexos (blur, color grading, crop, transform).
     *
     * @param {number} frame - Frame da timeline
     * @returns {boolean}
     */
    isFrameHeavy(frame) {
        const cuts = (STATE && STATE.activeTimelineCuts) || [];
        const fps = (TIMELINE_STATE && TIMELINE_STATE.fps) || 24;

        // 1. Camadas de ajuste ativas acima de pistas
        const hasAdjustment = cuts.some(c => {
            if (!c || c.kind !== "adjustment" || c.disabled) return false;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
            const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
            return frame >= start && frame < start + dur;
        });
        if (hasAdjustment) return true;

        // 2. Transições de vídeo ativas na junção de clipes
        const transitions = (TIMELINE_STATE && TIMELINE_STATE.transitions) || [];
        const hasTransition = transitions.some(t => {
            if (!t || t.disabled) return false;
            const isVideo = t.kind === "video" || (t.type && (t.type.startsWith("video_") || t.type === "cross_dissolve"));
            if (!isVideo) return false;
            const halfA = t.halfAFrames !== undefined ? t.halfAFrames : Math.floor((t.durationFrames || 24) / 2);
            const halfB = t.halfBFrames !== undefined ? t.halfBFrames : Math.ceil((t.durationFrames || 24) / 2);
            return frame >= (t.cutFrame - halfA) && frame < (t.cutFrame + halfB);
        });
        if (hasTransition) return true;

        // 3. Clipes de vídeo/foto/matte cobrindo o frame
        const activeCuts = cuts.filter(c => {
            if (!c || c.disabled || c.kind === "adjustment") return false;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
            const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
            return frame >= start && frame < start + dur;
        });

        // Mais de uma camada de vídeo ativa ao mesmo tempo (composição multipista)
        if (activeCuts.length > 1) return true;

        // 4. Clipes individuais com efeitos pesados (blur, transform, crop, grading)
        return activeCuts.some(c => this._isHeavyCut(c));
    }

    /**
     * Diz se um clipe, sozinho, carrega efeito pesado (blur, transform, crop, grading).
     * Não depende do frame: efeitos aqui são estáticos por clipe.
     *
     * @param {Object} c - Corte da timeline
     * @returns {boolean}
     */
    _isHeavyCut(c) {
        const effects = Array.isArray(c.effects) ? c.effects : [];
        for (const eff of effects) {
            if (!eff || eff.disabled) continue;
            if (eff.type === "color") {
                if ((eff.blur && eff.blur > 0) ||
                    (eff.brightness !== undefined && eff.brightness !== 0) ||
                    (eff.contrast !== undefined && eff.contrast !== 0) ||
                    (eff.saturation !== undefined && eff.saturation !== 100) ||
                    (eff.hue && eff.hue !== 0) ||
                    (eff.sepia && eff.sepia > 0) ||
                    (eff.grayscale && eff.grayscale > 0)) {
                    return true;
                }
            } else if (eff.type === "crop") {
                if ((eff.top && eff.top > 0) || (eff.bottom && eff.bottom > 0) ||
                    (eff.left && eff.left > 0) || (eff.right && eff.right > 0)) {
                    return true;
                }
            } else if (eff.type === "transform") {
                if ((eff.rotation && eff.rotation !== 0) ||
                    (eff.scale !== undefined && eff.scale !== 1.0) ||
                    (eff.opacity !== undefined && eff.opacity < 1.0) ||
                    (eff.x && eff.x !== 0) || (eff.y && eff.y !== 0)) {
                    return true;
                }
            }
        }

        // Transform direto no clipe (propriedades de motion)
        return !!(c.rotation || (c.scale !== undefined && c.scale !== 1) || (c.opacity !== undefined && c.opacity < 1));
    }

    /**
     * Retorna o status de render de um frame específico:
     * - "cached": verde (renderizado e em cache)
     * - "unrendered": vermelho (efeito pesado necessitando render)
     * - "realtime": amarelo (tempo real simples, sem efeitos pesados)
     * - "empty": transparente / vazio (sem cortes)
     *
     * @param {number} frame - Frame da timeline
     * @returns {"cached"|"unrendered"|"realtime"|"empty"}
     */
    getFrameStatus(frame) {
        if (this._frames.has(frame)) {
            return "cached";
        }

        const cuts = (STATE && STATE.activeTimelineCuts) || [];
        const fps = (TIMELINE_STATE && TIMELINE_STATE.fps) || 24;
        const hasAnyCut = cuts.some(c => {
            if (!c || c.disabled) return false;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
            const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
            return frame >= start && frame < start + dur;
        });

        if (!hasAnyCut) return "empty";

        if (this.isFrameHeavy(frame)) {
            return "unrendered";
        }

        return "realtime";
    }

    /**
     * Devolve a lista de segmentos contíguos de status para a régua da timeline,
     * agrupando frames contínuos para renderização em blocos no canvas de alta velocidade.
     *
     * @param {number} startFrame
     * @param {number} endFrame
     * @returns {Array<{ startFrame: number, endFrame: number, status: string, color: string }>}
     */
    getSegments(startFrame, endFrame) {
        const sF = Math.max(0, Math.floor(startFrame));
        const eF = Math.max(sF, Math.ceil(endFrame));
        if (sF >= eF) return [];

        const statusColors = {
            cached: "#10b981",     // Verde NLE (Renderizado)
            unrendered: "#ef4444", // Vermelho NLE (Precisa renderizar)
            realtime: "#eab308",   // Amarelo NLE (Tempo real limítrofe)
            empty: null
        };

        // Mesmo resultado de chamar getFrameStatus frame a frame, mas varrendo só as bordas
        // onde o status pode mudar (início/fim de corte, transição ou trecho em cache).
        // Frame a frame, o custo era frames visíveis × cortes a cada redesenho da régua:
        // com zoom afastado (até 100 frames por pixel) isso travava a timeline inteira.
        const cuts = (STATE && STATE.activeTimelineCuts) || [];
        const fps = (TIMELINE_STATE && TIMELINE_STATE.fps) || 24;
        const transitions = (TIMELINE_STATE && TIMELINE_STATE.transitions) || [];
        const limit = eF + 1; // o intervalo pedido inclui eF

        const marks = new Map(); // frame -> variação dos contadores naquele ponto
        const mark = (frame, field, delta) => {
            let m = marks.get(frame);
            if (!m) {
                m = { any: 0, media: 0, heavy: 0, adjustment: 0, transition: 0, cached: 0 };
                marks.set(frame, m);
            }
            m[field] += delta;
        };
        // Frames inteiros f com start <= f < end formam [ceil(start), ceil(end))
        const cover = (start, end, fields) => {
            const a = Math.max(sF, Math.ceil(start));
            const b = Math.min(limit, Math.ceil(end));
            if (!(b > a)) return;
            for (const field of fields) {
                mark(a, field, 1);
                mark(b, field, -1);
            }
        };
        mark(sF, "any", 0);
        mark(limit, "any", 0);

        for (const c of cuts) {
            if (!c || c.disabled) continue;
            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
            const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
            const fields = ["any"];
            if (c.kind === "adjustment") {
                fields.push("adjustment");
            } else {
                fields.push("media");
                if (this._isHeavyCut(c)) fields.push("heavy");
            }
            cover(start, start + dur, fields);
        }

        for (const t of transitions) {
            if (!t || t.disabled) continue;
            const isVideo = t.kind === "video" || (t.type && (t.type.startsWith("video_") || t.type === "cross_dissolve"));
            if (!isVideo) continue;
            const halfA = t.halfAFrames !== undefined ? t.halfAFrames : Math.floor((t.durationFrames || 24) / 2);
            const halfB = t.halfBFrames !== undefined ? t.halfBFrames : Math.ceil((t.durationFrames || 24) / 2);
            cover(t.cutFrame - halfA, t.cutFrame + halfB, ["transition"]);
        }

        const cachedFrames = [];
        for (const f of this._frames.keys()) {
            if (Number.isInteger(f) && f >= sF && f < limit) cachedFrames.push(f);
        }
        cachedFrames.sort((a, b) => a - b);
        for (let i = 0; i < cachedFrames.length;) {
            let j = i;
            while (j + 1 < cachedFrames.length && cachedFrames[j + 1] === cachedFrames[j] + 1) j++;
            cover(cachedFrames[i], cachedFrames[j] + 1, ["cached"]);
            i = j + 1;
        }

        const points = [...marks.keys()].sort((a, b) => a - b);
        const active = { any: 0, media: 0, heavy: 0, adjustment: 0, transition: 0, cached: 0 };
        const segments = [];
        let currentSeg = null;

        for (let i = 0; i < points.length - 1; i++) {
            const m = marks.get(points[i]);
            for (const field in m) active[field] += m[field];

            let status;
            if (active.cached > 0) status = "cached";
            else if (active.any === 0) status = "empty";
            else if (active.adjustment > 0 || active.transition > 0 || active.media > 1 || active.heavy > 0) status = "unrendered";
            else status = "realtime";

            if (currentSeg && currentSeg.status === status) {
                currentSeg.endFrame = points[i + 1];
            } else {
                if (currentSeg) segments.push(currentSeg);
                currentSeg = { startFrame: points[i], endFrame: points[i + 1], status, color: statusColors[status] };
            }
        }

        if (currentSeg) {
            segments.push(currentSeg);
        }

        return segments.filter(s => s.status !== "empty");
    }

    hasFrame(frame) {
        return this._frames.has(frame);
    }

    getFrame(frame) {
        return this._frames.get(frame);
    }

    setFrame(frame, data) {
        const existing = this._frames.get(frame);
        if (existing && existing !== data && typeof existing.close === "function") {
            try { existing.close(); } catch (_) {}
        }
        this._frames.set(frame, data);
    }

    invalidateRange(startFrame, endFrame) {
        const s = Math.min(startFrame, endFrame);
        const e = Math.max(startFrame, endFrame);
        const sF = Math.floor(s);
        const eF = Math.ceil(e);
        for (let f = sF; f <= eF; f++) {
            const item = this._frames.get(f);
            if (item && typeof item.close === "function") {
                try { item.close(); } catch (_) {}
            }
            this._frames.delete(f);
        }
        this._notifyChanged();
    }

    invalidateAll() {
        for (const item of this._frames.values()) {
            if (item && typeof item.close === "function") {
                try { item.close(); } catch (_) {}
            }
        }
        this._frames.clear();
        this._notifyChanged();
    }

    _notifyChanged() {
        if (typeof STATE !== "undefined" && typeof STATE.emit === "function") {
            STATE.emit("timelineRenderCacheChanged", { count: this._frames.size });
        }
        if (window.TIMELINE_RENDERER && typeof window.TIMELINE_RENDERER.requestRedraw === "function") {
            window.TIMELINE_RENDERER.requestRedraw();
        }
    }

    cancelRender() {
        this._cancelRequested = true;
        this._isRendering = false;
        if (typeof window.showToast === "function") {
            window.showToast("Renderização de cache cancelada.", "info");
        }
    }

    /**
     * Composita um frame da timeline sobre um canvas offscreen e armazena na memória GPU/RAM.
     *
     * @param {number} frame - Frame da timeline
     * @param {HTMLCanvasElement|Object} offscreenCanvas - Canvas de destino
     * @returns {Promise<ImageBitmap|HTMLCanvasElement>}
     */
    async compositeFrame(frame, offscreenCanvas) {
        const width = (TIMELINE_STATE && TIMELINE_STATE.width) || offscreenCanvas.width || 1920;
        const height = (TIMELINE_STATE && TIMELINE_STATE.height) || offscreenCanvas.height || 1080;
        if (offscreenCanvas.width !== width) offscreenCanvas.width = width;
        if (offscreenCanvas.height !== height) offscreenCanvas.height = height;
        const ctx = offscreenCanvas.getContext ? offscreenCanvas.getContext("2d") : null;

        if (ctx) {
            ctx.save();
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, width, height);

            const cuts = (STATE && STATE.activeTimelineCuts) || [];
            const fps = (TIMELINE_STATE && TIMELINE_STATE.fps) || 24;
            const transitions = (TIMELINE_STATE && TIMELINE_STATE.transitions) || [];

            // Helper para renderizar um corte individual
            const drawCut = async (cut, opacity = 1.0) => {
                if (!cut) return;
                if (cut.kind === "color_matte" || cut.type === "color_matte") {
                    ctx.save();
                    let fadeOp = 1.0;
                    if (TIMELINE_STATE && typeof TIMELINE_STATE.computeClipFadeFactor === "function") {
                        fadeOp = TIMELINE_STATE.computeClipFadeFactor(cut, frame, fps);
                    } else if (typeof computeClipFadeFactor === "function") {
                        fadeOp = computeClipFadeFactor(cut, frame, fps);
                    }
                    const effects = Array.isArray(cut.effects) ? cut.effects : [];
                    const tf = effects.find(e => e && e.type === "transform" && !e.disabled) || {};
                    const tfOp = (typeof tf.opacity === "number")
                        ? Math.max(0, Math.min(1, tf.opacity))
                        : ((typeof cut.opacity === "number") ? Math.max(0, Math.min(1, cut.opacity)) : 1.0);
                    ctx.globalAlpha = Math.max(0, Math.min(1, opacity * fadeOp * tfOp));
                    const blendMode = (cut.blend_mode || cut.blendMode || tf.blend_mode || tf.blendMode || "normal").toLowerCase();
                    if (blendMode && blendMode !== "normal") {
                        ctx.globalCompositeOperation = blendMode;
                    }
                    ctx.fillStyle = cut.color || "#000000";
                    ctx.fillRect(0, 0, width, height);
                    ctx.restore();
                } else if (cut.kind === "photo" || cut.type === "photo") {
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
                    if (window.player && window.player.programPlayer) {
                        const prog = window.player.programPlayer;
                        const imgA = prog.el ? prog.el("program-player-photo") : (typeof document !== "undefined" ? document.getElementById("program-player-photo") : null);
                        const imgB = prog.el ? prog.el("program-player-photo-b") : (typeof document !== "undefined" ? document.getElementById("program-player-photo-b") : null);
                        const src = cut.src || cut.filepath;
                        const imgEl = (imgA && (imgA.dataset?.activeClipId === String(cut.id) || (imgA.src && src && imgA.src.includes(src)))) ? imgA :
                                      ((imgB && (imgB.dataset?.activeClipId === String(cut.id) || (imgB.src && src && imgB.src.includes(src)))) ? imgB : (imgA || imgB));
                        if (imgEl && (imgEl.naturalWidth > 0 || imgEl.width > 0)) {
                            try { ctx.drawImage(imgEl, 0, 0, width, height); } catch (_) {}
                        }
                    }
                    ctx.restore();
                } else {
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
                    if (window.player && window.player.programPlayer) {
                        const prog = window.player.programPlayer;
                        const pool = prog._videoPool ? prog._videoPool() : [];
                        const vidEl = pool.find(el => el.dataset.activeClipId === String(cut.id) || el.dataset.loadedSrc === (cut.src || cut.filepath));
                        if (vidEl) {
                            const targetSec = prog._targetSecondsFor
                                ? prog._targetSecondsFor(cut, frame)
                                : ((cut.in || 0) + ((frame - (cut.timelineStartFrame || 0)) / fps));
                            if (typeof vidEl.addEventListener === "function" && Math.abs((vidEl.currentTime || 0) - targetSec) > 0.02) {
                                await new Promise(resolve => {
                                    let done = false;
                                    const onSeeked = () => {
                                        if (done) return;
                                        done = true;
                                        vidEl.removeEventListener("seeked", onSeeked);
                                        resolve();
                                    };
                                    vidEl.addEventListener("seeked", onSeeked);
                                    try {
                                        vidEl.currentTime = Math.max(0, targetSec);
                                    } catch (_) {
                                        onSeeked();
                                    }
                                    setTimeout(onSeeked, 60);
                                });
                            }
                            if (vidEl.readyState >= 1 || vidEl.videoWidth > 0 || vidEl.width > 0) {
                                try {
                                    ctx.drawImage(vidEl, 0, 0, width, height);
                                } catch (_) {}
                            }
                        }
                    }
                    ctx.restore();
                }
            };

            // Pistas de baixo para cima
            const videoTracks = (TIMELINE_STATE && typeof TIMELINE_STATE.getVideoTracks === "function")
                ? [...TIMELINE_STATE.getVideoTracks()].reverse().filter(t => !TIMELINE_STATE.muteHiddenTracksPlayback || !t.hidden)
                : [];

            if (videoTracks.length > 0) {
                for (const tr of videoTracks) {
                    const activeTr = transitions.find(t => {
                        if (!t || t.disabled || t.track !== tr.id) return false;
                        const isVideo = t.kind === "video" || (t.type && (t.type.startsWith("video_") || t.type === "cross_dissolve"));
                        if (!isVideo) return false;
                        const halfA = t.halfAFrames !== undefined ? t.halfAFrames : Math.floor((t.durationFrames || 24) / 2);
                        const halfB = t.halfBFrames !== undefined ? t.halfBFrames : Math.ceil((t.durationFrames || 24) / 2);
                        return frame >= (t.cutFrame - halfA) && frame < (t.cutFrame + halfB);
                    });

                    if (activeTr) {
                        const cA = cuts.find(c => c.id === activeTr.clipAId && !c.disabled && c.kind !== "adjustment");
                        const cB = cuts.find(c => c.id === activeTr.clipBId && !c.disabled && c.kind !== "adjustment");
                        if (cA && cB) {
                            const halfA = activeTr.halfAFrames !== undefined ? activeTr.halfAFrames : Math.floor((activeTr.durationFrames || 24) / 2);
                            const halfB = activeTr.halfBFrames !== undefined ? activeTr.halfBFrames : Math.ceil((activeTr.durationFrames || 24) / 2);
                            const tStart = activeTr.cutFrame - halfA;
                            const tEnd = activeTr.cutFrame + halfB;
                            const span = Math.max(1, tEnd - tStart);
                            const progress = Math.max(0.0, Math.min(1.0, (frame - tStart) / span));

                            const trType = activeTr.type || "video_cross_dissolve";
                            if (trType === "video_dip_black") {
                                const opA = progress <= 0.5 ? 1.0 - (2.0 * progress) : 0.0;
                                const opB = progress > 0.5 ? 2.0 * (progress - 0.5) : 0.0;
                                if (opA > 0) await drawCut(cA, opA);
                                if (opB > 0) await drawCut(cB, opB);
                            } else if (trType === "video_dip_white") {
                                const opA = progress <= 0.5 ? 1.0 : 0.0;
                                const opB = progress > 0.5 ? 1.0 : 0.0;
                                if (opA > 0) await drawCut(cA, opA);
                                if (opB > 0) await drawCut(cB, opB);
                                const whiteOp = 1.0 - 2.0 * Math.abs(progress - 0.5);
                                if (whiteOp > 0) {
                                    ctx.save();
                                    ctx.fillStyle = "#ffffff";
                                    ctx.globalAlpha = Math.max(0, Math.min(1, whiteOp));
                                    ctx.fillRect(0, 0, width, height);
                                    ctx.restore();
                                }
                            } else {
                                // video_cross_dissolve / padrão:
                                // Clipe A permanece com opacidade sólida 1.0 por baixo, Clipe B sobe suavemente por cima
                                await drawCut(cA, 1.0);
                                await drawCut(cB, progress);
                            }
                            continue;
                        }
                    }

                    // Sem transição ativa na pista: desenha o corte ativo se houver
                    const cut = cuts.find(c => {
                        if (!c || c.disabled || c.kind === "adjustment" || c.track !== tr.id) return false;
                        const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                        const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
                        return frame >= start && frame < start + dur;
                    });
                    if (cut) {
                        await drawCut(cut, 1.0);
                    }
                }
            } else {
                // Fallback caso tracks não estejam explicitadas no estado
                const activeCuts = cuts.filter(c => {
                    if (!c || c.disabled || c.kind === "adjustment") return false;
                    const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                    const dur = (c.outFrame !== undefined ? c.outFrame : 0) - (c.inFrame !== undefined ? c.inFrame : 0);
                    return frame >= start && frame < start + dur;
                });
                for (const cut of activeCuts) {
                    await drawCut(cut, 1.0);
                }
            }

            // Aplica camadas de ajuste cumulativas
            if (TIMELINE_STATE && typeof TIMELINE_STATE.getCumulativeAdjustmentEffects === "function") {
                const adjEffects = TIMELINE_STATE.getCumulativeAdjustmentEffects("V0", frame);
                if (adjEffects && adjEffects.length > 0) {
                    const activeAdj = (cuts || []).find(c => c && c.kind === "adjustment" && !c.disabled);
                    const bm = activeAdj?.blend_mode || activeAdj?.blendMode || "normal";
                    if (bm && bm !== "normal") {
                        ctx.save();
                        ctx.globalCompositeOperation = bm;
                        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
                        ctx.fillRect(0, 0, width, height);
                        ctx.restore();
                    } else {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
                        ctx.fillRect(0, 0, width, height);
                    }
                }
            }

            ctx.restore();
        }

        // Se suportado nativamente no navegador, converte para ImageBitmap de GPU ultra-rápido
        if (typeof globalThis.createImageBitmap === "function") {
            try {
                return await globalThis.createImageBitmap(offscreenCanvas);
            } catch (_) {}
        }
        if (typeof document !== "undefined" && typeof document.createElement === "function") {
            const clone = document.createElement("canvas");
            clone.width = width;
            clone.height = height;
            const cCtx = clone.getContext ? clone.getContext("2d") : null;
            if (cCtx && typeof cCtx.drawImage === "function") {
                try { cCtx.drawImage(offscreenCanvas, 0, 0); } catch (_) {}
            }
            return clone;
        }
        return offscreenCanvas;
    }

    /**
     * Executa a pré-renderização de um intervalo de frames da timeline.
     *
     * @param {number} startFrame - Frame inicial
     * @param {number} endFrame - Frame final
     * @param {Object} [options] - Opções de renderização
     * @returns {Promise<{ rendered: number, startFrame: number, endFrame: number, cancelled: boolean }>}
     */
    async renderRange(startFrame, endFrame, options = {}) {
        if (this._isRendering) return { rendered: 0, cancelled: true };
        this._isRendering = true;
        this._cancelRequested = false;

        const sF = Math.max(0, Math.floor(startFrame));
        const eF = Math.max(sF, Math.ceil(endFrame));
        const total = Math.max(1, eF - sF + 1);

        const targetWidth = (TIMELINE_STATE && TIMELINE_STATE.width) || options.width || 1920;
        const targetHeight = (TIMELINE_STATE && TIMELINE_STATE.height) || options.height || 1080;

        if (!this._canvas) {
            if (typeof document !== "undefined" && typeof document.createElement === "function") {
                this._canvas = document.createElement("canvas");
                this._canvas.width = targetWidth;
                this._canvas.height = targetHeight;
            } else {
                this._canvas = { width: targetWidth, height: targetHeight, getContext: () => null };
            }
        } else {
            this._canvas.width = targetWidth;
            this._canvas.height = targetHeight;
        }

        let renderedCount = 0;
        const chunkSize = options.chunkSize || 5;

        for (let f = sF; f <= eF; f++) {
            if (this._cancelRequested) {
                break;
            }

            const frameData = await this.compositeFrame(f, this._canvas);
            this.setFrame(f, frameData);
            renderedCount++;

            // Emite progresso
            const percent = Math.min(100, Math.round(((f - sF + 1) / total) * 100));
            this._renderProgress = { currentFrame: f, startFrame: sF, endFrame: eF, percent };

            if (typeof STATE !== "undefined" && typeof STATE.emit === "function") {
                STATE.emit("renderCacheProgress", this._renderProgress);
            }

            // Cede a CPU periodicamente para manter a UI responsiva e animar a barra verde
            if (renderedCount % chunkSize === 0) {
                if (window.TIMELINE_RENDERER && typeof window.TIMELINE_RENDERER.requestRedraw === "function") {
                    window.TIMELINE_RENDERER.requestRedraw();
                }
                await new Promise(r => setTimeout(r, 0));
            }
        }

        const wasCancelled = this._cancelRequested;
        this._isRendering = false;
        this._cancelRequested = false;
        this._notifyChanged();

        if (!wasCancelled && typeof window.showToast === "function") {
            window.showToast(`Pré-renderização concluída! ${renderedCount} quadros em cache.`, "success");
        }

        return {
            rendered: renderedCount,
            startFrame: sF,
            endFrame: eF,
            cancelled: wasCancelled
        };
    }

    /**
     * Renderiza o trecho demarcado entre IN e OUT (ou a sequência inteira se não houver marcadores).
     * Disparado pelo comando clássico NLE ou pelo atalho Enter.
     */
    async renderInOut(options = {}) {
        let startFrame = 0;
        let endFrame = 0;

        if (TIMELINE_STATE) {
            const inF = TIMELINE_STATE.inFrame;
            const outF = TIMELINE_STATE.outFrame;
            if (inF !== null && outF !== null && outF > inF) {
                startFrame = inF;
                endFrame = outF;
            } else if (typeof TIMELINE_STATE.getDurationFrames === "function") {
                endFrame = TIMELINE_STATE.getDurationFrames();
            } else {
                endFrame = 240; // Fallback 10s
            }
        }

        return await this.renderRange(startFrame, endFrame, options);
    }
}

export const RENDER_CACHE_MANAGER = new RenderCacheManager();
if (typeof window !== "undefined") {
    window.RENDER_CACHE_MANAGER = RENDER_CACHE_MANAGER;
}
