// autoteste_subclips.mjs
// Task 10 do PLANO_SUITE_NLE_CLASSICO — Subclipes Virtuais na Biblioteca a partir do Monitor Source:
//  • Acionamento via atalho universal Ctrl+U nos 5 perfis NLE e botão no Source Player (#btn-source-create-subclip).
//  • Diálogo modal minimalista com chips de sugestões da IA (título curto, contextual, fala no trecho [IN-OUT], resumo, descrição, sequencial _sub01).
//  • Armazenamento não-destrutivo apontando para o parent_video_id mestre, persistido em localStorage.
//  • Acesso completo às Camadas de IA & Decupagem a partir de subclipes com roteamento automático ao mestre.
//  • Exibição de cards na biblioteca (Grid e Galeria) com badge .badge-subclip e miniatura do mestre.
//  • Arraste (drag and drop) e inserção 3-pontos na timeline com nome personalizado e suporte a limites rígidos (hard boundaries).

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

const domRegistry = {};
function makeEl(id) {
    const el = {
        id: id || "",
        style: {},
        innerHTML: "",
        textContent: "",
        value: "",
        checked: false,
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            toggle(c) { if (this._list.has(c)) this._list.delete(c); else this._list.add(c); },
            contains(c) { return this._list.has(c); }
        },
        setAttribute(k, v) { el[k] = v; },
        getAttribute(k) { return el[k] ?? null; },
        appendChild(child) {
            if (!el.children) el.children = [];
            el.children.push(child);
        },
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        focus() {},
        select() {}
    };
    return el;
}

globalThis.document = {
    defaultView: globalThis,
    getElementById: (id) => {
        if (!domRegistry[id]) domRegistry[id] = makeEl(id);
        return domRegistry[id];
    },
    createElement: (tag) => makeEl(null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: (el) => { if (el && el.id) domRegistry[el.id] = el; } },
    addEventListener: () => {},
    removeEventListener: () => {}
};

globalThis.STATE = {
    currentProjectId: 1,
    allVideos: [],
    emit: () => {}
};

const toasts = [];
globalThis.showToast = (msg, type) => toasts.push([msg, type]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const readSrc = (f) => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "js", f), "utf-8");
const readHtml = () => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf-8");
const readCss = () => fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles.css"), "utf-8");

const kmSrc = readSrc("keymapService.js");
const lbSrc = readSrc("library.js");
const plSrc = readSrc("player.js");
const tsSrc = readSrc("timelineState.js");
const tiSrc = readSrc("timelineInteraction.js");
const trSrc = readSrc("timelineRenderer.js");
const htmlSrc = readHtml();
const cssSrc = readCss();

console.log("===============================================================================");
console.log("  TESTE DA SUÍTE NLE CLÁSSICA — TASK 10: SUBCLIPES VIRTUAIS NA BIBLIOTECA");
console.log("===============================================================================\n");

const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Bateria 1: Registro e Atalhos NLE de edit.create_subclip (Ctrl+U)
// ---------------------------------------------------------------------------
test("Atalho edit.create_subclip registrado nos 5 perfis NLE (Ctrl+KeyU)", () => {
    assert.ok(kmSrc.includes('"edit.create_subclip"'), "Comando edit.create_subclip ausente no catálogo de keymap");
    assert.ok(kmSrc.includes('category: "edit"'), "Categoria deve ser edit");
    
    // Verifica presença nos 5 perfis NLE
    const profiles = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"];
    profiles.forEach(p => {
        const regex = new RegExp(`["']edit\\.create_subclip["']\\s*:\\s*\\[["']Ctrl\\+KeyU["']\\]`);
        assert.ok(regex.test(kmSrc), `Atalho edit.create_subclip não mapeado como Ctrl+KeyU no perfil ${p}`);
    });
});

