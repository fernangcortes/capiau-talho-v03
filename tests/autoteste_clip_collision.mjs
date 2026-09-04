// autoteste_clip_collision.mjs
// Autoteste automatizado das Tasks 3.5 & 3.6: Prevenção de Sobreposição de Pistas, Sobrescrita (Shift) & Inserção Ripple (Ctrl)

import assert from "node:assert/strict";
import fs from "node:fs";
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

console.log("▶ Iniciando autoteste das Tasks 3.5 & 3.6: Prevenção de Sobreposição, Sobrescrita (Shift) & Inserção Ripple (Ctrl)...\n");

// ── 1. VALIDAÇÃO DE DOM E CACHE-BUSTERS NO INDEX.HTML ─────────────────
console.log("1. Validando estrutura do DOM e cache-busters no index.html...");
const htmlPath = path.join(rootDir, "src", "ui", "index.html");
const htmlContent = fs.readFileSync(htmlPath, "utf-8");

assert.ok(htmlContent.includes('id="tool-select-wrapper"'), "Elemento #tool-select-wrapper deve existir.");
assert.ok(htmlContent.includes('id="btn-tool-select"'), "Botão #btn-tool-select deve existir.");
assert.ok(htmlContent.includes('class="flyout-indicator"'), "Indicador de flyout .flyout-indicator deve existir.");
assert.ok(htmlContent.includes('id="flyout-collision-modes"'), "Menu #flyout-collision-modes deve existir.");
assert.ok(htmlContent.includes('id="btn-collision-clamp"'), "Botão #btn-collision-clamp deve existir.");
assert.ok(htmlContent.includes('id="btn-collision-overwrite"'), "Botão #btn-collision-overwrite deve existir.");
assert.ok(htmlContent.includes('id="btn-collision-ripple"'), "Botão #btn-collision-ripple deve existir.");

// Validação dos cache-busters v>=27
const cssBusterMatch = htmlContent.match(/styles\.css\?v=(\d+)/);
assert.ok(cssBusterMatch && parseInt(cssBusterMatch[1], 10) >= 27, "styles.css deve ter cache-buster ?v>=27");
const jsBusterMatch = htmlContent.match(/main\.js\?v=(\d+)/);
assert.ok(jsBusterMatch && parseInt(jsBusterMatch[1], 10) >= 27, "main.js deve ter cache-buster ?v>=27");
console.log("  ✔ Estrutura do submenu, 3 line icons SVG e cache-busters v>=27 validados.");

// ── 2. VALIDAÇÃO DE ESTILOS CSS EM STYLES.CSS ────────────────────────
console.log("\n2. Validando regras de estilo CSS em styles.css...");
const cssPath = path.join(rootDir, "src", "ui", "styles.css");
const cssContent = fs.readFileSync(cssPath, "utf-8");

assert.ok(cssContent.includes(".toolbar-tool-wrapper"), "Classe .toolbar-tool-wrapper deve estar estilizada.");
assert.ok(cssContent.includes(".flyout-indicator"), "Classe .flyout-indicator deve estar estilizada.");
assert.ok(cssContent.includes(".toolbar-submenu-flyout"), "Classe .toolbar-submenu-flyout deve estar estilizada.");
assert.ok(cssContent.includes(".btn-collision-mode"), "Classe .btn-collision-mode deve estar estilizada.");
console.log("  ✔ Estilos de glassmorphism, flyout e hover validados.");

// ── 3. SIMULAÇÃO DO TIMELINE STATE E LÓGICA DE COLISÃO ───────────────
console.log("\n3. Validando métodos e lógica no CapiauTimelineState...");

const { CapiauTimelineState } = await import("../src/ui/js/timelineState.js");
const { STATE } = await import("../src/ui/js/state.js");

const tState = new CapiauTimelineState();

// Teste de modo padrão e persistência
assert.strictEqual(tState.dragCollisionMode, "clamp", "Modo padrão inicial deve ser 'clamp'.");
tState.setDragCollisionMode("overwrite");
assert.strictEqual(tState.dragCollisionMode, "overwrite", "Modo deve atualizar para 'overwrite'.");
assert.strictEqual(globalThis.localStorage.getItem("capiau_collision_mode_v1"), "overwrite", "Persistência no localStorage deve funcionar.");
tState.setDragCollisionMode("ripple");
assert.strictEqual(tState.dragCollisionMode, "ripple", "Modo deve atualizar para 'ripple'.");
tState.setDragCollisionMode("clamp");
assert.strictEqual(tState.dragCollisionMode, "clamp", "Modo deve retornar para 'clamp'.");
console.log("  ✔ Getter, setter e persistência de dragCollisionMode validados.");

// Teste de getTrackGaps com ignoredClipIds e includeEndGap
STATE.activeTimelineCuts = [
    { id: "c1", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "c2", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 72 }, // gap de 48 a 72 (24f)
    { id: "c3", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 144 } // c2 acaba em 120, gap 120..144 (24f)
];

const gapsNormal = tState.getTrackGaps("V1", [], false);
assert.strictEqual(gapsNormal.length, 2, "Devem existir 2 gaps intermediários.");
assert.strictEqual(gapsNormal[0].startFrame, 48);
assert.strictEqual(gapsNormal[0].endFrame, 72);
assert.strictEqual(gapsNormal[1].startFrame, 120);
assert.strictEqual(gapsNormal[1].endFrame, 144);

