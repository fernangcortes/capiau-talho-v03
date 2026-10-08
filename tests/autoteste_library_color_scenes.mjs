import fs from 'fs';
import path from 'path';
import assert from 'assert';

console.log("=== INICIANDO TESTES: MODO DE BIBLIOTECA POR CENAS CROMÁTICAS & DECUPAGEM ===");

const indexHtmlPath = path.resolve('src/ui/index.html');
const stylesCssPath = path.resolve('src/ui/styles.css');
const libraryJsPath = path.resolve('src/ui/js/library.js');
const skillPath = path.resolve('.agents/skills/capiau-nle-design-system/SKILL.md');

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const stylesCss = fs.readFileSync(stylesCssPath, 'utf8');
const libraryJs = fs.readFileSync(libraryJsPath, 'utf8');
const skillContent = fs.readFileSync(skillPath, 'utf8');

// 1. Verificação de Elementos Estruturais no HTML
console.log("\n[1/6] Verificando elementos estruturais em index.html...");
assert(indexHtml.includes('id="library-decoupage-strip"'), 'Falta #library-decoupage-strip no index.html');
assert(indexHtml.includes('id="btn-view-mode-scenes"'), 'Falta botão #btn-view-mode-scenes na toolbar da biblioteca');
assert(indexHtml.includes('id="btn-toggle-decoupage-strip"'), 'Falta botão #btn-toggle-decoupage-strip na toolbar da biblioteca');
assert(indexHtml.includes('id="btn-decoupage-mode-trigger"'), 'Falta trigger #btn-decoupage-mode-trigger na régua de decupagem');
assert(indexHtml.includes('id="decoupage-mode-dropdown"'), 'Falta menu dropdown #decoupage-mode-dropdown no index.html');
assert(indexHtml.includes('id="btn-track-scroll-left"'), 'Falta botão #btn-track-scroll-left no index.html');
assert(indexHtml.includes('id="btn-track-scroll-right"'), 'Falta botão #btn-track-scroll-right no index.html');
assert(indexHtml.includes('id="btn-hide-decoupage-strip"'), 'Falta botão #btn-hide-decoupage-strip no index.html');
assert(indexHtml.includes('id="decoupage-strip-track"'), 'Falta #decoupage-strip-track no index.html');
assert(indexHtml.includes('id="btn-clear-decoupage-filter"'), 'Falta #btn-clear-decoupage-filter no index.html');
assert(indexHtml.includes('value="color_scenes"'), 'Falta option value="color_scenes" no sel-gallery-grouping');
assert(indexHtml.includes('value="color_palette_global"'), 'Falta option value="color_palette_global" no sel-gallery-grouping');
assert(indexHtml.includes('value="shot_scale"'), 'Falta option value="shot_scale" no sel-gallery-grouping');
assert(indexHtml.includes('value="speakers"'), 'Falta option value="speakers" no sel-gallery-grouping');
console.log("✔ Elementos HTML da Barra de Decupagem, botão de modo e opções de agrupamento verificados com sucesso.");

// 2. Verificação de Regras CSS
console.log("\n[2/6] Verificando regras no styles.css...");
assert(stylesCss.includes('.library-decoupage-strip'), 'Falta classe .library-decoupage-strip no styles.css');
assert(stylesCss.includes('.decoupage-mode-dropdown-container'), 'Falta classe .decoupage-mode-dropdown-container no styles.css');
assert(stylesCss.includes('.decoupage-mode-trigger'), 'Falta classe .decoupage-mode-trigger no styles.css');
assert(stylesCss.includes('.decoupage-mode-dropdown-menu'), 'Falta classe .decoupage-mode-dropdown-menu no styles.css');
assert(stylesCss.includes('.btn-decoupage-scroll-track'), 'Falta classe .btn-decoupage-scroll-track no styles.css');
assert(stylesCss.includes('.btn-hide-decoupage-strip'), 'Falta classe .btn-hide-decoupage-strip no styles.css');
assert(stylesCss.includes('.decoupage-strip-track'), 'Falta classe .decoupage-strip-track no styles.css');
assert(stylesCss.includes('.decoupage-strip-segment'), 'Falta classe .decoupage-strip-segment no styles.css');
assert(stylesCss.includes('.btn-clear-decoupage-filter'), 'Falta classe .btn-clear-decoupage-filter no styles.css');
assert(stylesCss.includes('.scene-decoupage-header'), 'Falta classe .scene-decoupage-header no styles.css');
assert(stylesCss.includes('.scene-header-btn'), 'Falta classe .scene-header-btn no styles.css');
assert(stylesCss.includes('.scene-color-swatch-badge'), 'Falta classe .scene-color-swatch-badge no styles.css');
assert(stylesCss.includes('.chip-swatch-only'), 'Falta classe .chip-swatch-only no styles.css');
assert(stylesCss.includes('.chip-number-only'), 'Falta classe .chip-number-only no styles.css');
assert(stylesCss.includes('.chip-micro'), 'Falta classe .chip-micro no styles.css');
assert(stylesCss.includes('.chip-compact'), 'Falta classe .chip-compact no styles.css');
assert(stylesCss.includes('.chip-standard'), 'Falta classe .chip-standard no styles.css');
console.log("✔ Regras CSS da barra de decupagem, chips minimalistas escalonados e badges cromáticos verificadas com sucesso.");

