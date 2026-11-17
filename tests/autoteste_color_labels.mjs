import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Polyfills mínimos para executar módulos da UI em Node
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
const _storage = new Map();
globalThis.localStorage = {
    getItem: (k) => (_storage.has(k) ? _storage.get(k) : null),
    setItem: (k, v) => _storage.set(k, String(v)),
    removeItem: (k) => _storage.delete(k),
    clear: () => _storage.clear(),
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
        style: {},
        className: "",
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        removeEventListener() {},
        appendChild() {},
        remove() {},
        getContext: () => null,
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { appendChild() {} },
};

const { STATE } = await import("../src/ui/js/state.js");
const {
    TIMELINE_STATE,
    TIMELINE_HISTORY,
    CLIP_COLOR_LABELS,
    resolveClipColorLabel,
} = await import("../src/ui/js/timelineState.js");
const { corteParaSalvar, corteDoBanco } = await import("../src/ui/js/timelinePersistencia.js");

console.log("=== AUTOTESTE: TASK 22 (COLOR LABELS), CROP CLAMP E HISTÓRICO FPS/RESOLUÇÃO ===\n");

// 1. Paleta oficial de 8 cores e resolveClipColorLabel
console.log("1. Testando CLIP_COLOR_LABELS (8 cores) e resolveClipColorLabel...");
assert.equal(CLIP_COLOR_LABELS.length, 8, "Devem existir exatamente 8 rótulos de cor NLE");
for (const c of CLIP_COLOR_LABELS) {
    assert.ok(c.id && c.name && /^#[0-9a-fA-F]{6}$/.test(c.hex), `Cor inválida na paleta: ${JSON.stringify(c)}`);
}
assert.equal(resolveClipColorLabel("violet")?.id, "violet");
assert.equal(resolveClipColorLabel("Violeta")?.id, "violet");
assert.equal(resolveClipColorLabel("blue")?.id, "royal_blue");
assert.equal(resolveClipColorLabel("yellow")?.id, "sun_yellow");
assert.equal(resolveClipColorLabel("gray")?.id, "neutral_gray");
assert.equal(resolveClipColorLabel("âmbar")?.id, "amber");
assert.equal(resolveClipColorLabel("#10b981")?.id, "emerald");
assert.equal(resolveClipColorLabel("none"), null);
assert.equal(resolveClipColorLabel("default"), null);
assert.equal(resolveClipColorLabel(null), null);
console.log("   ✔ Paleta e resolução de aliases/hex/limpeza validados.");

// 2. Aplicação individual, em lote, track lock e Undo/Redo
console.log("2. Testando setClipColorLabel (individual, multisseleção, Track Lock e Undo/Redo)...");
TIMELINE_STATE.fps = 30;
TIMELINE_STATE.width = 1920;
TIMELINE_STATE.height = 1080;
TIMELINE_STATE.setTracks([
    { id: "V1", type: "video", name: "V1", locked: false, visible: true, muted: false },
    { id: "V2", type: "video", name: "V2", locked: true, visible: true, muted: false },
]);
STATE.activeTimelineCuts = [
    { id: "clip-1", track: "V1", timeline_start: 0, start: 0, end: 3, source_file: "a.mp4", colorLabel: null },
    { id: "clip-2", track: "V1", timeline_start: 3, start: 0, end: 3, source_file: "b.mp4", colorLabel: null },
    { id: "clip-locked", track: "V2", timeline_start: 0, start: 0, end: 3, source_file: "c.mp4", colorLabel: null },
];
TIMELINE_HISTORY.clear();

// Individual
const r1 = TIMELINE_STATE.setClipColorLabel("clip-1", "emerald");
assert.equal(r1.updated, 1);
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-1").colorLabel, "emerald");

// Multisseleção com 1 pista travada (V2 ignorada)
TIMELINE_STATE.selectedClipIds = new Set(["clip-1", "clip-2", "clip-locked"]);
TIMELINE_STATE.selectedClipId = "clip-1";
const r2 = TIMELINE_STATE.setClipColorLabel(Array.from(TIMELINE_STATE.selectedClipIds), "amber");
assert.equal(r2.updated, 2, "Apenas clip-1 e clip-2 devem ser atualizados (clip-locked em pista travada)");
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-1").colorLabel, "amber");
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-2").colorLabel, "amber");
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-locked").colorLabel, null);

// Undo e Redo
assert.equal(TIMELINE_HISTORY.undo(), true);
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-1").colorLabel, "emerald");
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-2").colorLabel, null);
assert.equal(TIMELINE_HISTORY.redo(), true);
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-1").colorLabel, "amber");
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-2").colorLabel, "amber");

// Limpeza de cor
const r3 = TIMELINE_STATE.setClipColorLabel(["clip-1"], "none");
assert.equal(r3.updated, 1);
assert.equal(STATE.activeTimelineCuts.find((c) => c.id === "clip-1").colorLabel, null);
console.log("   ✔ setClipColorLabel, Track Lock e Undo/Redo funcionando corretamente.");

// 3. Persistência (state.js, timelinePersistencia.js, schemas.py)
console.log("3. Testando persistência de colorLabel no state, timelinePersistencia e schemas.py...");
STATE.activeTimelineCuts = [
    { id: "clip-p", track: "V1", timeline_start: 0, start: 0, end: 2, color_label: "cyan" },
];
assert.equal(STATE.activeTimelineCuts[0].colorLabel, "cyan", "Setter de state.js deve normalizar color_label -> colorLabel");

const salvo = corteParaSalvar({ id: "clip-p", start: 0, end: 2, colorLabel: "rose" }, 30);
assert.equal(salvo.colorLabel, "rose", "corteParaSalvar deve preservar colorLabel");

const carregado = corteDoBanco({ id: "clip-p", start: 0, end: 2, color_label: "sun_yellow" }, 0, 30);
assert.equal(carregado.colorLabel, "sun_yellow", "corteDoBanco deve restaurar colorLabel/color_label");

const schemasPy = fs.readFileSync(path.join(ROOT, "src", "api", "schemas.py"), "utf8");
assert.ok(schemasPy.includes("colorLabel: Optional[str] = None"), "CutItem em schemas.py deve incluir colorLabel");
console.log("   ✔ Persistência front-end e schema back-end validados.");

// 4. Histórico de fps, width e height (VPT.16)
console.log("4. Testando TIMELINE_HISTORY com fps, width e height...");
TIMELINE_HISTORY.clear();
TIMELINE_STATE.fps = 30;
TIMELINE_STATE.width = 1920;
TIMELINE_STATE.height = 1080;
TIMELINE_HISTORY.record(() => {
    TIMELINE_STATE.fps = 60;
    TIMELINE_STATE.width = 1080;
    TIMELINE_STATE.height = 1920;
});

assert.equal(TIMELINE_HISTORY.undo(), true);
assert.equal(TIMELINE_STATE.fps, 30);
assert.equal(TIMELINE_STATE.width, 1920);
assert.equal(TIMELINE_STATE.height, 1080);

assert.equal(TIMELINE_HISTORY.redo(), true);
assert.equal(TIMELINE_STATE.fps, 60);
assert.equal(TIMELINE_STATE.width, 1080);
assert.equal(TIMELINE_STATE.height, 1920);
console.log("   ✔ Undo/Redo de fps/width/height validado.");

// 5. Menu de contexto, renderização no canvas e clampCropPair
console.log("5. Verificando menu de contexto, renderização no canvas e clampCropPair...");
const interactionJs = fs.readFileSync(path.join(ROOT, "src", "ui", "js", "timelineInteraction.js"), "utf8");
const rendererJs = fs.readFileSync(path.join(ROOT, "src", "ui", "js", "timelineRenderer.js"), "utf8");

assert.ok(interactionJs.includes("Rotular Cor"), "Menu de contexto deve oferecer 'Rotular Cor'");
assert.ok(interactionJs.includes("Padrão da Pista"), "Submenu deve oferecer opção 'Padrão da Pista'");
assert.ok(rendererJs.includes("COLOR_LABEL_STYLE_CACHE") && rendererJs.includes("resolveClipColorLabel"), "timelineRenderer deve usar cache estável e resolver colorLabel");
assert.ok(rendererJs.includes("colorLabelObj.hex"), "timelineRenderer deve desenhar tarja/chip com a cor do rótulo");

// Testar clampCropPair via import dinâmico se disponível
const { clampCropPair } = await import("../src/ui/js/timelineInteraction.js");
assert.equal(clampCropPair({ left: 70, right: 10 }, "right", 50), 20, "left=70 deve limitar right a 20 (soma <= 90)");
assert.equal(clampCropPair({ top: 45, bottom: 30 }, "bottom", 60), 45, "top=45 deve limitar bottom a 45 (soma <= 90)");
assert.equal(clampCropPair({ left: 10, right: 10 }, "left", -5), 0, "Valor negativo deve ser clampado para 0");
console.log("   ✔ Menu de contexto, canvas renderer e clampCropPair validados.");

console.log("\n=== AUTOTESTE COLOR LABELS CONCLUÍDO COM SUCESSO: 100% DE APROVAÇÃO ===");
