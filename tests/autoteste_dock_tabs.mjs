// ======================================================================
// Autoteste: Abas do Painel Lateral como painéis próprios (F5a do plano drag & dock)
// Execução: node tests/autoteste_dock_tabs.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");
const tabs = read("src", "ui", "js", "tabPanels.js");
const mainJs = read("src", "ui", "js", "main.js");
const strip = read("src", "ui", "js", "tabsCustomization.js");
const restore = read("src", "ui", "js", "popoutRestore.js");
const indexHtml = read("src", "ui", "index.html");
const groupHtml = read("src", "ui", "panel-group.html");
const panelHtml = read("src", "ui", "panel.html");

console.log("=== INICIANDO AUTOTESTE: DOCK TABS (F5a) ===\n");

// 1. Cada aba do Painel Lateral aponta para um contêiner e um botão que existem
const ids = [...tabs.matchAll(/^\s{4}(\w+): \{ title: "[^"]+", icon: "[^"]+", container: "([\w-]+)" \}/gm)];
assert.equal(ids.length, 6, "6 abas do Painel Lateral");
for (const [, tab, container] of ids) {
    assert.ok(indexHtml.includes(`id="${container}"`), `contêiner ${container} existe`);
    assert.ok(indexHtml.includes(`data-right-tab="${tab}"`), `botão da aba ${tab} existe`);
    assert.ok(groupHtml.includes(`"tabpanel-${tab}":`) && panelHtml.includes(`"tabpanel-${tab}":`), `título da aba ${tab} nas janelas`);
}
console.log("✔ 1 passou: 6 abas com contêiner, botão e título nas janelas.");

// 2. Máquina existente reaproveitada: invólucro montado em qualquer caminho, conteúdo volta à faixa
assert.ok(/this\.wm\.attachPanelToPopout = \(panelId, \.\.\.rest\) => \{[\s\S]{0,120}if \(tab\) this\.prepare\(tab\);/.test(tabs), "attach monta o invólucro (janela, grupo, desfazer, restaurar)");
assert.ok(/this\.wm\.restorePanel = \(panelId, \.\.\.rest\) => \{[\s\S]{0,160}if \(tab\) this\.returnToStrip\(tab\);/.test(tabs), "ao reacoplar, o conteúdo volta à faixa");
assert.ok(/if \(!opened \|\| opened\.closed\) this\.returnToStrip\(tab\);/.test(tabs), "bloqueio do navegador devolve a aba");
assert.ok(restore.includes("[...PANEL_IDS, ...TAB_PANEL_IDS].forEach"), "abas destacadas voltam ao abrir o Talho");
console.log("✔ 2 passou: janelas, grupos, desfazer e restauração valem para abas.");

// 3. Gestos: arrastar a aba (mesmo arrasto do reordenar) e menu da faixa
assert.ok(/containerId === "right-tabs" && window\.tabPanels[\s\S]{0,80}onTabDragEnd\(btn\.getAttribute\(attrName\), e\)/.test(strip), "fim do arrasto da aba decide destacar/juntar");
assert.ok(strip.includes("window.tabPanels.tearOff(clickedTab)"), "menu da faixa: destacar em nova janela");
assert.ok(/const join = this\.dockDrag\?\.findJoinTarget\(id, sx, sy\);[\s\S]{0,700}if \(insideMain\) return false;/.test(tabs), "dentro do editor só reordena");
console.log("✔ 3 passou: arrastar para fora destaca, sobre janela junta, dentro reordena; menu da faixa.");

// 4. Faixa e Painel Lateral
assert.ok(mainJs.includes("if (rightContainers[tab]?.dataset.dockOut) {") && mainJs.includes("if (c && !c.dataset.dockOut) c.style.display = \"none\";"), "troca de aba não esconde abas destacadas");
assert.ok(mainJs.includes("if (btnTabVision.dataset.dockOut) return;"), "botão da Visão não reaparece enquanto destacada");
assert.ok(tabs.includes("syncSidebarVisibility()") && tabs.includes('document.getElementById("toggle-right")?.click();'), "Painel Lateral some sem abas e volta com uma");
console.log("✔ 4 passou: faixa respeita abas destacadas; Painel Lateral some e volta.");

// 5. Com janelas sobrepostas, juntar vai para a de cima (focada por último)
const dd = read("src", "ui", "js", "dockDrag.js");
assert.ok(dd.includes(".sort((a, b) => (b.__dockZ || 0) - (a.__dockZ || 0));"));
console.log("✔ 5 passou: alvo de juntar é a janela focada por último.");

console.log("\n=== AUTOTESTE DOCK TABS CONCLUÍDO COM SUCESSO ===");
