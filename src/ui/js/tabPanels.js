// Abas internas que viram painéis próprios (fase F5 do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// F5a: abas do Painel Lateral (Falas com o inspetor de falas, Visão, Chat, Busca, Tarefas, Logs).
// F5b: abas da Biblioteca (Temas, Rostos, Títulos, Docs). Mídias fica: é o corpo da Biblioteca
// (busca, filtros e rolagem virtual) — destacá-la é o mesmo que destacar a Biblioteca, que já existe.
//
// Arrastar a aba para fora do editor (ou "Destacar em nova janela" no menu da faixa) leva o conteúdo
// da aba para uma janela destacada; soltar sobre uma janela destacada junta (até 4 painéis, F4).
// A aba destacada é um painel "tabpanel-<aba>": um invólucro com cabeçalho (alça, título, busca
// própria quando a aba usa busca, devolver) que usa toda a máquina existente de janelas, grupos,
// desfazer e restauração ao abrir.
//
// P14: a aba também pode mudar de menu (Temas no Painel Lateral, Falas na Biblioteca...). No outro
// menu ela é uma "convidada": o mesmo invólucro, montado no corpo daquele menu, com um botão próprio
// na faixa. Destacar, juntar e devolver continuam iguais; ao voltar da janela ela volta ao menu
// onde estava. O menu de cada aba entra no layout (desfazer/refazer e workspaces).

import { DOCK_PANELS } from "./dockDrag.js";
import { bindTabButtonDrag, saveStripOrder } from "./tabsCustomization.js";

const STRIPS_KEY = "capiau_tab_strips";
const SIDE_LABEL = { left: "a Biblioteca", right: "o Painel Lateral" };

export const RIGHT_TABS = {
    transcript: { title: "Falas", icon: "fa-microphone", container: "transcript-container" },
    vision: { title: "Visão IA", icon: "fa-eye", container: "vision-container" },
    chat: { title: "Chat IA", icon: "fa-comments", container: "chat-container" },
    search: { title: "Busca", icon: "fa-magnifying-glass", container: "search-container" },
    tasks: { title: "Tarefas", icon: "fa-list-check", container: "tasks-container" },
    logs: { title: "Logs", icon: "fa-terminal", container: "logs-container" }
};

// search: a aba destacada ganha campo de busca próprio (a busca da Biblioteca fica com a Mídias).
export const LEFT_TABS = {
    themes: { title: "Temas", icon: "fa-tags", container: "tab-themes", search: "Buscar temas..." },
    faces: { title: "Rostos", icon: "fa-user-friends", container: "tab-faces", search: "Buscar rostos..." },
    titles: { title: "Títulos", icon: "fa-font", container: "tab-titles" },
    docs: { title: "Docs", icon: "fa-file-text", container: "tab-docs", search: "Buscar documentos..." }
};

const TABS = {
    ...Object.fromEntries(Object.entries(RIGHT_TABS).map(([k, v]) => [k, { ...v, side: "right" }])),
    ...Object.fromEntries(Object.entries(LEFT_TABS).map(([k, v]) => [k, { ...v, side: "left" }]))
};

export const tabPanelId = (tab) => `tabpanel-${tab}`;

/** Faixa e corpo de cada menu. */
function stripEl(side) {
    return document.getElementById(side === "right" ? "right-tabs" : "left-tabs");
}
function stripBody(side) {
    return document.querySelector(side === "right" ? "#sidebar-right .sidebar-content" : "#sidebar-left .sidebar-content.scrollable");
}

/** Chave do botão na ordem salva da faixa (a mesma do tabsCustomization). */
const stripKey = (c) => c.getAttribute("data-tab") || c.getAttribute("data-right-tab") || (c.dataset.guestTab ? `guest:${c.dataset.guestTab}` : null);

