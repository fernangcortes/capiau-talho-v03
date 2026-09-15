import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
};

const { STATE } = await import("../src/ui/js/state.js");
const { CapiauTimelineState } = await import("../src/ui/js/timelineState.js");
const { KEYMAP_SERVICE, KEYMAP_PRESETS } = await import("../src/ui/js/keymapService.js");

console.log("▶ Iniciando autoteste do Sistema de Edição Rápida QWER + ASDF...\n");

// 1. Validando KeymapService e Novos Atalhos
console.log("1. Validando KeymapService e Mapeamentos Padrão...");
const defaultPreset = KEYMAP_PRESETS.capiau;
assert.ok(defaultPreset, "Preset 'capiau' deve existir.");

// Q-W-E-R
assert.deepStrictEqual(defaultPreset["edit.ripple_trim_head"], ["KeyQ"]);
assert.deepStrictEqual(defaultPreset["edit.ripple_trim_tail"], ["KeyW"]);
assert.ok(defaultPreset["edit.split"].includes("KeyE"));
assert.ok(defaultPreset["edit.ripple_delete"].includes("KeyR"));
assert.ok(defaultPreset["edit.ripple_delete"].includes("Backspace"));
assert.ok(defaultPreset["edit.lift_delete"].includes("Delete"));
assert.ok(defaultPreset["edit.lift_delete"].includes("Alt+KeyR"));

// A-S-D-F & Shift+D
assert.ok(defaultPreset["playback.prev_edit_point"].includes("KeyA"));
assert.ok(defaultPreset["playback.next_edit_point"].includes("KeyS"));
assert.deepStrictEqual(defaultPreset["edit.select_clip_at_playhead"], ["KeyD"]);
assert.deepStrictEqual(defaultPreset["edit.select_clips_multi"], ["Shift+KeyD"]);
assert.deepStrictEqual(defaultPreset["edit.toggle_clip_disable"], ["KeyF"]);

// Snapping em N
assert.ok(defaultPreset["tools.snapping"].includes("KeyN"));
assert.ok(defaultPreset["tools.snapping"].includes("Shift+KeyS"));

console.log("  ✔ Todos os atalhos de teclado (QWER, ASDF, Shift+D, N, Backspace/Delete) validados com sucesso.");

// 2. Validando TIMELINE_STATE: getClipAtPlayhead, getAllClipsAtPlayhead e addClipsToSelection
console.log("\n2. Validando getClipAtPlayhead, getAllClipsAtPlayhead e addClipsToSelection...");

const tState = new CapiauTimelineState();
tState.fps = 24;

const clip1 = { id: "c1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 48 };
const clip2 = { id: "c2", track: "V1", timelineStartFrame: 72, inFrame: 0, outFrame: 48, link_id: "link_2" };
const clip2Audio = { id: "c2_a", track: "A1", timelineStartFrame: 72, inFrame: 0, outFrame: 48, link_id: "link_2" };
STATE.activeTimelineCuts = [clip1, clip2, clip2Audio];

tState.playheadFrame = 24;
const hit1 = tState.getClipAtPlayhead();
assert.ok(hit1, "Deve encontrar clipe em frame 24");
assert.strictEqual(hit1.id, "c1");

tState.playheadFrame = 60;
const hitGap = tState.getGapAtPlayhead();
assert.ok(hitGap, "Deve encontrar gap em frame 60");
assert.strictEqual(hitGap.startFrame, 48);
assert.strictEqual(hitGap.durationFrames, 24);

// Teste de multi-seleção vertical no frame 80 (c2 e c2_a)
tState.playheadFrame = 80;
const allHits = tState.getAllClipsAtPlayhead();
assert.strictEqual(allHits.length, 2, "getAllClipsAtPlayhead deve retornar 2 clipes (V1 e A1)");
const allHitIds = allHits.map(h => h.id);
assert.ok(allHitIds.includes("c2"));
assert.ok(allHitIds.includes("c2_a"));

// Teste de multi-seleção cumulativa com addClipsToSelection
tState.selectClip("c1");
assert.strictEqual(tState.selectedClipIds.size, 1);
assert.ok(tState.selectedClipIds.has("c1"));

tState.addClipsToSelection(["c2", "c2_a"]);
assert.strictEqual(tState.selectedClipIds.size, 3, "addClipsToSelection deve acumular clipes");
assert.ok(tState.selectedClipIds.has("c1"));
assert.ok(tState.selectedClipIds.has("c2"));
assert.ok(tState.selectedClipIds.has("c2_a"));

console.log("  ✔ getAllClipsAtPlayhead e addClipsToSelection (Shift+D) validados com sucesso.");

// 3. Validando Selection Follows Playhead e Botão na UI
console.log("\n3. Validando Modo Selection Follows Playhead e Botão...");
assert.strictEqual(tState.selectionFollowsPlayhead, false);

tState.toggleSelectionFollowsPlayhead();
assert.strictEqual(tState.selectionFollowsPlayhead, true);

tState.setPlayheadFrame(10);
assert.strictEqual(tState.selectedClipId, "c1");

tState.setPlayheadFrame(60);
assert.strictEqual(tState.selectedClipId, null);

tState.setPlayheadFrame(80);
assert.strictEqual(tState.selectedClipId, "c2");

tState.toggleSelectionFollowsPlayhead();
assert.strictEqual(tState.selectionFollowsPlayhead, false);

// Validação do DOM do botão #btn-selection-follows-playhead
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");
assert.ok(htmlContent.includes('id="btn-selection-follows-playhead"'), "Botão #btn-selection-follows-playhead deve existir no index.html");
assert.ok(htmlContent.includes('data-tooltip="Seleção Acompanha a Agulha (Ctrl+Alt+P)"'), "Tooltip do botão deve indicar atalho Ctrl+Alt+P");

console.log("  ✔ Selection Follows Playhead e botão na toolbar validados com sucesso.");

// 4. Validando Disable / Mute de Clipe (KeyF)
console.log("\n4. Validando Toggle Disable/Mute de Clipe...");
tState.selectedClipId = "c2";
const resDisable = tState.toggleClipDisabled("c2");
assert.ok(resDisable);
const liveC2 = STATE.activeTimelineCuts.find(c => c.id === "c2");
const liveC2A = STATE.activeTimelineCuts.find(c => c.id === "c2_a");

assert.strictEqual(liveC2.disabled, true);
assert.strictEqual(liveC2A.disabled, true);

const resReenable = tState.toggleClipDisabled("c2");
assert.strictEqual(liveC2.disabled, false);
assert.strictEqual(liveC2A.disabled, false);

console.log("  ✔ Toggle Disable/Mute de clipe e pares vinculados validado com sucesso.");
console.log("\n============================================================");
console.log("🎉 TODOS OS TESTES (INCLUINDO SHIFT+D E BOTÃO) PASSARAM 100%!");
console.log("============================================================\n");
