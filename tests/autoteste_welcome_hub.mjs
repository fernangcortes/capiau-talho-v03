// ============================================================================
// Autoteste Automatizado: Welcome Hub & Chat Guiador (Requisito R1 / M1)
// Execução: node tests/autoteste_welcome_hub.mjs
// ============================================================================

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const _initialStorage = new Map();
if (!globalThis.localStorage) {
    globalThis.localStorage = {
        getItem: (k) => (_initialStorage.has(k) ? _initialStorage.get(k) : null),
        setItem: (k, v) => _initialStorage.set(k, String(v)),
        removeItem: (k) => _initialStorage.delete(k),
        clear: () => _initialStorage.clear()
    };
}
if (!globalThis.sessionStorage) {
    const _initialSession = new Map();
    globalThis.sessionStorage = {
        getItem: (k) => (_initialSession.has(k) ? _initialSession.get(k) : null),
        setItem: (k, v) => _initialSession.set(k, String(v)),
        removeItem: (k) => _initialSession.delete(k),
        clear: () => _initialSession.clear()
    };
}
if (!globalThis.window) {
    globalThis.window = globalThis;
}

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

console.log("=== INICIANDO AUTOTESTE: WELCOME HUB & CHAT GUIADOR ===\n");

// ---------------------------------------------------------------------------
// 1. Validação de Constantes, Estados da FSM e Perfis SOTA 2026
// ---------------------------------------------------------------------------
console.log("--- 1. Constantes e Perfis 2026 SOTA ---");

assert.deepEqual(Object.values(WELCOME_HUB_STATES), [
    "IDLE",
    "AWAITING_NAME",
    "AWAITING_PROFILE",
    "AWAITING_MEDIA",
    "CREATING_PROJECT",
    "READY_TO_TRANSITION",
    "COMPLETED"
], "FSM deve possuir exatamente os 7 estados especificados");

assert(WELCOME_HUB_PROFILES.doc_offline_eco, "Perfil doc_offline_eco deve existir");
assert(WELCOME_HUB_PROFILES.entrevista_agil, "Perfil entrevista_agil deve existir");
assert(WELCOME_HUB_PROFILES.cinema_nuvem_sota, "Perfil cinema_nuvem_sota deve existir");

// Verificação detalhada das calibrações de IA de cada perfil
const pDoc = WELCOME_HUB_PROFILES.doc_offline_eco;
assert.equal(pDoc.settings["llm.text_model"], "deepseek/deepseek-v4.1-flash");
assert.equal(pDoc.settings["vision.frame_interval"], 20);
assert.equal(pDoc.settings["timeline.max_suggestions"], 3);

const pEntrevista = WELCOME_HUB_PROFILES.entrevista_agil;
assert.equal(pEntrevista.settings["llm.text_model"], "deepseek/deepseek-v4.1-flash");
assert.equal(pEntrevista.settings["vision.frame_interval"], 10);
assert.equal(pEntrevista.settings["timeline.max_suggestions"], 5);

const pCinema = WELCOME_HUB_PROFILES.cinema_nuvem_sota;
assert.equal(pCinema.settings["llm.text_model"], "anthropic/claude-sonnet-5.5");
assert.equal(pCinema.settings["llm.vision_model"], "google/gemini-3.1-pro-preview");
assert.equal(pCinema.settings["vision.frame_interval"], 5);
assert.equal(pCinema.settings["timeline.max_suggestions"], 6);

console.log("✔ 1 passou: FSM e perfis SOTA 2026 válidos.");

// ---------------------------------------------------------------------------
// 2. Validação do Formatador de Markdown Seguro
// ---------------------------------------------------------------------------
console.log("\n--- 2. Formatação Segura de Markdown ---");
const formatted = formatMessageContent("Olá **CapIAu**! Teste `código` & <script>alert(1)</script>\nNova linha");
assert(formatted.includes("<strong>CapIAu</strong>"), "Deve formatar negrito");
assert(formatted.includes("<code>código</code>"), "Deve formatar código");
assert(formatted.includes("&lt;script&gt;"), "Deve escapar tags HTML perigosas");
assert(formatted.includes("<br>"), "Deve converter quebras de linha");
console.log("✔ 2 passou: Formatação de markdown e escape seguro.");

