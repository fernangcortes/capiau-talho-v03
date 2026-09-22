// autoteste_jcut_trim.mjs
// Autoteste automatizado: Validação de J-Cut e L-Cut com Alt (Prevenção de Invasão de Faixas e Sincronia A/V)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
        return {
            id,
            style: {},
            classList: {
                toggle: () => {},
                add: () => {},
                remove: () => {},
                contains: () => false
            },
            setAttribute: () => {},
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            removeEventListener: () => {}
        };
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de J-Cut / L-Cut com Alt e Bloqueio Físico NLE...\n");

const { STATE } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "state.js")).href);
const { TIMELINE_STATE } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineState.js")).href);
const { CapiauTimelineInteraction } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineInteraction.js")).href);

const interaction = new CapiauTimelineInteraction({ rulerHeight: 30, requestRedraw: () => {} }, null);

// Configuração do cenário exato das Imagens 1 e 2:
// - V1: c1_v (0..312) e c_freeze (312..384)
// - A1: c1_a (0..312)
// - Clip 2: c2_v e c2_a posicionados em 384 (inFrame: 250, outFrame: 442)
function setupInitialTimeline() {
    STATE.activeTimelineCuts = [
        { id: "c1_v", track: "V1", inFrame: 0, outFrame: 312, timelineStartFrame: 0, link_id: "link_1" },
        { id: "c1_a", track: "A1", inFrame: 0, outFrame: 312, timelineStartFrame: 0, link_id: "link_1" },
        { id: "c_freeze", track: "V1", inFrame: 312, outFrame: 384, timelineStartFrame: 312, link_id: null, is_freeze: true },
        { id: "c2_v", track: "V1", inFrame: 250, outFrame: 442, timelineStartFrame: 384, link_id: "link_2" },
        { id: "c2_a", track: "A1", inFrame: 250, outFrame: 442, timelineStartFrame: 384, link_id: "link_2" }
    ];
}

// ── 1. CENÁRIO DA IMAGEM 1: TRIM COM ALT NO VÍDEO NÃO PULA O ÁUDIO ──
console.log("1. Validando J-Cut com Alt no vídeo (Imagem 1: áudio não pula nem sobrepõe A1)...");
setupInitialTimeline();

interaction.dragStartClipFrame = 384;
interaction.dragStartInFrame = 250;
interaction.dragPartnerStartClipFrame = null;
interaction.dragPartnerStartInFrame = null;

// Usuário encurta início do vídeo com Alt (trimLinked = false) em +50 frames
interaction.trimClipLeft("c2_v", 50, false, false);

let c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
let c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(c2_v.timelineStartFrame, 434, "Vídeo c2_v deve iniciar em 434 (384 + 50).");
assert.strictEqual(c2_v.inFrame, 300, "inFrame de c2_v deve ser 300 (250 + 50).");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Áudio c2_a DEVE permanecer fixo em 384, SEM saltar para 134.");
assert.strictEqual(c2_a.inFrame, 250, "inFrame de c2_a deve permanecer em 250.");
assert.strictEqual(c2_a.syncOffset, 0, "syncOffset de c2_a deve registrar 0 (mídia em sincronia lip-sync).");

// Dispara re-set da lista de cortes (simulando re-render ou reatividade de STATE)
STATE.activeTimelineCuts = STATE.activeTimelineCuts;
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Após reavaliação de STATE, áudio c2_a deve continuar estritamente em 384.");
console.log("  ✔ Áudio permaneceu estático em 384 com syncOffset correto e sem invadir o vizinho.");

// ── 2. CENÁRIO DA IMAGEM 2: PUXAR PELO ÁUDIO NÃO ULTRAPASSA O OUTRO VÍDEO ──
console.log("\n2. Validando puxar pelo áudio com Alt (Imagem 2: vídeo não ultrapassa freeze/vídeo 1)...");
setupInitialTimeline();

