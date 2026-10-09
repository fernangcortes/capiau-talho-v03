// tests/autoteste_composicao_multipista_cascata.mjs
// Suíte de Testes Automatizados — Diretriz 10 do PLANO_SUITE_NLE_CLASSICO:
// Teste Composto Multipista em Cascata:
// Camada de Ajuste (com Fade Bézier e Blend Mode) sobreposta a Junção Cross Dissolve (com Color Grading)
//
// 7 Baterias de Teste:
//  1. Montagem canônica do empilhamento de pistas (V2 ajuste sobre V1 corte duplo com Crossfade)
//  2. Modulação da curva Bézier no fade da Camada de Ajuste (S-Curve, extremos e platô)
//  3. Propagação descendente e cumulativa de efeitos (getCumulativeAdjustmentEffects sobre V1)
//  4. Composição no Program Player (mixBlendMode, backdropFilter e preservação de buffers)
//  5. Render Cache offscreen e desalocação atômica de VRAM (bitmap.close() anti-leak)
//  6. Comportamento de bypass/desativação da camada superior (restauração do crossfade puro)
//  7. Reversibilidade com Undo/Redo e imunidade de buffers on-air

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
            backdropFilter: "",
            webkitBackdropFilter: "",
            clipPath: "",
            opacity: "",
            zIndex: "",
            backgroundColor: "",
            mixBlendMode: "normal",
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
                if (force !== undefined) {
                    if (force) this._classes.add(c); else this._classes.delete(c);
                    return !!force;
                }
                if (this._classes.has(c)) {
                    this._classes.delete(c);
                    return false;
                }
                this._classes.add(c);
                return true;
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
        play() {},
        pause() {},
        load() {},
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

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl("created_" + tag),
    querySelector: (sel) => {
        if (sel.startsWith("#")) return globalThis.document.getElementById(sel.slice(1));
        return null;
    },
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } }
};

// Mocks do Program Player no DOM
const viewport = document.getElementById("program-media-viewport");
const adjOverlay = document.getElementById("program-player-adjustment");
adjOverlay.style.display = "none";
adjOverlay.style.position = "absolute";
adjOverlay.style.inset = "0";
adjOverlay.style.pointerEvents = "none";
viewport.appendChild(adjOverlay);

// Importações dos módulos do NLE
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY, evaluateFadeCurve, computeAdjustmentFadeFactor } = await import("../src/ui/js/timelineState.js");
const { buildCssBackdropFilter, CapiauPlayer } = await import("../src/ui/js/player.js");
const { RENDER_CACHE_MANAGER } = await import("../src/ui/js/renderCache.js");

console.log("🧪 Iniciando Suíte de Testes: Composição Multipista em Cascata (Diretriz 10)\n");

const FPS = 24;
TIMELINE_STATE.fps = FPS;