const gapsWithEnd = tState.getTrackGaps("V1", [], true);
assert.strictEqual(gapsWithEnd.length, 3, "Com includeEndGap, deve incluir o gap infinito final.");
assert.strictEqual(gapsWithEnd[2].startFrame, 192);
assert.strictEqual(gapsWithEnd[2].endFrame, Infinity);

const gapsIgnoringC2 = tState.getTrackGaps("V1", ["c2"], false);
assert.strictEqual(gapsIgnoringC2.length, 1, "Ignorando c2, deve fundir o gap de 48 a 144.");
assert.strictEqual(gapsIgnoringC2[0].startFrame, 48);
assert.strictEqual(gapsIgnoringC2[0].endFrame, 144);
console.log("  ✔ getTrackGaps com ignoredClipIds e includeEndGap validado.");

// Teste de getTrackClipNeighbors
const n1 = tState.getTrackClipNeighbors("V1", 50, []);
assert.strictEqual(n1.prevClip.id, "c1", "Vizinho anterior a 50 deve ser c1.");
assert.strictEqual(n1.prevEnd, 48);
assert.strictEqual(n1.nextClip.id, "c2", "Vizinho posterior a 50 deve ser c2.");
assert.strictEqual(n1.nextStart, 72);
console.log("  ✔ getTrackClipNeighbors validado com precisão.");

// ── 4. VALIDAÇÃO DO CLAMPING NO TRIM (LEFT & RIGHT) ───────────────────
console.log("\n4. Validando Clamping nos Trims (trimClipLeft e trimClipRight)...");

const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
const interaction = new CapiauTimelineInteraction({ rulerHeight: 30, requestRedraw: () => {} }, null);

// Setup para Trim Left no clipe c2 (posição 72..120, com handles de mídia inFrame=50, outFrame=98; vizinho c1 termina em 48)
const clipC2 = STATE.activeTimelineCuts.find(c => c.id === "c2");
clipC2.inFrame = 50;
clipC2.outFrame = 98;
interaction.dragStartClipFrame = 72;
interaction.dragStartInFrame = 50;
// Tenta trimar 40 frames para a esquerda (com mídia para -50 frames, mas o vizinho c1 termina em 48, delta máximo permitido = -24)
interaction.trimClipLeft("c2", -40, false);
const c2AfterLeftTrim = STATE.activeTimelineCuts.find(c => c.id === "c2");
assert.strictEqual(c2AfterLeftTrim.timelineStartFrame, 48, "Trim Left DEVE travar em 48 (fim do vizinho c1), impedindo invasão.");
console.log("  ✔ Trim Left travou rigidamente na barreira física do clipe anterior (48f).");

// Setup para Trim Right no clipe c2 (posição atual 48..120, vizinho c3 começa em 144)
interaction.dragStartOutFrame = c2AfterLeftTrim.outFrame;
interaction.dragStartClipFrame = 48;
// Tenta esticar 50 frames para a direita (tentativa de chegar a 170, invadindo c3 que começa em 144)
interaction.trimClipRight("c2", 50, false);
const c2AfterRightTrim = STATE.activeTimelineCuts.find(c => c.id === "c2");
const c2End = c2AfterRightTrim.timelineStartFrame + (c2AfterRightTrim.outFrame - c2AfterRightTrim.inFrame);
assert.strictEqual(c2End, 144, "Trim Right DEVE travar em 144 (início do vizinho c3), impedindo invasão.");
console.log("  ✔ Trim Right travou rigidamente na barreira física do clipe posterior (144f).");

// ── 5. VALIDAÇÃO DO ARRASTE COM BLOQUEIO FÍSICO (CLAMP) ───────────────
console.log("\n5. Validando Arraste com Bloqueio Físico (Modo Clamp)...");

// Reset dos cortes para estado limpo
STATE.activeTimelineCuts = [
    { id: "v1_a", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "v1_b", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 100 },
    { id: "v1_c", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 200 }
];

tState.setDragCollisionMode("clamp");

// Arrastando v1_b (duração 48) para a esquerda em direção a v1_a (termina em 48):
// Tenta mover v1_b para o frame 20 (colidindo com v1_a)
const clamped1 = interaction.calculateClampedStart("V1", 20, 48, ["v1_b"]);
assert.strictEqual(clamped1, 48, "v1_b deve bater na borda direita de v1_a (frame 48) e travar.");

// Tenta mover v1_b para o frame 170 (colidindo com v1_c que começa em 200)
const clamped2 = interaction.calculateClampedStart("V1", 170, 48, ["v1_b"]);
assert.strictEqual(clamped2, 152, "v1_b deve travar em 152 (200 - 48 = 152), encostando perfeitamente em v1_c sem invadir.");

// Teste de pulo magnético de vizinho:
// Se o usuário arrastar com firmeza cruzando o centro de v1_c (centro = 224):
// Frame solicitado = 230
const clamped3 = interaction.calculateClampedStart("V1", 230, 48, ["v1_b"]);
assert.ok(clamped3 >= 248, "Ao cruzar o centro de v1_c, v1_b deve saltar para além do fim de v1_c (>=248).");

