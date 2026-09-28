// Operações de encaixe das colunas laterais (fase F2b do plano docs/PLANO_JANELAS_DRAG_DOCK.md).
// Funções puras sobre { order, stacks, bands?, corners? }:
//   order   = ordem das colunas do editor (ids das laterais + "center-stage"), como columnOrder;
//   stacks  = pilhas de laterais numa mesma coluna, de cima para baixo (ex.: [["sidebar-left", "sidebar-right"]]);
//   bands   = faixas inteiras em cima/embaixo do editor (F2c): { top: [...], bottom: [...] }, da esquerda
//             para a direita. Laterais de faixa continuam em order, sempre no fim, e não ocupam coluna.
//             A timeline (F2c parte 2) fica em order quando é coluna; numa faixa ou embaixo dos
//             monitores, não está em order. Nunca entra em pilha;
//   corners = quem fica com cada canto entre a coluna da ponta e a faixa ({ tl, tr, bl, br }:
//             "band" = a faixa passa inteira; "column" = a coluna vai até o fim e a faixa encurta).
// bands/corners só aparecem no resultado quando existe alguma faixa.
// O primeiro painel da pilha é o "anfitrião": ocupa a coluna e recebe os demais embaixo dele.
// Toda operação devolve um estado novo e normalizado (membros de uma pilha ficam juntos em order)
// ou null quando o encaixe não é possível.

import { COLUMN_IDS, BAND_EDGES, BAND_PANEL_IDS, CORNERS, TIMELINE_ID, LEGACY_TIMELINE_CORNERS, normalizeBands, hasBands } from "./dockModel.js";

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

/** Faixa em que o painel está ("top" | "bottom") ou null. */
export function bandOf(bands, id) {
    return BAND_EDGES.find(edge => Array.isArray(bands?.[edge]) && bands[edge].includes(id)) || null;
}

export function bandMembers(bands) {
    return new Set(BAND_EDGES.flatMap(edge => (Array.isArray(bands?.[edge]) ? bands[edge] : [])));
}

function finalize(order, stacks, bands, corners) {
    const nb = normalizeBands(bands, corners);
    const members = bandMembers(nb.bands);
    const normalized = normalizeStacks((stacks || []).map(stack => stack.filter(id => !members.has(id))));
    const cols = syncOrderWithStacks(order.filter(id => !members.has(id)), normalized);
    const laterals = [...nb.bands.top, ...nb.bands.bottom].filter(id => id !== TIMELINE_ID);
    const out = { order: [...cols, ...laterals], stacks: normalized };
    if (hasBands(nb.bands)) {
        out.bands = nb.bands;
        out.corners = nb.corners;
    }
    return out;
}

const cloneBands = (state) => ({ top: [...(state.bands?.top || [])], bottom: [...(state.bands?.bottom || [])] });

function detach(state, id) {
    const bands = cloneBands(state);
    BAND_EDGES.forEach(edge => { bands[edge] = bands[edge].filter(member => member !== id); });
    return {
        order: [...state.order],
        stacks: normalizeStacks((state.stacks || []).map(stack => stack.filter(member => member !== id))),
        bands,
        corners: { ...(state.corners || {}) }
    };
}

/** Ordem só das colunas (sem os membros de faixa), onde as operações de coluna trabalham. */
const columnsOnly = (s) => s.order.filter(x => !bandMembers(s.bands).has(x));

/** Tira um painel da pilha em que está (ele volta a ter coluna própria, logo depois da pilha). */
export function removeFromStack(state, id) {
    const stack = stackOf(state.stacks, id);
    if (!stack) return finalize(state.order, state.stacks, state.bands, state.corners);
    const s = detach(state, id);
    const rest = stack.filter(member => member !== id);
    const order = s.order.filter(x => x !== id);
    order.splice(Math.max(...rest.map(member => order.indexOf(member))) + 1, 0, id);
    return finalize(order, s.stacks, s.bands, s.corners);
}

