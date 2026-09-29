// Autoteste: edições em clipes com velocidade/reverso não fazem o conteúdo "escorregar".
// Execução: node tests/autoteste_retime_edicao.mjs
//
// Defeito corrigido: trim, split, ripple trim, rolling, slide e slip aplicavam o delta de
// TIMELINE direto no inFrame e gravavam in = inFrame/fps e out = outFrame/fps. Num clipe a
// 2x, cortar 10 frames da cabeça andava só 10 frames na fonte (o quadro sob a agulha
// mudava) e o `out` ficava errado (o reverso tocava o trecho errado; o render recebia lixo).
//
// Critério: o quadro da FONTE que toca num instante fixo da timeline não muda com a edição
// (mesma conta do player: _targetSecondsFor).
import assert from "node:assert/strict";

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.localStorage = {
    _data: {}, getItem(k) { return this._data[k] || null; }, setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }, clear() { this._data = {}; }
};
globalThis.document = {
    defaultView: globalThis, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, appendChild: () => {}, setAttribute: () => {}, innerHTML: "" }),
    body: { appendChild: () => {} }, addEventListener: () => {}, removeEventListener: () => {}
};

const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

const FPS = 30;
TIMELINE_STATE.fps = FPS;
TIMELINE_STATE.setTracks([
    { id: "V1", name: "V1", kind: "video", volume: 1, muted: false, locked: false },
    { id: "A1", name: "A1", kind: "audio", volume: 1, muted: false, locked: false }
]);

let n = 0;
const ok = (msg) => console.log(`✔ Teste ${++n}: ${msg}`);
const perto = (a, b, tol = 1 / FPS + 1e-9) => Math.abs(a - b) <= tol;

/** Instante da FONTE tocado num frame da timeline (espelho de player._targetSecondsFor). */
function fonteEm(c, frame) {
    const s = (typeof c.speed === "number" && c.speed > 0) ? c.speed : 1;
    const off = ((frame - c.timelineStartFrame) / FPS) * s;
    return c.reverse ? c.out - off : c.in + off;
}

/** Clipe coerente com o invariante que changeClipSpeed cria. */
function clipe(id, start, inSec, durTl, extra = {}) {
    const s = extra.speed || 1;
    const inFrame = Math.round(inSec * FPS);
    return {
        id, track: "V1", type: "video", video_id: 1, timelineStartFrame: start, timeline_start: start / FPS,
        inFrame, outFrame: inFrame + durTl, in: inFrame / FPS, out: inFrame / FPS + (durTl / FPS) * s,
        mediaDurationFrames: 100000, effects: [], ...extra
    };
}

const cenarios = [
    ["100%", {}],
    ["2x", { speed: 2 }],
    ["50%", { speed: 0.5 }],
    ["reverso", { reverse: true }],
    ["2x reverso", { speed: 2, reverse: true }]
];

// 1. Primitivas: 100% sem reverso dá exatamente o resultado antigo
{
    const c = clipe("a", 0, 10, 90);
    TIMELINE_STATE.aplicarCabeca(c, c.inFrame, c.outFrame, 15);
    assert.equal(c.inFrame, 315); assert.equal(c.outFrame, 390);
    assert.equal(c.in, 315 / FPS); assert.equal(c.out, 390 / FPS);
    TIMELINE_STATE.aplicarCauda(c, c.inFrame, c.outFrame, -30);
    assert.equal(c.outFrame, 360); assert.equal(c.out, 360 / FPS);
    ok("primitivas em clipe 100% idênticas ao comportamento anterior");
}

// 2. Split: os dois pedaços continuam tocando o mesmo quadro de antes
for (const [nome, extra] of cenarios) {
    STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, extra)];
    const antes = { ...STATE.activeTimelineCuts[0] };
    const pontos = [0, 30, 59, 60, 61, 100, 119].map(f => [f, fonteEm(antes, f)]);
    TIMELINE_STATE.splitClipAtFrame("a", 60, false);
    const [esq, dir] = STATE.activeTimelineCuts;
    for (const [f, esperado] of pontos) {
        const peca = f < 60 ? esq : dir;
        assert.ok(perto(fonteEm(peca, f), esperado), `split ${nome}: frame ${f} tocava ${esperado}, agora ${fonteEm(peca, f)}`);
    }
    assert.equal(esq.outFrame - esq.inFrame, 60);
    assert.equal(dir.outFrame - dir.inFrame, 60);
}
ok("split preserva o quadro tocado em 100%, 2x, 50%, reverso e 2x reverso");

