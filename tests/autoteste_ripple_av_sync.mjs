// Autoteste de Integridade A/V no Ripple Delete (Prevenção de Dessincronização)
// Executa via Node.js: node tests/autoteste_ripple_av_sync.mjs

import assert from "node:assert/strict";

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
    getElementById: (id) => null,
    body: { appendChild: () => {}, querySelector: () => null }
};

const { CapiauTimelineState } = await import("../src/ui/js/timelineState.js");
const { STATE } = await import("../src/ui/js/state.js");

console.log("=== INICIANDO TESTES DE INTEGRIDADE A/V NO RIPPLE DELETE ===");

const TIMELINE_STATE = new CapiauTimelineState();

// Mock tracks
TIMELINE_STATE.tracks = [
    { id: "V1", name: "Vídeo 1", kind: "video", locked: false, syncLocked: true },
    { id: "A1", name: "Áudio 1", kind: "audio", locked: false, syncLocked: true },
    { id: "V2", name: "Vídeo 2", kind: "video", locked: false, syncLocked: true },
    { id: "A2", name: "Áudio 2", kind: "audio", locked: false, syncLocked: true }
];
TIMELINE_STATE.fps = 24;

// ── TESTE 1: CENÁRIO DO PRINT (BLOQUEIO TOTAL POR FALTA DE ESPAÇO NO ÁUDIO VINCULADO) ──
console.log("\n1. Validando cenário do print: gap no vídeo mas áudio colado sem espaço...");
// c1_v e c1_a terminam em 1000
// c2_v começa em 1072 (gap de 72 frames em V1)
// c2_a começa em 1000 (0 frames de espaço em A1, já colado no c1_a!)
// c2_v e c2_a são vinculados com link_id = "link_2"
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c2_v", track: "V1", inFrame: 1000, outFrame: 1500, timelineStartFrame: 1072, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 928, outFrame: 1428, timelineStartFrame: 1000, link_id: "link_2" }
];

const res1 = TIMELINE_STATE.rippleDeleteGap("V1", 1000, 72);

const c2_v1 = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
const c2_a1 = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.equal(res1.blocked, true, "Operação deve ser reportada como bloqueada.");
assert.equal(res1.actualDelta, 0, "Nenhum frame deve ser movido quando o áudio tem 0 espaço.");
assert.equal(c2_v1.timelineStartFrame, 1072, "Vídeo c2_v NÃO deve avançar sozinho se o áudio não pode mover.");
assert.equal(c2_a1.timelineStartFrame, 1000, "Áudio c2_a permaneceu estático em 1000.");
assert.equal(
    (c2_v1.timelineStartFrame - c2_v1.inFrame),
    (c2_a1.timelineStartFrame - c2_a1.inFrame),
    "Sincronia exata entre c2_v e c2_a DEVE ser 100% mantida sem dessincronização."
);
console.log("  ✔ Teste 1 passou: Ripple Delete bloqueado com sucesso sem mover vídeo separadamente.");

// ── TESTE 2: AVANÇO PARCIAL COM SINCRONISMO EXATO ──
console.log("\n2. Validando avanço parcial quando o áudio possui espaço menor que o gap de vídeo...");
// Gap em V1 de 72 frames (1000 a 1072).
// Áudio c2_a começa em 1024 (espaço livre = 24 frames antes de bater no c1_a que termina em 1000).
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c2_v", track: "V1", inFrame: 1000, outFrame: 1500, timelineStartFrame: 1072, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 952, outFrame: 1452, timelineStartFrame: 1024, link_id: "link_2" }
];

const res2 = TIMELINE_STATE.rippleDeleteGap("V1", 1000, 72);

const c2_v2 = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
const c2_a2 = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.equal(res2.blocked, false, "Operação não foi bloqueada (houve avanço parcial).");
assert.equal(res2.actualDelta, 24, "Deslocamento efetivo deve ser rigorosamente 24 frames.");
assert.equal(res2.fullyClosed, false, "Espaço foi fechado apenas parcialmente.");
assert.equal(c2_v2.timelineStartFrame, 1048, "Vídeo avançou 24 frames (1072 - 24 = 1048).");
assert.equal(c2_a2.timelineStartFrame, 1000, "Áudio avançou 24 frames (1024 - 24 = 1000), colando perfeitamente sem invadir.");
assert.equal(
    (c2_v2.timelineStartFrame - c2_v2.inFrame),
    (c2_a2.timelineStartFrame - c2_a2.inFrame),
    "Sincronia A/V mantida com perfeição durante avanço parcial."
);
console.log("  ✔ Teste 2 passou: Ambos os clipes vinculados moveram 24 frames juntos preservando sincronia.");

// ── TESTE 3: AVANÇO TOTAL (ESPAÇO SUFICIENTE EM AMBAS AS PISTAS) ──
console.log("\n3. Validando avanço total quando ambas as pistas possuem espaço suficiente...");
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 1000, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c2_v", track: "V1", inFrame: 1000, outFrame: 1500, timelineStartFrame: 1072, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 1028, outFrame: 1528, timelineStartFrame: 1100, link_id: "link_2" }
];

const res3 = TIMELINE_STATE.rippleDeleteGap("V1", 1000, 72);

const c2_v3 = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
const c2_a3 = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.equal(res3.blocked, false, "Operação não bloqueada.");
assert.equal(res3.actualDelta, 72, "Deslocamento total de 72 frames realizado.");
assert.equal(res3.fullyClosed, true, "Espaço foi totalmente fechado.");
assert.equal(c2_v3.timelineStartFrame, 1000, "Vídeo fechou o vão completamente (1072 - 72 = 1000).");
assert.equal(c2_a3.timelineStartFrame, 1028, "Áudio recuou 72 frames em perfeita harmonia (1100 - 72 = 1028).");
assert.equal(
    (c2_v3.timelineStartFrame - c2_v3.inFrame),
    (c2_a3.timelineStartFrame - c2_a3.inFrame),
    "Sincronia A/V mantida em avanço total."
);
console.log("  ✔ Teste 3 passou: Espaço totalmente fechado com par A/V avançando em uníssono.");

