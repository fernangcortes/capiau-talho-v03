// ======================================================================
// Autoteste: Índice de Sequência (Sequence Index — Estágio 2A)
// Execução: node tests/autoteste_sequence_index.mjs
// ======================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TimelineSequenceState } from "../src/ui/js/timelineState.js";
import {
    FLASH_FRAME_MAX_FRAMES,
    isCutOffline,
    buildSequenceIndexRows,
    computeSequenceIndexSummary,
    filterSequenceIndexRows,
    exportSequenceIndexToCSV,
    jumpToSequenceIndexRow
} from "../src/ui/js/sequenceIndex.js";
import { TAB_NAMES, TAB_PANEL_IDS } from "../src/ui/js/dockModel.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(path.join(rootDir, ...p), "utf8");

console.log("=== INICIANDO AUTOTESTE: ÍNDICE DE SEQUÊNCIA (ESTÁGIO 2A) ===\n");

// ----------------------------------------------------------------------
// PARTE 1: Detecção de mídia offline (isCutOffline)
// ----------------------------------------------------------------------
console.log("--- PARTE 1: Detecção de mídia offline ---");
{
    const catalog = {
        allVideos: [
            { id: 10, title: "Entrevista Ana", offline: false },
            { id: 11, title: "Cena Rua", offline: true },
            { id: 12, title: "Sem Proxy", proxy_status: "missing" }
        ],
        allPhotos: [
            { id: 20, title: "Foto Set 01" },
            { id: 21, title: "Foto Perdida", missing: true }
        ]
    };

    assert.equal(isCutOffline({ type: "video", video_id: 10 }, catalog), false, "vídeo online não é offline");
    assert.equal(isCutOffline({ type: "video", video_id: 11 }, catalog), true, "vídeo com flag offline=true");
    assert.equal(isCutOffline({ type: "video", video_id: 12 }, catalog), true, "vídeo com proxy_status=missing");
    assert.equal(isCutOffline({ type: "video", video_id: 999 }, catalog), true, "vídeo ausente no catálogo é offline");
    assert.equal(isCutOffline({ type: "video", video_id: "sub_1", parent_video_id: 10 }, catalog), false, "subclipe cujo vídeo-pai está online");
    assert.equal(isCutOffline({ type: "video", video_id: 10, source_available: false }, catalog), true, "clipe marcado source_available=false");

    assert.equal(isCutOffline({ type: "photo", photo_id: 20 }, catalog), false, "foto online");
    assert.equal(isCutOffline({ type: "photo", photo_id: 21 }, catalog), true, "foto missing=true");
    assert.equal(isCutOffline({ type: "photo", photo_id: 999 }, catalog), true, "foto ausente no catálogo");

    // Clipes sintéticos nunca são offline
    assert.equal(isCutOffline({ type: "text", text: "GC Diretora" }, catalog), false, "texto nunca é offline");
    assert.equal(isCutOffline({ type: "video", kind: "adjustment" }, catalog), false, "camada de ajuste nunca é offline");
    assert.equal(isCutOffline({ type: "video", kind: "color_matte", color: "#000000" }, catalog), false, "color matte nunca é offline");
}
console.log("✔ 1 passou: isCutOffline cobre vídeo, subclipe, foto e clipes sintéticos.");

