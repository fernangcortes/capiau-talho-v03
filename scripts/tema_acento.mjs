// Cor de interação em tudo (Fernando, 30/09/2026: "controles e títulos seguem a cor"): o ciano escrito
// na UI passa a ler a cor escolhida na Aparência. Sem escolha nada muda: --accent vale var(--color-cyan)
// e --t-accent só existe com escolha, então cada fallback é o ciano que já estava ali.
//
//   var(--color-cyan…)        → var(--accent…)
//   rgba(6, 182, 212, A)      → color-mix(in srgb, var(--t-accent, rgb(6, 182, 212)) A%, transparent)
//   rgba(34, 211, 238, A)     → idem com rgb(34, 211, 238)
//   #06b6d4 #22d3ee #67e8f9 #0e7490 #0891b2 #cff4fc → var(--t-accent, #hex)   (CSS e style="" do HTML)
//
// Fica de fora o que tem significado: :root (definições), cores por tipo (.clue-badge.*,
// .ev-track-icone--*), hex no JS (paleta de etiquetas, cor de marcador, log), cor guardada como dado
// num objeto JS (color: "var(--color-cyan)" de pasta inteligente, status, perfil de IA), conteúdo do
// vídeo e canvas (TEMA_ARQUIVOS_EXCLUIDOS).
//
//   node scripts/tema_acento.mjs          → relatório
//   node scripts/tema_acento.mjs --write  → grava
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEMA_ARQUIVOS_EXCLUIDOS } from "./tema_tokenizar.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ACENTO_SELETORES_FIXOS = [/^\s*:root\b/, /\.clue-badge\./, /\.ev-track-icone--/];
// Hex já embrulhado (var(--t-accent, #hex)) não conta de novo: a troca é idempotente.
const HEX_CIANO = /(?<!--t-accent,\s*)#(06b6d4|22d3ee|67e8f9|0e7490|0891b2|cff4fc)\b(?![\w-])/gi;
const RGBA_CIANO = /rgba\(\s*(6\s*,\s*182\s*,\s*212|34\s*,\s*211\s*,\s*238)\s*,\s*([\d.]+)\s*\)/g;
const VAR_CIANO = /var\(--color-cyan\b/g;
// color: "var(--color-cyan)" / themeColor: '…' num objeto JS: é dado (pasta, status, perfil), não estilo.
const DADO_CIANO = /(\b\w*[cC]olor\s*:\s*)(["'])var\(--color-cyan\)\2/g;
const GUARDA = "\u0000CIANO_DADO\u0000";

function pct(a) {
    return `${Math.round(Number(a) * 1000) / 10}%`;
}

/** Troca num trecho de estilo (corpo de regra CSS ou style=""). hex: também troca hex ciano. */
export function acentuar(texto, { hex = true } = {}) {
    let s = texto.replace(VAR_CIANO, "var(--accent");
    s = s.replace(RGBA_CIANO, (all, rgb, a) =>
        `color-mix(in srgb, var(--t-accent, rgb(${rgb.replace(/\s+/g, "").split(",").join(", ")})) ${pct(a)}, transparent)`);
    if (hex) s = s.replace(HEX_CIANO, (m) => `var(--t-accent, ${m})`);
    return s;
}

/** Quantas ocorrências de ciano um trecho ainda tem. */
export function cianos(texto, { hex = true } = {}) {
    const n = (re) => (texto.match(re) || []).length;
    return n(VAR_CIANO) + n(RGBA_CIANO) + (hex ? n(HEX_CIANO) : 0);
}

/** CSS: regra por regra, pulando seletores fixos. Devolve { texto, trocas }. */
export function acentuarCss(css) {
    let trocas = 0;
    const texto = css.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel, corpo) => {
        if (ACENTO_SELETORES_FIXOS.some(re => re.test(sel.replace(/\/\*[\s\S]*?\*\//g, "")))) return all;
        const n = cianos(corpo);
        if (!n) return all;
        trocas += n;
        return `${sel}{${acentuar(corpo)}}`;
    });
    return { texto, trocas };
}

/** HTML e templates JS: var(--color-cyan) em qualquer lugar (só CSS entende var()); rgba e hex só dentro de style="". */
export function acentuarMarcacao(text, { isJs = false } = {}) {
    let trocas = 0;
    let s = isJs ? text.replace(DADO_CIANO, (all, prop, q) => `${prop}${q}${GUARDA}${q}`) : text;
    // Amostra de paleta (data-color="…"): a cor é o dado que ela mostra, não a interface.
    s = s.replace(/(<[^>]*\bdata-color="[^"]*"[^>]*\bstyle=")([^"]*)(")/g, (all, a, val, b) => a + val.replace(/#/g, "\u0001") + b);
    s = s.replace(/style=("[^"]*"|'[^']*')/g, (all, val) => {
        const n = cianos(val, { hex: !isJs });
        if (!n) return all;
        trocas += n;
        return `style=${acentuar(val, { hex: !isJs })}`;
    });
    const soltos = (s.match(VAR_CIANO) || []).length;
    trocas += soltos;
    s = s.replace(VAR_CIANO, "var(--accent");
    s = s.split(GUARDA).join("var(--color-cyan)").split("\u0001").join("#");
    return { texto: s, trocas };
}

export function acentoArquivos() {
    const ui = path.join(ROOT, "src", "ui");
    const js = fs.readdirSync(path.join(ui, "js")).filter(f => f.endsWith(".js") && !TEMA_ARQUIVOS_EXCLUIDOS.has(f));
    return [
        { file: path.join(ui, "styles.css"), kind: "css" },
        ...["index.html", "panel.html", "panel-group.html"].map(f => ({ file: path.join(ui, f), kind: "html" })),
        ...js.map(f => ({ file: path.join(ui, "js", f), kind: "js" })),
    ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes("--write");
    let total = 0;
    for (const { file, kind } of acentoArquivos()) {
        const raw = fs.readFileSync(file, "utf8");
        const { texto, trocas } = kind === "css" ? acentuarCss(raw) : acentuarMarcacao(raw, { isJs: kind === "js" });
        if (!trocas) continue;
        total += trocas;
        console.log(String(trocas).padStart(5), path.relative(ROOT, file));
        if (write) fs.writeFileSync(file, texto);
    }
    console.log(`\n${total} cianos passam a seguir a cor de interação${write ? "" : " (relatório; --write grava)"}`);
}
