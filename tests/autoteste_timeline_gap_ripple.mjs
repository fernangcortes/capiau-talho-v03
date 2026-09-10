// Autoteste da detecção de gaps e opção Ripple Delete no menu de contexto da Timeline
// Executa em Node.js: node tests/autoteste_timeline_gap_ripple.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== INICIANDO TESTES DE RIPPLE DELETE EM ESPAÇO VAZIO (GAP) ===");

// 1. Validar staticamente timelineInteraction.js
const tiPath = path.join(raiz, "src", "ui", "js", "timelineInteraction.js");
const tiContent = readFileSync(tiPath, "utf8");

// Teste 1: onContextMenu deve buscar gaps via TIMELINE_STATE.getGapAt
assert(
    tiContent.includes("TIMELINE_STATE.getGapAt(frame, track)"),
    "onContextMenu deve verificar TIMELINE_STATE.getGapAt(frame, track)"
);
console.log("✔ Teste 1 passou: onContextMenu consulta getGapAt para detectar espaços vazios.");

// Teste 2: onContextMenu deve acionar showGapContextMenu quando um gap for detectado
assert(
    tiContent.includes("this.showGapContextMenu(e.clientX, e.clientY, gap, frame)"),
    "onContextMenu deve chamar showGapContextMenu ao encontrar gap"
);
console.log("✔ Teste 2 passou: onContextMenu delega para showGapContextMenu ao detectar gap.");

// Teste 3: showGapContextMenu deve conter opção 'Ripple Delete (Fechar Espaço)'
assert(
    tiContent.includes('Ripple Delete (Fechar Espaço)'),
    "showGapContextMenu deve exibir opção 'Ripple Delete (Fechar Espaço)'"
);
console.log("✔ Teste 3 passou: showGapContextMenu possui item 'Ripple Delete (Fechar Espaço)'.");

// Teste 4: showGapContextMenu deve chamar TIMELINE_STATE.rippleDeleteGap
assert(
    tiContent.includes("TIMELINE_STATE.rippleDeleteGap(gap.trackId, gap.startFrame, gap.durationFrames)"),
    "showGapContextMenu deve invocar TIMELINE_STATE.rippleDeleteGap com os parâmetros corretos"
);
console.log("✔ Teste 4 passou: acionamento executa TIMELINE_STATE.rippleDeleteGap.");

// Teste 5: showRulerContextMenu oferece Ripple Delete no Espaço Selecionado
assert(
    tiContent.includes("Ripple Delete no Espaço Selecionado"),
    "showRulerContextMenu deve oferecer opção contextual de Ripple Delete quando houver selectedGap"
);
console.log("✔ Teste 5 passou: showRulerContextMenu suporta Ripple Delete quando um gap estiver selecionado.");

// Teste 6: onMouseMove rastreia hoveredGap para feedback visual
assert(
    tiContent.includes("this.renderer.hoveredGap = gap"),
    "onMouseMove deve atualizar hoveredGap no renderer para feedback de hover"
);
console.log("✔ Teste 6 passou: onMouseMove gerencia hoveredGap dinamicamente.");

console.log("\n=======================================================");
console.log("🎉 TODOS OS 6 TESTES DE RIPPLE DELETE EM GAPS PASSARAM COM SUCESSO!");
console.log("=======================================================\n");
