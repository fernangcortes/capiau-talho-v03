// ======================================================================
// Autoteste: Atalho 'a' e Gerenciamento de Rostos com Biblioteca Destacada
// Execução: node tests/autoteste_detached_faces_shortcuts.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== INICIANDO AUTOTESTE: ATALHOS DE ROSTOS NA BIBLIOTECA DESTACADA ===\n");

// ----------------------------------------------------------------------
// PARTE 1: Verificação Estática de Código (Garantias Estruturais)
// ----------------------------------------------------------------------
console.log("--- PARTE 1: Verificações Estáticas de Código ---");

const facesJsPath = path.join(rootDir, "src", "ui", "js", "faces.js");
const facesJs = readFileSync(facesJsPath, "utf8");

const libraryJsPath = path.join(rootDir, "src", "ui", "js", "library.js");
const libraryJs = readFileSync(libraryJsPath, "utf8");

const wmJsPath = path.join(rootDir, "src", "ui", "js", "workspaceManager.js");
const wmJs = readFileSync(wmJsPath, "utf8");

// 1.1 library.js: isAnyModalOpen inspeciona popouts e inspectorCard
console.log("1.1 Verificando isAnyModalOpen em library.js...");
assert(
    libraryJs.includes("for (const name in window.popoutWindows)"),
    "isAnyModalOpen deve iterar sobre window.popoutWindows para inspecionar janelas destacadas"
);
assert(
    libraryJs.includes("if (window.FaceManager && window.FaceManager.inspectorCard)"),
    "isAnyModalOpen deve considerar o Inspetor de Rosto como modal aberto para impedir vazamento de atalhos"
);
assert(
    libraryJs.includes("const win = doc.defaultView || window;") && libraryJs.includes("const style = win.getComputedStyle(el);"),
    "isAnyModalOpen deve obter getComputedStyle a partir de doc.defaultView || window"
);
console.log("✔ 1.1 passou: isAnyModalOpen inspeciona popouts e o Inspetor de Rosto ativamente.");

// 1.2 workspaceManager.js: Bloqueio de encaminhamento de teclas ao player quando modal/inspector aberto
console.log("1.2 Verificando bloqueio de encaminhamento de teclas em workspaceManager.js...");
const wmModalGuards = (wmJs.match(/if \(window\.isAnyModalOpen && window\.isAnyModalOpen\(win\.document\)\) return;/g) || []).length;
const wmFaceGuards = (wmJs.match(/if \(window\.FaceManager && window\.FaceManager\.inspectorCard\) return;/g) || []).length;
assert(
    wmModalGuards >= 2 && wmFaceGuards >= 2,
    "workspaceManager.js deve conter as guardas de isAnyModalOpen e FaceManager.inspectorCard em attachPanelToPopout e attachDualPanelsToPopout"
);
assert(
    wmJs.includes("FaceManager.onPopoutReady(win)"),
    "workspaceManager.js deve invocar FaceManager.onPopoutReady(win) ao destacar painéis"
);
assert(
    wmJs.includes("FaceManager.onPopoutRestored()"),
    "workspaceManager.js deve invocar FaceManager.onPopoutRestored() ao restaurar painéis"
);
console.log("✔ 1.2 passou: workspaceManager protege atalhos contra encaminhamento e notifica FaceManager.");

// 1.3 faces.js: Adoção e restauração de modais
console.log("1.3 Verificando adoptModals e restoreModals em faces.js...");
assert(facesJs.includes("static adoptModals(targetDoc)"), "faces.js deve definir static adoptModals");
assert(facesJs.includes("static restoreModals(mainDoc = document)"), "faces.js deve definir static restoreModals");
assert(facesJs.includes('"face-group-manager-modal"'), "adoptModals deve incluir face-group-manager-modal");
assert(facesJs.includes('"fullscreen-faces-disambiguation"'), "adoptModals deve incluir fullscreen-faces-disambiguation");
assert(facesJs.includes('"face-disambiguation-modal"'), "adoptModals deve incluir face-disambiguation-modal");
assert(facesJs.includes('"face-inspector-overlay"'), "adoptModals deve incluir face-inspector-overlay");
console.log("✔ 1.3 passou: Gerenciamento do ciclo de vida de modais no DOM correto.");

