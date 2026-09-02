import { STATE } from "./state.js";
import { KEYMAP_SERVICE } from "./keymapService.js";

window.popoutWindows = {};

/**
 * Retorna o nome fixo da janela popout para reutilização multi-monitor.
 */
export function getPopoutWindowName(panelId) {
    if (panelId === "sidebar-left") return "CapIAu_Library_Window";
    if (panelId === "sidebar-right") return "CapIAu_RightSidebar_Window";
    if (panelId === "timeline-panel") return "CapIAu_Timeline_Window";
    if (panelId === "source-player-panel") return "CapIAu_SourcePlayer_Window";
    if (panelId === "program-player-panel") return "CapIAu_ProgramPlayer_Window";
    return `CapIAu_${panelId.replace(/-/g, "_")}_Window`;
}

export function getPanelIdFromWindowName(windowName) {
    if (windowName === "CapIAu_Library_Window") return "sidebar-left";
    if (windowName === "CapIAu_RightSidebar_Window") return "sidebar-right";
    if (windowName === "CapIAu_Timeline_Window") return "timeline-panel";
    if (windowName === "CapIAu_SourcePlayer_Window") return "source-player-panel";
    if (windowName === "CapIAu_ProgramPlayer_Window") return "program-player-panel";
    return null;
}

/**
 * Procura um elemento pelo ID varrendo a janela principal e qualquer janela popout aberta.
 */
export function getActiveElement(id) {
    for (const name in window.popoutWindows) {
        const win = window.popoutWindows[name];
        if (win && !win.closed) {
            try {
                const el = win.document?.getElementById(id);
                if (el) return el;
            } catch (err) {}
        }
    }
    return document.getElementById(id);
}

/**
 * Procura um elemento usando querySelector varrendo a janela principal e qualquer janela popout aberta.
 */
export function getActiveQuerySelector(selector) {
    for (const name in window.popoutWindows) {
        const win = window.popoutWindows[name];
        if (win && !win.closed) {
            try {
                const el = win.document?.querySelector(selector);
                if (el) return el;
            } catch (err) {}
        }
    }
    return document.querySelector(selector);
}

export class WorkspaceManager {
    constructor() {
        this.channel = new BroadcastChannel("capiau-workspace-sync");
        this.poppedElements = {};
        this.originalParents = {};
        this.originalNextSiblings = {};
        this.monitorsLayout = localStorage.getItem("capiau_monitors_layout") || "side-by-side";
        this.timelinePosition = localStorage.getItem("capiau_timeline_position") || "center";
        this.init();
    }

    sendHandshake() {
        try {
            this.channel.postMessage({
                type: "MAIN_HANDSHAKE",
                timestamp: Date.now()
            });
        } catch (e) {}
    }

