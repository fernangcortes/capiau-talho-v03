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

import { DOCK_PANELS } from "./dockDrag.js";

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
            if (tab) this.prepare(tab);
            const result = attach(panelId, win, ...rest);
            if (tab) this.onWindowReady(tab, win);
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
    returnToStrip(tab) {
        const meta = TABS[tab];
        const content = document.getElementById(meta.container)
            || this.wm.poppedElements?.[tabPanelId(tab)]?.querySelector(`#${meta.container}`);
        if (!content) return;
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
        if (wrapper && wrapper.ownerDocument === document) this.host.appendChild(wrapper);
        const input = this.searchInputs[tab];
        if (input) input.value = "";
        if (wasOut && meta.side === "left") {
            try {
                if (tab === "faces") window.FaceManager?.onPopoutRestored?.();
                else if (tab === "titles") window.TITLES_TAB?.onPopoutRestored?.();
                else if (tab === "themes") window.panelsManager?.onLibraryPopoutRestored?.();
            } catch (err) {}
        }
        tabButton(tab)?.click();
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
        try { window.popoutWindows?.[tabPanelId(tab)]?.focus(); } catch (e) {}
    }
}