// 1.4 faces.js: Captura de mouseenter nos cards do Gerenciador de Grupos e Clusters
console.log("1.4 Verificando rastreamento de hoveredCard em faces.js...");
assert(
    facesJs.includes('card.addEventListener("mouseenter", () => { FaceManager.hoveredCard = card; });'),
    "renderFaceClusters deve rastrear hoveredCard no mouseenter"
);
assert(
    facesJs.includes('FaceManager.hoveredCard = card;'),
    "renderGroupManagerFaces e renderFullscreenFaces devem atualizar FaceManager.hoveredCard"
);
assert(
    facesJs.includes('if (FaceManager.hoveredCard === card) FaceManager.hoveredCard = null;'),
    "Card mouseleave deve limpar FaceManager.hoveredCard"
);
console.log("✔ 1.4 passou: hoveredCard é atribuído consistentemente em todos os grids de rostos.");

// 1.5 faces.js: bindKeyboardEvents com janela alvo e atalho 'a'
console.log("1.5 Verificando bindKeyboardEvents e atalho 'a' em faces.js...");
assert(facesJs.includes("static bindKeyboardEvents(win)"), "faces.js deve definir static bindKeyboardEvents(win)");
assert(facesJs.includes("static handleKeyboard(e, targetWin = window)"), "handleKeyboard deve aceitar targetWin");
assert(
    facesJs.includes('.group-manager-face-card:hover') && facesJs.includes('.group-manager-face-card.selected'),
    "handleKeyboard deve buscar cards do gerenciador de grupos como alvos válidos"
);
assert(
    facesJs.includes("this.openInspector(targetCard);"),
    "handleKeyboard deve chamar openInspector(targetCard) no atalho 'a'"
);
assert(
    facesJs.includes(".group-manager-face-card, .face-cluster-card"),
    "stepInspector deve permitir navegar entre cards do gerenciador de grupo e clusters"
);
console.log("✔ 1.5 passou: bindKeyboardEvents e atalho 'a' implementados com suporte total à janela popout.\n");

// ----------------------------------------------------------------------
// PARTE 2: Testes Funcionais com Simulação de DOM e Janela Popout
// ----------------------------------------------------------------------
console.log("--- PARTE 2: Testes Funcionais em Ambiente Simulado ---");

class MockClassList {
    constructor() { this.classes = new Set(); }
    add(...args) { args.forEach(c => this.classes.add(c)); }
    remove(...args) { args.forEach(c => this.classes.delete(c)); }
    contains(c) { return this.classes.has(c); }
    toggle(c, force) {
        if (force === undefined) {
            if (this.classes.has(c)) { this.classes.delete(c); return false; }
            else { this.classes.add(c); return true; }
        } else if (force) {
            this.classes.add(c); return true;
        } else {
            this.classes.delete(c); return false;
        }
    }
}

// Mock de nó DOM simples
class MockElement {
    constructor(tagName, ownerDoc, id = "") {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDoc;
        this.id = id;
        this.children = [];
        this.parentElement = null;
        this.classList = new MockClassList();
        this.style = {};
        this.dataset = {};
        this.listeners = {};
        this.textContent = "";
        this.innerHTML = "";
    }

    appendChild(child) {
        if (child.parentElement) {
            child.parentElement.removeChild(child);
        }
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentElement = null;
        }
        return child;
    }

    addEventListener(event, fn, opts) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== fn);
    }

    dispatchEvent(event) {
        if (!event.target) event.target = this;
        const list = this.listeners[event.type] || [];
        for (const cb of list) {
            cb.call(this, event);
        }
    }

    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
    }

    querySelectorAll(sel) {
        const results = [];
        const check = (node) => {
            if (matches(node, sel)) results.push(node);
            for (const c of node.children) check(c);
        };
        for (const c of this.children) check(c);
        return results;
    }

    getBoundingClientRect() {
        return { top: 10, left: 10, width: 100, height: 100 };
    }
}

