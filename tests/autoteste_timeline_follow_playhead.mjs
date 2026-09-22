// Autoteste do Recurso: Timeline Segue a Agulha (Playback Auto-Scroll)
// Execução: node tests/autoteste_timeline_follow_playhead.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("▶ Iniciando autoteste do recurso 'Timeline Segue a Agulha' (Playback Auto-Scroll)...");

// ── 1. Validação Estrutural do index.html ──
console.log("\n1. Validando elementos de UI em index.html...");
const htmlContent = readFileSync(path.join(raiz, "src", "ui", "index.html"), "utf8");

// 1.1 Botão de ação rápida na Toolbar da Timeline
assert.ok(
    htmlContent.includes('id="btn-timeline-follow-playhead"'),
    "O botão #btn-timeline-follow-playhead deve existir na toolbar da timeline"
);
console.log("  ✔ #btn-timeline-follow-playhead presente na barra de ferramentas.");

// 1.2 Controles no Popover de Opções de Visualização
const expectedViewControls = [
    'id="chk-timeline-follow-playhead"',
    'id="select-timeline-scroll-mode"',
    'id="slider-timeline-smooth-anchor"',
    'id="label-smooth-anchor-pct"'
];

for (const ctrl of expectedViewControls) {
    assert.ok(htmlContent.includes(ctrl), `Controle ${ctrl} deve existir no popover de opções`);
}
console.log("  ✔ Controles de checkbox, select de modo e slider de âncora presentes no popover.");

// ── 2. Validação do Mapeamento de Teclado (keymapService.js) ──
console.log("\n2. Validando keymapService.js...");
const keymapContent = readFileSync(path.join(raiz, "src", "ui", "js", "keymapService.js"), "utf8");

assert.ok(
    keymapContent.includes('"timeline.toggle_follow_playhead"'),
    "O comando timeline.toggle_follow_playhead deve estar registrado em keymapService.js"
);
assert.ok(
    keymapContent.includes('Ctrl+Alt+KeyF'),
    "O atalho Ctrl+Alt+KeyF deve estar associado a timeline.toggle_follow_playhead"
);
console.log("  ✔ Comando 'timeline.toggle_follow_playhead' e atalho Ctrl+Alt+KeyF validados.");

// ── 3. Validação do Loop de Reprodução em player.js ──
console.log("\n3. Validando integração do loop de playback em player.js...");
const playerContent = readFileSync(path.join(raiz, "src", "ui", "js", "player.js"), "utf8");

assert.ok(
    playerContent.includes("TIMELINE_STATE.checkFollowPlayhead(true)") || playerContent.includes("TIMELINE_STATE?.checkFollowPlayhead(true)"),
    "player.js deve chamar TIMELINE_STATE.checkFollowPlayhead(true) durante a reprodução"
);
console.log("  ✔ Chamada a checkFollowPlayhead(true) no step() do reprodutor validada.");

// ── 4. Validação da Lógica e Matemática de Auto-Scroll (TimelineState Mock) ──
console.log("\n4. Validando lógica matemática de rolagem (Page Scroll & Smooth Scroll)...");

// Simulando classe de estado para teste isolado
class MockTimelineState {
    constructor() {
        this.zoom = 1.0; // 1 pixel por frame
        this.scrollLeftFrame = 0;
        this.playheadFrame = 0;
        this.totalDuration = 5000;
        this.viewportWidth = 1000; // 1000 frames visíveis na tela

        this.followPlayhead = true;
        this.followPlayheadMode = "page";
        this.smoothScrollAnchor = 0.5;
        this.emittedEvents = [];
    }

    getViewportWidth() {
        return this.viewportWidth;
    }

    getDurationFrames() {
        return this.totalDuration;
    }

    setScrollLeftFrame(val) {
        this.scrollLeftFrame = Math.max(0, val);
        this.emittedEvents.push({ event: "timelineScrollChanged", val: this.scrollLeftFrame });
    }

    setPlayheadFrame(val) {
        this.playheadFrame = Math.max(0, val);
        this.emittedEvents.push({ event: "timelinePlayheadChanged", val: this.playheadFrame });
    }

    toggleFollowPlayhead(enabled) {
        this.followPlayhead = (enabled !== undefined) ? !!enabled : !this.followPlayhead;
        return this.followPlayhead;
    }