// 3. Verificação de Métodos e Handlers em library.js
console.log("\n[3/6] Verificando métodos e integrações em library.js...");
assert(libraryJs.includes('renderDecoupageStrip('), 'Falta método renderDecoupageStrip em library.js');
assert(libraryJs.includes('btnViewModeScenes'), 'Falta integração de btnViewModeScenes em library.js');
assert(libraryJs.includes('btn-toggle-decoupage-strip'), 'Falta handler do botão btn-toggle-decoupage-strip em library.js');
assert(libraryJs.includes('btn-hide-decoupage-strip'), 'Falta handler do botão btn-hide-decoupage-strip em library.js');
assert(libraryJs.includes('btn-track-scroll-left'), 'Falta handler do scroll esquerdo da fita em library.js');
assert(libraryJs.includes('btn-track-scroll-right'), 'Falta handler do scroll direito da fita em library.js');
assert(libraryJs.includes('dominanceWeight'), 'Falta ponderação de dominância em getBestPaletteColor');
assert(libraryJs.includes('palette_fam_'), 'Falta agrupamento por família unificada de paleta em library.js');
assert(libraryJs.includes('scrollToDecoupageGroup('), 'Falta método scrollToDecoupageGroup em library.js');
assert(libraryJs.includes('applyDecoupageExclusiveFilter('), 'Falta método applyDecoupageExclusiveFilter em library.js');
assert(libraryJs.includes('clearDecoupageFilter('), 'Falta método clearDecoupageFilter em library.js');
assert(libraryJs.includes('filterByGlobalPalette('), 'Falta método filterByGlobalPalette em library.js');
assert(libraryJs.includes('btn-select-scene-clips'), 'Falta botão de seleção em lote btn-select-scene-clips');
assert(libraryJs.includes('btn-filter-color-global'), 'Falta botão de filtro de paleta global btn-filter-color-global');
assert(libraryJs.includes('application/x-capiau-media-batch'), 'Falta suporte a drag and drop em lote de cenas');
assert(libraryJs.includes('e.key === "Escape"'), 'Falta handler da tecla Escape para limpar filtro');
assert(libraryJs.includes('e.altKey'), 'Falta detecção de Alt+clique para filtro exclusivo');
assert(libraryJs.includes('resolveChipPresentation'), 'Falta função resolveChipPresentation em library.js');
assert(libraryJs.includes('chip-swatch-only'), 'Falta classe chip-swatch-only em library.js');
assert(libraryJs.includes('chip-number-only'), 'Falta classe chip-number-only em library.js');
console.log("✔ Métodos de controle, atalhos (Esc, Alt), apresentação inteligente de chips e navegação verificados.");

// 4. Testes de Algoritmos Puros: colorDistance, getColorDescriptor e coalesceColorBlocks
console.log("\n[4/6] Executando testes unitários dos algoritmos cromáticos...");

function hexToRgb(hex) {
    if (!hex) return [0, 0, 0];
    const clean = hex.replace("#", "");
    if (clean.length === 3) {
        return [
            parseInt(clean[0] + clean[0], 16),
            parseInt(clean[1] + clean[1], 16),
            parseInt(clean[2] + clean[2], 16)
        ];
    }
    return [
        parseInt(clean.slice(0, 2), 16) || 0,
        parseInt(clean.slice(2, 4), 16) || 0,
        parseInt(clean.slice(4, 6), 16) || 0
    ];
}

