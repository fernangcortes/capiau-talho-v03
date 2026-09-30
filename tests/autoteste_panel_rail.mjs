// ======================================================================
// Autoteste: barra fina dos painéis (src/ui/js/panelRail.js)
// Execução: node tests/autoteste_panel_rail.mjs
//
// Três estados: aberta → barra → linha. A linha volta ao estado de antes. Vale em coluna,
// pilha e faixa do editor; numa janela destacada a seta recolhe direto para a linha.
// ======================================================================

import assert from "node:assert/strict";
import { nextOnArrow, loadRail, saveRail, stripTabs, RAIL_PANELS, RAIL_STORAGE_KEY, RAIL_PLACES, railLying, railArrowIcon, uprightTabs, PanelRail } from "../src/ui/js/panelRail.js";

console.log("=== INICIANDO AUTOTESTE: BARRA FINA ===\n");

{
    assert.equal(nextOnArrow("aberta", true), "barra", "numa coluna, a seta vai para a barra");
    assert.equal(nextOnArrow("barra", true), "linha", "da barra, para a linha");
    assert.equal(nextOnArrow("aberta", false), "linha", "janela destacada: direto para a linha, como antes");
    assert.equal(nextOnArrow("linha", true), "linha");
}
console.log("✔ 1 passou: aberta → barra → linha.");

{
    const mem = new Map();
    const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    assert.deepEqual([...loadRail(storage)], ["inspector-panel"], "nada salvo: Ajustes começa na barra");
    saveRail(storage, new Set());
    assert.deepEqual([...loadRail(storage)], [], "escolha salva (nenhuma barra) vale mais que o padrão");
    saveRail(storage, new Set(["sidebar-left", "timeline-panel", "sidebar-right"]));
    assert.deepEqual(JSON.parse(mem.get(RAIL_STORAGE_KEY)), ["sidebar-left", "sidebar-right"], "só painéis com barra");
    assert.deepEqual([...loadRail(storage)], ["sidebar-left", "sidebar-right"]);
    mem.set(RAIL_STORAGE_KEY, "{quebrado");
    assert.deepEqual([...loadRail(storage)], [], "JSON quebrado não derruba o app");
}
console.log("✔ 2 passou: estado salvo.");

{
    const btn = (attrs, style = {}) => ({
        style, hidden: false, textContent: attrs.text || "",
        classList: { contains: c => (attrs.cls || "").split(" ").includes(c) },
        getAttribute: k => attrs[k] ?? null,
        querySelector: () => ({ className: attrs.icon }),
    });
    const strip = {
        querySelectorAll: () => [
            btn({ title: "Mídias", icon: "fa-solid fa-photo-film", cls: "tab-btn active" }),
            btn({ title: "Temas", icon: "fa-solid fa-tags", cls: "tab-btn" }, { display: "none" }),
            btn({ "data-tooltip": "Rostos", icon: "fa-solid fa-user-friends", cls: "tab-btn" }),
        ],
    };
    const tabs = stripTabs(strip);
    assert.deepEqual(tabs.map(t => [t.label, t.active]), [["Mídias", true], ["Rostos", false]], "aba escondida não entra; dica vale como nome");
    assert.equal(tabs[0].icon, "fa-solid fa-photo-film");
    assert.deepEqual(stripTabs(null), []);
}
console.log("✔ 3 passou: botões da barra = abas visíveis da faixa.");

{
    for (const [id, cfg] of Object.entries(RAIL_PANELS)) {
        assert.ok(cfg.toggle && cfg.icon && cfg.label, `${id} completo`);
    }
}
console.log("✔ 4 passou: painéis com barra configurados.");

{
    // Onde a barra existe e como ela fica.
    assert.deepEqual(RAIL_PLACES, ["column", "stack", "band"]);
    assert.equal(railLying("column"), false, "coluna: em pé");
    assert.equal(railLying("stack"), true, "pilha: deitada, entre os vizinhos de cima e de baixo");
    assert.equal(railLying("band"), false, "faixa: em pé entre os vizinhos");
    assert.equal(railLying("band", true), true, "faixa com todos na barra: deitada, e a faixa encolhe");
    assert.equal(railArrowIcon("up"), "fa-chevron-up");
    assert.equal(railArrowIcon("down"), "fa-chevron-down");
    assert.equal(railArrowIcon(null, true), "fa-chevron-right", "coluna da direita");
    assert.equal(railArrowIcon(null), "fa-chevron-left");

    // canRail: coluna, pilha e faixa desta janela; janela destacada não.
    const doc = {};
    globalThis.document = doc;
    const mk = (kind, ownerDocument = doc) => ({ panelPlacement: () => ({ kind, el: { ownerDocument } }) });
    const rail = (wm) => Object.assign(Object.create(PanelRail.prototype), { wm });
    for (const kind of ["column", "stack", "band"]) assert.equal(rail(mk(kind)).canRail("sidebar-left"), true, kind);
    assert.equal(rail(mk("single", {})).canRail("sidebar-left"), false, "janela destacada");
    assert.equal(rail(mk("group", {})).canRail("sidebar-left"), false, "janela com vários painéis");
    assert.equal(rail({ panelPlacement: () => null }).canRail("sidebar-left"), false, "sem lugar");
}
console.log("✔ 5 passou: barra em coluna, pilha e faixa; deitada na pilha e na faixa toda na barra.");

{
    // Abas em pé: só no painel aberto numa coluna, com faixa de abas.
    assert.equal(uprightTabs("pe", "aberta", "column", true), true);
    assert.equal(uprightTabs("linha", "aberta", "column", true), false, "padrão: abas em linha");
    assert.equal(uprightTabs("pe", "barra", "column", true), false, "na barra já é a barra");
    assert.equal(uprightTabs("pe", "aberta", "stack", true), false, "na pilha a barra deita: seria outra faixa de abas");
    assert.equal(uprightTabs("pe", "aberta", "column", false), false, "Ajustes não tem faixa de abas");
}
console.log("✔ 6 passou: abas em pé no painel aberto numa coluna.");

console.log("\n=== AUTOTESTE BARRA FINA CONCLUÍDO COM SUCESSO ===");