// ----------------------------------------------------------------------
// PARTE 2: Construção de linhas, diagnósticos, transições e marcadores
// ----------------------------------------------------------------------
console.log("\n--- PARTE 2: Construção de linhas e diagnósticos ---");
{
    assert.equal(FLASH_FRAME_MAX_FRAMES, 5, "limiar padrão de flash frame = 5 quadros");

    const seq = new TimelineSequenceState({ id: "seq_idx_test", name: "Corte Principal", fps: 24, headless: true });
    seq.setTracks([
        { id: "AI", name: "IA — Sugestões", kind: "ai", muted: false, locked: true, hidden: false },
        { id: "T1", name: "Títulos & GCs", kind: "text", muted: false, locked: false, hidden: false },
        { id: "V2", name: "B-Roll", kind: "video", muted: false, locked: false, hidden: false },
        { id: "V1", name: "Falas", kind: "video", muted: false, locked: false, hidden: false },
        { id: "A1", name: "Áudio Falas", kind: "audio", muted: true, locked: false, hidden: false }
    ]);

    const catalog = {
        allVideos: [
            { id: 1, title: "Depoimento Maria" },
            { id: 2, title: "Plano Detalhe Mãos", offline: true },
            { id: 3, title: "Fachada Oficina" }
        ],
        allPhotos: [
            { id: 50, title: "Still Claquete" }
        ]
    };

    // Clipe V1 normal + par A1 dessincronizado em +2 frames (em pista mutada!)
    // Clipe V2 flash frame (4 frames <= 5) e cor "amber"
    // Clipe V2 offline (48 frames) e desativado
    // Foto V2 (120 frames)
    // Texto T1 com subtext
    seq.setCuts([
        {
            id: "c_v1",
            type: "video",
            video_id: 1,
            track: "V1",
            timelineStartFrame: 0,
            inFrame: 0,
            outFrame: 72,
            in: 0,
            out: 3,
            link_id: "link_1",
            colorLabel: "violet"
        },
        {
            id: "c_a1",
            type: "audio",
            video_id: 1,
            track: "A1",
            timelineStartFrame: 2,
            inFrame: 0,
            outFrame: 70,
            in: 0,
            out: 70 / 24,
            link_id: "link_1",
            syncOffset: 2
        },
        {
            id: "c_flash",
            type: "video",
            video_id: 3,
            track: "V2",
            timelineStartFrame: 48,
            inFrame: 10,
            outFrame: 14,
            colorLabel: "amber"
        },
        {
            id: "c_off_dis",
            type: "video",
            video_id: 2,
            track: "V1",
            timelineStartFrame: 72,
            inFrame: 0,
            outFrame: 48,
            disabled: true
        },
        {
            id: "c_photo",
            type: "photo",
            photo_id: 50,
            track: "V2",
            timelineStartFrame: 120,
            inFrame: 0,
            outFrame: 120
        },
        {
            id: "c_text",
            type: "text",
            track: "T1",
            text: "Maria Silva",
            subtext: "Mestre Artesã",
            timelineStartFrame: 12,
            inFrame: 0,
            outFrame: 96
        }
    ], { silent: true });

    seq.transitions = [
        {
            id: "tr_1",
            type: "video_cross_dissolve",
            kind: "video",
            track: "V1",
            cutFrame: 72,
            clipAId: "c_v1",
            clipBId: "c_off_dis",
            durationFrames: 24,
            halfAFrames: 12,
            halfBFrames: 12,
            alignment: "center",
            curve: "linear"
        }
    ];

    seq.markers = [
        { id: "mk_ruler", frame: 24, label: "Entrada música", color: "#06b6d4", comment: "Sobe trilha" },
        { id: "mk_clip", frame: 80, label: "Ajustar corte", color: "#f43f5e", clipId: "c_off_dis", offsetFrame: 8 }
    ];

    const rows = buildSequenceIndexRows(seq, catalog);
    assert.equal(rows.length, 9, "6 clipes + 1 transição + 2 marcadores = 9 linhas");

    // Ordem cronológica por timelineInFrame e numeração contínua 1..9
    for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i].index, i + 1, `índice sequencial ${i + 1}`);
        if (i > 0) {
            assert.ok(rows[i].timelineInFrame >= rows[i - 1].timelineInFrame, "ordem cronológica crescente");
        }
    }

    const rowV1 = rows.find(r => r.targetId === "c_v1");
    assert.equal(rowV1.name, "Depoimento Maria");
    assert.equal(rowV1.timelineInTc, "00:00:00:00");
    assert.equal(rowV1.timelineOutTc, "00:00:03:00");
    assert.equal(rowV1.durationFrames, 72);
    assert.equal(rowV1.colorLabel?.id, "violet");
    assert.equal(rowV1.flags.outOfSync, true, "c_v1 tem par dessincronizado");
    assert.equal(rowV1.flags.syncOffsetFrames, -2);
    assert.equal(rowV1.flags.flashFrame, false);
    assert.equal(rowV1.flags.offline, false);

    const rowA1 = rows.find(r => r.targetId === "c_a1");
    assert.equal(rowA1.flags.mutedTrack, true, "A1 está mutada");
    assert.equal(rowA1.flags.mutedOrDisabled, true);
    assert.equal(rowA1.flags.outOfSync, true);
    assert.equal(rowA1.flags.syncOffsetFrames, 2);

    const rowFlash = rows.find(r => r.targetId === "c_flash");
    assert.equal(rowFlash.durationFrames, 4);
    assert.equal(rowFlash.flags.flashFrame, true, "4 quadros <= 5 dispara flashFrame");
    assert.equal(rowFlash.badges.some(b => b.kind === "flash" && b.text === "FLASH 4f"), true);

    const rowOff = rows.find(r => r.targetId === "c_off_dis");
    assert.equal(rowOff.flags.offline, true, "vídeo 2 está offline");
    assert.equal(rowOff.flags.disabledClip, true, "c_off_dis está desativado");
    assert.equal(rowOff.flags.mutedOrDisabled, true);

    const rowPhoto = rows.find(r => r.targetId === "c_photo");
    assert.equal(rowPhoto.mediaKind, "photo");
    assert.equal(rowPhoto.sourceInTc, "—");

    const rowText = rows.find(r => r.targetId === "c_text");
    assert.equal(rowText.mediaKind, "text");
    assert.equal(rowText.name, "Maria Silva");
    assert.ok(rowText.notes.includes("Mestre Artesã"));

    const rowTr = rows.find(r => r.entryType === "transition");
    assert.equal(rowTr.name, "Cross Dissolve");
    assert.equal(rowTr.timelineInFrame, 60);
    assert.equal(rowTr.durationFrames, 24);
    assert.ok(rowTr.notes.includes("Depoimento Maria"));

    const rowMkRuler = rows.find(r => r.targetId === "mk_ruler");
    assert.equal(rowMkRuler.trackId, "RÉGUA");
    assert.equal(rowMkRuler.colorLabel?.id, "cyan");

    const rowMkClip = rows.find(r => r.targetId === "mk_clip");
    assert.equal(rowMkClip.trackId, "V1");
    assert.equal(rowMkClip.colorLabel?.id, "rose");

    // Resumo
    const summary = computeSequenceIndexSummary(rows);
    assert.deepEqual(summary, {
        total: 9,
        clips: 6,
        transitions: 1,
        markers: 2,
        alerts: 4,
        offline: 1,
        flashFrames: 1,
        muted: 2,
        outOfSync: 2
    });
    console.log("✔ 2 passou: linhas, flags diagnósticas (offline, flash <=5f, mutado/desativado, sync A/V), transições, marcadores e resumo.");

    // ------------------------------------------------------------------
    // PARTE 3: Filtros combinados e busca textual
    // ------------------------------------------------------------------
    console.log("\n--- PARTE 3: Filtros e busca textual ---");
    assert.equal(filterSequenceIndexRows(rows, { filter: "all" }).length, 9);
    assert.equal(filterSequenceIndexRows(rows, { filter: "clips" }).length, 6);
    assert.equal(filterSequenceIndexRows(rows, { filter: "transitions" }).length, 1);
    assert.equal(filterSequenceIndexRows(rows, { filter: "markers" }).length, 2);
    assert.equal(filterSequenceIndexRows(rows, { filter: "alerts" }).length, 4);
    assert.equal(filterSequenceIndexRows(rows, { filter: "offline" }).length, 1);
    assert.equal(filterSequenceIndexRows(rows, { filter: "flash" }).length, 1);
    assert.equal(filterSequenceIndexRows(rows, { filter: "muted" }).length, 2);
    assert.equal(filterSequenceIndexRows(rows, { filter: "sync" }).length, 2);

    assert.equal(filterSequenceIndexRows(rows, { trackFilter: "V2" }).length, 2);
    assert.equal(filterSequenceIndexRows(rows, { trackFilter: "RÉGUA" }).length, 1);
    assert.equal(filterSequenceIndexRows(rows, { colorFilter: "amber" }).length, 1);
    assert.equal(filterSequenceIndexRows(rows, { colorFilter: "cyan" }).length, 1);

    // Busca sem acentos
    const qArtesa = filterSequenceIndexRows(rows, { query: "artesa" });
    assert.equal(qArtesa.length, 1);
    assert.equal(qArtesa[0].targetId, "c_text");

    // Busca combinada + filtro
    const qV1Offline = filterSequenceIndexRows(rows, { filter: "offline", trackFilter: "V1", query: "maos" });
    assert.equal(qV1Offline.length, 1);
    assert.equal(qV1Offline[0].targetId, "c_off_dis");
    console.log("✔ 3 passou: filtros por tipo, diagnóstico, pista, cor e busca sem acento.");

    // ------------------------------------------------------------------
    // PARTE 4: Exportação CSV
    // ------------------------------------------------------------------
    console.log("\n--- PARTE 4: Exportação CSV ---");
    const csvSampleRows = [
        {
            ...rowText,
            index: 1,
            name: 'Maria "Artesã", Cena 1',
            notes: "Linha 1, com vírgula"
        },
        {
            ...rowFlash,
            index: 2
        }
    ];
    const csv = exportSequenceIndexToCSV(csvSampleRows, { name: seq.name, fps: seq.fps });
    assert.ok(csv.startsWith("\uFEFF#,Tipo,Pista,Nome,Timeline IN,Timeline OUT,Duracao,Frames,Fonte IN,Fonte OUT,Cor,Status,Notas"), "BOM UTF-8 e cabeçalho exato");
    assert.ok(csv.includes('"Maria ""Artesã"", Cena 1"'), "aspas e vírgulas escapadas segundo RFC 4180");
    assert.ok(csv.includes("FLASH 4f"), "status diagnóstico incluído no CSV");
    console.log("✔ 4 passou: exportação CSV válida com BOM e escape.");

    // ------------------------------------------------------------------
    // PARTE 5: Salto para o corte / transição / marcador (jumpToSequenceIndexRow)
    // ------------------------------------------------------------------
    console.log("\n--- PARTE 5: Salto para o corte na timeline ---");
    let ensuredFrame = null;
    let flashedIds = null;
    const mockInteraction = {
        ensureFrameVisible: (f) => { ensuredFrame = f; },
        renderer: {
            flashMatchOccurrences: (ids) => { flashedIds = ids; },
            requestRedraw: () => {}
        }
    };

    // Saltar para clipe normal (V2 flash frame em 48)
    assert.equal(jumpToSequenceIndexRow(rowFlash, seq, { interaction: mockInteraction }), true);
    assert.equal(seq.playheadFrame, 48);
    assert.equal(seq.selectedClipId, "c_flash");
    assert.equal(ensuredFrame, 48);
    assert.deepEqual(flashedIds, ["c_flash"]);

    // Saltar para marcador na régua (frame 24)
    assert.equal(jumpToSequenceIndexRow(rowMkRuler, seq, { interaction: mockInteraction }), true);
    assert.equal(seq.playheadFrame, 24);
    assert.equal(seq.selectedMarkerIds.has("mk_ruler"), true);

    // Saltar para transição (cutFrame 72)
    assert.equal(jumpToSequenceIndexRow(rowTr, seq, { interaction: mockInteraction }), true);
    assert.equal(seq.playheadFrame, 72);
    assert.equal(seq.selectedTransitionId, "tr_1");
    console.log("✔ 5 passou: salto atualiza playheadFrame, seleciona clipe/marcador/transição e garante visibilidade.");
}