// Usuário puxa o áudio c2_a para a esquerda com Alt até o limite do clipe 1 (A1 termina em 312)
interaction.dragStartClipFrame = 384;
interaction.dragStartInFrame = 250;
interaction.dragPartnerStartClipFrame = null;
interaction.dragPartnerStartInFrame = null;

// Tenta puxar -200 frames (com mídia suficiente para -250), mas A1 tem barreira em 312 (-72 frames)
interaction.trimClipLeft("c2_a", -200, false, false);

c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(c2_a.timelineStartFrame, 312, "Áudio c2_a deve travar estritamente em 312 na barreira de c1_a.");
assert.strictEqual(c2_a.inFrame, 178, "inFrame de c2_a deve ser 178 (250 - 72).");
assert.strictEqual(c2_v.timelineStartFrame, 384, "Vídeo c2_v NÃO pode ter ultrapassado o freeze frame (384) nem pulado para 211.");
assert.strictEqual(c2_v.inFrame, 250, "Vídeo c2_v deve manter inFrame intacto em 250.");
console.log("  ✔ Áudio travou na barreira física 312 e vídeo permaneceu 100% protegido em 384.");

// ── 3. PUXAR PELO ÁUDIO SEM ALT (LINKADO) RESPEITA BARREIRA DO FREEZE EM V1 ──
console.log("\n3. Validando puxar pelo áudio sem Alt (trimLinked = true) com freeze frame em V1...");
setupInitialTimeline();

interaction.dragStartClipFrame = 384;
interaction.dragStartInFrame = 250;
interaction.dragPartnerStartClipFrame = 384;
interaction.dragPartnerStartInFrame = 250;

// Usuário tenta puxar o áudio -100 frames sem Alt.
// Como c2_v está colado ao c_freeze em 384, o par linkado NÃO pode avançar para a esquerda.
interaction.trimClipLeft("c2_a", -100, false, true);

c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(c2_v.timelineStartFrame, 384, "Vídeo c2_v travou no freeze frame em 384.");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Áudio c2_a vinculado não pode ultrapassar a barreira de vídeo do parceiro.");
console.log("  ✔ Par linkado bloqueado corretamente pela barreira mais restritiva (V1 freeze em 384).");

// ── 4. TRIM RIGHT COM ALT PRESERVA POSIÇÕES E ATUALIZA SYNCOFFSET ──
console.log("\n4. Validando Trim Right independente com Alt...");
setupInitialTimeline();

interaction.dragStartClipFrame = 384;
interaction.dragStartInFrame = 250;
interaction.dragStartOutFrame = 442;
interaction.dragPartnerStartClipFrame = null;
interaction.dragPartnerStartInFrame = null;
interaction.dragPartnerStartOutFrame = null;

// Encolhe o outFrame do vídeo c2_v com Alt em -40 frames
interaction.trimClipRight("c2_v", -40, false, false);

c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(c2_v.outFrame, 402, "c2_v outFrame reduzido para 402.");
assert.strictEqual(c2_a.outFrame, 442, "c2_a outFrame deve permanecer em 442.");
assert.strictEqual(c2_v.timelineStartFrame, 384, "Início do vídeo inalterado.");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Início do áudio inalterado.");
console.log("  ✔ Trim Right independente com Alt executado preservando integridade das pistas.");

// ── 5. MOVECLIP PRESERVA O OFFSET RELATIVO DE J-CUT / L-CUT ──
console.log("\n5. Validando que moveClip preserva o offset de J-cut entre áudio e vídeo...");
// Cria J-cut: áudio em 312 (in 178), vídeo em 384 (in 250) — offset relativo de 72 frames
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 200, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 200, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c2_v", track: "V1", inFrame: 250, outFrame: 442, timelineStartFrame: 384, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 178, outFrame: 442, timelineStartFrame: 312, link_id: "link_2" }
];

// Move c2_v para a frente (+100 frames, target = 484)
interaction.moveClip("c2_v", 484, null, "clamp");