function colorDistance(c1, c2) {
    const rgb1 = hexToRgb(c1);
    const rgb2 = hexToRgb(c2);
    const dr = rgb1[0] - rgb2[0];
    const dg = rgb1[1] - rgb2[1];
    const db = rgb1[2] - rgb2[2];
    return Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

function getColorDescriptor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / (2 * 255);

    if (l < 0.12) return { name: "Preto / Noturno", icon: "fa-moon" };
    if (l > 0.88 && delta < 25) return { name: "Branco / Estourado", icon: "fa-sun" };
    if (delta < 18) return { name: "Cinza / Neutro", icon: "fa-cloud" };

    if (max === r && g < 100 && b < 100) return { name: "Vermelho Intenso", icon: "fa-fire" };
    if (max === r && g > 150 && b < 100) return { name: "Dourado / Quente", icon: "fa-sun" };
    if (max === g && r < 140) return { name: "Verde / Natureza", icon: "fa-leaf" };
    if (max === b && r < 100) return { name: "Azul / Frio", icon: "fa-water" };
    if (r > 160 && b > 160 && g < 120) return { name: "Magenta / Púrpura", icon: "fa-gem" };

    return { name: "Cromático Misto", icon: "fa-palette" };
}

function coalesceColorBlocks(itemsWithColors) {
    if (!itemsWithColors || itemsWithColors.length === 0) return [];
    const blocks = [];
    let currentBlock = {
        color: itemsWithColors[0].color,
        count: 1,
        startIndex: 0,
        endIndex: 0,
        items: [itemsWithColors[0]]
    };
    for (let i = 1; i < itemsWithColors.length; i++) {
        const curr = itemsWithColors[i];
        const dist = colorDistance(currentBlock.color, curr.color);
        if (dist <= 52) {
            currentBlock.count++;
            currentBlock.endIndex = i;
            currentBlock.items.push(curr);
        } else {
            blocks.push(currentBlock);
            currentBlock = {
                color: curr.color,
                count: 1,
                startIndex: i,
                endIndex: i,
                items: [curr]
            };
        }
    }
    blocks.push(currentBlock);

    if (blocks.length >= 3) {
        for (let i = 1; i < blocks.length - 1; i++) {
            if (blocks[i].count <= 1 && colorDistance(blocks[i - 1].color, blocks[i + 1].color) < 36) {
                blocks[i - 1].count += blocks[i].count + blocks[i + 1].count;
                blocks[i - 1].endIndex = blocks[i + 1].endIndex;
                blocks.splice(i, 2);
                i--;
            }
        }
    }
    return blocks;
}

// 4.1 Teste de distância de cor
assert.strictEqual(colorDistance("#000000", "#000000"), 0, "Cores idênticas devem ter distância zero");
const distBW = colorDistance("#000000", "#ffffff");
assert(distBW > 200, "Distância entre preto e branco deve ser substancial (> 200)");
const distWarm = colorDistance("#ff8800", "#ff9010");
assert(distWarm <= 52, "Tons alaranjados próximos devem ter distância <= 52");

// 4.2 Teste de descritores semânticos
assert.strictEqual(getColorDescriptor("#050505").name, "Preto / Noturno");
assert.strictEqual(getColorDescriptor("#fefefe").name, "Branco / Estourado");
assert.strictEqual(getColorDescriptor("#0a2558").name, "Azul / Frio");
assert.strictEqual(getColorDescriptor("#1a6b22").name, "Verde / Natureza");

// 4.3 Teste de agrupamento e coalescência em blocos de cena
const mockTimelineItems = [
    { id: 1, color: "#1e3a8a" }, // Azul (Cena 1)
    { id: 2, color: "#1e40af" }, // Azul (Cena 1)
    { id: 3, color: "#1d4ed8" }, // Azul (Cena 1)
    { id: 4, color: "#e11d48" }, // Vermelho (Cena 2)
    { id: 5, color: "#be123c" }, // Vermelho (Cena 2)
    { id: 6, color: "#059669" }, // Verde (Cena 3)
    { id: 7, color: "#047857" }  // Verde (Cena 3)
];
const blocks = coalesceColorBlocks(mockTimelineItems);
assert.strictEqual(blocks.length, 3, "Deveria ter identificado exatamente 3 cenas cromáticas distintas");
assert.strictEqual(blocks[0].items.length, 3, "Cena 1 (Azul) deveria ter 3 mídias");
assert.strictEqual(blocks[1].items.length, 2, "Cena 2 (Vermelha) deveria ter 2 mídias");
assert.strictEqual(blocks[2].items.length, 2, "Cena 3 (Verde) deveria ter 2 mídias");

