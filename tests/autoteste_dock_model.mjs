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

// F2c parte 2: as posições antigas da timeline voltam como a faixa de baixo (timeline na frente),
// com os cantos que davam o mesmo desenho. "center" volta igual.
const CANTOS_ANTIGOS = {
    "bottom-full": { bl: "band", br: "band" },
    "bottom-left": { bl: "band", br: "column" },
    "bottom-right": { bl: "column", br: "band" }
};
const esperado = (state) => {
    if (!CANTOS_ANTIGOS[state.timelinePosition]) return state;
    const top = state.bands?.top || [];
    const topCorners = top.length ? { tl: state.bandCorners?.tl || "band", tr: state.bandCorners?.tr || "band" } : {};
    return {
        ...state,
        timelinePosition: "band",
        bands: { top, bottom: ["timeline-panel", ...(state.bands?.bottom || [])] },
        bandCorners: { ...topCorners, ...CANTOS_ANTIGOS[state.timelinePosition] }
    };
};

let combos = 0;
for (const columnOrder of orders) {
    for (const timelinePosition of positions) {
        for (const monitorsLayout of monitors) {
            const state = { columnOrder, timelinePosition, monitorsLayout, columnStacks: [], popped: [], dual: null, group: null };
            const layout = layoutFromLegacy(state);
            assert.deepEqual(validateLayout(layout), [], `layout inválido para ${JSON.stringify(state)}`);
            const volta = legacyFromLayout(layout);
            assert.deepEqual(volta, esperado(state), `ida e volta falhou para ${JSON.stringify(state)}`);
            assert.deepEqual(legacyFromLayout(layoutFromLegacy(volta)), volta, "o formato novo vai e volta igual");
            combos++;
        }
    }
}
console.log(`✔ 1.1 passou: ${combos} combinações (24 ordens × 4 posições da timeline × 3 monitores) vão e voltam (antigas viram faixa).`);

const presets = {
    padrao: ["sidebar-left", "inspector-panel", CENTER_STAGE, "sidebar-right"],
    inspetorDireita: ["sidebar-left", CENTER_STAGE, "inspector-panel", "sidebar-right"]
};
for (const [name, columnOrder] of Object.entries(presets)) {
    const popped = ["timeline-panel", "program-player-panel"];
    const state = { columnOrder, timelinePosition: "bottom-full", monitorsLayout: "stacked", columnStacks: [], popped, dual: null, group: null };
    const layout = layoutFromLegacy(state);
    assert.deepEqual(validateLayout(layout), [], `preset ${name} com janelas destacadas inválido`);
    assert.deepEqual(legacyFromLayout(layout), esperado(state));
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
                assert.deepEqual(legacyFromLayout(layout), esperado(state), `pilha não voltou igual: ${JSON.stringify(state)}`);
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
        assert.deepEqual(legacyFromLayout(layout), esperado(state), `grupo não voltou igual: ${panels}`);
        panels.forEach(id => assert.ok(panelsIn(layout.main, { includeAway: true }).includes(id), `lugar de ${id} guardado no editor`));
    }
    const five = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", group: { panels: ["sidebar-left", "inspector-panel", "sidebar-right", "source-player-panel", "program-player-panel"], arrangement: "grid" } });
    assert.ok(validateLayout(five).some(e => e.includes("máximo 4")), "grupo com 5 painéis é inválido");
    console.log("✔ 1.5 passou: janelas com 2–4 painéis (qualquer tipo) e disposição vão e voltam; 5 é inválido.");
}

