/**
 * tabsCustomization.js
 * Gerencia a ordenação por arrastar (Drag & Drop) e visibilidade (Show/Hide) das abas nos menus laterais.
 */

export function initTabsCustomization() {
    setupSidebarCustomization("left-tabs", "left-tabs-order", "left-tabs-visibility", "active-left-tab", "data-tab");
    setupSidebarCustomization("right-tabs", "right-tabs-order", "right-tabs-visibility", "active-right-tab", "data-right-tab");
    setupCrossStripDrop();
}

// Chave da aba na ordem salva da faixa. Aba vinda do outro menu (P14) fica como "guest:<aba>".
const tabKey = (btn, attrName) => btn.getAttribute(attrName) || (btn.dataset.guestTab ? `guest:${btn.dataset.guestTab}` : null);
const stripConfig = (container) => container?._tabsConfig || null;

export function saveStripOrder(container) {
    const cfg = stripConfig(container);
    if (!cfg) return;
    const order = Array.from(container.children).map(c => tabKey(c, cfg.attrName)).filter(Boolean);
    localStorage.setItem(cfg.orderKey, JSON.stringify(order));
}

/** Aba (TabPanels) do botão: aba nativa da faixa ou aba vinda do outro menu. */
function tabOfButton(btn) {
    if (!btn || !window.tabPanels) return null;
    if (btn.dataset.guestTab) return btn.dataset.guestTab;
    return window.tabPanelTabFromValue?.(btn.getAttribute("data-tab") || btn.getAttribute("data-right-tab")) || null;
}

/**
 * Arrastar e soltar de um botão de aba. A faixa é lida na hora do evento (o botão pode ter
 * mudado de menu). Exportado para os botões das abas vindas do outro menu (P14).
 */
export function bindTabButtonDrag(btn) {
    if (btn._tabDragBound) return;
    btn._tabDragBound = true;
    btn.setAttribute("draggable", "true");

    btn.addEventListener("dragstart", (e) => {
        const container = btn.parentElement;
        // Ordem de antes do arrasto: se a aba for destacada (F5) ou mudar de menu (P14), a passagem pela faixa não reordena.
        container._orderBeforeDrag = Array.from(container.children);
        _dragSource = container;
        btn.classList.add("dragging");
        delete btn.dataset.stripMoved;
        e.dataTransfer.effectAllowed = "move";
    });

    btn.addEventListener("dragend", (e) => {
        btn.classList.remove("dragging");
        clearStripDropMarker();
        const source = _dragSource;
        _dragSource = null;
        const restoreOrder = () => {
            source?._orderBeforeDrag?.forEach(child => {
                if (child.isConnected && child.parentElement === source) source.appendChild(child);
            });
        };
        if (btn.dataset.stripMoved) {
            // Mudou de menu (P14): o drop já moveu a aba; a faixa de origem volta à ordem de antes.
            delete btn.dataset.stripMoved;
            restoreOrder();
        } else {
            // F5: aba solta fora do editor ou sobre uma janela destacada vira painel (Mídias não sai).
            const tab = tabOfButton(btn);
            if (tab && window.tabPanels.onTabDragEnd(tab, e)) restoreOrder();
        }
        if (source) {
            source._orderBeforeDrag = null;
            saveStripOrder(source);
        }
        if (btn.parentElement && btn.parentElement !== source) saveStripOrder(btn.parentElement);
    });
}

let _dragSource = null;
let _dropMarker = null;

function clearStripDropMarker() {
    _dropMarker?.remove();
    _dropMarker = null;
    document.querySelectorAll(".dock-strip-drop").forEach(el => el.classList.remove("dock-strip-drop"));
}

/**
 * P14: soltar uma aba sobre o outro menu (a faixa ou qualquer parte da Biblioteca / Painel Lateral)
 * leva a aba para lá. Um marcador na faixa mostra onde ela vai entrar.
 */
