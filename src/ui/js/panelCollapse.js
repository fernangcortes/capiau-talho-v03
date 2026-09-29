// Recolher painéis (botão de seta, linha de expandir e Numpad) onde quer que estejam: coluna do editor,
// pilha de coluna (F2b) e janelas destacadas (simples, Janela Dupla e grupo).
// Funções puras, usadas pelo WorkspaceManager, pelo panel.html e pelo panel-group.html.

export const COLLAPSIBLE_PANELS = ["sidebar-left", "inspector-panel", "sidebar-right"];

/** Linha de expandir de cada painel no editor (fica no lugar do painel recolhido). */
export const REOPEN_LINE_IDS = {
    "sidebar-left": "reopen-left",
    "inspector-panel": "reopen-inspector",
    "sidebar-right": "reopen-right"
};

export const COLLAPSED_STORAGE_KEY = "capiau_collapsed_panels";

const EDGE_ICONS = { left: "fa-chevron-left", right: "fa-chevron-right", up: "fa-chevron-up", down: "fa-chevron-down" };
const EDGE_LABELS = { left: "Esquerda", right: "Direita", up: "Cima", down: "Baixo" };

/**
 * Para onde recolhe o item index de count itens lado a lado ("row") ou empilhados ("column"):
 * a primeira metade vai para o começo (esquerda/cima), a outra para o fim (direita/baixo).
 */
export function edgeInLine(axis, index, count) {
    const first = index < count / 2;
    if (axis === "column") return first ? "up" : "down";
    return first ? "left" : "right";
}

/** Ícone e dica da seta de recolher para a direção dada. */
export function collapseButtonFor(edge) {
    const dir = EDGE_ICONS[edge] ? edge : "left";
    return {
        html: `<i class="fa-solid ${EDGE_ICONS[dir]}"></i>`,
        tooltip: `Recolher Painel (${EDGE_LABELS[dir]})`
    };
}

/**
 * Quais divisores aparecem numa sequência de itens: items[i] é "splitter", true (visível) ou
 * false (recolhido, vira linha). Um divisor só fica entre dois itens visíveis; havendo vários
 * candidatos entre eles, fica o último (o que encosta no item visível seguinte).
 * Devolve um array do mesmo tamanho: true/false para divisores, null para itens.
 */
export function visibleSplitters(items) {
    const out = items.map(() => null);
    let seenVisible = false;
    let pending = -1;
    items.forEach((item, i) => {
        if (item === "splitter") {
            out[i] = false;
            if (seenVisible) pending = i;
            return;
        }
        if (item) {
            if (pending >= 0) out[pending] = true;
            pending = -1;
            seenVisible = true;
        }
    });
    return out;
}

export function loadCollapsed(storage) {
    try {
        const list = JSON.parse(storage.getItem(COLLAPSED_STORAGE_KEY) || "[]");
        return new Set((Array.isArray(list) ? list : []).filter(id => COLLAPSIBLE_PANELS.includes(id)));
    } catch (e) {
        return new Set();
    }
}

export function saveCollapsed(storage, ids) {
    try {
        storage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...ids].filter(id => COLLAPSIBLE_PANELS.includes(id))));
    } catch (e) {}
}