// Utilitário de match simples para seletores
function matches(el, sel) {
    if (!el || !el.tagName) return false;
    const parts = sel.split(",").map(s => s.trim());
    for (const part of parts) {
        if (part.startsWith("#") && el.id === part.slice(1)) return true;
        if (part.startsWith(".") && el.classList.contains(part.slice(1))) return true;
        if (part.includes(".group-manager-face-card") && el.classList.contains("group-manager-face-card")) return true;
        if (part.includes(".face-cluster-card") && el.classList.contains("face-cluster-card")) return true;
        if (part.includes(".fullscreen-face-card") && el.classList.contains("fullscreen-face-card")) return true;
    }
    return false;
}

// Mock de Document
class MockDocument {
    constructor(win) {
        this.defaultView = win;
        this.body = new MockElement("body", this);
        this._elementsById = new Map();
    }

    createElement(tag) {
        return new MockElement(tag, this);
    }

    getElementById(id) {
        if (this._elementsById.has(id)) {
            const el = this._elementsById.get(id);
            if (el.ownerDocument === this) return el;
        }
        const findIn = (node) => {
            if (node.id === id) return node;
            for (const c of node.children) {
                const found = findIn(c);
                if (found) return found;
            }
            return null;
        };
        return findIn(this.body);
    }

    querySelector(sel) {
        return this.body.querySelector(sel);
    }

    querySelectorAll(sel) {
        return this.body.querySelectorAll(sel);
    }

    adoptNode(node) {
        if (node.parentElement) {
            node.parentElement.removeChild(node);
        }
        node.ownerDocument = this;
        return node;
    }
}

// Mock de Window
class MockWindow {
    constructor() {
        this.document = new MockDocument(this);
        this.listeners = {};
        this.popoutWindows = {};
    }

    addEventListener(event, fn, opts) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }

    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(cb => cb !== fn);
    }

    dispatchEvent(event) {
        if (!event.target) event.target = this;
        const list = this.listeners[event.type] || [];
        for (const cb of list) {
            cb.call(this, event);
        }
    }

    getComputedStyle(el) {
        return el.style || {};
    }
}

// Inicializar ambientes de janela principal e destacada (popout)
const mainWindow = new MockWindow();
const popoutWindow = new MockWindow();
mainWindow.popoutWindows = { library: popoutWindow };

// Configurar globals para importação do faces.js
global.window = mainWindow;
global.document = mainWindow.document;
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
};
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.Image = class { constructor() {} };

// Carregar FaceManager dinamicamente
const { FaceManager } = await import("../src/ui/js/faces.js");
mainWindow.FaceManager = FaceManager;

// Registrar janela destacada após inicialização dos módulos
mainWindow.popoutWindows["CapIAu_Library_Window"] = popoutWindow;
mainWindow.popoutWindows["library"] = popoutWindow;

// Criar elementos de modais no documento principal
const mainModals = [
    "face-group-manager-modal",
    "fullscreen-faces-disambiguation",
    "face-disambiguation-modal",
    "names-manager-modal",
    "entities-manager-modal",
    "face-inspector-overlay"
];

for (const mid of mainModals) {
    const el = mainWindow.document.createElement("div");
    el.id = mid;
    el.classList.add("modal-overlay");
    el.style.display = "none";
    mainWindow.document.body.appendChild(el);
    mainWindow.document._elementsById.set(mid, el);
}

// Teste 2.1: FaceManager.adoptModals move modais para o documento popout
console.log("2.1 Testando adoptModals para janela popout...");
FaceManager.adoptModals(popoutWindow.document);

for (const mid of mainModals) {
    const modalInPopout = popoutWindow.document.getElementById(mid);
    assert(modalInPopout, `Modal #${mid} deve existir no popoutWindow.document`);
    assert.equal(modalInPopout.ownerDocument, popoutWindow.document, `Modal #${mid} deve pertencer ao popoutWindow.document`);
}
console.log("✔ 2.1 passou: Todos os modais foram adotados no popoutWindow.document.");

// Teste 2.2: FaceManager.bindKeyboardEvents registra ouvintes na janela destacada
console.log("2.2 Testando bindKeyboardEvents na janela popout...");
FaceManager.bindKeyboardEvents(popoutWindow);
assert.equal(popoutWindow._hasFaceKeyboardListener, true, "popoutWindow deve ter _hasFaceKeyboardListener = true");
assert(popoutWindow.listeners["keydown"]?.length > 0, "popoutWindow deve ter listener de keydown registrado");
assert(popoutWindow.listeners["keyup"]?.length > 0, "popoutWindow deve ter listener de keyup registrado");
console.log("✔ 2.2 passou: Ouvintes de teclado registrados corretamente na janela destacada.");

