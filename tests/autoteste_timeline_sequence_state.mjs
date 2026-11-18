// tests/autoteste_timeline_sequence_state.mjs
// Estágio 1A: TimelineSequenceState por instância, TimelineSequenceManager,
// Clones/Sequências Fantasmas da IA, Undo atômico por turno, execução Headless
// pura (sem browser globals) e fachada compatível (TIMELINE_STATE / TIMELINE_HISTORY / STATE.activeTimelineCuts).

import assert from "node:assert/strict";

// ── 1. MODO HEADLESS PURO (ZERO window, ZERO document, ZERO localStorage) ────
assert.equal(typeof globalThis.window, "undefined", "Pré-condição: sem window global");
assert.equal(typeof globalThis.document, "undefined", "Pré-condição: sem document global");
assert.equal(typeof globalThis.localStorage, "undefined", "Pré-condição: sem localStorage global");

const { STATE } = await import("../src/ui/js/state.js");
const {
    CapiauTimelineState,
    TimelineSequenceState,
    TimelineHistory,
    TimelineSequenceManager,
    SEQUENCE_MANAGER,
    TIMELINE_STATE,
    TIMELINE_HISTORY,
} = await import("../src/ui/js/timelineState.js");

let testCount = 0;
function ok(msg) {
    testCount += 1;
    console.log(`  ✔ [${testCount}] ${msg}`);
}

console.log("=== AUTOTESTE ESTÁGIO 1A: TimelineSequenceState, Manager, Clones & Fachada ===\n");

// ── 1. Headless puro ──────────────────────────────────────────────────────────
console.log("1. Testando execução 100% Headless (Node puro sem polyfills)...");
const headlessCatalog = {
    allVideos: [
        { id: 10, title: "Entrevista", duration: 20, fps: 24, resolution: "1920x1080", has_audio: true, rotation: 0 },
        { id: 20, title: "B-Roll", duration: 10, fps: 24, resolution: "1920x1080", has_audio: true, rotation: 0 },
    ],
    allPhotos: [
        { id: 30, title: "Foto Arquivo", rotation: 0 },
    ],
    activeVideo: null,
    activePhoto: null,
};

const hSeq = new TimelineSequenceState({
    id: "headless_1",
    name: "Motor Headless MCP",
    headless: true,
    mediaCatalog: headlessCatalog,
});

assert.equal(hSeq.headless, true);
assert.equal(hSeq.isolated, true);
assert.ok(hSeq instanceof TimelineSequenceState);
assert.ok(hSeq instanceof CapiauTimelineState);
assert.ok(hSeq.history instanceof TimelineHistory);

let globalEventsDuringHeadless = 0;
const countGlobal = () => { globalEventsDuringHeadless += 1; };
STATE.on("timelineCutsUpdated", countGlobal);

let localEvents = 0;
hSeq.on("timelineCutsUpdated", () => { localEvents += 1; });

const cutH1 = hSeq.insertMedia({ type: "video", id: 10, inSec: 0, outSec: 4, mode: "end" });
assert.ok(cutH1, "insertMedia deve funcionar em modo headless puro");
assert.equal(hSeq.cuts.length, 2, "Deve criar par vídeo (V1) + áudio (A1)");
assert.equal(globalEventsDuringHeadless, 0, "Sequência headless/inativa NÃO deve emitir no STATE global");
assert.ok(localEvents >= 1, "Sequência headless deve emitir eventos locais via seq.on()");
assert.equal(STATE.activeTimelineCuts.length, 0, "STATE.activeTimelineCuts global não foi contaminado");

hSeq.setClipColorLabel(cutH1.id, "cyan");
assert.equal(hSeq.cuts.find(c => c.id === cutH1.id).colorLabel, "cyan");
assert.equal(hSeq.history.undo(), true, "Undo próprio da sequência headless funciona");
assert.equal(hSeq.cuts.find(c => c.id === cutH1.id).colorLabel, null);
assert.equal(hSeq.history.redo(), true, "Redo próprio da sequência headless funciona");
assert.equal(hSeq.cuts.find(c => c.id === cutH1.id).colorLabel, "cyan");
STATE.off("timelineCutsUpdated", countGlobal);
ok("Execução headless completa (insert, colorLabel, undo/redo, eventos locais sem poluir STATE)");

