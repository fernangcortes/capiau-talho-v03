// ======================================================================
// Autoteste: Operações de encaixe das colunas (F2b/F2c do plano drag & dock)
// Execução: node tests/autoteste_dock_ops.mjs
// ======================================================================

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ops = await import(pathToFileURL(path.join(rootDir, "src", "ui", "js", "dockOps.js")).href);
const { moveBeside, moveToEdge, stackWith, swapPanels, removeFromStack, normalizeStacks, stackGuests, syncOrderWithStacks, sameColumnState } = ops;

console.log("=== INICIANDO AUTOTESTE: DOCK OPS ===\n");

const L = "sidebar-left", I = "inspector-panel", C = "center-stage", R = "sidebar-right";
const padrao = { order: [L, I, C, R], stacks: [] };

// 1. Pôr ao lado e mandar para a ponta
assert.deepEqual(moveBeside(padrao, R, L, "before"), { order: [R, L, I, C], stacks: [] });
assert.deepEqual(moveBeside(padrao, I, C, "after"), { order: [L, C, I, R], stacks: [] });
assert.deepEqual(moveToEdge(padrao, L, "end"), { order: [I, C, R, L], stacks: [] });
assert.equal(moveBeside(padrao, L, L, "after"), null);
console.log("✔ 1 passou: pôr ao lado e mandar para a ponta.");

// 2. Empilhar (animação 1 do plano: Falas embaixo da Biblioteca)
const empilhado = stackWith(padrao, R, L, "bottom");
assert.deepEqual(empilhado, { order: [L, R, I, C], stacks: [[L, R]] });
assert.deepEqual(stackWith(padrao, R, L, "top"), { order: [R, L, I, C], stacks: [[R, L]] }, "em cima: Falas vira a anfitriã da coluna");
const tres = stackWith(empilhado, I, L, "bottom");
assert.deepEqual(tres.stacks, [[L, I, R]]);
assert.equal(stackWith(tres, R, L, "top") !== null, true, "reordenar dentro da pilha cheia é permitido (o painel sai antes)");
assert.equal(stackWith(padrao, C, L, "top"), null, "centro não empilha");
assert.equal(stackWith(padrao, L, C, "top"), null, "não empilha sobre o centro");
assert.deepEqual([...stackGuests(tres.stacks)], [I, R]);
console.log("✔ 2 passou: empilhar em cima/embaixo, pilha de até 3, centro fora das pilhas.");

// 3. Sair da pilha ao pôr ao lado, trocar e destacar
assert.deepEqual(moveBeside(empilhado, R, C, "after"), { order: [L, I, C, R], stacks: [] }, "sair da pilha desfaz a pilha de 2");
assert.deepEqual(moveBeside(empilhado, I, L, "after"), { order: [L, R, I, C], stacks: [[L, R]] }, "ao lado de um membro = ao lado da pilha inteira");
assert.deepEqual(moveBeside(empilhado, I, R, "before"), { order: [I, L, R, C], stacks: [[L, R]] });
assert.deepEqual(swapPanels(empilhado, R, I), { order: [L, I, R, C], stacks: [[L, I]] }, "trocar com membro da pilha troca a posição na pilha");
assert.deepEqual(removeFromStack(tres, L), { order: [I, R, L, C], stacks: [[I, R]] }, "tirar a anfitriã promove a próxima");
assert.deepEqual(removeFromStack(padrao, L), padrao);
console.log("✔ 3 passou: sair da pilha, pôr ao lado de membro, trocar e remover a anfitriã.");

// 4. Normalização
assert.deepEqual(normalizeStacks([[L], [R, R, I], [C, L], "x", [L, I]]), [[R, I]], "remove pilhas de 1, duplicados, centro e membros repetidos entre pilhas");
assert.deepEqual(syncOrderWithStacks([L, C, R, I], [[L, R]]), [L, R, C, I], "membros da pilha ficam juntos onde o primeiro estava");
assert.ok(sameColumnState(empilhado, { order: [L, R, I, C], stacks: [[L, R]] }));
console.log("✔ 4 passou: normalização e ordem contígua das pilhas.");

