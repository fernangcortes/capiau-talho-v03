// ======================================================================
// Autoteste: tokens de tema (F0 do plano docs/PLANO_TEMA_NEUTRO.md)
// Execução: node tests/autoteste_tema_tokens.mjs
//
// Trava contra regressão: nenhuma cor de fundo/linha/glow da interface pode entrar escrita direto.
// Use var(--t-<token>, <cor>) — ou rode `node scripts/tema_tokenizar.mjs --write`, que faz isso sozinho.
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    classify, scanCss, scanMarkup, applyTokens, unwrapTokens, isSemanticSelector,
    scanFontSizes, applyFontScale, unwrapFontScale,
    FS_STEPS, fsStep, scanFontCalcs, applyFontSteps, unwrapFontSteps, roundFontCalcs
} from "./tema_cores.mjs";
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
    // Escolhas da janela de Aparência: só existem quando o usuário escolhe; sem elas vale o padrão.
    const opcionais = new Set(["--t-accent", "--t-track-mode", "--t-primary-bg", "--t-primary-ink", "--t-primary-shadow"]);
    const faltando = [...usados].filter(t => !definidos.has(t) && !opcionais.has(t));
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

// ----------------------------------------------------------------------
// PARTE 5: Personalizado e aparência (F2)
// ----------------------------------------------------------------------
console.log("\n--- PARTE 5: Personalizado e aparência ---");
const tm = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "themeManager.js")).href);
{
    assert.deepEqual(tm.computeThemeState({}), { theme: "neutro", vars: {} }, "sem nada salvo: Neutro, sem variáveis inline");
    assert.deepEqual(tm.computeThemeState({ "ui.theme": "classico" }), { theme: "classico", vars: {} });
    assert.equal(tm.computeThemeState({ "ui.theme": "xpto" }).theme, "neutro", "valor inválido cai no Neutro");

    const c = tm.computeThemeState({ "ui.theme": "custom" }).vars;
    assert.equal(c["--t-surface-0"], "hsl(0, 0%, 3%)", "Personalizado com os padrões ≈ Neutro (#080808)");
    assert.equal(c["--t-surface-4"], "hsl(0, 0%, 9%)");
    assert.equal(c["--t-line-weak"], "rgba(255, 255, 255, 0.06)");
    assert.equal(c["--t-line-strong"], "rgba(255, 255, 255, 0.12)");
    assert.equal(c["--t-glow"], "transparent");

    const theme = readFileSync(path.join(rootDir, "src", "ui", "theme.css"), "utf8");
    const bloco = theme.match(/:root\[data-theme="neutro"\]\s*\{([^}]*)\}/)[1];
    for (const m of bloco.matchAll(/(--[\w-]+)\s*:/g)) {
        if (m[1] === "--shadow-premium") continue;
        assert.ok(m[1] in c, `Personalizado define ${m[1]} (tudo que o Neutro define)`);
    }
    const tinted = tm.computeThemeState({ "ui.theme": "custom", "ui.custom_hue": 210, "ui.custom_saturation": 18, "ui.custom_step": 3 }).vars;
    assert.equal(tinted["--t-surface-2"], "hsl(210, 18%, 9%)");
    assert.equal(tinted["--t-tint-2"], "rgba(255, 255, 255, 0.1)", "véus crescem com a distância entre níveis");
}
console.log("✔ 5.1 passou: paleta do Personalizado derivada dos controles.");
{
    const v = tm.computeThemeState({ "ui.font_family": "plex_condensed", "ui.font_weight": 350, "ui.font_scale": 1.1 }).vars;
    assert.equal(v["--font-body"], v["--font-heading"], "uma família para tudo");
    assert.match(v["--font-body"], /IBM Plex Sans Condensed/);
    assert.equal(v["--font-weight-ui"], "350");
    assert.equal(v["--font-scale"], "1.1");
    assert.deepEqual(tm.computeThemeState({ "ui.font_family": "padrao", "ui.font_weight": 400, "ui.font_scale": 1 }).vars, {}, "padrões não geram variável");
    assert.equal(tm.computeThemeState({ "ui.font_scale": 5 }).vars["--font-scale"], "1.2", "escala limitada a 120%");
    const vals = tm.themeValuesFromSettings({ values: { "ui.theme": { value: "custom", origin: "project" }, "llm.x": { value: 1 } } });
    assert.deepEqual(vals, { "ui.theme": "custom" });
}
console.log("✔ 5.2 passou: fonte, peso e escala.");
{
    const reg = readFileSync(path.join(rootDir, "src", "services", "settings_registry.py"), "utf8");
    assert.match(reg, /"id": "appearance"/);
    for (const key of tm.THEME_KEYS) {
        const m = reg.match(new RegExp(`"key": "${key.replace(".", "\\.")}", "type": "\\w+", "default": ([^,]+),`));
        assert.ok(m, `registry do backend tem ${key}`);
        const def = m[1].replace(/"/g, "");
        assert.equal(String(tm.THEME_DEFAULTS[key]), String(Number.isNaN(Number(def)) ? def : Number(def)), `padrão de ${key} igual no front e no back`);
    }
    for (const opt of Object.keys(tm.FONT_STACKS)) assert.match(reg, new RegExp(`"${opt}"`), `opção de fonte ${opt} no registry`);
}
console.log("✔ 5.3 passou: chaves ui.* iguais no front e no registry do backend.");

// ----------------------------------------------------------------------
// PARTE 6: Fontes e tamanho (F3)
// ----------------------------------------------------------------------
console.log("\n--- PARTE 6: Fontes e tamanho ---");
{
    const css = "a{font-size: 11px} b{font-size:9.5px !important} /* c{font-size: 8px} */ d{font-size: 1.2em}";
    const found = scanFontSizes(css, "css");
    assert.deepEqual(found.map(f => f.size), ["11px", "9.5px"], "px fora de comentário; em/rem ficam");
    const out = applyFontScale(css, found);
    assert.ok(out.includes("font-size: calc(11px * var(--font-scale, 1))"));
    assert.equal(unwrapFontScale(out), css);
    assert.equal(scanFontSizes(out, "css").length, 0, "idempotente");
    assert.equal(scanFontSizes('el.style.fontSize = "10px";', "js").length, 1);
}
console.log("✔ 6.1 passou: varredura de font-size.");
{
    const falta = [];
    for (const { file, kind } of temaArquivos()) {
        const text = readFileSync(file, "utf8");
        for (const f of scanFontSizes(text, kind)) falta.push(`${path.relative(rootDir, file)}:${text.slice(0, f.index).split("\n").length}  ${f.size}`);
    }
    assert.deepEqual(falta.slice(0, 20), [], "font-size em px fora da escala (rode: node scripts/tema_tokenizar.mjs --write)");
}
console.log("✔ 6.2 passou: todo font-size da UI segue --font-scale.");
{
    const css = readFileSync(path.join(rootDir, "src", "ui", "fonts", "fonts.css"), "utf8");
    for (const m of css.matchAll(/url\("([^"]+)"\)/g)) assert.ok(existsSync(path.join(rootDir, "src", "ui", "fonts", m[1])), `arquivo de fonte ${m[1]}`);
    for (const fam of ["Inter", "Outfit", "Roboto Flex", "IBM Plex Sans Condensed", "Barlow Semi Condensed"]) {
        assert.match(css, new RegExp(`font-family: "${fam}"`));
    }
    for (const html of ["index.html", "panel.html", "panel-group.html"]) {
        const text = readFileSync(path.join(rootDir, "src", "ui", html), "utf8");
        assert.doesNotMatch(text, /fonts\.googleapis|fonts\.gstatic/, `${html} sem Google Fonts (offline)`);
        assert.match(text, /href="fonts\/fonts\.css/, `${html} carrega as fontes locais`);
    }
    const overlay = readFileSync(path.join(rootDir, "src", "ui", "js", "playerTextOverlay.js"), "utf8");
    assert.doesNotMatch(overlay, /var\(--font-(heading|body)\)/, "título do vídeo não segue a fonte da UI");
}
console.log("✔ 6.3 passou: fontes locais, sem Google Fonts, e título do vídeo fora do tema.");

// ----------------------------------------------------------------------
// PARTE 7: Escala de texto em degraus (--fs-N)
// ----------------------------------------------------------------------
console.log("\n--- PARTE 7: Degraus de texto ---");
{
    assert.equal(fsStep(9.5), 10, "meio-pixel sobe");
    assert.equal(fsStep(7), 8);
    assert.equal(fsStep(15), 16);
    assert.equal(fsStep(11), 11, "tamanho inteiro fica");
    assert.equal(fsStep(17), null, "fora da tabela: decidir à mão");
    const css = "a{font-size: calc(9.5px * var(--font-scale, 1))} b{font-size:calc(11px * var(--font-scale, 1))} c{width: calc(17px * var(--font-scale, 1))}";
    const out = applyFontSteps(css, scanFontCalcs(css));
    assert.ok(out.includes("font-size: var(--fs-10)") && out.includes("font-size:var(--fs-11)"));
    assert.ok(out.includes("calc(17px * var(--font-scale, 1))"), "fora da tabela não muda");
    assert.equal(unwrapFontSteps(out), roundFontCalcs(css), "desfazer devolve o original arredondado");
    assert.equal(scanFontCalcs(out).filter(f => f.step != null).length, 0, "idempotente");
}
console.log("✔ 7.1 passou: calc(Npx) → var(--fs-N).");
{
    const theme = readFileSync(path.join(rootDir, "src", "ui", "theme.css"), "utf8");
    const definidos = new Set();
    for (const m of theme.matchAll(/--fs-(\d+):\s*calc\((\d+)px \* var\(--font-scale, 1\)\)/g)) {
        assert.equal(m[1], m[2], `--fs-${m[1]} vale ${m[1]}px`);
        definidos.add(Number(m[1]));
    }
    assert.deepEqual([...definidos].sort((a, b) => a - b), FS_STEPS, "theme.css define todos os degraus");
    const soltos = [], indefinidos = [];
    for (const { file } of temaArquivos()) {
        const text = readFileSync(file, "utf8");
        const rel = path.relative(rootDir, file);
        for (const f of scanFontCalcs(text)) soltos.push(`${rel}:${text.slice(0, f.index).split("\n").length}  ${f.match}`);
        for (const m of text.matchAll(/var\(--fs-(\d+)\)/g)) if (!definidos.has(Number(m[1]))) indefinidos.push(`${rel}: --fs-${m[1]}`);
    }
    assert.deepEqual(soltos.slice(0, 20), [], "calc de fonte fora dos degraus (rode: node scripts/tema_tokenizar.mjs --write)");
    assert.deepEqual(indefinidos.slice(0, 20), [], "var(--fs-N) sem definição em theme.css");
}
console.log("✔ 7.2 passou: a UI só usa degraus definidos em theme.css.");

console.log("\n=== AUTOTESTE TOKENS DE TEMA CONCLUÍDO COM SUCESSO ===");