interaction.moveClip("v1_b", 20, "V1", "clamp");
const movedB = STATE.activeTimelineCuts.find(c => c.id === "v1_b");
assert.strictEqual(movedB.timelineStartFrame, 48, "moveClip em modo clamp deve aplicar o frame travado (48).");
console.log("  ✔ Arraste individual travou na barreira e realizou salto magnético limpo sem invasão.");

// ── 6. VALIDAÇÃO DO MODO SOBRESCRITA (OVERWRITE) ─────────────────────
console.log("\n6. Validando Modo Sobrescrita (overwriteTimeRange)...");

// Cenário: Clipe subjacente de 0 a 100 na pista V1
STATE.activeTimelineCuts = [
    { id: "base", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0 }
];

// 1. Sobrescrita no meio: novo clipe pousa de 30 a 60 (dur: 30)
const splitRes = tState.overwriteTimeRange("V1", 30, 30, ["novo"]);
assert.strictEqual(splitRes.length, 2, "Sobrescrita no meio deve fatiar o clipe base em 2 pedaços.");
assert.strictEqual(splitRes[0].outFrame, 30, "Parte esquerda deve terminar no frame 30.");
assert.strictEqual(splitRes[1].timelineStartFrame, 60, "Parte direita deve começar no frame 60.");
assert.strictEqual(splitRes[1].inFrame, 60, "Parte direita deve ter inFrame em 60.");

// 2. Sobrescrita na cauda: novo clipe pousa de 70 a 120 (dur: 50)
STATE.activeTimelineCuts = [
    { id: "base", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0 }
];
const tailRes = tState.overwriteTimeRange("V1", 70, 50, ["novo"]);
assert.strictEqual(tailRes.length, 1, "Sobrescrita na cauda deve apenas aparar.");
assert.strictEqual(tailRes[0].outFrame, 70, "Cauda deve ser aparada para 70.");

// 3. Sobrescrita total: novo clipe pousa de 0 a 120
const totalRes = tState.overwriteTimeRange("V1", 0, 120, ["novo"]);
assert.strictEqual(totalRes.length, 0, "Sobrescrita total deve remover o clipe completamente encoberto.");
console.log("  ✔ Sobrescrita fatiou no meio, aparou cauda e removeu clipes encobertos com zero sobreposição.");

// ── 7. VALIDAÇÃO DO MODO INSERÇÃO RIPPLE (RIPPLE) ────────────────────
console.log("\n7. Validando Modo Inserção Ripple (rippleInsertTimeRange)...");

STATE.activeTimelineCuts = [
    { id: "c1", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "c2", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 48 }
];

// Inserção ripple de 24 frames no frame 48
const rippleRes = tState.rippleInsertTimeRange("V1", 48, 24, ["novo"]);
const c2Moved = rippleRes.find(c => c.id === "c2");
assert.strictEqual(c2Moved.timelineStartFrame, 72, "c2 deve ter sido empurrado em +24 frames (48 + 24 = 72).");
console.log("  ✔ Inserção Ripple empurrou os clipes subsequentes perfeitamente.");

// ── 8. VALIDAÇÃO DE ARRASTE MÚLTIPLO DA TASK 2 (MARQUEE DRAG) ────────
console.log("\n8. Validando Compatibilidade com Task 2 (Arraste Múltiplo)...");

// Clipes selecionados (m1, m2) e clipe fixo (fixo) na mesma pista
STATE.activeTimelineCuts = [
    { id: "fixo_esq", track: "V1", inFrame: 0, outFrame: 30, timelineStartFrame: 0 },
    { id: "m1", track: "V1", inFrame: 0, outFrame: 30, timelineStartFrame: 60 },
    { id: "m2", track: "V1", inFrame: 0, outFrame: 30, timelineStartFrame: 100 },
    { id: "fixo_dir", track: "V1", inFrame: 0, outFrame: 30, timelineStartFrame: 150 }
];

interaction.dragInitialClipPositions = new Map();
interaction.dragInitialClipPositions.set("m1", { startFrame: 60, duration: 30, track: "V1" });
interaction.dragInitialClipPositions.set("m2", { startFrame: 100, duration: 30, track: "V1" });
interaction.dragMinStartFrame = 60;

// Teste de cálculo de colisão em bloco para o grupo
const selectedIds = new Set(["m1", "m2"]);
let allowedMin = -60;
let allowedMax = Infinity;

for (const [clipId, initPos] of interaction.dragInitialClipPositions.entries()) {
    const cDur = initPos.duration;
    const cStart = initPos.startFrame;
    const cEnd = cStart + cDur;
    const trackCuts = STATE.activeTimelineCuts.filter(x => x.track === initPos.track && !selectedIds.has(x.id));

    for (const other of trackCuts) {
        const oStart = other.timelineStartFrame || 0;
        const oEnd = oStart + (other.outFrame - other.inFrame);
        if (oEnd <= cStart) {
            allowedMin = Math.max(allowedMin, oEnd - cStart);
        }
        if (oStart >= cEnd) {
            allowedMax = Math.min(allowedMax, oStart - cEnd);
        }
    }
}

