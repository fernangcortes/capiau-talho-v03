// Gerenciador do painel Chatbot RAG e links acionáveis para pulo na timeline.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

export class ChatManager {
    constructor() {
        this.chatMessages = document.getElementById("chat-messages");
        this.chatInput = document.getElementById("chat-input");
        this.btnSend = document.getElementById("btn-send-chat");
        this.btnClearChat = document.getElementById("btn-clear-chat");
        
        this.init();
    }

    init() {
        if (this.btnSend) this.btnSend.addEventListener("click", () => this.sendMessage());
        if (this.chatInput) {
            this.chatInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
        if (this.btnClearChat) {
            this.btnClearChat.addEventListener("click", () => {
                STATE.chatHistory = [];
            });
        }

        // Delegação de cliques para links de mídia dinâmicos
        if (this.chatMessages) {
            this.chatMessages.addEventListener("click", (e) => this.handleChatLinkClick(e));
        }

        STATE.on("chatHistoryUpdated", (history) => this.renderHistory(history));
    }

    async sendMessage() {
        if (!this.chatInput) return;
        const msg = this.chatInput.value.trim();
        if (!msg) return;
        
        this.chatInput.value = "";
        
        // Adiciona mensagem do usuário ao histórico local
        const userMsg = { role: "user", content: msg };
        const updatedHistory = [...STATE.chatHistory, userMsg];
        STATE.chatHistory = updatedHistory;

        // Renderiza estado de digitando...
        this.showTypingIndicator();

        try {
            const response = await CapIAuAPI.chat(STATE.currentProjectId, msg, STATE.chatHistory);
            this.hideTypingIndicator();
            
            // Adiciona resposta da IA ao histórico
            const aiMsg = { role: "assistant", content: response.response };
            STATE.chatHistory = [...STATE.chatHistory, aiMsg];
        } catch (e) {
            this.hideTypingIndicator();
            const errMsg = { role: "assistant", content: `Erro ao processar mensagem RAG: ${e.message}` };
            STATE.chatHistory = [...STATE.chatHistory, errMsg];
        }
    }

    showTypingIndicator() {
        const typingEl = document.createElement("div");
        typingEl.className = "chat-message assistant typing-indicator";
        typingEl.innerHTML = `
            <div class="message-bubble">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        this.chatMessages.appendChild(typingEl);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const indicator = this.chatMessages.querySelector(".typing-indicator");
        if (indicator) {
            indicator.remove();
        }
    }

    renderHistory(history) {
        if (!this.chatMessages) return;
        this.chatMessages.innerHTML = "";
        
        if (history.length === 0) {
            this.chatMessages.innerHTML = `
                <div class="chat-welcome-state">
                    <h3>Assistente IA de Montagem</h3>
                    <p>Pesquise o material e construa roteiros textuais. Experimente perguntar:</p>
                    <ul>
                        <li>"Onde o diretor fala sobre lentes anamórficas?"</li>
                        <li>"Encontre fotos de bastidores com claquetes."</li>
                        <li>"Quais os temas mais debatidos nos depoimentos?"</li>
                    </ul>
                </div>
            `;
            return;
        }

        history.forEach(m => {
            const msgEl = document.createElement("div");
            msgEl.className = `chat-message ${m.role}`;
            
            // Renderiza bolha de texto formatando links especiais
            const formattedContent = this.formatMarkdownLinks(m.content);
            
            msgEl.innerHTML = `
                <div class="message-bubble">${formattedContent}</div>
            `;
            this.chatMessages.appendChild(msgEl);
        });

        this.scrollToBottom();
        if (window.initLucide) window.initLucide();
    }

    formatMarkdownLinks(content) {
        // Converte [Texto](video_id: 2, start: 10.5, end: 20.0) para links clicáveis
        let html = content;
        
        // Regex para capturar links de vídeo: [Texto](video_id: X, start: Y, end: Z)
        const videoRegex = /\[([^\]]+)\]\(video_id:\s*(\d+),\s*start:\s*([\d.]+),\s*end:\s*([\d.]+)\)/g;
        html = html.replace(videoRegex, (match, text, videoId, start, end) => {
            return `<a href="#" class="chat-media-link" data-type="video" data-id="${videoId}" data-start="${start}" data-end="${end}">${text}</a>`;
        });
        
        // Regex para capturar links de foto: [Texto](photo_id: X)
        const photoRegex = /\[([^\]]+)\]\(photo_id:\s*(\d+)\)/g;
        html = html.replace(photoRegex, (match, text, photoId) => {
            return `<a href="#" class="chat-media-link" data-type="photo" data-id="${photoId}">${text}</a>`;
        });

        // Regex para capturar links de doc: [Texto](doc_id: X)
        const docRegex = /\[([^\]]+)\]\(doc_id:\s*(\d+)\)/g;
        html = html.replace(docRegex, (match, text, docId) => {
            return `<a href="#" class="chat-media-link" data-type="doc" data-id="${docId}">${text}</a>`;
        });

        // Converte quebras de linha simples
        return html.replace(/\n/g, "<br>");
    }

    handleChatLinkClick(e) {
        if (!e.target.classList.contains("chat-media-link")) return;
        e.preventDefault();
        
        const type = e.target.dataset.type;
        const id = Number(e.target.dataset.id);
        
        if (type === "video") {
            const start = parseFloat(e.target.dataset.start);
            
            // Localiza o vídeo na lista global
            const video = STATE.allVideos.find(v => v.id === id);
            if (video) {
                STATE.activeVideo = video;
                
                // Aguarda um pequeno instante para o carregamento do source do vídeo no player
                setTimeout(() => {
                    const player = document.getElementById("main-video");
                    if (player) {
                        player.currentTime = start;
                        player.play();
                    }
                }, 150);
            } else {
                alert(`Vídeo com ID ${id} não encontrado na biblioteca.`);
            }
        } else if (type === "photo") {
            const photo = STATE.allPhotos.find(p => p.id === id);
            if (photo) {
                // Simula o clique na foto para abrir no Lightbox
                STATE.currentPhotoList = STATE.allPhotos;
                STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                
                // Alterna para aba de fotos no painel esquerdo
                const btnTabPhotos = document.querySelector('[data-tab="tab-photos"]');
                if (btnTabPhotos) btnTabPhotos.click();
                
                // Emite evento ou chama lightbox (biblioteca escutará)
                const libraryEl = document.getElementById("photo-list");
                if (libraryEl) {
                    const thumb = Array.from(libraryEl.querySelectorAll(".photo-item"))
                                       .find(el => el.querySelector(".item-name").title === photo.filename);
                    if (thumb) thumb.click();
                }
            } else {
                alert(`Foto com ID ${id} não encontrada.`);
            }
        } else if (type === "doc") {
            // Alterna aba esquerda para documentos
            const btnTabDocs = document.querySelector('[data-tab="tab-docs"]');
            if (btnTabDocs) {
                btnTabDocs.click();
            }
            // Highlight doc
            const docList = document.getElementById("doc-list");
            if (docList) {
                const docItem = Array.from(docList.querySelectorAll(".doc-item"))
                                     .find(el => el.querySelector(".item-name").title.includes(`id ${id}`) || el.querySelector(".btn-delete-doc").dataset.id == id);
                if (docItem) {
                    docItem.style.background = "var(--primary-glow)";
                    setTimeout(() => { docItem.style.background = ""; }, 2000);
                }
            }
        }
    }

    scrollToBottom() {
        if (this.chatMessages) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        }
    }
}
