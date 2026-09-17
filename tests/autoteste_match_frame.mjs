// tests/autoteste_match_frame.mjs
// Autoteste automatizado da Task 8: Localizar Quadro Original na Fonte (Match Frame & Reverse Match Frame)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Polyfill de ambiente de navegador para execução em Node.js ESM
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
globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => [] });
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

let lastToastMessage = "";
let lastToastType = "";
globalThis.showToast = (msg, type) => {
    lastToastMessage = msg;
    lastToastType = type;
};
globalThis.window.showToast = globalThis.showToast;

const mockVideoElement = {
    style: {},
    dataset: {},
    currentTime: 0.0,
    duration: 60.0,
    readyState: 4,
    paused: true,
    seeking: false,
    _pendingSeekTarget: null,
    load() {},
    pause() { this.paused = true; },
    play() { this.paused = false; return Promise.resolve(); },
    addEventListener(evt, cb) {
        if (evt === "loadedmetadata") setTimeout(cb, 0);
    },
    removeEventListener() {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {}
};

const domElements = new Map();

globalThis.document = {
    defaultView: globalThis,
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id) => {
        if (id === "source-video") return mockVideoElement;
        if (!domElements.has(id)) {
            const el = {
                id,
                style: {},
                dataset: {},
                children: [],
                innerHTML: "",
                textContent: "",
                currentTime: 0,
                duration: 60,
                readyState: 4,
                paused: true,
                seeking: false,
                load: () => {},
                pause: () => {},
                play: () => Promise.resolve(),
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); },
                    toggle(c) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); }
                },
                setAttribute(k, v) { this[k] = v; },
                getAttribute(k) { return this[k] || null; },
                removeAttribute(k) { delete this[k]; },
                appendChild(c) { this.children.push(c); return c; },
                querySelector: () => null,
                querySelectorAll: () => [],
                addEventListener: () => {},
                removeEventListener: () => {},
                focus: () => {}
            };
            domElements.set(id, el);
        }
        return domElements.get(id);
    },
    body: {
        appendChild: () => {}
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        children: [],
        innerHTML: "",
        textContent: "",
        currentTime: 0,
        duration: 60,
        readyState: 4,
        paused: true,
        seeking: false,
        load: () => {},
        pause: () => {},
        play: () => Promise.resolve(),
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); }
        },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] || null; },
        removeAttribute(k) { delete this[k]; },
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild(c) { this.children.push(c); return c; }
    })
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Match Frame & Reverse Match Frame (Task 8)...");

// ── 1. VALIDAÇÃO DE DOM, BOTÕES E SVGS ───────────────────────────────────────
console.log("\n1. Validando index.html (botões de apoio e SVGs minimalistas)...");
const indexPath = path.join(rootDir, "src", "ui", "index.html");
const indexContent = fs.readFileSync(indexPath, "utf-8");

assert.ok(indexContent.includes('id="btn-match-frame"'), "index.html deve conter o botão #btn-match-frame no Program Player");
assert.ok(indexContent.includes('id="btn-source-reverse-match"'), "index.html deve conter o botão #btn-source-reverse-match no Source Player");
assert.ok(indexContent.includes('data-tooltip="Localizar Quadro na Fonte / Match Frame [Alt+F]"'), "Botão #btn-match-frame deve possuir tooltip nativo com atalho Alt+F");
assert.ok(indexContent.includes('data-tooltip="Localizar Quadro na Timeline / Reverse Match Frame [Shift+F]"'), "Botão #btn-source-reverse-match deve possuir tooltip nativo com atalho Shift+F");
console.log("  ✔ Elementos do DOM e SVGs validados com sucesso.");

// Importação dinâmica dos módulos
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE } = await import("../src/ui/js/timelineState.js");
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { VideoPlayer } = await import("../src/ui/js/player.js");

// Instancia o player principal
const player = new VideoPlayer();
window.player = player;

// ── 2. CATÁLOGO DE COMANDOS & METADADOS ──────────────────────────────────────
console.log("\n2. Validando Catálogo de Comandos (COMMANDS_CATALOG)...");
const cmdMatch = COMMANDS_CATALOG.find(c => c.id === "edit.match_frame");
const cmdRevMatch = COMMANDS_CATALOG.find(c => c.id === "edit.reverse_match_frame");

assert.ok(cmdMatch, "Comando 'edit.match_frame' deve constar em COMMANDS_CATALOG");
assert.strictEqual(cmdMatch.category, "edit", "edit.match_frame deve pertencer à categoria 'edit'");
assert.ok(cmdMatch.description.includes("Source Player"), "Descrição didática de edit.match_frame deve mencionar o Source Player");

