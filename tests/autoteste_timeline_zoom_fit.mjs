// Autoteste: Ajustar Sequência na Tela (Zoom to Fit), Toggle NLE e Perfis de Atalhos
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Ajustar Sequência na Tela (Zoom to Fit) & Perfis NLE...\n");

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    defaultView: globalThis,
    getElementById: () => null,
    querySelectorAll: () => []
};

// 1. Validar Catálogo e Perfis de Atalhos em keymapService.js
console.log("1. Validando comandos no catálogo e perfis NLE (keymapService.js)...");
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");

const cmdFit = COMMANDS_CATALOG.find(c => c.id === "timeline.zoom_fit");
const cmdIn = COMMANDS_CATALOG.find(c => c.id === "timeline.zoom_in");
const cmdOut = COMMANDS_CATALOG.find(c => c.id === "timeline.zoom_out");
const cmdReset = COMMANDS_CATALOG.find(c => c.id === "timeline.zoom_reset");

assert.ok(cmdFit, "Comando timeline.zoom_fit deve existir no catálogo");
assert.equal(cmdFit.category, "canvas_history", "timeline.zoom_fit deve pertencer à categoria canvas_history");
assert.ok(cmdIn, "Comando timeline.zoom_in deve existir no catálogo");
assert.ok(cmdOut, "Comando timeline.zoom_out deve existir no catálogo");
assert.ok(cmdReset, "Comando timeline.zoom_reset deve existir no catálogo");

// Valida atalhos por perfil
console.log("  ✔ Catálogo verificado com sucesso.");

console.log("  Validando preset Premiere Pro (Backslash)...");
KEYMAP_SERVICE.setPreset("premiere");
assert.ok(KEYMAP_PRESETS.premiere["timeline.zoom_fit"].includes("Backslash"), "Premiere deve ter atalho Backslash");
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "Backslash", key: "\\", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "Premiere deve reconhecer a tecla \\ para zoom_fit"
);

console.log("  Validando preset DaVinci Resolve (Shift+Z)...");
KEYMAP_SERVICE.setPreset("resolve");
assert.ok(KEYMAP_PRESETS.resolve["timeline.zoom_fit"].includes("Shift+KeyZ"), "Resolve deve ter atalho Shift+KeyZ");
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "KeyZ", key: "Z", ctrlKey: false, shiftKey: true, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "Resolve deve reconhecer Shift+Z para zoom_fit"
);

console.log("  Validando preset Final Cut Pro (Shift+Z)...");
KEYMAP_SERVICE.setPreset("finalcut");
assert.ok(KEYMAP_PRESETS.finalcut["timeline.zoom_fit"].includes("Shift+KeyZ"), "Final Cut deve ter atalho Shift+KeyZ");
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "KeyZ", key: "Z", ctrlKey: false, shiftKey: true, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "Final Cut deve reconhecer Shift+Z para zoom_fit"
);

console.log("  Validando preset Kdenlive (Ctrl+Shift+Espaço e Period)...");
KEYMAP_SERVICE.setPreset("kdenlive");
assert.ok(KEYMAP_PRESETS.kdenlive["timeline.zoom_fit"].includes("Ctrl+Shift+Space"), "Kdenlive deve ter Ctrl+Shift+Space");
assert.ok(KEYMAP_PRESETS.kdenlive["timeline.zoom_reset"].includes("Period"), "Kdenlive deve ter Period (.) para reset de zoom");
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "Space", key: " ", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "Kdenlive deve reconhecer Ctrl+Shift+Espaço para zoom_fit"
);

console.log("  Validando preset CapIAu Padrão (Suporte universal \\ e Shift+Z)...");
KEYMAP_SERVICE.setPreset("capiau");
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "Backslash", key: "\\", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "CapIAu Padrão deve reconhecer \\ para zoom_fit"
);
assert.strictEqual(
    KEYMAP_SERVICE.matches({ code: "KeyZ", key: "Z", ctrlKey: false, shiftKey: true, altKey: false, metaKey: false }, "timeline.zoom_fit"),
    true,
    "CapIAu Padrão deve reconhecer Shift+Z para zoom_fit"
);
console.log("  ✔ Todos os 5 perfis NLE validados com sucesso.\n");

// 2. Validar TIMELINE_STATE.zoomToFit() e Alternância (Toggle)
console.log("2. Validando lógica de cálculo e Toggle NLE em TIMELINE_STATE...");
const { TIMELINE_STATE } = await import("../src/ui/js/timelineState.js");
const { STATE } = await import("../src/ui/js/state.js");

// Teste em timeline vazia
STATE.activeTimelineCuts = [];
TIMELINE_STATE.zoom = 2.5;
TIMELINE_STATE.scrollLeftFrame = 200;
TIMELINE_STATE.zoomToFit(1000);
assert.equal(TIMELINE_STATE.zoom, 0.5, "Em timeline vazia, zoom deve ir para padrão 0.5");
assert.equal(TIMELINE_STATE.scrollLeftFrame, 0, "Em timeline vazia, scroll deve ir para 0");
assert.equal(TIMELINE_STATE._isFitted, false, "Em timeline vazia, _isFitted deve ser false");
console.log("  ✔ Comportamento em timeline vazia validado.");

