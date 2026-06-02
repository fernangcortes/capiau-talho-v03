// ── MOCK DATA DE SEGURANÇA (Para testar o visual e funções imediatamente) ──
const MOCK_VIDEOS = [
    {
        id: 1,
        filename: "entrevista_diretor_makingof.mp4",
        filepath: "/proxies/proxy_vid_1.mp4",
        video_type: "interview",
        duration: 25.5,
        resolution: "1280x720 (Proxy)",
        status: "transcribed"
    },
    {
        id: 2,
        filename: "broll_bastidores_câmera_vfx.mp4",
        filepath: "/proxies/proxy_vid_2.mp4",
        video_type: "broll",
        duration: 15.0,
        resolution: "1280x720 (Proxy)",
        status: "analyzed"
    }
];

const MOCK_TRANSCRIPT_1 = [
    {
        speaker_id: "Diretor",
        start_time: 0.5,
        end_time: 6.8,
        text: "Olá, eu sou o diretor e escolhi usar lentes anamórficas para obter uma estética cinematográfica."
    },
    {
        speaker_id: "Diretor",
        start_time: 7.2,
        end_time: 14.5,
        text: "O making of de bastidores registra essa busca obsessiva pela iluminação dramática ideal."
    },
    {
        speaker_id: "Diretor",
        start_time: 15.0,
        end_time: 25.0,
        text: "Com 20 horas de gravação de entrevistas e B-rolls, o CapIAu nos ajuda a encontrar os melhores cortes instantaneamente."
    }
];

const MOCK_BROLL_2 = [
    { timestamp: 0.0, description: "Câmera Arri Alexa montada em um trilho de dolly sendo empurrada pelo set.", tags: ["câmera", "dolly", "set"] },
    { timestamp: 5.0, description: "Diretor de fotografia ajustando um painel de LED difusor próximo ao ator principal.", tags: ["luz", "fotografia", "set"] },
    { timestamp: 10.0, description: "Operador de câmera focando a lente anamórfica durante o ensaio da cena de ação.", tags: ["lente", "foco", "ação"] }
];

const MOCK_PHOTOS = [
    { id: 1, filename: "foto_set_1.jpg", filepath: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=300", description: "Diretor e ator ensaiando cena sob iluminação de tungstênio.", tags: ["diretor", "ator", "luz"] },
    { id: 2, filename: "foto_set_2.jpg", filepath: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?w=300", description: "Claquete de produção em primeiro plano com câmera desfocada ao fundo.", tags: ["claquete", "câmera", "set"] }
];

const MOCK_THEMES = [
    { id: 1, title: "Lentes Anamórficas & Estética", description: "Discussões sobre a escolha de lentes e enquadramentos para o visual clássico do cinema." },
    { id: 2, title: "Bastidores e Luz Dramática", description: "Iluminação especial do set e o trabalho do diretor de fotografia nos bastidores." }
];

// ── VARIÁVEIS DE ESTADO DA APLICAÇÃO ──────────────────────────────────
let currentProjectId = 1;
let activeVideo = null;
let activeTranscript = [];
let activeVisionFrames = [];
let currentRightTab = "transcript";
let activeTimelineCuts = [];
let markerIn = null;
let markerOut = null;
let allVideos = [];
const openFoldersSet = new Set();
let progressInterval = null;
let activeConversions = {};



// Variáveis para atalhos JKL
let playbackSpeed = 1.0;
let jklState = 'K'; // 'J' (retroceder), 'K' (pausado), 'L' (avançar)
let jklIndex = 0; // Índice de velocidade J ou L
const SPEEDS_FORWARD = [1.0, 1.5, 2.0, 4.0, 8.0];
const SPEEDS_REVERSE = [-1.0, -2.0, -4.0, -8.0];

// ── SELETORES DOM ───────────────────────────────────────────────────
const videoPlayer = document.getElementById("main-video");
const btnPlay = document.getElementById("btn-play");
const currentTimeEl = document.getElementById("current-time");
const durationTimeEl = document.getElementById("duration-time");
const scrubberFill = document.getElementById("scrubber-progress-fill");
const scrubberHandle = document.getElementById("scrubber-progress-handle");
const scrubberBar = document.getElementById("scrubber-progress-bar");
const videoTitleEl = document.getElementById("player-title");
const badgeType = document.getElementById("badge-type");
const badgeResolution = document.getElementById("badge-resolution");

const selectSpeed = document.getElementById("select-speed");
const selectResolution = document.getElementById("select-resolution");
const speedOverlay = document.getElementById("speed-overlay");
const jklOverlay = document.getElementById("jkl-overlay");

// Sidebars e Timeline
const sidebarLeft = document.getElementById("sidebar-left");
const sidebarRight = document.getElementById("sidebar-right");
const timelinePanel = document.getElementById("timeline-panel");

const toggleLeft = document.getElementById("toggle-left");
const toggleRight = document.getElementById("toggle-right");
const toggleTimeline = document.getElementById("toggle-timeline");

const reopenLeft = document.getElementById("reopen-left");
const reopenRight = document.getElementById("reopen-right");
const reopenTimeline = document.getElementById("reopen-timeline");

// Marcadores e Timeline Tracks
const btnMarkIn = document.getElementById("btn-mark-in");
const btnMarkOut = document.getElementById("btn-mark-out");
const btnAppend = document.getElementById("btn-append-timeline");
const markerInPos = document.getElementById("marker-in-pos");
const markerOutPos = document.getElementById("marker-out-pos");
const trackSpeech = document.getElementById("track-speech");
const trackBroll = document.getElementById("track-broll");

// Ingest, Search & Action buttons
const btnSearch = document.getElementById("btn-search");
const searchInput = document.getElementById("semantic-search-input");
const filterSelect = document.getElementById("search-filter");
const btnScan = document.getElementById("btn-scan");
const btnCluster = document.getElementById("btn-cluster");
const btnTranscribe = document.getElementById("btn-transcribe-now");
const btnTranscribeAll = document.getElementById("btn-transcribe-all");
const btnSaveTimeline = document.getElementById("btn-save-timeline");
const btnExportTimeline = document.getElementById("btn-export-timeline");

// ── INICIALIZAÇÃO DA APLICAÇÃO ────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
});

function initApp() {
    console.log("CapIAu iniciado.");
    setupProjectListeners();
    loadProjects();
    updateTimelineUI();
}

async function loadProjects() {
    updateSystemStatus("Carregando projetos...", true);
    const selector = document.getElementById("project-selector");
    selector.innerHTML = "<option value=''>Carregando...</option>";
    try {
        const response = await fetch("/api/projects");
        if (response.ok) {
            const projects = await response.json();
            if (projects.length > 0) {
                selector.innerHTML = "";
                projects.forEach(p => {
                    const opt = document.createElement("option");
                    opt.value = p.id;
                    opt.textContent = p.name;
                    selector.appendChild(opt);
                });
                
                // Se o projeto atual não existir mais na lista, seleciona o primeiro
                if (!projects.some(p => p.id === currentProjectId)) {
                    currentProjectId = projects[0].id;
                }
                selector.value = currentProjectId;
                
                await loadVideos();
                await loadPhotos();
                await loadThemes();
                updateSystemStatus("Projetos carregados com sucesso.");
                return;
            }
        }
    } catch (e) {
        console.warn("Backend offline ao carregar projetos. Carregando mock de projetos.");
    }
    
    // Fallback Mock
    selector.innerHTML = `
        <option value="1">Making Of MVP (Mock)</option>
        <option value="2">Projeto Curta B (Mock)</option>
    `;
    currentProjectId = 1;
    selector.value = "1";
    await loadVideos();
    await loadPhotos();
    await loadThemes();
    updateSystemStatus("Offline. Exibindo simulador (Mock).");
}

