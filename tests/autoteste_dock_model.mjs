// ======================================================================
// Autoteste: DockModel (F1 do plano de janelas destacáveis por arrastar-e-soltar)
// Execução: node tests/autoteste_dock_model.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "dockModel.js")).href);
const {
    layoutFromLegacy, legacyFromLayout, validateLayout, serializeLayout, parseLayout,
    layoutsEqual, panelsIn, LayoutHistory, COLUMN_IDS, CENTER_STAGE, PANEL_IDS
} = model;

console.log("=== INICIANDO AUTOTESTE: DOCK MODEL ===\n");

// ----------------------------------------------------------------------
// PARTE 1: Ida e volta com o layout legado
// ----------------------------------------------------------------------
console.log("--- PARTE 1: Conversão legado ↔ árvore ---");

const permutations = (items) => items.length <= 1
    ? [items]
    : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));

const orders = permutations([...COLUMN_IDS, CENTER_STAGE]);
const positions = ["center", "bottom-left", "bottom-right", "bottom-full"];
const monitors = ["auto", "side-by-side", "stacked"];

let combos = 0;
for (const columnOrder of orders) {
    for (const timelinePosition of positions) {
        for (const monitorsLayout of monitors) {
            const state = { columnOrder, timelinePosition, monitorsLayout, columnStacks: [], popped: [], dual: null, group: null };
            const layout = layoutFromLegacy(state);
            assert.deepEqual(validateLayout(layout), [], `layout inválido para ${JSON.stringify(state)}`);
            assert.deepEqual(legacyFromLayout(layout), state, `ida e volta falhou para ${JSON.stringify(state)}`);
            combos++;
        }
    }
}
console.log(`✔ 1.1 passou: ${combos} combinações (24 ordens × 4 posições da timeline × 3 monitores) vão e voltam iguais.`);

const presets = {
    padrao: ["sidebar-left", "inspector-panel", CENTER_STAGE, "sidebar-right"],
    inspetorDireita: ["sidebar-left", CENTER_STAGE, "inspector-panel", "sidebar-right"]
};
for (const [name, columnOrder] of Object.entries(presets)) {
    const popped = ["timeline-panel", "program-player-panel"];
    const state = { columnOrder, timelinePosition: "bottom-full", monitorsLayout: "stacked", columnStacks: [], popped, dual: null, group: null };
    const layout = layoutFromLegacy(state);
    assert.deepEqual(validateLayout(layout), [], `preset ${name} com janelas destacadas inválido`);
    assert.deepEqual(legacyFromLayout(layout), state);
    assert.equal(layout.floats.length, 2);
    assert.ok(panelsIn(layout.main, { includeAway: true }).includes("timeline-panel"), "o lugar da timeline destacada fica guardado no editor");
    assert.ok(!panelsIn(layout.main).includes("timeline-panel"), "a timeline destacada não conta como presente no editor");
}
console.log("✔ 1.2 passou: janelas destacadas individuais guardam o lugar de volta e fazem ida e volta.");

{
    const dual = { panels: ["inspector-panel", "sidebar-right"], layout: "stacked" };
    const state = { columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", columnStacks: [], popped: ["source-player-panel"], dual, group: null };
    const layout = layoutFromLegacy(state);
    assert.deepEqual(validateLayout(layout), []);
    assert.deepEqual(legacyFromLayout(layout), state);
    const dualFloat = layout.floats.find(f => f.id === "float:dual");
    assert.equal(dualFloat.root.split, "column", "janela dupla empilhada vira divisão em coluna");
}
console.log("✔ 1.3 passou: Janela Dupla (lado a lado/empilhada) é uma janela destacada com 2 painéis.");

{
    // Pilhas (F2b): em todas as ordens e posições da timeline, a pilha vira um nó "stack" e volta igual.
    const ops = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "dockOps.js")).href);
    let stackCombos = 0;
    for (const baseOrder of orders) {
        for (const timelinePosition of positions) {
            for (const stack of [["sidebar-left", "sidebar-right"], ["inspector-panel", "sidebar-left", "sidebar-right"]]) {
                const columnStacks = ops.normalizeStacks([stack]);
                const columnOrder = ops.syncOrderWithStacks(baseOrder, columnStacks);
                const state = { columnOrder, timelinePosition, monitorsLayout: "auto", columnStacks, popped: [], dual: null, group: null };
                const layout = layoutFromLegacy(state);
                assert.deepEqual(validateLayout(layout), [], `pilha inválida: ${JSON.stringify(state)}`);
                assert.deepEqual(legacyFromLayout(layout), state, `pilha não voltou igual: ${JSON.stringify(state)}`);
                stackCombos++;
            }
        }
    }
    console.log(`✔ 1.4 passou: ${stackCombos} combinações com pilhas de 2 e 3 laterais vão e voltam iguais.`);
}

