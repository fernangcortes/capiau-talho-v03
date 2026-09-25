// Arrastar painéis pela alça ⋮⋮ (fases F2 e F3 do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// F3: soltar fora do editor destaca o painel numa janela que nasce ao cruzar a borda e segue o
// cursor; arrastar a alça da janela destacada de volta ao editor reacopla (com as mesmas zonas).
// Motor de Pointer Events (validado na F0): fantasma que segue o cursor, zonas de encaixe e
// sombra de prévia. Encaixes: laterais ao lado, trocadas, na ponta ou empilhadas numa mesma
// coluna (F2b); timeline nas 4 posições; monitores lado a lado ou empilhados.
// Cada soltura vira um passo do histórico de layout e mostra o aviso "Layout alterado · Desfazer".

import { CENTER_STAGE } from "./dockModel.js";
import { moveBeside, moveToEdge, stackWith, swapPanels, stackGuests, sameColumnState } from "./dockOps.js";

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
        this.toastMode = null; // "undo" | "redo" | "action"
        this.toastAction = null;
        this.calib = null;

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
        // Calibração tela → página da janela principal (ponte de coordenadas validada na F0):
        // guarda o deslocamento da borda, que continua certo se a janela for movida.
        document.addEventListener("pointermove", (e) => {
            this.calib = { bx: e.screenX - e.clientX - window.screenX, by: e.screenY - e.clientY - window.screenY };
        }, { passive: true });
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
            else if (this.toastMode === "redo") this.redo();
            else if (this.toastMode === "action" && this.toastAction) {
                const action = this.toastAction;
                this.toast.hidden = true;
                action();
            }
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
            handle.setAttribute("data-tooltip", `Arrastar ${meta.title}: solte fora do editor para destacar`);
            handle.setAttribute("aria-hidden", "true");
            handle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
            handle.addEventListener("pointerdown", (e) => this.handleDown(e, panelId, handle));
            // Sem arrastar: Ctrl+duplo-clique alterna entre janela destacada e o último lugar no editor;
            // botão direito abre o menu da alça.
            handle.addEventListener("dblclick", (e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                e.stopPropagation();
                this.wm.togglePopout(panelId);
            });
            handle.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showHandleMenu(panelId, handle, e);
            });
            header.prepend(handle);
        });
    }

    /** Menu da alça: alternativa sem arrastar. */
    showHandleMenu(panelId, handle, e) {
        const doc = handle.ownerDocument;
        doc.querySelector(".dock-handle-menu")?.remove();
        const popped = doc !== document;
        const menu = doc.createElement("div");
        menu.className = "dock-handle-menu";
        menu.setAttribute("role", "menu");
        const items = [
            [popped ? "Reacoplar no editor (Ctrl+duplo-clique)" : "Destacar em nova janela (Ctrl+duplo-clique)", () => this.wm.togglePopout(panelId)],
            ["Desfazer mudança de layout (Ctrl+Alt+Z)", () => this.wm.undoLayout()],
            ["Restaurar layout do workspace", () => this.wm.resetLayoutToWorkspace()]
        ];
        items.forEach(([label, action]) => {
            const item = doc.createElement("button");
            item.type = "button";
            item.setAttribute("role", "menuitem");
            item.textContent = label;
            item.addEventListener("click", () => { menu.remove(); action(); });
            menu.appendChild(item);
        });
        // Estilo inline: a janela destacada pode ter um styles.css em cache sem estas regras.
        Object.assign(menu.style, {
            position: "fixed", left: `${e.clientX}px`, top: `${e.clientY}px`, zIndex: "20002",
            display: "flex", flexDirection: "column", minWidth: "240px", padding: "4px",
            background: "rgba(15, 18, 28, 0.98)", border: "1px solid rgba(167, 139, 250, 0.45)",
            borderRadius: "8px", boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
        });
        menu.querySelectorAll("button").forEach(b => Object.assign(b.style, {
            background: "transparent", border: "none", color: "#e2e8f0", textAlign: "left",
            padding: "7px 10px", fontSize: "12px", borderRadius: "5px", cursor: "pointer"
        }));
        doc.body.appendChild(menu);
        const close = (ev) => {
            if (menu.contains(ev.target)) return;
            menu.remove();
            doc.removeEventListener("pointerdown", close, true);
        };
        setTimeout(() => doc.addEventListener("pointerdown", close, true), 0);
    }

    /** Converte coordenadas de tela em coordenadas da página principal. */
    screenToMain(sx, sy) {
        let bx, by;
        if (this.calib) {
            ({ bx, by } = this.calib);
        } else {
            bx = (window.outerWidth - window.innerWidth) / 2;
            by = window.outerHeight - window.innerHeight - bx;
        }
        return { x: sx - window.screenX - bx, y: sy - window.screenY - by };
    }

    // ── Arrasto ────────────────────────────────────────────────────────────

    handleDown(e, panelId, handle) {
        if (e.button !== 0 || this.drag) return;
        const win = handle.ownerDocument.defaultView;
        const fromPopout = handle.ownerDocument !== document;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        this.drag = {
            panelId, handle, win, fromPopout, pointerId: e.pointerId,
            x0: e.screenX, y0: e.screenY, grabDx: e.screenX - win.screenX, grabDy: e.screenY - win.screenY,
            started: false, target: null, live: null, liveFailed: false, outside: false
        };
        handle.addEventListener("pointermove", this.onMove);
        handle.addEventListener("pointerup", this.onUp);
        handle.addEventListener("pointercancel", this.onUp);
        if (fromPopout) win.addEventListener("keydown", this.onKey, true);
    }

    handleMove(e) {
        const d = this.drag;
        if (!d) return;
        if (!d.started) {
            if (Math.hypot(e.screenX - d.x0, e.screenY - d.y0) < START_DISTANCE) return;
            d.started = true;
            document.body.classList.add("dock-dragging");
            (d.fromPopout ? null : document.getElementById(d.panelId))?.classList.add("dock-drag-source");
            this.ghost.textContent = DOCK_PANELS[d.panelId].title;
            this.overlay.hidden = false;
        }
        const p = d.fromPopout ? this.screenToMain(e.screenX, e.screenY) : { x: e.clientX, y: e.clientY };
        const outside = p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight;
        d.outside = outside;

        if (d.fromPopout) {
            // Voltando da janela destacada: zonas do editor principal no ponto convertido;
            // fora do editor, sobre outra janela destacada: juntar (F4).
            this.ghost.hidden = outside;
            d.target = outside
                ? this.findJoinTarget(d.panelId, e.screenX, e.screenY)
                : (this.resolveTarget(d.panelId, p.x, p.y) || this.homeTarget(d.panelId));
        } else if (outside && (d.join = this.findJoinTarget(d.panelId, e.screenX, e.screenY))) {
            // Sobre outra janela destacada: juntar (F4). A janela prévia sairia por cima dela, então fecha.
            if (d.live) {
                this.wm.cancelLivePopout(d.panelId, d.live);
                d.live = null;
            }
            this.ghost.hidden = true;
            d.target = d.join;
        } else if (outside) {
            // Saiu do editor: a janela nasce agora (o gesto ainda vale) e passa a seguir o cursor.
            if (!d.live && !d.liveFailed) {
                d.live = this.wm.openLivePopout(d.panelId, e.screenX - 60, e.screenY - 16);
                if (!d.live) d.liveFailed = true;
            }
            if (d.live) {
                try { d.live.moveTo(Math.round(e.screenX - 60), Math.round(e.screenY - 16)); } catch (err) {}
            }
            this.ghost.hidden = !!d.live;
            this.ghost.textContent = d.live ? DOCK_PANELS[d.panelId].title : `${DOCK_PANELS[d.panelId].title}: solte para destacar`;
            d.target = null;
        } else {
            if (d.live) {
                this.wm.cancelLivePopout(d.panelId, d.live);
                d.live = null;
            }
            this.ghost.hidden = false;
            this.ghost.textContent = DOCK_PANELS[d.panelId].title;
            d.target = this.resolveTarget(d.panelId, p.x, p.y);
        }
        this.ghost.style.left = `${p.x}px`;
        this.ghost.style.top = `${p.y}px`;
        this.drawJoin(d.target?.type === "join" ? d.target : null);
        this.drawTarget(d.target?.type === "join" ? null : d.target);
    }

    handleUp(e) {
        const d = this.drag;
        if (!d) return;
        const released = e.type === "pointerup" && d.started;
        let target = d.target;
        // Confere de novo no ponto de soltar: o último movimento pode ter sido processado enquanto
        // a janela prévia nascia e perdido a janela destacada embaixo do cursor.
        if (released && !target && d.outside) {
            const join = this.findJoinTarget(d.panelId, e.screenX, e.screenY);
            if (join) {
                if (d.live) this.wm.cancelLivePopout(d.panelId, d.live);
                d.live = null;
                target = join;
            }
        }
        this.endDrag(!released);
        if (!released) return;

        const title = DOCK_PANELS[d.panelId].title;
        if (target?.type === "join") {
            const ok = target.pairOfColumns
                ? this.wm.joinIntoPopout(target.targetPanel, d.panelId, target.side)
                : this.wm.joinIntoWindow(target.win, d.panelId, target.position, target.arrangement);
            if (ok) this.showToast("undo", `${target.pairOfColumns ? "Janela Dupla" : "Janela destacada"}: ${target.label}`);
            return;
        }
        if (d.fromPopout) {
            if (target) this.dockBack(d.panelId, target);
            else if (d.outside) {
                // Solto fora do editor: leva a janela destacada para onde o mouse foi solto.
                try { d.win.moveTo(Math.round(e.screenX - d.grabDx), Math.round(e.screenY - d.grabDy)); } catch (err) {}
            }
            return;
        }
        if (d.live) {
            this.wm.commitLivePopout(d.panelId, d.live);
            this.showToast("undo", `${title} destacado em nova janela`);
        } else if (d.outside && d.liveFailed) {
            // Plano B: o navegador bloqueou a janela (gesto expirou). Um clique abre.
            this.showActionToast(`O navegador bloqueou a janela de ${title}.`, "Abrir em janela", () => this.wm.togglePopout(d.panelId));
        } else if (target) {
            this.applyTarget(target);
        }
    }

    endDrag(cancelled = false) {
        const d = this.drag;
        if (!d) return;
        d.handle.removeEventListener("pointermove", this.onMove);
        d.handle.removeEventListener("pointerup", this.onUp);
        d.handle.removeEventListener("pointercancel", this.onUp);
        if (d.fromPopout) d.win.removeEventListener("keydown", this.onKey, true);
        try { d.handle.releasePointerCapture(d.pointerId); } catch (err) {}
        if (cancelled && d.live) this.wm.cancelLivePopout(d.panelId, d.live);
        this.drawJoin(null);
        document.body.classList.remove("dock-dragging");
        document.getElementById(d.panelId)?.classList.remove("dock-drag-source");
        this.ghost.hidden = true;
        this.overlay.hidden = true;
        this.drag = null;
    }

    /**
     * F4: janela destacada sob o ponto de tela, para juntar o painel a ela (até 4 por janela).
     * A borda mais próxima decide: esquerda/direita = lado a lado, cima/baixo = empilhados;
     * esquerda/cima põem o painel no começo. Duas laterais sozinhas viram a Janela Dupla (F4a);
     * o resto vira janela de grupo (F4b, panel-group.html).
     */
    findJoinTarget(panelId, sx, sy) {
        const popouts = window.popoutWindows || {};
        const ownWin = popouts[panelId];
        const groupWin = popouts["group"] && !popouts["group"].closed ? popouts["group"] : null;
        const dualWin = popouts["dual-sidebar"] && !popouts["dual-sidebar"].closed ? popouts["dual-sidebar"] : null;
        const seen = new Set();
        for (const [key, w] of Object.entries(popouts)) {
            if (!w || w.closed || seen.has(w) || w === ownWin || key === "group" || key === "dual-sidebar") continue;
            seen.add(w);
            if (sx < w.screenX || sx > w.screenX + w.outerWidth || sy < w.screenY || sy > w.screenY + w.outerHeight) continue;
            const inside = w === groupWin ? this.wm.getGroupPanels()
                : w === dualWin ? (localStorage.getItem("capiau_dual_popout_panels") || "").split(",").filter(Boolean)
                : Object.keys(popouts).filter(id => popouts[id] === w && DOCK_PANELS[id]);
            if (inside.length === 0 || inside.length >= 4) return null;
            const border = (w.outerWidth - w.innerWidth) / 2;
            const left = w.screenX + border;
            const top = w.screenY + (w.outerHeight - w.innerHeight) - border;
            const rx = (sx - left) / w.innerWidth;
            const ry = (sy - top) / w.innerHeight;
            const side = [["left", rx], ["right", 1 - rx], ["top", ry], ["bottom", 1 - ry]].sort((a, b) => a[1] - b[1])[0][0];
            const position = side === "left" || side === "top" ? "start" : "end";
            const titles = inside.map(id => DOCK_PANELS[id]?.title || id);
            const pairOfColumns = inside.length === 1 && COLUMN_PANELS.includes(inside[0]) && COLUMN_PANELS.includes(panelId) && !dualWin;
            if (!pairOfColumns && groupWin && groupWin !== w) return null; // uma janela de grupo por vez
            const count = inside.length + 1;
            const arrangement = count >= 4 ? "grid" : (side === "left" || side === "right" ? "row" : "column");
            const names = position === "start" ? [DOCK_PANELS[panelId].title, ...titles] : [...titles, DOCK_PANELS[panelId].title];
            const how = arrangement === "grid" ? "em grade" : arrangement === "row" ? "lado a lado" : "empilhados";
            return { type: "join", win: w, targetPanel: inside[0], side, position, arrangement, pairOfColumns, label: `${names.join(" + ")} ${how}` };
        }
        return null;
    }

    /** Desenha a prévia do "juntar" dentro da janela destacada alvo (estilo inline: CSS dela pode estar em cache). */
    drawJoin(join) {
        if (this.joinPreview && (!join || this.joinPreview.ownerDocument !== join.win.document)) {
            this.joinPreview.remove();
            this.joinPreview = null;
        }
        if (!join) return;
        let doc;
        try { doc = join.win.document; } catch (err) { return; }
        if (!this.joinPreview) {
            this.joinPreview = doc.createElement("div");
            this.joinPreview.innerHTML = "<span></span>";
            doc.body.appendChild(this.joinPreview);
        }
        const half = { left: "left:0;top:0;width:50%;height:100%", right: "right:0;top:0;width:50%;height:100%",
            top: "left:0;top:0;width:100%;height:50%", bottom: "left:0;bottom:0;width:100%;height:50%" }[join.side];
        this.joinPreview.style.cssText = `position:fixed;${half};z-index:20000;pointer-events:none;box-sizing:border-box;` +
            "border:2px solid #22d3ee;background:rgba(34,211,238,0.16);border-radius:6px;display:flex;align-items:flex-start;justify-content:center;padding-top:14px";
        const tag = this.joinPreview.firstChild;
        tag.textContent = join.label;
        tag.style.cssText = "background:#22d3ee;color:#04222a;font:700 11px system-ui,sans-serif;padding:4px 10px;border-radius:4px;white-space:nowrap";
    }

    /** Solto em cima do editor sem zona específica: volta para o lugar de antes. */
    homeTarget(panelId) {
        const ws = this.rectOf(document.querySelector(".workspace"));
        if (!ws) return null;
        return { type: "home", preview: { left: ws.left + 8, top: ws.top + 8, width: ws.width - 16, height: ws.height - 16 }, label: `Reacoplar ${DOCK_PANELS[panelId].title} no lugar de antes` };
    }

    /** Reacopla o painel da janela destacada e aplica o encaixe escolhido. */
    dockBack(panelId, target) {
        const dual = window.popoutWindows?.["dual-sidebar"];
        // Da Janela Dupla (F4): só este painel volta; o outro continua sozinho na mesma janela.
        if (dual && !dual.closed && window.popoutWindows[panelId] === dual) this.wm.splitFromDual(panelId);
        else this.wm.togglePopout(panelId); // painel de grupo: togglePopout tira só ele (F4b)
        if (target.type !== "home") setTimeout(() => this.applyTarget(target, false), 30);
        this.showToast("undo", target.type === "home" ? target.label.replace("Reacoplar", "Reacoplado:") : `Reacoplado: ${target.label}`);
    }

    handleKey(e) {
        if (this.drag && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.endDrag(true);
            return;
        }
        if (this.toast.hidden || this.toastMode === "action" || !(e.ctrlKey || e.metaKey) || e.altKey) return;
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
        const state = { order: [...this.wm.columnOrder], stacks: this.wm.columnStacks.map(st => [...st]) };
        const title = DOCK_PANELS[panelId].title;
        const make = (next, preview, label) =>
            !next || sameColumnState(next, state) ? null : { type: "columns", next, preview, label };

        if (x < ws.left + EDGE) {
            return make(moveToEdge(state, panelId, "start"), { left: ws.left, top: ws.top, width: ws.width * 0.16, height: ws.height }, `${title} na ponta esquerda`);
        }
        if (x > ws.right - EDGE) {
            return make(moveToEdge(state, panelId, "end"), { left: ws.right - ws.width * 0.16, top: ws.top, width: ws.width * 0.16, height: ws.height }, `${title} na ponta direita`);
        }

        // Painéis empilhados ficam dentro do anfitrião: testa os convidados antes.
        const guests = stackGuests(state.stacks);
        const candidates = [...COLUMN_PANELS].sort((a, b) => Number(guests.has(b)) - Number(guests.has(a)));
        for (const id of [...candidates, CENTER_STAGE]) {
            if (id === panelId) continue;
            const el = id === CENTER_STAGE ? document.querySelector(".center-stage") : document.getElementById(id);
            const r = this.rectOf(el);
            if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
            const name = id === CENTER_STAGE ? "centro" : DOCK_PANELS[id].title;
            const rx = (x - r.left) / r.width;
            const ry = (y - r.top) / r.height;

            if (id === CENTER_STAGE) {
                const before = rx < 0.5;
                const w = Math.min(r.width * 0.4, 260);
                return make(moveBeside(state, panelId, id, before ? "before" : "after"),
                    { left: before ? r.left : r.right - w, top: r.top, width: w, height: r.height },
                    `${title} ${before ? "à esquerda" : "à direita"} do centro`);
            }
            // Retângulo da coluna inteira (anfitrião + convidados) para "ao lado"; do painel para "empilhar".
            const hostEl = el.classList.contains("dock-stack-guest") ? el.closest(".dock-stack-host") : el;
            const col = this.rectOf(hostEl) || r;
            if (rx > 0.3 && rx < 0.7 && ry > 0.3 && ry < 0.7) {
                return make(swapPanels(state, panelId, id), { left: r.left, top: r.top, width: r.width, height: r.height }, `Trocar com ${name}`);
            }
            const edge = [["left", rx], ["right", 1 - rx], ["top", ry], ["bottom", 1 - ry]].sort((a, b) => a[1] - b[1])[0][0];
            if (edge === "top" || edge === "bottom") {
                const h = r.height / 2;
                return make(stackWith(state, panelId, id, edge),
                    { left: r.left, top: edge === "top" ? r.top : r.bottom - h, width: r.width, height: h },
                    `${title} ${edge === "top" ? "acima" : "abaixo"} de ${name}`);
            }
            const w = Math.min(col.width * 0.4, 260);
            return make(moveBeside(state, panelId, id, edge === "left" ? "before" : "after"),
                { left: edge === "left" ? col.left : col.right - w, top: col.top, width: w, height: col.height },
                `${title} ${edge === "left" ? "à esquerda" : "à direita"} de ${name}`);
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

    applyTarget(target, toast = true) {
        if (target.type === "columns") this.wm.setColumnLayout(target.next.order, target.next.stacks);
        else if (target.type === "timeline") this.wm.setTimelinePosition(target.position);
        else if (target.type === "monitors") this.wm.setMonitorsLayout(target.layout);
        else return;
        if (toast) this.showToast("undo", `Layout alterado: ${target.label}`);
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

    showActionToast(text, buttonLabel, action) {
        this.toastMode = "action";
        this.toastAction = action;
        this.toast.querySelector(".dock-undo-text").textContent = text;
        this.toast.querySelector(".dock-undo-btn").textContent = buttonLabel;
        this.toast.hidden = false;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, TOAST_MS * 2);
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
