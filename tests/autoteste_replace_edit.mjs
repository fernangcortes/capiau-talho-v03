// autoteste_replace_edit.mjs
// Task 9 do PLANO_SUITE_NLE_CLASSICO — Substituição de Clipe na Timeline (Replace Edit):
//  • Troca de mídia preservando rigorosamente a duração exata, velocidade, cor e efeitos (Ken Burns).
//  • Atalho de teclado Ctrl+Shift+R (Replace from Source) nos 5 perfis NLE.
//  • Drop com Alt a partir da biblioteca sobre clipe existente.
//  • Feedback visual do indicador [REPLACE] sobre o clipe alvo.
//  • Transição limpa: refinamento de trecho interno delegado à Ferramenta Slip Tool (Y).

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

const domRegistry = {};
function makeEl(id) {
    return {
        id: id || "",
        style: {},
        innerHTML: "",
        textContent: "",
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {},
        getAttribute: () => null,
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
}
const canvasStub = {
    getContext: () => ({
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
        fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 50 }), fillText() {}, scale() {},
        clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
    }),
    ownerDocument: globalThis.document,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    closest: () => null,
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
    createElement: () => makeEl(null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } },
    addEventListener: () => {},
    removeEventListener: () => {}
};
canvasStub.ownerDocument = globalThis.document;

const toasts = [];
globalThis.showToast = (msg, type) => toasts.push([msg, type]);
const twoUpCalls = [];
globalThis.player = {
    show2UpPreview: (...args) => twoUpCalls.push(["show", ...args]),
    hide2UpPreview: () => twoUpCalls.push(["hide"])
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const readSrc = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "js", f), "utf-8");
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const tsSrc = readSrc("timelineState.js");
const tiSrc = readSrc("timelineInteraction.js");
const trSrc = readSrc("timelineRenderer.js");
const plSrc = readSrc("player.js");
const lbSrc = readSrc("library.js");
const wsSrc = readSrc("workspaceManager.js");
const keySrc = readSrc("keymapService.js");

// ── 1. Verificações estáticas da fiação da Task 9 ──
console.log("1. Verificações estáticas dos fontes...");
assert.ok(tsSrc.includes("replaceClip(targetClipId, newMediaId, alignMode = \"in\""), "timelineState.js deve implementar replaceClip");
assert.ok(tiSrc.includes("tryAltReplaceDrop(payload, frame, track, y = null)"), "interação deve implementar tryAltReplaceDrop");
assert.ok(tiSrc.includes("renderReplaceDragIndicator(replaceHit.data)"), "interação deve acionar renderReplaceDragIndicator");
assert.ok(trSrc.includes('type === "replace"'), "renderer deve ter o branch replace");
assert.ok(trSrc.includes('"[REPLACE]"'), "renderer deve desenhar o selo [REPLACE]");
assert.ok(plSrc.includes("replaceClipFromSource()"), "player deve ter replaceClipFromSource (Ctrl+Shift+R)");
assert.ok(plSrc.includes('"edit.replace_clip"'), "player deve tratar o comando edit.replace_clip");
assert.equal(countOf(lbSrc, '!e.ctrlKey && !e.metaKey && (e.code === "KeyR"'), 2, "library: rotação (R) deve ignorar Ctrl/Meta");
assert.equal(countOf(wsSrc, "!e.ctrlKey && !e.metaKey"), 2, "workspaceManager: rotação (R) deve ignorar Ctrl/Meta");
console.log("  ✔ Fontes contêm a fiação completa da Task 9 (Replace Edit).");

// ── 2. Catálogo, 5 perfis NLE e Cheat Sheet (edit.replace_clip) ──
console.log("\n2. Catálogo, 5 perfis NLE e Cheat Sheet...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");
const cmd = COMMANDS_CATALOG.find(c => c.id === "edit.replace_clip");
assert.ok(cmd, "edit.replace_clip deve estar no COMMANDS_CATALOG");
assert.equal(cmd.category, "edit");
assert.ok(cmd.label && cmd.label.includes("Substituir"), "rótulo deve mencionar Substituir");
assert.ok(cmd.description, "comando deve ter descrição informativa");
assert.equal(countOf(keySrc, '"edit.replace_clip": ["Ctrl+Shift+KeyR"]'), 5, "Ctrl+Shift+R deve estar mapeado nos 5 presets");