assert.ok(cmdRevMatch, "Comando 'edit.reverse_match_frame' deve constar em COMMANDS_CATALOG");
assert.strictEqual(cmdRevMatch.category, "edit", "edit.reverse_match_frame deve pertencer à categoria 'edit'");
assert.ok(cmdRevMatch.description.includes("timeline ativa"), "Descrição de edit.reverse_match_frame deve mencionar a timeline ativa");
console.log("  ✔ Catálogo e metadados validados com sucesso.");

// ── 3. PARIDADE MULTI-PRESET NOS 5 PERFIS NLE ───────────────────────────────
console.log("\n3. Validando Paridade Multi-Preset em KEYMAP_PRESETS nos 5 perfis...");

// Preset 1: CapIAu Padrão (Alt+F para Match Frame preservando F para Toggle Disable)
KEYMAP_SERVICE.setPreset("capiau");
assert.deepStrictEqual(KEYMAP_PRESETS.capiau["edit.match_frame"], ["Alt+KeyF"], "CapIAu deve mapear edit.match_frame para Alt+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.capiau["edit.reverse_match_frame"], ["Shift+KeyF"], "CapIAu deve mapear edit.reverse_match_frame para Shift+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.capiau["edit.toggle_clip_disable"], ["KeyF"], "CapIAu deve preservar KeyF pura para edit.toggle_clip_disable");

