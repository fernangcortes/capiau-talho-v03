// Gerenciador do painel Chatbot RAG e links acionáveis para pulo na timeline.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { getActiveElement, getActiveQuerySelector, SplitterHelper } from "./workspaceManager.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";
import { formatTimecode } from "./player.js";

export class ChatManager {
    constructor() {
        this.init();
    }

    // Getters dinâmicos para suportar popouts (referências atualizadas)
    get chatContainer() { return getActiveElement("chat-container"); }
    get chatMessages() { return getActiveElement("chat-messages"); }
    get chatInput() { return getActiveElement("chat-input"); }
    get btnSend() { return getActiveElement("btn-send-chat"); }
    get btnClearChat() { return getActiveElement("btn-clear-chat"); }
    get btnLayoutToggle() { return getActiveElement("btn-chat-layout"); }
    get mediaGrid() { return getActiveElement("chat-media-grid"); }

    init() {
        // Vincula eventos iniciais na janela principal
        const btnSendMain = document.getElementById("btn-send-chat");
        if (btnSendMain) btnSendMain.addEventListener("click", () => this.sendMessage());

        const chatInputMain = document.getElementById("chat-input");
        if (chatInputMain) {
            chatInputMain.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        const btnClearChatMain = document.getElementById("btn-clear-chat");
        if (btnClearChatMain) {
            btnClearChatMain.addEventListener("click", () => {
                STATE.chatHistory = [];
            });
        }

        // Delegação de cliques para links de mídia legados
        const chatMessagesMain = document.getElementById("chat-messages");
        if (chatMessagesMain) {
            chatMessagesMain.addEventListener("click", (e) => this.handleChatLinkClick(e));
        }

        // Sincronização com o motor de player único
        const miniVideoMain = document.getElementById("chat-mini-video");
        if (miniVideoMain) {
            miniVideoMain.addEventListener("play", () => {
                STATE.emit("playerPlayed", "chat-mini");
            });
        }

        STATE.on("playerPlayed", (sender) => {
            if (sender !== "chat-mini") {
                const miniVideo = getActiveQuerySelector("#chat-mini-video");
                if (miniVideo && !miniVideo.paused) {
                    miniVideo.pause();
                }
            }
        });

        // Listener de histórico de chat
        STATE.on("chatHistoryUpdated", (history) => this.renderHistory(history));

        // Inicializa as configurações do agente de edição (Fase 1)
        this.loadAgentSettings();

        // Inicializa o gerenciamento do layout responsivo e splitter
        this.initLayoutToggle();
    }

    initLayoutToggle() {
        const container = document.getElementById("chat-container");
        if (!container) return;

        // Inicia com layout split por padrão nas resoluções amplas
        container.classList.add("chat-split-mode");

        const checkObserver = () => {
            const btnLayout = this.btnLayoutToggle;
            if (btnLayout) {
                // Remove listeners anteriores para evitar duplicações no popout
                const newBtnLayout = btnLayout.cloneNode(true);
                btnLayout.replaceWith(newBtnLayout);

                newBtnLayout.addEventListener("click", () => {
                    const c = this.chatContainer;
                    if (!c) return;
                    if (c.classList.contains("chat-split-mode")) {
                        c.classList.remove("chat-split-mode");
                        c.classList.add("chat-focus-mode");
                        newBtnLayout.querySelector("span").textContent = "Foco";
                        newBtnLayout.querySelector("i").className = "fa-solid fa-align-center";
                    } else {
                        c.classList.remove("chat-focus-mode");
                        c.classList.add("chat-split-mode");
                        newBtnLayout.querySelector("span").textContent = "Split";
                        newBtnLayout.querySelector("i").className = "fa-solid fa-columns";
                        this.setupSplitter();
                    }
                });
            }
        };

        // Escuta mudanças de tamanho do painel para configurar classes e o splitter
        const chatObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const width = entry.contentRect.width;
                const c = this.chatContainer;
                if (!c) continue;

                if (width >= 550) {
                    c.classList.add("wide-layout");
                    checkObserver();
                    if (c.classList.contains("chat-split-mode")) {
                        this.setupSplitter();
                    }
                } else {
                    c.classList.remove("wide-layout");
                    
                    // Remove splitter se estiver muito estreito
                    const splitter = c.querySelector(".panel-splitter");
                    if (splitter) splitter.remove();
                    
                    const left = c.querySelector(".chat-conversation-pane");
                    if (left) left.style.flex = "1";
                }
            }
        });
        chatObserver.observe(container);
    }

    setupSplitter() {
        const c = this.chatContainer;
        const mainLayout = c ? c.querySelector(".chat-main-layout") : null;
        if (mainLayout) {
            SplitterHelper.initSplitter(mainLayout, ".chat-conversation-pane", "#chat-media-board", {
                minPct: 35,
                maxPct: 75,
                defaultPct: 60
            });
        }
    }

    async loadAgentSettings() {
        const modelSelect = document.getElementById("agent-model-select");
        if (!modelSelect) return;

        try {
            const data = await CapIAuAPI.fetchAgentModels();
            modelSelect.innerHTML = "";

            data.models.forEach(model => {
                const opt = document.createElement("option");
                opt.value = model;
                opt.textContent = model;
                modelSelect.appendChild(opt);
            });

            // O modelo do agente agora vive nas configurações da IA (agent.model);
            // o seletor do chat é apenas um atalho para o mesmo valor global.
            await this.migrateLegacyAgentPrefs(data.models);

            const settings = await CapIAuAPI.fetchSettings(STATE.currentProjectId);
            const resolved = settings.values && settings.values["agent.model"];
            if (resolved && data.models.includes(resolved.value)) {
                modelSelect.value = resolved.value;
            } else if (data.default) {
                modelSelect.value = data.default;
            }

            modelSelect.addEventListener("change", async () => {
                try {
                    await CapIAuAPI.updateGlobalSettings({ "agent.model": modelSelect.value });
                    STATE.emit("settingsChanged", { scope: "global" });
                } catch (err) {
                    console.error("Falha ao salvar modelo do agente:", err);
                }
            });

            // Reflete mudanças feitas pelo painel de configurações
            STATE.on("settingsChanged", async () => {
                try {
                    const s = await CapIAuAPI.fetchSettings(STATE.currentProjectId);
                    const r = s.values && s.values["agent.model"];
                    if (r && data.models.includes(r.value)) modelSelect.value = r.value;
                } catch (_) { /* silencioso: apenas sincronização visual */ }
            });
        } catch (err) {
            console.error("Falha ao carregar modelos do agente:", err);
            modelSelect.innerHTML = `<option value="deepseek/deepseek-v4-flash">deepseek/deepseek-v4-flash (Erro)</option>`;
        }
    }

    // Migração única das preferências antigas do chat (localStorage) para o backend.
    async migrateLegacyAgentPrefs(availableModels) {
        const savedModel = localStorage.getItem("capiau_agent_model");
        const savedKey = localStorage.getItem("capiau_agent_api_key");
        if (!savedModel && !savedKey) return;

        try {
            const settings = await CapIAuAPI.fetchSettings(null);
            const values = {};

            const modelInfo = settings.values && settings.values["agent.model"];
            if (savedModel && availableModels.includes(savedModel) &&
                modelInfo && modelInfo.origin === "default") {
                values["agent.model"] = savedModel;
            }

            const keyInfo = settings.values && settings.values["api.openrouter_key"];
            if (savedKey && keyInfo && keyInfo.origin === "default") {
                if (confirm("Encontrei sua chave OpenRouter salva no navegador (campo antigo do chat). Migrar para o novo painel de configurações da IA? Ela passa a ser guardada no banco local do app.")) {
                    values["api.openrouter_key"] = savedKey;
                }
            }

            if (Object.keys(values).length) {
                await CapIAuAPI.updateGlobalSettings(values);
            }
            localStorage.removeItem("capiau_agent_model");
            localStorage.removeItem("capiau_agent_api_key");
        } catch (err) {
            console.error("Falha na migração das preferências do agente:", err);
        }
    }

    async sendMessage() {
        const input = this.chatInput;
        if (!input) return;
        const msg = input.value.trim();
        if (!msg) return;
        
        input.value = "";
        
        // Adiciona mensagem do usuário ao histórico local
        const userMsg = { role: "user", content: msg };
        const updatedHistory = [...STATE.chatHistory, userMsg];
        STATE.chatHistory = updatedHistory;

        // Renderiza estado de digitando...
        this.showTypingIndicator();

        try {
            // Captura o estado atual da timeline para enviar ao agente
            const clips = STATE.activeTimelineCuts || [];
            const tracks = TIMELINE_STATE ? TIMELINE_STATE.tracks : [];
            const fps = STATE.projectFps || 24.0;

            const modelSelect = document.getElementById("agent-model-select");
            const agentModel = modelSelect ? modelSelect.value : null;

            // A chave API agora é resolvida pelo backend (painel de configurações > .env)
            const response = await CapIAuAPI.chat(
                STATE.currentProjectId,
                msg,
                STATE.chatHistory,
                clips,
                tracks,
                fps,
                agentModel,
                null
            );
            this.hideTypingIndicator();
            
            // Adiciona resposta da IA ao histórico
            const aiMsg = { role: "assistant", content: response.response };
            STATE.chatHistory = [...STATE.chatHistory, aiMsg];

            // Trata as sugestões fantasma da IA (Preview)
            if (TIMELINE_STATE) {
                if (response.suggestions && response.suggestions.length > 0) {
                    TIMELINE_STATE.setGhostSuggestions(response.suggestions);
                } else if (response.final_cuts && response.operations && response.operations.length > 0) {
                    // Limpa sugestões antigas antes de aplicar cortes diretos
                    TIMELINE_STATE.setGhostSuggestions([]);
                    // Ordena cronologicamente: a pista magnética layouta pela ordem do array,
                    // e a cópia-sombra devolve os clipes em ordem de inserção
                    const orderedCuts = [...response.final_cuts].sort(
                        (a, b) => (a.timeline_start || 0) - (b.timeline_start || 0)
                    );
                    // Grava modificações diretas na timeline com suporte a Undo/Redo
                    TIMELINE_HISTORY.record(() => {
                        STATE.activeTimelineCuts = orderedCuts;
                    });
                } else {
                    // Sem operações ou sugestões novas, limpa a ghost track
                    TIMELINE_STATE.setGhostSuggestions([]);
                }
            }
        } catch (e) {
            this.hideTypingIndicator();
            const errMsg = { role: "assistant", content: `Erro ao processar mensagem do agente: ${e.message}` };
            STATE.chatHistory = [...STATE.chatHistory, errMsg];
        }
    }

    showTypingIndicator() {
        const messages = this.chatMessages;
        if (!messages) return;

        const typingEl = document.createElement("div");
        typingEl.className = "chat-bubble assistant typing-indicator";
        typingEl.style.alignSelf = "flex-start";
        typingEl.innerHTML = `
            <div class="bubble-meta"><span>Assistente CapIAu-Talho</span></div>
            <div class="chat-bubble-text" style="display: flex; gap: 4px; padding: 4px 0; align-items: center; height: 12px;">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        messages.appendChild(typingEl);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const messages = this.chatMessages;
        if (!messages) return;

        const indicator = messages.querySelector(".typing-indicator");
        if (indicator) {
            indicator.remove();
        }
    }

    renderHistory(history) {
        const messages = this.chatMessages;
        if (!messages) return;
        
        messages.innerHTML = "";
        
        // Limpa o grid de mídias vinculadas da direita
        const grid = this.mediaGrid;
        if (grid) {
            grid.innerHTML = "";
        }
        
        if (history.length === 0) {
            messages.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px;">
                    <i class="fa-solid fa-brain" style="color: var(--color-violet); font-size: 28px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(138, 92, 246, 0.4);"></i>
                    <p style="font-weight: 600;">Como posso ajudar no seu documentário?</p>
                    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; padding: 0 10px; text-align: center;">
                        Pesquise por falantes, momentos de ação de B-rolls ou trechos de roteiro. <br>
                        Pergunte coisas como: <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"O que o diretor fala sobre lentes?"</span> ou <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"Sugira clipes sobre iluminação"</span>.
                    </p>
                </div>
            `;
            if (grid) {
                grid.innerHTML = `<div class="empty-state-text" style="font-style: italic; color: var(--text-muted); font-size: 11px;">Nenhuma mídia citada no chat ainda.</div>`;
            }
            return;
        }

        const allReferencedMedia = [];

        history.forEach(m => {
            const bubble = document.createElement("div");
            bubble.className = `chat-bubble ${m.role}`;
            
            const meta = document.createElement("div");
            meta.className = "bubble-meta";
            meta.innerHTML = `<span>${m.role === 'user' ? 'Você' : 'Assistente CapIAu-Talho'}</span>`;
            bubble.appendChild(meta);
            
            const textEl = document.createElement("div");
            textEl.className = "chat-bubble-text";
            let formatted = this.formatMarkdownLinks(m.content);
            formatted = this.renderMarkdown(formatted);
            textEl.innerHTML = formatted;
            bubble.appendChild(textEl);
            
            // Adiciona cards interativos para mídias recomendadas
            if (m.role === "assistant") {
                const mediaItems = this.extractMediaLinks(m.content);
                if (mediaItems.length > 0) {
                    const cardsContainer = document.createElement("div");
                    cardsContainer.className = "chat-bubble-cards-list";
                    cardsContainer.style.display = "flex";
                    cardsContainer.style.flexDirection = "column";
                    cardsContainer.style.gap = "8px";
                    cardsContainer.style.marginTop = "8px";
                    cardsContainer.style.width = "100%";
                    
                    mediaItems.forEach(item => {
                        // Acumula referências únicas para o painel lateral
                        const exists = allReferencedMedia.some(x => x.type === item.type && x.id === item.id && x.start === item.start && x.end === item.end);
                        if (!exists) {
                            allReferencedMedia.push(item);
                        }
                        
                        // Card acoplável na conversa
                        const card = this.createMediaCardDOM(item);
                        cardsContainer.appendChild(card);
                    });
                    
                    bubble.appendChild(cardsContainer);
                }
            }
            
            messages.appendChild(bubble);
        });

        // Alimenta a grade de mídias acumuladas na coluna direita
        if (grid && allReferencedMedia.length > 0) {
            grid.innerHTML = "";
            allReferencedMedia.forEach(item => {
                const card = this.createMediaCardDOM(item);
                grid.appendChild(card);
            });
        } else if (grid) {
            grid.innerHTML = `<div class="empty-state-text" style="font-style: italic; color: var(--text-muted); font-size: 11px;">Nenhuma mídia citada no chat ainda.</div>`;
        }

        // Registra o click handler nas bolhas atuais
        messages.addEventListener("click", (e) => this.handleChatLinkClick(e));

        this.scrollToBottom();
    }

    extractMediaLinks(content) {
        const media = [];
        let match;
        
        // Video regex
        const videoRegex = /\[([^\]]+)\]\(video_id:\s*(\d+),\s*start:\s*([\d.]+),\s*end:\s*([\d.]+)\)/g;
        while ((match = videoRegex.exec(content)) !== null) {
            media.push({
                type: "video",
                text: match[1],
                id: Number(match[2]),
                start: parseFloat(match[3]),
                end: parseFloat(match[4])
            });
        }
        
        // Photo regex
        const photoRegex = /\[([^\]]+)\]\(photo_id:\s*(\d+)\)/g;
        while ((match = photoRegex.exec(content)) !== null) {
            media.push({
                type: "photo",
                text: match[1],
                id: Number(match[2])
            });
        }
        
        // Doc regex
        const docRegex = /\[([^\]]+)\]\(doc_id:\s*(\d+)\)/g;
        while ((match = docRegex.exec(content)) !== null) {
            media.push({
                type: "doc",
                text: match[1],
                id: Number(match[2])
            });
        }
        
        return media;
    }

    createMediaCardDOM(item) {
        const card = document.createElement("div");
        card.className = "chat-media-card";
        
        let icon = "fa-file-lines";
        let typeLabel = "Documento";
        let details = "";
        
        if (item.type === "video") {
            icon = "fa-video";
            typeLabel = "Vídeo";
            const dur = item.end - item.start;
            details = `<span class="card-timecode"><i class="fa-regular fa-clock"></i> ${formatTimecode(item.start)} (${dur.toFixed(1)}s)</span>`;
        } else if (item.type === "photo") {
            icon = "fa-camera";
            typeLabel = "Foto Set";
        }
        
        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">
                    <i class="fa-solid ${icon}"></i> <span>${typeLabel} #${item.id}</span>
                </div>
                ${details}
            </div>
            <div class="card-quote">"${item.text}"</div>
            <div class="card-actions">
                <button class="btn-play-card" title="Visualizar mídia"><i class="fa-solid fa-play"></i> Assistir</button>
                ${item.type === 'video' ? `<button class="btn-insert-card" title="Inserir clipe na timeline"><i class="fa-solid fa-plus"></i> Inserir</button>` : ''}
                <button class="btn-locate-card" title="Revelar item na Biblioteca"><i class="fa-solid fa-location-crosshairs"></i> Revelar</button>
            </div>
        `;
        
        // Bind local Play
        card.querySelector(".btn-play-card").addEventListener("click", (e) => {
            e.stopPropagation();
            this.playMediaItem(item);
        });
        
        // Bind Insert
        if (item.type === "video") {
            card.querySelector(".btn-insert-card").addEventListener("click", (e) => {
                e.stopPropagation();
                this.insertVideoToTimeline(item);
            });
        }
        
        // Bind Locate
        card.querySelector(".btn-locate-card").addEventListener("click", (e) => {
            e.stopPropagation();
            this.locateMediaInLibrary(item);
        });
        
        return card;
    }

    playMediaItem(item) {
        if (item.type === "video") {
            const video = STATE.allVideos.find(v => v.id === item.id);
            if (!video) {
                alert(`Vídeo com ID ${item.id} não encontrado na biblioteca.`);
                return;
            }
            
            const container = this.chatContainer;
            const isWide = container && container.classList.contains("wide-layout") && container.classList.contains("chat-split-mode");
            
            if (isWide) {
                // Toca no mini-player local integrado
                const miniVideo = getActiveQuerySelector("#chat-mini-video");
                const miniTitle = getActiveQuerySelector("#chat-mini-player-title");
                if (miniVideo && miniTitle) {
                    const src = video.proxy_path || `/originals/${video.filename}`;
                    miniVideo.src = src;
                    miniTitle.textContent = video.filename;
                    
                    miniVideo.onloadedmetadata = () => {
                        miniVideo.currentTime = item.start;
                        miniVideo.play();
                    };
                    
                    // Escuta timeupdate para pausar e retornar no ponto final do clipe
                    miniVideo.ontimeupdate = () => {
                        if (miniVideo.currentTime >= item.end) {
                            miniVideo.pause();
                            miniVideo.currentTime = item.start;
                            miniVideo.ontimeupdate = null;
                        }
                    };
                }
            } else {
                // Modo padrão/estreito: toca no player principal
                STATE.activeVideo = video;
                setTimeout(() => {
                    const player = document.getElementById("source-video");
                    if (player) {
                        player.currentTime = item.start;
                        player.play();
                    }
                }, 150);
            }
        } else if (item.type === "photo") {
            const photo = STATE.allPhotos.find(p => p.id === item.id);
            if (photo) {
                STATE.currentPhotoList = STATE.allPhotos;
                STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                const btnTabPhotos = getActiveQuerySelector('[data-tab="tab-photos"]');
                if (btnTabPhotos) btnTabPhotos.click();
                if (window.libraryManager) {
                    window.libraryManager.openLightbox(photo);
                }
            } else {
                alert(`Foto com ID ${item.id} não encontrada.`);
            }
        } else if (item.type === "doc") {
            const btnTabDocs = getActiveQuerySelector('[data-tab="tab-docs"]');
            if (btnTabDocs) btnTabDocs.click();
            
            setTimeout(() => {
                const docItem = getActiveQuerySelector(`.media-card[data-doc-id="${item.id}"]`);
                if (docItem) {
                    docItem.scrollIntoView({ behavior: "smooth", block: "center" });
                    docItem.style.background = "var(--primary-glow)";
                    setTimeout(() => { docItem.style.background = ""; }, 2000);
                }
            }, 150);
        }
    }

    insertVideoToTimeline(item) {
        if (item.type === "video") {
            const video = STATE.allVideos.find(v => v.id === item.id);
            if (video) {
                TIMELINE_STATE.addCut(item.id, item.start, item.end, null);
                console.log(`[ChatManager] Clipe inserido: vídeo ${item.id} (${item.start}s - ${item.end}s)`);
            }
        } else if (item.type === "photo") {
            const photo = STATE.allPhotos.find(p => p.id === item.id);
            if (photo) {
                TIMELINE_STATE.addPhotoCut(item.id, {});
                console.log(`[ChatManager] Foto inserida na timeline: ${item.id}`);
            }
        }
    }

    expandParentFolders(card) {
        let parent = card.parentElement;
        while (parent) {
            // Se encontrar um container de filhos de pasta que esteja oculto, exibe-o
            if (parent.classList.contains("tree-folder-children") || (parent.style && parent.style.display === "none")) {
                parent.style.display = "block";
                
                // Encontra o cabeçalho correspondente da pasta para atualizar chevron/ícone
                const header = parent.previousElementSibling;
                if (header) {
                    const chevron = header.querySelector(".chevron-icon");
                    if (chevron) {
                        chevron.classList.remove("fa-chevron-right");
                        chevron.classList.add("fa-chevron-down");
                    }
                    const folderIcon = header.querySelector(".folder-icon");
                    if (folderIcon) {
                        folderIcon.classList.remove("fa-folder");
                        folderIcon.classList.add("fa-folder-open");
                    }
                }
            }
            parent = parent.parentElement;
        }
    }

    locateMediaInLibrary(item) {
        if (item.type === "video") {
            const btnTabVideos = getActiveQuerySelector('.tab-btn[data-tab="tab-videos"]');
            if (btnTabVideos) btnTabVideos.click();
            
            setTimeout(() => {
                const card = getActiveQuerySelector(`.media-card.tree-file-item[data-video-id="${item.id}"]`);
                if (card) {
                    this.expandParentFolders(card);
                    
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                    card.style.background = "rgba(6, 182, 212, 0.3)";
                    card.style.borderColor = "var(--color-cyan)";
                    setTimeout(() => {
                        card.style.background = "";
                        card.style.borderColor = "";
                    }, 2000);
                }
            }, 150);
        } else if (item.type === "photo") {
            const btnTabPhotos = getActiveQuerySelector('.tab-btn[data-tab="tab-photos"]');
            if (btnTabPhotos) btnTabPhotos.click();
            
            setTimeout(() => {
                const card = getActiveQuerySelector(`.photo-card[data-photo-id="${item.id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                    card.style.background = "rgba(6, 182, 212, 0.3)";
                    card.style.borderColor = "var(--color-cyan)";
                    setTimeout(() => {
                        card.style.background = "";
                        card.style.borderColor = "";
                    }, 2000);
                }
            }, 150);
        } else if (item.type === "doc") {
            const btnTabDocs = getActiveQuerySelector('.tab-btn[data-tab="tab-docs"]');
            if (btnTabDocs) btnTabDocs.click();
            
            setTimeout(() => {
                const card = getActiveQuerySelector(`.media-card[data-doc-id="${item.id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                    card.style.background = "rgba(6, 182, 212, 0.3)";
                    card.style.borderColor = "var(--color-cyan)";
                    setTimeout(() => {
                        card.style.background = "";
                        card.style.borderColor = "";
                    }, 2000);
                }
            }, 150);
        }
    }

    formatMarkdownLinks(content) {
        // Converte [Texto](video_id: 2, start: 10.5, end: 20.0) para links clicáveis
        let html = content;
        
        const videoRegex = /\[([^\]]+)\]\(video_id:\s*(\d+),\s*start:\s*([\d.]+),\s*end:\s*([\d.]+)\)/g;
        html = html.replace(videoRegex, (match, text, videoId, start, end) => {
            return `<a href="#" class="chat-media-link" data-type="video" data-id="${videoId}" data-start="${start}" data-end="${end}"><i class="fa-solid fa-video"></i> ${text}</a>`;
        });
        
        const photoRegex = /\[([^\]]+)\]\(photo_id:\s*(\d+)\)/g;
        html = html.replace(photoRegex, (match, text, photoId) => {
            return `<a href="#" class="chat-media-link" data-type="photo" data-id="${photoId}"><i class="fa-solid fa-camera"></i> ${text}</a>`;
        });

        const docRegex = /\[([^\]]+)\]\(doc_id:\s*(\d+)\)/g;
        html = html.replace(docRegex, (match, text, docId) => {
            return `<a href="#" class="chat-media-link" data-type="doc" data-id="${docId}"><i class="fa-solid fa-file-lines"></i> ${text}</a>`;
        });

        return html.replace(/\n/g, "<br>");
    }

    renderMarkdown(text) {
        let html = text;
        
        // Negrito: **texto** -> <strong>texto</strong>
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Itálico: *texto* -> <em>texto</em>
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        
        // Cabeçalhos: ### texto -> h4, ## texto -> h3, # texto -> h2
        html = html.replace(/^###\s*(.*?)$/gm, '<h4 style="margin: 6px 0; color: var(--color-cyan); font-size:12px;">$1</h4>');
        html = html.replace(/^##\s*(.*?)$/gm, '<h3 style="margin: 8px 0; color: var(--color-violet); font-size:13px;">$1</h3>');
        html = html.replace(/^#\s*(.*?)$/gm, '<h2 style="margin: 10px 0; color: #fff; font-size:14px;">$1</h2>');

        // Listas: - item ou * item
        html = html.replace(/^\s*[-*]\s*(.*?)$/gm, '<div style="display:flex; align-items:flex-start; gap:6px; margin: 4px 0 4px 12px;"><i class="fa-solid fa-circle" style="font-size:4px; color:var(--color-cyan); margin-top: 6px;"></i> <span>$1</span></div>');

        // Linha Horizontal: ---
        html = html.replace(/^---$/gm, '<hr style="border:none; border-top: 1px solid var(--border-glass); margin: 10px 0;">');

        return html;
    }

    handleChatLinkClick(e) {
        if (!e.target.classList.contains("chat-media-link")) return;
        e.preventDefault();
        
        const type = e.target.dataset.type;
        const id = Number(e.target.dataset.id);
        const start = e.target.dataset.start ? parseFloat(e.target.dataset.start) : 0;
        const end = e.target.dataset.end ? parseFloat(e.target.dataset.end) : 0;
        
        this.playMediaItem({ type, id, start, end, text: e.target.textContent });
    }

    scrollToBottom() {
        const messages = this.chatMessages;
        if (messages) {
            messages.scrollTop = messages.scrollHeight;
        }
    }
}
