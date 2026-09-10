import { STATE } from "./state.js";
import { KEYMAP_SERVICE } from "./keymapService.js";

window.popoutWindows = {};

export const DEFAULT_POPOUT_TITLES = {
    "sidebar-left": "Destacar Biblioteca",
    "inspector-panel": "Destacar Ajustes & Efeitos",
    "sidebar-right": "Destacar Painel Lateral",
    "timeline-panel": "Destacar em Janela Flutuante",
    "source-player-panel": "Destacar Player",
    "program-player-panel": "Destacar Player"
};

export const DEFAULT_POPOUT_HTML = '<i class="fa-solid fa-up-right-from-square"></i>';

/**
 * Retorna o nome fixo da janela popout para reutilização multi-monitor.
 */
export function getPopoutWindowName(panelId) {
    if (panelId === "dual-sidebar") return "CapIAu_DualSidebar_Window";
    if (panelId === "sidebar-left") return "CapIAu_Library_Window";
    if (panelId === "inspector-panel") return "CapIAu_Inspector_Window";
    if (panelId === "sidebar-right") return "CapIAu_RightSidebar_Window";
    if (panelId === "timeline-panel") return "CapIAu_Timeline_Window";
    if (panelId === "source-player-panel") return "CapIAu_SourcePlayer_Window";
    if (panelId === "program-player-panel") return "CapIAu_ProgramPlayer_Window";
    return `CapIAu_${panelId.replace(/-/g, "_")}_Window`;
}

