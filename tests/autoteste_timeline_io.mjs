// Autoteste do Sistema de In/Out, Loop, Lift, Extract e Keymaps da Timeline
// Executa em Node.js: node tests/autoteste_timeline_io.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Ambiente Mock ──
const stateEvents = {};
const mockState = {
    activeTimelineCuts: [],
    emit(event, data) {
        if (stateEvents[event]) {
            stateEvents[event].forEach(fn => fn(data));
        }
    },
    on(event, fn) {
        if (!stateEvents[event]) stateEvents[event] = [];
        stateEvents[event].push(fn);
    }
};

const context = vm.createContext({
    console,
    Math,
    Date,
    JSON,
    Array,
    Set,
    Map,
    Number,
    String,
    Boolean,
    window: {
        timelineInteraction: null
    },
    STATE: mockState,
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    document: {
        getElementById: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    }
});

// Carrega timelineState.js
const codeTimelineState = readFileSync(path.join(raiz, "src", "ui", "js", "timelineState.js"), "utf8");
const cleanedTimelineCode = codeTimelineState
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/export const /g, "var ")
    .replace(/export class /g, "class ")
    .replace(/export function /g, "function ")
    .replace(/export default /g, "var defaultExport = ");

vm.runInContext(cleanedTimelineCode, context);

const TIMELINE_STATE = context.TIMELINE_STATE;
const TIMELINE_HISTORY = context.TIMELINE_HISTORY;

// Carrega keymapService.js
const codeKeymap = readFileSync(path.join(raiz, "src", "ui", "js", "keymapService.js"), "utf8");
const cleanedKeymapCode = codeKeymap
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/export const /g, "var ")
    .replace(/export class /g, "class ")
    .replace(/export function /g, "function ");

vm.runInContext(cleanedKeymapCode, context);
const KEYMAP_PRESETS = context.KEYMAP_PRESETS;
const COMMANDS_CATALOG = context.COMMANDS_CATALOG;

console.log("▶ Iniciando testes de In/Out, Loop, Lift, Extract e Keymaps...\n");

// ── TESTE 1: In / Out Básico e Sanitização ──
console.log("1. Testando definição, limpeza e sanitização de pontos In/Out...");
TIMELINE_STATE.clearInOut();
assert.equal(TIMELINE_STATE.inFrame, null);
assert.equal(TIMELINE_STATE.outFrame, null);
assert.equal(TIMELINE_STATE.hasInOut(), false);

TIMELINE_STATE.setInPoint(24);
assert.equal(TIMELINE_STATE.inFrame, 24);
assert.equal(TIMELINE_STATE.outFrame, null);
assert.equal(TIMELINE_STATE.hasInOut(), true);

TIMELINE_STATE.setOutPoint(72);
assert.equal(TIMELINE_STATE.inFrame, 24);
assert.equal(TIMELINE_STATE.outFrame, 72);

// Sanitização: Se In >= Out, Out é limpo
TIMELINE_STATE.setInPoint(80);
assert.equal(TIMELINE_STATE.inFrame, 80);
assert.equal(TIMELINE_STATE.outFrame, null);

// Sanitização: Se Out <= In, In é limpo
TIMELINE_STATE.setInPoint(100);
TIMELINE_STATE.setOutPoint(50);
assert.equal(TIMELINE_STATE.inFrame, null);
assert.equal(TIMELINE_STATE.outFrame, 50);

TIMELINE_STATE.clearOutPoint();
assert.equal(TIMELINE_STATE.outFrame, null);
console.log("  ✔ In/Out básico e sanitização aprovados.");

// ── TESTE 2: Mark Clip e Loop ──
console.log("\n2. Testando Mark Clip e Toggle Loop...");
mockState.activeTimelineCuts = [
    {
        id: "clip_1",
        track: "V1",
        timelineStartFrame: 48,
        timeline_start: 2.0,
        inFrame: 0,
        outFrame: 48
    }
];

TIMELINE_STATE.playheadFrame = 50;
TIMELINE_STATE.markClip();
assert.equal(TIMELINE_STATE.inFrame, 48);
assert.equal(TIMELINE_STATE.outFrame, 96);

assert.equal(TIMELINE_STATE.isLooping, false);
TIMELINE_STATE.toggleLoop();
assert.equal(TIMELINE_STATE.isLooping, true);
TIMELINE_STATE.toggleLoop(false);
assert.equal(TIMELINE_STATE.isLooping, false);
console.log("  ✔ Mark Clip e Toggle Loop aprovados.");

// ── TESTE 3: Lift Delete no Intervalo IN-OUT ──
console.log("\n3. Testando Lift Delete no intervalo IN-OUT...");
mockState.activeTimelineCuts = [
    { id: "clip_A", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 48 },
    { id: "clip_B", track: "V1", timelineStartFrame: 48, inFrame: 0, outFrame: 96 },
    { id: "clip_C", track: "V1", timelineStartFrame: 160, inFrame: 0, outFrame: 40 }
];
TIMELINE_STATE.tracks = [{ id: "V1", kind: "video", locked: false }];

