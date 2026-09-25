// ======================================================================
// Autoteste: Arrastar painéis pela alça (F2a do plano drag & dock)
// Execução: node tests/autoteste_dock_drag.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");

console.log("=== INICIANDO AUTOTESTE: DOCK DRAG (F2a) ===\n");

const dockDrag = read("src", "ui", "js", "dockDrag.js");
const mainJs = read("src", "ui", "js", "main.js");
const css = read("src", "ui", "styles.css");
const indexHtml = read("src", "ui", "index.html");
const panelHtml = read("src", "ui", "panel.html");

// 1. Cada painel arrastável aponta para um cabeçalho que existe no index.html
const headers = {
    "sidebar-left": /id="sidebar-left"[\s\S]*?class="sidebar-header"/,
    "inspector-panel": /id="inspector-panel"[\s\S]*?class="sidebar-header"/,
    "sidebar-right": /id="sidebar-right"[\s\S]*?class="sidebar-header"/,
    "source-player-panel": /id="source-player-panel"[\s\S]*?class="player-header"/,
    "program-player-panel": /id="program-player-panel"[\s\S]*?class="player-header"/,
    "timeline-panel": /id="timeline-panel"[\s\S]*?class="timeline-header-left"/
};
for (const [panel, re] of Object.entries(headers)) {
    assert.ok(dockDrag.includes(`"${panel}": {`), `${panel} está em DOCK_PANELS`);
    assert.ok(re.test(indexHtml), `cabeçalho de ${panel} existe no index.html`);
}
console.log("✔ 1 passou: os 6 painéis arrastáveis têm cabeçalho para receber a alça.");

// 2. Motor de Pointer Events com captura (decisão da F0), Esc cancela
assert.ok(dockDrag.includes("setPointerCapture(e.pointerId)"), "arrasto usa captura de ponteiro");
assert.ok(!/draggable\s*=\s*true|dragstart/.test(dockDrag), "não usa arrasto HTML5");
assert.ok(/this\.drag && e\.key === "Escape"/.test(dockDrag), "Esc cancela o arrasto");
console.log("✔ 2 passou: Pointer Events com captura; Esc cancela.");

// 3. Encaixes limitados ao que o layout atual monta, via métodos que registram histórico
for (const call of ["this.wm.setColumnLayout(", "this.wm.setTimelinePosition(", "this.wm.setMonitorsLayout("]) {
    assert.ok(dockDrag.includes(call), `aplica encaixe com ${call}`);
}
for (const op of ["moveBeside", "moveToEdge", "stackWith", "swapPanels"]) {
    assert.ok(dockDrag.includes(`${op}(state`), `zona de coluna usa ${op} do dockOps`);
}
console.log("✔ 3 passou: colunas (ao lado, ponta, empilhar, trocar), timeline e monitores aplicados pelos métodos com histórico.");

// 3b. Pilhas no WorkspaceManager (F2b)
const wm = read("src", "ui", "js", "workspaceManager.js");
assert.ok(wm.includes("mountStackGuests(colId, colEl)"), "arranjo das colunas monta as pilhas");
assert.ok(/this\.detachFromStack\(panelId\);\s*\n\s*const winName = getPopoutWindowName\(panelId\);/.test(wm), "destacar tira o painel da pilha antes");
assert.ok(wm.includes("this.detachFromStack(panelId1);") && wm.includes("this.detachFromStack(panelId2);"), "janela dupla tira os dois painéis das pilhas");
assert.ok(wm.includes("columnStacks: this.columnStacks.map(st => [...st]),\n            popouts:"), "workspace salvo guarda as pilhas");
assert.ok(css.includes(".dock-stack-guest {") && css.includes(".dock-stack-splitter {"), "estilos das pilhas");
console.log("✔ 3b passou: pilhas montadas no arranjo, desfeitas ao destacar e salvas no workspace.");

// 4. Aviso de desfazer: Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y só enquanto visível, sem roubar campos de texto
assert.ok(dockDrag.includes('window.addEventListener("keydown", this.onKey, true)'), "atalhos do aviso na fase de captura");
assert.ok(dockDrag.includes("if (this.toast.hidden ||"), "atalhos só valem com o aviso visível");
assert.ok(/t\.tagName === "INPUT" \|\| t\.tagName === "TEXTAREA"/.test(dockDrag), "não intercepta Ctrl+Z em campos de texto");
assert.ok(dockDrag.includes("const TOAST_MS = 6000"), "aviso dura 6 s");
console.log("✔ 4 passou: aviso de desfazer com Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, protegido em campos de texto.");

// 5. Integração
assert.ok(mainJs.includes('import { DockDragController } from "./dockDrag.js"'));
assert.ok(mainJs.includes("new DockDragController(workspace)"));
for (const cls of [".dock-handle", ".dock-ghost", ".dock-preview", ".dock-drop-label", ".dock-undo-toast"]) {
    assert.ok(css.includes(`${cls} {`) || css.includes(`${cls},`), `estilo ${cls}`);
}
assert.ok(/\.dock-handle \{ display: none !important; \}/.test(panelHtml), "alça escondida nas janelas destacadas até a F3");
console.log("✔ 5 passou: controlador criado no main.js, estilos presentes, alça escondida nas janelas destacadas.");

console.log("\n=== AUTOTESTE DOCK DRAG CONCLUÍDO COM SUCESSO ===");
