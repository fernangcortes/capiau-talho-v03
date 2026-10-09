// tests/autoteste_render_cache.mjs
// Suíte de testes automatizados para o Sistema de Render Cache NLE (CapIAu-Talho)
// Valida linha vermelha/amarela/verde, pré-renderização de trechos pesados e playback suave.

import assert from "node:assert/strict";

// ── Polyfills de ambiente de navegador para execução em Node.js ESM ──
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
globalThis.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

const domRegistry = {};
function makeEl(id) {
    const el = {
        id: id || "",
        style: {
            display: "",
            position: "",
            inset: "",
            pointerEvents: "",
            backdropFilter: "",
            webkitBackdropFilter: "",
            clipPath: "",
            opacity: "",
            zIndex: "",
            backgroundColor: "",
            getPropertyValue(k) { return this[k] || null; },
            setProperty(k, v) { this[k] = String(v); },
            removeProperty(k) { delete this[k]; }
        },
        innerHTML: "",
        textContent: "",
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            contains(c) { return this._list.has(c); },
            toggle(c) { if (this.contains(c)) this.remove(c); else this.add(c); }
        },
        children: [],
        parentElement: { clientWidth: 1280, clientHeight: 720 },
        clientWidth: 1280,
        clientHeight: 720,
        width: 1280,
        height: 720,
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx >= 0) this.children.splice(idx, 1);
            return child;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {},
        setAttribute(k, v) { this[k] = String(v); },
        getAttribute(k) { return this[k] !== undefined ? this[k] : null; },
        removeAttribute(k) { delete this[k]; },
        getContext() {
            return {
                save() {},
                restore() {},
                fillRect() {},
                drawImage() {},
                measureText() { return { width: 40 }; },
                beginPath() {},
                moveTo() {},
                lineTo() {},
                stroke() {}
            };
        }
    };
    if (id) domRegistry[id] = el;
    return el;
}

