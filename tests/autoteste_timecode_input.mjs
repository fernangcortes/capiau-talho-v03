// tests/autoteste_timecode_input.mjs
// Autoteste automatizado da Task 11: Display de Timecode Interativo & Navegação Numérica (+frames, -frames)
// Execução: node tests/autoteste_timecode_input.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── Polyfills de ambiente de navegador para execução em Node.js ESM ──
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

const domRegistry = {};
function makeEl(id) {
    const el = {
        id: id || "",
        style: {},
        innerHTML: "",
        textContent: "00:00:00:00",
        value: "",
        checked: false,
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            toggle(c) { if (this._list.has(c)) this._list.delete(c); else this._list.add(c); },
            contains(c) { return this._list.has(c); }
        },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k] ?? null; },
        appendChild(child) {
            if (!el.children) el.children = [];
            el.children.push(child);
            child.parentNode = el;
        },
        insertBefore(newChild, refChild) {
            if (!el.children) el.children = [];
            el.children.push(newChild);
            newChild.parentNode = el;
        },
        removeChild(child) {
            if (el.children) el.children = el.children.filter(c => c !== child);
            child.parentNode = null;
        },
        _listeners: {},
        addEventListener(evt, fn) {
            this._listeners[evt] = this._listeners[evt] || [];
            this._listeners[evt].push(fn);
        },
        removeEventListener(evt, fn) {
            if (this._listeners[evt]) {
                this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
            }
        },
        dispatchEvent(evt) {
            const fns = this._listeners[evt.type || evt] || [];
            fns.forEach(fn => fn(evt));
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
        select() {}
    };
    return el;
}

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } },
    addEventListener: () => {},
    removeEventListener: () => {}
};

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 11: TIMECODE INTERATIVO & NAVEGAÇÃO");
console.log("===============================================================================\n");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Registro e Paridade do Atalho navigation.goto_timecode
// ─────────────────────────────────────────────────────────────────────────────
console.log("▶ [Bateria 1] Atalho navigation.goto_timecode registrado e consistente nos 5 perfis NLE");
const keymapModuleUrl = pathToFileURL(path.join(raiz, "src", "ui", "js", "keymapService.js")).href;
const { COMMANDS_CATALOG, KEYMAP_PRESETS } = await import(keymapModuleUrl);

const gotoCmd = COMMANDS_CATALOG.find(c => c.id === "navigation.goto_timecode");
assert.ok(gotoCmd, "Comando 'navigation.goto_timecode' deve estar cadastrado no COMMANDS_CATALOG");
assert.equal(gotoCmd.category, "playback", "Categoria deve ser 'playback'");
assert.ok(gotoCmd.label.includes("Timecode"), "Rótulo deve mencionar Timecode");
assert.ok(gotoCmd.description.includes("+/-") || gotoCmd.description.includes("timecode"), "Descrição deve explicar navegação relativa/absoluta");

const presets = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
for (const p of presets) {
    const keys = KEYMAP_PRESETS[p]?.["navigation.goto_timecode"];
    assert.ok(keys && Array.isArray(keys) && keys.length > 0, `Preset '${p}' deve conter atalho para 'navigation.goto_timecode'`);
    if (p === "finalcut") {
        assert.ok(keys.includes("Ctrl+KeyP"), "Final Cut Pro deve suportar Ctrl+KeyP (Go to Timecode)");
    } else {
        assert.ok(keys.includes("Ctrl+KeyG"), `Preset '${p}' deve conter Ctrl+KeyG`);
    }
}
console.log("  ✓ Atalho navigation.goto_timecode validado com paridade nos 5 perfis NLE");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Elementos DOM e Integridade de Estilos CSS
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 2] Presença de elementos DOM e integridade de estilos CSS");
const htmlContent = fs.readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
const cssContent = fs.readFileSync(path.join(raiz, "src", "ui", "styles.css"), "utf8");

