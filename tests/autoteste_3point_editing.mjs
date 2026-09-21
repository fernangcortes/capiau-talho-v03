// tests/autoteste_3point_editing.mjs
// Autoteste automatizado da Task 7: Montagem de Três Pontos (Inserção Ripple ',' & Sobrescrita '.')

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Polyfill de ambiente de navegador para execução em Node.js ESM
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
globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => [] });
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") {
            return {
                getContext: () => ({
                    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
                    fillRect() {}, strokeRect() {}, setLineDash() {}, fill() {}, stroke() {},
                    measureText: () => ({ width: 50 }),
                    fillText() {}, scale() {}, clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}
                }),
                ownerDocument: globalThis.document,
                parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
                style: {},
                closest: () => null,
                getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
                addEventListener: () => {},
                removeEventListener: () => {}
            };
        }
        if (id === "source-video") {
            return {
                style: {},
                dataset: {},
                currentTime: 1.0,
                duration: 10.0,
                paused: true,
                load: () => {},
                pause: () => {},
                addEventListener: () => {}
            };
        }
        return {
            id,
            style: {},
            classList: {
                add() {}, remove() {}, contains() { return false; }, toggle() {}
            },
            setAttribute: () => {},
            getAttribute: () => null,
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        style: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild: () => {}
    })
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Montagem de Três Pontos (Task 7: Inserção Ripple & Sobrescrita)...");

// ── 1. VALIDAÇÃO DE DOM E ESTILOS ───────────────────────────────────────────
console.log("\n1. Validando index.html e styles.css...");
const indexPath = path.join(rootDir, "src", "ui", "index.html");
const stylesPath = path.join(rootDir, "src", "ui", "styles.css");
const indexContent = fs.readFileSync(indexPath, "utf-8");
const stylesContent = fs.readFileSync(stylesPath, "utf-8");

assert.ok(indexContent.includes('id="btn-source-insert"'), "index.html deve conter o botão #btn-source-insert");
assert.ok(indexContent.includes('id="btn-source-overwrite"'), "index.html deve conter o botão #btn-source-overwrite");
assert.ok(indexContent.includes('id="btn-source-toggle-audio"'), "index.html deve conter o botão #btn-source-toggle-audio");
assert.ok(indexContent.includes('btn-edit-insert'), "index.html deve conter a classe .btn-edit-insert");
assert.ok(indexContent.includes('btn-edit-overwrite'), "index.html deve conter a classe .btn-edit-overwrite");
assert.ok(indexContent.includes('btn-source-stream-mode'), "index.html deve conter a classe .btn-source-stream-mode");

// Validação de Line Icons puros (sem spans de texto redundantes)
assert.ok(!indexContent.includes('<span>Inserir</span>'), "Botão Inserir deve ser um line icon puro sem <span>Inserir</span>");
assert.ok(!indexContent.includes('<span>Sobrescrever</span>'), "Botão Sobrescrever deve ser um line icon puro sem <span>Sobrescrever</span>");
assert.ok(indexContent.includes('stream-icon-av'), "Botão de canais deve conter SVG para modo AV");
assert.ok(indexContent.includes('stream-icon-v'), "Botão de canais deve conter SVG para modo V");
assert.ok(indexContent.includes('stream-icon-a'), "Botão de canais deve conter SVG para modo A");

// Cache-busters
assert.ok(/styles\.css\?v=(?:4[5-9]|[5-9]\d+)/.test(indexContent), "Cache-buster de styles.css deve ser v>=45");
assert.ok(/main\.js\?v=(?:4[5-9]|[5-9]\d+)/.test(indexContent), "Cache-buster de main.js deve ser v>=45");

// Estilos CSS
assert.ok(stylesContent.includes('.btn-edit-insert'), "styles.css deve estilizar .btn-edit-insert");
assert.ok(stylesContent.includes('.btn-edit-overwrite'), "styles.css deve estilizar .btn-edit-overwrite");
assert.ok(stylesContent.includes('.btn-source-stream-mode'), "styles.css deve estilizar .btn-source-stream-mode");

// Validação Anti-Duplicação: timelineInteraction.js não deve escutar edit.insert/overwrite para evitar disparo concorrente
const timelineInteractionPath = path.join(rootDir, "src", "ui", "js", "timelineInteraction.js");
const timelineInteractionCode = fs.readFileSync(timelineInteractionPath, "utf-8");
assert.ok(!timelineInteractionCode.includes('matches(e, "edit.insert")'), "timelineInteraction.js NÃO deve conter ouvinte para edit.insert (gerenciado centralmente pelo PlayerController)");
assert.ok(!timelineInteractionCode.includes('matches(e, "edit.overwrite")'), "timelineInteraction.js NÃO deve conter ouvinte para edit.overwrite (gerenciado centralmente pelo PlayerController)");
console.log("  ✔ Estrutura DOM, botões com SVG, CSS e ausência de atalhos duplicados validados com sucesso.");

