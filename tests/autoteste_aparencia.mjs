// ======================================================================
// Autoteste: janela de Aparência (cor de interação, fundo, trilhas)
// Execução: node tests/autoteste_aparencia.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeThemeState, ACCENTS, BACKGROUNDS, backgroundOf, TRACK_MODES, THEME_DEFAULTS } from "../src/ui/js/themeManager.js";
import { convertColor, applyTrackMode, parseRgba } from "../src/ui/js/trackColors.js";
import { clampPosition } from "../src/ui/js/appearanceWindow.js";

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
}
console.log("✔ 5 passou: chaves novas iguais no registry do backend.");

console.log("\n=== AUTOTESTE APARÊNCIA CONCLUÍDO COM SUCESSO ===");