/** Só as abas que mudaram de menu: { aba: "left" | "right" }. */
export function normalizeTabStrips(strips) {
    const out = {};
    if (!strips || typeof strips !== "object") return out;
    Object.keys(strips).sort().forEach(tab => {
        const side = strips[tab];
        if (TABS[tab] && (side === "left" || side === "right") && side !== TABS[tab].side) out[tab] = side;
    });
    return out;
}
export const TAB_PANEL_IDS = Object.keys(TABS).map(tabPanelId);
const tabOf = (panelId) => (typeof panelId === "string" && panelId.startsWith("tabpanel-") && TABS[panelId.slice(9)] ? panelId.slice(9) : null);

/** Botão da aba na faixa do seu menu. */
function tabButton(tab) {
    const meta = TABS[tab];
    return meta.side === "right"
        ? document.querySelector(`#right-tabs .tab-btn[data-right-tab="${tab}"]`)
        : document.querySelector(`#left-tabs .tab-btn[data-tab="${meta.container}"]`);
}

/** Aba da faixa a partir do valor do botão (data-right-tab ou data-tab). */
export function tabFromButtonValue(value) {
    if (RIGHT_TABS[value]) return value;
    return Object.keys(LEFT_TABS).find(k => LEFT_TABS[k].container === value) || null;
}

export class TabPanels {
    constructor(workspaceManager, dockDrag) {
        this.wm = workspaceManager;
        this.dockDrag = dockDrag;
        this.homes = {}; // tab -> { parent, next } lugar original do contêiner na faixa
        this.searchInputs = {}; // tab -> campo de busca próprio da aba destacada

        this.host = document.createElement("div");
        this.host.id = "dock-tabpanel-host";
        this.host.hidden = true;
        document.body.appendChild(this.host);

        // P14: menu de cada aba que mudou de menu.
        this.strips = {};
        try { this.strips = normalizeTabStrips(JSON.parse(localStorage.getItem(STRIPS_KEY) || "{}")); } catch (e) {}
        // Clicar numa aba nativa esconde a convidada ativa daquele menu (o clique nativo faz o resto).
        ["left", "right"].forEach(side => {
            stripEl(side)?.addEventListener("click", (e) => {
                const btn = e.target.closest(".tab-btn");
                if (btn && !btn.dataset.guestTab) this.deactivateGuests(side);
            }, true);
        });

        Object.entries(TABS).forEach(([tab, meta]) => {
            DOCK_PANELS[tabPanelId(tab)] = { title: meta.title, header: `#${tabPanelId(tab)} .tab-panel-header`, kind: "tab" };
        });

        // Busca própria (F5b): Temas, Rostos e Docs leem daqui quando destacados; null = busca da Biblioteca.
        window.dockTabSearchQuery = (containerId) => {
            const tab = Object.keys(LEFT_TABS).find(k => LEFT_TABS[k].container === containerId);
            const input = tab && this.isOut(tab) ? this.searchInputs[tab] : null;
            return input ? input.value.trim() : null;
        };

        // Qualquer caminho que leve o painel da aba para uma janela (simples, grupo, desfazer,
        // restaurar ao abrir) precisa do invólucro montado; ao voltar, o conteúdo volta à faixa.
        const attach = this.wm.attachPanelToPopout.bind(this.wm);
        this.wm.attachPanelToPopout = (panelId, win, ...rest) => {
            const tab = tabOf(panelId);
            if (tab) this.leaveGuestStrip(tab);
            if (tab) this.prepare(tab);
            const result = attach(panelId, win, ...rest);
            if (tab) this.onWindowReady(tab, win);
            if (tab) this.syncGuestButton(tab);
            return result;
        };
        const toggle = this.wm.togglePopout.bind(this.wm);
        this.wm.togglePopout = (panelId, ...rest) => {
            const tab = tabOf(panelId);
            const win = window.popoutWindows?.[panelId];
            const opening = tab && !(win && !win.closed);
            if (opening) this.prepare(tab);
            const result = toggle(panelId, ...rest);
            if (opening) {
                const opened = window.popoutWindows?.[panelId];
                if (!opened || opened.closed) this.returnToStrip(tab); // bloqueado pelo navegador
                else this.syncGuestButton(tab);
            }
            return result;
        };
        const restore = this.wm.restorePanel.bind(this.wm);
        this.wm.restorePanel = (panelId, ...rest) => {
            const result = restore(panelId, ...rest);
            const tab = tabOf(panelId);
            if (tab) this.returnToStrip(tab);
            return result;
        };
    }

