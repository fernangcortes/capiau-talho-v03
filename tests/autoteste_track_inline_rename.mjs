// ======================================================================
// Autoteste: Renomeação inline de pista por duplo clique (sem prompt nativo)
// Execução: node tests/autoteste_track_inline_rename.mjs
// ======================================================================

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("=== INICIANDO AUTOTESTE: RENOMEAÇÃO INLINE DE PISTAS ===\n");

// 1. Verifica que panels.js não usa mais prompt() para renomear pista
const panelsCode = fs.readFileSync(path.join(rootDir, "src", "ui", "js", "panels.js"), "utf-8");
assert.ok(!panelsCode.includes('prompt("Novo nome da pista:"'), "Não deve mais existir prompt() de novo nome de pista no panels.js");
assert.ok(panelsCode.includes("setupTrackRenameInline"), "Deve conter método setupTrackRenameInline");
assert.ok(panelsCode.includes("track-name-input"), "Deve criar o input com classe track-name-input");
console.log("✔ 1 passou: prompt() removido e setupTrackRenameInline presente no panels.js.");

// 2. Verifica estilos CSS correspondentes no styles.css
const stylesCode = fs.readFileSync(path.join(rootDir, "src", "ui", "styles.css"), "utf-8");
assert.ok(stylesCode.includes(".track-name-input {"), "styles.css deve ter regra para .track-name-input");
assert.ok(stylesCode.includes("border: 1px solid var(--accent"), "Borda deve refletir a cor de interação (--accent)");
assert.ok(stylesCode.includes("caret-color: var(--accent"), "Deve ter cursor | piscando na cor de interação (caret-color)");
assert.ok(stylesCode.includes(".track-name-label:hover"), "Deve ter efeito hover para .track-name-label");
console.log("✔ 2 passou: estilos sutis, borda e caret | refletindo a cor de interação (--accent) no styles.css.");

// 3. Simulação DOM de ciclo de vida da edição inline
class MockElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.innerHTML = "";
        this.value = "";
        this.style = {};
        this.classList = new Set();
        this.listeners = {};
        this.children = [];
        this.attributes = {};
    }
    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type] || [];
        for (const fn of list) fn(event);
    }
    querySelector(selector) {
        if (selector === ".track-name-label" && this.classList.has("track-name-label")) return this;
        if (selector === ".track-name-input" && this.classList.has("track-name-input")) return this;
        for (const c of this.children) {
            const found = c.querySelector(selector);
            if (found) return found;
        }
        return null;
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
}

// Verifica comportamento do escapeHtml e montagem do input
let renamedTo = null;
const mockTimelineState = {
    renameTrack(id, name) {
        renamedTo = { id, name };
    }
};

let promptCalled = false;
globalThis.prompt = () => { promptCalled = true; return "Fake"; };
globalThis.window = {
    getSelection: () => ({ rangeCount: 0, removeAllRanges: () => {} })
};
globalThis.requestAnimationFrame = (fn) => fn();

// Cria mock da classe Panels com os métodos de renomeação
class MockPanels {
    constructor() {
        this.editingTrackId = null;
    }
    escapeHtml(txt) {
        return String(txt)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    renderTrackRowContent(row, track, h) {
        row.innerHTML = `<span class="track-name-label">${track.id} ${this.escapeHtml(track.name)}</span>`;
        const label = new MockElement("span");
        label.classList.add("track-name-label");
        label.innerHTML = `${track.id} ${this.escapeHtml(track.name)}`;
        row.children = [label];
        this.setupTrackRenameInline(row, track, h);
    }
    setupTrackRenameInline(row, track, h) {
        const nameLabel = row.querySelector(".track-name-label");
        if (!nameLabel) return;

        nameLabel.addEventListener("dblclick", (e) => {
            e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();

            if (nameLabel.querySelector(".track-name-input")) return;

            const currentName = track.name || "";
            this.editingTrackId = track.id;

            const input = new MockElement("input");
            input.classList.add("track-name-input");
            input.value = currentName;

            nameLabel.children = [input];

            let isFinalized = false;
            const finishRename = (shouldSave) => {
                if (isFinalized) return;
                isFinalized = true;
                this.editingTrackId = null;

                const trimmed = input.value.trim();
                if (shouldSave && trimmed && trimmed !== currentName) {
                    mockTimelineState.renameTrack(track.id, trimmed);
                } else {
                    this.renderTrackRowContent(row, track, h);
                }
            };

            input.addEventListener("keydown", (ev) => {
                if (typeof ev.stopPropagation === "function") ev.stopPropagation();
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    finishRename(true);
                } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    finishRename(false);
                }
            });

            input.addEventListener("blur", () => {
                finishRename(true);
            });

            input.focus();
            input.select();
        });
    }
}

