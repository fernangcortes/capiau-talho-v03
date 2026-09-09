// Autoteste de Suporte a Undo/Redo (Ctrl+Z) para Marcadores da Timeline
// Execução: node tests/autoteste_marker_undo_redo.mjs

import assert from "node:assert/strict";

// Polyfill de ambiente para Node.js ESM
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
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
    body: { appendChild() {} },
    addEventListener: () => {},
    removeEventListener: () => {}
};

console.log("▶ Iniciando autoteste de Undo/Redo (Ctrl+Z) para Marcadores da Timeline...");

const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

// Limpar estado inicial
TIMELINE_STATE.markers = [];
TIMELINE_STATE.selectedMarkerIds.clear();
TIMELINE_STATE.playheadFrame = 0;
TIMELINE_HISTORY.clear();

// ── 1. Adicionar Marcador e Desfazer com Undo (Ctrl+Z) ──
console.log("\n1. Testando adição de marcador e reversão com TIMELINE_HISTORY.undo()...");

let markersChangedEvents = 0;
STATE.on("timelineMarkersChanged", () => markersChangedEvents++);

const m1 = TIMELINE_STATE.addMarker({ frame: 50, label: "Marcador Teste 1", color: "#06b6d4" });
assert.ok(m1, "Marcador 1 deve ter sido retornado");
assert.equal(TIMELINE_STATE.markers.length, 1, "Deve existir 1 marcador na timeline");
assert.equal(TIMELINE_STATE.markers[0].label, "Marcador Teste 1");
assert.equal(TIMELINE_STATE.markers[0].frame, 50);
assert.equal(TIMELINE_HISTORY.undoStack.length, 1, "Histórico deve conter 1 snapshot após adicionar marcador");

// Desfazer (Ctrl+Z)
const undoSuccess1 = TIMELINE_HISTORY.undo();
assert.ok(undoSuccess1, "TIMELINE_HISTORY.undo() deve retornar true");
assert.equal(TIMELINE_STATE.markers.length, 0, "Marcador deve ter sido removido após Ctrl+Z");
assert.equal(TIMELINE_STATE.selectedMarkerIds.size, 0, "Seleção de marcador deve ter sido limpa");
assert.equal(TIMELINE_HISTORY.redoStack.length, 1, "Redo stack deve conter 1 snapshot");
console.log("  ✔ Adição de marcador desfeita com sucesso via Undo (Ctrl+Z).");

// Refazer (Ctrl+Y / Ctrl+Shift+Z)
const redoSuccess1 = TIMELINE_HISTORY.redo();
assert.ok(redoSuccess1, "TIMELINE_HISTORY.redo() deve retornar true");
assert.equal(TIMELINE_STATE.markers.length, 1, "Marcador deve retornar após Redo");
assert.equal(TIMELINE_STATE.markers[0].id, m1.id, "ID do marcador restaurado deve coincidir");
assert.equal(TIMELINE_STATE.markers[0].label, "Marcador Teste 1");
assert.equal(TIMELINE_STATE.markers[0].frame, 50);
console.log("  ✔ Marcador refatorado com sucesso via Redo.");

// ── 2. Edição de Marcador e Reversão (Ctrl+Z) ──
console.log("\n2. Testando atualização/edição de propriedades do marcador e Undo...");

TIMELINE_STATE.updateMarker(m1.id, { label: "Capítulo 1 Editado", color: "#ef4444" });
assert.equal(TIMELINE_STATE.markers[0].label, "Capítulo 1 Editado");
assert.equal(TIMELINE_STATE.markers[0].color, "#ef4444");

// Desfazer edição
TIMELINE_HISTORY.undo();
assert.equal(TIMELINE_STATE.markers[0].label, "Marcador Teste 1", "Label deve voltar ao original após Ctrl+Z");
assert.equal(TIMELINE_STATE.markers[0].color, "#06b6d4", "Cor deve voltar ao original após Ctrl+Z");
console.log("  ✔ Edição de marcador desfeita com sucesso via Ctrl+Z.");