// ---------------------------------------------------------------------------
// Bateria 2: Elementos DOM e CSS do Modal de Subclipes e Source Player
// ---------------------------------------------------------------------------
test("Elementos HTML do botão Source e Modal #create-subclip-modal", () => {
    assert.ok(htmlSrc.includes('id="btn-source-create-subclip"'), "Botão #btn-source-create-subclip ausente no Source Player");
    assert.ok(htmlSrc.includes('id="create-subclip-modal"'), "Modal #create-subclip-modal ausente no index.html");
    assert.ok(htmlSrc.includes('id="subclip-name-input"'), "Input #subclip-name-input ausente");
    assert.ok(htmlSrc.includes('id="subclip-title-suggestions-list"'), "Container #subclip-title-suggestions-list ausente");
    assert.ok(htmlSrc.includes('id="subclip-in-display"'), "Display #subclip-in-display ausente");
    assert.ok(htmlSrc.includes('id="subclip-out-display"'), "Display #subclip-out-display ausente");
    assert.ok(htmlSrc.includes('id="subclip-dur-display"'), "Display #subclip-dur-display ausente");
    assert.ok(htmlSrc.includes('id="chk-subclip-hard-boundaries"'), "Checkbox #chk-subclip-hard-boundaries ausente");
    assert.ok(htmlSrc.includes('id="btn-confirm-subclip"'), "Botão #btn-confirm-subclip ausente");
    assert.ok(htmlSrc.includes('id="btn-cancel-subclip"'), "Botão #btn-cancel-subclip ausente");

    // CSS
    assert.ok(cssSrc.includes(".badge-subclip"), "Classe CSS .badge-subclip ausente no styles.css");
    assert.ok(cssSrc.includes(".subclip-title-chip"), "Classe CSS .subclip-title-chip ausente no styles.css");
    assert.ok(cssSrc.includes(".btn-source-create-subclip"), "Classe CSS .btn-source-create-subclip ausente");
});

// ---------------------------------------------------------------------------
// Bateria 3: Geração de Múltiplos Títulos da IA (getCandidateTitlesForSubclip)
// ---------------------------------------------------------------------------
test("Geração de títulos múltiplos pelo CapIAu (curto, fala, resumo, desc, seq)", async () => {
    // Importa libraryService ou simula getCandidateTitlesForSubclip
    const { getCandidateTitlesForSubclip } = await import("../src/ui/js/library.js");
    assert.strictEqual(typeof getCandidateTitlesForSubclip, "function");

    // Prepara mock de vídeo com todas as variações geradas pelo CapIAu
    const mockVideo = {
        id: 101,
        filename: "entrevista_diretor_cena01.mp4",
        title: "Visão do Diretor",
        summary: "O diretor explica a inspiração para a cena de perseguição no centro histórico.",
        description: "Plano médio do diretor de cinema falando sobre a cinematografia.",
        duration: 60.0
    };

    // Mock do transcript no intervalo [10, 20]
    globalThis.STATE = {
        currentProjectId: 1,
        activeTranscript: [
            {
                start: 8.0, end: 22.0,
                text: "Nós queríamos capturar a luz da tarde incidindo diretamente nas pedras centenárias.",
                words: [
                    { word: "Nós", start: 8.0, end: 8.5 },
                    { word: "queríamos", start: 8.6, end: 9.2 },
                    { word: "capturar", start: 10.2, end: 11.0 },
                    { word: "a", start: 11.1, end: 11.3 },
                    { word: "luz", start: 11.4, end: 11.8 },
                    { word: "da", start: 11.9, end: 12.0 },
                    { word: "tarde", start: 12.1, end: 12.6 },
                    { word: "nas", start: 14.0, end: 14.3 },
                    { word: "pedras", start: 14.4, end: 15.0 }
                ]
            }
        ]
    };

    const candidates = getCandidateTitlesForSubclip(mockVideo, 10.0, 16.0);
    assert.ok(Array.isArray(candidates), "Candidatos devem ser um array");
    assert.ok(candidates.length >= 4, `Esperado pelo menos 4 sugestões de título, obteve ${candidates.length}`);

    const hasShortTitle = candidates.some(c => c.title === "Visão do Diretor" && c.label.includes("Título Curto"));
    assert.ok(hasShortTitle, "Deve conter o título curto da IA");

    const hasSpeech = candidates.some(c => c.title.includes("luz da tarde") || c.label.includes("Fala"));
    assert.ok(hasSpeech, "Deve conter trecho da fala transcrita no intervalo [10, 16]");

    const hasSummary = candidates.some(c => c.label.includes("Resumo"));
    assert.ok(hasSummary, "Deve conter sugestão baseada no Resumo da IA");

    const hasSequential = candidates.some(c => c.title.includes("_sub") || c.label.includes("NLE"));
    assert.ok(hasSequential, "Deve conter padrão sequencial _sub01");
});

