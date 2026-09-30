// ======================================================================
// Autoteste: janela de Aparência (cor de interação, fundo, trilhas)
// Execução: node tests/autoteste_aparencia.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeThemeState, ACCENTS, BACKGROUNDS, backgroundOf, TRACK_MODES, THEME_DEFAULTS, TEXT_CONTRASTS, ACCENT_INK, themeOriginsFromSettings, projectOverrides, ThemeManager } from "../src/ui/js/themeManager.js";
import { convertColor, applyTrackMode, parseRgba } from "../src/ui/js/trackColors.js";
import { clampPosition, snapWeight } from "../src/ui/js/appearanceWindow.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("=== INICIANDO AUTOTESTE: APARÊNCIA ===\n");

{
    assert.deepEqual(computeThemeState({}).vars, {}, "padrões não geram variável (visual de sempre)");
    const v = computeThemeState({ "ui.accent": "laranja", "ui.track_mode": "mono" }).vars;
    assert.equal(v["--accent"], ACCENTS.laranja);
    assert.equal(v["--t-accent"], ACCENTS.laranja, "o canvas lê a mesma cor");
    assert.equal(v["--t-track-mode"], "mono");
    assert.equal(computeThemeState({ "ui.accent": "violeta" }).vars["--accent"], undefined, "fora da paleta: ignora");
    const cores = Object.values(ACCENTS).filter(Boolean).map(h => h.toLowerCase());
    for (const reservada of ["#8a5cf6", "#8b5cf6", "#22c55e", "#eb477e", "#f43f5e"]) {
        assert.ok(!cores.includes(reservada), `${reservada} tem significado e fica fora da paleta`);
    }
}
console.log("✔ 1 passou: cor de interação e modo das trilhas viram variáveis.");

{
    for (const name of Object.keys(BACKGROUNDS)) {
        assert.equal(backgroundOf(BACKGROUNDS[name]), name, `${name} se reconhece`);
    }
    assert.equal(backgroundOf({}), "neutro", "padrão = Neutro");
    assert.equal(backgroundOf({ "ui.theme": "custom", "ui.custom_hue": 99, "ui.custom_saturation": 5 }), null, "sob medida = Personalizado");
    const g = computeThemeState(BACKGROUNDS.grafite);
    assert.equal(g.theme, "custom");
    assert.match(g.vars["--t-surface-2"], /^hsl\(215, 14%/);
}
console.log("✔ 2 passou: fundos prontos.");

{
    const c = "rgba(139, 92, 246, 0.25)";
    assert.equal(convertColor(c, "coloridas"), c);
    const d = parseRgba(convertColor(c, "dessaturadas"));
    assert.equal(d.a, 0.25, "alfa preservado");
    const spread = Math.max(d.r, d.g, d.b) - Math.min(d.r, d.g, d.b);
    assert.ok(spread < 154 * 0.4, "bem menos saturado que o original");
    const m = parseRgba(convertColor(c, "mono", "audio"));
    assert.ok(m.r === m.g && m.g === m.b, "mono = cinza");
    const mv = parseRgba(convertColor(c, "mono", "video"));
    assert.ok(mv.r > m.r, "no mono, vídeo e áudio têm tons diferentes");
    assert.equal(convertColor("#ff0000", "mono"), "#ff0000", "o que não é rgba() passa igual");

    const style = { bg: "rgba(16, 185, 129, 0.07)", clipBg: "rgba(16, 185, 129, 0.18)", wave: null };
    assert.equal(applyTrackMode(style, "coloridas"), style, "coloridas devolve o mesmo objeto");
    const a1 = applyTrackMode(style, "mono", "audio");
    assert.equal(applyTrackMode(style, "mono", "audio"), a1, "memorizado (o renderer chama a cada quadro)");
    assert.equal(a1.wave, null);
}
console.log("✔ 3 passou: conversão das cores das trilhas.");

{
    assert.deepEqual(clampPosition(-900, -50, 320, 1280, 720), { x: -260, y: 0 }, "sobra um pedaço visível para puxar de volta");
    assert.deepEqual(clampPosition(5000, 5000, 320, 1280, 720), { x: 1220, y: 688 });
    assert.deepEqual(clampPosition(100, 60, 320, 1280, 720), { x: 100, y: 60 });
}
console.log("✔ 4 passou: a janela não se perde fora da tela.");

{
    const reg = readFileSync(path.join(rootDir, "src", "services", "settings_registry.py"), "utf8");
    const enumOf = (key) => JSON.parse(reg.match(new RegExp(`"key": "${key.replace(".", "\\.")}"[^}]*?"enum": (\\[[^\\]]*\\])`))[1]);
    assert.deepEqual(enumOf("ui.accent"), Object.keys(ACCENTS), "paleta igual no front e no back");
    assert.deepEqual(enumOf("ui.track_mode"), TRACK_MODES);
    assert.equal(THEME_DEFAULTS["ui.accent"], "padrao");
    assert.equal(THEME_DEFAULTS["ui.track_mode"], "coloridas");
    assert.deepEqual(enumOf("ui.text_contrast"), Object.keys(TEXT_CONTRASTS));
    assert.equal(THEME_DEFAULTS["ui.text_contrast"], "padrao");
}
console.log("✔ 5 passou: chaves novas iguais no registry do backend.");

{
    // Texto secundário: padrão não mexe; os níveis passam de 4,5:1 sobre #101010.
    assert.equal(computeThemeState({ "ui.text_contrast": "padrao" }).vars["--text-muted"], undefined);
    assert.equal(computeThemeState({ "ui.text_contrast": "alto" }).vars["--text-muted"], TEXT_CONTRASTS.alto);
    assert.equal(computeThemeState({ "ui.text_contrast": "xyz" }).vars["--text-muted"], undefined, "fora da lista: ignora");
    const lum = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
        .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
        .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const hex of Object.values(TEXT_CONTRASTS).filter(Boolean)) {
        assert.ok(ratio(hex, "#101010") >= 4.5, `${hex} passa de 4,5:1`);
    }
    // Primário: tinta escura só quando há cor escolhida, e ela passa em toda a paleta.
    assert.equal(computeThemeState({}).vars["--t-accent-ink"], undefined, "sem escolha, botão fica como sempre");
    assert.equal(computeThemeState({ "ui.accent": "lima" }).vars["--t-accent-ink"], ACCENT_INK);
    for (const hex of Object.values(ACCENTS).filter(Boolean)) {
        assert.ok(ratio(hex, ACCENT_INK) >= 4.5, `texto escuro legível sobre ${hex}`);
    }
    // Peso fino: passo de 10 entre 300 e 500 (o 340 não arredonda mais).
    assert.equal(snapWeight(340), 340);
    assert.equal(snapWeight(344), 340);
    assert.equal(snapWeight(250), 300);
    assert.equal(snapWeight("abc"), 400);
    assert.equal(computeThemeState({ "ui.font_weight": 340 }).vars["--font-weight-ui"], "340");
}
console.log("✔ 6 passou: contraste do texto secundário, tinta do primário e peso fino.");