// ── 2. Isolamento completo entre instâncias & Invariante A/V próprio ──────────
console.log("\n2. Testando isolamento multi-instância e invariante A/V por instância...");
const seq1 = new TimelineSequenceState({ id: "iso_1", name: "Seq 1", fps: 24, width: 1920, height: 1080, headless: true });
const seq2 = new TimelineSequenceState({ id: "iso_2", name: "Seq 2", fps: 30, width: 1080, height: 1920, headless: true });

seq1.setTracks([
    { id: "V1", name: "V1", kind: "video", locked: false, syncLocked: true },
    { id: "A1", name: "A1", kind: "audio", locked: false, syncLocked: true },
]);
seq2.setTracks([
    { id: "V1", name: "V1", kind: "video", locked: false, syncLocked: true },
    { id: "A1", name: "A1", kind: "audio", locked: true, syncLocked: true }, // A1 travada só na seq2
]);

// Na seq1 (24 fps, V1 e A1 destravadas), barreira em A1 (a0 em 0..24) empurra a1 e v1 de 12 para 24 mantendo sync A/V
seq1.cuts = [
    { id: "a0", track: "A1", inFrame: 0, outFrame: 24, timelineStartFrame: 0 },
    { id: "v1", track: "V1", inFrame: 0, outFrame: 48, timelineStartFrame: 12, link_id: "L1" },
    { id: "a1", track: "A1", inFrame: 0, outFrame: 48, timelineStartFrame: 12, syncOffset: 0, link_id: "L1" },
];
assert.equal(seq1.cuts.find(c => c.id === "a1").timelineStartFrame, 24, "Barreira em A1 posiciona a1 em 24");
assert.equal(seq1.cuts.find(c => c.id === "v1").timelineStartFrame, 24, "Invariante A/V da seq1 empurra v1 para 24 junto com a1");

// Na seq2 (30 fps, A1 travada), áudio mantém posição explícita apesar de V1
seq2.cuts = [
    { id: "v2", track: "V1", in: 0, out: 2, timelineStartFrame: 0, link_id: "L2" },
    { id: "a2", track: "A1", in: 0, out: 2, timelineStartFrame: 15, link_id: "L2" },
];
const v2 = seq2.cuts.find(c => c.id === "v2");
const a2 = seq2.cuts.find(c => c.id === "a2");
assert.equal(v2.outFrame, 60, "seq2 usa próprio fps=30 (2s = 60 frames)");
assert.equal(a2.timelineStartFrame, 15, "seq2 respeita trava de A1 própria");
assert.equal(a2.syncOffset, 15, "syncOffset calculado na seq2 sem interferir na seq1");
assert.equal(seq1.cuts.length, 3, "seq1 permanece isolada");

seq2.addMarker({ frame: 30, label: "Beat Seq 2" });
assert.equal(seq1.markers.length, 0, "Marcadores não vazam entre instâncias");
assert.equal(seq2.markers.length, 1);

seq2.setInPoint(10);
seq2.setOutPoint(50);
seq2.setPlayheadFrame(25);
assert.equal(seq1.inFrame, null);
assert.equal(seq1.outFrame, null);
assert.equal(seq1.playheadFrame, 0);
ok("Isolamento de cuts, tracks, fps, width/height, in/out, playhead, markers e invariante A/V validado");

// ── 3. Fachada compatível (TIMELINE_STATE, TIMELINE_HISTORY, STATE.activeTimelineCuts) ──
console.log("\n3. Testando fachada compatível e troca dinâmica de sequência ativa...");
SEQUENCE_MANAGER.resetToSingleSequence({ id: "main_seq", name: "Corte Principal", headless: false });

assert.equal(TIMELINE_STATE.__isTimelineFacade, true);
assert.equal(TIMELINE_HISTORY.__isHistoryFacade, true);
assert.ok(TIMELINE_STATE instanceof TimelineSequenceState);
assert.ok(TIMELINE_STATE instanceof CapiauTimelineState);

STATE.allVideos = headlessCatalog.allVideos;
STATE.allPhotos = headlessCatalog.allPhotos;