// Importação dinâmica dos módulos
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { KEYMAP_SERVICE, COMMANDS_CATALOG, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");
const { SourcePlayer } = await import("../src/ui/js/player.js");

// ── 2. CATÁLOGO DE COMANDOS E PARIDADE NOS 5 PERFIS NLE ─────────────────────
console.log("\n2. Validando Catálogo e Paridade Multi-Preset em KEYMAP_SERVICE...");

const cmdInsert = COMMANDS_CATALOG.find(c => c.id === "edit.insert");
const cmdOverwrite = COMMANDS_CATALOG.find(c => c.id === "edit.overwrite");
const cmdToggleAudio = COMMANDS_CATALOG.find(c => c.id === "edit.toggle_source_audio");
assert.ok(cmdInsert, "Comando 'edit.insert' deve existir no catálogo de comandos");
assert.ok(cmdOverwrite, "Comando 'edit.overwrite' deve existir no catálogo de comandos");
assert.ok(cmdToggleAudio, "Comando 'edit.toggle_source_audio' deve existir no catálogo de comandos");
assert.strictEqual(cmdInsert.category, "edit", "edit.insert deve pertencer à categoria 'edit'");
assert.strictEqual(cmdOverwrite.category, "edit", "edit.overwrite deve pertencer à categoria 'edit'");
assert.strictEqual(cmdToggleAudio.category, "edit", "edit.toggle_source_audio deve pertencer à categoria 'edit'");

// Preset 1: CapIAu
KEYMAP_SERVICE.setPreset("capiau");
assert.ok(KEYMAP_PRESETS.capiau["edit.insert"].includes("Comma"), "CapIAu deve conter Comma para edit.insert");
assert.ok(KEYMAP_PRESETS.capiau["edit.overwrite"].includes("Period"), "CapIAu deve conter Period para edit.overwrite");
assert.ok(KEYMAP_PRESETS.capiau["edit.toggle_source_audio"].includes("Ctrl+Alt+KeyA"), "CapIAu deve conter Ctrl+Alt+KeyA para alternar áudio");
assert.ok(KEYMAP_PRESETS.capiau["timeline.zoom_reset"].includes("Ctrl+Digit1"), "CapIAu deve usar Ctrl+Digit1 para zoom_reset");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "Comma", key: "," }, "edit.insert"), true, "CapIAu deve reconhecer ',' para insert");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "Period", key: "." }, "edit.overwrite"), true, "CapIAu deve reconhecer '.' para overwrite");

// Preset 2: Premiere
KEYMAP_SERVICE.setPreset("premiere");
assert.ok(KEYMAP_PRESETS.premiere["edit.insert"].includes("Comma"), "Premiere deve conter Comma para edit.insert");
assert.ok(KEYMAP_PRESETS.premiere["edit.overwrite"].includes("Period"), "Premiere deve conter Period para edit.overwrite");
assert.ok(KEYMAP_PRESETS.premiere["edit.toggle_source_audio"].includes("Ctrl+Alt+KeyA"), "Premiere deve conter Ctrl+Alt+KeyA para alternar áudio");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "Comma", key: "," }, "edit.insert"), true, "Premiere deve reconhecer ',' para insert");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "Period", key: "." }, "edit.overwrite"), true, "Premiere deve reconhecer '.' para overwrite");

// Preset 3: DaVinci Resolve
KEYMAP_SERVICE.setPreset("resolve");
assert.ok(KEYMAP_PRESETS.resolve["edit.insert"].includes("F9"), "Resolve deve conter F9 para edit.insert");
assert.ok(KEYMAP_PRESETS.resolve["edit.insert"].includes("Comma"), "Resolve deve conter Comma para edit.insert");
assert.ok(KEYMAP_PRESETS.resolve["edit.overwrite"].includes("F10"), "Resolve deve conter F10 para edit.overwrite");
assert.ok(KEYMAP_PRESETS.resolve["edit.overwrite"].includes("Period"), "Resolve deve conter Period para edit.overwrite");
assert.ok(KEYMAP_PRESETS.resolve["edit.toggle_source_audio"].includes("Ctrl+Alt+KeyA"), "Resolve deve conter Ctrl+Alt+KeyA para alternar áudio");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "F9", key: "F9" }, "edit.insert"), true, "Resolve deve reconhecer F9 para insert");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "F10", key: "F10" }, "edit.overwrite"), true, "Resolve deve reconhecer F10 para overwrite");

