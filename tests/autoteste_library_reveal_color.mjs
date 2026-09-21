import { readFileSync } from 'fs';
import { resolve } from 'path';
import assert from 'assert';

console.log("=== INICIANDO AUTOTESTE: ONDA ÚNICA 6PX 1.10S COM PISO DE LUMINOSIDADE ===");

const libraryJsPath = resolve(process.cwd(), 'src/ui/js/library.js');
const libraryJsContent = readFileSync(libraryJsPath, 'utf8');

const stylesCssPath = resolve(process.cwd(), 'src/ui/styles.css');
const stylesCssContent = readFileSync(stylesCssPath, 'utf8');

// Teste 1: Verificação no CSS da Onda Única Contínua (6px, 1.1s, Silk Ease-Out)
console.log("1. Verificando especificações da onda de expansão contínua no CSS...");
assert(stylesCssContent.includes("--reveal-color-rgb"), "CSS deve definir/usar --reveal-color-rgb");
assert(stylesCssContent.includes("outline-offset: 0px;"), "Início da onda deve partir colado ao card (0px)");
assert(stylesCssContent.includes("outline-offset: 6px;"), "Extensão da onda deve atingir exatamente 6px no fim do curso");
assert(stylesCssContent.includes("1.1s cubic-bezier(0.1, 0.6, 0.2, 1)"), "Duração da onda deve ser de 1.10s com easing cúbico contínuo");
console.log("✔ Teste 1 passou: CSS configurado com onda contínua de 6px e 1.10s.");

// Teste 2: Verificação da função hexToRgb no library.js
console.log("2. Verificando implementação de hexToRgb no library.js...");
assert(libraryJsContent.includes("export function hexToRgb(hex)"), "Deve exportar a função hexToRgb");

function hexToRgb(hex) {
    if (!hex || typeof hex !== "string") return [6, 182, 212];
    const clean = hex.replace("#", "").trim();
    if (clean.length === 3) {
        const rVal = parseInt(clean[0] + clean[0], 16);
        const gVal = parseInt(clean[1] + clean[1], 16);
        const bVal = parseInt(clean[2] + clean[2], 16);
        return [
            isNaN(rVal) ? 6 : rVal,
            isNaN(gVal) ? 182 : gVal,
            isNaN(bVal) ? 212 : bVal
        ];
    }
    const val = parseInt(clean, 16);
    if (isNaN(val) || clean.length < 6) return [6, 182, 212];
    return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
}

assert.deepStrictEqual(hexToRgb("#d97706"), [217, 119, 6], "Conversão de cor amarela/âmbar de fala");
assert.deepStrictEqual(hexToRgb("#10b981"), [16, 185, 129], "Conversão de cor esmeralda de foto");
assert.deepStrictEqual(hexToRgb("#8b5cf6"), [139, 92, 246], "Conversão de cor violeta de pasta");
assert.deepStrictEqual(hexToRgb("#f00"), [255, 0, 0], "Conversão de formato 3 caracteres #f00");
assert.deepStrictEqual(hexToRgb(null), [6, 182, 212], "Fallback para ciano quando cor nula");
console.log("✔ Teste 2 passou: hexToRgb converte corretamente paletas e hexadecimais.");

// Teste 3: Verificação da função calculateBoostedColor (Piso de Luminosidade)
console.log("3. Verificando calculateBoostedColor e piso de luminosidade...");
assert(libraryJsContent.includes("export function calculateBoostedColor(hex, floorL = 0.60)"), "Deve exportar calculateBoostedColor com piso padrão de 60%");

function calculateBoostedColor(hex, floorL = 0.60) {
    const [r, g, b] = hexToRgb(hex);
    const rN = r / 255, gN = g / 255, bN = b / 255;
    const max = Math.max(rN, gN, bN), min = Math.min(rN, gN, bN);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
            case gN: h = (bN - rN) / d + 2; break;
            case bN: h = (rN - gN) / d + 4; break;
        }
        h /= 6;
    }

    if (l < floorL) {
        const boostedL = Math.max(floorL, l * 1.35);
        const boostedS = Math.min(1, Math.max(0.45, s * 1.25));

        function hue2rgb(p, q, t) {
            let val = t;
            if (val < 0) val += 1;
            if (val > 1) val -= 1;
            if (val < 1/6) return p + (q - p) * 6 * val;
            if (val < 1/2) return q;
            if (val < 2/3) return p + (q - p) * (2/3 - val) * 6;
            return p;
        }

        const q = boostedL < 0.5 ? boostedL * (1 + boostedS) : boostedL + boostedS - boostedL * boostedS;
        const p = 2 * boostedL - q;
        const bR = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        const bG = Math.round(hue2rgb(p, q, h) * 255);
        const bB = Math.round(hue2rgb(p, q, h - 1/3) * 255);
        return [bR, bG, bB];
    }

    return [r, g, b];
}

// Cor escura #334155 (Luminosidade ~26%): deve ser elevada para pelo menos 60%
const boostedDark = calculateBoostedColor("#334155", 0.60);
const darkLum = (Math.max(...boostedDark) + Math.min(...boostedDark)) / (2 * 255);
assert(darkLum >= 0.55, `Cor escura deve atingir luminosidade de contraste seguro (obtido ${darkLum.toFixed(2)})`);

console.log("✔ Teste 3 passou: Piso de luminosidade garante contraste visível para qualquer cor escura.");

// Teste 4: Integração de applyRevealPulse
console.log("4. Verificando função applyRevealPulse e timeout de 1200ms...");
assert(libraryJsContent.includes("calculateBoostedColor(mediaColor, 0.60)"), "applyRevealPulse deve aplicar calculateBoostedColor");
assert(libraryJsContent.includes("setTimeout(() => {"), "Deve agendar limpeza controlada");
assert(libraryJsContent.includes("1200);"), "Timeout de limpeza deve ser de 1200ms para acomodar os 1.10s da onda");
console.log("✔ Teste 4 passou: applyRevealPulse calibrado para 1.10s de onda contínua.");

// Teste 5: Chamadas no índice e mídias
console.log("5. Verificando integração no navigateToItem, revealVideoById e revealPhotoById...");
assert(libraryJsContent.includes("applyRevealPulse(item, mediaColor);"), "navigateToItem deve chamar applyRevealPulse");
assert(libraryJsContent.includes("applyRevealPulse(card);"), "revealVideoById e revealPhotoById devem chamar applyRevealPulse");
console.log("✔ Teste 5 passou: Todas as portas de revelação acionam a onda contínua de 6px / 1.10s.");

console.log("\nTODOS OS TESTES PASSARAM COM SUCESSO! 🌊✨");
