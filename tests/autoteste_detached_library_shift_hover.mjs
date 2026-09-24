// Autoteste: Validação do HUD de Informações no Shift+Hover na Biblioteca Destacada (Popout)
import assert from "node:assert/strict";

console.log("▶ Iniciando autoteste do HUD Shift+Hover na Biblioteca Destacada (Popout)...\n");

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.popoutWindows = {};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.fetch = () => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
    text: () => Promise.resolve("")
});
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

class MockImage {
    constructor() {
        this.src = "";
        this.onload = null;
        this.onerror = null;
    }
}
globalThis.Image = MockImage;

function createMockDocument(name = "main") {
    const elementsById = new Map();
    const doc = {
        name,
        defaultView: null,
        getElementById: (id) => elementsById.get(id) || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: (tag) => {
            const classes = new Set();
            const styles = {};
            const el = {
                tagName: tag.toUpperCase(),
                ownerDocument: doc,
                _id: "",
                get id() { return this._id; },
                set id(val) {
                    this._id = val;
                    if (val) elementsById.set(val, el);
                },
                _className: "",
                get className() { return this._className; },
                set className(val) {
                    this._className = val || "";
                    classes.clear();
                    if (this._className) {
                        this._className.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
                    }
                },
                style: {
                    _props: styles,
                    setProperty(k, v) { styles[k] = String(v); },
                    getPropertyValue(k) { return styles[k] || ""; },
                    removeProperty(k) { delete styles[k]; },
                    get display() { return styles.display || ""; },
                    set display(v) { styles.display = v; },
                    get visibility() { return styles.visibility || ""; },
                    set visibility(v) { styles.visibility = v; },
                    get top() { return styles.top || ""; },
                    set top(v) { styles.top = v; },
                    get left() { return styles.left || ""; },
                    set left(v) { styles.left = v; }
                },
                dataset: {},
                classList: {
                    add(c) { classes.add(c); el._className = Array.from(classes).join(" "); },
                    remove(c) { classes.delete(c); el._className = Array.from(classes).join(" "); },
                    contains(c) { return classes.has(c); }
                },
                offsetHeight: 190,
                offsetWidth: 280,
                getBoundingClientRect: () => ({ top: 100, bottom: 220, left: 50, right: 210, width: 160, height: 120 }),
                addEventListener() {},
                removeEventListener() {},
                appendChild(ch) {
                    ch.parentNode = el;
                    if (ch.id) elementsById.set(ch.id, ch);
                    return ch;
                },
                removeChild(ch) {
                    if (ch.parentNode === el) ch.parentNode = null;
                },
                querySelector() { return null; },
                querySelectorAll() { return []; },
                play() { return Promise.resolve(); },
                pause() {},
                load() {},
                getContext: () => ({ fillRect() {}, clearRect() {}, scale() {}, fillText() {} }),
                getAttribute() { return null; },
                removeAttribute() {}
            };
            return el;
        }
    };

    const body = doc.createElement("body");
    doc.body = body;
    doc.defaultView = {
        document: doc,
        innerHeight: 700,
        innerWidth: 900,
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        listeners: {},
        addEventListener(type, fn) {
            this.listeners[type] = this.listeners[type] || [];
            this.listeners[type].push(fn);
        },
        dispatchEvent(type, ev) {
            (this.listeners[type] || []).forEach(fn => fn(ev));
        }
    };
    return doc;
}

globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const mainDoc = createMockDocument("main");
globalThis.document = mainDoc;
globalThis.window.innerHeight = 1080;
globalThis.window.innerWidth = 1920;
globalThis.window.requestAnimationFrame = globalThis.requestAnimationFrame;
globalThis.window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

// Importar library.js
const { GalleryInteractionController, LibraryManager } = await import("../src/ui/js/library.js");

console.log("1. Validando criação de HUD no documento principal...");
const controller = new GalleryInteractionController();
const mainHud = controller.getShiftHud(mainDoc);
assert(mainHud, "HUD do documento principal deve ser criado");
assert.equal(mainHud.ownerDocument, mainDoc, "HUD deve pertencer a mainDoc");
assert.equal(mainDoc.getElementById("gallery-shift-hud"), mainHud, "mainDoc deve conter o elemento gallery-shift-hud");
console.log("  ✔ HUD do documento principal validado com sucesso.");

console.log("\n2. Validando Shift+Hover em mídia no documento principal...");
const mainItem = mainDoc.createElement("div");
mainItem._mediaData = { id: 1, title: "Video Principal", duration: 12.5, resolution: "1920x1080", fps: 30 };
mainItem._mediaKind = "video";
controller.showShiftHud(mainItem, { shiftKey: true });
assert.equal(controller.shiftHud, mainHud, "Controller deve usar mainHud para item no mainDoc");
assert.equal(mainHud.style.display, "block", "mainHud deve estar visível");
assert.equal(mainHud.style.visibility, "visible", "mainHud deve ter visibilidade normal");
console.log("  ✔ Exibição do HUD no documento principal validada.");

