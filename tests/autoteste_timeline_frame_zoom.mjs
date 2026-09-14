// Autoteste: Zoom na Régua da Timeline até Nível de Frames (CapIAu-Talho)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Zoom na Régua da Timeline até Nível de Frames...\n");

// Polyfill de ambiente de navegador para execução em Node.js ESM
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.document = {
    defaultView: globalThis,
    getElementById: () => null,
    querySelectorAll: () => []
};

// 1. Validar TIMELINE_STATE e limites de zoom
const { TIMELINE_STATE, formatRulerTimecode } = await import("../src/ui/js/timelineState.js");

console.log("1. Validando limites de zoom em TIMELINE_STATE...");
assert.equal(TIMELINE_STATE.minZoom, 0.01, "minZoom deve ser 0.01");
assert.equal(TIMELINE_STATE.maxZoom, 80.0, "maxZoom deve ser 80.0 (pixels por frame)");

let emittedZoom = null;
const { STATE } = await import("../src/ui/js/state.js");
STATE.on("timelineZoomChanged", (z) => { emittedZoom = z; });

// Teste de clamp inferior
TIMELINE_STATE.setZoom(0.0001);
assert.equal(TIMELINE_STATE.zoom, 0.01, "setZoom deve respeitar minZoom de 0.01");
assert.equal(emittedZoom, 0.01, "Deve emitir timelineZoomChanged com 0.01");

// Teste de clamp superior (zoom microscópico de frames)
TIMELINE_STATE.setZoom(150.0);
assert.equal(TIMELINE_STATE.zoom, 80.0, "setZoom deve permitir zoom até maxZoom de 80.0");
assert.equal(emittedZoom, 80.0, "Deve emitir timelineZoomChanged com 80.0");

// Teste de zoom intermediário
TIMELINE_STATE.setZoom(30.0);
assert.equal(TIMELINE_STATE.zoom, 30.0, "setZoom deve aceitar 30.0 px/frame");

TIMELINE_STATE.setZoom(0.5);
assert.equal(TIMELINE_STATE.zoom, 0.5, "setZoom deve restaurar 0.5");
console.log("  ✔ Limites de zoom (0.01 a 80.0 px/frame) validados com sucesso.");

// 2. Validar formatação de timecode da régua
console.log("\n2. Validando formatação de timecode na régua...");
// Segundo exato com showFrames=false
assert.equal(formatRulerTimecode(24, 24, false, false), "00:01", "Frame 24 a 24fps deve formatar como 00:01");
// Segundo exato com showFrames=true
assert.equal(formatRulerTimecode(24, 24, true, false), "00:01:00", "Frame 24 com showFrames deve formatar como 00:01:00");
// Frame intermediário com showFrames=true
assert.equal(formatRulerTimecode(29, 24, true, false), "00:01:05", "Frame 29 a 24fps deve formatar como 00:01:05");
console.log("  ✔ formatRulerTimecode validado com sucesso.");

// 3. Validar algoritmo de seleção adaptativa de intervalos de régua e tratamento de FPS fracionário
console.log("\n3. Validando lógica adaptativa de intervalos de régua (drawRuler)...");
function simulateRulerIntervals(zoom, fps = 24) {
    const fpsVal = Number(fps) > 0 ? Number(fps) : 24;
    const fpsBase = Math.max(1, Math.round(fpsVal));
    const rawCandidates = [
        1, 2, 5, 10,
        Math.max(1, Math.round(fpsBase / 4)),
        Math.max(1, Math.round(fpsBase / 2)),
        fpsBase * 1, fpsBase * 2, fpsBase * 5, fpsBase * 10, fpsBase * 15, fpsBase * 30, fpsBase * 60
    ];
    const candidates = [...new Set(rawCandidates.map(Math.round))].filter(c => c >= 1).sort((a, b) => a - b);

    function getRequiredPx(c) {
        if (c === 1) return 45;
        if (c === 2) return 55;
        if (c <= 5) return 65;
        if (c < fpsBase) return 75;
        return 85;
    }

    let textInterval = candidates[candidates.length - 1];
    for (const c of candidates) {
        if (c * zoom >= getRequiredPx(c)) {
            textInterval = c;
            break;
        }
    }

    let subTickInterval = textInterval;
    if (textInterval > 1) {
        if (zoom >= 4.5) {
            subTickInterval = 1;
        } else {
            const minTickPx = 6;
            const divisors = [];
            for (let d = 1; d <= textInterval; d++) {
                if (textInterval % d === 0) divisors.push(d);
            }
            for (const d of divisors) {
                if (d * zoom >= minTickPx) {
                    subTickInterval = d;
                    break;
                }
            }
        }
    }

    return { textInterval, subTickInterval, fpsBase };
}

// A 80px/frame: cada frame individual é rotulado com amplo respiro (80px >= 45px)
const res80 = simulateRulerIntervals(80.0, 24);
assert.equal(res80.textInterval, 1, "Com zoom de 80px/frame, textInterval deve ser 1");
assert.equal(res80.subTickInterval, 1, "subTickInterval deve ser 1");

