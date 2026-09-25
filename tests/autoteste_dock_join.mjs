// ======================================================================
// Autoteste: Juntar e separar janelas destacadas por arrasto (F4a do plano drag & dock)
// Execução: node tests/autoteste_dock_join.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");
const dd = read("src", "ui", "js", "dockDrag.js");
const wm = read("src", "ui", "js", "workspaceManager.js");
const panelHtml = read("src", "ui", "panel.html");

console.log("=== INICIANDO AUTOTESTE: DOCK JOIN (F4a) ===\n");

// 1. Juntar reaproveita a janela (navega para o modo duplo): não depende do gesto do usuário
assert.ok(wm.includes("win.location.href = `panel.html?panels=${order.join(\",\")}&layout=${layout}&dock=keep`"), "juntar navega a janela existente para a Janela Dupla");
assert.ok(/joinIntoPopout\(targetPanel, panelId, side\) \{[\s\S]*?this\.restorePanel\(targetPanel\);[\s\S]*?win\.location\.href/.test(wm), "painel da janela volta ao editor antes de ela recarregar");
assert.ok(/const layout = side === "top" \|\| side === "bottom" \? "stacked" : "side-by-side";/.test(wm), "borda decide lado a lado ou empilhados");
assert.ok(panelHtml.includes('params.get("dock") !== "keep"'), "janela que só troca de modo mantém posição e tamanho");
console.log("✔ 1 passou: juntar navega a janela existente, sem abrir outra.");

// 2. Separar: o painel arrastado volta, o outro fica sozinho na mesma janela
assert.ok(wm.includes("win.location.href = `panel.html?panel=${other}&dock=keep`"), "separar navega a dupla para o modo simples");
assert.ok(/dual && !dual\.closed && window\.popoutWindows\[panelId\] === dual\) this\.wm\.splitFromDual\(panelId\)/.test(dd), "arrastar da dupla para o editor separa");
console.log("✔ 2 passou: separar deixa o outro painel sozinho na mesma janela.");

// 3. O aviso de 'fechou' da janela que troca de modo não restaura nada
assert.ok(wm.includes("if (this.isCloseMessageSuppressed([data.panel]) || this.isStaleCloseMessage([data.panel], data.windowName)) return;"));
assert.ok(wm.includes("if (this.isCloseMessageSuppressed(panels) || this.isStaleCloseMessage(panels, data.windowName)) return;"));
console.log("✔ 3 passou: avisos de fechamento suprimidos durante a troca de modo.");

// 4. Alvo de juntar: só janelas simples de laterais, e só sem Janela Dupla aberta
assert.ok(dd.includes("const pairOfColumns = inside.length === 1 && COLUMN_PANELS.includes(inside[0]) && COLUMN_PANELS.includes(panelId) && !dualWin;"), "duas laterais sozinhas viram a Janela Dupla (F4b generaliza o resto)");
assert.ok(dd.includes("drawJoin(join)") && dd.includes("this.drawJoin(null);"), "prévia desenhada na janela alvo e removida ao terminar");
assert.ok(!panelHtml.includes("#dual-workspace .dock-handle { display: none"), "alça visível também na Janela Dupla");
console.log("✔ 4 passou: par de laterais vira a Janela Dupla; prévia na janela alvo; alça na dupla.");

console.log("\n=== AUTOTESTE DOCK JOIN CONCLUÍDO COM SUCESSO ===");