export function getPanelIdFromWindowName(windowName) {
    if (windowName === "CapIAu_DualSidebar_Window") return "dual-sidebar";
    if (windowName === "CapIAu_Library_Window") return "sidebar-left";
    if (windowName === "CapIAu_Inspector_Window") return "inspector-panel";
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
        this.monitorsLayout = localStorage.getItem("capiau_monitors_layout") || "auto";
        this.resolvedMonitorsLayout = "side-by-side";
        this.autoMonitorsObserver = null;
        this._autoMonitorsRaf = null;
        const savedTimelinePos = localStorage.getItem("capiau_timeline_position");
        this.timelinePosition = ["center", "bottom-left", "bottom-right", "bottom-full"].includes(savedTimelinePos)
            ? savedTimelinePos
            : (savedTimelinePos === "bottom" ? "bottom-full" : "center");
        this.studioTop = null;
        this.compoundStage = null;
        this.isZenMode = false;
        this.preZenState = null;
        this.defaultColumnOrder = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
        this.columnOrder = [...this.defaultColumnOrder];
        const savedOrder = localStorage.getItem("capiau_column_order");
        if (savedOrder) {
            try {
                const parsed = JSON.parse(savedOrder);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.columnOrder = parsed;
                }
            } catch (e) {}
        }

        this.pendingColumnOrder = [...this.columnOrder];
        this.pendingTimelinePosition = this.timelinePosition;
        this.pendingMonitorsLayout = this.monitorsLayout;

        this.columnMetadata = {
            "sidebar-left": { title: "Biblioteca / Mídia", icon: "fa-folder-open", desc: "Mídias, pastas e bins do projeto" },
            "inspector-panel": { title: "Inspetor / Efeitos", icon: "fa-sliders", desc: "Propriedades, transformações e ajustes" },
            "center-stage": { title: "Monitores & Preview", icon: "fa-desktop", desc: "Source Player, Program Player e Timeline Central" },
            "sidebar-right": { title: "Ferramentas / Painel Direito", icon: "fa-toolbox", desc: "Ferramentas secundárias, exportação e IA" }
        };

        this.workspacePresets = {
            "default": {
                name: "Padrão",
                columns: ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
                timeline: "center",
                monitors: "side-by-side"
            },
            "inspector-right": {
                name: "Inspetor à Direita",
                columns: ["sidebar-left", "center-stage", "inspector-panel", "sidebar-right"],
                timeline: "center",
                monitors: "side-by-side"
            },
            "decupagem": {
                name: "Foco em Decupagem",
                columns: ["sidebar-left", "center-stage", "sidebar-right", "inspector-panel"],
                timeline: "center",
                monitors: "side-by-side"
            },
            "montagem": {
                name: "Foco em Montagem",
                columns: ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"],
                timeline: "bottom-full",
                monitors: "stacked"
            }
        };

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
            { btnId: "btn-popout-inspector", panelId: "inspector-panel" },
            { btnId: "btn-popout-right", panelId: "sidebar-right" },
            { btnId: "btn-popout-timeline", panelId: "timeline-panel" },
            { btnId: "btn-popout-source", panelId: "source-player-panel" },
            { btnId: "btn-popout-program", panelId: "program-player-panel" }
        ];

        popoutButtons.forEach(({ btnId, panelId }) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout(panelId);
                };
            }
        });

        // Inicializa controles e modal de menus duplos destacados (Multi-Monitor)
        this.initDualPopoutModal();

        // Garante que o tooltip global não tenha display: none residual
        const globalTipInit = document.getElementById("global-tooltip");
        if (globalTipInit) {
            globalTipInit.style.display = "";
        }

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
                if (!panel.classList.contains("maximized") && this.monitorsLayout === "auto") {
                    this.evaluateAutoMonitorsLayout();
                }
                this.reinitMonitorsSplitter();
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
                if (!panel.classList.contains("maximized") && this.monitorsLayout === "auto") {
                    this.evaluateAutoMonitorsLayout();
                }
                this.reinitMonitorsSplitter();
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
                        const selectSlot = document.getElementById("modal-select-slot");
                        if (selectSlot && selectSlot.value) {
                            this.saveWorkspaceSlot(selectSlot.value, ws.id);
                        }
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
                const selectSlot = document.getElementById("modal-select-slot");
                if (selectSlot && selectSlot.value) {
                    this.saveWorkspaceSlot(selectSlot.value, newId);
                }
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

        const chkTimelineExpandLeft = document.getElementById("chk-timeline-expand-left");
        if (chkTimelineExpandLeft) {
            chkTimelineExpandLeft.addEventListener("change", (e) => {
                const isRight = (this.timelinePosition === "bottom-right" || this.timelinePosition === "bottom-full");
                if (e.target.checked) {
                    this.setTimelinePosition(isRight ? "bottom-full" : "bottom-left");
                } else {
                    this.setTimelinePosition(isRight ? "bottom-right" : "center");
                }
            });
        }

        const chkTimelineExpandRight = document.getElementById("chk-timeline-expand-right");
        if (chkTimelineExpandRight) {
            chkTimelineExpandRight.addEventListener("change", (e) => {
                const isLeft = (this.timelinePosition === "bottom-left" || this.timelinePosition === "bottom-full");
                if (e.target.checked) {
                    this.setTimelinePosition(isLeft ? "bottom-full" : "bottom-right");
                } else {
                    this.setTimelinePosition(isLeft ? "bottom-left" : "center");
                }
            });
        }

        const btnTimelineExpandLeft = document.getElementById("btn-timeline-expand-left");
        if (btnTimelineExpandLeft) {
            btnTimelineExpandLeft.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleTimelineExpandLeft();
            });
        }

        const btnTimelineExpandRight = document.getElementById("btn-timeline-expand-right");
        if (btnTimelineExpandRight) {
            btnTimelineExpandRight.addEventListener("click", (e) => {
                e.stopPropagation();
                this.toggleTimelineExpandRight();
            });
        }

        // Aplica o layout inicial salvo
        this.setTimelinePosition(this.timelinePosition, true);
        this.setMonitorsLayout(this.monitorsLayout, true);

        // Inicializa observação inteligente dos monitores por espaço disponível
        this.setupAutoMonitorsObserver();
        if (typeof STATE !== "undefined" && STATE.on) {
            STATE.on("activeVideoChanged", () => {
                if (this.monitorsLayout === "auto") {
                    this.evaluateAutoMonitorsLayout();
                }
            });
        }

        // Inicializa os divisores de tela ajustáveis (Splitters)
        this.reinitSplitters();

        // Atualiza a direcionalidade inteligente dos botões das colunas
        this.updateAllPanelsDockDirection();

        this.initMaximizeButtons();
        this.initSidebarObservers();
        this.initNumpadAndWorkspaceShortcuts();
        this.initTimelinePositionDropdown();

        // Vincula controles do Modal de Configuração de Workspace (Drag & Drop e Presets)
        const btnConfigWorkspace = document.getElementById("btn-config-workspace");
        if (btnConfigWorkspace) {
            btnConfigWorkspace.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openConfigWorkspaceModal();
            });
        }

        const btnCloseConfigModal = document.getElementById("btn-close-config-workspace-modal");
        if (btnCloseConfigModal) {
            btnCloseConfigModal.addEventListener("click", () => this.closeConfigWorkspaceModal());
        }

        const configModalOverlay = document.getElementById("workspace-config-modal");
        if (configModalOverlay) {
            configModalOverlay.addEventListener("click", (e) => {
                if (e.target === configModalOverlay) this.closeConfigWorkspaceModal();
            });
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && configModalOverlay && configModalOverlay.style.display === "flex") {
                this.closeConfigWorkspaceModal();
            }
        });

        // Presets Rápidos dentro da modal
        const presetButtons = document.querySelectorAll(".ws-preset-btn");
        presetButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const presetKey = btn.getAttribute("data-preset");
                if (presetKey) this.applyConfigPreset(presetKey);
            });
        });

        // Opções de Disposição (Timeline e Monitores) na modal
        const timelineButtons = document.querySelectorAll(".ws-layout-option-btn[data-timeline-pos]");
        timelineButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const pos = btn.getAttribute("data-timeline-pos");
                if (pos) {
                    this.pendingTimelinePosition = pos;
                    this.updateConfigModalLayoutButtons();
                }
            });
        });

        const monitorsButtons = document.querySelectorAll(".ws-layout-option-btn[data-monitors-layout]");
        monitorsButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                const layout = btn.getAttribute("data-monitors-layout");
                if (layout) {
                    this.pendingMonitorsLayout = layout;
                    this.updateConfigModalLayoutButtons();
                }
            });
        });

        const btnResetConfig = document.getElementById("btn-reset-workspace-config");
        if (btnResetConfig) {
            btnResetConfig.addEventListener("click", () => {
                this.applyConfigPreset("default");
            });
        }

        const btnSaveAsNew = document.getElementById("btn-save-as-new-workspace");
        if (btnSaveAsNew) {
            btnSaveAsNew.addEventListener("click", () => {
                this.applyActiveConfigFromModal(false);
                this.promptSaveWorkspace();
            });
        }

        const btnApplyConfig = document.getElementById("btn-apply-workspace-config");
        if (btnApplyConfig) {
            btnApplyConfig.addEventListener("click", () => {
                this.applyActiveConfigFromModal(true);
            });
        }

        // Expõe helpers globais no objeto window
        window.workspaceManager = this;
        window.setMonitorsLayout = (layout) => this.setMonitorsLayout(layout);
        window.setTimelinePosition = (pos) => this.setTimelinePosition(pos);
        window.toggleMonitorsLayout = () => this.toggleMonitorsLayout();
        window.toggleTimelinePosition = () => this.toggleTimelinePosition();
        window.toggleTimelineExpandLeft = () => this.toggleTimelineExpandLeft();
        window.toggleTimelineExpandRight = () => this.toggleTimelineExpandRight();
        window.toggleZenMode = () => this.toggleZenMode();
        window.adjustTrackHeight = (delta) => this.adjustTrackHeight(delta);
        window.loadWorkspaceSlot = (slot) => this.loadWorkspaceSlot(slot);
        window.saveWorkspaceSlot = (slot, id) => this.saveWorkspaceSlot(slot, id);
        window.applyColumnsOrder = (order, persist) => this.applyColumnsOrder(order, persist);
        window.updatePanelDockDirection = (panelId, side) => this.updatePanelDockDirection(panelId, side);
        window.openConfigWorkspaceModal = () => this.openConfigWorkspaceModal();
        window.closeConfigWorkspaceModal = () => this.closeConfigWorkspaceModal();
        window.openDualPopout = (p1, p2, layout) => this.openDualPopout(p1, p2, layout);
        window.restoreDualPopout = (p1, p2) => this.restoreDualPopout(p1, p2);
        window.openDualPopoutModal = (p1, p2) => this.openDualPopoutModal(p1, p2);
        window.closeDualPopoutModal = () => this.closeDualPopoutModal();

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
    /**
     * Atualiza os seletores e botões de interface de acordo com o estado ativo.
     */
    updateLayoutUI() {
        const isAuto = this.monitorsLayout === "auto";
        const effectiveLayout = isAuto ? (this.resolvedMonitorsLayout || "side-by-side") : this.monitorsLayout;
        const isStacked = effectiveLayout === "stacked";
        const isBottomFull = this.timelinePosition === "bottom-full";
        const isBottomLeft = this.timelinePosition === "bottom-left";
        const isBottomRight = this.timelinePosition === "bottom-right";
        const isLeftExpanded = isBottomLeft || isBottomFull;
        const isRightExpanded = isBottomRight || isBottomFull;

        const selectMonitorsLayout = document.getElementById("select-monitors-layout");
        if (selectMonitorsLayout) {
            selectMonitorsLayout.value = this.monitorsLayout;
        }
        const iconMonitorsLayout = document.getElementById("icon-monitors-layout");
        if (iconMonitorsLayout) {
            if (isAuto) {
                iconMonitorsLayout.className = "fa-solid fa-wand-magic-sparkles";
                iconMonitorsLayout.style.transform = "none";
                iconMonitorsLayout.style.display = "inline-block";
            } else {
                iconMonitorsLayout.className = isStacked ? "fa-solid fa-table-columns fa-rotate-90" : "fa-solid fa-table-columns";
                iconMonitorsLayout.style.transform = isStacked ? "rotate(90deg)" : "none";
                iconMonitorsLayout.style.display = "inline-block";
            }
        }

        const selectTimelinePosition = document.getElementById("select-timeline-position");
        if (selectTimelinePosition) {
            selectTimelinePosition.value = this.timelinePosition;
        }
        let timelineLabel = "Entre menus";
        if (isBottomFull) {
            timelineLabel = "Faixa de baixo (Total)";
        } else if (isBottomLeft) {
            timelineLabel = "Abaixo da esquerda";
        } else if (isBottomRight) {
            timelineLabel = "Abaixo da direita";
        }
        const iconTimelinePosition = document.getElementById("icon-timeline-position");
        if (iconTimelinePosition) {
            if (isBottomFull) {
                iconTimelinePosition.className = "fa-solid fa-window-maximize";
            } else if (isBottomLeft) {
                iconTimelinePosition.className = "fa-solid fa-arrow-left";
            } else if (isBottomRight) {
                iconTimelinePosition.className = "fa-solid fa-arrow-right";
            } else {
                iconTimelinePosition.className = "fa-solid fa-arrows-left-right-to-line";
            }
        }
        const btnTimelinePosition = document.getElementById("btn-timeline-position");
        if (btnTimelinePosition) {
            btnTimelinePosition.setAttribute("data-tooltip", `Posição da Linha do Tempo: ${timelineLabel}`);
        }

        const chkTimelineBottomFull = document.getElementById("chk-timeline-bottom-full");
        if (chkTimelineBottomFull) {
            chkTimelineBottomFull.checked = isBottomFull;
        }
        const chkTimelineExpandLeft = document.getElementById("chk-timeline-expand-left");
        if (chkTimelineExpandLeft) {
            chkTimelineExpandLeft.checked = isLeftExpanded;
        }
        const chkTimelineExpandRight = document.getElementById("chk-timeline-expand-right");
        if (chkTimelineExpandRight) {
            chkTimelineExpandRight.checked = isRightExpanded;
        }

        const btnTimelineExpandLeft = document.getElementById("btn-timeline-expand-left");
        if (btnTimelineExpandLeft) {
            btnTimelineExpandLeft.classList.toggle("active", isLeftExpanded);
            btnTimelineExpandLeft.innerHTML = isLeftExpanded ? `<i class="fa-solid fa-arrow-right"></i>` : `<i class="fa-solid fa-arrow-left"></i>`;
            const tip = isLeftExpanded ? "Recolher Timeline da Esquerda" : "Expandir Timeline para a Esquerda";
            btnTimelineExpandLeft.removeAttribute("title");
            btnTimelineExpandLeft.setAttribute("data-tooltip", tip);
        }

        const btnTimelineExpandRight = document.getElementById("btn-timeline-expand-right");
        if (btnTimelineExpandRight) {
            btnTimelineExpandRight.classList.toggle("active", isRightExpanded);
            btnTimelineExpandRight.innerHTML = isRightExpanded ? `<i class="fa-solid fa-arrow-left"></i>` : `<i class="fa-solid fa-arrow-right"></i>`;
            const tip = isRightExpanded ? "Recolher Timeline da Direita" : "Expandir Timeline para a Direita";
            btnTimelineExpandRight.removeAttribute("title");
            btnTimelineExpandRight.setAttribute("data-tooltip", tip);
        }

        const btnToggleTimelinePos = document.getElementById("btn-toggle-timeline-position");
        if (btnToggleTimelinePos) {
            const isCenter = this.timelinePosition === "center";
            btnToggleTimelinePos.innerHTML = isCenter ? `<i class="fa-solid fa-window-maximize"></i>` : `<i class="fa-solid fa-arrows-left-right-to-line"></i>`;
            const tip = isCenter ? "Mover Timeline para a Faixa de Baixo (Largura Total)" : "Mover Timeline para entre os Menus";
            btnToggleTimelinePos.removeAttribute("title");
            btnToggleTimelinePos.setAttribute("data-tooltip", tip);
        }

        const btnToggleMonitorsSrc = document.getElementById("btn-toggle-monitors-layout-source");
        const btnToggleMonitorsPrg = document.getElementById("btn-toggle-monitors-layout-program");
        let monitorsIconHtml;
        let monitorsTooltip;

        if (isAuto) {
            monitorsIconHtml = `<i class="fa-solid fa-wand-magic-sparkles" style="color: var(--color-cyan);"></i>`;
            monitorsTooltip = `Disposição dos Monitores: Automático (Ativo: ${isStacked ? 'Empilhados' : 'Lado a Lado'}) - Clique para alternar`;
        } else if (isStacked) {
            monitorsIconHtml = `<i class="fa-solid fa-table-columns"></i>`;
            monitorsTooltip = "Disposição dos Monitores: Empilhados (Manual) - Clique para alternar";
        } else {
            monitorsIconHtml = `<i class="fa-solid fa-table-columns fa-rotate-90" style="transform: rotate(90deg); display: inline-block;"></i>`;
            monitorsTooltip = "Disposição dos Monitores: Lado a Lado (Manual) - Clique para alternar";
        }

        if (btnToggleMonitorsSrc) {
            btnToggleMonitorsSrc.innerHTML = monitorsIconHtml;
            btnToggleMonitorsSrc.removeAttribute("title");
            btnToggleMonitorsSrc.setAttribute("data-tooltip", monitorsTooltip);
        }
        if (btnToggleMonitorsPrg) {
            btnToggleMonitorsPrg.innerHTML = monitorsIconHtml;
            btnToggleMonitorsPrg.removeAttribute("title");
            btnToggleMonitorsPrg.setAttribute("data-tooltip", monitorsTooltip);
        }

        const btnMaxLib = document.getElementById("btn-maximize-library");
        if (btnMaxLib) {
            btnMaxLib.innerHTML = (isBottomFull && isStacked)
                ? `<i class="fa-solid fa-compress"></i>`
                : `<i class="fa-solid fa-expand"></i>`;
            const tip = (isBottomFull && isStacked) ? "Sair do Layout Estúdio" : "Layout Estúdio (biblioteca + players + timeline)";
            btnMaxLib.removeAttribute("title");
            btnMaxLib.setAttribute("data-tooltip", tip);
        }
    }

    /**
     * Verifica se ambos os monitores (Source e Program) estão abertos, presentes no container,
     * não maximizados, não colapsados/ocultos e não destacados em pop-out.
     * @returns {boolean}
     */
    areBothMonitorsOpen() {
        const monitorsContainer = document.querySelector(".monitors-container");
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");

        if (!monitorsContainer || !sourcePanel || !programPanel) return false;
        if (!monitorsContainer.contains(sourcePanel) || !monitorsContainer.contains(programPanel)) return false;

        // Se algum estiver em pop-out
        if (this.poppedElements?.["source-player-panel"] || this.poppedElements?.["program-player-panel"]) return false;
        if (sourcePanel.classList.contains("popped-out-hidden") || programPanel.classList.contains("popped-out-hidden")) return false;

        // Se algum estiver oculto ou colapsado
        if (sourcePanel.style.display === "none" || programPanel.style.display === "none") return false;
        if (sourcePanel.classList.contains("collapsed") || programPanel.classList.contains("collapsed")) return false;

        // Se algum estiver maximizado preenchendo o espaço todo
        if (sourcePanel.classList.contains("maximized") || programPanel.classList.contains("maximized")) return false;

        return true;
    }

    /**
     * Calcula qual a melhor disposição dos monitores (side-by-side vs stacked)
     * para maximizar a área útil de visualização de vídeo e preservar a ergonomia dos controles.
     * @param {number} containerW - Largura total do .monitors-container
     * @param {number} containerH - Altura total do .monitors-container
     * @param {number} [videoAspect=1.7778] - Aspect ratio do vídeo (largura / altura)
     * @returns {"side-by-side" | "stacked"}
     */
    calculateBestMonitorsLayout(containerW, containerH, videoAspect = 16 / 9) {
        if (!containerW || !containerH || containerW <= 0 || containerH <= 0) {
            return this.resolvedMonitorsLayout || "side-by-side";
        }

        const aspect = (typeof videoAspect === "number" && videoAspect > 0) ? videoAspect : (16 / 9);
        const splitterSize = 4;

        // 1. Candidato Lado a Lado (Horizontal)
        // Cada monitor recebe metade da largura disponível
        const sideWidthPerMonitor = Math.max(0, (containerW - splitterSize) / 2);

        // No modo lado a lado, cabeçalho e controles ocupam espaço vertical fixo no fluxo
        let sideChromeH = 110;
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");
        const headerEl = (sourcePanel && sourcePanel.querySelector(".player-header"))
            || (programPanel && programPanel.querySelector(".player-header"));
        const controlsEl = (sourcePanel && sourcePanel.querySelector(".player-controls"))
            || (programPanel && programPanel.querySelector(".player-controls"));
        if (headerEl && controlsEl) {
            const hH = headerEl.offsetHeight;
            const cH = controlsEl.offsetHeight;
            if (hH > 0 && cH > 0) {
                sideChromeH = hH + cH;
            }
        }
        const sideHeightForVideo = Math.max(0, containerH - sideChromeH);

        // Ajuste proporcional de vídeo com object-fit: contain
        const sideVidW = Math.min(sideWidthPerMonitor, sideHeightForVideo * aspect);
        const sideVidH = aspect > 0 ? sideVidW / aspect : 0;
        let sideScore = sideVidW * sideVidH;

        // 2. Candidato Empilhados (Vertical)
        // Cada monitor recebe largura total e metade da altura disponível
        const stackedWidthPerMonitor = Math.max(0, containerW);
        const stackedHeightPerMonitor = Math.max(0, (containerH - splitterSize) / 2);

        // No modo empilhado (layout flat/estúdio), cabeçalho e controles são overlays absolutos em hover (0px no fluxo normal)
        const stackedVidW = Math.min(stackedWidthPerMonitor, stackedHeightPerMonitor * aspect);
        const stackedVidH = aspect > 0 ? stackedVidW / aspect : 0;
        let stackedScore = stackedVidW * stackedVidH;

        // 3. Fatores ergonômicos:
        // - Penalidade se a largura em side-by-side for menor que 280px (botões e timecode espremidos)
        if (sideWidthPerMonitor < 280) {
            sideScore *= 0.65;
        } else if (sideWidthPerMonitor < 320) {
            sideScore *= 0.85;
        }

        // - Penalidade se a altura em stacked for menor que 120px (faixa excessivamente estreita)
        if (stackedHeightPerMonitor < 120) {
            stackedScore *= 0.5;
        } else if (stackedHeightPerMonitor < 150) {
            stackedScore *= 0.8;
        }

        // 4. Histerese Anti-Flicker:
        // Para alternar o layout ativo atual, o concorrente precisa superar a pontuação atual em pelo menos 8%
        const currentActive = this.resolvedMonitorsLayout || "side-by-side";
        const HYSTERESIS = 1.08;

        if (currentActive === "side-by-side") {
            return (stackedScore > sideScore * HYSTERESIS) ? "stacked" : "side-by-side";
        } else {
            return (sideScore > stackedScore * HYSTERESIS) ? "side-by-side" : "stacked";
        }
    }

    /**
     * Avalia e aplica a melhor disposição caso o modo automático esteja ativo.
     * @param {boolean} [skipSplitterReinit=false]
     */
    evaluateAutoMonitorsLayout(skipSplitterReinit = false) {
        if (this.monitorsLayout !== "auto") return;

        // Proteção: não altera durante arraste ativo de qualquer divisor ou redimensionamento de layout
        if (document.body.classList.contains("layout-resizing") || document.querySelector(".panel-splitter.active, .panel-splitter-v.active, .splitter-players.active, .splitter-studio-players.active")) {
            return;
        }

        if (!this.areBothMonitorsOpen()) return;

        const monitorsContainer = document.querySelector(".monitors-container");
        if (!monitorsContainer) return;

        const rect = monitorsContainer.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        // Detecta o aspect ratio do vídeo ativo
        let videoAspect = 16 / 9;
        const prgVideo = document.getElementById("program-video");
        const srcVideo = document.getElementById("source-video");
        if (prgVideo && prgVideo.videoWidth > 0 && prgVideo.videoHeight > 0) {
            videoAspect = prgVideo.videoWidth / prgVideo.videoHeight;
        } else if (srcVideo && srcVideo.videoWidth > 0 && srcVideo.videoHeight > 0) {
            videoAspect = srcVideo.videoWidth / srcVideo.videoHeight;
        }

        const bestLayout = this.calculateBestMonitorsLayout(rect.width, rect.height, videoAspect);
        if (bestLayout !== this.resolvedMonitorsLayout) {
            this.resolvedMonitorsLayout = bestLayout;
            this.applyMonitorsDOM(bestLayout, skipSplitterReinit);
        }
    }

    /**
     * Configura o ResizeObserver no .monitors-container para detecção contínua
     * de mudanças de dimensão provocadas por redimensionamento de abas, timeline, etc.
     */
    setupAutoMonitorsObserver() {
        if (this.autoMonitorsObserver) {
            this.autoMonitorsObserver.disconnect();
            this.autoMonitorsObserver = null;
        }

        const monitorsContainer = document.querySelector(".monitors-container");
        if (!monitorsContainer || typeof ResizeObserver === "undefined") return;

        this.autoMonitorsObserver = new ResizeObserver(() => {
            if (this._autoMonitorsRaf) cancelAnimationFrame(this._autoMonitorsRaf);
            this._autoMonitorsRaf = requestAnimationFrame(() => {
                if (this.monitorsLayout === "auto") {
                    this.evaluateAutoMonitorsLayout();
                }
            });
        });

        this.autoMonitorsObserver.observe(monitorsContainer);

        window.addEventListener("resize", () => {
            if (this.monitorsLayout === "auto") {
                if (this._autoMonitorsRaf) cancelAnimationFrame(this._autoMonitorsRaf);
                this._autoMonitorsRaf = requestAnimationFrame(() => {
                    this.evaluateAutoMonitorsLayout();
                });
            }
        });
    }

    /**
     * Reinicializa exclusivamente o divisor (splitter) entre os monitores Source e Program,
     * sem remover ou interferir nos divisores das sidebars e timeline.
     */
    reinitMonitorsSplitter() {
        const monitorsContainer = document.querySelector(".monitors-container");
        if (!monitorsContainer) return;

        // Remove divisores anteriores de monitores
        const oldSplitterH = monitorsContainer.querySelector(".splitter-players");
        if (oldSplitterH) oldSplitterH.remove();
        const oldSplitterV = monitorsContainer.querySelector(".splitter-studio-players");
        if (oldSplitterV) oldSplitterV.remove();

        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");
        if (!sourcePanel || !programPanel) return;

        if (!this.areBothMonitorsOpen()) return;

        const effectiveLayout = this.monitorsLayout === "auto"
            ? (this.resolvedMonitorsLayout || "side-by-side")
            : this.monitorsLayout;

        if (effectiveLayout === "stacked") {
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

    /**
     * Aplica no DOM as classes, dimensões e splitters para a disposição efetiva fornecida.
     * @param {"side-by-side" | "stacked"} effectiveLayout 
     * @param {boolean} [skipSplitterReinit=false] 
     */
    applyMonitorsDOM(effectiveLayout, skipSplitterReinit = false) {
        const monitorsContainer = document.querySelector(".monitors-container");
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");

        if (effectiveLayout === "stacked") {
            document.body.classList.add("layout-monitors-stacked");
            document.body.classList.remove("layout-monitors-side-by-side");
            if (monitorsContainer) {
                monitorsContainer.classList.add("stacked");
                monitorsContainer.classList.remove("side-by-side");
            }
            if (this.timelinePosition === "bottom-full") {
                document.body.classList.add("studio");
            }
            if (sourcePanel) {
                sourcePanel.style.width = "100%";
                sourcePanel.style.height = "";
            }
            if (programPanel) {
                programPanel.style.width = "100%";
                programPanel.style.height = "";
            }
        } else {
            document.body.classList.remove("layout-monitors-stacked");
            document.body.classList.add("layout-monitors-side-by-side");
            if (monitorsContainer) {
                monitorsContainer.classList.remove("stacked");
                monitorsContainer.classList.add("side-by-side");
            }
            document.body.classList.remove("studio");
            if (sourcePanel) {
                sourcePanel.style.height = "100%";
                sourcePanel.style.width = "";
            }
            if (programPanel) {
                programPanel.style.height = "100%";
                programPanel.style.width = "";
            }
        }

        this.updateLayoutUI();

        if (!skipSplitterReinit) {
            this.reinitMonitorsSplitter();
        }
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /**
     * Altera a disposição dos monitores (Source e Program).
     * @param {"auto" | "side-by-side" | "stacked"} layout 
     * @param {boolean} [skipSplitterReinit=false]
     */
    setMonitorsLayout(layout, skipSplitterReinit = false) {
        if (layout !== "auto" && layout !== "side-by-side" && layout !== "stacked") return;
        this.monitorsLayout = layout;
        localStorage.setItem("capiau_monitors_layout", layout);

        if (layout === "auto") {
            this.evaluateAutoMonitorsLayout(skipSplitterReinit);
            this.updateLayoutUI();
        } else {
            this.resolvedMonitorsLayout = layout;
            this.applyMonitorsDOM(layout, skipSplitterReinit);
        }
    }

    /**
     * Atualiza a direcionalidade inteligente do botão de recolher e das classes do painel.
     * @param {string} panelId 
     * @param {"left" | "right"} side 
     */
    updatePanelDockDirection(panelId, side) {
        if (!panelId || panelId === "center-stage") return;
        const panel = document.getElementById(panelId) || this.poppedElements?.[panelId] || getActiveElement(panelId);
        if (!panel) return;

        const isLeft = side === "left";
        panel.classList.toggle("dock-left", isLeft);
        panel.classList.toggle("dock-right", !isLeft);

        const toggleBtn = panel.querySelector(".btn-toggle-sidebar");
        if (toggleBtn) {
            const header = panel.querySelector(".sidebar-header");
            if (header && toggleBtn.parentElement !== header) {
                header.insertBefore(toggleBtn, header.firstChild);
            }
            toggleBtn.innerHTML = isLeft 
                ? `<i class="fa-solid fa-chevron-left"></i>` 
                : `<i class="fa-solid fa-chevron-right"></i>`;
            const title = isLeft ? "Recolher Painel (Esquerda)" : "Recolher Painel (Direita)";
            toggleBtn.removeAttribute("title");
            toggleBtn.setAttribute("data-tooltip", title);
        }
    }

    /**
     * Atualiza a direcionalidade de todos os painéis com base na ordem ativa das colunas.
     */
    updateAllPanelsDockDirection() {
        const centerIndex = this.columnOrder.indexOf("center-stage");
        if (centerIndex === -1) return;

        this.columnOrder.forEach((colId, idx) => {
            if (colId === "center-stage") return;
            const side = idx < centerIndex ? "left" : "right";
            this.updatePanelDockDirection(colId, side);
        });
    }

    /**
     * Aplica uma nova ordem de colunas superiores, atualizando DOM, divisores e persistência.
     * @param {string[]} newOrder
     * @param {boolean} [persist=true]
     */
    applyColumnsOrder(newOrder, persist = true) {
        if (!Array.isArray(newOrder) || newOrder.length === 0) return;
        this.columnOrder = [...newOrder];
        if (persist) {
            try {
                localStorage.setItem("capiau_column_order", JSON.stringify(this.columnOrder));
            } catch (e) {}
        }

        if (this.timelinePosition === "bottom-left" || this.timelinePosition === "bottom-right") {
            this.setTimelinePosition(this.timelinePosition, true);
        } else {
            const isBottomFull = this.timelinePosition === "bottom-full";
            const workspace = document.querySelector(".workspace");
            const topContainer = (isBottomFull ? this.studioTop : workspace) || workspace;

            if (topContainer) {
                this.arrangeTopColumns(topContainer);
            }
        }
        this.updateAllPanelsDockDirection();
        this.reinitSplitters();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /**
     * Abre o modal interativo de configuração de workspace e posições das colunas.
     */
    openConfigWorkspaceModal() {
        const modal = document.getElementById("workspace-config-modal");
        if (!modal) return;

        // Clona o estado atual para modificações pendentes
        this.pendingColumnOrder = [...this.columnOrder];
        this.pendingTimelinePosition = this.timelinePosition;
        this.pendingMonitorsLayout = this.monitorsLayout;

        this.renderConfigCardsTrack();
        this.updateConfigModalLayoutButtons();

        modal.style.display = "flex";
    }

    /**
     * Fecha o modal de configuração de workspace.
     */
    closeConfigWorkspaceModal() {
        const modal = document.getElementById("workspace-config-modal");
        if (modal) modal.style.display = "none";
    }

    /**
     * Inicializa os ouvintes do modal e botões de Menus Duplos Destacados (Multi-Monitor).
     */
    initDualPopoutModal() {
        const btnDualPopout = document.getElementById("btn-dual-sidebar-popout");
        const modal = document.getElementById("modal-dual-sidebar-popout");
        const btnClose = document.getElementById("btn-close-dual-popout-modal");
        const btnCancel = document.getElementById("btn-cancel-dual-popout");
        const btnConfirm = document.getElementById("btn-confirm-dual-popout");
        const select1 = document.getElementById("select-dual-panel-1");
        const select2 = document.getElementById("select-dual-panel-2");
        const btnSide = document.getElementById("btn-choice-side-by-side");
        const btnStacked = document.getElementById("btn-choice-stacked");

        const btnDualLib = document.getElementById("btn-dual-popout-library");
        const btnDualInsp = document.getElementById("btn-dual-popout-inspector");
        const btnDualRight = document.getElementById("btn-dual-popout-right");

        const presetInspRight = document.getElementById("btn-dual-preset-inspector-right");
        const presetLibInsp = document.getElementById("btn-dual-preset-library-inspector");
        const presetLibRight = document.getElementById("btn-dual-preset-library-right");

        this.pendingDualLayout = localStorage.getItem("capiau_dual_layout") || "side-by-side";

        const updateLayoutChoiceUI = () => {
            if (this.pendingDualLayout === "stacked") {
                btnStacked?.classList.add("active");
                btnSide?.classList.remove("active");
            } else {
                btnSide?.classList.add("active");
                btnStacked?.classList.remove("active");
            }
        };

        const updatePresetActiveUI = () => {
            const v1 = select1?.value;
            const v2 = select2?.value;
            const isInspRight = (v1 === "inspector-panel" && v2 === "sidebar-right") || (v1 === "sidebar-right" && v2 === "inspector-panel");
            const isLibInsp = (v1 === "sidebar-left" && v2 === "inspector-panel") || (v1 === "inspector-panel" && v2 === "sidebar-left");
            const isLibRight = (v1 === "sidebar-left" && v2 === "sidebar-right") || (v1 === "sidebar-right" && v2 === "sidebar-left");

            presetInspRight?.classList.toggle("active", isInspRight);
            presetLibInsp?.classList.toggle("active", isLibInsp);
            presetLibRight?.classList.toggle("active", isLibRight);
        };

        btnSide?.addEventListener("click", () => {
            this.pendingDualLayout = "side-by-side";
            updateLayoutChoiceUI();
        });
        btnStacked?.addEventListener("click", () => {
            this.pendingDualLayout = "stacked";
            updateLayoutChoiceUI();
        });

        presetInspRight?.addEventListener("click", () => {
            if (select1) select1.value = "inspector-panel";
            if (select2) select2.value = "sidebar-right";
            updatePresetActiveUI();
        });
        presetLibInsp?.addEventListener("click", () => {
            if (select1) select1.value = "sidebar-left";
            if (select2) select2.value = "inspector-panel";
            updatePresetActiveUI();
        });
        presetLibRight?.addEventListener("click", () => {
            if (select1) select1.value = "sidebar-left";
            if (select2) select2.value = "sidebar-right";
            updatePresetActiveUI();
        });

        select1?.addEventListener("change", updatePresetActiveUI);
        select2?.addEventListener("change", updatePresetActiveUI);

        btnDualPopout?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openDualPopoutModal("inspector-panel", "sidebar-right");
        });

        btnDualLib?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openDualPopoutModal("sidebar-left", "inspector-panel");
        });

        btnDualInsp?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openDualPopoutModal("inspector-panel", "sidebar-right");
        });

        btnDualRight?.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openDualPopoutModal("inspector-panel", "sidebar-right");
        });

        btnClose?.addEventListener("click", () => this.closeDualPopoutModal());
        btnCancel?.addEventListener("click", () => this.closeDualPopoutModal());

        modal?.addEventListener("click", (e) => {
            if (e.target === modal) this.closeDualPopoutModal();
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && modal && modal.style.display === "flex") {
                this.closeDualPopoutModal();
            }
        });

        btnConfirm?.addEventListener("click", () => {
            const p1 = select1?.value;
            const p2 = select2?.value;
            if (!p1 || !p2 || p1 === p2) {
                alert("Por favor, selecione dois menus laterais diferentes para destacar juntos.");
                return;
            }
            const layout = this.pendingDualLayout || "side-by-side";
            this.closeDualPopoutModal();
            this.openDualPopout(p1, p2, layout);
        });
    }

    openDualPopoutModal(p1 = "inspector-panel", p2 = "sidebar-right") {
        const modal = document.getElementById("modal-dual-sidebar-popout");
        const select1 = document.getElementById("select-dual-panel-1");
        const select2 = document.getElementById("select-dual-panel-2");
        const btnSide = document.getElementById("btn-choice-side-by-side");
        const btnStacked = document.getElementById("btn-choice-stacked");
        const presetInspRight = document.getElementById("btn-dual-preset-inspector-right");
        const presetLibInsp = document.getElementById("btn-dual-preset-library-inspector");
        const presetLibRight = document.getElementById("btn-dual-preset-library-right");

        if (!modal) return;
        if (select1) select1.value = p1;
        if (select2) select2.value = p2;

        this.pendingDualLayout = localStorage.getItem("capiau_dual_layout") || "side-by-side";
        if (this.pendingDualLayout === "stacked") {
            btnStacked?.classList.add("active");
            btnSide?.classList.remove("active");
        } else {
            btnSide?.classList.add("active");
            btnStacked?.classList.remove("active");
        }

        const v1 = select1?.value;
        const v2 = select2?.value;
        const isInspRight = (v1 === "inspector-panel" && v2 === "sidebar-right") || (v1 === "sidebar-right" && v2 === "inspector-panel");
        const isLibInsp = (v1 === "sidebar-left" && v2 === "inspector-panel") || (v1 === "inspector-panel" && v2 === "sidebar-left");
        const isLibRight = (v1 === "sidebar-left" && v2 === "sidebar-right") || (v1 === "sidebar-right" && v2 === "sidebar-left");

        presetInspRight?.classList.toggle("active", isInspRight);
        presetLibInsp?.classList.toggle("active", isLibInsp);
        presetLibRight?.classList.toggle("active", isLibRight);

        modal.style.display = "flex";
    }

    closeDualPopoutModal() {
        const modal = document.getElementById("modal-dual-sidebar-popout");
        if (modal) modal.style.display = "none";
    }

    /**
     * Inicializa o seletor de posicionamento da timeline flat line-icon com menu flutuante customizado (Dark Glassmorphism).
     */
    initTimelinePositionDropdown() {
        const btnTimelinePosition = document.getElementById("btn-timeline-position");
        if (!btnTimelinePosition) return;

        const options = [
            {
                value: "center",
                label: "Timeline: Entre menus",
                desc: "Centralizada entre as colunas laterais",
                icon: "fa-solid fa-arrows-left-right-to-line"
            },
            {
                value: "bottom-left",
                label: "Timeline: Abaixo da esquerda",
                desc: "Estendida sob a biblioteca e o painel esquerdo",
                icon: "fa-solid fa-arrow-left"
            },
            {
                value: "bottom-right",
                label: "Timeline: Abaixo da direita",
                desc: "Estendida sob o inspetor e o painel direito",
                icon: "fa-solid fa-arrow-right"
            },
            {
                value: "bottom-full",
                label: "Timeline: Faixa de baixo (Total)",
                desc: "Largura total ocupando toda a base da tela",
                icon: "fa-solid fa-window-maximize"
            }
        ];

        const closeMenu = () => {
            const existing = document.getElementById("custom-timeline-position-menu");
            if (existing) {
                existing.remove();
            }
            btnTimelinePosition.classList.remove("active");
            document.removeEventListener("pointerdown", handleOutsideClick, true);
            document.removeEventListener("keydown", handleKeydown);
        };

        const handleOutsideClick = (e) => {
            const menu = document.getElementById("custom-timeline-position-menu");
            if (menu && !menu.contains(e.target) && !btnTimelinePosition.contains(e.target)) {
                closeMenu();
            }
        };

        const handleKeydown = (e) => {
            if (e.key === "Escape") {
                closeMenu();
            }
        };

        btnTimelinePosition.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const existing = document.getElementById("custom-timeline-position-menu");
            if (existing) {
                closeMenu();
                return;
            }

            // Fecha outros menus de contexto abertos no documento
            document.querySelectorAll(".custom-context-menu").forEach(m => m.remove());

            // Esconde tooltip global para não sobrepor o menu
            const globalTooltip = document.getElementById("global-tooltip");
            if (globalTooltip) {
                globalTooltip.classList.remove("visible");
                globalTooltip.style.display = "none";
            }

            const menu = document.createElement("div");
            menu.id = "custom-timeline-position-menu";
            menu.className = "custom-context-menu timeline-position-menu";

            // Header do menu
            const header = document.createElement("div");
            header.className = "menu-header";
            header.innerHTML = `<i class="fa-solid fa-arrows-left-right-to-line"></i><span>Posição da Timeline</span>`;
            menu.appendChild(header);

            // Itens
            options.forEach(opt => {
                const isActive = this.timelinePosition === opt.value;
                const item = document.createElement("div");
                item.className = `menu-item ${isActive ? "active" : ""}`;
                item.setAttribute("data-value", opt.value);

                item.innerHTML = `
                    <i class="${opt.icon} item-icon"></i>
                    <div class="item-details">
                        <span class="item-title">${opt.label}</span>
                        <span class="item-desc">${opt.desc}</span>
                    </div>
                    ${isActive ? '<i class="fa-solid fa-check item-check"></i>' : ''}
                `;

                item.addEventListener("click", (ev) => {
                    ev.stopPropagation();
                    closeMenu();
                    if (this.timelinePosition !== opt.value) {
                        this.setTimelinePosition(opt.value);
                        if (window.showToast) {
                            window.showToast(`Posição da Timeline: ${opt.label.replace("Timeline: ", "")}`, "info");
                        }
                    }
                });

                menu.appendChild(item);
            });

            document.body.appendChild(menu);
            btnTimelinePosition.classList.add("active");

            // Posiciona logo abaixo do botão
            const btnRect = btnTimelinePosition.getBoundingClientRect();
            let top = btnRect.bottom + 6;
            let left = btnRect.left;

            // Evita que extrapole as bordas da viewport
            const menuRect = menu.getBoundingClientRect();
            if (left + menuRect.width > window.innerWidth - 10) {
                left = window.innerWidth - menuRect.width - 10;
            }
            if (top + menuRect.height > window.innerHeight - 10) {
                top = btnRect.top - menuRect.height - 6;
            }

            menu.style.top = `${Math.max(8, top)}px`;
            menu.style.left = `${Math.max(8, left)}px`;

            setTimeout(() => {
                document.addEventListener("pointerdown", handleOutsideClick, true);
                document.addEventListener("keydown", handleKeydown);
            }, 10);
        });

        window.addEventListener("resize", () => {
            if (document.getElementById("custom-timeline-position-menu")) {
                closeMenu();
            }
        });
    }

    /**
     * Retorna a chave do preset ativo se o estado pendente coincidir com algum preset pré-definido.
     */
    getActivePresetKey() {
        for (const [key, preset] of Object.entries(this.workspacePresets)) {
            const sameCols = preset.columns.length === this.pendingColumnOrder.length &&
                preset.columns.every((col, i) => col === this.pendingColumnOrder[i]);
            const sameTimeline = preset.timeline === this.pendingTimelinePosition;
            const sameMonitors = preset.monitors === this.pendingMonitorsLayout;
            if (sameCols && sameTimeline && sameMonitors) {
                return key;
            }
        }
        return null;
    }

    /**
     * Atualiza os botões de presets e de opções de layout dentro da modal.
     */
    updateConfigModalLayoutButtons() {
        const activePreset = this.getActivePresetKey();
        const presetButtons = document.querySelectorAll(".ws-preset-btn");
        presetButtons.forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-preset") === activePreset);
        });

        const timelineButtons = document.querySelectorAll(".ws-layout-option-btn[data-timeline-pos]");
        timelineButtons.forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-timeline-pos") === this.pendingTimelinePosition);
        });

        const monitorsButtons = document.querySelectorAll(".ws-layout-option-btn[data-monitors-layout]");
        monitorsButtons.forEach(btn => {
            btn.classList.toggle("active", btn.getAttribute("data-monitors-layout") === this.pendingMonitorsLayout);
        });
    }

    /**
     * Aplica um preset rápido na modal (sem fechar imediatamente).
     * @param {string} presetKey 
     */
    applyConfigPreset(presetKey) {
        const preset = this.workspacePresets[presetKey];
        if (!preset) return;
        this.pendingColumnOrder = [...preset.columns];
        this.pendingTimelinePosition = preset.timeline;
        this.pendingMonitorsLayout = preset.monitors;
        this.renderConfigCardsTrack();
    }

    /**
     * Renderiza os cards das colunas no trilho horizontal (#workspace-cards-track)
     * com base em this.pendingColumnOrder, exibindo os badges de dock e botões de nudge.
     */
    renderConfigCardsTrack() {
        const track = document.getElementById("workspace-cards-track");
        if (!track) return;

        track.innerHTML = "";
        const centerIndex = this.pendingColumnOrder.indexOf("center-stage");

        this.pendingColumnOrder.forEach((colId, idx) => {
            const meta = this.columnMetadata[colId] || { title: colId, icon: "fa-columns", desc: "" };
            let badgeClass = "";
            let badgeIcon = "";
            let badgeText = "";

            if (colId === "center-stage") {
                badgeClass = "badge-center";
                badgeIcon = "fa-anchor";
                badgeText = "Centro (Âncora)";
            } else if (centerIndex !== -1 && idx < centerIndex) {
                badgeClass = "badge-dock-left";
                badgeIcon = "fa-arrow-left";
                badgeText = "Dock: Esquerda ◀";
            } else {
                badgeClass = "badge-dock-right";
                badgeIcon = "fa-arrow-right";
                badgeText = "Dock: Direita ▶";
            }

            const card = document.createElement("div");
            card.className = "ws-card";
            card.setAttribute("draggable", "true");
            card.setAttribute("data-id", colId);
            card.setAttribute("data-index", String(idx));

            card.innerHTML = `
                <div class="ws-card-header">
                    <span class="ws-card-title">
                        <i class="fa-solid ${meta.icon}"></i> ${meta.title}
                    </span>
                    <i class="fa-solid fa-grip-lines ws-card-drag-handle" title="Arraste para mover"></i>
                </div>
                <div class="ws-badge ${badgeClass}">
                    <i class="fa-solid ${badgeIcon}"></i> <span>${badgeText}</span>
                </div>
                <div style="font-size: 10px; color: var(--text-muted); line-height: 1.3; min-height: 26px;">
                    ${meta.desc}
                </div>
                <div class="ws-card-footer">
                    <button type="button" class="btn-card-nudge" data-dir="left" data-index="${idx}" ${idx === 0 ? "disabled" : ""} title="Mover para a esquerda">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: 500;">Posição ${idx + 1}</span>
                    <button type="button" class="btn-card-nudge" data-dir="right" data-index="${idx}" ${idx === this.pendingColumnOrder.length - 1 ? "disabled" : ""} title="Mover para a direita">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            `;

            track.appendChild(card);
        });

        this.bindConfigCardsEvents();
        this.updateConfigModalLayoutButtons();
    }

    /**
     * Vincula eventos de Drag and Drop HTML5 e botões de nudge nos cards da modal.
     */
    bindConfigCardsEvents() {
        const track = document.getElementById("workspace-cards-track");
        if (!track) return;

        let draggedIdx = null;

        const cards = track.querySelectorAll(".ws-card");
        cards.forEach(card => {
            card.addEventListener("dragstart", (e) => {
                draggedIdx = Number(card.getAttribute("data-index"));
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(draggedIdx));
                card.classList.add("dragging");
            });

            card.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const targetIdx = Number(card.getAttribute("data-index"));
                if (draggedIdx === null || draggedIdx === targetIdx) return;

                const rect = card.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                if (e.clientX < midpoint) {
                    card.classList.add("drop-target-left");
                    card.classList.remove("drop-target-right");
                } else {
                    card.classList.add("drop-target-right");
                    card.classList.remove("drop-target-left");
                }
            });

            card.addEventListener("dragleave", () => {
                card.classList.remove("drop-target-left", "drop-target-right");
            });

            card.addEventListener("drop", (e) => {
                e.preventDefault();
                card.classList.remove("drop-target-left", "drop-target-right");
                const targetIdx = Number(card.getAttribute("data-index"));
                if (draggedIdx === null || draggedIdx === targetIdx) return;

                const rect = card.getBoundingClientRect();
                const insertAfter = e.clientX >= (rect.left + rect.width / 2);

                const item = this.pendingColumnOrder.splice(draggedIdx, 1)[0];
                let newPos = targetIdx;
                if (draggedIdx < targetIdx) {
                    newPos = insertAfter ? targetIdx : targetIdx - 1;
                } else {
                    newPos = insertAfter ? targetIdx + 1 : targetIdx;
                }
                newPos = Math.max(0, Math.min(this.pendingColumnOrder.length, newPos));
                this.pendingColumnOrder.splice(newPos, 0, item);

                draggedIdx = null;
                this.renderConfigCardsTrack();
            });

            card.addEventListener("dragend", () => {
                draggedIdx = null;
                track.querySelectorAll(".ws-card").forEach(c => {
                    c.classList.remove("dragging", "drop-target-left", "drop-target-right");
                });
            });
        });

        // Botões Nudge ◀ e ▶
        track.querySelectorAll(".btn-card-nudge").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const idx = Number(btn.getAttribute("data-index"));
                const dir = btn.getAttribute("data-dir");
                const newIdx = dir === "left" ? idx - 1 : idx + 1;
                if (newIdx >= 0 && newIdx < this.pendingColumnOrder.length) {
                    const temp = this.pendingColumnOrder[idx];
                    this.pendingColumnOrder[idx] = this.pendingColumnOrder[newIdx];
                    this.pendingColumnOrder[newIdx] = temp;
                    this.renderConfigCardsTrack();
                }
            });
        });
    }

    /**
     * Aplica as alterações configuradas na modal no workspace ativo atual.
     * @param {boolean} [showToast=true] 
     */
    applyActiveConfigFromModal(showToast = true) {
        this.setTimelinePosition(this.pendingTimelinePosition, true);
        this.setMonitorsLayout(this.pendingMonitorsLayout, true);
        this.applyColumnsOrder(this.pendingColumnOrder, true);
        this.closeConfigWorkspaceModal();
        if (showToast && window.showToast) {
            window.showToast("Layout do Workspace atualizado com sucesso!", "success");
        }
    }

    /**
     * Helper para organizar uma lista arbitrária de colunas dentro do contêiner alvo,
     * respeitando a direcionalidade inteligente e linhas restauradoras.
     * @param {HTMLElement} targetContainer 
     * @param {string[]} colIds 
     */
    arrangeColumnsIntoContainer(targetContainer, colIds) {
        if (!targetContainer || !Array.isArray(colIds) || colIds.length === 0) return;

        const reopenMap = {
            "sidebar-left": "reopen-left",
            "inspector-panel": "reopen-inspector",
            "sidebar-right": "reopen-right"
        };

        const workspace = document.querySelector(".workspace");
        const fullOrder = Array.isArray(this.columnOrder) && this.columnOrder.length > 0
            ? this.columnOrder
            : ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
        const centerIndex = fullOrder.indexOf("center-stage");

        const findColumnElement = (id) => {
            if (id === "center-stage") {
                return (targetContainer && targetContainer.querySelector(".center-stage"))
                    || (workspace && workspace.querySelector(".center-stage"))
                    || (this.compoundStage && this.compoundStage.querySelector(".center-stage"))
                    || (this.studioTop && this.studioTop.querySelector(".center-stage"))
                    || document.querySelector(".center-stage");
            }
            return (targetContainer && targetContainer.querySelector(`#${id}`))
                || (workspace && workspace.querySelector(`#${id}`))
                || (this.compoundStage && this.compoundStage.querySelector(`#${id}`))
                || (this.studioTop && this.studioTop.querySelector(`#${id}`))
                || document.getElementById(id)
                || this.poppedElements?.[id];
        };

        colIds.forEach((colId) => {
            if (colId === "center-stage") {
                const centerEl = findColumnElement("center-stage");
                if (centerEl) {
                    targetContainer.appendChild(centerEl);
                }
                return;
            }

            const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
            const colEl = findColumnElement(colId);
            const reopenId = reopenMap[colId];
            const reopenEl = reopenId ? findColumnElement(reopenId) : null;

            const globalIndex = fullOrder.indexOf(colId);
            const isLeft = centerIndex !== -1 ? (globalIndex !== -1 ? globalIndex < centerIndex : true) : true;
            this.updatePanelDockDirection(colId, isLeft ? "left" : "right");

            if (isLeft) {
                // Linha restauradora posicionada à esquerda do painel
                if (reopenEl) {
                    targetContainer.appendChild(reopenEl);
                }
                if (colEl && !isPopped) {
                    targetContainer.appendChild(colEl);
                }
            } else {
                // Linha restauradora posicionada à direita do painel
                if (colEl && !isPopped) {
                    targetContainer.appendChild(colEl);
                }
                if (reopenEl) {
                    targetContainer.appendChild(reopenEl);
                }
            }
        });
    }

    /**
     * Organiza as colunas superiores dentro do contêiner especificado (studioTop ou workspace),
     * respeitando rigorosamente this.columnOrder e posicionando as linhas restauradoras
     * de acordo com a direcionalidade (à esquerda se dock-left, à direita se dock-right).
     * @param {HTMLElement} targetContainer
     */
    arrangeTopColumns(targetContainer) {
        if (!targetContainer) return;

        const defaultOrder = ["sidebar-left", "inspector-panel", "center-stage", "sidebar-right"];
        const order = Array.isArray(this.columnOrder) && this.columnOrder.length > 0
            ? this.columnOrder
            : defaultOrder;

        this.arrangeColumnsIntoContainer(targetContainer, order);
    }

    /**
     * Altera a posição da Timeline (entre menus laterais no centro vs faixa inferior de largura total,
     * ou expandida abaixo apenas do menu lateral esquerdo ou direito).
     * @param {"center" | "bottom-left" | "bottom-right" | "bottom-full"} position 
     * @param {boolean} [skipSplitterReinit=false]
     */
    setTimelinePosition(position, skipSplitterReinit = false) {
        if (!["center", "bottom-left", "bottom-right", "bottom-full"].includes(position)) return;
        this.timelinePosition = position;
        localStorage.setItem("capiau_timeline_position", position);

        const workspace = document.querySelector(".workspace");
        if (!workspace) return;

        const isTimelinePopped = !!(window.popoutWindows?.["timeline-panel"] && !window.popoutWindows["timeline-panel"].closed);

        // Helper para localizar elementos com segurança onde quer que estejam
        const findElement = (id) => {
            return (workspace && workspace.querySelector(`#${id}`))
                || (this.compoundStage && this.compoundStage.querySelector(`#${id}`))
                || (this.studioTop && this.studioTop.querySelector(`#${id}`))
                || document.getElementById(id);
        };

        const timelinePanel = findElement("timeline-panel");
        const reopenTimeline = findElement("reopen-timeline");

        const centerIndex = this.columnOrder.indexOf("center-stage");

        if (position === "bottom-full") {
            if (!this.studioTop) {
                this.studioTop = document.createElement("div");
                this.studioTop.className = "studio-top";
            }
            // 1. Garante que studioTop está inserido no workspace
            if (this.studioTop.parentNode !== workspace) {
                workspace.appendChild(this.studioTop);
            }

            // 2. Agrupa as colunas superiores dentro de studioTop na ordem de columnOrder
            this.arrangeTopColumns(this.studioTop);

            // 3. Timeline no workspace abaixo de studioTop (full-width)
            if (timelinePanel && !isTimelinePopped) {
                workspace.appendChild(timelinePanel);
            }
            if (reopenTimeline) {
                workspace.appendChild(reopenTimeline);
            }

            // 4. Limpeza de compoundStage somente após transferir os elementos com segurança
            if (this.compoundStage && this.compoundStage.parentNode) {
                this.compoundStage.remove();
            }

            // 5. Classes do body para layout-timeline-bottom (full-width)
            document.body.classList.remove("layout-timeline-bottom-left", "layout-timeline-bottom-right", "layout-timeline-expanded");
            document.body.classList.add("layout-timeline-bottom");
            const effectiveMonitors = this.monitorsLayout === "auto"
                ? (this.resolvedMonitorsLayout || "side-by-side")
                : this.monitorsLayout;
            if (effectiveMonitors === "stacked") {
                document.body.classList.add("studio");
            } else {
                document.body.classList.remove("studio");
            }
        } else if (position === "bottom-left") {
            // Timeline expande para a esquerda (abaixo de menus esquerdos + center-stage).
            // Menu direito permanece full-height.
            if (!this.compoundStage) {
                this.compoundStage = document.createElement("div");
                this.compoundStage.className = "compound-stage";
            }
            if (!this.studioTop) {
                this.studioTop = document.createElement("div");
                this.studioTop.className = "studio-top";
            }
            if (this.studioTop.parentNode !== this.compoundStage) {
                this.compoundStage.appendChild(this.studioTop);
            }

            // Colunas à esquerda e centro vão para studioTop (dentro do compoundStage)
            const leftCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx <= centerIndex)
                : ["sidebar-left", "inspector-panel", "center-stage"];
            const rightCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx > centerIndex)
                : ["sidebar-right"];

            this.arrangeColumnsIntoContainer(this.studioTop, leftCols);

            // Timeline dentro do compoundStage abaixo do studioTop
            if (timelinePanel && !isTimelinePopped) {
                this.compoundStage.appendChild(timelinePanel);
            }
            if (reopenTimeline) {
                this.compoundStage.appendChild(reopenTimeline);
            }

            // Inserção no workspace: compoundStage na esquerda, colunas direitas na direita
            if (workspace.firstChild !== this.compoundStage) {
                workspace.prepend(this.compoundStage);
            }
            this.arrangeColumnsIntoContainer(workspace, rightCols);

            document.body.classList.remove("layout-timeline-bottom", "layout-timeline-bottom-right", "studio");
            document.body.classList.add("layout-timeline-bottom-left", "layout-timeline-expanded");
        } else if (position === "bottom-right") {
            // Timeline expande para a direita (abaixo de center-stage + menu direito).
            // Menus esquerdos permanecem full-height.
            if (!this.compoundStage) {
                this.compoundStage = document.createElement("div");
                this.compoundStage.className = "compound-stage";
            }
            if (!this.studioTop) {
                this.studioTop = document.createElement("div");
                this.studioTop.className = "studio-top";
            }
            if (this.studioTop.parentNode !== this.compoundStage) {
                this.compoundStage.appendChild(this.studioTop);
            }

            const leftCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx < centerIndex)
                : ["sidebar-left", "inspector-panel"];
            const rightCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx >= centerIndex)
                : ["center-stage", "sidebar-right"];

            // Colunas esquerdas diretamente no workspace à esquerda
            this.arrangeColumnsIntoContainer(workspace, leftCols);

            // Inserção no workspace: compoundStage garantidamente após as colunas esquerdas
            workspace.appendChild(this.compoundStage);

            // Colunas centro e direita dentro de studioTop (no compoundStage)
            this.arrangeColumnsIntoContainer(this.studioTop, rightCols);

            // Timeline dentro do compoundStage abaixo do studioTop
            if (timelinePanel && !isTimelinePopped) {
                this.compoundStage.appendChild(timelinePanel);
            }
            if (reopenTimeline) {
                this.compoundStage.appendChild(reopenTimeline);
            }

            document.body.classList.remove("layout-timeline-bottom", "layout-timeline-bottom-left", "studio");
            document.body.classList.add("layout-timeline-bottom-right", "layout-timeline-expanded");
        } else {
            // position === "center":
            // 1. Move todas as colunas superiores de volta para o workspace
            this.arrangeTopColumns(workspace);

            // 2. Localiza o centerStage agora garantidamente dentro de workspace
            const currentCenterStage = (workspace && workspace.querySelector(".center-stage"))
                || (this.compoundStage && this.compoundStage.querySelector(".center-stage"))
                || (this.studioTop && this.studioTop.querySelector(".center-stage"))
                || document.querySelector(".center-stage");

            // 3. Move timelinePanel e reopenTimeline para dentro do centerStage
            if (currentCenterStage) {
                if (timelinePanel && !isTimelinePopped) {
                    currentCenterStage.appendChild(timelinePanel);
                }
                if (reopenTimeline) {
                    currentCenterStage.appendChild(reopenTimeline);
                }
            }

            // 4. Somente após todos os filhos terem sido transferidos, remove studioTop e compoundStage
            if (this.studioTop && this.studioTop.parentNode) {
                this.studioTop.remove();
            }
            if (this.compoundStage && this.compoundStage.parentNode) {
                this.compoundStage.remove();
            }

            document.body.classList.remove(
                "layout-timeline-bottom",
                "layout-timeline-bottom-left",
                "layout-timeline-bottom-right",
                "layout-timeline-expanded",
                "studio"
            );
        }

        this.updateLayoutUI();

        if (!skipSplitterReinit) {
            this.reinitSplitters();
        }
        if (window.timelineRenderer) {
            window.timelineRenderer.resize();
            window.timelineRenderer.requestRedraw();
        }
        if (window.panelsManager) {
            window.panelsManager.renderTrackHeaders(true);
        }
        if (this.monitorsLayout === "auto") {
            this.evaluateAutoMonitorsLayout();
        }
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /** Alterna ciclicamente a disposição dos monitores: Auto -> Lado a Lado -> Empilhados -> Auto */
    toggleMonitorsLayout() {
        let next;
        let toastMsg;
        if (this.monitorsLayout === "auto") {
            next = "side-by-side";
            toastMsg = "Monitores: Lado a Lado (Manual)";
        } else if (this.monitorsLayout === "side-by-side") {
            next = "stacked";
            toastMsg = "Monitores: Empilhados (Manual)";
        } else {
            next = "auto";
            const activeDesc = this.resolvedMonitorsLayout === "stacked" ? "Empilhados" : "Lado a Lado";
            toastMsg = `Monitores: Automático (Ajuste inteligente ativo: ${activeDesc})`;
        }
        this.setMonitorsLayout(next);
        if (window.showToast) {
            window.showToast(toastMsg, "info");
        }
    }

    /** Alterna rapidamente a posição da timeline (entre centro e largura total) */
    toggleTimelinePosition() {
        const next = this.timelinePosition === "center" ? "bottom-full" : "center";
        this.setTimelinePosition(next);
        if (window.showToast) {
            window.showToast(next === "bottom-full" ? "Timeline: Na faixa de baixo (Largura total)" : "Timeline: Entre os menus laterais", "info");
        }
    }

    /** Alterna a expansão da timeline para a esquerda */
    toggleTimelineExpandLeft() {
        let next;
        if (this.timelinePosition === "bottom-left") {
            next = "center";
        } else if (this.timelinePosition === "bottom-full") {
            next = "bottom-right";
        } else if (this.timelinePosition === "bottom-right") {
            next = "bottom-full";
        } else {
            next = "bottom-left";
        }
        this.setTimelinePosition(next);
        if (window.showToast) {
            const isExp = (next === "bottom-left" || next === "bottom-full");
            window.showToast(isExp ? "Timeline: Expandida para a esquerda" : "Timeline: Recolhida da esquerda", "info");
        }
    }

    /** Alterna a expansão da timeline para a direita */
    toggleTimelineExpandRight() {
        let next;
        if (this.timelinePosition === "bottom-right") {
            next = "center";
        } else if (this.timelinePosition === "bottom-full") {
            next = "bottom-left";
        } else if (this.timelinePosition === "bottom-left") {
            next = "bottom-full";
        } else {
            next = "bottom-right";
        }
        this.setTimelinePosition(next);
        if (window.showToast) {
            const isExp = (next === "bottom-right" || next === "bottom-full");
            window.showToast(isExp ? "Timeline: Expandida para a direita" : "Timeline: Recolhida da direita", "info");
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
        const isBottomLeft = this.timelinePosition === "bottom-left";
        const isBottomRight = this.timelinePosition === "bottom-right";
        const isStacked = (this.monitorsLayout === "auto" ? (this.resolvedMonitorsLayout || "side-by-side") : this.monitorsLayout) === "stacked";
        const workspace = document.querySelector(".workspace");
        const centerStage = document.querySelector(".center-stage");
        const monitorsContainer = document.querySelector(".monitors-container");
        const timelineWrapper = document.querySelector(".timeline-canvas-wrapper");

        if (centerStage) {
            centerStage.style.removeProperty("width");
            centerStage.style.flex = "1 1 0%";
        }
        if (this.compoundStage) {
            this.compoundStage.style.removeProperty("width");
            this.compoundStage.style.flex = "1 1 0%";
        }
        if (this.studioTop) {
            this.studioTop.style.removeProperty("width");
            this.studioTop.style.removeProperty("height");
            this.studioTop.style.flex = "1 1 0%";
        }
        const timelinePanelEl = document.getElementById("timeline-panel");
        if (timelinePanelEl && isBottomFull) {
            timelinePanelEl.style.removeProperty("width");
        }
        if (monitorsContainer) {
            monitorsContainer.style.removeProperty("width");
            monitorsContainer.style.removeProperty("height");
        }

        const getColSplitterConfig = (targetCol) => {
            let minVal = 200;
            let maxVal = 800;
            let defaultVal = 340;
            let className = `splitter-${targetCol}`;

            if (targetCol === "sidebar-left") {
                minVal = 200;
                maxVal = 900;
                defaultVal = 350;
                className = (isBottomFull || isBottomLeft) ? "splitter-studio-lib splitter-sidebar-left" : "splitter-sidebar-left";
            } else if (targetCol === "inspector-panel") {
                minVal = 240;
                maxVal = 800;
                defaultVal = 340;
                className = "splitter-inspector";
            } else if (targetCol === "sidebar-right") {
                minVal = 220;
                maxVal = 800;
                defaultVal = 320;
                className = (isBottomFull || isBottomRight) ? "splitter-studio-right splitter-sidebar-right" : "splitter-sidebar-right";
            }
            return { minVal, maxVal, defaultVal, className };
        };

        if (isBottomLeft) {
            // Modo bottom-left: timeline expandida para a esquerda (abaixo de menus esquerdos + monitors)
            // 1. Divisor vertical dentro do compoundStage (entre studioTop e timelinePanel)
            if (this.compoundStage) {
                SplitterHelper.initSplitter(this.compoundStage, ".studio-top", "#timeline-panel", {
                    direction: "vertical",
                    resizeTarget: "right",
                    unit: "px",
                    minVal: 150,
                    maxVal: 700,
                    defaultVal: 300,
                    className: "splitter-studio-timeline splitter-compound-timeline"
                });
            }

            // 2. Divisores horizontais dentro de studioTop (entre colunas esquerdas e center-stage)
            const centerIndex = this.columnOrder.indexOf("center-stage");
            const leftCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx <= centerIndex)
                : ["sidebar-left", "inspector-panel", "center-stage"];
            
            if (this.studioTop) {
                const activeLeft = leftCols.filter(colId => {
                    const el = colId === "center-stage" 
                        ? this.studioTop.querySelector(".center-stage")
                        : this.studioTop.querySelector(`#${colId}`);
                    const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
                    return el && !isPopped && el.parentNode === this.studioTop;
                });

                for (let i = 0; i < activeLeft.length - 1; i++) {
                    const colA = activeLeft[i];
                    const colB = activeLeft[i + 1];
                    const leftSelector = colA === "center-stage" ? ".center-stage" : `#${colA}`;
                    const rightSelector = colB === "center-stage" ? ".center-stage" : `#${colB}`;
                    const cfg = getColSplitterConfig(colA);

                    SplitterHelper.initSplitter(this.studioTop, leftSelector, rightSelector, {
                        direction: "horizontal",
                        resizeTarget: "left",
                        unit: "px",
                        minVal: cfg.minVal,
                        maxVal: cfg.maxVal,
                        defaultVal: cfg.defaultVal,
                        className: cfg.className
                    });
                }
            }

            // 3. Divisores horizontais no workspace (entre compoundStage e colunas direitas)
            if (workspace && this.compoundStage) {
                const rightCols = centerIndex !== -1
                    ? this.columnOrder.filter((col, idx) => idx > centerIndex)
                    : ["sidebar-right"];
                const activeRight = rightCols.filter(colId => {
                    const el = workspace.querySelector(`#${colId}`);
                    const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
                    return el && !isPopped && el.parentNode === workspace;
                });

                if (activeRight.length > 0) {
                    // Splitter entre compoundStage e a primeira coluna direita ativa
                    const firstRight = activeRight[0];
                    const cfgFirst = getColSplitterConfig(firstRight);
                    SplitterHelper.initSplitter(workspace, ".compound-stage", `#${firstRight}`, {
                        direction: "horizontal",
                        resizeTarget: "right",
                        unit: "px",
                        minVal: cfgFirst.minVal,
                        maxVal: cfgFirst.maxVal,
                        defaultVal: cfgFirst.defaultVal,
                        className: cfgFirst.className
                    });

                    // Splitters subsequentes entre colunas direitas
                    for (let j = 0; j < activeRight.length - 1; j++) {
                        const colA = activeRight[j];
                        const colB = activeRight[j + 1];
                        const cfg = getColSplitterConfig(colB);
                        SplitterHelper.initSplitter(workspace, `#${colA}`, `#${colB}`, {
                            direction: "horizontal",
                            resizeTarget: "right",
                            unit: "px",
                            minVal: cfg.minVal,
                            maxVal: cfg.maxVal,
                            defaultVal: cfg.defaultVal,
                            className: cfg.className
                        });
                    }
                }
            }
        } else if (isBottomRight) {
            // Modo bottom-right: timeline expandida para a direita (abaixo de center-stage + menus direitos)
            // 1. Divisor vertical dentro do compoundStage (entre studioTop e timelinePanel)
            if (this.compoundStage) {
                SplitterHelper.initSplitter(this.compoundStage, ".studio-top", "#timeline-panel", {
                    direction: "vertical",
                    resizeTarget: "right",
                    unit: "px",
                    minVal: 150,
                    maxVal: 700,
                    defaultVal: 300,
                    className: "splitter-studio-timeline splitter-compound-timeline"
                });
            }

            // 2. Divisores horizontais dentro de studioTop (entre center-stage e colunas direitas)
            const centerIndex = this.columnOrder.indexOf("center-stage");
            const rightCols = centerIndex !== -1
                ? this.columnOrder.filter((col, idx) => idx >= centerIndex)
                : ["center-stage", "sidebar-right"];

            if (this.studioTop) {
                const activeRight = rightCols.filter(colId => {
                    const el = colId === "center-stage"
                        ? this.studioTop.querySelector(".center-stage")
                        : this.studioTop.querySelector(`#${colId}`);
                    const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
                    return el && !isPopped && el.parentNode === this.studioTop;
                });

                for (let i = 0; i < activeRight.length - 1; i++) {
                    const colA = activeRight[i];
                    const colB = activeRight[i + 1];
                    const leftSelector = colA === "center-stage" ? ".center-stage" : `#${colA}`;
                    const rightSelector = colB === "center-stage" ? ".center-stage" : `#${colB}`;
                    const cfg = getColSplitterConfig(colB);

                    SplitterHelper.initSplitter(this.studioTop, leftSelector, rightSelector, {
                        direction: "horizontal",
                        resizeTarget: "right",
                        unit: "px",
                        minVal: cfg.minVal,
                        maxVal: cfg.maxVal,
                        defaultVal: cfg.defaultVal,
                        className: cfg.className
                    });
                }
            }

            // 3. Divisores horizontais no workspace (entre colunas esquerdas e compoundStage)
            if (workspace) {
                const leftCols = centerIndex !== -1
                    ? this.columnOrder.filter((col, idx) => idx < centerIndex)
                    : ["sidebar-left", "inspector-panel"];
                const activeLeft = leftCols.filter(colId => {
                    const el = workspace.querySelector(`#${colId}`);
                    const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
                    return el && !isPopped && el.parentNode === workspace;
                });

                if (activeLeft.length > 0) {
                    for (let j = 0; j < activeLeft.length - 1; j++) {
                        const colA = activeLeft[j];
                        const colB = activeLeft[j + 1];
                        const cfg = getColSplitterConfig(colA);
                        SplitterHelper.initSplitter(workspace, `#${colA}`, `#${colB}`, {
                            direction: "horizontal",
                            resizeTarget: "left",
                            unit: "px",
                            minVal: cfg.minVal,
                            maxVal: cfg.maxVal,
                            defaultVal: cfg.defaultVal,
                            className: cfg.className
                        });
                    }

                    if (this.compoundStage) {
                        const lastLeft = activeLeft[activeLeft.length - 1];
                        const cfgLast = getColSplitterConfig(lastLeft);
                        SplitterHelper.initSplitter(workspace, `#${lastLeft}`, ".compound-stage", {
                            direction: "horizontal",
                            resizeTarget: "left",
                            unit: "px",
                            minVal: cfgLast.minVal,
                            maxVal: cfgLast.maxVal,
                            defaultVal: cfgLast.defaultVal,
                            className: cfgLast.className
                        });
                    }
                }
            }
        } else {
            // Modos "bottom-full" e "center"
            const topContainer = isBottomFull ? this.studioTop : workspace;

            if (topContainer) {
                // Garante que a ordem visual e de DOM das colunas superiores esteja correta
                this.arrangeTopColumns(topContainer);

                // Identifica as colunas ativas atualmente presentes em topContainer (não destacadas em popout)
                const activeCols = this.columnOrder.filter(colId => {
                    const el = colId === "center-stage" 
                        ? topContainer.querySelector(".center-stage")
                        : topContainer.querySelector(`#${colId}`);
                    const isPopped = !!(window.popoutWindows?.[colId] && !window.popoutWindows[colId].closed);
                    return el && !isPopped && el.parentNode === topContainer;
                });

                const centerIndex = activeCols.indexOf("center-stage");

                // Instancia os divisores dinamicamente entre cada par de colunas adjacentes ativas
                for (let i = 0; i < activeCols.length - 1; i++) {
                    const colA = activeCols[i];
                    const colB = activeCols[i + 1];
                    const leftSelector = colA === "center-stage" ? ".center-stage" : `#${colA}`;
                    const rightSelector = colB === "center-stage" ? ".center-stage" : `#${colB}`;

                    let resizeTarget = "left";
                    let targetCol = colA;

                    if (centerIndex !== -1) {
                        if (i + 1 <= centerIndex) {
                            resizeTarget = "left";
                            targetCol = colA;
                        } else if (i >= centerIndex) {
                            resizeTarget = "right";
                            targetCol = colB;
                        } else if (colB === "center-stage") {
                            resizeTarget = "left";
                            targetCol = colA;
                        } else if (colA === "center-stage") {
                            resizeTarget = "right";
                            targetCol = colB;
                        }
                    }

                    const cfg = getColSplitterConfig(targetCol);

                    SplitterHelper.initSplitter(topContainer, leftSelector, rightSelector, {
                        direction: "horizontal",
                        resizeTarget: resizeTarget,
                        unit: "px",
                        minVal: cfg.minVal,
                        maxVal: cfg.maxVal,
                        defaultVal: cfg.defaultVal,
                        className: cfg.className
                    });
                }
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
        }

        this.reinitMonitorsSplitter();

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

        if (this.monitorsLayout === "auto") {
            this.evaluateAutoMonitorsLayout(true);
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

    getWorkspaceSlots() {
        try {
            const data = localStorage.getItem("capiau_workspace_slots");
            if (data) return JSON.parse(data);
        } catch (err) {
            console.error("[WorkspaceManager] Erro ao ler capiau_workspace_slots:", err);
        }
        return {
            "1": "default",
            "2": "decupagem",
            "3": "montagem",
            "4": "multitela"
        };
    }

    saveWorkspaceSlotsDict(dict) {
        try {
            localStorage.setItem("capiau_workspace_slots", JSON.stringify(dict));
        } catch (err) {
            console.error("[WorkspaceManager] Erro ao gravar capiau_workspace_slots:", err);
        }
    }

    saveWorkspaceSlot(slotNum, wsId = null) {
        const slotKey = String(slotNum);
        const slots = this.getWorkspaceSlots();

        if (!wsId) {
            const activeWs = localStorage.getItem("capiau_active_workspace") || "default";
            const customWorkspaces = this.getCustomWorkspaces();
            let targetId = `custom_slot_${slotKey}`;
            let name = `Slot ${slotKey}`;
            if (activeWs && customWorkspaces[activeWs]) {
                targetId = activeWs;
                name = customWorkspaces[activeWs].name;
                this.saveCustomWorkspace(name, targetId);
            } else {
                this.saveCustomWorkspace(name, targetId);
            }
            wsId = targetId;
        }

        slots[slotKey] = wsId;
        this.saveWorkspaceSlotsDict(slots);
        this.updateWorkspaceSelectUI();

        const customWorkspaces = this.getCustomWorkspaces();
        const wsName = customWorkspaces[wsId]?.name || this.workspacePresets[wsId]?.name || wsId;
        if (window.showToast) {
            window.showToast(`Layout salvo no Slot ${slotKey} (${wsName})!`, "success");
        }
        return true;
    }

    loadWorkspaceSlot(slotNum) {
        const slotKey = String(slotNum);
        const slots = this.getWorkspaceSlots();
        const wsId = slots[slotKey];

        if (!wsId) {
            if (window.showToast) {
                window.showToast(`Slot ${slotKey}: Nenhuma workspace vinculada`, "info");
            }
            return false;
        }

        this.applyWorkspace(wsId);
        const selectWorkspace = document.getElementById("select-workspace");
        if (selectWorkspace) {
            selectWorkspace.value = wsId;
        }
        const customWorkspaces = this.getCustomWorkspaces();
        const wsName = customWorkspaces[wsId]?.name || this.workspacePresets[wsId]?.name || wsId;
        if (window.showToast) {
            window.showToast(`Slot ${slotKey} carregado: ${wsName}`, "success");
        }
        return true;
    }

    updateWorkspaceSelectUI() {
        const selectWorkspace = document.getElementById("select-workspace");
        const optgroupCustom = document.getElementById("optgroup-custom-workspaces");
        if (!selectWorkspace) return;

        const customWorkspaces = this.getCustomWorkspaces();
        const slots = this.getWorkspaceSlots();
        const idToSlot = {};
        for (const s in slots) {
            idToSlot[slots[s]] = s;
        }

        // Atualiza textos dos presets padrão com indicador [1], [2], etc.
        const presetOptions = selectWorkspace.querySelectorAll("optgroup:not(#optgroup-custom-workspaces) option");
        presetOptions.forEach(opt => {
            const baseName = opt.value === "default" ? "Padrão"
                : opt.value === "decupagem" ? "Decupagem"
                : opt.value === "montagem" ? "Estúdio"
                : opt.value === "multitela" ? "Multi-Tela" : opt.value;
            const s = idToSlot[opt.value];
            opt.textContent = s ? `[${s}] Workspace: ${baseName}` : `Workspace: ${baseName}`;
        });

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
                    const s = idToSlot[id];
                    opt.textContent = s ? `[${s}] Workspace: ${ws.name}` : `Workspace: ${ws.name}`;
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

        const sidebarLeft = getActiveElement("sidebar-left") || this.poppedElements?.["sidebar-left"] || document.getElementById("sidebar-left");
        const inspectorPanel = getActiveElement("inspector-panel") || this.poppedElements?.["inspector-panel"] || document.getElementById("inspector-panel");
        const sidebarRight = getActiveElement("sidebar-right") || this.poppedElements?.["sidebar-right"] || document.getElementById("sidebar-right");
        const timelinePanel = getActiveElement("timeline-panel") || this.poppedElements?.["timeline-panel"] || document.getElementById("timeline-panel");
        const sourcePanel = getActiveElement("source-player-panel") || this.poppedElements?.["source-player-panel"] || document.getElementById("source-player-panel");
        const programPanel = getActiveElement("program-player-panel") || this.poppedElements?.["program-player-panel"] || document.getElementById("program-player-panel");
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
            columnOrder: [...this.columnOrder],
            popouts: Object.keys(window.popoutWindows || {}).filter(k => window.popoutWindows[k] && !window.popoutWindows[k].closed),
            splitters: {
                "layout-dim-splitter-sidebar-left": getDim("layout-dim-splitter-sidebar-left"),
                "layout-dim-splitter-inspector": getDim("layout-dim-splitter-inspector"),
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
                inspectorPanel: inspectorPanel ? inspectorPanel.classList.contains("collapsed") : false,
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
                inspectorPanel: inspectorPanel ? inspectorPanel.classList.contains("sidebar-maximized") : false,
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

            if (customConfig.columnOrder && Array.isArray(customConfig.columnOrder) && customConfig.columnOrder.length > 0) {
                this.applyColumnsOrder(customConfig.columnOrder, true);
            }

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

                const inspectorPanel = document.getElementById("inspector-panel");
                const toggleInspector = document.getElementById("toggle-inspector");
                const reopenInspector = document.getElementById("reopen-inspector");
                if (inspectorPanel && reopenInspector) {
                    const isCollapsed = inspectorPanel.classList.contains("collapsed");
                    if (c.inspectorPanel && !isCollapsed) {
                        if (toggleInspector) toggleInspector.click(); else inspectorPanel.classList.add("collapsed");
                    } else if (!c.inspectorPanel && isCollapsed) {
                        if (reopenInspector) reopenInspector.click(); else inspectorPanel.classList.remove("collapsed");
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
            const preset = this.workspacePresets[ws];
            if (preset) {
                this.setTimelinePosition(preset.timeline, true);
                this.setMonitorsLayout(preset.monitors, true);
                this.applyColumnsOrder(preset.columns, true);
            }

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
                this.reinitSplitters();
            } 
            else if (ws === "inspector-right") {
                const left = document.getElementById("sidebar-left");
                const right = document.getElementById("sidebar-right");
                if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left")?.click();
                if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right")?.click();
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

        // Notifica todas as janelas destacadas sobre a mudança de workspace
        try {
            this.channel.postMessage({
                type: "WORKSPACE_CHANGED",
                workspace: ws,
                columnOrder: [...this.columnOrder],
                timelinePosition: this.timelinePosition,
                monitorsLayout: this.monitorsLayout,
                isStudio: document.body.classList.contains("studio"),
                timestamp: Date.now()
            });
        } catch (e) {}

        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    togglePopout(panelId) {
        const win = window.popoutWindows[panelId];
        const isPoppedWindowOpen = win && !win.closed;
        const localPanel = this.poppedElements[panelId] || document.getElementById(panelId);
        const isDetached = localPanel && (localPanel.ownerDocument !== document || !document.body.contains(localPanel));

        if (isPoppedWindowOpen || isDetached) {
            // Se já está aberto ou destacado externamente, fecha o popout e restaura no editor principal
            if (win) {
                try {
                    win.close();
                } catch (e) {}
            }
            this.restorePanel(panelId);
            return;
        }

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

            // Monitoramento de segurança caso o popout seja fechado sem disparo de eventos
            const checkClosedTimer = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkClosedTimer);
                    if (window.popoutWindows[panelId]) {
                        this.restorePanel(panelId);
                    }
                }
            }, 500);
        } else {
            alert("Bloqueador de popups detectado! Por favor, autorize popups para este site para poder destacar painéis em outros monitores.");
        }
    }

    registerPopout(panelId, win) {
        if (!win || win.closed) return;
        window.popoutWindows[panelId] = win;
        this.attachPanelToPopout(panelId, win);
    }

    openDualPopout(panelId1, panelId2, layout = "side-by-side") {
        if (!panelId1 || !panelId2 || panelId1 === panelId2) {
            alert("Selecione dois menus laterais diferentes para destacar juntos.");
            return;
        }

        const dualWin = window.popoutWindows["dual-sidebar"];
        if (dualWin && !dualWin.closed) {
            dualWin.focus();
            return;
        }

        // Se algum dos painéis já estiver destacado individualmente, fecha e restaura antes
        if (window.popoutWindows[panelId1] && !window.popoutWindows[panelId1].closed && window.popoutWindows[panelId1] !== dualWin) {
            try { window.popoutWindows[panelId1].close(); } catch (e) {}
            this.restorePanel(panelId1);
        }
        if (window.popoutWindows[panelId2] && !window.popoutWindows[panelId2].closed && window.popoutWindows[panelId2] !== dualWin) {
            try { window.popoutWindows[panelId2].close(); } catch (e) {}
            this.restorePanel(panelId2);
        }

        // Lê bounds salvos no localStorage para janela dupla
        let width = layout === "stacked" ? 640 : 1020;
        let height = layout === "stacked" ? 920 : 760;
        let left = null;
        let top = null;

        try {
            const rawBounds = localStorage.getItem("capiau_popout_bounds_dual");
            if (rawBounds) {
                const b = JSON.parse(rawBounds);
                if (b && typeof b === "object") {
                    const w = b.outerWidth || b.width;
                    const h = b.outerHeight || b.height;
                    if (w > 200 && h > 200) {
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
            console.warn("[WorkspaceManager] Erro ao ler bounds salvos para dual:", e);
        }

        let features = `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
        if (left !== null && top !== null) {
            features += `,left=${left},top=${top},screenX=${left},screenY=${top}`;
        }

        const popup = window.open(
            `panel.html?panels=${panelId1},${panelId2}&layout=${layout}`,
            "CapIAu_DualSidebar_Window",
            features
        );

        if (popup) {
            window.popoutWindows[panelId1] = popup;
            window.popoutWindows[panelId2] = popup;
            window.popoutWindows["dual-sidebar"] = popup;
            localStorage.setItem(`capiau_popout_active_${panelId1}`, "true");
            localStorage.setItem(`capiau_popout_active_${panelId2}`, "true");
            localStorage.setItem("capiau_dual_popout_active", "true");
            localStorage.setItem("capiau_dual_popout_panels", `${panelId1},${panelId2}`);
            localStorage.setItem("capiau_dual_popout_layout", layout);

            // Monitoramento de segurança caso a janela seja fechada diretamente
            const checkClosedTimer = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkClosedTimer);
                    if (window.popoutWindows["dual-sidebar"] === popup) {
                        this.restoreDualPopout(panelId1, panelId2);
                    }
                }
            }, 500);
        } else {
            alert("Bloqueador de popups detectado! Por favor, autorize popups para este site para poder destacar painéis em outros monitores.");
        }
    }

    registerDualPopout(panels, win, layout) {
        if (!win || win.closed || !Array.isArray(panels) || panels.length < 2) return;
        window.popoutWindows[panels[0]] = win;
        window.popoutWindows[panels[1]] = win;
        window.popoutWindows["dual-sidebar"] = win;
        this.attachDualPanelsToPopout(panels[0], panels[1], win, layout);
    }

    attachDualPanelsToPopout(panelId1, panelId2, win, layout) {
        if (!win || win.closed || !win.document) return;

        const p1 = document.getElementById(panelId1) || this.poppedElements[panelId1];
        const p2 = document.getElementById(panelId2) || this.poppedElements[panelId2];
        if (!p1 || !p2) {
            console.warn(`[WorkspaceManager] Painéis duplos '${panelId1}' e/ou '${panelId2}' não encontrados.`);
            return;
        }

        // Salva nós de origem no DOM principal
        if (p1.ownerDocument === document) {
            this.poppedElements[panelId1] = p1;
            this.originalParents[panelId1] = p1.parentNode;
            this.originalNextSiblings[panelId1] = p1.nextSibling;
        }
        if (p2.ownerDocument === document) {
            this.poppedElements[panelId2] = p2;
            this.originalParents[panelId2] = p2.parentNode;
            this.originalNextSiblings[panelId2] = p2.nextSibling;
        }

        const slot1 = win.document.getElementById("dual-slot-1");
        const slot2 = win.document.getElementById("dual-slot-2");
        if (slot1 && slot2) {
            slot1.innerHTML = "";
            p1.classList.remove("collapsed");
            p1.classList.remove("popped-out-hidden");
            win.document.adoptNode(p1);
            slot1.appendChild(p1);

            slot2.innerHTML = "";
            p2.classList.remove("collapsed");
            p2.classList.remove("popped-out-hidden");
            win.document.adoptNode(p2);
            slot2.appendChild(p2);

            // Esconde linhas restauradoras do editor principal para evitar falso estado recolhido
            const r1 = document.getElementById("reopen-left");
            const r2 = document.getElementById("reopen-inspector");
            const r3 = document.getElementById("reopen-right");
            [panelId1, panelId2].forEach(pid => {
                if (pid === "sidebar-left" && r1) r1.style.display = "none";
                if (pid === "inspector-panel" && r2) r2.style.display = "none";
                if (pid === "sidebar-right" && r3) r3.style.display = "none";
            });

            // Configura botões de popout e toggle nos cabeçalhos dos dois painéis
            [p1, p2].forEach((panelEl, idx) => {
                const currentId = idx === 0 ? panelId1 : panelId2;
                const popBtn = panelEl.querySelector('[id*="popout"]');
                if (popBtn) {
                    popBtn.setAttribute("data-orig-tooltip", popBtn.getAttribute("data-tooltip") || popBtn.title || DEFAULT_POPOUT_TITLES[currentId] || "Destacar");
                    popBtn.setAttribute("data-orig-html", popBtn.innerHTML);
                    popBtn.removeAttribute("title");
                    popBtn.setAttribute("data-tooltip", "Reanexar ao Editor Principal");
                    popBtn.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i>';
                    popBtn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.restoreDualPopout(panelId1, panelId2);
                    };
                }

                // Clona o botão de recolher para desacoplar listeners do documento principal
                const oldToggleBtn = panelEl.querySelector('.btn-toggle-sidebar') || panelEl.querySelector('[id*="toggle-"]');
                if (oldToggleBtn) {
                    const toggleBtn = oldToggleBtn.cloneNode(true);
                    oldToggleBtn.parentNode.replaceChild(toggleBtn, oldToggleBtn);

                    if (idx === 0) {
                        panelEl.classList.remove("dock-right");
                        panelEl.classList.add("dock-left");
                        const isStacked = layout === "stacked";
                        toggleBtn.innerHTML = isStacked ? '<i class="fa-solid fa-chevron-up"></i>' : '<i class="fa-solid fa-chevron-left"></i>';
                        const tip = isStacked ? "Recolher Painel (Cima)" : "Recolher Painel (Esquerda)";
                        toggleBtn.removeAttribute("title");
                        toggleBtn.setAttribute("data-tooltip", tip);
                    } else {
                        panelEl.classList.remove("dock-left");
                        panelEl.classList.add("dock-right");
                        const isStacked = layout === "stacked";
                        toggleBtn.innerHTML = isStacked ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-right"></i>';
                        const tip = isStacked ? "Recolher Painel (Baixo)" : "Recolher Painel (Direita)";
                        toggleBtn.removeAttribute("title");
                        toggleBtn.setAttribute("data-tooltip", tip);
                    }

                    toggleBtn.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        const slotBtnId = idx === 0 ? "btn-toggle-slot-1" : "btn-toggle-slot-2";
                        win.document.getElementById(slotBtnId)?.click();
                    });

                    // Duplo clique no espaço vazio do cabeçalho da sidebar na janela destacada recolhe o slot correspondente
                    const header = panelEl.querySelector(".sidebar-header");
                    if (header) {
                        header.addEventListener("dblclick", (e) => {
                            if (e.target.closest("button, input, select, option, label, a, .tab-btn, .media-tabs, .btn-icon, .btn-toggle-sidebar, #s3-status-indicator")) return;
                            e.preventDefault();
                            try {
                                const sel = win.getSelection ? win.getSelection() : window.getSelection();
                                sel?.removeAllRanges();
                            } catch (err) {}
                            toggleBtn.click();
                        });
                    }
                }
            });
        }

        localStorage.setItem(`capiau_popout_active_${panelId1}`, "true");
        localStorage.setItem(`capiau_popout_active_${panelId2}`, "true");
        localStorage.setItem("capiau_dual_popout_active", "true");

        // Reorganiza os divisores e atualiza o layout do editor principal imediatamente
        this.reinitSplitters();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 40);

        // Inicializa motor global de tooltips na janela destacada
        if (typeof window.initGlobalTooltips === "function") {
            window.initGlobalTooltips(win.document, win);
        }

        // Hooks específicos de cada painel
        [panelId1, panelId2].forEach(panelId => {
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
                }
            } else if (panelId === "inspector-panel") {
                if (window.timelineInteraction && typeof window.timelineInteraction.onInspectorPopoutReady === "function") {
                    window.timelineInteraction.onInspectorPopoutReady(win);
                }
            }
        });

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

        try {
            this.channel.postMessage({
                type: "DUAL_POPOUT_ACK",
                panels: [panelId1, panelId2]
            });
        } catch (e) {}
    }

    restoreDualPopout(panelId1, panelId2) {
        console.log(`[WorkspaceManager] Restaurando painéis duplos: ${panelId1} + ${panelId2}`);
        const win = window.popoutWindows["dual-sidebar"] || window.popoutWindows[panelId1] || window.popoutWindows[panelId2];
        if (win && !win.closed) {
            try { win.close(); } catch (e) {}
        }
        delete window.popoutWindows["dual-sidebar"];
        localStorage.removeItem("capiau_dual_popout_active");
        localStorage.removeItem("capiau_dual_popout_panels");

        if (panelId1) {
            delete window.popoutWindows[panelId1];
            this.restorePanel(panelId1);
        }
        if (panelId2) {
            delete window.popoutWindows[panelId2];
            this.restorePanel(panelId2);
        }

        this.rebindMainSidebarToggles();
        this.updateAllPanelsDockDirection();
        this.reinitSplitters();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
        if (window.showToast) window.showToast("Menus laterais reanexados ao editor principal", "info");
    }

    rebindMainSidebarToggles() {
        const toggleLeft = document.getElementById("toggle-left");
        if (toggleLeft) {
            toggleLeft.onclick = (e) => {
                e.preventDefault();
                if (window.collapseSidebar) window.collapseSidebar("left");
            };
        }
        const toggleInspector = document.getElementById("toggle-inspector");
        if (toggleInspector) {
            toggleInspector.onclick = (e) => {
                e.preventDefault();
                if (window.collapseSidebar) window.collapseSidebar("inspector");
            };
        }
        const toggleRight = document.getElementById("toggle-right");
        if (toggleRight) {
            toggleRight.onclick = (e) => {
                e.preventDefault();
                if (window.collapseSidebar) window.collapseSidebar("right");
            };
        }
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
        else if (data.type === "DUAL_POPOUT_READY") {
            const panels = data.panels || [];
            console.log(`[WorkspaceManager] Pop-out duplo sinalizado: ${panels.join(" + ")}`);
            const win = window.popoutWindows["dual-sidebar"] || window.popoutWindows[panels[0]] || window.popoutWindows[panels[1]];
            if (win && !win.closed) {
                this.attachDualPanelsToPopout(panels[0], panels[1], win, data.layout);
            }
        }
        else if (data.type === "POPOUT_CLOSED") {
            this.restorePanel(data.panel);
        }
        else if (data.type === "DUAL_POPOUT_CLOSED") {
            const panels = data.panels || [];
            this.restoreDualPopout(panels[0], panels[1]);
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
            
            // Transforma o botão de pop-out em botão de reanexação na janela destacada
            const popBtn = localPanel.querySelector('[id*="popout"]');
            if (popBtn) {
                const currentTooltip = popBtn.getAttribute("data-orig-tooltip") || popBtn.getAttribute("data-tooltip") || popBtn.title || DEFAULT_POPOUT_TITLES[panelId] || "Destacar Painel";
                const currentHtml = popBtn.getAttribute("data-orig-html") || (popBtn.innerHTML.includes("fa-up-right-from-square") ? popBtn.innerHTML : DEFAULT_POPOUT_HTML);

                popBtn.setAttribute("data-orig-tooltip", currentTooltip);
                popBtn.setAttribute("data-orig-html", currentHtml);
                popBtn.removeAttribute("title");
                popBtn.setAttribute("data-tooltip", "Reanexar ao Editor Principal");
                popBtn.innerHTML = '<i class="fa-solid fa-down-left-and-up-right-to-center"></i>';
                popBtn.style.display = "";
                popBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout(panelId);
                };
            }
        }

        localStorage.setItem(`capiau_popout_active_${panelId}`, "true");

        // Reorganiza os divisores e atualiza o layout do editor principal imediatamente após a remoção do painel
        this.reinitSplitters();
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);

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
        } else if (panelId === "inspector-panel") {
            if (window.timelineInteraction && typeof window.timelineInteraction.onInspectorPopoutReady === "function") {
                window.timelineInteraction.onInspectorPopoutReady(win);
            } else {
                setTimeout(() => {
                    if (window.timelineInteraction && typeof window.timelineInteraction.onInspectorPopoutReady === "function") {
                        window.timelineInteraction.onInspectorPopoutReady(win);
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
        if (window.popoutWindows[panelId]) {
            delete window.popoutWindows[panelId];
        }
        localStorage.removeItem(`capiau_popout_active_${panelId}`);

        const localPanel = this.poppedElements[panelId] || document.getElementById(panelId);
        if (!localPanel) return;

        // Se o painel já está no documento principal e conectado, apenas garante limpeza visual e de tooltips
        const isAlreadyRestored = localPanel.ownerDocument === document && document.body.contains(localPanel);

        if (!isAlreadyRestored) {
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
            const topContainer = (this.timelinePosition === "bottom-full" ? this.studioTop : workspace) || workspace;

            if (this.columnOrder.includes(panelId)) {
                if (this.timelinePosition === "bottom-left" || this.timelinePosition === "bottom-right") {
                    this.setTimelinePosition(this.timelinePosition, true);
                } else if (topContainer) {
                    topContainer.appendChild(localPanel);
                    this.arrangeTopColumns(topContainer);
                }
                if (panelId === "inspector-panel" && window.timelineInteraction && typeof window.timelineInteraction.onInspectorPopoutRestored === "function") {
                    window.timelineInteraction.onInspectorPopoutRestored();
                }
            } else if (panelId === "timeline-panel") {
                if (this.timelinePosition === "bottom-full" && workspace) {
                    workspace.appendChild(localPanel);
                } else if ((this.timelinePosition === "bottom-left" || this.timelinePosition === "bottom-right") && this.compoundStage) {
                    this.compoundStage.appendChild(localPanel);
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
            } else if (this.originalParents[panelId]) {
                const parent = this.originalParents[panelId];
                const sibling = this.originalNextSiblings[panelId];
                if (sibling && sibling.parentNode === parent) {
                    parent.insertBefore(localPanel, sibling);
                } else {
                    parent.appendChild(localPanel);
                }
            }
        }

        localPanel.classList.remove("popped-out-hidden");
        
        // Restaura a exibição e comportamento original do botão de pop-out
        const popBtn = localPanel.querySelector('[id*="popout"]');
        if (popBtn) {
            const origTooltip = popBtn.getAttribute("data-orig-tooltip") || DEFAULT_POPOUT_TITLES[panelId] || "Destacar Painel";
            const origHtml = popBtn.getAttribute("data-orig-html") || DEFAULT_POPOUT_HTML;

            popBtn.removeAttribute("title");
            popBtn.setAttribute("data-tooltip", origTooltip);
            popBtn.innerHTML = origHtml;
            popBtn.removeAttribute("data-orig-tooltip");
            popBtn.removeAttribute("data-orig-html");
            popBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.togglePopout(panelId);
            };
            popBtn.style.display = "";
        }

        // Esconde tooltip ativa de forma segura (sem display: none inline)
        const globalTip = document.getElementById("global-tooltip");
        if (globalTip) {
            globalTip.classList.remove("visible");
            globalTip.classList.remove("media-desc-tooltip");
            globalTip.style.display = "";
        }

        if (!isAlreadyRestored) {
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

            // Reconstrói os splitters para conectar o painel restaurado
            this.reinitSplitters();
            setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
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
        if (window.panelsManager) {
            window.panelsManager.renderTrackHeaders(true);
        }
    }

    initMaximizeButtons() {
        const btnMaxLib = document.getElementById("btn-maximize-library");
        const sidebarLeft = document.getElementById("sidebar-left");
        if (btnMaxLib && sidebarLeft) {
            btnMaxLib.addEventListener("click", (e) => {
                e.stopPropagation();
                // Alterna o layout Estúdio (biblioteca + players empilhados + timeline full-width)
                const effectiveMonitors = this.monitorsLayout === "auto" ? (this.resolvedMonitorsLayout || "side-by-side") : this.monitorsLayout;
                const isStudio = this.timelinePosition === "bottom-full" && effectiveMonitors === "stacked";
                this.applyStudio(!isStudio);
            });
        }

        const btnMaxInspector = document.getElementById("btn-maximize-inspector");
        const inspectorPanel = document.getElementById("inspector-panel");
        if (btnMaxInspector && inspectorPanel) {
            btnMaxInspector.addEventListener("click", (e) => {
                e.stopPropagation();
                const isMax = inspectorPanel.classList.toggle("sidebar-maximized");
                btnMaxInspector.innerHTML = isMax 
                    ? `<i class="fa-solid fa-compress"></i>` 
                    : `<i class="fa-solid fa-expand"></i>`;
                btnMaxInspector.removeAttribute("title");
                btnMaxInspector.setAttribute("data-tooltip", isMax ? "Restaurar Painel" : "Maximizar Painel");
                
                window.dispatchEvent(new Event("resize"));
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
                btnMaxRight.removeAttribute("title");
                btnMaxRight.setAttribute("data-tooltip", isMax ? "Restaurar Painel" : "Maximizar Painel");
                
                window.dispatchEvent(new Event("resize"));
            });
        }
    }

    initSidebarObservers() {
        const sidebars = [
            document.getElementById("sidebar-left"),
            document.getElementById("inspector-panel"),
            document.getElementById("sidebar-right")
        ].filter(Boolean);
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

    /**
     * Alterna o Cabeçalho Global do aplicativo
     */
    toggleHeader() {
        const app = document.querySelector(".app-container");
        const reopen = document.getElementById("header-restore-trigger");
        const collapseBtn = document.getElementById("btn-collapse-header");
        if (app && app.classList.contains("header-collapsed")) {
            if (reopen) reopen.click(); else app.classList.remove("header-collapsed");
            if (window.showToast) window.showToast("Cabeçalho: Visível", "info");
        } else if (app) {
            if (collapseBtn) collapseBtn.click(); else app.classList.add("header-collapsed");
            if (window.showToast) window.showToast("Cabeçalho: Oculto", "info");
        }
    }

    /**
     * Alterna a Biblioteca (Sidebar Esquerda)
     */
    toggleLibrary() {
        const lib = document.getElementById("sidebar-left");
        const reopen = document.getElementById("reopen-left");
        const toggleBtn = document.getElementById("toggle-left");
        if (lib && lib.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else lib.classList.remove("collapsed");
            if (window.showToast) window.showToast("Biblioteca: Visível", "info");
        } else if (lib) {
            if (toggleBtn) toggleBtn.click(); else lib.classList.add("collapsed");
            if (window.showToast) window.showToast("Biblioteca: Oculta", "info");
        }
    }

    /**
     * Alterna a Biblioteca em Modo Estúdio Maximizado
     */
    maximizeLibraryStudio() {
        const btn = document.getElementById("btn-maximize-library");
        if (btn) {
            btn.click();
        } else {
            const effectiveMonitors = this.monitorsLayout === "auto" ? (this.resolvedMonitorsLayout || "side-by-side") : this.monitorsLayout;
            const isStudio = this.timelinePosition === "bottom-full" && effectiveMonitors === "stacked";
            this.applyStudio(!isStudio);
        }
    }

    /**
     * Alterna o Inspetor de Propriedades e Efeitos
     */
    toggleInspector() {
        const insp = document.getElementById("inspector-panel");
        const reopen = document.getElementById("reopen-inspector");
        const toggleBtn = document.getElementById("toggle-inspector");
        if (insp && insp.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else insp.classList.remove("collapsed");
            if (window.showToast) window.showToast("Inspetor: Visível", "info");
        } else if (insp) {
            if (toggleBtn) toggleBtn.click(); else insp.classList.add("collapsed");
            if (window.showToast) window.showToast("Inspetor: Oculto", "info");
        }
    }

    /**
     * Maximiza ou restaura o Inspetor de Propriedades
     */
    maximizeInspector() {
        const btn = document.getElementById("btn-maximize-inspector");
        if (btn) {
            btn.click();
        } else {
            const insp = document.getElementById("inspector-panel");
            if (insp) {
                const isMax = insp.classList.toggle("sidebar-maximized");
                window.dispatchEvent(new Event("resize"));
                if (window.showToast) window.showToast(isMax ? "Inspetor: Maximizado" : "Inspetor: Restaurado", "info");
            }
        }
    }

    /**
     * Alterna o Painel Lateral Direito (Ferramentas, IA, Exportação)
     */
    toggleRightSidebar() {
        const r = document.getElementById("sidebar-right");
        const reopen = document.getElementById("reopen-right");
        const toggleBtn = document.getElementById("toggle-right");
        if (r && r.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else r.classList.remove("collapsed");
            if (window.showToast) window.showToast("Painel Direito: Visível", "info");
        } else if (r) {
            if (toggleBtn) toggleBtn.click(); else r.classList.add("collapsed");
            if (window.showToast) window.showToast("Painel Direito: Oculto", "info");
        }
    }

    /**
     * Maximiza ou restaura o Painel Lateral Direito
     */
    maximizeRightSidebar() {
        const btn = document.getElementById("btn-maximize-right");
        if (btn) {
            btn.click();
        } else {
            const r = document.getElementById("sidebar-right");
            if (r) {
                const isMax = r.classList.toggle("sidebar-maximized");
                window.dispatchEvent(new Event("resize"));
                if (window.showToast) window.showToast(isMax ? "Painel Direito: Maximizado" : "Painel Direito: Restaurado", "info");
            }
        }
    }

    /**
     * Alterna a visibilidade do Source Player
     */
    toggleSourcePlayer() {
        const panel = document.getElementById("source-player-panel");
        if (!panel) return;
        const isHidden = panel.style.display === "none";
        panel.style.display = isHidden ? "" : "none";
        this.reinitSplitters();
        window.dispatchEvent(new Event("resize"));
        if (window.showToast) {
            window.showToast(isHidden ? "Source Player: Visível" : "Source Player: Oculto", "info");
        }
    }

    /**
     * Maximiza ou restaura o Source Player
     */
    maximizeSourcePlayer() {
        const btn = document.getElementById("btn-expand-source");
        if (btn) btn.click();
    }

    /**
     * Alterna a visibilidade do Program Player
     */
    toggleProgramPlayer() {
        const panel = document.getElementById("program-player-panel");
        if (!panel) return;
        const isHidden = panel.style.display === "none";
        panel.style.display = isHidden ? "" : "none";
        this.reinitSplitters();
        window.dispatchEvent(new Event("resize"));
        if (window.showToast) {
            window.showToast(isHidden ? "Program Player: Visível" : "Program Player: Oculto", "info");
        }
    }

    /**
     * Maximiza ou restaura o Program Player
     */
    maximizeProgramPlayer() {
        const btn = document.getElementById("btn-expand-program");
        if (btn) btn.click();
    }

    /**
     * Alterna o foco ativo ou faz swap entre os players Source e Program
     */
    swapMonitorsFocus() {
        const src = document.getElementById("source-player-panel");
        const prg = document.getElementById("program-player-panel");
        const btnExpandSource = document.getElementById("btn-expand-source");
        const btnExpandProgram = document.getElementById("btn-expand-program");

        if (src && src.classList.contains("maximized")) {
            if (btnExpandSource) btnExpandSource.click();
            if (btnExpandProgram) btnExpandProgram.click();
            window.activeFocusedPlayer = "program";
            if (window.showToast) window.showToast("Foco: Program Player", "info");
            return;
        }
        if (prg && prg.classList.contains("maximized")) {
            if (btnExpandProgram) btnExpandProgram.click();
            if (btnExpandSource) btnExpandSource.click();
            window.activeFocusedPlayer = "source";
            if (window.showToast) window.showToast("Foco: Source Player", "info");
            return;
        }

        window.activeFocusedPlayer = (window.activeFocusedPlayer === "source" ? "program" : "source");
        const targetWrapper = document.getElementById(window.activeFocusedPlayer === "source" ? "source-video-wrapper" : "program-video-wrapper");
        if (targetWrapper && typeof targetWrapper.focus === "function") {
            targetWrapper.focus();
        }
        if (window.showToast) {
            window.showToast(`Foco: ${window.activeFocusedPlayer === "source" ? "Source Player" : "Program Player"}`, "info");
        }
    }

    /**
     * Alterna o Cabeçalho de Pistas da Timeline (Track Headers)
     */
    toggleTrackHeaders() {
        const sidebar = document.getElementById("timeline-headers-sidebar");
        const reopen = document.getElementById("reopen-headers");
        const toggleBtn = document.getElementById("btn-toggle-headers");
        if (sidebar && sidebar.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else sidebar.classList.remove("collapsed");
            if (window.showToast) window.showToast("Cabeçalhos de Pista: Visíveis", "info");
        } else if (sidebar) {
            if (toggleBtn) toggleBtn.click(); else sidebar.classList.add("collapsed");
            if (window.showToast) window.showToast("Cabeçalhos de Pista: Ocultos", "info");
        }
    }

    /**
     * Alterna a visibilidade vertical do painel inteiro da Timeline
     */
    toggleTimelinePanelVertical() {
        const timeline = document.getElementById("timeline-panel");
        const reopen = document.getElementById("reopen-timeline");
        const toggleBtn = document.getElementById("toggle-timeline");
        if (timeline && timeline.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else timeline.classList.remove("collapsed");
            if (window.showToast) window.showToast("Painel da Timeline: Visível", "info");
        } else if (timeline) {
            if (toggleBtn) toggleBtn.click(); else timeline.classList.add("collapsed");
            if (window.showToast) window.showToast("Painel da Timeline: Oculto", "info");
        }
    }

    /**
     * Alterna a Barra de Ferramentas da Timeline (Toolbar)
     */
    toggleTimelineToolbar() {
        const toolbar = document.getElementById("timeline-actions-sidebar");
        const reopen = document.getElementById("reopen-toolbar");
        const toggleBtn = document.getElementById("btn-toggle-toolbar");
        if (toolbar && toolbar.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else toolbar.classList.remove("collapsed");
            if (window.showToast) window.showToast("Barra de Ferramentas: Visível", "info");
        } else if (toolbar) {
            if (toggleBtn) toggleBtn.click(); else toolbar.classList.add("collapsed");
            if (window.showToast) window.showToast("Barra de Ferramentas: Oculta", "info");
        }
    }

    /**
     * Alterna o Cabeçalho Superior da Timeline (Barra de ferramentas de zoom, timecode, etc.)
     */
    toggleTimelineHeader() {
        const headerBar = document.getElementById("timeline-header-bar");
        const reopen = document.getElementById("reopen-timeline-header");
        const toggleBtn = document.getElementById("btn-toggle-timeline-header");
        if (headerBar && headerBar.classList.contains("collapsed")) {
            if (reopen) reopen.click(); else headerBar.classList.remove("collapsed");
            if (window.showToast) window.showToast("Cabeçalho da Timeline: Visível", "info");
        } else if (headerBar) {
            if (toggleBtn) toggleBtn.click(); else headerBar.classList.add("collapsed");
            if (window.showToast) window.showToast("Cabeçalho da Timeline: Oculto", "info");
        }
    }

    /**
     * Ajusta a altura das pistas da timeline incrementando ou decrementando delta px
     */
    adjustTrackHeight(delta) {
        const slider = getActiveElement("track-height-slider");
        if (!slider) return;
        const current = parseInt(slider.value, 10) || 100;
        const min = parseInt(slider.min, 10) || 50;
        const max = parseInt(slider.max, 10) || 170;
        const newVal = Math.max(min, Math.min(max, current + delta));
        if (newVal !== current) {
            slider.value = String(newVal);
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
            if (window.showToast) {
                window.showToast(`Altura das Pistas: ${newVal}%`, "info");
            }
        }
    }

    /**
     * Alterna o Modo Zen / Cinema:
     * Oculta Header e todas as sidebars laterais para máxima imersão;
     * No segundo toque, restaura fielmente o estado anterior de cada elemento.
     */
    toggleZenMode() {
        const app = document.querySelector(".app-container");
        const lib = document.getElementById("sidebar-left");
        const insp = document.getElementById("inspector-panel");
        const right = document.getElementById("sidebar-right");

        if (this.isZenMode) {
            // Restaurar estado anterior
            if (this.preZenState) {
                if (app && !this.preZenState.header && app.classList.contains("header-collapsed")) {
                    const r = document.getElementById("header-restore-trigger");
                    if (r) r.click(); else app.classList.remove("header-collapsed");
                }
                if (lib && !this.preZenState.sidebarLeft && lib.classList.contains("collapsed")) {
                    const r = document.getElementById("reopen-left");
                    if (r) r.click(); else lib.classList.remove("collapsed");
                }
                if (insp && !this.preZenState.inspector && insp.classList.contains("collapsed")) {
                    const r = document.getElementById("reopen-inspector");
                    if (r) r.click(); else insp.classList.remove("collapsed");
                }
                if (right && !this.preZenState.sidebarRight && right.classList.contains("collapsed")) {
                    const r = document.getElementById("reopen-right");
                    if (r) r.click(); else right.classList.remove("collapsed");
                }
            }
            this.isZenMode = false;
            this.preZenState = null;
            if (window.showToast) window.showToast("Modo Zen: Desativado", "info");
        } else {
            // Ativar Zen: memoriza visibilidade atual e fecha tudo
            this.preZenState = {
                header: app ? app.classList.contains("header-collapsed") : false,
                sidebarLeft: lib ? lib.classList.contains("collapsed") : false,
                inspector: insp ? insp.classList.contains("collapsed") : false,
                sidebarRight: right ? right.classList.contains("collapsed") : false
            };
            if (app && !app.classList.contains("header-collapsed")) {
                const b = document.getElementById("btn-collapse-header");
                if (b) b.click(); else app.classList.add("header-collapsed");
            }
            if (lib && !lib.classList.contains("collapsed")) {
                const b = document.getElementById("toggle-left");
                if (b) b.click(); else lib.classList.add("collapsed");
            }
            if (insp && !insp.classList.contains("collapsed")) {
                const b = document.getElementById("toggle-inspector");
                if (b) b.click(); else insp.classList.add("collapsed");
            }
            if (right && !right.classList.contains("collapsed")) {
                const b = document.getElementById("toggle-right");
                if (b) b.click(); else right.classList.add("collapsed");
            }
            this.isZenMode = true;
            if (window.showToast) window.showToast("Modo Zen: Ativado (Foco Total)", "info");
        }
        this.reinitSplitters();
        window.dispatchEvent(new Event("resize"));
    }

    /**
     * Maximiza o painel sob o cursor do mouse ou com foco ativo
     */
    maximizeFocusedOrHovered() {
        let target = null;
        try {
            target = document.querySelector("#source-player-panel:hover, #program-player-panel:hover, #timeline-panel:hover, #inspector-panel:hover, #sidebar-left:hover, #sidebar-right:hover");
        } catch (e) {}

        if (!target && document.activeElement) {
            target = document.activeElement.closest("#source-player-panel, #program-player-panel, #timeline-panel, #inspector-panel, #sidebar-left, #sidebar-right");
        }

        if (target) {
            if (target.id === "source-player-panel") {
                this.maximizeSourcePlayer();
                return;
            }
            if (target.id === "program-player-panel") {
                this.maximizeProgramPlayer();
                return;
            }
            if (target.id === "inspector-panel") {
                this.maximizeInspector();
                return;
            }
            if (target.id === "sidebar-left") {
                this.maximizeLibraryStudio();
                return;
            }
            if (target.id === "sidebar-right") {
                this.maximizeRightSidebar();
                return;
            }
            if (target.id === "timeline-panel") {
                this.toggleTimelinePosition();
                return;
            }
        }
        // Fallback: maximiza o program player
        this.maximizeProgramPlayer();
    }

    /**
     * Inicializa os ouvintes de teclado para atalhos Numpad e Slots de Workspace
     */
    initNumpadAndWorkspaceShortcuts() {
        window.addEventListener("keydown", (e) => {
            // Ignora atalhos se o foco estiver em campos de digitação
            const target = e.target;
            if (target) {
                const tag = target.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
                    return;
                }
            }

            // 1. Slots de Workspace: Salvar (Ctrl + Alt + Shift + [1-9])
            if (e.ctrlKey && e.altKey && e.shiftKey) {
                for (let i = 1; i <= 9; i++) {
                    if (e.code === `Digit${i}` || e.code === `Numpad${i}` || KEYMAP_SERVICE.matches(e, `workspace.save_slot_${i}`)) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.saveWorkspaceSlot(i);
                        return;
                    }
                }
            }

            // 2. Slots de Workspace: Carregar (Ctrl + Alt + [1-9])
            if (e.ctrlKey && e.altKey && !e.shiftKey) {
                for (let i = 1; i <= 9; i++) {
                    if (e.code === `Digit${i}` || e.code === `Numpad${i}` || KEYMAP_SERVICE.matches(e, `workspace.load_slot_${i}`)) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.loadWorkspaceSlot(i);
                        return;
                    }
                }
            }

            // 3. Alt + Numpad
            if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
                if (e.code === "Numpad1" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_1")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTrackHeaders();
                    return;
                }
                if (e.code === "Numpad2" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_2")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelinePanelVertical();
                    return;
                }
                if (e.code === "Numpad3" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_3")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelineToolbar();
                    return;
                }
                if (e.code === "Numpad4" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_4")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeLibraryStudio();
                    return;
                }
                if (e.code === "Numpad5" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_5")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeInspector();
                    return;
                }
                if (e.code === "Numpad6" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_6")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeRightSidebar();
                    return;
                }
                if (e.code === "Numpad7" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_7")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeSourcePlayer();
                    return;
                }
                if (e.code === "Numpad9" || KEYMAP_SERVICE.matches(e, "workspace.alt_numpad_9")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeProgramPlayer();
                    return;
                }
            }

            // 4. Ctrl + Numpad (Destacar / Popout)
            if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
                if (e.code === "Numpad2" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_2")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("timeline-panel");
                    return;
                }
                if (e.code === "Numpad4" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_4")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("sidebar-left");
                    return;
                }
                if (e.code === "Numpad5" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_5")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("inspector-panel");
                    return;
                }
                if (e.code === "Numpad6" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_6")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("sidebar-right");
                    return;
                }
                if (e.code === "Numpad7" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_7")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("source-player-panel");
                    return;
                }
                if (e.code === "Numpad9" || KEYMAP_SERVICE.matches(e, "workspace.ctrl_numpad_9")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePopout("program-player-panel");
                    return;
                }
            }

            // 5. Teclas Simples do Numpad (sem modificadores)
            if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
                if (e.code === "Numpad1" || KEYMAP_SERVICE.matches(e, "workspace.numpad_1")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelineExpandLeft();
                    return;
                }
                if (e.code === "Numpad2" || KEYMAP_SERVICE.matches(e, "workspace.numpad_2")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelinePosition();
                    return;
                }
                if (e.code === "Numpad3" || KEYMAP_SERVICE.matches(e, "workspace.numpad_3")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelineExpandRight();
                    return;
                }
                if (e.code === "Numpad4" || KEYMAP_SERVICE.matches(e, "workspace.numpad_4")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleLibrary();
                    return;
                }
                if (e.code === "Numpad5" || KEYMAP_SERVICE.matches(e, "workspace.numpad_5")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleInspector();
                    return;
                }
                if (e.code === "Numpad6" || KEYMAP_SERVICE.matches(e, "workspace.numpad_6")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleRightSidebar();
                    return;
                }
                if (e.code === "Numpad7" || KEYMAP_SERVICE.matches(e, "workspace.numpad_7")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleSourcePlayer();
                    return;
                }
                if (e.code === "Numpad8" || KEYMAP_SERVICE.matches(e, "workspace.numpad_8")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleHeader();
                    return;
                }
                if (e.code === "Numpad9" || KEYMAP_SERVICE.matches(e, "workspace.numpad_9")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleProgramPlayer();
                    return;
                }
                if (e.code === "Numpad0" || KEYMAP_SERVICE.matches(e, "workspace.numpad_0")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleZenMode();
                    return;
                }
                if (e.code === "NumpadDecimal" || KEYMAP_SERVICE.matches(e, "workspace.numpad_decimal")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleTimelineHeader();
                    return;
                }
                if (e.code === "NumpadAdd" || KEYMAP_SERVICE.matches(e, "workspace.numpad_add")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.adjustTrackHeight(10);
                    return;
                }
                if (e.code === "NumpadSubtract" || KEYMAP_SERVICE.matches(e, "workspace.numpad_subtract")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.adjustTrackHeight(-10);
                    return;
                }
                if (e.code === "NumpadDivide" || KEYMAP_SERVICE.matches(e, "workspace.numpad_divide")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleMonitorsLayout();
                    return;
                }
                if (e.code === "NumpadMultiply" || KEYMAP_SERVICE.matches(e, "workspace.numpad_multiply")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.swapMonitorsFocus();
                    return;
                }
                if (e.code === "NumpadEnter" || KEYMAP_SERVICE.matches(e, "workspace.numpad_enter")) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.maximizeFocusedOrHovered();
                    return;
                }
            }
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
            if (targetEl && !targetEl.classList.contains("center-stage") && !targetEl.classList.contains("compound-stage")) {
                targetEl.style.flex = `0 0 ${defaultVal}px`;
                if (direction === "horizontal") {
                    targetEl.style.width = `${defaultVal}px`;
                } else {
                    targetEl.style.height = `${defaultVal}px`;
                }
            }
        } else {
            // Percentual
            leftEl.style.flex = `0 0 ${defaultVal}%`;
            rightEl.style.flex = `1 1 0%`;
        }

        let isDragging = false;

        splitter.addEventListener("mousedown", (e) => {
            if (typeof window !== "undefined" && window.libraryScrollIndex && typeof window.libraryScrollIndex.hide === "function") {
                window.libraryScrollIndex.hide();
            }
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

            let moveRaf = null;
            let pendingMoveEvent = null;

            const applyMove = (moveEvent) => {
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
                        if (targetEl && !targetEl.classList.contains("center-stage") && !targetEl.classList.contains("compound-stage")) {
                            targetEl.style.width = `${val}px`;
                            targetEl.style.flex = `0 0 ${val}px`;
                        }
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

            const handleMouseMove = (moveEvent) => {
                if (!isDragging) return;
                pendingMoveEvent = moveEvent;
                if (!moveRaf) {
                    moveRaf = requestAnimationFrame(() => {
                        moveRaf = null;
                        if (isDragging && pendingMoveEvent) {
                            applyMove(pendingMoveEvent);
                        }
                    });
                }
            };

            const handleMouseUp = () => {
                if (moveRaf) {
                    cancelAnimationFrame(moveRaf);
                    moveRaf = null;
                }
                if (pendingMoveEvent) {
                    applyMove(pendingMoveEvent);
                    pendingMoveEvent = null;
                }
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

