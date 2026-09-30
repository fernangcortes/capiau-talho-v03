// ======================================================================
// Autoteste: barra fina dos painéis (src/ui/js/panelRail.js)
// Execução: node tests/autoteste_panel_rail.mjs
//
// Três estados por coluna: aberta → barra → linha. A linha volta ao estado de antes;
// fora de uma coluna do editor não existe barra e a seta recolhe direto para a linha.
// ======================================================================

import assert from "node:assert/strict";
import { nextOnArrow, loadRail, saveRail, stripTabs, RAIL_PANELS, RAIL_STORAGE_KEY } from "../src/ui/js/panelRail.js";

console.log("=== INICIANDO AUTOTESTE: BARRA FINA ===\n");

{
    assert.equal(nextOnArrow("aberta", true), "barra", "numa coluna, a seta vai para a barra");
    assert.equal(nextOnArrow("barra", true), "linha", "da barra, para a linha");
    assert.equal(nextOnArrow("aberta", false), "linha", "pilha/faixa/janela: direto para a linha, como antes");
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

console.log("\n=== AUTOTESTE BARRA FINA CONCLUÍDO COM SUCESSO ===");
