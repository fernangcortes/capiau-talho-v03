// Autoteste da Ferramenta Deslizar Conteúdo Interno (Slip Tool - Task 3)
// Execução: node tests/autoteste_tool_slip.mjs

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
                removeEventListener: () => {}
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

console.log("▶ Iniciando autoteste da Ferramenta Deslizar Conteúdo Interno (Slip Tool — Task 3)...");

// ── 1. Análise do DOM (index.html) e CSS (styles.css) ──
console.log("\n1. Validando estrutura do index.html e estilos do styles.css...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// 1.1 Botão #btn-tool-slip na Tool Strip
const slipBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-slip["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(slipBtnMatch, "Botão #btn-tool-slip deve existir no index.html");
const slipBtnHTML = slipBtnMatch[0];
assert.ok(slipBtnHTML.includes("data-tooltip"), "#btn-tool-slip deve conter data-tooltip explicativo");
assert.ok(slipBtnHTML.includes("<svg"), "#btn-tool-slip deve conter SVG inline para fidelidade vetorial");
assert.ok(/styles\.css\?v=(?:2[5-9]|[3-9]\d)/.test(htmlContent), "Cache-buster de styles.css deve estar em ?v>=25");
assert.ok(/main\.js\?v=(?:2[5-9]|[3-9]\d)/.test(htmlContent), "Cache-buster de main.js deve estar em ?v>=25");
console.log("  ✔ Elemento #btn-tool-slip, SVG inline e cache-busters v>=25 validados.");

// 1.2 Regras CSS no styles.css
assert.ok(cssContent.includes("#btn-tool-slip"), "styles.css deve conter regras para #btn-tool-slip");
assert.ok(/#btn-tool-slip:hover[\s\S]*?--color-cyan/.test(cssContent), "#btn-tool-slip:hover deve usar a cor ciano");
console.log("  ✔ Regras CSS de hover e colorização ciano validadas.");

// ── 2. Validação do Catálogo e dos 5 Perfis Multi-Preset (Diretriz 5) ──
console.log("\n2. Validando Catálogo de Comandos, Perfis NLE e Cheat Sheet (Diretriz 5)...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

// 2.1 Presença no COMMANDS_CATALOG
const cmdSlip = COMMANDS_CATALOG.find(c => c.id === "tools.slip");
assert.ok(cmdSlip, "Comando 'tools.slip' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdSlip.category, "tools", "tools.slip deve pertencer à categoria 'tools'");
assert.ok(cmdSlip.label && cmdSlip.label.includes("Slip"), "Rótulo de tools.slip deve mencionar Slip");
assert.ok(cmdSlip.description, "tools.slip deve conter descrição informativa");
console.log("  ✔ Comando 'tools.slip' devidamente registrado no catálogo central.");

// 2.2 Mapeamento nos 5 Presets da Indústria
const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];

for (const p of presetsEsperados) {
    const presetConfig = KEYMAP_PRESETS[p];
    assert.ok(presetConfig, `Preset '${p}' deve estar definido em KEYMAP_PRESETS`);
    
    const slipBinding = presetConfig["tools.slip"];
    assert.ok(slipBinding && slipBinding.length > 0, `Preset '${p}' deve mapear 'tools.slip'`);

    if (p === "resolve") {
        assert.ok(slipBinding.includes("Shift+KeyY") || slipBinding.includes("KeyY"), `Preset 'resolve' deve usar Shift+KeyY / KeyY`);
    } else {
        assert.ok(slipBinding.includes("KeyY"), `Preset '${p}' deve usar tecla 'Y' para a ferramenta Slip`);
    }
}
console.log("  ✔ Paridade dos 5 perfis NLE (CapIAu, Premiere, DaVinci, Final Cut e Kdenlive) validada com sucesso.");

// 2.3 Simulação da Cheat Sheet
for (const p of presetsEsperados) {
    KEYMAP_SERVICE.setPreset(p);
    const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML("tools.slip");
    assert.ok(badgesHtml && badgesHtml.length > 0, `Cheat Sheet deve gerar badges HTML para 'tools.slip' no preset '${p}'`);
    assert.ok(badgesHtml.includes("Y"), `Badges da Cheat Sheet no preset '${p}' devem conter 'Y'`);
}
KEYMAP_SERVICE.setPreset("capiau"); // Restaura padrão
console.log("  ✔ Renderização dinâmica de badges da Cheat Sheet validada para todos os perfis.");

// ── 3. Teste de Lógica de Dados: slipClip (Deslocamento interno, preservação de timelineStartFrame e duração) ──
console.log("\n3. Validando lógica de slipClip em TIMELINE_STATE...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

TIMELINE_STATE.fps = 24;
TIMELINE_STATE.setTracks([
    { id: "V1", name: "Vídeo 1", kind: "video", volume: 1.0, muted: false, locked: false },
    { id: "A1", name: "Áudio 1", kind: "audio", volume: 1.0, muted: false, locked: false },
    { id: "V2", name: "B-Roll (Travada)", kind: "video", volume: 1.0, muted: false, locked: true }
]);

TIMELINE_HISTORY.clear();

// Cenário A: Clipe simples na timeline
// Posição na timeline: frame 50 a 150 (duração = 100 frames)
// Trecho da mídia bruta: inFrame = 20, outFrame = 120 (duração da mídia = 500 frames)
STATE.activeTimelineCuts = [
    {
        id: "cut_slip_1",
        track: "V1",
        timelineStartFrame: 50,
        timeline_start: 50 / 24,
        inFrame: 20,
        outFrame: 120,
        in: 20 / 24,
        out: 120 / 24,
        mediaDurationFrames: 500
    }
];

// Teste 3.1: Deslizar para a frente (+15 frames)
const res1 = TIMELINE_STATE.slipClip("cut_slip_1", 15);
assert.ok(res1, "slipClip deve retornar resultado bem-sucedido");
assert.equal(res1.appliedDelta, 15, "appliedDelta deve ser +15");
assert.equal(res1.inFrame, 35, "inFrame deve ter avançado de 20 para 35");
assert.equal(res1.outFrame, 135, "outFrame deve ter avançado de 120 para 135");
assert.equal(res1.duration, 100, "Duração do corte deve permanecer rigorosamente 100 frames");
assert.equal(res1.timelineStartFrame, 50, "timelineStartFrame deve permanecer rigorosamente 50");

const cutAtualizado = STATE.activeTimelineCuts.find(c => c.id === "cut_slip_1");
assert.equal(cutAtualizado.timelineStartFrame, 50, "timelineStartFrame no corte deve continuar 50");
assert.equal(cutAtualizado.outFrame - cutAtualizado.inFrame, 100, "Duração física do clipe não pode variar");
console.log("  ✔ Deslocamento interno (+15 frames) preservando posição na timeline e duração validado.");

// Teste 3.2: Deslizar para trás (-25 frames)
const res2 = TIMELINE_STATE.slipClip("cut_slip_1", -25);
assert.equal(res2.appliedDelta, -25, "appliedDelta deve ser -25");
assert.equal(res2.inFrame, 10, "inFrame deve ter recuado de 35 para 10");
assert.equal(res2.outFrame, 110, "outFrame deve ter recuado de 135 para 110");
assert.equal(cutAtualizado.timelineStartFrame, 50, "timelineStartFrame deve permanecer intacto");
console.log("  ✔ Deslocamento interno reverso (-25 frames) validado.");

// Teste 3.3: Clamping no limite inferior (frame 0)
// inFrame atual é 10. Tentar deslocar -50 deve ser limitado a -10 (newIn = 0, newOut = 100)
const resClampLow = TIMELINE_STATE.slipClip("cut_slip_1", -50);
assert.equal(resClampLow.appliedDelta, -10, "appliedDelta deve sofrer clamping para -10 no limite de frame 0");
assert.equal(resClampLow.inFrame, 0, "inFrame deve ser travado em 0");
assert.equal(resClampLow.outFrame, 100, "outFrame deve ser 100 (preservando duração 100)");
assert.equal(cutAtualizado.timelineStartFrame, 50, "timelineStartFrame não pode mudar");
console.log("  ✔ Clamping no limite inferior da mídia (frame 0) validado.");

// Teste 3.4: Clamping no limite superior (mediaDurationFrames = 500)
// Com inFrame = 0 e outFrame = 100, deslocamento máximo permitido é 500 - 100 = +400
const resClampHigh = TIMELINE_STATE.slipClip("cut_slip_1", +600);
assert.equal(resClampHigh.appliedDelta, 400, "appliedDelta deve sofrer clamping para +400 no fim da mídia (500 frames)");
assert.equal(resClampHigh.inFrame, 400, "inFrame deve ser 400");
assert.equal(resClampHigh.outFrame, 500, "outFrame deve ser 500");
assert.equal(cutAtualizado.timelineStartFrame, 50, "timelineStartFrame continua exatamente 50");
console.log("  ✔ Clamping no limite superior da mídia (500 frames) validado.");

// ── 4. Validação de Pares Vinculados A/V e Modo Independente J/L-Cut ──
console.log("\n4. Validando sincronização A/V e modo independente (J/L Slip)...");

const linkId = "link_slip_av_1";
STATE.activeTimelineCuts = [
    {
        id: "clip_v1",
        track: "V1",
        timelineStartFrame: 100,
        inFrame: 50,
        outFrame: 150,
        mediaDurationFrames: 1000,
        link_id: linkId
    },
    {
        id: "clip_a1",
        track: "A1",
        timelineStartFrame: 100,
        inFrame: 50,
        outFrame: 150,
        mediaDurationFrames: 1000,
        link_id: linkId
    }
];

// Teste 4.1: Slip com par vinculado ativo (ambos devem deslizar sincronizados)
const resAv = TIMELINE_STATE.slipClip("clip_v1", 20, true);
assert.equal(resAv.appliedDelta, 20, "Delta aplicado no vídeo deve ser 20");
assert.equal(resAv.inFrame, 70, "inFrame do vídeo deve ser 70");
assert.equal(resAv.partnerClipId, "clip_a1", "Parceiro A1 deve ter sido identificado");
assert.equal(resAv.partnerInFrame, 70, "inFrame do áudio deve ter acompanhado para 70");
assert.equal(resAv.partnerOutFrame, 170, "outFrame do áudio deve ter acompanhado para 170");

const audioCut = STATE.activeTimelineCuts.find(c => c.id === "clip_a1");
assert.equal(audioCut.timelineStartFrame, 100, "Posição do áudio na timeline deve permanecer inalterada");
console.log("  ✔ Deslocamento sincronizado de par A/V vinculado validado com 100% de paridade.");

// Teste 4.2: Slip desvinculado / J-Cut (slipLinked = false com Alt)
const resJL = TIMELINE_STATE.slipClip("clip_v1", -15, false);
assert.equal(resJL.appliedDelta, -15, "Delta aplicado no vídeo isolado deve ser -15");
assert.equal(resJL.inFrame, 55, "Vídeo recuou para 55");
assert.equal(resJL.partnerClipId, null, "Parceiro não deve ser afetado em modo desvinculado");

const audioIntacto = STATE.activeTimelineCuts.find(c => c.id === "clip_a1");
const videoAtual = STATE.activeTimelineCuts.find(c => c.id === "clip_v1");
assert.equal(audioIntacto.inFrame, 70, "Áudio deve permanecer rigorosamente inalterado em 70");
assert.equal(audioIntacto.outFrame, 170, "Áudio deve permanecer rigorosamente inalterado em 170");
assert.equal(audioIntacto.timelineStartFrame, 100, "Posição do áudio na timeline DEVE permanecer rigorosamente em 100");
assert.equal(videoAtual.timelineStartFrame, 100, "Posição do vídeo na timeline DEVE permanecer rigorosamente em 100");
assert.equal(audioIntacto.syncOffset, -15, "syncOffset deve refletir a diferença de -15 frames entre vídeo e áudio");
console.log("  ✔ Modo independente J/L-Cut (deslocamento isolado de vídeo ou áudio sem mover trilha na timeline) validado.");

// ── 5. Proteção contra Pistas Travadas e Histórico (Undo / Redo) ──
console.log("\n5. Validando proteção de pistas travadas e reversibilidade total (Undo / Redo)...");

STATE.activeTimelineCuts.push({
    id: "clip_v2_locked",
    track: "V2", // Pista V2 está travada (locked: true)
    timelineStartFrame: 0,
    inFrame: 10,
    outFrame: 60,
    mediaDurationFrames: 500
});

// Teste 5.1: Clipe em pista travada não pode sofrer slip
const resLocked = TIMELINE_STATE.slipClip("clip_v2_locked", 10);
assert.equal(resLocked, null, "slipClip em pista travada deve retornar null");
const lockedCut = STATE.activeTimelineCuts.find(c => c.id === "clip_v2_locked");
assert.equal(lockedCut.inFrame, 10, "inFrame de pista travada não pode ter mudado");
console.log("  ✔ Pistas travadas com cadeado estão 100% protegidas contra slip.");

// Teste 5.2: Reversibilidade de Undo e Redo
TIMELINE_HISTORY.clear();

const snapshotPreSlip = JSON.stringify(STATE.activeTimelineCuts);
TIMELINE_STATE.slipClip("clip_v1", 30, true);
assert.notEqual(JSON.stringify(STATE.activeTimelineCuts), snapshotPreSlip, "Estado deve ter sido alterado após o slip");

// Executa Undo
const undoOk = TIMELINE_HISTORY.undo();
assert.ok(undoOk, "Undo deve retornar true");
const cutAposUndo = STATE.activeTimelineCuts.find(c => c.id === "clip_v1");
assert.equal(cutAposUndo.inFrame, 55, "Undo deve restaurar inFrame original (55)");
assert.equal(cutAposUndo.outFrame, 155, "Undo deve restaurar outFrame original (155)");

// Executa Redo
const redoOk = TIMELINE_HISTORY.redo();
assert.ok(redoOk, "Redo deve retornar true");
const cutAposRedo = STATE.activeTimelineCuts.find(c => c.id === "clip_v1");
assert.equal(cutAposRedo.inFrame, 85, "Redo deve reaplicar inFrame (85)");
assert.equal(cutAposRedo.outFrame, 185, "Redo deve reaplicar outFrame (185)");
console.log("  ✔ Reversibilidade atômica via TIMELINE_HISTORY (Undo e Redo) 100% validada.");

// ── 6. Validação de Constantes e Métodos em timelineInteraction.js ──
console.log("\n6. Validando constantes e métodos de interação em timelineInteraction.js...");
const interactionModule = await import("../src/ui/js/timelineInteraction.js");
const { CapiauTimelineInteraction } = interactionModule;

const mockRenderer = {
    canvas: globalThis.document.getElementById("timeline-canvas"),
    requestRedraw() {},
    rulerHeight: 30
};
const interaction = new CapiauTimelineInteraction(mockRenderer);

assert.ok(typeof interaction.getSlipCursor === "function", "interaction deve implementar getSlipCursor()");
const slipCursorStr = interaction.getSlipCursor();
assert.ok(slipCursorStr.includes("data:image/svg+xml"), "getSlipCursor deve retornar data URI SVG");
assert.ok(slipCursorStr.includes("%2306b6d4"), "Cursor de Slip deve usar a cor ciano %2306b6d4");

assert.ok(typeof interaction.showSlipTooltip === "function", "interaction deve implementar showSlipTooltip()");
assert.ok(typeof interaction.hideSlipTooltip === "function", "interaction deve implementar hideSlipTooltip()");

// Simula chamada de tooltip
const mockDoc = globalThis.document;
const origGetId = mockDoc.getElementById;
let simulatedTooltip = null;
mockDoc.getElementById = (id) => {
    if (id === "timeline-slip-tooltip") return simulatedTooltip;
    return origGetId(id);
};
mockDoc.createElement = (tag) => {
    const el = {
        style: {},
        innerHTML: "",
        id: "",
        appendChild: () => {}
    };
    if (tag === "div") simulatedTooltip = el;
    return el;
};

interaction.showSlipTooltip(100, 200, 12, 24);
assert.ok(simulatedTooltip, "#timeline-slip-tooltip deve ser criado no DOM");
assert.ok(simulatedTooltip.innerHTML.includes("Slip:"), "Tooltip deve conter rótulo 'Slip:'");
assert.ok(simulatedTooltip.innerHTML.includes("+12f"), "Tooltip deve exibir frames com sinal (+12f)");
assert.ok(simulatedTooltip.innerHTML.includes("+0.50s"), "Tooltip deve exibir conversão para segundos (+0.50s)");

interaction.hideSlipTooltip();
assert.equal(simulatedTooltip.style.display, "none", "hideSlipTooltip deve ocultar o elemento");
console.log("  ✔ Métodos de interação, cursor SVG e tooltips dinâmicos validados com sucesso.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 3 (SLIP TOOL) 100% APROVADO!");
console.log("============================================================\n");