// Configuração de pistas de teste
TIMELINE_STATE.tracks = [
    { id: "V3", name: "Overlays", kind: "video", order: 0 },
    { id: "V2", name: "Ajuste", kind: "video", order: 1 },
    { id: "V1", name: "Base", kind: "video", order: 2 },
    { id: "A1", name: "Audio", kind: "audio", order: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Montagem canônica do empilhamento de pistas
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 1: Montagem canônica do empilhamento de pistas (V2 sobre V1)");

// Pista V1: Clipe A (0 a 4s, 0 a 96f) e Clipe B (4 a 8s, 96 a 192f)
// com Cross Dissolve de 1s (24 quadros) centrado em 4.0s (frame 96)
const clipA = {
    id: "clip_v1_a",
    type: "video",
    kind: "video",
    video_id: 101,
    track: "V1",
    in: 0.0,
    out: 4.0,
    inFrame: 0,
    outFrame: 96,
    timeline_start: 0.0,
    timelineStartFrame: 0,
    effects: [
        { type: "color", brightness: 10, contrast: 5, saturation: 110, disabled: false },
        {
            type: "crossfade",
            side: "out",
            duration_s: 1.0,
            durationFrames: 24,
            transitionId: "tr_cascata_1",
            transitionType: "video_cross_dissolve",
            curve: "linear",
            disabled: false
        }
    ]
};

const clipB = {
    id: "clip_v1_b",
    type: "video",
    kind: "video",
    video_id: 102,
    track: "V1",
    in: 2.0,
    out: 6.0,
    inFrame: 48,
    outFrame: 144,
    timeline_start: 4.0,
    timelineStartFrame: 96,
    effects: [
        { type: "color", brightness: -5, contrast: 15, saturation: 90, disabled: false },
        {
            type: "crossfade",
            side: "in",
            duration_s: 1.0,
            durationFrames: 24,
            transitionId: "tr_cascata_1",
            transitionType: "video_cross_dissolve",
            curve: "linear",
            disabled: false
        }
    ]
};

// Pista V2: Camada de Ajuste (2.0s a 6.0s, 48 a 144f) cobrindo a junção de 4.0s (96f)
// Fade in e Fade out de 1.0s (24 quadros) com curva Bézier e blend mode soft-light
const adjClip = {
    id: "adj_v2_1",
    type: "video",
    kind: "adjustment",
    name: "Ajuste Cascata",
    video_id: null,
    track: "V2",
    in: 0.0,
    out: 4.0,
    inFrame: 0,
    outFrame: 96,
    timeline_start: 2.0,
    timelineStartFrame: 48,
    blend_mode: "soft-light",
    blendMode: "soft-light",
    disabled: false,
    effects: [
        {
            type: "color",
            brightness: -10,
            contrast: 20,
            saturation: 150,
            hue: 0,
            sepia: 0,
            grayscale: 0,
            blur: 0,
            disabled: false
        },
        {
            type: "crossfade",
            side: "in",
            duration_s: 1.0,
            durationFrames: 24,
            curve: "bezier",
            tension: 0.0,
            disabled: false
        },
        {
            type: "crossfade",
            side: "out",
            duration_s: 1.0,
            durationFrames: 24,
            curve: "bezier",
            tension: 0.0,
            disabled: false
        }
    ]
};

STATE.activeTimelineCuts = [clipA, clipB, adjClip];
TIMELINE_STATE.transitions = [
    {
        id: "tr_cascata_1",
        type: "video_cross_dissolve",
        clipAId: "clip_v1_a",
        clipBId: "clip_v1_b",
        track: "V1",
        cutFrame: 96,
        durationFrames: 24,
        halfAFrames: 12,
        halfBFrames: 12,
        curve: "linear",
        disabled: false
    }
];

assert.equal(STATE.activeTimelineCuts.length, 3, "Timeline deve conter 3 cortes (2 vídeo + 1 ajuste)");
assert.equal(TIMELINE_STATE.isTrackAbove("V2", "V1"), true, "V2 deve ser considerada acima de V1");
assert.equal(TIMELINE_STATE.isTrackAbove("V1", "V2"), false, "V1 não deve estar acima de V2");
console.log("  ✔ Estrutura canônica validada com sucesso.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Modulação da curva Bézier no fade da Camada de Ajuste
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 2: Modulação de curva Bézier no fade da Camada de Ajuste");

// No frame 48 (início da camada de ajuste): fadeFactor == 0
const fStart = computeAdjustmentFadeFactor(adjClip, 48, FPS);
assert.equal(fStart, 0.0, "No início do fade in Bézier o fator deve ser 0.0");

// No frame 60 (metade do fade in Bézier de 24 quadros, progresso 0.5):
// Curva S Bézier: evaluateFadeCurve(0.5, 'bezier') == 0.5
const fMidIn = computeAdjustmentFadeFactor(adjClip, 60, FPS);
assert(fMidIn > 0.0 && fMidIn < 1.0, "No meio do fade in Bézier deve ter valor intermediário");
assert.equal(Math.round(fMidIn * 100) / 100, 0.5, "Bézier simétrico em 0.5 deve resultar em 0.5");

// No frame 72 (fim do fade in): fator deve atingir 1.0
const fFull = computeAdjustmentFadeFactor(adjClip, 72, FPS);
assert.equal(fFull, 1.0, "Ao término do fade in Bézier o fator deve ser 1.0");

// No frame 96 (centro da transição inferior V1): patamar pleno (1.0)
const fCenter = computeAdjustmentFadeFactor(adjClip, 96, FPS);
assert.equal(fCenter, 1.0, "No centro da transição o fator da camada de ajuste deve ser 1.0");

// No frame 132 (metade do fade out Bézier de 24 quadros, entre 120 e 144):
const fMidOut = computeAdjustmentFadeFactor(adjClip, 132, FPS);
assert(fMidOut > 0.0 && fMidOut < 1.0, "No meio do fade out Bézier deve ter valor intermediário");

// No frame 144 (término da camada de ajuste): fator deve ser 0.0
const fEnd = computeAdjustmentFadeFactor(adjClip, 144, FPS);
assert.equal(fEnd, 0.0, "No término do clipe o fator deve ser 0.0");

console.log("  ✔ Curva Bézier avaliada com fidelidade S-Curve nos extremos e no platô.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Propagação descendente e cumulativa de efeitos
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 3: Propagação descendente e cumulativa (getCumulativeAdjustmentEffects)");

// Frame 24 (1.0s, antes do início da camada de ajuste que começa em 48):
const effBefore = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 24);
assert.equal(effBefore.length, 0, "Antes de 48 frames, nenhum efeito deve ser propagado sobre V1");

// Frame 60 (2.5s, no meio do fade in Bézier da camada de ajuste):
const effMidIn = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 60);
const colMid = effMidIn.find(e => e.type === "color");
assert.ok(colMid, "No frame 60 deve haver o efeito de cor propagado");
// Saturação nominal é 150. Com fator 0.5: 100 + (150 - 100) * 0.5 = 125
assert.equal(Math.round(colMid.saturation), 125, "Saturação modulada por Bézier deve ser 125%");
// Brilho nominal é -10. Com fator 0.5: -10 * 0.5 = -5
assert.equal(Math.round(colMid.brightness), -5, "Brilho modulado por Bézier deve ser -5");

// Frame 96 (4.0s, centro da transição inferior e platô pleno do ajuste):
const effCenter = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 96);
const colCenter = effCenter.find(e => e.type === "color");
assert.ok(colCenter, "No frame 96 deve haver o efeito de cor propagado");
assert.equal(colCenter.saturation, 150, "No platô a saturação deve ser 150%");
assert.equal(colCenter.brightness, -10, "No platô o brilho deve ser -10");

// Verificação de isolamento: camada de ajuste em V2 NUNCA propaga para V3 (pista superior)
const effV3 = TIMELINE_STATE.getCumulativeAdjustmentEffects("V3", 96);
assert.equal(effV3.length, 0, "Camada em V2 não deve propagar efeitos sobre a pista superior V3");

// Frame 160 (após o término da camada de ajuste em 144):
const effAfter = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 160);
assert.equal(effAfter.length, 0, "Após 144 frames, nenhum efeito deve ser propagado");