// Preset 4: Apple Final Cut Pro
KEYMAP_SERVICE.setPreset("finalcut");
assert.ok(KEYMAP_PRESETS.finalcut["edit.insert"].includes("KeyW"), "Final Cut deve conter W para edit.insert");
assert.ok(KEYMAP_PRESETS.finalcut["edit.insert"].includes("Comma"), "Final Cut deve conter Comma para edit.insert");
assert.ok(KEYMAP_PRESETS.finalcut["edit.overwrite"].includes("KeyD"), "Final Cut deve conter D para edit.overwrite");
assert.ok(KEYMAP_PRESETS.finalcut["edit.overwrite"].includes("Period"), "Final Cut deve conter Period para edit.overwrite");
assert.ok(KEYMAP_PRESETS.finalcut["edit.toggle_source_audio"].includes("Ctrl+Alt+KeyA"), "Final Cut deve conter Ctrl+Alt+KeyA para alternar áudio");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "KeyW", key: "w" }, "edit.insert"), true, "Final Cut deve reconhecer W para insert");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "KeyD", key: "d" }, "edit.overwrite"), true, "Final Cut deve reconhecer D para overwrite");

// Preset 5: Kdenlive
KEYMAP_SERVICE.setPreset("kdenlive");
assert.ok(KEYMAP_PRESETS.kdenlive["edit.insert"].includes("KeyV"), "Kdenlive deve conter V para edit.insert");
assert.ok(KEYMAP_PRESETS.kdenlive["edit.insert"].includes("Comma"), "Kdenlive deve conter Comma para edit.insert");
assert.ok(KEYMAP_PRESETS.kdenlive["edit.overwrite"].includes("KeyB"), "Kdenlive deve conter B para edit.overwrite");
assert.ok(KEYMAP_PRESETS.kdenlive["edit.overwrite"].includes("Period"), "Kdenlive deve conter Period para edit.overwrite");
assert.ok(KEYMAP_PRESETS.kdenlive["edit.toggle_source_audio"].includes("Ctrl+Alt+KeyA"), "Kdenlive deve conter Ctrl+Alt+KeyA para alternar áudio");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "KeyV", key: "v" }, "edit.insert"), true, "Kdenlive deve reconhecer V para insert");
assert.strictEqual(KEYMAP_SERVICE.matches({ code: "KeyB", key: "b" }, "edit.overwrite"), true, "Kdenlive deve reconhecer B para overwrite");

// Validação dos Badges da Cheat Sheet
const badgesInsert = KEYMAP_SERVICE.getShortcutBadgesHTML("edit.insert");
const badgesOverwrite = KEYMAP_SERVICE.getShortcutBadgesHTML("edit.overwrite");
assert.ok(badgesInsert.length > 0, "Badges da Cheat Sheet para edit.insert devem ser renderizados");
assert.ok(badgesOverwrite.length > 0, "Badges da Cheat Sheet para edit.overwrite devem ser renderizados");

console.log("  ✔ Paridade multi-preset e Cheat Sheet validados nos 5 perfis da indústria.");

// ── 3. INSERÇÃO RIPPLE (',') NA AGULHA COM AVANÇO AUTOMÁTICO ────────────────
console.log("\n3. Validando Inserção Ripple (',') com split e afastamento subsequente...");
KEYMAP_SERVICE.setPreset("capiau");

// Reset de estado inicial
TIMELINE_STATE.fps = 24;
TIMELINE_STATE.tracks = [
    { id: "V1", kind: "video", locked: false },
    { id: "A1", kind: "audio", locked: false }
];
TIMELINE_STATE.playheadFrame = 50;
TIMELINE_HISTORY.clear();

// Timeline com Clip 1 (0..100) e Clip 2 (100..200)
STATE.activeTimelineCuts = [
    { id: "cut_1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 },
    { id: "cut_2", track: "V1", timelineStartFrame: 100, inFrame: 0, outFrame: 100 }
];

// Inserção de trecho de 30 frames (0..30) no frame 50 com Ripple
const resInsert = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_src_1",
    type: "video",
    inFrame: 0,
    outFrame: 30,
    targetTrack: "V1",
    targetAudioTrack: null
}, true);

assert.ok(resInsert, "insertSourceClipAtPlayhead deve retornar o clipe criado");
const cutsAfterInsert = STATE.activeTimelineCuts.filter(c => c.track === "V1");