    init() {
        // Escuta mensagens do BroadcastChannel para sincronia bidirecional
        this.channel.addEventListener("message", (e) => this.handleMessage(e));

        // Dispara handshake inicial e retries para reconectar janelas já abertas no segundo monitor
        this.sendHandshake();
        setTimeout(() => this.sendHandshake(), 100);
        setTimeout(() => this.sendHandshake(), 350);
        setTimeout(() => this.sendHandshake(), 800);

        // Vincula cliques de pop-out nos cabeçalhos dos painéis
        const popoutButtons = [
            { btnId: "btn-popout-library", panelId: "sidebar-left" },
            { btnId: "btn-popout-right", panelId: "sidebar-right" },
            { btnId: "btn-popout-timeline", panelId: "timeline-panel" },
            { btnId: "btn-popout-source", panelId: "source-player-panel" },
            { btnId: "btn-popout-program", panelId: "program-player-panel" }
        ];

        popoutButtons.forEach(({ btnId, panelId }) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.togglePopout(panelId);
                });
            }
        });

        // Atalhos de maximização local de players (Source / Program)
        const btnExpandSource = document.getElementById("btn-expand-source");
        const btnSwapToProgram = document.getElementById("btn-swap-to-program");
        const btnSwapToSource = document.getElementById("btn-swap-to-source");

        const updateSwapButtonsVisibility = () => {
            const src = document.getElementById("source-player-panel");
            const prg = document.getElementById("program-player-panel");
            const srcMax = src && src.classList.contains("maximized");
            const prgMax = prg && prg.classList.contains("maximized");
            if (btnSwapToProgram) btnSwapToProgram.style.display = srcMax ? "" : "none";
            if (btnSwapToSource) btnSwapToSource.style.display = prgMax ? "" : "none";
        };

        if (btnExpandSource) {
            btnExpandSource.addEventListener("click", (e) => {
                e.stopPropagation();
                const panel = document.getElementById("source-player-panel");
                panel.classList.toggle("maximized");
                btnExpandSource.innerHTML = panel.classList.contains("maximized") 
                    ? `<i class="fa-solid fa-compress"></i>` 
                    : `<i class="fa-solid fa-expand"></i>`;
                updateSwapButtonsVisibility();
            });
        }

        const btnExpandProgram = document.getElementById("btn-expand-program");
        if (btnExpandProgram) {
            btnExpandProgram.addEventListener("click", (e) => {
                e.stopPropagation();
                const panel = document.getElementById("program-player-panel");
                panel.classList.toggle("maximized");
                btnExpandProgram.innerHTML = panel.classList.contains("maximized") 
                    ? `<i class="fa-solid fa-compress"></i>` 
                    : `<i class="fa-solid fa-expand"></i>`;
                updateSwapButtonsVisibility();
            });
        }

        // Botões de troca de player maximizado (swap)
        const swapToProgram = () => {
            const src = document.getElementById("source-player-panel");
            const prg = document.getElementById("program-player-panel");
            if (src && src.classList.contains("maximized")) {
                if (btnExpandSource) btnExpandSource.click();
                if (btnExpandProgram) btnExpandProgram.click();
                window.activeFocusedPlayer = "program";
            }
        };
        const swapToSource = () => {
            const src = document.getElementById("source-player-panel");
            const prg = document.getElementById("program-player-panel");
            if (prg && prg.classList.contains("maximized")) {
                if (btnExpandProgram) btnExpandProgram.click();
                if (btnExpandSource) btnExpandSource.click();
                window.activeFocusedPlayer = "source";
            }
        };

        if (btnSwapToProgram) btnSwapToProgram.addEventListener("click", (e) => { e.stopPropagation(); swapToProgram(); });
        if (btnSwapToSource) btnSwapToSource.addEventListener("click", (e) => { e.stopPropagation(); swapToSource(); });

        // Clique simples nos players: play/pause | Clique duplo: maximizar/minimizar
        const sourceWrapper = document.getElementById("source-video-wrapper");
        const programWrapper = document.getElementById("program-video-wrapper");

        const setupPlayerClickHandlers = (wrapper, videoId, btnPlayId, btnExpandId) => {
            if (!wrapper) return;
            let clickTimer = null;
            
            // Ouvinte de clique geral no wrapper (e elementos internos que propagam)
            wrapper.addEventListener("click", (e) => {
                // Ignora se clicou em algum botão ou controle, ou se clicou em face-box (desambiguação)
                if (e.target.closest("button") || e.target.closest(".face-box") || e.target.closest(".player-controls")) return;
                
                // Evita disparar se o usuário acabou de desenhar um retângulo de rosto no overlayContainer
                if (window.player && window.player.isDrawing) return;

                if (clickTimer) { 
                    clearTimeout(clickTimer); 
                    clickTimer = null; 
                    return; 
                }
                
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    // Play/Pause. Sem videoId (Program) o clique vai para o botão do painel:
                    // o Program compõe a timeline num pool de buffers <video>, então não há
                    // um elemento fixo para dar play — quem manda é o ProgramPlayer.
                    if (!videoId) {
                        const btnPlay = document.getElementById(btnPlayId);
                        if (btnPlay) btnPlay.click();
                        return;
                    }
                    const vid = document.getElementById(videoId);
                    if (vid && vid.src) {
                        if (vid.paused) vid.play(); else vid.pause();
                        const btnPlay = document.getElementById(btnPlayId);
                        if (btnPlay) {
                            btnPlay.innerHTML = vid.paused
                                ? `<i class="fa-solid fa-play"></i>`
                                : `<i class="fa-solid fa-pause"></i>`;
                        }
                    }
                }, 220);
            });

            wrapper.addEventListener("dblclick", (e) => {
                if (e.target.closest("button") || e.target.closest(".face-box") || e.target.closest(".player-controls")) return;
                const btnExpand = document.getElementById(btnExpandId);
                if (btnExpand) btnExpand.click();
            });
        };

        setupPlayerClickHandlers(sourceWrapper, "source-video", "btn-source-play", "btn-expand-source");
        setupPlayerClickHandlers(programWrapper, null, "btn-program-play", "btn-expand-program");

        const selectWorkspace = document.getElementById("select-workspace");
        if (selectWorkspace) {
            selectWorkspace.addEventListener("change", (e) => {
                const ws = e.target.value;
                this.applyWorkspace(ws);
            });
        }

        const btnSaveWorkspace = document.getElementById("btn-save-workspace");
        if (btnSaveWorkspace) {
            btnSaveWorkspace.addEventListener("click", (e) => {
                e.stopPropagation();
                this.promptSaveWorkspace();
            });
        }

        const btnSaveCollapsed = document.getElementById("btn-save-workspace-collapsed");
        if (btnSaveCollapsed) {
            btnSaveCollapsed.addEventListener("click", (e) => {
                e.stopPropagation();
                this.promptSaveWorkspace();
            });
        }

        // Atalho de teclado global para abrir a modal de salvamento de workspace de qualquer lugar
        document.addEventListener("keydown", (e) => {
            if (KEYMAP_SERVICE.matches(e, "workspace.save")) {
                e.preventDefault();
                this.promptSaveWorkspace();
            }
        });

        const btnRenameWorkspace = document.getElementById("btn-rename-workspace");
        if (btnRenameWorkspace) {
            btnRenameWorkspace.addEventListener("click", (e) => {
                e.stopPropagation();
                if (selectWorkspace && selectWorkspace.value) {
                    this.renameCustomWorkspace(selectWorkspace.value);
                }
            });
        }

        const btnDeleteWorkspace = document.getElementById("btn-delete-workspace");
        if (btnDeleteWorkspace) {
            btnDeleteWorkspace.addEventListener("click", (e) => {
                e.stopPropagation();
                if (selectWorkspace && selectWorkspace.value) {
                    this.deleteCustomWorkspace(selectWorkspace.value);
                }
            });
        }

        // Vincular controles do Modal de Salvamento / Sobrescrita
        const modalCloseBtn = document.getElementById("btn-close-save-workspace-modal");
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener("click", () => this.closeSaveWorkspaceModal());
        }

        const modalOverlay = document.getElementById("save-workspace-modal");
        if (modalOverlay) {
            modalOverlay.addEventListener("click", (e) => {
                if (e.target === modalOverlay) this.closeSaveWorkspaceModal();
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && modalOverlay && modalOverlay.style.display === "flex") {
                this.closeSaveWorkspaceModal();
            }
        });

        const btnDoOverwrite = document.getElementById("btn-modal-do-overwrite");
        if (btnDoOverwrite) {
            btnDoOverwrite.addEventListener("click", () => {
                const selectOverwrite = document.getElementById("modal-select-overwrite");
                if (selectOverwrite && selectOverwrite.value) {
                    const customWorkspaces = this.getCustomWorkspaces();
                    const ws = customWorkspaces[selectOverwrite.value];
                    if (ws) {
                        this.saveCustomWorkspace(ws.name, ws.id);
                        this.closeSaveWorkspaceModal();
                    }
                }
            });
        }

        const btnDoSaveNew = document.getElementById("btn-modal-do-save-new");
        const inputNewName = document.getElementById("modal-input-new-ws-name");
        
        const saveNewAction = () => {
            if (inputNewName && inputNewName.value.trim()) {
                const newId = `custom_${Date.now()}`;
                this.saveCustomWorkspace(inputNewName.value.trim(), newId);
                this.closeSaveWorkspaceModal();
            } else {
                alert("Por favor, digite um nome para a nova workspace.");
            }
        };

        if (btnDoSaveNew) {
            btnDoSaveNew.addEventListener("click", saveNewAction);
        }
        if (inputNewName) {
            inputNewName.addEventListener("keypress", (e) => {
                if (e.key === "Enter") saveNewAction();
            });
        }

        // Controles de Layout (Monitores & Timeline)
        const selectMonitorsLayout = document.getElementById("select-monitors-layout");
        if (selectMonitorsLayout) {
            selectMonitorsLayout.addEventListener("change", (e) => {
                this.setMonitorsLayout(e.target.value);
            });
        }

        const selectTimelinePosition = document.getElementById("select-timeline-position");
        if (selectTimelinePosition) {
            selectTimelinePosition.addEventListener("change", (e) => {
                this.setTimelinePosition(e.target.value);
            });
        }

        const btnToggleMonitorsSrc = document.getElementById("btn-toggle-monitors-layout-source");
        const btnToggleMonitorsPrg = document.getElementById("btn-toggle-monitors-layout-program");
        const handleToggleMonitors = (e) => {
            e.stopPropagation();
            this.toggleMonitorsLayout();
        };
        if (btnToggleMonitorsSrc) btnToggleMonitorsSrc.addEventListener("click", handleToggleMonitors);
        if (btnToggleMonitorsPrg) btnToggleMonitorsPrg.addEventListener("click", handleToggleMonitors);

        const btnToggleTimelinePos = document.getElementById("btn-toggle-timeline-position");
        if (btnToggleTimelinePos) {
            btnToggleTimelinePos.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleTimelinePosition();
            });
        }

        const chkTimelineBottomFull = document.getElementById("chk-timeline-bottom-full");
        if (chkTimelineBottomFull) {
            chkTimelineBottomFull.addEventListener("change", (e) => {
                this.setTimelinePosition(e.target.checked ? "bottom-full" : "center");
            });
        }

        // Aplica o layout inicial salvo
        this.setTimelinePosition(this.timelinePosition, true);
        this.setMonitorsLayout(this.monitorsLayout, true);

        // Inicializa os divisores de tela ajustáveis (Splitters)
        this.reinitSplitters();

        this.initMaximizeButtons();
        this.initSidebarObservers();

        // Expõe helpers globais no objeto window
        window.workspaceManager = this;
        window.setMonitorsLayout = (layout) => this.setMonitorsLayout(layout);
        window.setTimelinePosition = (pos) => this.setTimelinePosition(pos);
        window.toggleMonitorsLayout = () => this.toggleMonitorsLayout();
        window.toggleTimelinePosition = () => this.toggleTimelinePosition();

        // Carrega opções e restaura a workspace ativa salva
        this.updateWorkspaceSelectUI();
        const savedActiveWs = localStorage.getItem("capiau_active_workspace");
        if (savedActiveWs && selectWorkspace) {
            const hasOption = Array.from(selectWorkspace.options).some(opt => opt.value === savedActiveWs);
            if (hasOption) {
                selectWorkspace.value = savedActiveWs;
                if (savedActiveWs !== "default") {
                    setTimeout(() => this.applyWorkspace(savedActiveWs), 150);
                }
            }
        }
    }

    /**
     * Atualiza os seletores e botões de interface de acordo com o estado ativo.
     */
    updateLayoutUI() {
        const isStacked = this.monitorsLayout === "stacked";
        const isBottomFull = this.timelinePosition === "bottom-full";

        const selectMonitorsLayout = document.getElementById("select-monitors-layout");
        if (selectMonitorsLayout) {
            selectMonitorsLayout.value = this.monitorsLayout;
        }
        const iconMonitorsLayout = document.getElementById("icon-monitors-layout");
        if (iconMonitorsLayout) {
            iconMonitorsLayout.className = isStacked ? "fa-solid fa-table-columns fa-rotate-90" : "fa-solid fa-table-columns";
            iconMonitorsLayout.style.transform = isStacked ? "rotate(90deg)" : "none";
            iconMonitorsLayout.style.display = "inline-block";
        }

        const selectTimelinePosition = document.getElementById("select-timeline-position");
        if (selectTimelinePosition) {
            selectTimelinePosition.value = this.timelinePosition;
        }
        const iconTimelinePosition = document.getElementById("icon-timeline-position");
        if (iconTimelinePosition) {
            iconTimelinePosition.className = isBottomFull ? "fa-solid fa-window-maximize" : "fa-solid fa-arrows-left-right-to-line";
        }

        const chkTimelineBottomFull = document.getElementById("chk-timeline-bottom-full");
        if (chkTimelineBottomFull) {
            chkTimelineBottomFull.checked = isBottomFull;
        }

        const btnToggleTimelinePos = document.getElementById("btn-toggle-timeline-position");
        if (btnToggleTimelinePos) {
            btnToggleTimelinePos.innerHTML = isBottomFull ? `<i class="fa-solid fa-arrows-left-right-to-line"></i>` : `<i class="fa-solid fa-window-maximize"></i>`;
            btnToggleTimelinePos.title = isBottomFull ? "Mover Timeline para entre os Menus" : "Mover Timeline para a Faixa de Baixo (Largura Total)";
            btnToggleTimelinePos.setAttribute("data-tooltip", btnToggleTimelinePos.title);
        }

        const btnToggleMonitorsSrc = document.getElementById("btn-toggle-monitors-layout-source");
        const btnToggleMonitorsPrg = document.getElementById("btn-toggle-monitors-layout-program");
        const monitorsIconHtml = isStacked 
            ? `<i class="fa-solid fa-table-columns"></i>` 
            : `<i class="fa-solid fa-table-columns fa-rotate-90" style="transform: rotate(90deg); display: inline-block;"></i>`;
        const monitorsTooltip = isStacked 
            ? "Disposição dos Monitores: Lado a Lado" 
            : "Disposição dos Monitores: Empilhados (1 acima / 1 abaixo)";

        if (btnToggleMonitorsSrc) {
            btnToggleMonitorsSrc.innerHTML = monitorsIconHtml;
            btnToggleMonitorsSrc.title = monitorsTooltip;
            btnToggleMonitorsSrc.setAttribute("data-tooltip", monitorsTooltip);
        }
        if (btnToggleMonitorsPrg) {
            btnToggleMonitorsPrg.innerHTML = monitorsIconHtml;
            btnToggleMonitorsPrg.title = monitorsTooltip;
            btnToggleMonitorsPrg.setAttribute("data-tooltip", monitorsTooltip);
        }

        const btnMaxLib = document.getElementById("btn-maximize-library");
        if (btnMaxLib) {
            btnMaxLib.innerHTML = (isBottomFull && isStacked)
                ? `<i class="fa-solid fa-compress"></i>`
                : `<i class="fa-solid fa-expand"></i>`;
            btnMaxLib.title = (isBottomFull && isStacked) ? "Sair do Layout Estúdio" : "Layout Estúdio (biblioteca + players + timeline)";
        }
    }

    /**
     * Altera a disposição dos monitores (Source e Program).
     * @param {"side-by-side" | "stacked"} layout 
     * @param {boolean} [skipSplitterReinit=false]
     */
    setMonitorsLayout(layout, skipSplitterReinit = false) {
        if (layout !== "side-by-side" && layout !== "stacked") return;
        this.monitorsLayout = layout;
        localStorage.setItem("capiau_monitors_layout", layout);

        const monitorsContainer = document.querySelector(".monitors-container");
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");

        if (layout === "stacked") {
            document.body.classList.add("layout-monitors-stacked");
            document.body.classList.remove("layout-monitors-side-by-side");
            if (monitorsContainer) {
                monitorsContainer.classList.add("stacked");
                monitorsContainer.classList.remove("side-by-side");
            }
            if (this.timelinePosition === "bottom-full") {
                document.body.classList.add("studio");
            }
            if (sourcePanel) sourcePanel.style.width = "100%";
            if (programPanel) programPanel.style.width = "100%";
        } else {
            document.body.classList.remove("layout-monitors-stacked");
            document.body.classList.add("layout-monitors-side-by-side");
            if (monitorsContainer) {
                monitorsContainer.classList.remove("stacked");
                monitorsContainer.classList.add("side-by-side");
            }
            document.body.classList.remove("studio");
            if (sourcePanel) sourcePanel.style.height = "100%";
            if (programPanel) programPanel.style.height = "100%";
        }

        this.updateLayoutUI();

        if (!skipSplitterReinit) {
            this.reinitSplitters();
        }
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /**
     * Altera a posição da Timeline (entre menus laterais no centro vs faixa inferior de largura total).
     * @param {"center" | "bottom-full"} position 
     * @param {boolean} [skipSplitterReinit=false]
     */
    setTimelinePosition(position, skipSplitterReinit = false) {
        if (position !== "center" && position !== "bottom-full") return;
        this.timelinePosition = position;
        localStorage.setItem("capiau_timeline_position", position);

        const workspace = document.querySelector(".workspace");
        const sidebarLeft = document.getElementById("sidebar-left");
        const centerStage = document.querySelector(".center-stage");
        const sidebarRight = document.getElementById("sidebar-right");
        const timelinePanel = document.getElementById("timeline-panel");
        const reopenLeft = document.getElementById("reopen-left");
        const reopenRight = document.getElementById("reopen-right");
        const reopenTimeline = document.getElementById("reopen-timeline");

        if (!workspace) return;

        const isLeftPopped = !!(window.popoutWindows?.["sidebar-left"] && !window.popoutWindows["sidebar-left"].closed);
        const isRightPopped = !!(window.popoutWindows?.["sidebar-right"] && !window.popoutWindows["sidebar-right"].closed);
        const isTimelinePopped = !!(window.popoutWindows?.["timeline-panel"] && !window.popoutWindows["timeline-panel"].closed);

        if (position === "bottom-full") {
            if (!this.studioTop) {
                this.studioTop = document.createElement("div");
                this.studioTop.className = "studio-top";
            }
            // Agrupa as colunas superiores dentro de studioTop
            if (sidebarLeft && !isLeftPopped && sidebarLeft.ownerDocument === document) {
                this.studioTop.appendChild(sidebarLeft);
            }
            if (reopenLeft && reopenLeft.ownerDocument === document) this.studioTop.appendChild(reopenLeft);
            if (centerStage && centerStage.ownerDocument === document) this.studioTop.appendChild(centerStage);
            if (sidebarRight && !isRightPopped && sidebarRight.ownerDocument === document) {
                this.studioTop.appendChild(sidebarRight);
            }
            if (reopenRight && reopenRight.ownerDocument === document) this.studioTop.appendChild(reopenRight);

            // Timeline no workspace abaixo de studioTop (full-width)
            workspace.appendChild(this.studioTop);
            if (timelinePanel && !isTimelinePopped && timelinePanel.ownerDocument === document) {
                workspace.appendChild(timelinePanel);
            }
            if (reopenTimeline && reopenTimeline.ownerDocument === document) {
                workspace.appendChild(reopenTimeline);
            }

            document.body.classList.add("layout-timeline-bottom");
            if (this.monitorsLayout === "stacked") {
                document.body.classList.add("studio");
            }
        } else {
            // Timeline volta para dentro do center-stage
            if (centerStage && timelinePanel && !isTimelinePopped && timelinePanel.ownerDocument === document) {
                centerStage.appendChild(timelinePanel);
            }
            if (reopenTimeline && reopenTimeline.ownerDocument === document && centerStage) {
                centerStage.appendChild(reopenTimeline);
            }

            // Restaura ordem original no workspace
            if (sidebarLeft && !isLeftPopped && sidebarLeft.ownerDocument === document) {
                workspace.appendChild(sidebarLeft);
            }
            if (reopenLeft && reopenLeft.ownerDocument === document) workspace.appendChild(reopenLeft);
            if (centerStage && centerStage.ownerDocument === document) workspace.appendChild(centerStage);
            if (sidebarRight && !isRightPopped && sidebarRight.ownerDocument === document) {
                workspace.appendChild(sidebarRight);
            }
            if (reopenRight && reopenRight.ownerDocument === document) workspace.appendChild(reopenRight);

            if (this.studioTop && this.studioTop.parentNode) {
                this.studioTop.remove();
            }

            document.body.classList.remove("layout-timeline-bottom");
            document.body.classList.remove("studio");
        }

        this.updateLayoutUI();

        if (!skipSplitterReinit) {
            this.reinitSplitters();
        }
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /** Alterna rapidamente a disposição dos monitores */
    toggleMonitorsLayout() {
        const next = this.monitorsLayout === "stacked" ? "side-by-side" : "stacked";
        this.setMonitorsLayout(next);
        if (window.showToast) {
            window.showToast(next === "stacked" ? "Monitores: Empilhados (1 acima / 1 abaixo)" : "Monitores: Lado a Lado", "info");
        }
    }

    /** Alterna rapidamente a posição da timeline */
    toggleTimelinePosition() {
        const next = this.timelinePosition === "bottom-full" ? "center" : "bottom-full";
        this.setTimelinePosition(next);
        if (window.showToast) {
            window.showToast(next === "bottom-full" ? "Timeline: Na faixa de baixo (Largura total)" : "Timeline: Entre os menus laterais", "info");
        }
    }

    /** Remove todos os divisores da árvore do workspace. */
    removeAllSplitters() {
        document
            .querySelectorAll(".workspace .panel-splitter, .workspace .panel-splitter-v, .timeline-canvas-wrapper .panel-splitter")
            .forEach(s => s.remove());
    }

    /**
     * (Re)inicializa todos os divisores de tela de acordo com a combinação ativa
     * de (timelinePosition, monitorsLayout).
     */
    reinitSplitters() {
        this.removeAllSplitters();

        const isBottomFull = this.timelinePosition === "bottom-full";
        const isStacked = this.monitorsLayout === "stacked";
        const workspace = document.querySelector(".workspace");
        const centerStage = document.querySelector(".center-stage");
        const monitorsContainer = document.querySelector(".monitors-container");
        const timelineWrapper = document.querySelector(".timeline-canvas-wrapper");
        const topContainer = isBottomFull ? this.studioTop : workspace;

        if (topContainer) {
            // 1. Sidebar Esquerda <-> Center Stage
            SplitterHelper.initSplitter(topContainer, "#sidebar-left", ".center-stage", {
                direction: "horizontal",
                resizeTarget: "left",
                unit: isBottomFull ? "%" : "px",
                minVal: isBottomFull ? 25 : 200,
                maxVal: isBottomFull ? 90 : 1000,
                defaultVal: isBottomFull ? 60 : 350,
                className: isBottomFull ? "splitter-studio-lib" : "splitter-sidebar-left"
            });

            // 2. Center Stage <-> Sidebar Direita
            SplitterHelper.initSplitter(topContainer, ".center-stage", "#sidebar-right", {
                direction: "horizontal",
                resizeTarget: "right",
                unit: "px",
                minVal: 220,
                maxVal: 1000,
                defaultVal: 320,
                className: isBottomFull ? "splitter-studio-right" : "splitter-sidebar-right"
            });
        }

        if (isBottomFull) {
            if (workspace) {
                // Linha superior <-> Timeline full-width
                SplitterHelper.initSplitter(workspace, ".studio-top", "#timeline-panel", {
                    direction: "vertical",
                    resizeTarget: "right",
                    unit: "px",
                    minVal: 150,
                    maxVal: 700,
                    defaultVal: 300,
                    className: "splitter-studio-timeline"
                });
            }
        } else {
            if (centerStage) {
                // Monitors Container <-> Timeline Panel no center-stage
                SplitterHelper.initSplitter(centerStage, ".monitors-container", "#timeline-panel", {
                    direction: "vertical",
                    resizeTarget: "right",
                    unit: "px",
                    minVal: 150,
                    maxVal: 600,
                    defaultVal: 290,
                    className: "splitter-timeline"
                });
            }
        }

        if (monitorsContainer) {
            if (isStacked) {
                // Source (topo) <-> Program (base)
                SplitterHelper.initSplitter(monitorsContainer, "#source-player-panel", "#program-player-panel", {
                    direction: "vertical",
                    resizeTarget: "left",
                    unit: "%",
                    minVal: 20,
                    maxVal: 80,
                    defaultVal: 50,
                    className: "splitter-studio-players"
                });
            } else {
                // Source (esquerda) <-> Program (direita)
                SplitterHelper.initSplitter(monitorsContainer, "#source-player-panel", "#program-player-panel", {
                    direction: "horizontal",
                    resizeTarget: "left",
                    unit: "%",
                    minVal: 20,
                    maxVal: 80,
                    defaultVal: 50,
                    className: "splitter-players"
                });
            }
        }

        if (timelineWrapper) {
            // Cabeçalho de Trilhas <-> Canvas da Timeline
            SplitterHelper.initSplitter(timelineWrapper, "#timeline-headers-sidebar", ".timeline-canvas-container", {
                direction: "horizontal",
                resizeTarget: "left",
                unit: "px",
                minVal: 150,
                maxVal: 380,
                defaultVal: 180,
                className: "splitter-timeline-headers"
            });
        }
    }

    /** Legado para compatibilidade */
    initDefaultSplitters() {
        this.reinitSplitters();
    }

    /** Legado para compatibilidade */
    initStudioSplitters() {
        this.reinitSplitters();
    }

    /**
     * Alterna o layout ESTÚDIO legado (combinação de timeline na faixa de baixo + monitores empilhados).
     */
    applyStudio(on) {
        this.setTimelinePosition(on ? "bottom-full" : "center", true);
        this.setMonitorsLayout(on ? "stacked" : "side-by-side", true);
        this.reinitSplitters();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    getCustomWorkspaces() {
        try {
            const data = localStorage.getItem("capiau_custom_workspaces");
            return data ? JSON.parse(data) : {};
        } catch (err) {
            console.error("[WorkspaceManager] Erro ao ler capiau_custom_workspaces:", err);
            return {};
        }
    }

    saveCustomWorkspacesDict(dict) {
        try {
            localStorage.setItem("capiau_custom_workspaces", JSON.stringify(dict));
        } catch (err) {
            console.error("[WorkspaceManager] Erro ao gravar capiau_custom_workspaces:", err);
        }
    }

    updateWorkspaceSelectUI() {
        const selectWorkspace = document.getElementById("select-workspace");
        const optgroupCustom = document.getElementById("optgroup-custom-workspaces");
        if (!selectWorkspace) return;

        const customWorkspaces = this.getCustomWorkspaces();

        if (optgroupCustom) {
            optgroupCustom.innerHTML = "";
            const keys = Object.keys(customWorkspaces);
            if (keys.length === 0) {
                optgroupCustom.style.display = "none";
            } else {
                optgroupCustom.style.display = "";
                keys.forEach(id => {
                    const ws = customWorkspaces[id];
                    const opt = document.createElement("option");
                    opt.value = id;
                    opt.textContent = `Workspace: ${ws.name}`;
                    optgroupCustom.appendChild(opt);
                });
            }
        }

        const currentVal = selectWorkspace.value;
        const btnRename = document.getElementById("btn-rename-workspace");
        const btnDelete = document.getElementById("btn-delete-workspace");

        if (currentVal && customWorkspaces[currentVal]) {
            if (btnRename) btnRename.style.display = "inline-flex";
            if (btnDelete) btnDelete.style.display = "inline-flex";
        } else {
            if (btnRename) btnRename.style.display = "none";
            if (btnDelete) btnDelete.style.display = "none";
        }
    }

    captureCurrentState() {
        const isStudio = document.body.classList.contains("studio");
        const monitorsLayout = this.monitorsLayout || (isStudio ? "stacked" : "side-by-side");
        const timelinePosition = this.timelinePosition || (isStudio ? "bottom-full" : "center");

        const sidebarLeft = document.getElementById("sidebar-left");
        const sidebarRight = document.getElementById("sidebar-right");
        const timelinePanel = document.getElementById("timeline-panel");
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");
        const appContainer = document.querySelector(".app-container");
        const timelineActions = document.getElementById("timeline-actions-sidebar");
        const timelineHeaders = document.getElementById("timeline-headers-sidebar");

        const getDim = (key) => localStorage.getItem(key) || null;

        // Capturar dados da timeline e pistas
        let timelineData = null;
        if (window.TIMELINE_STATE) {
            const ts = window.TIMELINE_STATE;
            timelineData = {
                zoom: ts.zoom,
                trackHeightScale: ts.trackHeightScale,
                previewZoom: ts.previewZoom,
                previewPanX: ts.previewPanX,
                previewPanY: ts.previewPanY,
                hoverPreviewEnabled: ts.hoverPreviewEnabled,
                globalThumbnailsInterval: ts.globalThumbnailsInterval,
                muteHiddenTracksPlayback: ts.muteHiddenTracksPlayback,
                toolbarIsTop: localStorage.getItem("capiau_timeline_toolbar_top") === "true",
                toolbarCols: timelineActions ? (timelineActions.classList.contains("cols-2") ? "cols-2" : "cols-1") : "cols-1",
                tracks: (ts.tracks || []).map(t => ({
                    id: t.id,
                    heightPx: t.heightPx != null ? Number(t.heightPx) : null,
                    hidden: !!t.hidden
                }))
            };
        }

        // Capturar ordenação e visibilidade customizada de abas das sidebars
        const tabsCustomization = {
            leftOrder: localStorage.getItem("left-tabs-order"),
            leftVisibility: localStorage.getItem("left-tabs-visibility"),
            rightOrder: localStorage.getItem("right-tabs-order"),
            rightVisibility: localStorage.getItem("right-tabs-visibility")
        };

        return {
            isStudio: isStudio,
            monitorsLayout: monitorsLayout,
            timelinePosition: timelinePosition,
            splitters: {
                "layout-dim-splitter-sidebar-left": getDim("layout-dim-splitter-sidebar-left"),
                "layout-dim-splitter-sidebar-right": getDim("layout-dim-splitter-sidebar-right"),
                "layout-dim-splitter-timeline": getDim("layout-dim-splitter-timeline"),
                "layout-dim-splitter-players": getDim("layout-dim-splitter-players"),
                "layout-dim-splitter-studio-lib": getDim("layout-dim-splitter-studio-lib"),
                "layout-dim-splitter-studio-right": getDim("layout-dim-splitter-studio-right"),
                "layout-dim-splitter-studio-timeline": getDim("layout-dim-splitter-studio-timeline"),
                "layout-dim-splitter-studio-players": getDim("layout-dim-splitter-studio-players"),
                "layout-dim-splitter-timeline-headers": getDim("layout-dim-splitter-timeline-headers")
            },
            collapsed: {
                sidebarLeft: sidebarLeft ? sidebarLeft.classList.contains("collapsed") : false,
                sidebarRight: sidebarRight ? sidebarRight.classList.contains("collapsed") : false,
                timelinePanel: timelinePanel ? timelinePanel.classList.contains("collapsed") : false,
                header: appContainer ? appContainer.classList.contains("header-collapsed") : false,
                timelineToolbar: timelineActions ? timelineActions.classList.contains("collapsed") : false,
                timelineHeaders: timelineHeaders ? timelineHeaders.classList.contains("collapsed") : false,
                libraryFilters: sidebarLeft ? sidebarLeft.classList.contains("filters-collapsed") : false
            },
            maximized: {
                sourcePlayer: sourcePanel ? sourcePanel.classList.contains("maximized") : false,
                programPlayer: programPanel ? programPanel.classList.contains("maximized") : false,
                sidebarRight: sidebarRight ? sidebarRight.classList.contains("sidebar-maximized") : false
            },
            tabs: {
                activeLeftTab: sidebarLeft ? (sidebarLeft.getAttribute("data-active-tab") || localStorage.getItem("active-left-tab")) : null,
                activeRightTab: (typeof STATE !== "undefined" && STATE.currentRightTab) ? STATE.currentRightTab : localStorage.getItem("active-right-tab")
            },
            timelineData: timelineData,
            tabsCustomization: tabsCustomization
        };
    }

    openSaveWorkspaceModal() {
        const modal = document.getElementById("save-workspace-modal");
        const selectOverwrite = document.getElementById("modal-select-overwrite");
        const overwriteContainer = document.getElementById("modal-overwrite-container");
        const overwriteDivider = document.getElementById("modal-overwrite-divider");
        const inputNewName = document.getElementById("modal-input-new-ws-name");

        if (!modal) return;

        const customWorkspaces = this.getCustomWorkspaces();
        const keys = Object.keys(customWorkspaces);

        if (selectOverwrite) {
            selectOverwrite.innerHTML = "";
            if (keys.length > 0) {
                if (overwriteContainer) overwriteContainer.style.display = "flex";
                if (overwriteDivider) overwriteDivider.style.display = "flex";

                const currentVal = document.getElementById("select-workspace")?.value;
                keys.forEach(id => {
                    const ws = customWorkspaces[id];
                    const opt = document.createElement("option");
                    opt.value = id;
                    opt.textContent = `Workspace: ${ws.name}`;
                    if (id === currentVal) opt.selected = true;
                    selectOverwrite.appendChild(opt);
                });
            } else {
                if (overwriteContainer) overwriteContainer.style.display = "none";
                if (overwriteDivider) overwriteDivider.style.display = "none";
            }
        }

        if (inputNewName) inputNewName.value = "";
        modal.style.display = "flex";
        if (inputNewName) inputNewName.focus();
    }

    closeSaveWorkspaceModal() {
        const modal = document.getElementById("save-workspace-modal");
        if (modal) modal.style.display = "none";
    }

    promptSaveWorkspace() {
        this.openSaveWorkspaceModal();
    }

    saveCustomWorkspace(name, wsId) {
        if (!name || !wsId) return;
        const customWorkspaces = this.getCustomWorkspaces();
        const capturedState = this.captureCurrentState();

        customWorkspaces[wsId] = {
            id: wsId,
            name: name,
            created: customWorkspaces[wsId]?.created || Date.now(),
            updated: Date.now(),
            ...capturedState
        };

        this.saveCustomWorkspacesDict(customWorkspaces);
        this.updateWorkspaceSelectUI();

        const selectWorkspace = document.getElementById("select-workspace");
        if (selectWorkspace) {
            selectWorkspace.value = wsId;
        }
        localStorage.setItem("capiau_active_workspace", wsId);
        this.updateWorkspaceSelectUI();

        if (window.showToast) {
            window.showToast(`Workspace "${name}" salva com sucesso!`, "success");
        } else {
            alert(`Workspace "${name}" salva com sucesso!`);
        }
    }

    renameCustomWorkspace(wsId) {
        const customWorkspaces = this.getCustomWorkspaces();
        if (!customWorkspaces[wsId]) return;

        const oldName = customWorkspaces[wsId].name;
        const newName = prompt("Digite o novo nome para esta workspace customizada:", oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
            customWorkspaces[wsId].name = newName.trim();
            customWorkspaces[wsId].updated = Date.now();
            this.saveCustomWorkspacesDict(customWorkspaces);
            this.updateWorkspaceSelectUI();

            const selectWorkspace = document.getElementById("select-workspace");
            if (selectWorkspace) {
                selectWorkspace.value = wsId;
            }
            if (window.showToast) {
                window.showToast(`Workspace renomeada para "${newName.trim()}"!`, "success");
            }
        }
    }

    deleteCustomWorkspace(wsId) {
        const customWorkspaces = this.getCustomWorkspaces();
        if (!customWorkspaces[wsId]) return;

        const name = customWorkspaces[wsId].name;
        if (confirm(`Deseja realmente excluir a workspace customizada "${name}"?`)) {
            delete customWorkspaces[wsId];
            this.saveCustomWorkspacesDict(customWorkspaces);
            this.applyWorkspace("default");

            if (window.showToast) {
                window.showToast(`Workspace "${name}" excluída.`, "success");
            }
        }
    }

    applyWorkspace(ws) {
        console.log(`[WorkspaceManager] Aplicando Workspace Preset: ${ws}`);

        const customWorkspaces = this.getCustomWorkspaces();
        const customConfig = customWorkspaces[ws];

        if (customConfig) {
            // Preset Customizado
            const wantMonitorsLayout = customConfig.monitorsLayout || (customConfig.isStudio ? "stacked" : "side-by-side");
            const wantTimelinePosition = customConfig.timelinePosition || (customConfig.isStudio ? "bottom-full" : "center");
            this.setTimelinePosition(wantTimelinePosition, true);
            this.setMonitorsLayout(wantMonitorsLayout, true);

            // Restaura dimensões gravadas nos Splitters
            if (customConfig.splitters) {
                for (const key in customConfig.splitters) {
                    const val = customConfig.splitters[key];
                    if (val !== null && val !== undefined) {
                        localStorage.setItem(key, val);
                    }
                }
            }

            // Aplica dimensões inline e flex
            const sidebarLeft = document.getElementById("sidebar-left");
            const sidebarRight = document.getElementById("sidebar-right");
            const timelinePanel = document.getElementById("timeline-panel");
            const sourcePanel = document.getElementById("source-player-panel");

            if (sidebarLeft && customConfig.splitters["layout-dim-splitter-sidebar-left"]) {
                const val = customConfig.splitters["layout-dim-splitter-sidebar-left"];
                const valStr = typeof val === "number" ? `${val}px` : String(val);
                sidebarLeft.style.width = valStr;
                sidebarLeft.style.flex = `0 0 ${valStr}`;
            }
            if (sidebarRight && customConfig.splitters["layout-dim-splitter-sidebar-right"]) {
                const val = customConfig.splitters["layout-dim-splitter-sidebar-right"];
                const valStr = typeof val === "number" ? `${val}px` : String(val);
                sidebarRight.style.width = valStr;
                sidebarRight.style.flex = `0 0 ${valStr}`;
            }
            if (timelinePanel && customConfig.splitters["layout-dim-splitter-timeline"]) {
                const val = customConfig.splitters["layout-dim-splitter-timeline"];
                const valStr = typeof val === "number" ? `${val}px` : String(val);
                timelinePanel.style.height = valStr;
                timelinePanel.style.flex = `0 0 ${valStr}`;
            }
            if (sourcePanel && customConfig.splitters["layout-dim-splitter-players"]) {
                const val = customConfig.splitters["layout-dim-splitter-players"];
                const valStr = typeof val === "number" ? `${val}%` : String(val);
                sourcePanel.style.flex = `0 0 ${valStr}`;
            }
            const timelineHeadersSidebar = document.getElementById("timeline-headers-sidebar");
            if (timelineHeadersSidebar && customConfig.splitters["layout-dim-splitter-timeline-headers"]) {
                const val = customConfig.splitters["layout-dim-splitter-timeline-headers"];
                const valStr = typeof val === "number" ? `${val}px` : String(val);
                timelineHeadersSidebar.style.width = valStr;
                timelineHeadersSidebar.style.flex = `0 0 ${valStr}`;
            }

            // Re-inicializa divisores para escutar os tamanhos atualizados
            this.reinitSplitters();

            // Restaura colapso/expansão de painéis
            if (customConfig.collapsed) {
                const c = customConfig.collapsed;

                const toggleLeft = document.getElementById("toggle-left");
                const reopenLeft = document.getElementById("reopen-left");
                if (sidebarLeft && reopenLeft) {
                    const isCollapsed = sidebarLeft.classList.contains("collapsed");
                    if (c.sidebarLeft && !isCollapsed) {
                        if (toggleLeft) toggleLeft.click(); else sidebarLeft.classList.add("collapsed");
                    } else if (!c.sidebarLeft && isCollapsed) {
                        if (reopenLeft) reopenLeft.click(); else sidebarLeft.classList.remove("collapsed");
                    }
                }

                const toggleRight = document.getElementById("toggle-right");
                const reopenRight = document.getElementById("reopen-right");
                if (sidebarRight && reopenRight) {
                    const isCollapsed = sidebarRight.classList.contains("collapsed");
                    if (c.sidebarRight && !isCollapsed) {
                        if (toggleRight) toggleRight.click(); else sidebarRight.classList.add("collapsed");
                    } else if (!c.sidebarRight && isCollapsed) {
                        if (reopenRight) reopenRight.click(); else sidebarRight.classList.remove("collapsed");
                    }
                }

                const toggleTimeline = document.getElementById("toggle-timeline");
                const reopenTimeline = document.getElementById("reopen-timeline");
                if (timelinePanel && reopenTimeline) {
                    const isCollapsed = timelinePanel.classList.contains("collapsed");
                    if (c.timelinePanel && !isCollapsed) {
                        if (toggleTimeline) toggleTimeline.click(); else timelinePanel.classList.add("collapsed");
                    } else if (!c.timelinePanel && isCollapsed) {
                        if (reopenTimeline) reopenTimeline.click(); else timelinePanel.classList.remove("collapsed");
                    }
                }

                const appContainer = document.querySelector(".app-container");
                const btnCollapseHeader = document.getElementById("btn-collapse-header");
                const headerRestoreTrigger = document.getElementById("header-restore-trigger");
                if (appContainer && headerRestoreTrigger) {
                    const isCollapsed = appContainer.classList.contains("header-collapsed");
                    if (c.header && !isCollapsed) {
                        if (btnCollapseHeader) btnCollapseHeader.click(); else appContainer.classList.add("header-collapsed");
                    } else if (!c.header && isCollapsed) {
                        if (headerRestoreTrigger) headerRestoreTrigger.click(); else appContainer.classList.remove("header-collapsed");
                    }
                }

                const timelineActions = document.getElementById("timeline-actions-sidebar");
                const btnToggleToolbar = document.getElementById("btn-toggle-toolbar");
                const reopenToolbar = document.getElementById("reopen-toolbar");
                if (timelineActions && reopenToolbar) {
                    const isCollapsed = timelineActions.classList.contains("collapsed");
                    if (c.timelineToolbar && !isCollapsed) {
                        if (btnToggleToolbar) btnToggleToolbar.click(); else timelineActions.classList.add("collapsed");
                    } else if (!c.timelineToolbar && isCollapsed) {
                        if (reopenToolbar) reopenToolbar.click(); else timelineActions.classList.remove("collapsed");
                    }
                }

                const timelineHeaders = document.getElementById("timeline-headers-sidebar");
                const btnToggleHeaders = document.getElementById("btn-toggle-headers");
                const reopenHeaders = document.getElementById("reopen-headers");
                if (timelineHeaders && reopenHeaders) {
                    const isCollapsed = timelineHeaders.classList.contains("collapsed");
                    if (c.timelineHeaders && !isCollapsed) {
                        if (btnToggleHeaders) btnToggleHeaders.click(); else timelineHeaders.classList.add("collapsed");
                    } else if (!c.timelineHeaders && isCollapsed) {
                        if (reopenHeaders) reopenHeaders.click(); else timelineHeaders.classList.remove("collapsed");
                    }
                }
            }

            // Restaura maximizações
            if (customConfig.maximized) {
                const m = customConfig.maximized;
                const btnExpandSource = document.getElementById("btn-expand-source");
                if (sourcePanel && btnExpandSource) {
                    const isMax = sourcePanel.classList.contains("maximized");
                    if (m.sourcePlayer !== isMax) btnExpandSource.click();
                }

                const btnExpandProgram = document.getElementById("btn-expand-program");
                const programPanel = document.getElementById("program-player-panel");
                if (programPanel && btnExpandProgram) {
                    const isMax = programPanel.classList.contains("maximized");
                    if (m.programPlayer !== isMax) btnExpandProgram.click();
                }

                const btnMaxRight = document.getElementById("btn-maximize-right");
                if (sidebarRight && btnMaxRight) {
                    const isMax = sidebarRight.classList.contains("sidebar-maximized");
                    if (m.sidebarRight !== isMax) btnMaxRight.click();
                }
            }

            // Restaura abas ativas
            if (customConfig.tabs) {
                if (customConfig.tabs.activeLeftTab) {
                    const btnLeft = document.querySelector(`.sidebar-left .tab-btn[data-tab="${customConfig.tabs.activeLeftTab}"]`);
                    if (btnLeft) btnLeft.click();
                }
                if (customConfig.tabs.activeRightTab) {
                    const btnRight = document.querySelector(`#right-tabs .tab-btn[data-right-tab="${customConfig.tabs.activeRightTab}"]`);
                    if (btnRight) btnRight.click();
                }
            }

            // Restaura estado e alturas das pistas da timeline
            if (customConfig.timelineData && window.TIMELINE_STATE) {
                const td = customConfig.timelineData;
                const ts = window.TIMELINE_STATE;

                if (td.zoom !== undefined) ts.zoom = td.zoom;
                if (td.previewZoom !== undefined) {
                    ts.previewZoom = td.previewZoom;
                    ts.previewPanX = td.previewPanX || 0;
                    ts.previewPanY = td.previewPanY || 0;
                    const pZoomSelect = document.getElementById("program-preview-zoom");
                    if (pZoomSelect) pZoomSelect.value = String(td.previewZoom);
                }
                if (td.trackHeightScale !== undefined) {
                    ts.setTrackHeightScale(td.trackHeightScale);
                }
                if (td.hoverPreviewEnabled !== undefined) {
                    ts.toggleHoverPreview(td.hoverPreviewEnabled);
                    const chkHover = document.getElementById("chk-timeline-hover-preview");
                    if (chkHover) chkHover.checked = !!td.hoverPreviewEnabled;
                }
                if (td.globalThumbnailsInterval !== undefined) {
                    ts.setGlobalThumbnailsInterval(td.globalThumbnailsInterval);
                    const selDensity = document.getElementById("select-timeline-thumbs-density");
                    if (selDensity) selDensity.value = String(td.globalThumbnailsInterval);
                }
                if (td.muteHiddenTracksPlayback !== undefined) {
                    ts.setMuteHiddenTracksPlayback(td.muteHiddenTracksPlayback);
                    const chkMute = document.getElementById("chk-timeline-mute-hidden");
                    if (chkMute) chkMute.checked = !!td.muteHiddenTracksPlayback;
                }
                if (td.toolbarIsTop !== undefined) {
                    localStorage.setItem("capiau_timeline_toolbar_top", String(td.toolbarIsTop));
                    const chkTop = document.getElementById("chk-timeline-toolbar-top");
                    if (chkTop) chkTop.checked = td.toolbarIsTop;
                    if (typeof window.setTimelineToolbarPosition === "function") {
                        window.setTimelineToolbarPosition(td.toolbarIsTop);
                    }
                }
                if (td.toolbarCols !== undefined) {
                    const timelineActions = document.getElementById("timeline-actions-sidebar");
                    if (timelineActions) {
                        timelineActions.classList.remove("cols-1", "cols-2");
                        timelineActions.classList.add(td.toolbarCols);
                    }
                }
                if (Array.isArray(td.tracks) && Array.isArray(ts.tracks)) {
                    td.tracks.forEach(savedTrack => {
                        const track = ts.tracks.find(t => String(t.id) === String(savedTrack.id));
                        if (track) {
                            if (savedTrack.heightPx !== undefined) track.heightPx = savedTrack.heightPx;
                            if (savedTrack.hidden !== undefined) track.hidden = savedTrack.hidden;
                        }
                    });
                    if (typeof STATE !== "undefined") {
                        STATE.emit("timelineTracksChanged", ts.tracks);
                    }
                }
            }

            // Restaura customizações de abas (ordem e visibilidade)
            if (customConfig.tabsCustomization) {
                const tc = customConfig.tabsCustomization;
                if (tc.leftOrder) localStorage.setItem("left-tabs-order", tc.leftOrder);
                if (tc.leftVisibility) localStorage.setItem("left-tabs-visibility", tc.leftVisibility);
                if (tc.rightOrder) localStorage.setItem("right-tabs-order", tc.rightOrder);
                if (tc.rightVisibility) localStorage.setItem("right-tabs-visibility", tc.rightVisibility);
                
                if (typeof window.initTabsCustomization === "function") {
                    window.initTabsCustomization();
                }
            }
        } else {
            // Presets Nativos / Estáticos
            if (ws === "montagem") {
                const left = document.getElementById("sidebar-left");
                if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left")?.click();
                const right = document.getElementById("sidebar-right");
                if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right")?.click();
                const timeline = document.getElementById("timeline-panel");
                if (timeline && timeline.classList.contains("collapsed")) {
                    const reopen = document.getElementById("reopen-timeline");
                    if (reopen) reopen.click();
                }
                this.setTimelinePosition("bottom-full", true);
                this.setMonitorsLayout("stacked", true);
                this.reinitSplitters();
            }
            else if (ws === "default") {
                const left = document.getElementById("sidebar-left");
                const right = document.getElementById("sidebar-right");
                if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left")?.click();
                if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right")?.click();
                
                const sourcePanel = document.getElementById("source-player-panel");
                if (sourcePanel && sourcePanel.classList.contains("maximized")) {
                    document.getElementById("btn-expand-source")?.click();
                }
                const programPanel = document.getElementById("program-player-panel");
                if (programPanel && programPanel.classList.contains("maximized")) {
                    document.getElementById("btn-expand-program")?.click();
                }
                this.setTimelinePosition("center", true);
                this.setMonitorsLayout("side-by-side", true);
                this.reinitSplitters();
            } 
            else if (ws === "decupagem") {
                const sourcePanel = document.getElementById("source-player-panel");
                if (sourcePanel && !sourcePanel.classList.contains("maximized")) {
                    document.getElementById("btn-expand-source")?.click();
                }
                const left = document.getElementById("sidebar-left");
                if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left")?.click();
                const right = document.getElementById("sidebar-right");
                if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right")?.click();
                this.setTimelinePosition("center", true);
                this.setMonitorsLayout("side-by-side", true);
                this.reinitSplitters();
            }
            else if (ws === "multitela") {
                alert("Workspace Multi-Tela: O sistema irá destacar a Linha do Tempo e o Player de Programa. Por favor, confirme a abertura das novas janelas e arraste-as para o segundo monitor físico.");
                setTimeout(() => this.togglePopout("timeline-panel"), 100);
                setTimeout(() => this.togglePopout("program-player-panel"), 500);
            }
        }

        // Armazena a workspace ativa e atualiza a UI
        localStorage.setItem("capiau_active_workspace", ws);
        this.updateWorkspaceSelectUI();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    togglePopout(panelId) {
        if (window.popoutWindows[panelId] && !window.popoutWindows[panelId].closed) {
            // Se já está aberto, fecha o popout (restaurando localmente)
            try {
                window.popoutWindows[panelId].close();
            } catch (e) {}
            this.restorePanel(panelId);
        } else {
            const winName = getPopoutWindowName(panelId);
            
            // Lê dimensões e coordenadas salvas no localStorage
            let width = panelId.includes("player") ? 640 : 800;
            let height = panelId.includes("player") ? 480 : 600;
            let left = null;
            let top = null;
            
            try {
                const rawBounds = localStorage.getItem(`capiau_popout_bounds_${panelId}`);
                if (rawBounds) {
                    const b = JSON.parse(rawBounds);
                    if (b && typeof b === "object") {
                        const w = b.outerWidth || b.width;
                        const h = b.outerHeight || b.height;
                        if (w > 150 && h > 150) {
                            width = w;
                            height = h;
                        }
                        const x = b.screenX !== undefined ? b.screenX : b.left;
                        const y = b.screenY !== undefined ? b.screenY : b.top;
                        if (x !== undefined && y !== undefined && !isNaN(x) && !isNaN(y)) {
                            left = x;
                            top = y;
                        }
                    }
                }
            } catch (e) {
                console.warn("[WorkspaceManager] Erro ao ler bounds salvos:", e);
            }
            
            let features = `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
            if (left !== null && top !== null) {
                features += `,left=${left},top=${top},screenX=${left},screenY=${top}`;
            }
            
            const popup = window.open(
                `panel.html?panel=${panelId}`,
                winName,
                features
            );
            
            if (popup) {
                window.popoutWindows[panelId] = popup;
                localStorage.setItem(`capiau_popout_active_${panelId}`, "true");
            } else {
                alert("Bloqueador de popups detectado! Por favor, autorize popups para este site para poder destacar painéis em outros monitores.");
            }
        }
    }

    registerPopout(panelId, win) {
        if (!win || win.closed) return;
        window.popoutWindows[panelId] = win;
        this.attachPanelToPopout(panelId, win);
    }

    handleMessage(e) {
        const data = e.data;
        if (!data || !data.type) return;
        
        if (data.type === "POPOUT_READY") {
            const panelId = data.panel;
            console.log(`[WorkspaceManager] Pop-out sinalizado: ${panelId}`);
            
            const win = window.popoutWindows[panelId];
            if (win && !win.closed) {
                this.attachPanelToPopout(panelId, win);
            }
        }
        else if (data.type === "POPOUT_CLOSED") {
            this.restorePanel(data.panel);
        }
    }

    attachPanelToPopout(panelId, win) {
        if (!win || win.closed || !win.document) return;
        
        const localPanel = document.getElementById(panelId) || this.poppedElements[panelId];
        if (!localPanel) {
            console.warn(`[WorkspaceManager] Painel '${panelId}' não encontrado para anexação.`);
            return;
        }

        // Se o elemento ainda está no DOM do documento principal, armazena seus nós pais de origem
        if (localPanel.ownerDocument === document) {
            this.poppedElements[panelId] = localPanel;
            this.originalParents[panelId] = localPanel.parentNode;
            this.originalNextSiblings[panelId] = localPanel.nextSibling;
        }

        const container = win.document.getElementById("panel-container");
        if (container) {
            // Limpa loader da janela popout e injeta o elemento
            container.innerHTML = "";
            win.document.adoptNode(localPanel);
            container.appendChild(localPanel);
            localPanel.classList.remove("popped-out-hidden");
            
            // Oculta o botão de pop-out para evitar redundância na janela destacada
            const popBtn = localPanel.querySelector('[id*="popout"]');
            if (popBtn) popBtn.style.display = "none";
        }

        localStorage.setItem(`capiau_popout_active_${panelId}`, "true");

        // Inicializa motor global de tooltips na janela destacada
        if (typeof window.initGlobalTooltips === "function") {
            window.initGlobalTooltips(win.document, win);
        }

        // Se for a biblioteca de mídias, anexa o tracker do índice de rolagem (Scroll Index) à janela destacada
        if (panelId === "sidebar-left") {
            if (window.libraryScrollIndex) {
                window.libraryScrollIndex.attachToWindow(win);
            } else if (window.libraryManager?.scrollIndexTracker) {
                window.libraryManager.scrollIndexTracker.attachToWindow(win);
            }
            if (window.libraryInstance) {
                window.libraryInstance.attachScrollListener(win.document.querySelector("#sidebar-left .sidebar-content.scrollable"));
                const activeTab = win.document.querySelector("#sidebar-left .tab-content.active")?.id || "tab-media";
                window.libraryInstance.restoreTabScrollPosition(activeTab, win.document.querySelector("#sidebar-left .sidebar-content.scrollable"));
                if (typeof window.libraryInstance.onPopoutReady === "function") {
                    window.libraryInstance.onPopoutReady(win);
                }
            } else {
                // Caso a instância da biblioteca ainda esteja inicializando (ex: no carregamento do app)
                setTimeout(() => {
                    if (window.libraryInstance) {
                        window.libraryInstance.attachScrollListener(win.document.querySelector("#sidebar-left .sidebar-content.scrollable"));
                        if (typeof window.libraryInstance.onPopoutReady === "function") {
                            window.libraryInstance.onPopoutReady(win);
                        }
                    }
                }, 100);
            }
        }

        // Escuta atalhos de teclado no popout e redireciona para o player principal
        if (!win._hasWorkspaceKeyHandler) {
            win._hasWorkspaceKeyHandler = true;
            win.addEventListener("keydown", (e) => {
                const activeTag = win.document.activeElement?.tagName?.toLowerCase();
                if (activeTag === "input" || activeTag === "textarea") return;
                
                if (window.player && typeof window.player.handleGlobalKeyboard === "function") {
                    window.player.handleGlobalKeyboard(e);
                }
            });
            win.addEventListener("keyup", (e) => {
                if (e.code === "KeyK" && window.player) {
                    window.player.isKeyKDown = false;
                }
            });
        }

        if (panelId === "timeline-panel") {
            this.syncTimelineCanvasToPopout();
        }

        try {
            this.channel.postMessage({
                type: "POPOUT_ACK",
                panel: panelId
            });
        } catch (e) {}
    }

    restorePanel(panelId) {
        console.log(`[WorkspaceManager] Restaurando painel localmente: ${panelId}`);
        const localPanel = this.poppedElements[panelId] || document.getElementById(panelId);
        const parent = this.originalParents[panelId];
        
        if (localPanel) {
            // Pausa e descarrega qualquer player de vídeo dentro do painel para evitar áudio fantasma
            try {
                const videos = localPanel.querySelectorAll("video");
                videos.forEach(v => {
                    v.pause();
                    v.src = "";
                    v.removeAttribute("src");
                    v.load();
                });
            } catch (err) {
                console.warn("[WorkspaceManager] Erro ao descarregar vídeos no restorePanel:", err);
            }

            document.adoptNode(localPanel);

            const workspace = document.querySelector(".workspace");
            const topContainer = document.querySelector(".studio-top") || workspace;

            if (panelId === "sidebar-left") {
                const centerStage = topContainer?.querySelector(".center-stage");
                if (centerStage && centerStage.parentNode === topContainer) {
                    topContainer.insertBefore(localPanel, centerStage);
                } else if (topContainer) {
                    topContainer.prepend(localPanel);
                }
            } else if (panelId === "sidebar-right") {
                if (topContainer) {
                    topContainer.appendChild(localPanel);
                }
            } else if (panelId === "timeline-panel") {
                if (this.timelinePosition === "bottom-full" && workspace) {
                    workspace.appendChild(localPanel);
                } else {
                    const centerStage = document.querySelector(".center-stage");
                    if (centerStage) centerStage.appendChild(localPanel);
                }
            } else if (panelId === "source-player-panel") {
                const monitors = document.querySelector(".monitors-container");
                const program = document.getElementById("program-player-panel");
                if (monitors && program) {
                    monitors.insertBefore(localPanel, program);
                } else if (monitors) {
                    monitors.prepend(localPanel);
                }
            } else if (panelId === "program-player-panel") {
                const monitors = document.querySelector(".monitors-container");
                if (monitors) monitors.appendChild(localPanel);
            } else if (parent) {
                const sibling = this.originalNextSiblings[panelId];
                if (sibling && sibling.parentNode === parent) {
                    parent.insertBefore(localPanel, sibling);
                } else {
                    parent.appendChild(localPanel);
                }
            }

            localPanel.classList.remove("popped-out-hidden");
            
            // Restaura a exibição do botão de pop-out
            const popBtn = localPanel.querySelector('[id*="popout"]');
            if (popBtn) popBtn.style.display = "";
        }
        
        if (window.popoutWindows[panelId]) {
            delete window.popoutWindows[panelId];
        }

        localStorage.removeItem(`capiau_popout_active_${panelId}`);

        // Se for a biblioteca de mídias, restaura o tracker do índice de rolagem para a janela principal
        if (panelId === "sidebar-left") {
            if (window.libraryScrollIndex) {
                window.libraryScrollIndex.attachToWindow(window);
            } else if (window.libraryManager?.scrollIndexTracker) {
                window.libraryManager.scrollIndexTracker.attachToWindow(window);
            }
            if (window.libraryInstance) {
                window.libraryInstance.attachScrollListener(document.querySelector("#sidebar-left .sidebar-content.scrollable"));
                const activeTab = document.querySelector("#sidebar-left .tab-content.active")?.id || "tab-media";
                window.libraryInstance.restoreTabScrollPosition(activeTab, document.querySelector("#sidebar-left .sidebar-content.scrollable"));
                if (typeof window.libraryInstance.onPopoutRestored === "function") {
                    window.libraryInstance.onPopoutRestored();
                }
            }
        }

        // Se for a timeline, restaura o canvas de volta para a janela principal
        if (panelId === "timeline-panel") {
            this.restoreTimelineCanvasLocal();
        }
    }

    syncTimelineCanvasToPopout(retries = 0) {
        const win = window.popoutWindows["timeline-panel"];
        if (!win || win.closed) return;
        
        const poppedCanvas = win.document.getElementById("timeline-canvas");
        if (poppedCanvas && window.timelineRenderer && window.timelineInteraction) {
            console.log("[WorkspaceManager] Canvas do popup encontrado, sincronizando renderer...");
            window.timelineRenderer.setCanvas(poppedCanvas);
            window.timelineInteraction.setCanvas(poppedCanvas);
        } else if (retries < 10) {
            // Retry em caso de DOM ainda não pronto
            setTimeout(() => this.syncTimelineCanvasToPopout(retries + 1), 150);
        } else {
            console.warn("[WorkspaceManager] Não foi possível encontrar timeline-canvas no popup após 10 tentativas.");
        }
    }

    restoreTimelineCanvasLocal() {
        const localCanvas = document.getElementById("timeline-canvas");
        if (localCanvas && window.timelineRenderer && window.timelineInteraction) {
            window.timelineRenderer.setCanvas(localCanvas);
            window.timelineInteraction.setCanvas(localCanvas);
        }
    }

    initMaximizeButtons() {
        const btnMaxLib = document.getElementById("btn-maximize-library");
        const sidebarLeft = document.getElementById("sidebar-left");
        if (btnMaxLib && sidebarLeft) {
            btnMaxLib.addEventListener("click", (e) => {
                e.stopPropagation();
                // Alterna o layout Estúdio (biblioteca + players empilhados + timeline full-width)
                const isStudio = this.timelinePosition === "bottom-full" && this.monitorsLayout === "stacked";
                this.applyStudio(!isStudio);
            });
        }

        const btnMaxRight = document.getElementById("btn-maximize-right");
        const sidebarRight = document.getElementById("sidebar-right");
        if (btnMaxRight && sidebarRight) {
            btnMaxRight.addEventListener("click", (e) => {
                e.stopPropagation();
                const isMax = sidebarRight.classList.toggle("sidebar-maximized");
                btnMaxRight.innerHTML = isMax 
                    ? `<i class="fa-solid fa-compress"></i>` 
                    : `<i class="fa-solid fa-expand"></i>`;
                btnMaxRight.title = isMax ? "Restaurar Painel" : "Maximizar Painel";
                
                window.dispatchEvent(new Event("resize"));
            });
        }
    }

    initSidebarObservers() {
        const sidebars = [document.getElementById("sidebar-left"), document.getElementById("sidebar-right")];
        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                const el = entry.target;
                if (!el) continue;
                const width = entry.contentRect.width;
                
                // Manter compatibilidade com classes legadas
                if (width >= 550) {
                    el.classList.add("wide-layout");
                    el.classList.remove("narrow-layout");
                } else {
                    el.classList.add("narrow-layout");
                    el.classList.remove("wide-layout");
                }

                // Layout adaptativo de 3 níveis
                if (width >= 320) {
                    el.classList.add("sidebar-normal");
                    el.classList.remove("sidebar-compact", "sidebar-minimal");
                } else if (width >= 240) {
                    el.classList.add("sidebar-compact");
                    el.classList.remove("sidebar-normal", "sidebar-minimal");
                } else {
                    el.classList.add("sidebar-minimal");
                    el.classList.remove("sidebar-normal", "sidebar-compact");
                }
            }
        });
        sidebars.forEach(s => {
            if (s) observer.observe(s);
        });
    }
}

/**
 * Utilitário para gerenciar divisores de tela arrastáveis em duas colunas.
 */
export class SplitterHelper {
    static initSplitter(container, leftSelector, rightSelector, options = {}) {
        const direction = options.direction || "horizontal"; // "horizontal" or "vertical"
        const resizeTarget = options.resizeTarget || "left"; // "left" (first) or "right" (second)
        const unit = options.unit || "%"; // "%" or "px"
        const minVal = options.minVal || (unit === "%" ? (options.minPct || 20) : 150);
        const maxVal = options.maxVal || (unit === "%" ? (options.maxPct || 80) : 800);
        let defaultVal = options.defaultVal || (unit === "%" ? (options.defaultPct || 50) : 350);
        const className = options.className || "";

        // Tenta recuperar do localStorage se aplicável
        const storageKey = className ? `layout-dim-${className.split(" ")[0]}` : null;
        if (storageKey) {
            const savedVal = localStorage.getItem(storageKey);
            if (savedVal !== null) {
                const parsed = parseFloat(savedVal);
                if (!isNaN(parsed)) {
                    defaultVal = parsed;
                }
            }
        }

        const leftEl = container.querySelector(leftSelector);
        const rightEl = container.querySelector(rightSelector);
        if (!leftEl || !rightEl) return;

        // Remove divisor com a mesma classe se já existir
        const existingClass = className ? `.${className.split(" ")[0]}` : ".panel-splitter";
        const existing = container.querySelector(existingClass);
        if (existing) existing.remove();

        // Cria o elemento divisor
        const splitter = container.ownerDocument.createElement("div");
        splitter.className = direction === "horizontal" ? "panel-splitter" : "panel-splitter-v";
        if (className) {
            splitter.classList.add(...className.split(" "));
        }

        // Insere o divisor entre as duas colunas/linhas
        leftEl.after(splitter);

        // Define tamanho inicial baseado na unidade e no alvo
        if (unit === "px") {
            const targetEl = resizeTarget === "left" ? leftEl : rightEl;
            targetEl.style.flex = `0 0 ${defaultVal}px`;
            if (direction === "horizontal") {
                targetEl.style.width = `${defaultVal}px`;
            } else {
                targetEl.style.height = `${defaultVal}px`;
            }
        } else {
            // Percentual
            leftEl.style.flex = `0 0 ${defaultVal}%`;
            rightEl.style.flex = `1 1 0%`;
        }

        let isDragging = false;

        splitter.addEventListener("mousedown", (e) => {
            e.preventDefault();
            isDragging = true;
            splitter.classList.add("active");

            // Grava coordenadas exatas dos painéis no momento do clique
            const startLeftRect = leftEl.getBoundingClientRect();
            const startRightRect = rightEl.getBoundingClientRect();
            const startContainerRect = container.getBoundingClientRect();

            // Adiciona classe de resizing ao body para desativar transições e seleções de texto temporariamente
            container.ownerDocument.body.classList.add("layout-resizing");

            // Adiciona overlay na tela para evitar interrupções de arraste
            const overlay = container.ownerDocument.createElement("div");
            overlay.className = "splitter-drag-overlay";
            overlay.style.position = "fixed";
            overlay.style.top = "0";
            overlay.style.left = "0";
            overlay.style.width = "100vw";
            overlay.style.height = "100vh";
            overlay.style.zIndex = "9999";
            overlay.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
            container.ownerDocument.body.appendChild(overlay);

            const handleMouseMove = (moveEvent) => {
                if (!isDragging) return;

                if (unit === "px") {
                    let val;
                    if (direction === "horizontal") {
                        if (resizeTarget === "left") {
                            val = moveEvent.clientX - startLeftRect.left;
                        } else {
                            val = startRightRect.right - moveEvent.clientX;
                        }
                        if (val < minVal) val = minVal;
                        if (val > maxVal) val = maxVal;
                        
                        const targetEl = resizeTarget === "left" ? leftEl : rightEl;
                        targetEl.style.width = `${val}px`;
                        targetEl.style.flex = `0 0 ${val}px`;
                    } else {
                        // vertical px
                        if (resizeTarget === "left") {
                            val = moveEvent.clientY - startLeftRect.top;
                        } else {
                            val = startRightRect.bottom - moveEvent.clientY;
                        }
                        if (val < minVal) val = minVal;
                        if (val > maxVal) val = maxVal;

                        const targetEl = resizeTarget === "left" ? leftEl : rightEl;
                        targetEl.style.height = `${val}px`;
                        targetEl.style.flex = `0 0 ${val}px`;
                    }
                } else {
                    // percentual
                    if (direction === "horizontal") {
                        const offsetX = moveEvent.clientX - startContainerRect.left;
                        let pct = (offsetX / startContainerRect.width) * 100;
                        if (pct < minVal) pct = minVal;
                        if (pct > maxVal) pct = maxVal;

                        leftEl.style.flex = `0 0 ${pct}%`;
                    } else {
                        const offsetY = moveEvent.clientY - startContainerRect.top;
                        let pct = (offsetY / startContainerRect.height) * 100;
                        if (pct < minVal) pct = minVal;
                        if (pct > maxVal) pct = maxVal;

                        leftEl.style.flex = `0 0 ${pct}%`;
                    }
                }
                
                // Força disparo de evento resize no window e container
                container.dispatchEvent(new Event("resize"));
                window.dispatchEvent(new Event("resize"));
            };

            const handleMouseUp = () => {
                isDragging = false;
                splitter.classList.remove("active");
                container.ownerDocument.body.classList.remove("layout-resizing");
                overlay.remove();
                container.ownerDocument.removeEventListener("mousemove", handleMouseMove);
                container.ownerDocument.removeEventListener("mouseup", handleMouseUp);
                
                // Salva o novo valor no localStorage
                if (storageKey) {
                    const targetEl = resizeTarget === "left" ? leftEl : rightEl;
                    let storedValue;
                    if (unit === "px") {
                        storedValue = (direction === "horizontal") ? parseInt(targetEl.style.width) : parseInt(targetEl.style.height);
                    } else {
                        const flexVal = leftEl.style.flex;
                        const match = flexVal.match(/(\d+\.?\d*)%/);
                        storedValue = match ? parseFloat(match[1]) : flexVal;
                    }
                    
                    let key = storageKey;
                    if (storageKey === "layout-dim-splitter-sidebar-left") {
                        const inspector = container.ownerDocument.getElementById("library-inspector-view");
                        if (inspector && inspector.style.display === "flex") {
                            key = "layout-dim-splitter-sidebar-left-inspector";
                        }
                    }
                    localStorage.setItem(key, storedValue);
                }

                // Dispara resize final para garantir sincronia
                window.dispatchEvent(new Event("resize"));
            };

            container.ownerDocument.addEventListener("mousemove", handleMouseMove);
            container.ownerDocument.addEventListener("mouseup", handleMouseUp);
        });
    }
}

export function showToast(msg, type = "info") {
    let toast = document.getElementById("global-nle-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "global-nle-toast";
        toast.className = "nle-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = "block";
    toast.style.borderColor = type === "success" ? "rgba(16, 185, 129, 0.6)" : "rgba(6, 182, 212, 0.6)";
    toast.classList.add("visible");
    setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => { toast.style.display = "none"; }, 300);
    }, 2500);
}
if (!window.showToast) {
    window.showToast = showToast;
}

