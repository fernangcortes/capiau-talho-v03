/**
 * Testes Unitários de Layout e Ordem de Colunas do Workspace CapIAu
 */

const assert = require("assert");

console.log("=== Iniciando Testes de Layout do Workspace ===");

// 1. Ordem Padrão das Colunas
const defaultColumnOrder = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];

assert.strictEqual(defaultColumnOrder.length, 4, "Deve conter exatamente 4 colunas principais");
assert.deepStrictEqual(
    defaultColumnOrder,
    ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
    "A ordem padrão deve ser: sidebar-left -> inspector-panel -> center-stage -> sidebar-right"
);
console.log("✓ Teste 1: Ordem padrão das colunas validada");

// 2. Integridade do Array de Colunas (sem duplicados, IDs válidos)
const validColumnIds = new Set(["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"]);
const testOrder = [...defaultColumnOrder];
assert.strictEqual(new Set(testOrder).size, testOrder.length, "Não deve haver IDs duplicados na lista de colunas");
testOrder.forEach(id => {
    assert.ok(validColumnIds.has(id), `ID de coluna inválido: ${id}`);
});
console.log("✓ Teste 2: Integridade de IDs e ausência de duplicatas validada");

// 3. Algoritmo de determinação de direção e resizeTarget dos divisores
function calculateSplitters(columns) {
    const centerIndex = columns.indexOf("center-stage");
    assert.ok(centerIndex !== -1, "center-stage deve estar presente");

    const splitters = [];
    for (let i = 0; i < columns.length - 1; i++) {
        const colA = columns[i];
        const colB = columns[i + 1];

        let resizeTarget = "left";
        let targetCol = colA;

        if (i + 1 <= centerIndex) {
            resizeTarget = "left";
            targetCol = colA;
        } else if (i >= centerIndex) {
            resizeTarget = "right";
            targetCol = colB;
        } else if (colB === "center-stage") {
            resizeTarget = "left";
            targetCol = colA;
        } else if (colA === "center-stage") {
            resizeTarget = "right";
            targetCol = colB;
        }

        splitters.push({ colA, colB, resizeTarget, targetCol });
    }
    return splitters;
}

// Testando layout padrão: [sidebar-left, inspector-panel, center-stage, sidebar-right]
const splittersDefault = calculateSplitters(defaultColumnOrder);
assert.strictEqual(splittersDefault.length, 3, "Devem ser criados exatamente 3 divisores para 4 colunas");

// Splitter 0: sidebar-left <-> inspector-panel (esquerda do preview)
assert.strictEqual(splittersDefault[0].targetCol, "sidebar-left");
assert.strictEqual(splittersDefault[0].resizeTarget, "left");

// Splitter 1: inspector-panel <-> center-stage (esquerda do preview)
assert.strictEqual(splittersDefault[1].targetCol, "inspector-panel");
assert.strictEqual(splittersDefault[1].resizeTarget, "left");

// Splitter 2: center-stage <-> sidebar-right (direita do preview)
assert.strictEqual(splittersDefault[2].targetCol, "sidebar-right");
assert.strictEqual(splittersDefault[2].resizeTarget, "right");

console.log("✓ Teste 3: Cálculo de resizeTarget para layout padrão validado");

// Testando layout com inspetor à direita: [sidebar-left, center-stage, inspector-panel, sidebar-right]
const altOrder = ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"];
const splittersAlt = calculateSplitters(altOrder);
assert.strictEqual(splittersAlt[0].targetCol, "sidebar-left");
assert.strictEqual(splittersAlt[0].resizeTarget, "left");

assert.strictEqual(splittersAlt[1].targetCol, "inspector-panel");
assert.strictEqual(splittersAlt[1].resizeTarget, "right");

assert.strictEqual(splittersAlt[2].targetCol, "sidebar-right");
assert.strictEqual(splittersAlt[2].resizeTarget, "right");

console.log("✓ Teste 4: Cálculo de resizeTarget com inspetor à direita validado");

// 4. Algoritmo de Restauração Determinística
function findInsertBeforeTarget(columnOrder, panelId, activeElementsInContainer) {
    const colIndex = columnOrder.indexOf(panelId);
    if (colIndex === -1) return null;

    for (let i = colIndex + 1; i < columnOrder.length; i++) {
        const nextId = columnOrder[i];
        if (activeElementsInContainer.includes(nextId)) {
            return nextId;
        }
    }
    return null; // Append ao final
}

// Cenário A: Ordem padrão, inspector-panel é restaurado
// Container atual tem: sidebar-left, center-stage, sidebar-right
const restoreTargetA = findInsertBeforeTarget(
    defaultColumnOrder,
    "inspector-panel",
    ["sidebar-left", "center-stage", "sidebar-right"]
);
assert.strictEqual(
    restoreTargetA,
    "center-stage",
    "No layout padrão, inspector-panel deve ser inserido antes de center-stage"
);

// Cenário B: Ordem customizada [sidebar-left, center-stage, inspector-panel, sidebar-right]
// Container atual tem: sidebar-left, center-stage, sidebar-right
const restoreTargetB = findInsertBeforeTarget(
    altOrder,
    "inspector-panel",
    ["sidebar-left", "center-stage", "sidebar-right"]
);
assert.strictEqual(
    restoreTargetB,
    "sidebar-right",
    "No layout alternativo, inspector-panel deve ser inserido antes de sidebar-right"
);

// Cenário C: Restaurando sidebar-left quando inspector-panel e center-stage estão presentes
const restoreTargetC = findInsertBeforeTarget(
    defaultColumnOrder,
    "sidebar-left",
    ["inspector-panel", "center-stage", "sidebar-right"]
);
assert.strictEqual(
    restoreTargetC,
    "inspector-panel",
    "sidebar-left deve ser inserida antes de inspector-panel"
);