// Teste de correspondência de eventos de teclado no CapIAu
const evtCapiauMatch = { code: "KeyF", altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
const evtCapiauRevMatch = { code: "KeyF", altKey: false, ctrlKey: false, shiftKey: true, metaKey: false };
const evtCapiauDisable = { code: "KeyF", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false };

assert.ok(KEYMAP_SERVICE.matches(evtCapiauMatch, "edit.match_frame"), "Alt+KeyF deve acionar edit.match_frame no CapIAu");
assert.ok(!KEYMAP_SERVICE.matches(evtCapiauDisable, "edit.match_frame"), "KeyF pura NÃO deve acionar edit.match_frame no CapIAu");
assert.ok(KEYMAP_SERVICE.matches(evtCapiauDisable, "edit.toggle_clip_disable"), "KeyF pura deve acionar edit.toggle_clip_disable no CapIAu");
assert.ok(KEYMAP_SERVICE.matches(evtCapiauRevMatch, "edit.reverse_match_frame"), "Shift+KeyF deve acionar edit.reverse_match_frame no CapIAu");

// Preset 2: Kdenlive
KEYMAP_SERVICE.setPreset("kdenlive");
assert.deepStrictEqual(KEYMAP_PRESETS.kdenlive["edit.match_frame"], ["Alt+KeyF"], "Kdenlive deve mapear edit.match_frame para Alt+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.kdenlive["edit.reverse_match_frame"], ["Shift+KeyF"], "Kdenlive deve mapear edit.reverse_match_frame para Shift+KeyF");

// Preset 3: Adobe Premiere Pro (KeyF nativa e Shift+KeyE para disable)
KEYMAP_SERVICE.setPreset("premiere");
assert.deepStrictEqual(KEYMAP_PRESETS.premiere["edit.match_frame"], ["KeyF"], "Premiere deve mapear edit.match_frame para KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.premiere["edit.reverse_match_frame"], ["Shift+KeyF"], "Premiere deve mapear edit.reverse_match_frame para Shift+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.premiere["edit.toggle_clip_disable"], ["Shift+KeyE"], "Premiere deve mapear toggle_clip_disable para Shift+KeyE");
assert.ok(KEYMAP_SERVICE.matches({ code: "KeyF", altKey: false, ctrlKey: false, shiftKey: false }, "edit.match_frame"), "KeyF pura deve acionar Match Frame no Premiere");

// Preset 4: DaVinci Resolve (KeyF nativa e KeyD para disable)
KEYMAP_SERVICE.setPreset("resolve");
assert.deepStrictEqual(KEYMAP_PRESETS.resolve["edit.match_frame"], ["KeyF"], "Resolve deve mapear edit.match_frame para KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.resolve["edit.reverse_match_frame"], ["Shift+KeyF"], "Resolve deve mapear edit.reverse_match_frame para Shift+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.resolve["edit.toggle_clip_disable"], ["KeyD"], "Resolve deve mapear toggle_clip_disable para KeyD");

// Preset 5: Apple Final Cut Pro (Shift+KeyF para Match Frame e Alt+KeyF para Reverse)
KEYMAP_SERVICE.setPreset("finalcut");
assert.deepStrictEqual(KEYMAP_PRESETS.finalcut["edit.match_frame"], ["Shift+KeyF"], "FCP deve mapear edit.match_frame para Shift+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.finalcut["edit.reverse_match_frame"], ["Alt+KeyF"], "FCP deve mapear edit.reverse_match_frame para Alt+KeyF");
assert.deepStrictEqual(KEYMAP_PRESETS.finalcut["edit.toggle_clip_disable"], ["KeyV"], "FCP deve mapear toggle_clip_disable para KeyV");
console.log("  ✔ Paridade dos 5 presets NLE validada com sucesso.");

// ── 4. CHEAT SHEET & BADGES HTML ────────────────────────────────────────────
console.log("\n4. Validando renderização dos badges na Cheat Sheet...");
KEYMAP_SERVICE.setPreset("capiau");
const badgesMatch = KEYMAP_SERVICE.getShortcutBadgesHTML("edit.match_frame");
const badgesRevMatch = KEYMAP_SERVICE.getShortcutBadgesHTML("edit.reverse_match_frame");

assert.ok(badgesMatch.includes("Alt + F"), "Badges de edit.match_frame no CapIAu devem conter 'Alt + F'");
assert.ok(badgesRevMatch.includes("Shift + F"), "Badges de edit.reverse_match_frame no CapIAu devem conter 'Shift + F'");
console.log("  ✔ Renderização de badges HTML validada com sucesso.");

// ── 4.1 INTERAÇÃO BIDIRECIONAL DO TECLADO VIRTUAL COM ÍNDICE ESQUEMÁTICO ────
console.log("\n4.1 Validando highlightSchematicItem com prioridade de combinação exata...");
const createMockSchematicItem = (code, combo) => {
    const classes = new Set();
    let scrollCount = 0;
    return {
        dataset: { code, combo },
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        scrollIntoView: () => { scrollCount++; },
        get scrollCount() { return scrollCount; },
        resetScroll: () => { scrollCount = 0; }
    };
};

const itemAltF = createMockSchematicItem("KeyF", "Alt+KeyF"); // Match Frame
const itemShiftF = createMockSchematicItem("KeyF", "Shift+KeyF"); // Reverse Match Frame
const itemKeyF = createMockSchematicItem("KeyF", "KeyF"); // Ativar/Desativar Clipe
const mockItems = [itemAltF, itemShiftF, itemKeyF];

const originalQSA = globalThis.document.querySelectorAll;
globalThis.document.querySelectorAll = (selector) => {
    if (selector === ".vk-schematic-item") return mockItems;
    return typeof originalQSA === "function" ? originalQSA(selector) : [];
};

const { PanelsManager } = await import("../src/ui/js/panels.js");
const pmInstance = Object.create(PanelsManager.prototype);

// Teste A: Inspecionar tecla F na camada Alt (combo "Alt+KeyF")
pmInstance.highlightSchematicItem("KeyF", "Alt+KeyF");
assert.ok(itemAltF.classList.contains("active"), "Item Alt+KeyF (Match Frame) deve ficar ativo");
assert.ok(!itemShiftF.classList.contains("active"), "Item Shift+KeyF NÃO deve ficar ativo");
assert.ok(!itemKeyF.classList.contains("active"), "Item KeyF (Desativar clipe) NÃO deve ficar ativo");
assert.strictEqual(itemAltF.scrollCount, 1, "scrollIntoView deve ser chamado em Alt+KeyF");
assert.strictEqual(itemKeyF.scrollCount, 0, "scrollIntoView NUNCA deve ser chamado em KeyF ao inspecionar Alt+KeyF");

// Teste B: Inspecionar tecla F na camada Shift (combo "Shift+KeyF")
itemAltF.resetScroll();
itemKeyF.resetScroll();
pmInstance.highlightSchematicItem("KeyF", "Shift+KeyF");
assert.ok(!itemAltF.classList.contains("active"), "Item Alt+KeyF NÃO deve ficar ativo");
assert.ok(itemShiftF.classList.contains("active"), "Item Shift+KeyF (Reverse Match Frame) deve ficar ativo");
assert.ok(!itemKeyF.classList.contains("active"), "Item KeyF NÃO deve ficar ativo");

// Teste C: Inspecionar tecla F na camada Padrão (combo "KeyF")
pmInstance.highlightSchematicItem("KeyF", "KeyF");
assert.ok(!itemAltF.classList.contains("active"), "Item Alt+KeyF NÃO deve ficar ativo");
assert.ok(!itemShiftF.classList.contains("active"), "Item Shift+KeyF NÃO deve ficar ativo");
assert.ok(itemKeyF.classList.contains("active"), "Item KeyF (Desativar clipe) deve ficar ativo");

globalThis.document.querySelectorAll = originalQSA;
console.log("  ✔ highlightSchematicItem isola perfeitamente cada combinação sem conflito de foco.");

// ── 5. MATEMÁTICA DO MATCH FRAME (TIMELINE ➔ SOURCE) ────────────────────────
console.log("\n5. Validando Matemática do Match Frame (Timeline ➔ Source)...");
TIMELINE_STATE.fps = 24;

// Mock de mídias na biblioteca
const mockVideo1 = {
    id: "vid_test_01",
    filename: "Entrevista_Diretor.mp4",
    title: "Entrevista Diretor",
    duration: 120.0,
    fps: 24
};
STATE.allVideos = [mockVideo1];
STATE.allPhotos = [];

// Corte montado na timeline:
// timelineStartFrame = 120 (5.0s na timeline)
// inFrame = 240 (10.0s na mídia bruta)
// outFrame = 480 (20.0s na mídia bruta, duração = 240 frames = 10s)
const testCut1 = {
    id: "cut_01",
    type: "video",
    video_id: "vid_test_01",
    timelineStartFrame: 120,
    timeline_start: 5.0,
    inFrame: 240,
    in: 10.0,
    outFrame: 480,
    out: 20.0,
    track: "V1"
};
STATE.activeTimelineCuts = [testCut1];

// Posiciona o playhead no frame 168 (2.0s após o início do clipe na timeline)
// offsetFrames = 168 - 120 = 48 frames
// sourceFrame esperado = inFrame + offsetFrames = 240 + 48 = 288 frames
// sourceTime esperado = 288 / 24 = 12.0s
TIMELINE_STATE.setPlayheadFrame(168);
TIMELINE_STATE.selectedTrack = "V1";

const matchResult = player.matchFrameFromTimeline();
assert.ok(matchResult, "matchFrameFromTimeline() deve retornar resultado válido");
assert.strictEqual(matchResult.sourceFrame, 288, "sourceFrame deve ser exatamente 288 frames");
assert.strictEqual(matchResult.sourceTime, 12.0, "sourceTime deve ser exatamente 12.0 segundos");
assert.strictEqual(STATE.markerIn, 10.0, "STATE.markerIn deve ser projetado para 10.0s (inFrame / fps)");
assert.strictEqual(STATE.markerOut, 20.0, "STATE.markerOut deve ser projetado para 20.0s (outFrame / fps)");
assert.strictEqual(STATE.activeVideo.id, "vid_test_01", "STATE.activeVideo deve ser o vídeo original");
assert.strictEqual(window.activeFocusedPlayer, "source", "Foco ativo deve ser transferido para o Source Player");
console.log("  ✔ Conversão matemática e projeção de marcadores IN/OUT validadas com sucesso.");

// ── 6. HIERARQUIA DE PISTAS NO MATCH FRAME ──────────────────────────────────
console.log("\n6. Validando Hierarquia de Pistas no Match Frame (selectedTrack e V2 > V1)...");

const mockVideo2 = {
    id: "vid_test_02",
    filename: "Broll_Cena.mp4",
    title: "B-Roll Cena",
    duration: 60.0,
    fps: 24
};
STATE.allVideos.push(mockVideo2);

// Adiciona um clipe na pista V2 sobrepondo o mesmo intervalo
const testCut2 = {
    id: "cut_02_v2",
    type: "video",
    video_id: "vid_test_02",
    timelineStartFrame: 100,
    timeline_start: 100 / 24,
    inFrame: 0,
    in: 0,
    outFrame: 200,
    out: 200 / 24,
    track: "V2"
};
STATE.activeTimelineCuts = [testCut1, testCut2];

// Caso A: Sem pista selecionada (selectedTrack = null) -> Deve priorizar V2 sobre V1
TIMELINE_STATE.selectedTrack = null;
TIMELINE_STATE.setPlayheadFrame(150);
const resTopTrack = player.matchFrameFromTimeline();
assert.strictEqual(resTopTrack.clip.track, "V2", "Sem selectedTrack, deve priorizar a pista superior de vídeo (V2)");
assert.strictEqual(resTopTrack.media.id, "vid_test_02", "Deve carregar o vídeo da pista superior V2");

// Caso B: Pista V1 selecionada explicitamente -> Deve priorizar V1 mesmo com V2 por cima
TIMELINE_STATE.selectedTrack = "V1";
const resSelectedTrack = player.matchFrameFromTimeline();
assert.strictEqual(resSelectedTrack.clip.track, "V1", "Com selectedTrack = V1, deve respeitar a pista selecionada");
assert.strictEqual(resSelectedTrack.media.id, "vid_test_01", "Deve carregar o vídeo da pista selecionada V1");
console.log("  ✔ Hierarquia de pistas (selectedTrack e V2 sobre V1) validada com sucesso.");

// ── 7. FALLBACK DE GAP VAZIO E MÍDIA AUSENTE ────────────────────────────────
console.log("\n7. Validando Fallbacks de Gap Vazio e Mídia Ausente...");

// Playhead em gap vazio (frame 5000 onde não há cortes)
TIMELINE_STATE.setPlayheadFrame(5000);
lastToastMessage = "";
const resGap = player.matchFrameFromTimeline();
assert.strictEqual(resGap, null, "Match Frame em gap vazio deve retornar null");
assert.ok(lastToastMessage.includes("Nenhum clipe"), "Deve exibir toast de nenhum clipe sob a agulha");

// Corte com ID de mídia inexistente na biblioteca
const orphanCut = {
    id: "cut_orphan",
    type: "video",
    video_id: "id_inexistente_999",
    timelineStartFrame: 6000,
    inFrame: 0,
    outFrame: 100,
    track: "V1"
};
STATE.activeTimelineCuts.push(orphanCut);
TIMELINE_STATE.setPlayheadFrame(6050);
lastToastMessage = "";
const resOrphan = player.matchFrameFromTimeline();
assert.strictEqual(resOrphan, null, "Match Frame com mídia inexistente deve retornar null");
assert.ok(lastToastMessage.includes("não encontrado"), "Deve exibir toast de mídia não encontrada");
console.log("  ✔ Fallbacks para gap vazio e mídia ausente validados com sucesso.");

// ── 8. MATEMÁTICA DO REVERSE MATCH FRAME (SOURCE ➔ TIMELINE) ────────────────
console.log("\n8. Validando Matemática do Reverse Match Frame (Source ➔ Timeline)...");

// Limpa cortes órfãos
STATE.activeTimelineCuts = [testCut1]; // testCut1: start=120, in=240, out=480
STATE.activeVideo = mockVideo1; // vid_test_01
mockVideoElement.currentTime = 12.0; // 12.0s * 24fps = 288 frames
// targetPlayheadFrame = timelineStartFrame + (sourceFrame - inFrame) = 120 + (288 - 240) = 168

TIMELINE_STATE.setPlayheadFrame(0);
const revResult = player.reverseMatchFrameFromSource();
assert.ok(revResult, "reverseMatchFrameFromSource() deve retornar resultado válido");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 168, "Playhead da timeline deve saltar para exatamente 168 frames");
assert.strictEqual(TIMELINE_STATE.selectedClipId, "cut_01", "Corte correspondente deve ser selecionado na timeline");
assert.strictEqual(window.activeFocusedPlayer, "program", "Foco ativo deve ser transferido para o Program Player / Timeline");
console.log("  ✔ Reverse Match Frame temporalmente calibrado e seleção confirmada.");

// ── 9. MÚLTIPLAS OCORRÊNCIAS NO REVERSE MATCH FRAME ─────────────────────────
console.log("\n9. Validando Desempate por Proximidade em Múltiplas Ocorrências...");

// Adiciona uma segunda ocorrência do mesmo trecho do vídeo mais adiante na timeline
// Cut A: timeline 120..360, in=240..480 (target para frame 288 = 168)
// Cut B: timeline 1000..1240, in=240..480 (target para frame 288 = 1048)
const testCut1Duplicate = {
    id: "cut_01_segunda_ocorrencia",
    type: "video",
    video_id: "vid_test_01",
    timelineStartFrame: 1000,
    inFrame: 240,
    outFrame: 480,
    track: "V1"
};
STATE.activeTimelineCuts = [testCut1, testCut1Duplicate];
mockVideoElement.currentTime = 12.0; // frame 288

// Cenário A: Agulha da timeline está no frame 950 (mais perto do Cut B: 1048 que do Cut A: 168)
TIMELINE_STATE.setPlayheadFrame(950);
const resCloseToB = player.reverseMatchFrameFromSource();
assert.strictEqual(resCloseToB.clip.id, "cut_01_segunda_ocorrencia", "Deve saltar para o Cut B (mais próximo de 950)");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 1048, "Playhead deve saltar para 1048");

// Cenário B: Agulha da timeline está no frame 200 (mais perto do Cut A: 168)
TIMELINE_STATE.setPlayheadFrame(200);
const resCloseToA = player.reverseMatchFrameFromSource();
assert.strictEqual(resCloseToA.clip.id, "cut_01", "Deve saltar para o Cut A (mais próximo de 200)");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 168, "Playhead deve saltar para 168");
console.log("  ✔ Desempate inteligente de ocorrências por proximidade validado com sucesso.");