// Refazer edição
TIMELINE_HISTORY.redo();
assert.equal(TIMELINE_STATE.markers[0].label, "Capítulo 1 Editado", "Label deve retornar à editada após Redo");
assert.equal(TIMELINE_STATE.markers[0].color, "#ef4444", "Cor deve retornar à editada após Redo");
console.log("  ✔ Edição de marcador refeita com sucesso via Redo.");

// ── 3. Remoção de Marcador e Reversão (Ctrl+Z) ──
console.log("\n3. Testando exclusão de marcador e restauração via Undo...");

const removed = TIMELINE_STATE.removeMarker(m1.id);
assert.ok(removed, "removeMarker deve retornar o marcador removido");
assert.equal(TIMELINE_STATE.markers.length, 0, "Timeline deve ficar vazia");

TIMELINE_HISTORY.undo();
assert.equal(TIMELINE_STATE.markers.length, 1, "Marcador deve ser restaurado após Undo de exclusão");
assert.equal(TIMELINE_STATE.markers[0].id, m1.id);
console.log("  ✔ Exclusão de marcador restaurada com sucesso via Ctrl+Z.");

// ── 4. Exclusão de Múltiplos Marcadores Selecionados (Delete em lote) ──
console.log("\n4. Testando exclusão em lote de marcadores selecionados e Undo...");

const m2 = TIMELINE_STATE.addMarker({ frame: 120, label: "Marcador 2" });
const m3 = TIMELINE_STATE.addMarker({ frame: 200, label: "Marcador 3" });
assert.equal(TIMELINE_STATE.markers.length, 3);

TIMELINE_STATE.selectMarker(m1.id, false);
TIMELINE_STATE.selectMarker(m2.id, true);
assert.equal(TIMELINE_STATE.selectedMarkerIds.size, 2);

const deletedCount = TIMELINE_STATE.removeSelectedMarkers();
assert.equal(deletedCount, 2, "2 marcadores devem ter sido excluídos");
assert.equal(TIMELINE_STATE.markers.length, 1, "Apenas 1 marcador (m3) deve restar");
assert.equal(TIMELINE_STATE.markers[0].id, m3.id);

TIMELINE_HISTORY.undo();
assert.equal(TIMELINE_STATE.markers.length, 3, "Todos os 3 marcadores devem ser restaurados após Ctrl+Z");
assert.equal(TIMELINE_STATE.selectedMarkerIds.size, 2, "A seleção de 2 marcadores deve ser restaurada");
console.log("  ✔ Exclusão em lote e restauração de seleção validadas com sucesso.");

// ── 5. Arraste de Marcador na Régua (Transação Atômica begin/commit) ──
console.log("\n5. Testando arraste contínuo de marcador com begin/commit...");

const initialUndoLen = TIMELINE_HISTORY.undoStack.length;

// Simula mousedown (begin)
TIMELINE_HISTORY.begin();

// Simula múltiplos mousemove chamando updateMarker
TIMELINE_STATE.updateMarker(m3.id, { frame: 210 });
TIMELINE_STATE.updateMarker(m3.id, { frame: 230 });
TIMELINE_STATE.updateMarker(m3.id, { frame: 260 });

// Simula mouseup (commit)
TIMELINE_HISTORY.commit();

assert.equal(TIMELINE_HISTORY.undoStack.length, initialUndoLen + 1, "Arraste contínuo deve gerar exatamente 1 snapshot no histórico");
assert.equal(TIMELINE_STATE.getMarker(m3.id).frame, 260);

// Desfazer arraste
TIMELINE_HISTORY.undo();
assert.equal(TIMELINE_STATE.getMarker(m3.id).frame, 200, "Frame deve retornar a 200 após Ctrl+Z");
console.log("  ✔ Arraste contínuo de marcador gerou transação atômica única e reverteu perfeitamente.");

console.log("\n============================================================");
console.log("🎉 TODOS OS 5 TESTES DE UNDO/REDO DE MARCADORES APROVADOS!");
console.log("============================================================\n");