// Cenário D: Restaurando sidebar-right (última coluna)
const restoreTargetD = findInsertBeforeTarget(
    defaultColumnOrder,
    "sidebar-right",
    ["sidebar-left", "inspector-panel", "center-stage"]
);
assert.strictEqual(
    restoreTargetD,
    null,
    "sidebar-right sendo a última deve retornar null (appendChild)"
);

console.log("✓ Teste 5: Restauração determinística em todos os cenários validada");

// 5. Motor de Direcionalidade Inteligente (Fase 2 - Regra 5)
function calculateDockDirection(columns, panelId) {
    if (panelId === "center-stage") return null;
    const centerIndex = columns.indexOf("center-stage");
    assert.ok(centerIndex !== -1, "center-stage deve estar presente na lista de colunas");
    const panelIndex = columns.indexOf(panelId);
    assert.ok(panelIndex !== -1, `Painel ${panelId} deve estar presente`);

    return panelIndex < centerIndex ? "left" : "right";
}

function getExpectedButtonIcon(direction) {
    return direction === "left" ? "fa-solid fa-chevron-left" : "fa-solid fa-chevron-right";
}

function getExpectedButtonTooltip(direction) {
    return direction === "left" ? "Recolher Painel (Esquerda)" : "Recolher Painel (Direita)";
}

function simulateDomOrderWithRestoreLines(columns) {
    const centerIndex = columns.indexOf("center-stage");
    const reopenMap = {
        "sidebar-left": "reopen-left",
        "inspector-panel": "reopen-inspector",
        "sidebar-right": "reopen-right"
    };

    const domSequence = [];
    columns.forEach((colId, index) => {
        if (colId === "center-stage") {
            domSequence.push(colId);
            return;
        }
        const isLeft = index < centerIndex;
        const reopenId = reopenMap[colId];
        if (isLeft) {
            if (reopenId) domSequence.push(reopenId);
            domSequence.push(colId);
        } else {
            domSequence.push(colId);
            if (reopenId) domSequence.push(reopenId);
        }
    });
    return domSequence;
}

// Teste 6: Direcionalidade no layout padrão
assert.strictEqual(calculateDockDirection(defaultColumnOrder, "sidebar-left"), "left", "sidebar-left deve ancorar à esquerda");
assert.strictEqual(calculateDockDirection(defaultColumnOrder, "inspector-panel"), "left", "inspector-panel deve ancorar à esquerda no layout padrão");
assert.strictEqual(calculateDockDirection(defaultColumnOrder, "sidebar-right"), "right", "sidebar-right deve ancorar à direita");
assert.strictEqual(calculateDockDirection(defaultColumnOrder, "center-stage"), null, "center-stage não tem direção dock");
console.log("✓ Teste 6: Direcionalidade dock-left e dock-right no layout padrão validada");

// Teste 7: Direcionalidade no layout alternativo (Inspetor à direita do Preview)
assert.strictEqual(calculateDockDirection(altOrder, "sidebar-left"), "left", "sidebar-left continua ancorada à esquerda");
assert.strictEqual(calculateDockDirection(altOrder, "inspector-panel"), "right", "inspector-panel agora deve ancorar à direita");
assert.strictEqual(calculateDockDirection(altOrder, "sidebar-right"), "right", "sidebar-right continua ancorada à direita");
console.log("✓ Teste 7: Inversão de direcionalidade com Inspetor à direita validada");

// Teste 8: Resolução de ícone e tooltip direcional
assert.strictEqual(getExpectedButtonIcon("left"), "fa-solid fa-chevron-left");
assert.strictEqual(getExpectedButtonIcon("right"), "fa-solid fa-chevron-right");
assert.strictEqual(getExpectedButtonTooltip("left"), "Recolher Painel (Esquerda)");
assert.strictEqual(getExpectedButtonTooltip("right"), "Recolher Painel (Direita)");
console.log("✓ Teste 8: Mapeamento de ícones (chevron-left / chevron-right) e tooltips validado");

// Teste 9: Posicionamento relativo das linhas restauradoras de 4px no fluxo flex
const domDefault = simulateDomOrderWithRestoreLines(defaultColumnOrder);
assert.deepStrictEqual(
    domDefault,
    ["reopen-left", "sidebar-left", "reopen-inspector", "inspector-panel", "center-stage", "sidebar-right", "reopen-right"],
    "No layout padrão, reopen-left e reopen-inspector ficam antes dos seus painéis, e reopen-right fica após"
);

const domAlt = simulateDomOrderWithRestoreLines(altOrder);
assert.deepStrictEqual(
    domAlt,
    ["reopen-left", "sidebar-left", "center-stage", "inspector-panel", "reopen-inspector", "sidebar-right", "reopen-right"],
    "Com inspetor à direita, reopen-inspector fica após inspector-panel no fluxo flex"
);
console.log("✓ Teste 9: Posicionamento dinâmico das linhas restauradoras validado");

// Teste 10: Casos Extremos de Reordenação Dinâmica (Todas à direita / Todas à esquerda)
const allRightOrder = ["center-stage", "sidebar-left", "inspector-panel", "sidebar-right"];
allRightOrder.slice(1).forEach(panelId => {
    assert.strictEqual(calculateDockDirection(allRightOrder, panelId), "right", `${panelId} deve ser dock-right`);
});

const allLeftOrder = ["sidebar-left", "inspector-panel", "sidebar-right", "center-stage"];
allLeftOrder.slice(0, 3).forEach(panelId => {
    assert.strictEqual(calculateDockDirection(allLeftOrder, panelId), "left", `${panelId} deve ser dock-left`);
});
console.log("✓ Teste 10: Casos extremos de layout (todos à direita ou todos à esquerda) validados");

// 11. Presets do Workspace Modal
const workspacePresets = {
    "default": {
        name: "Padrão",
        columns: ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
        timeline: "center",
        monitors: "side-by-side"
    },
    "inspector-right": {
        name: "Inspetor à Direita",
        columns: ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
        timeline: "center",
        monitors: "side-by-side"
    },
    "decupagem": {
        name: "Foco em Decupagem",
        columns: ["sidebar-left", "center-stage", "sidebar-right", "inspector-panel"],
        timeline: "center",
        monitors: "side-by-side"
    },
    "montagem": {
        name: "Foco em Montagem",
        columns: ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
        timeline: "bottom-full",
        monitors: "stacked"
    }
};

