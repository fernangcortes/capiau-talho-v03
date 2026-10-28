// tests/autoteste_track_lock.mjs
// Task 23 do PLANO_SUITE_NLE_CLASSICO — Trava Total de Pista com Cadeado Físico (Track Lock):
//  1. Design System Flat & Cache-Buster: tokens semânticos (--color-rose / --text-muted), zero hex hardcoded no cadeado, cache-buster atualizado.
//  2. Paridade Multi-Preset nos 5 Perfis NLE: timeline.toggle_track_lock e timeline.toggle_all_tracks_lock sem colisões + QWER/ASDF intactos.
//  3. Controle de Estado, Expurgo Imediato de Seleção (clipes, gaps, transições, marcadores de clipe) e Histórico Atômico Undo/Redo.
//  4. Hachura Diagonal Sutil Neutra a 45° no Canvas (drawLockedTracksOverlay) preservando cores originais dos clipes.
//  5. Bloqueio Total de Seleção (selectClip, selectClips, toggleClipSelection, Marquee, Track Forward/Backward, Playhead, Gaps).
//  6. Bloqueio Total de Interação de Mouse, Ferramentas (Select, Blade, Slip, Slide, Rate Stretch, Rolling), Context Menu e Atalhos Shift+L / Ctrl+Alt+Shift+L.
//  7. Imunidade contra Cortes e Divisões (splitClipAtFrame, splitAllTracksAtFrame, splitAtPlayhead, par A/V vinculado, Freeze Frame).
//  8. Imunidade contra Exclusões Lift, Ripple, Gaps e Intervalos In/Out (liftRange, extractRange) incluindo proteção de parceiro A/V travado.
//  9. Imunidade contra Move, Trim, Nudge, Q/W Ripple Trim, Slip, Slide, Rolling, Speed, Fit-to-Gap, Disable, Rotação, Fades e Transições.
// 10. Imunidade contra Deslocamento Indireto de Ripple & Invariante A/V (applyRippleShift, simulateOverwrite, simulateRipple, STATE.activeTimelineCuts).
// 11. Imunidade contra Inserções, Drag & Drop, 3-Point Editing, Ghost Track IA, Replace Edit e Remoção/Renomeação Estrutural de Pista.

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
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
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
            add(...cs) { cs.forEach(c => this._classes.add(c)); },
            remove(...cs) { cs.forEach(c => this._classes.delete(c)); },
            toggle(c, force) {
                const next = force !== undefined ? !!force : !this._classes.has(c);
                if (next) this._classes.add(c);
                else this._classes.delete(c);
                return next;
            },
            contains(c) { return this._classes.has(c); }
        },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] ?? null; },
        appendChild() {},
        remove() {},
        closest() { return null; },
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100, height: 30 }; },
        focus() {},
        select() {},
        blur() {}
    };
}