function setupProjectListeners() {
    const selector = document.getElementById("project-selector");
    const btnNew = document.getElementById("btn-new-project");
    const btnDelete = document.getElementById("btn-delete-project");
    const modal = document.getElementById("project-modal");
    const btnClose = document.getElementById("btn-close-project-modal");
    const btnCancel = document.getElementById("btn-cancel-project");
    const btnSubmit = document.getElementById("btn-submit-project");
    
    selector.addEventListener("change", (e) => {
        currentProjectId = parseInt(e.target.value);
        console.log(`Projeto selecionado: ID ${currentProjectId}`);
        
        // Limpar player e timeline ativa ao mudar de projeto
        activeVideo = null;
        activeTranscript = [];
        activeTimelineCuts = [];
        markerIn = null;
        markerOut = null;
        videoPlayer.src = "";
        videoPlayer.load(); // Libera locks de arquivos no Windows
        videoTitleEl.textContent = "Nenhuma mídia selecionada";
        badgeType.textContent = "-";
        badgeResolution.textContent = "-";
        if (markerInPos) markerInPos.style.display = "none";
        if (markerOutPos) markerOutPos.style.display = "none";
        document.getElementById("transcript-feed").innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-microphone-slash"></i>
                <p>Selecione um depoimento na Biblioteca para carregar a transcrição correspondente.</p>
            </div>
        `;
        
        loadVideos();
        loadPhotos();
        loadThemes();
        updateTimelineUI();
    });
    
    btnNew.addEventListener("click", () => {
        modal.classList.add("active");
        document.getElementById("project-name").value = "";
        document.getElementById("project-desc").value = "";
    });
    
    const closeModal = () => modal.classList.remove("active");
    btnClose.addEventListener("click", closeModal);
    btnCancel.addEventListener("click", closeModal);
    
    btnSubmit.addEventListener("click", async () => {
        const name = document.getElementById("project-name").value.trim();
        const desc = document.getElementById("project-desc").value.trim();
        
        if (!name) {
            alert("Por favor, preencha o Nome do Projeto!");
            return;
        }
        
        try {
            const response = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, description: desc })
            });
            if (response.ok) {
                const data = await response.json();
                closeModal();
                currentProjectId = data.project_id;
                await loadProjects(); // Recarregar e selecionar o novo projeto
                alert("Projeto criado e selecionado com sucesso!");
            } else {
                alert("Erro ao criar projeto.");
            }
        } catch (e) {
            closeModal();
            alert("Backend offline. Novo projeto simulado em cache!");
        }
    });
    
    btnDelete.addEventListener("click", async () => {
        if (!confirm("Tem certeza que deseja deletar este projeto? Isso apagará permanentemente todos os vídeos, fotos de set e timelines vinculados a ele!")) {
            return;
        }
        
        try {
            const response = await fetch(`/api/projects/${currentProjectId}`, {
                method: "DELETE"
            });
            if (response.ok) {
                alert("Projeto deletado com sucesso.");
                currentProjectId = 1;
                await loadProjects();
            } else {
                alert("Erro ao deletar projeto.");
            }
        } catch (e) {
            alert("Backend offline. Deleção de projeto simulada.");
        }
    });
}


// ── CONSUMO DE APIS BACKEND (Com fallback para Mocks se API offline) ──

async function loadVideos() {
    updateSystemStatus("Carregando mídias...", true);
    const listContainer = document.getElementById("video-list");
    listContainer.innerHTML = "<div class='loading'>Carregando mídias...</div>";
    
    try {
        const response = await fetch(`/api/videos?project_id=${currentProjectId}`);

        if (response.ok) {
            const data = await response.json();
            allVideos = data; // Armazena globalmente
            if (currentRightTab === "tasks") {
                renderRightPanelFeed(); // Atualiza a aba de tarefas em tempo real se ativa
            }
            if (data.length > 0) {
                renderVideos(data);
                updateSystemStatus("Mídias atualizadas.");
                return;
            }
        }
    } catch (e) {
        console.warn("Backend offline ou erro ao carregar vídeos. Carregando mock de segurança.");
    }
    renderVideos(MOCK_VIDEOS);
    updateSystemStatus("Pronto.");
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

function updateVideoCardDOM(v) {
    const card = document.querySelector(`.media-card[data-video-id="${v.id}"]`);
    if (!card) return;
    
    // Atualiza classes ativas
    if (activeVideo && activeVideo.id === v.id) {
        card.classList.add("active");
    } else {
        card.classList.remove("active");
    }
    
    const badgeClass = v.video_type === "interview" ? "tag-interview" : "tag-broll";
    const badgeLabel = v.video_type === "interview" ? "Fala ASR" : "Bastidores";
    
    let statusGlow = "";
    let statusBadge = "";
    let actionBtn = "";
    
    if (v.status === "transcribing" || v.status === "processing") {
        const isConverting = activeConversions && activeConversions[v.id];
        if (isConverting) {
            statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Convertendo... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
            actionBtn = `<button class="btn-card-action" style="color:var(--color-rose); margin-left:auto;" onclick="event.stopPropagation(); cancelConversion(${v.id})" title="Cancelar Conversão"><i class="fa-solid fa-circle-stop"></i></button>`;
        } else {
            statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Transcrevendo... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
            actionBtn = ``;
        }
    } else if (v.status === "analyzing") {
        statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-violet); margin-left: 4px;">Analisando... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
        actionBtn = `<button class="btn-card-action" style="color:var(--color-rose); margin-left:auto;" onclick="event.stopPropagation(); cancelConversion(${v.id})" title="Cancelar Análise"><i class="fa-solid fa-circle-stop"></i></button>`;
    } else if (v.status === "transcribed") {
        statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3); margin-left: 4px;">ASR</span>`;
        actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
    } else if (v.status === "analyzed") {
        statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-violet); border-color: rgba(138, 92, 246, 0.3); margin-left: 4px;">VISÃO</span>`;
        actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
    } else if (v.status === "ingested") {
        actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
    } else if (v.status === "error") {
        statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose); font-size: 10px; margin-left: 4px;" title="Erro no processamento!"></i>`;
        actionBtn = `<button class="btn-card-action" style="color:var(--text-secondary); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Limpar Vídeo/Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
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
            <i class="fa-solid ${chevron} chevron-icon" style="font-size:9px; margin-right:6px; color:var(--text-muted);"></i>
            <i class="fa-solid ${icon} folder-icon" style="color:var(--color-violet); margin-right:8px;"></i>
            <span class="folder-name">${node.name}</span>
        `;
        
        const folderChildren = document.createElement("div");
        folderChildren.className = "tree-folder-children";
        if (!node.isOpen) {
            folderChildren.style.display = "none";
        }
        
        folderHeader.addEventListener("click", (e) => {
            e.stopPropagation();
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
        
        // Renderizar filhos recursivamente (pastas primeiro, depois arquivos)
        const sortedKeys = Object.keys(node.children).sort((a, b) => {
            const nodeA = node.children[a];
            const nodeB = node.children[b];
            if (nodeA.type !== nodeB.type) {
                return nodeA.type === "folder" ? -1 : 1;
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
        if (activeVideo && activeVideo.id === v.id) card.classList.add("active");
        
        const badgeClass = v.video_type === "interview" ? "tag-interview" : "tag-broll";
        const badgeLabel = v.video_type === "interview" ? "Fala ASR" : "Bastidores";
        
        let statusGlow = "";
        let statusBadge = "";
        let actionBtn = "";
        
        if (v.status === "transcribing" || v.status === "processing") {
            const isConverting = activeConversions && activeConversions[v.id];
            if (isConverting) {
                statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Convertendo... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
                actionBtn = `<button class="btn-card-action" style="color:var(--color-rose); margin-left:auto;" onclick="event.stopPropagation(); cancelConversion(${v.id})" title="Cancelar Conversão"><i class="fa-solid fa-circle-stop"></i></button>`;
            } else {
                statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-cyan); margin-left: 4px;">Transcrevendo... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
                actionBtn = ``;
            }
        } else if (v.status === "analyzing") {
            statusGlow = `<span class="conversion-progress-text" style="font-size: 9px; color: var(--color-violet); margin-left: 4px;">Analisando... <i class="fa-solid fa-spinner fa-spin"></i></span>`;
            actionBtn = `<button class="btn-card-action" style="color:var(--color-rose); margin-left:auto;" onclick="event.stopPropagation(); cancelConversion(${v.id})" title="Cancelar Análise"><i class="fa-solid fa-circle-stop"></i></button>`;
        } else if (v.status === "transcribed") {
            statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-cyan); border-color: rgba(6, 182, 212, 0.3); margin-left: 4px;">ASR</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
        } else if (v.status === "analyzed") {
            statusBadge = `<span class="badge" style="font-size: 7px; padding: 0px 3px; color: var(--color-violet); border-color: rgba(138, 92, 246, 0.3); margin-left: 4px;">VISÃO</span>`;
            actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
        } else if (v.status === "ingested") {
            actionBtn = `<button class="btn-card-action btn-hover-only" style="color:var(--text-muted); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Deletar Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
        } else if (v.status === "error") {
            statusGlow = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose); font-size: 10px; margin-left: 4px;" title="Erro no processamento!"></i>`;
            actionBtn = `<button class="btn-card-action" style="color:var(--text-secondary); margin-left:auto;" onclick="event.stopPropagation(); deleteProxy(${v.id})" title="Limpar Vídeo/Proxy"><i class="fa-solid fa-trash-can"></i></button>`;
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
        
        card.addEventListener("click", () => selectVideo(v));
        container.appendChild(card);
    }
}

function renderVideos(videos) {
    const listContainer = document.getElementById("video-list");
    listContainer.innerHTML = "";
    
    // Construir a árvore hierárquica baseada nos caminhos de arquivos
    const tree = buildTree(videos);
    
    // Renderizar o nó raiz (pastas e arquivos no topo)
    // Se o nó raiz for apenas "Biblioteca", renderizar filhos diretamente para não criar nó desnecessário
    if (tree.isRoot && tree.name === "Biblioteca") {
        Object.keys(tree.children).forEach(key => {
            renderTreeNode(tree.children[key], listContainer, 0);
        });
    } else {
        renderTreeNode(tree, listContainer, 0);
    }
    
    // Iniciar o polling em background de conversões se houver algum vídeo ativamente convertendo/processando
    const hasActiveConversions = videos.some(v => v.status === "transcribing" || v.status === "processing" || v.status === "analyzing");
    if (hasActiveConversions) {
        startProgressPolling();
    }
}

async function loadPhotos() {
    updateSystemStatus("Carregando fotos de set...", true);
    const listContainer = document.getElementById("photo-list");
    listContainer.innerHTML = "";
    
    try {
        const response = await fetch(`/api/photos?project_id=${currentProjectId}`);

        if (response.ok) {
            const data = await response.json();
            if (data.length > 0) {
                renderPhotos(data);
                updateSystemStatus("Fotos atualizadas.");
                return;
            }
        }
    } catch (e) {
        console.warn("Erro ao carregar fotos. Carregando mock.");
    }
    renderPhotos(MOCK_PHOTOS);
    updateSystemStatus("Pronto.");
}

function renderPhotos(photos) {
    const listContainer = document.getElementById("photo-list");
    listContainer.innerHTML = "";
    
    photos.forEach(p => {
        const card = document.createElement("div");
        card.className = "photo-card";
        
        // Tratar caminhos absolutos locais vs urls de mock
        const src = p.filepath.startsWith('http') || p.filepath.startsWith('/') ? p.filepath : `/originals/${p.filename}`;
        
        card.innerHTML = `
            <img src="${src}" alt="${p.filename}">
            <p title="${p.description}">${p.description}</p>
        `;
        
        card.addEventListener("click", () => {
            // Ao clicar na foto, exibe a análise dela na busca ou player
            alert(`Foto: ${p.filename}\nDescrição: ${p.description}\nTags: ${p.tags}`);
        });
        
        listContainer.appendChild(card);
    });
}

async function loadThemes() {
    updateSystemStatus("Carregando temas narrativos...", true);
    const listContainer = document.getElementById("theme-list");
    listContainer.innerHTML = "";
    
    try {
        const response = await fetch(`/api/themes?project_id=${currentProjectId}`);

        if (response.ok) {
            const data = await response.json();
            if (data.themes && data.themes.length > 0) {
                renderThemes(data.themes);
                updateSystemStatus("Temas narrativos carregados.");
                return;
            }
        }
    } catch (e) {
        console.warn("Erro ao carregar temas.");
    }
    renderThemes(MOCK_THEMES);
    updateSystemStatus("Pronto.");
}

function renderThemes(themes) {
    const listContainer = document.getElementById("theme-list");
    listContainer.innerHTML = "";
    
    themes.forEach(t => {
        const card = document.createElement("div");
        card.className = "media-card";
        card.style.flexDirection = "column";
        card.style.alignItems = "flex-start";
        card.style.gap = "4px";
        
        card.innerHTML = `
            <h4 style="color: var(--color-cyan);"><i class="fa-solid fa-brain"></i> ${t.title}</h4>
            <p style="font-size: 11px; color: var(--text-secondary);">${t.description}</p>
        `;
        listContainer.appendChild(card);
    });
}

// ── SELEÇÃO DE VÍDEO E PLAYER CONTROLLER ──────────────────────────────

// ── SELEÇÃO DE VÍDEO E PLAYER CONTROLLER ──────────────────────────────

async function selectVideo(video) {
    activeVideo = video;
    
    // Atualiza classes ativas na barra lateral diretamente no DOM para não ter lag nem fechar as pastas abertas
    document.querySelectorAll(".media-card").forEach(el => {
        if (parseInt(el.getAttribute("data-video-id")) === video.id) {
            el.classList.add("active");
        } else {
            el.classList.remove("active");
        }
    });
    
    // Configura o player de vídeo
    let videoSrc = video.filepath;
    if (!videoSrc.startsWith('http') && !videoSrc.startsWith('/')) {
        videoSrc = `/proxies/proxy_vid_${video.id}.mp4`;
    }
    
    // Configurar fallback resiliente: tenta reproduzir o vídeo real do servidor.
    // Se falhar (ex: proxy pendente ou offline), recai suavemente para o mock de Big Buck Bunny / Urso.
    videoPlayer.onerror = () => {
        console.warn("Falha ao carregar arquivo de vídeo proxy local. Carregando mock de segurança.");
        const fallbackSrc = video.id === 1 ? "https://www.w3schools.com/html/mov_bbb.mp4" : "https://www.w3schools.com/html/movie.mp4";
        videoPlayer.onerror = null; // Evita recursão infinita se o mock falhar
        videoPlayer.src = fallbackSrc;
        videoPlayer.load();
    };
    
    videoPlayer.src = videoSrc;
    videoPlayer.load(); // Força a recarga do stream no elemento de vídeo
    
    videoTitleEl.textContent = video.filename;
    badgeType.textContent = video.video_type === "interview" ? "Falas ASR" : "B-Roll";
    badgeResolution.textContent = video.resolution || "720p Proxy";
    
    // Limpa marcadores
    markerIn = null;
    markerOut = null;
    if (markerInPos) markerInPos.style.display = "none";
    if (markerOutPos) markerOutPos.style.display = "none";
    
    // Gerenciar visibilidade das abas da barra lateral direita
    const rightTabs = document.getElementById("right-tabs");
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    const btnTabVision = document.getElementById("btn-tab-vision");
    
    if (video.video_type === "broll") {
        rightTabs.style.display = "flex";
        btnTabTranscript.classList.add("active");
        btnTabVision.classList.remove("active");
        currentRightTab = "transcript";
    } else {
        rightTabs.style.display = "none";
        currentRightTab = "transcript";
    }
    
    // Carrega transcrições/descrições visuais
    await loadTranscript(video);
}

async function loadTranscript(video) {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "<div class='loading'>Carregando dados...</div>";
    
    activeTranscript = [];
    activeVisionFrames = [];
    
    // 1. Tentar sempre carregar falas/transcrições se existirem
    try {
        const response = await fetch(`/api/video/${video.id}/transcript`);
        if (response.ok) {
            const data = await response.json();
            if (data.dialogues && data.dialogues.length > 0) {
                activeTranscript = data.dialogues;
            }
        }
    } catch (e) {
        console.warn("Erro ao buscar transcrição.");
    }
    
    // Fallback do Mock para entrevista de depoimento principal se estiver vazio/offline
    if (video.video_type === "interview" && activeTranscript.length === 0) {
        activeTranscript = MOCK_TRANSCRIPT_1;
    }
    
    // 2. Se for B-roll, carregar descrições de frames reais do Qdrant
    if (video.video_type === "broll") {
        try {
            const response = await fetch(`/api/video/${video.id}/vision?project_id=${currentProjectId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.frames && data.frames.length > 0) {
                    activeVisionFrames = data.frames;
                }
            }
        } catch (e) {
            console.warn("Erro ao buscar frames do Qdrant.");
        }
    }
    
    // Renderiza a aba ativa
    renderRightPanelFeed();
}

function renderRightPanelFeed() {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "";
    
    if (currentRightTab === "tasks") {
        renderTasksTab();
        return;
    }
    
    if (!activeVideo) {
        feed.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-microphone-slash"></i>
                <p>Selecione um depoimento na Biblioteca para carregar seu feed.</p>
            </div>
        `;
        return;
    }
    
    if (currentRightTab === "transcript") {
        if (activeTranscript && activeTranscript.length > 0) {
            renderTranscript(activeTranscript);
        } else {
            feed.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-microphone-slash"></i>
                    <p style="font-weight:600;">Sem falas transcritas neste vídeo.</p>
                    <p style="font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height:1.5;">
                        Se este B-Roll contiver falas importantes dos bastidores que você deseja mapear, aperte o botão <b>Transcrever Vídeo Atual</b> acima para rodar a IA ASR AssemblyAI e indexá-la semanticamente!
                    </p>
                </div>
            `;
        }
    } else if (currentRightTab === "vision") {
        const framesToRender = activeVisionFrames && activeVisionFrames.length > 0 ? activeVisionFrames : MOCK_BROLL_2;
        
        framesToRender.forEach(b => {
            const bubble = document.createElement("div");
            bubble.className = "transcript-bubble";
            bubble.innerHTML = `
                <div class="bubble-meta">
                    <span class="speaker-name" style="color: var(--color-violet);"><i class="fa-solid fa-eye"></i> Bastidores Visuais</span>
                    <span class="bubble-time">${formatTimecode(b.timestamp)}</span>
                </div>
                <div class="bubble-text">${b.description}</div>
                <div style="display:flex; gap:4px; margin-top:6px;">
                    ${b.tags.map(t => `<span class='badge' style='font-size:9px; padding:2px 6px;'>#${t}</span>`).join('')}
                </div>
            `;
            
            bubble.addEventListener("click", () => {
                videoPlayer.currentTime = b.timestamp;
            });
            feed.appendChild(bubble);
        });
    }
}


async function renderTasksTab() {
    const feed = document.getElementById("transcript-feed");
    
    // Buscar progresso atual das conversões FFmpeg
    let conversions = {};
    try {
        const response = await fetch("/api/conversions");
        if (response.ok) {
            conversions = await response.json();
        }
    } catch (e) {
        console.warn("Erro ao buscar progresso das conversões.");
    }
    
    feed.innerHTML = `
        <div class="transcription-actions" style="border:none; margin-bottom:12px; padding-bottom: 0;">
            <h4 style="font-size:12px; color:var(--color-cyan); display:flex; align-items:center; justify-content:space-between; width:100%; margin:0;">
                <span><i class="fa-solid fa-list-check"></i> Fila de Tarefas</span>
                <button class="btn-outline" onclick="loadVideos();" style="font-size:10px; padding:2px 8px; margin-left:auto; display:flex; align-items:center; gap:4px; height: 24px;">
                    <i class="fa-solid fa-arrows-rotate"></i> Atualizar
                </button>
            </h4>
        </div>
    `;
    
    const activeTasks = allVideos.filter(v => 
        v.status === "transcribing" || 
        v.status === "processing" || 
        v.status === "analyzing" || 
        v.status === "error"
    );
    
    if (activeTasks.length === 0) {
        feed.innerHTML += `
            <div class="empty-state" style="padding: 40px 20px;">
                <i class="fa-solid fa-circle-check" style="color: var(--color-emerald); font-size: 32px; margin-bottom: 12px;"></i>
                <p style="font-weight:600; color:var(--text-secondary);">Tudo em dia!</p>
                <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height:1.5; text-align: center;">
                    Não há conversões de proxy ativas ou falhas no projeto.
                </p>
            </div>
        `;
        return;
    }
    
    activeTasks.forEach(v => {
        const taskCard = document.createElement("div");
        taskCard.className = "transcript-bubble";
        taskCard.style.borderColor = v.status === "error" ? "rgba(244, 63, 94, 0.3)" : "var(--border-glass-glow)";
        taskCard.style.background = v.status === "error" ? "rgba(244, 63, 94, 0.03)" : "rgba(255,255,255,0.02)";
        taskCard.style.marginBottom = "10px";
        taskCard.style.padding = "12px";
        taskCard.style.cursor = "default";
        
        let statusTitle = "";
        let statusIcon = "";
        let details = "";
        let actionBtn = "";
        
        if (v.status === "transcribing" || v.status === "processing") {
            const convData = conversions[v.id];
            if (convData) {
                const percent = convData.percent !== undefined ? convData.percent : 0;
                statusTitle = `Convertendo (${percent}%)`;
                statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);"></i>`;
                details = "FFmpeg convertendo vídeo para proxy de visualização leve.";
                actionBtn = `<button class="btn-outline" style="color:var(--color-rose); font-size:10px; padding:4px 8px; border-color: rgba(244, 63, 94, 0.3);" onclick="cancelConversion(${v.id}); event.stopPropagation();">Cancelar</button>`;
            } else {
                statusTitle = "Transcrevendo (ASR)";
                statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);"></i>`;
                details = "AssemblyAI analisando áudio e gerando falas na nuvem.";
                actionBtn = ``;
            }
        } else if (v.status === "analyzing") {
            statusTitle = "Visão IA";
            statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-violet);"></i>`;
            details = "Extraindo frames e descrevendo o conteúdo visual via IA.";
            actionBtn = `<button class="btn-outline" style="color:var(--color-rose); font-size:10px; padding:4px 8px; border-color: rgba(244, 63, 94, 0.3);" onclick="cancelConversion(${v.id}); event.stopPropagation();">Cancelar</button>`;
        } else if (v.status === "error") {
            statusTitle = "Falha";
            statusIcon = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);"></i>`;
            details = v.error_message || "Erro desconhecido durante a conversão ou transcrição.";
            actionBtn = `
                <div style="display:flex; gap:6px;">
                    <button class="btn-secondary" style="font-size:10px; padding:4px 8px; display:flex; align-items:center; gap:4px; height: 26px;" onclick="retrySingleVideo(${v.id}); event.stopPropagation();">
                        <i class="fa-solid fa-arrows-rotate"></i> Tentar Novamente
                    </button>
                    <button class="btn-outline" style="color:var(--text-secondary); font-size:10px; padding:4px 8px; height: 26px;" onclick="deleteProxy(${v.id}); event.stopPropagation();">
                        Remover
                    </button>
                </div>
            `;
        }
        
        taskCard.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;">
                <span style="font-weight:600; font-size:11px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${v.filename}">
                    ${v.filename}
                </span>
                <span style="font-size:10px; font-weight:500; display:flex; align-items:center; gap:4px; color:${v.status === 'error' ? 'var(--color-rose)' : 'var(--color-cyan)'}; flex-shrink:0;">
                    ${statusIcon} ${statusTitle}
                </span>
            </div>
            <p style="font-size:10px; color:var(--text-muted); margin:0 0 10px 0; line-height:1.4;">
                ${details}
            </p>
            <div style="display:flex; justify-content:flex-end;">
                ${actionBtn}
            </div>
        `;
        
        feed.appendChild(taskCard);
    });
}

window.retrySingleVideo = async function(videoId) {
    // Limpar o player se o vídeo reprocessado for o ativo, liberando o lock de arquivo no Windows
    if (activeVideo && activeVideo.id === videoId) {
        videoPlayer.src = "";
        videoPlayer.load();
    }
    showSpeedOverlay("Reprocessando...");
    updateSystemStatus("Reiniciando tarefa...", true);
    try {
        const response = await fetch(`/api/video/${videoId}/retry`, { method: "POST" });
        if (response.ok) {
            updateSystemStatus("Tarefa reiniciada em background.");
            await loadVideos();
        } else {
            const err = await response.json();
            alert(err.detail || "Não foi possível reiniciar.");
            updateSystemStatus("Falha ao reiniciar tarefa.");
        }
    } catch(e) {
        updateSystemStatus("Erro de rede.");
    }
};

function renderTranscript(dialogues) {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "";
    activeTranscript = dialogues;
    
    dialogues.forEach((d, idx) => {
        const bubble = document.createElement("div");
        bubble.className = "transcript-bubble";
        
        bubble.innerHTML = `
            <div class="bubble-meta">
                <span class="speaker-name">${d.speaker_id}</span>
                <span class="bubble-time">${formatTimecode(d.start_time)}</span>
            </div>
            <div class="bubble-text">${d.text}</div>
        `;
        
        // Ao clicar na bolha de diálogo, pula o vídeo para o tempo inicial dele
        bubble.addEventListener("click", () => {
            videoPlayer.currentTime = d.start_time;
            playVideo();
        });
        
        feed.appendChild(bubble);
    });
}

// ── ADVANCED PLAYER LOGIC & JKL CONTROLS ──────────────────────────────

function playVideo() {
    videoPlayer.play().catch(err => {
        console.error("Erro de reprodução de vídeo:", err);
        updateSystemStatus("Erro ao iniciar reprodução do vídeo. Pode ser necessário reiniciar a conversão.", false);
    });
    btnPlay.innerHTML = "<i class='fa-solid fa-pause'></i>";
    btnPlay.classList.add("paused");
}

function pauseVideo() {
    videoPlayer.pause();
    btnPlay.innerHTML = "<i class='fa-solid fa-play'></i>";
    btnPlay.classList.remove("paused");
}

function togglePlay() {
    if (!videoPlayer.src || videoPlayer.src === window.location.href || videoPlayer.src.endsWith('/')) {
        updateSystemStatus("Selecione um vídeo na biblioteca para iniciar.", false);
        return;
    }
    
    if (videoPlayer.paused) {
        playVideo();
        jklState = 'L'; // Estado tocando
        jklIndex = 0;
        playbackSpeed = 1.0;
        videoPlayer.playbackRate = 1.0;
        selectSpeed.value = "1.0";
        jklOverlay.textContent = "Play";
        jklOverlay.classList.add("visible");
        setTimeout(() => jklOverlay.classList.remove("visible"), 800);
    } else {
        pauseVideo();
        jklState = 'K'; // Estado pausado
        jklOverlay.textContent = "K";
        jklOverlay.classList.add("visible");
        setTimeout(() => jklOverlay.classList.remove("visible"), 800);
    }
}

// Atualização de estados JKL
function updateJKL(state) {
    jklState = state;
    
    jklOverlay.textContent = state;
    jklOverlay.classList.add("visible");
    setTimeout(() => jklOverlay.classList.remove("visible"), 800);
    
    if (state === 'K') {
        pauseVideo();
        videoPlayer.playbackRate = 1.0;
        playbackSpeed = 1.0;
        selectSpeed.value = "1.0";
    } else if (state === 'L') {
        playVideo();
        playbackSpeed = SPEEDS_FORWARD[jklIndex];
        videoPlayer.playbackRate = playbackSpeed;
        showSpeedOverlay(`${playbackSpeed}x`);
    } else if (state === 'J') {
        // Reprodução reversa simulada em HTML5 video (reduz tempo do player periodicamente)
        playReverse();
    }
}

let reverseInterval = null;
function playReverse() {
    pauseVideo();
    clearInterval(reverseInterval);
    
    const speed = SPEEDS_REVERSE[jklIndex];
    showSpeedOverlay(`${speed}x`);
    
    reverseInterval = setInterval(() => {
        if (jklState !== 'J') {
            clearInterval(reverseInterval);
            return;
        }
        // Volta frames retrocedendo 0.1s multiplicado pela velocidade
        videoPlayer.currentTime += (speed * 0.05);
        if (videoPlayer.currentTime <= 0) {
            videoPlayer.currentTime = 0;
            updateJKL('K');
            clearInterval(reverseInterval);
        }
    }, 50);
}

function showSpeedOverlay(text) {
    speedOverlay.textContent = text;
    speedOverlay.classList.add("visible");
    setTimeout(() => speedOverlay.classList.remove("visible"), 800);
}

// Scrubber Progress Update
videoPlayer.addEventListener("timeupdate", () => {
    const cur = videoPlayer.currentTime;
    const dur = videoPlayer.duration || 0;
    
    currentTimeEl.textContent = formatTimecode(cur);
    if (dur) {
        durationTimeEl.textContent = formatTimecode(dur);
        const percent = (cur / dur) * 100;
        scrubberFill.style.width = `${percent}%`;
        scrubberHandle.style.left = `${percent}%`;
    }
    
    // Highlight da palavra correspondente na transcrição
    highlightSpeech(cur);
});

function highlightSpeech(time) {
    document.querySelectorAll(".transcript-bubble").forEach((bubble, idx) => {
        const d = activeTranscript[idx];
        if (d && time >= d.start_time && time <= d.end_time) {
            bubble.classList.add("active");
            bubble.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
            bubble.classList.remove("active");
        }
    });
}

// ── MARCANDO E CORTANDO SEGMENTOS (I / O / E) ────────────────────────

function setMarkIn() {
    markerIn = videoPlayer.currentTime;
    const dur = videoPlayer.duration || 1;
    const percent = (markerIn / dur) * 100;
    markerInPos.style.left = `${percent}%`;
    markerInPos.style.display = "block";
    showSpeedOverlay("IN Marked");
}

function setMarkOut() {
    markerOut = videoPlayer.currentTime;
    const dur = videoPlayer.duration || 1;
    const percent = (markerOut / dur) * 100;
    markerOutPos.style.left = `${percent}%`;
    markerOutPos.style.display = "block";
    showSpeedOverlay("OUT Marked");
}

function appendToTimeline() {
    if (!activeVideo) {
        alert("Selecione um vídeo primeiro!");
        return;
    }
    
    const start = markerIn !== null ? markerIn : 0.0;
    const end = markerOut !== null ? markerOut : videoPlayer.duration || 10.0;
    
    if (start >= end) {
        alert("O ponto de entrada (IN) deve ser menor que o ponto de saída (OUT)!");
        return;
    }
    
    const cut = {
        video_id: activeVideo.id,
        filename: activeVideo.filename,
        in: start,
        out: end,
        track: activeVideo.video_type === "interview" ? "V1" : "V2"
    };
    
    activeTimelineCuts.push(cut);
    updateTimelineUI();
    showSpeedOverlay("Inserido!");
}

function updateTimelineUI() {
    trackSpeech.innerHTML = "";
    trackBroll.innerHTML = "";
    
    if (activeTimelineCuts.length === 0) {
        trackSpeech.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:12px;'>Timeline Vazia. Marque pontos I/O e aperte 'E' para fatiar.</div>";
        return;
    }
    
    activeTimelineCuts.forEach((cut, idx) => {
        const block = document.createElement("div");
        block.className = `timeline-block ${cut.track === "V1" ? "block-speech" : "block-broll"}`;
        
        const dur = (cut.out - cut.in).toFixed(1);
        block.innerHTML = `
            <h5>${cut.filename}</h5>
            <span>${cut.in.toFixed(1)}s - ${cut.out.toFixed(1)}s (${dur}s)</span>
            <button class="btn-remove-block" onclick="removeTimelineBlock(${idx})">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        
        if (cut.track === "V1") {
            trackSpeech.appendChild(block);
        } else {
            trackBroll.appendChild(block);
        }
    });
}

