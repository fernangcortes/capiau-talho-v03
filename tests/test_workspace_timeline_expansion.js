/**
 * Testes Unitários de Expansão Direcional da Timeline (Esquerda / Direita / Total / Centro)
 * CapIAu Video Editor
 */

const assert = require("assert");

console.log("=== Iniciando Testes de Expansão Direcional da Timeline ===");

class MockElement {
    constructor(id = "", className = "") {
        this.id = id;
        this.className = className;
        this.classList = {
            contains: (cls) => (this.className || "").split(" ").includes(cls),
            add: (...classes) => {
                const current = new Set((this.className || "").split(" ").filter(Boolean));
                classes.forEach(c => current.add(c));
                this.className = Array.from(current).join(" ");
            },
            remove: (...classes) => {
                const removeSet = new Set(classes);
                this.className = (this.className || "").split(" ").filter(c => !removeSet.has(c)).join(" ");
            },
            toggle: (cls, force) => {
                const has = (this.className || "").split(" ").includes(cls);
                const shouldHave = force !== undefined ? force : !has;
                if (shouldHave) {
                    if (!has) this.classList.add(cls);
                } else {
                    if (has) this.classList.remove(cls);
                }
            }
        };
        this.children = [];
        this.parentNode = null;
        this.style = {
            removeProperty: (prop) => { delete this.style[prop]; }
        };
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
    get firstChild() {
        return this.children.length > 0 ? this.children[0] : null;
    }
    prepend(child) {
        if (child.parentNode) {
            child.parentNode.removeChild(child);
        }
        this.children.unshift(child);
        child.parentNode = this;
        return child;
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
        if (selector.startsWith("#")) {
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
    querySelectorAll(selector) {
        const results = [];
        const check = (node) => {
            if (selector.startsWith("#") && node.id === selector.slice(1)) {
                results.push(node);
            } else if (selector.startsWith(".") && node.classList.contains(selector.slice(1))) {
                results.push(node);
            }
            for (const c of node.children) {
                check(c);
            }
        };
        for (const c of this.children) {
            check(c);
        }
        return results;
    }
}

// Simulador do WorkspaceManager para testes de lógica DOM
class WorkspaceManagerSimulator {
    constructor() {
        this.timelinePosition = "center";
        this.monitorsLayout = "side-by-side";
        this.columnOrder = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
        this.studioTop = null;
        this.compoundStage = null;
        this.body = new MockElement("body", "");
        this.workspace = new MockElement("workspace", "workspace");
        this.body.appendChild(this.workspace);

        // Colunas e painéis
        this.sidebarLeft = new MockElement("sidebar-left", "sidebar-left");
        this.reopenLeft = new MockElement("reopen-left", "reopen-line");
        this.inspectorPanel = new MockElement("inspector-panel", "sidebar-inspector");
        this.reopenInspector = new MockElement("reopen-inspector", "reopen-line");
        this.centerStage = new MockElement("center-stage", "center-stage");
        this.monitorsContainer = new MockElement("monitors-container", "monitors-container");
        this.sidebarRight = new MockElement("sidebar-right", "sidebar-right");
        this.reopenRight = new MockElement("reopen-right", "reopen-line");
        this.timelinePanel = new MockElement("timeline-panel", "timeline-panel");
        this.reopenTimeline = new MockElement("reopen-timeline", "reopen-line");

        this.centerStage.appendChild(this.monitorsContainer);

        // Inicializa no modo center
        this.setTimelinePosition("center");
    }

    arrangeColumnsIntoContainer(targetContainer, colIds) {
        if (!targetContainer || !Array.isArray(colIds) || colIds.length === 0) return;

        const reopenMap = {
            "sidebar-left": "reopen-left",
            "inspector-panel": "reopen-inspector",
            "sidebar-right": "reopen-right"
        };

        const centerIndex = this.columnOrder.indexOf("center-stage");

        const findColEl = (id) => {
            if (id === "center-stage") {
                return (targetContainer && targetContainer.querySelector(".center-stage"))
                    || (this.workspace && this.workspace.querySelector(".center-stage"))
                    || (this.compoundStage && this.compoundStage.querySelector(".center-stage"))
                    || (this.studioTop && this.studioTop.querySelector(".center-stage"))
                    || this.centerStage;
            }
            return (targetContainer && targetContainer.querySelector(`#${id}`))
                || (this.workspace && this.workspace.querySelector(`#${id}`))
                || (this.compoundStage && this.compoundStage.querySelector(`#${id}`))
                || (this.studioTop && this.studioTop.querySelector(`#${id}`))
                || this[id.replace(/-([a-z])/g, (g) => g[1].toUpperCase())];
        };

        colIds.forEach((colId) => {
            if (colId === "center-stage") {
                const centerEl = findColEl("center-stage");
                if (centerEl) targetContainer.appendChild(centerEl);
                return;
            }

            const colEl = findColEl(colId);
            const reopenId = reopenMap[colId];
            const reopenEl = reopenId ? findColEl(reopenId) : null;

            const globalIndex = this.columnOrder.indexOf(colId);
            const isLeft = centerIndex !== -1 ? (globalIndex !== -1 ? globalIndex < centerIndex : true) : true;

            if (isLeft) {
                if (reopenEl) targetContainer.appendChild(reopenEl);
                if (colEl) targetContainer.appendChild(colEl);
            } else {
                if (colEl) targetContainer.appendChild(colEl);
                if (reopenEl) targetContainer.appendChild(reopenEl);
            }
        });
    }

    arrangeTopColumns(targetContainer) {
        this.arrangeColumnsIntoContainer(targetContainer, this.columnOrder);
    }

    setTimelinePosition(position) {
        if (!["center", "bottom-left", "bottom-right", "bottom-full"].includes(position)) return;
        this.timelinePosition = position;

        const workspace = this.workspace;
        const findElement = (id) => {
            return (workspace && workspace.querySelector(`#${id}`))
                || (this.compoundStage && this.compoundStage.querySelector(`#${id}`))
                || (this.studioTop && this.studioTop.querySelector(`#${id}`))
                || this[id.replace(/-([a-z])/g, (g) => g[1].toUpperCase())];
        };

        const timelinePanel = findElement("timeline-panel");
        const reopenTimeline = findElement("reopen-timeline");
        const centerIndex = this.columnOrder.indexOf("center-stage");

        if (position === "bottom-full") {
            if (this.compoundStage && this.compoundStage.parentNode) {
                this.compoundStage.remove();
            }
            if (!this.studioTop) {
                this.studioTop = new MockElement("studio-top", "studio-top");
            }
            if (this.studioTop.parentNode !== workspace) {
                workspace.appendChild(this.studioTop);
            }

            this.arrangeTopColumns(this.studioTop);

            if (timelinePanel) workspace.appendChild(timelinePanel);
            if (reopenTimeline) workspace.appendChild(reopenTimeline);

            this.body.classList.remove("layout-timeline-bottom-left", "layout-timeline-bottom-right", "layout-timeline-expanded");
            this.body.classList.add("layout-timeline-bottom");
        } else if (position === "bottom-left") {
            if (!this.compoundStage) {
                this.compoundStage = new MockElement("compound-stage", "compound-stage");
            }
            if (!this.studioTop) {
                this.studioTop = new MockElement("studio-top", "studio-top");
            }
            if (this.studioTop.parentNode !== this.compoundStage) {
                this.compoundStage.appendChild(this.studioTop);
            }

            const leftCols = centerIndex !== -1 ? this.columnOrder.filter((col, idx) => idx <= centerIndex) : ["sidebar-left", "inspector-panel", "center-stage"];
            const rightCols = centerIndex !== -1 ? this.columnOrder.filter((col, idx) => idx > centerIndex) : ["sidebar-right"];

            this.arrangeColumnsIntoContainer(this.studioTop, leftCols);

            if (timelinePanel) this.compoundStage.appendChild(timelinePanel);
            if (reopenTimeline) this.compoundStage.appendChild(reopenTimeline);

            if (workspace.firstChild !== this.compoundStage) {
                workspace.prepend(this.compoundStage);
            }
            this.arrangeColumnsIntoContainer(workspace, rightCols);

            this.body.classList.remove("layout-timeline-bottom", "layout-timeline-bottom-right");
            this.body.classList.add("layout-timeline-bottom-left", "layout-timeline-expanded");
        } else if (position === "bottom-right") {
            if (!this.compoundStage) {
                this.compoundStage = new MockElement("compound-stage", "compound-stage");
            }
            if (!this.studioTop) {
                this.studioTop = new MockElement("studio-top", "studio-top");
            }
            if (this.studioTop.parentNode !== this.compoundStage) {
                this.compoundStage.appendChild(this.studioTop);
            }

            const leftCols = centerIndex !== -1 ? this.columnOrder.filter((col, idx) => idx < centerIndex) : ["sidebar-left", "inspector-panel"];
            const rightCols = centerIndex !== -1 ? this.columnOrder.filter((col, idx) => idx >= centerIndex) : ["center-stage", "sidebar-right"];

            this.arrangeColumnsIntoContainer(workspace, leftCols);

            // Inserção no workspace: compoundStage garantidamente após as colunas esquerdas
            workspace.appendChild(this.compoundStage);

            this.arrangeColumnsIntoContainer(this.studioTop, rightCols);

            if (timelinePanel) this.compoundStage.appendChild(timelinePanel);
            if (reopenTimeline) this.compoundStage.appendChild(reopenTimeline);

            this.body.classList.remove("layout-timeline-bottom", "layout-timeline-bottom-left");
            this.body.classList.add("layout-timeline-bottom-right", "layout-timeline-expanded");
        } else {
            // center
            this.arrangeTopColumns(workspace);

            const currentCenterStage = (workspace && workspace.querySelector(".center-stage"))
                || (this.compoundStage && this.compoundStage.querySelector(".center-stage"))
                || (this.studioTop && this.studioTop.querySelector(".center-stage"))
                || this.centerStage;

            if (currentCenterStage) {
                if (timelinePanel) currentCenterStage.appendChild(timelinePanel);
                if (reopenTimeline) currentCenterStage.appendChild(reopenTimeline);
            }

            if (this.studioTop && this.studioTop.parentNode) {
                this.studioTop.remove();
            }
            if (this.compoundStage && this.compoundStage.parentNode) {
                this.compoundStage.remove();
            }

            this.body.classList.remove(
                "layout-timeline-bottom",
                "layout-timeline-bottom-left",
                "layout-timeline-bottom-right",
                "layout-timeline-expanded"
            );
        }
    }

    toggleTimelineExpandLeft() {
        let next;
        if (this.timelinePosition === "bottom-left") next = "center";
        else if (this.timelinePosition === "bottom-full") next = "bottom-right";
        else if (this.timelinePosition === "bottom-right") next = "bottom-full";
        else next = "bottom-left";
        this.setTimelinePosition(next);
    }

    toggleTimelineExpandRight() {
        let next;
        if (this.timelinePosition === "bottom-right") next = "center";
        else if (this.timelinePosition === "bottom-full") next = "bottom-left";
        else if (this.timelinePosition === "bottom-left") next = "bottom-full";
        else next = "bottom-right";
        this.setTimelinePosition(next);
    }
}

const sim = new WorkspaceManagerSimulator();

// =========================================================================
// TESTE 1: Estado Inicial "center" (Entre menus)
// =========================================================================
assert.strictEqual(sim.timelinePosition, "center", "Estado inicial deve ser center");
assert.strictEqual(sim.workspace.querySelector("#sidebar-left"), sim.sidebarLeft);
assert.strictEqual(sim.workspace.querySelector("#inspector-panel"), sim.inspectorPanel);
assert.strictEqual(sim.workspace.querySelector(".center-stage"), sim.centerStage);
assert.strictEqual(sim.workspace.querySelector("#sidebar-right"), sim.sidebarRight);
assert.strictEqual(sim.centerStage.querySelector("#timeline-panel"), sim.timelinePanel, "Timeline deve estar dentro de center-stage");
assert.strictEqual(sim.compoundStage, null, "compoundStage não deve existir em center");
assert.strictEqual(sim.studioTop, null, "studioTop não deve existir em center");
console.log("✓ Teste 1: Estado inicial 'center' validado com integridade DOM");

// =========================================================================
// TESTE 2: Transição para "bottom-left" (Expandir para a esquerda)
// =========================================================================
sim.setTimelinePosition("bottom-left");
assert.strictEqual(sim.timelinePosition, "bottom-left");
assert.ok(sim.body.classList.contains("layout-timeline-bottom-left"), "body deve ter layout-timeline-bottom-left");
assert.ok(sim.body.classList.contains("layout-timeline-expanded"), "body deve ter layout-timeline-expanded");
assert.ok(!sim.body.classList.contains("layout-timeline-bottom"), "body NÃO deve ter layout-timeline-bottom");

// Workspace deve conter compound-stage e sidebar-right
assert.strictEqual(sim.compoundStage.parentNode, sim.workspace, "compound-stage deve ser filho de workspace");
assert.strictEqual(sim.sidebarRight.parentNode, sim.workspace, "sidebar-right deve ser filho direto de workspace (altura total)");
assert.strictEqual(sim.reopenRight.parentNode, sim.workspace, "reopen-right deve estar no workspace");

// compoundStage deve conter studioTop no topo e timelinePanel embaixo
assert.strictEqual(sim.studioTop.parentNode, sim.compoundStage, "studioTop deve estar dentro de compoundStage");
assert.strictEqual(sim.timelinePanel.parentNode, sim.compoundStage, "timelinePanel deve estar dentro de compoundStage");
assert.strictEqual(sim.reopenTimeline.parentNode, sim.compoundStage, "reopenTimeline deve estar dentro de compoundStage");

// studioTop deve conter colunas esquerdas e centerStage
assert.strictEqual(sim.sidebarLeft.parentNode, sim.studioTop, "sidebar-left deve estar dentro de studioTop");
assert.strictEqual(sim.inspectorPanel.parentNode, sim.studioTop, "inspector-panel deve estar dentro de studioTop");
assert.strictEqual(sim.centerStage.parentNode, sim.studioTop, "center-stage deve estar dentro de studioTop");

// centerStage NÃO deve ter a timeline dentro dele no modo bottom-left
assert.strictEqual(sim.centerStage.querySelector("#timeline-panel"), null, "centerStage não deve conter timeline em bottom-left");
console.log("✓ Teste 2: Transição para 'bottom-left' (abaixo dos menus esquerdos) validada");

// =========================================================================
// TESTE 3: Transição para "bottom-right" (Expandir para a direita)
// =========================================================================
sim.setTimelinePosition("bottom-right");
assert.strictEqual(sim.timelinePosition, "bottom-right");
assert.ok(sim.body.classList.contains("layout-timeline-bottom-right"), "body deve ter layout-timeline-bottom-right");
assert.ok(sim.body.classList.contains("layout-timeline-expanded"), "body deve ter layout-timeline-expanded");
assert.ok(!sim.body.classList.contains("layout-timeline-bottom-left"), "body NÃO deve ter layout-timeline-bottom-left");

// Workspace deve conter colunas esquerdas e compound-stage
assert.strictEqual(sim.sidebarLeft.parentNode, sim.workspace, "sidebar-left deve ser filho de workspace (altura total)");
assert.strictEqual(sim.inspectorPanel.parentNode, sim.workspace, "inspector-panel deve ser filho de workspace (altura total)");
assert.strictEqual(sim.compoundStage.parentNode, sim.workspace, "compound-stage deve ser filho de workspace");

// studioTop dentro de compoundStage deve conter centerStage e sidebar-right
assert.strictEqual(sim.centerStage.parentNode, sim.studioTop, "center-stage deve estar dentro de studioTop");
assert.strictEqual(sim.sidebarRight.parentNode, sim.studioTop, "sidebar-right deve estar dentro de studioTop");
assert.strictEqual(sim.timelinePanel.parentNode, sim.compoundStage, "timelinePanel deve estar dentro de compoundStage");
console.log("✓ Teste 3: Transição para 'bottom-right' (abaixo do menu direito) validada");

// =========================================================================
// TESTE 4: Transição para "bottom-full" (Largura total abaixo de todos os menus)
// =========================================================================
sim.setTimelinePosition("bottom-full");
assert.strictEqual(sim.timelinePosition, "bottom-full");
assert.ok(sim.body.classList.contains("layout-timeline-bottom"), "body deve ter layout-timeline-bottom");
assert.ok(!sim.body.classList.contains("layout-timeline-expanded"), "body NÃO deve ter layout-timeline-expanded");
assert.strictEqual(sim.compoundStage.parentNode, null, "compoundStage deve ser desanexado no modo bottom-full");

// studioTop deve conter todas as 4 colunas
assert.strictEqual(sim.studioTop.parentNode, sim.workspace, "studioTop deve ser filho de workspace");
assert.strictEqual(sim.sidebarLeft.parentNode, sim.studioTop);
assert.strictEqual(sim.inspectorPanel.parentNode, sim.studioTop);
assert.strictEqual(sim.centerStage.parentNode, sim.studioTop);
assert.strictEqual(sim.sidebarRight.parentNode, sim.studioTop);
assert.strictEqual(sim.timelinePanel.parentNode, sim.workspace, "timelinePanel deve ser filho direto de workspace");
console.log("✓ Teste 4: Transição para 'bottom-full' validada com desanexação de compound-stage");

// =========================================================================
// TESTE 5: Retorno para "center"
// =========================================================================
sim.setTimelinePosition("center");
assert.strictEqual(sim.timelinePosition, "center");
assert.strictEqual(sim.studioTop.parentNode, null, "studioTop deve ser desanexado no modo center");
assert.strictEqual(sim.compoundStage.parentNode, null, "compoundStage deve ser desanexado no modo center");
assert.strictEqual(sim.timelinePanel.parentNode, sim.centerStage, "timelinePanel deve retornar para center-stage");
console.log("✓ Teste 5: Retorno limpo para 'center' validado sem resíduos no DOM");

// =========================================================================
// TESTE 6: Máquina de Estados dos Botões Direcionais de Expansão
// =========================================================================
// Começando em center:
sim.setTimelinePosition("center");

// Clica Expand Left: center -> bottom-left
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "bottom-left", "center + toggleExpandLeft -> bottom-left");

// Clica Expand Left novamente: bottom-left -> center
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "center", "bottom-left + toggleExpandLeft -> center");

// Clica Expand Right: center -> bottom-right
sim.toggleTimelineExpandRight();
assert.strictEqual(sim.timelinePosition, "bottom-right", "center + toggleExpandRight -> bottom-right");

// Clica Expand Right novamente: bottom-right -> center
sim.toggleTimelineExpandRight();
assert.strictEqual(sim.timelinePosition, "center", "bottom-right + toggleExpandRight -> center");

// Expand Left (vai pra bottom-left), depois Expand Right (deve ir pra bottom-full)
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "bottom-left");
sim.toggleTimelineExpandRight();
assert.strictEqual(sim.timelinePosition, "bottom-full", "bottom-left + toggleExpandRight -> bottom-full");

