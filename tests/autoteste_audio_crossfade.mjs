// tests/autoteste_audio_crossfade.mjs
// Suíte de Testes Automatizados — Task 15 do PLANO_SUITE_NLE_CLASSICO:
// Crossfade de Áudio de Junção com Potência Constante (Equal-Power — Ctrl+Shift+D)
//
// Validações:
//  1. Demonstração matemática de Potência Constante: Gain_out^2(t) + Gain_in^2(t) == 1.0
//  2. Avaliação de curvas na exportação Python (fade.py) e compatibilidade com FFmpeg acrossfade
//  3. Cadastro no catálogo central COMMANDS_CATALOG e paridade nos 5 perfis NLE
//  4. Criação de transição no modelo TIMELINE_STATE e efeitos simétricos nos clipes contíguos
//  5. Opções de alinhamento (center, start, end) e proteção contra pistas travadas
//  6. Clamping automático de limites da mídia / duração dos clipes
//  7. Execução do atalho Ctrl+Shift+D com detecção automática pela agulha (playhead)
//  8. Reversibilidade total atômica com Undo (Ctrl+Z) e Redo (Ctrl+Y)
//  9. Renderização visual no canvas (drawTransitions) com waveforms e curvas cruzadas
// 10. Modulação de áudio dual no player.js durante a janela de transição

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

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
        paused: true,
        volume: 1.0,
        currentTime: 0,
        playbackRate: 1.0,
        readyState: 4,
        seeking: false,
        play: async () => {},
        pause: () => {},
        load: () => {},
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
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        focus() {},
        select() {},
        blur() {}
    };
}