// ── 10. REVERSE MATCH FRAME NÃO ENCONTRADO ──────────────────────────────────
console.log("\n10. Validando Reverse Match Frame quando quadro não é usado na timeline...");

// Vídeo na fonte está no segundo 50 (frame 1200), fora de qualquer corte montado
mockVideoElement.currentTime = 50.0;
lastToastMessage = "";
const resNotFound = player.reverseMatchFrameFromSource();
assert.strictEqual(resNotFound, null, "Quadro não utilizado deve retornar null");
assert.ok(lastToastMessage.includes("Quadro não localizado"), "Deve exibir toast amigável 'Quadro não localizado na timeline ativa'");

// Sem mídia no Source Player
STATE.activeVideo = null;
STATE.activePhoto = null;
lastToastMessage = "";
const resNoMedia = player.reverseMatchFrameFromSource();
assert.strictEqual(resNoMedia, null, "Sem mídia no Source deve retornar null");
assert.ok(lastToastMessage.includes("Nenhuma mídia carregada"), "Deve alertar que não há mídia no Source");
console.log("  ✔ Fallbacks de Reverse Match Frame validados com sucesso.");

// ── 11. SINCRONIZAÇÃO DE EVENTOS & MULTI-MONITOR (DIRETRIZ 6) ────────────────
console.log("\n11. Validando Emissão de Eventos para Multi-Monitor / Popout...");