    isOut(tab) {
        const meta = TABS[tab];
        return !!document.getElementById(meta?.container)?.dataset.dockOut
            || !!this.wm.poppedElements?.[tabPanelId(tab)]?.querySelector?.(`#${meta.container}`);
    }

    /** O invólucro está numa janela destacada (simples ou com vários painéis). */
    inWindow(tab) {
        const id = tabPanelId(tab);
        const wrapper = document.getElementById(id) || this.wm.poppedElements?.[id];
        return !!wrapper && wrapper.ownerDocument !== document;
    }

    /** Monta as abas que estavam no outro menu (sessão anterior). Chamado quando a página assenta. */
    mountSavedStrips() {
        Object.keys(this.strips).forEach(tab => this.mountGuest(tab, null));
        // A aba ativa salva pode ter mudado de menu: cada faixa sem aba ativa ativa a primeira.
        ["left", "right"].forEach(side => {
            const strip = stripEl(side);
            if (strip && !strip.querySelector(".tab-btn.active, .tab-btn.dock-guest-active")) this.activateFirst(strip);
        });
    }

    /**
     * P14: leva a aba para o menu "side" (antes do botão "before" na faixa, ou no fim).
     * Voltar ao menu de origem desfaz a convidada. Retorna true se mudou algo.
     */
    moveToStrip(tab, side, before = null, { commit = true, activate = true } = {}) {
        const meta = TABS[tab];
        if (!meta || (side !== "left" && side !== "right")) return false;
        const current = this.strips[tab] || meta.side;
        if (current === side) return false;
        if (side === meta.side) {
            delete this.strips[tab];
            this.saveStrips();
            this.removeGuestButton(tab);
            if (!this.inWindow(tab)) {
                this.returnToStrip(tab, { activate });
                const btn = tabButton(tab);
                if (btn && before && before.parentElement === btn.parentElement) btn.parentElement.insertBefore(btn, before);
            }
        } else {
            this.strips[tab] = side;
            this.saveStrips();
            this.mountGuest(tab, before);
            if (activate && !this.inWindow(tab)) this.activateGuest(tab);
        }
        this.revealSidebar(tab, side);
        this.syncSidebarVisibility();
        saveStripOrder(stripEl("left"));
        saveStripOrder(stripEl("right"));
        if (commit) {
            this.wm.scheduleLayoutCommit?.();
            this.dockDrag?.showToast("undo", `${meta.title} movida para ${SIDE_LABEL[side]}`);
        }
        return true;
    }

    getStrips() {
        return { ...this.strips };
    }

    /** Aplica o menu de cada aba (desfazer/refazer, workspaces). */
    applyStrips(target) {
        const want = normalizeTabStrips(target);
        Object.keys(TABS).forEach(tab => {
            const side = want[tab] || TABS[tab].side;
            if ((this.strips[tab] || TABS[tab].side) !== side) this.moveToStrip(tab, side, null, { commit: false, activate: false });
        });
    }

    saveStrips() {
        try { localStorage.setItem(STRIPS_KEY, JSON.stringify(this.strips)); } catch (e) {}
    }

    /** Recolhido na mão, o Painel Lateral abre quando recebe uma aba. */
    revealSidebar(tab, side) {
        if (side !== "right") return;
        const sidebar = document.getElementById("sidebar-right");
        const btn = this.strips[tab] ? this.guestButton(tab) : tabButton(tab);
        if (sidebar?.classList.contains("collapsed") && btn && btn.style.display !== "none") {
            this.autoCollapsed = false;
            document.getElementById("reopen-right")?.click();
        }
    }