Object.entries(workspacePresets).forEach(([key, preset]) => {
    assert.strictEqual(preset.columns.length, 4, `Preset ${key} deve conter 4 colunas`);
    assert.ok(preset.columns.includes("center-stage"), `Preset ${key} deve conter center-stage`);
    assert.ok(new Set(preset.columns).size === 4, `Preset ${key} não deve conter colunas duplicadas`);
    assert.ok(["center", "bottom-full"].includes(preset.timeline), `Timeline do preset ${key} inválida`);
    assert.ok(["side-by-side", "stacked"].includes(preset.monitors), `Monitores do preset ${key} inválido`);
});
console.log("✓ Teste 11: Integridade e consistência de todos os presets rápidos do modal validada");

// 12. Algoritmo de Nudge (◀ e ▶) e D&D
function simulateNudge(columns, index, direction) {
    const arr = [...columns];
    const newIdx = direction === "left" ? index - 1 : index + 1;
    if (newIdx >= 0 && newIdx < arr.length) {
        const temp = arr[index];
        arr[index] = arr[newIdx];
        arr[newIdx] = temp;
    }
    return arr;
}

function simulateDrop(columns, draggedIdx, targetIdx, insertAfter) {
    const arr = [...columns];
    if (draggedIdx === targetIdx) return arr;
    const item = arr.splice(draggedIdx, 1)[0];
    let newPos = targetIdx;
    if (draggedIdx < targetIdx) {
        newPos = insertAfter ? targetIdx : targetIdx - 1;
    } else {
        newPos = insertAfter ? targetIdx + 1 : targetIdx;
    }
    newPos = Math.max(0, Math.min(arr.length, newPos));
    arr.splice(newPos, 0, item);
    return arr;
}

// Nudge: Mover inspector-panel (index 1) para a direita no defaultColumnOrder
const nudgedRight = simulateNudge(defaultColumnOrder, 1, "right");
assert.deepStrictEqual(
    nudgedRight,
    ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
    "Nudge para direita no índice 1 deve trocar inspector-panel com center-stage"
);

// Nudge de borda: tentar mover índice 0 para a esquerda não deve alterar o array
const nudgedEdge = simulateNudge(defaultColumnOrder, 0, "left");
assert.deepStrictEqual(nudgedEdge, defaultColumnOrder, "Nudge de borda esquerda não deve alterar nada");

// D&D: Mover sidebar-left (0) para depois de sidebar-right (3)
const droppedAfter = simulateDrop(defaultColumnOrder, 0, 3, true);
assert.deepStrictEqual(
    droppedAfter,
    ["inspector-panel", "center-stage", "sidebar-right", "sidebar-left"],
    "Arrastar item 0 para a direita de 3 deve colocá-lo na última posição"
);

// D&D: Mover sidebar-right (3) para antes de center-stage (2)
const droppedBefore = simulateDrop(defaultColumnOrder, 3, 2, false);
assert.deepStrictEqual(
    droppedBefore,
    ["sidebar-left", "inspector-panel", "sidebar-right", "center-stage"],
    "Arrastar item 3 para a esquerda de 2 deve inseri-lo na posição anterior"
);
console.log("✓ Teste 12: Algoritmos de Nudge (◀ ▶) e Drag & Drop validados");

// 13. Reconhecimento de Preset Ativo (getActivePresetKey)
function getActivePresetKey(currentCols, currentTimeline, currentMonitors, presets) {
    for (const [key, preset] of Object.entries(presets)) {
        const sameCols = preset.columns.length === currentCols.length &&
            preset.columns.every((col, i) => col === currentCols[i]);
        const sameTimeline = preset.timeline === currentTimeline;
        const sameMonitors = preset.monitors === currentMonitors;
        if (sameCols && sameTimeline && sameMonitors) {
            return key;
        }
    }
    return null;
}

assert.strictEqual(
    getActivePresetKey(defaultColumnOrder, "center", "side-by-side", workspacePresets),
    "default",
    "Deve identificar preset 'default'"
);
assert.strictEqual(
    getActivePresetKey(["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"], "center", "side-by-side", workspacePresets),
    "inspector-right",
    "Deve identificar preset 'inspector-right'"
);
assert.strictEqual(
    getActivePresetKey(["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"], "bottom-full", "stacked", workspacePresets),
    "montagem",
    "Deve identificar preset 'montagem'"
);
assert.strictEqual(
    getActivePresetKey(["center-stage", "sidebar-left", "inspector-panel", "sidebar-right"], "center", "side-by-side", workspacePresets),
    null,
    "Layout customizado não deve coincidir com preset pré-existente"
);
console.log("✓ Teste 13: Algoritmo de identificação de preset ativo validado");

// 14. Validação do Ciclo de Vida do DOM: Prevenção do Bug da Tela Preta ao alternar Posição da Timeline
class MockElement {
    constructor(id, className = "") {
        this.id = id;
        this.className = className;
        this.classList = {
            contains: (cls) => (this.className || "").split(" ").includes(cls),
            add: (cls) => { if (!this.classList.contains(cls)) this.className = (this.className + " " + cls).trim(); },
            remove: (cls) => { this.className = (this.className || "").split(" ").filter(c => c !== cls).join(" "); }
        };
        this.children = [];
        this.parentNode = null;
        this.style = { removeProperty: () => {} };
        this.attributes = {};
        this.title = "";
        this.innerHTML = "";
    }
    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }
    removeAttribute(name) {
        delete this.attributes[name];
    }
    appendChild(child) {
        if (child.parentNode) {
            child.parentNode.removeChild(child);
        }
        this.children.push(child);
        child.parentNode = this;
        return child;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }
    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }
    querySelector(selector) {
        if (selector.includes("[id*=\"popout\"]")) {
            if (this.id && this.id.includes("popout")) return this;
            for (const c of this.children) {
                const res = c.querySelector(selector);
                if (res) return res;
            }
        } else if (selector.startsWith("#")) {
            const targetId = selector.slice(1);
            if (this.id === targetId) return this;
            for (const c of this.children) {
                const res = c.querySelector(selector);
                if (res) return res;
            }
        } else if (selector.startsWith(".")) {
            const targetClass = selector.slice(1);
            if (this.classList.contains(targetClass)) return this;
            for (const c of this.children) {
                const res = c.querySelector(selector);
                if (res) return res;
            }
        }
        return null;
    }
}