let eventMatchFired = false;
let eventRevMatchFired = false;

STATE.on("matchFramePerformed", (payload) => {
    eventMatchFired = true;
    assert.strictEqual(payload.sourceFrame, 288);
});

STATE.on("reverseMatchFramePerformed", (payload) => {
    eventRevMatchFired = true;
    assert.strictEqual(payload.targetPlayheadFrame, 168);
});

// Executa Match Frame
STATE.allVideos = [mockVideo1];
STATE.activeTimelineCuts = [testCut1];
TIMELINE_STATE.setPlayheadFrame(168);
player.matchFrameFromTimeline();
assert.ok(eventMatchFired, "Evento 'matchFramePerformed' deve ser emitido via STATE");

// Executa Reverse Match Frame
mockVideoElement.currentTime = 12.0;
player.reverseMatchFrameFromSource();
assert.ok(eventRevMatchFired, "Evento 'reverseMatchFramePerformed' deve ser emitido via STATE");
STATE.listeners = {};
console.log("  ✔ Barramento de eventos multi-monitor validado com sucesso.");

// ── 12. MÚLTIPLAS OCORRÊNCIAS & CICLO CONTÍNUO (REVERSE MATCH FRAME) ────────
console.log("\n12. Validando Múltiplas Ocorrências & Ciclo Contínuo de Reverse Match Frame...");