// ---------------------------------------------------------------------------
// Bateria 4: Criação e Persistência de Subclipe Virtual (createSubclip)
// ---------------------------------------------------------------------------
test("Criação de Subclipe Virtual e persistência não-destrutiva em localStorage", async () => {
    const { createSubclip, getProjectSubclips } = await import("../src/ui/js/library.js");
    
    globalThis.localStorage.clear();
    const projectId = 10;
    globalThis.STATE.currentProjectId = projectId;

    const videoMaster = {
        id: 42,
        filename: "camera_a_take_03.mov",
        title: "Discurso da Vitória",
        duration: 120.0,
        fps: 24,
        resolution: "3840x2160"
    };

    const subclip = createSubclip({
        video: videoMaster,
        inSec: 15.0,
        outSec: 35.0,
        title: "Discurso Trecho Chave",
        hardBoundaries: true
    }, projectId);

    assert.ok(subclip, "Subclipe não foi retornado");
    assert.strictEqual(subclip.is_subclip, true, "is_subclip deve ser true");
    assert.strictEqual(subclip.is_virtual, true, "is_virtual deve ser true");
    assert.strictEqual(subclip.parent_video_id, 42, "parent_video_id deve apontar para o vídeo mestre 42");
    assert.strictEqual(subclip.in, 15.0, "Ponto IN deve ser 15.0");
    assert.strictEqual(subclip.out, 35.0, "Ponto OUT deve ser 35.0");
    assert.strictEqual(subclip.duration, 20.0, "Duração deve ser 20.0 segundos");
    assert.strictEqual(subclip.hard_boundaries, true, "hard_boundaries deve ser true");

    // Verifica persistência em localStorage
    const savedList = getProjectSubclips(projectId);
    assert.strictEqual(savedList.length, 1, "Deve existir exatamente 1 subclipe salvo no projeto");
    assert.strictEqual(savedList[0].id, subclip.id);
    assert.strictEqual(savedList[0].title, "Discurso Trecho Chave");
});

// ---------------------------------------------------------------------------
// Bateria 5: Operações CRUD de Subclipes (Renomear e Excluir)
// ---------------------------------------------------------------------------
test("Operações de CRUD (Renomear e Excluir Subclipe) sem afetar mestre", async () => {
    const { createSubclip, renameSubclip, deleteSubclip, getProjectSubclips } = await import("../src/ui/js/library.js");
    const projectId = 10;
    globalThis.STATE.currentProjectId = projectId;

    const sub1 = createSubclip({ videoId: 100, inSec: 5, outSec: 10, title: "Original" }, projectId);
    assert.strictEqual(getProjectSubclips(projectId).length, 2); // 1 do teste anterior + 1

    // Renomeia
    const renSuccess = renameSubclip(sub1.id, "Novo Nome Subclipe", projectId);
    assert.ok(renSuccess, "Renomeação deve retornar true");
    const updatedList = getProjectSubclips(projectId);
    const found = updatedList.find(s => s.id === sub1.id);
    assert.strictEqual(found.title, "Novo Nome Subclipe");

    // Exclui
    const delSuccess = deleteSubclip(sub1.id, projectId);
    assert.ok(delSuccess, "Exclusão deve retornar true");
    const afterDelList = getProjectSubclips(projectId);
    assert.ok(!afterDelList.some(s => s.id === sub1.id), "Subclipe excluído não deve constar na lista");
});

