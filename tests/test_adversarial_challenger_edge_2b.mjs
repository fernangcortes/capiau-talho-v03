// ============================================================================
// Empirical Adversarial Challenge: UI FSM & Text-Based Editing Overlapping Speakers
// Challenger Agent: challenger_edge_2b
// Tests Requirements 1 & 2
// ============================================================================

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── 0. Polyfills de Ambiente para Execução Node.js ESM ─────────────────────────
const _storageMap = new Map();
globalThis.localStorage = {
    getItem: (k) => (_storageMap.has(k) ? _storageMap.get(k) : null),
    setItem: (k, v) => _storageMap.set(k, String(v)),
    removeItem: (k) => _storageMap.delete(k),
    clear: () => _storageMap.clear()
};

const _sessionMap = new Map();
globalThis.sessionStorage = {
    getItem: (k) => (_sessionMap.has(k) ? _sessionMap.get(k) : null),
    setItem: (k, v) => _sessionMap.set(k, String(v)),
    removeItem: (k) => _sessionMap.delete(k),
    clear: () => _sessionMap.clear()
};

globalThis.window = globalThis;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Carrega os módulos
const welcomeHubModule = await import(
    pathToFileURL(path.join(rootDir, "src", "ui", "js", "welcomeHub.js")).href
);
const {
    WELCOME_HUB_STATES,
    WELCOME_HUB_PROFILES,
    WelcomeHub,
    formatMessageContent
} = welcomeHubModule;

const panelsModule = await import(
    pathToFileURL(path.join(rootDir, "src", "ui", "js", "panels.js")).href
);
const {
    extractWordRangeFromSpans,
    detectConcurrentSpeakerTrack
} = panelsModule;

const timelineStateModule = await import(
    pathToFileURL(path.join(rootDir, "src", "ui", "js", "timelineState.js")).href
);
const { TIMELINE_STATE, TIMELINE_HISTORY } = timelineStateModule;

const stateModule = await import(
    pathToFileURL(path.join(rootDir, "src", "ui", "js", "state.js")).href
);
const { STATE } = stateModule;

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("▶ EMPIRICAL ADVERSARIAL CHALLENGE — challenger_edge_2b");
console.log("  Testing UI FSM, Ingestion Data Flows & Text-Based Editing Overlapping Speakers");
console.log("════════════════════════════════════════════════════════════════════════════\n");

function createMockEnvironment(apiOverrides = {}) {
    const emittedEvents = [];
    const createdProjects = [];
    const updatedSettings = [];
    const externalIngests = [];
    const externalFilesIngests = [];

    const mockState = {
        _currentProjectId: 1,
        _chatHistory: [],
        get currentProjectId() { return this._currentProjectId; },
        set currentProjectId(v) {
            this._currentProjectId = Number(v);
            this.emit("projectChanged", this._currentProjectId);
        },
        get chatHistory() { return this._chatHistory; },
        set chatHistory(v) { this._chatHistory = v; },
        emit(event, data) { emittedEvents.push({ event, data }); }
    };

    const mockApi = {
        async createProject(name, description) {
            const newId = 200 + createdProjects.length + 1;
            const record = { project_id: newId, id: newId, name, description };
            createdProjects.push(record);
            return record;
        },
        async updateProjectSettings(projectId, values) {
            updatedSettings.push({ projectId, values });
            return { ok: true };
        },
        async triggerExternalIngest(path, projectId) {
            externalIngests.push({ path, projectId });
            return { task_id: "task_ingest_dir_test", status: "queued" };
        },
        async triggerExternalFilesIngest(paths, projectId) {
            externalFilesIngests.push({ paths, projectId });
            return { task_id: "task_ingest_files_test", status: "queued" };
        },
        async fetchProjects() {
            return [{ id: 1, name: "Projeto Teste", description: "Doc" }];
        },
        ...apiOverrides
    };

    const mockElements = new Map();
    function createMockElement(id) {
        const el = {
            id,
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            value: "",
            innerHTML: "",
            children: [],
            appendChild(child) { this.children.push(child); return child; },
            addEventListener() {},
            click() {},
            focus() {}
        };
        mockElements.set(id, el);
        return el;
    }

    const mockDocument = {
        getElementById(id) {
            if (!mockElements.has(id)) return createMockElement(id);
            return mockElements.get(id);
        },
        createElement(tag) {
            return {
                tagName: tag,
                style: {},
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    contains(c) { return this._classes.has(c); }
                },
                innerHTML: "",
                children: [],
                appendChild(c) { this.children.push(c); return c; },
                addEventListener() {},
                click() {}
            };
        }
    };

    const mockWindow = {
        dispatchEvent(e) { emittedEvents.push({ event: e.type }); }
    };

    return {
        mockState,
        mockApi,
        mockDocument,
        mockWindow,
        emittedEvents,
        createdProjects,
        updatedSettings,
        externalIngests,
        externalFilesIngests
    };
}