const canvasStub = {
    width: 1000,
    height: 400,
    getContext: () => ({
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
        fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
        measureText: () => ({ width: 50 }), fillText() {}, scale() {},
        clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {}
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
        if (sel && sel.startsWith("#")) {
            return globalThis.document.getElementById(sel.slice(1));
        }
        return null;
    },
    querySelectorAll: () => [],
    body: {
        appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; },
        querySelector: () => null
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};
canvasStub.ownerDocument = globalThis.document;

const toasts = [];
globalThis.showToast = (msg, type) => toasts.push({ msg: String(msg), type });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raiz = path.resolve(__dirname, "..");

const indexHtml = fs.readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf-8");
const stylesCss = fs.readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf-8");
const panelsJs = fs.readFileSync(path.join(raiz, "src", "ui", "js", "panels.js"), "utf-8");

// Importações dos módulos reais da aplicação
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

let passedBatteries = 0;
const totalBatteries = 11;

function battery(num, title, fn) {
    console.log(`\n▶ [Bateria ${num}/${totalBatteries}] ${title}`);
    fn();
    passedBatteries++;
    console.log(`  ✓ Bateria ${num} aprovada com sucesso`);
}

function resetFixture() {
    toasts.length = 0;
    TIMELINE_HISTORY.clear();
    TIMELINE_STATE.fps = 24;
    STATE.projectFps = 24;
    TIMELINE_STATE.zoom = 1; // 1 px por frame para facilitar coordenadas exatas
    TIMELINE_STATE.scrollLeftFrame = 0;
    TIMELINE_STATE.scrollTop = 0;
    TIMELINE_STATE.inFrame = null;
    TIMELINE_STATE.outFrame = null;
    TIMELINE_STATE.playheadFrame = 0;
    TIMELINE_STATE.activeTool = "select";
    TIMELINE_STATE.snappingEnabled = false;
    TIMELINE_STATE.selectedTrack = "V1";
    TIMELINE_STATE.clearClipSelection();
    TIMELINE_STATE.clearSelectedGap();
    TIMELINE_STATE.transitions = [];
    TIMELINE_STATE.selectedTransitionId = null;
    TIMELINE_STATE.markers = [];
    TIMELINE_STATE.selectedMarkerIds = new Set();
    TIMELINE_STATE.ghostTrack = [];

    TIMELINE_STATE.setTracks([
        { id: "AI", name: "IA — Sugestões", kind: "ai", locked: true, syncLocked: false, hidden: false },
        { id: "T1", name: "T1 Texto", kind: "text", locked: false, syncLocked: true, hidden: false },
        { id: "V2", name: "V2 Cobertura", kind: "video", locked: false, syncLocked: true, hidden: false },
        { id: "V1", name: "V1 Principal", kind: "video", locked: false, syncLocked: true, hidden: false },
        { id: "A1", name: "A1 Voz", kind: "audio", locked: false, syncLocked: true, hidden: false },
        { id: "A2", name: "A2 Trilha", kind: "audio", locked: false, syncLocked: true, hidden: false }
    ]);

    STATE.allVideos = [
        { id: 101, filename: "entrevista.mp4", duration: 100, fps: 24, width: 1920, height: 1080, has_audio: true, rotation: 0 },
        { id: 102, filename: "broll.mp4", duration: 100, fps: 24, width: 1920, height: 1080, has_audio: true, rotation: 0 }
    ];
    STATE.allPhotos = [
        { id: 201, filename: "foto.jpg", width: 1920, height: 1080, rotation: 0 }
    ];
    STATE.activeTimelineCuts = [];
}

function makeDummyRenderer() {
    const getLanes = () => {
        let y = 30;
        return TIMELINE_STATE.tracks.map(t => {
            const h = t.hidden ? 4 : (t.kind === "audio" ? 40 : (t.kind === "text" ? 34 : 50));
            const lane = { track: t, top: y, height: h };
            y += h;
            return lane;
        });
    };
    return {
        canvas: canvasStub,
        width: 1000,
        height: 400,
        rulerHeight: 30,
        activeSnapFrame: null,
        dropIndicator: null,
        marqueeBox: null,
        syncBadgeRects: new Map(),
        requestRedraw: () => {},
        getTrackLanes: getLanes,
        getLane: (id) => getLanes().find(l => l.track.id === id) || null,
        getTrackAtY: (y) => {
            const hit = getLanes().find(l => y >= l.top && y < l.top + l.height);
            return hit ? hit.track : null;
        },
        frameToX: (f) => (f - TIMELINE_STATE.scrollLeftFrame) * TIMELINE_STATE.zoom,
        xToFrame: (x) => Math.round(x / TIMELINE_STATE.zoom) + TIMELINE_STATE.scrollLeftFrame
    };
}

function makeMouseEvent(opts = {}) {
    return {
        button: 0,
        buttons: 1,
        clientX: 0,
        clientY: 180,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...opts
    };
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 23: TRAVA TOTAL DE PISTA (TRACK LOCK)");
console.log("===============================================================================");

// ── BATERIA 1: DESIGN SYSTEM FLAT & CACHE-BUSTER ──
battery(1, "Design System Semântico (.btn-track-lock) e Cache-Buster em index.html", () => {
    const lockCssMatch = stylesCss.match(/\.btn-track-lock\.locked\s*\{[^}]*\}/);
    const unlockCssMatch = stylesCss.match(/\.btn-track-lock\.unlocked\s*\{[^}]*\}/);
    assert.ok(lockCssMatch, "Regra .btn-track-lock.locked deve existir em styles.css");
    assert.ok(unlockCssMatch, "Regra .btn-track-lock.unlocked deve existir em styles.css");
    assert.ok(lockCssMatch[0].includes("var(--color-rose)"), ".btn-track-lock.locked deve usar var(--color-rose)");
    assert.ok(!lockCssMatch[0].includes("#ef4444"), ".btn-track-lock.locked não deve usar hex hardcoded #ef4444");
    assert.ok(unlockCssMatch[0].includes("var(--text-muted)"), ".btn-track-lock.unlocked deve usar var(--text-muted) discreto");
    assert.ok(!unlockCssMatch[0].includes("emerald"), ".btn-track-lock.unlocked não deve usar verde esmeralda");

    assert.ok(stylesCss.includes(".timeline-header-track.track-locked"), "Classe .track-locked deve existir em styles.css");
    assert.ok(stylesCss.includes(".timeline-header-track.track-active"), "Classe .track-active deve existir em styles.css");

    assert.ok(panelsJs.includes("btn-track-lock"), "Botão .btn-track-lock deve ser renderizado em panels.js");
    assert.ok(panelsJs.includes("timeline.toggle_track_lock"), "Tooltip do cadeado deve consultar KEYMAP_SERVICE para timeline.toggle_track_lock");
    assert.ok(!panelsJs.includes('const lockColor = isLocked ? "#ef4444"'), "panels.js não deve injetar #ef4444 inline no botão de cadeado");

    const cssVer = Number((indexHtml.match(/styles\.css\?v=(\d+)/) || [])[1] || 0);
    const jsVer = Number((indexHtml.match(/js\/main\.js\?v=(\d+)/) || [])[1] || 0);
    assert.ok(cssVer >= 93, `Cache-buster de styles.css deve ser >= 93 (atual: ${cssVer})`);
    assert.ok(jsVer >= 80, `Cache-buster de js/main.js deve ser >= 80 (atual: ${jsVer})`);
});

// ── BATERIA 2: CATÁLOGO CENTRAL, 5 PERFIS NLE E PRESERVAÇÃO QWER/ASDF ──
battery(2, "Comandos de Cadeado nos 5 Perfis NLE Sem Conflitos e Preservação QWER/ASDF", () => {
    const cmdSingle = COMMANDS_CATALOG.find(c => c.id === "timeline.toggle_track_lock");
    const cmdAll = COMMANDS_CATALOG.find(c => c.id === "timeline.toggle_all_tracks_lock");
    assert.ok(cmdSingle, "timeline.toggle_track_lock deve estar registrado em COMMANDS_CATALOG");
    assert.ok(cmdAll, "timeline.toggle_all_tracks_lock deve estar registrado em COMMANDS_CATALOG");

    const requiredPresets = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    for (const presetName of requiredPresets) {
        assert.ok(KEYMAP_PRESETS[presetName], `Perfil ${presetName} deve existir em KEYMAP_PRESETS`);
        KEYMAP_SERVICE.setPreset(presetName);

        const bSingle = KEYMAP_SERVICE.getBindingsForCommand("timeline.toggle_track_lock");
        const bAll = KEYMAP_SERVICE.getBindingsForCommand("timeline.toggle_all_tracks_lock");
        assert.ok(Array.isArray(bSingle) && bSingle.length > 0, `timeline.toggle_track_lock deve ter atalho no perfil ${presetName}`);
        assert.ok(Array.isArray(bAll) && bAll.length > 0, `timeline.toggle_all_tracks_lock deve ter atalho no perfil ${presetName}`);

        for (const chord of bSingle) {
            const conflicts = KEYMAP_SERVICE.findConflicts(chord, "timeline.toggle_track_lock");
            assert.equal(conflicts.length, 0, `Conflito detectado para ${chord} em ${presetName}: ${conflicts.map(c => c.id).join(", ")}`);
        }
        for (const chord of bAll) {
            const conflicts = KEYMAP_SERVICE.findConflicts(chord, "timeline.toggle_all_tracks_lock");
            assert.equal(conflicts.length, 0, `Conflito detectado para ${chord} em ${presetName}: ${conflicts.map(c => c.id).join(", ")}`);
        }
    }

    // Restaura perfil padrão CapIAu e garante Speed Editing QWER / ASDF intacto (Diretriz 7)
    KEYMAP_SERVICE.setPreset("capiau");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.ripple_trim_head").includes("KeyQ"), "KeyQ preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.ripple_trim_tail").includes("KeyW"), "KeyW preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.split").includes("KeyE"), "KeyE preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.ripple_delete").includes("KeyR"), "KeyR preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("playback.prev_edit_point").includes("KeyA"), "KeyA preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("playback.next_edit_point").includes("KeyS"), "KeyS preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.select_clip_at_playhead").includes("KeyD"), "KeyD preservada");
    assert.ok(KEYMAP_SERVICE.getBindingsForCommand("edit.toggle_clip_disable").includes("KeyF"), "KeyF preservada");
});