// Deve haver 4 cortes na pista V1:
// 1. Parte esquerda de cut_1: 0..50
// 2. Novo corte inserido: 50..80 (dur 30)
// 3. Parte direita de cut_1: 80..130 (dur 50)
// 4. cut_2 empurrado: 130..230 (dur 100)
assert.strictEqual(cutsAfterInsert.length, 4, "Devem existir 4 cortes em V1 após o Ripple Insert");

const leftPart = cutsAfterInsert.find(c => c.timelineStartFrame === 0);
assert.ok(leftPart, "Parte esquerda de cut_1 deve iniciar em 0");
assert.strictEqual(leftPart.outFrame - leftPart.inFrame, 50, "Parte esquerda de cut_1 deve durar 50f");

const insertedClip = cutsAfterInsert.find(c => c.timelineStartFrame === 50);
assert.ok(insertedClip, "Novo corte deve ser inserido exatamente em 50");
assert.strictEqual(insertedClip.outFrame - insertedClip.inFrame, 30, "Novo corte deve durar 30f");
assert.strictEqual(insertedClip.video_id, "vid_src_1", "Novo corte deve ter o video_id correto");

const rightPart = cutsAfterInsert.find(c => c.timelineStartFrame === 80);
assert.ok(rightPart, "Parte direita de cut_1 deve começar em 80");
assert.strictEqual(rightPart.outFrame - rightPart.inFrame, 50, "Parte direita deve durar 50f");
assert.strictEqual(rightPart.inFrame, 50, "inFrame da parte direita deve ser 50");

const pushedClip2 = cutsAfterInsert.find(c => c.timelineStartFrame === 130);
assert.ok(pushedClip2, "cut_2 deve ser empurrado para o frame 130");
assert.strictEqual(pushedClip2.outFrame - pushedClip2.inFrame, 100, "cut_2 deve manter sua duração de 100f intacta");

// Validação do Avanço Automático da Agulha (Playhead Advance)
assert.strictEqual(TIMELINE_STATE.playheadFrame, 80, "Agulha deve avançar automaticamente para o fim do trecho inserido (50 + 30 = 80)");

console.log("  ✔ Inserção Ripple, fatiamento limpo, empurrão sem perdas e avanço de agulha validados.");

// ── 4. SOBRESCRITA ('.') NA AGULHA SEM EMPURRÃO ─────────────────────────────
console.log("\n4. Validando Sobrescrita ('.') com fatiamento e substituição de intervalo...");

TIMELINE_STATE.playheadFrame = 20;
STATE.activeTimelineCuts = [
    { id: "cut_base", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 },
    { id: "cut_tail", track: "V1", timelineStartFrame: 120, inFrame: 0, outFrame: 50 }
];

// Sobrescrever 40 frames (20..60)
const resOverwrite = TIMELINE_STATE.overwriteSourceClipAtPlayhead({
    id: "vid_src_2",
    type: "video",
    inFrame: 0,
    outFrame: 40,
    targetTrack: "V1",
    targetAudioTrack: null
});

assert.ok(resOverwrite, "overwriteSourceClipAtPlayhead deve retornar o corte criado");
const cutsAfterOverwrite = STATE.activeTimelineCuts.filter(c => c.track === "V1");

// Deve haver 4 cortes:
// 1. Parte esquerda de cut_base: 0..20
// 2. Trecho sobrescrito: 20..60 (dur 40)
// 3. Parte direita de cut_base: 60..100 (dur 40)
// 4. cut_tail intacto: 120..170 (não empurrado!)
assert.strictEqual(cutsAfterOverwrite.length, 4, "Devem existir 4 cortes em V1 após Overwrite");

const owLeft = cutsAfterOverwrite.find(c => c.timelineStartFrame === 0);
assert.strictEqual(owLeft.outFrame - owLeft.inFrame, 20, "Parte esquerda residual deve ter 20f");

const owInserted = cutsAfterOverwrite.find(c => c.timelineStartFrame === 20);
assert.ok(owInserted, "Corte sobrescrito deve começar em 20");
assert.strictEqual(owInserted.outFrame - owInserted.inFrame, 40, "Corte sobrescrito deve ter 40f");

const owRight = cutsAfterOverwrite.find(c => c.timelineStartFrame === 60);
assert.strictEqual(owRight.outFrame - owRight.inFrame, 40, "Parte direita residual deve ter 40f");
assert.strictEqual(owRight.inFrame, 60, "Parte direita residual deve ter inFrame=60");

const owTail = cutsAfterOverwrite.find(c => c.timelineStartFrame === 120);
assert.ok(owTail, "cut_tail deve permanecer rigorosamente em 120 (sem deslocamento ripple)");

