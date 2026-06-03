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
        text: "Com 20 horas de gravação de entrevistas e B-rolls, o CaIAu Talho nos ajuda a encontrar os melhores cortes instantaneamente."
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
let allProjects = [];
let activeVideo = null;
let activeTranscript = [];
let activeTranscriptWords = [];
let activeScissorsMode = false;
let activeVisionFrames = [];
let currentRightTab = "transcript";
let activeTimelineCuts = [];
let markerIn = null;
let markerOut = null;
let allVideos = [];
let allPhotos = [];
const openFoldersSet = new Set();
let progressInterval = null;
let activeConversions = {};
let lastSearchResults = [];
let lastSearchQuery = "";
let currentPhotoList = [];
let currentPhotoIndex = -1;
let isPhotoZoomed = false;
let lastPhotosSerialized = "";
let isTasksGrouped = false;
let wasClusteringRunning = false;
let chatHistory = [];





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
    console.log("CaIAu Talho iniciado.");
    setupProjectListeners();
    setupProjectSyncListeners();
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
            allProjects = projects;
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
                await loadDocuments();
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
    await loadDocuments();
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
        loadDocuments();
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


function setupProjectSyncListeners() {
    const btnSync = document.getElementById("btn-sync-project");
    const modal = document.getElementById("sync-modal");
    const btnCloseHeader = document.getElementById("btn-close-sync-modal");
    const btnCloseFooter = document.getElementById("btn-close-sync");
    
    const driveInput = document.getElementById("sync-drive-link");
    const btnSaveLink = document.getElementById("btn-save-drive-link");
    const lnkOpenDrive = document.getElementById("lnk-open-drive");
    
    const btnRunExport = document.getElementById("btn-run-export");
    const exportStatus = document.getElementById("export-status");
    
    const importDropzone = document.getElementById("sync-import-dropzone");
    const importFileInput = document.getElementById("sync-import-file-input");
    const progressContainer = document.getElementById("sync-import-progress-container");
    const progressFill = document.getElementById("sync-import-progress-fill");
    const progressStatusText = document.getElementById("sync-import-status-text");
    const progressPercentText = document.getElementById("sync-import-percent-text");

    const updateDriveLinkUI = () => {
        const proj = allProjects.find(p => p.id === currentProjectId);
        if (proj && proj.drive_link) {
            driveInput.value = proj.drive_link;
            lnkOpenDrive.href = proj.drive_link;
            lnkOpenDrive.style.pointerEvents = "auto";
            lnkOpenDrive.style.opacity = "1";
        } else {
            driveInput.value = "";
            lnkOpenDrive.href = "#";
            lnkOpenDrive.style.pointerEvents = "none";
            lnkOpenDrive.style.opacity = "0.5";
        }
    };

    // Toggle Modal
    if (btnSync) {
        btnSync.addEventListener("click", () => {
            updateDriveLinkUI();
            modal.classList.add("active");
        });
    }

    const closeModal = () => {
        modal.classList.remove("active");
        progressContainer.style.display = "none";
        progressFill.style.width = "0%";
    };
    
    if (btnCloseHeader) btnCloseHeader.addEventListener("click", closeModal);
    if (btnCloseFooter) btnCloseFooter.addEventListener("click", closeModal);

    // Salvar Link do Drive
    if (btnSaveLink) {
        btnSaveLink.addEventListener("click", async () => {
            const link = driveInput.value.trim();
            btnSaveLink.disabled = true;
            btnSaveLink.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Salvando...`;
            
            try {
                const response = await fetch(`/api/project/${currentProjectId}/drive-link`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ drive_link: link })
                });
                
                if (response.ok) {
                    const proj = allProjects.find(p => p.id === currentProjectId);
                    if (proj) proj.drive_link = link;
                    
                    updateDriveLinkUI();
                    alert("Link do Google Drive salvo com sucesso!");
                } else {
                    alert("Erro ao salvar link do Drive.");
                }
            } catch (e) {
                alert("Erro ao salvar link. Backend offline?");
            } finally {
                btnSaveLink.disabled = false;
                btnSaveLink.innerHTML = "Salvar Link";
            }
        });
    }

    // Executar Exportação
    if (btnRunExport) {
        btnRunExport.addEventListener("click", async () => {
            btnRunExport.disabled = true;
            exportStatus.style.display = "block";
            
            const includeProxies = document.getElementById("chk-export-proxies").checked;
            const includePhotos = document.getElementById("chk-export-photos").checked;
            const includeDocs = document.getElementById("chk-export-docs").checked;
            
            try {
                const response = await fetch(`/api/project/${currentProjectId}/export`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        include_metadata: true,
                        include_proxies: includeProxies,
                        include_photos: includePhotos,
                        include_docs: includeDocs
                    })
                });
                
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    
                    const cd = response.headers.get("Content-Disposition");
                    let filename = `caiau_export_project_${currentProjectId}.zip`;
                    if (cd && cd.includes("filename=")) {
                        filename = cd.split("filename=")[1].replace(/"/g, "");
                    }
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    const errText = await response.text();
                    alert(`Erro ao exportar projeto: ${errText}`);
                }
            } catch (e) {
                alert(`Erro ao conectar ao servidor para exportação: ${e.message}`);
            } finally {
                btnRunExport.disabled = false;
                exportStatus.style.display = "none";
            }
        });
    }

    // Importação: Drag & Drop e Clique
    if (importDropzone) {
        importDropzone.addEventListener("click", () => {
            importFileInput.click();
        });

        importFileInput.addEventListener("change", (e) => {
            if (e.target.files.length > 0) {
                handleImportFile(e.target.files[0]);
            }
        });

        importDropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            importDropzone.classList.add("dragover");
        });

        importDropzone.addEventListener("dragleave", () => {
            importDropzone.classList.remove("dragover");
        });

        importDropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            importDropzone.classList.remove("dragover");
            if (e.dataTransfer.files.length > 0) {
                handleImportFile(e.dataTransfer.files[0]);
            }
        });
    }

    const handleImportFile = (file) => {
        if (!file.name.endsWith(".zip")) {
            alert("Por favor, selecione apenas arquivos do tipo pacote .ZIP!");
            return;
        }
        
        progressContainer.style.display = "block";
        progressFill.style.width = "0%";
        progressPercentText.textContent = "0%";
        progressStatusText.textContent = "Enviando arquivo...";
        
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/project/import", true);
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = `${percent}%`;
                progressPercentText.textContent = `${percent}%`;
                if (percent === 100) {
                    progressStatusText.textContent = "Descompactando e reindexando IA locais (CPU)...";
                }
            }
        };
        
        xhr.onload = async () => {
            if (xhr.status === 200) {
                try {
                    const res = JSON.parse(xhr.responseText);
                    progressFill.style.width = "100%";
                    progressPercentText.textContent = "100%";
                    progressStatusText.textContent = "Projeto importado!";
                    
                    alert("Projeto importado com sucesso! O novo projeto foi carregado.");
                    
                    currentProjectId = res.project_id;
                    closeModal();
                    
                    await loadProjects();
                } catch (e) {
                    alert(`Projeto importado, mas falha ao recarregar a interface: ${e.message}`);
                }
            } else {
                alert(`Erro na importação do projeto: ${xhr.responseText || "Erro no servidor"}`);
                progressContainer.style.display = "none";
            }
        };
        
        xhr.onerror = () => {
            alert("Erro de conexão ao tentar importar o projeto.");
            progressContainer.style.display = "none";
        };
        
        const formData = new FormData();
        formData.append("file", file);
        xhr.send(formData);
    };
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
            filterAndRenderLibrary();
            updateSystemStatus("Mídias atualizadas.");
            return;
        }
    } catch (e) {
        console.warn("Backend offline ou erro ao carregar vídeos. Carregando mock de segurança.");
    }
    allVideos = MOCK_VIDEOS;
    filterAndRenderLibrary();
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
            
            // Verificar se clicou em um botão de ação de pasta
            const actionBtn = e.target.closest(".btn-folder-action");
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const path = folderHeader.dataset.folderPath;
                expandCollapseAllSubfolders(path, action === "expand");
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
        
        // Renderizar filhos recursivamente (pastas primeiro, depois arquivos)
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
            // Ambos são arquivos (vídeos)
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
    // Usa allVideos (não-filtrado) para garantir que o polling seja ativado mesmo com filtros ativos
    const hasActiveConversions = allVideos.some(v => v.status === "transcribing" || v.status === "processing" || v.status === "analyzing");
    if (hasActiveConversions) {
        startProgressPolling();
    }
}

async function loadPhotos() {
    updateSystemStatus("Carregando fotos de set...", true);
    
    try {
        const response = await fetch(`/api/photos?project_id=${currentProjectId}`);

        if (response.ok) {
            const data = await response.json();
            allPhotos = data; // Armazena globalmente
            filterAndRenderPhotos();
            updateSystemStatus("Fotos atualizadas.");
            
            // Iniciar polling se houver alguma foto pendente
            const hasPendingPhotos = data.some(p => p.status === "pending");
            if (hasPendingPhotos) {
                startProgressPolling();
            }
            return;
        }
    } catch (e) {
        console.warn("Erro ao carregar fotos. Carregando mock.");
    }
    allPhotos = MOCK_PHOTOS;
    filterAndRenderPhotos();
    updateSystemStatus("Pronto.");
}

function renderPhotos(photos) {
    currentPhotoList = photos; // Salva a lista global de fotos atualmente renderizadas para o carrossel
    const listContainer = document.getElementById("photo-list");
    
    // Serializar dados chave para verificar se algo relevante mudou (evitando recriar nós e dar flicker)
    const serialized = JSON.stringify(photos.map(p => ({ id: p.id, status: p.status, proxy_path: p.proxy_path, filename: p.filename })));
    if (lastPhotosSerialized === serialized && listContainer && listContainer.children.length > 0) {
        return; // Sem alterações visuais e contêiner já preenchido, não recria o DOM
    }
    lastPhotosSerialized = serialized;
    
    if (listContainer) {
        listContainer.innerHTML = "";
    }
    
    photos.forEach(p => {
        const card = document.createElement("div");
        card.className = "photo-card";
        
        // Tratar caminhos absolutos locais vs urls de mock vs proxy path
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
            card.addEventListener("click", () => {
                openPhotoViewer(p);
            });
            card.style.cursor = "pointer";
        } else {
            card.style.cursor = "not-allowed";
            card.title = "Aguarde o processamento do arquivo RAW para visualizar.";
        }
        
        listContainer.appendChild(card);
    });
}

function filterAndRenderLibrary() {
    const filterStatus = document.getElementById("library-filter-status")?.value || "all";
    let filteredVideos = [...allVideos];
    
    // 1. Filtrar por status
    if (filterStatus === "pending") {
        filteredVideos = filteredVideos.filter(v => 
            v.status === "pending" || 
            v.status === "ingested" || 
            v.status === "transcribing" || 
            v.status === "processing" || 
            v.status === "analyzing"
        );
    } else if (filterStatus === "processed") {
        filteredVideos = filteredVideos.filter(v => 
            v.status === "transcribed" || 
            v.status === "analyzed"
        );
    } else if (filterStatus === "error") {
        filteredVideos = filteredVideos.filter(v => v.status === "error");
    }
    
    renderVideos(filteredVideos);
}

function filterAndRenderPhotos() {
    const filterStatus = document.getElementById("library-filter-status")?.value || "all";
    const sortBy = document.getElementById("library-sort-by")?.value || "name_asc";
    
    let filteredPhotos = [...allPhotos];
    
    // 1. Filtrar por status
    if (filterStatus === "pending") {
        filteredPhotos = filteredPhotos.filter(p => p.status === "pending" || p.status === "ingested");
    } else if (filterStatus === "processed") {
        filteredPhotos = filteredPhotos.filter(p => p.status === "analyzed" || (!p.status && p.proxy_path) || (p.status !== "pending" && p.status !== "error" && p.status !== "ingested"));
    } else if (filterStatus === "error") {
        filteredPhotos = filteredPhotos.filter(p => p.status === "error");
    }
    
    // 2. Ordenar por metadados
    filteredPhotos.sort((a, b) => {
        if (sortBy === "name_asc") {
            return (a.filename || "").localeCompare(b.filename || "");
        } else if (sortBy === "name_desc") {
            return (b.filename || "").localeCompare(a.filename || "");
        } else if (sortBy === "date_desc") {
            return (b.id || 0) - (a.id || 0);
        } else {
            return (a.filename || "").localeCompare(b.filename || "");
        }
    });
    
    renderPhotos(filteredPhotos);
}

window.expandCollapseAllSubfolders = function(folderPath, expand) {
    const filepaths = allVideos.map(v => v.filepath.replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    const folderPaths = new Set();
    allVideos.forEach(v => {
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

    filterAndRenderLibrary();
};

window.globalExpandCollapseAll = function(expand) {
    const filepaths = allVideos.map(v => v.filepath.replace(/\\/g, "/"));
    const commonBase = getCommonBasePath(filepaths);
    
    allVideos.forEach(v => {
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

    filterAndRenderLibrary();
};

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
    
    if (themes.length === 0) {
        listContainer.innerHTML = `
            <div style="color:var(--text-muted); font-size:11px; padding:12px; text-align:center;">
                Nenhum tema catalogado ainda. Clique em "Agrupar Temas" no cabeçalho para gerar o clustering por IA!
            </div>
        `;
        return;
    }
    
    themes.forEach(t => {
        const card = document.createElement("div");
        card.className = "media-card";
        card.style.flexDirection = "column";
        card.style.alignItems = "flex-start";
        card.style.gap = "6px";
        card.style.padding = "12px";
        
        card.innerHTML = `
            <h4 style="color: var(--color-cyan); margin: 0; font-size: 12px; font-weight: 600;"><i class="fa-solid fa-brain"></i> ${t.title}</h4>
            <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.4;">${t.description}</p>
            <div style="display:flex; gap:6px; margin-top:6px; width: 100%;">
                <button class="btn-primary btn-theme-search" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; border: none;" data-title="${t.title}">
                    <i class="fa-solid fa-magnifying-glass"></i> Buscar Cortes
                </button>
                <button class="btn-secondary btn-theme-chat" style="padding: 4px 8px; font-size: 9px; height: 22px; display: flex; align-items: center; gap: 4px; border-radius: 4px; cursor: pointer; color: var(--text-primary); border: none;" data-title="${t.title}">
                    <i class="fa-solid fa-comments"></i> Perguntar IA
                </button>
            </div>
        `;
        
        // Listeners
        const searchBtn = card.querySelector(".btn-theme-search");
        searchBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const title = searchBtn.getAttribute("data-title");
            searchInput.value = title;
            filterSelect.value = ""; // todas as mídias
            runSemanticSearch();
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
        
        listContainer.appendChild(card);
    });
}

async function loadDocuments() {
    const listContainer = document.getElementById("doc-list");
    if (!listContainer) return;
    listContainer.innerHTML = "<div class='loading' style='font-size:11px; color:var(--text-muted);'>Carregando documentos...</div>";
    
    try {
        const response = await fetch(`/api/project/${currentProjectId}/docs`);
        if (response.ok) {
            const data = await response.json();
            renderDocuments(data);
        } else {
            listContainer.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado.</div>";
        }
    } catch (e) {
        listContainer.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
    }
}

function renderDocuments(docs) {
    const listContainer = document.getElementById("doc-list");
    if (!listContainer) return;
    listContainer.innerHTML = "";
    
    if (docs.length === 0) {
        listContainer.innerHTML = "<div style='color:var(--text-muted); font-size:11px; padding:8px;'>Nenhum documento cadastrado. Importe um roteiro acima!</div>";
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
            <button class="btn-card-action" style="color:var(--color-rose); background:transparent; border:none; cursor:pointer;" onclick="deleteDocument(${doc.id})" title="Deletar Documento"><i class="fa-solid fa-trash-can"></i></button>
        `;
        
        listContainer.appendChild(card);
    });
}

window.deleteDocument = async function(docId) {
    if (!confirm("Tem certeza que deseja remover este documento? Seus dados indexados no Qdrant também serão excluídos!")) {
        return;
    }
    updateSystemStatus("Removendo documento...", true);
    try {
        const response = await fetch(`/api/docs/${docId}?project_id=${currentProjectId}`, {
            method: "DELETE"
        });
        if (response.ok) {
            updateSystemStatus("Documento deletado.");
            await loadDocuments();
        } else {
            alert("Erro ao deletar documento.");
            updateSystemStatus("Falha ao deletar documento.");
        }
    } catch (e) {
        updateSystemStatus("Erro de rede.");
    }
}

function updateActionsRowVisibility() {
    const asrActionsRow = document.getElementById("asr-actions-row");
    const visionActionsRow = document.getElementById("vision-actions-row");
    if (asrActionsRow && visionActionsRow) {
        if (currentRightTab === "transcript") {
            asrActionsRow.style.display = "flex";
            visionActionsRow.style.display = "none";
        } else if (currentRightTab === "vision") {
            asrActionsRow.style.display = "none";
            visionActionsRow.style.display = "flex";
        } else {
            asrActionsRow.style.display = "none";
            visionActionsRow.style.display = "none";
        }
    }
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
    
    // Gerenciar visibilidade das abas da barra lateral direita de forma dinâmica
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    const btnTabVision = document.getElementById("btn-tab-vision");
    const btnTabTasks = document.getElementById("btn-tab-tasks");
    const btnTabSearch = document.getElementById("btn-tab-search");
    
    // Ocultar Visão IA se não for B-Roll
    if (video.video_type === "broll") {
        if (btnTabVision) btnTabVision.style.display = "block";
    } else {
        if (btnTabVision) btnTabVision.style.display = "none";
        // Se a aba ativa era Visão IA mas o vídeo atual é depoimento, volta para Falas
        if (currentRightTab === "vision") {
            currentRightTab = "transcript";
        }
    }
    
    // Atualizar as classes ativas de destaque nas abas
    if (btnTabTranscript) btnTabTranscript.classList.remove("active");
    if (btnTabVision) btnTabVision.classList.remove("active");
    if (btnTabTasks) btnTabTasks.classList.remove("active");
    if (btnTabSearch) btnTabSearch.classList.remove("active");
    
    if (currentRightTab === "transcript") {
        if (btnTabTranscript) btnTabTranscript.classList.add("active");
    } else if (currentRightTab === "vision") {
        if (btnTabVision) btnTabVision.classList.add("active");
    } else if (currentRightTab === "tasks") {
        if (btnTabTasks) btnTabTasks.classList.add("active");
    } else if (currentRightTab === "search") {
        if (btnTabSearch) btnTabSearch.classList.add("active");
    }
    
    updateActionsRowVisibility();
    
    // Carrega transcrições/descrições visuais
    await loadTranscript(video);
}

async function loadTranscript(video) {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "<div class='loading'>Carregando dados...</div>";
    
    activeTranscript = [];
    activeTranscriptWords = [];
    activeVisionFrames = [];
    
    // 1. Tentar sempre carregar falas/transcrições se existirem
    try {
        const response = await fetch(`/api/video/${video.id}/transcript`);
        if (response.ok) {
            const data = await response.json();
            if (data.dialogues && data.dialogues.length > 0) {
                activeTranscript = data.dialogues;
                activeTranscriptWords = data.words || [];
            }
        }
    } catch (e) {
        console.warn("Erro ao buscar transcrição.");
    }
    
    // Fallback do Mock para entrevista de depoimento principal se estiver vazio/offline
    if (video.video_type === "interview" && activeTranscript.length === 0) {
        activeTranscript = MOCK_TRANSCRIPT_1;
        activeTranscriptWords = [];
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
    
    if (currentRightTab === "tasks") {
        renderTasksTab();
        return;
    }
    
    if (currentRightTab === "chat") {
        renderChatTab();
        return;
    }
    
    feed.innerHTML = "";
    
    if (currentRightTab === "search") {
        renderSearchResults(lastSearchResults, lastSearchQuery);
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
    
    // Se o cabeçalho e o contêiner de lista não existem, renderiza a estrutura inicial
    let listContainer = document.getElementById("tasks-list-container");
    if (!listContainer) {
        feed.innerHTML = `
            <div class="transcription-actions" style="border:none; margin-bottom:12px; padding-bottom: 0;">
                <h4 style="font-size:12px; color:var(--color-cyan); display:flex; align-items:center; justify-content:space-between; width:100%; margin:0;">
                    <span><i class="fa-solid fa-list-check"></i> Fila de Tarefas</span>
                    <div style="display:flex; align-items:center; gap:10px; margin-left:auto;">
                        <label style="font-size:10px; color:var(--text-secondary); display:flex; align-items:center; gap:4px; cursor:pointer; font-weight:normal; margin:0; user-select:none;">
                            <input type="checkbox" id="chk-tasks-grouped" ${isTasksGrouped ? 'checked' : ''} style="cursor:pointer; margin:0;"> Agrupar
                        </label>
                        <button class="btn-outline" onclick="loadVideos();" style="font-size:10px; padding:2px 8px; display:flex; align-items:center; gap:4px; height: 24px;">
                            <i class="fa-solid fa-arrows-rotate"></i> Atualizar
                        </button>
                    </div>
                </h4>
            </div>
            <div id="tasks-list-container" style="display:flex; flex-direction:column; gap:10px;"></div>
        `;
        listContainer = document.getElementById("tasks-list-container");
        
        // Registrar escuta do checkbox
        const chk = document.getElementById("chk-tasks-grouped");
        if (chk) {
            chk.addEventListener("change", (e) => {
                isTasksGrouped = e.target.checked;
                renderTasksTab();
            });
        }
    }
    
    const conversions = activeConversions || {};
    
    // Obter tarefas de vídeo
    const videoTasks = allVideos.filter(v => 
        v.status === "transcribing" || 
        v.status === "processing" || 
        v.status === "analyzing" || 
        v.status === "error"
    ).map(v => ({
        id: `video-${v.id}`,
        dbId: v.id,
        type: "video",
        filename: v.filename,
        status: v.status,
        errorMessage: v.error_message
    }));
    
    // Obter tarefas de foto
    let photoTasks = [];
    let photos = [];
    try {
        const photoResponse = await fetch(`/api/photos?project_id=${currentProjectId}`);
        if (photoResponse.ok) {
            photos = await photoResponse.json();
            photoTasks = photos.filter(p => 
                p.status === "pending" || 
                p.status === "error"
            ).map(p => ({
                id: `photo-${p.id}`,
                dbId: p.id,
                type: "photo",
                filename: p.filename,
                status: p.status,
                errorMessage: p.status === 'error' ? "Arquivo de imagem corrompido ou formato RAW incompatível." : null
            }));
        }
    } catch (e) {
        console.warn("Erro ao buscar tarefas de fotos:", e);
    }
    
    // Mesclar todas as tarefas
    const activeTasks = [...videoTasks, ...photoTasks];
    
    if (activeTasks.length === 0) {
        listContainer.innerHTML = `
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
    
    // Se visualização agrupada estiver ativa, renderiza resumos consolidados
    if (isTasksGrouped) {
        const videoConvertingCount = Object.keys(conversions).length;
        const videoTranscribingCount = allVideos.filter(v => v.status === "transcribing").length;
        const videoAnalyzingCount = allVideos.filter(v => v.status === "analyzing").length;
        const videoFailedCount = allVideos.filter(v => v.status === "error").length;
        const photoPendingCount = photos.filter(p => p.status === "pending").length;
        const photoFailedCount = photos.filter(p => p.status === "error").length;
        
        const groups = [
            {
                label: "Convertendo Proxies de Vídeo",
                count: videoConvertingCount,
                icon: "fa-spinner fa-spin",
                color: "var(--color-cyan)",
                desc: "FFmpeg processando mídias em background."
            },
            {
                label: "Transcrevendo Depoimentos (ASR)",
                count: videoTranscribingCount,
                icon: "fa-spinner fa-spin",
                color: "var(--color-cyan)",
                desc: "AssemblyAI gerando transcrição palavra-a-palavra e diarização."
            },
            {
                label: "Analisando Bastidores (Visão IA)",
                count: videoAnalyzingCount,
                icon: "fa-spinner fa-spin",
                color: "var(--color-violet)",
                desc: "Processamento multimodal de frames no OpenRouter."
            },
            {
                label: "Gerando Proxies de Foto WebP",
                count: photoPendingCount,
                icon: "fa-spinner fa-spin",
                color: "var(--color-cyan)",
                desc: "Conversão Pillow/rawpy para formato WebP otimizado."
            },
            {
                label: "Falhas em Vídeos",
                count: videoFailedCount,
                icon: "fa-triangle-exclamation",
                color: "var(--color-rose)",
                desc: "Erros no processamento ou transcrição de mídias."
            },
            {
                label: "Falhas em Fotos",
                count: photoFailedCount,
                icon: "fa-triangle-exclamation",
                color: "var(--color-rose)",
                desc: "Erros ao ler arquivo ou gerar proxy WebP."
            }
        ];
        
        const activeGroups = groups.filter(g => g.count > 0);
        
        // Remover grupos que deixaram de ser ativos
        const activeGroupIds = new Set(activeGroups.map(g => `task-group-${g.label.replace(/\s+/g, '-').toLowerCase()}`));
        listContainer.querySelectorAll("[data-group-id]").forEach(card => {
            const groupId = card.getAttribute("data-group-id");
            if (!activeGroupIds.has(groupId)) {
                card.remove();
            }
        });
        
        // Remover elementos de tarefas individuais no modo agrupado
        listContainer.querySelectorAll("[data-task-id]").forEach(card => card.remove());
        
        activeGroups.forEach(g => {
            const groupId = `task-group-${g.label.replace(/\s+/g, '-').toLowerCase()}`;
            let groupCard = document.getElementById(groupId);
            const isNew = !groupCard;
            
            if (isNew) {
                groupCard = document.createElement("div");
                groupCard.id = groupId;
                groupCard.setAttribute("data-group-id", groupId);
                groupCard.className = "transcript-bubble";
                groupCard.style.marginBottom = "0px";
                groupCard.style.padding = "12px";
                groupCard.style.cursor = "default";
            }
            
            groupCard.style.borderColor = g.color === "var(--color-rose)" ? "rgba(244, 63, 94, 0.3)" : "var(--border-glass-glow)";
            groupCard.style.background = g.color === "var(--color-rose)" ? "rgba(244, 63, 94, 0.03)" : "rgba(255,255,255,0.02)";
            
            const innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:600; font-size:11px; color:var(--text-secondary);">
                        <i class="fa-solid ${g.icon}" style="margin-right: 6px; color: ${g.color};"></i> ${g.label}
                    </span>
                    <span class="badge" style="font-size:10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-secondary);">
                        ${g.count} ${g.count === 1 ? 'arquivo' : 'arquivos'}
                    </span>
                </div>
                <p style="font-size:10px; color:var(--text-muted); margin:0; line-height:1.4;">
                    ${g.desc}
                </p>
            `;
            
            if (groupCard.innerHTML !== innerHTML) {
                groupCard.innerHTML = innerHTML;
            }
            
            if (isNew) {
                listContainer.appendChild(groupCard);
            }
        });
        
        return;
    }
    
    // Se a visualização detalhada estiver ativa, precisamos garantir que o DOM anterior (agrupado) seja limpo
    listContainer.querySelectorAll("[data-group-id]").forEach(card => card.remove());
    const firstBubble = listContainer.querySelector(".transcript-bubble");
    if (firstBubble && !firstBubble.hasAttribute("data-task-id")) {
        listContainer.innerHTML = "";
    }
    
    // Remover o empty-state do container se existirem tarefas ativas
    const emptyState = listContainer.querySelector(".empty-state");
    if (emptyState) {
        listContainer.innerHTML = "";
    }
    
    // Mapear IDs de tarefas ativas atuais
    const activeTaskIds = new Set(activeTasks.map(t => t.id));
    
    // Remover do DOM as tarefas que não estão mais ativas
    listContainer.querySelectorAll("[data-task-id]").forEach(card => {
        const taskId = card.getAttribute("data-task-id");
        if (!activeTaskIds.has(taskId)) {
            card.remove();
        }
    });
    
    // Atualizar ou criar cada card de tarefa
    activeTasks.forEach(t => {
        let taskCard = document.getElementById(`task-card-${t.id}`);
        const isNew = !taskCard;
        
        if (isNew) {
            taskCard = document.createElement("div");
            taskCard.id = `task-card-${t.id}`;
            taskCard.setAttribute("data-task-id", t.id);
            taskCard.className = "transcript-bubble";
            taskCard.style.marginBottom = "0px";
            taskCard.style.padding = "12px";
            taskCard.style.cursor = "default";
        }
        
        taskCard.style.borderColor = t.status === "error" ? "rgba(244, 63, 94, 0.3)" : "var(--border-glass-glow)";
        taskCard.style.background = t.status === "error" ? "rgba(244, 63, 94, 0.03)" : "rgba(255,255,255,0.02)";
        
        let statusTitle = "";
        let statusIcon = "";
        let details = "";
        let actionBtn = "";
        
        if (t.type === "video") {
            if (t.status === "transcribing" || t.status === "processing") {
                const convData = conversions[t.dbId];
                if (convData) {
                    const percent = convData.percent !== undefined ? convData.percent : 0;
                    statusTitle = `Convertendo (${percent}%)`;
                    statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);"></i>`;
                    details = "FFmpeg convertendo vídeo para proxy de visualização leve.";
                    actionBtn = `<button class="btn-outline" style="color:var(--color-rose); font-size:10px; padding:4px 8px; border-color: rgba(244, 63, 94, 0.3);" onclick="cancelConversion(${t.dbId}); event.stopPropagation();">Cancelar</button>`;
                } else {
                    statusTitle = "Transcrevendo (ASR)";
                    statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);"></i>`;
                    details = "AssemblyAI analisando áudio e gerando falas na nuvem.";
                    actionBtn = ``;
                }
            } else if (t.status === "analyzing") {
                statusTitle = "Visão IA";
                statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-violet);"></i>`;
                details = "Extraindo frames e descrevendo o conteúdo visual via IA.";
                actionBtn = `<button class="btn-outline" style="color:var(--color-rose); font-size:10px; padding:4px 8px; border-color: rgba(244, 63, 94, 0.3);" onclick="cancelConversion(${t.dbId}); event.stopPropagation();">Cancelar</button>`;
            } else if (t.status === "error") {
                statusTitle = "Falha";
                statusIcon = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);"></i>`;
                details = t.errorMessage || "Erro desconhecido durante a conversão ou transcrição.";
                actionBtn = `
                    <div style="display:flex; gap:6px;">
                        <button class="btn-secondary" style="font-size:10px; padding:4px 8px; display:flex; align-items:center; gap:4px; height: 26px;" onclick="retrySingleVideo(${t.dbId}); event.stopPropagation();">
                            <i class="fa-solid fa-arrows-rotate"></i> Tentar Novamente
                        </button>
                        <button class="btn-outline" style="color:var(--text-secondary); font-size:10px; padding:4px 8px; height: 26px;" onclick="deleteProxy(${t.dbId}); event.stopPropagation();">
                            Remover
                        </button>
                    </div>
                `;
            }
        } else if (t.type === "photo") {
            if (t.status === "pending") {
                statusTitle = "Gerando Proxy";
                statusIcon = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--color-cyan);"></i>`;
                details = "Criando proxy WebP otimizado (1024px) para visualização rápida na web.";
                actionBtn = ``;
            } else if (t.status === "error") {
                statusTitle = "Falha";
                statusIcon = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-rose);"></i>`;
                details = t.errorMessage || "Arquivo de imagem corrompido ou formato RAW incompatível.";
                actionBtn = `
                    <div style="display:flex; gap:6px;">
                        <button class="btn-secondary" style="font-size:10px; padding:4px 8px; display:flex; align-items:center; gap:4px; height: 26px;" onclick="retrySinglePhoto(${t.dbId}); event.stopPropagation();">
                            <i class="fa-solid fa-arrows-rotate"></i> Tentar Novamente
                        </button>
                        <button class="btn-outline" style="color:var(--text-secondary); font-size:10px; padding:4px 8px; height: 26px;" onclick="deletePhoto(${t.dbId}); event.stopPropagation();">
                            Remover
                        </button>
                    </div>
                `;
            }
        }
        
        const innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap:8px;">
                <span style="font-weight:600; font-size:11px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" title="${t.filename}">
                    <i class="fa-solid ${t.type === 'photo' ? 'fa-image' : 'fa-film'}" style="margin-right: 4px; color: ${t.type === 'photo' ? '#f59e0b' : 'var(--color-violet)'};"></i> ${t.filename}
                </span>
                <span style="font-size:10px; font-weight:500; display:flex; align-items:center; gap:4px; color:${t.status === 'error' ? 'var(--color-rose)' : 'var(--color-cyan)'}; flex-shrink:0;">
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
        
        // Evita re-renderização se o conteúdo interno for idêntico, prevenindo flicker
        if (taskCard.innerHTML !== innerHTML) {
            taskCard.innerHTML = innerHTML;
        }
        
        if (isNew) {
            listContainer.appendChild(taskCard);
        }
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