// ── BATERIA 3: TOGGLE, EXPURGO AUTOMÁTICO DE SELEÇÃO E UNDO/REDO ──
battery(3, "toggleTrackLock, toggleActiveTrackLock, toggleAllTracksLock, Expurgo de Seleção e Undo/Redo", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "v1_a", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 48, timelineStartFrame: 0 },
        { id: "v1_b", track: "V1", type: "video", video_id: 101, inFrame: 48, outFrame: 96, timelineStartFrame: 48 },
        { id: "v2_a", track: "V2", type: "video", video_id: 102, inFrame: 0, outFrame: 48, timelineStartFrame: 0 }
    ];

    // Adiciona transição em V1 e marcador de clipe preso a v1_a + marcador global de sequência
    const trRes = TIMELINE_STATE.addVideoTransition({ clipAId: "v1_a", clipBId: "v1_b", durationFrames: 12 });
    assert.ok(trRes && trRes.transition, "Transição criada em V1 destravada");
    TIMELINE_STATE.markers = [
        { id: "m_clip_v1", frame: 10, label: "Clip V1", color: "#06b6d4", comment: "", clipId: "v1_a", offsetFrame: 10 },
        { id: "m_seq", frame: 20, label: "Global", color: "#06b6d4", comment: "", clipId: null, offsetFrame: null }
    ];
    TIMELINE_STATE.selectedMarkerIds = new Set(["m_clip_v1", "m_seq"]);
    TIMELINE_STATE.selectClips(["v1_a", "v2_a"]);
    TIMELINE_STATE.selectedTransitionId = trRes.transition.id;

    // Pista de IA jamais destrava
    assert.equal(TIMELINE_STATE.toggleTrackLock("AI"), null, "Pista AI não deve alternar cadeado");
    assert.equal(TIMELINE_STATE.isTrackLocked("AI"), true);

    // Travar V1 expurga seleção de v1_a, transição de V1 e marcador preso a v1_a, preservando v2_a e m_seq
    const lockedState = TIMELINE_STATE.toggleTrackLock("V1");
    assert.equal(lockedState, true, "V1 deve ficar travada");
    assert.equal(TIMELINE_STATE.isTrackLocked("V1"), true);
    assert.equal(TIMELINE_STATE.selectedClipIds.has("v1_a"), false, "v1_a deve ser expurgado da seleção ao travar V1");
    assert.equal(TIMELINE_STATE.selectedClipIds.has("v2_a"), true, "v2_a em V2 destravada permanece selecionado");
    assert.equal(TIMELINE_STATE.selectedClipId, "v2_a", "selectedClipId migra para clipe restante em V2");
    assert.equal(TIMELINE_STATE.selectedTransitionId, null, "Transição na pista travada deixa de estar selecionada");
    assert.equal(TIMELINE_STATE.selectedMarkerIds.has("m_clip_v1"), false, "Marcador de clipe em V1 expurgado");
    assert.equal(TIMELINE_STATE.selectedMarkerIds.has("m_seq"), true, "Marcador global da régua preservado");

    // Undo / Redo atômico do cadeado
    assert.equal(TIMELINE_HISTORY.undo(), true);
    assert.equal(TIMELINE_STATE.isTrackLocked("V1"), false, "Undo restaura V1 destravada");
    assert.equal(TIMELINE_HISTORY.redo(), true);
    assert.equal(TIMELINE_STATE.isTrackLocked("V1"), true, "Redo reaplica cadeado em V1");

    // toggleActiveTrackLock na pista selecionada
    TIMELINE_STATE.selectedTrack = "A1";
    const activeRes = TIMELINE_STATE.toggleActiveTrackLock();
    assert.deepEqual(activeRes, { trackId: "A1", locked: true });
    assert.equal(TIMELINE_STATE.isTrackLocked("A1"), true);

    // toggleAllTracksLock: como há pistas destravadas (T1, V2, A2), trava todas; na segunda chamada, destrava todas
    const lockAllRes = TIMELINE_STATE.toggleAllTracksLock();
    assert.equal(lockAllRes.locked, true);
    TIMELINE_STATE.tracks.filter(t => t.kind !== "ai").forEach(t => {
        assert.equal(t.locked, true, `Pista ${t.id} deve estar travada após toggleAllTracksLock`);
    });
    assert.equal(TIMELINE_STATE.selectedClipIds.size, 0, "Todas as seleções de clipes limpas ao travar todas as pistas");

    const unlockAllRes = TIMELINE_STATE.toggleAllTracksLock();
    assert.equal(unlockAllRes.locked, false);
    TIMELINE_STATE.tracks.filter(t => t.kind !== "ai").forEach(t => {
        assert.equal(t.locked, false, `Pista ${t.id} deve estar destravada após segundo toggleAllTracksLock`);
    });
});

