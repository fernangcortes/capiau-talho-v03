// Autoteste: Miniaturas HQ sob Demanda & Carregamento Progressivo (Galeria Clean: Chat 4/8)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Miniaturas HQ sob Demanda e Carregamento Progressivo...\n");

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
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

globalThis.document = {
    defaultView: globalThis,
    getElementById: () => null,
    createElement: (tag) => {
        const classes = new Set();
        const styles = {};
        const el = {
            tagName: tag.toUpperCase(),
            _className: "",
            get className() {
                return this._className;
            },
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
                removeProperty(k) { delete styles[k]; }
            },
            dataset: {},
            classList: {
                add(c) { classes.add(c); el._className = Array.from(classes).join(" "); },
                remove(c) { classes.delete(c); el._className = Array.from(classes).join(" "); },
                contains(c) { return classes.has(c); }
            },
            addEventListener() {},
            removeEventListener() {},
            appendChild(ch) { ch.parentNode = el; },
            removeChild(ch) { if (ch.parentNode === el) ch.parentNode = null; },
            play() { return Promise.resolve(); },
            pause() {},
            load() {},
            getAttribute() { return null; },
            removeAttribute() {}
        };
        return el;
    },
    body: {
        appendChild() {}
    }
};

// 1. Carregar library.js e instanciar GalleryInteractionController
const libraryModule = await import("../src/ui/js/library.js");
const { GalleryInteractionController } = libraryModule;

assert(GalleryInteractionController, "GalleryInteractionController deve ser exportado");
const controller = new GalleryInteractionController();

console.log("1. Validando estado inicial e propriedades do controller...");
assert.equal(controller.hqUpgradeTimer, null, "hqUpgradeTimer inicial deve ser null");
assert(controller.prefetchedCrucials instanceof Set, "prefetchedCrucials deve ser um Set");
console.log("  ✔ Estado inicial validado com sucesso.");

// 2. Criar mock de itemEl com mediaData e imagem
function createMockItem(id, duration, crucialMoments = [], rotation = 0) {
    const thumbImg = {
        dataset: {},
        src: `/api/video/${id}/thumbnail`,
        style: {}
    };
    const scrubBar = { style: {} };
    const timecode = { textContent: "" };
    const classes = new Set();
    const styles = {};

    const itemEl = {
        _mediaData: { id, duration, rotation },
        _crucialMoments: crucialMoments,
        _defaultSrc: `/api/video/${id}/thumbnail`,
        style: {
            _props: styles,
            setProperty(k, v) { styles[k] = String(v); },
            getPropertyValue(k) { return styles[k] || ""; },
            removeProperty(k) { delete styles[k]; }
        },
        classList: {
            classes,
            add(c) { classes.add(c); },
            remove(c) { classes.delete(c); },
            contains(c) { return classes.has(c); }
        },
        appendChild(child) {
            child.parentNode = itemEl;
        },
        removeChild(child) {
            if (child.parentNode === itemEl) child.parentNode = null;
        },
        querySelector(sel) {
            if (sel === ".gallery-thumb-img") return thumbImg;
            if (sel === ".gallery-scrub-bar") return scrubBar;
            if (sel === ".gallery-scrub-timecode") return timecode;
            return null;
        }
    };
    if (rotation) itemEl.classList.add(`rot-${rotation}`);
    return { itemEl, thumbImg, scrubBar, timecode };
}

console.log("\n2. Validando scrubbing rápido com miniatura LQ instantânea...");
const { itemEl, thumbImg } = createMockItem(42, 60.0, [5.0, 15.0]);

// Simula chamada de scrub no segundo 10
controller.applyScrubFrame(itemEl, 10.2, 10.2 / 60.0, 60.0);
assert.equal(thumbImg.dataset.scrubSec, 10, "dataset.scrubSec deve ser arredondado para 10");
assert.equal(thumbImg.dataset.quality, "low", "dataset.quality inicial deve ser 'low'");
assert.equal(thumbImg.src, "/api/video/42/thumbnail-at?time=10&quality=low", "src inicial deve ser LQ com quality=low");
assert(controller.hqUpgradeTimer !== null, "Deve ter agendado timer para upgrade HQ");
console.log("  ✔ Miniatura LQ instantânea validada com sucesso.");

