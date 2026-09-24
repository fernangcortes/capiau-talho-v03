// tests/autoteste_tool_rate_stretch.mjs
// Task 14 do PLANO_SUITE_NLE_CLASSICO — Ferramenta Esticar / Comprimir Taxa (Rate Stretch Tool):
//  • Botão #btn-tool-rate-stretch com SVG inline de alta definição na Tool Strip.
//  • Catálogo central COMMANDS_CATALOG com tools.rate_stretch e paridade nos 5 presets da indústria.
//  • Cursores SVG de alta definição direcionais (CURSOR_RATE_STRETCH_RIGHT e CURSOR_RATE_STRETCH_LEFT).
//  • Tooltip flutuante #timeline-rate-stretch-tooltip exibindo taxa % e duração timecode.
//  • Esticamento (câmera lenta) e compressão (aceleração) pelas bordas direita e esquerda.
//  • Sincronia de pares vinculados A/V (link_id) com pitch_correction e modo desvinculado com tecla Alt.
//  • Proteção contra pistas travadas (cadeado).
//  • Snapping magnético em bordas adjacentes e na agulha.
//  • Clamping de velocidade de 10% (0.1x) a 1000% (10.0x).
//  • Clamping de colisão contra lacunas (gaps) na mesma pista.
//  • Histórico atômico de Undo (Ctrl+Z) e Redo (Ctrl+Y).
//  • Cancelamento por tecla Escape e alternância de ferramenta com V.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Polyfills de ambiente de navegador para execução em Node.js ESM ──
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

const domRegistry = {};
function makeEl(id) {
    return {
        id: id || "",
        style: {},
        innerHTML: "",
        textContent: "",
        dataset: {},
        value: "",
        checked: false,
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            toggle(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); },
            contains(c) { return this._classes.has(c); }
        },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] || null; },
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        focus() {},
        select() {},
        blur() {}
    };
}

const canvasStub = {
    getContext: () => ({
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
        fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 50 }), fillText() {}, scale() {},
        clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
    }),
    ownerDocument: null,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {}
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") return canvasStub;
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(tag),
    querySelector: (sel) => {
        if (sel.startsWith("#")) {
            const id = sel.slice(1);
            return globalThis.document.getElementById(id);
        }
        return null;
    },
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } },
    addEventListener: () => {},
    removeEventListener: () => {}
};
canvasStub.ownerDocument = globalThis.document;

