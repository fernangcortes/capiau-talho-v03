// Janela de Aparência: flutuante, arrastável, sem escurecer o editor. Cada escolha vale na hora
// (ThemeManager.preview) e é gravada nas Configurações globais logo depois (ThemeManager.save).
// As mesmas chaves ui.* aparecem, completas, em Configurações → Aparência.

import { THEME_DEFAULTS, ACCENTS, BACKGROUNDS, backgroundOf, TRACK_MODES } from "./themeManager.js";

const POS_KEY = "capiau_appearance_pos";
const SAVE_DELAY = 450;

const ACCENT_NAMES = { padrao: "Padrão", ciano: "Ciano", azul: "Azul", verde_agua: "Verde-água", lima: "Lima", laranja: "Laranja", gelo: "Gelo" };
const BG_NAMES = { neutro: "Neutro", grafite: "Grafite", quente: "Quente", classico: "Clássico" };
const TRACK_NAMES = { coloridas: "Coloridas", dessaturadas: "Dessaturadas", mono: "Mono" };
const FONTS = [
    ["padrao", "Padrão (Inter + Outfit)", "'Inter', sans-serif"],
    ["roboto_flex", "Roboto Flex", "'Roboto Flex', sans-serif"],
    ["plex_condensed", "IBM Plex Sans Condensed", "'IBM Plex Sans Condensed', sans-serif"],
    ["barlow_semi_condensed", "Barlow Semi Condensed", "'Barlow Semi Condensed', sans-serif"],
    ["inter", "Inter em tudo", "'Inter', sans-serif"],
];
const WEIGHTS = [[300, "Leve"], [400, "Normal"], [500, "Médio"]];

/** Posição dentro da janela do navegador (a barra de título nunca some). Pura. */
export function clampPosition(x, y, w, vw, vh) {
    return {
        x: Math.round(Math.min(Math.max(x, 60 - w), vw - 60)),
        y: Math.round(Math.min(Math.max(y, 0), vh - 32)),
    };
}

export class AppearanceWindow {
    constructor({ themeManager, STATE }) {
        this.tm = themeManager;
        this.STATE = STATE;
        this.el = null;
        this.draft = {};
        this._timer = 0;
    }

    get values() {
        return { ...THEME_DEFAULTS, ...(this.tm?.saved || {}), ...this.draft };
    }

    toggle() {
        if (this.el && !this.el.hidden) this.close();
        else this.open();
    }

    open() {
        if (!this.el) this.build();
        this.el.hidden = false;
        this.render();
        this.place(this.loadPos());
        document.getElementById("btn-open-appearance")?.setAttribute("aria-expanded", "true");
        this.el.querySelector(".apw-close")?.focus();
    }

    close() {
        if (!this.el) return;
        this.flush();
        this.el.hidden = true;
        document.getElementById("btn-open-appearance")?.setAttribute("aria-expanded", "false");
    }

    // ── Valores ─────────────────────────────────────────────────────────────