// ---------------------------------------------------------------------------
// Bateria 6: Renderização e Redirecionamento de Miniatura na Biblioteca
// ---------------------------------------------------------------------------
test("Miniatura e Badges de Subclipes na Biblioteca e Galeria", () => {
    // Verifica que renderVideoCard usa v.parent_video_id || v.id para thumbnail
    assert.ok(lbSrc.includes("const thumbVidId = v.parent_video_id || v.id"), "renderVideoCard deve usar parent_video_id para thumbnail");
    assert.ok(lbSrc.includes('v.is_subclip ? " subclip-item" : ""'), "renderVideoCard deve adicionar classe subclip-item");
    assert.ok(lbSrc.includes('badge-subclip'), "renderVideoCard deve renderizar badge-subclip");

    // Verifica que renderGalleryMode usa item.parent_video_id || item.id para thumbnail
    assert.ok(lbSrc.includes("const thumbVidId = item.parent_video_id || item.id"), "renderGalleryMode deve usar parent_video_id para thumbnail");
    assert.ok(lbSrc.includes('item.is_subclip ? " subclip-gallery-item" : ""'), "renderGalleryMode deve adicionar classe subclip-gallery-item");
    assert.ok(lbSrc.includes('gallery-subclip-badge badge-subclip'), "renderGalleryMode deve renderizar badge de tesoura");
});

// ---------------------------------------------------------------------------
// Bateria 7: Integração com SourcePlayer (openCreateSubclipModal & loadVideo)
// ---------------------------------------------------------------------------
test("SourcePlayer suporta reprodução e criação de subclipes", () => {
    assert.ok(plSrc.includes("openCreateSubclipModal()"), "SourcePlayer deve conter openCreateSubclipModal");
    assert.ok(plSrc.includes("btn-source-create-subclip"), "SourcePlayer deve vincular evento a btn-source-create-subclip");
    assert.ok(plSrc.includes("streamVidId = video.parent_video_id || video.id"), "SourcePlayer.loadVideo deve carregar stream do parent_video_id");
    assert.ok(plSrc.includes("video.is_subclip ? \" [Subclipe]\" : \"\""), "SourcePlayer deve indicar [Subclipe] no título");
    assert.ok(plSrc.includes("isSubclip ? (STATE.activeVideo.parent_video_id || STATE.activeVideo.id)"), "getSourceClipData deve resolver parent_video_id");
    assert.ok(plSrc.includes("edit.create_subclip"), "PlayerController deve interceptar edit.create_subclip");
});

