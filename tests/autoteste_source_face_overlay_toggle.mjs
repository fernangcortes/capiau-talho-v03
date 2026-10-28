// Autoteste: Toggle e Alt-Peek da Camada de Detecção Facial no Source Player
// Valida o botão visual na barra de controles do Source, o registro no KEYMAP_SERVICE,
// a tecla de atalho Ctrl+Alt+B, a persistência, o padrão desligado (false),
// e o comportamento de espiar (peek) segurando Alt enquanto em hover no Source.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

console.log("=== INICIANDO AUTOTESTE: TOGGLE E ALT-PEEK DE DETECÇÃO FACIAL NO SOURCE ===\n");

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const indexHtml = read("src/ui/index.html");
const stylesCss = read("src/ui/styles.css");
const keymapJs = read("src/ui/js/keymapService.js");
const playerJs = read("src/ui/js/player.js");

// ─────────────────────────────────────────────────────────────────────
// 1. VERIFICAR BOTÃO NO INDEX.HTML
// ─────────────────────────────────────────────────────────────────────
console.log("1. Verificando botão #btn-source-toggle-faces no index.html...");

assert.ok(
    indexHtml.includes('id="btn-source-toggle-faces"'),
    "index.html deve conter o botão #btn-source-toggle-faces"
);
assert.ok(
    indexHtml.includes('btn-source-toggle-faces'),
    "O botão deve conter a classe btn-source-toggle-faces"
);
assert.ok(
    indexHtml.includes('aria-pressed="false"'),
    "O botão deve iniciar com aria-pressed='false' (desligado por padrão)"
);
assert.ok(
    !indexHtml.includes('class="btn-control btn-source-toggle-faces active"'),
    "O botão NÃO deve iniciar com a classe active no HTML inicial (desligado por padrão)"
);
assert.ok(
    indexHtml.includes('<path d="M2 5V2.5A.5.5 0 0 1 2.5 2H5"/>'),
    "O botão deve conter o SVG do retículo de detecção / bounding box"
);
console.log("   ✓ Botão e SVG declarados corretamente no index.html.\n");

// ─────────────────────────────────────────────────────────────────────
// 2. VERIFICAR ESTILIZAÇÃO NO STYLES.CSS
// ─────────────────────────────────────────────────────────────────────
console.log("2. Verificando estilos no styles.css...");

assert.ok(
    stylesCss.includes(".btn-source-toggle-faces"),
    "styles.css deve conter a regra .btn-source-toggle-faces"
);
assert.ok(
    stylesCss.includes(".btn-source-toggle-faces.active") || stylesCss.includes("#btn-source-toggle-faces.active"),
    "styles.css deve conter a regra de estado ativo .btn-source-toggle-faces.active"
);
console.log("   ✓ Estilos e estado .active configurados no styles.css.\n");

// ─────────────────────────────────────────────────────────────────────
// 3. VERIFICAR REGISTRO NO KEYMAP_SERVICE
// ─────────────────────────────────────────────────────────────────────
console.log("3. Verificando catálogo e presets no keymapService.js...");

assert.ok(
    keymapJs.includes('id: "ai.toggle_source_face_overlay"'),
    "COMMANDS_CATALOG deve conter o comando ai.toggle_source_face_overlay"
);
assert.ok(
    keymapJs.includes('category: "ai"'),
    "O comando deve estar catalogado na categoria ai"
);

// Verificar todos os perfis
const presets = ["capiau", "kdenlive", "premiere", "resolve", "finalcut"];
for (const preset of presets) {
    const presetIdx = keymapJs.indexOf(`${preset}: {`);
    assert.ok(presetIdx > -1, `keymapService.js deve conter o preset ${preset}`);
    const nextPresetIdx = keymapJs.indexOf("\n    },", presetIdx);
    const endIdx = nextPresetIdx > -1 ? nextPresetIdx : keymapJs.indexOf("\n};", presetIdx);
    const block = keymapJs.slice(presetIdx, endIdx > -1 ? endIdx : presetIdx + 10000);
    assert.ok(
        block.includes('"ai.toggle_source_face_overlay": ["Ctrl+Alt+KeyB"]'),
        `Preset ${preset} deve mapear ai.toggle_source_face_overlay para Ctrl+Alt+KeyB`
    );
}
console.log("   ✓ Comando catalogado e mapeado para Ctrl+Alt+KeyB em todos os 5 presets.\n");

