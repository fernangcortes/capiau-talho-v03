// Gerenciador de Painéis: Transcrição, Timelines, Temas e Fila de Tarefas.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { formatTimecode, showAnnotationModal } from "./player.js";
import { parseQuery, evaluateAST } from "./searchParser.js";
import { CapiauTimelineRenderer } from "./timelineRenderer.js";
import { CapiauTimelineInteraction } from "./timelineInteraction.js";
import { TIMELINE_STATE, TIMELINE_HISTORY, secondsToFrames } from "./timelineState.js";
import { getActiveElement, getActiveQuerySelector } from "./workspaceManager.js";
import { WaveformManager } from "./waveformManager.js";
import { KEYMAP_SERVICE, COMMANDS_CATALOG, COMMAND_CATEGORIES, PRESET_NAMES } from "./keymapService.js";

export class PanelsManager {
    constructor() {
        this.transcriptContainer = document.getElementById("transcript-container");
        this.visionContainer = document.getElementById("vision-feed-scroll");
        this.themesContainer = document.getElementById("theme-list");
        this.tasksContainer = document.getElementById("tasks-container");
        this.tasksFeed = document.getElementById("tasks-feed-scroll");
        this.lastTasksState = {}; // Para monitoramento de mudança de estado de tarefas
        this._lastTasks = {};     // Último payload de tarefas (para re-render nos toggles)
        this._renderedTaskKeys = new Set(); // Chaves que já executaram a animação mágica de entrada
        // Preferências da aba Tarefas (persistidas): miniaturas ON por padrão, compacto OFF
        this.tasksShowThumbs = localStorage.getItem("tasks-show-thumbs") !== "false";
        this.tasksCompact = localStorage.getItem("tasks-compact") === "true";
        this.previousTimelineVideoIds = new Set();
        this.inspectorShowWords = localStorage.getItem("inspector-show-words") !== "false";
        this.currentInspectedDialogue = null;
        
        // Inicializa o novo renderizador Canvas e interações
        this.timelineRenderer = new CapiauTimelineRenderer();
        this.timelineInteraction = new CapiauTimelineInteraction(this.timelineRenderer);

        WaveformManager.addListener((vidId) => {
            if (this.currentInspectedDialogue) {
                const curVid = this.currentInspectedDialogue.video_id || (STATE.activeVideo ? STATE.activeVideo.id : null);
                if (Number(vidId) === Number(curVid)) {
                    this.renderInspectorWaveform(this.currentInspectedDialogue);
                }
            }
        });
        
        // Expõe no window para sincronização com pop-outs (WorkspaceManager)
        window.panelsManager = this;
        window.timelineRenderer = this.timelineRenderer;
        window.timelineInteraction = this.timelineInteraction;
        
        this.btnCluster = document.getElementById("btn-cluster");
        this.btnSaveTimeline = document.getElementById("btn-save-timeline");
        this.btnExportTimeline = document.getElementById("btn-export-timeline");

        // Diálogo de exportação
        this.exportModal = document.getElementById("export-timeline-modal");
        this.exportListEl = document.getElementById("export-timeline-list");
        this.exportFormatChoice = document.getElementById("export-format-choice");
        this.exportFormatHint = document.getElementById("export-format-hint");
        this.exportWarning = document.getElementById("export-warning");
        this.btnConfirmExport = document.getElementById("btn-confirm-export");
        this.exportTimelines = [];

        // Diálogo de importação (caminho inverso do export)
        this.btnImportTimeline = document.getElementById("btn-import-timeline");
        this.importModal = document.getElementById("import-timeline-modal");
        this.importFileInput = document.getElementById("import-timeline-file");
        this.importFileLabel = document.getElementById("import-timeline-file-label");
        this.importNameInput = document.getElementById("import-timeline-name");
        this.importLoadAfter = document.getElementById("chk-import-load-after");
        this.importResultEl = document.getElementById("import-result");
        this.btnConfirmImport = document.getElementById("btn-confirm-import");

        // Scissors Mode
        this.btnScissors = document.getElementById("btn-scissors");
        
        this.init();
    }

    init() {
        STATE.on("activeVideoChanged", (video) => this.onVideoChanged(video));
        STATE.on("transcriptUpdated", (dialogues) => this.renderTranscript(dialogues));
        STATE.on("visionFramesUpdated", (frames) => this.renderVision(frames));
        STATE.on("timelineCutsUpdated", (cuts) => {
            this.renderTimeline(cuts);
            this.syncTimelineVideoThumbnails(cuts);
        });
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
            this.btnExportTimeline.addEventListener("click", () => this.exportTimeline());
        }
        if (this.btnImportTimeline) {
            this.btnImportTimeline.addEventListener("click", () => this.openImportModal());
        }

        // Diálogo de exportação: fechar, trocar formato e confirmar
        const btnFecharExport = document.getElementById("btn-close-export-modal");
        const btnCancelarExport = document.getElementById("btn-cancel-export");
        if (btnFecharExport) btnFecharExport.addEventListener("click", () => this.closeExportModal());
        if (btnCancelarExport) btnCancelarExport.addEventListener("click", () => this.closeExportModal());
        if (this.btnConfirmExport) this.btnConfirmExport.addEventListener("click", () => this.confirmExport());
        if (this.exportFormatChoice) this.exportFormatChoice.addEventListener("change", () => this.updateExportHint());
        if (this.exportModal) {
            // Clique fora do cartão fecha, igual aos outros modais
            this.exportModal.addEventListener("click", (ev) => {
                if (ev.target === this.exportModal) this.closeExportModal();
            });
        }

        // Diálogo de importação: fechar, escolher arquivo e confirmar
        const btnFecharImport = document.getElementById("btn-close-import-modal");
        const btnCancelarImport = document.getElementById("btn-cancel-import");
        if (btnFecharImport) btnFecharImport.addEventListener("click", () => this.closeImportModal());
        if (btnCancelarImport) btnCancelarImport.addEventListener("click", () => this.closeImportModal());
        if (this.importModal) {
            this.importModal.addEventListener("click", (ev) => {
                if (ev.target === this.importModal) this.closeImportModal();
            });
        }
        if (this.importFileInput) {
            this.importFileInput.addEventListener("change", () => this.onImportFileChosen());
        }
        if (this.importNameInput) {
            this.importNameInput.addEventListener("input", () => this.updateImportConfirmState());
        }
        if (this.btnConfirmImport) {
            this.btnConfirmImport.addEventListener("click", () => this.confirmImport());
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
        const btnAddTextTrack = document.getElementById("btn-add-text-track");
        if (btnAddTextTrack) {
            btnAddTextTrack.addEventListener("click", () => {
                const name = prompt("Nome da nova pista de texto/títulos:", "Títulos & GCs");
                if (name !== null) {
                    TIMELINE_STATE.addTextTrack(name.trim() || null);
                }
            });
        }

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
            trackHeightSlider.addEventListener("dblclick", () => {
                trackHeightSlider.value = 100;
                TIMELINE_STATE.setTrackHeightScale(1.0);
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

        // ── Marcadores da Timeline (Botão e Modal) ──
        const btnAddMarker = document.getElementById("btn-add-marker");
        if (btnAddMarker) {
            btnAddMarker.addEventListener("click", () => {
                const marker = TIMELINE_STATE.addMarker({ frame: TIMELINE_STATE.playheadFrame });
                if (this.interaction) {
                    this.interaction.openMarkerEditModal(marker);
                }
            });
        }

        const modalEditMarker = document.getElementById("modal-edit-marker");
        if (modalEditMarker) {
            const btnCloseModal = document.getElementById("btn-close-marker-modal");
            const btnSaveModal = document.getElementById("btn-marker-save");
            const btnDeleteModal = document.getElementById("btn-delete-marker");
            const inputLabel = document.getElementById("marker-edit-label");
            const inputComment = document.getElementById("marker-edit-comment");
            const colorPicker = document.getElementById("marker-color-picker");
            const colorSwatches = modalEditMarker.querySelectorAll(".marker-color-swatch");
            const iconEl = document.getElementById("marker-edit-icon");

            const closeModal = () => {
                modalEditMarker.style.display = "none";
            };

            const typeBtns = modalEditMarker.querySelectorAll(".marker-type-btn");
            typeBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    typeBtns.forEach(b => {
                        b.classList.remove("active");
                        b.style.background = "transparent";
                        b.style.color = "var(--text-secondary)";
                        b.style.fontWeight = "500";
                    });
                    btn.classList.add("active");
                    btn.style.background = "var(--color-cyan)";
                    btn.style.color = "#000";
                    btn.style.fontWeight = "700";
                    modalEditMarker.dataset.userChoice = btn.dataset.type;
                });
            });

            const saveMarker = () => {
                const markerId = modalEditMarker.dataset.markerId;
                if (!markerId) return closeModal();

                const selectedSwatch = modalEditMarker.querySelector(".marker-color-swatch.selected");
                const color = selectedSwatch ? selectedSwatch.dataset.color : "#06b6d4";
                const label = inputLabel ? inputLabel.value.trim() : "";
                const comment = inputComment ? inputComment.value.trim() : "";

                const marker = TIMELINE_STATE.getMarker(markerId);
                const userChoice = modalEditMarker.dataset.userChoice || "";

                let clipId = marker ? marker.clipId : null;
                let offsetFrame = marker ? marker.offsetFrame : null;

                if (userChoice === "ruler") {
                    clipId = null;
                    offsetFrame = null;
                } else {
                    const cuts = STATE.activeTimelineCuts || [];
                    const fps = TIMELINE_STATE.fps || 24;
                    const curFrame = marker ? marker.frame : TIMELINE_STATE.playheadFrame;
                    let cutUnder = clipId ? cuts.find(c => String(c.id) === String(clipId)) : null;
                    if (!cutUnder) {
                        const videoCuts = cuts.filter(c => c.type !== "audio" && (!c.track || !String(c.track).toLowerCase().startsWith("a")));
                        const searchCuts = videoCuts.length > 0 ? videoCuts : cuts;
                        cutUnder = searchCuts.find(c => {
                            const start = c.timelineStartFrame !== undefined ? c.timelineStartFrame : Math.round((c.timeline_start || 0) * fps);
                            const inF = c.inFrame !== undefined ? c.inFrame : Math.round((c.in || 0) * fps);
                            const outF = c.outFrame !== undefined ? c.outFrame : Math.round((c.out || 0) * fps);
                            const dur = Math.max(1, outF - inF);
                            return curFrame >= start && curFrame <= start + dur;
                        });
                    }
                    if (cutUnder) {
                        const start = cutUnder.timelineStartFrame !== undefined ? cutUnder.timelineStartFrame : Math.round((cutUnder.timeline_start || 0) * fps);
                        clipId = cutUnder.id;
                        offsetFrame = Math.max(0, Math.round(curFrame - start));
                    }
                }

                TIMELINE_STATE.updateMarker(markerId, { label, color, comment, clipId, offsetFrame });
                closeModal();
            };

            if (btnCloseModal) btnCloseModal.addEventListener("click", saveMarker);

            // Seleção de cores
            colorSwatches.forEach(swatch => {
                swatch.addEventListener("click", () => {
                    colorSwatches.forEach(s => s.classList.remove("selected"));
                    swatch.classList.add("selected");
                    if (iconEl && swatch.dataset.color) {
                        iconEl.style.color = swatch.dataset.color;
                    }
                });
            });

            // Salvar marcador
            if (btnSaveModal) {
                btnSaveModal.addEventListener("click", saveMarker);
            }

            // Excluir marcador
            if (btnDeleteModal) {
                btnDeleteModal.addEventListener("click", () => {
                    const markerId = modalEditMarker.dataset.markerId;
                    if (markerId) {
                        TIMELINE_STATE.removeMarker(markerId);
                    }
                    closeModal();
                });
            }

