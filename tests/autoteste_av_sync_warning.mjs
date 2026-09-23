// autoteste_av_sync_warning.mjs
// Autoteste automatizado: Indicadores visuais de dessincronia A/V (+1, -1, +N, -N) e Ferramentas de Ressincronização (Move e Slip)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") {
            return {
                getContext: () => ({
                    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
                    fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
                    measureText: () => ({ width: 50 }),
                    fillText() {}, scale() {}, clearRect() {}, moveTo() {}, lineTo() {}, closePath() {},
                    roundRect() {}
                }),
                ownerDocument: globalThis.document,
                parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
                style: {},
                closest: () => null,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
                addEventListener: () => {},
                removeEventListener: () => {}
            };
        }
        return {
            id,
            style: {},
            classList: {
                toggle: () => {},
                add: () => {},
                remove: () => {},
                contains: () => false
            },
            setAttribute: () => {},
            getAttribute: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            removeEventListener: () => {}
        };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
        style: {},
        appendChild: () => {},
        setAttribute: () => {},
        innerHTML: "",
        remove: () => {}
    }),
    body: {
        appendChild: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {}
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Indicadores de Dessincronia A/V (+1, -1) e Ressincronização NLE...\n");

const { STATE } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "state.js")).href);
const { TIMELINE_STATE, TIMELINE_HISTORY, getClipSyncStatus } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineState.js")).href);
const { CapiauTimelineInteraction } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineInteraction.js")).href);

TIMELINE_STATE.tracks = [
    { id: "V1", name: "Vídeo 1", kind: "video", locked: false, syncLocked: true },
    { id: "A1", name: "Áudio 1", kind: "audio", locked: false, syncLocked: true },
    { id: "V2", name: "Vídeo 2", kind: "video", locked: false, syncLocked: true },
    { id: "A2", name: "Áudio 2", kind: "audio", locked: false, syncLocked: true }
];
TIMELINE_STATE.fps = 24;

const interaction = new CapiauTimelineInteraction({ rulerHeight: 30, requestRedraw: () => {} }, null);

// ── TESTE 1: CLIPE EM SINCRONIA PERFEITA ──
console.log("1. Validando clipe em sincronia perfeita (não deve emitir alerta)...");
STATE.activeTimelineCuts = [
    { id: "v1", track: "V1", inFrame: 100, outFrame: 200, timelineStartFrame: 0, link_id: "link_take1" },
    { id: "a1", track: "A1", inFrame: 100, outFrame: 200, timelineStartFrame: 0, link_id: "link_take1" }
];

const syncV1 = getClipSyncStatus(STATE.activeTimelineCuts[0], STATE.activeTimelineCuts);
const syncA1 = getClipSyncStatus(STATE.activeTimelineCuts[1], STATE.activeTimelineCuts);

assert.equal(syncV1, null, "Clipe de vídeo em sincronia perfeita deve retornar null (sem badge)");
assert.equal(syncA1, null, "Clipe de áudio em sincronia perfeita deve retornar null (sem badge)");
console.log("  ✔ Teste 1 passou: Clipes síncronos retornam null.");

// ── TESTE 2: J-CUT / L-CUT LEGÍTIMO DA MESMA MÍDIA ──
console.log("\n2. Validando J-Cut da mesma tomada (áudio antecipado, mídia síncrona)...");
// Vídeo entra no frame 24 da timeline (inFrame: 100). Âncora = 24 - 100 = -76
// Áudio entra no frame 0 da timeline (inFrame: 76). Âncora = 0 - 76 = -76
STATE.activeTimelineCuts = [
    { id: "v1", track: "V1", inFrame: 100, outFrame: 200, timelineStartFrame: 24, link_id: "link_take1" },
    { id: "a1", track: "A1", inFrame: 76, outFrame: 200, timelineStartFrame: 0, link_id: "link_take1" }
];

const syncJCutV = getClipSyncStatus(STATE.activeTimelineCuts[0], STATE.activeTimelineCuts);
const syncJCutA = getClipSyncStatus(STATE.activeTimelineCuts[1], STATE.activeTimelineCuts);