// Teste 2.3: Disparo de atalho 'a' em card com hover no documento popout abre o Inspetor
console.log("2.3 Testando atalho 'a' disparado sobre card no popout...");
const groupModal = popoutWindow.document.getElementById("face-group-manager-modal");
groupModal.style.display = "flex"; // Gerenciador de grupos aberto no popout

const testCard = popoutWindow.document.createElement("div");
testCard.classList.add("group-manager-face-card");
testCard.dataset.faceId = "face_test_999";
groupModal.appendChild(testCard);

// Simular mouseenter no card
FaceManager.hoveredCard = testCard;

let inspectorOpened = false;
let openedCard = null;
const origOpenInspector = FaceManager.openInspector;
FaceManager.openInspector = async function(card) {
    inspectorOpened = true;
    openedCard = card;
    this.inspectorCard = card;
    this.inspectorFaceId = card.dataset.faceId;
    this.inspectorState = 1;
};

// Disparar tecla 'a' no popoutWindow
const keyEventA = {
    type: "keydown",
    key: "a",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {}
};

popoutWindow.dispatchEvent(keyEventA);

assert.equal(inspectorOpened, true, "Atalho 'a' deve acionar FaceManager.openInspector");
assert.equal(openedCard, testCard, "openInspector deve receber o card que estava em hover no popout");
assert.equal(FaceManager.inspectorCard, testCard, "FaceManager.inspectorCard deve estar associado ao card");
assert.equal(FaceManager.inspectorFaceId, "face_test_999", "FaceManager.inspectorFaceId deve ser 'face_test_999'");
console.log("✔ 2.3 passou: Atalho 'a' abriu o Inspetor de Rosto com precisão no card sob hover.");

// Teste 2.4: Ciclo de atalhos internos do Inspetor no popout ('a' avança, 's' regressa, 'Esc' fecha)
console.log("2.4 Testando ciclo de atalhos do Inspetor ('a', 's', 'Escape')...");
let advancedCalled = false;
let regressCalled = false;
let closeCalled = false;

FaceManager.advanceInspector = () => { advancedCalled = true; FaceManager.inspectorState = 2; };
FaceManager.regressInspector = () => { regressCalled = true; FaceManager.inspectorState = 1; };
FaceManager.closeInspector = () => {
    closeCalled = true;
    FaceManager.inspectorCard = null;
    FaceManager.inspectorFaceId = null;
    FaceManager.inspectorState = 0;
};

// Pressionar 'a' para avançar
popoutWindow.dispatchEvent({ type: "keydown", key: "a", preventDefault() {}, stopPropagation() {} });
assert.equal(advancedCalled, true, "Atalho 'a' com inspectorCard aberto deve avançar o inspetor");

// Pressionar 's' para regressar
popoutWindow.dispatchEvent({ type: "keydown", key: "s", preventDefault() {}, stopPropagation() {} });
assert.equal(regressCalled, true, "Atalho 's' deve regressar o inspetor");

// Pressionar 'Escape' para fechar
popoutWindow.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {}, stopPropagation() {} });
assert.equal(closeCalled, true, "Atalho 'Escape' deve fechar o inspetor");
assert.equal(FaceManager.inspectorCard, null, "inspectorCard deve ser limpo ao fechar");
console.log("✔ 2.4 passou: Navegação e encerramento do Inspetor funcionam perfeitamente na janela destacada.");

// Teste 2.5: FaceManager.restoreModals restaura elementos de volta ao documento principal
console.log("2.5 Testando restoreModals ao redocar painel...");
FaceManager.restoreModals(mainWindow.document);

for (const mid of mainModals) {
    const modalInMain = mainWindow.document.getElementById(mid);
    assert(modalInMain, `Modal #${mid} deve existir em mainWindow.document`);
    assert.equal(modalInMain.ownerDocument, mainWindow.document, `Modal #${mid} deve pertencer a mainWindow.document`);
}
console.log("✔ 2.5 passou: Todos os modais foram restaurados para o documento principal.");

