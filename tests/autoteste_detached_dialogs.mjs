// ======================================================================
// Autoteste: Sistema de Diálogos e Confirmações NLE em Janelas Destacadas
// Execução: node tests/autoteste_detached_dialogs.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== INICIANDO AUTOTESTE: DIÁLOGOS NLE EM JANELAS DESTACADAS (MULTI-MONITOR) ===\n");

// ----------------------------------------------------------------------
// PARTE 1: Verificações Estáticas de Código
// ----------------------------------------------------------------------
console.log("--- PARTE 1: Verificações Estáticas de Código ---");

const dialogsJsPath = path.join(rootDir, "src", "ui", "js", "dialogs.js");
const dialogsJs = readFileSync(dialogsJsPath, "utf8");

const panelsJsPath = path.join(rootDir, "src", "ui", "js", "panels.js");
const panelsJs = readFileSync(panelsJsPath, "utf8");

const wmJsPath = path.join(rootDir, "src", "ui", "js", "workspaceManager.js");
const wmJs = readFileSync(wmJsPath, "utf8");

const libraryJsPath = path.join(rootDir, "src", "ui", "js", "library.js");
const libraryJs = readFileSync(libraryJsPath, "utf8");

const mainJsPath = path.join(rootDir, "src", "ui", "js", "main.js");
const mainJs = readFileSync(mainJsPath, "utf8");

const stylesCssPath = path.join(rootDir, "src", "ui", "styles.css");
const stylesCss = readFileSync(stylesCssPath, "utf8");

// 1.1 dialogs.js exporta funções fundamentais e suporta multi-janela
console.log("1.1 Verificando exportações e guardas multi-janela em dialogs.js...");
assert(dialogsJs.includes("export function resolveTargetContext"), "dialogs.js deve exportar resolveTargetContext");
assert(dialogsJs.includes("export function showConfirmPopover"), "dialogs.js deve exportar showConfirmPopover");
assert(dialogsJs.includes("export function showConfirmModal"), "dialogs.js deve exportar showConfirmModal");
assert(dialogsJs.includes("export function showPromptDialog"), "dialogs.js deve exportar showPromptDialog");
assert(dialogsJs.includes("export function confirmNLE"), "dialogs.js deve exportar confirmNLE");
assert(dialogsJs.includes("target.ownerDocument"), "dialogs.js deve ler ownerDocument para respeitar janelas destacadas");
assert(dialogsJs.includes("window.popoutWindows"), "dialogs.js deve inspecionar window.popoutWindows para foco multi-monitor");
console.log("✔ 1.1 passou: dialogs.js implementa resolução multi-monitor e exportações completas.");

// 1.2 panels.js usa showConfirmPopover e showPromptDialog
console.log("1.2 Verificando remoção/adição de pistas, salvar e carregar timeline em panels.js...");
assert(panelsJs.includes("showConfirmPopover"), "panels.js deve usar showConfirmPopover na remoção de pista");
assert(panelsJs.includes("showPromptDialog"), "panels.js deve usar showPromptDialog na adição de pistas");
assert(!panelsJs.includes('if (confirm(`Remover a pista "'), "panels.js não deve mais usar confirm() nativo do browser na remoção de pista");
assert(!panelsJs.includes('const name = prompt("Digite um nome para esta versão da timeline:"'), "saveActiveTimeline não deve usar prompt() nativo");
assert(!panelsJs.includes('const answer = prompt(`Digite o ID da timeline para carregar:'), "loadTimelinePrompt não deve usar prompt() nativo");
assert(!mainJs.includes('const newName = prompt("Renomear a timeline atual:"'), "doRenameTimeline em main.js não deve usar prompt() nativo");
assert(!libraryJs.includes('const novo = prompt("Novo nome para o subclipe:"'), "renameSubclip em library.js não deve usar prompt() nativo");
assert(!libraryJs.includes('if (!confirm(`Deseja realmente excluir o subclipe "'), "deleteSubclip em library.js não deve usar confirm() nativo");
console.log("✔ 1.2 passou: panels.js, main.js e library.js migrados para diálogos NLE assíncronos contextuais.");