TIMELINE_STATE.setInPoint(72);
TIMELINE_STATE.setOutPoint(120);

const liftOk = TIMELINE_STATE.liftRange();
assert.equal(liftOk, true);

const cutsAfterLift = mockState.activeTimelineCuts;
assert.equal(cutsAfterLift.length, 4);

const cA = cutsAfterLift.find(c => c.id === "clip_A");
assert.ok(cA);
assert.equal(cA.timelineStartFrame, 0);
assert.equal(cA.outFrame - cA.inFrame, 48);

const cC = cutsAfterLift.find(c => c.id === "clip_C");
assert.ok(cC);
assert.equal(cC.timelineStartFrame, 160);

console.log("  ✔ Lift Delete no intervalo aprovado.");

// ── TESTE 4: Extract (Ripple Delete) no Intervalo IN-OUT ──
console.log("\n4. Testando Extract (Ripple Delete) no intervalo IN-OUT...");
mockState.activeTimelineCuts = [
    { id: "clip_1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 50 },
    { id: "clip_2", track: "V1", timelineStartFrame: 50, inFrame: 0, outFrame: 50 },
    { id: "clip_3", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 50 }
];
TIMELINE_STATE.tracks = [{ id: "V1", kind: "video", locked: false, syncLocked: true }];

TIMELINE_STATE.setInPoint(50);
TIMELINE_STATE.setOutPoint(100);

const extractOk = TIMELINE_STATE.extractRange();
assert.equal(extractOk, true);

const cutsAfterExtract = mockState.activeTimelineCuts;
assert.equal(cutsAfterExtract.length, 2);

const postClip1 = cutsAfterExtract.find(c => c.id === "clip_1");
assert.equal(postClip1.timelineStartFrame, 0);

const postClip3 = cutsAfterExtract.find(c => c.id === "clip_3");
assert.equal(postClip3.timelineStartFrame, 50);

console.log("  ✔ Extract (Ripple Delete) no intervalo aprovado.");

// ── TESTE 5: Undo / Redo com TimelineHistory ──
console.log("\n5. Testando persistência de In/Out no Histórico Undo/Redo...");
TIMELINE_STATE.setInPoint(10);
TIMELINE_STATE.setOutPoint(90);

TIMELINE_HISTORY.record(() => {
    TIMELINE_STATE.setInPoint(30);
    TIMELINE_STATE.setOutPoint(120);
});

assert.equal(TIMELINE_STATE.inFrame, 30);
assert.equal(TIMELINE_STATE.outFrame, 120);

TIMELINE_HISTORY.undo();
assert.equal(TIMELINE_STATE.inFrame, 10);
assert.equal(TIMELINE_STATE.outFrame, 90);

TIMELINE_HISTORY.redo();
assert.equal(TIMELINE_STATE.inFrame, 30);
assert.equal(TIMELINE_STATE.outFrame, 120);
console.log("  ✔ Undo/Redo com In/Out aprovado.");

// ── TESTE 6: Verificação de Presets de Teclado ──
console.log("\n6. Testando integridade dos 5 Presets de Atalho (CapIAu, Kdenlive, Premiere, Resolve, Final Cut)...");
const requiredCommands = [
    "playback.mark_in",
    "playback.mark_out",
    "playback.clear_in",
    "playback.clear_out",
    "playback.clear_in_out",
    "playback.mark_clip",
    "playback.goto_in",
    "playback.goto_out",
    "playback.play_in_to_out",
    "playback.toggle_loop",
    "edit.lift_in_out",
    "edit.extract_in_out"
];

const presets = ["capiau", "kdenlive", "premiere", "resolve", "finalcut"];

for (const preset of presets) {
    const map = KEYMAP_PRESETS[preset];
    assert.ok(map, `Preset ${preset} deve existir`);
    for (const cmd of requiredCommands) {
        assert.ok(map[cmd], `Preset ${preset} deve mapear o comando '${cmd}'`);
        assert.ok(Array.isArray(map[cmd]) && map[cmd].length > 0, `Comando '${cmd}' no preset ${preset} deve ter ao menos um atalho`);
    }
}

assert.equal(JSON.stringify(KEYMAP_PRESETS.capiau["playback.mark_clip"]), JSON.stringify(["KeyX"]));
assert.ok(Array.from(KEYMAP_PRESETS.kdenlive["playback.mark_clip"]).includes("KeyX"));
assert.ok(KEYMAP_PRESETS.kdenlive["playback.play_in_to_out"].length > 0);

console.log("  ✔ Todos os 5 presets NLE contêm todos os atalhos In/Out, Loop, Lift e Extract.");

console.log("\n==========================================");
console.log("🎉 TODOS OS TESTES PASSARAM COM SUCESSO!");
console.log("==========================================");
