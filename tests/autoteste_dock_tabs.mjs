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
const ids = [...tabs.matchAll(/^\s{4}(\w+): \{ title: "[^"]+", icon: "[^"]+", container: "([\w-]+)" \}/gm)].filter(([, , c]) => !c.startsWith("tab-"));
assert.equal(ids.length, 6, "6 abas do Painel Lateral");
for (const [, tab, container] of ids) {
    assert.ok(indexHtml.includes(`id="${container}"`), `contêiner ${container} existe`);
    assert.ok(indexHtml.includes(`data-right-tab="${tab}"`), `botão da aba ${tab} existe`);
    assert.ok(groupHtml.includes(`"tabpanel-${tab}":`) && panelHtml.includes(`"tabpanel-${tab}":`), `título da aba ${tab} nas janelas`);
}
console.log("✔ 1 passou: 6 abas com contêiner, botão e título nas janelas.");

// 2. Máquina existente reaproveitada: invólucro montado em qualquer caminho, conteúdo volta à faixa
assert.ok(/this\.wm\.attachPanelToPopout = \(panelId, win, \.\.\.rest\) => \{[\s\S]{0,120}if \(tab\) this\.prepare\(tab\);/.test(tabs), "attach monta o invólucro (janela, grupo, desfazer, restaurar)");
assert.ok(/this\.wm\.restorePanel = \(panelId, \.\.\.rest\) => \{[\s\S]{0,160}if \(tab\) this\.returnToStrip\(tab\);/.test(tabs), "ao reacoplar, o conteúdo volta à faixa");
assert.ok(/if \(!opened \|\| opened\.closed\) this\.returnToStrip\(tab\);/.test(tabs), "bloqueio do navegador devolve a aba");
assert.ok(restore.includes("[...PANEL_IDS, ...TAB_PANEL_IDS].forEach"), "abas destacadas voltam ao abrir o Talho");
console.log("✔ 2 passou: janelas, grupos, desfazer e restauração valem para abas.");

// 3. Gestos: arrastar a aba (mesmo arrasto do reordenar) e menu da faixa
assert.ok(strip.includes('window.tabPanelTabFromValue?.(btn.getAttribute("data-tab") || btn.getAttribute("data-right-tab"))') && strip.includes("window.tabPanels.onTabDragEnd(tab, e)"), "fim do arrasto da aba decide destacar/juntar (das duas faixas)");
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

// 6. F5b: abas da Biblioteca (Mídias fica: é o corpo da Biblioteca)
const left = [...tabs.matchAll(/^\s{4}(\w+): \{ title: "[^"]+", icon: "[^"]+", container: "(tab-[\w-]+)"/gm)];
assert.deepEqual(left.map(m => m[2]).sort(), ["tab-docs", "tab-faces", "tab-themes", "tab-titles"], "Temas, Rostos, Títulos e Docs saem; Mídias não");
for (const [, tab, container] of left) {
    assert.ok(indexHtml.includes(`id="${container}"`) && indexHtml.includes(`data-tab="${container}"`), `aba ${container} existe`);
    assert.ok(groupHtml.includes(`"tabpanel-${tab}":`) && panelHtml.includes(`"tabpanel-${tab}":`), `título da aba ${tab} nas janelas`);
}
const faces = read("src", "ui", "js", "faces.js");
const panelsJs = read("src", "ui", "js", "panels.js");
const library = read("src", "ui", "js", "library.js");
assert.ok(faces.includes('window.dockTabSearchQuery?.("tab-faces") ??'), "Rostos destacados usam busca própria");
assert.ok(panelsJs.includes('window.dockTabSearchQuery?.("tab-themes") ??'), "Temas destacados usam busca própria");
assert.ok(library.includes('window.dockTabSearchQuery?.("tab-docs") ??'), "Docs destacados usam busca própria");
assert.ok(tabs.includes('input.className = "tab-panel-search";'), "campo de busca no cabeçalho da aba destacada");
assert.ok(/if \(tab === "faces"\) window\.FaceManager\?\.onPopoutReady\?\.\(win\);/.test(tabs) && tabs.includes("window.FaceManager?.onPopoutRestored?.()"), "modais e atalhos dos Rostos acompanham a janela");
assert.ok(!/libraryInstance\?\.onPopoutReady/.test(tabs), "não troca o documento da Biblioteca inteira ao destacar Docs");
assert.ok(tabs.includes("if (wrapper && !wrapper.isConnected) this.host.appendChild(wrapper);"), "invólucro reaproveitado não é tomado por 'já destacado' (desfazer)");
assert.ok(strip.includes("source?._orderBeforeDrag?.forEach(child => {") && /if \(tab && window\.tabPanels\.onTabDragEnd\(tab, e\)\) restoreOrder\(\);/.test(strip), "destacar não reordena a faixa");
console.log("✔ 6 passou: abas da Biblioteca com busca própria e ganchos; Mídias fica; ordem da faixa preservada.");

// 7. P14: aba muda de menu (convidada no outro menu, mesmo invólucro)
assert.ok(tabs.includes("export function normalizeTabStrips(strips)"), "normalizador do menu das abas");
assert.ok(strip.includes('if (window.tabPanels.moveToStrip(t.tab, t.side, before)) t.dragging.dataset.stripMoved = "true";'), "soltar no outro menu move a aba");
assert.ok(/window\.addEventListener\("drop", \(e\) => \{[\s\S]{0,120}e\.stopPropagation\(\);/.test(strip), "soltura de aba não chega ao arrastar de arquivos da Biblioteca");
assert.ok(strip.includes("window.tabPanels.moveToStrip(clickedTab, otherSide);"), "menu da faixa: mover para o outro menu");
assert.ok(strip.includes("if (btn.dataset.stripMoved) {"), "mudar de menu não destaca a aba");
assert.ok(strip.includes('`guest:${btn.dataset.guestTab}`') && tabs.includes("insertBySavedOrder(btn, strip)"), "posição da convidada fica salva na ordem da faixa");
assert.ok(/if \(this\.strips\[tab\]\) \{[\s\S]{0,400}this\.mountGuest\(tab, null\);/.test(tabs), "ao voltar da janela, a aba volta ao menu onde estava");
assert.ok(tabs.includes('if (tab) this.leaveGuestStrip(tab);'), "convidada sai do modo menu ao ir para uma janela");
assert.ok(/if \(this\.strips\[tab\] && !this\.inWindow\(tab\)\) \{\s*this\.activateGuest\(tab\);/.test(tabs), "pedido da aba (ex.: Tarefas) mostra ela no outro menu");
assert.ok(mainJs.includes("setTimeout(() => window.tabPanels.mountSavedStrips(), 0);"), "menus salvos voltam ao abrir o Talho");
const wm = read("src", "ui", "js", "workspaceManager.js");
assert.ok(wm.includes("tabStrips: window.tabPanels?.getStrips?.() || {}") && wm.includes("window.tabPanels?.applyStrips?.(legacy.tabStrips || {});"), "menu das abas entra no desfazer/refazer");
assert.ok(wm.includes("window.tabPanels?.applyStrips?.(customConfig?.tabsCustomization?.tabStrips || {});"), "workspaces guardam e restauram o menu das abas");
const css = read("src", "ui", "styles.css");
assert.ok(css.includes(".tab-panel.dock-strip-guest.dock-guest-active") && css.includes(".dock-strip-marker"), "estilos da convidada e do marcador");
console.log("✔ 7 passou: aba muda de menu por arrasto ou menu, com posição, desfazer e workspaces.");

console.log("\n=== AUTOTESTE DOCK TABS CONCLUÍDO COM SUCESSO ===");
