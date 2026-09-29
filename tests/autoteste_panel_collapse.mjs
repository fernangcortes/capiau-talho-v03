// ======================================================================
// Autoteste: Recolher painéis em pilha e janelas (seta, divisores, estado salvo)
// Execução: node tests/autoteste_panel_collapse.mjs
// ======================================================================

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pc = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "panelCollapse.js")).href);
const { edgeInLine, collapseButtonFor, visibleSplitters, loadCollapsed, saveCollapsed, COLLAPSED_STORAGE_KEY } = pc;

console.log("=== INICIANDO AUTOTESTE: RECOLHER PAINÉIS ===\n");

// 1. Seta aponta para onde o painel vai: de cima para cima, de baixo para baixo, lado a lado esquerda/direita
assert.equal(edgeInLine("column", 0, 2), "up");
assert.equal(edgeInLine("column", 1, 2), "down");
assert.equal(edgeInLine("row", 0, 2), "left");
assert.equal(edgeInLine("row", 1, 2), "right");
assert.deepEqual([0, 1, 2].map(i => edgeInLine("column", i, 3)), ["up", "up", "down"], "pilha de 3: só o último desce");
assert.deepEqual([0, 1, 2, 3].map(i => edgeInLine("row", i, 4)), ["left", "left", "right", "right"]);
assert.equal(edgeInLine("row", 0, 1), "left", "sozinho: recolhe para a esquerda");
console.log("✔ 1 passou: direção da seta pela posição.");

// 2. Botão: ícone e dica
assert.deepEqual(collapseButtonFor("up"), { html: '<i class="fa-solid fa-chevron-up"></i>', tooltip: "Recolher Painel (Cima)" });
assert.equal(collapseButtonFor("down").tooltip, "Recolher Painel (Baixo)");
assert.equal(collapseButtonFor("qualquer").tooltip, "Recolher Painel (Esquerda)");
console.log("✔ 2 passou: ícone e dica da seta.");

// 3. Divisores só entre dois visíveis; o que fica é o que encosta no visível seguinte
const S = "splitter";
assert.deepEqual(visibleSplitters([true, S, true]), [null, true, null]);
assert.deepEqual(visibleSplitters([false, S, true]), [null, false, null], "de cima recolhido: sem divisor");
assert.deepEqual(visibleSplitters([true, S, false]), [null, false, null], "de baixo recolhido: sem divisor");
assert.deepEqual(visibleSplitters([true, S, false, S, true]), [null, false, null, true, null], "meio recolhido: fica o divisor do de baixo");
assert.deepEqual(visibleSplitters([false, S, true, S, true]), [null, false, null, true, null]);
assert.deepEqual(visibleSplitters([false, S, false, S, false]), [null, false, null, false, null], "todos recolhidos");
console.log("✔ 3 passou: divisores entre painéis visíveis.");

// 4. Estado salvo (reabrir o Talho mantém)
const mem = new Map();
const storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
assert.equal(loadCollapsed(storage).size, 0);
saveCollapsed(storage, ["inspector-panel", "sidebar-right", "timeline-panel"]);
assert.deepEqual(JSON.parse(mem.get(COLLAPSED_STORAGE_KEY)), ["inspector-panel", "sidebar-right"], "só painéis com recolher deste controle");
assert.deepEqual([...loadCollapsed(storage)], ["inspector-panel", "sidebar-right"]);
mem.set(COLLAPSED_STORAGE_KEY, "{quebrado");
assert.equal(loadCollapsed(storage).size, 0, "salvo corrompido não quebra a abertura");
console.log("✔ 4 passou: estado salvo e lido.");

console.log("\n=== AUTOTESTE RECOLHER PAINÉIS: OK ===");