    set(changes) {
        Object.assign(this.draft, changes);
        this.tm?.preview(this.draft);
        this.render();
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.flush(), SAVE_DELAY);
    }

    async flush() {
        clearTimeout(this._timer);
        const pending = this.draft;
        if (!Object.keys(pending).length) return;
        this.draft = {};
        try {
            await this.tm?.save(pending);
            this.status("");
        } catch (err) {
            console.warn("[Aparência] Não foi possível salvar:", err);
            this.draft = { ...pending, ...this.draft };
            this.status("Sem conexão com o servidor: vale nesta sessão, mas não foi salvo.");
        }
    }

    reset() {
        const defaults = {};
        for (const k of Object.keys(THEME_DEFAULTS)) defaults[k] = THEME_DEFAULTS[k];
        this.set(defaults);
    }

    status(text) {
        const s = this.el?.querySelector(".apw-status");
        if (s) s.textContent = text;
    }

    // ── Desenho ─────────────────────────────────────────────────────────────

    build() {
        const el = document.createElement("section");
        el.className = "apw";
        el.id = "appearance-window";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", "Aparência");
        el.hidden = true;
        el.innerHTML = `
            <header class="apw-title">
                <i class="fa-solid fa-grip-vertical apw-grip" aria-hidden="true"></i>
                <span class="apw-name">Aparência</span>
                <span class="apw-hint">arraste para mover</span>
                <button type="button" class="apw-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
            </header>
            <div class="apw-body">
                <div class="apw-sec">
                    <div class="apw-label">Cor de interação</div>
                    <div class="apw-swatches" data-group="accent"></div>
                    <div class="apw-note">Violeta (seleção da biblioteca), verde (ok) e rosa (erro) ficam de fora.</div>
                </div>
                <div class="apw-sec">
                    <div class="apw-label">Fundo</div>
                    <div class="apw-seg" data-group="background"></div>
                </div>
                <div class="apw-sec">
                    <div class="apw-label">Trilhas</div>
                    <div class="apw-seg" data-group="tracks"></div>
                </div>
                <div class="apw-sec">
                    <div class="apw-label">Fonte</div>
                    <div class="apw-fonts" data-group="font"></div>
                </div>
                <div class="apw-sec">
                    <div class="apw-label">Tamanho do texto <span class="apw-scale-val"></span></div>
                    <div class="apw-scale">
                        <button type="button" class="apw-mini" data-scale="-1" aria-label="Texto menor">A-</button>
                        <input type="range" min="90" max="120" step="5" aria-label="Tamanho do texto">
                        <button type="button" class="apw-mini" data-scale="1" aria-label="Texto maior">A+</button>
                    </div>
                </div>
                <div class="apw-sec">
                    <div class="apw-label">Peso do texto</div>
                    <div class="apw-seg" data-group="weight"></div>
                </div>
            </div>
            <footer class="apw-foot">
                <span class="apw-status" role="status"></span>
                <button type="button" class="apw-link" data-action="more">Mais opções…</button>
                <button type="button" class="apw-link" data-action="reset">Restaurar padrão</button>
            </footer>`;
        document.body.appendChild(el);
        this.el = el;

        el.querySelector(".apw-close").addEventListener("click", () => this.close());
        el.addEventListener("click", (e) => {
            const b = e.target.closest("button[data-value]");
            if (b) return this.pick(b.closest("[data-group]").dataset.group, b.dataset.value);
            const s = e.target.closest("button[data-scale]");
            if (s) return this.set({ "ui.font_scale": this.stepScale(Number(s.dataset.scale)) });
            const a = e.target.closest("button[data-action]");
            if (a?.dataset.action === "reset") this.reset();
            if (a?.dataset.action === "more") { this.close(); document.getElementById("btn-open-settings")?.click(); }
        });
        el.querySelector('input[type="range"]').addEventListener("input", (e) => {
            this.set({ "ui.font_scale": Math.round(Number(e.target.value)) / 100 });
        });
        el.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.stopPropagation(); this.close(); }
        });
        this.bindDrag(el.querySelector(".apw-title"));
        window.addEventListener("resize", () => { if (!el.hidden) this.place(this.loadPos()); });
        // Valores salvos mudaram (outra janela, Configurações): redesenha sem perder o rascunho.
        this.STATE?.on?.("settingsChanged", () => { if (!el.hidden) setTimeout(() => this.render(), 300); });
    }

    pick(group, value) {
        if (group === "accent") this.set({ "ui.accent": value });
        else if (group === "background") this.set({ ...BACKGROUNDS[value] });
        else if (group === "tracks") this.set({ "ui.track_mode": value });
        else if (group === "font") this.set({ "ui.font_family": value });
        else if (group === "weight") this.set({ "ui.font_weight": Number(value) });
    }

    stepScale(dir) {
        const cur = Math.round(Number(this.values["ui.font_scale"]) * 100);
        return Math.min(120, Math.max(90, cur + dir * 5)) / 100;
    }

    render() {
        if (!this.el) return;
        const v = this.values;
        const q = (sel) => this.el.querySelector(sel);
        const btn = (value, label, on, extra = "") =>
            `<button type="button" data-value="${value}" aria-pressed="${on}" class="${on ? "on" : ""}" ${extra}>${label}</button>`;

        q('[data-group="accent"]').innerHTML = Object.entries(ACCENTS).map(([k, hex]) =>
            btn(k, "", v["ui.accent"] === k,
                `style="--sw:${hex || "transparent"}" data-tooltip="${ACCENT_NAMES[k]}" aria-label="${ACCENT_NAMES[k]}"${hex ? "" : ' data-default="1"'}`)
        ).join("");

        const bg = backgroundOf(v);
        q('[data-group="background"]').innerHTML = Object.keys(BACKGROUNDS).map(k => btn(k, BG_NAMES[k], bg === k)).join("")
            + (bg ? "" : btn("", "Personalizado", true, "disabled"));

        q('[data-group="tracks"]').innerHTML = TRACK_MODES.map(k => btn(k, TRACK_NAMES[k], v["ui.track_mode"] === k)).join("");

        q('[data-group="font"]').innerHTML = FONTS.map(([k, label, css]) =>
            btn(k, `<span style="font-family:${css.replace(/"/g, "&quot;")}">${label}</span>`, v["ui.font_family"] === k)).join("");

        const w = Number(v["ui.font_weight"]);
        const nearest = WEIGHTS.reduce((a, b) => Math.abs(b[0] - w) < Math.abs(a[0] - w) ? b : a)[0];
        q('[data-group="weight"]').innerHTML = WEIGHTS.map(([k, label]) =>
            btn(k, `<span style="font-weight:${k}">${label}</span>`, nearest === k)).join("");

        const pct = Math.round(Number(v["ui.font_scale"]) * 100);
        q('input[type="range"]').value = String(pct);
        q(".apw-scale-val").textContent = `${pct}%`;
    }

    // ── Posição ─────────────────────────────────────────────────────────────

    loadPos() {
        try {
            const p = JSON.parse(localStorage.getItem(POS_KEY) || "null");
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
        } catch (e) {}
        return { x: window.innerWidth - 380, y: 48 };
    }

    place(p) {
        const r = clampPosition(p.x, p.y, this.el.offsetWidth || 320, window.innerWidth, window.innerHeight);
        this.el.style.left = `${r.x}px`;
        this.el.style.top = `${r.y}px`;
        return r;
    }

    bindDrag(bar) {
        bar.addEventListener("pointerdown", (e) => {
            if (e.button !== 0 || e.target.closest("button")) return;
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            const ox = this.el.offsetLeft, oy = this.el.offsetTop;
            bar.setPointerCapture(e.pointerId);
            this.el.classList.add("apw-dragging");
            const move = (ev) => this.place({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy });
            const up = (ev) => {
                bar.removeEventListener("pointermove", move);
                bar.removeEventListener("pointerup", up);
                bar.removeEventListener("pointercancel", up);
                this.el.classList.remove("apw-dragging");
                const r = this.place({ x: ox + ev.clientX - sx, y: oy + ev.clientY - sy });
                try { localStorage.setItem(POS_KEY, JSON.stringify(r)); } catch (err) {}
            };
            bar.addEventListener("pointermove", move);
            bar.addEventListener("pointerup", up);
            bar.addEventListener("pointercancel", up);
        });
    }
}