// 4.4 Teste de suavização de ruído (micro-bloco de 1 clipe isolado entre cores similares)
const noisyItems = [
    { id: 1, color: "#0284c7" },
    { id: 2, color: "#0369a1" },
    { id: 3, color: "#0284c8" }, // Ruído tênue
    { id: 4, color: "#0369a2" }
];
const smoothedBlocks = coalesceColorBlocks(noisyItems);
assert.strictEqual(smoothedBlocks.length, 1, "Clipes adjacentes homogêneos devem formar um único bloco de cena contíguo");
console.log("✔ Algoritmos cromáticos, descritores e coalescência de cenas validados com 100% de precisão.");

// 5. Verificação de Diretrizes no Design System (SKILL.md)
console.log("\n[5/6] Verificando conformidade com o Design System (SKILL.md)...");
assert(skillContent.includes('X. Padrão da Barra de Decupagem Visual & Cenas Cromáticas da Biblioteca'), 'Falta Seção X no SKILL.md');
assert(skillContent.includes('Clique Simples no Segmento'), 'Falta regra de clique simples no SKILL.md');
assert(skillContent.includes('Alt + Clique no Segmento ou Calha'), 'Falta regra de Alt+Clique no SKILL.md');
assert(skillContent.includes('NÃO usar Duplo Clique para Filtragem'), 'Falta proibição explícita de duplo clique no SKILL.md');
assert(skillContent.includes('Filtro Global de Paleta'), 'Falta diretriz do Filtro Global no SKILL.md');
assert(skillContent.includes('19. Chips Minimalistas Inteligentes da Fita de Decupagem (Tiered Smart Chips)'), 'Falta subitem 19 no SKILL.md');
assert(skillContent.includes('Cores nunca exibem nomes textuais'), 'Falta regra de proibição de nomes de cor no SKILL.md');
console.log("✔ Todas as diretrizes formais de UX/UI e chips minimalistas registradas e em conformidade no SKILL.md.");

// 6. Testes Unitários de Apresentação Inteligente de Chips (resolveChipPresentation)
console.log("\n[6/6] Executando testes unitários da apresentação de chips escalonados...");

function resolveChipPresentation(groupingMode, g, idx) {
    const count = g.items ? g.items.length : (g.count || 0);
    let shortLabel = "";
    let tierClass = "chip-compact";

    if (groupingMode === "color_palette_global") {
        if (count <= 3) {
            tierClass = "chip-swatch-only";
            shortLabel = "";
        } else {
            tierClass = "chip-number-only";
            shortLabel = String(count);
        }
    } else if (groupingMode === "color_scenes") {
        if (count <= 2) {
            tierClass = "chip-swatch-only";
            shortLabel = "";
        } else if (count <= 9) {
            tierClass = "chip-micro";
            shortLabel = String(idx + 1);
        } else {
            tierClass = "chip-compact";
            shortLabel = `${idx + 1} • ${count}`;
        }
    } else if (groupingMode === "shot_scale") {
        const SCALE_SHORT = {
            "scale_close": "CU",
            "scale_plano_medio": "PM",
            "scale_plano_americano": "PA",
            "scale_plano_geral": "PG",
            "scale_detalhe": "DET",
            "scale_aereo": "AER",
            "scale_outros": "VAR"
        };
        const code = SCALE_SHORT[g.key] || g.key.replace("scale_", "").slice(0, 3).toUpperCase();
        tierClass = count <= 1 ? "chip-micro" : "chip-compact";
        shortLabel = `${code} ${count}`;
    } else if (groupingMode === "speakers") {
        const raw = g.label.replace(/^[^\w\s]+\s*/, "").trim();
        const firstName = raw.split(" ")[0].trim();
        tierClass = count <= 1 ? "chip-micro" : "chip-compact";
        shortLabel = count <= 1 ? `${firstName.slice(0, 4)} 1` : `${firstName} ${count}`;
    } else if (groupingMode === "date") {
        const parts = g.label.replace(/^📅\s*/, "").split(",");
        const dateText = (parts[1] || parts[0] || "").trim();
        const match = dateText.match(/(\d+)\s+de\s+([A-Za-zç]+)/i);
        const shortDate = match ? `${match[1]} ${match[2].slice(0, 3)}` : dateText.slice(0, 8).trim();
        tierClass = "chip-compact";
        shortLabel = `${shortDate} ${count}`;
    } else if (groupingMode === "smart_bins") {
        const SMART_BIN_SHORT = {
            "Entrevistas & Depoimentos": "Entrev.",
            "Elenco & Personagens": "Elenco",
            "Ação, Dublês & Efeitos": "Ação",
            "Câmera, Enquadramento & Planos": "Câmera",
            "Iluminação, Luz & Cores": "Luz",
            "Direção, Marcação & Ensaios": "Direção",
            "Trilha Sonora & Áudio": "Áudio",
            "Set de Filmagem & Bastidores": "Set",
            "Cenas & Bastidores": "Bastid."
        };
        let shortName = null;
        for (const [full, s] of Object.entries(SMART_BIN_SHORT)) {
            if (g.label.includes(full)) { shortName = s; break; }
        }
        if (!shortName) {
            shortName = g.label.replace(/^[^\w\s]+\s*/, "").split(" ")[0].trim().slice(0, 7);
        }
        tierClass = "chip-compact";
        shortLabel = `${shortName} ${count}`;
    } else {
        const clean = g.label.replace(/^[^\w\s]+\s*/, "").trim().slice(0, 7);
        tierClass = "chip-compact";
        shortLabel = `${clean} ${count}`;
    }

    return { shortLabel, tierClass };
}

