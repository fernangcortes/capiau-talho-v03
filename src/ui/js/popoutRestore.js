// Reabrir as janelas destacadas da sessão anterior (decisão 8 do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// Padrão "auto": tenta reabrir sozinho. Sem permissão de pop-ups para o site o navegador bloqueia
// janelas abertas sem clique, e cada clique abre só uma janela (medido no spike F0): nesse caso
// aparece a faixa "Restaurar janelas", que reabre uma por clique. Modo "ask": sempre a faixa.

import { PANEL_IDS } from "./dockModel.js";
import { DOCK_PANELS } from "./dockDrag.js";

const MODE_KEY = "capiau_restore_popouts";
const isOpen = (w) => !!(w && !w.closed);

export function getRestoreMode() {
    try { return localStorage.getItem(MODE_KEY) === "ask" ? "ask" : "auto"; } catch (e) { return "auto"; }
}

function setRestoreMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
}

/** Janelas que estavam destacadas e não estão abertas agora (a dupla conta como uma). */
export function collectPendingPopouts() {
    const pending = [];
    let dualPanels = [];
    try {
        if (localStorage.getItem("capiau_dual_popout_active") === "true") {
            dualPanels = (localStorage.getItem("capiau_dual_popout_panels") || "").split(",").filter(Boolean);
            if (dualPanels.length === 2 && !isOpen(window.popoutWindows?.["dual-sidebar"])) {
                pending.push({ kind: "dual", panels: dualPanels, layout: localStorage.getItem("capiau_dual_popout_layout") || "side-by-side" });
            }
        }
        PANEL_IDS.forEach(id => {
            if (dualPanels.includes(id)) return;
            if (localStorage.getItem(`capiau_popout_active_${id}`) === "true" && !isOpen(window.popoutWindows?.[id])) {
                pending.push({ kind: "single", id });
            }
        });
    } catch (e) {}
    return pending;
}

function titleOf(item) {
    if (item.kind === "dual") return `Janela Dupla (${item.panels.map(id => DOCK_PANELS[id]?.title || id).join(" + ")})`;
    return DOCK_PANELS[item.id]?.title || item.id;
}

function forget(item) {
    try {
        if (item.kind === "dual") {
            localStorage.removeItem("capiau_dual_popout_active");
            item.panels.forEach(id => localStorage.removeItem(`capiau_popout_active_${id}`));
        } else {
            localStorage.removeItem(`capiau_popout_active_${item.id}`);
        }
    } catch (e) {}
}

export class PopoutRestorer {
    constructor(workspaceManager, dockDrag) {
        this.wm = workspaceManager;
        this.dockDrag = dockDrag;
        this.pending = [];
        this.banner = null;
    }

    /** Abre uma janela pendente. Retorna true se abriu. */
    open(item, quiet) {
        if (item.kind === "dual") {
            this.wm.openDualPopout(item.panels[0], item.panels[1], item.layout, { quiet });
            return isOpen(window.popoutWindows?.["dual-sidebar"]);
        }
        this.wm.togglePopout(item.id, { quiet });
        return isOpen(window.popoutWindows?.[item.id]);
    }

    start() {
        this.pending = collectPendingPopouts();
        if (this.pending.length === 0) return;
        if (getRestoreMode() === "auto") {
            // Tenta cada uma: com permissão de pop-ups todas abrem; sem ela, as bloqueadas vão para a faixa.
            const blocked = this.pending.filter(item => !this.open(item, true));
            const opened = this.pending.length - blocked.length;
            this.pending = blocked;
            if (opened > 0) {
                // Reabrir a sessão anterior não é um passo de "desfazer": refaz a linha de base depois.
                setTimeout(() => this.wm.layoutHistory.reset(this.wm.getDockLayout()), 2500);
                this.dockDrag?.showActionToast(`${opened === 1 ? "1 janela destacada restaurada" : `${opened} janelas destacadas restauradas`}.`,
                    "Perguntar da próxima vez", () => setRestoreMode("ask"));
            }
        }
        this.showBanner();
    }

    showBanner() {
        if (!this.banner) {
            this.banner = document.createElement("div");
            this.banner.className = "dock-restore-banner";
            this.banner.setAttribute("role", "status");
            document.body.appendChild(this.banner);
        }
        const next = this.pending[0];
        if (!next) { this.banner.remove(); this.banner = null; return; }
        const mode = getRestoreMode();
        this.banner.innerHTML = `
            <span class="dock-restore-text"></span>
            <button type="button" class="dock-restore-open"></button>
            <button type="button" class="dock-restore-dismiss">Dispensar</button>
            <button type="button" class="dock-restore-mode"></button>`;
        this.banner.querySelector(".dock-restore-text").textContent =
            `Janelas destacadas da última sessão: ${this.pending.length}` +
            (mode === "auto" ? " (o navegador bloqueou a reabertura automática; permita pop-ups para este site para que voltem sozinhas)" : "");
        this.banner.querySelector(".dock-restore-open").textContent = `Restaurar ${titleOf(next)}`;
        this.banner.querySelector(".dock-restore-mode").textContent = mode === "auto" ? "Sempre perguntar" : "Reabrir sozinhas sempre";
        // Um clique = uma janela (o navegador consome o gesto a cada janela aberta).
        this.banner.querySelector(".dock-restore-open").addEventListener("click", () => {
            this.open(next, false);
            this.pending.shift();
            this.showBanner();
        });
        this.banner.querySelector(".dock-restore-dismiss").addEventListener("click", () => {
            this.pending.forEach(forget);
            this.pending = [];
            this.showBanner();
        });
        this.banner.querySelector(".dock-restore-mode").addEventListener("click", () => {
            setRestoreMode(mode === "auto" ? "ask" : "auto");
            this.showBanner();
        });
    }
}