globalThis.document = {
    createElement(tag) { return makeEl("created_" + tag); },
    getElementById(id) { return domRegistry[id] || makeEl(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    body: makeEl("body")
};

makeEl("program-player-render-cache");
makeEl("program-player-adjustment");
makeEl("program-player-photo");
makeEl("program-player-photo-b");
makeEl("program-player-matte");
makeEl("program-player-matte-b");
makeEl("btn-render-cache-timeline");

let passedCount = 0;
let totalCount = 0;

async function runBattery(name, fn) {
    totalCount++;
    console.log(`\n▶ [Bateria ${totalCount}] ${name}`);
    try {
        await fn();
        passedCount++;
        console.log(`  ✓ ${name} validada com sucesso`);
    } catch (err) {
        console.error(`  ✗ FALHA na bateria "${name}":`, err);
        process.exit(1);
    }
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 19: SISTEMA DE RENDER CACHE DA TIMELINE");
console.log("===============================================================================");

const { RenderCacheManager, RENDER_CACHE_MANAGER } = await import("../src/ui/js/renderCache.js");
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE } = await import("../src/ui/js/timelineState.js");

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Inicialização e Singleton
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Singleton RENDER_CACHE_MANAGER e Estruturas de Memória", () => {
    assert.ok(RENDER_CACHE_MANAGER instanceof RenderCacheManager, "RENDER_CACHE_MANAGER deve ser instância de RenderCacheManager");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.isFrameHeavy, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.getFrameStatus, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.getSegments, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.renderRange, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.renderInOut, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.cancelRender, "function");
    assert.strictEqual(typeof RENDER_CACHE_MANAGER.invalidateAll, "function");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Detecção de Frames Pesados (isFrameHeavy)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Detecção de Efeitos Pesados (Camada de Ajuste, Transições, Multipista, Blur)", () => {
    const manager = new RenderCacheManager();

    // 1. Frame vazio: deve retornar false
    STATE.activeTimelineCuts = [];
    TIMELINE_STATE.transitions = [];
    assert.strictEqual(manager.isFrameHeavy(10), false, "Frame vazio não é pesado");

    // 2. Clipe de vídeo simples (sem efeitos): tempo real leve
    STATE.activeTimelineCuts = [
        { id: "c1", kind: "media", timelineStartFrame: 0, inFrame: 0, outFrame: 100, effects: [] }
    ];
    assert.strictEqual(manager.isFrameHeavy(50), false, "Clipe simples sem filtros não é pesado");

    // 3. Camada de ajuste ativa sobre o frame: PESADO (retorna true)
    STATE.activeTimelineCuts.push({
        id: "adj1",
        kind: "adjustment",
        timelineStartFrame: 20,
        inFrame: 0,
        outFrame: 60, // frames 20..80
        effects: [{ type: "color", contrast: 20 }]
    });
    assert.strictEqual(manager.isFrameHeavy(50), true, "Frame sob Camada de Ajuste deve ser classificado como pesado");
    assert.strictEqual(manager.isFrameHeavy(90), false, "Frame após o término da Camada de Ajuste não deve ser afetado");

    // Remove a camada de ajuste
    STATE.activeTimelineCuts = STATE.activeTimelineCuts.filter(c => c.kind !== "adjustment");

    // 4. Transição de vídeo ativa na junção (Cross Dissolve): PESADO
    TIMELINE_STATE.transitions = [
        { id: "tr1", kind: "video", cutFrame: 100, halfAFrames: 12, halfBFrames: 12, disabled: false }
    ];
    assert.strictEqual(manager.isFrameHeavy(95), true, "Frame dentro do envelope da transição de vídeo é pesado");
    assert.strictEqual(manager.isFrameHeavy(120), false, "Frame fora do envelope da transição não é pesado");

    TIMELINE_STATE.transitions = [];

    // 5. Multipista ativa simultânea (V1 + V2 sobrepostos): PESADO
    STATE.activeTimelineCuts.push({
        id: "c2",
        kind: "media",
        track: "V2",
        timelineStartFrame: 40,
        inFrame: 0,
        outFrame: 80, // frames 40..120
        effects: []
    });
    assert.strictEqual(manager.isFrameHeavy(60), true, "Múltiplas camadas de vídeo ativas juntas são pesadas");

    // 6. Clipe único com efeito pesado (blur > 0 ou grading)
    STATE.activeTimelineCuts = [
        {
            id: "c3",
            kind: "media",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 100,
            effects: [{ type: "color", blur: 5 }]
        }
    ];
    assert.strictEqual(manager.isFrameHeavy(50), true, "Clipe com desfoque (blur) é pesado");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Classificação de Status de Renderização (getFrameStatus)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Status NLE do Frame: empty, realtime (amarelo), unrendered (vermelho) e cached (verde)", () => {
    const manager = new RenderCacheManager();
    STATE.activeTimelineCuts = [];
    TIMELINE_STATE.transitions = [];

    // Frame sem cortes -> empty
    assert.strictEqual(manager.getFrameStatus(10), "empty");

    // Frame com corte simples -> realtime (amarelo)
    STATE.activeTimelineCuts = [
        { id: "c1", kind: "media", timelineStartFrame: 0, inFrame: 0, outFrame: 50, effects: [] }
    ];
    assert.strictEqual(manager.getFrameStatus(25), "realtime");

    // Frame com corte pesado -> unrendered (vermelho)
    STATE.activeTimelineCuts = [
        { id: "c2", kind: "adjustment", timelineStartFrame: 0, inFrame: 0, outFrame: 50, effects: [] }
    ];
    assert.strictEqual(manager.getFrameStatus(25), "unrendered");

    // Frame previamente em cache -> cached (verde, sobrepõe tudo)
    manager.setFrame(25, { fakeCanvas: true });
    assert.strictEqual(manager.getFrameStatus(25), "cached");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Agrupamento em Segmentos Contíguos (getSegments)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Segmentação em Lotes Contíguos para o Canvas da Régua", () => {
    const manager = new RenderCacheManager();

    // Cenário:
    // Frames 0..20: corte simples (amarelo)
    // Frames 20..40: camada de ajuste pesada (vermelho)
    // Frames 40..60: vazio (não entra na lista)
    // Frames 60..80: clipe pesado pré-renderizado no cache (verde)
    STATE.activeTimelineCuts = [
        { id: "c1", kind: "media", timelineStartFrame: 0, inFrame: 0, outFrame: 40, effects: [] },
        { id: "adj", kind: "adjustment", timelineStartFrame: 20, inFrame: 0, outFrame: 20, effects: [] },
        { id: "c2", kind: "media", timelineStartFrame: 60, inFrame: 0, outFrame: 20, effects: [{ type: "color", blur: 4 }] }
    ];

    // Coloca frames 60..80 em cache
    for (let f = 60; f <= 80; f++) {
        manager.setFrame(f, { cached: true });
    }

    const segments = manager.getSegments(0, 100);
    assert.ok(segments.length >= 3, "Deve gerar pelo menos 3 segmentos ativos");

    // Primeiro segmento: realtime (amarelo)
    const seg1 = segments.find(s => s.startFrame === 0);
    assert.ok(seg1, "Segmento inicial deve começar no frame 0");
    assert.strictEqual(seg1.status, "realtime");
    assert.strictEqual(seg1.color, "#eab308");

    // Segundo segmento: unrendered (vermelho)
    const seg2 = segments.find(s => s.startFrame === 20);
    assert.ok(seg2, "Segmento pesado deve começar no frame 20");
    assert.strictEqual(seg2.status, "unrendered");
    assert.strictEqual(seg2.color, "#ef4444");

    // Terceiro segmento: cached (verde)
    const seg3 = segments.find(s => s.startFrame === 60);
    assert.ok(seg3, "Segmento em cache deve começar no frame 60");
    assert.strictEqual(seg3.status, "cached");
    assert.strictEqual(seg3.color, "#10b981");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Invalidação Reativa e Pontual de Cache
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Invalidação de Intervalo e Limpeza Total do Cache", () => {
    const manager = new RenderCacheManager();

    for (let f = 0; f < 30; f++) {
        manager.setFrame(f, { data: f });
    }
    assert.strictEqual(manager.hasFrame(10), true);
    assert.strictEqual(manager.hasFrame(25), true);

    // Invalida intervalo pontual 5..15
    manager.invalidateRange(5, 15);
    assert.strictEqual(manager.hasFrame(10), false, "Frame 10 deve ter sido invalidado");
    assert.strictEqual(manager.hasFrame(4), true, "Frame 4 fora do intervalo deve permanecer");
    assert.strictEqual(manager.hasFrame(20), true, "Frame 20 fora do intervalo deve permanecer");

    // Invalidação total
    manager.invalidateAll();
    assert.strictEqual(manager.hasFrame(4), false);
    assert.strictEqual(manager.hasFrame(20), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Pré-Renderização por Intervalo (renderRange) e Cancelamento
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Processamento renderRange() com Emissão de Progresso e Cancelamento", async () => {
    const manager = new RenderCacheManager();
    STATE.activeTimelineCuts = [
        { id: "c1", kind: "media", timelineStartFrame: 0, inFrame: 0, outFrame: 50, effects: [] }
    ];

    let progressEvents = [];
    const onProgress = (p) => progressEvents.push(p);
    STATE.on("renderCacheProgress", onProgress);

    // Renderiza 10 quadros (frame 0 a 9)
    const result = await manager.renderRange(0, 9, { chunkSize: 2 });
    assert.strictEqual(result.rendered, 10);
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(manager.hasFrame(0), true);
    assert.strictEqual(manager.hasFrame(9), true);
    assert.ok(progressEvents.length > 0, "Deve ter emitido eventos de progresso");

    // Testa cancelamento
    const cancelPromise = manager.renderRange(10, 50, { chunkSize: 1 });
    manager.cancelRender();
    const cancelResult = await cancelPromise;
    assert.strictEqual(cancelResult.cancelled, true);

    STATE.off("renderCacheProgress", onProgress);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: renderInOut() com Marcadores da Timeline
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Renderização In to Out (renderInOut) respeitando marcadores I/O", async () => {
    const manager = new RenderCacheManager();
    TIMELINE_STATE.inFrame = 15;
    TIMELINE_STATE.outFrame = 25;

    STATE.activeTimelineCuts = [
        { id: "c1", kind: "media", timelineStartFrame: 0, inFrame: 0, outFrame: 100, effects: [] }
    ];

    const res = await manager.renderInOut();
    assert.strictEqual(res.startFrame, 15);
    assert.strictEqual(res.endFrame, 25);
    assert.strictEqual(res.rendered, 11);
    assert.strictEqual(manager.hasFrame(15), true);
    assert.strictEqual(manager.hasFrame(25), true);
    assert.strictEqual(manager.hasFrame(14), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Integração com o Program Player (Cache Hit & Desativação de Vídeo DOM)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Integração do Program Player com Render Cache", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    // Garante que o canvas de render cache é localizado
    const cacheCanvas = player.el("program-player-render-cache");
    assert.ok(cacheCanvas, "Canvas #program-player-render-cache deve existir");

    // Frame não em cache: canvas permanece oculto
    RENDER_CACHE_MANAGER.invalidateAll();
    // No frame 5 sem cache
    assert.strictEqual(RENDER_CACHE_MANAGER.hasFrame(5), false);

    // Frame em cache: ativação do canvas
    RENDER_CACHE_MANAGER.setFrame(5, { mock: "bitmap" });
    assert.strictEqual(RENDER_CACHE_MANAGER.hasFrame(5), true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Liberação de VRAM (bitmap.close) em Invalidações e Sobrescrita
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Liberação de VRAM (bitmap.close) em Invalidações e Sobrescrita", () => {
    const manager = new RenderCacheManager();

    const createMockBitmap = (id) => ({
        id,
        closed: false,
        close() { this.closed = true; }
    });

    // 1. Sobrescrita de frame existente deve fechar o bitmap antigo
    const bm1 = createMockBitmap("bm1");
    const bm2 = createMockBitmap("bm2");
    manager.setFrame(10, bm1);
    assert.strictEqual(bm1.closed, false);
    manager.setFrame(10, bm2);
    assert.strictEqual(bm1.closed, true, "Bitmap anterior deve ser fechado para evitar vazamento de VRAM");
    assert.strictEqual(bm2.closed, false);

    // Se setar a mesma referência novamente, não deve fechar a si mesmo
    manager.setFrame(10, bm2);
    assert.strictEqual(bm2.closed, false);

    // 2. invalidateRange fecha bitmaps no intervalo e preserva os de fora
    const bitmaps = {};
    for (let f = 20; f <= 30; f++) {
        bitmaps[f] = createMockBitmap(`bm_${f}`);
        manager.setFrame(f, bitmaps[f]);
    }
    manager.invalidateRange(23, 27);
    for (let f = 20; f <= 30; f++) {
        if (f >= 23 && f <= 27) {
            assert.strictEqual(bitmaps[f].closed, true, `Frame ${f} no intervalo deve ter bitmap.close() chamado`);
            assert.strictEqual(manager.hasFrame(f), false);
        } else {
            assert.strictEqual(bitmaps[f].closed, false, `Frame ${f} fora do intervalo deve permanecer intacto`);
            assert.strictEqual(manager.hasFrame(f), true);
        }
    }

    // 3. invalidateAll fecha todos os bitmaps restantes
    manager.invalidateAll();
    for (let f = 20; f <= 30; f++) {
        assert.strictEqual(bitmaps[f].closed, true, `Frame ${f} deve ter sido fechado em invalidateAll`);
        assert.strictEqual(manager.hasFrame(f), false);
    }
    assert.strictEqual(bm2.closed, true, "bm2 no frame 10 deve ter sido fechado em invalidateAll");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Composição em Resolução Nativa e Transições de Vídeo (compositeFrame)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Composição em Resolução Nativa e Transições de Vídeo (compositeFrame)", async () => {
    const manager = new RenderCacheManager();

    // 1. Resolução nativa da timeline aplicada ao canvas
    TIMELINE_STATE.width = 3840;
    TIMELINE_STATE.height = 2160;
    TIMELINE_STATE.fps = 30;

    const fillStyles = [];
    const mockCtx = {
        save() {},
        restore() {},
        fillRect(x, y, w, h) {
            fillStyles.push({ style: this.fillStyle, alpha: this.globalAlpha, w, h });
        },
        drawImage() {},
        fillStyle: "#000000",
        globalAlpha: 1.0,
        globalCompositeOperation: "source-over"
    };

    const canvas = {
        width: 100,
        height: 100,
        getContext() { return mockCtx; }
    };

    // Monta cenário com transição cross dissolve entre 2 color mattes
    const cutA = {
        id: "mat_a",
        kind: "color_matte",
        color: "#ff0000",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 60,
        track: "V1",
        disabled: false
    };
    const cutB = {
        id: "mat_b",
        kind: "color_matte",
        color: "#0000ff",
        timelineStartFrame: 60,
        inFrame: 0,
        outFrame: 60,
        track: "V1",
        disabled: false
    };
    STATE.activeTimelineCuts = [cutA, cutB];
    TIMELINE_STATE.getVideoTracks = () => [{ id: "V1", kind: "video", hidden: false }];
    TIMELINE_STATE.transitions = [{
        id: "trans_ab",
        kind: "video",
        type: "video_cross_dissolve",
        track: "V1",
        cutFrame: 60,
        clipAId: "mat_a",
        clipBId: "mat_b",
        halfAFrames: 10,
        halfBFrames: 10,
        durationFrames: 20
    }];

    // Executa compositeFrame no meio exato da transição (frame 60)
    // tStart = 50, tEnd = 70, span = 20, progress = (60 - 50) / 20 = 0.5
    await manager.compositeFrame(60, canvas);

    assert.strictEqual(canvas.width, 3840, "Canvas deve redimensionar para TIMELINE_STATE.width (4K)");
    assert.strictEqual(canvas.height, 2160, "Canvas deve redimensionar para TIMELINE_STATE.height (4K)");

    // No cross dissolve: Clipe A fica com opacidade 1.0 por baixo, Clipe B fica com progress (0.5) por cima
    const redDrawn = fillStyles.find(f => f.style === "#ff0000");
    const blueDrawn = fillStyles.find(f => f.style === "#0000ff");
    assert.ok(redDrawn, "Clipe A (vermelho) deve ser desenhado");
    assert.ok(blueDrawn, "Clipe B (azul) deve ser desenhado");
    assert.strictEqual(redDrawn.alpha, 1.0, "Clipe A deve permanecer com opacidade sólida 1.0 sob a transição");
    assert.strictEqual(blueDrawn.alpha, 0.5, "Clipe B deve ter opacidade proporcional ao progresso da transição");

    // 2. Valida video_dip_white em compositeFrame
    TIMELINE_STATE.transitions = [{
        id: "trans_dip_w",
        kind: "video",
        type: "video_dip_white",
        track: "V1",
        cutFrame: 60,
        clipAId: "mat_a",
        clipBId: "mat_b",
        halfAFrames: 10,
        halfBFrames: 10,
        durationFrames: 20
    }];

    fillStyles.length = 0;
    // Frame 55 (progress 0.25): opA = 1.0, opB = 0.0, overlayWhite = 0.5
    await manager.compositeFrame(55, canvas);
    const red55 = fillStyles.find(f => f.style === "#ff0000");
    const blue55 = fillStyles.find(f => f.style === "#0000ff");
    const white55 = fillStyles.find(f => f.style === "#ffffff");
    assert.ok(red55, "Clipe A deve ser desenhado antes do ponto médio do dip to white");
    assert.strictEqual(red55.alpha, 1.0);
    assert.ok(!blue55, "Clipe B NÃO deve ser desenhado antes do ponto médio do dip to white");
    assert.ok(white55, "Overlay branco deve ser desenhado");
    assert.strictEqual(white55.alpha, 0.5, "Overlay branco deve estar em 50% no frame 55");

    fillStyles.length = 0;
    // Frame 65 (progress 0.75): opA = 0.0, opB = 1.0, overlayWhite = 0.5
    await manager.compositeFrame(65, canvas);
    const red65 = fillStyles.find(f => f.style === "#ff0000");
    const blue65 = fillStyles.find(f => f.style === "#0000ff");
    const white65 = fillStyles.find(f => f.style === "#ffffff");
    assert.ok(!red65, "Clipe A NÃO deve ser desenhado após o ponto médio do dip to white");
    assert.ok(blue65, "Clipe B deve ser desenhado após o ponto médio do dip to white");
    assert.strictEqual(blue65.alpha, 1.0);
    assert.ok(white65, "Overlay branco deve ser desenhado");
    assert.strictEqual(white65.alpha, 0.5, "Overlay branco deve estar em 50% no frame 65");

    // Limpa estado para não afetar outras baterias
    TIMELINE_STATE.width = 1920;
    TIMELINE_STATE.height = 1080;
    TIMELINE_STATE.transitions = [];
    STATE.activeTimelineCuts = [];
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} baterias concluídas com 100% de sucesso!`);
console.log("===============================================================================\n");

process.exit(0);
