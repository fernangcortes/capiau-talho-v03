// Modelo de layout em árvore do plano de janelas destacáveis (docs/PLANO_JANELAS_DRAG_DOCK.md, fase F1).
// Módulo puro (sem DOM): descreve onde cada painel está, converte de/para o layout legado do
// WorkspaceManager (ordem das colunas + posição da timeline + monitores + janelas destacadas)
// e mantém o histórico de desfazer/refazer do layout.
//
// Formato (v1):
//   { v: 1, main: <nó>, floats: [{ id, root: <nó> }] }
//   nó folha:   { panel: "sidebar-left" }           painel presente aqui
//               { panel: "sidebar-left", away: true } painel está numa janela destacada; a folha
//                                                   guarda o lugar para onde ele volta
//   nó divisão: { split: "row" | "column", children: [...], role?, auto? }
//               role "center"   = o bloco central legado (monitores e, às vezes, timeline)
//               role "monitors" = Source + Program; auto: true = orientação automática
//               role "stack"    = laterais empilhadas numa mesma coluna (F2b), de cima para baixo

export const LAYOUT_VERSION = 1;
export const MAX_PANELS_PER_FLOAT = 4;

export const COLUMN_IDS = ["sidebar-left", "inspector-panel", "sidebar-right"];
export const MONITOR_IDS = ["source-player-panel", "program-player-panel"];
export const TIMELINE_ID = "timeline-panel";
export const PANEL_IDS = [...COLUMN_IDS, ...MONITOR_IDS, TIMELINE_ID];
export const CENTER_STAGE = "center-stage";

const TIMELINE_POSITIONS = ["center", "bottom-left", "bottom-right", "bottom-full"];
const MONITOR_LAYOUTS = ["auto", "side-by-side", "stacked"];

const leaf = (panel, away = false) => (away ? { panel, away: true } : { panel });
const isLeaf = (node) => !!node && typeof node.panel === "string";
const isSplit = (node) => !!node && (node.split === "row" || node.split === "column") && Array.isArray(node.children);

/**
 * Constrói a árvore a partir do estado legado do WorkspaceManager.
 * @param {{columnOrder: string[], timelinePosition: string, monitorsLayout: string,
 *          columnStacks?: string[][], popped?: string[], dual?: {panels: string[], layout?: string} | null,
 *          group?: {panels: string[], arrangement?: string} | null, tabStrips?: Object<string, string>}} state
 */
export function layoutFromLegacy(state) {
    const order = Array.isArray(state.columnOrder) && state.columnOrder.length
        ? state.columnOrder
        : ["sidebar-left", "inspector-panel", CENTER_STAGE, "sidebar-right"];
    const position = TIMELINE_POSITIONS.includes(state.timelinePosition) ? state.timelinePosition : "center";
    const monitorsLayout = MONITOR_LAYOUTS.includes(state.monitorsLayout) ? state.monitorsLayout : "auto";
    const dual = state.dual && Array.isArray(state.dual.panels) && state.dual.panels.length === 2 ? state.dual : null;
    // F4b: janela com 2 a 4 painéis de qualquer tipo (panel-group.html), com disposição pronta.
    const group = state.group && Array.isArray(state.group.panels) && state.group.panels.length >= 2 ? state.group : null;
    const away = new Set([...(state.popped || []), ...(dual ? dual.panels : []), ...(group ? group.panels : [])]);

    const monitors = {
        split: monitorsLayout === "stacked" ? "column" : "row",
        role: "monitors",
        children: MONITOR_IDS.map(id => leaf(id, away.has(id)))
    };
    if (monitorsLayout === "auto") monitors.auto = true;

    const timeline = leaf(TIMELINE_ID, away.has(TIMELINE_ID));
    const center = { split: "column", role: "center", children: position === "center" ? [monitors, timeline] : [monitors] };
    const column = (id) => (id === CENTER_STAGE ? center : leaf(id, away.has(id)));
    const stacks = (state.columnStacks || []).filter(st => Array.isArray(st) && st.length >= 2);
    // Membros de uma pilha ficam juntos em order (dockOps garante); viram um nó "stack" no lugar deles.
    const row = (ids) => {
        const children = [];
        for (let i = 0; i < ids.length; i++) {
            const stack = stacks.find(st => st[0] === ids[i]);
            if (stack && stack.every((id, k) => ids[i + k] === id)) {
                children.push({ split: "column", role: "stack", children: stack.map(id => leaf(id, away.has(id))) });
                i += stack.length - 1;
            } else {
                children.push(column(ids[i]));
            }
        }
        return { split: "row", children };
    };

    const ci = order.indexOf(CENTER_STAGE);
    let main;
    if (position === "bottom-full") {
        main = { split: "column", children: [row(order), timeline] };
    } else if (position === "bottom-left" && ci !== -1) {
        main = { split: "row", children: [{ split: "column", children: [row(order.slice(0, ci + 1)), timeline] }, ...row(order.slice(ci + 1)).children] };
    } else if (position === "bottom-right" && ci !== -1) {
        main = { split: "row", children: [...row(order.slice(0, ci)).children, { split: "column", children: [row(order.slice(ci)), timeline] }] };
    } else {
        main = row(order);
    }

    const floats = [];
    if (dual) {
        floats.push({
            id: "float:dual",
            root: { split: dual.layout === "stacked" ? "column" : "row", children: dual.panels.map(id => leaf(id)) }
        });
    }
    if (group) {
        floats.push({
            id: "float:group",
            root: { split: group.arrangement === "column" ? "column" : "row", arrangement: group.arrangement || "row", children: group.panels.map(id => leaf(id)) }
        });
    }
    (state.popped || []).forEach(id => {
        if ((!dual || !dual.panels.includes(id)) && (!group || !group.panels.includes(id))) floats.push({ id: `float:${id}`, root: leaf(id) });
    });

    const layout = { v: LAYOUT_VERSION, main, floats };
    // P14: abas que mudaram de menu ({ aba: "left" | "right" }); ausente = todas no menu de origem.
    const strips = state.tabStrips && typeof state.tabStrips === "object" ? state.tabStrips : {};
    const tabs = Object.keys(strips).filter(tab => strips[tab] === "left" || strips[tab] === "right").sort();
    if (tabs.length) layout.tabStrips = Object.fromEntries(tabs.map(tab => [tab, strips[tab]]));
    return layout;
}

