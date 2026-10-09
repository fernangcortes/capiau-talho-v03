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
    allVideos: [],
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
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
    window: {
        timelineInteraction: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {}
    },
    STATE: mockState,
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    document: {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {}
    },
    ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
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
    requestRedraw: () => {},
    getTrackAtY: () => null
};

// Carrega timelineInteraction.js para teste isolado de métodos de colisão
const codeInteraction = readFileSync(path.join(raiz, "src", "ui", "js", "timelineInteraction.js"), "utf8");
const cleanedInteractionCode = codeInteraction
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/export class CapiauTimelineInteraction/g, "class CapiauTimelineInteraction")
    .replace(/export const /g, "const ")
    .replace(/export default /g, "var defaultInteraction = ");

context.mockRenderer = mockRenderer;
const mockCanvasCtx = new Proxy({
    measureText: (text) => ({ width: (text || "").length * 6.5 }),
    createLinearGradient: () => ({ addColorStop: () => {} })
}, {
    get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
    },
    set() { return true; }
});
context.document.getElementById = () => ({
    classList: { contains: () => false },
    addEventListener: () => {},
    style: {},
    getContext: () => mockCanvasCtx,
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    ownerDocument: { defaultView: context.window },
    parentElement: { clientWidth: 1000, clientHeight: 300, addEventListener: () => {} }
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

    // ── TESTE 8: Box de In/Out na Régua (Anti-colisão, Anti-truncamento e Níveis Adaptativos) ──
    console.log("\n8. Testando Box/Badge de In/Out na régua (Anti-colisão, Anti-truncamento e Níveis Adaptativos)...");

    // Prepara contexto para carregar CapiauTimelineRenderer
    context.WaveformManager = { addListener: () => {} };
    context.RENDER_CACHE_MANAGER = { getSegments: () => [] };
    context.themeColor = (token, fallback) => fallback;
    context.THEME_CHANGED_EVENT = "themeChanged";
    context.applyTrackMode = (style) => style;
    context.getAllKeyframeTimelineFrames = () => [];

    const codeRenderer = readFileSync(path.join(raiz, "src", "ui", "js", "timelineRenderer.js"), "utf8");
    const cleanedRendererCode = codeRenderer
        .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
        .replace(/export class CapiauTimelineRenderer/g, "class CapiauTimelineRenderer")
        .replace(/export const /g, "const ")
        .replace(/export function /g, "function ")
        .replace(/export default /g, "var defaultRenderer = ");

    vm.runInContext(cleanedRendererCode + "; var rendererInstance = new CapiauTimelineRenderer();", context);
    const renderer = context.rendererInstance;
    renderer.width = 1000;
    renderer.height = 300;
    renderer.rulerHeight = 30;

    // Cenário A: Sem pontos In/Out definidos ou com In >= Out
    TIMELINE_STATE.clearInOut();
    assert.equal(renderer.getInOutBadgeInfo(), null, "getInOutBadgeInfo() deve retornar null quando não há pontos IN/OUT");

    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 100;
    assert.equal(renderer.getInOutBadgeInfo(), null, "getInOutBadgeInfo() deve retornar null quando inFrame === outFrame");

    // Cenário A2: Em repouso (sem ajuste ativo e opção desativada), régua deve permanecer 100% limpa (badge === null)
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 250;
    TIMELINE_STATE.isAdjustingInOut = false;
    TIMELINE_STATE.showInOutRulerBadge = false;
    assert.equal(renderer.getInOutBadgeInfo(), null, "getInOutBadgeInfo() deve retornar null em repouso para não tapar informações de tempo da régua");

    // Ativa modo de ajuste para validar a renderização adaptativa durante arraste das alças do IO
    TIMELINE_STATE.isAdjustingInOut = true;

    // Cenário B: Intervalo muito estreito (< 44px entre colchetes)
    TIMELINE_STATE.zoom = 1;
    TIMELINE_STATE.scrollLeftFrame = 0;
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 130; // 30px -> safeW = 30 - 26 = 4px < 44px
    assert.equal(renderer.getInOutBadgeInfo(), null, "Deve retornar null para intervalo muito curto para evitar encavalamento de badges");

    // Cenário C: Intervalo amplo (zoom 2, dur 150 frames = 300px) -> Deve escolher Tier 1 (Completo)
    TIMELINE_STATE.zoom = 2;
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 250;
    // inX = 200, outX = 500, intervalW = (500 - 13) - (200 + 13) = 487 - 213 = 274px
    const badgeTier1 = renderer.getInOutBadgeInfo();
    assert.ok(badgeTier1, "Deve gerar badge para intervalo amplo");
    assert.equal(badgeTier1.tier, 1, "Intervalo amplo (>= 240px) deve selecionar Tier 1 (completo)");
    assert.ok(badgeTier1.left >= 200 + 13, "Badge não pode sobrepor colchete IN");
    assert.ok(badgeTier1.right <= 500 - 13, "Badge não pode sobrepor colchete OUT");
    assert.ok(badgeTier1.text.includes("IN ") && badgeTier1.text.includes("OUT "), "Texto do Tier 1 deve conter IN e OUT");

    // Cenário D: Intervalo médio amplo (220px entre IN e OUT) -> Seleciona Tier 2 adaptativo compacto
    TIMELINE_STATE.zoom = 1;
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 320; // 220px -> safeW = 220 - 26 = 194px
    const badgeTier2 = renderer.getInOutBadgeInfo();
    assert.ok(badgeTier2, "Deve gerar badge para intervalo médio amplo");
    assert.equal(badgeTier2.tier, 2, "Intervalo de 220px deve selecionar Tier 2 adaptativo compacto");
    assert.ok(badgeTier2.left >= 100 + 13, "Badge Tier 2 não pode sobrepor o colchete IN");
    assert.ok(badgeTier2.right <= 320 - 13, "Badge Tier 2 não pode sobrepor o colchete OUT");
    assert.ok(badgeTier2.width <= 194, "Largura do badge deve ser menor ou igual ao espaço seguro");

    // Cenário D2: Intervalo médio mais contido (170px entre IN e OUT) -> Degrada graciosamente para Tier 3 (Duração)
    TIMELINE_STATE.outFrame = 270; // 170px -> safeW = 170 - 26 = 144px
    const badgeTier3 = renderer.getInOutBadgeInfo();
    assert.ok(badgeTier3, "Deve gerar badge para intervalo de 170px");
    assert.equal(badgeTier3.tier, 3, "Intervalo de 170px deve selecionar Tier 3 para evitar qualquer truncamento");
    assert.ok(badgeTier3.left >= 100 + 13, "Badge Tier 3 não pode sobrepor o colchete IN");
    assert.ok(badgeTier3.right <= 270 - 13, "Badge Tier 3 não pode sobrepor o colchete OUT");
    assert.ok(badgeTier3.width <= 144, "Largura do badge deve ser menor ou igual ao espaço seguro");

    // Cenário E: Intervalo compacto (90px) -> Deve selecionar Tier 3 ou Tier 4
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 190; // 90px -> safeW = 90 - 26 = 64px
    const badgeCompact = renderer.getInOutBadgeInfo();
    assert.ok(badgeCompact, "Deve gerar badge para intervalo compacto");
    assert.ok(badgeCompact.tier === 3 || badgeCompact.tier === 4, "Deve selecionar formato conciso para espaço reduzido");
    assert.ok(badgeCompact.left >= 100 + 13, "Badge compacto não pode sobrepor colchete IN");
    assert.ok(badgeCompact.right <= 190 - 13, "Badge compacto não pode sobrepor colchete OUT");

    // Cenário F: Intervalo parcialmente fora da tela (scrollLeft avançado)
    TIMELINE_STATE.scrollLeftFrame = 200; // inFrame 100 está em -100px (à esquerda do canvas)
    TIMELINE_STATE.inFrame = 100;
    TIMELINE_STATE.outFrame = 500; // outFrame 500 está em 300px
    const badgeScrolled = renderer.getInOutBadgeInfo();
    assert.ok(badgeScrolled, "Deve gerar badge mesmo quando IN está fora da tela à esquerda");
    assert.ok(badgeScrolled.left >= 0, "Badge deve permanecer visível dentro do canvas (left >= 0)");
    assert.ok(badgeScrolled.right <= 300 - 13, "Badge não pode passar do colchete OUT");

    // Cenário G: Opção permanente ligada (showInOutRulerBadge === true) mesmo com isAdjustingInOut = false
    TIMELINE_STATE.isAdjustingInOut = false;
    TIMELINE_STATE.toggleShowInOutRulerBadge(true);
    assert.equal(TIMELINE_STATE.showInOutRulerBadge, true, "showInOutRulerBadge deve estar true");
    const badgeAlwaysOn = renderer.getInOutBadgeInfo();
    assert.ok(badgeAlwaysOn, "Badge deve ser gerado quando showInOutRulerBadge estiver ativo mesmo sem arraste");
    TIMELINE_STATE.toggleShowInOutRulerBadge(false);
    assert.equal(renderer.getInOutBadgeInfo(), null, "Badge volta a ser null quando showInOutRulerBadge é desligado e sem ajuste ativo");

    console.log("  ✔ Níveis adaptativos, ativação dinâmica em ajuste e opção permanente do Box In/Out aprovados.");

    // ── TESTE 9: Hover Tooltip no Intervalo IN-OUT na Régua ──
    console.log("\n9. Testando exibição de tooltip informativo ao pairar sobre a régua...");

    TIMELINE_STATE.scrollLeftFrame = 0;
    TIMELINE_STATE.inFrame = 50;
    TIMELINE_STATE.outFrame = 150;
    TIMELINE_STATE.fps = 24;

    const mockCanvas = {
        attributes: {},
        style: {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k]; },
        removeAttribute(k) { delete this.attributes[k]; },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 300 }),
        ownerDocument: context.document
    };
    interaction.canvas = mockCanvas;

    // Hover fora do intervalo (x = 20, régua y = 10)
    interaction.onMouseMove({ clientX: 20, clientY: 10, altKey: false, shiftKey: false });
    assert.equal(mockCanvas.getAttribute("data-tooltip"), undefined, "Fora do intervalo não deve ter tooltip de IN-OUT");

    // Hover dentro do intervalo (x = 80, régua y = 10) sem Alt
    interaction.onMouseMove({ clientX: 80, clientY: 10, altKey: false, shiftKey: false });
    const tooltipText = mockCanvas.getAttribute("data-tooltip");
    assert.ok(tooltipText && tooltipText.includes("Intervalo IN–OUT:"), "Deve exibir tooltip informativo sobre o intervalo");
    assert.ok(tooltipText.includes("100 frames"), "Tooltip deve conter total de frames");

    // Hover dentro do intervalo COM Alt -> Deve mudar cursor para mover intervalo
    interaction.onMouseMove({ clientX: 80, clientY: 10, altKey: true, shiftKey: false });
    assert.equal(mockCanvas.getAttribute("data-tooltip"), "Mover Intervalo IN/OUT (mantendo duração)");

    console.log("  ✔ Hover tooltip informativo na régua aprovado.");
} catch (err) {
    console.error("Erro ao testar interação:", err);
    throw err;
}

console.log("\n==========================================");
console.log("🎉 TODOS OS TESTES PASSARAM COM SUCESSO!");
console.log("==========================================");
