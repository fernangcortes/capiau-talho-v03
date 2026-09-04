// Autoteste da Ferramenta Deslizar Clipe (Slide Tool - tecla U) & Correção de Trim A/V
// Execução: node tests/autoteste_tool_slide.mjs

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

console.log("▶ Iniciando autoteste da Ferramenta Deslizar Clipe (Slide Tool — tecla U) & Trim A/V...");

// ── 1. Análise do DOM (index.html) e CSS (styles.css) ──
console.log("\n1. Validando estrutura do index.html e estilos do styles.css...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// 1.1 Botão #btn-tool-slide na Tool Strip
const slideBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-slide["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(slideBtnMatch, "Botão #btn-tool-slide deve existir no index.html");
const slideBtnHTML = slideBtnMatch[0];
assert.ok(slideBtnHTML.includes("data-tooltip"), "#btn-tool-slide deve conter data-tooltip explicativo");
assert.ok(slideBtnHTML.includes("Slide") || slideBtnHTML.includes("Deslizar"), "#btn-tool-slide deve mencionar Slide/Deslizar");
assert.ok(slideBtnHTML.includes("<svg"), "#btn-tool-slide deve conter SVG inline para fidelidade vetorial");
assert.ok(/styles\.css\?v=(?:3[5-9]|[4-9]\d)/.test(htmlContent), "Cache-buster de styles.css deve estar em ?v>=35");
assert.ok(/main\.js\?v=(?:3[5-9]|[4-9]\d)/.test(htmlContent), "Cache-buster de main.js deve estar em ?v>=35");
console.log("  ✔ Elemento #btn-tool-slide, SVG inline e cache-busters v>=35 validados.");

// ── 2. Validação do Catálogo e dos 5 Perfis Multi-Preset (Diretriz 5) ──
console.log("\n2. Validando Catálogo de Comandos, Perfis NLE e tecla U nos 5 presets...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

// 2.1 Presença no COMMANDS_CATALOG
const cmdSlide = COMMANDS_CATALOG.find(c => c.id === "tools.slide");
assert.ok(cmdSlide, "Comando 'tools.slide' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdSlide.category, "tools", "tools.slide deve pertencer à categoria 'tools'");
assert.ok(cmdSlide.label && (cmdSlide.label.includes("Slide") || cmdSlide.label.includes("Deslizar")), "Rótulo de tools.slide deve mencionar Slide");
assert.ok(cmdSlide.description, "tools.slide deve conter descrição informativa");
console.log("  ✔ Comando 'tools.slide' devidamente registrado no catálogo central.");

// 2.2 Mapeamento nos 5 Presets da Indústria
const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];

for (const p of presetsEsperados) {
    const presetConfig = KEYMAP_PRESETS[p];
    assert.ok(presetConfig, `Preset '${p}' deve estar definido em KEYMAP_PRESETS`);
    
    const slideBinding = presetConfig["tools.slide"];
    assert.ok(slideBinding && slideBinding.length > 0, `Preset '${p}' deve mapear 'tools.slide'`);
    assert.ok(slideBinding.includes("KeyU"), `Preset '${p}' deve usar tecla 'KeyU' para a ferramenta Slide`);

    // Valida não-colisão com edit.unlink_av
    const unlinkBinding = presetConfig["edit.unlink_av"];
    if (unlinkBinding) {
        assert.ok(!unlinkBinding.includes("KeyU"), `Preset '${p}' não pode colidir 'KeyU' pura com unlink_av`);
    }
}
console.log("  ✔ Mapeamento unificado da tecla 'U' nos 5 perfis NLE validado sem colisão.");

// 2.3 Simulação da Cheat Sheet
for (const p of presetsEsperados) {
    KEYMAP_SERVICE.setPreset(p);
    const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML("tools.slide");
    assert.ok(badgesHtml && badgesHtml.length > 0, `Cheat Sheet deve gerar badges HTML para 'tools.slide' no preset '${p}'`);
    assert.ok(badgesHtml.includes("U"), `Badges da Cheat Sheet no preset '${p}' devem conter 'U'`);
}
KEYMAP_SERVICE.setPreset("capiau"); // Restaura padrão
console.log("  ✔ Renderização dinâmica de badges da Cheat Sheet validada para todos os perfis.");

// ── 3. Validação da Correção Preliminar: Trim Normal (V) com Clamping de Mídia e Par A/V ──
console.log("\n3. Validando correção do Trim (V): Clamping no fim da mídia e sincronia de A/V vinculado...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

const interaction = new CapiauTimelineInteraction({ rulerHeight: 30, requestRedraw: () => {} }, null);

TIMELINE_STATE.fps = 24;
TIMELINE_STATE.setTracks([
    { id: "V1", name: "Vídeo 1", kind: "video", volume: 1.0, muted: false, locked: false },
    { id: "A1", name: "Áudio 1", kind: "audio", volume: 1.0, muted: false, locked: false },
    { id: "V2", name: "B-Roll (Travada)", kind: "video", volume: 1.0, muted: false, locked: true }
]);

TIMELINE_HISTORY.clear();

// Cenário de Trim: Par A/V com mídia bruta de 240 frames
// Clipe cortado inicialmente em inFrame=0, outFrame=100 (posição timeline: 0..100)
STATE.activeTimelineCuts = [
    {
        id: "trim_v1",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        mediaDurationFrames: 240,
        link_id: "link_trim_av"
    },
    {
        id: "trim_a1",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        mediaDurationFrames: 240,
        link_id: "link_trim_av"
    }
];

// Teste 3.1: Clamping rígido à duração física da mídia (impede repetição de frames / áudio piscando)
// Tenta estender 300 frames para a direita (tentando chegar a outFrame = 400 numa mídia de apenas 240 frames)
interaction.dragStartClipFrame = 0;
interaction.dragStartOutFrame = 100;
interaction.dragPartnerStartClipFrame = 0;
interaction.dragPartnerStartOutFrame = 100;

interaction.trimClipRight("trim_v1", 300, false, true);

const getV = () => STATE.activeTimelineCuts.find(c => c.id === "trim_v1");
const getA = () => STATE.activeTimelineCuts.find(c => c.id === "trim_a1");

assert.equal(getV().outFrame, 240, "Trim Right de vídeo DEVE travar rigidamente em 240 frames (fim da mídia bruta)");
assert.equal(getA().outFrame, 240, "Trim Right de áudio vinculado DEVE acompanhar e travar em 240 frames");
console.log("  ✔ Clamping rígido no fim da mídia física (240f) validado sem repetição de frames.");

// Teste 3.2: Arraste multi-frame contínuo mantendo áudio e vídeo juntos (resolvendo bug do partner abandonado)
// Reset para outFrame=100
getV().outFrame = 100;
getA().outFrame = 100;
STATE.activeTimelineCuts = STATE.activeTimelineCuts;
interaction.dragStartOutFrame = 100;
interaction.dragPartnerStartOutFrame = 100;

// Frame 1 do mousemove: delta = +10
interaction.trimClipRight("trim_v1", 10, false, true);
assert.equal(getV().outFrame, 110, "Frame 1: vídeo foi para 110");
assert.equal(getA().outFrame, 110, "Frame 1: áudio acompanhou para 110");

// Frame 2 do mousemove: delta = +25 (na versão com bug, o áudio era esquecido aqui)
interaction.trimClipRight("trim_v1", 25, false, true);
assert.equal(getV().outFrame, 125, "Frame 2: vídeo foi para 125");
assert.equal(getA().outFrame, 125, "Frame 2: áudio DEVE continuar acompanhando para 125 sem ser abandonado");
console.log("  ✔ Arraste simultâneo contínuo de A/V vinculado validado em múltiplos eventos de mouse.");

// Teste 3.3: Trim independente com Alt (J/L Trim)
// Com trimLinked = false, apenas o vídeo deve mudar
interaction.trimClipRight("trim_v1", 40, false, false);
assert.equal(getV().outFrame, 140, "Vídeo foi para 140");
assert.equal(getA().outFrame, 125, "Áudio permaneceu intacto em 125 durante corte J/L com Alt");
assert.notEqual(getV().outFrame, getA().outFrame, "Extensões de vídeo e áudio diferem confirmando o corte L assimétrico");
console.log("  ✔ Trim independente (J/L-Cut com Alt) validado preservando o áudio.");

// ── 4. Validação da Ferramenta Slide (U) em TIMELINE_STATE ──
console.log("\n4. Validando lógica da Ferramenta Slide (slideClip) em TIMELINE_STATE...");

// Configura 3 clipes adjacentes contíguos na pista V1:
// - c1 (Left):   timelineStartFrame: 0,   inFrame: 0,  outFrame: 50,  duração: 50, mediaDurationFrames: 200
// - c2 (Mid):    timelineStartFrame: 50,  inFrame: 20, outFrame: 60,  duração: 40, mediaDurationFrames: 200 (Clipe Selecionado para Slide)
// - c3 (Right):  timelineStartFrame: 90,  inFrame: 10, outFrame: 70,  duração: 60, mediaDurationFrames: 200
// Duração total da fileira = 50 + 40 + 60 = 150 frames.
STATE.activeTimelineCuts = [
    {
        id: "slide_c1",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 50,
        mediaDurationFrames: 200
    },
    {
        id: "slide_c2",
        track: "V1",
        timelineStartFrame: 50,
        inFrame: 20,
        outFrame: 60,
        mediaDurationFrames: 200
    },
    {
        id: "slide_c3",
        track: "V1",
        timelineStartFrame: 90,
        inFrame: 30,
        outFrame: 90,
        mediaDurationFrames: 200
    }
];

const slideBase = {
    clipStart: 50,
    leftClipId: "slide_c1",
    leftOut: 50,
    leftIn: 0,
    leftStart: 0,
    rightClipId: "slide_c3",
    rightIn: 30,
    rightOut: 90,
    rightStart: 90
};

// Teste 4.1: Slide para a direita (+15 frames)
const resSlide1 = TIMELINE_STATE.slideClip("slide_c2", 15, false, slideBase);
assert.ok(resSlide1, "slideClip deve retornar sucesso");
assert.equal(resSlide1.appliedDelta, 15, "appliedDelta deve ser +15");

const getC1 = () => STATE.activeTimelineCuts.find(c => c.id === "slide_c1");
const getC2 = () => STATE.activeTimelineCuts.find(c => c.id === "slide_c2");
const getC3 = () => STATE.activeTimelineCuts.find(c => c.id === "slide_c3");

// Clipe central: posição move de 50 para 65 (+15), in/out e duração intactos
assert.equal(getC2().timelineStartFrame, 65, "c2 deve ter sua posição na timeline movida para 65 (+15)");
assert.equal(getC2().inFrame, 20, "c2.inFrame deve permanecer 100% INTACTO (20)");
assert.equal(getC2().outFrame, 60, "c2.outFrame deve permanecer 100% INTACTO (60)");
assert.equal(getC2().outFrame - getC2().inFrame, 40, "Duração de c2 deve continuar exatamente 40 frames");

// Vizinho anterior (c1): outFrame aumenta de 50 para 65 (+15)
assert.equal(getC1().timelineStartFrame, 0, "c1.timelineStartFrame deve continuar 0");
assert.equal(getC1().outFrame, 65, "c1.outFrame deve ser compensado para 65 (+15)");

// Vizinho posterior (c3): inFrame aumenta de 30 para 45 (+15), timelineStartFrame move de 90 para 105 (+15)
assert.equal(getC3().timelineStartFrame, 105, "c3.timelineStartFrame deve ser compensado para 105 (+15)");
assert.equal(getC3().inFrame, 45, "c3.inFrame deve ser compensado para 45 (+15)");
assert.equal(getC3().outFrame, 90, "c3.outFrame deve permanecer inalterado em 90");

// Conservação estrita da timeline: Dur(c1) + Dur(c2) + Dur(c3) = 65 + 40 + (90 - 45) = 150
const durTotal1 = (getC1().outFrame - getC1().inFrame) + (getC2().outFrame - getC2().inFrame) + (getC3().outFrame - getC3().inFrame);
assert.equal(durTotal1, 150, "A duração total da timeline DEVE ser 100% conservada (150 frames)");
console.log("  ✔ Slide para a direita (+15f) validado com compensação simétrica e conservação da timeline.");

// Teste 4.2: Slide reverso para a esquerda (-20 frames em relação à base 50 -> frame 30)
const resSlide2 = TIMELINE_STATE.slideClip("slide_c2", -20, false, slideBase);
assert.equal(resSlide2.appliedDelta, -20, "appliedDelta deve ser -20");
assert.equal(getC2().timelineStartFrame, 30, "c2 deve estar no frame 30 (50 - 20)");
assert.equal(getC1().outFrame, 30, "c1.outFrame compensado para 30 (50 - 20)");
assert.equal(getC3().timelineStartFrame, 70, "c3.timelineStartFrame compensado para 70 (90 - 20)");
assert.equal(getC3().inFrame, 10, "c3.inFrame compensado para 10 (30 - 20)");
assert.equal(getC3().outFrame, 90, "c3.outFrame preservado em 90");

const durTotal2 = (getC1().outFrame - getC1().inFrame) + (getC2().outFrame - getC2().inFrame) + (getC3().outFrame - getC3().inFrame);
assert.equal(durTotal2, 150, "A duração total da timeline DEVE continuar rigorosamente 150 frames");
console.log("  ✔ Slide reverso para a esquerda (-20f) validado com inFrame=10 no vizinho posterior.");

// Teste 4.3: Clamping bidirecional
// Tentar deslizar mais para a esquerda (-40 frames): como c3.inFrame na base é 30, o recuo máximo permitido é -30
const resClampLeft = TIMELINE_STATE.slideClip("slide_c2", -40, false, slideBase);
assert.equal(resClampLeft.appliedDelta, -30, "slideClip DEVE sofrer clamping em -30 porque c3.inFrame não pode ser negativo");
assert.equal(getC3().inFrame, 0, "c3.inFrame cravado no limite 0");

// Tentar deslizar além da duração do vizinho posterior (c3 tem outFrame=90, inFrame base=30 -> sobra 59 frames para encolher até dur=1)
const resClampRight = TIMELINE_STATE.slideClip("slide_c2", +200, false, slideBase);
assert.ok(resClampRight.appliedDelta < 200, "slideClip DEVE sofrer clamping à direita antes de c3 sumir");
assert.ok(getC3().outFrame - getC3().inFrame >= 1, "Vizinho posterior c3 deve reter pelo menos 1 frame de duração");
console.log("  ✔ Clamping bidirecional nos limites físicos e de mídia validado.");

// Teste 4.4: Metadados para Monitor 2-Up Contextual
assert.ok(resSlide1.leftClip, "slideClip deve retornar leftClip (Outgoing)");
assert.ok(resSlide1.rightClip, "slideClip deve retornar rightClip (Incoming)");
console.log("  ✔ Metadados contextuais para o Monitor 2-Up retornados com precisão.");

// ── 5. Validação de Par A/V Vinculado na Ferramenta Slide ──
console.log("\n5. Validando Slide de par A/V vinculado...");

STATE.activeTimelineCuts = [
    // Pista V1
    { id: "v_left", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 50, mediaDurationFrames: 200 },
    { id: "v_mid", track: "V1", timelineStartFrame: 50, inFrame: 20, outFrame: 60, mediaDurationFrames: 200, link_id: "link_slide_av" },
    { id: "v_right", track: "V1", timelineStartFrame: 90, inFrame: 10, outFrame: 70, mediaDurationFrames: 200 },
    // Pista A1
    { id: "a_left", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 50, mediaDurationFrames: 200 },
    { id: "a_mid", track: "A1", timelineStartFrame: 50, inFrame: 20, outFrame: 60, mediaDurationFrames: 200, link_id: "link_slide_av" },
    { id: "a_right", track: "A1", timelineStartFrame: 90, inFrame: 10, outFrame: 70, mediaDurationFrames: 200 }
];

const slideBaseAV = {
    clipStart: 50,
    leftClipId: "v_left",
    leftOut: 50,
    leftIn: 0,
    leftStart: 0,
    rightClipId: "v_right",
    rightIn: 10,
    rightOut: 70,
    rightStart: 90,
    partnerClipId: "a_mid",
    partnerClipStart: 50,
    partnerLeftClipId: "a_left",
    partnerLeftOut: 50,
    partnerLeftIn: 0,
    partnerLeftStart: 0,
    partnerRightClipId: "a_right",
    partnerRightIn: 10,
    partnerRightOut: 70,
    partnerRightStart: 90
};

// Slide vinculado (+12 frames)
const resAV = TIMELINE_STATE.slideClip("v_mid", 12, true, slideBaseAV);
assert.equal(resAV.appliedDelta, 12, "Delta aplicado no par A/V deve ser +12");

const vMid = STATE.activeTimelineCuts.find(c => c.id === "v_mid");
const aMid = STATE.activeTimelineCuts.find(c => c.id === "a_mid");
const aLeft = STATE.activeTimelineCuts.find(c => c.id === "a_left");
const aRight = STATE.activeTimelineCuts.find(c => c.id === "a_right");

assert.equal(vMid.timelineStartFrame, 62, "Vídeo central deve estar em 62");
assert.equal(aMid.timelineStartFrame, 62, "Áudio vinculado central deve acompanhar exatamente em 62");
assert.equal(aLeft.outFrame, 62, "Vizinho de áudio anterior acompanhou para 62");
assert.equal(aRight.timelineStartFrame, 102, "Vizinho de áudio posterior acompanhou para 102");
assert.equal(aRight.inFrame, 22, "inFrame do vizinho de áudio posterior avançou para 22");
console.log("  ✔ Par A/V vinculado deslizado com 100% de paridade entre vídeo e áudio.");

// ── 6. Validação de Proteção de Pistas e Histórico (Undo / Redo) ──
console.log("\n6. Validando proteção de pistas travadas e histórico (Undo / Redo)...");

// 6.1 Pista travada: não pode permitir slide
const trackV1 = TIMELINE_STATE.getTrack("V1");
trackV1.locked = true;
const resLocked = TIMELINE_STATE.slideClip("v_mid", 5, true, slideBaseAV);
assert.equal(resLocked, null, "slideClip deve recusar operação se a pista estiver travada com cadeado");
trackV1.locked = false;
console.log("  ✔ Pista travada com cadeado 100% protegida contra Slide.");

// 6.2 Undo / Redo via TIMELINE_HISTORY
const getVMid = () => STATE.activeTimelineCuts.find(c => c.id === "v_mid");
const posBefore = getVMid().timelineStartFrame;

TIMELINE_HISTORY.begin();
TIMELINE_STATE.slideClip("v_mid", 5, true, slideBaseAV);
TIMELINE_HISTORY.commit();

const posAfter = getVMid().timelineStartFrame;
assert.notEqual(posBefore, posAfter, "Posição deve ter mudado com o slide");

TIMELINE_HISTORY.undo();
assert.equal(getVMid().timelineStartFrame, posBefore, "Undo deve restaurar exatamente a posição anterior");

TIMELINE_HISTORY.redo();
assert.equal(getVMid().timelineStartFrame, posAfter, "Redo deve reaplicar exatamente a posição do slide");
console.log("  ✔ Reversibilidade atômica via TIMELINE_HISTORY (Undo e Redo) validada com sucesso.");

// ── 7. Validação de Interação, Cursors e Tooltips ──
console.log("\n7. Validando constantes de cursor e métodos de interação em timelineInteraction.js...");

assert.ok(typeof interaction.getSlideCursor === "function", "interaction.getSlideCursor deve ser uma função");
const slideCursorStr = interaction.getSlideCursor();
assert.ok(slideCursorStr.includes("data:image/svg+xml"), "getSlideCursor deve retornar um cursor SVG em alta definição");
assert.ok(typeof interaction.showSlideTooltip === "function", "interaction.showSlideTooltip deve existir");
assert.ok(typeof interaction.hideSlideTooltip === "function", "interaction.hideSlideTooltip deve existir");
console.log("  ✔ Métodos de cursor e tooltips da Ferramenta Slide validados com sucesso.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 4 (SLIDE TOOL — U) 100% APROVADO!");
console.log("============================================================\n");
