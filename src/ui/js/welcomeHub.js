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
        desc: "Triagem com Laya ONNX CPU local (22ms), visão YOLO-World v2, biometria SCRFD 512-d CPU e DeepSeek V4.1 Flash. Custo zero de nuvem e privacidade máxima.",
        settings: {
            "llm.text_model": "deepseek/deepseek-v4.1-flash",
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
        desc: "Triagem dual (Laya local + escalação Sistema 2), Gemini 3.8 Flash, Nemotron 3 com fala sobreposta e DeepSeek V4.1 Flash. Otimizado para agilidade jornalística.",
        settings: {
            "llm.text_model": "deepseek/deepseek-v4.1-flash",
            "llm.vision_model": "google/gemini-3.8-flash",
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
        desc: "Triagem nuvem Jev RLCD, Gemini 3.1 Pro com bboxes canônicos, biometria Buffalo_l 512-d, áudio AssemblyAI 3.5 e Claude Sonnet 5.5. Máxima precisão cinematográfica.",
        settings: {
            "llm.text_model": "anthropic/claude-sonnet-5.5",
            "llm.vision_model": "google/gemini-3.1-pro-preview",
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

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatInline(line) {
    return escapeHtml(line)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
        .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1<em>$2</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/\*\*|__/g, "");
}

/**
 * Converte o markdown que o modelo devolve em texto limpo: nenhum símbolo (**, ###, -, ```)
 * chega à tela. Títulos viram rótulo, listas viram listas, linhas seguidas viram <br>.
 * Todo o texto é escapado antes de qualquer marcação.
 */
export function formatMessageContent(text) {
    if (!text) return "";
    const out = [];
    let list = null;
    let para = [];
    const flushPara = () => {
        if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
        para = [];
    };
    const closeList = () => {
        if (list) out.push(`</${list}>`);
        list = null;
    };
    const openList = (tag) => {
        flushPara();
        if (list !== tag) {
            closeList();
            out.push(`<${tag}>`);
            list = tag;
        }
    };

    for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
        const line = raw.trim();
        let m;
        if (!line || /^```/.test(line) || /^([-*_])\1{2,}$/.test(line)) {
            flushPara();
            closeList();
            continue;
        }
        if ((m = line.match(/^#{1,6}\s+(.*)$/))) {
            flushPara();
            closeList();
            out.push(`<span class="wh-lbl">${formatInline(m[1].replace(/[:：]\s*$/, ""))}</span>`);
            continue;
        }
        if ((m = line.match(/^[-*+•]\s+(.*)$/))) {
            openList("ul");
            out.push(`<li>${formatInline(m[1])}</li>`);
            continue;
        }
        if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
            openList("ol");
            out.push(`<li>${formatInline(m[1])}</li>`);
            continue;
        }
        closeList();
        para.push(formatInline(line.replace(/^>\s?/, "")));
    }
    flushPara();
    closeList();
    return out.join("");
}

/** Recursos da ferramenta explicados dentro da primeira mensagem */
export const WELCOME_HUB_FEATURES = Object.freeze([
    {
        id: "decupar", icon: "fa-list-ul", title: "Decupar entrevistas",
        what: "Separa cada fala em trechos com início e fim e marca os melhores momentos.",
        needs: "Vídeo ou áudio com fala.", result: "Aba Índice do editor, uma linha por trecho.",
        ask: "Como funciona a decupagem de entrevistas?"
    },
    {
        id: "vozes", icon: "fa-wave-square", title: "Transcrever e separar vozes",
        what: "Transcreve tudo e identifica quem fala, até 8 vozes, inclusive quando falam ao mesmo tempo.",
        needs: "Áudio do gravador ou da câmera.", result: "Transcrição com o nome de cada pessoa.",
        ask: "Como funciona a transcrição com separação de vozes?"
    },
    {
        id: "rostos", icon: "fa-user", title: "Reconhecer rostos",
        what: "Agrupa as aparições da mesma pessoa. Fotos de set ajudam a dar nome a cada rosto.",
        needs: "Vídeo. Fotos são opcionais.", result: "Aba Rostos, com os planos de cada pessoa.",
        ask: "Como funciona o reconhecimento de rostos?"
    },
    {
        id: "texto", icon: "fa-i-cursor", title: "Cortar pelo texto",
        what: "Apague ou reordene frases na transcrição e o corte acompanha. Dá para pedir um primeiro corte bruto.",
        needs: "Transcrição pronta.", result: "Timeline do editor.",
        ask: "Como funciona o corte pelo texto?"
    },
    {
        id: "exportar", icon: "fa-file-export", title: "Levar para Premiere ou Resolve",
        what: "Exporta o corte e os marcadores para abrir no seu editor de sempre.",
        needs: "Um corte na timeline.", result: "Arquivo XML ou EDL na pasta do projeto.",
        ask: "Como exporto para o Premiere ou o Resolve?"
    }
]);

const MEDIA_KINDS = Object.freeze({
    video: { label: "vídeo", icon: "fa-film", color: "var(--accent)", will: ["cenas", "rostos", "fala"] },
    audio: { label: "áudio", icon: "fa-wave-square", color: "var(--color-emerald)", will: ["transcrição", "vozes"] },
    foto: { label: "foto", icon: "fa-image", color: "var(--color-amber)", will: ["ref. de rosto"] },
    pasta: { label: "pasta", icon: "fa-folder", color: "var(--accent)", will: ["tudo que houver dentro"] },
    outro: { label: "outro", icon: "fa-file", color: "var(--text-muted)", will: ["ignorado"] }
});

/** Classifica um arquivo pelo tipo MIME ou pela extensão */
export function mediaKindOf(nameOrType = "", type = "") {
    const s = `${type} ${nameOrType}`.toLowerCase();
    if (/video\/|\.(mov|mp4|mxf|mts|m2ts|avi|mkv|webm|r3d|braw)\b/.test(s)) return "video";
    if (/audio\/|\.(wav|mp3|aac|m4a|flac|bwf|aiff?|ogg)\b/.test(s)) return "audio";
    if (/image\/|\.(jpe?g|png|heic|tiff?|webp|dng|cr2|arw)\b/.test(s)) return "foto";
    return "outro";
}

function formatBytes(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace(".", ",")} GB`;
    if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
    return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function formatDuration(secs) {
    if (!secs || !isFinite(secs)) return "";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(s).padStart(2, "0")}`;
}

/** Lê um valor de GET /api/settings ({values: {k: {value}}}); aceita também o formato antigo {global: {k}} */
function settingValue(settings, key) {
    const v = settings?.values?.[key]?.value ?? settings?.global?.[key];
    return v === "your_openrouter_api_key_here" ? "" : v;
}

function baseName(path) {
    return String(path || "").split(/[\\/]/).filter(Boolean).pop() || String(path || "");
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
        this.pendingMedia = [];
        this.openFeatures = new Set();
        this.waitStartedAt = 0;
        this.waitTimer = null;

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
        this.crumbName = this.document.getElementById("welcome-crumb-name");
        this.planMeta = this.document.getElementById("welcome-plan-meta");
        this.planSteps = this.document.getElementById("welcome-plan-steps");
        this.keyDot = this.document.getElementById("welcome-key-dot");

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
            this.btnExistingProjects.addEventListener("click", (e) => {
                e?.stopPropagation?.();
                const open = this.modalExistingProjects?.style?.display === "flex";
                if (open) this.closeExistingProjectsModal();
                else this.openExistingProjectsModal();
            });
        }
        // Menu de projetos fecha ao clicar fora ou com Esc
        if (typeof this.document.addEventListener === "function") {
            this.document.addEventListener("click", (e) => {
                if (this.modalExistingProjects?.style?.display !== "flex") return;
                if (this.modalExistingProjects.contains?.(e.target)) return;
                this.closeExistingProjectsModal();
            });
            this.document.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && this.modalExistingProjects?.style?.display === "flex") {
                    this.closeExistingProjectsModal();
                }
            });
        }

        // Itens de recurso dentro da conversa (abre/fecha e "Perguntar mais")
        if (this.chatMessagesContainer) {
            this.chatMessagesContainer.addEventListener("click", (e) => {
                const head = e.target?.closest?.("[data-feat-toggle]");
                if (head) {
                    const id = head.dataset.featToggle;
                    if (this.openFeatures.has(id)) this.openFeatures.delete(id);
                    else this.openFeatures.add(id);
                    const card = head.closest(".wh-feat");
                    card?.classList.toggle("open", this.openFeatures.has(id));
                    head.setAttribute("aria-expanded", String(this.openFeatures.has(id)));
                    return;
                }
                const ask = e.target?.closest?.("[data-feat-ask]");
                if (ask) {
                    const feat = WELCOME_HUB_FEATURES.find(f => f.id === ask.dataset.featAsk);
                    if (feat) this.handleUserInput(feat.ask);
                }
            });
        }

        // Adicionar mais mídias pelo cartão "+" da grade
        if (this.dropzoneSummary) {
            this.dropzoneSummary.addEventListener("click", (e) => {
                if (e.target?.closest?.("[data-add-media]")) this.handleBrowseFiles();
                const rm = e.target?.closest?.("[data-remove-media]");
                if (rm) this.removeMedia(Number(rm.dataset.removeMedia));
            });
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
        this.refreshKeyStatus();
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

        this.pendingMedia = [];
        this.openFeatures = new Set();
        this.stopWaiting();
        this.updateDropzoneUI();
        this.setCrumb("");
        if (this.chatInput) {
            this.chatInput.value = "";
            this.chatInput.disabled = false;
        }
    }

    /** Inicia o fluxo conversacional guiado */
    startOnboarding() {
        this.reset();
        this.state = WelcomeHub.STATES.AWAITING_NAME;

        // A lista de recursos aparece embaixo desta mensagem (fora do histórico enviado ao modelo)
        this.featuresAtIndex = this.conversationHistory.length;
        this.appendMessage({
            role: "assistant",
            content: "Oi! Eu organizo o material bruto e deixo tudo pronto para você editar no CapIAu-Talho.\n\nSolte as mídias à esquerda e me diga **o nome do projeto**. Se quiser entender o que a ferramenta faz, abra um dos itens abaixo."
        });

        this.setChips([
            { label: "Documentário Raízes", value: "Documentário Raízes" },
            { label: "Entrevista de Campo", value: "Entrevista de Campo" },
            { label: "Como funciona a análise?", value: "Como funciona a análise?" }
        ]);
    }

    /** Mostra o nome do projeto no cabeçalho */
    setCrumb(name) {
        if (this.crumbName) this.crumbName.textContent = name || "novo projeto";
    }

    /** Ponto de status das chaves e modelo da conversa no cabeçalho */
    async refreshKeyStatus() {
        if (typeof this.api?.fetchSettings !== "function") return;
        try {
            const settings = await this.api.fetchSettings();
            const hasOr = Boolean(settingValue(settings, "api.openrouter_key"));
            this.textModel = settingValue(settings, "llm.text_model") || this.textModel;
            if (this.keyDot) {
                // A conversa usa só a OpenRouter: é essa chave que decide se a IA responde
                this.keyDot.className = `wh-dot ${hasOr ? "ok" : "missing"}`;
                this.keyDot.title = hasOr ? "Chave da OpenRouter configurada" : "Sem chave da OpenRouter: a conversa usa o assistente local";
            }
            this.setModelLine(hasOr ? { api_status: "ok", model: this.textModel } : { api_status: "missing_key" });
        } catch (err) {
            console.warn("[WelcomeHub] Falha ao ler status das chaves:", err);
        }
    }

    /** Diz embaixo do título da conversa quem está respondendo (modelo da OpenRouter ou assistente local) */
    setModelLine(res = {}) {
        const line = this.document?.getElementById?.("welcome-chat-sub");
        if (!line) return;
        const model = res.model || res.requested_model || this.textModel;
        const reasons = {
            missing_key: "sem chave da OpenRouter",
            expired_key: "chave da OpenRouter recusada",
            model_error: `${model} não respondeu`,
            timeout: `${model} passou de 12 s`,
            offline_mode: "OpenRouter fora do ar"
        };
        if (res.api_status === "ok" && model) {
            line.textContent = `Respondendo com ${model} via OpenRouter`;
            line.classList?.remove?.("wh-warn");
        } else {
            line.textContent = `Assistente local (${reasons[res.api_status] || "sem IA em nuvem"})`;
            line.classList?.add?.("wh-warn");
        }
    }

    /** Indicador de espera enquanto a IA responde: tempo passando e aviso se demorar */
    startWaiting() {
        this.stopWaiting();
        this.waitStartedAt = Date.now();
        this.renderMessages();
        if (typeof setInterval === "function" && this.document) {
            this.waitTimer = setInterval(() => this.updateWaiting(), 200);
        }
    }

    updateWaiting() {
        if (!this.waitStartedAt || !this.document) return;
        const secs = (Date.now() - this.waitStartedAt) / 1000;
        const timer = this.document.getElementById("welcome-wait-timer");
        if (timer) timer.textContent = `${secs.toFixed(1).replace(".", ",")} s`;
        const label = this.document.getElementById("welcome-wait-label");
        if (label) label.textContent = secs < 1 ? "Enviando sua mensagem" : "A IA está pensando";
        const slow = this.document.getElementById("welcome-wait-slow");
        if (slow && secs > 8 && slow.style.display === "none") {
            slow.style.display = "block";
            if (this.chatMessagesContainer) this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
        }
    }

    stopWaiting() {
        if (this.waitTimer) clearInterval(this.waitTimer);
        this.waitTimer = null;
        const was = Boolean(this.waitStartedAt);
        this.waitStartedAt = 0;
        if (was) this.renderMessages();
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
                content: "Escreva um nome para o projeto."
            });
            return false;
        }

        // 1. Detecção de chave de API colada pelo usuário no chat
        const isApiKey = (text.startsWith("sk-or-v1-") || (text.startsWith("sk-") && text.length > 25)) ||
                         (text.startsWith("AIzaSy") && text.length >= 35);
        if (isApiKey) {
            // SEGURANÇA: Mascara a chave imediatamente e NUNCA salva o token bruto no histórico do chat
            this.appendMessage({ role: "user", content: "[Chave de API informada e protegida contra exposição]" });
            const provider = text.startsWith("sk-") ? "openrouter" : "gemini";
            try {
                if (this.api && typeof this.api.saveOnboardingApiKey === "function") {
                    await this.api.saveOnboardingApiKey(provider, text);
                }
                this.appendMessage({
                    role: "assistant",
                    content: `**Chave de API (${provider === "openrouter" ? "OpenRouter" : "Gemini"}) configurada** e guardada no banco local.\n\nEla foi escondida aqui e não fica no histórico da conversa. Para ver ou trocar as chaves, use **Chaves e modelos** no topo.\n\nQual o nome do projeto?`
                });
                this.refreshKeyStatus();
                this.setChips([
                    { label: "Chaves e modelos", action: "open_api_keys" },
                    { label: "Documentário Raízes", value: "Documentário Raízes" },
                    { label: "Entrevista de Campo", value: "Entrevista de Campo" }
                ]);
                return true;
            } catch (keyErr) {
                this.appendMessage({
                    role: "assistant",
                    content: `Não consegui salvar a chave de API (${keyErr.message || keyErr}). Tente de novo ou use **Chaves e modelos** no topo.`
                });
                return false;
            }
        }

        // 2. Integração com a API OnboardingChat (Backend inteligente com conhecimento do Talho)
        if (this.api && typeof this.api.onboardingChat === "function") {
            this.isTransitioning = true;
            const userMsg = { role: "user", content: text };
            this.appendMessage(userMsg);
            this.setInputBusy(true);
            this.startWaiting();
            let answered = false;
            try {
                const chatRes = await this.api.onboardingChat(
                    text,
                    this.conversationHistory,
                    this.projectName || null,
                    this.selectedProfile?.id || null
                );
                this.stopWaiting();

                if (chatRes && chatRes.reply) {
                    answered = true;
                    if (chatRes.api_status) this.setModelLine(chatRes);
                    this.appendMessage({ role: "assistant", content: chatRes.reply });

                    if (chatRes.suggested_project_name && !this.projectName) {
                        this.projectName = chatRes.suggested_project_name;
                        this.setCrumb(this.projectName);
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
                this.stopWaiting();
                this.setInputBusy(false);
                this.isTransitioning = false;
                // Sem resposta do backend: o motor local abaixo mostra a mensagem do usuário de novo
                if (!answered && this.conversationHistory[this.conversationHistory.length - 1] === userMsg) {
                    this.conversationHistory.pop();
                }
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
            const feat = WELCOME_HUB_FEATURES.find(f => f.ask === text);
            const nextStep = this.projectName
                ? "Quando quiser, solte as mídias à esquerda."
                : "Para começar, qual o **nome do projeto**?";
            this.appendMessage({
                role: "assistant",
                content: feat
                    ? `**${feat.title}**\n\n${feat.what}\n\n- Precisa de: ${feat.needs}\n- Resultado: ${feat.result}\n\n${nextStep}`
                    : "O **CapIAu-Talho** é uma ilha de edição feita para documentário e cinema autoral. Ele trabalha em três etapas:\n\n" +
                      "1. **Ingestão**: confere cada arquivo e gera versões leves para editar.\n" +
                      "2. **Análise nesta máquina**: transcrição, quem fala, rostos e cenas.\n" +
                      "3. **Editor**: você revisa o que a IA achou e corta pelo texto.\n\n" +
                      nextStep
            });
            if (!this.projectName) {
                this.setChips([
                    { label: "Documentário Raízes", value: "Documentário Raízes" },
                    { label: "Entrevista de Campo", value: "Entrevista de Campo" }
                ]);
            }
            return this.state !== WelcomeHub.STATES.AWAITING_MEDIA;
        }

        switch (this.state) {
            case WelcomeHub.STATES.AWAITING_NAME: {
                this.isTransitioning = true;
                try {
                    this.projectName = text;
                    this.setCrumb(text);
                    this.appendMessage({ role: "user", content: text });

                    // Transição para AWAITING_PROFILE
                    this.state = WelcomeHub.STATES.AWAITING_PROFILE;
                    this.appendMessage({
                        role: "assistant",
                        content: `O projeto vai se chamar **${this.projectName}**.\n\nComo a análise deve rodar? Isso define quanto fica nesta máquina e quanto vai para a nuvem.`
                    });

                    this.setChips([
                        { label: "Documentário Offline Econômico", value: "doc_offline_eco" },
                        { label: "Entrevista Ágil", value: "entrevista_agil" },
                        { label: "Cinema Nuvem SOTA", value: "cinema_nuvem_sota" }
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
                        content: "Escolha um dos três perfis abaixo, ou escreva o nome de um deles."
                    });
                    return false;
                }

                this.isTransitioning = true;
                try {
                    this.selectedProfile = profile;
                    this.appendMessage({ role: "user", content: profile.label });

                    // Transição para AWAITING_MEDIA
                    this.state = WelcomeHub.STATES.AWAITING_MEDIA;
                    const mediaCount = this.pendingFolder ? 1 : this.pendingFiles.length;
                    this.appendMessage({
                        role: "assistant",
                        content: mediaCount
                            ? `Perfil **${profile.label}**.\n\n${profile.desc}\n\nJá tenho ${this.pendingFolder ? "a pasta" : `${mediaCount} ${mediaCount === 1 ? "arquivo" : "arquivos"}`} à esquerda. Posso criar o projeto e começar a análise, ou você solta mais material antes.`
                            : `Perfil **${profile.label}**.\n\n${profile.desc}\n\nAgora solte o material à esquerda: a pasta do cartão inteira serve. Também dá para pular e importar depois, no editor.`
                    });

                    this.setChips(mediaCount
                        ? [
                            { label: "Criar projeto e analisar", action: "create_now" },
                            { label: "Adicionar mais arquivos", action: "browse_files" }
                        ]
                        : [
                            { label: "Selecionar pasta…", action: "browse_folder" },
                            { label: "Selecionar arquivos…", action: "browse_files" },
                            { label: "Pular por enquanto", action: "skip_media" }
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
                    content: "Solte o material à esquerda, ou escolha **Pular por enquanto** para importar depois no editor."
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
            content: `Criando o projeto **${this.projectName}** e aplicando o perfil de análise…`
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
            let mediaSummaryText = "nenhuma ainda. Dá para importar no editor.";
            if (this.pendingFolder) {
                try {
                    await this.api.triggerExternalIngest(this.pendingFolder, this.createdProjectId);
                    mediaSummaryText = `a pasta ${baseName(this.pendingFolder)} entrou na fila de análise.`;
                } catch (ingestErr) {
                    console.warn("[WelcomeHub] Falha ao disparar ingestão de pasta:", ingestErr);
                    mediaSummaryText = `não consegui mandar a pasta para a análise (${ingestErr.message || ingestErr}). Importe pelo editor.`;
                }
            } else if (this.pendingFiles.length > 0) {
                try {
                    await this.api.triggerExternalFilesIngest(this.pendingFiles, this.createdProjectId);
                    const n = this.pendingFiles.length;
                    mediaSummaryText = `${n} ${n === 1 ? "arquivo entrou" : "arquivos entraram"} na fila de análise.`;
                } catch (ingestErr) {
                    console.warn("[WelcomeHub] Falha ao disparar ingestão de arquivos:", ingestErr);
                    mediaSummaryText = `não consegui mandar os arquivos para a análise (${ingestErr.message || ingestErr}). Importe pelo editor.`;
                }
            }

            // Transição para READY_TO_TRANSITION
            this.state = WelcomeHub.STATES.READY_TO_TRANSITION;
            this.appendMessage({
                role: "assistant",
                content: `Projeto **${this.projectName}** criado.\n\n- Perfil: ${this.selectedProfile?.label || "Padrão"}\n- Mídias: ${mediaSummaryText}\n\nA análise continua enquanto você edita. A conversa vai junto para o editor.`
            });

            this.setChips([
                { label: "Abrir no editor", action: "transition_nle" }
            ]);
        } catch (err) {
            console.error("[WelcomeHub] Erro na criação do projeto:", err);
            this.appendMessage({
                role: "assistant",
                content: `Não consegui criar o projeto (${err.message || err}). Quer tentar de novo?`
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

        if (chip.action === "create_now") {
            if (this.state !== WelcomeHub.STATES.AWAITING_MEDIA) return;
            this.appendMessage({ role: "user", content: "Criar o projeto com estas mídias." });
            await this.createProjectAndFinalize();
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
                this.pendingFiles = [];
                this.pendingMedia = [{ name: baseName(folderPath), path: folderPath, kind: "pasta" }];
                this.updateDropzoneUI();
                this.appendMessage({
                    role: "user",
                    content: `Pasta selecionada: ${folderPath}`
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
                this.addMedia(files.map(p => ({ name: baseName(p), path: p, kind: mediaKindOf(p) })));
                this.appendMessage({
                    role: "user",
                    content: `${files.length} ${files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"}`
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

        // Caminho físico quando existe (Electron/desktop); no navegador só há o nome
        const canPreview = typeof File !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
        this.addMedia(files.map(f => {
            const kind = mediaKindOf(f.name || f.path, f.type);
            const isPreviewable = canPreview && f instanceof File && (kind === "video" || kind === "foto");
            return {
                name: f.name || baseName(f.path),
                path: f.path || f.name,
                size: f.size || 0,
                kind,
                url: isPreviewable ? URL.createObjectURL(f) : null
            };
        }));

        this.appendMessage({
            role: "user",
            content: `Soltei ${files.length} ${files.length === 1 ? "arquivo" : "arquivos"}.`
        });

        if (this.state === WelcomeHub.STATES.AWAITING_MEDIA) {
            await this.createProjectAndFinalize();
        } else if (this.state === WelcomeHub.STATES.AWAITING_NAME && !this.projectName) {
            this.appendMessage({
                role: "assistant",
                content: "Recebi. Cada arquivo mostra à esquerda o que vai ser analisado nele.\n\nComo vai se chamar o projeto?"
            });
        }
    }

    /** Junta novas mídias às que já estavam na área de soltar (sem repetir caminho) */
    addMedia(items) {
        if (this.pendingFolder) {
            this.pendingFolder = null;
            this.pendingMedia = [];
        }
        const known = new Set(this.pendingMedia.map(m => m.path));
        for (const item of items) {
            if (!item.path || known.has(item.path)) continue;
            known.add(item.path);
            this.pendingMedia.push(item);
        }
        this.pendingFiles = this.pendingMedia.map(m => m.path);
        this.updateDropzoneUI();
    }

    /** Tira uma mídia da área de soltar */
    removeMedia(index) {
        const item = this.pendingMedia[index];
        if (!item) return;
        if (item.url && typeof URL !== "undefined") URL.revokeObjectURL?.(item.url);
        this.pendingMedia.splice(index, 1);
        if (item.kind === "pasta") this.pendingFolder = null;
        this.pendingFiles = this.pendingMedia.filter(m => m.kind !== "pasta").map(m => m.path);
        this.updateDropzoneUI();
    }

    /** Desenha os cartões das mídias e o resumo do que vai ser analisado */
    updateDropzoneUI() {
        const media = this.pendingMedia;
        const has = media.length > 0;
        this.dropzone?.classList?.toggle?.("has-media", has);
        if (this.dropzoneFeedback) this.dropzoneFeedback.style.display = has ? "flex" : "none";
        if (!this.dropzoneSummary) return;

        this.dropzoneSummary.innerHTML = has
            ? media.map((m, i) => this.mediaTileHtml(m, i)).join("") +
              '<button type="button" class="wh-add-tile" data-add-media="1">+ adicionar mais</button>'
            : "";
        if (!has) return;

        // Duração dos vídeos que o navegador consegue ler
        this.dropzoneSummary.querySelectorAll?.("video[data-media-index]").forEach(v => {
            v.addEventListener("loadedmetadata", () => {
                const m = media[Number(v.dataset.mediaIndex)];
                if (m && !m.duration && isFinite(v.duration)) {
                    m.duration = v.duration;
                    this.updatePlanSummary();
                    const meta = v.closest(".wh-tile")?.querySelector(".wh-fmeta");
                    if (meta) meta.textContent = [formatBytes(m.size), formatDuration(m.duration)].filter(Boolean).join(" · ");
                }
            }, { once: true });
        });
        this.updatePlanSummary();
    }

    mediaTileHtml(m, index) {
        const kind = MEDIA_KINDS[m.kind] || MEDIA_KINDS.outro;
        let thumb = `<i class="fa-solid ${kind.icon}"></i>`;
        if (m.url && m.kind === "foto") thumb = `<img src="${m.url}" alt="">`;
        if (m.url && m.kind === "video") thumb = `<video src="${m.url}#t=1" muted preload="metadata" data-media-index="${index}"></video>`;
        const meta = [formatBytes(m.size), formatDuration(m.duration)].filter(Boolean).join(" · ") || (m.kind === "pasta" ? escapeHtml(m.path) : "");
        return `<div class="wh-tile" style="--wh-kind: ${kind.color}">
            <div class="wh-thumb">${thumb}<span class="wh-kind">${kind.label}</span>${m.duration ? `<span class="wh-dur">${formatDuration(m.duration)}</span>` : ""}</div>
            <div class="wh-tile-body">
                <div class="wh-fname" title="${escapeHtml(m.path)}">${escapeHtml(m.name)}</div>
                <div class="wh-fmeta">${meta}</div>
                <div class="wh-will">${kind.will.map(w => `<span>${w}</span>`).join("")}</div>
            </div>
        </div>`.replace(/\n\s*/g, "");
    }

    updatePlanSummary() {
        const media = this.pendingMedia;
        if (this.dropzoneCount) {
            this.dropzoneCount.textContent = this.pendingFolder
                ? "1 pasta pronta para análise"
                : `${media.length} ${media.length === 1 ? "mídia pronta" : "mídias prontas"} para análise`;
        }
        if (this.planMeta) {
            const bytes = media.reduce((a, m) => a + (m.size || 0), 0);
            const secs = media.reduce((a, m) => a + (m.duration || 0), 0);
            const count = k => media.filter(m => m.kind === k).length;
            const parts = [["video", "vídeo", "vídeos"], ["audio", "áudio", "áudios"], ["foto", "foto", "fotos"]]
                .filter(([k]) => count(k))
                .map(([k, one, many]) => `${count(k)} ${count(k) === 1 ? one : many}`);
            const h = Math.floor(secs / 3600);
            const min = Math.round((secs % 3600) / 60);
            this.planMeta.textContent = [
                parts.join(", "),
                secs ? `${h ? `${h}h${String(min).padStart(2, "0")}` : `${min} min`} de material` : "",
                formatBytes(bytes)
            ].filter(Boolean).join(" · ");
        }
        if (this.planSteps) {
            const steps = new Set();
            media.forEach(m => (MEDIA_KINDS[m.kind]?.will || []).forEach(w => steps.add(w)));
            steps.delete("ignorado");
            this.planSteps.innerHTML = [...steps].map(s => `<span class="wh-step">${escapeHtml(s)}</span>`).join("");
        }
    }

    /** Renderiza mensagens no feed rolável */
    renderMessages() {
        if (!this.chatMessagesContainer) return;
        this.chatMessagesContainer.innerHTML = "";

        this.conversationHistory.forEach((msg, index) => {
            const isUser = msg.role === "user";
            const row = this.document.createElement("div");
            row.className = `welcome-bubble-row ${isUser ? "user-row" : "assistant-row"}`;
            const features = !isUser && index === this.featuresAtIndex ? this.featuresHtml() : "";
            row.innerHTML = (isUser ? "" : '<div class="wh-who">Assistente</div>') +
                `<div class="welcome-bubble ${isUser ? "user" : "assistant"}">${formatMessageContent(msg.content)}${features}</div>`;
            this.chatMessagesContainer.appendChild(row);
        });

        if (this.waitStartedAt) {
            const wait = this.document.createElement("div");
            wait.className = "wh-wait";
            wait.innerHTML = '<div class="wh-who">Assistente</div>' +
                '<div class="wh-wait-line"><span class="wh-pulse"></span><span id="welcome-wait-label">Enviando sua mensagem</span><span id="welcome-wait-timer" class="wh-timer">0,0 s</span></div>' +
                '<div id="welcome-wait-slow" class="wh-wait-slow" style="display: none;">Está demorando mais que o normal. Espero até 12 s; depois respondo com o assistente local.</div>';
            this.chatMessagesContainer.appendChild(wait);
        }

        // Rola automaticamente para o fim
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }

    featuresHtml() {
        return '<div class="wh-features">' + WELCOME_HUB_FEATURES.map(f => {
            const open = this.openFeatures.has(f.id);
            return `<div class="wh-feat${open ? " open" : ""}">` +
                `<button type="button" class="wh-feat-head" data-feat-toggle="${f.id}" aria-expanded="${open}"><i class="fa-solid ${f.icon}"></i>${f.title}<i class="fa-solid fa-chevron-right wh-chev"></i></button>` +
                `<div class="wh-feat-body">${f.what}<dl><dt>Precisa de</dt><dd>${f.needs}</dd><dt>Resultado</dt><dd>${f.result}</dd></dl>` +
                `<button type="button" class="wh-btn" data-feat-ask="${f.id}">Perguntar mais</button></div></div>`;
        }).join("") + "</div>";
    }

    /** Trava o campo de texto enquanto a IA responde */
    setInputBusy(busy) {
        if (this.chatInput) this.chatInput.disabled = busy;
        if (this.btnChatSend) this.btnChatSend.disabled = busy;
        if (!busy) this.chatInput?.focus?.();
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

    /** Abre o menu de projetos do cabeçalho */
    async openExistingProjectsModal() {
        if (!this.modalExistingProjects) return;
        this.modalExistingProjects.style.display = "flex";
        this.btnExistingProjects?.setAttribute?.("aria-expanded", "true");
        if (this.projectsListContainer) {
            this.projectsListContainer.innerHTML = '<div class="wh-menu-empty">Carregando projetos…</div>';
        }

        try {
            const projects = await this.api.fetchProjects();
            this.renderExistingProjectsList(projects || []);
        } catch (err) {
            console.error("[WelcomeHub] Erro ao carregar projetos:", err);
            if (this.projectsListContainer) {
                this.projectsListContainer.innerHTML = `<div class="wh-menu-empty">Não consegui listar os projetos (${escapeHtml(err.message || err)}).</div>`;
            }
        }
    }

    /** Fecha o menu de projetos */
    closeExistingProjectsModal() {
        if (this.modalExistingProjects) {
            this.modalExistingProjects.style.display = "none";
        }
        this.btnExistingProjects?.setAttribute?.("aria-expanded", "false");
    }

    /** Lista os projetos no menu, do mais recente para o mais antigo */
    renderExistingProjectsList(projects) {
        if (!this.projectsListContainer) return;
        this.projectsListContainer.innerHTML = "";

        if (!projects || projects.length === 0) {
            this.projectsListContainer.innerHTML = '<div class="wh-menu-empty">Nenhum projeto ainda. Crie o primeiro pela conversa.</div>';
            return;
        }

        [...projects].sort((a, b) => (b.id || 0) - (a.id || 0)).forEach(p => {
            const item = this.document.createElement("button");
            item.type = "button";
            item.className = "wh-menu-item";
            item.setAttribute?.("role", "menuitem");
            item.innerHTML = `<span>${escapeHtml(p.name || `Projeto #${p.id}`)}</span><small>#${escapeHtml(p.id)}</small>`;
            item.addEventListener("click", () => this.selectExistingProject(p.id));
            this.projectsListContainer.appendChild(item);
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
                const hasOr = Boolean(settingValue(settings, "api.openrouter_key"));
                if (this.badgeOpenRouter) {
                    this.badgeOpenRouter.textContent = hasOr ? "Configurada" : "Não configurada";
                    this.badgeOpenRouter.className = `key-status-badge ${hasOr ? "configured" : "missing"}`;
                }
                if (this.inputOpenRouter && hasOr) {
                    this.inputOpenRouter.placeholder = "sk-or-v1-•••••••••••• (Chave ativa no banco)";
                }

                const hasGem = Boolean(settingValue(settings, "api.gemini_key"));
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