// Simular clipes na timeline: Clipes até o frame 1.200 (50 segundos a 24fps)
STATE.activeTimelineCuts = [
    { id: "c1", timelineStartFrame: 0, inFrame: 0, outFrame: 600, track: "v1" },
    { id: "c2", timelineStartFrame: 600, inFrame: 0, outFrame: 600, track: "v1" }
];
assert.equal(TIMELINE_STATE.getDurationFrames(), 1200, "Duração total deve ser 1.200 frames");

// Configurar estado prévio de trabalho (zoom 3.0, scroll 150)
TIMELINE_STATE.setZoom(3.0);
TIMELINE_STATE.setScrollLeftFrame(150);

let lastFittedEvent = null;
STATE.on("timelineZoomFitted", (data) => { lastFittedEvent = data; });

// 1º Acionamento do Zoom to Fit: Viewport de 1.000px
// Margem = min(60, max(20, 1000 * 0.05)) = 50px. Usable = 950px. Fit zoom = 950 / 1200 = 0.791666...
TIMELINE_STATE.zoomToFit(1000);

assert.equal(TIMELINE_STATE._isFitted, true, "_isFitted deve ser true após primeiro acionamento");
assert.ok(Math.abs(TIMELINE_STATE.zoom - (950 / 1200)) < 0.001, "Zoom deve ser ~0.7917 px/f");
assert.equal(TIMELINE_STATE.scrollLeftFrame, 0, "Scroll deve ser 0 para mostrar o início da sequência");
assert.equal(lastFittedEvent?.isFitted, true, "Evento timelineZoomFitted deve emitir isFitted=true");
console.log("  ✔ 1º Acionamento: Enquadramento correto da sequência (0.7917 px/f) validado.");

// 2º Acionamento do Zoom to Fit (Toggle): Deve restaurar o estado de trabalho anterior (zoom 3.0, scroll 150)
TIMELINE_STATE.zoomToFit(1000);

assert.equal(TIMELINE_STATE._isFitted, false, "_isFitted deve ser false após segundo acionamento (Toggle)");
assert.equal(TIMELINE_STATE.zoom, 3.0, "Zoom deve restaurar para 3.0");
assert.equal(TIMELINE_STATE.scrollLeftFrame, 150, "Scroll deve restaurar para 150 frames");
assert.equal(lastFittedEvent?.isFitted, false, "Evento timelineZoomFitted deve emitir isFitted=false");
console.log("  ✔ 2º Acionamento (Toggle): Restauração exata do zoom (3.0) e scroll (150) validados.");

// 3º Acionamento: Volta a enquadrar
TIMELINE_STATE.zoomToFit(1000);
assert.equal(TIMELINE_STATE._isFitted, true, "Deve enquadrar novamente");

// Invalidação inteligente: se o usuário ajustar o zoom manualmente, desfaz o estado fit
TIMELINE_STATE.setZoom(1.5);
assert.equal(TIMELINE_STATE._isFitted, false, "setZoom manual deve desarmar _isFitted");
console.log("  ✔ Invalidação inteligente de toggle no zoom manual validada.\n");

// 3. Validar arquivos de interface (index.html, panels.js, timelineInteraction.js)
console.log("3. Validando integridade dos arquivos de UI e atalhos...");

const indexHtml = fs.readFileSync(path.join(ROOT, "src/ui/index.html"), "utf-8");
assert.ok(indexHtml.includes('id="btn-timeline-zoom-fit"'), "index.html deve conter o botão btn-timeline-zoom-fit");

const panelsJs = fs.readFileSync(path.join(ROOT, "src/ui/js/panels.js"), "utf-8");
assert.ok(panelsJs.includes('btn-timeline-zoom-fit'), "panels.js deve conectar o botão btn-timeline-zoom-fit");
assert.ok(panelsJs.includes('timelineZoomFitted'), "panels.js deve ouvir o evento timelineZoomFitted");

const interactionJs = fs.readFileSync(path.join(ROOT, "src/ui/js/timelineInteraction.js"), "utf-8");
assert.ok(interactionJs.includes('timeline.zoom_fit'), "timelineInteraction.js deve mapear timeline.zoom_fit");
assert.ok(interactionJs.includes('timeline.zoom_reset'), "timelineInteraction.js deve mapear timeline.zoom_reset");
assert.ok(interactionJs.includes('timeline.zoom_in'), "timelineInteraction.js deve mapear timeline.zoom_in");
assert.ok(interactionJs.includes('timeline.zoom_out'), "timelineInteraction.js deve mapear timeline.zoom_out");

console.log("  ✔ Arquivos index.html, panels.js e timelineInteraction.js 100% íntegros.\n");

console.log("============================================================");
console.log("🎉 AUTOTESTE DE ZOOM TO FIT & PERFIS NLE 100% APROVADO!");
console.log("============================================================");
