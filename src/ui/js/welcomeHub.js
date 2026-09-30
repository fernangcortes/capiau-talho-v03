// ============================================================================
// CapIAu-Talho: Welcome Hub & Chat Guiador de Entrada (Requisito R1)
// Módulo ES puro responsável pelo onboarding conversacional, FSM de inicialização,
// seleção de perfis de IA 2026 SOTA e transição fluida para o NLE clássico.
// ============================================================================

import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

/** Estados da Máquina de Estados Finitos (FSM) do Onboarding */
export const WELCOME_HUB_STATES = Object.freeze({
    IDLE: "IDLE",
    AWAITING_NAME: "AWAITING_NAME",
    AWAITING_PROFILE: "AWAITING_PROFILE",
    AWAITING_MEDIA: "AWAITING_MEDIA",
    CREATING_PROJECT: "CREATING_PROJECT",
    READY_TO_TRANSITION: "READY_TO_TRANSITION",
    COMPLETED: "COMPLETED"
});

/** Matriz de Perfis de Intenção Conversacionais (2026 SOTA) */
export const WELCOME_HUB_PROFILES = Object.freeze({
    doc_offline_eco: {
        id: "doc_offline_eco",
        label: "Documentário Offline Econômico",
        badge: "Offline / Custo $0.00",
        icon: "fa-leaf",
        themeColor: "var(--color-emerald)",
        desc: "Triagem com Laya ONNX CPU local (22ms), visão YOLO-World v2, biometria SCRFD 512-d CPU e DeepSeek-V4.1 Flash. Custo zero de nuvem e privacidade máxima.",
        settings: {
            "llm.text_model": "deepseek/deepseek-v4-flash",
            "llm.vision_model": "google/gemini-2.5-flash",
            "vision.frame_interval": 20,
            "timeline.max_suggestions": 3,
            "timeline.max_candidate_videos": 15,
            "agent.max_steps": 5,
            "chat.search_limit": 10,
            "summary.transcript_max_chars": 15000
        }
    },
    entrevista_agil: {
        id: "entrevista_agil",
        label: "Entrevista Ágil",
        badge: "Equilibrado / Rápido",
        icon: "fa-bolt",
        themeColor: "var(--color-cyan)",
        desc: "Triagem dual (Laya local + escalação Sistema 2), Gemini 3.8 Flash, Nemotron 3 com fala sobreposta e DeepSeek-V4.1 Flash. Otimizado para agilidade jornalística.",
        settings: {
            "llm.text_model": "deepseek/deepseek-v4-flash",
            "llm.vision_model": "google/gemini-2.5-flash",
            "vision.frame_interval": 10,
            "timeline.max_suggestions": 5,
            "timeline.max_candidate_videos": 30,
            "agent.max_steps": 8,
            "chat.search_limit": 15,
            "summary.transcript_max_chars": 35000
        }
    },
    cinema_nuvem_sota: {
        id: "cinema_nuvem_sota",
        label: "Cinema Nuvem SOTA",
        badge: "Alta Fidelidade 2026",
        icon: "fa-film",
        themeColor: "var(--color-violet)",
        desc: "Triagem nuvem Jev RLCD, Gemini 3.8 Pro com bboxes canônicos, biometria Buffalo_l 512-d, áudio AssemblyAI 3.5 e Claude Sonnet 5.5. Máxima precisão cinematográfica.",
        settings: {
            "llm.text_model": "anthropic/claude-3.7-sonnet",
            "llm.vision_model": "google/gemini-2.5-pro",
            "vision.frame_interval": 5,
            "timeline.max_suggestions": 6,
            "timeline.max_candidate_videos": 45,
            "timeline.max_candidate_photos": 25,
            "agent.max_steps": 12,
            "chat.search_limit": 25,
            "summary.transcript_max_chars": 50000
        }
    }
});