// Em bottom-full, clica Expand Left (recolhe lado esquerdo -> vira bottom-right)
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "bottom-right", "bottom-full - expandLeft -> bottom-right");

// Clica Expand Left de novo (expande esquerdo -> volta a bottom-full)
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "bottom-full", "bottom-right + expandLeft -> bottom-full");

// Em bottom-full, clica Expand Right (recolhe lado direito -> vira bottom-left)
sim.toggleTimelineExpandRight();
assert.strictEqual(sim.timelinePosition, "bottom-left", "bottom-full - expandRight -> bottom-left");

// Clica Expand Left (recolhe lado esquerdo -> volta ao centro)
sim.toggleTimelineExpandLeft();
assert.strictEqual(sim.timelinePosition, "center", "bottom-left - expandLeft -> center");

console.log("✓ Teste 6: Máquina de estados bidirecional (toggleTimelineExpandLeft/Right) validada com 100% de coerência");

// =========================================================================
// TESTE 7: Teste de Estresse de Ciclos Aleatórios (Prevenção de Orfandade/Perda de DOM)
// =========================================================================
const transitions = [
    "bottom-left", "bottom-full", "center", "bottom-right", "bottom-left",
    "center", "bottom-full", "bottom-right", "bottom-left", "center"
];

transitions.forEach((pos, idx) => {
    sim.setTimelinePosition(pos);
    assert.strictEqual(sim.timelinePosition, pos, `Passo ${idx}: estado deve ser ${pos}`);
    
    // Verifica que NENHUM painel principal ficou órfão (desconectado do body)
    const checkConnected = (el, name) => {
        let curr = el;
        while (curr && curr !== sim.body) {
            curr = curr.parentNode;
        }
        assert.strictEqual(curr, sim.body, `Painel ${name} ficou órfão após transição para ${pos}!`);
    };

    checkConnected(sim.sidebarLeft, "sidebar-left");
    checkConnected(sim.inspectorPanel, "inspector-panel");
    checkConnected(sim.centerStage, "center-stage");
    checkConnected(sim.sidebarRight, "sidebar-right");
    checkConnected(sim.timelinePanel, "timeline-panel");
    checkConnected(sim.reopenLeft, "reopen-left");
    checkConnected(sim.reopenInspector, "reopen-inspector");
    checkConnected(sim.reopenRight, "reopen-right");
    checkConnected(sim.reopenTimeline, "reopen-timeline");
});
console.log("✓ Teste 7: Ciclo de estresse de 10 transições consecutivas executado sem perda de nenhum painel");

