// Gerenciador visual da Biblioteca de Mídias, árvore de pastas e lightbox de fotos.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

// Armazena o estado das pastas expandidas/recolhidas
const openFoldersSet = new Set();

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
                <button class="btn-folder-action" data-action="expand" data-tooltip="Expandir todas as subpastas">
                    <i data-lucide="chevrons-down"></i>
                </button>
                <button class="btn-folder-action" data-action="collapse" data-tooltip="Recolher todas as subpastas">
                    <i data-lucide="chevrons-up"></i>
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
        const card = document.createElement("div");
        card.className = "media-card tree-file-item";
        card.setAttribute("data-video-id", v.id);
        card.style.paddingLeft = `${depth * 10 + 10}px`;
        if (STATE.activeVideo && STATE.activeVideo.id === v.id) card.classList.add("active");
        
        const badgeClass = v.video_type === "interview" ? "tag-interview" : "tag-broll";
        const badgeLabel = v.video_type === "interview" ? "Fala ASR" : "Bastidores";
        
        let statusGlow = "";
        let statusBadge = "";
        let actionBtn = "";
        
        const isConverting = STATE.activeConversions && STATE.activeConversions[v.id];
        
        if (v.status === "transcribing" || v.status === "processing") {
            if (isConverting) {
                statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Convertendo... <i data-lucide="loader-2" class="animate-spin" style="width: 10px; height: 10px;"></i></span>`;
                actionBtn = `<button class="btn-card-action" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" data-tooltip="Cancelar Conversão"><i data-lucide="square"></i></button>`;
            } else {
                statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Transcrevendo... <i data-lucide="loader-2" class="animate-spin" style="width: 10px; height: 10px;"></i></span>`;
                actionBtn = ``;
            }
        } else if (v.status === "analyzing") {
            statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-violet); margin-left: 4px;">Analisando... <i data-lucide="loader-2" class="animate-spin" style="width: 10px; height: 10px;"></i></span>`;
            actionBtn = `<button class="btn-card-action" onclick="event.stopPropagation(); window.cancelConversion(${v.id})" data-tooltip="Cancelar Análise"><i data-lucide="square"></i></button>`;
        } else if (v.status === "transcribed") {
            statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3); margin-left: 4px;">ASR</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i data-lucide="trash-2"></i></button>`;
        } else if (v.status === "analyzed") {
            statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-violet); border-color: rgba(138, 92, 246, 0.3); margin-left: 4px;">VISÃO</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i data-lucide="trash-2"></i></button>`;
        } else if (v.status === "ingested") {
            actionBtn = `<button class="btn-card-action btn-hover-only" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Deletar Proxy"><i data-lucide="trash-2"></i></button>`;
        } else if (v.status === "error") {
            statusGlow = `<i data-lucide="alert-triangle" style="color: var(--color-rose); width: 10px; height: 10px; margin-left: 4px;" data-tooltip="Erro no processamento!"></i>`;
            actionBtn = `<button class="btn-card-action" onclick="event.stopPropagation(); window.deleteProxy(${v.id})" data-tooltip="Limpar Vídeo/Proxy"><i data-lucide="trash-2"></i></button>`;
        }
        
        card.innerHTML = `
            <div class="media-thumbnail" style="width:30px; height:22px; font-size:10px; flex-shrink:0;">
                <i class="fa-solid ${v.video_type === 'interview' ? 'fa-microphone-lines' : 'fa-film'}"></i>
            </div>
            <div class="media-info" style="display:flex; flex-direction:column; gap:1px; flex:1; min-width:0;">
                <h4 style="display:flex; align-items:center; width:100%; justify-content:space-between; margin:0; font-size:12px;">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${v.filename}">${v.filename}</span>
                    ${actionBtn}
                </h4>
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%; font-size:10px;">
                    <span>${v.duration ? formatTimecode(v.duration) : "00:00:00"} ${statusGlow}${statusBadge}</span>
                    <span class="badge-tag ${badgeClass}" style="margin:0; float:none; font-size:8px; padding:1px 3px;">${badgeLabel}</span>
                </div>
            </div>
        `;
        
        card.addEventListener("click", () => {
            STATE.activeVideo = v;
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
        this.btnTranscribeAll = document.getElementById("btn-transcribe-all");
        this.btnImportExternal = document.getElementById("btn-import-external");
        this.btnAddMedia = document.getElementById("btn-add-media");
        this.btnOpenProxies = document.getElementById("btn-open-proxies");
        this.btnRetryFailed = document.getElementById("btn-retry-failed");
        this.btnReloadLibrary = document.getElementById("btn-reload-library");
        
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

        if (this.btnScan) this.btnScan.addEventListener("click", () => this.triggerScan());
        if (this.btnTranscribeAll) this.btnTranscribeAll.addEventListener("click", () => this.triggerTranscribeAll());
        if (this.btnImportExternal) this.btnImportExternal.addEventListener("click", () => this.triggerImportExternal());
        if (this.btnAddMedia) this.btnAddMedia.addEventListener("click", () => this.triggerImportExternal());
        if (this.btnOpenProxies) this.btnOpenProxies.addEventListener("click", () => this.triggerOpenProxies());
        if (this.btnRetryFailed) this.btnRetryFailed.addEventListener("click", () => this.triggerRetryFailed());
        if (this.btnReloadLibrary) this.btnReloadLibrary.addEventListener("click", () => this.reloadData());

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

        const btnAnalyzePhotoVision = document.getElementById("btn-analyze-photo-vision");
        if (btnAnalyzePhotoVision) {
            btnAnalyzePhotoVision.addEventListener("click", async () => {
                const list = STATE.currentPhotoList;
                const idx = STATE.currentPhotoIndex;
                if (!list || idx === -1 || idx >= list.length) return;
                const photo = list[idx];
                if (!photo) return;
                
                STATE.emit("statusChanged", { text: `Analisando foto: ${photo.filename}...`, active: true });
                try {
                    await CapIAuAPI.analyzePhotoVision(photo.id);
                    alert("Análise visual da foto de set iniciada em background!");
                    this.reloadData();
                } catch (err) {
                    console.error(err);
                    alert("Erro ao disparar análise visual: " + err);
                    STATE.emit("statusChanged", { text: `Erro ao analisar foto ${photo.filename}.`, active: false });
                }
            });
        }

        document.addEventListener("keydown", (e) => {
            if (this.lightbox && this.lightbox.style.display === "flex") {
                if (e.key === "ArrowLeft") this.navigatePhoto(-1);
                if (e.key === "ArrowRight") this.navigatePhoto(1);
                if (e.key === "Escape") this.closeLightbox();
            }
        });
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
                <button class="btn-card-action" onclick="window.deleteDocument(${doc.id})" data-tooltip="Deletar Documento"><i data-lucide="trash-2"></i></button>
            `;
            
            this.docsListEl.appendChild(card);
        });
        if (window.initLucide) window.initLucide();
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
        if (window.initLucide) window.initLucide();
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
                <p title="${p.description || p.filename}">${p.description || p.filename}</p>
            `;
            
            if (clickEnabled) {
                card.style.cursor = "pointer";
                card.addEventListener("click", () => {
                    STATE.currentPhotoList = photos;
                    STATE.currentPhotoIndex = photos.indexOf(p);
                    this.openLightbox(p);
                });
            } else {
                card.style.cursor = "not-allowed";
                card.title = "Aguarde o processamento do arquivo RAW para visualizar.";
            }
            
            this.photoListEl.appendChild(card);
        });
        if (window.initLucide) window.initLucide();
    }

    async triggerScan() {
        STATE.emit("statusChanged", { text: "Varrendo pasta watch/ para catalogar...", active: true });
        try {
            await CapIAuAPI.request(`/api/ingest/scan?project_id=${STATE.currentProjectId}`, { method: "POST" });
            alert("Varredura iniciada! Coloque arquivos em 'watch/' para catalogação automática.");
            STATE.emit("statusChanged", { text: "Varredura watch/ concluída.", active: false });
            this.reloadData();
        } catch(err) {
            console.error(err);
            alert("Erro ao disparar varredura: " + err);
            STATE.emit("statusChanged", { text: "Erro na varredura watch/.", active: false });
        }
    }

    async triggerImportExternal() {
        try {
            const response = await CapIAuAPI.selectFolder();
            if (response.status === "success" && response.path) {
                STATE.emit("statusChanged", { text: "Iniciando Ingestão Externa...", active: true });
                await CapIAuAPI.triggerExternalIngest(response.path, STATE.currentProjectId);
                alert("Ingestão in-place iniciada em background.");
                this.reloadData();
            }
        } catch (err) {
            console.error(err);
            alert("Erro ao importar pasta externa: " + err);
        }
    }

    async triggerOpenProxies() {
        try {
            await CapIAuAPI.openProxiesFolder();
            STATE.emit("statusChanged", { text: "Pasta de proxies aberta.", active: false });
        } catch (err) {
            console.error(err);
            alert("Erro ao abrir pasta de proxies: " + err);
        }
    }

    async triggerRetryFailed() {
        try {
            STATE.emit("statusChanged", { text: "Iniciando reprocessamento de falhas...", active: true });
            const response = await CapIAuAPI.retryFailedConversions(STATE.currentProjectId);
            alert(`Reiniciando conversão de ${response.count || 0} proxies falhos ou ausentes em background!`);
            STATE.emit("statusChanged", { text: `Reiniciadas ${response.count || 0} conversões falhas.`, active: false });
            this.reloadData();
        } catch (err) {
            console.error(err);
            alert("Erro ao reprocessar falhas: " + err);
        }
    }

    async triggerTranscribeAll() {
        if (confirm("Disparar transcrição AssemblyAI para todas as mídias não transcritas do projeto ativo?")) {
            await CapIAuAPI.transcribeAll(STATE.currentProjectId);
            alert("Transcrição em lote disparada.");
        }
    }

    // Lightbox / Visualizador de Fotos
    openLightbox(photo) {
        if (!this.lightbox) return;
        this.lightbox.style.display = "flex";
        this.lightboxImg.src = photo.proxy_path ? photo.proxy_path : photo.filepath;
        this.lightboxTitle.textContent = photo.filename;
        this.lightboxDesc.textContent = photo.description || "Sem descrição gerada por IA.";
        
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
                        await CapIAuAPI.labelFace(face.id, trimmedName);
                        this.loadLightboxFaces(photoId);
                    }
                });
                
                this.lightboxFaces.appendChild(faceDiv);
            });
        } catch (e) {
            console.error("Erro ao carregar rostos do lightbox:", e);
        }
    }
}