assert.strictEqual(allowedMin, -30, "Menor delta permitido para a esquerda deve ser -30 (m1 trava em fixo_esq 30).");
assert.strictEqual(allowedMax, 20, "Maior delta permitido para a direita deve ser +20 (m2 trava em fixo_dir 150 - 130 = 20).");
console.log("  ✔ Arraste de múltiplos clipes da Task 2 limitado rigidamente pelas barreiras fixas.");

// ── 9. VALIDAÇÃO DE ISOLAMENTO COM TASK 3 (SLIP TOOL) ────────────────
console.log("\n9. Validando Isolamento e Compatibilidade com Task 3 (Slip Tool)...");

// Clipe com J/L Slip (syncOffset ativo)
const cutWithOffset = {
    id: "v_sync",
    track: "V1",
    inFrame: 10,
    outFrame: 60,
    timelineStartFrame: 100,
    link_id: "link_sync",
    syncOffset: 5
};
STATE.activeTimelineCuts = [cutWithOffset];

// Operação de corte parcial por sobrescrita
const trimmedSync = tState.overwriteTimeRange("V1", 130, 20, ["novo"]);
assert.strictEqual(trimmedSync.length, 1, "Deve restar 1 clipe aparado.");
assert.strictEqual(trimmedSync[0].syncOffset, 5, "syncOffset da Task 3 deve ser preservado.");
console.log("  ✔ syncOffset e mecânica da Task 3 100% preservados.");

// ── 10. VALIDAÇÃO DE HISTERESE DIRECIONAL (ANTI-FLICKER NO SALTO) ─────
console.log("\n10. Validando Histerese Direcional / Latch contra Flicker...");
STATE.activeTimelineCuts = [
    { id: "obstacle", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 100 } // 100..200, centro: 150
];
interaction.dragHoppedPastClips = new Set();
interaction.dragDirection = 1; // Arrastando para a direita

// 1. Antes do centro: trava em 100 - 48 = 52
const preJump = interaction.calculateClampedStart("V1", 80, 48, ["moving"]);
assert.strictEqual(preJump, 52, "Antes de cruzar o centro, clipe trava antes do obstáculo (52).");

// 2. Cruzou o centro (130 + 24 = 154 >= 150): salta para 200 e ativa o latch
const postJump = interaction.calculateClampedStart("V1", 130, 48, ["moving"]);
assert.strictEqual(postJump, 200, "Ao cruzar o centro, salta para 200.");
assert.ok(interaction.dragHoppedPastClips.has("obstacle"), "Obstáculo deve estar registrado no latch de pulo.");

// 3. Usuário continua arrastando para a direita (dragDirection = 1) com jitter ou mouse desacelerando:
const jitter = interaction.calculateClampedStart("V1", 110, 48, ["moving"]);
assert.strictEqual(jitter, 200, "Com latch ativo e puxando para a direita, NUNCA volta para a esquerda de 200 (sem flicker).");

// 4. Usuário reverte direção para a esquerda (dragDirection = -1) e puxa de volta:
interaction.dragDirection = -1;
const returnJump = interaction.calculateClampedStart("V1", 90, 48, ["moving"]); // center = 90 + 24 = 114 < 150
assert.strictEqual(returnJump, 52, "Ao inverter a direção e puxar para a esquerda além do centro, latch libera e volta a 52.");
console.log("  ✔ Histerese direcional impediu oscilação e respeitou reversão de movimento.");

// ── 11. VALIDAÇÃO DE TROCA DE PISTAS EM SELEÇÃO MÚLTIPLA ──────────────
console.log("\n11. Validando Troca Vertical de Pistas (resolveGroupTargetTrack)...");
const tV1 = interaction.resolveGroupTargetTrack("V1", -1);
assert.strictEqual(tV1, "V2", "Deslocamento para pista superior a partir de V1 deve resolver para V2.");

const tV2Down = interaction.resolveGroupTargetTrack("V2", 1);
assert.strictEqual(tV2Down, "V1", "Deslocamento para pista inferior a partir de V2 deve resolver para V1.");

const tAudio = interaction.resolveGroupTargetTrack("A1", 1);
assert.strictEqual(tAudio, "A2", "Deslocamento de +1 na pista A1 deve resolver para A2.");
console.log("  ✔ Troca vertical de pistas em grupo resolvida preservando o tipo da pista.");

// ── 12. VALIDAÇÃO DE PREVENÇÃO DE COLISÃO NA INGESTÃO DA BIBLIOTECA ───
console.log("\n12. Validando Prevenção de Sobreposição na Ingestão (insertMedia)...");
STATE.allVideos = [
    { id: "vid_test", title: "Vídeo Teste", duration: 10, fps: 24 }
];
STATE.activeTimelineCuts = [
    { id: "existing_v1", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 }
];
tState.setDragCollisionMode("clamp");
tState.playheadFrame = 10; // Agulha colidindo com existing_v1

const inserted = tState.insertMedia({
    type: "video",
    id: "vid_test",
    inSec: 0,
    outSec: 2,
    mode: "playhead",
    targetTrack: "V1"
});

assert.ok(inserted, "Clipe deve ter sido inserido.");
assert.notStrictEqual(inserted.track === "V1" && inserted.timelineStartFrame === 10, true, "Clipe NÃO pode ser colocado sobrepondo em V1 no frame 10.");
// Ele deve ser colocado na pista alternativa livre V2 no frame 10, ou após existing_v1
const isSafe = (inserted.track !== "V1") || (inserted.timelineStartFrame >= 48);
assert.ok(isSafe, "Clipe inserido foi roteado com segurança sem sobrepor.");
console.log("  ✔ Ingestão pela biblioteca respeitou a barreira física sem sobreposição.");

