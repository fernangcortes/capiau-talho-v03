// Autoteste: Conformação Padrão Fit (contain), Transform Fiel à Mídia, Auto-Zoom na Timeline
// e Blindagem da Rotação no Source Player.
//
// Cobre o plano "Conformação Fiel de Mídia, Transform Correto, Auto-Zoom e Rotação":
//   1. Conformação "fit" (contain) como padrão em todo o fluxo de criação de clipes.
//   2. Caixa do Transform contornando exatamente o retângulo visível da mídia conformada.
//   3. Auto-Zoom (zoomToFit) ao inserir a primeira mídia em uma timeline vazia.
//   4. Blindagem do Source Player quando o contêiner está com dimensões zeradas.
//   5. Paridade do renderizador Python (fallback "fit" quando não há bloco fit).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

console.log("=== INICIANDO AUTOTESTE: CONFORMAÇÃO FIT, TRANSFORM FIEL, AUTO-ZOOM & BLINDAGEM ===\n");

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
const count = (src, needle) => src.split(needle).length - 1;

const playerJs = read("src/ui/js/player.js");
const timelineStateJs = read("src/ui/js/timelineState.js");
const timelineInteractionJs = read("src/ui/js/timelineInteraction.js");
const grafoVideoPy = read("src/export/video_render/grafo_video.py");
const geometriaPy = read("src/export/video_render/geometria.py");

// ─────────────────────────────────────────────────────────────────────
// 1. PLAYER.JS — CONFORMAÇÃO PADRÃO FIT (CONTAIN)
// ─────────────────────────────────────────────────────────────────────
console.log("1. Verificando conformação padrão fit (contain) no player.js...");

assert.ok(
    playerJs.includes('const fitMode = fit ? fit.mode : "fit";'),
    "applyMediaEffects deve ter fallback de enquadramento 'fit' (contain)"
);
assert.ok(
    !playerJs.includes('const fitMode = fit ? fit.mode : "fill";'),
    "O antigo fallback 'fill' (cover destrutivo) não deve mais existir"
);
assert.ok(
    playerJs.includes("getMediaAspect(el, media)") && playerJs.includes("el.videoWidth || el.naturalWidth"),
    "getMediaAspect deve resolver a proporção intrínseca priorizando os pixels reais do elemento"
);
assert.ok(
    playerJs.includes('res.includes("x")'),
    "getMediaAspect deve ter fallback para o campo resolution da mídia"
);
console.log("   ✔ Fallback fit + resolução de aspecto intrínseco presentes.");

// ─────────────────────────────────────────────────────────────────────
// 2. PLAYER.JS — CAIXA CONFORMADA EM % (SEGUE O ZOOM) + TRANSLAÇÃO EQUIVALENTE
// ─────────────────────────────────────────────────────────────────────
console.log("2. Verificando caixa conformada em % (acompanha o zoom) e translação equivalente...");

assert.ok(
    playerJs.includes("const effAspect = (rotNorm === 90 || rotNorm === 270) ? (1 / mediaAspect) : mediaAspect;"),
    "Aspecto efetivo deve inverter em rotações de 90/270"
);
assert.ok(
    playerJs.includes("fracW = effAspect / frameAspect;") && playerJs.includes("fracH = frameAspect / effAspect;"),
    "Cálculo da caixa conformada (contain) em frações do quadro deve existir"
);
assert.ok(
    playerJs.includes("const elWPct = ((sideways ? fracH * pH : fracW * pW) / pW) * 100;") &&
    playerJs.includes("const elHPct = ((sideways ? fracW * pW : fracH * pH) / pH) * 100;"),
    "Caixa da mídia deve ser expressa em % do contêiner (derivada do aspecto) — acompanha o zoom livre sem recomputo"
);
assert.ok(
    count(playerJs, 'el.style.setProperty("width", `${elWPct}%`, "important");') >= 1,
    "Largura em % com !important deve prevalecer sobre o inset:0 do HTML"
);
assert.ok(
    count(playerJs, "translate(${txElPct}%, ${tyElPct}%)") >= 2,
    "Translação em % do próprio elemento deve ser aplicada na mídia E espelhada no overlay"
);
assert.ok(
    !playerJs.includes("translate(${tx}%, ${ty}%) scale(${scale}) rotate(${rotation}deg)"),
    "A translação antiga (antes do ajuste com fator de quadro) não deve permanecer"
);
console.log("   ✔ Caixa em % (zoom-safe) + translação com equivalência de px OK.");