window.retrySinglePhoto = async function(photoId) {
    showSpeedOverlay("Reprocessando...");
    updateSystemStatus("Reiniciando tarefa...", true);
    try {
        const response = await fetch(`/api/photo/${photoId}/retry`, { method: "POST" });
        if (response.ok) {
            updateSystemStatus("Tarefa de foto reiniciada.");
            startProgressPolling(); // Garantir que o polling está rodando para capturar a atualização
            await loadPhotos();
        } else {
            const err = await response.json();
            alert(err.detail || "Não foi possível reiniciar.");
            updateSystemStatus("Falha ao reiniciar tarefa.");
        }
    } catch(e) {
        updateSystemStatus("Erro de rede.");
    }
};

window.deletePhoto = async function(photoId) {
    if (!confirm("Tem certeza que deseja remover esta foto permanentemente do projeto? Isso apagará o arquivo de proxy local e removerá seu registro.")) {
        return;
    }
    updateSystemStatus("Removendo foto...", true);
    try {
        const response = await fetch(`/api/photo/${photoId}`, { method: "DELETE" });
        if (response.ok) {
            updateSystemStatus("Foto removida com sucesso.");
            await loadPhotos();
        } else {
            const err = await response.json();
            alert(err.detail || "Não foi possível remover a foto.");
            updateSystemStatus("Erro ao remover foto.");
        }
    } catch(e) {
        updateSystemStatus("Erro de rede ao remover foto.");
    }
};

