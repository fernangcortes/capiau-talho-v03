// Barra fina dos painéis laterais: três estados por coluna — aberta, barra, linha.
//
//   aberta → (seta de recolher do painel) → barra → (seta da barra) → linha
//   linha  → clique: volta ao estado de antes · duplo clique: aberta
//
// "Linha" é o recolher de sempre (WorkspaceManager.setPanelCollapsed + linha de expandir).
// "Barra" é novo: o painel sai do fluxo e fica uma coluna de 36 px com um botão por aba. Clicar
// num botão ativa a aba de verdade (o mesmo botão da faixa) e abre o painel ao lado da barra, no
// lugar dele na coluna: empurra monitores e timeline e se redimensiona pelo divisor de sempre.
// Clicar de novo no botão da aba aberta fecha. As abas continuam as mesmas: destacar e trocar de
// menu seguem pelos botões da faixa, que aparecem no painel aberto.
//
// Só vale para o painel numa coluna do editor. Numa pilha, faixa ou janela destacada a seta
// continua recolhendo para a linha, como antes.

export const RAIL_PANELS = {
    "sidebar-left": { strip: "left-tabs", toggle: "toggle-left", icon: "fa-solid fa-folder-open", label: "Biblioteca" },
    "inspector-panel": { strip: null, toggle: "toggle-inspector", icon: "fa-solid fa-sliders", label: "Ajustes & Efeitos" },
    "sidebar-right": { strip: "right-tabs", toggle: "toggle-right", icon: "fa-solid fa-comment-dots", label: "Painel Lateral" },
};

export const RAIL_STORAGE_KEY = "capiau_rail_panels";


/** Próximo estado ao clicar na seta: aberta → barra → linha. Sem barra possível, aberta → linha. */
export function nextOnArrow(state, railAllowed) {
    if (state === "aberta") return railAllowed ? "barra" : "linha";
    if (state === "barra") return "linha";
    return "linha";
}

export function loadRail(storage) {
    try {
        const list = JSON.parse(storage.getItem(RAIL_STORAGE_KEY) || "[]");
        return new Set((Array.isArray(list) ? list : []).filter(id => id in RAIL_PANELS));
    } catch (e) {
        return new Set();
    }
}

export function saveRail(storage, ids) {
    try {
        storage.setItem(RAIL_STORAGE_KEY, JSON.stringify([...ids].filter(id => id in RAIL_PANELS)));
    } catch (e) {}
}

/** Botões visíveis da faixa de abas, como a barra deve mostrá-los. */
export function stripTabs(strip) {
    if (!strip) return [];
    return [...strip.querySelectorAll(":scope > .tab-btn")]
        .filter(b => b.style.display !== "none" && !b.hidden)
        .map(b => ({
            button: b,
            icon: b.querySelector("i")?.className || "fa-solid fa-circle",
            label: (b.getAttribute("title") || b.getAttribute("data-tooltip") || b.textContent || "").trim(),
            active: b.classList.contains("active"),
        }));
}

export class PanelRail {
    /**
     * collapse(panelId): recolhe para a linha pelo caminho de sempre (main.js collapseSidebar).
     * beforeHide(panelId): chamado antes de o painel sair do fluxo (barra ou linha).
     */
    constructor({ workspaceManager, storage = window.localStorage, collapse = null, beforeHide = null } = {}) {
        this.wm = workspaceManager;
        this.collapse = collapse;
        this.beforeHide = beforeHide;
        this.storage = storage;
        this.rail = loadRail(storage);
        this.rails = {};      // panelId -> <nav>
        this.openId = null;   // painel aberto ao lado da barra agora
        this._raf = 0;
    }

    init() {
        for (const id of Object.keys(RAIL_PANELS)) {
            const panel = document.getElementById(id);
            if (!panel) continue;
            this.rails[id] = this.buildRail(id);
            const strip = RAIL_PANELS[id].strip && document.getElementById(RAIL_PANELS[id].strip);
            if (strip) {
                new MutationObserver(() => this.renderButtons(id))
                    .observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
            }
        }

        window.addEventListener("resize", () => this.scheduleApply());

        // Linha de expandir: duplo clique leva direto para "aberta".
        for (const id of Object.keys(RAIL_PANELS)) {
            const line = document.getElementById({ "sidebar-left": "reopen-left", "inspector-panel": "reopen-inspector", "sidebar-right": "reopen-right" }[id]);
            line?.addEventListener("dblclick", () => this.setState(id, "aberta"));
        }

        this.applyAll();
    }

    // ── Estado ──────────────────────────────────────────────────────────────

    isRail(id) {
        return this.rail.has(id);
    }

    /** Pode virar barra agora: painel numa coluna do editor, nesta janela. */
    canRail(id) {
        const place = this.wm?.panelPlacement?.(id);
        return !!place && place.kind === "column" && place.el.ownerDocument === document;
    }

    stateOf(id) {
        if (this.wm?.isPanelCollapsed(id)) return "linha";
        return this.rail.has(id) && this.canRail(id) ? "barra" : "aberta";
    }

    /** Seta de recolher do painel ou da barra. */
    stepDown(id) {
        this.setState(id, nextOnArrow(this.stateOf(id), this.canRail(id)));
    }