// ─────────────────────────────────────────────────────────────────────
// 3. PLAYER.JS — OVERLAY DE TRANSFORM ESPELHA A MESMA CAIXA
// ─────────────────────────────────────────────────────────────────────
console.log("3. Verificando espelhamento do overlay de Transform (alças fiéis à mídia)...");

assert.ok(
    timelineInteractionJs.length > 0 && playerJs.includes("const mediaAspect = this.getMediaAspect(mediaEl, media);"),
    "syncTransformOverlay deve resolver o aspecto pela mesma fonte da mídia (elemento ativo)"
);
assert.ok(
    playerJs.includes('(["program-player-photo", "program-player-photo-b"]') &&
    playerJs.includes('(["program-video-a", "program-video-b", "program-video-c", "program-video-d"]'),
    "Overlay deve localizar o elemento ativo (foto ou buffer de vídeo em exibição) pelo activeClipId"
);
assert.ok(
    playerJs.includes("const boxWPct = ((sideways ? fracH * pH : fracW * pW) / pW) * 100;") &&
    playerJs.includes("const boxHPct = ((sideways ? fracW * pW : fracH * pH) / pH) * 100;"),
    "Overlay deve compartilhar a MESMA caixa em % da mídia (alças e zoom sempre em sincronia)"
);
assert.ok(
    playerJs.includes("cursorQuadrant") &&
    playerJs.includes('tl: "nesw-resize", tc: "ew-resize", tr: "nwse-resize"') &&
    playerJs.includes('handle.style.removeProperty("cursor")'),
    "Cursores rotação-aware: mapa por quadrante aplicado só quando a caixa está girada (e limpo fora dele)"
);
console.log("   ✔ Overlay conformado em % (alças fiéis à mídia e ao zoom) + cursores rotação-aware.");

// ─────────────────────────────────────────────────────────────────────
// 4. PLAYER.JS — BLINDAGEM DA ROTAÇÃO NO SOURCE PLAYER
// ─────────────────────────────────────────────────────────────────────
console.log("4. Verificando blindagem do Source Player para contêineres sem dimensões...");

assert.ok(
    playerJs.includes("_rotationRetryAttempts") && playerJs.includes("_rotationRetryScheduled"),
    "applyRotation deve reagendar o recálculo quando o wrapper estiver zerado"
);
assert.ok(
    playerJs.includes("requestAnimationFrame(reagendar)"),
    "Reagendamento deve usar requestAnimationFrame"
);
assert.ok(
    playerJs.includes("Math.max(0, Math.min(1, rawFinalOpacity))") ||
    playerJs.includes("rawFinalOpacity"),
    "Estrutura de opacidade do applyMediaEffects deve permanecer intacta (regressão zero)"
);
console.log("   ✔ Blindagem da rotação presente.");

// ─────────────────────────────────────────────────────────────────────
// 5. TIMELINESTATE.JS — PADRÃO FIT EM TODOS OS FLUXOS DE CRIAÇÃO
// ─────────────────────────────────────────────────────────────────────
console.log("5. Verificando padrão fit em todos os fluxos de criação de clipes...");

assert.equal(
    count(timelineStateJs, 'mode: "fill"'), 0,
    "Nenhum fluxo de criação deve usar mais mode 'fill' como padrão"
);
assert.ok(
    count(timelineStateJs, 'mode: "fit"') >= 8,
    "Todos os 8 pontos de criação de foto devem usar mode 'fit' (insertClipWithRipple, insertMedia, insertSourceClipAtPlayhead, addPhotoCut, acceptGhostSuggestion)"
);
assert.ok(
    !timelineStateJs.includes('Enquadramento default = "fill"'),
    "Docstring do addPhotoCut deve refletir o novo padrão fit"
);
console.log("   ✔ 8 rotas de criação com fit; nenhuma rota com fill.");

// ─────────────────────────────────────────────────────────────────────
// 6. TIMELINESTATE.JS — AUTO-ZOOM NA PRIMEIRA MÍDIA
// ─────────────────────────────────────────────────────────────────────
console.log("6. Verificando Auto-Zoom Inteligente (zoomToFit) nas 5 funções de inserção...");

