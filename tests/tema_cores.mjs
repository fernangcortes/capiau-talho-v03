// Regra única de "o que é cor de tema" — usada pela migração (scripts/tema_tokenizar.mjs) e pela
// trava (tests/autoteste_tema_tokens.mjs). Plano: docs/PLANO_TEMA_NEUTRO.md.
//
// Toda cor de FUNDO, LINHA ou GLOW que não carrega significado vira `var(--t-<token>, <cor original>)`.
// O preset Clássico não define os --t-*, então o fallback (a cor de hoje) é o que aparece; os outros
// presets definem os --t-* e mudam a interface inteira. Texto, ícones e cores semânticas ficam fora.

export const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|(?:rgba?|hsla?)\([^()]*\)/g;

// Seletores de estado/significado: aqui a cor informa algo (seleção, foco, gravação, erro, clipe...).
export const SEMANTIC_SELECTOR_RE = /(selected|active|checked|:focus|focused|current|playing|recording|\brec\b|live|dragging|drag-?over|drop-?target|error|danger|warn|success|approved|rejected|clip|marker|keyframe|waveform|badge|tag|chip|swatch|reveal|\bdot\b|playhead|needle|progress|meter|vu-|peak|ghost|match|highlight|pulse|blink|flash|toast|alert|guide|safe-)/i;
const TRUE_STATE_RE = /(selected|\.active|checked|:focus|focused|current|playing|recording|dragging|drag-?over|drop-?target|error|danger)/i;

// Hover é decoração: `.chip:hover` neutraliza; `.chip.active:hover` continua semântico.
export function isSemanticSelector(selector) {
    if (!SEMANTIC_SELECTOR_RE.test(selector)) return false;
    if (/:hover/.test(selector) && !TRUE_STATE_RE.test(selector)) return false;
    return true;
}

export function parseColor(s) {
    s = s.trim();
    if (s[0] === "#") {
        let h = s.slice(1);
        if (h.length <= 4) h = [...h].map(c => c + c).join("");
        const n = h.match(/../g).map(x => parseInt(x, 16));
        return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] / 255 : 1 };
    }
    const parts = s.slice(s.indexOf("(") + 1, -1).split(/[\s,\/]+/).filter(Boolean);
    const num = x => x.endsWith("%") ? { p: parseFloat(x) } : parseFloat(x);
    const v = parts.map(num);
    if (v.some(x => typeof x === "number" && Number.isNaN(x))) return null;
    const alpha = v[3] == null ? 1 : (typeof v[3] === "object" ? v[3].p / 100 : v[3]);
    if (s.startsWith("rgb")) {
        const c = v.map(x => typeof x === "object" ? x.p * 2.55 : x);
        return { r: c[0], g: c[1], b: c[2], a: alpha };
    }
    const h = typeof v[0] === "object" ? v[0].p : v[0];
    const sat = (v[1].p ?? v[1]) / 100, l = (v[2].p ?? v[2]) / 100;
    const k = n => (n + h / 30) % 12, A = sat * Math.min(l, 1 - l);
    const f = n => l - A * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: alpha };
}

