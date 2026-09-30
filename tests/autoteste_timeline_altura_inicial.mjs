// ======================================================================
// Autoteste: altura inicial da timeline proporcional à tela
// Execução: node tests/autoteste_timeline_altura_inicial.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
globalThis.window = globalThis;
globalThis.BroadcastChannel = class { postMessage() {} addEventListener() {} removeEventListener() {} };

const { initialTimelineHeight } = await import("../src/ui/js/workspaceManager.js");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("=== INICIANDO AUTOTESTE: ALTURA INICIAL DA TIMELINE ===\n");

{
    // 36% da altura útil (tela menos o cabeçalho de 36 px), entre 240 e 560.
    assert.equal(initialTimelineHeight(768), 264, "notebook: quase igual aos 300 de antes");
    assert.equal(initialTimelineHeight(1080), 376, "Full HD");
    assert.equal(initialTimelineHeight(1440), 505, "QHD");
    assert.equal(initialTimelineHeight(2160), 560, "4K: teto");
    assert.equal(initialTimelineHeight(600), 240, "tela baixa: piso");
    assert.equal(initialTimelineHeight(undefined), initialTimelineHeight(900), "sem medida: usa 900");
}
console.log("✔ 1 passou: fração da altura útil, com piso e teto.");

{
    // O divisor e o duplo clique usam a mesma conta; o valor salvo continua vencendo (SplitterHelper).
    const src = readFileSync(path.join(rootDir, "src", "ui", "js", "workspaceManager.js"), "utf8");
    assert.match(src, /className: "splitter-timeline",/);
    assert.match(src, /defaultVal: initialTimelineHeight\(window\.innerHeight\),\s*className: "splitter-timeline"/);
    assert.match(src, /const defaultVal = initialTimelineHeight\(window\.innerHeight\);/);
    assert.doesNotMatch(src, /const defaultVal = 300;/);
}
console.log("✔ 2 passou: divisor e duplo clique partem da mesma altura inicial.");

console.log("\n=== AUTOTESTE ALTURA INICIAL DA TIMELINE CONCLUÍDO COM SUCESSO ===");
