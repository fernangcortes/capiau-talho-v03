// Gerenciador visual da Biblioteca de Mídias, árvore de pastas e lightbox de fotos.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";

// Armazena o estado das pastas expandidas/recolhidas
const openFoldersSet = new Set();

// Preferências de exibição de títulos de clipes
if (!window.titleDisplayPreferences) {
    try {
        window.titleDisplayPreferences = JSON.parse(localStorage.getItem("titleDisplayPreferences") || "{}");
    } catch(e) {
        window.titleDisplayPreferences = {};
    }
}

export function cleanTitle(text) {
    if (!text) return "";
    let clean = text.trim();
    
    // Lista de prefixos/introduções comuns gerados por IA para remover
    const prefixos = [
        // Adjetivos ou qualificadores complexos iniciais
        /^(valiosa|valioso|útil|importante|versátil|interessante|dinâmica|dinâmico|visualmente\s+rica|visualmente\s+rico|intimista\s+e\s+tranquila|intimista\s+e\s+tranquilo|rica\s+e\s+diversificada|rico\s+e\s+diversificado|excelente|ótima|ótimo)\s*(para\s+mostrar|para\s+documentários|para|que\s+capture|que\s+destaca|que\s+mostra|que)?\s*/i,
        // Nomes de tipo de clipe e conectivos
        /^(sequência|clipe|material|trecho|registro|vídeo|cena|aéreos|detalhes|registro|imagens|take|plano|gravação)\s*(que\s+destacam|que\s+mostram|de\s+bastidores|útil|valioso|importante|interessante|para|mostrando|de|com|do|da|em)?\s*/i,
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

export function getFriendlyTitle(v) {
    // Se o usuário optou por forçar nome do arquivo real para este clipe
    const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[v.id] === "filename";
    if (forceRealFilename) return v.filename;

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

function hasMatchingChildren(node, query) {
    if (!query) return true;
    if (node.type === "file") {
        const friendlyTitle = getFriendlyTitle(node.video).toLowerCase();
        const filename = node.video.filename.toLowerCase();
        return friendlyTitle.includes(query) || filename.includes(query);
    }
    if (node.type === "folder") {
        return Object.values(node.children).some(child => hasMatchingChildren(child, query));
    }
    return false;
}

function getCommonBasePath(paths) {
    if (paths.length === 0) return "";
    if (paths.length === 1) {
        const parts = paths[0].split("/");
        parts.pop();
        return parts.join("/") + "/";
    }
    
    let commonParts = paths[0].split("/");
    commonParts.pop();
    
    for (let i = 1; i < paths.length; i++) {
        const parts = paths[i].split("/");
        parts.pop();
        
        let j = 0;
        while (j < commonParts.length && j < parts.length && commonParts[j] === parts[j]) {
            j++;
        }
        commonParts = commonParts.slice(0, j);
    }
    
    if (commonParts.length === 0) return "";
    return commonParts.join("/") + "/";
}

function buildTree(videos) {
    const filepaths = videos.map(v => v.filepath.replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    const root = {
        name: commonBase ? commonBase.split("/").filter(Boolean).pop() || commonBase : "Biblioteca",
        type: "folder",
        path: "root",
        children: {},
        isRoot: true,
        isOpen: true
    };
    
    videos.forEach(v => {
        const normalized = v.filepath.replace(/\\/g, "/");
        const relative = commonBase ? normalized.substring(commonBase.length) : normalized;
        const parts = relative.split("/").filter(Boolean);
        
        let current = root;
        let currentPath = "root";
        for (let i = 0; i < parts.length - 1; i++) {
            const folderName = parts[i];
            currentPath = currentPath + "/" + folderName;
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
        
        const fileName = parts[parts.length - 1] || v.filename;
        current.children[fileName] = {
            name: fileName,
            type: "file",
            video: v
        };
    });
    
    return root;
}

function formatTimecode(sec) {
    if (isNaN(sec)) return "00:00:00:00";
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const frames = Math.floor((sec % 1) * 24); // 24fps
    
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function renderTreeNode(node, container, depth = 0) {
    if (node.type === "folder") {
        const query = document.getElementById("library-search-input")?.value.toLowerCase().trim() || "";
        if (query && !hasMatchingChildren(node, query)) {
            return;
        }
        const folderDiv = document.createElement("div");
        folderDiv.className = "tree-folder-container";
        
        const folderHeader = document.createElement("div");
        folderHeader.className = "tree-folder-header";
        folderHeader.style.paddingLeft = `${depth * 10 + 10}px`;
        
        const icon = node.isOpen ? "fa-folder-open" : "fa-folder";
        const chevron = node.isOpen ? "fa-chevron-down" : "fa-chevron-right";
        
        folderHeader.innerHTML = `
            <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
                <i class="fa-solid ${chevron} chevron-icon" style="font-size:9px; margin-right:6px; color:var(--text-muted);"></i>
                <i class="fa-solid ${icon} folder-icon" style="color:var(--color-violet); margin-right:8px;"></i>
                <span class="folder-name" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${node.name}</span>
            </div>
            <div class="folder-actions" style="display: flex; gap: 4px; margin-right: 6px;">
                <button class="btn-folder-action" data-action="expand" title="Expandir todas as subpastas" style="background: none; border: none; padding: 2px 4px; color: var(--color-cyan); cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-angles-down"></i>
                </button>
                <button class="btn-folder-action" data-action="collapse" title="Recolher todas as subpastas" style="background: none; border: none; padding: 2px 4px; color: var(--text-muted); cursor: pointer; font-size: 10px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-angles-up"></i>
                </button>
            </div>
        `;
        folderHeader.dataset.folderPath = node.path;
        
        const folderChildren = document.createElement("div");
        folderChildren.className = "tree-folder-children";
        if (!node.isOpen) {
            folderChildren.style.display = "none";
        }
        
        folderHeader.addEventListener("click", (e) => {
            e.stopPropagation();
            
            const actionBtn = e.target.closest(".btn-folder-action");
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const path = folderHeader.dataset.folderPath;
                window.expandCollapseAllSubfolders(path, action === "expand");
                return;
            }
            
            node.isOpen = !node.isOpen;
            const newChevron = node.isOpen ? "fa-chevron-down" : "fa-chevron-right";
            const newIcon = node.isOpen ? "fa-folder-open" : "fa-folder";
            
            folderHeader.querySelector(".chevron-icon").className = `fa-solid ${newChevron} chevron-icon`;
            folderHeader.querySelector(".folder-icon").className = `fa-solid ${newIcon} folder-icon`;
            
            folderChildren.style.display = node.isOpen ? "block" : "none";
            
            if (node.isOpen) {
                openFoldersSet.add(node.path);
            } else {
                openFoldersSet.delete(node.path);
            }
        });
        
        folderDiv.appendChild(folderHeader);
        folderDiv.appendChild(folderChildren);
        
        const sortBy = document.getElementById("library-sort-by")?.value || "name_asc";
        const sortedKeys = Object.keys(node.children).sort((a, b) => {
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
            const vA = nodeA.video;
            const vB = nodeB.video;
            if (sortBy === "name_asc") {
                return (vA.filename || "").localeCompare(vB.filename || "");
            } else if (sortBy === "name_desc") {
                return (vB.filename || "").localeCompare(vA.filename || "");
            } else if (sortBy === "type_interview") {
                const typeA = vA.video_type === "interview" ? 0 : (vA.video_type === "broll" ? 1 : 2);
                const typeB = vB.video_type === "interview" ? 0 : (vB.video_type === "broll" ? 1 : 2);
                if (typeA !== typeB) return typeA - typeB;
                return (vA.filename || "").localeCompare(vB.filename || "");
            } else if (sortBy === "type_broll") {
                const typeA = vA.video_type === "broll" ? 0 : (vA.video_type === "interview" ? 1 : 2);
                const typeB = vB.video_type === "broll" ? 0 : (vB.video_type === "interview" ? 1 : 2);
                if (typeA !== typeB) return typeA - typeB;
                return (vA.filename || "").localeCompare(vB.filename || "");
            } else if (sortBy === "duration_desc") {
                const durA = vA.duration || 0;
                const durB = vB.duration || 0;
                if (durB !== durA) return durB - durA;
                return (vA.filename || "").localeCompare(vB.filename || "");
            } else if (sortBy === "date_desc") {
                return (vB.id || 0) - (vA.id || 0);
            }
            return a.localeCompare(b);
        });
        
        sortedKeys.forEach(key => {
            renderTreeNode(node.children[key], folderChildren, depth + 1);
        });
        
        container.appendChild(folderDiv);
    } else if (node.type === "file") {
        const v = node.video;
        
        // Verifica se corresponde ao filtro de busca
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
        
        const friendlyTitle = getFriendlyTitle(v);
        const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[v.id] === "filename";
        const currentTitle = forceRealFilename ? v.filename : friendlyTitle;
        
        if (query) {
            const matchesFriendly = friendlyTitle.toLowerCase().includes(query);
            const matchesFilename = v.filename.toLowerCase().includes(query);
            if (!matchesFriendly && !matchesFilename) {
                return; // Oculta se não corresponder
            }
        }
        
        const card = document.createElement("div");
        card.className = "media-card tree-file-item";
        card.setAttribute("data-video-id", v.id);
        card.style.paddingLeft = "6px";
        if (STATE.activeVideo && STATE.activeVideo.id === v.id) card.classList.add("active");
        
        const badgeClass = v.video_type === "interview" ? "tag-interview" : "tag-broll";
        const badgeLabel = v.video_type === "interview" ? "Fala" : "Bastidores";
        
        let statusGlow = "";
        let statusBadge = "";
        let actionBtn = "";
        
        const isConverting = STATE.activeConversions && STATE.activeConversions[v.id];
        
        if (v.status === "transcribing" || v.status === "processing") {
            if (isConverting) {
                statusGlow = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);" title="Convertendo..."></i>`;
                actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--color-rose); cursor:pointer; padding:2px;" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" title="Cancelar Conversão"><i class="fa-solid fa-circle-stop" style="font-size:10px;"></i></button>`;
            } else {
                statusGlow = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);" title="Transcrevendo..."></i>`;
            }
        } else if (v.status === "analyzing") {
            statusGlow = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-violet);" title="Analisando..."></i>`;
            actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--color-rose); cursor:pointer; padding:2px;" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" title="Cancelar Análise"><i class="fa-solid fa-circle-stop" style="font-size:10px;"></i></button>`;
        } else if (v.status === "transcribed") {
            statusBadge = `<span class="badge" style="color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3);">ASR</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "analyzed") {
            statusBadge = `<span class="badge" style="color: var(--color-violet); border-color: rgba(138, 92, 246, 0.3);">VISÃO</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "ingested") {
            actionBtn = `<button class="btn-card-action btn-hover-only" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        } else if (v.status === "error") {
            statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);" title="Erro no processamento!"></i>`;
            actionBtn = `<button class="btn-card-action" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer; padding: 2px;" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" title="Limpar Vídeo/Proxy"><i class="fa-solid fa-trash-can" style="font-size: 10px;"></i></button>`;
        }
        
        // Thumbnail (Real ou Ícone)
        const showRealThumb = !document.body.classList.contains("hide-thumbnails") && document.getElementById("chk-show-thumbnails")?.checked !== false;
        let thumbContent = `<i class="fa-solid ${v.video_type === 'interview' ? 'fa-microphone-lines' : 'fa-film'}"></i>`;
        if (showRealThumb && v.status !== "pending" && v.status !== "error") {
            thumbContent = `<img src="/api/video/${v.id}/thumbnail" alt="Thumb" onerror="this.style.display='none'">`;
        }
        
        // Toggle title display icon
        const toggleTitleIcon = forceRealFilename ? "fa-file-signature" : "fa-font";
        const toggleTitleTitle = forceRealFilename ? "Mostrar Título Contextual" : "Mostrar Nome do Arquivo Real";
        const toggleBtnHtml = `<button class="btn-toggle-filename" title="${toggleTitleTitle}"><i class="fa-solid ${toggleTitleIcon}"></i></button>`;

        // Tooltip completa
        const tooltip = `Título: ${friendlyTitle}\nArquivo: ${v.filename}\nTipo: ${v.video_type === 'interview' ? 'Entrevista' : 'Bastidores'}\nDescrição: ${v.description || v.summary || 'Sem decupagem'}`;

        card.innerHTML = `
            <div class="media-thumbnail">
                ${thumbContent}
            </div>
            <div class="media-info">
                <h4 title="${tooltip}">
                    ${toggleBtnHtml}
                    <span class="clip-title-text">${currentTitle}</span>
                </h4>
                <div class="media-meta-row">
                    <span class="media-duration">${v.duration ? formatTimecode(v.duration).substring(3, 11) : "00:00:00"}</span>
                    ${statusGlow}
                    ${statusBadge}
                    <span class="badge-tag ${badgeClass}">${badgeLabel}</span>
                    ${actionBtn}
                </div>
            </div>
        `;
        
        card.addEventListener("click", () => {
            STATE.activeVideo = v;
        });

        // Arrastar-e-soltar do vídeo para a timeline
        card.draggable = true;
        card.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("application/x-capiau-media", JSON.stringify({ type: "video", id: v.id }));
            e.dataTransfer.effectAllowed = "copy";
        });

        // Listener para alternar título
        const toggleBtn = card.querySelector(".btn-toggle-filename");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const wasReal = window.titleDisplayPreferences[v.id] === "filename";
                window.titleDisplayPreferences[v.id] = wasReal ? "friendly" : "filename";
                localStorage.setItem("titleDisplayPreferences", JSON.stringify(window.titleDisplayPreferences));
                // Recarrega biblioteca inteira para re-renderizar
                STATE.emit("videosUpdated", STATE.allVideos);
            });
        }
        
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

