/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CapIAu Talho - Sistema de Diálogos & Confirmações Multi-Janela (NLE Dialogs)
 * ─────────────────────────────────────────────────────────────────────────────
 * Substitui confirm(), alert() e prompt() nativos do navegador por componentes
 * profissionais (Dark Glassmorphism) que respeitam o Design System do Talho.
 * 
 * GARANTIA MULTI-MONITOR / JANELAS DESTACADAS:
 * Toda caixa de confirmação e popover identifica rigorosamente em qual documento
 * e janela a ação foi disparada (targetEl.ownerDocument / window.popoutWindows).
 * O diálogo é criado E renderizado dentro daquela janela específica, nunca
 * vazando ou pulando para o editor principal em outro monitor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Resolve o contexto correto (Document, Window e Anchor Element) de onde a ação ocorreu.
 * Suporta elementos normais, elementos adotados em popouts, eventos de clique,
 * documentos, janelas e detecção automática de janela com foco.
 * 
 * @param {HTMLElement|Event|Document|Window|null} target
 * @returns {{ doc: Document, win: Window, anchorEl: HTMLElement|null }}
 */
export function resolveTargetContext(target = null) {
    // 1. Se foi passado um HTMLElement direto
    if (target && target.nodeType === 1 && target.ownerDocument) {
        const doc = target.ownerDocument;
        const win = doc.defaultView || window;
        return { doc, win, anchorEl: target };
    }

    // 2. Se foi passado um Evento do DOM (ex: clique no botão)
    if (target && (target.target || target.currentTarget)) {
        const el = (target.currentTarget && target.currentTarget.nodeType === 1)
            ? target.currentTarget
            : (target.target && target.target.nodeType === 1 ? target.target : null);
        if (el && el.ownerDocument) {
            const doc = el.ownerDocument;
            const win = doc.defaultView || window;
            return { doc, win, anchorEl: el };
        }
    }

    // 3. Se foi passado um Document
    if (target && target.nodeType === 9 && target.createElement && target.body) {
        return { doc: target, win: target.defaultView || window, anchorEl: null };
    }

    // 4. Se foi passada uma Window
    if (target && target.document && target.document.body) {
        return { doc: target.document, win: target, anchorEl: null };
    }

    // 5. Sem alvo explícito: busca nas janelas destacadas (popouts) qual está com o foco do usuário
    if (typeof window !== "undefined" && window.popoutWindows) {
        for (const name in window.popoutWindows) {
            const popWin = window.popoutWindows[name];
            try {
                if (popWin && !popWin.closed && popWin.document) {
                    if (popWin.document.hasFocus && popWin.document.hasFocus()) {
                        return { doc: popWin.document, win: popWin, anchorEl: null };
                    }
                    if (popWin.document.activeElement && popWin.document.activeElement !== popWin.document.body) {
                        return { doc: popWin.document, win: popWin, anchorEl: popWin.document.activeElement };
                    }
                }
            } catch (err) {}
        }
    }

    // 6. Fallback padrão: janela e documento principais
    const doc = (typeof document !== "undefined") ? document : null;
    const win = (typeof window !== "undefined") ? window : null;
    return { doc, win, anchorEl: null };
}

/**
 * Fecha qualquer popover de confirmação ativo no documento especificado.
 * @param {Document} doc
 */
export function dismissActivePopovers(doc = null) {
    const targetDoc = doc || document;
    if (!targetDoc) return;
    const activePopovers = targetDoc.querySelectorAll(".nle-confirm-popover");
    activePopovers.forEach(el => {
        if (typeof el._cleanup === "function") {
            el._cleanup(false);
        }
        if (el.parentNode) {
            el.parentNode.removeChild(el);
        }
    });
}

