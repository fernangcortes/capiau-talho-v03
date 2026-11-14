/* =============================================================================
   CapIAu-Talho — site de apresentação
   base.js: comportamento compartilhado por todas as páginas — cabeçalho, menu,
   revelação ao rolar, contadores, cópia, abas, subnavegação e o controle global
   de animações. Cada página carrega este arquivo e depois o próprio script.

   API pública em window.Talho (ver site/README.md):
     Talho.motion.on            true se as animações estão ligadas
     Talho.motion.set(bool)     liga/desliga (e salva a escolha)
     Talho.motion.onChange(fn)  fn(on) a cada mudança; devolve função p/ cancelar
     Talho.onVisible(el, fn, opções)   chama fn quando el entra na tela
     Talho.loop(el, fn)         laço de animação que só roda com el visível e
                                movimento ligado; fn(t, dt) com t em segundos.
                                Movimento desligado: fn é chamada 1x com dt = 0.
     Talho.fitCanvas(canvas)    ajusta o buffer ao tamanho real × DPR (máx. 2)
     Talho.onResize(el, fn)     ResizeObserver com coalescência por frame
     Talho.observeReveal(raiz)  liga data-reveal/data-inview em conteúdo novo
     Talho.toast(msg)           aviso flutuante
     Talho.copy(texto)          copia para a área de transferência
     Talho.timecode(seg, fps)   "HH:MM:SS:FF"
     Talho.math                 clamp, lerp, ease*, rand
   ========================================================================== */
