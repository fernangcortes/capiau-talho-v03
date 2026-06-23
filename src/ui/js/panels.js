// Gerenciador de Painéis: Transcrição, Timelines, Temas e Fila de Tarefas.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { formatTimecode } from "./player.js";

export class PanelsManager {
    constructor() {
        this.transcriptContainer = document.getElementById("transcript-container");
        this.visionContainer = document.getElementById("vision-container");
        this.themesContainer = document.getElementById("theme-list");
        this.tasksContainer = document.getElementById("tasks-container");
        this.timelineCutsContainer = document.getElementById("timeline-cuts-list");
        this.trackSpeech = document.getElementById("track-speech");
        this.trackBroll = document.getElementById("track-broll");
        
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
                if (confirm("Disparar análise visual multimodal de IA para todos os B-rolls e fotos não analisados do projeto ativo?")) {
                    try {
                        await CapIAuAPI.analyzeAllVision(STATE.currentProjectId);
                        alert("Análise visual em lote disparada.");
                    } catch (err) {
                        alert("Erro ao disparar análise em lote: " + err.message);
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
                    const player = document.getElementById("main-video");
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
            const player = document.getElementById("main-video");
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

    renderVision(frames) {
        if (!this.visionContainer) return;
        this.visionContainer.innerHTML = "";

        if (frames.length === 0) {
            this.visionContainer.innerHTML = `<div class="empty-state-text">Visão IA não executada para este B-Roll. Clique em "Análise Visão" na biblioteca.</div>`;
            return;
        }

        frames.forEach(f => {
            const row = document.createElement("div");
            row.className = "vision-frame-row";
            row.innerHTML = `
                <div class="vision-timecode">${formatTimecode(f.timestamp)}</div>
                <div class="vision-description">${f.description}</div>
            `;
            row.addEventListener("click", () => {
                const player = document.getElementById("main-video");
                if (player) {
                    player.currentTime = f.timestamp;
                    player.play();
                }
            });
            this.visionContainer.appendChild(row);
        });
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
        if (!this.timelineCutsContainer) return;
        this.timelineCutsContainer.innerHTML = "";
        
        // Limpa trilhas visuais
        this.trackSpeech.innerHTML = "";
        this.trackBroll.innerHTML = "";

        if (cuts.length === 0) {
            this.timelineCutsContainer.innerHTML = `<div class="empty-state-text">Timeline vazia. Marque pontos In/Out e clique em "Adicionar à Timeline (E)".</div>`;
            return;
        }

        cuts.forEach((cut, index) => {
            const video = STATE.allVideos.find(v => v.id === cut.video_id);
            const name = video ? video.filename : `Vídeo ${cut.video_id}`;
            const dur = cut.out - cut.in;
            
            // Item na lista de cortes
            const cutItem = document.createElement("div");
            cutItem.className = "timeline-cut-item";
            cutItem.innerHTML = `
                <div class="cut-info">
                    <span class="cut-index">#${index+1}</span>
                    <span class="cut-name" title="${name}">${name}</span>
                    <span class="cut-time">[${formatTimecode(cut.in)} -> ${formatTimecode(cut.out)}] (${dur.toFixed(1)}s)</span>
                </div>
                <button class="btn-action btn-delete-cut">Excluir</button>
            `;
            
            cutItem.querySelector(".btn-delete-cut").addEventListener("click", () => {
                const updated = [...STATE.activeTimelineCuts];
                updated.splice(index, 1);
                STATE.activeTimelineCuts = updated;
            });
            
            this.timelineCutsContainer.appendChild(cutItem);

            // Bloco visual na trilha (V1 para depoimentos, V2 para b-rolls)
            const block = document.createElement("div");
            block.className = `timeline-visual-block track-${cut.track}`;
            block.style.flexGrow = Math.max(1, Math.floor(dur));
            block.textContent = `#${index+1} (${dur.toFixed(0)}s)`;
            block.title = `${name}\nIn: ${formatTimecode(cut.in)}\nOut: ${formatTimecode(cut.out)}`;
            
            block.addEventListener("click", () => {
                // Seleciona e carrega o vídeo correspondente no player
                if (video) {
                    STATE.activeVideo = video;
                    const player = document.getElementById("main-video");
                    if (player) {
                        player.currentTime = cut.in;
                    }
                }
            });

            if (cut.track === "V1") {
                this.trackSpeech.appendChild(block);
            } else {
                this.trackBroll.appendChild(block);
            }
        });
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
                cancelBtn.addEventListener("click", async () => {
                    if (confirm("Cancelar codificação de proxy desta mídia?")) {
                        await CapIAuAPI.cancelConversion(Number(key));
                    }
                });
            }
            
            this.tasksContainer.appendChild(item);
        });
    }
}
