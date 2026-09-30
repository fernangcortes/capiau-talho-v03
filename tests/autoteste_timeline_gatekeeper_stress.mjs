// ============================================================================
// Autoteste Automatizado: Stress Test Adversarial do Timeline Safety Gatekeeper
// Execução: node tests/autoteste_timeline_gatekeeper_stress.mjs
//
// Challenger: challenger_stress_2
// Valida:
// 1. Imutabilidade estrita de STATE.activeTimelineCuts enquanto propostas residem em ghostTrack
// 2. Bloqueio e descarte limpo de mutações destrutivas massivas (bulk deletions)
// 3. Resiliência do gatekeeper a propostas corrompidas ou malformadas
// 4. Integridade relacional e de histórico de undo/redo após descarte e aceite
// ============================================================================

import assert from "node:assert/strict";

// ── 0. Polyfills de Ambiente para Execução Node.js ESM ─────────────────────────
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

const _storageData = {};
globalThis.localStorage = {
    getItem(k) { return _storageData[k] !== undefined ? _storageData[k] : null; },
    setItem(k, v) { _storageData[k] = String(v); },
    removeItem(k) { delete _storageData[k]; },
    clear() { Object.keys(_storageData).forEach(k => delete _storageData[k]); }
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
        tagName: tag,
        style: {},
        classList: {
            add() {},
            remove() {},
            contains: () => false
        },
        appendChild() {},
        setAttribute() {},
        getAttribute: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    }),
    body: { appendChild() {} },
    addEventListener: () => {},
    removeEventListener: () => {}
};

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("▶ INICIANDO ADVERSARIAL STRESS TEST: TIMELINE SAFETY GATEKEEPER");
console.log("════════════════════════════════════════════════════════════════════════════\n");

const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

TIMELINE_STATE.fps = 24;

// ── Teste 1: Imutabilidade Estrita de activeTimelineCuts sob Propostas Destrutivas ─
console.log("── 1. Imutabilidade de activeTimelineCuts sob Propostas Destrutivas em GhostTrack ──");

const baseCuts = [
    { id: "cut_v1_001", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 240, in: 0.0, out: 10.0, video_id: 1, link_id: "link_001" },
    { id: "cut_a1_001", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 240, in: 0.0, out: 10.0, video_id: 1, link_id: "link_001" },
    { id: "cut_v1_002", track: "V1", timelineStartFrame: 240, inFrame: 0, outFrame: 120, in: 0.0, out: 5.0, video_id: 2, link_id: "link_002" },
    { id: "cut_a1_002", track: "A1", timelineStartFrame: 240, inFrame: 0, outFrame: 120, in: 0.0, out: 5.0, video_id: 2, link_id: "link_002" }
];

STATE.activeTimelineCuts = JSON.parse(JSON.stringify(baseCuts));
TIMELINE_STATE.ghostTrack = [];

const snapshotInitial = JSON.stringify(STATE.activeTimelineCuts);

// Proposta de destruição massiva gerada por agente malicioso ou alucinação
const destructiveProposals = [
    { action: "DELETE", track: "V1", targetClipId: "cut_v1_001" },
    { action: "DELETE", track: "V1", targetClipId: "cut_v1_002" },
    { action: "DELETE", track: "A1", targetClipId: "cut_a1_001" },
    { action: "DELETE", track: "A1", targetClipId: "cut_a1_002" },
    { action: "DELETE", track: "V1", targetClipId: "cut_inexistente_999" }
];

TIMELINE_STATE.ghostTrack = [...destructiveProposals];

// Verifica que activeTimelineCuts permanece 100% INTACTO enquanto proposta está no ghostTrack
assert.equal(
    JSON.stringify(STATE.activeTimelineCuts),
    snapshotInitial,
    "activeTimelineCuts DEVE permanecer intacto antes da confirmação do usuário!"
);

const diffSummary = TIMELINE_STATE.getTimelineDiffSummary();
assert.equal(diffSummary.total, 5, "Diff summary deve contabilizar 5 propostas");
assert.equal(diffSummary.deletions, 5, "Todas as 5 devem ser contabilizadas como deleções");
console.log("  ✔ activeTimelineCuts permaneceu 100% inalterado com propostas destrutivas no ghostTrack.");