// 3. Ripple trim da cabeça até a agulha (Q): o que sobra toca o que tocava
for (const [nome, extra] of cenarios) {
    STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, extra)];
    const antes = { ...STATE.activeTimelineCuts[0] };
    TIMELINE_STATE.setPlayheadFrame(40);
    TIMELINE_STATE.selectedClipId = "a";
    TIMELINE_STATE.rippleTrimToPlayhead("head", "a");
    const c = STATE.activeTimelineCuts.find(x => x.id === "a");
    // o conteúdo que estava no frame 40 agora está no frame 0 (ripple recua)
    assert.ok(perto(fonteEm(c, 0), fonteEm(antes, 40)), `Q ${nome}: esperado ${fonteEm(antes, 40)}, veio ${fonteEm(c, 0)}`);
    assert.ok(perto(fonteEm(c, 79), fonteEm(antes, 119)), `Q ${nome}: fim do clipe`);
}
ok("ripple trim de cabeça (Q) avança a fonte na escala da velocidade");

// 4. Trim com o mouse (cabeça e cauda), mesmo critério
const fakeInteracao = {
    dragState: null, dragStartClipFrame: null, dragStartInFrame: null, dragStartOutFrame: null,
    dragPartnerStartClipFrame: null, dragPartnerStartInFrame: null, dragPartnerStartOutFrame: null
};
for (const [nome, extra] of cenarios) {
    STATE.activeTimelineCuts = [clipe("a", 100, 10, 120, extra)];
    const antes = { ...STATE.activeTimelineCuts[0] };
    CapiauTimelineInteraction.prototype.trimClipLeft.call(fakeInteracao, "a", 20, false, false);
    let c = STATE.activeTimelineCuts[0];
    assert.equal(c.timelineStartFrame, 120);
    for (const f of [120, 150, 219]) {
        assert.ok(perto(fonteEm(c, f), fonteEm(antes, f)), `trim cabeça ${nome}: frame ${f}`);
    }
    CapiauTimelineInteraction.prototype.trimClipRight.call(fakeInteracao, "a", -30, false, false);
    c = STATE.activeTimelineCuts[0];
    assert.equal(c.outFrame - c.inFrame, 70);
    for (const f of [120, 150, 189]) {
        assert.ok(perto(fonteEm(c, f), fonteEm(antes, f)), `trim cauda ${nome}: frame ${f}`);
    }
}
ok("trim de cabeça e cauda com o mouse não fazem o conteúdo escorregar");

// 5. Rolling edit entre um clipe 2x e um reverso
{
    const a = clipe("a", 0, 10, 60, { speed: 2 });
    const b = clipe("b", 60, 40, 60, { reverse: true });
    STATE.activeTimelineCuts = [a, b];
    const [A0, B0] = [{ ...a }, { ...b }];
    TIMELINE_STATE.rollingEdit("a", "b", 15, false);
    const [A, B] = STATE.activeTimelineCuts;
    assert.equal(B.timelineStartFrame, 75);
    for (const f of [0, 30, 59, 74]) assert.ok(perto(fonteEm(A, f), fonteEm(A0, f)), `rolling A frame ${f}`);
    for (const f of [75, 100, 119]) assert.ok(perto(fonteEm(B, f), fonteEm(B0, f)), `rolling B frame ${f}`);
}
ok("rolling edit preserva os dois lados (2x e reverso)");

// 6. Limite de mídia: clipe a 2x não estica além do fim do arquivo
{
    // fonte de 10 s (300 frames); clipe começa em 4 s a 2x com 60 frames de timeline (4 s de fonte)
    const c = clipe("a", 0, 4, 60, { speed: 2, mediaDurationFrames: 300 });
    STATE.activeTimelineCuts = [c];
    CapiauTimelineInteraction.prototype.trimClipRight.call(fakeInteracao, "a", 500, false, false);
    const r = STATE.activeTimelineCuts[0];
    // sobram 2 s de fonte = 1 s (30 frames) de timeline a 2x
    assert.equal(r.outFrame - r.inFrame, 90);
    assert.ok(perto(r.out, 10), `out deveria parar no fim da mídia (10 s), veio ${r.out}`);
}
ok("trim de cauda a 2x para no fim real da mídia");

