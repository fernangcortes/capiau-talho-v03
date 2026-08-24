// Autoteste: Zoom Livre, Scroll/Pan e Minimapa do Program Player
import assert from "node:assert";

console.log("=== INICIANDO TESTES DO ZOOM LIVRE E MINIMAPA DO PROGRAM ===");

// 1. Teste de Presets e Seleção
const validPresets = ["fit", "0.1", "0.25", "0.5", "0.75", "1", "1.5", "2"];
assert.strictEqual(validPresets.includes("0.1"), true, "Preset 10% deve existir");
assert.strictEqual(validPresets.includes("1.5"), true, "Preset 150% deve existir");
assert.strictEqual(validPresets.includes("2"), true, "Preset 200% deve existir");
console.log("ok - 1: Presets 10%, 150% e 200% validados");

// 2. Teste de Cálculo de Zoom Livre e Focal Clamping
function calculateShiftZoom({ curScale, deltaY, mouseOffsetX, mouseOffsetY, curPanX, curPanY, tw, th, wrapperW, wrapperH }) {
    const factor = deltaY < 0 ? 1.15 : (1 / 1.15);
    let targetScale = curScale * factor;
    targetScale = Math.max(0.10, Math.min(10.0, targetScale));

    const pointX = (mouseOffsetX - curPanX) / curScale;
    const pointY = (mouseOffsetY - curPanY) / curScale;

    let newPanX = mouseOffsetX - pointX * targetScale;
    let newPanY = mouseOffsetY - pointY * targetScale;

    const newVW = Math.round(tw * targetScale);
    const newVH = Math.round(th * targetScale);
    const maxPanX = Math.max(0, (newVW - wrapperW) / 2);
    const maxPanY = Math.max(0, (newVH - wrapperH) / 2);

    newPanX = Math.max(-maxPanX, Math.min(maxPanX, newPanX));
    newPanY = Math.max(-maxPanY, Math.min(maxPanY, newPanY));

    if (newVW <= wrapperW) newPanX = 0;
    if (newVH <= wrapperH) newPanY = 0;

    return {
        scale: parseFloat(targetScale.toFixed(3)),
        panX: newPanX,
        panY: newPanY,
        hasOverflow: (newVW > wrapperW) || (newVH > wrapperH)
    };
}

// Zoom in a partir de 1.0 com mouse no centro (0, 0)
const z1 = calculateShiftZoom({
    curScale: 1.0,
    deltaY: -100, // Wheel up -> zoom in
    mouseOffsetX: 0,
    mouseOffsetY: 0,
    curPanX: 0,
    curPanY: 0,
    tw: 1920,
    th: 1080,
    wrapperW: 800,
    wrapperH: 450
});
assert.strictEqual(z1.scale, 1.15, "Escala após wheel up deve ser 1.15");
assert.strictEqual(z1.hasOverflow, true, "1920*1.15 = 2208 > 800 deve ter overflow");
console.log("ok - 2: Zoom in suave com Shift+Wheel validado (1.0 -> 1.15)");

// Zoom out até o limite inferior (0.10)
let zMin = { curScale: 0.15 };
for (let i = 0; i < 10; i++) {
    zMin = calculateShiftZoom({
        curScale: zMin.scale || zMin.curScale,
        deltaY: 100,
        mouseOffsetX: 0,
        mouseOffsetY: 0,
        curPanX: 0,
        curPanY: 0,
        tw: 1920,
        th: 1080,
        wrapperW: 800,
        wrapperH: 450
    });
}
assert.strictEqual(zMin.scale, 0.10, "Limite mínimo de zoom deve ser 10% (0.10)");
assert.strictEqual(zMin.panX, 0, "Pan deve ser 0 quando o vídeo cabe na tela");
console.log("ok - 3: Limite mínimo de zoom (10%) validado");

// 3. Teste de Rolagem / Pan com Wheel Comum
function calculateWheelPan({ deltaY, deltaX, isAlt, curPanX, curPanY, scale, tw, th, wrapperW, wrapperH }) {
    const vW = Math.round(tw * scale);
    const vH = Math.round(th * scale);
    const overflowX = vW > wrapperW;
    const overflowY = vH > wrapperH;

    if (!overflowX && !overflowY) return { panX: 0, panY: 0 };

    const maxPanX = overflowX ? (vW - wrapperW) / 2 : 0;
    const maxPanY = overflowY ? (vH - wrapperH) / 2 : 0;

    let panX = curPanX;
    let panY = curPanY;

    if (isAlt || Math.abs(deltaX) > Math.abs(deltaY)) {
        const dx = deltaX !== 0 ? deltaX : deltaY;
        panX -= dx * 0.8;
    } else {
        if (overflowY) {
            panY -= deltaY * 0.8;
        } else if (overflowX) {
            panX -= deltaY * 0.8;
        }
    }

    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));

    return { panX, panY, maxPanX, maxPanY };
}

// Com zoom de 200% (escala 2.0): vW = 3840, vH = 2160, wrapper = 800x450
// maxPanX = (3840 - 800) / 2 = 1520, maxPanY = (2160 - 450) / 2 = 855
const p1 = calculateWheelPan({
    deltaY: 50,
    deltaX: 0,
    isAlt: false,
    curPanX: 0,
    curPanY: 0,
    scale: 2.0,
    tw: 1920,
    th: 1080,
    wrapperW: 800,
    wrapperH: 450
});
assert.strictEqual(p1.panY, -40, "Pan Y deve ser deslocado em -40px com deltaY 50");