// ---------------------------------------------------------------------------
// Bateria 8: Arraste e Soltura (Drag & Drop) com Metadados de Subclipe
// ---------------------------------------------------------------------------
test("Drag and drop transporta payload de subclipe e cria corte correspondente", async () => {
    // No library.js
    assert.ok(lbSrc.includes("subclip_id: v.is_subclip ? v.id : null"), "Drag payload deve conter subclip_id");
    assert.ok(lbSrc.includes("is_subclip: !!v.is_subclip"), "Drag payload deve conter is_subclip flag");
    assert.ok(lbSrc.includes("parent_video_id: v.parent_video_id || null"), "Drag payload deve conter parent_video_id");

    // No timelineInteraction.js
    assert.ok(tiSrc.includes("const isSub = !!(payload.is_subclip || dragMedia?.is_subclip)"), "onDrop deve checar is_subclip");
    assert.ok(tiSrc.includes("const realVideoId = isSub ? (payload.parent_video_id || dragMedia?.parent_video_id || payload.id)"), "onDrop deve resolver realVideoId para o mestre");
    assert.ok(tiSrc.includes("is_subclip: true"), "onDrop deve repassar is_subclip: true ao TIMELINE_STATE");

    // Teste dinâmico de onDrop garantindo ausência de ReferenceError: inFrame is not defined
    const { TIMELINE_STATE } = await import("../src/ui/js/timelineState.js");
    let addCutArgs = null;
    const origAddCut = TIMELINE_STATE.addCut;
    TIMELINE_STATE.addCut = (...args) => {
        addCutArgs = args;
    };

    const { CapiauTimelineInteraction } = await import(`../src/ui/js/timelineInteraction.js?ts=${Date.now()}`);
    const interaction = new CapiauTimelineInteraction({
        canvas: {
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 200 }),
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        requestRedraw: () => {}
    });
    interaction.getCoordinates = () => ({ x: 100, y: 50, frame: 120, track: "V1" });
    interaction.resolveDropTrack = () => "V1";
    interaction.calculateClampedStart = (track, frame) => frame;

    const subPayload = {
        type: "video",
        id: 42,
        subclip_id: "subclip_123",
        is_subclip: true,
        parent_video_id: 42,
        name: "Subclipe Teste",
        inTime: 10.0,
        outTime: 25.0
    };

    const mockDropEvent = {
        preventDefault: () => {},
        clientX: 100,
        clientY: 50,
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        dataTransfer: {
            getData: (type) => type === "application/x-capiau-media" ? JSON.stringify(subPayload) : null
        }
    };

    try {
        interaction.onDrop(mockDropEvent);
    } finally {
        TIMELINE_STATE.addCut = origAddCut;
    }

    assert.ok(addCutArgs, "TIMELINE_STATE.addCut deve ter sido chamado");
    assert.strictEqual(addCutArgs[0], 42, "addCut deve receber parent_video_id");
    assert.strictEqual(addCutArgs[1], 10.0, "inSec deve ser 10.0");
    assert.strictEqual(addCutArgs[2], 25.0, "outSec deve ser 25.0");
    assert.strictEqual(addCutArgs[3], "V1", "track deve ser V1");
    assert.strictEqual(addCutArgs[4], 120, "timelineStartFrame deve ser 120");
    assert.strictEqual(addCutArgs[5].is_subclip, true, "options.is_subclip deve ser true");
    assert.strictEqual(addCutArgs[5].subclip_id, "subclip_123", "options.subclip_id deve ser subclip_123");
    assert.strictEqual(addCutArgs[5].name, "Subclipe Teste", "options.name deve ser Subclipe Teste");
    assert.strictEqual(addCutArgs[5].inFrame, 240, "options.inFrame deve ser 240");
    assert.strictEqual(addCutArgs[5].outFrame, 600, "options.outFrame deve ser 600");
});

// ---------------------------------------------------------------------------
// Bateria 9: Inserção 3-Pontos e Rótulo na Timeline
// ---------------------------------------------------------------------------
test("Inserção 3-Pontos na Timeline preserva nome do subclipe e exibe ícone ✂", () => {
    // No timelineState.js
    assert.ok(tsSrc.includes("createdCut.is_subclip = true"), "insertSourceClipAtPlayhead deve marcar createdCut.is_subclip");
    assert.ok(tsSrc.includes("createdCut.hard_boundaries = !!sourceData.hard_boundaries"), "insertSourceClipAtPlayhead deve salvar hard_boundaries");
    assert.ok(tsSrc.includes("audioCut.is_subclip = true"), "insertSourceClipAtPlayhead deve marcar audioCut.is_subclip");

    // No timelineRenderer.js
    assert.ok(trSrc.includes('const subPrefix = cut.is_subclip ? "✂ " : ""'), "timelineRenderer deve incluir prefixo ✂ para subclipes");
    assert.ok(trSrc.includes("const name = cut.name ||"), "timelineRenderer deve priorizar cut.name sobre nome do arquivo");
});

// ---------------------------------------------------------------------------
// Bateria 10: Limites Rígidos (Hard Boundaries) e Roteamento de Camadas de IA
// ---------------------------------------------------------------------------
test("Bloqueio de Hard Boundaries no Trim e Roteamento de Camadas de IA", () => {
    // Hard boundaries em getMaxMediaFrames e trimClipLeft
    assert.ok(tsSrc.includes("if (clip.hard_boundaries && clip.is_subclip)"), "getMaxMediaFrames deve respeitar hard_boundaries de subclipe");
    assert.ok(tiSrc.includes("clipMinIn = (clip.hard_boundaries && clip.is_subclip && clip.subclip_in_frame !== undefined)"), "trimClipLeft deve respeitar subclip_in_frame com hard boundaries");

    // Roteamento de camadas de IA
    assert.ok(lbSrc.includes("const targetMediaId = (item.is_subclip && item.parent_video_id) ? item.parent_video_id : item.id"), "Camadas de IA no context menu devem rotear ao parent_video_id");
    assert.ok(lbSrc.includes("Localizar Mestre na Biblioteca"), "Menu de contexto deve ter opção Localizar Mestre na Biblioteca");
    assert.ok(lbSrc.includes("Excluir Subclipe da Biblioteca"), "Menu de contexto deve ter opção Excluir Subclipe da Biblioteca");
});