    /** Monta a aba como convidada no outro menu: invólucro no corpo do menu + botão na faixa. */
    mountGuest(tab, before) {
        const side = this.strips[tab];
        const strip = stripEl(side);
        const body = stripBody(side);
        if (!side || !strip || !body) return;
        let btn = this.guestButton(tab);
        if (!btn || btn.parentElement !== strip) {
            btn?.remove();
            btn = this.createGuestButton(tab, side);
        }
        const remembered = this.lastNext?.[tab] ? [...strip.children].find(c => stripKey(c) === this.lastNext[tab]) : null;
        if (before && before.parentElement === strip && before !== btn) strip.insertBefore(btn, before);
        else if (!btn.parentElement && remembered) strip.insertBefore(btn, remembered);
        else if (!btn.parentElement) this.insertBySavedOrder(btn, strip);
        const wrapper = this.prepare(tab);
        if (wrapper && wrapper.ownerDocument === document) {
            wrapper.classList.add("dock-strip-guest");
            wrapper.classList.toggle("dock-strip-guest-nosearch", !this.searchInputs[tab]);
            body.appendChild(wrapper);
        }
        this.syncGuestButton(tab);
    }

    createGuestButton(tab, side) {
        const meta = TABS[tab];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tab-btn dock-guest-tab-btn";
        btn.dataset.guestTab = tab;
        btn.title = meta.title;
        btn.innerHTML = `<i class="fa-solid ${meta.icon}"></i> <span class="tab-text"></span>`;
        btn.querySelector(".tab-text").textContent = tabButton(tab)?.querySelector(".tab-text")?.textContent || meta.title;
        if (side === "right") btn.style.flex = "1";
        btn.addEventListener("click", () => this.activateGuest(tab));
        bindTabButtonDrag(btn);
        return btn;
    }

    /** Posição salva da convidada na faixa ("guest:<aba>" na ordem do tabsCustomization). */
    insertBySavedOrder(btn, strip) {
        let order = [];
        try { order = JSON.parse(localStorage.getItem(strip.id === "right-tabs" ? "right-tabs-order" : "left-tabs-order") || "[]"); } catch (e) {}
        const idx = order.indexOf(`guest:${btn.dataset.guestTab}`);
        if (idx !== -1) {
            for (const key of order.slice(idx + 1)) {
                const next = [...strip.children].find(c => stripKey(c) === key);
                if (next) { strip.insertBefore(btn, next); return; }
            }
        }
        strip.appendChild(btn);
    }

    guestButton(tab) {
        return document.querySelector(`.tab-btn[data-guest-tab="${tab}"]`);
    }

    removeGuestButton(tab) {
        const btn = this.guestButton(tab);
        if (!btn) return;
        const strip = btn.parentElement;
        const wasActive = btn.classList.contains("dock-guest-active");
        // Lembra o vizinho: refazer põe a aba de volta no mesmo lugar da faixa.
        this.lastNext = this.lastNext || {};
        this.lastNext[tab] = btn.nextElementSibling ? stripKey(btn.nextElementSibling) : null;
        btn.remove();
        if (wasActive) this.activateFirst(strip);
        this.syncSidebarVisibility();
    }

    /** Botão da convidada só aparece enquanto ela está no menu (numa janela, some). */
    syncGuestButton(tab) {
        const btn = this.guestButton(tab);
        if (!btn) return;
        const away = !this.strips[tab] || this.inWindow(tab);
        btn.style.display = away ? "none" : "";
        if (away && btn.classList.contains("dock-guest-active")) {
            btn.classList.remove("dock-guest-active");
            this.activateFirst(btn.parentElement);
        }
        this.syncSidebarVisibility();
    }

    /** O invólucro vai para uma janela: sai do modo convidada (a classe o esconderia lá). */
    leaveGuestStrip(tab) {
        const wrapper = document.getElementById(tabPanelId(tab));
        if (!wrapper || !wrapper.classList.contains("dock-strip-guest")) return;
        wrapper.classList.remove("dock-strip-guest", "dock-guest-active", "dock-strip-guest-nosearch");
    }

