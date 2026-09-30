// ======================================================================
// Autoteste: Inspetor com 3 abas; Temas e Rostos do clipe viram seções do Índice
// Execução: node tests/autoteste_inspetor_indice.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(rootDir, "src", "ui", "index.html"), "utf8");
const lib = readFileSync(path.join(rootDir, "src", "ui", "js", "library.js"), "utf8");
console.log("=== INICIANDO AUTOTESTE: INSPETOR · ÍNDICE ===\n");

{
    const tabs = html.match(/<div class="media-tabs" id="inspector-tabs"[\s\S]*?\n\s*<\/div>/)[0];
    const ids = [...tabs.matchAll(/data-inspector-tab="([\w-]+)"/g)].map(m => m[1]);
    assert.deepEqual(ids, ["inspector-tab-index", "inspector-tab-transcript", "inspector-tab-ai"], "Índice, Legenda, IA");
    assert.ok(!html.includes('id="inspector-tab-themes"') && !html.includes('id="inspector-tab-faces"'), "as páginas antigas saíram");
    // Biblioteca continua com Temas e Rostos do projeto.
    const left = html.match(/<div class="media-tabs" id="left-tabs">[\s\S]*?<\/div>/)[0];
    assert.match(left, /data-tab="tab-themes"/);
    assert.match(left, /data-tab="tab-faces"/);
}
console.log("✔ 1 passou: Inspetor com 3 abas; Biblioteca mantém Temas e Rostos do projeto.");

{
    const ini = html.indexOf('id="inspector-tab-index"');
    const fim = html.indexOf('id="inspector-tab-transcript"');
    const indice = html.slice(ini, fim);
    for (const id of ["inspector-sec-themes", "inspector-sec-faces", "inspector-themes-list", "inspector-faces-grid",
        "sel-inspector-link-theme", "num-inspector-link-start", "num-inspector-link-end", "txt-inspector-link-excerpt",
        "btn-inspector-link-theme-submit", "inspector-link-theme-form", "btn-inspector-toggle-link-theme"]) {
        assert.ok(indice.includes(`id="${id}"`), `${id} dentro do Índice`);
        assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} uma vez só no HTML`);
    }
    assert.match(indice, /<div id="inspector-link-theme-form" hidden>/, "formulário começa escondido");
    assert.match(lib, /btn-inspector-toggle-link-theme[\s\S]{0,400}linkForm\.hidden = !linkForm\.hidden/, "\"+ vincular\" abre e fecha ali mesmo");
}
console.log("✔ 2 passou: seções no Índice, com os mesmos ids que o library.js já usa.");

console.log("\n=== AUTOTESTE INSPETOR · ÍNDICE CONCLUÍDO COM SUCESSO ===");