// Teste 2.6: isAnyModalOpen com suporte a janelas popout e FaceManager.inspectorCard
console.log("2.6 Testando isAnyModalOpen em janelas popout e com inspector ativo...");
const { isAnyModalOpen } = await import("../src/ui/js/library.js");

// Garantir que todos os modais estejam fechados antes do teste
for (const mid of mainModals) {
    const m1 = mainWindow.document.getElementById(mid);
    if (m1) m1.style.display = "none";
    const m2 = popoutWindow.document.getElementById(mid);
    if (m2) m2.style.display = "none";
}
FaceManager.inspectorCard = null;

// Cenário A: Sem modais abertos e sem inspetor ativo
assert.equal(isAnyModalOpen(), false, "Sem modais e sem inspetor, deve retornar false");

// Cenário B: Inspetor de rosto ativo
FaceManager.inspectorCard = testCard;
assert.equal(isAnyModalOpen(), true, "Com inspectorCard ativo, deve retornar true para proteger atalhos");
FaceManager.inspectorCard = null;
assert.equal(isAnyModalOpen(), false, "Após fechar inspector, deve voltar a retornar false");

// Cenário C: Modal aberto na janela popout
FaceManager.adoptModals(popoutWindow.document);
const popoutModal = popoutWindow.document.getElementById("face-group-manager-modal");
assert(popoutModal, "face-group-manager-modal deve existir no popoutWindow");
popoutModal.style.display = "flex";
assert.equal(isAnyModalOpen(), true, "Com modal aberto no popout, deve retornar true");
assert.equal(isAnyModalOpen(popoutWindow.document), true, "isAnyModalOpen com targetDoc do popout deve retornar true");
popoutModal.style.display = "none";
assert.equal(isAnyModalOpen(), false, "Com modal do popout fechado, deve retornar false");
console.log("✔ 2.6 passou: isAnyModalOpen detecta corretamente modais em popouts e estado do Inspetor.");

// Teste 2.7: stepInspector com navegação entre cards de grupo (.group-manager-face-card)
console.log("2.7 Testando navegação com stepInspector em cards de gerenciador de grupo...");
const gridContainer = popoutWindow.document.createElement("div");
const cardA = popoutWindow.document.createElement("div");
cardA.classList.add("group-manager-face-card");
cardA.dataset.faceId = "face_A";
const cardB = popoutWindow.document.createElement("div");
cardB.classList.add("group-manager-face-card");
cardB.dataset.faceId = "face_B";
const cardC = popoutWindow.document.createElement("div");
cardC.classList.add("group-manager-face-card");
cardC.dataset.faceId = "face_C";

gridContainer.appendChild(cardA);
gridContainer.appendChild(cardB);
gridContainer.appendChild(cardC);

FaceManager.inspectorCard = cardA;
FaceManager.inspectorFaceId = "face_A";
FaceManager.advanceInspector = () => {};

// Avançar (step +1)
FaceManager.stepInspector(1);
assert.equal(FaceManager.inspectorCard, cardB, "stepInspector(1) deve avançar de cardA para cardB");
assert.equal(FaceManager.inspectorFaceId, "face_B", "FaceManager.inspectorFaceId deve ser 'face_B'");

// Avançar novamente
FaceManager.stepInspector(1);
assert.equal(FaceManager.inspectorCard, cardC, "stepInspector(1) deve avançar de cardB para cardC");

// Wrap around
FaceManager.stepInspector(1);
assert.equal(FaceManager.inspectorCard, cardA, "stepInspector(1) com wrap around deve voltar para cardA");

// Recuar (step -1)
FaceManager.stepInspector(-1);
assert.equal(FaceManager.inspectorCard, cardC, "stepInspector(-1) com wrap around reverso deve ir para cardC");

FaceManager.inspectorCard = null;
FaceManager.inspectorFaceId = null;
console.log("✔ 2.7 passou: stepInspector navega com precisão cíclica entre cards de grupos de rostos.");

// Restaurar método original
FaceManager.openInspector = origOpenInspector;

console.log("\n=======================================================");
console.log("🎉 TODOS OS TESTES DE ATALHOS DE ROSTOS EM JANELA DESTACADA PASSARAM COM SUCESSO!");
console.log("=======================================================\n");
