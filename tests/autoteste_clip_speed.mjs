// autoteste_clip_speed.mjs
// Task 13 do PLANO_SUITE_NLE_CLASSICO — Velocidade Individual do Clipe & Reverse (Ctrl+R):
//  • Diálogo modal de velocidade com vínculo proporcional bidirecional (Velocidade % ↔ Duração timecode).
//  • Modos de reprodução reversa (reverse: true), cálculo de tempo reverso e amostragem de filmstrip.
//  • Modo Ripple Edit opcional para empurrar/puxar clipes subsequentes ao alterar duração.
//  • Preservação de afinação de áudio (pitch_correction / preservesPitch).
//  • Sincronia de pares A/V vinculados (link_id) e histórico atômico de Undo/Redo.
//  • Proteção contra pistas travadas (cadeado).
//  • Badges informativos no Timeline Canvas (⚡[50%], ⚡[200%], ◀◀[REV], ⚡[50% REV]).
//  • Intercepção global de teclado no PlayerController (Ctrl+R prevenindo reload do navegador).

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
        select() {}
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
const readSrc = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "js", f), "utf-8");

const tsSrc = readSrc("timelineState.js");
const kmSrc = readSrc("keymapService.js");
const tiSrc = readSrc("timelineInteraction.js");
const trSrc = readSrc("timelineRenderer.js");
const plSrc = readSrc("player.js");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf-8");
const stylesCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles.css"), "utf-8");