// ── TESTE 4: RIPPLE DELETE DE CLIPE COM J-CUT ──
console.log("\n4. Validando rippleDeleteClip com parceiro A/V e clipes subsequentes com J-cut...");
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 400, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 400, timelineStartFrame: 0, link_id: "link_1" },
    // c2 a ser deletado com ripple (duração 200f)
    { id: "c2_v", track: "V1", inFrame: 400, outFrame: 600, timelineStartFrame: 400, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 400, outFrame: 600, timelineStartFrame: 400, link_id: "link_2" },
    // c3 a jusante (vídeo em 600, áudio em 600)
    { id: "c3_v", track: "V1", inFrame: 600, outFrame: 1000, timelineStartFrame: 600, link_id: "link_3" },
    { id: "c3_a", track: "A1", inFrame: 600, outFrame: 1000, timelineStartFrame: 600, link_id: "link_3" }
];

const res4 = TIMELINE_STATE.rippleDeleteClip("c2_v");

const c3_v4 = STATE.activeTimelineCuts.find(c => c.id === "c3_v");
const c3_a4 = STATE.activeTimelineCuts.find(c => c.id === "c3_a");

assert.equal(res4, true, "rippleDeleteClip executou com sucesso.");
assert.equal(STATE.activeTimelineCuts.some(c => c.id === "c2_v"), false, "c2_v foi excluído.");
assert.equal(STATE.activeTimelineCuts.some(c => c.id === "c2_a"), false, "c2_a parceiro foi excluído.");
assert.equal(c3_v4.timelineStartFrame, 400, "c3_v avançou 200 frames para 400.");
assert.equal(c3_a4.timelineStartFrame, 400, "c3_a avançou 200 frames para 400.");
assert.equal(
    (c3_v4.timelineStartFrame - c3_v4.inFrame),
    (c3_a4.timelineStartFrame - c3_a4.inFrame),
    "Sincronia A/V mantida após exclusão de clipe."
);
console.log("  ✔ Teste 4 passou: Exclusão de clipe com Ripple manteve sincronia exata dos subsequentes.");

// ── TESTE 5: MÚLTIPLOS CLIPES A JUSANTE COM J-CUT ──
console.log("\n5. Validando múltiplos clipes a jusante onde o áudio possui J-cut...");
STATE.activeTimelineCuts = [
    { id: "c1_v", track: "V1", inFrame: 0, outFrame: 500, timelineStartFrame: 0, link_id: "link_1" },
    { id: "c1_a", track: "A1", inFrame: 0, outFrame: 500, timelineStartFrame: 0, link_id: "link_1" },
    // Gap em V1 de 500 a 600 (100 frames).
    // c2 a jusante com J-cut: c2_a começa em 550 (in 50), c2_v começa em 600 (in 100) -> syncOffset 0
    // Espaço em A1 = 550 - 500 = 50 frames. Espaço em V1 = 600 - 500 = 100 frames.
    { id: "c2_v", track: "V1", inFrame: 100, outFrame: 300, timelineStartFrame: 600, link_id: "link_2" },
    { id: "c2_a", track: "A1", inFrame: 50, outFrame: 250, timelineStartFrame: 550, link_id: "link_2" },
    // c3 logo após c2
    { id: "c3_v", track: "V1", inFrame: 0, outFrame: 200, timelineStartFrame: 800, link_id: "link_3" },
    { id: "c3_a", track: "A1", inFrame: 0, outFrame: 200, timelineStartFrame: 800, link_id: "link_3" }
];

const res5 = TIMELINE_STATE.rippleDeleteGap("V1", 500, 100);

const c2_v5 = STATE.activeTimelineCuts.find(c => c.id === "c2_v");
const c2_a5 = STATE.activeTimelineCuts.find(c => c.id === "c2_a");
const c3_v5 = STATE.activeTimelineCuts.find(c => c.id === "c3_v");
const c3_a5 = STATE.activeTimelineCuts.find(c => c.id === "c3_a");

assert.equal(res5.actualDelta, 50, "Limitado em 50 frames pelo áudio c2_a.");
assert.equal(c2_v5.timelineStartFrame, 550, "c2_v avançou 50 frames (600 - 50 = 550).");
assert.equal(c2_a5.timelineStartFrame, 500, "c2_a avançou 50 frames (550 - 50 = 500), encostando perfeitamente em c1_a.");
assert.equal(c3_v5.timelineStartFrame, 750, "c3_v avançou os mesmos 50 frames.");
assert.equal(c3_a5.timelineStartFrame, 750, "c3_a avançou os mesmos 50 frames.");
assert.equal(
    (c2_v5.timelineStartFrame - c2_v5.inFrame),
    (c2_a5.timelineStartFrame - c2_a5.inFrame),
    "Sincronia de c2 mantida."
);
assert.equal(
    (c3_v5.timelineStartFrame - c3_v5.inFrame),
    (c3_a5.timelineStartFrame - c3_a5.inFrame),
    "Sincronia de c3 mantida."
);
console.log("  ✔ Teste 5 passou: Múltiplos clipes com J-cut avançaram de forma sincronizada e sem colisões.");

console.log("\n=======================================================");
console.log("🎉 TODOS OS 5 TESTES DE INTEGRIDADE A/V PASSARAM COM SUCESSO!");
console.log("=======================================================\n");