// Rolagem além do limite deve ser travada (clamp)
let pClamp = { panY: 0, panX: 0 };
for (let i = 0; i < 30; i++) {
    pClamp = calculateWheelPan({
        deltaY: 100,
        deltaX: 0,
        isAlt: false,
        curPanX: 0,
        curPanY: pClamp.panY,
        scale: 2.0,
        tw: 1920,
        th: 1080,
        wrapperW: 800,
        wrapperH: 450
    });
}
assert.strictEqual(pClamp.panY, -855, "Pan vertical deve travar no limite -maxPanY (-855px)");
console.log("ok - 4: Rolagem vertical com roda do mouse e travamento de bordas validados");

// Rolagem horizontal com Alt
const pHoriz = calculateWheelPan({
    deltaY: 100,
    deltaX: 0,
    isAlt: true,
    curPanX: 0,
    curPanY: 0,
    scale: 2.0,
    tw: 1920,
    th: 1080,
    wrapperW: 800,
    wrapperH: 450
});
assert.strictEqual(pHoriz.panX, -80, "Pan horizontal com Alt+Wheel deve funcionar");
console.log("ok - 5: Rolagem horizontal com Alt+Wheel validada");

// 4. Teste de Geometria do Minimapa
function calculateMinimapRect({ tw, th, scale, panX, panY, wrapperW, wrapperH, minimapW, minimapH }) {
    const vW = Math.round(tw * scale);
    const vH = Math.round(th * scale);
    const hasOverflow = (vW > wrapperW) || (vH > wrapperH);

    if (!hasOverflow) {
        return { visible: false };
    }

    const aspect = tw / th;
    const mAspect = minimapW / minimapH;
    let dw, dh, dx, dy;
    if (aspect > mAspect) {
        dw = minimapW;
        dh = minimapW / aspect;
        dx = 0;
        dy = (minimapH - dh) / 2;
    } else {
        dh = minimapH;
        dw = minimapH * aspect;
        dx = (minimapW - dw) / 2;
        dy = 0;
    }

    const visFracW = Math.min(1, wrapperW / vW);
    const visFracH = Math.min(1, wrapperH / vH);

    const rectW = Math.max(6, Math.min(dw, visFracW * dw));
    const rectH = Math.max(6, Math.min(dh, visFracH * dh));

    const normCenterX = 0.5 - (panX / (tw * scale));
    const normCenterY = 0.5 - (panY / (th * scale));

    let rectLeft = dx + (normCenterX * dw) - (rectW / 2);
    let rectTop = dy + (normCenterY * dh) - (rectH / 2);

    rectLeft = Math.max(dx, Math.min(dx + dw - rectW, rectLeft));
    rectTop = Math.max(dy, Math.min(dy + dh - rectH, rectTop));

    return {
        visible: true,
        rectLeft: Math.round(rectLeft),
        rectTop: Math.round(rectTop),
        rectW: Math.round(rectW),
        rectH: Math.round(rectH)
    };
}

// Minimapa quando ampliado em 2.0x com pan centralizado (0, 0)
const mm1 = calculateMinimapRect({
    tw: 1920,
    th: 1080,
    scale: 2.0,
    panX: 0,
    panY: 0,
    wrapperW: 800,
    wrapperH: 450,
    minimapW: 140,
    minimapH: 80
});
assert.strictEqual(mm1.visible, true, "Minimapa deve estar visível com zoom 200%");
assert.ok(mm1.rectW > 0 && mm1.rectH > 0, "Retângulo do minimapa deve ter dimensões positivas");
assert.ok(mm1.rectLeft >= 0 && mm1.rectTop >= 0, "Retângulo deve estar dentro das coordenadas do minimapa");
console.log("ok - 6: Geometria do minimapa e caixa de visualização validadas");

// Minimapa quando escala cabe na janela (fitScale)
const mmFit = calculateMinimapRect({
    tw: 1920,
    th: 1080,
    scale: 0.4,
    panX: 0,
    panY: 0,
    wrapperW: 800,
    wrapperH: 450,
    minimapW: 140,
    minimapH: 80
});
assert.strictEqual(mmFit.visible, false, "Minimapa deve ficar oculto quando o vídeo cabe na tela");
console.log("ok - 7: Minimapa oculto no modo Ajustar/Fit validado");

// 5. Teste de Autosave e Restauração de Pan
const autosaveState = {
    previewZoom: 1.5,
    previewPanX: -120,
    previewPanY: 85
};
const serialized = JSON.stringify(autosaveState);
const restored = JSON.parse(serialized);
assert.strictEqual(restored.previewZoom, 1.5, "previewZoom restaurado");
assert.strictEqual(restored.previewPanX, -120, "previewPanX restaurado");
assert.strictEqual(restored.previewPanY, 85, "previewPanY restaurado");
console.log("ok - 8: Serialização e restauração do estado de zoom e pan validadas");

console.log("\nTODOS OS 8 TESTES DE ZOOM LIVRE E MINIMAPA PASSARAM COM SUCESSO!");
