// Gerenciador de Painéis: Transcrição, Timelines, Temas e Fila de Tarefas.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { formatTimecode, showAnnotationModal } from "./player.js";
import { CapiauTimelineRenderer } from "./timelineRenderer.js";
import { CapiauTimelineInteraction } from "./timelineInteraction.js";
import { TIMELINE_STATE } from "./timelineState.js";

export class PanelsManager {
    constructor() {
        this.transcriptContainer = document.getElementById("transcript-container");
        this.visionContainer = document.getElementById("vision-container");
        this.themesContainer = document.getElementById("theme-list");
        this.tasksContainer = document.getElementById("tasks-container");
        
        // Inicializa o novo renderizador Canvas e interações
        this.timelineRenderer = new CapiauTimelineRenderer();
        this.timelineInteraction = new CapiauTimelineInteraction(this.timelineRenderer);
        
        // Expõe no window para sincronização com pop-outs (WorkspaceManager)
        window.timelineRenderer = this.timelineRenderer;
        window.timelineInteraction = this.timelineInteraction;
        
        this.btnCluster = document.getElementById("btn-cluster");
        this.btnSaveTimeline = document.getElementById("btn-save-timeline");
        this.btnExportTimeline = document.getElementById("btn-export-timeline");
        
        // Scissors Mode
        this.btnScissors = document.getElementById("btn-scissors");
        
        this.init();
    }

    init() {
        STATE.on("activeVideoChanged", (video) => this.onVideoChanged(video));
        STATE.on("transcriptUpdated", (dialogues) => this.renderTranscript(dialogues));
        STATE.on("visionFramesUpdated", (frames) => this.renderVision(frames));
        STATE.on("timelineCutsUpdated", (cuts) => this.renderTimeline(cuts));
        STATE.on("scissorsModeChanged", (active) => this.toggleScissorsUI(active));
        STATE.on("projectChanged", () => this.loadThemes());
        STATE.on("videoFacesUpdated", (videoId) => {
            if (STATE.activeVideo && STATE.activeVideo.id === videoId) {
                this.renderVision(STATE.activeVisionFrames);
            }
        });
        
        
        if (this.btnCluster) this.btnCluster.addEventListener("click", () => this.runClustering());
        
        const btnAnalyzeVisionNow = document.getElementById("btn-analyze-vision-now");
        if (btnAnalyzeVisionNow) {
            btnAnalyzeVisionNow.addEventListener("click", async () => {
                if (!STATE.activeVideo) {
                    alert("Selecione um vídeo na Biblioteca para analisar.");
                    return;
                }
                try {
                    await CapIAuAPI.analyzeVideoVision(STATE.activeVideo.id);
                    alert("Análise visual do B-roll iniciada! O progresso será exibido na aba de Tarefas.");
                } catch (err) {
                    alert("Erro ao iniciar análise: " + err.message);
                }
            });
        }

        const btnAnalyzeVisionAll = document.getElementById("btn-analyze-vision-all");
        if (btnAnalyzeVisionAll) {
            btnAnalyzeVisionAll.addEventListener("click", async () => {
                const force = confirm("Deseja FORÇAR a reanálise de TODAS as mídias do projeto (incluindo as já analisadas) para aplicar a nova configuração?\n\nClique em 'OK' para reanalisar tudo de novo, ou 'Cancelar' para analisar apenas as novas/pendentes.");
                if (force) {
                    try {
                        await CapIAuAPI.analyzeAllVision(STATE.currentProjectId, true);
                        alert("Reanálise completa em lote de IA disparada! Acompanhe o progresso na aba de tarefas.");
                    } catch (err) {
                        alert("Erro ao disparar reanálise: " + err.message);
                    }
                } else {
                    if (confirm("Disparar análise apenas para as novas mídias pendentes?")) {
                        try {
                            await CapIAuAPI.analyzeAllVision(STATE.currentProjectId, false);
                            alert("Análise de mídias pendentes disparada! Acompanhe o progresso na aba de tarefas.");
                        } catch (err) {
                            alert("Erro ao disparar análise: " + err.message);
                        }
                    }
                }
            });
        }

        if (this.btnSaveTimeline) this.btnSaveTimeline.addEventListener("click", () => this.saveActiveTimeline());
        if (this.btnExportTimeline) {
            this.btnExportTimeline.addEventListener("click", () => this.exportTimelinePrompt());
        }
        if (this.btnScissors) {
            this.btnScissors.addEventListener("click", () => {
                STATE.activeScissorsMode = !STATE.activeScissorsMode;
            });
        }

        const selectAiPersona = document.getElementById("select-ai-persona");
        if (selectAiPersona) {
            selectAiPersona.addEventListener("change", () => this.onAiPersonaSelect());
        }

        // Sliders de Volume das Trilhas
        const volV1 = document.getElementById("volume-v1");
        if (volV1) {
            volV1.addEventListener("input", (e) => {
                TIMELINE_STATE.trackVolumes.V1 = parseFloat(e.target.value);
                STATE.emit("timelineCutsUpdated");
            });
        }
        
        const volV2 = document.getElementById("volume-v2");
        if (volV2) {
            volV2.addEventListener("input", (e) => {
                TIMELINE_STATE.trackVolumes.V2 = parseFloat(e.target.value);
                STATE.emit("timelineCutsUpdated");
            });
        }

        // Botões de Mute das Trilhas
        const btnMuteV1 = document.getElementById("btn-mute-v1");
        if (btnMuteV1) {
            btnMuteV1.addEventListener("click", () => {
                TIMELINE_STATE.trackMuted.V1 = !TIMELINE_STATE.trackMuted.V1;
                btnMuteV1.innerHTML = TIMELINE_STATE.trackMuted.V1 
                    ? `<i class="fa-solid fa-volume-xmark" style="color: var(--color-rose);"></i>` 
                    : `<i class="fa-solid fa-volume-high"></i>`;
                STATE.emit("timelineCutsUpdated");
            });
        }

        const btnMuteV2 = document.getElementById("btn-mute-v2");
        if (btnMuteV2) {
            btnMuteV2.addEventListener("click", () => {
                TIMELINE_STATE.trackMuted.V2 = !TIMELINE_STATE.trackMuted.V2;
                btnMuteV2.innerHTML = TIMELINE_STATE.trackMuted.V2 
                    ? `<i class="fa-solid fa-volume-xmark" style="color: var(--color-rose);"></i>` 
                    : `<i class="fa-solid fa-volume-high"></i>`;
                STATE.emit("timelineCutsUpdated");
            });
        }

        // Modal de Ajuda / Atalhos de Teclado
        const btnHelp = document.getElementById("btn-timeline-help");
        const btnCloseHelp = document.getElementById("btn-close-help");
        const modalHelp = document.getElementById("modal-timeline-help");

        if (btnHelp && modalHelp) {
            btnHelp.addEventListener("click", () => {
                modalHelp.style.display = "flex";
            });
        }

        if (btnCloseHelp && modalHelp) {
            btnCloseHelp.addEventListener("click", () => {
                modalHelp.style.display = "none";
            });
        }

        // Foco do teclado para o player Program ao clicar em qualquer parte do painel da timeline
        const timelinePanel = document.getElementById("timeline-panel");
        if (timelinePanel) {
            timelinePanel.addEventListener("click", () => {
                window.activeFocusedPlayer = "program";
                console.log("[Player] Foco do teclado definido para PROGRAM (via timeline-panel)");
            });
        }

        // Inicia pooling de progresso de tarefas a cada 2.5 segundos
        this.startTasksProgressLoop();
    }