    /** Ativa a primeira aba visível da faixa (quando a ativa sai). */
    activateFirst(strip) {
        if (!strip) return;
        const next = [...strip.querySelectorAll(".tab-btn")].find(b => b.style.display !== "none" && !b.dataset.dockOut);
        next?.click();
    }

    /** Mostra a convidada no seu menu, escondendo o conteúdo da aba nativa ativa. */
    activateGuest(tab) {
        const side = this.strips[tab];
        const btn = this.guestButton(tab);
        const wrapper = document.getElementById(tabPanelId(tab));
        if (!side || !btn || !wrapper || !wrapper.classList.contains("dock-strip-guest")) return;
        const strip = stripEl(side);
        strip.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active", "dock-guest-active"));
        this.deactivateGuests(side);
        if (side === "left") {
            document.querySelectorAll(".sidebar-left .tab-content").forEach(c => { if (!c.dataset.dockOut) c.classList.remove("active"); });
            const filterBar = document.getElementById("library-filter-bar");
            if (filterBar) filterBar.style.display = "none";
            document.getElementById("sidebar-left")?.setAttribute("data-active-tab", tabPanelId(tab));
        } else {
            Object.values(RIGHT_TABS).forEach(m => {
                const c = document.getElementById(m.container);
                if (c && !c.dataset.dockOut) c.style.display = "none";
            });
        }
        btn.classList.add("dock-guest-active");
        wrapper.classList.add("dock-guest-active");
        const body = stripBody(side);
        if (body) body.scrollTop = 0;
        if (TABS[tab].side === "left") this.render(tab);
        window.dispatchEvent(new Event("resize"));
    }

    deactivateGuests(side) {
        stripEl(side)?.querySelectorAll(".dock-guest-tab-btn.dock-guest-active").forEach(b => b.classList.remove("dock-guest-active"));
        stripBody(side)?.querySelectorAll(":scope > .dock-strip-guest.dock-guest-active").forEach(w => w.classList.remove("dock-guest-active"));
    }

    /** Monta o invólucro da aba (no contêiner escondido) e move o conteúdo da aba para dentro. */
    prepare(tab) {
        const meta = TABS[tab];
        const id = tabPanelId(tab);
        let wrapper = document.getElementById(id) || this.wm.poppedElements?.[id];
        if (wrapper && wrapper.ownerDocument !== document) return wrapper; // já está numa janela
        // Fora da página, o togglePopout acharia que o painel já está destacado e o "reacoplaria".
        if (wrapper && !wrapper.isConnected) this.host.appendChild(wrapper);
        const content = document.getElementById(meta.container);
        if (!content) return null;
        if (!wrapper) {
            wrapper = document.createElement("section");
            wrapper.id = id;
            wrapper.className = "tab-panel glassmorphism";
            wrapper.innerHTML = `
                <div class="tab-panel-header">
                    <h2><i class="fa-solid ${meta.icon}"></i> <span class="header-title-text"></span></h2>
                    <button type="button" class="btn-icon tab-panel-return" id="btn-popout-${id}" data-tooltip="Devolver ao ${meta.side === "right" ? "Painel Lateral" : "menu da Biblioteca"}"><i class="fa-solid fa-down-left-and-up-right-to-center"></i></button>
                </div>
                <div class="tab-panel-body"></div>`;
            wrapper.querySelector(".header-title-text").textContent = meta.title;
            if (meta.search) {
                const input = document.createElement("input");
                input.type = "search";
                input.className = "tab-panel-search";
                input.placeholder = meta.search;
                input.setAttribute("aria-label", meta.search);
                input.addEventListener("input", () => {
                    clearTimeout(this._searchTimer);
                    this._searchTimer = setTimeout(() => this.render(tab), 180);
                });
                wrapper.querySelector(".tab-panel-header").insertBefore(input, wrapper.querySelector(".tab-panel-return"));
                this.searchInputs[tab] = input;
            }
            this.host.appendChild(wrapper);
            this.dockDrag?.addHandle(id, wrapper.querySelector(".tab-panel-header"));
        }
        if (!content.dataset.dockOut) {
            this.homes[tab] = { parent: content.parentNode, next: content.nextSibling };
            content.dataset.dockOut = "true";
            this.setButtonHidden(tab, true);
            wrapper.querySelector(".tab-panel-body").appendChild(content);
            if (meta.side === "right") content.style.display = "flex";
            else content.classList.add("dock-tab-out");
            this.render(tab);
        }
        return wrapper;
    }

