// Arrastar painéis pela alça ⋮⋮ (fase F2a do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// Motor de Pointer Events (validado na F0): fantasma que segue o cursor, zonas de encaixe e
// sombra de prévia. Nesta etapa os encaixes se limitam ao que o layout atual sabe montar:
// reordenar/trocar colunas, mover a timeline entre as 4 posições e alinhar/empilhar os monitores.
// Cada soltura vira um passo do histórico de layout e mostra o aviso "Layout alterado · Desfazer".

import { CENTER_STAGE } from "./dockModel.js";

const EDGE = 26;          // largura das faixas de borda do editor (px)
const START_DISTANCE = 5; // px de movimento antes de o arrasto começar
const TOAST_MS = 6000;

const COLUMN_PANELS = ["sidebar-left", "inspector-panel", "sidebar-right"];

export const DOCK_PANELS = {
    "sidebar-left": { title: "Biblioteca", header: "#sidebar-left .sidebar-header", kind: "column" },
    "inspector-panel": { title: "Ajustes & Efeitos", header: "#inspector-panel .sidebar-header", kind: "column" },
    "sidebar-right": { title: "Painel Lateral", header: "#sidebar-right .sidebar-header", kind: "column" },
    "source-player-panel": { title: "Source", header: "#source-player-panel .player-header", kind: "monitor" },
    "program-player-panel": { title: "Program", header: "#program-player-panel .player-header", kind: "monitor" },
    "timeline-panel": { title: "Timeline", header: "#timeline-panel .timeline-header-left", kind: "timeline" }
};

const TIMELINE_LABELS = {
    "center": "Timeline sob os monitores",
    "bottom-left": "Timeline sob a esquerda e o centro",
    "bottom-right": "Timeline sob o centro e a direita",
    "bottom-full": "Timeline em largura total"
};

export class DockDragController {
    constructor(workspaceManager) {
        this.wm = workspaceManager;
        this.drag = null;
        this.toastTimer = null;
        this.toastMode = null; // "undo" | "redo"

        this.ghost = this.createEl("div", "dock-ghost");
        this.overlay = this.createEl("div", "dock-overlay");
        this.preview = this.createEl("div", "dock-preview");
        this.label = this.createEl("div", "dock-drop-label");
        this.overlay.append(this.preview, this.label);
        this.toast = this.createToast();

        this.onMove = (e) => this.handleMove(e);
        this.onUp = (e) => this.handleUp(e);
        this.onKey = (e) => this.handleKey(e);

        this.injectHandles();
        // Fase de captura: o aviso de desfazer precisa ver o Ctrl+Z antes do atalho da timeline.
        window.addEventListener("keydown", this.onKey, true);
    }

    createEl(tag, className) {
        const el = document.createElement(tag);
        el.className = className;
        el.hidden = true;
        document.body.appendChild(el);
        return el;
    }

    createToast() {
        const toast = this.createEl("div", "dock-undo-toast");
        toast.setAttribute("role", "status");
        toast.innerHTML = '<span class="dock-undo-text"></span><button type="button" class="dock-undo-btn"></button>';
        toast.querySelector("button").addEventListener("click", () => {
            if (this.toastMode === "undo") this.undo();
            else this.redo();
        });
        return toast;
    }

    /** Insere a alça ⋮⋮ no começo do cabeçalho de cada painel arrastável. */
    injectHandles() {
        Object.entries(DOCK_PANELS).forEach(([panelId, meta]) => {
            const header = document.querySelector(meta.header);
            if (!header || header.querySelector(":scope > .dock-handle")) return;
            const handle = document.createElement("span");
            handle.className = "dock-handle";
            handle.dataset.dockPanel = panelId;
            handle.setAttribute("data-tooltip", `Arrastar ${meta.title} para outro lugar`);
            handle.setAttribute("aria-hidden", "true");
            handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            handle.addEventListener("pointerdown", (e) => this.handleDown(e, panelId, handle));
            header.prepend(handle);
        });
    }

    // ── Arrasto ────────────────────────────────────────────────────────────

    handleDown(e, panelId, handle) {
        if (e.button !== 0 || this.drag) return;
        // Painel numa janela destacada: arrastar de lá chega na F3.
        if (handle.ownerDocument !== document) return;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        this.drag = { panelId, handle, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, target: null };
        handle.addEventListener("pointermove", this.onMove);
        handle.addEventListener("pointerup", this.onUp);
        handle.addEventListener("pointercancel", this.onUp);
    }