/** Formata mensagem em Markdown simples com escape seguro de HTML */
export function formatMessageContent(text) {
    if (!text) return "";
    const escaped = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    return escaped
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`(.*?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
}

export class WelcomeHub {
    static STATES = WELCOME_HUB_STATES;
    static PROFILES = WELCOME_HUB_PROFILES;

    constructor(deps = {}) {
        this.stateObj = deps.state || STATE;
        this.api = deps.api || CapIAuAPI;
        this.document = deps.document || (typeof window !== "undefined" ? window.document : null);
        this.window = deps.window || (typeof window !== "undefined" ? window : null);

        // Estado interno do Onboarding
        this.state = WelcomeHub.STATES.IDLE;
        this.projectName = "";
        this.selectedProfile = null;
        this.pendingFiles = [];
        this.pendingFolder = null;
        this.createdProjectId = null;
        this.conversationHistory = [];
        this.activeChips = [];
        this.isProcessing = false;
        this.isTransitioning = false;

        // Referências DOM
        this.overlay = null;
        this.chatMessagesContainer = null;
        this.chipsContainer = null;
        this.chatInput = null;
        this.btnChatSend = null;
        this.dropzone = null;
        this.dropzoneFeedback = null;
        this.dropzoneCount = null;
        this.dropzoneSummary = null;
        this.btnBrowseFolder = null;
        this.btnBrowseFiles = null;
        this.btnSkipNLE = null;
        this.btnExistingProjects = null;
        this.modalExistingProjects = null;
        this.btnCloseProjectsModal = null;
        this.projectsListContainer = null;

        if (this.document) {
            this.bindElements();
            this.attachEventListeners();
        }
    }

    /** Associa elementos do DOM */
    bindElements() {
        if (!this.document) return;
        this.overlay = this.document.getElementById("welcome-hub-overlay");
        this.chatMessagesContainer = this.document.getElementById("welcome-chat-messages");
        this.chipsContainer = this.document.getElementById("welcome-chips-container");
        this.chatInput = this.document.getElementById("welcome-chat-input");
        this.btnChatSend = this.document.getElementById("btn-welcome-chat-send");
        this.dropzone = this.document.getElementById("welcome-dropzone");
        this.dropzoneFeedback = this.document.getElementById("welcome-dropzone-feedback");
        this.dropzoneCount = this.document.getElementById("welcome-files-count");
        this.dropzoneSummary = this.document.getElementById("welcome-files-summary-list");
        this.btnBrowseFolder = this.document.getElementById("btn-welcome-browse-folder");
        this.btnBrowseFiles = this.document.getElementById("btn-welcome-browse-files");
        this.btnSkipNLE = this.document.getElementById("btn-welcome-skip-nle");
        this.btnExistingProjects = this.document.getElementById("btn-welcome-existing-projects");
        this.modalExistingProjects = this.document.getElementById("welcome-existing-projects-modal");
        this.btnCloseProjectsModal = this.document.getElementById("btn-close-welcome-projects-modal");
        this.projectsListContainer = this.document.getElementById("welcome-projects-list");

        // Sub-Modal Seguro de Chaves de API
        this.btnWelcomeSettings = this.document.getElementById("btn-welcome-settings");
        this.modalApiKeys = this.document.getElementById("welcome-api-keys-modal");
        this.btnCloseKeysModal = this.document.getElementById("btn-close-welcome-keys-modal");
        this.btnCancelKeys = this.document.getElementById("btn-cancel-welcome-keys");
        this.btnSaveKeys = this.document.getElementById("btn-save-welcome-keys");
        this.btnFullSettings = this.document.getElementById("btn-welcome-open-full-settings");
        this.inputOpenRouter = this.document.getElementById("welcome-key-openrouter");
        this.inputGemini = this.document.getElementById("welcome-key-gemini");
        this.badgeOpenRouter = this.document.getElementById("badge-status-openrouter");
        this.badgeGemini = this.document.getElementById("badge-status-gemini");
        this.keysFeedback = this.document.getElementById("welcome-keys-feedback");
    }

    /** Conecta ouvintes de eventos da interface */
    attachEventListeners() {
        // Envio no chat (botão e Enter)
        if (this.btnChatSend) {
            this.btnChatSend.addEventListener("click", () => this.submitFromInput());
        }
        if (this.chatInput) {
            this.chatInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.submitFromInput();
                }
            });
        }

        // Pular onboarding para o editor clássico
        if (this.btnSkipNLE) {
            this.btnSkipNLE.addEventListener("click", () => {
                this.hide();
                if (typeof sessionStorage !== "undefined") {
                    sessionStorage.setItem("capiau_welcome_seen", "true");
                }
            });
        }

        // Sub-modal seguro de chaves de API
        if (this.btnWelcomeSettings) {
            this.btnWelcomeSettings.addEventListener("click", () => this.openApiKeysModal());
        }
        if (this.btnCloseKeysModal) {
            this.btnCloseKeysModal.addEventListener("click", () => this.closeApiKeysModal());
        }
        if (this.btnCancelKeys) {
            this.btnCancelKeys.addEventListener("click", () => this.closeApiKeysModal());
        }
        if (this.btnSaveKeys) {
            this.btnSaveKeys.addEventListener("click", () => this.saveApiKeysFromModal());
        }
        if (this.btnFullSettings) {
            this.btnFullSettings.addEventListener("click", () => this.openFullSettingsModal());
        }
        if (this.modalApiKeys) {
            this.modalApiKeys.addEventListener("click", (e) => {
                if (e.target === this.modalApiKeys) {
                    this.closeApiKeysModal();
                }
            });
        }

        // Alternar visibilidade de campos de chave de API
        if (this.document && typeof this.document.querySelectorAll === "function") {
            this.document.querySelectorAll(".btn-toggle-key-visibility").forEach(btn => {
                btn.addEventListener("click", () => {
                    const targetId = btn.dataset.target;
                    const inp = this.document.getElementById(targetId);
                    if (inp) {
                        const isPass = inp.type === "password";
                        inp.type = isPass ? "text" : "password";
                        const icon = btn.querySelector("i");
                        if (icon) {
                            icon.className = isPass ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
                        }
                    }
                });
            });
        }

        // Abrir sub-modal de projetos existentes
        if (this.btnExistingProjects) {
            this.btnExistingProjects.addEventListener("click", () => this.openExistingProjectsModal());
        }
        if (this.btnCloseProjectsModal) {
            this.btnCloseProjectsModal.addEventListener("click", () => this.closeExistingProjectsModal());
        }
        if (this.modalExistingProjects) {
            this.modalExistingProjects.addEventListener("click", (e) => {
                if (e.target === this.modalExistingProjects) {
                    this.closeExistingProjectsModal();
                }
            });
        }

        // Seletores nativos de pasta e arquivo
        if (this.btnBrowseFolder) {
            this.btnBrowseFolder.addEventListener("click", () => this.handleBrowseFolder());
        }
        if (this.btnBrowseFiles) {
            this.btnBrowseFiles.addEventListener("click", () => this.handleBrowseFiles());
        }

        // Drag & Drop na Dropzone do Hub
        if (this.dropzone) {
            this.dropzone.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dropzone.classList.add("dragover");
            });
            this.dropzone.addEventListener("dragleave", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dropzone.classList.remove("dragover");
            });
            this.dropzone.addEventListener("drop", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.dropzone.classList.remove("dragover");
                this.handleDropFiles(e);
            });
        }
    }

    /** Exibe o Welcome Hub Overlay em tela cheia */
    show() {
        if (this.overlay) {
            this.overlay.style.display = "flex";
            this.overlay.classList.remove("fade-out");
        }
        if (this.state === WelcomeHub.STATES.IDLE || this.state === WelcomeHub.STATES.COMPLETED) {
            this.startOnboarding();
        } else {
            this.renderMessages();
            this.renderChips();
        }
        if (this.chatInput) {
            setTimeout(() => this.chatInput?.focus(), 150);
        }
        if (typeof this.window?.dispatchEvent === "function" && typeof Event !== "undefined") {
            try {
                this.window.dispatchEvent(new Event("resize"));
            } catch (e) {}
        }
    }

    /** Oculta o Welcome Hub Overlay sem layout shift */
    hide() {
        if (this.overlay) {
            this.overlay.classList.add("fade-out");
            setTimeout(() => {
                this.overlay.style.display = "none";
                this.overlay.classList.remove("fade-out");
                if (typeof this.window?.dispatchEvent === "function" && typeof Event !== "undefined") {
                    try {
                        this.window.dispatchEvent(new Event("resize"));
                    } catch (e) {}
                }
            }, 350);
        }
    }

    /** Reinicia o estado da FSM e variáveis */
    reset() {
        this.state = WelcomeHub.STATES.IDLE;
        this.projectName = "";
        this.selectedProfile = null;
        this.pendingFiles = [];
        this.pendingFolder = null;
        this.createdProjectId = null;
        this.conversationHistory = [];
        this.activeChips = [];
        this.isProcessing = false;
        this.isTransitioning = false;

        if (this.dropzoneFeedback) {
            this.dropzoneFeedback.style.display = "none";
        }
        if (this.dropzoneSummary) {
            this.dropzoneSummary.innerHTML = "";
        }
        if (this.chatInput) {
            this.chatInput.value = "";
            this.chatInput.disabled = false;
        }
    }

    /** Inicia o fluxo conversacional guiado */
    startOnboarding() {
        this.reset();
        this.state = WelcomeHub.STATES.AWAITING_NAME;

        this.appendMessage({
            role: "assistant",
            content: "👋 Olá! Sou o Copilot de Inteligência Cinematográfica do CapIAu-Talho.\n\nVamos configurar sua nova produção audiovisual passo a passo. **Qual o título ou tema do seu projeto?**"
        });

        this.setChips([
            { label: "Documentário Raízes", value: "Documentário Raízes" },
            { label: "Entrevista de Campo", value: "Entrevista de Campo" },
            { label: "Making Of Oficial", value: "Making Of Oficial" }
        ]);
    }

    /** Adiciona mensagem ao histórico e atualiza a visualização */
    appendMessage(msg) {
        this.conversationHistory.push(msg);
        this.renderMessages();
    }

    /** Define chips ativos de resposta rápida */
    setChips(chips = []) {
        this.activeChips = chips;
        this.renderChips();
    }

    /** Lê input do usuário e processa na FSM */
    async submitFromInput() {
        if (!this.chatInput || this.isProcessing || this.isTransitioning) return;
        const text = this.chatInput.value.trim();
        if (!text) return;
        this.chatInput.value = "";
        await this.handleUserInput(text);
    }

    /** Processador principal de transições da FSM */
    async handleUserInput(input) {
        if (this.isProcessing || this.isTransitioning) return false;
        const text = String(input || "").trim();

        if (!text) {
            this.appendMessage({
                role: "assistant",
                content: "⚠️ Por favor, informe um título válido para o projeto."
            });
            return false;
        }

        // 1. Detecção de chave de API colada pelo usuário no chat
        const isApiKey = (text.startsWith("sk-or-v1-") || (text.startsWith("sk-") && text.length > 25)) ||
                         (text.startsWith("AIzaSy") && text.length >= 35);
        if (isApiKey) {
            // SEGURANÇA: Mascara a chave imediatamente e NUNCA salva o token bruto no histórico do chat
            this.appendMessage({ role: "user", content: "🔒 [Chave de API informada e protegida contra exposição]" });
            const provider = text.startsWith("sk-") ? "openrouter" : "gemini";
            try {
                if (this.api && typeof this.api.saveOnboardingApiKey === "function") {
                    await this.api.saveOnboardingApiKey(provider, text);
                }
                this.appendMessage({
                    role: "assistant",
                    content: `🔒 **Chave de API (${provider === "openrouter" ? "OpenRouter" : "Gemini"}) configurada com segurança no banco local!**\n\nPor proteção de privacidade, a chave foi mascarada e não foi salva no histórico do chat nem enviada a outros modelos. Se desejar gerenciar suas credenciais a qualquer momento com campos protegidos, use o botão **Chaves de API** no topo do Welcome Hub.\n\nQual o título ou tema do seu projeto?`
                });
                this.setChips([
                    { label: "🔑 Chaves de API & Modelos", action: "open_api_keys" },
                    { label: "Documentário Raízes", value: "Documentário Raízes" },
                    { label: "Entrevista de Campo", value: "Entrevista de Campo" }
                ]);
                return true;
            } catch (keyErr) {
                this.appendMessage({
                    role: "assistant",
                    content: `⚠️ Não foi possível salvar a chave de API: ${keyErr.message || keyErr}. Você pode tentar novamente ou usar o botão **Chaves de API** no topo.`
                });
                return false;
            }
        }

        // 2. Integração com a API OnboardingChat (Backend inteligente com conhecimento do Talho)
        if (this.api && typeof this.api.onboardingChat === "function") {
            this.isTransitioning = true;
            this.appendMessage({ role: "user", content: text });
            try {
                const chatRes = await this.api.onboardingChat(
                    text,
                    this.conversationHistory,
                    this.projectName || null,
                    this.selectedProfile?.id || null
                );

                if (chatRes && chatRes.reply) {
                    this.appendMessage({ role: "assistant", content: chatRes.reply });

                    if (chatRes.suggested_project_name && !this.projectName) {
                        this.projectName = chatRes.suggested_project_name;
                    }
                    if (chatRes.detected_profile) {
                        const prof = this.resolveProfile(chatRes.detected_profile);
                        if (prof) {
                            this.selectedProfile = prof;
                        }
                    }
                    if (Array.isArray(chatRes.chips) && chatRes.chips.length > 0) {
                        this.setChips(chatRes.chips);
                    }

                    if (chatRes.ready_to_create || chatRes.step === "ready") {
                        await this.createProjectAndFinalize();
                    } else if (this.projectName && !this.selectedProfile) {
                        this.state = WelcomeHub.STATES.AWAITING_PROFILE;
                    } else if (this.projectName && this.selectedProfile) {
                        this.state = WelcomeHub.STATES.AWAITING_MEDIA;
                    } else {
                        this.state = WelcomeHub.STATES.AWAITING_NAME;
                    }

                    if (chatRes.step === "awaiting_profile" && !chatRes.detected_profile) {
                        return false;
                    }
                    return true;
                }
            } catch (err) {
                console.warn("[WelcomeHub] Falha na API OnboardingChat, recorrendo ao motor local:", err);
            } finally {
                this.isTransitioning = false;
            }
        }

        // 3. Fallback inteligente local (quando sem backend / mock nos testes locais)
        const lower = text.toLowerCase();
        const isExplanationRequest = lower.includes("explique") || lower.includes("o que é") || 
                                     lower.includes("como funciona") || lower.includes("ajuda") || 
                                     lower.includes("isso aqui") || lower.includes("socorro") || 
                                     lower.includes("duvida") || lower.includes("dúvida") || 
                                     lower.endsWith("?");

        if (isExplanationRequest) {
            this.appendMessage({ role: "user", content: text });
            this.appendMessage({
                role: "assistant",
                content: "👋 **Com certeza! Vou te explicar exatamente como o CapIAu-Talho funciona:**\n\n" +
                         "O **CapIAu-Talho** é uma ilha de edição de vídeo (NLE) profissional desenhada sob medida para documentários e cinema autoral.\n\n" +
                         "• **⚡ Triagem Instantânea (Sistema 1):** Classifica suas gravações brutas em menos de 20ms com IA em CPU local.\n" +
                         "• **🎙️ Transcrição com Fala Sobreposta:** Identifica quem está falando mesmo quando duas pessoas falam ao mesmo tempo (*Nemotron 3 Diarization*).\n" +
                         "• **👁️ Busca Visual e Grounding:** Encontra personagens e adereços clicando no player do vídeo.\n" +
                         "• **🎬 Copilot de Montagem:** Sugere cortes preliminares (*rough cut*) com prévia em trilha fantasma para aprovação.\n\n" +
                         "Para começarmos, qual o **título ou tema do seu projeto**?"
            });
            this.setChips([
                { label: "Documentário Raízes", value: "Documentário Raízes" },
                { label: "Entrevista de Campo", value: "Entrevista de Campo" },
                { label: "Making Of Oficial", value: "Making Of Oficial" }
            ]);
            return this.state !== WelcomeHub.STATES.AWAITING_MEDIA;
        }

        switch (this.state) {
            case WelcomeHub.STATES.AWAITING_NAME: {
                this.isTransitioning = true;
                try {
                    this.projectName = text;
                    this.appendMessage({ role: "user", content: text });

                    // Transição para AWAITING_PROFILE
                    this.state = WelcomeHub.STATES.AWAITING_PROFILE;
                    this.appendMessage({
                        role: "assistant",
                        content: `Excelente título: **${this.projectName}**!\n\nPara calibrar o pipeline de IA e otimizar o uso de GPU e nuvem, **qual o perfil de intenção da produção?**`
                    });

                    this.setChips([
                        { label: "🍃 Documentário Offline Econômico", value: "doc_offline_eco" },
                        { label: "⚡ Entrevista Ágil", value: "entrevista_agil" },
                        { label: "🎬 Cinema Nuvem SOTA", value: "cinema_nuvem_sota" }
                    ]);
                    return true;
                } finally {
                    this.isTransitioning = false;
                }
            }

            case WelcomeHub.STATES.AWAITING_PROFILE: {
                const profile = this.resolveProfile(text);
                if (!profile) {
                    this.appendMessage({
                        role: "assistant",
                        content: "⚠️ Por favor, escolha um dos 3 perfis disponíveis clicando nos chips abaixo ou digitando seu nome."
                    });
                    return false;
                }

                this.isTransitioning = true;
                try {
                    this.selectedProfile = profile;
                    this.appendMessage({ role: "user", content: profile.label });

                    // Transição para AWAITING_MEDIA
                    this.state = WelcomeHub.STATES.AWAITING_MEDIA;
                    this.appendMessage({
                        role: "assistant",
                        content: `Perfil **${profile.label}** ativado!\n\n_${profile.desc}_\n\nAgora, **arraste para a área ao lado sua pasta de mídia bruta ou cartões SD**. Se preferir, podemos pular e importar depois diretamente no editor.`
                    });

                    this.setChips([
                        { label: "📁 Selecionar Pasta...", action: "browse_folder" },
                        { label: "🎬 Selecionar Arquivos...", action: "browse_files" },
                        { label: "⏭️ Pular Ingestão por Enquanto", action: "skip_media" }
                    ]);
                    return true;
                } finally {
                    this.isTransitioning = false;
                }
            }

            case WelcomeHub.STATES.AWAITING_MEDIA: {
                const lower = text.toLowerCase();
                const isSkip = lower.includes("pular") || lower.includes("depois") || lower.includes("continuar") || lower.includes("avançar") || lower.includes("sem mídia") || lower.includes("sem midia") || lower.includes("skip");

                if (isSkip) {
                    this.appendMessage({ role: "user", content: "Pular ingestão inicial por enquanto." });
                    await this.createProjectAndFinalize();
                    return true;
                }

                const hasMedia = Boolean(this.pendingFolder || (this.pendingFiles && this.pendingFiles.length > 0));
                if (hasMedia) {
                    this.appendMessage({ role: "user", content: text });
                    await this.createProjectAndFinalize();
                    return true;
                }

                this.appendMessage({
                    role: "assistant",
                    content: "Por favor, arraste suas pastas/arquivos de mídia ou clique em 'Pular Ingestão por Enquanto' para prosseguir."
                });
                return false;
            }

            case WelcomeHub.STATES.READY_TO_TRANSITION: {
                await this.transitionToNLE();
                return true;
            }

            default:
                return false;
        }
    }

    /** Resolve um perfil a partir de texto ou chave */
    resolveProfile(query) {
        if (!query) return null;
        const q = String(query).toLowerCase().trim();

        if (WelcomeHub.PROFILES[q]) {
            return WelcomeHub.PROFILES[q];
        }

        for (const key of Object.keys(WelcomeHub.PROFILES)) {
            const p = WelcomeHub.PROFILES[key];
            if (p.id.toLowerCase() === q || p.label.toLowerCase().includes(q)) {
                return p;
            }
        }

        if (q.includes("offline") || q.includes("econômico") || q.includes("economico") || q.includes("doc")) {
            return WelcomeHub.PROFILES.doc_offline_eco;
        }
        if (q.includes("entrevista") || q.includes("ágil") || q.includes("agil")) {
            return WelcomeHub.PROFILES.entrevista_agil;
        }
        if (q.includes("cinema") || q.includes("nuvem") || q.includes("sota")) {
            return WelcomeHub.PROFILES.cinema_nuvem_sota;
        }

        return null;
    }

    /** Cria o projeto no banco SQLite, aplica os settings e agenda ingestão assíncrona */
    async createProjectAndFinalize() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.state = WelcomeHub.STATES.CREATING_PROJECT;
        this.setChips([]);

        if (this.chatInput) this.chatInput.disabled = true;

        this.appendMessage({
            role: "assistant",
            content: `⚙️ Criando o projeto **${this.projectName}** no banco de dados SQLite e calibrando os motores de IA...`
        });

        try {
            // 1. Criação do Projeto
            const res = await this.api.createProject(this.projectName, `Criado via Welcome Hub (Perfil: ${this.selectedProfile?.label || "Padrão"})`);
            this.createdProjectId = res?.project_id || res?.id || 1;

            // 2. Aplicação das Configurações do Perfil Selecionado
            if (this.selectedProfile?.settings && typeof this.api.updateProjectSettings === "function") {
                try {
                    await this.api.updateProjectSettings(this.createdProjectId, this.selectedProfile.settings);
                } catch (settingsErr) {
                    console.warn("[WelcomeHub] Não foi possível gravar settings específicas:", settingsErr);
                }
            }

            // 3. Disparo da Ingestão de Mídias via TASK_MANAGER
            let mediaSummaryText = "Nenhuma mídia importada inicialmente.";
            if (this.pendingFolder) {
                try {
                    await this.api.triggerExternalIngest(this.pendingFolder, this.createdProjectId);
                    mediaSummaryText = `📁 Pasta \`${this.pendingFolder}\` enviada para a fila de tarefas do \`TASK_MANAGER\`.`;
                } catch (ingestErr) {
                    console.warn("[WelcomeHub] Falha ao disparar ingestão de pasta:", ingestErr);
                }
            } else if (this.pendingFiles.length > 0) {
                try {
                    await this.api.triggerExternalFilesIngest(this.pendingFiles, this.createdProjectId);
                    mediaSummaryText = `🎬 **${this.pendingFiles.length} mídia(s)** enviada(s) para a fila de tarefas do \`TASK_MANAGER\`.`;
                } catch (ingestErr) {
                    console.warn("[WelcomeHub] Falha ao disparar ingestão de arquivos:", ingestErr);
                }
            }

            // Transição para READY_TO_TRANSITION
            this.state = WelcomeHub.STATES.READY_TO_TRANSITION;
            this.appendMessage({
                role: "assistant",
                content: `✨ **Tudo pronto!** O projeto **${this.projectName}** foi configurado com sucesso.\n\n• **Perfil de IA:** ${this.selectedProfile?.label || "Padrão"}\n• **Status da Ingestão:** ${mediaSummaryText}\n\nClique abaixo para ingressar na ilha de edição clássica com o histórico preservado.`
            });

            this.setChips([
                { label: "🚀 Entrar na Ilha de Edição (NLE)", action: "transition_nle" }
            ]);
        } catch (err) {
            console.error("[WelcomeHub] Erro na criação do projeto:", err);
            this.appendMessage({
                role: "assistant",
                content: `❌ Ocorreu um erro ao criar o projeto: ${err.message || err}. Deseja tentar novamente?`
            });
            this.state = WelcomeHub.STATES.AWAITING_NAME;
            this.setChips([
                { label: "Tentar Novamente", value: this.projectName }
            ]);
        } finally {
            this.isProcessing = false;
            if (this.chatInput) {
                this.chatInput.disabled = false;
                this.chatInput.focus();
            }
        }
    }

    /** Conduz a transição fluida para o NLE clássico sem recarga de página */
    async transitionToNLE() {
        if (this.state === WelcomeHub.STATES.COMPLETED || this.isProcessing) return;
        this.state = WelcomeHub.STATES.COMPLETED;

        // 1. Prepara histórico consolidado com recap executivo
        const finalHistory = [...this.conversationHistory];
        finalHistory.push({
            role: "assistant",
            content: `🎬 **Onboarding Concluído!**\n\n` +
                     `• **Projeto Ativo:** ${this.projectName || "Novo Projeto"}\n` +
                     `• **Perfil:** ${this.selectedProfile?.label || "Padrão"}\n` +
                     `• **Mídias:** ${this.pendingFolder ? `Pasta (${this.pendingFolder})` : (this.pendingFiles.length > 0 ? `${this.pendingFiles.length} arquivo(s)` : "Importação manual posterior")}\n\n` +
                     `O contexto do onboarding foi mantido no chat. Posso auxiliar na decupagem de depoimentos, busca semântica de B-rolls ou montagem de rough cuts na timeline. O que deseja fazer agora?`
        });

        // 2. Define o projeto ativo no STATE
        if (this.createdProjectId) {
            this.stateObj.currentProjectId = this.createdProjectId;
        }

        // 3. Atualiza localStorage e sessionStorage
        if (typeof localStorage !== "undefined") {
            if (this.createdProjectId) {
                localStorage.setItem("activeProjectId", String(this.createdProjectId));
                localStorage.setItem("capiau_project_explicitly_chosen", "true");
            }
            localStorage.setItem("active-right-tab", "chat");
        }
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("capiau_welcome_seen", "true");
        }

        // 4. Injeta histórico de onboarding no STATE.chatHistory
        this.stateObj.chatHistory = finalHistory;
        this.stateObj.emit("chatHistoryUpdated", finalHistory);

        // 5. Garante expansão e foco na aba Chat do NLE
        if (this.window?.workspaceManager?.setPanelCollapsed) {
            this.window.workspaceManager.setPanelCollapsed("sidebar-right", false);
        } else if (this.window?.expandRightPanel) {
            this.window.expandRightPanel();
        }

        const sidebarRight = this.document?.getElementById("sidebar-right");
        if (sidebarRight && sidebarRight.classList.contains("collapsed")) {
            sidebarRight.classList.remove("collapsed");
        }
        const reopenRight = this.document?.getElementById("reopen-right");
        if (reopenRight) {
            reopenRight.style.display = "none";
        }

        const btnTabChat = this.document?.getElementById("btn-tab-chat");
        if (btnTabChat && typeof btnTabChat.click === "function") {
            btnTabChat.click();
        }
        this.stateObj.emit("rightTabChanged", "chat");

        // 6. Fade-out suave sem layout shift
        this.hide();
    }

    /** Verifica se um chip representa um perfil de intenção de IA */
    isIntentProfileChip(chip) {
        if (!chip || chip.action) return false;
        const val = String(chip.value || chip.label || "").trim().toLowerCase();
        if (!val) return false;

        if (WelcomeHub.PROFILES[val]) return true;

        for (const profile of Object.values(WelcomeHub.PROFILES)) {
            if (profile.id.toLowerCase() === val) return true;
            if (profile.label.toLowerCase() === val) return true;
            if (val.includes(profile.id.toLowerCase()) || val.includes(profile.label.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    /** Trata clique no chip */
    async handleChipClick(chip) {
        if (!chip || this.isProcessing || this.isTransitioning) return;

        // Guarda de estado: chips de perfil de intenção só podem ser processados em AWAITING_PROFILE
        if (this.isIntentProfileChip(chip) && this.state !== WelcomeHub.STATES.AWAITING_PROFILE) {
            return;
        }

        if (chip.action === "skip_media") {
            if (this.state !== WelcomeHub.STATES.AWAITING_MEDIA) return;
            await this.handleUserInput("pular");
            return;
        }

        if (chip.action === "skip_nle") {
            this.hide();
            if (typeof sessionStorage !== "undefined") {
                sessionStorage.setItem("capiau_welcome_seen", "true");
            }
            return;
        }

        if (chip.action === "browse_folder") {
            if (this.state !== WelcomeHub.STATES.AWAITING_MEDIA) return;
            await this.handleBrowseFolder();
            return;
        }

        if (chip.action === "browse_files") {
            if (this.state !== WelcomeHub.STATES.AWAITING_MEDIA) return;
            await this.handleBrowseFiles();
            return;
        }

        if (chip.action === "transition_nle") {
            if (this.state !== WelcomeHub.STATES.READY_TO_TRANSITION) return;
            await this.transitionToNLE();
            return;
        }

        if (chip.action === "open_api_keys" || chip.action === "open_settings") {
            await this.openApiKeysModal();
            return;
        }

        await this.handleUserInput(chip.value || chip.label);
    }

    /** Seleciona pasta de mídias */
    async handleBrowseFolder() {
        if (this.isProcessing || this.isTransitioning) return;
        try {
            const res = await this.api.selectFolder();
            const folderPath = res?.folder || res?.path;
            if (folderPath) {
                this.pendingFolder = folderPath;
                this.updateDropzoneUI();
                this.appendMessage({
                    role: "user",
                    content: `📁 Pasta selecionada: \`${folderPath}\``
                });

                if (this.state === WelcomeHub.STATES.AWAITING_MEDIA) {
                    await this.createProjectAndFinalize();
                }
            }
        } catch (err) {
            console.error("[WelcomeHub] Erro ao selecionar pasta:", err);
        }
    }

    /** Seleciona arquivos de mídia */
    async handleBrowseFiles() {
        if (this.isProcessing || this.isTransitioning) return;
        try {
            const res = await this.api.selectFiles();
            const files = res?.files || res?.paths || [];
            if (files && files.length > 0) {
                this.pendingFiles = files;
                this.updateDropzoneUI();
                this.appendMessage({
                    role: "user",
                    content: `🎬 **${files.length} arquivo(s) selecionado(s)**`
                });

                if (this.state === WelcomeHub.STATES.AWAITING_MEDIA) {
                    await this.createProjectAndFinalize();
                }
            }
        } catch (err) {
            console.error("[WelcomeHub] Erro ao selecionar arquivos:", err);
        }
    }

    /** Processa drop de arquivos na dropzone */
    async handleDropFiles(e) {
        if (this.isProcessing || this.isTransitioning) return;
        const dt = e?.dataTransfer;
        if (!dt) return;

        const files = Array.from(dt.files || []);
        if (files.length === 0) return;

        // Se houver caminhos físicos diretos (Electron ou Desktop)
        const paths = files.map(f => f.path || f.name).filter(Boolean);
        this.pendingFiles = paths;
        this.updateDropzoneUI();

        this.appendMessage({
            role: "user",
            content: `📥 Mídias adicionadas via arrasto: **${paths.length} item(ns)**`
        });

        if (this.state === WelcomeHub.STATES.AWAITING_MEDIA) {
            await this.createProjectAndFinalize();
        }
    }

    /** Atualiza feedback visual da dropzone */
    updateDropzoneUI() {
        if (!this.dropzoneFeedback) return;

        let total = 0;
        let summaryHtml = "";

        if (this.pendingFolder) {
            total = 1;
            summaryHtml = `<li><i class="fa-solid fa-folder"></i> ${this.pendingFolder}</li>`;
            if (this.dropzoneCount) this.dropzoneCount.textContent = "1 pasta de mídias";
        } else if (this.pendingFiles.length > 0) {
            total = this.pendingFiles.length;
            const previewFiles = this.pendingFiles.slice(0, 4);
            summaryHtml = previewFiles.map(f => `<li><i class="fa-solid fa-file-video"></i> ${f}</li>`).join("");
            if (this.pendingFiles.length > 4) {
                summaryHtml += `<li>… e mais ${this.pendingFiles.length - 4} arquivo(s)</li>`;
            }
            if (this.dropzoneCount) this.dropzoneCount.textContent = `${total} arquivo(s)`;
        }

        if (total > 0) {
            this.dropzoneFeedback.style.display = "block";
            if (this.dropzoneSummary) this.dropzoneSummary.innerHTML = summaryHtml;
        } else {
            this.dropzoneFeedback.style.display = "none";
        }
    }

    /** Renderiza mensagens no feed rolável */
    renderMessages() {
        if (!this.chatMessagesContainer) return;
        this.chatMessagesContainer.innerHTML = "";

        this.conversationHistory.forEach(msg => {
            const row = this.document.createElement("div");
            row.className = `welcome-bubble-row ${msg.role === "user" ? "user-row" : "assistant-row"}`;

            const bubble = this.document.createElement("div");
            bubble.className = `welcome-bubble ${msg.role === "user" ? "user" : "assistant"}`;
            bubble.innerHTML = formatMessageContent(msg.content);

            row.appendChild(bubble);
            this.chatMessagesContainer.appendChild(row);
        });

        // Rola automaticamente para o fim
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }

    /** Renderiza chips de resposta rápida */
    renderChips() {
        if (!this.chipsContainer) return;
        this.chipsContainer.innerHTML = "";

        if (!this.activeChips || this.activeChips.length === 0) {
            this.chipsContainer.style.display = "none";
            return;
        }

        this.chipsContainer.style.display = "flex";
        this.activeChips.forEach(chip => {
            const btn = this.document.createElement("button");
            btn.type = "button";
            btn.className = "welcome-chip";
            btn.textContent = chip.label;
            btn.addEventListener("click", () => this.handleChipClick(chip));
            this.chipsContainer.appendChild(btn);
        });
    }

    /** Abre sub-modal de projetos existentes */
    async openExistingProjectsModal() {
        if (!this.modalExistingProjects) return;
        this.modalExistingProjects.style.display = "flex";
        if (this.projectsListContainer) {
            this.projectsListContainer.innerHTML = '<div class="loading-state"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando projetos...</div>';
        }

        try {
            const projects = await this.api.fetchProjects();
            this.renderExistingProjectsList(projects || []);
        } catch (err) {
            console.error("[WelcomeHub] Erro ao carregar projetos:", err);
            if (this.projectsListContainer) {
                this.projectsListContainer.innerHTML = `<div class="error-state"><i class="fa-solid fa-triangle-exclamation"></i> Falha ao listar projetos: ${err.message || err}</div>`;
            }
        }
    }

    /** Fecha sub-modal de projetos existentes */
    closeExistingProjectsModal() {
        if (this.modalExistingProjects) {
            this.modalExistingProjects.style.display = "none";
        }
    }

    /** Renderiza lista de projetos existentes no modal */
    renderExistingProjectsList(projects) {
        if (!this.projectsListContainer) return;
        this.projectsListContainer.innerHTML = "";

        if (!projects || projects.length === 0) {
            this.projectsListContainer.innerHTML = `
                <div class="empty-projects-state">
                    <i class="fa-solid fa-folder-open"></i>
                    <p>Nenhum projeto encontrado no banco de dados.</p>
                    <button type="button" class="btn-welcome-flat" id="btn-modal-create-first">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Criar Primeiro Projeto com Chat Guiador
                    </button>
                </div>
            `;
            const btnFirst = this.projectsListContainer.querySelector("#btn-modal-create-first");
            if (btnFirst) {
                btnFirst.addEventListener("click", () => {
                    this.closeExistingProjectsModal();
                    this.startOnboarding();
                });
            }
            return;
        }

        projects.forEach(p => {
            const card = this.document.createElement("div");
            card.className = "welcome-project-card";

            const info = this.document.createElement("div");
            info.className = "welcome-project-info";
            info.innerHTML = `
                <h4><i class="fa-solid fa-film"></i> ${p.name || `Projeto #${p.id}`}</h4>
                <p>${p.description || "Sem descrição disponível."}</p>
                <span class="project-date">ID: ${p.id}</span>
            `;

            const btnOpen = this.document.createElement("button");
            btnOpen.type = "button";
            btnOpen.className = "btn-open-project";
            btnOpen.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Abrir Projeto';
            btnOpen.addEventListener("click", () => {
                this.selectExistingProject(p.id);
            });

            card.appendChild(info);
            card.appendChild(btnOpen);
            this.projectsListContainer.appendChild(card);
        });
    }

    /** Seleciona projeto existente e transiciona para o NLE */
    selectExistingProject(projectId) {
        this.closeExistingProjectsModal();
        this.stateObj.currentProjectId = projectId;

        if (typeof localStorage !== "undefined") {
            localStorage.setItem("activeProjectId", String(projectId));
            localStorage.setItem("capiau_project_explicitly_chosen", "true");
        }
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem("capiau_welcome_seen", "true");
        }

        this.hide();
    }

    /** Abre sub-modal de configuração segura de chaves de API */
    async openApiKeysModal() {
        if (!this.modalApiKeys) return;
        this.modalApiKeys.style.display = "flex";

        if (this.keysFeedback) {
            this.keysFeedback.className = "welcome-keys-feedback";
            this.keysFeedback.style.display = "none";
            this.keysFeedback.textContent = "";
        }
        if (this.inputOpenRouter) this.inputOpenRouter.value = "";
        if (this.inputGemini) this.inputGemini.value = "";

        // Consulta status atual das chaves sem expor os tokens em tela
        try {
            if (this.api && typeof this.api.fetchSettings === "function") {
                const settings = await this.api.fetchSettings();
                const g = settings?.global || {};

                const hasOr = Boolean(g["api.openrouter_key"] && g["api.openrouter_key"] !== "your_openrouter_api_key_here");
                if (this.badgeOpenRouter) {
                    this.badgeOpenRouter.textContent = hasOr ? "Configurada" : "Não configurada";
                    this.badgeOpenRouter.className = `key-status-badge ${hasOr ? "configured" : "missing"}`;
                }
                if (this.inputOpenRouter && hasOr) {
                    this.inputOpenRouter.placeholder = "sk-or-v1-•••••••••••• (Chave ativa no banco)";
                }

                const hasGem = Boolean(g["api.gemini_key"]);
                if (this.badgeGemini) {
                    this.badgeGemini.textContent = hasGem ? "Configurada" : "Não configurada";
                    this.badgeGemini.className = `key-status-badge ${hasGem ? "configured" : "missing"}`;
                }
                if (this.inputGemini && hasGem) {
                    this.inputGemini.placeholder = "AIzaSy•••••••••••• (Chave ativa no banco)";
                }
            }
        } catch (err) {
            console.warn("[WelcomeHub] Falha ao verificar status de chaves:", err);
        }
    }

    /** Fecha sub-modal de chaves de API limpando inputs por segurança */
    closeApiKeysModal() {
        if (this.modalApiKeys) {
            this.modalApiKeys.style.display = "none";
        }
        if (this.inputOpenRouter) this.inputOpenRouter.value = "";
        if (this.inputGemini) this.inputGemini.value = "";
    }

    /** Salva chaves de API digitadas no modal seguro */
    async saveApiKeysFromModal() {
        const valOr = this.inputOpenRouter?.value?.trim();
        const valGem = this.inputGemini?.value?.trim();

        if (!valOr && !valGem) {
            if (this.keysFeedback) {
                this.keysFeedback.textContent = "Digite uma chave válida de OpenRouter ou Gemini para salvar.";
                this.keysFeedback.className = "welcome-keys-feedback error";
            }
            return;
        }

        try {
            if (valOr && this.api && typeof this.api.saveOnboardingApiKey === "function") {
                await this.api.saveOnboardingApiKey("openrouter", valOr);
            }
            if (valGem && this.api && typeof this.api.saveOnboardingApiKey === "function") {
                await this.api.saveOnboardingApiKey("gemini", valGem);
            }

            if (this.keysFeedback) {
                this.keysFeedback.textContent = "✔ Chaves de API salvas com sucesso no banco de dados local!";
                this.keysFeedback.className = "welcome-keys-feedback success";
            }

            if (this.inputOpenRouter) this.inputOpenRouter.value = "";
            if (this.inputGemini) this.inputGemini.value = "";

            if (valOr && this.badgeOpenRouter) {
                this.badgeOpenRouter.textContent = "Configurada";
                this.badgeOpenRouter.className = "key-status-badge configured";
            }
            if (valGem && this.badgeGemini) {
                this.badgeGemini.textContent = "Configurada";
                this.badgeGemini.className = "key-status-badge configured";
            }

            this.appendMessage({
                role: "assistant",
                content: "🔒 **Chaves de API atualizadas com sucesso via painel seguro!** Os modelos de IA estão prontos para uso."
            });

            setTimeout(() => {
                this.closeApiKeysModal();
            }, 1200);
        } catch (err) {
            if (this.keysFeedback) {
                this.keysFeedback.textContent = `❌ Falha ao salvar: ${err.message || err}`;
                this.keysFeedback.className = "welcome-keys-feedback error";
            }
        }
    }

    /** Abre o painel completo de configurações da aplicação */
    openFullSettingsModal() {
        this.closeApiKeysModal();
        if (this.window?.settingsPanel?.open) {
            this.window.settingsPanel.open("models_keys");
        } else {
            const btn = this.document?.getElementById("btn-open-settings");
            if (btn) btn.click();
        }
    }
}