/**
 * Exibe um popover de confirmação contextual ancorado diretamente ao elemento clicado.
 * Ideal para ações locais como remoção de pista, exclusão de subclipe, etc.
 * 
 * @param {Object} options
 * @param {HTMLElement|Event} options.targetEl - Elemento ou evento disparador (MANDATÓRIO para ancoragem)
 * @param {string} options.title - Título ou pergunta principal
 * @param {string} [options.message] - Texto explicativo adicional
 * @param {string} [options.confirmText="Confirmar"] - Rótulo do botão de confirmação
 * @param {string} [options.cancelText="Cancelar"] - Rótulo do botão de cancelamento
 * @param {boolean} [options.danger=true] - Se a ação é destrutiva (aplica tema Rose/vermelho)
 * @param {string} [options.icon] - Ícone HTML FontAwesome opcional
 * @returns {Promise<boolean>}
 */
export function showConfirmPopover(options = {}) {
    return new Promise((resolve) => {
        const { doc, win, anchorEl } = resolveTargetContext(options.targetEl);

        if (!doc || !doc.body) {
            // Fallback de emergência caso DOM não esteja disponível
            resolve(false);
            return;
        }

        // Se não houver elemento de ancoragem, abre como modal centralizado
        if (!anchorEl) {
            showConfirmModal(options).then(resolve);
            return;
        }

        // Fecha qualquer popover já aberto no mesmo documento
        dismissActivePopovers(doc);

        const danger = options.danger !== false;
        const confirmText = options.confirmText || (danger ? "Remover" : "Confirmar");
        const cancelText = options.cancelText || "Cancelar";
        const title = options.title || "Tem certeza?";
        const message = options.message || "";
        const iconHtml = options.icon || (danger
            ? '<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose, #f43f5e);"></i>'
            : '<i class="fa-solid fa-circle-question" style="color: var(--accent, #06b6d4);"></i>');

        // Cria o contêiner do Popover
        const popover = doc.createElement("div");
        popover.className = `nle-confirm-popover ${danger ? "theme-danger" : "theme-primary"}`;
        popover.setAttribute("role", "alertdialog");
        popover.setAttribute("aria-modal", "true");
        popover.setAttribute("data-nle-dialog", "true");

        // Setinha decorativa do popover
        const arrow = doc.createElement("div");
        arrow.className = "nle-popover-arrow";
        popover.appendChild(arrow);

        // Estrutura interna HTML
        popover.innerHTML += `
            <div class="nle-popover-header">
                <div class="nle-popover-title-row">
                    <span class="nle-popover-icon">${iconHtml}</span>
                    <strong class="nle-popover-title">${escapeHtml(title)}</strong>
                </div>
                <button type="button" class="nle-popover-btn-close" title="Fechar (Esc)">&times;</button>
            </div>
            ${message ? `<div class="nle-popover-message">${escapeHtml(message)}</div>` : ""}
            <div class="nle-popover-actions">
                <button type="button" class="nle-btn-popover nle-btn-cancel">${escapeHtml(cancelText)}</button>
                <button type="button" class="nle-btn-popover nle-btn-confirm ${danger ? "danger" : "primary"}">${escapeHtml(confirmText)}</button>
            </div>
        `;

        // Anexa ao body DA MESMA JANELA
        doc.body.appendChild(popover);

        // Posicionamento inteligente dentro da viewport da janela específica
        function updatePosition() {
            if (!anchorEl.isConnected) return;
            const rect = anchorEl.getBoundingClientRect();
            const popWidth = Math.min(320, (win.innerWidth || 800) - 24);
            popover.style.width = `${popWidth}px`;

            const popHeight = popover.offsetHeight || 130;
            const spaceBelow = win.innerHeight - rect.bottom;
            const spaceAbove = rect.top;

            let top;
            let arrowSide = "bottom";

            // Se couber em cima confortavelmente ou se tiver mais espaço em cima do que embaixo
            if (spaceAbove >= popHeight + 12 || spaceAbove > spaceBelow) {
                top = rect.top - popHeight - 8;
                arrowSide = "bottom";
            } else {
                top = rect.bottom + 8;
                arrowSide = "top";
            }

            // Garante que não vaze das bordas verticais da janela
            top = Math.max(8, Math.min(win.innerHeight - popHeight - 8, top));

            // Centraliza horizontalmente em relação ao botão, mas sem vazar da tela
            let left = rect.left + (rect.width / 2) - (popWidth / 2);
            left = Math.max(10, Math.min(win.innerWidth - popWidth - 10, left));

            popover.style.top = `${Math.round(top)}px`;
            popover.style.left = `${Math.round(left)}px`;

            // Alinha a seta exatamente com o centro do elemento disparador
            const arrowEl = popover.querySelector(".nle-popover-arrow");
            if (arrowEl) {
                const anchorCenter = rect.left + (rect.width / 2);
                let arrowX = anchorCenter - left;
                arrowX = Math.max(16, Math.min(popWidth - 16, arrowX));
                arrowEl.style.left = `${Math.round(arrowX)}px`;
                arrowEl.className = `nle-popover-arrow arrow-${arrowSide}`;
            }
        }

        updatePosition();

        let isClosed = false;

        const cleanup = (result) => {
            if (isClosed) return;
            isClosed = true;
            doc.removeEventListener("keydown", onKeyDown, true);
            doc.removeEventListener("mousedown", onMouseDown, true);
            win.removeEventListener("resize", onResize);
            popover.classList.remove("visible");
            setTimeout(() => {
                if (popover.parentNode) popover.parentNode.removeChild(popover);
            }, 150);
            try {
                if (anchorEl && typeof anchorEl.focus === "function") {
                    anchorEl.focus();
                }
            } catch (e) {}
            resolve(result);
        };

        popover._cleanup = cleanup;

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cleanup(false);
            } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey) {
                // Se o foco está explicitamente no botão de cancelar, cancela
                if (doc.activeElement && doc.activeElement.classList.contains("nle-btn-cancel")) {
                    cleanup(false);
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                    cleanup(true);
                }
            }
        };

        const onMouseDown = (e) => {
            // Se o clique foi fora do popover e fora do elemento âncora, cancela
            if (!popover.contains(e.target) && !anchorEl.contains(e.target)) {
                cleanup(false);
            }
        };

        const onResize = () => updatePosition();

        // Eventos dos botões
        const btnConfirm = popover.querySelector(".nle-btn-confirm");
        const btnCancel = popover.querySelector(".nle-btn-cancel");
        const btnClose = popover.querySelector(".nle-popover-btn-close");

        if (btnConfirm) btnConfirm.addEventListener("click", () => cleanup(true));
        if (btnCancel) btnCancel.addEventListener("click", () => cleanup(false));
        if (btnClose) btnClose.addEventListener("click", () => cleanup(false));

        doc.addEventListener("keydown", onKeyDown, true);
        doc.addEventListener("mousedown", onMouseDown, true);
        win.addEventListener("resize", onResize);

        // Animação de entrada e foco
        requestAnimationFrame(() => {
            popover.classList.add("visible");
            // Para ações destrutivas, foca no Cancelar para evitar Enter acidental.
            // Para ações normais, foca no Confirmar.
            if (danger && btnCancel) {
                btnCancel.focus();
            } else if (btnConfirm) {
                btnConfirm.focus();
            }
        });
    });
}

