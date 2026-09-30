// Cabeçalho compacto: menus suspensos (Projeto, Layout, Importar, IA) e os botões de workspace.
//
// Os botões de sempre (#btn-new-project, #btn-scan, #select-workspace…) só mudaram de lugar: moram
// dentro dos menus, com os mesmos ids, então quem já os liga (main.js, workspaceManager.js) segue igual.
// Ao abrir, o menu vai para o <body> (position: fixed) para ficar acima dos painéis; ao fechar, volta.

let openMenu = null; // { trigger, menu, home }

function placeMenu(trigger, menu) {
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    menu.style.left = "0px";
    const w = menu.offsetWidth;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    menu.style.left = `${Math.round(left)}px`;
}

export function closeHeaderMenu() {
    if (!openMenu) return;
    const { trigger, menu, home } = openMenu;
    openMenu = null;
    menu.hidden = true;
    menu.classList.remove("hmenu-open");
    menu.style.top = menu.style.left = "";
    home.appendChild(menu);
    trigger.setAttribute("aria-expanded", "false");
}

function openHeaderMenu(trigger) {
    const menu = document.getElementById(trigger.dataset.hmenu);
    if (!menu) return;
    closeHeaderMenu();
    openMenu = { trigger, menu, home: menu.parentElement };
    document.body.appendChild(menu);
    menu.hidden = false;
    menu.classList.add("hmenu-open");
    placeMenu(trigger, menu);
    trigger.setAttribute("aria-expanded", "true");
}

function visibleItems(menu) {
    return [...menu.querySelectorAll(".hmenu-item, select")].filter(el => el.offsetParent !== null && !el.disabled);
}

function initMenus() {
    document.querySelectorAll(".header .hmenu-trigger").forEach(trigger => {
        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (openMenu && openMenu.trigger === trigger) closeHeaderMenu();
            else openHeaderMenu(trigger);
        });
        trigger.addEventListener("keydown", (e) => {
            if (e.key !== "ArrowDown") return;
            e.preventDefault();
            openHeaderMenu(trigger);
            visibleItems(openMenu.menu)[0]?.focus();
        });
    });

    document.querySelectorAll(".hmenu").forEach(menu => {
        // Item clicado fecha o menu (depois do handler do próprio botão rodar). data-hmenu-keep = não fecha.
        menu.addEventListener("click", (e) => {
            const item = e.target.closest(".hmenu-item");
            if (item && !item.hasAttribute("data-hmenu-keep")) setTimeout(closeHeaderMenu, 0);
        });
        menu.addEventListener("change", (e) => {
            if (e.target.tagName === "SELECT") setTimeout(closeHeaderMenu, 0);
        });
        menu.addEventListener("keydown", (e) => {
            const items = visibleItems(menu);
            const i = items.indexOf(document.activeElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (document.activeElement?.tagName === "SELECT") return; // setas trocam a opção
                e.preventDefault();
                const next = e.key === "ArrowDown" ? i + 1 : i - 1;
                items[(next + items.length) % items.length]?.focus();
            }
        });
    });

    document.addEventListener("mousedown", (e) => {
        if (!openMenu) return;
        if (openMenu.menu.contains(e.target) || openMenu.trigger.contains(e.target)) return;
        closeHeaderMenu();
    }, true);
    // Captura na janela: os atalhos globais também escutam Esc e podem parar o evento antes.
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !openMenu) return;
        e.stopPropagation();
        const trigger = openMenu.trigger;
        closeHeaderMenu();
        trigger.focus();
    }, true);
    window.addEventListener("resize", () => closeHeaderMenu());
    window.addEventListener("blur", () => closeHeaderMenu());
}

// ── Workspaces à vista ──────────────────────────────────────────────────────
// Espelha #select-workspace: um botão por slot [1]–[4] (na ordem do slot) e, se o workspace ativo
// não tem slot, um botão extra com o nome dele. Clicar escolhe no <select> e dispara "change",
// o mesmo caminho de quem usa o seletor.

function parseOption(opt) {
    const m = /^\s*(?:\[(\d)\]\s*)?(?:Workspace:\s*)?(.*)$/.exec(opt.textContent || "");
    return { value: opt.value, slot: m && m[1] ? Number(m[1]) : null, name: (m && m[2] || opt.value).trim() };
}

function renderWorkspaces(select, box) {
    const opts = [...select.options].map(parseOption);
    const current = select.value;
    const shown = opts.filter(o => o.slot != null).sort((a, b) => a.slot - b.slot);
    const active = opts.find(o => o.value === current);
    if (active && !shown.some(o => o.value === current)) shown.push(active);

    const key = JSON.stringify([current, shown]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;

    box.replaceChildren(...shown.map(o => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ws-btn" + (o.value === current ? " active" : "");
        b.setAttribute("aria-pressed", String(o.value === current));
        b.dataset.ws = o.value;
        b.setAttribute("data-tooltip", o.slot != null ? `Workspace ${o.name} (Numpad ${o.slot})` : `Workspace ${o.name}`);
        if (o.slot != null) {
            const n = document.createElement("span");
            n.className = "ws-slot";
            n.textContent = String(o.slot);
            b.appendChild(n);
        }
        b.appendChild(document.createTextNode(o.name));
        return b;
    }));
}

function initWorkspaces() {
    const select = document.getElementById("select-workspace");
    const box = document.getElementById("ws-segmented");
    if (!select || !box) return;

    let queued = false;
    const refresh = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; renderWorkspaces(select, box); });
    };

    // workspaceManager troca o valor por código (select.value = id) sem disparar "change".
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (desc && desc.set) {
        Object.defineProperty(select, "value", {
            configurable: true,
            get() { return desc.get.call(this); },
            set(v) { desc.set.call(this, v); refresh(); },
        });
    }
    select.addEventListener("change", refresh);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, characterData: true });

    box.addEventListener("click", (e) => {
        const b = e.target.closest(".ws-btn");
        if (!b || b.dataset.ws === select.value) return;
        select.value = b.dataset.ws;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    renderWorkspaces(select, box);
}

// ── Aviso de falhas no botão de IA ──────────────────────────────────────────
// A biblioteca conta as mídias com análise em falha (GET /api/media/failed-count) e avisa com
// "capiau:failed-count"; aqui o grupo de IA ganha um ponto rosa e o total no rótulo do menu.

export function showAiFailures(count) {
    const group = document.getElementById("hsplit-ia");
    if (!group) return;
    const n = Math.max(0, Number(count) || 0);
    const caret = group.querySelector(".hmenu-trigger");
    if (n > 0) {
        group.dataset.failures = String(n);
        caret?.setAttribute("aria-label", `Mais ações de IA — ${n} ${n === 1 ? "mídia com falha" : "mídias com falha"}`);
        caret?.setAttribute("data-tooltip", `${n} ${n === 1 ? "mídia com análise em falha" : "mídias com análise em falha"}`);
    } else {
        delete group.dataset.failures;
        caret?.setAttribute("aria-label", "Mais ações de IA");
        caret?.removeAttribute("data-tooltip");
    }
}

export function initHeaderMenus() {
    initMenus();
    initWorkspaces();
    document.addEventListener("capiau:failed-count", (e) => showAiFailures(e.detail?.count));
}
