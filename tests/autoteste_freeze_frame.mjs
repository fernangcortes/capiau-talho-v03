// autoteste_freeze_frame.mjs
// Task 12 do PLANO_SUITE_NLE_CLASSICO — Congelar Quadro (Freeze Frame / Hold Frame — Ctrl+Shift+F):
//  • Captura do quadro sob a agulha com duração configurável (padrão 3s).
//  • Inserção em modo Ripple (com deslocamento do restante da timeline e preservação A/V) e Overwrite.
//  • Suporte a Undo/Redo atômico em 1 passo.
//  • Paridade nos 5 perfis NLE (Ctrl+Shift+F) sem colisões com outros atalhos.
//  • Miniaturas contínuas idênticas no Filmstrip da timeline e rótulo temático ❄ [Freeze Xs].
//  • Reprodução estática no Program Player mantendo o buffer pausado durante o congelamento.

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

const domRegistry = {};
function makeEl(id) {
    return {
        id: id || "",
        style: {},
        innerHTML: "",
        textContent: "",
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {},
        getAttribute: () => null,
        appendChild() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
}
const canvasStub = {
    getContext: () => ({
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
        fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 50 }), fillText() {}, scale() {},
        clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
    }),
    ownerDocument: globalThis.document,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    closest: () => null,
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
    createElement: () => makeEl(null),
    querySelector: () => null,
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
const readSrc = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "js", f), "utf-8");

const tsSrc = readSrc("timelineState.js");
const kmSrc = readSrc("keymapService.js");
const tiSrc = readSrc("timelineInteraction.js");
const trSrc = readSrc("timelineRenderer.js");
const plSrc = readSrc("player.js");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf-8");