    handleMove(e) {
        const d = this.drag;
        if (!d) return;
        if (!d.started) {
            if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < START_DISTANCE) return;
            d.started = true;
            document.body.classList.add("dock-dragging");
            document.getElementById(d.panelId)?.classList.add("dock-drag-source");
            this.ghost.textContent = DOCK_PANELS[d.panelId].title;
            this.ghost.hidden = false;
            this.overlay.hidden = false;
        }
        this.ghost.style.left = `${e.clientX}px`;
        this.ghost.style.top = `${e.clientY}px`;
        d.target = this.resolveTarget(d.panelId, e.clientX, e.clientY);
        this.drawTarget(d.target);
    }

    handleUp(e) {
        const d = this.drag;
        if (!d) return;
        const apply = e.type === "pointerup" && d.started && d.target;
        const target = d.target;
        this.endDrag();
        if (apply) this.applyTarget(target);
    }

    endDrag() {
        const d = this.drag;
        if (!d) return;
        d.handle.removeEventListener("pointermove", this.onMove);
        d.handle.removeEventListener("pointerup", this.onUp);
        d.handle.removeEventListener("pointercancel", this.onUp);
        try { d.handle.releasePointerCapture(d.pointerId); } catch (err) {}
        document.body.classList.remove("dock-dragging");
        document.getElementById(d.panelId)?.classList.remove("dock-drag-source");
        this.ghost.hidden = true;
        this.overlay.hidden = true;
        this.drag = null;
    }

    handleKey(e) {
        if (this.drag && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.endDrag();
            return;
        }
        if (this.toast.hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        const isZ = e.code === "KeyZ" || e.key === "z" || e.key === "Z";
        const isY = e.code === "KeyY" || e.key === "y" || e.key === "Y";
        const wantsRedo = (isZ && e.shiftKey) || (isY && !e.shiftKey);
        const wantsUndo = isZ && !e.shiftKey;
        if (!wantsUndo && !wantsRedo) return;
        e.preventDefault();
        e.stopPropagation();
        if (wantsUndo) this.undo();
        else this.redo();
    }

    // ── Alvos ──────────────────────────────────────────────────────────────

    rectOf(el) {
        if (!el || el.ownerDocument !== document || !document.body.contains(el)) return null;
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 40 ? r : null;
    }

    resolveTarget(panelId, x, y) {
        const ws = this.rectOf(document.querySelector(".workspace"));
        if (!ws || x < ws.left || x > ws.right || y < ws.top || y > ws.bottom) return null;
        const kind = DOCK_PANELS[panelId].kind;
        if (kind === "column") return this.resolveColumnTarget(panelId, x, y, ws);
        if (kind === "timeline") return this.resolveTimelineTarget(x, y, ws);
        if (kind === "monitor") return this.resolveMonitorTarget(panelId, x, y);
        return null;
    }

    resolveColumnTarget(panelId, x, y, ws) {
        const order = [...this.wm.columnOrder];
        const without = order.filter(id => id !== panelId);
        const make = (newOrder, preview, label) =>
            newOrder.join() === order.join() ? null : { type: "columns", order: newOrder, preview, label };
        const title = DOCK_PANELS[panelId].title;

        if (x < ws.left + EDGE) {
            return make([panelId, ...without], { left: ws.left, top: ws.top, width: ws.width * 0.16, height: ws.height }, `${title} na ponta esquerda`);
        }
        if (x > ws.right - EDGE) {
            return make([...without, panelId], { left: ws.right - ws.width * 0.16, top: ws.top, width: ws.width * 0.16, height: ws.height }, `${title} na ponta direita`);
        }

        for (const id of [...COLUMN_PANELS, CENTER_STAGE]) {
            if (id === panelId) continue;
            const r = this.rectOf(id === CENTER_STAGE ? document.querySelector(".center-stage") : document.getElementById(id));
            if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
            const rel = (x - r.left) / r.width;
            const name = id === CENTER_STAGE ? "centro" : DOCK_PANELS[id].title;
            if (id !== CENTER_STAGE && rel > 0.3 && rel < 0.7) {
                const swapped = order.map(c => (c === panelId ? id : c === id ? panelId : c));
                return make(swapped, { left: r.left, top: r.top, width: r.width, height: r.height }, `Trocar com ${name}`);
            }
            const before = id === CENTER_STAGE ? rel < 0.5 : rel <= 0.3;
            const idx = without.indexOf(id);
            const newOrder = [...without];
            newOrder.splice(before ? idx : idx + 1, 0, panelId);
            const w = Math.min(r.width * 0.4, 260);
            return make(newOrder, { left: before ? r.left : r.right - w, top: r.top, width: w, height: r.height },
                `${title} ${before ? "à esquerda" : "à direita"} de ${name}`);
        }
        return null;
    }

    resolveTimelineTarget(x, y, ws) {
        const center = this.rectOf(document.querySelector(".center-stage")) || ws;
        if (y < ws.top + ws.height * 0.55) return null;
        const h = ws.height * 0.34;
        let position;
        let preview;
        if (y > ws.bottom - EDGE) {
            position = "bottom-full";
            preview = { left: ws.left, top: ws.bottom - h, width: ws.width, height: h };
        } else if (x < center.left) {
            position = "bottom-left";
            preview = { left: ws.left, top: ws.bottom - h, width: center.right - ws.left, height: h };
        } else if (x > center.right) {
            position = "bottom-right";
            preview = { left: center.left, top: ws.bottom - h, width: ws.right - center.left, height: h };
        } else {
            position = "center";
            preview = { left: center.left, top: center.bottom - Math.min(h, center.height * 0.45), width: center.width, height: Math.min(h, center.height * 0.45) };
        }
        if (position === this.wm.timelinePosition) return null;
        return { type: "timeline", position, preview, label: TIMELINE_LABELS[position] };
    }

    resolveMonitorTarget(panelId, x, y) {
        const otherId = panelId === "source-player-panel" ? "program-player-panel" : "source-player-panel";
        const r = this.rectOf(document.getElementById(otherId));
        if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
        const dLeft = x - r.left, dRight = r.right - x, dTop = y - r.top, dBottom = r.bottom - y;
        const nearest = Math.min(dLeft, dRight, dTop, dBottom);
        const stacked = nearest === dTop || nearest === dBottom;
        const layout = stacked ? "stacked" : "side-by-side";
        const effective = this.wm.monitorsLayout === "auto" ? this.wm.resolvedMonitorsLayout : this.wm.monitorsLayout;
        if (layout === effective && this.wm.monitorsLayout !== "auto") return null;
        const preview = stacked
            ? { left: r.left, top: nearest === dTop ? r.top : r.top + r.height / 2, width: r.width, height: r.height / 2 }
            : { left: nearest === dLeft ? r.left : r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height };
        return { type: "monitors", layout, preview, label: stacked ? "Monitores empilhados" : "Monitores lado a lado" };
    }

    drawTarget(target) {
        this.preview.hidden = !target;
        this.label.hidden = !target;
        this.ghost.classList.toggle("has-target", !!target);
        if (!target) return;
        const p = target.preview;
        Object.assign(this.preview.style, { left: `${p.left}px`, top: `${p.top}px`, width: `${p.width}px`, height: `${p.height}px` });
        this.label.textContent = target.label;
        // No topo da área destacada, para não ficar embaixo do fantasma que acompanha o cursor.
        Object.assign(this.label.style, { left: `${p.left + p.width / 2}px`, top: `${p.top + 14}px` });
    }

    applyTarget(target) {
        if (target.type === "columns") this.wm.applyColumnsOrder(target.order);
        else if (target.type === "timeline") this.wm.setTimelinePosition(target.position);
        else if (target.type === "monitors") this.wm.setMonitorsLayout(target.layout);
        else return;
        this.showToast("undo", `Layout alterado: ${target.label}`);
    }

    // ── Aviso de desfazer ──────────────────────────────────────────────────

    showToast(mode, text) {
        this.toastMode = mode;
        this.toast.querySelector(".dock-undo-text").textContent = text;
        this.toast.querySelector(".dock-undo-btn").textContent = mode === "undo" ? "Desfazer (Ctrl+Z)" : "Refazer (Ctrl+Shift+Z)";
        this.toast.hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, TOAST_MS);
    }

    undo() {
        // O registro no histórico é assíncrono (agrupa chamadas encadeadas); espera ele assentar.
        setTimeout(() => {
            if (this.wm.layoutHistory.canUndo && this.wm.applyDockLayout(this.wm.layoutHistory.undo())) {
                this.showToast("redo", "Layout desfeito");
            }
        }, 120);
    }

    redo() {
        setTimeout(() => {
            if (this.wm.layoutHistory.canRedo && this.wm.applyDockLayout(this.wm.layoutHistory.redo())) {
                this.showToast("undo", "Layout refeito");
            }
        }, 120);
    }
}