// ── BATERIA 4: HACHURA DIAGONAL SUTIL NEUTRA A 45° NO CANVAS ──
battery(4, "Renderização da Hachura Diagonal Neutra a 45° (drawLockedTracksOverlay)", () => {
    resetFixture();
    TIMELINE_STATE.toggleTrackLock("V1");
    TIMELINE_STATE.toggleTrackLock("A2");
    TIMELINE_STATE.getTrack("A2").hidden = true; // Pista oculta não deve receber hachura expandida

    const clips = [];
    const fillRects = [];
    const segments = [];
    let curMove = null;

    const fakeRenderer = {
        width: 600,
        height: 400,
        rulerHeight: 30,
        ctx: {
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1,
            save() {},
            restore() {},
            beginPath() {},
            rect(x, y, w, h) { clips.push({ x, y, w, h }); },
            clip() {},
            fillRect(x, y, w, h) { fillRects.push({ x, y, w, h, fillStyle: this.fillStyle }); },
            moveTo(x, y) { curMove = { x, y }; },
            lineTo(x, y) {
                if (curMove) segments.push({ x1: curMove.x, y1: curMove.y, x2: x, y2: y, strokeStyle: this.strokeStyle });
            },
            stroke() {}
        },
        getTrackLanes: () => makeDummyRenderer().getTrackLanes()
    };

    CapiauTimelineRenderer.prototype.drawLockedTracksOverlay.call(fakeRenderer);

    // Somente V1 está visível, não-IA e travada (AI é ignorada, A2 está hidden, V2/A1/T1 destravadas)
    const v1Lane = fakeRenderer.getTrackLanes().find(l => l.track.id === "V1");
    assert.equal(clips.length, 1, "Apenas a pista V1 travada e visível deve ser clipada na hachura");
    assert.equal(clips[0].y, v1Lane.top);
    assert.equal(clips[0].h, v1Lane.height);
    assert.equal(fillRects.length, 1);
    assert.ok(fillRects[0].fillStyle.includes("rgba("), "Véu de fundo deve ser translúcido neutro");
    assert.ok(segments.length > 20, "Deve desenhar múltiplas linhas diagonais cobrindo toda a largura da pista");

    for (const seg of segments) {
        const dx = seg.x2 - seg.x1;
        const dy = seg.y1 - seg.y2;
        assert.ok(Math.abs(dx - dy) < 1e-6, `Cada traço da hachura deve ter inclinação exata de 45° (dx=${dx}, dy=${dy})`);
        assert.ok(seg.strokeStyle.includes("255, 255, 255"), "Traço da hachura deve ser neutro translúcido sem distorcer cores");
    }
});

// ── BATERIA 5: BLOQUEIO TOTAL DE SELEÇÃO DE CLIPES, GAPS E MARCADORES ──
battery(5, "Bloqueio Total de Seleção (Clique, Multi, Marquee, Track Forward/Backward, Playhead e Gaps)", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "c_v1", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 50, timelineStartFrame: 20 },
        { id: "c_v2", track: "V2", type: "video", video_id: 102, inFrame: 0, outFrame: 50, timelineStartFrame: 20 }
    ];
    TIMELINE_STATE.markers = [
        { id: "m_v1", frame: 30, label: "M V1", clipId: "c_v1", offsetFrame: 10 },
        { id: "m_v2", frame: 30, label: "M V2", clipId: "c_v2", offsetFrame: 10 },
        { id: "m_global", frame: 30, label: "M Global", clipId: null, offsetFrame: null }
    ];
    TIMELINE_STATE.toggleTrackLock("V1");

    // 1. selectClip / selectClips / addClipsToSelection / toggleClipSelection
    assert.equal(TIMELINE_STATE.selectClip("c_v1"), false, "selectClip em pista travada deve retornar false");
    assert.equal(TIMELINE_STATE.selectedClipId, null);
    assert.equal(TIMELINE_STATE.selectedClipIds.size, 0);

    TIMELINE_STATE.selectClips(["c_v1", "c_v2"]);
    assert.deepEqual(Array.from(TIMELINE_STATE.selectedClipIds), ["c_v2"], "selectClips deve filtrar clipes de pistas travadas");

    TIMELINE_STATE.addClipsToSelection(["c_v1"]);
    assert.equal(TIMELINE_STATE.selectedClipIds.has("c_v1"), false, "addClipsToSelection deve ignorar pista travada");

    TIMELINE_STATE.toggleClipSelection("c_v1");
    assert.equal(TIMELINE_STATE.selectedClipIds.has("c_v1"), false, "toggleClipSelection deve ignorar pista travada");

    // 2. Marquee Selection (computeMarqueeIntersections + applyMarqueeSelection)
    const renderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(renderer);
    const hits = interaction.computeMarqueeIntersections({ x1: 0, y1: 0, x2: 500, y2: 380 });
    assert.equal(hits.clipIds.includes("c_v1"), false, "Marquee não deve interceptar clipe em pista travada V1");
    assert.equal(hits.clipIds.includes("c_v2"), true, "Marquee deve interceptar clipe em pista destravada V2");
    assert.equal(hits.markerIds.includes("m_v1"), false, "Marquee não deve interceptar marcador de clipe em V1 travada");
    assert.equal(hits.markerIds.includes("m_v2"), true, "Marquee intercepta marcador em V2 destravada");
    assert.equal(hits.markerIds.includes("m_global"), true, "Marquee intercepta marcador global da régua");

    TIMELINE_STATE.applyMarqueeSelection(["c_v1", "c_v2"], ["m_v1", "m_global"], "replace");
    assert.deepEqual(Array.from(TIMELINE_STATE.selectedClipIds), ["c_v2"]);
    assert.deepEqual(Array.from(TIMELINE_STATE.selectedMarkerIds), ["m_global"]);

    // 3. Track Select Forward / Backward (T / Shift+T)
    const fwdAll = TIMELINE_STATE.selectTracksForward(0);
    assert.deepEqual(fwdAll.map(c => c.id), ["c_v2"], "selectTracksForward deve ignorar V1 travada");
    const fwdLockedOnly = TIMELINE_STATE.selectTracksForward(0, "V1");
    assert.equal(fwdLockedOnly.length, 0, "selectTracksForward mirando pista travada retorna vazio");

    const bwdAll = TIMELINE_STATE.selectTracksBackward(100);
    assert.deepEqual(bwdAll.map(c => c.id), ["c_v2"], "selectTracksBackward deve ignorar V1 travada");

    // 4. Gaps e Playhead
    assert.equal(TIMELINE_STATE.getGapAt(5, "V1"), null, "getGapAt em pista travada retorna null");
    assert.equal(TIMELINE_STATE.selectGap({ trackId: "V1", startFrame: 0, endFrame: 20, durationFrames: 20 }), false);
    assert.equal(TIMELINE_STATE.selectedGap, null);

    // Quando TODAS as pistas estão travadas, getClipAtPlayhead e getGapAtPlayhead retornam null
    TIMELINE_STATE.toggleAllTracksLock(); // trava todas
    TIMELINE_STATE.playheadFrame = 30;
    assert.equal(TIMELINE_STATE.getClipAtPlayhead(30), null, "getClipAtPlayhead retorna null quando todas as pistas estão travadas");
    assert.equal(TIMELINE_STATE.getGapAtPlayhead(5, "V1"), null, "getGapAtPlayhead retorna null quando todas as pistas estão travadas");
});

