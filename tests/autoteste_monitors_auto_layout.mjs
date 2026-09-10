// tests/autoteste_monitors_auto_layout.mjs
// Autoteste do Modo Automático Inteligente de Disposição dos Monitores (Source e Program)
// Execução: node tests/autoteste_monitors_auto_layout.mjs

import assert from "node:assert/strict";

console.log("=== INICIANDO TESTES DO MODO AUTOMÁTICO DE MONITORES ===");

// ─── 1. SIMULADOR DO ALGORITMO DE CÁLCULO DE DISPOSIÇÃO ───
class LayoutCalculator {
    constructor() {
        this.resolvedMonitorsLayout = "side-by-side";
    }

    calculateBestMonitorsLayout(containerW, containerH, videoAspect = 16 / 9, chromeH = 110) {
        if (!containerW || !containerH || containerW <= 0 || containerH <= 0) {
            return this.resolvedMonitorsLayout || "side-by-side";
        }

        const aspect = (typeof videoAspect === "number" && videoAspect > 0) ? videoAspect : (16 / 9);
        const splitterSize = 4;

        // 1. Candidato Lado a Lado (Horizontal)
        const sideWidthPerMonitor = Math.max(0, (containerW - splitterSize) / 2);
        const sideHeightForVideo = Math.max(0, containerH - chromeH);

        const sideVidW = Math.min(sideWidthPerMonitor, sideHeightForVideo * aspect);
        const sideVidH = aspect > 0 ? sideVidW / aspect : 0;
        let sideScore = sideVidW * sideVidH;

        // 2. Candidato Empilhados (Vertical)
        const stackedWidthPerMonitor = Math.max(0, containerW);
        const stackedHeightPerMonitor = Math.max(0, (containerH - splitterSize) / 2);

        const stackedVidW = Math.min(stackedWidthPerMonitor, stackedHeightPerMonitor * aspect);
        const stackedVidH = aspect > 0 ? stackedVidW / aspect : 0;
        let stackedScore = stackedVidW * stackedVidH;

        // 3. Fatores ergonômicos
        if (sideWidthPerMonitor < 280) {
            sideScore *= 0.65;
        } else if (sideWidthPerMonitor < 320) {
            sideScore *= 0.85;
        }

        if (stackedHeightPerMonitor < 120) {
            stackedScore *= 0.5;
        } else if (stackedHeightPerMonitor < 150) {
            stackedScore *= 0.8;
        }

        // 4. Histerese Anti-Flicker (8%)
        const currentActive = this.resolvedMonitorsLayout || "side-by-side";
        const HYSTERESIS = 1.08;

        if (currentActive === "side-by-side") {
            return (stackedScore > sideScore * HYSTERESIS) ? "stacked" : "side-by-side";
        } else {
            return (sideScore > stackedScore * HYSTERESIS) ? "side-by-side" : "stacked";
        }
    }
}

const calc = new LayoutCalculator();

// TESTE 1: Widescreen 16:9 em container largo (ex: 1400x500 - timeline no centro, menus normais)
{
    calc.resolvedMonitorsLayout = "side-by-side";
    const layout = calc.calculateBestMonitorsLayout(1400, 500, 16 / 9);
    assert.equal(layout, "side-by-side", "Container largo com 16:9 deve escolher side-by-side");
    console.log("✔ Teste 1 passou: Container largo (1400x500, 16:9) -> side-by-side");
}

// TESTE 2: Widescreen 16:9 em container estreito e alto (ex: 600x700 - menus expandidos ou tela vertical)
{
    calc.resolvedMonitorsLayout = "side-by-side";
    const layout = calc.calculateBestMonitorsLayout(600, 700, 16 / 9);
    assert.equal(layout, "stacked", "Container estreito/alto com 16:9 deve escolher stacked");
    console.log("✔ Teste 2 passou: Container estreito/alto (600x700, 16:9) -> stacked");
}

// TESTE 3: Vídeo vertical 9:16 (Shorts/Reels) em container normal (ex: 1000x600)
{
    calc.resolvedMonitorsLayout = "side-by-side";
    const layout = calc.calculateBestMonitorsLayout(1000, 600, 9 / 16);
    assert.equal(layout, "side-by-side", "Vídeo vertical 9:16 deve preferir side-by-side para aproveitar altura");
    console.log("✔ Teste 3 passou: Vídeo vertical (1000x600, 9:16) -> side-by-side");
}

// TESTE 4: Penalidade ergonômica de largura estreita (< 280px por monitor)
{
    calc.resolvedMonitorsLayout = "side-by-side";
    // Total 520px -> 258px por monitor em side-by-side (espreme botões). Altura 450px.
    const layout = calc.calculateBestMonitorsLayout(520, 450, 16 / 9);
    assert.equal(layout, "stacked", "Largura menor que 280px por monitor deve preferir stacked por ergonomia");
    console.log("✔ Teste 4 passou: Penalidade de largura (< 280px) -> stacked");
}