/**
 * Exibe um diálogo modal de confirmação centralizado na tela.
 * Ideal para ações macro (ex: Excluir Projeto, Resetar Todos os Atalhos).
 * 
 * @param {Object} options
 * @param {HTMLElement|Document|Window|null} [options.target] - Alvo para definir em qual janela renderizar
 * @param {string} options.title - Título do modal
 * @param {string} options.message - Mensagem explicativa
 * @param {string} [options.confirmText="Confirmar"] - Texto do botão
 * @param {string} [options.cancelText="Cancelar"] - Texto do botão de cancelar
 * @param {boolean} [options.danger=true] - Se a ação é destrutiva
 * @param {string} [options.icon] - Ícone FontAwesome opcional
 * @returns {Promise<boolean>}
 */
export function showConfirmModal(options = {}) {
    return new Promise((resolve) => {
        const { doc } = resolveTargetContext(options.target || options.targetEl);

        if (!doc || !doc.body) {
            resolve(false);
            return;
        }

        const danger = options.danger !== false;
        const confirmText = options.confirmText || (danger ? "Remover" : "Confirmar");
        const cancelText = options.cancelText || "Cancelar";
        const title = options.title || "Confirmação";
        const message = options.message || "";
        const iconHtml = options.icon || (danger
            ? '<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose, #f43f5e);"></i>'
            : '<i class="fa-solid fa-circle-question" style="color: var(--accent, #06b6d4);"></i>');

        const overlay = doc.createElement("div");
        overlay.className = "modal-overlay active nle-dialog-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("data-nle-dialog", "true");

        overlay.innerHTML = `
            <div class="modal-content nle-confirm-modal-box glassmorphism ${danger ? "theme-danger" : "theme-primary"}">
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: var(--sp-10, 10px);">
                        <span style="font-size: var(--fs-18, 18px);">${iconHtml}</span>
                        <h2 style="margin: 0; font-size: var(--fs-15, 15px); font-weight: 700; color: #f8fafc;">${escapeHtml(title)}</h2>
                    </div>
                    <button type="button" class="btn-close-modal" title="Fechar (Esc)">&times;</button>
                </div>
                <div class="modal-body" style="padding: var(--sp-14, 14px) 0; font-size: var(--fs-12, 12px); color: var(--text-secondary, #cbd5e1); line-height: 1.5; white-space: pre-wrap;">
                    ${escapeHtml(message)}
                </div>
                <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: var(--sp-8, 8px); border-top: 1px solid var(--border-glass, rgba(255,255,255,0.08)); padding-top: var(--sp-12, 12px);">
                    <button type="button" class="nle-btn-popover nle-btn-cancel" style="padding: 6px 16px; font-size: var(--fs-12, 12px);">${escapeHtml(cancelText)}</button>
                    <button type="button" class="nle-btn-popover nle-btn-confirm ${danger ? "danger" : "primary"}" style="padding: 6px 18px; font-size: var(--fs-12, 12px); font-weight: 600;">${escapeHtml(confirmText)}</button>
                </div>
            </div>
        `;

        doc.body.appendChild(overlay);

        let isClosed = false;

        const cleanup = (result) => {
            if (isClosed) return;
            isClosed = true;
            doc.removeEventListener("keydown", onKeyDown, true);
            overlay.classList.remove("active");
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 150);
            resolve(result);
        };

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cleanup(false);
            } else if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey) {
                if (doc.activeElement && doc.activeElement.classList.contains("nle-btn-cancel")) {
                    cleanup(false);
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                    cleanup(true);
                }
            }
        };

        const btnConfirm = overlay.querySelector(".nle-btn-confirm");
        const btnCancel = overlay.querySelector(".nle-btn-cancel");
        const btnClose = overlay.querySelector(".btn-close-modal");

        if (btnConfirm) btnConfirm.addEventListener("click", () => cleanup(true));
        if (btnCancel) btnCancel.addEventListener("click", () => cleanup(false));
        if (btnClose) btnClose.addEventListener("click", () => cleanup(false));

        overlay.addEventListener("mousedown", (e) => {
            if (e.target === overlay) cleanup(false);
        });

        doc.addEventListener("keydown", onKeyDown, true);

        requestAnimationFrame(() => {
            if (danger && btnCancel) {
                btnCancel.focus();
            } else if (btnConfirm) {
                btnConfirm.focus();
            }
        });
    });
}