assert.ok(
    count(timelineStateJs, "const wasEmptyTimeline = (STATE.activeTimelineCuts || []).length === 0;") >= 5,
    "As 5 funções de inserção devem capturar o estado vazio ANTES da inserção"
);
assert.ok(
    count(timelineStateJs, "if (wasEmptyTimeline) this.zoomToFit();") >= 5,
    "As 5 funções de inserção devem disparar zoomToFit() após inserir em timeline vazia"
);
assert.ok(
    timelineStateJs.includes("insertClipWithRipple(clipData, targetFrame, targetTrackId)") &&
    timelineStateJs.includes("insertMedia({ type = \"video\"") &&
    timelineStateJs.includes("insertSourceClipAtPlayhead(sourceData = null, isRipple = true)") &&
    timelineStateJs.includes("addCut(videoId, inSec, outSec") &&
    timelineStateJs.includes("addPhotoCut(photoId,"),
    "Assinaturas das 5 funções de inserção devem permanecer íntegras (regressão zero)"
);
console.log("   ✔ Auto-Zoom ligado às 5 rotas de inserção.");

// ─────────────────────────────────────────────────────────────────────
// 7. TIMELINEINTERACTION.JS — DROP COM CTRL (RIPPLE) E INSPECTOR
// ─────────────────────────────────────────────────────────────────────
console.log("7. Verificando onDrop (Ctrl/Ripple) e fallback do Inspector...");

assert.ok(
    timelineInteractionJs.includes('effects: [{ type: "fit", mode: "fit" }, ...effectsList]'),
    "Drop de foto com Ctrl (ripple) deve nascer com mode 'fit'"
);
assert.ok(
    !timelineInteractionJs.includes('const fitMode = fit ? fit.mode : "fill";'),
    "Inspector não deve exibir o antigo fallback 'fill'"
);
assert.ok(
    timelineInteractionJs.includes('const fitMode = fit ? fit.mode : "fit";'),
    "Inspector deve exibir fallback 'fit' para clipes sem bloco fit"
);
console.log("   ✔ Drop em ripple e Inspector alinhados ao novo padrão.");

// ─────────────────────────────────────────────────────────────────────
// 8. PARIDADE DO RENDERIZADOR PYTHON (EXPORTAÇÃO FFMPEG)
// ─────────────────────────────────────────────────────────────────────
console.log("8. Verificando paridade do renderizador Python com o player...");

assert.ok(
    grafoVideoPy.includes('modo_fit = str((bloco_fit or {}).get("mode") or "fit")'),
    "grafo_video.py deve assumir 'fit' quando o clipe não possui bloco fit"
);
assert.ok(
    !grafoVideoPy.includes('(bloco_fit or {}).get("mode") or "fill"'),
    "O antigo fallback 'fill' do renderizador não deve permanecer"
);
assert.ok(
    geometriaPy.includes('fit SEM bloco = "fit" (contain)'),
    "Docstring do geometria.py deve registrar a decisão do novo padrão"
);
console.log("   ✔ Renderizador Python em paridade com o player.");

// ─────────────────────────────────────────────────────────────────────
// 9. MATEMÁTICA DA CAIXA CONFORMADA EM % (CASOS NUMÉRICOS)
// ─────────────────────────────────────────────────────────────────────
console.log("9. Validando a matemática da conformação em % (espelho da fórmula do applyMediaEffects)...");

function conformarCaixa(mediaAspect, rotNorm, pW, pH, fitMode = "fit") {
    const effAspect = (rotNorm === 90 || rotNorm === 270) ? (1 / mediaAspect) : mediaAspect;
    let fracW = 1;
    let fracH = 1;
    if (fitMode !== "fill" && pW > 0 && pH > 0 && effAspect > 0) {
        const frameAspect = pW / pH;
        if (effAspect < frameAspect) {
            fracW = effAspect / frameAspect;
        } else {
            fracH = frameAspect / effAspect;
        }
    }
    const sideways = (rotNorm === 90 || rotNorm === 270);
    return {
        elWPct: ((sideways ? fracH * pH : fracW * pW) / pW) * 100,
        elHPct: ((sideways ? fracW * pW : fracH * pH) / pH) * 100,
        visualW: fracW * pW,
        visualH: fracH * pH
    };
}
const txPctPara = (elWPct, tx) => (elWPct > 0) ? (tx * 100 / elWPct) : 0;