const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
for (const p of presetsEsperados) {
    const cfg = KEYMAP_PRESETS[p];
    assert.ok(cfg, `preset '${p}' deve existir`);
    const bind = cfg["edit.replace_clip"];
    assert.ok(Array.isArray(bind) && bind.includes("Ctrl+Shift+KeyR"), `preset '${p}' deve mapear Ctrl+Shift+KeyR`);
    const owners = Object.entries(cfg).filter(([, v]) => Array.isArray(v) && v.includes("Ctrl+Shift+KeyR"));
    assert.equal(owners.length, 1, `Ctrl+Shift+KeyR não pode colidir no preset '${p}'`);
    assert.equal(owners[0][0], "edit.replace_clip");
    KEYMAP_SERVICE.setPreset(p);
    const badges = KEYMAP_SERVICE.getShortcutBadgesHTML("edit.replace_clip");
    assert.ok(badges && badges.includes("R"), `Cheat Sheet deve mostrar R no preset '${p}'`);
    assert.ok(badges.includes("Shift"), `Cheat Sheet deve mostrar Shift no preset '${p}'`);
}
KEYMAP_SERVICE.setPreset("capiau");
const reverse = KEYMAP_SERVICE.getReverseBindingMap();
const revHits = Object.entries(reverse || {}).filter(([, v]) => JSON.stringify(v).includes("edit.replace_clip"));
assert.ok(revHits.length >= 1, "mapa reverso (teclado virtual) deve associar edit.replace_clip a um binding");
assert.ok(revHits.some(([k]) => /Ctrl/i.test(k) && /Shift/i.test(k) && /R\b/i.test(k)), "binding reverso deve mencionar Ctrl+Shift+R");
console.log("  ✔ Comando mapeado nos 5 perfis sem colisão, visível na Cheat Sheet e no teclado virtual.");