/**
 * Converte a árvore de volta para o estado legado. Retorna null quando a árvore descreve um
 * layout que o renderizador legado não sabe montar (layouts livres da F2 em diante).
 */
export function legacyFromLayout(layout) {
    if (!layout || !layout.main) return null;
    const main = layout.main;

    const findRole = (node, role) => {
        if (!isSplit(node)) return null;
        if (node.role === role) return node;
        for (const child of node.children) {
            const found = findRole(child, role);
            if (found) return found;
        }
        return null;
    };
    const center = findRole(main, "center");
    const monitors = findRole(main, "monitors");
    if (!center || !monitors) return null;

    const monitorsLayout = monitors.auto ? "auto" : (monitors.split === "column" ? "stacked" : "side-by-side");
    const isTimeline = (node) => isLeaf(node) && node.panel === TIMELINE_ID;
    const columnStacks = [];
    const colsOf = (nodes) => {
        const ids = [];
        for (const node of nodes) {
            if (node === center) ids.push(CENTER_STAGE);
            else if (isLeaf(node) && COLUMN_IDS.includes(node.panel)) ids.push(node.panel);
            else if (isSplit(node) && node.role === "stack" && node.children.length >= 2
                && node.children.every(c => isLeaf(c) && COLUMN_IDS.includes(c.panel))) {
                const members = node.children.map(c => c.panel);
                columnStacks.push(members);
                ids.push(...members);
            } else return null;
        }
        return ids;
    };
    const isTimelineColumn = (node) => isSplit(node) && node.split === "column" && node.children.length === 2
        && isSplit(node.children[0]) && node.children[0].split === "row" && isTimeline(node.children[1]);

    let columnOrder = null;
    let timelinePosition = null;

    if (main.split === "row" && main.children.includes(center) && center.children.some(isTimeline)) {
        timelinePosition = "center";
        columnOrder = colsOf(main.children);
    } else if (isTimelineColumn(main) && main.children[0].children.includes(center)) {
        timelinePosition = "bottom-full";
        columnOrder = colsOf(main.children[0].children);
    } else if (main.split === "row") {
        const first = main.children[0];
        const last = main.children[main.children.length - 1];
        if (isTimelineColumn(first) && first.children[0].children.at(-1) === center) {
            const inner = colsOf(first.children[0].children);
            const rest = colsOf(main.children.slice(1));
            if (inner && rest) { timelinePosition = "bottom-left"; columnOrder = [...inner, ...rest]; }
        } else if (isTimelineColumn(last) && last.children[0].children[0] === center) {
            const before = colsOf(main.children.slice(0, -1));
            const inner = colsOf(last.children[0].children);
            if (before && inner) { timelinePosition = "bottom-right"; columnOrder = [...before, ...inner]; }
        }
    }
    if (!columnOrder || !timelinePosition) return null;
    const expected = [...COLUMN_IDS, CENTER_STAGE].sort().join(",");
    if ([...columnOrder].sort().join(",") !== expected) return null;

    let dual = null;
    let group = null;
    const popped = [];
    for (const float of layout.floats || []) {
        const panels = panelsIn(float.root);
        if (float.id === "float:group" && panels.length >= 2 && !group) {
            group = { panels, arrangement: float.root.arrangement || (float.root.split === "column" ? "column" : "row") };
        } else if (panels.length === 1) {
            popped.push(panels[0]);
        } else if (panels.length === 2 && isSplit(float.root) && !dual) {
            dual = { panels, layout: float.root.split === "column" ? "stacked" : "side-by-side" };
        } else {
            return null;
        }
    }
    const legacy = { columnOrder, timelinePosition, monitorsLayout, columnStacks, popped, dual, group };
    if (layout.tabStrips && typeof layout.tabStrips === "object") legacy.tabStrips = { ...layout.tabStrips };
    return legacy;
}

