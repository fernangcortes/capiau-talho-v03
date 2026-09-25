// Operações de encaixe das colunas laterais (fase F2b do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// Funções puras sobre { order, stacks }:
//   order  = ordem das colunas do editor (ids das laterais + "center-stage"), como columnOrder;
//   stacks = pilhas de laterais numa mesma coluna, de cima para baixo (ex.: [["sidebar-left", "sidebar-right"]]).
// O primeiro painel da pilha é o "anfitrião": ocupa a coluna e recebe os demais embaixo dele.
// Toda operação devolve um estado novo e normalizado (membros de uma pilha ficam juntos em order)
// ou null quando o encaixe não é possível.

import { COLUMN_IDS } from "./dockModel.js";

export const MAX_STACK = 3;

export function normalizeStacks(stacks) {
    const seen = new Set();
    const result = [];
    (Array.isArray(stacks) ? stacks : []).forEach(stack => {
        if (!Array.isArray(stack)) return;
        const members = stack.filter((id, i) => COLUMN_IDS.includes(id) && !seen.has(id) && stack.indexOf(id) === i);
        if (members.length < 2) return;
        members.slice(0, MAX_STACK).forEach(id => seen.add(id));
        result.push(members.slice(0, MAX_STACK));
    });
    return result;
}

export function stackOf(stacks, id) {
    return (stacks || []).find(stack => stack.includes(id)) || null;
}

/** Painéis que estão embaixo de outro numa pilha (não ocupam coluna própria). */
export function stackGuests(stacks) {
    return new Set((stacks || []).flatMap(stack => stack.slice(1)));
}

/** Coloca os membros de cada pilha juntos, na ordem da pilha, onde o primeiro deles estava. */
export function syncOrderWithStacks(order, stacks) {
    let out = [...order];
    (stacks || []).forEach(stack => {
        const positions = stack.map(id => out.indexOf(id)).filter(i => i >= 0);
        if (positions.length === 0) return;
        const at = Math.min(...positions);
        const before = out.slice(0, at).filter(id => !stack.includes(id));
        const after = out.slice(at).filter(id => !stack.includes(id));
        out = [...before, ...stack.filter(id => order.includes(id)), ...after];
    });
    return out;
}

function finalize(order, stacks) {
    const normalized = normalizeStacks(stacks);
    return { order: syncOrderWithStacks(order, normalized), stacks: normalized };
}

function detach(state, id) {
    return {
        order: [...state.order],
        stacks: normalizeStacks((state.stacks || []).map(stack => stack.filter(member => member !== id)))
    };
}

/** Tira um painel da pilha em que está (ele volta a ter coluna própria, logo depois da pilha). */
export function removeFromStack(state, id) {
    const stack = stackOf(state.stacks, id);
    if (!stack) return finalize(state.order, state.stacks);
    const s = detach(state, id);
    const rest = stack.filter(member => member !== id);
    const order = s.order.filter(x => x !== id);
    order.splice(Math.max(...rest.map(member => order.indexOf(member))) + 1, 0, id);
    return finalize(order, s.stacks);
}

/** Põe o painel ao lado ("before" = à esquerda, "after" = à direita) da coluna de targetId. */
export function moveBeside(state, id, targetId, side) {
    if (id === targetId) return null;
    const s = detach(state, id);
    const block = stackOf(s.stacks, targetId) || [targetId];
    const order = s.order.filter(x => x !== id);
    const positions = block.map(b => order.indexOf(b)).filter(i => i >= 0);
    if (positions.length === 0) return null;
    order.splice(side === "before" ? Math.min(...positions) : Math.max(...positions) + 1, 0, id);
    return finalize(order, s.stacks);
}

/** Leva o painel para a ponta esquerda ("start") ou direita ("end") do editor. */
export function moveToEdge(state, id, edge) {
    const s = detach(state, id);
    const order = s.order.filter(x => x !== id);
    if (edge === "start") order.unshift(id);
    else order.push(id);
    return finalize(order, s.stacks);
}

/** Empilha o painel acima ("top") ou abaixo ("bottom") de targetId, na mesma coluna. */
export function stackWith(state, id, targetId, where) {
    if (id === targetId || !COLUMN_IDS.includes(id) || !COLUMN_IDS.includes(targetId)) return null;
    const s = detach(state, id);
    const stacks = s.stacks.map(stack => [...stack]);
    let stack = stacks.find(st => st.includes(targetId));
    if (!stack) {
        stack = [targetId];
        stacks.push(stack);
    }
    if (stack.length >= MAX_STACK) return null;
    stack.splice(stack.indexOf(targetId) + (where === "top" ? 0 : 1), 0, id);
    const order = s.order.filter(x => x !== id);
    order.splice(order.indexOf(targetId) + 1, 0, id);
    return finalize(order, stacks);
}

/** Troca dois painéis de lugar (também dentro de pilhas). */
export function swapPanels(state, a, b) {
    if (a === b) return null;
    const swap = (x) => (x === a ? b : x === b ? a : x);
    return finalize(state.order.map(swap), (state.stacks || []).map(stack => stack.map(swap)));
}

export function sameColumnState(a, b) {
    return !!a && !!b && a.order.join() === b.order.join() && JSON.stringify(a.stacks) === JSON.stringify(b.stacks);
}
