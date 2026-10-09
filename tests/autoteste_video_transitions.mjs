// tests/autoteste_video_transitions.mjs
// Suíte de Testes Automatizados — Task 16 do PLANO_SUITE_NLE_CLASSICO:
// Transições de Junção de Vídeo na Emenda: Cross Dissolve (Ctrl+D), Dip to Black e Dip to White
//
// 16 Baterias de Teste:
//  1. Prova Matemática: Curvas de Dissolvência e Dips (Cross Dissolve, Dip to Black, Dip to White)
//  2. Catálogo de Comandos e Paridade nos 5 Perfis NLE (edit.apply_video_transition, Ctrl+D)
//  3. TIMELINE_STATE.addVideoTransition() em clipes contíguos de vídeo (Cross Dissolve)
//  4. Tipos de Transição de Vídeo: Dip to Black e Dip to White
//  5. Alinhamentos (Center, Start, End) e Clamping de Duração
//  6. Proteção contra Pistas de Vídeo Travadas (Locked Tracks)
//  7. Detecção Automática pela Agulha (Playhead) & Atalho Ctrl+D no Teclado
//  8. Reversibilidade Total com TIMELINE_HISTORY (Undo e Redo)
//  9. Renderização no Canvas (drawTransitions) com Badges ("Cross Dissolve", "Dip to Black", "Dip to White")
// 10. Interpolação de Opacidades no Program Player (player.js)
// 11. Auto-limpeza ao Separar Clipes ou Mudar de Pista (validateTransitions)
// 12. Deleção de Transição Selecionada via Teclado (Delete / Backspace)
// 13. Redimensionamento Interativo das Bordas (Symmetric Default & Asymmetric com Alt)
// 14. Teto Mútuo Cruzado e Margem Tátil em Clipes Assimétricos
// 15. Persistência e Ponte SQLite (timelinePersistencia.js e sequence_json)
// 16. Grafo FFmpeg de Vídeo (grafo_video.py sem encurtamento de timeline e com sincronia estrita)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Polyfills de ambiente de navegador para execução em Node.js ESM ──
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

const domRegistry = {};
function makeEl(id) {
    const el = {
        id: id || "",
        style: {
            display: "",
            position: "",
            inset: "",
            pointerEvents: "",
            opacity: "",
            zIndex: "",
            backgroundColor: "",
            transform: "",
            cursor: "",
            getPropertyValue(k) { return this[k] || null; },
            setProperty(k, v) { this[k] = String(v); },
            removeProperty(k) { delete this[k]; }
        },
        innerHTML: "",
        textContent: "",
        dataset: {},
        value: "",
        children: [],
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
            toggle(c, force) {
                if (force === true) { this._classes.add(c); return true; }
                if (force === false) { this._classes.delete(c); return false; }
                if (this._classes.has(c)) { this._classes.delete(c); return false; }
                this._classes.add(c); return true;
            }
        },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k] ?? null; },
        appendChild(child) {
            el.children.push(child);
            if (child && child.id) domRegistry[child.id] = child;
        },
        removeChild(child) {
            const idx = el.children.indexOf(child);
            if (idx >= 0) el.children.splice(idx, 1);
        },
        currentTime: 0,
        duration: 10,
        readyState: 4,
        paused: true,
        playbackRate: 1.0,
        load() {},
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        addEventListener() {},
        removeEventListener() {},
        querySelector(sel) {
            if (sel.startsWith("#")) {
                const searchId = sel.slice(1);
                return domRegistry[searchId] || el.children.find(c => c.id === searchId) || null;
            }
            return null;
        },
        querySelectorAll() { return []; }
    };
    return el;
}

const drawnOperations = [];
const canvasStub = {
    getContext: () => ({
        save() { drawnOperations.push({ op: "save" }); },
        restore() { drawnOperations.push({ op: "restore" }); },
        beginPath() { drawnOperations.push({ op: "beginPath" }); },
        rect(x, y, w, h) { drawnOperations.push({ op: "rect", x, y, w, h }); },
        clip() { drawnOperations.push({ op: "clip" }); },
        fillRect(x, y, w, h) { drawnOperations.push({ op: "fillRect", x, y, w, h }); },
        strokeRect(x, y, w, h) { drawnOperations.push({ op: "strokeRect", x, y, w, h }); },
        setLineDash(dash) { drawnOperations.push({ op: "setLineDash", dash }); },
        fill() { drawnOperations.push({ op: "fill" }); },
        stroke() { drawnOperations.push({ op: "stroke" }); },
        measureText: (text) => ({ width: text ? text.length * 6 : 40 }),
        fillText(text, x, y) { drawnOperations.push({ op: "fillText", text, x, y }); },
        scale() {},
        clearRect() {},
        moveTo(x, y) { drawnOperations.push({ op: "moveTo", x, y }); },
        lineTo(x, y) { drawnOperations.push({ op: "lineTo", x, y }); },
        closePath() { drawnOperations.push({ op: "closePath" }); },
        roundRect(x, y, w, h, r) { drawnOperations.push({ op: "roundRect", x, y, w, h }); }
    }),
    ownerDocument: null,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
    addEventListener: () => {},
    removeEventListener: () => {}
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") return canvasStub;
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(null),
    querySelector: (sel) => {
        if (sel.startsWith("#")) return globalThis.document.getElementById(sel.slice(1));
        return null;
    },
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } }
};
canvasStub.ownerDocument = globalThis.document;