// ----------------------------------------------------------------------
// PARTE 6: Integração estrutural com UI e Dock / TabPanels
// ----------------------------------------------------------------------
console.log("\n--- PARTE 6: Integração estrutural na UI e TabPanels ---");
{
    assert.ok(TAB_NAMES.includes("index"), "dockModel.TAB_NAMES contém index");
    assert.ok(TAB_PANEL_IDS.includes("tabpanel-index"), "dockModel.TAB_PANEL_IDS contém tabpanel-index");

    const indexHtml = read("src", "ui", "index.html");
    const mainJs = read("src", "ui", "js", "main.js");
    const tabPanelsJs = read("src", "ui", "js", "tabPanels.js");
    const wmJs = read("src", "ui", "js", "workspaceManager.js");
    const panelHtml = read("src", "ui", "panel.html");
    const panelGroupHtml = read("src", "ui", "panel-group.html");
    const stylesCss = read("src", "ui", "styles.css");

    // Sem duplicata no HTML
    assert.equal(indexHtml.match(/id="sequence-index-container"/g)?.length, 1, "exatamente 1 container #sequence-index-container em index.html");
    assert.equal(indexHtml.match(/id="btn-tab-index"/g)?.length, 1, "exatamente 1 botão #btn-tab-index em #right-tabs");

    assert.ok(mainJs.includes('import { initSequenceIndex } from "./sequenceIndex.js"'), "main.js importa sequenceIndex.js");
    assert.ok(mainJs.includes("initSequenceIndex()"), "main.js inicializa SequenceIndex");
    assert.ok(mainJs.includes('index: document.getElementById("sequence-index-container")'), "main.js registra container no mapa rightContainers");

    assert.ok(tabPanelsJs.includes('container: "sequence-index-container"'), "tabPanels.js registra aba index");
    assert.ok(tabPanelsJs.includes('window.SEQUENCE_INDEX?.render'), "tabPanels.js renderiza index ao destacar/ativar");
    assert.ok(wmJs.includes('"tabpanel-index"'), "workspaceManager.js conhece tabpanel-index");
    assert.ok(panelHtml.includes('"tabpanel-index": "Índice"'), "panel.html tem título de tabpanel-index");
    assert.ok(panelGroupHtml.includes('"tabpanel-index": "Índice"'), "panel-group.html tem título de tabpanel-index");
    assert.ok(stylesCss.includes(".seq-index-table") && stylesCss.includes(".seq-index-row.is-selected"), "styles.css define estilos do Índice de Sequência");
}
console.log("✔ 6 passou: integração completa em index.html, main.js, dockModel, tabPanels, workspaceManager, popouts e CSS.");

console.log("\n=== AUTOTESTE ÍNDICE DE SEQUÊNCIA CONCLUÍDO COM SUCESSO ===");
