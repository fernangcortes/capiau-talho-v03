/**
 * Autoteste Funcional e Geométrico — Task 24: Margens de Segurança & Overlays de Aspecto no Player (Safe Margins)
 *
 * Valida:
 *  1. Estrutura DOM em index.html (#btn-program-safe-margins, #program-safe-margins-overlay) e estilos em styles.css
 *  2. Cache-busters incrementados em index.html (styles.css?v=94+, js/main.js?v=81+)
 *  3. Registro dos atalhos timeline.toggle_safe_margins e timeline.cycle_aspect_mask nos 5 presets NLE sem conflitos
 *     e preservação integral do cluster QWER/ASDF no preset capiau
 *  4. Geometria matemática exata (computeSafeMarginsGeometry) para Action Safe (90%), Title Safe (80%),
 *     Cruz Central, Grade dos Terços e Máscaras de Proporção (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3)
 *  5. Modo relativeToMask (90%/80% projetados dentro do quadro ativo da máscara de aspecto)
 *  6. Estado reativo, persistência em localStorage (capiau_safe_margins_v1) e emissão no barramento STATE
 *  7. Geração vetorial SVG (buildSafeMarginsSVGMarkup) e sincronização de DOM (syncSafeMarginsOverlay)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ── Mock de ambiente Browser / DOM para importação dos módulos ES ────────────
const storageMap = new Map();
globalThis.localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
    clear: () => storageMap.clear()
};

const mockElements = new Map();
function createMockElement(id, tagName = "DIV") {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const el = {
        id,
        tagName,
        style: { display: "none", width: "1920px", height: "1080px" },
        dataset: {},
        innerHTML: "",
        textContent: "",
        clientWidth: 1920,
        clientHeight: 1080,
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            toggle: (c, force) => {
                const shouldHave = force !== undefined ? Boolean(force) : !classes.has(c);
                if (shouldHave) classes.add(c);
                else classes.delete(c);
                return shouldHave;
            },
            contains: (c) => classes.has(c)
        },
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        addEventListener: (ev, fn) => {
            if (!listeners.has(ev)) listeners.set(ev, []);
            listeners.get(ev).push(fn);
        },
        removeEventListener: () => {},
        contains: () => false,
        getBoundingClientRect: () => ({ left: 100, top: 40, right: 124, bottom: 62, width: 24, height: 22 })
    };
    mockElements.set(id, el);
    return el;
}

createMockElement("btn-program-safe-margins", "BUTTON");
createMockElement("badge-program-safe-margins", "SPAN");
createMockElement("btn-program-safe-margins-menu", "BUTTON");
createMockElement("program-safe-margins-overlay", "DIV");
createMockElement("program-video-wrapper", "DIV");
createMockElement("program-player-viewport", "DIV");

globalThis.document = {
    getElementById: (id) => mockElements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => createMockElement(`dyn_${Math.random()}`, tag.toUpperCase()),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: {
        appendChild: () => {},
        removeChild: () => {}
    }
};

globalThis.window = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => {},
    removeEventListener: () => {},
    showToast: () => {}
};

const { STATE } = await import("../src/ui/js/state.js");
const {
    TIMELINE_STATE,
    CapiauTimelineState,
    computeSafeMarginsGeometry,
    SAFE_MARGINS_ASPECT_PRESETS,
    SAFE_MARGINS_ASPECT_ORDER,
    SAFE_MARGINS_STORAGE_KEY
} = await import("../src/ui/js/timelineState.js");
const {
    KEYMAP_SERVICE,
    KEYMAP_PRESETS,
    COMMANDS_CATALOG
} = await import("../src/ui/js/keymapService.js");
const {
    buildSafeMarginsSVGMarkup,
    syncSafeMarginsOverlay
} = await import("../src/ui/js/player.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        console.error(`  ❌ FALHA: ${message}`);
    }
}

function approxEqual(a, b, eps = 1e-2) {
    return Math.abs(Number(a) - Number(b)) <= eps;
}

console.log("═══════════════════════════════════════════════════════════════════════");
console.log(" AUTOTESTE TASK 24: MARGENS DE SEGURANÇA & OVERLAYS DE ASPECTO (PLAYER)");
console.log("═══════════════════════════════════════════════════════════════════════\n");

// ── 1. Estrutura HTML, CSS & Cache-Busters ──────────────────────────────────
console.log("1. Verificando estrutura HTML, CSS e Cache-Busters...");
const indexHtml = fs.readFileSync(path.join(ROOT, "src/ui/index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(ROOT, "src/ui/styles.css"), "utf8");

assert(indexHtml.includes('id="btn-program-safe-margins"'), "index.html contém o botão #btn-program-safe-margins no header do Program Player");
assert(indexHtml.includes('id="badge-program-safe-margins"'), "index.html contém o badge #badge-program-safe-margins");
assert(indexHtml.includes('id="btn-program-safe-margins-menu"'), "index.html contém o botão de opções #btn-program-safe-margins-menu");
assert(indexHtml.includes('id="program-safe-margins-overlay"'), "index.html contém o contêiner #program-safe-margins-overlay no viewport do Program Player");
assert(
    indexHtml.includes('id="program-safe-margins-overlay"') && indexHtml.includes("pointer-events: none"),
    "#program-safe-margins-overlay possui pointer-events: none"
);

const cssVersionMatch = indexHtml.match(/styles\.css\?v=(\d+)/);
const jsVersionMatch = indexHtml.match(/js\/main\.js\?v=(\d+)/);
assert(cssVersionMatch && Number(cssVersionMatch[1]) >= 94, `Cache-buster de styles.css atualizado (v=${cssVersionMatch?.[1]})`);
assert(jsVersionMatch && Number(jsVersionMatch[1]) >= 81, `Cache-buster de js/main.js atualizado (v=${jsVersionMatch?.[1]})`);

assert(stylesCss.includes(".btn-safe-margins"), "styles.css define a classe .btn-safe-margins");
assert(stylesCss.includes(".program-safe-margins-overlay"), "styles.css define a classe .program-safe-margins-overlay");
assert(stylesCss.includes(".safe-box-action") && stylesCss.includes(".safe-box-title"), "styles.css define .safe-box-action (90%) e .safe-box-title (80%)");
assert(stylesCss.includes(".safe-center-cross-line"), "styles.css define .safe-center-cross-line (Cruz Central)");
assert(stylesCss.includes(".safe-mask-bar") && stylesCss.includes(".safe-mask-border"), "styles.css define .safe-mask-bar e .safe-mask-border");
assert(
    stylesCss.includes(".safe-margins-flyout") && stylesCss.includes("z-index: 999999"),
    "styles.css define .safe-margins-flyout com position: fixed e z-index: 999999 (Diretriz 14)"
);

// ── 2. Catálogo de Atalhos e 5 Presets NLE ──────────────────────────────────
console.log("\n2. Verificando COMMANDS_CATALOG, 5 Presets NLE e cluster QWER/ASDF...");
const cmdToggle = COMMANDS_CATALOG.find(c => c.id === "timeline.toggle_safe_margins");
const cmdCycle = COMMANDS_CATALOG.find(c => c.id === "timeline.cycle_aspect_mask");
assert(Boolean(cmdToggle), "Comando timeline.toggle_safe_margins registrado no COMMANDS_CATALOG");
assert(Boolean(cmdCycle), "Comando timeline.cycle_aspect_mask registrado no COMMANDS_CATALOG");

const presets = ["capiau", "kdenlive", "premiere", "resolve", "finalcut"];
for (const preset of presets) {
    KEYMAP_SERVICE.setPreset(preset);
    const toggleBindings = KEYMAP_SERVICE.getBindingsForCommand("timeline.toggle_safe_margins");
    const cycleBindings = KEYMAP_SERVICE.getBindingsForCommand("timeline.cycle_aspect_mask");
    assert(toggleBindings.length > 0, `Preset '${preset}' possui atalho para timeline.toggle_safe_margins (${toggleBindings.join(", ")})`);
    assert(cycleBindings.length > 0, `Preset '${preset}' possui atalho para timeline.cycle_aspect_mask (${cycleBindings.join(", ")})`);

    const conflictsToggle = KEYMAP_SERVICE.findConflicts(toggleBindings[0], "timeline.toggle_safe_margins");
    const conflictsCycle = KEYMAP_SERVICE.findConflicts(cycleBindings[0], "timeline.cycle_aspect_mask");
    assert(conflictsToggle.length === 0, `Zero conflitos para ${toggleBindings[0]} no preset '${preset}'`);
    assert(conflictsCycle.length === 0, `Zero conflitos para ${cycleBindings[0]} no preset '${preset}'`);
}

// Preservação do cluster Speed Editing QWER/ASDF no preset CapIAu
KEYMAP_SERVICE.setPreset("capiau");
assert(KEYMAP_PRESETS.capiau["edit.ripple_trim_head"].includes("KeyQ"), "Cluster CapIAu preservado: Q -> edit.ripple_trim_head");
assert(KEYMAP_PRESETS.capiau["edit.ripple_trim_tail"].includes("KeyW"), "Cluster CapIAu preservado: W -> edit.ripple_trim_tail");
assert(KEYMAP_PRESETS.capiau["edit.split"].includes("KeyE"), "Cluster CapIAu preservado: E -> edit.split");
assert(KEYMAP_PRESETS.capiau["edit.ripple_delete"].includes("KeyR"), "Cluster CapIAu preservado: R -> edit.ripple_delete");
assert(KEYMAP_PRESETS.capiau["playback.prev_edit_point"].includes("KeyA"), "Cluster CapIAu preservado: A -> playback.prev_edit_point");
assert(KEYMAP_PRESETS.capiau["playback.next_edit_point"].includes("KeyS"), "Cluster CapIAu preservado: S -> playback.next_edit_point");
assert(KEYMAP_PRESETS.capiau["edit.select_clip_at_playhead"].includes("KeyD"), "Cluster CapIAu preservado: D -> edit.select_clip_at_playhead");
assert(KEYMAP_PRESETS.capiau["edit.toggle_clip_disable"].includes("KeyF"), "Cluster CapIAu preservado: F -> edit.toggle_clip_disable");

assert(
    KEYMAP_SERVICE.matches({ code: "KeyG", key: "G", ctrlKey: true, shiftKey: true, altKey: false }, "timeline.toggle_safe_margins"),
    "KEYMAP_SERVICE.matches reconhece Ctrl+Shift+G para timeline.toggle_safe_margins"
);
assert(
    KEYMAP_SERVICE.matches({ code: "KeyG", key: "g", ctrlKey: true, shiftKey: false, altKey: true }, "timeline.cycle_aspect_mask"),
    "KEYMAP_SERVICE.matches reconhece Ctrl+Alt+G para timeline.cycle_aspect_mask"
);

// ── 3. Cálculo Geométrico das Caixas 90% / 80% e Cruz Central ───────────────
console.log("\n3. Verificando cálculo matemático das caixas Action Safe (90%), Title Safe (80%) e Cruz Central...");
const geo1080p = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "none" });

assert(geo1080p.actionSafe.coverage === 0.90, "Action Safe possui cobertura de 90% (0.90)");
assert(
    approxEqual(geo1080p.actionSafe.x, 96) &&
    approxEqual(geo1080p.actionSafe.y, 54) &&
    approxEqual(geo1080p.actionSafe.width, 1728) &&
    approxEqual(geo1080p.actionSafe.height, 972),
    `Action Safe 90% em 1920x1080: x=${geo1080p.actionSafe.x}, y=${geo1080p.actionSafe.y}, w=${geo1080p.actionSafe.width}, h=${geo1080p.actionSafe.height}`
);
assert(
    approxEqual(geo1080p.actionSafe.leftPct, 5) &&
    approxEqual(geo1080p.actionSafe.topPct, 5) &&
    approxEqual(geo1080p.actionSafe.widthPct, 90) &&
    approxEqual(geo1080p.actionSafe.heightPct, 90),
    "Action Safe 90% em percentuais: left=5%, top=5%, width=90%, height=90%"
);

assert(geo1080p.titleSafe.coverage === 0.80, "Title Safe possui cobertura de 80% (0.80)");
assert(
    approxEqual(geo1080p.titleSafe.x, 192) &&
    approxEqual(geo1080p.titleSafe.y, 108) &&
    approxEqual(geo1080p.titleSafe.width, 1536) &&
    approxEqual(geo1080p.titleSafe.height, 864),
    `Title Safe 80% em 1920x1080: x=${geo1080p.titleSafe.x}, y=${geo1080p.titleSafe.y}, w=${geo1080p.titleSafe.width}, h=${geo1080p.titleSafe.height}`
);
assert(
    approxEqual(geo1080p.titleSafe.leftPct, 10) &&
    approxEqual(geo1080p.titleSafe.topPct, 10) &&
    approxEqual(geo1080p.titleSafe.widthPct, 80) &&
    approxEqual(geo1080p.titleSafe.heightPct, 80),
    "Title Safe 80% em percentuais: left=10%, top=10%, width=80%, height=80%"
);

assert(
    approxEqual(geo1080p.centerCross.cx, 960) &&
    approxEqual(geo1080p.centerCross.cy, 540) &&
    approxEqual(geo1080p.centerCross.horizontal.y1, 540) &&
    approxEqual(geo1080p.centerCross.vertical.x1, 960),
    "Cruz Central posicionada exatamente no centro óptico (960, 540)"
);

// Sequência Vertical Nativa 1080x1920
const geoVerticalSeq = computeSafeMarginsGeometry(1080, 1920, { aspectMask: "none" });
assert(
    approxEqual(geoVerticalSeq.actionSafe.x, 54) &&
    approxEqual(geoVerticalSeq.actionSafe.y, 96) &&
    approxEqual(geoVerticalSeq.actionSafe.width, 972) &&
    approxEqual(geoVerticalSeq.actionSafe.height, 1728),
    "Sequência vertical 1080x1920 calcula Action Safe (90%) perfeitamente (54, 96, 972x1728)"
);
assert(
    approxEqual(geoVerticalSeq.titleSafe.x, 108) &&
    approxEqual(geoVerticalSeq.titleSafe.y, 192) &&
    approxEqual(geoVerticalSeq.titleSafe.width, 864) &&
    approxEqual(geoVerticalSeq.titleSafe.height, 1536),
    "Sequência vertical 1080x1920 calcula Title Safe (80%) perfeitamente (108, 192, 864x1536)"
);

// ── 4. Cálculo das Máscaras de Proporção (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3) ──
console.log("\n4. Verificando máscaras de proporção de aspecto (16:9, 9:16, 1:1, 2.39:1, 4:5, 4:3)...");

// 4.1 Máscara 16:9 em sequência 1920x1080 (Exata)
const geo16x9 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "16:9" });
assert(
    geo16x9.aspectMask.hasMask === true &&
    geo16x9.aspectMask.maskType === "exact" &&
    geo16x9.aspectMask.bars.length === 0 &&
    approxEqual(geo16x9.aspectMask.activeRect.width, 1920) &&
    approxEqual(geo16x9.aspectMask.activeRect.height, 1080),
    "Máscara 16:9 em sequência 1920x1080: maskType='exact', 0 barras, quadro ativo 1920x1080"
);

// 4.2 Máscara 9:16 vertical em sequência 1920x1080 (Pillarbox)
const geo9x16 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "9:16" });
assert(
    geo9x16.aspectMask.hasMask === true &&
    geo9x16.aspectMask.maskType === "pillarbox" &&
    geo9x16.aspectMask.bars.length === 2,
    "Máscara 9:16 em 1920x1080 gera pillarbox com 2 barras laterais"
);
assert(
    approxEqual(geo9x16.aspectMask.activeRect.width, 607.5) &&
    approxEqual(geo9x16.aspectMask.activeRect.height, 1080) &&
    approxEqual(geo9x16.aspectMask.activeRect.x, 656.25),
    `Máscara 9:16 em 1920x1080: quadro central 607.5x1080 em x=656.25 (atual: ${geo9x16.aspectMask.activeRect.width}x${geo9x16.aspectMask.activeRect.height}, x=${geo9x16.aspectMask.activeRect.x})`
);
assert(
    geo9x16.aspectMask.bars[0].side === "left" &&
    approxEqual(geo9x16.aspectMask.bars[0].width, 656.25) &&
    geo9x16.aspectMask.bars[1].side === "right" &&
    approxEqual(geo9x16.aspectMask.bars[1].x, 1263.75),
    "Barras pillarbox esquerda e direita de 9:16 possuem largura exata de 656.25px cada"
);

// 4.3 Máscara 1:1 quadrado em sequência 1920x1080 (Pillarbox)
const geo1x1 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "1:1" });
assert(
    geo1x1.aspectMask.hasMask === true &&
    geo1x1.aspectMask.maskType === "pillarbox" &&
    approxEqual(geo1x1.aspectMask.activeRect.width, 1080) &&
    approxEqual(geo1x1.aspectMask.activeRect.height, 1080) &&
    approxEqual(geo1x1.aspectMask.activeRect.x, 420),
    "Máscara 1:1 em 1920x1080: quadro central quadrado 1080x1080 em x=420 com barras de 420px"
);

// 4.4 Máscara 2.39:1 Cinema Scope em sequência 1920x1080 (Letterbox)
const geo239 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "2.39:1" });
const expectedScopeH = 1920 / 2.39; // ~803.34728
const expectedScopeBarH = (1080 - expectedScopeH) / 2; // ~138.32636
assert(
    geo239.aspectMask.hasMask === true &&
    geo239.aspectMask.maskType === "letterbox" &&
    geo239.aspectMask.bars.length === 2,
    "Máscara 2.39:1 em 1920x1080 gera letterbox com 2 barras horizontais (top/bottom)"
);
assert(
    approxEqual(geo239.aspectMask.activeRect.width, 1920) &&
    approxEqual(geo239.aspectMask.activeRect.height, expectedScopeH) &&
    approxEqual(geo239.aspectMask.activeRect.y, expectedScopeBarH),
    `Máscara 2.39:1 em 1920x1080: quadro 1920x${geo239.aspectMask.activeRect.height.toFixed(2)} com barras top/bottom de ${expectedScopeBarH.toFixed(2)}px`
);

// 4.5 Máscaras 4:5 e 4:3
const geo4x5 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "4:5" });
assert(
    geo4x5.aspectMask.maskType === "pillarbox" &&
    approxEqual(geo4x5.aspectMask.activeRect.width, 864) &&
    approxEqual(geo4x5.aspectMask.activeRect.x, 528),
    "Máscara 4:5 em 1920x1080: quadro central 864x1080 em x=528"
);

const geo4x3 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "4:3" });
assert(
    geo4x3.aspectMask.maskType === "pillarbox" &&
    approxEqual(geo4x3.aspectMask.activeRect.width, 1440) &&
    approxEqual(geo4x3.aspectMask.activeRect.x, 240),
    "Máscara 4:3 em 1920x1080: quadro central 1440x1080 em x=240"
);

// 4.6 Modo relativeToMask (guias 90%/80% projetadas dentro da máscara 9:16)
const geoRel9x16 = computeSafeMarginsGeometry(1920, 1080, { aspectMask: "9:16", relativeToMask: true });
assert(
    approxEqual(geoRel9x16.actionSafe.width, 607.5 * 0.90) &&
    approxEqual(geoRel9x16.titleSafe.width, 607.5 * 0.80) &&
    approxEqual(geoRel9x16.sequenceActionSafe.width, 1728),
    "Modo relativeToMask=true projeta Action Safe (90%) e Title Safe (80%) dentro do recorte 9:16"
);

// ── 5. Gerenciamento de Estado, Persistência e Eventos (TIMELINE_STATE) ─────
console.log("\n5. Verificando TIMELINE_STATE, persistência em localStorage e eventos STATE...");
storageMap.clear();
const ts = new CapiauTimelineState();
assert(ts.safeMarginsEnabled === false, "Safe Margins inicia desativado por padrão");
assert(ts.safeMarginsConfig.aspectMask === "none", "Máscara de aspecto inicia em 'none' por padrão");

let eventCount = 0;
let lastPayload = null;
STATE.on("safeMarginsChanged", (payload) => {
    eventCount++;
    lastPayload = payload;
});

const toggledOn = ts.toggleSafeMargins();
assert(toggledOn === true && ts.safeMarginsEnabled === true, "toggleSafeMargins() ativa o estado");
assert(eventCount === 1 && lastPayload?.enabled === true, "Evento 'safeMarginsChanged' emitido ao alternar estado");

const savedRaw = localStorage.getItem(SAFE_MARGINS_STORAGE_KEY);
assert(Boolean(savedRaw) && JSON.parse(savedRaw).enabled === true, "Estado persistido em localStorage (capiau_safe_margins_v1)");

ts.toggleSafeMargins(false);
assert(ts.safeMarginsEnabled === false, "toggleSafeMargins(false) desativa o estado");

// Selecionar máscara ativa automaticamente o overlay
ts.setSafeMarginsAspectMask("9:16");
assert(
    ts.safeMarginsEnabled === true && ts.safeMarginsConfig.aspectMask === "9:16",
    "setSafeMarginsAspectMask('9:16') define a máscara 9:16 e ativa automaticamente o overlay"
);

// Ciclo de máscaras
const visitedMasks = [];
for (let i = 0; i < SAFE_MARGINS_ASPECT_ORDER.length; i++) {
    const res = ts.cycleSafeMarginsAspectMask(1);
    visitedMasks.push(res.config.aspectMask);
}
assert(
    visitedMasks.includes("1:1") &&
    visitedMasks.includes("2.39:1") &&
    visitedMasks.includes("16:9") &&
    visitedMasks.includes("none"),
    `cycleSafeMarginsAspectMask() percorre todas as proporções (${visitedMasks.join(" -> ")})`
);

// Restauração a partir do localStorage
ts.setSafeMarginsConfig({ aspectMask: "2.39:1", ruleOfThirds: true, titleSafe: true, actionSafe: true });
ts.toggleSafeMargins(true);
const restoredTs = new CapiauTimelineState();
assert(
    restoredTs.safeMarginsEnabled === true &&
    restoredTs.safeMarginsConfig.aspectMask === "2.39:1" &&
    restoredTs.safeMarginsConfig.ruleOfThirds === true,
    "Nova instância CapiauTimelineState restaura estado e configurações do localStorage com fidelidade"
);

// ── 6. Renderização SVG e Sincronização de DOM no Player ────────────────────
console.log("\n6. Verificando geração vetorial SVG (buildSafeMarginsSVGMarkup) e syncSafeMarginsOverlay()...");
const svgMarkup = buildSafeMarginsSVGMarkup(1920, 1080, {
    actionSafe: true,
    titleSafe: true,
    centerCross: true,
    ruleOfThirds: true,
    aspectMask: "9:16"
});

assert(svgMarkup.includes('class="safe-margins-svg"'), "SVG gerado contém a classe .safe-margins-svg");
assert(svgMarkup.includes('data-aspect-mask="9:16"') && svgMarkup.includes('data-mask-type="pillarbox"'), "SVG gerado declara data-aspect-mask='9:16' e data-mask-type='pillarbox'");
assert(svgMarkup.includes('data-mask-side="left"') && svgMarkup.includes('data-mask-side="right"'), "SVG gerado renderiza as barras pillarbox esquerda e direita");
assert(svgMarkup.includes('data-safe-zone="action-90"') && svgMarkup.includes(">90%</text>"), "SVG gerado renderiza a caixa e rótulo Action Safe 90%");
assert(svgMarkup.includes('data-safe-zone="title-80"') && svgMarkup.includes(">80%</text>"), "SVG gerado renderiza a caixa e rótulo Title Safe 80%");
assert(svgMarkup.includes('data-safe-zone="center-cross"'), "SVG gerado renderiza a Cruz Central");
assert(svgMarkup.includes('class="safe-thirds-line"'), "SVG gerado renderiza as linhas da Regra dos Terços quando ativa");

// Sincronização com elementos DOM do Player
TIMELINE_STATE.setSafeMarginsAspectMask("9:16");
TIMELINE_STATE.toggleSafeMargins(true);
syncSafeMarginsOverlay();

const btnEl = mockElements.get("btn-program-safe-margins");
const badgeEl = mockElements.get("badge-program-safe-margins");
const overlayEl = mockElements.get("program-safe-margins-overlay");

assert(btnEl.classList.contains("active") && btnEl.getAttribute("aria-pressed") === "true", "#btn-program-safe-margins recebe classe .active e aria-pressed='true'");
assert(badgeEl.style.display === "inline-flex" && badgeEl.textContent === "9:16", "#badge-program-safe-margins exibe o badge '9:16'");
assert(overlayEl.style.display === "block" && overlayEl.innerHTML.includes('data-aspect-mask="9:16"'), "#program-safe-margins-overlay fica visível e injeta o SVG vetorial");

TIMELINE_STATE.toggleSafeMargins(false);
syncSafeMarginsOverlay();
assert(!btnEl.classList.contains("active") && overlayEl.style.display === "none", "Desativar Safe Margins oculta #program-safe-margins-overlay e remove classe .active do botão");

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log(` RESULTADO FINAL: ${passed} asserções aprovadas, ${failed} falhas.`);
console.log("═══════════════════════════════════════════════════════════════════════");

if (failed > 0) {
    process.exit(1);
}