let totalTests = 0;
let passedTests = 0;

const failedTestsList = [];

function runTest(name, fn) {
    totalTests++;
    try {
        fn();
        console.log(`  ✔ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✘ [FAIL] ${name}`);
        console.error(`    Assertion Error: ${err.message}`);
        failedTestsList.push({ name, error: err.message, stack: err.stack });
    }
}

async function runAsyncTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✔ [PASS] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✘ [FAIL] ${name}`);
        console.error(`    Assertion Error: ${err.message}`);
        failedTestsList.push({ name, error: err.message, stack: err.stack });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: WELCOME HUB FSM EDGE CASES
// ════════════════════════════════════════════════════════════════════════════
console.log("── SECTION 1: Welcome Hub FSM Edge Cases ──");

// 1.1 Empty and Whitespace-only Project Names
await runAsyncTest("FSM rejects empty strings, spaces, tabs, and newlines in project name", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();

    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME);

    // Empty string
    let res = await hub.handleUserInput("");
    assert.equal(res, false, "Empty string must return false");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "State must remain AWAITING_NAME");
    assert.equal(hub.projectName, "", "Project name must remain empty");

    // Whitespace only
    res = await hub.handleUserInput("    ");
    assert.equal(res, false, "Spaces must return false");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME);

    // Tabs and newlines
    res = await hub.handleUserInput("\t\n\r  \t\n");
    assert.equal(res, false, "Tabs/newlines must return false");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME);

    // null / undefined
    res = await hub.handleUserInput(null);
    assert.equal(res, false, "null must return false");
    res = await hub.handleUserInput(undefined);
    assert.equal(res, false, "undefined must return false");
});

// 1.2 Special Characters and Unicode Strings
await runAsyncTest("FSM accepts and sanitizes special characters, unicode, emojis, and XSS vectors", async () => {
    const testCases = [
        "<script>alert('xss')</script>",
        "🎬 \"Cine & Sertão\" 🎥 — Água, Açúcar & Canavial (100% Baiano) 漢字 ⚡",
        "!@#$%^&*()_+=-~`{}[]|\\:;\"'<>,.?/",
        "A".repeat(5000), // 5,000 characters stress
        "   Leading and trailing spaces   "
    ];

    for (const nameInput of testCases) {
        const env = createMockEnvironment();
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();

        const accepted = await hub.handleUserInput(nameInput);
        assert.equal(accepted, true, `Input "${nameInput.slice(0, 30)}..." should be accepted`);
        assert.equal(hub.projectName, nameInput.trim(), "Project name should be properly trimmed");
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE, "State should advance to AWAITING_PROFILE");

        // Verify HTML escaping in formatMessageContent
        const formatted = formatMessageContent(nameInput);
        assert.ok(!formatted.includes("<script>"), "HTML script tag must be escaped");
        if (nameInput.includes("<")) {
            assert.ok(formatted.includes("&lt;"), "< must be escaped as &lt;");
        }
        if (nameInput.includes("&") && !nameInput.includes("&lt;")) {
            assert.ok(formatted.includes("&amp;"), "& must be escaped as &amp;");
        }
    }
});