// Avanço da agulha: 20 + 40 = 60
assert.strictEqual(TIMELINE_STATE.playheadFrame, 60, "Agulha deve avançar para 60 após a sobrescrita");

console.log("  ✔ Sobrescrita temporal limpa, conservação de timecodes e avanço de agulha validados.");

// ── 5. SINCRONIA ESTREITA DE PARES VINCULADOS A/V ───────────────────────────
console.log("\n5. Validando pares vinculados A/V (link_id compartilhado)...");

TIMELINE_STATE.playheadFrame = 0;
STATE.activeTimelineCuts = [];
STATE.sourceAudioEnabled = true;

// Teste 5.1: Inserção padrão sem especificar targetAudioTrack nem includeAudio -> DEVE vir com áudio (V1 e A1) por padrão!
const resDefaultAV = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_default_av",
    type: "video",
    inFrame: 10,
    outFrame: 60
}, true);

assert.ok(resDefaultAV, "Inserção padrão de vídeo deve ser bem-sucedida");
const videoCutDef = STATE.activeTimelineCuts.find(c => c.track === "V1");
const audioCutDef = STATE.activeTimelineCuts.find(c => c.track === "A1");

assert.ok(videoCutDef && audioCutDef, "Inserção padrão DEVE vir com áudio por padrão (V1 e A1)");
assert.ok(videoCutDef.link_id, "Clipe de vídeo padrão deve possuir link_id");
assert.strictEqual(videoCutDef.link_id, audioCutDef.link_id, "Vídeo e áudio inseridos devem compartilhar o mesmo link_id");
assert.strictEqual(videoCutDef.timelineStartFrame, 0, "Vídeo deve iniciar no frame 0");
assert.strictEqual(audioCutDef.timelineStartFrame, 0, "Áudio deve iniciar no frame 0");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 50, "Agulha deve avançar 50 frames (60 - 10)");

// Teste 5.2: Inserção com áudio desligado (includeAudio: false) -> DEVE ir APENAS vídeo sem áudio
TIMELINE_STATE.playheadFrame = 50;
const cutsBeforeVideoOnly = STATE.activeTimelineCuts.length;

const resVideoOnly = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_only",
    type: "video",
    inFrame: 0,
    outFrame: 30,
    includeAudio: false
}, true);

assert.ok(resVideoOnly, "Inserção com áudio desligado deve ser bem-sucedida");
assert.strictEqual(resVideoOnly.track, "V1", "Novo corte deve ser inserido em V1");
assert.strictEqual(resVideoOnly.link_id, null, "Corte de vídeo sem áudio deve ter link_id nulo");
// Apenas 1 corte de vídeo adicionado na timeline (e split do par anterior)
const a1CutsCount = STATE.activeTimelineCuts.filter(c => c.video_id === "vid_only").length;
assert.strictEqual(a1CutsCount, 1, "Apenas o clipe de vídeo vid_only deve existir, nenhum áudio deve ser criado");

// Teste 5.3: Alternância global via STATE.sourceAudioEnabled e toggleSourceAudio()
STATE.sourceAudioEnabled = true;
assert.strictEqual(STATE.sourceAudioEnabled, true, "STATE.sourceAudioEnabled deve iniciar ativo");
const toggledOff = STATE.toggleSourceAudio();
assert.strictEqual(toggledOff, false, "toggleSourceAudio() deve alternar para false");
assert.strictEqual(STATE.sourceAudioEnabled, false, "STATE.sourceAudioEnabled deve ser false");

TIMELINE_STATE.playheadFrame = 80;
const resFromStateOff = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_state_off",
    type: "video",
    inFrame: 0,
    outFrame: 20
}, true);

assert.ok(resFromStateOff, "Inserção respeitando STATE.sourceAudioEnabled=false deve suceder");
assert.strictEqual(resFromStateOff.link_id, null, "Quando STATE.sourceAudioEnabled for false, vídeo deve ir sem par de áudio");
const a1StateOffCuts = STATE.activeTimelineCuts.filter(c => c.video_id === "vid_state_off" && c.track === "A1");
assert.strictEqual(a1StateOffCuts.length, 0, "Nenhum corte de áudio deve ser criado em A1 quando desligado globalmente");

// Restaura estado ativo
STATE.toggleSourceAudio();
assert.strictEqual(STATE.sourceAudioEnabled, true, "toggleSourceAudio() deve reativar para true");

console.log("  ✔ Paridade A/V por padrão, áudio desligável (includeAudio: false) e toggle global validados com sucesso.");

