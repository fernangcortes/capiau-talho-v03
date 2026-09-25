// ======================================================================
// Autoteste: Operações de encaixe das colunas (F2b do plano drag & dock)
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

console.log("\n=== AUTOTESTE DOCK OPS CONCLUÍDO COM SUCESSO ===");
