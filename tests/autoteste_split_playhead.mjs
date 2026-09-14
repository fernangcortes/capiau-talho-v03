// Autoteste do Split no Playhead com teclas E e Z sem necessidade de seleção prévia
// Execução: node tests/autoteste_split_playhead.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
};

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste de Split no Playhead (E / Z) sem seleção prévia...");

// ── 1. Análise do DOM (index.html) ──
console.log("\n1. Validando estrutura de botões e tooltips no index.html...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");

// 1.1 Botão #btn-split-playhead deve conter atalho (E / Z)
const splitBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-split-playhead["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(splitBtnMatch, "Botão #btn-split-playhead deve existir no index.html");
assert.ok(splitBtnMatch[0].includes("Dividir Clipe no Playhead (E / Z)"), "Tooltip do split deve exibir (E / Z)");

// 1.2 Botão #btn-tool-zoom NÃO deve colidir com (Z)
const zoomBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-zoom["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(zoomBtnMatch, "Botão #btn-tool-zoom deve existir no index.html");
assert.ok(!zoomBtnMatch[0].includes("(Z)"), "Tooltip da lupa não deve conter atalho (Z) conflitante");

// 1.3 Botão #btn-append-timeline deve exibir Shift+E
const appendBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-append-timeline["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(appendBtnMatch, "Botão #btn-append-timeline deve existir no index.html");
assert.ok(appendBtnMatch[0].includes("Shift+E"), "Botão append no source player deve indicar Shift+E");
console.log("  ✔ Tooltips atualizados e sem colisão no index.html.");

// ── 2. Validação do KeymapService e Mapeamento CapIAu ──
console.log("\n2. Validando KeymapService, COMMANDS_CATALOG e atalhos CapIAu...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

KEYMAP_SERVICE.setPreset("capiau");

// 2.1 Catálogo
const cmdSplit = COMMANDS_CATALOG.find(c => c.id === "edit.split");
assert.ok(cmdSplit, "Comando edit.split deve existir no catálogo");
assert.ok(cmdSplit.description.includes("sob a agulha"), "Descrição de edit.split deve citar clipe sob a agulha");

// 2.2 Preset CapIAu possui E, Z e modificadores Alt
const capiauSplit = KEYMAP_PRESETS.capiau["edit.split"];
assert.ok(capiauSplit.includes("KeyE"), "edit.split deve incluir KeyE no preset CapIAu");
assert.ok(capiauSplit.includes("KeyZ"), "edit.split deve incluir KeyZ no preset CapIAu");
assert.ok(capiauSplit.includes("Alt+KeyE"), "edit.split deve incluir Alt+KeyE no preset CapIAu");
assert.ok(capiauSplit.includes("Alt+KeyZ"), "edit.split deve incluir Alt+KeyZ no preset CapIAu");

// 2.3 KEYMAP_SERVICE.matches
assert.ok(KEYMAP_SERVICE.matches({ code: "KeyE", key: "e" }, "edit.split"), "Deve reconhecer tecla 'E' para split");
assert.ok(KEYMAP_SERVICE.matches({ code: "KeyZ", key: "z" }, "edit.split"), "Deve reconhecer tecla 'Z' para split");
assert.ok(KEYMAP_SERVICE.matches({ code: "KeyE", key: "e", altKey: true }, "edit.split"), "Deve reconhecer 'Alt+E' para split J/L-Cut");
assert.ok(KEYMAP_SERVICE.matches({ code: "KeyZ", key: "z", altKey: true }, "edit.split"), "Deve reconhecer 'Alt+Z' para split J/L-Cut");

// 2.4 Prevenção de colisão da Lupa com Z no CapIAu
assert.equal(KEYMAP_SERVICE.matches({ code: "KeyZ", key: "z" }, "tools.zoom"), false, "tools.zoom NÃO deve capturar Z no preset CapIAu");
console.log("  ✔ KeymapService: E e Z mapeados com sucesso e sem colisão.");

// ── 3. Validação do splitAtPlayhead no TIMELINE_STATE ──
console.log("\n3. Validando TIMELINE_STATE.splitAtPlayhead() em cenários reais...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

TIMELINE_STATE.fps = 24;
TIMELINE_STATE.setTracks([
    { id: "V2", name: "B-Roll", kind: "video", locked: false },
    { id: "V1", name: "Principal", kind: "video", locked: false },
    { id: "A1", name: "Áudio", kind: "audio", locked: false }
]);
TIMELINE_HISTORY.clear();

// Cenário A: Agulha em movimento ("carregando a agulha"), NENHUM clipe selecionado
console.log("  - Cenário A: Fatiar clipe sob a agulha sem seleção prévia...");
TIMELINE_STATE.selectedClipId = null;
TIMELINE_STATE.selectedClipIds = new Set();
TIMELINE_STATE.selectedTrack = "V1";

const linkPar = "link_av_test_555";
const clipeV1 = {
    id: "cut_v_01",
    track: "V1",
    link_id: linkPar,
    timelineStartFrame: 0,
    inFrame: 100,
    outFrame: 300,
    in: 100 / 24,
    out: 300 / 24
};
const clipeA1 = {
    id: "cut_a_01",
    track: "A1",
    link_id: linkPar,
    timelineStartFrame: 0,
    inFrame: 100,
    outFrame: 300,
    in: 100 / 24,
    out: 300 / 24
};

STATE.activeTimelineCuts = [clipeV1, clipeA1];
TIMELINE_STATE.playheadFrame = 120; // Ponto de corte

const resSplit = TIMELINE_STATE.splitAtPlayhead(true);
assert.ok(resSplit, "splitAtPlayhead deve retornar sucesso mesmo sem clipe selecionado");
assert.equal(STATE.activeTimelineCuts.length, 4, "Deve ter dividido tanto o vídeo quanto o áudio vinculado (4 clipes)");

// Verifica clipes esquerdos
const vLeft = STATE.activeTimelineCuts.find(c => c.id === "cut_v_01");
const aLeft = STATE.activeTimelineCuts.find(c => c.id === "cut_a_01");
assert.equal(vLeft.outFrame, 220, "Clipe esquerdo de vídeo termina em 220 (100 + 120)");
assert.equal(aLeft.outFrame, 220, "Clipe esquerdo de áudio termina em 220");

// Verifica clipes direitos
const vRight = resSplit.rightClip;
const aRight = resSplit.partnerRightClip;
assert.ok(vRight, "Deve existir o clipe direito de vídeo");
assert.ok(aRight, "Deve existir o clipe direito de áudio");
assert.equal(vRight.timelineStartFrame, 120, "Clipe direito inicia na agulha (120)");
assert.equal(aRight.timelineStartFrame, 120, "Clipe direito de áudio inicia na agulha (120)");
assert.equal(vRight.link_id, aRight.link_id, "Clipes direitos devem compartilhar novo link_id");

// Verifica se selecionou o clipe direito resultante para edição contínua
assert.equal(TIMELINE_STATE.selectedClipId, vRight.id, "splitAtPlayhead deve selecionar a parte direita resultante");
console.log("    ✔ Clipe fatiado com sucesso sob a agulha sem seleção prévia e par A/V mantido sincronizado.");

// Cenário B: Avançar a agulha e fatiar novamente sequencialmente
console.log("  - Cenário B: Fatiar novamente sequencialmente (segundo corte mais à frente)...");
TIMELINE_STATE.playheadFrame = 180;
const resSplit2 = TIMELINE_STATE.splitAtPlayhead(true);
assert.ok(resSplit2, "Segundo split deve funcionar sem necessidade de desmarcar ou clicar no clipe");
assert.equal(STATE.activeTimelineCuts.length, 6, "Total de 6 clipes após o segundo split");
console.log("    ✔ Fatiamento sequencial contínuo validado.");

// Cenário C: Prioridade da pista ativa selecionada (selectedTrack)
console.log("  - Cenário C: Prioridade da pista selecionada quando há múltiplos clipes sobrepostos...");
const clipV2 = {
    id: "cut_v2_broll",
    track: "V2",
    timelineStartFrame: 0,
    inFrame: 0,
    outFrame: 200,
    in: 0,
    out: 200 / 24
};
STATE.activeTimelineCuts.push(clipV2);
TIMELINE_STATE.selectedClipId = null;
TIMELINE_STATE.selectedClipIds.clear();
TIMELINE_STATE.selectedTrack = "V2";
TIMELINE_STATE.playheadFrame = 50;

const resSplitTrack = TIMELINE_STATE.splitAtPlayhead(true);
assert.ok(resSplitTrack, "Deve fatiar com sucesso");
assert.equal(resSplitTrack.leftClip.id, "cut_v2_broll", "Deve ter fatiado o clipe da pista ativa V2");
console.log("    ✔ Pista ativa 'selectedTrack' respeitada como alvo prioritário.");

// Cenário D: Clipe selecionado distante que NÃO cruza a agulha não bloqueia o corte
console.log("  - Cenário D: Clipe selecionado longe da agulha não impede o corte sob a agulha...");
TIMELINE_STATE.selectedClipId = "cut_v2_broll"; // Selecionado no início
TIMELINE_STATE.playheadFrame = 800; // Agulha longe

const clipDistante = {
    id: "cut_distante",
    track: "V1",
    timelineStartFrame: 700,
    inFrame: 0,
    outFrame: 300,
    in: 0,
    out: 300 / 24
};
STATE.activeTimelineCuts.push(clipDistante);

const resSplitLonge = TIMELINE_STATE.splitAtPlayhead(true);
assert.ok(resSplitLonge, "Deve fatiar o clipe sob a agulha em vez de falhar por clipe distante selecionado");
assert.equal(resSplitLonge.leftClip.id, "cut_distante", "Clipe distante sob a agulha foi fatiado com sucesso");
console.log("    ✔ Clipes selecionados fora da agulha são ignorados em favor do clipe sob a agulha.");

// Cenário E: J/L-Cut individual com Alt (splitLinked = false)
console.log("  - Cenário E: Corte individual de J/L-Cut com splitLinked = false...");
const linkJL = "link_jl_cut_99";
const clipV_JL = {
    id: "cut_v_jl",
    track: "V1",
    link_id: linkJL,
    timelineStartFrame: 1000,
    inFrame: 0,
    outFrame: 200,
    in: 0,
    out: 200 / 24
};
const clipA_JL = {
    id: "cut_a_jl",
    track: "A1",
    link_id: linkJL,
    timelineStartFrame: 1000,
    inFrame: 0,
    outFrame: 200,
    in: 0,
    out: 200 / 24
};
STATE.activeTimelineCuts.push(clipV_JL, clipA_JL);
TIMELINE_STATE.selectedClipId = "cut_v_jl";
TIMELINE_STATE.playheadFrame = 1100;

const resJL = TIMELINE_STATE.splitAtPlayhead(false); // splitLinked = false
assert.ok(resJL, "Deve fatiar com sucesso");
assert.equal(resJL.partnerRightClip, null, "Não deve fatiar o áudio parceiro quando splitLinked = false");
const audioNaoCortado = STATE.activeTimelineCuts.find(c => c.id === "cut_a_jl");
assert.equal(audioNaoCortado.outFrame, 200, "Áudio deve permanecer intacto com duração original");
console.log("    ✔ Corte individual J/L-Cut validado com splitLinked = false.");

// Cenário F: Agulha em espaço vazio (gap)
console.log("  - Cenário F: Agulha em espaço vazio...");
TIMELINE_STATE.selectedClipId = null;
TIMELINE_STATE.selectedClipIds.clear();
TIMELINE_STATE.playheadFrame = 99999;
const resGap = TIMELINE_STATE.splitAtPlayhead(true);
assert.equal(resGap, null, "Deve retornar null de forma limpa quando agulha está em gap vazio");
console.log("    ✔ Retorno limpo e seguro em espaço vazio validado.");

console.log("\n============================================================");
console.log("🎉 TODOS OS TESTES DE ATALHO E SPLIT (E / Z) PASSARAM 100%!");
console.log("============================================================\n");