window.removeTimelineBlock = function(idx) {
    activeTimelineCuts.splice(idx, 1);
    updateTimelineUI();
};

// ── BUSCA SEMÂNTICA ──────────────────────────────────────────────────

async function runSemanticSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    
    updateSystemStatus(`Buscando por: "${query}"...`, true);
    const filter = filterSelect.value;
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "<div class='loading'>Buscando conceitos na biblioteca...</div>";
    
    try {
        let url = `/api/search?query=${encodeURIComponent(query)}&project_id=${currentProjectId}`;
        if (filter) url += `&media_type=${filter}`;

        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            renderSearchResults(data.results, query);
            updateSystemStatus(`Busca concluída: ${data.results.length} resultados.`);
            return;
        }
    } catch (e) {
        console.warn("Erro ao buscar no backend. Mostrando resultado simulado para a query: " + query);
    }
    
    // Resultados simulados de busca em caso de offline
    setTimeout(() => {
        const mockResults = [
            {
                score: 0.892,
                payload: {
                    video_id: 1,
                    media_type: "interview",
                    speaker_id: "Diretor",
                    start_time: 0.5,
                    end_time: 6.8,
                    text: "Olá, eu sou o diretor e escolhi usar lentes anamórficas para obter uma estética cinematográfica."
                }
            }
        ];
        renderSearchResults(mockResults, query);
        updateSystemStatus("Busca concluída (Mock).");
    }, 600);
}

