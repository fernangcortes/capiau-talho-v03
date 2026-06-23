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
                <div class="empty-state" style="padding: 40px 20px;">
                    <i class="fa-solid fa-brain" style="color: var(--color-violet); font-size: 28px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(138, 92, 246, 0.4);"></i>
                    <p style="font-weight: 600;">Como posso ajudar no seu documentário?</p>
                    <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; padding: 0 10px; text-align: center;">
                        Pesquise por falantes, momentos de ação de B-rolls ou trechos de roteiro. <br>
                        Pergunte coisas como: <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"O que o diretor fala sobre lentes?"</span> ou <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"Sugira clipes sobre iluminação"</span>.
                    </p>
                </div>
            `;
            return;
        }

        history.forEach(m => {
            const bubble = document.createElement("div");
            bubble.className = `chat-bubble ${m.role}`;
            
            const meta = document.createElement("div");
            meta.className = "bubble-meta";
            meta.innerHTML = `<span>${m.role === 'user' ? 'Você' : 'Assistente CapIAu-Talho'}</span>`;
            bubble.appendChild(meta);
            
            const textEl = document.createElement("div");
            textEl.className = "chat-bubble-text";
            textEl.innerHTML = this.formatMarkdownLinks(m.content);
            bubble.appendChild(textEl);
            
            this.chatMessages.appendChild(bubble);
        });

        this.scrollToBottom();
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
                
                if (window.libraryManager) {
                    window.libraryManager.openLightbox(photo);
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