            // Teclas nos inputs (Enter salva, Escape salva e fecha)
            const handleInputKey = (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    saveMarker();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    saveMarker();
                }
            };

            if (inputLabel) inputLabel.addEventListener("keydown", handleInputKey);
            if (inputComment) inputComment.addEventListener("keydown", handleInputKey);

            // Navegação de cor via setas no colorPicker
            if (colorPicker) {
                colorPicker.addEventListener("keydown", (e) => {
                    const swatches = Array.from(colorSwatches);
                    const currentIndex = swatches.findIndex(s => s.classList.contains("selected"));

                    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                        e.preventDefault();
                        const nextIndex = (currentIndex + 1) % swatches.length;
                        swatches[nextIndex].click();
                    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const prevIndex = (currentIndex - 1 + swatches.length) % swatches.length;
                        swatches[prevIndex].click();
                    } else if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        saveMarker();
                    }
                });
            }
        }

        STATE.on("timelineTracksChanged", () => {
            const slider = getActiveElement("track-height-slider");
            if (slider && document.activeElement !== slider) {
                slider.value = Math.round((TIMELINE_STATE.trackHeightScale || 1.0) * 100);
            }
            TIMELINE_STATE.clampScrollTop();
            this.renderTrackHeaders();
        });
        STATE.on("timelineVScrollChanged", () => this.syncTrackHeadersScroll());
        this.renderTrackHeaders();

        // Inicializa o Sistema de Keymap & Perfis NLE
        this.initKeymapManager();

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

        // Cancelar todas as miniaturas
        const btnCancelAll = document.getElementById("btn-tasks-cancel-all-thumbs");
        if (btnCancelAll) {
            btnCancelAll.addEventListener("click", async () => {
                const taskKeys = Object.keys(this._lastTasks || {});
                let count = 0;
                for (const key of taskKeys) {
                    if (key.startsWith("thumbs-")) {
                        const videoId = Number(key.split("thumbs-")[1]);
                        try {
                            await CapIAuAPI.cancelThumbnails(videoId);
                            count++;
                        } catch (e) {}
                    }
                }
                if (count > 0) {
                    if (window.showToast) window.showToast(`Canceladas ${count} gerações de miniaturas.`, "info");
                } else {
                    if (window.showToast) window.showToast("Nenhuma geração de miniaturas em andamento.", "info");
                }
                if (window.logManager) {
                    window.logManager.log("Tasks", `Canceladas todas as ${count} gerações de miniaturas`, "INFO");
                }
                await this.refreshTasks();
            });
        }

        // Reativar todas as miniaturas
        const btnResumeAll = document.getElementById("btn-tasks-resume-all-thumbs");
        if (btnResumeAll) {
            btnResumeAll.addEventListener("click", async () => {
                const videoIds = new Set();
                (STATE.activeTimelineCuts || []).forEach(c => {
                    if (c.video_id) videoIds.add(Number(c.video_id));
                });
                Object.keys(this._lastTasks || {}).forEach(key => {
                    if (key.startsWith("thumbs-")) {
                        videoIds.add(Number(key.split("thumbs-")[1]));
                    }
                });
                if (videoIds.size === 0 && STATE.allVideos) {
                    STATE.allVideos.forEach(v => videoIds.add(v.id));
                }

                let count = 0;
                for (const videoId of videoIds) {
                    try {
                        await CapIAuAPI.resumeThumbnails(videoId);
                        count++;
                    } catch (e) {}
                }
                if (count > 0) {
                    if (window.showToast) window.showToast(`Iniciadas miniaturas para ${count} vídeo(s).`, "info");
                } else {
                    if (window.showToast) window.showToast("Nenhum vídeo encontrado para gerar miniaturas.", "info");
                }
                if (window.logManager) {
                    window.logManager.log("Tasks", `Reativadas miniaturas para ${count} vídeos`, "INFO");
                }
                await this.refreshTasks();
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
        
        this.currentInspectedDialogue = d;

        // Seção 2: Waveform Canvas
        const secWave = document.createElement("div");
        secWave.innerHTML = `
            <div class="inspector-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span><i class="fa-solid fa-chart-simple" style="color:var(--color-rose);"></i> Waveform de Fala & Silêncio</span>
                <button id="btn-toggle-inspector-words" class="btn-flat-action" style="font-size:10px; padding:2px 8px; border-radius:4px; cursor:pointer; background:${this.inspectorShowWords ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.06)'}; color:${this.inspectorShowWords ? '#22d3ee' : '#94a3b8'}; border:1px solid ${this.inspectorShowWords ? 'rgba(6, 182, 212, 0.4)' : 'rgba(255,255,255,0.08)'};" title="Mostrar/Esconder marcação de palavras sobre a onda">
                    <i class="fa-solid fa-font"></i> Palavras
                </button>
            </div>
            <div class="waveform-container">
                <canvas id="inspector-waveform" class="waveform-canvas"></canvas>
            </div>
            <div style="font-size:9px; color:var(--text-muted); margin-top:4px; text-align:center;">
                Clique para navegar. Duplo clique para adicionar corte.
            </div>
        `;
        body.appendChild(secWave);

        const btnToggleWords = secWave.querySelector("#btn-toggle-inspector-words");
        if (btnToggleWords) {
            btnToggleWords.addEventListener("click", () => {
                this.inspectorShowWords = !this.inspectorShowWords;
                localStorage.setItem("inspector-show-words", String(this.inspectorShowWords));
                btnToggleWords.style.background = this.inspectorShowWords ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.06)';
                btnToggleWords.style.color = this.inspectorShowWords ? '#22d3ee' : '#94a3b8';
                btnToggleWords.style.borderColor = this.inspectorShowWords ? 'rgba(6, 182, 212, 0.4)' : 'rgba(255,255,255,0.08)';
                this.renderInspectorWaveform(d);
            });
        }
        
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
        
        const duration = d.end_time - d.start_time;
        if (duration <= 0) return;
        
        const timeToX = (t) => ((t - d.start_time) / duration) * width;
        const xToTime = (x) => d.start_time + (x / width) * duration;
        
        const videoId = d.video_id || (STATE.activeVideo ? STATE.activeVideo.id : null);
        const sampled = WaveformManager.getSampledEnvelope(videoId, d.start_time, d.end_time, Math.max(20, Math.floor(width)));
        
        // 1. Renderiza a onda de áudio contínua real (espelhada bipolar)
        const maxAmp = centerY - 8;
        const clippingPoints = [];

        if (sampled && sampled.hasData && sampled.peaks.length > 0) {
            const peaks = sampled.peaks;
            const count = peaks.length;

            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "rgba(6, 182, 212, 0.75)";
            ctx.lineWidth = 1.3;

            for (let i = 0; i < count; i++) {
                const px = (i / count) * width;
                const pMin = peaks[i].min; // negativo
                const pMax = peaks[i].max; // positivo

                const rawAmpPos = Math.abs(pMax) * maxAmp;
                const rawAmpNeg = Math.abs(pMin) * maxAmp;

                const isClipped = rawAmpPos >= maxAmp || rawAmpNeg >= maxAmp;
                const ampTop = Math.min(rawAmpPos, maxAmp);
                const ampBottom = Math.min(rawAmpNeg, maxAmp);

                if (ampTop <= 0.5 && ampBottom <= 0.5) {
                    ctx.moveTo(px, centerY - 0.5);
                    ctx.lineTo(px, centerY + 0.5);
                } else {
                    ctx.moveTo(px, centerY - ampTop);
                    ctx.lineTo(px, centerY + ampBottom);
                }

                if (isClipped) {
                    clippingPoints.push({ px, yTop: centerY - maxAmp, yBottom: centerY + maxAmp });
                }
            }
            ctx.stroke();

            // Realce de clipping nos picos saturados
            if (clippingPoints.length > 0) {
                ctx.beginPath();
                ctx.strokeStyle = "rgba(244, 63, 94, 0.9)";
                ctx.lineWidth = 1.5;
                for (const pt of clippingPoints) {
                    ctx.moveTo(pt.px - 1, pt.yTop);
                    ctx.lineTo(pt.px + 1, pt.yTop);
                    ctx.moveTo(pt.px - 1, pt.yBottom);
                    ctx.lineTo(pt.px + 1, pt.yBottom);
                }
                ctx.stroke();
            }
            ctx.restore();
        } else {
            const isLoading = WaveformManager && typeof WaveformManager.isLoading === "function" && WaveformManager.isLoading(videoId);
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = isLoading ? "rgba(6, 182, 212, 0.4)" : "rgba(255, 255, 255, 0.2)";
            ctx.lineWidth = 1.0;
            if (isLoading) ctx.setLineDash([4, 4]);
            ctx.moveTo(2, centerY);
            ctx.lineTo(width - 2, centerY);
            ctx.stroke();
            if (isLoading && width >= 80) {
                ctx.fillStyle = "rgba(6, 182, 212, 0.75)";
                ctx.font = "italic 9px Inter, sans-serif";
                ctx.fillText("∿ extraindo áudio...", 8, centerY - 6);
            }
            ctx.restore();
        }

        // 2. Sobreposição sutil de palavras da transcrição (se ativada)
        let bubbleWords = [];
        if (STATE.activeTranscriptWords && STATE.activeTranscriptWords.length > 0) {
            bubbleWords = STATE.activeTranscriptWords.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
        }

        if (this.inspectorShowWords && bubbleWords.length > 0) {
            ctx.save();
            bubbleWords.forEach(w => {
                const xStart = Math.max(0, timeToX(w.start_time));
                const xEnd = Math.min(width, timeToX(w.end_time));
                const wWidth = Math.max(4, xEnd - xStart);

                // Caixa de marcação de palavra (sutil e translúcida)
                ctx.fillStyle = "rgba(6, 182, 212, 0.08)";
                ctx.fillRect(xStart, 3, wWidth, height - 6);

                ctx.strokeStyle = "rgba(6, 182, 212, 0.35)";
                ctx.lineWidth = 1.0;
                ctx.strokeRect(xStart, 3, wWidth, height - 6);

                // Rótulo da palavra
                const wordText = w.text || w.word || "";
                if (wWidth >= 14 && wordText) {
                    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
                    ctx.font = "9px Inter, system-ui, sans-serif";
                    ctx.fillText(wordText, xStart + 3, 13, wWidth - 4);
                }
            });
            ctx.restore();
        }

        // 3. Linhas de corte sugerido em pausas longas
        const silenceThreshold = parseFloat(document.getElementById("num-silence-threshold")?.value) || 1.2;
        if (bubbleWords.length > 1) {
            ctx.save();
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
            ctx.restore();
        }
        
        // 4. Ouvintes de navegação e corte
        if (!canvas._hasInspectorListeners) {
            canvas._hasInspectorListeners = true;
            
            canvas.addEventListener("click", (e) => {
                const curDiag = this.currentInspectedDialogue;
                if (!curDiag) return;
                const rectC = canvas.getBoundingClientRect();
                const clickX = e.clientX - rectC.left;
                const curDur = curDiag.end_time - curDiag.start_time;
                const targetTime = curDiag.start_time + (clickX / rectC.width) * curDur;
                const player = document.getElementById("source-video");
                if (player) {
                    player.currentTime = targetTime;
                    player.play();
                }
            });
            
            canvas.addEventListener("dblclick", async (e) => {
                const curDiag = this.currentInspectedDialogue;
                if (!curDiag) return;
                const rectC = canvas.getBoundingClientRect();
                const clickX = e.clientX - rectC.left;
                const curDur = curDiag.end_time - curDiag.start_time;
                const targetTime = curDiag.start_time + (clickX / rectC.width) * curDur;
                const formattedTime = formatTimecode(targetTime);
                
                const newSpeaker = prompt(`Deseja dividir a fala em ${formattedTime}? Digite o nome do novo falante:`, (curDiag.speaker_id || "speaker") + "_2");
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
            // Frames vêm do Qdrant, não do SQL: um clipe pode estar 'analyzed' (visão já
            // rodou, descrição gravada) e ainda assim voltar frames=[] se o Qdrant estiver
            // com trava exclusiva de outro processo (ex.: o worker de lote rodando). Sem
            // essa distinção a mensagem manda o usuário reanalisar algo que já foi feito.
            const status = STATE.activeVideo?.status;
            this.visionContainer.innerHTML = (status === "analyzed")
                ? `<div class="empty-state-text">A visão deste clipe já foi analisada, mas o índice de busca visual está ocupado agora (provavelmente por uma análise em lote rodando). Os frames voltam a aparecer quando ele terminar.</div>`
                : `<div class="empty-state-text">Visão IA não executada para este B-Roll. Clique em "Análise Visão" na biblioteca.</div>`;
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
        const query = searchInput ? searchInput.value.trim() : "";
        
        let filtered = themes;
        if (query) {
            const ast = parseQuery(query);
            if (ast) {
                filtered = themes.filter(t => evaluateAST(ast, t, "tab-themes"));
            }
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
            const width = TIMELINE_STATE.width || 1920;
            const height = TIMELINE_STATE.height || 1080;
            await CapIAuAPI.saveTimeline(STATE.currentProjectId, name, "Corte criado no editor", cuts, tracks, fps, width, height);
            alert("Timeline salva com sucesso (formato multipista v2).");
        } catch (e) {
            alert("Erro ao salvar timeline.");
        }
    }

    // Dicas por formato, exibidas no diálogo. O EDL merece aviso próprio: o exportador
    // achata multipista em trilha única, então J/L-cuts montados em V1/V2 se perdem.
    static get EXPORT_FORMAT_HINTS() {
        return {
            otio: "O Kdenlive 25.04 ou mais recente abre este arquivo diretamente, sem conversão.",
            xml:  "XML no padrão Final Cut Pro 7, importado por Premiere, Resolve e Final Cut.",
            edl:  "⚠️ O EDL é achatado em pista única: timelines com V1/V2 ou A1/A2 perdem a separação de trilhas.",
            srt:  "Legendas SubRip (.srt) universais com timecodes precisos para players e YouTube.",
            vtt:  "Legendas WebVTT (.vtt) prontas para HTML5 e plataformas de streaming."
        };
    }

    async exportTimeline() {
        // Abre o diálogo em vez de exportar direto. Antes daqui saía um prompt() pedindo
        // para DIGITAR o formato; depois passou a usar um <select> invisível (opacity: 0)
        // na barra — nos dois casos o usuário não via qual timeline sairia, e exportar a
        // errada era silencioso (relatado em 18/08: exportou uma antiga achando ser a da tela).
        if (!this.exportModal) return;

        this.exportTimelines = [];
        this.exportListEl.innerHTML = '<p style="font-size:11px;color:var(--text-secondary);margin:0;">Carregando…</p>';
        this.exportModal.classList.add("active");

        try {
            const timelines = await CapIAuAPI.fetchTimelines(STATE.currentProjectId);
            this.exportTimelines = timelines || [];
            this.renderExportTimelineList();
        } catch (e) {
            this.exportListEl.innerHTML = '<p style="font-size:11px;color:#ef4444;margin:0;">Falha ao carregar as timelines do projeto.</p>';
            this.updateExportHint();
        }
    }

    renderExportTimelineList() {
        if (!this.exportListEl) return;

        if (this.exportTimelines.length === 0) {
            this.exportListEl.innerHTML =
                '<p style="font-size:11px;color:var(--text-secondary);margin:0;">Nenhuma timeline salva neste projeto. Salve a timeline antes de exportar.</p>';
            this.updateExportHint();
            return;
        }

        this.exportListEl.innerHTML = "";
        this.exportTimelines.forEach((tl, idx) => {
            const clipes = Number(tl.clip_count || 0);
            const data = (tl.created_at || "").slice(0, 16).replace("T", " ");

            const linha = document.createElement("label");
            linha.style.cssText =
                "display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:5px;cursor:pointer;" +
                "border:1px solid transparent;transition:background .15s;";
            linha.addEventListener("mouseenter", () => { linha.style.background = "rgba(255,255,255,0.05)"; });
            linha.addEventListener("mouseleave", () => { linha.style.background = "transparent"; });

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "export-timeline-pick";
            radio.value = String(tl.id);
            radio.checked = idx === 0;
            radio.style.cssText = "accent-color: var(--color-cyan); cursor: pointer;";
            radio.addEventListener("change", () => this.updateExportHint());

            const texto = document.createElement("div");
            texto.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;";
            texto.innerHTML =
                `<span style="font-size:12px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.escapeHtml(tl.name || "(sem nome)")}</span>` +
                `<span style="font-size:10px;color:var(--text-secondary);">${clipes} clipe${clipes === 1 ? "" : "s"} &middot; criada em ${data}</span>`;

            linha.appendChild(radio);
            linha.appendChild(texto);
            this.exportListEl.appendChild(linha);
        });

        this.updateExportHint();
    }

    escapeHtml(txt) {
        const d = document.createElement("div");
        d.textContent = String(txt);
        return d.innerHTML;
    }

    getSelectedExportTimeline() {
        const marcado = this.exportListEl
            ? this.exportListEl.querySelector('input[name="export-timeline-pick"]:checked')
            : null;
        if (!marcado) return null;
        return this.exportTimelines.find(t => String(t.id) === marcado.value) || null;
    }

    updateExportHint() {
        const formato = this.exportFormatChoice ? this.exportFormatChoice.value : "otio";
        if (this.exportFormatHint) {
            this.exportFormatHint.textContent = PanelsManager.EXPORT_FORMAT_HINTS[formato] || "";
        }

        const tl = this.getSelectedExportTimeline();
        const clipes = tl ? Number(tl.clip_count || 0) : 0;

        if (this.exportWarning) {
            if (tl && clipes === 0) {
                this.exportWarning.textContent =
                    `A timeline "${tl.name}" não tem nenhum clipe salvo. O arquivo exportado abrirá vazio no editor.`;
                this.exportWarning.style.display = "block";
            } else {
                this.exportWarning.style.display = "none";
            }
        }

        if (this.btnConfirmExport) {
            this.btnConfirmExport.disabled = !tl;
            this.btnConfirmExport.style.opacity = tl ? "1" : "0.5";
            this.btnConfirmExport.style.cursor = tl ? "pointer" : "not-allowed";
        }
    }

    closeExportModal() {
        if (this.exportModal) this.exportModal.classList.remove("active");
    }

    confirmExport() {
        const tl = this.getSelectedExportTimeline();
        if (!tl) return;

        const FORMATOS = ["otio", "xml", "edl", "srt", "vtt"];
        const formato = this.exportFormatChoice ? this.exportFormatChoice.value : "otio";
        if (!FORMATOS.includes(formato)) {
            alert("Formato de exportação inválido.");
            return;
        }

        if (formato === "srt" || formato === "vtt") {
            const cuts = (tl.cuts && Array.isArray(tl.cuts)) ? tl.cuts : (STATE.activeTimelineCuts || []);
            const textClips = cuts.filter(c => c.type === "text").sort((a, b) => (a.timeline_start || 0) - (b.timeline_start || 0));
            if (textClips.length === 0) {
                alert("Não há clipes de texto ou títulos nesta timeline para exportar legendas.");
                return;
            }

            let content = "";
            const formatTime = (sec, isVtt = false) => {
                const totalMs = Math.round(sec * 1000);
                const ms = totalMs % 1000;
                const s = Math.floor(sec) % 60;
                const m = Math.floor(sec / 60) % 60;
                const h = Math.floor(sec / 3600);
                const delim = isVtt ? "." : ",";
                return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${delim}${String(ms).padStart(3,'0')}`;
            };

            if (formato === "srt") {
                content = textClips.map((c, i) => {
                    const startS = c.timeline_start || 0;
                    const durS = (c.out || 0) - (c.in || 0);
                    const endS = startS + durS;
                    const text = (c.text || "").trim() + (c.subtext ? "\n" + c.subtext.trim() : "");
                    return `${i+1}\n${formatTime(startS)} --> ${formatTime(endS)}\n${text}\n`;
                }).join("\n");
            } else {
                content = "WEBVTT\n\n" + textClips.map((c, i) => {
                    const startS = c.timeline_start || 0;
                    const durS = (c.out || 0) - (c.in || 0);
                    const endS = startS + durS;
                    const text = (c.text || "").trim() + (c.subtext ? "\n" + c.subtext.trim() : "");
                    return `${i+1}\n${formatTime(startS, true)} --> ${formatTime(endS, true)}\n${text}\n`;
                }).join("\n");
            }

            const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${tl.name || 'timeline'}_legendas.${formato}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.closeExportModal();
            return;
        }

        try {
            window.open(`/api/timeline/${tl.id}/export/${formato}`, "_blank");
            this.closeExportModal();
        } catch (e) {
            alert("Falha ao exportar arquivo de timeline.");
        }
    }

    async refreshTasks() {
        if (this.tasksContainer) {
            try {
                const tasks = await CapIAuAPI.fetchConversions();
                this.renderTasks(tasks);
            } catch (e) {}
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
                if (this._renderedTaskKeys) this._renderedTaskKeys.delete(key);
                const lastTask = this.lastTasksState[key];
                if (lastTask.status !== "finished" && lastTask.status !== "failed") {
                    if (window.logManager) {
                        window.logManager.log("Tasks", `Tarefa ID: ${key} encerrada.`, "INFO");
                    }
                }
            }
        });

        this.lastTasksState = JSON.parse(JSON.stringify(tasks));

        // Atualiza estado visual do botão de sincronização de descrições (btn-sync-enrich)
        const hasActiveEnrich = taskKeys.some(k => (k.startsWith("enrich") || tasks[k].type === "enrich") && tasks[k].status === "running");
        const btnSyncEnrich = document.getElementById("btn-sync-enrich");
        if (btnSyncEnrich) {
            if (hasActiveEnrich) {
                btnSyncEnrich.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando... (Clique p/ Parar)';
                btnSyncEnrich.style.background = 'linear-gradient(135deg, #e11d48, #be123c)';
                btnSyncEnrich.title = 'Clique para cancelar a sincronização de descrições';
                btnSyncEnrich.setAttribute('data-sync-active', 'true');
            } else {
                btnSyncEnrich.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Sincronizar Nomes nas Descrições';
                btnSyncEnrich.style.background = 'linear-gradient(135deg, #06b6d4, #0891b2)';
                btnSyncEnrich.title = '';
                btnSyncEnrich.removeAttribute('data-sync-active');
            }
        }

        const feed = this.tasksFeed || this.tasksContainer;
        if (!feed) return;

        if (taskKeys.length === 0) {
            if (!feed.querySelector(".empty-state-text")) {
                feed.innerHTML = `<div class="empty-state-text">Nenhuma conversão de proxy ou análise ativa no momento.</div>`;
            }
            return;
        }

        const empty = feed.querySelector(".empty-state-text");
        if (empty) empty.remove();

        // Remove cards de tarefas que não existem mais
        feed.querySelectorAll("[data-task-key]").forEach(el => {
            if (!tasks[el.dataset.taskKey]) el.remove();
        });

        const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        const showThumbs = this.tasksShowThumbs;
        const compact = this.tasksCompact;

        if (!this.expandedTaskKeys) {
            this.expandedTaskKeys = new Set();
        }
        if (!this._renderedTaskKeys) {
            this._renderedTaskKeys = new Set();
        }

        const formatLogLines = (logArray) => {
            if (!logArray || logArray.length === 0) {
                return `<div class="task-log-line" style="opacity: 0.45; font-style: italic;">[Aguardando registros de log em tempo real...]</div>`;
            }
            return logArray.map(line => {
                const escLine = esc(line);
                let cls = "task-log-line";
                if (line.includes("[ERROR]") || line.includes("[FAIL]")) cls += " task-log-line-error";
                else if (line.includes("[WARN]")) cls += " task-log-line-warn";
                else if (line.includes("[LLM]")) cls += " task-log-line-llm";
                else if (line.includes("[ENRICH]") || line.includes("[SUCCESS]") || line.includes("[FINISHED]")) cls += " task-log-line-success";
                else if (line.includes("[SCAN]") || line.includes("[PHOTO]") || line.includes("[VIDEO]")) cls += " task-log-line-scan";
                else if (line.includes("[INIT]")) cls += " task-log-line-init";
                else if (line.includes("[FRAME]")) cls += " task-log-line-frame";
                else cls += " task-log-line-info";
                return `<div class="${cls}">${escLine}</div>`;
            }).join('');
        };

        taskKeys.forEach((key, index) => {
            const t = tasks[key];
            const isFinished = t.status === "finished";
            const isFailed = t.status === "failed";
            const isCancelled = t.status === "cancelled";
            const isProxy = !isNaN(Number(key));
            const isThumbs = key.startsWith("thumbs-");
            
            const isCancellable = !isFinished && !isFailed && !isCancelled;
            const isPauseable = isThumbs && t.status === "running";
            const isResumable = isThumbs && (t.status === "paused" || t.status === "cancelled" || t.status === "failed");
            const isDismissable = isFinished || isCancelled || isFailed || isThumbs;

            const logs = Array.isArray(t.logs) ? t.logs : [];
            const isExpanded = this.expandedTaskKeys.has(key);
            const logCountBadge = logs.length > 0 ? `<span class="task-log-badge">${logs.length}</span>` : "";

            const media = this._resolveTaskMedia(key, t);
            const typeHint = String(t.type || "proxy").toUpperCase();
            const pct = Math.round(Number(t.percent) || 0);
            const title = esc(media.title);

            // Montagem das ações de forma sutil (Design System Flat - sem box e line icon)
            let actionsHtml = "";
            actionsHtml += `<button class="btn-task-action btn-toggle-task-log ${isExpanded ? 'active' : ''}" data-id="${key}" title="Alternar Console Log (CMD)"><i class="fa-solid fa-terminal"></i>${logCountBadge}</button>`;

            if (isPauseable) {
                actionsHtml += `<button class="btn-task-action btn-pause-task" data-id="${key}" title="Pausar Geração de Miniaturas"><i class="fa-solid fa-pause"></i></button>`;
            } else if (isResumable) {
                actionsHtml += `<button class="btn-task-action btn-resume-task" data-id="${key}" title="Retomar Geração de Miniaturas"><i class="fa-solid fa-play"></i></button>`;
            }
            if (isCancellable) {
                actionsHtml += `<button class="btn-task-action btn-cancel-task" data-id="${key}" title="Cancelar Tarefa"><i class="fa-solid fa-xmark"></i></button>`;
            }
            if (isDismissable) {
                actionsHtml += `<button class="btn-task-action btn-dismiss-task" data-id="${key}" title="Remover da Lista de Tarefas"><i class="fa-solid fa-trash-can"></i></button>`;
            }

            let existingItem = feed.querySelector(`[data-task-key="${key}"]`);

            // Verifica se o item existente está em conformidade com o layout (compacto vs cartão) e miniaturas atuais
            const isRowLayout = existingItem && existingItem.classList.contains("task-row");
            const isCardLayout = existingItem && existingItem.classList.contains("task-progress-card");
            const layoutMatches = compact ? isRowLayout : isCardLayout;

            const hasThumb = existingItem && (compact
                ? !!existingItem.querySelector(".task-row-thumb, .task-row-icon")
                : !!existingItem.querySelector(".task-thumb"));
            const expectedThumb = compact ? showThumbs : (showThumbs && !!media.thumbUrl);
            const thumbMatches = (hasThumb === expectedThumb);

            if (existingItem && layoutMatches && thumbMatches) {
                // Atualização in-place suave sem recriar o DOM
                const fill = existingItem.querySelector(".progress-bar-fill") || existingItem.querySelector(".task-row-bar-fill");
                if (fill) fill.style.width = `${pct}%`;

                const pctSpan = existingItem.querySelector(".task-percent");
                if (pctSpan) pctSpan.textContent = `${typeHint} · ${pct}%`;
                const rowPctSpan = existingItem.querySelector(".task-row-pct");
                if (rowPctSpan) rowPctSpan.textContent = `${pct}%`;

                const barContainer = existingItem.querySelector(".progress-bar-container") || existingItem.querySelector(".task-row-bar");
                if (barContainer) barContainer.setAttribute("data-tooltip", `Progresso: ${pct}% (${typeHint})`);

                const statusBadge = existingItem.querySelector(".task-status");
                if (statusBadge) {
                    statusBadge.className = `task-status status-${t.status}`;
                    statusBadge.textContent = t.status.toUpperCase();
                }
                const dot = existingItem.querySelector(".task-row-dot");
                if (dot) dot.className = `task-row-dot status-${t.status}`;

                // Atualiza botões de ação se o status da tarefa mudou
                const actionsContainer = existingItem.querySelector(".task-card-actions") || existingItem.querySelector(".task-row-actions");
                if (actionsContainer && actionsContainer.dataset.lastStatus !== t.status) {
                    actionsContainer.dataset.lastStatus = t.status;
                    actionsContainer.innerHTML = actionsHtml;
                    this._bindTaskEvents(existingItem, key, t, media, title);
                }

                const badge = existingItem.querySelector(".task-log-badge");
                if (badge && logs.length > 0) badge.textContent = logs.length;

                const logBox = existingItem.querySelector(`#task-log-box-${key}`);
                if (logBox && logs.length > 0) {
                    const formatted = formatLogLines(logs);
                    if (logBox.dataset.lastLogCount !== String(logs.length)) {
                        logBox.innerHTML = formatted;
                        logBox.dataset.lastLogCount = String(logs.length);
                        if (isExpanded) logBox.scrollTop = logBox.scrollHeight;
                    }
                }
                return;
            }

            // Miniatura (img com fallback: se falhar ao carregar, some e mostra o ícone)
            const thumbFull = (showThumbs && media.thumbUrl)
                ? `<img class="task-thumb" src="${media.thumbUrl}" alt="" loading="lazy" onerror="this.remove()">` : "";
            const thumbCompact = showThumbs
                ? (media.thumbUrl
                    ? `<img class="task-row-thumb" src="${media.thumbUrl}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;task-row-icon&quot;><i class=&quot;fa-solid ${media.icon}&quot;></i></span>'">`
                    : `<span class="task-row-icon"><i class="fa-solid ${media.icon}"></i></span>`)
                : `<span class="task-row-dot status-${t.status}"></span>`;

            const logDrawerHtml = `
                <div class="task-log-drawer ${isExpanded ? 'expanded' : ''}" id="task-log-drawer-${key}">
                    <div class="task-log-header">
                        <span class="task-log-header-title"><i class="fa-solid fa-terminal"></i> CONSOLE LOG (${logs.length} linhas)</span>
                        <span style="opacity: 0.6; font-size: 9px;">Estilo CMD · Tempo Real</span>
                    </div>
                    <pre class="task-log-box" id="task-log-box-${key}">${formatLogLines(logs)}</pre>
                </div>
            `;

            const item = document.createElement("div");
            item.dataset.taskKey = key;
            if (compact) {
                item.className = "task-row";
                item.style.flexDirection = "column";
                item.style.alignItems = "stretch";
                item.innerHTML = `
                    <div style="display: flex; align-items: center; width: 100%;">
                        ${thumbCompact}
                        <span class="task-row-title" title="${title} — ${typeHint} · ${esc(t.status)}">${title}</span>
                        <div class="task-row-bar" data-tooltip="Progresso: ${pct}% (${typeHint})"><div class="task-row-bar-fill" style="width:${pct}%"></div></div>
                        <span class="task-row-pct">${pct}%</span>
                        <div class="task-row-actions" data-last-status="${t.status}" style="display: flex; gap: 4px; align-items: center; margin-left: 4px;">
                            ${actionsHtml}
                        </div>
                    </div>
                    ${logDrawerHtml}
                `;
            } else {
                item.className = "task-progress-card";
                item.innerHTML = `
                    ${thumbFull}
                    <div class="task-info">
                        <span class="task-title" title="${title}">${title}</span>
                        <span class="task-status status-${t.status}">${t.status.toUpperCase()}</span>
                    </div>
                    <div class="progress-bar-container" data-tooltip="Progresso: ${pct}% (${typeHint})">
                        <div class="progress-bar-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="task-actions">
                        <span class="task-percent">${typeHint} · ${pct}%</span>
                        <div class="task-card-actions" data-last-status="${t.status}" style="display: flex; gap: 6px; align-items: center;">
                            ${actionsHtml}
                        </div>
                    </div>
                    ${logDrawerHtml}
                `;
            }

            this._bindTaskEvents(item, key, t, media, title);

            if (existingItem) {
                existingItem.replaceWith(item);
            } else {
                // Aplica a animação pop-in mágica apenas UMA VEZ na criação inicial da tarefa
                if (!this._renderedTaskKeys.has(key)) {
                    item.classList.add("task-magical-pop-in");
                    item.style.animationDelay = `${index * 80}ms`;
                    this._renderedTaskKeys.add(key);
                }
                feed.appendChild(item);
            }

            // Auto-scroll se o log estiver aberto
            if (isExpanded) {
                const box = item.querySelector(`#task-log-box-${key}`);
                if (box) box.scrollTop = box.scrollHeight;
            }
        });
    }

    /** Associa todos os ouvintes de eventos a um card/linha de tarefa */
    _bindTaskEvents(item, key, t, media, title) {
        // Alternar visibilidade do Console Log (CMD)
        const toggleLogBtn = item.querySelector(".btn-toggle-task-log");
        if (toggleLogBtn) {
            toggleLogBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.expandedTaskKeys.has(key)) {
                    this.expandedTaskKeys.delete(key);
                } else {
                    this.expandedTaskKeys.add(key);
                }
                const drawer = item.querySelector(`#task-log-drawer-${key}`);
                if (drawer) {
                    const nowExpanded = this.expandedTaskKeys.has(key);
                    drawer.classList.toggle("expanded", nowExpanded);
                    toggleLogBtn.classList.toggle("active", nowExpanded);
                    if (nowExpanded) {
                        const box = drawer.querySelector(".task-log-box");
                        if (box) box.scrollTop = box.scrollHeight;
                    }
                }
            };
        }

        // Pausar geração de miniaturas
        const pauseBtn = item.querySelector(".btn-pause-task");
        if (pauseBtn) {
            pauseBtn.onclick = async (e) => {
                e.stopPropagation();
                const videoId = key.startsWith("thumbs-") ? Number(key.split("thumbs-")[1]) : Number(key);
                try {
                    await CapIAuAPI.pauseThumbnails(videoId);
                    if (window.logManager) {
                        window.logManager.log("Tasks", `Solicitado pausa para miniaturas do vídeo ${videoId}`, "INFO");
                    }
                    await this.refreshTasks();
                } catch (err) {
                    alert("Falha ao pausar geração de miniaturas.");
                }
            };
        }

        // Retomar geração de miniaturas
        const resumeBtn = item.querySelector(".btn-resume-task");
        if (resumeBtn) {
            resumeBtn.onclick = async (e) => {
                e.stopPropagation();
                const videoId = key.startsWith("thumbs-") ? Number(key.split("thumbs-")[1]) : Number(key);
                try {
                    await CapIAuAPI.resumeThumbnails(videoId);
                    if (window.logManager) {
                        window.logManager.log("Tasks", `Solicitado retomada para miniaturas do vídeo ${videoId}`, "INFO");
                    }
                    await this.refreshTasks();
                } catch (err) {
                    alert("Falha ao retomar geração de miniaturas.");
                }
            };
        }

        // Cancelar tarefa
        const cancelBtn = item.querySelector(".btn-cancel-task");
        if (cancelBtn) {
            cancelBtn.onclick = async (e) => {
                e.stopPropagation();
                const isProxy = !isNaN(Number(key));
                if (key.startsWith("thumbs-")) {
                    if (confirm("Cancelar geração de miniaturas para este vídeo?")) {
                        const videoId = Number(key.split("thumbs-")[1]);
                        try {
                            await CapIAuAPI.cancelThumbnails(videoId);
                            if (window.logManager) {
                                window.logManager.log("Tasks", `Solicitado cancelamento de miniaturas do vídeo ${videoId}`, "INFO");
                            }
                            await this.refreshTasks();
                        } catch (err) {
                            alert("Falha ao cancelar geração de miniaturas.");
                        }
                    }
                } else if (key.startsWith("enrich") || t.type === "enrich") {
                    if (confirm("Cancelar a sincronização de descrições?")) {
                        try {
                            await CapIAuAPI.cancelTask(key);
                            if (window.showToast) window.showToast("Sincronização de descrições cancelada!", "info");
                            if (window.logManager) {
                                window.logManager.log("Tasks", `Cancelada sincronização de descrições (${key})`, "WARN");
                            }
                            await this.refreshTasks();
                        } catch (err) {
                            alert("Falha ao cancelar sincronização de descrições: " + err.message);
                        }
                    }
                } else if (isProxy || key.startsWith("vision-") || key.startsWith("proxy-") || !isNaN(Number(key))) {
                    if (confirm("Cancelar a análise ou processamento desta mídia?")) {
                        try {
                            const videoId = Number(key.replace("vision-", "").replace("proxy-", ""));
                            await CapIAuAPI.cancelConversion(videoId);
                            if (window.showToast) window.showToast(`Análise do vídeo #${videoId} cancelada!`, "info");
                            if (window.libraryInstance) window.libraryInstance.reloadData();
                            await this.refreshTasks();
                        } catch (err) {
                            alert("Falha ao cancelar tarefa: " + err.message);
                        }
                    }
                } else {
                    if (confirm(`Cancelar a tarefa "${title}"?`)) {
                        try {
                            await CapIAuAPI.cancelTask(key);
                            if (window.showToast) window.showToast(`Tarefa "${title}" cancelada!`, "info");
                            if (window.logManager) {
                                window.logManager.log("Tasks", `Tarefa ${key} cancelada pelo usuário`, "WARN");
                            }
                            await this.refreshTasks();
                        } catch (err) {
                            alert("Falha ao cancelar tarefa: " + err.message);
                        }
                    }
                }
            };
        }

        // Remover/ocultar tarefa da lista
        const dismissBtn = item.querySelector(".btn-dismiss-task");
        if (dismissBtn) {
            dismissBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await CapIAuAPI.dismissTask(key);
                    item.remove();
                    if (window.logManager) {
                        window.logManager.log("Tasks", `Tarefa ${key} removida da lista`, "INFO");
                    }
                } catch (err) {
                    alert("Falha ao remover tarefa da lista.");
                }
            };
        }

        // Clique revela a mídia em 'Mídias' (qualquer status; só para vídeo/foto)
        if (media && (media.kind === "video" || media.kind === "photo")) {
            item.classList.add("task-card-clickable");
            item.title = "Clique para mostrar na biblioteca";
            item.onclick = (e) => {
                if (e.target.closest(".btn-task-action") || e.target.closest(".task-log-drawer")) return;
                const ok = media.kind === "photo"
                    ? (window.libraryManager && window.libraryManager.revealPhotoById(media.id))
                    : (window.libraryManager && window.libraryManager.revealVideoById(media.id));
                if (!ok) {
                    alert(media.kind === "photo"
                        ? "Foto correspondente não encontrada na biblioteca local."
                        : "Vídeo correspondente não encontrado na biblioteca local.");
                }
            };
        }
    }

    /** Sincroniza a geração de miniaturas com a adição/remoção de vídeos na timeline */
    syncTimelineVideoThumbnails(cuts) {
        const currentVideoIds = new Set(
            (cuts || [])
                .map(c => c.video_id)
                .filter(id => id !== null && id !== undefined)
        );

        if (!this.previousTimelineVideoIds) {
            this.previousTimelineVideoIds = new Set();
        }

        // 1. Vídeos removidos da timeline -> Cancelar geração de miniaturas automaticamente
        this.previousTimelineVideoIds.forEach(videoId => {
            if (!currentVideoIds.has(videoId)) {
                CapIAuAPI.cancelThumbnails(videoId).catch(() => {});
                if (window.logManager) {
                    window.logManager.log("Timeline", `Vídeo ID ${videoId} removido da timeline. Cancelando miniaturas.`, "INFO");
                }
            }
        });

        // 2. Vídeos adicionados à timeline -> Iniciar/Retomar geração de miniaturas automaticamente
        currentVideoIds.forEach(videoId => {
            if (!this.previousTimelineVideoIds.has(videoId)) {
                CapIAuAPI.resumeThumbnails(videoId).catch(() => {});
                if (window.logManager) {
                    window.logManager.log("Timeline", `Vídeo ID ${videoId} adicionado à timeline. Retomando miniaturas.`, "INFO");
                }
            }
        });

        this.previousTimelineVideoIds = currentVideoIds;
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
            const ver = video?._thumbVersion || video?.updated_at || "";
            const qs = ver ? `?v=${ver}` : "";
            return {
                kind: "video", id, icon: "fa-film",
                title: video ? (video.title || video.filename || `Vídeo ${id}`) : `Vídeo ${id}`,
                thumbUrl: `/api/video/${id}/thumbnail${qs}`,
            };
        }
        if (key.startsWith("thumbs-")) {
            const id = Number(key.split("thumbs-")[1]);
            const video = (STATE.allVideos || []).find(v => v.id === id);
            const ver = video?._thumbVersion || video?.updated_at || "";
            const qs = ver ? `?v=${ver}` : "";
            return {
                kind: "video", id, icon: "fa-images",
                title: video ? `Miniaturas: ${video.title || video.filename}` : `Miniaturas Vídeo ${id}`,
                thumbUrl: `/api/video/${id}/thumbnail${qs}`,
            };
        }
        if (key.startsWith("waveform-")) {
            const id = Number(key.split("waveform-")[1]);
            const video = (STATE.allVideos || []).find(v => v.id === id);
            const ver = video?._thumbVersion || video?.updated_at || "";
            const qs = ver ? `?v=${ver}` : "";
            return {
                kind: "video", id, icon: "fa-chart-simple",
                title: video ? `Waveform: ${video.title || video.filename}` : `Waveform Vídeo ${id}`,
                thumbUrl: `/api/video/${id}/thumbnail${qs}`,
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
        else if (t.type === "titles" || key.startsWith("titles")) { title = t.label || "Geração de Títulos IA (Projeto)"; icon = "fa-wand-magic-sparkles"; }
        else if (t.type === "waveforms" || key.startsWith("waveforms_proj_")) { title = t.label || "Geração de Waveforms (Projeto)"; icon = "fa-chart-simple"; }
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
            row.dataset.trackId = track.id;

            if (track.hidden) {
                row.className = "timeline-header-track restore-line";
                row.style.cssText = `height: 4px; border-bottom: 1px solid rgba(6, 182, 212, 0.3); background: rgba(6, 182, 212, 0.15); cursor: pointer; transition: background 0.2s, box-shadow 0.2s; position: relative; flex-shrink: 0;`;
                row.setAttribute("data-tooltip", `Expandir pista ${track.id} (${track.name})`);
                
                row.addEventListener("click", () => {
                    TIMELINE_STATE.toggleTrackVisibility(track.id);
                });
                
                row.addEventListener("mouseenter", () => {
                    row.style.background = "rgba(6, 182, 212, 0.85)";
                    row.style.boxShadow = "0 0 10px rgba(6, 182, 212, 0.6)";
                });
                row.addEventListener("mouseleave", () => {
                    row.style.background = "rgba(6, 182, 212, 0.15)";
                    row.style.boxShadow = "none";
                });
                
                inner.appendChild(row);
                return;
            }

            row.className = "timeline-header-track";
            row.style.cssText = `height: ${h}px; border-bottom: 1px solid var(--border-glass); box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; padding: 4px 8px; font-size: 10px; font-weight: 700; color: var(--text-secondary); font-family: var(--font-heading); gap: 4px; overflow: hidden;`;

            if (track.kind === "ai") {
                if (h >= 40) {
                    row.innerHTML = `
                        <div style="display: flex; align-items: center; width: 100%;">
                            <span style="color: #22c55e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;" title="${track.name}"><i class="fa-solid fa-robot" style="font-size: 9px;"></i> ${track.name}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 4px; margin-top: 2px;">
                            <button class="btn-track-visibility btn-track-action" title="Ocultar pista" style="color: var(--text-secondary); font-size: 9px;"><i class="fa-solid fa-eye"></i></button>
                            <button class="btn-track-ai-run" title="✨ Analisar corte atual com a persona selecionada" style="border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); color: #22c55e; cursor: pointer; padding: 1px 6px; font-size: 9px; border-radius: 4px;"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                        </div>
                    `;
                } else {
                    row.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <span style="color: #22c55e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${track.name}"><i class="fa-solid fa-robot" style="font-size: 9px;"></i> ${track.name}</span>
                            <div style="display: flex; gap: 4px; align-items: center;">
                                <button class="btn-track-visibility btn-track-action" title="Ocultar pista" style="color: var(--text-secondary); font-size: 9px;"><i class="fa-solid fa-eye"></i></button>
                                <button class="btn-track-ai-run" title="✨ Analisar corte atual com a persona selecionada" style="border: 1px solid rgba(34,197,94,0.35); background: rgba(34,197,94,0.08); color: #22c55e; cursor: pointer; padding: 1px 6px; font-size: 9px; border-radius: 4px;"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                            </div>
                        </div>
                    `;
                }
                row.querySelector(".btn-track-visibility").addEventListener("click", () => TIMELINE_STATE.toggleTrackVisibility(track.id));
                row.querySelector(".btn-track-ai-run").addEventListener("click", () => {
                    const selector = getActiveElement("select-ai-persona");
                    const persona = selector && selector.value !== "none" ? selector.value : "diretora";
                    this.runAiTimelineAnalysis(persona);
                });
            } else {
                const isAudio = track.kind === "audio";
                const isText = track.kind === "text";
                const muteIcon = track.muted
                    ? `<i class="fa-solid fa-volume-xmark" style="color: var(--color-rose);"></i>`
                    : `<i class="fa-solid fa-volume-high"></i>`;
                const lockIcon = track.locked
                    ? `<i class="fa-solid fa-lock" style="color: var(--color-rose);"></i>`
                    : `<i class="fa-solid fa-lock-open"></i>`;
                const isSyncLocked = track.syncLocked !== undefined ? !!track.syncLocked : true;
                const syncColor = isSyncLocked ? "var(--color-cyan)" : "var(--text-muted)";
                const syncBtn = `<button class="btn-track-sync-lock btn-track-action" title="${isSyncLocked ? 'Sync Lock ativado: esta pista acompanha operações de Ripple e Inserção' : 'Sync Lock desativado: esta pista permanece fixa no tempo'}" style="color: ${syncColor}; font-size: 9px;"><i class="fa-solid fa-arrows-left-right-to-line"></i></button>`;

                // Ícones de visibilidade e miniaturas
                const visibilityIcon = `<i class="fa-solid fa-eye"></i>`;
                const thumbIcon = track.thumbnailsEnabled
                    ? `<i class="fa-solid fa-image" style="color: var(--color-cyan);"></i>`
                    : `<i class="fa-regular fa-image" style="color: var(--text-secondary); opacity: 0.5;"></i>`;

                let kindIcon = "";
                if (isAudio) {
                    kindIcon = `<i class="fa-solid fa-music" style="font-size: 8px; color: var(--color-emerald, #10b981);"></i> `;
                } else if (isText) {
                    kindIcon = `<i class="fa-solid fa-font" style="font-size: 8px; color: #f59e0b;"></i> `;
                }
                const muteBtn = isAudio ? `<button class="btn-track-mute btn-track-action" title="Mutar Trilha" style="color: var(--text-secondary); font-size: 10px;">${muteIcon}</button>` : "";
                const volumeSlider = isAudio ? `<input type="range" class="slider-track-volume" min="0" max="1" step="0.1" value="${track.volume}" style="width: 100%; height: 3px; accent-color: var(--color-cyan); cursor: pointer; background: rgba(255,255,255,0.1); border-radius: 2px;">` : "";
                const thumbBtn = (isAudio || isText) ? "" : `<button class="btn-track-thumbnails btn-track-action" title="${track.thumbnailsEnabled ? 'Desativar miniaturas na pista' : 'Ativar miniaturas na pista'}" style="font-size: 9px;">${thumbIcon}</button>`;

                if (h >= 40) {
                    row.innerHTML = `
                        <div style="display: flex; align-items: center; width: 100%;">
                            <span class="track-name-label" title="Clique duplo para renomear: ${track.name}" style="cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${kindIcon}${track.id} ${track.name}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 6px; margin-top: 2px;">
                            <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center;">
                                ${thumbBtn}
                                <button class="btn-track-visibility btn-track-action" title="Ocultar pista" style="color: var(--text-secondary); font-size: 9px;">${visibilityIcon}</button>
                                ${syncBtn}
                                <button class="btn-track-lock btn-track-action" title="Travar/Destravar pista" style="color: var(--text-secondary); font-size: 9px;">${lockIcon}</button>
                                ${muteBtn}
                            </div>
                            ${volumeSlider ? `<div style="flex: 1; display: flex; align-items: center; margin-left: 8px;">${volumeSlider}</div>` : ''}
                            <button class="btn-track-remove btn-track-action" title="Remover pista (clipes vão para outra pista do mesmo tipo)" style="color: var(--text-muted); font-size: 9px; flex-shrink: 0;"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;
                } else {
                    row.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 4px;">
                            <span class="track-name-label" title="Clique duplo para renomear: ${track.name}" style="cursor: text; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${kindIcon}${track.id} ${track.name}</span>
                            <div style="display: flex; gap: 4px; flex-shrink: 0;">
                                ${thumbBtn}
                                <button class="btn-track-visibility btn-track-action" title="Ocultar pista" style="color: var(--text-secondary); font-size: 9px;">${visibilityIcon}</button>
                                ${syncBtn}
                                <button class="btn-track-lock btn-track-action" title="Travar/Destravar pista" style="color: var(--text-secondary); font-size: 9px;">${lockIcon}</button>
                                ${muteBtn}
                                <button class="btn-track-remove btn-track-action" title="Remover pista (clipes vão para outra pista do mesmo tipo)" style="color: var(--text-muted); font-size: 9px;"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                        ${volumeSlider}
                    `;
                }

                row.querySelector(".btn-track-visibility").addEventListener("click", () => TIMELINE_STATE.toggleTrackVisibility(track.id));
                const btnThumb = row.querySelector(".btn-track-thumbnails");
                if (btnThumb) btnThumb.addEventListener("click", () => TIMELINE_STATE.toggleTrackThumbnails(track.id));
                const muteEl = row.querySelector(".btn-track-mute");
                if (muteEl) muteEl.addEventListener("click", () => TIMELINE_STATE.toggleTrackMute(track.id));
                row.querySelector(".btn-track-lock").addEventListener("click", () => TIMELINE_STATE.toggleTrackLock(track.id));
                const syncEl = row.querySelector(".btn-track-sync-lock");
                if (syncEl) syncEl.addEventListener("click", () => TIMELINE_STATE.toggleTrackSyncLock(track.id));
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

            // Alça de redimensionamento da altura individual desta pista (borda inferior) se não oculta.
            if (!track.hidden) {
                row.style.position = "relative";
                const resizeHandle = doc.createElement("div");
                resizeHandle.className = "track-resize-handle";

                let lastClickTime = 0;

                const resetTrackHeight = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    delete track.heightPx;
                    TIMELINE_STATE.clampScrollTop();
                    STATE.emit("timelineTracksChanged", TIMELINE_STATE.tracks);
                };

                resizeHandle.addEventListener("mousedown", (e) => {
                    e.stopPropagation();
                    const now = Date.now();
                    if (now - lastClickTime < 380) {
                        lastClickTime = 0;
                        resetTrackHeight(e);
                        return;
                    }
                    lastClickTime = now;

                    const startY = e.clientY;
                    const startH = TIMELINE_STATE.trackHeight(track);
                    const currentScale = TIMELINE_STATE.trackHeightScale || 1.0;
                    let isDragging = false;

                    const onMove = (ev) => {
                        const delta = ev.clientY - startY;
                        if (!isDragging && Math.abs(delta) < 3) return;
                        isDragging = true;
                        doc.body.classList.add("layout-resizing");
                        const nh = Math.min(240, Math.max(22, startH + delta));
                        track.heightPx = Math.round(nh / currentScale);
                        row.style.height = `${nh}px`;
                        TIMELINE_STATE.clampScrollTop();
                        if (this.timelineRenderer) this.timelineRenderer.requestRedraw();
                    };

                    const onUp = () => {
                        doc.body.classList.remove("layout-resizing");
                        doc.removeEventListener("mousemove", onMove);
                        doc.removeEventListener("mouseup", onUp);
                        if (isDragging) {
                            TIMELINE_STATE.clampScrollTop();
                            STATE.emit("timelineTracksChanged", TIMELINE_STATE.tracks);
                        }
                    };
                    doc.addEventListener("mousemove", onMove);
                    doc.addEventListener("mouseup", onUp);
                });

                resizeHandle.addEventListener("dblclick", resetTrackHeight);
                row.appendChild(resizeHandle);
            }

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
            this.applyTimelineDetailToScreen(detail);

            console.log(`[Timeline] Timeline ${timelineId} carregada.`);
        } catch (e) {
            console.error("Erro ao carregar timeline:", e);
            alert("Erro ao carregar timeline: " + e.message);
        }
    }

    /** Aplica uma timeline (detalhe da API) à tela: pistas, propriedades e cortes.
     *  Caminho único usado pelo carregamento manual E pela importação de arquivos
     *  (.otio/.xml/.edl) — garante comportamento idêntico nos dois fluxos. */
    applyTimelineDetailToScreen(detail) {
        const sequence = detail.sequence || {};

        // O carregamento é 1 passo de undo: Ctrl+Z restaura o estado anterior da tela
        TIMELINE_HISTORY.record(() => {
            // Restaura as pistas e as propriedades de tela
            TIMELINE_STATE.setTracks(sequence.tracks || []);
            const loadWidth = sequence.width || 1920;
            const loadHeight = sequence.height || 1080;
            const loadFps = sequence.fps || 24;
            TIMELINE_STATE.setTimelineProperties({ width: loadWidth, height: loadHeight, fps: loadFps });

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
            const newName = detail.name || `Timeline ${detail.id || ""}`;
            nameInput.value = newName;
            const btnRename = getActiveElement("btn-rename-timeline");
            if (btnRename) {
                btnRename.setAttribute("data-tooltip", `Renomear Timeline (Atual: ${newName})`);
            }
        }

        console.log(`[Timeline] Timeline aplicada à tela: ${(sequence.clips || []).length} clipes, ${(sequence.tracks || []).length} pistas.`);
    }

    // ── Importação de Timeline (.otio / .xml / .edl) ─────────────────────────

    /** Abre o diálogo de importação zerado. */
    openImportModal() {
        if (!this.importModal) return;
        if (this.importFileInput) this.importFileInput.value = "";
        if (this.importFileLabel) this.importFileLabel.textContent = "Escolher arquivo \u00B7 .otio, .xml ou .edl";
        if (this.importNameInput) this.importNameInput.value = "";
        if (this.importResultEl) this.importResultEl.style.display = "none";
        this.updateImportConfirmState();
        this.importModal.classList.add("active");
    }

    closeImportModal() {
        if (this.importModal) this.importModal.classList.remove("active");
    }

    /** Arquivo escolhido: mostra o nome, sugere título e habilita o botão. */
    onImportFileChosen() {
        const file = this.importFileInput && this.importFileInput.files ? this.importFileInput.files[0] : null;
        if (this.importFileLabel) {
            this.importFileLabel.textContent = file ? file.name : "Escolher arquivo \u00B7 .otio, .xml ou .edl";
        }
        if (file && this.importNameInput && !this.importNameInput.value.trim()) {
            const base = file.name.replace(/\.[^.]+$/, "").trim();
            if (base) this.importNameInput.value = base;
        }
        this.updateImportConfirmState();
    }

    updateImportConfirmState() {
        const temArquivo = !!(this.importFileInput && this.importFileInput.files && this.importFileInput.files.length > 0);
        if (this.btnConfirmImport) {
            this.btnConfirmImport.disabled = !temArquivo;
            this.btnConfirmImport.style.opacity = temArquivo ? "1" : "0.5";
            this.btnConfirmImport.style.cursor = temArquivo ? "pointer" : "not-allowed";
        }
    }

    /** Extrai a mensagem legível de erros da API (FastAPI devolve {"detail": "..."}). */
    extractApiError(err) {
        try {
            const parsed = JSON.parse(err.message);
            if (parsed && parsed.detail) {
                return typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
            }
        } catch (_) { /* mensagem não é JSON */ }
        return (err && err.message) || "Falha desconhecida na importação.";
    }

    /** Mostra dentro do diálogo o resultado da importação (contagens + mídia ausente). */
    renderImportResult(summary) {
        if (!this.importResultEl) return;
        const faltantes = Array.isArray(summary.missing_media) ? summary.missing_media : [];

        let html =
            `<strong style="color:#34d399;">Timeline "${this.escapeHtml(summary.name)}" importada.</strong><br>` +
            `${summary.clips_imported} clipe(s) em ${summary.tracks} pista(s)` +
            `${summary.matched_basename > 0 ? ` &middot; ${summary.matched_basename} religado(s) por nome de arquivo` : ""}.`;

        if (faltantes.length > 0) {
            html += `<br><span style="color:#eab308;">${faltantes.length} clipe(s) sem mídia no acervo (viraram lacuna):</span>`;
            const visiveis = faltantes.slice(0, 6);
            html += visiveis.map(m =>
                `<br>&nbsp;&nbsp;<i class="fa-solid fa-triangle-exclamation" style="color:#eab308;"></i> ${this.escapeHtml(m.name)}`
            ).join("");
            if (faltantes.length > visiveis.length) {
                html += `<br>&nbsp;&nbsp;… e mais ${faltantes.length - visiveis.length} arquivo(s).`;
            }
        }

        this.importResultEl.style.cssText =
            "display:block; font-size:11px; line-height:1.55; margin:0; padding:8px 10px; border-radius:6px;" +
            (faltantes.length > 0
                ? "background:rgba(234,179,8,0.12); border:1px solid rgba(234,179,8,0.35); color:#d9d9e3;"
                : "background:rgba(52,211,153,0.10); border:1px solid rgba(52,211,153,0.35); color:#d9d9e3;");
        this.importResultEl.innerHTML = html;
    }

    /** Envia o arquivo ao backend e aplica o resultado (spinner/check conforme design system). */
    async confirmImport() {
        const file = this.importFileInput && this.importFileInput.files ? this.importFileInput.files[0] : null;
        if (!file || !this.btnConfirmImport) return;

        const origHtml = this.btnConfirmImport.innerHTML;
        this.btnConfirmImport.classList.remove("btn-thumb-click-pulse");
        void this.btnConfirmImport.offsetWidth;
        this.btnConfirmImport.classList.add("btn-thumb-click-pulse");
        this.btnConfirmImport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        this.btnConfirmImport.disabled = true;

        try {
            const summary = await CapIAuAPI.importTimelineFile(
                STATE.currentProjectId,
                file,
                this.importNameInput ? this.importNameInput.value : null
            );
            this.btnConfirmImport.innerHTML = '<i class="fa-solid fa-check" style="color: var(--color-cyan);"></i>';
            if (window.showToast) {
                window.showToast(`Timeline "${summary.name}" importada (${summary.clips_imported} clipes).`, "success");
            }
            if (window.logManager) {
                window.logManager.log("Timeline", `Importação de ${file.name}: ${summary.clips_imported} clipe(s), ${summary.tracks} pista(s).`, "ACTION");
            }

            // Mídia ausente: mantém o diálogo aberto exibindo a lista religável.
            const temFaltantes = Array.isArray(summary.missing_media) && summary.missing_media.length > 0;
            if (temFaltantes) {
                this.renderImportResult(summary);
            }

            if (this.importLoadAfter && this.importLoadAfter.checked && summary.timeline_id) {
                const detail = await CapIAuAPI.fetchTimelineDetail(summary.timeline_id);
                this.applyTimelineDetailToScreen(detail);
            }

            if (!temFaltantes) this.closeImportModal();
        } catch (err) {
            console.error("[Timeline] Erro ao importar timeline:", err);
            const msg = this.extractApiError(err);
            if (this.importResultEl) {
                this.importResultEl.style.cssText =
                    "display:block; font-size:11px; line-height:1.55; margin:0; padding:8px 10px; border-radius:6px;" +
                    "background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.4); color:#fca5a5;";
                this.importResultEl.textContent = msg;
            }
            if (window.showToast) window.showToast(msg, "error");
        } finally {
            setTimeout(() => {
                if (!this.btnConfirmImport) return;
                this.btnConfirmImport.innerHTML = origHtml;
                this.btnConfirmImport.classList.remove("btn-thumb-click-pulse");
                this.updateImportConfirmState();
            }, 1200);
        }
    }

    // ── SISTEMA DE KEYMAP & PERFIS NLE ────────────────────────────────────
    initKeymapManager() {
        const btnHelp = document.getElementById("btn-timeline-help");
        const btnMaximize = document.getElementById("btn-maximize-help");
        const modalHelpCard = document.getElementById("modal-timeline-help-card");
        const btnCloseHelp = document.getElementById("btn-close-help");
        const modalHelp = document.getElementById("modal-timeline-help");
        const selectPreset = document.getElementById("select-keymap-preset");
        const tabBtnVirtual = document.getElementById("tab-btn-keymap-virtual");
        const tabBtnCheatsheet = document.getElementById("tab-btn-keymap-cheatsheet");
        const tabBtnEditor = document.getElementById("tab-btn-keymap-editor");
        const containerVirtual = document.getElementById("container-keymap-virtual");
        const containerCheatsheet = document.getElementById("container-keymap-cheatsheet");
        const containerEditor = document.getElementById("container-keymap-editor");
        const inputSearch = document.getElementById("input-search-keymap");
        const categoryPills = document.getElementById("keymap-category-pills");
        const btnExport = document.getElementById("btn-export-keymap");
        const btnImport = document.getElementById("btn-import-keymap");
        const fileImport = document.getElementById("file-import-keymap");
        const btnReset = document.getElementById("btn-reset-keymap");

        this._activeEditorCategory = "all";
        this._keymapSearchQuery = "";
        this._vkActiveLayer = "none";

        const refreshAll = () => {
            if (selectPreset) selectPreset.value = KEYMAP_SERVICE.getActivePreset();
            const lblPreset = document.getElementById("lbl-active-preset-name");
            if (lblPreset) {
                lblPreset.textContent = PRESET_NAMES[KEYMAP_SERVICE.getActivePreset()] || "Personalizado";
            }
            this.renderVirtualKeyboardUI();
            this.renderKeymapCheatsheet();
            this.renderKeymapEditor(this._activeEditorCategory, this._keymapSearchQuery);
        };

        if (btnMaximize && modalHelpCard) {
            btnMaximize.addEventListener("click", () => {
                modalHelpCard.classList.toggle("is-maximized");
                const isMax = modalHelpCard.classList.contains("is-maximized");
                btnMaximize.innerHTML = isMax ? `<i class="fa-solid fa-compress"></i>` : `<i class="fa-solid fa-expand"></i>`;
                btnMaximize.title = isMax ? "Restaurar Janela" : "Alternar Tela Cheia";
            });
        }

        if (btnHelp && modalHelp) {
            btnHelp.addEventListener("click", () => {
                modalHelp.style.display = "flex";
                refreshAll();
            });
            if (btnCloseHelp) {
                btnCloseHelp.addEventListener("click", () => {
                    modalHelp.style.display = "none";
                });
            }
            modalHelp.addEventListener("click", (e) => {
                if (e.target === modalHelp) {
                    modalHelp.style.display = "none";
                }
            });
            window.addEventListener("keydown", (e) => {
                const recorderModal = document.getElementById("modal-key-recorder");
                if (recorderModal && recorderModal.style.display !== "none") return;
                if (e.key === "Escape" && modalHelp.style.display !== "none") {
                    modalHelp.style.display = "none";
                }
            });
        }

        if (selectPreset) {
            selectPreset.addEventListener("change", (e) => {
                KEYMAP_SERVICE.setPreset(e.target.value);
                refreshAll();
                if (typeof window.showToast === "function") {
                    window.showToast(`Perfil alterado para: ${PRESET_NAMES[e.target.value] || e.target.value}`, "info");
                }
            });
        }

        const switchTab = (activeTab) => {
            [tabBtnVirtual, tabBtnCheatsheet, tabBtnEditor].forEach(btn => {
                if (btn) btn.classList.remove("active");
            });
            if (containerVirtual) containerVirtual.style.display = "none";
            if (containerCheatsheet) containerCheatsheet.style.display = "none";
            if (containerEditor) containerEditor.style.display = "none";

            if (activeTab === "virtual") {
                if (tabBtnVirtual) tabBtnVirtual.classList.add("active");
                if (containerVirtual) containerVirtual.style.display = "flex";
                this.renderVirtualKeyboardUI();
            } else if (activeTab === "cheatsheet") {
                if (tabBtnCheatsheet) tabBtnCheatsheet.classList.add("active");
                if (containerCheatsheet) containerCheatsheet.style.display = "flex";
                this.renderKeymapCheatsheet();
            } else if (activeTab === "editor") {
                if (tabBtnEditor) tabBtnEditor.classList.add("active");
                if (containerEditor) containerEditor.style.display = "flex";
                this.renderKeymapEditor(this._activeEditorCategory, this._keymapSearchQuery);
            }
        };

        if (tabBtnVirtual) tabBtnVirtual.addEventListener("click", () => switchTab("virtual"));
        if (tabBtnCheatsheet) tabBtnCheatsheet.addEventListener("click", () => switchTab("cheatsheet"));
        if (tabBtnEditor) tabBtnEditor.addEventListener("click", () => switchTab("editor"));

        if (inputSearch) {
            inputSearch.addEventListener("input", (e) => {
                this._keymapSearchQuery = e.target.value.toLowerCase().trim();
                this.renderKeymapEditor(this._activeEditorCategory, this._keymapSearchQuery);
            });
        }

        if (categoryPills) {
            categoryPills.querySelectorAll(".keymap-pill-filter").forEach(pill => {
                pill.addEventListener("click", () => {
                    categoryPills.querySelectorAll(".keymap-pill-filter").forEach(p => p.classList.remove("active"));
                    pill.classList.add("active");
                    this._activeEditorCategory = pill.dataset.category || "all";
                    this.renderKeymapEditor(this._activeEditorCategory, this._keymapSearchQuery);
                });
            });
        }

        if (btnExport) {
            btnExport.addEventListener("click", () => {
                KEYMAP_SERVICE.exportJSON();
                if (typeof window.showToast === "function") {
                    window.showToast("Atalhos exportados em arquivo JSON", "success");
                }
            });
        }

        if (btnImport && fileImport) {
            btnImport.addEventListener("click", () => {
                fileImport.click();
            });
            fileImport.addEventListener("change", (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const result = KEYMAP_SERVICE.importJSON(ev.target.result);
                    if (result.success) {
                        if (typeof window.showToast === "function") {
                            window.showToast("Atalhos customizados importados com sucesso!", "success");
                        }
                        refreshAll();
                    } else {
                        if (typeof window.showToast === "function") {
                            window.showToast(`Erro na importação: ${result.error}`, "error");
                        }
                    }
                    fileImport.value = "";
                };
                reader.readAsText(file);
            });
        }

        if (btnReset) {
            btnReset.addEventListener("click", () => {
                if (confirm("Deseja restaurar todos os atalhos para os valores de fábrica do CapIAu?")) {
                    KEYMAP_SERVICE.resetAllToDefault();
                    refreshAll();
                    if (typeof window.showToast === "function") {
                        window.showToast("Atalhos restaurados para o padrão de fábrica", "info");
                    }
                }
            });
        }

        STATE.on("keymapChanged", () => {
            refreshAll();
        });

        this.initVirtualKeyboardEvents();
        this.initKeyRecorderModal();
        refreshAll();
    }

    renderVirtualKeyboardUI() {
        const reverseMap = KEYMAP_SERVICE.getReverseBindingMap();
        const keycaps = document.querySelectorAll(".vk-keycap");
        const activeLayer = this._vkActiveLayer || "none";

        keycaps.forEach(keyEl => {
            const code = keyEl.dataset.code;
            if (!code) return;

            // Limpa classes anteriores de categorias
            keyEl.classList.remove(
                "vk-cat-playback", "vk-cat-tools", "vk-cat-edit", 
                "vk-cat-markers", "vk-cat-ai", "vk-cat-canvas_history"
            );

            // Remove ponto indicador antigo se existir
            const oldDot = keyEl.querySelector(".vk-key-dot");
            if (oldDot) oldDot.remove();

            let combo = code;
            if (activeLayer === "shift") combo = "Shift+" + code;
            else if (activeLayer === "ctrl") combo = "Ctrl+" + code;
            else if (activeLayer === "alt") combo = "Alt+" + code;

            const cmd = reverseMap[combo] || (activeLayer === "none" ? reverseMap[code] : null);

            if (cmd) {
                keyEl.classList.add(`vk-cat-${cmd.category}`);
                const dot = document.createElement("span");
                dot.className = "vk-key-dot";
                if (cmd.category === "playback") dot.style.backgroundColor = "var(--color-cyan)";
                else if (cmd.category === "tools") dot.style.backgroundColor = "var(--color-amber)";
                else if (cmd.category === "edit") dot.style.backgroundColor = "var(--color-violet)";
                else if (cmd.category === "markers") dot.style.backgroundColor = "var(--color-sky)";
                else if (cmd.category === "ai") dot.style.backgroundColor = "#ec4899";
                else dot.style.backgroundColor = "#94a3b8";
                keyEl.appendChild(dot);
            }
        });

        this.renderSchematicIndex(reverseMap);
    }

    renderSchematicIndex(reverseMap) {
        const listPlayback = document.getElementById("vk-schematic-list-playback");
        const listEdit = document.getElementById("vk-schematic-list-edit");
        const listTools = document.getElementById("vk-schematic-list-tools");

        if (!listPlayback || !listEdit || !listTools) return;

        listPlayback.innerHTML = "";
        listEdit.innerHTML = "";
        listTools.innerHTML = "";

        if (!reverseMap) {
            reverseMap = KEYMAP_SERVICE.getReverseBindingMap();
        }

        // Agrupa por categoria para renderização esquemática
        Object.entries(reverseMap).forEach(([combo, cmd]) => {
            const item = document.createElement("div");
            item.className = "vk-schematic-item";
            item.dataset.code = combo.split("+").pop();
            item.dataset.combo = combo;

            const cleanKey = KEYMAP_SERVICE.formatCombo(combo);
            const cmdName = cmd.label || cmd.name || cmd.id;

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                    <kbd style="padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.12); font-family: monospace; font-weight: 700; font-size: 10px; color: var(--color-cyan); white-space: nowrap;">${cleanKey}</kbd>
                    <span style="font-weight: 600; color: rgba(255,255,255,0.9); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${cmdName}</span>
                </div>
                <span style="font-size: 9px; color: var(--text-muted); font-family: monospace; margin-left: 4px;">→</span>
            `;

            // Hover bidirecional: passa no índice -> ilumina a tecla
            item.addEventListener("mouseenter", () => {
                this.highlightKeycap(item.dataset.code);
            });
            item.addEventListener("mouseleave", () => {
                this.clearKeymapHighlight();
            });
            item.addEventListener("click", () => {
                this.triggerKeymapFeedback(item.dataset.code, combo, cmd);
            });

            if (cmd.category === "playback") {
                listPlayback.appendChild(item);
            } else if (cmd.category === "edit") {
                listEdit.appendChild(item);
            } else {
                listTools.appendChild(item);
            }
        });
    }

    highlightKeycap(code) {
        const keyEl = document.querySelector(`.vk-keycap[data-code="${code}"]`);
        if (keyEl) keyEl.classList.add("highlight-hover");
    }

    highlightSchematicItem(code, combo) {
        document.querySelectorAll(".vk-schematic-item").forEach(item => {
            if (item.dataset.combo === combo || item.dataset.code === code) {
                item.classList.add("active");
                item.scrollIntoView({ behavior: "smooth", block: "nearest" });
            } else {
                item.classList.remove("active");
            }
        });
    }

    clearKeymapHighlight() {
        document.querySelectorAll(".vk-keycap").forEach(k => k.classList.remove("highlight-hover"));
        document.querySelectorAll(".vk-schematic-item").forEach(item => item.classList.remove("active"));
    }

    triggerKeymapFeedback(code, comboDisplay, cmd) {
        document.querySelectorAll(".vk-keycap").forEach(k => k.classList.remove("is-pressed"));
        const keyEl = document.querySelector(`.vk-keycap[data-code="${code}"]`);
        if (keyEl) {
            keyEl.classList.add("is-pressed");
            setTimeout(() => keyEl.classList.remove("is-pressed"), 250);
        }

        this.highlightSchematicItem(code, comboDisplay);

        const badge = document.getElementById("vk-live-combo-badge");
        const title = document.getElementById("vk-live-action-title");
        const desc = document.getElementById("vk-live-action-desc");

        const cleanCombo = KEYMAP_SERVICE.formatCombo(comboDisplay);
        if (badge) badge.textContent = cleanCombo;

        if (cmd) {
            const cmdName = cmd.label || cmd.name || cmd.id;
            if (title) title.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--color-cyan);"></i> <span>${cmdName}</span>`;
            if (desc) desc.textContent = cmd.description || "Comando atribuído.";
        } else {
            if (title) title.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color: var(--text-muted);"></i> <span style="color: var(--text-muted);">Nenhuma ação mapeada</span>`;
            if (desc) desc.textContent = `Nenhum comando atribuído à combinação [${cleanCombo}] no perfil ativo.`;
        }
    }

    initVirtualKeyboardEvents() {
        const modal = document.getElementById("modal-timeline-help");

        // Botões de camada de modificadores
        document.querySelectorAll(".vk-mod-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                this._vkActiveLayer = btn.dataset.layer || "none";
                document.querySelectorAll(".vk-mod-btn").forEach(b => {
                    if (b === btn) {
                        b.classList.add("active");
                        b.style.background = "rgba(6,182,212,0.2)";
                        b.style.borderColor = "var(--color-cyan)";
                        b.style.color = "var(--color-cyan)";
                    } else {
                        b.classList.remove("active");
                        b.style.background = "rgba(255,255,255,0.04)";
                        b.style.borderColor = "rgba(255,255,255,0.08)";
                        b.style.color = "var(--text-secondary)";
                    }
                });
                this.renderVirtualKeyboardUI();
            });
        });

        // Hover bidirecional e clique nas teclas do teclado virtual
        document.querySelectorAll(".vk-keycap").forEach(keyEl => {
            keyEl.addEventListener("mouseenter", () => {
                const code = keyEl.dataset.code;
                let combo = code;
                const activeLayer = this._vkActiveLayer || "none";
                if (activeLayer === "shift") combo = "Shift+" + code;
                else if (activeLayer === "ctrl") combo = "Ctrl+" + code;
                else if (activeLayer === "alt") combo = "Alt+" + code;

                const reverseMap = KEYMAP_SERVICE.getReverseBindingMap();
                const cmd = reverseMap[combo] || (activeLayer === "none" ? reverseMap[code] : null);

                this.highlightSchematicItem(code, combo);

                // Prévia ao vivo no rodapé
                const badge = document.getElementById("vk-live-combo-badge");
                const title = document.getElementById("vk-live-action-title");
                const desc = document.getElementById("vk-live-action-desc");
                const cleanCombo = KEYMAP_SERVICE.formatCombo(combo);

                if (badge) badge.textContent = cleanCombo;
                if (cmd) {
                    const cmdName = cmd.label || cmd.name || cmd.id;
                    if (title) title.innerHTML = `<i class="fa-solid fa-circle-info" style="color: var(--color-cyan);"></i> <span>${cmdName}</span>`;
                    if (desc) desc.textContent = cmd.description || "";
                } else {
                    if (title) title.innerHTML = `<span style="color: var(--text-muted);">Tecla [${cleanCombo}]</span>`;
                    if (desc) desc.textContent = "Nenhum comando mapeado nesta tecla para a camada atual.";
                }
            });

            keyEl.addEventListener("mouseleave", () => {
                this.clearKeymapHighlight();
            });

            keyEl.addEventListener("click", () => {
                const code = keyEl.dataset.code;
                let combo = code;
                const activeLayer = this._vkActiveLayer || "none";
                if (activeLayer === "shift") combo = "Shift+" + code;
                else if (activeLayer === "ctrl") combo = "Ctrl+" + code;
                else if (activeLayer === "alt") combo = "Alt+" + code;

                const reverseMap = KEYMAP_SERVICE.getReverseBindingMap();
                const cmd = reverseMap[combo] || (activeLayer === "none" ? reverseMap[code] : null);

                this.triggerKeymapFeedback(code, combo, cmd);
            });
        });

        // Escuta digitação física de teclas reais dentro do modal
        window.addEventListener("keydown", (e) => {
            if (!modal || modal.style.display === "none") return;
            const recorderModal = document.getElementById("modal-key-recorder");
            if (recorderModal && recorderModal.style.display !== "none") return;

            // Ignora se estiver digitando no campo de busca do editor
            if (e.target && e.target.tagName === "INPUT") return;

            // Atualiza camada de modificadores
            if (e.shiftKey && this._vkActiveLayer !== "shift") {
                this.setVirtualKeyboardLayer("shift");
            } else if ((e.ctrlKey || e.metaKey) && this._vkActiveLayer !== "ctrl") {
                this.setVirtualKeyboardLayer("ctrl");
            } else if (e.altKey && this._vkActiveLayer !== "alt") {
                this.setVirtualKeyboardLayer("alt");
            }

            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
            if (e.altKey) parts.push("Alt");
            if (e.shiftKey) parts.push("Shift");

            let code = e.code;
            if (!code || code === "Unidentified") {
                code = e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key;
            }
            parts.push(code);

            const fullCombo = parts.join("+");
            const reverseMap = KEYMAP_SERVICE.getReverseBindingMap();
            const cmd = reverseMap[fullCombo] || reverseMap[code];

            this.triggerKeymapFeedback(code, fullCombo, cmd);
        });

        window.addEventListener("keyup", (e) => {
            if (!modal || modal.style.display === "none") return;
            if (!e.shiftKey && !e.ctrlKey && !e.altKey && this._vkActiveLayer !== "none") {
                this.setVirtualKeyboardLayer("none");
            }
        });
    }

    setVirtualKeyboardLayer(layer) {
        this._vkActiveLayer = layer;
        document.querySelectorAll(".vk-mod-btn").forEach(btn => {
            if (btn.dataset.layer === layer) {
                btn.classList.add("active");
                btn.style.background = "rgba(6,182,212,0.2)";
                btn.style.borderColor = "var(--color-cyan)";
                btn.style.color = "var(--color-cyan)";
            } else {
                btn.classList.remove("active");
                btn.style.background = "rgba(255,255,255,0.04)";
                btn.style.borderColor = "rgba(255,255,255,0.08)";
                btn.style.color = "var(--text-secondary)";
            }
        });
        this.renderVirtualKeyboardUI();
    }

    renderKeymapCheatsheet() {
        const container = document.getElementById("keymap-cheatsheet-content");
        if (!container) return;

        const categoryIcons = {
            playback: "fa-play",
            tools: "fa-toolbox",
            edit: "fa-scissors",
            markers: "fa-bookmark",
            ai: "fa-wand-magic-sparkles",
            canvas_history: "fa-sliders"
        };

        const activePreset = KEYMAP_SERVICE.getActivePreset();
        let html = "";

        // Renderiza cada categoria
        Object.entries(COMMAND_CATEGORIES).forEach(([catId, catMeta], index) => {
            const cmds = Object.values(COMMANDS_CATALOG).filter(c => c.category === catId);
            if (cmds.length === 0) return;

            const icon = categoryIcons[catId] || "fa-keyboard";
            const catTitle = catMeta.label || catMeta.name || catId;

            html += `
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px 12px;">
                <h4 style="color: #fff; margin: 0 0 8px 0; font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid ${icon}" style="color: var(--color-cyan); font-size: 10px;"></i> ${catTitle}
                </h4>
                <div style="display: grid; grid-template-columns: 160px 1fr; gap: 6px; font-size: 11.5px; align-items: center;">
            `;

            cmds.forEach(cmd => {
                const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML(cmd.id);
                html += `
                    <div>${badgesHtml}</div>
                    <div style="color: rgba(255,255,255,0.85);">${cmd.description}</div>
                `;
            });

            html += `
                </div>
            </div>
            `;
        });

        // 7. Pistas Dinâmicas (Multipista)
        html += `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px 12px;">
            <h4 style="color: #fff; margin: 0 0 6px 0; font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-layer-group" style="color: var(--color-cyan); font-size: 10px;"></i> 7. Pistas Dinâmicas (Multipista)
            </h4>
            <p style="margin: 0; font-size: 11.5px; color: rgba(255,255,255,0.85); line-height: 1.5;">
                Crie quantas pistas precisar pelo botão <strong>+</strong> no topo da sidebar de trilhas. Cada faixa possui <strong>volume, mute, trava (cadeado)</strong> e o modo <strong>ímã <i class="fa-solid fa-magnet" style="font-size: 9px;"></i></strong>: faixas magnéticas mantêm clipes grudados em sequência contínua; faixas livres permitem posicionamento em qualquer ponto no tempo.
            </p>
        </div>
        `;

        container.innerHTML = html;
    }

    renderKeymapEditor(activeCategory = "all", searchQuery = "") {
        const tbody = document.getElementById("keymap-editor-table-body");
        if (!tbody) return;

        let cmds = Object.values(COMMANDS_CATALOG);

        if (activeCategory !== "all") {
            cmds = cmds.filter(c => c.category === activeCategory);
        }

        if (searchQuery) {
            cmds = cmds.filter(c => 
                (c.label || c.name || c.id).toLowerCase().includes(searchQuery) ||
                (c.description || "").toLowerCase().includes(searchQuery) ||
                (c.id || "").toLowerCase().includes(searchQuery)
            );
        }

        if (cmds.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 25px; color: var(--text-muted); font-size: 12px;">
                        Nenhum comando encontrado com os filtros atuais.
                    </td>
                </tr>
            `;
            return;
        }

        const isCustom = KEYMAP_SERVICE.getActivePreset() === "custom";

        let html = "";
        let currentCat = "";

        cmds.forEach(cmd => {
            if (activeCategory === "all" && cmd.category !== currentCat) {
                currentCat = cmd.category;
                const catMeta = COMMAND_CATEGORIES[currentCat];
                const catTitle = catMeta ? (catMeta.label || catMeta.name) : currentCat;
                html += `
                    <tr style="background: rgba(255,255,255,0.03);">
                        <td colspan="4" style="padding: 6px 12px; font-weight: 700; color: var(--color-cyan); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px;">
                            ${catTitle}
                        </td>
                    </tr>
                `;
            }

            const badgesHtml = KEYMAP_SERVICE.getShortcutBadgesHTML(cmd.id);
            const isOverridden = isCustom && KEYMAP_SERVICE.customBindings[cmd.id] !== undefined;
            const cmdDisplayName = cmd.label || cmd.name || cmd.id;

            html += `
                <tr data-cmd-id="${cmd.id}">
                    <td style="font-weight: 600; color: #fff;">
                        ${cmdDisplayName}
                        ${isOverridden ? '<span style="font-size: 9px; color: var(--color-cyan); margin-left: 4px; background: rgba(6,182,212,0.15); padding: 1px 4px; border-radius: 3px;">MODIFICADO</span>' : ''}
                    </td>
                    <td style="color: var(--text-secondary); font-size: 11px;">
                        ${cmd.description}
                    </td>
                    <td style="text-align: center;">
                        <button class="keymap-badge-btn btn-trigger-record" data-cmd-id="${cmd.id}" title="Clique para gravar um novo atalho">
                            ${badgesHtml}
                            <i class="fa-solid fa-pen-to-square" style="font-size: 10px; margin-left: 4px; opacity: 0.7;"></i>
                        </button>
                    </td>
                    <td style="text-align: center;">
                        <button class="btn-keymap-row-edit btn-trigger-record" data-cmd-id="${cmd.id}" title="Remapear atalho">
                            <i class="fa-solid fa-keyboard"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

        // Binda eventos de clique para gravar atalho
        tbody.querySelectorAll(".btn-trigger-record").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const cmdId = btn.getAttribute("data-cmd-id");
                if (cmdId) {
                    this.openKeyRecorderModal(cmdId);
                }
            });
        });
    }

    initKeyRecorderModal() {
        const modal = document.getElementById("modal-key-recorder");
        const btnCancelX = document.getElementById("btn-cancel-key-recorder");
        const btnCancel = document.getElementById("btn-recorder-cancel");
        const btnSave = document.getElementById("btn-recorder-save");
        const lblLiveKeys = document.getElementById("lbl-recorder-live-keys");
        const conflictBox = document.getElementById("key-recorder-conflict-box");
        const conflictMsg = document.getElementById("lbl-recorder-conflict-msg");

        this._recordedCombo = null;
        this._recordingCmdId = null;

        const closeModal = () => {
            if (modal) modal.style.display = "none";
            this._recordingCmdId = null;
            this._recordedCombo = null;
        };

        if (btnCancelX) btnCancelX.addEventListener("click", closeModal);
        if (btnCancel) btnCancel.addEventListener("click", closeModal);

        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) closeModal();
            });
        }

        const handleKeyRecord = (e) => {
            if (!this._recordingCmdId || !modal || modal.style.display === "none") return;

            // Ignora teclas modificadoras sozinhas
            if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (e.key === "Escape") {
                closeModal();
                return;
            }

            // Normaliza a combinação
            const parts = [];
            if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
            if (e.altKey) parts.push("Alt");
            if (e.shiftKey) parts.push("Shift");

            let code = e.code;
            if (!code || code === "Unidentified") {
                code = e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key;
            }
            parts.push(code);

            const combo = parts.join("+");
            this._recordedCombo = combo;

            // Exibição amigável
            if (lblLiveKeys) {
                lblLiveKeys.textContent = KEYMAP_SERVICE.formatCombo(combo);
            }

            if (btnSave) {
                btnSave.disabled = false;
            }

            // Checagem de conflitos
            const conflicts = KEYMAP_SERVICE.findConflicts(combo, this._recordingCmdId);
            if (conflicts.length > 0) {
                const confNames = conflicts.map(c => c.label || c.name || c.id).join(", ");
                if (conflictBox && conflictMsg) {
                    conflictMsg.textContent = `Atenção: Combinação já usada por: ${confNames}. Se salvar, o atalho será reatribuído para este comando.`;
                    conflictBox.style.display = "block";
                }
            } else {
                if (conflictBox) conflictBox.style.display = "none";
            }

            if (e.key === "Enter" && this._recordedCombo) {
                saveBinding();
            }
        };

        const saveBinding = () => {
            if (!this._recordingCmdId || !this._recordedCombo) return;

            KEYMAP_SERVICE.setCustomBinding(this._recordingCmdId, this._recordedCombo);
            const cmd = KEYMAP_SERVICE.getCommand(this._recordingCmdId);
            const cmdName = cmd ? (cmd.label || cmd.name) : this._recordingCmdId;

            if (typeof window.showToast === "function") {
                window.showToast(`Atalho para "${cmdName}" definido como ${KEYMAP_SERVICE.formatCombo(this._recordedCombo)}`, "success");
            }

            closeModal();
            this.renderKeymapCheatsheet();
            this.renderKeymapEditor(this._activeEditorCategory, this._keymapSearchQuery);

            const selectPreset = document.getElementById("select-keymap-preset");
            if (selectPreset) selectPreset.value = "custom";
        };

        if (btnSave) {
            btnSave.addEventListener("click", saveBinding);
        }

        window.addEventListener("keydown", handleKeyRecord, true);
    }

    openKeyRecorderModal(cmdId) {
        const modal = document.getElementById("modal-key-recorder");
        const lblCmdName = document.getElementById("lbl-recorder-cmd-name");
        const lblLiveKeys = document.getElementById("lbl-recorder-live-keys");
        const conflictBox = document.getElementById("key-recorder-conflict-box");
        const btnSave = document.getElementById("btn-recorder-save");

        const cmd = KEYMAP_SERVICE.getCommand(cmdId);
        if (!cmd || !modal) return;

        this._recordingCmdId = cmdId;
        this._recordedCombo = null;

        if (lblCmdName) lblCmdName.textContent = cmd.label || cmd.name || cmd.id;
        if (lblLiveKeys) lblLiveKeys.textContent = "Pressione uma tecla ou combinação (ex: Ctrl+K, S, Shift+R)...";
        if (conflictBox) conflictBox.style.display = "none";
        if (btnSave) btnSave.disabled = true;

        modal.style.display = "flex";
    }
}

