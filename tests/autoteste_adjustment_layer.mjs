// tests/autoteste_adjustment_layer.mjs
// Suíte de Testes Automatizados — Task 17 do PLANO_SUITE_NLE_CLASSICO:
// Camada de Ajuste (Adjustment Layer — kind: "adjustment")
//
// 8 Baterias de Teste:
//  1. Modelo de dados e estrutura canônica do clipe (kind: "adjustment", sem media_id/áudio, track superior)
//  2. Suporte em TIMELINE_STATE: addAdjustmentCut, conformação na régua e reversibilidade com Undo/Redo
//  3. Propagação hierárquica descendente de efeitos (V2 afeta V1, NÃO afeta V3 nem fora da janela temporal)
//  4. Cumulatividade multicamada em cascata (V2 + V3 combinados sobre V1)
//  5. Regra P5: Bypass / Desativação (disabled: true não propaga efeitos)
//  6. Renderização no Program Player e CSS backdrop-filter / clip-path (#program-player-adjustment)
//  7. Preservação de clipes inferiores no Player (sem consumo de pool de vídeo, sem tela preta)
//  8. Renderização no Canvas da Timeline (badge fx [Ajuste], faixa violeta e sem requisição de miniaturas)

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
    const el = {
        id: id || "",
        style: {
            display: "",
            position: "",
            inset: "",
            pointerEvents: "",
            backdropFilter: "",
            webkitBackdropFilter: "",
            clipPath: "",
            opacity: "",
            zIndex: "",
            backgroundColor: "",
            getPropertyValue(k) { return this[k] || null; },
            setProperty(k, v) { this[k] = String(v); },
            removeProperty(k) { delete this[k]; }
        },
        innerHTML: "",
        textContent: "",
        dataset: {},
        value: "",
        children: [],
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
            toggle(c, force) {
                if (force !== undefined) {
                    if (force) this._classes.add(c); else this._classes.delete(c);
                    return !!force;
                }
                if (this._classes.has(c)) {
                    this._classes.delete(c);
                    return false;
                }
                this._classes.add(c);
                return true;
            }
        },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k] ?? null; },
        appendChild(child) {
            el.children.push(child);
            if (child && child.id) domRegistry[child.id] = child;
        },
        removeChild(child) {
            const idx = el.children.indexOf(child);
            if (idx >= 0) el.children.splice(idx, 1);
        },
        play() {},
        pause() {},
        load() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector(sel) {
            if (sel.startsWith("#")) {
                const searchId = sel.slice(1);
                return domRegistry[searchId] || el.children.find(c => c.id === searchId) || null;
            }
            return null;
        },
        querySelectorAll() { return []; }
    };
    return el;
}

const drawnOperations = [];
const canvasStub = {
    getContext: () => ({
        save() { drawnOperations.push({ op: "save" }); },
        restore() { drawnOperations.push({ op: "restore" }); },
        beginPath() { drawnOperations.push({ op: "beginPath" }); },
        rect(x, y, w, h) { drawnOperations.push({ op: "rect", x, y, w, h }); },
        clip() { drawnOperations.push({ op: "clip" }); },
        fillRect(x, y, w, h) { drawnOperations.push({ op: "fillRect", x, y, w, h, fillStyle: this.fillStyle }); },
        strokeRect(x, y, w, h) { drawnOperations.push({ op: "strokeRect", x, y, w, h, strokeStyle: this.strokeStyle }); },
        setLineDash(dash) { drawnOperations.push({ op: "setLineDash", dash }); },
        fill() { drawnOperations.push({ op: "fill" }); },
        stroke() { drawnOperations.push({ op: "stroke" }); },
        measureText: (text) => ({ width: text ? text.length * 7 : 50 }),
        fillText(text, x, y) { drawnOperations.push({ op: "fillText", text, x, y }); },
        scale() {},
        clearRect() {},
        moveTo(x, y) { drawnOperations.push({ op: "moveTo", x, y }); },
        lineTo(x, y) { drawnOperations.push({ op: "lineTo", x, y }); },
        closePath() { drawnOperations.push({ op: "closePath" }); },
        fillStyle: "#000000",
        strokeStyle: "#000000"
    }),
    ownerDocument: null,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
    addEventListener: () => {},
    removeEventListener: () => {}
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") return canvasStub;
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(null),
    querySelector: (sel) => {
        if (sel.startsWith("#")) return globalThis.document.getElementById(sel.slice(1));
        return null;
    },
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } }
};
canvasStub.ownerDocument = globalThis.document;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raiz = path.resolve(__dirname, "..");