function renderSearchResults(results, query) {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = `
        <div class="transcription-actions" style="border:none;">
            <h4 style="font-size:12px; color:var(--color-cyan);">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Resultados para: "${query}"
            </h4>
        </div>
    `;
    
    if (results.length === 0) {
        feed.innerHTML += `
            <div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Nenhum resultado semântico encontrado.</p>
            </div>
        `;
        return;
    }
    
    results.forEach(r => {
        const bubble = document.createElement("div");
        bubble.className = "transcript-bubble";
        bubble.style.borderColor = "var(--border-glass-glow)";
        bubble.style.background = "rgba(6, 182, 212, 0.03)";
        
        const isPhoto = r.payload.media_type === "photo";
        const title = isPhoto ? `Foto de Set` : r.payload.media_type === "interview" ? `${r.payload.speaker_id}` : `Bastidores B-Roll`;
        const time = isPhoto ? "" : formatTimecode(r.payload.start_time);
        
        bubble.innerHTML = `
            <div class="bubble-meta">
                <span class="speaker-name" style="color:var(--color-cyan);"><i class="fa-solid fa-magnifying-glass"></i> ${title}</span>
                <span class="bubble-time">${time} (Match: ${(r.score * 100).toFixed(0)}%)</span>
            </div>
            <div class="bubble-text">${r.payload.text}</div>
        `;
        
        if (!isPhoto) {
            bubble.addEventListener("click", () => {
                // Pular para o vídeo correto e segundo correto
                const targetVid = MOCK_VIDEOS.find(v => v.id === r.payload.video_id);
                if (targetVid) {
                    selectVideo(targetVid);
                    setTimeout(() => {
                        videoPlayer.currentTime = r.payload.start_time;
                        playVideo();
                    }, 200);
                }
            });
        }
        
        feed.appendChild(bubble);
    });
}

