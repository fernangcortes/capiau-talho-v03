// Autoteste: Transição Limpa Trim -> Mover (Mãozinha) e Resiliência de Eventos
// Execução: node tests/autoteste_trim_cursor_transition.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

let canvasCursor = "default";
const mockCanvas = {
    getContext: () => ({
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
        fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 50 }),
        fillText() {}, scale() {}, clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
    }),
    ownerDocument: null,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {
        get cursor() { return canvasCursor; },
        set cursor(v) { canvasCursor = v; }
    },
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    removeAttribute: () => {},
    setAttribute: () => {}
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => (id === "timeline-canvas" ? mockCanvas : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: "" }),
    body: { appendChild: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {}
};
mockCanvas.ownerDocument = globalThis.document;

console.log("▶ Iniciando autoteste da Transição Limpa Trim -> Move (Mãozinha)...");

const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

const mockRenderer = {
    canvas: mockCanvas,
    rulerHeight: 30,
    width: 1000,
    height: 400,
    getLane(trackId) {
        if (trackId === "V1") return { track: { id: "V1", kind: "video" }, top: 30, height: 50 };
        if (trackId === "A1") return { track: { id: "A1", kind: "audio" }, top: 80, height: 50 };
        return null;
    },
    getTrackAtY(y) {
        if (y >= 30 && y < 80) return { id: "V1", kind: "video" };
        if (y >= 80 && y < 130) return { id: "A1", kind: "audio" };
        return null;
    },
    requestRedraw() {}
};

const interaction = new CapiauTimelineInteraction(mockRenderer);

TIMELINE_STATE.zoom = 1.0; // 1 pixel por frame
TIMELINE_STATE.scrollLeftFrame = 0;
TIMELINE_STATE.activeTool = "select";

// ── 1. Validação de Isolamento e Resiliência em EventEmitter ──
console.log("\n1. Validando resiliência de EventEmitter em state.js...");
let faultyListenerCalled = false;
let healthyListenerCalled = false;

STATE.on("testeIsolamento", () => {
    faultyListenerCalled = true;
    throw new Error("Erro simulado em ouvinte falho");
});
STATE.on("testeIsolamento", () => {
    healthyListenerCalled = true;
});

assert.doesNotThrow(() => {
    STATE.emit("testeIsolamento", { test: true });
}, "EventEmitter.emit não deve propagar exceção de ouvinte falho");
assert.ok(faultyListenerCalled, "Ouvinte falho foi invocado");
assert.ok(healthyListenerCalled, "Ouvinte saudável foi invocado com sucesso mesmo após falha do anterior");
console.log("  ✔ EventEmitter com isolamento de falha validado com sucesso.");

// ── 2. Validação do Ciclo Trim -> Limpeza -> Hover Mãozinha (grab) ──
console.log("\n2. Validando ciclo completo de Trim e retorno à mãozinha...");

STATE.activeTimelineCuts = [
    { id: "v1", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, mediaDurationFrames: 500, link_id: "link_av_1" },
    { id: "a1", track: "A1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, mediaDurationFrames: 500, link_id: "link_av_1" }
];

// 2.1 Hover na borda direita (x = 200, y = 50)
interaction.onMouseMove({ clientX: 200, clientY: 50, buttons: 0 });
assert.equal(interaction.canvas.style.cursor, "w-resize", "Cursor na borda deve ser w-resize");

// 2.2 MouseDown para iniciar trim
interaction.onMouseDown({ clientX: 200, clientY: 50, button: 0, shiftKey: false, altKey: false, ctrlKey: false, preventDefault: () => {} });
assert.equal(interaction.dragState, "trim-right", "dragState deve ser trim-right");

// 2.3 Arrastar para estender clipe em +30 frames (x = 230)
interaction.onMouseMove({ clientX: 230, clientY: 50, buttons: 1, preventDefault: () => {} });
assert.equal(STATE.activeTimelineCuts.find(c => c.id === "v1").outFrame, 130);
assert.equal(STATE.activeTimelineCuts.find(c => c.id === "a1").outFrame, 130);

// 2.4 MouseUp: Finaliza o trim
interaction.onMouseUp({ clientX: 230, clientY: 50, button: 0, preventDefault: () => {} });
assert.equal(interaction.dragState, null, "dragState DEVE ser null após onMouseUp");
assert.equal(interaction.draggedClipId, null, "draggedClipId DEVE ser null após onMouseUp");
assert.equal(interaction.dragOriginalCuts, null, "dragOriginalCuts DEVE ser limpo no onMouseUp");

// 2.5 Mover para o interior do clipe (x = 160, y = 50)
interaction.onMouseMove({ clientX: 160, clientY: 50, buttons: 0, preventDefault: () => {} });
assert.equal(interaction.canvas.style.cursor, "grab", "Cursor no interior do clipe DEVE ser 'grab' (mãozinha)");
console.log("  ✔ Saída automática da função trim para mãozinha ('grab') validada.");

// ── 3. Validação de Arraste Direto sem Clicar Fora ──
console.log("\n3. Validando arraste do clipe imediatamente após o trim...");

// 3.1 MouseDown no centro do clipe (x = 160)
interaction.onMouseDown({ clientX: 160, clientY: 50, button: 0, shiftKey: false, altKey: false, ctrlKey: false, preventDefault: () => {} });
assert.equal(interaction.dragState, "drag-clip", "dragState deve entrar em 'drag-clip' direto");
assert.equal(interaction.canvas.style.cursor, "grabbing", "Cursor durante mousedown no clipe deve ser 'grabbing'");

// 3.2 Arrastar clipe +40 frames para a direita (x = 200)
interaction.onMouseMove({ clientX: 200, clientY: 50, buttons: 1, preventDefault: () => {} });
assert.equal(interaction.canvas.style.cursor, "grabbing", "Cursor durante arraste deve permanecer 'grabbing'");

const movedV1 = STATE.activeTimelineCuts.find(c => c.id === "v1");
const movedA1 = STATE.activeTimelineCuts.find(c => c.id === "a1");
assert.equal(movedV1.timelineStartFrame, 140, "Vídeo v1 deve ter sido movido para frame 140");
assert.equal(movedA1.timelineStartFrame, 140, "Áudio a1 vinculado deve ter acompanhado em frame 140");

// 3.3 MouseUp após mover
interaction.onMouseUp({ clientX: 200, clientY: 50, button: 0, preventDefault: () => {} });
assert.equal(interaction.dragState, null, "dragState deve ser null após soltar");
assert.equal(interaction.canvas.style.cursor, "grab", "Cursor deve voltar para 'grab' sobre o corpo do clipe");
console.log("  ✔ Arraste fluido de par A/V e transição de cursores grab/grabbing validados.");

// ── 4. Validação de Cache-Busters em index.html ──
console.log("\n4. Validando cache-busters no index.html...");
const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "index.html");
const html = readFileSync(htmlPath, "utf8");
assert.ok(/styles\.css\?v=(?:3[6-9]|[4-9]\d)/.test(html), "styles.css deve estar em ?v>=36");
assert.ok(/main\.js\?v=(?:3[6-9]|[4-9]\d)/.test(html), "main.js deve estar em ?v>=36");
console.log("  ✔ Cache-busters atualizados para v>=36.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DE TRANSIÇÃO TRIM -> MOVE 100% APROVADO!");
console.log("============================================================\n");
