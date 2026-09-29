// ======================================================================
// Autoteste: Janelas destacadas com 2 a 4 painéis (F4b do plano drag & dock)
// Execução: node tests/autoteste_dock_group.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");
const groupHtml = read("src", "ui", "panel-group.html");
const panelHtml = read("src", "ui", "panel.html");
const wm = read("src", "ui", "js", "workspaceManager.js");
const dd = read("src", "ui", "js", "dockDrag.js");
const restore = read("src", "ui", "js", "popoutRestore.js");

console.log("=== INICIANDO AUTOTESTE: DOCK GROUP (F4b) ===\n");

// 1. panel-group.html: até 4 espaços, 4 disposições, divisores, avisos ao editor
assert.ok(groupHtml.includes('.slice(0, 4)'), "no máximo 4 painéis");
for (const a of ["row", "column", "grid", "main"]) assert.ok(groupHtml.includes(`data-arrangement="${a}"`), `disposição ${a}`);
assert.ok(groupHtml.includes('btn.disabled = (a === "grid" || a === "main") && panels.length < 3;'), "grade e principal+coluna só com 3 ou mais");
assert.ok(groupHtml.includes("group-splitter") && groupHtml.includes('addEventListener("dblclick"'), "divisores arrastáveis; duplo clique iguala");
assert.ok(groupHtml.includes("registerGroupPopout(panels, window, arrangement)") && groupHtml.includes('type: "GROUP_POPOUT_READY"'));
assert.ok(groupHtml.includes('type: "GROUP_POPOUT_CLOSED", panels, windowName: window.name'));
assert.ok(groupHtml.includes('if (!params.get("dock"))'), "janela que veio de outra mantém posição e tamanho");
console.log("✔ 1 passou: página de grupo com até 4 espaços, disposições, divisores e conexão com o editor.");

// 2. WorkspaceManager: montar em espaços, converter janela, tirar painel, reacoplar, desfazer
assert.ok(wm.includes("attachPanelToPopout(panelId, win, slot = null)") && wm.includes('const container = slot || win.document.getElementById("panel-container");'), "cada painel vai para o seu espaço");
assert.ok(wm.includes("win.location.href = `panel-group.html?group=${panels.join(\",\")}&arrangement=${arrangement}&dock=keep`"), "juntar navega a janela existente, sem abrir outra");
assert.ok(/removeFromGroup\(panelId\) \{[\s\S]*?win\.location\.href = `panel\.html\?panel=\$\{other\}&dock=keep`/.test(wm), "grupo com 1 restante vira janela simples");
assert.ok(/togglePopout\(panelId, options = \{\}\) \{\s*\/\/[^\n]*\n\s*if \(this\.getGroupPanels\(\)\.includes\(panelId\)\) \{\s*this\.removeFromGroup\(panelId\);/.test(wm), "destacar/reacoplar um painel de grupo tira só ele");
assert.ok(wm.includes("if (legacy.group && !sameGroup(current.group, legacy.group))") && wm.includes("this.openGroupPopout(legacy.group.panels, legacy.group.arrangement)"), "desfazer/refazer reabre grupos");
console.log("✔ 2 passou: montar em espaços, converter, tirar painel, reacoplar e desfazer.");

// 3. Avisos de "fechei" atrasados não desfazem trocas (bugs achados nos testes com mouse real)
assert.ok(panelHtml.includes("panel: panel1Name,\n                    windowName: window.name"), "panel.html diz qual janela fechou");
assert.ok(wm.includes("isStaleCloseMessage(panels, windowName)"));
assert.ok(/data\.type === "GROUP_POPOUT_CLOSED"[\s\S]{0,300}if \(!groupWin \|\| this\.isCloseMessageSuppressed\(panels\) \|\| this\.isStaleCloseMessage\(panels, data\.windowName\)\) return;/.test(wm));
assert.ok(/const winName = getPopoutWindowName\(panelId\);[\s\S]{0,300}this\.suppressCloseMessages\(\[panelId\]\);/.test(wm), "reabrir pelo nome não é desfeito pelo aviso da página antiga");
assert.ok(wm.includes("new Set([...prev, ...panels])"), "supressões se acumulam");
console.log("✔ 3 passou: avisos atrasados de janelas trocadas ou reaproveitadas são ignorados.");

// 4. Arrastar: qualquer janela destacada é alvo; 2 laterais sozinhas = Janela Dupla; 4º painel = grade
assert.ok(dd.includes("if (inside.length === 0 || inside.length >= 4) return null;"), "até 4 por janela");
assert.ok(dd.includes('const arrangement = count >= 4 ? "grid" : (side === "left" || side === "right" ? "row" : "column");'));
assert.ok(dd.includes("this.wm.joinIntoWindow(target.win, d.panelId, target.position, target.arrangement)"));
assert.ok(restore.includes('kind: "group"') && restore.includes("this.wm.openGroupPopout(item.panels, item.arrangement, { quiet })"), "grupo volta ao abrir o Talho");
console.log("✔ 4 passou: juntar em qualquer janela (até 4), grade no 4º, grupo restaurado ao abrir.");

console.log("\n=== AUTOTESTE DOCK GROUP CONCLUÍDO COM SUCESSO ===");
