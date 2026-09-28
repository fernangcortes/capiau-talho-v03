// ======================================================================
// Autoteste: tokens de tema (F0 do plano docs/PLANO_TEMA_NEUTRO.md)
// Execução: node tests/autoteste_tema_tokens.mjs
//
// Trava contra regressão: nenhuma cor de fundo/linha/glow da interface pode entrar escrita direto.
// Use var(--t-<token>, <cor>) — ou rode `node scripts/tema_tokenizar.mjs --write`, que faz isso sozinho.
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classify, scanCss, scanMarkup, applyTokens, unwrapTokens, isSemanticSelector } from "./tema_cores.mjs";
import { temaArquivos, temaAchados } from "../scripts/tema_tokenizar.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== INICIANDO AUTOTESTE: TOKENS DE TEMA ===\n");

// ----------------------------------------------------------------------
// PARTE 1: A regra de classificação
// ----------------------------------------------------------------------
console.log("--- PARTE 1: Regra de classificação ---");
{
    assert.equal(classify("bg", "hsl(250, 15%, 8%)"), "surface-2", "fundo escuro tingido vira superfície");
    assert.equal(classify("bg", "#030509"), "surface-0");
    assert.equal(classify("bg", "#101010"), null, "cinza neutro já está certo");
    assert.equal(classify("bg", "#000"), null, "preto (fundo de monitor) fica");
    assert.equal(classify("bg", "rgba(138, 92, 246, 0.1)"), "tint-2", "véu violeta decorativo neutraliza");
    assert.equal(classify("bg", "rgba(138, 92, 246, 0.1)", { semantic: true }), null, "véu em estado fica");
    assert.equal(classify("bg", "rgba(6, 182, 212, 0.85)"), null, "fundo cromático forte é significado");
    assert.equal(classify("line", "rgba(255, 255, 255, 0.07)"), "line-weak");
    assert.equal(classify("line", "rgba(255, 255, 255, 0.2)"), "line-strong");
    assert.equal(classify("line", "#f43f5e"), null, "borda cromática opaca é significado");
    assert.equal(classify("shadow", "rgba(138, 92, 246, 0.6)"), "glow");
    assert.equal(classify("shadow", "rgba(0, 0, 0, 0.5)"), null, "sombra preta fica");
    assert.equal(classify("bg", "rgba(138, 92, 246, 0.1)", { allowChromatic: false }), null, "JS dinâmico: só neutros");
    assert.equal(classify(null, "#14101d"), null, "texto/ícone nunca entra");
}
console.log("✔ 1.1 passou: fundo, linha, glow; texto e significado ficam de fora.");
{
    assert.equal(isSemanticSelector(".media-card.active"), true);
    assert.equal(isSemanticSelector(".preset-chip:hover"), false, "hover é decoração");
    assert.equal(isSemanticSelector(".preset-chip.active:hover"), true);
    assert.equal(isSemanticSelector(".settings-modal-body"), false);
}
console.log("✔ 1.2 passou: seletores de estado protegem a cor, hover não.");

// ----------------------------------------------------------------------
// PARTE 2: Varredura e ida-e-volta
// ----------------------------------------------------------------------
console.log("\n--- PARTE 2: Varredura ---");
{
    const css = `.a{background:#14101d;border:1px solid rgba(255,255,255,.07);color:#14101d}
.b.selected{background:rgba(138,92,246,.2)} .c{background:url("data:image/svg+xml;utf8,<svg fill='%23fff'/>") #14101d}
/* .d{background:#14101d} */ .e{--x:#14101d;background:var(--bg-base, #14101d)}`;
    const found = scanCss(css);
    assert.deepEqual(found.map(f => f.token), ["surface-3", "line-weak", "surface-3"], "comentário, variável, url() e texto ficam de fora");
    const out = applyTokens(css, found);
    assert.ok(out.includes("background:var(--t-surface-3, #14101d);"));
    assert.equal(unwrapTokens(out), css, "desfazer devolve o original");
    assert.equal(scanCss(out).length, 0, "idempotente");
}
console.log("✔ 2.1 passou: CSS.");
{
    const js = `el.innerHTML = \`<div style="background: #14101d; border: 1px solid \${on ? 'rgba(138,92,246,.3)' : 'rgba(255,255,255,.07)'}">x</div>\`;
el.style.backgroundColor = "#121218";
el.style.background = "rgba(138, 92, 246, 0.1)";`;
    const found = scanMarkup(js, { isJs: true });
    assert.deepEqual(found.map(f => f.token).sort(), ["line-weak", "surface-2", "surface-3"], "cromática em ${} e em .style = fica");
}
console.log("✔ 2.2 passou: estilos inline em HTML/JS.");