assert.ok(indexContent.includes('id="source-reverse-match-hud"'), "index.html deve conter #source-reverse-match-hud");
assert.ok(indexContent.includes('id="hud-reverse-match-prev"'), "index.html deve conter #hud-reverse-match-prev");
assert.ok(indexContent.includes('id="hud-reverse-match-info"'), "index.html deve conter #hud-reverse-match-info");
assert.ok(indexContent.includes('id="hud-reverse-match-next"'), "index.html deve conter #hud-reverse-match-next");
assert.ok(indexContent.includes('id="hud-reverse-match-list"'), "index.html deve conter #hud-reverse-match-list");
assert.ok(indexContent.includes('id="badge-source-reverse-match"'), "index.html deve conter #badge-source-reverse-match");
assert.ok(indexContent.includes('id="popover-reverse-match-list"'), "index.html deve conter #popover-reverse-match-list");

// Configura 3 ocorrências da mesma mídia na timeline:
// Cut 1: Track V1 (track: 0), timelineStart: 0, in: 0, out: 100
// Cut 2: Track V2 (track: 1), timelineStart: 300, in: 50, out: 150
// Cut 3: Track V1 (track: 0), timelineStart: 600, in: 80, out: 180
const multiCut1 = {
    id: "cut_inst_1",
    video_id: "vid_test_01",
    name: "Take 1 - A",
    timelineStartFrame: 0,
    timelineEndFrame: 100,
    inFrame: 0,
    outFrame: 100,
    track: 0,
    trackName: "V1"
};
const multiCut2 = {
    id: "cut_inst_2",
    video_id: "vid_test_01",
    name: "Take 1 - B (Inserto V2)",
    timelineStartFrame: 300,
    timelineEndFrame: 400,
    inFrame: 50,
    outFrame: 150,
    track: 1,
    trackName: "V2"
};
const multiCut3 = {
    id: "cut_inst_3",
    video_id: "vid_test_01",
    name: "Take 1 - C",
    timelineStartFrame: 600,
    timelineEndFrame: 700,
    inFrame: 80,
    outFrame: 180,
    track: 0,
    trackName: "V1"
};