// 9.1 Foto vertical (1080x1920) em quadro 16:9, sem rotação: pillarbox 31,64% x 100% (sem corte de teto/chão)
const vertical = conformarCaixa(1080 / 1920, 0, 1920, 1080);
assert.ok(Math.abs(vertical.elWPct - 31.640625) < 0.001, "Foto vertical deve ter largura de 31,64% do contêiner (pillarbox)");
assert.equal(Math.round(vertical.elHPct), 100, "Foto vertical deve ocupar a altura total");
assert.ok(vertical.elWPct < 100, "Nada de crop destrutivo: largura menor que o quadro");

// 9.2 Mídia horizontal perfeita (16:9): cobre o quadro inteiro (100% x 100%)
const exato = conformarCaixa(1920 / 1080, 0, 1920, 1080);
assert.equal(Math.round(exato.elWPct), 100);
assert.equal(Math.round(exato.elHPct), 100);

// 9.3 Foto vertical rotacionada 90° (vira horizontal): visual cobre o quadro; caixa pré-rotação transposta
const verticalRot = conformarCaixa(1080 / 1920, 90, 1920, 1080);
assert.ok(Math.abs(verticalRot.elWPct - 56.25) < 0.001, "Caixa pré-rotação: largura = 56,25% (altura do quadro)");
assert.ok(Math.abs(verticalRot.elHPct - 177.7778) < 0.01, "Caixa pré-rotação: altura ≈ 177,78% (largura do quadro)");
assert.equal(Math.round(verticalRot.visualW), 1920, "Rect visual pós-rotação deve cobrir a largura do quadro");
assert.equal(Math.round(verticalRot.visualH), 1080, "Rect visual pós-rotação deve cobrir a altura do quadro");

// 9.4 Vídeo horizontal rotacionado 90° (vira vertical): pillarbox estreito 56,25% x 56,25%
const horizRot = conformarCaixa(1920 / 1080, 90, 1920, 1080);
assert.ok(Math.abs(horizRot.elWPct - 56.25) < 0.001 && Math.abs(horizRot.elHPct - 56.25) < 0.001,
    "Caixa transposta do horizontal rotacionado deve ter 56,25% x 56,25%");
assert.ok(Math.round(horizRot.visualW) === 608 && Math.round(horizRot.visualH) === 1080,
    "Horizontal rotacionado deve virar faixa vertical de 608x1080");

// 9.5 Modo fill: caixa permanece o quadro inteiro (cover recorta para preencher)
const fill = conformarCaixa(1080 / 1920, 0, 1920, 1080, "fill");
assert.equal(Math.round(fill.elWPct), 100);
assert.equal(Math.round(fill.elHPct), 100);

// 9.6 Translação em % do próprio elemento mantém a equivalência de px do quadro
assert.ok(Math.abs(txPctPara(vertical.elWPct, 10) - 31.6037) < 0.01,
    "tx=10% do quadro deve virar ~31,60% da caixa vertical (mesmos px na tela)");
assert.equal(txPctPara(fill.elWPct, 10), 10, "No modo fill (100%), tx em % do quadro = tx em % do elemento");
console.log("   ✔ Matemática da conformação em % validada em 6 casos.");

// ─────────────────────────────────────────────────────────────────────
// 10. REGRESSÃO ZERO — ESTRUTURAS CRÍTICAS PRESERVADAS
// ─────────────────────────────────────────────────────────────────────
console.log("10. Regressão zero em estruturas críticas...");

assert.ok(
    timelineStateJs.includes("zoomToFit(viewportWidth)"),
    "zoomToFit deve continuar definido no TIMELINE_STATE"
);
assert.ok(
    playerJs.includes("applyPhotoSlot(imgEl, cut, currentFrame, zIndex)"),
    "applyPhotoSlot preservado"
);
assert.ok(
    playerJs.includes("attachOverlayDragListeners(overlay, activeClip.id)"),
    "Handlers do overlay preservados"
);
console.log("   ✔ Estruturas críticas intactas.");

console.log("\n=== AUTOTESTE CONCLUÍDO COM SUCESSO: 100% DE APROVAÇÃO ===");