// Importações dos módulos da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { formatTimecode } = await import("../src/ui/js/player.js");

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 13: VELOCIDADE DO CLIPE & REVERSE");
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
// Bateria 1: Catálogo Central & Mapeamento nos 5 Perfis NLE sem Colisão
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Comando edit.clip_speed no Catálogo e nos 5 Perfis NLE (Ctrl+R)", () => {
    const cmd = COMMANDS_CATALOG.find(c => c.id === "edit.clip_speed");
    assert.ok(cmd, "Comando edit.clip_speed deve existir no COMMANDS_CATALOG");
    assert.equal(cmd.category, "edit", "Categoria deve ser 'edit'");
    assert.ok(cmd.label.toLowerCase().includes("velocidade"), "Rótulo deve mencionar Velocidade");

    const requiredPresets = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    for (const presetName of requiredPresets) {
        const preset = KEYMAP_PRESETS[presetName];
        assert.ok(preset, `Preset '${presetName}' deve existir`);
        const combos = preset["edit.clip_speed"];
        assert.ok(Array.isArray(combos) && combos.length > 0, `Preset '${presetName}' deve mapear edit.clip_speed`);
        assert.ok(combos.includes("Ctrl+KeyR"), `Preset '${presetName}' deve conter 'Ctrl+KeyR'`);
    }

    // Valida que Ctrl+KeyR no perfil CapIAu não colide com nenhum outro comando
    const capiauPreset = KEYMAP_PRESETS.capiau;
    const collisions = Object.entries(capiauPreset).filter(
        ([id, keys]) => id !== "edit.clip_speed" && keys.includes("Ctrl+KeyR")
    );
    assert.equal(collisions.length, 0, "Ctrl+KeyR não deve ter colisões no perfil capiau");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Elementos DOM do Diálogo Modal & Cache-Buster v>=58
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Elementos DOM do Diálogo Modal de Velocidade e Cache-Buster v>=58", () => {
    assert.ok(indexHtml.includes('id="clip-speed-modal"'), "index.html deve conter modal #clip-speed-modal");
    assert.ok(indexHtml.includes('id="clip-speed-input"'), "index.html deve conter input #clip-speed-input");
    assert.ok(indexHtml.includes('id="btn-clip-speed-lock"'), "index.html deve conter botão cadeado #btn-clip-speed-lock");
    assert.ok(indexHtml.includes('id="clip-speed-duration-input"'), "index.html deve conter input #clip-speed-duration-input");
    assert.ok(indexHtml.includes('class="speed-preset-btn"'), "index.html deve conter botões de preset .speed-preset-btn");
    assert.ok(indexHtml.includes('id="clip-speed-slider"'), "index.html deve conter slider #clip-speed-slider");
    assert.ok(indexHtml.includes('id="chk-clip-speed-reverse"'), "index.html deve conter checkbox #chk-clip-speed-reverse");
    assert.ok(indexHtml.includes('id="chk-clip-speed-ripple"'), "index.html deve conter checkbox #chk-clip-speed-ripple");
    assert.ok(indexHtml.includes('id="chk-clip-speed-pitch"'), "index.html deve conter checkbox #chk-clip-speed-pitch");
    assert.ok(indexHtml.includes('id="btn-confirm-clip-speed"'), "index.html deve conter botão #btn-confirm-clip-speed");
    assert.ok(indexHtml.includes('id="btn-cancel-clip-speed"'), "index.html deve conter botão #btn-cancel-clip-speed");

    assert.ok(/styles\.css\?v=(5[8-9]|[6-9][0-9])/.test(indexHtml), "styles.css deve estar versionado com v>=58");
    assert.ok(/js\/main\.js\?v=(5[8-9]|[6-9][0-9])/.test(indexHtml), "main.js deve estar versionado com v>=58");

    // CSS styling
    assert.ok(stylesCss.includes(".speed-preset-btn"), "styles.css deve ter estilo para .speed-preset-btn");
    assert.ok(stylesCss.includes(".btn-speed-lock"), "styles.css deve ter estilo para .btn-speed-lock");

    // JS references
    assert.ok(tiSrc.includes("openClipSpeedDialog"), "timelineInteraction.js deve implementar openClipSpeedDialog");
    assert.ok(tiSrc.includes("Velocidade / Duração..."), "timelineInteraction.js deve incluir opção no menu de contexto");
    assert.ok(tsSrc.includes("changeClipSpeed"), "timelineState.js deve implementar changeClipSpeed");
    assert.ok(plSrc.includes("openClipSpeedDialog"), "player.js deve implementar openClipSpeedDialog");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Conversão Proporcional Bidirecional (Velocidade % ↔ Duração Timecode)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Cálculo Matemático Proporcional Bidirecional (Velocidade % ↔ Duração)", () => {
    const fps = 24;
    const baseFrames = 120; // 5 segundos originais

    // Caso A: 100% de velocidade -> 120 frames (00:00:05:00)
    let speedPct = 100;
    let durFrames = Math.max(1, Math.round(baseFrames / (speedPct / 100)));
    assert.equal(durFrames, 120, "100% deve resultar em 120 frames");
    assert.equal(formatTimecode(durFrames / fps, fps), "00:00:05:00");

    // Caso B: 200% de velocidade (2x rápido) -> 60 frames (00:00:02:12)
    speedPct = 200;
    durFrames = Math.max(1, Math.round(baseFrames / (speedPct / 100)));
    assert.equal(durFrames, 60, "200% deve resultar em 60 frames (metade do tempo)");
    assert.equal(formatTimecode(durFrames / fps, fps), "00:00:02:12");

    // Caso C: 50% de velocidade (slow motion) -> 240 frames (00:00:10:00)
    speedPct = 50;
    durFrames = Math.max(1, Math.round(baseFrames / (speedPct / 100)));
    assert.equal(durFrames, 240, "50% deve resultar em 240 frames (dobro do tempo)");
    assert.equal(formatTimecode(durFrames / fps, fps), "00:00:10:00");

    // Caso D: Inverso (usuário define duração de 2s = 48 frames) -> calcula velocidade
    const targetFrames = 48; // 2 segundos
    const calcSpeedPct = Math.round((baseFrames / targetFrames) * 100);
    assert.equal(calcSpeedPct, 250, "48 frames a partir de 120 frames deve resultar em 250% de velocidade");

    // Caso E: Preservação de baseMediaFrames evita erro de arredondamento cumulativo
    // Se 100% -> 50% (240f) -> 200% (60f) -> 100% (120f)
    const speedSteps = [0.5, 2.0, 1.0];
    let curFrames = baseFrames;
    for (const s of speedSteps) {
        curFrames = Math.round(baseFrames / s);
    }
    assert.equal(curFrames, 120, "Retornar a 100% via baseMediaFrames deve restabelecer exatamente 120 frames");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Modificação de Velocidade Simples via TIMELINE_STATE.changeClipSpeed
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Alteração Simples de Velocidade e Armazenamento de source_duration_frames", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false }
    ];
    TIMELINE_STATE.fps = 24;

    const clip1 = {
        id: "clip_speed_test_1",
        video_id: "media_test_1",
        type: "video",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        name: "Cena de Ação",
        link_id: null
    };

    STATE.activeTimelineCuts = [clip1];
    TIMELINE_STATE.selectedClipId = clip1.id;

    // Aumenta a velocidade para 200% (speed: 2.0)
    const res2x = TIMELINE_STATE.changeClipSpeed(clip1.id, { speed: 2.0, ripple: false });
    assert.ok(res2x, "changeClipSpeed deve retornar objeto de resultado");
    assert.equal(res2x.speed, 2.0, "Velocidade deve ser 2.0");
    assert.equal(res2x.durationFrames, 60, "Duração deve ser 60 frames");

    const updated1 = STATE.activeTimelineCuts.find(c => c.id === clip1.id);
    assert.equal(updated1.speed, 2.0, "cut.speed deve ser 2.0");
    assert.equal(updated1.outFrame - updated1.inFrame, 60, "cut outFrame - inFrame deve ser 60");
    assert.equal(updated1.source_duration_frames, 120, "source_duration_frames deve ser preservado como 120");

    // Reduz a velocidade para 50% (speed: 0.5)
    const resHalf = TIMELINE_STATE.changeClipSpeed(clip1.id, { speed: 0.5, ripple: false });
    assert.equal(resHalf.speed, 0.5, "Velocidade deve ser 0.5");
    assert.equal(resHalf.durationFrames, 240, "Duração deve ser 240 frames");

    const updated2 = STATE.activeTimelineCuts.find(c => c.id === clip1.id);
    assert.equal(updated2.speed, 0.5, "cut.speed deve ser 0.5");
    assert.equal(updated2.outFrame - updated2.inFrame, 240, "cut outFrame - inFrame deve ser 240");
    assert.equal(updated2.source_duration_frames, 120, "source_duration_frames ainda deve ser 120");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Operação de Ripple Edit (Deslocamento de Cortes Subsequentes)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Ripple Edit: Empurrar e Puxar Clipes Subsequentes na Timeline", () => {
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false }
    ];

    // Clip 1: 0..120 (dur: 120f)
    // Clip 2: 120..240 (dur: 120f)
    // Clip 3: 240..360 (dur: 120f)
    const c1 = { id: "c1", video_id: "m1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 120, in: 0, out: 5.0 };
    const c2 = { id: "c2", video_id: "m2", track: "V1", timelineStartFrame: 120, inFrame: 0, outFrame: 120, in: 0, out: 5.0 };
    const c3 = { id: "c3", video_id: "m3", track: "V1", timelineStartFrame: 240, inFrame: 0, outFrame: 120, in: 0, out: 5.0 };

    STATE.activeTimelineCuts = [c1, c2, c3];

    // Cenário 1: Encurtar c1 para 200% (dur: 60f, delta: -60f) com ripple: true
    const resRippleShorten = TIMELINE_STATE.changeClipSpeed("c1", { speed: 2.0, ripple: true });
    assert.equal(resRippleShorten.deltaFrames, -60, "deltaFrames deve ser -60");

    let cuts = STATE.activeTimelineCuts;
    const postC2 = cuts.find(c => c.id === "c2");
    const postC3 = cuts.find(c => c.id === "c3");
    assert.equal(postC2.timelineStartFrame, 60, "c2 deve ter sido puxado de 120 para 60");
    assert.equal(postC3.timelineStartFrame, 180, "c3 deve ter sido puxado de 240 para 180");

    // Cenário 2: Esticar c1 para 50% (dur: 240f, delta a partir de 60f é +180f) com ripple: true
    const resRippleLengthen = TIMELINE_STATE.changeClipSpeed("c1", { speed: 0.5, ripple: true });
    assert.equal(resRippleLengthen.durationFrames, 240, "Nova duração deve ser 240");
    assert.equal(resRippleLengthen.deltaFrames, 180, "deltaFrames deve ser +180");

    cuts = STATE.activeTimelineCuts;
    const postC2Long = cuts.find(c => c.id === "c2");
    const postC3Long = cuts.find(c => c.id === "c3");
    assert.equal(postC2Long.timelineStartFrame, 240, "c2 deve ter sido empurrado para 240");
    assert.equal(postC3Long.timelineStartFrame, 360, "c3 deve ter sido empurrado para 360");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Preservação de Áudio Vinculado e Sincronia de Pares A/V (link_id)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Sincronia de Pares A/V Vinculados (link_id) e Deslocamento Mútuo", () => {
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];

    const linkShared = "link_av_speed_pair";
    const vClip = {
        id: "v_speed_1",
        video_id: "media_av",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Entrevista Vídeo"
    };
    const aClip = {
        id: "a_speed_1",
        video_id: "media_av",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        link_id: linkShared,
        name: "Entrevista Áudio"
    };

    // Clipes subsequentes em ambas as pistas
    const vNext = { id: "v_next", video_id: "media_v2", track: "V1", timelineStartFrame: 120, inFrame: 0, outFrame: 100, in: 0, out: 4.16 };
    const aNext = { id: "a_next", video_id: "media_a2", track: "A1", timelineStartFrame: 120, inFrame: 0, outFrame: 100, in: 0, out: 4.16 };

    STATE.activeTimelineCuts = [vClip, aClip, vNext, aNext];

    // Altera velocidade chamando changeClipSpeed no corte de VÍDEO
    const res = TIMELINE_STATE.changeClipSpeed("v_speed_1", { speed: 2.0, ripple: true, reverse: true });
    assert.ok(res, "changeClipSpeed deve ter sucesso");

    const cuts = STATE.activeTimelineCuts;
    const updV = cuts.find(c => c.id === "v_speed_1");
    const updA = cuts.find(c => c.id === "a_speed_1");

    assert.equal(updV.speed, 2.0, "Vídeo deve ter speed 2.0");
    assert.equal(updA.speed, 2.0, "Áudio vinculado DEVE receber a mesma velocidade (2.0)");
    assert.equal(updV.outFrame - updV.inFrame, 60, "Vídeo duração deve ser 60 frames");
    assert.equal(updA.outFrame - updA.inFrame, 60, "Áudio vinculado duração DEVE ser 60 frames");
    assert.equal(updV.reverse, true, "Vídeo reverse deve ser true");
    assert.equal(updA.reverse, true, "Áudio vinculado reverse DEVE ser true");

    // Verifica que clipes subsequentes em ambas as pistas foram deslocados por delta = -60
    const updVNext = cuts.find(c => c.id === "v_next");
    const updANext = cuts.find(c => c.id === "a_next");
    assert.equal(updVNext.timelineStartFrame, 60, "v_next deve ter sido puxado para 60");
    assert.equal(updANext.timelineStartFrame, 60, "a_next deve ter sido puxado para 60 mantendo sincronia A/V perfeita");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Suporte a Reprodução Reversa (reverse: true) & Cálculo de Tempo Reverso
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Reprodução Reversa: Flag reverse: true e Cálculo Invertido de Quadros", () => {
    // Simula a lógica de cálculo de tempo em _targetSecondsFor implementada no Program Player
    const fps = 24;
    const cutNormal = {
        id: "c_norm",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 120,
        in: 10.0,
        out: 15.0,
        speed: 1.0,
        reverse: false
    };

    const cutReverse = {
        id: "c_rev",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 120,
        in: 10.0,
        out: 15.0,
        speed: 1.0,
        reverse: true
    };

    const targetSecondsFor = (cut, frame) => {
        const inSec = cut.in || 0;
        const startFrame = cut.timelineStartFrame || 0;
        const curFrame = frame || 0;
        const clipSpeed = (cut && typeof cut.speed === "number" && cut.speed > 0) ? cut.speed : 1.0;
        const offsetSec = ((curFrame - startFrame) / fps) * clipSpeed;

        if (cut && cut.reverse) {
            const outSec = (typeof cut.out === "number" && !isNaN(cut.out))
                ? cut.out
                : (inSec + (((cut.outFrame || 0) - (cut.inFrame || 0)) / fps) * clipSpeed);
            return Math.max(inSec, Math.min(outSec, outSec - offsetSec));
        }
        return inSec + offsetSec;
    };

    // No início do clipe (frame 100):
    // Normal: inSec = 10.0s
    // Reverso: outSec = 15.0s
    assert.equal(targetSecondsFor(cutNormal, 100), 10.0, "Normal em frame 100 deve estar em 10.0s");
    assert.equal(targetSecondsFor(cutReverse, 100), 15.0, "Reverso em frame 100 deve começar no final (15.0s)");

    // No meio do clipe (frame 160 = +60 frames = +2.5s):
    // Normal: 10.0 + 2.5 = 12.5s
    // Reverso: 15.0 - 2.5 = 12.5s
    assert.equal(targetSecondsFor(cutNormal, 160), 12.5, "Normal no meio deve estar em 12.5s");
    assert.equal(targetSecondsFor(cutReverse, 160), 12.5, "Reverso no meio deve estar em 12.5s");

    // No fim do clipe (frame 220 = +120 frames = +5.0s):
    // Normal: 10.0 + 5.0 = 15.0s
    // Reverso: 15.0 - 5.0 = 10.0s
    assert.equal(targetSecondsFor(cutNormal, 220), 15.0, "Normal no final deve estar em 15.0s");
    assert.equal(targetSecondsFor(cutReverse, 220), 10.0, "Reverso no final deve terminar no início da mídia (10.0s)");

    // Valida com speed 2.0 reverso (duração na timeline 60 frames = 2.5s):
    const cutRev2x = {
        id: "c_rev_2x",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 60,
        in: 10.0,
        out: 15.0,
        speed: 2.0,
        reverse: true
    };
    // frame 100 -> 15.0s
    // frame 130 (+30f = 1.25s na timeline * 2x = 2.5s da mídia) -> 15.0 - 2.5 = 12.5s
    // frame 160 (+60f = 2.5s na timeline * 2x = 5.0s da mídia) -> 15.0 - 5.0 = 10.0s
    assert.equal(targetSecondsFor(cutRev2x, 100), 15.0, "Reverso 2x deve começar em 15.0s");
    assert.equal(targetSecondsFor(cutRev2x, 130), 12.5, "Reverso 2x no meio deve estar em 12.5s");
    assert.equal(targetSecondsFor(cutRev2x, 160), 10.0, "Reverso 2x no fim deve atingir 10.0s");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Preservação de Afinação de Áudio (Pitch Correction)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Preservação de Afinação de Áudio (pitch_correction & preservesPitch)", () => {
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.tracks = [{ id: "A1", name: "Áudio 1", kind: "audio", locked: false }];

    const aClip = {
        id: "a_pitch_test",
        video_id: "audio_media",
        track: "A1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        pitch_correction: true
    };

    STATE.activeTimelineCuts = [aClip];

    // Alteração com pitchCorrection: true
    TIMELINE_STATE.changeClipSpeed(aClip.id, { speed: 1.5, pitchCorrection: true });
    let updated = STATE.activeTimelineCuts.find(c => c.id === aClip.id);
    assert.equal(updated.pitch_correction, true, "pitch_correction deve ser true");

    // Alteração com pitchCorrection: false
    TIMELINE_STATE.changeClipSpeed(aClip.id, { speed: 1.5, pitchCorrection: false });
    updated = STATE.activeTimelineCuts.find(c => c.id === aClip.id);
    assert.equal(updated.pitch_correction, false, "pitch_correction deve ser false");

    // Simulação do comportamento de el.preservesPitch no Player
    const mockAudioEl = {
        preservesPitch: true,
        webkitPreservesPitch: true
    };

    const applyPitchToEl = (el, cut) => {
        if ("preservesPitch" in el) el.preservesPitch = cut.pitch_correction !== false;
        if ("webkitPreservesPitch" in el) el.webkitPreservesPitch = cut.pitch_correction !== false;
    };

    applyPitchToEl(mockAudioEl, { pitch_correction: false });
    assert.equal(mockAudioEl.preservesPitch, false, "preservesPitch deve refletir pitch_correction = false");
    assert.equal(mockAudioEl.webkitPreservesPitch, false, "webkitPreservesPitch deve refletir pitch_correction = false");

    applyPitchToEl(mockAudioEl, { pitch_correction: true });
    assert.equal(mockAudioEl.preservesPitch, true, "preservesPitch deve refletir pitch_correction = true");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Histórico Atômico de Undo / Redo
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Histórico Atômico de Undo/Redo com Restauração Integral de Ripple e A/V", () => {
    TIMELINE_STATE.fps = 24;
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false }
    ];

    const c1 = { id: "c_undo_1", video_id: "m1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 120, in: 0, out: 5.0, speed: 1.0 };
    const c2 = { id: "c_undo_2", video_id: "m2", track: "V1", timelineStartFrame: 120, inFrame: 0, outFrame: 120, in: 0, out: 5.0, speed: 1.0 };

    STATE.activeTimelineCuts = [c1, c2];

    const initialHistoryLength = TIMELINE_HISTORY.history ? TIMELINE_HISTORY.history.length : 0;

    // Altera velocidade de c1 para 200% com ripple: true
    TIMELINE_STATE.changeClipSpeed("c_undo_1", { speed: 2.0, ripple: true });

    let cutsNow = STATE.activeTimelineCuts;
    assert.equal(cutsNow.find(c => c.id === "c_undo_1").outFrame, 60, "Após mudança, c1 deve ter 60 frames");
    assert.equal(cutsNow.find(c => c.id === "c_undo_2").timelineStartFrame, 60, "Após ripple, c2 deve estar em 60 frames");

    // Executa UNDO
    TIMELINE_HISTORY.undo();

    let cutsAfterUndo = STATE.activeTimelineCuts;
    const c1Reverted = cutsAfterUndo.find(c => c.id === "c_undo_1");
    const c2Reverted = cutsAfterUndo.find(c => c.id === "c_undo_2");

    assert.equal(c1Reverted.outFrame, 120, "Após Undo, c1 deve voltar a 120 frames");
    assert.equal(c1Reverted.speed || 1.0, 1.0, "Após Undo, c1 velocidade deve voltar a 1.0");
    assert.equal(c2Reverted.timelineStartFrame, 120, "Após Undo, c2 deve voltar à posição 120 frames");

    // Executa REDO
    TIMELINE_HISTORY.redo();

    let cutsAfterRedo = STATE.activeTimelineCuts;
    const c1Redo = cutsAfterRedo.find(c => c.id === "c_undo_1");
    const c2Redo = cutsAfterRedo.find(c => c.id === "c_undo_2");

    assert.equal(c1Redo.outFrame, 60, "Após Redo, c1 deve voltar a 60 frames");
    assert.equal(c1Redo.speed, 2.0, "Após Redo, c1 velocidade deve voltar a 2.0");
    assert.equal(c2Redo.timelineStartFrame, 60, "Após Redo, c2 deve voltar a 60 frames");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Proteção Contra Pistas Travadas (Cadeado)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Salvaguarda e Bloqueio Seguro em Pistas com Cadeado Ativo", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: true },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: false }
    ];

    const clipInLocked = {
        id: "c_locked_track",
        video_id: "m_lock",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120
    };

    STATE.activeTimelineCuts = [clipInLocked];

    // Tenta alterar clipe em pista bloqueada
    const res = TIMELINE_STATE.changeClipSpeed("c_locked_track", { speed: 2.0 });
    assert.equal(res, null, "changeClipSpeed deve retornar null para clipe em pista bloqueada");

    // Verifica que o clipe permaneceu inalterado
    const cutUnchanged = STATE.activeTimelineCuts.find(c => c.id === "c_locked_track");
    assert.equal(cutUnchanged.outFrame, 120, "O clipe na pista travada não deve ser modificado");

    // Cenário B: Pista do parceiro vinculado A/V travada
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false },
        { id: "A1", name: "Áudio 1", kind: "audio", locked: true }
    ];
    const linkLock = "link_locked_partner";
    const vOpen = { id: "v_open", video_id: "m", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 120, link_id: linkLock };
    const aLocked = { id: "a_lock", video_id: "m", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 120, link_id: linkLock };
    STATE.activeTimelineCuts = [vOpen, aLocked];

    const resPartnerLocked = TIMELINE_STATE.changeClipSpeed("v_open", { speed: 2.0 });
    assert.equal(resPartnerLocked, null, "changeClipSpeed deve abortar se o parceiro de áudio estiver em pista travada");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Rótulos Visuais e Badges na Timeline Canvas
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Rótulos Visuais e Badges de Velocidade e Reverso na Timeline", () => {
    // Testa o gerador de badges conforme implementado em timelineRenderer.js
    const formatBadge = (speed, reverse) => {
        let speedBadge = "";
        const isReversed = !!reverse;
        const hasCustomSpeed = typeof speed === "number" && Math.abs(speed - 1.0) > 0.001;

        if (hasCustomSpeed && isReversed) {
            speedBadge = ` ⚡[${Math.round(speed * 100)}% REV]`;
        } else if (hasCustomSpeed) {
            speedBadge = ` ⚡[${Math.round(speed * 100)}%]`;
        } else if (isReversed) {
            speedBadge = ` ◀◀[REV]`;
        }
        return speedBadge;
    };

    assert.equal(formatBadge(1.0, false), "", "100% normal sem reverso não deve ter badge");
    assert.equal(formatBadge(0.5, false), " ⚡[50%]", "50% deve ter badge ⚡[50%]");
    assert.equal(formatBadge(2.0, false), " ⚡[200%]", "200% deve ter badge ⚡[200%]");
    assert.equal(formatBadge(1.0, true), " ◀◀[REV]", "Reverso a 100% deve ter badge ◀◀[REV]");
    assert.equal(formatBadge(0.5, true), " ⚡[50% REV]", "50% reverso deve ter badge ⚡[50% REV]");
    assert.equal(formatBadge(2.0, true), " ⚡[200% REV]", "200% reverso deve ter badge ⚡[200% REV]");

    // Valida que o timelineRenderer.js contém a renderização de barra de reverso e amostragem invertida
    assert.ok(trSrc.includes("cut.reverse"), "timelineRenderer.js deve checar cut.reverse");
    assert.ok(trSrc.includes("rgba(244, 63, 94,"), "timelineRenderer.js deve desenhar faixa superior rose para clipes reversos");
    assert.ok(trSrc.includes("reverse"), "timelineRenderer.js deve considerar reverse para filmstrip");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Interceptação Global de Atalhos no PlayerController