/** Põe o painel ao lado ("before" = à esquerda, "after" = à direita) da coluna de targetId. */
export function moveBeside(state, id, targetId, side) {
    if (id === targetId) return null;
    if (bandOf(state.bands, targetId)) return moveBesideInBand(state, id, targetId, side);
    const s = detach(state, id);
    const block = stackOf(s.stacks, targetId) || [targetId];
    const order = columnsOnly(s).filter(x => x !== id);
    const positions = block.map(b => order.indexOf(b)).filter(i => i >= 0);
    if (positions.length === 0) return null;
    order.splice(side === "before" ? Math.min(...positions) : Math.max(...positions) + 1, 0, id);
    return finalize(order, s.stacks, s.bands, s.corners);
}

/** Leva o painel para a ponta esquerda ("start") ou direita ("end") do editor. */
export function moveToEdge(state, id, edge) {
    const s = detach(state, id);
    const order = columnsOnly(s).filter(x => x !== id);
    if (edge === "start") order.unshift(id);
    else order.push(id);
    return finalize(order, s.stacks, s.bands, s.corners);
}

/**
 * F2c: põe o painel numa faixa inteira em cima ("top") ou embaixo ("bottom"), na posição index
 * (padrão: no fim, à direita). Faixa nova passa inteira pelos cantos ("band"), salvo corners.
 */
export function moveToBand(state, id, edge, index = null, corners = null) {
    if (!BAND_PANEL_IDS.includes(id) || !BAND_EDGES.includes(edge)) return null;
    const s = detach(state, id);
    const list = s.bands[edge];
    if (list.length === 0) CORNERS[edge].forEach(k => { s.corners[k] = "band"; });
    list.splice(index === null || index < 0 || index > list.length ? list.length : index, 0, id);
    if (corners) Object.assign(s.corners, corners);
    return finalize(s.order, s.stacks, s.bands, s.corners);
}

/** F2c: põe o painel ao lado ("before" = à esquerda, "after" = à direita) de um painel de faixa. */
export function moveBesideInBand(state, id, targetId, side) {
    if (id === targetId) return null;
    const edge = bandOf(state.bands, targetId);
    if (!edge) return null;
    const s = detach(state, id);
    const at = s.bands[edge].indexOf(targetId);
    return moveToBand(s, id, edge, side === "before" ? at : at + 1);
}

/** F2c: muda quem fica com um canto ("tl" | "tr" | "bl" | "br") entre a coluna da ponta e a faixa. */
export function setCorner(state, corner, mode) {
    const edge = corner[0] === "t" ? "top" : "bottom";
    if (!state.bands?.[edge]?.length) return null;
    return finalize(state.order, state.stacks, state.bands, { ...(state.corners || {}), [corner]: mode === "column" ? "column" : "band" });
}

/** Empilha o painel acima ("top") ou abaixo ("bottom") de targetId, na mesma coluna. */
export function stackWith(state, id, targetId, where) {
    if (id === targetId || !COLUMN_IDS.includes(id) || !COLUMN_IDS.includes(targetId)) return null;
    if (bandOf(state.bands, targetId)) return null; // faixa é uma linha: não empilha
    const s = detach(state, id);
    const stacks = s.stacks.map(stack => [...stack]);
    let stack = stacks.find(st => st.includes(targetId));
    if (!stack) {
        stack = [targetId];
        stacks.push(stack);
    }
    if (stack.length >= MAX_STACK) return null;
    stack.splice(stack.indexOf(targetId) + (where === "top" ? 0 : 1), 0, id);
    const order = columnsOnly(s).filter(x => x !== id);
    order.splice(order.indexOf(targetId) + 1, 0, id);
    return finalize(order, stacks, s.bands, s.corners);
}

