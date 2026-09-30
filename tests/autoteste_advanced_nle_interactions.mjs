// ============================================================================
// Autoteste Automatizado: Pacote Avançado de Novas Interações NLE (Milestone M3)
// Execução: node tests/autoteste_advanced_nle_interactions.mjs
//
// Cobre as 4 interações fundamentais:
// 1. Edição Baseada em Texto com Falas Sobrepostas (Overlapping Speech & Audio Routing)
// 2. Montagem Preliminar Agêntica / Rough Cut com Justificativas Dramáticas
// 3. Diff Interativo da Timeline & Gatekeeper de Segurança (System 1)
// 4. Grounding Espacial no Player de Vídeo (Gemini Canonical Boxes & Semantic Search)
// ============================================================================

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// ── 0. Polyfills de Ambiente para Execução Node.js ESM ─────────────────────────
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

const _storageData = {};
globalThis.localStorage = {
    getItem(k) { return _storageData[k] !== undefined ? _storageData[k] : null; },
    setItem(k, v) { _storageData[k] = String(v); },
    removeItem(k) { delete _storageData[k]; },
    clear() { Object.keys(_storageData).forEach(k => delete _storageData[k]); }
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
        tagName: tag,
        style: {},
        classList: {
            add() {},
            remove() {},
            contains: () => false
        },
        appendChild() {},
        setAttribute() {},
        getAttribute: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    }),
    body: { appendChild() {} },
    addEventListener: () => {},
    removeEventListener: () => {}
};

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("▶ INICIANDO AUTOTESTE: PACOTE AVANÇADO DE NOVAS INTERAÇÕES NLE (M3)");
console.log("════════════════════════════════════════════════════════════════════════════\n");

// Importações dos Módulos UI
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { extractWordRangeFromSpans, detectConcurrentSpeakerTrack } = await import("../src/ui/js/panels.js");
const { canonical_to_pixel_box } = await import("../src/ui/js/player.js");

// Configuração Base da Timeline
TIMELINE_STATE.fps = 24;
STATE.activeVideo = { id: 101, fps: 24, duration: 120.0 };

// ════════════════════════════════════════════════════════════════════════════
// 1. Edição Baseada em Texto com Falas Sobrepostas (Overlapping Speech)
// ════════════════════════════════════════════════════════════════════════════
console.log("── 1. Edição Baseada em Texto com Falas Sobrepostas (Overlapping Speech) ──");

// 1.1 Utilitário extractWordRangeFromSpans
console.log("  1.1 Testando extração de intervalo de palavras a partir de .word-span...");
const mockWordSpans = [
    { dataset: { start: "2.10", end: "2.45" }, textContent: "Estar" },
    { dataset: { start: "2.50", end: "2.85" }, textContent: "presente" },
    { dataset: { start: "2.90", end: "3.40" }, textContent: "aqui" }
];
const extractedRange = extractWordRangeFromSpans(mockWordSpans);
assert.ok(extractedRange, "Intervalo extraído deve ser válido");
assert.equal(extractedRange.inSec, 2.10, "inSec deve ser 2.10s");
assert.equal(extractedRange.outSec, 3.40, "outSec deve ser 3.40s");
assert.equal(extractedRange.wordCount, 3, "wordCount deve ser 3");
assert.equal(extractedRange.text, "Estar presente aqui", "Texto completo deve ser montado corretamente");
assert.ok(Math.abs(extractedRange.duration - 1.30) < 0.001, "Duração deve ser 1.30s");

// Teste com atributos DOM padrão (getAttribute)
const mockAttrSpans = [
    { getAttribute: (k) => k === "data-start" ? "10.0" : (k === "data-end" ? "12.5" : null), textContent: "Entrevista" }
];
const attrRange = extractWordRangeFromSpans(mockAttrSpans);
assert.equal(attrRange.inSec, 10.0);
assert.equal(attrRange.outSec, 12.5);
assert.equal(attrRange.text, "Entrevista");