// 1.3 workspaceManager.js showToast suporta multi-janela
console.log("1.3 Verificando showToast multi-janela em workspaceManager.js...");
assert(wmJs.includes("export function showToast(msg, type = \"info\", target = null)"), "showToast deve aceitar parâmetro de alvo multi-janela");
assert(wmJs.includes("target.ownerDocument"), "showToast deve checar ownerDocument do alvo");
console.log("✔ 1.3 passou: showToast renderiza na janela correta.");

// 1.4 styles.css contém as classes do design system NLE
console.log("1.4 Verificando regras de estilo em styles.css...");
assert(stylesCss.includes(".nle-confirm-popover"), "styles.css deve conter .nle-confirm-popover");
assert(stylesCss.includes(".nle-popover-arrow"), "styles.css deve conter .nle-popover-arrow");
assert(stylesCss.includes(".nle-confirm-popover.theme-danger"), "styles.css deve conter .nle-confirm-popover.theme-danger com Rose");
assert(stylesCss.includes(".nle-confirm-modal-box"), "styles.css deve conter .nle-confirm-modal-box");
console.log("✔ 1.4 passou: estilos do design system Dark Glassmorphism configurados.");

// 1.5 library.js isAnyModalOpen reconhece diálogos NLE
console.log("1.5 Verificando isAnyModalOpen em library.js...");
assert(libraryJs.includes(".nle-confirm-popover"), "isAnyModalOpen deve verificar .nle-confirm-popover");
console.log("✔ 1.5 passou: isAnyModalOpen reconhece novos diálogos.");

// ----------------------------------------------------------------------
// PARTE 2: Testes Funcionais em Ambiente Simulado Multi-Janela
// ----------------------------------------------------------------------
console.log("\n--- PARTE 2: Testes Funcionais em Ambiente Simulado Multi-Janela ---");

globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

class MockClassList {
    constructor() {
        this._set = new Set();
    }
    add(c) { this._set.add(c); }
    remove(c) { this._set.delete(c); }
    toggle(c, val) { if (val) this._set.add(c); else this._set.delete(c); }
    contains(c) { return this._set.has(c); }
    clear() { this._set.clear(); }
    get size() { return this._set.size; }
    [Symbol.iterator]() { return this._set[Symbol.iterator](); }
}

class MockElement {
    constructor(tagName, ownerDoc) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.ownerDocument = ownerDoc;
        this.children = [];
        this.classList = new MockClassList();
        this.style = {};
        this.attributes = {};
        this.listeners = {};
        this._innerHTML = "";
        this.textContent = "";
        this.isConnected = true;
        this.parentNode = null;
        this.value = "";
    }

    set className(val) {
        this.classList.clear();
        if (val) {
            val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
        }
    }

    get className() {
        return Array.from(this.classList).join(" ");
    }

    set innerHTML(html) {
        this._innerHTML = html;
        if (html.includes("nle-btn-confirm")) {
            const btn = new MockElement("button", this.ownerDocument);
            btn.className = "nle-btn-popover nle-btn-confirm danger";
            this.appendChild(btn);
        }
        if (html.includes("nle-btn-cancel")) {
            const btn = new MockElement("button", this.ownerDocument);
            btn.className = "nle-btn-popover nle-btn-cancel";
            this.appendChild(btn);
        }
        if (html.includes("nle-prompt-input")) {
            const inp = new MockElement("input", this.ownerDocument);
            inp.className = "nle-prompt-input";
            const valMatch = html.match(/value="([^"]*)"/);
            if (valMatch) inp.value = valMatch[1];
            this.appendChild(inp);
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    removeAttribute(k) { delete this.attributes[k]; }
    hasAttribute(k) { return k in this.attributes; }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
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

    remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    dispatchEvent(event) {
        const list = (this.listeners[event.type] || []).slice();
        for (const fn of list) fn(event);
    }

    querySelector(sel) {
        if (sel.startsWith(".")) {
            const cls = sel.substring(1);
            if (this.classList.contains(cls)) return this;
            for (const c of this.children) {
                const found = c.querySelector(sel);
                if (found) return found;
            }
        }
        if (sel.startsWith("#")) {
            const id = sel.substring(1);
            if (this.id === id) return this;
            for (const c of this.children) {
                const found = c.querySelector(sel);
                if (found) return found;
            }
        }
        for (const c of this.children) {
            const found = c.querySelector(sel);
            if (found) return found;
        }
        return null;
    }

    querySelectorAll(sel) {
        const results = [];
        const check = (el) => {
            if (sel.startsWith(".") && el.classList.contains(sel.substring(1))) results.push(el);
            for (const c of el.children) check(c);
        };
        for (const c of this.children) check(c);
        return results;
    }

    contains(other) {
        if (this === other) return true;
        for (const c of this.children) {
            if (c.contains(other)) return true;
        }
        return false;
    }

    getBoundingClientRect() {
        return {
            left: 200,
            top: 500,
            right: 230,
            bottom: 530,
            width: 30,
            height: 30
        };
    }

    focus() {
        if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }

    select() {}
}

