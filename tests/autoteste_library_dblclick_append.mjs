/**
 * Autoteste: Duplo Clique Padrão na Biblioteca (Final da Timeline),
 * Blindagem de Pistas Ocultas e Preferência pela Pista 1 em Empate.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("===============================================================================");
console.log("  AUTOTESTE: DUPLO CLIQUE PADRÃO (END), BLINDAGEM DE PISTAS OCULTAS & PISTA 1");
console.log("===============================================================================");

// ── BATERIA 1: ANÁLISE ESTÁTICA EM library.js ────────────────────────────────
console.log("\n1. Verificando atalhos e modos de ingestão em src/ui/js/library.js...");

const libraryJs = fs.readFileSync(path.join(__dirname, "../src/ui/js/library.js"), "utf8");

// Verificação do tooltip
assert.ok(
    libraryJs.includes('parts.push("⚡ 2x Clique: Final | Shift: Na agulha | Ctrl: 1º Gap | Alt: Empurrar");'),
    "Tooltip de decupagem deve indicar '2x Clique: Final | Shift: Na agulha'"
);

// Verificação do submenu de contexto
assert.ok(
    libraryJs.includes('{ mode: "end", icon: "fa-forward-step", label: "No Final da Timeline (Append)", shortcut: "2x Clique" }'),
    "Submenu deve ter 'No Final da Timeline (Append)' como atalho '2x Clique'"
);
assert.ok(
    libraryJs.includes('{ mode: "playhead", icon: "fa-location-crosshairs", label: "Na Posição da Agulha (Playhead)", shortcut: "Shift + 2x Clique" }'),
    "Submenu deve ter 'Na Posição da Agulha (Playhead)' como atalho 'Shift + 2x Clique'"
);
assert.ok(
    libraryJs.includes('runMediaInsert("end");'),
    "Clique direto no menu-pai 'Adicionar à Timeline' deve chamar runMediaInsert('end')"
);

// Verificação dos 3 pontos de dblclick (vídeo árvore, foto árvore, galeria grade)
const videoDblClickMatch = libraryJs.match(/card\.addEventListener\("dblclick",\s*\(e\)\s*=>\s*\{[\s\S]*?let mode = "(end|playhead)";[\s\S]*?if\s*\(e\.shiftKey[^)]*\)\s*\{\s*mode = "(end|playhead)";/);
assert.ok(videoDblClickMatch, "Handler de dblclick em vídeo deve existir");
assert.strictEqual(videoDblClickMatch[1], "end", "Vídeo na árvore deve ter modo padrão 'end'");
assert.strictEqual(videoDblClickMatch[2], "playhead", "Vídeo na árvore com Shift deve ter modo 'playhead'");

const photoDblClickSection = libraryJs.slice(libraryJs.indexOf('card.setAttribute("data-photo-id"'));
const photoDblClickMatch = photoDblClickSection.match(/card\.addEventListener\("dblclick",\s*\(e\)\s*=>\s*\{[\s\S]*?let mode = "(end|playhead)";[\s\S]*?if\s*\(e\.shiftKey[^)]*\)\s*\{\s*mode = "(end|playhead)";/);
assert.ok(photoDblClickMatch, "Handler de dblclick em foto deve existir");
assert.strictEqual(photoDblClickMatch[1], "end", "Foto na árvore deve ter modo padrão 'end'");
assert.strictEqual(photoDblClickMatch[2], "playhead", "Foto na árvore com Shift deve ter modo 'playhead'");

const galleryDblClickSection = libraryJs.slice(libraryJs.indexOf('// Duplo clique insere na timeline (com suporte a atalhos Shift, Ctrl, Alt)'));
const galleryDblClickMatch = galleryDblClickSection.match(/itemEl\.addEventListener\("dblclick",\s*\(e\)\s*=>\s*\{[\s\S]*?let mode = "(end|playhead)";[\s\S]*?if\s*\(e\.shiftKey[^)]*\)\s*\{\s*mode = "(end|playhead)";/);
assert.ok(galleryDblClickMatch, "Handler de dblclick na galeria deve existir");
assert.strictEqual(galleryDblClickMatch[1], "end", "Galeria deve ter modo padrão 'end'");
assert.strictEqual(galleryDblClickMatch[2], "playhead", "Galeria com Shift deve ter modo 'playhead'");

console.log("  ✔ Todos os pontos de duplo clique em library.js usam 'end' por padrão e 'playhead' com Shift.");

// ── BATERIA 2: TESTES DE COMPORTAMENTO EM CapiauTimelineState ────────────────
console.log("\n2. Testando lógica de roteamento e inserção em timelineState.js...");

// Mock de ambiente mínimo do DOM e localStorage
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};

globalThis.window = {
    activeFocusedPlayer: null,
    showToast: () => {}
};

const { STATE } = await import("../src/ui/js/state.js");
const { CapiauTimelineState } = await import("../src/ui/js/timelineState.js");

const tState = new CapiauTimelineState();
tState.fps = 24;

// Mocks de mídias no acervo
STATE.allVideos = [
    { id: "v1", title: "Video 1", duration: 5.0, fps: 24, resolution: "1920x1080" },
    { id: "v2", title: "Video 2", duration: 10.0, fps: 24, resolution: "1920x1080" },
    { id: "vbroll", title: "B-Roll 1", duration: 4.0, fps: 24, video_type: "broll" }
];
STATE.allPhotos = [
    { id: "p1", title: "Foto 1" },
    { id: "p2", title: "Foto 2" }
];

function resetTimeline(tracksConfig = null) {
    STATE.activeTimelineCuts = [];
    tState.selectedClipId = null;
    tState.selectedTrack = null;
    tState.playheadFrame = 0;
    if (tracksConfig) {
        tState.tracks = tracksConfig;
    } else {
        tState.tracks = [
            { id: "V2", kind: "video", locked: false, hidden: false },
            { id: "V1", kind: "video", locked: false, hidden: false },
            { id: "A1", kind: "audio", locked: false, hidden: false },
            { id: "A2", kind: "audio", locked: false, hidden: false }
        ];
    }
}

// 2.1 Timeline Vazia: Ambas abertas -> SEMPRE preferir Pista 1 (V1) no Frame 0
resetTimeline();
let cut1 = tState.insertMedia({ type: "video", id: "v1", mode: "end" });
assert.strictEqual(cut1.track, "V1", "Timeline vazia com ambas abertas deve inserir em V1");
assert.strictEqual(cut1.timelineStartFrame, 0, "Timeline vazia deve iniciar no frame 0");
console.log("  ✔ Timeline vazia: inseriu na Pista 1 (V1) no frame 0.");

// 2.2 Foto em Timeline Vazia: Ambas abertas -> preferir Pista 1 (V1) no Frame 0
resetTimeline();
let cutPhoto1 = tState.insertMedia({ type: "photo", id: "p1", mode: "end" });
assert.strictEqual(cutPhoto1.track, "V1", "Foto em timeline vazia com ambas abertas deve inserir em V1");
assert.strictEqual(cutPhoto1.timelineStartFrame, 0, "Foto em timeline vazia deve iniciar no frame 0");
console.log("  ✔ Foto em timeline vazia: inseriu na Pista 1 (V1) no frame 0.");

// 2.3 B-Roll em Timeline Vazia: Ambas abertas -> preferir Pista 1 (V1) no Frame 0
resetTimeline();
let cutBroll1 = tState.insertMedia({ type: "video", id: "vbroll", mode: "end" });
assert.strictEqual(cutBroll1.track, "V1", "B-Roll em timeline vazia com ambas abertas deve inserir em V1");
assert.strictEqual(cutBroll1.timelineStartFrame, 0, "B-Roll em timeline vazia deve iniciar no frame 0");
console.log("  ✔ B-Roll em timeline vazia: inseriu na Pista 1 (V1) no frame 0.");

// 2.4 Ambas as pistas terminando no mesmo frame: empate -> SEMPRE preferir Pista 1 (V1)
resetTimeline();
STATE.activeTimelineCuts = [
    { id: "c_v1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 240 }, // 10s
    { id: "c_v2", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 240 }  // 10s
];
let cutTie = tState.insertMedia({ type: "video", id: "v1", mode: "end" });
assert.strictEqual(cutTie.track, "V1", "Empate de término entre pistas abertas deve preferir Pista 1 (V1)");
assert.strictEqual(cutTie.timelineStartFrame, 240, "Deve anexar exatamente após o término (frame 240)");
console.log("  ✔ Empate de término (ambas em 240f): inseriu na Pista 1 (V1) no frame 240.");

// 2.5 V1 termina após V2 -> Deve anexar em V1
resetTimeline();
STATE.activeTimelineCuts = [
    { id: "c_v1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 500 },
    { id: "c_v2", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 200 }
];
let cutV1Ahead = tState.insertMedia({ type: "video", id: "v1", mode: "end" });
assert.strictEqual(cutV1Ahead.track, "V1", "Quando V1 é o fim da timeline, deve inserir em V1");
assert.strictEqual(cutV1Ahead.timelineStartFrame, 500, "Deve anexar no frame 500");
console.log("  ✔ V1 adiante de V2 (500f vs 200f): inseriu em V1 no frame 500.");

// 2.6 V2 termina após V1 -> Deve anexar em V2
resetTimeline();
STATE.activeTimelineCuts = [
    { id: "c_v1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 200 },
    { id: "c_v2", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 500 }
];
let cutV2Ahead = tState.insertMedia({ type: "video", id: "v1", mode: "end" });
assert.strictEqual(cutV2Ahead.track, "V2", "Quando V2 é o fim da timeline, deve inserir em V2");
assert.strictEqual(cutV2Ahead.timelineStartFrame, 500, "Deve anexar no frame 500");
console.log("  ✔ V2 adiante de V1 (500f vs 200f): inseriu em V2 no frame 500.");

// 2.7 Pista V1 oculta (hidden = true) -> NUNCA mandar para V1, mandar para V2
resetTimeline([
    { id: "V2", kind: "video", locked: false, hidden: false },
    { id: "V1", kind: "video", locked: false, hidden: true },
    { id: "A1", kind: "audio", locked: false, hidden: false },
    { id: "A2", kind: "audio", locked: false, hidden: false }
]);
STATE.activeTimelineCuts = [
    { id: "c_v1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 800 },
    { id: "c_v2", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 150 }
];
let cutV1Hidden = tState.insertMedia({ type: "video", id: "v1", mode: "end" });
assert.strictEqual(cutV1Hidden.track, "V2", "Quando V1 está oculta, NUNCA deve inserir em V1, mesmo que V1 seja mais longa");
assert.strictEqual(cutV1Hidden.timelineStartFrame, 150, "Deve anexar no término da pista aberta V2 (frame 150)");
console.log("  ✔ Pista V1 oculta: roteou para a pista aberta V2 (frame 150), ignorando V1.");

// 2.8 Pista V2 oculta (hidden = true) -> NUNCA mandar para V2, mandar para V1
resetTimeline([
    { id: "V2", kind: "video", locked: false, hidden: true },
    { id: "V1", kind: "video", locked: false, hidden: false },
    { id: "A1", kind: "audio", locked: false, hidden: false },
    { id: "A2", kind: "audio", locked: false, hidden: false }
]);
STATE.activeTimelineCuts = [
    { id: "c_v1", track: "V1", timelineStartFrame: 0, inFrame: 0, outFrame: 150 },
    { id: "c_v2", track: "V2", timelineStartFrame: 0, inFrame: 0, outFrame: 800 }
];
let cutV2Hidden = tState.insertMedia({ type: "photo", id: "p1", mode: "end" });
assert.strictEqual(cutV2Hidden.track, "V1", "Quando V2 está oculta, foto NUNCA deve ser inserida em V2");
assert.strictEqual(cutV2Hidden.timelineStartFrame, 150, "Deve anexar no término da pista aberta V1 (frame 150)");
console.log("  ✔ Pista V2 oculta: inseriu foto em V1 (frame 150), protegendo contra pista oculta.");

// 2.9 targetTrack explícito para pista oculta deve ser ignorado e redirecionado para aberta
resetTimeline([
    { id: "V2", kind: "video", locked: false, hidden: false },
    { id: "V1", kind: "video", locked: false, hidden: true }
]);
let cutTargetHidden = tState.insertMedia({ type: "video", id: "v1", mode: "end", targetTrack: "V1" });
assert.strictEqual(cutTargetHidden.track, "V2", "targetTrack apontando para pista oculta deve ser redirecionado para aberta");
console.log("  ✔ targetTrack explicitamente em pista oculta foi blindado e redirecionado para pista aberta.");

// 2.10 Chamada de insertMedia sem argumento mode deve usar 'end' por padrão
resetTimeline();
let cutDefaultMode = tState.insertMedia({ type: "video", id: "v1" }); // omite mode
assert.strictEqual(cutDefaultMode.track, "V1", "Modo padrão sem especificar mode deve ser 'end' (V1)");
assert.strictEqual(cutDefaultMode.timelineStartFrame, 0, "Modo padrão deve iniciar no fim da timeline (0 em vazia)");
console.log("  ✔ insertMedia() sem parâmetro mode adota 'end' por padrão.");

// 2.11 Modo playhead (Shift + Duplo Clique) posiciona na agulha
resetTimeline();
tState.playheadFrame = 123;
let cutPlayhead = tState.insertMedia({ type: "video", id: "v1", mode: "playhead" });
assert.strictEqual(cutPlayhead.timelineStartFrame, 123, "Modo 'playhead' deve respeitar playheadFrame");
console.log("  ✔ Modo 'playhead' insere fielmente no frame da agulha (123f).");

console.log("\n===============================================================================");
console.log("🎉 TODOS OS 11 TESTES DE DUPLO CLIQUE E ROTEAMENTO FORAM APROVADOS (100%)!");
console.log("===============================================================================\n");
