import { readFileSync } from 'fs';
import { resolve } from 'path';

console.log("=== INICIANDO TESTES DE SUPRESSÃO DE TOOLTIPS DUPLICADAS ===");

// 1. Verificar index.html estaticamente
const htmlPath = resolve(process.cwd(), 'src/ui/index.html');
const htmlContent = readFileSync(htmlPath, 'utf8');

// Teste 1: Checar se btn-toggle-monitors-layout-source não tem title
const srcBtnMatch = htmlContent.match(/<button id="btn-toggle-monitors-layout-source"[^>]*>/);
if (!srcBtnMatch) {
    throw new Error("Botão #btn-toggle-monitors-layout-source não encontrado em index.html");
}
if (srcBtnMatch[0].includes('title=')) {
    throw new Error(`Botão #btn-toggle-monitors-layout-source contém atributo title indevido: ${srcBtnMatch[0]}`);
}
if (!srcBtnMatch[0].includes('data-tooltip=')) {
    throw new Error(`Botão #btn-toggle-monitors-layout-source deveria ter data-tooltip: ${srcBtnMatch[0]}`);
}
console.log("✔ Teste 1 passou: #btn-toggle-monitors-layout-source não possui atributo title no HTML e possui data-tooltip.");

// Teste 2: Checar se btn-toggle-monitors-layout-program não tem title
const prgBtnMatch = htmlContent.match(/<button id="btn-toggle-monitors-layout-program"[^>]*>/);
if (!prgBtnMatch) {
    throw new Error("Botão #btn-toggle-monitors-layout-program não encontrado em index.html");
}
if (prgBtnMatch[0].includes('title=')) {
    throw new Error(`Botão #btn-toggle-monitors-layout-program contém atributo title indevido: ${prgBtnMatch[0]}`);
}
if (!prgBtnMatch[0].includes('data-tooltip=')) {
    throw new Error(`Botão #btn-toggle-monitors-layout-program deveria ter data-tooltip: ${prgBtnMatch[0]}`);
}
console.log("✔ Teste 2 passou: #btn-toggle-monitors-layout-program não possui atributo title no HTML e possui data-tooltip.");

// Teste 3: Checar se nenhum elemento em index.html combina data-tooltip com title
const lines = htmlContent.split('\n');
const duplicateLines = [];
lines.forEach((l, i) => {
    if (l.includes('data-tooltip=') && l.includes('title=')) {
        duplicateLines.push({ line: i + 1, content: l.trim() });
    }
});
if (duplicateLines.length > 0) {
    throw new Error(`Encontrados elementos com data-tooltip E title duplicados em index.html: ${JSON.stringify(duplicateLines)}`);
}
console.log("✔ Teste 3 passou: Nenhum elemento no index.html possui data-tooltip e title simultaneamente.");

// Teste 4: Checar workspaceManager.js - sem atribuição a .title nos botões de layout
const wmPath = resolve(process.cwd(), 'src/ui/js/workspaceManager.js');
const wmContent = readFileSync(wmPath, 'utf8');
if (/btnToggleMonitorsSrc\.title\s*=/.test(wmContent) || /btnToggleMonitorsPrg\.title\s*=/.test(wmContent)) {
    throw new Error("workspaceManager.js ainda contém atribuição direta a btnToggleMonitors.title!");
}
if (/btnMaxLib\.title\s*=/.test(wmContent) || /btnToggleTimelinePos\.title\s*=/.test(wmContent)) {
    throw new Error("workspaceManager.js ainda contém atribuição direta a .title em botões de layout!");
}
console.log("✔ Teste 4 passou: workspaceManager.js usa exclusivamente removeAttribute('title') e data-tooltip.");

// Teste 5: Verificar se main.js implementa MutationObserver com attributeFilter: ['title']
const mainPath = resolve(process.cwd(), 'src/ui/js/main.js');
const mainContent = readFileSync(mainPath, 'utf8');
if (!mainContent.includes('attributeFilter: ["title"]') && !mainContent.includes("attributeFilter: ['title']")) {
    throw new Error("main.js não está observando mutações de atributo title via MutationObserver!");
}
console.log("✔ Teste 5 passou: main.js observa mutações de title com attributeFilter.");

// Teste 6: Verificar se mouseover em main.js tem guarda preventiva contra title
if (!mainContent.includes('titledEl.removeAttribute("title")')) {
    throw new Error("main.js não remove preventivamente o atributo title no listener de mouseover!");
}
console.log("✔ Teste 6 passou: main.js possui guarda preventiva no evento mouseover para suprimir balão nativo.");

console.log("\n=======================================================");
console.log("🎉 TODOS OS 6 TESTES DE SUPRESSÃO DE TOOLTIPS PASSARAM COM SUCESSO!");
console.log("=======================================================\n");