// Teste de resiliência com lista vazia
assert.equal(extractWordRangeFromSpans([]), null, "Lista vazia deve retornar null");
assert.equal(extractWordRangeFromSpans(null), null, "Nulo deve retornar null");
console.log("  ✔ extractWordRangeFromSpans validado com sucesso.");

// 1.2 Detecção de concorrência e roteamento de pistas de áudio
console.log("  1.2 Testando detectConcurrentSpeakerTrack para roteamento A1/A2...");
const dlg1 = { speaker_id: "spk_1", start_time: 10.0, end_time: 15.0 };
const dlg2Sequential = { speaker_id: "spk_2", start_time: 15.0, end_time: 20.0 };
const dlg3Concurrent = { speaker_id: "spk_2", start_time: 12.0, end_time: 17.0 };
const dlg4SameSpeaker = { speaker_id: "spk_1", start_time: 11.0, end_time: 16.0 };

const seqRes = detectConcurrentSpeakerTrack(dlg2Sequential, dlg1);
assert.equal(seqRes.isConcurrent, false, "Falas consecutivas não são concorrentes");
assert.equal(seqRes.audioTrackId, "A1", "Locutor consecutivo deve ser roteado para A1");
assert.equal(seqRes.speakerOrder, 1);

const concRes = detectConcurrentSpeakerTrack(dlg3Concurrent, dlg1);
assert.equal(concRes.isConcurrent, true, "Falas sobrepostas temporalmente de locutores distintos são concorrentes");
assert.equal(concRes.audioTrackId, "A2", "Locutor sobreposto deve ser roteado para A2 para evitar colisão");
assert.equal(concRes.speakerOrder, 2);

const sameSpkRes = detectConcurrentSpeakerTrack(dlg4SameSpeaker, dlg1);
assert.equal(sameSpkRes.isConcurrent, false, "Mesmo locutor não é marcado como concorrência entre interlocutores");
assert.equal(sameSpkRes.audioTrackId, "A1");
console.log("  ✔ detectConcurrentSpeakerTrack validado com sucesso.");

// 1.3 Inserção individual com insertSpeechCut na timeline
console.log("  1.3 Testando TIMELINE_STATE.insertSpeechCut com roteamento A1 e A2...");
STATE.activeTimelineCuts = [];
TIMELINE_HISTORY.clear();

const cutSpk1 = TIMELINE_STATE.insertSpeechCut(101, 10.0, 14.0, {
    speakerId: "spk_1",
    isSecondary: false,
    audioTrackId: "A1"
});
assert.ok(cutSpk1, "Corte do Locutor 1 deve ter sido criado");
assert.equal(cutSpk1.track, "V1", "Vídeo principal roteado para V1");
assert.equal(cutSpk1.audioTrackId, "A1", "Áudio do Locutor 1 roteado para A1");
assert.equal(cutSpk1.crossfadeFrames, 2, "Micro-crossfade padrão de 2 frames aplicado");
assert.equal(cutSpk1.is_speech_cut, true, "Flag de fala ativa");

const cutSpk2 = TIMELINE_STATE.insertSpeechCut(101, 12.0, 16.0, {
    speakerId: "spk_2",
    isSecondary: true,
    audioTrackId: "A2"
});
assert.ok(cutSpk2, "Corte do Locutor 2 deve ter sido criado");
assert.equal(cutSpk2.audioTrackId, "A2", "Áudio secundário roteado para pista A2");
assert.equal(cutSpk2.is_concurrent, true, "Flag de fala concorrente ativa");
console.log("  ✔ TIMELINE_STATE.insertSpeechCut validado com sucesso.");

// 1.4 Inserção de par simultâneo com insertConcurrentSpeechPair
console.log("  1.4 Testando TIMELINE_STATE.insertConcurrentSpeechPair sem colisão...");
STATE.activeTimelineCuts = [];
TIMELINE_HISTORY.clear();

