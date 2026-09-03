// Autoteste da Nova Arquitetura em 2 Zonas da Barra de Ferramentas NLE (Task 0)
// Execução: node tests/autoteste_toolbar_structure.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste da Nova Arquitetura de Barra de Ferramentas em 2 Zonas (Task 0)...");

// ── 1. Leitura e Análise do DOM de index.html ──
console.log("\n1. Analisando estrutura DOM do index.html...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");

// Regex para encontrar blocos
const timelinePanelMatch = htmlContent.match(/<section[^>]*id=["']timeline-panel["'][\s\S]*?<\/section>/);
assert.ok(timelinePanelMatch, "Elemento #timeline-panel deve existir no index.html");
const timelinePanelHTML = timelinePanelMatch[0];

// 1.1 Zona 1: Cabeçalho Superior da Timeline (.timeline-header-bar)
const headerBarMatch = timelinePanelHTML.match(/<div[^>]*class=["'][^"']*timeline-header-bar[^"']*["'][\s\S]*?<\/div>\s*<!-- Multi-track interactive area/);
assert.ok(headerBarMatch, "Zona 1 (.timeline-header-bar) deve existir dentro de #timeline-panel antes de .timeline-track-area");
const headerBarHTML = headerBarMatch[0];

const zona1ExpectedIDs = [
    // Sequência & Configurações
    "timeline-title-group",
    "timeline-name-display",
    "btn-rename-timeline",
    "timeline-name-input",
    "btn-seq-settings-timeline",
    "btn-timeline-view-options",
    // Arquivo
    "btn-save-timeline",
    "btn-load-timeline",
    "btn-import-timeline",
    "btn-export-timeline",
    "btn-export-video",
    // Histórico
    "btn-undo-timeline",
    "btn-redo-timeline",
    // Sliders compactos horizontais
    "track-height-slider",
    "timeline-zoom-slider",
    // IA
    "select-ai-persona",
    "btn-ai-suggest",
    // Layout & Janela
    "btn-cycle-columns",
    "btn-toggle-timeline-position",
    "btn-popout-timeline",
    "btn-timeline-help",
    "btn-toggle-timeline-header",
    "toggle-timeline"
];

for (const id of zona1ExpectedIDs) {
    const idRegex = new RegExp(`id=["']${id}["']`);
    assert.ok(idRegex.test(headerBarHTML), `Zona 1 (.timeline-header-bar) deve conter o elemento com id='${id}'`);
}
console.log(`  ✔ Zona 1 (.timeline-header-bar) validada com sucesso: todos os ${zona1ExpectedIDs.length} controles de gestão, arquivo, histórico e exibição presentes.`);

// 1.2 Zona 2: Tool Strip Vertical da Timeline (.timeline-actions-sidebar)
const toolStripMatch = timelinePanelHTML.match(/<div[^>]*id=["']timeline-actions-sidebar["'][\s\S]*?<\/div>\s*<!-- Linha finíssima/);
assert.ok(toolStripMatch, "Zona 2 (#timeline-actions-sidebar) deve existir dentro de #timeline-panel");
const toolStripHTML = toolStripMatch[0];

const zona2ExpectedIDs = [
    "btn-toggle-toolbar",
    // Grupo Seleção
    "btn-tool-select",
    "btn-tool-marquee",
    // Grupo Seleção de Faixas
    "btn-tool-track-forward",
    "btn-tool-track-backward",
    // Grupo Corte & Trims
    "btn-tool-blade",
    "btn-split-playhead",
    "btn-ripple-trim-head",
    "btn-ripple-trim-tail",
    // Grupo Deslocamento Dinâmico
    "btn-tool-slip",
    "btn-tool-slide",
    "btn-tool-rolling",
    "btn-tool-rate-stretch",
    // Grupo Criação
    "btn-tool-add-text",
    "btn-add-marker",
    // Grupo Navegação
    "btn-tool-hand",
    "btn-tool-zoom"
];

for (const id of zona2ExpectedIDs) {
    const idRegex = new RegExp(`id=["']${id}["']`);
    assert.ok(idRegex.test(toolStripHTML), `Zona 2 (#timeline-actions-sidebar) deve conter o botão com id='${id}'`);
}

// Validar que itens migrados para o header NÃO estão mais na Zona 2
const prohibitedInZona2 = [
    "btn-save-timeline",
    "btn-export-timeline",
    "btn-export-video",
    "btn-undo-timeline",
    "btn-redo-timeline",
    "track-height-slider",
    "select-ai-persona",
    "btn-ai-suggest",
    "btn-timeline-help"
];
for (const id of prohibitedInZona2) {
    const idRegex = new RegExp(`id=["']${id}["']`);
    assert.ok(!idRegex.test(toolStripHTML), `Zona 2 (#timeline-actions-sidebar) NÃO deve conter o controle desacoplado id='${id}'`);
}
console.log(`  ✔ Zona 2 (#timeline-actions-sidebar) validada com sucesso: contém estritamente os ${zona2ExpectedIDs.length} controles de cursor/edição NLE.`);

// 1.3 Linhas Restauradoras
assert.ok(/id=["']reopen-toolbar["']/.test(timelinePanelHTML), "Linha restauradora #reopen-toolbar deve existir");
assert.ok(/id=["']reopen-timeline-header["']/.test(timelinePanelHTML), "Linha restauradora #reopen-timeline-header deve existir");
console.log("  ✔ Linhas restauradoras #reopen-toolbar e #reopen-timeline-header presentes.");

// ── 2. Validação dos Estilos CSS (styles.css) ──
console.log("\n2. Analisando regras no styles.css...");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

assert.ok(cssContent.includes(".timeline-header-bar"), "styles.css deve conter a classe .timeline-header-bar");
assert.ok(cssContent.includes(".timeline-header-bar.collapsed"), "styles.css deve conter a classe .timeline-header-bar.collapsed");
assert.ok(cssContent.includes(".timeline-header-restore-line"), "styles.css deve conter a classe .timeline-header-restore-line");
assert.ok(cssContent.includes(".btn-header-flat"), "styles.css deve conter a classe .btn-header-flat");
assert.ok(cssContent.includes(".timeline-title-group"), "styles.css deve conter a classe .timeline-title-group");
assert.ok(cssContent.includes(".timeline-zoom-slider-compact"), "styles.css deve conter a classe .timeline-zoom-slider-compact");
assert.ok(cssContent.includes("#btn-tool-blade:hover"), "styles.css deve conter regra de hover para #btn-tool-blade");
assert.ok(cssContent.includes("#btn-tool-slip:hover"), "styles.css deve conter regra de hover para #btn-tool-slip");
console.log("  ✔ Estilos e regras de retração e hover das ferramentas NLE validados com sucesso.");

// ── 3. Validação Funcional em VM (timelineState.js & setTool) ──
console.log("\n3. Validando lógica de setTool e zoom em VM...");

const stateEvents = {};
const mockState = {
    activeTimelineCuts: [],
    emit(event, data) {
        if (stateEvents[event]) {
            stateEvents[event].forEach(fn => fn(data));
        }
    },
    on(event, fn) {
        if (!stateEvents[event]) stateEvents[event] = [];
        stateEvents[event].push(fn);
    }
};

const context = vm.createContext({
    console,
    Math,
    Date,
    JSON,
    Array,
    Set,
    Map,
    Number,
    String,
    Boolean,
    window: {},
    STATE: mockState,
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    document: {
        getElementById: () => null,
        addEventListener: () => {},
        removeEventListener: () => {}
    }
});

const codeTimelineState = readFileSync(path.join(raiz, "src", "ui", "js", "timelineState.js"), "utf8");
const cleanedTimelineCode = codeTimelineState
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/export const /g, "var ")
    .replace(/export class /g, "class ")
    .replace(/export function /g, "function ")
    .replace(/export default /g, "var defaultExport = ");

vm.runInContext(cleanedTimelineCode, context);
const TIMELINE_STATE = context.TIMELINE_STATE;

const nleTools = [
    "select",
    "marquee",
    "blade",
    "slip",
    "slide",
    "rolling",
    "rate-stretch",
    "hand",
    "zoom",
    "track-forward",
    "track-backward"
];

for (const tool of nleTools) {
    let emittedTool = null;
    stateEvents["timelineToolChanged"] = [(t) => { emittedTool = t; }];
    TIMELINE_STATE.setTool(tool);
    assert.equal(TIMELINE_STATE.activeTool, tool, `TIMELINE_STATE.activeTool deve ser '${tool}'`);
    assert.equal(emittedTool, tool, `Evento timelineToolChanged deve emitir '${tool}'`);
}
console.log(`  ✔ Todas as ${nleTools.length} ferramentas NLE são aceitas e emitem timelineToolChanged.`);

// Validação de setZoom
let emittedZoom = null;
stateEvents["timelineZoomChanged"] = [(z) => { emittedZoom = z; }];
TIMELINE_STATE.setZoom(1.25);
assert.equal(TIMELINE_STATE.zoom, 1.25, "TIMELINE_STATE.zoom deve ser atualizado para 1.25");
assert.equal(emittedZoom, 1.25, "Evento timelineZoomChanged deve emitir 1.25");
console.log("  ✔ setZoom e evento timelineZoomChanged validados com sucesso.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 0 (NOVA ARQUITETURA 2 ZONAS) 100% APROVADO!");
console.log("============================================================\n");