// 5. Invariantes em todas as sequências de 3 operações a partir do padrão
const all = [L, I, R];
const actions = [];
for (const id of all) {
    for (const target of [...all, C]) {
        actions.push(s => moveBeside(s, id, target, "before"), s => moveBeside(s, id, target, "after"));
        if (target !== C) actions.push(s => stackWith(s, id, target, "top"), s => stackWith(s, id, target, "bottom"), s => swapPanels(s, id, target));
    }
    actions.push(s => moveToEdge(s, id, "start"), s => moveToEdge(s, id, "end"), s => removeFromStack(s, id));
}
let checked = 0;
const check = (s) => {
    assert.deepEqual([...s.order].sort(), [L, I, C, R].sort(), "order continua com as 4 colunas");
    s.stacks.forEach(st => {
        const at = s.order.indexOf(st[0]);
        assert.deepEqual(s.order.slice(at, at + st.length), st, "pilha contígua e na ordem certa");
        assert.ok(st.length >= 2 && st.length <= 3 && !st.includes(C));
    });
    checked++;
};
for (const a of actions) {
    const s1 = a(padrao); if (!s1) continue; check(s1);
    for (const b of actions) {
        const s2 = b(s1); if (!s2) continue; check(s2);
        for (const c of actions) { const s3 = c(s2); if (s3) check(s3); }
    }
}
console.log(`✔ 5 passou: ${checked} estados gerados por sequências de até 3 operações respeitam as invariantes.`);

// 6. Faixas inteiras em cima/embaixo (F2c)
const { moveToBand, moveBesideInBand, setCorner, bandOf } = ops;
const faixa = moveToBand(padrao, I, "bottom");
assert.deepEqual(faixa, { order: [L, C, R, I], stacks: [], bands: { top: [], bottom: [I] }, corners: { bl: "band", br: "band" } },
    "Ajustes vai para a faixa de baixo; membros de faixa ficam no fim de order; faixa nova passa inteira pelos cantos");
const duas = moveToBand(faixa, L, "bottom", 0);
assert.deepEqual(duas.bands.bottom, [L, I], "vários painéis na mesma faixa, na posição escolhida");
assert.deepEqual(duas.order, [C, R, L, I]);
assert.deepEqual(moveBesideInBand(duas, R, L, "after").bands.bottom, [L, R, I]);
assert.deepEqual(moveBeside(duas, R, I, "before").bands.bottom, [L, R, I], "ao lado de um painel de faixa = dentro da faixa");
const cimaEBaixo = moveToBand(faixa, R, "top");
assert.deepEqual(cimaEBaixo.bands, { top: [R], bottom: [I] }, "faixa em cima e embaixo ao mesmo tempo");
assert.deepEqual(cimaEBaixo.corners, { tl: "band", tr: "band", bl: "band", br: "band" });
assert.deepEqual(moveToEdge(faixa, I, "start"), { order: [I, L, C, R], stacks: [] }, "sair da última vaga da faixa apaga a faixa e seus cantos");
assert.deepEqual(moveBeside(duas, I, C, "after").bands.bottom, [L]);
assert.deepEqual(moveBeside(duas, I, C, "after").order, [C, I, R, L]);
assert.equal(stackWith(faixa, L, I, "top"), null, "faixa não empilha");
assert.deepEqual(stackWith(faixa, I, L, "bottom"), { order: [L, I, C, R], stacks: [[L, I]] }, "sair da faixa para uma pilha");
const empilhadoNaFaixa = moveToBand(empilhado, R, "bottom");
assert.deepEqual(empilhadoNaFaixa.stacks, [], "sair da pilha para a faixa desfaz a pilha de 2");
console.log("✔ 6 passou: faixa nova, vários painéis, cima e baixo, sair da faixa, pilhas.");