export function roleOf(prop) {
    prop = prop.trim().toLowerCase();
    if (/^background(-color|-image)?$/.test(prop)) return "bg";
    if (/^(border|outline)(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/.test(prop)) return "line";
    if (prop === "box-shadow") return "shadow";
    return null;
}

/**
 * Decide o token de uma cor. Retorna o nome sem prefixo (ex.: "surface-2") ou null para deixar como está.
 * ctx.semantic: o seletor/uso carrega significado → cores cromáticas ficam.
 * ctx.allowChromatic: false em atribuições dinâmicas de JS (estado desconhecido) → só neutros.
 */
export function classify(role, colorStr, ctx = {}) {
    if (!role) return null;
    const c = parseColor(colorStr);
    if (!c) return null;
    const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), chroma = mx - mn;
    const avg = (c.r + c.g + c.b) / 3;
    const darkTinted = mx <= 75 && chroma >= 4 && chroma <= 45;
    const whitish = mn >= 200 && chroma <= 20;
    const chromatic = chroma > 45;
    const mayNeutralizeChroma = chromatic && !ctx.semantic && ctx.allowChromatic !== false;

    if (role === "bg") {
        if (darkTinted && c.a >= 0.5) {
            const lvl = avg <= 8 ? 0 : avg <= 13 ? 1 : avg <= 21 ? 2 : avg <= 29 ? 3 : 4;
            return "surface-" + lvl;
        }
        if (mayNeutralizeChroma && c.a <= 0.3) return c.a <= 0.06 ? "tint-1" : c.a <= 0.12 ? "tint-2" : "tint-3";
        return null;
    }
    if (role === "line") {
        if (whitish && c.a < 1) return c.a < 0.1 ? "line-weak" : c.a <= 0.25 ? "line-strong" : null;
        if (darkTinted && c.a >= 0.5) return "line-weak";
        if (mayNeutralizeChroma && c.a <= 0.5) return c.a < 0.2 ? "line-weak" : "line-strong";
        return null;
    }
    if (role === "shadow") {
        if (mayNeutralizeChroma) return "glow";
        return null;
    }
    return null;
}

// A cor já está dentro de um var(--x, <cor>)? (já tokenizada, ou fallback de token antigo)
export function isWrapped(text, colorIndex) {
    return /var\(\s*--[\w-]+\s*,\s*$/.test(text.slice(Math.max(0, colorIndex - 60), colorIndex));
}

// Mascara comentários, strings e url(...) mantendo posições (para varrer a estrutura do CSS).
export function maskCss(css) {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, m => " ".repeat(m.length))
        .replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/g, m => "u" + " ".repeat(m.length - 1))
        .replace(/"[^"\n]*"|'[^'\n]*'/g, m => m[0] + " ".repeat(m.length - 2) + m[0]);
}

/**
 * Varre um CSS e devolve cada cor de tema encontrada: { index, color, token, prop, selector }.
 * Cores já envolvidas em var(--…, cor) são ignoradas.
 */
export function scanCss(css) {
    const masked = maskCss(css);
    const out = [];
    const stack = [];
    let segStart = 0;
    for (let i = 0; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === "{") {
            const prelude = masked.slice(segStart, i).trim();
            const parent = stack[stack.length - 1];
            // Dentro de @keyframes o "seletor" é 0%/50%; o que diz o significado é o nome da animação.
            const selector = parent && /^@keyframes/.test(parent.prelude) ? parent.prelude + " " + prelude : prelude;
            stack.push({ prelude: selector });
            segStart = i + 1;
        } else if (ch === ";" || ch === "}") {
            if (stack.length) scanDecl(css, masked, segStart, i, stack[stack.length - 1].prelude, out);
            if (ch === "}") stack.pop();
            segStart = i + 1;
        }
    }
    return out;
}

function scanDecl(css, masked, start, end, selector, out) {
    const seg = masked.slice(start, end);
    const colon = seg.indexOf(":");
    if (colon < 0) return;
    const prop = seg.slice(0, colon).trim();
    if (prop.startsWith("--")) return; // definição de variável: tratada pelos presets
    const role = roleOf(prop);
    if (!role) return;
    const semantic = isSemanticSelector(selector);
    const vStart = start + colon + 1;
    const value = masked.slice(vStart, end);
    for (const m of value.matchAll(COLOR_RE)) {
        const index = vStart + m.index;
        if (isWrapped(css, index)) continue;
        const token = classify(role, m[0], { semantic, allowChromatic: true });
        if (token) out.push({ index, color: css.substr(index, m[0].length), token, prop, selector });
    }
}

