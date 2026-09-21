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
// 2. PLAYER.JS — CAIXA CONFORMADA + TRANSLAÇÃO EM % DO QUADRO
// ─────────────────────────────────────────────────────────────────────
console.log("2. Verificando caixa conformada e translação proporcional ao quadro...");

assert.ok(
    playerJs.includes("const effAspect = (rotNorm === 90 || rotNorm === 270) ? (1 / mediaAspect) : mediaAspect;"),
    "Aspecto efetivo deve inverter em rotações de 90/270"
);
assert.ok(
    playerJs.includes("if (effAspect < frameAspect) {"),
    "Cálculo da caixa conformada (contain) dentro do quadro deve existir"
);
assert.ok(
    count(playerJs, 'el.style.setProperty("left", "50%", "important");') >= 1,
    "Elemento da mídia deve ser ancorado no centro (left 50%)"
);
assert.ok(
    count(playerJs, "translate(${txPx}px, ${tyPx}px)") >= 2,
    "Translação em px proporcionais deve ser aplicada na mídia E espelhada no overlay"
);
assert.ok(
    !playerJs.includes("translate(${tx}%, ${ty}%) scale(${scale}) rotate(${rotation}deg)"),
    "A translação antiga em % do próprio elemento (imprecisa para caixas conformadas) não deve permanecer"
);
console.log("   ✔ Caixa conformada + translação x/y em % do quadro (px convertidos) OK.");

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
    playerJs.includes("boxW = pH * effAspect;") && playerJs.includes("boxH = pW / effAspect;"),
    "Overlay deve compartilhar as dimensões conformadas (boxW/boxH) com a mídia"
);
console.log("   ✔ Overlay conformado (alças contornam o retângulo visível).");

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
// 9. MATEMÁTICA DA CAIXA CONFORMADA (CASOS NUMÉRICOS)
// ─────────────────────────────────────────────────────────────────────
console.log("9. Validando a matemática da conformação (espelho da fórmula do applyMediaEffects)...");

function conformarCaixa(mediaAspect, rotNorm, pW, pH, fitMode = "fit") {
    const effAspect = (rotNorm === 90 || rotNorm === 270) ? (1 / mediaAspect) : mediaAspect;
    let renderedW = pW;
    let renderedH = pH;
    if (fitMode !== "fill" && pW > 0 && pH > 0 && effAspect > 0) {
        const frameAspect = pW / pH;
        if (effAspect < frameAspect) {
            renderedH = pH;
            renderedW = pH * effAspect;
        } else {
            renderedW = pW;
            renderedH = pW / effAspect;
        }
    }
    const swap = (rotNorm === 90 || rotNorm === 270);
    return {
        width: swap ? renderedH : renderedW,
        height: swap ? renderedW : renderedH,
        visualW: renderedW,
        visualH: renderedH
    };
}

// 9.1 Foto vertical (1080x1920) em quadro 16:9, sem rotação: pillarbox lateral, sem corte de teto/chão
const vertical = conformarCaixa(1080 / 1920, 0, 1920, 1080);
assert.equal(Math.round(vertical.height), 1080, "Foto vertical deve ocupar a altura total do quadro");
assert.equal(Math.round(vertical.width), 608, "Foto vertical deve ter largura proporcional (pillarbox)");
assert.ok(vertical.width < 1920, "Nada de crop destrutivo: largura menor que o quadro");

// 9.2 Mídia horizontal perfeita (16:9): cobre o quadro inteiro
const exato = conformarCaixa(1920 / 1080, 0, 1920, 1080);
assert.equal(Math.round(exato.width), 1920);
assert.equal(Math.round(exato.height), 1080);

// 9.3 Foto vertical rotacionada 90° (vira horizontal): aspect invertido cobre o quadro 16:9
const verticalRot = conformarCaixa(1080 / 1920, 90, 1920, 1080);
assert.equal(Math.round(verticalRot.width), 1080, "Caixa pré-rotação deve ter largura = altura do quadro");
assert.equal(Math.round(verticalRot.height), 1920, "Caixa pré-rotação deve ter altura = largura do quadro");
assert.equal(Math.round(verticalRot.visualW), 1920, "Rect visual pós-rotação deve cobrir a largura do quadro");
assert.equal(Math.round(verticalRot.visualH), 1080, "Rect visual pós-rotação deve cobrir a altura do quadro");

// 9.4 Vídeo horizontal rotacionado 90° (vira vertical): pillarbox estreito
const horizRot = conformarCaixa(1920 / 1080, 90, 1920, 1080);
assert.ok(Math.round(horizRot.visualW) === 608 && Math.round(horizRot.visualH) === 1080,
    "Horizontal rotacionado deve virar faixa vertical de 608x1080");

// 9.5 Modo fill: caixa permanece o quadro inteiro (cover recorta para preencher)
const fill = conformarCaixa(1080 / 1920, 0, 1920, 1080, "fill");
assert.equal(Math.round(fill.width), 1920);
assert.equal(Math.round(fill.height), 1080);
console.log("   ✔ Matemática da conformação validada em 5 casos.");

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
