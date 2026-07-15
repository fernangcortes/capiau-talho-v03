/**
 * tabsCustomization.js
 * Gerencia a ordenação por arrastar (Drag & Drop) e visibilidade (Show/Hide) das abas nos menus laterais.
 */

export function initTabsCustomization() {
    setupSidebarCustomization("left-tabs", "left-tabs-order", "left-tabs-visibility", "active-left-tab", "data-tab");
    setupSidebarCustomization("right-tabs", "right-tabs-order", "right-tabs-visibility", "active-right-tab", "data-right-tab");
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
            const child = children.find(c => c.getAttribute(attrName) === val);
            if (child) {
                container.appendChild(child);
            }
        });
        
        // Coloca abas adicionais que não estavam salvas (caso tenham sido adicionadas recentemente) no fim
        children.forEach(child => {
            const val = child.getAttribute(attrName);
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
    const children = Array.from(container.children);
    children.forEach(btn => {
        btn.setAttribute("draggable", "true");

        btn.addEventListener("dragstart", (e) => {
            btn.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });

        btn.addEventListener("dragend", () => {
            btn.classList.remove("dragging");
            // Salvar nova ordenação
            const newOrder = Array.from(container.children).map(c => c.getAttribute(attrName));
            localStorage.setItem(orderKey, JSON.stringify(newOrder));
        });
    });

    container.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = container.querySelector(".dragging");
        if (!dragging) return;

        const siblings = Array.from(container.children).filter(c => c !== dragging);
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
        showTabsContextMenu(e.clientX, e.clientY, container, visibilityKey, activeKey, attrName);
    });
}

function showTabsContextMenu(x, y, container, visibilityKey, activeKey, attrName) {
    const oldMenu = document.getElementById("custom-tabs-context-menu");
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement("div");
    menu.id = "custom-tabs-context-menu";
    menu.className = "custom-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.width = "180px";
    menu.style.padding = "6px 0";

    const title = document.createElement("div");
    title.style.padding = "6px 12px";
    title.style.fontSize = "10px";
    title.style.fontWeight = "bold";
    title.style.color = "var(--text-muted)";
    title.style.borderBottom = "1px solid var(--border-glass)";
    title.style.marginBottom = "4px";
    title.textContent = "VISIBILIDADE DAS ABAS";
    menu.appendChild(title);

    const tabs = Array.from(container.children);
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