{
    // Origem de cada valor e gravação por escopo.
    const data = { values: { "ui.accent": { value: "laranja", origin: "project" }, "ui.font_weight": { value: 340, origin: "global" } } };
    assert.deepEqual(projectOverrides(themeOriginsFromSettings(data)), ["ui.accent"]);

    const calls = [];
    const STATE = { currentProjectId: 7, on() {}, emit: (ev, p) => calls.push(["emit", ev, p.scope]) };
    const api = {
        fetchSettings: async () => data,
        updateGlobalSettings: async (v) => calls.push(["global", v]),
        updateProjectSettings: async (pid, v) => calls.push(["project", pid, v]),
        resetSettings: async (scope, pid, keys) => calls.push(["reset", scope, pid, keys]),
    };
    globalThis.localStorage = { setItem() {}, getItem() { return null; } };
    globalThis.window = globalThis.window || {};
    const tm = new ThemeManager({ STATE, CapIAuAPI: api });
    await tm.load();
    assert.deepEqual(tm.projectKeys, ["ui.accent"]);

    await tm.save({ "ui.accent": "azul" }, "global");
    assert.deepEqual(calls[0], ["global", { "ui.accent": "azul" }]);
    assert.equal(tm.saved["ui.accent"], "laranja", "no global, o que o projeto sobrescreve continua valendo nele");

    await tm.save({ "ui.accent": "azul" }, "project");
    assert.deepEqual(calls[2], ["project", 7, { "ui.accent": "azul" }]);
    assert.equal(tm.saved["ui.accent"], "azul");

    await tm.followGlobal();
    assert.deepEqual(calls[4], ["reset", "project", 7, ["ui.accent"]], "voltar ao global apaga só as chaves do projeto");
}
console.log("✔ 7 passou: aparência grava no global ou só no projeto, e sabe de onde vem cada valor.");

{
    // Botão primário: com cor escolhida, todos lisos na cor, texto escuro e sem brilho.
    const v = computeThemeState({ "ui.accent": "azul" }).vars;
    assert.equal(v["--t-primary-bg"], ACCENTS.azul);
    assert.equal(v["--t-primary-ink"], ACCENT_INK);
    assert.equal(v["--t-primary-shadow"], "none");
    assert.equal(computeThemeState({}).vars["--t-primary-bg"], undefined, "sem escolha, cada primário fica como é");

    const css = readFileSync(path.join(rootDir, "src", "ui", "styles.css"), "utf8");
    const rule = css.match(/\n\.btn-primary \{[^}]*\}/)[0];
    assert.match(rule, /background: var\(--t-primary-bg, var\(--primary-bg,/);
    assert.match(rule, /color: var\(--t-primary-ink, var\(--primary-ink,/);

    // Primário sólido não escreve a própria cor em background/color: declara --primary-bg/--primary-ink,
    // senão a cor de interação não chega nele. Rosa (parar/apagar), âmbar e tons claros têm significado e ficam.
    const ui = path.join(rootDir, "src", "ui");
    const files = ["index.html", ...readdirSync(path.join(ui, "js")).filter(f => f.endsWith(".js")).map(f => path.join("js", f))];
    const bad = [];
    for (const f of files) {
        const text = readFileSync(path.join(ui, f), "utf8");
        for (const m of text.matchAll(/<button[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*style="([^"]*)"/g)) {
            if (/(^|[;\s])background:\s*(var\(--color-(cyan|violet)\)|linear-gradient\(135deg,\s*(#06b6d4|rgba\((139|6),))/.test(m[1])) bad.push(`${f}: ${m[1].slice(0, 80)}`);
        }
    }
    assert.deepEqual(bad, [], "primário com cor de interação escrita no botão");
}
console.log("✔ 8 passou: botão primário segue a cor de interação, com texto escuro.");

console.log("\n=== AUTOTESTE APARÊNCIA CONCLUÍDO COM SUCESSO ===");