// Elementos interativos
assert.ok(htmlContent.includes('id="source-current-time"') && htmlContent.includes('interactive-timecode'), "source-current-time deve ter classe interactive-timecode");
assert.ok(htmlContent.includes('id="program-current-time"') && htmlContent.includes('interactive-timecode'), "program-current-time deve ter classe interactive-timecode");
assert.ok(htmlContent.includes('id="timeline-current-time"'), "timeline-current-time deve existir no cabeçalho da timeline");
assert.ok(htmlContent.includes('id="timeline-timecode-box"'), "timeline-timecode-box deve envolver timeline-current-time");

// Cache-buster v=50
assert.ok(htmlContent.includes('styles.css?v=50'), "styles.css deve estar versionado com ?v=50");
assert.ok(htmlContent.includes('main.js?v=50'), "main.js deve estar versionado com ?v=50");

// CSS classes
assert.ok(cssContent.includes('.interactive-timecode'), "styles.css deve conter .interactive-timecode");
assert.ok(cssContent.includes('.timecode-inline-input'), "styles.css deve conter .timecode-inline-input");
assert.ok(cssContent.includes('.timeline-timecode-box'), "styles.css deve conter .timeline-timecode-box");
assert.ok(cssContent.includes('timecodeShake'), "styles.css deve conter animação timecodeShake");
console.log("  ✓ Elementos DOM, seletores CSS e cache-buster v=50 validados com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Parsing de Deslocamento Relativo em Frames (+50, -24, +48, +0)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 3] Parsing de Deslocamento Relativo em Frames (+50, -24, +48, +0)");
const playerModuleUrl = pathToFileURL(path.join(raiz, "src", "ui", "js", "player.js")).href;
const { parseTimecodeNavigation, formatTimecode } = await import(playerModuleUrl);

// +50 frames a partir do frame 100
const r1 = parseTimecodeNavigation("+50", 100, 24);
assert.equal(r1.valid, true);
assert.equal(r1.isRelative, true);
assert.equal(r1.deltaFrames, 50);
assert.equal(r1.targetFrame, 150);

// -24 frames a partir do frame 100
const r2 = parseTimecodeNavigation("-24", 100, 24);
assert.equal(r2.valid, true);
assert.equal(r2.isRelative, true);
assert.equal(r2.deltaFrames, -24);
assert.equal(r2.targetFrame, 76);

// +48 frames a partir do frame 0 (teste do manual)
const r3 = parseTimecodeNavigation("+48", 0, 24);
assert.equal(r3.valid, true);
assert.equal(r3.isRelative, true);
assert.equal(r3.deltaFrames, 48);
assert.equal(r3.targetFrame, 48);
assert.equal(r3.formattedTimecode, "00:00:02:00");

// + 50 (com espaço)
const r4 = parseTimecodeNavigation("+ 50", 100, 24);
assert.equal(r4.valid, true);
assert.equal(r4.deltaFrames, 50);
assert.equal(r4.targetFrame, 150);

// Sufixo f / frames
const r5 = parseTimecodeNavigation("+50f", 100, 24);
assert.equal(r5.valid, true);
assert.equal(r5.deltaFrames, 50);
assert.equal(r5.targetFrame, 150);

const r6 = parseTimecodeNavigation("-10frames", 50, 24);
assert.equal(r6.valid, true);
assert.equal(r6.deltaFrames, -10);
assert.equal(r6.targetFrame, 40);

console.log("  ✓ Parsing relativo em frames validado com 100% de exatidão");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Parsing de Deslocamento Relativo em Segundos (+2s, -1.5s)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 4] Parsing de Deslocamento Relativo em Segundos (+2s, -1.5s)");
// +2s a 24fps = +48 frames
const rs1 = parseTimecodeNavigation("+2s", 24, 24);
assert.equal(rs1.valid, true);
assert.equal(rs1.isRelative, true);
assert.equal(rs1.deltaFrames, 48);
assert.equal(rs1.targetFrame, 72);