// ── CONFIGURANDO EVENTOS E SHORTCUTS DE EDICÃO ───────────────────────

function setupEventListeners() {
    // Clicar no próprio vídeo para dar Play/Pause
    videoPlayer.addEventListener("click", togglePlay);
    
    // Botão de recarga de biblioteca
    const btnReloadLib = document.getElementById("btn-reload-library");
    if (btnReloadLib) {
        btnReloadLib.addEventListener("click", async () => {
            showSpeedOverlay("Recarregando...");
            updateSystemStatus("Recarregando biblioteca...", true);
            await loadVideos();
            await loadPhotos();
            await loadThemes();
            updateSystemStatus("Biblioteca recarregada com sucesso.");
        });
    }

    // Botão de abrir pasta de proxies no Explorer
    const btnOpenPx = document.getElementById("btn-open-proxies");
    if (btnOpenPx) {
        btnOpenPx.addEventListener("click", async () => {
            showSpeedOverlay("Abrindo...");
            updateSystemStatus("Abrindo pasta de proxies no Explorer...", true);
            try {
                const r = await fetch("/api/project/open-proxies-folder", { method: "POST" });
                if (r.ok) {
                    updateSystemStatus("Pasta de proxies aberta.");
                } else {
                    const err = await r.json();
                    alert("Erro ao abrir pasta: " + (err.detail || "Desconhecido"));
                    updateSystemStatus("Falha ao abrir pasta.");
                }
            } catch(e) {
                alert("Backend offline. Não foi possível abrir a pasta local.");
                updateSystemStatus("Erro ao abrir pasta local.");
            }
        });
    }

    // Botão de recomeçar falhas
    const btnRetryFailed = document.getElementById("btn-retry-failed");
    if (btnRetryFailed) {
        btnRetryFailed.addEventListener("click", async () => {
            showSpeedOverlay("Reprocessando...");
            updateSystemStatus("Iniciando reprocessamento de falhas...", true);
            try {
                const r = await fetch(`/api/project/${currentProjectId}/retry-failed`, { method: "POST" });
                if (r.ok) {
                    const data = await r.json();
                    alert(`Reiniciando conversão de ${data.count} proxies falhos ou ausentes em background!`);
                    updateSystemStatus(`Reiniciadas ${data.count} conversões falhas.`);
                    startListPolling(); // Inicia o polling para exibir o progresso em tempo real
                } else {
                    alert("Não foi possível reprocessar as falhas.");
                    updateSystemStatus("Erro ao reprocessar falhas.");
                }
            } catch(e) {
                alert("Backend offline. Simulação de reprocessamento concluída.");
                updateSystemStatus("Offline. Reprocessamento simulado.");
            }
        });
    }

    // Play/Pause button
    btnPlay.addEventListener("click", togglePlay);
    
    // Keyboard Listeners (JKL & I/O Shortcuts)
    document.addEventListener("keydown", (e) => {
        // Ignora atalhos se o foco estiver em qualquer campo de texto, input ou caixa de busca
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") return;

        
        const key = e.key.toUpperCase();
        if (key === " ") {
            e.preventDefault();
            togglePlay();
        } else if (key === "K") {
            togglePlay();
        } else if (key === "L") {
            // Avanço JKL
            if (jklState === 'L') {
                jklIndex = (jklIndex + 1) % SPEEDS_FORWARD.length;
            } else {
                jklState = 'L';
                jklIndex = 0;
            }
            updateJKL('L');
        } else if (key === "J") {
            // Retrocesso JKL
            if (jklState === 'J') {
                jklIndex = (jklIndex + 1) % SPEEDS_REVERSE.length;
            } else {
                jklState = 'J';
                jklIndex = 0;
            }
            updateJKL('J');
        } else if (key === "I") {
            setMarkIn();
        } else if (key === "O") {
            setMarkOut();
        } else if (key === "E") {
            appendToTimeline();
        }
    });
    
    // Scrubber click dragging
    scrubberBar.addEventListener("click", (e) => {
        const rect = scrubberBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        videoPlayer.currentTime = percent * videoPlayer.duration;
    });
    
    // Toggle sidebars retráteis
    toggleLeft.addEventListener("click", () => collapseSidebar("left"));
    toggleRight.addEventListener("click", () => collapseSidebar("right"));
    toggleTimeline.addEventListener("click", () => collapseSidebar("timeline"));
    
    reopenLeft.addEventListener("click", () => expandSidebar("left"));
    reopenRight.addEventListener("click", () => expandSidebar("right"));
    reopenTimeline.addEventListener("click", () => expandSidebar("timeline"));
    
    // Marcadores e append buttons
    btnMarkIn.addEventListener("click", setMarkIn);
    btnMarkOut.addEventListener("click", setMarkOut);
    btnAppend.addEventListener("click", appendToTimeline);
    
    // Velocidade dropdown
    selectSpeed.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        videoPlayer.playbackRate = val;
        playbackSpeed = val;
        showSpeedOverlay(`${val}x`);
    });
    
    // Resolução switcher
    selectResolution.addEventListener("change", (e) => {
        const val = e.target.value;
        showSpeedOverlay(`Res: ${val.replace('proxy_', '')}`);
        // Simulando troca rápida sem lags
        const curTime = videoPlayer.currentTime;
        const isPaused = videoPlayer.paused;
        if (videoPlayer.src && videoPlayer.src !== window.location.href && !videoPlayer.src.endsWith('/')) {
            videoPlayer.load();
            videoPlayer.currentTime = curTime;
            if (!isPaused) playVideo();
        }
    });
    
    // Maximize
    document.getElementById("btn-maximize").addEventListener("click", () => {
        if (videoPlayer.requestFullscreen) videoPlayer.requestFullscreen();
    });
    
    // Busca
    btnSearch.addEventListener("click", runSemanticSearch);
    searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") runSemanticSearch();
    });
    
    // Controle de abas do painel lateral direito (Falas vs Visão vs Tarefas)
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    const btnTabVision = document.getElementById("btn-tab-vision");
    const btnTabTasks = document.getElementById("btn-tab-tasks");
    
    btnTabTranscript.addEventListener("click", () => {
        btnTabTranscript.classList.add("active");
        btnTabVision.classList.remove("active");
        if (btnTabTasks) btnTabTasks.classList.remove("active");
        currentRightTab = "transcript";
        renderRightPanelFeed();
    });
    
    btnTabVision.addEventListener("click", () => {
        btnTabVision.classList.add("active");
        btnTabTranscript.classList.remove("active");
        if (btnTabTasks) btnTabTasks.classList.remove("active");
        currentRightTab = "vision";
        renderRightPanelFeed();
    });

    if (btnTabTasks) {
        btnTabTasks.addEventListener("click", () => {
            btnTabTasks.classList.add("active");
            btnTabTranscript.classList.remove("active");
            btnTabVision.classList.remove("active");
            currentRightTab = "tasks";
            renderRightPanelFeed();
        });
    }

    
    // Botões de Ação FastAPI
    btnScan.addEventListener("click", async () => {
        showSpeedOverlay("Escanendo watch/...");
        updateSystemStatus("Varrendo pasta watch/ para catalogar...", true);
        try {
            const r = await fetch(`/api/ingest/scan?project_id=${currentProjectId}`, { method: "POST" });

            if (r.ok) {
                alert("Varredura iniciada! Coloque arquivos em 'watch/' para catalogação automática.");
                updateSystemStatus("Varredura watch/ concluída com sucesso.");
                startListPolling(); // Inicia o polling dinâmico da biblioteca
            }
        } catch(e) {
            alert("Backend offline. Simulação de escaneamento concluída.");
            updateSystemStatus("Offline. Varredura watch/ simulada.");
        }
    });

    // Botão de Importação de Pasta Externa / HD
    const btnImportExternal = document.getElementById("btn-import-external");
    const importModal = document.getElementById("import-modal");
    const btnCloseImport = document.getElementById("btn-close-import-modal");
    const btnCancelImport = document.getElementById("btn-cancel-import");
    const btnSubmitImport = document.getElementById("btn-submit-import");
    const externalPathInput = document.getElementById("external-path-input");
    const btnBrowseFolder = document.getElementById("btn-browse-folder");
    const btnAddMedia = document.getElementById("btn-add-media");
    const dropzone = document.getElementById("import-dropzone");
    const sidebarLeftEl = document.getElementById("sidebar-left");
    
    // Abre o modal de importação e preenche com a última pasta selecionada
    const openImportModalAction = () => {
        importModal.classList.add("active");
        const lastFolder = localStorage.getItem("last_imported_folder");
        externalPathInput.value = lastFolder || "";
    };
    
    btnImportExternal.addEventListener("click", openImportModalAction);
    if (btnAddMedia) {
        btnAddMedia.addEventListener("click", openImportModalAction);
    }
    
    const closeImportModal = () => importModal.classList.remove("active");
    btnCloseImport.addEventListener("click", closeImportModal);
    btnCancelImport.addEventListener("click", closeImportModal);
    
    // Browse native directory using Tkinter backend askdirectory
    if (btnBrowseFolder) {
        btnBrowseFolder.addEventListener("click", async () => {
            try {
                updateSystemStatus("Aguardando seleção de pasta nativa...", true);
                const r = await fetch("/api/ingest/select-folder", { method: "POST" });
                if (r.ok) {
                    const data = await r.json();
                    if (data.status === "success" && data.path) {
                        externalPathInput.value = data.path;
                        updateSystemStatus("Pasta selecionada: " + data.path);
                        localStorage.setItem("last_imported_folder", data.path);
                    } else {
                        updateSystemStatus("Seleção nativa cancelada.");
                    }
                }
            } catch(e) {
                alert("Não foi possível abrir o seletor nativo. Preencha o caminho manualmente.");
                updateSystemStatus("Erro ao abrir seletor nativo.");
            }
        });
    }
    
    // Drag & Drop no modal (Dropzone)
    if (dropzone) {
        dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropzone.style.borderColor = "var(--color-cyan)";
            dropzone.style.background = "rgba(6, 182, 212, 0.05)";
        });
        dropzone.addEventListener("dragleave", () => {
            dropzone.style.borderColor = "rgba(138, 92, 246, 0.3)";
            dropzone.style.background = "rgba(255, 255, 255, 0.02)";
        });
        dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropzone.style.borderColor = "rgba(138, 92, 246, 0.3)";
            dropzone.style.background = "rgba(255, 255, 255, 0.02)";
            
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const item = items[0].webkitGetAsEntry();
                if (item) {
                    if (item.isDirectory) {
                        alert(`Você arrastou a pasta "${item.name}".\n\nPor favor, confirme no seletor nativo a seguir para obter o caminho completo absoluto de forma oficial.`);
                        if (btnBrowseFolder) btnBrowseFolder.click();
                    } else {
                        alert(`Você arrastou o arquivo "${item.name}".\n\nPor favor, confirme no seletor nativo a seguir para obter o caminho absoluto de forma oficial.`);
                        if (btnBrowseFolder) btnBrowseFolder.click();
                    }
                }
            }
        });
    }
    
    // Drag & Drop diretamente na barra lateral Biblioteca
    if (sidebarLeftEl) {
        sidebarLeftEl.addEventListener("dragover", (e) => {
            e.preventDefault();
            sidebarLeftEl.style.boxShadow = "inset 0 0 0 2px var(--color-cyan)";
        });
        sidebarLeftEl.addEventListener("dragleave", () => {
            sidebarLeftEl.style.boxShadow = "none";
        });
        sidebarLeftEl.addEventListener("drop", (e) => {
            e.preventDefault();
            sidebarLeftEl.style.boxShadow = "none";
            openImportModalAction();
            if (btnBrowseFolder) {
                setTimeout(() => btnBrowseFolder.click(), 150);
            }
        });
    }
    
    btnSubmitImport.addEventListener("click", async () => {
        const path = externalPathInput.value.trim();
        if (!path) {
            alert("Por favor, preencha o caminho da pasta ou arquivo!");
            return;
        }
        
        // Salvar a pasta importada com sucesso no localStorage para lembrar automaticamente
        localStorage.setItem("last_imported_folder", path);
        
        showSpeedOverlay("Importando HD/Pasta...");
        updateSystemStatus(`Importando de forma recursiva: "${path}"...`, true);
        try {
            const response = await fetch("/api/ingest/external", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: path, project_id: currentProjectId })
            });
            if (response.ok) {
                alert("Ingestão in-place de HD/Pasta externa iniciada em background! Proxies sendo gerados localmente.");
                updateSystemStatus("HD/Pasta importada de forma recursiva (links locais ativos).");
                closeImportModal();
                startListPolling(); // Inicia o polling dinâmico da biblioteca
            } else {
                const err = await response.json();
                alert("Erro ao importar caminho: " + (err.detail || "Caminho não encontrado."));
                updateSystemStatus("Erro ao importar HD/Pasta externa.", false);
            }
        } catch(e) {
            closeImportModal();
            alert("Backend offline. Ingestão in-place simulada com sucesso!");
            updateSystemStatus("Offline. Importação recursiva in-place simulada.");
        }
    });

    
    btnCluster.addEventListener("click", async () => {
        showSpeedOverlay("Agrupando Temas...");
        updateSystemStatus("IA organizando trechos em temas narrativos...", true);
        try {
            const r = await fetch(`/api/project/cluster-themes?project_id=${currentProjectId}`, { method: "POST" });

            if (r.ok) {
                alert("Análise inteligente de clustering temático em processamento via DeepSeek!");
                updateSystemStatus("Clustering de temas concluído com sucesso.");
                setTimeout(loadThemes, 4000);
            }
        } catch(e) {
            alert("Backend offline. Temas de making of gerados no mockup!");
            updateSystemStatus("Offline. Temas narrativos gerados em mock.");
        }
    });
    
    btnTranscribe.addEventListener("click", async () => {
        if (!activeVideo) return;
        showSpeedOverlay("Transcrevendo...");
        updateSystemStatus(`Iniciando transcrição de: ${activeVideo.filename}...`, true);
        try {
            const r = await fetch(`/api/video/${activeVideo.id}/transcribe`, { method: "POST" });
            if (r.ok) {
                alert("Transcrição ASR do depoimento iniciada em background via AssemblyAI!");
                updateSystemStatus("Transcrição ASR iniciada em background.");
            }
        } catch(e) {
            alert("Vídeo de depoimento transcrito e diarizado no mockup!");
            updateSystemStatus("Offline. Transcrição ASR gerada em mock.");
        }
    });
    
    btnTranscribeAll.addEventListener("click", async () => {
        showSpeedOverlay("Transcrevendo Tudo...");
        updateSystemStatus("Iniciando transcrição em lote da biblioteca...", true);
        try {
            const r = await fetch(`/api/project/${currentProjectId}/transcribe-all`, { method: "POST" });
            if (r.ok) {
                const data = await r.json();
                alert(data.message);
                updateSystemStatus(`Lote de transcrição iniciado (${data.count} vídeos).`);
            }
        } catch(e) {
            alert("Biblioteca inteira de depoimentos transcrita no mockup!");
            updateSystemStatus("Offline. Transcrição em lote simulada.");
        }
    });
    
    // Salvar e Exportar
    btnSaveTimeline.addEventListener("click", async () => {
        if (activeTimelineCuts.length === 0) return;
        const name = document.getElementById("timeline-name-input").value;
        const payload = {
            name: name,
            project_id: currentProjectId,
            cuts: activeTimelineCuts.map(c => ({
                video_id: c.video_id,
                in_time: c.in,
                out_time: c.out,
                track: c.track
            }))
        };
        
        updateSystemStatus("Salvando timeline...", true);
        try {
            const r = await fetch("/api/timeline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (r.ok) {
                alert("Timeline salva com sucesso no SQLite!");
                updateSystemStatus("Timeline salva com sucesso.");
            }
        } catch(e) {
            alert("Linha do tempo salva temporariamente em cache local.");
            updateSystemStatus("Offline. Timeline salva em cache local.");
        }
    });
    
    btnExportTimeline.addEventListener("click", async () => {
        const format = document.getElementById("select-export-format").value;
        // Simular salvamento primeiro
        btnSaveTimeline.click();
        
        showSpeedOverlay(`Exportando ${format.toUpperCase()}...`);
        try {
            // Em produção real, listamos e exportamos a última timeline criada do projeto
            const r = await fetch(`/api/timeline?project_id=${currentProjectId}`);

            if (r.ok) {
                const list = await r.json();
                if (list.length > 0) {
                    const lastId = list[0].id;
                    // Trigger download de arquivo real
                    window.location.href = `/api/timeline/${lastId}/export/${format}`;
                    return;
                }
            }
        } catch(e) {
            console.warn("Backend offline.");
        }
        
        // Download de mock se API offline
        const mockBlob = new Blob(["CapIAu Mock Timeline Export: Cuts=" + JSON.stringify(activeTimelineCuts)], { type: "text/plain" });
        const url = URL.createObjectURL(mockBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `capiau_export.${format}`;
        a.click();
    });
    
        // Tab Switching (Biblioteca)
    document.querySelectorAll(".sidebar-left .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".sidebar-left .tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".sidebar-left .tab-content").forEach(c => c.classList.remove("active"));
            
            btn.classList.add("active");
            const targetContent = document.getElementById(btn.dataset.tab);
            if (targetContent) {
                targetContent.classList.add("active");
            }
        });
    });
}

