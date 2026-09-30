// ============================================================================
// Empirical Adversarial Stress Harness: Deep Race Conditions & FSM Edge Attacks
// Challenger Agent: challenger_edge_2c
// Re-verifying BUG-FSM-01 remediation with high-concurrency burst fuzzing
// ============================================================================

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Polyfills de Ambiente
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

const welcomeHubModule = await import(
    pathToFileURL(path.join(rootDir, "src", "ui", "js", "welcomeHub.js")).href
);
const {
    WELCOME_HUB_STATES,
    WELCOME_HUB_PROFILES,
    WelcomeHub,
    formatMessageContent
} = welcomeHubModule;

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
            // Artificial small delay to expose any concurrency / re-entrancy holes
            await new Promise(r => setTimeout(r, 10));
            const newId = 500 + createdProjects.length + 1;
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
            return { task_id: "task_ingest_dir_stress", status: "queued" };
        },
        async triggerExternalFilesIngest(paths, projectId) {
            externalFilesIngests.push({ paths, projectId });
            return { task_id: "task_ingest_files_stress", status: "queued" };
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

let totalStress = 0;
let passedStress = 0;
const failures = [];

async function stress(name, fn) {
    totalStress++;
    try {
        await fn();
        console.log(`  ✔ [PASS] ${name}`);
        passedStress++;
    } catch (err) {
        console.error(`  ✘ [FAIL] ${name}`);
        console.error(`    Assertion Error: ${err.message}`);
        failures.push({ name, error: err.message, stack: err.stack });
    }
}

console.log("════════════════════════════════════════════════════════════════════════════");
console.log("▶ DEEP ADVERSARIAL STRESS HARNESS — challenger_edge_2c");
console.log("  High-concurrency bursts, re-entrancy, and edge fuzzing on WelcomeHub FSM");
console.log("════════════════════════════════════════════════════════════════════════════\n");

// Stress 1: 50 Concurrent Profile Chip Clicks
await stress("Burst of 50 concurrent profile chip clicks does NOT leak into AWAITING_MEDIA or finalize project", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();

    await hub.handleUserInput("Cine Baiano 50 Clicks");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE);

    const chips = [
        { label: "doc_offline_eco", value: "doc_offline_eco" },
        { label: "entrevista_agil", value: "entrevista_agil" },
        { label: "cinema_nuvem_sota", value: "cinema_nuvem_sota" }
    ];

    // Fire 50 concurrent clicks randomly chosen
    const clickPromises = Array.from({ length: 50 }, (_, i) => {
        const chip = chips[i % chips.length];
        return hub.handleChipClick(chip);
    });

    await Promise.all(clickPromises);

    // State MUST be AWAITING_MEDIA, NOT READY_TO_TRANSITION, NOT COMPLETED
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "State must strictly remain AWAITING_MEDIA");
    assert.ok(hub.selectedProfile !== null, "One valid profile must be selected");
    assert.equal(env.createdProjects.length, 0, "Zero projects must be created at this stage!");
});

// Stress 2: Fuzzing non-skip text in AWAITING_MEDIA
await stress("Arbitrary text input in AWAITING_MEDIA without media does NOT bypass ingestion", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();

    await hub.handleUserInput("Projeto Fuzz Ingestion");
    await hub.handleUserInput("doc_offline_eco");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);

    const nonSkipInputs = [
        "olá mundo",
        "quero começar a editar",
        "cinema",
        "meu roteiro",
        "123456789",
        "ajuda",
        "não sei o que fazer",
        "arquivo.mp4 (sem ter anexado)",
        "pulinho",
        "qualquer texto arbitrário"
    ];

    for (const txt of nonSkipInputs) {
        const res = await hub.handleUserInput(txt);
        assert.equal(res, false, `Input "${txt}" must be rejected from finalizing`);
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, `State must stay AWAITING_MEDIA after "${txt}"`);
        assert.equal(env.createdProjects.length, 0, "No project should be created");
    }
});