const pairResults = TIMELINE_STATE.insertConcurrentSpeechPair(
    { videoId: 101, inSec: 30.0, outSec: 36.0, speakerId: "spk_alice" },
    { videoId: 101, inSec: 32.0, outSec: 35.0, speakerId: "spk_bob" },
    { timelineStartFrame: 720 } // Inicia no frame 720 (30.0s @ 24fps)
);
assert.equal(pairResults.length, 2, "Deve retornar exatamente 2 cortes");
assert.equal(pairResults[0].audioTrackId, "A1", "Locutor 1 roteado para A1");
assert.equal(pairResults[1].audioTrackId, "A2", "Locutor 2 roteado para A2 sem colisão com A1");

const cutsOnTimeline = STATE.activeTimelineCuts || [];
const cutsOnA1 = cutsOnTimeline.filter(c => c.track === "A1");
const cutsOnA2 = cutsOnTimeline.filter(c => c.track === "A2");
assert.ok(cutsOnA1.length >= 1, "Deve haver corte na pista de áudio A1");
assert.ok(cutsOnA2.length >= 1, "Deve haver corte na pista de áudio A2");
console.log("  ✔ Inserção coordenada de falas sobrepostas em A1 e A2 validada com sucesso.\n");

// ════════════════════════════════════════════════════════════════════════════
// 2. Montagem Preliminar Agêntica (Agentic Rough Cut / Assembly)
// ════════════════════════════════════════════════════════════════════════════
console.log("── 2. Montagem Preliminar Agêntica (Agentic Rough Cut / Assembly) ──");

console.log("  2.1 Testando injeção de marcadores editoriais com justificativas dramáticas...");
TIMELINE_STATE.markers = [];
TIMELINE_HISTORY.clear();

const roughMarkersPayload = [
    {
        start_s: 0.0,
        label: "Beat 1: Gancho Dramático (Cold Open)",
        color: "#06b6d4",
        dramatic_justification: "Captura imediata de interesse através da revelação enigmática da cena de abertura."
    },
    {
        timeline_start: 12.5,
        label: "Beat 2: Ponto de Inflexão (Inciting Incident)",
        color: "#f59e0b",
        dramatic_justification: "Desencadeamento da motivação principal dos personagens com corte para plano detalhe."
    },
    {
        start_s: 25.0,
        label: "Beat 3: Clímax Narrativo",
        color: "#ef4444",
        dramatic_justification: "Confronto dialético com ritmo acelerado de cortes sincopados."
    }
];

const createdMarkers = TIMELINE_STATE.populateRoughCutMarkers(roughMarkersPayload);
assert.equal(createdMarkers.length, 3, "Devem ter sido criados 3 marcadores editoriais");
assert.equal(TIMELINE_STATE.markers.length, 3, "TIMELINE_STATE.markers deve conter 3 marcadores");

// Validação dos frames convertidos a partir de segundos @ 24fps
assert.equal(createdMarkers[0].frame, 0, "Frame do Beat 1 deve ser 0");
assert.equal(createdMarkers[1].frame, Math.round(12.5 * 24), "Frame do Beat 2 deve ser 300");
assert.equal(createdMarkers[2].frame, Math.round(25.0 * 24), "Frame do Beat 3 deve ser 600");

// Validação das justificativas dramáticas e cores
assert.equal(createdMarkers[0].comment, "Captura imediata de interesse através da revelação enigmática da cena de abertura.");
assert.equal(createdMarkers[1].color, "#f59e0b");
assert.equal(createdMarkers[2].label, "Beat 3: Clímax Narrativo");

// Teste de reversibilidade (Undo / Redo com Ctrl+Z)
console.log("  2.2 Testando Undo/Redo na criação em lote dos marcadores do Rough Cut...");
assert.equal(TIMELINE_HISTORY.undoStack.length, 1, "Histórico deve registrar 1 snapshot atômico para o lote");

const undoOk = TIMELINE_HISTORY.undo();
assert.ok(undoOk, "Undo deve retornar true");
assert.equal(TIMELINE_STATE.markers.length, 0, "Marcadores devem ter sido revertidos pelo Undo");

const redoOk = TIMELINE_HISTORY.redo();
assert.ok(redoOk, "Redo deve retornar true");
assert.equal(TIMELINE_STATE.markers.length, 3, "Marcadores devem ter sido restaurados pelo Redo");
assert.equal(TIMELINE_STATE.markers[0].label, "Beat 1: Gancho Dramático (Cold Open)");
console.log("  ✔ População de marcadores de Rough Cut e Undo/Redo validados com sucesso.\n");

