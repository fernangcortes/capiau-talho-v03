import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { VideoPlayer, formatTimecode } from "./player.js";
import { LibraryManager } from "./library.js";
import { PanelsManager } from "./panels.js";
import { ChatManager } from "./chat.js";
import { ProjectsManager } from "./projects.js";
import { FaceManager } from "./faces.js";

// Função para destacar os termos da busca com <mark>
function highlightTerms(text, query) {
    if (!query) return text;
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.trim().length > 2);
    if (terms.length === 0) return text;
    
    let highlightedText = text;
    terms.forEach(term => {
        const escapedTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escapedTerm})(?![^<]*>)`, "gi");
        highlightedText = highlightedText.replace(regex, `<mark class="search-highlight">$1</mark>`);
    });
    return highlightedText;
}

function highlightAndScrollToDialogue(startTime) {
    const btnTabTranscript = document.getElementById("btn-tab-transcript");
    if (btnTabTranscript) btnTabTranscript.click();
    
    setTimeout(() => {
        const blocks = document.querySelectorAll(".transcript-bubble");
        let targetBlock = null;
        let minDiff = Infinity;
        
        blocks.forEach(b => {
            const idx = b.getAttribute("data-dialogue-index");
            if (idx !== null) {
                const d = STATE.activeTranscript[idx];
                if (d) {
                    const diff = Math.abs(d.start_time - startTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        targetBlock = b;
                    }
                }
            }
        });
        
        if (targetBlock) {
            targetBlock.scrollIntoView({ behavior: "smooth", block: "center" });
            targetBlock.classList.add("highlight-glow");
            setTimeout(() => {
                targetBlock.classList.remove("highlight-glow");
            }, 3000);
        }
    }, 500);
}

function renderSearchResults(results, query) {
    const searchContainer = document.getElementById("search-container");
    if (!searchContainer) return;

    searchContainer.innerHTML = `
        <div class="transcription-actions" style="border:none; padding: 10px 15px 5px 15px;">
            <h4 style="font-size:12px; color:var(--color-cyan); display: flex; align-items: center; gap: 6px; margin: 0;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Resultados para: "${query}"
            </h4>
        </div>
        <div class="search-results-list" style="padding: 10px 15px;"></div>
    `;
    
    const resultsList = searchContainer.querySelector(".search-results-list");

    if (results.length === 0) {
        resultsList.innerHTML = `
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
                    <img class="search-result-thumb" src="${src}" alt="Thumb" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 10px;">
                    <div class="search-result-content">
                        <div class="bubble-meta" style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <span class="speaker-name" style="color:#f59e0b; font-weight:600;"><i class="fa-solid fa-image"></i> Foto de Set</span>
                            ${scoreBadge}
                        </div>
                        <div class="bubble-text">${highlightedText}</div>
                        <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">Arquivo: ${filename}</div>
                    </div>
                </div>
            `;
            
            card.addEventListener("click", () => {
                const photo = STATE.allPhotos.find(p => p.id === photoId);
                if (photo) {
                    STATE.currentPhotoList = STATE.allPhotos;
                    STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                    // Open Lightbox
                    const btnTabPhotos = document.querySelector('[data-tab="tab-photos"]');
                    if (btnTabPhotos) btnTabPhotos.click();
                    if (window.libraryManager) {
                        window.libraryManager.openLightbox(photo);
                    }
                }
            });
            
        } else {
            const isInterview = mediaType === "interview";
            const icon = isInterview ? "fa-microphone" : "fa-video";
            const color = isInterview ? "var(--color-cyan)" : "var(--color-violet)";
            const title = isInterview ? (r.payload.speaker_id || "Entrevistado") : "Bastidores B-Roll";
            const timecode = formatTimecode(r.payload.start_time || 0);
            const vidId = r.payload.video_id;
            
            let videoFilename = "Vídeo";
            const foundVid = STATE.allVideos.find(v => v.id === vidId);
            if (foundVid) {
                videoFilename = foundVid.filename;
            }
            
            card.innerHTML = `
                <div class="bubble-meta" style="margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <span class="speaker-name" style="color:${color}; font-weight:600;"><i class="fa-solid ${icon}"></i> ${title}</span>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <button class="btn-play-result" style="background:transparent; border:none; color:var(--color-cyan); cursor:pointer; font-weight:600; font-size:11px; display:flex; align-items:center; gap:4px;" title="Tocar trecho">
                            <i class="fa-solid fa-circle-play"></i> ${timecode}
                        </button>
                        ${scoreBadge}
                    </div>
                </div>
                <div class="bubble-text">${highlightedText}</div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:4px; display:flex; justify-content:space-between; align-items:center;">
                    <span>Vídeo: ${videoFilename} (${((r.payload.end_time || 0) - (r.payload.start_time || 0)).toFixed(1)}s)</span>
                    <a href="#" class="view-context-link" style="color:var(--color-cyan); text-decoration:none; font-weight: 600; font-size:11px;"><i class="fa-solid fa-eye"></i> Ver no Contexto</a>
                </div>
            `;
            
            const btnPlayResult = card.querySelector(".btn-play-result");
            if (btnPlayResult) {
                btnPlayResult.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const targetVid = STATE.allVideos.find(v => v.id === vidId);
                    if (targetVid) {
                        STATE.activeVideo = targetVid;
                        setTimeout(() => {
                            const playerEl = document.getElementById("main-video");
                            if (playerEl) {
                                playerEl.currentTime = r.payload.start_time || 0;
                                playerEl.play();
                            }
                        }, 350);
                    }
                });
            }
            
            const handleContextClick = (e) => {
                if (e) e.preventDefault();
                const targetVid = STATE.allVideos.find(v => v.id === vidId);
                if (targetVid) {
                    STATE.activeVideo = targetVid;
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
        
        resultsList.appendChild(card);
    });
}

async function runSemanticSearch() {
    const searchInput = document.getElementById("semantic-search-input");
    const filterSelect = document.getElementById("search-filter");
    if (!searchInput) return;

    const query = searchInput.value.trim();
    if (!query) return;
    
    const filter = filterSelect ? filterSelect.value : "";
    const searchContainer = document.getElementById("search-container");
    if (searchContainer) {
        searchContainer.innerHTML = "<div class='loading' style='padding: 15px;'>Buscando conceitos na biblioteca...</div>";
    }
    
    // Switch to search tab
    STATE.currentRightTab = "search";

    try {
        const data = await CapIAuAPI.search(query, STATE.currentProjectId, filter);
        renderSearchResults(data.results || [], query);
    } catch (err) {
        console.error("Erro na busca semântica:", err);
        if (searchContainer) {
            searchContainer.innerHTML = `<div class='error' style='padding: 15px;'>Erro na busca semântica: ${err.message}</div>`;
        }
    }
}
window.runSemanticSearch = runSemanticSearch;

function updateActionsRowVisibility(tab) {
    const asrRow = document.getElementById("asr-actions-row");
    const visionRow = document.getElementById("vision-actions-row");
    
    if (asrRow) asrRow.style.display = (tab === "transcript") ? "flex" : "none";
    if (visionRow) visionRow.style.display = (tab === "vision") ? "flex" : "none";
}

// Inicialização da Aplicação
window.addEventListener("DOMContentLoaded", () => {
    console.log("CaIAu Talho: Inicializando os módulos...");

    // Instanciando os gerenciadores
    const player = new VideoPlayer();
    const library = new LibraryManager();
    window.libraryManager = library;
    const panels = new PanelsManager();
    const chat = new ChatManager();
    const projects = new ProjectsManager();
    FaceManager.init();

    // ── CONFIGURAÇÃO DE SIDEBARS RETRÁTEIS ──
    const sidebarLeft = document.getElementById("sidebar-left");
    const sidebarRight = document.getElementById("sidebar-right");
    const timelinePanel = document.getElementById("timeline-panel");
    
    const toggleLeft = document.getElementById("toggle-left");
    const toggleRight = document.getElementById("toggle-right");
    const toggleTimeline = document.getElementById("toggle-timeline");
    
    const reopenLeft = document.getElementById("reopen-left");
    const reopenRight = document.getElementById("reopen-right");
    const reopenTimeline = document.getElementById("reopen-timeline");

    const collapseSidebar = (side) => {
        if (side === "left" && sidebarLeft && reopenLeft) {
            sidebarLeft.classList.add("collapsed");
            reopenLeft.classList.add("visible");
        } else if (side === "right" && sidebarRight && reopenRight) {
            sidebarRight.classList.add("collapsed");
            reopenRight.classList.add("visible");
        } else if (side === "timeline" && timelinePanel && reopenTimeline) {
            timelinePanel.classList.add("collapsed");
            reopenTimeline.classList.add("visible");
        }
    };
    
    const expandSidebar = (side) => {
        if (side === "left" && sidebarLeft && reopenLeft) {
            sidebarLeft.classList.remove("collapsed");
            reopenLeft.classList.remove("visible");
        } else if (side === "right" && sidebarRight && reopenRight) {
            sidebarRight.classList.remove("collapsed");
            reopenRight.classList.remove("visible");
        } else if (side === "timeline" && timelinePanel && reopenTimeline) {
            timelinePanel.classList.remove("collapsed");
            reopenTimeline.classList.remove("visible");
        }
    };

    if (toggleLeft) toggleLeft.addEventListener("click", () => collapseSidebar("left"));
    if (toggleRight) toggleRight.addEventListener("click", () => collapseSidebar("right"));
    if (toggleTimeline) toggleTimeline.addEventListener("click", () => collapseSidebar("timeline"));
    
    if (reopenLeft) reopenLeft.addEventListener("click", () => expandSidebar("left"));
    if (reopenRight) reopenRight.addEventListener("click", () => expandSidebar("right"));
    if (reopenTimeline) reopenTimeline.addEventListener("click", () => expandSidebar("timeline"));

    // ── TABS NATIVAS DA ESQUERDA (BIBLIOTECA) ──
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

    // ── TABS NATIVAS DA DIREITA ──
    const rightTabs = document.querySelectorAll("#right-tabs .tab-btn");
    const rightContainers = {
        transcript: document.getElementById("transcript-container"),
        vision: document.getElementById("vision-container"),
        tasks: document.getElementById("tasks-container"),
        chat: document.getElementById("chat-container"),
        search: document.getElementById("search-container"),
    };

    rightTabs.forEach(btn => {
        btn.addEventListener("click", () => {
            rightTabs.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const tab = btn.dataset.rightTab;
            STATE.currentRightTab = tab;
        });
    });

    STATE.on("rightTabChanged", (tab) => {
        // Ocultar todos os containers
        Object.values(rightContainers).forEach(c => {
            if (c) c.style.display = "none";
        });
        
        // Exibir container ativo
        const activeContainer = rightContainers[tab];
        if (activeContainer) {
            if (tab === "chat") {
                activeContainer.style.display = "flex";
            } else {
                activeContainer.style.display = "block";
            }
        }
        
        // Manter destaque no botão ativo
        rightTabs.forEach(btn => {
            if (btn.dataset.rightTab === tab) {
                btn.classList.add("active");
                btn.style.display = "block"; // Se for o de busca oculto, força visibilidade
            } else {
                btn.classList.remove("active");
            }
        });

        // Atualizar headers das ações
        updateActionsRowVisibility(tab);
    });

    // Ocultar ou mostrar botão de visão baseado no tipo do vídeo ativo
    STATE.on("activeVideoChanged", (video) => {
        const btnTabVision = document.getElementById("btn-tab-vision");
        if (!video) {
            if (btnTabVision) btnTabVision.style.display = "none";
            return;
        }

        if (video.video_type === "broll") {
            if (btnTabVision) btnTabVision.style.display = "block";
        } else {
            if (btnTabVision) btnTabVision.style.display = "none";
            if (STATE.currentRightTab === "vision") {
                STATE.currentRightTab = "transcript";
            }
        }
    });

    // ── BUSCA SEMÂNTICA EVENTOS ──
    const btnSearch = document.getElementById("btn-search");
    const searchInput = document.getElementById("semantic-search-input");
    if (btnSearch) {
        btnSearch.addEventListener("click", runSemanticSearch);
    }
    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") runSemanticSearch();
        });
    }

    // Carregar projetos iniciais
    projects.loadProjectsList().then(() => {
        console.log("Projetos iniciais carregados e configurados.");
    });
});