assert.equal(syncJCutV, null, "J-Cut legítimo de mesma mídia não deve disparar aviso de dessincronia no vídeo.");
assert.equal(syncJCutA, null, "J-Cut legítimo de mesma mídia não deve disparar aviso de dessincronia no áudio.");
console.log("  ✔ Teste 2 passou: J-Cut da mesma tomada não emite aviso falso-positivo.");

// ── TESTE 3: DESSINCRONIA DE +1 E -1 QUADRO ──
console.log("\n3. Validando cálculo de offset com áudio atrasado em 1 frame (+1 / -1)...");
// Vídeo: timelineStart = 0, inFrame = 100 (âncora = -100)
// Áudio: timelineStart = 1, inFrame = 100 (âncora = -99). diff = -99 - (-100) = +1
STATE.activeTimelineCuts = [
    { id: "v1", track: "V1", inFrame: 100, outFrame: 200, timelineStartFrame: 0, link_id: "link_take1" },
    { id: "a1", track: "A1", inFrame: 100, outFrame: 200, timelineStartFrame: 1, link_id: "link_take1" }
];

const syncV_plus1 = getClipSyncStatus(STATE.activeTimelineCuts[0], STATE.activeTimelineCuts);
const syncA_plus1 = getClipSyncStatus(STATE.activeTimelineCuts[1], STATE.activeTimelineCuts);

assert.notEqual(syncV_plus1, null, "Vídeo deve acusar dessincronia");
assert.notEqual(syncA_plus1, null, "Áudio deve acusar dessincronia");
assert.equal(syncA_plus1.offset, 1, "Áudio deve ter offset numérico +1");
assert.equal(syncA_plus1.text, "+1", "Texto do badge no áudio deve ser '+1'");
assert.equal(syncV_plus1.offset, -1, "Vídeo deve ter offset numérico -1");
assert.equal(syncV_plus1.text, "-1", "Texto do badge no vídeo deve ser '-1'");
console.log("  ✔ Teste 3 passou: Áudio atrasado 1 frame exibe '+1' no áudio e '-1' no vídeo.");

// ── TESTE 4: DESSINCRONIA DE 12 QUADROS (ÁUDIO ADIANTADO) ──
console.log("\n4. Validando cálculo de offset com áudio adiantado em 12 quadros (-12 / +12)...");
// Vídeo: timelineStart = 50, inFrame = 100 (âncora = -50)
// Áudio: timelineStart = 38, inFrame = 100 (âncora = -62). diff = -62 - (-50) = -12
STATE.activeTimelineCuts = [
    { id: "v1", track: "V1", inFrame: 100, outFrame: 200, timelineStartFrame: 50, link_id: "link_take1" },
    { id: "a1", track: "A1", inFrame: 100, outFrame: 200, timelineStartFrame: 38, link_id: "link_take1" }
];

const syncV_minus12 = getClipSyncStatus(STATE.activeTimelineCuts[0], STATE.activeTimelineCuts);
const syncA_minus12 = getClipSyncStatus(STATE.activeTimelineCuts[1], STATE.activeTimelineCuts);

assert.equal(syncA_minus12.offset, -12, "Áudio adiantado deve ter offset -12");
assert.equal(syncA_minus12.text, "-12", "Texto do badge no áudio deve ser '-12'");
assert.equal(syncV_minus12.offset, 12, "Vídeo atrasado relativo deve ter offset +12");
assert.equal(syncV_minus12.text, "+12", "Texto do badge no vídeo deve ser '+12'");
console.log("  ✔ Teste 4 passou: Áudio adiantado 12 quadros exibe '-12' no áudio e '+12' no vídeo.");

// ── TESTE 5: RESSINCRONIZAÇÃO VIA MOVE (MOVER PARA SINCRONIA) ──
console.log("\n5. Validando resyncClip(clipId, 'move')...");
// Áudio está em 38, deveria estar em 50 para alinhar com o vídeo em 50
interaction.resyncClip("a1", "move");

