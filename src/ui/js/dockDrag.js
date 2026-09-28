// Arrastar painéis pela alça ⋮⋮ (fases F2 e F3 do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// F3: soltar fora do editor destaca o painel numa janela que nasce ao cruzar a borda e segue o
// cursor; arrastar a alça da janela destacada de volta ao editor reacopla (com as mesmas zonas).
// Motor de Pointer Events (validado na F0): fantasma que segue o cursor, zonas de encaixe e
// sombra de prévia. Encaixes: laterais ao lado, trocadas, na ponta ou empilhadas numa mesma
// coluna (F2b); faixas inteiras em cima/embaixo e cantos (F2c); timeline embaixo dos monitores ou
// numa faixa (F2c parte 2); monitores lado a lado ou empilhados.
// Cada soltura vira um passo do histórico de layout e mostra o aviso "Layout alterado · Desfazer".

import { CENTER_STAGE, TIMELINE_ID } from "./dockModel.js";
import { moveBeside, moveToEdge, moveToBand, setCorner, stackWith, swapPanels, stackGuests, sameColumnState, bandOf, placeTimeline, timelineIsColumn } from "./dockOps.js";

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
    "bottom-left": "Timeline sob a esquerda e o centro (a direita vai até o fim)",
    "bottom-right": "Timeline sob o centro e a direita (a esquerda vai até o fim)"
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
        this.onLost = () => this.handleLostCapture();

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
        Object.entries(DOCK_PANELS).forEach(([panelId, meta]) => this.addHandle(panelId, document.querySelector(meta.header)));
    }

    /** Alça num cabeçalho (também para painéis criados na hora, como abas destacadas — F5). */
    addHandle(panelId, header) {
        const meta = DOCK_PANELS[panelId];
        if (!header || !meta || header.querySelector(":scope > .dock-handle")) return;
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
        handle.addEventListener("lostpointercapture", this.onLost);
        // Rede de segurança: se a captura se perder (painel recolocado no DOM durante o arrasto),
        // o soltar ainda chega pela janela.
        win.addEventListener("pointerup", this.onUp, true);
        win.addEventListener("pointercancel", this.onUp, true);
        if (fromPopout) win.addEventListener("keydown", this.onKey, true);
    }

    /**
     * A alça perdeu a captura do ponteiro sem o soltar ter chegado (ex.: o painel foi movido no DOM
     * no meio do arrasto). Tenta recapturar; se não der, segue o arrasto pelo documento.
     */
    handleLostCapture() {
        const d = this.drag;
        if (!d || d.lost) return;
        setTimeout(() => {
            if (this.drag !== d) return;
            try {
                if (d.handle.isConnected) {
                    d.handle.setPointerCapture(d.pointerId);
                    if (d.handle.hasPointerCapture(d.pointerId)) return;
                }
            } catch (err) {}
            d.lost = true;
            d.win.document.addEventListener("pointermove", this.onMove, true);
        }, 0);
    }

    handleMove(e) {
        const d = this.drag;
        if (!d) return;
        // O botão já foi solto mas o pointerup se perdeu: termina aqui, como se tivesse soltado.
        if (e.pointerType === "mouse" && e.buttons === 0) {
            this.handleUp({ type: "pointerup", screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY });
            return;
        }
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

        // Dentro da própria janela de grupo: soltar sobre outro painel troca os dois de lugar.
        const inOwn = d.fromPopout ? this.findSwapInWindow(d, e) : undefined;
        d.insideOwn = inOwn !== undefined;
        if (d.insideOwn) {
            this.ghost.hidden = true;
            d.target = inOwn;
            this.drawTarget(null);
            this.drawJoin(inOwn);
            return;
        }

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
        if (released && !target && d.outside && !d.insideOwn) {
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
        if (target?.type === "swap") {
            if (this.wm.swapGroupPanels(target.panelId, target.otherId)) this.showToast("undo", `${title} ${target.label.toLowerCase()}`);
            return;
        }
        if (d.insideOwn) return; // solto dentro da própria janela, fora de outro painel: nada muda
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
        d.handle.removeEventListener("lostpointercapture", this.onLost);
        d.win.removeEventListener("pointerup", this.onUp, true);
        d.win.removeEventListener("pointercancel", this.onUp, true);
        try { d.win.document.removeEventListener("pointermove", this.onMove, true); } catch (err) {}
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
        // Janelas sob o ponto; com sobreposição, vale a focada por último (a que está por cima).
        const candidates = [...new Set(Object.entries(popouts)
            .filter(([key, w]) => w && !w.closed && w !== ownWin && key !== "group" && key !== "dual-sidebar")
            .map(([, w]) => w))]
            .filter(w => sx >= w.screenX && sx <= w.screenX + w.outerWidth && sy >= w.screenY && sy <= w.screenY + w.outerHeight)
            .sort((a, b) => (b.__dockZ || 0) - (a.__dockZ || 0));
        for (const w of candidates.slice(0, 1)) {
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

    /**
     * Cursor dentro da janela de onde o painel saiu: undefined se está fora dela; na janela de grupo,
     * sobre o espaço de outro painel, o alvo de troca; senão null (soltar ali não muda nada).
     */
    findSwapInWindow(d, e) {
        const w = d.win;
        let x, y;
        try {
            x = e.clientX; y = e.clientY;
            if (w.closed || x < 0 || y < 0 || x > w.innerWidth || y > w.innerHeight) return undefined;
        } catch (err) {
            return undefined;
        }
        if (w !== window.popoutWindows?.["group"]) return null;
        const slot = w.document.elementFromPoint(x, y)?.closest?.("[data-group-slot]");
        const otherId = slot?.dataset.groupSlot;
        if (!otherId || otherId === d.panelId) return null;
        const r = slot.getBoundingClientRect();
        return { type: "swap", win: w, panelId: d.panelId, otherId, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, label: `Trocar com ${DOCK_PANELS[otherId]?.title || otherId}` };
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
        const half = join.rect
            ? `left:${join.rect.left}px;top:${join.rect.top}px;width:${join.rect.width}px;height:${join.rect.height}px`
            : { left: "left:0;top:0;width:50%;height:100%", right: "right:0;top:0;width:50%;height:100%",
                top: "left:0;top:0;width:100%;height:50%", bottom: "left:0;bottom:0;width:100%;height:50%" }[join.side];
        this.joinPreview.style.cssText = `position:fixed;${half};z-index:20000;pointer-events:none;box-sizing:border-box;` +
            "border:2px solid #22d3ee;background:rgba(34,211,238,0.16);border-radius:6px;display:flex;align-items:flex-start;justify-content:center;padding-top:14px";
        const tag = this.joinPreview.firstChild;
        tag.textContent = join.label;
        tag.style.cssText = "background:#22d3ee;color:#04222a;font:700 11px system-ui,sans-serif;padding:4px 10px;border-radius:4px;white-space:nowrap";
    }

    /** Solto em cima do editor sem zona específica: volta para o lugar de antes. */
    homeTarget(panelId) {
        const ws = this.editorRect();
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

    /** Área inteira do editor: a moldura com as faixas (F2c) ou, sem ela, o .workspace. */
    editorRect() {
        return this.rectOf(document.querySelector(".dock-frame")) || this.rectOf(document.querySelector(".workspace"));
    }

    resolveTarget(panelId, x, y) {
        const ws = this.editorRect();
        if (!ws || x < ws.left || x > ws.right || y < ws.top || y > ws.bottom) return null;
        const kind = DOCK_PANELS[panelId].kind;
        if (kind === "column") return this.resolveColumnTarget(panelId, x, y, ws);
        if (kind === "timeline") return this.resolveTimelineTarget(x, y, ws);
        if (kind === "monitor") return this.resolveMonitorTarget(panelId, x, y);
        return null;
    }

    resolveColumnTarget(panelId, x, y, ws) {
        const state = this.wm.getColumnState();
        const title = DOCK_PANELS[panelId].title;
        const make = (next, preview, label) =>
            !next || sameColumnState(next, state) ? null : { type: "columns", next, preview, label };

        // F2c: bordas de cima/embaixo criam (ou recebem) uma faixa inteira.
        if (x > ws.left + EDGE && x < ws.right - EDGE) {
            if (y < ws.top + EDGE) return this.resolveBandEdgeTarget(state, panelId, "top", x, ws, make);
            if (y > ws.bottom - EDGE) return this.resolveBandEdgeTarget(state, panelId, "bottom", x, ws, make);
        }
        if (x < ws.left + EDGE) return this.resolveSideEdgeTarget(state, panelId, "left", y, ws, make);
        if (x > ws.right - EDGE) return this.resolveSideEdgeTarget(state, panelId, "right", y, ws, make);

        // Painéis empilhados ficam dentro do anfitrião: testa os convidados antes.
        const guests = stackGuests(state.stacks);
        const candidates = [...COLUMN_PANELS].sort((a, b) => Number(guests.has(b)) - Number(guests.has(a)));
        // A timeline numa faixa ou como coluna também recebe laterais ao lado dela (F2c parte 2).
        if (bandOf(state.bands, TIMELINE_ID) || timelineIsColumn(state)) candidates.push(TIMELINE_ID);
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
            // Painel de faixa (F2c): centro troca, metade esquerda/direita põe ao lado dentro da faixa.
            if (bandOf(state.bands, id)) {
                if (rx > 0.3 && rx < 0.7) {
                    return make(swapPanels(state, panelId, id), { left: r.left, top: r.top, width: r.width, height: r.height }, `Trocar com ${name}`);
                }
                const before = rx <= 0.3;
                const w = Math.min(r.width * 0.45, 260);
                return make(moveBeside(state, panelId, id, before ? "before" : "after"),
                    { left: before ? r.left : r.right - w, top: r.top, width: w, height: r.height },
                    `${title} ${before ? "à esquerda" : "à direita"} de ${name} na faixa`);
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

    /** Retângulo de uma faixa na tela (null se não existe ou está vazia). */
    bandRect(edge) {
        const band = document.querySelector(`.dock-frame > .dock-band[data-edge="${edge}"]`);
        return band && !band.hidden ? band.getBoundingClientRect() : null;
    }

    /**
     * F2c: borda de cima/embaixo do editor. Sem faixa: faixa nova com a largura inteira. Com faixa:
     * entra nela, na posição mais perto do cursor (a sombra mostra a vaga).
     */
    resolveBandEdgeTarget(state, panelId, edge, x, ws, make) {
        const title = DOCK_PANELS[panelId].title;
        const where = edge === "top" ? "em cima" : "embaixo";
        const band = this.bandRect(edge);
        const current = (state.bands?.[edge] || []).filter(id => id !== panelId);
        if (!band || current.length === 0) {
            const h = Math.min(ws.height * 0.32, 300);
            return make(moveToBand(state, panelId, edge),
                { left: ws.left, top: edge === "top" ? ws.top : ws.bottom - h, width: ws.width, height: h },
                `${title} numa faixa inteira ${where}`);
        }
        // Posição: antes do primeiro painel da faixa cujo meio está à direita do cursor.
        const rects = current.map(id => document.getElementById(id)?.getBoundingClientRect()).filter(Boolean);
        let index = rects.findIndex(r => x < r.left + r.width / 2);
        if (index === -1) index = current.length;
        const slot = band.width / (current.length + 1);
        return make(moveToBand(state, panelId, edge, index),
            { left: band.left + slot * index, top: band.top, width: slot, height: band.height },
            `${title} na faixa ${where}`);
    }

    /**
     * Borda esquerda/direita do editor: coluna na ponta. Com faixa, a altura tem zonas (F2c):
     * ao lado da faixa (o canto) = a coluna vai até o fim e a faixa encurta; ao lado do centro =
     * a coluna fica só no meio e a faixa passa inteira.
     */
    resolveSideEdgeTarget(state, panelId, side, y, ws, make) {
        const title = DOCK_PANELS[panelId].title;
        let next = moveToEdge(state, panelId, side === "left" ? "start" : "end");
        if (!next) return null;
        const bandsNow = next.bands || { top: [], bottom: [] };
        const top = bandsNow.top.length ? this.bandRect("top") : null;
        const bottom = bandsNow.bottom.length ? this.bandRect("bottom") : null;
        const k = side === "left" ? "l" : "r";
        const own = { top: !!top && y < top.bottom, bottom: !!bottom && y > bottom.top };
        ["top", "bottom"].forEach(edge => {
            if (next && bandsNow[edge].length) next = setCorner(next, (edge === "top" ? "t" : "b") + k, own[edge] ? "column" : "band");
        });
        const w = ws.width * 0.16;
        const preview = {
            left: side === "left" ? ws.left : ws.right - w,
            top: own.top || !top ? ws.top : top.bottom,
            width: w
        };
        preview.height = (own.bottom || !bottom ? ws.bottom : bottom.top) - preview.top;
        const place = side === "left" ? "na ponta esquerda" : "na ponta direita";
        const how = own.top || own.bottom ? " (coluna até o fim)" : (top || bottom ? " (a faixa passa inteira)" : "");
        return make(next, preview, `${title} ${place}${how}`);
    }

    /**
     * Timeline (F2c parte 2). Bordas do editor, como as laterais: em cima/embaixo = faixa (nova com a
     * largura inteira, ou a vaga mais perto do cursor); esquerda/direita = coluna na ponta (com as
     * zonas de canto). Sobre um painel de faixa: centro troca, metades põem ao lado. Na parte de baixo
     * do editor, as posições de antes: embaixo dos monitores, ou a faixa de baixo sob a esquerda e o
     * centro (a direita vai até o fim) e o espelho. Na parte de cima, sobre uma coluna ou o centro:
     * vira coluna ao lado (metades) ou troca com a coluna (meio).
     */
    resolveTimelineTarget(x, y, ws) {
        const state = this.wm.getColumnState();
        const make = (next, preview, label) =>
            !next || sameColumnState(next, state) ? null : { type: "columns", next, preview, label };
        if (x > ws.left + EDGE && x < ws.right - EDGE) {
            if (y < ws.top + EDGE) return this.resolveBandEdgeTarget(state, TIMELINE_ID, "top", x, ws, make);
            if (y > ws.bottom - EDGE) return this.resolveBandEdgeTarget(state, TIMELINE_ID, "bottom", x, ws, make);
        }
        if (x < ws.left + EDGE) return this.resolveSideEdgeTarget(state, TIMELINE_ID, "left", y, ws, make);
        if (x > ws.right - EDGE) return this.resolveSideEdgeTarget(state, TIMELINE_ID, "right", y, ws, make);

        for (const id of COLUMN_PANELS) {
            if (!bandOf(state.bands, id)) continue;
            const r = this.rectOf(document.getElementById(id));
            if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
            const rx = (x - r.left) / r.width;
            if (rx > 0.3 && rx < 0.7) {
                return make(swapPanels(state, TIMELINE_ID, id), { left: r.left, top: r.top, width: r.width, height: r.height }, `Trocar com ${DOCK_PANELS[id].title}`);
            }
            const before = rx <= 0.3;
            const w = Math.min(r.width * 0.45, 260);
            return make(moveBeside(state, TIMELINE_ID, id, before ? "before" : "after"),
                { left: before ? r.left : r.right - w, top: r.top, width: w, height: r.height },
                `Timeline ${before ? "à esquerda" : "à direita"} de ${DOCK_PANELS[id].title} na faixa`);
        }

        const wsr = this.rectOf(document.querySelector(".workspace")) || ws;
        const center = this.rectOf(document.querySelector(".center-stage")) || wsr;
        if (y < wsr.top + wsr.height * 0.55) return this.resolveTimelineColumnTarget(state, x, y, make);
        if (y > wsr.bottom) return null;
        const h = wsr.height * 0.34;
        let position;
        let preview;
        if (x < center.left) {
            position = "bottom-left";
            preview = { left: ws.left, top: ws.bottom - h, width: center.right - ws.left, height: h };
        } else if (x > center.right) {
            position = "bottom-right";
            preview = { left: center.left, top: ws.bottom - h, width: ws.right - center.left, height: h };
        } else {
            position = "center";
            const ch = Math.min(h, center.height * 0.45);
            preview = { left: center.left, top: center.bottom - ch, width: center.width, height: ch };
        }
        return make(placeTimeline(state, position), preview, TIMELINE_LABELS[position]);
    }

    /** Timeline sobre uma coluna ou sobre o centro (parte de cima do editor): vira coluna. */
    resolveTimelineColumnTarget(state, x, y, make) {
        const guests = stackGuests(state.stacks);
        const ids = [...COLUMN_PANELS].sort((a, b) => Number(guests.has(b)) - Number(guests.has(a)));
        for (const id of [...ids, CENTER_STAGE]) {
            if (id !== CENTER_STAGE && bandOf(state.bands, id)) continue;
            const el = id === CENTER_STAGE ? document.querySelector(".center-stage") : document.getElementById(id);
            const r = this.rectOf(el);
            if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
            const name = id === CENTER_STAGE ? "do centro" : `de ${DOCK_PANELS[id].title}`;
            const rx = (x - r.left) / r.width;
            if (id !== CENTER_STAGE && rx > 0.3 && rx < 0.7) {
                return make(swapPanels(state, TIMELINE_ID, id), { left: r.left, top: r.top, width: r.width, height: r.height }, `Trocar com ${DOCK_PANELS[id].title}`);
            }
            const before = rx < 0.5;
            const hostEl = el.classList.contains("dock-stack-guest") ? el.closest(".dock-stack-host") : el;
            const col = this.rectOf(hostEl) || r;
            const w = Math.min(col.width * 0.4, 260);
            return make(moveBeside(state, TIMELINE_ID, id, before ? "before" : "after"),
                { left: before ? col.left : col.right - w, top: col.top, width: w, height: col.height },
                `Timeline como coluna ${before ? "à esquerda" : "à direita"} ${name}`);
        }
        return null;
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
        if (target.type === "columns") {
            const next = target.next;
            this.wm.setColumnLayout(next.order, next.stacks, next.bands || { top: [], bottom: [] }, next.corners || {});
        }
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