// ── 6. PROTEÇÃO DE PISTAS TRAVADAS (TRACK LOCK) ─────────────────────────────
console.log("\n6. Validando proteção estrita de pistas travadas (locked: true)...");

TIMELINE_STATE.tracks = [
    { id: "V1", kind: "video", locked: false },
    { id: "A1", kind: "audio", locked: true } // Pista de áudio travada
];
TIMELINE_STATE.playheadFrame = 0;
STATE.activeTimelineCuts = [
    { id: "v_base", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 },
    { id: "a_base", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 }
];

// Inserir com Ripple: deve fatiar V1, mas NÃO A1 (pois A1 está travada)
TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_locked_test",
    type: "video",
    inFrame: 0,
    outFrame: 25,
    targetTrack: "V1",
    targetAudioTrack: "A1"
}, true);

const a1Cuts = STATE.activeTimelineCuts.filter(c => c.track === "A1");
assert.strictEqual(a1Cuts.length, 1, "Pista A1 travada não deve ter seus clipes fatiados ou adicionados");
assert.strictEqual(a1Cuts[0].timelineStartFrame, 0, "Clipe na pista A1 não deve ser empurrado");
assert.strictEqual(a1Cuts[0].outFrame, 100, "Clipe na pista A1 deve manter sua duração de 100f intacta");

// Ambas as pistas travadas:
TIMELINE_STATE.tracks[0].locked = true;
const resBothLocked = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_locked_test",
    type: "video",
    inFrame: 0,
    outFrame: 25,
    targetTrack: "V1",
    targetAudioTrack: "A1"
}, true);
assert.strictEqual(resBothLocked, null, "Inserção com ambas as pistas travadas deve retornar null");

console.log("  ✔ Proteção de pistas travadas contra inserção, corte e empurrão validada.");

// ── 7. HISTÓRICO ATÔMICO (UNDO/REDO COM RESTAURAÇÃO DE AGULHA) ──────────────
console.log("\n7. Validando Histórico Atômico (Undo/Redo com restauração de playheadFrame)...");

TIMELINE_STATE.tracks = [
    { id: "V1", kind: "video", locked: false },
    { id: "A1", kind: "audio", locked: false }
];
TIMELINE_STATE.playheadFrame = 40;
STATE.activeTimelineCuts = [
    { id: "cut_history_init", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 100 }
];
TIMELINE_HISTORY.clear();

// Executa inserção Ripple
TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_hist",
    type: "video",
    inFrame: 0,
    outFrame: 35,
    targetTrack: "V1",
    targetAudioTrack: null
}, true);

assert.strictEqual(TIMELINE_STATE.playheadFrame, 75, "Agulha avançou para 75 (40 + 35)");
assert.strictEqual(STATE.activeTimelineCuts.length, 3, "Devem existir 3 cortes após inserção");

// Executa UNDO
const didUndo = TIMELINE_HISTORY.undo();
assert.strictEqual(didUndo, true, "Undo deve retornar true");
assert.strictEqual(STATE.activeTimelineCuts.length, 1, "Undo deve restaurar o corte único original");
assert.strictEqual(STATE.activeTimelineCuts[0].id, "cut_history_init", "Corte original deve ser restaurado");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 40, "Undo deve restaurar com precisão o playheadFrame anterior (40)!");

// Executa REDO
const didRedo = TIMELINE_HISTORY.redo();
assert.strictEqual(didRedo, true, "Redo deve retornar true");
assert.strictEqual(STATE.activeTimelineCuts.length, 3, "Redo deve reaplicar os 3 cortes");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 75, "Redo deve reaplicar o avanço da agulha para 75!");

console.log("  ✔ Histórico atômico total (Undo e Redo incluindo agulha) 100% validado.");

// ── 8. INTEGRAÇÃO COM A CLASSE SourcePlayer ─────────────────────────────────
console.log("\n8. Validando integração do SourcePlayer com STATE...");

const sourcePlayer = new SourcePlayer();
STATE.activeVideo = {
    id: "src_video_test",
    title: "Video Teste",
    filename: "teste.mp4",
    duration: 12.0
};
STATE.markerIn = 2.0;  // 48 frames a 24fps
STATE.markerOut = 5.0; // 120 frames a 24fps

TIMELINE_STATE.playheadFrame = 100;
STATE.activeTimelineCuts = [];