const a1_moved = STATE.activeTimelineCuts.find(c => c.id === "a1");
const v1_stayed = STATE.activeTimelineCuts.find(c => c.id === "v1");

assert.equal(a1_moved.timelineStartFrame, 50, "timelineStartFrame do áudio deve ser movido para 50");
assert.equal(v1_stayed.timelineStartFrame, 50, "Vídeo não foi alterado");
assert.equal(getClipSyncStatus(a1_moved, STATE.activeTimelineCuts), null, "Status de sincronia do áudio deve voltar a ser null");
assert.equal(getClipSyncStatus(v1_stayed, STATE.activeTimelineCuts), null, "Status de sincronia do vídeo deve voltar a ser null");
console.log("  ✔ Teste 5 passou: resyncClip('move') posicionou o áudio exatamente na sincronia.");

// ── TESTE 6: RESSINCRONIZAÇÃO VIA SLIP (DESLIZAR CONTEÚDO) ──
console.log("\n6. Validando resyncClip(clipId, 'slip')...");
// Causa dessincronia movendo o áudio para 60 (atrasado 10 quadros)
a1_moved.timelineStartFrame = 60;
assert.notEqual(getClipSyncStatus(a1_moved, STATE.activeTimelineCuts), null, "Clipe agora está fora de sincronia (+10)");

// Executa slip no áudio para sincronizar mantendo sua posição na timeline (60)
// Em 60: videoAnchor = 50 - 100 = -50.
// Precisamos que audioAnchor seja -50: 60 - inFrame = -50 => targetIn = 110.
interaction.resyncClip("a1", "slip");

const a1_slipped = STATE.activeTimelineCuts.find(c => c.id === "a1");
assert.equal(a1_slipped.timelineStartFrame, 60, "Posição na timeline foi mantida em 60");
assert.equal(a1_slipped.inFrame, 110, "inFrame deslizou para 110 quadros");
assert.equal(a1_slipped.outFrame, 210, "outFrame deslizou proporcionalmente mantendo duração de 100 quadros");
assert.equal(getClipSyncStatus(a1_slipped, STATE.activeTimelineCuts), null, "Sincronia restabelecida perfeitamente após slip");
console.log("  ✔ Teste 6 passou: resyncClip('slip') alinhou a mídia mantendo a posição na timeline.");

// ── TESTE 7: VINCULAR PAR ÁUDIO/VÍDEO (linkClips) ──
console.log("\n7. Validando linkClips(clipId1, clipId2)...");
STATE.activeTimelineCuts = [
    { id: "v_raw", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0, link_id: null },
    { id: "a_raw", track: "A1", inFrame: 0, outFrame: 100, timelineStartFrame: 5, link_id: null }
];

assert.equal(getClipSyncStatus(STATE.activeTimelineCuts[0], STATE.activeTimelineCuts), null, "Sem link_id não há status de sincronia");

interaction.linkClips("v_raw", "a_raw");

const v_linked = STATE.activeTimelineCuts.find(c => c.id === "v_raw");
const a_linked = STATE.activeTimelineCuts.find(c => c.id === "a_raw");

assert.ok(v_linked.link_id, "Vídeo agora possui link_id");
assert.equal(v_linked.link_id, a_linked.link_id, "Ambos compartilham o mesmo link_id");
const statusLinkedAudio = getClipSyncStatus(a_linked, STATE.activeTimelineCuts);
assert.equal(statusLinkedAudio.offset, 5, "Offset detectado imediatamente após vincular (+5)");
console.log("  ✔ Teste 7 passou: linkClips vincula e calcula a diferença de sincronia corretamente.");

// ── TESTE 8: DESFAZER / REFAZER (Undo / Redo) ──
console.log("\n8. Validando Undo/Redo no resync...");
interaction.resyncClip("a_raw", "move");
assert.equal(getClipSyncStatus(a_linked, STATE.activeTimelineCuts), null, "Após resync, está em sincronia perfeita");