/** Varre um bloco de declarações inline (conteúdo de style="…" ou cssText). base = offset no arquivo. */
export function scanInline(text, styleStart, styleEnd, out, { allowChromatic = true, semantic = false } = {}) {
    let segStart = styleStart;
    for (let i = styleStart; i <= styleEnd; i++) {
        if (i === styleEnd || text[i] === ";") {
            const seg = text.slice(segStart, i);
            const colon = seg.indexOf(":");
            if (colon > 0) {
                const prop = seg.slice(0, colon);
                const role = /[${}]/.test(prop) ? null : roleOf(prop);
                if (role) {
                    const vStart = segStart + colon + 1;
                    for (const m of text.slice(vStart, i).matchAll(COLOR_RE)) {
                        const index = vStart + m.index;
                        if (isWrapped(text, index)) continue;
                        // Cor dentro de ${…} num template = depende de estado → não neutraliza cromática.
                        const before = text.slice(segStart, index);
                        const inExpr = before.lastIndexOf("${") > before.lastIndexOf("}");
                        const token = classify(role, m[0], { semantic, allowChromatic: allowChromatic && !inExpr });
                        if (token) out.push({ index, color: m[0], token, prop: prop.trim() });
                    }
                }
            }
            segStart = i + 1;
        }
    }
}

const JS_STYLE_PROPS = "background|backgroundColor|backgroundImage|border|borderColor|borderTop|borderBottom|borderLeft|borderRight|borderTopColor|borderBottomColor|borderLeftColor|borderRightColor|outline|outlineColor|boxShadow";