// ── BATERIA 6: INTERAÇÃO DE MOUSE, FERRAMENTAS, CONTEXT MENU E ATALHOS DE TECLADO ──
battery(6, "Interação de Mouse (Select, Blade, Slip, Slide, Rate-Stretch, Rolling, ContextMenu) e Atalhos Shift+L", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "v1_1", track: "V1", type: "video", video_id: 101, inFrame: 10, outFrame: 60, timelineStartFrame: 0 },
        { id: "v1_2", track: "V1", type: "video", video_id: 101, inFrame: 60, outFrame: 110, timelineStartFrame: 50 },
        { id: "v1_3", track: "V1", type: "video", video_id: 101, inFrame: 110, outFrame: 160, timelineStartFrame: 100 }
    ];
    TIMELINE_STATE.toggleTrackLock("V1");

    const renderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(renderer);
    const v1Lane = renderer.getLane("V1");
    const yV1 = v1Lane.top + 20;

    for (const tool of ["select", "blade", "slip", "slide", "rate-stretch", "rolling"]) {
        TIMELINE_STATE.setTool(tool);
        interaction.dragState = null;
        const clickX = tool === "rolling" ? 50 : 25;
        interaction.onMouseDown(makeMouseEvent({ clientX: clickX, clientY: yV1 }));
        assert.equal(TIMELINE_STATE.selectedClipId, null, `Ferramenta '${tool}' NÃO deve selecionar clipe em pista travada`);
        assert.equal(TIMELINE_STATE.selectedClipIds.size, 0, `Ferramenta '${tool}' NÃO deve popular selectedClipIds em pista travada`);
        assert.ok(
            interaction.dragState === null || interaction.dragState === "scrub",
            `Ferramenta '${tool}' NÃO deve iniciar drag de edição em pista travada (dragState=${interaction.dragState})`
        );
        interaction.dragState = null;
    }
    assert.equal(STATE.activeTimelineCuts.length, 3, "Nenhum corte criado por clique de Blade em pista travada");

    // Botão direito (button: 2) e onContextMenu
    TIMELINE_STATE.setTool("select");
    interaction.onMouseDown(makeMouseEvent({ button: 2, clientX: 25, clientY: yV1 }));
    assert.equal(TIMELINE_STATE.selectedClipId, null, "Botão direito não seleciona clipe em pista travada");

    let rulerMenuCalled = false;
    interaction.showRulerContextMenu = () => { rulerMenuCalled = true; };
    toasts.length = 0;
    interaction.onContextMenu(makeMouseEvent({ button: 2, clientX: 25, clientY: yV1 }));
    assert.equal(rulerMenuCalled, true, "Context menu em pista travada desvia com segurança para menu neutro da régua");
    assert.ok(toasts.some(t => t.msg.toLowerCase().includes("travada")), "Context menu emite aviso de pista travada");

    // Atalhos de teclado via onKeyDown: Shift+KeyL destrava V1 (selectedTrack) e Ctrl+Alt+Shift+KeyL trava todas
    KEYMAP_SERVICE.setPreset("capiau");
    TIMELINE_STATE.selectedTrack = "V1";
    interaction.onKeyDown({
        code: "KeyL",
        key: "L",
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        target: { tagName: "DIV", isContentEditable: false },
        preventDefault() {},
        stopPropagation() {}
    });
    assert.equal(TIMELINE_STATE.isTrackLocked("V1"), false, "Shift+L via onKeyDown deve destravar a pista ativa V1");

    interaction.onKeyDown({
        code: "KeyL",
        key: "L",
        shiftKey: true,
        ctrlKey: true,
        altKey: true,
        metaKey: false,
        target: { tagName: "DIV", isContentEditable: false },
        preventDefault() {},
        stopPropagation() {}
    });
    assert.equal(TIMELINE_STATE.isTrackLocked("V1"), true, "Ctrl+Alt+Shift+L deve travar todas as pistas");
    assert.equal(TIMELINE_STATE.isTrackLocked("A1"), true, "Ctrl+Alt+Shift+L deve travar A1 também");
});

// ── BATERIA 7: IMUNIDADE CONTRA CORTES E DIVISÕES (BLADE, GLOBAL BLADE, PLAYHEAD, PAR A/V) ──
battery(7, "Imunidade contra Cortes (splitClipAtFrame, splitAllTracksAtFrame, splitAtPlayhead, Freeze Frame)", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "v1_c", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 100, timelineStartFrame: 0, link_id: "lnk_av" },
        { id: "a1_c", track: "A1", type: "video", video_id: 101, inFrame: 0, outFrame: 100, timelineStartFrame: 0, link_id: "lnk_av" },
        { id: "v2_c", track: "V2", type: "video", video_id: 102, inFrame: 0, outFrame: 100, timelineStartFrame: 0 }
    ];

    // 1. V1 travada -> splitClipAtFrame retorna null
    TIMELINE_STATE.toggleTrackLock("V1");
    assert.equal(TIMELINE_STATE.splitClipAtFrame("v1_c", 50, true), null, "splitClipAtFrame bloqueado em pista travada");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "V1").length, 1);

    // 2. V1 destravada + A1 travada -> split em V1 fatia APENAS V1, mantendo A1 inteira!
    TIMELINE_STATE.toggleTrackLock("V1"); // destrava V1
    TIMELINE_STATE.toggleTrackLock("A1"); // trava A1
    const splitRes = TIMELINE_STATE.splitClipAtFrame("v1_c", 40, true);
    assert.ok(splitRes && splitRes.rightClip, "V1 destravada deve dividir normalmente");
    assert.equal(splitRes.partnerRightClip, null, "Parceiro em A1 travada NÃO deve ser fatiado");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "V1").length, 2, "V1 agora tem 2 partes");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "A1").length, 1, "A1 travada continua com 1 clipe inteiro");

    // 3. splitAllTracksAtFrame e splitAtPlayhead ignoram pistas travadas
    TIMELINE_STATE.toggleTrackLock("V1"); // agora V1 e A1 estão travadas; apenas V2 está destravada
    const globalSplit = TIMELINE_STATE.splitAllTracksAtFrame(70);
    assert.equal(globalSplit.length, 1, "splitAllTracksAtFrame fatia apenas V2 destravada");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "V1").length, 2, "V1 travada intacta no corte global");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "A1").length, 1, "A1 travada intacta no corte global");

    // Trava V2 também -> splitAtPlayhead não fatia nada
    TIMELINE_STATE.toggleTrackLock("V2");
    TIMELINE_STATE.playheadFrame = 20;
    const countBefore = STATE.activeTimelineCuts.length;
    TIMELINE_STATE.splitAtPlayhead();
    assert.equal(STATE.activeTimelineCuts.length, countBefore, "splitAtPlayhead não fatia nada quando todas as pistas estão travadas");
});