// ---------------------------------------------------------------------------
// 3. Mocks e Simulação de Ambiente de Execução
// ---------------------------------------------------------------------------
function createMockEnvironment() {
    const emittedEvents = [];
    const storageMap = new Map();
    const sessionMap = new Map();

    const mockStorage = {
        getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
        setItem: (k, v) => storageMap.set(k, String(v)),
        removeItem: (k) => storageMap.delete(k)
    };

    const mockSession = {
        getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
        setItem: (k, v) => sessionMap.set(k, String(v)),
        removeItem: (k) => sessionMap.delete(k)
    };

    const mockState = {
        _currentProjectId: 1,
        _chatHistory: [],
        get currentProjectId() { return this._currentProjectId; },
        set currentProjectId(v) {
            this._currentProjectId = Number(v);
            this.emit("projectChanged", this._currentProjectId);
        },
        get chatHistory() { return this._chatHistory; },
        set chatHistory(v) {
            this._chatHistory = v;
        },
        emit(event, data) {
            emittedEvents.push({ event, data });
        }
    };

    const createdProjects = [];
    const updatedSettings = [];
    const externalIngests = [];
    const externalFilesIngests = [];

    const mockApi = {
        async createProject(name, description) {
            const newId = 100 + createdProjects.length + 1;
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
            return { task_id: "task_ingest_dir_1", status: "queued" };
        },
        async triggerExternalFilesIngest(paths, projectId) {
            externalFilesIngests.push({ paths, projectId });
            return { task_id: "task_ingest_files_1", status: "queued" };
        },
        async fetchProjects() {
            return [
                { id: 1, name: "Making Of Histórico", description: "Doc antigo" },
                { id: 2, name: "Curta Metragem Sertão", description: "Ficção" }
            ];
        }
    };

    // Mock simples de elementos do DOM
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
            if (!mockElements.has(id)) {
                return createMockElement(id);
            }
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
        dispatchEvent(e) {
            emittedEvents.push({ event: e.type });
        }
    };

    // Atribuição de storages globais no contexto do teste
    globalThis.localStorage = mockStorage;
    globalThis.sessionStorage = mockSession;

    return {
        mockState,
        mockApi,
        mockDocument,
        mockWindow,
        emittedEvents,
        createdProjects,
        updatedSettings,
        externalIngests,
        externalFilesIngests,
        storageMap,
        sessionMap
    };
}

