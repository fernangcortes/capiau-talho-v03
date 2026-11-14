/* =============================================================================
   CapIAu-Talho — página Início (inicio.js)
   A vitrine: a timeline viva da abertura (com o talho de laser, o ripple e o
   ghost clip aprovado), a folha de contato 100:1, a renomeação por IA, a demo
   de edição por texto com Shift+E, o gráfico do "grátis", a nuvem opcional da
   privacidade e a pausa das animações CSS fora da tela.
   Tudo passa por Talho.loop/onVisible e respeita "movimento desligado"
   (quadro estático legível). Sem globais: só Talho.pages.inicio.
   ========================================================================== */
(() => {
    "use strict";

    const T = window.Talho;
    if (!T) return;

    const { clamp, lerp } = T.math;
    const $ = (sel, el = document) => el.querySelector(sel);
    const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
    const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
    const ease = {
        out: (t) => 1 - Math.pow(1 - t, 3),
        inOut: T.math.easeInOutCubic,
        back: (t) => { const c = 1.7; const u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
    };
    const RATE = 24; // amostras de forma de onda por segundo

    /* ── utilidades ─────────────────────────────────────────────────────── */
    function rng(seed) { // mulberry32: aleatório estável (a mesma onda a cada ciclo)
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // cores dos tokens do base.css, lidas uma vez como [r, g, b]
    const C = (() => {
        const names = ["cyan", "violet", "emerald", "rose", "amber", "cyan-soft", "violet-soft", "emerald-soft",
            "rose-soft", "amber-soft", "fg-1", "fg-2", "fg-3", "bg-0", "bg-1", "bg-2", "bg-3", "magenta"];
        const probe = document.createElement("i");
        probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
        document.body.appendChild(probe);
        const out = {};
        for (const n of names) {
            probe.style.color = `var(--${n})`;
            const m = getComputedStyle(probe).color.match(/[\d.]+/g);
            out[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [255, 255, 255];
        }
        probe.remove();
        return out;
    })();
    const WHITE = [255, 255, 255];
    const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
    const F = {
        body: cssVar("--font-body", "Inter, system-ui, sans-serif"),
        mono: cssVar("--font-mono", "ui-monospace, monospace"),
        display: cssVar("--font-display", "system-ui, sans-serif"),
    };

    function rr(ctx, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    const fitCache = new Map();
    function fitText(ctx, text, maxW) { // corta com reticências, com cache
        const mw = Math.floor(maxW / 4) * 4;
        if (mw < 14) return "";
        const key = `${ctx.font}|${mw}|${text}`;
        let v = fitCache.get(key);
        if (v !== undefined) return v;
        if (ctx.measureText(text).width <= mw) v = text;
        else {
            let lo = 0, hi = text.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= mw) lo = mid; else hi = mid - 1;
            }
            v = lo >= 2 ? text.slice(0, lo).trimEnd() + "…" : "";
        }
        if (fitCache.size > 800) fitCache.clear();
        fitCache.set(key, v);
        return v;
    }

    function speechWave(seed, dur) { // fala: rajadas de sílabas e respiros
        const r = rng(seed), n = Math.ceil(dur * RATE), a = new Float32Array(n);
        let i = 0;
        while (i < n) {
            const len = Math.max(2, Math.round((0.14 + r() * 0.36) * RATE));
            const amp = 0.38 + r() * 0.58;
            for (let k = 0; k < len && i < n; k++, i++) {
                const env = Math.sin(Math.PI * (k + 0.5) / len);
                a[i] = clamp(amp * (0.5 + 0.5 * env) * (0.72 + r() * 0.28), 0, 1);
            }
            const pause = r() < 0.15 ? 0.32 + r() * 0.45 : 0.04 + r() * 0.12;
            const gl = Math.round(pause * RATE);
            for (let k = 0; k < gl && i < n; k++, i++) a[i] = 0.04 + r() * 0.05;
        }
        return a;
    }
    function musicWave(seed, dur) { // trilha: energia contínua com pulso
        const r = rng(seed), n = Math.ceil(dur * RATE), a = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const tt = i / RATE;
            const beat = Math.max(0, 1 - ((tt * 1.6) % 1) * 3.2);
            a[i] = clamp(0.26 + 0.12 * Math.sin(tt * 0.9) + 0.22 * beat + r() * 0.12, 0, 1);
        }
        return a;
    }

    /* ── cenas do monitor (ilustrações em canvas, não capturas reais) ───── */
    function vgrad(ctx, w, h, top, bot) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, rgba(top));
        g.addColorStop(1, rgba(bot));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    function glow(ctx, x, y, r, col, a) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(col, a));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    function vignette(ctx, w, h, k) {
        const g = ctx.createRadialGradient(w / 2, h * 0.52, h * 0.3, w / 2, h * 0.52, Math.max(w, h) * 0.78);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${k})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }
    function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    function person(ctx, cx, h, s) { // cabeça, pescoço e ombros até a base do quadro
        const r = 0.12 * s;
        const hy = h - 0.5 * s;
        ctx.beginPath();
        ctx.ellipse(cx, hy, r * 0.84, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.42, hy + r * 0.6);
        ctx.lineTo(cx + r * 0.42, hy + r * 0.6);
        ctx.lineTo(cx + r * 0.5, hy + r * 1.25);
        ctx.bezierCurveTo(cx + r * 2.3, hy + r * 1.45, cx + r * 2.75, hy + r * 2.1, cx + r * 2.95, h + 2);
        ctx.lineTo(cx - r * 2.95, h + 2);
        ctx.bezierCurveTo(cx - r * 2.75, hy + r * 2.1, cx - r * 2.3, hy + r * 1.45, cx - r * 0.5, hy + r * 1.25);
        ctx.closePath();
        ctx.fill();
    }
    function interview(o) {
        return (ctx, w, h, t) => {
            vgrad(ctx, w, h, o.top, o.bot);
            glow(ctx, o.kx * w, o.ky * h, w * 0.62, o.key, 0.5);
            if (o.window) {
                const wx = w * 0.64, wy = h * 0.08, ww = w * 0.26, wh = h * 0.52;
                const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
                g.addColorStop(0, rgba(o.key, 0.34));
                g.addColorStop(1, rgba(o.key, 0.08));
                ctx.fillStyle = g;
                ctx.fillRect(wx, wy, ww, wh);
                ctx.fillStyle = rgba(o.top, 0.9);
                ctx.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
                ctx.fillRect(wx, wy + wh * 0.48, ww, 3);
            }
            const r = rng(o.seed);
            for (let i = 0; i < 8; i++) { // bokeh ao fundo
                const bx = r() * w, by = r() * h * 0.62, br = (0.03 + r() * 0.07) * h;
                ctx.fillStyle = rgba(i % 2 ? o.key : o.bokeh, 0.07 + r() * 0.08);
                circle(ctx, bx + Math.sin(t * 0.25 + i) * 0.006 * w, by, br);
            }
            const cx = o.x * w + Math.sin(t * 0.6) * 0.002 * w;
            const s = o.sc * h;
            const dir = o.kx > o.x ? 1 : -1;
            ctx.fillStyle = rgba(o.rim, 0.55); // luz de recorte
            person(ctx, cx + dir * Math.max(1.2, w * 0.004), h, s);
            ctx.fillStyle = "rgba(5,4,9,0.97)";
            person(ctx, cx, h, s);
            vignette(ctx, w, h, 0.55);
        };
    }
    function vinyl(ctx, w, h, t) {
        vgrad(ctx, w, h, mix(C.amber, C.bg0, 0.84), mix(C.amber, C.bg0, 0.95));
        glow(ctx, w * 0.2, h * 0.15, w * 0.7, C.amber, 0.22);
        const cx = w * 0.58, cy = h * 0.6, R = h * 0.62;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        circle(ctx, cx + R * 0.04, cy + R * 0.06, R);
        ctx.fillStyle = "#0b0b0e";
        circle(ctx, cx, cy, R);
        ctx.lineWidth = 1;
        for (let k = 0; k < 18; k++) { // sulcos
            ctx.strokeStyle = `rgba(255,255,255,${0.035 + (k % 3) * 0.012})`;
            ctx.beginPath();
            ctx.arc(cx, cy, R * (0.4 + k * 0.032), 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.save(); // reflexo fixo: a luz fica, o disco gira
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(-0.7);
        const lg = ctx.createLinearGradient(0, -R * 0.18, 0, R * 0.18);
        lg.addColorStop(0, "rgba(255,255,255,0)");
        lg.addColorStop(0.5, "rgba(255,255,255,0.09)");
        lg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = lg;
        ctx.fillRect(-R, -R * 0.18, R * 2, R * 0.36);
        ctx.restore();
        const lr = R * 0.3; // rótulo
        ctx.fillStyle = rgba(C.amber, 0.95);
        circle(ctx, cx, cy, lr);
        ctx.fillStyle = rgba(C.rose, 0.85);
        circle(ctx, cx, cy, lr * 0.55);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 3.5);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(lr * 0.62, -1.2, lr * 0.3, 2.4);
        ctx.restore();
        ctx.fillStyle = "#d9d6e2";
        circle(ctx, cx, cy, Math.max(1.5, lr * 0.08));
        ctx.strokeStyle = "rgba(220,220,232,0.85)"; // braço do toca-discos
        ctx.lineWidth = Math.max(1.5, h * 0.018);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(w * 0.95, h * 0.08);
        ctx.lineTo(w * 0.92, h * 0.46);
        ctx.lineTo(cx + R * 0.58, cy - R * 0.1);
        ctx.stroke();
        ctx.fillStyle = rgba(mix(C.amber, C.bg0, 0.55), 1); // a mão que chega ao disco
        ctx.save();
        ctx.translate(cx - R * 0.98, cy + R * 0.42);
        ctx.rotate(-0.55);
        ctx.fillStyle = rgba(C.amberSoft, 0.45);
        ctx.beginPath();
        ctx.ellipse(1.5, -1.5, R * 0.36, R * 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(14,10,10,0.96)";
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 0.36, R * 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        vignette(ctx, w, h, 0.5);
    }
    function facade(ctx, w, h, t) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, rgba(mix(C.violet, C.bg0, 0.55)));
        g.addColorStop(0.55, rgba(mix(C.rose, C.bg0, 0.1)));
        g.addColorStop(0.85, rgba(C.amber));
        g.addColorStop(1, rgba(C.amberSoft));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        glow(ctx, w * 0.82, h * 0.4, h * 0.5, C.amberSoft, 0.5);
        ctx.fillStyle = rgba(C.amberSoft, 0.95);
        circle(ctx, w * 0.82, h * 0.4, h * 0.075);
        ctx.fillStyle = "rgba(255,255,255,0.09)";
        for (let i = 0; i < 3; i++) {
            const x = (((i * 0.37 + t * 0.012) % 1.3) - 0.15) * w;
            ctx.beginPath();
            ctx.ellipse(x, h * (0.18 + i * 0.09), w * 0.16, h * 0.016, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        const dark = "rgba(10,8,14,0.97)";
        const bx = w * 0.06, bw = w * 0.56, by = h * 0.26;
        ctx.fillStyle = dark;
        ctx.fillRect(bx, by, bw, h - by);
        ctx.fillRect(bx - w * 0.01, by - h * 0.03, bw + w * 0.02, h * 0.035);
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 5; col++) {
                const lit = ((row * 5 + col) * 7) % 3 === 0;
                ctx.fillStyle = lit ? rgba(C.amberSoft, 0.8) : "rgba(255,255,255,0.05)";
                ctx.fillRect(bx + bw * (0.07 + col * 0.18), by + h * (0.07 + row * 0.13), bw * 0.1, h * 0.07);
            }
        }
        const sy = h * 0.74;
        ctx.fillStyle = rgba(C.amber, 0.92);
        ctx.fillRect(bx + bw * 0.08, sy, bw * 0.55, h * 0.2);
        glow(ctx, bx + bw * 0.35, sy + h * 0.1, h * 0.3, C.amber, 0.25);
        ctx.fillStyle = rgba(C.rose, 0.95);
        ctx.fillRect(bx + bw * 0.12, sy - h * 0.085, bw * 0.47, h * 0.06);
        if (h > 40) {
            ctx.fillStyle = "#fff";
            ctx.font = `700 ${Math.max(7, h * 0.045)}px ${F.display}`;
            ctx.textBaseline = "middle";
            ctx.textAlign = "center";
            ctx.fillText("DISCOS", bx + bw * 0.355, sy - h * 0.053);
            ctx.textAlign = "left";
        }
        ctx.fillStyle = dark;
        ctx.fillRect(w * 0.66, h * 0.52, w * 0.36, h * 0.48);
        ctx.fillStyle = "rgba(6,5,9,0.9)";
        ctx.fillRect(0, h * 0.95, w, h * 0.05);
        vignette(ctx, w, h, 0.45);
    }
    function shelves(ctx, w, h, t) {
        vgrad(ctx, w, h, mix(C.amber, C.bg0, 0.86), mix(C.amber, C.bg0, 0.96));
        glow(ctx, w * 0.5, -h * 0.1, w * 0.7, C.amberSoft, 0.28);
        const pal = [C.violet, C.cyan, C.amber, C.rose, C.emerald, C.violetSoft, C.amberSoft, C.magenta, C.fg2];
        const off = Math.sin(t * 0.3) * w * 0.03;
        for (let sh = 0; sh < 3; sh++) {
            const base = h * (0.34 + sh * 0.31);
            const r = rng(31 + sh * 7);
            let x = -w * 0.06 + off;
            while (x < w * 1.06) {
                const sw = (0.012 + r() * 0.016) * w;
                const hh = h * (0.2 + r() * 0.06);
                const col = pal[(r() * pal.length) | 0];
                ctx.fillStyle = rgba(mix(col, C.bg0, 0.25 + r() * 0.35), 0.95);
                ctx.fillRect(x, base - hh, Math.max(0.6, sw - 1), hh);
                x += sw + (r() < 0.08 ? w * 0.03 : 0);
            }
            ctx.fillStyle = rgba(mix(C.amber, C.bg0, 0.6));
            ctx.fillRect(0, base, w, h * 0.03);
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(0, base + h * 0.03, w, h * 0.025);
        }
        vignette(ctx, w, h, 0.55);
    }
    const SCENES = {
        ze: interview({ top: mix(C.violet, C.bg0, 0.74), bot: mix(C.violet, C.bg0, 0.94), key: C.amber, kx: 0.2, ky: 0.28, rim: C.amberSoft, bokeh: C.violet, x: 0.64, sc: 1.0, seed: 3 }),
        lia: interview({ top: mix(C.rose, C.bg0, 0.72), bot: mix(C.rose, C.bg0, 0.93), key: C.amberSoft, kx: 0.8, ky: 0.26, rim: C.amberSoft, bokeh: C.rose, x: 0.36, sc: 1.04, seed: 5, window: true }),
        ant: interview({ top: mix(C.cyan, C.bg0, 0.76), bot: mix(C.cyan, C.bg0, 0.94), key: C.cyan, kx: 0.86, ky: 0.3, rim: C.cyanSoft, bokeh: C.emerald, x: 0.56, sc: 1.18, seed: 9 }),
        ze2: interview({ top: mix(C.violet, C.bg0, 0.7), bot: mix(C.magenta, C.bg0, 0.93), key: C.magenta, kx: 0.16, ky: 0.36, rim: C.violetSoft, bokeh: C.amber, x: 0.62, sc: 1.38, seed: 13 }),
        vin: vinyl,
        fac: facade,
        pra: shelves,
    };

    /* ── pausa das animações CSS fora da tela ([data-play]) ─────────────── */
    function initOffscreen() {
        const els = $$("[data-play]");
        if (!els.length || !("IntersectionObserver" in window)) return;
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) e.target.classList.toggle("is-offscreen", !e.isIntersecting);
        }, { rootMargin: "100px 0px" });
        els.forEach((el) => io.observe(el));
    }

    /* ══════════════════════════════════════════════════════════════════════
       ABERTURA — a timeline viva (canvas 2D) e o monitor de programa
       Ciclo: os clipes chegam → a agulha toca e para → o talho de laser corta
       → o pedaço sai e o ripple fecha o vão → a IA propõe um ghost clip na V2
       → aprovado, vira clipe → toca até o fim → "exporta" e recomeça.
       ══════════════════════════════════════════════════════════════════════ */
    function initHero() {
        const hero = $("[data-hero]");
        if (!hero) return;
        const tlCanvas = $("[data-hero-timeline]", hero);
        const monCanvas = $("[data-hero-monitor]", hero);
        if (!tlCanvas || !monCanvas || !tlCanvas.getContext) return;
        const tcEl = $("[data-hero-tc]", hero);
        const transportEl = $("[data-hero-transport]", hero);
        const statusEl = $("[data-hero-status]", hero);
        const tools = $$(".nle-tool", hero);

        const CYCLE = 13.2, VIEW = 60, CUT = 22, CUT_END = 30, DELTA = 8, END_PH = 47;
        const INTRO = 0.45, STATIC_T = 8.3; // quadro parado: ghost clip à espera de aprovação
        const P = {
            play1: [1.55, 4.5], laser: [4.7, 5.4], split: 4.9, tint: [5.12, 5.4], lift: [5.42, 5.95],
            ripple: [6.0, 6.8], ghost: [6.95, 7.4], bubble: [7.35, 9.25], cursor: [7.8, 8.6], press: [8.6, 8.84],
            approve: [8.84, 9.3], play2: [9.75, 11.95], out: [12.1, 12.85],
        };
        const V1 = [
            { id: "ze", s: 0, e: 13, title: "Zé: Crítica ao primeiro corte", who: "Zé", scene: "ze" },
            { id: "lia", s: 13, e: 30, title: "Dona Lia: A loja em 1985", who: "Dona Lia", scene: "lia" },
            { id: "ant", s: 30, e: 43, title: "Seu Antônio: O último disco", who: "Seu Antônio", scene: "ant" },
            { id: "ze2", s: 43, e: 58, title: "Zé: Por que guardar tudo", who: "Zé", scene: "ze2" },
        ];
        const V2 = [
            { id: "vin", s: 5, e: 11, title: "Detalhe das mãos no vinil", scene: "vin" },
            { id: "fac", s: 42, e: 47, title: "Fachada da loja ao entardecer", scene: "fac" },
        ];
        const GH = { id: "pra", s: 19, e: 25, title: "Prateleiras de discos", scene: "pra" };
        const MUS = { s: 0, e: 58, title: "Trilha: violão e chuva", order: 6 };
        V1.forEach((c, i) => { c.wave = speechWave(101 + i * 17, c.e - c.s + 1); c.order = i; });
        V2.forEach((c, i) => { c.order = 4 + i; });
        MUS.wave = musicWave(77, MUS.e - MUS.s + 1);

        const STY = {
            V1: { top: mix(C.violet, C.bg0, 0.18), bot: mix(C.violet, C.bg0, 0.5), line: C.violetSoft },
            V2: { top: mix(C.cyan, C.bg0, 0.4), bot: mix(C.cyan, C.bg0, 0.64), line: C.cyanSoft },
            A1: { top: mix(C.emerald, C.bg0, 0.7), bot: mix(C.emerald, C.bg0, 0.8), line: C.emerald, wave: C.emeraldSoft },
            A2: { top: mix(C.amber, C.bg0, 0.72), bot: mix(C.amber, C.bg0, 0.82), line: C.amber, wave: C.amberSoft },
        };

        let TL = null, MON = null, thumbs = {}, lastScene = null;

        function layout() {
            const a = T.fitCanvas(tlCanvas);
            const W = a.width, H = a.height, narrow = W < 620;
            const head = narrow ? 30 : 58, ruler = narrow ? 20 : 24, padR = narrow ? 6 : 12, gap = narrow ? 3 : 4;
            const weights = [1.0, 1.12, 1.0, 0.8];
            const sum = weights.reduce((s, w) => s + w, 0);
            const avail = H - ruler - gap * 5;
            let y = ruler + gap;
            const tr = weights.map((w) => { const h = Math.floor((avail * w) / sum); const t = { y, h }; y += h + gap; return t; });
            const x0 = head + (narrow ? 4 : 8);
            TL = { ctx: a.ctx, W, H, dpr: a.dpr, narrow, head, ruler, tr, gap, x0, pps: (W - x0 - padR) / VIEW };
            const m = T.fitCanvas(monCanvas);
            MON = { ctx: m.ctx, W: m.width, H: m.height, dpr: m.dpr };
            buildThumbs();
        }
        function buildThumbs() { // miniaturas das cenas no começo dos clipes de vídeo
            thumbs = {};
            if (TL.narrow) return;
            [[0, [...V2.map((c) => c.scene), GH.scene]], [1, V1.map((c) => c.scene)]].forEach(([ti, ids]) => {
                const th = Math.max(16, TL.tr[ti].h - 8), tw = Math.round((th * 16) / 9);
                ids.forEach((id) => {
                    const cv = document.createElement("canvas");
                    cv.width = Math.max(1, Math.round(tw * TL.dpr));
                    cv.height = Math.max(1, Math.round(th * TL.dpr));
                    const c = cv.getContext("2d");
                    c.scale(TL.dpr, TL.dpr);
                    SCENES[id](c, tw, th, 0.6);
                    thumbs[id] = { cv, w: tw, h: th };
                });
            });
        }

        const arrT = (ct, i) => seg(ct, 0.05 + i * 0.11, 0.65 + i * 0.11);
        const arr = (ct, i) => ease.out(arrT(ct, i));
        const arrDy = (ct, i) => -12 * (1 - ease.out(arrT(ct, i)));
        const waveAmp = (ct, i) => ease.out(seg(ct, 0.35 + i * 0.11, 1.05 + i * 0.11));
        const durLabel = (d) => { const s = Math.round(d); return `00:00:${String(s).padStart(2, "0")}:00`; };
        const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

        function playhead(ct) {
            if (ct < P.play1[0] || ct >= P.out[1]) return 0; // no intervalo entre ciclos, a agulha volta ao zero
            if (ct < P.play1[1]) return CUT * (1 - Math.pow(1 - seg(ct, P.play1[0], P.play1[1]), 1.6));
            if (ct < P.play2[0]) return CUT;
            if (ct < P.play2[1]) return lerp(CUT, END_PH, seg(ct, P.play2[0], P.play2[1]));
            return END_PH;
        }
        function state(ct) {
            return {
                ct,
                ph: playhead(ct),
                rip: ease.inOut(seg(ct, P.ripple[0], P.ripple[1])),
                split: ct >= P.split,
                gap: 3 * ease.out(seg(ct, P.split, P.split + 0.25)),
                tint: seg(ct, P.tint[0], P.tint[1]),
                lift: seg(ct, P.lift[0], P.lift[1]),
                gIn: ease.out(seg(ct, P.ghost[0], P.ghost[1])),
                appr: ease.inOut(seg(ct, P.approve[0], P.approve[1])),
                out: seg(ct, P.out[0], P.out[1]),
            };
        }

        /* desenho dos clipes */
        function clipBox(x, y, w, h, sty, alpha) {
            const ctx = TL.ctx;
            if (w <= 0.5 || alpha <= 0.004) return false;
            ctx.globalAlpha = alpha;
            const g = ctx.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, rgba(sty.top));
            g.addColorStop(1, rgba(sty.bot));
            rr(ctx, x, y, w, h, 5);
            ctx.fillStyle = g;
            ctx.fill();
            rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 4.5);
            ctx.lineWidth = 1;
            ctx.strokeStyle = rgba(sty.line, 0.6);
            ctx.stroke();
            if (w > 10) { ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x + 5, y + 1, w - 10, 1); }
            return true;
        }
        function videoClip(c, x, w, tri, alpha, o = {}) {
            const ctx = TL.ctx, tr = TL.tr[tri];
            const y = tr.y + 1 + (o.dy || 0), h = tr.h - 2;
            if (!clipBox(x, y, w, h, tri === 0 ? STY.V2 : STY.V1, alpha)) return;
            ctx.save();
            rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
            ctx.clip();
            let tx = x + 7;
            const th = thumbs[c.scene];
            if (th && w > th.w + 64) {
                ctx.globalAlpha = alpha;
                ctx.drawImage(th.cv, x + 3, y + (h - th.h) / 2, th.w, th.h);
                tx = x + th.w + 10;
            }
            ctx.globalAlpha = alpha;
            ctx.textBaseline = "alphabetic";
            ctx.font = `600 ${TL.narrow ? 10 : 12}px ${F.body}`;
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            const maxW = x + w - tx - 6;
            const ty = TL.narrow ? y + 13 : y + Math.min(19, h * 0.42);
            ctx.fillText(fitText(ctx, c.title, maxW), tx, ty);
            if (!TL.narrow && h > 38) {
                ctx.font = `500 10px ${F.mono}`;
                ctx.fillStyle = "rgba(255,255,255,0.55)";
                ctx.fillText(fitText(ctx, durLabel(o.dur != null ? o.dur : c.e - c.s), maxW), tx, ty + 15);
            }
            if (o.tint) { ctx.fillStyle = rgba(C.rose, 0.42 * o.tint); ctx.fillRect(x, y, w, h); }
            ctx.restore();
        }
        function drawWave(ctx, x, y, w, h, data, srcIn, col, alpha, amp) {
            if (amp <= 0.01) return;
            const mid = y + h / 2, maxA = h / 2 - 1, pps = TL.pps, step = 2;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = rgba(col, 0.88);
            ctx.beginPath();
            for (let px = 2; px < w - 2; px += step) {
                const i0 = Math.max(0, Math.floor((srcIn + px / pps) * RATE));
                const i1 = Math.min(data.length, Math.max(i0 + 1, Math.floor((srcIn + (px + step) / pps) * RATE)));
                let a = 0;
                for (let i = i0; i < i1; i++) if (data[i] > a) a = data[i];
                const bh = Math.max(0.6, a * amp * maxA);
                ctx.rect(x + px, mid - bh, 1.2, bh * 2);
            }
            ctx.fill();
        }
        function audioClip(x, w, tri, alpha, sty, wave, srcIn, amp, label, o = {}) {
            const ctx = TL.ctx, tr = TL.tr[tri];
            const y = tr.y + 1 + (o.dy || 0), h = tr.h - 2;
            if (!clipBox(x, y, w, h, sty, alpha)) return;
            ctx.save();
            rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
            ctx.clip();
            const showLabel = label && !TL.narrow && h > 30;
            const wy = showLabel ? y + 14 : y + 2, wh = showLabel ? h - 16 : h - 4;
            drawWave(ctx, x, wy, w, wh, wave, srcIn, sty.wave, alpha, amp);
            if (showLabel) {
                ctx.globalAlpha = alpha;
                ctx.font = `600 10px ${F.body}`;
                ctx.fillStyle = "rgba(255,255,255,0.78)";
                ctx.textBaseline = "alphabetic";
                ctx.fillText(fitText(ctx, label, w - 14), x + 7, y + 11);
            }
            if (o.tint) { ctx.globalAlpha = alpha; ctx.fillStyle = rgba(C.rose, 0.42 * o.tint); ctx.fillRect(x, y, w, h); }
            ctx.restore();
        }

        /* pistas, cabeçalhos e régua */
        function drawLanes() {
            const { ctx, W, tr, x0 } = TL;
            tr.forEach((t, i) => {
                ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.022)" : "rgba(255,255,255,0.036)";
                ctx.fillRect(x0 - 4, t.y, W - x0 + 4, t.h);
            });
            ctx.fillStyle = "rgba(255,255,255,0.09)";
            ctx.fillRect(0, tr[2].y - TL.gap / 2 - 0.5, W, 1);
        }
        function drawHeaders() {
            const { ctx, tr, head, narrow } = TL;
            const names = ["V2", "V1", "A1", "A2"];
            const cols = [C.cyan, C.violet, C.emerald, C.amber];
            ctx.textBaseline = "middle";
            tr.forEach((t, i) => {
                ctx.globalAlpha = 1;
                ctx.fillStyle = "rgba(255,255,255,0.035)";
                rr(ctx, 2, t.y, head - 4, t.h, 6);
                ctx.fill();
                ctx.fillStyle = rgba(cols[i], 0.9);
                ctx.fillRect(2, t.y + 6, 2, Math.max(2, t.h - 12));
                ctx.font = `600 ${narrow ? 9 : 11}px ${F.mono}`;
                ctx.fillStyle = rgba(C.fg2);
                ctx.fillText(names[i], narrow ? 8 : 11, t.y + t.h / 2 + 0.5);
                if (narrow) return;
                const ix = head - 17, iy = t.y + t.h / 2;
                ctx.strokeStyle = rgba(C.fg3);
                ctx.fillStyle = rgba(C.fg3);
                ctx.lineWidth = 1.2;
                if (i < 2) { // olho
                    ctx.beginPath();
                    ctx.ellipse(ix, iy, 5.5, 3.4, 0, 0, Math.PI * 2);
                    ctx.stroke();
                    circle(ctx, ix, iy, 1.5);
                } else { // alto-falante
                    ctx.beginPath();
                    ctx.moveTo(ix - 5, iy - 2); ctx.lineTo(ix - 2.5, iy - 2); ctx.lineTo(ix + 0.5, iy - 4.5);
                    ctx.lineTo(ix + 0.5, iy + 4.5); ctx.lineTo(ix - 2.5, iy + 2); ctx.lineTo(ix - 5, iy + 2);
                    ctx.closePath();
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(ix + 1.5, iy, 4, -0.8, 0.8);
                    ctx.stroke();
                }
            });
        }
        function drawRuler() {
            const { ctx, W, ruler, narrow, x0, pps } = TL;
            ctx.globalAlpha = 1;
            ctx.fillStyle = "rgba(255,255,255,0.03)";
            ctx.fillRect(0, 0, W, ruler);
            ctx.fillStyle = "rgba(255,255,255,0.1)";
            ctx.fillRect(0, ruler - 1, W, 1);
            const minor = narrow ? 2 : 1, major = narrow ? 10 : 5;
            ctx.font = `500 ${narrow ? 8.5 : 10}px ${F.mono}`;
            ctx.textBaseline = "middle";
            for (let sec = 0; sec <= VIEW; sec += minor) {
                const x = Math.round(x0 + sec * pps) + 0.5;
                const isMaj = sec % major === 0;
                ctx.fillStyle = isMaj ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.14)";
                const h = isMaj ? 8 : 4;
                ctx.fillRect(x - 0.5, ruler - 1 - h, 1, h);
                if (isMaj && sec < VIEW) {
                    ctx.fillStyle = rgba(C.fg3);
                    ctx.fillText(narrow ? mmss(sec) : T.timecode(sec), x + 4, ruler / 2 - 2);
                }
            }
        }

        /* o ghost clip da IA, o balão de aprovação e o cursor */
        function sparkle(ctx, cx, cy, r, fill) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - r);
            ctx.quadraticCurveTo(cx, cy, cx + r, cy);
            ctx.quadraticCurveTo(cx, cy, cx, cy + r);
            ctx.quadraticCurveTo(cx, cy, cx - r, cy);
            ctx.quadraticCurveTo(cx, cy, cx, cy - r);
            ctx.fillStyle = fill;
            ctx.fill();
        }
        function drawGhost(s, X, fade) {
            if (s.gIn <= 0.004) return;
            const { ctx, tr, narrow } = TL;
            const t0 = tr[0];
            const x = X(GH.s), w = (GH.e - GH.s) * TL.pps;
            const y = t0.y + 1, h = t0.h - 2;
            const a = s.gIn * fade;
            if (s.appr < 1) {
                const sc = 0.94 + 0.06 * s.gIn;
                ctx.save();
                ctx.globalAlpha = a * (1 - s.appr);
                ctx.translate(x + w / 2, y + h / 2);
                ctx.scale(sc, sc);
                ctx.translate(-(x + w / 2), -(y + h / 2));
                rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 5);
                ctx.fillStyle = rgba(C.violet, 0.18);
                ctx.fill();
                ctx.setLineDash([5, 4]);
                ctx.lineDashOffset = -s.ct * 14;
                ctx.lineWidth = 1.4;
                ctx.strokeStyle = rgba(C.violetSoft, 0.95);
                ctx.stroke();
                ctx.setLineDash([]);
                rr(ctx, x + 1, y + 1, w - 2, h - 2, 4);
                ctx.clip();
                const ly = y + (narrow ? 13 : 17);
                sparkle(ctx, x + 10, ly - 4, narrow ? 3.5 : 4.5, rgba(C.violetSoft));
                ctx.font = `600 ${narrow ? 10 : 11.5}px ${F.body}`;
                ctx.fillStyle = rgba(C.violetSoft);
                ctx.textBaseline = "alphabetic";
                ctx.fillText(fitText(ctx, narrow ? "IA" : `IA · ${GH.title}`, w - 26), x + 18, ly);
                if (!narrow && h > 38) {
                    ctx.font = `500 10px ${F.mono}`;
                    ctx.fillStyle = rgba(C.violetSoft, 0.7);
                    ctx.fillText(fitText(ctx, "ghost clip · rascunho", w - 26), x + 18, ly + 15);
                }
                ctx.restore();
            }
            if (s.appr > 0) videoClip(GH, x, w, 0, a * s.appr);
        }
        function drawCursor(ctx, x, y, sc, a) {
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(x, y);
            ctx.scale(sc, sc);
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(0, 15); ctx.lineTo(4, 11.5); ctx.lineTo(6.8, 17.5);
            ctx.lineTo(9.2, 16.4); ctx.lineTo(6.5, 10.6); ctx.lineTo(11.5, 10.6);
            ctx.closePath();
            ctx.fillStyle = "#fff";
            ctx.fill();
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = "rgba(7,6,11,0.9)";
            ctx.stroke();
            ctx.restore();
        }
        function drawBubble(s, X, fade) {
            const ct = s.ct;
            const pin = seg(ct, P.bubble[0], P.bubble[0] + 0.42);
            const pout = seg(ct, P.approve[0] + 0.08, P.bubble[1]);
            const a = Math.min(1, pin * 1.4) * (1 - pout) * fade;
            if (a <= 0.01) return;
            const { ctx, tr, narrow } = TL;
            const t0 = tr[0];
            const bx = X(GH.e) + 10;
            const bh = Math.min(t0.h - 8, 32);
            const by = t0.y + (t0.h - bh) / 2;
            const cy = by + bh / 2;
            ctx.font = `600 11px ${F.body}`;
            const q = narrow ? "" : "Cobrir o corte?";
            const qW = q ? ctx.measureText(q).width + 12 : 0;
            ctx.font = `700 11px ${F.body}`;
            const btnW = ctx.measureText("Aprovar").width + 30;
            const bw = 8 + qW + btnW + 5;
            const btx = bx + 8 + qW, bty = by + 4, bth = bh - 8;
            const pressed = ct >= P.press[0] && ct < P.approve[1];
            ctx.save();
            ctx.globalAlpha = a;
            const sc = 0.8 + 0.2 * ease.back(pin);
            ctx.translate(bx, cy);
            ctx.scale(sc, sc);
            ctx.translate(-bx, -cy);
            ctx.beginPath();
            ctx.moveTo(bx + 1, cy - 5); ctx.lineTo(bx - 5, cy); ctx.lineTo(bx + 1, cy + 5);
            ctx.closePath();
            ctx.fillStyle = rgba(C.violetSoft, 0.6);
            ctx.fill();
            rr(ctx, bx, by, bw, bh, 9);
            ctx.fillStyle = rgba(mix(C.bg2, C.violet, 0.08), 0.97);
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = rgba(C.violetSoft, 0.55);
            ctx.stroke();
            ctx.textBaseline = "middle";
            if (q) {
                ctx.font = `600 11px ${F.body}`;
                ctx.fillStyle = rgba(C.fg1, 0.92);
                ctx.fillText(q, bx + 10, cy + 0.5);
            }
            rr(ctx, btx, bty, btnW, bth, bth / 2);
            ctx.fillStyle = pressed ? rgba(C.emerald, 0.95) : rgba(C.emerald, 0.18);
            ctx.fill();
            ctx.strokeStyle = rgba(C.emerald, 0.85);
            ctx.stroke();
            const ink = pressed ? rgba(C.bg0) : rgba(C.emeraldSoft);
            ctx.strokeStyle = ink;
            ctx.lineWidth = 1.8;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.beginPath();
            ctx.moveTo(btx + 6.5, cy); ctx.lineTo(btx + 9, cy + 2.6); ctx.lineTo(btx + 14, cy - 3);
            ctx.stroke();
            ctx.font = `700 11px ${F.body}`;
            ctx.fillStyle = ink;
            ctx.fillText("Aprovar", btx + 19, cy + 0.5);
            ctx.restore();
            const cp = seg(ct, P.cursor[0], P.cursor[1]);
            if (cp > 0 && ct < P.approve[1] + 0.25) {
                const tx = btx + btnW * 0.55, ty = cy + 2;
                const k = ease.inOut(cp);
                const clickS = ct >= P.press[0] && ct < P.press[1] ? 0.86 : 1;
                const ca = a * Math.min(1, cp * 3) * (1 - seg(ct, P.approve[1], P.approve[1] + 0.25));
                drawCursor(ctx, lerp(tx + 70, tx, k), lerp(ty + 44, ty, k), clickS, ca);
            }
        }
        function drawApproveRing(s, X, fade) {
            const p = seg(s.ct, P.approve[0], P.approve[0] + 0.6);
            if (p <= 0 || p >= 1) return;
            const { ctx, tr } = TL;
            ctx.globalAlpha = (1 - p) * fade;
            ctx.strokeStyle = rgba(C.emerald);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(X((GH.s + GH.e) / 2), tr[0].y + tr[0].h / 2, 6 + p * 48, 0, Math.PI * 2);
            ctx.stroke();
        }

        /* o talho: laser, faíscas, marca do corte, agulha */
        const sparks = [];
        function emit(x, y, n, power) {
            for (let i = 0; i < n; i++) {
                const dir = Math.random() < 0.5 ? -1 : 1;
                sparks.push({
                    x, y,
                    vx: dir * (40 + Math.random() * 200) * power,
                    vy: -(20 + Math.random() * 190) * power,
                    life: 0, max: 0.3 + Math.random() * 0.5, size: 0.8 + Math.random() * 1.5,
                });
            }
            if (sparks.length > 260) sparks.splice(0, sparks.length - 260);
        }
        function stepSparks(dt) {
            for (let i = sparks.length - 1; i >= 0; i--) {
                const p = sparks[i];
                p.life += dt;
                if (p.life >= p.max) { sparks.splice(i, 1); continue; }
                p.vy += 560 * dt;
                p.vx *= 1 - Math.min(1, 1.4 * dt);
                p.x += p.vx * dt;
                p.y += p.vy * dt;
            }
        }
        function drawSparks() {
            if (!sparks.length) return;
            const ctx = TL.ctx;
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "lighter";
            ctx.lineCap = "round";
            for (const p of sparks) {
                const k = 1 - p.life / p.max;
                const col = k > 0.62 ? WHITE : k > 0.3 ? C.amberSoft : C.rose;
                ctx.strokeStyle = rgba(col, Math.min(1, k * 1.3));
                ctx.lineWidth = p.size;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 0.016, p.y - p.vy * 0.016);
                ctx.stroke();
            }
            ctx.restore();
        }
        function drawLaser(s, X) {
            const ct = s.ct;
            if (ct < P.laser[0] || ct > P.laser[1]) return;
            const { ctx, tr, ruler } = TL;
            const x = X(CUT);
            const top = ruler, bottom = tr[2].y + tr[2].h + 2;
            const yEnd = lerp(top, bottom, ease.out(seg(ct, P.laser[0], P.split)));
            const f = 1 - seg(ct, P.split + 0.18, P.laser[1]);
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = rgba(C.cyan, 0.16 * f);
            ctx.fillRect(x - 9, top, 18, yEnd - top);
            ctx.fillStyle = rgba(C.violet, 0.34 * f);
            ctx.fillRect(x - 4, top, 8, yEnd - top);
            ctx.fillStyle = `rgba(255,255,255,${0.95 * f})`;
            ctx.fillRect(x - 1.2, top, 2.4, yEnd - top);
            const rg = ctx.createRadialGradient(x, yEnd, 0, x, yEnd, 20);
            rg.addColorStop(0, `rgba(255,255,255,${0.95 * f})`);
            rg.addColorStop(0.35, rgba(C.cyan, 0.5 * f));
            rg.addColorStop(1, rgba(C.cyan, 0));
            ctx.fillStyle = rg;
            ctx.fillRect(x - 20, yEnd - 20, 40, 40);
            ctx.restore();
        }
        function drawCutMark(s, X, fade) {
            if (!s.split) return;
            const { ctx, ruler } = TL;
            const x = X(CUT);
            ctx.globalAlpha = fade * 0.95;
            ctx.fillStyle = rgba(C.rose);
            ctx.beginPath();
            ctx.moveTo(x, ruler - 1); ctx.lineTo(x - 4.5, ruler - 7); ctx.lineTo(x + 4.5, ruler - 7);
            ctx.closePath();
            ctx.fill();
        }
        function drawPlayhead(s, X, fade) {
            if (fade <= 0.004) return;
            const { ctx, ruler, H } = TL;
            const x = Math.round(X(s.ph)) + 0.5;
            ctx.globalAlpha = fade;
            ctx.fillStyle = rgba(C.rose, 0.16);
            ctx.fillRect(x - 3.5, ruler, 7, H - ruler);
            ctx.fillStyle = rgba(C.rose);
            ctx.fillRect(x - 1, ruler - 3, 2, H - ruler + 3);
            ctx.beginPath();
            ctx.moveTo(x - 6, 3); ctx.lineTo(x + 6, 3); ctx.lineTo(x + 6, ruler - 9); ctx.lineTo(x, ruler - 2); ctx.lineTo(x - 6, ruler - 9);
            ctx.closePath();
            ctx.fill();
        }

        function drawTimeline(s) {
            const { ctx, W, H, x0, pps } = TL;
            ctx.setTransform(TL.dpr, 0, 0, TL.dpr, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.clearRect(0, 0, W, H);
            drawLanes();
            drawHeaders();
            drawRuler();
            const fade = 1 - s.out;
            const slide = ease.inOut(s.out) * 48; // no fim, a sequência "sai" para o editor
            const X = (sec) => x0 + sec * pps + slide;
            if (fade > 0.004) {
                // A2 — trilha (encolhe junto com o ripple)
                const ma = arr(s.ct, MUS.order) * fade;
                const me = MUS.e - DELTA * s.rip;
                audioClip(X(MUS.s), (me - MUS.s) * pps, 3, ma, STY.A2, MUS.wave, 0, waveAmp(s.ct, MUS.order), MUS.title, { dy: arrDy(s.ct, MUS.order) });
                // V1 + A1 (vinculados)
                for (const c of V1) {
                    const a = arr(s.ct, c.order) * fade;
                    if (a <= 0.004) continue;
                    const dy = arrDy(s.ct, c.order);
                    const amp = waveAmp(s.ct, c.order);
                    if (c.id === "lia" && s.split) {
                        const g = s.gap;
                        const wl = (CUT - c.s) * pps - g / 2;
                        videoClip(c, X(c.s), wl, 1, a, { dy, dur: CUT - c.s });
                        audioClip(X(c.s), wl, 2, a, STY.A1, c.wave, 0, amp, c.who, { dy });
                        const la = a * (1 - s.lift);
                        if (la > 0.004) { // o pedaço que sai
                            const ldy = -16 * ease.out(s.lift);
                            const wr = (c.e - CUT) * pps - g / 2;
                            videoClip(c, X(CUT) + g / 2, wr, 1, la, { dy: ldy, tint: s.tint, dur: c.e - CUT });
                            audioClip(X(CUT) + g / 2, wr, 2, la, STY.A1, c.wave, CUT - c.s, amp, c.who, { dy: ldy, tint: s.tint });
                        }
                    } else {
                        const off = c.s >= CUT_END ? -DELTA * s.rip : 0;
                        const w = (c.e - c.s) * pps;
                        videoClip(c, X(c.s + off), w, 1, a, { dy });
                        audioClip(X(c.s + off), w, 2, a, STY.A1, c.wave, 0, amp, c.who, { dy });
                    }
                }
                // V2 — planos de cobertura (B-roll)
                for (const c of V2) {
                    const off = c.s >= CUT_END ? -DELTA * s.rip : 0;
                    videoClip(c, X(c.s + off), (c.e - c.s) * pps, 0, arr(s.ct, c.order) * fade, { dy: arrDy(s.ct, c.order) });
                }
                drawGhost(s, X, fade);
                drawCutMark(s, X, fade);
            }
            drawLaser(s, X);
            drawSparks();
            drawPlayhead(s, X, fade);
            drawBubble(s, X, fade);
            drawApproveRing(s, X, fade);
            ctx.globalAlpha = 1;
        }

        /* monitor de programa */
        function programAt(s) {
            const ph = s.ph;
            if (ph >= GH.s && ph < GH.e) {
                if (s.gIn > 0.3 && s.appr < 0.5) return { scene: GH.scene, title: GH.title, preview: true };
                if (s.appr >= 0.5) return { scene: GH.scene, title: GH.title };
            }
            for (const c of V2) {
                const off = c.s >= CUT_END ? -DELTA * s.rip : 0;
                if (ph >= c.s + off && ph < c.e + off) return { scene: c.scene, title: c.title };
            }
            for (const c of V1) {
                if (c.id === "lia") {
                    if (ph >= c.s && ph < (s.lift >= 0.5 ? CUT : c.e)) return { scene: c.scene, title: c.title };
                    continue;
                }
                const off = c.s >= CUT_END ? -DELTA * s.rip : 0;
                if (ph >= c.s + off && ph < c.e + off) return { scene: c.scene, title: c.title };
            }
            return null;
        }
        function tag(ctx, text, x, y, col, a) {
            ctx.globalAlpha = a;
            ctx.font = `700 10px ${F.mono}`;
            const tw = ctx.measureText(text).width;
            rr(ctx, x, y, tw + 16, 20, 5);
            ctx.fillStyle = rgba(col, 0.9);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.textBaseline = "middle";
            ctx.fillText(text, x + 8, y + 10.5);
        }
        function titleChip(ctx, cur, W, H, a) { // o título dado pela IA, no canto do quadro
            const fs = W < 420 ? 10 : 12;
            ctx.font = `600 ${fs}px ${F.body}`;
            const text = fitText(ctx, cur.title, W * 0.62);
            if (!text) return;
            const tw = ctx.measureText(text).width;
            const ch = fs + 12, x = 12, y = H - 12 - ch;
            ctx.globalAlpha = a;
            rr(ctx, x, y, tw + 18 + 25, ch, 6);
            ctx.fillStyle = "rgba(7,6,11,0.74)";
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            ctx.stroke();
            rr(ctx, x + 7, y + (ch - 14) / 2, 18, 14, 3);
            ctx.fillStyle = rgba(C.violet, 0.38);
            ctx.fill();
            ctx.textBaseline = "middle";
            ctx.font = `700 8.5px ${F.mono}`;
            ctx.fillStyle = rgba(C.violetSoft);
            ctx.fillText("IA", x + 10.5, y + ch / 2 + 0.5);
            ctx.font = `600 ${fs}px ${F.body}`;
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            ctx.fillText(text, x + 32, y + ch / 2 + 0.5);
        }
        function slash(ctx, W, H, p) { // o talho atravessa a imagem, como no logo
            const k = ease.out(Math.min(1, p * 2.2));
            const f = 1 - seg(p, 0.45, 1);
            const x1 = -W * 0.05, y1 = H * 0.86, x2 = W * 1.05, y2 = H * 0.14;
            ctx.save();
            ctx.globalAlpha = f;
            ctx.globalCompositeOperation = "lighter";
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(lerp(x1, x2, k), lerp(y1, y2, k));
            ctx.strokeStyle = rgba(C.violet, 0.5);
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.strokeStyle = rgba(C.cyan, 0.55);
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,255,255,0.95)";
            ctx.lineWidth = 1.6;
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 0.14 * (1 - seg(p, 0, 0.5)); // um clarão suave, uma vez só
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, W, H);
            ctx.globalAlpha = 1;
        }
        function drawMonitor(s) {
            const { ctx, W, H } = MON;
            ctx.setTransform(MON.dpr, 0, 0, MON.dpr, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, W, H);
            const vis = arr(s.ct, 0) * (1 - s.out);
            let cur = programAt(s);
            let held = false;
            if (cur) lastScene = cur;
            else if (lastScene) { cur = lastScene; held = true; } // no vão do corte, o quadro fica escuro
            if (cur && vis > 0.003) {
                ctx.save();
                ctx.globalAlpha = vis;
                SCENES[cur.scene](ctx, W, H, s.ct);
                ctx.restore();
                if (held) { ctx.fillStyle = `rgba(0,0,0,${0.62 * vis})`; ctx.fillRect(0, 0, W, H); }
            }
            ctx.globalAlpha = 0.5 * vis; // margens de segurança
            ctx.strokeStyle = "rgba(255,255,255,0.18)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 6]);
            ctx.strokeRect(Math.round(W * 0.05) + 0.5, Math.round(H * 0.05) + 0.5, Math.round(W * 0.9), Math.round(H * 0.9));
            ctx.setLineDash([]);
            if (cur && !held && vis > 0.05) titleChip(ctx, cur, W, H, vis);
            if (cur && cur.preview && !held) {
                ctx.globalAlpha = vis;
                ctx.setLineDash([7, 5]);
                ctx.lineDashOffset = -s.ct * 20;
                ctx.strokeStyle = rgba(C.violetSoft, 0.95);
                ctx.lineWidth = 2;
                ctx.strokeRect(3, 3, W - 6, H - 6);
                ctx.setLineDash([]);
                tag(ctx, "Prévia · sugestão da IA", 12, 12, C.violet, vis);
            }
            const ok = seg(s.ct, P.approve[0], P.approve[0] + 0.05) * (1 - seg(s.ct, P.approve[1], P.approve[1] + 0.9));
            if (ok > 0) {
                ctx.globalAlpha = ok * vis;
                ctx.strokeStyle = rgba(C.emerald);
                ctx.lineWidth = 3;
                ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
                tag(ctx, "Aprovado", 12, 12, C.emerald, ok * vis);
            }
            const cutP = seg(s.ct, P.split - 0.04, P.split + 0.42);
            if (cutP > 0 && cutP < 1) slash(ctx, W, H, cutP);
            ctx.globalAlpha = 1;
        }

        /* textos do painel: estado, ferramenta, transporte e timecode */
        const PHASES = [
            [0, "Montando a sequência", "cyan", null],
            [P.play1[0], "Reproduzindo", "cyan", "play"],
            [P.laser[0] - 0.2, "Corte na agulha", "rose", "cut"],
            [P.lift[0], "Ripple delete: o vão se fecha", "rose", "cut"],
            [P.ghost[0], "A IA sugere cobrir o corte", "violet", "ai"],
            [P.approve[0], "Sugestão aprovada", "emerald", "ai"],
            [P.play2[0], "Reproduzindo", "cyan", "play"],
            [P.out[0] - 0.15, "Exportando para o seu editor", "amber", null],
        ];
        let lastPhase = -1, lastTc = "", lastPlaying = null;
        function updateDom(s) {
            const pct = s.ct >= P.out[1] ? 0 : s.ct;
            let pi = 0;
            for (let i = 0; i < PHASES.length; i++) if (pct >= PHASES[i][0]) pi = i;
            if (pi !== lastPhase && statusEl) {
                lastPhase = pi;
                const [, text, tone, tool] = PHASES[pi];
                statusEl.textContent = text;
                statusEl.dataset.tone = tone;
                if (T.motion.on) {
                    statusEl.classList.remove("is-swap");
                    void statusEl.offsetWidth; // reinicia a animação de troca
                    statusEl.classList.add("is-swap");
                }
                tools.forEach((el) => el.classList.toggle("is-on", el.dataset.tool === tool));
            }
            const tc = T.timecode(s.ph);
            if (tc !== lastTc && tcEl) { lastTc = tc; tcEl.textContent = tc; }
            const playing = (s.ct >= P.play1[0] && s.ct < P.play1[1]) || (s.ct >= P.play2[0] && s.ct < P.play2[1]);
            if (playing !== lastPlaying && transportEl) { lastPlaying = playing; transportEl.dataset.state = playing ? "playing" : "paused"; }
        }

        layout();
        let prevCt = -1;
        const loop = T.loop(hero, (t, dt) => {
            if (!TL || !MON) return;
            const moving = T.motion.on && dt > 0;
            const ct = T.motion.on ? (t < INTRO ? CYCLE - 0.02 : (t - INTRO) % CYCLE) : STATIC_T;
            if (moving) {
                if (prevCt > ct) { sparks.length = 0; lastScene = null; } // novo ciclo
                const x = TL.x0 + CUT * TL.pps;
                if (ct >= P.laser[0] && ct < P.split) {
                    const yTip = lerp(TL.ruler, TL.tr[2].y + TL.tr[2].h, ease.out(seg(ct, P.laser[0], P.split)));
                    emit(x, yTip, 2, 0.55);
                }
                if (prevCt < P.split && ct >= P.split) {
                    emit(x, TL.tr[1].y + TL.tr[1].h / 2, 26, 1);
                    emit(x, TL.tr[2].y + TL.tr[2].h / 2, 16, 0.8);
                }
                stepSparks(dt);
                prevCt = ct;
            } else if (!T.motion.on) {
                sparks.length = 0;
            }
            const s = state(ct);
            drawTimeline(s);
            drawMonitor(s);
            updateDom(s);
        });
        const relayout = () => { layout(); loop.draw(); };
        T.onResize(tlCanvas, relayout);
        T.onResize(monCanvas, relayout);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitCache.clear(); relayout(); });
    }

    /* ══════════════════════════════════════════════════════════════════════
       01 — a folha de contato 100:1 (100 trechos; 1 vai para a tela)
       ══════════════════════════════════════════════════════════════════════ */
    function initRatio() {
        const box = $("[data-ratio]");
        const grid = box && $("[data-ratio-grid]", box);
        if (!grid) return;
        const pick = $(".ratio__pick", box);
        const CHOSEN = 57;
        const r = rng(11);
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 100; i++) {
            const el = document.createElement("span");
            el.className = "ratio__tile";
            el.style.setProperty("--row", String(Math.floor(i / 10)));
            el.style.setProperty("--col", String(i % 10));
            el.style.setProperty("--jit", String(Math.round(r() * 420)));
            const v = r();
            el.dataset.type = v < 0.42 ? "v" : v < 0.7 ? "c" : v < 0.88 ? "e" : "a";
            if (i === CHOSEN) {
                el.classList.add("is-chosen");
                el.dataset.type = "v";
                if (pick) el.appendChild(pick);
            }
            frag.appendChild(el);
        }
        grid.appendChild(frag);
        const CYCLE = 9.6;
        let last = "";
        const set = (v) => { if (v !== last) { last = v; box.dataset.step = v; } };
        T.loop(box, (t) => {
            if (!T.motion.on) { set("3"); return; }
            const ct = t % CYCLE;
            // 0 some · 1 o bruto aparece · 2 a decupagem varre e classifica · 3 sobra um · 4 recomeça
            set(ct < 0.15 ? "0" : ct < 1.5 ? "1" : ct < 4.3 ? "2" : ct < 9.0 ? "3" : "4");
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       01 — a virada: nome de câmera apagado, título por IA digitado
       ══════════════════════════════════════════════════════════════════════ */
    function initRename() {
        const list = $("[data-rename]");
        if (!list) return;
        const rows = $$("[data-rename-row]", list).map((row) => ({
            row, name: $("[data-name]", row), from: row.dataset.from || "", to: row.dataset.to || "", key: "",
        })).filter((r) => r.name);
        if (!rows.length) return;
        const DEL = 0.03, TYPE = 0.05, GAP = 0.5, HOLD = 3.4;
        let acc = 0.6;
        rows.forEach((r) => {
            r.t0 = acc;
            r.t1 = r.t0 + r.from.length * DEL;
            r.t2 = r.t1 + 0.2;
            r.t3 = r.t2 + r.to.length * TYPE;
            acc = r.t3 + GAP;
        });
        const CYCLE = acc + HOLD;
        function render(r, ct) {
            let text, mode;
            if (ct < r.t0) { text = r.from; mode = "file"; }
            else if (ct < r.t1) { text = r.from.slice(0, Math.max(0, r.from.length - Math.floor((ct - r.t0) / DEL))); mode = "del"; }
            else if (ct < r.t2) { text = ""; mode = "type"; }
            else if (ct < r.t3) { text = r.to.slice(0, Math.floor((ct - r.t2) / TYPE)); mode = "type"; }
            else { text = r.to; mode = "done"; }
            const key = `${mode}|${text}`;
            if (key === r.key) return;
            r.key = key;
            r.name.textContent = text;
            if (r.row.dataset.mode !== mode) r.row.dataset.mode = mode;
        }
        T.loop(list, (t) => {
            const ct = T.motion.on ? t % CYCLE : CYCLE;
            rows.forEach((r) => render(r, ct));
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       03 — edição por texto: karaokê, seleção, Shift+E e o trecho na pista
       Roteiro encenado (uma vez, ao aparecer; "Repetir" refaz) e modo livre:
       selecione palavras de verdade e aperte Shift+E ou o botão.
       ══════════════════════════════════════════════════════════════════════ */
    function initDemo() {
        const demo = $("[data-demo]");
        if (!demo) return;
        const body = $("[data-demo-text]", demo);
        const tl = $("[data-demo-tl]", demo);
        if (!body || !tl) return;
        const tcEl = $("[data-demo-tc]", demo);
        const keyShift = $('[data-key="shift"]', demo);
        const keyE = $('[data-key="e"]', demo);
        const laneV = $('[data-lane="v"]', tl);
        const laneA = $('[data-lane="a"]', tl);
        const playheadEl = $("[data-demo-playhead]", tl);
        const live = $("[data-demo-live]", demo);
        const btnReplay = $("[data-demo-replay]", demo);
        const btnInsert = $("[data-demo-insert]", demo);
        if (!laneV || !laneA) return;
        const VIEW = 18, BASE_END = 6, SPEED = 2.1, SRC0 = 14 * 60 + 3;

        // 1) quebra as falas em palavras com tempo (como a transcrição palavra a palavra)
        const words = [];
        let clockT = 0.3;
        $$(".tx-turn", body).forEach((turn, ti) => {
            if (ti > 0) clockT += 0.7;
            const who = ($(".tx-turn__who", turn)?.textContent || "").trim();
            const line = $(".tx-turn__line", turn);
            if (!line) return;
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            nodes.forEach((node) => {
                const isTarget = !!(node.parentElement && node.parentElement.closest("[data-target]"));
                const frag = document.createDocumentFragment();
                node.nodeValue.split(/(\s+)/).forEach((p) => {
                    if (!p) return;
                    if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); return; }
                    const el = document.createElement("span");
                    el.className = "w";
                    el.textContent = p;
                    const s = clockT;
                    const e = s + 0.12 + 0.045 * p.replace(/[^\p{L}\d]/gu, "").length;
                    clockT = e + (/[.?!]$/.test(p) ? 0.42 : /[,;:]$/.test(p) ? 0.2 : 0.05);
                    words.push({ el, s, e, text: p, who, target: isTarget, spoken: false, now: false, sel: false });
                    frag.appendChild(el);
                });
                node.parentNode.replaceChild(frag, node);
            });
        });
        if (!words.length) return;
        const target = words.filter((w) => w.target);
        if (!target.length) return;

        const karaoke = (tt) => {
            for (const w of words) {
                const spoken = tt >= w.s;
                const now = tt >= w.s && tt < w.e + 0.06;
                if (w.spoken !== spoken) { w.spoken = spoken; w.el.classList.toggle("is-spoken", spoken); }
                if (w.now !== now) { w.now = now; w.el.classList.toggle("is-now", now); }
            }
        };
        const setSel = (list) => {
            const set = new Set(list);
            for (const w of words) {
                const on = set.has(w);
                if (w.sel !== on) { w.sel = on; w.el.classList.toggle("is-sel", on); }
            }
        };
        const setTc = (tt) => { if (tcEl) tcEl.textContent = T.timecode(SRC0 + Math.max(0, tt)); };
        const keys = (shift, e) => {
            if (keyShift) keyShift.classList.toggle("is-down", !!shift);
            if (keyE) keyE.classList.toggle("is-down", !!e);
        };
        let keyTimer = 0;
        const tapKeys = () => {
            if (!T.motion.on) return;
            clearTimeout(keyTimer);
            keys(true, false);
            keyTimer = setTimeout(() => { keys(true, true); keyTimer = setTimeout(() => keys(false, false), 260); }, 140);
        };

        // 2) a mini-timeline V1/A1
        let cursorEnd = BASE_END;
        const setPlayhead = (t) => { if (playheadEl) playheadEl.style.setProperty("--t", String(Math.round(t * 100) / 100)); };
        const clearClips = () => {
            $$(".tx-tl__clip--new", tl).forEach((el) => el.remove());
            cursorEnd = BASE_END;
            setPlayhead(BASE_END);
        };
        const addClip = (s, e, label, animate) => {
            const v = document.createElement("span");
            v.className = "tx-tl__clip tx-tl__clip--v tx-tl__clip--new";
            v.style.setProperty("--s", String(s));
            v.style.setProperty("--e", String(e));
            v.textContent = label;
            const a = document.createElement("span");
            a.className = "tx-tl__clip tx-tl__clip--a tx-tl__clip--new";
            a.style.setProperty("--s", String(s));
            a.style.setProperty("--e", String(e));
            if (animate && T.motion.on) { v.classList.add("is-landing"); a.classList.add("is-landing"); }
            laneV.appendChild(v);
            laneA.appendChild(a);
            setPlayhead(e);
        };
        const slotRect = (s, e) => {
            const r = laneV.getBoundingClientRect();
            return { left: r.left + (s / VIEW) * r.width, top: r.top + 2, width: Math.max(8, ((e - s) / VIEW) * r.width - 2), height: Math.max(8, r.height - 4) };
        };
        const unionRect = (els) => {
            let l = Infinity, t = Infinity, rgt = -Infinity, b = -Infinity;
            els.forEach((el) => {
                for (const r of el.getClientRects()) {
                    l = Math.min(l, r.left); t = Math.min(t, r.top); rgt = Math.max(rgt, r.right); b = Math.max(b, r.bottom);
                }
            });
            return Number.isFinite(l) && rgt > l && b > t ? { left: l, top: t, width: rgt - l, height: b - t } : null;
        };
        const fly = (from, to, done) => { // o trecho "voa" do texto para a pista
            if (!T.motion.on || !from || !to || typeof demo.animate !== "function") { done(); return; }
            const host = demo.getBoundingClientRect();
            const el = document.createElement("div");
            el.className = "tx-fly";
            el.setAttribute("aria-hidden", "true");
            el.style.left = `${to.left - host.left}px`;
            el.style.top = `${to.top - host.top}px`;
            el.style.width = `${to.width}px`;
            el.style.height = `${to.height}px`;
            demo.appendChild(el);
            const from0 = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
            let finished = false;
            const end = () => { if (finished) return; finished = true; el.remove(); done(); };
            const anim = el.animate([
                { transform: from0, opacity: 0 },
                { transform: from0, opacity: 0.9, offset: 0.14 },
                { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
            ], { duration: 860, easing: "cubic-bezier(.65,0,.25,1)" });
            anim.onfinish = end;
            anim.oncancel = end;
            setTimeout(end, 1500); // garantia, caso a animação não termine
        };
        const labelFor = (ws) => {
            const txt = ws.map((w) => w.text).join(" ");
            const short = txt.length > 34 ? `${txt.slice(0, 32).trimEnd()}…` : txt;
            return `${ws[0].who}: “${short}”`;
        };
        const announce = (msg) => { if (live) { live.textContent = ""; setTimeout(() => { live.textContent = msg; }, 40); } };
        const insert = (ws, animate, quiet) => {
            if (!ws.length) return;
            const d = Math.max(0.8, Math.round((ws[ws.length - 1].e - ws[0].s) * 10) / 10);
            if (cursorEnd + d > VIEW + 0.001) clearClips();
            const at = cursorEnd;
            cursorEnd = at + d;
            const label = labelFor(ws);
            const finish = () => {
                addClip(at, at + d, label, animate);
                if (!quiet) announce(`Trecho inserido na timeline, em V1 e A1: “${ws.map((w) => w.text).join(" ")}”`);
            };
            if (animate) fly(unionRect(ws.map((w) => w.el)), slotRect(at, at + d), finish);
            else finish();
        };

        // 3) o roteiro encenado
        const tEnd = target[target.length - 1].e;
        const S = { k0: 0.2 };
        S.kEnd = S.k0 + tEnd / SPEED + 0.3;
        S.sel0 = S.kEnd + 0.25;
        S.sel1 = S.sel0 + 1.0;
        S.shift = S.sel1 + 0.35;
        S.e = S.shift + 0.25;
        S.up = S.e + 0.35;
        S.fly = S.e + 0.12;
        S.end = S.fly + 1.3;

        let mode = "idle", armed = false, clock = 0, flew = false, selCount = 0;
        const stopKaraoke = () => { body.classList.remove("is-karaoke"); karaoke(-1); };
        const resetForScript = () => {
            clearClips();
            setSel([]);
            keys(false, false);
            body.classList.add("is-karaoke");
            karaoke(-1);
            setTc(0);
            flew = false;
            selCount = 0;
            clock = 0;
        };
        const finalState = () => { // o resultado do roteiro, sem animação
            mode = "idle";
            stopKaraoke();
            keys(false, false);
            setSel(target);
            clearClips();
            insert(target, false, true);
            setTc(target[0].s);
        };
        const step = (c) => {
            if (c < S.kEnd) {
                const tt = (c - S.k0) * SPEED;
                karaoke(tt);
                setTc(tt);
                return;
            }
            if (body.classList.contains("is-karaoke")) stopKaraoke();
            if (c >= S.sel0) {
                const n = Math.min(target.length, Math.floor(((c - S.sel0) / (S.sel1 - S.sel0)) * target.length) + 1);
                if (n !== selCount) { selCount = n; setSel(target.slice(0, n)); setTc(target[n - 1].s); }
            }
            keys(c >= S.shift && c < S.up, c >= S.e && c < S.up);
            if (c >= S.fly && !flew) { flew = true; insert(target, true, false); }
            if (c >= S.end) mode = "idle";
        };
        const leaveScript = () => { // a pessoa assumiu: para o roteiro onde está
            if (mode !== "script") return;
            mode = "idle";
            stopKaraoke();
            keys(false, false);
        };

        if (T.motion.on) { mode = "script"; resetForScript(); }
        else finalState();

        T.onVisible(demo, () => { armed = true; }, { threshold: 0.3, rootMargin: "0px" });
        T.loop(demo, (t, dt) => {
            if (!T.motion.on) { if (mode === "script") finalState(); return; }
            if (mode !== "script" || !armed) return;
            clock += dt;
            step(clock);
        });

        if (btnReplay) {
            btnReplay.addEventListener("click", () => {
                const sel = document.getSelection();
                if (sel && !sel.isCollapsed && sel.anchorNode && body.contains(sel.anchorNode)) sel.removeAllRanges();
                if (!T.motion.on) { finalState(); T.toast("Animações pausadas: o resultado já está na tela."); return; }
                resetForScript();
                mode = "script";
                armed = true;
            });
        }

        // 4) modo livre: seleção de verdade + Shift+E (ou o botão)
        const readSelection = () => {
            const sel = document.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
            const range = sel.getRangeAt(0);
            if (!range.intersectsNode(body) || !/\S/.test(range.toString())) return [];
            return words.filter((w) => range.intersectsNode(w.el));
        };
        let userSel = [], pendingSel = null;
        const updateBtn = () => { if (btnInsert) btnInsert.disabled = !userSel.length; };
        document.addEventListener("selectionchange", () => {
            const ws = readSelection();
            if (!ws.length) { userSel = []; updateBtn(); return; }
            leaveScript();
            userSel = ws;
            setSel(ws);
            updateBtn();
        });
        document.addEventListener("keydown", (e) => {
            if ((e.key !== "E" && e.key !== "e") || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
            const ws = readSelection();
            if (!ws.length) return;
            e.preventDefault();
            leaveScript();
            tapKeys();
            insert(ws, true, false);
        });
        if (btnInsert) {
            btnInsert.addEventListener("mousedown", (e) => e.preventDefault()); // não desfaz a seleção
            btnInsert.addEventListener("pointerdown", () => { const ws = readSelection(); if (ws.length) pendingSel = ws; });
            btnInsert.addEventListener("click", () => {
                const ws = readSelection();
                const use = ws.length ? ws : pendingSel || userSel;
                pendingSel = null;
                if (!use || !use.length) return;
                leaveScript();
                tapKeys();
                insert(use, true, false);
            });
        }
        // clique numa palavra: a agulha pula para ela
        body.addEventListener("click", (e) => {
            const el = e.target.closest && e.target.closest(".w");
            if (!el) return;
            const sel = document.getSelection();
            if (sel && !sel.isCollapsed) return;
            const w = words.find((x) => x.el === el);
            if (!w) return;
            leaveScript();
            karaoke(-1);
            w.now = true;
            w.el.classList.add("is-now");
            setTc(w.s);
        });
    }

    /* ══════════════════════════════════════════════════════════════════════
       04 — grátis: a mensalidade que não para × o Talho no zero
       ══════════════════════════════════════════════════════════════════════ */
    function glowDot(ctx, x, y, col) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
        g.addColorStop(0, rgba(col, 0.55));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 12, y - 12, 24, 24);
        ctx.fillStyle = "#fff";
        circle(ctx, x, y, 2.6);
        ctx.strokeStyle = rgba(col);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.stroke();
    }
    function initPrice() {
        const cv = $("[data-price-chart]");
        if (!cv || !cv.getContext) return;
        const monthEl = $("[data-price-month]");
        const MONTHS = 36, CYCLE = 11.5;
        let L = null, lastM = -1;
        const layout = () => { L = T.fitCanvas(cv); };
        layout();
        function draw(m, fade) {
            const { ctx, width: W, height: H } = L;
            ctx.globalAlpha = 1;
            ctx.clearRect(0, 0, W, H);
            const x0 = 2, x1 = W - 86, y0 = H - 24, y1 = 10;
            const X = (mm) => lerp(x0, x1, mm / MONTHS);
            ctx.strokeStyle = "rgba(255,255,255,0.06)";
            ctx.lineWidth = 1;
            for (let i = 1; i <= 3; i++) {
                const y = Math.round(lerp(y0, y1, i / 3)) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x0, y);
                ctx.lineTo(x1, y);
                ctx.stroke();
            }
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            ctx.fillRect(x0, Math.round(y0), x1 - x0, 1);
            ctx.font = `500 10px ${F.mono}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "center";
            [[12, "1 ano"], [24, "2 anos"], [36, "3 anos"]].forEach(([mm, lab]) => {
                const x = X(mm);
                ctx.fillStyle = "rgba(255,255,255,0.2)";
                ctx.fillRect(Math.round(x), y0, 1, 5);
                ctx.fillStyle = rgba(C.fg3);
                ctx.fillText(lab, x, y0 + 9);
            });
            ctx.textAlign = "left";
            // a mensalidade: um degrau por mês, sem valor de ninguém (só a forma)
            const step = (y0 - y1 - 8) / MONTHS;
            const full = Math.floor(m), frac = m - full;
            const pts = [[X(0), y0]];
            for (let k = 1; k <= full; k++) { const y = y0 - step * k; pts.push([X(k - 1), y], [X(k), y]); }
            if (frac > 0 && full < MONTHS) { const y = y0 - step * (full + 1); pts.push([X(full), y], [X(full + frac), y]); }
            const last = pts[pts.length - 1];
            ctx.globalAlpha = fade;
            const g = ctx.createLinearGradient(0, y1, 0, y0);
            g.addColorStop(0, rgba(C.rose, 0.26));
            g.addColorStop(1, rgba(C.rose, 0.02));
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.lineTo(last[0], y0);
            ctx.closePath();
            ctx.fillStyle = g;
            ctx.fill();
            ctx.beginPath();
            pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.strokeStyle = rgba(C.rose, 0.95);
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
            ctx.stroke();
            if (m > 0.05) {
                glowDot(ctx, last[0], last[1], C.rose);
                ctx.font = `600 11px ${F.body}`;
                ctx.fillStyle = rgba(C.roseSoft);
                ctx.textBaseline = "middle";
                ctx.fillText("e não para", Math.min(last[0] + 10, x1 + 8), Math.max(y1 + 6, last[1]));
            }
            // o Talho: no zero, do mês 1 ao 36
            const xt = X(Math.max(m, 0.001));
            ctx.strokeStyle = rgba(C.emerald);
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.shadowColor = rgba(C.emerald, 0.8);
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(X(0), y0 - 1.5);
            ctx.lineTo(xt, y0 - 1.5);
            ctx.stroke();
            ctx.shadowBlur = 0;
            glowDot(ctx, xt, y0 - 1.5, C.emerald);
            ctx.font = `700 12px ${F.body}`;
            ctx.fillStyle = rgba(C.emeraldSoft);
            ctx.textBaseline = "middle";
            ctx.fillText("Talho: R$ 0", Math.min(xt + 10, x1 + 8), y0 - 13);
            ctx.globalAlpha = 1;
        }
        const loop = T.loop(cv, (t) => {
            if (!L) return;
            let m = MONTHS, fade = 1;
            if (T.motion.on) {
                const ct = t % CYCLE;
                m = clamp((ct - 0.5) / 8.2, 0, 1) * MONTHS;
                fade = 1 - seg(ct, CYCLE - 0.55, CYCLE);
            }
            draw(m, fade);
            const mi = Math.max(1, Math.ceil(m));
            if (mi !== lastM && monthEl) { lastM = mi; monthEl.textContent = `mês ${mi}`; }
        });
        T.onResize(cv, () => { layout(); loop.draw(); });
    }

    /* ══════════════════════════════════════════════════════════════════════
       05 — privacidade: liga e desliga a nuvem opcional
       ══════════════════════════════════════════════════════════════════════ */
    function initPrivacy() {
        const box = $("[data-priv]");
        const btn = box && $("[data-priv-toggle]", box);
        if (!btn) return;
        const stateEl = $("[data-priv-state]", box);
        const live = $("[data-priv-live]", box);
        btn.addEventListener("click", () => {
            const on = btn.getAttribute("aria-pressed") !== "true";
            btn.setAttribute("aria-pressed", String(on));
            box.dataset.cloud = on ? "on" : "off";
            if (stateEl) stateEl.textContent = on ? "ligada" : "desligada";
            const note = $(on ? ".priv__note--on" : ".priv__note--off", box);
            if (live && note) live.textContent = note.textContent;
        });
    }

    /* ── início ─────────────────────────────────────────────────────────── */
    const safe = (fn) => { try { fn(); } catch (err) { console.error(err); } };
    safe(initOffscreen);
    safe(initHero);
    safe(initRatio);
    safe(initRename);
    safe(initDemo);
    safe(initPrice);
    safe(initPrivacy);
    T.pages.inicio = { pronto: true };
})();