/**
 * Exibe um diálogo de entrada de texto estilizado (substitui window.prompt).
 * Ancorado contextualmente caso targetEl seja fornecido, ou centralizado.
 * 
 * @param {Object} options
 * @param {HTMLElement|Event|null} [options.targetEl] - Elemento disparador
 * @param {string} options.title - Título do prompt
 * @param {string} [options.message] - Mensagem explicativa
 * @param {string} [options.defaultValue=""] - Valor inicial do campo
 * @param {string} [options.placeholder=""] - Placeholder
 * @param {string} [options.confirmText="Salvar"] - Texto de confirmação
 * @param {string} [options.cancelText="Cancelar"] - Texto de cancelamento
 * @returns {Promise<string|null>} Retorna a string digitada ou null se cancelado
 */
export function showPromptDialog(options = {}) {
    return new Promise((resolve) => {
        const { doc, win, anchorEl } = resolveTargetContext(options.targetEl);

        if (!doc || !doc.body) {
            resolve(null);
            return;
        }

        dismissActivePopovers(doc);

        const title = options.title || "Entrada de Texto";
        const message = options.message || "";
        const defaultValue = options.defaultValue || "";
        const placeholder = options.placeholder || "";
        const confirmText = options.confirmText || "OK";
        const cancelText = options.cancelText || "Cancelar";

        const popover = doc.createElement("div");
        popover.className = "nle-confirm-popover theme-primary nle-prompt-dialog";
        popover.setAttribute("role", "dialog");
        popover.setAttribute("aria-modal", "true");
        popover.setAttribute("data-nle-dialog", "true");

        if (anchorEl) {
            const arrow = doc.createElement("div");
            arrow.className = "nle-popover-arrow";
            popover.appendChild(arrow);
        }

        popover.innerHTML += `
            <div class="nle-popover-header">
                <div class="nle-popover-title-row">
                    <span class="nle-popover-icon"><i class="fa-solid fa-pen-to-square" style="color: var(--accent, #06b6d4);"></i></span>
                    <strong class="nle-popover-title">${escapeHtml(title)}</strong>
                </div>
                <button type="button" class="nle-popover-btn-close" title="Fechar (Esc)">&times;</button>
            </div>
            ${message ? `<div class="nle-popover-message">${escapeHtml(message)}</div>` : ""}
            <div class="nle-popover-input-row" style="padding: var(--sp-8, 8px) 0;">
                <input type="text" class="nle-prompt-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid var(--border-glass, rgba(255,255,255,0.15)); border-radius: 4px; padding: 6px 10px; color: #f8fafc; font-size: var(--fs-12, 12px); font-family: var(--font-body); outline: none;">
            </div>
            <div class="nle-popover-actions">
                <button type="button" class="nle-btn-popover nle-btn-cancel">${escapeHtml(cancelText)}</button>
                <button type="button" class="nle-btn-popover nle-btn-confirm primary">${escapeHtml(confirmText)}</button>
            </div>
        `;

        doc.body.appendChild(popover);

        function updatePosition() {
            const popWidth = Math.min(340, (win.innerWidth || 800) - 24);
            popover.style.width = `${popWidth}px`;

            if (anchorEl && anchorEl.isConnected) {
                const rect = anchorEl.getBoundingClientRect();
                const popHeight = popover.offsetHeight || 150;
                const spaceBelow = win.innerHeight - rect.bottom;
                const spaceAbove = rect.top;

                let top;
                let arrowSide = "bottom";

                if (spaceAbove >= popHeight + 12 || spaceAbove > spaceBelow) {
                    top = rect.top - popHeight - 8;
                    arrowSide = "bottom";
                } else {
                    top = rect.bottom + 8;
                    arrowSide = "top";
                }

                top = Math.max(8, Math.min(win.innerHeight - popHeight - 8, top));
                let left = rect.left + (rect.width / 2) - (popWidth / 2);
                left = Math.max(10, Math.min(win.innerWidth - popWidth - 10, left));

                popover.style.top = `${Math.round(top)}px`;
                popover.style.left = `${Math.round(left)}px`;

                const arrowEl = popover.querySelector(".nle-popover-arrow");
                if (arrowEl) {
                    const anchorCenter = rect.left + (rect.width / 2);
                    let arrowX = anchorCenter - left;
                    arrowX = Math.max(16, Math.min(popWidth - 16, arrowX));
                    arrowEl.style.left = `${Math.round(arrowX)}px`;
                    arrowEl.className = `nle-popover-arrow arrow-${arrowSide}`;
                }
            } else {
                // Centralizado na viewport da janela
                const popHeight = popover.offsetHeight || 150;
                popover.style.position = "fixed";
                popover.style.top = `${Math.round(Math.max(20, (win.innerHeight - popHeight) / 2))}px`;
                popover.style.left = `${Math.round(Math.max(20, (win.innerWidth - popWidth) / 2))}px`;
            }
        }

        updatePosition();

        const inputEl = popover.querySelector(".nle-prompt-input");
        let isClosed = false;

        const cleanup = (val) => {
            if (isClosed) return;
            isClosed = true;
            doc.removeEventListener("keydown", onKeyDown, true);
            doc.removeEventListener("mousedown", onMouseDown, true);
            win.removeEventListener("resize", onResize);
            popover.classList.remove("visible");
            setTimeout(() => {
                if (popover.parentNode) popover.parentNode.removeChild(popover);
            }, 150);
            try {
                if (anchorEl && typeof anchorEl.focus === "function") {
                    anchorEl.focus();
                }
            } catch (e) {}
            resolve(val);
        };

        popover._cleanup = cleanup;

        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cleanup(null);
            } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                cleanup(inputEl ? inputEl.value : "");
            }
        };

        const onMouseDown = (e) => {
            if (!popover.contains(e.target) && (!anchorEl || !anchorEl.contains(e.target))) {
                cleanup(null);
            }
        };

        const onResize = () => updatePosition();

        const btnConfirm = popover.querySelector(".nle-btn-confirm");
        const btnCancel = popover.querySelector(".nle-btn-cancel");
        const btnClose = popover.querySelector(".nle-popover-btn-close");

        if (btnConfirm) btnConfirm.addEventListener("click", () => cleanup(inputEl ? inputEl.value : ""));
        if (btnCancel) btnCancel.addEventListener("click", () => cleanup(null));
        if (btnClose) btnClose.addEventListener("click", () => cleanup(null));

        doc.addEventListener("keydown", onKeyDown, true);
        doc.addEventListener("mousedown", onMouseDown, true);
        win.addEventListener("resize", onResize);

        requestAnimationFrame(() => {
            popover.classList.add("visible");
            if (inputEl) {
                inputEl.focus();
                inputEl.select();
            }
        });
    });
}

