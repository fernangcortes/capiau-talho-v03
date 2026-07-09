// Gerenciador de Painéis: Transcrição, Timelines, Temas e Fila de Tarefas.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { formatTimecode, showAnnotationModal } from "./player.js";
import { CapiauTimelineRenderer } from "./timelineRenderer.js";
import { CapiauTimelineInteraction } from "./timelineInteraction.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, secondsToFrames } from "./timelineState.js";
import { getActiveElement, getActiveQuerySelector } from "./workspaceManager.js";

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

        // Botão ✨ Sugerir: análise de IA com o contexto atual da timeline
        const btnAiSuggest = document.getElementById("btn-ai-suggest");
        if (btnAiSuggest) {
            btnAiSuggest.addEventListener("click", () => {
                const selector = getActiveElement("select-ai-persona");
                const persona = selector && selector.value !== "none" ? selector.value : "diretora";
                this.runAiTimelineAnalysis(persona);
            });
        }

        // Botão de carregar timeline salva
        const btnLoadTimeline = document.getElementById("btn-load-timeline");
        if (btnLoadTimeline) {
            btnLoadTimeline.addEventListener("click", () => this.loadTimelinePrompt());
        }

        // ── Cabeçalhos dinâmicos das pistas ──
        const btnAddTrack = document.getElementById("btn-add-track");
        if (btnAddTrack) {
            btnAddTrack.addEventListener("click", () => {
                const name = prompt("Nome da nova pista de vídeo:", "Nova Pista");
                if (name !== null) {
                    TIMELINE_STATE.addVideoTrack(name.trim() || null);
                }
            });
        }

        const btnAddAudioTrack = document.getElementById("btn-add-audio-track");
        if (btnAddAudioTrack) {
            btnAddAudioTrack.addEventListener("click", () => {
                const name = prompt("Nome da nova pista de áudio:", "Áudio Extra");
                if (name !== null) {
                    TIMELINE_STATE.addAudioTrack(name.trim() || null);
                }
            });
        }

        // ── Altura vertical das pistas: slider global (0.5×–1.7×) ──
        const trackHeightSlider = document.getElementById("track-height-slider");
        if (trackHeightSlider) {
            trackHeightSlider.addEventListener("input", (e) => {
                TIMELINE_STATE.setTrackHeightScale(parseInt(e.target.value, 10) / 100);
            });
        }

        // ── Undo / Redo da timeline ──
        const btnUndo = document.getElementById("btn-undo-timeline");
        const btnRedo = document.getElementById("btn-redo-timeline");
        if (btnUndo) btnUndo.addEventListener("click", () => TIMELINE_HISTORY.undo());
        if (btnRedo) btnRedo.addEventListener("click", () => TIMELINE_HISTORY.redo());
        STATE.on("timelineHistoryChanged", ({ canUndo, canRedo }) => {
            const u = getActiveElement("btn-undo-timeline");
            const r = getActiveElement("btn-redo-timeline");
            if (u) u.style.opacity = canUndo ? "1" : "0.4";
            if (r) r.style.opacity = canRedo ? "1" : "0.4";
        });

        STATE.on("timelineTracksChanged", () => this.renderTrackHeaders());
        STATE.on("timelineVScrollChanged", () => this.syncTrackHeadersScroll());
        this.renderTrackHeaders();

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
            row.className = "transcript-bubble vision-bubble";
            row.style.marginBottom = "0px";
            row.style.cursor = "pointer";
            row.innerHTML = `
                <div class="bubble-meta" style="margin-bottom: 6px; display: flex; align-items: center; width: 100%;">
                    <span class="speaker-name" style="color: var(--color-cyan); font-weight:700;"><i class="fa-solid fa-eye" style="font-size: 9px; margin-right: 4px;"></i> VISÃO IA</span>
                    <span class="bubble-time" style="font-family: monospace; font-size:10px; color: var(--text-secondary); margin-left: auto;">${formatTimecode(f.timestamp)}</span>
                    <button class="btn-card-action btn-play-vision" style="margin-left: 10px; color: var(--text-muted); background: transparent; border:none; cursor:pointer;" title="Assistir"><i class="fa-solid fa-play"></i></button>
                </div>
                <div class="bubble-text vision-description" style="user-select: text; cursor: text; font-size: 12px; line-height: 1.5; color: var(--text-primary);">${f.description}</div>
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

                const segmentsBadge = t.segments_count
                    ? `<span style="font-size: 9px; color: var(--color-emerald); background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.25); border-radius: 10px; padding: 1px 7px; font-weight: 600;">${t.segments_count} trechos</span>`
                    : "";

                card.innerHTML = `
                    <h4 style="color: var(--color-cyan); margin: 0; font-size: 12px; font-weight: 600; display:flex; align-items:center; gap:6px; width: 100%;"><i class="fa-solid fa-brain"></i> <span style="flex:1;">${t.title}</span> ${segmentsBadge}</h4>
                    <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.4; text-align: left;">${t.description}</p>
                    <div style="display:flex; gap:6px; margin-top:6px; width: 100%; flex-wrap: wrap;">
                        ${t.segments_count ? `<button class="btn-secondary btn-theme-segments" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; color: var(--color-emerald); border: 1px solid rgba(16,185,129,0.3); background: rgba(16,185,129,0.06);" data-theme-id="${t.id}">
                            <i class="fa-solid fa-clock"></i> Ver Trechos
                        </button>` : ""}
                        <button class="btn-primary btn-theme-search" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; border: none;" data-title="${t.title}">
                            <i class="fa-solid fa-magnifying-glass"></i> Buscar Cortes
                        </button>
                        <button class="btn-secondary btn-theme-chat" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; color: var(--text-primary); border: none;" data-title="${t.title}">
                            <i class="fa-solid fa-comments"></i> Perguntar IA
                        </button>
                    </div>
                    <div class="theme-segments-list" style="display: none; width: 100%; margin-top: 6px; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto;"></div>
                `;

                // Listener: expandir/recolher trechos do tema (com seek na mídia)
                const segmentsBtn = card.querySelector(".btn-theme-segments");
                if (segmentsBtn) {
                    segmentsBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        const listEl = card.querySelector(".theme-segments-list");
                        if (listEl.style.display !== "none") {
                            listEl.style.display = "none";
                            return;
                        }
                        listEl.style.display = "flex";
                        listEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">Carregando trechos...</span>`;
                        try {
                            const data = await CapIAuAPI.fetchThemeSegments(t.id);
                            const segments = data.segments || [];
                            listEl.innerHTML = "";
                            if (segments.length === 0) {
                                listEl.innerHTML = `<span style="font-size: 10px; color: var(--text-muted);">Nenhum trecho registrado. Rode o agrupamento temático novamente.</span>`;
                                return;
                            }
                            segments.forEach(seg => {
                                const item = document.createElement("div");
                                item.style.cssText = "display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 5px; cursor: pointer; transition: background 0.15s;";
                                const isPhoto = seg.photo_id !== null && seg.photo_id !== undefined;
                                const mediaLabel = isPhoto
                                    ? `<i class="fa-solid fa-image"></i> ${seg.photo_filename || 'Foto ' + seg.photo_id}`
                                    : `<i class="fa-solid fa-film"></i> ${seg.video_filename || 'Vídeo ' + seg.video_id} · ${formatTimecode(seg.start_time || 0).substring(3)}${seg.speaker_id ? ' · ' + seg.speaker_id : ''}`;
                                item.innerHTML = `
                                    <span style="font-size: 9px; font-weight: 700; color: var(--color-cyan);">${mediaLabel}</span>
                                    <span style="font-size: 10px; color: var(--text-secondary); line-height: 1.35;">${(seg.text_excerpt || '').substring(0, 140)}${(seg.text_excerpt || '').length > 140 ? '…' : ''}</span>
                                `;
                                item.addEventListener("mouseenter", () => item.style.background = "rgba(6,182,212,0.08)");
                                item.addEventListener("mouseleave", () => item.style.background = "rgba(255,255,255,0.03)");
                                item.addEventListener("click", () => {
                                    if (isPhoto) {
                                        const photo = STATE.allPhotos.find(p => p.id === seg.photo_id);
                                        if (photo && window.libraryManager) {
                                            STATE.currentPhotoList = STATE.allPhotos;
                                            STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                                            window.libraryManager.openLightbox(photo);
                                        }
                                    } else {
                                        const video = STATE.allVideos.find(v => v.id === seg.video_id);
                                        if (video) {
                                            STATE.activeVideo = video;
                                            setTimeout(() => {
                                                const player = getActiveElement("source-video");
                                                if (player) player.currentTime = seg.start_time || 0;
                                            }, 350);
                                        }
                                    }
                                });
                                listEl.appendChild(item);
                            });
                        } catch (err) {
                            listEl.innerHTML = `<span style="font-size: 10px; color: var(--color-rose);">Erro ao carregar trechos.</span>`;
                        }
                    });
                }

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
            const fps = TIMELINE_STATE.fps || 24;
            const cuts = STATE.activeTimelineCuts.map(c => ({
                id: String(c.id),
                type: c.type || "video",
                video_id: c.video_id ?? null,
                photo_id: c.photo_id ?? null,
                in_time: c.in,
                out_time: c.out,
                track: c.track,
                timeline_start: (c.timelineStartFrame || 0) / fps,
                link_id: c.link_id || null,
                effects: c.effects || [],
                alternatives: c.alternatives || [],
                origin: c.origin || "user"
            }));
            const tracks = TIMELINE_STATE.serializeTracks();
            await CapIAuAPI.saveTimeline(STATE.currentProjectId, name, "Corte criado no editor", cuts, tracks, fps);
            alert("Timeline salva com sucesso (formato multipista v2).");
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
            
            let taskTitle = `Mídia ID: ${key} (${t.type || 'proxy'})`;
            if (t.type === 'enrich') {
                taskTitle = `Sincronização de Descrições (Projeto)`;
            } else if (key.startsWith('recover-faces-')) {
                taskTitle = `Recuperação de Rostos (Projeto)`;
            }
            
            item.innerHTML = `
                <div class="task-info">
                    <span class="task-title">${taskTitle}</span>
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
                            const tabBtn = getActiveQuerySelector(`.tab-btn[data-tab="tab-photos"]`);
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
                                const tabBtn = getActiveQuerySelector(`.tab-btn[data-tab="tab-videos"]`);
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
        this.runAiTimelineAnalysis(persona);
    }

    /**
     * Análise REAL de IA da timeline: envia o contexto atual (clipes, trilhas,
     * transcrições dos trechos e lacunas — montado no backend) e recebe sugestões
     * estruturadas que viram ghost clips na pista de IA.
     */
    async runAiTimelineAnalysis(persona) {
        const cuts = STATE.activeTimelineCuts;
        if (cuts.length === 0) {
            alert("A IA precisa de ao menos um clipe na timeline para analisar o contexto do corte!");
            return;
        }
        if (TIMELINE_STATE.aiAnalysisRunning) {
            alert("Já existe uma análise de IA em andamento. Aguarde a conclusão.");
            return;
        }

        const capsPersona = persona.toUpperCase().replace("_", " ");
        const timelinePanel = getActiveElement("timeline-panel");
        const headerTitle = timelinePanel ? timelinePanel.querySelector(".panel-header h3") : null;
        const originalTitleHTML = headerTitle ? headerTitle.innerHTML : "";

        if (headerTitle) {
            headerTitle.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--color-cyan);"></i> IA ${capsPersona} analisando o corte real...`;
        }
        TIMELINE_STATE.aiAnalysisRunning = true;
        this.timelineRenderer.requestRedraw();

        try {
            const fps = TIMELINE_STATE.fps || 24;
            const payload = {
                project_id: STATE.currentProjectId,
                persona: persona,
                fps: fps,
                brief: "",
                // Só clipes de vídeo: o áudio vinculado é derivado e pollui o contexto do LLM
                clips: cuts.filter(c => TIMELINE_STATE.trackKindOf(c.track) === "video").map(c => ({
                    id: String(c.id),
                    type: c.type || "video",
                    video_id: c.video_id ?? null,
                    photo_id: c.photo_id ?? null,
                    in_s: c.in,
                    out_s: c.out,
                    timeline_start_s: (c.timelineStartFrame || 0) / fps,
                    track: c.track
                })),
                tracks: TIMELINE_STATE.serializeTracks()
            };

            const res = await CapIAuAPI.aiSuggestTimeline(payload);

            if (res.error) {
                alert(`IA ${capsPersona}: ${res.error}`);
                return;
            }

            const suggestions = (res.suggestions || []).map(s => ({
                type: s.type || "video",
                video_id: s.video_id ?? null,
                photo_id: s.photo_id ?? null,
                in: s.in,
                out: s.out,
                timelineStartFrame: secondsToFrames(s.timeline_start_s || 0, fps),
                track: s.track,
                action: s.action,
                reason: s.reason,
                persona: s.persona,
                targetClipId: s.target_clip_id
            }));

            if (suggestions.length > 0) {
                TIMELINE_STATE.setGhostSuggestions(suggestions);
            } else {
                alert(`A IA ${capsPersona} analisou o corte e não propôs mudanças estruturais. Tente outra persona ou adicione mais material analisado à biblioteca.`);
            }
        } catch (err) {
            console.error("[AI TIMELINE] Falha na análise:", err);
            alert(`Erro ao consultar a IA ${capsPersona}: ${err.message}`);
        } finally {
            TIMELINE_STATE.aiAnalysisRunning = false;
            if (headerTitle) headerTitle.innerHTML = originalTitleHTML;
            this.timelineRenderer.requestRedraw();
        }
    }

    /**
     * Renderiza os cabeçalhos das pistas (nome, volume, mute, lock, remover)
     * na sidebar da timeline, espelhando TIMELINE_STATE.tracks.
     */
    renderTrackHeaders() {
        const container = getActiveElement("timeline-track-headers");
        if (!container) return;
        const doc = container.ownerDocument;
        container.innerHTML = "";

        const inner = doc.createElement("div");
        inner.id = "timeline-track-headers-inner";
        inner.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; will-change: transform;";
        inner.style.transform = `translateY(${-TIMELINE_STATE.scrollTop}px)`;

        TIMELINE_STATE.tracks.forEach(track => {
            const h = TIMELINE_STATE.trackHeight(track);
            const row = doc.createElement("div");
            row.className = "timeline-header-track";
            row.dataset.trackId = track.id;
            row.style.cssText = `height: ${h}px; border-bottom: 1px solid var(--border-glass); box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; padding: 4px 8px; font-size: 10px; font-weight: 700; color: var(--text-secondary); font-family: var(--font-heading); gap: 4px; overflow: hidden;`;

            if (track.kind === "ai") {
                row.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                        <span style="color: #22c55e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${track.name}"><i class="fa-solid fa-robot" style="font-size: 9px;"></i> ${track.name}</span>
                        <button class="btn-track-ai-run" title="✨ Analisar corte atual com a persona selecionada" style="border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); color: #22c55e; cursor: pointer; padding: 1px 6px; font-size: 9px; border-radius: 4px;"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                    </div>
                `;
                row.querySelector(".btn-track-ai-run").addEventListener("click", () => {
                    const selector = getActiveElement("select-ai-persona");
                    const persona = selector && selector.value !== "none" ? selector.value : "diretora";
                    this.runAiTimelineAnalysis(persona);
                });
            } else {
                const isAudio = track.kind === "audio";
                const muteIcon = track.muted
                    ? `<i class="fa-solid fa-volume-xmark" style="color: var(--color-rose);"></i>`
                    : `<i class="fa-solid fa-volume-high"></i>`;
                const lockIcon = track.locked
                    ? `<i class="fa-solid fa-lock" style="color: var(--color-rose);"></i>`
                    : `<i class="fa-solid fa-lock-open"></i>`;
                const magnetColor = track.magnetic ? "var(--color-cyan)" : "var(--text-muted)";

                // Vídeo é só imagem (magnet, sem volume); áudio tem volume/mute (sem magnet)
                const kindIcon = isAudio
                    ? `<i class="fa-solid fa-music" style="font-size: 8px; color: var(--color-emerald, #10b981);"></i> `
                    : "";
                const magnetBtn = isAudio ? "" : `<button class="btn-track-magnet btn-track-action" title="${track.magnetic ? 'Pista magnética (ripple): clipes ficam grudados em sequência' : 'Pista livre: posicionamento manual'}" style="color: ${magnetColor}; font-size: 9px;"><i class="fa-solid fa-magnet"></i></button>`;
                const muteBtn = isAudio ? `<button class="btn-track-mute btn-track-action" title="Mutar Trilha" style="color: var(--text-secondary); font-size: 10px;">${muteIcon}</button>` : "";
                const volumeSlider = isAudio ? `<input type="range" class="slider-track-volume" min="0" max="1" step="0.1" value="${track.volume}" style="width: 100%; height: 3px; accent-color: var(--color-cyan); cursor: pointer; background: rgba(255,255,255,0.1); border-radius: 2px;">` : "";

                row.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 4px;">
                        <span class="track-name-label" title="Clique duplo para renomear: ${track.name}" style="cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${kindIcon}${track.id} ${track.name}</span>
                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                            ${magnetBtn}
                            <button class="btn-track-lock btn-track-action" title="Travar/Destravar pista" style="color: var(--text-secondary); font-size: 9px;">${lockIcon}</button>
                            ${muteBtn}
                            <button class="btn-track-remove btn-track-action" title="Remover pista (clipes vão para outra pista do mesmo tipo)" style="color: var(--text-muted); font-size: 9px;"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                    ${volumeSlider}
                `;

                const muteEl = row.querySelector(".btn-track-mute");
                if (muteEl) muteEl.addEventListener("click", () => TIMELINE_STATE.toggleTrackMute(track.id));
                row.querySelector(".btn-track-lock").addEventListener("click", () => TIMELINE_STATE.toggleTrackLock(track.id));
                const magnetEl = row.querySelector(".btn-track-magnet");
                if (magnetEl) magnetEl.addEventListener("click", () => TIMELINE_STATE.toggleTrackMagnetic(track.id));
                row.querySelector(".btn-track-remove").addEventListener("click", () => {
                    if (confirm(`Remover a pista "${track.id} ${track.name}"? Os clipes dela serão movidos para outra pista do mesmo tipo.`)) {
                        if (!TIMELINE_STATE.removeTrack(track.id)) {
                            alert("Não é possível remover: a timeline precisa de ao menos uma pista de vídeo.");
                        }
                    }
                });
                const volumeEl = row.querySelector(".slider-track-volume");
                if (volumeEl) volumeEl.addEventListener("input", (e) => {
                    TIMELINE_STATE.setTrackVolume(track.id, parseFloat(e.target.value));
                });
                row.querySelector(".track-name-label").addEventListener("dblclick", () => {
                    const newName = prompt("Novo nome da pista:", track.name);
                    if (newName !== null && newName.trim()) {
                        TIMELINE_STATE.renameTrack(track.id, newName);
                    }
                });
            }

            // Alça de redimensionamento da altura individual desta pista (borda inferior).
            row.style.position = "relative";
            const resizeHandle = doc.createElement("div");
            resizeHandle.className = "track-resize-handle";
            resizeHandle.dataset.tooltip = "Arraste para ajustar a altura desta pista";
            resizeHandle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startY = e.clientY;
                const startH = TIMELINE_STATE.trackHeight(track);
                doc.body.classList.add("layout-resizing");
                // Durante o arraste: muta heightPx e redesenha o canvas, SEM re-renderizar
                // os cabeçalhos (evita recriar a alça no meio do gesto). Commit no mouseup.
                const onMove = (ev) => {
                    const nh = Math.min(240, Math.max(22, startH + (ev.clientY - startY)));
                    track.heightPx = nh;
                    row.style.height = `${nh}px`;
                    if (this.timelineRenderer) this.timelineRenderer.requestRedraw();
                };
                const onUp = () => {
                    doc.body.classList.remove("layout-resizing");
                    doc.removeEventListener("mousemove", onMove);
                    doc.removeEventListener("mouseup", onUp);
                    STATE.emit("timelineTracksChanged", TIMELINE_STATE.tracks);
                };
                doc.addEventListener("mousemove", onMove);
                doc.addEventListener("mouseup", onUp);
            });
            row.appendChild(resizeHandle);

            inner.appendChild(row);
        });

        container.appendChild(inner);
    }

    /** Sincroniza o scroll vertical dos cabeçalhos com o canvas. */
    syncTrackHeadersScroll() {
        const container = getActiveElement("timeline-track-headers");
        if (!container) return;
        const inner = container.querySelector("#timeline-track-headers-inner");
        if (inner) {
            inner.style.transform = `translateY(${-TIMELINE_STATE.scrollTop}px)`;
        }
    }

    /** Lista as timelines salvas e carrega a escolhida (com pistas e posições). */
    async loadTimelinePrompt() {
        try {
            const timelines = await CapIAuAPI.fetchTimelines(STATE.currentProjectId);
            if (!timelines || timelines.length === 0) {
                alert("Nenhuma timeline salva neste projeto ainda.");
                return;
            }

            const options = timelines.slice(0, 15).map(t => `${t.id}: ${t.name}`).join("\n");
            const answer = prompt(`Digite o ID da timeline para carregar:\n\n${options}`, String(timelines[0].id));
            if (!answer) return;

            const timelineId = parseInt(answer.trim(), 10);
            if (isNaN(timelineId)) return;

            const detail = await CapIAuAPI.fetchTimelineDetail(timelineId);
            const sequence = detail.sequence || {};

            // O carregamento é 1 passo de undo: Ctrl+Z restaura a timeline anterior
            TIMELINE_HISTORY.record(() => {
                // Restaura as pistas e os clipes com posições absolutas
                TIMELINE_STATE.setTracks(sequence.tracks || []);
                if (sequence.fps) TIMELINE_STATE.setFps(sequence.fps);

                const fps = TIMELINE_STATE.fps || 24;
                const cuts = (sequence.clips || []).map((c, idx) => ({
                    id: c.id || `cut_loaded_${idx}_${Date.now()}`,
                    type: c.type || "video",
                    video_id: c.video_id ?? null,
                    photo_id: c.photo_id ?? null,
                    in: c.in,
                    out: c.out,
                    track: c.track || "V1",
                    link_id: c.link_id || null,
                    effects: c.effects || [],
                    alternatives: c.alternatives || [],
                    origin: c.origin || "user",
                    timelineStartFrame: c.timeline_start !== undefined && c.timeline_start !== null
                        ? secondsToFrames(c.timeline_start, fps)
                        : undefined
                }));

                // Timelines antigas (sem pistas de áudio): cria pares A/V vinculados
                STATE.activeTimelineCuts = TIMELINE_STATE.migrateCutsToAV(cuts);
            });

            const nameInput = getActiveElement("timeline-name-input");
            if (nameInput) {
                const newName = detail.name || `Timeline ${timelineId}`;
                nameInput.value = newName;
                const btnRename = getActiveElement("btn-rename-timeline");
                if (btnRename) {
                    btnRename.setAttribute("data-tooltip", `Renomear Timeline (Atual: ${newName})`);
                }
            }

            console.log(`[Timeline] Timeline ${timelineId} carregada: ${cuts.length} clipes, ${TIMELINE_STATE.tracks.length} pistas.`);
        } catch (e) {
            console.error("Erro ao carregar timeline:", e);
            alert("Erro ao carregar timeline: " + e.message);
        }
    }
}