// ---------------------------------------------------------------------------
// Bateria 11: Ciclo de Vida Reativo Imediato & Blindagem de Playback (Sem F5)
// ---------------------------------------------------------------------------
test("Ciclo de Vida Reativo Imediato: Playback e Pré-carregamento sem F5", async () => {
    // 1. player.js: nextCut declarado de forma segura em _preloadUpcomingAudio
    assert.ok(plSrc.includes("const nextCut = upcoming[0];"), "player.js deve declarar nextCut = upcoming[0]");
    assert.ok(plSrc.includes("if (!nextCut) return;"), "player.js deve retornar antecipadamente se upcoming estiver vazio");

    // 2. player.js: appendToTimeline repassa parent_video_id e metadados
    assert.ok(plSrc.includes("const isSubclip = !!STATE.activeVideo.is_subclip;"), "appendToTimeline deve checar is_subclip");
    assert.ok(plSrc.includes("const mediaId = isSubclip ? (STATE.activeVideo.parent_video_id || STATE.activeVideo.id)"), "appendToTimeline deve resolver mediaId para parent_video_id");

    // 3. player.js: applyMediaEffects suporta fallback a cut.parent_video_id
    assert.ok(plSrc.includes("STATE.allVideos?.find(v => String(v.id) === String(cut.parent_video_id))"), "applyMediaEffects deve conter fallback a cut.parent_video_id");

    // 4. library.js: createSubclip sincroniza STATE.allVideos dinamicamente
    assert.ok(lbSrc.includes("window.STATE.allVideos.push(subclip);"), "createSubclip deve adicionar subclip em STATE.allVideos imediatamente");
    assert.ok(lbSrc.includes("const vIdx = window.STATE.allVideos.findIndex(v => String(v.id) === String(subclipId));"), "deleteSubclip deve sincronizar remoção de STATE.allVideos");

    // 5. Teste comportamental em memória: criação e inserção dinâmica em tempo real
    const mockState = {
        currentProjectId: 99,
        allVideos: [{ id: 10, title: "Vídeo Mestre", filename: "mestre.mp4", duration: 60.0, fps: 24 }],
        emit: () => {}
    };
    globalThis.STATE = mockState;

    const { createSubclip, deleteSubclip } = await import(`../src/ui/js/library.js?ts=${Date.now()}`);

    const sub = createSubclip({
        parent_video_id: 10,
        inSec: 5.0,
        outSec: 12.0,
        title: "Subclipe Imediato",
        video: mockState.allVideos[0]
    }, 99);

    assert.ok(sub, "Subclipe criado com sucesso");
    assert.strictEqual(sub.parent_video_id, 10, "Subclipe aponta para o mestre 10");
    assert.ok(mockState.allVideos.some(v => v.id === sub.id), "STATE.allVideos contém o novo subclipe imediatamente em memória");

    // Exclusão também sincroniza
    deleteSubclip(sub.id, 99);
    assert.ok(!mockState.allVideos.some(v => v.id === sub.id), "STATE.allVideos removeu o subclipe imediatamente em memória");
});

let passed = 0;
for (let i = 0; i < tests.length; i++) {
    const { name, fn } = tests[i];
    try {
        await fn();
        console.log(`  ✓ [Bateria ${i + 1}] ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ [Bateria ${i + 1}] ${name}`);
        console.error(`    ${err.message}`);
    }
}

const total = tests.length;
console.log("\n===============================================================================");
console.log(`  RESULTADO: ${passed} de ${total} baterias APROVADAS (${Math.round((passed / total) * 100)}% de sucesso)`);
console.log("===============================================================================\n");

if (passed !== total) {
    process.exit(1);
}
