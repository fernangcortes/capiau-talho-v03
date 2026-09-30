// Barra fina dos painéis laterais: três estados por coluna — aberta, barra, linha.
//
//   aberta → (seta de recolher do painel) → barra → (seta da barra) → linha
//   linha  → clique: volta ao estado de antes · duplo clique: aberta
//
// "Linha" é o recolher de sempre (WorkspaceManager.setPanelCollapsed + linha de expandir).
// "Barra" é novo: o painel sai do fluxo e fica uma coluna de 36 px com um botão por aba. Clicar
// num botão ativa a aba de verdade (o mesmo botão da faixa) e abre o painel ao lado da barra, no
// lugar dele na coluna: empurra monitores e timeline e se redimensiona pelo divisor de sempre.
// Clicar de novo no botão da aba aberta fecha. Cada painel abre e fecha sozinho: abrir a Biblioteca
// não fecha o Painel Lateral. As abas continuam as mesmas: destacar e trocar de
// menu seguem pelos botões da faixa, que aparecem no painel aberto.
//
// Vale em qualquer lugar do editor: coluna (barra em pé ao lado), pilha (barra deitada no lugar
// do painel, entre os vizinhos de cima e de baixo) e faixa (barra em pé entre os vizinhos; com
// todos da faixa na barra, a faixa encolhe e as barras deitam). Na janela destacada a seta
// continua recolhendo para a linha.

export const RAIL_PANELS = {
    "sidebar-left": { strip: "left-tabs", toggle: "toggle-left", icon: "fa-solid fa-folder-open", label: "Biblioteca" },
    "inspector-panel": { strip: null, toggle: "toggle-inspector", icon: "fa-solid fa-sliders", label: "Ajustes & Efeitos" },
    "sidebar-right": { strip: "right-tabs", toggle: "toggle-right", icon: "fa-solid fa-comment-dots", label: "Painel Lateral" },
};

export const RAIL_STORAGE_KEY = "capiau_rail_panels";


/** Lugares do editor onde o painel pode virar barra (WorkspaceManager.panelPlacement().kind). */
export const RAIL_PLACES = ["column", "stack", "band"];

/** A barra deita (horizontal) na pilha, ou na faixa quando todos dela estão na barra. Pura. */
export function railLying(kind, bandAllRail = false) {
    return kind === "stack" || (kind === "band" && bandAllRail);
}

/** Seta da barra: aponta para onde o painel recolhe (collapseEdge). Pura. */
export function railArrowIcon(edge, right = false) {
    const icons = { left: "fa-chevron-left", right: "fa-chevron-right", up: "fa-chevron-up", down: "fa-chevron-down" };
    return icons[edge] || (right ? icons.right : icons.left);
}

/** Próximo estado ao clicar na seta: aberta → barra → linha. Sem barra possível, aberta → linha. */
export function nextOnArrow(state, railAllowed) {
    if (state === "aberta") return railAllowed ? "barra" : "linha";
    if (state === "barra") return "linha";
    return "linha";
}

// Sem escolha salva: Ajustes começa na barra (a coluna menos usada sem clipe selecionado).
export const DEFAULT_RAIL = ["inspector-panel"];