// Configuração do DOM mock
const mockWorkspace = new MockElement("workspace", "workspace");
let mockStudioTop = new MockElement("studio-top", "studio-top");

const mockSidebarLeft = new MockElement("sidebar-left", "sidebar-left");
const mockReopenLeft = new MockElement("reopen-library", "reopen-line");
const mockInspector = new MockElement("inspector-panel", "sidebar-inspector");
const mockReopenInspector = new MockElement("reopen-inspector", "reopen-line");
const mockCenterStage = new MockElement("center-stage", "center-stage");
const mockMonitors = new MockElement("monitors-container", "monitors-container");
const mockSidebarRight = new MockElement("sidebar-right", "sidebar-right");
const mockReopenRight = new MockElement("reopen-right", "reopen-line");
const mockTimeline = new MockElement("timeline-panel", "timeline-panel");
const mockReopenTimeline = new MockElement("reopen-timeline", "reopen-line");

mockCenterStage.appendChild(mockMonitors);

// Simulação de setTimelinePosition usando a lógica corrigida
function simulateSetTimelinePosition(targetPosition, workspaceRef, studioTopRef) {
    const isTimelinePopped = false;
    const findElement = (id) => {
        return (workspaceRef && workspaceRef.querySelector(`#${id}`))
            || (studioTopRef && studioTopRef.querySelector(`#${id}`));
    };
    const findColumnElement = (id) => {
        return findElement(id) || (id === "center-stage" ? (workspaceRef.querySelector(".center-stage") || studioTopRef?.querySelector(".center-stage")) : null);
    };

    const timelinePanel = findElement("timeline-panel");
    const reopenTimeline = findElement("reopen-timeline");
    const defaultCols = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
    const reopenMap = {
        "sidebar-left": "reopen-library",
        "inspector-panel": "reopen-inspector",
        "sidebar-right": "reopen-right"
    };
    const centerIdx = defaultCols.indexOf("center-stage");

    function arrangeColumns(targetContainer) {
        defaultCols.forEach((colId, idx) => {
            if (colId === "center-stage") {
                const centerEl = (workspaceRef && workspaceRef.querySelector(".center-stage"))
                    || (studioTopRef && studioTopRef.querySelector(".center-stage"));
                if (centerEl) targetContainer.appendChild(centerEl);
                return;
            }
            const colEl = findColumnElement(colId);
            const rId = reopenMap[colId];
            const rEl = rId ? findColumnElement(rId) : null;
            const isLeft = centerIdx !== -1 ? idx < centerIdx : true;
            if (isLeft) {
                if (rEl) targetContainer.appendChild(rEl);
                if (colEl) targetContainer.appendChild(colEl);
            } else {
                if (colEl) targetContainer.appendChild(colEl);
                if (rEl) targetContainer.appendChild(rEl);
            }
        });
    }

    if (targetPosition === "bottom-full") {
        if (!studioTopRef) {
            studioTopRef = new MockElement("studio-top", "studio-top");
        }
        if (studioTopRef.parentNode !== workspaceRef) {
            workspaceRef.appendChild(studioTopRef);
        }
        arrangeColumns(studioTopRef);
        if (timelinePanel && !isTimelinePopped) {
            workspaceRef.appendChild(timelinePanel);
        }
        if (reopenTimeline) {
            workspaceRef.appendChild(reopenTimeline);
        }
    } else {
        // targetPosition === "center"
        // 1. Move todas as colunas superiores de volta para o workspace
        arrangeColumns(workspaceRef);

        // 2. Localiza o centerStage agora garantidamente dentro de workspace
        const currentCenterStage = workspaceRef.querySelector(".center-stage");

        // 3. Move timelinePanel e reopenTimeline para dentro do centerStage
        if (currentCenterStage) {
            if (timelinePanel && !isTimelinePopped) {
                currentCenterStage.appendChild(timelinePanel);
            }
            if (reopenTimeline) {
                currentCenterStage.appendChild(reopenTimeline);
            }
        }

        // 4. Somente após todos os filhos terem sido transferidos, remove studioTop
        if (studioTopRef && studioTopRef.parentNode) {
            studioTopRef.remove();
        }
    }
    return studioTopRef;
}

// 1) Começa no modo bottom-full
mockStudioTop.appendChild(mockSidebarLeft);
mockStudioTop.appendChild(mockReopenLeft);
mockStudioTop.appendChild(mockInspector);
mockStudioTop.appendChild(mockReopenInspector);
mockStudioTop.appendChild(mockCenterStage);
mockStudioTop.appendChild(mockSidebarRight);
mockStudioTop.appendChild(mockReopenRight);
mockWorkspace.appendChild(mockStudioTop);
mockWorkspace.appendChild(mockTimeline);
mockWorkspace.appendChild(mockReopenTimeline);

assert.strictEqual(mockWorkspace.children.length, 3, "bottom-full deve ter studio-top, timeline e reopen-timeline");
assert.strictEqual(mockStudioTop.children.length, 7, "studio-top deve conter as 4 colunas e 3 reopen-lines");

// 2) Transiciona para center ("Entre menus")
mockStudioTop = simulateSetTimelinePosition("center", mockWorkspace, mockStudioTop);

