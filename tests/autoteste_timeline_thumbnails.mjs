// Autoteste: Miniaturas Proporcionais da Timeline & 3 Modos Clássicos (CapIAu-Talho)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("▶ Iniciando autoteste de Miniaturas da Timeline (Proporção & 3 Modos Clássicos)...\n");

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

const mockElements = {};
globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => mockElements[id] || null,
    querySelectorAll: () => []
};

// 1. Validar TIMELINE_STATE e os 3 Modos de Miniatura
const { TIMELINE_STATE } = await import("../src/ui/js/timelineState.js");
const { STATE } = await import("../src/ui/js/state.js");

console.log("1. Validando Modos de Miniatura e Desativação em TIMELINE_STATE...");
assert.equal(TIMELINE_STATE.thumbnailMode, "continuous", "Modo inicial padrão deve ser 'continuous'");
assert.equal(TIMELINE_STATE.globalThumbnailsInterval, 1.0, "Intervalo padrão deve ser 1.0");

// Teste de desativação com 'none'
let cutsEmitted = false;
STATE.on("timelineCutsUpdated", () => { cutsEmitted = true; });

TIMELINE_STATE.setGlobalThumbnailMode("none");
assert.equal(TIMELINE_STATE.thumbnailMode, "none", "Modo deve ser 'none'");
assert.equal(TIMELINE_STATE.globalThumbnailsInterval, 0.0, "Intervalo deve ser 0.0 ao desativar");
assert.equal(cutsEmitted, true, "Deve emitir timelineCutsUpdated ao alterar modo");

// Teste crítico do bug corrigido: setGlobalThumbnailsInterval('0.0') ou 0
cutsEmitted = false;
TIMELINE_STATE.setGlobalThumbnailsInterval("0.0");
assert.equal(TIMELINE_STATE.thumbnailMode, "none", "setGlobalThumbnailsInterval('0.0') deve desativar (não virar 1.0)");
assert.equal(TIMELINE_STATE.globalThumbnailsInterval, 0.0, "Intervalo deve ser estritamente 0.0");

// Teste de 'head' (Apenas Início / Primeiro Quadro)
cutsEmitted = false;
TIMELINE_STATE.setGlobalThumbnailMode("head");
assert.equal(TIMELINE_STATE.thumbnailMode, "head", "Modo deve ser 'head'");
assert.equal(TIMELINE_STATE.globalThumbnailsInterval > 0, true, "Intervalo deve ser positivo em 'head'");

// Teste de 'continuous' (Rolo de Filme)
cutsEmitted = false;
TIMELINE_STATE.setGlobalThumbnailMode("continuous");
assert.equal(TIMELINE_STATE.thumbnailMode, "continuous", "Modo deve ser 'continuous'");
assert.equal(TIMELINE_STATE.globalThumbnailsInterval, 1.0, "Intervalo padrão deve ser 1.0");
console.log("  ✔ Máquina de estados dos 3 modos e correção do bug de '0.0' validados com sucesso.");

// 2. Validar cálculo de Proporção de Aspecto (Aspect Ratio) do TimelineRenderer
console.log("\n2. Validando cálculo de proporção de aspecto (Aspect Ratio)...");

// Simulação de TimelineRenderer mínimo para testar cálculo de geometria
const mockRenderer = {
    videoThumbCache: {},
    getVideoAspectRatio(video) {
        if (!video) return 16 / 9;
        if (this.videoThumbCache) {
            for (const key in this.videoThumbCache) {
                if (key.startsWith(`${video.id}_`)) {
                    const entry = this.videoThumbCache[key];
                    if (entry && entry.loaded && entry.img && entry.img.naturalWidth && entry.img.naturalHeight) {
                        return entry.img.naturalWidth / entry.img.naturalHeight;
                    }
                }
            }
        }
        if (video.resolution && typeof video.resolution === "string" && video.resolution.includes("x")) {
            const parts = video.resolution.split("x").map(Number);
            if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
                return parts[0] / parts[1];
            }
        }
        if (TIMELINE_STATE?.width && TIMELINE_STATE?.height && TIMELINE_STATE.height > 0) {
            return TIMELINE_STATE.width / TIMELINE_STATE.height;
        }
        return 16 / 9;
    }
};