{
    // F2c: faixas inteiras em cima/embaixo, com cantos, em todas as posições da timeline.
    const L = "sidebar-left", I = "inspector-panel", R = "sidebar-right";
    let n = 0;
    const casos = [
        { bands: { top: [], bottom: [I] }, bandCorners: { bl: "band", br: "column" }, cols: [L, CENTER_STAGE, R] },
        { bands: { top: [R], bottom: [L] }, bandCorners: { tl: "column", tr: "band", bl: "band", br: "band" }, cols: [CENTER_STAGE, I] },
        { bands: { top: [L, R], bottom: [] }, bandCorners: { tl: "band", tr: "band" }, cols: [I, CENTER_STAGE] }
    ];
    for (const caso of casos) {
        for (const timelinePosition of positions) {
            const columnOrder = [...caso.cols, ...caso.bands.top, ...caso.bands.bottom];
            const state = { columnOrder, timelinePosition, monitorsLayout: "auto", columnStacks: [], popped: [], dual: null, group: null, bands: caso.bands, bandCorners: caso.bandCorners };
            const layout = layoutFromLegacy(state);
            assert.deepEqual(validateLayout(layout), [], `faixas inválidas: ${JSON.stringify(state)}`);
            assert.equal(layout.main.role, "frame");
            assert.deepEqual(legacyFromLayout(layout), esperado(state), `faixas não voltaram iguais: ${JSON.stringify(state)}`);
            n++;
        }
    }
    const destacado = layoutFromLegacy({ columnOrder: [L, CENTER_STAGE, R, I], timelinePosition: "center", monitorsLayout: "auto", popped: [I], bands: { top: [], bottom: [I] } });
    assert.deepEqual(validateLayout(destacado), []);
    assert.deepEqual(destacado.main.children[1], { split: "row", role: "band", edge: "bottom", children: [{ panel: I, away: true }] }, "painel de faixa destacado guarda o lugar na faixa");
    assert.equal(legacyFromLayout(destacado).bands.bottom[0], I);
    const semFaixa = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", bands: { top: [], bottom: [] } });
    assert.notEqual(semFaixa.main.role, "frame", "faixas vazias não criam moldura");
    assert.equal(legacyFromLayout(semFaixa).bands, undefined);
    console.log(`✔ 1.6 passou: ${n} layouts com faixas e cantos vão e voltam; painel destacado guarda o lugar na faixa.`);
}