{
    // Janela com vários painéis (F4b): 3 e 4 painéis, com disposição, junto de uma janela simples.
    for (const [panels, arrangement] of [[["timeline-panel", "program-player-panel", "inspector-panel"], "main"], [["sidebar-left", "inspector-panel", "sidebar-right", "source-player-panel"], "grid"], [["timeline-panel", "sidebar-right"], "column"]]) {
        const state = { columnOrder: presets.padrao, timelinePosition: "bottom-full", monitorsLayout: "auto", columnStacks: [], popped: panels.includes("sidebar-left") ? [] : ["sidebar-left"], dual: null, group: { panels, arrangement } };
        const layout = layoutFromLegacy(state);
        assert.deepEqual(validateLayout(layout), [], `grupo inválido: ${panels}`);
        assert.deepEqual(legacyFromLayout(layout), state, `grupo não voltou igual: ${panels}`);
        panels.forEach(id => assert.ok(panelsIn(layout.main, { includeAway: true }).includes(id), `lugar de ${id} guardado no editor`));
    }
    const five = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", group: { panels: ["sidebar-left", "inspector-panel", "sidebar-right", "source-player-panel", "program-player-panel"], arrangement: "grid" } });
    assert.ok(validateLayout(five).some(e => e.includes("máximo 4")), "grupo com 5 painéis é inválido");
    console.log("✔ 1.5 passou: janelas com 2–4 painéis (qualquer tipo) e disposição vão e voltam; 5 é inválido.");
}

// ----------------------------------------------------------------------
// PARTE 2: Validação
// ----------------------------------------------------------------------
console.log("\n--- PARTE 2: Regras de validação ---");

const base = () => layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto" });

{
    const dup = base();
    dup.floats.push({ id: "float:x", root: { panel: "sidebar-left" } });
    assert.ok(validateLayout(dup).some(e => e.includes("sidebar-left aparece mais de uma vez")));

    const missing = base();
    missing.main.children = missing.main.children.filter(c => c.panel !== "sidebar-right");
    assert.ok(validateLayout(missing).some(e => e.includes("sidebar-right não está em lugar nenhum")));

    const orphanAway = base();
    orphanAway.main.children[0] = { panel: "sidebar-left", away: true };
    assert.ok(validateLayout(orphanAway).some(e => e.includes("nenhuma janela o contém")));

    const tooMany = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", popped: [...COLUMN_IDS, "timeline-panel", "source-player-panel"] });
    tooMany.floats = [{ id: "float:big", root: { split: "row", children: [...COLUMN_IDS, "timeline-panel", "source-player-panel"].map(panel => ({ panel })) } }];
    assert.ok(validateLayout(tooMany).some(e => e.includes("máximo 4")));

    const unknown = base();
    unknown.main.children.push({ panel: "painel-fantasma" });
    assert.ok(validateLayout(unknown).some(e => e.includes("painel desconhecido")));
}
console.log("✔ 2.1 passou: detecta painel duplicado, ausente, destacado sem janela, janela com mais de 4 e id desconhecido.");

{
    // Layout livre (F2): Biblioteca e Falas empilhadas na mesma coluna — válido, mas o renderizador legado não monta.
    const free = base();
    const leftIdx = free.main.children.findIndex(c => c.panel === "sidebar-left");
    free.main.children[leftIdx] = { split: "column", children: [{ panel: "sidebar-left" }, { panel: "sidebar-right" }] };
    free.main.children = free.main.children.filter(c => c.panel !== "sidebar-right");
    assert.deepEqual(validateLayout(free), []);
    assert.equal(legacyFromLayout(free), null);
}
console.log("✔ 2.2 passou: layout livre é válido e legacyFromLayout devolve null (fica para o renderizador da F2).");

// ----------------------------------------------------------------------
// PARTE 3: Serialização e histórico
// ----------------------------------------------------------------------
console.log("\n--- PARTE 3: Serialização e histórico ---");

{
    const a = base();
    const reordered = JSON.parse(JSON.stringify(a), (key, value) =>
        value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).reverse())
            : value
    );
    assert.equal(serializeLayout(a), serializeLayout(reordered), "ordem das chaves não muda a serialização");
    assert.ok(layoutsEqual(a, reordered));
    assert.deepEqual(parseLayout(serializeLayout(a)), JSON.parse(serializeLayout(a)));
    assert.equal(parseLayout("{quebrado"), null);
    assert.equal(parseLayout(JSON.stringify({ v: 99, main: a.main, floats: [] })), null);
}
console.log("✔ 3.1 passou: serialização estável e parse rejeita texto inválido ou versão desconhecida.");

