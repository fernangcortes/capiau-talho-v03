// Espaçamento em degraus (padronização, como a escala de texto do theme.css): padding, margin e
// gap em px dentro de style="" (HTML e templates JS da UI) viram var(--sp-N). Valor fora da escala
// desce para o degrau de baixo (nunca aumenta). Negativos e zero ficam como estão.
//
//   node scripts/tema_espacos.mjs          → relatório (não grava)
//   node scripts/tema_espacos.mjs --write  → grava e confere que desfazer devolve o original arredondado
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA_ARQUIVOS_EXCLUIDOS } from "./tema_tokenizar.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Degraus definidos em theme.css (--sp-N). */
export const SP_STEPS = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64];

/** Degrau para um valor em px: o maior degrau que não passa do valor. null = fica como está. */
export function spStep(px) {
    if (!(px >= 1)) return null;
    let best = null;
    for (const s of SP_STEPS) if (s <= px) best = s;
    return px > 64 ? null : best;
}

const STYLE = /style=("[^"]*"|'[^']*')/g;
const PROP = /(?<![-\w])(padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)(\s*:\s*)([^;"'`]+)/g;
const PX = /(?<![\w.$}-])(\d+(?:\.\d+)?)px\b/g;

/** Achados: { index, match, px, step } de cada px de espaçamento dentro de style="". */
export function scanSpacing(text) {
    const out = [];
    for (const sm of text.matchAll(STYLE)) {
        const base = sm.index + "style=".length;
        for (const pm of sm[1].matchAll(PROP)) {
            const valStart = base + pm.index + pm[1].length + pm[2].length;
            for (const x of pm[3].matchAll(PX)) {
                const px = Number(x[1]);
                out.push({ index: valStart + x.index, match: x[0], px, step: spStep(px) });
            }
        }
    }
    return out;
}

export function applySpacing(text, found = scanSpacing(text)) {
    let res = text;
    for (const f of [...found].sort((a, b) => b.index - a.index)) {
        if (f.step == null) continue;
        res = res.slice(0, f.index) + `var(--sp-${f.step})` + res.slice(f.index + f.match.length);
    }
    return res;
}

/** Desfaz os degraus em px (prova de que só os espaçamentos mudaram). */
export function unwrapSpacing(text) {
    return text.replace(/var\(--sp-(\d+)\)/g, "$1px");
}

/** O original com cada espaçamento já no degrau (o que o unwrap deve devolver). */
export function roundSpacing(text, found = scanSpacing(text)) {
    let res = text;
    for (const f of [...found].sort((a, b) => b.index - a.index)) {
        if (f.step == null) continue;
        res = res.slice(0, f.index) + `${f.step}px` + res.slice(f.index + f.match.length);
    }
    return res;
}

export function espacosArquivos() {
    const ui = path.join(ROOT, "src", "ui");
    const js = fs.readdirSync(path.join(ui, "js")).filter(f => f.endsWith(".js") && !TEMA_ARQUIVOS_EXCLUIDOS.has(f));
    return [
        ...["index.html", "panel.html", "panel-group.html"].map(f => path.join(ui, f)),
        ...js.map(f => path.join(ui, "js", f)),
    ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes("--write");
    let total = 0, iguais = 0, descem = 0;
    const porValor = {};
    for (const file of espacosArquivos()) {
        const raw = fs.readFileSync(file, "utf8");
        const found = scanSpacing(raw).filter(f => f.step != null);
        if (!found.length) continue;
        total += found.length;
        for (const f of found) {
            if (f.step === f.px) iguais++;
            else { descem++; porValor[`${f.px}→${f.step}`] = (porValor[`${f.px}→${f.step}`] || 0) + 1; }
        }
        console.log(String(found.length).padStart(5), path.relative(ROOT, file));
        if (write) {
            const next = applySpacing(raw, found);
            if (unwrapSpacing(next) !== roundSpacing(raw, found)) throw new Error(`ida e volta falhou: ${file}`);
            fs.writeFileSync(file, next);
        }
    }
    console.log(`\n${total} espaçamentos: ${iguais} já no degrau, ${descem} descem ao degrau de baixo`);
    console.log(Object.entries(porValor).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join("  "));
    if (!write) console.log("\n(relatório; --write grava)");
}
