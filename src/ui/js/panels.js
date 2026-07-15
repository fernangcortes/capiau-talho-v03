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
        this.visionContainer = document.getElementById("vision-feed-scroll");
        this.themesContainer = document.getElementById("theme-list");
        this.tasksContainer = document.getElementById("tasks-container");
        this.tasksFeed = document.getElementById("tasks-feed-scroll");
        this.lastTasksState = {}; // Para monitoramento de mudança de estado de tarefas
        this._lastTasks = {};     // Último payload de tarefas (para re-render nos toggles)
        // Preferências da aba Tarefas (persistidas): miniaturas ON por padrão, compacto OFF
        this.tasksShowThumbs = localStorage.getItem("tasks-show-thumbs") !== "false";
        this.tasksCompact = localStorage.getItem("tasks-compact") === "true";
        
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
         const btnTranscribeNow = document.getElementById("btn-transcribe-now");
        if (btnTranscribeNow) {
            btnTranscribeNow.addEventListener("click", async () => {
                if (!STATE.activeVideo) {
                    alert("Selecione um depoimento na Biblioteca para transcrever.");
                    return;
                }
                const filename = STATE.activeVideo.filename;
                try {
                    await CapIAuAPI.transcribeVideo(STATE.activeVideo.id);
                    if (window.logManager) {
                        window.logManager.log("ASR", `Solicitada transcrição para o clipe: ${filename}`, "ACTION");
                    }
                    alert("Transcrição do clipe iniciada! O progresso será exibido na aba de Tarefas.");
                } catch (err) {
                    if (window.logManager) {
                        window.logManager.log("ASR", `Falha ao iniciar transcrição do clipe ${filename}: ${err.message}`, "ERROR");
                    }
                    alert("Erro ao iniciar transcrição: " + err.message);
                }
            });
        }
        
        const btnAnalyzeVisionNow = document.getElementById("btn-analyze-vision-now");
        if (btnAnalyzeVisionNow) {
            btnAnalyzeVisionNow.addEventListener("click", async () => {
                if (!STATE.activeVideo) {
                    alert("Selecione um vídeo na Biblioteca para analisar.");
                    return;
                }
                const filename = STATE.activeVideo.filename;
                try {
                    await CapIAuAPI.analyzeVideoVision(STATE.activeVideo.id);
                    if (window.logManager) {
                        window.logManager.log("VisãoIA", `Solicitada análise de visão para o clipe: ${filename}`, "ACTION");
                    }
                    alert("Análise visual do B-roll iniciada! O progresso será exibido na aba de Tarefas.");
                } catch (err) {
                    if (window.logManager) {
                        window.logManager.log("VisãoIA", `Falha ao iniciar análise de visão para o clipe ${filename}: ${err.message}`, "ERROR");
                    }
                    alert("Erro ao iniciar análise: " + err.message);
                }
            });
        }
        
        const btnReanalyzeBeatsClip = document.getElementById("btn-reanalyze-beats-clip");
        if (btnReanalyzeBeatsClip) {
            btnReanalyzeBeatsClip.addEventListener("click", async () => {
                if (!STATE.activeVideo) {
                    alert("Selecione um vídeo na Biblioteca para reanalisar.");
                    return;
                }
                const filename = STATE.activeVideo.filename;
                if (!confirm(`Reanalisar "${filename}" com CLIP na deriva dos beats?\n\nMais preciso em planos longos, porém mais lento na CPU. Substitui a análise atual deste clipe.`)) {
                    return;
                }
                try {
                    await CapIAuAPI.analyzeVideoVision(STATE.activeVideo.id, "clip");
                    if (window.logManager) {
                        window.logManager.log("VisãoIA", `Solicitada reanálise com beats CLIP para o clipe: ${filename}`, "ACTION");
                    }
                    alert("Reanálise com beats CLIP iniciada! O progresso será exibido na aba de Tarefas.");
                } catch (err) {
                    if (window.logManager) {
                        window.logManager.log("VisãoIA", `Falha ao iniciar reanálise com beats CLIP para ${filename}: ${err.message}`, "ERROR");
                    }
                    alert("Erro ao iniciar reanálise: " + err.message);
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
                        if (window.logManager) {
                            window.logManager.log("VisãoIA", "Disparada reanálise completa em lote (todas as mídias).", "ACTION");
                        }
                        alert("Reanálise completa em lote de IA disparada! Acompanhe o progresso na aba de tarefas.");
                    } catch (err) {
                        if (window.logManager) {
                            window.logManager.log("VisãoIA", `Falha ao disparar reanálise em lote: ${err.message}`, "ERROR");
                        }
                        alert("Erro ao disparar reanálise: " + err.message);
                    }
                } else {
                    if (confirm("Disparar análise apenas para as novas mídias pendentes?")) {
                        try {
                            await CapIAuAPI.analyzeAllVision(STATE.currentProjectId, false);
                            if (window.logManager) {
                                window.logManager.log("VisãoIA", "Disparada análise em lote (apenas pendentes).", "ACTION");
                            }
                            alert("Análise de mídias pendentes disparada! Acompanhe o progresso na aba de tarefas.");
                        } catch (err) {
                            if (window.logManager) {
                                window.logManager.log("VisãoIA", `Falha ao disparar análise em lote de pendentes: ${err.message}`, "ERROR");
                            }
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

        // Inicializa gaveta do assistente e propriedades do inspetor
        this.initSpeechAssistant();

        // Toggles da aba Tarefas (miniaturas e modo compacto), persistidos em localStorage
        const btnThumbs = document.getElementById("btn-tasks-toggle-thumbs");
        if (btnThumbs) {
            btnThumbs.classList.toggle("toggle-on", this.tasksShowThumbs);
            btnThumbs.addEventListener("click", () => {
                this.tasksShowThumbs = !this.tasksShowThumbs;
                localStorage.setItem("tasks-show-thumbs", this.tasksShowThumbs ? "true" : "false");
                btnThumbs.classList.toggle("toggle-on", this.tasksShowThumbs);
                this.renderTasks(this._lastTasks || {});
            });
        }
        const btnCompact = document.getElementById("btn-tasks-toggle-compact");
        if (btnCompact) {
            btnCompact.classList.toggle("toggle-on", this.tasksCompact);
            btnCompact.addEventListener("click", () => {
                this.tasksCompact = !this.tasksCompact;
                localStorage.setItem("tasks-compact", this.tasksCompact ? "true" : "false");
                btnCompact.classList.toggle("toggle-on", this.tasksCompact);
                this.renderTasks(this._lastTasks || {});
            });
        }

        // Inicia pooling de progresso de tarefas a cada 2.5 segundos
        this.startTasksProgressLoop();
    }

    async onVideoChanged(video) {
        const scrollFeed = document.getElementById("transcript-feed-scroll") || this.transcriptContainer;
        if (!video) {
            scrollFeed.innerHTML = `<div class="empty-state-text">Nenhum depoimento selecionado.</div>`;
            this.visionContainer.innerHTML = `<div class="empty-state-text">Nenhum B-roll selecionado.</div>`;
            return;
        }

        // Reseta scissors mode
        STATE.activeScissorsMode = false;

        // Se for depoimento, carrega transcrição
        if (video.video_type === "interview" || video.status === "transcribed") {
            scrollFeed.innerHTML = `<div class="loading-state-text">Carregando transcrição...</div>`;
            try {
                const data = await CapIAuAPI.fetchTranscript(video.id);
                STATE.activeTranscript = data.dialogues || [];
                STATE.activeTranscriptWords = data.words || [];
            } catch (e) {
                scrollFeed.innerHTML = `<div class="empty-state-text">Erro ao obter transcrição. Certifique-se de iniciar o ASR.</div>`;
            }
        } else {
            scrollFeed.innerHTML = `<div class="empty-state-text">Mídia classificada como B-Roll. Use a aba "Visão IA" ao lado.</div>`;
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
        speakerSpan.style.cursor = "pointer";
        speakerSpan.title = "Clique para Inspecionar / Renomear Falante";
        
        speakerSpan.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openBubbleInspector(d, bubble);
        });
        
        const timeSpan = document.createElement("span");
        timeSpan.className = "bubble-time";
        timeSpan.textContent = formatTimecode(d.start_time);
        
        metaDiv.appendChild(speakerSpan);
        metaDiv.appendChild(timeSpan);
        
        // Botão de inspeção/detalhes
        const inspectBtn = document.createElement("button");
        inspectBtn.className = "btn-card-action inspect-btn";
        inspectBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
        inspectBtn.title = "Ajustar / Inspecionar Falas";
        inspectBtn.style.marginLeft = "auto";
        inspectBtn.style.color = "var(--text-muted)";
        inspectBtn.style.cursor = "pointer";
        inspectBtn.style.background = "transparent";
        inspectBtn.style.border = "none";
        
        inspectBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openBubbleInspector(d, bubble);
        });
        
        // Botão de tesoura individual para divisão de bloco
        const splitBtn = document.createElement("button");
        splitBtn.className = "btn-card-action split-btn";
        splitBtn.innerHTML = '<i class="fa-solid fa-scissors"></i>';
        splitBtn.title = "Dividir falas (Tesoura)";
        splitBtn.style.marginLeft = "10px";
        splitBtn.style.color = "var(--text-muted)";
        splitBtn.style.cursor = "pointer";
        splitBtn.style.background = "transparent";
        splitBtn.style.border = "none";
        
        metaDiv.appendChild(inspectBtn);
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
            
            span.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showCustomContextMenu(e.clientX, e.clientY, w, d, bubble);
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

        // Botão direito em QUALQUER parte do balão abre o menu (não só nas palavras).
        // Os word-spans usam stopPropagation, então este fallback só dispara no espaço
        // entre palavras, no padding e na área do falante — corrige o "às vezes não abre".
        bubble.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            const fallbackWord = bubbleWords[0] || { start_time: d.start_time, end_time: d.end_time, word: "" };
            this.showCustomContextMenu(e.clientX, e.clientY, fallbackWord, d, bubble);
        });

        bubble.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (STATE.activeVideo) {
                TIMELINE_STATE.addCut(STATE.activeVideo.id, d.start_time, d.end_time, null);
                STATE.emit("statusChanged", { text: `Trecho de ${d.speaker_id} adicionado à timeline (${formatTimecode(d.start_time)} - ${formatTimecode(d.end_time)}).`, active: true });
            }
        });
        
        return bubble;
    }

    renderTranscript(dialogues) {
        this.activeDialogues = dialogues;
        const scrollFeed = document.getElementById("transcript-feed-scroll");
        if (!scrollFeed) return;
        scrollFeed.innerHTML = "";
        
        if (dialogues.length === 0) {
            scrollFeed.innerHTML = `<div class="empty-state-text">Transcrição pendente ou vazia. Clique em "Transcrever" na biblioteca.</div>`;
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
                scrollFeed.appendChild(bubble);
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
                
                scrollFeed.appendChild(overlapContainer);
            }
        });
        
        // Sempre fecha o inspetor quando carrega novo vídeo
        this.closeBubbleInspector();
        
        // Busca pistas globais em background se a gaveta não estiver colapsada
        if (this.assistantDrawer && !this.assistantDrawer.classList.contains("collapsed")) {
            this.loadDiarizationClues();
        }
    }

    /* ── MÉTODOS DO ASSISTENTE DE FALAS E INSPETOR DE DIARIZAÇÃO ── */
    initSpeechAssistant() {
        this.assistantDrawer = document.getElementById("speech-assistant-drawer");
        this.btnToggleDrawer = document.getElementById("btn-toggle-assistant-drawer");
        
        if (this.assistantDrawer && this.btnToggleDrawer) {
            this.drawerContent = this.assistantDrawer.querySelector(".drawer-content");
            this.toggleIcon = this.assistantDrawer.querySelector(".toggle-icon");
            this.btnUpdateClues = document.getElementById("btn-update-clues");
            this.inspectorPanel = document.getElementById("bubble-inspector-panel");
            
            this.btnToggleDrawer.addEventListener("click", () => this.toggleAssistantDrawer());
            
            if (this.btnUpdateClues) {
                this.btnUpdateClues.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.loadDiarizationClues();
                });
            }
            
            // Ouvintes de alteração automática nas configurações de pista
            const chkSilence = document.getElementById("chk-enable-silence");
            const chkQuestions = document.getElementById("chk-enable-questions");
            const chkFaces = document.getElementById("chk-enable-faces");
            const numThreshold = document.getElementById("num-silence-threshold");
            
            if (chkSilence) chkSilence.addEventListener("change", () => this.loadDiarizationClues());
            if (chkQuestions) chkQuestions.addEventListener("change", () => this.loadDiarizationClues());
            if (chkFaces) chkFaces.addEventListener("change", () => this.loadDiarizationClues());
            if (numThreshold) numThreshold.addEventListener("change", () => this.loadDiarizationClues());
        }
    }

    toggleAssistantDrawer() {
        if (!this.assistantDrawer) return;
        const isCollapsed = this.assistantDrawer.classList.contains("collapsed");
        if (isCollapsed) {
            this.assistantDrawer.classList.remove("collapsed");
            this.drawerContent.style.maxHeight = "300px";
            this.toggleIcon.style.transform = "rotate(180deg)";
            this.loadDiarizationClues();
        } else {
            this.assistantDrawer.classList.add("collapsed");
            this.drawerContent.style.maxHeight = "0px";
            this.toggleIcon.style.transform = "rotate(0deg)";
        }
    }

    async loadDiarizationClues() {
        if (!STATE.activeVideo) return;
        const silenceThreshold = parseFloat(document.getElementById("num-silence-threshold").value) || 1.2;
        const enableSilence = document.getElementById("chk-enable-silence").checked;
        const enableQuestions = document.getElementById("chk-enable-questions").checked;
        const enableFaces = document.getElementById("chk-enable-faces").checked;
        
        const cluesList = document.getElementById("assistant-clues-list");
        if (!cluesList) return;
        cluesList.innerHTML = `<div style="font-style: italic; color: var(--text-muted); font-size: 10px; text-align: center; padding: 10px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Buscando pistas...</div>`;
        
        try {
            const clues = await CapIAuAPI.fetchDiarizationClues(
                STATE.activeVideo.id,
                silenceThreshold,
                enableSilence,
                enableQuestions,
                enableFaces
            );
            
            cluesList.innerHTML = "";
            if (clues.length === 0) {
                cluesList.innerHTML = `<div style="font-style: italic; color: var(--text-muted); font-size: 10px; text-align: center; padding: 10px 0;">Nenhuma pista detectada com as configurações atuais.</div>`;
                return;
            }
            
            clues.forEach(clue => {
                const card = document.createElement("div");
                card.className = "clue-card";
                
                let badgeClass = "";
                let badgeLabel = "";
                
                if (clue.type === "silence") {
                    badgeClass = "silence";
                    badgeLabel = `Pausa: ${clue.duration}s`;
                } else if (clue.type === "question") {
                    badgeClass = "question";
                    badgeLabel = "Pergunta";
                } else if (clue.type === "face") {
                    badgeClass = "face";
                    badgeLabel = `Rosto: ${clue.face_name}`;
                }
                
                card.innerHTML = `
                    <div class="clue-meta" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span class="clue-badge ${badgeClass}">${badgeLabel}</span>
                        <span style="color:var(--text-muted); font-size:9px;">${formatTimecode(clue.timestamp)}</span>
                    </div>
                    <div class="clue-context" style="font-style:italic; color:var(--text-muted); font-size:10px; line-height:1.3; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">"${clue.context}"</div>
                    <div class="clue-actions" style="display:flex; gap:6px; margin-top:6px;">
                        <button class="btn-flat-action cyan btn-listen-clue" style="font-size:9px; padding:2px 4px; background:rgba(6, 182, 212, 0.1) !important; border-radius:3px;"><i class="fa-solid fa-play"></i> Ouvir</button>
                        <button class="btn-flat-action rose btn-inspect-clue" style="font-size:9px; padding:2px 4px; background:rgba(244, 63, 94, 0.1) !important; border-radius:3px;"><i class="fa-solid fa-magnifying-glass"></i> Ajustar</button>
                    </div>
                `;
                
                card.querySelector(".btn-listen-clue").addEventListener("click", (e) => {
                    e.stopPropagation();
                    const player = document.getElementById("source-video");
                    if (player) {
                        player.currentTime = Math.max(0, clue.timestamp - 2);
                        player.play();
                    }
                });
                
                card.querySelector(".btn-inspect-clue").addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.inspectBubbleByTime(clue.timestamp);
                });
                
                cluesList.appendChild(card);
            });
        } catch (err) {
            cluesList.innerHTML = `<div style="color: var(--color-rose); font-size: 10px; text-align: center; padding: 10px 0;">Erro: ${err.message}</div>`;
        }
    }

    inspectBubbleByTime(timestamp) {
        const bubbles = document.querySelectorAll(".transcript-bubble");
        let targetBubble = null;
        let targetDialogue = null;
        
        bubbles.forEach(bubble => {
            const index = parseInt(bubble.getAttribute("data-dialogue-index"));
            const dial = this.activeDialogues[index];
            if (dial && dial.start_time <= timestamp && dial.end_time >= timestamp) {
                targetBubble = bubble;
                targetDialogue = dial;
            }
        });
        
        if (!targetBubble && bubbles.length > 0) {
            let minDist = Infinity;
            bubbles.forEach(bubble => {
                const index = parseInt(bubble.getAttribute("data-dialogue-index"));
                const dial = this.activeDialogues[index];
                if (dial) {
                    const dist = Math.min(Math.abs(dial.start_time - timestamp), Math.abs(dial.end_time - timestamp));
                    if (dist < minDist) {
                        minDist = dist;
                        targetBubble = bubble;
                        targetDialogue = dial;
                    }
                }
            });
        }
        
        if (targetBubble && targetDialogue) {
            targetBubble.scrollIntoView({ behavior: "smooth", block: "center" });
            targetBubble.classList.add("highlight-glow");
            setTimeout(() => targetBubble.classList.remove("highlight-glow"), 3000);
            this.openBubbleInspector(targetDialogue, targetBubble);
        }
    }

    async openBubbleInspector(d, bubble) {
        if (!this.inspectorPanel) return;
        
        // Alarga a sidebar-right para caber transcrição + inspetor lado a lado.
        // É preciso setar a BASE flex (não só width): a sidebar é um item flex de base fixa
        // (flex: 0 0 350px no Padrão / 0 0 320px no Estúdio), então `width` sozinho é ignorado.
        // Salva o tamanho anterior (uma vez) para restaurar exatamente ao fechar.
        const sidebar = document.getElementById("sidebar-right");
        if (sidebar) {
            if (this._inspectorPrevSize === undefined) {
                this._inspectorPrevSize = { flex: sidebar.style.flex, width: sidebar.style.width };
            }
            // No Estúdio a biblioteca ocupa 74% (base fixa) e não sobra espaço; encolhe-a
            // temporariamente para o inspetor respirar (restaurada ao fechar).
            if (document.body.classList.contains("studio") && this._inspectorPrevLib === undefined) {
                const lib = document.getElementById("sidebar-left");
                if (lib) {
                    this._inspectorPrevLib = { flex: lib.style.flex, width: lib.style.width };
                    lib.style.flex = "0 0 40%";
                    lib.style.width = "";
                }
            }
            // Alarga "pegando emprestado" a largura da coluna central (players/timeline),
            // deixando um mínimo para ela. Cresce o máximo possível SEM estourar, nos dois
            // layouts. Ler getBoundingClientRect após ajustar a biblioteca força o reflow.
            const centerStage = document.querySelector(".center-stage");
            const csW = centerStage ? centerStage.getBoundingClientRect().width : 0;
            const curW = sidebar.getBoundingClientRect().width;
            const CENTER_MIN = 340; // espaço reservado p/ players/timeline durante a inspeção
            const w = Math.round(curW + Math.max(0, csW - CENTER_MIN));
            sidebar.style.flex = `0 0 ${w}px`;
            sidebar.style.width = `${w}px`;
            window.dispatchEvent(new Event("resize"));
        }
        
        this.inspectorPanel.style.display = "flex";
        this.inspectorPanel.innerHTML = "";
        
        // Renderiza cabeçalho do inspetor
        const header = document.createElement("div");
        header.className = "inspector-header";
        header.innerHTML = `
            <span><i class="fa-solid fa-magnifying-glass-chart"></i> Inspetor de Falas</span>
            <button id="btn-close-inspector" class="btn-flat-action" title="Fechar Inspetor" style="color:var(--text-secondary); font-size:14px; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
        `;
        header.querySelector("#btn-close-inspector").addEventListener("click", () => this.closeBubbleInspector());
        this.inspectorPanel.appendChild(header);
        
        const body = document.createElement("div");
        body.className = "inspector-body";
        
        // Seção 1: Texto selecionado
        const secText = document.createElement("div");
        secText.innerHTML = `
            <div class="inspector-section-title"><i class="fa-solid fa-quote-left" style="color:var(--color-cyan);"></i> Trecho Selecionado</div>
            <div style="font-size:11px; color:#fff; line-height:1.4; padding:8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); border-radius:6px; font-style:italic;">
                "${d.text}"
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:10px; color:var(--text-muted);">
                <span>Início: ${formatTimecode(d.start_time)}</span>
                <span>Fim: ${formatTimecode(d.end_time)}</span>
            </div>
        `;
        body.appendChild(secText);
        
        // Seção 2: Waveform Canvas
        const secWave = document.createElement("div");
        secWave.innerHTML = `
            <div class="inspector-section-title"><i class="fa-solid fa-chart-simple" style="color:var(--color-rose);"></i> Waveform de Fala & Silêncio</div>
            <div class="waveform-container">
                <canvas id="inspector-waveform" class="waveform-canvas"></canvas>
            </div>
            <div style="font-size:9px; color:var(--text-muted); margin-top:4px; text-align:center;">
                Clique para navegar. Tracejado rosa indica pausa/corte sugerido.
            </div>
        `;
        body.appendChild(secWave);
        
        // Seção 3: Atribuição de Falante
        const secSpeaker = document.createElement("div");
        secSpeaker.innerHTML = `
            <div class="inspector-section-title"><i class="fa-solid fa-user-pen" style="color:var(--color-violet);"></i> Identificação do Falante</div>
            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; gap:6px;">
                    <select id="sel-inspector-speaker" class="nle-select" style="flex:1; padding:6px; border-radius:6px; border:1px solid var(--border-glass); background:rgba(0,0,0,0.3); color:#fff; font-size:11px;">
                        <!-- Carregado via autocomplete -->
                    </select>
                </div>
                <label style="font-size:10px; color:var(--text-secondary); display:flex; align-items:center; gap:4px; cursor:pointer;">
                    <input type="checkbox" id="chk-global-rename"> Aplicar a TODOS os blocos de "${d.speaker_id}" neste vídeo
                </label>
                <div style="display:flex; gap:6px; margin-top:4px;">
                    <button id="btn-save-speaker-name" class="btn-flat-action cyan" style="font-weight:600; padding:6px 12px; background:rgba(6, 182, 212, 0.15) !important; border-radius:4px;"><i class="fa-solid fa-floppy-disk"></i> Salvar Rótulo</button>
                </div>
            </div>
        `;
        body.appendChild(secSpeaker);
        
        // Seção 4: Pausas Internas
        const secLocalSilences = document.createElement("div");
        secLocalSilences.innerHTML = `
            <div class="inspector-section-title"><i class="fa-solid fa-scissors" style="color:var(--color-rose);"></i> Sugestões de Divisão Internas</div>
            <div id="inspector-local-silences-list" style="display:flex; flex-direction:column; gap:6px; font-size:10px;">
                <!-- Carregado via JS -->
            </div>
        `;
        body.appendChild(secLocalSilences);
        
        // Seção 5: Rostos Detectados
        const secFaces = document.createElement("div");
        secFaces.innerHTML = `
            <div class="inspector-section-title"><i class="fa-solid fa-face-smile" style="color:var(--color-cyan);"></i> Rostos na Tela (Coincidências)</div>
            <div id="inspector-faces-grid" class="faces-grid">
                <div style="font-style:italic; color:var(--text-muted); font-size:9px; text-align:center; grid-column: 1 / -1;">Buscando rostos coincidentes no banco de dados...</div>
            </div>
        `;
        body.appendChild(secFaces);
        
        this.inspectorPanel.appendChild(body);
        
        // Carrega autocomplete de falantes
        const speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId).catch(() => []);
        const selectSpk = body.querySelector("#sel-inspector-speaker");
        selectSpk.innerHTML = "";
        
        const uniqueSpeakers = Array.from(new Set([d.speaker_id, ...speakers]));
        uniqueSpeakers.forEach(s => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            opt.style.backgroundColor = "#121218";
            opt.style.color = "#e2e8f0";
            if (s === d.speaker_id) opt.selected = true;
            selectSpk.appendChild(opt);
        });
        
        const optNew = document.createElement("option");
        optNew.value = "_new_";
        optNew.textContent = "+ Novo Falante...";
        optNew.style.backgroundColor = "#121218";
        optNew.style.color = "var(--color-cyan)";
        selectSpk.appendChild(optNew);
        
        selectSpk.addEventListener("change", (e) => {
            if (e.target.value === "_new_") {
                const name = prompt("Digite o nome do novo falante:");
                if (name && name.trim()) {
                    const cleanName = name.trim();
                    const newOpt = document.createElement("option");
                    newOpt.value = cleanName;
                    newOpt.textContent = cleanName;
                    newOpt.selected = true;
                    selectSpk.insertBefore(newOpt, optNew);
                } else {
                    selectSpk.value = d.speaker_id;
                }
            }
        });
        
        body.querySelector("#btn-save-speaker-name").addEventListener("click", async () => {
            const newSpeaker = selectSpk.value;
            if (newSpeaker === "_new_" || !newSpeaker) return;
            const globalRename = body.querySelector("#chk-global-rename").checked;
            
            try {
                await CapIAuAPI.renameSpeaker(
                    STATE.activeVideo.id,
                    d.speaker_id,
                    newSpeaker,
                    globalRename,
                    d.start_time,
                    d.end_time
                );
                this.onVideoChanged(STATE.activeVideo);
                this.closeBubbleInspector();
                STATE.emit("statusChanged", { text: `Falante renomeado para "${newSpeaker}" com sucesso!`, active: true });
            } catch (err) {
                alert(`Erro ao renomear: ${err.message}`);
            }
        });
        
        this.renderInspectorWaveform(d);
        this.renderLocalSilences(d);
        this.renderLocalFaces(d);
    }

    closeBubbleInspector() {
        if (this.inspectorPanel) {
            this.inspectorPanel.style.display = "none";
        }
        const sidebar = document.getElementById("sidebar-right");
        if (sidebar) {
            // Restaura exatamente o flex/width que a sidebar tinha antes de abrir o inspetor
            // (320px no Estúdio / 350px ou o valor arrastado no Padrão).
            const prev = this._inspectorPrevSize || { flex: "", width: "" };
            sidebar.style.flex = prev.flex;
            sidebar.style.width = prev.width;
            this._inspectorPrevSize = undefined;
        }
        // Restaura a biblioteca caso tenha sido encolhida no Estúdio ao abrir o inspetor.
        if (this._inspectorPrevLib !== undefined) {
            const lib = document.getElementById("sidebar-left");
            if (lib) {
                lib.style.flex = this._inspectorPrevLib.flex;
                lib.style.width = this._inspectorPrevLib.width;
            }
            this._inspectorPrevLib = undefined;
        }
        // Recalcula o canvas da timeline após restaurar todas as colunas.
        window.dispatchEvent(new Event("resize"));
    }

    renderInspectorWaveform(d) {
        const canvas = document.getElementById("inspector-waveform");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const width = rect.width;
        const height = rect.height;
        const centerY = height / 2;
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.fillRect(0, 0, width, height);
        
        let bubbleWords = [];
        if (STATE.activeTranscriptWords && STATE.activeTranscriptWords.length > 0) {
            bubbleWords = STATE.activeTranscriptWords.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
        }
        
        const duration = d.end_time - d.start_time;
        if (duration <= 0) return;
        
        const timeToX = (t) => ((t - d.start_time) / duration) * width;
        const xToTime = (x) => d.start_time + (x / width) * duration;
        
        ctx.strokeStyle = "rgba(6, 182, 212, 0.6)";
        ctx.lineWidth = 1.5;
        
        if (bubbleWords.length > 0) {
            bubbleWords.forEach(w => {
                const xStart = timeToX(w.start_time);
                const xEnd = timeToX(w.end_time);
                const wWidth = Math.max(1, xEnd - xStart);
                
                ctx.beginPath();
                const points = Math.max(5, Math.floor(wWidth / 2));
                for (let i = 0; i <= points; i++) {
                    const px = xStart + (i / points) * wWidth;
                    const amp = Math.sin((i / points) * Math.PI) * (centerY - 8) * (0.6 + Math.random() * 0.4);
                    ctx.moveTo(px, centerY - amp);
                    ctx.lineTo(px, centerY + amp);
                }
                ctx.stroke();
            });
            
            ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            for (let i = 0; i < bubbleWords.length - 1; i++) {
                const xEndPrev = timeToX(bubbleWords[i].end_time);
                const xStartNext = timeToX(bubbleWords[i+1].start_time);
                if (xStartNext > xEndPrev) {
                    ctx.moveTo(xEndPrev, centerY);
                    ctx.lineTo(xStartNext, centerY);
                }
            }
            ctx.stroke();
        } else {
            ctx.beginPath();
            for (let x = 0; x < width; x++) {
                const amp = Math.sin((x / width) * Math.PI * 15) * (centerY - 10) * Math.random();
                ctx.moveTo(x, centerY - amp);
                ctx.lineTo(x, centerY + amp);
            }
            ctx.stroke();
        }
        
        const silenceThreshold = parseFloat(document.getElementById("num-silence-threshold").value) || 1.2;
        for (let i = 0; i < bubbleWords.length - 1; i++) {
            const gap = bubbleWords[i+1].start_time - bubbleWords[i].end_time;
            if (gap >= silenceThreshold) {
                const cutTime = (bubbleWords[i].end_time + bubbleWords[i+1].start_time) / 2;
                const cx = timeToX(cutTime);
                ctx.strokeStyle = "var(--color-rose)";
                ctx.lineWidth = 1.0;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(cx, 0);
                ctx.lineTo(cx, height);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        
        canvas.addEventListener("click", (e) => {
            const clickX = e.offsetX;
            const targetTime = xToTime(clickX);
            const player = document.getElementById("source-video");
            if (player) {
                player.currentTime = targetTime;
                player.play();
            }
        });
        
        canvas.addEventListener("dblclick", async (e) => {
            const clickX = e.offsetX;
            const targetTime = xToTime(clickX);
            const formattedTime = formatTimecode(targetTime);
            
            const newSpeaker = prompt(`Deseja dividir a fala em ${formattedTime}? Digite o nome do novo falante:`, d.speaker_id + "_2");
            if (newSpeaker && newSpeaker.trim()) {
                try {
                    await CapIAuAPI.splitTranscript(STATE.activeVideo.id, targetTime, newSpeaker.trim());
                    this.onVideoChanged(STATE.activeVideo);
                    this.closeBubbleInspector();
                } catch (err) {
                    alert(`Falha ao dividir fala: ${err.message}`);
                }
            }
        });
    }

    renderLocalSilences(d) {
        const listDiv = document.getElementById("inspector-local-silences-list");
        if (!listDiv) return;
        listDiv.innerHTML = "";
        
        let bubbleWords = [];
        if (STATE.activeTranscriptWords && STATE.activeTranscriptWords.length > 0) {
            bubbleWords = STATE.activeTranscriptWords.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
        }
        
        const silenceThreshold = parseFloat(document.getElementById("num-silence-threshold").value) || 1.2;
        const localSilences = [];
        
        for (let i = 0; i < bubbleWords.length - 1; i++) {
            const gap = bubbleWords[i+1].start_time - bubbleWords[i].end_time;
            if (gap >= silenceThreshold) {
                const cutTime = (bubbleWords[i].end_time + bubbleWords[i+1].start_time) / 2;
                localSilences.push({
                    timestamp: cutTime,
                    duration: gap,
                    wordBefore: bubbleWords[i].word,
                    wordAfter: bubbleWords[i+1].word
                });
            }
        }
        
        if (localSilences.length === 0) {
            listDiv.innerHTML = `<div style="font-style: italic; color: var(--text-muted); font-size: 9px; text-align: center; padding: 5px 0;">Nenhuma pausa longa dentro deste balão.</div>`;
            return;
        }
        
        localSilences.forEach(s => {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.alignItems = "center";
            row.style.justifyContent = "space-between";
            row.style.padding = "6px";
            row.style.background = "rgba(255,255,255,0.02)";
            row.style.border = "1px solid var(--border-glass)";
            row.style.borderRadius = "4px";
            row.style.marginBottom = "4px";
            
            row.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <span style="font-weight:600; color:var(--color-rose);"><i class="fa-solid fa-volume-xmark"></i> Pausa de ${s.duration.toFixed(1)}s</span>
                    <span style="color:var(--text-muted); font-size:9px;">Entre "${s.wordBefore}" e "${s.wordAfter}" às ${formatTimecode(s.timestamp)}</span>
                </div>
                <div style="display:flex; gap:4px;">
                    <button class="btn-flat-action cyan btn-listen-silence" title="Ouvir" style="background:none; border:none; cursor:pointer;"><i class="fa-solid fa-play"></i></button>
                    <button class="btn-flat-action rose btn-split-silence" title="Dividir aqui" style="font-size:9px; padding:2px 4px; background:rgba(244, 63, 94, 0.1) !important; border-radius:3px; cursor:pointer;"><i class="fa-solid fa-scissors"></i> Dividir</button>
                </div>
            `;
            
            row.querySelector(".btn-listen-silence").addEventListener("click", (e) => {
                e.stopPropagation();
                const player = document.getElementById("source-video");
                if (player) {
                    player.currentTime = Math.max(0, s.timestamp - 2);
                    player.play();
                }
            });
            
            row.querySelector(".btn-split-silence").addEventListener("click", async (e) => {
                e.stopPropagation();
                const newSpeaker = prompt(`Dividir fala às ${formatTimecode(s.timestamp)}? Digite o nome do novo falante:`, d.speaker_id + "_2");
                if (newSpeaker && newSpeaker.trim()) {
                    try {
                        await CapIAuAPI.splitTranscript(STATE.activeVideo.id, s.timestamp, newSpeaker.trim());
                        this.onVideoChanged(STATE.activeVideo);
                        this.closeBubbleInspector();
                    } catch (err) {
                        alert(`Falha ao dividir fala: ${err.message}`);
                    }
                }
            });
            
            listDiv.appendChild(row);
        });
    }

    async renderLocalFaces(d) {
        const grid = document.getElementById("inspector-faces-grid");
        if (!grid) return;
        
        try {
            const allFaces = await CapIAuAPI.fetchVideoFaces(STATE.activeVideo.id).catch(() => []);
            const localFaces = allFaces.filter(f => f.timestamp >= d.start_time - 0.5 && f.timestamp <= d.end_time + 0.5);
            
            grid.innerHTML = "";
            if (localFaces.length === 0) {
                grid.innerHTML = `<div style="font-style: italic; color: var(--text-muted); font-size: 9px; text-align: center; grid-column: 1 / -1; padding: 5px 0;">Nenhum rosto detectado neste trecho do vídeo.</div>`;
                return;
            }
            
            const uniqueFacesMap = new Map();
            localFaces.forEach(f => {
                const label = f.name || `Rosto #${f.id}`;
                if (!uniqueFacesMap.has(label)) {
                    uniqueFacesMap.set(label, f);
                }
            });
            
            uniqueFacesMap.forEach((face, label) => {
                const card = document.createElement("div");
                card.className = "face-thumb-card";
                card.setAttribute("title", `Rosto detectado em ${formatTimecode(face.timestamp)}`);
                
                card.innerHTML = `
                    <img src="/api/face/${face.id}/thumbnail" alt="${label}" onerror="this.src='https://placehold.co/45x45/181824/ffffff?text=?'">
                    <span style="font-size:9px; text-overflow:ellipsis; overflow:hidden; width:100%; white-space:nowrap;">${label}</span>
                    <button class="btn-flat-action cyan" style="font-size: 9px; padding: 2px 4px; margin-top:2px; background:rgba(6, 182, 212, 0.1) !important; border-radius:3px; cursor:pointer;" title="Usar este nome"><i class="fa-solid fa-check"></i> Atribuir</button>
                `;
                
                const actionBtn = card.querySelector("button");
                const assignAction = async (e) => {
                    e.stopPropagation();
                    if (!face.name) {
                        const name = prompt("Este rosto ainda não está rotulado. Digite o nome da pessoa:");
                        if (name && name.trim()) {
                            try {
                                await CapIAuAPI.labelFace(face.id, name.trim());
                                face.name = name.trim();
                            } catch (err) {
                                alert(`Falha ao rotular rosto: ${err.message}`);
                                return;
                            }
                        } else {
                            return;
                        }
                    }
                    
                    const selectSpk = document.getElementById("sel-inspector-speaker");
                    if (selectSpk) {
                        let optExists = false;
                        for (let i = 0; i < selectSpk.options.length; i++) {
                            if (selectSpk.options[i].value === face.name) {
                                optExists = true;
                                selectSpk.selectedIndex = i;
                                break;
                            }
                        }
                        if (!optExists) {
                            const newOpt = document.createElement("option");
                            newOpt.value = face.name;
                            newOpt.textContent = face.name;
                            newOpt.selected = true;
                            selectSpk.insertBefore(newOpt, selectSpk.firstChild);
                        }
                        
                        const btnSave = document.getElementById("btn-save-speaker-name");
                        if (btnSave) btnSave.click();
                    }
                };
                
                card.addEventListener("click", assignAction);
                grid.appendChild(card);
            });
        } catch (err) {
            grid.innerHTML = `<div style="color: var(--color-rose); font-size: 9px; text-align: center; grid-column: 1 / -1;">Erro ao carregar rostos: ${err.message}</div>`;
        }
    }

    showCustomContextMenu(clientX, clientY, word, dialogue, bubble) {
        const oldMenu = document.getElementById("custom-speech-context-menu");
        if (oldMenu) oldMenu.remove();
        
        const menu = document.createElement("div");
        menu.id = "custom-speech-context-menu";
        menu.className = "custom-context-menu";
        menu.style.left = `${clientX}px`;
        menu.style.top = `${clientY}px`;
        
        menu.innerHTML = `
            <div class="menu-item" id="ctx-play"><i class="fa-solid fa-play"></i> Reproduzir daqui</div>
            <div class="menu-item" id="ctx-split" style="color:var(--color-rose);"><i class="fa-solid fa-scissors"></i> Dividir fala aqui</div>
            <div class="menu-item" id="ctx-inspect"><i class="fa-solid fa-magnifying-glass"></i> Inspecionar diálogo</div>
        `;
        
        document.body.appendChild(menu);
        
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener("click", closeMenu);
        };
        setTimeout(() => document.addEventListener("click", closeMenu), 50);
        
        menu.querySelector("#ctx-play").addEventListener("click", () => {
            const player = document.getElementById("source-video");
            if (player) {
                player.currentTime = word.start_time;
                player.play();
            }
        });
        
        menu.querySelector("#ctx-split").addEventListener("click", async () => {
            const formattedTime = formatTimecode(word.start_time);
            const newSpeaker = prompt(`Dividir fala às ${formattedTime}? Digite o nome do novo falante:`, dialogue.speaker_id + "_2");
            if (newSpeaker && newSpeaker.trim()) {
                try {
                    await CapIAuAPI.splitTranscript(STATE.activeVideo.id, word.start_time, newSpeaker.trim());
                    this.onVideoChanged(STATE.activeVideo);
                    this.closeBubbleInspector();
                } catch (err) {
                    alert(`Falha ao dividir fala: ${err.message}`);
                }
            }
        });
        
        menu.querySelector("#ctx-inspect").addEventListener("click", () => {
            this.openBubbleInspector(dialogue, bubble);
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
            this.allThemes = data.themes || [];
            this.renderThemesList();
        } catch (e) {
            this.themesContainer.innerHTML = `<div class="empty-state-text">Erro ao carregar temas.</div>`;
        }
    }

    renderThemesList() {
        if (!this.themesContainer) return;
        this.themesContainer.innerHTML = "";
        const themes = this.allThemes || [];
        
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
        
        let filtered = themes;
        if (query) {
            filtered = themes.filter(t => {
                const title = (t.title || "").toLowerCase();
                const desc = (t.description || "").toLowerCase();
                return title.includes(query) || desc.includes(query);
            });
        }
        
        if (filtered.length === 0) {
            this.themesContainer.innerHTML = `
                <div style="color:var(--text-muted); font-size:11px; padding:12px; text-align:center;">
                    Nenhum tema encontrado.
                </div>
            `;
            return;
        }
        
        filtered.forEach(t => {
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
        // Agenda o próximo ciclo só depois que o anterior termina. Com setInterval,
        // um servidor lento fazia os pedidos se acumularem em vez de se substituírem,
        // até travar a tela de vez (medido em 15/07 durante o E1.T5).
        const tick = async () => {
            if (this.tasksContainer) {
                try {
                    const tasks = await CapIAuAPI.fetchConversions();
                    this.renderTasks(tasks);
                } catch (e) {
                    // Falha silenciosa de polling offline
                }
            }
            setTimeout(tick, 2500);
        };
        tick();
    }

    renderTasks(tasks) {
        this._lastTasks = tasks;
        const taskKeys = Object.keys(tasks);

        // Log de mudanças de estado das tarefas
        taskKeys.forEach(key => {
            const currentTask = tasks[key];
            const prevTask = this.lastTasksState[key];
            
            if (!prevTask) {
                let taskType = currentTask.type || 'proxy';
                let msg = `Tarefa iniciada - ID: ${key} (${taskType.toUpperCase()})`;
                if (key.startsWith('recover-faces-')) msg = `Tarefa iniciada - Recuperação de rostos do projeto`;
                else if (currentTask.type === 'enrich') msg = `Tarefa iniciada - Sincronização de descrições do projeto`;
                
                if (window.logManager) {
                    window.logManager.log("Tasks", msg, "INFO");
                }
            } else if (prevTask.status !== currentTask.status) {
                let taskType = currentTask.type || 'proxy';
                let level = "INFO";
                let msg = `Tarefa ID: ${key} (${taskType.toUpperCase()}) mudou para status: ${currentTask.status.toUpperCase()}`;
                
                if (currentTask.status === "finished") {
                    level = "INFO";
                    msg = `Tarefa concluída com sucesso - ID: ${key} (${taskType.toUpperCase()})`;
                } else if (currentTask.status === "failed") {
                    level = "ERROR";
                    msg = `Tarefa falhou - ID: ${key} (${taskType.toUpperCase()})`;
                }
                
                if (window.logManager) {
                    window.logManager.log("Tasks", msg, level);
                }
            }
        });

        // Limpa tarefas que foram removidas
        Object.keys(this.lastTasksState).forEach(key => {
            if (!tasks[key]) {
                const lastTask = this.lastTasksState[key];
                if (lastTask.status !== "finished" && lastTask.status !== "failed") {
                    if (window.logManager) {
                        window.logManager.log("Tasks", `Tarefa ID: ${key} encerrada.`, "INFO");
                    }
                }
            }
        });

        this.lastTasksState = JSON.parse(JSON.stringify(tasks));

        const feed = this.tasksFeed || this.tasksContainer;
        if (!feed) return;
        feed.innerHTML = "";

        if (taskKeys.length === 0) {
            feed.innerHTML = `<div class="empty-state-text">Nenhuma conversão de proxy ou análise ativa no momento.</div>`;
            return;
        }

        const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        const showThumbs = this.tasksShowThumbs;
        const compact = this.tasksCompact;

        taskKeys.forEach(key => {
            const t = tasks[key];
            const isFinished = t.status === "finished";
            const isFailed = t.status === "failed";
            const isCancellable = !isFinished && !isFailed && !isNaN(Number(key));
            const media = this._resolveTaskMedia(key, t);
            const typeHint = String(t.type || "proxy").toUpperCase();
            const pct = Math.round(Number(t.percent) || 0);
            const title = esc(media.title);

            // Miniatura (img com fallback: se falhar ao carregar, some e mostra o ícone)
            const thumbFull = (showThumbs && media.thumbUrl)
                ? `<img class="task-thumb" src="${media.thumbUrl}" alt="" loading="lazy" onerror="this.remove()">` : "";
            const thumbCompact = showThumbs
                ? (media.thumbUrl
                    ? `<img class="task-row-thumb" src="${media.thumbUrl}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;task-row-icon&quot;><i class=&quot;fa-solid ${media.icon}&quot;></i></span>'">`
                    : `<span class="task-row-icon"><i class="fa-solid ${media.icon}"></i></span>`)
                : `<span class="task-row-dot status-${t.status}"></span>`;

            const item = document.createElement("div");
            if (compact) {
                item.className = "task-row";
                item.innerHTML = `
                    ${thumbCompact}
                    <span class="task-row-title" title="${title} — ${typeHint} · ${esc(t.status)}">${title}</span>
                    <div class="task-row-bar"><div class="task-row-bar-fill" style="width:${pct}%"></div></div>
                    <span class="task-row-pct">${pct}%</span>
                    ${isCancellable ? `<button class="btn-cancel-task" data-id="${key}" title="Cancelar" style="background:none;border:none;color:var(--color-rose);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;">&times;</button>` : ""}
                `;
            } else {
                item.className = "task-progress-card";
                item.innerHTML = `
                    ${thumbFull}
                    <div class="task-info">
                        <span class="task-title" title="${title}">${title}</span>
                        <span class="task-status status-${t.status}">${t.status.toUpperCase()}</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="task-actions">
                        <span class="task-percent">${typeHint} · ${pct}%</span>
                        ${isCancellable ? `<button class="btn-action btn-cancel-task" data-id="${key}">Cancelar</button>` : ""}
                    </div>
                `;
            }

            // Cancelar conversão de proxy
            const cancelBtn = item.querySelector(".btn-cancel-task");
            if (cancelBtn) {
                cancelBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm("Cancelar codificação de proxy desta mídia?")) {
                        await CapIAuAPI.cancelConversion(Number(key));
                    }
                });
            }

            // Clique revela a mídia em 'Mídias' (qualquer status; só para vídeo/foto)
            if (media.kind === "video" || media.kind === "photo") {
                item.classList.add("task-card-clickable");
                item.title = "Clique para mostrar em Mídias";
                item.addEventListener("click", () => {
                    const ok = media.kind === "photo"
                        ? (window.libraryManager && window.libraryManager.revealPhotoById(media.id))
                        : (window.libraryManager && window.libraryManager.revealVideoById(media.id));
                    if (!ok) {
                        alert(media.kind === "photo"
                            ? "Foto correspondente não encontrada na biblioteca local."
                            : "Vídeo correspondente não encontrado na biblioteca local.");
                    }
                });
            }

            feed.appendChild(item);
        });
    }

    /** Resolve a mídia de uma tarefa: título amigável, miniatura e tipo (video/photo/other). */
    _resolveTaskMedia(key, t) {
        if (key.startsWith("photo-")) {
            const id = Number(key.split("photo-")[1]);
            const photo = (STATE.allPhotos || []).find(p => p.id === id);
            return {
                kind: "photo", id, icon: "fa-image",
                title: photo ? (photo.title || photo.filename || `Foto ${id}`) : `Foto ${id}`,
                thumbUrl: photo ? (photo.proxy_path || `/proxies/photos/proxy_photo_${id}.webp`) : `/proxies/photos/proxy_photo_${id}.webp`,
            };
        }
        if (key !== "" && !isNaN(Number(key))) {
            const id = Number(key);
            const video = (STATE.allVideos || []).find(v => v.id === id);
            return {
                kind: "video", id, icon: "fa-film",
                title: video ? (video.title || video.filename || `Vídeo ${id}`) : `Vídeo ${id}`,
                thumbUrl: `/api/video/${id}/thumbnail`,
            };
        }
        // Tarefas de projeto (sem mídia navegável). 'label' vem pronto de quem
        // publicou a tarefa (ex.: o worker de lote manda o nome do arquivo da vez).
        let title = t.label || `Tarefa (${t.type || "proxy"})`;
        let icon = "fa-gears";
        if (key === "lote-visao") { icon = "fa-list-check"; }
        else if (key.startsWith("recover-faces-")) { title = "Recuperação de Rostos (Projeto)"; icon = "fa-user-group"; }
        else if (key.startsWith("cluster-")) { title = "Clusterização de Temas (Projeto)"; icon = "fa-diagram-project"; }
        else if (key.startsWith("reindex")) { title = "Reindexação de Embeddings"; icon = "fa-database"; }
        else if (t.type === "enrich" || key.startsWith("enrich")) { title = "Sincronização de Descrições (Projeto)"; icon = "fa-wand-magic-sparkles"; }
        return { kind: "other", id: null, title, icon, thumbUrl: null };
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