STATE.activeTimelineCuts = [
    { id: "base_v1", track: "V1", video_id: 10, inFrame: 0, outFrame: 72, timelineStartFrame: 0, link_id: "L_base" },
    { id: "base_a1", track: "A1", video_id: 10, inFrame: 0, outFrame: 72, timelineStartFrame: 0, link_id: "L_base" },
];
TIMELINE_STATE.setPlayheadFrame(36);
TIMELINE_STATE.addMarker({ frame: 36, label: "Corte Base" });
assert.equal(TIMELINE_HISTORY.undoStack.length, 1);

// Criar segunda aba de sequência e ativar
const tabSelects = SEQUENCE_MANAGER.createSequence({
    id: "seq_selects",
    name: "Selects Entrevistas",
    kind: "selects",
    fps: 60,
    width: 3840,
    height: 2160,
    headless: false,
    activate: true,
});

assert.equal(SEQUENCE_MANAGER.getActiveSequenceId(), "seq_selects");
assert.equal(TIMELINE_STATE.fps, 60, "TIMELINE_STATE reflete fps da aba ativa");
assert.equal(TIMELINE_STATE.width, 3840, "TIMELINE_STATE reflete resolução da aba ativa");
assert.equal(STATE.activeTimelineCuts.length, 0, "STATE.activeTimelineCuts reflete a nova aba vazia");
assert.equal(TIMELINE_HISTORY.undoStack.length, 0, "TIMELINE_HISTORY reflete o histórico vazio da nova aba");

// Editar na aba selects via fachada clássica
STATE.activeTimelineCuts = [
    { id: "sel_1", track: "V1", video_id: 20, inFrame: 0, outFrame: 120, timelineStartFrame: 0 },
];
TIMELINE_STATE.setClipColorLabel("sel_1", "violet");
assert.equal(tabSelects.cuts[0].colorLabel, "violet");
assert.equal(TIMELINE_HISTORY.undoStack.length, 1);

// Voltar para a sequência principal e checar preservação total
let switchedPayload = null;
STATE.on("activeSequenceChanged", (p) => { switchedPayload = p; });
SEQUENCE_MANAGER.setActiveSequence("main_seq");

assert.equal(switchedPayload.sequenceId, "main_seq");
assert.equal(switchedPayload.previousSequenceId, "seq_selects");
assert.equal(TIMELINE_STATE.fps, 24);
assert.equal(TIMELINE_STATE.playheadFrame, 36);
assert.equal(STATE.activeTimelineCuts.length, 2);
assert.equal(STATE.activeTimelineCuts[0].id, "base_v1");
assert.equal(TIMELINE_STATE.markers[0].label, "Corte Base");
assert.equal(TIMELINE_HISTORY.undoStack.length, 1, "Histórico da sequência principal preservado");
assert.equal(tabSelects.cuts[0].colorLabel, "violet", "Selects preservado em background");
ok("Fachada Proxy (TIMELINE_STATE / TIMELINE_HISTORY / STATE.activeTimelineCuts) alterna abas sem perda");

// ── 4. Clones / Múltiplas Sequências Fantasmas da IA + Undo Atômico por Turno + Diff ──
console.log("\n4. Testando Clone Fantasma da IA, Turno Atômico e Diff Estrutural...");
const baseSeq = SEQUENCE_MANAGER.getSequence("main_seq");
const baseRevBefore = baseSeq.revision;

const cloneDir = SEQUENCE_MANAGER.cloneSequence("main_seq", {
    id: "ghost_diretora",
    name: "Clone · Diretora (Ritmo)",
    kind: "ghost",
    author: "diretora",
    brief: "Inserir B-Roll em V2 e dividir clipe base no frame 36",
    headless: true,
});

const cloneSound = SEQUENCE_MANAGER.cloneSequence("main_seq", {
    id: "ghost_sound",
    name: "Clone · Sound Designer",
    kind: "ghost",
    author: "sound_designer",
    brief: "Ajustar marcador de J-cut",
    headless: true,
});

assert.equal(cloneDir.baseSequenceId, "main_seq");
assert.equal(cloneDir.baseRevision, baseRevBefore);
assert.equal(cloneDir.revision, 1, "Clone recém-criado deve iniciar na revisão 1");
assert.equal(SEQUENCE_MANAGER.getGhostClones("main_seq").length, 2);
assert.equal(cloneDir.history.undoStack.length, 0, "Clone inicia com histórico próprio limpo");

