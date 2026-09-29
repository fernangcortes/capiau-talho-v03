// Autoteste da ponte tela <-> banco da timeline (src/ui/js/timelinePersistencia.js).
// Executa em Node.js: node tests/autoteste_timeline_persistencia.mjs
//
// Antes cada botão montava o objeto salvo à mão com meia dúzia de campos, e o
// resto do clipe sumia: desativado, rotação, velocidade/reverso, freeze, subclipe
// e o texto dos títulos. O render lê o banco, então exportava tudo errado.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { corteParaSalvar, cortesParaSalvar, corteDoBanco } from "../src/ui/js/timelinePersistencia.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 30;
let n = 0;
const ok = (msg) => console.log(`✔ Teste ${++n}: ${msg}`);

console.log("=== PERSISTÊNCIA DA TIMELINE (tela <-> banco) ===");

// 1. Campos do editor vão para o banco
const rapido = {
    id: "c1", type: "video", video_id: 7, in: 0, out: 10, inFrame: 0, outFrame: 150,
    timelineStartFrame: 60, track: "V1", link_id: "L1", effects: [],
    speed: 2, reverse: true, source_duration_frames: 300, rotation: 90,
    disabled: true, name: "Fala", is_subclip: true, parent_video_id: 7,
    _cacheInterno: { x: 1 }, alvo: () => 1
};
const s = corteParaSalvar(rapido, FPS);
assert.equal(s.in_time, 0);
assert.equal(s.out_time, 10);
assert.equal(s.timeline_start, 2);
for (const k of ["speed", "reverse", "source_duration_frames", "rotation", "disabled",
                 "name", "is_subclip", "parent_video_id"]) {
    assert.deepEqual(s[k], rapido[k], `campo ${k} tem de ir para o banco`);
}
ok("velocidade, reverso, rotação, desativado, nome e subclipe vão para o banco");

// 2. Derivados e estado interno ficam fora
for (const k of ["in", "out", "inFrame", "outFrame", "timelineStartFrame", "_cacheInterno", "alvo"]) {
    assert.ok(!(k in s), `${k} não deveria ser salvo`);
}
ok("frames derivados, chaves internas (_) e funções não são salvos");

// 3. Clipe desativado NÃO é filtrado (reabrir precisa mostrá-lo desligado)
assert.equal(cortesParaSalvar([rapido, { ...rapido, id: "c2", disabled: false }], FPS).length, 2);
ok("clipes desativados são salvos com disabled:true, não descartados");

// 4. Título leva texto e estilo
const titulo = { id: "gc", type: "text", in: 0, out: 3, timelineStartFrame: 0, track: "T1",
                 text: "Fulana", subtext: "Diretora", fontFamily: "Inter", fontSize: 48,
                 posX: 0.1, posY: 0.8, effects: [] };
const st = corteParaSalvar(titulo, FPS);
for (const k of ["text", "subtext", "fontFamily", "fontSize", "posX", "posY"]) {
    assert.equal(st[k], titulo[k]);
}
ok("títulos levam texto, fonte e posição");

// 5. Ida e volta: velocidade reconstrói a duração NA TIMELINE
const volta = corteDoBanco({ ...s, in: s.in_time, out: s.out_time }, 0, FPS);
assert.equal(volta.timelineStartFrame, 60);
assert.equal(volta.inFrame, 0);
assert.equal(volta.outFrame, 150, "10 s de fonte a 200% ocupam 150 frames (5 s)");
assert.equal(volta.speed, 2);
assert.equal(volta.disabled, true);
assert.ok(!("timeline_start" in volta));
ok("ida e volta preserva campos e refaz outFrame pela velocidade");

// 6. Sem velocidade, frames ficam para o conformCuts (derivados de in/out)
const normal = corteDoBanco({ id: "n", in: 1, out: 4, timeline_start: 0, track: "V1" }, 0, FPS);
assert.ok(!("inFrame" in normal) && !("outFrame" in normal));
ok("clipe a 100% deixa os frames para o conformCuts");

// 6b. Trim num clipe acelerado deixa `out` errado (out = outFrame/fps, sem a
//     velocidade). O salvo tem de ser o que o player toca: in + duração * speed.
const trimado = { id: "t", in: 4, out: 3.5, inFrame: 60, outFrame: 105, timelineStartFrame: 0,
                  track: "V1", speed: 2, effects: [] };
assert.equal(corteParaSalvar(trimado, FPS).out_time, 4 + (45 / FPS) * 2);
ok("clipe acelerado salva o out que o player alcança, mesmo com out desatualizado");

// 7. Os três pontos do app usam a ponte (nenhum mapeamento à mão sobrou)
const panels = readFileSync(path.join(raiz, "src/ui/js/panels.js"), "utf8");
const exportVideo = readFileSync(path.join(raiz, "src/ui/js/exportVideo.js"), "utf8");
assert.ok(panels.includes("cortesParaSalvar(STATE.activeTimelineCuts, fps)"));
assert.ok(panels.includes("cortesDoBanco(sequence.clips, fps)"));
assert.ok(exportVideo.includes("cortesParaSalvar(STATE.activeTimelineCuts, fps)"));
for (const [nome, fonte] of [["panels.js", panels], ["exportVideo.js", exportVideo]]) {
    assert.ok(!/in_time:\s*c\.in/.test(fonte), `${nome} ainda monta o clipe salvo à mão`);
}
ok("Salvar, Salvar-e-exportar e Carregar passam pela mesma ponte");

console.log(`\n=== ${n}/${n} TESTES APROVADOS ===`);