{
    const h = new LayoutHistory({ limit: 3 });
    const L = (timelinePosition) => layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition, monitorsLayout: "auto" });
    h.reset(L("center"));
    assert.equal(h.canUndo, false);
    assert.equal(h.record(L("center")), false, "estado igual não vira passo");
    assert.equal(h.record(L("bottom-full")), true);
    assert.equal(h.record(L("bottom-left")), true);
    assert.equal(legacyFromLayout(h.undo()).timelinePosition, "bottom-full");
    assert.equal(legacyFromLayout(h.undo()).timelinePosition, "center");
    assert.equal(h.undo(), null, "nada além da linha de base");
    assert.equal(legacyFromLayout(h.redo()).timelinePosition, "bottom-full");
    h.record(L("bottom-right"));
    assert.equal(h.canRedo, false, "novo passo descarta o refazer");
    ["center", "bottom-full", "bottom-left", "bottom-right"].forEach(p => h.record(L(p)));
    assert.ok(h.undoStack.length <= 3, "limite do histórico respeitado");

    const fresh = new LayoutHistory();
    assert.equal(fresh.record(L("center")), false, "primeiro registro vira linha de base, sem passo de desfazer");
    assert.equal(fresh.canUndo, false);
}
console.log("✔ 3.2 passou: desfazer/refazer, descarte do refazer, limite e linha de base.");

// ----------------------------------------------------------------------
// PARTE 4: Integração (verificação estática)
// ----------------------------------------------------------------------
console.log("\n--- PARTE 4: Integração ---");

const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");
const wmJs = read("src", "ui", "js", "workspaceManager.js");
const keymapJs = read("src", "ui", "js", "keymapService.js");
const indexHtml = read("src", "ui", "index.html");

assert.ok(wmJs.includes('from "./dockModel.js"'), "WorkspaceManager importa o DockModel");
for (const method of ["setTimelinePosition", "setMonitorsLayout", "applyColumnsOrder", "applyWorkspace", "attachPanelToPopout", "attachDualPanelsToPopout", "restorePanel", "restoreDualPopout"]) {
    assert.ok(new RegExp(`"${method}"`).test(wmJs.slice(wmJs.indexOf("this.layoutHistory = new LayoutHistory()"), wmJs.indexOf("this.init();"))), `${method} registra no histórico de layout`);
}
assert.equal((wmJs.match(/if \(this\.handleLayoutShortcut\(e\)\) return;/g) || []).length, 3, "atalhos de layout na principal e nas duas variantes de janela destacada");
assert.ok(indexHtml.includes('id="btn-reset-workspace-layout"'), "botão Restaurar layout no cabeçalho");

const capiauBlock = keymapJs.slice(keymapJs.indexOf("    capiau: {"), keymapJs.indexOf("    kdenlive: {"));
assert.ok(capiauBlock.includes('"layout.undo": ["Ctrl+Alt+KeyZ"]'));
assert.ok(capiauBlock.includes('"layout.redo": ["Ctrl+Alt+Shift+KeyZ"]'));
const allCombos = [...keymapJs.matchAll(/"([a-z_]+\.[a-z_0-9]+)": \[([^\]]*)\]/g)]
    .filter(([, id]) => !id.startsWith("layout."))
    .flatMap(([, , list]) => [...list.matchAll(/"([^"]+)"/g)].map(m => m[1]));
for (const combo of ["Ctrl+Alt+KeyZ", "Ctrl+Alt+Shift+KeyZ", "Ctrl+Shift+Alt+KeyZ"]) {
    assert.ok(!allCombos.includes(combo), `${combo} não pode estar em uso por outro comando`);
}
console.log("✔ 4.1 passou: histórico ligado aos métodos de layout, atalhos sem conflito, botão presente.");

// 4.2 P14: menu de cada aba viaja no layout (desfazer/refazer, histórico)
{
    const base = { columnOrder: ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"], timelinePosition: "center", monitorsLayout: "auto" };
    const plain = layoutFromLegacy(base);
    assert.equal(plain.tabStrips, undefined, "sem abas trocadas, o layout não muda de formato");
    assert.equal(legacyFromLayout(plain).tabStrips, undefined, "layout antigo = todas no menu de origem");
    const moved = layoutFromLegacy({ ...base, tabStrips: { transcript: "left", themes: "right", bogus: "top" } });
    assert.deepEqual(moved.tabStrips, { themes: "right", transcript: "left" });
    assert.deepEqual(legacyFromLayout(moved).tabStrips, { themes: "right", transcript: "left" });
    assert.notEqual(serializeLayout(plain), serializeLayout(moved), "mudar aba de menu é um passo do histórico");
}
console.log("✔ 4.2 passou: menu das abas no layout.");

console.log("\n=== AUTOTESTE DOCK MODEL CONCLUÍDO COM SUCESSO ===");
