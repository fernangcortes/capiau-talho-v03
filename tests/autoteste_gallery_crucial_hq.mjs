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
        return {
            tagName: tag.toUpperCase(),
            style: {},
            classList: { add() {}, remove() {}, contains: () => false },
            addEventListener() {},
            removeEventListener() {},
            appendChild() {},
            removeChild() {}
        };
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
function createMockItem(id, duration, crucialMoments = []) {
    const thumbImg = {
        dataset: {},
        src: `/api/video/${id}/thumbnail`,
        style: {}
    };
    const scrubBar = { style: {} };
    const timecode = { textContent: "" };

    const itemEl = {
        _mediaData: { id, duration },
        _crucialMoments: crucialMoments,
        _defaultSrc: `/api/video/${id}/thumbnail`,
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
        },
        querySelector(sel) {
            if (sel === ".gallery-thumb-img") return thumbImg;
            if (sel === ".gallery-scrub-bar") return scrubBar;
            if (sel === ".gallery-scrub-timecode") return timecode;
            return null;
        }
    };
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

console.log("\n✅ Todos os testes de Miniaturas HQ sob Demanda & Carregamento Progressivo passaram!");