/**
 * Drop-in helper assíncrono para substituir confirm() no código existente.
 * Se targetEl for fornecido, usa Popover contextual; caso contrário, abre Modal centralizado.
 * 
 * @param {string|Object} messageOrOptions
 * @param {HTMLElement|Event|null} [targetEl]
 * @returns {Promise<boolean>}
 */
export function confirmNLE(messageOrOptions, targetEl = null) {
    if (typeof messageOrOptions === "string") {
        return showConfirmPopover({
            title: messageOrOptions,
            targetEl: targetEl,
            danger: true
        });
    }
    const opts = Object.assign({}, messageOrOptions);
    if (targetEl && !opts.targetEl) opts.targetEl = targetEl;
    return opts.targetEl ? showConfirmPopover(opts) : showConfirmModal(opts);
}

/**
 * Drop-in helper assíncrono para substituir prompt() no código existente.
 * 
 * @param {string|Object} messageOrOptions
 * @param {string} [defaultValue=""]
 * @param {HTMLElement|Event|null} [targetEl]
 * @returns {Promise<string|null>}
 */
export function promptNLE(messageOrOptions, defaultValue = "", targetEl = null) {
    if (typeof messageOrOptions === "string") {
        return showPromptDialog({
            title: messageOrOptions,
            defaultValue: defaultValue,
            targetEl: targetEl
        });
    }
    const opts = Object.assign({}, messageOrOptions);
    if (targetEl && !opts.targetEl) opts.targetEl = targetEl;
    if (defaultValue && !opts.defaultValue) opts.defaultValue = defaultValue;
    return showPromptDialog(opts);
}

/**
 * Escapa HTML para prevenir XSS ao renderizar mensagens e títulos.
 */
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Expõe globalmente no window do editor para retrocompatibilidade
if (typeof window !== "undefined") {
    window.resolveTargetContext = resolveTargetContext;
    window.showConfirmPopover = showConfirmPopover;
    window.showConfirmModal = showConfirmModal;
    window.showPromptDialog = showPromptDialog;
    window.confirmNLE = confirmNLE;
    window.promptNLE = promptNLE;
    window.dismissActivePopovers = dismissActivePopovers;
}
