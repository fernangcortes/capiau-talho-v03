// Abas do Painel Lateral que viram painéis próprios (fase F5a do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// Arrastar a aba para fora do editor (ou "Destacar em nova janela" no menu da faixa) leva o conteúdo
// da aba para uma janela destacada; soltar sobre uma janela destacada junta (até 4 painéis, F4).
// A aba destacada é um painel "tabpanel-<aba>": um invólucro com cabeçalho (alça, título, devolver)
// que usa toda a máquina existente de janelas, grupos, desfazer e restauração ao abrir.
// Falas leva o inspetor de falas junto (os dois estão no mesmo contêiner).

import { DOCK_PANELS } from "./dockDrag.js";

export const RIGHT_TABS = {
    transcript: { title: "Falas", icon: "fa-microphone", container: "transcript-container" },
    vision: { title: "Visão IA", icon: "fa-eye", container: "vision-container" },
    chat: { title: "Chat IA", icon: "fa-comments", container: "chat-container" },
    search: { title: "Busca", icon: "fa-magnifying-glass", container: "search-container" },
    tasks: { title: "Tarefas", icon: "fa-list-check", container: "tasks-container" },
    logs: { title: "Logs", icon: "fa-terminal", container: "logs-container" }
};

export const tabPanelId = (tab) => `tabpanel-${tab}`;
export const TAB_PANEL_IDS = Object.keys(RIGHT_TABS).map(tabPanelId);
const tabOf = (panelId) => (typeof panelId === "string" && panelId.startsWith("tabpanel-") ? panelId.slice(9) : null);

export class TabPanels {
    constructor(workspaceManager, dockDrag) {
        this.wm = workspaceManager;
        this.dockDrag = dockDrag;
        this.homes = {}; // tab -> { parent, next } lugar original do contêiner na faixa

        this.host = document.createElement("div");
        this.host.id = "dock-tabpanel-host";
        this.host.hidden = true;
        document.body.appendChild(this.host);

        Object.entries(RIGHT_TABS).forEach(([tab, meta]) => {
            DOCK_PANELS[tabPanelId(tab)] = { title: meta.title, header: `#${tabPanelId(tab)} .tab-panel-header`, kind: "tab" };
        });

        // Qualquer caminho que leve o painel da aba para uma janela (simples, grupo, desfazer,
        // restaurar ao abrir) precisa do invólucro montado; ao voltar, o conteúdo volta à faixa.
        const attach = this.wm.attachPanelToPopout.bind(this.wm);
        this.wm.attachPanelToPopout = (panelId, ...rest) => {
            const tab = tabOf(panelId);
            if (tab) this.prepare(tab);
            return attach(panelId, ...rest);
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
        return !!document.getElementById(RIGHT_TABS[tab]?.container)?.dataset.dockOut
            || !!this.wm.poppedElements?.[tabPanelId(tab)]?.querySelector?.(`#${RIGHT_TABS[tab].container}`);
    }

    /** Monta o invólucro da aba (no contêiner escondido) e move o conteúdo da aba para dentro. */
    prepare(tab) {
        const meta = RIGHT_TABS[tab];
        const id = tabPanelId(tab);
        let wrapper = document.getElementById(id) || this.wm.poppedElements?.[id];
        if (wrapper && wrapper.ownerDocument !== document) return wrapper; // já está numa janela
        const content = document.getElementById(meta.container);
        if (!content) return null;
        if (!wrapper) {
            wrapper = document.createElement("section");
            wrapper.id = id;
            wrapper.className = "tab-panel glassmorphism";
            wrapper.innerHTML = `
                <div class="tab-panel-header">
                    <h2><i class="fa-solid ${meta.icon}"></i> <span class="header-title-text"></span></h2>
                    <button type="button" class="btn-icon tab-panel-return" id="btn-popout-${id}" data-tooltip="Devolver ao Painel Lateral"><i class="fa-solid fa-down-left-and-up-right-to-center"></i></button>
                </div>
                <div class="tab-panel-body"></div>`;
            wrapper.querySelector(".header-title-text").textContent = meta.title;
            this.host.appendChild(wrapper);
            this.dockDrag?.addHandle(id, wrapper.querySelector(".tab-panel-header"));
        }
        if (!content.dataset.dockOut) {
            this.homes[tab] = { parent: content.parentNode, next: content.nextSibling };
            content.dataset.dockOut = "true";
            this.setButtonHidden(tab, true);
            wrapper.querySelector(".tab-panel-body").appendChild(content);
            content.style.display = "flex";
        }
        return wrapper;
    }

    /** Devolve o conteúdo da aba à faixa do Painel Lateral e ativa a aba. */
    returnToStrip(tab) {
        const meta = RIGHT_TABS[tab];
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
        delete content.dataset.dockOut;
        content.style.display = "none";
        this.setButtonHidden(tab, false);
        document.getElementById(tabPanelId(tab))?.remove();
        document.querySelector(`#right-tabs .tab-btn[data-right-tab="${tab}"]`)?.click();
    }

    setButtonHidden(tab, hidden) {
        const btn = document.querySelector(`#right-tabs .tab-btn[data-right-tab="${tab}"]`);
        if (!btn) return;
        if (hidden) {
            btn.dataset.dockOut = "true";
            btn.style.display = "none";
            // Se era a aba ativa, ativa a próxima que continua na faixa.
            if (btn.classList.contains("active")) {
                const next = [...document.querySelectorAll("#right-tabs .tab-btn")].find(b => b !== btn && b.style.display !== "none");
                next?.click();
            }
        } else {
            delete btn.dataset.dockOut;
            btn.style.display = "";
        }
        this.syncSidebarVisibility();
    }

    /**
     * Decisão do plano: o Painel Lateral some quando todas as abas saem para janelas e volta
     * quando uma aba volta. Usa o recolher que já existe (divisores e linhas restauradoras cuidam do resto).
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
            this.dockDrag?.showToast("undo", `${RIGHT_TABS[tab].title} destacada em nova janela`);
            return true;
        }
        this.dockDrag?.showActionToast(`O navegador bloqueou a janela de ${RIGHT_TABS[tab].title}.`, "Abrir em janela", () => this.tearOff(tab));
        return false;
    }

    /**
     * Fim do arrasto de uma aba da faixa (HTML5, o mesmo do reordenar): solta fora do editor =
     * destacar; sobre uma janela destacada = juntar. Dentro do editor: só reordena (como antes).
     */
    onTabDragEnd(tab, e) {
        if (!RIGHT_TABS[tab]) return false;
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