// -1.5s a 24fps = -36 frames
const rs2 = parseTimecodeNavigation("-1.5s", 72, 24);
assert.equal(rs2.valid, true);
assert.equal(rs2.isRelative, true);
assert.equal(rs2.deltaFrames, -36);
assert.equal(rs2.targetFrame, 36);

// +0.5s a 30fps = +15 frames
const rs3 = parseTimecodeNavigation("+0.5s", 0, 30);
assert.equal(rs3.valid, true);
assert.equal(rs3.deltaFrames, 15);
assert.equal(rs3.targetFrame, 15);

console.log("  ✓ Parsing relativo em segundos (+2s, -1.5s) validado com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Parsing de Notação por Pontos NLE (1., 10., 1.., +1., -2.)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 5] Parsing de Notação por Pontos NLE (1., 10., 1.., +1., -2.)");
// 1. = 1 segundo = 24 frames
const rp1 = parseTimecodeNavigation("1.", 0, 24);
assert.equal(rp1.valid, true);
assert.equal(rp1.isRelative, false);
assert.equal(rp1.targetFrame, 24);

// 10. = 10 segundos = 240 frames
const rp2 = parseTimecodeNavigation("10.", 0, 24);
assert.equal(rp2.valid, true);
assert.equal(rp2.targetFrame, 240);

// 1.. = 1 minuto = 60 segundos = 1440 frames
const rp3 = parseTimecodeNavigation("1..", 0, 24);
assert.equal(rp3.valid, true);
assert.equal(rp3.targetFrame, 1440);

// +1. = +1 segundo = +24 frames
const rp4 = parseTimecodeNavigation("+1.", 24, 24);
assert.equal(rp4.valid, true);
assert.equal(rp4.isRelative, true);
assert.equal(rp4.deltaFrames, 24);
assert.equal(rp4.targetFrame, 48);

// -2. = -2 segundos = -48 frames
const rp5 = parseTimecodeNavigation("-2.", 48, 24);
assert.equal(rp5.valid, true);
assert.equal(rp5.deltaFrames, -48);
assert.equal(rp5.targetFrame, 0);

console.log("  ✓ Shorthand por pontos NLE (1., 10., 1..) validado com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Parsing de Timecode Absoluto SMPTE (00:01:23:12, 01:23:12, 01:23)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 6] Parsing de Timecode Absoluto SMPTE (00:01:23:12, 01:23:12, 01:23)");
// 00:01:23:12 a 24fps = (1*60 + 23)*24 + 12 = 83*24 + 12 = 1992 + 12 = 2004 frames
const smp1 = parseTimecodeNavigation("00:01:23:12", 0, 24);
assert.equal(smp1.valid, true);
assert.equal(smp1.isRelative, false);
assert.equal(smp1.targetFrame, 2004);
assert.equal(smp1.formattedTimecode, "00:01:23:12");

// 01:23:12 (3 partes: MM:SS:FF)
const smp2 = parseTimecodeNavigation("01:23:12", 0, 24);
assert.equal(smp2.valid, true);
assert.equal(smp2.targetFrame, 2004);

// 01:23 (2 partes: MM:SS) = 83s * 24 = 1992 frames
const smp3 = parseTimecodeNavigation("01:23", 0, 24);
assert.equal(smp3.valid, true);
assert.equal(smp3.targetFrame, 1992);

// Timecode relativo: +00:00:02:00 a partir de frame 24
const smp4 = parseTimecodeNavigation("+00:00:02:00", 24, 24);
assert.equal(smp4.valid, true);
assert.equal(smp4.isRelative, true);
assert.equal(smp4.deltaFrames, 48);
assert.equal(smp4.targetFrame, 72);