// 1.3 Rapid Double-Clicks on Intent Profile Chips and Transitions
await runAsyncTest("Rapid double-clicks on chips do not cause duplicate executions or invalid transitions", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();

    await hub.handleUserInput("Documentário Cerrado");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE);

    // Simulate rapid simultaneous double-click on intent profile chips
    const profileChip1 = { label: "doc_offline_eco", value: "doc_offline_eco" };
    const profileChip2 = { label: "cinema_nuvem_sota", value: "cinema_nuvem_sota" };

    const results = await Promise.all([
        hub.handleChipClick(profileChip1),
        hub.handleChipClick(profileChip2)
    ]);

    // One of them should have succeeded, state should be AWAITING_MEDIA (not corrupted)
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "State must be AWAITING_MEDIA after profile click");
    assert.ok(hub.selectedProfile !== null, "A valid profile must be selected");

    // Test rapid double-click on transition_nle
    hub.state = WELCOME_HUB_STATES.READY_TO_TRANSITION;
    hub.createdProjectId = 301;

    const transitionChip = { action: "transition_nle" };
    const tResults = await Promise.all([
        hub.handleChipClick(transitionChip),
        hub.handleChipClick(transitionChip)
    ]);

    assert.equal(hub.state, WELCOME_HUB_STATES.COMPLETED);
    // History should not contain duplicate summary
    const summaries = env.mockState.chatHistory.filter(m => m.content && m.content.includes("Onboarding Concluído"));
    assert.equal(summaries.length, 1, "Only one final summary message should exist in chat history");
});

// 1.4 Drag-and-Drop Ingestion with Corrupt Paths, Empty Arrays, and Mixed Folders/Files
await runAsyncTest("Drag-and-drop handles empty arrays, corrupt file paths, and mixed inputs gracefully", async () => {
    // 1.4.1 Empty file array in drop
    {
        const env = createMockEnvironment();
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();
        await hub.handleUserInput("Projeto Vazio");
        await hub.handleUserInput("doc_offline_eco");
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);

        // Drop with empty files
        const emptyDropEvent = {
            preventDefault() {},
            stopPropagation() {},
            dataTransfer: { files: [] }
        };
        await hub.handleDropFiles(emptyDropEvent);
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "Empty drop must not advance FSM");
        assert.equal(hub.pendingFiles.length, 0, "pendingFiles must remain empty");
    }

    // 1.4.2 Drop with null/corrupt dataTransfer
    {
        const env = createMockEnvironment();
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();
        await hub.handleUserInput("Projeto Null");
        await hub.handleUserInput("doc_offline_eco");

        const nullDropEvent = { preventDefault() {}, stopPropagation() {}, dataTransfer: null };
        await hub.handleDropFiles(nullDropEvent);
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);
    }

    // 1.4.3 Drop with exotic/corrupt file paths and objects
    {
        const env = createMockEnvironment();
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();
        await hub.handleUserInput("Projeto Corrompido");
        await hub.handleUserInput("doc_offline_eco");

        const weirdFiles = [
            { path: "C:/Videos/take_01.mov", name: "take_01.mov" },
            { path: "", name: "sem_path.mp4" }, // Empty path falls back to name
            { name: "apenas_nome.wav" }, // No path property
            { path: "C:/Volumes/SD_Card/Cenas & Cortes [4K] #01.mov", name: "Cenas & Cortes [4K] #01.mov" }
        ];

        const dropEvent = {
            preventDefault() {},
            stopPropagation() {},
            dataTransfer: { files: weirdFiles }
        };

        await hub.handleDropFiles(dropEvent);
        assert.equal(hub.state, WELCOME_HUB_STATES.READY_TO_TRANSITION, "Drop should advance to READY_TO_TRANSITION");
        assert.equal(hub.pendingFiles.length, 4, "All 4 files must be cataloged");
        assert.equal(env.externalFilesIngests.length, 1, "triggerExternalFilesIngest must be dispatched");
        assert.equal(env.externalFilesIngests[0].paths.length, 4);
    }

    // 1.4.4 API Error Recovery: Backend failure does not freeze UI
    {
        const failingApi = {
            async createProject() {
                throw new Error("SQLite disk I/O error or constraint violation");
            }
        };
        const env = createMockEnvironment(failingApi);
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();
        await hub.handleUserInput("Projeto Que Falha");
        await hub.handleUserInput("doc_offline_eco");

        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);
        await hub.handleUserInput("pular");

        // Should handle error gracefully
        assert.equal(hub.isProcessing, false, "isProcessing must be reset to false in finally block");
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "FSM should revert to AWAITING_NAME on error for retry");
        assert.ok(hub.activeChips.some(c => c.label === "Tentar Novamente"), "Should offer retry chip");
    }
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: TEXT-BASED EDITING WITH OVERLAPPING SPEAKERS
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── SECTION 2: Text-Based Editing with Overlapping Speakers ──");