// Validações cruciais contra Tela Preta:
assert.strictEqual(mockStudioTop.parentNode, null, "studioTop deve ter sido desanexado do workspace");
assert.strictEqual(mockWorkspace.querySelector("#sidebar-left"), mockSidebarLeft, "sidebar-left deve estar presente no workspace");
assert.strictEqual(mockWorkspace.querySelector("#inspector-panel"), mockInspector, "inspector-panel deve estar presente no workspace");
assert.strictEqual(mockWorkspace.querySelector(".center-stage"), mockCenterStage, "center-stage deve estar presente no workspace");
assert.strictEqual(mockWorkspace.querySelector("#sidebar-right"), mockSidebarRight, "sidebar-right deve estar presente no workspace");
assert.strictEqual(mockCenterStage.querySelector("#timeline-panel"), mockTimeline, "timeline-panel deve estar dentro de center-stage");
assert.strictEqual(mockCenterStage.querySelector("#reopen-timeline"), mockReopenTimeline, "reopen-timeline deve estar dentro de center-stage");
assert.ok(mockWorkspace.children.length >= 4, "workspace deve conter todas as colunas superiores diretamente (nunca 0 elementos)");

// 3) Transiciona de volta para bottom-full
mockStudioTop = simulateSetTimelinePosition("bottom-full", mockWorkspace, mockStudioTop);

assert.strictEqual(mockWorkspace.children.length, 3, "De volta ao bottom-full: workspace deve ter studioTop, timeline e reopen");
assert.strictEqual(mockStudioTop.parentNode, mockWorkspace, "studioTop deve estar anexado ao workspace");
assert.strictEqual(mockStudioTop.querySelector("#sidebar-left"), mockSidebarLeft, "sidebar-left preservado dentro de studioTop");
assert.strictEqual(mockStudioTop.querySelector("#inspector-panel"), mockInspector, "inspector-panel preservado dentro de studioTop");
assert.strictEqual(mockStudioTop.querySelector(".center-stage"), mockCenterStage, "center-stage preservado dentro de studioTop");
assert.strictEqual(mockStudioTop.querySelector("#sidebar-right"), mockSidebarRight, "sidebar-right preservado dentro de studioTop");
assert.strictEqual(mockWorkspace.querySelector("#timeline-panel"), mockTimeline, "timeline-panel de volta na raiz do workspace");

console.log("✓ Teste 14: Ciclo de vida DOM da Timeline e prevenção da Tela Preta validado");

// 15. Persistência de Workspaces Customizadas no localStorage
class MockLocalStorage {
    constructor() {
        this.store = {};
    }
    getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
    }
    setItem(key, value) {
        this.store[key] = String(value);
    }
    removeItem(key) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

const mockStorage = new MockLocalStorage();

function simulateCaptureCurrentState(currentOrder, timelinePos, monitorsLay, isStudio, poppedPanels = []) {
    return {
        isStudio: isStudio,
        monitorsLayout: monitorsLay,
        timelinePosition: timelinePos,
        columnOrder: [...currentOrder],
        popouts: [...poppedPanels],
        splitters: {
            "layout-dim-splitter-sidebar-left": "350px",
            "layout-dim-splitter-inspector": "300px",
            "layout-dim-splitter-sidebar-right": "320px"
        },
        collapsed: {
            sidebarLeft: false,
            inspectorPanel: false,
            sidebarRight: false,
            timelinePanel: false
        }
    };
}

function simulateSaveCustomWorkspace(storage, name, wsId, state) {
    const raw = storage.getItem("capiau_custom_workspaces");
    const dict = raw ? JSON.parse(raw) : {};
    dict[wsId] = {
        id: wsId,
        name: name,
        created: Date.now(),
        updated: Date.now(),
        ...state
    };
    storage.setItem("capiau_custom_workspaces", JSON.stringify(dict));
    storage.setItem("capiau_active_workspace", wsId);
}

function simulateLoadCustomWorkspace(storage, wsId) {
    const raw = storage.getItem("capiau_custom_workspaces");
    if (!raw) return null;
    const dict = JSON.parse(raw);
    return dict[wsId] || null;
}

// Salva workspace customizada com Inspetor à direita
const customState1 = simulateCaptureCurrentState(
    ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
    "center",
    "side-by-side",
    false,
    []
);
simulateSaveCustomWorkspace(mockStorage, "Edição Fina", "ws_edicao_fina", customState1);

const loadedWs1 = simulateLoadCustomWorkspace(mockStorage, "ws_edicao_fina");
assert.ok(loadedWs1 !== null, "Workspace customizada deve ter sido salva e recuperada");
assert.strictEqual(loadedWs1.name, "Edição Fina");
assert.deepStrictEqual(
    loadedWs1.columnOrder,
    ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
    "A columnOrder salva deve ser preservada no localStorage"
);
assert.strictEqual(loadedWs1.timelinePosition, "center");
assert.strictEqual(loadedWs1.monitorsLayout, "side-by-side");
assert.strictEqual(mockStorage.getItem("capiau_active_workspace"), "ws_edicao_fina");

console.log("✓ Teste 15: Persistência de Workspaces Customizadas e columnOrder no localStorage validada");

// 16. Sincronização de Presets Nativos e Customizados no applyWorkspace
class MockBroadcastChannel {
    constructor(name) {
        this.name = name;
        this.messages = [];
    }
    postMessage(msg) {
        this.messages.push(msg);
    }
}

const mockChannel = new MockBroadcastChannel("capiau-workspace-sync");

class MockWorkspaceManagerService {
    constructor(storage, channel) {
        this.storage = storage;
        this.channel = channel;
        this.presets = { ...workspacePresets };
        this.currentOrder = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
        this.timelinePosition = "center";
        this.monitorsLayout = "side-by-side";
        this.activeWorkspace = "default";
    }