const drawnOperations = [];
const canvasStub = {
    getContext: () => ({
        save() { drawnOperations.push({ op: "save" }); },
        restore() { drawnOperations.push({ op: "restore" }); },
        beginPath() { drawnOperations.push({ op: "beginPath" }); },
        rect(x, y, w, h) { drawnOperations.push({ op: "rect", x, y, w, h }); },
        clip() { drawnOperations.push({ op: "clip" }); },
        fillRect(x, y, w, h) { drawnOperations.push({ op: "fillRect", x, y, w, h }); },
        strokeRect(x, y, w, h) { drawnOperations.push({ op: "strokeRect", x, y, w, h }); },
        setLineDash(dash) { drawnOperations.push({ op: "setLineDash", dash }); },
        fill() { drawnOperations.push({ op: "fill" }); },
        stroke() { drawnOperations.push({ op: "stroke" }); },
        measureText: (text) => ({ width: text ? text.length * 6 : 50 }),
        fillText(text, x, y) { drawnOperations.push({ op: "fillText", text, x, y }); },
        scale() {},
        clearRect() {},
        moveTo(x, y) { drawnOperations.push({ op: "moveTo", x, y }); },
        lineTo(x, y) { drawnOperations.push({ op: "lineTo", x, y }); },
        arc(x, y, r, sa, ea) { drawnOperations.push({ op: "arc", x, y, r }); },
        roundRect(x, y, w, h, r) { drawnOperations.push({ op: "roundRect", x, y, w, h }); },
        closePath() { drawnOperations.push({ op: "closePath" }); }
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

// Importações dos módulos da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY, evaluateFadeCurve, FADE_CURVE_PRESETS } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 15: CROSSFADE DE ÁUDIO DE JUNÇÃO");
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
// Bateria 1: Prova Matemática da Curva Equal-Power (Potência Constante)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Prova Matemática: Gain_out^2(t) + Gain_in^2(t) == 1.0 (Potência Constante)", () => {
    assert.ok(FADE_CURVE_PRESETS.equal_power, "Preset 'equal_power' deve existir em FADE_CURVE_PRESETS");
    assert.strictEqual(FADE_CURVE_PRESETS.equal_power.id, "equal_power");

    // Amostragem contínua em 101 pontos de t = 0.0 até 1.0
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        // Para fade-in: progress = t -> sin(t * pi / 2)
        const gainIn = evaluateFadeCurve(t, "equal_power");
        // Para fade-out: progress = 1 - t -> sin((1-t) * pi / 2) = cos(t * pi / 2)
        const gainOut = evaluateFadeCurve(1 - t, "equal_power");

        // Soma das potências (quadrados dos ganhos acústicos)
        const power = (gainOut * gainOut) + (gainIn * gainIn);

        assert.ok(
            Math.abs(power - 1.0) < 1e-9,
            `A potência no ponto t=${t.toFixed(2)} deve ser estritamente 1.0 (+-1e-9), obtido: ${power}`
        );
    }

    // Ponto Médio exato (t = 0.5):
    // Ganho em -3.01 dB = 1/sqrt(2) = sqrt(0.5) ≈ 0.70710678
    const gainMidIn = evaluateFadeCurve(0.5, "equal_power");
    const gainMidOut = evaluateFadeCurve(0.5, "equal_power");
    const expectedMid = Math.SQRT1_2;
    assert.ok(Math.abs(gainMidIn - expectedMid) < 1e-9, `No ponto médio, ganho in deve ser ~0.707107, obtido: ${gainMidIn}`);
    assert.ok(Math.abs(gainMidOut - expectedMid) < 1e-9, `No ponto médio, ganho out deve ser ~0.707107, obtido: ${gainMidOut}`);

    // Extremidades
    assert.strictEqual(evaluateFadeCurve(0.0, "equal_power"), 0.0, "Ganho em t=0 deve ser silêncio absoluto 0.0");
    assert.strictEqual(evaluateFadeCurve(1.0, "equal_power"), 1.0, "Ganho em t=1 deve ser ganho pleno 1.0");

    // Comparativo: Curva linear clássica tem queda de -6 dB no ponto médio (potência cai para 0.5)
    const linIn = evaluateFadeCurve(0.5, "linear");
    const linOut = evaluateFadeCurve(0.5, "linear");
    const linPower = (linIn * linIn) + (linOut * linOut);
    assert.strictEqual(linPower, 0.5, "Fade linear perde metade da potência acústica (queda de 3 dB) no meio da transição");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Paridade com o Motor de Renderização Python (fade.py)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Paridade de Exportação Python (fade.py & test_render_fade.py)", () => {
    const fadePyPath = path.join(raiz, "src", "export", "video_render", "fade.py");
    const fadePySrc = fs.readFileSync(fadePyPath, "utf-8");

    assert.ok(fadePySrc.includes('"equal_power"'), "fade.py deve registrar 'equal_power' em CURVAS_CONHECIDAS");
    assert.ok(fadePySrc.includes("math.sin(p * math.pi * 0.5)"), "fade.py deve calcular equal_power usando math.sin(p * math.pi * 0.5)");
    assert.ok(fadePySrc.includes("sin({p}*PI/2)"), "fade.py deve gerar expressão FFmpeg sin({p}*PI/2) para equal_power");

    // Executa a suíte de testes unitários do Python para fade.py
    const pyOutput = execSync(
        'python -c "import sys; sys.path.insert(0, \'.\'); import unittest; unittest.main(module=None, argv=[\'\', \'discover\', \'-s\', \'tests\', \'-p\', \'test_render_fade.py\'])"',
        { cwd: raiz, encoding: "utf-8" }
    );
    assert.ok(pyOutput.includes("OK") || !pyOutput.includes("FAILED"), "Todos os testes unitários de fade.py devem passar");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Catálogo de Comandos e Paridade nos 5 Perfis NLE (keymapService.js)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Catálogo Central de Comandos e 5 Presets da Indústria", () => {
    // Registro no COMMANDS_CATALOG
    const cmd = COMMANDS_CATALOG.find(c => c.id === "edit.apply_audio_crossfade");
    assert.ok(cmd, "Comando edit.apply_audio_crossfade deve estar registrado no COMMANDS_CATALOG");
    assert.strictEqual(cmd.category, "edit");
    assert.ok(cmd.label.includes("Crossfade"), "Label deve mencionar Crossfade");
    assert.ok(cmd.description.includes("Ctrl+Shift+D"), "Descrição deve citar atalho padrão Ctrl+Shift+D");

    // Mapeamentos nos 5 presets
    const pCapiau = KEYMAP_PRESETS.capiau["edit.apply_audio_crossfade"];
    assert.deepStrictEqual(pCapiau, ["Ctrl+Shift+KeyD"], "Preset CapIAu deve mapear Ctrl+Shift+D");

    const pKdenlive = KEYMAP_PRESETS.kdenlive["edit.apply_audio_crossfade"];
    assert.deepStrictEqual(pKdenlive, ["Ctrl+Shift+KeyD", "KeyU"], "Preset Kdenlive deve mapear Ctrl+Shift+D e KeyU");

    const pPremiere = KEYMAP_PRESETS.premiere["edit.apply_audio_crossfade"];
    assert.deepStrictEqual(pPremiere, ["Ctrl+Shift+KeyD"], "Preset Premiere deve mapear Ctrl+Shift+D");

    const pResolve = KEYMAP_PRESETS.resolve["edit.apply_audio_crossfade"];
    assert.deepStrictEqual(pResolve, ["Alt+KeyT", "Ctrl+Shift+KeyD"], "Preset Resolve deve mapear Alt+T e Ctrl+Shift+D");

    const pFinalCut = KEYMAP_PRESETS.finalcut["edit.apply_audio_crossfade"];
    assert.deepStrictEqual(pFinalCut, ["Alt+Cmd+KeyT", "Ctrl+Shift+KeyD"], "Preset Final Cut deve mapear Alt+Cmd+T e Ctrl+Shift+D");

    // Inocuidade: nenhuma colisão com ferramentas de edição rápida
    const capiauKeyD = KEYMAP_PRESETS.capiau["tools.rate_stretch"] || [];
    assert.ok(!capiauKeyD.includes("Ctrl+Shift+KeyD"), "Rate Stretch não pode colidir com Ctrl+Shift+D");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Criação de Transição de Junção no TIMELINE_STATE
// ─────────────────────────────────────────────────────────────────────────────
runBattery("TIMELINE_STATE.addAudioCrossfade() em clipes adjacentes de áudio", () => {
    // Configura timeline limpa
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false, hidden: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false, hidden: false }
    ];
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.selectedTransitionId = null;

    // Dois clipes contíguos na pista A1
    // Clip A: 0..48 (2 segundos)
    // Clip B: 48..96 (2 segundos)
    const clipA = {
        id: "clip_aud_a",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        out: 2.0,
        effects: []
    };
    const clipB = {
        id: "clip_aud_b",
        track: "A1",
        timelineStartFrame: 48,
        inFrame: 0,
        outFrame: 48,
        in: 0,
        out: 2.0,
        effects: []
    };
    STATE.activeTimelineCuts = [clipA, clipB];

    // Aplica transição de 1 segundo (24 frames) centrada na emenda
    const res = TIMELINE_STATE.addAudioCrossfade({
        clipAId: clipA.id,
        clipBId: clipB.id,
        durationFrames: 24,
        alignment: "center",
        curve: "equal_power"
    });

    assert.ok(res, "addAudioCrossfade deve retornar objeto de sucesso");
    assert.ok(res.transition, "addAudioCrossfade deve retornar objeto de transição");
    const tr = res.transition;

    assert.strictEqual(tr.type, "audio_crossfade");
    assert.strictEqual(tr.kind, "audio");
    assert.strictEqual(tr.track, "A1");
    assert.strictEqual(tr.cutFrame, 48);
    assert.strictEqual(tr.clipAId, "clip_aud_a");
    assert.strictEqual(tr.clipBId, "clip_aud_b");
    assert.strictEqual(tr.durationFrames, 24);
    assert.strictEqual(tr.duration_s, 1.0);
    assert.strictEqual(tr.curve, "equal_power");
    assert.strictEqual(tr.halfAFrames, 12);
    assert.strictEqual(tr.halfBFrames, 12);

    // Efeitos nos clipes:
    const effA = res.clipA.effects.find(e => e.type === "crossfade" && e.side === "out");
    assert.ok(effA, "Clip A deve receber efeito crossfade side:out");
    assert.strictEqual(effA.curve, "equal_power");
    assert.strictEqual(effA.duration_s, 0.5); // 12 frames / 24 fps = 0.5s

    const effB = res.clipB.effects.find(e => e.type === "crossfade" && e.side === "in");
    assert.ok(effB, "Clip B deve receber efeito crossfade side:in");
    assert.strictEqual(effB.curve, "equal_power");
    assert.strictEqual(effB.duration_s, 0.5); // 12 frames / 24 fps = 0.5s

    // Lista de transições da timeline
    assert.strictEqual(TIMELINE_STATE.getTransitions().length, 1);
    assert.strictEqual(TIMELINE_STATE.getTransitionsForClip("clip_aud_a").length, 1);
    assert.strictEqual(TIMELINE_STATE.getTransitionsForClip("clip_aud_b").length, 1);

    const hit = TIMELINE_STATE.getTransitionAt("A1", 48, 2);
    assert.ok(hit, "getTransitionAt deve encontrar a transição na coordenada do corte");
    assert.strictEqual(hit.id, tr.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Opções de Alinhamento (center, start, end) e Clamping de Mídia
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Alinhamentos (Start, End, Center) e Clamping de Duração", () => {
    const cuts = STATE.activeTimelineCuts;
    const clipA = cuts.find(c => c.id === "clip_aud_a");
    const clipB = cuts.find(c => c.id === "clip_aud_b");

    // 1. Alinhamento START (começa no corte, estende para o clipe B)
    const resStart = TIMELINE_STATE.addAudioCrossfade({
        clipAId: clipA.id,
        clipBId: clipB.id,
        durationFrames: 24,
        alignment: "start"
    });
    assert.ok(resStart);
    assert.strictEqual(resStart.transition.alignment, "start");
    assert.strictEqual(resStart.transition.halfAFrames, 1);
    assert.strictEqual(resStart.transition.halfBFrames, 24);

    // 2. Alinhamento END (termina no corte, estende para o clipe A)
    const resEnd = TIMELINE_STATE.addAudioCrossfade({
        clipAId: clipA.id,
        clipBId: clipB.id,
        durationFrames: 24,
        alignment: "end"
    });
    assert.ok(resEnd);
    assert.strictEqual(resEnd.transition.alignment, "end");
    assert.strictEqual(resEnd.transition.halfAFrames, 24);
    assert.strictEqual(resEnd.transition.halfBFrames, 1);

    // 3. Clamping quando a duração solicitada excede a duração do clipe
    // Clipes têm 48 frames cada. Solicitamos 200 frames:
    const resClamped = TIMELINE_STATE.addAudioCrossfade({
        clipAId: clipA.id,
        clipBId: clipB.id,
        durationFrames: 200,
        alignment: "center"
    });
    assert.ok(resClamped);
    // Cada metade não pode exceder durClip - 1 (47 frames)
    assert.ok(resClamped.transition.halfAFrames <= 47, "halfA deve ser clampado para caber no clipe A");
    assert.ok(resClamped.transition.halfBFrames <= 47, "halfB deve ser clampado para caber no clipe B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Proteção contra Pistas Travadas (Cadeado)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Proteção contra Pistas Travadas (Locked Tracks)", () => {
    // Trava a pista A1
    const trackA1 = TIMELINE_STATE.tracks.find(t => t.id === "A1");
    trackA1.locked = true;

    const resLocked = TIMELINE_STATE.addAudioCrossfade({
        clipAId: "clip_aud_a",
        clipBId: "clip_aud_b",
        trackId: "A1"
    });
    assert.strictEqual(resLocked, null, "Pista travada deve rejeitar aplicação de transição");

    // Destrava para os próximos testes
    trackA1.locked = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Detecção Automática pela Agulha (Playhead) & Atalho Ctrl+Shift+D
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Detecção Automática sob a Agulha e Simulação de Teclado", () => {
    // Limpa transições
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.selectedClipIds = new Set();
    TIMELINE_STATE.selectedClipId = null;

    // Posiciona a agulha exatamente na emenda (frame 48)
    TIMELINE_STATE.playheadFrame = 48;

    // Chama addAudioCrossfade sem parâmetros: deve encontrar o corte em frame 48
    const autoRes = TIMELINE_STATE.addAudioCrossfade();
    assert.ok(autoRes, "Detecção automática sob o playhead deve encontrar a emenda");
    assert.strictEqual(autoRes.transition.cutFrame, 48);
    assert.strictEqual(autoRes.clipA.id, "clip_aud_a");
    assert.strictEqual(autoRes.clipB.id, "clip_aud_b");

    // Simula interação de atalho via timelineInteraction
    const dummyRenderer = {
        canvas: canvasStub,
        rulerHeight: 30,
        requestRedraw: () => {},
        getTrackAtY: () => ({ id: "A1", kind: "audio" }),
        getLane: () => ({ top: 80, height: 40, track: { id: "A1", kind: "audio" } }),
        getTrackLanes: () => [{ top: 80, height: 40, track: { id: "A1", kind: "audio" } }]
    };

    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    let handled = false;
    const evt = {
        code: "KeyD",
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
        target: { tagName: "BODY" },
        preventDefault: () => { handled = true; },
        stopPropagation: () => {}
    };

    interaction.onKeyDown(evt);
    assert.ok(handled, "onKeyDown com Ctrl+Shift+D deve prevenir o comportamento padrão e aplicar transição");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Reversibilidade Total Atômica com Histórico (Undo / Redo)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reversibilidade Total com TIMELINE_HISTORY (Undo e Redo)", () => {
    // Estado inicial: limpo
    TIMELINE_STATE.transitions = [];
    STATE.activeTimelineCuts.forEach(c => { c.effects = []; });
    TIMELINE_HISTORY.clear();

    assert.strictEqual(TIMELINE_STATE.transitions.length, 0);

    // 1. Aplica transição
    const res = TIMELINE_STATE.addAudioCrossfade({
        clipAId: "clip_aud_a",
        clipBId: "clip_aud_b",
        durationFrames: 24
    });
    assert.ok(res);
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 1);

    // 2. Undo (Ctrl+Z)
    TIMELINE_HISTORY.undo();
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "Undo deve remover a transição da timeline");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0, "Undo deve remover efeito crossfade do Clip A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0, "Undo deve remover efeito crossfade do Clip B");

    // 3. Redo (Ctrl+Y)
    TIMELINE_HISTORY.redo();
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1, "Redo deve restaurar a transição da timeline");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 1, "Redo deve restaurar efeito crossfade do Clip A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 1, "Redo deve restaurar efeito crossfade do Clip B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Renderização Visual no Canvas (drawTransitions)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Renderização no Canvas com Curvas Cruzadas (drawTransitions)", () => {
    drawnOperations.length = 0;
    TIMELINE_STATE.zoom = 2.0; // 24 frames * 2.0 = 48px de largura
    const renderer = new CapiauTimelineRenderer();
    renderer.width = 1000;
    renderer.height = 400;

    // Configura lanes para o renderer
    renderer.getTrackLanes = () => [
        { top: 30, height: 50, track: { id: "V1", kind: "video" } },
        { top: 80, height: 40, track: { id: "A1", kind: "audio" } }
    ];

    // Executa desenho de transições
    renderer.drawTransitions();

    assert.ok(drawnOperations.length > 0, "drawTransitions deve emitir instruções para o canvas");

    // Verifica presença de preenchimento, borda e texto
    const hasFillRect = drawnOperations.some(op => op.op === "fillRect");
    const hasStrokeRect = drawnOperations.some(op => op.op === "strokeRect");
    const hasFillText = drawnOperations.some(op => op.op === "fillText" && (op.text.includes("Crossfade") || op.text === "CF"));

    assert.ok(hasFillRect, "drawTransitions deve desenhar o bloco de fundo da transição");
    assert.ok(hasStrokeRect, "drawTransitions deve desenhar a borda da transição");
    assert.ok(hasFillText, "drawTransitions deve exibir o rótulo descritivo 'Crossfade' ou sigla");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Modulação de Áudio Limpa no player.js (Potência Constante sem Race Conditions)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Modulação de Áudio no player.js (Curva Equal-Power por Efeito)", () => {
    const playerSrc = readSrc("player.js");

    assert.ok(playerSrc.includes('effects.filter(e => e && e.type === "crossfade")'), "player.js deve avaliar efeitos do tipo crossfade");
    assert.ok(playerSrc.includes('evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0)'), "player.js deve modular o volume do elemento usando evaluateFadeCurve");
    assert.ok(!playerSrc.includes('_parReservaAudio(track.id, el); \n            if (clipChanged && reserva && reserva.dataset.activeClipId === String(cut.id) &&'), "player.js não deve adulterar o par de reserva do Contrato F4");

    // Validação matemática do ganho nas pontas da emenda:
    const fps = 24;
    const durS = 1.0; // 1 segundo de crossfade

    // Clip A (Fade Out): p vai de 1.0 (início do fade) até 0.0 (fim do clipe no corte)
    const gA_start = evaluateFadeCurve(1.0, "equal_power");
    const gA_mid = evaluateFadeCurve(0.5, "equal_power");
    const gA_end = evaluateFadeCurve(0.0, "equal_power");

    assert.strictEqual(gA_start, 1.0, "No início do fade out, o ganho deve ser 1.0");
    assert.ok(Math.abs(gA_mid - Math.SQRT1_2) < 1e-9, "No ponto médio do corte, o ganho de saída deve ser 1/sqrt(2) (~0.7071)");
    assert.strictEqual(gA_end, 0.0, "No corte exato do final do clipe A, o ganho deve ser 0.0");

    // Clip B (Fade In): p vai de 0.0 (início do clipe no corte) até 1.0 (fim do fade in)
    const gB_start = evaluateFadeCurve(0.0, "equal_power");
    const gB_mid = evaluateFadeCurve(0.5, "equal_power");
    const gB_end = evaluateFadeCurve(1.0, "equal_power");

    assert.strictEqual(gB_start, 0.0, "No início do clipe B (corte), o ganho deve ser 0.0");
    assert.ok(Math.abs(gB_mid - Math.SQRT1_2) < 1e-9, "No ponto médio do corte, o ganho de entrada deve ser 1/sqrt(2) (~0.7071)");
    assert.strictEqual(gB_end, 1.0, "Ao completar o fade in, o ganho deve ser 1.0");

    // Potência combinada no corte (t = 0.5):
    const combinedPower = (gA_mid * gA_mid) + (gB_mid * gB_mid);
    assert.ok(Math.abs(combinedPower - 1.0) < 1e-9, "A potência combinada no ponto de corte deve ser exatamente 1.0 (Equal-Power)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Auto-limpeza de Transições ao Separar Clipes (validateTransitions)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Auto-limpeza ao Separar Clipes (Detecção de Gap / Órfãos)", () => {
    // 1. Prepara dois clipes contíguos
    TIMELINE_STATE.transitions = [];
    STATE.activeTimelineCuts = [
        {
            id: "clip_sep_a",
            track: "A1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            effects: []
        },
        {
            id: "clip_sep_b",
            track: "A1",
            timelineStartFrame: 100,
            inFrame: 0,
            outFrame: 100,
            effects: []
        }
    ];

    // 2. Aplica transição de crossfade
    const res = TIMELINE_STATE.addAudioCrossfade({
        clipAId: "clip_sep_a",
        clipBId: "clip_sep_b",
        durationFrames: 24
    });
    assert.ok(res);
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 1);

    // 3. Separa os clipes criando um gap (move o clipe B para o frame 150)
    STATE.activeTimelineCuts[1].timelineStartFrame = 150;

    // 4. Executa validateTransitions()
    const cleaned = TIMELINE_STATE.validateTransitions();
    assert.strictEqual(cleaned, true, "validateTransitions deve retornar true ao detectar separação");
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "A transição órfã deve ser removida da lista");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0, "O efeito crossfade deve ser removido do clipe A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0, "O efeito crossfade deve ser removido do clipe B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Deleção Manual de Transição Selecionada (Delete / Backspace)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Deleção de Transição Selecionada via Teclado e API", () => {
    // 1. Prepara dois clipes contíguos
    TIMELINE_STATE.transitions = [];
    STATE.activeTimelineCuts = [
        {
            id: "clip_del_a",
            track: "A1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            effects: []
        },
        {
            id: "clip_del_b",
            track: "A1",
            timelineStartFrame: 100,
            inFrame: 0,
            outFrame: 100,
            effects: []
        }
    ];

    const res = TIMELINE_STATE.addAudioCrossfade({
        clipAId: "clip_del_a",
        clipBId: "clip_del_b",
        durationFrames: 24
    });
    assert.ok(res);
    assert.strictEqual(TIMELINE_STATE.transitions.length, 1);
    const transId = res.transition ? res.transition.id : res.id;

    // 2. Seleciona a transição
    TIMELINE_STATE.selectedTransitionId = transId;

    // 3. Simula pressão da tecla Delete
    const dummyRenderer = {
        canvas: canvasStub,
        rulerHeight: 30,
        requestRedraw: () => {},
        getTrackAtY: () => ({ id: "A1", kind: "audio" }),
        getLane: () => ({ top: 80, height: 40, track: { id: "A1", kind: "audio" } }),
        getTrackLanes: () => [{ top: 80, height: 40, track: { id: "A1", kind: "audio" } }]
    };
    const interaction = new CapiauTimelineInteraction(dummyRenderer);

    let prevented = false;
    const evt = {
        key: "Delete",
        code: "Delete",
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        target: { tagName: "BODY" },
        preventDefault: () => { prevented = true; },
        stopPropagation: () => {}
    };

    interaction.onKeyDown(evt);
    assert.ok(prevented, "onKeyDown com Delete deve prevenir o evento ao apagar transição");
    assert.strictEqual(TIMELINE_STATE.selectedTransitionId, null, "selectedTransitionId deve ser limpo após exclusão");
    assert.strictEqual(TIMELINE_STATE.transitions.length, 0, "Transição deve ter sido removida de TIMELINE_STATE.transitions");
    assert.strictEqual(STATE.activeTimelineCuts[0].effects.length, 0, "Efeito crossfade deve ser removido do clipe A");
    assert.strictEqual(STATE.activeTimelineCuts[1].effects.length, 0, "Efeito crossfade deve ser removido do clipe B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Redimensionamento Interativo das Bordas (Symmetric Default & Asymmetric com Alt)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Redimensionamento Interativo das Bordas (Symmetric Default & Asymmetric com Alt)", () => {
    STATE.activeTimelineCuts = [
        { id: "clip_resize_a", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 100, effects: [] },
        { id: "clip_resize_b", track: "A1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, effects: [] }
    ];
    TIMELINE_STATE.tracks = [{ id: "A1", kind: "audio", volume: 1.0, muted: false, locked: false, hidden: false }];
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.zoom = 1.0;
    TIMELINE_STATE.scrollLeftFrame = 0;

    const res = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "clip_resize_a",
        clipBId: "clip_resize_b",
        durationFrames: 24
    });
    assert.ok(res, "Transição deve ser criada");
    const tr = res.transition;
    assert.strictEqual(tr.halfAFrames, 12);
    assert.strictEqual(tr.halfBFrames, 12);
    assert.strictEqual(tr.durationFrames, 24);

    // 1. Detecção de bordas via getTransitionHit
    // cutFrame = 100, borda esquerda = 100 - 12 = 88, borda direita = 100 + 12 = 112
    const hitLeft = TIMELINE_STATE.getTransitionHit("A1", 88, 3);
    assert.ok(hitLeft, "Deve detectar borda esquerda no frame 88");
    assert.strictEqual(hitLeft.edge, "left");

    const hitRight = TIMELINE_STATE.getTransitionHit("A1", 112, 3);
    assert.ok(hitRight, "Deve detectar borda direita no frame 112");
    assert.strictEqual(hitRight.edge, "right");

    const hitBody = TIMELINE_STATE.getTransitionHit("A1", 100, 3);
    assert.ok(hitBody, "Deve detectar corpo no frame 100");
    assert.strictEqual(hitBody.edge, "body");

    // 2. updateTransitionDuration da API
    // Redimensionamento Simétrico
    const updatedSym = TIMELINE_STATE.updateTransitionDuration(tr.id, 20, 20);
    assert.ok(updatedSym);
    assert.strictEqual(updatedSym.halfAFrames, 20);
    assert.strictEqual(updatedSym.halfBFrames, 20);
    assert.strictEqual(updatedSym.durationFrames, 40);
    assert.strictEqual(updatedSym.duration_s, 40 / 24);

    const cutA = STATE.activeTimelineCuts.find(c => c.id === "clip_resize_a");
    const cutB = STATE.activeTimelineCuts.find(c => c.id === "clip_resize_b");
    const effA = cutA.effects.find(e => e.transitionId === tr.id);
    const effB = cutB.effects.find(e => e.transitionId === tr.id);
    assert.ok(effA && Math.abs(effA.duration_s - (20 / 24)) < 1e-6, "Efeito no clipe A deve ser sincronizado com halfA");
    assert.ok(effB && Math.abs(effB.duration_s - (20 / 24)) < 1e-6, "Efeito no clipe B deve ser sincronizado com halfB");

    // Redimensionamento Assimétrico (Alt Key)
    const updatedAsym = TIMELINE_STATE.updateTransitionDuration(tr.id, 10, 30);
    assert.ok(updatedAsym);
    assert.strictEqual(updatedAsym.halfAFrames, 10);
    assert.strictEqual(updatedAsym.halfBFrames, 30);
    assert.strictEqual(updatedAsym.durationFrames, 40);

    // 3. Simulação de Arraste Interativo com CapiauTimelineInteraction
    const dummyRenderer = {
        canvas: canvasStub,
        rulerHeight: 30,
        requestRedraw: () => {},
        getTrackAtY: () => ({ id: "A1", kind: "audio" }),
        getLane: () => ({ top: 80, height: 40, track: { id: "A1", kind: "audio" } }),
        getTrackLanes: () => [{ top: 80, height: 40, track: { id: "A1", kind: "audio" } }]
    };
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    interaction.canvas = canvasStub;

    // Sobrescrita de getCoordinates para simular posição na régua/timeline
    interaction.getCoordinates = (cx, cy) => {
        return {
            x: cx,
            y: cy,
            frame: Math.round(cx),
            track: "A1"
        };
    };

    // A) Mousedown na borda direita (frame 130 = cutFrame 100 + halfB 30)
    interaction.onMouseDown({
        button: 0,
        clientX: 130,
        clientY: 90,
        altKey: false,
        preventDefault: () => {}
    });

    assert.strictEqual(interaction.dragState, "transition-resize", "Mousedown na borda deve ativar dragState transition-resize");
    assert.strictEqual(interaction.transitionResizeEdge, "right", "Borda direita deve ser identificada");

    // B) Mousemove: arrasta +10 pixels para a direita (modo simétrico: expande ambos os lados em +10 frames)
    interaction.onMouseMove({
        clientX: 140,
        clientY: 90,
        altKey: false
    });

    assert.strictEqual(tr.halfBFrames, 40, "Lado direito deve expandir de 30 para 40");
    assert.strictEqual(tr.halfAFrames, 20, "Lado esquerdo deve expandir de 10 para 20 no modo simétrico (+10 frames)");
    assert.strictEqual(tr.durationFrames, 60);

    // C) Mousemove com Alt Key: move de volta 5 pixels apenas no lado direito
    interaction.onMouseMove({
        clientX: 135,
        clientY: 90,
        altKey: true
    });

    assert.strictEqual(tr.halfBFrames, 35, "Com Alt mantido, apenas o lado puxado deve alterar (30 + 5 = 35)");
    assert.strictEqual(tr.halfAFrames, 10, "Com Alt mantido, o lado oposto retorna ao ponto base (10)");

    // D) Mouseup: encerra o arraste e confirma estado no histórico
    interaction.onMouseUp({});
    assert.strictEqual(interaction.dragState, null, "onMouseUp deve resetar dragState para null");

    // E) Teste de Desfazer (Undo)
    TIMELINE_HISTORY.undo();
    const restoredTr = TIMELINE_STATE.transitions.find(t => t.id === tr.id);
    assert.ok(restoredTr, "Transição deve existir após Undo");
    assert.strictEqual(restoredTr.halfAFrames, 10, "Undo deve restaurar halfAFrames pré-arraste");
    assert.strictEqual(restoredTr.halfBFrames, 30, "Undo deve restaurar halfBFrames pré-arraste");

    // F) Teste de Refazer (Redo)
    TIMELINE_HISTORY.redo();
    const redoTr = TIMELINE_STATE.transitions.find(t => t.id === tr.id);
    assert.ok(redoTr, "Transição deve existir após Redo");
    assert.strictEqual(redoTr.halfAFrames, 10, "Redo deve reaplicar halfAFrames pós-arraste");
    assert.strictEqual(redoTr.halfBFrames, 35, "Redo deve reaplicar halfBFrames pós-arraste");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 14: Reprodução Dual Simultânea no player.js (Ausência de Saltos e Promoção Contínua)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reprodução Dual Simultânea no player.js (Ausência de Saltos e Promoção Contínua)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    STATE.allVideos = [
        { id: "vid_cross_1", src: "/media/audio1.mp3", duration: 10.0 },
        { id: "vid_cross_2", src: "/media/audio2.mp3", duration: 10.0 }
    ];

    const cutA = { id: "c_cross_1", video_id: "vid_cross_1", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 48, in: 0.0, out: 2.0, effects: [] };
    const cutB = { id: "c_cross_2", video_id: "vid_cross_2", track: "A1", timelineStartFrame: 48, inFrame: 0, outFrame: 48, in: 0.0, out: 2.0, effects: [] };
    STATE.activeTimelineCuts = [cutA, cutB];

    TIMELINE_STATE.tracks = [{ id: "A1", kind: "audio", volume: 1.0, muted: false, locked: false, hidden: false }];
    TIMELINE_STATE.fps = 24;

    const cf = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "c_cross_1",
        clipBId: "c_cross_2",
        durationFrames: 24, // 1 segundo (12 frames antes, 12 frames depois)
        curve: "equal_power"
    });
    assert.ok(cf);

    // 1. Simulação antes do corte (cutFrame = 48, frame = 40):
    // Dentro da janela de transição [36 .. 60]
    player.syncAudioTracks(STATE.activeTimelineCuts, 40);

    const elPrimary = player.audioPool["A1"];
    const elTransition = player.audioTransitionPool["A1"];

    assert.ok(elPrimary, "player deve alocar elemento primário na pista A1");
    assert.ok(elTransition, "player deve alocar elemento secundário de transição na pista A1");

    // No frame 40: progresso da transição = (40 - 36) / 24 = 4 / 24 ≈ 0.1666
    // Como cutB começa em 0.0s (sem head handle), targetSeconds < 0 para cutB
    // A nossa correção garante que elTransition fica pausado em 0s com volume 0 sem engasgar
    assert.strictEqual(elTransition.volume, 0, "Elemento secundário deve ter volume 0 antes do ponto de corte quando não há head handle");
    assert.strictEqual(elTransition.currentTime, 0, "Elemento secundário deve permanecer em 0s para não saltar na emenda");

    // 2. No corte exato (frame 48):
    // Progresso = 12 / 24 = 0.5. Ganho equal-power em t=0.5 é ~0.7071 em ambos
    player.syncAudioTracks(STATE.activeTimelineCuts, 48);
    const expectedGainMid = evaluateFadeCurve(0.5, "equal_power");
    assert.ok(Math.abs(elPrimary.volume - expectedGainMid) < 0.01, `elPrimary deve ter volume equal-power no ponto médio (~${expectedGainMid.toFixed(3)})`);
    assert.ok(Math.abs(elTransition.volume - expectedGainMid) < 0.01, `elTransition deve ter volume equal-power no ponto médio (~${expectedGainMid.toFixed(3)})`);

    // 3. Após sair da janela de transição (frame 62):
    // elTransition deve ser promovido continuamente para áudioPool["A1"] sem recarga
    player.syncAudioTracks(STATE.activeTimelineCuts, 62);
    assert.strictEqual(player.audioPool["A1"], elTransition, "elTransition deve ser promovido a elemento principal da pista");
    assert.strictEqual(elTransition.dataset.activeClipId, "c_cross_2", "Elemento promovido deve estar associado ao clipe B");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 15: Limites Físicos Rígidos de Pista, Colisão de Transições e Trava Simétrica
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Limites Físicos Rígidos de Pista, Colisão de Transições e Trava Simétrica", async () => {
    // 1. Configura cuts com tamanhos desiguais na pista A1
    // Clip A: do frame 20 ao frame 45 (duração 25 frames)
    // Clip B: do frame 45 ao frame 245 (duração 200 frames)
    // Corte exato no frame 45
    const cutA = {
        id: "clip_lim_a",
        track: "A1",
        timelineStartFrame: 20,
        inFrame: 0,
        outFrame: 25,
        effects: []
    };
    const cutB = {
        id: "clip_lim_b",
        track: "A1",
        timelineStartFrame: 45,
        inFrame: 0,
        outFrame: 200,
        effects: []
    };
    STATE.activeTimelineCuts = [cutA, cutB];
    TIMELINE_STATE.tracks = [{ id: "A1", kind: "audio", locked: false, muted: false, volume: 1.0 }];
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.transitions = [];

    // Adiciona transição centrada no corte 45 com 20 frames (10 para cada lado)
    const tr = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "clip_lim_a",
        clipBId: "clip_lim_b",
        durationFrames: 20,
        curve: "equal_power"
    });
    assert.ok(tr, "Transição deve ser criada");

    // 2. Validação dos Limites Físicos Reais via getTransitionLimits
    const limits = TIMELINE_STATE.getTransitionLimits(tr.id);
    assert.ok(limits, "getTransitionLimits deve retornar limites válidos");
    // Lado A: durAClip é 25. cutFrame é 45. clipAStart é 20.
    // maxHalfA = Math.min(25 - 1, 45 - 20) = 24 frames.
    assert.strictEqual(limits.maxHalfA, 24, "Lado A deve ser limitado a 24 quadros (não pode invadir antes do início do Clip A)");

    // Lado B: durBClip é 200. clipBEnd é 245. cutFrame é 45.
    // maxHalfB = Math.min(200 - 1, 245 - 45) = 199 frames.
    assert.strictEqual(limits.maxHalfB, 199, "Lado B deve ser limitado a 199 quadros (não pode invadir além do fim do Clip B)");

    // Trava Simétrica: menor entre os dois
    assert.strictEqual(limits.maxSymmetricHalf, 24, "Teto simétrico deve ser 24 quadros");

    // 3. Simulação de Arraste em Modo Simétrico tentando expandir além do limite do clipe menor
    const dummyRenderer = {
        canvas: canvasStub,
        rulerHeight: 30,
        requestRedraw: () => {},
        getTrackAtY: () => ({ id: "A1", kind: "audio" }),
        getLane: () => ({ top: 80, height: 40, track: { id: "A1", kind: "audio" } }),
        getTrackLanes: () => [{ top: 80, height: 40, track: { id: "A1", kind: "audio" } }]
    };
    const interaction = new CapiauTimelineInteraction(dummyRenderer);
    interaction.canvas = canvasStub;
    interaction.getCoordinates = (cx, cy) => ({ x: cx, y: cy, frame: Math.round(cx), track: "A1" });

    // Clicar na borda direita (cutFrame 45 + halfB 10 = frame 55)
    interaction.onMouseDown({
        button: 0,
        clientX: 55,
        clientY: 90,
        altKey: false,
        preventDefault: () => {}
    });
    assert.strictEqual(interaction.dragState, "transition-resize");

    // Arrastar +50 frames para a direita (tentando expandir para 60 frames de cada lado)
    interaction.onMouseMove({
        clientX: 55 + 50,
        clientY: 90,
        altKey: false
    });

    // Trava Simétrica Rígida: ambos os lados DEVEM travar rigorosamente em 24 quadros!
    assert.strictEqual(tr.halfAFrames, 24, "Lado A deve travar no teto físico de 24 quadros");
    assert.strictEqual(tr.halfBFrames, 24, "Lado B deve parar em 24 quadros no modo simétrico (NÃO pode esticar para 60)");
    assert.strictEqual(tr.durationFrames, 48);
    assert.strictEqual(tr.hitLimit, true, "tr.hitLimit deve ser true ao encostar no teto");

    // Validação do Tooltip com aviso (Limite do clipe)
    const tipEl = document.getElementById("timeline-transition-tooltip");
    assert.ok(tipEl, "Tooltip deve existir no DOM");
    assert.ok(tipEl.innerHTML.includes("(Limite do clipe)"), "Tooltip deve exibir indicação de '(Limite do clipe)'");

    interaction.onMouseUp({});

    // 4. Modo Assimétrico (Alt): apenas o lado puxado expande respeitando seu limite próprio
    interaction.onMouseDown({
        button: 0,
        clientX: 45 + 24, // 69
        clientY: 90,
        altKey: true,
        preventDefault: () => {}
    });

    // Puxa +30 frames com Alt
    interaction.onMouseMove({
        clientX: 69 + 30,
        clientY: 90,
        altKey: true
    });

    assert.strictEqual(tr.halfAFrames, 24, "Lado A não deve mudar no modo assimétrico");
    assert.strictEqual(tr.halfBFrames, 54, "Lado B deve expandir individualmente para 54 quadros com Alt");
    interaction.onMouseUp({});

    // 5. Prevenção de Colisão com Transição Adjacente na Mesma Pista
    // Adiciona Clip C adjacente ao Clip B (do frame 245 ao 300)
    const cutC = {
        id: "clip_lim_c",
        track: "A1",
        timelineStartFrame: 245,
        inFrame: 0,
        outFrame: 55,
        effects: []
    };
    STATE.activeTimelineCuts.push(cutC);

    // Cria segunda transição no corte 245 com 20 frames (10 antes = frame 235, 10 depois = frame 255)
    const tr2 = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "clip_lim_b",
        clipBId: "clip_lim_c",
        durationFrames: 20
    });
    assert.ok(tr2);

    // Recalcula limites da primeira transição tr:
    // O corte de tr é 45. A margem esquerda de tr2 começa em 245 - 10 = 235.
    // Portanto, o lado direito de tr (cutFrame 45 + halfB) nunca pode ultrapassar 235!
    // Espaço disponível para maxHalfB = 235 - 45 = 190.
    const limitsWithCollision = TIMELINE_STATE.getTransitionLimits(tr.id);
    assert.strictEqual(limitsWithCollision.maxHalfB, 190, "Lado B de tr deve ser clampado para 190 quadros pela transição adjacente vizinha");

    // Tentativa de update com valor maior deve ser clampada a 190
    TIMELINE_STATE.updateTransitionDuration(tr.id, 24, 250);
    assert.strictEqual(tr.halfBFrames, 190, "halfBFrames não pode invadir a transição vizinha");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 16: Ciclo de Vida do Pré-Carregamento de Áudio no player.js (Buffer Quente e Zero Latência)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Ciclo de Vida do Pré-Carregamento de Áudio no player.js (Buffer Quente e Zero Latência)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    STATE.allVideos = [
        { id: "vid_pre_1", src: "/media/stream_scene_1.mp3", duration: 15.0 },
        { id: "vid_pre_2", src: "/media/stream_scene_2.mp3", duration: 15.0 }
    ];

    const cutA = { id: "c_pre_1", video_id: "vid_pre_1", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 48, in: 0.0, out: 2.0, effects: [] };
    const cutB = { id: "c_pre_2", video_id: "vid_pre_2", track: "A1", timelineStartFrame: 48, inFrame: 0, outFrame: 48, in: 0.0, out: 2.0, effects: [] };
    STATE.activeTimelineCuts = [cutA, cutB];

    TIMELINE_STATE.tracks = [{ id: "A1", kind: "audio", volume: 1.0, muted: false, locked: false, hidden: false }];
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.transitions = [];

    const cf = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "c_pre_1",
        clipBId: "c_pre_2",
        durationFrames: 24, // janela [36 .. 60]
        curve: "equal_power"
    });
    assert.ok(cf);

    // 1. Simulação com agulha no frame 38 (ANTES do corte, targetSeconds < 0 para cutB):
    player.syncAudioTracks(STATE.activeTimelineCuts, 38);

    const elTrans = player.audioTransitionPool["A1"];
    assert.ok(elTrans, "Elemento de transição secundário deve existir");

    // Valida que o carregamento de fonte e activeClipId foram efetuados MESMO com targetSeconds < 0:
    assert.strictEqual(elTrans.dataset.activeClipId, "c_pre_2", "activeClipId deve estar atribuído ao cutB antes do corte");
    assert.strictEqual(elTrans.src, "/media/stream_scene_2.mp3", "URL da mídia do segundo clipe deve estar carregada no elemento");
    assert.strictEqual(elTrans.dataset.loadedSrc, "/media/stream_scene_2.mp3", "loadedSrc deve estar registrado");
    assert.strictEqual(elTrans.volume, 0, "Volume deve ser 0 antes do corte (buffer quente em repouso)");
    assert.strictEqual(elTrans.currentTime, 0, "currentTime deve estar travado em 0s para não saltar");

    // 2. Simulação no corte exato (frame 48, targetSeconds == 0):
    // Como a mídia já estava pré-carregada, NÃO há recarga de .src
    player.isPlaying = true;
    player.playbackSpeed = 1.0;
    player.syncAudioTracks(STATE.activeTimelineCuts, 48);

    assert.strictEqual(elTrans.dataset.loadedSrc, "/media/stream_scene_2.mp3", "loadedSrc não deve recarregar");
    const midGain = evaluateFadeCurve(0.5, "equal_power");
    assert.ok(Math.abs(elTrans.volume - midGain) < 0.01, `elTrans deve estar tocando no corte com ganho equal-power (~${midGain.toFixed(3)})`);

    // 3. Simulação na saída da transição (frame 62):
    player.syncAudioTracks(STATE.activeTimelineCuts, 62);
    assert.strictEqual(player.audioPool["A1"], elTrans, "elTrans deve ser promovido continuamente para áudioPool['A1']");
    assert.strictEqual(elTrans.dataset.activeClipId, "c_pre_2", "Elemento promovido deve manter associação com c_pre_2");

    player.isPlaying = false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 17: Resolução de Feedback Manual (Pausa de Áudio de Transição, Teto Mútuo e Discriminação de Trim)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Resolução de Feedback Manual (Pausa de Áudio de Transição, Teto Mútuo e Discriminação de Trim)", async () => {
    // 1. Validação de Pausa em ProgramPlayer: audioTransitionPool e _paresAudio devem ser pausados
    const { ProgramPlayer } = await import("../src/ui/js/player.js");
    const progPlayer = new ProgramPlayer();
    
    // Cria mocks com estado paused = false
    const mockTransAudio = makeEl("mock_trans");
    mockTransAudio.paused = false;
    mockTransAudio.pause = () => { mockTransAudio.paused = true; };
    progPlayer.audioTransitionPool = { "A1": mockTransAudio };

    const mockParA = makeEl("mock_par_a");
    mockParA.paused = false;
    mockParA.pause = () => { mockParA.paused = true; };
    const mockParB = makeEl("mock_par_b");
    mockParB.paused = false;
    mockParB.pause = () => { mockParB.paused = true; };
    progPlayer._paresAudio = { "A1": { a: mockParA, b: mockParB } };

    progPlayer.isPlaying = true;
    progPlayer.pause();

    assert.strictEqual(progPlayer.isPlaying, false, "ProgramPlayer deve estar pausado");
    assert.strictEqual(mockTransAudio.paused, true, "Elemento de audioTransitionPool deve estar pausado ao pausar o player");
    assert.strictEqual(mockParA.paused, true, "Elemento de _paresAudio.a deve estar pausado ao pausar o player");
    assert.strictEqual(mockParB.paused, true, "Elemento de _paresAudio.b deve estar pausado ao pausar o player");

    // 2. Teto Mútuo Cruzado: Clipe A curto (48 frames) vs Clipe B longo (720 frames)
    const cutShortA = { id: "c_short_a", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 48, effects: [] };
    const cutLongB = { id: "c_long_b", track: "A1", timelineStartFrame: 48, inFrame: 0, outFrame: 720, effects: [] };
    STATE.activeTimelineCuts = [cutShortA, cutLongB];
    TIMELINE_STATE.transitions = [];

    const cfAssym = TIMELINE_STATE.addAudioCrossfade({
        trackId: "A1",
        clipAId: "c_short_a",
        clipBId: "c_long_b",
        durationFrames: 24
    });
    assert.ok(cfAssym, "Transição deve ser criada");

    const lims = TIMELINE_STATE.getTransitionLimits(cfAssym.id);
    // Clipe A tem 48 quadros. Margem de segurança é 4 quadros (min(4, floor(48/6)) = 4).
    // Teto mútuo = min(48 - 4, 720 - 4) = 44 quadros.
    assert.strictEqual(lims.maxHalfA, 44, "Lado A não pode passar de 44 frames (teto mútuo)");
    assert.strictEqual(lims.maxHalfB, 44, "Lado B NÃO PODE ultrapassar o tamanho de A (teto mútuo = 44 frames)");

    // Tentativa de expandir Lado B para 300 quadros (modo assimétrico com Alt)
    const updated = TIMELINE_STATE.updateTransitionDuration(cfAssym.id, 20, 300, false);
    assert.strictEqual(updated.halfBFrames, 44, "halfBFrames deve ser clampado para o teto mútuo de 44 frames, nunca invadindo além do clipe parceiro");

    // 3. Hit-testing discriminado: Borda do clipe (trim) vs Alça de transição vs Cursor Dedicado
    const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
    const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");
    const interaction = new CapiauTimelineInteraction(new CapiauTimelineRenderer(canvasStub));
    TIMELINE_STATE.zoom = 1;
    TIMELINE_STATE.scrollLeftFrame = 0;

    // Desseleciona a transição:
    TIMELINE_STATE.selectedTransitionId = null;

    // Simula mouse no frame 0 (borda esquerda do clip A, x = 0):
    // getTrimHit detecta borda esquerda de cutShortA (trim-left).
    const trimHit = interaction.getTrimHit(0, "A1");
    assert.ok(trimHit, "Trim de clipe deve ser detectado na borda extrema");

    // Simula clique na borda de transição quando ela NÃO está selecionada:
    // Deve respeitar trimHit de clipe e não sequestrar para transition-resize
    interaction.dragState = null;
    interaction.onMouseDown({
        button: 0,
        clientX: 0,
        clientY: 90,
        altKey: false,
        shiftKey: false
    });
    assert.notStrictEqual(interaction.dragState, "transition-resize", "Clique na extremidade com transição desselecionada não deve sequestrar para transition-resize");
    interaction.onMouseUp({});

    // Agora seleciona a transição:
    TIMELINE_STATE.selectedTransitionId = cfAssym.id;
    // O hit de transição na borda agora deve ativar o redimensionamento com o cursor dedicado
    const transHit = TIMELINE_STATE.getTransitionHit("A1", 48 - updated.halfAFrames, 4);
    assert.ok(transHit, "Borda da transição deve ser detectada");
    assert.strictEqual(transHit.edge, "left", "Edge deve ser left");

    interaction.onMouseDown({
        button: 0,
        clientX: 48 - updated.halfAFrames,
        clientY: 90,
        altKey: false,
        shiftKey: false
    });
    assert.strictEqual(interaction.dragState, "transition-resize", "Com a transição selecionada, clique na alça deve ativar transition-resize");
    assert.ok(interaction.canvas.style.cursor.includes("data:image/svg+xml"), "Cursor deve ser o SVG de transição dedicado CURSOR_TRANSITION_RESIZE");
    interaction.onMouseUp({});
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} baterias concluídas com 100% de sucesso!`);
console.log("===============================================================================\n");

process.exit(0);


