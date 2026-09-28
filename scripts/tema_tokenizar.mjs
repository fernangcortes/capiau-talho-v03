// Migração da F0 do tema (docs/PLANO_TEMA_NEUTRO.md): troca cores de fundo/linha/glow fixas por
// var(--t-<token>, <cor original>). No preset Clássico nada muda na tela (os --t-* não existem).
//
//   node scripts/tema_tokenizar.mjs          → relatório (não grava)
//   node scripts/tema_tokenizar.mjs --write  → grava e confere que desfazer os tokens devolve o original
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCss, scanMarkup, applyTokens, unwrapTokens } from "../tests/tema_cores.mjs";

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
    let total = 0;
    for (const { file, kind } of temaArquivos()) {
        const raw = fs.readFileSync(file, "utf8");
        const found = temaAchados(raw, kind);
        if (!found.length) continue;
        total += found.length;
        for (const f of found) porToken[f.token] = (porToken[f.token] || 0) + 1;
        console.log(String(found.length).padStart(5), path.relative(ROOT, file));
        if (write) {
            const next = applyTokens(raw, found);
            if (unwrapTokens(next) !== raw) throw new Error("desfazer não devolve o original: " + file);
            fs.writeFileSync(file, next);
        }
    }
    console.log("\ntotal:", total);
    console.log(Object.entries(porToken).sort().map(([k, v]) => `  --t-${k}: ${v}`).join("\n"));
    if (!write) console.log("\n(relatório; use --write para gravar)");
}