const toasts = [];
globalThis.showToast = (msg, type) => toasts.push([msg, type]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raiz = path.resolve(__dirname, "..");

const readSrc = (f) => fs.readFileSync(path.join(raiz, "src", "ui", "js", f), "utf-8");

const indexHtml = fs.readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf-8");
const stylesCss = fs.readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf-8");

// Importações dos módulos da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction, CURSOR_RATE_STRETCH_RIGHT, CURSOR_RATE_STRETCH_LEFT } = await import("../src/ui/js/timelineInteraction.js");

function makeDummyRenderer() {
    return {
        canvas: canvasStub,
        rulerHeight: 30,
        requestRedraw: () => {},
        getTrackAtY: (y) => {
            if (y >= 80) return { id: "A1", name: "Áudio 1", kind: "audio" };
            return { id: "V1", name: "Vídeo 1", kind: "video" };
        },
        getLane: (id) => ({
            top: (id && id.startsWith("A")) ? 80 : 30,
            height: (id && id.startsWith("A")) ? 40 : 50,
            track: { id: id || "V1", kind: (id && id.startsWith("A")) ? "audio" : "video" }
        }),
        getTrackLanes: () => [
            { top: 30, height: 50, track: { id: "V1", kind: "video" } },
            { top: 80, height: 40, track: { id: "A1", kind: "audio" } }
        ]
    };
}

function makeMouseEvent(opts = {}) {
    return {
        button: 0,
        buttons: 1,
        clientX: 0,
        clientY: 50,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...opts
    };
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 14: FERRAMENTA ESTICAR / COMPRIMIR TAXA");
console.log("===============================================================================\n");

let passedCount = 0;
let totalCount = 0;

function runBattery(title, fn) {
    totalCount++;
    console.log(`▶ [Bateria ${totalCount}] ${title}`);
    try {
        fn();
        passedCount++;
        console.log(`  ✓ ${title} validada com sucesso\n`);
    } catch (err) {
        console.error(`  ✗ FALHA na Bateria ${totalCount}: ${err.message}\n`, err);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Estrutura do DOM, SVG Inline e Estilos CSS (index.html & styles.css)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Botão #btn-tool-rate-stretch com SVG Inline, data-tooltip e estilos CSS", () => {
    const btnMatch = indexHtml.match(/<button[^>]*id=["']btn-tool-rate-stretch["'][^>]*>[\s\S]*?<\/button>/);
    assert.ok(btnMatch, "Botão #btn-tool-rate-stretch deve existir no index.html");
    const btnHTML = btnMatch[0];
    assert.ok(btnHTML.includes("data-tooltip"), "#btn-tool-rate-stretch deve conter data-tooltip explicativo");
    assert.ok(btnHTML.includes("Rate Stretch") || btnHTML.includes("Esticar / Comprimir"), "#btn-tool-rate-stretch deve mencionar Rate Stretch ou Esticar");
    assert.ok(btnHTML.includes("<svg"), "#btn-tool-rate-stretch deve conter SVG inline para fidelidade vetorial NLE");
    assert.ok(btnHTML.includes("<circle"), "SVG de #btn-tool-rate-stretch deve conter mostrador de relógio para indicar velocidade");

    assert.ok(/styles\.css\?v=(?:6[4-9]|[7-9]\d)/.test(indexHtml), "Cache-buster de styles.css deve estar em ?v>=64");
    assert.ok(/main\.js\?v=(?:6[4-9]|[7-9]\d)/.test(indexHtml), "Cache-buster de main.js deve estar em ?v>=64");

    assert.ok(stylesCss.includes("#btn-tool-rate-stretch:hover"), "styles.css deve conter hover para #btn-tool-rate-stretch");
    assert.ok(stylesCss.includes("#timeline-rate-stretch-tooltip"), "styles.css deve conter estilização para #timeline-rate-stretch-tooltip");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Catálogo Central & Paridade Multi-Preset nos 5 Perfis NLE (Diretriz 5)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Comando tools.rate_stretch no Catálogo Central e Mapeamento nos 5 Perfis", () => {
    const cmd = COMMANDS_CATALOG.find(c => c.id === "tools.rate_stretch");
    assert.ok(cmd, "Comando 'tools.rate_stretch' deve estar no COMMANDS_CATALOG");
    assert.equal(cmd.category, "tools", "tools.rate_stretch deve pertencer à categoria 'tools'");
    assert.ok(cmd.label && cmd.label.includes("Rate Stretch"), "Label deve mencionar Rate Stretch");
    assert.ok(cmd.description, "tools.rate_stretch deve possuir descrição didática");

    // Validação nos 5 perfis NLE
    const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    for (const p of presetsEsperados) {
        const preset = KEYMAP_PRESETS[p];
        assert.ok(preset, `Preset '${p}' deve existir`);
        const keys = preset["tools.rate_stretch"];
        assert.ok(Array.isArray(keys) && keys.length > 0, `Preset '${p}' deve mapear 'tools.rate_stretch'`);

        if (p === "capiau") {
            assert.ok(keys.includes("Shift+KeyR") || keys.includes("KeyX"), "CapIAu deve mapear Shift+KeyR / KeyX para preservar KeyR (ripple delete)");
        } else if (p === "premiere" || p === "finalcut") {
            assert.ok(keys.includes("KeyR"), `${p} deve usar tecla R clássica para Rate Stretch`);
        } else if (p === "resolve") {
            assert.ok(keys.includes("KeyR") || keys.includes("Shift+KeyR"), "Resolve deve mapear KeyR / Shift+KeyR");
        } else if (p === "kdenlive") {
            assert.ok(keys.includes("Shift+KeyR"), "Kdenlive deve mapear Shift+KeyR");
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Cursores SVG de Alta Definição e Helper Methods
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Constantes de Cursores SVG e método getRateStretchCursor", () => {
    assert.ok(CURSOR_RATE_STRETCH_RIGHT.startsWith("url('data:image/svg+xml"), "CURSOR_RATE_STRETCH_RIGHT deve ser SVG data URI");
    assert.ok(CURSOR_RATE_STRETCH_RIGHT.includes("ew-resize"), "CURSOR_RATE_STRETCH_RIGHT deve conter fallback ew-resize");
    assert.ok(CURSOR_RATE_STRETCH_LEFT.startsWith("url('data:image/svg+xml"), "CURSOR_RATE_STRETCH_LEFT deve ser SVG data URI");
    assert.ok(CURSOR_RATE_STRETCH_LEFT.includes("ew-resize"), "CURSOR_RATE_STRETCH_LEFT deve conter fallback ew-resize");

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);

    const rightCursor = interaction.getRateStretchCursor("right");
    assert.equal(rightCursor, CURSOR_RATE_STRETCH_RIGHT, "getRateStretchCursor('right') deve retornar CURSOR_RATE_STRETCH_RIGHT");

    const leftCursor = interaction.getRateStretchCursor("left");
    assert.equal(leftCursor, CURSOR_RATE_STRETCH_LEFT, "getRateStretchCursor('left') deve retornar CURSOR_RATE_STRETCH_LEFT");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Esticamento pela Borda Direita (Câmera Lenta / Desaceleração)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Esticamento pela borda direita: duplicar duração reduz velocidade para 50%", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_v1",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100, // duração original: 100 frames
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    // Simula mousedown na metade direita do clipe (frame 80)
    interaction.onMouseDown(makeMouseEvent({
        clientX: 80,
        clientY: 50
    }));

    assert.equal(interaction.dragState, "rate-stretch-right", "dragState deve ser 'rate-stretch-right'");
    assert.equal(interaction.draggedClipId, "clip_v1", "Clipe clicado deve ser 'clip_v1'");

    // Simula arrasto para a direita (+100 frames) -> duração 200f
    interaction.onMouseMove(makeMouseEvent({
        clientX: 180, // delta = +100
        clientY: 50
    }));

    assert.ok(interaction.currentDragRateStretch, "currentDragRateStretch deve estar populado");
    assert.equal(interaction.currentDragRateStretch.durationFrames, 200, "Nova duração deve ser 200 frames");
    assert.equal(interaction.currentDragRateStretch.speed, 0.5, "Nova velocidade deve ser 0.5 (50%)");

    // Simula mouseup (commit)
    interaction.onMouseUp(makeMouseEvent({ clientX: 180, clientY: 50 }));

    const updated = STATE.activeTimelineCuts.find(c => c.id === "clip_v1");
    assert.equal(updated.outFrame - updated.inFrame, 200, "Duração final deve ser 200 frames");
    assert.equal(updated.speed, 0.5, "Velocidade final deve ser 0.5");
    assert.equal(updated.timelineStartFrame, 0, "Início do clipe não deve mudar no arraste da cauda");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Compressão pela Borda Direita (Aceleração / Fast Motion)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Compressão pela borda direita: reduzir duração pela metade aumenta velocidade para 200%", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_v2",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    // Clica na metade direita do clipe
    interaction.onMouseDown(makeMouseEvent({
        clientX: 90,
        clientY: 50
    }));

    // Encolhe em 50 frames (duração 50f)
    interaction.onMouseMove(makeMouseEvent({
        clientX: 40, // delta = -50
        clientY: 50
    }));

    assert.equal(interaction.currentDragRateStretch.durationFrames, 50, "Nova duração deve ser 50 frames");
    assert.equal(interaction.currentDragRateStretch.speed, 2.0, "Nova velocidade deve ser 2.0 (200%)");

    interaction.onMouseUp(makeMouseEvent({ clientX: 40, clientY: 50 }));

    const updated = STATE.activeTimelineCuts.find(c => c.id === "clip_v2");
    assert.equal(updated.outFrame - updated.inFrame, 50, "Duração final deve ser 50 frames");
    assert.equal(updated.speed, 2.0, "Velocidade final deve ser 200% (2.0x)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Esticamento pela Borda Esquerda (Recuo de Início e Preservação do Fim)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Esticamento pela borda esquerda: estende cabeça para trás mantendo cauda fixa", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_left",
            track: "V1",
            timelineStartFrame: 100,
            inFrame: 0,
            outFrame: 100, // cauda em 200f
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    // Clica na metade esquerda do clipe (frame 110)
    interaction.onMouseDown(makeMouseEvent({
        clientX: 110,
        clientY: 50
    }));

    assert.equal(interaction.dragState, "rate-stretch-left", "dragState deve ser 'rate-stretch-left'");

    // Arraste para a esquerda em 50 frames (início vai para 50f, duração para 150f)
    interaction.onMouseMove(makeMouseEvent({
        clientX: 60, // delta = -50
        clientY: 50
    }));

    assert.equal(interaction.currentDragRateStretch.durationFrames, 150, "Nova duração deve ser 150 frames");
    assert.equal(interaction.currentDragRateStretch.newTimelineStartFrame, 50, "Novo início deve ser frame 50");
    assert.equal(Math.round(interaction.currentDragRateStretch.speed * 1000) / 1000, Math.round((100 / 150) * 1000) / 1000, "Velocidade deve ser ~0.667");

    interaction.onMouseUp(makeMouseEvent({ clientX: 60, clientY: 50 }));

    const updated = STATE.activeTimelineCuts.find(c => c.id === "clip_left");
    assert.equal(updated.timelineStartFrame, 50, "Início final deve ser frame 50");
    assert.equal(updated.outFrame - updated.inFrame, 150, "Duração final deve ser 150 frames");
    assert.equal(updated.timelineStartFrame + (updated.outFrame - updated.inFrame), 200, "Fim da cauda deve permanecer estático em 200");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Sincronia de Pares A/V Vinculados (link_id) & Modo Alt Desvinculado
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Sincronia de Pares A/V e desacoplamento com tecla Alt", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_v_pair",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            link_id: "link_av_10",
            type: "video"
        },
        {
            id: "clip_a_pair",
            track: "A1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            link_id: "link_av_10",
            type: "audio"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    // 1. Arraste síncrono (sem Alt)
    interaction.onMouseDown(makeMouseEvent({
        clientX: 80,
        clientY: 50
    }));
    interaction.onMouseMove(makeMouseEvent({ clientX: 130, clientY: 50 })); // +50 frames -> 150f
    interaction.onMouseUp(makeMouseEvent({ clientX: 130, clientY: 50 }));

    let vClip = STATE.activeTimelineCuts.find(c => c.id === "clip_v_pair");
    let aClip = STATE.activeTimelineCuts.find(c => c.id === "clip_a_pair");
    assert.equal(vClip.outFrame - vClip.inFrame, 150, "Vídeo vinculado deve esticar para 150 frames");
    assert.equal(aClip.outFrame - aClip.inFrame, 150, "Áudio vinculado deve esticar proporcionalmente para 150 frames");
    assert.equal(vClip.speed, aClip.speed, "Velocidade de vídeo e áudio vinculado deve ser rigorosamente idêntica");

    // 2. Arraste desvinculado (segurando Alt)
    interaction.onMouseDown(makeMouseEvent({
        clientX: 140,
        clientY: 50,
        altKey: true // AltKey ativa esticamento independente!
    }));
    interaction.onMouseMove(makeMouseEvent({ clientX: 90, clientY: 50, altKey: true })); // -50f
    interaction.onMouseUp(makeMouseEvent({ clientX: 90, clientY: 50, altKey: true }));

    vClip = STATE.activeTimelineCuts.find(c => c.id === "clip_v_pair");
    aClip = STATE.activeTimelineCuts.find(c => c.id === "clip_a_pair");
    assert.equal(vClip.outFrame - vClip.inFrame, 100, "Vídeo deve encolher para 100 frames");
    assert.equal(aClip.outFrame - aClip.inFrame, 150, "Áudio deve permanecer intacto em 150 frames");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Proteção Contra Edição em Pistas Travadas (locked: true)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Proteção de pistas travadas com cadeado", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: true }
    ];
    STATE.activeTimelineCuts = [
        {
            id: "clip_locked",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";

    toasts.length = 0;
    interaction.onMouseDown(makeMouseEvent({
        clientX: 80,
        clientY: 50
    }));

    assert.equal(interaction.dragState, null, "Não deve iniciar arraste em pista travada");
    assert.ok(toasts.some(t => t[0].includes("travada")), "Deve emitir toast de aviso de pista travada");
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Clamping de Limites de Velocidade (10% a 1000%)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Clamping de velocidade mínima (10%) e máxima (1000%)", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_clamp",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100, // baseMediaFrames = 100
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    interaction.onMouseDown(makeMouseEvent({ clientX: 90, clientY: 50 }));

    // Tenta esticar +5000 frames (muito lento, velocidade mínima de 10% = 0.1x -> duração máxima 1000f)
    interaction.onMouseMove(makeMouseEvent({ clientX: 5090, clientY: 50 }));
    assert.equal(interaction.currentDragRateStretch.durationFrames, 1000, "Duração máxima permitida a 10% deve ser 1000 frames");
    assert.equal(interaction.currentDragRateStretch.speed, 0.1, "Velocidade mínima deve ser clampada em 0.1 (10%)");

    // Tenta comprimir -500 frames (muito rápido, velocidade máxima de 1000% = 10x -> duração mínima 10f)
    interaction.onMouseMove(makeMouseEvent({ clientX: -400, clientY: 50 }));
    assert.equal(interaction.currentDragRateStretch.durationFrames, 10, "Duração mínima permitida a 1000% deve ser 10 frames");
    assert.equal(interaction.currentDragRateStretch.speed, 10.0, "Velocidade máxima deve ser clampada em 10.0 (1000%)");

    interaction.onMouseUp(makeMouseEvent({ clientX: 0, clientY: 50 }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Clamping de Colisão contra Lacunas (Gaps) na Mesma Pista
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Clamping de colisão com vizinhos da mesma pista (Fit to Gap)", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_target",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        },
        {
            id: "clip_neighbor",
            track: "V1",
            timelineStartFrame: 200, // vizinho começa no frame 200 (lacuna de 100f livre)
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    interaction.onMouseDown(makeMouseEvent({ clientX: 90, clientY: 50 }));

    // Tenta esticar +250 frames (passando do frame 200)
    interaction.onMouseMove(makeMouseEvent({ clientX: 340, clientY: 50 }));

    // Deve travar na borda da lacuna (frame 200 -> duração 200 frames)
    assert.equal(interaction.currentDragRateStretch.durationFrames, 200, "Deve sofrer clamping no frame 200 do vizinho");
    assert.equal(interaction.currentDragRateStretch.speed, 0.5, "Taxa resultante deve ser 50% para preencher o gap perfeitamente");

    interaction.onMouseUp(makeMouseEvent({ clientX: 340, clientY: 50 }));
    const target = STATE.activeTimelineCuts.find(c => c.id === "clip_target");
    assert.equal(target.timelineStartFrame + (target.outFrame - target.inFrame), 200, "Cauda do clipe deve encostar exatamente no vizinho");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Reversibilidade Atômica via TIMELINE_HISTORY (Undo e Redo)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reversibilidade total via Histórico (Ctrl+Z e Ctrl+Y)", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_undo",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    // Executa alteração
    interaction.onMouseDown(makeMouseEvent({ clientX: 90, clientY: 50 }));
    interaction.onMouseMove(makeMouseEvent({ clientX: 190, clientY: 50 })); // +100f -> 200f (50%)
    interaction.onMouseUp(makeMouseEvent({ clientX: 190, clientY: 50 }));

    let clip = STATE.activeTimelineCuts.find(c => c.id === "clip_undo");
    assert.equal(clip.speed, 0.5, "Velocidade deve ter mudado para 0.5");

    // Desfaz com Undo
    TIMELINE_HISTORY.undo();
    clip = STATE.activeTimelineCuts.find(c => c.id === "clip_undo");
    assert.equal(clip.speed, 1.0, "Undo deve restaurar velocidade para 1.0");
    assert.equal(clip.outFrame - clip.inFrame, 100, "Undo deve restaurar duração para 100");

    // Refaz com Redo
    TIMELINE_HISTORY.redo();
    clip = STATE.activeTimelineCuts.find(c => c.id === "clip_undo");
    assert.equal(clip.speed, 0.5, "Redo deve reaplicar velocidade 0.5");
    assert.equal(clip.outFrame - clip.inFrame, 200, "Redo deve reaplicar duração 200");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Cancelamento de Operação em Andamento com Tecla Escape
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Cancelamento imediato de arraste via tecla Escape", () => {
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [
        {
            id: "clip_esc",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            source_duration_frames: 100,
            speed: 1.0,
            type: "video"
        }
    ];

    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    TIMELINE_STATE.activeTool = "rate-stretch";
    TIMELINE_STATE.zoom = 1.0;

    interaction.onMouseDown(makeMouseEvent({ clientX: 90, clientY: 50 }));
    interaction.onMouseMove(makeMouseEvent({ clientX: 190, clientY: 50 })); // em andamento...

    assert.ok(interaction.dragState, "Drag deve estar ativo");

    // Pressiona Escape
    let prevented = false;
    interaction.onKeyDown({
        key: "Escape",
        code: "Escape",
        preventDefault: () => { prevented = true; }
    });

    assert.ok(prevented, "Escape deve prevenir ação padrão");
    assert.equal(interaction.dragState, null, "Drag deve ter sido cancelado");

    const clip = STATE.activeTimelineCuts.find(c => c.id === "clip_esc");
    assert.equal(clip.speed, 1.0, "Velocidade deve ter sido restaurada intacta");
    assert.equal(clip.outFrame - clip.inFrame, 100, "Duração deve permanecer 100 frames intacta");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Alternância de Ferramenta por Teclado (tools.rate_stretch & tools.select)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Ativação via atalho de teclado e retorno para Seleção (V)", () => {
    const dummyRenderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(dummyRenderer);

    // Inicialmente com seleção
    TIMELINE_STATE.setTool("select");
    assert.equal(TIMELINE_STATE.activeTool, "select");

    // Pressiona atalho de Rate Stretch no perfil ativo
    interaction.onKeyDown({
        code: "KeyR",
        key: "R",
        shiftKey: true,
        preventDefault: () => {}
    });

    assert.equal(TIMELINE_STATE.activeTool, "rate-stretch", "Atalho Shift+KeyR deve ativar rate-stretch");

    // Pressiona V para voltar para seleção
    interaction.onKeyDown({
        code: "KeyV",
        key: "v",
        shiftKey: false,
        preventDefault: () => {}
    });

    assert.equal(TIMELINE_STATE.activeTool, "select", "Atalho KeyV deve retornar para select");
});

console.log("\n===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} BATERIAS APROVADAS COM 100% DE SUCESSO!`);
console.log("===============================================================================\n");