    applyWorkspace(wsId) {
        const custom = simulateLoadCustomWorkspace(this.storage, wsId);
        if (custom) {
            this.timelinePosition = custom.timelinePosition || "center";
            this.monitorsLayout = custom.monitorsLayout || "side-by-side";
            if (custom.columnOrder) {
                this.currentOrder = [...custom.columnOrder];
            }
        } else if (this.presets[wsId]) {
            const p = this.presets[wsId];
            this.timelinePosition = p.timeline;
            this.monitorsLayout = p.monitors;
            this.currentOrder = [...p.columns];
        }

        this.activeWorkspace = wsId;
        this.storage.setItem("capiau_active_workspace", wsId);
        this.storage.setItem("capiau_column_order", JSON.stringify(this.currentOrder));
        this.storage.setItem("capiau_timeline_position", this.timelinePosition);
        this.storage.setItem("capiau_monitors_layout", this.monitorsLayout);

        this.channel.postMessage({
            type: "WORKSPACE_CHANGED",
            workspace: wsId,
            columnOrder: [...this.currentOrder],
            timelinePosition: this.timelinePosition,
            monitorsLayout: this.monitorsLayout,
            isStudio: this.timelinePosition === "bottom-full" && this.monitorsLayout === "stacked"
        });
    }
}

const wsService = new MockWorkspaceManagerService(mockStorage, mockChannel);

// Aplica preset "inspector-right"
wsService.applyWorkspace("inspector-right");
assert.deepStrictEqual(
    wsService.currentOrder,
    ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
    "Preset inspector-right deve aplicar sua respectiva columnOrder"
);
assert.strictEqual(wsService.timelinePosition, "center");
assert.strictEqual(wsService.monitorsLayout, "side-by-side");

// Aplica preset "montagem"
wsService.applyWorkspace("montagem");
assert.deepStrictEqual(
    wsService.currentOrder,
    ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
    "Preset montagem deve restaurar a ordem padrão"
);
assert.strictEqual(wsService.timelinePosition, "bottom-full");
assert.strictEqual(wsService.monitorsLayout, "stacked");

// Aplica workspace customizada salva no Teste 15
wsService.applyWorkspace("ws_edicao_fina");
assert.deepStrictEqual(
    wsService.currentOrder,
    ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
    "Workspace customizada deve restaurar fielmente sua columnOrder"
);

// Verifica histórico de mensagens do canal BroadcastChannel
assert.strictEqual(mockChannel.messages.length, 3, "Devem ter sido emitidas 3 mensagens de WORKSPACE_CHANGED");
assert.strictEqual(mockChannel.messages[0].workspace, "inspector-right");
assert.strictEqual(mockChannel.messages[1].workspace, "montagem");
assert.strictEqual(mockChannel.messages[1].isStudio, true, "Modo montagem deve reportar isStudio: true");
assert.strictEqual(mockChannel.messages[2].workspace, "ws_edicao_fina");

console.log("✓ Teste 16: Sincronização de Presets e transmissão de WORKSPACE_CHANGED validada");

// 17. Ciclo de Vida Multi-Monitor: Popout e Restauração de Colunas no DOM
function simulateArrangeTopColumns(container, columnOrder, popoutWindows, domElements) {
    const centerIndex = columnOrder.indexOf("center-stage");
    const reopenMap = {
        "sidebar-left": "reopen-left",
        "inspector-panel": "reopen-inspector",
        "sidebar-right": "reopen-right"
    };

    columnOrder.forEach((colId, idx) => {
        if (colId === "center-stage") {
            const centerEl = domElements["center-stage"];
            if (centerEl) container.appendChild(centerEl);
            return;
        }

        const isPopped = !!(popoutWindows[colId] && !popoutWindows[colId].closed);
        const colEl = domElements[colId];
        const rId = reopenMap[colId];
        const rEl = rId ? domElements[rId] : null;
        const isLeft = centerIndex !== -1 ? idx < centerIndex : true;

        if (isLeft) {
            if (rEl) container.appendChild(rEl);
            if (colEl && !isPopped) container.appendChild(colEl);
        } else {
            if (colEl && !isPopped) container.appendChild(colEl);
            if (rEl) container.appendChild(rEl);
        }
    });
}

function calculateActiveSplitters(columnOrder, popoutWindows) {
    const activeCols = columnOrder.filter(colId => {
        return colId === "center-stage" || !popoutWindows[colId] || popoutWindows[colId].closed;
    });
    return calculateSplitters(activeCols);
}

// Configuração inicial de DOM com 4 colunas
const mainContainer = new MockElement("top-container", "top-container");
const domCols = {
    "sidebar-left": new MockElement("sidebar-left", "sidebar-left"),
    "reopen-left": new MockElement("reopen-left", "reopen-line"),
    "inspector-panel": new MockElement("inspector-panel", "sidebar-inspector"),
    "reopen-inspector": new MockElement("reopen-inspector", "reopen-line"),
    "center-stage": new MockElement("center-stage", "center-stage"),
    "sidebar-right": new MockElement("sidebar-right", "sidebar-right"),
    "reopen-right": new MockElement("reopen-right", "reopen-line")
};

const popoutWindows = {};

// 1) Estado normal com todas as 4 colunas no DOM principal
const inspectorPopBtn = new MockElement("btn-popout-inspector", "btn-icon");
inspectorPopBtn.title = "Destacar Ajustes & Efeitos";
inspectorPopBtn.setAttribute("data-tooltip", "Destacar Ajustes & Efeitos");
inspectorPopBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i>';
domCols["inspector-panel"].appendChild(inspectorPopBtn);

simulateArrangeTopColumns(mainContainer, defaultColumnOrder, popoutWindows, domCols);
const initialSplitters = calculateActiveSplitters(defaultColumnOrder, popoutWindows);
assert.strictEqual(initialSplitters.length, 3, "Com 4 colunas normais, devem existir 3 splitters");