{
    // F2c parte 2: timeline numa faixa, sozinha ou com laterais, em cima ou embaixo.
    const L = "sidebar-left", I = "inspector-panel", R = "sidebar-right", T = "timeline-panel";
    const casos = [
        { bands: { top: [], bottom: [T] }, bandCorners: { bl: "column", br: "column" }, cols: [L, I, CENTER_STAGE, R] },
        { bands: { top: [T, R], bottom: [] }, bandCorners: { tl: "band", tr: "column" }, cols: [L, CENTER_STAGE, I] },
        { bands: { top: [L], bottom: [I, T] }, bandCorners: { tl: "band", tr: "band", bl: "column", br: "band" }, cols: [CENTER_STAGE, R] }
    ];
    for (const caso of casos) {
        const state = { columnOrder: [...caso.cols, ...[...caso.bands.top, ...caso.bands.bottom].filter(id => id !== T)], timelinePosition: "band", monitorsLayout: "auto", columnStacks: [], popped: [], dual: null, group: null, bands: caso.bands, bandCorners: caso.bandCorners };
        const layout = layoutFromLegacy(state);
        assert.deepEqual(validateLayout(layout), [], `timeline em faixa inválida: ${JSON.stringify(state)}`);
        const center = layout.main.children.find(c => c.role !== "band").children.find(c => c.role === "center");
        assert.deepEqual(panelsIn(center), ["source-player-panel", "program-player-panel"], "com a timeline na faixa, o centro fica só com os monitores");
        assert.deepEqual(legacyFromLayout(layout), state, `timeline em faixa não voltou igual: ${JSON.stringify(state)}`);
    }
    // As faixas mandam: timeline numa faixa com a posição dizendo "center" é "band".
    const manda = legacyFromLayout(layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "center", monitorsLayout: "auto", bands: { top: [T], bottom: [] } }));
    assert.equal(manda.timelinePosition, "band");
    // "band" sem timeline em faixa (estado torto): faixa de baixo inteira.
    const torto = legacyFromLayout(layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "band", monitorsLayout: "auto" }));
    assert.deepEqual([torto.bands, torto.bandCorners], [{ top: [], bottom: [T] }, { bl: "band", br: "band" }]);
    // Timeline destacada de uma faixa guarda o lugar nela.
    const fora = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "band", monitorsLayout: "auto", popped: [T], bands: { top: [], bottom: [T] } });
    assert.deepEqual(validateLayout(fora), []);
    assert.deepEqual(fora.main.children[1].children, [{ panel: T, away: true }]);
    // Histórico antigo (árvore com a timeline embaixo, sem faixa) ainda é lido e vira faixa.
    const antiga = { v: 1, floats: [], main: { split: "column", children: [
        { split: "row", children: [{ panel: L }, { panel: I }, { split: "column", role: "center", children: [{ split: "row", role: "monitors", auto: true, children: [{ panel: "source-player-panel" }, { panel: "program-player-panel" }] }] }, { panel: R }] },
        { panel: T }
    ] } };
    assert.deepEqual(legacyFromLayout(antiga).bands, { top: [], bottom: [T] });
    assert.equal(legacyFromLayout(antiga).timelinePosition, "band");
    // Timeline na faixa e embaixo dos monitores ao mesmo tempo: a árvore não é representável.
    const dupla = layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "band", monitorsLayout: "auto", bands: { top: [], bottom: [T] } });
    dupla.main.children[0].children.find(c => c.role === "center").children.push({ panel: T });
    assert.equal(legacyFromLayout(dupla), null);
    // Timeline como coluna: folha direta da linha do editor, em qualquer vaga, com pilhas e faixas.
    for (const [columnOrder, extra] of [
        [[T, L, I, CENTER_STAGE, R], {}],
        [[L, CENTER_STAGE, T, R, I], {}],
        [[L, R, CENTER_STAGE, T, I], { columnStacks: [[L, R]] }],
        [[I, CENTER_STAGE, T, R, L], { bands: { top: [], bottom: [L] }, bandCorners: { bl: "band", br: "column" } }]
    ]) {
        const state = { columnOrder, timelinePosition: "column", monitorsLayout: "auto", columnStacks: [], popped: [], dual: null, group: null, ...extra };
        const layout = layoutFromLegacy(state);
        assert.deepEqual(validateLayout(layout), [], `timeline coluna inválida: ${JSON.stringify(state)}`);
        const row = layout.main.role === "frame" ? layout.main.children.find(c => c.role !== "band") : layout.main;
        assert.ok(row.children.some(c => c.panel === T), "timeline é folha da linha do editor");
        assert.deepEqual(legacyFromLayout(layout), state, `timeline coluna não voltou igual: ${JSON.stringify(state)}`);
    }
    // columnOrder manda: a posição "column" sem a timeline em columnOrder é "center"; faixa vence coluna.
    assert.equal(legacyFromLayout(layoutFromLegacy({ columnOrder: presets.padrao, timelinePosition: "column", monitorsLayout: "auto" })).timelinePosition, "center");
    const ambos = legacyFromLayout(layoutFromLegacy({ columnOrder: [T, ...presets.padrao], timelinePosition: "column", monitorsLayout: "auto", bands: { top: [T], bottom: [] } }));
    assert.deepEqual([ambos.timelinePosition, ambos.columnOrder], ["band", presets.padrao]);
    console.log("✔ 1.7 passou: timeline em faixa (cima/baixo, com laterais, cantos livres) ou coluna vai e volta; árvores antigas viram faixa.");
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
    assert.deepEqual(legacyFromLayout(h.undo()).bandCorners, { bl: "band", br: "band" });
    assert.equal(legacyFromLayout(h.undo()).timelinePosition, "center");
    assert.equal(h.undo(), null, "nada além da linha de base");
    assert.deepEqual(legacyFromLayout(h.redo()).bandCorners, { bl: "band", br: "band" });
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