const clipCreated = sourcePlayer.insertAtPlayhead();
assert.ok(clipCreated, "sourcePlayer.insertAtPlayhead deve extrair do STATE e inserir com sucesso");
assert.strictEqual(clipCreated.video_id, "src_video_test", "Clipe deve carregar o vídeo ativo do Source");
assert.strictEqual(clipCreated.inFrame, 48, "inFrame deve ser correspondente a 2.0s (48f)");
assert.strictEqual(clipCreated.outFrame, 120, "outFrame deve ser correspondente a 5.0s (120f)");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 172, "Agulha deve avançar 72 frames (100 + 72 = 172)");

console.log("  ✔ Extração de marcadores do SourcePlayer e execução na timeline validadas.");

// ── 9. SELETOR DE CANAIS DE 3 ESTADOS (AV / V / A) ──────────────────────────
console.log("\n9. Validando seletor cíclico de canais (AV -> V -> A -> AV)...");

STATE.sourceStreamMode = "av";
assert.strictEqual(STATE.sourceStreamMode, "av", "Modo inicial deve ser 'av'");

const mode1 = STATE.cycleSourceStreamMode();
assert.strictEqual(mode1, "v", "Primeiro ciclo de 'av' deve ir para 'v'");
assert.strictEqual(STATE.sourceStreamMode, "v", "STATE.sourceStreamMode deve ser 'v'");
assert.strictEqual(globalThis.localStorage.getItem("capiau_source_stream_mode"), "v", "LocalStorage deve persistir 'v'");

const mode2 = STATE.cycleSourceStreamMode();
assert.strictEqual(mode2, "a", "Segundo ciclo de 'v' deve ir para 'a'");
assert.strictEqual(STATE.sourceStreamMode, "a", "STATE.sourceStreamMode deve ser 'a'");
assert.strictEqual(globalThis.localStorage.getItem("capiau_source_stream_mode"), "a", "LocalStorage deve persistir 'a'");

const mode3 = STATE.cycleSourceStreamMode();
assert.strictEqual(mode3, "av", "Terceiro ciclo de 'a' deve retornar para 'av'");
assert.strictEqual(STATE.sourceStreamMode, "av", "STATE.sourceStreamMode deve ser 'av'");
assert.strictEqual(globalThis.localStorage.getItem("capiau_source_stream_mode"), "av", "LocalStorage deve persistir 'av'");

console.log("  ✔ Ciclo de 3 estados (AV -> V -> A -> AV) e persistência validados.");

// ── 10. INSERÇÃO POR CANAIS ESPECÍFICOS (AV, V e A) ─────────────────────────
console.log("\n10. Validando inserção com canais específicos (AV, Somente Vídeo e Somente Áudio)...");

TIMELINE_STATE.tracks = [
    { id: "V1", kind: "video", locked: false },
    { id: "A1", kind: "audio", locked: false }
];

// Caso A: Modo AV (Vídeo + Áudio)
STATE.sourceStreamMode = "av";
TIMELINE_STATE.playheadFrame = 0;
STATE.activeTimelineCuts = [];

const clipAV = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_av",
    type: "video",
    inFrame: 0,
    outFrame: 48,
    streamMode: "av"
}, true);

assert.ok(clipAV, "Inserção em modo AV deve ter sucesso");
assert.strictEqual(STATE.activeTimelineCuts.length, 2, "Modo AV deve criar 2 cortes (V1 e A1)");
const cutV = STATE.activeTimelineCuts.find(c => c.track === "V1");
const cutA = STATE.activeTimelineCuts.find(c => c.track === "A1");
assert.ok(cutV, "Deve existir corte em V1");
assert.ok(cutA, "Deve existir corte em A1");
assert.ok(cutV.link_id && cutA.link_id, "Ambos os cortes devem possuir link_id");
assert.strictEqual(cutV.link_id, cutA.link_id, "link_id deve ser compartilhado entre V1 e A1");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 48, "Playhead deve avançar para 48");

// Caso B: Modo V (Somente Vídeo)
STATE.sourceStreamMode = "v";
TIMELINE_STATE.playheadFrame = 100;
STATE.activeTimelineCuts = [
    { id: "existing_audio", track: "A1", timelineStartFrame: 0, inFrame: 0, outFrame: 200 }
];

const clipV = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_v_only",
    type: "video",
    inFrame: 0,
    outFrame: 30,
    streamMode: "v"
}, true);

assert.ok(clipV, "Inserção em modo V deve ter sucesso");
assert.strictEqual(clipV.track, "V1", "Corte criado deve estar na pista V1");
assert.strictEqual(clipV.link_id, null, "Corte somente vídeo não deve ter link_id");
const a1CutsAfterV = STATE.activeTimelineCuts.filter(c => c.track === "A1");
assert.strictEqual(a1CutsAfterV.length, 1, "Pista de áudio não deve ser alterada em inserção Somente Vídeo");
assert.strictEqual(a1CutsAfterV[0].id, "existing_audio", "Áudio pré-existente deve ser preservado intacto");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 130, "Playhead deve avançar para 130 (100 + 30)");

