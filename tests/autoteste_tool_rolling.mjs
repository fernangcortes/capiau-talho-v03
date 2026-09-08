// Autoteste da Ferramenta Corte Contínuo Adjacente (Rolling Edit Tool — tecla N)
// Execução: node tests/autoteste_tool_rolling.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Polyfill de ambiente de navegador para execução em Node.js ESM
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
globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") {
            return {
                getContext: () => ({
                    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
                    fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
                    measureText: () => ({ width: 50 }),
                    fillText() {}, scale() {}, clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
                }),
                ownerDocument: globalThis.document,
                parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
                style: {},
                closest: () => null,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
                addEventListener: () => {},
                removeEventListener: () => {},
                focus: () => {}
            };
        }
        return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
        innerHTML: ""
    }),
    body: {
        appendChild: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste da Ferramenta Corte Contínuo Adjacente (Rolling Edit Tool — tecla N)...");

// ── 1. Análise do DOM (index.html) e CSS (styles.css) ──
console.log("\n1. Validando estrutura do index.html e estilos do styles.css...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// 1.1 Botão #btn-tool-rolling na Tool Strip
const rollingBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-rolling["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(rollingBtnMatch, "Botão #btn-tool-rolling deve existir no index.html");
const rollingBtnHTML = rollingBtnMatch[0];
assert.ok(rollingBtnHTML.includes("data-tooltip"), "#btn-tool-rolling deve conter data-tooltip explicativo");
assert.ok(rollingBtnHTML.includes("Rolling") || rollingBtnHTML.includes("Corte Contínuo"), "#btn-tool-rolling deve mencionar Rolling Edit ou Corte Contínuo");
assert.ok(rollingBtnHTML.includes("<svg"), "#btn-tool-rolling deve conter SVG inline para fidelidade vetorial");
assert.ok(rollingBtnHTML.includes('line x1="10"'), "SVG do #btn-tool-rolling deve conter duas linhas de corte na emenda");
assert.ok(rollingBtnHTML.includes('line x1="14"'), "SVG do #btn-tool-rolling deve conter segunda linha paralela na emenda");

// 1.2 Cache-busters e estilos
assert.ok(/styles\.css\?v=(?:39|[4-9]\d)/.test(htmlContent), "Cache-buster de styles.css deve estar em ?v>=39");
assert.ok(/main\.js\?v=(?:39|[4-9]\d)/.test(htmlContent), "Cache-buster de main.js deve estar em ?v>=39");
assert.ok(cssContent.includes("#timeline-rolling-tooltip"), "styles.css deve conter estilização para #timeline-rolling-tooltip");
assert.ok(cssContent.includes("#btn-tool-rolling:hover"), "styles.css deve conter hover para #btn-tool-rolling");
console.log("  ✔ Elemento #btn-tool-rolling com SVG de emenda dupla, estilos e cache-busters v>=39 validados.");

// ── 2. Validação do Catálogo e dos 5 Perfis Multi-Preset (Diretriz 5) ──
console.log("\n2. Validando Catálogo de Comandos, Perfis NLE e tecla N nos 5 presets...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

// 2.1 Presença no COMMANDS_CATALOG
const cmdRolling = COMMANDS_CATALOG.find(c => c.id === "tools.rolling");
assert.ok(cmdRolling, "Comando 'tools.rolling' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdRolling.category, "tools", "tools.rolling deve pertencer à categoria 'tools'");
assert.ok(cmdRolling.label && (cmdRolling.label.includes("Rolling") || cmdRolling.label.includes("Corte Contínuo")), "Rótulo de tools.rolling deve mencionar Rolling");
assert.ok(cmdRolling.description, "tools.rolling deve conter descrição informativa");
console.log("  ✔ Comando 'tools.rolling' devidamente registrado no catálogo central.");

// 2.2 Mapeamento nos 5 Presets da Indústria
const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];

for (const p of presetsEsperados) {
    const presetConfig = KEYMAP_PRESETS[p];
    assert.ok(presetConfig, `Preset '${p}' deve estar definido em KEYMAP_PRESETS`);
    
    const rollingBinding = presetConfig["tools.rolling"];
    assert.ok(rollingBinding && rollingBinding.length > 0, `Preset '${p}' deve mapear 'tools.rolling'`);
    assert.ok(rollingBinding.includes("KeyN"), `Preset '${p}' deve suportar tecla 'KeyN' para a ferramenta Rolling Edit`);

    // Valida não-colisão com tools.snapping
    const snappingBinding = presetConfig["tools.snapping"];
    if (snappingBinding) {
        assert.ok(!snappingBinding.includes("KeyN"), `Preset '${p}' não pode colidir 'KeyN' pura com tools.snapping`);
    }
}
console.log("  ✔ Mapeamento unificado da tecla 'N' nos 5 perfis NLE validado sem colisão.");

// 2.3 Simulação da Cheat Sheet
for (const p of presetsEsperados) {
    KEYMAP_SERVICE.setPreset(p);
    const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML("tools.rolling");
    assert.ok(badgesHtml && badgesHtml.length > 0, `Cheat Sheet deve gerar badges HTML para 'tools.rolling' no preset '${p}'`);
    assert.ok(badgesHtml.includes("N"), `Badges da Cheat Sheet no preset '${p}' devem conter 'N'`);
}
KEYMAP_SERVICE.setPreset("capiau"); // Restaura padrão
console.log("  ✔ Renderização dinâmica de badges da Cheat Sheet validada para todos os perfis.");

// ── 3. Validação do Núcleo Lógico no TIMELINE_STATE (rollingEdit) ──
console.log("\n3. Validando lógica de corte contínuo (rollingEdit) em TIMELINE_STATE...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction, CURSOR_ROLLING } = await import("../src/ui/js/timelineInteraction.js");

TIMELINE_STATE.fps = 24;
TIMELINE_STATE.setTracks([
    { id: "V1", name: "Vídeo 1", kind: "video", volume: 1.0, muted: false, locked: false },
    { id: "A1", name: "Áudio 1", kind: "audio", volume: 1.0, muted: false, locked: false },
    { id: "V2", name: "B-Roll (Travada)", kind: "video", volume: 1.0, muted: false, locked: true }
]);

TIMELINE_HISTORY.clear();

// Cenário inicial: Dois clipes contíguos na pista V1
// Clip A: 0..50 na timeline (in=10, out=60, dur=50, maxMedia=100)
// Clip B: 50..100 na timeline (in=20, out=70, dur=50, maxMedia=100)
STATE.activeTimelineCuts = [
    {
        id: "clip_a",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 10,
        outFrame: 60,
        timeline_start: 0,
        in: 10 / 24,
        out: 60 / 24,
        mediaDurationFrames: 100
    },
    {
        id: "clip_b",
        track: "V1",
        timelineStartFrame: 50,
        inFrame: 20,
        outFrame: 70,
        timeline_start: 50 / 24,
        in: 20 / 24,
        out: 70 / 24,
        mediaDurationFrames: 100
    },
    {
        id: "clip_c",
        track: "V1",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 40,
        timeline_start: 100 / 24,
        in: 0,
        out: 40 / 24,
        mediaDurationFrames: 100
    }
];

// 3.1 Rolling para a direita (+15 frames)
const resR1 = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", 15);
assert.ok(resR1, "rollingEdit deve retornar resultado");
assert.equal(resR1.appliedDelta, 15, "Delta aplicado deve ser +15");

const getCutA = () => STATE.activeTimelineCuts.find(c => c.id === "clip_a");
const getCutB = () => STATE.activeTimelineCuts.find(c => c.id === "clip_b");
const getCutC = () => STATE.activeTimelineCuts.find(c => c.id === "clip_c");

assert.equal(getCutA().timelineStartFrame, 0, "Clip A startFrame deve permanecer inalterado");
assert.equal(getCutA().inFrame, 10, "Clip A inFrame deve permanecer inalterado");
assert.equal(getCutA().outFrame, 75, "Clip A outFrame deve expandir para 60 + 15 = 75");
assert.equal(getCutA().outFrame - getCutA().inFrame, 65, "Clip A duração deve aumentar para 65");

assert.equal(getCutB().timelineStartFrame, 65, "Clip B startFrame deve avançar para 50 + 15 = 65");
assert.equal(getCutB().inFrame, 35, "Clip B inFrame deve avançar para 20 + 15 = 35");
assert.equal(getCutB().outFrame, 70, "Clip B outFrame deve permanecer inalterado (70)");
assert.equal(getCutB().outFrame - getCutB().inFrame, 35, "Clip B duração deve encolher para 35");

// Invariante Fundamental: A + B constante, cauda da timeline inalterada
assert.equal(
    (getCutA().outFrame - getCutA().inFrame) + (getCutB().outFrame - getCutB().inFrame),
    100,
    "Soma das durações de Clip A e Clip B deve permanecer estritamente constante (100)"
);
assert.equal(getCutA().timelineStartFrame + (getCutA().outFrame - getCutA().inFrame), getCutB().timelineStartFrame, "Emenda entre A e B deve permanecer perfeitamente unida");
assert.equal(getCutB().timelineStartFrame + (getCutB().outFrame - getCutB().inFrame), 100, "Fim de Clip B deve permanecer exatamente em 100");
assert.equal(getCutC().timelineStartFrame, 100, "Clip C não pode se mover");
console.log("  ✔ Rolling edit para a direita (+15f) com compensação simétrica e conservação da timeline validado.");

// 3.2 Rolling reverso para a esquerda (-15 frames) usando rollingBase
const baseRolling = {
    leftClipId: "clip_a",
    leftStart: 0,
    leftIn: 10,
    leftOut: 60,
    rightClipId: "clip_b",
    rightStart: 50,
    rightIn: 20,
    rightOut: 70
};

const resR2 = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", -15, true, baseRolling);
assert.ok(resR2);
assert.equal(resR2.appliedDelta, -15);
assert.equal(getCutA().outFrame, 45, "Clip A outFrame deve recuar para 60 - 15 = 45");
assert.equal(getCutB().inFrame, 5, "Clip B inFrame deve recuar para 20 - 15 = 5");
assert.equal(getCutB().timelineStartFrame, 35, "Clip B startFrame deve recuar para 50 - 15 = 35");
assert.equal((getCutA().outFrame - getCutA().inFrame) + (getCutB().outFrame - getCutB().inFrame), 100, "Soma das durações deve continuar exatamente 100");
console.log("  ✔ Rolling edit para a esquerda (-15f) validado com base de referência original.");

// 3.3 Clamping rígido no fim de mídia do Clip A (maxMediaFrames = 100)
// Clip A base outFrame = 60. Máximo que pode crescer é 100 - 60 = +40 frames.
const resClampRight = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", +80, true, baseRolling);
assert.equal(resClampRight.appliedDelta, 40, "Delta deve ser clampeado em +40 pelo limite de mídia de Clip A");
assert.equal(getCutA().outFrame, 100, "Clip A outFrame deve travar exatamente em maxMediaFrames=100");

// 3.4 Clamping rígido no início de mídia do Clip B (inFrame >= 0)
// Clip B base inFrame = 20. Máximo que pode recuar é -20 frames.
const resClampLeft = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", -50, true, baseRolling);
assert.equal(resClampLeft.appliedDelta, -20, "Delta deve ser clampeado em -20 pelo início de mídia de Clip B");
assert.equal(getCutB().inFrame, 0, "Clip B inFrame deve travar exatamente em 0");

// 3.5 Clamping na duração mínima de 1 frame para ambos os clipes
// Clip B base duration = 50. Se Clip A pudesse crescer infinitamente, Clip B não pode ter menos que 1 frame (delta max = 49).
getCutA().mediaDurationFrames = Infinity;
const resMinDurB = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", +100, true, baseRolling);
assert.equal(resMinDurB.appliedDelta, 49, "Delta deve ser clampeado em 49 para garantir Clip B com 1 frame");
assert.equal(getCutB().outFrame - getCutB().inFrame, 1, "Clip B deve ter duração mínima de 1 frame");

// Clip A base duration = 50. Clip A não pode ter menos que 1 frame (delta min = -49).
getCutB().inFrame = 60;
getCutB().outFrame = 110;
const baseRollingDeep = { ...baseRolling, rightIn: 60, rightOut: 110 };
const resMinDurA = TIMELINE_STATE.rollingEdit("clip_a", "clip_b", -100, true, baseRollingDeep);
assert.equal(resMinDurA.appliedDelta, -49, "Delta deve ser clampeado em -49 para garantir Clip A com 1 frame");
assert.equal(getCutA().outFrame - getCutA().inFrame, 1, "Clip A deve ter duração mínima de 1 frame");
console.log("  ✔ Clamping bidirecional rígido (fim de mídia A, início de mídia B e duração mínima de 1f) validado.");

// ── 4. Sincronia de Pares A/V Vinculados & J/L Rolling Cut (Alt) ──
console.log("\n4. Validando sincronia de pares A/V vinculados e J/L Rolling Cut (Alt)...");

STATE.activeTimelineCuts = [
    {
        id: "v_left",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 10,
        outFrame: 60,
        link_id: "link_pair_1",
        mediaDurationFrames: 120
    },
    {
        id: "v_right",
        track: "V1",
        timelineStartFrame: 50,
        inFrame: 15,
        outFrame: 65,
        link_id: "link_pair_2",
        mediaDurationFrames: 120
    },
    {
        id: "a_left",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 10,
        outFrame: 60,
        link_id: "link_pair_1",
        mediaDurationFrames: 120
    },
    {
        id: "a_right",
        track: "A1",
        timelineStartFrame: 50,
        inFrame: 15,
        outFrame: 65,
        link_id: "link_pair_2",
        mediaDurationFrames: 120
    }
];

// 4.1 Rolling vinculado simultâneo
const resLinked = TIMELINE_STATE.rollingEdit("v_left", "v_right", +10, true);
assert.ok(resLinked);
assert.equal(resLinked.appliedDelta, 10);

const getVLeft = () => STATE.activeTimelineCuts.find(c => c.id === "v_left");
const getVRight = () => STATE.activeTimelineCuts.find(c => c.id === "v_right");
const getALeft = () => STATE.activeTimelineCuts.find(c => c.id === "a_left");
const getARight = () => STATE.activeTimelineCuts.find(c => c.id === "a_right");

assert.equal(getVLeft().outFrame, 70, "Vídeo Left outFrame deve ser 70");
assert.equal(getALeft().outFrame, 70, "Áudio Left outFrame deve ser 70 (sincronizado)");
assert.equal(getVRight().inFrame, 25, "Vídeo Right inFrame deve ser 25");
assert.equal(getARight().inFrame, 25, "Áudio Right inFrame deve ser 25 (sincronizado)");
assert.equal(getVRight().timelineStartFrame, 60, "Vídeo Right start deve ser 60");
assert.equal(getARight().timelineStartFrame, 60, "Áudio Right start deve ser 60 (sincronizado)");
console.log("  ✔ Par A/V vinculado rolado com 100% de paridade entre vídeo e áudio.");

// 4.2 J/L Rolling Cut independente (Alt pressionado / syncLinkedAudio = false)
const baseJL = {
    leftClipId: "v_left",
    leftStart: 0,
    leftIn: 10,
    leftOut: 70,
    rightClipId: "v_right",
    rightStart: 60,
    rightIn: 25,
    rightOut: 65
};

const resJL = TIMELINE_STATE.rollingEdit("v_left", "v_right", -10, false, baseJL);
assert.ok(resJL);
assert.equal(resJL.appliedDelta, -10);

assert.equal(getVLeft().outFrame, 60, "Vídeo Left recuou para 60");
assert.equal(getVRight().inFrame, 15, "Vídeo Right recuou para 15");
assert.equal(getVRight().timelineStartFrame, 50, "Vídeo Right start recuou para 50");

// Áudio deve ter permanecido inalterado no J/L Cut!
assert.equal(getALeft().outFrame, 70, "Áudio Left deve permanecer em 70 intacto");
assert.equal(getARight().inFrame, 25, "Áudio Right deve permanecer em 25 intacto");
assert.equal(getARight().timelineStartFrame, 60, "Áudio Right start deve permanecer em 60 intacto");
console.log("  ✔ Modo independente J/L Rolling Cut (Alt) validado com preservação do áudio.");

// ── 5. Proteção de Pistas Travadas e Histórico (Undo/Redo) ──
console.log("\n5. Validando proteção de pistas travadas e histórico (Undo / Redo)...");

STATE.activeTimelineCuts = [
    { id: "lock_a", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 50, mediaDurationFrames: 100 },
    { id: "lock_b", track: "V2", timelineStartFrame: 50, inFrame: 0, outFrame: 50, mediaDurationFrames: 100 }
];

const resLocked = TIMELINE_STATE.rollingEdit("lock_a", "lock_b", 10);
assert.equal(resLocked, null, "Pista travada com cadeado deve rejeitar rollingEdit retornando null");
console.log("  ✔ Pista travada 100% protegida contra Rolling Edit.");

// Reversibilidade atômica via TIMELINE_HISTORY
TIMELINE_HISTORY.clear();
STATE.activeTimelineCuts = [
    { id: "hist_a", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 50, mediaDurationFrames: 100 },
    { id: "hist_b", track: "V1", timelineStartFrame: 50, inFrame: 0, outFrame: 50, mediaDurationFrames: 100 }
];

TIMELINE_HISTORY.begin();
TIMELINE_STATE.rollingEdit("hist_a", "hist_b", 12);
TIMELINE_HISTORY.commit();

const histA = STATE.activeTimelineCuts.find(c => c.id === "hist_a");
assert.equal(histA.outFrame, 62, "outFrame após rolling deve ser 62");

// Executa Undo
TIMELINE_HISTORY.undo();
const histAUndo = STATE.activeTimelineCuts.find(c => c.id === "hist_a");
assert.equal(histAUndo.outFrame, 50, "outFrame após Undo deve voltar exatamente para 50");

// Executa Redo
TIMELINE_HISTORY.redo();
const histARedo = STATE.activeTimelineCuts.find(c => c.id === "hist_a");
assert.equal(histARedo.outFrame, 62, "outFrame após Redo deve retornar para 62");
console.log("  ✔ Reversibilidade atômica via TIMELINE_HISTORY (Undo e Redo) validada com sucesso.");

// ── 6. Hit-Testing e Interação em timelineInteraction.js ──
console.log("\n6. Validando hit-testing de emendas contíguas e métodos de interação...");

const mockRenderer = {
    canvas: globalThis.document.getElementById("timeline-canvas"),
    rulerHeight: 30,
    requestRedraw: () => {},
    getLane: () => ({ top: 30, height: 60 })
};

const interaction = new CapiauTimelineInteraction(mockRenderer);

TIMELINE_STATE.zoom = 1.0;
TIMELINE_STATE.scrollLeftFrame = 0;
STATE.activeTimelineCuts = [
    { id: "seam_1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 },
    { id: "seam_2", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100 },
    { id: "seam_gap", track: "V1", timelineStartFrame: 250, inFrame: 0, outFrame: 50 } // gap entre 200 e 250
];

// 6.1 Hit sobre a emenda entre seam_1 e seam_2 (x = 100px)
const hitOnSeam = interaction.getRollingHit(100, "V1");
assert.ok(hitOnSeam, "getRollingHit deve detectar emenda perfeitamente em x=100px");
assert.equal(hitOnSeam.leftClip.id, "seam_1");
assert.equal(hitOnSeam.rightClip.id, "seam_2");
assert.equal(hitOnSeam.seamFrame, 100);

// 6.2 Hit dentro da tolerância de 4px (x = 104px)
const hitWithinTol = interaction.getRollingHit(104, "V1");
assert.ok(hitWithinTol, "getRollingHit deve detectar emenda a 4px de distância (tolerância <= 6px)");

// 6.3 Hit fora da tolerância (x = 120px)
const hitOutsideTol = interaction.getRollingHit(120, "V1");
assert.equal(hitOutsideTol, null, "getRollingHit deve retornar null fora da tolerância");

// 6.4 Hit em clipe sem contiguidade (gap entre 200 e 250)
const hitOnGapSeam = interaction.getRollingHit(200, "V1");
assert.equal(hitOnGapSeam, null, "getRollingHit deve retornar null em borda com gap (não contígua)");

// 6.5 Constante de cursor CURSOR_ROLLING
assert.ok(CURSOR_ROLLING.includes("data:image/svg+xml"), "CURSOR_ROLLING deve ser data URI SVG em alta definição");
assert.ok(CURSOR_ROLLING.includes("12 12, ew-resize"), "CURSOR_ROLLING deve ter hotspot centralizado 12 12 e fallback ew-resize");
assert.equal(interaction.getRollingCursor(), CURSOR_ROLLING, "getRollingCursor deve retornar CURSOR_ROLLING");

// 6.6 Tooltip dinâmico
interaction.showRollingTooltip(100, 100, +12, 24, false);
interaction.hideRollingTooltip();
console.log("  ✔ Hit-testing de emendas a <= 8px, cursor SVG e tooltips validados.");

// 6.7 Comportamento fora de emenda com a ferramenta Rolling (N): Seek, Seleção e Scrub
TIMELINE_STATE.setTool("rolling");
TIMELINE_STATE.playheadFrame = 0;
TIMELINE_STATE.clearClipSelection();

// Mock de getCoordinates e getTrackAtY para interação simulada
interaction.getCoordinates = (cx, cy) => {
    return {
        x: cx,
        y: cy,
        frame: Math.round(cx / TIMELINE_STATE.zoom),
        track: cy < 100 ? "V1" : null
    };
};
interaction.updatePlayhead = (f) => {
    TIMELINE_STATE.playheadFrame = Math.round(f);
};

// 6.7.1 Clique no meio de um clipe (frame 40, longe de emenda)
interaction.onMouseDown({ clientX: 40, clientY: 50, button: 0, preventDefault: () => {} });
assert.equal(TIMELINE_STATE.playheadFrame, 40, "Playhead deve avançar para o frame 40 clicado no corpo do clipe");
assert.equal(TIMELINE_STATE.selectedClipId, "seam_1", "Clipe clicado deve ser selecionado");
assert.equal(interaction.dragState, "scrub", "dragState deve ser 'scrub' permitindo scrubbing contínuo");

// 6.7.2 Movimento durante o drag executa scrubbing
interaction.onMouseMove({ clientX: 65, clientY: 50, buttons: 1, preventDefault: () => {} });
assert.equal(TIMELINE_STATE.playheadFrame, 65, "Scrubbing do mouse deve atualizar playhead para 65");

// 6.7.3 MouseUp finaliza o scrub
interaction.onMouseUp({ clientX: 65, clientY: 50, button: 0 });
assert.equal(interaction.dragState, null, "onMouseUp deve finalizar o scrub");
assert.equal(TIMELINE_STATE.playheadFrame, 65, "Playhead deve permanecer no frame 65 após soltar o mouse");

// 6.7.4 Clique em área vazia / gap (frame 220)
interaction.onMouseDown({ clientX: 220, clientY: 50, button: 0, preventDefault: () => {} });
assert.equal(TIMELINE_STATE.playheadFrame, 220, "Playhead deve avançar para o frame 220 em área de gap");
assert.equal(TIMELINE_STATE.selectedClipId, null, "Seleção de clipe deve ser limpa ao clicar em gap");
assert.equal(interaction.dragState, "scrub", "Deve permitir scrubbing a partir de área vazia");

// 6.7.5 Tecla Escape durante scrub cancela o arraste
interaction.onKeyDown({ key: "Escape", preventDefault: () => {} });
assert.equal(interaction.dragState, null, "Escape deve cancelar o estado de scrub");
console.log("  ✔ Comportamento fora de emenda (Seek, Seleção de clipe/gap, Scrubbing e cancelamento por Escape) validado.");

// ── 7. Transição de Ferramentas e Desbloqueio de Foco ──
console.log("\n7. Validando alternância de ferramentas e ausência de focus trapping...");

TIMELINE_STATE.setTool("rolling");
assert.equal(TIMELINE_STATE.activeTool, "rolling", "activeTool deve ser 'rolling'");

TIMELINE_STATE.setTool("select");
assert.equal(TIMELINE_STATE.activeTool, "select", "activeTool deve retornar para 'select'");

console.log("  ✔ Transição fluida de ferramentas validada.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 5 (ROLLING EDIT TOOL — N) 100% APROVADO!");
console.log("============================================================\n");