function getMockWordsForDialogue(dialogue) {
    const text = dialogue.text;
    const words = text.split(/\s+/).filter(Boolean);
    const start = dialogue.start_time;
    const end = dialogue.end_time;
    const duration = end - start;
    const wordDuration = duration / Math.max(words.length, 1);
    
    return words.map((w, index) => ({
        word: w,
        start_time: start + index * wordDuration,
        end_time: start + (index + 1) * wordDuration,
        speaker_id: dialogue.speaker_id,
        confidence: 1.0
    }));
}

async function performTranscriptSplit(videoId, startTime, newSpeakerId) {
    updateSystemStatus("Dividindo bloco de fala...", true);
    try {
        const response = await fetch(`/api/video/${videoId}/split-transcript`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                start_time: startTime,
                new_speaker_id: newSpeakerId
            })
        });
        if (response.ok) {
            updateSystemStatus("Bloco de fala dividido com sucesso.");
            await loadVideos();
            if (activeVideo) {
                await selectVideo(activeVideo);
            }
        } else {
            const err = await response.json();
            alert("Erro ao dividir: " + (err.detail || "Desconhecido"));
            updateSystemStatus("Falha ao dividir.");
        }
    } catch (e) {
        alert("Erro de rede ao dividir a transcrição.");
        updateSystemStatus("Erro de rede.");
    }
}