// ════════════════════════════════════════════════════════════════════════════
// 3. Diff Interativo da Timeline & Gatekeeper de Segurança
// ════════════════════════════════════════════════════════════════════════════
console.log("── 3. Diff Interativo da Timeline & Gatekeeper de Segurança (System 1) ──");

// 3.1 Trilha Fantasma (ghostTrack) e getTimelineDiffSummary
console.log("  3.1 Testando proposta em trilha fantasma e getTimelineDiffSummary()...");
TIMELINE_STATE.ghostTrack = [];
STATE.activeTimelineCuts = [
    { id: "cut_base_1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 96, in: 0, out: 4.0, link_id: "link_b1" },
    { id: "cut_base_1_a", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 96, in: 0, out: 4.0, link_id: "link_b1" }
];

TIMELINE_STATE.ghostTrack = [
    { action: "INSERT", track: "V1", audioTrackId: "A1", timelineStartFrame: 96, inFrame: 0, outFrame: 48, in: 0, out: 2.0, video_id: 101 },
    { action: "REPLACE", track: "V1", audioTrackId: "A1", targetClipId: "cut_base_1", timelineStartFrame: 0, inFrame: 10, outFrame: 58, in: 0.41, out: 2.41, video_id: 101 },
    { action: "DELETE", track: "V1", targetClipId: "cut_base_1" }
];

const diffSummary = TIMELINE_STATE.getTimelineDiffSummary();
assert.equal(diffSummary.total, 3, "Total de sugestões fantasma deve ser 3");
assert.equal(diffSummary.additions, 1, "Adições deve ser 1");
assert.equal(diffSummary.replacements, 1, "Substituições deve ser 1");
assert.equal(diffSummary.deletions, 1, "Deleções deve ser 1");
assert.ok(diffSummary.affectedTracks.includes("V1"), "Pista V1 deve constar nas pistas afetadas");
console.log("  ✔ getTimelineDiffSummary retornou resumo estruturado de diferenças com sucesso.");

// 3.2 Rejeição de Proposta Fantasma (Descartar)
console.log("  3.2 Testando rejeição em lote com rejectAllGhostSuggestions()...");
const cutsBeforeReject = [...STATE.activeTimelineCuts];
const rejectRes = TIMELINE_STATE.rejectAllGhostSuggestions();

assert.equal(rejectRes.rejectedCount, 3, "Deve reportar 3 sugestões descartadas");
assert.equal(TIMELINE_STATE.ghostTrack.length, 0, "ghostTrack deve ter sido limpa");
assert.equal(STATE.activeTimelineCuts.length, cutsBeforeReject.length, "Cortes ativos não devem ser alterados");
console.log("  ✔ rejectAllGhostSuggestions validado com sucesso.");

// 3.3 Aceite de Proposta Fantasma (Aplicar Mudanças)
console.log("  3.3 Testando aceite com acceptAllGhostSuggestions()...");
TIMELINE_STATE.ghostTrack = [
    { action: "INSERT", track: "V1", audioTrackId: "A1", timelineStartFrame: 96, inFrame: 0, outFrame: 48, in: 0, out: 2.0, video_id: 101 }
];

const acceptRes = TIMELINE_STATE.acceptAllGhostSuggestions();
assert.equal(acceptRes.acceptedCount, 1, "Deve reportar 1 sugestão aplicada");
assert.equal(TIMELINE_STATE.ghostTrack.length, 0, "ghostTrack deve ser limpa após aplicação");
assert.ok(STATE.activeTimelineCuts.length > cutsBeforeReject.length, "Novos cortes devem ter sido fundidos à timeline");

// Teste de Undo do aceite
const undoAcceptOk = TIMELINE_HISTORY.undo();
assert.ok(undoAcceptOk, "Undo do aceite de sugestões deve ser suportado");
console.log("  ✔ acceptAllGhostSuggestions e Undo validados com sucesso.");

// 3.4 Testando Gatekeeper de Segurança e Card de Diff no Python Backend
console.log("  3.4 Testando evaluate_safety_gatekeeper e diff card (Python Backend)...");
const pythonScript = [
    "from src.services.chat_agent import ChatAgentService",
    "class MockShadow:",
    "    def __init__(self):",
    "        self.cuts = [{'id': f'cut_{i}', 'timeline_start': i*5, 'duration': 5.0} for i in range(4)]",
    "        self.fps = 24.0",
    "    def get_duration(self):",
    "        return 20.0",
    "shadow = MockShadow()",
    "safe_ops = [{'action': 'INSERT', 'track': 'V2', 'in_s': 0, 'out_s': 3}]",
    "res_safe = ChatAgentService.evaluate_safety_gatekeeper(shadow, safe_ops)",
    "assert res_safe['risk_level'] == 'safe'",
    "assert res_safe['requires_confirmation'] is True",
    "warn_ops = [{'action': 'INSERT', 'track': 'V1', 'in_s': 0, 'out_s': 3}]",
    "res_warn = ChatAgentService.evaluate_safety_gatekeeper(shadow, warn_ops)",
    "assert res_warn['risk_level'] == 'warning'",
    "destr_ops = [{'action': 'DELETE', 'track': 'V1', 'in_s': 0, 'out_s': 3}]",
    "res_destr = ChatAgentService.evaluate_safety_gatekeeper(shadow, destr_ops)",
    "assert res_destr['risk_level'] == 'destructive'",
    "card_html = ChatAgentService.render_diff_summary_card(res_warn, warn_ops, 'Justificativa Dramática')",
    "assert 'timeline-diff-card' in card_html",
    "assert 'btn-diff-accept' in card_html",
    "assert 'btn-diff-reject' in card_html",
    "assert 'Aplicar Mudanças' in card_html",
    "assert 'Descartar' in card_html",
    "rc_ops, rc_markers = ChatAgentService.build_rough_cut_operations(1, [{'video_id': 101, 'in_s': 0, 'out_s': 5}], [{'timeline_start': 0, 'label': 'Beat 1'}], shadow, 'Dramatic Assembly')",
    "assert len(rc_ops) >= 1",
    "assert len(rc_markers) >= 1",
    "print('PY_OK')"
].join("\n");

try {
    const pyOutput = execFileSync("python", ["-c", pythonScript], { encoding: "utf8" });
    assert.ok(pyOutput.includes("PY_OK"), "Backend Python deve validar regras de segurança");
    console.log("  ✔ evaluate_safety_gatekeeper e render_diff_summary_card no Python validados com sucesso.\n");
} catch (err) {
    console.error("Erro ao validar backend Python:", err);
    throw err;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Click-to-Search Grounding no Player de Vídeo
// ════════════════════════════════════════════════════════════════════════════
console.log("── 4. Click-to-Search Grounding no Player de Vídeo ──");

// 4.1 Conversão canônica Gemini [ymin, xmin, ymax, xmax] (0-1000) para pixels
console.log("  4.1 Testando canonical_to_pixel_box com escala canônica Gemini (0-1000)...");
// Caixa representativa: topo 10% (100), esquerda 20% (200), base 40% (400), direita 60% (600)
const geminiBox = [100, 200, 400, 600];
const pxBoxFHD = canonical_to_pixel_box(geminiBox, 1920, 1080);

// Validação em Full HD (1920x1080)
assert.equal(pxBoxFHD.top, Math.round((100 / 1000) * 1080), "top deve ser 108px");
assert.equal(pxBoxFHD.left, Math.round((200 / 1000) * 1920), "left deve ser 384px");
assert.equal(pxBoxFHD.width, Math.round(((600 - 200) / 1000) * 1920), "width deve ser 768px");
assert.equal(pxBoxFHD.height, Math.round(((400 - 100) / 1000) * 1080), "height deve ser 324px");

// Validação dos percentuais CSS
assert.equal(pxBoxFHD.topPct, 10.0, "topPct deve ser 10.0%");
assert.equal(pxBoxFHD.leftPct, 20.0, "leftPct deve ser 20.0%");
assert.equal(pxBoxFHD.widthPct, 40.0, "widthPct deve ser 40.0%");
assert.equal(pxBoxFHD.heightPct, 30.0, "heightPct deve ser 30.0%");

// Validação dos valores canônicos preservados
assert.equal(pxBoxFHD.ymin, 100);
assert.equal(pxBoxFHD.xmin, 200);
assert.equal(pxBoxFHD.ymax, 400);
assert.equal(pxBoxFHD.xmax, 600);
console.log("  ✔ canonical_to_pixel_box em escala canônica 0-1000 validado.");

// 4.2 Testando caixas normalizadas float (0.0-1.0)
console.log("  4.2 Testando caixas normalizadas em float 0.0-1.0 com auto-escalonamento...");
const floatBox = [0.10, 0.20, 0.40, 0.60];
const pxBoxFloat = canonical_to_pixel_box(floatBox, 1920, 1080);
assert.equal(pxBoxFloat.left, 384);
assert.equal(pxBoxFloat.top, 108);
assert.equal(pxBoxFloat.width, 768);
assert.equal(pxBoxFloat.height, 324);
console.log("  ✔ Auto-escalonamento de float 0.0-1.0 validado.");

// 4.3 Retrocompatibilidade com caixas legadas [x, y, w, h]
console.log("  4.3 Testando retrocompatibilidade com caixas legadas [x, y, w, h]...");
const legacyBox = [0.20, 0.10, 0.40, 0.30]; // x=0.2, y=0.1, w=0.4, h=0.3
const pxBoxLegacy = canonical_to_pixel_box(legacyBox, 1000, 1000, true);
assert.equal(pxBoxLegacy.left, 200);
assert.equal(pxBoxLegacy.top, 100);
assert.equal(pxBoxLegacy.width, 400);
assert.equal(pxBoxLegacy.height, 300);
console.log("  ✔ Retrocompatibilidade com [x, y, w, h] validada.");

// 4.4 Resiliência e Clamping
console.log("  4.4 Testando resiliência (caixas invertidas e limites extremos)...");
const invertedBox = [500, 800, 100, 200]; // ymin > ymax, xmin > xmax
const pxInverted = canonical_to_pixel_box(invertedBox, 1000, 1000);
assert.ok(pxInverted.ymin <= pxInverted.ymax, "ymin deve ser menor ou igual a ymax após normalização");
assert.ok(pxInverted.xmin <= pxInverted.xmax, "xmin deve ser menor ou igual a xmax após normalização");

const nullRes = canonical_to_pixel_box(null);
assert.equal(nullRes.width, 0, "Input nulo deve retornar box seguro com zeros");
console.log("  ✔ Resiliência e clamping validados.");

// 4.5 Despacho do evento groundingSearchRequested
console.log("  4.5 Testando emissão do evento global groundingSearchRequested...");
let capturedSearchEvent = null;
const groundingListener = (payload) => {
    capturedSearchEvent = payload;
};
STATE.on("groundingSearchRequested", groundingListener);

const dispatchPayload = {
    query: "Relógio de Pulso Antigo",
    entityType: "prop",
    box: [250, 400, 350, 500],
    videoId: 101
};
STATE.emit("groundingSearchRequested", dispatchPayload);

assert.ok(capturedSearchEvent, "Evento groundingSearchRequested deve ser emitido");
assert.equal(capturedSearchEvent.query, "Relógio de Pulso Antigo");
assert.equal(capturedSearchEvent.entityType, "prop");
assert.deepEqual(capturedSearchEvent.box, [250, 400, 350, 500]);
assert.equal(capturedSearchEvent.videoId, 101);
console.log("  ✔ Evento groundingSearchRequested emitido e validado com sucesso.\n");

// ════════════════════════════════════════════════════════════════════════════
console.log("════════════════════════════════════════════════════════════════════════════");
console.log("✅ TODOS OS AUTOTESTES DO PACOTE AVANÇADO NLE (M3) PASSARAM COM SUCESSO!");
console.log("════════════════════════════════════════════════════════════════════════════");
process.exit(0);