class MockDocument {
    constructor(win) {
        this.nodeType = 9;
        this.defaultView = win;
        this.body = new MockElement("body", this);
        this.listeners = {};
        this.activeElement = this.body;
        this._hasKeyboardFocus = false;
    }

    createElement(tag) {
        return new MockElement(tag, this);
    }

    getElementById(id) {
        const search = (el) => {
            if (el.id === id) return el;
            for (const c of el.children) {
                const found = search(c);
                if (found) return found;
            }
            return null;
        };
        return search(this.body);
    }

    querySelectorAll(sel) {
        return this.body.querySelectorAll(sel);
    }

    addEventListener(event, fn, capture = false) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn, capture = false) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    dispatchEvent(event) {
        const list = (this.listeners[event.type] || []).slice();
        for (const fn of list) fn(event);
    }

    hasFocus() {
        return this._hasKeyboardFocus;
    }
}

class MockWindow {
    constructor(name) {
        this.name = name;
        this.document = new MockDocument(this);
        this.innerWidth = 1920;
        this.innerHeight = 1080;
        this.listeners = {};
        this.closed = false;
    }

    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== fn);
    }

    requestAnimationFrame(cb) {
        return setTimeout(cb, 0);
    }
}

// Configura Janela Principal (Editor) e Janela Popout (Timeline Destacada no Monitor 2)
const mainWindow = new MockWindow("CapIAu_Main_Window");
const popoutWindow = new MockWindow("CapIAu_Timeline_Window");

globalThis.window = mainWindow;
globalThis.document = mainWindow.document;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
mainWindow.popoutWindows = {
    "timeline-panel": popoutWindow
};

// Importa dinamicamente dialogs.js
const dialogsModule = await import("../src/ui/js/dialogs.js");
const { resolveTargetContext, showConfirmPopover, showConfirmModal, showPromptDialog } = dialogsModule;

// 2.1 Teste de Resolução de Contexto
console.log("2.1 Testando resolveTargetContext...");
const btnInPopout = popoutWindow.document.createElement("button");
btnInPopout.id = "btn-remove-v1";
popoutWindow.document.body.appendChild(btnInPopout);

const ctx1 = resolveTargetContext(btnInPopout);
assert.equal(ctx1.doc, popoutWindow.document, "Elemento no popout deve resolver para o documento do popout");
assert.equal(ctx1.win, popoutWindow, "Elemento no popout deve resolver para a janela do popout");
assert.equal(ctx1.anchorEl, btnInPopout, "Elemento âncora deve ser o botão clicado");

const btnInMain = mainWindow.document.createElement("button");
mainWindow.document.body.appendChild(btnInMain);
const ctx2 = resolveTargetContext(btnInMain);
assert.equal(ctx2.doc, mainWindow.document, "Elemento no editor principal deve resolver para o documento principal");

popoutWindow.document._hasKeyboardFocus = true;
const ctx3 = resolveTargetContext(null);
assert.equal(ctx3.doc, popoutWindow.document, "Sem alvo explícito, janela focada (popout) deve ser selecionada");
console.log("✔ 2.1 passou: Contexto resolvido com precisão absoluta entre múltiplas janelas.");

// 2.2 Teste de showConfirmPopover disparado de elemento no Popout (Monitor 2)
console.log("2.2 Testando showConfirmPopover disparado no popout...");
let popoverPromise = showConfirmPopover({
    targetEl: btnInPopout,
    title: 'Remover pista "V1 Falas"?',
    message: 'Os clipes dela serão movidos para outra pista do mesmo tipo.',
    confirmText: 'Remover Pista',
    danger: true
});