// 7. Trocar dentro da faixa e entre coluna e faixa; cantos
assert.deepEqual(swapPanels(duas, L, I).bands.bottom, [I, L], "trocar de lugar dentro da faixa");
const troca = swapPanels(faixa, L, I);
assert.deepEqual(troca.order, [I, C, R, L]);
assert.equal(bandOf(troca.bands, L), "bottom", "trocar coluna com faixa: cada um ocupa o lugar do outro");
assert.equal(setCorner(padrao, "bl", "column"), null, "sem faixa embaixo não há canto embaixo");
const canto = setCorner(faixa, "bl", "column");
assert.deepEqual(canto.corners, { bl: "column", br: "band" });
assert.deepEqual(moveToBand(canto, L, "bottom").corners, { bl: "column", br: "band" }, "entrar numa faixa existente não mexe nos cantos");
assert.deepEqual(moveToBand(padrao, R, "top", null, { tr: "column" }).corners, { tl: "band", tr: "column" }, "faixa nova com canto escolhido no arrasto");
assert.ok(!sameColumnState(faixa, canto), "mudar um canto é mudança de layout");
console.log("✔ 7 passou: trocar na faixa, trocar coluna com faixa e cantos.");

// 8. Invariantes com faixas em todas as sequências de 3 operações
const bandActions = [...actions];
for (const id of all) {
    for (const edge of ["top", "bottom"]) bandActions.push(s => moveToBand(s, id, edge), s => moveToBand(s, id, edge, 0));
    for (const target of all) bandActions.push(s => moveBesideInBand(s, id, target, "before"));
}
bandActions.push(s => setCorner(s, "bl", "column"), s => setCorner(s, "tr", "column"));
let checkedBands = 0;
const checkBands = (s) => {
    check(s);
    const members = [...(s.bands?.top || []), ...(s.bands?.bottom || [])];
    assert.deepEqual(s.order.slice(s.order.length - members.length), members, "membros de faixa no fim de order, cima depois baixo");
    assert.equal(new Set(members).size, members.length, "painel em uma faixa só");
    s.stacks.forEach(st => st.forEach(id => assert.ok(!members.includes(id), "painel de faixa fora das pilhas")));
    if (s.bands) {
        assert.ok(s.bands.top.length || s.bands.bottom.length, "bands só com alguma faixa");
        assert.deepEqual(Object.keys(s.corners).sort(), [...(s.bands.top.length ? ["tl", "tr"] : []), ...(s.bands.bottom.length ? ["bl", "br"] : [])].sort());
    } else assert.equal(s.corners, undefined);
    checkedBands++;
};
for (const a of bandActions) {
    const s1 = a(padrao); if (!s1) continue; checkBands(s1);
    for (const b of bandActions) {
        const s2 = b(s1); if (!s2) continue; checkBands(s2);
        for (const c of bandActions) { const s3 = c(s2); if (s3) checkBands(s3); }
    }
}
console.log(`✔ 8 passou: ${checkedBands} estados com faixas respeitam as invariantes.`);

// 9. Timeline em faixa (F2c parte 2)
const { placeTimeline, timelineToCenter, toggleTimelineSide, timelineExpanded, timelineIsColumn } = ops;
const T = "timeline-panel";
const full = placeTimeline(padrao, "bottom-full");
assert.deepEqual(full, { order: [L, I, C, R], stacks: [], bands: { top: [], bottom: [T] }, corners: { bl: "band", br: "band" } },
    "timeline na faixa de baixo não entra em order");