// ── BATERIA 8: IMUNIDADE CONTRA EXCLUSÕES LIFT, RIPPLE, GAPS E INTERVALOS IN/OUT ──
battery(8, "Imunidade contra Exclusões (Lift, Ripple, Gaps, In/Out Lift & Extract e Parceiro A/V Travado)", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "v1_1", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 50, timelineStartFrame: 0, link_id: "L1" },
        { id: "a1_1", track: "A1", type: "video", video_id: 101, inFrame: 0, outFrame: 50, timelineStartFrame: 0, link_id: "L1" },
        { id: "v1_2", track: "V1", type: "video", video_id: 101, inFrame: 50, outFrame: 100, timelineStartFrame: 50, link_id: "L2" },
        { id: "a1_2", track: "A1", type: "video", video_id: 101, inFrame: 50, outFrame: 100, timelineStartFrame: 50, link_id: "L2" }
    ];

    // 1. Com V1 travada, liftDeleteClip, rippleDeleteClip e rippleDeleteGap falham imediatamente
    TIMELINE_STATE.toggleTrackLock("V1");
    assert.equal(TIMELINE_STATE.liftDeleteClip("v1_1"), false);
    assert.equal(TIMELINE_STATE.rippleDeleteClip("v1_1"), false);
    assert.equal(TIMELINE_STATE.rippleDeleteGap("V1", 0, 20).blocked, true);
    assert.equal(STATE.activeTimelineCuts.length, 4, "Nenhum clipe removido em pista travada");

    // 2. Com V1 destravada e A1 travada: rippleDeleteClip("v1_1") remove v1_1 e puxa v1_2 para 0,
    //    mas preserva a1_1 (0..50) e a1_2 (50..100) congelados em A1!
    TIMELINE_STATE.toggleTrackLock("V1"); // destrava V1
    TIMELINE_STATE.toggleTrackLock("A1"); // trava A1
    assert.equal(TIMELINE_STATE.rippleDeleteClip("v1_1"), true);
    assert.equal(STATE.activeTimelineCuts.some(c => c.id === "v1_1"), false, "v1_1 deletado em V1 destravada");
    assert.equal(STATE.activeTimelineCuts.some(c => c.id === "a1_1"), true, "a1_1 sobrevive intacto em A1 travada");
    const v1_2 = STATE.activeTimelineCuts.find(c => c.id === "v1_2");
    const a1_2 = STATE.activeTimelineCuts.find(c => c.id === "a1_2");
    assert.equal(v1_2.timelineStartFrame, 0, "v1_2 recuou no ripple de V1 para o frame 0");
    assert.equal(a1_2.timelineStartFrame, 50, "a1_2 em A1 travada permaneceu congelado no frame 50");

    // 3. liftRange e extractRange (In/Out) preservam pistas travadas intactas
    TIMELINE_STATE.liftRange(10, 30);
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "a1_1").outFrame, 50, "a1_1 intacto após liftRange");
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "a1_2").timelineStartFrame, 50, "a1_2 intacto após liftRange");

    TIMELINE_STATE.extractRange(0, 10);
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "a1_1").timelineStartFrame, 0, "a1_1 intacto após extractRange");
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "a1_2").timelineStartFrame, 50, "a1_2 congelado em 50 após extractRange");
});

