// Cor das trilhas da timeline conforme a Aparência (ui.track_mode → --t-track-mode):
//   coloridas    → as cores de sempre
//   dessaturadas → mesmo tom, bem menos saturação (a seleção e a imagem saltam)
//   mono         → cinza; cada tipo de trilha num tom, para ainda se distinguir
// Funções puras: recebem o estilo da pista ({ bg, clipBg, border, wave }) e devolvem outro.

const DESAT = 0.28;
// Luminosidade do cinza por tipo de pista no modo mono (mais claro = mais à frente).
const MONO_LIGHT = { video: 68, text: 80, audio: 52, ai: 42 };

export function parseRgba(s) {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(String(s || "").trim());
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
}

function hslToRgb(h, s, l) {
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

const rgba = ({ r, g, b }, a) => `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;

/** Uma cor rgba() no modo pedido; o que não for rgba() passa igual. */
export function convertColor(color, mode, kind = "video") {
    if (!color || mode === "coloridas") return color;
    const c = parseRgba(color);
    if (!c) return color;
    const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
    if (mode === "dessaturadas") return rgba(hslToRgb(h, s * DESAT, l), c.a);
    if (mode === "mono") return rgba(hslToRgb(0, 0, (MONO_LIGHT[kind] ?? MONO_LIGHT.video) / 100), c.a);
    return color;
}

const cache = new Map();

/** Estilo de pista no modo pedido (memorizado: o renderer chama isto a cada quadro). */
export function applyTrackMode(style, mode, kind = "video") {
    if (!style || !mode || mode === "coloridas") return style;
    let byStyle = cache.get(style);
    if (!byStyle) cache.set(style, byStyle = new Map());
    const key = `${mode}|${kind}`;
    if (!byStyle.has(key)) {
        const out = {};
        for (const [k, v] of Object.entries(style)) out[k] = typeof v === "string" ? convertColor(v, mode, kind) : v;
        byStyle.set(key, out);
    }
    return byStyle.get(key);
}
