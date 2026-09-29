// Migração do tema (docs/PLANO_TEMA_NEUTRO.md): troca cores de fundo/linha/glow fixas por
// var(--t-<token>, <cor original>) (F0), font-size em px por calc(Npx * var(--font-scale, 1)) (F3)
// e esse calc pelo degrau da escala, var(--fs-N) (definidos em theme.css).
// No preset Clássico e escala 1 as cores não mudam; os tamanhos só arredondam o meio-pixel.
//
//   node scripts/tema_tokenizar.mjs          → relatório (não grava)
//   node scripts/tema_tokenizar.mjs --write  → grava e confere que desfazer os tokens devolve o original
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCss, scanMarkup, applyTokens, unwrapTokens, scanFontSizes, applyFontScale, unwrapFontScale,
    scanFontCalcs, applyFontSteps, unwrapFontSteps, roundFontCalcs } from "../tests/tema_cores.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEMA_ARQUIVOS_EXCLUIDOS = new Set([
    // conteúdo do vídeo: o que vai para o render nunca muda com o tema
    "playerTextOverlay.js", "textPresets.js", "titlesTab.js", "keyframeEngine.js", "textAIEngine.js",
    "fontManager.js", "exportVideo.js",
    // canvas: tokenizado à mão via themeTokens.js
    "timelineRenderer.js", "waveformManager.js", "audioGateWorklet.js",
]);

export function temaArquivos() {
    const ui = path.join(ROOT, "src", "ui");
    const js = fs.readdirSync(path.join(ui, "js")).filter(f => f.endsWith(".js") && !TEMA_ARQUIVOS_EXCLUIDOS.has(f));
    return [
        { file: path.join(ui, "styles.css"), kind: "css" },
        ...["index.html", "panel.html", "panel-group.html"].map(f => ({ file: path.join(ui, f), kind: "html" })),
        ...js.map(f => ({ file: path.join(ui, "js", f), kind: "js" })),
    ];
}

export function temaAchados(text, kind) {
    return kind === "css" ? scanCss(text) : scanMarkup(text, { isJs: kind === "js" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes("--write");
    const porToken = {};
    let total = 0, fontes = 0, degraus = 0;
    const foraDaTabela = [];
    for (const { file, kind } of temaArquivos()) {
        const raw = fs.readFileSync(file, "utf8");
        const found = temaAchados(raw, kind);
        const sizes = scanFontSizes(raw, kind);
        fontes += sizes.length;
        const calcs = scanFontCalcs(raw);
        degraus += calcs.length;
        for (const c of calcs) if (c.step == null) foraDaTabela.push(`${path.relative(ROOT, file)}: ${c.px}px`);
        if (!found.length && !sizes.length && !calcs.length) continue;
        total += found.length;
        for (const f of found) porToken[f.token] = (porToken[f.token] || 0) + 1;
        console.log(String(found.length).padStart(5), String(sizes.length).padStart(5), String(calcs.length).padStart(5), path.relative(ROOT, file));
        if (write) {
            // cores e tamanhos não se sobrepõem; aplica tamanhos no texto já com tokens de cor
            const withColors = applyTokens(raw, found);
            const scaled = applyFontScale(withColors, scanFontSizes(withColors, kind));
            const next = applyFontSteps(scaled, scanFontCalcs(scaled));
            if (unwrapFontScale(scaled) !== unwrapFontScale(withColors) || unwrapTokens(withColors) !== unwrapTokens(raw)
                || unwrapFontSteps(next) !== unwrapFontSteps(roundFontCalcs(scaled))) {
                throw new Error("desfazer não devolve o original: " + file);
            }
            fs.writeFileSync(file, next);
        }
    }
    console.log("\ncores:", total, "· tamanhos de fonte:", fontes, "· calc de fonte → degrau:", degraus);
    if (foraDaTabela.length) console.log("fora da tabela de degraus (decidir à mão):\n  " + foraDaTabela.join("\n  "));
    console.log(Object.entries(porToken).sort().map(([k, v]) => `  --t-${k}: ${v}`).join("\n"));
    if (!write) console.log("\n(relatório; use --write para gravar)");
}