// ── 3. Núcleo replaceClip — modelo TIMELINE_STATE ──
console.log("\n3. Núcleo replaceClip (modelo TIMELINE_STATE)...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

STATE.allVideos = [
    { id: 101, title: "Video Longo", duration: 120.0 },
    { id: 102, title: "Video Curto", duration: 5.0 }
];
STATE.allPhotos = [
    { id: 201, title: "Foto A" },
    { id: 202, title: "Foto B" }
];
TIMELINE_STATE.fps = 24;

const setCuts = (cuts) => {
    STATE.activeTimelineCuts = cuts;
};

const videoPairFixture = () => ([
    {
        id: "v_clip",
        type: "video",
        video_id: 101,
        photo_id: null,
        track: "V1",
        timelineStartFrame: 48,
        inFrame: 24,
        outFrame: 264, // duração = 240 frames = 10s
        in: 1.0,
        out: 11.0,
        link_id: "link_pair_1",
        rotation: 0,
        effects: [{ type: "transform", scale: 1.25, x: 10, y: -20, rotation: 0 }],
        colorTag: "#f59e0b"
    },
    {
        id: "a_clip",
        type: "audio",
        video_id: 101,
        track: "A1",
        timelineStartFrame: 48,
        inFrame: 24,
        outFrame: 264,
        in: 1.0,
        out: 11.0,
        link_id: "link_pair_1",
        volume: 0.8
    }
]);

// 3.1 Substituição Vídeo -> Vídeo: preserva duração exata (240f) e efeitos
setCuts(videoPairFixture());
let r = TIMELINE_STATE.replaceClip("v_clip", 101, "in", { mediaType: "video", sourceInSec: 5.0 });
assert.equal(r.success, true);
let vc = STATE.activeTimelineCuts.find(c => c.id === "v_clip");
let ac = STATE.activeTimelineCuts.find(c => c.id === "a_clip");
assert.equal(vc.inFrame, 120, "5s * 24fps = frame 120");
assert.equal(vc.outFrame, 360, "120 + 240 = 360 (duração conservada)");
assert.equal(vc.outFrame - vc.inFrame, 240, "duração rigorosamente mantida");
assert.equal(vc.effects[0].scale, 1.25, "efeitos Ken Burns preservados");
assert.equal(vc.colorTag, "#f59e0b", "cor preservada");
assert.equal(ac.video_id, 101, "parceiro A/V atualizado");
assert.equal(ac.inFrame, 120);

// 3.2 Undo / Redo atômico
TIMELINE_HISTORY.undo();
vc = STATE.activeTimelineCuts.find(c => c.id === "v_clip");
assert.equal(vc.inFrame, 24, "undo restaura inFrame original");
assert.equal(vc.outFrame, 264);
TIMELINE_HISTORY.redo();
vc = STATE.activeTimelineCuts.find(c => c.id === "v_clip");
assert.equal(vc.inFrame, 120, "redo reaplica a substituição");

// 3.3 Vídeo -> Foto: remove par de áudio vinculado de forma limpa
setCuts(videoPairFixture());
r = TIMELINE_STATE.replaceClip("v_clip", 201, "in", { mediaType: "photo" });
assert.equal(r.success, true);
assert.equal(r.removedPartnerId, "a_clip", "áudio vinculado deve ser removido para fotos");
assert.ok(!STATE.activeTimelineCuts.some(c => c.id === "a_clip"), "áudio não deve existir na timeline");
vc = STATE.activeTimelineCuts.find(c => c.id === "v_clip");
assert.equal(vc.type, "photo");
assert.equal(vc.photo_id, 201);
assert.equal(vc.outFrame - vc.inFrame, 240, "duração preservada na foto");

// 3.4 Clamping seguro se nova mídia for mais curta que o clipe
setCuts(videoPairFixture());
r = TIMELINE_STATE.replaceClip("v_clip", 102, "in", { mediaType: "video", sourceInSec: 0 }); // mídia 102 tem apenas 5s = 120f
assert.equal(r.success, true);
vc = STATE.activeTimelineCuts.find(c => c.id === "v_clip");
assert.equal(vc.outFrame - vc.inFrame, 120, "ajustado ao limite da mídia");
assert.equal(r.durationAdjusted, true);

// 3.5 Rejeições de segurança (pista travada, mídia inexistente, clipe inexistente)
setCuts(videoPairFixture());
TIMELINE_STATE.getTrack("V1").locked = true;
r = TIMELINE_STATE.replaceClip("v_clip", 101, "in");
assert.equal(r.success, false);
assert.equal(r.reason, "track_locked");
TIMELINE_STATE.getTrack("V1").locked = false;

r = TIMELINE_STATE.replaceClip("v_clip", 999999, "in");
assert.equal(r.reason, "media_not_found");

r = TIMELINE_STATE.replaceClip("nao_existe", 101, "in");
assert.equal(r.reason, "target_not_found");

r = TIMELINE_STATE.replaceClip("a_clip", 101, "in");
assert.equal(r.reason, "invalid_target", "não substitui clipes em faixas de áudio");
console.log("  ✔ replaceClip: duração conservada, Ken Burns, pares A/V, undo/redo e proteções validados.");

// ── 4. Interação (CapiauTimelineInteraction com drop de Alt) ──
console.log("\n4. Interação (CapiauTimelineInteraction e drop com Alt)...");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
const mockRenderer = {
    canvas: canvasStub,
    rulerHeight: 30,
    requestRedraw: () => {},
    getLane: () => ({ top: 30, height: 60 }),
    getTrackAtY: () => ({ id: "V1", kind: "video" }),
    dropIndicator: null
};
const interaction = new CapiauTimelineInteraction(mockRenderer);
interaction.refreshClipInspector = () => {};

const interactionFixture = () => ([
    { id: "alvo", type: "photo", photo_id: 201, video_id: null, track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 240, in: 0, out: 10, rotation: 0, effects: [{ type: "transform", scale: 2.0 }], keyframes: {} }
]);

// 4.1 Dragover com Alt exibe realce [REPLACE] sobre o clipe alvo
setCuts(interactionFixture());
STATE.activeDragMedia = { type: "video", id: 101, title: "Video Novo", effectiveDuration: 120 };
interaction.boundDragOver({
    clientX: 50, clientY: 40, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false,
    preventDefault() {},
    dataTransfer: { types: ["application/x-capiau-media"], dropEffect: "" }
});
assert.ok(mockRenderer.dropIndicator, "dropIndicator deve estar ativo");
assert.equal(mockRenderer.dropIndicator.type, "replace");
assert.equal(mockRenderer.dropIndicator.durationFrames, 240, "indicador reflete duração do clipe alvo");
assert.ok(mockRenderer.dropIndicator.subtitle.includes("Alt para substituir"), "subtítulo deve orientar a soltura com Alt");

// 4.2 Soltura com Alt (tryAltReplaceDrop) substitui atomicamente
const dropPayload = { type: "video", id: 101, inTime: 2.0 };
const consumed = interaction.tryAltReplaceDrop(dropPayload, 0, "V1", 40);
assert.equal(consumed, true, "deve consumir o drop");
const substituido = STATE.activeTimelineCuts.find(c => c.id === "alvo");
assert.equal(substituido.video_id, 101);
assert.equal(substituido.inFrame, 48, "2s * 24fps = frame 48");
assert.equal(substituido.outFrame, 288, "48 + 240 = 288 (duração mantida)");
assert.equal(substituido.effects[0].scale, 2.0, "Ken Burns preservado");
assert.ok(toasts.some(t => String(t[0]).includes("Pressione Y para deslizar")), "toast deve instruir uso do Slip Tool Y");

console.log("  ✔ Interação: dragover com Alt, indicador [REPLACE], drop atômico e toast orientativo validados.");

console.log("\n✅ Autoteste do Replace Edit (Task 9 Limpa - Padrão NLE) passou 100%.");