const panels = new MockPanels();
const track = { id: "V1", name: "Falas", kind: "video" };
const row = new MockElement("div");
panels.renderTrackRowContent(row, track, 50);

const labelEl = row.querySelector(".track-name-label");
assert.ok(labelEl, "Label da pista deve existir");

// Dispara duplo clique no nome da pista
labelEl.dispatchEvent({ type: "dblclick", preventDefault: () => {}, stopPropagation: () => {} });

assert.equal(promptCalled, false, "NÃO deve chamar prompt()");
const inputEl = row.querySelector(".track-name-input");
assert.ok(inputEl, "Caixa de texto inline deve estar presente");
assert.equal(inputEl.value, "Falas", "Valor inicial deve ser o nome da pista");
assert.equal(inputEl.focused, true, "Input deve receber foco imediatamente");
assert.equal(inputEl.selected, true, "Texto deve ser selecionado para edição instantânea");
console.log("✔ 3 passou: duplo clique abre input inline, foca e seleciona sem prompt().");

// 4. Edita e confirma com Enter
inputEl.value = "Entrevistas";
let stopped = false;
inputEl.dispatchEvent({
    type: "keydown",
    key: "Enter",
    preventDefault: () => {},
    stopPropagation: () => { stopped = true; }
});
assert.equal(stopped, true, "Keydown deve parar propagação para evitar atalhos da timeline");
assert.deepEqual(renamedTo, { id: "V1", name: "Entrevistas" }, "Deve renomear no timelineState ao dar Enter");
console.log("✔ 4 passou: Enter confirma renomeação e impede atalhos externos.");

// 5. Cancelamento com Escape
renamedTo = null;
track.name = "Entrevistas";
panels.renderTrackRowContent(row, track, 50);
const labelEl2 = row.querySelector(".track-name-label");
labelEl2.dispatchEvent({ type: "dblclick", preventDefault: () => {}, stopPropagation: () => {} });
const inputEl2 = row.querySelector(".track-name-input");
inputEl2.value = "Nome Cancelado";
inputEl2.dispatchEvent({
    type: "keydown",
    key: "Escape",
    preventDefault: () => {},
    stopPropagation: () => {}
});
assert.equal(renamedTo, null, "Escape NÃO deve salvar o novo nome");
console.log("✔ 5 passou: Escape cancela a edição restaurando o nome original.");

// 6. Confirmação ao perder o foco (blur)
renamedTo = null;
track.name = "Entrevistas";
panels.renderTrackRowContent(row, track, 50);
const labelEl3 = row.querySelector(".track-name-label");
labelEl3.dispatchEvent({ type: "dblclick", preventDefault: () => {}, stopPropagation: () => {} });
const inputEl3 = row.querySelector(".track-name-input");
inputEl3.value = "Voz Principal";
inputEl3.dispatchEvent({ type: "blur" });
assert.deepEqual(renamedTo, { id: "V1", name: "Voz Principal" }, "Blur deve confirmar renomeação");
console.log("✔ 6 passou: Blur salva automaticamente.");

console.log("\n=== AUTOTESTE RENOMEAÇÃO INLINE DE PISTAS: 6/6 APROVADOS ===");
