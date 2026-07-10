import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";

let isAutosaveSuspended = false;
let autosaveTimeout = null;

/**
 * Dispara o processo de salvamento automático com debounce de 1 segundo.
 */
export function triggerAutosave() {
    if (isAutosaveSuspended) return;
    
    if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
    }
    
    autosaveTimeout = setTimeout(() => {
        performAutosave();
    }, 1000);
}

/**
 * Salva o estado atual da timeline e histórico de ações no localStorage.
 */
function performAutosave() {
    const projectId = STATE.currentProjectId;
    if (!projectId) return;

    try {
        const data = {
            cuts: STATE.activeTimelineCuts,
            tracks: TIMELINE_STATE.tracks,
            ghosts: TIMELINE_STATE.ghostTrack,
            playheadFrame: TIMELINE_STATE.playheadFrame,
            zoom: TIMELINE_STATE.zoom,
            scrollLeftFrame: TIMELINE_STATE.scrollLeftFrame,
            scrollTop: TIMELINE_STATE.scrollTop,
            selectedClipId: TIMELINE_STATE.selectedClipId,
            selectedTrack: TIMELINE_STATE.selectedTrack,
            undoStack: TIMELINE_HISTORY.undoStack,
            redoStack: TIMELINE_HISTORY.redoStack
        };
        
        localStorage.setItem(`capiau_timeline_autosave_${projectId}`, JSON.stringify(data));
        
        // Dispara um log do sistema
        if (window.logManager) {
            window.logManager.log("Autosave", `Estado e histórico salvos localmente para o projeto ${projectId}.`, "INFO");
        } else {
            console.log(`[Autosave] Estado e histórico salvos localmente para o projeto ${projectId}.`);
        }
    } catch (e) {
        console.error("[Autosave] Erro ao salvar no localStorage:", e);
        if (window.logManager) {
            window.logManager.log("Autosave", `Erro ao salvar no localStorage: ${e.message}`, "ERROR");
        }
    }
}

/**
 * Restaura o estado salvo da timeline e do histórico para o projeto atual.
 * @param {number} projectId 
 */
export function restoreAutosave(projectId) {
    if (!projectId) return;
    
    const raw = localStorage.getItem(`capiau_timeline_autosave_${projectId}`);
    if (!raw) {
        if (window.logManager) {
            window.logManager.log("Autosave", `Nenhum backup encontrado para o projeto ${projectId}.`, "INFO");
        } else {
            console.log(`[Autosave] Nenhum backup encontrado para o projeto ${projectId}.`);
        }
        
        // Limpa o histórico e ghost clips para evitar vazamento entre projetos
        isAutosaveSuspended = true;
        TIMELINE_HISTORY.clear();
        TIMELINE_STATE.ghostTrack = [];
        STATE.emit("timelineGhostUpdated", []);
        isAutosaveSuspended = false;
        return;
    }

    try {
        const data = JSON.parse(raw);
        if (window.logManager) {
            window.logManager.log("Autosave", `Carregando backup do projeto ${projectId} do localStorage...`, "INFO");
        } else {
            console.log(`[Autosave] Carregando backup do projeto ${projectId}...`);
        }

        isAutosaveSuspended = true;

        // 1. Restaura pistas
        if (data.tracks) {
            TIMELINE_STATE.setTracks(data.tracks);
        }
        
        // 2. Restaura cortes
        STATE.activeTimelineCuts = data.cuts || [];

        // 3. Restaura clipes fantasma (IA)
        if (data.ghosts) {
            TIMELINE_STATE.ghostTrack = data.ghosts;
            STATE.emit("timelineGhostUpdated", TIMELINE_STATE.ghostTrack);
        }

        // 4. Restaura preferências de visualização (zoom, scrolls, playhead)
        if (data.zoom !== undefined) TIMELINE_STATE.setZoom(data.zoom);
        if (data.scrollLeftFrame !== undefined) TIMELINE_STATE.setScrollLeftFrame(data.scrollLeftFrame);
        if (data.scrollTop !== undefined) TIMELINE_STATE.setScrollTop(data.scrollTop);
        if (data.playheadFrame !== undefined) TIMELINE_STATE.setPlayheadFrame(data.playheadFrame);
        if (data.selectedClipId !== undefined) TIMELINE_STATE.selectedClipId = data.selectedClipId;
        if (data.selectedTrack !== undefined) TIMELINE_STATE.selectedTrack = data.selectedTrack;

        // 5. Restaura pilha de histórico
        if (data.undoStack) TIMELINE_HISTORY.undoStack = data.undoStack;
        if (data.redoStack) TIMELINE_HISTORY.redoStack = data.redoStack;
        
        // Atualiza botões da interface (canUndo/canRedo)
        TIMELINE_HISTORY._notify();

        // Redesenha timeline
        if (window.workspaceManager && window.workspaceManager.timelinePanel) {
            window.workspaceManager.timelinePanel.renderTimeline();
        }

        setTimeout(() => {
            isAutosaveSuspended = false;
            if (window.logManager) {
                window.logManager.log("Autosave", `Projeto ${projectId} restaurado com sucesso.`, "INFO");
            } else {
                console.log(`[Autosave] Projeto ${projectId} restaurado com sucesso.`);
            }
        }, 150);

    } catch (e) {
        isAutosaveSuspended = false;
        console.error("[Autosave] Falha ao restaurar autosave:", e);
        if (window.logManager) {
            window.logManager.log("Autosave", `Falha ao restaurar autosave: ${e.message}`, "ERROR");
        }
    }
}

/**
 * Inicializa a escuta de eventos para o auto-salvamento.
 */
export function initAutosave() {
    // Escuta mudança de projeto com atraso para garantir que os resets de interface rodem primeiro
    STATE.on("projectChanged", (projectId) => {
        isAutosaveSuspended = true;
        if (autosaveTimeout) {
            clearTimeout(autosaveTimeout);
            autosaveTimeout = null;
        }
        setTimeout(() => {
            restoreAutosave(projectId);
        }, 100);
    });

    // Escuta mudanças que devem disparar salvamento automático
    const events = [
        "timelineCutsUpdated",
        "timelineTracksChanged",
        "timelineGhostUpdated",
        "timelineHistoryChanged",
        "timelinePlayheadChanged",
        "timelineZoomChanged",
        "timelineScrollChanged",
        "timelineVScrollChanged"
    ];

    events.forEach(event => {
        STATE.on(event, () => {
            triggerAutosave();
        });
    });
}