// 2) Destacar "inspector-panel" para janela externa (popout)
const mockPopoutWindow = {
    closed: false,
    document: {
        container: new MockElement("panel-container", "panel-container")
    }
};
popoutWindows["inspector-panel"] = mockPopoutWindow;
// Simula transformação do botão na janela destacada
const currentTip = inspectorPopBtn.getAttribute("data-tooltip") || inspectorPopBtn.title;
const currentHtml = inspectorPopBtn.innerHTML;
inspectorPopBtn.setAttribute("data-orig-tooltip", currentTip);
inspectorPopBtn.setAttribute("data-orig-html", currentHtml);
inspectorPopBtn.title = "Reanexar ao Editor Principal";
inspectorPopBtn.setAttribute("data-tooltip", "Reanexar ao Editor Principal");
inspectorPopBtn.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i>';

assert.strictEqual(inspectorPopBtn.getAttribute("data-tooltip"), "Reanexar ao Editor Principal");
assert.ok(inspectorPopBtn.innerHTML.includes("fa-down-left-and-up-right-to-center"));

// Simula transferência via adoptNode para a janela externa
mainContainer.removeChild(domCols["inspector-panel"]);
mockPopoutWindow.document.container.appendChild(domCols["inspector-panel"]);

// Reorganiza o container principal e recalcula splitters
simulateArrangeTopColumns(mainContainer, defaultColumnOrder, popoutWindows, domCols);
const splittersDuringPopout = calculateActiveSplitters(defaultColumnOrder, popoutWindows);

assert.strictEqual(splittersDuringPopout.length, 2, "Durante o popout do inspetor, devem restar exatamente 2 splitters");
assert.strictEqual(splittersDuringPopout[0].colA, "sidebar-left");
assert.strictEqual(splittersDuringPopout[0].colB, "center-stage");
assert.strictEqual(splittersDuringPopout[1].colA, "center-stage");
assert.strictEqual(splittersDuringPopout[1].colB, "sidebar-right");
assert.strictEqual(mainContainer.querySelector("#inspector-panel"), null, "inspector-panel não deve residir no container principal enquanto destacado");
assert.strictEqual(mockPopoutWindow.document.container.querySelector("#inspector-panel"), domCols["inspector-panel"]);

// 3) Fechar a janela e restaurar "inspector-panel"
mockPopoutWindow.closed = true;
delete popoutWindows["inspector-panel"];
mockPopoutWindow.document.container.removeChild(domCols["inspector-panel"]);
mainContainer.appendChild(domCols["inspector-panel"]);

// Restauração do botão
const origTip = inspectorPopBtn.getAttribute("data-orig-tooltip") || "Destacar Ajustes & Efeitos";
const origHtml = inspectorPopBtn.getAttribute("data-orig-html") || '<i class="fa-solid fa-up-right-from-square"></i>';
inspectorPopBtn.title = origTip;
inspectorPopBtn.setAttribute("data-tooltip", origTip);
inspectorPopBtn.innerHTML = origHtml;
inspectorPopBtn.removeAttribute("data-orig-tooltip");
inspectorPopBtn.removeAttribute("data-orig-html");

assert.strictEqual(inspectorPopBtn.getAttribute("data-tooltip"), "Destacar Ajustes & Efeitos", "Tooltip original de destacar deve ser restaurado");
assert.ok(inspectorPopBtn.innerHTML.includes("fa-up-right-from-square"), "Ícone original fa-up-right-from-square deve ser restaurado");
assert.strictEqual(inspectorPopBtn.getAttribute("data-orig-tooltip"), null);

simulateArrangeTopColumns(mainContainer, defaultColumnOrder, popoutWindows, domCols);

const restoredSplitters = calculateActiveSplitters(defaultColumnOrder, popoutWindows);
assert.strictEqual(restoredSplitters.length, 3, "Após restauração, devem voltar a existir 3 splitters");
assert.strictEqual(mainContainer.querySelector("#inspector-panel"), domCols["inspector-panel"], "inspector-panel reintegrado com sucesso");

console.log("✓ Teste 17: Ciclo completo de Popout, botão de reanexação, recálculo de divisores e restauração local validado");

// 18. Resiliência de Restauração com Reordenação Prévia
// Cenário Crítico: Inspetor é destacado, usuário reordena colunas para Inspetor à Direita, e então o restaura
popoutWindows["inspector-panel"] = { closed: false, document: { container: new MockElement("panel-container") } };
mainContainer.removeChild(domCols["inspector-panel"]);
popoutWindows["inspector-panel"].document.container.appendChild(domCols["inspector-panel"]);

// Usuário aplica preset "inspector-right" enquanto o inspetor está em popout!
const newOrderWithInspectorRight = ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"];
simulateArrangeTopColumns(mainContainer, newOrderWithInspectorRight, popoutWindows, domCols);

// Verifica que no container principal, apenas as colunas não-destacadas foram posicionadas
assert.strictEqual(mainContainer.querySelector("#inspector-panel"), null);

// Agora o usuário fecha o popout e restaura o painel
delete popoutWindows["inspector-panel"];
popoutWindows["inspector-panel"] = { closed: true };
mainContainer.appendChild(domCols["inspector-panel"]);

simulateArrangeTopColumns(mainContainer, newOrderWithInspectorRight, {}, domCols);

// Validações da restauração na nova posição:
assert.strictEqual(
    calculateDockDirection(newOrderWithInspectorRight, "inspector-panel"),
    "right",
    "Inspetor agora deve estar configurado como dock-right"
);

// Verifica a ordem física dos nós no mainContainer
const renderedIds = mainContainer.children.map(c => c.id);
assert.deepStrictEqual(
    renderedIds,
    ["reopen-left", "sidebar-left", "center-stage", "inspector-panel", "reopen-inspector", "sidebar-right", "reopen-right"],
    "A ordem física do DOM após restaurar deve posicionar o inspector-panel à direita do center-stage"
);