/** Troca dois painéis de lugar (também dentro de pilhas e faixas, e entre coluna e faixa). */
export function swapPanels(state, a, b) {
    if (a === b) return null;
    // A timeline troca com quem tem lugar (coluna ou faixa), mas não entra em pilha nem troca
    // estando embaixo dos monitores (lá não há vaga de coluna para dar ao outro).
    if (a === TIMELINE_ID || b === TIMELINE_ID) {
        const other = a === TIMELINE_ID ? b : a;
        const placed = bandOf(state.bands, TIMELINE_ID) || state.order.includes(TIMELINE_ID);
        if (!placed || stackOf(state.stacks, other)) return null;
    }
    const swap = (x) => (x === a ? b : x === b ? a : x);
    const bands = cloneBands(state);
    BAND_EDGES.forEach(edge => { bands[edge] = bands[edge].map(swap); });
    // Numa troca entre coluna e faixa, o que sai da faixa ocupa a coluna do outro.
    const order = [...columnsOnly(state), ...bandMembers(state.bands)].map(swap);
    return finalize(order, (state.stacks || []).map(stack => stack.map(swap)), bands, state.corners);
}

/** F2c parte 2: tira a timeline da faixa ou da coluna; ela volta para baixo dos monitores. */
export function timelineToCenter(state) {
    const s = detach(state, TIMELINE_ID);
    return finalize(s.order.filter(id => id !== TIMELINE_ID), s.stacks, s.bands, s.corners);
}

/**
 * Posições da timeline com os nomes de antes: "center", ou a faixa de baixo com os cantos que davam
 * o mesmo desenho ("bottom-full" | "bottom-left" | "bottom-right"; "band" = já numa faixa, ou
 * "bottom-full" se não estiver). Já estando na faixa de baixo, ela fica na mesma vaga.
 * "column" = coluna do editor (onde já estiver, ou à direita do centro).
 */
export function placeTimeline(state, position) {
    if (position === "center") return timelineToCenter(state);
    // "column": fica onde está se já é coluna; senão, coluna logo à direita do centro.
    if (position === "column") {
        if (timelineIsColumn(state)) return finalize(state.order, state.stacks, state.bands, state.corners);
        return moveBeside(state, TIMELINE_ID, "center-stage", "after");
    }
    const edge = bandOf(state.bands, TIMELINE_ID);
    if (position === "band" && edge) return finalize(state.order, state.stacks, state.bands, state.corners);
    const corners = LEGACY_TIMELINE_CORNERS[position === "band" ? "bottom-full" : position];
    if (!corners) return null;
    if (edge === "bottom") return finalize(state.order, state.stacks, state.bands, { ...(state.corners || {}), ...corners });
    return moveToBand(state, TIMELINE_ID, "bottom", 0, corners);
}

/** Timeline como coluna do editor (em order)? */
export function timelineIsColumn(state) {
    return !bandOf(state.bands, TIMELINE_ID) && (state.order || []).includes(TIMELINE_ID);
}

/** Lado ("left" | "right") para onde a timeline passa inteira: está numa faixa com esse canto "band". */
export function timelineExpanded(state, side) {
    const edge = bandOf(state.bands, TIMELINE_ID);
    if (!edge) return false;
    const key = (edge === "top" ? "t" : "b") + (side === "left" ? "l" : "r");
    return (state.corners?.[key] || "band") === "band";
}

/**
 * Numpad1/Numpad3 e os botões de expandir: alterna o canto daquele lado na faixa da timeline.
 * No centro, leva para a faixa de baixo já expandida para o lado; recolher o único lado expandido
 * devolve a timeline para o centro. Mesmo efeito dos atalhos com as posições antigas.
 */
export function toggleTimelineSide(state, side) {
    const edge = bandOf(state.bands, TIMELINE_ID);
    if (!edge) return placeTimeline(state, side === "left" ? "bottom-left" : "bottom-right");
    const t = edge === "top" ? "t" : "b";
    const key = t + (side === "left" ? "l" : "r");
    if (!timelineExpanded(state, side)) return setCorner(state, key, "band");
    if (!timelineExpanded(state, side === "left" ? "right" : "left")) return timelineToCenter(state);
    return setCorner(state, key, "column");
}

export function sameColumnState(a, b) {
    const bandsOf = (s) => JSON.stringify(normalizeBands(s.bands, s.corners));
    return !!a && !!b && a.order.join() === b.order.join() && JSON.stringify(a.stacks) === JSON.stringify(b.stacks)
        && bandsOf(a) === bandsOf(b);
}