// Caso C: Modo A (Somente Áudio)
STATE.sourceStreamMode = "a";
TIMELINE_STATE.playheadFrame = 200;
STATE.activeTimelineCuts = [
    { id: "existing_video", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 500 }
];

const clipA = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "vid_a_only",
    type: "video",
    inFrame: 0,
    outFrame: 50,
    streamMode: "a"
}, true);

assert.ok(clipA, "Inserção em modo A deve ter sucesso");
assert.strictEqual(clipA.track, "A1", "Corte retornado deve estar na pista de áudio A1");
assert.strictEqual(clipA.link_id, null, "Corte somente áudio não deve ter link_id");
const v1CutsAfterA = STATE.activeTimelineCuts.filter(c => c.track === "V1");
assert.strictEqual(v1CutsAfterA.length, 1, "Pista de vídeo não deve sofrer ripple ou alteração em inserção Somente Áudio");
assert.strictEqual(v1CutsAfterA[0].id, "existing_video", "Vídeo existente em V1 deve ser mantido intacto");
assert.strictEqual(TIMELINE_STATE.playheadFrame, 250, "Playhead deve avançar para 250 (200 + 50)");

// Caso D: Guarda de Foto no Modo Somente Áudio
const photoResult = TIMELINE_STATE.insertSourceClipAtPlayhead({
    id: "photo_test",
    type: "photo",
    inFrame: 0,
    outFrame: 50,
    streamMode: "a"
}, true);
assert.strictEqual(photoResult, null, "Inserir foto em modo Somente Áudio deve ser rejeitado e retornar null");

console.log("  ✔ Inserção por canais (AV, V exclusivo, A exclusivo e guarda de fotos) 100% validada.");

// ============================================================
// 11. PERSISTÊNCIA DE MARCADORES [IN–OUT] POR MÍDIA NO SOURCE
// ============================================================
console.log("\n11. Persistência de marcadores [IN–OUT] por mídia no Source Player...");
const videoA = { id: 101, filename: "cena_01.mp4", duration: 30.0 };
const videoB = { id: 102, filename: "cena_02.mp4", duration: 45.0 };

// 1. Marca IN/OUT no Vídeo A
STATE.activeVideo = videoA;
sourcePlayer.loadVideo(videoA);
STATE.markerIn = 2.5;
STATE.markerOut = 7.0;
assert.strictEqual(STATE.markerIn, 2.5);
assert.strictEqual(STATE.markerOut, 7.0);

// 2. Troca para Vídeo B e marca outro IN/OUT
STATE.activeVideo = videoB;
sourcePlayer.loadVideo(videoB);
assert.strictEqual(STATE.markerIn, null, "Vídeo B novo não deve ter IN prévio");
assert.strictEqual(STATE.markerOut, null, "Vídeo B novo não deve ter OUT prévio");
STATE.markerIn = 12.0;
STATE.markerOut = 18.5;

// 3. Volta para o Vídeo A: marcadores anteriores de A devem ser restaurados com exatidão!
STATE.activeVideo = videoA;
sourcePlayer.loadVideo(videoA);
assert.strictEqual(STATE.markerIn, 2.5, "IN do Vídeo A deve ser restaurado ao retornar a ele");
assert.strictEqual(STATE.markerOut, 7.0, "OUT do Vídeo A deve ser restaurado ao retornar a ele");

// 4. Volta para o Vídeo B: marcadores anteriores de B devem ser restaurados com exatidão!
STATE.activeVideo = videoB;
sourcePlayer.loadVideo(videoB);
assert.strictEqual(STATE.markerIn, 12.0, "IN do Vídeo B deve ser restaurado ao retornar a ele");
assert.strictEqual(STATE.markerOut, 18.5, "OUT do Vídeo B deve ser restaurado ao retornar a ele");

// 5. Limpa marcadores de B: deve refletir apenas em B sem afetar A
STATE.markerIn = null;
STATE.markerOut = null;
STATE.activeVideo = videoA;
sourcePlayer.loadVideo(videoA);
assert.strictEqual(STATE.markerIn, 2.5, "Marcadores de A devem permanecer salvos mesmo após limpar os de B");
assert.strictEqual(STATE.markerOut, 7.0);

console.log("  ✔ Persistência e restauração de marcadores [IN–OUT] por mídia 100% validada.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DA TASK 7 (3-POINT EDITING) 100% APROVADO!");
console.log("============================================================\n");
