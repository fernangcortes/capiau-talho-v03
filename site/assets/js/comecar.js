/* =============================================================================
   CapIAu-Talho — site de apresentação
   comecar.js: só a página Começar — o terminal que digita no topo, o simulador
   de chaves, os passos que acendem ao rolar, o trilho dos primeiros passos, as
   marcas de "feito" na subnavegação, o liga/desliga das ilustrações em laço e
   os links que abrem uma pergunta do FAQ.
   Tudo respeita Talho.motion: com o movimento desligado, cada peça mostra o
   seu estado final, parado e completo.
   ========================================================================== */
(() => {
    "use strict";

    const T = window.Talho;
    if (!T) return;
    const root = document.documentElement;
    const $ = (sel, el = document) => el.querySelector(sel);
    const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

    /* ── 1. Terminal que digita ─────────────────────────────────────────── */
    function initTerminal() {
        const term = $("[data-term]");
        if (!term) return;
        const lines = $$(".cm-term__line", term);
        const cursor = $(".cm-term__cursor", term);
        const pct = $(".cm-term__pct", term);
        const replay = $("[data-term-replay]", term);
        if (!lines.length || !cursor) return;

        const cmds = new Map();
        lines.forEach((line) => {
            const span = $("[data-type]", line);
            if (span) cmds.set(line, { span, text: span.textContent });
        });
        const last = lines[lines.length - 1];
        let token = 0;

        // espera que devolve false se a animação foi cancelada nesse meio-tempo
        const sleep = (ms, my) => new Promise((resolve) => setTimeout(() => resolve(my === token), ms));

        function finish() {
            token++;
            cmds.forEach(({ span, text }) => { span.textContent = text; });
            lines.forEach((l) => l.classList.add("is-shown", "is-run"));
            if (pct) pct.textContent = "100%";
            last.appendChild(cursor);
            term.classList.remove("is-typing");
            term.classList.add("is-done");
        }

        function runMeter(line, my) {
            line.classList.add("is-run");
            if (!pct) return;
            const t0 = performance.now();
            const tick = (now) => {
                if (my !== token) return;
                const p = Math.min(1, (now - t0) / 1900);
                pct.textContent = `${Math.round(T.math.easeInOutCubic(p) * 100)}%`;
                if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }

        async function play() {
            if (!T.motion.on) { finish(); return; }
            const my = ++token;
            term.classList.remove("is-done");
            term.classList.add("is-typing");
            lines.forEach((l) => l.classList.remove("is-shown", "is-run"));
            cmds.forEach(({ span }) => { span.textContent = ""; });
            if (pct) pct.textContent = "0%";

            for (const line of lines) {
                const cmd = cmds.get(line);
                if (cmd) {
                    // o texto inteiro fica no lugar (transparente) para nada pular de linha
                    const done = document.createElement("span");
                    const rest = document.createElement("span");
                    rest.className = "cm-term__rest";
                    rest.textContent = cmd.text;
                    cmd.span.textContent = "";
                    cmd.span.append(done, cursor, rest);
                    line.classList.add("is-shown");
                    if (!(await sleep(480, my))) return;
                    for (let i = 1; i <= cmd.text.length; i++) {
                        done.textContent = cmd.text.slice(0, i);
                        rest.textContent = cmd.text.slice(i);
                        if (!(await sleep(22 + Math.random() * 40, my))) return;
                    }
                    if (!(await sleep(340, my))) return;
                    cmd.span.textContent = cmd.text;
                } else if (line.classList.contains("cm-term__progress")) {
                    line.classList.add("is-shown");
                    if (!(await sleep(60, my))) return;
                    runMeter(line, my);
                    if (!(await sleep(2050, my))) return;
                } else {
                    if (!(await sleep(line === last ? 520 : 170 + Math.random() * 260, my))) return;
                    line.classList.add("is-shown");
                }
            }
            finish();
        }

        const r = term.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) play();
        else T.onVisible(term, () => play(), { rootMargin: "0px" });
        T.motion.onChange((on) => { if (!on) finish(); });
        if (replay) replay.addEventListener("click", () => play());
    }

    /* ── 2. Simulador de chaves: o que cada chave acende ────────────────── */
    function initKeySim() {
        const sim = $("[data-keysim]");
        if (!sim) return;
        const keys = $$("[data-key]", sim);
        const feats = $$("[data-need]", sim);
        const status = $("[data-keysim-status]", sim);
        const names = { openrouter: "OpenRouter", asr: "AssemblyAI ou Deepgram", auphonic: "Auphonic" };
        const active = new Set();
        const total = feats.length;
        const local = feats.filter((f) => f.dataset.need === "local").length;
        const join = (arr) => (arr.length < 2 ? arr.join("") : `${arr.slice(0, -1).join(", ")} e ${arr[arr.length - 1]}`);

        function render(changed) {
            let lit = 0;
            let k = 0;
            feats.forEach((f) => {
                const need = f.dataset.need;
                const on = need === "local" || active.has(need);
                if (on) lit++;
                if (on && need === changed && !f.classList.contains("is-on")) f.style.setProperty("--k", `${k++ * 90}ms`);
                f.classList.toggle("is-on", on);
            });
            if (!status) return;
            const chosen = keys.filter((b) => active.has(b.dataset.key)).map((b) => names[b.dataset.key]);
            status.textContent = chosen.length
                ? `Com ${join(chosen)}: ${lit} de ${total} itens ligados. A parte em nuvem é cobrada pelo provedor, por uso, na sua conta.`
                : `Sem chave nenhuma: ${local} de ${total} itens desta lista já funcionam — todos na sua máquina.`;
        }

        keys.forEach((btn) => btn.addEventListener("click", () => {
            const key = btn.dataset.key;
            const on = btn.getAttribute("aria-pressed") !== "true";
            btn.setAttribute("aria-pressed", String(on));
            if (on) active.add(key); else active.delete(key);
            render(on ? key : null);
        }));
        render(null);
    }

    /* ── 3. Passos que acendem ao rolar ([data-cm-lit]) ─────────────────── */
    function initLit() {
        const els = $$("[data-cm-lit]");
        if (!els.length) return;
        const lightAll = () => els.forEach((el) => el.classList.add("is-lit"));
        T.motion.onChange((on) => { if (!on) lightAll(); });
        if (!T.motion.on || !("IntersectionObserver" in window)) { lightAll(); return; }
        // funciona também dentro da aba escondida: acende quando a aba aparece
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (!e.isIntersecting) return;
                e.target.classList.add("is-lit");
                io.unobserve(e.target);
            });
        }, { rootMargin: "0px 0px -18% 0px" });
        els.forEach((el) => io.observe(el));
        root.classList.add("cm-lit-ready");
    }

    /* ── 4. Subnavegação: passos já percorridos ganham um "feito" ───────── */
    function initSubnavDone() {
        const nav = $("[data-subnav]");
        if (!nav) return;
        const links = $$('a[href^="#"]', nav);
        let ticking = false;
        const mark = () => {
            ticking = false;
            const idx = links.findIndex((a) => a.classList.contains("is-active"));
            links.forEach((a, i) => a.classList.toggle("is-done", idx > -1 && i < idx));
        };
        window.addEventListener("scroll", () => {
            if (!ticking) { ticking = true; requestAnimationFrame(mark); }
        }, { passive: true });
        requestAnimationFrame(mark);
    }

    /* ── 5. Trilho dos primeiros passos: a agulha acompanha a rolagem ───── */
    function initWalk() {
        const walk = $(".cm-walk");
        if (!walk) return;
        let ticking = false;
        const update = () => {
            ticking = false;
            if (!T.motion.on) { walk.style.setProperty("--walk", "1"); return; }
            const r = walk.getBoundingClientRect();
            const p = T.math.clamp((window.innerHeight * 0.6 - r.top) / Math.max(1, r.height), 0, 1);
            walk.style.setProperty("--walk", p.toFixed(4));
        };
        const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
        window.addEventListener("scroll", request, { passive: true });
        window.addEventListener("resize", request, { passive: true });
        T.motion.onChange(request);
        update();
    }

    /* ── 6. Ilustrações em laço: só rodam enquanto aparecem ─────────────── */
    function initLoops() {
        const els = $$(".cm-anim");
        if (!els.length || !("IntersectionObserver" in window)) return;
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => e.target.classList.toggle("is-playing", e.isIntersecting));
        }, { rootMargin: "60px 0px" });
        els.forEach((el) => io.observe(el));
        root.classList.add("cm-io");
    }

    /* ── 7. Links para uma pergunta do FAQ abrem a resposta ─────────────── */
    function initFaqLinks() {
        const openFor = (id) => {
            const el = id && document.getElementById(id);
            if (el && el.tagName === "DETAILS") el.open = true;
        };
        document.addEventListener("click", (e) => {
            const a = e.target.closest('a[href^="#"]');
            if (a) openFor(decodeURIComponent(a.hash.slice(1)));
        });
        window.addEventListener("hashchange", () => openFor(decodeURIComponent(location.hash.slice(1))));
        openFor(decodeURIComponent(location.hash.slice(1)));
    }

    initTerminal();
    initKeySim();
    initLit();
    initSubnavDone();
    initWalk();
    initLoops();
    initFaqLinks();
})();