// 2.1 Word Selection (extractWordRangeFromSpans) across Edge Cases
runTest("extractWordRangeFromSpans handles single, multi, malformed, and empty inputs", () => {
    // Null, undefined, empty array
    assert.equal(extractWordRangeFromSpans([]), null);
    assert.equal(extractWordRangeFromSpans(null), null);
    assert.equal(extractWordRangeFromSpans(undefined), null);

    // Normal multi-word selection
    const normalSpans = [
        { dataset: { start: "1.00", end: "1.50" }, textContent: "O" },
        { dataset: { start: "1.52", end: "2.10" }, textContent: "cinema" },
        { dataset: { start: "2.15", end: "2.80" }, textContent: "brasileiro" }
    ];
    const resNormal = extractWordRangeFromSpans(normalSpans);
    assert.equal(resNormal.inSec, 1.00);
    assert.equal(resNormal.outSec, 2.80);
    assert.equal(resNormal.wordCount, 3);
    assert.equal(resNormal.text, "O cinema brasileiro");
    assert.ok(Math.abs(resNormal.duration - 1.80) < 0.001);

    // Single span
    const singleSpan = [{ dataset: { start: "5.50", end: "6.00" }, textContent: "Corte" }];
    const resSingle = extractWordRangeFromSpans(singleSpan);
    assert.equal(resSingle.inSec, 5.50);
    assert.equal(resSingle.outSec, 6.00);
    assert.equal(resSingle.wordCount, 1);
    assert.equal(resSingle.text, "Corte");

    // getAttribute fallback
    const attrSpans = [
        { getAttribute: (k) => (k === "data-start" ? "12.0" : k === "data-end" ? "14.5" : null), textContent: "Documentário" }
    ];
    const resAttr = extractWordRangeFromSpans(attrSpans);
    assert.equal(resAttr.inSec, 12.0);
    assert.equal(resAttr.outSec, 14.5);

    // Property fallback (start_time, end_time, word)
    const propSpans = [
        { start_time: 20.0, end_time: 21.0, word: "Fala" },
        { start_time: 21.0, end_time: 22.5, word: "concorrente" }
    ];
    const resProp = extractWordRangeFromSpans(propSpans);
    assert.equal(resProp.inSec, 20.0);
    assert.equal(resProp.outSec, 22.5);
    assert.equal(resProp.text, "Fala concorrente");
});

// 2.2 Concurrent Speaker Track Detection (detectConcurrentSpeakerTrack)
runTest("detectConcurrentSpeakerTrack correctly distinguishes sequential vs concurrent speakers", () => {
    const spk1A = { speaker_id: "spk_diretora", start_time: 10.0, end_time: 15.0 };
    const spk2Sequential = { speaker_id: "spk_montador", start_time: 15.0, end_time: 20.0 };
    const spk2Overlap = { speaker_id: "spk_montador", start_time: 12.5, end_time: 16.0 };
    const spk1SameOverlap = { speaker_id: "spk_diretora", start_time: 14.0, end_time: 18.0 };

    // Null previous dialogue -> defaults to A1
    const resNull = detectConcurrentSpeakerTrack(spk1A, null);
    assert.equal(resNull.isConcurrent, false);
    assert.equal(resNull.audioTrackId, "A1");
    assert.equal(resNull.speakerOrder, 1);

    // Sequential different speakers -> A1
    const resSeq = detectConcurrentSpeakerTrack(spk2Sequential, spk1A);
    assert.equal(resSeq.isConcurrent, false);
    assert.equal(resSeq.audioTrackId, "A1");
    assert.equal(resSeq.speakerOrder, 1);

    // Overlapping different speakers -> A2 (concorrência confirmada)
    const resOverlap = detectConcurrentSpeakerTrack(spk2Overlap, spk1A);
    assert.equal(resOverlap.isConcurrent, true, "Different speaker starting before previous ends must be concurrent");
    assert.equal(resOverlap.audioTrackId, "A2", "Concurrent speaker must route to A2");
    assert.equal(resOverlap.speakerOrder, 2);

    // Overlapping same speaker -> A1 (continuação do mesmo locutor, não concorrência entre vozes)
    const resSame = detectConcurrentSpeakerTrack(spk1SameOverlap, spk1A);
    assert.equal(resSame.isConcurrent, false);
    assert.equal(resSame.audioTrackId, "A1");
    assert.equal(resSame.speakerOrder, 1);
});