    setState(id, state) {
        if (!(id in RAIL_PANELS)) return;
        const panel = document.getElementById(id);
        if (state === "aberta") this.rail.delete(id);
        if (state === "barra") this.rail.add(id);
        // "linha" guarda a barra (se havia) para a linha devolver ao estado de antes.
        saveRail(this.storage, this.rail);
        if (this.openId === id) this.closeFlyout();
        if (state !== "aberta") this.beforeHide?.(id);
        if (state === "linha" && this.collapse) this.collapse(id);
        else this.wm?.setPanelCollapsed(id, state === "linha");
        this.apply(id);
        window.dispatchEvent(new Event("resize"));
    }

    /** Quem entrega resultado num painel (busca, IA) chama isto: na barra, abre o painel. */
    reveal(id) {
        if (this.stateOf(id) === "barra") this.openFlyout(id);
    }

    // ── Desenho ─────────────────────────────────────────────────────────────

    scheduleApply() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this.applyAll(); });
    }

    applyAll() {
        Object.keys(this.rails).forEach(id => this.apply(id));
    }

    apply(id) {
        const panel = document.getElementById(id);
        const nav = this.rails[id];
        if (!panel || !nav) return;
        const state = this.stateOf(id);
        const railOn = state === "barra";

        // A barra fica colada ao painel, do lado de fora do editor.
        const right = panel.classList.contains("dock-right");
        if (railOn) {
            if (right) { if (panel.nextElementSibling !== nav) panel.after(nav); }
            else if (panel.previousElementSibling !== nav) panel.before(nav);
        }
        nav.hidden = !railOn;
        nav.classList.toggle("panel-rail-right", right);
        panel.classList.toggle("rail-mode", railOn);
        if (!railOn && this.openId === id) this.closeFlyout();
        if (railOn) this.renderButtons(id);
        this.wm?.refreshEdgeSplitters?.();
    }

    buildRail(id) {
        const cfg = RAIL_PANELS[id];
        const nav = document.createElement("nav");
        nav.className = "panel-rail";
        nav.id = `rail-${id}`;
        nav.hidden = true;
        nav.setAttribute("aria-label", cfg.label);
        nav.innerHTML = `<div class="panel-rail-tabs"></div><div class="panel-rail-spacer"></div>
            <button type="button" class="panel-rail-btn panel-rail-down" data-tooltip="Recolher para linha" aria-label="Recolher ${cfg.label} para linha"><i class="fa-solid fa-chevron-left"></i></button>`;
        nav.querySelector(".panel-rail-down").addEventListener("click", () => this.setState(id, "linha"));
        nav.querySelector(".panel-rail-tabs").addEventListener("click", (e) => {
            const b = e.target.closest(".panel-rail-btn");
            if (!b) return;
            const tab = this._tabs?.[id]?.[Number(b.dataset.index)];
            const sameTab = !tab || tab.active;
            if (tab && !tab.active) tab.button.click();
            if (this.openId === id && sameTab) this.closeFlyout();
            else this.openFlyout(id);
        });
        nav.querySelector(".panel-rail-tabs").addEventListener("dblclick", (e) => {
            if (e.target.closest(".panel-rail-btn")) this.setState(id, "aberta");
        });
        // Duplo clique no fundo da barra também fixa aberta.
        nav.addEventListener("dblclick", (e) => {
            if (!e.target.closest("button")) this.setState(id, "aberta");
        });
        return nav;
    }

    renderButtons(id) {
        const nav = this.rails[id];
        if (!nav || nav.hidden) return;
        const cfg = RAIL_PANELS[id];
        const strip = cfg.strip && document.getElementById(cfg.strip);
        const tabs = strip ? stripTabs(strip) : [];
        const list = tabs.length ? tabs : [{ button: null, icon: cfg.icon, label: cfg.label, active: true }];
        this._tabs = this._tabs || {};
        this._tabs[id] = list;
        const open = this.openId === id;
        const html = list.map((t, i) =>
            `<button type="button" class="panel-rail-btn${t.active ? " active" : ""}${t.active && open ? " open" : ""}" data-index="${i}" data-tooltip="${escapeAttr(t.label)}" aria-label="${escapeAttr(t.label)}" aria-expanded="${t.active && open}"><i class="${escapeAttr(t.icon)}"></i></button>`
        ).join("");
        const box = nav.querySelector(".panel-rail-tabs");
        if (box.innerHTML !== html) box.innerHTML = html;
        const down = nav.querySelector(".panel-rail-down i");
        down.className = `fa-solid ${nav.classList.contains("panel-rail-right") ? "fa-chevron-right" : "fa-chevron-left"}`;
    }

    // ── Painel aberto ao lado da barra ──────────────────────────────────────

    openFlyout(id) {
        if (this.stateOf(id) !== "barra") return;
        if (this.openId && this.openId !== id) this.closeFlyout();
        const panel = document.getElementById(id);
        if (!panel) return;
        this.openId = id;
        panel.classList.add("rail-open");
        this.renderButtons(id);
        this.wm?.refreshEdgeSplitters?.();
        window.dispatchEvent(new Event("resize")); // monitores, timeline e listas remedem
    }

    closeFlyout() {
        const id = this.openId;
        if (!id) return;
        this.openId = null;
        document.getElementById(id)?.classList.remove("rail-open");
        this.renderButtons(id);
        this.wm?.refreshEdgeSplitters?.();
        window.dispatchEvent(new Event("resize"));
    }
}

function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