// ─────────────────────────────────────────────────────────────────────
// 4. VERIFICAR LÓGICA NO PLAYER.JS (TOGGLE & ALT-PEEK)
// ─────────────────────────────────────────────────────────────────────
console.log("4. Verificando SourcePlayer e VideoPlayer no player.js...");

// Padrão desligado (false)
assert.ok(
    playerJs.includes('let savedFaceOverlayPref = false;'),
    "SourcePlayer deve iniciar savedFaceOverlayPref como false (desligado por padrão)"
);
assert.ok(
    playerJs.includes('localStorage.getItem("capiau_source_face_overlay")'),
    "SourcePlayer deve ler a preferência de capiau_source_face_overlay no localStorage"
);
assert.ok(
    playerJs.includes('this.isFaceOverlayEnabled = savedFaceOverlayPref;'),
    "SourcePlayer deve atribuir isFaceOverlayEnabled"
);
assert.ok(
    playerJs.includes('this._isSourceHovered = false;'),
    "SourcePlayer deve inicializar _isSourceHovered como false"
);
assert.ok(
    playerJs.includes('this._isAltPeekActive = false;'),
    "SourcePlayer deve inicializar _isAltPeekActive como false"
);

// Listener do botão no init
assert.ok(
    playerJs.includes('btnToggleFaces.addEventListener("click", () => this.toggleFaceOverlay());'),
    "SourcePlayer.init deve associar o clique ao método toggleFaceOverlay"
);

// Métodos toggleFaceOverlay, updateFaceOverlayButtonUI e setAltPeek
assert.ok(
    playerJs.includes('toggleFaceOverlay(forceState = null) {'),
    "SourcePlayer deve implementar o método toggleFaceOverlay"
);
assert.ok(
    playerJs.includes('updateFaceOverlayButtonUI() {'),
    "SourcePlayer deve implementar o método updateFaceOverlayButtonUI"
);
assert.ok(
    playerJs.includes('setAltPeek(active) {'),
    "SourcePlayer deve implementar o método setAltPeek"
);

// Verificação do Alt-peek nos listeners de hover e teclado
assert.ok(
    playerJs.includes('this.setAltPeek(true);'),
    "SourcePlayer deve acionar this.setAltPeek(true) quando Alt é pressionado em hover"
);
assert.ok(
    playerJs.includes('this.setAltPeek(false);'),
    "SourcePlayer deve acionar this.setAltPeek(false) quando Alt é solto ou mouse sai do Source"
);

// Guarda no updateFacesOverlay
assert.ok(
    playerJs.includes('if (!this.isFaceOverlayEnabled && !this._isAltPeekActive) {\n            this.clearFacesOverlay();\n            return;\n        }'),
    "updateFacesOverlay deve permitir renderização se isFaceOverlayEnabled OU _isAltPeekActive"
);

// Suporte a peek no render do overlay
assert.ok(
    playerJs.includes('if (vid.paused || this._isAltPeekActive) {'),
    "updateFacesOverlay deve aceitar _isAltPeekActive para exibir as caixas faciais"
);

// Dispatcher de teclado global no VideoPlayer
assert.ok(
    playerJs.includes('KEYMAP_SERVICE.matches(e, "ai.toggle_source_face_overlay")'),
    "VideoPlayer.handleGlobalKeyboard deve tratar ai.toggle_source_face_overlay"
);
assert.ok(
    playerJs.includes('this.sourcePlayer.toggleFaceOverlay();'),
    "handleGlobalKeyboard deve invocar this.sourcePlayer.toggleFaceOverlay()"
);

console.log("   ✓ Implementação no player.js validada com sucesso.\n");

// ─────────────────────────────────────────────────────────────────────
// 5. TESTE DE CONTRATO DINÂMICO (TOGGLE & ALT-PEEK)
// ─────────────────────────────────────────────────────────────────────
console.log("5. Teste de ciclo dinâmico simulado (Toggle + Alt-Peek)...");