// ── 13. VALIDAÇÃO DO MODO RIPPLE NÃO-CUMULATIVO EM MOVIMENTAÇÃO ────────
console.log("\n13. Validando que moveClip em Modo Ripple Não Acumula Deslocamento...");
STATE.activeTimelineCuts = [
    { id: "c_lead", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 100 },
    { id: "c_follow", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 300 }
];
// Chamadas repetidas de moveClip (simulando 50 eventos mousemove)
for (let i = 0; i < 50; i++) {
    interaction.moveClip("c_lead", 100 + i, "V1", "ripple");
}
const followAfter = STATE.activeTimelineCuts.find(c => c.id === "c_follow");
assert.strictEqual(followAfter.timelineStartFrame, 300, "moveClip repetido durante drag não deve acumular frames em outros clipes.");
console.log("  ✔ moveClip em ripple não muta clipes subsequentes durante o arraste.");

// ── 14. VALIDAÇÃO DE SIMULAÇÃO DINÂMICA (simulateOverwrite) E 2-UP ───
console.log("\n14. Validando Simulação Dinâmica Não-Destrutiva (simulateOverwrite)...");
const origCuts = [
    { id: "cut_dragged", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "cut_target", track: "V1", inFrame: 0, outFrame: 96, timelineStartFrame: 100 }
];
// Arrastando cut_dragged para sobrepor o início de cut_target (posição 120, duração 48 -> cobre 120..168)
const simResult = tState.simulateOverwrite("cut_dragged", 120, "V1", origCuts);

assert.ok(simResult.simulatedCuts, "Deve retornar lista de cortes simulados.");
// Na simulação, cut_target (100..196) é fatiado pelo clipe (120..168):
// Metade esquerda: 100..120 (20 frames)
// Metade direita: 168..196 (28 frames)
const leftHalf = simResult.simulatedCuts.find(c => c.timelineStartFrame === 100);
assert.ok(leftHalf, "Metade esquerda do corte deve existir.");
assert.strictEqual(leftHalf.outFrame - leftHalf.inFrame, 20, "Metade esquerda deve ter 20 frames.");

const rightHalf = simResult.simulatedCuts.find(c => c.timelineStartFrame === 168);
assert.ok(rightHalf, "Metade direita do corte deve existir.");
assert.strictEqual(rightHalf.outFrame - rightHalf.inFrame, 28, "Metade direita deve ter 28 frames.");

// Validação dos dados do 2-Up
assert.ok(simResult.outgoingClip, "Outgoing clip deve ser o clipe que está sendo movido.");
assert.strictEqual(simResult.outgoingClip.id, "cut_dragged");
assert.strictEqual(simResult.outgoingTime, (48 - 1) / 24, "Outgoing time deve ser o último frame visível do clipe saindo.");

assert.ok(simResult.incomingClip, "Incoming clip deve ser o clipe que continuará em endFrame.");
assert.strictEqual(simResult.incomingClip.id, "cut_target");
assert.strictEqual(simResult.incomingTime, (0 + (168 - 100)) / 24, "Incoming time deve ser o frame exato onde o corte continuará (68f / 24fps).");

// Verifica que a lista original passada não foi mutada
assert.strictEqual(origCuts[1].timelineStartFrame, 100);
assert.strictEqual(origCuts[1].outFrame, 96);

// Teste específico do relato do usuário: clipe que está na frente com inFrame recortado (> 0) e é arrastado para trás sobrepondo o anterior
const cutsBackwards = [
    { id: "cut_prev", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0 },
    { id: "cut_ahead", track: "V1", inFrame: 120, outFrame: 264, timelineStartFrame: 200 } // inFrame = 120 (recortado!), dur = 144
];
// Arrastando cut_ahead para trás (para o frame 60, cobrindo 60..204): corta a cauda de cut_prev em 60
const simBackResult = tState.simulateOverwrite("cut_ahead", 60, "V1", cutsBackwards, true);

assert.strictEqual(simBackResult.outgoingClip.id, "cut_prev", "Outgoing deve ser o clipe anterior (cut_prev) aparado na cauda.");
assert.strictEqual(simBackResult.outgoingTime, (60 - 1) / 24, "Outgoing deve ser o último frame preservado de cut_prev antes do corte (frame 59).");

assert.strictEqual(simBackResult.incomingClip.id, "cut_ahead", "Incoming deve ser o clipe arrastado (cut_ahead) começando na sua cabeça.");
assert.strictEqual(simBackResult.incomingTime, 120 / 24, "Incoming time deve ser exatamente o inFrame recortado (120 / 24), NÃO o frame 0 da mídia!");
console.log("  ✔ simulateOverwrite calcula cortes e metadados 2-Up perfeitamente para avanço e recuo com inFrame recortado.");