STATE.activeVideo = mockVideo1;
STATE.activeTimelineCuts = [multiCut1, multiCut2, multiCut3];

// Source frame = 90 (sourceTime = 90 / 24 = 3.75s)
// Está dentro de:
// Cut 1: [0, 100) -> Target Playhead: 0 + (90 - 0) = 90
// Cut 2: [50, 150) -> Target Playhead: 300 + (90 - 50) = 340
// Cut 3: [80, 180) -> Target Playhead: 600 + (90 - 80) = 610
mockVideoElement.currentTime = 3.75;
TIMELINE_STATE.setPlayheadFrame(0); // Mais perto de 90 (Cut 1)
player._reverseMatchSession = null;

// 1º disparo: deve selecionar o Cut 1 (mais próximo de 0) e criar a sessão com currentIndex = 0
const match1 = player.reverseMatchFrameFromSource(1);
assert.ok(match1, "1º disparo deve retornar ocorrência válida");
assert.strictEqual(match1.clip.id, "cut_inst_1", "1º disparo deve saltar para Cut 1");
assert.strictEqual(match1.currentIndex, 0, "currentIndex deve ser 0");
assert.strictEqual(match1.totalOccurrences, 3, "totalOccurrences deve ser 3");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 90, "Playhead deve ser 90");

// Verifica atualização do badge e HUD
const badgeEl = document.getElementById("badge-source-reverse-match");
assert.strictEqual(badgeEl.textContent, "3", "Badge deve indicar 3 ocorrências");
assert.strictEqual(badgeEl.style.display, "inline-flex", "Badge deve estar visível");

const hudEl = document.getElementById("source-reverse-match-hud");
assert.strictEqual(hudEl.style.display, "flex", "HUD deve estar visível");
assert.strictEqual(hudEl.classList.contains("is-hidden"), false, "HUD não deve ter classe is-hidden");

const infoEl = document.getElementById("hud-reverse-match-info");
assert.ok(infoEl.textContent.includes("1/3"), "HUD deve informar 1/3");
assert.ok(infoEl.textContent.includes("V1"), "HUD deve informar faixa V1");

// 2º disparo: ciclo contínuo avançando para a 2ª ocorrência (Cut 2 em V2)
const match2 = player.reverseMatchFrameFromSource(1);
assert.strictEqual(match2.clip.id, "cut_inst_2", "2º disparo deve saltar para Cut 2");
assert.strictEqual(match2.currentIndex, 1, "currentIndex deve ser 1");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 340, "Playhead deve ser 340");
assert.ok(infoEl.textContent.includes("2/3"), "HUD deve informar 2/3");
assert.ok(infoEl.textContent.includes("V2"), "HUD deve informar faixa V2");

// 3º disparo: avança para a 3ª ocorrência (Cut 3 em V1)
const match3 = player.reverseMatchFrameFromSource(1);
assert.strictEqual(match3.clip.id, "cut_inst_3", "3º disparo deve saltar para Cut 3");
assert.strictEqual(match3.currentIndex, 2, "currentIndex deve ser 2");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 610, "Playhead deve ser 610");
assert.ok(infoEl.textContent.includes("3/3"), "HUD deve informar 3/3");