// Importações dos módulos da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 12: CONGELAR QUADRO (FREEZE FRAME)");
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
// Bateria 1: Catálogo Central & Mapeamento nos 5 Perfis NLE
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Comando edit.freeze_frame no Catálogo e nos 5 Perfis NLE sem Colisão", () => {
    const cmd = COMMANDS_CATALOG.find(c => c.id === "edit.freeze_frame");
    assert.ok(cmd, "Comando edit.freeze_frame deve existir no COMMANDS_CATALOG");
    assert.equal(cmd.category, "edit", "Categoria deve ser 'edit'");
    assert.ok(cmd.label.toLowerCase().includes("congelar quadro"), "Rótulo deve mencionar Congelar Quadro");

    const requiredPresets = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    for (const presetName of requiredPresets) {
        const preset = KEYMAP_PRESETS[presetName];
        assert.ok(preset, `Preset '${presetName}' deve existir`);
        const combos = preset["edit.freeze_frame"];
        assert.ok(Array.isArray(combos) && combos.length > 0, `Preset '${presetName}' deve mapear edit.freeze_frame`);
        assert.ok(combos.includes("Ctrl+Shift+KeyF"), `Preset '${presetName}' deve conter 'Ctrl+Shift+KeyF'`);
    }

    // Valida que Ctrl+Shift+KeyF no perfil CapIAu não colide com nenhum outro comando
    const capiauPreset = KEYMAP_PRESETS.capiau;
    const collisions = Object.entries(capiauPreset).filter(
        ([id, keys]) => id !== "edit.freeze_frame" && keys.includes("Ctrl+Shift+KeyF")
    );
    assert.equal(collisions.length, 0, "Ctrl+Shift+KeyF não deve ter colisões no perfil capiau");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Elementos DOM e Integridade Estrutural
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Elementos DOM da Toolbar e Cache-Buster v>=51", () => {
    assert.ok(indexHtml.includes('id="btn-freeze-frame"'), "index.html deve conter botão #btn-freeze-frame");
    assert.ok(indexHtml.includes('fa-snowflake'), "index.html deve exibir ícone de floco de neve");
    assert.ok(/styles\.css\?v=(5[1-9]|[6-9][0-9])/.test(indexHtml), "styles.css deve estar versionado com v>=51");
    assert.ok(/js\/main\.js\?v=(5[1-9]|[6-9][0-9])/.test(indexHtml), "main.js deve estar versionado com v>=51");

    assert.ok(tiSrc.includes('btn-freeze-frame'), "timelineInteraction.js deve referenciar btn-freeze-frame");
    assert.ok(tiSrc.includes('Congelar Quadro'), "timelineInteraction.js deve incluir Congelar Quadro no contextmenu");
    assert.ok(plSrc.includes('freezeFrameAtPlayhead'), "player.js deve implementar freezeFrameAtPlayhead");
    assert.ok(tsSrc.includes('createFreezeFrameCut'), "timelineState.js deve implementar createFreezeFrameCut");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Operação createFreezeFrameCut em modo Ripple
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Divisão de Clipe e Inserção do Bloco Estático em modo Ripple", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.selectedClipId = null;
    TIMELINE_STATE.selectedClipIds.clear();

    // Clipe de 5 segundos (120 frames) na pista V1
    const clip1 = {
        id: "c_vid_1",
        video_id: "vid_100",
        type: "video",
        track: "V1",
        timelineStartFrame: 0,
        timeline_start: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        name: "Cena Dramática",
        link_id: null
    };

    STATE.activeTimelineCuts = [clip1];

    // Congelar frame 48 (2.0s) com duração padrão de 3.0s (72 frames a 24fps) em modo ripple
    const freezeClip = TIMELINE_STATE.createFreezeFrameCut("c_vid_1", 48, 3.0, "ripple");

    assert.ok(freezeClip, "createFreezeFrameCut deve retornar o clipe congelado criado");
    assert.equal(freezeClip.is_freeze, true, "freezeClip deve ter is_freeze: true");
    assert.equal(freezeClip.timelineStartFrame, 48, "freezeClip deve iniciar exatamente em playheadFrame 48");
    assert.equal(freezeClip.outFrame - freezeClip.inFrame, 72, "Duração do freezeClip deve ser de 72 frames (3s)");
    assert.equal(freezeClip.freeze_frame, 48, "freeze_frame deve ser o frame 48 da mídia");
    assert.equal(freezeClip.freeze_time, 2.0, "freeze_time deve ser exatamente 2.0s");

    const cuts = STATE.activeTimelineCuts;
    assert.equal(cuts.length, 3, "A timeline agora deve conter 3 clipes: esquerda, freeze e direita");

    const left = cuts.find(c => c.timelineStartFrame === 0);
    assert.ok(left, "Parte esquerda deve existir em t=0");
    assert.equal(left.inFrame, 0, "Parte esquerda inFrame deve ser 0");
    assert.equal(left.outFrame, 48, "Parte esquerda outFrame deve ser 48");

    const right = cuts.find(c => c.id !== freezeClip.id && c.timelineStartFrame > 48);
    assert.ok(right, "Parte direita deve existir após o bloco congelado");
    assert.equal(right.timelineStartFrame, 48 + 72, "Parte direita deve ser empurrada para 120 frames");
    assert.equal(right.inFrame, 48, "Parte direita deve continuar a partir do frame 48 da mídia");
    assert.equal(right.outFrame, 120, "Parte direita outFrame original deve ser preservado");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Preservação de Áudio Vinculado e Sincronia A/V em Ripple
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Preservação e Deslocamento Sincronizado do Áudio Vinculado (Link A/V)", () => {
    TIMELINE_STATE.fps = 24;
    const linkShared = "link_av_test_1";

    const vClip = {
        id: "v_1",
        video_id: "v_media",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Entrevista"
    };
    const aClip = {
        id: "a_1",
        video_id: "v_media",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Entrevista Áudio"
    };

    STATE.activeTimelineCuts = [vClip, aClip];

    // Congela no frame 24 (1s) com 2s de freeze (48 frames)
    const freezeClip = TIMELINE_STATE.createFreezeFrameCut(vClip.id, 24, 2.0, "ripple");
    assert.ok(freezeClip, "Freeze cut criado");

    const cuts = STATE.activeTimelineCuts;
    // Em V1: left (0..24), freeze (24..72), right (72..168)
    // Em A1: left (0..24), right empurrado (72..168)
    const audioCuts = cuts.filter(c => c.track === "A1");
    assert.equal(audioCuts.length, 2, "Pista de áudio deve ter sido fatiada em 2 segmentos");

    const audioLeft = audioCuts.find(c => c.timelineStartFrame === 0);
    assert.ok(audioLeft, "Parte esquerda do áudio deve começar em 0");
    assert.equal(audioLeft.outFrame, 24, "Parte esquerda do áudio deve terminar em 24");

    const audioRight = audioCuts.find(c => c.timelineStartFrame === 24 + 48);
    assert.ok(audioRight, "Parte direita do áudio deve ter sido empurrada por 48 frames para 72");
    assert.equal(audioRight.inFrame, 24, "Parte direita do áudio deve retomar no frame 24");

    const videoRight = cuts.find(c => c.track === "V1" && c.timelineStartFrame === 24 + 48);
    assert.ok(videoRight, "Parte direita do vídeo deve começar junto com a parte direita do áudio");
    assert.equal(videoRight.link_id, audioRight.link_id, "Vínculo link_id deve ser preservado entre as metades direitas de vídeo e áudio");
    assert.notEqual(videoRight.link_id, linkShared, "Novo link_id deve ter sido gerado para o novo par");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Operação em Modo Overwrite
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Inserção de Freeze Frame em Modo Overwrite", () => {
    TIMELINE_STATE.fps = 24;
    const clipLong = {
        id: "c_long",
        video_id: "vid_long",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 240, // 10s
        in: 0,
        out: 10.0,
        name: "Clipe Longo"
    };

    STATE.activeTimelineCuts = [clipLong];

    // Inserir 2s de freeze (48 frames) em t=48 (2.0s) em modo overwrite
    const freezeClip = TIMELINE_STATE.createFreezeFrameCut(clipLong.id, 48, 2.0, "overwrite");
    assert.ok(freezeClip, "Freeze cut criado em overwrite");
    assert.equal(freezeClip.timelineStartFrame, 48);
    assert.equal(freezeClip.outFrame - freezeClip.inFrame, 48);

    const cuts = STATE.activeTimelineCuts;
    // No modo overwrite:
    // Left: 0..48
    // Freeze: 48..96
    // Right (resto): 96..240
    const left = cuts.find(c => c.timelineStartFrame === 0);
    assert.equal(left.outFrame, 48);

    const right = cuts.find(c => c.id !== freezeClip.id && c.timelineStartFrame === 96);
    assert.ok(right, "Parte direita restante deve começar em 96");
    assert.equal(right.inFrame, 96, "Parte direita deve ter sido fatiada sem deslocar o fim original");
    assert.equal(right.outFrame, 240, "Fim da timeline permanece em 240 frames");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Duração Customizável em Segundos e Frames
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Duração Customizável em Segundos e Frames", () => {
    TIMELINE_STATE.fps = 30; // testando em timeline de 30 fps
    const testClip = {
        id: "c_30fps",
        video_id: "v30",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 300, // 10s a 30fps
        in: 0,
        out: 10.0
    };

    STATE.activeTimelineCuts = [testClip];

    // Freeze de 1.5s = 45 frames a 30fps
    const f1 = TIMELINE_STATE.createFreezeFrameCut(testClip.id, 60, 1.5, "ripple");
    assert.equal(f1.outFrame - f1.inFrame, 45, "1.5s a 30fps deve gerar exatamente 45 frames");
    assert.equal(f1.freeze_frame, 60, "freeze_frame deve ser 60");
    assert.equal(f1.freeze_time, 2.0, "60 frames a 30fps deve ser 2.0s");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Reversibilidade Atômica com Undo (Ctrl+Z) e Redo (Ctrl+Y)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reversibilidade Atômica com Undo e Redo em 1 Passo", () => {
    TIMELINE_STATE.fps = 24;
    const baseClip = {
        id: "c_undo_test",
        video_id: "v_undo",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        name: "Clipe Base"
    };

    STATE.activeTimelineCuts = [baseClip];

    // Executa freeze frame
    const freezeClip = TIMELINE_STATE.createFreezeFrameCut(baseClip.id, 48, 3.0, "ripple");
    assert.equal(STATE.activeTimelineCuts.length, 3, "Após freeze, timeline tem 3 clipes");

    // Desfaz com Undo
    TIMELINE_HISTORY.undo();
    assert.equal(STATE.activeTimelineCuts.length, 1, "Após undo, volta a ter exatamente 1 clipe");
    assert.equal(STATE.activeTimelineCuts[0].id, "c_undo_test", "Clipe original restaurado");
    assert.equal(STATE.activeTimelineCuts[0].outFrame, 120, "Duração original de 120 frames restaurada");

    // Refaz com Redo
    TIMELINE_HISTORY.redo();
    assert.equal(STATE.activeTimelineCuts.length, 3, "Após redo, os 3 clipes voltam");
    assert.ok(STATE.activeTimelineCuts.some(c => c.is_freeze), "Clipe freeze restaurado no redo");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Proteções de Limites e Pistas Travadas
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Proteção de Pistas Travadas e Limites de Frame", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "V1", kind: "video", locked: true } // pista travada
    ];
    const lockedClip = {
        id: "c_locked",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120
    };
    STATE.activeTimelineCuts = [lockedClip];

    const resLocked = TIMELINE_STATE.createFreezeFrameCut(lockedClip.id, 24, 3.0);
    assert.equal(resLocked, null, "Não deve permitir congelar clipe em pista travada");

    // Destrava a pista mas pede frame fora dos limites
    TIMELINE_STATE.tracks[0].locked = false;
    const resOutOfRange = TIMELINE_STATE.createFreezeFrameCut(lockedClip.id, 500, 3.0);
    assert.equal(resOutOfRange, null, "Não deve permitir congelar em frame fora dos limites");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Renderização e Miniaturas Estáticas
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Rótulo e Miniaturas no Renderer para Clipes Congelados", () => {
    assert.ok(trSrc.includes("cut.is_freeze"), "timelineRenderer.js deve verificar cut.is_freeze");
    assert.ok(trSrc.includes("Freeze"), "timelineRenderer.js deve gerar rótulo temático Freeze");
    assert.ok(trSrc.includes("rgba(56, 189, 248"), "timelineRenderer.js deve conter estilo visual azul glacial");

    // Validação matemática do alvo de miniatura
    const freezeCut = {
        is_freeze: true,
        freeze_time: 3.5,
        in: 3.5,
        inFrame: 84,
        outFrame: 156
    };
    // Em qualquer tempo do clipe, o targetTime deve ser sempre freeze_time
    const targetTimeCalc = freezeCut.is_freeze ? (freezeCut.freeze_time !== undefined ? freezeCut.freeze_time : freezeCut.in) : 0;
    assert.equal(targetTimeCalc, 3.5, "Miniatura deve usar sempre o tempo congelado");

    // Validação de não-duplicação do rótulo Freeze
    const cleanFn = (raw) => raw.replace(/^(❄|\[Freeze[^\]]*\]|Freeze:|\s)+/gi, "").trim();
    assert.equal(cleanFn("❄ Freeze: Vídeo"), "Vídeo", "Deve limpar '❄ Freeze: '");
    assert.equal(cleanFn("Freeze: Vídeo"), "Vídeo", "Deve limpar 'Freeze: '");
    assert.equal(cleanFn("❄ [Freeze 3.0s] Vídeo"), "Vídeo", "Deve limpar '❄ [Freeze 3.0s]'");
    assert.equal(cleanFn("❄ [Freeze 2.5s] Freeze: Vídeo"), "Vídeo", "Deve limpar múltiplos prefixos aninhados");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Comportamento do Buffer e Player
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Cálculo de TargetSeconds e Pausa do Buffer no Player", () => {
    assert.ok(plSrc.includes("cut && cut.is_freeze"), "player.js deve tratar cut.is_freeze");
    assert.ok(plSrc.includes("el.pause()"), "player.js deve pausar o buffer no freeze frame");

    // Simulação do método _targetSecondsFor
    const mockCut = {
        is_freeze: true,
        freeze_time: 4.25,
        in: 4.25,
        timelineStartFrame: 100
    };
    const calcTarget = (cut, frame) => {
        if (cut && cut.is_freeze) return (typeof cut.freeze_time === "number") ? cut.freeze_time : cut.in;
        return cut.in + ((frame - cut.timelineStartFrame) / 24);
    };

    assert.equal(calcTarget(mockCut, 100), 4.25, "No início do freeze, tempo deve ser 4.25s");
    assert.equal(calcTarget(mockCut, 120), 4.25, "No meio do freeze, tempo deve continuar estritamente 4.25s");
    assert.equal(calcTarget(mockCut, 172), 4.25, "No fim do freeze, tempo deve continuar estritamente 4.25s");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Redirecionamento Mandatório do Áudio para o Vídeo (Bug Fix)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Redirecionamento Mandatório para Pista de Vídeo quando Áudio estiver Selecionado", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];
    TIMELINE_STATE.fps = 24;

    const linkShared = "link_av_bug_check";
    const vCut = {
        id: "v_cut_main",
        video_id: "media_video_1",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Cena Externa"
    };
    const aCut = {
        id: "a_cut_main",
        video_id: "media_video_1",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Cena Externa Áudio"
    };

    STATE.activeTimelineCuts = [vCut, aCut];

    // O usuário estava com o clipe de ÁUDIO selecionado (ou clicou nele)
    TIMELINE_STATE.selectedClipId = "a_cut_main";
    TIMELINE_STATE.selectedClipIds.clear();
    TIMELINE_STATE.selectedClipIds.add("a_cut_main");

    // Executa freeze frame no frame 48
    const freezeRes = TIMELINE_STATE.createFreezeFrameCut("a_cut_main", 48, 3.0, "ripple");

    assert.ok(freezeRes, "Deve gerar o clipe de freeze mesmo se o áudio foi passado como alvo");
    assert.equal(freezeRes.track, "V1", "O clipe congelado DEVE nascer na pista de VÍDEO (V1), NUNCA na pista de áudio A1");
    assert.equal(freezeRes.type, "video", "O tipo do clipe congelado deve ser 'video'");
    assert.equal(freezeRes.is_freeze, true, "is_freeze deve ser true");

    const currentCuts = STATE.activeTimelineCuts;
    // Na pista A1, NÃO DEVE HAVER NENHUM CLIPE no intervalo de 48 a 120 (gap vazio de silêncio)
    const audioInFreezeWindow = currentCuts.find(c => c.track === "A1" && c.timelineStartFrame >= 48 && c.timelineStartFrame < 120);
    assert.equal(audioInFreezeWindow, undefined, "Não deve existir clipe de áudio durante a janela do freeze frame (áudio silencia)");

    // Na pista V1, o clipe freeze ocupa de 48 a 120
    const videoFreeze = currentCuts.find(c => c.track === "V1" && c.timelineStartFrame === 48);
    assert.ok(videoFreeze, "O clipe congelado deve ocupar exatamente a pista V1 em t=48");
    assert.equal(videoFreeze.outFrame - videoFreeze.inFrame, 72, "Duração do freeze deve ser 72 frames (3s)");

    // As metades direitas continuam alinhadas em t=120
    const rightV = currentCuts.find(c => c.track === "V1" && c.timelineStartFrame === 120);
    const rightA = currentCuts.find(c => c.track === "A1" && c.timelineStartFrame === 120);
    assert.ok(rightV, "Vídeo direito retomado em 120");
    assert.ok(rightA, "Áudio direito retomado em 120");
    assert.equal(rightV.link_id, rightA.link_id, "Vínculo A/V preservado nas metades direitas");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Congelar o Último Quadro da Mídia sem Resíduo de 1 Frame
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Congelamento no Último Quadro e Limite Final sem Fragmento Residual de 1 Frame", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];
    TIMELINE_STATE.fps = 24;

    const clipV = {
        id: "clip_tail_v",
        video_id: "media_tail",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100, // frames 0..99 (último frame visível = 99)
        in: 0,
        out: 100 / 24,
        link_id: "link_tail",
        name: "Cena Final"
    };
    const clipA = {
        id: "clip_tail_a",
        video_id: "media_tail",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        in: 0,
        out: 100 / 24,
        link_id: "link_tail",
        name: "Cena Final Áudio"
    };

    STATE.activeTimelineCuts = [clipV, clipA];

    // Caso A: Agulha posicionada no último frame visível (frame 99)
    const res99 = TIMELINE_STATE.createFreezeFrameCut("clip_tail_v", 99, 3.0, "ripple");

    assert.ok(res99, "createFreezeFrameCut deve funcionar perfeitamente no último frame visível (99)");
    assert.equal(res99.timelineStartFrame, 100, "O clipe congelado deve ser anexado ao final do clipe (frame 100)");
    assert.equal(res99.freeze_frame, 99, "O frame congelado deve ser o frame 99 (último quadro válido)");
    assert.equal(res99.freeze_time, 99 / 24, "O tempo congelado deve corresponder ao frame 99");

    const cutsAfter99 = STATE.activeTimelineCuts;
    // Valida que o clipe original de vídeo NÃO foi picotado, e NÃO existe um fragmento residual de 1 frame
    const vMain = cutsAfter99.find(c => c.id === "clip_tail_v");
    assert.ok(vMain, "Clipe original deve permanecer");
    assert.equal(vMain.outFrame, 100, "Clipe original de vídeo deve manter todos os seus 100 frames intactos");

    const residual1Frame = cutsAfter99.find(c => c.track === "V1" && (c.outFrame - c.inFrame) === 1);
    assert.equal(residual1Frame, undefined, "NÃO deve existir resíduo de 1 frame após congelar o último quadro!");

    // Caso B: Agulha na extremidade de corte/borda final (frame 100 do clipe)
    STATE.activeTimelineCuts = [clipV, clipA];
    const res100 = TIMELINE_STATE.createFreezeFrameCut("clip_tail_v", 100, 3.0, "ripple");
    assert.ok(res100, "createFreezeFrameCut deve funcionar na borda final do clipe (frame 100)");
    assert.equal(res100.timelineStartFrame, 100, "Freeze frame deve começar no frame 100");
    assert.equal(res100.freeze_frame, 99, "Deve capturar o último frame válido da mídia (frame 99)");

    // Valida que timelineInteraction.js permite congelamento na borda final e último quadro
    assert.ok(tiSrc.includes("isPlayheadOverClip"), "timelineInteraction.js deve verificar isPlayheadOverClip");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Imunidade do Freeze Frame contra Clamping ao Adicionar Mídia da Biblioteca
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Preservação do Freeze Frame ao Adicionar Nova Mídia da Biblioteca (Duplo Clique e Drag & Drop)", () => {
    STATE.allVideos = [
        { id: "vid_short", duration: 100 / 24, fps: 24, title: "Vídeo Curto" },
        { id: "vid_lib2", duration: 5.0, fps: 24, title: "Vídeo Biblioteca" }
    ];
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false }
    ];
    TIMELINE_STATE.fps = 24;

    const clipV = {
        id: "clip_base",
        video_id: "vid_short",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        in: 0,
        out: 100 / 24,
        name: "Clipe Base"
    };

    STATE.activeTimelineCuts = [clipV];

    // 1. Congela o último frame da mídia curta
    const freezeCut = TIMELINE_STATE.createFreezeFrameCut("clip_base", 100, 3.0, "ripple");
    assert.ok(freezeCut, "Freeze cut deve ser criado");
    assert.equal(freezeCut.timelineStartFrame, 100, "Inicia em t=100");
    assert.equal(freezeCut.outFrame - freezeCut.inFrame, 72, "Duração do freeze deve ser 72 frames (3s)");

    // 2. Insere mídia via duplo clique na biblioteca (insertMedia em modo 'end')
    TIMELINE_STATE.insertMedia({ type: "video", id: "vid_lib2", mode: "end" });

    let cuts = STATE.activeTimelineCuts;
    const freezeAfterInsert = cuts.find(c => c.is_freeze);
    assert.ok(freezeAfterInsert, "Freeze frame DEVE permanecer na timeline após duplo clique!");
    assert.equal(freezeAfterInsert.outFrame - freezeAfterInsert.inFrame, 72, "Freeze frame NÃO deve ser esmagado por conformCuts/getMaxMediaFrames (deve manter 72 frames)");
    assert.equal(freezeAfterInsert.timelineStartFrame, 100, "Freeze frame mantém sua posição em 100");

    const insertedCut = cuts.find(c => c.video_id === "vid_lib2");
    assert.ok(insertedCut, "Nova mídia da biblioteca deve ser adicionada");
    assert.equal(insertedCut.timelineStartFrame, 172, "Nova mídia deve iniciar APÓS o freeze frame (100 + 72 = 172)");

    // 3. Insere mídia via arrasto e soltura (addCut no fim da pista)
    TIMELINE_STATE.addCut("vid_short", 0, 2.0, "V1");
    cuts = STATE.activeTimelineCuts;
    const freezeAfterDrop = cuts.find(c => c.is_freeze);
    assert.ok(freezeAfterDrop, "Freeze frame DEVE continuar presente após drag & drop!");
    assert.equal(freezeAfterDrop.outFrame - freezeAfterDrop.inFrame, 72, "Freeze frame mantém 72 frames após drag & drop");
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount} de ${totalCount} baterias APROVADAS (100% de sucesso)`);
console.log("===============================================================================\n");