assert.deepEqual(placeTimeline(padrao, "bottom-left").corners, { bl: "band", br: "column" }, "sob a esquerda = a direita vai até o fim");
assert.deepEqual(placeTimeline(padrao, "bottom-right").corners, { bl: "column", br: "band" });
assert.deepEqual(placeTimeline(padrao, "band"), full, "\"band\" fora de faixa = largura total");
assert.deepEqual(placeTimeline(full, "center"), padrao);
assert.deepEqual(timelineToCenter(faixa), faixa, "sem timeline na faixa, nada muda");
const comAjustes = placeTimeline(faixa, "bottom-left");
assert.deepEqual(comAjustes.bands.bottom, [T, I], "entra na frente de quem já está na faixa de baixo");
const naVaga = moveToBand(faixa, T, "bottom", 1);
assert.deepEqual(placeTimeline(naVaga, "bottom-right").bands.bottom, [I, T], "já na faixa de baixo: fica na mesma vaga, só mudam os cantos");
const emCima = moveToBand(padrao, T, "top");
assert.deepEqual(placeTimeline(emCima, "band"), emCima, "\"band\" já numa faixa não mexe");
assert.deepEqual(placeTimeline(emCima, "bottom-full").bands, { top: [], bottom: [T] }, "posição antiga leva para a faixa de baixo");
assert.equal(placeTimeline(padrao, "lado"), null);

// Atalhos: mesmo ciclo das posições antigas (Numpad1 = esquerda, Numpad3 = direita, Numpad2 = centro ↔ total).
const nome = (s) => {
    if (bandOf(s.bands, T) !== "bottom") return bandOf(s.bands, T) ? "outra" : "center";
    return { "band,band": "bottom-full", "band,column": "bottom-left", "column,band": "bottom-right", "column,column": "sob o centro" }[`${s.corners.bl},${s.corners.br}`];
};
const cicloAntigo = {
    left: { "center": "bottom-left", "bottom-left": "center", "bottom-full": "bottom-right", "bottom-right": "bottom-full" },
    right: { "center": "bottom-right", "bottom-right": "center", "bottom-full": "bottom-left", "bottom-left": "bottom-full" }
};
for (const side of ["left", "right"]) {
    for (const [de, para] of Object.entries(cicloAntigo[side])) {
        assert.equal(nome(toggleTimelineSide(placeTimeline(padrao, de), side)), para, `${side} a partir de ${de}`);
    }
}
assert.equal(nome(toggleTimelineSide(placeTimeline(padrao, "bottom-left"), "right")), "bottom-full");
assert.ok(timelineExpanded(full, "left") && timelineExpanded(full, "right"));
assert.ok(!timelineExpanded(padrao, "left"), "no centro não está expandida");
const soCentro = setCorner(setCorner(full, "bl", "column"), "br", "column");
assert.equal(nome(toggleTimelineSide(soCentro, "left")), "bottom-left", "sob o centro só: expandir abre o lado");
const cimaDireita = toggleTimelineSide(setCorner(emCima, "tr", "column"), "right");
assert.deepEqual([cimaDireita.bands.top, cimaDireita.corners], [[T], { tl: "band", tr: "band" }], "na faixa de cima os atalhos mexem nos cantos de cima");
assert.deepEqual(toggleTimelineSide(comAjustes, "left").bands, { top: [], bottom: [I] }, "recolher o único lado leva ao centro; os outros ficam na faixa");