    /** Conteúdo das abas da Biblioteca só renderiza quando a aba fica ativa: renderiza ao destacar. */
    render(tab) {
        try {
            if (tab === "themes") {
                const pm = window.panelsManager;
                if (pm?.allThemes) pm.renderThemesList(); else pm?.loadThemes?.();
            } else if (tab === "faces") {
                const fm = window.FaceManager;
                if (fm?.allClusters) fm.renderFaceClusters(); else fm?.loadFaceClusters?.();
            } else if (tab === "titles") {
                window.TITLES_TAB?.render?.();
            } else if (tab === "docs") {
                const lib = window.libraryInstance;
                if (lib?.allDocuments) lib.renderDocuments(lib.allDocuments);
            }
        } catch (err) {
            console.warn(`[TabPanels] Falha ao renderizar ${tab}:`, err);
        }
    }

    /** Ganchos dos módulos quando a aba chega numa janela (modais e atalhos dos Rostos, contêineres). */
    onWindowReady(tab, win) {
        if (!win || win.closed) return;
        try {
            if (tab === "faces") window.FaceManager?.onPopoutReady?.(win);
            else if (tab === "titles") window.TITLES_TAB?.onPopoutReady?.(win);
            else if (tab === "themes") window.panelsManager?.onLibraryPopoutReady?.(win);
        } catch (err) {
            console.warn(`[TabPanels] Gancho de janela de ${tab} falhou:`, err);
        }
    }

    /** Devolve o conteúdo da aba à faixa do seu menu e ativa a aba. */
    returnToStrip(tab, { activate = true } = {}) {
        const meta = TABS[tab];
        const content = document.getElementById(meta.container)
            || this.wm.poppedElements?.[tabPanelId(tab)]?.querySelector(`#${meta.container}`);
        if (!content) return;
        if (this.strips[tab]) {
            // P14: a aba mora no outro menu: volta para lá como convidada.
            const wrapper = this.wm.poppedElements?.[tabPanelId(tab)] || document.getElementById(tabPanelId(tab));
            if (wrapper && wrapper.ownerDocument !== document) document.adoptNode(wrapper);
            if (meta.side === "left") this.restoredHooks(tab);
            this.mountGuest(tab, null);
            if (activate) this.activateGuest(tab);
            return;
        }
        if (content.ownerDocument !== document) {
            // Ainda na janela destacada (ex.: restauração interrompida): traz de volta primeiro.
            document.adoptNode(content);
        }
        const home = this.homes[tab];
        if (home && home.parent) {
            if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(content, home.next);
            else home.parent.appendChild(content);
        }
        const wasOut = !!content.dataset.dockOut;
        delete content.dataset.dockOut;
        if (meta.side === "right") content.style.display = "none";
        else content.classList.remove("dock-tab-out");
        this.setButtonHidden(tab, false);
        // O invólucro fica guardado no contêiner escondido (reaproveitado ao destacar de novo).
        const wrapper = document.getElementById(tabPanelId(tab)) || this.wm.poppedElements?.[tabPanelId(tab)];
        if (wrapper && wrapper.ownerDocument === document) {
            wrapper.classList.remove("dock-strip-guest", "dock-guest-active", "dock-strip-guest-nosearch");
            this.host.appendChild(wrapper);
        }
        const input = this.searchInputs[tab];
        if (input) input.value = "";
        if (wasOut && meta.side === "left") this.restoredHooks(tab);
        if (activate) tabButton(tab)?.click();
    }

    restoredHooks(tab) {
        try {
            if (tab === "faces") window.FaceManager?.onPopoutRestored?.();
            else if (tab === "titles") window.TITLES_TAB?.onPopoutRestored?.();
            else if (tab === "themes") window.panelsManager?.onLibraryPopoutRestored?.();
        } catch (err) {}
    }