// 4º disparo: fechamento de ciclo (volta para a 1ª ocorrência Cut 1)
const match4 = player.reverseMatchFrameFromSource(1);
assert.strictEqual(match4.clip.id, "cut_inst_1", "4º disparo deve fechar o ciclo e voltar ao Cut 1");
assert.strictEqual(match4.currentIndex, 0, "currentIndex deve reiniciar em 0");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 90, "Playhead deve retornar a 90");

// 5º disparo com direção reversa (direction = -1): deve saltar para a 3ª ocorrência
const matchRev = player.reverseMatchFrameFromSource(-1);
assert.strictEqual(matchRev.clip.id, "cut_inst_3", "Salto reverso deve ir para Cut 3");
assert.strictEqual(matchRev.currentIndex, 2, "currentIndex deve ser 2");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 610, "Playhead deve ser 610");

// 6º Validação do Popover Dropdown
player.toggleReverseMatchPopover();
const popoverEl = document.getElementById("popover-reverse-match-list");
assert.strictEqual(popoverEl.style.display, "flex", "Popover deve abrir em display: flex");
assert.strictEqual(popoverEl.children.length, 4, "Popover deve ter 1 header + 3 itens de corte");

// Salto direto pelo índice no popover
player._jumpToReverseMatchIndex(1);
assert.strictEqual(TIMELINE_STATE.playheadFrame, 340, "Salto direto pelo índice 1 deve posicionar em 340 (Cut 2)");

player.closeReverseMatchPopover();
assert.strictEqual(popoverEl.style.display, "none", "Fechar popover deve definir display: none");

// 7º Validação do fechamento instantâneo do HUD ao soltar Shift (keyup)
player._isShiftKeyDown = true;
player.handleGlobalKeyUp({ key: "Shift", shiftKey: false });
assert.strictEqual(player._isShiftKeyDown, false, "_isShiftKeyDown deve ser false");
assert.ok(hudEl.classList.contains("is-hidden"), "HUD deve receber classe is-hidden ao soltar Shift");

// 8º Validação de Deduplicação de Pares A/V Vinculados (link_id):
// Adiciona pares de áudio correspondentes para cada corte de vídeo na timeline (A1 e A2)
const audioCut1 = {
    id: "cut_inst_1_audio",
    video_id: "vid_test_01",
    name: "Take 1 - A (Áudio)",
    timelineStartFrame: 0,
    timelineEndFrame: 100,
    inFrame: 0,
    outFrame: 100,
    track: "A1",
    trackName: "A1",
    link_id: "link_cut_1",
    isAudio: true
};
multiCut1.link_id = "link_cut_1";

const audioCut2 = {
    id: "cut_inst_2_audio",
    video_id: "vid_test_01",
    name: "Take 1 - B (Áudio)",
    timelineStartFrame: 300,
    timelineEndFrame: 400,
    inFrame: 50,
    outFrame: 150,
    track: "A2",
    trackName: "A2",
    link_id: "link_cut_2",
    isAudio: true
};
multiCut2.link_id = "link_cut_2";

const audioCut3 = {
    id: "cut_inst_3_audio",
    video_id: "vid_test_01",
    name: "Take 1 - C (Áudio)",
    timelineStartFrame: 600,
    timelineEndFrame: 700,
    inFrame: 80,
    outFrame: 180,
    track: "A1",
    trackName: "A1",
    link_id: "link_cut_3",
    isAudio: true
};
multiCut3.link_id = "link_cut_3";

STATE.activeTimelineCuts = [multiCut1, audioCut1, multiCut2, audioCut2, multiCut3, audioCut3];
player._reverseMatchSession = null;
mockVideoElement.currentTime = 3.75;
TIMELINE_STATE.setPlayheadFrame(0);

const matchDedup = player.reverseMatchFrameFromSource(1);
assert.strictEqual(matchDedup.totalOccurrences, 3, "Deve contabilizar exatamente 3 ocorrências (ignorando as faixas de áudio duplicadas dos pares vinculados)");
assert.strictEqual(badgeEl.textContent, "3", "Badge deve continuar indicando 3 ocorrências e não 6");
assert.strictEqual(matchDedup.clip.id, "cut_inst_1", "Deve selecionar o corte de vídeo e não o de áudio");

console.log("  ✔ Ciclo contínuo, Mini-HUD flutuante, badge contador, popover e deduplicação A/V validados com sucesso.");

console.log("\n🎉 TODOS OS 12 BLOCOS DE TESTE DA TASK 8 PASSARAM COM 100% DE SUCESSO!");