// Turno atômico da IA sobre cloneDir (várias operações -> 1 Undo)
SEQUENCE_MANAGER.applyAtomicTurn("ghost_diretora", (seq) => {
    seq.splitClipAtFrame("base_v1", 36, true);
    seq.addCut(20, 0, 2, "V2", 12);
    seq.addMarker({ frame: 12, label: "Cobrir respiro (IA)" });
});

// Base não foi tocada!
assert.equal(baseSeq.cuts.length, 2, "Base permanece intacta após edição no clone");
assert.equal(baseSeq.markers.length, 1);

// Clone recebeu todas as mutações em 1 entrada atômica de histórico
assert.ok(cloneDir.cuts.length > 2, "Clone recebeu split + novo B-Roll");
assert.equal(cloneDir.markers.length, 2);
assert.equal(cloneDir.history.undoStack.length, 1, "Turno multi-operação gera exatamente 1 entrada de Undo");

// Diff estrutural contra a base
const diff = cloneDir.diffAgainst(baseSeq);
assert.equal(diff.summary.hasChanges, true);
assert.ok(diff.added.length >= 2, "Diff detecta novos clipes adicionados (split + B-Roll)");
assert.ok(diff.modified.length >= 1, "Diff detecta base_v1/base_a1 modificados no split");
assert.equal(diff.markersChanged, true, "Diff detecta marcador adicionado no clone");

// Undo atômico do turno inteiro da IA
assert.equal(cloneDir.history.undo(), true);
assert.equal(cloneDir.cuts.length, 2, "1 Undo reverte todo o turno multi-operação do clone");
assert.equal(cloneDir.markers.length, 1);
assert.equal(cloneDir.diffAgainst(baseSeq).summary.hasChanges, false, "Após Undo atômico, diff contra base zera");

// Redo restaura todo o turno
assert.equal(cloneDir.history.redo(), true);
assert.ok(cloneDir.cuts.length > 2);
assert.equal(cloneSound.cuts.length, 2, "Segundo clone fantasma permanece isolado do primeiro");
ok("Múltiplos clones fantasmas, diffAgainst e applyAtomicTurn (Undo em 1 passo) validados");

// ── 5. Snapshot roundtrip + proteção ao remover sequência ──────────────────────
console.log("\n5. Testando toSnapshot/loadSnapshot e remoção segura de sequências...");
const snap = cloneDir.toSnapshot({ includeHistory: true });
const restored = SEQUENCE_MANAGER.createSequenceFromSnapshot(snap, { id: "restored_tab", activate: false });
assert.equal(restored.revision, snap.revision, "loadSnapshot deve preservar a revisão exata da sequência");
assert.equal(restored.cuts.length, cloneDir.cuts.length);
assert.equal(restored.fps, cloneDir.fps);
assert.equal(restored.markers.length, cloneDir.markers.length);
assert.equal(restored.history.undoStack.length, cloneDir.history.undoStack.length);

// Remoção: permite remover clones e abas extras, mas protege a última sequência principal editável
assert.equal(SEQUENCE_MANAGER.removeSequence("ghost_diretora"), true);
assert.equal(SEQUENCE_MANAGER.removeSequence("ghost_sound"), true);
assert.equal(SEQUENCE_MANAGER.removeSequence("seq_selects"), true);
assert.equal(SEQUENCE_MANAGER.removeSequence("restored_tab"), true);
assert.equal(SEQUENCE_MANAGER.removeSequence("main_seq"), false, "Não pode remover a única sequência principal restante");

// Garantir compatibilidade de instância legada (new CapiauTimelineState() sem isolated)
const legacy = new CapiauTimelineState();
assert.equal(legacy.isolated, false);
assert.equal(legacy.cuts.length, STATE.activeTimelineCuts.length);
ok("Roundtrip de snapshot, proteção de remoção e instância legada CapiauTimelineState validados");

console.log(`\n🎉 AUTOTESTE ESTÁGIO 1A CONCLUÍDO COM SUCESSO (${testCount}/${testCount} baterias)!`);
