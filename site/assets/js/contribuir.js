/* =============================================================================
   CapIAu-Talho — site de apresentação
   contribuir.js: página Contribuir.
     - grafo de git do topo, desenhado como uma timeline (branches = pistas,
       commits acendem quando a agulha passa, PRs voltam para a main);
     - roadmap com trilho que se preenche na rolagem até a agulha "agora";
     - fluxo do primeiro PR com uma luz que percorre os passos;
     - montador de mensagem de commit (tipo(escopo): descrição);
     - explorador de pastas (destaque que desliza até a pasta escolhida);
     - liga/desliga das animações em CSS conforme a seção está na tela.
   Tudo respeita Talho.motion: sem movimento, cada peça mostra um quadro final.
   ========================================================================== */
(() => {
    "use strict";

    const T = window.Talho;
    if (!T) return;
    const { clamp, lerp, easeOutCubic, easeInOutCubic } = T.math;
    const NS = "http://www.w3.org/2000/svg";
    const easeOutBack = (x) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    };

    function svgEl(tag, attrs, parent) {
        const el = document.createElementNS(NS, tag);
        if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(el);
        return el;
    }

    /* ── Grafo de git como timeline ─────────────────────────────────────── */
    function initGitline() {
        const stage = document.querySelector("[data-gl]");
        if (!stage) return;
        const tcEl = document.querySelector("[data-gl-tc]");
        const term = document.querySelector(".gl__term");
        const cmdEl = document.querySelector("[data-gl-cmd]");

        const PLAY = 16;   // segundos para a agulha cruzar o grafo
        const HOLD = 3.6;  // pausa no quadro final
        const FADE = 0.8;  // some antes de recomeçar
        const CYCLE = PLAY + HOLD + FADE;
        const SEQ = 80;    // segundos de "sequência" que a régua representa
        const CPS = 90;    // velocidade de digitação do terminal
        const MAIN = 2;

        const LANES = [
            { name: "docs/glossario", short: "docs", tone: "amber" },
            { name: "feature/trava-de-pista", short: "feat", tone: "cyan" },
            { name: "main", short: "main", tone: "main" },
            { name: "fix/caixas-faciais", short: "fix", tone: "emerald" },
            { name: "sua-branch", short: "você", tone: "you" },
        ];
        const MAIN_COMMITS = [
            { u: 0.04, msg: 'git commit -m "docs: proposta da Sequência Fantasma"' },
            { u: 0.13, msg: 'git commit -m "docs: ordem de implementação conferida no código"' },
            { u: 0.27, msg: 'git commit -m "perf(ui): timecode sem regravação"' },
        ];
        const BRANCHES = [
            {
                lane: 1, from: 0.13, to: 0.44, chipDir: -1,
                merge: "# PR revisado e mesclado na main: feature/trava-de-pista",
                commits: [
                    { u: 0.22, tag: "feat(timeline)", tiny: "feat", msg: 'git commit -m "feat(timeline): trava de pista com cadeado"' },
                    { u: 0.33, tag: "test(nle)", tiny: "test", msg: 'git commit -m "test(nle): autoteste da trava de pista"' },
                ],
            },
            {
                lane: 3, from: 0.27, to: 0.62, chipDir: 1,
                merge: "# PR revisado e mesclado na main: fix/caixas-faciais",
                commits: [
                    { u: 0.38, tag: "fix(player)", tiny: "fix", msg: 'git commit -m "fix(player): geometria das caixas faciais"' },
                    { u: 0.52, tag: "fix(player)", tiny: "fix", msg: 'git commit -m "fix(player): descarte no Source Player"' },
                ],
            },
            {
                lane: 0, from: 0.44, to: 0.8, chipDir: 1,
                merge: "# PR revisado e mesclado na main: docs/glossario",
                commits: [
                    { u: 0.58, tag: "docs(wiki)", tiny: "docs", msg: 'git commit -m "docs(wiki): capítulo 18 com glossário visual"' },
                    { u: 0.7, tag: "docs(readme)", tiny: "docs", msg: 'git commit -m "docs(readme): corrigir links e roadmap"' },
                ],
            },
            {
                lane: 4, from: 0.8, to: null, end: 0.95, chipDir: -1,
                fork: { u: 0.87, msg: "git checkout -b feature/minha-melhoria" },
                commits: [
                    { u: 0.95, tag: "seu PR?", tiny: "você?", ghost: true, msg: "# sua vez: abra o seu primeiro Pull Request" },
                ],
            },
        ];
        const EVENTS = [];
        MAIN_COMMITS.forEach((c) => EVENTS.push(c));
        BRANCHES.forEach((b) => {
            b.commits.forEach((c) => EVENTS.push(c));
            if (b.to != null) EVENTS.push({ u: b.to, msg: b.merge });
            if (b.fork) EVENTS.push(b.fork);
        });
        EVENTS.sort((a, b) => a.u - b.u);

        let G = null;

        function build() {
            const w = Math.round(stage.clientWidth);
            const h = Math.round(stage.clientHeight);
            if (w < 40 || h < 40) return false;
            const narrow = w < 640;
            const headW = narrow ? 50 : 182;
            const rulerH = 26;
            const laneH = (h - rulerH - 4) / LANES.length;
            const gx0 = headW + (narrow ? 14 : 24);
            const gx1 = w - (narrow ? 14 : 26);
            const X = (u) => gx0 + u * (gx1 - gx0);
            const Y = (i) => rulerH + laneH * (i + 0.5);

            const svg = svgEl("svg", { class: "gl-svg", viewBox: `0 0 ${w} ${h}`, width: w, height: h, focusable: "false", "aria-hidden": "true" });
            stage.replaceChildren(svg);

            const defs = svgEl("defs", null, svg);
            const grad = svgEl("linearGradient", { id: "gl-grad-main", gradientUnits: "userSpaceOnUse", x1: gx0, y1: 0, x2: gx1, y2: 0 }, defs);
            svgEl("stop", { offset: "0", class: "gl-stop-violet" }, grad);
            svgEl("stop", { offset: "0.55", class: "gl-stop-magenta" }, grad);
            svgEl("stop", { offset: "1", class: "gl-stop-cyan" }, grad);
            ["violet", "amber", "cyan", "emerald", "you"].forEach((tone) => {
                const rg = svgEl("radialGradient", { id: `gl-glow-${tone}` }, defs);
                svgEl("stop", { offset: "0", class: `gl-stop-${tone}`, "stop-opacity": "0.6" }, rg);
                svgEl("stop", { offset: "1", class: `gl-stop-${tone}`, "stop-opacity": "0" }, rg);
            });
            const clip = svgEl("clipPath", { id: "gl-reveal" }, defs);
            const reveal = svgEl("rect", { x: 0, y: 0, width: 0, height: h }, clip);

            // pistas, cabeçalhos e trilhos
            LANES.forEach((lane, i) => {
                svgEl("rect", { x: 0, y: rulerH + laneH * i, width: w, height: laneH, class: i % 2 ? "gl-band gl-band--alt" : "gl-band" }, svg);
            });
            svgEl("rect", { x: 0, y: 0, width: headW, height: h, class: "gl-headbg" }, svg);
            svgEl("line", { x1: headW + 0.5, y1: 0, x2: headW + 0.5, y2: h, class: "gl-headline" }, svg);
            LANES.forEach((lane, i) => svgEl("line", { x1: gx0, y1: Y(i), x2: gx1, y2: Y(i), class: "gl-rail" }, svg));

            // régua com timecode
            svgEl("rect", { x: headW + 1, y: 0, width: Math.max(0, w - headW - 1), height: rulerH, class: "gl-rulerbg" }, svg);
            const step = narrow ? 4 : 2;
            const major = narrow ? 20 : 10;
            const secPx = (gx1 - gx0) / SEQ;
            for (let sec = 0; sec <= SEQ; sec += step) {
                const x = gx0 + sec * secPx;
                const isMajor = sec % major === 0;
                svgEl("line", { x1: x, y1: isMajor ? 8 : 17, x2: x, y2: rulerH, class: isMajor ? "gl-tick gl-tick--major" : "gl-tick" }, svg);
                if (isMajor && sec < SEQ) svgEl("text", { x: x + 4, y: 13, class: "gl-tcl" }, svg).textContent = T.timecode(sec).slice(3, 8);
            }
            if (!narrow) svgEl("text", { x: 14, y: 17, class: "gl-tcl" }, svg).textContent = "BRANCHES";

            const heads = LANES.map((lane, i) => {
                const g = svgEl("g", { class: `gl-head gl-head--${lane.tone}` }, svg);
                svgEl("rect", { x: narrow ? 7 : 12, y: Y(i) - 6, width: 3, height: 12, rx: 1.5, class: "gl-swatch" }, g);
                svgEl("text", { x: narrow ? 15 : 23, y: Y(i) + 4, class: "gl-headtxt" }, g).textContent = narrow ? lane.short : lane.name;
                return g;
            });

            // conteúdo que se revela sob a agulha
            const content = svgEl("g", { class: "gl-content" }, svg);
            const lines = svgEl("g", { "clip-path": "url(#gl-reveal)" }, content);
            svgEl("path", { d: `M${gx0 - 8} ${Y(MAIN)}H${gx1 + 8}`, class: "gl-line gl-line--main" }, lines);
            const cd = clamp((gx1 - gx0) * 0.045, 16, 42);
            BRANCHES.forEach((b) => {
                const yb = Y(b.lane);
                const ym = Y(MAIN);
                const xf = X(b.from);
                let d = `M${xf} ${ym}C${xf + cd * 0.6} ${ym} ${xf + cd * 0.4} ${yb} ${xf + cd} ${yb}`;
                if (b.to != null) {
                    const xm = X(b.to);
                    d += `H${xm - cd}C${xm - cd * 0.4} ${yb} ${xm - cd * 0.6} ${ym} ${xm} ${ym}`;
                } else {
                    d += `H${X(b.end)}`;
                }
                svgEl("path", { d, class: `gl-line gl-line--${LANES[b.lane].tone}` }, lines);
            });
            const renderBar = svgEl("rect", { x: gx0, y: rulerH - 3, width: 0, height: 3, class: "gl-render" }, content);

            const nodesG = svgEl("g", null, content);
            const chipsG = svgEl("g", null, content);
            const nodes = [];
            const addNode = (u, lane, opt = {}) => {
                const tone = LANES[lane].tone;
                const glowTone = tone === "main" ? "violet" : tone;
                const cx = X(u);
                const cy = Y(lane);
                const cls = `gl-node gl-node--${tone}${opt.merge ? " gl-node--merge" : ""}${opt.ghost ? " gl-node--ghost" : ""}`;
                const n = {
                    u,
                    R: opt.merge ? 6.5 : opt.ghost ? 7 : 5.5,
                    ghost: !!opt.ghost,
                    dir: opt.dir || 0,
                    glow: svgEl("circle", { cx, cy, r: 20, fill: `url(#gl-glow-${glowTone})`, opacity: 0 }, nodesG),
                    ring: svgEl("circle", { cx, cy, r: 6, class: `gl-ring gl-ring--${tone}`, opacity: 0 }, nodesG),
                    node: svgEl("circle", { cx, cy, r: 0, class: cls }, nodesG),
                    chip: null,
                };
                if (opt.label) {
                    const g = svgEl("g", { class: `gl-chip gl-chip--${tone}`, opacity: 0 }, chipsG);
                    const rect = svgEl("rect", { rx: 6, height: 19 }, g);
                    const text = svgEl("text", { class: "gl-chiptxt" }, g);
                    text.textContent = opt.label;
                    let tw = 0;
                    try { tw = text.getComputedTextLength(); } catch (err) { tw = 0; }
                    if (!tw) tw = opt.label.length * 6.4;
                    const pw = tw + 14;
                    const left = clamp(cx - pw / 2, gx0 - 6, w - pw - 4);
                    const top = opt.dir > 0 ? cy + 11 : cy - 30;
                    rect.setAttribute("x", left.toFixed(1));
                    rect.setAttribute("y", top.toFixed(1));
                    rect.setAttribute("width", pw.toFixed(1));
                    text.setAttribute("x", (left + 7).toFixed(1));
                    text.setAttribute("y", (top + 13).toFixed(1));
                    n.chip = g;
                }
                nodes.push(n);
            };
            MAIN_COMMITS.forEach((c) => addNode(c.u, MAIN));
            BRANCHES.forEach((b) => {
                b.commits.forEach((c) => addNode(c.u, b.lane, { label: narrow ? c.tiny : c.tag, dir: b.chipDir, ghost: c.ghost }));
                if (b.to != null) addNode(b.to, MAIN, { merge: true });
            });

            const ph = svgEl("g", { class: "gl-ph" }, content);
            svgEl("line", { x1: 0, y1: 0, x2: 0, y2: h, class: "gl-ph__glow" }, ph);
            svgEl("line", { x1: 0, y1: 4, x2: 0, y2: h, class: "gl-ph__line" }, ph);
            svgEl("path", { d: "M-6 1h12v8l-6 6-6-6z", class: "gl-ph__head" }, ph);

            G = { w, h, gx0, gx1, X, reveal, renderBar, ph, content, nodes, heads };
            return true;
        }

        let lastMsg = null;
        let lastTc = "";
        let lastComment = null;

        function render(t) {
            if (!G) return;
            const moving = T.motion.on;
            // sem movimento: o quadro final, com tudo aceso e a sua branch esperando
            const c = moving ? t % CYCLE : PLAY + HOLD * 0.5;
            const p = Math.min(1, c / PLAY);
            let alpha = 1;
            if (moving) {
                if (c < 0.5) alpha = c / 0.5;
                else if (c > PLAY + HOLD) alpha = Math.max(0, 1 - (c - PLAY - HOLD) / FADE);
            }
            G.content.setAttribute("opacity", alpha.toFixed(3));
            const px = G.X(p);
            G.reveal.setAttribute("width", (p >= 1 ? G.w : px).toFixed(1));
            G.renderBar.setAttribute("width", Math.max(0, px - G.gx0).toFixed(1));
            G.ph.setAttribute("transform", `translate(${px.toFixed(1)} 0)`);

            for (const n of G.nodes) {
                const tau = c - n.u * PLAY; // segundos desde que a agulha passou
                if (tau < 0) {
                    n.node.setAttribute("r", "0");
                    n.ring.setAttribute("opacity", "0");
                    n.glow.setAttribute("opacity", "0");
                    if (n.chip) n.chip.setAttribute("opacity", "0");
                    continue;
                }
                const k = clamp(tau / 0.45, 0, 1);
                n.node.setAttribute("r", Math.max(0, n.R * easeOutBack(k)).toFixed(2));
                if (tau < 1) {
                    n.ring.setAttribute("r", (n.R + 16 * easeOutCubic(tau)).toFixed(2));
                    n.ring.setAttribute("opacity", (0.65 * (1 - tau)).toFixed(3));
                } else {
                    n.ring.setAttribute("opacity", "0");
                }
                n.glow.setAttribute("opacity", (0.3 + 0.7 * Math.max(0, 1 - tau / 1.2)).toFixed(3));
                if (n.chip) {
                    const kc = easeOutCubic(clamp((tau - 0.1) / 0.5, 0, 1));
                    n.chip.setAttribute("opacity", kc.toFixed(3));
                    n.chip.setAttribute("transform", `translate(0 ${(n.dir * 6 * (1 - kc)).toFixed(2)})`);
                }
                if (n.ghost && moving) n.node.style.strokeDashoffset = (-tau * 7).toFixed(2);
            }

            // terminal: o último evento que a agulha já cruzou, digitado
            let ev = null;
            for (const e of EVENTS) {
                if (e.u * PLAY <= c) ev = e;
                else break;
            }
            let text = "git log --graph --oneline";
            if (ev) {
                const typed = moving ? Math.floor((c - ev.u * PLAY) * CPS) : ev.msg.length;
                text = ev.msg.slice(0, clamp(typed, 1, ev.msg.length));
            }
            if (text !== lastMsg && cmdEl) {
                lastMsg = text;
                cmdEl.textContent = text;
                const isComment = text.charAt(0) === "#";
                if (isComment !== lastComment && term) {
                    lastComment = isComment;
                    term.classList.toggle("is-comment", isComment);
                }
            }
            const tc = T.timecode(p * SEQ);
            if (tc !== lastTc && tcEl) {
                lastTc = tc;
                tcEl.textContent = tc;
            }
            G.heads[4].classList.toggle("is-on", p >= 0.8);
        }

        build();
        render(0);
        const loop = T.loop(stage, (t) => render(t));
        T.onResize(stage, () => {
            if (G && Math.abs(stage.clientWidth - G.w) < 2 && Math.abs(stage.clientHeight - G.h) < 2) return;
            if (build()) loop.draw();
        });
    }

    /* ── Animações em CSS só com a peça na tela ─────────────────────────── */
    function initPlayGates() {
        const els = document.querySelectorAll("[data-play]");
        if (!els.length) return;
        if (!("IntersectionObserver" in window)) {
            els.forEach((el) => el.classList.add("is-playing"));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) e.target.classList.toggle("is-playing", e.isIntersecting);
        }, { rootMargin: "60px 0px" });
        els.forEach((el) => io.observe(el));
    }

    /* ── Roadmap: o trilho se preenche até a agulha "agora" ─────────────── */
    function initRoadmap() {
        const list = document.querySelector("[data-roadmap]");
        if (!list) return;
        const items = Array.from(list.querySelectorAll(".rm-item"));
        const now = list.querySelector(".rm-item--now");
        const NODE = 28; // centro do nó, a partir do topo de cada item
        let H = 1;
        let cap = 1;
        let marks = [];
        let ticking = false;
        let active = false;

        const measure = () => {
            H = Math.max(1, list.offsetHeight);
            cap = now ? (now.offsetTop + NODE) / H : 1;
            marks = items.map((it) => (it.offsetTop + NODE) / H);
        };
        const update = () => {
            ticking = false;
            let prog = cap;
            if (T.motion.on) {
                const r = list.getBoundingClientRect();
                prog = clamp((window.innerHeight * 0.62 - r.top) / Math.max(1, r.height), 0, cap);
            }
            const fill = clamp((prog * H - NODE) / Math.max(1, H - NODE), 0, 1);
            list.style.setProperty("--fill", fill.toFixed(4));
            items.forEach((it, i) => it.classList.toggle("is-lit", marks[i] <= prog + 0.001));
        };
        const onScroll = () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(update);
            }
        };

        measure();
        update();
        T.onResize(list, () => { measure(); update(); });
        T.motion.onChange(update);
        if ("IntersectionObserver" in window) {
            new IntersectionObserver((entries) => {
                const vis = entries[entries.length - 1].isIntersecting;
                if (vis && !active) {
                    active = true;
                    window.addEventListener("scroll", onScroll, { passive: true });
                    update();
                } else if (!vis && active) {
                    active = false;
                    window.removeEventListener("scroll", onScroll);
                }
            }, { rootMargin: "200px 0px" }).observe(list);
        } else {
            window.addEventListener("scroll", onScroll, { passive: true });
        }
    }

    /* ── Primeiro PR: uma luz percorre os cinco passos ──────────────────── */
    function initPrSteps() {
        const list = document.querySelector("[data-pr-steps]");
        if (!list) return;
        const steps = Array.from(list.querySelectorAll(".pr-step"));
        if (!steps.length) return;
        const spark = document.createElement("span");
        spark.className = "pr-spark";
        spark.setAttribute("aria-hidden", "true");
        list.appendChild(spark);

        let ys = [];
        const measure = () => {
            ys = steps.map((s) => {
                const node = s.querySelector(".pr-step__node");
                return s.offsetTop + (node ? node.offsetHeight / 2 : 24);
            });
        };
        measure();
        T.onResize(list, measure);

        const FIRST = 4.2; // primeira passada: acende um passo de cada vez
        const RUN = 2.4;   // depois, um pulso de luz a cada RUN + REST
        const REST = 6;
        const setLit = (fn) => steps.forEach((s, i) => s.classList.toggle("is-lit", fn(i)));
        const cool = () => steps.forEach((s) => s.classList.remove("is-hot"));

        T.loop(list, (t) => {
            if (!T.motion.on) {
                setLit(() => true);
                cool();
                spark.style.opacity = "0";
                return;
            }
            const y0 = ys[0];
            const y1 = ys[ys.length - 1];
            let y = null;
            if (t < FIRST) {
                y = lerp(y0, y1, easeInOutCubic(t / FIRST));
                setLit((i) => y >= ys[i] - 2);
            } else {
                setLit(() => true);
                const c = (t - FIRST) % (RUN + REST);
                if (c < RUN) y = lerp(y0, y1, easeInOutCubic(c / RUN));
            }
            if (y === null) {
                spark.style.opacity = "0";
                cool();
                return;
            }
            spark.style.opacity = "1";
            spark.style.transform = `translate3d(0, ${(y - 6).toFixed(1)}px, 0)`;
            steps.forEach((s, i) => s.classList.toggle("is-hot", Math.abs(y - ys[i]) < 22));
        });
    }

    /* ── Montador de mensagem de commit ─────────────────────────────────── */
    function initCommitBuilder() {
        const form = document.querySelector("[data-commit-builder]");
        if (!form) return;
        const out = form.querySelector("[data-cb-out]");
        const btn = form.querySelector(".copy-btn");
        const scopeIn = form.querySelector("#cb-scope");
        const descIn = form.querySelector("#cb-desc");
        if (!out || !scopeIn || !descIn) return;

        const update = () => {
            const checked = form.querySelector('input[name="cb-type"]:checked');
            const type = checked ? checked.value : "feat";
            const scope = scopeIn.value.trim().toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9à-ü._/-]/g, "")
                .replace(/^-+|-+$/g, "");
            const desc = descIn.value.trim().replace(/\s+/g, " ").replace(/"/g, "'") || "o que mudou, em poucas palavras";
            const msg = `${type}${scope ? `(${scope})` : ""}: ${desc}`;
            const k = document.createElement("span");
            k.className = "k";
            k.textContent = "git commit -m";
            const s = document.createElement("span");
            s.className = "s";
            s.textContent = `"${msg}"`;
            out.replaceChildren(k, " ", s);
            if (btn) btn.dataset.copy = `git commit -m "${msg}"`;
        };
        form.addEventListener("input", update);
        form.addEventListener("change", update);
        form.addEventListener("submit", (e) => e.preventDefault());
        update();
    }

    /* ── Explorador de pastas: o destaque desliza até a pasta escolhida ─── */
    function initExplorer() {
        const ex = document.querySelector("[data-explorer]");
        if (!ex) return;
        const box = ex.querySelector(".ex__tabs");
        const hl = ex.querySelector(".ex__hl");
        const panels = ex.querySelector(".ex__panels");
        if (!box || !hl) return;
        const narrow = window.matchMedia("(max-width: 760px)");

        const place = () => {
            const sel = box.querySelector('[aria-selected="true"]');
            if (!sel) return;
            hl.style.width = `${sel.offsetWidth}px`;
            hl.style.height = `${sel.offsetHeight}px`;
            hl.style.transform = `translate3d(${sel.offsetLeft}px, ${sel.offsetTop}px, 0)`;
        };

        let byPointer = false;
        box.addEventListener("pointerdown", () => { byPointer = true; });
        ex.addEventListener("talho:tab", () => {
            place();
            // no celular, a lista vem antes do painel: traz o painel à vista
            if (byPointer && narrow.matches && panels) {
                const r = panels.getBoundingClientRect();
                if (r.top > window.innerHeight - 160) {
                    panels.scrollIntoView({ block: "start", behavior: T.motion.on ? "smooth" : "auto" });
                }
            }
            byPointer = false;
        });
        place();
        requestAnimationFrame(() => hl.classList.add("is-ready"));
        T.onResize(box, place);
    }

    [initGitline, initPlayGates, initRoadmap, initPrSteps, initCommitBuilder, initExplorer].forEach((fn) => {
        try { fn(); } catch (err) { console.error(err); }
    });
})();