// ---------------------------------------------------------------------------
// 4. Fluxo Completo da FSM: Nome -> Perfil -> Mídia (Skip) -> Transição NLE
// ---------------------------------------------------------------------------
console.log("\n--- 3. Fluxo Principal da FSM e Onboarding Conversacional ---");
{
    const env = createMockEnvironment();
    const hub = new WelcomeHub({
        state: env.mockState,
        api: env.mockApi,
        document: env.mockDocument,
        window: env.mockWindow
    });

    assert.equal(hub.state, WELCOME_HUB_STATES.IDLE, "Estado inicial deve ser IDLE");

    // Início do Onboarding
    hub.startOnboarding();
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "startOnboarding() deve transicionar para AWAITING_NAME");
    assert(hub.conversationHistory.length >= 1, "Deve adicionar mensagem de boas-vindas");
    assert.equal(hub.activeChips.length, 3, "Deve fornecer 3 sugestões iniciais de título");

    // Rejeição de nome vazio
    const emptyRes = await hub.handleUserInput("   ");
    assert.equal(emptyRes, false, "Input vazio deve ser rejeitado");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "Estado deve permanecer AWAITING_NAME");

    // Envio de nome válido
    const nameRes = await hub.handleUserInput("Cerrado Sagrado 4K");
    assert.equal(nameRes, true, "Nome válido deve ser aceito");
    assert.equal(hub.projectName, "Cerrado Sagrado 4K");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE, "Deve transicionar para AWAITING_PROFILE");
    assert.equal(hub.activeChips.length, 3, "Deve exibir chips dos 3 perfis de IA");

    // Rejeição de perfil inválido
    const invalidProfileRes = await hub.handleUserInput("perfil_inexistente");
    assert.equal(invalidProfileRes, false, "Perfil inexistente deve ser rejeitado");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE);

    // Seleção de perfil válido (Documentário Offline Econômico)
    const profileRes = await hub.handleUserInput("doc_offline_eco");
    assert.equal(profileRes, true);
    assert.equal(hub.selectedProfile.id, "doc_offline_eco");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA, "Deve transicionar para AWAITING_MEDIA");

    // Pular ingestão por enquanto
    const skipRes = await hub.handleUserInput("pular ingestão por enquanto");
    assert.equal(skipRes, true);
    assert.equal(hub.state, WELCOME_HUB_STATES.READY_TO_TRANSITION, "Criação concluída deve levar a READY_TO_TRANSITION");

    // Verifica que o projeto foi criado no banco
    assert.equal(env.createdProjects.length, 1);
    assert.equal(env.createdProjects[0].name, "Cerrado Sagrado 4K");
    assert.equal(hub.createdProjectId, env.createdProjects[0].project_id);

    // Verifica que as configurações de IA do perfil foram gravadas
    assert.equal(env.updatedSettings.length, 1);
    assert.equal(env.updatedSettings[0].projectId, hub.createdProjectId);
    assert.equal(env.updatedSettings[0].values["llm.text_model"], "deepseek/deepseek-v4.1-flash");
    assert.equal(env.updatedSettings[0].values["vision.frame_interval"], 20);

    // Transição para o NLE
    await hub.transitionToNLE();
    assert.equal(hub.state, WELCOME_HUB_STATES.COMPLETED, "Estado final deve ser COMPLETED");

    // Validação da sincronização de Estado e Histórico de Chat
    assert.equal(env.mockState.currentProjectId, hub.createdProjectId, "STATE.currentProjectId deve ser atualizado");
    assert(env.mockState.chatHistory.length > 3, "STATE.chatHistory deve conter histórico transferido");

    const lastMsg = env.mockState.chatHistory[env.mockState.chatHistory.length - 1];
    assert.equal(lastMsg.role, "assistant");
    assert(lastMsg.content.includes("Onboarding Concluído"), "Última mensagem deve ser resumo do onboarding");
    assert(lastMsg.content.includes("Cerrado Sagrado 4K"), "Resumo deve conter nome do projeto");
    assert(lastMsg.content.includes("Documentário Offline Econômico"), "Resumo deve conter perfil de IA");

    // Validação de emissão de eventos
    const rightTabEvent = env.emittedEvents.find(e => e.event === "rightTabChanged");
    assert(rightTabEvent, "Deve emitir evento rightTabChanged");
    assert.equal(rightTabEvent.data, "chat", "Aba da direita ativada deve ser 'chat'");

    const chatHistEvent = env.emittedEvents.find(e => e.event === "chatHistoryUpdated");
    assert(chatHistEvent, "Deve emitir evento chatHistoryUpdated");

    // Validação de persistência em LocalStorage
    assert.equal(env.storageMap.get("activeProjectId"), String(hub.createdProjectId));
    assert.equal(env.storageMap.get("active-right-tab"), "chat");
    assert.equal(env.sessionMap.get("capiau_welcome_seen"), "true");

    console.log("✔ 3 passou: Fluxo da FSM de ponta a ponta e sincronização com NLE.");
}