// 7. conformCuts não corta pela metade um clipe a 50% que ocupa mais que a mídia em frames
{
    const c = clipe("lento", 0, 0, 600, { speed: 0.5, mediaDurationFrames: 300 });
    const [conf] = TIMELINE_STATE.conformCuts([c]);
    assert.equal(conf.outFrame - conf.inFrame, 600, "10 s de fonte a 50% ocupam 20 s (600 frames)");
}
ok("conformCuts respeita a velocidade ao aplicar o limite de mídia");

// 8. Freeze frame congela o quadro que está NA TELA (relato: a 200% o freeze "pulava")
for (const [nome, extra] of cenarios) {
    for (const modo of ["ripple", "overwrite"]) {
        STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, extra)];
        const antes = { ...STATE.activeTimelineCuts[0] };
        const gelo = TIMELINE_STATE.createFreezeFrameCut("a", 40, 1.0, modo);
        assert.ok(gelo, `freeze ${nome}/${modo} não foi criado`);
        assert.ok(perto(gelo.freeze_time, fonteEm(antes, 40)),
            `freeze ${nome}/${modo}: tela mostrava ${fonteEm(antes, 40)}, congelou ${gelo.freeze_time}`);
        // no ripple o resto do clipe continua de onde parou (empurrado 30 frames)
        if (modo === "ripple") {
            const resto = STATE.activeTimelineCuts.find(c => c.id !== "a" && !c.is_freeze);
            assert.ok(perto(fonteEm(resto, 40 + 30), fonteEm(antes, 40)), `freeze ${nome}: resto do clipe retomou errado`);
        }
    }
}
{
    // cauda: congela o último quadro visível
    STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, { speed: 2 })];
    const antes = { ...STATE.activeTimelineCuts[0] };
    const gelo = TIMELINE_STATE.createFreezeFrameCut("a", 120, 1.0, "ripple");
    assert.ok(perto(gelo.freeze_time, fonteEm(antes, 119)));
}
ok("freeze congela o quadro da tela em 100%, 2x, 50%, reverso e 2x reverso (meio e cauda)");

// 9. Sobrescrita no meio de um clipe acelerado: as duas sobras seguem no lugar
for (const [nome, extra] of cenarios) {
    const base = clipe("a", 0, 10, 120, extra);
    const antes = { ...base };
    const res = TIMELINE_STATE.overwriteTimeRange("V1", 40, 20, [], [base], null);
    const esq = res.find(c => c.timelineStartFrame === 0);
    const dir = res.find(c => c.timelineStartFrame === 60);
    for (const f of [0, 39]) assert.ok(perto(fonteEm(esq, f), fonteEm(antes, f)), `overwrite ${nome} esq ${f}`);
    for (const f of [60, 119]) assert.ok(perto(fonteEm(dir, f), fonteEm(antes, f)), `overwrite ${nome} dir ${f}`);
}
ok("sobrescrita no meio preserva as sobras (fatiaDoClipe)");

// 10. Lift e extract de um trecho do meio
for (const [nome, extra] of cenarios) {
    STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, extra)];
    const antes = { ...STATE.activeTimelineCuts[0] };
    TIMELINE_STATE.liftRange(40, 60);
    const dirLift = STATE.activeTimelineCuts.find(c => c.timelineStartFrame === 60);
    assert.ok(perto(fonteEm(dirLift, 60), fonteEm(antes, 60)), `lift ${nome}`);

    STATE.activeTimelineCuts = [clipe("a", 0, 10, 120, extra)];
    TIMELINE_STATE.extractRange(40, 60);
    const dirExt = STATE.activeTimelineCuts.find(c => c.timelineStartFrame === 40);
    assert.ok(perto(fonteEm(dirExt, 40), fonteEm(antes, 60)), `extract ${nome}: o que vinha em 60 agora vem em 40`);
}
ok("lift e extract preservam o conteúdo das sobras");

TIMELINE_HISTORY.clear();
console.log(`\n=== ${n}/${n} TESTES APROVADOS ===`);