    setButtonHidden(tab, hidden) {
        const btn = tabButton(tab);
        if (!btn) return;
        const strip = btn.parentElement;
        if (hidden) {
            btn.dataset.dockOut = "true";
            btn.style.display = "none";
            // Se era a aba ativa, ativa a próxima que continua na faixa.
            if (btn.classList.contains("active")) {
                const next = [...strip.querySelectorAll(".tab-btn")].find(b => b !== btn && b.style.display !== "none");
                next?.click();
            }
        } else {
            delete btn.dataset.dockOut;
            btn.style.display = "";
        }
        if (TABS[tab].side === "right") this.syncSidebarVisibility();
    }

    /**
     * Decisão do plano: o Painel Lateral some quando todas as abas saem para janelas e volta
     * quando uma aba volta. Usa o recolher que já existe (divisores e linhas restauradoras cuidam do resto).
     * (A Biblioteca nunca fica vazia: a Mídias não sai.)
     */
    syncSidebarVisibility() {
        const sidebar = document.getElementById("sidebar-right");
        if (!sidebar || sidebar.ownerDocument !== document) return;
        const anyLeft = [...document.querySelectorAll("#right-tabs .tab-btn")].some(b => !b.dataset.dockOut && b.style.display !== "none");
        const collapsed = sidebar.classList.contains("collapsed");
        if (!anyLeft && !collapsed) {
            this.autoCollapsed = true;
            document.getElementById("toggle-right")?.click();
        } else if (anyLeft && collapsed && this.autoCollapsed) {
            this.autoCollapsed = false;
            document.getElementById("reopen-right")?.click();
        }
    }

    /** Destaca a aba numa janela nova (menu da faixa ou arrasto). Precisa do gesto do usuário. */
    tearOff(tab, screenX, screenY) {
        const id = tabPanelId(tab);
        this.wm.togglePopout(id);
        const win = window.popoutWindows?.[id];
        if (win && !win.closed) {
            if (Number.isFinite(screenX) && Number.isFinite(screenY) && (screenX || screenY)) {
                try { win.moveTo(Math.round(screenX - 60), Math.round(screenY - 16)); } catch (e) {}
            }
            this.dockDrag?.showToast("undo", `${TABS[tab].title} destacada em nova janela`);
            return true;
        }
        this.dockDrag?.showActionToast(`O navegador bloqueou a janela de ${TABS[tab].title}.`, "Abrir em janela", () => this.tearOff(tab));
        return false;
    }

    /**
     * Fim do arrasto de uma aba da faixa (HTML5, o mesmo do reordenar): solta fora do editor =
     * destacar; sobre uma janela destacada = juntar. Dentro do editor: só reordena (como antes).
     */
    onTabDragEnd(tab, e) {
        if (!TABS[tab]) return false;
        const sx = e.screenX, sy = e.screenY;
        if (!sx && !sy) return false;
        const insideMain = sx >= window.screenX && sx <= window.screenX + window.outerWidth
            && sy >= window.screenY && sy <= window.screenY + window.outerHeight;
        const id = tabPanelId(tab);
        const join = this.dockDrag?.findJoinTarget(id, sx, sy);
        if (join) {
            this.prepare(tab);
            const ok = this.wm.joinIntoWindow(join.win, id, join.position, join.arrangement);
            if (ok) this.dockDrag.showToast("undo", `Janela destacada: ${join.label}`);
            else this.returnToStrip(tab);
            return ok;
        }
        if (insideMain) return false;
        return this.tearOff(tab, sx, sy);
    }

    /** Aba pedida pela faixa (ex.: busca muda para "search") mas ela está numa janela: foca a janela. */
    focus(tab) {
        if (this.strips[tab] && !this.inWindow(tab)) {
            this.activateGuest(tab); // P14: aba no outro menu: mostra ela lá
            return;
        }
        try { window.popoutWindows?.[tabPanelId(tab)]?.focus(); } catch (e) {}
    }
}
