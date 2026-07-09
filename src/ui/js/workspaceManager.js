// Gerenciador de Workspaces Customizáveis e Pop-outs Multi-Monitores (CapIAu-Talho)
import { STATE } from "./state.js";

window.popoutWindows = {};

/**
 * Procura um elemento pelo ID varrendo a janela principal e qualquer janela popout aberta.
 */
export function getActiveElement(id) {
    for (const name in window.popoutWindows) {
        const win = window.popoutWindows[name];
        if (win && !win.closed) {
            const el = win.document.getElementById(id);
            if (el) return el;
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
            const el = win.document.querySelector(selector);
            if (el) return el;
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
        this.init();
    }

    init() {
        // Escuta mensagens do BroadcastChannel para sincronia bidirecional
        this.channel.addEventListener("message", (e) => this.handleMessage(e));

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
        if (btnExpandSource) {
            btnExpandSource.addEventListener("click", (e) => {
                e.stopPropagation();
                const panel = document.getElementById("source-player-panel");
                panel.classList.toggle("maximized");
                btnExpandSource.innerHTML = panel.classList.contains("maximized") 
                    ? `<i class="fa-solid fa-compress"></i>` 
                    : `<i class="fa-solid fa-expand"></i>`;
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
            });
        }

        const selectWorkspace = document.getElementById("select-workspace");
        if (selectWorkspace) {
            selectWorkspace.addEventListener("change", (e) => {
                const ws = e.target.value;
                this.applyWorkspace(ws);
            });
        }

        // Inicializa os divisores de tela ajustáveis (Splitters) do layout principal
        const workspaceContainer = document.querySelector(".workspace");
        if (workspaceContainer) {
            // 1. Sidebar Esquerda <-> Center Stage (Horizontal, ajusta largura em pixels da Sidebar)
            SplitterHelper.initSplitter(workspaceContainer, "#sidebar-left", ".center-stage", {
                direction: "horizontal",
                resizeTarget: "left",
                unit: "px",
                minVal: 200,
                maxVal: 600,
                defaultVal: 350,
                className: "splitter-sidebar-left"
            });

            // 2. Center Stage <-> Sidebar Direita (Horizontal, ajusta largura em pixels da Sidebar)
            SplitterHelper.initSplitter(workspaceContainer, ".center-stage", "#sidebar-right", {
                direction: "horizontal",
                resizeTarget: "right",
                unit: "px",
                minVal: 250,
                maxVal: 600,
                defaultVal: 350,
                className: "splitter-sidebar-right"
            });
        }

        const centerStage = document.querySelector(".center-stage");
        if (centerStage) {
            // 3. Monitors Container <-> Timeline Panel (Vertical, ajusta altura em pixels da Timeline)
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

        const monitorsContainer = document.querySelector(".monitors-container");
        if (monitorsContainer) {
            // 4. Source Player <-> Program Player (Horizontal, ajusta proporcionalmente em %)
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

        this.initMaximizeButtons();
        this.initSidebarObservers();
    }

    applyWorkspace(ws) {
        console.log(`[WorkspaceManager] Aplicando Workspace Preset: ${ws}`);
        
        // 1. Restaura todas as janelas primeiro para ter base limpa
        const activePopouts = { ...window.popoutWindows };
        for (const panelId in activePopouts) {
            if (activePopouts[panelId] && !activePopouts[panelId].closed) {
                activePopouts[panelId].close();
            }
            this.restorePanel(panelId);
        }

        // Trocar de preset sempre sai do modo Montagem (reativado abaixo se aplicável)
        if (ws !== "montagem") this.setMontagem(false);

        if (ws === "montagem") {
            const left = document.getElementById("sidebar-left");
            if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left").click();
            const timeline = document.getElementById("timeline-panel");
            if (timeline && timeline.classList.contains("collapsed")) {
                const reopen = document.getElementById("reopen-timeline");
                if (reopen) reopen.click();
            }
            this.setMontagem(true);
        }
        else if (ws === "default") {
            // Workspace Padrão: Tudo na janela principal
            const left = document.getElementById("sidebar-left");
            const right = document.getElementById("sidebar-right");
            if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left").click();
            if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right").click();
            
            const sourcePanel = document.getElementById("source-player-panel");
            if (sourcePanel && sourcePanel.classList.contains("maximized")) {
                document.getElementById("btn-expand-source").click();
            }
            const programPanel = document.getElementById("program-player-panel");
            if (programPanel && programPanel.classList.contains("maximized")) {
                document.getElementById("btn-expand-program").click();
            }
        } 
        else if (ws === "decupagem") {
            // Workspace Decupagem: Foco no source player maximizado
            const sourcePanel = document.getElementById("source-player-panel");
            if (sourcePanel && !sourcePanel.classList.contains("maximized")) {
                document.getElementById("btn-expand-source").click();
            }
            const left = document.getElementById("sidebar-left");
            if (left && left.classList.contains("collapsed")) document.getElementById("toggle-left").click();
            const right = document.getElementById("sidebar-right");
            if (right && right.classList.contains("collapsed")) document.getElementById("toggle-right").click();
        }
        else if (ws === "multitela") {
            // Workspace Multi-Tela: Destaca a Timeline e o Player de Programa em outras abas
            alert("Workspace Multi-Tela: O sistema irá destacar a Linha do Tempo e o Player de Programa. Por favor, confirme a abertura das novas janelas e arraste-as para o segundo monitor físico.");
            
            // Destaca a timeline
            setTimeout(() => this.togglePopout("timeline-panel"), 100);
            // Destaca o player de programa
            setTimeout(() => this.togglePopout("program-player-panel"), 500);
        }
    }

    togglePopout(panelId) {
        if (window.popoutWindows[panelId] && !window.popoutWindows[panelId].closed) {
            // Se já está aberto, fecha o popout (restaurando localmente)
            window.popoutWindows[panelId].close();
            this.restorePanel(panelId);
        } else {
            // Abre nova janela popout leve
            const width = panelId.includes("player") ? 640 : 800;
            const height = panelId.includes("player") ? 480 : 600;
            
            const popup = window.open(
                `panel.html?panel=${panelId}`,
                `popout-${panelId}`,
                `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`
            );
            
            if (popup) {
                window.popoutWindows[panelId] = popup;
            } else {
                alert("Bloqueador de popups detectado! Por favor, autorize popups para este site para poder destacar painéis em outros monitores.");
            }
        }
    }

    handleMessage(e) {
        const data = e.data;
        
        if (data.type === "POPOUT_READY") {
            const panelId = data.panel;
            console.log(`[WorkspaceManager] Pop-out pronto: ${panelId}`);
            
            const localPanel = document.getElementById(panelId);
            if (localPanel) {
                this.poppedElements[panelId] = localPanel;
                this.originalParents[panelId] = localPanel.parentNode;
                this.originalNextSiblings[panelId] = localPanel.nextSibling;
                
                const win = window.popoutWindows[panelId];
                if (win) {
                    const container = win.document.getElementById("panel-container");
                    if (container) {
                        container.innerHTML = ""; // Limpa loader
                        win.document.adoptNode(localPanel);
                        container.appendChild(localPanel);
                        localPanel.classList.remove("popped-out-hidden");
                        
                        // Oculta o botão de pop-out para evitar redundância na janela destacada
                        const popBtn = localPanel.querySelector('[id*="popout"]');
                        if (popBtn) popBtn.style.display = "none";
                    }
                    
                    // Escuta atalhos de teclado no popout e redireciona para o player principal
                    win.addEventListener("keydown", (e) => {
                        console.log(`[WorkspaceManager] Tecla pressionada no popout ${panelId}:`, e.code);
                        const activeTag = win.document.activeElement.tagName.toLowerCase();
                        if (activeTag === "input" || activeTag === "textarea") return;
                        
                        if (window.player && typeof window.player.handleGlobalKeyboard === "function") {
                            window.player.handleGlobalKeyboard(e);
                        }
                    });
                }
                
                if (panelId === "timeline-panel") {
                    this.syncTimelineCanvasToPopout();
                }
            }
        }
        else if (data.type === "POPOUT_CLOSED") {
            this.restorePanel(data.panel);
        }
    }

    restorePanel(panelId) {
        console.log(`[WorkspaceManager] Restaurando painel localmente: ${panelId}`);
        const localPanel = this.poppedElements[panelId];
        const parent = this.originalParents[panelId];
        
        if (localPanel && parent) {
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

            const sibling = this.originalNextSiblings[panelId];
            document.adoptNode(localPanel);
            if (sibling && sibling.parentNode === parent) {
                parent.insertBefore(localPanel, sibling);
            } else {
                parent.appendChild(localPanel);
            }
            localPanel.classList.remove("popped-out-hidden");
            
            // Restaura a exibição do botão de pop-out
            const popBtn = localPanel.querySelector('[id*="popout"]');
            if (popBtn) popBtn.style.display = "";
        }
        
        if (window.popoutWindows[panelId]) {
            delete window.popoutWindows[panelId];
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

    /**
     * Ativa/desativa o modo "Montagem": biblioteca maximizada no topo + timeline
     * ancorada em largura total na base, com mini-monitores flutuantes.
     * Reusa o mesmo #timeline-panel/#timeline-canvas (renderer intacto); só re-dimensiona.
     */
    setMontagem(on) {
        const sidebarLeft = document.getElementById("sidebar-left");
        const btnMaxLib = document.getElementById("btn-maximize-library");
        document.body.classList.toggle("montagem", on);
        if (sidebarLeft) sidebarLeft.classList.toggle("sidebar-maximized", on);
        if (btnMaxLib) {
            btnMaxLib.innerHTML = on
                ? `<i class="fa-solid fa-compress"></i>`
                : `<i class="fa-solid fa-expand"></i>`;
            btnMaxLib.title = on ? "Sair do modo Montagem" : "Modo Montagem (timeline ancorada)";
        }
        this.ensureMontagemMonitorToggle(on);
        // A timeline dock reusa o mesmo canvas: basta recalcular tamanho no próximo frame
        setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
    }

    /** Cria/exibe o botão flutuante que alterna os mini-monitores no modo Montagem. */
    ensureMontagemMonitorToggle(on) {
        let btn = document.getElementById("btn-montagem-monitors");
        if (on) {
            if (!btn) {
                btn = document.createElement("button");
                btn.id = "btn-montagem-monitors";
                btn.title = "Mostrar/ocultar monitores (Source/Program)";
                btn.innerHTML = `<i class="fa-solid fa-tv"></i>`;
                btn.addEventListener("click", () => {
                    document.body.classList.toggle("montagem-monitors-hidden");
                    window.dispatchEvent(new Event("resize"));
                });
                document.body.appendChild(btn);
            }
            btn.style.display = "flex";
        } else if (btn) {
            btn.style.display = "none";
            document.body.classList.remove("montagem-monitors-hidden");
        }
    }

    initMaximizeButtons() {
        const btnMaxLib = document.getElementById("btn-maximize-library");
        const sidebarLeft = document.getElementById("sidebar-left");
        if (btnMaxLib && sidebarLeft) {
            btnMaxLib.addEventListener("click", (e) => {
                e.stopPropagation();
                // Maximizar a biblioteca entra/sai do modo Montagem (timeline ancorada)
                this.setMontagem(!document.body.classList.contains("montagem"));
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
        const defaultVal = options.defaultVal || (unit === "%" ? (options.defaultPct || 50) : 350);
        const className = options.className || "";

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
                const containerRect = container.getBoundingClientRect();

                if (unit === "px") {
                    let val;
                    if (direction === "horizontal") {
                        if (resizeTarget === "left") {
                            val = moveEvent.clientX - containerRect.left;
                        } else {
                            val = containerRect.right - moveEvent.clientX;
                        }
                        if (val < minVal) val = minVal;
                        if (val > maxVal) val = maxVal;
                        
                        const targetEl = resizeTarget === "left" ? leftEl : rightEl;
                        targetEl.style.width = `${val}px`;
                        targetEl.style.flex = `0 0 ${val}px`;
                    } else {
                        // vertical px
                        if (resizeTarget === "left") {
                            val = moveEvent.clientY - containerRect.top;
                        } else {
                            val = containerRect.bottom - moveEvent.clientY;
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
                        const offsetX = moveEvent.clientX - containerRect.left;
                        let pct = (offsetX / containerRect.width) * 100;
                        if (pct < minVal) pct = minVal;
                        if (pct > maxVal) pct = maxVal;

                        leftEl.style.flex = `0 0 ${pct}%`;
                    } else {
                        const offsetY = moveEvent.clientY - containerRect.top;
                        let pct = (offsetY / containerRect.height) * 100;
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
                
                // Dispara resize final para garantir sincronia
                window.dispatchEvent(new Event("resize"));
            };

            container.ownerDocument.addEventListener("mousemove", handleMouseMove);
            container.ownerDocument.addEventListener("mouseup", handleMouseUp);
        });
    }
}
