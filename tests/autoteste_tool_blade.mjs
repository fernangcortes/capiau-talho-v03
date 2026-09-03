// Autoteste da Ferramenta Lâmina / Gilete (Blade Tool - Task 1)
// Execução: node tests/autoteste_tool_blade.mjs

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

console.log("▶ Iniciando autoteste da Ferramenta Lâmina / Gilete (Blade Tool — Task 1)...");

// ── 1. Análise do DOM (index.html) e CSS (styles.css) ──
console.log("\n1. Validando estrutura do index.html e estilos do styles.css...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// 1.1 Botão #btn-tool-blade na Tool Strip
const bladeBtnMatch = htmlContent.match(/<button[^>]*id=["']btn-tool-blade["'][^>]*>[\s\S]*?<\/button>/);
assert.ok(bladeBtnMatch, "Botão #btn-tool-blade deve existir no index.html");
const bladeBtnHTML = bladeBtnMatch[0];
assert.ok(bladeBtnHTML.includes("data-tooltip"), "#btn-tool-blade deve conter data-tooltip explicativo");
assert.ok(bladeBtnHTML.includes("fa-scissors"), "#btn-tool-blade deve usar o ícone fa-scissors");
assert.ok(/styles\.css\?v=23/.test(htmlContent), "Cache-buster de styles.css deve estar em ?v=23");
assert.ok(/main\.js\?v=23/.test(htmlContent), "Cache-buster de main.js deve estar em ?v=23");
assert.ok(/id=["']btn-ripple-trim-head["'][\s\S]*?<svg/.test(htmlContent), "#btn-ripple-trim-head deve conter SVG inline para garantir visibilidade");
assert.ok(/id=["']btn-ripple-trim-tail["'][\s\S]*?<svg/.test(htmlContent), "#btn-ripple-trim-tail deve conter SVG inline para garantir visibilidade");
console.log("  ✔ Elemento #btn-tool-blade, SVGs de trim e cache-busters v=23 validados.");

// 1.2 Regras CSS no styles.css
assert.ok(cssContent.includes("#btn-tool-blade"), "styles.css deve conter regras para #btn-tool-blade");
assert.ok(/#btn-tool-blade:hover[\s\S]*?#f59e0b/.test(cssContent), "#btn-tool-blade:hover deve usar a cor âmbar #f59e0b");
console.log("  ✔ Regras CSS de hover e colorização âmbar validadas.");

// ── 2. Validação do Catálogo e dos 5 Perfis Multi-Preset (Diretriz 5) ──
console.log("\n2. Validando Catálogo de Comandos, Perfis NLE e Cheat Sheet (Diretriz 5)...");
const { COMMANDS_CATALOG, KEYMAP_PRESETS, KEYMAP_SERVICE } = await import("../src/ui/js/keymapService.js");

// 2.1 Presença no COMMANDS_CATALOG
const cmdBlade = COMMANDS_CATALOG.find(c => c.id === "tools.blade");
assert.ok(cmdBlade, "Comando 'tools.blade' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdBlade.category, "tools", "tools.blade deve pertencer à categoria 'tools'");
assert.ok(cmdBlade.label && cmdBlade.label.includes("Lâmina"), "Rótulo de tools.blade deve mencionar Lâmina");
assert.ok(cmdBlade.description, "tools.blade deve conter descrição informativa");

const cmdBladeGlobal = COMMANDS_CATALOG.find(c => c.id === "tools.blade_global");
assert.ok(cmdBladeGlobal, "Comando 'tools.blade_global' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(cmdBladeGlobal.category, "tools", "tools.blade_global deve pertencer à categoria 'tools'");
assert.ok(cmdBladeGlobal.label && cmdBladeGlobal.label.includes("Global"), "Rótulo de tools.blade_global deve mencionar Global");

console.log("  ✔ Comandos 'tools.blade' e 'tools.blade_global' devidamente registrados no catálogo central.");

// 2.2 Mapeamento nos 5 Presets da Indústria
const presetsEsperados = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];

for (const p of presetsEsperados) {
    const presetConfig = KEYMAP_PRESETS[p];
    assert.ok(presetConfig, `Preset '${p}' deve estar definido em KEYMAP_PRESETS`);
    
    const bladeBinding = presetConfig["tools.blade"];
    assert.ok(bladeBinding && bladeBinding.length > 0, `Preset '${p}' deve mapear 'tools.blade'`);
    
    const bladeGlobalBinding = presetConfig["tools.blade_global"];
    assert.ok(bladeGlobalBinding && bladeGlobalBinding.length > 0, `Preset '${p}' deve mapear 'tools.blade_global'`);

    if (p === "capiau" || p === "premiere" || p === "kdenlive") {
        assert.ok(bladeBinding.includes("KeyC"), `Preset '${p}' deve usar tecla 'C' para a Lâmina`);
    } else if (p === "resolve" || p === "finalcut") {
        assert.ok(bladeBinding.includes("KeyB"), `Preset '${p}' deve usar tecla 'B' para a Lâmina`);
    }
}
console.log("  ✔ Paridade dos 5 perfis NLE (CapIAu, Premiere, DaVinci, Final Cut e Kdenlive) validada com sucesso.");

// 2.3 Simulação da Cheat Sheet
for (const p of presetsEsperados) {
    KEYMAP_SERVICE.setPreset(p);
    const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML("tools.blade");
    assert.ok(badgesHtml && badgesHtml.length > 0, `Cheat Sheet deve gerar badges HTML para 'tools.blade' no preset '${p}'`);
    if (p === "capiau" || p === "premiere" || p === "kdenlive") {
        assert.ok(badgesHtml.includes("C"), `Badges da Cheat Sheet no preset '${p}' devem conter 'C'`);
    } else {
        assert.ok(badgesHtml.includes("B"), `Badges da Cheat Sheet no preset '${p}' devem conter 'B'`);
    }
}
KEYMAP_SERVICE.setPreset("capiau"); // Restaura padrão
console.log("  ✔ Renderização dinâmica de badges da Cheat Sheet validada para todos os perfis.");

// ── 3. Teste de Lógica de Dados: Divisão Simples, Snapping, Links e Travas de Pista ──
console.log("\n3. Validando lógica de splitClipAtFrame, pares vinculados e travas de pistas...");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");

// Configura timeline de teste
TIMELINE_STATE.fps = 24;
TIMELINE_STATE.setTracks([
    { id: "AI", name: "IA", kind: "ai", volume: 1.0, muted: false, locked: true },
    { id: "V2", name: "B-Roll", kind: "video", volume: 1.0, muted: false, locked: false },
    { id: "V1", name: "Falas", kind: "video", volume: 1.0, muted: false, locked: false },
    { id: "A1", name: "Áudio Falas", kind: "audio", volume: 1.0, muted: false, locked: false }
]);

TIMELINE_HISTORY.clear();

// Cenário A: Clipe simples de 0 a 100 frames
const clipeSimples = {
    id: "cut_video_01",
    track: "V1",
    media_id: "media_video_01",
    inFrame: 100,
    outFrame: 200,
    timelineStartFrame: 0,
    timeline_start: 0,
    in: 100 / 24,
    out: 200 / 24
};

STATE.activeTimelineCuts = [clipeSimples];

// 3.1 Corte fora dos limites deve falhar
const corteInvalidoAntes = TIMELINE_STATE.splitClipAtFrame("cut_video_01", 0);
assert.equal(corteInvalidoAntes, null, "Corte antes ou no início exato deve retornar null");
const corteInvalidoDepois = TIMELINE_STATE.splitClipAtFrame("cut_video_01", 100);
assert.equal(corteInvalidoDepois, null, "Corte após ou no fim exato deve retornar null");
assert.equal(STATE.activeTimelineCuts.length, 1, "Array de cortes não deve mudar em corte inválido");

// 3.2 Corte no frame 40
const splitRes = TIMELINE_STATE.splitClipAtFrame("cut_video_01", 40);
assert.ok(splitRes, "splitClipAtFrame deve retornar resultado com sucesso");
assert.equal(STATE.activeTimelineCuts.length, 2, "Corte deve gerar exatamente 2 clipes");

const esquerda = STATE.activeTimelineCuts.find(c => c.id === "cut_video_01");
const direita = splitRes.rightClip;

assert.equal(esquerda.timelineStartFrame, 0, "Clipe esquerdo inicia no frame 0");
assert.equal(esquerda.inFrame, 100, "Clipe esquerdo mantém inFrame original");
assert.equal(esquerda.outFrame, 140, "Clipe esquerdo termina no inFrame + offset (100 + 40 = 140)");
assert.equal(esquerda.out, 140 / 24, "Clipe esquerdo out em segundos calculado");

assert.equal(direita.timelineStartFrame, 40, "Clipe direito inicia no frame de corte 40");
assert.equal(direita.inFrame, 140, "Clipe direito inicia em 140 na mídia bruta");
assert.equal(direita.outFrame, 200, "Clipe direito termina em 200 na mídia bruta");
console.log("  ✔ Divisão de clipe simples no frame 40 validada matematicamente.");

// 3.3 Reversibilidade via Undo
assert.ok(TIMELINE_HISTORY.undo(), "TIMELINE_HISTORY.undo() deve retornar true");
assert.equal(STATE.activeTimelineCuts.length, 1, "Undo deve restaurar o clipe único anterior");
assert.equal(STATE.activeTimelineCuts[0].outFrame, 200, "Undo restaura outFrame original");
assert.ok(TIMELINE_HISTORY.redo(), "TIMELINE_HISTORY.redo() deve retornar true");
assert.equal(STATE.activeTimelineCuts.length, 2, "Redo reaplica a divisão em 2 clipes");
console.log("  ✔ Undo / Redo para divisão de clipe simples validado.");

// ── 4. Teste de Clipes Vinculados (Áudio + Vídeo / J/L-Cut) ──
console.log("\n4. Validando fatiamento de pares vinculados (áudio/vídeo)...");
TIMELINE_HISTORY.clear();

const linkOriginal = "link_av_par_100";
const videoVinculado = {
    id: "cut_v_par",
    track: "V1",
    link_id: linkOriginal,
    inFrame: 0,
    outFrame: 120,
    timelineStartFrame: 10,
    in: 0,
    out: 120 / 24
};
const audioVinculado = {
    id: "cut_a_par",
    track: "A1",
    link_id: linkOriginal,
    inFrame: 0,
    outFrame: 120,
    timelineStartFrame: 10,
    in: 0,
    out: 120 / 24
};

STATE.activeTimelineCuts = [videoVinculado, audioVinculado];

// Fatiar no frame 50 (offset = 40 frames)
const resVinculado = TIMELINE_STATE.splitClipAtFrame("cut_v_par", 50, true);
assert.ok(resVinculado, "Divisão de par vinculado deve suceder");
assert.ok(resVinculado.partnerRightClip, "Parceiro de áudio vinculado deve ter sido fatiado junto");
assert.equal(STATE.activeTimelineCuts.length, 4, "Devem existir 4 clipes no total (2 de vídeo, 2 de áudio)");

// Metades esquerdas mantêm o link original
const vEsq = STATE.activeTimelineCuts.find(c => c.id === "cut_v_par");
const aEsq = STATE.activeTimelineCuts.find(c => c.id === "cut_a_par");
assert.equal(vEsq.link_id, linkOriginal, "Vídeo esquerdo mantém link_id original");
assert.equal(aEsq.link_id, linkOriginal, "Áudio esquerdo mantém link_id original");

// Metades direitas recebem o mesmo novo link compartilhado
const vDir = resVinculado.rightClip;
const aDir = resVinculado.partnerRightClip;
assert.ok(vDir.link_id && vDir.link_id !== linkOriginal, "Vídeo direito ganha novo link_id");
assert.equal(vDir.link_id, aDir.link_id, "Vídeo direito e áudio direito compartilham o mesmo novo link_id");

// Undo restaura os 2 originais com link_id original
TIMELINE_HISTORY.undo();
assert.equal(STATE.activeTimelineCuts.length, 2, "Undo restaura os 2 clipes originais");
assert.equal(STATE.activeTimelineCuts[0].link_id, linkOriginal);
assert.equal(STATE.activeTimelineCuts[1].link_id, linkOriginal);
console.log("  ✔ Fatiamento de pares vinculados com propagação de novo link_id validado.");

// 4.2 Teste de J/L-Cut (Corte Individual sem desunir antes, splitLinked = false)
const resJLCut = TIMELINE_STATE.splitClipAtFrame("cut_v_par", 50, false);
assert.ok(resJLCut, "Corte de J/L-Cut deve suceder");
assert.equal(resJLCut.partnerRightClip, null, "Parceiro de áudio NÃO deve ser fatiado no J/L-Cut");
assert.equal(STATE.activeTimelineCuts.length, 3, "Devem existir 3 clipes: V esquerdo, V direito e A inteiro");

const vEsqJL = STATE.activeTimelineCuts.find(c => c.id === "cut_v_par");
const aInteiro = STATE.activeTimelineCuts.find(c => c.id === "cut_a_par");
const vDirJL = resJLCut.rightClip;

assert.equal(vEsqJL.link_id, linkOriginal, "Vídeo esquerdo permanece vinculado ao áudio original");
assert.equal(aInteiro.link_id, linkOriginal, "Áudio original permanece com seu link_id");
assert.equal(vDirJL.link_id, null, "Vídeo direito fatiado fica desunido (link_id: null) para J/L-Cut!");

TIMELINE_HISTORY.undo();
assert.equal(STATE.activeTimelineCuts.length, 2, "Undo desfaz o J/L-Cut");
console.log("  ✔ Corte individual de J/L-Cut (esquerda unida, direita desunida) validado com sucesso.");

// ── 5. Teste de Proteção de Pistas Travadas (Track Lock) ──
console.log("\n5. Validando proteção contra corte em pistas travadas...");
const faixaV1 = TIMELINE_STATE.getTrack("V1");
faixaV1.locked = true;

const resCorteTravado = TIMELINE_STATE.splitClipAtFrame("cut_v_par", 50);
assert.equal(resCorteTravado, null, "splitClipAtFrame em pista travada deve retornar null");
assert.equal(STATE.activeTimelineCuts.length, 2, "Nenhum corte deve ser gerado em pista travada");

faixaV1.locked = false; // Destrava para os próximos testes
console.log("  ✔ Pistas travadas estão 100% protegidas contra cortes acidentais.");

// ── 6. Teste de Lâmina Global Multitrilha (splitAllTracksAtFrame) ──
console.log("\n6. Validando Lâmina Global Multitrilha (splitAllTracksAtFrame)...");
TIMELINE_HISTORY.clear();

const clipeV1 = { id: "c_v1", track: "V1", inFrame: 0, outFrame: 100, timelineStartFrame: 0 };
const clipeV2 = { id: "c_v2", track: "V2", inFrame: 0, outFrame: 100, timelineStartFrame: 0 };
const clipeA1 = { id: "c_a1", track: "A1", inFrame: 0, outFrame: 100, timelineStartFrame: 0 };
const clipeAI = { id: "c_ai", track: "AI", inFrame: 0, outFrame: 100, timelineStartFrame: 0 };

STATE.activeTimelineCuts = [clipeV1, clipeV2, clipeA1, clipeAI];

// Corta globalmente no frame 60
const cortesGlobais = TIMELINE_STATE.splitAllTracksAtFrame(60);
assert.equal(cortesGlobais.length, 3, "Deve fatiar exatamente as 3 faixas normais (V1, V2, A1) e ignorar a pista AI");
assert.equal(STATE.activeTimelineCuts.length, 7, "Total de cortes na timeline deve ser 4 originais + 3 novos");

// Faixa AI permaneceu intacta
const aiCuts = STATE.activeTimelineCuts.filter(c => c.track === "AI");
assert.equal(aiCuts.length, 1, "Pista de IA não deve ser fatiada pela Lâmina Global");

// Undo restaura os 4 clipes originais
TIMELINE_HISTORY.undo();
assert.equal(STATE.activeTimelineCuts.length, 4, "Undo desfaz o corte global multitrilha instantaneamente");
console.log("  ✔ Lâmina Global Multitrilha (splitAllTracksAtFrame) validada com sucesso.");

// ── 7. Validação da Linha Guia e Cursores em timelineInteraction.js ──
console.log("\n7. Validando constantes de cursor e métodos em timelineInteraction.js...");
const interactionCode = readFileSync(path.join(raiz, "src", "ui", "js", "timelineInteraction.js"), "utf8");

assert.ok(interactionCode.includes("CURSOR_BLADE_SINGLE"), "CURSOR_BLADE_SINGLE deve estar definido");
assert.ok(interactionCode.includes("CURSOR_BLADE_ALL"), "CURSOR_BLADE_ALL deve estar definido");
assert.ok(interactionCode.includes("getBladeCursor"), "Método getBladeCursor deve existir em CapiauTimelineInteraction");
assert.ok(interactionCode.includes("bladeGuide"), "Suporte a bladeGuide deve estar presente na interação");
assert.ok(interactionCode.includes("splitAllTracksAtFrame"), "splitAllTracksAtFrame deve ser acionado na interação");
assert.ok(interactionCode.includes("splitClipAtFrame"), "splitClipAtFrame deve ser acionado na interação");
console.log("  ✔ Interações, cursores SVG e guias âmbar integrados corretamente.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 1 (LÂMINA / GİLETE) 100% APROVADO!");
console.log("============================================================\n");