function setupCrossStripDrop() {
    if (window._crossStripDropBound) return;
    window._crossStripDropBound = true;
    const SIDES = { "sidebar-left": { side: "left", strip: "left-tabs" }, "sidebar-right": { side: "right", strip: "right-tabs" } };
    // Alvo do arrasto: o menu sob o cursor, se a aba arrastada vem do outro menu.
    const target = (e) => {
        const sidebar = e.target?.closest?.("#sidebar-left, #sidebar-right");
        const dragging = document.querySelector(".tab-btn.dragging");
        if (!sidebar || !dragging) return null;
        const { side, strip: stripId } = SIDES[sidebar.id];
        const strip = document.getElementById(stripId);
        if (!strip || dragging.parentElement === strip) return null;
        const tab = tabOfButton(dragging);
        return tab ? { sidebar, side, strip, dragging, tab } : null;
    };
    // Captura na janela: a Biblioteca trata arrastos de arquivos (cópia) e pastas param a propagação;
    // um arrasto de aba não é arquivo, então ninguém mais o vê.
    window.addEventListener("dragover", (e) => {
        const t = target(e);
        if (!t) {
            if (_dropMarker && document.querySelector(".tab-btn.dragging")) clearStripDropMarker();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (!t.sidebar.classList.contains("dock-strip-drop")) {
            clearStripDropMarker();
            t.sidebar.classList.add("dock-strip-drop");
        }
        if (!_dropMarker) {
            _dropMarker = document.createElement("span");
            _dropMarker.className = "dock-strip-marker";
        }
        // Sobre a faixa: entra onde o cursor está; no resto do menu: no fim da faixa.
        const box = t.strip.getBoundingClientRect();
        const overStrip = e.clientY >= box.top - 8 && e.clientY <= box.bottom + 8;
        const buttons = Array.from(t.strip.children).filter(c => c !== _dropMarker && c.style.display !== "none");
        const next = overStrip ? buttons.find(b => {
            const r = b.getBoundingClientRect();
            return e.clientY <= r.bottom && e.clientX < r.left + r.width / 2;
        }) : null;
        if (next) {
            if (_dropMarker.nextElementSibling !== next) t.strip.insertBefore(_dropMarker, next);
        } else if (t.strip.lastElementChild !== _dropMarker) {
            t.strip.appendChild(_dropMarker);
        }
    }, true);
    window.addEventListener("drop", (e) => {
        const t = target(e);
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        const before = _dropMarker?.parentElement === t.strip ? _dropMarker.nextElementSibling : null;
        clearStripDropMarker();
        if (window.tabPanels.moveToStrip(t.tab, t.side, before)) t.dragging.dataset.stripMoved = "true";
    }, true);
}

function setupSidebarCustomization(containerId, orderKey, visibilityKey, activeKey, attrName) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`[TabsCustomization] Container não encontrado: ${containerId}`);
        return;
    }

    // 1. Restaurar Visibilidade das Abas
    const savedVisibility = localStorage.getItem(visibilityKey);
    let visibility = savedVisibility ? JSON.parse(savedVisibility) : {};
    
    Array.from(container.children).forEach(btn => {
        const tabVal = btn.getAttribute(attrName);
        if (visibility[tabVal] === false) {
            btn.style.display = "none";
        }
    });

    // 2. Restaurar Ordem das Abas
    const savedOrder = localStorage.getItem(orderKey);
    if (savedOrder) {
        const orderArray = JSON.parse(savedOrder);
        const children = Array.from(container.children);
        orderArray.forEach(val => {
            const child = children.find(c => tabKey(c, attrName) === val);
            if (child) {
                container.appendChild(child);
            }
        });
        
        // Coloca abas adicionais que não estavam salvas (caso tenham sido adicionadas recentemente) no fim
        children.forEach(child => {
            const val = tabKey(child, attrName);
            if (!orderArray.includes(val)) {
                container.appendChild(child);
            }
        });
    }

    // 3. Garantir que a aba ativa inicial está visível. Se não estiver, clica na primeira visível.
    const activeTabVal = localStorage.getItem(activeKey);
    if (activeTabVal) {
        const activeBtn = container.querySelector(`[${attrName}="${activeTabVal}"]`);
        if (activeBtn && activeBtn.style.display === "none") {
            const firstVisible = Array.from(container.children).find(b => b.style.display !== "none");
            if (firstVisible) {
                setTimeout(() => firstVisible.click(), 100);
            }
        }
    }

    // 4. Implementar Drag & Drop
    container._tabsConfig = { orderKey, attrName };
    Array.from(container.children).forEach(bindTabButtonDrag);

    if (container._reorderBound) return;
    container._reorderBound = true;
    container.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = container.querySelector(".dragging");
        if (!dragging) return;

        const siblings = Array.from(container.children).filter(c => c !== dragging && c !== _dropMarker);
        const nextSibling = siblings.find(sibling => {
            const box = sibling.getBoundingClientRect();
            // Permite arrastar horizontalmente
            return e.clientX < box.left + box.width / 2;
        });

        if (nextSibling) {
            container.insertBefore(dragging, nextSibling);
        } else {
            container.appendChild(dragging);
        }
    });

    // 5. Implementar Menu de Contexto (Mostrar/Ocultar Abas)
    container.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const clicked = e.target.closest(".tab-btn");
        showTabsContextMenu(e.clientX, e.clientY, container, visibilityKey, activeKey, attrName, clicked);
    });
}