console.log("\n3. Validando Shift+Hover em mídia na janela destacada (Popout)...");
// Criar janela popout simulada
const popoutDoc = createMockDocument("popout");
const popoutWin = popoutDoc.defaultView;
globalThis.popoutWindows["sidebar-left"] = popoutWin;

const popoutItem = popoutDoc.createElement("div");
popoutItem._mediaData = { id: 2, title: "Video Destacado", duration: 45.0, resolution: "3840x2160", fps: 60 };
popoutItem._mediaKind = "video";
popoutItem.getBoundingClientRect = () => ({ top: 150, bottom: 270, left: 80, right: 280, width: 200, height: 120 });

// Simula hover com Shift no popout
controller.showShiftHud(popoutItem, { shiftKey: true });

// O HUD deve ser criado no popoutDoc.body
const popoutHud = popoutDoc.getElementById("gallery-shift-hud");
assert(popoutHud, "HUD deve ser criado no popoutDoc");
assert.equal(popoutHud.ownerDocument, popoutDoc, "HUD deve pertencer ao popoutDoc");
assert.equal(controller.shiftHud, popoutHud, "Controller deve apontar para o HUD do popout");
assert.equal(popoutHud.style.display, "block", "HUD do popout deve estar visível");
assert.equal(mainHud.style.display, "none", "CRÍTICO: HUD do documento principal DEVE SER OCULTADO quando popout estiver ativo!");

console.log("  ✔ HUD renderizado com sucesso no popout e suprimido no editor principal.");

console.log("\n4. Validando cálculo de coordenadas relativo à viewport da janela popout...");
// popoutWin tem innerHeight=700, innerWidth=900
// top = 270 + 6 = 276px. Se 276 + 190 (466) <= 690, cabe abaixo
assert.equal(popoutHud.style.top, "276px", "Top do HUD deve ser 276px abaixo do item no popout");
assert.equal(popoutHud.style.left, "80px", "Left do HUD deve ser 80px no popout");
console.log("  ✔ Coordenadas no popout validadas.");

console.log("\n5. Validando fechamento do HUD via keyup de Shift no popout...");
controller.attachToWindow(popoutWin);
// Simula soltar a tecla Shift no popout
popoutWin.dispatchEvent("keyup", { key: "Shift" });
assert.equal(popoutHud.style.display, "none", "HUD do popout deve ser ocultado ao soltar Shift");
assert.equal(mainHud.style.display, "none", "HUD do documento principal deve continuar oculto");
console.log("  ✔ Fechamento via keyup no popout validado.");

console.log("\n6. Validando fechamento por perda de foco (blur) no popout...");
controller.showShiftHud(popoutItem, { shiftKey: true });
assert.equal(popoutHud.style.display, "block", "HUD deve reabrir");
popoutWin.dispatchEvent("blur", {});
assert.equal(popoutHud.style.display, "none", "HUD deve fechar ao disparar blur no popout");
console.log("  ✔ Fechamento por blur validado.");

console.log("\n7. Validando hideShiftHud() global limpando todas as janelas...");
controller.showShiftHud(popoutItem, { shiftKey: true });
mainHud.style.display = "block"; // Força abertura espúria no main
controller.hideShiftHud();
assert.equal(popoutHud.style.display, "none", "popoutHud deve estar oculto após hideShiftHud()");
assert.equal(mainHud.style.display, "none", "mainHud deve estar oculto após hideShiftHud()");
console.log("  ✔ hideShiftHud() global validado.");

console.log("\n8. Validando integração do LibraryManager com janelas popout...");
const libManager = new LibraryManager();
libManager.onPopoutReady(popoutWin);
assert.equal(popoutWin._hasGalleryInteraction, true, "onPopoutReady deve anexar _galleryController ao popout");

// Abrir HUD e verificar se onPopoutRestored limpa o HUD
controller.showShiftHud(popoutItem, { shiftKey: true });
libManager.onPopoutRestored();
assert.equal(popoutHud.style.display, "none", "onPopoutRestored deve ocultar HUD do popout");
console.log("  ✔ Integração do LibraryManager com onPopoutReady e onPopoutRestored validada.");

console.log("\n=======================================================");
console.log("🎉 TODOS OS TESTES DO HUD SHIFT+HOVER NA BIBLIOTECA DESTACADA PASSARAM COM SUCESSO!");
console.log("=======================================================");