function createBubbleDOM(d, idx) {
    const bubble = document.createElement("div");
    bubble.className = "transcript-bubble";
    bubble.setAttribute("data-dialogue-index", idx);
    
    // Find words belonging to this dialogue block
    let bubbleWords = [];
    if (activeTranscriptWords && activeTranscriptWords.length > 0) {
        bubbleWords = activeTranscriptWords.filter(w => w.start_time >= d.start_time && w.start_time <= d.end_time);
    }
    
    if (bubbleWords.length === 0) {
        bubbleWords = getMockWordsForDialogue(d);
    }
    
    const metaDiv = document.createElement("div");
    metaDiv.className = "bubble-meta";
    
    const speakerSpan = document.createElement("span");
    speakerSpan.className = "speaker-name";
    speakerSpan.textContent = d.speaker_id;
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "bubble-time";
    timeSpan.textContent = formatTimecode(d.start_time);
    
    metaDiv.appendChild(speakerSpan);
    metaDiv.appendChild(timeSpan);
    
    // Scissors button for splitting ASR transcript block
    const splitBtn = document.createElement("button");
    splitBtn.className = "btn-card-action split-btn";
    splitBtn.innerHTML = '<i class="fa-solid fa-scissors"></i>';
    splitBtn.title = "Dividir falas (Tesoura)";
    splitBtn.style.marginLeft = "auto";
    splitBtn.style.color = "var(--text-muted)";
    splitBtn.style.cursor = "pointer";
    splitBtn.style.background = "transparent";
    splitBtn.style.border = "none";
    
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
                videoPlayer.currentTime = w.start_time;
                playVideo();
            }
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
    
    // Toggle scissors split mode
    splitBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!bubble.classList.contains("scissors-active")) {
            // Cancel other active split bubbles first
            document.querySelectorAll(".transcript-bubble.scissors-active").forEach(el => {
                el.classList.remove("scissors-active");
                const bBtn = el.querySelector(".split-btn");
                if (bBtn) bBtn.style.color = "var(--text-muted)";
            });
            
            bubble.classList.add("scissors-active");
            splitBtn.style.color = "var(--color-cyan)";
            updateSystemStatus("Clique em uma palavra do balão para selecionar o ponto de divisão.");
        } else {
            if (selectedWordForSplit) {
                const newSpeaker = prompt("Digite o ID/Nome do novo falante:", d.speaker_id + "_2");
                if (newSpeaker) {
                    await performTranscriptSplit(activeVideo.id, selectedWordForSplit.start_time, newSpeaker);
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
        videoPlayer.currentTime = d.start_time;
        playVideo();
    });
    
    return bubble;
}

function highlightAndScrollToDialogue(startTime) {
    // Switch to transcript tab if not active
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    if (btnTabTranscript) btnTabTranscript.click();
    
    setTimeout(() => {
        const bubbles = document.querySelectorAll(".transcript-bubble");
        let targetBubble = null;
        let minDiff = Infinity;
        
        bubbles.forEach(b => {
            const idx = b.getAttribute("data-dialogue-index");
            if (idx !== null) {
                const d = activeTranscript[idx];
                if (d) {
                    const diff = Math.abs(d.start_time - startTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        targetBubble = b;
                    }
                }
            }
        });
        
        if (targetBubble) {
            targetBubble.scrollIntoView({ behavior: "smooth", block: "center" });
            targetBubble.classList.add("highlight-glow");
            setTimeout(() => {
                targetBubble.classList.remove("highlight-glow");
            }, 3000);
        }
    }, 500);
}

function renderTranscript(dialogues) {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "";
    activeTranscript = dialogues;
    
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
            const bubble = createBubbleDOM(item.dialogue, item.originalIndex);
            feed.appendChild(bubble);
        } else {
            const overlapContainer = document.createElement("div");
            overlapContainer.className = "overlap-row";
            overlapContainer.style.display = "flex";
            overlapContainer.style.flexDirection = "row";
            overlapContainer.style.gap = "10px";
            overlapContainer.style.width = "100%";
            overlapContainer.style.marginBottom = "10px";
            
            group.forEach(item => {
                const bubble = createBubbleDOM(item.dialogue, item.originalIndex);
                bubble.style.flex = "1";
                bubble.style.marginBottom = "0px";
                bubble.classList.add("overlap-bubble");
                overlapContainer.appendChild(bubble);
            });
            
            feed.appendChild(overlapContainer);
        }
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