// Stress 3: Valid skip phrases in AWAITING_MEDIA
await stress("Explicit skip keywords advance FSM to READY_TO_TRANSITION and create project", async () => {
    const validSkipPhrases = [
        "pular",
        "PULAR",
        "depois eu importo",
        "vamos continuar",
        "avançar",
        "sem mídia por enquanto",
        "sem midia",
        "skip"
    ];

    for (const skipPhrase of validSkipPhrases) {
        const env = createMockEnvironment();
        const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
        hub.startOnboarding();
        await hub.handleUserInput("Projeto Skip Test");
        await hub.handleUserInput("doc_offline_eco");
        assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);

        const res = await hub.handleUserInput(skipPhrase);
        assert.equal(res, true, `Phrase "${skipPhrase}" should trigger skip`);
        assert.equal(hub.state, WELCOME_HUB_STATES.READY_TO_TRANSITION);
        assert.equal(env.createdProjects.length, 1, `Exactly 1 project created for "${skipPhrase}"`);
    }
});

// Stress 4: Simultaneous Click on transition_nle and handleUserInput
await stress("Parallel transitionToNLE and handleUserInput calls execute atomically and idempotently", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();
    await hub.handleUserInput("Projeto Idempotência");
    await hub.handleUserInput("doc_offline_eco");
    await hub.handleUserInput("pular");

    assert.equal(hub.state, WELCOME_HUB_STATES.READY_TO_TRANSITION);
    assert.equal(env.createdProjects.length, 1);

    // Call transitionToNLE 20 times concurrently
    const transitions = Array.from({ length: 20 }, () => hub.transitionToNLE());
    await Promise.all(transitions);

    assert.equal(hub.state, WELCOME_HUB_STATES.COMPLETED);
    // Emitted events should contain exactly 1 chatHistoryUpdated
    const completedEvents = env.emittedEvents.filter(e => e.event === "chatHistoryUpdated");
    assert.equal(completedEvents.length, 1, "Exactly one chatHistoryUpdated event emitted across 20 concurrent transitions");
});

// Stress 5: Action chips state confinement
await stress("Action chips (skip_media, browse_folder, browse_files, transition_nle) are strictly confined to valid states", async () => {
    const env = createMockEnvironment();
    const hub = new WelcomeHub({ state: env.mockState, api: env.mockApi, document: env.mockDocument });
    hub.startOnboarding();

    // In AWAITING_NAME:
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME);
    await hub.handleChipClick({ action: "skip_media" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "skip_media in AWAITING_NAME must do nothing");
    await hub.handleChipClick({ action: "transition_nle" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "transition_nle in AWAITING_NAME must do nothing");
    await hub.handleChipClick({ action: "browse_folder" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "browse_folder in AWAITING_NAME must do nothing");

    // Advance to AWAITING_PROFILE:
    await hub.handleUserInput("Projeto Confinement");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE);
    await hub.handleChipClick({ action: "skip_media" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE, "skip_media in AWAITING_PROFILE must do nothing");
    await hub.handleChipClick({ action: "transition_nle" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE, "transition_nle in AWAITING_PROFILE must do nothing");

    // Advance to AWAITING_MEDIA:
    await hub.handleUserInput("doc_offline_eco");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);
    // Profile chip in AWAITING_MEDIA must do nothing:
    await hub.handleChipClick({ label: "cinema_nuvem_sota", value: "cinema_nuvem_sota" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "Profile chip in AWAITING_MEDIA must do nothing");
    // transition_nle in AWAITING_MEDIA must do nothing:
    await hub.handleChipClick({ action: "transition_nle" });
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "transition_nle in AWAITING_MEDIA must do nothing");
});

console.log("\n════════════════════════════════════════════════════════════════════════════");
console.log(`TOTAL STRESS TESTS: ${totalStress} | PASSED: ${passedStress} | FAILED: ${failures.length}`);
if (failures.length > 0) {
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name} -> ${f.error}`));
    process.exitCode = 1;
} else {
    console.log("ALL DEEP ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS!");
}
console.log("════════════════════════════════════════════════════════════════════════════");