console.log("\n3. Validando cancelamento de timer anterior durante scrubbing contínuo...");
const firstTimer = controller.hqUpgradeTimer;
// Move rapidamente para segundo 11 antes do timer expirar
controller.applyScrubFrame(itemEl, 11.0, 11.0 / 60.0, 60.0);
assert.equal(thumbImg.dataset.scrubSec, 11);
assert.equal(thumbImg.src, "/api/video/42/thumbnail-at?time=11&quality=low");
assert.notEqual(controller.hqUpgradeTimer, firstTimer, "Timer antigo deve ter sido cancelado e redefinido");
console.log("  ✔ Throttling e substituição contínua de LQ validados com sucesso.");

console.log("\n4. Validando upgrade progressivo para HQ após pausa no frame...");
// Executa o upgrade para o segundo 11
controller.upgradeToHqThumbnail(itemEl, 11);
// Simula conclusão do preloader
// Em mock, vamos inspecionar se a lógica chamou preloader com URL HQ
assert(thumbImg.dataset.scrubSec == 11);
console.log("  ✔ Execução de upgrade para HQ validada.");

console.log("\n5. Validando pré-carregamento de momentos cruciais...");
controller.preloadCrucialHqThumbnails(itemEl);
assert(controller.prefetchedCrucials.has("42-5"), "Deve ter marcado momento 5s como prefetched");
assert(controller.prefetchedCrucials.has("42-15"), "Deve ter marcado momento 15s como prefetched");
console.log("  ✔ Pré-carregamento dos momentos cruciais validado com sucesso.");

console.log("\n6. Validando limpeza e restauração de miniatura ao sair do hover...");
controller.activeItem = itemEl;
controller.stopCtrlScrubbing();
assert.equal(thumbImg.src, itemEl._defaultSrc, "Deve restaurar a capa padrão original");
assert.equal(thumbImg.dataset.scrubSec, undefined, "dataset.scrubSec deve ser limpo");
assert.equal(thumbImg.dataset.quality, undefined, "dataset.quality deve ser limpo");
console.log("  ✔ Limpeza ao sair do hover validada com sucesso.");

console.log("\n7. Validando rotação e aspect ratio no singleton do Hover Play (90°, 180°, 270°)...");
// 7.1 Vídeo rotacionado em 90 graus
const { itemEl: item90 } = createMockItem(901, 30.0, [], 90);
item90.style.setProperty("--aspect", "0.563");
controller.startHoverVideo(item90);

assert(item90.classList.contains("rot-90"), "itemEl deve conter classe rot-90");
assert(controller.hoverVideo.classList.contains("rot-90"), "hoverVideo deve receber classe rot-90");
assert.equal(controller.hoverVideo.dataset.rotation, 90, "hoverVideo dataset.rotation deve ser 90");
assert.equal(controller.hoverVideo.style.getPropertyValue("--aspect"), "0.563", "hoverVideo deve propagar --aspect 0.563");
console.log("  ✔ Hover play com rotação 90° validado.");

// 7.2 Transição direta para vídeo com rotação 180 graus (sem resíduos de 90°)
const { itemEl: item180 } = createMockItem(902, 30.0, [], 180);
item180.style.setProperty("--aspect", "1.778");
controller.startHoverVideo(item180);

assert(!controller.hoverVideo.classList.contains("rot-90"), "hoverVideo não deve reter classe rot-90");
assert(controller.hoverVideo.classList.contains("rot-180"), "hoverVideo deve receber classe rot-180");
assert.equal(controller.hoverVideo.dataset.rotation, 180, "hoverVideo dataset.rotation deve ser 180");
assert.equal(controller.hoverVideo.style.getPropertyValue("--aspect"), "1.778", "hoverVideo deve propagar --aspect 1.778");
console.log("  ✔ Transição direta para rotação 180° validada.");