// ---------------------------------------------------------------------------
// 5. Ingestão de Mídias via TASK_MANAGER (Pasta e Arquivos)
// ---------------------------------------------------------------------------
console.log("\n--- 4. Ingestão de Mídias e Integração com TASK_MANAGER ---");
{
    // Teste com pasta externa
    const envFolder = createMockEnvironment();
    const hubFolder = new WelcomeHub({
        state: envFolder.mockState,
        api: envFolder.mockApi,
        document: envFolder.mockDocument,
        window: envFolder.mockWindow
    });

    hubFolder.startOnboarding();
    await hubFolder.handleUserInput("Doc Entrevistas");
    await hubFolder.handleUserInput("entrevista_agil");
    hubFolder.pendingFolder = "D:/Projetos/CartaoSD_01";
    await hubFolder.createProjectAndFinalize();

    assert.equal(envFolder.externalIngests.length, 1, "triggerExternalIngest deve ser disparado para pasta");
    assert.equal(envFolder.externalIngests[0].path, "D:/Projetos/CartaoSD_01");
    assert.equal(hubFolder.state, WELCOME_HUB_STATES.READY_TO_TRANSITION);

    // Teste com múltiplos arquivos
    const envFiles = createMockEnvironment();
    const hubFiles = new WelcomeHub({
        state: envFiles.mockState,
        api: envFiles.mockApi,
        document: envFiles.mockDocument,
        window: envFiles.mockWindow
    });

    hubFiles.startOnboarding();
    await hubFiles.handleUserInput("Doc Cinema");
    await hubFiles.handleUserInput("cinema_nuvem_sota");
    hubFiles.pendingFiles = ["D:/raw/clip01.mov", "D:/raw/clip02.mov", "D:/raw/audio.wav"];
    await hubFiles.createProjectAndFinalize();

    assert.equal(envFiles.externalFilesIngests.length, 1, "triggerExternalFilesIngest deve ser disparado para arquivos");
    assert.equal(envFiles.externalFilesIngests[0].paths.length, 3);
    assert.equal(hubFiles.state, WELCOME_HUB_STATES.READY_TO_TRANSITION);

    console.log("✔ 4 passou: Despacho de tarefas de ingestão de pastas e arquivos.");
}

// ---------------------------------------------------------------------------
// 6. Resolução Fuzzy de Perfis e Chips Interativos
// ---------------------------------------------------------------------------
console.log("\n--- 5. Resolução Inteligente de Perfis e Ações dos Chips ---");
{
    const env = createMockEnvironment();
    const hub = new WelcomeHub({
        state: env.mockState,
        api: env.mockApi,
        document: env.mockDocument,
        window: env.mockWindow
    });

    assert.equal(hub.resolveProfile("offline").id, "doc_offline_eco");
    assert.equal(hub.resolveProfile("econômico").id, "doc_offline_eco");
    assert.equal(hub.resolveProfile("agil").id, "entrevista_agil");
    assert.equal(hub.resolveProfile("entrevista").id, "entrevista_agil");
    assert.equal(hub.resolveProfile("cinema").id, "cinema_nuvem_sota");
    assert.equal(hub.resolveProfile("sota").id, "cinema_nuvem_sota");

    // Teste de ação do chip transition_nle
    hub.startOnboarding();
    await hub.handleUserInput("Projeto Teste");
    await hub.handleUserInput("cinema");
    await hub.handleUserInput("pular");

    assert.equal(hub.state, WELCOME_HUB_STATES.READY_TO_TRANSITION);
    await hub.handleChipClick({ action: "transition_nle" });
    assert.equal(hub.state, WELCOME_HUB_STATES.COMPLETED);

    console.log("✔ 5 passou: Resolução flexível de perfis e cliques nos chips.");
}