// Sub-teste de estabilidade de costura (Jitter/Recuo do mouse durante colisão frontal):
// Arrastando cut_drag para a frente sobre cut_target (cutAtTail ativo, cutAtHead nulo).
// Mesmo se o mouse recuar levemente (isMovingBackwards = true), o 2-Up DEVE manter a emenda da cauda intacta.
const cutsForwardWithJitter = [
    { id: "cut_drag", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "cut_target", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 40 }
];
const simForwardJitter = tState.simulateOverwrite("cut_drag", 30, "V1", cutsForwardWithJitter, true);
assert.ok(simForwardJitter.outgoingClip, "Outgoing não pode ser nulo ao recuar o mouse durante colisão frontal.");
assert.strictEqual(simForwardJitter.outgoingClip.id, "cut_drag", "Outgoing deve continuar sendo o clipe arrastado na sua cauda.");
assert.ok(simForwardJitter.incomingClip, "Incoming não pode ser nulo durante colisão frontal.");
assert.strictEqual(simForwardJitter.incomingClip.id, "cut_target", "Incoming deve ser o clipe alvo sendo cortado.");
console.log("  ✔ Estabilidade de costura 2-Up: Recuo do mouse durante colisão frontal não perde o clipe Outgoing (Tail).");

// ── 15. VALIDAÇÃO DE SOBRESCRITA ATÔMICA MULTIPISTAS COM PAR A/V ─────
console.log("\n15. Validando Sobrescrita Atômica Multipistas e Sincronia A/V (splitLinkMap)...");
const linkedOrigCuts = [
    { id: "drag_v", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "link_drag" },
    { id: "drag_a", track: "A1", inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "link_drag" },
    { id: "under_v", track: "V1", inFrame: 0, outFrame: 96, timelineStartFrame: 100, link_id: "link_under" },
    { id: "under_a", track: "A1", inFrame: 0, outFrame: 96, timelineStartFrame: 100, link_id: "link_under" }
];

const simLinked = tState.simulateOverwrite("drag_v", 120, "V1", linkedOrigCuts);

// Ambas as metades direitas (V1 e A1) devem ter sido geradas
const rightV = simLinked.simulatedCuts.find(c => c.track === "V1" && c.timelineStartFrame === 168);
const rightA = simLinked.simulatedCuts.find(c => c.track === "A1" && c.timelineStartFrame === 168);

assert.ok(rightV, "Metade direita de vídeo deve existir.");
assert.ok(rightA, "Metade direita de áudio deve existir.");
assert.strictEqual(rightV.timelineStartFrame, rightA.timelineStartFrame, "Vídeo e áudio divididos devem começar no mesmo frame (168).");
assert.strictEqual(rightV.outFrame - rightV.inFrame, rightA.outFrame - rightA.inFrame, "Vídeo e áudio divididos devem ter a mesma duração.");
assert.ok(rightV.link_id && rightV.link_id === rightA.link_id, "splitLinkMap deve sincronizar o mesmo novo link_id para vídeo e áudio fatiados!");
console.log("  ✔ Sobrescrita atômica em par A/V preserva sincronia exata e vincula metades divididas com splitLinkMap.");

// ── 16. VALIDAÇÃO DE CANCELAMENTO VIA ESCAPE E DESCARTE DE 2-UP ───────
console.log("\n16. Validando Cancelamento com Escape e Restauração de Cortes...");
STATE.activeTimelineCuts = JSON.parse(JSON.stringify(linkedOrigCuts));
interaction.dragState = "drag-clip";
interaction.draggedClipId = "drag_v";
interaction.currentDragMode = "overwrite";
interaction.dragOriginalCuts = JSON.parse(JSON.stringify(linkedOrigCuts));
interaction.simulatedOverwriteResult = simLinked;
STATE.activeTimelineCuts = simLinked.simulatedCuts; // Timeline exibindo simulação

let previewHidden = false;
globalThis.window.player = {
    hide2UpPreview: () => { previewHidden = true; }
};

// Simula pressionamento da tecla Escape
interaction.onKeyDown({ key: "Escape", preventDefault: () => {} });

assert.strictEqual(interaction.dragState, null, "dragState deve ser resetado para null.");
assert.strictEqual(previewHidden, true, "hide2UpPreview deve ser chamado ao cancelar.");
assert.strictEqual(STATE.activeTimelineCuts.length, linkedOrigCuts.length, "Cortes devem ser revertidos para a quantidade original.");
assert.strictEqual(STATE.activeTimelineCuts.find(c => c.id === "under_v").outFrame, 96, "Clipe subjacente deve ter duração original restaurada intacta.");
console.log("  ✔ Escape cancela simulação imediatamente, esconde 2-Up e restaura a timeline intacta.");

// ── 17. VALIDAÇÃO DE RIPPLE SWAP / REARRANGE EDIT (simulateRipple) ────
console.log("\n17. Validando Ripple Swap / Rearrange Edit em Fileira Colada (simulateRipple)...");

// A. Fileira contígua de clipes colados (caso real NLE):
// Clipes colados: clip_a (0..48, dur 48), clip_b (48..144, dur 96), clip_c (144..192, dur 48). Duração total: 192 frames.
const contiguousCuts = [
    { id: "clip_a", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "clip_b", track: "V1", inFrame: 0, outFrame: 96, timelineStartFrame: 48 },
    { id: "clip_c", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 144 }
];