// ── Teste 2: Rejeição [Descartar] Limpa GhostTrack e Garante Zero Alteração ────────
console.log("\n── 2. Descarte de Proposta Destrutiva (rejectAllGhostSuggestions) ──");

const rejectResult = TIMELINE_STATE.rejectAllGhostSuggestions();
assert.equal(rejectResult.rejectedCount, 5, "Deve confirmar rejeição de 5 sugestões");
assert.equal(TIMELINE_STATE.ghostTrack.length, 0, "ghostTrack deve estar completamente vazia");
assert.equal(
    JSON.stringify(STATE.activeTimelineCuts),
    snapshotInitial,
    "activeTimelineCuts DEVE permanecer estritamente inalterado após rejeição!"
);
console.log("  ✔ Rejeição em lote descartou as propostas destrutivas sem mutar os clipes ativos.");

// ── Teste 3: Resiliência a Propostas Corrompidas / Malformadas em GhostTrack ──────
console.log("\n── 3. Resiliência do Gatekeeper a Propostas Corrompidas ──");

const corruptProposals = [
    // REPLACE sem targetClipId
    { action: "REPLACE", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 50, video_id: 99 },
    // DELETE com targetClipId inexistente
    { action: "DELETE", track: "V1", targetClipId: "id_inexistente_xyz" },
    // Ação desconhecida / nula
    { action: "CORRUPT_ACTION", track: "V1", timelineStartFrame: 50 },
    // INSERT sem frames válidos
    { action: "INSERT", track: "V2", timelineStartFrame: null, inFrame: null, outFrame: null, video_id: 101 }
];

TIMELINE_STATE.ghostTrack = [...corruptProposals];

// Rejeitar proposta corrompida deve funcionar sem lançar exceção
assert.doesNotThrow(() => {
    TIMELINE_STATE.rejectAllGhostSuggestions();
}, "Rejeitar propostas corrompidas não deve falhar");

assert.equal(
    JSON.stringify(STATE.activeTimelineCuts),
    snapshotInitial,
    "activeTimelineCuts permaneceu intacto após rejeição de itens corrompidos"
);
console.log("  ✔ Gatekeeper manipulou e descartou com segurança propostas corrompidas.");

// ── Teste 4: Aceite Seguro de Modificações com Undo/Redo ──────────────────────────
console.log("\n── 4. Aceite de Inserção Legítima com Verificação de Histórico Undo/Redo ──");

const validProposal = [
    {
        action: "INSERT",
        track: "V1",
        audioTrackId: "A1",
        timelineStartFrame: 360,
        inFrame: 0,
        outFrame: 72,
        in: 0.0,
        out: 3.0,
        video_id: 3,
        link_id: "link_003"
    }
];

TIMELINE_STATE.ghostTrack = [...validProposal];
const acceptResult = TIMELINE_STATE.acceptAllGhostSuggestions();

assert.equal(acceptResult.acceptedCount, 1, "Deve aceitar 1 sugestão válida");
assert.equal(TIMELINE_STATE.ghostTrack.length, 0, "ghostTrack deve ser limpa após aplicação");
assert.ok(STATE.activeTimelineCuts.length > baseCuts.length, "Novos cortes devem ter sido incorporados");

// Teste de Undo do aceite
const undoSuccess = TIMELINE_HISTORY.undo();
assert.ok(undoSuccess, "Undo da operação de aceite deve ter sucesso");
assert.equal(STATE.activeTimelineCuts.length, baseCuts.length, "Undo deve restaurar o número exato de cortes originais");

// Teste de Redo
const redoSuccess = TIMELINE_HISTORY.redo();
assert.ok(redoSuccess, "Redo deve reaplicar a alteração com sucesso");
assert.ok(STATE.activeTimelineCuts.length > baseCuts.length, "Redo deve reincorporar os cortes");

// Reverte para o estado limpo
TIMELINE_HISTORY.undo();
assert.equal(STATE.activeTimelineCuts.length, baseCuts.length);
console.log("  ✔ Ciclo completo de aceite, undo e redo validado com sucesso.");

console.log("\n════════════════════════════════════════════════════════════════════════════");
console.log("✔ TODOS OS TESTES DE STRESS DO TIMELINE SAFETY GATEKEEPER PASSARAM COM SUCESSO!");
console.log("════════════════════════════════════════════════════════════════════════════\n");