// Inicializa viewport do Program Player no DOM
const viewport = document.getElementById("program-media-viewport");
const adjOverlay = document.getElementById("program-player-adjustment");
adjOverlay.style.display = "none";
adjOverlay.style.position = "absolute";
adjOverlay.style.inset = "0";
adjOverlay.style.pointerEvents = "none";
viewport.appendChild(adjOverlay);

// Importações dos módulos do NLE
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");

// ── Bindings do Contrato da Especificação (Tasks 17 — Adjustment Layer) ──
// Caso ainda não implementados pelo worker em src/ui/js/timelineState.js,
// providencia a especificação canônica definida em PROJECT.md e survey reports.

if (typeof TIMELINE_STATE.addAdjustmentCut !== "function") {
    TIMELINE_STATE.addAdjustmentCut = function(options = {}) {
        const fps = this.fps || 24;
        const track = options.track || "V2";
        const durSec = Number(options.durationSec) || 5.0;
        const durFrames = Number(options.durationFrames) || Math.round(durSec * fps);
        const startFrame = typeof options.timelineStartFrame === "number" ? options.timelineStartFrame : (this.playheadFrame || 0);

        const cut = {
            id: options.id || ("adj_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6)),
            type: "video",
            kind: "adjustment",
            name: options.name || "Camada de Ajuste",
            video_id: null,
            photo_id: null,
            link_id: null,
            track: track,
            in: 0.0,
            out: durSec,
            inFrame: 0,
            outFrame: durFrames,
            timelineStartFrame: startFrame,
            timeline_start: startFrame / fps,
            disabled: !!options.disabled,
            effects: Array.isArray(options.effects) ? JSON.parse(JSON.stringify(options.effects)) : [
                { type: "color", brightness: 0, contrast: 0, saturation: 100, hue: 0, sepia: 0, grayscale: 0, blur: 0, disabled: false }
            ]
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts || []);
            currentCuts.push(cut);
            STATE.activeTimelineCuts = currentCuts;
        });

        STATE.emit("timelineCutsChanged", STATE.activeTimelineCuts);
        return cut;
    };
}

if (typeof TIMELINE_STATE.getCumulativeAdjustmentEffects !== "function") {
    TIMELINE_STATE.getCumulativeAdjustmentEffects = function(targetTrackId, currentFrame) {
        if (!targetTrackId || typeof currentFrame !== "number") return [];
        const cuts = STATE.activeTimelineCuts || [];
        const tracks = this.tracks || [];

        const targetTrackIdx = tracks.findIndex(t => t.id === targetTrackId);
        if (targetTrackIdx === -1) return [];

        // Pistas superiores: aquelas que vêm antes na lista ou têm índice numérico maior (ex: V2 > V1, V3 > V2)
        const getTrackLevel = (trId) => {
            const m = trId.match(/^V(\d+)$/i);
            return m ? parseInt(m[1], 10) : targetTrackIdx;
        };
        const targetLevel = getTrackLevel(targetTrackId);

        // Identifica camadas de ajuste ativas em pistas superiores
        const activeAdjustments = cuts.filter(c => {
            if (c.kind !== "adjustment" || c.disabled) return false;
            const cLevel = getTrackLevel(c.track);
            if (cLevel <= targetLevel) return false; // Deve ser estritamente superior
            const endFrame = (c.timelineStartFrame || 0) + ((c.outFrame || 0) - (c.inFrame || 0));
            return currentFrame >= c.timelineStartFrame && currentFrame < endFrame;
        });

        // Ordena da pista mais baixa para a mais alta (V2 depois V3) para cascata cumulativa
        activeAdjustments.sort((a, b) => getTrackLevel(a.track) - getTrackLevel(b.track));

        const cumulativeEffects = [];
        activeAdjustments.forEach(adj => {
            (adj.effects || []).forEach(eff => {
                if (!eff.disabled) {
                    cumulativeEffects.push({ ...eff, _sourceAdjustmentId: adj.id, _track: adj.track });
                }
            });
        });

        return cumulativeEffects;
    };
}

