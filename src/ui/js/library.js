// Gerenciador visual da Biblioteca de Mídias, árvore de pastas e lightbox de fotos.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { FaceManager } from "./faces.js";
import { parseQuery, evaluateAST, getAvailableSuggestions } from "./searchParser.js";

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

function hasMatchingChildren(node, query, ast = null) {
    if (!query) return true;
    if (!ast) ast = parseQuery(query);
    if (!ast) return true;
    
    if (node.type === "file") {
        return evaluateAST(ast, node.video, "tab-videos");
    }
    if (node.type === "folder") {
        return Object.values(node.children).some(child => hasMatchingChildren(child, query, ast));
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

function buildTree(items, mediaKey = "video") {
    if (!items) return { name: "Biblioteca", type: "folder", path: "root", children: {}, isRoot: true, isOpen: true };
    const filepaths = items.map(v => (v.filepath || v.filename || "").replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    const root = {
        name: commonBase ? commonBase.split("/").filter(Boolean).pop() || commonBase : "Biblioteca",
        type: "folder",
        path: "root",
        children: {},
        isRoot: true,
        isOpen: true
    };
    
    items.forEach(v => {
        const normalized = (v.filepath || v.filename || "").replace(/\\/g, "/");
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
        const fileNode = {
            name: fileName,
            type: "file"
        };
        fileNode[mediaKey] = v;
        current.children[fileName] = fileNode;
    });
    
    return root;
}

function formatTimecode(sec) {
    if (isNaN(sec)) return "00:00:00:00";
    const fpsVal = window.TIMELINE_STATE?.fps || 24;
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const frames = Math.floor((sec % 1) * fpsVal);
    
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
        
        const savedSort = localStorage.getItem("library_sort_by");
        const sortSelect = document.getElementById("library-sort-by");
        if (sortSelect && savedSort && sortSelect.value !== savedSort) {
            sortSelect.value = savedSort;
        }
        const sortBy = sortSelect?.value || savedSort || "name_asc";
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
        
        sortedKeys.forEach(key => {
            renderTreeNode(node.children[key], folderChildren, depth + 1);
        });
        
        container.appendChild(folderDiv);
    } else if (node.type === "file" && node.video) {
        const v = node.video;
        
        // Verifica se corresponde ao filtro de busca
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.trim() : "";
        
        const friendlyTitle = getFriendlyTitle(v);
        const forceRealFilename = window.titleDisplayPreferences && window.titleDisplayPreferences[v.id] === "filename";
        const currentTitle = forceRealFilename ? v.filename : friendlyTitle;
        
        if (query) {
            const ast = parseQuery(query);
            if (ast && !evaluateAST(ast, v, "tab-videos")) {
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
        const categoryLabel = v.category ? (CATEGORY_LABELS[v.category] || v.category) : (v.video_type === 'interview' ? 'Entrevista' : 'B-roll');
        const tooltip = `Título: ${friendlyTitle}\nArquivo: ${v.filename}\nCategoria: ${categoryLabel}\nDescrição: ${v.description || v.summary || 'Sem decupagem'}`;

        card.innerHTML = `
            <div class="media-thumbnail" style="position: relative;">
                ${thumbContent}
                <button class="btn-select-similar-item" title="Selecionar para busca por similaridade" style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border: none; background: rgba(0,0,0,0.6); color: var(--text-muted); font-size: 10px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 3px; z-index: 10;">
                    <i class="fa-regular fa-square"></i>
                </button>
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
        
        card.addEventListener("click", () => {
            STATE.activeVideo = v;
            window.activeFocusedPlayer = "source";
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
    } else if (node.type === "file" && node.photo) {
        const p = node.photo;
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.trim() : "";
        if (query) {
            const ast = parseQuery(query);
            if (ast && !evaluateAST(ast, p, "tab-photos")) {
                return;
            }
        }
        
        const card = document.createElement("div");
        card.className = "media-card tree-file-item photo-item";
        card.setAttribute("data-photo-id", p.id);
        card.style.paddingLeft = "6px";
        if (STATE.activePhoto && STATE.activePhoto.id === p.id) card.classList.add("active");
        
        const src = p.proxy_path || (p.filepath && (p.filepath.startsWith('http') || p.filepath.startsWith('/')) ? p.filepath : `/originals/${p.filename}`);
        const isRaw = p.filename.toLowerCase().match(/\.(arw|cr2|nef|dng|pef|raf|orf|rw2|raw)$/);
        
        let imgHtml = "";
        let clickEnabled = true;
        let statusBadge = "";
        let statusGlow = "";
        
        if (p.status === 'pending') {
            statusGlow = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);" title="Gerando Proxy..."></i>`;
            imgHtml = `<div class="photo-placeholder-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Proxy...</span></div>`;
            if (isRaw) clickEnabled = false;
        } else if (p.status === 'error') {
            statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);" title="Falha no Proxy"></i>`;
            imgHtml = `<div class="photo-placeholder-error"><i class="fa-solid fa-triangle-exclamation"></i><span>Erro</span></div>`;
            if (isRaw) clickEnabled = false;
        } else {
            if (isRaw && !p.proxy_path) {
                statusGlow = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);" title="Processando RAW..."></i>`;
                imgHtml = `<div class="photo-placeholder-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>RAW...</span></div>`;
                clickEnabled = false;
            } else {
                imgHtml = `<img src="${src}" alt="${p.filename}" loading="lazy">`;
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
        const toggleBtnHtml = `<button class="btn-toggle-filename" title="${toggleTitleTitle}"><i class="fa-solid ${toggleTitleIcon}"></i></button>`;

        const categoryLabel = p.category ? p.category : 'Foto';
        const tooltip = `Título: ${friendlyTitle}\nArquivo: ${p.filename}\nCategoria: ${categoryLabel}\nDescrição: ${p.description || 'Sem decupagem'}`;
        
        card.innerHTML = `
            <div class="media-thumbnail photo-thumb-container" style="position: relative;">
                ${imgHtml}
                <button class="btn-select-similar-item" title="Selecionar para busca por similaridade" style="position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border: none; background: rgba(0,0,0,0.6); color: var(--text-muted); font-size: 10px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 3px; z-index: 10;">
                    <i class="fa-regular fa-square"></i>
                </button>
            </div>
            <div class="media-info">
                <h4 title="${tooltip}">
                    ${toggleBtnHtml}
                    <span class="clip-title-text">${currentTitle}</span>
                </h4>
                <div class="media-meta-row">
                    ${statusGlow}
                    ${statusBadge}
                    <span class="badge-tag tag-broll">${categoryLabel}</span>
                    <button class="btn-photo-add-timeline btn-card-action" title="Adicionar à timeline (still)"><i class="fa-solid fa-plus"></i></button>
                    <button class="btn-photo-similar btn-card-action" title="Encontrar similares"><i class="fa-solid fa-images"></i></button>
                </div>
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
        
        if (clickEnabled) {
            card.style.cursor = "pointer";
            card.draggable = true;
            card.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("application/x-capiau-media", JSON.stringify({ type: "photo", id: p.id }));
                e.dataTransfer.effectAllowed = "copy";
            });
            card.addEventListener("click", () => {
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
    function processItems(items) {
        if (!items || items.length === 0) return;
        const filepaths = items.map(item => (item.filepath || item.filename || "").replace(/\\/g, "/"));
        const commonBase = getCommonBasePath(filepaths);
        
        items.forEach(item => {
            const normalized = (item.filepath || item.filename || "").replace(/\\/g, "/");
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
    }

    processItems(STATE.allVideos);
    processItems(STATE.allPhotos);

    if (STATE.allVideos) STATE.emit("videosUpdated", STATE.allVideos);
    if (STATE.allPhotos) STATE.emit("photosUpdated", STATE.allPhotos);
};

window.expandCollapseAllSubfolders = function(folderPath, expand) {
    function processItems(items) {
        if (!items || items.length === 0) return;
        const filepaths = items.map(item => (item.filepath || item.filename || "").replace(/\\/g, "/"));
        const commonBase = getCommonBasePath(filepaths);
        
        items.forEach(item => {
            const normalized = (item.filepath || item.filename || "").replace(/\\/g, "/");
            const relative = commonBase ? normalized.substring(commonBase.length) : normalized;
            const parts = relative.split("/").filter(Boolean);
            
            let currentPath = "root";
            for (let i = 0; i < parts.length - 1; i++) {
                currentPath = currentPath + "/" + parts[i];
                if (currentPath === folderPath || currentPath.startsWith(folderPath + "/")) {
                    if (expand) {
                        openFoldersSet.add(currentPath);
                    } else {
                        openFoldersSet.delete(currentPath);
                    }
                }
            }
        });
    }

    processItems(STATE.allVideos);
    processItems(STATE.allPhotos);
    
    if (STATE.allVideos) STATE.emit("videosUpdated", STATE.allVideos);
    if (STATE.allPhotos) STATE.emit("photosUpdated", STATE.allPhotos);
};

export class LibraryManager {
    constructor() {
        window.libraryInstance = this;
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
        STATE.on("projectChanged", () => { this.reloadData(); this.loadTriageReviewThreshold(); });
        this.loadTriageReviewThreshold();
        STATE.on("leftTabChanged", (tabId) => this.updateSearchPlaceholder(tabId));
        STATE.on("activeVideoChanged", (video) => {
            document.querySelectorAll(".media-card.tree-file-item:not(.photo-item)").forEach(el => {
                if (video && el.getAttribute("data-video-id") == video.id) {
                    el.classList.add("active");
                } else {
                    el.classList.remove("active");
                }
            });
        });
        STATE.on("activePhotoChanged", (photo) => {
            document.querySelectorAll("[data-photo-id]").forEach(el => {
                if (photo && el.getAttribute("data-photo-id") == photo.id) {
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
        
        const videoList = this.videoListEl || document.getElementById("video-list");
        const photoList = this.photoListEl || document.getElementById("photo-list");
        
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
            if (videoList) {
                if (mode === "grid") videoList.classList.add("view-mode-grid");
                else videoList.classList.remove("view-mode-grid");
            }
            if (photoList) {
                if (mode === "grid") photoList.classList.add("view-mode-grid");
                else photoList.classList.remove("view-mode-grid");
            }
            if (mode === "grid") {
                if (btnViewModeGrid) btnViewModeGrid.classList.add("active");
                if (btnViewModeList) btnViewModeList.classList.remove("active");
            } else {
                if (btnViewModeList) btnViewModeList.classList.add("active");
                if (btnViewModeGrid) btnViewModeGrid.classList.remove("active");
            }
            localStorage.setItem("lib-pref-view-mode", mode);
            if (STATE.allPhotos) STATE.emit("photosUpdated", STATE.allPhotos);
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
            if (videoList) {
                videoList.style.setProperty("--thumb-width", `${val}px`);
                videoList.style.setProperty("--thumb-height", `${Math.round(val * 9 / 16)}px`);
            }
            if (photoList) {
                photoList.style.setProperty("--thumb-width", `${val}px`);
                photoList.style.setProperty("--thumb-height", `${Math.round(val * 3 / 4)}px`);
            }
            if (zoomLabel) zoomLabel.textContent = `${val}px`;
            if (zoomSlider) zoomSlider.value = val;
            localStorage.setItem("lib-pref-zoom", val);
        }
        
        if (zoomSlider) {
            zoomSlider.addEventListener("input", (e) => {
                setZoomValue(parseInt(e.target.value));
            });
            zoomSlider.addEventListener("dblclick", () => {
                setZoomValue(80);
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
                // Sincroniza o botão cíclico de status se o texto de busca for alterado
                if (this._btnStatusCycle && this._statusSelect) {
                    const query = searchInput.value;
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

                // 1. Update Videos tab
                STATE.emit("videosUpdated", STATE.allVideos);
                
                // 2. Update Photos tab
                STATE.emit("photosUpdated", STATE.allPhotos);
                
                // 3. Update Docs tab
                if (this.allDocuments) {
                    this.renderDocuments(this.allDocuments);
                }
                
                // 4. Update Themes tab
                if (window.panelsManager && typeof window.panelsManager.renderThemesList === 'function') {
                    window.panelsManager.renderThemesList();
                }
                
                // 5. Update Faces tab
                if (window.FaceManager && typeof window.FaceManager.renderFaceClusters === 'function') {
                    window.FaceManager.renderFaceClusters();
                }
            });
        }

        // Atalho 'a' ou 'A' para abrir o Inspetor de Mídia no lugar do modal
        document.addEventListener("keydown", (e) => {
            const activeTag = document.activeElement.tagName;
            if (activeTag === "INPUT" || activeTag === "TEXTAREA" || document.activeElement.isContentEditable) {
                return; // Ignora se o usuário estiver em um input
            }
            
            if (e.key.toLowerCase() === 'a') {
                if (window.activeFocusedPlayer === "program") {
                    return; // Let the timeline handle it
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
            case "tab-videos":
                searchInput.placeholder = "Buscar mídias...";
                break;
            case "tab-photos":
                searchInput.placeholder = "Buscar fotos...";
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
        const tabId = this.currentTabId || "tab-videos";
        if (tabId === "tab-videos") {
            options = [
                { value: "tipo", label: "Tipo (fala/bastidores)" },
                { value: "status", label: "Status (pendente/asr/visao/erro)" },
                { value: "cat", label: "Categoria (obra/processo...)" },
                { value: "duracao", label: "Duração (segundos)" },
                { value: "tag", label: "Tag" },
                { value: "fps", label: "FPS" },
                { value: "res", label: "Resolução" }
            ];
        } else if (tabId === "tab-photos") {
            options = [
                { value: "status", label: "Status (pendente/processado/erro)" },
                { value: "tag", label: "Tag" },
                { value: "formato", label: "Formato (raw/jpg)" }
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
        
        const tabId = this.currentTabId || "tab-videos";
        let items = [];
        if (tabId === "tab-videos") items = STATE.allVideos || [];
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
            
            const tabId = this.currentTabId || "tab-videos";
            let items = [];
            if (tabId === "tab-videos") items = STATE.allVideos || [];
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
            this.allDocuments = docs;
            this.renderDocuments(docs);
        } catch (e) {
            this.docsListEl.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
        }
    }

    renderDocuments(docs) {
        if (!this.docsListEl) return;
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

    /**
     * Revela um vídeo na biblioteca (aba Mídias): abre a aba de vídeos, expande as
     * pastas ancestrais no tree, seleciona o card, rola até ele e dá um pulso visual.
     * Usado pelo clique numa tarefa. Retorna false se o vídeo não estiver na biblioteca.
     */
    revealVideoById(videoId) {
        const video = (STATE.allVideos || []).find(v => v.id === videoId);
        if (!video) return false;

        // Abre a aba de vídeos na sidebar esquerda
        const tabBtn = document.querySelector('.sidebar-left .tab-btn[data-tab="tab-videos"]');
        if (tabBtn) tabBtn.click();

        // Expande as pastas ancestrais do arquivo (mesmo cálculo do buildTree)
        try {
            const filepaths = STATE.allVideos.map(v => v.filepath.replace(/\\/g, "/"));
            const commonBase = getCommonBasePath(filepaths);
            const normalized = video.filepath.replace(/\\/g, "/");
            const relative = commonBase ? normalized.substring(commonBase.length) : normalized;
            const parts = relative.split("/").filter(Boolean);
            let currentPath = "root";
            for (let i = 0; i < parts.length - 1; i++) {
                currentPath = currentPath + "/" + parts[i];
                openFoldersSet.add(currentPath);
            }
        } catch (e) {
            console.warn("Não foi possível calcular as pastas ancestrais:", e);
        }

        // Re-renderiza a árvore já com as pastas abertas e destaca a seleção
        this.renderVideos(STATE.allVideos);
        STATE.activeVideo = video;

        requestAnimationFrame(() => {
            const card = document.querySelector(`.media-card.tree-file-item[data-video-id="${videoId}"]`);
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

        const tabBtn = document.querySelector('.sidebar-left .tab-btn[data-tab="tab-photos"]');
        if (tabBtn) tabBtn.click();
        STATE.activePhoto = photo;

        requestAnimationFrame(() => {
            const card = document.querySelector(`[data-photo-id="${photoId}"]`);
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

    renderVideos(videos) {
        if (!this.videoListEl) return;
        this.videoListEl.innerHTML = "";
        
        if (videos.length === 0) {
            this.videoListEl.innerHTML = `<div class="empty-state-text">Nenhuma mídia encontrada na pasta watch/</div>`;
            return;
        }

        const tree = buildTree(videos, "video");
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
        
        if (!photos || photos.length === 0) {
            this.photoListEl.innerHTML = `<div class="empty-state-text">Nenhuma foto de set cadastrada.</div>`;
            return;
        }

        // Apply search input query filter
        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.trim() : "";
        
        let filtered = photos;
        if (query) {
            const ast = parseQuery(query);
            if (ast) {
                filtered = photos.filter(p => evaluateAST(ast, p, "tab-photos"));
            }
        }
        
        if (filtered.length === 0) {
            this.photoListEl.innerHTML = `<div class="empty-state-text">Nenhuma foto encontrada.</div>`;
            return;
        }

        // Apply sort
        const savedSort = localStorage.getItem("library_sort_by") || "name_asc";
        const sortSelect = document.getElementById("library-sort-by");
        const sortBy = sortSelect?.value || savedSort;

        filtered = [...filtered].sort((pA, pB) => {
            if (sortBy === "name_asc") {
                return (pA.title || pA.filename || "").localeCompare(pB.title || pB.filename || "");
            } else if (sortBy === "name_desc") {
                return (pB.title || pB.filename || "").localeCompare(pA.title || pA.filename || "");
            } else if (sortBy === "type_interview" || sortBy === "type_broll") {
                const catA = pA.category || "";
                const catB = pB.category || "";
                if (catA !== catB) return catA.localeCompare(catB);
                return (pA.filename || "").localeCompare(pB.filename || "");
            } else if (sortBy === "duration_desc" || sortBy === "date_desc") {
                return (pB.id || 0) - (pA.id || 0);
            }
            return (pA.filename || "").localeCompare(pB.filename || "");
        });

        const tree = buildTree(filtered, "photo");
        if (tree.isRoot && tree.name === "Biblioteca") {
            Object.keys(tree.children).forEach(key => {
                renderTreeNode(tree.children[key], this.photoListEl, 0);
            });
        } else {
            renderTreeNode(tree, this.photoListEl, 0);
        }
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
            btnSetThumb.addEventListener("click", () => {
                if (STATE.activeVideo) this.setInspectorThumbnail(STATE.activeVideo);
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
            const activeTag = document.activeElement.tagName.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || document.activeElement.isContentEditable) {
                return;
            }
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
        this.preInspectorActiveTab = activeTabBtn ? activeTabBtn.dataset.tab : "tab-videos";

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

        // Restaura a aba ativa que o usuário tinha antes de abrir o inspetor
        if (this.preInspectorActiveTab) {
            const tabBtn = document.querySelector(`.sidebar-left .tab-btn[data-tab="${this.preInspectorActiveTab}"]`);
            if (tabBtn) tabBtn.click();
        }

        // Faz scroll até o card do vídeo ativo na biblioteca
        if (STATE.activeVideo) {
            requestAnimationFrame(() => {
                const activeCard = document.querySelector(`.media-card.tree-file-item[data-video-id="${STATE.activeVideo.id}"]`);
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

    async setInspectorThumbnail(video) {
        if (!video) return;
        const sourceVideo = document.getElementById("source-video");
        if (!sourceVideo) return;
        
        const timestamp = sourceVideo.currentTime;
        try {
            const response = await fetch(`/api/video/${video.id}/thumbnail?timestamp=${timestamp}`, {
                method: "POST"
            });
            if (response.ok) {
                alert("Miniatura física atualizada com sucesso!");
                STATE.emit("videosUpdated", STATE.allVideos);
            } else {
                const err = await response.json();
                alert("Erro ao definir miniatura: " + (err.detail || "Desconhecido"));
            }
        } catch (e) {
            alert("Erro de rede ao salvar miniatura.");
        }
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
        const titleEl = document.getElementById("inspector-media-title");
        const statusBadge = document.getElementById("inspector-media-status-badge");
        const summaryEl = document.getElementById("inspector-summary");
        
        if (titleEl) titleEl.textContent = getFriendlyTitle(video);
        if (statusBadge) {
            statusBadge.textContent = video.status || "Pendente";
            statusBadge.style.color = video.status === "analyzed" ? "var(--color-emerald)" : "var(--text-secondary)";
        }
        if (summaryEl) {
            summaryEl.textContent = video.summary || video.description || "Nenhum resumo ou metadado gerado para esta mídia.";
        }

        // Categoria da triagem (E2.C2): dropdown de correção
        this.fillCategorySelect(document.getElementById("sel-inspector-category"), video.category);
        const catConfEl = document.getElementById("lbl-inspector-category-conf");
        if (catConfEl) catConfEl.textContent = this.categoryConfidenceLabel(video);

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