export function loadRail(storage) {
    try {
        const saved = storage.getItem(RAIL_STORAGE_KEY);
        const list = saved === null ? DEFAULT_RAIL : JSON.parse(saved || "[]");
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
        this.openIds = new Set(); // painéis abertos pela barra agora (cada um independe dos outros)
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

    /** Pode virar barra agora: painel no editor (coluna, pilha ou faixa), nesta janela. */
    canRail(id) {
        const place = this.wm?.panelPlacement?.(id);
        return !!place && RAIL_PLACES.includes(place.kind) && place.el.ownerDocument === document;
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
        this.closeFlyout(id);
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
        const place = railOn ? this.wm?.panelPlacement?.(id) : null;
        const kind = place?.kind || "column";
        // Anfitrião da pilha é também a caixa dos de baixo: não some, só esconde o próprio conteúdo.
        const isHost = kind === "stack" && place.host === panel;
        const right = panel.classList.contains("dock-right");

        if (railOn) {
            if (kind === "column") {
                // Coluna: colada ao painel, do lado de fora do editor.
                if (right) { if (panel.nextElementSibling !== nav) panel.after(nav); }
                else if (panel.previousElementSibling !== nav) panel.before(nav);
            } else if (isHost) {
                if (panel.firstElementChild !== nav) panel.prepend(nav);
            } else if (panel.previousElementSibling !== nav) {
                // Pilha (convidado) ou faixa: no lugar do painel, entre os vizinhos.
                panel.before(nav);
            }
        }
        nav.hidden = !railOn;
        nav.dataset.place = railOn ? kind : "";
        nav.classList.toggle("panel-rail-right", railOn && kind === "column" && right);
        nav.classList.toggle("panel-rail-h", railOn && railLying(kind));
        panel.classList.toggle("rail-mode", railOn && !isHost);
        panel.classList.toggle("rail-open", railOn && !isHost && this.openIds.has(id));
        panel.classList.toggle("dock-stack-self-rail", railOn && isHost && !this.openIds.has(id));
        if (!railOn) {
            panel.classList.remove("dock-stack-self-rail");
            this.closeFlyout(id);
        }
        if (railOn) this.renderButtons(id);
        this.applyBands();
        this.wm?.refreshEdgeSplitters?.();
    }

    /**
     * Faixa com todos na barra (ou recolhidos): encolhe e as barras deitam. E o último painel
     * visível da faixa estica, para não sobrar buraco onde estava um painel que virou barra.
     */
    applyBands() {
        document.querySelectorAll(".dock-band > .dock-band-row").forEach(row => {
            const band = row.parentElement;
            const members = [...row.querySelectorAll(":scope > .dock-band-member")];
            const railClosed = (m) => m.classList.contains("rail-mode") && !m.classList.contains("rail-open");
            const hidden = (m) => railClosed(m) || m.classList.contains("collapsed");
            const allRail = members.some(railClosed) && members.every(hidden);
            band.classList.toggle("dock-band-all-rail", allRail);
            members.forEach(m => {
                const nav = this.rails[m.id];
                if (nav && !nav.hidden) nav.classList.toggle("panel-rail-h", railLying("band", allRail));
            });
            if (members.some(railClosed)) {
                const shown = members.filter(m => !hidden(m));
                members.forEach(m => m.classList.remove("dock-band-last"));
                if (shown.length) shown[shown.length - 1].classList.add("dock-band-last");
            }
        });
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
            if (this.openIds.has(id) && sameTab) this.closeFlyout(id);
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
        const open = this.openIds.has(id);
        const html = list.map((t, i) =>
            `<button type="button" class="panel-rail-btn${t.active ? " active" : ""}${t.active && open ? " open" : ""}" data-index="${i}" data-tooltip="${escapeAttr(t.label)}" aria-label="${escapeAttr(t.label)}" aria-expanded="${t.active && open}"><i class="${escapeAttr(t.icon)}"></i></button>`
        ).join("");
        const box = nav.querySelector(".panel-rail-tabs");
        if (box.innerHTML !== html) box.innerHTML = html;
        const down = nav.querySelector(".panel-rail-down i");
        const edge = nav.dataset.place === "column" ? null : this.wm?.collapseEdge?.(id);
        down.className = `fa-solid ${railArrowIcon(edge, nav.classList.contains("panel-rail-right"))}`;
    }

    // ── Painel aberto ao lado da barra ──────────────────────────────────────

    openFlyout(id) {
        if (this.stateOf(id) !== "barra") return;
        const panel = document.getElementById(id);
        if (!panel || this.openIds.has(id)) return;
        this.openIds.add(id);
        this.apply(id);
        this.wm?.refreshEdgeSplitters?.();
        window.dispatchEvent(new Event("resize")); // monitores, timeline e listas remedem
    }

    closeFlyout(id) {
        if (!this.openIds.has(id)) return;
        this.openIds.delete(id);
        document.getElementById(id)?.classList.remove("rail-open");
        if (this.stateOf(id) === "barra") this.apply(id);
        else this.renderButtons(id);
        this.wm?.refreshEdgeSplitters?.();
        window.dispatchEvent(new Event("resize"));
    }
}

function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