/** Varre HTML ou JS: atributos style="…", .style.cssText = "…" e .style.<prop> = "literal". */
export function scanMarkup(text, { isJs = false } = {}) {
    const out = [];
    for (const m of text.matchAll(/\bstyle\s*=\s*(["'])/g)) {
        const q = m[1], s = m.index + m[0].length;
        const e = text.indexOf(q, s);
        if (e < 0) continue;
        // atributo style dentro de string JS com aspas trocadas ou HTML: conteúdo até a aspa de fechamento
        scanInline(text, s, e, out, { allowChromatic: true });
    }
    if (isJs) {
        for (const m of text.matchAll(/\.style\.cssText\s*\+?=\s*(["'`])/g)) {
            const q = m[1], s = m.index + m[0].length;
            const e = text.indexOf(q, s);
            if (e > 0) scanInline(text, s, e, out, { allowChromatic: true });
        }
        const re = new RegExp(`\\.style\\.(${JS_STYLE_PROPS})\\s*=\\s*(["'\`])([^"'\`\\n]*)\\2\\s*[;\\n]`, "g");
        for (const m of text.matchAll(re)) {
            const prop = m[1].replace(/[A-Z]/g, x => "-" + x.toLowerCase());
            const role = roleOf(prop);
            const valStart = m.index + m[0].indexOf(m[2]) + 1;
            for (const c of m[3].matchAll(COLOR_RE)) {
                const index = valStart + c.index;
                if (isWrapped(text, index)) continue;
                // Atribuição direta em JS costuma ser estado → só neutros (superfície/linha clara).
                const token = classify(role, c[0], { allowChromatic: false });
                if (token) out.push({ index, color: c[0], token, prop });
            }
        }
    }
    // dedup (um mesmo trecho pode casar em dois padrões)
    const seen = new Set();
    return out.filter(x => !seen.has(x.index) && seen.add(x.index));
}

/** Aplica os achados: cada cor vira var(--t-<token>, <cor>). */
export function applyTokens(text, found) {
    const sorted = [...found].sort((a, b) => b.index - a.index);
    let res = text;
    for (const f of sorted) {
        res = res.slice(0, f.index) + `var(--t-${f.token}, ${f.color})` + res.slice(f.index + f.color.length);
    }
    return res;
}

/** Desfaz a tokenização (prova de que a migração só envolveu cores, sem mudar mais nada). */
export function unwrapTokens(text) {
    return text.replace(/var\(--t-[a-z0-9-]+, (#[0-9a-fA-F]+|(?:rgba?|hsla?)\([^()]*\))\)/g, "$1");
}

// ── Tamanho de fonte (F3) ────────────────────────────────────────────────────
// Todo font-size em px da UI vira calc(Npx * var(--font-scale, 1)): idêntico em escala 1,
// e o slider "Tamanho do texto" multiplica tudo de uma vez.

/** Acha font-size em px ainda não escalados. CSS usa o texto mascarado (ignora comentários). */
export function scanFontSizes(text, kind) {
    const src = kind === "css" ? maskCss(text) : text;
    const out = [];
    const res = [/(font-size\s*:\s*)(\d+(?:\.\d+)?px)/g];
    if (kind === "js") res.push(/(\.style\.fontSize\s*=\s*["'`])(\d+(?:\.\d+)?px)/g);
    for (const re of res) {
        for (const m of src.matchAll(re)) {
            const index = m.index + m[1].length;
            if (/calc\(\s*$/.test(src.slice(Math.max(0, index - 10), index))) continue;
            out.push({ index, size: m[2] });
        }
    }
    return out;
}

export function applyFontScale(text, found) {
    let res = text;
    for (const f of [...found].sort((a, b) => b.index - a.index)) {
        res = res.slice(0, f.index) + `calc(${f.size} * var(--font-scale, 1))` + res.slice(f.index + f.size.length);
    }
    return res;
}

export function unwrapFontScale(text) {
    return text.replace(/calc\((\d+(?:\.\d+)?px) \* var\(--font-scale, 1\)\)/g, "$1");
}

// ── Escala de texto em degraus (--fs-N) ─────────────────────────────────────
// Cada calc(Npx * var(--font-scale, 1)) vira var(--fs-M), definido uma vez em theme.css.
// Meio-pixel arredonda para cima; 15, 22, 26 e 28 caem no degrau vizinho. 4px é o marcador de lista do chat.
export const FS_STEPS = [4, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 32];
const FS_MAP = {
    4: 4, 7: 8, 7.5: 8, 8: 8, 8.5: 9, 9: 9, 9.5: 10, 10: 10, 10.5: 11, 11: 11, 11.5: 12, 12: 12,
    12.5: 13, 13: 13, 14: 14, 15: 16, 16: 16, 18: 18, 20: 20, 22: 24, 24: 24, 26: 32, 28: 32, 32: 32,
};

/** Degrau da escala para um tamanho em px (null = fora da tabela: decidir à mão). */
export function fsStep(px) {
    return FS_MAP[px] ?? null;
}

const FS_CALC = /calc\((\d+(?:\.\d+)?)px \* var\(--font-scale, 1\)\)/g;

/** Acha calc(Npx * var(--font-scale, 1)) que ainda não viraram var(--fs-N). */
export function scanFontCalcs(text) {
    return [...text.matchAll(FS_CALC)].map(m => ({ index: m.index, match: m[0], px: Number(m[1]), step: fsStep(Number(m[1])) }));
}

export function applyFontSteps(text, found) {
    let res = text;
    for (const f of [...found].sort((a, b) => b.index - a.index)) {
        if (f.step == null) continue;
        res = res.slice(0, f.index) + `var(--fs-${f.step})` + res.slice(f.index + f.match.length);
    }
    return res;
}

/** Desfaz os degraus: devolve calc(Mpx * …) com o tamanho do degrau (prova de que só os tamanhos mudaram). */
export function unwrapFontSteps(text) {
    return text.replace(/var\(--fs-(\d+)\)/g, "calc($1px * var(--font-scale, 1))");
}

/** O texto original com cada tamanho já arredondado ao seu degrau (o que o unwrap deve devolver). */
export function roundFontCalcs(text) {
    return text.replace(FS_CALC, (all, px) => {
        const step = fsStep(Number(px));
        return step == null ? all : `calc(${step}px * var(--font-scale, 1))`;
    });
}