// Função para destacar os termos da busca com <mark>
function highlightTerms(text, query) {
    if (!query) return text;
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.trim().length > 2);
    if (terms.length === 0) return text;
    
    let highlightedText = text;
    terms.forEach(term => {
        // Escapar caracteres especiais para o regex
        const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Regex case-insensitive que não pega dentro de tags HTML
        const regex = new RegExp(`(${escapedTerm})(?![^<]*>)`, "gi");
        highlightedText = highlightedText.replace(regex, `<mark class="search-highlight">$1</mark>`);
    });
    return highlightedText;
}

// Visualizador de foto premium com Carrossel e Zoom
function openPhotoViewer(photoOrIndex) {
    const modal = document.getElementById("photo-viewer-modal");
    const imgEl = document.getElementById("photo-viewer-img");
    const titleEl = document.getElementById("photo-viewer-title");
    const descEl = document.getElementById("photo-viewer-desc");
    const tagsEl = document.getElementById("photo-viewer-tags");
    const counterEl = document.getElementById("photo-viewer-counter");
    const loadingEl = document.getElementById("photo-viewer-loading");
    
    if (!modal) return;
    
    let photo;
    if (typeof photoOrIndex === 'number') {
        currentPhotoIndex = photoOrIndex;
        photo = currentPhotoList[currentPhotoIndex];
    } else {
        photo = photoOrIndex;
        // Tentar encontrar o índice na lista atual
        currentPhotoIndex = currentPhotoList.findIndex(p => p.id === photo.id);
        if (currentPhotoIndex === -1) {
            // Se não encontrou (ex: clicado da busca), cria uma lista temporária de 1 item
            currentPhotoList = [photo];
            currentPhotoIndex = 0;
        }
    }
    
    if (!photo) return;
    
    titleEl.textContent = photo.filename;
    descEl.textContent = photo.description || "Sem descrição disponível.";
    
    // Atualiza contador
    if (counterEl) {
        counterEl.textContent = `Foto ${currentPhotoIndex + 1} de ${currentPhotoList.length}`;
    }
    
    // Resetar zoom
    resetPhotoZoom();
    
    // Verificar status de processamento da foto
    const isRaw = photo.filename.toLowerCase().match(/\.(arw|cr2|nef|dng|pef|raf|orf|rw2|raw)$/);
    if (photo.status === 'pending' && isRaw) {
        if (loadingEl) loadingEl.style.display = "flex";
        imgEl.style.opacity = "0.3";
        imgEl.src = "";
    } else {
        if (loadingEl) loadingEl.style.display = "none";
        imgEl.style.opacity = "1";
        const src = photo.proxy_path || (photo.filepath && (photo.filepath.startsWith('http') || photo.filepath.startsWith('/')) 
            ? photo.filepath 
            : `/originals/${photo.filename}`);
        imgEl.src = src;
    }
    
    tagsEl.innerHTML = "";
    let tagsArray = [];
    if (photo.tags) {
        if (Array.isArray(photo.tags)) {
            tagsArray = photo.tags;
        } else if (typeof photo.tags === 'string') {
            try {
                const parsed = JSON.parse(photo.tags);
                if (Array.isArray(parsed)) {
                    tagsArray = parsed;
                } else if (parsed) {
                    tagsArray = [parsed];
                }
            } catch (e) {
                tagsArray = photo.tags.split(',').map(t => t.trim()).filter(Boolean);
            }
        }
    }
    if (tagsArray.length > 0) {
        tagsArray.forEach(t => {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = `#${t}`;
            tagsEl.appendChild(badge);
        });
    }
    
    modal.classList.add("active");
    
    // Desenhar caixas de rostos detectados
    loadPhotoFaces(photo.id);
    
    // Foco no modal para capturar eventos de teclado
    modal.focus();
}

function prevPhoto() {
    if (currentPhotoList.length <= 1) return;
    let newIndex = currentPhotoIndex - 1;
    if (newIndex < 0) {
        newIndex = currentPhotoList.length - 1; // Loop para o fim
    }
    openPhotoViewer(newIndex);
}

function nextPhoto() {
    if (currentPhotoList.length <= 1) return;
    let newIndex = currentPhotoIndex + 1;
    if (newIndex >= currentPhotoList.length) {
        newIndex = 0; // Loop para o início
    }
    openPhotoViewer(newIndex);
}

function togglePhotoZoom() {
    const imgEl = document.getElementById("photo-viewer-img");
    const btnZoom = document.getElementById("btn-zoom-photo");
    if (!imgEl) return;
    
    if (isPhotoZoomed) {
        resetPhotoZoom();
    } else {
        isPhotoZoomed = true;
        imgEl.style.transform = "scale(1.8)";
        imgEl.style.cursor = "zoom-out";
        if (btnZoom) btnZoom.innerHTML = '<i class="fa-solid fa-magnifying-glass-minus"></i>';
    }
}

function resetPhotoZoom() {
    const imgEl = document.getElementById("photo-viewer-img");
    const btnZoom = document.getElementById("btn-zoom-photo");
    if (!imgEl) return;
    
    isPhotoZoomed = false;
    imgEl.style.transform = "scale(1)";
    imgEl.style.cursor = "zoom-in";
    if (btnZoom) btnZoom.innerHTML = '<i class="fa-solid fa-magnifying-glass-plus"></i>';
}

function activateSearchTab() {
    const btnTabSearch = document.getElementById("btn-tab-search");
    if (btnTabSearch) {
        btnTabSearch.style.display = "block";
        btnTabSearch.classList.add("active");
    }
    document.getElementById("btn-tab-transcript").classList.remove("active");
    document.getElementById("btn-tab-vision").classList.remove("active");
    const btnTabTasks = document.getElementById("btn-tab-tasks");
    if (btnTabTasks) btnTabTasks.classList.remove("active");
    const btnTabChat = document.getElementById("btn-tab-chat");
    if (btnTabChat) btnTabChat.classList.remove("active");
    
    currentRightTab = "search";
}

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
            
            // Atualizar cache
            lastSearchResults = data.results;
            lastSearchQuery = query;
            
            // Ativar a aba de busca
            activateSearchTab();
            
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
            },
            {
                score: 0.765,
                payload: {
                    video_id: 2,
                    media_type: "broll",
                    start_time: 5.0,
                    end_time: 15.0,
                    text: "Operador de câmera focando a lente anamórfica durante o ensaio da cena de ação nos bastidores."
                }
            },
            {
                score: 0.620,
                payload: {
                    photo_id: 1,
                    media_type: "photo",
                    filename: "foto_set_1.jpg",
                    filepath: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=300",
                    text: "Diretor e ator ensaiando cena sob iluminação de tungstênio clássica.",
                    tags: ["diretor", "luz"]
                }
            }
        ];
        
        lastSearchResults = mockResults;
        lastSearchQuery = query;
        
        activateSearchTab();
        
        renderSearchResults(mockResults, query);
        updateSystemStatus("Busca concluída (Mock).");
    }, 600);
}

