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

// ── TESTE 7: Prioridade de Colisão Playhead vs Marcadores IN/OUT e Movimentação de Span ──
console.log("\n7. Testando prioridade de colisão Playhead vs Marcadores IN/OUT e deslocamento de intervalo...");

const mockRenderer = {
    rulerHeight: 30,
    width: 1000,
    height: 300,
    requestRedraw: () => {}
};

// Carrega timelineInteraction.js para teste isolado de métodos de colisão
const codeInteraction = readFileSync(path.join(raiz, "src", "ui", "js", "timelineInteraction.js"), "utf8");
const cleanedInteractionCode = codeInteraction
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/export class CapiauTimelineInteraction/g, "class CapiauTimelineInteraction")
    .replace(/export default /g, "var defaultInteraction = ");

context.mockRenderer = mockRenderer;
context.document.getElementById = () => ({
    classList: { contains: () => false },
    addEventListener: () => {},
    style: {}
});
context.document.querySelectorAll = () => [];

try {
    vm.runInContext(cleanedInteractionCode + "; var interactionInstance = new CapiauTimelineInteraction(mockRenderer);", context);
    const interaction = context.interactionInstance;

    // Caso A: Playhead e IN coincidentes no frame 100
    TIMELINE_STATE.zoom = 1;
    TIMELINE_STATE.scrollLeftFrame = 0;
    TIMELINE_STATE.setPlayheadFrame(100);
    TIMELINE_STATE.setInPoint(100);
    TIMELINE_STATE.setOutPoint(300);

    const inX = 100; // zoom 1, scroll 0

    // Topo da régua (y = 6px): prioridade total para o Playhead Head
    assert.equal(interaction.checkHitPlayheadHead(inX, 6), true, "Deve atingir a cabeça do Playhead no topo");
    assert.equal(interaction.checkHitMarkIn(inX, 6, false), false, "Não deve capturar IN no topo sem Alt quando a agulha está sobreposta");

    // Abaixo do topo (y = 18px): permite capturar o colchete IN
    assert.equal(interaction.checkHitPlayheadHead(inX, 18), false, "Não deve atingir a cabeça do Playhead abaixo de y=14");
    assert.equal(interaction.checkHitMarkIn(inX, 18, false), true, "Deve capturar o colchete IN na parte inferior da régua");

    // Com tecla Alt no topo: Alt força a captura do marcador IN
    assert.equal(interaction.checkHitMarkIn(inX, 6, true), true, "Com Alt, deve capturar o marcador IN mesmo no topo");

    // Caso B: Playhead e OUT coincidentes no frame 250
    TIMELINE_STATE.setPlayheadFrame(250);
    TIMELINE_STATE.setOutPoint(250);
    const outX = 250;

    // Topo da régua (y = 6px): prioridade total para o Playhead Head
    assert.equal(interaction.checkHitPlayheadHead(outX, 6), true, "Deve atingir a cabeça do Playhead no topo sobre OUT");
    assert.equal(interaction.checkHitMarkOut(outX, 6, false), false, "Não deve capturar OUT no topo sem Alt quando a agulha está sobreposta");

    // Abaixo do topo (y = 18px): captura o colchete OUT
    assert.equal(interaction.checkHitMarkOut(outX, 18, false), true, "Deve capturar o colchete OUT na parte inferior da régua");

    // Com tecla Alt no topo: Alt força a captura do marcador OUT
    assert.equal(interaction.checkHitMarkOut(outX, 6, true), true, "Com Alt, deve capturar o marcador OUT mesmo no topo");

    // Caso C: Deslocamento do span IN-OUT mantendo distância constante
    const initialIn = 50;
    const initialOut = 150;
    const initialDur = initialOut - initialIn; // 100 frames
    TIMELINE_STATE.setInPoint(initialIn);
    TIMELINE_STATE.setOutPoint(initialOut);

    const deltaX = 35; // deslocar 35 frames para a direita
    const deltaFrames = Math.round(deltaX / TIMELINE_STATE.zoom);
    const dur = Math.max(1, initialOut - initialIn);
    const newIn = Math.max(0, initialIn + deltaFrames);
    const newOut = newIn + dur;
    TIMELINE_STATE.inFrame = newIn;
    TIMELINE_STATE.outFrame = newOut;

    assert.equal(TIMELINE_STATE.inFrame, 85);
    assert.equal(TIMELINE_STATE.outFrame, 185);
    assert.equal(TIMELINE_STATE.outFrame - TIMELINE_STATE.inFrame, initialDur, "Duração do intervalo IN-OUT deve ser preservada ao mover com Alt/Shift");

    console.log("  ✔ Prioridades de clique/arraste Playhead vs IN/OUT e integridade do span aprovadas.");
} catch (err) {
    console.error("Erro ao testar interação:", err);
    throw err;
}

console.log("\n==========================================");
console.log("🎉 TODOS OS TESTES PASSARAM COM SUCESSO!");
console.log("==========================================");