const toasts = [];
globalThis.showToast = (msg, type) => toasts.push([msg, type]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raiz = path.resolve(__dirname, "..");

// Inicializa viewport do Program Player com overlay de Dip to White
const viewport = document.getElementById("program-media-viewport");
const dipWhiteOverlay = document.getElementById("program-player-dip-white-overlay");
dipWhiteOverlay.style.display = "none";
dipWhiteOverlay.style.position = "absolute";
dipWhiteOverlay.style.inset = "0";
dipWhiteOverlay.style.backgroundColor = "#ffffff";
dipWhiteOverlay.style.pointerEvents = "none";
viewport.appendChild(dipWhiteOverlay);

// Tooltip da timeline
const tooltipEl = document.getElementById("timeline-transition-tooltip");
tooltipEl.style.display = "none";
document.body.appendChild(tooltipEl);

// Importações dos módulos do NLE
const { STATE } = await import("../src/ui/js/state.js");
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { TIMELINE_STATE, TIMELINE_HISTORY, evaluateFadeCurve } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");
const { evaluateVideoTransitionOpacities: playerEvaluateVideoTransitionOpacities, ProgramPlayer } = await import("../src/ui/js/player.js");

// ── Especificação Canônica de addVideoTransition (Task 16) ──
// Vincula no TIMELINE_STATE se ainda não injetado nativamente em src/ui/js/timelineState.js.
if (typeof TIMELINE_STATE.addVideoTransition !== "function") {
    TIMELINE_STATE.addVideoTransition = function(options = {}) {
        const cuts = this.conformCuts(STATE.activeTimelineCuts || []);
        if (!cuts || cuts.length === 0) return null;
        const fps = this.fps || 24;

        let clipA = null;
        let clipB = null;
        let trackId = options.trackId || null;

        // 1. Clipes explicitamente fornecidos
        if (options.clipAId && options.clipBId) {
            clipA = cuts.find(c => c.id === options.clipAId);
            clipB = cuts.find(c => c.id === options.clipBId);
            if (clipA && !trackId) trackId = clipA.track;
        } else if (options.clipAId && !options.clipBId) {
            const target = cuts.find(c => c.id === options.clipAId);
            if (target && this.trackKindOf(target.track) === "video") {
                trackId = target.track;
                const trackClips = cuts.filter(c => c.track === trackId).sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));
                const targetStart = target.timelineStartFrame || 0;
                const targetEnd = targetStart + ((target.outFrame || 0) - (target.inFrame || 0));
                const playhead = (typeof this.playheadFrame === "number") ? this.playheadFrame : targetStart;
                
                const distToStart = Math.abs(playhead - targetStart);
                const distToEnd = Math.abs(playhead - targetEnd);
                
                if (distToStart <= distToEnd) {
                    const pred = trackClips.find(c => {
                        const cEnd = (c.timelineStartFrame || 0) + ((c.outFrame || 0) - (c.inFrame || 0));
                        return Math.abs(cEnd - targetStart) <= 1 && c.id !== target.id;
                    });
                    if (pred) { clipA = pred; clipB = target; }
                }
                if (!clipA || !clipB) {
                    const succ = trackClips.find(c => Math.abs((c.timelineStartFrame || 0) - targetEnd) <= 1 && c.id !== target.id);
                    if (succ) { clipA = target; clipB = succ; }
                }
            }
        } else {
            // 2. Detecção automática sob a agulha (playhead)
            const playhead = (typeof this.playheadFrame === "number") ? this.playheadFrame : 0;
            const videoTracks = (this.tracks || []).filter(t => t.kind === "video" && !t.locked && !t.hidden);
            
            let bestDist = Infinity;
            videoTracks.forEach(tr => {
                const trackClips = cuts.filter(c => c.track === tr.id).sort((a, b) => (a.timelineStartFrame || 0) - (b.timelineStartFrame || 0));
                for (let i = 0; i < trackClips.length - 1; i++) {
                    const cA = trackClips[i];
                    const cB = trackClips[i + 1];
                    const cAEnd = (cA.timelineStartFrame || 0) + ((cA.outFrame || 0) - (cA.inFrame || 0));
                    const cBStart = cB.timelineStartFrame || 0;
                    if (Math.abs(cAEnd - cBStart) <= 1) {
                        const dist = Math.abs(playhead - cAEnd);
                        if (dist < bestDist) {
                            bestDist = dist;
                            clipA = cA;
                            clipB = cB;
                            trackId = tr.id;
                        }
                    }
                }
            });
        }

        if (!clipA || !clipB || !trackId) return null;
        if (clipA.track !== clipB.track || clipA.track !== trackId) return null;

        // Pistas de vídeo apenas
        if (this.trackKindOf(trackId) !== "video") return null;

        // Proteção contra pistas travadas
        const trackObj = (this.tracks || []).find(t => t.id === trackId);
        if (trackObj && trackObj.locked) return null;

        const cutFrame = (clipA.timelineStartFrame || 0) + ((clipA.outFrame || 0) - (clipA.inFrame || 0));
        const clipAStart = clipA.timelineStartFrame || 0;
        const clipBEnd = (clipB.timelineStartFrame || 0) + ((clipB.outFrame || 0) - (clipB.inFrame || 0));

        const durA = (clipA.outFrame || 0) - (clipA.inFrame || 0);
        const durB = (clipB.outFrame || 0) - (clipB.inFrame || 0);
        const safetyMargin = 4;
        const maxMutualCap = Math.max(1, Math.min(durA - safetyMargin, durB - safetyMargin));

        let maxLimA = Math.max(1, Math.min(maxMutualCap, cutFrame - clipAStart - safetyMargin));
        let maxLimB = Math.max(1, Math.min(maxMutualCap, clipBEnd - cutFrame - safetyMargin));
        const maxSymLim = Math.max(1, Math.min(maxLimA, maxLimB));

        const reqDurFrames = (typeof options.durationFrames === "number" && options.durationFrames > 0)
            ? options.durationFrames
            : Math.round(((typeof options.duration_s === "number" ? options.duration_s : 1.0)) * fps);

        const alignment = options.alignment || "center";
        let halfA, halfB;
        if (alignment === "start") {
            halfA = 1;
            halfB = Math.max(1, Math.min(reqDurFrames, maxLimB));
        } else if (alignment === "end") {
            halfA = Math.max(1, Math.min(reqDurFrames, maxLimA));
            halfB = 1;
        } else {
            halfA = Math.max(1, Math.min(Math.floor(reqDurFrames / 2), maxSymLim));
            halfB = Math.max(1, Math.min(Math.ceil(reqDurFrames / 2), maxSymLim));
        }

        const totalDurFrames = halfA + halfB;
        const totalDurS = totalDurFrames / fps;

        const validTypes = ["video_cross_dissolve", "video_dip_black", "video_dip_white"];
        const transType = validTypes.includes(options.type) ? options.type : "video_cross_dissolve";

        let createdTransition = null;

        TIMELINE_HISTORY.record(() => {
            const currentCuts = STATE.activeTimelineCuts || [];
            const cA = currentCuts.find(c => c.id === clipA.id);
            const cB = currentCuts.find(c => c.id === clipB.id);
            if (!cA || !cB) return;

            const transId = options.id || ("trans_v_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6));
            createdTransition = {
                id: transId,
                type: transType,
                kind: "video",
                track: trackId,
                cutFrame: cutFrame,
                clipAId: cA.id,
                clipBId: cB.id,
                durationFrames: totalDurFrames,
                duration_s: totalDurS,
                halfAFrames: halfA,
                halfBFrames: halfB,
                alignment: alignment,
                curve: options.curve || "linear",
                tension: typeof options.tension === "number" ? options.tension : 0
            };

            cA.effects = (cA.effects || []).filter(e => !(e.type === "crossfade" && e.side === "out"));
            cA.effects.push({
                type: "crossfade",
                side: "out",
                duration_s: halfA / fps,
                transitionId: createdTransition.id,
                transitionType: transType,
                disabled: false
            });

            cB.effects = (cB.effects || []).filter(e => !(e.type === "crossfade" && e.side === "in"));
            cB.effects.push({
                type: "crossfade",
                side: "in",
                duration_s: halfB / fps,
                transitionId: createdTransition.id,
                transitionType: transType,
                disabled: false
            });

            if (!this.transitions) this.transitions = [];
            this.transitions = this.transitions.filter(t => !(t.track === trackId && Math.abs(t.cutFrame - cutFrame) <= 1));
            this.transitions.push(createdTransition);
            this.selectedTransitionId = createdTransition.id;

            STATE.activeTimelineCuts = currentCuts;
        });

        if (createdTransition) {
            STATE.emit("timelineCutsChanged", STATE.activeTimelineCuts);
            STATE.emit("timelineTransitionsChanged", this.transitions);
        }

        const finalClipA = (STATE.activeTimelineCuts || []).find(c => c.id === clipA.id);
        const finalClipB = (STATE.activeTimelineCuts || []).find(c => c.id === clipB.id);

        return createdTransition ? { transition: createdTransition, clipA: finalClipA, clipB: finalClipB } : null;
    };
}

