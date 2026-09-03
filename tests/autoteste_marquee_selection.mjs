// Autoteste da Ferramenta de Seleção por Retângulo / Caixa (Marquee / Box Selection - Task 2)
// Execução: node tests/autoteste_marquee_selection.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
                    fillText() {}, scale() {}, clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
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
        return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
};

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste da Ferramenta de Seleção por Caixa / Retângulo (Marquee Tool — Task 2)...");

// ── 1. Análise do DOM (index.html) e CSS (styles.css) ──
console.log("\n1. Validando estrutura do index.html e estilos do styles.css...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// 1.1 Botão #btn-tool-marquee na Tool Strip
const marqueeBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-marquee["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(marqueeBtnMatch, "Botão #btn-tool-marquee deve existir no index.html");
const marqueeBtnHTML = marqueeBtnMatch[0];
assert.ok(marqueeBtnHTML.includes("data-tooltip"), "#btn-tool-marquee deve conter data-tooltip explicativo");
assert.ok(marqueeBtnHTML.includes("fa-vector-square"), "#btn-tool-marquee deve usar o ícone fa-vector-square");
assert.ok(/styles\.css\?v=(?:2[4-9]|[3-9]\d)/.test(htmlContent), "Cache-buster de styles.css deve estar em ?v>=24");
assert.ok(/main\.js\?v=(?:2[4-9]|[3-9]\d)/.test(htmlContent), "Cache-buster de main.js deve estar em ?v>=24");
console.log("  ✔ Elemento #btn-tool-marquee, ícone vetorial e cache-busters v>=24 validados.");

// 1.2 Regras CSS no styles.css
assert.ok(cssContent.includes("#btn-tool-marquee"), "styles.css deve conter regras para #btn-tool-marquee");
assert.ok(/#btn-tool-marquee:hover[\s\S]*?--color-cyan/.test(cssContent), "#btn-tool-marquee:hover deve usar a cor ciano");
console.log("  ✔ Regras CSS de hover e colorização ciano validadas.");

// ── 2. Validação do Catálogo e dos 5 Perfis Multi-Preset (Diretriz 5) ──
console.log("\n2. Validando Catálogo de Comandos, Perfis NLE e Cheat Sheet (Diretriz 5)...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

// 2.1 Presença no COMMANDS_CATALOG
const cmdMarquee = COMMANDS_CATALOG.find(c => c.id === "tools.marquee");
assert.ok(cmdMarquee, "Comando 'tools.marquee' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdMarquee.category, "tools", "tools.marquee deve pertencer à categoria 'tools'");
assert.ok(cmdMarquee.label && cmdMarquee.label.includes("Marquee"), "Rótulo de tools.marquee deve mencionar Marquee / Caixa");
assert.ok(cmdMarquee.description, "tools.marquee deve conter descrição informativa");
console.log("  ✔ Comando 'tools.marquee' devidamente registrado no catálogo central.");

// 2.2 Mapeamento nos 5 Presets da Indústria
const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];

for (const p of presetsEsperados) {
    const presetConfig = KEYMAP_PRESETS[p];
    assert.ok(presetConfig, `Preset '${p}' deve estar definido em KEYMAP_PRESETS`);
    
    const marqueeBinding = presetConfig["tools.marquee"];
    assert.ok(marqueeBinding && marqueeBinding.length > 0, `Preset '${p}' deve mapear 'tools.marquee'`);

    if (p === "capiau" || p === "premiere") {
        assert.ok(marqueeBinding.includes("Shift+KeyV"), `Preset '${p}' deve usar 'Shift+KeyV' para o Marquee`);
    } else if (p === "resolve" || p === "finalcut") {
        assert.ok(marqueeBinding.includes("Shift+KeyA"), `Preset '${p}' deve usar 'Shift+KeyA' para o Marquee`);
    } else if (p === "kdenlive") {
        assert.ok(marqueeBinding.includes("Shift+KeyS"), `Preset '${p}' deve usar 'Shift+KeyS' para o Marquee`);
    }
}
console.log("  ✔ Paridade dos 5 perfis NLE (CapIAu, Premiere, DaVinci, Final Cut e Kdenlive) validada com sucesso.");

// 2.3 Simulação da Cheat Sheet
for (const p of presetsEsperados) {
    KEYMAP_SERVICE.setPreset(p);
    const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML("tools.marquee");
    assert.ok(badgesHtml && badgesHtml.length > 0, `Cheat Sheet deve gerar badges HTML para 'tools.marquee' no preset '${p}'`);
    assert.ok(badgesHtml.includes("Shift"), `Badges da Cheat Sheet no preset '${p}' devem conter 'Shift'`);
    if (p === "capiau" || p === "premiere") {
        assert.ok(badgesHtml.includes("V"), `Badges da Cheat Sheet no preset '${p}' devem conter 'V'`);
    } else if (p === "resolve" || p === "finalcut") {
        assert.ok(badgesHtml.includes("A"), `Badges da Cheat Sheet no preset '${p}' devem conter 'A'`);
    } else if (p === "kdenlive") {
        assert.ok(badgesHtml.includes("S"), `Badges da Cheat Sheet no preset '${p}' devem conter 'S'`);
    }
}
console.log("  ✔ Renderização dinâmica de badges da Cheat Sheet validada para todos os perfis.");

// ── 3. Validação da Interseção Matemática (computeMarqueeIntersections) ──
console.log("\n3. Validando cálculo de interseção geométrica 2D (computeMarqueeIntersections)...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");
const { CapiauTimelineRenderer } = await import("../src/ui/js/timelineRenderer.js");

// Mock de Renderer com geometria de lanes conhecida
const mockRenderer = {
    canvas: globalThis.document.getElementById("timeline-canvas"),
    rulerHeight: 30,
    width: 1000,
    height: 400,
    getLane(trackId) {
        if (trackId === "V1") return { track: { id: "V1", kind: "video" }, top: 30, height: 50 };
        if (trackId === "V2") return { track: { id: "V2", kind: "video" }, top: 80, height: 50 };
        if (trackId === "A1") return { track: { id: "A1", kind: "audio" }, top: 130, height: 50 };
        return null;
    },
    requestRedraw() {}
};

const interaction = new CapiauTimelineInteraction(mockRenderer);

// Configuração do TIMELINE_STATE para teste
TIMELINE_STATE.zoom = 2.0; // 2 pixels por frame
TIMELINE_STATE.scrollLeftFrame = 0;
TIMELINE_STATE.selectedClipIds.clear();
TIMELINE_STATE.selectedClipId = null;
TIMELINE_STATE.selectedMarkerIds.clear();

// Inserir clipes nas pistas
// Clip 1: V1, frame 10 a 60 (x: 20 a 120, y: 30 a 80)
// Clip 2: V1, frame 80 a 140 (x: 160 a 280, y: 30 a 80)
// Clip 3: V2, frame 30 a 100 (x: 60 a 200, y: 80 a 130)
// Clip 4: A1, frame 10 a 90 (x: 20 a 180, y: 130 a 180)
STATE.activeTimelineCuts = [
    { id: "cut_1", track: "V1", timelineStartFrame: 10, inFrame: 0, outFrame: 50 },
    { id: "cut_2", track: "V1", timelineStartFrame: 80, inFrame: 0, outFrame: 60 },
    { id: "cut_3", track: "V2", timelineStartFrame: 30, inFrame: 0, outFrame: 70 },
    { id: "cut_4", track: "A1", timelineStartFrame: 10, inFrame: 0, outFrame: 80 }
];

TIMELINE_STATE.markers = [
    { id: "m_clip1", clipId: "cut_1", frame: 25, color: "#06b6d4" },
    { id: "m_ruler", clipId: null, frame: 50, color: "#f59e0b" }
];

// Teste 3.1: Caixa interceptando apenas Cut 1 na pista V1
const boxV1 = { x1: 10, y1: 30, x2: 70, y2: 75 };
const res1 = interaction.computeMarqueeIntersections(boxV1);
assert.deepEqual(res1.clipIds, ["cut_1"], "Caixa deve interceptar somente cut_1");
assert.deepEqual(res1.markerIds, ["m_clip1"], "Caixa deve interceptar m_clip1 anexado a cut_1 no frame 25 (x=50)");
console.log("  ✔ Interseção seletiva em pista única (V1) e marcador associado validada.");

// Teste 3.2: Caixa cobrindo V1 e V2 entre x=50 e x=170
// Deve capturar: cut_1 (termina em 120), cut_2 (inicia em 160), cut_3 (V2, de 60 a 200). A1 fora.
const boxV1_V2 = { x1: 50, y1: 30, x2: 170, y2: 125 };
const res2 = interaction.computeMarqueeIntersections(boxV1_V2);
assert.ok(res2.clipIds.includes("cut_1"), "cut_1 deve ser interceptado");
assert.ok(res2.clipIds.includes("cut_2"), "cut_2 deve ser interceptado");
assert.ok(res2.clipIds.includes("cut_3"), "cut_3 deve ser interceptado");
assert.ok(!res2.clipIds.includes("cut_4"), "cut_4 (pista A1) NÃO deve ser interceptado");
console.log("  ✔ Interseção multipista (V1 + V2) sem contaminação de outras pistas validada.");

// Teste 3.3: Inversão de direção do arraste (direita para esquerda, baixo para cima)
const boxInverted = { x1: 170, y1: 125, x2: 50, y2: 30 };
const resInverted = interaction.computeMarqueeIntersections(boxInverted);
assert.deepEqual(resInverted.clipIds.sort(), res2.clipIds.sort(), "Arraste invertido deve produzir o mesmo resultado");
console.log("  ✔ Arraste bidirecional (independente de direção) validado.");

// Teste 3.4: Caixa em espaço vazio (gap entre cut_1 e cut_2 em V1: x=125 a 155, y=30 a 75)
const boxGap = { x1: 125, y1: 30, x2: 155, y2: 75 };
const resGap = interaction.computeMarqueeIntersections(boxGap);
assert.equal(resGap.clipIds.length, 0, "Caixa no gap de V1 não deve interceptar nenhum clipe");
assert.equal(resGap.markerIds.length, 0, "Caixa no gap de V1 não deve interceptar marcadores");
console.log("  ✔ Espaço vazio (gap) não produz seleções espúrias.");

// ── 4. Validação dos Modificadores de Seleção (applyMarqueeSelection) ──
console.log("\n4. Validando modificadores de seleção (Substituir, Shift = Somar, Alt = Subtrair)...");

// 4.1 Substituição Normal ("replace")
TIMELINE_STATE.selectClips(["cut_4"]);
assert.equal(TIMELINE_STATE.selectedClipIds.has("cut_4"), true);

TIMELINE_STATE.applyMarqueeSelection(["cut_1", "cut_2"], ["m_clip1"], "replace");
assert.equal(TIMELINE_STATE.selectedClipIds.size, 2);
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_1"));
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_2"));
assert.ok(!TIMELINE_STATE.selectedClipIds.has("cut_4"), "cut_4 anterior deve ter sido substituído");
assert.ok(TIMELINE_STATE.selectedMarkerIds.has("m_clip1"));
console.log("  ✔ Modo 'replace' substitui seleção anterior corretamente.");

// 4.2 Adição cumulativa com Shift ("add")
const initialClipsBeforeAdd = new Set(TIMELINE_STATE.selectedClipIds);
const initialMarkersBeforeAdd = new Set(TIMELINE_STATE.selectedMarkerIds);

TIMELINE_STATE.applyMarqueeSelection(["cut_3"], [], "add", initialClipsBeforeAdd, initialMarkersBeforeAdd);
assert.equal(TIMELINE_STATE.selectedClipIds.size, 3);
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_1"));
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_2"));
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_3"));
console.log("  ✔ Modo 'add' (Shift) soma novos itens sem perder a seleção existente.");

// 4.3 Subtração com Alt ("subtract")
const initialClipsBeforeSub = new Set(TIMELINE_STATE.selectedClipIds);
const initialMarkersBeforeSub = new Set(TIMELINE_STATE.selectedMarkerIds);

TIMELINE_STATE.applyMarqueeSelection(["cut_2"], [], "subtract", initialClipsBeforeSub, initialMarkersBeforeSub);
assert.equal(TIMELINE_STATE.selectedClipIds.size, 2);
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_1"));
assert.ok(!TIMELINE_STATE.selectedClipIds.has("cut_2"), "cut_2 deve ter sido subtraído");
assert.ok(TIMELINE_STATE.selectedClipIds.has("cut_3"));
console.log("  ✔ Modo 'subtract' (Alt) remove itens selecionados com precisão cirúrgica.");

// ── 5. Validação de Ações em Bloco e Reversibilidade (Delete e Undo) ──
console.log("\n5. Validando exclusão em lote (Delete) e reversibilidade (Ctrl+Z)...");

// Clipes atualmente selecionados: cut_1 e cut_3
assert.equal(TIMELINE_STATE.selectedClipIds.size, 2);
assert.equal(STATE.activeTimelineCuts.length, 4);

// Exclusão em bloco dos clipes selecionados via liftDeleteSelectedClips
const delSuccess = TIMELINE_STATE.liftDeleteSelectedClips();
assert.ok(delSuccess, "liftDeleteSelectedClips deve ser bem-sucedido");
assert.equal(STATE.activeTimelineCuts.length, 2, "Apenas 2 clipes devem restar na timeline");
assert.ok(!STATE.activeTimelineCuts.some(c => c.id === "cut_1"), "cut_1 foi excluído");
assert.ok(!STATE.activeTimelineCuts.some(c => c.id === "cut_3"), "cut_3 foi excluído");
assert.equal(TIMELINE_STATE.selectedClipIds.size, 0, "Seleção deve ser limpa após exclusão");
console.log("  ✔ Exclusão em lote (Delete) de múltiplos clipes selecionados validada.");

// Desfazer (Ctrl+Z)
const undoSuccess = TIMELINE_HISTORY.undo();
assert.ok(undoSuccess, "Undo deve ser bem-sucedido");
assert.equal(STATE.activeTimelineCuts.length, 4, "Todos os 4 clipes devem retornar à timeline");
assert.ok(STATE.activeTimelineCuts.some(c => c.id === "cut_1"), "cut_1 restaurado");
assert.ok(STATE.activeTimelineCuts.some(c => c.id === "cut_3"), "cut_3 restaurado");
assert.equal(TIMELINE_STATE.selectedClipIds.size, 2, "Seleção anterior deve ser restaurada pelo Undo");
console.log("  ✔ Reversibilidade total (Ctrl+Z) restaurando clipes e seleção em bloco validada.");

// ── 6. Validação do Renderer e Caixa no Canvas ──
console.log("\n6. Validando métodos no CapiauTimelineRenderer...");
let clipCalled = false;
let rectDrawn = false;
let strokeDrawn = false;

const dummyCtx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() { clipCalled = true; },
    clip() {},
    fillRect() { rectDrawn = true; },
    strokeRect() { strokeDrawn = true; },
    setLineDash() {}
};

const rendererInstance = new CapiauTimelineRenderer();
rendererInstance.ctx = dummyCtx;
rendererInstance.width = 800;
rendererInstance.height = 300;
rendererInstance.marqueeBox = { x: 50, y: 40, width: 120, height: 80 };

rendererInstance.drawMarqueeBox();
assert.ok(clipCalled, "drawMarqueeBox deve aplicar clipping de proteção contra a régua");
assert.ok(rectDrawn, "drawMarqueeBox deve preencher o retângulo translúcido ciano");
assert.ok(strokeDrawn, "drawMarqueeBox deve desenhar a borda tracejada ciano");
console.log("  ✔ Renderização gráfica da caixa Marquee no canvas 100% validada.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 2 (MARQUEE / BOX SELECTION) 100% APROVADO!");
console.log("============================================================\n");
process.exit(0);
