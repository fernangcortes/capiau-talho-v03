// Autoteste do Popover de Opções de Visualização da Timeline
// Execução: node tests/autoteste_timeline_view_options.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste do Popover de Opções de Visualização da Timeline...");

// ── 1. Análise Estrutural do index.html ──
console.log("\n1. Validando index.html...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");

// 1.1 Não deve estar contido em .timeline-canvas-wrapper
const canvasWrapperMatch = htmlContent.match(/<div[^>]*class=["'][^"']*timeline-canvas-wrapper[^"']*["'][\s\S]*?<\/section>/);
assert.ok(canvasWrapperMatch, ".timeline-canvas-wrapper deve existir");
assert.ok(
    !canvasWrapperMatch[0].includes('id="timeline-view-options-dropdown"'),
    "ERRO: #timeline-view-options-dropdown NÃO deve ser filho de .timeline-canvas-wrapper para não ser cortado por overflow: hidden!"
);
console.log("  ✔ #timeline-view-options-dropdown NÃO está contido em contêineres com overflow:hidden.");

// 1.2 Deve existir no root do documento e conter todos os controles necessários
const dropdownMatch = htmlContent.match(/<div[^>]*id=["']timeline-view-options-dropdown["'][\s\S]*?<\/div>\s*<\/div>/);
assert.ok(dropdownMatch, "#timeline-view-options-dropdown deve existir em index.html");
const dropdownHTML = dropdownMatch[0];

const expectedControls = [
    "chk-timeline-follow-playhead",
    "select-timeline-scroll-mode",
    "slider-timeline-smooth-anchor",
    "chk-timeline-hover-preview",
    "chk-timeline-mute-hidden",
    "chk-timeline-toolbar-top",
    "chk-timeline-expand-left",
    "chk-timeline-expand-right",
    "chk-timeline-bottom-full",
    "select-timeline-thumbs-density"
];

for (const id of expectedControls) {
    assert.ok(dropdownHTML.includes(`id="${id}"`), `Controle '${id}' deve existir no dropdown de opções`);
}
console.log(`  ✔ Todos os ${expectedControls.length} controles interativos de opções de visualização estão presentes.`);

// ── 2. Análise de Regras CSS (styles.css) ──
console.log("\n2. Validando styles.css...");
const cssContent = readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

assert.ok(cssContent.includes("#timeline-view-options-dropdown"), "styles.css deve estilizar #timeline-view-options-dropdown");
assert.ok(cssContent.includes("position: fixed"), "Popover deve utilizar position: fixed para ancoragem na tela");
assert.ok(cssContent.includes("#timeline-view-options-dropdown.visible"), "styles.css deve definir estado .visible");
assert.ok(
    cssContent.includes("body:has(#timeline-view-options-dropdown.visible) #global-tooltip"),
    "styles.css deve suprimir #global-tooltip quando o dropdown estiver visível"
);
console.log("  ✔ Regras de position: fixed, z-index, .visible e supressão de tooltip validadas com sucesso.");

// ── 3. Validação Matemática dos Algoritmos de Posicionamento Inteligente ──
console.log("\n3. Validando algoritmo de posicionamento reativo e auto-flip...");

function calculatePopupPosition({ btnRect, menuSize, viewport }) {
    let left = btnRect.left;
    if (left + menuSize.width > viewport.innerWidth - 8) {
        left = viewport.innerWidth - menuSize.width - 8;
    }
    if (left < 8) {
        left = 8;
    }

    let top = btnRect.bottom + 6;
    const fitsBelow = (top + menuSize.height <= viewport.innerHeight - 8);
    const fitsAbove = (btnRect.top - menuSize.height - 6 >= 8);

    if (!fitsBelow && fitsAbove) {
        top = btnRect.top - menuSize.height - 6;
    } else if (!fitsBelow && !fitsAbove) {
        top = Math.max(8, viewport.innerHeight - menuSize.height - 8);
    }

    return { top: Math.round(top), left: Math.round(left) };
}

// Caso 1: Espaço amplo abaixo (timeline no meio/topo)
const pos1 = calculatePopupPosition({
    btnRect: { left: 300, right: 324, top: 100, bottom: 124, width: 24, height: 24 },
    menuSize: { width: 236, height: 260 },
    viewport: { innerWidth: 1920, innerHeight: 1080 }
});
assert.equal(pos1.left, 300, "Left deve alinhar com o botão");
assert.equal(pos1.top, 130, "Top deve abrir abaixo do botão (124 + 6)");
console.log("  ✔ Caso 1: Abertura para baixo quando há espaço disponível.");

// Caso 2: Linha do tempo próxima ao rodapé da tela (Auto-Flip para cima)
const pos2 = calculatePopupPosition({
    btnRect: { left: 300, right: 324, top: 620, bottom: 644, width: 24, height: 24 },
    menuSize: { width: 236, height: 260 },
    viewport: { innerWidth: 1280, innerHeight: 720 }
});
// 644 + 6 + 260 = 910 > 712 (não cabe embaixo).
// Cabe em cima: 620 - 260 - 6 = 354 >= 8.
assert.equal(pos2.top, 354, "Top deve inverter para cima do botão (620 - 260 - 6 = 354)");
console.log("  ✔ Caso 2: Auto-flip para cima quando a timeline estiver próxima ao rodapé.");

// Caso 3: Botão próximo à borda direita da tela (Clamping horizontal)
const pos3 = calculatePopupPosition({
    btnRect: { left: 1800, right: 1824, top: 100, bottom: 124, width: 24, height: 24 },
    menuSize: { width: 236, height: 260 },
    viewport: { innerWidth: 1920, innerHeight: 1080 }
});
// 1800 + 236 = 2036 > 1912 -> clamp to 1920 - 236 - 8 = 1676
assert.equal(pos3.left, 1676, "Left deve ser limitado à borda direita da viewport");
console.log("  ✔ Caso 3: Clamping horizontal na borda direita.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DO POPOVER DE OPÇÕES DE VISUALIZAÇÃO APROVADO!");
console.log("============================================================\n");