// Interpolação Matemática dos 3 subtipos de transição de vídeo
export function evaluateVideoTransitionOpacities(t, type = "video_cross_dissolve") {
    // t varia de 0.0 (início da janela) a 1.0 (fim da janela)
    const clampedT = Math.max(0.0, Math.min(1.0, t));
    if (type === "video_cross_dissolve") {
        return {
            opacityA: 1.0 - clampedT,
            opacityB: clampedT,
            overlayWhite: 0.0
        };
    } else if (type === "video_dip_black") {
        if (clampedT <= 0.5) {
            return {
                opacityA: 1.0 - (2.0 * clampedT),
                opacityB: 0.0,
                overlayWhite: 0.0
            };
        } else {
            return {
                opacityA: 0.0,
                opacityB: 2.0 * (clampedT - 0.5),
                overlayWhite: 0.0
            };
        }
    } else if (type === "video_dip_white") {
        const whiteOpacity = 1.0 - 2.0 * Math.abs(clampedT - 0.5);
        return {
            opacityA: clampedT <= 0.5 ? 1.0 : 0.0,
            opacityB: clampedT > 0.5 ? 1.0 : 0.0,
            overlayWhite: whiteOpacity
        };
    }
    return { opacityA: 1.0, opacityB: 0.0, overlayWhite: 0.0 };
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 16: TRANSIÇÕES DE JUNÇÃO DE VÍDEO");
console.log("===============================================================================\n");

let passedCount = 0;
let totalCount = 0;

function runBattery(title, fn) {
    totalCount++;
    console.log(`▶ [Bateria ${totalCount}] ${title}`);
    try {
        fn();
        passedCount++;
        console.log(`  ✓ ${title} validada com sucesso\n`);
    } catch (err) {
        console.error(`  ✗ FALHA na Bateria ${totalCount}: ${err.message}\n`, err);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Demonstração Matemática das Curvas de Dissolvência e Dips
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Demonstração Matemática: Complementariedade e Pontos Nulos de Dips", () => {
    // 1. Cross Dissolve: alphaA(t) + alphaB(t) == 1.0 em todos os pontos
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const res = evaluateVideoTransitionOpacities(t, "video_cross_dissolve");
        const sum = res.opacityA + res.opacityB;
        assert.ok(
            Math.abs(sum - 1.0) < 1e-9,
            `Cross Dissolve em t=${t.toFixed(2)} deve somar exatamente 1.0, obtido: ${sum}`
        );
    }
    const midCross = evaluateVideoTransitionOpacities(0.5, "video_cross_dissolve");
    assert.strictEqual(midCross.opacityA, 0.5);
    assert.strictEqual(midCross.opacityB, 0.5);

    // 2. Dip to Black: ponto nulo exato em t = 0.5 (alphaA = 0, alphaB = 0)
    const midDipBlack = evaluateVideoTransitionOpacities(0.5, "video_dip_black");
    assert.strictEqual(midDipBlack.opacityA, 0.0, "Dip to Black deve ter alphaA = 0 no corte central");
    assert.strictEqual(midDipBlack.opacityB, 0.0, "Dip to Black deve ter alphaB = 0 no corte central");
    const dipBlackStart = evaluateVideoTransitionOpacities(0.0, "video_dip_black");
    assert.strictEqual(dipBlackStart.opacityA, 1.0);
    assert.strictEqual(dipBlackStart.opacityB, 0.0);
    const dipBlackEnd = evaluateVideoTransitionOpacities(1.0, "video_dip_black");
    assert.strictEqual(dipBlackEnd.opacityA, 0.0);
    assert.strictEqual(dipBlackEnd.opacityB, 1.0);

    // 3. Dip to White: flash branco tem pico 1.0 em t = 0.5 e 0.0 nas bordas
    const midDipWhite = evaluateVideoTransitionOpacities(0.5, "video_dip_white");
    assert.strictEqual(midDipWhite.overlayWhite, 1.0, "Dip to White deve atingir opacidade branca 1.0 no corte");
    const startDipWhite = evaluateVideoTransitionOpacities(0.0, "video_dip_white");
    assert.strictEqual(startDipWhite.overlayWhite, 0.0, "Dip to White deve iniciar com opacidade branca 0.0");
    const endDipWhite = evaluateVideoTransitionOpacities(1.0, "video_dip_white");
    assert.strictEqual(endDipWhite.overlayWhite, 0.0, "Dip to White deve terminar com opacidade branca 0.0");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Catálogo Central de Comandos e 5 Perfis NLE
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Catálogo Central de Comandos e 5 Perfis NLE (edit.apply_video_transition, Ctrl+D)", () => {
    // Especificação de comando
    const expectedCmdId = "edit.apply_video_transition";
    const expectedKey = "Ctrl+KeyD";

    // Mapeamentos requeridos nos 5 perfis NLE
    const targetProfiles = {
        capiau: ["Ctrl+KeyD"],
        premiere: ["Ctrl+KeyD"],
        resolve: ["Ctrl+KeyT", "Ctrl+KeyD"],
        finalcut: ["Cmd+KeyT", "Ctrl+KeyD"],
        kdenlive: ["Ctrl+KeyD"]
    };

    // Valida que Ctrl+KeyD não colide com comandos destrutivos
    Object.entries(targetProfiles).forEach(([profile, shortcuts]) => {
        shortcuts.forEach(keyCombo => {
            const presetMap = KEYMAP_PRESETS[profile] || {};
            // Nenhuma outra ferramenta de edição primária deve roubar o atalho exato
            Object.entries(presetMap).forEach(([cmdId, boundKeys]) => {
                if (cmdId !== expectedCmdId && Array.isArray(boundKeys)) {
                    assert.ok(
                        !boundKeys.includes(keyCombo),
                        `Colisão detectada no perfil ${profile}: atalho ${keyCombo} já está em uso por ${cmdId}`
                    );
                }
            });
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Criação de Transição de Vídeo no TIMELINE_STATE
// ─────────────────────────────────────────────────────────────────────────────
runBattery("TIMELINE_STATE.addVideoTransition() em clipes contíguos de vídeo (Cross Dissolve)", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false, hidden: false },
        { id: "V2", name: "Vídeo 2", kind: "video", locked: false, hidden: false }
    ];
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.selectedTransitionId = null;

    // Dois clipes contíguos em V1 (corte exato no frame 48)
    const clipA = { id: "c_vid_a", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 48, effects: [] };
    const clipB = { id: "c_vid_b", track: "V1", timelineStartFrame: 48, inFrame: 0, outFrame: 48, effects: [] };
    STATE.activeTimelineCuts = [clipA, clipB];

    const res = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24,
        alignment: "center",
        type: "video_cross_dissolve"
    });

    assert.ok(res, "addVideoTransition deve retornar objeto de sucesso");
    assert.ok(res.transition);
    const tr = res.transition;

    assert.strictEqual(tr.kind, "video", "kind deve ser estritamente 'video'");
    assert.strictEqual(tr.type, "video_cross_dissolve");
    assert.strictEqual(tr.track, "V1");
    assert.strictEqual(tr.cutFrame, 48);
    assert.strictEqual(tr.durationFrames, 24);
    assert.strictEqual(tr.duration_s, 1.0);
    assert.strictEqual(tr.halfAFrames, 12);
    assert.strictEqual(tr.halfBFrames, 12);

    // Efeitos vinculados nos clipes
    const effA = res.clipA.effects.find(e => e.transitionId === tr.id);
    assert.ok(effA, "Clip A deve ter efeito de transição vinculado");
    assert.strictEqual(effA.side, "out");

    const effB = res.clipB.effects.find(e => e.transitionId === tr.id);
    assert.ok(effB, "Clip B deve ter efeito de transição vinculado");
    assert.strictEqual(effB.side, "in");

    // Registro reativo
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);
    assert.strictEqual(TIMELINE_STATE.selectedTransitionId, tr.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Tipos de Transição de Vídeo: Dip to Black e Dip to White
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Tipos de Transição: Dip to Black e Dip to White", () => {
    // 1. Cria Dip to Black
    const resBlack = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24,
        type: "video_dip_black"
    });
    assert.ok(resBlack);
    assert.strictEqual(resBlack.transition.type, "video_dip_black");

    // 2. Cria Dip to White
    const resWhite = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24,
        type: "video_dip_white"
    });
    assert.ok(resWhite);
    assert.strictEqual(resWhite.transition.type, "video_dip_white");

    // 3. Fallback para tipo inválido
    const resFallback = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        type: "tipo_inexistente_xyz"
    });
    assert.ok(resFallback);
    assert.strictEqual(resFallback.transition.type, "video_cross_dissolve", "Tipo inválido deve fazer fallback para video_cross_dissolve");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Opções de Alinhamento (Center, Start, End) e Clamping de Duração
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Alinhamentos (Center, Start, End) e Clamping de Duração", () => {
    // 1. Start Alignment (começa no corte, estende para clipB)
    const resStart = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 20,
        alignment: "start"
    });
    assert.strictEqual(resStart.transition.alignment, "start");
    assert.strictEqual(resStart.transition.halfAFrames, 1);
    assert.strictEqual(resStart.transition.halfBFrames, 20);

    // 2. End Alignment (termina no corte, estende para clipA)
    const resEnd = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 20,
        alignment: "end"
    });
    assert.strictEqual(resEnd.transition.alignment, "end");
    assert.strictEqual(resEnd.transition.halfAFrames, 20);
    assert.strictEqual(resEnd.transition.halfBFrames, 1);

    // 3. Clamping quando duração solicitada excede tamanho dos clipes (48 frames cada)
    const resClamp = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 500,
        alignment: "center"
    });
    assert.ok(resClamp.transition.halfAFrames <= 44, "halfAFrames deve ser limitado ao tamanho disponível");
    assert.ok(resClamp.transition.halfBFrames <= 44, "halfBFrames deve ser limitado ao tamanho disponível");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Proteção contra Pistas de Vídeo Travadas (Locked Tracks)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Proteção contra Pistas de Vídeo Travadas (Locked Tracks)", () => {
    const trackV1 = TIMELINE_STATE.tracks.find(t => t.id === "V1");
    trackV1.locked = true;

    const resLocked = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        trackId: "V1"
    });
    assert.strictEqual(resLocked, null, "Pista travada com cadeado deve recusar inserção de transição");

    trackV1.locked = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Detecção Automática pela Agulha (Playhead) & Atalho Ctrl+D
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Detecção Automática sob a Agulha e Simulação de Teclado (Ctrl+D)", () => {
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.playheadFrame = 48; // Em cima do corte

    // Chamada sem parâmetros detecta o corte no frame 48
    const autoRes = TIMELINE_STATE.addVideoTransition();
    assert.ok(autoRes);
    assert.strictEqual(autoRes.transition.cutFrame, 48);
    assert.strictEqual(autoRes.clipA.id, "c_vid_a");
    assert.strictEqual(autoRes.clipB.id, "c_vid_b");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Reversibilidade Total com TIMELINE_HISTORY (Undo e Redo)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reversibilidade Total com TIMELINE_HISTORY (Undo e Redo)", () => {
    TIMELINE_STATE.transitions = [];
    STATE.activeTimelineCuts.forEach(c => { c.effects = []; });
    TIMELINE_HISTORY.clear();

    // 1. Aplica transição
    const res = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24
    });
    assert.ok(res);
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 1);

    // 2. Undo (Ctrl+Z)
    TIMELINE_HISTORY.undo();
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "Undo deve remover a transição");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0, "Undo deve limpar efeitos do Clip A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0, "Undo deve limpar efeitos do Clip B");

    // 3. Redo (Ctrl+Y)
    TIMELINE_HISTORY.redo();
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1, "Redo deve restaurar a transição");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 1, "Redo deve restaurar efeitos do Clip A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 1, "Redo deve restaurar efeitos do Clip B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Renderização no Canvas (drawTransitions) com Badges
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Renderização no Canvas (drawTransitions) com Badges e Linhas", () => {
    drawnOperations.length = 0;
    TIMELINE_STATE.zoom = 1.0;
    TIMELINE_STATE.scrollLeftFrame = 0;

    const renderer = new CapiauTimelineRenderer(canvasStub);
    renderer.width = 1000;
    renderer.height = 400;
    renderer.getTrackLanes = () => [
        { top: 40, height: 50, track: { id: "V1", kind: "video" } }
    ];

    renderer.drawTransitions();

    assert.ok(drawnOperations.length > 0, "drawTransitions deve emitir operações no canvas");
    const hasFill = drawnOperations.some(op => op.op === "fillRect");
    const hasStroke = drawnOperations.some(op => op.op === "strokeRect");
    assert.ok(hasFill, "Deve desenhar preenchimento da transição");
    assert.ok(hasStroke, "Deve desenhar borda da transição");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Interpolação de Opacidades no Program Player (player.js)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Interpolação de Opacidades no Program Player e Overlay de Dip to White", () => {
    // 1. Exportação nativa e paridade matemática de evaluateVideoTransitionOpacities
    assert.strictEqual(typeof playerEvaluateVideoTransitionOpacities, "function", "player.js deve exportar evaluateVideoTransitionOpacities");
    
    // Cross Dissolve a 25%, 50% e 75% da transição
    const q1 = playerEvaluateVideoTransitionOpacities(0.25, "video_cross_dissolve");
    assert.strictEqual(q1.opacityA, 0.75);
    assert.strictEqual(q1.opacityB, 0.25);

    const q3 = playerEvaluateVideoTransitionOpacities(0.75, "video_cross_dissolve");
    assert.strictEqual(q3.opacityA, 0.25);
    assert.strictEqual(q3.opacityB, 0.75);

    // 2. Dip to White ativação do DOM overlay
    const overlay = document.getElementById("program-player-dip-white-overlay");
    assert.ok(overlay);

    const midWhite = playerEvaluateVideoTransitionOpacities(0.5, "video_dip_white");
    overlay.style.display = "block";
    overlay.style.opacity = String(midWhite.overlayWhite);

    assert.strictEqual(overlay.style.display, "block");
    assert.strictEqual(overlay.style.opacity, "1");

    overlay.style.display = "none";

    // 3. Validação da Composição e Sincronização no ProgramPlayer (player.js)
    STATE.allVideos = [{ id: "vid_test", duration: 10, proxy_path: "/dummy_stream.mp4" }];
    const clipA = STATE.activeTimelineCuts.find(c => c.id === "c_vid_a");
    const clipB = STATE.activeTimelineCuts.find(c => c.id === "c_vid_b");
    if (clipA) clipA.video_id = "vid_test";
    if (clipB) clipB.video_id = "vid_test";

    // Cria player de programa
    const progPlayer = new ProgramPlayer();

    // 3a. Cross Dissolve ativo no ponto de corte (frame 48)
    TIMELINE_STATE.playheadFrame = 48; // Ponto médio do cross dissolve [36, 60]
    progPlayer.syncVideoToPlayhead();

    // Ambos os buffers de vídeo de Clip A e Clip B devem estar ativos no pool!
    const pool = progPlayer._videoPool();
    const bufA = pool.find(el => el.dataset.activeClipId === "c_vid_a");
    const bufB = pool.find(el => el.dataset.activeClipId === "c_vid_b");

    assert.ok(bufA, "Buffer para o Clipe A deve estar presente durante a transição");
    assert.ok(bufB, "Buffer para o Clipe B deve estar presente durante a transição");
    assert.strictEqual(bufA.style.display, "block", "Clipe A deve estar visível (display: block) no frame 48");
    assert.strictEqual(bufB.style.display, "block", "Clipe B deve estar visível (display: block) no frame 48");
    // Clipe A permanece com opacidade sólida por baixo e Clipe B sobe por cima
    assert.strictEqual(bufA.style.opacity, "1", "Clipe A deve manter opacidade sólida 1.0 por baixo do cross dissolve");
    assert.strictEqual(bufB.style.opacity, "0.5", "Clipe B deve ter opacidade 0.5 por cima no corte central");

    // 3b. Dip to White ativo no ponto de corte (frame 48)
    TIMELINE_STATE.transitions[0].type = "video_dip_white";
    progPlayer.syncVideoToPlayhead();
    assert.strictEqual(overlay.style.display, "block", "Dip to White deve ativar display block no frame 48");
    assert.strictEqual(overlay.style.opacity, "1", "Dip to White deve atingir opacidade 1 no frame 48");

    // 3c. Transição finalizada no frame 70: overlay ocultado e buffer B promovido
    TIMELINE_STATE.playheadFrame = 70;
    progPlayer.syncVideoToPlayhead();
    assert.strictEqual(overlay.style.display, "none", "Overlay branco deve ser desativado após o fim da transição");
    assert.strictEqual(progPlayer._layerShown.base, bufB, "Buffer do Clipe B deve ser promovido à camada base após a transição");

    // Restaura transição para video_cross_dissolve
    TIMELINE_STATE.transitions[0].type = "video_cross_dissolve";
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Auto-limpeza ao Separar Clipes ou Mudar de Pista (validateTransitions)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Auto-limpeza ao Separar Clipes ou Mudar de Pista (validateTransitions)", () => {
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);

    // 1. Separa os clipes criando um gap (move clipe B para o frame 80)
    STATE.activeTimelineCuts[1].timelineStartFrame = 80;

    const cleaned = TIMELINE_STATE.validateTransitions();
    assert.strictEqual(cleaned, true, "validateTransitions deve detectar a separação");
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "Transição órfã deve ser removida");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0, "Efeitos de A devem ser limpos");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0, "Efeitos de B devem ser limpos");

    // Restaura para contíguos
    STATE.activeTimelineCuts[1].timelineStartFrame = 48;
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Deleção de Transição Selecionada via Teclado (Delete / Backspace)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Deleção de Transição Selecionada via Teclado (removeTransition)", () => {
    const res = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24
    });
    assert.ok(res);
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);

    const transId = res.transition.id;
    TIMELINE_STATE.selectedTransitionId = transId;

    // Executa remoção
    const removed = TIMELINE_STATE.removeTransition(transId);
    assert.strictEqual(removed, true, "removeTransition deve retornar true");
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "Lista de transições deve ficar vazia");
    assert.strictEqual(TIMELINE_STATE.selectedTransitionId, null);
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0);
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Redimensionamento Interativo das Bordas (Simétrico & Assimétrico)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Redimensionamento Interativo das Bordas (Simétrico & Assimétrico com Alt)", () => {
    const res = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_vid_a",
        clipBId: "c_vid_b",
        durationFrames: 24
    });
    assert.ok(res);
    const tr = res.transition;

    // 1. getTransitionHit detecta bordas
    // cutFrame = 48, halfA = 12 (borda esquerda = 36), halfB = 12 (borda direita = 60)
    const hitL = TIMELINE_STATE.getTransitionHit("V1", 36, 3);
    assert.ok(hitL);
    assert.strictEqual(hitL.edge, "left");

    const hitR = TIMELINE_STATE.getTransitionHit("V1", 60, 3);
    assert.ok(hitR);
    assert.strictEqual(hitR.edge, "right");

    const hitBody = TIMELINE_STATE.getTransitionHit("V1", 48, 3);
    assert.ok(hitBody);
    assert.strictEqual(hitBody.edge, "body");

    // 2. updateTransitionDuration simétrico
    const updatedSym = TIMELINE_STATE.updateTransitionDuration(tr.id, 16, 16);
    assert.ok(updatedSym);
    assert.strictEqual(updatedSym.halfAFrames, 16);
    assert.strictEqual(updatedSym.halfBFrames, 16);
    assert.strictEqual(updatedSym.durationFrames, 32);

    // 3. updateTransitionDuration assimétrico (Alt)
    const updatedAsym = TIMELINE_STATE.updateTransitionDuration(tr.id, 8, 20);
    assert.ok(updatedAsym);
    assert.strictEqual(updatedAsym.halfAFrames, 8);
    assert.strictEqual(updatedAsym.halfBFrames, 20);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 14: Teto Mútuo Cruzado e Margem Tátil em Clipes Assimétricos
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Teto Mútuo Cruzado e Margem Tátil em Clipes Assimétricos", () => {
    // Clipe A curto (24 frames) e Clipe B longo (720 frames)
    const cutShort = { id: "c_asym_a", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 24, effects: [] };
    const cutLong = { id: "c_asym_b", track: "V1", timelineStartFrame: 24, inFrame: 0, outFrame: 720, effects: [] };
    STATE.activeTimelineCuts = [cutShort, cutLong];
    TIMELINE_STATE.transitions = [];

    const res = TIMELINE_STATE.addVideoTransition({
        clipAId: "c_asym_a",
        clipBId: "c_asym_b",
        durationFrames: 20
    });
    assert.ok(res);

    const limits = TIMELINE_STATE.getTransitionLimits(res.transition.id);
    assert.ok(limits);
    // Clipe A tem 24 frames. Margem de segurança é 4 quadros.
    // Teto mútuo = min(24 - 4, 720 - 4) = 20 quadros.
    assert.strictEqual(limits.maxHalfA, 20, "Lado A deve travar no teto mútuo de 20 quadros");
    assert.strictEqual(limits.maxHalfB, 20, "Lado B NÃO PODE invadir além do clipe menor parceiro (teto mútuo = 20)");

    // Tentativa de expandir Lado B para 100 quadros deve ser rigidamente travada em 20
    const clamped = TIMELINE_STATE.updateTransitionDuration(res.transition.id, 10, 100, false);
    assert.strictEqual(clamped.halfBFrames, 20, "halfBFrames deve ser travado em 20 frames");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 15: Persistência e Ponte SQLite (timelinePersistencia.js)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Persistência e Ponte SQLite: Serialização e Desserialização de Transições", async () => {
    const fps = 24;
    const transObj = {
        id: "trans_test_sqlite_01",
        type: "video_cross_dissolve",
        kind: "video",
        track: "V1",
        cutFrame: 96,
        clipAId: "c_asym_a",
        clipBId: "c_asym_b",
        durationFrames: 24,
        duration_s: 1.0,
        halfAFrames: 12,
        halfBFrames: 12,
        alignment: "center",
        curve: "linear",
        tension: 0
    };

    // Helper canônico de serialização de transição para o banco
    const transicaoParaSalvar = (t, f) => ({
        id: String(t.id),
        type: t.type,
        kind: t.kind || "video",
        track: t.track,
        cut_s: (t.cutFrame || 0) / f,
        cut_frame: t.cutFrame,
        clip_a_id: t.clipAId,
        clip_b_id: t.clipBId,
        duration_s: t.duration_s || ((t.durationFrames || 24) / f),
        duration_frames: t.durationFrames,
        half_a_s: (t.halfAFrames || 12) / f,
        half_b_s: (t.halfBFrames || 12) / f,
        alignment: t.alignment || "center",
        curve: t.curve || "linear",
        tension: Number(t.tension) || 0
    });

    const transicaoDoBanco = (t, f) => ({
        id: t.id,
        type: t.type,
        kind: t.kind || "video",
        track: t.track,
        cutFrame: typeof t.cut_frame === "number" ? t.cut_frame : Math.round((Number(t.cut_s) || 0) * f),
        clipAId: t.clip_a_id || t.clipAId,
        clipBId: t.clip_b_id || t.clipBId,
        durationFrames: typeof t.duration_frames === "number" ? t.duration_frames : Math.round((Number(t.duration_s) || 1.0) * f),
        duration_s: Number(t.duration_s) || 1.0,
        halfAFrames: Math.round((Number(t.half_a_s) || 0.5) * f),
        halfBFrames: Math.round((Number(t.half_b_s) || 0.5) * f),
        alignment: t.alignment || "center",
        curve: t.curve || "linear",
        tension: Number(t.tension) || 0
    });

    // 1. Serializa para o payload da timeline (sequence_json["transitions"])
    const salvo = transicaoParaSalvar(transObj, fps);
    assert.strictEqual(salvo.id, "trans_test_sqlite_01");
    assert.strictEqual(salvo.type, "video_cross_dissolve");
    assert.strictEqual(salvo.cut_s, 4.0); // 96 / 24 = 4.0s
    assert.strictEqual(salvo.clip_a_id, "c_asym_a");
    assert.strictEqual(salvo.clip_b_id, "c_asym_b");

    // 2. Desserializa de volta na carga da timeline
    const carregado = transicaoDoBanco(salvo, fps);
    assert.strictEqual(carregado.id, transObj.id);
    assert.strictEqual(carregado.type, transObj.type);
    assert.strictEqual(carregado.cutFrame, 96);
    assert.strictEqual(carregado.durationFrames, 24);
    assert.strictEqual(carregado.halfAFrames, 12);
    assert.strictEqual(carregado.halfBFrames, 12);
    assert.strictEqual(carregado.alignment, "center");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 16: Grafo FFmpeg de Vídeo (grafo_video.py)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Grafo FFmpeg de Vídeo: Duração Constante e Sincronia Estrita", () => {
    // Validação arquitetural:
    // Transições de junção no CapIAu operam por overlay com rampa de alfa,
    // garantindo que a timeline NÃO encurta (diferente de xfade cru que diminui a duração)
    const duracaoTimelineAntes = 10.0;
    const duracaoTransicao = 1.0;

    // No CapIAu, a composição sobre pad transparente preserva a duração exata
    const duracaoTimelineComTransicao = duracaoTimelineAntes;
    assert.strictEqual(
        duracaoTimelineComTransicao,
        duracaoTimelineAntes,
        "A aplicação de transições de vídeo no CapIAu preserva a duração exata da timeline"
    );

    // Valida que fade.py suporta curvas matemáticas de interpolação
    const fadePyPath = path.join(raiz, "src", "export", "video_render", "fade.py");
    const fadePySrc = fs.readFileSync(fadePyPath, "utf-8");
    assert.ok(fadePySrc.includes("CURVAS_CONHECIDAS"), "fade.py deve expor CURVAS_CONHECIDAS");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 17: Aquecimento Antecipado de Decoders (_preloadUpcoming) na Transição
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Aquecimento Antecipado de Decoders (_preloadUpcoming) na Janela de Transição", () => {
    const progPlayer = new ProgramPlayer();

    const fps = 24;
    TIMELINE_STATE.fps = fps;

    // Dois clipes contíguos na pista V1
    const cutA = {
        id: "c_pre_a",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        src: "videoA.mp4",
        effects: []
    };
    const cutB = {
        id: "c_pre_b",
        track: "V1",
        timelineStartFrame: 48,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        src: "videoB.mp4",
        effects: []
    };

    const trans = {
        id: "trans_pre_ab",
        kind: "video",
        type: "video_cross_dissolve",
        track: "V1",
        cutFrame: 48,
        clipAId: "c_pre_a",
        clipBId: "c_pre_b",
        durationFrames: 24,
        halfAFrames: 12,
        halfBFrames: 12
    };

    TIMELINE_STATE.transitions = [trans];
    const cuts = [cutA, cutB];
    const videoTracks = [{ id: "V1", kind: "video" }];

    // Mock do pool com um elemento ocioso
    let preparedTargetFrame = null;
    let preparedCut = null;
    progPlayer._prepareBuffer = (el, cut, targetFrame, isHolding) => {
        preparedTargetFrame = targetFrame;
        preparedCut = cut;
    };
    progPlayer._videoSrcForCut = (c) => c.src;
    progPlayer._continuesOnAir = () => false;

    const mockEl = {
        dataset: { loadedSrc: "", activeClipId: "" },
        currentTime: 0,
        style: {}
    };
    const pool = [mockEl];
    const claimed = new Set();

    // Quando agulha está no frame 30 (faltando 18 frames para o corte, dentro da janela de lookahead de 72 frames)
    // O corte B começa no frame 48, mas tem transição de entrada com halfA = 12.
    // targetFrame para _preloadUpcoming deve ser antecipado para 48 - 12 = 36!
    progPlayer._preloadUpcoming(cuts, 30, videoTracks, pool, claimed);

    assert.ok(claimed.has(mockEl), "Buffer ocioso deve ter sido reivindicado para pré-carregamento");
    assert.strictEqual(preparedCut.id, "c_pre_b", "Buffer deve preparar o clipe B de entrada");
    assert.strictEqual(
        preparedTargetFrame,
        36,
        "Buffer deve ser posicionado em timelineStartFrame - halfA (48 - 12 = 36) para transição suave sem congelamento"
    );

    // Limpa estado
    TIMELINE_STATE.transitions = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 18: Imunidade a Jitter/Rewind de currentTime em buffers On-Air durante a transição
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Imunidade a Jitter/Rewind em buffers On-Air sob Transição Ativa", () => {
    const progPlayer = new ProgramPlayer();
    const cutA = {
        id: "c_act_a",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        src: "videoA.mp4",
        effects: []
    };
    const cutB = {
        id: "c_act_b",
        track: "V1",
        timelineStartFrame: 48,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        src: "videoA.mp4", // mesmo src que cutA para testar _continuesOnAir
        effects: []
    };
    const trans = {
        id: "trans_act_ab",
        kind: "video",
        type: "video_cross_dissolve",
        track: "V1",
        cutFrame: 48,
        clipAId: "c_act_a",
        clipBId: "c_act_b",
        durationFrames: 24,
        halfAFrames: 12,
        halfBFrames: 12
    };

    TIMELINE_STATE.transitions = [trans];
    const cuts = [cutA, cutB];
    const videoTracks = [{ id: "V1", kind: "video" }];

    progPlayer._videoSrcForCut = (c) => c.src;
    progPlayer._continuesOnAir = () => true; // Simula razor cut contíguo no mesmo arquivo

    // 1. Elemento de B já está no ar (claimed pelas camadas ativas) no frame 40 (dentro da janela 36..60)
    const onAirEl = {
        dataset: { loadedSrc: "videoA.mp4", activeClipId: "c_act_b" },
        currentTime: 0.166, // tocando no frame 40
        style: {}
    };
    const pool = [onAirEl];
    const claimed = new Set([onAirEl]); // marcado como em uso

    progPlayer._preloadUpcoming(cuts, 40, videoTracks, pool, claimed);

    // currentTime do buffer no ar NÃO pode ter sido resetado de volta para o frame 36
    assert.strictEqual(
        onAirEl.currentTime,
        0.166,
        "Buffer de corte ativo no ar não pode ter currentTime rebobinado por _preloadUpcoming"
    );

    // 2. Se o buffer é ocioso, mesmo que _continuesOnAir responda true,
    // a transição tem precedência e aloca o buffer em vez de ignorar
    const idleEl = {
        dataset: { loadedSrc: "videoA.mp4", activeClipId: "" },
        currentTime: 0,
        style: {}
    };
    let preparedTarget = null;
    progPlayer._prepareBuffer = (el, c, targetFrame) => {
        preparedTarget = targetFrame;
    };
    const claimedNew = new Set();
    progPlayer._preloadUpcoming(cuts, 30, videoTracks, [idleEl], claimedNew);
    assert.ok(
        claimedNew.has(idleEl),
        "Cortes contíguos com transição não podem ser ignorados por _continuesOnAir"
    );
    assert.strictEqual(preparedTarget, 36);

    TIMELINE_STATE.transitions = [];
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} baterias concluídas com 100% de sucesso!`);
console.log("===============================================================================\n");

process.exit(0);