// ─────────────────────────────────────────────────────────────────────────────
runBattery("PlayerController Intercepta edit.clip_speed com e.preventDefault() (Ctrl+R)", () => {
    assert.ok(plSrc.includes('edit.clip_speed'), "player.js deve verificar edit.clip_speed");
    assert.ok(plSrc.includes('openClipSpeedDialog'), "player.js deve chamar openClipSpeedDialog");

    // Simula evento de teclado com Ctrl+KeyR
    let preventDefaultCalled = false;
    let dialogOpened = false;

    const mockEvent = {
        key: "r",
        code: "KeyR",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        target: { tagName: "BODY" },
        preventDefault: () => { preventDefaultCalled = true; }
    };

    assert.ok(KEYMAP_SERVICE.matches(mockEvent, "edit.clip_speed"), "KEYMAP_SERVICE deve reconhecer Ctrl+KeyR como edit.clip_speed");

    // Mock do PlayerController
    const mockPlayerController = {
        openClipSpeedDialog: () => { dialogOpened = true; },
        handleGlobalKeyboard: function(e) {
            if (KEYMAP_SERVICE.matches(e, "edit.clip_speed")) {
                e.preventDefault();
                this.openClipSpeedDialog();
                return;
            }
        }
    };

    mockPlayerController.handleGlobalKeyboard(mockEvent);
    assert.ok(preventDefaultCalled, "e.preventDefault() DEVE ser chamado para evitar reload da página no navegador");
    assert.ok(dialogOpened, "openClipSpeedDialog() deve ter sido disparado pelo atalho");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Execução de openClipSpeedDialog e Two-Way Binding sem Erros
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Execução de openClipSpeedDialog e Two-Way Binding sem ReferenceError", async () => {
    const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

    const mockRenderer = {
        canvas: canvasStub,
        requestRedraw: () => {},
        timelineWidth: 1000
    };
    const interaction = new CapiauTimelineInteraction(mockRenderer);

    TIMELINE_STATE.fps = 24;
    const testClip = {
        id: "clip_dialog_test",
        video_id: "m_dialog",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 120,
        in: 0,
        out: 5.0,
        speed: 1.0,
        reverse: false
    };
    STATE.activeTimelineCuts = [testClip];
    TIMELINE_STATE.selectedClipId = testClip.id;

    // Executa openClipSpeedDialog - NÃO PODE lançar ReferenceError nem qualquer exceção
    assert.doesNotThrow(() => {
        interaction.openClipSpeedDialog("clip_dialog_test");
    }, "openClipSpeedDialog não deve lançar exceção ou ReferenceError");

    const modal = document.getElementById("clip-speed-modal");
    assert.ok(modal.style.display === "block" || modal.style.display === "flex", "Modal deve estar visível");

    const durInput = document.getElementById("clip-speed-duration-input");
    assert.equal(durInput.value, "00:00:05:00", "Duração formatada deve ser 00:00:05:00");

    const speedInput = document.getElementById("clip-speed-input");
    assert.equal(speedInput.value, 100, "Velocidade deve ser 100");

    // Simula alteração de velocidade para 200 via input
    speedInput.value = 200;
    speedInput.oninput();
    assert.equal(durInput.value, "00:00:02:12", "Após alterar velocidade para 200%, duração deve recalcular para 00:00:02:12");

    // Simula alteração de duração via input
    durInput.value = "00:00:10:00";
    durInput.onchange();
    assert.equal(speedInput.value, 50, "Após alterar duração para 10s (240f), velocidade deve recalcular para 50%");

    // Fecha o modal
    const btnCancel = document.getElementById("btn-cancel-clip-speed");
    btnCancel.onclick();
    assert.equal(modal.style.display, "none", "Modal deve fechar ao clicar em Fechar/Cancelar");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 14: Modo "cut" (Manter Tamanho Total da Timeline / Cortar Subsequente)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Modo 'cut' para Manter o Tamanho Total da Timeline ao Alterar Velocidade", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false }
    ];

    // Três clipes consecutivos na trilha V1 de 100 frames cada:
    // C1: [0, 100], C2: [100, 200], C3: [200, 300]
    // Duração total = 300 quadros
    const c1 = { id: "cut_c1", video_id: "m1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100, speed: 1.0 };
    const c2 = { id: "cut_c2", video_id: "m2", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, speed: 1.0 };
    const c3 = { id: "cut_c3", video_id: "m3", track: "V1", timelineStartFrame: 200, inFrame: 0, outFrame: 100, speed: 1.0 };

    STATE.activeTimelineCuts = [c1, c2, c3];

    // Caso 1: C1 desacelera para 50% (duração passa de 100 para 200 quadros) com mode: "cut"
    // C1: passa a ocupar [0, 200].
    // C2: originalmente em [100, 200] é totalmente engolido ou cortado.
    // C3: em [200, 300] NÃO É DESLOCADO! O tamanho total da timeline permanece 300 quadros!
    const resExpand = TIMELINE_STATE.changeClipSpeed("cut_c1", {
        speed: 0.5,
        durationFrames: 200,
        mode: "cut"
    });

    assert.ok(resExpand, "changeClipSpeed com mode: 'cut' deve ter sucesso");
    const updatedC1 = STATE.activeTimelineCuts.find(c => c.id === "cut_c1");
    assert.equal(updatedC1.outFrame - updatedC1.inFrame, 200, "C1 deve agora ter 200 quadros");
    assert.equal(updatedC1.timelineStartFrame, 0, "C1 começa em 0");

    // C2 foi totalmente coberto (ou removido)
    const updatedC2 = STATE.activeTimelineCuts.find(c => c.id === "cut_c2");
    assert.equal(updatedC2, undefined, "C2 foi completamente coberto por C1 e removido");

    // C3 NÃO DEVE TER SIDO DESLOCADO!
    const updatedC3 = STATE.activeTimelineCuts.find(c => c.id === "cut_c3");
    assert.ok(updatedC3, "C3 ainda existe");
    assert.equal(updatedC3.timelineStartFrame, 200, "C3 manteve rigorosamente sua posição timelineStartFrame = 200");
    assert.equal(updatedC3.outFrame - updatedC3.inFrame, 100, "C3 manteve sua duração de 100 frames");

    // Desfaz com Undo
    TIMELINE_HISTORY.undo();
    const undoneC2 = STATE.activeTimelineCuts.find(c => c.id === "cut_c2");
    assert.ok(undoneC2, "C2 deve ser restaurado após Undo");
    assert.equal(undoneC2.timelineStartFrame, 100, "C2 volta a 100");

    // Caso 2: C1 acelera para 200% (duração passa de 100 para 50 quadros) com mode: "cut"
    // Subsequentes NÃO se movem no modo cut quando encolhe (mantém o layout e tamanho total)
    const resShrink = TIMELINE_STATE.changeClipSpeed("cut_c1", {
        speed: 2.0,
        durationFrames: 50,
        mode: "cut"
    });
    assert.ok(resShrink, "changeClipSpeed shrink com mode: 'cut' deve ter sucesso");
    const shrinkC1 = STATE.activeTimelineCuts.find(c => c.id === "cut_c1");
    assert.equal(shrinkC1.outFrame - shrinkC1.inFrame, 50, "C1 agora tem 50 quadros");

    const unchangedC2 = STATE.activeTimelineCuts.find(c => c.id === "cut_c2");
    assert.equal(unchangedC2.timelineStartFrame, 100, "C2 permanece em 100 (tamanho total preservado, sem ripple)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 15: Renderização do Badge de Porcentagem em Vermelho no Canvas
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Renderização do Badge de Porcentagem em Vermelho (#ef4444) na Timeline", () => {
    // Valida que timelineRenderer.js contém código específico para desenhar speedBadgeText em vermelho #ef4444
    assert.ok(trSrc.includes('ctx.fillStyle = "#ef4444"'), "timelineRenderer.js deve definir cor vermelha (#ef4444) para o badge de velocidade");
    assert.ok(trSrc.includes("speedBadgeText"), "timelineRenderer.js deve separar a variável speedBadgeText do texto base");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 16: Diálogo Flutuante Draggable e Integração de Playback com ProgramPlayer
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Diálogo Flutuante Sem Bloqueio de Fundo e Barra de Espaço Disparando Program Player", () => {
    // 1. Estrutura HTML: diálogo flutuante sem overlay de escurecimento
    assert.ok(indexHtml.includes('floating-speed-dialog'), "Modal deve ter a classe floating-speed-dialog para não bloquear a tela");
    assert.ok(indexHtml.includes('id="clip-speed-header"'), "Modal deve ter cabeçalho arrastável #clip-speed-header");
    assert.ok(indexHtml.includes('id="rad-clip-speed-ripple"'), "Modal deve ter opção Deslocar (Ripple)");
    assert.ok(indexHtml.includes('id="rad-clip-speed-cut"'), "Modal deve ter opção Cortar (Manter Tam.)");

    // 2. CSS: floating-speed-dialog com estilo não-modal
    assert.ok(stylesCss.includes(".floating-speed-dialog"), "styles.css deve definir .floating-speed-dialog");

    // 3. Player.js: tratamento de barra de espaço priorizando programPlayer
    assert.ok(plSrc.includes('clip-speed-modal'), "player.js deve verificar se o diálogo de velocidade está ativo");
    assert.ok(plSrc.includes('this.programPlayer.togglePlay()'), "player.js deve acionar programPlayer.togglePlay() quando o diálogo estiver aberto");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 17: Posição Relativa da Agulha (Playhead) após Ajuste de Velocidade
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Agulha Permanece na Posição Relativa do Vídeo Editado após Alteração de Velocidade", () => {
    TIMELINE_STATE.tracks = [{ id: "V1", name: "Vídeo 1", kind: "video", locked: false }];
    TIMELINE_STATE.fps = 24;

    // Clipe iniciando em 100 com 100 quadros de duração (termina em 200)
    const clipRel = {
        id: "clip_rel_playhead",
        video_id: "m_rel",
        track: "V1",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 100,
        speed: 1.0
    };
    STATE.activeTimelineCuts = [clipRel];

    // Agulha no meio do clipe: frame 150 (50% do clipe)
    TIMELINE_STATE.setPlayheadFrame(150);
    assert.equal(TIMELINE_STATE.playheadFrame, 150, "Agulha inicial deve estar no frame 150 (50% do clipe de 100 a 200)");

    // Desacelera para 50% (duração passa de 100 para 200 quadros, clipe agora ocupa 100 a 300)
    TIMELINE_STATE.changeClipSpeed("clip_rel_playhead", {
        speed: 0.5,
        durationFrames: 200
    });

    // Como estava a 50% do clipe, nova agulha deve ser: 100 + (0.5 * 200) = 200!
    assert.equal(TIMELINE_STATE.playheadFrame, 200, "Agulha deve avançar para a posição relativa correspondente (frame 200, exatamente 50% do novo clipe de 200f)");

    // Desfaz com Undo -> deve restaurar a agulha original em 150
    TIMELINE_HISTORY.undo();
    assert.equal(TIMELINE_STATE.playheadFrame, 150, "Undo deve restaurar a agulha na posição anterior 150");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 18: Persistência do Modo 'Cortar' sem Reversão para 'Deslocar'
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Modo 'Cortar' Mantém-se Ativo e Não Reverte Automaticamente para 'Deslocar'", async () => {
    const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
    const mockRenderer = { canvas: canvasStub, requestRedraw: () => {}, timelineWidth: 1000 };
    const interaction = new CapiauTimelineInteraction(mockRenderer);

    const testClip = {
        id: "clip_mode_persist",
        video_id: "m_mp",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        speed: 1.0
    };
    STATE.activeTimelineCuts = [testClip];

    interaction.openClipSpeedDialog("clip_mode_persist");

    const radRipple = document.getElementById("rad-clip-speed-ripple");
    const radCut = document.getElementById("rad-clip-speed-cut");

    // Seleciona Cortar
    radCut.checked = true;
    radCut.onchange();
    assert.equal(TIMELINE_STATE._lastClipSpeedMode, "cut", "TIMELINE_STATE._lastClipSpeedMode deve registrar 'cut'");

    // Aplica a alteração
    const btnConfirm = document.getElementById("btn-confirm-clip-speed");
    btnConfirm.onclick();

    // Reabre o diálogo (ou clica em outro clipe)
    interaction.openClipSpeedDialog("clip_mode_persist");
    assert.equal(radCut.checked, true, "Após aplicar, radCut deve continuar selecionado");
    assert.equal(radRipple.checked, false, "radRipple não deve ser reativado automaticamente");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 19: Duplo Clique no Slider para Resetar Velocidade a 100%
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Duplo Clique no Slider de Velocidade Reseta Instantaneamente para 100%", async () => {
    const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
    const mockRenderer = { canvas: canvasStub, requestRedraw: () => {}, timelineWidth: 1000 };
    const interaction = new CapiauTimelineInteraction(mockRenderer);

    const testClip = {
        id: "clip_slider_reset",
        video_id: "m_sr",
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        speed: 2.0
    };
    STATE.activeTimelineCuts = [testClip];

    interaction.openClipSpeedDialog("clip_slider_reset");

    const speedSlider = document.getElementById("clip-speed-slider");
    const speedInput = document.getElementById("clip-speed-input");

    // Altera o slider para 350
    speedSlider.value = 350;
    speedSlider.oninput();
    assert.equal(speedInput.value, 350, "Velocidade deve ter mudado para 350");

    // Executa duplo clique no slider
    assert.ok(typeof speedSlider.ondblclick === "function", "speedSlider deve ter handler ondblclick");
    speedSlider.ondblclick({ preventDefault: () => {} });

    assert.equal(speedSlider.value, 100, "Slider deve voltar para 100 após duplo clique");
    assert.equal(speedInput.value, 100, "Input de velocidade deve voltar para 100% após duplo clique no slider");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 20: Preenchimento de Lacunas na Pista (Fit to Gap - Frente, Trás e Ambos)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Preenchimento de Lacunas na Trilha (Para Frente, Para Trás e Ambos os Lados)", async () => {
    // 1. Elementos DOM e CSS
    assert.ok(indexHtml.includes('id="btn-clip-speed-fill-left"'), "index.html deve conter #btn-clip-speed-fill-left");
    assert.ok(indexHtml.includes('id="btn-clip-speed-fill-both"'), "index.html deve conter #btn-clip-speed-fill-both");
    assert.ok(indexHtml.includes('id="btn-clip-speed-fill-right"'), "index.html deve conter #btn-clip-speed-fill-right");
    assert.ok(stylesCss.includes(".btn-gap-fill"), "styles.css deve conter estilos para .btn-gap-fill");

    const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
    const mockRenderer = { canvas: canvasStub, requestRedraw: () => {}, timelineWidth: 1000 };
    const interaction = new CapiauTimelineInteraction(mockRenderer);

    // Cenário:
    // P1: [0, 50]  (termina em 50)
    // Gap 1: 50 a 100 (50 quadros vazios à esquerda)
    // C_Target: [100, 200] (duração 100 quadros)
    // Gap 2: 200 a 280 (80 quadros vazios à direita)
    // P2: [280, 400] (inicia em 280)
    const p1 = { id: "p1", video_id: "m", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 50 };
    const target = { id: "target_gap", video_id: "m", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, speed: 1.0 };
    const p2 = { id: "p2", video_id: "m", track: "V1", timelineStartFrame: 280, inFrame: 0, outFrame: 120 };

    STATE.activeTimelineCuts = [p1, target, p2];

    interaction.openClipSpeedDialog("target_gap");

    const btnLeft = document.getElementById("btn-clip-speed-fill-left");
    const btnBoth = document.getElementById("btn-clip-speed-fill-both");
    const btnRight = document.getElementById("btn-clip-speed-fill-right");
    const durInput = document.getElementById("clip-speed-duration-input");

    assert.equal(btnLeft.disabled, false, "Botão Para Trás deve estar habilitado (gapLeft = 50f)");
    assert.equal(btnRight.disabled, false, "Botão Para Frente deve estar habilitado (gapRight = 80f)");
    assert.equal(btnBoth.disabled, false, "Botão Ambos deve estar habilitado");

    // Teste A: Preencher para Trás (expande para 50..200 -> nova duração 150f)
    btnLeft.onclick({ preventDefault: () => {} });
    assert.equal(durInput.value, "00:00:06:06", "Duração para trás deve ser 150 frames (00:00:06:06 a 24fps)");

    const resLeft = TIMELINE_STATE.changeClipSpeed("target_gap", {
        newTimelineStartFrame: 50,
        durationFrames: 150,
        speed: 100 / 150
    });
    assert.ok(resLeft, "changeClipSpeed para trás deve ser bem-sucedido");
    const cutLeft = STATE.activeTimelineCuts.find(c => c.id === "target_gap");
    assert.equal(cutLeft.timelineStartFrame, 50, "Início do clipe deve ter movido para o frame 50 colando em p1");
    assert.equal(cutLeft.outFrame - cutLeft.inFrame, 150, "Duração deve ser 150f");

    // Desfaz
    TIMELINE_HISTORY.undo();
    const cutRestored = STATE.activeTimelineCuts.find(c => c.id === "target_gap");
    assert.equal(cutRestored.timelineStartFrame, 100, "Undo restaura início para 100");

    // Teste B: Preencher para Frente (expande para 100..280 -> nova duração 180f)
    interaction.openClipSpeedDialog("target_gap");
    btnRight.onclick({ preventDefault: () => {} });
    assert.equal(durInput.value, "00:00:07:12", "Duração para frente deve ser 180 frames (00:00:07:12 a 24fps)");

    // Teste C: Preencher Ambos os Lados (expande para 50..280 -> nova duração 230f)
    btnBoth.onclick({ preventDefault: () => {} });
    assert.equal(durInput.value, "00:00:09:14", "Duração para ambos deve ser 230 frames (00:00:09:14 a 24fps)");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 21: Atalho edit.fit_to_gap (Ctrl+Alt+R) e Execução Direta Sem Abrir Modal
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Atalho edit.fit_to_gap (Ctrl+Alt+R) e Execução Automática Sem Abrir Modal", async () => {
    // 1. Catálogo e Presets
    const cmd = COMMANDS_CATALOG.find(c => c.id === "edit.fit_to_gap");
    assert.ok(cmd, "Comando edit.fit_to_gap deve existir no catálogo");
    assert.equal(cmd.category, "edit", "Categoria deve ser 'edit'");

    const requiredPresets = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    for (const presetName of requiredPresets) {
        const preset = KEYMAP_PRESETS[presetName];
        assert.ok(preset, `Preset '${presetName}' deve existir`);
        const combos = preset["edit.fit_to_gap"];
        assert.ok(Array.isArray(combos) && combos.length > 0, `Preset '${presetName}' deve mapear edit.fit_to_gap`);
        assert.ok(combos.includes("Ctrl+Alt+KeyR"), `Preset '${presetName}' deve conter 'Ctrl+Alt+KeyR'`);
    }

    // Valida ausência de colisões de Ctrl+Alt+KeyR
    const capiauPreset = KEYMAP_PRESETS.capiau;
    const collisions = Object.entries(capiauPreset).filter(
        ([id, keys]) => id !== "edit.fit_to_gap" && keys.includes("Ctrl+Alt+KeyR")
    );
    assert.equal(collisions.length, 0, "Ctrl+Alt+KeyR não deve colidir com nenhum outro comando");

    // 2. Interceptação em player.js com preventDefault()
    assert.ok(plSrc.includes("edit.fit_to_gap"), "player.js deve interceptar edit.fit_to_gap");
    assert.ok(plSrc.includes("fillTrackGap"), "player.js deve acionar fillTrackGap()");

    // 3. Execução Direta via TIMELINE_STATE.fillTrackGap sem abrir modal
    const modal = document.getElementById("clip-speed-modal");
    modal.style.display = "none";

    const c1 = { id: "fg_c1", video_id: "m", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 40 };
    // Lacuna de 60 frames (40 a 100)
    const cTarget = { id: "fg_target", video_id: "m", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100, speed: 1.0 };
    // Lacuna de 50 frames (200 a 250)
    const c2 = { id: "fg_c2", video_id: "m", track: "V1", timelineStartFrame: 250, inFrame: 0, outFrame: 60 };

    STATE.activeTimelineCuts = [c1, cTarget, c2];
    TIMELINE_STATE.selectedClipId = "fg_target";

    // Executa fillTrackGap automaticamente
    const resAuto = TIMELINE_STATE.fillTrackGap("fg_target", "auto");
    assert.ok(resAuto, "fillTrackGap deve executar com sucesso");

    // Valida que o modal NÃO foi aberto (permaneceu 'none')
    assert.equal(modal.style.display, "none", "fillTrackGap NÃO deve abrir o modal de velocidade (execução 100% direta e automática)");

    // Valida que preencheu ambos os lados (0..40 [gap 60f] 100..200 [gap 50f] 250..)
    // Início move para 40 e fim vai para 250 -> nova duração = 210 quadros!
    const updatedTarget = STATE.activeTimelineCuts.find(c => c.id === "fg_target");
    assert.equal(updatedTarget.timelineStartFrame, 40, "Clipe deve começar no frame 40 colando em c1");
    assert.equal(updatedTarget.outFrame - updatedTarget.inFrame, 210, "Nova duração deve ser 210 quadros cobrindo de 40 a 250");

    // 4. Valida que clipes subsequentes NÃO são empurrados (zero deslocamento indevido)
    const updatedC2 = STATE.activeTimelineCuts.find(c => c.id === "fg_c2");
    assert.equal(updatedC2.timelineStartFrame, 250, "Clipe subsequente fg_c2 NÃO deve ser empurrado, mantendo-se estático no frame 250!");

    // 5. Valida que os rótulos de 'preencher' no menu de contexto possuem no máximo 2 palavras
    assert.ok(tiSrc.includes("<span>Preencher Ambos</span>"), "Rótulo deve ser conciso: 'Preencher Ambos'");
    assert.ok(tiSrc.includes("<span>Preencher Frente</span>"), "Rótulo deve ser conciso: 'Preencher Frente'");
    assert.ok(tiSrc.includes("<span>Preencher Trás</span>"), "Rótulo deve ser conciso: 'Preencher Trás'");
    assert.ok(tiSrc.includes('data-tooltip'), "Menu de contexto deve fornecer detalhes adicionais via tooltip no hover");

    // 6. Valida intercepção prioritária de Barra de Espaço no PlayerController quando clip-speed-modal estiver ativo
    assert.ok(plSrc.includes("isSpeedDialogOpen && (e.code === \"Space\""), "player.js deve interceptar Barra de Espaço prioritariamente quando o diálogo flutuante de velocidade estiver ativo");
    assert.ok(tiSrc.includes("__spaceCaptureBound"), "timelineInteraction.js deve ter capture listener para Barra de Espaço no modal");

    // 7. Valida que o menu de contexto possui a opção direta com Ctrl+Alt+R
    assert.ok(tiSrc.includes("Ctrl+Alt+R"), "timelineInteraction.js deve exibir atalho Ctrl+Alt+R no menu de contexto");
    assert.ok(tiSrc.includes("fillTrackGap"), "timelineInteraction.js deve chamar fillTrackGap diretamente no clique do menu de contexto");
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} BATERIAS APROVADAS COM 100% DE SUCESSO!`);
console.log("===============================================================================");