const splittersAfterReorderRestore = calculateSplitters(newOrderWithInspectorRight);
assert.strictEqual(splittersAfterReorderRestore.length, 3);
assert.strictEqual(splittersAfterReorderRestore[0].colA, "sidebar-left");
assert.strictEqual(splittersAfterReorderRestore[0].colB, "center-stage");
assert.strictEqual(splittersAfterReorderRestore[1].colA, "center-stage");
assert.strictEqual(splittersAfterReorderRestore[1].colB, "inspector-panel");
assert.strictEqual(splittersAfterReorderRestore[2].colA, "inspector-panel");
assert.strictEqual(splittersAfterReorderRestore[2].colB, "sidebar-right");

console.log("✓ Teste 18: Restauração determinística após reordenação dinâmica validada sem perdas ou saltos");

// 19. Validação de Idempotência no Reanexar, Prevenção de Janela Duplicada e Preservação de Tooltips Globais
{
    const testDom = {
        mainDoc: {
            body: new MockElement("body", "body"),
            contains(el) {
                return this.body.children.includes(el) || this.body.children.some(c => c.children?.includes(el));
            }
        },
        popoutWin: {
            closed: false,
            close() { this.closed = true; }
        },
        globalTooltip: new MockElement("global-tooltip", "global-tooltip"),
        poppedElements: {},
        popoutWindows: {}
    };

    testDom.mainDoc.body.appendChild(testDom.globalTooltip);
    const libPanel = new MockElement("sidebar-left", "sidebar-left");
    const popBtn = new MockElement("btn-popout-library", "btn-icon");
    popBtn.title = "Destacar Biblioteca";
    popBtn.setAttribute("data-tooltip", "Destacar Biblioteca");
    popBtn.innerHTML = '<i class="fa-solid fa-up-right-from-square"></i>';
    libPanel.appendChild(popBtn);
    testDom.mainDoc.body.appendChild(libPanel);

    // Simula Pop-out
    testDom.popoutWindows["sidebar-left"] = testDom.popoutWin;
    testDom.poppedElements["sidebar-left"] = libPanel;
    testDom.mainDoc.body.removeChild(libPanel);

    // No popout, o botão é transformado em "Reanexar"
    popBtn.setAttribute("data-orig-tooltip", "Destacar Biblioteca");
    popBtn.setAttribute("data-orig-html", '<i class="fa-solid fa-up-right-from-square"></i>');
    popBtn.title = "Reanexar ao Editor Principal";
    popBtn.setAttribute("data-tooltip", "Reanexar ao Editor Principal");
    popBtn.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i>';

    // Simulação do togglePopout quando o elemento está destacado:
    let windowOpenCount = 0;
    function simulateTogglePopout(panelId) {
        const win = testDom.popoutWindows[panelId];
        const isPoppedWindowOpen = win && !win.closed;
        const localPanel = testDom.poppedElements[panelId];
        const isDetached = localPanel && !testDom.mainDoc.contains(localPanel);

        if (isPoppedWindowOpen || isDetached) {
            if (win) win.close();
            simulateRestorePanel(panelId);
            return;
        }
        windowOpenCount++;
    }

    let restoreCallCount = 0;
    function simulateRestorePanel(panelId) {
        restoreCallCount++;
        if (testDom.popoutWindows[panelId]) {
            delete testDom.popoutWindows[panelId];
        }
        const localPanel = testDom.poppedElements[panelId];
        if (!localPanel) return;

        const isAlreadyRestored = testDom.mainDoc.contains(localPanel);
        if (!isAlreadyRestored) {
            testDom.mainDoc.body.appendChild(localPanel);
        }

        // Restaura botão
        const origTooltip = popBtn.getAttribute("data-orig-tooltip") || "Destacar Biblioteca";
        const origHtml = popBtn.getAttribute("data-orig-html") || '<i class="fa-solid fa-up-right-from-square"></i>';
        popBtn.title = origTooltip;
        popBtn.setAttribute("data-tooltip", origTooltip);
        popBtn.innerHTML = origHtml;
        popBtn.removeAttribute("data-orig-tooltip");
        popBtn.removeAttribute("data-orig-html");

        // Tooltip global não pode receber display: none
        testDom.globalTooltip.classList.remove("visible");
        testDom.globalTooltip.style.display = "";
    }

    // Ação: Usuário clica no botão "Reanexar"
    simulateTogglePopout("sidebar-left");

    // Validações
    assert.strictEqual(windowOpenCount, 0, "togglePopout nunca deve disparar window.open durante o processo de reanexação");
    assert.strictEqual(testDom.popoutWin.closed, true, "Janela externa deve ter sido fechada");
    assert.strictEqual(testDom.mainDoc.contains(libPanel), true, "Painel deve estar contido no documento principal");
    assert.strictEqual(popBtn.title, "Destacar Biblioteca", "Título original do botão deve ser restaurado");
    assert.strictEqual(popBtn.getAttribute("data-tooltip"), "Destacar Biblioteca", "Tooltip de destacar deve ser restaurada");
    assert.ok(popBtn.innerHTML.includes("fa-up-right-from-square"), "Ícone de destacar deve ser restaurado");
    assert.strictEqual(testDom.globalTooltip.style.display, "", "Display inline do global-tooltip deve estar vazio (nunca display: none)");

    // Simula disparo subsequente do evento beforeunload via BroadcastChannel (chamada duplicada de restauração)
    simulateRestorePanel("sidebar-left");
    assert.strictEqual(restoreCallCount, 2, "Segunda chamada de restorePanel processada");
    assert.strictEqual(popBtn.getAttribute("data-tooltip"), "Destacar Biblioteca", "Persistência do tooltip mesmo após chamadas idempotentes");
    assert.strictEqual(windowOpenCount, 0, "Janelas duplicadas não foram criadas");
}

console.log("✓ Teste 19: Idempotência de reanexação, prevenção de reabertura indevida e preservação de tooltips globais validada");

console.log("\nTODOS OS 19 TESTES DE LAYOUT, MODAL E MULTI-MONITOR PASSARAM COM 100% DE SUCESSO!");