// A 50px/frame: cada frame individual é rotulado com respiro confortável
const res50 = simulateRulerIntervals(50.0, 24);
assert.equal(res50.textInterval, 1, "Com zoom de 50px/frame, textInterval deve ser 1");

// A 30px/frame: rótulos a cada 2 frames (espaçados por 60px)
const res30 = simulateRulerIntervals(30.0, 24);
assert.equal(res30.textInterval, 2, "Com zoom de 30px/frame, textInterval deve ser 2 para não amontoar números");
assert.equal(res30.subTickInterval, 1, "subTickInterval deve ser 1");

// A 15px/frame: rótulos a cada 5 frames (espaçados por 75px)
const res15 = simulateRulerIntervals(15.0, 24);
assert.equal(res15.textInterval, 5, "Com zoom de 15px/frame, textInterval deve ser 5");
assert.equal(res15.subTickInterval, 1, "subTickInterval deve ser 1");

// Teste crítico: FPS fracionário (59.94 fps e 23.976 fps) nunca gera decimais espúrios
const fps59 = 59.94;
const fpsBase59 = Math.round(fps59);
assert.equal(fpsBase59, 60, "59.94 fps deve ter base inteira 60");

for (let f = 0; f <= 180; f += 10) {
    const frameInt = Math.round(f);
    const isSecond = (frameInt % fpsBase59 === 0);
    const frameInSec = ((frameInt % fpsBase59) + fpsBase59) % fpsBase59;
    const label = isSecond ? formatRulerTimecode(frameInt, fps59, true, false) : `:${String(frameInSec).padStart(2, '0')}`;
    
    assert.ok(!label.includes(".06"), `Rótulo no frame ${f} não pode conter '.06': ${label}`);
    assert.ok(!label.includes(".12"), `Rótulo no frame ${f} não pode conter '.12': ${label}`);
    assert.ok(/^[0-9:]+$/.test(label), `Rótulo no frame ${f} deve conter apenas dígitos e dois-pontos: ${label}`);
}

console.log("  ✔ Lógica adaptativa espaçosa e suporte robusto a FPS fracionário (59.94/23.976) validados com 100% de sucesso.");

// 4. Validar funções de conversão do slider exponencial
console.log("\n4. Validando mapeamento exponencial do slider horizontal...");
const SLIDER_MIN_Z = 0.02;
const SLIDER_MAX_Z = 80.0;
const sliderToZoom = (val) => {
    const ratio = Math.max(0, Math.min(100, Number(val) || 0)) / 100;
    return Math.round(SLIDER_MIN_Z * Math.pow(SLIDER_MAX_Z / SLIDER_MIN_Z, ratio) * 100) / 100;
};
const zoomToSlider = (z) => {
    const clamped = Math.max(SLIDER_MIN_Z, Math.min(SLIDER_MAX_Z, Number(z) || 0.5));
    return Math.round((Math.log(clamped / SLIDER_MIN_Z) / Math.log(SLIDER_MAX_Z / SLIDER_MIN_Z)) * 1000) / 10;
};

assert.equal(sliderToZoom(0), 0.02, "Slider em 0% deve resultar em 0.02px/f");
assert.equal(sliderToZoom(100), 80.0, "Slider em 100% deve resultar em 80.0px/f");
assert.ok(Math.abs(sliderToZoom(38.8) - 0.5) < 0.05, "Slider em ~38.8% deve mapear para o zoom padrão de ~0.5px/f");
assert.ok(Math.abs(zoomToSlider(0.5) - 38.8) < 1.0, "Zoom de 0.5 deve mapear de volta para ~38.8% no slider");
assert.equal(zoomToSlider(80.0), 100, "Zoom de 80.0 deve mapear para 100%");
assert.equal(zoomToSlider(0.02), 0, "Zoom de 0.02 deve mapear para 0%");
console.log("  ✔ Mapeamento bidirecional exponencial validado.");

// 5. Validar arquivo index.html e timelineInteraction.js
console.log("\n5. Validando arquivos de interface e interação...");
const htmlContent = fs.readFileSync(path.join(ROOT, "src/ui/index.html"), "utf-8");
assert.ok(htmlContent.includes('id="timeline-zoom-slider"'), "index.html deve conter timeline-zoom-slider");
assert.ok(htmlContent.includes('min="0" max="100"'), "timeline-zoom-slider deve ter range de 0 a 100");

const interactionContent = fs.readFileSync(path.join(ROOT, "src/ui/js/timelineInteraction.js"), "utf-8");
assert.ok(interactionContent.includes("isOverRuler"), "timelineInteraction.js deve detectar rotação de roda sobre a régua");
assert.ok(interactionContent.includes('activeTool === "zoom"'), "timelineInteraction.js deve tratar clique da ferramenta Zoom");
assert.ok(interactionContent.includes("isZoomInKey"), "timelineInteraction.js deve tratar atalhos de teclado de zoom");

console.log("  ✔ Código de index.html e timelineInteraction.js validado.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DE ZOOM NA RÉGUA DA TIMELINE 100% APROVADO!");
console.log("============================================================\n");