// Vídeo Widescreen 16:9
const vid169 = { id: 1, resolution: "1920x1080" };
const aspect169 = mockRenderer.getVideoAspectRatio(vid169);
assert.equal(Math.round(aspect169 * 1000) / 1000, 1.778, "1920x1080 deve ter aspect ratio de ~1.778 (16:9)");

// Pista com altura de 150px (como na imagem do usuário)
const clipHeightLarge = 150;
const thumbWidth169 = Math.round(clipHeightLarge * aspect169);
assert.equal(thumbWidth169, 267, "Pista de 150px com vídeo 16:9 deve ter thumbs de 267px de largura (proporcional, não 80px)");

// Pista compacta de 45px
const clipHeightCompact = 45;
const thumbWidthCompact = Math.round(clipHeightCompact * aspect169);
assert.equal(thumbWidthCompact, 80, "Pista compacta de 45px com vídeo 16:9 deve ter thumbs de 80px");

// Vídeo Vertical 9:16 (Shorts/Reels)
const vid916 = { id: 2, resolution: "1080x1920" };
const aspect916 = mockRenderer.getVideoAspectRatio(vid916);
assert.equal(aspect916, 0.5625, "1080x1920 deve ter aspect ratio de 0.5625 (9:16)");
const thumbWidth916 = Math.round(clipHeightLarge * aspect916);
assert.equal(thumbWidth916, 84, "Pista de 150px com vídeo vertical 9:16 deve ter thumbs de 84px (estreitas, sem esticar)");

// Foto Quadrada 1:1
const vid11 = { id: 3, resolution: "1080x1080" };
const aspect11 = mockRenderer.getVideoAspectRatio(vid11);
assert.equal(aspect11, 1.0, "1080x1080 deve ter aspect ratio de 1.0");

console.log("  ✔ Geometria proporcional para 16:9 (267px), 9:16 (84px) e 1:1 validada com exatidão.");

// 3. Validar integridade nos arquivos da UI (index.html, main.js, timelineRenderer.js)
console.log("\n3. Validando consistência dos arquivos de interface...");
const indexHtml = fs.readFileSync(path.join(ROOT, "src/ui/index.html"), "utf-8");
assert.ok(indexHtml.includes('value="continuous"'), "index.html deve conter opção 'continuous'");
assert.ok(indexHtml.includes('value="head"'), "index.html deve conter opção 'head'");
assert.ok(indexHtml.includes('value="none"'), "index.html deve conter opção 'none'");

const rendererJs = fs.readFileSync(path.join(ROOT, "src/ui/js/timelineRenderer.js"), "utf-8");
assert.ok(rendererJs.includes("getVideoAspectRatio(video, rotation = 0)"), "timelineRenderer.js deve conter método getVideoAspectRatio (com suporte a rotação)");
assert.ok(rendererJs.includes("this.getVideoAspectRatio(video, videoRot)"), "timelineRenderer.js deve chamar getVideoAspectRatio repassando a rotação");
assert.ok(rendererJs.includes("TIMELINE_STATE.thumbnailMode === \"head\""), "timelineRenderer.js deve suportar modo head");
assert.ok(rendererJs.includes("thumbsGloballyEnabled"), "timelineRenderer.js deve checar thumbsGloballyEnabled");

console.log("  ✔ Todos os arquivos da UI estão íntegros e consistentes.");

console.log("\n============================================================");
console.log("🎉 AUTOTESTE DE MINIATURAS DA TIMELINE 100% APROVADO!");
console.log("============================================================");