// ── BATERIA 9: IMUNIDADE CONTRA MOVE, TRIM, NUDGE, Q/W, SLIP, SLIDE, ROLLING, SPEED, DISABLE, FADES E TRANSIÇÕES ──
battery(9, "Imunidade contra Move, Trim, Nudge, Q/W, Slip, Slide, Rolling, Speed, Disable, Rotação, Fades e Transições", () => {
    resetFixture();
    STATE.activeTimelineCuts = [
        { id: "c1", track: "V1", type: "video", video_id: 101, inFrame: 20, outFrame: 70, timelineStartFrame: 0 },
        { id: "c2", track: "V1", type: "video", video_id: 101, inFrame: 70, outFrame: 120, timelineStartFrame: 50 },
        { id: "c3", track: "V1", type: "video", video_id: 101, inFrame: 120, outFrame: 170, timelineStartFrame: 100 },
        { id: "a1", track: "A1", type: "video", video_id: 101, inFrame: 0, outFrame: 50, timelineStartFrame: 0 },
        { id: "a2", track: "A1", type: "video", video_id: 101, inFrame: 50, outFrame: 100, timelineStartFrame: 50 },
        { id: "open_v2", track: "V2", type: "video", video_id: 102, inFrame: 0, outFrame: 50, timelineStartFrame: 200 }
    ];

    // Cria uma transição em V1 ANTES de travar, para testar bloqueio de edição/remoção depois de travada
    const vTrans = TIMELINE_STATE.addVideoTransition({ clipAId: "c1", clipBId: "c2", durationFrames: 12 });
    assert.ok(vTrans && vTrans.transition, "Transição de vídeo criada antes do travamento");
    const trId = vTrans.transition.id;

    // Trava V1 e A1
    TIMELINE_STATE.toggleTrackLock("V1");
    TIMELINE_STATE.toggleTrackLock("A1");

    const renderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(renderer);

    // Tentativas de mutação direta em V1 travada
    interaction.moveClip("c1", 300, "V1");
    interaction.moveClip("c1", 300, "V2"); // tentativa de arrastar para fora da pista travada!
    interaction.moveClip("open_v2", 300, "V1"); // tentativa de mover de V2 para dentro de V1 travada!
    interaction.trimClipLeft("c1", 10, false);
    interaction.trimClipRight("c1", -10, true);
    interaction.nudgeTrim("c1", "left", 5);
    TIMELINE_STATE.selectedClipIds = new Set(["c1"]); // mesmo forçando Set interno, nudgeSelectedClips deve bloquear!
    assert.equal(TIMELINE_STATE.nudgeSelectedClips(10), false);
    TIMELINE_STATE.selectedClipIds.clear();

    TIMELINE_STATE.playheadFrame = 25;
    assert.equal(TIMELINE_STATE.rippleTrimToPlayhead("head", "c1"), false, "Q (Ripple Trim Head) bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.rippleTrimToPlayhead("tail", "c1"), false, "W (Ripple Trim Tail) bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.slipClip("c2", 10), null, "Slip bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.slideClip("c2", 10), null, "Slide bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.rollingEdit("c1", "c2", 10), null, "Rolling Edit bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.changeClipSpeed("c1", { speed: 2.0 }), null, "Clip Speed bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.fillTrackGap("c1"), null, "Fit to Gap bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.toggleClipDisabled("c1"), null, "Disable Clip (F) bloqueado em pista travada");

    // Rotação de mídia global ignora clipes em pistas travadas, mas aplica em V2 destravada
    STATE.emit("mediaRotated", { mediaType: "video", mediaId: 101, rotation: 90 });
    STATE.emit("mediaRotated", { mediaType: "video", mediaId: 102, rotation: 90 });
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "c1").rotation || 0, 0, "Clipe em V1 travada imune a mediaRotated");
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "open_v2").rotation, 90, "Clipe em V2 destravada recebeu rotação");

    // Fades e Transições bloqueados
    const c1After = STATE.activeTimelineCuts.find(c => c.id === "c1");
    assert.equal(interaction.checkFadeZone(2, renderer.getLane("V1").top + 5, c1After, true), null, "checkFadeZone bloqueado");
    assert.equal(TIMELINE_STATE.addAudioCrossfade({ clipAId: "a1", clipBId: "a2" }), null, "addAudioCrossfade bloqueado em A1 travada");
    assert.equal(TIMELINE_STATE.addVideoTransition({ clipAId: "c2", clipBId: "c3" }), null, "addVideoTransition bloqueado em V1 travada");
    assert.equal(TIMELINE_STATE.getTransitionAt("V1", 50), null, "getTransitionAt retorna null em pista travada");
    assert.equal(TIMELINE_STATE.getTransitionHit("V1", 50), null, "getTransitionHit retorna null em pista travada");
    assert.equal(TIMELINE_STATE.updateTransitionDuration(trId, 20, 20, true), null, "updateTransitionDuration bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.removeTransition(trId), false, "removeTransition bloqueado em pista travada");

    // Verifica geometria 100% intacta de c1, c2, c3 e open_v2 (permaneceu em V2)
    assert.equal(c1After.track, "V1");
    assert.equal(c1After.timelineStartFrame, 0);
    assert.equal(c1After.inFrame, 20);
    assert.equal(c1After.outFrame, 70);
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "open_v2").track, "V2");
});

// ── BATERIA 10: IMUNIDADE CONTRA RIPPLE INDIRETO & INVARIANTE A/V ──
battery(10, "Imunidade Absoluta contra Deslocamento Indireto de Ripple e Invariante A/V em Pistas Travadas", () => {
    resetFixture();
    // Cenário crítico: A1 não tem espaço livre entre a1_fixed (0..100) e a2_locked (100..200),
    // enquanto V1 tem um gap de 50 frames entre v1_fixed (0..50) e v2_open (100..200) vinculado a a2_locked!
    // Com A1 TRAVADA, fechar o gap em V1 DEVE mover v2_open para 50 SEM mover a2_locked e SEM ser bloqueado por A1!
    STATE.activeTimelineCuts = [
        { id: "v1_fixed", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 50, timelineStartFrame: 0, link_id: "L_A" },
        { id: "a1_fixed", track: "A1", type: "video", video_id: 101, inFrame: 0, outFrame: 100, timelineStartFrame: 0, link_id: "L_A" },
        { id: "v2_open", track: "V1", type: "video", video_id: 101, inFrame: 100, outFrame: 200, timelineStartFrame: 100, link_id: "L_B" },
        { id: "a2_locked", track: "A1", type: "video", video_id: 101, inFrame: 100, outFrame: 200, timelineStartFrame: 100, link_id: "L_B" }
    ];
    TIMELINE_STATE.toggleTrackLock("A1");

    const gapRes = TIMELINE_STATE.rippleDeleteGap("V1", 50, 50);
    assert.equal(gapRes.actualDelta, 50, "V1 destravada deve fechar os 50 frames normalmente");
    assert.equal(STATE.activeTimelineCuts.find(c => c.id === "v2_open").timelineStartFrame, 50, "v2_open recuou para 50");
    const a2After = STATE.activeTimelineCuts.find(c => c.id === "a2_locked");
    assert.equal(a2After.timelineStartFrame, 100, "a2_locked em A1 travada permaneceu congelado em 100");
    assert.equal(a2After.inFrame, 100);
    assert.equal(a2After.outFrame, 200);

    // Simulações de drag Overwrite / Ripple também mantêm A1 congelada
    const simOw = TIMELINE_STATE.simulateOverwrite("v2_open", 20, "V1");
    assert.equal(simOw.simulatedCuts.find(c => c.id === "a2_locked").timelineStartFrame, 100, "simulateOverwrite congela parceiro em pista travada");
    const simRp = TIMELINE_STATE.simulateRipple("v2_open", 20, "V1");
    assert.equal(simRp.simulatedCuts.find(c => c.id === "a2_locked").timelineStartFrame, 100, "simulateRipple congela parceiro em pista travada");
});