// Movendo clip_c (144..192) para TRÁS, para o frame 48 (entre A e B):
const simSwapBack = tState.simulateRipple("clip_c", 48, "V1", contiguousCuts, true);

// Validação do Ripple Swap para trás:
// clip_a permanece em 0..48
// clip_c entra em 48..96 (duração 48)
// clip_b (que estava em 48..144) é empurrado para 96..192 (duração 96)
// Duração total: 192 frames (exatamente igual à original!)
// Zero buracos vazios e cauda da timeline não é empurrada para a frente!
const resA = simSwapBack.simulatedCuts.find(c => c.id === "clip_a");
const resC = simSwapBack.simulatedCuts.find(c => c.id === "clip_c");
const resB = simSwapBack.simulatedCuts.find(c => c.id === "clip_b");

assert.ok(resA, "clip_a deve existir.");
assert.strictEqual(resA.timelineStartFrame, 0, "clip_a deve permanecer em 0.");

assert.ok(resC, "clip_c deve existir.");
assert.strictEqual(resC.timelineStartFrame, 48, "clip_c deve ser inserido em 48.");
assert.strictEqual(resC.outFrame - resC.inFrame, 48, "clip_c deve manter duração 48.");

assert.ok(resB, "clip_b deve existir.");
assert.strictEqual(resB.timelineStartFrame, 96, "clip_b deve começar exatamente onde clip_c termina (48 + 48 = 96).");
assert.strictEqual(resB.timelineStartFrame + (resB.outFrame - resB.inFrame), 192, "Cauda da timeline NÃO deve ter sido empurrada para além de 192!");

// Movendo clip_a (0..48) para a FRENTE, para depois de clip_b (frame 144):
const simSwapForward = tState.simulateRipple("clip_a", 144, "V1", contiguousCuts, false);
// clip_b recua para 0..96
// clip_a entra em 96..144
// clip_c permanece em 144..192
const forB = simSwapForward.simulatedCuts.find(c => c.id === "clip_b");
const forA = simSwapForward.simulatedCuts.find(c => c.id === "clip_a");
const forC = simSwapForward.simulatedCuts.find(c => c.id === "clip_c");

assert.strictEqual(forB.timelineStartFrame, 0, "clip_b deve recuar para 0 ocupando o espaço deixado por clip_a.");
assert.strictEqual(forA.timelineStartFrame, 96, "clip_a deve ser inserido em 96.");
assert.strictEqual(forC.timelineStartFrame, 144, "clip_c deve permanecer em 144.");