c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(c2_v.timelineStartFrame, 484, "Vídeo c2_v deve mover para 484.");
assert.strictEqual(c2_a.timelineStartFrame, 412, "Áudio c2_a DEVE manter o offset de -72 frames (484 - 72 = 412).");
assert.strictEqual(c2_v.timelineStartFrame - c2_a.timelineStartFrame, 72, "Diferença temporal do J-cut deve ser exatamente 72 frames.");
console.log("  ✔ moveClip preservou o offset relativo de 72 frames do J-cut.");

// ── 6. SEGURANÇA E BARREIRA FÍSICA NO SETTER DE STATE.JS ──
console.log("\n6. Validando barreira física em state.js contra qualquer injeção com sobreposição...");
// Força um payload onde o cálculo A/V jogaria o áudio para frame 100, mas c1_a termina em 200
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 200, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 200, timelineStartFrame: 0, link_id: "link_1" },
    // c2_v em 200, mas syncOffset propositalmente quebrado/negativo (-200)
    { id: "c2_v", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 200, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 0, outFrame: 100, timelineStartFrame: 200, link_id: "link_2", syncOffset: -150 }
];

c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
assert.ok(c2_a.timelineStartFrame >= 200, `Áudio c2_a travou em ${c2_a.timelineStartFrame} e não invadiu c1_a (termina em 200).`);
console.log("  ✔ Barreira anti-colisão em state.js impediu sobreposição física na pista A1.");

// ── 7. SOLTAR ALT DURANTE O ARRASTE NÃO FAZ PISTAS NÃO SEGURADAS SUMIREM OU PISCAREM ──
console.log("\n7. Validando soltar Alt durante o arraste (pistas não seguradas não somem nem piscam)...");
setupInitialTimeline();

interaction.dragStartClipFrame = 384;
interaction.dragStartInFrame = 250;
interaction.dragTrimLinked = false; // Usuário iniciou com Alt
interaction.dragPartnerStartClipFrame = 384;
interaction.dragPartnerStartInFrame = 250;
interaction.dragPartnerStartOutFrame = 442;

// Frame 1: usuário move mouse com Alt (delta = +20)
interaction.trimClipLeft("c2_v", 20, false, interaction.dragTrimLinked);
c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
assert.strictEqual(c2_v.timelineStartFrame, 404, "Vídeo moveu para 404.");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Áudio permaneceu em 384.");
assert.ok(c2_a.outFrame - c2_a.inFrame > 0, "Duração do áudio deve ser positiva.");

// Frame 2: usuário solta Alt mas continua segurando o mouse e move horizontalmente (delta = +22)
// O trimLinked deve manter a modalidade inicial sem explodir delta e sem sumir a pista
interaction.trimClipLeft("c2_v", 22, false, interaction.dragTrimLinked);
c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
assert.strictEqual(c2_v.timelineStartFrame, 406, "Vídeo moveu suavemente para 406.");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Áudio não segurado NÃO sumiu nem se deslocou.");
assert.strictEqual(c2_a.inFrame, 250, "inFrame de áudio não se alterou.");
assert.strictEqual(c2_a.outFrame, 442, "outFrame de áudio não se alterou.");
assert.ok(c2_a.outFrame - c2_a.inFrame > 0, "Duração do áudio deve permanecer intacta (192 frames).");

// Frame 3: usuário move mais para a frente (delta = +30)
interaction.trimClipLeft("c2_v", 30, false, interaction.dragTrimLinked);
c2_v = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
c2_a = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
assert.strictEqual(c2_v.timelineStartFrame, 414, "Vídeo moveu para 414.");
assert.strictEqual(c2_a.timelineStartFrame, 384, "Áudio continua em 384 sem piscar.");
assert.ok(c2_a.outFrame - c2_a.inFrame === 192, "Duração do áudio estritamente constante.");
console.log("  ✔ Pistas não seguradas não sumiram, não piscaram e mantiveram duração rigorosamente constante.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DE J-CUT / L-CUT COM ALT 100% APROVADO!");
console.log("============================================================\n");