window.globalExpandCollapseAll = function(expand) {
    const filepaths = STATE.allVideos.map(v => v.filepath.replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    STATE.allVideos.forEach(v => {
        const normalized = v.filepath.replace(/\\/g, "/");
        const relative = commonBase ? normalized.substring(commonBase.length) : normalized;
        const parts = relative.split("/").filter(Boolean);
        
        let currentPath = "root";
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath + "/" + parts[i];
            if (expand) {
                openFoldersSet.add(currentPath);
            } else {
                openFoldersSet.delete(currentPath);
            }
        }
    });
    STATE.emit("videosUpdated", STATE.allVideos);
};

window.expandCollapseAllSubfolders = function(folderPath, expand) {
    const filepaths = STATE.allVideos.map(v => v.filepath.replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    const folderPaths = new Set();
    STATE.allVideos.forEach(v => {
        const normalized = v.filepath.replace(/\\/g, "/");
        const relative = commonBase ? normalized.substring(commonBase.length) : normalized;
        const parts = relative.split("/").filter(Boolean);
        
        let currentPath = "root";
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath + "/" + parts[i];
            folderPaths.add(currentPath);
        }
    });

    folderPaths.forEach(path => {
        if (path === folderPath || path.startsWith(folderPath + "/")) {
            if (expand) {
                openFoldersSet.add(path);
            } else {
                openFoldersSet.delete(path);
            }
        }
    });
    STATE.emit("videosUpdated", STATE.allVideos);
};