console.log("  ✓ Timecode SMPTE absoluto e relativo validado com exatidão");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Parsing de Tempo Absoluto em Segundos e Frames (83s, 1.5s, 150f)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 7] Parsing de Tempo Absoluto em Segundos e Frames (83s, 1.5s, 150f)");
// 83s a 24fps = 1992 frames
const abs1 = parseTimecodeNavigation("83s", 0, 24);
assert.equal(abs1.valid, true);
assert.equal(abs1.isRelative, false);
assert.equal(abs1.targetFrame, 1992);
assert.equal(abs1.formattedTimecode, "00:01:23:00");

// 1.5s a 24fps = 36 frames
const abs2 = parseTimecodeNavigation("1.5s", 0, 24);
assert.equal(abs2.valid, true);
assert.equal(abs2.targetFrame, 36);

// 150f
const abs3 = parseTimecodeNavigation("150f", 0, 24);
assert.equal(abs3.valid, true);
assert.equal(abs3.targetFrame, 150);

console.log("  ✓ Formatos absolutos (83s, 1.5s, 150f) validados com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Shorthand NLE Numérico Puro (12312, 1200, 100, 50, 150)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 8] Shorthand NLE Numérico Puro (12312, 1200, 100, 50, 150)");
// "50" <= 2 dígitos -> frame 50
const sh1 = parseTimecodeNavigation("50", 0, 24);
assert.equal(sh1.valid, true);
assert.equal(sh1.targetFrame, 50);

// "100" -> SS=01, FF=00 -> 1 segundo = 24 frames
const sh2 = parseTimecodeNavigation("100", 0, 24);
assert.equal(sh2.valid, true);
assert.equal(sh2.targetFrame, 24);

// "1200" -> SS=12, FF=00 -> 12 segundos = 288 frames
const sh3 = parseTimecodeNavigation("1200", 0, 24);
assert.equal(sh3.valid, true);
assert.equal(sh3.targetFrame, 288);

// "12312" -> MM=01, SS=23, FF=12 -> 01:23:12 = 2004 frames
const sh4 = parseTimecodeNavigation("12312", 0, 24);
assert.equal(sh4.valid, true);
assert.equal(sh4.targetFrame, 2004);

// "150" a 24fps: FF=50 >= 24 -> trata diretamente como frame 150
const sh5 = parseTimecodeNavigation("150", 0, 24);
assert.equal(sh5.valid, true);
assert.equal(sh5.targetFrame, 150);

