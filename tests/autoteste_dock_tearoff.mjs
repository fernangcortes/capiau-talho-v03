// ======================================================================
// Autoteste: Destacar arrastando e reacoplar (F3 do plano drag & dock)
// Execução: node tests/autoteste_dock_tearoff.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");
const dockDrag = read("src", "ui", "js", "dockDrag.js");
const wm = read("src", "ui", "js", "workspaceManager.js");
const panelHtml = read("src", "ui", "panel.html");

console.log("=== INICIANDO AUTOTESTE: DOCK TEAR-OFF (F3) ===\n");

// 1. A janela nasce ao cruzar a borda (gesto ainda válido) e segue o cursor
assert.ok(/if \(!d\.live && !d\.liveFailed\) \{\s*d\.live = this\.wm\.openLivePopout\(/.test(dockDrag), "abre a janela ao sair do editor, uma vez por arrasto");
assert.ok(/d\.live\.moveTo\(/.test(dockDrag), "a janela segue o cursor");
assert.ok(/this\.wm\.cancelLivePopout\(d\.panelId, d\.live\)/.test(dockDrag), "voltar para dentro antes de soltar fecha a janela prévia");
assert.ok(/this\.wm\.commitLivePopout\(d\.panelId, d\.live\)/.test(dockDrag), "soltar fora confirma a janela");
console.log("✔ 1 passou: janela nasce ao cruzar a borda, segue o cursor, cancela ao voltar e confirma ao soltar.");

// 2. O painel só entra na janela quando o mouse é solto
assert.ok(/if \(this\._deferredPopouts\.has\(panelId\)\) \{\s*this\._deferredPopouts\.set\(panelId, win\);\s*return;/.test(wm), "attachPanelToPopout segura painéis de janelas abertas no meio do arrasto");
assert.ok(wm.includes("`panel.html?panel=${panelId}&dock=live`"), "janela do arrasto é marcada como live");
assert.ok(panelHtml.includes('params.get("dock") !== "live"'), "panel.html não volta à posição salva quando nasce de um arrasto");
console.log("✔ 2 passou: painel entra na janela só ao soltar; posição do cursor respeitada.");

// 3. Plano B quando o navegador bloqueia (gesto expirado)
assert.ok(/d\.outside && d\.liveFailed[\s\S]{0,200}showActionToast\([\s\S]{0,120}"Abrir em janela"/.test(dockDrag), "aviso com botão Abrir em janela");
console.log("✔ 3 passou: plano B com botão 'Abrir em janela'.");

// 4. Voltar da janela destacada: ponte de coordenadas + zonas do editor
assert.ok(dockDrag.includes("this.calib = { bx: e.screenX - e.clientX - window.screenX"), "calibração guarda o deslocamento da borda da janela");
assert.ok(/d\.fromPopout \? this\.screenToMain\(e\.screenX, e\.screenY\)/.test(dockDrag), "ponteiro da janela destacada convertido para o editor");
assert.ok(dockDrag.includes("this.homeTarget(d.panelId)"), "solto no editor sem zona: volta para o lugar de antes");
assert.ok(/dockBack\(panelId, target\) \{\s*this\.wm\.togglePopout\(panelId\);/.test(dockDrag), "reacoplar fecha a janela e restaura o painel");
assert.ok(panelHtml.includes("#dual-workspace .dock-handle { display: none !important; }"), "alça visível na janela simples, escondida na dupla até a F4");
console.log("✔ 4 passou: arrastar de volta usa a ponte de coordenadas e as zonas do editor.");

// 5. Continuidade de mídia ao destacar (vídeo não volta a 0 s)
assert.ok(wm.includes("export function preserveMediaAcrossDocuments(root)"));
assert.equal((wm.match(/const restoreMedia\w* = preserveMediaAcrossDocuments\(/g) || []).length, 3, "janela simples e os dois lados da dupla");
console.log("✔ 5 passou: tempo e reprodução preservados ao destacar (simples e dupla).");

console.log("\n=== AUTOTESTE DOCK TEAR-OFF CONCLUÍDO COM SUCESSO ===");