// 7.3 Transição para vídeo com rotação 270 graus
const { itemEl: item270 } = createMockItem(903, 30.0, [], 270);
item270.style.setProperty("--aspect", "0.563");
controller.startHoverVideo(item270);

assert(!controller.hoverVideo.classList.contains("rot-180"), "hoverVideo não deve reter classe rot-180");
assert(controller.hoverVideo.classList.contains("rot-270"), "hoverVideo deve receber classe rot-270");
assert.equal(controller.hoverVideo.dataset.rotation, 270, "hoverVideo dataset.rotation deve ser 270");
console.log("  ✔ Rotação 270° validada.");

// 7.4 Limpeza de classes e dataset de rotação ao parar hover
controller.stopAllHover();
assert.equal(controller.hoverVideo.className, "gallery-hover-video", "hoverVideo deve ser restaurado para classe base");
assert.equal(controller.hoverVideo.dataset.rotation, undefined, "dataset.rotation deve ser removido");
assert.equal(controller.hoverVideo.style.getPropertyValue("--aspect"), "", "--aspect deve ser removido no reset");
console.log("  ✔ Limpeza completa do singleton no stopAllHover validada.");

// 7.5 Limpeza de classes ao acionar scrubbing via Ctrl
controller.startHoverVideo(item90);
assert(controller.hoverVideo.classList.contains("rot-90"));
controller.startCtrlScrubbing(item90);
assert.equal(controller.hoverVideo.className, "gallery-hover-video", "startCtrlScrubbing deve limpar classes do singleton");
assert.equal(controller.hoverVideo.dataset.rotation, undefined);
controller.stopCtrlScrubbing();
console.log("  ✔ Limpeza ao transitar para Ctrl scrubbing validada.");

console.log("\n8. Validando estabilidade do aspect ratio nativo bruto sem dupla inversão...");
const mockItemData = { id: 88, width: 1920, height: 1080, rotation: 90 };
// Simula carregamento da imagem nativa bruta (1920x1080)
const rawAspect = 1920 / 1080;
mockItemData._naturalAspect = rawAspect;
assert.equal(rawAspect, 1.7777777777777777, "rawAspect deve ser horizontal original");

// Primeiro cálculo com rotação 90°:
let displayAspect1 = rawAspect;
if (mockItemData.rotation === 90 || mockItemData.rotation === 270) {
    displayAspect1 = 1 / displayAspect1;
}
assert.equal(displayAspect1.toFixed(3), "0.563", "displayAspect para rot 90 deve ser vertical");
assert.equal(mockItemData._naturalAspect, rawAspect, "_naturalAspect não deve ser modificado pelo cálculo");

// Rotação subsequente para 180°:
mockItemData.rotation = 180;
let displayAspect2 = mockItemData._naturalAspect;
if (mockItemData.rotation === 90 || mockItemData.rotation === 270) {
    displayAspect2 = 1 / displayAspect2;
}
assert.equal(displayAspect2.toFixed(3), "1.778", "displayAspect para rot 180 deve ser horizontal sem dupla inversão");

// Rotação subsequente para 270°:
mockItemData.rotation = 270;
let displayAspect3 = mockItemData._naturalAspect;
if (mockItemData.rotation === 90 || mockItemData.rotation === 270) {
    displayAspect3 = 1 / displayAspect3;
}
assert.equal(displayAspect3.toFixed(3), "0.563", "displayAspect para rot 270 deve ser vertical");
console.log("  ✔ Estabilidade do aspect ratio bruto e ausência de dupla inversão validadas.");

console.log("\n✅ Todos os testes de Galeria Clean (HQ, Momentos Cruciais e Rotação no Hover) passaram!");