// Verifica onde o popover foi inserido no DOM
const popoversInPopout = popoutWindow.document.querySelectorAll(".nle-confirm-popover");
const popoversInMain = mainWindow.document.querySelectorAll(".nle-confirm-popover");

assert.equal(popoversInPopout.length, 1, "O popover DEVE ser renderizado dentro do body da janela popout!");
assert.equal(popoversInMain.length, 0, "O popover NÃO DEVE vazar para a janela principal do editor!");

const popoverEl = popoversInPopout[0];
assert(popoverEl.classList.contains("theme-danger"), "Ação destrutiva deve ter classe theme-danger");
assert.equal(popoverEl.parentNode, popoutWindow.document.body, "Popover deve ser filho direto do body do popout");

// Simula cancelamento via tecla Escape disparada NO DOCUMENTO DO POPOUT
popoutWindow.document.dispatchEvent({ type: "keydown", key: "Escape", preventDefault: () => {}, stopPropagation: () => {} });

const resultCancel = await popoverPromise;
assert.equal(resultCancel, false, "Tecla Escape deve cancelar o popover retornando false");
console.log("✔ 2.2 passou: Popover renderizado no monitor do popout e cancelado via Escape sem afetar janela principal.");

// 2.3 Teste de Confirmação com clique no botão de ação
console.log("2.3 Testando confirmação com clique...");
popoverPromise = showConfirmPopover({
    targetEl: btnInPopout,
    title: 'Remover pista "V1 Falas"?',
    danger: true
});

const popoversAfterOpen = popoutWindow.document.querySelectorAll(".nle-confirm-popover");
const popoverEl2 = popoversAfterOpen[popoversAfterOpen.length - 1];
assert(popoverEl2, "Popover deve estar aberto no popout");

// Busca o botão de confirmação dentro do popover e clica
const btnConfirm = popoverEl2.querySelector(".nle-btn-confirm");
assert(btnConfirm, "Botão de confirmação deve existir no popover");
btnConfirm.dispatchEvent({ type: "click" });

const resultConfirm = await popoverPromise;
assert.equal(resultConfirm, true, "Clique no botão confirmar deve resolver promise com true");
console.log("✔ 2.3 passou: Confirmação concluída com sucesso no popout.");

// 2.4 Teste de showPromptDialog no popout
console.log("2.4 Testando showPromptDialog para criação de pista no popout...");
const promptPromise = showPromptDialog({
    targetEl: btnInPopout,
    title: "Nova Pista de Vídeo",
    defaultValue: "V2 Câmera B"
});

const promptsInPopout = popoutWindow.document.querySelectorAll(".nle-prompt-dialog");
assert.equal(promptsInPopout.length, 1, "Prompt deve abrir na janela popout");
assert.equal(mainWindow.document.querySelectorAll(".nle-prompt-dialog").length, 0, "Prompt não deve abrir no editor");

const promptEl = promptsInPopout[0];
const inputEl = promptEl.querySelector(".nle-prompt-input");
assert(inputEl, "Campo de entrada de texto deve existir");
assert.equal(inputEl.value, "V2 Câmera B", "Valor padrão deve estar preenchido");

// Altera o valor e pressiona Enter no popout
inputEl.value = "V2 Entrevista Exclusiva";
popoutWindow.document.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {}, stopPropagation: () => {} });

const promptResult = await promptPromise;
assert.equal(promptResult, "V2 Entrevista Exclusiva", "Enter deve submeter o texto digitado");
console.log("✔ 2.4 passou: showPromptDialog executado e submetido com sucesso no popout.");

// 2.5 Teste de showToast Multi-Janela
console.log("2.5 Testando showToast direcionado à janela correta...");
const { showToast } = await import("../src/ui/js/workspaceManager.js");

showToast("Destrave o cadeado da pista antes de removê-la.", "warning", btnInPopout);

const toastInPopout = popoutWindow.document.getElementById("global-nle-toast");
assert(toastInPopout, "showToast deve criar o toast no body do popout quando target está no popout");
assert.equal(toastInPopout.textContent, "Destrave o cadeado da pista antes de removê-la.");
console.log("✔ 2.5 passou: showToast exibido no monitor do popout.");

console.log("\n=======================================================");
console.log("🎉 TODOS OS TESTES DE DIÁLOGOS NLE MULTI-JANELA PASSARAM COM SUCESSO!");
console.log("=======================================================");
