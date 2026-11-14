/* =============================================================================
   CapIAu-Talho — recursos.js
   Página "Recursos": uma demonstração por grupo de recursos. Um módulo por demo;
   todas usam Talho.loop (param fora da tela e com movimento desligado) e, paradas,
   mostram o quadro final legível (o estilo base do CSS).
   ========================================================================== */
(() => {
    "use strict";
    const T = window.Talho;
    if (!T) return;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const { clamp, lerp, easeInOutCubic } = T.math;
    const motionOn = () => T.motion.on;
    const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

    /* reinicia estados sem disparar transições */
    function snap(el, fn) {
        el.classList.add("rc-snap");
        fn();
        void el.offsetWidth;
        requestAnimationFrame(() => el.classList.remove("rc-snap"));
    }

    /* roteiro com marcas de tempo, repetido em ciclos */
    function scene(root, { cycle, cues, reset, final, frame }) {
        cues.sort((a, b) => a[0] - b[0]);
        let n = -1, i = 0, t0 = 0, last = 0, stat = true;
        const lp = T.loop(root, (t, dt) => {
            last = t;
            if (!motionOn()) {
                stat = true;
                root.removeAttribute("data-anim");
                root.classList.remove("rc-out");
                final();
                return;
            }
            if (stat) { stat = false; t0 = t; n = -1; }
            const tt = Math.max(0, t - t0);
            const k = Math.floor(tt / cycle);
            const lt = tt - k * cycle;
            if (k !== n) {
                n = k; i = 0;
                root.setAttribute("data-anim", "");
                snap(root, () => reset(k));
            }
            while (i < cues.length && cues[i][0] <= lt) { cues[i][1](k); i += 1; }
            if (frame) frame(lt, k, dt);
            root.classList.toggle("rc-out", lt < 0.06 || lt > cycle - 0.5);
        });
        return { restart() { t0 = last; n = -1; }, draw: () => lp.draw() };
    }

    function playWhenVisible(el) {
        if (!el) return;
        if (!("IntersectionObserver" in window)) { el.classList.add("is-playing"); return; }
        new IntersectionObserver((es) => es.forEach((e) => el.classList.toggle("is-playing", e.isIntersecting)), { rootMargin: "60px" }).observe(el);
    }

    /* ── Topo: a película ─────────────────────────────────────────────── */
    function initReel() {
        const reel = $("[data-reel]");
        if (!reel) return;
        const track = $("[data-reel-track]", reel);
        const tc = $("[data-reel-tc]", reel);
        const orig = $$(".rc-frame", track);
        const N = orig.length;
        orig.forEach((f) => track.appendChild(f.cloneNode(true)));
        const frames = $$(".rc-frame", track);
        reel.classList.add("rc-reel--live");
        let fw = 1, vw = 0, live = -1, off = 0;
        const measure = () => { fw = frames[0].getBoundingClientRect().width || 1; vw = reel.clientWidth; };
        const place = (x) => {
            const set = fw * N;
            off = ((x % set) + set) % set;
            track.style.transform = `translate3d(${(-off).toFixed(2)}px,0,0)`;
            const center = off + vw / 2;
            const idx = Math.floor(center / fw) % frames.length;
            if (idx !== live) {
                if (frames[live]) frames[live].classList.remove("is-live");
                if (frames[idx]) frames[idx].classList.add("is-live");
                live = idx;
            }
            tc.textContent = T.timecode((center / fw) * 2);
        };
        measure();
        const lp = T.loop(reel, (t, dt) => {
            if (!motionOn()) { place((N + 3.5) * fw - vw / 2); return; }
            place(off + 34 * dt);
        });
        T.onResize(reel, () => { measure(); lp.draw(); });
        place(3.5 * fw - vw / 2);
    }

    /* ── 01 Decupagem ─────────────────────────────────────────────────── */
    function initDecupagem() {
        const root = $("[data-dc]");
        if (!root) return;
        const laser = $("[data-dc-laser]", root);
        const tc = $("[data-dc-tc]", root);
        const cuts = $$(".dc-cut", root), shots = $$(".dc-shot", root), mvs = $$(".dc-mv", root);
        const beats = $$(".dc-beat", root), keys = $$(".dc-key", root), titles = $$(".dc-title", root);
        const ribbon = $(".dc-ribbon", root), chips = $$(".dc-chip", root);
        const num = (el, p) => parseFloat(el.style.getPropertyValue(p)) || 0;
        const cutX = cuts.map((c) => num(c, "--x"));
        const shotEnd = shots.map((s) => num(s, "--x") + num(s, "--w"));
        const all = [...cuts, ...shots, ...mvs, ...beats, ...keys, ...titles, ...chips, ribbon];
        const on = (el) => el.classList.add("is-on");
        const DUR = 168, S0 = 0.5, SW = 2.4;
        const cues = [[S0, () => on(laser)], [S0 + SW + 0.2, () => laser.classList.remove("is-on")]];
        mvs.forEach((m, i) => cues.push([S0 + SW + 0.15 + i * 0.12, () => on(m)]));
        beats.forEach((b, i) => cues.push([3.6 + i * 0.3, () => on(b)]));
        keys.forEach((k, i) => cues.push([4.4 + i * 0.1, () => on(k)]));
        titles.forEach((x, i) => cues.push([5.6 + i * 0.9, () => on(x)]));
        cues.push([7.6, () => on(ribbon)]);
        chips.forEach((c, i) => cues.push([8.3 + i * 0.15, () => on(c)]));
        scene(root, {
            cycle: 12.5, cues,
            reset() {
                all.forEach((el) => el.classList.remove("is-on"));
                laser.classList.remove("is-on");
                laser.style.setProperty("--p", "0");
                tc.textContent = T.timecode(0);
            },
            final() {
                all.forEach(on);
                laser.classList.remove("is-on");
                tc.textContent = T.timecode(DUR);
            },
            frame(lt) {
                if (lt > S0 + SW + 0.3) return;
                const p = clamp((lt - S0) / SW, 0, 1);
                laser.style.setProperty("--p", p.toFixed(4));
                tc.textContent = T.timecode(p * DUR);
                const x = p * 100;
                cutX.forEach((cx, i) => { if (x >= cx) cuts[i].classList.add("is-on"); });
                shotEnd.forEach((e, i) => { if (x >= e - 0.01) shots[i].classList.add("is-on"); });
            },
        });
    }

    /* ── 02 Busca ─────────────────────────────────────────────────────── */
    function initBusca() {
        const root = $("[data-bs]");
        if (!root) return;
        const qEl = $("[data-bs-q]", root), caret = $(".bs-caret", root), count = $("[data-bs-count]", root);
        const list = $("[data-bs-results]", root), sim = $("[data-bs-sim]", root);
        const simBtn = $("[data-bs-simbtn]", root), simRow = $("[data-bs-simrow]", root);
        const pills = $$("[data-q]", root);
        const KIND = { visual: ["bs-k--visual", "visual"], text: ["bs-k--text", "descrição"], speech: ["bs-k--speech", "transcrição"] };
        const Q = [
            { q: "contraluz na janela", res: [
                { t: "Silhueta da entrevistada contra a janela", tc: "00:14:22:08", k: ["visual"], th: "window", s: 0.94 },
                { t: "Ensaio na sala com luz de fim de tarde", tc: "01:02:10:16", k: ["visual"], th: "warm", s: 0.81 },
                { t: "Making-of: rebatedor junto à janela", tc: "00:41:05:02", k: ["text"], th: "window2", s: 0.72 }],
              sim: ["window", "window2", "night", "warm"] },
            { q: "diretor gesticulando em frente à câmera sob iluminação quente", res: [
                { t: "Diretor explica a cena ao elenco", tc: "00:08:31:12", k: ["visual", "text"], th: "director", s: 0.92 },
                { t: "Zé: Crítica ao primeiro corte", tc: "00:52:47:03", k: ["speech"], th: "warm", s: 0.79 },
                { t: "Set noturno sob luz de tungstênio", tc: "01:15:03:20", k: ["visual"], th: "night", s: 0.7 }],
              sim: ["director", "warm", "night", "workshop"] },
            { q: "mãos no vinil", res: [
                { t: "Detalhe das mãos no vinil", tc: "00:03:12:00", k: ["visual", "text"], th: "vinyl", s: 0.96 },
                { t: "Oficina: mãos ajustando o toca-discos", tc: "00:27:40:11", k: ["visual"], th: "workshop", s: 0.84 },
                { t: "Ana fala da coleção de discos", tc: "00:33:18:05", k: ["speech"], th: "warm", s: 0.71 }],
              sim: ["vinyl", "workshop", "warm", "street"] },
        ];
        const fmt = (v) => v.toFixed(2).replace(".", ",");
        let qi = 0, ph = 0, auto = true, built = 0, stat = true;
        const build = (i) => {
            const d = Q[i];
            list.innerHTML = d.res.map((r, k) => `<li class="bs-res" style="--i: ${k}"><span class="th th--${r.th}"></span><span class="bs-res__main"><span class="bs-res__t">${r.t}</span><span class="bs-res__m"><span class="mono">${r.tc}</span>${r.k.map((x) => `<span class="bs-k ${KIND[x][0]}">${KIND[x][1]}</span>`).join("")}</span></span><span class="bs-score"><b>${fmt(r.s)}</b><i style="--s: ${r.s}"></i></span></li>`).join("");
            simRow.innerHTML = d.sim.map((s) => `<span class="th th--${s}"></span>`).join("");
            built = i;
        };
        const setPressed = () => pills.forEach((p, k) => p.setAttribute("aria-pressed", String(k === qi)));
        const staticView = () => {
            if (built !== qi) build(qi);
            setPressed();
            qEl.textContent = Q[qi].q;
            caret.classList.remove("is-on");
            $$(".bs-res", list).forEach((li) => li.classList.add("is-on"));
            sim.classList.add("is-on", "is-btn");
            simBtn.classList.remove("is-press");
            count.textContent = `${Q[qi].res.length} trechos`;
        };
        const start = (i) => {
            qi = i; ph = 0; setPressed();
            root.setAttribute("data-anim", "");
            snap(root, () => {
                build(i);
                qEl.textContent = "";
                caret.classList.add("is-on");
                sim.classList.remove("is-on", "is-btn");
                simBtn.classList.remove("is-press");
                count.textContent = "…";
            });
        };
        const step = () => {
            const d = Q[qi], L = d.q.length, te = 0.35 + L * 0.045;
            const n = clamp(Math.floor((ph - 0.35) / 0.045) + 1, 0, L);
            if (qEl.textContent.length !== n) qEl.textContent = d.q.slice(0, n);
            caret.classList.toggle("is-on", ph < te + 0.3);
            if (ph >= te + 0.1 && ph < te + 0.35) count.textContent = "buscando…";
            if (ph >= te + 0.35 && list.firstElementChild && !list.firstElementChild.classList.contains("is-on")) {
                $$(".bs-res", list).forEach((li) => li.classList.add("is-on"));
                count.textContent = `${d.res.length} trechos`;
            }
            if (ph >= te + 1.4) sim.classList.add("is-btn");
            simBtn.classList.toggle("is-press", ph >= te + 1.9 && ph < te + 2.15);
            if (ph >= te + 2.15) sim.classList.add("is-on");
            if (auto && ph >= te + 6.5) start((qi + 1) % Q.length);
        };
        T.loop(root, (t, dt) => {
            if (!motionOn()) { stat = true; root.removeAttribute("data-anim"); staticView(); return; }
            if (stat) { stat = false; start(qi); }
            ph += dt;
            step();
        });
        pills.forEach((p, k) => p.addEventListener("click", () => {
            auto = false;
            if (motionOn()) start(k); else { qi = k; staticView(); }
        }));
    }

    /* ── 03 Transcrição ───────────────────────────────────────────────── */
    function initTranscricao() {
        const root = $("[data-tr]");
        if (!root) return;
        const words = [];
        const splitText = (node, sel) => {
            const frag = document.createDocumentFragment();
            (node.textContent.match(/\S+\s*|\s+/g) || []).forEach((part) => {
                if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
                const s = document.createElement("span");
                s.className = sel ? "w in-sel" : "w";
                s.textContent = part;
                frag.appendChild(s);
                words.push(s);
            });
            node.replaceWith(frag);
        };
        const walk = (el, sel) => Array.from(el.childNodes).forEach((nd) => {
            if (nd.nodeType === 3) splitText(nd, sel);
            else if (nd.nodeType === 1) walk(nd, sel || nd.classList.contains("tr-sel"));
        });
        $$(".tr-text", root).forEach((p) => walk(p, false));
        const sel = words.filter((w) => w.classList.contains("in-sel"));
        const turns = $$(".tr-turn", root), keys = $$("[data-tr-key]", root), tl = $(".tr-tl", root);
        let kIdx = -2;
        const KA = 1.0, KS = 0.15;
        scene(root, {
            cycle: 11.5,
            cues: [
                [0.6, () => turns[0] && turns[0].classList.add("is-named")],
                [0.85, () => turns[1] && turns[1].classList.add("is-named")],
                [6.4, () => keys[0] && keys[0].classList.add("is-press")],
                [6.55, () => keys[1] && keys[1].classList.add("is-press")],
                [6.95, () => keys.forEach((k) => k.classList.remove("is-press"))],
                [7.0, () => tl.classList.add("is-on")],
            ],
            reset() {
                turns.forEach((x) => x.classList.remove("is-named"));
                words.forEach((w) => w.classList.remove("is-said", "is-now", "is-sel"));
                keys.forEach((k) => k.classList.remove("is-press"));
                tl.classList.remove("is-on");
                kIdx = -2;
            },
            final() {
                turns.forEach((x) => x.classList.add("is-named"));
                words.forEach((w) => { w.classList.remove("is-now"); w.classList.add("is-said"); });
                sel.forEach((w) => w.classList.add("is-sel"));
                keys.forEach((k) => k.classList.remove("is-press"));
                tl.classList.add("is-on");
            },
            frame(lt) {
                const idx = lt < KA ? -1 : Math.min(words.length, Math.floor((lt - KA) / KS));
                if (idx !== kIdx) {
                    kIdx = idx;
                    words.forEach((w, k) => {
                        w.classList.toggle("is-said", k < idx);
                        w.classList.toggle("is-now", k === idx);
                    });
                }
                const ns = Math.round(clamp((lt - 5.2) / 0.8, 0, 1) * sel.length);
                sel.forEach((w, i) => w.classList.toggle("is-sel", i < ns));
            },
        });
    }

    /* ── 04 Timeline (interativa, Canvas 2D) ──────────────────────────── */
    function initTimeline() {
        const root = $("[data-tl]");
        if (!root) return;
        const cv = $(".tl-canvas", root);
        const toolBtns = $$("[data-tool]", root), profBtns = $$("[data-prof]", root);
        const desc = $("[data-tl-desc]", root), liveEl = $("[data-tl-live]", root);
        const toolName = $("[data-tl-tool-name]", root);
        const profCap = $("[data-prof-cap]", root), profName = $("[data-prof-name]", root);
        const keyCells = $$("[data-key]", root), toolKeys = $$("[data-tool-key]", root);

        /* teclas conforme src/ui/js/keymapService.js */
        const PROFILES = {
            capiau: { name: "CapIAu", blade: ["C"], split: ["E", "Z"], ripple: ["R", "Backspace"], slip: ["Y"], slide: ["U"], rolling: ["Shift+N"], stretch: ["Shift+R", "X"], match: ["Alt+F"], fit: ["\\", "Shift+Z"], insert: [","] },
            premiere: { name: "Premiere Pro", blade: ["C"], split: ["Ctrl+K"], ripple: ["Shift+Delete"], slip: ["Y"], slide: ["U"], rolling: ["N"], stretch: ["R"], match: ["F"], fit: ["\\"], insert: [","] },
            resolve: { name: "DaVinci Resolve", blade: ["B"], split: ["Ctrl+\\"], ripple: ["Shift+Backspace"], slip: ["Shift+Y"], slide: ["U"], rolling: ["N", "T"], stretch: ["R"], match: ["F"], fit: ["Shift+Z"], insert: ["F9"] },
            finalcut: { name: "Final Cut Pro", blade: ["B"], split: ["Cmd+B"], ripple: ["Shift+Delete"], slip: ["Y"], slide: ["U"], rolling: ["N", "T"], stretch: ["R"], match: ["Shift+F"], fit: ["Shift+Z"], insert: ["W"] },
            kdenlive: { name: "Kdenlive", blade: ["C"], split: ["X"], ripple: ["Delete"], slip: ["Y"], slide: ["U"], rolling: ["N"], stretch: ["Shift+R"], match: ["Alt+F"], fit: ["Ctrl+Shift+Espaço"], insert: ["V"] },
        };
        const TOOLS = {
            blade: { name: "Lâmina", text: "<strong>Lâmina</strong> — corta o clipe no quadro exato em que você clica; o áudio vinculado é cortado junto. Na variante global, fatia todas as pistas destravadas na agulha." },
            ripple: { name: "Ripple delete", text: "<strong>Ripple delete</strong> — apaga o clipe (ou o vão) e puxa tudo o que vem depois, sem deixar buraco. Nas pistas com Sync Lock, o resto acompanha." },
            slip: { name: "Slip", text: "<strong>Slip</strong> — troca o trecho da mídia que aparece dentro do clipe. A posição e a duração na timeline não mudam." },
            slide: { name: "Slide", text: "<strong>Slide</strong> — move o clipe entre os vizinhos: o anterior estica e o seguinte encolhe na mesma medida." },
            rolling: { name: "Rolling Edit", text: "<strong>Rolling Edit</strong> — arrasta o ponto de corte entre dois clipes colados. Um ganha o que o outro perde; a duração total não muda." },
            stretch: { name: "Rate Stretch", text: "<strong>Rate Stretch</strong> — muda a velocidade arrastando a borda do clipe, de 10% a 1000%, com um HUD mostrando a porcentagem." },
        };
        const ORDER = ["blade", "ripple", "slip", "slide", "rolling", "stretch"];
        const kbd = (combo) => combo.split("+").map((k) => `<kbd>${k}</kbd>`).join("+");
        const cell = (list) => list.map(kbd).join(' <span class="tl-or">ou</span> ');

        let tool = "blade", auto = true, tt = 0, reps = 0;
        function setProfile(id, user) {
            const P = PROFILES[id];
            profBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.prof === id)));
            keyCells.forEach((td) => {
                td.innerHTML = cell(P[td.dataset.key]);
                if (user && motionOn()) { td.classList.remove("is-flash"); void td.offsetWidth; td.classList.add("is-flash"); }
            });
            toolKeys.forEach((s) => { s.innerHTML = P[s.dataset.toolKey][0].split("+").map((k) => `<kbd>${k}</kbd>`).join(""); });
            profCap.textContent = `Atalhos no perfil ${P.name}`;
            profName.textContent = `· ${P.name}`;
            if (user) liveEl.textContent = `Perfil ${P.name}: teclas atualizadas.`;
        }
        function setTool(id, user) {
            tool = id; tt = 0; reps = 0;
            toolBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === id)));
            desc.innerHTML = TOOLS[id].text;
            toolName.textContent = TOOLS[id].name;
            if (user) { auto = false; liveEl.textContent = desc.textContent; }
            if (!motionOn() && lp) lp.draw();
        }

        /* geometria */
        const MONO = css("--font-mono", "monospace"), BODY = css("--font-body", "sans-serif");
        const COL = { violet: "139,92,246", cyan: "37,209,244", emerald: "26,230,128", amber: "246,174,49", rose: "235,71,126" };
        const KCOL = { v: "violet", b: "cyan", a: "emerald", m: "amber" };
        const LANE_COL = ["cyan", "violet", "emerald", "amber"];
        const rgba = (c, a) => `rgba(${COL[c]},${a})`;
        const RULER = 22, LANE_H = 32, GAP = 6, HEAD = 34, SPAN = 12, PLAYHEAD = 1.2;
        const LANES = ["V2", "V1", "A1", "A2"];
        let ctx = null, W = 0, H = 0;
        const fit = () => { const r = T.fitCanvas(cv); ctx = r.ctx; W = r.width; H = r.height; };
        const pps = () => (W - HEAD - 8) / SPAN;
        const X = (s) => HEAD + s * pps();
        const laneY = (i) => RULER + 10 + i * (LANE_H + GAP);
        const rr = (x, y, w, h, r) => {
            r = Math.min(r, w / 2, h / 2);
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
        };
        const noise = (v) => 0.5 + 0.5 * Math.sin(v * 2.1 + Math.sin(v * 0.7) * 1.8);
        const env = (s, kind) => {
            if (kind === "m") return 0.25 + 0.2 * Math.abs(Math.sin(s * 1.3)) + 0.1 * Math.abs(Math.sin(s * 7.1));
            const word = Math.max(0, Math.sin(s * 3.3) * Math.sin(s * 1.1 + 0.6));
            return Math.min(1, 0.08 + Math.pow(word, 0.6) * 0.95 * (0.6 + 0.4 * Math.abs(Math.sin(s * 9.7))));
        };
        const BASE = [
            { id: "E", lane: 0, a: 6.6, b: 8.2, so: 30, kind: "b", label: "Mãos" },
            { id: "A", lane: 1, a: 0.4, b: 3.6, so: 2, kind: "v", label: "Zé · fala" },
            { id: "B", lane: 1, a: 3.6, b: 6.2, so: 11, kind: "v", label: "Oficina" },
            { id: "C", lane: 1, a: 6.2, b: 8.8, so: 21, kind: "v", label: "Ana · fala" },
            { id: "D", lane: 1, a: 9.6, b: 11.8, so: 40, kind: "v", label: "Rua" },
            { id: "a", lane: 2, a: 0.4, b: 3.6, so: 2, kind: "a", link: "A" },
            { id: "b", lane: 2, a: 3.6, b: 6.2, so: 11, kind: "a", link: "B" },
            { id: "c", lane: 2, a: 6.2, b: 8.8, so: 21, kind: "a", link: "C" },
            { id: "d", lane: 2, a: 9.6, b: 11.8, so: 40, kind: "a", link: "D" },
            { id: "F", lane: 3, a: 9.6, b: 11.8, so: 5, kind: "m", label: "Ambiente" },
        ];
        const clone = () => BASE.map((c) => ({ ...c, sp: 1, alpha: 1, sel: "" }));
        const grp = (cl, id) => cl.filter((c) => c.id === id || c.link === id);
        const fmtS = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")} s`;
        const SPEC = {
            blade: { at: { t: 7.4, lane: 1 }, from: { t: 10.5, lane: 2.6 }, drag: 0 },
            ripple: { at: { t: 4.9, lane: 1 }, from: { t: 2.0, lane: 2.6 }, drag: 0 },
            slip: { at: { t: 4.9, lane: 1 }, from: { t: 8.0, lane: 2.6 }, drag: -1.6 },
            slide: { at: { t: 4.9, lane: 1 }, from: { t: 1.5, lane: 2.6 }, drag: 1.0 },
            rolling: { at: { t: 3.6, lane: 1 }, from: { t: 1.2, lane: 2.6 }, drag: 1.0 },
            stretch: { at: { t: 8.8, lane: 1 }, from: { t: 11, lane: 2.6 }, drag: -1.3 },
        };
        const STATE = {
            blade(p) {
                const cl = clone();
                if (p <= 0) return { clips: cl, extra: (ga) => vline(7.4, rgba("rose", 0.5 * ga), true) };
                const out = [];
                cl.forEach((c) => {
                    if (c.id === "C" || c.link === "C") {
                        out.push({ ...c, b: 7.4, splitR: true });
                        out.push({ ...c, a: 7.4, so: c.so + (7.4 - c.a), splitL: true });
                    } else out.push(c);
                });
                return { clips: out, extra: (ga) => { if (p < 1) vline(7.4, rgba("rose", ga * (1 - p)), false, true); } };
            },
            ripple(p) {
                const cl = clone();
                grp(cl, "B").forEach((c) => { c.sel = "rose"; c.alpha = 1 - clamp(p / 0.4, 0, 1); });
                const s = easeInOutCubic(clamp((p - 0.4) / 0.6, 0, 1));
                const d = 2.6 * s;
                cl.forEach((c) => { if (c.a >= 6.2 - 1e-6) { c.a -= d; c.b -= d; } });
                return {
                    clips: cl.filter((c) => c.alpha > 0.001),
                    extra: (ga) => { if (p > 0 && s < 1) hatch(3.6, 6.2 - d, ga * (1 - s)); },
                    hud: p > 0.4 ? "Ripple: o vão se fecha" : "",
                };
            },
            slip(p) {
                const cl = clone();
                grp(cl, "B").forEach((c) => { c.so -= 1.6 * p; c.sel = p > 0 ? "cyan" : ""; });
                return { clips: cl, hud: `Slip · mídia ${fmtS(-1.6 * p)}` };
            },
            slide(p) {
                const cl = clone(), d = 1.0 * p;
                grp(cl, "A").forEach((c) => { c.b += d; });
                grp(cl, "B").forEach((c) => { c.a += d; c.b += d; c.sel = p > 0 ? "cyan" : ""; });
                grp(cl, "C").forEach((c) => { c.a += d; c.so += d; });
                return { clips: cl, hud: `Slide ${fmtS(d)}` };
            },
            rolling(p) {
                const cl = clone(), d = 1.0 * p;
                grp(cl, "A").forEach((c) => { c.b += d; });
                grp(cl, "B").forEach((c) => { c.a += d; c.so += d; });
                return { clips: cl, extra: (ga) => editMark(3.6 + d, ga), hud: "A + B = mesma duração" };
            },
            stretch(p) {
                const cl = clone(), nb = 8.8 - 1.3 * p, sp = 2.6 / (nb - 6.2);
                grp(cl, "C").forEach((c) => { c.b = nb; c.sp = sp; c.sel = p > 0 ? "cyan" : ""; });
                return { clips: cl, hud: `${Math.round(sp * 100)}% · ${sp.toFixed(1).replace(".", ",")}×` };
            },
        };

        function vline(t, color, dashed, glow) {
            const x = Math.round(X(t)) + 0.5;
            ctx.save();
            ctx.strokeStyle = color; ctx.lineWidth = glow ? 2 : 1;
            if (dashed) ctx.setLineDash([3, 3]);
            if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
            ctx.beginPath(); ctx.moveTo(x, laneY(1) - 3); ctx.lineTo(x, laneY(2) + LANE_H + 3); ctx.stroke();
            ctx.restore();
        }
        function hatch(a, b, alpha) {
            if (b - a < 0.02) return;
            const x0 = X(a), x1 = X(b), y0 = laneY(1), y1 = laneY(2) + LANE_H;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
            ctx.strokeStyle = rgba("rose", 0.45); ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = x0 - (y1 - y0); x < x1; x += 7) { ctx.moveTo(x, y1); ctx.lineTo(x + (y1 - y0), y0); }
            ctx.stroke();
            ctx.restore();
        }
        function editMark(t, ga) {
            const x = X(t), y = laneY(1) - 4, h = LANE_H * 2 + GAP + 8;
            ctx.save();
            ctx.globalAlpha = ga;
            ctx.strokeStyle = rgba("cyan", 0.95); ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 4, y); ctx.lineTo(x - 1.5, y); ctx.lineTo(x - 1.5, y + h); ctx.lineTo(x - 4, y + h);
            ctx.moveTo(x + 4, y); ctx.lineTo(x + 1.5, y); ctx.lineTo(x + 1.5, y + h); ctx.lineTo(x + 4, y + h);
            ctx.stroke();
            ctx.restore();
        }
        function fitText(txt, maxW) {
            if (ctx.measureText(txt).width <= maxW) return txt;
            let t = txt;
            while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
            return t.length > 1 ? t + "…" : "";
        }
        function drawClip(c, ga) {
            const x0 = X(c.a), x1 = X(c.b);
            if (x1 - x0 <= 2) return;
            const y = laneY(c.lane) + 1, h = LANE_H - 2;
            const xx = x0 + (c.splitL ? 1.5 : 1), ww = x1 - x0 - (c.splitL ? 1.5 : 1) - (c.splitR ? 1.5 : 1);
            const col = KCOL[c.kind], p = pps();
            ctx.save();
            ctx.globalAlpha = ga * c.alpha;
            rr(xx, y, ww, h, 4); ctx.clip();
            ctx.fillStyle = rgba(col, c.kind === "a" || c.kind === "m" ? 0.18 : 0.3);
            ctx.fillRect(xx, y, ww, h);
            if (c.kind === "v" || c.kind === "b") {
                const step = 0.55, hue = c.kind === "b" ? 195 : 262;
                for (let s = Math.floor(c.so / step) * step; ; s += step) {
                    const tx = xx + ((s - c.so) / c.sp) * p;
                    if (tx > xx + ww) break;
                    const n = noise(s * 1.7);
                    ctx.fillStyle = `hsla(${hue + (n - 0.5) * 50},${18 + n * 22}%,${14 + n * 20}%,0.85)`;
                    ctx.fillRect(tx + 0.5, y + 3, Math.max(1, (step / c.sp) * p - 1), h - 3);
                }
                ctx.fillStyle = rgba(col, 0.22); ctx.fillRect(xx, y, ww, h);
            } else {
                const mid = y + h / 2 + 1, amp = (h - 8) / 2;
                ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 1;
                ctx.beginPath();
                for (let px = 0; px < ww; px += 2) {
                    const a = Math.max(0.6, env(c.so + (px / p) * c.sp, c.kind) * amp);
                    ctx.moveTo(xx + px + 0.5, mid - a); ctx.lineTo(xx + px + 0.5, mid + a);
                }
                ctx.stroke();
            }
            ctx.fillStyle = rgba(col, 0.95); ctx.fillRect(xx, y, ww, 2);
            if (c.label && ww > 30) {
                ctx.font = `600 10px ${BODY}`;
                const txt = fitText(c.label, ww - 16);
                if (txt) {
                    const tw = ctx.measureText(txt).width;
                    ctx.fillStyle = "rgba(7,6,11,.62)"; rr(xx + 4, y + 5, tw + 8, 14, 3); ctx.fill();
                    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(txt, xx + 8, y + 12.5);
                }
            }
            if (Math.abs(c.sp - 1) > 0.01 && c.kind === "v" && ww > 34) {
                ctx.font = `700 9px ${MONO}`;
                const txt = `${Math.round(c.sp * 100)}%`, tw = ctx.measureText(txt).width;
                ctx.fillStyle = rgba("rose", 0.9); rr(xx + ww - tw - 10, y + h - 15, tw + 6, 12, 3); ctx.fill();
                ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(txt, xx + ww - tw - 7, y + h - 9);
            }
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = ga * c.alpha;
            rr(xx + 0.5, y + 0.5, ww - 1, h - 1, 4);
            ctx.strokeStyle = c.sel ? rgba(c.sel, 0.95) : rgba(col, 0.6);
            ctx.lineWidth = c.sel ? 2 : 1;
            ctx.stroke();
            ctx.restore();
        }
        function drawBase() {
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = "#0b0a11"; ctx.fillRect(0, 0, W, RULER);
            const p = pps();
            const every = p * 2 >= 80 ? 2 : p * 3 >= 80 ? 3 : 4;
            ctx.font = `500 9px ${MONO}`; ctx.textBaseline = "top";
            for (let s = 0; s <= SPAN; s += 0.5) {
                const x = Math.round(X(s)) + 0.5, major = s % 1 === 0;
                ctx.strokeStyle = major ? "rgba(255,255,255,.24)" : "rgba(255,255,255,.1)";
                ctx.beginPath(); ctx.moveTo(x, RULER - (major ? 7 : 4)); ctx.lineTo(x, RULER); ctx.stroke();
                if (major && s % every === 0 && s < SPAN - 1) { ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillText(T.timecode(s), x + 3, 4); }
            }
            LANES.forEach((name, i) => {
                const y = laneY(i);
                ctx.fillStyle = i % 2 ? "rgba(255,255,255,.018)" : "rgba(255,255,255,.03)";
                ctx.fillRect(HEAD, y, W - HEAD - 2, LANE_H);
                ctx.fillStyle = "rgba(255,255,255,.045)"; rr(2, y, HEAD - 6, LANE_H, 4); ctx.fill();
                ctx.fillStyle = rgba(LANE_COL[i], 0.9); ctx.fillRect(2, y + 5, 2, LANE_H - 10);
                ctx.font = `600 10px ${MONO}`; ctx.fillStyle = "rgba(255,255,255,.66)"; ctx.textBaseline = "middle";
                ctx.fillText(name, 9, y + LANE_H / 2);
            });
        }
        function drawPlayhead() {
            const x = Math.round(X(PLAYHEAD)) + 0.5;
            ctx.strokeStyle = rgba("rose", 0.95); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, RULER - 2); ctx.lineTo(x, laneY(3) + LANE_H); ctx.stroke();
            ctx.fillStyle = rgba("rose", 1);
            ctx.beginPath(); ctx.moveTo(x - 5, RULER - 9); ctx.lineTo(x + 5, RULER - 9); ctx.lineTo(x, RULER - 2); ctx.closePath(); ctx.fill();
        }
        function drawCursor(t, lane, press, ga) {
            const x = X(t), y = laneY(lane) + LANE_H * 0.6;
            ctx.save();
            ctx.globalAlpha = ga;
            if (press > 0) {
                ctx.strokeStyle = rgba("cyan", (1 - press) * 0.9); ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(x, y, 5 + press * 14, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.translate(x, y);
            ctx.beginPath();
            ctx.moveTo(0, 0); ctx.lineTo(0, 15); ctx.lineTo(4, 11.5); ctx.lineTo(7, 17.5);
            ctx.lineTo(9.4, 16.4); ctx.lineTo(6.5, 10.6); ctx.lineTo(11.5, 10.6); ctx.closePath();
            ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(7,6,11,.9)"; ctx.lineWidth = 1.2;
            ctx.fill(); ctx.stroke();
            ctx.restore();
        }
        function drawHud(text, t, ga) {
            if (!text) return;
            ctx.save();
            ctx.globalAlpha = ga;
            ctx.font = `600 10px ${MONO}`;
            const tw = ctx.measureText(text).width, w = tw + 16, h = 20;
            const x = clamp(X(t) - w / 2, HEAD + 2, W - w - 4), y = laneY(0) + (LANE_H - h) / 2;
            ctx.fillStyle = "rgba(10,9,16,.94)"; rr(x, y, w, h, 10); ctx.fill();
            ctx.strokeStyle = rgba("cyan", 0.55); ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = rgba("cyan", 1); ctx.textBaseline = "middle"; ctx.fillText(text, x + 8, y + h / 2 + 0.5);
            ctx.restore();
        }
        function render(p, mv, ga, press) {
            if (!ctx || W < 10) return;
            drawBase();
            const st = STATE[tool](p);
            st.clips.forEach((c) => drawClip(c, ga));
            if (st.extra) st.extra(ga);
            drawPlayhead();
            const sp = SPEC[tool];
            const ct = lerp(sp.from.t, sp.at.t, mv) + sp.drag * p;
            drawCursor(ct, lerp(sp.from.lane, sp.at.lane, mv), press, ga);
            if (p > 0) drawHud(st.hud, ct, ga);
        }

        const CYC = 4.6;
        const lp = T.loop(cv, (t, dt) => {
            if (!ctx) fit();
            if (!motionOn()) { render(1, 1, 1, 0); return; }
            tt += dt;
            if (tt >= CYC) {
                tt -= CYC; reps += 1;
                if (auto && reps >= 2) setTool(ORDER[(ORDER.indexOf(tool) + 1) % ORDER.length], false);
            }
            const mv = easeInOutCubic(clamp(tt / 0.7, 0, 1));
            const press = tt >= 0.7 && tt < 1.1 ? (tt - 0.7) / 0.4 : 0;
            const p = easeInOutCubic(clamp((tt - 0.9) / 1.4, 0, 1));
            let ga = 1;
            if (tt > 3.9 && tt <= 4.3) ga = 1 - (tt - 3.9) / 0.4;
            else if (tt > 4.3) ga = (tt - 4.3) / 0.3;
            render(tt > 4.3 ? 0 : p, tt > 4.3 ? 0 : mv, Math.max(0.05, ga), press);
        });
        T.onResize(cv, () => { fit(); lp.draw(); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => lp.draw());

        toolBtns.forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool, true)));
        profBtns.forEach((b) => b.addEventListener("click", () => setProfile(b.dataset.prof, true)));
        setProfile("capiau", false);
    }

    /* ── 05 Agente ────────────────────────────────────────────────────── */
    function initAgente() {
        const root = $("[data-ag]");
        if (!root) return;
        const user = $(".ag-msg--user", root), ai = $(".ag-msg--ai", root), typing = $(".ag-typing", root);
        const calls = $$(".ag-call", root), ghosts = $$(".ag-ghost", root);
        const enter = $("[data-ag-enter]", root), altK = $("[data-ag-alt]", root);
        const toast = $(".ag-toast", root), alt = $(".ag-alt", root);
        const thumbs = $$(".ag-alt__row .th", root), slot = $("[data-ag-slot]", root), swap = $(".ag-clip--swap", root);
        const g = (n) => ghosts.filter((el) => el.dataset.agG === String(n));
        const cur = (i) => thumbs.forEach((t, k) => t.classList.toggle("is-cur", k === i));
        const shown = (el) => el.classList.add("is-shown");
        const cues = [
            [0.3, () => user.classList.add("is-on")],
            [1.1, () => typing.classList.add("is-on")],
            [2.4, () => { typing.classList.remove("is-on"); ai.classList.add("is-on"); }],
            ...calls.map((c, i) => [2.6 + i * 0.3, () => c.classList.add("is-on")]),
            [3.7, () => g(0).forEach(shown)], [4.0, () => g(1).forEach(shown)], [4.3, () => g(2).forEach(shown)],
            [5.6, () => enter.classList.add("is-press")],
            [5.9, () => { enter.classList.remove("is-press"); ghosts.forEach((el) => el.classList.add("is-solid")); toast.classList.add("is-on"); }],
            [7.3, () => { toast.classList.remove("is-on"); swap.classList.add("is-sel"); }],
            [7.6, () => altK.classList.add("is-press")],
            [7.9, () => { altK.classList.remove("is-press"); alt.classList.add("is-on"); }],
            [8.6, () => cur(0)], [9.3, () => cur(1)], [10.0, () => cur(2)], [10.7, () => cur(1)],
            [11.3, () => slot.classList.add("is-press")],
            [11.6, () => swap.classList.add("is-swapped")],
            [12.1, () => { alt.classList.remove("is-on"); slot.classList.remove("is-press"); }],
            [12.8, () => swap.classList.remove("is-sel")],
        ];
        scene(root, {
            cycle: 14.2, cues,
            reset() {
                [user, ai, typing, ...calls, toast, alt].forEach((el) => el.classList.remove("is-on"));
                ghosts.forEach((el) => el.classList.remove("is-shown", "is-solid"));
                swap.classList.remove("is-sel", "is-swapped");
                [enter, altK, slot].forEach((el) => el.classList.remove("is-press"));
                cur(0);
            },
            final() {
                [user, ai, ...calls].forEach((el) => el.classList.add("is-on"));
                [typing, toast].forEach((el) => el.classList.remove("is-on"));
                ghosts.forEach((el) => el.classList.add("is-shown", "is-solid"));
                swap.classList.add("is-swapped"); swap.classList.remove("is-sel");
                alt.classList.add("is-on"); cur(1); slot.classList.add("is-press");
            },
        });
    }

    /* ── 06 Títulos ───────────────────────────────────────────────────── */
    function initTitulos() {
        const root = $("[data-ti]");
        if (!root) return;
        const lt = $("[data-ti-lt]", root), curve = $("[data-ti-curve]", root), dot = $("[data-ti-dot]", root);
        const nameEl = $("[data-ti-name]", root), descEl = $("[data-ti-desc]", root), tc = $("[data-ti-tc]", root);
        const phs = $$("[data-ti-ph]", root), btns = $$("[data-ease]", root);
        const EASE = {
            linear: { name: "Linear", cp: null, text: "<strong>Linear</strong> — velocidade constante do começo ao fim: mecânico, bom para rolagens." },
            in: { name: "Ease-In", cp: [0.42, 0, 1, 1], text: "<strong>Ease-In</strong> — começa devagar e acelera: combina com saídas." },
            out: { name: "Ease-Out", cp: [0, 0, 0.58, 1], text: "<strong>Ease-Out</strong> — entra rápido e pousa devagar: o clássico para um GC." },
            inout: { name: "Ease-In-Out", cp: [0.42, 0, 0.58, 1], text: "<strong>Ease-In-Out</strong> — acelera e desacelera: movimento suave, sem tranco." },
        };
        const ORDER = ["linear", "in", "out", "inout"];
        const bez = (cp) => {
            if (!cp) return (x) => x;
            const [x1, y1, x2, y2] = cp;
            const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
            const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
            const sx = (t) => ((ax * t + bx) * t + cx) * t;
            const sy = (t) => ((ay * t + by) * t + cy) * t;
            const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
            return (x) => {
                let t = x;
                for (let i = 0; i < 8; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; t = clamp(t - (sx(t) - x) / d, 0, 1); }
                return sy(t);
            };
        };
        const PX = (v) => 12 + v * 100, PY = (v) => 88 - v * 80;
        let ease = "out", fn = bez(EASE.out.cp), auto = true, ph = 0, reps = 0, lp = null;
        const CYC = 3.4;
        function apply(x, q, tp, op = 1, shift = 0) {
            lt.style.transform = `translateX(calc(${((1 - q) * -118).toFixed(2)}% + ${shift.toFixed(2)}px))`;
            lt.style.opacity = op.toFixed(3);
            dot.setAttribute("cx", PX(x).toFixed(2));
            dot.setAttribute("cy", PY(q).toFixed(2));
            const v = (6 + tp * 90).toFixed(2);
            phs.forEach((el) => el.style.setProperty("--ph", v));
            tc.textContent = T.timecode(tp * CYC);
        }
        function setEase(id, user) {
            ease = id; ph = 0; reps = 0;
            const e = EASE[id];
            curve.setAttribute("d", e.cp
                ? `M${PX(0)} ${PY(0)} C${PX(e.cp[0])} ${PY(e.cp[1])} ${PX(e.cp[2])} ${PY(e.cp[3])} ${PX(1)} ${PY(1)}`
                : `M${PX(0)} ${PY(0)} L${PX(1)} ${PY(1)}`);
            fn = bez(e.cp);
            nameEl.textContent = e.name;
            descEl.innerHTML = e.text;
            btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ease === id)));
            if (user) auto = false;
            if (!motionOn() && lp) lp.draw();
        }
        lp = T.loop(root, (t, dt) => {
            if (!motionOn()) { apply(1, 1, 1.35 / CYC); return; }
            ph += dt;
            if (ph >= CYC) {
                ph -= CYC; reps += 1;
                if (auto && reps >= 2) setEase(ORDER[(ORDER.indexOf(ease) + 1) % ORDER.length], false);
            }
            const x = clamp((ph - 0.35) / 1.0, 0, 1), q = fn(x);
            let op = clamp(x * 1.6, 0, 1), shift = 0;
            if (ph > 2.7) { const o = clamp((ph - 2.7) / 0.4, 0, 1); op = 1 - o * o; shift = o * o * 8; }
            apply(x, q, ph / CYC, op, shift);
        });
        btns.forEach((b) => b.addEventListener("click", () => setEase(b.dataset.ease, true)));
    }

    /* ── 07 Rostos (Canvas 2D) ────────────────────────────────────────── */
    function initRostos() {
        const root = $("[data-ro]");
        if (!root) return;
        const cv = $(".ro-canvas", root);
        const MONO = css("--font-mono", "monospace");
        let ctx = null, W = 0, H = 0;
        const fit = () => { const r = T.fitCanvas(cv); ctx = r.ctx; W = r.width; H = r.height; };
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
        const CL = [
            { cx: 0.24, cy: 0.42, n: 14, col: [139, 92, 246], raw: "GRUPO 1", name: "ZÉ" },
            { cx: 0.64, cy: 0.3, n: 11, col: [37, 209, 244], raw: "GRUPO 2", name: "ANA" },
            { cx: 0.58, cy: 0.72, n: 9, col: [246, 174, 49], raw: "GRUPO 3", name: "BIA" },
        ];
        const NEU = [185, 182, 200], ROSE = [235, 71, 126];
        const pts = [];
        CL.forEach((c, ci) => {
            for (let i = 0; i < c.n; i++) {
                const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.85;
                pts.push({ c: ci, ox: Math.cos(ang) * r, oy: Math.sin(ang) * r, sx: 0.06 + rnd() * 0.88, sy: 0.1 + rnd() * 0.8, ph: rnd() * 6.28, d: rnd() * 0.5 });
            }
        });
        [[0.88, 0.84], [0.1, 0.12], [0.92, 0.12], [0.36, 0.9], [0.06, 0.62]].forEach(([tx, ty]) => {
            pts.push({ c: -1, tx, ty, sx: 0.06 + rnd() * 0.88, sy: 0.1 + rnd() * 0.8, ph: rnd() * 6.28, d: rnd() * 0.4 });
        });
        const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",");
        function face(x, y, r, col, a) {
            ctx.globalAlpha = a;
            ctx.fillStyle = `rgba(${col},.16)`; ctx.strokeStyle = `rgba(${col},.95)`; ctx.lineWidth = 1.3;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = `rgba(${col},.95)`;
            ctx.beginPath(); ctx.arc(x, y - r * 0.22, r * 0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x, y + r * 0.62, r * 0.52, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
        }
        function pill(x, y, text, col, a, lock) {
            ctx.globalAlpha = a;
            ctx.font = `700 10px ${MONO}`;
            const tw = ctx.measureText(text).width, w = tw + (lock ? 30 : 16), h = 20;
            const px = clamp(x - w / 2, 4, W - w - 4), py = clamp(y - h / 2, 4, H - h - 4);
            ctx.fillStyle = "rgba(10,9,16,.92)"; ctx.strokeStyle = `rgba(${col},.8)`; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, py, w, h, 10) : ctx.rect(px, py, w, h); ctx.fill(); ctx.stroke();
            ctx.fillStyle = `rgb(${col})`; ctx.textBaseline = "middle"; ctx.fillText(text, px + 8, py + h / 2 + 0.5);
            if (lock) {
                const lx = px + w - 16, ly = py + 7;
                ctx.fillRect(lx, ly + 3, 8, 6);
                ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.arc(lx + 4, ly + 3, 2.6, Math.PI, 0); ctx.stroke();
            }
        }
        function draw(lt, t) {
            if (!ctx || W < 10) return;
            ctx.clearRect(0, 0, W, H);
            ctx.globalAlpha = 1;
            const R = Math.min(W, H) * 0.13;
            const out = easeInOutCubic(clamp((lt - 8.8) / 1.0, 0, 1));
            const rings = clamp((lt - 3.2) / 0.5, 0, 1) * (1 - out);
            const labels = clamp((lt - 3.7) / 0.4, 0, 1) * (1 - out);
            const named = lt >= 5.0, lock = clamp((lt - 5.3) / 0.4, 0, 1);
            const rej = clamp((lt - 6.4) / 0.6, 0, 1) * (1 - out);
            CL.forEach((c) => {
                if (rings <= 0) return;
                const cx = c.cx * W, cy = c.cy * H;
                ctx.globalAlpha = rings;
                ctx.fillStyle = `rgba(${c.col},.06)`; ctx.strokeStyle = `rgba(${c.col},.55)`;
                ctx.setLineDash([4, 4]); ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.setLineDash([]);
            });
            pts.forEach((p) => {
                const conv = easeInOutCubic(clamp((lt - 1.0 - p.d) / 1.8, 0, 1)) * (1 - out);
                const wob = (1 - conv) * 3;
                let x, y, col, a = 1;
                if (p.c >= 0) {
                    const c = CL[p.c];
                    x = lerp(p.sx * W, c.cx * W + p.ox * R, conv) + Math.sin(t * 0.8 + p.ph) * wob;
                    y = lerp(p.sy * H, c.cy * H + p.oy * R, conv) + Math.cos(t * 0.7 + p.ph) * wob;
                    col = mix(NEU, c.col, clamp((conv - 0.5) / 0.5, 0, 1));
                } else {
                    x = lerp(p.sx * W, p.tx * W, conv) + Math.sin(t * 0.8 + p.ph) * wob;
                    y = lerp(p.sy * H, p.ty * H, conv) + Math.cos(t * 0.7 + p.ph) * wob;
                    col = mix(NEU, ROSE, rings);
                    a = 1 - rej * 0.75;
                }
                face(x, y, 8, col, a);
                if (p.c < 0 && rings > 0) {
                    ctx.globalAlpha = rings * a;
                    ctx.strokeStyle = `rgb(${ROSE.join(",")})`; ctx.lineWidth = 1.6;
                    ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
                }
            });
            CL.forEach((c) => {
                if (labels > 0) pill(c.cx * W, c.cy * H - R * 1.3 - 12, `${named ? c.name : c.raw} · ${c.n}`, c.col.join(","), labels, named && lock > 0);
            });
            if (rej > 0) {
                ctx.globalAlpha = rej;
                ctx.font = `600 10px ${MONO}`; ctx.fillStyle = `rgb(${ROSE.join(",")})`; ctx.textBaseline = "top";
                const txt = "× 5 artefatos rejeitados";
                ctx.fillText(txt, W - ctx.measureText(txt).width - 12, 12);
            }
            ctx.globalAlpha = 1;
        }
        let lt = 0;
        const lp = T.loop(cv, (t, dt) => {
            if (!ctx) fit();
            if (!motionOn()) { draw(7.5, 0); return; }
            lt = (lt + dt) % 10;
            draw(lt, t);
        });
        T.onResize(cv, () => { fit(); lp.draw(); });
    }

    /* ── 08 Áudio ─────────────────────────────────────────────────────── */
    function initAudio() {
        const root = $("[data-au]");
        if (!root) return;
        const wave = $("[data-au-wave]", root), bars = $$("[data-au-bar]", root);
        const prog = $("[data-au-prog]", root), progLab = $("[data-au-prog-lab]", root);
        const lufs = $("[data-au-lufs]", root), tp = $("[data-au-tp]", root), state = $("[data-au-state]", root);
        const sev = $(".au-sev", root), sug = $("[data-au-sug]", root), sil = $("[data-au-silence]", root);
        let html = "";
        const NB = 56;
        for (let i = 0; i < NB; i++) {
            const s = (i / NB) * 9;
            const speech = Math.max(0, Math.sin(s * 2.2) * Math.sin(s * 0.9 + 0.5));
            const nz = 0.16 + 0.06 * Math.sin(i * 1.7);
            let h = nz + Math.pow(speech, 0.7) * (0.75 + 0.35 * Math.abs(Math.sin(i * 2.3)));
            const clip = h >= 0.98;
            h = Math.min(h, 1);
            const a = speech < 0.05 ? h * 0.35 : Math.min(0.8, h * 0.82);
            html += `<i style="--h: ${h.toFixed(3)}; --a: ${a.toFixed(3)}; --k: ${i}"${clip ? ' class="is-clip"' : ""}></i>`;
        }
        wave.innerHTML = html;
        const setRead = (el, txt, cls) => { el.textContent = txt; el.classList.remove("is-bad", "is-wait"); if (cls) el.classList.add(cls); };
        let fixed = false;
        scene(root, {
            cycle: 11,
            cues: [
                [0.4, () => { state.textContent = "medindo"; }],
                [2.0, () => { sev.classList.add("is-on"); setRead(lufs, "fora do alvo", "is-bad"); setRead(tp, "estourado", "is-bad"); state.textContent = "diagnóstico"; }],
                [2.6, () => sug.classList.add("is-on")],
                [3.2, () => sil.classList.add("is-try")],
                [4.0, () => { state.textContent = "renderizando"; sil.classList.remove("is-try"); }],
                [5.4, () => { fixed = true; wave.classList.add("is-fixed"); setRead(lufs, "-16 LUFS"); setRead(tp, "≤ -1,5 dBTP"); state.textContent = "tratado"; }],
            ],
            reset() {
                fixed = false;
                wave.classList.remove("is-fixed");
                sev.classList.remove("is-on"); sug.classList.remove("is-on"); sil.classList.remove("is-try");
                setRead(lufs, "—", "is-wait"); setRead(tp, "—", "is-wait");
                state.textContent = "bruto";
            },
            final() {
                fixed = true;
                wave.classList.add("is-fixed"); sev.classList.add("is-on"); sug.classList.add("is-on"); sil.classList.remove("is-try");
                setRead(lufs, "-16 LUFS"); setRead(tp, "≤ -1,5 dBTP");
                state.textContent = "tratado";
                prog.style.setProperty("--p", "1"); progLab.textContent = "WAV derivado · original intocado";
                bars.forEach((b) => b.style.setProperty("--m", "0.7"));
            },
            frame(lt) {
                if (lt < 2.0) { prog.style.setProperty("--p", clamp((lt - 0.4) / 1.6, 0, 1).toFixed(3)); progLab.textContent = "medindo… ~3 s por clipe"; }
                else if (lt < 4.0) { prog.style.setProperty("--p", "1"); progLab.textContent = "medido em ~3 s"; }
                else if (lt < 5.4) { prog.style.setProperty("--p", ((lt - 4.0) / 1.4).toFixed(3)); progLab.textContent = "renderizando WAV 48 kHz/24 bits"; }
                else { prog.style.setProperty("--p", "1"); progLab.textContent = "WAV derivado · original intocado"; }
                bars.forEach((b, i) => {
                    const w = Math.abs(Math.sin(lt * (6.5 + i) + i)) * 0.5 + Math.abs(Math.sin(lt * 2.3 + i * 2)) * 0.5;
                    const m = fixed ? 0.62 + 0.12 * w : 0.78 + 0.22 * w;
                    b.style.setProperty("--m", m.toFixed(3));
                });
            },
        });
    }

    /* ── 09 Render ────────────────────────────────────────────────────── */
    function initRender() {
        const root = $("[data-rd]");
        if (!root) return;
        const mon = $("[data-rd-mon]", root), modes = $$("[data-rd-mode]", root);
        const cks = $$("[data-rd-ck]", root), ckT = $$("[data-rd-ck-t]", root);
        const out = $("[data-rd-out]", root), outT = $("[data-rd-out-t]", root), bar = $("[data-rd-bar]", root);
        const st = $$(".rd-st", root);
        const TXT = [["Mídias no lugar", "Originais: não precisa no rascunho"], ["Mídias no lugar", "Originais em HD: disco desconectado"]];
        const T0 = 2.4, DT = 0.62;
        let scen = 0;
        const ck = (i, cls) => { cks[i].classList.remove("is-ok", "is-na", "is-warn", "is-bad"); cks[i].classList.add(cls, "is-on"); };
        const stage = (i) => {
            if (i > 0) { st[i - 1].classList.remove("is-on"); st[i - 1].classList.add("is-done"); }
            st[i].classList.add("is-on");
            mon.dataset.stage = String(i + 1);
        };
        const cues = [
            [0.3, () => ck(0, "is-ok")],
            [0.6, () => ck(1, scen ? "is-bad" : "is-na")],
            [0.9, () => ck(2, "is-warn")],
            [1.4, () => {
                out.classList.add("is-on");
                if (scen) { out.classList.add("is-bad"); outT.textContent = "Exportação bloqueada"; mon.classList.add("is-blocked"); }
                else outT.textContent = "Liberado · renderizando";
            }],
            [T0 + 7 * DT, () => { if (scen) return; st[6].classList.remove("is-on"); st[6].classList.add("is-done"); outT.textContent = "MP4 pronto · rascunho"; }],
        ];
        for (let i = 0; i < 7; i++) cues.push([T0 + i * DT, () => { if (!scen) stage(i); }]);
        const setMode = () => {
            modes.forEach((m, i) => m.classList.toggle("is-on", i === scen));
            ckT[0].textContent = TXT[scen][0];
            ckT[1].textContent = TXT[scen][1];
        };
        scene(root, {
            cycle: 10.5, cues,
            reset(k) {
                scen = k % 2;
                setMode();
                cks.forEach((c) => c.classList.remove("is-on"));
                out.classList.remove("is-on", "is-bad"); outT.textContent = "";
                mon.classList.remove("is-blocked"); mon.dataset.stage = "0";
                st.forEach((s) => s.classList.remove("is-on", "is-done"));
                bar.style.setProperty("--p", "0");
            },
            final() {
                scen = 0; setMode();
                ck(0, "is-ok"); ck(1, "is-na"); ck(2, "is-warn");
                out.classList.add("is-on"); out.classList.remove("is-bad"); outT.textContent = "MP4 pronto · rascunho";
                mon.classList.remove("is-blocked"); mon.dataset.stage = "7";
                st.forEach((s) => { s.classList.remove("is-on"); s.classList.add("is-done"); });
                bar.style.setProperty("--p", "1");
            },
            frame(lt) {
                bar.style.setProperty("--p", scen ? "1" : clamp((lt - T0) / (7 * DT), 0, 1).toFixed(3));
            },
        });
    }

    /* ── 10 Exportação ────────────────────────────────────────────────── */
    function initExport() {
        const root = $("[data-ex]");
        if (!root) return;
        const rows = $$("[data-ex-row]", root);
        const file = $("[data-ex-file]", root), bar = $("[data-ex-bar]", root);
        const F = ["primeiro_corte.otio", "primeiro_corte.xml", "primeiro_corte.edl", "primeiro_corte.mp4", "primeiro_corte.srt"];
        const CYC = 2.6;
        let cur = -1;
        T.loop(root, (t) => {
            if (!motionOn()) {
                rows.forEach((r) => r.classList.remove("is-hot"));
                file.textContent = F[0]; bar.style.setProperty("--p", "1"); cur = -1;
                return;
            }
            const k = Math.floor(t / CYC) % F.length, lt = t % CYC;
            if (k !== cur) { cur = k; rows.forEach((r, i) => r.classList.toggle("is-hot", i === k)); file.textContent = F[k]; }
            bar.style.setProperty("--p", clamp(lt / 1.4, 0, 1).toFixed(3));
        });
    }

    [initReel, initDecupagem, initBusca, initTranscricao, initTimeline, initAgente, initTitulos, initRostos, initAudio, initRender, initExport,
        () => playWhenVisible($("[data-if]"))].forEach((fn) => {
        try { fn(); } catch (err) { console.error(err); }
    });
    T.pages.recursos = { ready: true };
})();