/** Lista os painéis presentes (não "away") de um nó, na ordem da árvore. */
export function panelsIn(node, { includeAway = false } = {}) {
    if (isLeaf(node)) return (!node.away || includeAway) ? [node.panel] : [];
    if (isSplit(node)) return node.children.flatMap(child => panelsIn(child, { includeAway }));
    return [];
}

/**
 * Confere as regras do layout. Retorna a lista de problemas (vazia = válido).
 * - todo painel conhecido está presente exatamente uma vez (no editor ou numa janela destacada);
 * - folha "away" no editor corresponde a um painel que está numa janela destacada;
 * - no máximo 4 painéis por janela destacada;
 * - divisões têm filhos.
 */
export function validateLayout(layout) {
    const errors = [];
    if (!layout || layout.v !== LAYOUT_VERSION || !layout.main) return ["formato ou versão inválidos"];

    const walk = (node, where) => {
        if (isLeaf(node)) {
            if (!PANEL_IDS.includes(node.panel)) errors.push(`painel desconhecido: ${node.panel}`);
            return;
        }
        if (!isSplit(node)) { errors.push(`nó inválido em ${where}`); return; }
        if (node.children.length === 0) errors.push(`divisão vazia em ${where}`);
        node.children.forEach(child => walk(child, where));
    };
    walk(layout.main, "editor");
    (layout.floats || []).forEach(f => walk(f.root, f.id));

    const present = new Map();
    const count = (id, where) => present.set(id, [...(present.get(id) || []), where]);
    panelsIn(layout.main).forEach(id => count(id, "editor"));
    const floating = new Set();
    (layout.floats || []).forEach(f => {
        const panels = panelsIn(f.root);
        if (panels.length > MAX_PANELS_PER_FLOAT) errors.push(`${f.id} tem ${panels.length} painéis (máximo ${MAX_PANELS_PER_FLOAT})`);
        if (panels.length === 0) errors.push(`${f.id} está vazia`);
        panels.forEach(id => { count(id, f.id); floating.add(id); });
    });

    PANEL_IDS.forEach(id => {
        const places = present.get(id) || [];
        if (places.length === 0) errors.push(`${id} não está em lugar nenhum`);
        if (places.length > 1) errors.push(`${id} aparece mais de uma vez (${places.join(", ")})`);
    });
    const awayLeaves = panelsIn(layout.main, { includeAway: true }).filter(id => !panelsIn(layout.main).includes(id));
    awayLeaves.forEach(id => { if (!floating.has(id)) errors.push(`${id} marcado como destacado, mas nenhuma janela o contém`); });
    return errors;
}

/** JSON com chaves ordenadas: duas árvores iguais sempre geram o mesmo texto. */
export function serializeLayout(layout) {
    const sort = (value) => {
        if (Array.isArray(value)) return value.map(sort);
        if (value && typeof value === "object") {
            return Object.keys(value).sort().reduce((acc, key) => { acc[key] = sort(value[key]); return acc; }, {});
        }
        return value;
    };
    return JSON.stringify(sort(layout));
}

export function parseLayout(text) {
    try {
        const layout = JSON.parse(text);
        return validateLayout(layout).length === 0 ? layout : null;
    } catch (err) {
        return null;
    }
}

export function layoutsEqual(a, b) {
    return serializeLayout(a) === serializeLayout(b);
}

/** Histórico de desfazer/refazer do layout, separado do histórico da timeline. */
export class LayoutHistory {
    constructor({ limit = 50 } = {}) {
        this.limit = limit;
        this.current = null;
        this.undoStack = [];
        this.redoStack = [];
    }

    reset(layout) {
        this.current = layout ? serializeLayout(layout) : null;
        this.undoStack = [];
        this.redoStack = [];
    }

    /** Registra um novo estado. Retorna false se ele é igual ao atual. */
    record(layout) {
        const text = serializeLayout(layout);
        if (this.current === null) { this.current = text; return false; }
        if (text === this.current) return false;
        this.undoStack.push(this.current);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.current = text;
        this.redoStack = [];
        return true;
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }

    undo() {
        if (!this.canUndo) return null;
        this.redoStack.push(this.current);
        this.current = this.undoStack.pop();
        return JSON.parse(this.current);
    }

    redo() {
        if (!this.canRedo) return null;
        this.undoStack.push(this.current);
        this.current = this.redoStack.pop();
        return JSON.parse(this.current);
    }
}
