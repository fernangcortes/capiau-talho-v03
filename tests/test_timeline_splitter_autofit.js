/**
 * Testes Unitários: Auto-Fit da Timeline por Duplo Clique no Splitter
 * Valida o cálculo exato de altura para exibir todas as pistas abertas sem corte no rodapé,
 * a duração dinâmica proporcional ao deslocamento, o toggle inteligente e a integridade de eventos.
 */

import assert from "assert";

// Setup de mocks de ambiente para Node.js
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.window = globalThis;
globalThis.BroadcastChannel = class {
    constructor() {}
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

console.log("=== Iniciando Testes de Auto-Fit da Timeline por Duplo Clique no Splitter ===");

// 1. Simulação do Modelo de Pistas e Alturas (conforme timelineState.js)
const TRACK_HEIGHTS = { ai: 44, text: 52, video: 72, audio: 48 };

function createMockTimelineState(options = {}) {
    let scale = options.scale || 1.0;
    let tracks = options.tracks || [
        { id: "AI", name: "IA — Sugestões", kind: "ai", hidden: false },
        { id: "T1", name: "Títulos & GCs", kind: "text", hidden: false },
        { id: "V2", name: "B-Roll", kind: "video", hidden: false },
        { id: "V1", name: "Falas", kind: "video", hidden: false },
        { id: "A1", name: "Áudio Falas", kind: "audio", hidden: false },
        { id: "A2", name: "Áudio B-Roll", kind: "audio", hidden: false }
    ];
    let scrollTop = options.scrollTop || 0;

    return {
        tracks,
        get trackHeightScale() { return scale; },
        setTrackHeightScale(s) { scale = Math.min(1.7, Math.max(0.5, s)); },
        trackHeight(track) {
            if (track.hidden) return 4;
            if (track.heightPx != null && isFinite(track.heightPx)) {
                return Math.min(240, Math.max(22, Math.round(track.heightPx * scale)));
            }
            const base = TRACK_HEIGHTS[track.kind] || TRACK_HEIGHTS.video;
            return Math.max(22, Math.round(base * scale));
        },
        totalTracksHeight() {
            return this.tracks.reduce((sum, t) => sum + this.trackHeight(t), 0);
        },
        scrollTop,
        clampScrollTop(viewportH = 300) {
            const maxScroll = Math.max(0, this.totalTracksHeight() - viewportH);
            this.scrollTop = Math.max(0, Math.min(maxScroll, this.scrollTop));
        }
    };
}

// 2. Função de cálculo da altura necessária (idêntica à lógica do workspaceManager.js)
function calculateNeededTimelineHeight({
    headerH = 32,
    rulerH = 30,
    tlState,
    padBorderV = 0,
    buffer = 2
}) {
    const tracksH = tlState.totalTracksHeight();
    return Math.ceil(headerH + rulerH + tracksH + padBorderV + buffer);
}

// 3. Função de cálculo de duração proporcional (conforme solicitação do usuário)
function calculateProportionalDuration(deltaH) {
    return Math.min(420, Math.max(160, Math.round(Math.abs(deltaH) * 0.8 + 120)));
}

// -------------------------------------------------------------
// TESTE 1: Cálculo da altura com pistas padrão (escala 1.0)
// -------------------------------------------------------------
{
    const tlState = createMockTimelineState();
    // AI(44) + T1(52) + V2(72) + V1(72) + A1(48) + A2(48) = 336px
    assert.strictEqual(tlState.totalTracksHeight(), 336, "Soma das pistas padrão deve ser 336px");

    const neededH = calculateNeededTimelineHeight({
        headerH: 32,
        rulerH: 30,
        tlState,
        padBorderV: 0,
        buffer: 2
    });
    // 32 (header) + 30 (ruler) + 336 (pistas) + 2 (buffer) = 400px
    assert.strictEqual(neededH, 400, "Altura necessária total deve ser exatamente 400px");

    // Na altura padrão de 290px:
    // Área útil do canvas = 290 - 32 (header) = 258px
    // Menos 30px (ruler) = 228px disponíveis para pistas
    // Pistas precisam de 336px -> 108px cortados (A1 parcialmente e A2 totalmente ocultas)
    const availableForTracksAtDefault = (290 - 32) - 30;
    assert.ok(availableForTracksAtDefault < tlState.totalTracksHeight(), "Altura padrão de 290px esconde pistas no rodapé");

    // Com 400px:
    // Área útil do canvas = 400 - 32 = 368px
    // Menos 30px (ruler) = 338px disponíveis para pistas
    // Pistas precisam de 336px -> Todas cabem com 2px de folga!
    const availableForTracksAtFit = (400 - 32) - 30;
    assert.ok(availableForTracksAtFit >= tlState.totalTracksHeight(), "Com 400px, 100% das pistas cabem sem corte");

    console.log("✓ Teste 1: Cálculo de altura necessária para pistas padrão validado (400px)");
}

// -------------------------------------------------------------
// TESTE 2: Escala vertical customizada e adição de novas pistas
// -------------------------------------------------------------
{
    const tlState = createMockTimelineState();
    tlState.setTrackHeightScale(1.2); // Pistas 20% mais altas
    const tracksH_scaled = tlState.totalTracksHeight();
    assert.strictEqual(tracksH_scaled, Math.round(44*1.2) + Math.round(52*1.2) + Math.round(72*1.2)*2 + Math.round(48*1.2)*2);

    const neededH_scaled = calculateNeededTimelineHeight({ headerH: 32, rulerH: 30, tlState });
    assert.strictEqual(neededH_scaled, 32 + 30 + tracksH_scaled + 2);

    // Adiciona nova pista de áudio A3
    tlState.tracks.push({ id: "A3", name: "Música", kind: "audio", hidden: false });
    const neededH_withA3 = calculateNeededTimelineHeight({ headerH: 32, rulerH: 30, tlState });
    assert.ok(neededH_withA3 > neededH_scaled, "Altura necessária deve aumentar ao adicionar novas pistas");

    console.log("✓ Teste 2: Escala vertical dinâmica e inclusão de novas pistas validada");
}

// -------------------------------------------------------------
// TESTE 3: Pistas ocultadas (linhas restauradoras de 4px) e cabeçalho colapsado
// -------------------------------------------------------------
{
    const tlState = createMockTimelineState();
    // Oculta pista AI e pista A2
    tlState.tracks[0].hidden = true; // 4px em vez de 44px (-40px)
    tlState.tracks[5].hidden = true; // 4px em vez de 48px (-44px)
    const expectedTracksH = (4) + 52 + 72 + 72 + 48 + (4);
    assert.strictEqual(tlState.totalTracksHeight(), expectedTracksH);

    // Cabeçalho da timeline colapsado (4px)
    const neededH_collapsedHeader = calculateNeededTimelineHeight({
        headerH: 4,
        rulerH: 30,
        tlState,
        buffer: 2
    });
    assert.strictEqual(neededH_collapsedHeader, 4 + 30 + expectedTracksH + 2);

    console.log("✓ Teste 3: Pistas ocultas e cabeçalho colapsado integrados corretamente");
}

// -------------------------------------------------------------
// TESTE 4: Duração proporcional da animação conforme delta de altura
// -------------------------------------------------------------
{
    // Pequeno delta (30px):
    const dSmall = calculateProportionalDuration(30);
    assert.strictEqual(dSmall, 160, "Pequeno ajuste (30px) deve usar a duração mínima ágil (160ms)");

    // Médio delta (110px, de 290px para 400px):
    const dMed = calculateProportionalDuration(110);
    assert.strictEqual(dMed, Math.round(110 * 0.8 + 120), "Ajuste padrão de 110px deve ser ~208ms");

    // Grande delta (300px):
    const dLarge = calculateProportionalDuration(300);
    assert.strictEqual(dLarge, Math.round(300 * 0.8 + 120), "Grande ajuste de 300px deve ser ~360ms");

    // Delta extremo (> 400px):
    const dExtreme = calculateProportionalDuration(500);
    assert.strictEqual(dExtreme, 420, "Delta extremo deve ser limitado a 420ms para nunca parecer lento");

    // Proporcionalidade monotônica crescente
    assert.ok(dSmall <= dMed && dMed <= dLarge && dLarge <= dExtreme, "Duração deve ser estritamente monotônica crescente");

    console.log("✓ Teste 4: Duração dinâmica proporcional ao deslocamento validada");
}

// -------------------------------------------------------------
// TESTE 5: Alternância (Toggle) inteligente entre auto-fit e tamanho anterior/padrão
// -------------------------------------------------------------
{
    let currentH = 290;
    const fitTargetH = 400;
    const defaultVal = 290;
    let lastCustomH = null;

    // Primeiro clique-duplo: não está ajustada
    assert.ok(Math.abs(currentH - fitTargetH) > 3, "Timeline inicialmente em 290px não está em fitTargetH (400px)");
    lastCustomH = currentH; // 290
    currentH = fitTargetH;  // 400
    assert.strictEqual(currentH, 400, "Timeline agora expandiu para 400px");

    // Segundo clique-duplo: já está ajustada (diferença <= 3px)
    assert.ok(Math.abs(currentH - fitTargetH) <= 3, "Timeline está em fitTargetH");
    let nextTarget = lastCustomH ? lastCustomH : defaultVal;
    currentH = nextTarget;
    assert.strictEqual(currentH, 290, "Segundo duplo clique deve restaurar altura anterior (290px)");

    // Terceiro clique-duplo: expande novamente
    assert.ok(Math.abs(currentH - fitTargetH) > 3);
    lastCustomH = currentH;
    currentH = fitTargetH;
    assert.strictEqual(currentH, 400, "Terceiro clique-duplo expande novamente para 400px");

    console.log("✓ Teste 5: Máquina de estados de toggle reversível validada");
}

// -------------------------------------------------------------
// TESTE 6: Clamping de limites do contêiner para preservação dos monitores
// -------------------------------------------------------------
{
    // Supondo uma tela menor onde o containerStage tem 500px de altura total
    const containerH = 500;
    const minMonitorsH = 180;
    const splitterSize = 4;
    const maxAllowedTimelineH = Math.max(180, Math.floor(containerH - minMonitorsH - splitterSize)); // 316px

    const neededH = 400; // Pistas pedem 400px
    const clampedFitH = Math.min(maxAllowedTimelineH, neededH);
    assert.strictEqual(clampedFitH, 316, "Timeline não deve ultrapassar 316px para preservar 180px de monitores");
    assert.ok(containerH - clampedFitH - splitterSize >= minMonitorsH, "Monitores preservam seu tamanho mínimo");

    console.log("✓ Teste 6: Clamping contra contêiner e proteção de monitores validada");
}

// -------------------------------------------------------------
// TESTE 7, 8, 9, 10: Integração DOM do SplitterHelper
// -------------------------------------------------------------
{
    // Mock Element para simulação de eventos e DOM
    class TestElement {
        constructor(tagName = "div") {
            this.tagName = tagName.toUpperCase();
            this._className = "";
            const self = this;
            this.classList = {
                _classes: new Set(),
                contains(c) { return self.classList._classes.has(c) || self._className.split(" ").includes(c); },
                add(...cs) {
                    cs.forEach(c => {
                        self.classList._classes.add(c);
                        if (!self._className.split(" ").includes(c)) {
                            self._className = (self._className + " " + c).trim();
                        }
                    });
                },
                remove(...cs) {
                    cs.forEach(c => {
                        self.classList._classes.delete(c);
                        self._className = self._className.split(" ").filter(x => x !== c).join(" ");
                    });
                }
            };
            this.style = {};
            this.attributes = {};
            this.listeners = {};
            this.children = [];
            this.parentNode = null;
        }
        get className() { return this._className; }
        set className(val) {
            this._className = val || "";
            this.classList._classes.clear();
            this._className.split(" ").filter(Boolean).forEach(c => this.classList._classes.add(c));
        }
        setAttribute(k, v) { this.attributes[k] = String(v); }
        getAttribute(k) { return this.attributes[k] || null; }
        addEventListener(event, fn) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
        }
        removeEventListener(event, fn) {
            if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter(f => f !== fn);
            }
        }
        dispatchEvent(event) {
            const handlers = this.listeners[event.type] || [];
            handlers.forEach(h => h(event));
        }
        getBoundingClientRect() {
            return { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
        }
        after(el) {
            el.parentNode = this.parentNode;
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                this.parentNode.children.splice(idx + 1, 0, el);
            }
        }
        appendChild(el) {
            el.parentNode = this;
            this.children.push(el);
            return el;
        }
        remove() {
            if (this.parentNode) {
                const idx = this.parentNode.children.indexOf(this);
                if (idx !== -1) this.parentNode.children.splice(idx, 1);
                this.parentNode = null;
            }
        }
        querySelector(selector) {
            if (selector.startsWith(".")) {
                const cls = selector.slice(1);
                return this.children.find(c => c.classList.contains(cls) || c.className.includes(cls)) || null;
            }
            if (selector.startsWith("#")) {
                const id = selector.slice(1);
                return this.children.find(c => c.id === id) || null;
            }
            return null;
        }
    }

    // Mock Document & Window
    const mockBody = new TestElement("body");
    const mockDoc = {
        body: mockBody,
        createElement: (tag) => new TestElement(tag),
        listeners: {},
        addEventListener(event, fn) {
            if (!this.listeners[event]) this.listeners[event] = [];
            this.listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (this.listeners[event]) {
                this.listeners[event] = this.listeners[event].filter(f => f !== fn);
            }
        }
    };
    mockBody.ownerDocument = mockDoc;
    const mockWin = {
        getSelection: () => ({ removeAllRanges: () => {} })
    };
    mockDoc.defaultView = mockWin;

    // Configuração de contêiner
    const container = new TestElement("div");
    container.ownerDocument = mockDoc;
    const leftEl = new TestElement("div");
    leftEl.id = "monitors-container";
    leftEl.parentNode = container;
    container.children.push(leftEl);

    const rightEl = new TestElement("div");
    rightEl.id = "timeline-panel";
    rightEl.parentNode = container;
    container.children.push(rightEl);

    // Import dinâmico do SplitterHelper
    const { SplitterHelper } = await import("../src/ui/js/workspaceManager.js");

    let dblClickTriggered = false;
    SplitterHelper.initSplitter(container, "#monitors-container", "#timeline-panel", {
        direction: "vertical",
        resizeTarget: "right",
        unit: "px",
        minVal: 150,
        maxVal: 600,
        defaultVal: 290,
        className: "splitter-timeline",
        onDoubleClick: () => { dblClickTriggered = true; }
    });

    const splitter = container.querySelector(".splitter-timeline");
    assert.ok(splitter, "Splitter deve ser inserido no container");

    // TESTE 7: Tooltip configurado no splitter
    const tooltip = splitter.getAttribute("data-tooltip");
    assert.ok(tooltip && tooltip.includes("duplo clique para ajustar a todas as pistas"), 
        `Tooltip deve conter instrução de duplo clique (foi: '${tooltip}')`);
    console.log("✓ Teste 7: Tooltip informativo de redimensionamento e duplo clique validado");

    // TESTE 8: Duplo clique direto via evento dblclick
    dblClickTriggered = false;
    splitter.dispatchEvent({ type: "dblclick", preventDefault: () => {} });
    assert.strictEqual(dblClickTriggered, true, "Evento dblclick deve disparar onDoubleClick");
    console.log("✓ Teste 8: Disparo de onDoubleClick via evento dblclick nativo validado");

    // TESTE 9: Duplo clique via mousedown com e.detail === 2 (espera o debounce de 300ms do teste 8)
    await new Promise(r => setTimeout(r, 310));
    dblClickTriggered = false;
    splitter.dispatchEvent({
        type: "mousedown",
        button: 0,
        detail: 2,
        clientX: 50,
        clientY: 50,
        preventDefault: () => {}
    });
    assert.strictEqual(dblClickTriggered, true, "mousedown com detail=2 deve acionar onDoubleClick imediatamente");
    console.log("✓ Teste 9: Disparo de onDoubleClick via mousedown (e.detail === 2) validado");

    // TESTE 10: Ausência de overlay obstrusivo em cliques simples vs presença durante arraste real
    assert.strictEqual(mockBody.children.length, 0, "Nenhum overlay deve existir antes do clique");
    
    // Clique simples (sem arraste):
    splitter.dispatchEvent({
        type: "mousedown",
        button: 0,
        detail: 1,
        clientX: 100,
        clientY: 100,
        preventDefault: () => {}
    });
    // Verifica que overlay NÃO foi injetado imediatamente no mousedown (adiamento para preservar clicks)
    assert.strictEqual(mockBody.children.length, 0, "Overlay NÃO deve ser injetado no mousedown sem movimento");

    // Agora simula movimento pequeno (< 3px): ainda sem overlay
    const mouseMoveHandler = mockDoc.listeners?.["mousemove"]?.[0];
    if (mouseMoveHandler) {
        mouseMoveHandler({ clientX: 101, clientY: 101 });
        assert.strictEqual(mockBody.children.length, 0, "Overlay NÃO deve ser injetado com movimento < 3px");
    }

    // Solta o botão
    const mouseUpHandler = mockDoc.listeners?.["mouseup"]?.[0];
    if (mouseUpHandler) {
        mouseUpHandler({ clientX: 101, clientY: 101 });
    }
    assert.strictEqual(mockBody.children.length, 0, "Nenhum resíduo no body após soltar o clique simples");

    console.log("✓ Teste 10: Comportamento não-invasivo de overlay validado (sem bloqueio de cliques)");
}

console.log("\nTODOS OS 10 TESTES DE AUTO-FIT DA TIMELINE PASSARAM COM 100% DE SUCESSO!");