export class LibraryManager {
    constructor() {
        this.videoListEl = document.getElementById("video-list");
        this.photoListEl = document.getElementById("photo-list");
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

        this.init();
    }

    init() {
        STATE.on("videosUpdated", (videos) => this.renderVideos(videos));
        STATE.on("photosUpdated", (photos) => this.renderPhotos(photos));
        STATE.on("projectChanged", () => this.reloadData());
        STATE.on("activeVideoChanged", (video) => {
            document.querySelectorAll(".media-card.tree-file-item").forEach(el => {
                if (video && el.getAttribute("data-video-id") == video.id) {
                    el.classList.add("active");
                } else {
                    el.classList.remove("active");
                }
            });
        });

        if (this.btnScan) this.btnScan.addEventListener("click", () => this.runWatchScan());
        if (this.btnImportExternal) this.btnImportExternal.addEventListener("click", () => this.runImportExternal());
        if (this.btnOpenProxies) this.btnOpenProxies.addEventListener("click", () => this.runOpenProxies());
        if (this.btnRetryFailed) this.btnRetryFailed.addEventListener("click", () => this.runRetryFailed());
        if (this.btnTranscribeAll) this.btnTranscribeAll.addEventListener("click", () => this.triggerTranscribeAll());

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
                const formData = new FormData();
                formData.append("file", file);
                
                try {
                    const response = await fetch(`/api/project/${STATE.currentProjectId}/docs?doc_type=${docType}`, {
                        method: "POST",
                        body: formData
                    });
                    if (response.ok) {
                        alert("Documento importado e indexado no Qdrant com sucesso!");
                        this.loadDocuments();
                    } else {
                        const err = await response.json();
                        alert("Erro ao importar: " + (err.detail || "Desconhecido"));
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
            this.btnZoomPhoto.addEventListener("click", () => this.toggleZoom());
        }
        if (this.lightboxImg) {
            this.lightboxImg.addEventListener("click", () => this.toggleZoom());
        }
        if (this.btnAnalyzePhoto) {
            this.btnAnalyzePhoto.addEventListener("click", () => this.analyzeCurrentPhoto());
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
        }
        
        // Checkboxes de exibição
        const chkThumbnails = document.getElementById("chk-show-thumbnails");
        const chkDuration = document.getElementById("chk-show-duration");
        const chkTags = document.getElementById("chk-show-tags");
        const chkStatus = document.getElementById("chk-show-status");
        
        const videoList = this.videoListEl || document.getElementById("video-list");
        
        function applyDisplayClasses() {
            if (!videoList) return;
            videoList.classList.toggle("hide-thumbnails", chkThumbnails ? !chkThumbnails.checked : false);
            videoList.classList.toggle("hide-duration", chkDuration ? !chkDuration.checked : false);
            videoList.classList.toggle("hide-tags", chkTags ? !chkTags.checked : false);
            videoList.classList.toggle("hide-status", chkStatus ? !chkStatus.checked : false);
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
                    // Re-renderiza para carregar imagens se Miniaturas foi ativado
                    STATE.emit("videosUpdated", STATE.allVideos);
                });
            }
        });
        
        applyDisplayClasses();

        // Modo de Visualização (Lista vs Grade)
        const btnViewModeList = document.getElementById("btn-view-mode-list");
        const btnViewModeGrid = document.getElementById("btn-view-mode-grid");
        
        function setViewMode(mode) {
            if (!videoList) return;
            if (mode === "grid") {
                videoList.classList.add("view-mode-grid");
                if (btnViewModeGrid) btnViewModeGrid.classList.add("active");
                if (btnViewModeList) btnViewModeList.classList.remove("active");
            } else {
                videoList.classList.remove("view-mode-grid");
                if (btnViewModeList) btnViewModeList.classList.add("active");
                if (btnViewModeGrid) btnViewModeGrid.classList.remove("active");
            }
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
            if (!videoList) return;
            videoList.style.setProperty("--thumb-width", `${val}px`);
            videoList.style.setProperty("--thumb-height", `${Math.round(val * 9 / 16)}px`);
            if (zoomLabel) zoomLabel.textContent = `${val}px`;
            if (zoomSlider) zoomSlider.value = val;
            localStorage.setItem("lib-pref-zoom", val);
        }
        
        if (zoomSlider) {
            zoomSlider.addEventListener("input", (e) => {
                setZoomValue(parseInt(e.target.value));
            });
        }
        
        // Carrega preferências salvas
        const savedViewMode = localStorage.getItem("lib-pref-view-mode") || "list";
        setViewMode(savedViewMode);
        
        const savedZoom = localStorage.getItem("lib-pref-zoom") || "80";
        setZoomValue(parseInt(savedZoom));

        // Busca de mídias (Filtro em tempo real)
        const searchInput = document.getElementById("library-search-input");
        if (searchInput) {
            searchInput.addEventListener("input", () => {
                STATE.emit("videosUpdated", STATE.allVideos);
            });
        }

        // Atalho 'a' ou 'A' para abrir o Modal de Entrevista
        document.addEventListener("keydown", (e) => {
            const activeTag = document.activeElement.tagName;
            if (activeTag === "INPUT" || activeTag === "TEXTAREA" || document.activeElement.isContentEditable) {
                return; // Ignora se o usuário estiver em um input
            }
            
            if (e.key.toLowerCase() === 'a') {
                if (STATE.activeVideo) {
                    e.preventDefault();
                    this.openInterviewModal(STATE.activeVideo);
                }
            }
        });

        // Eventos do Modal de Entrevista
        const btnCloseInterview = document.getElementById("btn-close-interview-modal");
        const interviewModal = document.getElementById("interview-modal");
        
        const closeInterviewModal = () => {
            if (interviewModal) {
                interviewModal.style.display = "none";
            }
            const modalVideo = document.getElementById("interview-modal-video");
            if (modalVideo) {
                modalVideo.pause();
                modalVideo.src = "";
            }
        };

        if (btnCloseInterview && interviewModal) {
            btnCloseInterview.addEventListener("click", closeInterviewModal);
            interviewModal.addEventListener("click", (e) => {
                if (e.target === interviewModal) {
                    closeInterviewModal();
                }
            });
        }

        // Controles de Ponto In/Out/Append e Miniatura no Modal de Entrevista
        const btnModalMarkIn = document.getElementById("btn-interview-modal-mark-in");
        const btnModalMarkOut = document.getElementById("btn-interview-modal-mark-out");
        const btnModalSetThumb = document.getElementById("btn-interview-modal-set-thumb");
        const btnModalAppend = document.getElementById("btn-interview-modal-append");

        if (btnModalMarkIn) {
            btnModalMarkIn.addEventListener("click", () => this.markModalIn());
        }
        if (btnModalMarkOut) {
            btnModalMarkOut.addEventListener("click", () => this.markModalOut());
        }
        if (btnModalSetThumb) {
            btnModalSetThumb.addEventListener("click", () => {
                if (STATE.activeVideo) this.setModalThumbnail(STATE.activeVideo);
            });
        }
        if (btnModalAppend) {
            btnModalAppend.addEventListener("click", () => {
                if (STATE.activeVideo) this.appendModalToTimeline(STATE.activeVideo);
            });
        }

        // Atalhos de teclado locais do Modal de Entrevista (I, O, E)
        document.addEventListener("keydown", (e) => {
            if (!interviewModal || interviewModal.style.display !== "flex") return;
            
            const activeTag = document.activeElement.tagName.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || document.activeElement.isContentEditable) {
                return; // Ignora se o usuário estiver digitando
            }
            
            const key = e.key.toLowerCase();
            if (key === 'i') {
                e.preventDefault();
                this.markModalIn();
            } else if (key === 'o') {
                e.preventDefault();
                this.markModalOut();
            } else if (key === 'e') {
                e.preventDefault();
                if (STATE.activeVideo) this.appendModalToTimeline(STATE.activeVideo);
            }
        });

        // Abas do Modal de Entrevista
        const tabHeader = document.getElementById("interview-tabs-header");
        if (tabHeader) {
            tabHeader.querySelectorAll(".tab-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const tabId = btn.dataset.interviewTab;
                    this.switchInterviewTab(tabId);
                });
            });
        }

        // Copiar Notas
        const btnCopyNotes = document.getElementById("btn-interview-copy-notes");
        if (btnCopyNotes) {
            btnCopyNotes.addEventListener("click", () => {
                if (STATE.activeVideo) {
                    this.copyInterviewNotes(STATE.activeVideo);
                }
            });
        }
    }

    async reloadData() {
        try {
            const videos = await CapIAuAPI.fetchVideos(STATE.currentProjectId);
            STATE.allVideos = videos;
            const photos = await CapIAuAPI.fetchPhotos(STATE.currentProjectId);
            STATE.allPhotos = photos;
            await this.loadDocuments();
        } catch (e) {
            console.error("[LibraryManager] Falha ao recarregar mídias:", e);
        }
    }

    async loadDocuments() {
        if (!this.docsListEl) return;
        this.docsListEl.innerHTML = "<div class='loading' style='font-size:11px; color:var(--text-muted);'>Carregando documentos...</div>";
        try {
            const docs = await CapIAuAPI.fetchDocuments(STATE.currentProjectId);
            this.renderDocuments(docs);
        } catch (e) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
        }
    }

    renderDocuments(docs) {
        if (!this.docsListEl) return;
        this.docsListEl.innerHTML = "";
        
        if (docs.length === 0) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
            return;
        }
        
        docs.forEach(doc => {
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
            
            card.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
                    <i class="fa-solid ${docIcon}" style="color: var(--color-cyan); font-size: 14px;"></i>
                    <div style="display:flex; flex-direction:column; min-width:0; flex:1;">
                        <span style="font-size:12px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);" title="${doc.filename}">${doc.filename}</span>
                        <span style="font-size:9px; color:var(--text-muted); text-transform:capitalize;">${doc.doc_type === 'script' ? 'Roteiro' : doc.doc_type}</span>
                    </div>
                </div>
                <button class="btn-card-action" style="color:var(--color-rose); background:transparent; border:none; cursor:pointer;" onclick="window.deleteDocument(${doc.id})" title="Deletar Documento"><i class="fa-solid fa-trash-can"></i></button>
            `;
            
            this.docsListEl.appendChild(card);
        });
    }

    renderVideos(videos) {
        if (!this.videoListEl) return;
        this.videoListEl.innerHTML = "";
        
        if (videos.length === 0) {
            this.videoListEl.innerHTML = `<div class="empty-state-text">Nenhuma mídia encontrada na pasta watch/</div>`;
            return;
        }

        const tree = buildTree(videos);
        if (tree.isRoot && tree.name === "Biblioteca") {
            Object.keys(tree.children).forEach(key => {
                renderTreeNode(tree.children[key], this.videoListEl, 0);
            });
        } else {
            renderTreeNode(tree, this.videoListEl, 0);
        }
    }

    renderPhotos(photos) {
        if (!this.photoListEl) return;
        this.photoListEl.innerHTML = "";
        
        if (photos.length === 0) {
            this.photoListEl.innerHTML = `<div class="empty-state-text">Nenhuma foto de set cadastrada.</div>`;
            return;
        }

        photos.forEach(p => {
            const card = document.createElement("div");
            card.className = "photo-card";
            card.setAttribute("data-photo-id", p.id);
            
            const src = p.proxy_path || (p.filepath && (p.filepath.startsWith('http') || p.filepath.startsWith('/')) ? p.filepath : `/originals/${p.filename}`);
            const isRaw = p.filename.toLowerCase().match(/\.(arw|cr2|nef|dng|pef|raf|orf|rw2|raw)$/);
            
            let imgHtml = "";
            let clickEnabled = true;
            
            if (p.status === 'pending') {
                imgHtml = `
                    <div class="photo-placeholder-loading">
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        <span>Gerando Proxy...</span>
                    </div>
                `;
                if (isRaw) clickEnabled = false;
            } else if (p.status === 'error') {
                imgHtml = `
                    <div class="photo-placeholder-error">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>Falha no Proxy</span>
                    </div>
                `;
                if (isRaw) clickEnabled = false;
            } else {
                if (isRaw && !p.proxy_path) {
                    imgHtml = `
                        <div class="photo-placeholder-loading">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            <span>Processando RAW...</span>
                        </div>
                    `;
                    clickEnabled = false;
                } else {
                    imgHtml = `<img src="${src}" alt="${p.filename}" loading="lazy">`;
                }
            }
            
            card.innerHTML = `
                ${imgHtml}
                <button class="btn-photo-add-timeline" title="Adicionar à timeline (still)" style="position:absolute; top:4px; right:4px; width:22px; height:22px; border-radius:5px; border:none; background:rgba(6,182,212,0.9); color:#00141a; font-size:11px; cursor:pointer; z-index:3; display:none; align-items:center; justify-content:center;"><i class="fa-solid fa-plus"></i></button>
                <p title="${p.description || p.filename}">${p.description || p.filename}</p>
            `;

            if (clickEnabled) {
                card.style.cursor = "pointer";
                card.style.position = "relative";

                // Arrastar-e-soltar da foto para a timeline
                card.draggable = true;
                card.addEventListener("dragstart", (e) => {
                    e.dataTransfer.setData("application/x-capiau-media", JSON.stringify({ type: "photo", id: p.id }));
                    e.dataTransfer.effectAllowed = "copy";
                });

                // Botão "+" flutuante (aparece no hover) para adicionar à timeline
                const addBtn = card.querySelector(".btn-photo-add-timeline");
                if (addBtn) {
                    card.addEventListener("mouseenter", () => { addBtn.style.display = "flex"; });
                    card.addEventListener("mouseleave", () => { addBtn.style.display = "none"; });
                    addBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        if (window.TIMELINE_STATE) window.TIMELINE_STATE.addPhotoCut(p.id, {});
                    });
                }

                card.addEventListener("click", () => {
                    if (STATE.openPhotosInPlayer) {
                        STATE.activePhoto = p;
                    } else {
                        STATE.currentPhotoList = photos;
                        STATE.currentPhotoIndex = photos.indexOf(p);
                        this.openLightbox(p);
                    }
                });
            } else {
                card.style.cursor = "not-allowed";
                card.title = "Aguarde o processamento do arquivo RAW para visualizar.";
            }
            
            this.photoListEl.appendChild(card);
        });
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
        try {
            const response = await CapIAuAPI.request("/api/ingest/select-folder", { method: "POST" });
            if (response.status === "success" && response.path) {
                const triggerRes = await CapIAuAPI.request("/api/ingest/external", {
                    method: "POST",
                    body: JSON.stringify({
                        path: response.path,
                        project_id: STATE.currentProjectId
                    }),
                    headers: { "Content-Type": "application/json" }
                });
                alert("Ingestão in-place iniciada em background.");
                this.reloadData();
            }
        } catch (err) {
            alert("Erro ao importar pasta: " + err.message);
        }
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

    async triggerTranscribeAll() {
        if (confirm("Disparar transcrição AssemblyAI para todas as mídias não transcritas do projeto ativo?")) {
            try {
                await CapIAuAPI.transcribeAll(STATE.currentProjectId);
                if (window.logManager) {
                    window.logManager.log("ASR", "Disparada transcrição em lote (todos os depoimentos) via AssemblyAI.", "ACTION");
                }
                alert("Transcrição em lote disparada.");
            } catch (err) {
                if (window.logManager) {
                    window.logManager.log("ASR", `Falha ao disparar transcrição em lote: ${err.message}`, "ERROR");
                }
                alert("Erro ao disparar transcrição: " + err.message);
            }
        }
    }

    // Lightbox / Visualizador de Fotos
    openLightbox(photo) {
        if (!this.lightbox) return;
        this.currentLightboxPhoto = photo;
        this.lightbox.style.display = "flex";
        this.lightboxImg.src = photo.proxy_path ? photo.proxy_path : photo.filepath;
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
        
        // Carrega Rostos Rotulados
        this.loadLightboxFaces(photo.id);
    }

    closeLightbox() {
        if (this.lightbox) this.lightbox.style.display = "none";
        this.resetZoom();
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

    toggleZoom() {
        if (!this.lightboxImg) return;
        if (this.isPhotoZoomed) {
            this.resetZoom();
        } else {
            this.isPhotoZoomed = true;
            this.lightboxImg.style.transform = "scale(1.8)";
            this.lightboxImg.style.cursor = "zoom-out";
            if (this.btnZoomPhoto) this.btnZoomPhoto.innerHTML = '<i class="fa-solid fa-magnifying-glass-minus"></i>';
        }
    }

    resetZoom() {
        if (!this.lightboxImg) return;
        this.isPhotoZoomed = false;
        this.lightboxImg.style.transform = "scale(1)";
        this.lightboxImg.style.cursor = "zoom-in";
        if (this.btnZoomPhoto) this.btnZoomPhoto.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
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

    seekModalVideo(time) {
        const modalVideo = document.getElementById("interview-modal-video");
        if (modalVideo) {
            modalVideo.currentTime = time;
            modalVideo.play().catch(err => {
                console.warn("Play programmatic blocked:", err);
            });
        }
    }

    async openInterviewModal(video) {
        const modal = document.getElementById("interview-modal");
        if (!modal) return;
        
        modal.style.display = "flex";
        
        const titleEl = document.getElementById("interview-modal-title");
        const fileInfoEl = document.getElementById("interview-modal-file-info");
        const durInfoEl = document.getElementById("interview-modal-dur-info");
        const summaryEl = document.getElementById("interview-modal-summary");
        
        const friendlyTitle = getFriendlyTitle(video);
        if (titleEl) titleEl.textContent = friendlyTitle;
        if (fileInfoEl) fileInfoEl.textContent = `Arquivo: ${video.filename}`;
        if (durInfoEl) durInfoEl.textContent = `Duração: ${video.duration ? formatTimecode(video.duration) : "00:00:00:00"}`;
        
        if (summaryEl) {
            summaryEl.textContent = video.summary || video.description || "Nenhum metadado de IA gerado para este clipe.";
        }
        
        // Carrega o Vídeo no Player do Modal
        const modalVideo = document.getElementById("interview-modal-video");
        if (modalVideo) {
            let videoSrc = video.filepath || "";
            videoSrc = videoSrc.replace(/\\/g, "/");
            const isRemote = videoSrc.startsWith("http") || videoSrc.startsWith("/proxies/") || videoSrc.startsWith("/");
            
            if (video.proxy_path) {
                videoSrc = video.proxy_path.replace(/\\/g, "/");
            } else if (!isRemote) {
                videoSrc = `/originals/${video.filename}`;
            }
            
            console.log("Loading video in modal: filename =", video.filename, "proxy_path =", video.proxy_path, "resolved src =", videoSrc);
            
            modalVideo.src = videoSrc;
            modalVideo.muted = false;
            modalVideo.volume = 1.0;
            modalVideo.load();
        }
        
        // Inicializa Marcadores do Modal
        this.modalMarkerIn = null;
        this.modalMarkerOut = null;
        this.updateModalMarkersUI();
        
        this.interviewDialogueList = [];
        this.switchInterviewTab("tab-interview-index");
        
        const chaptersList = document.getElementById("interview-chapters-list");
        const themesList = document.getElementById("interview-themes-list");
        const wordsList = document.getElementById("interview-transcript-words");
        if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando índice...</div>`;
        if (themesList) themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando temas...</div>`;
        if (wordsList) wordsList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando transcrição...</div>`;
        
        try {
            const data = await CapIAuAPI.fetchTranscript(video.id);
            const dialogues = data.dialogues || [];
            this.interviewDialogueList = dialogues;
            
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
                                <div class="timeline-chapter-text">"${d.text.substring(0, 100)}${d.text.length > 100 ? '...' : ''}"</div>
                            `;
                            
                            item.querySelector(".timeline-chapter-time").addEventListener("click", () => {
                                this.seekModalVideo(d.start_time);
                            });
                            
                            chaptersList.appendChild(item);
                        }
                    });
                }
            }
            
            this.renderInterviewTranscript(dialogues, data.words || []);
            
        } catch(err) {
            console.warn("Sem transcrição para este vídeo:", err);
            if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Material não transcrito ou B-roll de bastidores.</div>`;
            if (wordsList) wordsList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Mídia de B-roll sem áudio transcrito.</div>`;
            
            if (video.video_type === "broll" || video.status === "analyzed") {
                if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Carregando frames de visão...</div>`;
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
                                    this.seekModalVideo(f.timestamp);
                                });
                                chaptersList.appendChild(item);
                            });
                        }
                    }
                } catch(e) {
                    if (chaptersList) chaptersList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Sem frames de visão processados.</div>`;
                }
            }
        }
        
        try {
            const themesData = await CapIAuAPI.fetchThemes(STATE.currentProjectId);
            const themes = themesData.themes || [];
            if (themesList) {
                themesList.innerHTML = "";
                let hasThemes = false;
                
                for (const theme of themes) {
                    const segsData = await CapIAuAPI.fetchThemeSegments(theme.id);
                    const segments = segsData.segments || [];
                    const matchingSegs = segments.filter(s => s.video_id === video.id);
                    
                    if (matchingSegs.length > 0) {
                        hasThemes = true;
                        
                        const card = document.createElement("div");
                        card.className = "interview-theme-card";
                        
                        let segsHtml = "";
                        matchingSegs.forEach(s => {
                            const timecode = formatTimecode(s.start_time || 0).substring(3, 11);
                            segsHtml += `
                                <div style="margin-top: 8px; padding-left: 8px; border-left: 2px solid var(--color-cyan); font-size: 11px;">
                                    <span class="timeline-chapter-time" style="padding: 1px 4px; font-size: 9px;" data-time="${s.start_time}">${timecode}</span>
                                    <span style="color: var(--text-secondary);">"${s.text_excerpt || ''}"</span>
                                </div>
                            `;
                        });
                        
                        card.innerHTML = `
                            <div class="interview-theme-title">${theme.title}</div>
                            <div class="interview-theme-desc">${theme.description || ''}</div>
                            ${segsHtml}
                        `;
                        
                        card.querySelectorAll(".timeline-chapter-time").forEach(btn => {
                            btn.addEventListener("click", () => {
                                const time = parseFloat(btn.dataset.time);
                                this.seekModalVideo(time);
                            });
                        });
                        
                        themesList.appendChild(card);
                    }
                }
                
                if (!hasThemes) {
                    themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Nenhum tema narrativo mapeado para este clipe.</div>`;
                }
            }
        } catch(err) {
            console.warn("Erro ao carregar temas:", err);
            if (themesList) themesList.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Erro ao processar temas narrativos.</div>`;
        }
    }

    renderInterviewTranscript(dialogues, words) {
        const container = document.getElementById("interview-transcript-words");
        if (!container) return;
        
        container.innerHTML = "";
        if (dialogues.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Sem transcrição disponível.</div>`;
            return;
        }
        
        dialogues.forEach((d, idx) => {
            const block = document.createElement("div");
            block.className = "interview-speech-block";
            
            const timecode = formatTimecode(d.start_time).substring(3, 11);
            
            let blockWords = [];
            if (words && words.length > 0) {
                blockWords = words.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
            }
            
            let speechContent = "";
            if (blockWords.length > 0) {
                speechContent = blockWords.map(w => {
                    return `<span class="interview-speech-word" data-start="${w.start_time}">${w.word}</span>`;
                }).join(" ");
            } else {
                speechContent = d.text.split(" ").map(w => {
                    return `<span class="interview-speech-word" data-start="${d.start_time}">${w}</span>`;
                }).join(" ");
            }
            
            block.innerHTML = `
                <div class="interview-speech-header">
                    <span style="color: var(--color-cyan); font-weight: 700;">${d.speaker_id}</span>
                    <span class="timeline-chapter-time" style="padding: 1px 4px; font-size: 9px;" data-time="${d.start_time}">${timecode}</span>
                </div>
                <div class="interview-speech-text">${speechContent}</div>
            `;
            
            block.querySelectorAll(".interview-speech-word, .timeline-chapter-time").forEach(el => {
                el.addEventListener("click", () => {
                    const time = parseFloat(el.dataset.start || el.dataset.time);
                    this.seekModalVideo(time);
                });
            });
            
            container.appendChild(block);
        });

        // Configuração de busca no transcrito
        const transcriptSearch = document.getElementById("interview-transcript-search");
        const searchCount = document.getElementById("interview-search-count");
        if (transcriptSearch) {
            // Remove listeners antigos re-criando o elemento ou limpando o input
            transcriptSearch.value = "";
            if (searchCount) searchCount.textContent = "";
            
            // Clone do input para limpar event listeners anteriores
            const newSearch = transcriptSearch.cloneNode(true);
            transcriptSearch.parentNode.replaceChild(newSearch, transcriptSearch);
            
            newSearch.addEventListener("input", () => {
                const query = newSearch.value.toLowerCase().trim();
                const blocks = container.querySelectorAll(".interview-speech-block");
                let matchesCount = 0;
                
                blocks.forEach(b => {
                    const text = b.querySelector(".interview-speech-text").textContent.toLowerCase();
                    const match = !query || text.includes(query);
                    b.style.display = match ? "flex" : "none";
                    if (match && query) {
                        matchesCount++;
                    }
                });
                
                const newSearchCount = document.getElementById("interview-search-count");
                if (newSearchCount) {
                    newSearchCount.textContent = query ? `${matchesCount} encontrados` : "";
                }
            });
        }
    }

    switchInterviewTab(tabId) {
        const header = document.getElementById("interview-tabs-header");
        if (header) {
            header.querySelectorAll(".tab-btn").forEach(btn => {
                if (btn.dataset.interviewTab === tabId) {
                    btn.classList.add("active");
                } else {
                    btn.classList.remove("active");
                }
            });
        }
        
        const modal = document.getElementById("interview-modal");
        if (modal) {
            modal.querySelectorAll(".interview-tab-content").forEach(content => {
                if (content.id === tabId) {
                    content.style.display = "flex";
                } else {
                    content.style.display = "none";
                }
            });
        }
    }

    copyInterviewNotes(video) {
        if (!video) return;
        
        let markdown = `# Notas de Decupagem: ${video.filename}\n\n`;
        markdown += `**Título**: ${getFriendlyTitle(video)}\n`;
        markdown += `**Duração**: ${video.duration ? formatTimecode(video.duration) : "00:00:00"}\n\n`;
        
        markdown += `## Resumo Executivo\n`;
        markdown += `${video.summary || video.description || "Nenhum resumo disponível."}\n\n`;
        
        if (this.interviewDialogueList && this.interviewDialogueList.length > 0) {
            markdown += `## Índice de Tempos e Falas\n`;
            let currentSpeaker = null;
            let lastChapterTime = -100;
            this.interviewDialogueList.forEach(d => {
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
            .then(() => alert("Notas de decupagem copiadas em Markdown para a área de transferência!"))
            .catch(err => alert("Erro ao copiar notas: " + err));
    }

    markModalIn() {
        const modalVideo = document.getElementById("interview-modal-video");
        if (!modalVideo) return;
        this.modalMarkerIn = modalVideo.currentTime;
        this.updateModalMarkersUI();
    }

    markModalOut() {
        const modalVideo = document.getElementById("interview-modal-video");
        if (!modalVideo) return;
        this.modalMarkerOut = modalVideo.currentTime;
        this.updateModalMarkersUI();
    }

    updateModalMarkersUI() {
        const lblIn = document.getElementById("lbl-interview-modal-in");
        const lblOut = document.getElementById("lbl-interview-modal-out");
        if (lblIn) {
            lblIn.textContent = this.modalMarkerIn !== null ? formatTimecode(this.modalMarkerIn).substring(3, 11) : "00:00:00";
        }
        if (lblOut) {
            lblOut.textContent = this.modalMarkerOut !== null ? formatTimecode(this.modalMarkerOut).substring(3, 11) : "00:00:00";
        }
    }

    appendModalToTimeline(video) {
        if (!video) return;
        const modalVideo = document.getElementById("interview-modal-video");
        const inTime = this.modalMarkerIn !== null ? this.modalMarkerIn : 0.0;
        const outTime = this.modalMarkerOut !== null ? this.modalMarkerOut : (modalVideo ? modalVideo.duration : 0.0);
        
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
        
        this.modalMarkerIn = null;
        this.modalMarkerOut = null;
        this.updateModalMarkersUI();
    }

    async setModalThumbnail(video) {
        if (!video) return;
        const modalVideo = document.getElementById("interview-modal-video");
        if (!modalVideo) return;
        
        const timestamp = modalVideo.currentTime;
        try {
            const response = await fetch(`/api/video/${video.id}/thumbnail?timestamp=${timestamp}`, {
                method: "POST"
            });
            if (response.ok) {
                alert("Miniatura física atualizada com o frame atual do modal!");
                // Força a atualização da lista na biblioteca
                STATE.emit("videosUpdated", STATE.allVideos);
            } else {
                const err = await response.json();
                alert("Erro ao definir miniatura: " + (err.detail || "Desconhecido"));
            }
        } catch (e) {
            alert("Erro de rede ao salvar miniatura.");
        }
    }
}