console.log("  ✓ Shorthand numérico clássico da indústria (12312, 1200, 100) validado com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Tratamento de Entradas Inválidas e Fallbacks Seguros
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 9] Tratamento de Entradas Inválidas e Fallbacks Seguros");
const curTest = 120;
assert.equal(parseTimecodeNavigation("", curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation("   ", curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation("abc", curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation("+", curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation("-xyz", curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation(null, curTest, 24).valid, false);
assert.equal(parseTimecodeNavigation(undefined, curTest, 24).valid, false);

// Em caso de erro, targetFrame deve ser mantido igual ao currentFrame
const errRes = parseTimecodeNavigation("invalido", curTest, 24);
assert.equal(errRes.targetFrame, curTest);
assert.equal(errRes.deltaFrames, 0);

console.log("  ✓ Entradas inválidas rejeitadas com segurança e integridade preservada");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Clamping de Limites (Frame >= 0 e maxFrames)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 10] Clamping de Limites (Frame >= 0 e maxFrames)");
// Recuo além de zero deve travar em 0
const c1 = parseTimecodeNavigation("-50", 20, 24);
assert.equal(c1.valid, true);
assert.equal(c1.targetFrame, 0);
assert.equal(c1.deltaFrames, -20);

// Avanço além de maxFrames deve travar em maxFrames
const c2 = parseTimecodeNavigation("+100", 40, 24, 100);
assert.equal(c2.valid, true);
assert.equal(c2.targetFrame, 100);
assert.equal(c2.deltaFrames, 60);

// Salto absoluto além de maxFrames
const c3 = parseTimecodeNavigation("99999s", 0, 24, 2400);
assert.equal(c3.valid, true);
assert.equal(c3.targetFrame, 2400);

console.log("  ✓ Clamping bidirecional seguro validado com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Micro-Interação Inline e Ciclo de Vida do Input (Simulação DOM)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 11] Micro-Interação Inline e Ciclo de Vida do Input");
const { setupInteractiveTimecode } = await import(playerModuleUrl);

const parentMock = makeEl("parent-container");
const spanMock = makeEl("test-timecode");
spanMock.textContent = "00:00:10:00";
parentMock.appendChild(spanMock);

let committedResult = null;
const controller = setupInteractiveTimecode(
    spanMock,
    () => ({ currentFrame: 240, fps: 24, maxFrames: 1000 }),
    (res) => { committedResult = res; }
);

assert.ok(spanMock.classList.contains("interactive-timecode"), "Elemento deve ter classe .interactive-timecode");
assert.ok(controller && typeof controller.activate === "function", "setupInteractiveTimecode deve retornar objeto com método activate");

// Ativação por clique
spanMock.dispatchEvent({ type: "click", stopPropagation() {} });
assert.equal(spanMock.style.display, "none", "Span original deve ser ocultado ao ativar edição");
assert.equal(parentMock.children.length, 2, "Input inline deve ser inserido no contêiner pai");

const inputMock = parentMock.children[1];
assert.equal(inputMock.className, "timecode-inline-input", "Input deve ter classe .timecode-inline-input");
assert.equal(inputMock.value, "00:00:10:00", "Input deve iniciar com o timecode atual");

// Simulação de confirmação com Enter ("+48")
inputMock.value = "+48";
inputMock.dispatchEvent({ type: "keydown", key: "Enter", preventDefault() {}, stopPropagation() {} });

assert.ok(committedResult, "Callback onCommitFn deve ser invocado no Enter");
assert.equal(committedResult.targetFrame, 288, "240 + 48 = 288 frames");
assert.equal(parentMock.children.length, 1, "Input deve ser removido após confirmação");
assert.equal(spanMock.style.display, "", "Span original deve ser reexibido");

console.log("  ✓ Ciclo de vida completo do input inline (Enter/Commit/Cleanup) validado com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 12: Cancelamento com Escape e Ajuste Fino com Setas
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 12] Cancelamento com Escape e Ajuste Fino com Setas");
const parentMock2 = makeEl("parent-container-2");
const spanMock2 = makeEl("test-timecode-2");
spanMock2.textContent = "00:00:05:00";
parentMock2.appendChild(spanMock2);

let committed2 = null;
const controller2 = setupInteractiveTimecode(
    spanMock2,
    () => ({ currentFrame: 120, fps: 24 }),
    (res) => { committed2 = res; }
);

// Ativa
controller2.activate();
assert.equal(spanMock2.style.display, "none");
assert.equal(parentMock2.children.length, 2);
const inputMock2 = parentMock2.children[1];

// ArrowUp (+1 frame)
inputMock2.dispatchEvent({ type: "keydown", key: "ArrowUp", shiftKey: false, select() {}, preventDefault() {}, stopPropagation() {} });
assert.equal(inputMock2.value, "00:00:05:01", "ArrowUp deve avançar 1 frame (121 frames = 00:00:05:01)");

// ArrowUp com Shift (+10 frames)
inputMock2.dispatchEvent({ type: "keydown", key: "ArrowUp", shiftKey: true, select() {}, preventDefault() {}, stopPropagation() {} });
assert.equal(inputMock2.value, "00:00:05:11", "Shift+ArrowUp deve avançar 10 frames");

// ArrowDown (-1 frame)
inputMock2.dispatchEvent({ type: "keydown", key: "ArrowDown", shiftKey: false, select() {}, preventDefault() {}, stopPropagation() {} });
assert.equal(inputMock2.value, "00:00:05:10", "ArrowDown deve retroceder 1 frame");

// Escape cancela sem commit
inputMock2.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {}, stopPropagation() {} });
assert.equal(committed2, null, "Escape NÃO deve disparar commit");
assert.equal(parentMock2.children.length, 1, "Input deve ser removido");
assert.equal(spanMock2.style.display, "", "Span original deve ser restaurado");

console.log("  ✓ Ajuste fino frame a frame e cancelamento seguro com Escape validados com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 13: Sincronização entre Timeline Header e Program Player
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 13] Sincronização entre Timeline Header e Program Player");
const playerSrc = fs.readFileSync(path.join(raiz, "src", "ui", "js", "player.js"), "utf8");

assert.ok(playerSrc.includes('getActiveElement("timeline-current-time")'), "player.js deve sincronizar timeline-current-time");
assert.ok(playerSrc.includes('timelinePlayheadChanged'), "player.js deve escutar timelinePlayheadChanged para atualizar displays");
assert.ok(playerSrc.includes('!timelineTcEl._timecodeInputActive'), "Updates automáticos não devem sobrescrever timelineTcEl ativo");
assert.ok(playerSrc.includes('!curTimeEl._timecodeInputActive'), "Updates automáticos não devem sobrescrever curTimeEl ativo");

// Guarda de duplo clique em main.js
const mainSrc = fs.readFileSync(path.join(raiz, "src", "ui", "js", "main.js"), "utf8");
assert.ok(mainSrc.includes('timeline-timecode-box') && mainSrc.includes('interactive-timecode'), "main.js deve proteger timecode contra retração por duplo clique");

console.log("  ✓ Sincronização global e guardas anti-colapso validadas com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 14: Precisão Absoluta em Timelines 29.97 fps (NTSC / NDF Base 30)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 14] Precisão Absoluta em Timelines 29.97 fps (NTSC / NDF Base 30)");
const timelineStateModuleUrl = pathToFileURL(path.join(raiz, "src", "ui", "js", "timelineState.js")).href;
const { framesToTimecode, formatRulerTimecode, timecodeToFrames, TIMELINE_STATE, TIMELINE_HISTORY } = await import(timelineStateModuleUrl);

// Teste do timecode 00:00:05:00 a 29.97 fps: 5 segundos * 30 fps nominal = exatamente 150 frames
const rFps5s = parseTimecodeNavigation("00:00:05:00", 0, 29.97);
assert.equal(rFps5s.valid, true);
assert.equal(rFps5s.targetFrame, 150, "00:00:05:00 a 29.97fps deve mapear estritamente para o frame inteiro 150 (não 149.85)");
assert.equal(Number.isInteger(rFps5s.targetFrame), true, "targetFrame deve ser sempre inteiro");
assert.equal(formatTimecode(150 / 29.97, 29.97), "00:00:05:00", "Frame 150 a 29.97fps deve formatar como 00:00:05:00");
assert.equal(framesToTimecode(150, 29.97), "00:00:05:00", "framesToTimecode(150, 29.97) deve ser 00:00:05:00");
assert.equal(timecodeToFrames("00:00:05:00", 29.97), 150, "timecodeToFrames('00:00:05:00', 29.97) deve retornar 150");

// Teste do timecode 00:00:39:14 a 29.97 fps: (39 * 30) + 14 = 1170 + 14 = exatamente 1184 frames
const rFps39s = parseTimecodeNavigation("00:00:39:14", 0, 29.97);
assert.equal(rFps39s.valid, true);
assert.equal(rFps39s.targetFrame, 1184, "00:00:39:14 a 29.97fps deve mapear estritamente para o frame inteiro 1184 (não 1182.83)");
assert.equal(Number.isInteger(rFps39s.targetFrame), true, "targetFrame deve ser sempre inteiro");
assert.equal(formatTimecode(1184 / 29.97, 29.97), "00:00:39:14", "Frame 1184 a 29.97fps deve formatar como 00:00:39:14");
assert.equal(framesToTimecode(1184, 29.97), "00:00:39:14", "framesToTimecode(1184, 29.97) deve ser 00:00:39:14");
assert.equal(timecodeToFrames("00:00:39:14", 29.97), 1184, "timecodeToFrames('00:00:39:14', 29.97) deve retornar 1184");

// Régua NLE: sem duplicata de quadros (00:04:28 duplicado foi eliminado)
const ruler148 = formatRulerTimecode(148, 29.97, true);
const ruler149 = formatRulerTimecode(149, 29.97, true);
const ruler150 = formatRulerTimecode(150, 29.97, true);
assert.equal(ruler148, "00:04:28", "Frame 148 a 29.97fps na régua deve ser 00:04:28");
assert.equal(ruler149, "00:04:29", "Frame 149 a 29.97fps na régua deve ser 00:04:29 (sem clamp duplicado)");
assert.equal(ruler150, "00:05:00", "Frame 150 a 29.97fps na régua deve virar o segundo em 00:05:00");
assert.notEqual(ruler149, ruler148, "Não deve haver duplicação de timecode consecutivo na régua");

console.log("  ✓ Precisão matemática nominal de 29.97 fps (frames 150 e 1184) e régua sem duplicatas validadas");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 15: Aritmética de Deslocamento Relativo a 29.97 fps (+50 -> 1:20; +50 -> 3:10)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 15] Aritmética de Deslocamento Relativo a 29.97 fps (+50 -> 1:20; +50 -> 3:10)");

// Salto 1: a partir do zero, +50 frames a 29.97fps (nominal 30)
// 50 frames = 1 segundo (30 frames) + 20 frames = 00:00:01:20
const jump1 = parseTimecodeNavigation("+50", 0, 29.97);
assert.equal(jump1.valid, true);
assert.equal(jump1.targetFrame, 50);
assert.equal(jump1.deltaFrames, 50);
assert.equal(jump1.formattedTimecode, "00:00:01:20", "50 frames a 29.97fps (base 30) = 00:00:01:20");

// Salto 2: a partir de 1:20 (frame 50), +50 frames novamente
// 100 frames = 3 segundos (90 frames) + 10 frames = 00:00:03:10
const jump2 = parseTimecodeNavigation("+50", 50, 29.97);
assert.equal(jump2.valid, true);
assert.equal(jump2.targetFrame, 100);
assert.equal(jump2.deltaFrames, 50);
assert.equal(jump2.formattedTimecode, "00:00:03:10", "100 frames a 29.97fps (base 30) = 00:00:03:10");

// Salto reverso: -50 frames a partir do frame 100 deve voltar para o frame 50 (00:00:01:20)
const jumpBack = parseTimecodeNavigation("-50", 100, 29.97);
assert.equal(jumpBack.valid, true);
assert.equal(jumpBack.targetFrame, 50);
assert.equal(jumpBack.formattedTimecode, "00:00:01:20");

console.log("  ✓ Aritmética de +50 frames (1:20 e 3:10) validada com coerência total de NDF");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 16: Histórico de Ações (Ctrl+Z / Undo e Redo) ao Pular Playhead via Timecode
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 16] Histórico de Ações (Ctrl+Z / Undo e Redo) ao Pular Playhead via Timecode");

