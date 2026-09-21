// Autoteste: Estado de Rotação no Source Player — blindagem dos eventos cruzados.
//
// Regressão coberta (bug de teste manual):
//   "No Source a foto só aparece correta enquanto giramos; ao clicar nela de novo,
//    volta à posição original (rotação perdida)."
//
// Causa raiz: os setters de STATE (state.js) emitem eventos em cadeia — ao ativar uma
// foto, `activePhotoChanged(foto)` (que aplica a rotação no elemento) é seguido de
// `activeVideoChanged(null)`; o handler chama `loadVideo(null)`, que chamava
// `applyRotation(0)` INCONDICIONALMENTE. Como `applyRotation` elege o alvo por
// `STATE.activePhoto`, o 0° era aplicado NO ELEMENTO DA FOTO, apagando a rotação
// recém-aplicada. O espelho (`loadPhoto(null)` zerando a rotação do vídeo ativo)
// também foi blindado.
//
// Regras testadas:
//   1. loadVideo(null): applyRotation(0) só dentro do guard `if (!STATE.activePhoto)`.
//   2. loadPhoto(null): applyRotation(0) só dentro do guard `if (!STATE.activeVideo)`.
//   3. applyRotation continua elegendo o alvo por STATE.activePhoto (premissa da blindagem).
//   4. mediaRotated reaplica a rotação na mídia ativa (vídeo e foto).
//   5. state.js: cada setter emite o evento do próprio tipo ANTES do evento cruzado (null) —
//      é essa cadeia que torna a blindagem necessária.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

console.log("=== INICIANDO AUTOTESTE: ESTADO DE ROTAÇÃO NO SOURCE PLAYER ===\n");

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const count = (src, needle) => src.split(needle).length - 1;

const playerJs = read("src/ui/js/player.js");
const stateJs = read("src/ui/js/state.js");

// ─────────────────────────────────────────────────────────────────────
// 1. LOADVIDEO(NULL) — O APPLYROTATION(0) DEVE FICAR DENTRO DO GUARD DA FOTO
// ─────────────────────────────────────────────────────────────────────
console.log("1. Verificando blindagem do loadVideo(null) contra a foto ativa...");

const loadVideoStart = playerJs.indexOf("loadVideo(video) {");
assert.ok(loadVideoStart > -1, "player.js deve conter loadVideo(video)");

const nullVideoIdx = playerJs.indexOf("if (!video) {", loadVideoStart);
assert.ok(nullVideoIdx > -1, "loadVideo deve ter o ramo 'if (!video)'");

const nullVideoBlock = playerJs.slice(nullVideoIdx, nullVideoIdx + 900);
const guardPhotoIdx = nullVideoBlock.indexOf("if (!STATE.activePhoto) {");
const applyZeroIdx = nullVideoBlock.indexOf("this.applyRotation(0);");

assert.ok(guardPhotoIdx > -1, "O ramo 'if (!video)' deve ter o guard 'if (!STATE.activePhoto)'");
assert.ok(applyZeroIdx > -1, "O ramo 'if (!video)' deve (ainda) zerar a rotação quando não há foto");
assert.ok(
    applyZeroIdx > guardPhotoIdx,
    "applyRotation(0) deve vir DEPOIS do guard (!STATE.activePhoto) — zerar incondicionalmente apaga a rotação da foto ativa"
);
assert.ok(
    !nullVideoBlock.includes("if (!video) {\n            this.applyRotation(0);"),
    "O ramo 'if (!video)' não pode mais começar com applyRotation(0) incondicional"
);
assert.ok(
    nullVideoBlock.includes("Nenhum clipe carregado"),
    "A limpeza do palco de vídeo (rótulo 'Nenhum clipe carregado') deve continuar dentro do guard"
);

// ─────────────────────────────────────────────────────────────────────
// 2. LOADPHOTO(NULL) — ESPELHO: APPLYROTATION(0) DENTRO DO GUARD DO VÍDEO
// ─────────────────────────────────────────────────────────────────────
console.log("2. Verificando blindagem espelhada do loadPhoto(null) contra o vídeo ativo...");

const loadPhotoStart = playerJs.indexOf("loadPhoto(photo) {");
assert.ok(loadPhotoStart > -1, "player.js deve conter loadPhoto(photo)");