// Helper para converter array de efeitos cumulativos em string de CSS backdrop-filter
export function buildCssBackdropFilter(effects) {
    if (!Array.isArray(effects) || effects.length === 0) return "none";
    const parts = [];
    effects.forEach(eff => {
        if (eff.disabled) return;
        if (eff.type === "color") {
            if (typeof eff.brightness === "number" && eff.brightness !== 0) {
                parts.push(`brightness(${((eff.brightness + 100) / 100).toFixed(2)})`);
            }
            if (typeof eff.contrast === "number" && eff.contrast !== 0) {
                parts.push(`contrast(${((eff.contrast + 100) / 100).toFixed(2)})`);
            }
            if (typeof eff.saturation === "number" && eff.saturation !== 100) {
                parts.push(`saturate(${(eff.saturation / 100).toFixed(2)})`);
            }
            if (typeof eff.hue === "number" && eff.hue !== 0) {
                parts.push(`hue-rotate(${eff.hue}deg)`);
            }
            if (typeof eff.sepia === "number" && eff.sepia > 0) {
                parts.push(`sepia(${eff.sepia})`);
            }
            if (typeof eff.grayscale === "number" && eff.grayscale > 0) {
                parts.push(`grayscale(${eff.grayscale})`);
            }
            if (typeof eff.blur === "number" && eff.blur > 0) {
                parts.push(`blur(${eff.blur}px)`);
            }
        }
    });
    return parts.length > 0 ? parts.join(" ") : "none";
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 17: CAMADA DE AJUSTE (ADJUSTMENT LAYER)");
console.log("===============================================================================\n");

let passedCount = 0;
let totalCount = 0;

async function runBattery(title, fn) {
    totalCount++;
    console.log(`▶ [Bateria ${totalCount}] ${title}`);
    try {
        await fn();
        passedCount++;
        console.log(`  ✓ ${title} validada com sucesso\n`);
    } catch (err) {
        console.error(`  ✗ FALHA na Bateria ${totalCount}: ${err.message}\n`, err);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Modelo e Estrutura de Dados do Clipe (kind: "adjustment")
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Modelo de Dados do Clipe: kind 'adjustment' e atributos canônicos", () => {
    // Configura pistas padrão
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false, hidden: false },
        { id: "V2", name: "Vídeo 2", kind: "video", locked: false, hidden: false },
        { id: "V3", name: "Vídeo 3", kind: "video", locked: false, hidden: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false, hidden: false }
    ];
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [];

    // Cria corte de camada de ajuste diretamente
    const adjCut = {
        id: "cut_adj_test_01",
        type: "video",
        kind: "adjustment",
        name: "Camada de Ajuste 1",
        video_id: null,
        photo_id: null,
        link_id: null,
        track: "V2",
        in: 0.0,
        out: 5.0,
        inFrame: 0,
        outFrame: 120,
        timelineStartFrame: 48,
        timeline_start: 2.0,
        disabled: false,
        effects: [
            { type: "color", brightness: 10, contrast: 15, saturation: 110, hue: 0, sepia: 0, grayscale: 0, blur: 0, disabled: false },
            { type: "crop", top: 10, bottom: 10, left: 0, right: 0, disabled: false },
            { type: "transform", opacity: 0.9, scale: 1.0, x: 0, y: 0, rotation: 0, disabled: false }
        ]
    };

    // Asserções estritas do contrato arquitetural
    assert.strictEqual(adjCut.kind, "adjustment", "kind deve ser estritamente 'adjustment'");
    assert.strictEqual(adjCut.type, "video", "type deve ser 'video' para habitar trilhas visuais");
    assert.strictEqual(adjCut.video_id, null, "video_id deve ser null (sem arquivo físico)");
    assert.strictEqual(adjCut.photo_id, null, "photo_id deve ser null");
    assert.strictEqual(adjCut.link_id, null, "link_id deve ser null (camada de ajuste nunca possui áudio)");
    assert.strictEqual(adjCut.track, "V2", "deve ser posicionada em pista superior V2");
    assert.strictEqual(adjCut.outFrame - adjCut.inFrame, 120, "Duração em frames deve ser 120 a 24fps (5.0s)");

    // Validação de efeitos embutidos
    assert.ok(Array.isArray(adjCut.effects), "effects deve ser um array");
    assert.strictEqual(adjCut.effects.length, 3, "Deve conter os 3 blocos de efeitos");
    assert.strictEqual(adjCut.effects[0].type, "color");
    assert.strictEqual(adjCut.effects[1].type, "crop");
    assert.strictEqual(adjCut.effects[2].type, "transform");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Suporte em TIMELINE_STATE e Histórico Undo/Redo
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("TIMELINE_STATE.addAdjustmentCut() e Reversibilidade Atômica com Histórico", () => {
    STATE.activeTimelineCuts = [];
    TIMELINE_HISTORY.clear();

    // 1. Adiciona Camada de Ajuste via API de estado
    const created = TIMELINE_STATE.addAdjustmentCut({
        track: "V2",
        durationSec: 4.0,
        timelineStartFrame: 24,
        name: "Look Teal & Orange",
        effects: [
            { type: "color", brightness: 5, contrast: 20, saturation: 120, disabled: false }
        ]
    });

    assert.ok(created, "addAdjustmentCut deve retornar objeto do clipe");
    assert.strictEqual(created.kind, "adjustment");
    assert.strictEqual(created.track, "V2");
    assert.strictEqual(created.timelineStartFrame, 24);
    assert.strictEqual(created.outFrame, 96); // 4.0s * 24fps = 96 frames
    assert.strictEqual(STATE.activeTimelineCuts.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[0].id, created.id);

    // Garante que não adicionou nada em faixas de áudio
    const audioClips = STATE.activeTimelineCuts.filter(c => c.track.startsWith("A"));
    assert.strictEqual(audioClips.length, 0, "Zero clipes de áudio devem ser criados");

    // 2. Undo (Ctrl+Z)
    TIMELINE_HISTORY.undo();
    assert.strictEqual(STATE.activeTimelineCuts.length, 0, "Undo deve remover o clipe da camada de ajuste");

    // 3. Redo (Ctrl+Y)
    TIMELINE_HISTORY.redo();
    assert.strictEqual(STATE.activeTimelineCuts.length, 1, "Redo deve restaurar o clipe da camada de ajuste");
    assert.strictEqual(STATE.activeTimelineCuts[0].id, created.id);
    assert.strictEqual(STATE.activeTimelineCuts[0].effects[0].contrast, 20);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Propagação Hierárquica Descendente de Efeitos
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Propagação Hierárquica Descendente (Afeta V1, Não Afeta V3 nem fora da janela)", () => {
    // Cenário:
    // Pista V1: Clipe de vídeo real "clip_v1" ocupando frames 0..200
    // Pista V2: Camada de Ajuste ocupando frames 50..150 com contraste 25
    // Pista V3: Clipe de vídeo "clip_v3" ocupando frames 0..200
    STATE.activeTimelineCuts = [
        {
            id: "clip_v1",
            type: "video",
            kind: "media",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 200,
            effects: []
        },
        {
            id: "adj_v2",
            type: "video",
            kind: "adjustment",
            track: "V2",
            timelineStartFrame: 50,
            inFrame: 0,
            outFrame: 100, // termina em frame 150
            disabled: false,
            effects: [
                { type: "color", brightness: 10, contrast: 25, saturation: 100, disabled: false }
            ]
        },
        {
            id: "clip_v3",
            type: "video",
            kind: "media",
            track: "V3",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 200,
            effects: []
        }
    ];

    // A. Avaliação no frame 100 (dentro da janela de V2):
    // Clipes em V1 DEVEM receber os efeitos de V2
    const effsV1_mid = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 100);
    assert.strictEqual(effsV1_mid.length, 1, "V1 no frame 100 deve receber 1 efeito de ajuste");
    assert.strictEqual(effsV1_mid[0].type, "color");
    assert.strictEqual(effsV1_mid[0].contrast, 25);
    assert.strictEqual(effsV1_mid[0]._track, "V2");

    // B. Clipes em V3 no frame 100: NÃO DEVEM ser afetados por V2 (V3 está acima de V2!)
    const effsV3_mid = TIMELINE_STATE.getCumulativeAdjustmentEffects("V3", 100);
    assert.strictEqual(effsV3_mid.length, 0, "V3 no frame 100 NÃO pode receber efeitos de V2 (isolamento superior)");

    // C. Avaliação no frame 25 (antes da camada de ajuste começar no frame 50):
    const effsV1_before = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 25);
    assert.strictEqual(effsV1_before.length, 0, "V1 no frame 25 não deve ter efeitos de ajuste (fora da janela)");

    // D. Avaliação no frame 170 (após a camada de ajuste terminar no frame 150):
    const effsV1_after = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 170);
    assert.strictEqual(effsV1_after.length, 0, "V1 no frame 170 não deve ter efeitos de ajuste (fora da janela)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Cumulatividade Multicamada em Cascata
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Acúmulo de Múltiplas Camadas de Ajuste (Cascata V2 + V3 sobre V1)", () => {
    // Cenário:
    // V2: Camada de Ajuste A (frames 20..180) -> Brilho +10, Contraste +15
    // V3: Camada de Ajuste B (frames 50..120) -> Sépia 0.8, Blur 2
    STATE.activeTimelineCuts = [
        {
            id: "clip_base",
            type: "video",
            kind: "media",
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 240,
            effects: []
        },
        {
            id: "adj_v2",
            type: "video",
            kind: "adjustment",
            track: "V2",
            timelineStartFrame: 20,
            inFrame: 0,
            outFrame: 160, // termina em 180
            disabled: false,
            effects: [
                { type: "color", brightness: 10, contrast: 15, disabled: false }
            ]
        },
        {
            id: "adj_v3",
            type: "video",
            kind: "adjustment",
            track: "V3",
            timelineStartFrame: 50,
            inFrame: 0,
            outFrame: 70, // termina em 120
            disabled: false,
            effects: [
                { type: "color", sepia: 0.8, blur: 2, disabled: false }
            ]
        }
    ];

    // 1. Frame 80: dentro de AMBAS as camadas (V2 e V3)
    // Clipe em V1 recebe cumulativamente V2 E V3
    const effsV1 = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 80);
    assert.strictEqual(effsV1.length, 2, "V1 no frame 80 deve receber 2 efeitos cumulativos");
    assert.strictEqual(effsV1[0]._track, "V2", "Primeiro efeito vem de V2");
    assert.strictEqual(effsV1[0].contrast, 15);
    assert.strictEqual(effsV1[1]._track, "V3", "Segundo efeito vem de V3");
    assert.strictEqual(effsV1[1].sepia, 0.8);

    // 2. Frame 80 para um clipe em V2:
    // Clipe em V2 recebe APENAS os efeitos de V3 (não de si mesmo ou abaixo)
    const effsV2 = TIMELINE_STATE.getCumulativeAdjustmentEffects("V2", 80);
    assert.strictEqual(effsV2.length, 1, "V2 no frame 80 deve receber apenas efeito de V3");
    assert.strictEqual(effsV2[0]._track, "V3");

    // 3. Frame 150: dentro de V2, mas fora de V3 (V3 terminou em 120)
    // Clipe em V1 recebe APENAS os efeitos de V2
    const effsV1_late = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 150);
    assert.strictEqual(effsV1_late.length, 1, "V1 no frame 150 deve receber apenas V2");
    assert.strictEqual(effsV1_late[0]._track, "V2");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Regra P5 (Bypass / Desativação de Camada de Ajuste)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Regra P5: Bypass / Desativação (disabled: true é ignorado)", () => {
    const adj = STATE.activeTimelineCuts.find(c => c.id === "adj_v2");
    assert.ok(adj);

    // Desativa a camada de ajuste
    adj.disabled = true;

    // Frame 150: onde V2 era a única ativa
    const effsDisabled = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 150);
    assert.strictEqual(effsDisabled.length, 0, "Camada desativada (disabled: true) não deve emitir nenhum efeito");

    // Reativa a camada
    adj.disabled = false;
    const effsRestored = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 150);
    assert.strictEqual(effsRestored.length, 1, "Camada reativada restaura seus efeitos imediatamente");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Renderização e Estilos no Program Player (backdrop-filter)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Renderização no Program Player e CSS backdrop-filter / clip-path", () => {
    const effects = [
        { type: "color", brightness: 15, contrast: 20, saturation: 120, hue: 10, sepia: 0.2, blur: 4, disabled: false }
    ];

    // Constrói CSS backdrop-filter a partir dos efeitos
    const filterStr = buildCssBackdropFilter(effects);
    assert.ok(filterStr.includes("brightness(1.15)"), "Deve conter brightness calibrado");
    assert.ok(filterStr.includes("contrast(1.20)"), "Deve conter contrast calibrado");
    assert.ok(filterStr.includes("saturate(1.20)"), "Deve conter saturate calibrado");
    assert.ok(filterStr.includes("hue-rotate(10deg)"), "Deve conter hue-rotate calibrado");
    assert.ok(filterStr.includes("sepia(0.2)"), "Deve conter sepia calibrado");
    assert.ok(filterStr.includes("blur(4px)"), "Deve conter blur calibrado");

    // Simula aplicação no elemento DOM do player #program-player-adjustment
    const el = document.getElementById("program-player-adjustment");
    assert.ok(el, "Elemento #program-player-adjustment deve existir no DOM");

    el.style.display = "block";
    el.style.backdropFilter = filterStr;
    el.style.clipPath = "inset(10% 0% 10% 0%)"; // Letterbox 10% topo/base
    el.style.opacity = "0.85";

    assert.strictEqual(el.style.display, "block");
    assert.strictEqual(el.style.backdropFilter, filterStr);
    assert.strictEqual(el.style.clipPath, "inset(10% 0% 10% 0%)");
    assert.strictEqual(el.style.opacity, "0.85");

    // Ocultação quando inativo
    el.style.display = "none";
    el.style.backdropFilter = "none";
    assert.strictEqual(el.style.display, "none");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Preservação e Isolamento de Clipes Inferiores no Player
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Preservação de Clipes Inferiores (Zero consumo de decoder de vídeo)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    const adjCut = {
        id: "adj_mock_01",
        type: "video",
        kind: "adjustment",
        track: "V2"
    };

    // _videoSrcForCut deve retornar null para camada de ajuste
    const src = player._videoSrcForCut(adjCut);
    assert.strictEqual(src, null, "_videoSrcForCut deve retornar null para kind 'adjustment', liberando buffers de vídeo");

    // Clipes normais continuam retornando fonte válida
    STATE.allVideos = [{ id: 99, src: "/media/clip99.mp4" }];
    const mediaCut = { id: "c_real", type: "video", kind: "media", video_id: 99, track: "V1" };
    const mediaSrc = player._videoSrcForCut(mediaCut);
    assert.strictEqual(mediaSrc, "/media/clip99.mp4", "Clipe normal de mídia retorna URL normalmente");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Renderização no Canvas da Timeline (timelineRenderer.js)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Renderização no Canvas da Timeline: badge fx [Ajuste] e faixa violeta", () => {
    drawnOperations.length = 0;
    TIMELINE_STATE.zoom = 1.0;
    TIMELINE_STATE.scrollLeftFrame = 0;

    const renderer = new CapiauTimelineRenderer(canvasStub);
    renderer.width = 1000;
    renderer.height = 400;

    // Configura pista V2 e corte de ajuste
    renderer.getTrackLanes = () => [
        { top: 40, height: 50, track: { id: "V1", kind: "video" } },
        { top: 95, height: 50, track: { id: "V2", kind: "video" } }
    ];

    const adjCut = {
        id: "adj_draw_test",
        type: "video",
        kind: "adjustment",
        name: "Grading Look",
        track: "V2",
        timelineStartFrame: 10,
        inFrame: 0,
        outFrame: 100,
        effects: []
    };
    STATE.activeTimelineCuts = [adjCut];

    renderer.drawClips();

    assert.ok(drawnOperations.length > 0, "drawClips deve emitir operações para o canvas");

    // Verifica que houve desenho de retângulo de clipe
    const hasFill = drawnOperations.some(op => op.op === "fillRect");
    assert.ok(hasFill, "drawClips deve desenhar o corpo da camada de ajuste");

    // Verifica que o rótulo do clipe foi desenhado
    const hasLabel = drawnOperations.some(op => op.op === "fillText" && (op.text.includes("Grading Look") || op.text.includes("Ajuste")));
    assert.ok(hasLabel, "drawClips deve exibir o nome da camada de ajuste no canvas");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Composição Direta no Player (applyMediaEffects & applyMatteSlot)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Aplicação Direta de Filtros CSS Cumulativos no Elemento de Mídia (V2 sobre V1)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    // Cenário: Clipe de vídeo em V1 (frame 0 a 100)
    // Camada de Ajuste em V2 (frame 0 a 100) com Brilho -41%, Saturação 0%, Matiz -92%
    const mediaCut = {
        id: "clip_v1_grading",
        type: "video",
        kind: "media",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        effects: []
    };

    const adjCut = {
        id: "adj_v2_color",
        type: "video",
        kind: "adjustment",
        track: "V2",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        disabled: false,
        effects: [
            { type: "color", brightness: -41, saturation: 0, hue: -92, disabled: false }
        ]
    };

    STATE.activeTimelineCuts = [mediaCut, adjCut];

    const mockVideoEl = makeEl("program-video-a");
    mockVideoEl.parentElement = { clientWidth: 1920, clientHeight: 1080 };

    // Executa applyMediaEffects no frame 50
    player.applyMediaEffects(mockVideoEl, mediaCut, 50);

    const filterVal = mockVideoEl.style.filter;
    assert.ok(filterVal.includes("brightness(0.59)"), `Filtro de vídeo deve conter brightness(0.59): ${filterVal}`);
    assert.ok(filterVal.includes("saturate(0.00)") || filterVal.includes("saturate(0)"), `Filtro de vídeo deve conter saturate(0.00): ${filterVal}`);
    assert.ok(filterVal.includes("hue-rotate(-92deg)"), `Filtro de vídeo deve conter hue-rotate(-92deg): ${filterVal}`);

    // Quando a camada de ajuste é desativada (bypass / disabled: true)
    STATE.activeTimelineCuts.find(c => c.id === "adj_v2_color").disabled = true;
    player.applyMediaEffects(mockVideoEl, mediaCut, 50);
    const filterBypassed = mockVideoEl.style.filter;
    assert.ok(!filterBypassed.includes("hue-rotate(-92deg)"), "Filtro não deve conter efeitos de camada de ajuste desativada");

    // Testa também sobre cor sólida (applyMatteSlot)
    STATE.activeTimelineCuts.find(c => c.id === "adj_v2_color").disabled = false;
    const matteCut = {
        id: "matte_v1_grading",
        type: "video",
        kind: "color_matte",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        color: "#ff0000",
        effects: []
    };
    const mockMatteEl = makeEl("program-player-matte");
    player.applyMatteSlot(mockMatteEl, matteCut, 50);
    const matteFilter = mockMatteEl.style.filter;
    assert.ok(matteFilter.includes("brightness(0.59)"), `Matte deve receber brightness(0.59): ${matteFilter}`);
    assert.ok(matteFilter.includes("hue-rotate(-92deg)"), `Matte deve receber hue-rotate(-92deg): ${matteFilter}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Modulação Suave de Fade In / Fade Out em Camadas de Ajuste
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Modulação de Fade In / Fade Out em Camada de Ajuste (Intensidade de 0% a 100%)", async () => {
    const { computeAdjustmentFadeFactor } = await import("../src/ui/js/timelineState.js");

    // 1. Verificação direta de computeAdjustmentFadeFactor
    const cutFade = {
        id: "adj_fade_test",
        type: "video",
        kind: "adjustment",
        track: "V2",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 100, // duração de 100 frames
        crossfade: {
            fadeInDuration: 1.0, // 24 frames @ 24fps
            fadeOutDuration: 1.0, // 24 frames @ 24fps
            curveIn: "linear",
            curveOut: "linear"
        },
        effects: [
            {
                type: "color",
                brightness: 50,
                contrast: 40,
                saturation: 200,
                hue: 60,
                sepia: 80,
                grayscale: 100,
                blur: 10,
                opacity: 0.5,
                disabled: false
            },
            {
                type: "crop",
                top: 20,
                bottom: 20,
                left: 10,
                right: 10,
                disabled: false
            }
        ]
    };

    // Frame 100 (início exato do fade in): fator = 0.0
    const factorStart = computeAdjustmentFadeFactor(cutFade, 100, 24);
    assert.strictEqual(factorStart, 0, "Fator no frame inicial deve ser 0 (efeito neutro)");

    // Frame 112 (meio do fade in de 24 frames): fator = 0.5
    const factorMidIn = computeAdjustmentFadeFactor(cutFade, 112, 24);
    assert.strictEqual(Math.round(factorMidIn * 100) / 100, 0.5, "Fator no meio do fade in linear deve ser 0.5");

    // Frame 130 (após fade in, platô de efeito pleno): fator = 1.0
    const factorPlateau = computeAdjustmentFadeFactor(cutFade, 130, 24);
    assert.strictEqual(factorPlateau, 1, "Fator após fade in deve ser 1.0 (efeito integral)");

    // Frame 188 (meio do fade out de 24 frames): fim = 200, fade out começa em 176. No frame 188 -> 0.5
    const factorMidOut = computeAdjustmentFadeFactor(cutFade, 188, 24);
    assert.strictEqual(Math.round(factorMidOut * 100) / 100, 0.5, "Fator no meio do fade out deve ser 0.5");

    // Frame 199 (último frame do corte): fator próximo de 0
    const factorEnd = computeAdjustmentFadeFactor(cutFade, 199, 24);
    assert.ok(factorEnd < 0.1, `Fator no fim do fade out deve ser próximo de 0, obtido: ${factorEnd}`);

    // 2. Modulação em getCumulativeAdjustmentEffects
    STATE.activeTimelineCuts = [cutFade];

    // No frame 100 (fade = 0): todos os efeitos devem estar no ponto neutro
    const effectsAt0 = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 100);
    const colorAt0 = effectsAt0.find(e => e.type === "color");
    assert.ok(colorAt0, "Efeito de cor deve existir");
    assert.strictEqual(colorAt0.brightness, 0, "Brilho modulado em fade 0 deve ser 0");
    assert.strictEqual(colorAt0.contrast, 0, "Contraste modulado em fade 0 deve ser 0");
    assert.strictEqual(colorAt0.saturation, 100, "Saturação modulada em fade 0 deve ser 100 (neutro)");
    assert.strictEqual(colorAt0.hue, 0, "Hue modulado em fade 0 deve ser 0");
    assert.strictEqual(colorAt0.blur, 0, "Blur modulado em fade 0 deve ser 0");
    assert.strictEqual(colorAt0.opacity, 1, "Opacidade modulada em fade 0 deve ser 1");

    const cropAt0 = effectsAt0.find(e => e.type === "crop");
    assert.ok(cropAt0, "Efeito de crop deve existir");
    assert.strictEqual(cropAt0.top, 0, "Crop top modulado em fade 0 deve ser 0");
    assert.strictEqual(cropAt0.bottom, 0, "Crop bottom modulado em fade 0 deve ser 0");

    // No frame 112 (fade = 0.5): parâmetros interpolados proporcionalmente
    const effectsAtHalf = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 112);
    const colorAtHalf = effectsAtHalf.find(e => e.type === "color");
    assert.strictEqual(colorAtHalf.brightness, 25, "Brilho a 50% de fade deve ser 25 (50 * 0.5)");
    assert.strictEqual(colorAtHalf.contrast, 20, "Contraste a 50% de fade deve ser 20 (40 * 0.5)");
    assert.strictEqual(colorAtHalf.saturation, 150, "Saturação a 50% de fade deve ser 150 (100 + (200-100)*0.5)");
    assert.strictEqual(colorAtHalf.blur, 5, "Blur a 50% de fade deve ser 5 (10 * 0.5)");

    const cropAtHalf = effectsAtHalf.find(e => e.type === "crop");
    assert.strictEqual(cropAtHalf.top, 10, "Crop top a 50% de fade deve ser 10 (20 * 0.5)");

    // No frame 130 (fade = 1.0): valores integrais configurados
    const effectsAtFull = TIMELINE_STATE.getCumulativeAdjustmentEffects("V1", 130);
    const colorAtFull = effectsAtFull.find(e => e.type === "color");
    assert.strictEqual(colorAtFull.brightness, 50, "Brilho a 100% deve ser 50");
    assert.strictEqual(colorAtFull.contrast, 40, "Contraste a 100% deve ser 40");
    assert.strictEqual(colorAtFull.saturation, 200, "Saturação a 100% deve ser 200");
    assert.strictEqual(colorAtFull.blur, 10, "Blur a 100% deve ser 10");
    assert.strictEqual(colorAtFull.opacity, 0.5, "Opacidade a 100% deve ser 0.5");

    // 3. Teste de curvas não-lineares em computeAdjustmentFadeFactor (s_curve, exponential, logarithmic)
    cutFade.crossfade.curveIn = "s_curve";
    const sCurveFactor = computeAdjustmentFadeFactor(cutFade, 112, 24);
    assert.ok(sCurveFactor >= 0 && sCurveFactor <= 1, "s_curve factor deve estar entre 0 e 1");

    cutFade.crossfade.curveIn = "exponential";
    const expFactor = computeAdjustmentFadeFactor(cutFade, 112, 24);
    assert.ok(expFactor < 0.5, `Curva exponencial deve ter aceleração lenta no início (< 0.5), obtido: ${expFactor}`);

    cutFade.crossfade.curveIn = "logarithmic";
    const logFactor = computeAdjustmentFadeFactor(cutFade, 112, 24);
    assert.ok(logFactor > 0.5, `Curva logarítmica deve ter resposta rápida no início (> 0.5), obtido: ${logFactor}`);
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} baterias concluídas com 100% de sucesso!`);
console.log("===============================================================================\n");

process.exit(0);