TIMELINE_HISTORY.clear();
TIMELINE_STATE.setPlayheadFrame(0);
assert.equal(TIMELINE_STATE.playheadFrame, 0);

// Salto 1: Pulo para o frame 150 via TIMELINE_HISTORY.record (como faz o ProgramPlayer)
TIMELINE_HISTORY.record(() => {
    TIMELINE_STATE.setPlayheadFrame(150);
});
assert.equal(TIMELINE_STATE.playheadFrame, 150, "Playhead deve avançar para 150");
assert.equal(TIMELINE_HISTORY.undoStack.length, 1, "Pilha de Undo deve conter 1 entrada");

// Salto 2: Pulo para o frame 1184 via TIMELINE_HISTORY.record
TIMELINE_HISTORY.record(() => {
    TIMELINE_STATE.setPlayheadFrame(1184);
});
assert.equal(TIMELINE_STATE.playheadFrame, 1184, "Playhead deve avançar para 1184");
assert.equal(TIMELINE_HISTORY.undoStack.length, 2, "Pilha de Undo deve conter 2 entradas");

// Ctrl+Z (Undo 1): Deve retornar a 150
const undo1Success = TIMELINE_HISTORY.undo();
assert.equal(undo1Success, true, "Undo 1 deve suceder");
assert.equal(TIMELINE_STATE.playheadFrame, 150, "Ctrl+Z deve restaurar playhead para 150");