// ---------------------------------------------------------------------------
// 7. Hooks de Bypass Manual, Projetos Existentes e Reabertura
// ---------------------------------------------------------------------------
console.log("\n--- 6. Bypass Manual, Projetos Existentes e Reabertura ---");
{
    const env = createMockEnvironment();
    const hub = new WelcomeHub({
        state: env.mockState,
        api: env.mockApi,
        document: env.mockDocument,
        window: env.mockWindow
    });

    // Seleção de projeto existente
    hub.selectExistingProject(2);
    assert.equal(env.mockState.currentProjectId, 2);
    assert.equal(env.storageMap.get("activeProjectId"), "2");
    assert.equal(env.sessionMap.get("capiau_welcome_seen"), "true");

    // Reabertura pelo menu hook
    hub.show();
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "Reabertura deve reiniciar onboarding");

    console.log("✔ 6 passou: Bypass para editor, projetos existentes e reabertura via hook.");
}

// ---------------------------------------------------------------------------
// 8. Chat Inteligente: Perguntas do Usuário, Explicações e Chave de API
// ---------------------------------------------------------------------------
console.log("\n--- 7. Chat Inteligente: Perguntas do Usuário, Explicações e Chave de API ---");
{
    const env = createMockEnvironment();
    let savedApiKey = null;
    let savedApiProvider = null;
    let chatCalls = [];

    env.mockApi.saveOnboardingApiKey = async (provider, key) => {
        savedApiProvider = provider;
        savedApiKey = key;
        return { ok: true, provider, key_saved: true };
    };

    env.mockApi.onboardingChat = async (message, history, currentProjectName, currentProfile) => {
        chatCalls.push({ message, history, currentProjectName, currentProfile });
        const lower = message.toLowerCase();
        if (lower.includes("explique") || lower.includes("isso aqui") || lower.includes("como funciona")) {
            return {
                reply: "O **CapIAu-Talho** é uma ilha de edição NLE com IA integrada...",
                suggested_project_name: null,
                detected_profile: null,
                step: "discussing",
                chips: [
                    { label: "Documentário Raízes", value: "Documentário Raízes" },
                    { label: "⏭️ Pular para o Editor", action: "skip_nle" }
                ]
            };
        }
        if (lower.includes("sertão profundo")) {
            return {
                reply: "Excelente título: **Sertão Profundo**!",
                suggested_project_name: "Sertão Profundo",
                detected_profile: null,
                step: "name_set",
                chips: [
                    { label: "🍃 Documentário Offline Econômico", value: "doc_offline_eco" }
                ]
            };
        }
        if (lower.includes("doc_offline_eco")) {
            return {
                reply: "Perfil Offline Econômico ativado!",
                suggested_project_name: currentProjectName,
                detected_profile: "doc_offline_eco",
                step: "profile_set",
                chips: [
                    { label: "⏭️ Pular Ingestão por Enquanto", action: "skip_media" }
                ]
            };
        }
        return {
            reply: "Entendido.",
            suggested_project_name: currentProjectName,
            detected_profile: currentProfile,
            step: "discussing"
        };
    };

    const hub = new WelcomeHub({
        state: env.mockState,
        api: env.mockApi,
        document: env.mockDocument,
        window: env.mockWindow
    });

    hub.startOnboarding();
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME);

    // Teste 7.1: Usuário pergunta "me explique melhor isso aqui"
    // Não deve assumir como título do projeto!
    const questionRes = await hub.handleUserInput("me explique melhor isso aqui");
    assert.equal(questionRes, true, "Pergunta deve ser processada com sucesso");
    assert.notEqual(hub.projectName, "me explique melhor isso aqui", "NÃO deve definir pergunta como nome do projeto");
    assert.equal(hub.projectName, "", "projectName deve permanecer vazio");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_NAME, "Estado deve permanecer AWAITING_NAME");

    const lastMsgQuestion = hub.conversationHistory[hub.conversationHistory.length - 1];
    assert(lastMsgQuestion.content.includes("CapIAu-Talho"), "Resposta deve ser explicativa sobre o software");

    // Teste 7.2: Colagem direta de chave de API no chat
    const testKey = "sk-or-v1-abcdef0123456789abcdef0123456789";
    const keyRes = await hub.handleUserInput(testKey);
    assert.equal(keyRes, true, "Chave de API deve ser aceita e gravada");
    assert.equal(savedApiProvider, "openrouter");
    assert.equal(savedApiKey, testKey);
    assert.equal(hub.projectName, "", "Chave de API NÃO deve ser atribuída a projectName");

    // SEGURANÇA: Valida que a chave de API em texto puro NUNCA foi gravada no histórico
    const userMsgKey = hub.conversationHistory[hub.conversationHistory.length - 2];
    assert(!userMsgKey.content.includes(testKey), "Chave de API em texto puro NUNCA deve ser gravada no histórico do chat");
    assert(userMsgKey.content.includes("protegida contra exposição"), "Mensagem do usuário deve ser mascarada");

    const lastMsgKey = hub.conversationHistory[hub.conversationHistory.length - 1];
    assert(lastMsgKey.content.includes("Chave de API (OpenRouter) configurada"), "Deve confirmar configuração da chave");

    // Teste 7.3: Sub-modal dedicado e seguro de chaves de API
    await hub.openApiKeysModal();
    assert.equal(hub.modalApiKeys.style.display, "flex", "Sub-modal de chaves deve abrir com display flex");

    // Simula preenchimento seguro de chave Gemini pelo modal
    hub.inputGemini.value = "AIzaSyD-SecureModalKey123456789012345";
    await hub.saveApiKeysFromModal();
    assert.equal(savedApiProvider, "gemini");
    assert.equal(savedApiKey, "AIzaSyD-SecureModalKey123456789012345");
    assert.equal(hub.inputGemini.value, "", "Input deve ser limpo imediatamente após salvar por segurança");

    // Teste 7.4: Ação do chip open_api_keys
    hub.modalApiKeys.style.display = "none";
    await hub.handleChipClick({ action: "open_api_keys" });
    assert.equal(hub.modalApiKeys.style.display, "flex", "Chip com action open_api_keys deve abrir o submodal seguro");
    hub.closeApiKeysModal();
    assert.equal(hub.modalApiKeys.style.display, "none");

    // Teste 7.5: Nome válido via API inteligente
    const nameRes = await hub.handleUserInput("Sertão Profundo");
    assert.equal(nameRes, true);
    assert.equal(hub.projectName, "Sertão Profundo", "Título válido sugerido pela IA deve ser registrado");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_PROFILE);

    // Teste 7.6: Perfil válido via API inteligente
    const profRes = await hub.handleUserInput("doc_offline_eco");
    assert.equal(profRes, true);
    assert.equal(hub.selectedProfile.id, "doc_offline_eco");
    assert.equal(hub.state, WELCOME_HUB_STATES.AWAITING_MEDIA);

    // Teste 7.7: Fallback local inteligente quando api.onboardingChat não está definida
    const hubLocal = new WelcomeHub({
        state: env.mockState,
        api: { createProject: env.mockApi.createProject, updateProjectSettings: env.mockApi.updateProjectSettings },
        document: env.mockDocument,
        window: env.mockWindow
    });
    hubLocal.startOnboarding();
    const localQuestionRes = await hubLocal.handleUserInput("como funciona o programa?");
    assert.equal(localQuestionRes, true);
    assert.notEqual(hubLocal.projectName, "como funciona o programa?");
    assert.equal(hubLocal.projectName, "");
    assert.equal(hubLocal.state, WELCOME_HUB_STATES.AWAITING_NAME);

    console.log("✔ 7 passou: Inteligência conversacional, tratamento de dúvidas, painel seguro e privacidade de chaves API.");
}

console.log("\n=======================================================");
console.log("TODAS AS ASSERÇÕES DO WELCOME HUB PASSARAM COM SUCESSO!");
console.log("=======================================================");