// ----------------------------------------------------------------------
// PARTE 3: A trava — o código da UI não tem cor de tema fora de token
// ----------------------------------------------------------------------
console.log("\n--- PARTE 3: Nenhuma cor de tema escrita direto ---");
{
    const problemas = [];
    for (const { file, kind } of temaArquivos()) {
        const text = readFileSync(file, "utf8");
        for (const f of temaAchados(text, kind)) {
            const line = text.slice(0, f.index).split("\n").length;
            problemas.push(`${path.relative(rootDir, file)}:${line}  ${f.prop}: ${f.color}  → --t-${f.token}`);
        }
    }
    assert.equal(problemas.length, 0,
        `Cores de fundo/linha/glow fora de token (rode: node scripts/tema_tokenizar.mjs --write):\n  ${problemas.slice(0, 30).join("\n  ")}`);
}
console.log("✔ 3.1 passou: styles.css, HTMLs e JS da UI estão tokenizados.");
{
    const theme = readFileSync(path.join(rootDir, "src", "ui", "theme.css"), "utf8");
    for (const html of ["index.html", "panel.html", "panel-group.html"]) {
        const text = readFileSync(path.join(rootDir, "src", "ui", html), "utf8");
        assert.match(text, /href="theme\.css(\?v=\d+)?"/, `${html} carrega theme.css`);
        assert.ok(text.indexOf("theme.css") > text.indexOf("styles.css"), `${html}: theme.css depois de styles.css`);
    }
    assert.doesNotMatch(theme.replace(/\/\*[\s\S]*?\*\//g, ""), /^\s*:root\s*\{[^}]*--t-/m,
        "o Clássico (:root sem data-theme) não define --t-*: é o fallback que preserva o visual de sempre");
}
console.log("✔ 3.2 passou: theme.css ligado nas três páginas e o Clássico sem tokens.");

// ----------------------------------------------------------------------
// PARTE 4: Presets
// ----------------------------------------------------------------------
console.log("\n--- PARTE 4: Presets ---");
{
    const theme = readFileSync(path.join(rootDir, "src", "ui", "theme.css"), "utf8");
    const bloco = theme.match(/:root\[data-theme="neutro"\]\s*\{([^}]*)\}/);
    assert.ok(bloco, "theme.css tem o preset Neutro");
    const definidos = new Set([...bloco[1].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const usados = new Set();
    for (const { file } of temaArquivos()) for (const m of readFileSync(file, "utf8").matchAll(/var\((--t-[\w-]+)/g)) usados.add(m[1]);
    for (const f of ["timelineRenderer.js", "player.js"]) {
        for (const m of readFileSync(path.join(rootDir, "src", "ui", "js", f), "utf8").matchAll(/themeColor\("([\w-]+)"/g)) usados.add("--t-" + m[1]);
    }
    const faltando = [...usados].filter(t => !definidos.has(t));
    assert.deepEqual(faltando, [], "todo token usado no código precisa de valor no Neutro");
    for (const antigo of ["--bg-base", "--bg-glass", "--bg-glass-active", "--border-glass", "--border-glass-glow"]) {
        assert.ok(definidos.has(antigo), `Neutro redefine ${antigo}`);
    }
}
console.log("✔ 4.1 passou: o Neutro define todos os tokens usados na UI e no canvas.");
{
    for (const html of ["index.html", "panel.html", "panel-group.html"]) {
        const text = readFileSync(path.join(rootDir, "src", "ui", html), "utf8");
        const boot = text.indexOf("js/themeBoot.js");
        assert.ok(boot > 0 && boot < text.indexOf("</head>"), `${html}: themeBoot.js no <head> (tema antes do primeiro paint)`);
        assert.doesNotMatch(text.slice(text.lastIndexOf("<script", boot), boot), /type="module"|defer|async/, `${html}: themeBoot é síncrono`);
    }
}
console.log("✔ 4.2 passou: tema aplicado no <head>, de forma síncrona, nas três páginas.");

console.log("\n=== AUTOTESTE TOKENS DE TEMA CONCLUÍDO COM SUCESSO ===");