TIMELINE_HISTORY.undo();
const a_after_undo = STATE.activeTimelineCuts.find(c => c.id === "a_raw");
assert.equal(a_after_undo.timelineStartFrame, 5, "Após Undo, volta a timelineStartFrame = 5");
assert.equal(getClipSyncStatus(a_after_undo, STATE.activeTimelineCuts).offset, 5, "Badge +5 volta a ser detectado");

TIMELINE_HISTORY.redo();
const a_after_redo = STATE.activeTimelineCuts.find(c => c.id === "a_raw");
assert.equal(a_after_redo.timelineStartFrame, 0, "Após Redo, volta a sincronia perfeita em 0");
assert.equal(getClipSyncStatus(a_after_redo, STATE.activeTimelineCuts), null, "Badge é removido novamente");
console.log("  ✔ Teste 8 passou: Undo/Redo funciona integralmente com o histórico.");

// ── TESTE 9: IMUNIDADE A REFERÊNCIAS CIRCULARES E SERIALIZAÇÃO LIMPA ──
console.log("\n9. Validando ausência total de referências circulares na serialização e no histórico...");
const { CapiauTimelineRenderer } = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineRenderer.js")).href);

// Cria um par A/V intencionalmente dessincronizado
STATE.activeTimelineCuts = [
    { id: "v_circ", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0, link_id: "link_circ" },
    { id: "a_circ", track: "A1", inFrame: 0, outFrame: 100, timelineStartFrame: 20, link_id: "link_circ" }
];

// Mock de contexto de desenho Canvas 2D
const mockCtx = {
    save: () => {},
    restore: () => {},
    measureText: (txt) => ({ width: txt.length * 6 }),
    fillText: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {}
};

// Instancia renderer com mock de canvas se necessário
const renderer = Object.create(CapiauTimelineRenderer.prototype);
renderer.syncBadgeRects = new Map();
renderer.rulerHeight = 30;

// Executa desenho do badge de sincronia para ambos os cortes
const vCut = STATE.activeTimelineCuts[0];
const aCut = STATE.activeTimelineCuts[1];
renderer.drawClipSyncBadge(mockCtx, vCut, 0, 30, 200, 50, "video");
renderer.drawClipSyncBadge(mockCtx, aCut, 40, 80, 200, 50, "audio");

// 1. O modelo de dados 'cut' NÃO deve conter a propriedade _syncBadgeRect
assert.strictEqual(vCut._syncBadgeRect, undefined, "vCut não deve armazenar _syncBadgeRect em cut");
assert.strictEqual(aCut._syncBadgeRect, undefined, "aCut não deve armazenar _syncBadgeRect em cut");

// 2. Os retângulos devem estar registrados no Map do renderer
const aBadge = renderer.getSyncBadgeRect("a_circ");
assert.ok(aBadge, "Badge de a_circ deve estar registrado no mapa do renderer");
assert.strictEqual(aBadge.status.offset, 20, "Offset do áudio registrado é +20");
assert.strictEqual(aBadge.status.partnerKind, "video", "Parceiro é vídeo");

// 3. JSON.stringify em STATE.activeTimelineCuts e TIMELINE_HISTORY._capture() não deve lançar erro
assert.doesNotThrow(() => {
    JSON.stringify(STATE.activeTimelineCuts);
}, "JSON.stringify(STATE.activeTimelineCuts) NUNCA deve falhar por referência circular");

assert.doesNotThrow(() => {
    TIMELINE_HISTORY.begin();
    TIMELINE_HISTORY.commit();
}, "TIMELINE_HISTORY.begin() e commit() NUNCA devem falhar por referência circular");

console.log("  ✔ Teste 9 passou: Imunidade a referências circulares 100% comprovada!");

console.log("\n=======================================================");
console.log("🎉 TODOS OS 9 TESTES DE SINCRONIA A/V PASSARAM COM SUCESSO!");
console.log("=======================================================");