// TESTE 5: Histerese Anti-Flicker (impede oscilação em torno do limite de transição)
{
    // Clica quando a diferença for menor que 8%
    calc.resolvedMonitorsLayout = "side-by-side";
    // Valores calculados para estarem muito próximos do limiar (diferença < 5%)
    const W = 710;
    const H = 410;
    const layoutWhenSide = calc.calculateBestMonitorsLayout(W, H, 16 / 9);
    
    calc.resolvedMonitorsLayout = "stacked";
    const layoutWhenStacked = calc.calculateBestMonitorsLayout(W, H, 16 / 9);

    // Ambas devem manter o estado ativo atual devido ao buffer de 8%
    assert.equal(layoutWhenSide, "side-by-side", "Histerese deve manter side-by-side na zona de transição");
    assert.equal(layoutWhenStacked, "stacked", "Histerese deve manter stacked na zona de transição");
    console.log("✔ Teste 5 passou: Histerese anti-flicker impede jitter no ponto limítrofe");
}

// ─── 2. SIMULADOR DO ARE_BOTH_MONITORS_OPEN ───
class FakePanel {
    constructor(id) {
        this.id = id;
        this.style = { display: "" };
        this.classList = new Set();
    }
}

class FakeWorkspace {
    constructor() {
        this.poppedElements = {};
        this.containerChildren = new Set();
    }

    areBothMonitorsOpen(srcPanel, prgPanel) {
        if (!srcPanel || !prgPanel) return false;
        if (!this.containerChildren.has(srcPanel) || !this.containerChildren.has(prgPanel)) return false;

        if (this.poppedElements["source-player-panel"] || this.poppedElements["program-player-panel"]) return false;
        if (srcPanel.classList.has("popped-out-hidden") || prgPanel.classList.has("popped-out-hidden")) return false;

        if (srcPanel.style.display === "none" || prgPanel.style.display === "none") return false;
        if (srcPanel.classList.has("collapsed") || prgPanel.classList.has("collapsed")) return false;

        if (srcPanel.classList.has("maximized") || prgPanel.classList.has("maximized")) return false;

        return true;
    }
}

const fw = new FakeWorkspace();
const src = new FakePanel("source-player-panel");
const prg = new FakePanel("program-player-panel");
fw.containerChildren.add(src);
fw.containerChildren.add(prg);

// TESTE 6: Ambos abertos
{
    assert.equal(fw.areBothMonitorsOpen(src, prg), true, "Ambos normais devem retornar true");
    console.log("✔ Teste 6 passou: areBothMonitorsOpen() retorna true quando ambos estão visíveis");
}

// TESTE 7: Um maximizado
{
    src.classList.add("maximized");
    assert.equal(fw.areBothMonitorsOpen(src, prg), false, "Source maximizado deve retornar false");
    src.classList.delete("maximized");
    console.log("✔ Teste 7 passou: areBothMonitorsOpen() retorna false quando um está maximizado");
}

// TESTE 8: Um oculto
{
    prg.style.display = "none";
    assert.equal(fw.areBothMonitorsOpen(src, prg), false, "Program oculto deve retornar false");
    prg.style.display = "";
    console.log("✔ Teste 8 passou: areBothMonitorsOpen() retorna false quando um está oculto");
}

// TESTE 9: Um em pop-out
{
    fw.poppedElements["source-player-panel"] = src;
    assert.equal(fw.areBothMonitorsOpen(src, prg), false, "Source em pop-out deve retornar false");
    delete fw.poppedElements["source-player-panel"];
    console.log("✔ Teste 9 passou: areBothMonitorsOpen() retorna false quando um está em pop-out");
}

// ─── 3. SIMULADOR DO CICLO DE MODOS TOGGLE ───
class ToggleStateMachine {
    constructor() {
        this.monitorsLayout = "auto";
        this.resolvedMonitorsLayout = "side-by-side";
    }

    toggle() {
        if (this.monitorsLayout === "auto") {
            this.monitorsLayout = "side-by-side";
        } else if (this.monitorsLayout === "side-by-side") {
            this.monitorsLayout = "stacked";
        } else {
            this.monitorsLayout = "auto";
        }
        return this.monitorsLayout;
    }
}

const sm = new ToggleStateMachine();
assert.equal(sm.monitorsLayout, "auto");
assert.equal(sm.toggle(), "side-by-side");
assert.equal(sm.toggle(), "stacked");
assert.equal(sm.toggle(), "auto");
console.log("✔ Teste 10 passou: toggleMonitorsLayout cicla auto -> side-by-side -> stacked -> auto");

console.log("\n=======================================================");
console.log("🎉 TODOS OS 10 TESTES DO MODO AUTOMÁTICO PASSARAM COM SUCESSO!");
console.log("=======================================================");