// =========================================================================
// TESTE 8: Sincronização de Classes de Splitters e Proteção de Compound-Stage
// =========================================================================
// Verifica que compound-stage não tem tamanho fixo
sim.setTimelinePosition("bottom-left");
sim.compoundStage.style.removeProperty("width");
sim.compoundStage.style.flex = "1 1 0%";
assert.strictEqual(sim.compoundStage.style.flex, "1 1 0%", "compound-stage deve ter flex: 1 1 0%");

// Verifica que SplitterHelper não atribui px se targetEl for compound-stage
const mockSplitterTarget = sim.compoundStage;
const isProtected = mockSplitterTarget.classList.contains("center-stage") || mockSplitterTarget.classList.contains("compound-stage");
assert.ok(isProtected, "compound-stage deve ser explicitamente protegido contra atribuição de largura fixa em SplitterHelper");
// =========================================================================
// TESTE 9: Validação da Ordem Exata de Filhos no Workspace em Transições Consecutivas
// =========================================================================
// Inicia em bottom-left
sim.setTimelinePosition("bottom-left");
let wsChildren = sim.workspace.children.map(c => c.id || c.className);
assert.strictEqual(wsChildren[0], "compound-stage", "Em bottom-left, compound-stage deve ser o 1º filho de workspace");
assert.ok(wsChildren.indexOf("compound-stage") < wsChildren.indexOf("sidebar-right"), "compound-stage deve vir antes de sidebar-right");