(() => {
    "use strict";

    const root = document.documentElement;
    const STORAGE_KEY = "talho-motion";
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

    const store = {
        get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
        set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* sem armazenamento: vale só nesta visita */ } },
    };

    /* ── Matemática pequena ─────────────────────────────────────────────── */
    const math = {
        clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
        lerp: (a, b, t) => a + (b - a) * t,
        easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
        easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
        easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
        rand: (a, b) => a + Math.random() * (b - a),
    };

    function timecode(seconds, fps = 24) {
        const total = Math.max(0, Math.floor(seconds * fps));
        const ff = total % fps;
        const s = Math.floor(total / fps);
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
    }

    /* ── Movimento (animações ligadas/desligadas) ───────────────────────── */
    const motionListeners = new Set();
    function motionFromPrefs() {
        const saved = store.get();
        if (saved === "off") return false;
        if (saved === "on") return true;
        return !mqReduce.matches;
    }
    let motionOn = motionFromPrefs();

    function syncMotionUI() {
        const label = motionOn ? "Pausar animações" : "Retomar animações";
        document.querySelectorAll("[data-motion-toggle]").forEach((btn) => {
            const text = btn.querySelector("[data-motion-label]");
            if (text) text.textContent = label;
            else btn.setAttribute("aria-label", label);
            btn.setAttribute("title", label);
        });
    }

    function applyMotion() {
        if (motionOn) delete root.dataset.motion;
        else root.dataset.motion = "off";
        syncMotionUI();
        if (!motionOn) revealEverything();
        motionListeners.forEach((fn) => {
            try { fn(motionOn); } catch (err) { console.error(err); }
        });
    }

    const motion = {
        get on() { return motionOn; },
        set(on) { motionOn = !!on; store.set(motionOn ? "on" : "off"); applyMotion(); },
        toggle() { motion.set(!motionOn); },
        onChange(fn) { motionListeners.add(fn); return () => motionListeners.delete(fn); },
    };

    mqReduce.addEventListener?.("change", () => {
        if (store.get()) return; // a escolha explícita vence a do sistema
        motionOn = !mqReduce.matches;
        applyMotion();
    });

    /* ── Visibilidade ───────────────────────────────────────────────────── */
    function onVisible(el, fn, { once = true, threshold = 0, rootMargin = "0px 0px -10% 0px" } = {}) {
        if (!el) return () => {};
        if (!("IntersectionObserver" in window)) { fn(); return () => {}; }
        const io = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                fn(entry);
                if (once) { io.disconnect(); break; }
            }
        }, { threshold, rootMargin });
        io.observe(el);
        return () => io.disconnect();
    }

    /* ── Laço de animação econômico ─────────────────────────────────────── */
    function loop(el, fn, { rootMargin = "120px" } = {}) {
        let visible = false;
        let running = false;
        let stopped = false;
        let drewStatic = false;
        let raf = 0;
        let last = 0;
        let t = 0;

        const frame = (now) => {
            if (!running) return;
            const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
            last = now;
            t += dt;
            try { fn(t, dt); } catch (err) { console.error(err); stop(); return; }
            raf = requestAnimationFrame(frame);
        };

        function update() {
            const should = visible && motionOn && !document.hidden && !stopped;
            if (should && !running) {
                running = true;
                last = 0;
                raf = requestAnimationFrame(frame);
            } else if (!should && running) {
                running = false;
                cancelAnimationFrame(raf);
            }
            // sem movimento: desenha um quadro parado, uma vez por vez que aparece
            if (visible && !motionOn && !stopped && !drewStatic) {
                drewStatic = true;
                try { fn(t, 0); } catch (err) { console.error(err); }
            }
            if (motionOn) drewStatic = false;
        }

        const io = "IntersectionObserver" in window
            ? new IntersectionObserver((entries) => {
                visible = entries[entries.length - 1].isIntersecting;
                if (!visible) drewStatic = false;
                update();
            }, { rootMargin })
            : null;
        if (io) io.observe(el); else visible = true;

        const offMotion = motion.onChange(update);
        document.addEventListener("visibilitychange", update);
        if (!io) update();

        function stop() {
            stopped = true;
            running = false;
            cancelAnimationFrame(raf);
            io?.disconnect();
            offMotion();
            document.removeEventListener("visibilitychange", update);
        }

        return {
            stop,
            get running() { return running; },
            get time() { return t; },
            /** Redesenha um quadro agora (útil após resize com o laço parado). */
            draw() { try { fn(t, 0); } catch (err) { console.error(err); } },
        };
    }

    /* ── Canvas e redimensionamento ─────────────────────────────────────── */
    function fitCanvas(canvas, maxDpr = 2) {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, width: rect.width, height: rect.height, dpr };
    }

    function onResize(el, fn) {
        if (!("ResizeObserver" in window)) {
            const h = () => fn();
            window.addEventListener("resize", h);
            return () => window.removeEventListener("resize", h);
        }
        let raf = 0;
        const ro = new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => fn());
        });
        ro.observe(el);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }

    /* ── Revelação ao rolar ─────────────────────────────────────────────── */
    let revealIO = null;
    function markIn(el) {
        if (el.classList.contains("is-in")) return;
        el.classList.add("is-in");
        el.dispatchEvent(new CustomEvent("talho:reveal", { bubbles: true }));
    }
    function revealEverything() {
        document.querySelectorAll("[data-reveal], [data-inview]").forEach(markIn);
    }
    function applyStagger(scope) {
        scope.querySelectorAll("[data-reveal-stagger]").forEach((group) => {
            const step = parseInt(group.dataset.revealStagger, 10) || 80;
            const kids = Array.from(group.children).filter((c) => c.hasAttribute("data-reveal"));
            kids.forEach((c, i) => {
                if (!c.style.getPropertyValue("--d")) c.style.setProperty("--d", `${i * step}ms`);
            });
        });
    }
    function observeReveal(scope = document) {
        applyStagger(scope);
        const els = scope.querySelectorAll("[data-reveal]:not(.is-in), [data-inview]:not(.is-in)");
        if (!motionOn || !("IntersectionObserver" in window)) { els.forEach(markIn); return; }
        if (!revealIO) {
            revealIO = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    markIn(entry.target);
                    revealIO.unobserve(entry.target);
                }
            }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
        }
        els.forEach((el) => revealIO.observe(el));
    }

    /* ── Contadores: data-count-to (+ -from, -decimals, -prefix, -suffix, -duration) */
    function initCounters() {
        document.querySelectorAll("[data-count-to]").forEach((el) => {
            const to = parseFloat(el.dataset.countTo);
            if (!Number.isFinite(to)) return;
            const from = parseFloat(el.dataset.countFrom || "0");
            const decimals = parseInt(el.dataset.countDecimals || "0", 10);
            const duration = parseFloat(el.dataset.countDuration || "1.8") * 1000;
            const prefix = el.dataset.countPrefix || "";
            const suffix = el.dataset.countSuffix || "";
            const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
            const render = (v) => { el.textContent = prefix + fmt.format(v) + suffix; };
            if (!motionOn) { render(to); return; }
            render(from);
            onVisible(el, () => {
                if (!motionOn) { render(to); return; }
                const t0 = performance.now();
                const step = (now) => {
                    const p = Math.min(1, (now - t0) / duration);
                    render(from + (to - from) * math.easeOutQuart(p));
                    if (p < 1 && motionOn) requestAnimationFrame(step);
                    else render(to);
                };
                requestAnimationFrame(step);
            }, { rootMargin: "0px 0px -15% 0px" });
        });
    }

    /* ── Aviso flutuante ────────────────────────────────────────────────── */
    let toastEl = null;
    let toastTimer = 0;
    function toast(message, ms = 2200) {
        if (!toastEl) {
            toastEl = document.createElement("div");
            toastEl.className = "toast";
            toastEl.setAttribute("role", "status");
            toastEl.setAttribute("aria-live", "polite");
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = message;
        requestAnimationFrame(() => toastEl.classList.add("is-visible"));
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), ms);
    }

    /* ── Copiar ─────────────────────────────────────────────────────────── */
    async function copy(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch { ok = false; }
            ta.remove();
            return ok;
        }
    }
    function initCopy() {
        document.addEventListener("click", async (ev) => {
            const btn = ev.target.closest("[data-copy]");
            if (!btn) return;
            let text = btn.dataset.copy;
            if (!text) {
                const pre = btn.closest(".code")?.querySelector("pre");
                text = pre ? pre.innerText.replace(/\n+$/, "") : "";
            }
            if (!text) return;
            const ok = await copy(text);
            if (!ok) { toast("Não deu para copiar — selecione o texto à mão."); return; }
            btn.classList.add("is-copied");
            toast("Copiado para a área de transferência");
            setTimeout(() => btn.classList.remove("is-copied"), 1600);
        });
    }

    /* ── Abas acessíveis: [data-tabs] com [role=tab][aria-controls] ─────── */
    function initTabs() {
        document.querySelectorAll("[data-tabs]").forEach((group) => {
            const tabs = Array.from(group.querySelectorAll('[role="tab"]')).filter((t) => t.closest("[data-tabs]") === group);
            if (!tabs.length) return;
            const select = (tab, focus = false) => {
                tabs.forEach((t) => {
                    const on = t === tab;
                    t.setAttribute("aria-selected", String(on));
                    t.tabIndex = on ? 0 : -1;
                    const panel = document.getElementById(t.getAttribute("aria-controls"));
                    if (panel) panel.hidden = !on;
                });
                if (focus) tab.focus();
                group.dispatchEvent(new CustomEvent("talho:tab", { bubbles: true, detail: { tab, panelId: tab.getAttribute("aria-controls") } }));
            };
            tabs.forEach((t, i) => {
                t.addEventListener("click", () => select(t));
                t.addEventListener("keydown", (e) => {
                    let j = null;
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tabs.length;
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tabs.length) % tabs.length;
                    else if (e.key === "Home") j = 0;
                    else if (e.key === "End") j = tabs.length - 1;
                    if (j !== null) { e.preventDefault(); select(tabs[j], true); }
                });
            });
            select(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]);
        });
    }

    /* ── Subnavegação com destaque da seção atual: [data-subnav] ────────── */
    function initSubnav() {
        const nav = document.querySelector("[data-subnav]");
        if (!nav) return;
        const list = nav.querySelector(".subnav__list") || nav;
        const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
        const pairs = links
            .map((a) => ({ a, el: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
            .filter((p) => p.el);
        if (!pairs.length) return;
        const setH = () => root.style.setProperty("--subnav-h", `${nav.offsetHeight}px`);
        setH();
        onResize(nav, setH);

        let active = null;
        const setActive = (a) => {
            if (a === active) return;
            if (active) { active.classList.remove("is-active"); active.removeAttribute("aria-current"); }
            active = a;
            if (!a) return;
            a.classList.add("is-active");
            a.setAttribute("aria-current", "true");
            const left = a.offsetLeft - (list.clientWidth - a.offsetWidth) / 2;
            list.scrollTo({ left: Math.max(0, left), behavior: motionOn ? "smooth" : "auto" });
        };
        let ticking = false;
        const spy = () => {
            ticking = false;
            const line = (parseFloat(getComputedStyle(root).getPropertyValue("--header-h")) || 64) + nav.offsetHeight + 40;
            let current = null;
            for (const p of pairs) {
                if (p.el.getBoundingClientRect().top - line <= 0) current = p.a;
            }
            const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
            setActive(atBottom ? pairs[pairs.length - 1].a : current);
        };
        window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
        spy();
    }

    /* ── Cabeçalho: estado de rolagem, agulha de progresso e timecode ───── */
    function initHeader() {
        const header = document.querySelector("[data-header]");
        const tc = document.querySelector("[data-scroll-timecode]");
        const PX_PER_SECOND = 90; // a página "dura" 1 s a cada 90 px rolados
        let ticking = false;
        const update = () => {
            ticking = false;
            const y = window.scrollY;
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const p = max > 0 ? math.clamp(y / max, 0, 1) : 0;
            if (header) {
                header.classList.toggle("is-scrolled", y > 8);
                header.style.setProperty("--progress", p.toFixed(4));
            }
            if (tc) tc.textContent = timecode(y / PX_PER_SECOND);
        };
        window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
        window.addEventListener("resize", update, { passive: true });
        update();

        // página atual no menu
        const page = document.body.dataset.page;
        if (page) {
            document.querySelectorAll(`[data-nav-id="${page}"]`).forEach((a) => a.setAttribute("aria-current", "page"));
        }
    }

    /* ── Menu no celular ────────────────────────────────────────────────── */
    function initNavToggle() {
        const btn = document.querySelector(".nav-toggle");
        const nav = document.getElementById(btn?.getAttribute("aria-controls") || "");
        if (!btn || !nav) return;
        const setOpen = (open) => {
            btn.setAttribute("aria-expanded", String(open));
            btn.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
            nav.classList.toggle("is-open", open);
            document.body.classList.toggle("nav-open", open);
        };
        btn.addEventListener("click", () => setOpen(btn.getAttribute("aria-expanded") !== "true"));
        nav.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false); });
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { setOpen(false); btn.focus(); }
        });
        window.matchMedia("(min-width: 981px)").addEventListener?.("change", (mq) => { if (mq.matches) setOpen(false); });
    }

    /* ── Brilho que segue o cursor em [data-glow] ───────────────────────── */
    function initGlow() {
        document.addEventListener("pointermove", (e) => {
            if (!finePointer.matches) return;
            const el = e.target.closest?.("[data-glow]");
            if (!el) return;
            const r = el.getBoundingClientRect();
            el.style.setProperty("--mx", `${e.clientX - r.left}px`);
            el.style.setProperty("--my", `${e.clientY - r.top}px`);
        }, { passive: true });
    }

    /* ── Miudezas ───────────────────────────────────────────────────────── */
    function initMisc() {
        document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = String(new Date().getFullYear()); });
        document.querySelectorAll('a[target="_blank"]').forEach((a) => {
            const rel = new Set((a.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
            rel.add("noopener");
            a.setAttribute("rel", Array.from(rel).join(" "));
        });
        document.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-motion-toggle]");
            if (!btn) return;
            motion.toggle();
            toast(motionOn ? "Animações retomadas" : "Animações pausadas");
        });
    }

    /* ── Início ─────────────────────────────────────────────────────────── */
    window.Talho = {
        motion,
        onVisible,
        loop,
        fitCanvas,
        onResize,
        observeReveal,
        toast,
        copy,
        timecode,
        math,
        pages: {},
    };

    applyMotion();
    initHeader();
    initNavToggle();
    observeReveal(document);
    initCounters();
    initCopy();
    initTabs();
    initSubnav();
    initGlow();
    initMisc();
    root.classList.add("talho-ready");
})();