// Ctrl+Z (Undo 2): Deve retornar a 0
const undo2Success = TIMELINE_HISTORY.undo();
assert.equal(undo2Success, true, "Undo 2 deve suceder");
assert.equal(TIMELINE_STATE.playheadFrame, 0, "Ctrl+Z deve restaurar playhead para o ponto inicial 0");

// Ctrl+Y (Redo 1): Deve avançar de volta a 150
const redo1Success = TIMELINE_HISTORY.redo();
assert.equal(redo1Success, true, "Redo 1 deve suceder");
assert.equal(TIMELINE_STATE.playheadFrame, 150, "Ctrl+Y deve restaurar playhead para 150");

// Ctrl+Y (Redo 2): Deve avançar de volta a 1184
const redo2Success = TIMELINE_HISTORY.redo();
assert.equal(redo2Success, true, "Redo 2 deve suceder");
assert.equal(TIMELINE_STATE.playheadFrame, 1184, "Ctrl+Y deve restaurar playhead para 1184");

console.log("  ✓ Undo (Ctrl+Z) e Redo (Ctrl+Y) para saltos de timecode validados com sucesso");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 17: Interceptação e Ciclo de Vida do Atalho Ctrl+G e Estabilidade do Input
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n▶ [Bateria 17] Interceptação e Ciclo de Vida do Atalho Ctrl+G e Estabilidade do Input");