function renderSearchResults(results, query) {
    // Captura as fotos dos resultados da busca para permitir navegar por elas no carrossel
    currentPhotoList = results
        .filter(r => r.payload.media_type === "photo")
        .map(r => ({
            id: r.payload.photo_id,
            filename: r.payload.filename || `foto_set_${r.payload.photo_id}.jpg`,
            filepath: r.payload.filepath,
            proxy_path: r.payload.proxy_path,
            description: r.payload.text,
            tags: r.payload.tags || []
        }));

    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = `
        <div class="transcription-actions" style="border:none;">
            <h4 style="font-size:12px; color:var(--color-cyan); display: flex; align-items: center; gap: 6px;">
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
        const card = document.createElement("div");
        const mediaType = r.payload.media_type || "interview";
        card.className = `search-result-card type-${mediaType}`;
        card.style.marginBottom = "10px";
        
        const isPhoto = mediaType === "photo";
        
        // Define score badge class
        const scorePercent = (r.score * 100).toFixed(0);
        let scoreClass = "low";
        if (r.score >= 0.8) {
            scoreClass = "high";
        } else if (r.score >= 0.5) {
            scoreClass = "medium";
        }
        const scoreBadge = `<span class="match-badge ${scoreClass}"><i class="fa-solid fa-fire"></i> ${scorePercent}% Match</span>`;
        
        // Match highlights
        const highlightedText = highlightTerms(r.payload.text || "", query);
        
        if (isPhoto) {
            const photoId = r.payload.photo_id;
            const filename = r.payload.filename || `foto_set_${photoId}.jpg`;
            const src = r.payload.proxy_path || (r.payload.filepath && (r.payload.filepath.startsWith('http') || r.payload.filepath.startsWith('/'))
                ? r.payload.filepath
                : `/originals/${filename}`);
                
            card.innerHTML = `
                <div class="search-result-layout">
                    <img class="search-result-thumb" src="${src}" alt="Thumb">
                    <div class="search-result-content">
                        <div class="bubble-meta" style="margin-bottom: 4px;">
                            <span class="speaker-name" style="color:#f59e0b;"><i class="fa-solid fa-image"></i> Foto de Set</span>
                            ${scoreBadge}
                        </div>
                        <div class="bubble-text">${highlightedText}</div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Arquivo: ${filename}</div>
                    </div>
                </div>
            `;
            
            card.addEventListener("click", () => {
                openPhotoViewer({
                    id: photoId,
                    filename: filename,
                    filepath: r.payload.filepath,
                    proxy_path: r.payload.proxy_path,
                    description: r.payload.text,
                    tags: r.payload.tags || []
                });
            });
            
        } else {
            const isInterview = mediaType === "interview";
            const icon = isInterview ? "fa-microphone" : "fa-video";
            const color = isInterview ? "var(--color-cyan)" : "var(--color-violet)";
            const title = isInterview ? (r.payload.speaker_id || "Entrevistado") : "Bastidores B-Roll";
            const timecode = formatTimecode(r.payload.start_time || 0);
            const vidId = r.payload.video_id;
            
            // Buscar nome do arquivo para exibir no rodapé do card
            let videoFilename = "Vídeo";
            const foundVid = allVideos.find(v => v.id === vidId) || MOCK_VIDEOS.find(v => v.id === vidId);
            if (foundVid) {
                videoFilename = foundVid.filename;
            }
            
            card.innerHTML = `
                <div class="bubble-meta" style="margin-bottom: 6px;">
                    <span class="speaker-name" style="color:${color};"><i class="fa-solid ${icon}"></i> ${title}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="btn-play-result" style="background:transparent; border:none; color:var(--color-cyan); cursor:pointer; font-weight:600; font-size:11px; display:flex; align-items:center; gap:4px;" title="Tocar trecho">
                            <i class="fa-solid fa-circle-play"></i> ${timecode}
                        </button>
                        ${scoreBadge}
                    </div>
                </div>
                <div class="bubble-text">${highlightedText}</div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
                    <span>Vídeo: ${videoFilename} (${(r.payload.end_time - r.payload.start_time).toFixed(1)}s)</span>
                    <a href="#" class="view-context-link" style="color:var(--color-cyan); text-decoration:none; font-weight: 600; font-size:11px;"><i class="fa-solid fa-eye"></i> Ver no Contexto</a>
                </div>
            `;
            
            const btnPlayResult = card.querySelector(".btn-play-result");
            if (btnPlayResult) {
                btnPlayResult.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const targetVid = allVideos.find(v => v.id === vidId) || MOCK_VIDEOS.find(v => v.id === vidId);
                    if (targetVid) {
                        selectVideo(targetVid);
                        setTimeout(() => {
                            videoPlayer.currentTime = r.payload.start_time;
                            playVideo();
                        }, 350);
                    }
                });
            }
            
            const handleContextClick = (e) => {
                if (e) e.preventDefault();
                const targetVid = allVideos.find(v => v.id === vidId) || MOCK_VIDEOS.find(v => v.id === vidId);
                if (targetVid) {
                    selectVideo(targetVid);
                    highlightAndScrollToDialogue(r.payload.start_time);
                }
            };
            
            card.addEventListener("click", handleContextClick);
            const viewLink = card.querySelector(".view-context-link");
            if (viewLink) {
                viewLink.addEventListener("click", (e) => {
                    e.stopPropagation();
                    handleContextClick(e);
                });
            }
        }
        
        feed.appendChild(card);
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

    // Event listeners for sorting and filtering
    const selectFilterStatus = document.getElementById("library-filter-status");
    if (selectFilterStatus) {
        selectFilterStatus.addEventListener("change", () => {
            filterAndRenderLibrary();
            filterAndRenderPhotos();
        });
    }
    
    const selectSortBy = document.getElementById("library-sort-by");
    if (selectSortBy) {
        selectSortBy.addEventListener("change", () => {
            filterAndRenderLibrary();
            filterAndRenderPhotos();
        });
    }
    
    // Keyboard Listeners (JKL & I/O Shortcuts)
    document.addEventListener("keydown", (e) => {
        // Ignora atalhos se o foco estiver em qualquer campo de texto, input ou caixa de busca
        const activeTag = document.activeElement.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") return;

        // Se o visualizador de fotos estiver aberto, intercepta navegação
        const photoModal = document.getElementById("photo-viewer-modal");
        if (photoModal && photoModal.classList.contains("active")) {
            if (e.key === "Escape") {
                e.preventDefault();
                closePhotoModal();
                return;
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                prevPhoto();
                return;
            } else if (e.key === "ArrowRight") {
                e.preventDefault();
                nextPhoto();
                return;
            }
            // Evitar interferência de comandos de vídeo se o modal de foto estiver aberto
            if (e.key === " " || e.key === "k" || e.key === "K" || e.key === "j" || e.key === "J" || e.key === "l" || e.key === "L") {
                e.preventDefault();
                return;
            }
        }
        
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
            if (e.shiftKey || hasTextSelection()) {
                e.preventDefault();
                appendSelectedTextToTimeline();
            } else {
                appendToTimeline();
            }
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
    
    // Controle de abas do painel lateral direito (Falas vs Visão vs Tarefas vs Chat vs Busca)
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    const btnTabVision = document.getElementById("btn-tab-vision");
    const btnTabTasks = document.getElementById("btn-tab-tasks");
    const btnTabChat = document.getElementById("btn-tab-chat");
    const btnTabSearch = document.getElementById("btn-tab-search");
    
    btnTabTranscript.addEventListener("click", () => {
        btnTabTranscript.classList.add("active");
        btnTabVision.classList.remove("active");
        if (btnTabTasks) btnTabTasks.classList.remove("active");
        if (btnTabChat) btnTabChat.classList.remove("active");
        if (btnTabSearch) btnTabSearch.classList.remove("active");
        currentRightTab = "transcript";
        updateActionsRowVisibility();
        renderRightPanelFeed();
    });
    
    btnTabVision.addEventListener("click", () => {
        btnTabVision.classList.add("active");
        btnTabTranscript.classList.remove("active");
        if (btnTabTasks) btnTabTasks.classList.remove("active");
        if (btnTabChat) btnTabChat.classList.remove("active");
        if (btnTabSearch) btnTabSearch.classList.remove("active");
        currentRightTab = "vision";
        updateActionsRowVisibility();
        renderRightPanelFeed();
    });

    if (btnTabTasks) {
        btnTabTasks.addEventListener("click", () => {
            btnTabTasks.classList.add("active");
            btnTabTranscript.classList.remove("active");
            btnTabVision.classList.remove("active");
            if (btnTabChat) btnTabChat.classList.remove("active");
            if (btnTabSearch) btnTabSearch.classList.remove("active");
            currentRightTab = "tasks";
            updateActionsRowVisibility();
            renderRightPanelFeed();
        });
    }

    if (btnTabChat) {
        btnTabChat.addEventListener("click", () => {
            btnTabChat.classList.add("active");
            btnTabTranscript.classList.remove("active");
            btnTabVision.classList.remove("active");
            if (btnTabTasks) btnTabTasks.classList.remove("active");
            if (btnTabSearch) btnTabSearch.classList.remove("active");
            currentRightTab = "chat";
            updateActionsRowVisibility();
            renderRightPanelFeed();
        });
    }

    if (btnTabSearch) {
        btnTabSearch.addEventListener("click", () => {
            btnTabSearch.classList.add("active");
            btnTabTranscript.classList.remove("active");
            btnTabVision.classList.remove("active");
            if (btnTabTasks) btnTabTasks.classList.remove("active");
            if (btnTabChat) btnTabChat.classList.remove("active");
            currentRightTab = "search";
            updateActionsRowVisibility();
            renderRightPanelFeed();
        });
    }

    // Configuração dos botões de controle do Visualizador de Fotos (Carrossel, Zoom, Closes)
    const photoModal = document.getElementById("photo-viewer-modal");
    const btnClosePhoto = document.getElementById("btn-close-photo-modal");
    const btnClosePhotoViewer = document.getElementById("btn-close-photo-viewer");
    const btnPrevPhoto = document.getElementById("btn-prev-photo");
    const btnNextPhoto = document.getElementById("btn-next-photo");
    const btnZoomPhoto = document.getElementById("btn-zoom-photo");
    const imgPhotoViewer = document.getElementById("photo-viewer-img");
    
    const closePhotoModal = () => {
        if (photoModal) photoModal.classList.remove("active");
        resetPhotoZoom();
    };
    
    if (btnClosePhoto) btnClosePhoto.addEventListener("click", closePhotoModal);
    if (btnClosePhotoViewer) btnClosePhotoViewer.addEventListener("click", closePhotoModal);
    if (btnPrevPhoto) btnPrevPhoto.addEventListener("click", prevPhoto);
    if (btnNextPhoto) btnNextPhoto.addEventListener("click", nextPhoto);
    if (btnZoomPhoto) btnZoomPhoto.addEventListener("click", togglePhotoZoom);
    if (imgPhotoViewer) imgPhotoViewer.addEventListener("click", togglePhotoZoom);

    
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
                updateSystemStatus("Clustering de temas em andamento...", true);
                startProgressPolling();
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
                startProgressPolling();
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
                startProgressPolling();
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
        const mockBlob = new Blob(["CaIAu Talho Mock Timeline Export: Cuts=" + JSON.stringify(activeTimelineCuts)], { type: "text/plain" });
        const url = URL.createObjectURL(mockBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `caiau_talho_export.${format}`;
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

    // ── GATILHOS DE DOCUMENTOS E ANÁLISE DE VISÃO (FASE 1) ──
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
            
            updateSystemStatus(`Importando documento ${file.name}...`, true);
            showSpeedOverlay("Importando...");
            try {
                const response = await fetch(`/api/project/${currentProjectId}/docs?doc_type=${docType}`, {
                    method: "POST",
                    body: formData
                });
                if (response.ok) {
                    updateSystemStatus("Documento importado e indexado.");
                    alert("Documento de roteiro/contexto importado e indexado no Qdrant com sucesso!");
                    await loadDocuments();
                } else {
                    const err = await response.json();
                    alert("Erro ao importar: " + (err.detail || "Desconhecido"));
                    updateSystemStatus("Falha ao importar documento.");
                }
            } catch(e) {
                alert("Erro de rede ao importar documento.");
                updateSystemStatus("Erro de rede.");
            }
            docFileInput.value = "";
        });
    }

    const btnAnalyzeVisionNow = document.getElementById("btn-analyze-vision-now");
    if (btnAnalyzeVisionNow) {
        btnAnalyzeVisionNow.addEventListener("click", async () => {
            if (!activeVideo) return;
            showSpeedOverlay("Analisando...");
            updateSystemStatus(`Iniciando análise visual de: ${activeVideo.filename}...`, true);
            try {
                const response = await fetch(`/api/video/${activeVideo.id}/analyze-vision`, { method: "POST" });
                if (response.ok) {
                    alert("Decupagem visual por IA iniciada! O progresso será exibido na aba de Tarefas.");
                    updateSystemStatus("Análise visual iniciada.");
                    startProgressPolling();
                } else {
                    const err = await response.json();
                    alert("Erro ao iniciar análise: " + (err.detail || "Desconhecido"));
                    updateSystemStatus("Falha ao iniciar análise.");
                }
            } catch(e) {
                alert("Erro de rede ao iniciar análise.");
                updateSystemStatus("Erro de rede.");
            }
        });
    }

    const btnAnalyzeVisionAll = document.getElementById("btn-analyze-vision-all");
    if (btnAnalyzeVisionAll) {
        btnAnalyzeVisionAll.addEventListener("click", async () => {
            showSpeedOverlay("Analisando Tudo...");
            updateSystemStatus("Enfileirando análise visual em lote...", true);
            try {
                const response = await fetch(`/api/project/${currentProjectId}/analyze-all-vision`, { method: "POST" });
                if (response.ok) {
                    const data = await response.json();
                    alert(data.message);
                    updateSystemStatus("Análise visual em lote enfileirada.");
                    startProgressPolling();
                } else {
                    const err = await response.json();
                    alert("Erro ao enfileirar lote: " + (err.detail || "Desconhecido"));
                    updateSystemStatus("Falha ao enfileirar lote.");
                }
            } catch(e) {
                alert("Erro de rede.");
                updateSystemStatus("Erro de rede.");
            }
        });
    }

    const btnAnalyzePhotoVision = document.getElementById("btn-analyze-photo-vision");
    if (btnAnalyzePhotoVision) {
        btnAnalyzePhotoVision.addEventListener("click", async () => {
            const photo = currentPhotoList[currentPhotoIndex];
            if (!photo) return;
            showSpeedOverlay("Analisando...");
            updateSystemStatus(`Analisando foto: ${photo.filename}...`, true);
            try {
                const response = await fetch(`/api/photo/${photo.id}/analyze-vision`, { method: "POST" });
                if (response.ok) {
                    alert("Análise visual da foto de set iniciada em background!");
                    updateSystemStatus("Análise da foto iniciada.");
                    startProgressPolling();
                } else {
                    const err = await response.json();
                    alert("Erro: " + (err.detail || "Desconhecido"));
                    updateSystemStatus("Falha ao analisar foto.");
                }
            } catch(e) {
                alert("Erro de rede.");
                updateSystemStatus("Erro de rede.");
            }
        });
    }
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
            
            let activeVideoIds = [];
            let isClusteringRunning = false;
            try {
                const response = await fetch("/api/conversions");
                if (response.ok) {
                    const progressData = await response.json();
                    activeConversions = progressData; // Atualiza estado global
                    
                    // Filtrar chaves que não sejam "cluster-..." para o processamento de vídeo normal
                    activeVideoIds = Object.keys(progressData).filter(k => !k.startsWith("cluster-"));
                    
                    // Verificar se o clustering para o projeto atual está rodando
                    isClusteringRunning = progressData[`cluster-${currentProjectId}`] !== undefined;
                }
            } catch (e) {
                console.warn("Erro ao buscar conversões ativas:", e);
            }
            
            // Controlar se o clustering terminou para recarregar temas narrativos
            if (wasClusteringRunning && !isClusteringRunning) {
                wasClusteringRunning = false;
                updateSystemStatus("Organização de temas concluída.");
                await loadThemes();
            }
            if (isClusteringRunning) {
                wasClusteringRunning = true;
                updateSystemStatus("Agrupando temas via DeepSeek...", true);
            }
            
            // Buscar atualizações de todos os vídeos para refletir mudanças de status (como ASR ou Visão completados)
            let videos = [];
            try {
                const resVideos = await fetch(`/api/videos?project_id=${currentProjectId}`);
                if (resVideos.ok) {
                    videos = await resVideos.json();
                    
                    const oldStatusSerialized = JSON.stringify(allVideos.map(v => ({ id: v.id, status: v.status })));
                    allVideos = videos;
                    const newStatusSerialized = JSON.stringify(videos.map(v => ({ id: v.id, status: v.status })));
                    
                    if (oldStatusSerialized !== newStatusSerialized) {
                        filterAndRenderLibrary();
                    } else {
                        videos.forEach(v => {
                            updateVideoCardDOM(v);
                        });
                    }
                }
            } catch (e) {
                console.warn("Erro ao buscar vídeos:", e);
            }
            
            // Buscar atualizações de todas as fotos para atualizar a biblioteca em tempo real
            let photos = [];
            try {
                const resPhotos = await fetch(`/api/photos?project_id=${currentProjectId}`);
                if (resPhotos.ok) {
                    photos = await resPhotos.json();
                    allPhotos = photos;
                    
                    // Se o visualizador de fotos estiver ativo, pode ter mudado status
                    const tabPhotos = document.getElementById("tab-photos");
                    if (tabPhotos && tabPhotos.classList.contains("active")) {
                        filterAndRenderPhotos();
                    }
                }
            } catch (e) {
                console.warn("Erro ao buscar fotos:", e);
            }
            
            // Atualizar progresso de conversão de vídeo textualmente se o card do proxy ativo for visível
            activeVideoIds.forEach(vidId => {
                const data = activeConversions[vidId];
                const card = document.querySelector(`.media-card[data-video-id="${vidId}"]`);
                if (card) {
                    const progressEl = card.querySelector(".conversion-progress-text");
                    if (progressEl && data && data.status === "running") {
                        progressEl.innerHTML = `Convertendo ${data.percent}% <i class="fa-solid fa-spinner fa-spin" style="color:var(--color-cyan);"></i>`;
                    }
                }
            });
            
            // Se não há conversões ativas de proxy de vídeo, nenhuma outra mídia está transcrevendo/analisando,
            // nenhuma foto está com status "pending" e o clustering não está ativo, encerra o loop de polling
            const hasActiveVideoTasks = videos.some(v => v.status === "transcribing" || v.status === "processing" || v.status === "analyzing");
            const hasActivePhotoTasks = photos.some(p => p.status === "pending");
            
            if (activeVideoIds.length === 0 && !hasActiveVideoTasks && !hasActivePhotoTasks && !isClusteringRunning) {
                clearInterval(progressInterval);
                progressInterval = null;
                return;
            }
        } catch (e) {
            console.warn("Erro no ciclo de polling:", e);
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

function hasTextSelection() {
    const selection = window.getSelection();
    return selection && selection.toString().trim().length > 0;
}

function appendSelectedTextToTimeline() {
    if (!activeVideo) {
        alert("Selecione um vídeo primeiro!");
        return;
    }
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        alert("Nenhum texto selecionado!");
        return;
    }
    
    const wordSpans = document.querySelectorAll(".word-span");
    const selectedSpans = [];
    
    wordSpans.forEach(span => {
        if (selection.containsNode(span, true)) {
            selectedSpans.push(span);
        }
    });
    
    if (selectedSpans.length === 0) {
        alert("Selecione palavras inteiras da transcrição!");
        return;
    }
    
    selectedSpans.sort((a, b) => parseFloat(a.getAttribute("data-start")) - parseFloat(b.getAttribute("data-start")));
    
    const firstSpan = selectedSpans[0];
    const lastSpan = selectedSpans[selectedSpans.length - 1];
    
    let start = parseFloat(firstSpan.getAttribute("data-start"));
    let end = parseFloat(lastSpan.getAttribute("data-end"));
    
    const padding = 0.15;
    start = Math.max(0, start - padding);
    const duration = videoPlayer.duration || 999999;
    end = Math.min(duration, end + padding);
    
    const cut = {
        video_id: activeVideo.id,
        filename: activeVideo.filename,
        in: start,
        out: end,
        track: "V1"
    };
    
    activeTimelineCuts.push(cut);
    updateTimelineUI();
    showSpeedOverlay("Texto Inserido!");
    selection.removeAllRanges();
}

async function loadPhotoFaces(photoId) {
    const container = document.getElementById("photo-viewer-overlay-container");
    if (!container) return;
    container.innerHTML = "";
    
    try {
        const response = await fetch(`/api/photo/${photoId}/faces`);
        if (response.ok) {
            const faces = await response.json();
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
                        const sResp = await fetch(`/api/project/${currentProjectId}/speakers`);
                        if (sResp.ok) {
                            speakers = await sResp.json();
                        }
                    } catch (err) {
                        console.warn("Erro ao carregar speakers:", err);
                    }
                    
                    let promptMsg = "Digite o nome desta pessoa:\n";
                    if (speakers.length > 0) {
                        promptMsg += "\nFalantes/Pessoas existentes:\n" + speakers.join(", ") + "\n";
                    }
                    
                    const name = prompt(promptMsg, face.name || "");
                    if (name !== null) {
                        const trimmedName = name.trim();
                        await labelFace(face.id, trimmedName);
                        loadPhotoFaces(photoId);
                    }
                });
                
                container.appendChild(faceDiv);
            });
        }
    } catch (e) {
        console.warn("Erro ao buscar rostos da foto:", e);
    }
}

async function labelFace(faceId, name) {
    updateSystemStatus("Rotulando rosto...", true);
    try {
        const response = await fetch(`/api/face/${faceId}/label`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name })
        });
        if (response.ok) {
            updateSystemStatus("Rosto rotulado com sucesso.");
        } else {
            alert("Erro ao rotular rosto.");
            updateSystemStatus("Falha ao rotular.");
        }
    } catch (e) {
        updateSystemStatus("Erro de rede.");
    }
}

// ── AUXILIARES DE RENDERIZAÇÃO E INTERAÇÃO DO CHATBOT ─────────────────
function renderChatTab() {
    const feed = document.getElementById("transcript-feed");
    feed.innerHTML = "";
    
    const chatContainer = document.createElement("div");
    chatContainer.className = "chat-tab-container";
    
    // Header/Ações
    const titleArea = document.createElement("div");
    titleArea.className = "transcription-actions";
    titleArea.style.border = "none";
    titleArea.style.marginBottom = "8px";
    titleArea.style.paddingBottom = "0";
    titleArea.innerHTML = `
        <h4 style="font-size:12px; color:var(--color-cyan); display:flex; align-items:center; justify-content:space-between; width:100%; margin:0;">
            <span><i class="fa-solid fa-comments"></i> Assistente Editorial IA</span>
            <button class="btn-outline" id="btn-clear-chat" style="font-size:9px; padding:2px 8px; height:20px; display:flex; align-items:center; gap:4px;">
                <i class="fa-solid fa-trash"></i> Limpar Chat
            </button>
        </h4>
    `;
    chatContainer.appendChild(titleArea);
    
    // Contêiner do Histórico de Mensagens
    const chatHistoryEl = document.createElement("div");
    chatHistoryEl.className = "chat-history";
    chatHistoryEl.id = "chat-history-container";
    
    if (chatHistory.length === 0) {
        const welcome = document.createElement("div");
        welcome.className = "empty-state";
        welcome.innerHTML = `
            <i class="fa-solid fa-brain" style="color: var(--color-violet); font-size: 28px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(138, 92, 246, 0.4);"></i>
            <p style="font-weight: 600;">Como posso ajudar no seu documentário?</p>
            <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; padding: 0 10px; text-align: center;">
                Pesquise por falantes, momentos de ação de B-rolls ou trechos de roteiro. <br>
                Pergunte coisas como: <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"O que o diretor fala sobre lentes?"</span> ou <span style="font-style: italic; font-weight: 500; color: var(--color-cyan);">"Sugira clipes sobre iluminação"</span>.
            </p>
        `;
        chatHistoryEl.appendChild(welcome);
    } else {
        chatHistory.forEach(msg => {
            const bubble = document.createElement("div");
            bubble.className = `chat-bubble ${msg.role}`;
            
            const meta = document.createElement("div");
            meta.className = "bubble-meta";
            meta.innerHTML = `<span>${msg.role === 'user' ? 'Você' : 'Assistente CaIAu Talho'}</span>`;
            bubble.appendChild(meta);
            
            const textEl = document.createElement("div");
            textEl.className = "chat-bubble-text";
            textEl.innerHTML = parseChatResponseMarkdown(msg.content);
            bubble.appendChild(textEl);
            
            // Exibir contexto RAG
            if (msg.role === 'assistant' && msg.context_used && msg.context_used.length > 0) {
                const ctxDetails = document.createElement("details");
                ctxDetails.className = "chat-citation-context-list";
                ctxDetails.innerHTML = `
                    <summary style="cursor:pointer; font-weight:600; font-size:10px;">Contexto RAG Utilizado (${msg.context_used.length} trechos)</summary>
                    <ul style="margin:4px 0 0 0; padding-left:14px; list-style-type:square; font-size:10px; display:flex; flex-direction:column; gap:4px;">
                        ${msg.context_used.map(c => `<li>${c}</li>`).join('')}
                    </ul>
                `;
                bubble.appendChild(ctxDetails);
            }
            
            chatHistoryEl.appendChild(bubble);
        });
    }
    chatContainer.appendChild(chatHistoryEl);
    
    // Área do Input
    const inputContainer = document.createElement("div");
    inputContainer.className = "chat-input-container";
    
    const inputEl = document.createElement("textarea");
    inputEl.className = "chat-input-box";
    inputEl.id = "chat-input-textarea";
    inputEl.placeholder = "Escreva sua mensagem aqui...";
    inputEl.rows = 1;
    
    const sendBtn = document.createElement("button");
    sendBtn.className = "chat-send-button";
    sendBtn.id = "chat-send-btn";
    sendBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i>`;
    
    inputContainer.appendChild(inputEl);
    inputContainer.appendChild(sendBtn);
    chatContainer.appendChild(inputContainer);
    
    feed.appendChild(chatContainer);
    
    // Scroll para baixo
    setTimeout(() => {
        chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }, 50);
    
    // Listeners
    const clearBtn = chatContainer.querySelector("#btn-clear-chat");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            chatHistory = [];
            renderChatTab();
        });
    }
    
    const sendMessage = async () => {
        const text = inputEl.value.trim();
        if (!text) return;
        
        inputEl.value = "";
        sendBtn.disabled = true;
        
        chatHistory.push({ role: "user", content: text });
        renderChatTab();
        
        const historyContainer = document.getElementById("chat-history-container");
        const typingBubble = document.createElement("div");
        typingBubble.className = "chat-bubble assistant typing";
        typingBubble.innerHTML = `
            <div class="bubble-meta"><span>Assistente CaIAu Talho</span></div>
            <div class="chat-bubble-text"><i class="fa-solid fa-spinner fa-spin"></i> Pensando...</div>
        `;
        historyContainer.appendChild(typingBubble);
        historyContainer.scrollTop = historyContainer.scrollHeight;
        
        try {
            const historyPayload = chatHistory.slice(0, chatHistory.length - 1).map(h => ({
                role: h.role,
                content: h.content
            }));
            
            const response = await fetch(`/api/project/${currentProjectId}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: historyPayload
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                chatHistory.push({
                    role: "assistant",
                    content: data.response,
                    context_used: data.context_used
                });
            } else {
                const errText = await response.text();
                chatHistory.push({
                    role: "assistant",
                    content: `Erro ao obter resposta do assistente: ${errText}`
                });
            }
        } catch (err) {
            chatHistory.push({
                role: "assistant",
                content: `Erro ao conectar ao servidor do CaIAu Talho: ${err.message}`
            });
        }
        
        renderChatTab();
    };
    
    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    hookChatCitationClicks(chatHistoryEl);
}

function parseChatResponseMarkdown(text) {
    if (!text) return "";
    
    // Escapar HTML para evitar XSS
    let escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    // Negrito e Itálico markdown simples
    escaped = escaped
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
        
    // Citações de vídeos: [Legenda](video_id: 2, start: 10.5, end: 15.0)
    escaped = escaped.replace(/\[([^\]]+)\]\(video_id:\s*(\d+),\s*start:\s*([\d.]+),\s*end:\s*([\d.]+)\)/g, (match, label, videoId, start, end) => {
        return `<a class="chat-citation video-citation" data-video-id="${videoId}" data-start="${start}" data-end="${end}"><i class="fa-solid fa-play"></i> ${label}</a>`;
    });
    
    // Citações de fotos: [Legenda](photo_id: 4)
    escaped = escaped.replace(/\[([^\]]+)\]\(photo_id:\s*(\d+)\)/g, (match, label, photoId) => {
        return `<a class="chat-citation photo-citation" data-photo-id="${photoId}"><i class="fa-solid fa-image"></i> ${label}</a>`;
    });
    
    // Citações de documentos: [Legenda](doc_id: 1)
    escaped = escaped.replace(/\[([^\]]+)\]\(doc_id:\s*(\d+)\)/g, (match, label, docId) => {
        return `<a class="chat-citation doc-citation" data-doc-id="${docId}"><i class="fa-solid fa-file-lines"></i> ${label}</a>`;
    });
    
    // Formatar bullet points
    escaped = escaped.replace(/^\s*-\s+(.+)$/gm, "<li>$1</li>");
    escaped = escaped.replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");
    escaped = escaped.replace(/<\/ul>\s*<ul>/g, ""); // Funde <ul> adjacentes
    
    // Quebras de linha
    escaped = escaped.replace(/\n/g, "<br>");
    
    return escaped;
}

function hookChatCitationClicks(container) {
    // Cliques em vídeos
    container.querySelectorAll(".video-citation").forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const videoId = parseInt(link.getAttribute("data-video-id"));
            const startTime = parseFloat(link.getAttribute("data-start"));
            const endTime = parseFloat(link.getAttribute("data-end"));
            
            const targetVid = allVideos.find(v => v.id === videoId) || MOCK_VIDEOS.find(v => v.id === videoId);
            if (targetVid) {
                selectVideo(targetVid);
                setTimeout(() => {
                    videoPlayer.currentTime = startTime;
                    playVideo();
                    highlightAndScrollToDialogue(startTime);
                }, 350);
            }
        });
    });
    
    // Cliques em fotos
    container.querySelectorAll(".photo-citation").forEach(link => {
        link.addEventListener("click", async (e) => {
            e.preventDefault();
            const photoId = parseInt(link.getAttribute("data-photo-id"));
            
            let targetPhoto = currentPhotoList.find(p => p.id === photoId);
            if (!targetPhoto) {
                try {
                    const res = await fetch(`/api/photos?project_id=${currentProjectId}`);
                    if (res.ok) {
                        const photos = await res.json();
                        targetPhoto = photos.find(p => p.id === photoId);
                    }
                } catch (err) {
                    console.error("Erro ao buscar detalhes da foto:", err);
                }
            }
            
            if (targetPhoto) {
                openPhotoViewer(targetPhoto);
            } else {
                alert(`Foto com ID ${photoId} não encontrada neste projeto.`);
            }
        });
    });
    
    // Cliques em documentos
    container.querySelectorAll(".doc-citation").forEach(link => {
        link.addEventListener("click", async (e) => {
            e.preventDefault();
            const docId = parseInt(link.getAttribute("data-doc-id"));
            
            // Alternar para aba lateral de documentos
            const btnTabDocs = document.querySelector('[data-tab="tab-docs"]');
            if (btnTabDocs) {
                btnTabDocs.click();
            }
            
            const docElement = document.querySelector(`[data-doc-id="${docId}"]`);
            if (docElement) {
                docElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                docElement.style.border = '2px solid var(--color-cyan)';
                docElement.style.boxShadow = '0 0 15px rgba(6, 182, 212, 0.4)';
                setTimeout(() => {
                    docElement.style.border = '';
                    docElement.style.boxShadow = '';
                }, 2000);
            } else {
                try {
                    const res = await fetch(`/api/project/${currentProjectId}/docs`);
                    if (res.ok) {
                        const docs = await res.json();
                        const doc = docs.find(d => d.id === docId);
                        if (doc) {
                            alert(`[Documento: ${doc.filename}]\n\nConteúdo:\n${doc.content.slice(0, 1000)}...`);
                        }
                    }
                } catch (err) {
                    console.error("Erro ao carregar detalhes do documento:", err);
                }
            }
        });
    });
}