// ── FUNÇÕES DE COLLAPSE DE SIDEBARS ───────────────────────────────────

function collapseSidebar(side) {
    if (side === "left") {
        sidebarLeft.classList.add("collapsed");
        reopenLeft.classList.add("visible");
    } else if (side === "right") {
        sidebarRight.classList.add("collapsed");
        reopenRight.classList.add("visible");
    } else if (side === "timeline") {
        timelinePanel.classList.add("collapsed");
        reopenTimeline.classList.add("visible");
    }
}

function expandSidebar(side) {
    if (side === "left") {
        sidebarLeft.classList.remove("collapsed");
        reopenLeft.classList.remove("visible");
    } else if (side === "right") {
        sidebarRight.classList.remove("collapsed");
        reopenRight.classList.remove("visible");
    } else if (side === "timeline") {
        timelinePanel.classList.remove("collapsed");
        reopenTimeline.classList.remove("visible");
    }
}

// ── HELPERS ──────────────────────────────────────────────────────────

function formatTimecode(sec) {
    if (isNaN(sec)) return "00:00:00:00";
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    const frames = Math.floor((sec % 1) * 24); // 24fps
    
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function updateSystemStatus(text, isLoading = false) {
    const statusText = document.getElementById("system-status-text");
    const statusIcon = document.getElementById("system-status-icon");
    if (statusText) {
        statusText.textContent = text;
    }
    if (statusIcon) {
        if (isLoading) {
            statusIcon.className = "fa-solid fa-spinner fa-spin status-icon";
            statusIcon.style.color = "var(--color-cyan)";
        } else {
            statusIcon.className = "fa-solid fa-circle-check status-icon";
            statusIcon.style.color = "var(--color-emerald)";
        }
    }
}

function startProgressPolling() {
    if (progressInterval) return;
    
    progressInterval = setInterval(async () => {
        try {
            // Se o usuário estiver visualizando a aba de Tarefas, atualiza o feed inteiro
            if (currentRightTab === "tasks") {
                renderRightPanelFeed();
            }
            
            const response = await fetch("/api/conversions");
            if (response.ok) {
                const progressData = await response.json();
                activeConversions = progressData; // Atualiza estado global
                const activeIds = Object.keys(progressData);
                
                // Buscar atualizações de todos os vídeos para refletir mudanças de status (como ASR ou Visão completados)
                const resVideos = await fetch(`/api/videos?project_id=${currentProjectId}`);
                if (resVideos.ok) {
                    const videos = await resVideos.json();
                    allVideos = videos;
                    
                    // Atualizar cada card de vídeo no DOM sem destruir a árvore
                    videos.forEach(v => {
                        updateVideoCardDOM(v);
                    });
                }
                
                // Se não há conversões ativas de proxy, e nenhuma outra mídia está transcrevendo/analisando, encerra o loop de polling
                const hasActiveTasks = allVideos.some(v => v.status === "transcribing" || v.status === "processing" || v.status === "analyzing");
                if (activeIds.length === 0 && !hasActiveTasks) {
                    clearInterval(progressInterval);
                    progressInterval = null;
                    return;
                }
                
                // Atualizar progresso de conversão textualmente se o card do proxy ativo for visível
                activeIds.forEach(vidId => {
                    const data = progressData[vidId];
                    const card = document.querySelector(`.media-card[data-video-id="${vidId}"]`);
                    if (card) {
                        const progressEl = card.querySelector(".conversion-progress-text");
                        if (progressEl && data.status === "running") {
                            progressEl.innerHTML = `Convertendo ${data.percent}% <i class="fa-solid fa-spinner fa-spin" style="color:var(--color-cyan);"></i>`;
                        }
                    }
                });
            }
        } catch (e) {
            console.warn("Erro ao buscar progresso.");
        }
    }, 2000);
}

function startListPolling() {
    // Polling contínuo desativado para evitar oscilações visuais e excesso de logs no terminal.
    // Delegamos diretamente para o startProgressPolling para atualizar o estado em tempo real de forma suave.
    startProgressPolling();
}

window.cancelConversion = async function(videoId) {
    updateSystemStatus("Cancelando conversão...", true);
    try {
        const response = await fetch(`/api/video/${videoId}/cancel-conversion`, { method: "POST" });
        if (response.ok) {
            updateSystemStatus("Conversão cancelada.");
            loadVideos();
        } else {
            const err = await response.json();
            alert(err.detail || "Não foi possível cancelar.");
            updateSystemStatus("Erro ao cancelar.");
        }
    } catch(e) {
        updateSystemStatus("Erro de rede ao cancelar.");
    }
};

window.deleteProxy = async function(videoId) {
    if (!confirm("Tem certeza que deseja remover este vídeo completamente do projeto? Isso apagará permanentemente suas transcrições, tags de visão IA e arquivos de proxy locais!")) {
        return;
    }
    updateSystemStatus("Removendo vídeo do projeto...", true);
    try {
        const response = await fetch(`/api/video/${videoId}`, { method: "DELETE" });
        if (response.ok) {
            updateSystemStatus("Vídeo removido com sucesso.");
            
            // Forçar limpeza do player de vídeo se a mídia apagada for a ativa no momento
            if (activeVideo && activeVideo.id === videoId) {
                activeVideo = null;
                activeTranscript = [];
                activeTimelineCuts = [];
                videoPlayer.src = "";
                videoPlayer.load(); // Libera locks de arquivos no Windows
                videoTitleEl.textContent = "Nenhuma mídia selecionada";
                badgeType.textContent = "-";
                badgeResolution.textContent = "-";
                if (markerInPos) markerInPos.style.display = "none";
                if (markerOutPos) markerOutPos.style.display = "none";
                document.getElementById("transcript-feed").innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-microphone-slash"></i>
                        <p>Selecione um depoimento na Biblioteca para carregar a transcrição correspondente.</p>
                    </div>
                `;
            }
            
            await loadVideos();
        } else {
            const err = await response.json();
            alert(err.detail || "Não foi possível remover o vídeo.");
            updateSystemStatus("Erro ao remover vídeo.");
        }
    } catch(e) {
        updateSystemStatus("Erro de rede ao remover vídeo.");
    }
};
