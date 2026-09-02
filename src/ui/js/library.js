// Gerenciador visual da Biblioteca de Mídias, árvore de pastas e lightbox de fotos.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";
import { parseQuery, evaluateAST, getAvailableSuggestions } from "./searchParser.js";

// Armazena o estado das pastas expandidas/recolhidas (persistido por projeto)
const openFoldersSet = new Set();
let _openFoldersLoadedFor = null;
let _saveOpenFoldersTimer = null;

// Timer global para debounce de clique simples na biblioteca (evita disparar Source ao dar duplo clique)
let _librarySingleClickTimer = null;

function loadOpenFoldersState(projectId) {
    if (_openFoldersLoadedFor === projectId) return;
    _openFoldersLoadedFor = projectId;
    openFoldersSet.clear();
    try {
        const raw = JSON.parse(localStorage.getItem(`capiau_open_folders_${projectId}`) || "[]");
        if (Array.isArray(raw)) raw.forEach(pth => openFoldersSet.add(pth));
    } catch (e) {
        console.warn("Estado de pastas abertas ilegivel, comecando vazio:", e);
    }
}

/** Grava em lote: alternar pastas dispara isso a cada clique. */
function saveOpenFoldersState() {
    if (_saveOpenFoldersTimer) clearTimeout(_saveOpenFoldersTimer);
    _saveOpenFoldersTimer = setTimeout(() => {
        _saveOpenFoldersTimer = null;
        const projectId = _openFoldersLoadedFor ?? getActiveProjectId();
        try {
            localStorage.setItem(`capiau_open_folders_${projectId}`, JSON.stringify(Array.from(openFoldersSet)));
        } catch (e) {
            console.error("Erro ao salvar pastas abertas:", e);
        }
    }, 250);
}

// Preferências de exibição de títulos de clipes
if (!window.titleDisplayPreferences) {
    try {
        window.titleDisplayPreferences = JSON.parse(localStorage.getItem("titleDisplayPreferences") || "{}");
    } catch(e) {
        window.titleDisplayPreferences = {};
    }
}

// Preferências de metadados no tooltip de decupagem
if (!window.tooltipDisplayPreferences) {
    try {
        window.tooltipDisplayPreferences = JSON.parse(localStorage.getItem("tooltipDisplayPreferences") || "{}");
    } catch(e) {
        window.tooltipDisplayPreferences = {};
    }
}

export function getActiveProjectId() {
    return window.STATE?.currentProjectId || window.STATE?.currentProject?.id || Number(localStorage.getItem("activeProjectId")) || 2;
}

// ── ESTADO DOS BINS VIRTUAIS & CUSTOMIZAÇÃO DE PASTAS ───────────────
export let virtualFolderMap = {}; // itemId -> virtualFolderPath (ex: "root/Entrevistas")
export let virtualEmptyFolders = new Set(); // Set de folderPaths de subpastas vazias
export let virtualFolderColors = {}; // folderPath -> hex/css cor
export let virtualDeletedFolders = new Set(); // Set de folderPaths removidos da biblioteca
export const libraryUndoStack = []; // Pilha de histórico de ações para Ctrl+Z

export function loadVirtualFoldersState(projectId = null) {
    if (!projectId) projectId = getActiveProjectId();
    try {
        virtualFolderMap = JSON.parse(localStorage.getItem(`capiau_virtual_folders_${projectId}`) || "{}");
        virtualEmptyFolders = new Set(JSON.parse(localStorage.getItem(`capiau_empty_folders_${projectId}`) || "[]"));
        virtualFolderColors = JSON.parse(localStorage.getItem(`capiau_folder_colors_${projectId}`) || "{}");
        virtualDeletedFolders = new Set(JSON.parse(localStorage.getItem(`capiau_deleted_folders_${projectId}`) || "[]"));
    } catch (e) {
        console.error("Erro ao carregar estado de bins virtuais:", e);
    }
}

export function saveVirtualFoldersState(projectId = null) {
    if (!projectId) projectId = getActiveProjectId();
    try {
        localStorage.setItem(`capiau_virtual_folders_${projectId}`, JSON.stringify(virtualFolderMap));
        localStorage.setItem(`capiau_empty_folders_${projectId}`, JSON.stringify(Array.from(virtualEmptyFolders)));
        localStorage.setItem(`capiau_folder_colors_${projectId}`, JSON.stringify(virtualFolderColors));
        localStorage.setItem(`capiau_deleted_folders_${projectId}`, JSON.stringify(Array.from(virtualDeletedFolders)));
    } catch (e) {
        console.error("Erro ao salvar estado de bins virtuais:", e);
    }
}

/**
 * Uma pasta removida leva junto tudo que esta abaixo dela. Antes so o caminho
 * exato era testado: ao excluir "root/D:", o bin filho "root/D:/makinof-monstro"
 * recriava o "D:" como no intermediario e a pasta reaparecia.
 */
export function isPathDeleted(path) {
    if (!path || virtualDeletedFolders.size === 0) return false;
    if (virtualDeletedFolders.has(path)) return true;
    for (const deleted of virtualDeletedFolders) {
        if (path.startsWith(deleted + "/")) return true;
    }
    return false;
}

export function handleLibraryUndo() {
    if (libraryUndoStack.length === 0) return false;
    const action = libraryUndoStack.pop();
    const projectId = getActiveProjectId();

    if (action.type === "delete_folder") {
        virtualDeletedFolders = action.previousDeletedFolders;
        virtualEmptyFolders = action.previousEmptyFolders;
        virtualFolderMap = action.previousFolderMap;
        virtualFolderColors = action.previousFolderColors;
        saveVirtualFoldersState(projectId);

        // Recria no banco os bins que a exclusão apagou. As mídias que estavam
        // dentro foram movidas para a pasta-mãe e continuam lá.
        const recriar = async () => {
            for (const b of (action.binsRemovidos || [])) {
                try {
                    await CapIAuAPI.createProjectBin(projectId, b.name, b.path, b.parent_path, b.color);
                } catch (err) {
                    console.error("Falha ao restaurar o bin " + b.path + ":", err);
                }
            }
            if (window.libraryInstance) await window.libraryInstance.reloadData();
        };
        recriar();

        if (typeof window.showToast === "function") {
            window.showToast(`Pasta "${action.folderName}" restaurada à biblioteca!`, "success");
        }
        return true;
    }
    return false;
}
window.handleLibraryUndo = handleLibraryUndo;

export function isAnyModalOpen(doc = document) {
    if (!doc) return false;
    const candidateModals = doc.querySelectorAll(`
        .modal-overlay,
        #modal-timeline-help,
        #modal-edit-marker,
        #timeline-alternatives-popup,
        #timeline-alternatives-backdrop,
        .face-inspector-overlay,
        #face-inspector-overlay,
        dialog[open]
    `);
    for (let i = 0; i < candidateModals.length; i++) {
        const el = candidateModals[i];
        if (el.classList.contains("active")) return true;
        const inlineDisplay = el.style.display;
        if (inlineDisplay && inlineDisplay !== "none") return true;
        const style = window.getComputedStyle(el);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
            return true;
        }
    }
    if (window.FaceManager && window.FaceManager.inspectorCard) {
        return true;
    }
    return false;
}
if (typeof window !== "undefined") {
    window.isAnyModalOpen = isAnyModalOpen;
}

export function cleanTitle(text) {
    if (!text) return "";
    let clean = text.trim();
    
    // Lista de prefixos/introduções comuns gerados por IA para remover
    const prefixos = [
        // Frases longas de abertura descritiva
        /^(este\s+clipe\s+oferece\s+uma\s+visão\s+detalhada\s+(do|da|de|dos|das)?|oferece\s+uma\s+visão\s+detalhada\s+(do|da|de|dos|das)?|este\s+clipe\s+oferece|este\s+clipe|visão\s+detalhada\s+(do|da|de)?)\s*/i,
        /^(que\s+captura\s+o\s+ambiente\s+de\s+produção\s+nos\s+bastidores|que\s+captura\s+o\s+ambiente\s+de\s+produção|que\s+captura\s+o\s+ambiente|que\s+captura|que\s+mostra|que\s+destaca)\s*/i,
        /^(técnica\s+valiosa\s+para\s+edição,\s*mostrando\s+(o|a|os|as)?|técnica\s+valiosa\s+para\s+edição|técnica\s+valiosa)\s*/i,
        /^(visual\s+abstrato\s+útil\s+para\s+transições\s+ou\s+como\s+plano|visual\s+abstrato\s+útil\s+para\s+transições|visual\s+abstrato\s+útil|visual\s+abstrato)\s*/i,
        /^(documentar\s+a\s+dinâmica\s+entre|documentar\s+a|documentar\s+o|documentar)\s*/i,
        // Adjetivos ou qualificadores complexos iniciais
        /^(valiosa|valioso|útil|importante|versátil|interessante|dinâmica|dinâmico|visualmente\s+rica|visualmente\s+rico|intimista\s+e\s+tranquila|intimista\s+e\s+tranquilo|rica\s+e\s+diversificada|rico\s+e\s+diversificado|excelente|ótima|ótimo)\s*(para\s+mostrar|para\s+documentários|para\s+transições|para|que\s+capture|que\s+destaca|que\s+mostra|que)?\s*/i,
        // Nomes de tipo de clipe e conectivos
        /^(sequência\s+íntima\s+e\s+esteticamente\s+rica\s+que\s+captura|sequência\s+útil\s+para|sequência|clipe|material|trecho|registro|vídeo|cena|aéreos|detalhes|imagens|take|plano|gravação)\s*(que\s+destacam|que\s+mostram|que\s+captura|de\s+bastidores|útil|valioso|importante|interessante|para|mostrando|de|com|do|da|em)?\s*/i,
        // Verbos de ação no infinitivo/gerúndio no início
        /^(mostrar|exibir|capturar|apresentar|destacar|revelar|retratar|registrar|focar\s+em|focar|trazer|capturando|mostrando|registrando|focando|apresentando|destacando|revelando|retratando)\s+(a|o|os|as|um|uma)?\s*/i,
        // Conectivos iniciais de "A.", "O.", "A", "O", "Uma", "Um"
        /^(a\.|o\.|um\.|uma\.|a\s+|o\s+|um\s+|uma\s+)/i
    ];
    
    let changed = true;
    while (changed) {
        changed = false;
        for (const regex of prefixos) {
            const newClean = clean.replace(regex, "").trim();
            if (newClean !== clean) {
                clean = newClean;
                changed = true;
            }
        }
    }
    
    // Remove pontuações/vírgulas órfãs no início
    clean = clean.replace(/^[\s,\.\-]+/, "").trim();
    
    // Capitaliza primeira letra
    if (clean) {
        clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    }
    
    return clean;
}

export const CATEGORY_LABELS = {
    obra: "Obra",
    processo: "Making of",
    depoimento: "Depoimento",
    cotidiano: "Cotidiano",
    evento: "Evento",
    tecnico: "Técnico",
    arquivo: "Arquivo",
    pessoal: "Pessoal",
    documento: "Documento"
};

export function getFriendlyTitle(v) {
    // Se o usuário optou por forçar nome do arquivo real para este clipe
    const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[v.id] === "filename";
    if (forceRealFilename) return v.filename;

    // Título curto gerado pela triagem/sumário da IA tem prioridade
    if (v.title && v.title.trim()) return v.title.trim();

    if (v.video_type === "interview") {
        let name = "";
        if (v.description && v.description.includes("Entrevista com")) {
            const match = v.description.match(/Entrevista com\s+([^,\-\n]+)/i);
            if (match) name = match[1].trim();
        }
        if (!name && v.summary) {
            const match = v.summary.match(/Entrevistado:\s*([^,\-\n\.]+)/i);
            if (match) name = match[1].trim();
        }
        if (!name && v.tags) {
            try {
                const parsed = typeof v.tags === "string" ? JSON.parse(v.tags) : v.tags;
                const speakerTag = parsed.find(t => t.startsWith("Speaker:") || t.startsWith("Person:"));
                if (speakerTag) name = speakerTag.split(":")[1].trim();
            } catch(e) {}
        }
        if (!name) name = "Entrevista";

        let speech = "";
        if (v.summary) {
            speech = v.summary.replace(/Resumo:|Entrevista:/i, "").trim();
        } else if (v.description) {
            speech = v.description.trim();
        }
        
        speech = cleanTitle(speech);
        
        if (speech) {
            return `${name} - "${speech}"`;
        }
        return `${name} (${v.filename})`;
    } else if (v.video_type === "broll") {
        let desc = v.summary || v.description;
        desc = cleanTitle(desc);
        if (desc) {
            return desc;
        }
        return `Bastidores - ${v.filename}`;
    }
    return v.filename;
}

export function buildMediaTooltip(item, kind = "video", forceRealFilename = false) {
    if (!item) return "Sem decupagem";
    const prefs = window.tooltipDisplayPreferences || {};
    const friendly = getFriendlyTitle(item);
    const filename = item.filename || "";
    const filepath = item.filepath || "";
    const desc = (item.description || item.summary || "").trim();
    
    let parts = [];
    
    // 1. Título principal no topo
    const mainTitle = forceRealFilename ? filename : (friendly || filename);
    if (mainTitle) parts.push(mainTitle);

    // 2. Caminho real no disco (opcional — o tooltip vai para o atributo
    //    data-tooltip de cada card, entao tudo aqui pesa na arvore inteira)
    if (prefs.filepath !== false && filepath) {
        parts.push(`📁 Disco: ${filepath}`);
    }
    
    // 3. Metadados opcionais configuráveis
    let metaItems = [];
    
    if (prefs.category !== false && item.category) {
        const catLabel = CATEGORY_LABELS[item.category] || item.category;
        metaItems.push(`Categoria: ${catLabel}`);
    }

    if (prefs.recordedAt !== false && item.recorded_at) {
        metaItems.push(`Data: ${item.recorded_at}`);
    }

    if (item.virtual_folder && item.virtual_folder !== "root") {
        metaItems.push(`Bin: ${item.virtual_folder.replace(/^root\/?/, "")}`);
    }
    
    if (prefs.duration !== false && item.duration) {
        metaItems.push(`Duração: ${formatTimecode(item.duration).substring(3, 11)}`);
    }
    
    if (prefs.speaker !== false && kind === "video") {
        let speaker = "";
        if (item.summary) {
            const m = item.summary.match(/Entrevistado:\s*([^,\-\n\.]+)/i);
            if (m) speaker = m[1].trim();
        }
        if (!speaker && item.description && item.description.includes("Entrevista com")) {
            const m = item.description.match(/Entrevista com\s+([^,\-\n]+)/i);
            if (m) speaker = m[1].trim();
        }
        if (!speaker && item.tags) {
            try {
                const parsed = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
                if (Array.isArray(parsed)) {
                    const sTag = parsed.find(t => t.startsWith("Speaker:") || t.startsWith("Person:"));
                    if (sTag) speaker = sTag.split(":")[1].trim();
                }
            } catch(e) {}
        }
        if (speaker) {
            metaItems.push(`Falante: ${speaker}`);
        }
    }
    
    if (prefs.tags !== false && item.tags) {
        try {
            const parsed = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
            if (Array.isArray(parsed) && parsed.length > 0) {
                const tagList = parsed.filter(t => !t.startsWith("Speaker:") && !t.startsWith("Person:"));
                if (tagList.length > 0) {
                    metaItems.push(`Tags: ${tagList.slice(0, 6).join(", ")}`);
                }
            }
        } catch(e) {}
    }
    
    if (metaItems.length > 0) {
        parts.push(metaItems.join(" • "));
    }
    
    // 4. Sinopse / Descrição da decupagem
    if (desc) {
        if (desc !== mainTitle && !desc.startsWith(mainTitle)) {
            parts.push(desc);
        }
    }
    
    parts.push("⚡ 2x Clique: Na agulha | Shift: Final | Ctrl: 1º Gap | Alt: Empurrar");

    if (parts.length === 0) return "Sem decupagem";
    return parts.join("\n\n");
}

export function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function updateZoomTier(listEl, zoomVal) {
    if (!listEl) return;
    listEl.classList.remove("zoom-xs", "zoom-sm", "zoom-md", "zoom-lg", "zoom-xl");
    if (zoomVal < 55) {
        listEl.classList.add("zoom-xs");
    } else if (zoomVal < 90) {
        listEl.classList.add("zoom-sm");
    } else if (zoomVal < 140) {
        listEl.classList.add("zoom-md");
    } else if (zoomVal < 210) {
        listEl.classList.add("zoom-lg");
    } else {
        listEl.classList.add("zoom-xl");
    }
}

export function getAllLibraryDocuments() {
    const docs = [document];
    if (window.popoutWindows) {
        for (const name in window.popoutWindows) {
            const win = window.popoutWindows[name];
            if (win && !win.closed && win.document) {
                if (!docs.includes(win.document)) {
                    docs.push(win.document);
                }
            }
        }
    }
    return docs;
}
window.getAllLibraryDocuments = getAllLibraryDocuments;

export function getAllMediaLists() {
    const listSet = new Set();
    getAllLibraryDocuments().forEach(doc => {
        try {
            const elements = doc.querySelectorAll("#media-tree-list, #video-list, #photo-list, .library-tree-list");
            elements.forEach(el => listSet.add(el));
        } catch (e) {}
    });
    if (window.libraryInstance?.mediaTreeListEl && !listSet.has(window.libraryInstance.mediaTreeListEl)) {
        listSet.add(window.libraryInstance.mediaTreeListEl);
    }
    return Array.from(listSet);
}

export function getMediaRichContent(item, kind = "video", currentTitle = "") {
    if (!item) return { descHtml: "", speakerHtml: "", tagsHtml: "" };

    // 1. Descrição / Sinopse
    const desc = (item.description || item.summary || item.caption || "").trim();
    const showDesc = desc && desc !== currentTitle && !desc.startsWith(currentTitle);
    const descHtml = showDesc ? `<div class="media-desc-text" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>` : "";

    // 2. Falante / Personagem (para vídeos)
    let speaker = "";
    if (kind === "video") {
        if (item.summary) {
            const m = item.summary.match(/Entrevistado:\s*([^,\-\n\.]+)/i);
            if (m) speaker = m[1].trim();
        }
        if (!speaker && item.description && item.description.includes("Entrevista com")) {
            const m = item.description.match(/Entrevista com\s+([^,\-\n]+)/i);
            if (m) speaker = m[1].trim();
        }
        if (!speaker && item.tags) {
            try {
                const parsed = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
                if (Array.isArray(parsed)) {
                    const sTag = parsed.find(t => t.startsWith("Speaker:") || t.startsWith("Person:"));
                    if (sTag) speaker = sTag.split(":")[1].trim();
                }
            } catch(e) {}
        }
    }
    const speakerHtml = speaker ? `<span class="badge-speaker" data-tooltip="Falante: ${escapeHtml(speaker)}"><i class="fa-solid fa-user-tie"></i> ${escapeHtml(speaker)}</span>` : "";

    // 3. Tags Chips
    let tagsHtml = "";
    if (item.tags) {
        try {
            const parsed = typeof item.tags === "string" ? JSON.parse(item.tags) : item.tags;
            if (Array.isArray(parsed) && parsed.length > 0) {
                const chips = parsed
                    .filter(t => !speaker || !t.toLowerCase().includes(speaker.toLowerCase()))
                    .slice(0, 8)
                    .map(t => {
                        const isPerson = t.startsWith("Speaker:") || t.startsWith("Person:");
                        const tagLabel = isPerson ? t.split(":")[1].trim() : t;
                        const icon = isPerson ? '<i class="fa-solid fa-user" style="font-size:7.5px;"></i> ' : '';
                        return `<span class="media-tag-chip ${isPerson ? 'person' : ''}">${icon}${escapeHtml(tagLabel)}</span>`;
                    });
                if (chips.length > 0) {
                    tagsHtml = `<div class="media-tags-row">${chips.join("")}</div>`;
                }
            }
        } catch(e) {}
    }

    return { descHtml, speakerHtml, tagsHtml };
}

/**
 * Inicia a edição de título inline no card de mídia (in-loco).
 * Transforma temporariamente o span .clip-title-text em um input focado,
 * permitindo salvar via Enter ou cancelar via Esc/blur, sem poluir o DOM com tooltips nativas.
 */
export function startInlineTitleEditing(cardEl, item, kind = "video") {
    if (!cardEl) return;
    const h4 = cardEl.querySelector("h4");
    const titleSpan = cardEl.querySelector(".clip-title-text");
    if (!h4 || !titleSpan) return;

    // Se já estiver em modo de edição, apenas dá foco
    const existingInput = h4.querySelector(".nle-inline-rename-input");
    if (existingInput) {
        existingInput.focus();
        existingInput.select();
        return;
    }

    // Salva o tooltip original e remove temporariamente para não abrir tooltip flutuante ao digitar
    const savedTooltip = h4.getAttribute("data-tooltip") || "";
    h4.removeAttribute("data-tooltip");
    const globalTooltip = document.getElementById("global-tooltip");
    if (globalTooltip) {
        globalTooltip.style.display = "none";
    }

    const currentDisplayTitle = titleSpan.textContent.trim();
    const originalSpanDisplay = titleSpan.style.display;
    titleSpan.style.display = "none";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "nle-inline-rename-input";
    input.value = item.title || currentDisplayTitle;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");

    h4.appendChild(input);
    input.focus();
    input.select();

    let isDone = false;

    const cleanupAndRestore = (newTitleToDisplay) => {
        if (isDone) return;
        isDone = true;
        input.remove();
        titleSpan.style.display = originalSpanDisplay || "";
        if (newTitleToDisplay !== undefined) {
            titleSpan.textContent = newTitleToDisplay;
        }
        // Restaura tooltip rica atualizada
        const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[item.id] === "filename";
        const updatedTooltip = buildMediaTooltip(item, kind, forceRealFilename);
        h4.setAttribute("data-tooltip", updatedTooltip);
    };

    const saveTitle = async () => {
        const newTitle = input.value.trim();
        if (isDone) return;

        if (!newTitle || newTitle === item.title) {
            cleanupAndRestore(titleSpan.textContent);
            return;
        }

        try {
            input.disabled = true;
            input.style.opacity = "0.7";
            if (kind === "video") {
                await CapIAuAPI.updateVideoTitle(item.id, newTitle);
                item.title = newTitle;
                const inList = (STATE.allVideos || []).find(v => v.id === item.id);
                if (inList) inList.title = newTitle;
                if (STATE.activeVideo && STATE.activeVideo.id === item.id) {
                    STATE.activeVideo.title = newTitle;
                }
            } else {
                await CapIAuAPI.updatePhotoTitle(item.id, newTitle);
                item.title = newTitle;
                const inList = (STATE.allPhotos || []).find(p => p.id === item.id);
                if (inList) inList.title = newTitle;
                if (STATE.activePhoto && STATE.activePhoto.id === item.id) {
                    STATE.activePhoto.title = newTitle;
                }
            }
            cleanupAndRestore(newTitle);
            if (typeof window.showToast === "function") {
                window.showToast("Título atualizado com sucesso!", "success");
            }
        } catch (err) {
            console.error("Erro ao atualizar título:", err);
            if (typeof window.showToast === "function") {
                window.showToast("Erro ao salvar título: " + err.message, "error");
            } else {
                alert("Erro ao salvar título: " + err.message);
            }
            cleanupAndRestore(currentDisplayTitle);
        }
    };

    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            saveTitle();
        } else if (e.key === "Escape") {
            e.preventDefault();
            cleanupAndRestore(titleSpan.textContent);
        }
    });

    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("dblclick", (e) => e.stopPropagation());
    input.addEventListener("contextmenu", (e) => e.stopPropagation());

    input.addEventListener("blur", () => {
        if (!isDone) {
            saveTitle();
        }
    });
}
window.startInlineTitleEditing = startInlineTitleEditing;

/**
 * Exibe o Super-Menu de Contexto para cards de mídia (vídeo ou foto)
 * acionado pelo clique com o botão direito (contextmenu).
 */
export function showMediaContextMenu(e, item, kind, cardEl) {
    e.preventDefault();
    e.stopPropagation();

    const targetDoc = cardEl?.ownerDocument || document;
    const targetWin = targetDoc.defaultView || window;

    // Fecha qualquer menu de contexto aberto anteriormente e oculta tooltips de rolagem
    const oldMenus = targetDoc.querySelectorAll(".custom-context-menu");
    oldMenus.forEach(m => m.remove());

    const scrollTooltip = targetDoc.getElementById("library-scroll-index-tooltip");
    if (scrollTooltip) {
        scrollTooltip.classList.remove("visible", "expanded");
    }
    if (window.libraryScrollIndex) {
        window.libraryScrollIndex.hide();
    }

    const menu = targetDoc.createElement("div");
    menu.id = "custom-media-context-menu";
    menu.className = "custom-context-menu media-context-menu";

    const isVideo = kind === "video";
    const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[item.id] === "filename";

    // Item: Abrir no Player / Lightbox
    const openItem = document.createElement("div");
    openItem.className = "menu-item";
    openItem.innerHTML = `<i class="fa-solid ${isVideo ? 'fa-play' : 'fa-expand'}"></i><span class="menu-item-text">${isVideo ? 'Abrir no Monitor Source' : 'Abrir no Visualizador (Lightbox)'}</span>`;
    openItem.addEventListener("click", () => {
        menu.remove();
        if (isVideo) {
            STATE.activeVideo = item;
            window.activeFocusedPlayer = "source";
        } else {
            if (STATE.openPhotosInPlayer) {
                STATE.activePhoto = item;
            } else {
                const lib = window.libraryInstance || window.panelsManager?.library;
                STATE.currentPhotoList = STATE.allPhotos || [item];
                STATE.currentPhotoIndex = (STATE.currentPhotoList).indexOf(item);
                if (lib && typeof lib.openLightbox === 'function') {
                    lib.openLightbox(item);
                }
            }
        }
    });
    menu.appendChild(openItem);

    // Helper para extrair In/Out e executar a inserção
    const runMediaInsert = (mode) => {
        let inTime = 0.0;
        let outTime = isVideo ? (item.duration || 5.0) : 5.0;
        if (isVideo && STATE.activeVideo && STATE.activeVideo.id === item.id) {
            if (STATE.markerIn !== null && STATE.markerIn !== undefined) inTime = STATE.markerIn;
            if (STATE.markerOut !== null && STATE.markerOut !== undefined && STATE.markerOut > inTime) outTime = STATE.markerOut;
        }
        if (window.TIMELINE_STATE && typeof window.TIMELINE_STATE.insertMedia === "function") {
            window.TIMELINE_STATE.insertMedia({
                type: isVideo ? "video" : "photo",
                id: item.id,
                inSec: inTime,
                outSec: outTime,
                mode: mode
            });
        }
    };

    // Submenu: Adicionar à Timeline (com todas as formas de ingestão)
    const addTlMenuItem = document.createElement("div");
    addTlMenuItem.className = "menu-item menu-item-has-submenu";
    addTlMenuItem.innerHTML = `
        <i class="fa-solid fa-plus" style="color:var(--color-cyan);"></i>
        <span class="menu-item-text" style="font-weight:600;">Adicionar à Timeline</span>
        <i class="fa-solid fa-chevron-right menu-item-chevron"></i>
        <div class="menu-submenu" style="min-width: 290px;"></div>
    `;
    const addTlSubmenu = addTlMenuItem.querySelector(".menu-submenu");

    // Ações do Submenu
    const insertionOptions = [
        { mode: "playhead", icon: "fa-location-crosshairs", label: "Na Posição da Agulha (Playhead)", shortcut: "2x Clique" },
        { mode: "end", icon: "fa-forward-step", label: "No Final da Timeline (Append)", shortcut: "Shift + 2x Clique" },
        { mode: "first_gap", icon: "fa-arrows-to-dot", label: "No 1º Espaço Vazio (Primeiro Gap)", shortcut: "Ctrl + 2x Clique" },
        { mode: "next_gap", icon: "fa-forward", label: "No Próximo Espaço Vazio (Após Agulha)", shortcut: "Ctrl+Shift + 2x Clique" },
        { mode: "start", icon: "fa-backward-step", label: "No Início da Timeline (Frame 0)", shortcut: "Alt+Shift + 2x Clique" },
        { mode: "ripple", icon: "fa-arrows-left-right", label: "Inserir Empurrando (Ripple Insert)", shortcut: "Alt + 2x Clique" },
        { mode: "overlay", icon: "fa-layer-group", label: "Sobrepor em Pista Superior (Overlay)", shortcut: "Ctrl+Alt + 2x Clique" }
    ];

    if (window.TIMELINE_STATE?.selectedClipId) {
        insertionOptions.push({
            mode: "replace",
            icon: "fa-arrow-right-arrow-left",
            label: "Substituir Clipe Selecionado",
            shortcut: "Replace"
        });
    }

    insertionOptions.forEach(opt => {
        const subItem = document.createElement("div");
        subItem.className = "menu-item";
        subItem.innerHTML = `
            <i class="fa-solid ${opt.icon}"></i>
            <span class="menu-item-text">${opt.label}</span>
            <span class="menu-item-shortcut">${opt.shortcut}</span>
        `;
        subItem.addEventListener("click", (e) => {
            e.stopPropagation();
            menu.remove();
            runMediaInsert(opt.mode);
        });
        addTlSubmenu.appendChild(subItem);
    });

    // Clique direto no item-pai executa o modo padrão (playhead)
    addTlMenuItem.addEventListener("click", (e) => {
        if (e.target.closest(".menu-submenu")) return;
        menu.remove();
        runMediaInsert("playhead");
    });

    menu.appendChild(addTlMenuItem);

    // Ações de Ajustes em Lote para Cortes desta Mídia na Timeline
    const currentTimelineCuts = STATE.activeTimelineCuts || [];
    const mediaCutsOnTl = currentTimelineCuts.filter(c => (isVideo ? String(c.video_id) === String(item.id) : String(c.photo_id) === String(item.id)) && (window.TIMELINE_STATE ? window.TIMELINE_STATE.trackKindOf(c.track) !== "audio" : true));
    const totalMediaCutsOnTl = mediaCutsOnTl.length;

    if (totalMediaCutsOnTl > 0) {
        const adjustAllItem = document.createElement("div");
        adjustAllItem.className = "menu-item";
        adjustAllItem.innerHTML = `<i class="fa-solid fa-sliders" style="color:var(--color-cyan);"></i><span class="menu-item-text" style="font-weight:600; color:var(--color-cyan);">Ajustar Cortes na Timeline (${totalMediaCutsOnTl})</span>`;
        adjustAllItem.addEventListener("click", () => {
            menu.remove();
            const interaction = window.timelineInteraction || window.panelsManager?.timelineInteraction;
            if (interaction && window.TIMELINE_STATE && mediaCutsOnTl[0]) {
                interaction.syncMediaCutsMode = true;
                window.TIMELINE_STATE.selectClip(mediaCutsOnTl[0].id);
                interaction.showClipInspector(mediaCutsOnTl[0]);
                if (typeof window.showToast === "function") {
                    window.showToast(`Modo de edição sincronizada ativado para os ${totalMediaCutsOnTl} cortes de "${item.title || item.filename}".`, "info");
                }
            }
        });
        menu.appendChild(adjustAllItem);

        if (totalMediaCutsOnTl > 1) {
            const propAllItem = document.createElement("div");
            propAllItem.className = "menu-item";
            propAllItem.innerHTML = `<i class="fa-solid fa-clone" style="color:var(--color-violet, #c084fc);"></i><span class="menu-item-text">Propagar 1º corte p/ os demais (${totalMediaCutsOnTl})</span>`;
            propAllItem.addEventListener("click", () => {
                menu.remove();
                const interaction = window.timelineInteraction || window.panelsManager?.timelineInteraction;
                if (interaction && mediaCutsOnTl[0]) {
                    interaction.propagateAdjustmentsToAllMediaCuts(mediaCutsOnTl[0].id);
                }
            });
            menu.appendChild(propAllItem);
        }
    }

    // Separador
    const sep1 = document.createElement("div");
    sep1.className = "menu-separator";
    menu.appendChild(sep1);

    // Item: Renomear Título
    const renameItem = document.createElement("div");
    renameItem.className = "menu-item";
    renameItem.innerHTML = `<i class="fa-solid fa-pen-to-square"></i><span class="menu-item-text">Renomear Título</span>`;
    renameItem.addEventListener("click", () => {
        menu.remove();
        startInlineTitleEditing(cardEl, item, kind);
    });
    menu.appendChild(renameItem);

    // Item: Alternar Exibição de Nome
    const toggleTitleItem = document.createElement("div");
    toggleTitleItem.className = "menu-item";
    const toggleIcon = forceRealFilename ? "fa-file-signature" : "fa-font";
    const toggleText = forceRealFilename ? "Mostrar Título Contextual" : "Mostrar Nome do Arquivo Real";
    toggleTitleItem.innerHTML = `<i class="fa-solid ${toggleIcon}"></i><span class="menu-item-text">${toggleText}</span>`;
    toggleTitleItem.addEventListener("click", () => {
        menu.remove();
        if (!window.titleDisplayPreferences) window.titleDisplayPreferences = {};
        window.titleDisplayPreferences[item.id] = forceRealFilename ? "friendly" : "filename";
        localStorage.setItem("titleDisplayPreferences", JSON.stringify(window.titleDisplayPreferences));
        if (isVideo) {
            STATE.emit("videosUpdated", STATE.allVideos);
        } else {
            STATE.emit("photosUpdated", STATE.allPhotos);
        }
    });
    menu.appendChild(toggleTitleItem);

    // Item: Buscar Mídias Similares
    const similarItem = document.createElement("div");
    similarItem.className = "menu-item";
    similarItem.innerHTML = `<i class="fa-solid fa-images"></i><span class="menu-item-text">Buscar Mídias Similares</span>`;
    similarItem.addEventListener("click", () => {
        menu.remove();
        if (typeof window.showSimilarMedia === "function") {
            window.showSimilarMedia(kind, item.id, { label: item.title || item.filename });
        }
    });
    menu.appendChild(similarItem);

    // Item: Definir Frame Atual como Miniatura (Vídeo)
    if (isVideo) {
        const thumbItem = document.createElement("div");
        thumbItem.className = "menu-item";
        thumbItem.innerHTML = `<i class="fa-solid fa-camera"></i><span class="menu-item-text">Definir Frame Atual como Miniatura</span>`;
        thumbItem.addEventListener("click", () => {
            menu.remove();
            let curTime = 0.0;
            const sourceVideo = document.getElementById("source-video");
            if (sourceVideo && !isNaN(sourceVideo.currentTime)) {
                curTime = sourceVideo.currentTime;
            } else if (STATE.activeVideo && STATE.activeVideo.id === item.id && STATE.currentTime !== undefined) {
                curTime = STATE.currentTime;
            }
            if (typeof window.setVideoThumbnail === "function") {
                window.setVideoThumbnail(item.id, curTime);
            }
        });
        menu.appendChild(thumbItem);
    }

    // Item: Ver Metadados / Decupagem
    const inspectItem = document.createElement("div");
    inspectItem.className = "menu-item";
    inspectItem.innerHTML = `<i class="fa-solid fa-circle-info"></i><span class="menu-item-text">Ver Metadados / Decupagem</span>`;
    inspectItem.addEventListener("click", () => {
        menu.remove();
        if (isVideo) {
            STATE.activeVideo = item;
        } else {
            STATE.activePhoto = item;
        }
        if (window.libraryInstance && typeof window.libraryInstance.openQuickInspector === 'function') {
            window.libraryInstance.openQuickInspector(kind, item);
        } else if (window.panelsManager && typeof window.panelsManager.openInspector === 'function') {
            window.panelsManager.openInspector(item);
        }
    });
    menu.appendChild(inspectItem);

    // Separador
    const sep2 = document.createElement("div");
    sep2.className = "menu-separator";
    menu.appendChild(sep2);

    // Submenu de Camadas de IA & Decupagem Completa
    const aiLayersMenuItem = document.createElement("div");
    aiLayersMenuItem.className = "menu-item menu-item-has-submenu";
    aiLayersMenuItem.innerHTML = `
        <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--color-cyan);"></i>
        <span class="menu-item-text" style="font-weight:600;">Camadas de IA & Decupagem</span>
        <i class="fa-solid fa-chevron-right menu-item-chevron"></i>
        <div class="menu-submenu" style="min-width: 250px;"></div>
    `;
    const aiSubmenu = aiLayersMenuItem.querySelector(".menu-submenu");

    // Ação Principal: ⚡ Executar Todas as Camadas de IA
    const runAllItem = document.createElement("div");
    runAllItem.className = "menu-item";
    runAllItem.style.background = "rgba(6, 182, 212, 0.12)";
    runAllItem.style.borderBottom = "1px solid rgba(255, 255, 255, 0.08)";
    runAllItem.style.marginBottom = "4px";
    runAllItem.innerHTML = `
        <i class="fa-solid fa-bolt" style="color:var(--color-cyan);"></i>
        <span class="menu-item-text" style="color:var(--color-cyan); font-weight:600;">Executar Todas as Camadas de IA</span>
    `;
    runAllItem.addEventListener("click", async () => {
        menu.remove();
        try {
            if (isVideo) {
                await CapIAuAPI.analyzeVideoAll(item.id);
            } else {
                await CapIAuAPI.analyzePhotoAll(item.id);
            }
            if (typeof window.showToast === "function") {
                window.showToast(`Análise completa de IA iniciada para "${item.filename || 'mídia'}"!`, "success");
            }
            if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                window.openTasksDrawerAndSwitchTab();
            }
        } catch (err) {
            if (typeof window.showToast === "function") {
                window.showToast("Erro ao iniciar análise: " + err.message, "error");
            }
        }
    });
    aiSubmenu.appendChild(runAllItem);

    // Camada 4: Transcrição ASR (Vídeos)
    if (isVideo) {
        const isTranscribed = item.status === "transcribed" || (item.transcription && item.transcription.length > 0);
        const asrItem = document.createElement("div");
        asrItem.className = "menu-item";
        asrItem.innerHTML = `
            <i class="fa-solid fa-microphone-lines" style="color:${isTranscribed ? 'var(--color-emerald)' : 'var(--text-muted)'};"></i>
            <span class="menu-item-text">Camada 4: Transcrição ASR</span>
            <span class="ai-layer-badge ${isTranscribed ? 'done' : 'pending'}">${isTranscribed ? '<i class="fa-solid fa-check"></i> Feita' : 'Pendente'}</span>
        `;
        asrItem.addEventListener("click", async () => {
            menu.remove();
            try {
                await CapIAuAPI.transcribeVideo(item.id);
                if (typeof window.showToast === "function") window.showToast("Transcrição ASR iniciada!", "success");
                if (typeof window.openTasksDrawerAndSwitchTab === "function") window.openTasksDrawerAndSwitchTab();
            } catch (err) {
                if (typeof window.showToast === "function") window.showToast("Erro na transcrição: " + err.message, "error");
            }
        });
        aiSubmenu.appendChild(asrItem);
    }

    // Camada 5: Visão Multimodal (Vídeos e Fotos)
    const isVisionDone = Boolean(item.description || (item.tags && item.tags.length > 0) || item.status === "analyzed");
    const visionItem = document.createElement("div");
    visionItem.className = "menu-item";
    visionItem.innerHTML = `
        <i class="fa-solid fa-eye" style="color:${isVisionDone ? 'var(--color-emerald)' : 'var(--text-muted)'};"></i>
        <span class="menu-item-text">Camada 5: Visão Multimodal</span>
        <span class="ai-layer-badge ${isVisionDone ? 'done' : 'pending'}">${isVisionDone ? '<i class="fa-solid fa-check"></i> Feita' : 'Pendente'}</span>
    `;
    visionItem.addEventListener("click", async () => {
        menu.remove();
        try {
            if (isVideo) {
                await CapIAuAPI.analyzeVideoVision(item.id);
                if (typeof window.showToast === "function") window.showToast("Análise visual do vídeo iniciada!", "success");
            } else {
                await CapIAuAPI.analyzePhotoVision(item.id);
                if (typeof window.showToast === "function") window.showToast("Análise visual da foto concluída!", "success");
                if (window.libraryInstance) await window.libraryInstance.reloadData();
            }
            if (typeof window.openTasksDrawerAndSwitchTab === "function") window.openTasksDrawerAndSwitchTab();
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro na visão: " + err.message, "error");
        }
    });
    aiSubmenu.appendChild(visionItem);

    // Camada 6: Detecção Facial (InsightFace)
    const isFacesDone = Boolean(item.face_count > 0 || item.faces_detected > 0);
    const facesItem = document.createElement("div");
    facesItem.className = "menu-item";
    facesItem.innerHTML = `
        <i class="fa-solid fa-user-tag" style="color:${isFacesDone ? 'var(--color-emerald)' : 'var(--text-muted)'};"></i>
        <span class="menu-item-text">Camada 6: Detecção Facial</span>
        <span class="ai-layer-badge ${isFacesDone ? 'done' : 'pending'}">${isFacesDone ? '<i class="fa-solid fa-check"></i> Feita' : 'Pendente'}</span>
    `;
    facesItem.addEventListener("click", async () => {
        menu.remove();
        try {
            const projectId = getActiveProjectId();
            if (isVideo) {
                await CapIAuAPI.analyzeVideoAll(item.id);
            } else {
                await CapIAuAPI.request(`/api/faces/photo/${item.id}/detect?project_id=${projectId}&image_path=${encodeURIComponent(item.filepath || '')}`, { method: "POST" });
            }
            if (typeof window.showToast === "function") window.showToast("Detecção facial concluída!", "success");
            if (window.libraryInstance) await window.libraryInstance.reloadData();
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro na detecção facial: " + err.message, "error");
        }
    });
    aiSubmenu.appendChild(facesItem);

    // Camada 7: Indexação Vetorial (Qdrant)
    const isIndexDone = Boolean(item.status === "transcribed" || item.status === "analyzed" || isVisionDone);
    const indexItem = document.createElement("div");
    indexItem.className = "menu-item";
    indexItem.innerHTML = `
        <i class="fa-solid fa-database" style="color:${isIndexDone ? 'var(--color-emerald)' : 'var(--text-muted)'};"></i>
        <span class="menu-item-text">Camada 7: Indexação Vetorial</span>
        <span class="ai-layer-badge ${isIndexDone ? 'done' : 'pending'}">${isIndexDone ? '<i class="fa-solid fa-check"></i> Feita' : 'Pendente'}</span>
    `;
    indexItem.addEventListener("click", async () => {
        menu.remove();
        try {
            if (isVideo) {
                await CapIAuAPI.analyzeVideoVision(item.id);
            } else {
                await CapIAuAPI.analyzePhotoVision(item.id);
            }
            if (typeof window.showToast === "function") window.showToast("Indexação vetorial sincronizada no Qdrant!", "success");
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro na indexação: " + err.message, "error");
        }
    });
    aiSubmenu.appendChild(indexItem);

    menu.appendChild(aiLayersMenuItem);

    // Item: Alterar Categoria (com Submenu)
    const catMenuItem = document.createElement("div");
    catMenuItem.className = "menu-item menu-item-has-submenu";
    catMenuItem.innerHTML = `
        <i class="fa-solid fa-tag"></i>
        <span class="menu-item-text">Alterar Categoria</span>
        <i class="fa-solid fa-chevron-right menu-item-chevron"></i>
        <div class="menu-submenu"></div>
    `;
    const submenu = catMenuItem.querySelector(".menu-submenu");
    
    Object.entries(CATEGORY_LABELS).forEach(([catKey, catName]) => {
        const subItem = document.createElement("div");
        subItem.className = "menu-item";
        const isCurrent = (item.category || "").toLowerCase() === catKey.toLowerCase();
        subItem.innerHTML = `
            <span class="menu-item-text">${catName}</span>
            ${isCurrent ? '<i class="fa-solid fa-check" style="color:var(--color-cyan); font-size:10px; margin-left:auto; width:auto;"></i>' : ''}
        `;
        subItem.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            menu.remove();
            try {
                if (isVideo) {
                    await CapIAuAPI.updateVideoCategory(item.id, catKey);
                    item.category = catKey;
                    if (catKey === "depoimento") item.video_type = "interview";
                    else item.video_type = "broll";
                } else {
                    await CapIAuAPI.updatePhotoCategory(item.id, catKey);
                    item.category = catKey;
                }
                if (window.libraryInstance) await window.libraryInstance.reloadData();
                if (typeof window.showToast === "function") {
                    window.showToast(`Categoria alterada para "${catName}"!`, "success");
                }
            } catch (err) {
                if (typeof window.showToast === "function") {
                    window.showToast("Erro ao mudar categoria: " + err.message, "error");
                } else {
                    alert("Erro ao mudar categoria: " + err.message);
                }
            }
        });
        submenu.appendChild(subItem);
    });
    menu.appendChild(catMenuItem);

    // Separador
    const sep3 = document.createElement("div");
    sep3.className = "menu-separator";
    menu.appendChild(sep3);

    // Item: Mostrar no Windows Explorer
    const explorerItem = document.createElement("div");
    explorerItem.className = "menu-item";
    explorerItem.innerHTML = `<i class="fa-solid fa-folder-open" style="color:var(--color-cyan);"></i><span class="menu-item-text">Mostrar no Windows Explorer</span>`;
    explorerItem.addEventListener("click", async () => {
        menu.remove();
        try {
            if (item.filepath) {
                await CapIAuAPI.openFolderInExplorer(item.filepath);
            } else {
                if (typeof window.showToast === "function") window.showToast("Caminho do arquivo não disponível.", "warning");
            }
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro ao abrir Explorer: " + err.message, "error");
        }
    });
    menu.appendChild(explorerItem);

    // Item: Copiar Caminho do Arquivo
    const copyPathItem = document.createElement("div");
    copyPathItem.className = "menu-item";
    copyPathItem.innerHTML = `<i class="fa-solid fa-copy"></i><span class="menu-item-text">Copiar Caminho do Arquivo</span>`;
    copyPathItem.addEventListener("click", () => {
        menu.remove();
        const filePath = item.filepath || item.filename || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(filePath).then(() => {
                if (typeof window.showToast === "function") {
                    window.showToast("Caminho copiado para a área de transferência!", "success");
                }
            }).catch(() => {
                prompt("Caminho do arquivo:", filePath);
            });
        } else {
            prompt("Caminho do arquivo:", filePath);
        }
    });
    menu.appendChild(copyPathItem);

    // Item: Mover para Pasta (Bin)...
    const moveToBinItem = document.createElement("div");
    moveToBinItem.className = "menu-item";
    moveToBinItem.innerHTML = `<i class="fa-solid fa-folder-tree" style="color:var(--color-violet);"></i><span class="menu-item-text">Mover para Pasta (Bin)...</span>`;
    moveToBinItem.addEventListener("click", () => {
        menu.remove();
        promptMoveMediaToBin(item, kind);
    });
    menu.appendChild(moveToBinItem);

    // Item: Editar Metadados & Data
    const editMetaItem = document.createElement("div");
    editMetaItem.className = "menu-item";
    editMetaItem.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color:var(--color-gold);"></i><span class="menu-item-text">Editar Metadados & Data...</span>`;
    editMetaItem.addEventListener("click", () => {
        menu.remove();
        promptEditMediaMetadata(item, kind);
    });
    menu.appendChild(editMetaItem);

    // Item: Relincar Arquivo Original
    const relinkItem = document.createElement("div");
    relinkItem.className = "menu-item";
    relinkItem.innerHTML = `<i class="fa-solid fa-link" style="color:var(--color-cyan);"></i><span class="menu-item-text">Relincar Mídias / Buscar no Disco...</span>`;
    relinkItem.addEventListener("click", () => {
        menu.remove();
        promptRelinkMediaDialog(item.filepath ? item.filepath.substring(0, item.filepath.lastIndexOf('/')) : "");
    });
    menu.appendChild(relinkItem);

    // Separador
    const sep4 = document.createElement("div");
    sep4.className = "menu-separator";
    menu.appendChild(sep4);

    // Item: Limpar Proxy Físico (Destrutivo com Confirmação)
    const cleanProxyItem = document.createElement("div");
    cleanProxyItem.className = "menu-item menu-item-destructive";
    cleanProxyItem.innerHTML = `<i class="fa-solid fa-broom"></i><span class="menu-item-text">Deletar / Limpar Proxy</span>`;
    cleanProxyItem.addEventListener("click", async () => {
        menu.remove();
        const msg = `Deseja realmente excluir o arquivo proxy físico de "${item.filename}"?\n\nO clipe permanecerá no projeto, mas precisará ser recodificado para exibição local suave.`;
        if (!confirm(msg)) return;
        try {
            if (isVideo) {
                await CapIAuAPI.deleteVideoProxy(item.id);
            } else {
                await CapIAuAPI.deletePhotoProxy(item.id);
            }
            if (typeof window.showToast === "function") {
                window.showToast("Proxy físico removido com sucesso!", "success");
            }
            if (window.libraryInstance) await window.libraryInstance.reloadData();
            else STATE.emit("projectChanged");
        } catch (err) {
            if (typeof window.showToast === "function") {
                window.showToast("Erro ao excluir proxy: " + err.message, "error");
            } else {
                alert("Erro ao excluir proxy: " + err.message);
            }
        }
    });
    menu.appendChild(cleanProxyItem);

    // Item: Remover Mídia do Projeto (Destrutivo com Confirmação)
    const removeMediaItem = document.createElement("div");
    removeMediaItem.className = "menu-item menu-item-destructive";
    removeMediaItem.innerHTML = `<i class="fa-solid fa-trash-can"></i><span class="menu-item-text">Remover Mídia do Projeto</span>`;
    removeMediaItem.addEventListener("click", async () => {
        menu.remove();
        const msg = `⚠️ ATENÇÃO: Deseja remover permanentemente "${item.filename}" do projeto?\n\nTodos os dados de decupagem, transcrição e indexação visual serão excluídos do banco de dados.`;
        if (!confirm(msg)) return;
        try {
            if (isVideo) {
                await CapIAuAPI.deleteVideo(item.id);
            } else {
                await CapIAuAPI.deletePhoto(item.id);
            }
            if (typeof window.showToast === "function") {
                window.showToast("Mídia removida do projeto!", "info");
            }
            if (window.libraryInstance) await window.libraryInstance.reloadData();
            else STATE.emit("projectChanged");
        } catch (err) {
            if (typeof window.showToast === "function") {
                window.showToast("Erro ao remover mídia: " + err.message, "error");
            } else {
                alert("Erro ao remover mídia: " + err.message);
            }
        }
    });
    menu.appendChild(removeMediaItem);

    targetDoc.body.appendChild(menu);

    // Posicionamento inteligente anti-overflow
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || 230;
    const menuHeight = menuRect.height || 380;

    let posX = e.clientX;
    let posY = e.clientY;

    if (posX + menuWidth > targetWin.innerWidth - 10) {
        posX = targetWin.innerWidth - menuWidth - 10;
    }
    const allSubmenus = menu.querySelectorAll(".menu-submenu");
    if (posX + menuWidth + 280 > targetWin.innerWidth) {
        allSubmenus.forEach(sm => sm.classList.add("submenu-left"));
    }
    if (posY + menuHeight > targetWin.innerHeight - 10) {
        posY = Math.max(10, targetWin.innerHeight - menuHeight - 10);
    }

    menu.style.left = `${Math.max(10, posX)}px`;
    menu.style.top = `${Math.max(10, posY)}px`;

    const closeHandler = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            cleanup();
        }
    };
    const keyHandler = (ev) => {
        if (ev.key === "Escape") {
            menu.remove();
            cleanup();
        }
    };
    const scrollHandler = () => {
        menu.remove();
        cleanup();
    };

    const cleanup = () => {
        targetDoc.removeEventListener("pointerdown", closeHandler, true);
        targetDoc.removeEventListener("keydown", keyHandler, true);
        targetWin.removeEventListener("scroll", scrollHandler, true);
    };

    setTimeout(() => {
        targetDoc.addEventListener("pointerdown", closeHandler, true);
        targetDoc.addEventListener("keydown", keyHandler, true);
        targetWin.addEventListener("scroll", scrollHandler, true);
    }, 10);
}
window.showMediaContextMenu = showMediaContextMenu;

// ── MENU DE CONTEXTO E GESTÃO DE BINS VIRTUAIS ───────────────────────

export async function uploadMediaFiles(fileList, targetFolderPath = "root") {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const projectId = getActiveProjectId();
    const formData = new FormData();
    formData.append("project_id", projectId);

    for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
    }

    try {
        if (typeof window.showToast === "function") {
            window.showToast(`Importando ${files.length} arquivo(s)...`, "info");
        }
        const res = await fetch("/api/ingest/upload-files", {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        if (data && data.status === "success") {
            if (targetFolderPath && targetFolderPath !== "root") {
                virtualDeletedFolders.delete(targetFolderPath);
                virtualEmptyFolders.add(targetFolderPath);
                saveVirtualFoldersState(projectId);
            }
            if (typeof window.showToast === "function") {
                window.showToast(`${data.count || files.length} arquivo(s) importado(s) com sucesso!`, "success");
            }
            if (window.libraryInstance) await window.libraryInstance.reloadData();
            else STATE.emit("projectChanged");

            if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                window.openTasksDrawerAndSwitchTab();
            }
        } else {
            throw new Error((data && (data.message || data.detail)) || "Falha na ingestão dos arquivos.");
        }
    } catch (err) {
        if (typeof window.showToast === "function") {
            window.showToast("Erro ao importar arquivos: " + err.message, "error");
        } else {
            alert("Erro ao importar arquivos: " + err.message);
        }
    }
}
window.uploadMediaFiles = uploadMediaFiles;

export function promptExternalPathIngest(targetFolderPath = "root") {
    const targetDoc = document.querySelector("#sidebar-left")?.ownerDocument || (window.popoutWindows?.["sidebar-left"]?.document) || document;
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.style.zIndex = "9999999";
    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 460px; padding: 20px; border-radius: 8px;">
            <div class="modal-header" style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; margin: 0;">
                    <i class="fa-solid fa-link" style="color: var(--color-cyan);"></i> Vincular Pasta Local / HD Externo
                </h2>
                <button class="btn-close-modal" id="btn-close-external-ingest" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px;">&times;</button>
            </div>
            <div class="modal-body">
                <p style="font-size: 11px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px;">
                    Informe o caminho absoluto da pasta no disco ou HD externo. Os arquivos serão catalogados <strong>in-place (sem cópia de arquivos)</strong>.
                </p>
                <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; display: block;">Caminho da Pasta:</label>
                <div style="display: flex; gap: 6px;">
                    <input type="text" id="external-path-input" placeholder="Ex: D:/Gravacoes/Documentario ou E:\\Acervo" style="flex: 1; box-sizing: border-box; background: rgba(0,0,0,0.35); border: 1px solid var(--border-glass); padding: 8px 10px; border-radius: 4px; color: #fff; font-size: 12px; font-family: monospace;">
                    <button id="btn-browse-win" class="btn-outline" title="Procurar no Windows" style="padding: 0 10px; font-size: 11px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-folder-open"></i> Procurar...
                    </button>
                </div>
                <div id="browse-hint" style="font-size: 10px; color: var(--text-muted, #888); margin-top: 6px;">
                    Dica: Você pode copiar e colar o caminho da barra de endereços do Explorer.
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;">
                <button id="btn-cancel-external-ingest" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-external-ingest" class="btn-primary" style="background: var(--color-cyan); border-color: var(--color-cyan); color: #000; font-weight: 600;">Vincular In-Place</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const input = modal.querySelector("#external-path-input");
    const btnBrowse = modal.querySelector("#btn-browse-win");
    setTimeout(() => input?.focus(), 50);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-external-ingest").onclick = close;
    modal.querySelector("#btn-cancel-external-ingest").onclick = close;

    btnBrowse.onclick = async () => {
        try {
            const resp = await CapIAuAPI.selectFolder();
            if (resp && resp.status === "success" && resp.path) {
                input.value = resp.path;
            } else if (resp && resp.status === "unsupported") {
                if (typeof window.showToast === "function") {
                    window.showToast("Diálogo nativo indisponível no ambiente do servidor. Digite ou cole o caminho no campo.", "info");
                }
            }
        } catch (e) {
            console.warn("[BrowseWin] Erro ao abrir seletor:", e);
        }
    };

    modal.querySelector("#btn-confirm-external-ingest").onclick = async () => {
        const pathVal = input.value.trim();
        if (!pathVal) {
            if (typeof window.showToast === "function") window.showToast("Informe o caminho da pasta.", "warning");
            return;
        }
        close();
        const projectId = getActiveProjectId();
        const folderName = pathVal.replace(/[\\\/]+$/, '').split(/[\\\/]/).pop() || "Pasta";

        promptFolderImportTarget(folderName, targetFolderPath, async (chosenVirtualFolder, isNewBin) => {
            try {
                if (typeof window.showToast === "function") window.showToast("Iniciando vinculação in-place...", "info");
                await CapIAuAPI.triggerExternalIngest(pathVal, projectId, chosenVirtualFolder);
                if (isNewBin || (chosenVirtualFolder && chosenVirtualFolder !== "root")) {
                    virtualDeletedFolders.delete(chosenVirtualFolder);
                    virtualEmptyFolders.add(chosenVirtualFolder);
                    saveVirtualFoldersState(projectId);
                }
                if (typeof window.showToast === "function") {
                    window.showToast("Vinculação de pasta iniciada em background!", "success");
                }
                if (window.libraryInstance) await window.libraryInstance.reloadData();
                else STATE.emit("projectChanged");

                if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                    window.openTasksDrawerAndSwitchTab();
                }
            } catch (err) {
                if (typeof window.showToast === "function") window.showToast("Erro na vinculação: " + err.message, "error");
            }
        });
    };
}
window.promptExternalPathIngest = promptExternalPathIngest;

export function showImportChoicesMenu(anchorEl, targetFolderPath = "root") {
    const targetDoc = anchorEl?.ownerDocument || document;
    const targetWin = targetDoc.defaultView || window;

    const oldMenus = targetDoc.querySelectorAll(".custom-context-menu");
    oldMenus.forEach(m => m.remove());

    const menu = targetDoc.createElement("div");
    menu.id = "custom-import-choices-menu";
    menu.className = "custom-context-menu";
    menu.style.zIndex = "999999";

    // Opção 1: Importar Arquivos Individuais
    const filesItem = targetDoc.createElement("div");
    filesItem.className = "menu-item";
    filesItem.innerHTML = `<i class="fa-solid fa-film" style="color:var(--color-violet);"></i><span class="menu-item-text">Importar Arquivos de Mídia...</span>`;
    filesItem.addEventListener("click", () => {
        menu.remove();
        const input = targetDoc.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = "video/*,audio/*,image/*,.mp4,.mov,.mxf,.mts,.mkv,.avi,.wav,.mp3,.m4a,.bwf,.flac,.aac,.jpg,.jpeg,.png,.tiff,.webp,.arw,.cr2,.cr3,.nef,.dng,.pef,.raf,.orf,.rw2,.raw";
        input.style.display = "none";
        targetDoc.body.appendChild(input);
        input.addEventListener("change", async () => {
            const files = Array.from(input.files || []);
            if (files.length > 0) {
                await uploadMediaFiles(files, targetFolderPath);
            }
            input.remove();
        });
        input.click();
    });
    menu.appendChild(filesItem);

    // Opção 2: Importar Pasta Inteira (Upload pelo Navegador)
    const folderUploadItem = targetDoc.createElement("div");
    folderUploadItem.className = "menu-item";
    folderUploadItem.innerHTML = `<i class="fa-solid fa-folder-open" style="color:var(--color-gold);"></i><span class="menu-item-text">Importar Pasta (Navegador)...</span>`;
    folderUploadItem.addEventListener("click", () => {
        menu.remove();
        const input = targetDoc.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.directory = true;
        input.multiple = true;
        input.style.display = "none";
        targetDoc.body.appendChild(input);
        input.addEventListener("change", async () => {
            const files = Array.from(input.files || []);
            if (files.length === 0) {
                input.remove();
                return;
            }
            const supportedExts = new Set([
                ".mp4", ".mov", ".mxf", ".mts", ".mkv", ".avi",
                ".wav", ".mp3", ".m4a", ".bwf", ".flac", ".aac",
                ".jpg", ".jpeg", ".png", ".tiff", ".webp",
                ".arw", ".cr2", ".cr3", ".nef", ".dng", ".pef", ".raf", ".orf", ".rw2", ".raw"
            ]);
            const mediaFiles = files.filter(f => {
                const ext = "." + f.name.split(".").pop().toLowerCase();
                return supportedExts.has(ext);
            });
            if (mediaFiles.length === 0) {
                if (typeof window.showToast === "function") {
                    window.showToast("Nenhum arquivo de mídia suportado encontrado na pasta.", "warning");
                }
                input.remove();
                return;
            }
            let folderName = "";
            if (mediaFiles[0].webkitRelativePath) {
                folderName = mediaFiles[0].webkitRelativePath.split("/")[0];
            }

            promptFolderImportTarget(folderName || "Pasta", targetFolderPath, async (chosenVirtualFolder) => {
                await uploadMediaFiles(mediaFiles, chosenVirtualFolder);
                input.remove();
            });
        });
        input.click();
    });
    menu.appendChild(folderUploadItem);

    // Opção 3: Vincular Pasta Local / HD Externo (In-place Link)
    const folderLinkItem = targetDoc.createElement("div");
    folderLinkItem.className = "menu-item";
    folderLinkItem.innerHTML = `<i class="fa-solid fa-link" style="color:var(--color-cyan);"></i><span class="menu-item-text">Vincular Pasta / HD Externo (In-Place)...</span>`;
    folderLinkItem.addEventListener("click", () => {
        menu.remove();
        promptExternalPathIngest(targetFolderPath);
    });
    menu.appendChild(folderLinkItem);

    targetDoc.body.appendChild(menu);

    if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
        const rect = anchorEl.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + 280 > targetWin.innerWidth) left = targetWin.innerWidth - 290;
        if (top + 120 > targetWin.innerHeight) top = rect.top - 120;
        menu.style.left = `${Math.max(10, left)}px`;
        menu.style.top = `${Math.max(10, top)}px`;
    } else {
        menu.style.left = "50%";
        menu.style.top = "50%";
        menu.style.transform = "translate(-50%, -50%)";
    }

    const closeHandler = (ev) => {
        if (!menu.contains(ev.target) && (!anchorEl || !anchorEl.contains(ev.target))) {
            menu.remove();
            targetDoc.removeEventListener("pointerdown", closeHandler, true);
        }
    };
    setTimeout(() => targetDoc.addEventListener("pointerdown", closeHandler, true), 10);
}
window.showImportChoicesMenu = showImportChoicesMenu;

export async function handleHeaderImportClick(anchorEl) {
    const btn = anchorEl || document.getElementById("btn-add-media");
    showImportChoicesMenu(btn, "root");
}
window.handleHeaderImportClick = handleHeaderImportClick;

export async function handleImportToFolder(targetFolderPath, anchorEl) {
    showImportChoicesMenu(anchorEl, targetFolderPath);
}
window.handleImportToFolder = handleImportToFolder;

export function promptCreateSubfolder(parentFolderPath) {
    const targetDoc = document.querySelector("#sidebar-left")?.ownerDocument || (window.popoutWindows?.["sidebar-left"]?.document) || document;
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 380px; padding: 18px;">
            <div class="modal-header" style="margin-bottom: 12px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-folder-plus" style="color: var(--color-violet);"></i> Nova Subpasta
                </h2>
                <button class="btn-close-modal" id="btn-close-subfolder">&times;</button>
            </div>
            <div class="modal-body">
                <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; display: block;">Nome da Pasta:</label>
                <input type="text" id="subfolder-name-input" placeholder="Ex: Entrevistas Principais" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 7px 10px; border-radius: 4px; color: #fff; font-size: 12px;">
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button id="btn-cancel-subfolder" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-subfolder" class="btn-primary">Criar Pasta</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const input = modal.querySelector("#subfolder-name-input");
    setTimeout(() => input?.focus(), 50);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-subfolder").onclick = close;
    modal.querySelector("#btn-cancel-subfolder").onclick = close;

    const submit = () => {
        const val = input.value.trim();
        if (!val) return;
        close();
        const projectId = getActiveProjectId();
        const newPath = parentFolderPath === "root" ? `root/${val}` : `${parentFolderPath}/${val}`;
        virtualDeletedFolders.delete(newPath);
        virtualEmptyFolders.add(newPath);
        openFoldersSet.add(parentFolderPath);
        openFoldersSet.add(newPath);
        saveVirtualFoldersState(projectId);
        if (window.libraryInstance) window.libraryInstance.reloadData();
        if (typeof window.showToast === "function") {
            window.showToast(`Subpasta "${val}" criada!`, "success");
        }
    };

    modal.querySelector("#btn-confirm-subfolder").onclick = submit;
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    });
}

export function promptRenameFolder(folderPath, currentName) {
    const targetDoc = document.querySelector("#sidebar-left")?.ownerDocument || (window.popoutWindows?.["sidebar-left"]?.document) || document;
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 380px; padding: 18px;">
            <div class="modal-header" style="margin-bottom: 12px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-pen-to-square" style="color: var(--color-cyan);"></i> Renomear Pasta
                </h2>
                <button class="btn-close-modal" id="btn-close-rename-folder">&times;</button>
            </div>
            <div class="modal-body">
                <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; display: block;">Novo Nome:</label>
                <input type="text" id="rename-folder-input" value="${escapeHtml(currentName)}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 7px 10px; border-radius: 4px; color: #fff; font-size: 12px;">
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button id="btn-cancel-rename-folder" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-rename-folder" class="btn-primary">Salvar</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const input = modal.querySelector("#rename-folder-input");
    setTimeout(() => {
        input?.focus();
        input?.select();
    }, 50);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-rename-folder").onclick = close;
    modal.querySelector("#btn-cancel-rename-folder").onclick = close;

    const submit = () => {
        const val = input.value.trim();
        if (!val || val === currentName) {
            close();
            return;
        }
        close();
        const projectId = getActiveProjectId();
        const parentParts = folderPath.split("/");
        parentParts.pop();
        const newPath = [...parentParts, val].join("/");

        if (virtualEmptyFolders.has(folderPath)) {
            virtualEmptyFolders.delete(folderPath);
            virtualEmptyFolders.add(newPath);
        }
        virtualDeletedFolders.delete(newPath);
        if (virtualFolderColors[folderPath]) {
            virtualFolderColors[newPath] = virtualFolderColors[folderPath];
            delete virtualFolderColors[folderPath];
        }
        Object.keys(virtualFolderMap).forEach(id => {
            if (virtualFolderMap[id] === folderPath || virtualFolderMap[id].startsWith(folderPath + "/")) {
                virtualFolderMap[id] = virtualFolderMap[id].replace(folderPath, newPath);
            }
        });
        saveVirtualFoldersState(projectId);
        if (window.libraryInstance) window.libraryInstance.reloadData();
        if (typeof window.showToast === "function") {
            window.showToast(`Pasta renomeada para "${val}"!`, "success");
        }
    };

    modal.querySelector("#btn-confirm-rename-folder").onclick = submit;
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    });
}

export function setBinColor(folderPath, hexColor) {
    const projectId = getActiveProjectId();
    virtualFolderColors[folderPath] = hexColor;
    saveVirtualFoldersState(projectId);
    if (window.libraryInstance) window.libraryInstance.reloadData();
    if (typeof window.showToast === "function") {
        window.showToast("Cor do bin definida com sucesso!", "success");
    }
}

export function confirmDeleteVirtualFolder(folderPath, folderName) {
    const targetDoc = document.querySelector("#sidebar-left")?.ownerDocument || (window.popoutWindows?.["sidebar-left"]?.document) || document;
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 440px; padding: 20px;">
            <div class="modal-header" style="margin-bottom: 12px;">
                <h2 style="font-size: 15px; color: var(--color-rose); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-triangle-exclamation"></i> Excluir Pasta da Biblioteca
                </h2>
                <button class="btn-close-modal" id="btn-close-del-bin">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                <p>Tem certeza de que deseja remover a pasta <b>"${escapeHtml(folderName)}"</b> da sua biblioteca?</p>
                <p style="font-size: 11px; color: var(--text-muted); background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; border-left: 2px solid var(--color-cyan); margin-top: 10px;">
                    <i class="fa-solid fa-circle-info" style="color: var(--color-cyan);"></i> Esta ação remove apenas a pasta virtual do projeto. <b>Nenhum arquivo físico original no seu disco rígido será apagado.</b> Você pode desfazer a qualquer momento com <b>Ctrl + Z</b>.
                </p>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button id="btn-cancel-del-bin" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-del-bin" class="btn-primary" style="background: var(--color-rose); border-color: var(--color-rose);">Remover Pasta</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-del-bin").onclick = close;
    modal.querySelector("#btn-cancel-del-bin").onclick = close;
    modal.querySelector("#btn-confirm-del-bin").onclick = () => {
        close();
        executeDeleteFolder(folderPath, folderName);
    };
}

export async function executeDeleteFolder(folderPath, folderName) {
    const projectId = getActiveProjectId();

    // Guarda os bins que saem do banco (o proprio e os descendentes) para o Ctrl+Z
    const binsRemovidos = (Array.isArray(window.projectBinsList) ? window.projectBinsList : [])
        .filter(b => b.path === folderPath || b.path.startsWith(folderPath + "/"))
        .map(b => ({ name: b.name, path: b.path, parent_path: b.parent_path, color: b.color }));

    libraryUndoStack.push({
        type: "delete_folder",
        folderPath,
        folderName,
        binsRemovidos,
        previousDeletedFolders: new Set(virtualDeletedFolders),
        previousEmptyFolders: new Set(virtualEmptyFolders),
        previousFolderMap: { ...virtualFolderMap },
        previousFolderColors: { ...virtualFolderColors }
    });

    virtualDeletedFolders.add(folderPath);
    virtualEmptyFolders.delete(folderPath);
    saveVirtualFoldersState(projectId);

    // Atualiza a árvore na hora, sem esperar a rede
    if (window.libraryInstance) window.libraryInstance.scheduleRenderMedia();

    if (typeof window.showToast === "function") {
        window.showToast(`Pasta "${folderName}" removida da biblioteca. Pressione Ctrl+Z para desfazer.`, "info");
    }

    // Persiste no banco: sem isso o bin voltava no proximo carregamento,
    // porque buildTree remonta a arvore a partir de media_bin.
    if (binsRemovidos.length > 0) {
        try {
            await CapIAuAPI.deleteProjectBin(projectId, folderPath, true);
            if (window.libraryInstance) await window.libraryInstance.reloadData();
        } catch (err) {
            console.error("Falha ao remover o bin no banco:", err);
            if (typeof window.showToast === "function") {
                window.showToast("Pasta oculta só nesta sessão: " + err.message, "warning");
            }
        }
    }
}

export function showFolderContextMenu(e, node, folderHeader) {
    e.preventDefault();
    e.stopPropagation();

    const targetDoc = folderHeader?.ownerDocument || document;
    const targetWin = targetDoc.defaultView || window;

    const oldMenus = targetDoc.querySelectorAll(".custom-context-menu");
    oldMenus.forEach(m => m.remove());

    const menu = targetDoc.createElement("div");
    menu.id = "custom-folder-context-menu";
    menu.className = "custom-context-menu folder-context-menu";

    // 1. Importar Mídias para esta Pasta
    const importItem = targetDoc.createElement("div");
    importItem.className = "menu-item";
    importItem.innerHTML = `<i class="fa-solid fa-cloud-arrow-up" style="color:var(--color-cyan);"></i><span class="menu-item-text">Importar Mídias para esta Pasta...</span>`;
    importItem.addEventListener("click", async () => {
        menu.remove();
        showImportChoicesMenu(folderHeader, node.path);
    });
    menu.appendChild(importItem);

    // 2. Nova Subpasta
    const newSubfolderItem = targetDoc.createElement("div");
    newSubfolderItem.className = "menu-item";
    newSubfolderItem.innerHTML = `<i class="fa-solid fa-folder-plus" style="color:var(--color-violet);"></i><span class="menu-item-text">Nova Subpasta</span>`;
    newSubfolderItem.addEventListener("click", () => {
        menu.remove();
        promptCreateSubfolder(node.path);
    });
    menu.appendChild(newSubfolderItem);

    // 3. Abrir no Windows Explorer
    const explorerItem = targetDoc.createElement("div");
    explorerItem.className = "menu-item";
    explorerItem.innerHTML = `<i class="fa-solid fa-folder-open"></i><span class="menu-item-text">Abrir no Windows Explorer</span>`;
    explorerItem.addEventListener("click", async () => {
        menu.remove();
        try {
            await CapIAuAPI.openFolderInExplorer(node.path);
            if (typeof window.showToast === "function") window.showToast("Pasta aberta no Windows Explorer", "info");
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro ao abrir Explorer: " + err.message, "error");
        }
    });
    menu.appendChild(explorerItem);

    // Separador
    const sep = targetDoc.createElement("div");
    sep.className = "menu-separator";
    menu.appendChild(sep);

    // 4. Definir Cor do Bin (Submenu)
    const colorMenuItem = targetDoc.createElement("div");
    colorMenuItem.className = "menu-item menu-item-has-submenu";
    colorMenuItem.innerHTML = `
        <i class="fa-solid fa-palette"></i>
        <span class="menu-item-text">Definir Cor do Bin</span>
        <i class="fa-solid fa-chevron-right menu-item-chevron"></i>
        <div class="menu-submenu"></div>
    `;
    const colorSubmenu = colorMenuItem.querySelector(".menu-submenu");
    const BIN_COLORS = [
        { name: "Padrão (Violeta)", hex: "#8b5cf6" },
        { name: "Ciano", hex: "#06b6d4" },
        { name: "Esmeralda", hex: "#10b981" },
        { name: "Âmbar / Amarelo", hex: "#f59e0b" },
        { name: "Rosa / Rose", hex: "#f43f5e" },
        { name: "Azul Céu", hex: "#38bdf8" },
        { name: "Cinza Neutro", hex: "#94a3b8" },
    ];
    BIN_COLORS.forEach(c => {
        const sub = targetDoc.createElement("div");
        sub.className = "menu-item";
        sub.innerHTML = `
            <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${c.hex}; margin-right:8px;"></span>
            <span class="menu-item-text">${c.name}</span>
        `;
        sub.addEventListener("click", (ev) => {
            ev.stopPropagation();
            menu.remove();
            setBinColor(node.path, c.hex);
        });
        colorSubmenu.appendChild(sub);
    });
    menu.appendChild(colorMenuItem);

    // 5. Renomear Pasta
    if (node.path !== "root") {
        const renameFolderItem = targetDoc.createElement("div");
        renameFolderItem.className = "menu-item";
        renameFolderItem.innerHTML = `<i class="fa-solid fa-pen-to-square"></i><span class="menu-item-text">Renomear Pasta</span>`;
        renameFolderItem.addEventListener("click", () => {
            menu.remove();
            promptRenameFolder(node.path, node.name);
        });
        menu.appendChild(renameFolderItem);

        // Separador
        const sep2 = targetDoc.createElement("div");
        sep2.className = "menu-separator";
        menu.appendChild(sep2);

        // 6. Excluir Pasta da Biblioteca
        const deleteFolderItem = targetDoc.createElement("div");
        deleteFolderItem.className = "menu-item menu-item-destructive";
        deleteFolderItem.innerHTML = `<i class="fa-solid fa-trash"></i><span class="menu-item-text">Excluir Pasta da Biblioteca</span>`;
        deleteFolderItem.addEventListener("click", () => {
            menu.remove();
            confirmDeleteVirtualFolder(node.path, node.name);
        });
        menu.appendChild(deleteFolderItem);
    }

    targetDoc.body.appendChild(menu);

    // Posicionamento
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || 220;
    const menuHeight = menuRect.height || 260;

    let posX = e.clientX;
    let posY = e.clientY;

    if (posX + menuWidth > targetWin.innerWidth - 10) {
        posX = targetWin.innerWidth - menuWidth - 10;
        if (colorSubmenu) colorSubmenu.classList.add("submenu-left");
    }
    if (posY + menuHeight > targetWin.innerHeight - 10) {
        posY = Math.max(10, targetWin.innerHeight - menuHeight - 10);
    }

    menu.style.left = `${Math.max(10, posX)}px`;
    menu.style.top = `${Math.max(10, posY)}px`;

    const closeHandler = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            cleanup();
        }
    };
    const keyHandler = (ev) => {
        if (ev.key === "Escape") {
            menu.remove();
            cleanup();
        }
    };
    const cleanup = () => {
        targetDoc.removeEventListener("pointerdown", closeHandler, true);
        targetDoc.removeEventListener("keydown", keyHandler, true);
    };
    setTimeout(() => {
        targetDoc.addEventListener("pointerdown", closeHandler, true);
        targetDoc.addEventListener("keydown", keyHandler, true);
    }, 10);
}
// ── MODAIS DE ORGANIZAÇÃO, METADADOS E RELINK ───────────────────────────

export function promptFolderImportTarget(folderName, targetFolderPath, onChoice) {
    const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed) ? window.popoutWindows["sidebar-left"].document : (document.querySelector("#sidebar-left")?.ownerDocument || document);
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";
    const currentDisplayName = (!targetFolderPath || targetFolderPath === "root") ? "Raiz da Biblioteca" : targetFolderPath.replace(/^root\/?/, "");

    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 440px; padding: 20px;">
            <div class="modal-header" style="margin-bottom: 14px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-folder-tree" style="color: var(--color-cyan);"></i> Importação de Pasta
                </h2>
                <button class="btn-close-modal" id="btn-close-import-choice">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                <p>Como você deseja organizar os arquivos da pasta <b>"${escapeHtml(folderName)}"</b> na biblioteca?</p>
                <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 14px;">
                    <button id="btn-choice-create-bin" class="btn-primary" style="padding: 10px 14px; display: flex; align-items: center; gap: 10px; text-align: left; background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.5); color: #fff; cursor: pointer; border-radius: 6px;">
                        <i class="fa-solid fa-folder-plus" style="font-size: 16px; color: var(--color-violet);"></i>
                        <div>
                            <div style="font-weight: 700;">Criar Bin "${escapeHtml(folderName)}"</div>
                            <div style="font-size: 10px; color: var(--text-muted);">Cria uma pasta virtual dedicada na biblioteca</div>
                        </div>
                    </button>
                    <button id="btn-choice-current-folder" class="btn-secondary" style="padding: 10px 14px; display: flex; align-items: center; gap: 10px; text-align: left; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-glass); color: #fff; cursor: pointer; border-radius: 6px;">
                        <i class="fa-solid fa-folder-open" style="font-size: 16px; color: var(--color-cyan);"></i>
                        <div>
                            <div style="font-weight: 700;">Importar na Pasta Atual (${escapeHtml(currentDisplayName)})</div>
                            <div style="font-size: 10px; color: var(--text-muted);">Coloca as mídias diretamente na pasta selecionada</div>
                        </div>
                    </button>
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button id="btn-cancel-import-choice" class="btn-outline">Cancelar</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-import-choice").onclick = close;
    modal.querySelector("#btn-cancel-import-choice").onclick = close;

    modal.querySelector("#btn-choice-create-bin").onclick = () => {
        close();
        const newBinPath = (!targetFolderPath || targetFolderPath === "root")
            ? `root/${folderName}`
            : `${targetFolderPath}/${folderName}`;
        onChoice(newBinPath, true);
    };

    modal.querySelector("#btn-choice-current-folder").onclick = () => {
        close();
        onChoice(targetFolderPath || "root", false);
    };
}

export function promptMoveMediaToBin(item, mediaType = "video") {
    const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed) ? window.popoutWindows["sidebar-left"].document : (document.querySelector("#sidebar-left")?.ownerDocument || document);
    const projectId = getActiveProjectId();
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";

    // Coleta todas as pastas virtuais disponíveis
    const binsSet = new Set(["root"]);
    if (Array.isArray(window.projectBinsList)) {
        window.projectBinsList.forEach(b => binsSet.add(b.path));
    }
    virtualEmptyFolders.forEach(p => binsSet.add(p));
    (STATE.allVideos || []).forEach(v => { if (v.virtual_folder) binsSet.add(v.virtual_folder); });
    (STATE.allPhotos || []).forEach(p => { if (p.virtual_folder) binsSet.add(p.virtual_folder); });

    const currentBin = getItemVirtualFolder(item);
    const binOptions = Array.from(binsSet).sort().map(binPath => {
        const isSelected = binPath === currentBin ? "selected" : "";
        const label = binPath === "root" ? "📁 Biblioteca (Raiz)" : `📁 ${binPath.replace(/^root\/?/, "")}`;
        return `<option value="${escapeHtml(binPath)}" ${isSelected}>${escapeHtml(label)}</option>`;
    }).join("");

    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 400px; padding: 18px;">
            <div class="modal-header" style="margin-bottom: 12px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-folder-tree" style="color: var(--color-violet);"></i> Mover Mídia para Bin
                </h2>
                <button class="btn-close-modal" id="btn-close-move-bin">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 11px; color: var(--text-secondary);">
                <div style="margin-bottom: 8px; font-weight: 600; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    Mídia: ${escapeHtml(item.filename || item.title || `Item #${item.id}`)}
                </div>
                <label style="display: block; margin-bottom: 6px;">Selecione o Bin de Destino:</label>
                <div class="dropdown-wrapper" style="height: 32px; padding: 0 10px; margin-bottom: 10px; display: flex; align-items: center;">
                    <select id="select-target-bin" style="background: transparent; border: none; outline: none; color: #fff; font-size: 11px; width: 100%; cursor: pointer;">
                        ${binOptions}
                        <option value="__new__">+ Criar Novo Bin...</option>
                    </select>
                </div>
                <div id="new-bin-container" style="display: none; margin-top: 6px;">
                    <label style="display: block; margin-bottom: 4px;">Nome da Nova Pasta:</label>
                    <input type="text" id="input-new-bin-name" placeholder="Ex: Cenas Externas" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px;">
                <button id="btn-cancel-move-bin" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-move-bin" class="btn-primary">Mover Mídia</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-move-bin").onclick = close;
    modal.querySelector("#btn-cancel-move-bin").onclick = close;

    const selectEl = modal.querySelector("#select-target-bin");
    const newBinContainer = modal.querySelector("#new-bin-container");
    const newBinInput = modal.querySelector("#input-new-bin-name");

    selectEl.addEventListener("change", () => {
        if (selectEl.value === "__new__") {
            newBinContainer.style.display = "block";
            newBinInput.focus();
        } else {
            newBinContainer.style.display = "none";
        }
    });

    modal.querySelector("#btn-confirm-move-bin").onclick = async () => {
        let targetFolder = selectEl.value;
        if (targetFolder === "__new__") {
            const name = newBinInput.value.trim();
            if (!name) {
                alert("Por favor, informe o nome da nova pasta.");
                return;
            }
            targetFolder = `root/${name}`;
            await CapIAuAPI.createProjectBin(projectId, name, targetFolder, "root");
            virtualEmptyFolders.add(targetFolder);
        }
        close();

        try {
            await CapIAuAPI.moveMediaToBin(mediaType, item.id, targetFolder);
            item.virtual_folder = targetFolder;
            virtualFolderMap[mediaFolderKey(item)] = targetFolder;
            saveVirtualFoldersState(projectId);

            if (window.libraryInstance) await window.libraryInstance.reloadData();
            if (typeof window.showToast === "function") {
                const displayName = targetFolder === "root" ? "Biblioteca (Raiz)" : targetFolder.replace(/^root\/?/, "");
                window.showToast(`Mídia movida para "${displayName}"!`, "success");
            }
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro ao mover mídia: " + err.message, "error");
        }
    };
}

export function promptEditMediaMetadata(item, mediaType = "video") {
    const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed) ? window.popoutWindows["sidebar-left"].document : (document.querySelector("#sidebar-left")?.ownerDocument || document);
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";

    const currentTitle = item.title || "";
    const currentCat = (item.category || "unknown").toLowerCase();
    const currentRecAt = item.recorded_at ? item.recorded_at.replace(" ", "T").substring(0, 19) : "";
    const currentDesc = item.description || "";
    const currentSummary = item.summary || "";
    const currentTags = Array.isArray(item.tags) ? item.tags.join(", ") : (item.tags || "");
    const currentVFolder = item.virtual_folder || "root";

    const catOptions = Object.entries(CATEGORY_LABELS).map(([k, label]) => {
        const isSel = k.toLowerCase() === currentCat ? "selected" : "";
        return `<option value="${k}" ${isSel}>${escapeHtml(label)}</option>`;
    }).join("");

    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 480px; padding: 20px; max-height: 90vh; overflow-y: auto;">
            <div class="modal-header" style="margin-bottom: 14px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-pen-to-square" style="color: var(--color-gold);"></i> Editar Metadados da Mídia
                </h2>
                <button class="btn-close-modal" id="btn-close-edit-meta">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 11px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 10px;">
                <div style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.03); padding: 6px 8px; border-radius: 4px; word-break: break-all;">
                    <strong>Arquivo:</strong> ${escapeHtml(item.filename || "")}<br>
                    <strong>Caminho Real:</strong> ${escapeHtml(item.filepath || "")}
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Título Editorial:</label>
                    <input type="text" id="meta-title" value="${escapeHtml(currentTitle)}" placeholder="Ex: Entrevista com Diretora" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Categoria de Triagem:</label>
                        <div class="dropdown-wrapper" style="height: 30px; padding: 0 8px; display: flex; align-items: center;">
                            <select id="meta-category" style="background: transparent; border: none; outline: none; color: #fff; font-size: 11px; width: 100%; cursor: pointer;">
                                <option value="">Sem Categoria</option>
                                ${catOptions}
                            </select>
                        </div>
                    </div>
                    <div style="flex: 1;">
                        <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Data / Diária de Gravação:</label>
                        <input type="datetime-local" id="meta-recorded-at" value="${escapeHtml(currentRecAt)}" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 5px 8px; border-radius: 4px; color: #fff; font-size: 11px;">
                    </div>
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Pasta Virtual (Bin):</label>
                    <input type="text" id="meta-vfolder" value="${escapeHtml(currentVFolder)}" placeholder="root ou root/Subpasta" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Resumo / Destaque:</label>
                    <input type="text" id="meta-summary" value="${escapeHtml(currentSummary)}" placeholder="Síntese curta da ação ou depoimento" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Descrição Detalhada:</label>
                    <textarea id="meta-description" rows="3" placeholder="Descrição visual e contextual completa..." style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px; resize: vertical;">${escapeHtml(currentDesc)}</textarea>
                </div>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Tags (separadas por vírgula):</label>
                    <input type="text" id="meta-tags" value="${escapeHtml(currentTags)}" placeholder="ex: externa, drone, luciana, por do sol" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button id="btn-cancel-edit-meta" class="btn-outline">Cancelar</button>
                <button id="btn-confirm-edit-meta" class="btn-primary">Salvar Metadados</button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-edit-meta").onclick = close;
    modal.querySelector("#btn-cancel-edit-meta").onclick = close;

    modal.querySelector("#btn-confirm-edit-meta").onclick = async () => {
        const titleVal = modal.querySelector("#meta-title").value.trim();
        const catVal = modal.querySelector("#meta-category").value;
        const recAtVal = modal.querySelector("#meta-recorded-at").value;
        const vFolderVal = modal.querySelector("#meta-vfolder").value.trim() || "root";
        const sumVal = modal.querySelector("#meta-summary").value.trim();
        const descVal = modal.querySelector("#meta-description").value.trim();
        const tagsRaw = modal.querySelector("#meta-tags").value;
        const tagsList = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);

        const payload = {
            title: titleVal,
            category: catVal || null,
            recorded_at: recAtVal ? recAtVal.replace("T", " ") : null,
            virtual_folder: vFolderVal,
            summary: sumVal,
            description: descVal,
            tags: tagsList
        };

        close();
        try {
            const res = await CapIAuAPI.updateMediaMetadata(mediaType, item.id, payload);
            if (res && res.media) {
                Object.assign(item, res.media);
            }
            if (window.libraryInstance) await window.libraryInstance.reloadData();
            if (typeof window.showToast === "function") {
                window.showToast("Metadados atualizados com sucesso!", "success");
            }
        } catch (err) {
            if (typeof window.showToast === "function") window.showToast("Erro ao salvar metadados: " + err.message, "error");
        }
    };
}

export function promptRelinkMediaDialog(prefillFolder = "") {
    const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed) ? window.popoutWindows["sidebar-left"].document : (document.querySelector("#sidebar-left")?.ownerDocument || document);
    const projectId = getActiveProjectId();
    const modal = targetDoc.createElement("div");
    modal.className = "modal-overlay";
    modal.style.display = "flex";

    modal.innerHTML = `
        <div class="modal-content glassmorphism" style="max-width: 480px; padding: 20px;">
            <div class="modal-header" style="margin-bottom: 14px;">
                <h2 style="font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-link" style="color: var(--color-cyan);"></i> Relincar Mídias / Buscar no Disco
                </h2>
                <button class="btn-close-modal" id="btn-close-relink">&times;</button>
            </div>
            <div class="modal-body" style="font-size: 11px; color: var(--text-secondary); line-height: 1.5; display: flex; flex-direction: column; gap: 10px;">
                <p>Se você trocou de computador ou moveu a pasta de arquivos, aponte a pasta raiz onde as gravações estão agora. O Talho fará uma <b>busca inteligente recursiva em todas as subpastas</b>, reconciliando os arquivos pelo nome e hash sem perder suas decupagens.</p>
                <div>
                    <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #fff;">Pasta Raiz de Busca:</label>
                    <div style="display: flex; gap: 6px;">
                        <input type="text" id="relink-folder-input" value="${escapeHtml(prefillFolder)}" placeholder="Ex: D:/MeusProjetos/Gravacoes" style="flex: 1; box-sizing: border-box; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); padding: 6px 10px; border-radius: 4px; color: #fff; font-size: 11px;">
                        <button id="btn-browse-relink" class="btn-secondary" style="font-size: 11px; padding: 0 12px; cursor: pointer;">
                            <i class="fa-solid fa-folder-open"></i> Procurar...
                        </button>
                    </div>
                </div>
                <div id="relink-status-feedback" style="display: none; padding: 8px; border-radius: 4px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); font-size: 11px;">
                </div>
            </div>
            <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button id="btn-cancel-relink" class="btn-outline">Cancelar</button>
                <button id="btn-start-relink" class="btn-primary" style="display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-arrows-rotate"></i> Iniciar Relink Recursivo
                </button>
            </div>
        </div>
    `;
    targetDoc.body.appendChild(modal);

    const close = () => modal.remove();
    modal.querySelector("#btn-close-relink").onclick = close;
    modal.querySelector("#btn-cancel-relink").onclick = close;

    const input = modal.querySelector("#relink-folder-input");
    const browseBtn = modal.querySelector("#btn-browse-relink");
    const startBtn = modal.querySelector("#btn-start-relink");
    const statusBox = modal.querySelector("#relink-status-feedback");

    browseBtn.onclick = async () => {
        try {
            const res = await CapIAuAPI.selectFolder();
            if (res && res.path) {
                input.value = res.path;
            }
        } catch (err) {
            console.error("Erro ao selecionar pasta:", err);
        }
    };

    startBtn.onclick = async () => {
        const folder = input.value.trim();
        if (!folder) {
            alert("Informe o caminho da pasta para busca.");
            return;
        }

        startBtn.disabled = true;
        startBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Buscando arquivos...`;
        statusBox.style.display = "block";
        statusBox.innerHTML = `<div style="color: var(--color-cyan);"><i class="fa-solid fa-magnifying-glass fa-spin"></i> Escaneando pasta e subpastas...</div>`;

        try {
            const res = await CapIAuAPI.relinkProjectMedia(projectId, folder);
            const relinked = res.relinked_count || 0;
            const alreadyConnected = res.already_connected_count || 0;
            const stillMissing = res.still_missing_count || 0;

            statusBox.innerHTML = `
                <div style="color: var(--color-emerald); font-weight: 600; margin-bottom: 4px;">
                    <i class="fa-solid fa-circle-check"></i> Varredura de Relink Concluída!
                </div>
                <div style="color: #fff;">
                    • <b>${relinked}</b> mídias reconectadas com sucesso.<br>
                    • <b>${alreadyConnected}</b> mídias já estavam com caminho válido.<br>
                    • <b>${stillMissing}</b> mídias continuam não encontradas no disco.
                </div>
            `;
            startBtn.innerHTML = `<i class="fa-solid fa-check"></i> Concluído`;

            if (window.libraryInstance) await window.libraryInstance.reloadData();
            if (window.timelineRenderer) window.timelineRenderer.requestRedraw();
            if (typeof window.showToast === "function") {
                window.showToast(`${relinked} arquivo(s) reconectado(s)!`, "success");
            }
        } catch (err) {
            statusBox.innerHTML = `<div style="color: var(--color-rose);"><i class="fa-solid fa-triangle-exclamation"></i> Erro ao relincar: ${escapeHtml(err.message)}</div>`;
            startBtn.disabled = false;
            startBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Tentar Novamente`;
        }
    };
}

export async function handleDropToFolder(e, targetFolderPath) {
    const dataCapiau = e.dataTransfer.getData("application/x-capiau-media");
    const projectId = getActiveProjectId();

    // 1. Mover item existente internamente na biblioteca
    if (dataCapiau) {
        try {
            const parsed = JSON.parse(dataCapiau);
            if (parsed && parsed.id) {
                const kind = parsed.type === "photo" ? "photo" : "video";
                virtualDeletedFolders.delete(targetFolderPath);
                virtualFolderMap[`${kind}:${parsed.id}`] = targetFolderPath;
                saveVirtualFoldersState(projectId);

                // Persiste no banco: antes o move so existia no localStorage e
                // era perdido em outra maquina ou apos limpar o navegador.
                try {
                    await CapIAuAPI.moveMediaToBin(kind, parsed.id, targetFolderPath);
                    const list = kind === "photo" ? (STATE.allPhotos || []) : (STATE.allVideos || []);
                    const moved = list.find(m => m.id === parsed.id);
                    if (moved) moved.virtual_folder = targetFolderPath;
                } catch (apiErr) {
                    console.error("Falha ao persistir o move da mídia:", apiErr);
                    if (typeof window.showToast === "function") {
                        window.showToast("Mídia movida só nesta sessão: " + apiErr.message, "warning");
                    }
                }

                if (window.libraryInstance) await window.libraryInstance.reloadData();
                if (typeof window.showToast === "function") {
                    window.showToast("Mídia movida para a pasta.", "success");
                }
                return;
            }
        } catch (err) {}
    }

    // 2. Arquivos físicos soltos do Windows Explorer
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        // Verifica se temos caminhos de disco direto (ex: Electron ou navegadores com file.path)
        const directPaths = [];
        for (let i = 0; i < files.length; i++) {
            if (files[i].path) {
                directPaths.push(files[i].path.replace(/\\/g, "/"));
            }
        }

        if (directPaths.length > 0 && directPaths.length === files.length) {
            try {
                if (typeof window.showToast === "function") {
                    window.showToast(`Importando ${directPaths.length} mídia(s) in-place...`, "info");
                }
                const res = await CapIAuAPI.triggerExternalFilesIngest(directPaths, projectId);
                if (res && res.status === "success") {
                    if (targetFolderPath && targetFolderPath !== "root") {
                        virtualDeletedFolders.delete(targetFolderPath);
                        virtualEmptyFolders.add(targetFolderPath);
                        saveVirtualFoldersState(projectId);
                    }
                    if (typeof window.showToast === "function") {
                        window.showToast(`${directPaths.length} mídia(s) vinculada(s) com sucesso!`, "success");
                    }
                    if (window.libraryInstance) await window.libraryInstance.reloadData();
                    if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                        window.openTasksDrawerAndSwitchTab();
                    }
                }
                return;
            } catch (err) {
                console.error("[DragDrop] Ingestão in-place falhou:", err);
            }
        }

        const formData = new FormData();
        formData.append("project_id", projectId);
        let validFileCount = 0;
        for (let i = 0; i < files.length; i++) {
            formData.append("files", files[i]);
            validFileCount++;
        }

        if (validFileCount > 0) {
            try {
                if (typeof window.showToast === "function") {
                    window.showToast(`Importando ${validFileCount} arquivo(s)...`, "info");
                }
                const res = await fetch("/api/ingest/upload-files", {
                    method: "POST",
                    body: formData
                });
                const data = await res.json();
                if (data.status === "success") {
                    if (targetFolderPath && targetFolderPath !== "root") {
                        virtualDeletedFolders.delete(targetFolderPath);
                        virtualEmptyFolders.add(targetFolderPath);
                        saveVirtualFoldersState(projectId);
                    }
                    if (typeof window.showToast === "function") {
                        window.showToast(`${data.count || validFileCount} arquivo(s) importado(s) com sucesso!`, "success");
                    }
                    if (window.libraryInstance) await window.libraryInstance.reloadData();
                    if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                        window.openTasksDrawerAndSwitchTab();
                    }
                }
            } catch (err) {
                if (typeof window.showToast === "function") {
                    window.showToast("Erro ao importar arquivos arrastados: " + err.message, "error");
                }
            }
            return;
        }
    }

    // 3. Pastas virtuais arrastadas
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
        let folderCount = 0;
        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
            if (entry && entry.isDirectory) {
                const subfolderPath = targetFolderPath === "root" ? `root/${entry.name}` : `${targetFolderPath}/${entry.name}`;
                virtualDeletedFolders.delete(subfolderPath);
                virtualEmptyFolders.add(subfolderPath);
                folderCount++;
            }
        }
        if (folderCount > 0) {
            saveVirtualFoldersState(projectId);
            if (window.libraryInstance) window.libraryInstance.reloadData();
            if (typeof window.showToast === "function") {
                window.showToast(`${folderCount} pasta(s) vinculada(s) à biblioteca!`, "success");
            }
        }
    }
}

export function initLibraryDragAndDrop(libInstance) {
    const libraryContainer = document.getElementById("sidebar-left");
    if (!libraryContainer) return;

    libraryContainer.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    libraryContainer.addEventListener("drop", async (e) => {
        if (e.target.closest(".tree-folder-header")) return; // Já tratado pelo listener da pasta
        e.preventDefault();
        e.stopPropagation();
        await handleDropToFolder(e, "root");
    });
}


function hasMatchingChildren(node, query, ast = null) {
    if (!query) return true;
    if (!ast) ast = getCachedQueryAST(query);
    if (!ast) return true;
    
    if (node.type === "file") {
        const item = node.video || node.photo;
        return evaluateAST(ast, item, "tab-media");
    }
    if (node.type === "folder") {
        // Smart Bins fechados ainda nao materializaram os filhos: avalia a fonte.
        if (node.sourceItems && Object.keys(node.children).length === 0) {
            return node.sourceItems.some(item => evaluateAST(ast, item, "tab-media"));
        }
        return Object.values(node.children).some(child => hasMatchingChildren(child, query, ast));
    }
    return false;
}

/**
 * Discrimina video de foto. STATE.allVideos/allPhotos marcam `_mediaKind` em
 * renderMedia; as heuristicas abaixo sao apenas fallback para itens avulsos
 * (a checagem antiga `!!item.duration` classificava video de duracao 0 como foto).
 */
/**
 * Contexto resolvido uma vez por render. Antes, cada no da arvore refazia
 * document.getElementById("library-search-input"), parseQuery(...) e
 * localStorage.getItem("library_sort_by") — ~2000 vezes por render.
 */
let renderCtx = { query: "", ast: null, sortBy: "name_asc" };
let lastRenderedTree = null;

/**
 * Coleta os caminhos de pasta da ULTIMA arvore renderizada.
 * Antes, expandir/recolher recalculava caminhos a partir do filepath de disco —
 * caminhos que a arvore virtual nao usa mais, entao o botao nao expandia nada.
 */
const SMART_BINS_ROOT = "smart_bins_root";

function collectFolderPaths(node, out = [], filterPrefix = null, skipSmartBins = false) {
    if (!node || node.type !== "folder") return out;
    // Os Smart Bins sao uma VISAO: cada midia aparece de novo em Diárias,
    // Categorias e Tipos. Abrir todos de uma vez quadruplica o DOM sem
    // mostrar nada novo, entao "expandir tudo" nao os inclui — eles abrem
    // no clique direto, que continua funcionando.
    if (skipSmartBins && node.path && node.path.startsWith(SMART_BINS_ROOT)) return out;
    if (node.path && node.path !== "root") {
        if (!filterPrefix || node.path === filterPrefix || node.path.startsWith(filterPrefix + "/")) {
            out.push(node.path);
        }
    }
    if (node.children) {
        for (const key of Object.keys(node.children)) {
            collectFolderPaths(node.children[key], out, filterPrefix, skipSmartBins);
        }
    }
    return out;
}
const _queryASTCache = new Map();

function getCachedQueryAST(query) {
    if (!query) return null;
    if (_queryASTCache.has(query)) return _queryASTCache.get(query);
    let ast = null;
    try {
        ast = parseQuery(query);
    } catch (e) {
        ast = null;
    }
    if (_queryASTCache.size > 40) _queryASTCache.clear();
    _queryASTCache.set(query, ast);
    return ast;
}

function refreshRenderContext() {
    const doc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
        ? window.popoutWindows["sidebar-left"].document
        : (window.libraryInstance?.activeDoc || document);
    const searchInput = doc.getElementById("library-search-input") || document.getElementById("library-search-input");
    const query = searchInput ? searchInput.value.trim() : "";
    const sortSelect = doc.getElementById("library-sort-by") || document.getElementById("library-sort-by");
    renderCtx = {
        query,
        ast: query ? getCachedQueryAST(query) : null,
        sortBy: sortSelect?.value || localStorage.getItem("library_sort_by") || "name_asc"
    };
    return renderCtx;
}

function isVideoItem(item) {
    if (!item) return false;
    if (item._mediaKind) return item._mediaKind === "video";
    if (item.type === "video") return true;
    if (item.video_type !== undefined) return true;
    return typeof item.duration === "number";
}

/**
 * Chave do mapa legado de bins em localStorage. Antes era so o id numerico —
 * e como video e foto agora dividem a mesma arvore, o video #5 e a foto #5
 * caiam no mesmo bin. Novas gravacoes usam chave "tipo:id".
 */
function mediaFolderKey(item) {
    return `${isVideoItem(item) ? "video" : "photo"}:${item.id}`;
}

/**
 * Pasta virtual efetiva de um item. O banco e a fonte de verdade; o mapa em
 * localStorage sobrevive apenas como legado dos bins criados antes da coluna
 * virtual_folder existir (e so vale para video, que era a unica aba com drag).
 */
function getItemVirtualFolder(item) {
    const stored = item.virtual_folder;
    if (stored && stored !== "root") return stored;
    const typed = virtualFolderMap[mediaFolderKey(item)];
    if (typed) return typed;
    if (isVideoItem(item) && virtualFolderMap[item.id]) return virtualFolderMap[item.id];
    return stored || "root";
}

function makeMediaFileNode(item) {
    const name = item.filename
        || (item.filepath ? item.filepath.split(/[\\/]+/).filter(Boolean).pop() : `Item #${item.id}`);
    const node = { name, type: "file" };
    if (isVideoItem(item)) node.video = item;
    else node.photo = item;
    return node;
}

function mediaFileKey(item, name) {
    return `${isVideoItem(item) ? "video" : "photo"}_${item.id}_${name}`;
}

function buildTree(items) {
    const projectId = getActiveProjectId();
    loadVirtualFoldersState(projectId);
    loadOpenFoldersState(projectId);

    const root = {
        name: "Biblioteca",
        type: "folder",
        path: "root",
        children: {},
        isRoot: true,
        isOpen: true
    };

    // 1. Inserir todos os Bins Virtuais cadastrados no projeto (mesmo vazios)
    if (Array.isArray(window.projectBinsList)) {
        window.projectBinsList.forEach(b => {
            if (isPathDeleted(b.path)) return;
            const relativeParts = b.path.replace(/^root\/?/, "").split("/").filter(Boolean);
            let curr = root;
            let cPath = "root";
            for (let p of relativeParts) {
                cPath = cPath + "/" + p;
                if (!curr.children[p]) {
                    curr.children[p] = {
                        name: p,
                        type: "folder",
                        path: cPath,
                        children: {},
                        color: b.color || virtualFolderColors[cPath],
                        isOpen: openFoldersSet.has(cPath)
                    };
                }
                curr = curr.children[p];
            }
        });
    }

    // Também inserir de virtualEmptyFolders
    virtualEmptyFolders.forEach(folderPath => {
        if (isPathDeleted(folderPath)) return;
        const relativeParts = folderPath.replace(/^root\/?/, "").split("/").filter(Boolean);
        let curr = root;
        let cPath = "root";
        for (let p of relativeParts) {
            cPath = cPath + "/" + p;
            if (!curr.children[p]) {
                curr.children[p] = {
                    name: p,
                    type: "folder",
                    path: cPath,
                    children: {},
                    isOpen: openFoldersSet.has(cPath)
                };
            }
            curr = curr.children[p];
        }
    });

    // 2. Inserir itens de mídia diretamente nos seus bins virtuais (sem poluição de pastas de disco)
    if (items && items.length > 0) {
        items.forEach(v => {
            const vPath = getItemVirtualFolder(v);
            if (isPathDeleted(vPath)) return;

            let current = root;
            if (vPath && vPath !== "root") {
                const folderParts = vPath.replace(/^root\/?/, "").split("/").filter(Boolean);
                let currentPath = "root";
                for (let folderName of folderParts) {
                    currentPath = currentPath + "/" + folderName;
                    if (isPathDeleted(currentPath)) return;
                    if (!current.children[folderName]) {
                        current.children[folderName] = {
                            name: folderName,
                            type: "folder",
                            path: currentPath,
                            children: {},
                            isOpen: openFoldersSet.has(currentPath)
                        };
                    }
                    current = current.children[folderName];
                }
            }

            const fileNode = makeMediaFileNode(v);
            current.children[mediaFileKey(v, fileNode.name)] = fileNode;
        });

        // 3. Montar Ramo de Pastas Inteligentes (Smart Bins)
        //    Os nos-folha guardam apenas a REFERENCIA ao array de itens (sourceItems).
        //    Os nos de arquivo so sao materializados quando a pasta e aberta
        //    (populateFolderChildren) — antes disso cada item era clonado 3x por render.
        const smartRootPath = "smart_bins_root";
        const smartRoot = {
            name: "Pastas Inteligentes",
            type: "folder",
            path: smartRootPath,
            isSmartRoot: true,
            children: {},
            isOpen: openFoldersSet.has(smartRootPath) // Recolhida por padrão, persistida se aberta
        };

        const makeSmartGroup = (parentPath, key, label, groupItems) => ({
            name: label,
            type: "folder",
            path: `${parentPath}/${key}`,
            isSmartBin: true,
            badge: `${groupItems.length}`,
            children: {},
            sourceItems: groupItems,
            isOpen: openFoldersSet.has(`${parentPath}/${key}`)
        });

        // Smart Bin: Diárias de Gravação
        const diariasPath = "smart_bins_root/diarias";
        const diariasNode = {
            name: "Diárias de Gravação",
            type: "folder",
            path: diariasPath,
            isSmartBin: true,
            icon: "fa-calendar-days",
            color: "var(--color-cyan)",
            children: {},
            isOpen: openFoldersSet.has(diariasPath)
        };

        // Smart Bin: Categorias de Triagem
        const catPath = "smart_bins_root/categorias";
        const catNode = {
            name: "Categorias de Triagem",
            type: "folder",
            path: catPath,
            isSmartBin: true,
            icon: "fa-tags",
            color: "var(--color-violet)",
            children: {},
            isOpen: openFoldersSet.has(catPath)
        };

        // Smart Bin: Tipos de Mídia
        const tiposPath = "smart_bins_root/tipos";
        const tiposNode = {
            name: "Tipos de Mídia",
            type: "folder",
            path: tiposPath,
            isSmartBin: true,
            icon: "fa-layer-group",
            color: "#f59e0b",
            children: {},
            isOpen: openFoldersSet.has(tiposPath)
        };

        // Uma unica passada sobre os itens alimenta os tres agrupamentos
        const itemsByDate = {};
        const itemsByCat = {};
        const vids = [];
        const photos = [];
        items.forEach(item => {
            const stamp = item.recorded_at || item.created_at || "";
            const dateKey = stamp ? (stamp.split(" ")[0] || "Sem Data") : "Sem Data";
            (itemsByDate[dateKey] || (itemsByDate[dateKey] = [])).push(item);

            const catKey = item.category ? (CATEGORY_LABELS[item.category] || item.category) : "Sem Categoria";
            (itemsByCat[catKey] || (itemsByCat[catKey] = [])).push(item);

            if (isVideoItem(item)) vids.push(item);
            else photos.push(item);
        });

        Object.keys(itemsByDate).sort().reverse().forEach(dt => {
            diariasNode.children[dt] = makeSmartGroup(diariasPath, dt, dt, itemsByDate[dt]);
        });
        smartRoot.children["diarias"] = diariasNode;

        Object.keys(itemsByCat).sort().forEach(cat => {
            catNode.children[cat] = makeSmartGroup(catPath, cat, cat, itemsByCat[cat]);
        });
        smartRoot.children["categorias"] = catNode;

        if (vids.length > 0) tiposNode.children["videos"] = makeSmartGroup(tiposPath, "videos", "Vídeos", vids);
        if (photos.length > 0) tiposNode.children["fotos"] = makeSmartGroup(tiposPath, "fotos", "Fotos", photos);
        smartRoot.children["tipos"] = tiposNode;

        root.children["__smart_bins__"] = smartRoot;
    }

    return root;
}

function formatTimecode(sec) {
    if (isNaN(sec) || sec === null || sec < 0) return "00:00:00:00";
    const fpsVal = Number(window.TIMELINE_STATE?.fps) > 0 ? Number(window.TIMELINE_STATE?.fps) : 24;
    const totalIntFrames = Math.max(0, Math.round(Number(sec) * fpsVal));
    const totalSeconds = Math.floor(totalIntFrames / fpsVal);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const frames = Math.min(Math.floor(fpsVal) - 1, Math.max(0, Math.floor(totalIntFrames % fpsVal)));
    
    const pad = (n) => String(Math.floor(Math.abs(Number(n) || 0))).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function hasFailedChildren(node) {
    if (node.type === "file") {
        const v = node.video;
        if (!v) return false;
        return window.libraryInstance ? window.libraryInstance.isMediaFailed(v) : false;
    }
    if (node.type === "folder") {
        if (node.sourceItems && Object.keys(node.children).length === 0) {
            return node.sourceItems.some(item =>
                window.libraryInstance ? window.libraryInstance.isMediaFailed(item) : false);
        }
        return Object.values(node.children).some(child => hasFailedChildren(child));
    }
    return false;
}

const ARROW_DOWN_PATH = "M3 6 L8 11 L13 6";
const ARROW_UP_PATH   = "M3 10 L8 5 L13 10";

/**
 * Animação de fluxo vetorial contínuo de 5 setinhas (Opção A em 0.5x = 0.9s de duração suave)
 */
function animateStreamToggle(btnEl, goingToExpand, onComplete) {
    if (!btnEl) {
        if (onComplete) onComplete();
        return;
    }
    const viewport = btnEl.querySelector(".stream-viewport");
    if (!viewport) {
        if (onComplete) onComplete();
        return;
    }

    const count = 5;
    let arrowsHtml = "";
    if (goingToExpand) {
        // Fluxo descendo: 4 setas para baixo e a última apontando para cima
        for (let i = 0; i < count - 1; i++) {
            arrowsHtml += `<svg class="arrow-svg" style="margin-bottom: 3px;" viewBox="0 0 16 16"><path d="${ARROW_DOWN_PATH}" /></svg>`;
        }
        arrowsHtml += `<svg class="arrow-svg" viewBox="0 0 16 16"><path d="${ARROW_UP_PATH}" /></svg>`;
    } else {
        // Fluxo subindo: 1 seta para baixo na base e 4 setas para cima
        arrowsHtml += `<svg class="arrow-svg" viewBox="0 0 16 16"><path d="${ARROW_DOWN_PATH}" /></svg>`;
        for (let i = 0; i < count - 1; i++) {
            arrowsHtml += `<svg class="arrow-svg" style="margin-top: 3px;" viewBox="0 0 16 16"><path d="${ARROW_UP_PATH}" /></svg>`;
        }
    }

    viewport.innerHTML = `<div class="stream-track ${goingToExpand ? 'stream-anim-down' : 'stream-anim-up'}">${arrowsHtml}</div>`;
    btnEl.classList.remove("state-collapsed", "state-expanded");
    btnEl.classList.add(goingToExpand ? "state-expanded" : "state-collapsed");

    setTimeout(() => {
        const finalPath = goingToExpand ? ARROW_UP_PATH : ARROW_DOWN_PATH;
        viewport.innerHTML = `<svg class="arrow-svg" viewBox="0 0 16 16"><path d="${finalPath}" /></svg>`;
        if (onComplete) onComplete();
    }, 900);
}

function getSortedChildrenKeys(node) {
    if (!node || !node.children) return [];
    const sortBy = renderCtx.sortBy || "name_asc";

    return Object.keys(node.children).sort((a, b) => {
        const nodeA = node.children[a];
        const nodeB = node.children[b];
        if (nodeA.type !== nodeB.type) {
            return nodeA.type === "folder" ? -1 : 1;
        }
        if (nodeA.type === "folder") {
            if (sortBy === "name_desc") {
                return b.localeCompare(a);
            }
            return a.localeCompare(b);
        }
        const itemA = nodeA.video || nodeA.photo;
        const itemB = nodeB.video || nodeB.photo;
        if (!itemA || !itemB) return a.localeCompare(b);

        if (sortBy === "name_asc") {
            const nameA = itemA.filename || itemA.title || "";
            const nameB = itemB.filename || itemB.title || "";
            return nameA.localeCompare(nameB);
        } else if (sortBy === "name_desc") {
            const nameA = itemA.filename || itemA.title || "";
            const nameB = itemB.filename || itemB.title || "";
            return nameB.localeCompare(nameA);
        } else if (sortBy === "type_interview") {
            if (nodeA.video) {
                const typeA = itemA.video_type === "interview" ? 0 : (itemA.video_type === "broll" ? 1 : 2);
                const typeB = itemB.video_type === "interview" ? 0 : (itemB.video_type === "broll" ? 1 : 2);
                if (typeA !== typeB) return typeA - typeB;
            } else if (nodeA.photo) {
                const catA = itemA.category || "";
                const catB = itemB.category || "";
                if (catA !== catB) return catA.localeCompare(catB);
            }
            return (itemA.filename || "").localeCompare(itemB.filename || "");
        } else if (sortBy === "type_broll") {
            if (nodeA.video) {
                const typeA = itemA.video_type === "broll" ? 0 : (itemA.video_type === "interview" ? 1 : 2);
                const typeB = itemB.video_type === "broll" ? 0 : (itemB.video_type === "interview" ? 1 : 2);
                if (typeA !== typeB) return typeA - typeB;
            } else if (nodeA.photo) {
                const catA = itemA.category || "";
                const catB = itemB.category || "";
                if (catA !== catB) return catA.localeCompare(catB);
            }
            return (itemA.filename || "").localeCompare(itemB.filename || "");
        } else if (sortBy === "duration_desc") {
            const durA = itemA.duration || 0;
            const durB = itemB.duration || 0;
            if (durB !== durA) return durB - durA;
            return (itemB.id || 0) - (itemA.id || 0);
        } else if (sortBy === "date_desc") {
            return (itemB.id || 0) - (itemA.id || 0);
        }
        return a.localeCompare(b);
    });
}

/**
 * Materializa os nos de arquivo de um Smart Bin apenas quando ele e aberto.
 * Enquanto fechado o no guarda so a referencia ao array de itens.
 */
function materializeSmartBinChildren(node) {
    if (!node || !node.sourceItems) return;
    if (Object.keys(node.children).length > 0) return;
    node.sourceItems.forEach(item => {
        const fileNode = makeMediaFileNode(item);
        node.children[mediaFileKey(item, fileNode.name)] = fileNode;
    });
}

// ── RENDERIZACAO EM BLOCOS ────────────────────────────────────────────
// Montar ~2000 cards de uma vez e uma tarefa unica de ~300ms que trava a
// interface inteira. Aqui o primeiro bloco entra na hora (a lista aparece
// imediatamente) e o resto e preenchido em tempo ocioso, em tarefas curtas.
// Nao usamos rolagem como gatilho de proposito: isso faria a barra de rolagem
// crescer enquanto o usuario rola e quebraria o indice lateral da biblioteca.
const RENDER_CHUNK_SIZE = 120;
// Se o agendador ficar parado esse tempo, monta o resto de uma vez.
const CHUNK_STALL_TIMEOUT_MS = 1000;
const pendingChunkJobs = new Set();

function cancelPendingChunkJobs() {
    pendingChunkJobs.forEach(job => job.cancel());
    pendingChunkJobs.clear();
}

function appendChildrenChunked(node, keys, container, childDepth) {
    const renderRange = (from, to) => {
        const frag = document.createDocumentFragment();
        for (let i = from; i < to; i++) {
            renderTreeNode(node.children[keys[i]], frag, childDepth);
        }
        container.appendChild(frag);
    };

    if (keys.length <= RENDER_CHUNK_SIZE) {
        renderRange(0, keys.length);
        container._flushAllChunks = null;
        return;
    }

    let cursor = RENDER_CHUNK_SIZE;
    renderRange(0, cursor); // primeiro bloco sincrono: a lista nunca aparece vazia

    let rafId = null;
    let stallId = null;

    const parar = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (stallId !== null) clearTimeout(stallId);
        rafId = null;
        stallId = null;
    };

    // Monta tudo que falta agora. Usado pela rede de seguranca e por
    // flushAllPendingChunks (revelar um item exige o card no DOM).
    const concluir = () => {
        parar();
        if (cursor < keys.length) {
            renderRange(cursor, keys.length);
            cursor = keys.length;
        }
        pendingChunkJobs.delete(job);
        container._flushAllChunks = null;
    };

    const job = { cancel: () => { parar(); container._flushAllChunks = null; } };

    // requestAnimationFrame, nao setTimeout: em janela visivel entrega um bloco
    // por quadro sem travar nada. Com a janela oculta o rAF nao dispara — por
    // isso a rede de seguranca abaixo conclui de uma vez.
    const armarRedeDeSeguranca = () => {
        if (stallId !== null) clearTimeout(stallId);
        stallId = setTimeout(concluir, CHUNK_STALL_TIMEOUT_MS);
    };

    const step = () => {
        rafId = null;
        const end = Math.min(cursor + RENDER_CHUNK_SIZE, keys.length);
        renderRange(cursor, end);
        cursor = end;
        if (cursor < keys.length) {
            rafId = requestAnimationFrame(step);
            armarRedeDeSeguranca();
        } else {
            concluir();
        }
    };

    container._flushAllChunks = concluir;
    pendingChunkJobs.add(job);
    rafId = requestAnimationFrame(step);
    armarRedeDeSeguranca();
}

/** Garante que todos os blocos pendentes entraram no DOM (revelar item, exportar, etc). */
function flushAllPendingChunks(root) {
    const scope = root || document.getElementById("media-tree-list");
    if (!scope) return;
    if (typeof scope._flushAllChunks === "function") scope._flushAllChunks();
    scope.querySelectorAll(".tree-folder-children").forEach(el => {
        if (typeof el._flushAllChunks === "function") el._flushAllChunks();
    });
}

function populateFolderChildren(node, folderChildren, depth) {
    materializeSmartBinChildren(node);
    folderChildren.innerHTML = "";
    appendChildrenChunked(node, getSortedChildrenKeys(node), folderChildren, depth + 1);
}

function renderTreeNode(node, container, depth = 0) {
    if (node.type === "folder") {
        if (renderCtx.ast && !hasMatchingChildren(node, renderCtx.query, renderCtx.ast)) {
            return;
        }
        if (window.libraryInstance && window.libraryInstance.isFailedFilterActive) {
            if (!hasFailedChildren(node)) {
                return;
            }
        }
        const folderDiv = document.createElement("div");
        folderDiv.className = "tree-folder-container";
        
        const folderHeader = document.createElement("div");
        folderHeader.className = "tree-folder-header";
        folderHeader.style.paddingLeft = `${depth * 10 + 10}px`;
        
        const icon = node.isOpen ? "fa-folder-open" : "fa-folder";
        const chevron = node.isOpen ? "fa-chevron-down" : "fa-chevron-right";
        const folderColor = virtualFolderColors[node.path] || "var(--color-violet)";
        const isFolderOpen = !!node.isOpen;
        const toggleIconPath = isFolderOpen ? ARROW_UP_PATH : ARROW_DOWN_PATH;
        const toggleStateClass = isFolderOpen ? "state-expanded" : "state-collapsed";
        const toggleTitle = isFolderOpen ? "Recolher todas as subpastas" : "Expandir todas as subpastas";
        
        folderHeader.innerHTML = `
            <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
                <i class="fa-solid ${chevron} chevron-icon" style="font-size:9px; margin-right:6px; color:var(--text-muted);"></i>
                <i class="fa-solid ${icon} folder-icon" style="color:${folderColor}; margin-right:8px;"></i>
                <span class="folder-name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${node.name}</span>
            </div>
            <div class="folder-actions" style="display: flex; gap: 4px; margin-right: 6px;">
                <button class="btn-folder-action" data-action="add-media" title="Importar mídias para esta pasta" style="background: none; border: none; padding: 2px 4px; color: var(--color-cyan); cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-plus"></i>
                </button>
                <button class="btn-folder-action btn-folder-toggle ${toggleStateClass}" data-action="toggle-subfolders" title="${toggleTitle}" style="background: none; border: none; padding: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                    <div class="stream-viewport mini">
                        <svg class="arrow-svg" viewBox="0 0 16 16"><path d="${toggleIconPath}" /></svg>
                    </div>
                </button>
            </div>
        `;
        folderHeader.dataset.folderPath = node.path;
        
        const folderChildren = document.createElement("div");
        folderChildren.className = "tree-folder-children";
        if (node.isOpen) {
            populateFolderChildren(node, folderChildren, depth);
            folderChildren.style.display = "block";
            folderChildren.removeAttribute("hidden");
        } else {
            folderChildren.style.display = "none";
            folderChildren.setAttribute("hidden", "true");
        }
        
        folderHeader.addEventListener("click", (e) => {
            e.stopPropagation();
            
            // Marca a pasta selecionada
            window.selectedLibraryFolder = node;
            document.querySelectorAll(".tree-folder-header.selected-folder").forEach(el => el.classList.remove("selected-folder"));
            folderHeader.classList.add("selected-folder");

            const actionBtn = e.target.closest(".btn-folder-action");
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const path = folderHeader.dataset.folderPath;
                if (action === "add-media") {
                    handleImportToFolder(path, actionBtn);
                    return;
                }
                if (action === "toggle-subfolders") {
                    const isCurrentlyExpanded = actionBtn.classList.contains("state-expanded");
                    const willExpand = !isCurrentlyExpanded;
                    actionBtn.title = willExpand ? "Recolher todas as subpastas" : "Expandir todas as subpastas";
                    animateStreamToggle(actionBtn, willExpand, () => {
                        window.expandCollapseAllSubfolders(path, willExpand);
                    });
                    return;
                }
                return;
            }
            
            node.isOpen = !node.isOpen;
            const newChevron = node.isOpen ? "fa-chevron-down" : "fa-chevron-right";
            const newIcon = node.isOpen ? "fa-folder-open" : "fa-folder";
            
            folderHeader.querySelector(".chevron-icon").className = `fa-solid ${newChevron} chevron-icon`;
            folderHeader.querySelector(".folder-icon").className = `fa-solid ${newIcon} folder-icon`;
            
            const folderToggleBtn = folderHeader.querySelector(".btn-folder-toggle");
            if (folderToggleBtn) {
                folderToggleBtn.classList.remove("state-collapsed", "state-expanded");
                folderToggleBtn.classList.add(node.isOpen ? "state-expanded" : "state-collapsed");
                folderToggleBtn.title = node.isOpen ? "Recolher todas as subpastas" : "Expandir todas as subpastas";
                const vp = folderToggleBtn.querySelector(".stream-viewport");
                if (vp) {
                    const finalPath = node.isOpen ? ARROW_UP_PATH : ARROW_DOWN_PATH;
                    vp.innerHTML = `<svg class="arrow-svg" viewBox="0 0 16 16"><path d="${finalPath}" /></svg>`;
                }
            }
            
            if (node.isOpen) {
                if (folderChildren.children.length === 0) {
                    populateFolderChildren(node, folderChildren, depth);
                }
                folderChildren.style.display = "block";
                folderChildren.removeAttribute("hidden");
                openFoldersSet.add(node.path);
            } else {
                folderChildren.style.display = "none";
                folderChildren.setAttribute("hidden", "true");
                openFoldersSet.delete(node.path);
            }
            saveOpenFoldersState();
        });

        // Clique direito sobre a pasta abre o Menu de Contexto de Bins
        folderHeader.addEventListener("contextmenu", (e) => {
            showFolderContextMenu(e, node, folderHeader);
        });

        // Drag & drop específico sobre a pasta
        folderHeader.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            folderHeader.classList.add("folder-drag-over");
        });
        folderHeader.addEventListener("dragleave", (e) => {
            folderHeader.classList.remove("folder-drag-over");
        });
        folderHeader.addEventListener("drop", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderHeader.classList.remove("folder-drag-over");
            await handleDropToFolder(e, node.path);
        });
        
        folderDiv.appendChild(folderHeader);
        folderDiv.appendChild(folderChildren);
        container.appendChild(folderDiv);
    } else if (node.type === "file" && node.video) {
        const v = node.video;
        
        // Verifica se corresponde ao filtro de busca
        if (renderCtx.ast && !evaluateAST(renderCtx.ast, v, "tab-media")) {
            return; // Oculta se não corresponder
        }

        const friendlyTitle = getFriendlyTitle(v);
        const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[v.id] === "filename";
        const currentTitle = forceRealFilename ? v.filename : friendlyTitle;
        
        const hasVisionError = window.libraryInstance ? window.libraryInstance.isMediaFailed(v) : (v.status === "error");

        if (window.libraryInstance && window.libraryInstance.isFailedFilterActive) {
            if (!hasVisionError) return;
        }

        const card = document.createElement("div");
        card.className = "media-card tree-file-item" + (hasVisionError ? " has-vision-error" : "");
        card.setAttribute("data-video-id", v.id);
        card.style.paddingLeft = "6px";
        if (STATE.activeVideo && STATE.activeVideo.id === v.id) card.classList.add("active");
        
        const badgeClass = v.video_type === "interview" ? "tag-interview" : "tag-broll";
        const badgeLabel = v.video_type === "interview" ? "Fala" : "Bastidores";
        
        let statusGlow = "";
        let statusBadge = "";
        let actionBtn = "";
        
        const isConverting = STATE.activeConversions && STATE.activeConversions[v.id];
        
        if (v.status === "pending") {
            statusGlow = `<i class="fa-solid fa-circle-notch fa-spin proxy-spin-icon" style="color: var(--color-cyan);" data-tooltip="Gerando proxy..."></i>`;
        } else if (v.status === "transcribing" || v.status === "processing") {
            if (isConverting) {
                statusGlow = `<i class="fa-solid fa-circle-notch fa-spin proxy-spin-icon" style="color: var(--color-cyan);" data-tooltip="Convertendo..."></i>`;
                actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--color-rose); cursor:pointer; padding:2px;" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" data-tooltip="Cancelar Conversão"><i class="fa-solid fa-circle-stop" style="font-size:10px;"></i></button>`;
            } else {
                statusGlow = `<span class="waveform-anim-icon" data-tooltip="Processando áudio / ASR..."><span class="waveform-anim-bar"></span><span class="waveform-anim-bar"></span><span class="waveform-anim-bar"></span><span class="waveform-anim-bar"></span></span>`;
            }
        } else if (v.status === "analyzing") {
            statusGlow = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--color-violet);" data-tooltip="Analisando visão com IA..."></i>`;
            actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--color-rose); cursor:pointer; padding:2px;" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" data-tooltip="Cancelar Análise"><i class="fa-solid fa-circle-stop" style="font-size:10px;"></i></button>`;
        } else if (v.status === "transcribed") {
            statusBadge = `<span class="badge" style="color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3);">ASR</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "analyzed") {
            if (hasVisionError) {
                statusBadge = `<span class="badge" style="color: var(--color-rose); border-color: rgba(244, 63, 94, 0.4);">FALHA VISUAL</span>`;
            } else {
                statusBadge = `<span class="badge" style="color: var(--color-violet); border-color: rgba(138, 92, 246, 0.3);">VISÃO</span>`;
            }
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "ingested") {
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "error") {
            statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);" data-tooltip="Erro no processamento!"></i>`;
            actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Limpar Vídeo/Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        }
        
        // Thumbnail (Real ou Ícone)
        const showRealThumb = !document.body.classList.contains("hide-thumbnails") && document.getElementById("chk-show-thumbnails")?.checked !== false;
        let thumbContent = `<i class="fa-solid ${v.video_type === 'interview' ? 'fa-microphone-lines' : 'fa-film'}"></i>`;
        if (showRealThumb && v.status !== "pending" && v.status !== "error") {
            const vVersion = v._thumbVersion || v.thumb_version || v.updated_at || "";
            const qs = vVersion ? `?v=${vVersion}` : "";
            const fallbackIcon = v.video_type === 'interview' ? 'fa-microphone-lines' : 'fa-film';
            thumbContent = `<img src="/api/video/${v.id}/thumbnail${qs}" alt="Thumb" loading="lazy" decoding="async" onerror="this.onerror=null; this.style.display='none'; if(this.parentNode) this.parentNode.insertAdjacentHTML('beforeend', '<i class=\\'fa-solid ${fallbackIcon}\\'></i>');">`;
        }
        
        // Toggle title display icon
        const toggleTitleIcon = forceRealFilename ? "fa-file-signature" : "fa-font";
        const toggleTitleTitle = forceRealFilename ? "Mostrar Título Contextual" : "Mostrar Nome do Arquivo Real";
        const toggleBtnHtml = `<button class="btn-toggle-filename" data-tooltip="${toggleTitleTitle}"><i class="fa-solid ${toggleTitleIcon}"></i></button>`;

        // Tooltip rica e direta via buildMediaTooltip
        const tooltip = buildMediaTooltip(v, "video", forceRealFilename);
        const { descHtml, speakerHtml, tagsHtml } = getMediaRichContent(v, "video", currentTitle);

        const visionBadgeHtml = hasVisionError ? `<div class="vision-error-badge" data-tooltip="Falha visual detectada. Clique em Reanalisar Falhas no topo"><i class="fa-solid fa-triangle-exclamation"></i> Falha Visual</div>` : '';

        const overrideBtnHtml = hasVisionError
            ? `<button class="btn-card-action btn-hover-only btn-quick-override-ok" style="background:transparent; border:none; color:var(--color-emerald); cursor:pointer; padding: 2px;" data-tooltip="Marcar como Analisado (Ignorar Falha)"><i class="fa-solid fa-circle-check" style="font-size: 10px;"></i></button>`
            : `<button class="btn-card-action btn-hover-only btn-quick-override-fail" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" data-tooltip="Sinalizar Falha Visual (Mandar para Reanálise)"><i class="fa-solid fa-triangle-exclamation" style="font-size: 10px;"></i></button>`;

        card.innerHTML = `
            <div class="media-thumbnail" style="position: relative;">
                ${thumbContent}
                ${visionBadgeHtml}
                <button class="btn-select-similar-item" data-tooltip="Selecionar para busca por similaridade" style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border: none; background: rgba(0,0,0,0.6); color: var(--text-muted); font-size: 10px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 3px; z-index: 10;">
                    <i class="fa-regular fa-square"></i>
                </button>
            </div>
            <div class="media-info">
                <h4 data-tooltip="${escapeHtml(tooltip)}">
                    ${toggleBtnHtml}
                    <span class="clip-title-text">${escapeHtml(currentTitle)}</span>
                </h4>
                <div class="media-meta-row">
                    <span class="media-duration">${v.duration ? formatTimecode(v.duration).substring(3, 11) : "00:00:00"}</span>
                    ${statusGlow}
                    ${statusBadge}
                    <span class="badge-tag ${badgeClass}">${badgeLabel}</span>
                    ${speakerHtml}
                    ${overrideBtnHtml}
                    ${actionBtn}
                </div>
                ${descHtml}
                ${tagsHtml}
            </div>
        `;

        const qOverrideOk = card.querySelector(".btn-quick-override-ok");
        if (qOverrideOk) {
            qOverrideOk.addEventListener("click", async (e) => {
                e.stopPropagation();
                try {
                    await CapIAuAPI.overrideVideoStatus(v.id, "analyzed");
                    if (window.libraryInstance) await window.libraryInstance.reloadData();
                } catch (err) {
                    alert("Erro ao marcar como analisado: " + err.message);
                }
            });
        }

        const qOverrideFail = card.querySelector(".btn-quick-override-fail");
        if (qOverrideFail) {
            qOverrideFail.addEventListener("click", async (e) => {
                e.stopPropagation();
                try {
                    await CapIAuAPI.overrideVideoStatus(v.id, "error");
                    if (window.libraryInstance) await window.libraryInstance.reloadData();
                } catch (err) {
                    alert("Erro ao sinalizar falha: " + err.message);
                }
            });
        }
        
        const selectBtn = card.querySelector(".btn-select-similar-item");
        if (selectBtn) {
            selectBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                window.toggleSelectSimilarItem("video", v.id, v.filename || friendlyTitle, card, null, v.video_type || null);
            });
        }
        
        const isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => item.kind === "video" && item.id === v.id);
        if (isSelected) {
            card.classList.add("selected-for-similar");
            const selectIcon = selectBtn ? selectBtn.querySelector("i") : null;
            if (selectIcon) {
                selectIcon.className = "fa-solid fa-square-check";
                selectIcon.style.color = "var(--color-cyan)";
            }
        }

        const isFailedFilter = window.libraryInstance && window.libraryInstance.isFailedFilterActive;
        const isFailedSelected = isFailedFilter && window.libraryInstance.selectedFailedIds.has(v.id);

        if (isFailedFilter) {
            if (selectBtn) {
                selectBtn.style.display = "flex";
                const selectIcon = selectBtn.querySelector("i");
                if (isFailedSelected) {
                    card.classList.add("selected-for-similar");
                    card.style.borderColor = "#facc15";
                    if (selectIcon) {
                        selectIcon.className = "fa-solid fa-square-check";
                        selectIcon.style.color = "#facc15";
                    }
                } else {
                    card.classList.remove("selected-for-similar");
                    card.style.borderColor = "";
                    if (selectIcon) {
                        selectIcon.className = "fa-regular fa-square";
                        selectIcon.style.color = "var(--text-muted)";
                    }
                }

                selectBtn.replaceWith(selectBtn.cloneNode(true));
                const newSelectBtn = card.querySelector(".btn-select-similar-item");
                if (newSelectBtn) {
                    newSelectBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (window.libraryInstance.selectedFailedIds.has(v.id)) {
                            window.libraryInstance.selectedFailedIds.delete(v.id);
                        } else {
                            window.libraryInstance.selectedFailedIds.add(v.id);
                        }
                        window.libraryInstance.renderVideos(STATE.allVideos);
                        window.libraryInstance.checkFailedMediaCount();
                    });
                }
            }

            card.addEventListener("click", (e) => {
                if (e.target.closest(".btn-toggle-filename") || e.target.closest(".btn-card-action") || e.target.closest(".btn-select-similar-item")) return;
                if (window.libraryInstance.selectedFailedIds.has(v.id)) {
                    window.libraryInstance.selectedFailedIds.delete(v.id);
                } else {
                    window.libraryInstance.selectedFailedIds.add(v.id);
                }
                window.libraryInstance.renderVideos(STATE.allVideos);
                window.libraryInstance.checkFailedMediaCount();
            });
        }
        
        card.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest(".btn-card-action") || e.target.closest(".btn-toggle-filename") || e.target.closest(".btn-select-similar-item") || e.target.closest("input")) return;

            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }

            _librarySingleClickTimer = setTimeout(() => {
                _librarySingleClickTimer = null;
                STATE.activeVideo = v;
                window.activeFocusedPlayer = "source";
            }, 250);
        });

        // Clique direito aciona o Super-Menu de Contexto
        card.addEventListener("contextmenu", (e) => {
            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }
            showMediaContextMenu(e, v, "video", card);
        });

        // Arrastar-e-soltar do vídeo para a timeline com dimensões reais e In/Out
        card.draggable = true;
        card.addEventListener("dragstart", (e) => {
            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }
            let inTime = 0.0;
            let outTime = (v.duration && v.duration > 0) ? v.duration : 5.0;
            if (STATE.activeVideo && STATE.activeVideo.id === v.id) {
                if (STATE.markerIn !== null && STATE.markerIn !== undefined) inTime = STATE.markerIn;
                if (STATE.markerOut !== null && STATE.markerOut !== undefined) outTime = STATE.markerOut;
                if (outTime <= inTime) outTime = (v.duration && v.duration > 0) ? v.duration : 5.0;
            }
            const effDur = Math.max(0.1, outTime - inTime);

            STATE.activeDragMedia = {
                type: "video",
                id: v.id,
                title: currentTitle,
                filename: v.filename,
                duration: v.duration || 5.0,
                inTime: inTime,
                outTime: outTime,
                effectiveDuration: effDur,
                video_type: v.video_type || null
            };

            e.dataTransfer.setData("application/x-capiau-media", JSON.stringify({
                type: "video",
                id: v.id,
                inTime: inTime,
                outTime: outTime,
                duration: effDur
            }));
            e.dataTransfer.effectAllowed = "copy";
        });
        card.addEventListener("dragend", () => {
            STATE.activeDragMedia = null;
            if (window.TIMELINE_INTERACTION?.renderer) {
                window.TIMELINE_INTERACTION.renderer.dropIndicator = null;
                window.TIMELINE_INTERACTION.renderer.activeSnapFrame = null;
                window.TIMELINE_INTERACTION.renderer.requestRedraw();
            }
        });

        // Listener para alternar título
        const toggleBtn = card.querySelector(".btn-toggle-filename");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (_librarySingleClickTimer) {
                    clearTimeout(_librarySingleClickTimer);
                    _librarySingleClickTimer = null;
                }
                if (!window.titleDisplayPreferences) window.titleDisplayPreferences = {};
                window.titleDisplayPreferences[v.id] = forceRealFilename ? "friendly" : "filename";
                localStorage.setItem("titleDisplayPreferences", JSON.stringify(window.titleDisplayPreferences));
                // Recarrega biblioteca inteira para re-renderizar
                STATE.emit("videosUpdated", STATE.allVideos);
            });
        }
        
        // Duplo clique no card insere o vídeo na timeline com suporte a atalhos de modificadores
        card.addEventListener("dblclick", (e) => {
            if (e.target.closest("button") || e.target.closest(".btn-card-action") || e.target.closest(".btn-toggle-filename") || e.target.closest(".btn-select-similar-item") || e.target.closest("input")) return;
            e.preventDefault();
            e.stopPropagation();
            
            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }

            let mode = "playhead";
            if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                mode = "end";
            } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                mode = "first_gap";
            } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
                mode = "next_gap";
            } else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                mode = "start";
            } else if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                mode = "ripple";
            } else if ((e.ctrlKey || e.metaKey) && e.altKey) {
                mode = "overlay";
            }

            let inTime = 0.0;
            let outTime = (v.duration && v.duration > 0) ? v.duration : 5.0;
            if (STATE.activeVideo && STATE.activeVideo.id === v.id) {
                if (STATE.markerIn !== null && STATE.markerIn !== undefined) inTime = STATE.markerIn;
                if (STATE.markerOut !== null && STATE.markerOut !== undefined && STATE.markerOut > inTime) outTime = STATE.markerOut;
            }

            if (window.TIMELINE_STATE && typeof window.TIMELINE_STATE.insertMedia === "function") {
                window.TIMELINE_STATE.insertMedia({
                    type: "video",
                    id: v.id,
                    inSec: inTime,
                    outSec: outTime,
                    mode: mode
                });
            }
        });

        container.appendChild(card);
    } else if (node.type === "file" && node.photo) {
        const p = node.photo;
        if (renderCtx.ast && !evaluateAST(renderCtx.ast, p, "tab-media")) {
            return;
        }
        
        const card = document.createElement("div");
        card.className = "media-card tree-file-item photo-item";
        card.setAttribute("data-photo-id", p.id);
        card.style.paddingLeft = "6px";
        if (STATE.activePhoto && STATE.activePhoto.id === p.id) card.classList.add("active");
        
        // Card da biblioteca usa a miniatura (~320px), nao o proxy de 1024px.
        // O lightbox continua abrindo o proxy/original em resolucao cheia.
        const src = `/api/photo/${p.id}/thumbnail`;
        const isRaw = p.filename.toLowerCase().match(/\.(arw|cr2|nef|dng|pef|raf|orf|rw2|raw)$/);
        
        let imgHtml = "";
        let clickEnabled = true;
        let statusBadge = "";
        let statusGlow = "";
        
        if (p.status === 'pending') {
            statusGlow = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--color-cyan);" data-tooltip="Gerando Proxy..."></i>`;
            imgHtml = `<div class="photo-placeholder-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Proxy...</span></div>`;
            if (isRaw) clickEnabled = false;
        } else if (p.status === 'error') {
            statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);" data-tooltip="Falha no Proxy"></i>`;
            imgHtml = `<div class="photo-placeholder-error"><i class="fa-solid fa-triangle-exclamation"></i><span>Erro</span></div>`;
            if (isRaw) clickEnabled = false;
        } else {
            if (isRaw && !p.proxy_path) {
                statusGlow = `<i class="fa-solid fa-circle-notch fa-spin" style="color: var(--color-cyan);" data-tooltip="Processando RAW..."></i>`;
                imgHtml = `<div class="photo-placeholder-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><span>RAW...</span></div>`;
                clickEnabled = false;
            } else {
                imgHtml = `<img src="${src}" alt="${escapeHtml(p.filename)}" loading="lazy" decoding="async">`;
            }
        }
        
        if (isRaw) {
            statusBadge = `<span class="badge" style="color: var(--color-purple); border-color: rgba(168, 85, 247, 0.3);">RAW</span>`;
        } else {
            statusBadge = `<span class="badge" style="color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3);">FOTO</span>`;
        }
        
        const friendlyTitle = p.title || p.description || p.filename;
        const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[p.id] === "filename";
        const currentTitle = forceRealFilename ? p.filename : friendlyTitle;
        
        const toggleTitleIcon = forceRealFilename ? "fa-file-signature" : "fa-font";
        const toggleTitleTitle = forceRealFilename ? "Mostrar Título Contextual" : "Mostrar Nome do Arquivo Real";
        const toggleBtnHtml = `<button class="btn-toggle-filename" data-tooltip="${toggleTitleTitle}"><i class="fa-solid ${toggleTitleIcon}"></i></button>`;

        const categoryLabel = p.category ? p.category : 'Foto';
        // Tooltip rica e direta via buildMediaTooltip
        const tooltip = buildMediaTooltip(p, "photo", forceRealFilename);
        const { descHtml, tagsHtml } = getMediaRichContent(p, "photo", currentTitle);
        
        card.innerHTML = `
            <div class="media-thumbnail photo-thumb-container" style="position: relative;">
                ${imgHtml}
                <button class="btn-select-similar-item" data-tooltip="Selecionar para busca por similaridade" style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border: none; background: rgba(0,0,0,0.6); color: var(--text-muted); font-size: 10px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 3px; z-index: 10;">
                    <i class="fa-regular fa-square"></i>
                </button>
            </div>
            <div class="media-info">
                <h4 data-tooltip="${escapeHtml(tooltip)}">
                    ${toggleBtnHtml}
                    <span class="clip-title-text">${escapeHtml(currentTitle)}</span>
                </h4>
                <div class="media-meta-row">
                    ${statusGlow}
                    ${statusBadge}
                    <span class="badge-tag tag-broll">${categoryLabel}</span>
                    <button class="btn-photo-add-timeline btn-card-action" data-tooltip="Adicionar à timeline (still)"><i class="fa-solid fa-plus"></i></button>
                    <button class="btn-photo-similar btn-card-action" data-tooltip="Encontrar similares"><i class="fa-solid fa-images"></i></button>
                </div>
                ${descHtml}
                ${tagsHtml}
            </div>
        `;
        
        const selectBtn = card.querySelector(".btn-select-similar-item");
        if (selectBtn) {
            selectBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                window.toggleSelectSimilarItem("photo", p.id, p.title || p.filename, card);
            });
        }
        
        const isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => item.kind === "photo" && item.id === p.id);
        if (isSelected) {
            card.classList.add("selected-for-similar");
            const selectIcon = selectBtn ? selectBtn.querySelector("i") : null;
            if (selectIcon) {
                selectIcon.className = "fa-solid fa-square-check";
                selectIcon.style.color = "var(--color-cyan)";
            }
        }
        
        const toggleBtn = card.querySelector(".btn-toggle-filename");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!window.titleDisplayPreferences) window.titleDisplayPreferences = {};
                window.titleDisplayPreferences[p.id] = forceRealFilename ? "friendly" : "filename";
                localStorage.setItem("titleDisplayPreferences", JSON.stringify(window.titleDisplayPreferences));
                if (STATE.allPhotos) STATE.emit("photosUpdated", STATE.allPhotos);
            });
        }
        
        const addBtn = card.querySelector(".btn-photo-add-timeline");
        if (addBtn) {
            addBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (window.TIMELINE_STATE) window.TIMELINE_STATE.addPhotoCut(p.id, {});
            });
        }
        
        const similarBtn = card.querySelector(".btn-photo-similar");
        if (similarBtn) {
            similarBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (window.showSimilarMedia) window.showSimilarMedia("photo", p.id, { label: p.title || p.filename });
            });
        }
        
        // Clique direito aciona o Super-Menu de Contexto
        card.addEventListener("contextmenu", (e) => {
            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }
            showMediaContextMenu(e, p, "photo", card);
        });

        if (clickEnabled) {
            card.style.cursor = "pointer";
            card.draggable = true;
            card.addEventListener("dragstart", (e) => {
                if (_librarySingleClickTimer) {
                    clearTimeout(_librarySingleClickTimer);
                    _librarySingleClickTimer = null;
                }
                const effDur = 5.0;
                STATE.activeDragMedia = {
                    type: "photo",
                    id: p.id,
                    title: currentTitle,
                    filename: p.filename,
                    duration: effDur,
                    inTime: 0,
                    outTime: effDur,
                    effectiveDuration: effDur
                };

                e.dataTransfer.setData("application/x-capiau-media", JSON.stringify({
                    type: "photo",
                    id: p.id,
                    inTime: 0,
                    outTime: effDur,
                    duration: effDur
                }));
                e.dataTransfer.effectAllowed = "copy";
            });
            card.addEventListener("dragend", () => {
                STATE.activeDragMedia = null;
                if (window.TIMELINE_INTERACTION?.renderer) {
                    window.TIMELINE_INTERACTION.renderer.dropIndicator = null;
                    window.TIMELINE_INTERACTION.renderer.activeSnapFrame = null;
                    window.TIMELINE_INTERACTION.renderer.requestRedraw();
                }
            });
            card.addEventListener("click", (e) => {
                if (e.target.closest("button") || e.target.closest(".btn-card-action") || e.target.closest(".btn-toggle-filename") || e.target.closest(".btn-select-similar-item") || e.target.closest("input")) return;

                if (_librarySingleClickTimer) {
                    clearTimeout(_librarySingleClickTimer);
                    _librarySingleClickTimer = null;
                }

                _librarySingleClickTimer = setTimeout(() => {
                    _librarySingleClickTimer = null;
                    if (STATE.openPhotosInPlayer) {
                        STATE.activePhoto = p;
                    } else {
                        const libInstance = window.libraryInstance || window.panelsManager?.library;
                        STATE.currentPhotoList = STATE.allPhotos || [p];
                        STATE.currentPhotoIndex = (STATE.currentPhotoList).indexOf(p);
                        if (libInstance && typeof libInstance.openLightbox === 'function') {
                            libInstance.openLightbox(p);
                        }
                    }
                }, 250);
            });
        }
        
        // Duplo clique no card insere a foto na timeline com suporte a atalhos de modificadores
        card.addEventListener("dblclick", (e) => {
            if (e.target.closest("button") || e.target.closest(".btn-card-action") || e.target.closest(".btn-toggle-filename") || e.target.closest(".btn-select-similar-item") || e.target.closest("input")) return;
            e.preventDefault();
            e.stopPropagation();

            if (_librarySingleClickTimer) {
                clearTimeout(_librarySingleClickTimer);
                _librarySingleClickTimer = null;
            }

            let mode = "playhead";
            if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                mode = "end";
            } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                mode = "first_gap";
            } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
                mode = "next_gap";
            } else if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                mode = "start";
            } else if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                mode = "ripple";
            } else if ((e.ctrlKey || e.metaKey) && e.altKey) {
                mode = "overlay";
            }
            
            if (window.TIMELINE_STATE && typeof window.TIMELINE_STATE.insertMedia === "function") {
                window.TIMELINE_STATE.insertMedia({
                    type: "photo",
                    id: p.id,
                    inSec: 0,
                    outSec: 5.0,
                    mode: mode
                });
            }
        });
        
        container.appendChild(card);
    }
}

// Expor utilitários e ações globais para compatibilidade com onclick inline do HTML
window.cancelConversion = async function(videoId) {
    if (!confirm("Deseja cancelar a tarefa ativa desse vídeo?")) return;
    try {
        await CapIAuAPI.cancelConversion(videoId);
        STATE.emit("projectChanged");
    } catch (err) {
        alert("Erro ao cancelar tarefa: " + err.message);
    }
};

window.deleteProxy = async function(videoId) {
    if (!confirm("Deseja excluir o arquivo proxy físico e reverter o status deste vídeo?")) return;
    try {
        await CapIAuAPI.deleteVideoProxy(videoId);
        STATE.emit("projectChanged");
    } catch (err) {
        alert("Erro ao excluir proxy: " + err.message);
    }
};

window.deleteDocument = async function(docId) {
    if (!confirm("Tem certeza que deseja remover este documento? Seus dados indexados no Qdrant também serão excluídos!")) return;
    try {
        await CapIAuAPI.deleteDocument(docId, STATE.currentProjectId);
        STATE.emit("projectChanged");
    } catch (err) {
        alert("Erro ao excluir documento: " + err.message);
    }
};

const SCRIPT_STRATEGY_LABELS = {
    fdx: "estrutura do arquivo .fdx",
    fountain: "Fountain (INT./EXT. e cabeçalhos forçados)",
    sluglines: "cabeçalhos INT./EXT.",
    cena_numerada: "cenas numeradas (CENA N)",
    markdown: "títulos Markdown",
    caps_isolado: "linhas em maiúsculas isoladas",
    llm: "análise por IA",
    prose: "nenhum padrão de cena (documento em prosa)",
};

/** Orquestra o preview (sem custo) → confirmação do usuário → disparo da extração.
 * Nunca chama a extração de verdade sem o usuário ver antes o que foi detectado —
 * um erro de detecção vira uma conferência de 5 segundos, não uma estrutura ruim
 * gravada em silêncio. */
window.startScriptExtraction = async function(docId, filename) {
    const lib = window.libraryInstance;
    if (!lib) return;
    const projectId = STATE.currentProjectId;

    let preview;
    try {
        preview = await CapIAuAPI.fetchStructurePreview(docId, projectId, false);
    } catch (e) {
        alert("Erro ao analisar o formato do roteiro: " + e.message);
        return;
    }

    if (preview.needs_review || preview.strategy === "prose") {
        const tryLLM = confirm(
            `Não identifiquei com confiança um padrão de cenas em "${filename}" (${SCRIPT_STRATEGY_LABELS[preview.strategy] || preview.strategy}).\n\n` +
            `Quer que a IA tente identificar o formato antes de decidir (1 chamada de custo baixo)?`
        );
        if (tryLLM) {
            try {
                preview = await CapIAuAPI.fetchStructurePreview(docId, projectId, true);
            } catch (e) {
                alert("Erro ao consultar a IA para identificar o formato: " + e.message);
                return;
            }
        }
    }

    const strategyLabel = SCRIPT_STRATEGY_LABELS[preview.strategy] || preview.strategy;
    let message;
    if (preview.strategy === "prose" || preview.scene_count === 0) {
        message = `"${filename}" não parece ter estrutura de cenas reconhecível (${strategyLabel}). ` +
            `Nenhuma cena será extraída nesta rodada.\n\nContinuar mesmo assim?`;
    } else {
        const sample = (preview.sample || []).map(s => `  ${s.number}. ${s.heading || "(sem título)"}`).join("\n");
        message = `Detectei ${preview.scene_count} cena(s) em "${filename}" pelo padrão de ${strategyLabel}` +
            (preview.needs_review ? " (confiança baixa — vale conferir o resultado depois)" : "") + ".\n\n" +
            (sample ? `Primeiras cenas:\n${sample}\n\n` : "") +
            `Confirma a extração? Isso gasta algumas chamadas de IA (uma por trecho do roteiro; reaproveita o resultado se o texto não mudar).`;
    }
    if (!confirm(message)) return;

    let result;
    try {
        result = await CapIAuAPI.extractDocStructure(docId, projectId, false);
    } catch (e) {
        alert("Erro de rede ao iniciar a extração.");
        return;
    }

    if (result.status === 409) {
        alert("Já existe uma extração deste roteiro em andamento — acompanhe na aba Tarefas.");
        return;
    }
    if (!result.ok) {
        const detail = result.body && result.body.detail;
        alert("Erro ao iniciar a extração: " + (typeof detail === "string" ? detail : JSON.stringify(detail || result.body)));
        return;
    }

    alert("Extração iniciada — acompanhe o progresso na aba Tarefas.");
    lib.pollExtraction(docId, 30);
};

window.closeScriptStructure = function() {
    const section = document.getElementById("script-structure");
    if (section) {
        section.style.display = "none";
        section.innerHTML = "";
    }
};

window.applySceneCuration = async function(status, all = false) {
    const section = document.getElementById("script-structure");
    if (!section) return;
    const checks = section.querySelectorAll(".curation-scene-check" + (all ? "" : ":checked"));
    const ids = Array.from(checks).map(c => Number(c.dataset.sceneId));
    if (ids.length === 0) {
        alert("Nenhuma cena selecionada.");
        return;
    }
    const docId = Number(section.dataset.docId);
    try {
        await CapIAuAPI.bulkSceneStatus(STATE.currentProjectId, ids, status);
        window.libraryInstance.showScriptStructure(docId);
        window.libraryInstance.refreshExtractionBadge(docId);
    } catch (e) {
        alert("Erro ao atualizar cenas: " + e.message);
    }
};

window.isLibraryAllExpanded = false;

window.globalToggleExpandCollapseAll = function(explicitState) {
    const expandBtn = document.getElementById("btn-expand-all");
    const targetState = (explicitState !== undefined) ? explicitState : !window.isLibraryAllExpanded;
    window.isLibraryAllExpanded = targetState;

    if (expandBtn) {
        expandBtn.title = targetState ? "Recolher todas as pastas" : "Expandir todas as pastas";
        animateStreamToggle(expandBtn, targetState, () => {
            window.globalExpandCollapseAll(targetState, true);
        });
    } else {
        window.globalExpandCollapseAll(targetState);
    }
};

window.globalExpandCollapseAll = function(expand, skipBtnAnimation = false) {
    window.isLibraryAllExpanded = expand;
    const expandBtn = document.getElementById("btn-expand-all");
    if (expandBtn && !skipBtnAnimation) {
        expandBtn.classList.remove("state-collapsed", "state-expanded");
        expandBtn.classList.add(expand ? "state-expanded" : "state-collapsed");
        expandBtn.title = expand ? "Recolher todas as pastas" : "Expandir todas as pastas";
        const vp = expandBtn.querySelector(".stream-viewport");
        if (vp) {
            const finalPath = expand ? ARROW_UP_PATH : ARROW_DOWN_PATH;
            vp.innerHTML = `<svg class="arrow-svg" viewBox="0 0 16 16"><path d="${finalPath}" /></svg>`;
        }
    }

    collectFolderPaths(lastRenderedTree, [], null, expand).forEach(fp => {
        if (expand) openFoldersSet.add(fp);
        else openFoldersSet.delete(fp);
    });

    virtualEmptyFolders.forEach(fp => {
        if (expand) openFoldersSet.add(fp);
        else openFoldersSet.delete(fp);
    });

    saveOpenFoldersState();
    if (window.libraryInstance) window.libraryInstance.scheduleRenderMedia();
};

window.expandCollapseAllSubfolders = function(folderPath, expand) {
    collectFolderPaths(lastRenderedTree, [], folderPath).forEach(fp => {
        if (expand) openFoldersSet.add(fp);
        else openFoldersSet.delete(fp);
    });

    virtualEmptyFolders.forEach(fp => {
        if (fp === folderPath || fp.startsWith(folderPath + "/")) {
            if (expand) openFoldersSet.add(fp);
            else openFoldersSet.delete(fp);
        }
    });

    saveOpenFoldersState();
    if (window.libraryInstance) window.libraryInstance.scheduleRenderMedia();
};

export class LibraryManager {
    constructor() {
        window.libraryInstance = this;
        this.mediaTreeListEl = document.getElementById("media-tree-list") || document.getElementById("video-list");
        this.videoListEl = this.mediaTreeListEl;
        this.photoListEl = this.mediaTreeListEl;
        this.docsListEl = document.getElementById("doc-list");
        this.btnScan = document.getElementById("btn-scan");
        this.btnImportExternal = document.getElementById("btn-import-external");
        this.btnOpenProxies = document.getElementById("btn-open-proxies");
        this.btnRetryFailed = document.getElementById("btn-retry-failed");
        this.btnTranscribeAll = document.getElementById("btn-transcribe-all");
        
        // Lightbox
        this.lightbox = document.getElementById("photo-viewer-modal");
        this.lightboxImg = document.getElementById("photo-viewer-img");
        this.lightboxTitle = document.getElementById("photo-viewer-title");
        this.lightboxDesc = document.getElementById("photo-viewer-desc");
        this.lightboxTags = document.getElementById("photo-viewer-tags");
        this.lightboxFaces = document.getElementById("photo-viewer-overlay-container");
        this.btnPrevPhoto = document.getElementById("btn-prev-photo");
        this.btnNextPhoto = document.getElementById("btn-next-photo");
        this.btnZoomPhoto = document.getElementById("btn-zoom-photo");
        this.lightboxCounter = document.getElementById("photo-viewer-counter");
        this.btnAnalyzePhoto = document.getElementById("btn-analyze-photo-vision");
        this.isPhotoZoomed = false;

        // Estado do Filtro de Falhas & Seleção
        this.isFailedFilterActive = false;
        this.selectedFailedIds = new Set();
        this.tabScrollPositions = {};

        this.init();
    }

    getScrollContainer() {
        let container = (this.activeDoc || document).querySelector("#sidebar-left .sidebar-content.scrollable");
        if (!container && typeof document !== "undefined") {
            container = document.querySelector("#sidebar-left .sidebar-content.scrollable");
        }
        if (!container && window.popoutWindows && window.popoutWindows["sidebar-left"] && !window.popoutWindows["sidebar-left"].closed) {
            container = window.popoutWindows["sidebar-left"].document?.querySelector("#sidebar-left .sidebar-content.scrollable");
        }
        return container || null;
    }

    saveTabScrollPosition(tabId, scrollPos) {
        if (!tabId) return;
        if (scrollPos === undefined || scrollPos === null) {
            const container = this.getScrollContainer();
            scrollPos = container ? container.scrollTop : 0;
        }
        this.tabScrollPositions = this.tabScrollPositions || {};
        this.tabScrollPositions[tabId] = scrollPos;
        window._libraryTabScrollPositions = this.tabScrollPositions;
    }

    restoreTabScrollPosition(tabId, container = null) {
        if (!tabId) return;
        const cont = container || this.getScrollContainer();
        if (!cont) return;
        const target = (this.tabScrollPositions && this.tabScrollPositions[tabId] !== undefined)
            ? this.tabScrollPositions[tabId]
            : (window._libraryTabScrollPositions?.[tabId] || 0);

        cont.scrollTop = target;
        requestAnimationFrame(() => {
            cont.scrollTop = target;
            requestAnimationFrame(() => {
                cont.scrollTop = target;
            });
        });
    }

    attachScrollListener(container = null) {
        const cont = container || this.getScrollContainer();
        if (!cont || cont._hasLibraryScrollListener) return;
        cont._hasLibraryScrollListener = true;
        cont.addEventListener("scroll", () => {
            const doc = cont.ownerDocument || document;
            const activeTabEl = doc.querySelector("#sidebar-left .tab-content.active");
            const tabId = activeTabEl ? activeTabEl.id : (doc.getElementById("sidebar-left")?.getAttribute("data-active-tab") || "tab-media");
            if (tabId) {
                this.saveTabScrollPosition(tabId, cont.scrollTop);
            }
        }, { passive: true });
    }

    attachWheelZoomListener(targetDoc = (this.activeDoc || document)) {
        if (!targetDoc) return;

        const handleWheel = (e) => {
            if (!e.shiftKey) return;

            const target = e.target;
            if (!target) return;

            // Verifica se o evento ocorreu dentro do container/grid da Biblioteca de Mídias
            const isInsideMedia = target.closest("#tab-media, #media-tree-list, #video-list, #photo-list, .library-tree-list, .media-card, .zoom-container, #library-zoom-slider");
            if (!isInsideMedia) {
                const activeTab = (targetDoc || document).querySelector("#sidebar-left .tab-content.active")?.id;
                const isMediaTabActive = activeTab === "tab-media" || activeTab === "tab-videos" || activeTab === "tab-photos";
                const isInsideSidebar = target.closest("#sidebar-left");
                if (!isMediaTabActive || !isInsideSidebar) {
                    return;
                }
            }

            if (typeof isAnyModalOpen === "function" && isAnyModalOpen(targetDoc)) {
                return;
            }

            // Impede o scroll nativo (horizontal ou vertical) do navegador
            e.preventDefault();
            e.stopPropagation();

            const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
            if (delta === 0) return;

            const currentZoom = parseInt(localStorage.getItem("lib-pref-zoom"), 10) || 80;
            const step = delta < 0 ? 10 : -10;
            const newZoom = Math.max(30, Math.min(300, currentZoom + step));

            if (typeof this.setZoomValue === "function") {
                this.setZoomValue(newZoom);
            } else if (typeof window.setLibraryZoomValue === "function") {
                window.setLibraryZoomValue(newZoom);
            }
        };

        const targetElements = targetDoc.querySelectorAll("#sidebar-left, #sidebar-left .sidebar-content.scrollable, #tab-media, #media-tree-list, .library-tree-list");
        targetElements.forEach(el => {
            if (el && !el._hasLibraryWheelZoomListener) {
                el._hasLibraryWheelZoomListener = true;
                el.addEventListener("wheel", handleWheel, { passive: false });
            }
        });
    }

    onPopoutReady(win) {
        if (!win || !win.document) return;
        this.activeDoc = win.document;
        this.activeWindow = win;
        this.mediaTreeListEl = win.document.getElementById("media-tree-list") || win.document.getElementById("video-list") || this.mediaTreeListEl;
        this.videoListEl = this.mediaTreeListEl;
        this.photoListEl = this.mediaTreeListEl;
        this.docsListEl = win.document.getElementById("doc-list") || this.docsListEl;

        const savedZoom = parseInt(localStorage.getItem("lib-pref-zoom"), 10) || 80;
        if (typeof this.setZoomValue === "function") {
            this.setZoomValue(savedZoom);
        }
        const savedMode = localStorage.getItem("lib-pref-view-mode") || "list";
        if (typeof this.setViewMode === "function") {
            this.setViewMode(savedMode);
        }
        if (typeof this.applyDisplayClasses === "function") {
            this.applyDisplayClasses();
        }
        this.attachScrollListener(win.document.querySelector("#sidebar-left .sidebar-content.scrollable"));
        this.attachWheelZoomListener(win.document);
    }

    onPopoutRestored() {
        this.activeDoc = document;
        this.activeWindow = window;
        this.mediaTreeListEl = document.getElementById("media-tree-list") || document.getElementById("video-list") || this.mediaTreeListEl;
        this.videoListEl = this.mediaTreeListEl;
        this.photoListEl = this.mediaTreeListEl;
        this.docsListEl = document.getElementById("doc-list") || this.docsListEl;

        const savedZoom = parseInt(localStorage.getItem("lib-pref-zoom"), 10) || 80;
        if (typeof this.setZoomValue === "function") {
            this.setZoomValue(savedZoom);
        }
        const savedMode = localStorage.getItem("lib-pref-view-mode") || "list";
        if (typeof this.setViewMode === "function") {
            this.setViewMode(savedMode);
        }
        if (typeof this.applyDisplayClasses === "function") {
            this.applyDisplayClasses();
        }
        this.attachScrollListener();
        this.attachWheelZoomListener(document);
    }

    init() {
        this.attachScrollListener();
        this.attachWheelZoomListener();
        STATE.on("videosUpdated", (videos) => this.renderVideos(videos));
        STATE.on("photosUpdated", (photos) => this.renderPhotos(photos));
        STATE.on("projectChanged", () => { this.reloadData(); this.loadTriageReviewThreshold(); });
        this.loadTriageReviewThreshold();
        this.reloadData();
        this.scrollIndexTracker = new LibraryScrollIndexTracker();
        STATE.on("leftTabChanged", (tabId) => {
            this.updateSearchPlaceholder(tabId);
            this.scrollIndexTracker?.hide();
        });
        STATE.on("activeVideoChanged", (video) => {
            getAllLibraryDocuments().forEach(doc => {
                try {
                    doc.querySelectorAll(".media-card.tree-file-item:not(.photo-item)").forEach(el => {
                        if (video && el.getAttribute("data-video-id") == video.id) {
                            el.classList.add("active");
                        } else {
                            el.classList.remove("active");
                        }
                    });
                } catch (e) {}
            });
        });
        STATE.on("activePhotoChanged", (photo) => {
            getAllLibraryDocuments().forEach(doc => {
                try {
                    doc.querySelectorAll("[data-photo-id]").forEach(el => {
                        if (photo && el.getAttribute("data-photo-id") == photo.id) {
                            el.classList.add("active");
                        } else {
                            el.classList.remove("active");
                        }
                    });
                } catch (e) {}
            });
        });

        // Chips de filtro rápido de tipo de mídia (Todos, Vídeos, Fotos, Áudios)
        const chipButtons = document.querySelectorAll(".media-type-filter-chips .chip-filter");
        chipButtons.forEach(btn => {
            btn.addEventListener("click", () => {
                chipButtons.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                this.activeTypeFilter = btn.getAttribute("data-type-filter") || "all";
                this.scheduleRenderMedia();
            });
        });

        if (this.btnScan) this.btnScan.addEventListener("click", () => this.runWatchScan());
        if (this.btnImportExternal) this.btnImportExternal.addEventListener("click", () => this.runImportExternal());
        if (this.btnOpenProxies) this.btnOpenProxies.addEventListener("click", () => this.runOpenProxies());
        if (this.btnRetryFailed) this.btnRetryFailed.addEventListener("click", () => this.runRetryFailed());
        if (this.btnTranscribeAll) this.btnTranscribeAll.addEventListener("click", () => this.triggerTranscribeAll());

        const btnGenWaves = document.getElementById("btn-generate-waveforms");
        if (btnGenWaves) btnGenWaves.addEventListener("click", () => this.triggerGenerateWaveforms());

        const btnReanalyzeFailed = document.getElementById("btn-reanalyze-failed");
        if (btnReanalyzeFailed) btnReanalyzeFailed.addEventListener("click", () => this.handleFailedButtonClick());

        const btnSelectAllFailed = document.getElementById("btn-select-all-failed");
        if (btnSelectAllFailed) btnSelectAllFailed.addEventListener("click", () => this.selectAllFailedMedia());

        const btnDeselectAllFailed = document.getElementById("btn-deselect-all-failed");
        if (btnDeselectAllFailed) btnDeselectAllFailed.addEventListener("click", () => this.deselectAllFailedMedia());

        const btnExitFailedFilter = document.getElementById("btn-exit-failed-filter");
        if (btnExitFailedFilter) btnExitFailedFilter.addEventListener("click", () => {
            this.exitFailedFilter();
            if (window.showToast) window.showToast("Filtro de falhas encerrado. Exibindo todas as mídias.", "info");
        });

        const btnCancelAllAnalyses = document.getElementById("btn-cancel-all-analyses");
        if (btnCancelAllAnalyses) {
            btnCancelAllAnalyses.addEventListener("click", async () => {
                if (!confirm("Deseja cancelar todas as análises de visão em andamento neste projeto?")) return;
                try {
                    const res = await CapIAuAPI.cancelAllAnalyses(STATE.currentProjectId);
                    if (window.showToast) window.showToast(`Cancelamento solicitado para ${res.count || 0} análises!`, "info");
                    this.reloadData();
                    if (window.panelsManager && window.panelsManager.refreshTasks) window.panelsManager.refreshTasks();
                } catch (err) {
                    if (window.showToast) window.showToast("Erro ao cancelar análises: " + err.message, "error");
                }
            });
        }

        const btnBannerReanalyze = document.getElementById("btn-reanalyze-failed-banner");
        if (btnBannerReanalyze) btnBannerReanalyze.addEventListener("click", () => this.handleFailedButtonClick());

        const btnAddMedia = document.getElementById("btn-add-media");
        if (btnAddMedia) {
            btnAddMedia.addEventListener("click", (e) => handleHeaderImportClick(btnAddMedia));
        }

        initLibraryDragAndDrop(this);

        // Atalho de teclado global para Desfazer (Ctrl+Z) e Excluir (Delete) ações de biblioteca
        document.addEventListener("keydown", (e) => {
            const tag = document.activeElement?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;

            // Atalho Delete para excluir a pasta de biblioteca selecionada SOMENTE se o foco estiver na biblioteca
            if (e.key === "Delete" || e.key === "Del") {
                const targetDoc = this.activeDoc || document;
                const activeEl = targetDoc.activeElement || document.activeElement;
                const isInsideSidebarLeft = (e.target && e.target.closest && e.target.closest("#sidebar-left")) || 
                                           (activeEl && activeEl.closest && activeEl.closest("#sidebar-left"));
                
                const hasTimelineSelection = !!(window.TIMELINE_STATE?.selectedClipId || (window.TIMELINE_STATE?.selectedClipIds && window.TIMELINE_STATE.selectedClipIds.size > 0) || window.TIMELINE_STATE?.selectedGap || (window.TIMELINE_STATE?.selectedMarkerIds && window.TIMELINE_STATE.selectedMarkerIds.size > 0));
                
                if (isInsideSidebarLeft && !hasTimelineSelection && window.selectedLibraryFolder && window.selectedLibraryFolder.path && window.selectedLibraryFolder.path !== "root") {
                    e.preventDefault();
                    e.stopPropagation();
                    confirmDeleteVirtualFolder(window.selectedLibraryFolder.path, window.selectedLibraryFolder.name);
                    return;
                }
            }

            if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === "z" && !e.shiftKey) {
                if (handleLibraryUndo()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }

            if (this.isFailedFilterActive && (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === "z"))) {
                e.preventDefault();
                this.exitFailedFilter();
                if (window.showToast) window.showToast("Filtro de falhas encerrado. Exibindo todas as mídias.", "info");
            }
        });

        this.checkFailedMediaCount();

        // Document uploading
        const btnUploadDoc = document.getElementById("btn-upload-doc");
        const docFileInput = document.getElementById("doc-file-input");
        const docTypeSelector = document.getElementById("doc-type-selector");
        if (btnUploadDoc && docFileInput) {
            btnUploadDoc.addEventListener("click", () => docFileInput.click());
            docFileInput.addEventListener("change", async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const docType = docTypeSelector ? docTypeSelector.value : "other";

                const postDoc = (replaceDocId) => {
                    const formData = new FormData();
                    formData.append("file", file);
                    let url = `/api/project/${STATE.currentProjectId}/docs?doc_type=${docType}`;
                    if (replaceDocId) url += `&replace_doc_id=${replaceDocId}`;
                    return fetch(url, { method: "POST", body: formData });
                };

                // detail vem string (erros antigos: PDF sem pypdf, formato nao suportado...)
                // ou objeto {reason, existing_id, existing_filename, message} nos 409 de dedupe (P1.2)
                const errorMessage = (body) => {
                    const d = body && body.detail;
                    if (!d) return "Desconhecido";
                    return typeof d === "string" ? d : (d.message || JSON.stringify(d));
                };

                try {
                    let response = await postDoc();
                    let body = await response.json().catch(() => ({}));

                    // Possível nova versão: só este caso oferece substituir (identical/same_content
                    // caem no alerta genérico abaixo — não há o que substituir, já existe igual).
                    if (response.status === 409 && body.detail && body.detail.reason === "near_version") {
                        const info = body.detail;
                        const pct = Math.round((info.similarity || 0) * 100);
                        const wantsReplace = confirm(
                            `Parece uma nova versão de "${info.existing_filename}" (${pct}% parecido).\n\n` +
                            `Substituir? Os trechos antigos saem da busca e do chat.`
                        );
                        if (wantsReplace) {
                            response = await postDoc(info.existing_id);
                            body = await response.json().catch(() => ({}));
                        }
                    }

                    if (response.ok) {
                        alert("Documento importado e indexado no Qdrant com sucesso!");
                        this.loadDocuments();
                    } else {
                        alert("Erro ao importar: " + errorMessage(body));
                    }
                } catch(err) {
                    alert("Erro de rede ao importar documento.");
                }
                docFileInput.value = "";
            });
        }

        // Lightbox controls
        if (this.lightbox) {
            const btnClosePhotoModal = document.getElementById("btn-close-photo-modal");
            const btnClosePhotoViewer = document.getElementById("btn-close-photo-viewer");
            if (btnClosePhotoModal) btnClosePhotoModal.addEventListener("click", () => this.closeLightbox());
            if (btnClosePhotoViewer) btnClosePhotoViewer.addEventListener("click", () => this.closeLightbox());
            
            this.lightbox.addEventListener("click", (e) => {
                if (e.target === this.lightbox) this.closeLightbox();
            });
        }
        if (this.btnPrevPhoto) this.btnPrevPhoto.addEventListener("click", () => this.navigatePhoto(-1));
        if (this.btnNextPhoto) this.btnNextPhoto.addEventListener("click", () => this.navigatePhoto(1));

        if (this.btnZoomPhoto) {
            this.btnZoomPhoto.addEventListener("click", (e) => this.toggleZoom(e));
        }
        if (this.lightboxImg) {
            this.lightboxImg.addEventListener("click", (e) => this.toggleZoom(e));
        }
        if (this.btnAnalyzePhoto) {
            this.btnAnalyzePhoto.addEventListener("click", () => this.analyzeCurrentPhoto());
        }

        // Correção de categoria da foto (E2.C2) — propaga para a rajada no backend
        const photoCategorySelect = document.getElementById("photo-viewer-category");
        if (photoCategorySelect) {
            photoCategorySelect.addEventListener("change", async () => {
                const photo = this.currentLightboxPhoto;
                const newCategory = photoCategorySelect.value;
                if (!photo || !newCategory) return;
                try {
                    const res = await CapIAuAPI.updatePhotoCategory(photo.id, newCategory);
                    const group = photo.burst_group_id;
                    (STATE.allPhotos || []).forEach(p => {
                        if (p.id === photo.id || (group != null && p.burst_group_id === group)) {
                            p.category = res.category;
                            p.category_confidence = 1.0;
                        }
                    });
                    const confEl = document.getElementById("photo-viewer-category-conf");
                    if (confEl) {
                        confEl.textContent = res.updated_count > 1
                            ? `confirmada (${res.updated_count} fotos da rajada)`
                            : "confirmada por você";
                    }
                    STATE.emit("photosUpdated", STATE.allPhotos);
                } catch (e) {
                    alert("Erro ao corrigir categoria: " + e.message);
                    photoCategorySelect.value = photo.category || "";
                }
            });
        }

        this.initPhotoZoomControls();

        const btnPhotoViewerSimilar = document.getElementById("btn-photo-viewer-similar");
        if (btnPhotoViewerSimilar) {
            btnPhotoViewerSimilar.addEventListener("click", () => {
                const photo = this.currentLightboxPhoto || (STATE.currentPhotoList || [])[STATE.currentPhotoIndex];
                if (!photo || !window.showSimilarMedia) return;
                this.closeLightbox();
                window.showSimilarMedia("photo", photo.id, { label: photo.title || photo.filename });
            });
        }

        const btnAddPhotoTimeline = document.getElementById("btn-add-photo-timeline");
        if (btnAddPhotoTimeline) {
            btnAddPhotoTimeline.addEventListener("click", () => {
                const photo = this.currentLightboxPhoto || (STATE.currentPhotoList || [])[STATE.currentPhotoIndex];
                if (!photo || !window.TIMELINE_STATE) return;
                const durInput = document.getElementById("photo-viewer-duration");
                const durationSec = durInput ? parseFloat(durInput.value) : undefined;
                window.TIMELINE_STATE.addPhotoCut(photo.id, { durationSec });
            });
        }

        document.addEventListener("keydown", (e) => {
            if (this.lightbox && this.lightbox.style.display === "flex") {
                if (e.key === "ArrowLeft") this.navigatePhoto(-1);
                if (e.key === "ArrowRight") this.navigatePhoto(1);
                if (e.key === "Escape") this.closeLightbox();
            }
        });

        // Configurações de exibição de mídias (Dropdown)
        const btnDisplaySettings = document.getElementById("btn-library-display-settings");
        const settingsDropdown = document.getElementById("library-display-settings-dropdown");
        
        if (btnDisplaySettings && settingsDropdown) {
            btnDisplaySettings.addEventListener("click", (e) => {
                e.stopPropagation();
                const isHidden = settingsDropdown.style.display === "none";
                settingsDropdown.style.display = isHidden ? "flex" : "none";
            });
            
            document.addEventListener("click", (e) => {
                if (settingsDropdown.style.display === "flex" && !settingsDropdown.contains(e.target) && e.target !== btnDisplaySettings) {
                    settingsDropdown.style.display = "none";
                }
            });

            const btnRegenTitles = document.getElementById("btn-regenerate-executive-titles");
            if (btnRegenTitles) {
                btnRegenTitles.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (!confirm("Deseja gerar títulos executivos inteligentes (3 a 6 palavras) para os vídeos da biblioteca via IA?")) return;
                    btnRegenTitles.disabled = true;
                    btnRegenTitles.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Gerando...`;
                    try {
                        const activeProjId = STATE.currentProjectId || Number(localStorage.getItem("activeProjectId")) || 2;
                        const res = await fetch(`/api/project/${activeProjId}/regenerate-titles`, { method: "POST" });
                        const data = await res.json();
                        if (window.showToast) window.showToast(data.message || "Geração de títulos iniciada!");
                        
                        // Alterna imediatamente para a aba de Tarefas na sidebar direita
                        if (window.openTasksDrawerAndSwitchTab) {
                            window.openTasksDrawerAndSwitchTab();
                        }

                        btnRegenTitles.disabled = false;
                        btnRegenTitles.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Títulos IA`;
                    } catch(err) {
                        alert("Erro ao disparar regeneração de títulos: " + err.message);
                        btnRegenTitles.disabled = false;
                        btnRegenTitles.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Títulos IA`;
                    }
                });
            }
        }
        
        // Custom Sort Dropdown Popover Toggling and Logic
        const btnSort = document.getElementById("btn-library-sort");
        const sortDropdown = document.getElementById("library-sort-dropdown");
        
        if (btnSort && sortDropdown) {
            btnSort.addEventListener("click", (e) => {
                e.stopPropagation();
                const isHidden = sortDropdown.style.display === "none";
                sortDropdown.style.display = isHidden ? "flex" : "none";
            });
            
            document.addEventListener("click", (e) => {
                if (sortDropdown.style.display === "flex" && !sortDropdown.contains(e.target) && e.target !== btnSort && !btnSort.contains(e.target)) {
                    sortDropdown.style.display = "none";
                }
            });
            
            // Sync initial state of sort options
            const currentSortVal = localStorage.getItem("library_sort_by") || "name_asc";
            sortDropdown.querySelectorAll(".sort-option").forEach(opt => {
                if (opt.getAttribute("data-val") === currentSortVal) {
                    opt.classList.add("active");
                } else {
                    opt.classList.remove("active");
                }
                
                opt.addEventListener("click", () => {
                    const val = opt.getAttribute("data-val");
                    const hiddenSortSelect = document.getElementById("library-sort-by");
                    if (hiddenSortSelect) {
                        hiddenSortSelect.value = val;
                        hiddenSortSelect.dispatchEvent(new Event("change"));
                    }
                    
                    sortDropdown.querySelectorAll(".sort-option").forEach(o => o.classList.remove("active"));
                    opt.classList.add("active");
                    sortDropdown.style.display = "none";
                });
            });
        }
        
        // Status Cycle Button and Synchronization
        const btnStatusCycle = document.getElementById("btn-status-filter-cycle");
        const statusSelect = document.getElementById("library-filter-status");
        if (btnStatusCycle && statusSelect) {
            const statuses = [
                { val: "all", icon: "fa-solid fa-filter", label: "Status: Todos", color: "var(--text-secondary)" },
                { val: "pending", icon: "fa-solid fa-hourglass-half", label: "Status: Não Analisados", color: "var(--color-cyan)" },
                { val: "processed", icon: "fa-solid fa-circle-check", label: "Status: Analisados (IA)", color: "var(--color-emerald)" },
                { val: "error", icon: "fa-solid fa-circle-exclamation", label: "Status: Com Falhas", color: "var(--color-rose)" }
            ];
            
            let currentIndex = statuses.findIndex(s => s.val === statusSelect.value);
            if (currentIndex === -1) currentIndex = 0;
            
            const updateStatusUI = (index) => {
                const state = statuses[index];
                btnStatusCycle.innerHTML = `<i class="${state.icon}"></i>`;
                btnStatusCycle.style.color = state.color;
                btnStatusCycle.setAttribute("title", state.label);
                btnStatusCycle.setAttribute("data-tooltip", state.label);
            };
            
            updateStatusUI(currentIndex);
            
            btnStatusCycle.addEventListener("click", () => {
                currentIndex = (currentIndex + 1) % statuses.length;
                const nextState = statuses[currentIndex];
                statusSelect.value = nextState.val;
                statusSelect.dispatchEvent(new Event("change"));
                updateStatusUI(currentIndex);
            });

            // Store references on instance for query sync
            this._btnStatusCycle = btnStatusCycle;
            this._statusSelect = statusSelect;
            this._statuses = statuses;
            this._updateStatusUI = updateStatusUI;
            this._setCurrentIndex = (val) => {
                const idx = statuses.findIndex(s => s.val === val);
                if (idx !== -1) currentIndex = idx;
            };
        }
        
        // Checkboxes de exibição
        const chkThumbnails = document.getElementById("chk-show-thumbnails");
        const chkDuration = document.getElementById("chk-show-duration");
        const chkTags = document.getElementById("chk-show-tags");
        const chkStatus = document.getElementById("chk-show-status");
        
        function applyDisplayClasses() {
            const doc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
                ? window.popoutWindows["sidebar-left"].document
                : (window.libraryInstance?.activeDoc || document);
            const chkThumb = doc.getElementById("chk-show-thumbnails") || document.getElementById("chk-show-thumbnails");
            const chkDur = doc.getElementById("chk-show-duration") || document.getElementById("chk-show-duration");
            const chkTag = doc.getElementById("chk-show-tags") || document.getElementById("chk-show-tags");
            const chkStat = doc.getElementById("chk-show-status") || document.getElementById("chk-show-status");

            const lists = getAllMediaLists();
            lists.forEach(list => {
                list.classList.toggle("hide-thumbnails", chkThumb ? !chkThumb.checked : false);
                list.classList.toggle("hide-duration", chkDur ? !chkDur.checked : false);
                list.classList.toggle("hide-tags", chkTag ? !chkTag.checked : false);
                list.classList.toggle("hide-status", chkStat ? !chkStat.checked : false);
            });
        }
        
        const checkboxes = [chkThumbnails, chkDuration, chkTags, chkStatus];
        checkboxes.forEach(chk => {
            if (chk) {
                // Carregar estado salvo
                const savedVal = localStorage.getItem(`lib-pref-${chk.id}`);
                if (savedVal !== null) {
                    chk.checked = savedVal === "true";
                }
                
                chk.addEventListener("change", () => {
                    localStorage.setItem(`lib-pref-${chk.id}`, chk.checked);
                    applyDisplayClasses();
                    if (window.libraryInstance) window.libraryInstance.scheduleRenderMedia();
                });
            }
        });

        // Checkboxes de metadados no Tooltip de Decupagem
        const chkTooltipCat = document.getElementById("chk-tooltip-category");
        const chkTooltipSpk = document.getElementById("chk-tooltip-speaker");
        const chkTooltipDur = document.getElementById("chk-tooltip-duration");
        const chkTooltipTags = document.getElementById("chk-tooltip-tags");
        
        const tooltipPrefsList = [
            { el: chkTooltipCat, key: "category" },
            { el: chkTooltipSpk, key: "speaker" },
            { el: chkTooltipDur, key: "duration" },
            { el: chkTooltipTags, key: "tags" }
        ];

        tooltipPrefsList.forEach(({ el, key }) => {
            if (el) {
                if (window.tooltipDisplayPreferences && window.tooltipDisplayPreferences[key] !== undefined) {
                    el.checked = !!window.tooltipDisplayPreferences[key];
                } else {
                    el.checked = false;
                }
                el.addEventListener("change", () => {
                    if (!window.tooltipDisplayPreferences) window.tooltipDisplayPreferences = {};
                    window.tooltipDisplayPreferences[key] = el.checked;
                    localStorage.setItem("tooltipDisplayPreferences", JSON.stringify(window.tooltipDisplayPreferences));
                    if (window.libraryInstance) window.libraryInstance.scheduleRenderMedia();
                });
            }
        });
        
        applyDisplayClasses();

        // Modo de Visualização (Lista vs Grade)
        const btnViewModeList = document.getElementById("btn-view-mode-list");
        const btnViewModeGrid = document.getElementById("btn-view-mode-grid");
        
        function setViewMode(mode) {
            const lists = getAllMediaLists();
            lists.forEach(list => {
                if (mode === "grid") list.classList.add("view-mode-grid");
                else list.classList.remove("view-mode-grid");
            });
            getAllLibraryDocuments().forEach(doc => {
                try {
                    const btnGrid = doc.getElementById("btn-view-mode-grid");
                    const btnList = doc.getElementById("btn-view-mode-list");
                    if (mode === "grid") {
                        if (btnGrid) btnGrid.classList.add("active");
                        if (btnList) btnList.classList.remove("active");
                    } else {
                        if (btnList) btnList.classList.add("active");
                        if (btnGrid) btnGrid.classList.remove("active");
                    }
                } catch (e) {}
            });
            localStorage.setItem("lib-pref-view-mode", mode);
        }
        
        if (btnViewModeList) {
            btnViewModeList.addEventListener("click", () => setViewMode("list"));
        }
        if (btnViewModeGrid) {
            btnViewModeGrid.addEventListener("click", () => setViewMode("grid"));
        }
        
        // Zoom Slider
        const zoomSlider = document.getElementById("library-zoom-slider");
        const zoomLabel = document.getElementById("library-zoom-label");
        
        function setZoomValue(val) {
            const numericVal = Math.max(30, Math.min(300, parseInt(val, 10)));
            if (isNaN(numericVal)) return;

            const lists = getAllMediaLists();
            lists.forEach(list => {
                list.style.setProperty("--thumb-width", `${numericVal}px`);
                list.style.setProperty("--thumb-height", `${Math.round(numericVal * 9 / 16)}px`);
                updateZoomTier(list, numericVal);
            });

            getAllLibraryDocuments().forEach(doc => {
                try {
                    const lbl = doc.getElementById("library-zoom-label");
                    if (lbl) lbl.textContent = `${numericVal}px`;
                    const sld = doc.getElementById("library-zoom-slider");
                    if (sld) {
                        sld.value = numericVal;
                        sld.setAttribute("data-tooltip", `Zoom Thumbs: ${numericVal}px`);
                    }
                } catch (e) {}
            });

            localStorage.setItem("lib-pref-zoom", numericVal);
        }
        
        if (zoomSlider) {
            zoomSlider.addEventListener("input", (e) => {
                setZoomValue(parseInt(e.target.value));
            });
            zoomSlider.addEventListener("dblclick", () => {
                setZoomValue(80);
            });
        }

        this.applyDisplayClasses = applyDisplayClasses;
        this.setViewMode = setViewMode;
        this.setZoomValue = setZoomValue;
        this.getAllMediaLists = getAllMediaLists;
        window.setLibraryZoomValue = setZoomValue;
        window.getAllMediaLists = getAllMediaLists;
        
        // Carrega preferências salvas
        const savedViewMode = localStorage.getItem("lib-pref-view-mode") || "list";
        setViewMode(savedViewMode);
        
        const savedZoom = localStorage.getItem("lib-pref-zoom") || "80";
        setZoomValue(parseInt(savedZoom));

        // Busca de mídias (Filtro em tempo real)
        const searchInput = document.getElementById("library-search-input");
        if (searchInput) {
            this._lastSearchQuery = searchInput.value;
            searchInput.addEventListener("input", () => {
                const query = searchInput.value;
                const isNewQuery = this._lastSearchQuery !== undefined && this._lastSearchQuery !== query;
                this._lastSearchQuery = query;

                if (isNewQuery) {
                    // Quando o usuário digita uma busca explicitamente nova, reseta para o topo dos resultados
                    this.saveTabScrollPosition("tab-media", 0);
                    this.saveTabScrollPosition("tab-docs", 0);
                }

                // Sincroniza o botão cíclico de status se o texto de busca for alterado
                if (this._btnStatusCycle && this._statusSelect) {
                    let detectedVal = "all";
                    if (/\bstatus:pendente\b/.test(query)) {
                        detectedVal = "pending";
                    } else if (/\(status:(asr|visao)\b/.test(query) || /\bstatus:(asr|visao)\b/.test(query)) {
                        detectedVal = "processed";
                    } else if (/\bstatus:erro\b/.test(query)) {
                        detectedVal = "error";
                    }
                    
                    if (this._statusSelect.value !== detectedVal) {
                        this._statusSelect.value = detectedVal;
                        this._setCurrentIndex(detectedVal);
                        const idx = this._statuses.findIndex(s => s.val === detectedVal);
                        if (idx !== -1) {
                            this._updateStatusUI(idx);
                        }
                    }
                }

                // Redesenhar a arvore inteira custa centenas de ms com uma
                // biblioteca grande; sem debounce cada tecla travava a digitacao.
                if (this._searchRenderTimer) clearTimeout(this._searchRenderTimer);
                this._searchRenderTimer = setTimeout(() => {
                    this._searchRenderTimer = null;

                    // 1. Aba de Mídias (vídeos + fotos, render unico coalescido)
                    this.scheduleRenderMedia();

                    // 2. Aba de Documentos
                    if (this.allDocuments) {
                        this.renderDocuments(this.allDocuments);
                    }

                    // 3. Aba de Temas
                    if (window.panelsManager && typeof window.panelsManager.renderThemesList === 'function') {
                        window.panelsManager.renderThemesList();
                    }

                    // 4. Aba de Rostos
                    if (window.FaceManager && typeof window.FaceManager.renderFaceClusters === 'function') {
                        window.FaceManager.renderFaceClusters();
                    }
                }, 180);
            });
        }

        // Atalho 'a' ou 'A' para abrir o Inspetor de Mídia no lugar do modal
        document.addEventListener("keydown", (e) => {
            const activeTag = document.activeElement?.tagName;
            if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || document.activeElement?.isContentEditable) {
                return; // Ignora se o usuário estiver em um input
            }
            
            // Só responde a 'a' ou 'A' puro (sem Ctrl, Cmd, Alt)
            if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (window.isAnyModalOpen && window.isAnyModalOpen()) {
                    return; // Ignora se qualquer modal/overlay estiver aberto
                }
                if (window.activeFocusedPlayer === "program") {
                    return; // Let the timeline handle it
                }
                // Só ativa o Inspetor de Mídia se estiver nas abas de Mídia (Vídeos/Fotos) ou se o Source Player estiver focado
                const activeTab = document.querySelector("#sidebar-left .tab-content.active")?.id;
                const isMediaTab = activeTab === "tab-media" || activeTab === "tab-videos" || activeTab === "tab-photos" || this.mediaInspectorActive;
                if (!isMediaTab && window.activeFocusedPlayer !== "source") {
                    return;
                }
                if (STATE.activeVideo) {
                    e.preventDefault();
                    this.toggleMediaInspector(STATE.activeVideo);
                }
            }
        });

        // Setup advanced search button toggle
        const btnToggleAdv = document.getElementById("btn-toggle-advanced-search");
        const advPanel = document.getElementById("advanced-search-panel");
        if (btnToggleAdv && advPanel) {
            btnToggleAdv.addEventListener("click", () => {
                const isVisible = advPanel.style.display === "flex";
                advPanel.style.display = isVisible ? "none" : "flex";
                btnToggleAdv.classList.toggle("active", !isVisible);
                if (!isVisible) {
                    this.populateAdvancedFilterKeys();
                    this.renderSuggestionsChips();
                }
            });
        }
        


        // Add filter button
        const btnAddAdv = document.getElementById("btn-add-adv-filter");
        if (btnAddAdv) {
            btnAddAdv.addEventListener("click", () => {
                const key = document.getElementById("adv-filter-key")?.value;
                const op = document.getElementById("adv-filter-op")?.value;
                let val = document.getElementById("adv-filter-value")?.value.trim();
                if (!key || !val) return;
                
                if (val.includes(" ")) {
                    val = `"${val}"`;
                }
                
                const filterExpr = `${key}${op}${val}`;
                const searchInput = document.getElementById("library-search-input");
                if (searchInput) {
                    let currentVal = searchInput.value.trim();
                    if (currentVal) {
                        searchInput.value = currentVal + " " + filterExpr;
                    } else {
                        searchInput.value = filterExpr;
                    }
                    searchInput.dispatchEvent(new Event("input"));
                    document.getElementById("adv-filter-value").value = "";
                }
            });
        }

        // Connect dormant library-filter-status dropdown
        if (statusSelect) {
            statusSelect.addEventListener("change", () => {
                const val = statusSelect.value;
                const searchInput = document.getElementById("library-search-input");
                if (!searchInput) return;
                
                let query = searchInput.value;
                // Remove existing status filters
                query = query.replace(/\bstatus:\S+/g, "").trim();
                query = query.replace(/\(status:[^)]+\)/g, "").trim();
                
                if (val === "pending") {
                    query = (query ? query + " " : "") + "status:pendente";
                } else if (val === "processed") {
                    query = (query ? query + " " : "") + "(status:asr OR status:visao)";
                } else if (val === "error") {
                    query = (query ? query + " " : "") + "status:erro";
                }
                
                searchInput.value = query;
                searchInput.dispatchEvent(new Event("input"));
            });
        }

        // Connect library-sort-by select to trigger real-time re-sort and persist preference
        const sortSelect = document.getElementById("library-sort-by");
        if (sortSelect) {
            sortSelect.addEventListener("change", () => {
                const val = sortSelect.value;
                localStorage.setItem("library_sort_by", val);
                STATE.emit("videosUpdated", STATE.allVideos);
                if (STATE.allPhotos) STATE.emit("photosUpdated", STATE.allPhotos);
            });
        }

        // Setup Autocomplete
        this.setupAutocomplete();

        // Força foco do player de origem ao clicar na biblioteca
        const sidebarLeft = document.getElementById("sidebar-left");
        if (sidebarLeft) {
            sidebarLeft.addEventListener("click", () => {
                window.activeFocusedPlayer = "source";
            });
        }
    }

    updateSearchPlaceholder(tabId) {
        this.currentTabId = tabId;
        this.populateAdvancedFilterKeys();
        this.renderSuggestionsChips();
        
        const searchInput = document.getElementById("library-search-input");
        if (!searchInput) return;
        
        switch (tabId) {
            case "tab-media":
            case "tab-videos":
            case "tab-photos":
                searchInput.placeholder = "Buscar mídias...";
                break;
            case "tab-themes":
                searchInput.placeholder = "Buscar temas...";
                break;
            case "tab-docs":
                searchInput.placeholder = "Buscar documentos...";
                break;
            case "tab-faces":
                searchInput.placeholder = "Buscar rostos...";
                break;
            default:
                searchInput.placeholder = "Buscar...";
        }
    }

    populateAdvancedFilterKeys() {
        const keySelect = document.getElementById("adv-filter-key");
        if (!keySelect) return;
        keySelect.innerHTML = "";
        
        let options = [];
        const tabId = this.currentTabId || "tab-media";
        if (tabId === "tab-media" || tabId === "tab-videos" || tabId === "tab-photos") {
            options = [
                { value: "tipo", label: "Tipo (fala/bastidores/video/foto)" },
                { value: "status", label: "Status (pendente/asr/visao/erro)" },
                { value: "cat", label: "Categoria (obra/processo...)" },
                { value: "pasta", label: "Pasta / Bin" },
                { value: "data", label: "Data / Diária" },
                { value: "duracao", label: "Duração (segundos)" },
                { value: "tag", label: "Tag" },
                { value: "fps", label: "FPS" },
                { value: "res", label: "Resolução" },
                { value: "formato", label: "Formato (raw/jpg/mp4)" }
            ];
        } else if (tabId === "tab-themes") {
            options = [
                { value: "trechos", label: "Qtd. Trechos" }
            ];
        } else if (tabId === "tab-docs") {
            options = [
                { value: "tipo", label: "Tipo Doc (roteiro/pauta/outros)" }
            ];
        } else if (tabId === "tab-faces") {
            options = [
                { value: "nome", label: "Nome" },
                { value: "aparicoes", label: "Aparições" },
                { value: "grupo", label: "Grupo ID" }
            ];
        }
        
        options.forEach(opt => {
            const o = document.createElement("option");
            o.value = opt.value;
            o.textContent = opt.label;
            keySelect.appendChild(o);
        });
    }

    renderSuggestionsChips() {
        const chipsContainer = document.getElementById("advanced-suggestions-chips");
        if (!chipsContainer) return;
        chipsContainer.innerHTML = "";
        
        const tabId = this.currentTabId || "tab-media";
        let items = [];
        if (tabId === "tab-media") items = [...(STATE.allVideos || []), ...(STATE.allPhotos || [])];
        else if (tabId === "tab-videos") items = STATE.allVideos || [];
        else if (tabId === "tab-photos") items = STATE.allPhotos || [];
        else if (tabId === "tab-docs") items = this.allDocuments || [];
        else if (tabId === "tab-themes") items = window.panelsManager?.allThemes || [];
        else if (tabId === "tab-faces") items = FaceManager?.allClusters || [];
        
        const suggestions = getAvailableSuggestions(items, tabId);
        if (suggestions.length === 0) {
            chipsContainer.innerHTML = `<span style="color:var(--text-muted); font-size:9px; padding: 4px;">Nenhuma tag sugerida para este material.</span>`;
            return;
        }
        
        suggestions.slice(0, 20).forEach(s => {
            const chip = document.createElement("span");
            chip.className = `adv-suggestion-chip category-${s.category.toLowerCase().replace(/\//g, "-")}`;
            chip.innerHTML = `${s.value} <span class="chip-count">${s.count}</span>`;
            chip.title = `Filtrar por ${s.value} (${s.count} ocorrências)`;
            chip.addEventListener("click", () => {
                const searchInput = document.getElementById("library-search-input");
                if (searchInput) {
                    let query = searchInput.value.trim();
                    if (query) {
                        if (!query.includes(s.value)) {
                            query += " " + s.value;
                        }
                    } else {
                        query = s.value;
                    }
                    searchInput.value = query;
                    searchInput.dispatchEvent(new Event("input"));
                }
            });
            chipsContainer.appendChild(chip);
        });
    }

    setupAutocomplete() {
        const searchInput = document.getElementById("library-search-input");
        const dropdown = document.getElementById("library-autocomplete-dropdown");
        if (!searchInput || !dropdown) return;
        
        let activeIdx = -1;
        let visibleItems = [];
        
        const closeDropdown = () => {
            dropdown.style.display = "none";
            activeIdx = -1;
        };
        
        const updateDropdown = () => {
            const query = searchInput.value.trim();
            
            // Só mostra sugestões quando há pelo menos 1 caractere digitado
            if (!query) {
                closeDropdown();
                return;
            }
            
            const lastWord = query.split(/\s+/).pop().toLowerCase();
            
            const tabId = this.currentTabId || "tab-media";
            let items = [];
            if (tabId === "tab-media") items = [...(STATE.allVideos || []), ...(STATE.allPhotos || [])];
            else if (tabId === "tab-videos") items = STATE.allVideos || [];
            else if (tabId === "tab-photos") items = STATE.allPhotos || [];
            else if (tabId === "tab-docs") items = this.allDocuments || [];
            else if (tabId === "tab-themes") items = window.panelsManager?.allThemes || [];
            else if (tabId === "tab-faces") items = FaceManager?.allClusters || [];
            
            const suggestions = getAvailableSuggestions(items, tabId);
            
            // Filtra pelo que o usuário está digitando atualmente
            let matches = suggestions;
            if (lastWord) {
                matches = suggestions.filter(s => {
                    return s.displayLabel.toLowerCase().includes(lastWord) ||
                           s.value.toLowerCase().includes(lastWord);
                });
            }
            
            if (matches.length === 0) {
                closeDropdown();
                return;
            }
            
            dropdown.innerHTML = "";
            visibleItems = matches.slice(0, 10);
            
            let currentCategory = "";
            visibleItems.forEach((item, idx) => {
                if (item.category !== currentCategory) {
                    currentCategory = item.category;
                    const catHeader = document.createElement("div");
                    catHeader.className = "autocomplete-suggestion-category";
                    catHeader.textContent = currentCategory;
                    dropdown.appendChild(catHeader);
                }
                
                const row = document.createElement("div");
                row.className = "autocomplete-suggestion-item" + (idx === activeIdx ? " active" : "");
                row.innerHTML = `
                    <span>${item.displayLabel}</span>
                    <span class="suggestion-count">${item.count}</span>
                `;
                
                row.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    selectSuggestion(item);
                });
                
                dropdown.appendChild(row);
            });
            
            dropdown.style.display = "block";
        };
        
        const selectSuggestion = (item) => {
            const currentVal = searchInput.value;
            const words = currentVal.split(/\s+/);
            words.pop();
            words.push(item.insertValue);
            searchInput.value = words.join(" ") + " ";
            searchInput.dispatchEvent(new Event("input"));
            // Mantém o dropdown aberto e atualiza sugestões após seleção
            searchInput.focus();
            setTimeout(() => {
                activeIdx = -1;
                updateDropdown();
            }, 50);
        };
        
        searchInput.addEventListener("input", () => {
            activeIdx = -1;
            updateDropdown();
        });
        
        searchInput.addEventListener("blur", () => {
            setTimeout(closeDropdown, 200);
        });
        
        searchInput.addEventListener("keydown", (e) => {
            if (dropdown.style.display === "none") return;
            
            const rows = dropdown.querySelectorAll(".autocomplete-suggestion-item");
            
            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % visibleItems.length;
                rows.forEach((r, idx) => {
                    if (idx === activeIdx) {
                        r.classList.add("active");
                        r.scrollIntoView({ block: "nearest" });
                    } else {
                        r.classList.remove("active");
                    }
                });
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIdx = (activeIdx - 1 + visibleItems.length) % visibleItems.length;
                rows.forEach((r, idx) => {
                    if (idx === activeIdx) {
                        r.classList.add("active");
                        r.scrollIntoView({ block: "nearest" });
                    } else {
                        r.classList.remove("active");
                    }
                });
            } else if (e.key === "Enter") {
                if (activeIdx >= 0 && activeIdx < visibleItems.length) {
                    e.preventDefault();
                    selectSuggestion(visibleItems[activeIdx]);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeDropdown();
            }
        });
    }

    async reloadData() {
        try {
            const projectId = STATE.currentProjectId || 1;
            try {
                const binsResp = await CapIAuAPI.fetchProjectBins(projectId);
                if (binsResp && Array.isArray(binsResp.bins)) {
                    window.projectBinsList = binsResp.bins;
                }
            } catch (err) {
                console.warn("[LibraryManager] Falha ao carregar bins:", err);
            }

            const videos = await CapIAuAPI.fetchVideos(projectId);
            STATE.allVideos = videos;
            const photos = await CapIAuAPI.fetchPhotos(projectId);
            STATE.allPhotos = photos;
            this.scheduleRenderMedia();
            await this.loadDocuments();
            this.checkFailedMediaCount();
        } catch (e) {
            console.error("[LibraryManager] Falha ao recarregar mídias:", e);
        }
    }

    isMediaFailed(v) {
        if (!v) return false;
        if (v.status === "analyzing" || v.status === "processing" || v.status === "transcribing" || v.status === "pending") {
            return false;
        }
        const vText = ((v.summary || '') + ' ' + (v.description || '') + ' ' + (v.title || '')).toLowerCase();
        const errorKeys = [
            'análise visual falhou', 'análise falhou', 'sistema de análise', 'falha visual', 'erro de captura',
            'não foi possível', 'chroma', 'croma', 'tela verde', 'artefato', 'distorção', 'distorcao', 'corrompido'
        ];
        return v.status === "error" || errorKeys.some(k => vText.includes(k));
    }

    async handleFailedButtonClick() {
        const btn = document.getElementById("btn-reanalyze-failed");
        if (!btn) return;

        if (!this.isFailedFilterActive) {
            // Estágio 1 -> Estágio 2: Efeito pulso + spinner + ativa filtro para mídias com falha
            btn.classList.add("btn-thumb-click-pulse");
            const iconEl = btn.querySelector("i");
            if (iconEl) iconEl.className = "fa-solid fa-circle-notch fa-spin";

            const allVideos = STATE.allVideos || [];
            const failedVideos = allVideos.filter(v => this.isMediaFailed(v));

            this.selectedFailedIds = new Set(failedVideos.map(v => v.id));
            this.isFailedFilterActive = true;

            this.renderVideos(allVideos);

            setTimeout(() => {
                if (iconEl) iconEl.className = "fa-solid fa-arrows-rotate";
                btn.classList.remove("btn-thumb-click-pulse");
                this.checkFailedMediaCount();
            }, 300);

            if (window.showToast) {
                window.showToast(`Exibindo ${failedVideos.length} mídias com falha. Clique em 'Voltar' ou pressione Esc / Ctrl+Z para sair.`, "info");
            }
        } else {
            // Estágio 2 -> Estágio 3: Dispara reanálise dos selecionados ou encerra filtro se nada selecionado
            if (this.selectedFailedIds.size === 0) {
                this.exitFailedFilter();
                if (window.showToast) window.showToast("Nenhuma mídia selecionada. Filtro de falhas encerrado (exibindo todas as mídias).", "info");
                return;
            }

            const selectedIdsArray = Array.from(this.selectedFailedIds);

            // Animação voadora p/ MLD (Tasks)
            if (window.flyToTasksAnimation) {
                window.flyToTasksAnimation(btn);
            }

            // Abre / expande MLD e alterna p/ Tarefas
            if (window.openTasksDrawerAndSwitchTab) {
                window.openTasksDrawerAndSwitchTab();
            }

            try {
                const res = await fetch(`/api/media/reanalyze-failed?project_id=${STATE.currentProjectId || ''}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ media_ids: selectedIdsArray })
                });
                const data = await res.json();
                if (window.showToast) window.showToast(`Reanálise iniciada para ${data.count || selectedIdsArray.length} vídeos!`, "info");

                // Força atualização imediata do feed de tarefas no MLD
                if (window.panelsManager && window.panelsManager.refreshTasks) {
                    window.panelsManager.refreshTasks();
                    setTimeout(() => window.panelsManager && window.panelsManager.refreshTasks(), 600);
                    setTimeout(() => window.panelsManager && window.panelsManager.refreshTasks(), 1500);
                }

                this.exitFailedFilter();
                this.reloadData();
            } catch (err) {
                console.error("Erro ao disparar reanálise selecionada:", err);
                if (window.showToast) window.showToast("Erro ao disparar reanálise: " + err.message, "error");
            }
        }
    }

    selectAllFailedMedia() {
        const allVideos = STATE.allVideos || [];
        const failedVideos = allVideos.filter(v => this.isMediaFailed(v));
        this.selectedFailedIds = new Set(failedVideos.map(v => v.id));
        this.renderVideos(allVideos);
        this.checkFailedMediaCount();
    }

    deselectAllFailedMedia() {
        this.selectedFailedIds.clear();
        const allVideos = STATE.allVideos || [];
        this.renderVideos(allVideos);
        this.checkFailedMediaCount();
    }

    exitFailedFilter() {
        this.isFailedFilterActive = false;
        this.selectedFailedIds.clear();
        const allVideos = STATE.allVideos || [];
        this.renderVideos(allVideos);
        this.checkFailedMediaCount();
    }

    async checkFailedMediaCount() {
        try {
            const allVideos = STATE.allVideos || [];
            const analyzingCount = allVideos.filter(v => v.status === "analyzing" || v.status === "processing" || v.status === "pending").length;
            const btnCancelAnalyses = document.getElementById("btn-cancel-all-analyses");
            if (btnCancelAnalyses) {
                btnCancelAnalyses.style.display = (analyzingCount > 0) ? "inline-flex" : "none";
            }

            const res = await fetch(`/api/media/failed-count?project_id=${STATE.currentProjectId || ''}`);
            if (!res.ok) return;
            const data = await res.json();
            
            const btn = document.getElementById("btn-reanalyze-failed");
            const badge = document.getElementById("failed-count-badge");
            const btnSelectAll = document.getElementById("btn-select-all-failed");
            const btnDeselectAll = document.getElementById("btn-deselect-all-failed");
            const btnExitFilter = document.getElementById("btn-exit-failed-filter");
            const banner = document.getElementById("failed-media-banner");
            const bannerCount = document.getElementById("banner-failed-count");

            if (data.count > 0 || this.isFailedFilterActive) {
                if (btn) btn.style.display = "inline-flex";
                if (bannerCount) bannerCount.textContent = data.count;
                if (banner) banner.style.display = "flex";

                if (this.isFailedFilterActive) {
                    // Estado Amarelo (Filtrado / Selecionando)
                    if (btn) {
                        btn.className = "lib-action-btn state-filtering-failures";
                        btn.setAttribute("data-tooltip", `Iniciar Reanálise (${this.selectedFailedIds.size} mídias)`);
                    }
                    if (badge) badge.textContent = this.selectedFailedIds.size;
                    if (btnSelectAll) btnSelectAll.style.display = "inline-flex";
                    if (btnDeselectAll) btnDeselectAll.style.display = "inline-flex";
                    if (btnExitFilter) btnExitFilter.style.display = "inline-flex";
                } else {
                    // Estado Vermelho (Visão com falha detectada)
                    if (btn) {
                        btn.className = "lib-action-btn btn-flat-rose state-has-failures";
                        btn.setAttribute("data-tooltip", "Ver falhas na biblioteca");
                    }
                    if (badge) badge.textContent = data.count;
                    if (btnSelectAll) btnSelectAll.style.display = "none";
                    if (btnDeselectAll) btnDeselectAll.style.display = "none";
                    if (btnExitFilter) btnExitFilter.style.display = "none";
                }
            } else {
                if (btn) btn.style.display = "none";
                if (btnSelectAll) btnSelectAll.style.display = "none";
                if (btnDeselectAll) btnDeselectAll.style.display = "none";
                if (btnExitFilter) btnExitFilter.style.display = "none";
                if (banner) banner.style.display = "none";
            }
        } catch (err) {
            console.error("[LibraryManager] Erro ao checar contagem de falhas:", err);
        }
    }

    async loadDocuments() {
        if (!this.docsListEl) return;
        this.docsListEl.innerHTML = "<div class='loading' style='font-size:11px; color:var(--text-muted);'>Carregando documentos...</div>";
        try {
            const docs = await CapIAuAPI.fetchDocuments(STATE.currentProjectId);
            this.allDocuments = docs;
            this.renderDocuments(docs);
        } catch (e) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
        }
    }

    renderDocuments(docs, options = {}) {
        if (!this.docsListEl) return;
        const container = this.getScrollContainer();
        const shouldPreserveScroll = options.preserveScroll !== false;
        const savedScroll = (shouldPreserveScroll && container)
            ? (this.tabScrollPositions?.["tab-docs"] !== undefined ? this.tabScrollPositions["tab-docs"] : container.scrollTop)
            : 0;

        this.docsListEl.innerHTML = "";
        
        if (!docs || docs.length === 0) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
            return;
        }

        // Apply search input query filter
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.trim() : "";
        
        let filtered = docs;
        if (query) {
            const ast = parseQuery(query);
            if (ast) {
                filtered = docs.filter(doc => evaluateAST(ast, doc, "tab-docs"));
            }
        }
        
        if (filtered.length === 0) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento encontrado.</div>";
            return;
        }
        
        filtered.forEach(doc => {
            const card = document.createElement("div");
            card.className = "media-card";
            card.setAttribute("data-doc-id", doc.id);
            card.style.display = "flex";
            card.style.alignItems = "center";
            card.style.justifyContent = "space-between";
            card.style.padding = "8px 10px";
            card.style.gap = "8px";
            card.style.cursor = "default";
            card.style.marginBottom = "6px";
            
            let docIcon = "fa-file-lines";
            if (doc.doc_type === "script") docIcon = "fa-scroll";
            else if (doc.doc_type === "outline") docIcon = "fa-list-ol";
            else if (doc.doc_type === "notes") docIcon = "fa-clipboard";

            const extractBtn = doc.doc_type === "script"
                ? `<button class="btn-card-action doc-extract-btn" data-doc-id="${doc.id}" style="color:var(--color-violet); background:transparent; border:none; cursor:pointer;" onclick="window.startScriptExtraction(${doc.id}, '${doc.filename.replace(/'/g, "\\'")}')" title="Extrair estrutura (cenas e personagens)"><i class="fa-solid fa-diagram-project"></i></button>`
                : "";
            const extractBadge = doc.doc_type === "script"
                ? `<span class="doc-extract-badge" data-doc-id="${doc.id}" style="font-size:9px; color:var(--color-violet);"></span>`
                : "";

            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    <i class="fa-solid ${docIcon}" style="color: var(--color-cyan); font-size: 14px;"></i>
                    <div style="display:flex; flex-direction:column; min-width:0; flex:1;">
                        <span style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);" title="${doc.filename}">${doc.filename}</span>
                        <span style="font-size:9px; color:var(--text-muted); text-transform:capitalize;">${doc.doc_type === 'script' ? 'Roteiro' : doc.doc_type}</span>
                        ${extractBadge}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:2px; flex-shrink:0;">
                    ${extractBtn}
                    <button class="btn-card-action" style="color:var(--color-rose); background:transparent; border:none; cursor:pointer;" onclick="window.deleteDocument(${doc.id})" title="Deletar Documento"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            `;

            this.docsListEl.appendChild(card);

            if (doc.doc_type === "script") {
                this.refreshExtractionBadge(doc.id);
            }
        });

        if (shouldPreserveScroll && container) {
            const isTabActive = this.docsListEl.closest(".tab-content")?.classList.contains("active");
            if (isTabActive && savedScroll > 0) {
                container.scrollTop = savedScroll;
                requestAnimationFrame(() => {
                    container.scrollTop = savedScroll;
                    requestAnimationFrame(() => {
                        container.scrollTop = savedScroll;
                    });
                });
            }
            this.tabScrollPositions = this.tabScrollPositions || {};
            this.tabScrollPositions["tab-docs"] = savedScroll;
        }
    }

    /** Consulta a última rodada de extração do doc e atualiza o badge/título do
     * botão sem bloquear a renderização inicial da lista de documentos. */
    async refreshExtractionBadge(docId) {
        try {
            const ext = await CapIAuAPI.fetchDocExtraction(docId);
            const badge = this.docsListEl.querySelector(`.doc-extract-badge[data-doc-id="${docId}"]`);
            const btn = this.docsListEl.querySelector(`.doc-extract-btn[data-doc-id="${docId}"]`);
            if (!badge || !btn) return;

            if (ext.status === "done") {
                const scenesResp = await CapIAuAPI.fetchScenes(STATE.currentProjectId, docId);
                const n = scenesResp.scenes ? scenesResp.scenes.length : 0;
                badge.textContent = n > 0 ? `${n} cenas extraídas — ver/curar` : "Sem cenas (documento em prosa)";
                if (n > 0) {
                    badge.style.cursor = "pointer";
                    badge.style.textDecoration = "underline";
                    // Cenas continuam curadas inline (#script-structure); entidades sugeridas
                    // pela mesma extração migraram para o painel dedicado (E-B).
                    badge.onclick = () => {
                        this.showScriptStructure(docId);
                        if (window.EntityManager) window.EntityManager.openEntitiesModal({ status: "suggested" });
                    };
                }
                btn.title = "Reextrair estrutura";
            } else if (ext.status === "error") {
                badge.textContent = "Falha na última extração — tentar de novo";
                badge.style.color = "var(--color-rose)";
            } else if (ext.status === "running") {
                badge.textContent = "Extraindo…";
            }
        } catch (e) {
            // Falha silenciosa: o badge fica vazio, o botão continua funcional.
        }
    }

    /** Reconsulta o status da rodada a cada 2s enquanto ela estiver 'running', para o
     * badge acompanhar a extração sem o usuário precisar recarregar a aba. */
    async pollExtraction(docId, attemptsLeft) {
        if (attemptsLeft <= 0) return;
        await this.refreshExtractionBadge(docId);
        try {
            const ext = await CapIAuAPI.fetchDocExtraction(docId);
            if (ext.status === "running") {
                setTimeout(() => this.pollExtraction(docId, attemptsLeft - 1), 2000);
            }
        } catch (e) {
            // Para de tentar silenciosamente — o usuário ainda vê a aba Tarefas.
        }
    }

    /** Busca as cenas do doc e renderiza a curadoria em massa. Entidades sugeridas
     * pela mesma extração migraram para o painel dedicado "Entidades do Projeto"
     * (E-B) — não têm mais UI própria aqui, evitando curadoria duplicada. */
    async showScriptStructure(docId) {
        const section = document.getElementById("script-structure");
        if (!section) return;

        section.style.display = "flex";
        section.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando estrutura…</div>`;

        try {
            const scenesResp = await CapIAuAPI.fetchScenes(STATE.currentProjectId, docId, true);
            this.renderScriptStructureSection(docId, scenesResp.scenes || []);
        } catch (e) {
            section.innerHTML = `<div style="font-size:11px; color:var(--color-rose); padding:8px;">Erro ao carregar estrutura: ${e.message}</div>`;
        }
    }

    renderScriptStructureSection(docId, scenes) {
        const section = document.getElementById("script-structure");
        if (!section) return;
        section.dataset.docId = docId;

        const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

        const visibleScenes = scenes.filter(s => s.status !== "rejected");
        const sceneRows = visibleScenes.map(s => `
            <label style="display:flex; align-items:flex-start; gap:6px; font-size:11px; padding:4px 0; cursor:pointer;">
                <input type="checkbox" class="curation-scene-check" data-scene-id="${s.id}" style="margin-top:2px;">
                <span>
                    <strong>${s.number}. ${esc(s.heading || "(sem título)")}</strong>${s.status === "confirmed" ? ' <span style="color:var(--color-emerald);">✓ confirmada</span>' : ""}
                    <br><span style="color:var(--text-muted);">${esc(s.synopsis || "")}</span>
                </span>
            </label>
        `).join("") || `<div style="font-size:11px; color:var(--text-muted); padding:4px 0;">Nenhuma cena extraída.</div>`;

        section.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:11px; font-weight:700; color:var(--text-primary);"><i class="fa-solid fa-diagram-project"></i> Estrutura extraída</span>
                <button onclick="window.closeScriptStructure()" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; font-size:12px;" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div style="display:flex; flex-direction:column; gap:2px;">
                <div style="font-size:10px; font-weight:700; color:var(--color-violet); text-transform:uppercase;">Cenas (${visibleScenes.length})</div>
                <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-glass); border-radius:6px; padding:4px 8px;">${sceneRows}</div>
                <div style="display:flex; gap:6px; margin-top:4px;">
                    <button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="window.applySceneCuration('confirmed')">Aceitar selecionadas</button>
                    <button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="window.applySceneCuration('rejected')">Rejeitar selecionadas</button>
                    <button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="window.applySceneCuration('confirmed', true)">Aceitar todas</button>
                </div>
            </div>

            <div style="margin-top:6px;">
                <button class="btn-secondary" style="font-size:10px; padding:4px 8px;" onclick="window.EntityManager.openEntitiesModal({status:'suggested'})"><i class="fa-solid fa-address-card"></i> Ver personagens / locações / objetos sugeridos</button>
            </div>
        `;
    }

    /**
     * Revela um vídeo na biblioteca (aba Vídeos): abre a aba de vídeos, expande as
     * pastas ancestrais no tree, seleciona o card, rola até ele e dá um pulso visual.
     * Usado pelo clique numa tarefa. Retorna false se o vídeo não estiver na biblioteca.
     */
    revealVideoById(videoId) {
        const video = (STATE.allVideos || []).find(v => v.id === videoId);
        if (!video) return false;

        const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
            ? window.popoutWindows["sidebar-left"].document
            : (this.activeDoc || document);
        const tabBtn = targetDoc.querySelector('.sidebar-left .tab-btn[data-tab="tab-media"]');
        if (tabBtn) tabBtn.click();

        // Expande os bins ancestrais do item (caminho virtual, nao mais o de disco)
        const vPath = getItemVirtualFolder(video);
        if (vPath && vPath !== "root") {
            const parts = vPath.replace(/^root\/?/, "").split("/").filter(Boolean);
            let currentPath = "root";
            for (const part of parts) {
                currentPath = currentPath + "/" + part;
                openFoldersSet.add(currentPath);
            }
            saveOpenFoldersState();
        }

        STATE.activeVideo = video;
        this.renderMedia();

        flushAllPendingChunks(); // o card alvo pode estar num bloco ainda nao montado

        requestAnimationFrame(() => {
            const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
                ? window.popoutWindows["sidebar-left"].document
                : (this.activeDoc || document);
            const card = targetDoc.querySelector(`.media-card.tree-file-item[data-video-id="${videoId}"]`);
            if (card) {
                card.scrollIntoView({ block: "center", behavior: "smooth" });
                card.classList.remove("reveal-pulse");
                void card.offsetWidth; // reinicia a animação se já estava aplicada
                card.classList.add("reveal-pulse");
                setTimeout(() => card.classList.remove("reveal-pulse"), 1600);
            }
        });
        return true;
    }

    /** Revela uma foto na aba Fotos: rola até o card e dá o pulso visual. */
    revealPhotoById(photoId) {
        const photo = (STATE.allPhotos || []).find(p => p.id === photoId);
        if (!photo) return false;

        const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
            ? window.popoutWindows["sidebar-left"].document
            : (this.activeDoc || document);
        const tabBtn = targetDoc.querySelector('.sidebar-left .tab-btn[data-tab="tab-media"]');
        if (tabBtn) tabBtn.click();

        const vPath = getItemVirtualFolder(photo);
        if (vPath && vPath !== "root") {
            const parts = vPath.replace(/^root\/?/, "").split("/").filter(Boolean);
            let currentPath = "root";
            for (const part of parts) {
                currentPath = currentPath + "/" + part;
                openFoldersSet.add(currentPath);
            }
            saveOpenFoldersState();
            this.renderMedia();
        }
        STATE.activePhoto = photo;

        flushAllPendingChunks();

        requestAnimationFrame(() => {
            const card = targetDoc.querySelector(`[data-photo-id="${photoId}"]`);
            if (card) {
                card.scrollIntoView({ block: "center", behavior: "smooth" });
                card.classList.remove("reveal-pulse");
                void card.offsetWidth;
                card.classList.add("reveal-pulse");
                setTimeout(() => card.classList.remove("reveal-pulse"), 1600);
            }
        });
        return true;
    }

    renderMedia(options = {}) {
        const targetEl = (this.activeDoc || document).getElementById("media-tree-list") || document.getElementById("media-tree-list") || this.videoListEl;
        if (!targetEl) return;
        const container = this.getScrollContainer();
        const shouldPreserveScroll = options.preserveScroll !== false;
        const savedScroll = (shouldPreserveScroll && container)
            ? (this.tabScrollPositions?.["tab-media"] !== undefined ? this.tabScrollPositions["tab-media"] : container.scrollTop)
            : 0;

        cancelPendingChunkJobs();
        targetEl.innerHTML = "";
        refreshRenderContext();

        // Aplica modo de visualização e zoom persistidos diretamente no container
        const savedMode = localStorage.getItem("lib-pref-view-mode") || "list";
        if (savedMode === "grid") targetEl.classList.add("view-mode-grid");
        else targetEl.classList.remove("view-mode-grid");

        const savedZoom = parseInt(localStorage.getItem("lib-pref-zoom")) || 80;
        targetEl.style.setProperty("--thumb-width", `${savedZoom}px`);
        targetEl.style.setProperty("--thumb-height", `${Math.round(savedZoom * 9 / 16)}px`);
        updateZoomTier(targetEl, savedZoom);

        const allVids = STATE.allVideos || [];
        const allPhotos = STATE.allPhotos || [];

        // Atualiza contadores dos chips de tipo
        getAllLibraryDocuments().forEach(doc => {
            try {
                const countAllEl = doc.getElementById("count-all");
                const countVideoEl = doc.getElementById("count-video");
                const countPhotoEl = doc.getElementById("count-photo");
                const countAudioEl = doc.getElementById("count-audio");

                if (countAllEl) countAllEl.textContent = `${allVids.length + allPhotos.length}`;
                if (countVideoEl) countVideoEl.textContent = `${allVids.length}`;
                if (countPhotoEl) countPhotoEl.textContent = `${allPhotos.length}`;
                if (countAudioEl) countAudioEl.textContent = "0";
            } catch (e) {}
        });

        // Marca a origem de cada item uma unica vez: video e foto compartilham
        // a mesma arvore agora, e adivinhar o tipo por `duration` dava falso negativo.
        for (const v of allVids) v._mediaKind = "video";
        for (const ph of allPhotos) ph._mediaKind = "photo";

        // Filtro por chip de tipo
        let items = [];
        const typeFilter = this.activeTypeFilter || "all";
        if (typeFilter === "video") {
            items = allVids.slice();
        } else if (typeFilter === "photo") {
            items = allPhotos.slice();
        } else if (typeFilter === "audio") {
            items = [];
        } else {
            items = allVids.concat(allPhotos);
        }

        // Filtro da barra de busca (AST resolvido em refreshRenderContext)
        if (renderCtx.ast) {
            items = items.filter(it => evaluateAST(renderCtx.ast, it, "tab-media"));
        }

        if (items.length === 0) {
            targetEl.innerHTML = `<div class="empty-state-text">Nenhuma mídia encontrada com os filtros atuais.</div>`;
            return;
        }

        const tree = buildTree(items);
        lastRenderedTree = tree;
        if (tree.isRoot && tree.name === "Biblioteca") {
            appendChildrenChunked(tree, getSortedChildrenKeys(tree), targetEl, 0);
        } else {
            const fragment = document.createDocumentFragment();
            renderTreeNode(tree, fragment, 0);
            targetEl.appendChild(fragment);
        }

        if (shouldPreserveScroll && container) {
            const isTabActive = targetEl.closest(".tab-content")?.classList.contains("active");
            if (isTabActive && savedScroll > 0) {
                container.scrollTop = savedScroll;
                requestAnimationFrame(() => {
                    container.scrollTop = savedScroll;
                });
            }
            this.tabScrollPositions = this.tabScrollPositions || {};
            this.tabScrollPositions["tab-media"] = savedScroll;
        }
    }

    /**
     * Agenda um unico render por frame. Quase todos os call-sites emitem
     * "videosUpdated" e "photosUpdated" em sequencia; sem coalescencia isso
     * reconstruia a arvore inteira duas vezes seguidas.
     */
    scheduleRenderMedia(options = {}) {
        this._pendingRenderOptions = { ...(this._pendingRenderOptions || {}), ...options };
        if (this._renderScheduled) return;
        this._renderScheduled = true;
        // Microtask, nao requestAnimationFrame: rAF nao dispara com a janela
        // oculta/minimizada, o que deixaria a biblioteca em branco ate o foco voltar.
        Promise.resolve().then(() => {
            this._renderScheduled = false;
            const opts = this._pendingRenderOptions || {};
            this._pendingRenderOptions = null;
            try {
                this.renderMedia(opts);
            } catch (err) {
                console.error("[LibraryManager] Falha ao renderizar a biblioteca:", err);
            }
        });
    }

    renderVideos(videos, options = {}) {
        this.scheduleRenderMedia(options);
    }

    renderPhotos(photos, options = {}) {
        this.scheduleRenderMedia(options);
    }

    async runWatchScan() {
        try {
            await CapIAuAPI.request(`/api/project/${STATE.currentProjectId}/scan-watch`, { method: "POST" });
            alert("Varredura da pasta watch/ iniciada em background.");
            this.reloadData();
        } catch (err) {
            alert("Erro ao iniciar varredura: " + err.message);
        }
    }

    async runImportExternal() {
        showImportChoicesMenu(this.btnImportExternal || document.getElementById("btn-add-media"), "root");
    }

    async runOpenProxies() {
        try {
            await CapIAuAPI.request("/api/project/open-proxies-folder", { method: "POST" });
        } catch (err) {
            alert("Erro ao abrir pasta de proxies: " + err.message);
        }
    }

    async runRetryFailed() {
        try {
            await CapIAuAPI.request(`/api/project/${STATE.currentProjectId}/retry-failed`, { method: "POST" });
            alert("Reprocessamento de proxies e transcrições falhas reiniciado em background.");
            this.reloadData();
        } catch (err) {
            alert("Erro ao reiniciar falhas: " + err.message);
        }
    }

    /** CapIAuAPI.request lança o corpo cru; no FastAPI ele vem como {"detail": ...}. */
    extrairMensagemErro(err) {
        const bruto = (err && err.message) || String(err);
        try {
            const corpo = JSON.parse(bruto);
            if (corpo && corpo.detail) return corpo.detail;
        } catch (_) { /* não era JSON: usa como veio */ }
        return bruto;
    }

    async triggerTranscribeAll() {
        // B3: lança o worker em processo separado em vez de rodar o lote dentro do
        // servidor. O lote interno sufocava o event loop e derrubava a interface
        // inteira; aqui a tela continua respondendo durante a rodada.
        //
        // Prévia antes de qualquer gasto: a fila do projeto inclui todo B-roll ainda
        // não transcrito e a conta passa fácil de US$ 4. Ninguém deve descobrir isso
        // depois de clicar.
        let previa;
        try {
            previa = await CapIAuAPI.launchTranscriptionWorker(STATE.currentProjectId, { dryRun: true });
        } catch (err) {
            const msg = this.extrairMensagemErro(err);
            if (window.showToast) window.showToast("Erro ao consultar a fila: " + msg, "error");
            else alert("Erro ao consultar a fila: " + msg);
            return;
        }

        if (!previa.count) {
            if (window.showToast) window.showToast("Nenhum clipe pendente de transcrição.", "info");
            else alert("Nenhum clipe pendente de transcrição.");
            return;
        }

        const aviso = `Transcrever ${previa.count} clipe(s) pendentes do projeto?\n\n` +
            `Duração: ${previa.horas} h de áudio\n` +
            `Custo estimado: US$ ${Number(previa.custo_estimado_usd).toFixed(2)} (AssemblyAI)\n\n` +
            "A rodada acontece em um processo separado — a interface continua funcionando.\n\n" +
            "ATENÇÃO: a BUSCA SEMÂNTICA fica indisponível até o fim da rodada " +
            "(o banco vetorial é embutido e só aceita um processo por vez). " +
            "Ela volta sozinha quando o worker terminar.";
        if (!confirm(aviso)) return;

        try {
            const res = await CapIAuAPI.launchTranscriptionWorker(STATE.currentProjectId);

            if (!res.count) {
                if (window.showToast) window.showToast("Nenhum clipe pendente de transcrição.", "info");
                else alert("Nenhum clipe pendente de transcrição.");
                return;
            }

            if (window.logManager) {
                window.logManager.log(
                    "ASR",
                    `Worker de transcrição iniciado (PID ${res.pid}): ${res.count} clipe(s), ${res.horas} h de áudio. Log: ${res.log_stdout}`,
                    "ACTION"
                );
                window.logManager.log("ASR", "Busca semântica indisponível até o fim da rodada.", "WARN");
            }

            if (window.showToast) {
                window.showToast(`Transcrição iniciada: ${res.count} clipe(s), ${res.horas} h. A busca fica fora do ar até terminar.`, "success");
            } else {
                alert(res.message);
            }

            // O progresso do worker chega pela tela de Tarefas (arquivo espelho)
            if (window.panelsManager && window.panelsManager.refreshTasks) {
                window.panelsManager.refreshTasks();
            }
        } catch (err) {
            // 409 = já existe um worker rodando; a mensagem do servidor explica o que fazer
            const msg = this.extrairMensagemErro(err);
            if (window.logManager) {
                window.logManager.log("ASR", `Falha ao iniciar o worker de transcrição: ${msg}`, "ERROR");
            }
            if (window.showToast) window.showToast(msg, "error");
            else alert("Erro ao iniciar a transcrição: " + msg);
        }
    }

    async triggerGenerateWaveforms() {
        const btn = document.getElementById("btn-generate-waveforms");
        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text">Iniciando...</span>`;
            }
            STATE.emit("statusChanged", { text: "Iniciando extração de waveforms para o projeto...", active: true });
            
            const res = await CapIAuAPI.generateProjectWaveforms(STATE.currentProjectId || 1);
            
            const msg = res.message || "Extração de waveforms em lote iniciada em background.";
            STATE.emit("statusChanged", { text: msg, active: true });
            if (window.showToast) window.showToast(msg, "info");

            // Abre a gaveta de Tarefas se disponível (padrão de tarefas em lote)
            if (typeof window.openTasksDrawerAndSwitchTab === "function") {
                window.openTasksDrawerAndSwitchTab();
            }

            // Pré-carrega na memória e redesenha a timeline
            const { WaveformManager } = await import("./waveformManager.js");
            const { TIMELINE_STATE } = await import("./timelineState.js");
            WaveformManager.preloadForClips(TIMELINE_STATE.cuts);
            if (window.timelineRenderer) window.timelineRenderer.requestRedraw();
        } catch (err) {
            console.error("[Waveforms] Erro ao disparar lote:", err);
            const msg = this.extrairMensagemErro(err);
            STATE.emit("statusChanged", { text: `Erro na geração de waveforms: ${msg}`, active: true });
            if (window.showToast) window.showToast(`Erro na geração de waveforms: ${msg}`, "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-chart-simple"></i> <span class="btn-text">Ondas</span>`;
            }
        }
    }

    async promptRelinkProjectMedia() {
        const searchDir = prompt("Informe a pasta para buscar e reconectar automaticamente os arquivos originais perdidos:", "D:\\makinof-monstro\\");
        if (!searchDir || !searchDir.trim()) return;

        try {
            STATE.emit("statusChanged", { text: "Buscando arquivos para relincar...", active: true });
            const res = await CapIAuAPI.relinkProject(STATE.currentProjectId || 1, searchDir.trim());
            const msg = `Relink concluído: ${res.total_relinked} mídia(s) reconectada(s) com sucesso.`;
            STATE.emit("statusChanged", { text: msg, active: true });
            if (window.showToast) window.showToast(msg, res.total_relinked > 0 ? "success" : "info");

            const { WaveformManager } = await import("./waveformManager.js");
            WaveformManager.clearCache();
            if (window.timelineRenderer) window.timelineRenderer.requestRedraw();
            if (window.libraryInstance) await window.libraryInstance.reloadData();
        } catch (err) {
            console.error("[Relink] Erro ao relincar:", err);
            const msg = this.extrairMensagemErro(err);
            if (window.showToast) window.showToast("Erro ao relincar mídias: " + msg, "error");
        }
    }

    // ── Triagem (E2.C2): limiar do filtro revisar:triagem e dropdowns de categoria ──

    async loadTriageReviewThreshold() {
        // Limiar usado por needsTriageReview() no searchParser (filtro revisar:triagem)
        try {
            const data = await CapIAuAPI.fetchResolvedSettings(STATE.currentProjectId || 1);
            const entry = data && data.values && data.values["triage.min_confidence"];
            if (entry && typeof entry.value === "number") {
                window.TRIAGE_REVIEW_THRESHOLD = entry.value;
            }
        } catch (e) {
            // Sem settings acessíveis, o filtro usa o default 0.55 espelhado no parser
        }
    }

    fillCategorySelect(selectEl, currentCategory) {
        if (!selectEl) return;
        selectEl.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "— sem categoria —";
        placeholder.disabled = true;
        selectEl.appendChild(placeholder);
        Object.entries(CATEGORY_LABELS).forEach(([value, label]) => {
            const opt = document.createElement("option");
            opt.value = value;
            opt.textContent = label;
            selectEl.appendChild(opt);
        });
        selectEl.value = currentCategory && CATEGORY_LABELS[currentCategory] ? currentCategory : "";
    }

    categoryConfidenceLabel(item) {
        if (!item || item.category == null || item.category_confidence == null) return "";
        if (item.category_confidence >= 1.0) return "confirmada por você";
        return `IA: ${Math.round(item.category_confidence * 100)}%`;
    }

    // Lightbox / Visualizador de Fotos
    openLightbox(photo) {
        if (!this.lightbox) return;
        this.currentLightboxPhoto = photo;
        this.lightbox.style.display = "flex";
        this.lightboxImg.src = photo.proxy_path ? photo.proxy_path : photo.filepath;
        if (this.photoMinimapImg) {
            this.photoMinimapImg.src = photo.proxy_path ? photo.proxy_path : photo.filepath;
        }
        this.lightboxTitle.textContent = photo.filename;
        this.lightboxDesc.textContent = photo.description || "Sem descrição gerada por IA.";
        
        if (this.lightboxCounter) {
            const list = STATE.currentPhotoList || [];
            const idx = STATE.currentPhotoIndex;
            this.lightboxCounter.textContent = `Foto ${idx + 1} de ${list.length}`;
        }
        
        // Render Tags
        this.lightboxTags.innerHTML = "";
        if (photo.tags && photo.tags.length > 0) {
            photo.tags.forEach(tag => {
                const tagEl = document.createElement("span");
                tagEl.className = "badge badge-gray";
                tagEl.textContent = tag;
                this.lightboxTags.appendChild(tagEl);
            });
        }
        
        // Categoria da triagem (E2.C2): dropdown de correção
        this.fillCategorySelect(document.getElementById("photo-viewer-category"), photo.category);
        const photoCatConf = document.getElementById("photo-viewer-category-conf");
        if (photoCatConf) photoCatConf.textContent = this.categoryConfidenceLabel(photo);

        // Carrega Rostos Rotulados
        this.loadLightboxFaces(photo.id);

        // Resetar Zoom para a nova foto
        this.resetZoom();
    }

    closeLightbox() {
        if (this.lightbox) this.lightbox.style.display = "none";
        this.resetZoom();
    }

    initPhotoZoomControls() {
        this.photoViewport = document.getElementById("photo-viewer-viewport");
        this.photoWrapper = document.getElementById("photo-viewer-wrapper");
        this.photoMinimap = document.getElementById("photo-viewer-minimap");
        this.photoMinimapImg = document.getElementById("photo-viewer-minimap-img");
        this.photoMinimapRect = document.getElementById("photo-viewer-minimap-rect");

        this.photoScale = 1.0;
        this.photoPanX = 0;
        this.photoPanY = 0;
        this.isSpacePressed = false;
        this.isPhotoPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panInitialX = 0;
        this.panInitialY = 0;

        // Roda do mouse no viewport para zoom focado no cursor (1.0x a 10.0x)
        if (this.photoViewport) {
            this.photoViewport.addEventListener("wheel", (e) => {
                if (!this.lightbox || this.lightbox.style.display === "none") return;
                e.preventDefault();
                
                const delta = -e.deltaY;
                const factor = delta > 0 ? 1.25 : 0.8;
                const targetScale = Math.min(10.0, Math.max(1.0, (this.photoScale || 1.0) * factor));
                
                if (targetScale <= 1.01) {
                    this.resetZoom();
                } else {
                    this.zoomAtPoint(targetScale, e.clientX, e.clientY, false);
                }
            }, { passive: false });

            // Iniciar Pan com Mouse Down
            this.photoViewport.addEventListener("mousedown", (e) => {
                if (!this.lightbox || this.lightbox.style.display === "none") return;
                if (e.target.closest("#photo-viewer-minimap")) return;

                const isLeftClick = e.button === 0;
                const isMiddleClick = e.button === 1;

                if (this.isSpacePressed || isMiddleClick || (this.photoScale > 1.05 && isLeftClick)) {
                    this.isPhotoPanning = true;
                    this.panStartX = e.clientX;
                    this.panStartY = e.clientY;
                    this.panInitialX = this.photoPanX;
                    this.panInitialY = this.photoPanY;
                    if (this.photoViewport) this.photoViewport.classList.add("is-panning");
                    e.preventDefault();
                }
            });
        }

        // Window Mouse Move & Mouse Up para Arrastar (Pan)
        window.addEventListener("mousemove", (e) => {
            if (!this.isPhotoPanning) return;
            const dx = e.clientX - this.panStartX;
            const dy = e.clientY - this.panStartY;
            this.photoPanX = this.panInitialX + dx;
            this.photoPanY = this.panInitialY + dy;
            this.updatePhotoTransform(false);
        });

        window.addEventListener("mouseup", () => {
            if (this.isPhotoPanning) {
                this.isPhotoPanning = false;
                if (this.photoViewport) this.photoViewport.classList.remove("is-panning");
            }
        });

        // Atalho de Teclado: Barra de Espaço para Modo Pan
        window.addEventListener("keydown", (e) => {
            if (!this.lightbox || this.lightbox.style.display === "none" || this.lightbox.style.display === "") return;
            if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
            
            if (e.code === "Space" && !this.isSpacePressed) {
                this.isSpacePressed = true;
                if (this.photoViewport) this.photoViewport.classList.add("space-mode");
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", (e) => {
            if (e.code === "Space") {
                this.isSpacePressed = false;
                this.isPhotoPanning = false;
                if (this.photoViewport) {
                    this.photoViewport.classList.remove("space-mode", "is-panning");
                }
            }
        });

        // Interação com o Minimapa / Miniatura
        if (this.photoMinimap) {
            const handleMinimapNav = (e) => {
                if (!this.lightboxImg || !this.photoMinimap) return;
                const mmRect = this.photoMinimap.getBoundingClientRect();
                const clickX = e.clientX - mmRect.left;
                const clickY = e.clientY - mmRect.top;

                const normX = Math.min(1, Math.max(0, clickX / mmRect.width));
                const normY = Math.min(1, Math.max(0, clickY / mmRect.height));

                const imgW = this.lightboxImg.offsetWidth;
                const imgH = this.lightboxImg.offsetHeight;

                const targetOffsetX = (normX - 0.5) * imgW;
                const targetOffsetY = (normY - 0.5) * imgH;

                this.photoPanX = -targetOffsetX * (this.photoScale || 1.0);
                this.photoPanY = -targetOffsetY * (this.photoScale || 1.0);
                this.updatePhotoTransform(false);
            };

            let isMinimapDrag = false;
            this.photoMinimap.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                e.preventDefault();
                isMinimapDrag = true;
                handleMinimapNav(e);
            });

            window.addEventListener("mousemove", (e) => {
                if (isMinimapDrag) {
                    handleMinimapNav(e);
                }
            });

            window.addEventListener("mouseup", () => {
                isMinimapDrag = false;
            });
        }
    }

    async analyzeCurrentPhoto() {
        const list = STATE.currentPhotoList;
        const currentIdx = STATE.currentPhotoIndex;
        if (!list || currentIdx === -1) return;
        const photo = list[currentIdx];
        if (!photo) return;
        
        if (!this.btnAnalyzePhoto) return;
        const originalHTML = this.btnAnalyzePhoto.innerHTML;
        
        try {
            this.btnAnalyzePhoto.disabled = true;
            this.btnAnalyzePhoto.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analisando...';
            
            const res = await CapIAuAPI.analyzePhotoVision(photo.id);
            if (res && res.status === "success" && res.photo) {
                list[currentIdx] = res.photo;
                this.openLightbox(res.photo);
                STATE.emit("photosUpdated", list);
                STATE.emit("statusChanged", { text: `Foto ${photo.filename} analisada com sucesso!`, active: false });
            } else {
                alert("Erro ao processar análise da foto.");
            }
        } catch (err) {
            alert("Erro ao iniciar análise: " + err.message);
        } finally {
            this.btnAnalyzePhoto.disabled = false;
            this.btnAnalyzePhoto.innerHTML = originalHTML;
        }
    }

    navigatePhoto(direction) {
        const list = STATE.currentPhotoList;
        const currentIdx = STATE.currentPhotoIndex;
        if (list.length === 0 || currentIdx === -1) return;
        
        let newIdx = currentIdx + direction;
        if (newIdx < 0) newIdx = list.length - 1;
        if (newIdx >= list.length) newIdx = 0;
        
        STATE.currentPhotoIndex = newIdx;
        this.resetZoom();
        this.openLightbox(list[newIdx]);
    }

    toggleZoom(e) {
        if (!this.lightboxImg) return;
        
        // Se o usuário estava arrastando a foto (pan), ignora o clique de toggle zoom
        if (this.panStartX && this.panStartY && e) {
            const dist = Math.hypot(e.clientX - this.panStartX, e.clientY - this.panStartY);
            if (dist > 5) return;
        }

        if (this.photoScale > 1.2) {
            this.resetZoom();
        } else {
            const targetScale = 4.0;
            const mouseX = e ? e.clientX : null;
            const mouseY = e ? e.clientY : null;
            this.zoomAtPoint(targetScale, mouseX, mouseY, true);
        }
    }

    resetZoom() {
        this.photoScale = 1.0;
        this.photoPanX = 0;
        this.photoPanY = 0;
        this.isPhotoZoomed = false;
        this.updatePhotoTransform(true);
        if (this.photoMinimap) this.photoMinimap.style.display = "none";
    }

    zoomAtPoint(targetScale, mouseX, mouseY, animate = true) {
        if (!this.photoViewport || !this.photoWrapper || !this.lightboxImg) return;
        
        const clampedScale = Math.min(10.0, Math.max(1.0, targetScale));
        const vpRect = this.photoViewport.getBoundingClientRect();

        const mX = (mouseX !== null && mouseX !== undefined) ? mouseX : (vpRect.left + vpRect.width / 2);
        const mY = (mouseY !== null && mouseY !== undefined) ? mouseY : (vpRect.top + vpRect.height / 2);

        // Offset do mouse em relação ao centro do viewport
        const relMouseX = mX - (vpRect.left + vpRect.width / 2);
        const relMouseY = mY - (vpRect.top + vpRect.height / 2);

        // Coordenadas da imagem sob o cursor antes da escala
        const pointInImageX = (relMouseX - (this.photoPanX || 0)) / (this.photoScale || 1.0);
        const pointInImageY = (relMouseY - (this.photoPanY || 0)) / (this.photoScale || 1.0);

        // Novo pan para manter a mesma coordenada sob o cursor
        let newPanX = relMouseX - pointInImageX * clampedScale;
        let newPanY = relMouseY - pointInImageY * clampedScale;

        if (clampedScale <= 1.01) {
            newPanX = 0;
            newPanY = 0;
        }

        this.photoScale = clampedScale;
        this.photoPanX = newPanX;
        this.photoPanY = newPanY;

        this.updatePhotoTransform(animate);
    }

    updatePhotoTransform(animate = false) {
        if (!this.photoWrapper) return;

        if (animate) {
            this.photoWrapper.style.transition = "transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)";
        } else {
            this.photoWrapper.style.transition = "none";
        }

        this.photoWrapper.style.transform = `translate3d(${this.photoPanX}px, ${this.photoPanY}px, 0px) scale(${this.photoScale})`;
        
        const isZoomed = this.photoScale > 1.05;
        this.isPhotoZoomed = isZoomed;

        if (this.lightboxImg) {
            this.lightboxImg.style.cursor = isZoomed ? "zoom-out" : "zoom-in";
        }

        if (this.btnZoomPhoto) {
            this.btnZoomPhoto.innerHTML = isZoomed ? '<i class="fa-solid fa-magnifying-glass-minus"></i>' : '<i class="fa-solid fa-magnifying-glass-plus"></i>';
        }

        if (this.photoMinimap) {
            if (isZoomed) {
                this.photoMinimap.style.display = "block";
                this.updateMinimap();
            } else {
                this.photoMinimap.style.display = "none";
            }
        }
    }

    updateMinimap() {
        if (!this.photoMinimap || !this.photoMinimapRect || !this.lightboxImg || !this.photoViewport) return;

        const imgW = this.lightboxImg.offsetWidth;
        const imgH = this.lightboxImg.offsetHeight;
        if (imgW === 0 || imgH === 0) return;

        const vpRect = this.photoViewport.getBoundingClientRect();
        const mmRect = this.photoMinimap.getBoundingClientRect();

        const scaledW = imgW * (this.photoScale || 1.0);
        const scaledH = imgH * (this.photoScale || 1.0);

        // Dimensões visíveis do viewport sobre a imagem ampliada
        const visW = Math.min(scaledW, vpRect.width);
        const visH = Math.min(scaledH, vpRect.height);

        // Fração visível
        const visFracW = visW / scaledW;
        const visFracH = visH / scaledH;

        // Renderização da miniatura (object-fit: contain)
        const imgAspect = imgW / imgH;
        const mmAspect = mmRect.width / mmRect.height;

        let mmImgW, mmImgH, mmImgX, mmImgY;
        if (imgAspect > mmAspect) {
            mmImgW = mmRect.width;
            mmImgH = mmRect.width / imgAspect;
            mmImgX = 0;
            mmImgY = (mmRect.height - mmImgH) / 2;
        } else {
            mmImgH = mmRect.height;
            mmImgW = mmRect.height * imgAspect;
            mmImgX = (mmRect.width - mmImgW) / 2;
            mmImgY = 0;
        }

        // Largura e altura do retângulo no minimapa
        const rectW = Math.max(8, Math.min(mmImgW, visFracW * mmImgW));
        const rectH = Math.max(8, Math.min(mmImgH, visFracH * mmImgH));

        // Posição do centro visível em coordenadas relativas da imagem (0 no centro)
        const centerX = -this.photoPanX / (this.photoScale || 1.0);
        const centerY = -this.photoPanY / (this.photoScale || 1.0);

        // Normalizado de 0 a 1 (onde 0.5 é o centro)
        const normCenterX = 0.5 + (centerX / imgW);
        const normCenterY = 0.5 + (centerY / imgH);

        let rectX = mmImgX + normCenterX * mmImgW - rectW / 2;
        let rectY = mmImgY + normCenterY * mmImgH - rectH / 2;

        // Clamping dentro dos limites da imagem no minimapa
        rectX = Math.max(mmImgX, Math.min(mmImgX + mmImgW - rectW, rectX));
        rectY = Math.max(mmImgY, Math.min(mmImgY + mmImgH - rectH, rectY));

        this.photoMinimapRect.style.left = `${rectX}px`;
        this.photoMinimapRect.style.top = `${rectY}px`;
        this.photoMinimapRect.style.width = `${rectW}px`;
        this.photoMinimapRect.style.height = `${rectH}px`;
    }

    async loadLightboxFaces(photoId) {
        if (!this.lightboxFaces) return;
        this.lightboxFaces.innerHTML = "";
        try {
            const faces = await CapIAuAPI.fetchPhotoFaces(photoId);
            faces.forEach(face => {
                const box = face.bounding_box;
                if (!box || box.length !== 4) return;
                
                const [x, y, w, h] = box;
                
                const faceDiv = document.createElement("div");
                faceDiv.className = "face-box";
                faceDiv.style.left = `${x * 100}%`;
                faceDiv.style.top = `${y * 100}%`;
                faceDiv.style.width = `${w * 100}%`;
                faceDiv.style.height = `${h * 100}%`;
                
                const label = face.name || "Quem é?";
                faceDiv.title = label;
                
                const nameTag = document.createElement("span");
                nameTag.className = "face-name-tag";
                nameTag.textContent = label;
                faceDiv.appendChild(nameTag);
                
                faceDiv.style.pointerEvents = "auto";
                faceDiv.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    
                    let speakers = [];
                    try {
                        speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId);
                    } catch (err) {
                        console.warn("Erro ao carregar speakers:", err);
                    }
                    
                    let promptMsg = "Digite o nome desta pessoa:\n";
                    if (speakers && speakers.length > 0) {
                        promptMsg += "\nFalantes/Pessoas existentes:\n" + speakers.join(", ") + "\n";
                    }
                    
                    const name = prompt(promptMsg, face.name || "");
                    if (name !== null) {
                        const trimmedName = name.trim();
                        const res = await CapIAuAPI.labelFace(face.id, trimmedName);
                        await FaceManager.handleLabelResponse(res, face.id, () => {
                            this.loadLightboxFaces(photoId);
                        });
                    }
                });
                
                this.lightboxFaces.appendChild(faceDiv);
            });
        } catch (e) {
            console.error("Erro ao carregar rostos do lightbox:", e);
        }
    }

    initInspectorListeners() {
        if (this.inspectorListenersInitialized) return;
        this.inspectorListenersInitialized = true;

        const btnBack = document.getElementById("btn-inspector-back");
        if (btnBack) btnBack.addEventListener("click", () => this.closeMediaInspector());

        const btnMarkIn = document.getElementById("btn-inspector-mark-in");
        if (btnMarkIn) btnMarkIn.addEventListener("click", () => this.markInspectorIn());

        const btnMarkOut = document.getElementById("btn-inspector-mark-out");
        if (btnMarkOut) btnMarkOut.addEventListener("click", () => this.markInspectorOut());

        const btnSetThumb = document.getElementById("btn-inspector-set-thumb");
        if (btnSetThumb) {
            btnSetThumb.addEventListener("click", (e) => {
                if (STATE.activeVideo) this.setInspectorThumbnail(STATE.activeVideo, e.currentTarget);
            });
        }

        const btnAppend = document.getElementById("btn-inspector-append");
        if (btnAppend) {
            btnAppend.addEventListener("click", () => {
                if (STATE.activeVideo) this.appendInspectorToTimeline(STATE.activeVideo);
            });
        }

        const btnCopyNotes = document.getElementById("btn-inspector-copy-notes");
        if (btnCopyNotes) {
            btnCopyNotes.addEventListener("click", () => {
                if (STATE.activeVideo) this.copyInspectorNotes(STATE.activeVideo);
            });
        }

        // Link Theme Submit
        const btnLinkTheme = document.getElementById("btn-inspector-link-theme-submit");
        if (btnLinkTheme) {
            btnLinkTheme.addEventListener("click", async () => {
                const video = STATE.activeVideo;
                if (!video) return;
                const themeSelect = document.getElementById("sel-inspector-link-theme");
                const startTimeInput = document.getElementById("num-inspector-link-start");
                const endTimeInput = document.getElementById("num-inspector-link-end");
                const excerptTextarea = document.getElementById("txt-inspector-link-excerpt");
                
                const themeId = parseInt(themeSelect.value);
                const start = parseFloat(startTimeInput.value) || 0;
                const end = parseFloat(endTimeInput.value) || 0;
                const excerpt = excerptTextarea.value || "";

                if (!themeId) {
                    alert("Por favor, selecione um tema.");
                    return;
                }
                if (start >= end) {
                    alert("O tempo de início deve ser menor que o tempo de fim.");
                    return;
                }

                try {
                    await CapIAuAPI.addThemeSegmentManual(themeId, STATE.currentProjectId, video.id, start, end, "", excerpt);
                    alert("Tema vinculado com sucesso!");
                    excerptTextarea.value = "";
                    this.loadInspectorThemes(video);
                } catch(e) {
                    alert("Erro ao vincular tema: " + e.message);
                }
            });
        }

        // AI trigger buttons
        const btnASR = document.getElementById("btn-inspector-ai-transcribe");
        if (btnASR) {
            btnASR.addEventListener("click", async () => {
                const video = STATE.activeVideo;
                if (!video) return;
                try {
                    await CapIAuAPI.transcribeVideo(video.id);
                    alert("Transcrição de áudio iniciada! Progresso na aba de tarefas.");
                } catch (e) {
                    alert("Erro ao iniciar transcrição: " + e.message);
                }
            });
        }

        const btnVision = document.getElementById("btn-inspector-ai-vision");
        if (btnVision) {
            btnVision.addEventListener("click", async () => {
                const video = STATE.activeVideo;
                if (!video) return;
                try {
                    await CapIAuAPI.analyzeVideoVision(video.id);
                    alert("Análise de visão iniciada! Progresso na aba de tarefas.");
                } catch (e) {
                    alert("Erro ao iniciar análise visual: " + e.message);
                }
            });
        }

        const btnInspectorSimilar = document.getElementById("btn-inspector-ai-similar");
        if (btnInspectorSimilar) {
            btnInspectorSimilar.addEventListener("click", () => {
                const video = STATE.activeVideo;
                if (!video) return;
                const player = document.getElementById("source-video");
                const ts = (player && isFinite(player.currentTime)) ? player.currentTime : 0.0;
                if (window.showSimilarMedia) window.showSimilarMedia("video", video.id, { timestamp: ts, label: video.filename });
            });
        }

        // Correção de categoria da triagem (E2.C2)
        const selInspectorCategory = document.getElementById("sel-inspector-category");
        if (selInspectorCategory) {
            selInspectorCategory.addEventListener("change", async () => {
                const video = STATE.activeVideo;
                const newCategory = selInspectorCategory.value;
                if (!video || !newCategory) return;
                try {
                    const res = await CapIAuAPI.updateVideoCategory(video.id, newCategory);
                    video.category = res.category;
                    video.category_confidence = 1.0;
                    video.video_type = res.video_type;
                    const catConfEl = document.getElementById("lbl-inspector-category-conf");
                    if (catConfEl) catConfEl.textContent = "confirmada por você";
                    STATE.emit("videosUpdated", STATE.allVideos);
                } catch (e) {
                    alert("Erro ao corrigir categoria: " + e.message);
                    selInspectorCategory.value = video.category || "";
                }
            });
        }

        const btnDetectFaces = document.getElementById("btn-inspector-ai-detect-faces");
        if (btnDetectFaces) {
            btnDetectFaces.addEventListener("click", async () => {
                const video = STATE.activeVideo;
                if (!video) return;
                try {
                    await CapIAuAPI.clusterFaces(STATE.currentProjectId);
                    alert("Agrupamento de rostos do projeto iniciado!");
                } catch (e) {
                    alert("Erro ao rodar agrupamento de rostos: " + e.message);
                }
            });
        }

        // Keyboard navigation I, O, E inside inspector
        document.addEventListener("keydown", (e) => {
            if (!this.mediaInspectorActive) return;
            if (window.isAnyModalOpen && window.isAnyModalOpen()) return;
            const activeTag = document.activeElement?.tagName?.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || activeTag === "select" || document.activeElement?.isContentEditable) {
                return;
            }
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const key = e.key.toLowerCase();
            if (key === 'i') {
                e.preventDefault();
                this.markInspectorIn();
            } else if (key === 'o') {
                e.preventDefault();
                this.markInspectorOut();
            } else if (key === 'e') {
                e.preventDefault();
                if (STATE.activeVideo) this.appendInspectorToTimeline(STATE.activeVideo);
            }
        });

        // Tab selection listeners
        const tabs = document.querySelectorAll("#inspector-tabs .tab-btn");
        tabs.forEach(btn => {
            btn.addEventListener("click", () => {
                tabs.forEach(t => t.classList.remove("active"));
                btn.classList.add("active");
                const target = btn.dataset.inspectorTab;
                document.querySelectorAll(".inspector-tab-page").forEach(page => {
                    page.style.display = page.id === target ? "flex" : "none";
                });
            });
        });
    }

    toggleMediaInspector(video) {
        if (!video) return;
        this.initInspectorListeners();

        if (this.mediaInspectorActive && STATE.activeVideo && STATE.activeVideo.id === video.id) {
            this.closeMediaInspector();
        } else {
            this.openMediaInspector(video);
        }
    }

    openMediaInspector(video) {
        this.mediaInspectorActive = true;
        
        const sidebarLeft = document.getElementById("sidebar-left");
        const sidebarRight = document.getElementById("sidebar-right");
        
        // Salva dimensões anteriores do estado normal
        this.preInspectorLeftWidth = sidebarLeft.style.width || "350px";
        this.preInspectorLeftFlex = sidebarLeft.style.flex || "0 0 350px";
        this.preInspectorRightCollapsed = sidebarRight ? sidebarRight.classList.contains("collapsed") : true;

        // Salva a aba ativa da biblioteca antes de trocar
        const activeTabBtn = document.querySelector(".sidebar-left .tab-btn.active");
        this.preInspectorActiveTab = activeTabBtn ? activeTabBtn.dataset.tab : "tab-media";

        // Salva estado do source player (maximizado ou não)
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");
        this.preInspectorSourceMaximized = sourcePanel ? sourcePanel.classList.contains("maximized") : false;
        this.preInspectorProgramMaximized = programPanel ? programPanel.classList.contains("maximized") : false;

        // Recolhe a barra direita
        if (sidebarRight && !sidebarRight.classList.contains("collapsed")) {
            const toggleRight = document.getElementById("toggle-right");
            if (toggleRight) toggleRight.click();
        }

        // Maximiza o source player se o program estiver visível (não maximizado)
        if (sourcePanel && !sourcePanel.classList.contains("maximized")) {
            const btnExpandSource = document.getElementById("btn-expand-source");
            if (btnExpandSource) btnExpandSource.click();
        }
        // Se o program estiver maximizado, troca para source maximizado
        if (programPanel && programPanel.classList.contains("maximized")) {
            const btnExpandProgram = document.getElementById("btn-expand-program");
            if (btnExpandProgram) btnExpandProgram.click();
            const btnExpandSource = document.getElementById("btn-expand-source");
            if (btnExpandSource && sourcePanel && !sourcePanel.classList.contains("maximized")) {
                btnExpandSource.click();
            }
        }

        // Recupera largura do inspetor salva ou usa 650px como padrão
        let inspectorWidth = 650;
        const savedInspectorWidth = localStorage.getItem("layout-dim-splitter-sidebar-left-inspector");
        if (savedInspectorWidth) {
            const parsed = parseInt(savedInspectorWidth);
            if (!isNaN(parsed)) inspectorWidth = parsed;
        }

        // Expande a esquerda
        sidebarLeft.style.width = `${inspectorWidth}px`;
        sidebarLeft.style.flex = `0 0 ${inspectorWidth}px`;

        // Alterna visualizações
        const mainView = document.getElementById("library-main-view");
        const inspectorView = document.getElementById("library-inspector-view");
        if (mainView) mainView.style.display = "none";
        if (inspectorView) inspectorView.style.display = "flex";

        window.dispatchEvent(new Event("resize"));

        // Carrega o Source Player com a mídia
        STATE.activeVideo = video;
        window.activeFocusedPlayer = "source";

        this.loadMediaInspector(video);
    }

    closeMediaInspector() {
        this.mediaInspectorActive = false;

        const sidebarLeft = document.getElementById("sidebar-left");
        const sidebarRight = document.getElementById("sidebar-right");

        // Restaura largura anterior da esquerda
        sidebarLeft.style.width = this.preInspectorLeftWidth || "350px";
        sidebarLeft.style.flex = this.preInspectorLeftFlex || "0 0 350px";

        // Restaura barra direita se necessário
        if (sidebarRight && !this.preInspectorRightCollapsed) {
            const reopenRight = document.getElementById("reopen-right");
            if (reopenRight && reopenRight.style.display !== "none") {
                reopenRight.click();
            }
        }

        // Restaura estado dos players
        const sourcePanel = document.getElementById("source-player-panel");
        const programPanel = document.getElementById("program-player-panel");

        // Se source estava maximizado pelo inspetor, desfaz
        if (sourcePanel && sourcePanel.classList.contains("maximized") && !this.preInspectorSourceMaximized) {
            const btnExpandSource = document.getElementById("btn-expand-source");
            if (btnExpandSource) btnExpandSource.click();
        }
        // Se program estava maximizado antes, restaura
        if (this.preInspectorProgramMaximized && programPanel && !programPanel.classList.contains("maximized")) {
            const btnExpandProgram = document.getElementById("btn-expand-program");
            if (btnExpandProgram) btnExpandProgram.click();
        }

        // Alterna visualizações de volta
        const mainView = document.getElementById("library-main-view");
        const inspectorView = document.getElementById("library-inspector-view");
        if (mainView) mainView.style.display = "flex";
        if (inspectorView) inspectorView.style.display = "none";

        const targetDoc = (window.popoutWindows?.["sidebar-left"]?.document && !window.popoutWindows["sidebar-left"].closed)
            ? window.popoutWindows["sidebar-left"].document
            : (this.activeDoc || document);

        // Restaura a aba ativa que o usuário tinha antes de abrir o inspetor
        if (this.preInspectorActiveTab) {
            const tabBtn = targetDoc.querySelector(`.sidebar-left .tab-btn[data-tab="${this.preInspectorActiveTab}"]`);
            if (tabBtn) tabBtn.click();
        }

        // Faz scroll até o card do vídeo ativo na biblioteca
        if (STATE.activeVideo) {
            requestAnimationFrame(() => {
                const activeCard = targetDoc.querySelector(`.media-card.tree-file-item[data-video-id="${STATE.activeVideo.id}"]`);
                if (activeCard) {
                    activeCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
                }
            });
        }

        window.dispatchEvent(new Event("resize"));
    }

    markInspectorIn() {
        const sourceVideo = document.getElementById("source-video");
        if (!sourceVideo) return;
        this.inspectorMarkerIn = sourceVideo.currentTime;
        this.updateInspectorMarkersUI();

        // Atualiza campos de tempo de tema se existirem
        const linkStart = document.getElementById("num-inspector-link-start");
        if (linkStart) linkStart.value = this.inspectorMarkerIn.toFixed(1);
    }

    markInspectorOut() {
        const sourceVideo = document.getElementById("source-video");
        if (!sourceVideo) return;
        this.inspectorMarkerOut = sourceVideo.currentTime;
        this.updateInspectorMarkersUI();

        // Atualiza campos de tempo de tema se existirem
        const linkEnd = document.getElementById("num-inspector-link-end");
        if (linkEnd) linkEnd.value = this.inspectorMarkerOut.toFixed(1);
    }

    updateInspectorMarkersUI() {
        const lblIn = document.getElementById("lbl-inspector-in");
        const lblOut = document.getElementById("lbl-inspector-out");
        if (lblIn) {
            lblIn.textContent = this.inspectorMarkerIn !== undefined && this.inspectorMarkerIn !== null 
                ? formatTimecode(this.inspectorMarkerIn).substring(3, 11) 
                : "00:00:00";
        }
        if (lblOut) {
            lblOut.textContent = this.inspectorMarkerOut !== undefined && this.inspectorMarkerOut !== null 
                ? formatTimecode(this.inspectorMarkerOut).substring(3, 11) 
                : "00:00:00";
        }
    }

    appendInspectorToTimeline(video) {
        if (!video) return;
        const sourceVideo = document.getElementById("source-video");
        const inTime = this.inspectorMarkerIn !== undefined && this.inspectorMarkerIn !== null ? this.inspectorMarkerIn : 0.0;
        const outTime = this.inspectorMarkerOut !== undefined && this.inspectorMarkerOut !== null ? this.inspectorMarkerOut : (sourceVideo ? sourceVideo.duration : 0.0);
        
        if (inTime >= outTime) {
            alert("Ponto In deve ser menor que o ponto Out.");
            return;
        }
        
        if (window.TIMELINE_STATE) {
            window.TIMELINE_STATE.addCut(video.id, inTime, outTime, null);
            alert("Sub-clipe adicionado à timeline!");
        } else {
            console.error("TIMELINE_STATE não encontrado.");
        }
        
        this.inspectorMarkerIn = null;
        this.inspectorMarkerOut = null;
        this.updateInspectorMarkersUI();
    }

    async setInspectorThumbnail(video, triggerBtn = null) {
        if (!video) return;
        const sourceVideo = document.getElementById("source-video");
        if (!sourceVideo) return;
        
        const timestamp = sourceVideo.currentTime;
        await window.setVideoThumbnail(video.id, timestamp, triggerBtn);
    }

    copyInspectorNotes(video) {
        if (!video) return;
        
        let markdown = `# Notas de Decupagem: ${video.filename}\n\n`;
        markdown += `**Título**: ${getFriendlyTitle(video)}\n`;
        markdown += `**Duração**: ${video.duration ? formatTimecode(video.duration) : "00:00:00"}\n\n`;
        
        markdown += `## Resumo Executivo\n`;
        markdown += `${video.summary || video.description || "Nenhum resumo disponível."}\n\n`;
        
        if (this.inspectorDialogueList && this.inspectorDialogueList.length > 0) {
            markdown += `## Índice de Tempos e Falas\n`;
            let currentSpeaker = null;
            let lastChapterTime = -100;
            this.inspectorDialogueList.forEach(d => {
                const timeDiff = d.start_time - lastChapterTime;
                if (d.speaker_id !== currentSpeaker || timeDiff > 40) {
                    currentSpeaker = d.speaker_id;
                    lastChapterTime = d.start_time;
                    const tc = formatTimecode(d.start_time).substring(3, 11);
                    markdown += `* **[${tc}]** *${d.speaker_id}*: "${d.text}"\n`;
                }
            });
        }
        
        navigator.clipboard.writeText(markdown)
            .then(() => alert("Notas de decupagem copiadas para a área de transferência!"))
            .catch(err => alert("Erro ao copiar notas: " + err));
    }

    async loadMediaInspector(video) {
        const titleIconEl = document.getElementById("inspector-media-title-icon");
        const titleTextEl = document.getElementById("inspector-media-title-text");
        const btnEditTitle = document.getElementById("btn-inspector-edit-title");
        const statusBadge = document.getElementById("inspector-media-status-badge");
        const summaryEl = document.getElementById("inspector-summary");
        
        if (titleIconEl) {
            titleIconEl.className = `fa-solid ${video.video_type === 'interview' ? 'fa-microphone-lines' : 'fa-film'}`;
        }
        if (titleTextEl) {
            titleTextEl.textContent = getFriendlyTitle(video);
            titleTextEl.title = getFriendlyTitle(video);
        }
        
        if (btnEditTitle) {
            btnEditTitle.onclick = (e) => {
                e.stopPropagation();
                if (!titleTextEl) return;
                if (titleTextEl.querySelector("input")) return;
                
                const currentVal = video.title || getFriendlyTitle(video) || video.filename || "";
                const input = document.createElement("input");
                input.type = "text";
                input.className = "inline-inspector-title-input";
                input.value = currentVal;
                input.style.cssText = "width: 100%; max-width: 280px; background: rgba(0,0,0,0.85); color: #fff; border: 1px solid var(--color-cyan); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-family: inherit; outline: none; box-shadow: 0 0 10px rgba(6,182,212,0.4);";
                
                titleTextEl.innerHTML = "";
                titleTextEl.appendChild(input);
                input.focus();
                input.select();
                
                let saved = false;
                const commit = async () => {
                    if (saved) return;
                    saved = true;
                    const newTitle = input.value.trim();
                    if (newTitle && newTitle !== currentVal) {
                        try {
                            await CapIAuAPI.updateVideoTitle(video.id, newTitle);
                            video.title = newTitle;
                            titleTextEl.textContent = newTitle;
                            titleTextEl.title = newTitle;
                            
                            // Atualiza os cards da biblioteca no DOM (em todas as janelas)
                            getAllLibraryDocuments().forEach(targetDoc => {
                                const cardTitle = targetDoc.querySelector(`.media-card[data-video-id="${video.id}"] .clip-title-text`);
                                if (cardTitle) cardTitle.textContent = newTitle;
                                
                                // Atualiza tooltip no card
                                const cardH4 = targetDoc.querySelector(`.media-card[data-video-id="${video.id}"] h4`);
                                if (cardH4) {
                                    const newTooltip = buildMediaTooltip(video, "video", false);
                                    cardH4.setAttribute("data-tooltip", newTooltip);
                                }
                            });
                            
                            if (typeof window.showToast === "function") {
                                window.showToast("Título atualizado com sucesso!", "success");
                            }
                        } catch (err) {
                            console.error("Erro ao salvar título:", err);
                            titleTextEl.textContent = currentVal;
                            alert("Erro ao salvar título: " + err.message);
                        }
                    } else {
                        titleTextEl.textContent = currentVal;
                    }
                };
                
                input.addEventListener("keydown", (eKey) => {
                    if (eKey.key === "Enter") {
                        eKey.preventDefault();
                        commit();
                    } else if (eKey.key === "Escape") {
                        saved = true;
                        titleTextEl.textContent = currentVal;
                    }
                });
                
                input.addEventListener("blur", () => {
                    commit();
                });
            };
        }
        
        if (statusBadge) {
            statusBadge.textContent = video.status || "Pendente";
            statusBadge.style.color = video.status === "analyzed" ? "var(--color-emerald)" : "var(--text-secondary)";
        }
        if (summaryEl) {
            summaryEl.textContent = video.summary || video.description || "Nenhum resumo ou metadado gerado para esta mídia.";
        }

        const warnBox = document.getElementById("inspector-warning-box");
        const warnText = document.getElementById("inspector-warning-text");
        if (warnBox && warnText) {
            if (video.error_message) {
                warnText.textContent = video.error_message;
                warnBox.style.display = "flex";
            } else {
                warnBox.style.display = "none";
            }
        }

        const btnMarkFailed = document.getElementById("btn-inspector-mark-failed");
        const btnMarkAnalyzed = document.getElementById("btn-inspector-mark-analyzed");
        
        if (btnMarkFailed) {
            btnMarkFailed.onclick = async () => {
                try {
                    await CapIAuAPI.overrideVideoStatus(video.id, "error");
                    video.status = "error";
                    video.error_message = "Marcado manualmente como falha visual pelo usuário.";
                    alert(`Mídia "${getFriendlyTitle(video)}" sinalizada como falha visual para reanálise.`);
                    if (window.libraryInstance) {
                        await window.libraryInstance.reloadData();
                    }
                    this.loadMediaInspector(video);
                } catch (e) {
                    alert("Erro ao alterar status: " + e.message);
                }
            };
        }

        if (btnMarkAnalyzed) {
            btnMarkAnalyzed.onclick = async () => {
                try {
                    await CapIAuAPI.overrideVideoStatus(video.id, "analyzed");
                    video.status = "analyzed";
                    video.error_message = null;
                    alert(`Mídia "${getFriendlyTitle(video)}" marcada como analisada (falha ignorada).`);
                    if (window.libraryInstance) {
                        await window.libraryInstance.reloadData();
                    }
                    this.loadMediaInspector(video);
                } catch (e) {
                    alert("Erro ao alterar status: " + e.message);
                }
            };
        }

        // Categoria da triagem (E2.C2): dropdown de correção
        this.fillCategorySelect(document.getElementById("sel-inspector-category"), video.category);
        const catConfEl = document.getElementById("lbl-inspector-category-conf");
        if (catConfEl) catConfEl.textContent = this.categoryConfidenceLabel(video);

        // Histórico de decupagem: o link só aparece quando existe versão anterior guardada
        const btnMetaHistory = document.getElementById("btn-inspector-metadata-history");
        if (btnMetaHistory) {
            btnMetaHistory.style.display = "none";
            btnMetaHistory.dataset.videoId = String(video.id);
            btnMetaHistory.onclick = () => this.openMetadataHistory(video);
            CapIAuAPI.fetchVideoMetadataHistory(video.id)
                .then(data => {
                    // O inspetor pode já ter trocado de mídia enquanto a resposta vinha
                    if (btnMetaHistory.dataset.videoId !== String(video.id)) return;
                    const total = (data.versions || []).length;
                    if (total === 0) return;
                    const lbl = document.getElementById("lbl-inspector-metadata-history");
                    if (lbl) lbl.textContent = total === 1 ? "ver 1 versão anterior" : `ver ${total} versões anteriores`;
                    btnMetaHistory.style.display = "inline-flex";
                })
                .catch(err => console.warn("Histórico de decupagem indisponível:", err));
        }

        this.inspectorMarkerIn = null;
        this.inspectorMarkerOut = null;
        this.updateInspectorMarkersUI();

        // Limpa campos de temas do form
        const linkStart = document.getElementById("num-inspector-link-start");
        const linkEnd = document.getElementById("num-inspector-link-end");
        if (linkStart) linkStart.value = "0";
        if (linkEnd) linkEnd.value = video.duration ? video.duration.toFixed(1) : "0";

        this.inspectorDialogueList = [];
        this.loadInspectorDialogue(video);
        this.loadInspectorThemes(video);
        this.loadInspectorFaces(video);
    }

    /** Data do SQLite (CURRENT_TIMESTAMP, em UTC) formatada no fuso do usuário. */
    formatarDataHistorico(raw) {
        if (!raw) return "data desconhecida";
        const d = new Date(String(raw).replace(" ", "T") + (String(raw).endsWith("Z") ? "" : "Z"));
        if (isNaN(d.getTime())) return String(raw);
        return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    }

    /** Monta um cartão de versão. `versao` nula = a decupagem que está no ar agora. */
    buildMetadataVersionCard(dados, { atual, video, onRestore }) {
        const card = document.createElement("div");
        card.style.cssText = "border: 1px solid " + (atual ? "rgba(6,182,212,0.45)" : "var(--border-glass)") +
            "; border-radius: 8px; padding: 10px 12px; background: rgba(255,255,255,0.02); display: flex; flex-direction: column; gap: 6px;";

        const header = document.createElement("div");
        header.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";

        const selo = document.createElement("span");
        selo.style.cssText = "font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 4px; " +
            (atual ? "color: var(--color-cyan); background: rgba(6,182,212,0.12);"
                   : "color: var(--text-muted); background: rgba(255,255,255,0.05);");
        selo.textContent = atual ? "no ar agora" : this.formatarDataHistorico(dados.created_at);
        header.appendChild(selo);

        const origem = document.createElement("span");
        const humano = dados.origem === "humano";
        origem.style.cssText = "font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; " +
            (humano ? "color: var(--color-emerald); background: rgba(16,185,129,0.12);"
                    : "color: var(--color-violet); background: rgba(138,92,246,0.12);");
        origem.textContent = humano ? "escrito à mão" : (dados.origem === "importado" ? "importado" : "gerado por IA");
        header.appendChild(origem);
        card.appendChild(header);

        const linha = (rotulo, valor, negrito) => {
            if (!valor) return;
            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; flex-direction: column; gap: 2px;";
            const lbl = document.createElement("div");
            lbl.style.cssText = "font-size: 9px; font-weight: 700; color: var(--color-cyan); text-transform: uppercase; letter-spacing: 0.5px;";
            lbl.textContent = rotulo;
            const txt = document.createElement("div");
            txt.style.cssText = "font-size: 11px; line-height: 1.45; white-space: pre-line; color: " +
                (negrito ? "var(--text-primary); font-weight: 600;" : "var(--text-secondary);");
            txt.textContent = valor;
            wrap.appendChild(lbl);
            wrap.appendChild(txt);
            card.appendChild(wrap);
        };

        linha("Título", dados.title, true);
        linha("Descrição", dados.description);
        linha("Resumo", dados.summary);

        const tags = Array.isArray(dados.tags) ? dados.tags : [];
        if (tags.length > 0) linha("Tags", tags.join(" · "));

        if (!dados.title && !dados.description && !dados.summary && tags.length === 0) {
            linha("Conteúdo", "(versão vazia)");
        }

        if (!atual && typeof onRestore === "function") {
            const btn = document.createElement("button");
            btn.className = "btn-secondary";
            btn.style.cssText = "align-self: flex-start; margin-top: 4px; height: 26px; padding: 0 12px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 4px; border: 1px solid var(--border-glass); background: rgba(255,255,255,0.03); color: var(--text-primary); display: flex; align-items: center; gap: 6px;";
            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restaurar esta versão';
            btn.onclick = () => onRestore(dados, btn);
            card.appendChild(btn);
        }

        return card;
    }

    /** Abre o modal com as versões anteriores da decupagem editorial. */
    async openMetadataHistory(video) {
        const modal = document.getElementById("metadata-history-modal");
        const list = document.getElementById("metadata-history-list");
        if (!modal || !list) return;

        if (!this._metadataHistoryBound) {
            this._metadataHistoryBound = true;
            const fechar = () => this.closeMetadataHistory();
            const btnX = document.getElementById("btn-close-metadata-history");
            const btnCancel = document.getElementById("btn-cancel-metadata-history");
            if (btnX) btnX.addEventListener("click", fechar);
            if (btnCancel) btnCancel.addEventListener("click", fechar);
            modal.addEventListener("click", (ev) => { if (ev.target === modal) fechar(); });
        }

        list.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando versões...</div>`;
        modal.classList.add("active");

        let data;
        try {
            data = await CapIAuAPI.fetchVideoMetadataHistory(video.id);
        } catch (err) {
            list.innerHTML = "";
            const erro = document.createElement("div");
            erro.style.cssText = "font-size:11px; color:var(--color-rose);";
            erro.textContent = "Erro ao carregar o histórico: " + err.message;
            list.appendChild(erro);
            return;
        }

        const restaurar = async (versao, btn) => {
            const quando = this.formatarDataHistorico(versao.created_at);
            if (!confirm(`Restaurar a versão de ${quando}?\n\nA decupagem que está no ar agora vai para o histórico, então dá para voltar atrás.`)) return;
            btn.disabled = true;
            btn.style.opacity = "0.5";
            try {
                const res = await CapIAuAPI.restoreVideoMetadataVersion(video.id, versao.id);
                if (res && res.video) {
                    video.title = res.video.title;
                    video.description = res.video.description;
                    video.summary = res.video.summary;
                    video.tags = res.video.tags;
                }
                if (window.logManager) {
                    window.logManager.log("Decupagem", `Versão de ${quando} restaurada na mídia ${video.id}.`, "ACTION");
                }
                if (window.showToast) window.showToast("Versão restaurada.", "success");
                if (window.libraryInstance) await window.libraryInstance.reloadData();
                this.loadMediaInspector(video);
                await this.openMetadataHistory(video);
            } catch (err) {
                btn.disabled = false;
                btn.style.opacity = "1";
                if (window.showToast) window.showToast("Erro ao restaurar: " + err.message, "error");
                else alert("Erro ao restaurar: " + err.message);
            }
        };

        list.innerHTML = "";
        if (data.atual) {
            list.appendChild(this.buildMetadataVersionCard(data.atual, { atual: true, video }));
        }

        const versoes = data.versions || [];
        if (versoes.length === 0) {
            const vazio = document.createElement("div");
            vazio.style.cssText = "font-size: 11px; color: var(--text-muted); font-style: italic;";
            vazio.textContent = "Nenhuma versão anterior guardada ainda. A partir de agora, todo reprocessamento arquiva a decupagem que for substituída.";
            list.appendChild(vazio);
            return;
        }

        versoes.forEach(v => {
            list.appendChild(this.buildMetadataVersionCard(v, { atual: false, video, onRestore: restaurar }));
        });
    }

    closeMetadataHistory() {
        const modal = document.getElementById("metadata-history-modal");
        if (modal) modal.classList.remove("active");
    }

    async loadInspectorDialogue(video) {
        const chaptersList = document.getElementById("inspector-chapters-list");
        const editorContainer = document.getElementById("inspector-transcript-editor");
        
        if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando índice...</div>`;
        if (editorContainer) editorContainer.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando diálogos...</div>`;

        try {
            const data = await CapIAuAPI.fetchTranscript(video.id);
            const dialogues = data.dialogues || [];
            this.inspectorDialogueList = dialogues;

            // Render Índice
            if (chaptersList) {
                chaptersList.innerHTML = "";
                if (dialogues.length === 0) {
                    chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Sem transcrição disponível para gerar índice.</div>`;
                } else {
                    let currentSpeaker = null;
                    let lastChapterTime = -100;
                    dialogues.forEach(d => {
                        const timeDiff = d.start_time - lastChapterTime;
                        if (d.speaker_id !== currentSpeaker || timeDiff > 40) {
                            currentSpeaker = d.speaker_id;
                            lastChapterTime = d.start_time;
                            
                            const item = document.createElement("div");
                            item.className = "timeline-chapter-item";
                            
                            const timecode = formatTimecode(d.start_time).substring(3, 11);
                            item.innerHTML = `
                                <span class="timeline-chapter-time" data-time="${d.start_time}">${timecode}</span>
                                <div style="font-weight: 700; font-size: 11px; color: var(--color-cyan); margin-bottom: 2px;">${d.speaker_id}</div>
                                <div class="timeline-chapter-text">"${d.text.substring(0, 80)}${d.text.length > 80 ? '...' : ''}"</div>
                            `;
                            
                            item.querySelector(".timeline-chapter-time").addEventListener("click", () => {
                                window.player.sourcePlayer.seek(d.start_time);
                            });
                            
                            chaptersList.appendChild(item);
                        }
                    });
                }
            }

            // Render Editor de Transcrição
            if (editorContainer) {
                editorContainer.innerHTML = "";
                if (dialogues.length === 0) {
                    editorContainer.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Sem falas disponíveis para edição.</div>`;
                } else {
                    // Carrega todos os falantes conhecidos do projeto para o dropdown
                    const speakersList = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId).catch(() => []);
                    
                    dialogues.forEach((d, index) => {
                        const block = document.createElement("div");
                        block.className = "inspector-dialogue-block";
                        
                        const timecode = formatTimecode(d.start_time).substring(3, 11);
                        
                        // Dropdown de falantes
                        let optionsHtml = `<option value="${d.speaker_id}" selected>${d.speaker_id}</option>`;
                        speakersList.forEach(s => {
                            if (s !== d.speaker_id) {
                                optionsHtml += `<option value="${s}">${s}</option>`;
                            }
                        });
                        optionsHtml += `<option value="_new_">+ Criar Novo Falante...</option>`;

                        block.innerHTML = `
                            <div class="inspector-dialogue-header">
                                <div class="inspector-dialogue-speaker">
                                    <i class="fa-solid fa-user" style="color:var(--color-cyan); font-size: 9px;"></i>
                                    <select class="nle-select sel-dialogue-speaker" style="padding: 2px 6px; font-size: 10px; width: 120px;">
                                        ${optionsHtml}
                                    </select>
                                    <input type="text" class="input-new-speaker" placeholder="Nome do falante..." style="display:none; width:100px; padding: 2px 4px; font-size: 10px;">
                                </div>
                                <span class="inspector-dialogue-time" data-time="${d.start_time}">${timecode}</span>
                            </div>
                            <textarea class="inspector-dialogue-text-area txt-dialogue-text">${d.text}</textarea>
                            <div class="inspector-dialogue-actions">
                                <button class="btn-flat-action cyan btn-dialogue-split" style="font-size: 9px;" title="Dividir fala neste ponto"><i class="fa-solid fa-scissors"></i> Dividir</button>
                                <button class="btn-primary btn-dialogue-save" style="font-size: 9px; padding: 2px 8px; border-radius: 4px; border:none; background:rgba(6,182,212,0.15); color:var(--color-cyan); font-weight:bold; cursor:pointer;"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
                            </div>
                        `;

                        // Lógica de Novo Falante
                        const speakerSelect = block.querySelector(".sel-dialogue-speaker");
                        const newSpeakerInput = block.querySelector(".input-new-speaker");
                        speakerSelect.addEventListener("change", () => {
                            if (speakerSelect.value === "_new_") {
                                speakerSelect.style.display = "none";
                                newSpeakerInput.style.display = "block";
                                newSpeakerInput.focus();
                            }
                        });
                        newSpeakerInput.addEventListener("blur", () => {
                            if (!newSpeakerInput.value.trim()) {
                                speakerSelect.style.display = "block";
                                speakerSelect.value = d.speaker_id;
                                newSpeakerInput.style.display = "none";
                            }
                        });

                        // Sincronização de clique do tempo
                        block.querySelector(".inspector-dialogue-time").addEventListener("click", () => {
                            window.player.sourcePlayer.seek(d.start_time);
                        });

                        // Botão de Dividir Fala (Split)
                        block.querySelector(".btn-dialogue-split").addEventListener("click", async () => {
                            const sourceVideo = document.getElementById("source-video");
                            const currentTime = sourceVideo ? sourceVideo.currentTime : d.start_time;
                            if (currentTime < d.start_time || currentTime > d.end_time) {
                                alert("Navegue o Source Player para a posição de tempo contida dentro desta fala para dividi-la!");
                                return;
                            }
                            const newSpk = prompt("Digite o nome/ID do novo falante a partir deste ponto:", d.speaker_id + "_2");
                            if (newSpk && newSpk.trim()) {
                                try {
                                    await CapIAuAPI.splitTranscript(video.id, currentTime, newSpk.trim());
                                    alert("Fala dividida com sucesso!");
                                    this.loadInspectorDialogue(video);
                                } catch(e) {
                                    alert("Erro ao dividir fala: " + e.message);
                                }
                            }
                        });

                        // Botão de Salvar
                        block.querySelector(".btn-dialogue-save").addEventListener("click", async () => {
                            let selectedSpeaker = speakerSelect.style.display === "none" ? newSpeakerInput.value.trim() : speakerSelect.value;
                            if (!selectedSpeaker) {
                                alert("O falante não pode ser vazio.");
                                return;
                            }
                            const txtVal = block.querySelector(".txt-dialogue-text").value.trim();
                            try {
                                // 1. Primeiro renomeia o falante se necessário
                                if (selectedSpeaker !== d.speaker_id) {
                                    await CapIAuAPI.renameSpeaker(video.id, d.speaker_id, selectedSpeaker, false, d.start_time, d.end_time);
                                }
                                // 2. Edita o texto do diálogo
                                await CapIAuAPI.editDialogueSegment(video.id, d.start_time, d.end_time, txtVal, selectedSpeaker);
                                alert("Fala atualizada com sucesso!");
                                this.loadInspectorDialogue(video);
                            } catch(e) {
                                alert("Erro ao salvar fala: " + e.message);
                            }
                        });

                        editorContainer.appendChild(block);
                    });

                    // Input de filtro de falas
                    const searchInput = document.getElementById("inspector-transcript-search");
                    const searchCount = document.getElementById("inspector-search-count");
                    if (searchInput) {
                        searchInput.value = "";
                        if (searchCount) searchCount.textContent = "";

                        const newSearch = searchInput.cloneNode(true);
                        searchInput.parentNode.replaceChild(newSearch, searchInput);

                        newSearch.addEventListener("input", () => {
                            const query = newSearch.value.toLowerCase().trim();
                            const blocks = editorContainer.querySelectorAll(".inspector-dialogue-block");
                            let matchesCount = 0;
                            
                            blocks.forEach(b => {
                                const text = b.querySelector(".txt-dialogue-text").value.toLowerCase();
                                const speaker = b.querySelector(".sel-dialogue-speaker").value.toLowerCase();
                                const match = !query || text.includes(query) || speaker.includes(query);
                                b.style.display = match ? "flex" : "none";
                                if (match && query) {
                                    matchesCount++;
                                }
                            });
                            
                            const countEl = document.getElementById("inspector-search-count");
                            if (countEl) {
                                countEl.textContent = query ? `${matchesCount} encontrados` : "";
                            }
                        });
                    }
                }
            }

        } catch(e) {
            console.warn("Sem transcrição disponível:", e);
            if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Mídia de B-roll sem índice. Carregando frames de visão...</div>`;
            if (editorContainer) editorContainer.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Falas não disponíveis.</div>`;

            // Se for broll, carrega descrições de visão
            if (video.video_type === "broll" || video.status === "analyzed") {
                try {
                    const data = await CapIAuAPI.fetchVideoVision(video.id, STATE.currentProjectId);
                    const frames = data.frames || [];
                    if (chaptersList) {
                        chaptersList.innerHTML = "";
                        if (frames.length === 0) {
                            chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Nenhuma descrição visual disponível.</div>`;
                        } else {
                            frames.forEach(f => {
                                const item = document.createElement("div");
                                item.className = "timeline-chapter-item";
                                const timecode = formatTimecode(f.timestamp).substring(3, 11);
                                item.innerHTML = `
                                    <span class="timeline-chapter-time" data-time="${f.timestamp}">${timecode}</span>
                                    <div class="timeline-chapter-text">${f.description || "Descrição de cena"}</div>
                                `;
                                item.querySelector(".timeline-chapter-time").addEventListener("click", () => {
                                    window.player.sourcePlayer.seek(f.timestamp);
                                });
                                chaptersList.appendChild(item);
                            });
                        }
                    }
                } catch(err) {
                    if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Sem frames de visão processados.</div>`;
                }
            }
        }
    }

    async loadInspectorThemes(video) {
        const themesList = document.getElementById("inspector-themes-list");
        const themeSelect = document.getElementById("sel-inspector-link-theme");

        if (themesList) themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando temas...</div>`;
        if (themeSelect) themeSelect.innerHTML = `<option value="">Carregando...</option>`;

        try {
            const themesData = await CapIAuAPI.fetchThemes(STATE.currentProjectId);
            const themes = themesData.themes || [];
            
            // Popula dropdown select
            if (themeSelect) {
                themeSelect.innerHTML = `<option value="">-- Selecione o Tema Narrativo --</option>`;
                themes.forEach(t => {
                    const opt = document.createElement("option");
                    opt.value = t.id;
                    opt.textContent = t.title;
                    themeSelect.appendChild(opt);
                });
            }

            if (themesList) {
                themesList.innerHTML = "";
                let hasThemes = false;

                for (const theme of themes) {
                    const segsData = await CapIAuAPI.fetchThemeSegments(theme.id);
                    const segments = segsData.segments || [];
                    const matchingSegs = segments.filter(s => s.video_id === video.id);

                    if (matchingSegs.length > 0) {
                        hasThemes = true;
                        
                        matchingSegs.forEach(seg => {
                            const card = document.createElement("div");
                            card.className = "inspector-theme-card";
                            
                            const timecodeStart = formatTimecode(seg.start_time || 0).substring(3, 11);
                            const timecodeEnd = formatTimecode(seg.end_time || 0).substring(3, 11);
                            
                            card.innerHTML = `
                                <div class="inspector-theme-title">${theme.title}</div>
                                <div class="inspector-theme-desc" style="font-size: 9px; color: var(--text-muted);">Intervalo: ${timecodeStart} - ${timecodeEnd}</div>
                                ${seg.text_excerpt ? `<div class="inspector-theme-excerpt">"${seg.text_excerpt}"</div>` : ''}
                                <button class="inspector-theme-delete-btn" data-segment-id="${seg.id}" title="Desvincular tema"><i class="fa-solid fa-trash-can"></i></button>
                            `;

                            // Delete segment link
                            card.querySelector(".inspector-theme-delete-btn").addEventListener("click", async (e) => {
                                e.stopPropagation();
                                if (confirm(`Deseja desvincular o tema "${theme.title}" deste segmento?`)) {
                                    try {
                                        await CapIAuAPI.deleteThemeSegment(seg.id);
                                        alert("Tema desvinculado com sucesso!");
                                        this.loadInspectorThemes(video);
                                    } catch(err) {
                                        alert("Erro ao desvincular tema: " + err.message);
                                    }
                                }
                            });

                            themesList.appendChild(card);
                        });
                    }
                }

                if (!hasThemes) {
                    themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Nenhum tema narrativo vinculado a este vídeo. Utilize o formulário acima para vincular.</div>`;
                }
            }

        } catch (e) {
            console.warn("Erro ao carregar temas:", e);
            if (themesList) themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Falha ao carregar temas narrativos.</div>`;
        }
    }

    async loadInspectorFaces(video) {
        const grid = document.getElementById("inspector-faces-grid");
        if (grid) grid.innerHTML = `<div style="font-size:11px; color:var(--text-muted); grid-column: 1/-1;">Carregando rostos...</div>`;

        try {
            const faces = await CapIAuAPI.fetchVideoFaces(video.id).catch(() => []);
            if (grid) {
                grid.innerHTML = "";
                if (faces.length === 0) {
                    grid.innerHTML = `<div style="font-size:11px; color:var(--text-muted); grid-column: 1/-1;">Nenhum rosto detectado neste clipe de vídeo.</div>`;
                } else {
                    faces.forEach(face => {
                        const card = document.createElement("div");
                        card.className = "inspector-face-card";
                        
                        const timecode = formatTimecode(face.timestamp || 0).substring(3, 11);
                        
                        card.innerHTML = `
                            <img src="/api/faces/face/${face.id}/thumbnail" class="inspector-face-thumb" onerror="this.src='https://placehold.co/60x60/11131a/cyan?text=Face'">
                            <span class="inspector-face-time" title="Buscar no Source Player">${timecode}</span>
                            <input type="text" class="inspector-face-input" value="${face.name || 'Pessoa Desconhecida'}" placeholder="Nome do rosto...">
                            <button class="btn-primary btn-face-save" style="font-size: 8px; padding: 2px 6px; border-radius: 4px; border:none; background:rgba(6,182,212,0.1); color:var(--color-cyan); font-weight:bold; cursor:pointer; width: 100%; margin-top:2px;">Salvar Rótulo</button>
                        `;

                        card.querySelector(".inspector-face-time").addEventListener("click", () => {
                            window.player.sourcePlayer.seek(face.timestamp);
                        });

                        const input = card.querySelector(".inspector-face-input");
                        const btnSave = card.querySelector(".btn-face-save");

                        btnSave.addEventListener("click", async () => {
                            const name = input.value.trim();
                            if (!name) return;
                            try {
                                await CapIAuAPI.labelFace(face.id, name);
                                alert("Identidade do rosto confirmada!");
                                this.loadInspectorFaces(video);
                                // Dispara evento global
                                STATE.emit("videoFacesUpdated", video.id);
                            } catch(err) {
                                alert("Erro ao rotular rosto: " + err.message);
                            }
                        });

                        grid.appendChild(card);
                    });
                }
            }
        } catch(e) {
            console.warn("Erro ao carregar faces do inspetor:", e);
            if (grid) grid.innerHTML = `<div style="font-size:11px; color:var(--text-muted); grid-column: 1/-1;">Erro ao processar rostos detectados.</div>`;
        }
    }
}

window.showToast = function(message, type = "info") {
    let container = document.getElementById("nle-toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "nle-toast-container";
        container.style.cssText = "position:fixed; bottom:24px; right:24px; z-index:10000; display:flex; flex-direction:column; gap:8px; pointer-events:none;";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "nle-toast";
    const iconMap = {
        success: '<i class="fa-solid fa-circle-check" style="color: var(--color-cyan);"></i>',
        error: '<i class="fa-solid fa-circle-xmark" style="color: var(--color-rose);"></i>',
        info: '<i class="fa-solid fa-circle-info" style="color: var(--color-violet);"></i>'
    };
    const iconHtml = iconMap[type] || iconMap.info;
    toast.innerHTML = `${iconHtml} <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "nleToastOut 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards";
        setTimeout(() => toast.remove(), 250);
    }, 2200);
};

window.setVideoThumbnail = async function(videoId, timestamp, triggerBtn = null) {
    if (!videoId && videoId !== 0) return false;
    
    let origHtml = "";
    if (triggerBtn) {
        origHtml = triggerBtn.innerHTML;
        triggerBtn.classList.remove("btn-thumb-click-pulse");
        void triggerBtn.offsetWidth;
        triggerBtn.classList.add("btn-thumb-click-pulse");
        triggerBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        triggerBtn.disabled = true;
        triggerBtn.style.pointerEvents = "none";
    }

    try {
        const response = await fetch(`/api/video/${videoId}/thumbnail?timestamp=${timestamp}`, {
            method: "POST"
        });
        if (response.ok) {
            const ver = Date.now();
            if (STATE.activeVideo && STATE.activeVideo.id === videoId) {
                STATE.activeVideo._thumbVersion = ver;
            }
            const target = (STATE.allVideos || []).find(v => v.id === videoId);
            if (target) {
                target._thumbVersion = ver;
            }

            // Atualiza diretamente os cards da biblioteca sem recriar o DOM nem resetar o scroll em todas as janelas (principal e destacadas)
            const allDocs = getAllLibraryDocuments();
            allDocs.forEach(doc => {
                const cardThumbnails = doc.querySelectorAll(`.tree-file-item[data-video-id="${videoId}"] .media-thumbnail, .media-card[data-video-id="${videoId}"] .media-thumbnail`);
                cardThumbnails.forEach(thumbEl => {
                    let img = thumbEl.querySelector("img");
                    if (img) {
                        img.src = `/api/video/${videoId}/thumbnail?v=${ver}`;
                        img.style.display = "";
                        const icon = thumbEl.querySelector("i.fa-solid");
                        if (icon) icon.remove();
                    } else {
                        const fallbackIcon = (target && target.video_type === 'interview') ? 'fa-microphone-lines' : 'fa-film';
                        const icon = thumbEl.querySelector("i.fa-solid");
                        if (icon) icon.remove();
                        img = doc.createElement("img");
                        img.alt = "Thumb";
                        img.loading = "lazy";
                        img.decoding = "async";
                        img.onerror = function() {
                            this.onerror = null;
                            this.style.display = 'none';
                            if (this.parentNode) {
                                this.parentNode.insertAdjacentHTML('beforeend', `<i class="fa-solid ${fallbackIcon}"></i>`);
                            }
                        };
                        img.src = `/api/video/${videoId}/thumbnail?v=${ver}`;
                        thumbEl.prepend(img);
                    }
                });

                // Atualiza miniaturas nas tarefas caso estejam abertas
                const taskImgs = doc.querySelectorAll(`.task-item[data-video-id="${videoId}"] img, .task-item[data-task-id="thumbs-${videoId}"] img, .task-item[data-task-id="${videoId}"] img`);
                taskImgs.forEach(img => {
                    img.src = `/api/video/${videoId}/thumbnail?v=${ver}`;
                });
            });

            // Notifica ouvintes específicos sem acionar rebuild destrutivo da biblioteca
            STATE.emit("videoThumbnailUpdated", { videoId, version: ver, video: target });
            
            if (triggerBtn) {
                triggerBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--color-cyan);"></i>';
            }
            
            window.showToast("Miniatura definida com sucesso!", "success");
            
            if (triggerBtn) {
                setTimeout(() => {
                    triggerBtn.innerHTML = origHtml;
                    triggerBtn.disabled = false;
                    triggerBtn.style.pointerEvents = "";
                    triggerBtn.classList.remove("btn-thumb-click-pulse");
                }, 1200);
            }
            return true;
        } else {
            const err = await response.json().catch(() => ({}));
            const msg = err.detail || "Desconhecido";
            window.showToast("Erro ao definir miniatura: " + msg, "error");
            
            if (triggerBtn) {
                triggerBtn.innerHTML = origHtml;
                triggerBtn.disabled = false;
                triggerBtn.style.pointerEvents = "";
                triggerBtn.classList.remove("btn-thumb-click-pulse");
            }
            return false;
        }
    } catch (e) {
        console.error("Erro ao salvar miniatura:", e);
        window.showToast("Erro de rede ao salvar miniatura.", "error");
        
        if (triggerBtn) {
            triggerBtn.innerHTML = origHtml;
            triggerBtn.disabled = false;
            triggerBtn.style.pointerEvents = "";
            triggerBtn.classList.remove("btn-thumb-click-pulse");
        }
        return false;
    }
};

window.setCustomThumbnail = window.setVideoThumbnail;

/**
 * Motor de Índice Temático Inteligente e Pré-visualização ao passar o mouse na barra de rolagem (Scroll Peeker).
 */
export class LibraryScrollIndexTracker {
    constructor() {
        this.scrollContainer = null;
        this.tooltipEl = null;
        this.dom = null;
        this.dwellTimer = null;
        this.lastHoverEvent = null;
        this.currentTargetItem = null;
        this.isPointerDownOnGutter = false;
        this.resizeObserver = null;
        
        this.isEnabled = localStorage.getItem("library_scroll_index_enabled") !== "false";
        this.dwellDelay = parseInt(localStorage.getItem("library_scroll_index_dwell") || "1000", 10);
        this.thumbWidth = parseInt(localStorage.getItem("library_scroll_preview_thumb_width") || "128", 10);

        this.activeWindow = null;
        this.activeDoc = null;

        this._onPointerMove = (e) => this.handlePointerMove(e);
        this._onPointerDown = (e) => this.handlePointerDown(e);
        this._onPointerLeave = () => this.handlePointerLeave();
        this._onPointerUp = () => this.handlePointerUp();
        this._onWheel = (e) => this.handleWheel(e);
        this._onResize = () => this.hide();

        this.init();
    }

    init() {
        this.attachToWindow(window);
        this.bindSettings();
        if (typeof window !== "undefined") {
            window.libraryScrollIndex = this;
        }
    }

    attachToWindow(win = window) {
        if (!win || !win.document) return;

        if (this.resizeObserver) {
            try {
                this.resizeObserver.disconnect();
            } catch (err) {
                console.warn("[LibraryScrollIndexTracker] Erro ao desconectar ResizeObserver anterior:", err);
            }
            this.resizeObserver = null;
        }

        // Se já estava anexado a uma janela anterior, remove listeners antigos
        if (this.activeDoc && this.activeWindow) {
            try {
                this.activeDoc.removeEventListener("pointermove", this._onPointerMove);
                this.activeDoc.removeEventListener("pointerleave", this._onPointerLeave);
                this.activeDoc.removeEventListener("pointerdown", this._onPointerDown);
                this.activeWindow.removeEventListener("pointerup", this._onPointerUp);
                this.activeWindow.removeEventListener("wheel", this._onWheel);
                this.activeWindow.removeEventListener("resize", this._onResize);
            } catch (err) {
                console.warn("[LibraryScrollIndexTracker] Erro ao remover listeners anteriores:", err);
            }
        }

        this.activeWindow = win;
        this.activeDoc = win.document;
        this.scrollContainer = null;
        this.hide();

        this.ensureTooltipElement();

        this.activeDoc.addEventListener("pointermove", this._onPointerMove);
        this.activeDoc.addEventListener("pointerleave", this._onPointerLeave);
        this.activeDoc.addEventListener("pointerdown", this._onPointerDown);
        this.activeWindow.addEventListener("pointerup", this._onPointerUp);
        this.activeWindow.addEventListener("wheel", this._onWheel, { passive: false });
        this.activeWindow.addEventListener("resize", this._onResize);
    }

    getScrollContainer() {
        if (this.scrollContainer && this.scrollContainer.isConnected) {
            return this.scrollContainer;
        }
        let container = (this.activeDoc || document).querySelector("#sidebar-left .sidebar-content.scrollable");
        if (!container && typeof document !== "undefined") {
            container = document.querySelector("#sidebar-left .sidebar-content.scrollable");
        }
        if (!container && window.popoutWindows && window.popoutWindows["sidebar-left"] && !window.popoutWindows["sidebar-left"].closed) {
            container = window.popoutWindows["sidebar-left"].document?.querySelector("#sidebar-left .sidebar-content.scrollable");
        }
        this.scrollContainer = container || null;
        return this.scrollContainer;
    }

    ensureTooltipElement() {
        const doc = this.activeDoc || document;
        let el = doc.getElementById("library-scroll-index-tooltip");
        if (!el) {
            el = doc.createElement("div");
            el.id = "library-scroll-index-tooltip";
            doc.body.appendChild(el);
        }
        el.style.setProperty("--scroll-thumb-width", `${this.thumbWidth}px`);
        if (!el.querySelector(".scroll-index-top")) {
            el.innerHTML = `
                <div class="scroll-index-top">
                    <div class="scroll-index-thumb-wrapper">
                        <img class="scroll-index-thumb" src="" alt="" style="display:none;">
                        <i class="fa-solid fa-photo-film scroll-index-icon"></i>
                    </div>
                    <div class="scroll-index-meta">
                        <div class="scroll-index-folder"><i class="fa-solid fa-folder"></i> <span>Biblioteca</span></div>
                        <div class="scroll-index-title">Título da Mídia</div>
                        <div class="scroll-index-sub">
                            <span class="scroll-index-badge tag-interview">Fala</span>
                            <span class="scroll-index-duration" style="font-family: monospace; font-size: 8.5px; color: var(--text-muted);"></span>
                        </div>
                    </div>
                </div>
                <div class="scroll-index-details">
                    <div class="scroll-index-summary"></div>
                    <div class="scroll-index-tags-row"></div>
                    <div class="scroll-index-footer">
                        <span class="scroll-index-pos">Item 1 de 1</span>
                        <span class="scroll-index-hint" style="color: var(--text-muted); opacity: 0.7;">Shift+Wheel: Zoom • Clique: Ir</span>
                    </div>
                </div>
            `;
        }
        this.tooltipEl = el;
        this.dom = {
            thumbImg: el.querySelector(".scroll-index-thumb"),
            thumbIcon: el.querySelector(".scroll-index-icon"),
            folderSpan: el.querySelector(".scroll-index-folder span"),
            titleEl: el.querySelector(".scroll-index-title"),
            badgeEl: el.querySelector(".scroll-index-badge"),
            durationEl: el.querySelector(".scroll-index-duration"),
            summaryEl: el.querySelector(".scroll-index-summary"),
            tagsRow: el.querySelector(".scroll-index-tags-row"),
            posEl: el.querySelector(".scroll-index-pos")
        };

        if (!this.resizeObserver && typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.tooltipEl && this.tooltipEl.classList.contains("visible") && this.lastHoverEvent) {
                    const container = this.getScrollContainer();
                    if (container) {
                        this.positionTooltip(this.lastHoverEvent, container.getBoundingClientRect());
                    }
                }
            });
            this.resizeObserver.observe(this.tooltipEl);
        }

        return el;
    }

    createTooltipElement() {
        return this.ensureTooltipElement();
    }

    isAnyModalOpen() {
        return isAnyModalOpen(this.activeDoc || document);
    }

    handlePointerMove(e) {
        const doc = this.activeDoc || document;
        if (!this.isEnabled || doc.querySelector(".custom-context-menu")) {
            this.hide();
            return;
        }

        // Não exibe nem rastreia se qualquer modal ou overlay estiver aberto
        if (this.isAnyModalOpen()) {
            this.hide();
            return;
        }

        const container = this.getScrollContainer();
        if (!container) {
            this.hide();
            return;
        }

        // Apenas ativo se estiver na aba de Vídeos ou Fotos
        const activeTab = doc.querySelector("#sidebar-left .tab-content.active")?.id;
        if (activeTab !== "tab-media" && activeTab !== "tab-videos" && activeTab !== "tab-photos") {
            this.hide();
            return;
        }

        // Verifica se a lista tem barra de rolagem (overflow)
        if (container.scrollHeight <= container.clientHeight + 8) {
            this.hide();
            return;
        }

        const rect = container.getBoundingClientRect();
        // Área da calha da barra (últimos 16px da borda direita da lista)
        const isInsideGutter = (e.clientX >= rect.right - 16 && e.clientX <= rect.right + 4 && e.clientY >= rect.top && e.clientY <= rect.bottom);

        if (!isInsideGutter) {
            this.hide();
            return;
        }

        // Verificação de hit-test no DOM
        const hitEl = doc.elementFromPoint(e.clientX, e.clientY);
        if (!hitEl || (!container.contains(hitEl) && hitEl !== container && !hitEl.closest("#sidebar-left"))) {
            this.hide();
            return;
        }
        if (hitEl.closest(".modal-overlay, #timeline-alternatives-popup, #timeline-alternatives-backdrop, #modal-timeline-help, #modal-edit-marker, .custom-context-menu")) {
            this.hide();
            return;
        }

        this.lastHoverEvent = e;
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        this.updateAtRatio(ratio, e, activeTab);

        if (this.isPointerDownOnGutter) {
            if (this.currentTargetItem) {
                const itemRect = this.currentTargetItem.getBoundingClientRect();
                const targetScroll = (itemRect.top - rect.top) + container.scrollTop;
                container.scrollTop = Math.max(0, targetScroll - 4);
            } else {
                const targetScrollTop = ratio * (container.scrollHeight - container.clientHeight);
                container.scrollTop = targetScrollTop;
            }
        }
    }

    handlePointerLeave() {
        this.isPointerDownOnGutter = false;
        this.hide();
    }

    handlePointerDown(e) {
        if (!this.isEnabled) return;
        const doc = this.activeDoc || document;
        if (this.isAnyModalOpen() || doc.querySelector(".custom-context-menu")) return;
        const container = this.getScrollContainer();
        if (!container) return;

        const activeTab = doc.querySelector("#sidebar-left .tab-content.active")?.id;
        if (activeTab !== "tab-media" && activeTab !== "tab-videos" && activeTab !== "tab-photos") return;
        
        const rect = container.getBoundingClientRect();
        const isInsideGutter = (e.clientX >= rect.right - 16 && e.clientX <= rect.right + 4 && e.clientY >= rect.top && e.clientY <= rect.bottom);
        if (isInsideGutter) {
            const hitEl = doc.elementFromPoint(e.clientX, e.clientY);
            if (!hitEl || (!container.contains(hitEl) && hitEl !== container && !hitEl.closest("#sidebar-left"))) {
                return;
            }
            if (hitEl.closest(".modal-overlay, #timeline-alternatives-popup, #timeline-alternatives-backdrop, #modal-timeline-help, #modal-edit-marker, .custom-context-menu")) {
                return;
            }

            this.isPointerDownOnGutter = true;
            const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
            this.updateAtRatio(ratio, e, activeTab);

            if (this.currentTargetItem) {
                const itemRect = this.currentTargetItem.getBoundingClientRect();
                const targetScroll = (itemRect.top - rect.top) + container.scrollTop;
                container.scrollTo({ top: Math.max(0, targetScroll - 4), behavior: "smooth" });
            } else {
                const targetScrollTop = ratio * (container.scrollHeight - container.clientHeight);
                container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
            }
        }
    }

    handlePointerUp() {
        this.isPointerDownOnGutter = false;
    }

    handleWheel(e) {
        if (this.isAnyModalOpen()) {
            this.hide();
            return;
        }
        if (e.shiftKey && this.tooltipEl && this.tooltipEl.classList.contains("visible")) {
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 12 : -12;
            this.thumbWidth = Math.max(80, Math.min(240, this.thumbWidth + delta));
            this.tooltipEl.style.setProperty("--scroll-thumb-width", `${this.thumbWidth}px`);
            localStorage.setItem("library_scroll_preview_thumb_width", this.thumbWidth);
            if (this.lastHoverEvent) {
                const container = this.getScrollContainer();
                if (container) this.positionTooltip(this.lastHoverEvent, container.getBoundingClientRect());
            }
        }
    }

    bindEvents() {
        // Métodos vinculados dinamicamente via attachToWindow()
    }

    bindSettings() {
        const doc = this.activeDoc || document;
        const chkEnabled = doc.getElementById("chk-scroll-index-enabled") || document.getElementById("chk-scroll-index-enabled");
        const selDwell = doc.getElementById("sel-scroll-index-dwell") || document.getElementById("sel-scroll-index-dwell");

        if (chkEnabled) {
            chkEnabled.checked = this.isEnabled;
            chkEnabled.addEventListener("change", (e) => {
                this.isEnabled = e.target.checked;
                localStorage.setItem("library_scroll_index_enabled", this.isEnabled);
                if (!this.isEnabled) this.hide();
            });
        }

        if (selDwell) {
            selDwell.value = String(this.dwellDelay);
            selDwell.addEventListener("change", (e) => {
                this.dwellDelay = parseInt(e.target.value, 10);
                localStorage.setItem("library_scroll_index_dwell", this.dwellDelay);
            });
        }
    }

    updateAtRatio(ratio, mouseEvent, activeTabId) {
        const doc = this.activeDoc || document;
        if (!this.isEnabled || doc.querySelector(".custom-context-menu")) {
            this.hide();
            return;
        }

        const container = this.getScrollContainer();
        if (!container) return;

        const activeTabEl = doc.getElementById(activeTabId);
        if (!activeTabEl) return;

        // Apenas itens visíveis (ignora pastas recolhidas cujo offsetParent é null)
        const items = Array.from(activeTabEl.querySelectorAll(".tree-folder-header, .tree-file-item, .media-card")).filter(el => el.offsetParent !== null);
        if (items.length === 0) {
            this.hide();
            return;
        }

        const targetScrollTop = ratio * (container.scrollHeight - container.clientHeight);
        const containerRect = container.getBoundingClientRect();
        const currentScrollTop = container.scrollTop;

        // Encontra o item cuja posição vertical real no conteúdo é mais próxima da calculada
        let bestItem = null;
        let bestDist = Infinity;

        for (const item of items) {
            const itemRect = item.getBoundingClientRect();
            const itemAbsoluteTop = (itemRect.top - containerRect.top) + currentScrollTop;
            const dist = Math.abs(itemAbsoluteTop - targetScrollTop);
            if (dist < bestDist) {
                bestDist = dist;
                bestItem = item;
            }
        }

        if (!bestItem) {
            bestItem = items[Math.min(items.length - 1, Math.floor(ratio * items.length))];
        }

        this.renderItemData(bestItem, items, activeTabId);
        this.positionTooltip(mouseEvent, containerRect);

        // Gerenciamento de Dwell Time (Expansão progressiva ao parar)
        if (this.currentTargetItem !== bestItem) {
            this.currentTargetItem = bestItem;
            this.tooltipEl.classList.remove("expanded");
            clearTimeout(this.dwellTimer);

            if (this.dwellDelay > 0) {
                this.dwellTimer = setTimeout(() => {
                    this.tooltipEl.classList.add("expanded");
                    if (typeof requestAnimationFrame !== "undefined") {
                        requestAnimationFrame(() => {
                            if (this.lastHoverEvent && this.tooltipEl && this.tooltipEl.classList.contains("visible")) {
                                const currentContainer = this.getScrollContainer();
                                if (currentContainer) {
                                    this.positionTooltip(this.lastHoverEvent, currentContainer.getBoundingClientRect());
                                }
                            }
                        });
                    } else if (this.lastHoverEvent) {
                        const currentContainer = this.getScrollContainer();
                        if (currentContainer) {
                            this.positionTooltip(this.lastHoverEvent, currentContainer.getBoundingClientRect());
                        }
                    }
                }, this.dwellDelay);
            }
        }
    }

    renderItemData(itemEl, allItems, activeTabId) {
        if (!this.tooltipEl || !this.dom) return;

        const { thumbImg, thumbIcon, folderSpan, titleEl, badgeEl, durationEl, summaryEl, tagsRow, posEl } = this.dom;

        const isFolder = itemEl.classList.contains("tree-folder-header");
        const cardIndex = allItems.indexOf(itemEl);
        if (posEl) posEl.textContent = `Posição: ${cardIndex + 1} de ${allItems.length}`;

        if (isFolder) {
            const folderName = itemEl.querySelector(".folder-name")?.textContent || "Pasta";
            if (folderSpan) folderSpan.textContent = "Diretório";
            if (titleEl) titleEl.textContent = folderName;
            if (badgeEl) {
                badgeEl.className = "scroll-index-badge";
                badgeEl.textContent = "Pasta";
            }
            if (durationEl) durationEl.textContent = "";
            if (thumbImg) thumbImg.style.display = "none";
            if (thumbIcon) {
                thumbIcon.style.display = "block";
                thumbIcon.className = "fa-solid fa-folder scroll-index-icon";
                thumbIcon.style.color = "var(--color-violet)";
            }

            if (summaryEl) summaryEl.textContent = `Pasta contendo mídias organizadas.`;
            if (tagsRow) tagsRow.innerHTML = "";
        } else {
            // Na aba unificada video e foto convivem: o atributo do card decide.
            const isVideo = itemEl.hasAttribute("data-video-id") || activeTabId === "tab-videos";
            const isPhoto = itemEl.hasAttribute("data-photo-id") || activeTabId === "tab-photos";
            
            const parentFolderName = itemEl.closest(".tree-folder-container")?.querySelector(".tree-folder-header .folder-name")?.textContent || "Biblioteca";
            if (folderSpan) folderSpan.textContent = parentFolderName;

            if (isVideo) {
                const vidId = parseInt(itemEl.getAttribute("data-video-id"), 10);
                const video = (STATE.allVideos || []).find(v => v.id === vidId);

                if (video) {
                    // Resumo executivo / título inteligente
                    const executiveTitle = getFriendlyTitle(video);
                    if (titleEl) titleEl.textContent = executiveTitle;

                    const isInterview = video.video_type === "interview";
                    if (badgeEl) {
                        badgeEl.className = `scroll-index-badge ${isInterview ? 'tag-interview' : 'tag-broll'}`;
                        badgeEl.textContent = isInterview ? "Fala" : "Bastidores";
                    }

                    if (durationEl) {
                        if (video.duration) {
                            const m = Math.floor(video.duration / 60);
                            const s = Math.floor(video.duration % 60);
                            durationEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                        } else {
                            durationEl.textContent = "";
                        }
                    }

                    const vVersion = video._thumbVersion || video.thumb_version || video.updated_at || "";
                    const qs = vVersion ? `?v=${vVersion}` : "";
                    if (thumbImg) {
                        thumbImg.src = `/api/video/${video.id}/thumbnail${qs}`;
                        thumbImg.style.display = "block";
                        thumbImg.onerror = () => {
                            if (thumbImg) thumbImg.style.display = "none";
                            if (thumbIcon) thumbIcon.style.display = "block";
                        };
                    }
                    if (thumbIcon) {
                        thumbIcon.style.display = "none";
                        thumbIcon.className = (isInterview ? "fa-solid fa-microphone-lines" : "fa-solid fa-film") + " scroll-index-icon";
                        thumbIcon.style.color = isInterview ? "var(--color-cyan)" : "var(--color-violet)";
                    }

                    if (summaryEl) summaryEl.textContent = video.summary || video.description || "Sem resumo narrativo gerado.";

                    // Tags e Personagens
                    if (tagsRow) {
                        tagsRow.innerHTML = "";
                        if (video.category) {
                            const catLabel = CATEGORY_LABELS[video.category] || video.category;
                            const chip = document.createElement("span");
                            chip.className = "scroll-index-tag-chip";
                            chip.textContent = `🏷️ ${catLabel}`;
                            tagsRow.appendChild(chip);
                        }
                        if (video.tags) {
                            try {
                                const parsed = typeof video.tags === "string" ? JSON.parse(video.tags) : video.tags;
                                if (Array.isArray(parsed)) {
                                    parsed.slice(0, 4).forEach(t => {
                                        const chip = document.createElement("span");
                                        if (t.startsWith("Person:") || t.startsWith("Speaker:")) {
                                            const pName = t.split(":")[1].trim();
                                            chip.className = "scroll-index-tag-chip person";
                                            chip.textContent = `👤 ${pName}`;
                                        } else {
                                            chip.className = "scroll-index-tag-chip";
                                            chip.textContent = t;
                                        }
                                        tagsRow.appendChild(chip);
                                    });
                                }
                            } catch(e) {}
                        }
                    }
                } else {
                    if (titleEl) titleEl.textContent = itemEl.querySelector("h4")?.textContent || "Vídeo";
                    if (thumbImg) thumbImg.style.display = "none";
                    if (thumbIcon) {
                        thumbIcon.style.display = "block";
                        thumbIcon.className = "fa-solid fa-film scroll-index-icon";
                    }
                }
            } else if (isPhoto) {
                const photoId = parseInt(itemEl.getAttribute("data-photo-id"), 10);
                const photo = (STATE.allPhotos || []).find(p => p.id === photoId);

                if (photo) {
                    const friendlyPhotoTitle = photo.title || photo.description || photo.filename;
                    if (titleEl) titleEl.textContent = cleanTitle(friendlyPhotoTitle);
                    if (badgeEl) {
                        badgeEl.className = "scroll-index-badge tag-photo";
                        badgeEl.textContent = CATEGORY_LABELS[photo.category] || "Foto";
                    }
                    if (durationEl) durationEl.textContent = "";

                    const src = photo.proxy_path || (photo.filepath && (photo.filepath.startsWith('http') || photo.filepath.startsWith('/')) ? photo.filepath : `/originals/${photo.filename}`);
                    if (thumbImg) {
                        thumbImg.src = src;
                        thumbImg.style.display = "block";
                        thumbImg.onerror = () => {
                            if (thumbImg) thumbImg.style.display = "none";
                            if (thumbIcon) thumbIcon.style.display = "block";
                        };
                    }
                    if (thumbIcon) {
                        thumbIcon.style.display = "none";
                        thumbIcon.className = "fa-solid fa-camera scroll-index-icon";
                        thumbIcon.style.color = "var(--color-emerald)";
                    }

                    if (summaryEl) summaryEl.textContent = photo.description || photo.caption || "Foto registrada de set/produção.";
                    if (tagsRow) {
                        tagsRow.innerHTML = "";
                        if (photo.category) {
                            const chip = document.createElement("span");
                            chip.className = "scroll-index-tag-chip";
                            chip.textContent = `🏷️ ${CATEGORY_LABELS[photo.category] || photo.category}`;
                            tagsRow.appendChild(chip);
                        }
                        if (photo.tags) {
                            try {
                                const parsed = typeof photo.tags === "string" ? JSON.parse(photo.tags) : photo.tags;
                                if (Array.isArray(parsed)) {
                                    parsed.slice(0, 3).forEach(t => {
                                        const chip = document.createElement("span");
                                        chip.className = "scroll-index-tag-chip";
                                        chip.textContent = t;
                                        tagsRow.appendChild(chip);
                                    });
                                }
                            } catch(e) {}
                        }
                    }
                } else {
                    if (titleEl) titleEl.textContent = itemEl.querySelector("h4")?.textContent || "Foto";
                    if (thumbImg) thumbImg.style.display = "none";
                    if (thumbIcon) {
                        thumbIcon.style.display = "block";
                        thumbIcon.className = "fa-solid fa-camera scroll-index-icon";
                    }
                }
            }
        }
    }

    positionTooltip(mouseEvent, containerRect) {
        const win = this.activeWindow || window;
        const doc = this.activeDoc || win.document || document;
        this.ensureTooltipElement();
        if (!this.tooltipEl) return;
        this.tooltipEl.classList.add("visible");

        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width || (this.thumbWidth + 160);
        const tooltipHeight = tooltipRect.height || 70;

        const viewportHeight = Math.min(
            win.innerHeight || 99999,
            doc.documentElement?.clientHeight || 99999
        );
        const viewportWidth = Math.min(
            win.innerWidth || 99999,
            doc.documentElement?.clientWidth || 99999
        );

        const margin = 10;
        let top = mouseEvent.clientY - (tooltipHeight / 2);
        
        // Garante que o card nunca ultrapasse a borda inferior da tela ao expandir com descrição
        if (top + tooltipHeight > viewportHeight - margin) {
            top = viewportHeight - tooltipHeight - margin;
        }
        // Garante que o card nunca ultrapasse o topo da janela
        top = Math.max(margin, top);

        // Por padrão: à direita da barra para não cobrir a mídia da biblioteca
        let left = containerRect.right + 6;

        // Se passar da borda direita da janela ou estiver maximizado: inverte para a esquerda da barra
        if (left + tooltipWidth > viewportWidth - margin) {
            left = containerRect.right - 16 - tooltipWidth - 6;
        }
        left = Math.max(margin, left);

        this.tooltipEl.style.top = `${Math.round(top)}px`;
        this.tooltipEl.style.left = `${Math.round(left)}px`;
    }

    hide() {
        if (this.tooltipEl) {
            this.tooltipEl.classList.remove("visible", "expanded");
        }
        clearTimeout(this.dwellTimer);
        this.currentTargetItem = null;
    }
}