const parentMock3 = makeEl("parent-container-3");
const spanMock3 = makeEl("test-timecode-3");
spanMock3.textContent = "00:00:00:00";
parentMock3.appendChild(spanMock3);

const ctrlGController = setupInteractiveTimecode(
    spanMock3,
    () => ({ currentFrame: 0, fps: 29.97, maxFrames: 3000 }),
    () => {}
);

// Ativa o input inline
ctrlGController.activate();
assert.equal(spanMock3.style.display, "none", "Span deve estar ocultado");
assert.equal(parentMock3.children.length, 2, "Input inline deve estar inserido no pai");
const activeInput = parentMock3.children[1];
assert.ok(activeInput, "Input ativo deve existir");

// Simulação de pressionar Ctrl+G enquanto o input já está aberto
let prevented = false;
let stopped = false;
activeInput.dispatchEvent({
    type: "keydown",
    key: "g",
    code: "KeyG",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; }
});

assert.equal(prevented, true, "Ctrl+G dentro do input DEVE executar preventDefault() para barrar busca nativa do Chrome");
assert.equal(stopped, true, "Ctrl+G dentro do input DEVE executar stopPropagation()");
assert.equal(parentMock3.children.length, 1, "Input inline deve ser fechado e removido após Ctrl+G");
assert.equal(spanMock3.style.display, "", "Span original deve ser reexibido");

// Verificação de clique no timeline-timecode-box
assert.ok(playerSrc.includes('box.addEventListener("click"'), "player.js deve ter listener no box da timeline para redirecionar clique");
assert.ok(playerSrc.includes('activateTimecodeInput("timeline")'), "player.js deve suportar ativação explícita da timeline");

console.log("  ✓ Interceptação do Ctrl+G, prevenção contra dialog do navegador e estabilidade validadas");

console.log("\n===============================================================================");
console.log("  RESULTADO: 17 de 17 baterias APROVADAS (100% de sucesso)");
console.log("===============================================================================\n");
