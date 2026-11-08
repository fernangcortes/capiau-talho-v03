/* =============================================================================
   CapIAu-Talho — site de apresentação
   como-funciona.js: demos da página "Como funciona".
   - [data-live] e afins: classe .is-live só com o elemento na tela (as animações
     CSS em laço dependem dela, então nada roda fora da tela)
   - topo: pacotes correndo do HD até a timeline, passando pelas estações
   - camadas: fios que se desenham ao rolar + pacotes nos fios
   - caminho de uma mídia: scrollytelling (monitor fixo no desktop, cartões no celular)
   - privacidade: interruptor "modo só local"
   Movimento desligado: Talho.loop desenha um quadro parado; o CSS já mostra o
   estado final de tudo.
   ========================================================================== */
(() => {
    "use strict";

    const T = window.Talho;
    if (!T) return;
    const { clamp } = T.math;
    const NS = "http://www.w3.org/2000/svg";
    const f1 = (n) => String(Math.round(n * 10) / 10);

    /* ── .is-live: laços CSS só enquanto o elemento aparece ─────────────── */
    function initLive() {
        const els = document.querySelectorAll("[data-live], [data-flow], [data-layers], [data-path], [data-vault]");
        if (!("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("is-live")); return; }
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) e.target.classList.toggle("is-live", e.isIntersecting);
        }, { rootMargin: "80px 0px" });
        els.forEach((el) => io.observe(el));
    }

    /* ── Topo: do disco à timeline ──────────────────────────────────────── */
    function initFlow() {
        const fig = document.querySelector("[data-flow]");
        if (!fig) return;
        const body = fig.querySelector(".cf-flow__body");
        const svg = fig.querySelector(".cf-flow__svg");
        const track = svg && svg.querySelector(".cf-flow__track");
        const belt = svg && svg.querySelector(".cf-flow__belt");
        const gPk = svg && svg.querySelector("[data-packets]");
        const stations = Array.from(fig.querySelectorAll(".cf-st"));
        const nodes = stations.map((s) => s.querySelector(".cf-st__node"));
        if (!body || !track || !belt || !gPk || nodes.length < 2 || nodes.some((n) => !n)) return;
        const tc = fig.querySelector("[data-flow-tc]");
        const mini = fig.querySelector("[data-mini]");
        const lanes = mini ? Array.from(mini.querySelectorAll("[data-lane]")) : [];
        const head = mini ? mini.querySelector(".cf-mini__head") : null;
        const staticHTML = lanes.map((l) => l.innerHTML);

        // geometria: o trilho passa pelo centro de cada estação, na ordem do DOM
        let pts = [];
        let cum = [0];
        let total = 1;
        let violetFrom = Infinity;
        function layout() {
            const br = body.getBoundingClientRect();
            if (!br.width || !br.height) return false;
            svg.setAttribute("viewBox", `0 0 ${f1(br.width)} ${f1(br.height)}`);
            pts = nodes.map((n) => {
                const r = n.getBoundingClientRect();
                return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2 };
            });
            const d = pts.map((p, i) => `${i ? "L" : "M"}${f1(p.x)} ${f1(p.y)}`).join(" ");
            track.setAttribute("d", d);
            belt.setAttribute("d", d);
            cum = [0];
            for (let i = 1; i < pts.length; i++) {
                cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
            }
            total = cum[cum.length - 1] || 1;
            violetFrom = cum.length > 5 ? cum[5] : Infinity; // depois de "Cortes e beats" o pacote vira vetor
            return true;
        }
        function at(s) {
            let i = 1;
            while (i < cum.length - 1 && cum[i] < s) i++;
            const a = pts[i - 1];
            const b = pts[i];
            const seg = (cum[i] - cum[i - 1]) || 1;
            const k = clamp((s - cum[i - 1]) / seg, 0, 1);
            return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        }

        // pacotes: um conjunto fixo, reaproveitado
        const pool = [];
        for (let i = 0; i < 9; i++) {
            const g = document.createElementNS(NS, "g");
            g.setAttribute("class", "cf-pk");
            const halo = document.createElementNS(NS, "circle");
            halo.setAttribute("r", "9");
            halo.setAttribute("class", "cf-pk__halo");
            const core = document.createElementNS(NS, "circle");
            core.setAttribute("r", "4");
            g.append(halo, core);
            g.style.opacity = "0";
            gPk.appendChild(g);
            pool.push({ g, s: -1, violet: false });
        }
        function place(p, s) {
            const q = at(s);
            p.g.setAttribute("transform", `translate(${f1(q.x)} ${f1(q.y)})`);
            const v = s >= violetFrom;
            if (v !== p.violet) {
                p.violet = v;
                p.g.setAttribute("class", v ? "cf-pk cf-pk--violet" : "cf-pk");
            }
        }

        // estação acende quando um pacote passa por ela
        const hit = stations.map(() => false);
        function setHits() {
            for (let j = 0; j < stations.length; j++) {
                let on = false;
                for (const p of pool) {
                    if (p.s >= 0 && Math.abs(p.s - cum[j]) < 13) { on = true; break; }
                }
                if (on !== hit[j]) { hit[j] = on; stations[j].classList.toggle("is-hit", on); }
            }
        }
        function clearHits() {
            stations.forEach((s) => s.classList.remove("is-hit"));
            hit.fill(false);
        }

        // mini-timeline: cada pacote que chega vira um clipe
        const ORDER = [1, 2, 0, 1, 2, 1, 0, 2]; // V1, A1, V2…
        let fill = [0, 0, 0];
        let landed = 0;
        function measureFill() {
            fill = lanes.map((l) => Array.from(l.children)
                .reduce((acc, el) => acc + (parseFloat(el.style.getPropertyValue("--w")) || 0) + 2, 0));
        }
        function setHead(pct) { if (head) head.style.setProperty("--ph", `${clamp(pct, 2, 98)}%`); }
        function resetMini(full) {
            lanes.forEach((l, i) => { l.innerHTML = full ? staticHTML[i] : ""; });
            measureFill();
            setHead(full ? 92 : 3);
        }
        function land() {
            if (!lanes.length) return;
            const li = ORDER[landed % ORDER.length];
            landed++;
            const w = 14 + Math.round(Math.random() * 18);
            if (fill[li] + w > 100) resetMini(false);
            const clip = document.createElement("i");
            clip.style.setProperty("--w", `${w}%`);
            clip.className = "is-new";
            lanes[li].appendChild(clip);
            fill[li] += w + 2;
            setHead(fill[li] - 2);
        }

        // quadro parado (movimento desligado): pacotes no meio de alguns trechos
        const STATIC_SPOTS = [0.5, 2.5, 4.5, 6.5];
        function drawStatic() {
            pool.forEach((p, k) => {
                p.s = -1;
                const spot = STATIC_SPOTS[k];
                if (spot === undefined || spot >= pts.length - 1) { p.g.style.opacity = "0"; return; }
                const i = Math.floor(spot);
                place(p, cum[i] + (cum[i + 1] - cum[i]) * (spot - i));
                p.g.style.opacity = "1";
            });
            clearHits();
            resetMini(true);
            if (tc) tc.textContent = T.timecode(0);
        }

        let running = false;
        let spawn = 0;
        const SPAWN_EVERY = 1.2;
        function start() {
            running = true;
            spawn = 0;
            landed = 0;
            resetMini(true);
            pool.forEach((p) => { p.s = -1; p.g.style.opacity = "0"; });
            [0.12, 0.36, 0.6, 0.84].forEach((k, i) => { pool[i].s = total * k; }); // já começa em movimento
        }

        const loop = T.loop(fig, (t, dt) => {
            if (!pts.length && !layout()) return;
            if (!T.motion.on) { running = false; drawStatic(); return; }
            if (!running) start();
            const speed = clamp(total / 6.4, 90, 240); // px/s: a viagem inteira leva uns 6 s
            spawn += dt;
            if (spawn >= SPAWN_EVERY) {
                spawn = 0;
                const free = pool.find((p) => p.s < 0);
                if (free) free.s = 0;
            }
            for (const p of pool) {
                if (p.s < 0) continue;
                p.s += speed * dt;
                if (p.s >= total) { p.s = -1; p.g.style.opacity = "0"; land(); continue; }
                place(p, p.s);
                p.g.style.opacity = clamp(Math.min(p.s, total - p.s) / 26, 0, 1).toFixed(2);
            }
            setHits();
            if (tc) tc.textContent = T.timecode(t);
        });

        layout();
        T.onResize(body, () => { if (layout()) loop.draw(); });
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (layout()) loop.draw(); });
    }

    /* ── 01 · Camadas: fios entre as caixas ─────────────────────────────── */
    function initLayers() {
        const root = document.querySelector("[data-layers]");
        if (!root) return;
        const svg = root.querySelector(".cf-layers__wires");
        const machine = root.querySelector(".cf-machine");
        const box = {};
        ["storage", "backend", "frontend", "cloud"].forEach((n) => { box[n] = root.querySelector(`[data-layer="${n}"]`); });
        if (!svg || !machine || Object.values(box).some((b) => !b)) return;
        const KEYS = ["storage-backend", "backend-frontend", "backend-cloud"];
        const wire = {};
        const label = {};
        KEYS.forEach((k) => {
            wire[k] = svg.querySelector(`[data-wire="${k}"]`);
            label[k] = svg.querySelector(`[data-wire-label="${k}"]`);
        });
        if (KEYS.some((k) => !wire[k])) return;
        const gPk = svg.querySelector("[data-wire-packets]");
        const len = {};

        function rel(el, rr) {
            const r = el.getBoundingClientRect();
            return {
                l: r.left - rr.left, t: r.top - rr.top, r: r.right - rr.left, b: r.bottom - rr.top,
                cx: r.left - rr.left + r.width / 2, cy: r.top - rr.top + r.height / 2,
            };
        }
        function setLabel(k, x, y, anchor) {
            const el = label[k];
            if (!el) return;
            el.setAttribute("x", f1(x));
            el.setAttribute("y", f1(y));
            el.setAttribute("text-anchor", anchor);
        }
        function layout() {
            const rr = root.getBoundingClientRect();
            if (!rr.width || !rr.height) return false;
            svg.setAttribute("viewBox", `0 0 ${f1(rr.width)} ${f1(rr.height)}`);
            const S = rel(box.storage, rr);
            const K = rel(box.backend, rr);
            const F = rel(box.frontend, rr);
            const C = rel(box.cloud, rr);
            const M = rel(machine, rr);
            const row = S.r <= K.l + 1 && Math.abs(S.t - K.t) < 4;
            let d1, d2, d3;
            if (row) {
                // desktop: armazenamento | backend | frontend lado a lado; a nuvem em cima do backend
                const y = K.t + 43; // altura da linha dos ícones
                d1 = `M${f1(S.r)} ${f1(y)} H${f1(K.l)}`;
                d2 = `M${f1(K.r)} ${f1(y)} H${f1(F.l)}`;
                d3 = `M${f1(K.cx)} ${f1(C.b)} V${f1(K.t)}`;
                setLabel("storage-backend", (S.r + K.l) / 2, y - 10, "middle");
                setLabel("backend-frontend", (K.r + F.l) / 2, y - 10, "middle");
                setLabel("backend-cloud", K.cx + 12, (C.b + M.t) / 2 + 4, "start");
            } else {
                // celular: caixas empilhadas; o fio da nuvem desce pela faixa da direita
                d1 = `M${f1(S.cx)} ${f1(S.b)} V${f1(K.t)}`;
                d2 = `M${f1(K.cx)} ${f1(K.b)} V${f1(F.t)}`;
                const lane = M.r - 18;
                const r = 10;
                const y0 = K.t + 43;
                const y1 = C.t + 43;
                d3 = `M${f1(K.r)} ${f1(y0)} H${f1(lane - r)} Q${f1(lane)} ${f1(y0)} ${f1(lane)} ${f1(y0 + r)}`
                    + ` V${f1(y1 - r)} Q${f1(lane)} ${f1(y1)} ${f1(lane - r)} ${f1(y1)} H${f1(C.r)}`;
                setLabel("storage-backend", S.cx + 12, (S.b + K.t) / 2 + 4, "start");
                setLabel("backend-frontend", K.cx + 12, (K.b + F.t) / 2 + 4, "start");
                setLabel("backend-cloud", lane - 10, (M.b + C.t) / 2 + 4, "end");
            }
            wire["storage-backend"].setAttribute("d", d1);
            wire["backend-frontend"].setAttribute("d", d2);
            wire["backend-cloud"].setAttribute("d", d3);
            KEYS.forEach((k) => {
                let L = 0;
                try { L = wire[k].getTotalLength(); } catch (err) { L = 0; }
                len[k] = L;
                wire[k].style.setProperty("--len", f1(L + 1));
            });
            return true;
        }

        // pacotes nos fios: leitura do HD, conversa com o navegador e, raro, a nuvem
        const PK = [
            { k: "storage-backend", v: 70, o: 0, c: "cf-wpk cf-wpk--emerald" },
            { k: "storage-backend", v: 70, o: 0.5, c: "cf-wpk cf-wpk--emerald" },
            { k: "backend-frontend", v: 70, o: 0.15, c: "cf-wpk" },
            { k: "backend-frontend", v: 70, o: 0.65, c: "cf-wpk", back: true },
            { k: "backend-cloud", v: 46, o: 0.3, c: "cf-wpk cf-wpk--amber" },
        ].map((p) => {
            const el = document.createElementNS(NS, "circle");
            el.setAttribute("r", "3.5");
            el.setAttribute("class", p.c);
            if (gPk) gPk.appendChild(el);
            return Object.assign({ el }, p);
        });
        let shownAt = 0;
        root.addEventListener("talho:reveal", (e) => { if (e.target === root) shownAt = performance.now(); });

        T.loop(root, (t) => {
            const ready = T.motion.on && root.classList.contains("is-in") && performance.now() - shownAt > 2300;
            for (const p of PK) {
                const L = len[p.k];
                if (!ready || !L) { p.el.style.opacity = "0"; continue; }
                let s = (t * p.v + p.o * L) % L;
                if (p.back) s = L - s;
                const q = wire[p.k].getPointAtLength(s);
                p.el.setAttribute("cx", f1(q.x));
                p.el.setAttribute("cy", f1(q.y));
                p.el.style.opacity = clamp(Math.min(s, L - s) / 14, 0, 1).toFixed(2);
            }
        });

        // fios "por desenhar" só quando há movimento e a seção ainda não apareceu
        if (layout() && T.motion.on && !root.classList.contains("is-in")) root.classList.add("is-armed");
        T.motion.onChange((on) => { if (!on) root.classList.remove("is-armed"); });
        T.onResize(root, layout);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
    }

    /* ── 02 · O caminho de uma mídia (scrollytelling) ───────────────────── */
    function initPath() {
        const root = document.querySelector("[data-path]");
        if (!root) return;
        const steps = Array.from(root.querySelectorAll("[data-step]"));
        if (!steps.length) return;
        const stage = root.querySelector(".cf-stage");
        const scenes = stage ? Array.from(stage.querySelectorAll("[data-scene]")) : [];
        const label = root.querySelector("[data-stage-label]");
        const ticks = stage ? Array.from(stage.querySelectorAll(".cf-stage__ticks i")) : [];

        // no celular cada parada mostra a própria cena: uma cópia da cena do monitor
        // (as cenas não têm id, então a cópia não duplica nada)
        const clones = steps.map((st, i) => {
            const slot = st.querySelector(".cf-step__visual");
            const sc = scenes[i];
            if (!slot || !sc) return null;
            const c = sc.cloneNode(true);
            c.classList.remove("is-active");
            c.removeAttribute("data-scene");
            slot.appendChild(c);
            return c;
        });

        const pad = (n) => String(n).padStart(2, "0");
        let active = -1;
        function setActive(i) {
            if (i < 0 || i === active) return;
            active = i;
            steps.forEach((s, j) => s.classList.toggle("is-active", j === i));
            scenes.forEach((s, j) => s.classList.toggle("is-active", j === i));
            clones.forEach((c, j) => { if (c) c.classList.toggle("is-active", j === i); });
            ticks.forEach((tk, j) => {
                tk.classList.toggle("is-on", j === i);
                tk.classList.toggle("is-done", j < i);
            });
            if (stage) stage.style.setProperty("--p", String(i / Math.max(1, steps.length - 1)));
            if (label) label.textContent = `Parada ${pad(i + 1)} · ${steps[i].dataset.title || ""}`;
        }
        setActive(0);

        if (!("IntersectionObserver" in window)) return;
        // a parada ativa é a que cruza a faixa do meio da tela
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) if (e.isIntersecting) setActive(steps.indexOf(e.target));
        }, { rootMargin: "-46% 0px -46% 0px", threshold: 0 });
        steps.forEach((s) => io.observe(s));
    }

    /* ── 03 · Privacidade: interruptor "modo só local" ──────────────────── */
    function initLocal() {
        const root = document.querySelector("[data-local]");
        if (!root) return;
        const sw = root.querySelector("[data-local-switch]");
        if (!sw) return;
        const stateEl = root.querySelector("[data-switch-state]");
        const summary = root.querySelector("[data-local-summary]");
        const vault = root.querySelector("[data-vault]");
        const feats = Array.from(root.querySelectorAll(".cf-feat"));
        const nLocal = feats.filter((f) => f.dataset.kind === "local").length;
        const nCloud = feats.length - nLocal;
        const msgOff = summary ? summary.textContent.trim() : "";
        const msgOn = `Sem nenhuma chave: ${nLocal} de ${feats.length} funções seguem rodando na sua máquina. `
            + `As outras ${nCloud} precisam de chave de nuvem: descrições, títulos, temas, resumos e o agente `
            + "não têm modelo local hoje, e o Auphonic é um serviço externo.";

        function apply(on, announce) {
            sw.setAttribute("aria-checked", on ? "true" : "false");
            if (stateEl) stateEl.textContent = on ? "Ligado" : "Desligado";
            root.classList.toggle("is-local", on);
            if (vault) vault.classList.toggle("is-local", on);
            feats.forEach((f) => {
                const st = f.querySelector(".cf-feat__state");
                if (st) st.textContent = on ? st.dataset.on : st.dataset.off;
            });
            if (summary && announce) summary.textContent = on ? msgOn : msgOff;
        }
        sw.addEventListener("click", () => apply(sw.getAttribute("aria-checked") !== "true", true));
        apply(false, false);
    }

    initLive();
    initFlow();
    initLayers();
    initPath();
    initLocal();
})();
