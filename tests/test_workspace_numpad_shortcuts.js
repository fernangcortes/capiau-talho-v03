/**
 * Testes Automatizados dos Atalhos Espaciais Numpad & Slots Numéricos de Workspace
 * CapIAu Video Editor
 */

const assert = require("assert");

console.log("=== Iniciando Testes de Atalhos Espaciais Numpad & Slots Numéricos ===");

// 1. Simulação de Ambiente DOM para Node.js
class MockClassList {
    constructor(el) {
        this.el = el;
        this._set = new Set();
    }
    contains(cls) {
        return this._set.has(cls);
    }
    add(...classes) {
        classes.forEach(c => this._set.add(c));
        this.el.className = Array.from(this._set).join(" ");
    }
    remove(...classes) {
        classes.forEach(c => this._set.delete(c));
        this.el.className = Array.from(this._set).join(" ");
    }
    toggle(cls, force) {
        const has = this.contains(cls);
        const should = force !== undefined ? force : !has;
        if (should) this.add(cls); else this.remove(cls);
        return should;
    }
}

class MockElement {
    constructor(id = "", tagName = "DIV") {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.className = "";
        this.classList = new MockClassList(this);
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.attributes = {};
        this.value = "";
        this.isContentEditable = false;
        this.listeners = {};
        this.ownerDocument = null;
        this.options = [];
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    dispatchEvent(evt) {
        const handlers = this.listeners[evt.type] || [];
        for (const h of handlers) {
            h.call(this, evt);
        }
        return !evt.defaultPrevented;
    }

    click() {
        this.dispatchEvent({ type: "click", target: this, stopPropagation: () => {}, preventDefault: () => {} });
    }

    focus() {
        if (global.document) global.document.activeElement = this;
    }

    closest(selector) {
        let cur = this;
        while (cur) {
            if (selector.split(",").some(s => {
                s = s.trim();
                if (s.startsWith("#")) return cur.id === s.slice(1);
                if (s.startsWith(".")) return cur.classList.contains(s.slice(1));
                return cur.tagName.toLowerCase() === s.toLowerCase();
            })) {
                return cur;
            }
            cur = cur.parentNode;
        }
        return null;
    }

    querySelector(selector) {
        return global.document.querySelector(selector);
    }

    querySelectorAll(selector) {
        return global.document.querySelectorAll(selector);
    }

    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.children.push(child);
        child.parentNode = this;
        child.ownerDocument = this.ownerDocument;
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    getAttribute(k) { return this.attributes[k] || null; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
}

class MockDocument {
    constructor() {
        this.elements = new Map();
        this.body = new MockElement("body", "BODY");
        this.body.ownerDocument = this;
        this.activeElement = null;
        this.listeners = {};
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    dispatchEvent(evt) {
        const handlers = this.listeners[evt.type] || [];
        for (const h of handlers) h(evt);
    }

    createElement(tag) {
        const el = new MockElement("", tag);
        el.ownerDocument = this;
        return el;
    }

    getElementById(id) {
        return this.elements.get(id) || null;
    }

    register(el) {
        if (el.id) this.elements.set(el.id, el);
        el.ownerDocument = this;
        return el;
    }

    querySelector(sel) {
        if (sel.startsWith("#")) return this.getElementById(sel.slice(1));
        if (sel === ".app-container") return this.elements.get("app-container");
        for (const el of this.elements.values()) {
            if (sel.startsWith(".") && el.classList.contains(sel.slice(1))) return el;
        }
        return null;
    }

    querySelectorAll(sel) {
        const res = [];
        for (const el of this.elements.values()) {
            if (sel.startsWith(".") && el.classList.contains(sel.slice(1))) res.push(el);
            else if (sel.startsWith("#") && el.id === sel.slice(1)) res.push(el);
        }
        return res;
    }
}

// Configuração de globals
const mockStorage = {};
global.localStorage = {
    getItem: (k) => mockStorage[k] !== undefined ? mockStorage[k] : null,
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: (k) => { delete mockStorage[k]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; }
};

const doc = new MockDocument();
global.document = doc;
global.window = {
    addEventListener: (type, fn) => {
        if (!global.window.listeners[type]) global.window.listeners[type] = [];
        global.window.listeners[type].push(fn);
    },
    removeEventListener: (type, fn) => {
        if (!global.window.listeners[type]) return;
        global.window.listeners[type] = global.window.listeners[type].filter(f => f !== fn);
    },
    dispatchEvent: (evt) => {
        const handlers = global.window.listeners[evt.type] || [];
        for (const h of handlers) h(evt);
    },
    listeners: {},
    popoutWindows: {},
    showToast: (msg, type) => {
        global.lastToast = { msg, type };
    }
};
global.BroadcastChannel = class {
    postMessage() {}
    addEventListener() {}
};
global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
global.Event = class {
    constructor(type) {
        this.type = type;
        this.defaultPrevented = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
};

// 2. Criação dos Elementos NLE do Mock DOM
const appContainer = doc.register(new MockElement("app-container", "DIV"));
doc.body.appendChild(appContainer);

const headerRestoreTrigger = doc.register(new MockElement("header-restore-trigger", "DIV"));
const btnCollapseHeader = doc.register(new MockElement("btn-collapse-header", "BUTTON"));
btnCollapseHeader.addEventListener("click", () => appContainer.classList.add("header-collapsed"));
headerRestoreTrigger.addEventListener("click", () => appContainer.classList.remove("header-collapsed"));

const sidebarLeft = doc.register(new MockElement("sidebar-left", "ASIDE"));
const toggleLeft = doc.register(new MockElement("toggle-left", "BUTTON"));
const reopenLeft = doc.register(new MockElement("reopen-left", "DIV"));
toggleLeft.addEventListener("click", () => sidebarLeft.classList.add("collapsed"));
reopenLeft.addEventListener("click", () => sidebarLeft.classList.remove("collapsed"));

const inspectorPanel = doc.register(new MockElement("inspector-panel", "DIV"));
const toggleInspector = doc.register(new MockElement("toggle-inspector", "BUTTON"));
const reopenInspector = doc.register(new MockElement("reopen-inspector", "DIV"));
const btnMaxInspector = doc.register(new MockElement("btn-maximize-inspector", "BUTTON"));
toggleInspector.addEventListener("click", () => inspectorPanel.classList.add("collapsed"));
reopenInspector.addEventListener("click", () => inspectorPanel.classList.remove("collapsed"));
btnMaxInspector.addEventListener("click", () => inspectorPanel.classList.toggle("sidebar-maximized"));

const sidebarRight = doc.register(new MockElement("sidebar-right", "ASIDE"));
const toggleRight = doc.register(new MockElement("toggle-right", "BUTTON"));
const reopenRight = doc.register(new MockElement("reopen-right", "DIV"));
const btnMaxRight = doc.register(new MockElement("btn-maximize-right", "BUTTON"));
toggleRight.addEventListener("click", () => sidebarRight.classList.add("collapsed"));
reopenRight.addEventListener("click", () => sidebarRight.classList.remove("collapsed"));
btnMaxRight.addEventListener("click", () => sidebarRight.classList.toggle("sidebar-maximized"));

const timelinePanel = doc.register(new MockElement("timeline-panel", "DIV"));
const toggleTimeline = doc.register(new MockElement("toggle-timeline", "BUTTON"));
const reopenTimeline = doc.register(new MockElement("reopen-timeline", "DIV"));
toggleTimeline.addEventListener("click", () => timelinePanel.classList.add("collapsed"));
reopenTimeline.addEventListener("click", () => timelinePanel.classList.remove("collapsed"));

const timelineHeaders = doc.register(new MockElement("timeline-headers-sidebar", "DIV"));
const btnToggleHeaders = doc.register(new MockElement("btn-toggle-headers", "BUTTON"));
const reopenHeaders = doc.register(new MockElement("reopen-headers", "DIV"));
btnToggleHeaders.addEventListener("click", () => timelineHeaders.classList.add("collapsed"));
reopenHeaders.addEventListener("click", () => timelineHeaders.classList.remove("collapsed"));

const timelineActions = doc.register(new MockElement("timeline-actions-sidebar", "DIV"));
const btnToggleToolbar = doc.register(new MockElement("btn-toggle-toolbar", "BUTTON"));
const reopenToolbar = doc.register(new MockElement("reopen-toolbar", "DIV"));
btnToggleToolbar.addEventListener("click", () => timelineActions.classList.add("collapsed"));
reopenToolbar.addEventListener("click", () => timelineActions.classList.remove("collapsed"));

const timelineHeaderBar = doc.register(new MockElement("timeline-header-bar", "DIV"));
const btnToggleTimelineHeader = doc.register(new MockElement("btn-toggle-timeline-header", "BUTTON"));
const reopenTimelineHeader = doc.register(new MockElement("reopen-timeline-header", "DIV"));
btnToggleTimelineHeader.addEventListener("click", () => timelineHeaderBar.classList.add("collapsed"));
reopenTimelineHeader.addEventListener("click", () => timelineHeaderBar.classList.remove("collapsed"));

const sourcePanel = doc.register(new MockElement("source-player-panel", "DIV"));
const btnExpandSource = doc.register(new MockElement("btn-expand-source", "BUTTON"));
btnExpandSource.addEventListener("click", () => sourcePanel.classList.toggle("maximized"));

const programPanel = doc.register(new MockElement("program-player-panel", "DIV"));
const btnExpandProgram = doc.register(new MockElement("btn-expand-program", "BUTTON"));
btnExpandProgram.addEventListener("click", () => programPanel.classList.toggle("maximized"));

const trackHeightSlider = doc.register(new MockElement("track-height-slider", "INPUT"));
trackHeightSlider.min = "50";
trackHeightSlider.max = "170";
trackHeightSlider.step = "5";
trackHeightSlider.value = "100";

const selectWorkspace = doc.register(new MockElement("select-workspace", "SELECT"));
const optgroupCustom = doc.register(new MockElement("optgroup-custom-workspaces", "OPTGROUP"));
selectWorkspace.appendChild(optgroupCustom);

// Importações dos módulos da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG } = require("../src/ui/js/keymapService.js");
const { WorkspaceManager } = require("../src/ui/js/workspaceManager.js");

const wm = new WorkspaceManager();

function simulateKeyEvent(code, { ctrl = false, alt = false, shift = false, key = "", target = null } = {}) {
    const evt = {
        code,
        key: key || code,
        ctrlKey: ctrl,
        altKey: alt,
        shiftKey: shift,
        metaKey: false,
        type: "keydown",
        defaultPrevented: false,
        target: target || doc.body,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
    };
    const handlers = global.window.listeners["keydown"] || [];
    for (const h of handlers) {
        h(evt);
    }
    return evt;
}

// -------------------------------------------------------------
// TESTE 1: Catálogo de Comandos no KeymapService
// -------------------------------------------------------------
console.log("-> Teste 1: Validação do catálogo de comandos Numpad e Slots");
const expectedCommands = [
    "workspace.numpad_0", "workspace.numpad_1", "workspace.numpad_2", "workspace.numpad_3",
    "workspace.numpad_4", "workspace.numpad_5", "workspace.numpad_6", "workspace.numpad_7",
    "workspace.numpad_8", "workspace.numpad_9", "workspace.numpad_add", "workspace.numpad_subtract",
    "workspace.numpad_decimal", "workspace.numpad_divide", "workspace.numpad_multiply", "workspace.numpad_enter",
    "workspace.alt_numpad_1", "workspace.alt_numpad_2", "workspace.alt_numpad_3", "workspace.alt_numpad_4",
    "workspace.alt_numpad_5", "workspace.alt_numpad_6", "workspace.alt_numpad_7", "workspace.alt_numpad_9",
    "workspace.ctrl_numpad_2", "workspace.ctrl_numpad_4", "workspace.ctrl_numpad_5", "workspace.ctrl_numpad_6",
    "workspace.ctrl_numpad_7", "workspace.ctrl_numpad_9"
];

expectedCommands.forEach(cmdId => {
    assert(KEYMAP_SERVICE.getCommand(cmdId), `Comando ${cmdId} deve existir no COMMANDS_CATALOG`);
});

for (let i = 1; i <= 9; i++) {
    assert(KEYMAP_SERVICE.getCommand(`workspace.load_slot_${i}`), `Comando workspace.load_slot_${i} deve existir`);
    assert(KEYMAP_SERVICE.getCommand(`workspace.save_slot_${i}`), `Comando workspace.save_slot_${i} deve existir`);
}
console.log("✓ Teste 1 passou: Todos os comandos Numpad e Slots catalogados com sucesso.");

// -------------------------------------------------------------
// TESTE 2: Expansão Direcional da Timeline via Numpad 1, 2 e 3
// -------------------------------------------------------------
console.log("-> Teste 2: Expansão Direcional da Timeline via Numpad 1, 2, 3");
wm.setTimelinePosition("center");
assert.strictEqual(wm.timelinePosition, "center");

// Numpad 1: Expande para esquerda (bottom-left)
simulateKeyEvent("Numpad1");
assert.strictEqual(wm.timelinePosition, "bottom-left", "Numpad 1 deve expandir para bottom-left a partir de center");

// Numpad 3: Com bottom-left, expandir para direita leva a bottom-full
simulateKeyEvent("Numpad3");
assert.strictEqual(wm.timelinePosition, "bottom-full", "Numpad 3 a partir de bottom-left deve expandir para bottom-full");

// Numpad 1: A partir de bottom-full, recolher esquerda leva a bottom-right
simulateKeyEvent("Numpad1");
assert.strictEqual(wm.timelinePosition, "bottom-right", "Numpad 1 a partir de bottom-full deve recolher para bottom-right");

// Numpad 3: A partir de bottom-right, recolher direita volta a center
simulateKeyEvent("Numpad3");
assert.strictEqual(wm.timelinePosition, "center", "Numpad 3 a partir de bottom-right deve voltar a center");

// Numpad 2: Alternância full-width / center
simulateKeyEvent("Numpad2");
assert.strictEqual(wm.timelinePosition, "bottom-full", "Numpad 2 deve alternar de center para bottom-full");
simulateKeyEvent("Numpad2");
assert.strictEqual(wm.timelinePosition, "center", "Numpad 2 deve retornar de bottom-full para center");

console.log("✓ Teste 2 passou: Máquina de estados direcional do Numpad 1, 2 e 3 validada.");

// -------------------------------------------------------------
// TESTE 3: Subcomponentes da Timeline via Alt + Numpad 1, 2, 3 e Numpad Decimal
// -------------------------------------------------------------
console.log("-> Teste 3: Subcomponentes da Timeline (Alt + Numpad 1, 2, 3 e .)");

// Alt + Numpad 1: Track Headers
assert(!timelineHeaders.classList.contains("collapsed"));
simulateKeyEvent("Numpad1", { alt: true });
assert(timelineHeaders.classList.contains("collapsed"), "Alt + Numpad 1 deve colapsar headers de pista");
simulateKeyEvent("Numpad1", { alt: true });
assert(!timelineHeaders.classList.contains("collapsed"), "Alt + Numpad 1 deve restaurar headers de pista");

// Alt + Numpad 2: Timeline Panel Vertical
assert(!timelinePanel.classList.contains("collapsed"));
simulateKeyEvent("Numpad2", { alt: true });
assert(timelinePanel.classList.contains("collapsed"), "Alt + Numpad 2 deve colapsar verticalmente a timeline");
simulateKeyEvent("Numpad2", { alt: true });
assert(!timelinePanel.classList.contains("collapsed"), "Alt + Numpad 2 deve restaurar verticalmente a timeline");

// Alt + Numpad 3: Timeline Toolbar
assert(!timelineActions.classList.contains("collapsed"));
simulateKeyEvent("Numpad3", { alt: true });
assert(timelineActions.classList.contains("collapsed"), "Alt + Numpad 3 deve colapsar a barra de ferramentas");
simulateKeyEvent("Numpad3", { alt: true });
assert(!timelineActions.classList.contains("collapsed"), "Alt + Numpad 3 deve restaurar a barra de ferramentas");

// Numpad Decimal: Timeline Header Bar
assert(!timelineHeaderBar.classList.contains("collapsed"));
simulateKeyEvent("NumpadDecimal");
assert(timelineHeaderBar.classList.contains("collapsed"), "NumpadDecimal deve colapsar a barra superior da timeline");
simulateKeyEvent("NumpadDecimal");
assert(!timelineHeaderBar.classList.contains("collapsed"), "NumpadDecimal deve restaurar a barra superior da timeline");

console.log("✓ Teste 3 passou: Controle de subcomponentes da timeline validado.");

// -------------------------------------------------------------
// TESTE 4: Modo Zen / Cinema (Numpad 0)
// -------------------------------------------------------------
console.log("-> Teste 4: Modo Zen / Cinema (Numpad 0)");

// Garantir estado aberto
appContainer.classList.remove("header-collapsed");
sidebarLeft.classList.remove("collapsed");
inspectorPanel.classList.remove("collapsed");
sidebarRight.classList.remove("collapsed");
wm.isZenMode = false;

// Ativar Modo Zen
simulateKeyEvent("Numpad0");
assert.strictEqual(wm.isZenMode, true, "isZenMode deve ser true");
assert(appContainer.classList.contains("header-collapsed"), "Header deve ser colapsado no Modo Zen");
assert(sidebarLeft.classList.contains("collapsed"), "Sidebar esquerda deve ser colapsada no Modo Zen");
assert(inspectorPanel.classList.contains("collapsed"), "Inspetor deve ser colapsado no Modo Zen");
assert(sidebarRight.classList.contains("collapsed"), "Sidebar direita deve ser colapsada no Modo Zen");

// Desativar Modo Zen e checar restauração exata
simulateKeyEvent("Numpad0");
assert.strictEqual(wm.isZenMode, false, "isZenMode deve voltar a false");
assert(!appContainer.classList.contains("header-collapsed"), "Header deve voltar a visível");
assert(!sidebarLeft.classList.contains("collapsed"), "Sidebar esquerda deve voltar a visível");
assert(!inspectorPanel.classList.contains("collapsed"), "Inspetor deve voltar a visível");
assert(!sidebarRight.classList.contains("collapsed"), "Sidebar direita deve voltar a visível");

console.log("✓ Teste 4 passou: Modo Zen e restauração de visibilidade validados.");

// -------------------------------------------------------------
// TESTE 5: Ajuste de Altura das Pistas (Numpad + e -)
// -------------------------------------------------------------
console.log("-> Teste 5: Ajuste de Altura das Pistas (Numpad + e -)");
trackHeightSlider.value = "100";

simulateKeyEvent("NumpadAdd");
assert.strictEqual(trackHeightSlider.value, "110", "NumpadAdd deve incrementar a altura para 110");

simulateKeyEvent("NumpadSubtract");
assert.strictEqual(trackHeightSlider.value, "100", "NumpadSubtract deve decrementar a altura para 100");

// Teste de clamp no máximo (170)
trackHeightSlider.value = "170";
simulateKeyEvent("NumpadAdd");
assert.strictEqual(trackHeightSlider.value, "170", "NumpadAdd não deve ultrapassar max (170)");

// Teste de clamp no mínimo (50)
trackHeightSlider.value = "50";
simulateKeyEvent("NumpadSubtract");
assert.strictEqual(trackHeightSlider.value, "50", "NumpadSubtract não deve ficar abaixo de min (50)");

console.log("✓ Teste 5 passou: Incremento e decremento das pistas com clamping validados.");

// -------------------------------------------------------------
// TESTE 6: Slots Numéricos de Workspace (Ctrl+Alt+1..9 e Ctrl+Alt+Shift+1..9)
// -------------------------------------------------------------
console.log("-> Teste 6: Slots Numéricos de Workspace");

// Gravar layout atual no Slot 5 via Ctrl + Alt + Shift + 5 (usando Digit5 ou Numpad5)
let appliedPreset = null;
wm.applyWorkspace = (id) => { appliedPreset = id; };

simulateKeyEvent("Digit5", { ctrl: true, alt: true, shift: true });
const slotsAfterSave = wm.getWorkspaceSlots();
assert(slotsAfterSave["5"], "Slot 5 deve estar definido no dicionário de slots");

// Carregar Slot 5 via Ctrl + Alt + 5
simulateKeyEvent("Numpad5", { ctrl: true, alt: true, shift: false });
assert.strictEqual(appliedPreset, slotsAfterSave["5"], "Carregar Slot 5 deve aplicar o workspace salvo");

// Carregar Slot 1 padrão (deve ser 'default')
simulateKeyEvent("Digit1", { ctrl: true, alt: true, shift: false });
assert.strictEqual(appliedPreset, "default", "Slot 1 padrão deve aplicar 'default'");

// Carregar Slot 2 padrão (deve ser 'decupagem')
simulateKeyEvent("Digit2", { ctrl: true, alt: true, shift: false });
assert.strictEqual(appliedPreset, "decupagem", "Slot 2 padrão deve aplicar 'decupagem'");

console.log("✓ Teste 6 passou: Gravação e leitura de slots numéricos de workspace validados.");

// -------------------------------------------------------------
// TESTE 7: Proteção contra digitação em campos de formulário (Inputs Guard)
// -------------------------------------------------------------
console.log("-> Teste 7: Proteção contra digitação em campos de formulário");

const mockInput = new MockElement("title-input", "INPUT");
const initialPos = wm.timelinePosition;

// Pressionar Numpad 1 enquanto focado em input NÃO deve alterar a workspace
const evt = simulateKeyEvent("Numpad1", { target: mockInput });
assert.strictEqual(wm.timelinePosition, initialPos, "Digitar Numpad1 em campo input NÃO deve acionar atalho de layout");
assert.strictEqual(evt.defaultPrevented, false, "Evento não deve ser prevenido em campos de texto");

const mockTextarea = new MockElement("notes-area", "TEXTAREA");
simulateKeyEvent("NumpadAdd", { target: mockTextarea });
assert.strictEqual(trackHeightSlider.value, "50", "Digitar '+' em textarea NÃO deve alterar slider de pistas");

console.log("✓ Teste 7 passou: Digitação em inputs e textareas protegida integralmente.");

console.log("\n==================================================================");
console.log("TODOS OS 7 TESTES DE ATALHOS NUMPAD & SLOTS PASSARAM COM SUCESSO!");
console.log("==================================================================");