// ── UTILITÁRIOS GLOBAIS DE ANIMAÇÃO FLY-TO-TASKS E EXPANSÃO DO MLD ──
window.flyToTasksAnimation = function(sourceEl, onComplete) {
    const startEl = sourceEl || document.getElementById("btn-reanalyze-failed");
    const targetEl = document.getElementById("btn-tab-tasks") || document.getElementById("sidebar-right");
    
    if (!startEl || !targetEl) {
        if (onComplete) onComplete();
        return;
    }

    const startRect = startEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    const particle = document.createElement("div");
    particle.className = "fly-to-tasks-particle";
    particle.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i>';
    
    const startX = startRect.left + startRect.width / 2 - 14;
    const startY = startRect.top + startRect.height / 2 - 14;
    const targetX = targetRect.left + targetRect.width / 2 - 14;
    const targetY = targetRect.top + targetRect.height / 2 - 14;

    particle.style.left = `${startX}px`;
    particle.style.top = `${startY}px`;
    document.body.appendChild(particle);

    const midY = Math.min(startY, targetY) - 50;

    const animation = particle.animate([
        {
            transform: `translate3d(0px, 0px, 0px) scale(1)`,
            opacity: 1
        },
        {
            transform: `translate3d(${(targetX - startX) * 0.5}px, ${midY - startY}px, 0px) scale(1.3)`,
            opacity: 0.95
        },
        {
            transform: `translate3d(${targetX - startX}px, ${targetY - startY}px, 0px) scale(0.3)`,
            opacity: 0.1
        }
    ], {
        duration: 550,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
    });

    animation.onfinish = () => {
        particle.remove();
        if (targetEl) {
            targetEl.classList.add("tasks-tab-pulse");
            setTimeout(() => targetEl.classList.remove("tasks-tab-pulse"), 400);
        }
        if (onComplete) onComplete();
    };
};

window.openTasksDrawerAndSwitchTab = function() {
    // 1. Se a sidebar da direita (MLD) estiver recolhida, abre
    if (window.expandRightPanel) {
        window.expandRightPanel();
    } else {
        const sidebarRight = document.getElementById("sidebar-right");
        const reopenRight = document.getElementById("reopen-right");
        if (sidebarRight && sidebarRight.classList.contains("collapsed")) {
            sidebarRight.classList.remove("collapsed");
            if (reopenRight) reopenRight.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        }
    }
    // 2. Alterna para a aba de Tarefas
    const btnTabTasks = document.getElementById("btn-tab-tasks");
    if (btnTabTasks) {
        btnTabTasks.click();
    }
    if (STATE && STATE.emit) {
        STATE.emit("rightTabChanged", "tasks");
    }
};