    setFollowPlayheadMode(mode) {
        if (["page", "smooth"].includes(mode)) this.followPlayheadMode = mode;
    }

    setSmoothScrollAnchor(fraction) {
        const num = parseFloat(fraction);
        if (Number.isFinite(num)) {
            this.smoothScrollAnchor = Math.max(0.3, Math.min(0.7, num));
        }
    }

    checkFollowPlayhead(isPlayback = false) {
        if (!this.followPlayhead) return false;

        const vw = this.getViewportWidth();
        const zoom = Math.max(0.0001, this.zoom || 0.5);
        const visibleFrames = vw / zoom;
        const scrollLeft = this.scrollLeftFrame;
        const playhead = this.playheadFrame;
        const totalDuration = this.getDurationFrames();

        if (totalDuration <= visibleFrames && scrollLeft === 0 && playhead <= visibleFrames) {
            return false;
        }

        if (this.followPlayheadMode === "page") {
            const rightEdge = scrollLeft + visibleFrames;
            if (playhead >= rightEdge) {
                const leadIn = Math.max(0, Math.round(visibleFrames * 0.05));
                const newScroll = Math.max(0, Math.round(playhead - leadIn));
                this.setScrollLeftFrame(newScroll);
                return true;
            }
            if (playhead < scrollLeft) {
                const newScroll = Math.max(0, Math.round(playhead - visibleFrames * 0.95));
                this.setScrollLeftFrame(newScroll);
                return true;
            }
        } else if (this.followPlayheadMode === "smooth") {
            const anchor = Math.max(0.3, Math.min(0.7, this.smoothScrollAnchor || 0.5));
            const anchorFrames = visibleFrames * anchor;
            const targetScroll = Math.max(0, playhead - anchorFrames);

            if (playhead < anchorFrames && scrollLeft === 0) {
                return false;
            }

            const diff = targetScroll - scrollLeft;
            if (Math.abs(diff) > 0.01) {
                const easeFactor = isPlayback ? 0.20 : 0.40;
                const nextScroll = scrollLeft + (diff * easeFactor);
                this.setScrollLeftFrame(nextScroll);
                return true;
            }
        }

        return false;
    }

    previewSmoothScrollAnchor(fraction) {
        this.setSmoothScrollAnchor(fraction);
        const vw = this.getViewportWidth();
        const zoom = Math.max(0.0001, this.zoom || 0.5);
        const visibleFrames = vw / zoom;
        const scrollLeft = this.scrollLeftFrame;
        const targetFrame = Math.max(0, Math.round(scrollLeft + (visibleFrames * this.smoothScrollAnchor)));
        this.setPlayheadFrame(targetFrame);
    }
}

const ts = new MockTimelineState();

// 4.1 Validação do Estado Padrão
assert.equal(ts.followPlayhead, true, "Por padrão followPlayhead deve ser true");
assert.equal(ts.followPlayheadMode, "page", "Por padrão followPlayheadMode deve ser 'page'");
assert.equal(ts.smoothScrollAnchor, 0.5, "Por padrão smoothScrollAnchor deve ser 0.5 (50%)");
console.log("  ✔ 4.1 Estado inicial padrão aprovado.");

// 4.2 Teste Page Scroll: Playhead dentro da tela
ts.setPlayheadFrame(600);
const r1 = ts.checkFollowPlayhead(true);
assert.equal(r1, false, "Playhead dentro da tela (frame 600 em janela 0-1000) não deve disparar scroll");
assert.equal(ts.scrollLeftFrame, 0, "scrollLeftFrame deve permanecer 0");
console.log("  ✔ 4.2 Page Scroll: Agulha dentro da tela não altera o scroll.");

// 4.3 Teste Page Scroll: Playhead ultrapassando a margem direita
ts.setPlayheadFrame(1050); // Passou de 1000
const r2 = ts.checkFollowPlayhead(true);
assert.equal(r2, true, "Playhead no frame 1050 deve acionar a rolagem de página");
// leadIn = 1000 * 0.05 = 50 -> newScroll = 1050 - 50 = 1000
assert.equal(ts.scrollLeftFrame, 1000, "Nova página deve posicionar scrollLeftFrame em 1000 (com 50 frames de margem de contexto)");
console.log("  ✔ 4.3 Page Scroll: Avanço de página com margem visual de 5% validado.");