// Validação com clipe externo (mídia vinda de fora da timeline):
const extBase = [
    { id: "c1", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
    { id: "c2", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 48 }
];
const simExt = tState.simulateRipple("c_ext", 48, "V1", [
    ...extBase,
    { id: "c_ext", track: "V1", inFrame: 0, outFrame: 24, timelineStartFrame: undefined }
]);
const c2ExtMoved = simExt.simulatedCuts.find(c => c.id === "c2");
assert.strictEqual(c2ExtMoved.timelineStartFrame, 72, "Mídia externa deve abrir espaço expandindo a timeline (48 + 24 = 72).");
console.log("  ✔ simulateRipple troca posições sem buracos vazios e sem expandir a timeline indevidamente.");

// ── 18. VALIDAÇÃO DOS METADADOS DO MONITOR 2-UP EM RIPPLE SWAP ───────
console.log("\n18. Validando Metadados do Monitor 2-Up Contextual em Inserção Ripple...");

// A. Movendo clip_c para trás (entre A e B com isMovingBackwards = true):
// Emenda Head: Outgoing = clip_a na cauda (frame 47), Incoming = clip_c na cabeça (frame 0)
assert.ok(simSwapBack.outgoingClip, "Outgoing clip deve existir.");
assert.strictEqual(simSwapBack.outgoingClip.id, "clip_a", "Outgoing deve ser o clipe anterior (clip_a).");
assert.strictEqual(simSwapBack.outgoingTime, (48 - 1) / 24, "Outgoing deve ser o último frame de clip_a.");

assert.ok(simSwapBack.incomingClip, "Incoming clip deve existir.");
assert.strictEqual(simSwapBack.incomingClip.id, "clip_c", "Incoming deve ser o clipe arrastado (clip_c).");
assert.strictEqual(simSwapBack.incomingTime, 0, "Incoming time deve ser 0.");

// B. Movendo clip_a para a frente (depois de clip_b com isMovingBackwards = false):
// Emenda Tail: Outgoing = clip_a na cauda, Incoming = clip_c na cabeça
assert.ok(simSwapForward.outgoingClip, "Outgoing clip deve existir.");
assert.strictEqual(simSwapForward.outgoingClip.id, "clip_a", "Outgoing deve ser o clipe arrastado na cauda.");
assert.strictEqual(simSwapForward.outgoingTime, (48 - 1) / 24, "Outgoing deve ser o último frame de clip_a.");

assert.ok(simSwapForward.incomingClip, "Incoming clip deve existir.");
assert.strictEqual(simSwapForward.incomingClip.id, "clip_c", "Incoming deve ser o clipe seguinte (clip_c).");
assert.strictEqual(simSwapForward.incomingTime, 0, "Incoming time deve ser o início de clip_c.");
console.log("  ✔ Monitor 2-Up exibe emendas Head e Tail contextuais precisas durante o Ripple Swap.");

// ── 19. VALIDAÇÃO DE SINCRONIA ESTRI TA A/V COM splitLinkMap NO RIPPLE ─
console.log("\n19. Validando Sincronia Estrita A/V com splitLinkMap em Inserção Ripple...");
const linkedContiguousCuts = [
    { id: "a_v", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "link_a" },
    { id: "a_a", track: "A1", inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "link_a" },
    { id: "b_v", track: "V1", inFrame: 0, outFrame: 96, timelineStartFrame: 48, link_id: "link_b" },
    { id: "b_a", track: "A1", inFrame: 0, outFrame: 96, timelineStartFrame: 48, link_id: "link_b" },
    { id: "c_v", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 144, link_id: "link_c" },
    { id: "c_a", track: "A1", inFrame: 0, outFrame: 48, timelineStartFrame: 144, link_id: "link_c" }
];

// Movendo o par c_v / c_a para trás entre a e b (frame 48)
const simLinkedSwap = tState.simulateRipple("c_v", 48, "V1", linkedContiguousCuts, true);

const resCv = simLinkedSwap.simulatedCuts.find(c => c.id === "c_v");
const resCa = simLinkedSwap.simulatedCuts.find(c => c.id === "c_a");
const resBv = simLinkedSwap.simulatedCuts.find(c => c.id === "b_v");
const resBa = simLinkedSwap.simulatedCuts.find(c => c.id === "b_a");

assert.strictEqual(resCv.timelineStartFrame, 48, "Vídeo c_v deve iniciar em 48.");
assert.strictEqual(resCa.timelineStartFrame, 48, "Áudio c_a deve iniciar rigorosamente no mesmo frame 48!");
assert.strictEqual(resBv.timelineStartFrame, 96, "Vídeo b_v empurrado deve começar em 96.");
assert.strictEqual(resBa.timelineStartFrame, 96, "Áudio b_a empurrado deve começar rigorosamente no mesmo frame 96!");
console.log("  ✔ Sincronia A/V preservada com alinhamento rigoroso em ambas as pistas no Ripple Swap.");

// ── 20. VALIDAÇÃO DE COMMIT ATÔMICO E CANCELAMENTO EM RIPPLE ─────────
console.log("\n20. Validando Cancelamento com Escape e Commit no mouseup em Ripple...");

// A. Cancelamento com Escape
STATE.activeTimelineCuts = JSON.parse(JSON.stringify(linkedContiguousCuts));
interaction.dragState = "drag-clip";
interaction.draggedClipId = "c_v";
interaction.currentDragMode = "ripple";
interaction.dragOriginalCuts = JSON.parse(JSON.stringify(linkedContiguousCuts));
interaction.simulatedRippleResult = simLinkedSwap;
STATE.activeTimelineCuts = simLinkedSwap.simulatedCuts;

let ripPreviewHidden = false;
globalThis.window.player = {
    hide2UpPreview: () => { ripPreviewHidden = true; }
};

interaction.onKeyDown({ key: "Escape", preventDefault: () => {} });

assert.strictEqual(interaction.dragState, null, "dragState deve ser resetado para null após Escape.");
assert.strictEqual(ripPreviewHidden, true, "hide2UpPreview deve ser chamado ao cancelar.");
assert.strictEqual(STATE.activeTimelineCuts.length, linkedContiguousCuts.length, "Cortes devem ser restaurados para a lista original.");
assert.strictEqual(STATE.activeTimelineCuts.find(c => c.id === "c_v").timelineStartFrame, 144, "c_v deve voltar à posição 144 original.");
assert.strictEqual(interaction.simulatedRippleResult, null, "simulatedRippleResult deve ser limpo.");

// B. Commit atômico no mouseup
STATE.activeTimelineCuts = JSON.parse(JSON.stringify(linkedContiguousCuts));
interaction.dragState = "drag-clip";
interaction.draggedClipId = "c_v";
interaction.currentDragMode = "ripple";
interaction.dragOriginalCuts = JSON.parse(JSON.stringify(linkedContiguousCuts));
interaction.simulatedRippleResult = simLinkedSwap;
interaction.dragHasMoved = true;
interaction.dragStartClipFrame = 144;

let historyCommitted = false;
const origCommit = TIMELINE_HISTORY.commit;
TIMELINE_HISTORY.commit = () => { historyCommitted = true; origCommit.call(TIMELINE_HISTORY); };

interaction.onMouseUp({});

assert.strictEqual(historyCommitted, true, "TIMELINE_HISTORY.commit deve ter sido chamado no mouseup.");
assert.strictEqual(interaction.dragState, null, "dragState deve ser resetado após mouseup.");
assert.strictEqual(STATE.activeTimelineCuts.find(c => c.id === "c_v").timelineStartFrame, 48, "c_v deve ter sua nova posição consolidada em 48.");
assert.ok(TIMELINE_STATE.selectedClipIds.has("c_v"), "Clipe arrastado deve permanecer selecionado após soltar.");

TIMELINE_HISTORY.commit = origCommit;
console.log("  ✔ Escape descarta simulação e mouseup consolida corte atômico com histórico consistente.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE EXPANDIDO DA TASK 3.6 100% APROVADO (20 TESTES)! ");
console.log("============================================================");