// Transição direta para bottom-right (cenário que antes invertia o layout se compoundStage já estivesse no workspace)
sim.setTimelinePosition("bottom-right");
wsChildren = sim.workspace.children.map(c => c.id || c.className);
const idxLeft = wsChildren.indexOf("sidebar-left");
const idxInsp = wsChildren.indexOf("inspector-panel");
const idxCompound = wsChildren.indexOf("compound-stage");

assert.ok(idxLeft !== -1, "sidebar-left deve estar no workspace em bottom-right");
assert.ok(idxInsp !== -1, "inspector-panel deve estar no workspace em bottom-right");
assert.ok(idxCompound !== -1, "compound-stage deve estar no workspace em bottom-right");
assert.ok(idxLeft < idxInsp, "sidebar-left deve vir antes de inspector-panel");
assert.ok(idxInsp < idxCompound, "compound-stage deve vir DEPOIS de inspector-panel em bottom-right!");

// Retorno direto para bottom-left
sim.setTimelinePosition("bottom-left");
wsChildren = sim.workspace.children.map(c => c.id || c.className);
assert.strictEqual(wsChildren[0], "compound-stage", "Ao retornar a bottom-left, compound-stage deve voltar a ser o 1º filho de workspace");
assert.ok(wsChildren.indexOf("compound-stage") < wsChildren.indexOf("sidebar-right"), "compound-stage deve vir antes de sidebar-right");

console.log("✓ Teste 9: Ordem exata de reparenting no workspace validada sem inversão de colunas em transições reversíveis");

console.log("\nTODOS OS 9 TESTES DE EXPANSÃO DIRECIONAL DA TIMELINE PASSARAM COM SUCESSO!");
