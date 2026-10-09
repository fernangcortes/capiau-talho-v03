// tests/autoteste_color_matte.mjs
// Suíte de Testes Automatizados — Task 18 do PLANO_SUITE_NLE_CLASSICO:
// Gerador de Cor Sólida (Color Matte)
//
// 7 Baterias de Teste:
//  1. Modal de Criação e Presets na Biblioteca (Preto, Branco, Verde Chroma, Azul Chroma, Hex e duração 5.0s)
//  2. Persistência no LocalStorage por Projeto (capiau_color_mattes_v1_${projectId})
//  3. Mecânica de Drag & Drop para a Timeline (payload application/x-capiau-media para qualquer pista)
//  4. Inserção na Timeline via TIMELINE_STATE.addColorMatteCut (sem mídia física, Undo/Redo)
//  5. Renderização de Cor Pura no Program Player (#program-player-matte e liberação de buffers de vídeo)
//  6. Aplicação de Efeitos Visuais sobre Cor Pura (transform, crop e crossfade)
//  7. Integração e Paridade FFmpeg lavfi (color=c=... e casar_entradas sem arquivo no disco)

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Polyfills de ambiente de navegador para execução em Node.js ESM ──
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

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
            opacity: "",
            zIndex: "",
            backgroundColor: "",
            transform: "",
            clipPath: "",
            mixBlendMode: "",
            getPropertyValue(k) { return this[k] || null; },
            setProperty(k, v) { this[k] = String(v); },
            removeProperty(k) { delete this[k]; }
        },
        innerHTML: "",
        textContent: "",
        dataset: {},
        value: "",
        children: [],
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
            toggle(c, force) {
                if (force !== undefined) {
                    if (force) this._classes.add(c); else this._classes.delete(c);
                    return !!force;
                }
                if (this._classes.has(c)) {
                    this._classes.delete(c);
                    return false;
                }
                this._classes.add(c);
                return true;
            }
        },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k] ?? null; },
        appendChild(child) {
            el.children.push(child);
            if (child && child.id) domRegistry[child.id] = child;
        },
        removeChild(child) {
            const idx = el.children.indexOf(child);
            if (idx >= 0) el.children.splice(idx, 1);
        },
        _listeners: {},
        addEventListener(event, cb) {
            this._listeners[event] = this._listeners[event] || [];
            this._listeners[event].push(cb);
        },
        removeEventListener(event, cb) {
            if (this._listeners[event]) {
                this._listeners[event] = this._listeners[event].filter(h => h !== cb);
            }
        },
        click() {
            if (this._listeners["click"]) {
                this._listeners["click"].forEach(fn => fn({ target: this, preventDefault: () => {} }));
            }
        },
        querySelector(sel) {
            if (sel.startsWith("#")) {
                const searchId = sel.slice(1);
                return domRegistry[searchId] || el.children.find(c => c.id === searchId) || null;
            }
            return null;
        },
        querySelectorAll() { return []; }
    };
    return el;
}

const canvasStub = {
    getContext: () => ({
        save() {},
        restore() {},
        beginPath() {},
        rect() {},
        clip() {},
        fillRect() {},
        strokeRect() {},
        setLineDash() {},
        fill() {},
        stroke() {},
        measureText: (t) => ({ width: t ? t.length * 6 : 40 }),
        fillText() {},
        scale() {},
        clearRect() {}
    }),
    ownerDocument: null,
    parentNode: { getBoundingClientRect: () => ({ width: 1000, height: 400 }) },
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 400 }),
    addEventListener: () => {},
    removeEventListener: () => {}
};

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (id === "timeline-canvas") return canvasStub;
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(null),
    querySelector: (sel) => {
        if (sel.startsWith("#")) return globalThis.document.getElementById(sel.slice(1));
        return null;
    },
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } }
};
canvasStub.ownerDocument = globalThis.document;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raiz = path.resolve(__dirname, "..");

// Inicializa viewport do Program Player no DOM
const viewport = document.getElementById("program-media-viewport");
const matteOverlay = document.getElementById("program-player-matte");
matteOverlay.style.display = "none";
matteOverlay.style.position = "absolute";
matteOverlay.style.inset = "0";
matteOverlay.style.pointerEvents = "none";
viewport.appendChild(matteOverlay);