// ── BATERIA 11: INSERÇÕES, DROP, 3-POINT EDITING, GHOST IA, REPLACE E ESTRUTURA DE PISTA ──
battery(11, "Imunidade contra Inserção, Drop, 3-Point Editing, Ghost IA, Replace Edit e Remoção/Renomeação de Pista", () => {
    resetFixture();
    const renderer = makeDummyRenderer();
    const interaction = new CapiauTimelineInteraction(renderer);

    // 1. 3-Point Editing com V1 destravada e A1 travada: insere apenas vídeo em V1, A1 permanece vazia
    STATE.activeVideo = STATE.allVideos[0];
    STATE.activeTimelineCuts = [];
    TIMELINE_STATE.toggleTrackLock("A1");
    const insAvLockedA = TIMELINE_STATE.insertSourceClipAtPlayhead({
        id: "vid_locked_test",
        type: "video",
        video_id: 101,
        inFrame: 0,
        outFrame: 48,
        targetTrack: "V1",
        targetAudioTrack: "A1"
    }, true);
    assert.ok(insAvLockedA, "Vídeo inserido em V1 destravada");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "V1").length, 1, "Clipe de vídeo inserido em V1");
    assert.equal(STATE.activeTimelineCuts.filter(c => c.track === "A1").length, 0, "Áudio NÃO deve ser inserido em A1 travada");

    // 2. Replace Edit em V1 destravada com parceiro em A1 travada: preserva parceiro travado desvinculando-o
    STATE.activeTimelineCuts = [
        { id: "rep_v", track: "V1", type: "video", video_id: 101, inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "L_REP" },
        { id: "rep_a", track: "A1", type: "audio", video_id: 101, inFrame: 0, outFrame: 48, timelineStartFrame: 0, link_id: "L_REP" }
    ];
    const repRes = TIMELINE_STATE.replaceClip("rep_v", 201, "in", { mediaType: "photo" });
    assert.equal(repRes.success, true, "Substituição em V1 destravada deve funcionar");
    const repAAfter = STATE.activeTimelineCuts.find(c => c.id === "rep_a");
    assert.ok(repAAfter, "Parceiro de áudio em A1 travada NÃO deve ser deletado mesmo ao substituir vídeo por foto");
    assert.equal(repAAfter.video_id, 101, "Mídia original de A1 travada preservada");

    // 3. Travando TODAS as pistas: todas as rotas de inserção, drop, replace, ghost, rename e removeTrack abortam
    TIMELINE_STATE.toggleAllTracksLock();
    assert.equal(TIMELINE_STATE.replaceClip("rep_v", 102, "in", { mediaType: "video" }).reason, "track_locked");
    assert.equal(TIMELINE_STATE.replaceClipWithAlternative("rep_v", 102, 0, 2, false), false);
    assert.equal(TIMELINE_STATE.insertSourceClipAtPlayhead({ id: "vid_locked_test", type: "video", video_id: 101, inFrame: 0, outFrame: 48, targetTrack: "V1", targetAudioTrack: "A1" }, true), null);
    assert.equal(TIMELINE_STATE.overwriteSourceClipAtPlayhead({ id: "vid_locked_test", type: "video", video_id: 101, inFrame: 0, outFrame: 48, targetTrack: "V1", targetAudioTrack: "A1" }, true), null);
    assert.equal(TIMELINE_STATE.insertMedia({ type: "video", mediaId: 101, inSec: 0, outSec: 2 }, "insert"), null);
    assert.equal(TIMELINE_STATE.addCut(101, 0, 2), null);
    assert.equal(TIMELINE_STATE.addPhotoCut(201, 2), null);
    assert.equal(TIMELINE_STATE.addTextClip({ text: "Bloqueado" }), null);
    assert.equal(TIMELINE_STATE.addColorMatteCut({ color: "#000000", durationSeconds: 2 }), null);
    assert.equal(TIMELINE_STATE.addAdjustmentCut({ durationSeconds: 2 }), null);
    assert.equal(TIMELINE_STATE.insertClipWithRipple({ id: "x", inFrame: 0, outFrame: 24 }, 0, "V1"), null);
    assert.equal(interaction.resolveDropTrack("V1", renderer.getLane("V1").top + 10, "video"), null);
    assert.equal(interaction.resolveDropTrack("A1", renderer.getLane("A1").top + 10, "audio"), null);

    // Ghost suggestion apontando para pista travada é rejeitada sem mutar cortes
    TIMELINE_STATE.ghostTrack = [{
        id: "ghost_1",
        action: "INSERT",
        type: "video",
        video_id: 102,
        track: "V1",
        inFrame: 0,
        outFrame: 24,
        in: 0,
        out: 1,
        timelineStartFrame: 0
    }];
    assert.equal(TIMELINE_STATE.acceptGhostSuggestion("ghost_1"), false, "acceptGhostSuggestion bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.ghostTrack.length, 1, "Sugestão fantasma permanece pendente até destravar");

    // Proteção estrutural: renameTrack e removeTrack bloqueados em pista travada;
    // e mesmo destravando V2 com clipe, se V1 estiver travada, removeTrack("V2") não despeja clipes órfãos em V1 travada!
    assert.equal(TIMELINE_STATE.renameTrack("V1", "Novo Nome"), false, "renameTrack bloqueado em pista travada");
    assert.equal(TIMELINE_STATE.removeTrack("V2"), false, "removeTrack bloqueado em pista travada");

    TIMELINE_STATE.toggleTrackLock("V2"); // destrava apenas V2; V1 continua travada
    STATE.activeTimelineCuts.push({ id: "orphan_v2", track: "V2", type: "video", video_id: 102, inFrame: 0, outFrame: 24, timelineStartFrame: 0 });
    assert.equal(TIMELINE_STATE.removeTrack("V2"), false, "removeTrack(V2) deve recusar despejar clipes órfãos na única outra pista V1 que está travada!");
});

console.log("\n===============================================================================");
console.log(`  RESULTADO: ${passedBatteries}/${totalBatteries} BATERIAS APROVADAS COM 100% DE SUCESSO!`);
console.log("===============================================================================");