    async onVideoChanged(video) {
        if (!video) {
            this.transcriptContainer.innerHTML = `<div class="empty-state-text">Nenhum depoimento selecionado.</div>`;
            this.visionContainer.innerHTML = `<div class="empty-state-text">Nenhum B-roll selecionado.</div>`;
            return;
        }

        // Reseta scissors mode
        STATE.activeScissorsMode = false;

        // Se for depoimento, carrega transcrição
        if (video.video_type === "interview" || video.status === "transcribed") {
            this.transcriptContainer.innerHTML = `<div class="loading-state-text">Carregando transcrição...</div>`;
            try {
                const data = await CapIAuAPI.fetchTranscript(video.id);
                STATE.activeTranscript = data.dialogues || [];
                STATE.activeTranscriptWords = data.words || [];
            } catch (e) {
                this.transcriptContainer.innerHTML = `<div class="empty-state-text">Erro ao obter transcrição. Certifique-se de iniciar o ASR.</div>`;
            }
        } else {
            this.transcriptContainer.innerHTML = `<div class="empty-state-text">Mídia classificada como B-Roll. Use a aba "Visão IA" ao lado.</div>`;
        }

        // Se for B-roll, carrega frames
        if (video.video_type === "broll" || video.status === "analyzed") {
            this.visionContainer.innerHTML = `<div class="loading-state-text">Carregando frames de visão...</div>`;
            try {
                const data = await CapIAuAPI.fetchVideoVision(video.id, STATE.currentProjectId);
                STATE.activeVisionFrames = data.frames || [];
            } catch (e) {
                this.visionContainer.innerHTML = `<div class="empty-state-text">Sem descrições de frames indexadas para esse clipe.</div>`;
            }
        } else {
            this.visionContainer.innerHTML = `<div class="empty-state-text">Mídia classificada como depoimento. Use a aba "Transcrição" ao lado.</div>`;
        }
    }