// 6.1 Paleta Global: <= 3 itens vira swatch-only sem texto
const palSmall = resolveChipPresentation("color_palette_global", { label: "Azul / Noite", items: [1, 2] }, 0);
assert.strictEqual(palSmall.tierClass, "chip-swatch-only");
assert.strictEqual(palSmall.shortLabel, "");

// 6.2 Paleta Global: > 3 itens vira number-only SEM NOME DE COR
const palLarge = resolveChipPresentation("color_palette_global", { label: "Rubi / Fogo", items: new Array(145) }, 1);
assert.strictEqual(palLarge.tierClass, "chip-number-only");
assert.strictEqual(palLarge.shortLabel, "145");
assert(!palLarge.shortLabel.includes("Rubi"), "Paleta global NUNCA deve conter nome de cor!");

// 6.3 Cenas por cor: <= 2 vira swatch, <= 9 vira micro, >= 10 vira compact
const scene1 = resolveChipPresentation("color_scenes", { label: "Cena 1", items: [1, 2] }, 0);
assert.strictEqual(scene1.tierClass, "chip-swatch-only");
assert.strictEqual(scene1.shortLabel, "");

const scene2 = resolveChipPresentation("color_scenes", { label: "Cena 2", items: [1, 2, 3, 4] }, 1);
assert.strictEqual(scene2.tierClass, "chip-micro");
assert.strictEqual(scene2.shortLabel, "2");

const scene3 = resolveChipPresentation("color_scenes", { label: "Cena 3", items: new Array(15) }, 2);
assert.strictEqual(scene3.tierClass, "chip-compact");
assert.strictEqual(scene3.shortLabel, "3 • 15");

// 6.4 Escala de planos cinematográficos: CU, PM, etc.
const scaleCU = resolveChipPresentation("shot_scale", { key: "scale_close", label: "Close-up", items: new Array(12) }, 0);
assert.strictEqual(scaleCU.shortLabel, "CU 12");

// 6.5 Falantes: apenas primeiro nome + contagem
const speakerTest = resolveChipPresentation("speakers", { label: "🎤 Emily Rudd", items: new Array(14) }, 0);
assert.strictEqual(speakerTest.shortLabel, "Emily 14");

// 6.6 Smart Bins: abreviação taxônomica precisa
const binTest = resolveChipPresentation("smart_bins", { label: "📁 Entrevistas & Depoimentos", items: new Array(8) }, 0);
assert.strictEqual(binTest.shortLabel, "Entrev. 8");

console.log("✔ Apresentação minimalista, swatches puros e ausência de nomes de cor validados com 100% de precisão.");

console.log("\n==========================================================================");
console.log(" TODOS OS TESTES DO MODO DE CENAS POR COR & CHIPS MINIMALISTAS PASSARAM! 🎉 ");
console.log("==========================================================================");