// Timeline como coluna: ponta, ao lado de coluna ou do centro, troca com coluna; nunca em pilha.
assert.deepEqual(moveToEdge(full, T, "start"), { order: [T, L, I, C, R], stacks: [] }, "da faixa para a ponta esquerda");
assert.deepEqual(moveBeside(full, T, L, "after").order, [L, T, I, C, R]);
assert.deepEqual(moveBeside(padrao, T, C, "before").order, [L, I, T, C, R], "do centro para uma coluna");
assert.ok(timelineIsColumn(moveBeside(padrao, T, C, "before")) && !timelineIsColumn(full) && !timelineIsColumn(padrao));
const troca2 = swapPanels(full, T, L);
assert.deepEqual([troca2.order, troca2.bands.bottom], [[T, I, C, R, L], [L]], "timeline (faixa) troca com coluna: cada um no lugar do outro");
assert.equal(swapPanels(padrao, T, L), null, "timeline embaixo dos monitores não tem vaga para trocar");
assert.equal(swapPanels(moveBeside(empilhado, T, C, "after"), T, R), null, "timeline não entra em pilha trocando");
assert.equal(stackWith(full, T, L, "top"), null);
assert.equal(stackWith(full, L, T, "top"), null);
const tlCol = placeTimeline(padrao, "column");
assert.deepEqual(tlCol.order, [L, I, C, T, R], "\"column\" = à direita do centro");
assert.deepEqual(placeTimeline(moveToEdge(padrao, T, "start"), "column").order, [T, L, I, C, R], "já coluna: fica onde está");
assert.deepEqual(timelineToCenter(tlCol), padrao, "da coluna de volta para baixo dos monitores");
assert.deepEqual(placeTimeline(tlCol, "bottom-full"), full, "da coluna para a faixa de baixo");
assert.equal(toggleTimelineSide(tlCol, "left").bands.bottom[0], T, "atalhos da coluna levam para a faixa");
assert.deepEqual(moveBeside(tlCol, R, T, "before").order, [L, I, C, R, T], "lateral ao lado da timeline coluna");
assert.deepEqual(swapPanels(comAjustes, T, I).bands.bottom, [I, T], "dentro da faixa troca normal");
const lateralAoLado = moveBeside(full, R, T, "after");
assert.deepEqual([lateralAoLado.bands.bottom, lateralAoLado.order], [[T, R], [L, I, C, R]], "lateral ao lado da timeline na faixa");
const ladoAlado = moveBesideInBand(comAjustes, T, I, "after");
assert.deepEqual(ladoAlado.bands.bottom, [I, T]);
console.log("✔ 9 passou: posições antigas viram faixa, atalhos com o ciclo de antes, timeline como coluna (sem pilha).");

// 10. Invariantes com a timeline nas sequências de 3 operações
const tlActions = [...bandActions,
    s => placeTimeline(s, "bottom-full"), s => placeTimeline(s, "bottom-left"), s => placeTimeline(s, "center"),
    s => moveToBand(s, T, "top"), s => moveToBand(s, T, "bottom", 0),
    s => toggleTimelineSide(s, "left"), s => toggleTimelineSide(s, "right"),
    s => moveToEdge(s, T, "start"), s => moveToEdge(s, T, "end"), s => placeTimeline(s, "column"),
    s => moveBeside(s, T, C, "before"), s => swapPanels(s, T, C),
    ...all.map(id => s => swapPanels(s, T, id)), ...all.map(id => s => moveBeside(s, T, id, "after")),
    ...all.map(id => s => moveBeside(s, id, T, "before")), ...all.map(id => s => stackWith(s, id, T, "bottom"))];
let checkedTl = 0;
const checkTl = (s) => {
    const onde = ["top", "bottom"].filter(edge => s.bands?.[edge]?.includes(T));
    assert.ok(onde.length + (s.order.includes(T) ? 1 : 0) <= 1, "timeline num lugar só (uma faixa ou coluna)");
    assert.equal(s.order.filter(id => id === T).length <= 1, true);
    s.stacks.forEach(st => assert.ok(!st.includes(T), "timeline nunca em pilha"));
    const semTl = { ...s, order: s.order.filter(id => id !== T) };
    if (s.bands) {
        semTl.bands = { top: s.bands.top.filter(id => id !== T), bottom: s.bands.bottom.filter(id => id !== T) };
        if (!semTl.bands.top.length && !semTl.bands.bottom.length) { delete semTl.bands; delete semTl.corners; }
        else semTl.corners = Object.fromEntries(Object.entries(s.corners).filter(([k]) => semTl.bands[k[0] === "t" ? "top" : "bottom"].length));
    }
    checkBands(semTl);
    checkedTl++;
};
for (const a of tlActions) {
    const s1 = a(padrao); if (!s1) continue; checkTl(s1);
    for (const b of tlActions) {
        const s2 = b(s1); if (!s2) continue; checkTl(s2);
        for (const c of tlActions) { const s3 = c(s2); if (s3) checkTl(s3); }
    }
}
console.log(`✔ 10 passou: ${checkedTl} estados com a timeline em faixa ou coluna respeitam as invariantes.`);

console.log("\n=== AUTOTESTE DOCK OPS CONCLUÍDO COM SUCESSO ===");