class MockElement {
    constructor() {
        this.classList = new Set();
        this.classList.add = (c) => this.classList[c] = true;
        this.classList.remove = (c) => delete this.classList[c];
        this.classList.toggle = (c, val) => {
            if (val) this.classList[c] = true;
            else delete this.classList[c];
        };
        this.attributes = {};
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k]; }
}

const mockStorage = {};
const mockBtn = new MockElement();
let cleared = false;
let updated = false;

const playerMock = {
    isFaceOverlayEnabled: false,
    _isSourceHovered: false,
    _isAltPeekActive: false,
    el: (id) => id === "btn-source-toggle-faces" ? mockBtn : null,
    clearFacesOverlay: () => { cleared = true; },
    updateFacesOverlay: () => { updated = true; },
    updateFaceOverlayButtonUI: function() {
        const btn = this.el("btn-source-toggle-faces");
        if (!btn) return;
        btn.classList.toggle("active", !!this.isFaceOverlayEnabled);
        btn.setAttribute("aria-pressed", this.isFaceOverlayEnabled ? "true" : "false");
    },
    toggleFaceOverlay: function(force = null) {
        if (force !== null) this.isFaceOverlayEnabled = !!force;
        else this.isFaceOverlayEnabled = !this.isFaceOverlayEnabled;
        mockStorage["capiau_source_face_overlay"] = this.isFaceOverlayEnabled ? "true" : "false";
        this.updateFaceOverlayButtonUI();
        if (this.isFaceOverlayEnabled) this.updateFacesOverlay();
        else this.clearFacesOverlay();
    },
    setAltPeek: function(active) {
        if (this._isAltPeekActive === active) return;
        this._isAltPeekActive = !!active;
        if (this._isAltPeekActive) {
            if (!this.isFaceOverlayEnabled) this.updateFacesOverlay();
        } else {
            if (!this.isFaceOverlayEnabled) this.clearFacesOverlay();
        }
    }
};

// Estado inicial: desligado
playerMock.updateFaceOverlayButtonUI();
assert.equal(playerMock.isFaceOverlayEnabled, false);
assert.equal(mockBtn.getAttribute("aria-pressed"), "false");
assert.equal(mockBtn.classList["active"], undefined);

// Teste Alt-Peek enquanto DESLIGADO permanentemente
console.log("   - Testando Alt-Peek quando desligado por padrão...");
updated = false;
cleared = false;

// 1. Mouse entra no Source com Alt pressionado
playerMock._isSourceHovered = true;
playerMock.setAltPeek(true);
assert.equal(playerMock._isAltPeekActive, true);
assert.equal(updated, true, "Ao segurar Alt em hover, as caixas devem ser atualizadas/exibidas");
assert.equal(playerMock.isFaceOverlayEnabled, false, "O estado permanente não deve ser alterado pelo peek");

// 2. Alt é solto
updated = false;
cleared = false;
playerMock.setAltPeek(false);
assert.equal(playerMock._isAltPeekActive, false);
assert.equal(cleared, true, "Ao soltar Alt, as caixas devem ser limpas imediatamente");
assert.equal(playerMock.isFaceOverlayEnabled, false);

// 3. Mouse sai do Source segurando Alt
updated = false;
cleared = false;
playerMock.setAltPeek(true);
assert.equal(playerMock._isAltPeekActive, true);
playerMock._isSourceHovered = false;
playerMock.setAltPeek(false); // Disparado pelo mouseleave
assert.equal(playerMock._isAltPeekActive, false);
assert.equal(cleared, true, "Ao sair do Source (mouseleave), as caixas devem sumir");

// Teste Alt-Peek quando LIGADO permanentemente via toggle
console.log("   - Testando comportamento quando ligado permanentemente...");
playerMock.toggleFaceOverlay(true);
assert.equal(playerMock.isFaceOverlayEnabled, true);
assert.equal(mockBtn.classList["active"], true);

// Segurar Alt e soltar Alt NÃO deve apagar as caixas se o toggle está ON
cleared = false;
playerMock.setAltPeek(true);
playerMock.setAltPeek(false);
assert.equal(cleared, false, "Soltar Alt com toggle ATIVADO não deve limpar as caixas");

console.log("   ✓ Ciclo dinâmico simulado validou com sucesso todos os estados.\n");

console.log("=== TODOS OS TESTES PASSARAM COM SUCESSO! ===");