function showTabsContextMenu(x, y, container, visibilityKey, activeKey, attrName, clickedBtn = null) {
    const oldMenu = document.getElementById("custom-tabs-context-menu");
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement("div");
    menu.id = "custom-tabs-context-menu";
    menu.className = "custom-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.width = "180px";
    menu.style.padding = "6px 0";

    // F5: destacar a aba clicada numa janela própria (Mídias não sai: é o corpo da Biblioteca).
    const clickedTab = tabOfButton(clickedBtn);
    if (clickedTab) {
        const tearItem = document.createElement("div");
        tearItem.className = "menu-item";
        tearItem.style.padding = "8px 12px";
        const label = clickedBtn.querySelector(".tab-text")?.textContent || clickedTab;
        tearItem.textContent = `Destacar ${label} em nova janela`;
        tearItem.addEventListener("click", (ev) => {
            ev.stopPropagation();
            menu.remove();
            window.tabPanels.tearOff(clickedTab);
        });
        menu.appendChild(tearItem);

        // P14: levar a aba para o outro menu (o mesmo que arrastá-la até lá).
        const otherSide = container.id === "left-tabs" ? "right" : "left";
        const moveItem = document.createElement("div");
        moveItem.className = "menu-item";
        moveItem.style.padding = "8px 12px";
        moveItem.textContent = `Mover ${label} para ${otherSide === "right" ? "o Painel Lateral" : "a Biblioteca"}`;
        moveItem.addEventListener("click", (ev) => {
            ev.stopPropagation();
            menu.remove();
            window.tabPanels.moveToStrip(clickedTab, otherSide);
        });
        menu.appendChild(moveItem);
    }

    const title = document.createElement("div");
    title.style.padding = "6px 12px";
    title.style.fontSize = "10px";
    title.style.fontWeight = "bold";
    title.style.color = "var(--text-muted)";
    title.style.borderBottom = "1px solid var(--border-glass)";
    title.style.marginBottom = "4px";
    title.textContent = "VISIBILIDADE DAS ABAS";
    menu.appendChild(title);

    // Abas vindas do outro menu (P14) não entram na lista de visibilidade desta faixa.
    const tabs = Array.from(container.children).filter(b => !b.dataset.guestTab && b.classList.contains("tab-btn"));
    tabs.forEach(btn => {
        const tabTextEl = btn.querySelector(".tab-text");
        const tabName = tabTextEl ? tabTextEl.textContent : (btn.textContent || "Aba");
        const tabVal = btn.getAttribute(attrName);
        const isVisible = btn.style.display !== "none";

        const item = document.createElement("div");
        item.className = "menu-item";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.gap = "8px";
        item.style.justifyContent = "flex-start";
        item.style.padding = "8px 12px";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isVisible;
        checkbox.style.cursor = "pointer";
        checkbox.style.accentColor = "var(--color-violet)";

        const label = document.createElement("span");
        label.textContent = tabName;
        label.style.flex = "1";
        label.style.cursor = "pointer";

        item.appendChild(checkbox);
        item.appendChild(label);
        menu.appendChild(item);

        const toggleVisibility = (ev) => {
            ev.stopPropagation();
            const nextChecked = !checkbox.checked;
            checkbox.checked = nextChecked;
            applyTabVisibility(btn, nextChecked, container, tabVal, visibilityKey, activeKey, attrName);
        };

        item.addEventListener("click", toggleVisibility);
        checkbox.addEventListener("click", (ev) => {
            ev.stopPropagation();
            applyTabVisibility(btn, checkbox.checked, container, tabVal, visibilityKey, activeKey, attrName);
        });
    });

    document.body.appendChild(menu);

    // Ajustar se passar da borda da tela
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
        menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (y + rect.height > window.innerHeight) {
        menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    const closeMenu = () => {
        menu.remove();
        document.removeEventListener("click", closeMenu);
    };
    setTimeout(() => document.addEventListener("click", closeMenu), 50);
}

function applyTabVisibility(btn, isVisible, container, tabVal, visibilityKey, activeKey, attrName) {
    btn.style.display = isVisible ? "" : "none";

    // Salvar no localStorage
    const savedVisibility = localStorage.getItem(visibilityKey);
    const visibility = savedVisibility ? JSON.parse(savedVisibility) : {};
    visibility[tabVal] = isVisible;
    localStorage.setItem(visibilityKey, JSON.stringify(visibility));

    // Se a aba ocultada for a ativa, clica na primeira visível
    if (!isVisible && btn.classList.contains("active")) {
        const firstVisible = Array.from(container.children).find(b => b.style.display !== "none");
        if (firstVisible) {
            firstVisible.click();
        }
    }
}

export function setTabVisibility(tabVal, isVisible) {
    const leftContainer = document.getElementById("left-tabs");
    const rightContainer = document.getElementById("right-tabs");
    
    if (leftContainer) {
        const btn = leftContainer.querySelector(`[data-tab="${tabVal}"]`);
        if (btn) {
            applyTabVisibility(btn, isVisible, leftContainer, tabVal, "left-tabs-visibility", "active-left-tab", "data-tab");
            return;
        }
    }
    
    if (rightContainer) {
        const btn = rightContainer.querySelector(`[data-right-tab="${tabVal}"]`);
        if (btn) {
            applyTabVisibility(btn, isVisible, rightContainer, tabVal, "right-tabs-visibility", "active-right-tab", "data-right-tab");
            return;
        }
    }
}