// 4.4 Teste Page Scroll: Retrocesso (Playback Reverso / J)
ts.setPlayheadFrame(950); // Voltou antes de scrollLeftFrame (1000)
const r3 = ts.checkFollowPlayhead(true);
assert.equal(r3, true, "Retrocesso antes da margem esquerda deve acionar recuo de página");
// 950 - 1000 * 0.95 = 950 - 950 = 0
assert.equal(ts.scrollLeftFrame, 0, "Recuo deve reposicionar scrollLeftFrame em 0");
console.log("  ✔ 4.4 Page Scroll: Recuo reverso de página aprovado.");

// 4.5 Teste Smooth Scroll com Ease e Âncora em 50%
ts.setFollowPlayheadMode("smooth");
ts.setScrollLeftFrame(0);
ts.setPlayheadFrame(400); // Antes da âncora (500 frames)
const r4 = ts.checkFollowPlayhead(true);
assert.equal(r4, false, "Playhead antes da âncora (frame 400 < 500) não deve iniciar rolagem");

ts.setPlayheadFrame(700); // 200 frames além da âncora (targetScroll = 700 - 500 = 200)
const r5 = ts.checkFollowPlayhead(true);
assert.equal(r5, true, "Playhead além da âncora deve iniciar rolagem suave");
assert.ok(ts.scrollLeftFrame > 0 && ts.scrollLeftFrame < 200, "Scroll suave deve interpolar com ease (lerp progressivo)");
console.log(`  ✔ 4.5 Smooth Scroll: Interpolação suave com ease iniciada (scrollLeftFrame = ${ts.scrollLeftFrame.toFixed(2)}).`);

// Itera múltiplos ticks até convergência
for (let i = 0; i < 30; i++) {
    ts.checkFollowPlayhead(true);
}
assert.ok(Math.abs(ts.scrollLeftFrame - 200) < 1, "Após múltiplos frames, scroll deve convergir perfeitamente para targetScroll (200)");
console.log("  ✔ 4.5 Smooth Scroll: Convergência suave para a âncora central validada.");

// 4.6 Teste de Âncora Configurável (30% a 70%) e Clamping
ts.setSmoothScrollAnchor(0.3); // 30%
assert.equal(ts.smoothScrollAnchor, 0.3, "Âncora deve aceitar 30%");
ts.setSmoothScrollAnchor(0.1); // Abaixo do mínimo
assert.equal(ts.smoothScrollAnchor, 0.3, "Âncora < 0.3 deve ser limitada (clamped) a 0.3");
ts.setSmoothScrollAnchor(0.9); // Acima do máximo
assert.equal(ts.smoothScrollAnchor, 0.7, "Âncora > 0.7 deve ser limitada (clamped) a 0.7");
console.log("  ✔ 4.6 Clamping do intervalo de âncora (30% a 70%) validado.");

// 4.7 Teste do Slider com Preview Instantâneo da Agulha
ts.setScrollLeftFrame(100);
ts.previewSmoothScrollAnchor(0.4); // 40%
// targetFrame = 100 + (1000 * 0.4) = 500
assert.equal(ts.playheadFrame, 500, "Preview instantâneo deve posicionar playheadFrame em 500 na viewport atual");
console.log("  ✔ 4.7 Preview instantâneo do slider de âncora reposiciona a agulha na hora.");

// 4.8 Teste com Recurso Desativado (followPlayhead = false)
ts.toggleFollowPlayhead(false);
assert.equal(ts.followPlayhead, false, "followPlayhead deve estar desativado");
ts.setScrollLeftFrame(0);
ts.setPlayheadFrame(3000); // Muito além da tela
const r6 = ts.checkFollowPlayhead(true);
assert.equal(r6, false, "Com followPlayhead = false, nenhum scroll deve ser acionado");
assert.equal(ts.scrollLeftFrame, 0, "scrollLeftFrame deve permanecer inalterado quando desativado");
console.log("  ✔ 4.8 Desativação de acompanhamento validada (agulha corre livremente sem rolar).");

console.log("\n============================================================");
console.log("🎉 TODOS OS TESTES DE 'TIMELINE SEGUE A AGULHA' APROVADOS!");
console.log("============================================================\n");