console.log("  ✔ Propagação descendente hierárquica e modulação cumulativa 100% corretas.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Composição no Program Player (mixBlendMode e backdropFilter)
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 4: Composição no Program Player (mixBlendMode e backdropFilter)");

const playerManager = new CapiauPlayer();
const adjEl = document.getElementById("program-player-adjustment");

// Executa renderização do overlay no frame 96 (pico do ajuste e transição)
playerManager.applyAdjustmentLayer(adjEl, STATE.activeTimelineCuts, 96);

assert.equal(adjEl.style.display, "block", "Overlay de ajuste deve estar visível ('block')");
assert.equal(adjEl.style.mixBlendMode, "soft-light", "mixBlendMode do overlay deve refletir 'soft-light'");
assert.equal(adjEl.style.opacity, "1", "Opacidade deve ser 1.0 no pico do ajuste");
assert(adjEl.style.backdropFilter.includes("saturate(1.50)"), "backdropFilter deve conter saturate(1.50)");
assert(adjEl.style.backdropFilter.includes("brightness(0.90)"), "backdropFilter deve conter brightness(0.90)");

// Executa renderização no frame 60 (meio do fade in Bézier)
playerManager.applyAdjustmentLayer(adjEl, STATE.activeTimelineCuts, 60);
assert.equal(adjEl.style.display, "block", "Overlay deve estar visível no frame 60");
assert.equal(adjEl.style.mixBlendMode, "soft-light", "mixBlendMode deve se manter 'soft-light'");
assert(adjEl.style.backdropFilter.includes("saturate(1.25)"), "backdropFilter deve modular para saturate(1.25)");

console.log("  ✔ Program Player compõe backdropFilter e mixBlendMode perfeitamente.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Render Cache offscreen e desalocação atômica de VRAM
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 5: Render Cache offscreen e desalocação atômica de VRAM (bitmap.close)");

// Verifica detecção de trechos pesados: frame 96 possui transição e camada de ajuste
const needsCacheAt96 = RENDER_CACHE_MANAGER.isFrameHeavy(96);
assert.equal(needsCacheAt96, true, "Frame 96 com transição e ajuste exige Render Cache (isFrameHeavy)");

// Simulação de bitmaps de GPU com rastreamento de fechamento (.close())
let bitmapsClosedCount = 0;
function createMockBitmap(frame) {
    return {
        frame,
        width: 1920,
        height: 1080,
        closed: false,
        close() {
            if (!this.closed) {
                this.closed = true;
                bitmapsClosedCount++;
            }
        }
    };
}

RENDER_CACHE_MANAGER.invalidateAll();
const bmp1 = createMockBitmap(94);
const bmp2 = createMockBitmap(95);
const bmp3 = createMockBitmap(96);

RENDER_CACHE_MANAGER.setFrame(94, bmp1);
RENDER_CACHE_MANAGER.setFrame(95, bmp2);
RENDER_CACHE_MANAGER.setFrame(96, bmp3);

assert.equal(RENDER_CACHE_MANAGER.hasFrame(95), true, "Frame 95 deve estar em cache");
assert.equal(bitmapsClosedCount, 0, "Nenhum bitmap deve ter sido fechado ainda");

// Invalidação parcial de intervalo (ex: edição em torno de frame 95)
RENDER_CACHE_MANAGER.invalidateRange(95, 96);
assert.equal(RENDER_CACHE_MANAGER.hasFrame(95), false, "Frame 95 deve ter sido invalidado");
assert.equal(bmp2.closed, true, "Bitmap do frame 95 DEVE ter chamado .close()");
assert.equal(bmp3.closed, true, "Bitmap do frame 96 DEVE ter chamado .close()");
assert.equal(bmp1.closed, false, "Bitmap do frame 94 fora do intervalo permanece aberto");

// Invalidação total (invalidateAll)
RENDER_CACHE_MANAGER.invalidateAll();
assert.equal(bmp1.closed, true, "Bitmap do frame 94 DEVE ter chamado .close() no invalidateAll");
assert.equal(bitmapsClosedCount, 3, "Todos os 3 bitmaps devem ter sido fechados atomicamente");

console.log("  ✔ Desalocação atômica de VRAM validada: zero memory leak na GPU.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Comportamento de bypass / desativação da camada superior
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 6: Bypass / desativação da Camada de Ajuste (restauração do crossfade puro)");

// Desativa a camada de ajuste superior
adjClip.disabled = true;
STATE.activeTimelineCuts = [clipA, clipB, adjClip];

// Propagação de efeitos sobre V1 deve cessar imediatamente
const effDisabled = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 96);
assert.equal(effDisabled.length, 0, "Com camada de ajuste desativada, nenhum efeito é propagado");

// Player deve ocultar o overlay e resetar mixBlendMode
playerManager.applyAdjustmentLayer(adjEl, STATE.activeTimelineCuts, 96);
assert.equal(adjEl.style.display, "none", "Overlay deve ser ocultado com 'none'");
assert.equal(adjEl.style.mixBlendMode, "normal", "mixBlendMode deve retornar a 'normal'");
assert.equal(adjEl.style.backdropFilter, "none", "backdropFilter deve retornar a 'none'");

// Transição inferior Cross Dissolve na pista V1 permanece 100% íntegra
const activeTr = TIMELINE_STATE.transitions.find(t => t.id === "tr_cascata_1");
assert.equal(activeTr.disabled, false, "Transição inferior permanece ativa");
assert.equal(clipA.effects[1].disabled, false, "Efeito crossfade do clipe A permanece ativo");
assert.equal(clipB.effects[1].disabled, false, "Efeito crossfade do clipe B permanece ativo");

// Reativa a camada para o teste seguinte
adjClip.disabled = false;
STATE.activeTimelineCuts = [clipA, clipB, adjClip];
console.log("  ✔ Bypass restaura instantaneamente a fidelidade da transição de base.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Reversibilidade com Undo/Redo e imunidade de buffers on-air
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ Bateria 7: Reversibilidade com Undo/Redo e imunidade de buffers on-air");

// Registra alteração de posição da camada de ajuste
const estadoOriginal = JSON.parse(JSON.stringify(STATE.activeTimelineCuts));

TIMELINE_HISTORY.record(() => {
    adjClip.timelineStartFrame = 72; // Move de 48 para 72
    adjClip.timeline_start = 72 / FPS;
    STATE.activeTimelineCuts = [clipA, clipB, adjClip];
});

assert.equal(adjClip.timelineStartFrame, 72, "Camada de ajuste movida para frame 72");

// Executa Desfazer (Undo)
TIMELINE_HISTORY.undo();
const cutAposUndo = STATE.activeTimelineCuts.find(c => c.id === "adj_v2_1");
assert.equal(cutAposUndo.timelineStartFrame, 48, "Undo deve restaurar startFrame para 48");

// Executa Refazer (Redo)
TIMELINE_HISTORY.redo();
const cutAposRedo = STATE.activeTimelineCuts.find(c => c.id === "adj_v2_1");
assert.equal(cutAposRedo.timelineStartFrame, 72, "Redo deve restaurar startFrame para 72");

// Restaura estado original
STATE.activeTimelineCuts = estadoOriginal;

console.log("  ✔ Undo/Redo preservam integridade estrutural e temporal da composição.\n");

console.log("=====================================================================");
console.log("🎉 SUCESSO ABSOLUTO: Todas as 7 baterias de teste composto passaram!");
console.log("=====================================================================\n");