    createBubbleDOM(d, idx, dialogues) {
        const bubble = document.createElement("div");
        bubble.className = "transcript-bubble";
        bubble.setAttribute("data-dialogue-index", idx);
        
        // Determina as palavras do bloco
        let bubbleWords = [];
        if (STATE.activeTranscriptWords && STATE.activeTranscriptWords.length > 0) {
            bubbleWords = STATE.activeTranscriptWords.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
        }
        
        if (bubbleWords.length === 0) {
            const words = d.text.split(" ");
            const duration = d.end_time - d.start_time;
            const wordDur = duration / Math.max(1, words.length);
            bubbleWords = words.map((w, i) => ({
                word: w,
                start_time: d.start_time + i * wordDur,
                end_time: d.start_time + (i + 1) * wordDur
            }));
        }
        
        const metaDiv = document.createElement("div");
        metaDiv.className = "bubble-meta";
        
        const speakerSpan = document.createElement("span");
        speakerSpan.className = "speaker-name";
        speakerSpan.textContent = d.speaker_id;
        
        const timeSpan = document.createElement("span");
        timeSpan.className = "bubble-time";
        timeSpan.textContent = formatTimecode(d.start_time);
        
        metaDiv.appendChild(speakerSpan);
        metaDiv.appendChild(timeSpan);
        
        // Botão de tesoura individual para divisão de bloco
        const splitBtn = document.createElement("button");
        splitBtn.className = "btn-card-action split-btn";
        splitBtn.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        splitBtn.title = "Dividir falas (Tesoura)";
        splitBtn.style.marginLeft = "auto";
        splitBtn.style.color = "var(--text-muted)";
        splitBtn.style.cursor = "pointer";
        splitBtn.style.background = "transparent";
        splitBtn.style.border = "none";
        
        metaDiv.appendChild(splitBtn);
        bubble.appendChild(metaDiv);
        
        const textDiv = document.createElement("div");
        textDiv.className = "bubble-text";
        
        let selectedWordForSplit = null;
        
        bubbleWords.forEach((w, wIdx) => {
            const span = document.createElement("span");
            span.className = "word-span";
            span.setAttribute("data-start", w.start_time);
            span.setAttribute("data-end", w.end_time);
            span.textContent = w.word;
            
            span.addEventListener("click", (e) => {
                if (bubble.classList.contains("scissors-active")) {
                    e.stopPropagation();
                    bubble.querySelectorAll(".word-span.to-split").forEach(el => el.classList.remove("to-split"));
                    span.classList.add("to-split");
                    selectedWordForSplit = w;
                    splitBtn.style.color = "var(--color-rose)";
                } else {
                    e.stopPropagation();
                    const player = document.getElementById("source-video");
                    if (player) {
                        player.currentTime = w.start_time;
                        player.play();
                    }
                }
            });
            
            if (wIdx > 0) {
                const nextWord = w.word;
                if (![".", ",", "!", "?", ";", ":"].includes(nextWord)) {
                    textDiv.appendChild(document.createTextNode(" "));
                }
            }
            textDiv.appendChild(span);
        });
        
        bubble.appendChild(textDiv);
        
        // Lógica de toggle/execução do modo tesoura
        splitBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!bubble.classList.contains("scissors-active")) {
                document.querySelectorAll(".transcript-bubble.scissors-active").forEach(el => {
                    el.classList.remove("scissors-active");
                    const bBtn = el.querySelector(".split-btn");
                    if (bBtn) bBtn.style.color = "var(--text-muted)";
                });
                
                bubble.classList.add("scissors-active");
                splitBtn.style.color = "var(--color-cyan)";
                STATE.emit("statusChanged", { text: "Clique em uma palavra do balão para selecionar o ponto de divisão.", active: true });
            } else {
                if (selectedWordForSplit) {
                    const newSpeaker = prompt("Digite o ID/Nome do novo falante:", d.speaker_id + "_2");
                    if (newSpeaker) {
                        try {
                            await CapIAuAPI.splitTranscript(STATE.activeVideo.id, selectedWordForSplit.start_time, newSpeaker);
                            this.onVideoChanged(STATE.activeVideo);
                        } catch (err) {
                            alert(`Falha ao dividir transcrição: ${err.message}`);
                        }
                    }
                } else {
                    alert("Selecione uma palavra clicando nela primeiro!");
                }
                bubble.classList.remove("scissors-active");
                splitBtn.style.color = "var(--text-muted)";
                bubble.querySelectorAll(".word-span.to-split").forEach(el => el.classList.remove("to-split"));
            }
        });
        
        bubble.addEventListener("click", () => {
            const player = document.getElementById("source-video");
            if (player) {
                player.currentTime = d.start_time;
                player.play();
            }
        });
        
        return bubble;
    }

    renderTranscript(dialogues) {
        if (!this.transcriptContainer) return;
        this.transcriptContainer.innerHTML = "";
        
        if (dialogues.length === 0) {
            this.transcriptContainer.innerHTML = `<div class="empty-state-text">Transcrição pendente ou vazia. Clique em "Transcrever" na biblioteca.</div>`;
            return;
        }

        const groups = [];
        let currentGroup = [];
        
        dialogues.forEach((d, idx) => {
            if (idx === 0) {
                currentGroup.push({ dialogue: d, originalIndex: idx });
            } else {
                const prev = dialogues[idx - 1];
                if (d.start_time < prev.end_time) {
                    currentGroup.push({ dialogue: d, originalIndex: idx });
                } else {
                    groups.push(currentGroup);
                    currentGroup = [{ dialogue: d, originalIndex: idx }];
                }
            }
        });
        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }
        
        groups.forEach(group => {
            if (group.length === 1) {
                const item = group[0];
                const bubble = this.createBubbleDOM(item.dialogue, item.originalIndex, dialogues);
                this.transcriptContainer.appendChild(bubble);
            } else {
                const overlapContainer = document.createElement("div");
                overlapContainer.className = "overlap-row";
                overlapContainer.style.display = "flex";
                overlapContainer.style.flexDirection = "row";
                overlapContainer.style.gap = "10px";
                overlapContainer.style.width = "100%";
                overlapContainer.style.marginBottom = "10px";
                
                group.forEach(item => {
                    const bubble = this.createBubbleDOM(item.dialogue, item.originalIndex, dialogues);
                    bubble.style.flex = "1";
                    bubble.style.marginBottom = "0px";
                    bubble.classList.add("overlap-bubble");
                    overlapContainer.appendChild(bubble);
                });
                
                this.transcriptContainer.appendChild(overlapContainer);
            }
        });
    }

    async renderVision(frames) {
        if (!this.visionContainer) return;
        this.visionContainer.innerHTML = "";

        if (frames.length === 0) {
            this.visionContainer.innerHTML = `<div class="empty-state-text">Visão IA não executada para este B-Roll. Clique em "Análise Visão" na biblioteca.</div>`;
            return;
        }

        // 1. Criar container de tags de marcações no topo
        const tagsHeader = document.createElement("div");
        tagsHeader.className = "vision-tags-header";
        tagsHeader.style.display = "flex";
        tagsHeader.style.flexDirection = "column";
        tagsHeader.style.gap = "6px";
        tagsHeader.style.marginBottom = "15px";
        tagsHeader.style.padding = "10px";
        tagsHeader.style.borderRadius = "8px";
        tagsHeader.style.border = "1px solid var(--border-glass)";
        tagsHeader.style.background = "rgba(0, 0, 0, 0.2)";
        tagsHeader.innerHTML = `
            <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600; display:flex; align-items:center; gap:6px;">
                <i class="fa-solid fa-tags" style="color:var(--color-cyan);"></i> Pessoas/Objetos Marcados:
            </div>
            <div class="vision-tags-list" style="display:flex; flex-wrap:wrap; gap:6px;">
                <span style="font-size:11px; color:var(--text-secondary); font-style:italic;">Carregando marcações...</span>
            </div>
        `;
        this.visionContainer.appendChild(tagsHeader);
        
        const tagsListEl = tagsHeader.querySelector(".vision-tags-list");

        // 2. Criar container da lista de descrição dos frames
        const framesListContainer = document.createElement("div");
        framesListContainer.className = "vision-frames-list";
        framesListContainer.style.display = "flex";
        framesListContainer.style.flexDirection = "column";
        framesListContainer.style.gap = "10px";
        this.visionContainer.appendChild(framesListContainer);

        frames.forEach(f => {
            const row = document.createElement("div");
            row.className = "vision-frame-row";
            row.innerHTML = `
                <div class="vision-timecode">${formatTimecode(f.timestamp)}</div>
                <div class="vision-description" style="user-select: text; cursor: text;">${f.description}</div>
            `;
            
            const descDiv = row.querySelector(".vision-description");
            descDiv.addEventListener("mouseup", (e) => {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();
                if (selectedText.length > 1) {
                    e.stopPropagation();
                    this.showFloatingLinkButton(e.clientX, e.clientY, selectedText, f.timestamp, STATE.activeVideo.id);
                }
            });

            row.addEventListener("click", (e) => {
                const selection = window.getSelection();
                if (selection && selection.toString().trim().length > 0) {
                    // Ignora o clique se o usuário estiver apenas selecionando texto
                    return;
                }
                const player = document.getElementById("source-video");
                if (player) {
                    player.currentTime = f.timestamp;
                    player.play();
                }
            });
            framesListContainer.appendChild(row);
        });

        // 3. Carregar marcações/tags
        if (STATE.activeVideo) {
            try {
                const faces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id);
                const uniqueNames = [...new Set(faces.map(face => face.name).filter(n => n))];
                tagsListEl.innerHTML = "";
                if (uniqueNames.length === 0) {
                    tagsListEl.innerHTML = `<span style="font-size:11px; color:var(--text-secondary); font-style:italic;">Nenhuma pessoa ou objeto marcado neste vídeo.</span>`;
                } else {
                    uniqueNames.forEach(name => {
                        const tag = document.createElement("span");
                        tag.textContent = name;
                        tag.className = "badge";
                        tag.style.fontSize = "10px";
                        tag.style.padding = "3px 8px";
                        tag.style.borderRadius = "12px";
                        tag.style.background = "rgba(6, 182, 212, 0.15)";
                        tag.style.border = "1px solid rgba(6, 182, 212, 0.4)";
                        tag.style.color = "var(--color-cyan)";
                        tagsListEl.appendChild(tag);
                    });
                }
            } catch (err) {
                console.error("Erro ao carregar faces do vídeo para tags da visão:", err);
                tagsListEl.innerHTML = `<span style="font-size:11px; color:var(--text-secondary); font-style:italic;">Erro ao carregar marcações.</span>`;
            }
        }
    }

    toggleScissorsUI(active) {
        if (!this.btnScissors) return;
        if (active) {
            this.btnScissors.classList.add("active");
            this.btnScissors.title = "Modo Tesoura Ativo (Clique nas palavras para cortar/separar falante)";
        } else {
            this.btnScissors.classList.remove("active");
            this.btnScissors.title = "Modo Tesoura (Dividir Falas)";
        }
    }

    async splitTranscript(startTime) {
        if (!STATE.activeVideo) return;
        const newSpeaker = prompt("Digite o ID/Nome do novo falante a partir deste ponto:");
        if (!newSpeaker) return;
        
        try {
            await CapIAuAPI.splitTranscript(STATE.activeVideo.id, startTime, newSpeaker);
            STATE.activeScissorsMode = false;
            // Força o reload da transcrição
            this.onVideoChanged(STATE.activeVideo);
        } catch (e) {
            alert(`Falha ao dividir transcrição: ${e.message}`);
        }
    }

    async runClustering() {
        if (confirm("IA analisará todas as falas das entrevistas gravadas para agrupar temas em comum. Prosseguir?")) {
            await CapIAuAPI.clusterThemes(STATE.currentProjectId);
            alert("Clustering temático iniciado em background.");
            this.loadThemes();
        }
    }

    async loadThemes() {
        if (!this.themesContainer) return;
        try {
            const data = await CapIAuAPI.fetchThemes(STATE.currentProjectId);
            this.themesContainer.innerHTML = "";
            const themes = data.themes || [];
            
            if (themes.length === 0) {
                this.themesContainer.innerHTML = `
                    <div style="color:var(--text-muted); font-size:11px; padding:12px; text-align:center;">
                        Nenhum tema catalogado ainda. Clique em "Agrupar Temas" no cabeçalho para gerar o clustering por IA!
                    </div>
                `;
                return;
            }
            
            themes.forEach(t => {
                const card = document.createElement("div");
                card.className = "media-card";
                card.style.flexDirection = "column";
                card.style.alignItems = "flex-start";
                card.style.gap = "6px";
                card.style.padding = "12px";
                
                card.innerHTML = `
                    <h4 style="color: var(--color-cyan); margin: 0; font-size: 12px; font-weight: 600; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-brain"></i> ${t.title}</h4>
                    <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.4; text-align: left;">${t.description}</p>
                    <div style="display:flex; gap:6px; margin-top:6px; width: 100%;">
                        <button class="btn-primary btn-theme-search" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; border: none;" data-title="${t.title}">
                            <i class="fa-solid fa-magnifying-glass"></i> Buscar Cortes
                        </button>
                        <button class="btn-secondary btn-theme-chat" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; color: var(--text-primary); border: none;" data-title="${t.title}">
                            <i class="fa-solid fa-comments"></i> Perguntar IA
                        </button>
                    </div>
                `;
                
                // Listeners
                const searchBtn = card.querySelector(".btn-theme-search");
                searchBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const title = searchBtn.getAttribute("data-title");
                    const searchInput = document.getElementById("semantic-search-input");
                    const filterSelect = document.getElementById("search-filter");
                    if (searchInput) {
                        searchInput.value = title;
                        if (filterSelect) filterSelect.value = ""; // todas as mídias
                        window.runSemanticSearch();
                    }
                });
                
                const chatBtn = card.querySelector(".btn-theme-chat");
                chatBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const title = chatBtn.getAttribute("data-title");
                    
                    // Alternar para aba do chat
                    const btnTabChat = document.getElementById("btn-tab-chat");
                    if (btnTabChat) {
                        btnTabChat.click();
                    }
                    
                    // Preencher input do chat e disparar
                    setTimeout(() => {
                        const chatTextarea = document.getElementById("chat-input-textarea");
                        const chatSendBtn = document.getElementById("chat-send-btn");
                        if (chatTextarea && chatSendBtn) {
                            chatTextarea.value = `Quais mídias e reflexões temos relacionadas ao tema '${title}'?`;
                            chatSendBtn.click();
                        }
                    }, 100);
                });
                
                this.themesContainer.appendChild(card);
            });
        } catch (e) {
            this.themesContainer.innerHTML = `<div class="empty-state-text">Erro ao carregar temas.</div>`;
        }
    }

    renderTimeline(cuts) {
        if (this.timelineRenderer) {
            this.timelineRenderer.requestRedraw();
        }
    }

    async saveActiveTimeline() {
        if (STATE.activeTimelineCuts.length === 0) {
            alert("A timeline está vazia.");
            return;
        }
        const name = prompt("Digite um nome para esta versão da timeline:", "Versão 1 - Rascunho");
        if (!name) return;
        
        try {
            const cuts = STATE.activeTimelineCuts.map(c => ({
                video_id: c.video_id,
                in_time: c.in,
                out_time: c.out,
                track: c.track
            }));
            await CapIAuAPI.saveTimeline(STATE.currentProjectId, name, "Corte criado no editor", cuts);
            alert("Timeline salva com sucesso no banco SQLite.");
        } catch (e) {
            alert("Erro ao salvar timeline.");
        }
    }

    async exportTimelinePrompt() {
        const format = prompt("Selecione o formato de exportação ('xml', 'edl' ou 'otio'):", "xml");
        if (!format) return;
        
        if (format !== "xml" && format !== "edl" && format !== "otio") {
            alert("Formato inválido. Use 'xml', 'edl' ou 'otio'.");
            return;
        }

        try {
            // Buscamos a última timeline salva do projeto
            const timelines = await CapIAuAPI.fetchTimelines(STATE.currentProjectId);
            if (timelines.length === 0) {
                alert("Nenhuma timeline salva encontrada. Por favor, salve a timeline antes de exportar.");
                return;
            }
            const lastTimelineId = timelines[0].id;
            
            // Dispara download direto do endpoint
            window.open(`/api/timeline/${lastTimelineId}/export/${format}`, "_blank");
        } catch (e) {
            alert("Falha ao exportar arquivo de timeline.");
        }
    }

    // Fila de Conversão (Tasks Progress loop)
    startTasksProgressLoop() {
        setInterval(async () => {
            if (!this.tasksContainer) return;
            try {
                const tasks = await CapIAuAPI.fetchConversions();
                this.renderTasks(tasks);
            } catch (e) {
                // Falha silenciosa de pooling offline
            }
        }, 2500);
    }

    renderTasks(tasks) {
        const taskKeys = Object.keys(tasks);
        this.tasksContainer.innerHTML = "";
        
        if (taskKeys.length === 0) {
            this.tasksContainer.innerHTML = `<div class="empty-state-text">Nenhuma conversão de proxy ou análise ativa no momento.</div>`;
            return;
        }

        taskKeys.forEach(key => {
            const t = tasks[key];
            const item = document.createElement("div");
            item.className = "task-progress-card";
            
            const isFinished = t.status === "finished";
            const isFailed = t.status === "failed";
            
            item.innerHTML = `
                <div class="task-info">
                    <span class="task-title">Mídia ID: ${key} (${t.type || 'proxy'})</span>
                    <span class="task-status status-${t.status}">${t.status.toUpperCase()}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: ${t.percent}%"></div>
                </div>
                <div class="task-actions">
                    <span class="task-percent">${t.percent}%</span>
                    ${(!isFinished && !isFailed && !isNaN(Number(key))) ? `<button class="btn-action btn-cancel-task" data-id="${key}">Cancelar</button>` : ''}
                </div>
            `;
            
            const cancelBtn = item.querySelector(".btn-cancel-task");
            if (cancelBtn) {
                cancelBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm("Cancelar codificação de proxy desta mídia?")) {
                        await CapIAuAPI.cancelConversion(Number(key));
                    }
                });
            }
            
            if (isFinished) {
                item.style.cursor = "pointer";
                item.title = "Clique para abrir esta mídia";
                
                // Efeito hover simples
                item.addEventListener("mouseenter", () => {
                    item.style.background = "rgba(255, 255, 255, 0.05)";
                    item.style.transform = "translateY(-1px)";
                });
                item.addEventListener("mouseleave", () => {
                    item.style.background = "";
                    item.style.transform = "";
                });
                
                item.addEventListener("click", () => {
                    if (key.startsWith("photo-")) {
                        const photoId = Number(key.split("photo-")[1]);
                        const photo = STATE.allPhotos.find(p => p.id === photoId);
                        if (photo) {
                            // Muda para a aba de fotos
                            const tabBtn = document.querySelector(`.tab-btn[data-tab="tab-photos"]`);
                            if (tabBtn) tabBtn.click();
                            
                            // Abre a lightbox da foto
                            if (window.libraryManager) {
                                STATE.currentPhotoList = STATE.allPhotos;
                                STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                                window.libraryManager.openLightbox(photo);
                            }
                        } else {
                            alert("Foto correspondente não encontrada na biblioteca local.");
                        }
                    } else {
                        const videoId = Number(key);
                        if (!isNaN(videoId)) {
                            const video = STATE.allVideos.find(v => v.id === videoId);
                            if (video) {
                                // Muda para a aba de mídias/vídeos
                                const tabBtn = document.querySelector(`.tab-btn[data-tab="tab-videos"]`);
                                if (tabBtn) tabBtn.click();
                                
                                // Foca no vídeo e carrega no player
                                STATE.activeVideo = video;
                                
                                // Muda para a aba direita correspondente (Transcrição para entrevistas, Visão para B-rolls)
                                if (video.video_type === "interview") {
                                    STATE.currentRightTab = "transcript";
                                } else {
                                    STATE.currentRightTab = "vision";
                                }
                            } else {
                                alert("Vídeo correspondente não encontrado na biblioteca local.");
                            }
                        }
                    }
                });
            }
            
            this.tasksContainer.appendChild(item);
        });
    }

    showFloatingLinkButton(x, y, selectedText, timestamp, videoId) {
        const oldBtn = document.getElementById("floating-link-btn");
        if (oldBtn) oldBtn.remove();

        const btn = document.createElement("button");
        btn.id = "floating-link-btn";
        btn.innerHTML = `<i class="fa-solid fa-link"></i> Vincular a Pessoa/Objeto`;
        btn.style.position = "fixed";
        btn.style.left = `${x}px`;
        btn.style.top = `${y - 40}px`;
        btn.style.zIndex = "1000";
        btn.style.background = "var(--color-cyan)";
        btn.style.color = "#000";
        btn.style.border = "none";
        btn.style.padding = "6px 12px";
        btn.style.borderRadius = "20px";
        btn.style.fontSize = "11px";
        btn.style.fontWeight = "600";
        btn.style.cursor = "pointer";
        btn.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";
        
        btn.style.pointerEvents = "auto";
        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            btn.remove();
            this.promptLinkText(selectedText, timestamp, videoId);
        });

        document.body.appendChild(btn);

        const removeBtn = () => {
            btn.remove();
            document.removeEventListener("mousedown", removeBtn);
        };
        setTimeout(() => {
            document.addEventListener("mousedown", removeBtn);
        }, 100);
    }

    async promptLinkText(selectedText, timestamp, videoId) {
        let speakers = [];
        try {
            speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId);
        } catch (err) {
            console.warn("Erro ao buscar pessoas/falantes existentes:", err);
        }

        const name = await showAnnotationModal(speakers, "");
        if (name) {
            const trimmedName = name.trim();
            if (trimmedName) {
                try {
                    const payload = {
                        project_id: STATE.currentProjectId,
                        video_id: videoId,
                        timestamp: timestamp,
                        bounding_box: [0, 0, 0, 0],
                        name: trimmedName,
                        text_to_replace: selectedText
                    };
                    
                    const res = await CapIAuAPI.addManualFace(payload);
                    if (res && res.status === "success") {
                        const visionData = await CapIAuAPI.fetchVideoVision(videoId, STATE.currentProjectId);
                        STATE.activeVisionFrames = visionData.frames || [];
                        
                        STATE.emit("videoFacesUpdated", videoId);
                    }
                } catch (err) {
                    console.error("Erro ao vincular texto:", err);
                    alert("Erro ao vincular texto.");
                }
            }
        }
    }

    async onAiPersonaSelect() {
        const selector = document.getElementById("select-ai-persona");
        if (!selector) return;
        
        const persona = selector.value;
        if (persona === "none") return;
        
        // Reseta o seletor para permitir cliques subsequentes
        selector.value = "none";
        
        const capsPersona = persona.toUpperCase().replace("_", " ");
        console.log(`[AI PERSONA] Invoking analysis for persona: ${capsPersona}`);
        
        // Simulação de Progresso
        const timelinePanel = document.getElementById("timeline-panel");
        const headerTitle = timelinePanel ? timelinePanel.querySelector(".panel-header h3") : null;
        let originalTitleHTML = "";
        
        if (headerTitle) {
            originalTitleHTML = headerTitle.innerHTML;
            headerTitle.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--color-cyan);"></i> IA ${capsPersona} analisando o corte...`;
        }
        
        // Aguarda 1.8 segundos para dar feedback realista
        await new Promise(resolve => setTimeout(resolve, 1800));
        
        if (headerTitle) {
            headerTitle.innerHTML = originalTitleHTML;
        }

        // Se a timeline estiver vazia, avisa o usuário que é preciso ter ao menos 1 corte
        const cuts = STATE.activeTimelineCuts;
        if (cuts.length === 0) {
            alert(`A IA ${capsPersona} precisa de ao menos um clipe na timeline para poder sugerir edições baseadas no contexto!`);
            return;
        }

        // Importa dinamicamente para interagir com o estado da timeline
        const { TIMELINE_STATE } = await import("./timelineState.js");

        let suggestions = [];
        
        if (persona === "montadora") {
            // IA Montadora sugere cortar uma redundância no primeiro clipe
            const targetClip = cuts[0];
            const durFrames = targetClip.outFrame - targetClip.inFrame;
            
            if (durFrames > 48) {
                suggestions.push({
                    video_id: targetClip.video_id,
                    inFrame: targetClip.inFrame + Math.round(durFrames * 0.6),
                    outFrame: targetClip.outFrame,
                    timelineStartFrame: targetClip.timelineStartFrame + Math.round(durFrames * 0.6),
                    track: targetClip.track,
                    action: "DELETE",
                    targetClipId: targetClip.id,
                    reason: "IA Montadora: Sugere remover trecho prolixo / silêncio no final do clipe"
                });
            }
        } 
        else if (persona === "diretora") {
            // IA Diretora sugere inserir um clipe de entrevista complementar
            const otherVideo = STATE.allVideos.find(v => v.video_type === "interview" && !cuts.some(c => c.video_id === v.id));
            const videoId = otherVideo ? otherVideo.id : (cuts[0] ? cuts[0].video_id : 1);
            
            const lastCut = cuts[cuts.length - 1];
            const startFrame = lastCut ? lastCut.timelineStartFrame + (lastCut.outFrame - lastCut.inFrame) : 0;
            
            suggestions.push({
                video_id: videoId,
                inFrame: 0,
                outFrame: 120, // 5 segundos
                timelineStartFrame: startFrame,
                track: "V1",
                action: "INSERT",
                reason: "IA Diretora: Inserir depoimento complementar para estruturar a narrativa"
            });
        } 
        else if (persona === "sound_designer") {
            // Sugere trilha de fundo na V2 (B-roll track)
            const soundVideo = STATE.allVideos.find(v => v.video_type === "broll") || { id: 2 };
            const targetClip = cuts[0];
            
            suggestions.push({
                video_id: soundVideo.id,
                inFrame: 0,
                outFrame: 240, // 10 segundos
                timelineStartFrame: targetClip ? targetClip.timelineStartFrame : 0,
                track: "V2",
                action: "INSERT",
                reason: "IA Sound Designer: Adicionar trilha de atmosfera/SFX para reforçar o drama"
            });
        } 
        else if (persona === "colorista") {
            // Sugere cobrir com B-roll 1 segundo após o início do primeiro corte
            const brollVideo = STATE.allVideos.find(v => v.video_type === "broll") || { id: 2 };
            const targetClip = cuts[0];
            
            suggestions.push({
                video_id: brollVideo.id,
                inFrame: 48,
                outFrame: 144, // 4 segundos
                timelineStartFrame: targetClip ? targetClip.timelineStartFrame + 24 : 0,
                track: "V2",
                action: "INSERT",
                reason: "IA Colorista: Sugestão de cobertura de B-roll para encobrir a transição de Jump Cut"
            });
        }

        if (suggestions.length > 0) {
            TIMELINE_STATE.setGhostSuggestions(suggestions);
        } else {
            alert(`A IA ${capsPersona} analisou o corte e concluiu que a estrutura atual está excelente. Nenhuma edição sugerida!`);
        }
    }
}