// 2.3 Dispatch to A1 and A2 without Track Collisions
runTest("Speaker 1 and Speaker 2 are dispatched to A1 and A2 without track collisions", () => {
    STATE.activeTimelineCuts = [];
    TIMELINE_HISTORY.clear();
    TIMELINE_STATE.fps = 24;

    // Cenário: Locutor 1 e Locutor 2 falam simultaneamente entre 10.0s e 16.0s
    // Locutor 1: 10.0s a 15.0s -> Pista A1
    // Locutor 2: 12.0s a 16.0s -> Pista A2
    const cut1 = TIMELINE_STATE.insertSpeechCut(101, 10.0, 15.0, {
        speakerId: "spk_maria",
        isSecondary: false,
        audioTrackId: "A1",
        timelineStartFrame: 240 // 10.0s * 24fps
    });

    const cut2 = TIMELINE_STATE.insertSpeechCut(101, 12.0, 16.0, {
        speakerId: "spk_joao",
        isSecondary: true,
        isConcurrent: true,
        audioTrackId: "A2",
        timelineStartFrame: 288 // 12.0s * 24fps
    });

    assert.ok(cut1, "Cut 1 must exist");
    assert.ok(cut2, "Cut 2 must exist");
    assert.notEqual(cut1.id, cut2.id, "Cuts must have unique IDs");

    const allCuts = STATE.activeTimelineCuts || [];
    assert.ok(allCuts.length >= 2, "Both cuts must be registered in STATE.activeTimelineCuts");

    // Track isolation verification
    const a1Cuts = allCuts.filter(c => c.track === "A1");
    const a2Cuts = allCuts.filter(c => c.track === "A2");

    assert.equal(a1Cuts.length, 1, "Exactly one audio cut on track A1");
    assert.equal(a2Cuts.length, 1, "Exactly one audio cut on track A2");

    assert.equal(a1Cuts[0].audioTrackId || a1Cuts[0].track, "A1");
    assert.equal(a2Cuts[0].audioTrackId || a2Cuts[0].track, "A2");

    // Collision check: both cuts overlap in timeline frame range [288, 360]
    // 240 to 360 (A1) and 288 to 384 (A2)
    // They must co-exist on separate tracks without one truncating or overriding the other
    assert.equal(a1Cuts[0].track, "A1", "Cut 1 must strictly occupy track A1");
    assert.equal(a2Cuts[0].track, "A2", "Cut 2 must strictly occupy track A2");
    assert.notEqual(a1Cuts[0].track, a2Cuts[0].track, "NO TRACK COLLISION: Tracks must be distinct");

    // Test insertConcurrentSpeechPair coordinator
    STATE.activeTimelineCuts = [];
    TIMELINE_HISTORY.clear();

    const pair = TIMELINE_STATE.insertConcurrentSpeechPair(
        { videoId: 101, inSec: 50.0, outSec: 58.0, speakerId: "spk_alice" },
        { videoId: 101, inSec: 52.0, outSec: 56.0, speakerId: "spk_bob" },
        { timelineStartFrame: 1200 }
    );

    assert.equal(pair.length, 2, "Pair coordinator must return 2 cuts");
    assert.equal(pair[0].audioTrackId, "A1", "Pair speaker 1 routed to A1");
    assert.equal(pair[1].audioTrackId, "A2", "Pair speaker 2 routed to A2");

    const updatedCuts = STATE.activeTimelineCuts || [];
    const pairA1 = updatedCuts.filter(c => c.track === "A1");
    const pairA2 = updatedCuts.filter(c => c.track === "A2");

    assert.ok(pairA1.length >= 1, "Pair speaker 1 present on A1");
    assert.ok(pairA2.length >= 1, "Pair speaker 2 present on A2");
    assert.notEqual(pairA1[0].track, pairA2[0].track, "Concurrent pair has zero audio track collision");
});

console.log("\n════════════════════════════════════════════════════════════════════════════");
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTestsList.length}`);
if (failedTestsList.length > 0) {
    console.log("FAILED TESTS DETAILS:");
    failedTestsList.forEach((f, i) => {
        console.log(`  ${i + 1}. ${f.name} -> ${f.error}`);
    });
    process.exitCode = 1;
} else {
    console.log("ALL ADVERSARIAL CHALLENGES FOR UI FSM & OVERLAPPING SPEAKERS PASSED!");
}
console.log("════════════════════════════════════════════════════════════════════════════");