const nullPhotoIdx = playerJs.indexOf("if (!photo) {", loadPhotoStart);
assert.ok(nullPhotoIdx > -1, "loadPhoto deve ter o ramo 'if (!photo)'");

const nullPhotoBlock = playerJs.slice(nullPhotoIdx, nullPhotoIdx + 500);
const guardVideoIdx = nullPhotoBlock.indexOf("if (!STATE.activeVideo) {");
const applyZeroPhotoIdx = nullPhotoBlock.indexOf("this.applyRotation(0);");

assert.ok(guardVideoIdx > -1, "O ramo 'if (!photo)' deve ter o guard 'if (!STATE.activeVideo)'");
assert.ok(applyZeroPhotoIdx > -1, "O ramo 'if (!photo)' deve (ainda) zerar a rotação quando não há vídeo");
assert.ok(
    applyZeroPhotoIdx > guardVideoIdx,
    "applyRotation(0) deve vir DEPOIS do guard (!STATE.activeVideo) — zerar incondicionalmente apaga a rotação do vídeo ativo"
);

// ─────────────────────────────────────────────────────────────────────
// 3. PREMISSA: APPLYROTATION ELEGE O ALVO POR STATE.ACTIVEPHOTO
// ─────────────────────────────────────────────────────────────────────
console.log("3. Confirmando a eleição de alvo do applyRotation (premissa da blindagem)...");

assert.ok(
    playerJs.includes('const targetEl = STATE.activePhoto ? this.el("source-player-photo") : this.el("source-video");'),
    "applyRotation deve eleger o alvo por STATE.activePhoto (é o que tornava o applyRotation(0) perigoso)"
);

// ─────────────────────────────────────────────────────────────────────
// 4. MEDIAROTATED — REAPLICA A ROTAÇÃO NA MÍDIA ATIVA (VÍDEO E FOTO)
// ─────────────────────────────────────────────────────────────────────
console.log("4. Verificando a reaplicação de rotação pelo evento mediaRotated...");

const rotatedIdx = playerJs.indexOf('STATE.on("mediaRotated"');
assert.ok(rotatedIdx > -1, "O Source Player deve escutar mediaRotated");
const rotatedBlock = playerJs.slice(rotatedIdx, rotatedIdx + 700);
assert.ok(
    rotatedBlock.includes("String(STATE.activeVideo.id) === String(mediaId)") &&
    rotatedBlock.includes("String(STATE.activePhoto.id) === String(mediaId)"),
    "mediaRotated deve casar a mídia ativa por tipo e id (vídeo e foto)"
);
assert.ok(
    count(rotatedBlock, "this.applyRotation(rotation);") === 2,
    "mediaRotated deve reaplicar a rotação para os dois ramos (vídeo e foto)"
);

// ─────────────────────────────────────────────────────────────────────
// 5. STATE.JS — CADEIA DE EVENTOS QUE ORIGINA A BLINDAGEM
// ─────────────────────────────────────────────────────────────────────
console.log("5. Verificando a cadeia de emissão dos setters (origem do bug)...");

const photoSetterIdx = stateJs.indexOf("set activePhoto(val) {");
assert.ok(photoSetterIdx > -1, "state.js deve conter o setter activePhoto");
const photoSetter = stateJs.slice(photoSetterIdx, photoSetterIdx + 400);
assert.ok(
    photoSetter.indexOf('this.emit("activePhotoChanged"') < photoSetter.indexOf('this.emit("activeVideoChanged"'),
    "setter activePhoto deve emitir activePhotoChanged ANTES de activeVideoChanged(null) — a cadeia que a blindagem neutraliza"
);

const videoSetterIdx = stateJs.indexOf("set activeVideo(val) {");
assert.ok(videoSetterIdx > -1, "state.js deve conter o setter activeVideo");
const videoSetter = stateJs.slice(videoSetterIdx, videoSetterIdx + 400);
assert.ok(
    videoSetter.indexOf('this.emit("activeVideoChanged"') < videoSetter.indexOf('this.emit("activePhotoChanged"'),
    "setter activeVideo deve emitir activeVideoChanged ANTES de activePhotoChanged(null)"
);

console.log("\n=== TODOS OS TESTES PASSARAM: ESTADO DE ROTAÇÃO NO SOURCE BLINDADO ===");