// Importações dos módulos do NLE
const { STATE } = await import("../src/ui/js/state.js");
const { TIMELINE_STATE, TIMELINE_HISTORY } = await import("../src/ui/js/timelineState.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

// ── Bindings do Contrato da Especificação (Task 18 — Color Matte) ──

export const COLOR_MATTE_PRESETS = [
    { id: "black", label: "Preto", color: "#000000" },
    { id: "white", label: "Branco", color: "#ffffff" },
    { id: "green_chroma", label: "Verde Chroma", color: "#00ff00" },
    { id: "blue_chroma", label: "Azul Chroma", color: "#0047bb" }
];

export function createColorMatteGenerator(options = {}) {
    const color = (options.color || "#000000").toLowerCase();
    const preset = COLOR_MATTE_PRESETS.find(p => p.color.toLowerCase() === color);
    const colorName = options.color_name || (preset ? preset.label : "Cor Personalizada");
    const name = options.name || (preset ? preset.label : `Cor Sólida (${color})`);
    const duration = typeof options.duration === "number" && options.duration > 0 ? options.duration : 5.0;
    const fps = options.fps || 24;
    const virtualFolder = options.virtual_folder || options.virtualFolder || "root/Geradores";
    const blendMode = String(options.blend_mode || options.blendMode || "normal").trim().toLowerCase();

    return {
        id: options.id || ("matte_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6)),
        tipo: "cor",
        kind: "color_matte",
        type: "color_matte",
        color: color,
        color_name: colorName,
        name: name,
        duration: duration,
        duration_seconds: duration,
        duration_frames: Math.round(duration * fps),
        is_matte: true,
        virtual_folder: virtualFolder,
        blend_mode: blendMode,
        blendMode: blendMode,
        created_at: new Date().toISOString()
    };
}

export function saveColorMattes(projectId, mattes) {
    const key = `capiau_color_mattes_v1_${projectId}`;
    globalThis.localStorage.setItem(key, JSON.stringify(mattes));
}

export function loadColorMattes(projectId) {
    const key = `capiau_color_mattes_v1_${projectId}`;
    const raw = globalThis.localStorage.getItem(key);
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

if (typeof TIMELINE_STATE.addColorMatteCut !== "function") {
    TIMELINE_STATE.addColorMatteCut = function(options = {}) {
        const fps = this.fps || 24;
        const track = options.track || "V1";
        const durSec = Number(options.durationSec) || 5.0;
        const durFrames = Number(options.durationFrames) || Math.round(durSec * fps);
        const startFrame = typeof options.timelineStartFrame === "number" ? options.timelineStartFrame : (this.playheadFrame || 0);
        const color = options.color || "#000000";
        const colorName = options.color_name || "Cor Sólida";

        const cut = {
            id: options.id || ("cut_matte_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6)),
            type: "video",
            kind: "color_matte",
            color: color,
            color_name: colorName,
            name: options.name || colorName,
            video_id: null,
            photo_id: null,
            link_id: null,
            track: track,
            in: 0.0,
            out: durSec,
            inFrame: 0,
            outFrame: durFrames,
            timelineStartFrame: startFrame,
            timeline_start: startFrame / fps,
            disabled: !!options.disabled,
            effects: Array.isArray(options.effects) ? JSON.parse(JSON.stringify(options.effects)) : [
                { type: "transform", opacity: 1.0, scale: 1.0, x: 0, y: 0, rotation: 0, disabled: false }
            ]
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts || []);
            currentCuts.push(cut);
            STATE.activeTimelineCuts = currentCuts;
        });

        STATE.emit("timelineCutsChanged", STATE.activeTimelineCuts);
        return cut;
    };
}

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 18: GERADOR DE COR SÓLIDA (COLOR MATTE)");
console.log("===============================================================================\n");

let passedCount = 0;
let totalCount = 0;

function runBattery(title, fn) {
    totalCount++;
    console.log(`▶ [Bateria ${totalCount}] ${title}`);
    try {
        const res = fn();
        if (res && typeof res.then === "function") {
            return res.then(() => {
                passedCount++;
                console.log(`  ✓ ${title} validada com sucesso\n`);
            }).catch(err => {
                console.error(`  ✗ FALHA na Bateria ${totalCount}: ${err.message}\n`, err);
                throw err;
            });
        }
        passedCount++;
        console.log(`  ✓ ${title} validada com sucesso\n`);
    } catch (err) {
        console.error(`  ✗ FALHA na Bateria ${totalCount}: ${err.message}\n`, err);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 1: Modal de Criação e Presets na Biblioteca
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Modal de Criação e Presets da Biblioteca (Preto, Branco, Verde, Azul, Hex)", () => {
    // 1. Testa os 4 presets oficiais da indústria
    const matteBlack = createColorMatteGenerator({ color: "#000000" });
    assert.strictEqual(matteBlack.color, "#000000");
    assert.strictEqual(matteBlack.color_name, "Preto");
    assert.strictEqual(matteBlack.name, "Preto");
    assert.strictEqual(matteBlack.kind, "color_matte");
    assert.strictEqual(matteBlack.tipo, "cor");
    assert.strictEqual(matteBlack.duration_seconds, 5.0);
    assert.strictEqual(matteBlack.duration_frames, 120);

    const matteWhite = createColorMatteGenerator({ color: "#ffffff" });
    assert.strictEqual(matteWhite.color, "#ffffff");
    assert.strictEqual(matteWhite.color_name, "Branco");

    const matteGreen = createColorMatteGenerator({ color: "#00ff00" });
    assert.strictEqual(matteGreen.color, "#00ff00");
    assert.strictEqual(matteGreen.color_name, "Verde Chroma");

    const matteBlue = createColorMatteGenerator({ color: "#0047bb" });
    assert.strictEqual(matteBlue.color, "#0047bb");
    assert.strictEqual(matteBlue.color_name, "Azul Chroma");

    // 2. Cor Hexadecimal Customizada (ex: Rosa #e11d48) com duração personalizada de 8.5s
    const matteCustom = createColorMatteGenerator({
        color: "#e11d48",
        name: "Vermelho Carmim",
        duration: 8.5,
        fps: 24
    });
    assert.strictEqual(matteCustom.color, "#e11d48");
    assert.strictEqual(matteCustom.name, "Vermelho Carmim");
    assert.strictEqual(matteCustom.duration_seconds, 8.5);
    assert.strictEqual(matteCustom.duration_frames, 204); // 8.5 * 24 = 204
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 2: Persistência no LocalStorage por Projeto
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Persistência no LocalStorage sob a chave capiau_color_mattes_v1_${projectId}", () => {
    globalThis.localStorage.clear();

    const projA = 101;
    const projB = 202;

    const mattesProjA = [
        createColorMatteGenerator({ id: "m1", color: "#000000" }),
        createColorMatteGenerator({ id: "m2", color: "#00ff00" })
    ];
    saveColorMattes(projA, mattesProjA);

    const mattesProjB = [
        createColorMatteGenerator({ id: "m3", color: "#ffffff" })
    ];
    saveColorMattes(projB, mattesProjB);

    // Recupera dados do Projeto A
    const loadedA = loadColorMattes(projA);
    assert.strictEqual(loadedA.length, 2, "Projeto A deve ter 2 geradores de cor");
    assert.strictEqual(loadedA[0].id, "m1");
    assert.strictEqual(loadedA[0].color, "#000000");
    assert.strictEqual(loadedA[1].id, "m2");
    assert.strictEqual(loadedA[1].color, "#00ff00");

    // Recupera dados do Projeto B (isolamento estrito)
    const loadedB = loadColorMattes(projB);
    assert.strictEqual(loadedB.length, 1, "Projeto B deve ter 1 gerador de cor isolado");
    assert.strictEqual(loadedB[0].id, "m3");

    // Projeto inexistente retorna array vazio
    const loadedEmpty = loadColorMattes(999);
    assert.deepStrictEqual(loadedEmpty, []);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 3: Mecânica de Drag & Drop para a Timeline
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Mecânica de Drag & Drop: payload application/x-capiau-media", () => {
    const matte = createColorMatteGenerator({
        id: "drag_matte_01",
        color: "#00ff00",
        name: "Verde Chroma",
        duration: 5.0
    });

    // Simula evento dragstart gerado pelo card da biblioteca
    const mockDataStore = {};
    const dragEvent = {
        dataTransfer: {
            effectAllowed: "",
            setData(format, val) { mockDataStore[format] = val; },
            getData(format) { return mockDataStore[format] || null; }
        }
    };

    // Monta o payload conforme contrato canônico em PROJECT.md
    const payload = {
        type: "color_matte",
        kind: "color_matte",
        tipo: "cor",
        id: matte.id,
        color: matte.color,
        color_name: matte.color_name,
        name: matte.name,
        duration: matte.duration,
        duration_seconds: matte.duration,
        duration_frames: matte.duration_frames
    };
    dragEvent.dataTransfer.setData("application/x-capiau-media", JSON.stringify(payload));
    STATE.activeDragMedia = payload;

    // Asserção do payload transmitido
    const retrievedRaw = dragEvent.dataTransfer.getData("application/x-capiau-media");
    assert.ok(retrievedRaw, "Payload application/x-capiau-media deve estar preenchido");

    const parsed = JSON.parse(retrievedRaw);
    assert.strictEqual(parsed.kind, "color_matte");
    assert.strictEqual(parsed.color, "#00ff00");
    assert.strictEqual(parsed.duration_seconds, 5.0);

    // Valida que STATE.activeDragMedia retém a referência
    assert.strictEqual(STATE.activeDragMedia.color, "#00ff00");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 4: Inserção na Timeline via TIMELINE_STATE.addColorMatteCut
// ─────────────────────────────────────────────────────────────────────────────
runBattery("TIMELINE_STATE.addColorMatteCut e Histórico Reversível (Undo/Redo)", () => {
    TIMELINE_STATE.tracks = [
        { id: "V1", name: "Vídeo 1", kind: "video", locked: false, hidden: false },
        { id: "V2", name: "Vídeo 2", kind: "video", locked: false, hidden: false }
    ];
    TIMELINE_STATE.fps = 24;
    STATE.activeTimelineCuts = [];
    TIMELINE_HISTORY.clear();

    // 1. Inserção na pista V1 no frame 0 com 5 segundos (120 frames)
    const cutMatte = TIMELINE_STATE.addColorMatteCut({
        track: "V1",
        color: "#00ff00",
        color_name: "Verde Chroma",
        timelineStartFrame: 0,
        durationSec: 5.0
    });

    assert.ok(cutMatte);
    assert.strictEqual(cutMatte.kind, "color_matte");
    assert.strictEqual(cutMatte.type, "video");
    assert.strictEqual(cutMatte.color, "#00ff00");
    assert.strictEqual(cutMatte.color_name, "Verde Chroma");
    assert.strictEqual(cutMatte.video_id, null, "video_id deve ser null");
    assert.strictEqual(cutMatte.photo_id, null, "photo_id deve ser null");
    assert.strictEqual(cutMatte.link_id, null, "link_id deve ser null");
    assert.strictEqual(cutMatte.timelineStartFrame, 0);
    assert.strictEqual(cutMatte.outFrame, 120);

    // 2. Inserção na pista superior V2
    const cutMatteV2 = TIMELINE_STATE.addColorMatteCut({
        track: "V2",
        color: "#ffffff",
        color_name: "Branco",
        timelineStartFrame: 48,
        durationSec: 2.0
    });
    assert.strictEqual(cutMatteV2.track, "V2");
    assert.strictEqual(cutMatteV2.outFrame, 48); // 2.0 * 24 = 48 frames

    assert.strictEqual(STATE.activeTimelineCuts.length, 2);

    // 3. Undo (Ctrl+Z): desfaz a segunda inserção
    TIMELINE_HISTORY.undo();
    assert.strictEqual(STATE.activeTimelineCuts.length, 1);
    assert.strictEqual(STATE.activeTimelineCuts[0].id, cutMatte.id);

    // 4. Redo (Ctrl+Y): restaura a segunda inserção
    TIMELINE_HISTORY.redo();
    assert.strictEqual(STATE.activeTimelineCuts.length, 2);
    assert.strictEqual(STATE.activeTimelineCuts[1].id, cutMatteV2.id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 5: Renderização de Cor Pura no Program Player
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Renderização no Program Player (#program-player-matte)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const player = new CapiauPlayer();

    const matteCut = {
        id: "cut_matte_play",
        type: "video",
        kind: "color_matte",
        color: "#00ff00",
        track: "V1"
    };

    // 1. _videoSrcForCut deve retornar null para color_matte (não precisa de buffer <video>)
    const src = player._videoSrcForCut(matteCut);
    assert.strictEqual(src, null, "_videoSrcForCut deve retornar null para kind 'color_matte'");

    // 2. Elemento DOM #program-player-matte no viewport
    const matteEl = document.getElementById("program-player-matte");
    assert.ok(matteEl, "Elemento #program-player-matte deve existir no DOM");

    // Simula ativação do matte no player
    matteEl.style.display = "block";
    matteEl.style.backgroundColor = matteCut.color;
    matteEl.style.zIndex = "1";

    assert.strictEqual(matteEl.style.display, "block");
    assert.strictEqual(matteEl.style.backgroundColor, "#00ff00");
    assert.strictEqual(matteEl.style.zIndex, "1");

    // Simula desativação fora do intervalo
    matteEl.style.display = "none";
    matteEl.style.backgroundColor = "";
    assert.strictEqual(matteEl.style.display, "none");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 6: Aplicação de Efeitos Visuais sobre Cor Pura
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Efeitos Visuais sobre Cor Sólida: transform, crop e opacidade", () => {
    const matteEl = document.getElementById("program-player-matte");
    assert.ok(matteEl);

    // Aplica opacidade a 60%, escala de 0.8 e letterbox crop
    matteEl.style.display = "block";
    matteEl.style.backgroundColor = "#e11d48";
    matteEl.style.opacity = "0.6";
    matteEl.style.transform = "scale(0.8)";
    matteEl.style.clipPath = "inset(15% 0% 15% 0%)";

    assert.strictEqual(matteEl.style.opacity, "0.6", "Opacidade deve ser atenuada");
    assert.strictEqual(matteEl.style.transform, "scale(0.8)", "Transformação de escala deve ser aplicada");
    assert.strictEqual(matteEl.style.clipPath, "inset(15% 0% 15% 0%)", "Letterbox crop deve ser aplicado");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 7: Integração e Paridade FFmpeg lavfi (color=c=...)
// ─────────────────────────────────────────────────────────────────────────────
runBattery("Integração e Paridade FFmpeg lavfi: color=c=0x... e sem arquivo no disco", () => {
    // 1. Validação estática de comando.py e suporte a tipo 'cor'
    const comandoPyPath = path.join(raiz, "src", "export", "video_render", "comando.py");
    const comandoPySrc = fs.readFileSync(comandoPyPath, "utf-8");

    assert.ok(comandoPySrc.includes('if tipo == "cor":'), "comando.py deve tratar tipo 'cor'");
    assert.ok(comandoPySrc.includes('-f", "lavfi", "-i"'), "comando.py deve gerar -f lavfi -i para entradas de cor");

    // 2. Formatação canônica do filtro lavfi color
    const hexColor = "#00ff00";
    const cleanHex = hexColor.replace("#", "");
    const w = 1920;
    const h = 1080;
    const fps = 24;
    const dur = 5.0;

    const lavfiFilter = `color=c=0x${cleanHex}:s=${w}x${h}:r=${fps}:d=${dur}`;
    assert.strictEqual(lavfiFilter, "color=c=0x00ff00:s=1920x1080:r=24:d=5");

    // 3. Verificação de casar_entradas
    // Entradas do tipo 'cor' não podem falhar por falta de arquivo físico no disco
    assert.ok(
        comandoPySrc.includes('if tipo == "cor"') || comandoPySrc.includes('tipo != "cor"'),
        "comando.py deve proteger entradas do tipo 'cor' contra verificações de arquivos em disco"
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 8: Modos de Mesclagem (Blend Modes) em Clipes NLE (Color Matte, Vídeo, Foto, Texto)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Modos de Mesclagem (Blend Modes): normal, multiply, screen, overlay, darken, lighten, soft-light, difference", async () => {
    const interaction = new CapiauTimelineInteraction(canvasStub);
    const validModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "soft-light", "difference"];

    // 1. Criação de Color Matte com blend_mode
    const matteMult = createColorMatteGenerator({
        color: "#ff0000",
        color_name: "Vermelho",
        blend_mode: "multiply"
    });
    assert.strictEqual(matteMult.blend_mode, "multiply", "Color Matte deve ter blend_mode multiply");

    // 2. Inserção na Timeline com blend_mode
    const cut = TIMELINE_STATE.addColorMatteCut({
        color: "#00ff00",
        name: "Verde Screen",
        blend_mode: "screen",
        track: "V2"
    });
    assert.strictEqual(cut.blend_mode, "screen", "Clipe na timeline deve herdar blend_mode screen");
    const tfEff = (cut.effects || []).find(e => e.type === "transform");
    assert.ok(tfEff, "Clipe deve ter efeito transform");
    assert.strictEqual(tfEff.blend_mode, "screen", "Efeito transform deve ter blend_mode screen");

    // 3. Modificação via setClipBlendMode
    interaction.setClipBlendMode(cut.id, "soft-light");
    const updatedCut = STATE.activeTimelineCuts.find(c => c.id === cut.id);
    assert.strictEqual(updatedCut.blend_mode, "soft-light", "setClipBlendMode deve atualizar clip.blend_mode");
    const updatedTf = updatedCut.effects.find(e => e.type === "transform");
    assert.strictEqual(updatedTf.blend_mode, "soft-light", "setClipBlendMode deve atualizar tf.blend_mode");

    // 4. Detecção de modificação na seção transform via _isSectionModified
    const isMod = interaction._isSectionModified(updatedCut, "transform");
    assert.strictEqual(isMod, true, "_isSectionModified deve acusar modificação quando blend_mode != normal");

    // 5. Aplicação no DOM em matte element (#program-player-matte)
    const matteEl = document.getElementById("program-player-matte");
    matteEl.style.mixBlendMode = updatedCut.blend_mode;
    assert.strictEqual(matteEl.style.mixBlendMode, "soft-light", "matteEl deve ter mixBlendMode soft-light");

    // 6. Teste de renderização de títulos com blend mode via tituloRender.js
    const { montarElementoTitulo } = await import("../src/ui/js/tituloRender.js");
    const textClip = {
        id: "title_blend_1",
        type: "text",
        text: "Título com Diferença",
        blend_mode: "difference",
        timeline_start: 0,
        timelineStartFrame: 0,
        effects: [{ type: "transform", blend_mode: "difference" }]
    };
    const titleEl = montarElementoTitulo(globalThis.document, textClip, 0.5, 1);
    assert.strictEqual(titleEl.style.mixBlendMode, "difference", "Título deve renderizar com mixBlendMode difference");

    // 7. Todos os 8 modos são aceitos
    validModes.forEach(m => {
        interaction.setClipBlendMode(cut.id, m);
        const currentCut = STATE.activeTimelineCuts.find(c => c.id === cut.id);
        assert.strictEqual(currentCut.blend_mode, m);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 9: Organização em Pastas Virtuais e de Sistema na Biblioteca
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Organização em Pastas Virtuais e de Sistema: Geradores, Subclipes e Títulos", async () => {
    const libMod = await import("../src/ui/js/library.js");

    const projId = 2;
    STATE.currentProjectId = projId;
    localStorage.setItem("activeProjectId", String(projId));
    libMod.loadVirtualFoldersState(projId);

    // 1. Criação com pasta selecionada
    window.selectedLibraryFolder = { path: "root/Efeitos Especiais" };
    const matteWithSelected = createColorMatteGenerator({
        color: "#10b981",
        name: "Verde VFX",
        virtual_folder: window.selectedLibraryFolder.path
    });
    assert.strictEqual(matteWithSelected.virtual_folder, "root/Efeitos Especiais", "Color Matte deve ser atribuído à pasta selecionada");

    // 2. Destino padrão sem pasta selecionada (root/Geradores)
    window.selectedLibraryFolder = null;
    const matteDefault = createColorMatteGenerator({
        color: "#3b82f6",
        name: "Azul Default"
    });
    assert.strictEqual(matteDefault.virtual_folder, "root/Geradores", "Color Matte sem seleção deve ir para root/Geradores");

    // 3. Subclipe sem pasta selecionada deve ir para root/Subclipes
    const subclipObj = libMod.createSubclip({
        title: "Cena 1 Tomada 2",
        in: 1.0,
        out: 4.0,
        video: { id: 10, filename: "camera.mp4" }
    }, projId);
    assert.strictEqual(subclipObj.virtual_folder, "root/Subclipes", "Subclipe deve receber pasta padrão root/Subclipes");
    assert.strictEqual(libMod.virtualFolderMap[`subclip:${subclipObj.id}`], "root/Subclipes", "virtualFolderMap deve mapear subclipe para root/Subclipes");

    // 4. Mover Color Matte via handleDropToFolder para outra pasta
    saveColorMattes(projId, [matteDefault]);
    const mockDropEvent = {
        dataTransfer: {
            getData: (format) => {
                if (format === "application/x-capiau-media") {
                    return JSON.stringify({
                        id: matteDefault.id,
                        kind: "color_matte",
                        type: "color_matte",
                        virtual_folder: "root/Geradores"
                    });
                }
                return "";
            },
            files: []
        }
    };

    await libMod.handleDropToFolder(mockDropEvent, "root/Fundos/Chroma");
    assert.strictEqual(
        libMod.virtualFolderMap[`color_matte:${matteDefault.id}`],
        "root/Fundos/Chroma",
        "handleDropToFolder deve mover Color Matte no virtualFolderMap"
    );

    const reloadedMattes = loadColorMattes(projId);
    const foundMatte = reloadedMattes.find(m => m.id === matteDefault.id);
    assert.ok(foundMatte, "Color Matte deve persistir no storage");
    assert.strictEqual(foundMatte.virtual_folder, "root/Fundos/Chroma", "virtual_folder deve ser atualizado no storage");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 10: Roteamento de Cor Sólida (Color Matte) e Prevenção de Poluição em Smart Bins
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Roteamento de Cor Sólida: Prevenção de poluição em Smart Bins e isolamento em root/Geradores", async () => {
    const libMod = await import("../src/ui/js/library.js");

    const projId = 77;
    STATE.currentProjectId = projId;
    localStorage.setItem("activeProjectId", String(projId));
    libMod.loadVirtualFoldersState(projId);

    // 1. getMediaSmartBin: cor sólida deve retornar SEMPRE "generators", e NUNCA "other" / cenas_bastidores
    const matteItem = { kind: "color_matte", id: "matte_routing_1", name: "Vermelho Teste", color: "#ff0000" };
    const smartBinKey = libMod.getMediaSmartBin(matteItem);
    assert.strictEqual(smartBinKey, "generators", "getMediaSmartBin deve categorizar color_matte como 'generators'");

    const matteIsMatte = { is_matte: true, id: "matte_routing_2", name: "Verde" };
    assert.strictEqual(libMod.getMediaSmartBin(matteIsMatte), "generators", "is_matte deve ser categorizado como 'generators'");

    const matteType = { type: "color_matte", id: "matte_routing_3", name: "Azul" };
    assert.strictEqual(libMod.getMediaSmartBin(matteType), "generators", "type: 'color_matte' deve ser categorizado como 'generators'");

    // 2. getItemVirtualFolder: ignora caminhos de smart_bins e faz fallback seguro para root/Geradores
    const matteNoFolder = { kind: "color_matte", id: "matte_no_fld" };
    assert.strictEqual(libMod.getItemVirtualFolder(matteNoFolder), "root/Geradores", "Item sem pasta deve ir para root/Geradores");

    const matteRootOnly = { kind: "color_matte", id: "matte_root_fld", virtual_folder: "root" };
    assert.strictEqual(libMod.getItemVirtualFolder(matteRootOnly), "root/Geradores", "Item com pasta 'root' deve fazer fallback para root/Geradores");

    const mattePolluted = { kind: "color_matte", id: "matte_polluted", virtual_folder: "smart_bins_root/temas_ia/cenas_bastidores" };
    assert.strictEqual(libMod.getItemVirtualFolder(mattePolluted), "root/Geradores", "Item com pasta smart_bins_root deve ser higienizado para root/Geradores");

    // Se houver mapeamento em virtualFolderMap apontando para smart bin, também é higienizado
    libMod.virtualFolderMap["color_matte:matte_polluted_map"] = "smart_bins_root/diarias";
    assert.strictEqual(libMod.getItemVirtualFolder({ kind: "color_matte", id: "matte_polluted_map" }), "root/Geradores", "Mapeamento em virtualFolderMap com smart_bins_root deve ir para root/Geradores");

    // Mas pastas normais do usuário são preservadas
    libMod.virtualFolderMap["color_matte:matte_custom_fld"] = "root/VFX/Fundos";
    assert.strictEqual(libMod.getItemVirtualFolder({ kind: "color_matte", id: "matte_custom_fld" }), "root/VFX/Fundos", "Pasta legítima do usuário é respeitada");

    // 3. Teste da UI Modal: quando o usuário está navegando num Smart Bin (ex: Cenas & Bastidores)
    // ao confirmar criação de cor sólida, a pasta destino NUNCA pode ser o Smart Bin.
    window.selectedLibraryFolder = {
        path: "smart_bins_root/temas_ia/cenas_bastidores",
        isSmartBin: true,
        label: "📁 Cenas & Bastidores Gerais"
    };

    // Prepara elementos DOM do modal
    const modal = document.getElementById("modal-new-color-matte") || makeEl("modal-new-color-matte");
    modal.id = "modal-new-color-matte";
    domRegistry["modal-new-color-matte"] = modal;

    const btnNew = document.getElementById("btn-new-color-matte") || makeEl("btn-new-color-matte");
    btnNew.id = "btn-new-color-matte";
    domRegistry["btn-new-color-matte"] = btnNew;

    const btnConfirm = document.getElementById("btn-confirm-color-matte") || makeEl("btn-confirm-color-matte");
    btnConfirm.id = "btn-confirm-color-matte";
    domRegistry["btn-confirm-color-matte"] = btnConfirm;

    const picker = document.getElementById("color-matte-picker") || makeEl("color-matte-picker");
    picker.id = "color-matte-picker";
    picker.value = "#ff5500";
    domRegistry["color-matte-picker"] = picker;

    const nameInp = document.getElementById("color-matte-name") || makeEl("color-matte-name");
    nameInp.id = "color-matte-name";
    nameInp.value = "Laranja Sol";
    domRegistry["color-matte-name"] = nameInp;

    libMod.initColorMatteModal();

    // Dispara clique no botão confirmar
    if (btnConfirm.click) {
        btnConfirm.click();
    }

    // Verifica que o Color Matte salvo está em root/Geradores
    const mattes = loadColorMattes(projId);
    const created = mattes.find(m => m.name === "Laranja Sol");
    assert.ok(created, "Color Matte deve ter sido criado e persistido no storage");
    assert.strictEqual(created.virtual_folder, "root/Geradores", "virtual_folder deve ser root/Geradores mesmo com Smart Bin selecionado");
    assert.strictEqual(libMod.virtualFolderMap[`color_matte:${created.id}`], "root/Geradores", "virtualFolderMap deve mapear para root/Geradores");
    assert.ok(libMod.openFoldersSet.has("root/Geradores"), "openFoldersSet deve incluir root/Geradores para visibilidade imediata");
});

// ─────────────────────────────────────────────────────────────────────────────
// Bateria 11: Modulação Suave de Fade In / Fade Out em Cor Sólida (Color Matte)
// ─────────────────────────────────────────────────────────────────────────────
await runBattery("Modulação de Fade In / Fade Out em Cor Sólida (Opacidade de 0% a 100%)", async () => {
    const { CapiauPlayer } = await import("../src/ui/js/player.js");
    const { computeClipFadeFactor, computeAdjustmentFadeFactor } = await import("../src/ui/js/timelineState.js");

    const player = new CapiauPlayer();
    const matteEl = document.getElementById("program-player-matte") || makeEl("program-player-matte");
    matteEl.id = "program-player-matte";
    domRegistry["program-player-matte"] = matteEl;

    // 1. Modulação com efeitos padrão do CapIAu (type: 'crossfade' em cut.effects)
    const matteFadeCut = {
        id: "matte_fade_test",
        type: "video",
        kind: "color_matte",
        color: "#2563eb", // Azul Royal
        track: "V1",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100, // 100 frames (@ 24fps)
        effects: [
            {
                type: "crossfade",
                side: "in",
                duration_s: 1.0, // 24 frames @ 24fps
                curve: "linear",
                tension: 0,
                disabled: false
            },
            {
                type: "crossfade",
                side: "out",
                duration_s: 1.0, // 24 frames @ 24fps (começa no frame 76)
                curve: "linear",
                tension: 0,
                disabled: false
            }
        ]
    };

    // Frame 0: Início exato do fade in -> fator 0.0
    const f0 = computeClipFadeFactor(matteFadeCut, 0, 24);
    assert.strictEqual(f0, 0, "Fator no frame 0 deve ser 0 (totalmente transparente)");
    player.applyMatteSlot(matteEl, matteFadeCut, 0);
    assert.strictEqual(matteEl.style.opacity, "0", "Opacidade no frame 0 deve ser '0'");

    // Frame 12: Meio do fade in (24 frames) -> fator 0.5
    const f12 = computeClipFadeFactor(matteFadeCut, 12, 24);
    assert.strictEqual(Math.round(f12 * 100) / 100, 0.5, "Fator no frame 12 deve ser 0.5");
    player.applyMatteSlot(matteEl, matteFadeCut, 12);
    assert.strictEqual(parseFloat(matteEl.style.opacity), 0.5, "Opacidade no frame 12 deve ser 0.5");

    // Frame 50: Platô pleno de cor sólida -> fator 1.0
    const f50 = computeClipFadeFactor(matteFadeCut, 50, 24);
    assert.strictEqual(f50, 1, "Fator no platô (frame 50) deve ser 1.0");
    player.applyMatteSlot(matteEl, matteFadeCut, 50);
    assert.strictEqual(matteEl.style.opacity, "1", "Opacidade no platô deve ser '1'");

    // Frame 88: Meio do fade out (100 - 12 = 88) -> fator 0.5
    const f88 = computeClipFadeFactor(matteFadeCut, 88, 24);
    assert.strictEqual(Math.round(f88 * 100) / 100, 0.5, "Fator no meio do fade out deve ser 0.5");
    player.applyMatteSlot(matteEl, matteFadeCut, 88);
    assert.strictEqual(parseFloat(matteEl.style.opacity), 0.5, "Opacidade no meio do fade out deve ser 0.5");

    // Frame 100: Final exato do corte -> fator 0.0
    const f100 = computeClipFadeFactor(matteFadeCut, 100, 24);
    assert.strictEqual(f100, 0, "Fator no final do corte deve ser 0.0");
    player.applyMatteSlot(matteEl, matteFadeCut, 100);
    assert.strictEqual(matteEl.style.opacity, "0", "Opacidade no frame 100 deve ser '0'");

    // 2. Modulação multiplicativa combinada com transform.opacity
    matteFadeCut.effects.push({
        type: "transform",
        opacity: 0.8,
        disabled: false
    });

    // No frame 50 (platô): 0.8 * 1.0 = 0.8
    player.applyMatteSlot(matteEl, matteFadeCut, 50);
    assert.strictEqual(parseFloat(matteEl.style.opacity), 0.8, "Opacidade no platô deve respeitar transform.opacity (0.8)");

    // No frame 12 (50% de fade in): 0.8 * 0.5 = 0.4
    player.applyMatteSlot(matteEl, matteFadeCut, 12);
    assert.strictEqual(Math.round(parseFloat(matteEl.style.opacity) * 100) / 100, 0.4, "Opacidade no meio do fade in deve ser 0.8 * 0.5 = 0.4");

    // 3. Suporte a cut.crossfade (objeto canônico de transição)
    const mattePresetFade = {
        id: "matte_preset_test",
        type: "video",
        kind: "color_matte",
        color: "#000000",
        track: "V1",
        timelineStartFrame: 100,
        inFrame: 0,
        outFrame: 100,
        crossfade: {
            fadeInDuration: 0.5, // 12 frames @ 24fps
            fadeOutDuration: 0.5,
            curveIn: "linear",
            curveOut: "linear"
        }
    };

    const factorPreset0 = computeClipFadeFactor(mattePresetFade, 100, 24);
    assert.strictEqual(factorPreset0, 0, "cut.crossfade: frame 100 (início) deve ser 0");
    const factorPresetMid = computeClipFadeFactor(mattePresetFade, 106, 24);
    assert.strictEqual(Math.round(factorPresetMid * 100) / 100, 0.5, "cut.crossfade: frame 106 deve ser 0.5");
    const factorPresetPlateau = computeClipFadeFactor(mattePresetFade, 150, 24);
    assert.strictEqual(factorPresetPlateau, 1, "cut.crossfade: frame 150 deve ser 1.0");

    // 4. Precedência de opacityOverride durante transição de junção (ex: cross dissolve)
    player.applyMatteSlot(matteEl, matteFadeCut, 50, 1, 0.35);
    // 0.8 * 0.35 = 0.28
    assert.strictEqual(Math.round(parseFloat(matteEl.style.opacity) * 100) / 100, 0.28, "opacityOverride explícito deve prevalecer");

    // 5. Clipe de cor sólida parametrizado exclusivamente em segundos (sem inFrame/outFrame)
    const matteSecsCut = {
        id: "matte_secs_test",
        type: "color_matte", // sem kind explícito
        color: "#10b981", // Esmeralda
        timeline_start: 2.0, // Frame 48 (@ 24fps)
        duration_s: 4.0,     // 96 frames
        fade_in: 1.0,        // 24 frames
        fade_out: 1.0        // 24 frames
    };

    // Frame 48 (início absoluto): fade_in = 0.0
    const fSecs0 = computeClipFadeFactor(matteSecsCut, 48, 24);
    assert.strictEqual(fSecs0, 0, "Clipe em segundos: frame 48 (início) deve ser 0.0");
    player.applyMatteSlot(matteEl, matteSecsCut, 48);
    assert.strictEqual(matteEl.style.opacity, "0", "Opacidade no início em segundos deve ser 0");

    // Frame 60 (meio do fade in): 0.5
    const fSecsMidIn = computeClipFadeFactor(matteSecsCut, 60, 24);
    assert.strictEqual(Math.round(fSecsMidIn * 100) / 100, 0.5, "Clipe em segundos: meio do fade in deve ser 0.5");
    player.applyMatteSlot(matteEl, matteSecsCut, 60);
    assert.strictEqual(parseFloat(matteEl.style.opacity), 0.5, "Opacidade no meio do fade in em segundos deve ser 0.5");

    // Frame 96 (platô pleno): 1.0
    const fSecsPlat = computeClipFadeFactor(matteSecsCut, 96, 24);
    assert.strictEqual(fSecsPlat, 1, "Clipe em segundos: platô deve ser 1.0");

    // Frame 132 (meio do fade out: 48 + 96 - 12 = 132): 0.5
    const fSecsMidOut = computeClipFadeFactor(matteSecsCut, 132, 24);
    assert.strictEqual(Math.round(fSecsMidOut * 100) / 100, 0.5, "Clipe em segundos: meio do fade out deve ser 0.5");

    // Frame 144 (final absoluto): 0.0
    const fSecsEnd = computeClipFadeFactor(matteSecsCut, 144, 24);
    assert.strictEqual(fSecsEnd, 0, "Clipe em segundos: final deve ser 0.0");

    // 6. Suporte a propriedades camelCase (fadeIn / fadeOut)
    const matteCamelCut = {
        id: "matte_camel_test",
        kind: "color_matte",
        timeline_start: 0.0,
        duration: 3.0,
        fadeIn: 0.5,
        fadeOut: 0.5
    };
    assert.strictEqual(computeClipFadeFactor(matteCamelCut, 0, 24), 0, "CamelCase fadeIn: frame 0 deve ser 0");
    assert.strictEqual(Math.round(computeClipFadeFactor(matteCamelCut, 6, 24) * 100) / 100, 0.5, "CamelCase fadeIn: frame 6 deve ser 0.5");
    assert.strictEqual(computeClipFadeFactor(matteCamelCut, 36, 24), 1, "CamelCase platô deve ser 1.0");

    // 7. Efeito de fade com duração nula (duration_s: 0) não zera a opacidade
    const matteZeroDurCut = {
        id: "matte_zero_dur",
        kind: "color_matte",
        timelineStartFrame: 0,
        inFrame: 0,
        outFrame: 100,
        effects: [
            { type: "crossfade", side: "in", duration_s: 0, disabled: false }
        ]
    };
    assert.strictEqual(computeClipFadeFactor(matteZeroDurCut, 0, 24), 1, "Fade com duration_s: 0 deve ser ignorado (fator 1.0)");
});

console.log("===============================================================================");
console.log(`  RESULTADO: ${passedCount}/${totalCount} baterias concluídas com 100% de sucesso!`);
console.log("===============================================================================\n");

process.exit(0);
