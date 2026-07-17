import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { VideoPlayer, formatTimecode } from "./player.js";
import { LibraryManager } from "./library.js";
import { PanelsManager } from "./panels.js?v=2";
import { ChatManager } from "./chat.js";
import { ProjectsManager } from "./projects.js";
import { FaceManager } from "./faces.js";
import { WorkspaceManager, getActiveElement } from "./workspaceManager.js";
import { SettingsPanelManager } from "./settingsPanel.js";
import { initAutosave, triggerAutosave } from "./timelineAutosave.js";
import { LOG_MANAGER } from "./logManager.js";
import { initTabsCustomization, setTabVisibility } from "./tabsCustomization.js";

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

const SEARCH_STATE = {
    query: "",
    offset: 0,
    limit: 30,
    hasMore: true,
    isLoading: false,
    loadedResults: [],
    activeMediaFilter: "",
    activeContextFilters: new Set(),
    aiCategories: null,
    activeAiCategory: null,
    showAllTags: false,
    playlistItems: [],
    playlistIndex: -1,
    autoplaySeq: false,
    photoTimer: null,
    playbackActiveItemStarted: false
};

let searchPreviewTimeout = null;

function showSearchResultPreview(r, card) {
    if (searchPreviewTimeout) clearTimeout(searchPreviewTimeout);
    
    searchPreviewTimeout = setTimeout(() => {
        let popover = document.getElementById("search-result-context-popover");
        if (!popover) {
            popover = document.createElement("div");
            popover.id = "search-result-context-popover";
            popover.style.position = "fixed";
            popover.style.zIndex = "10010";
            popover.style.background = "rgba(10, 8, 14, 0.95)";
            popover.style.border = "1px solid rgba(6, 182, 212, 0.5)";
            popover.style.borderRadius = "12px";
            popover.style.boxShadow = "0 10px 40px rgba(0,0,0,0.8)";
            popover.style.padding = "10px";
            popover.style.width = "320px";
            popover.style.display = "flex";
            popover.style.flexDirection = "column";
            popover.style.gap = "8px";
            popover.style.pointerEvents = "none";
            document.body.appendChild(popover);
        }
        
        const cardRect = card.getBoundingClientRect();
        let left = cardRect.right + 15;
        if (left + 340 > window.innerWidth) {
            left = cardRect.left - 340; 
        }
        let top = cardRect.top + (cardRect.height - 240) / 2;
        if (top < 10) top = 10;
        if (top + 240 > window.innerHeight) top = window.innerHeight - 250;
        
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
        popover.style.display = "flex";
        
        const mediaType = r.payload.media_type || "interview";
        const isPhoto = mediaType === "photo";
        
        popover.innerHTML = `
            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:600; display:flex; align-items:center; gap:5px;">
                <i class="fa-solid fa-eye" style="color:var(--color-cyan);"></i> Preview da Busca
            </div>
            <div id="search-popover-media" style="width:100%; height:180px; border-radius:6px; overflow:hidden; background:#000; position:relative; display:flex; align-items:center; justify-content:center;">
                <div class="loading-state-text" style="font-size:11px; color:var(--text-muted);">Carregando preview...</div>
            </div>
            <div style="font-size:10px; color:var(--text-muted); text-align:center; font-style:italic; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${isPhoto ? `Foto: ${r.payload.filename || 'Original'}` : `Vídeo: ${r.payload.filename || 'Original'}`}
            </div>
        `;
        
        const mediaContainer = popover.querySelector("#search-popover-media");
        
        if (isPhoto) {
            const photoId = r.payload.photo_id;
            const photo = STATE.allPhotos.find(p => p.id === photoId);
            let src = r.payload.proxy_path || r.payload.filepath;
            if (!src && photo) {
                src = photo.proxy_path || photo.filepath;
            }
            if (!src) {
                src = `/originals/${r.payload.filename || `foto_set_${photoId}.jpg`}`;
            }
            mediaContainer.innerHTML = `<img src="${src}" style="width:100%; height:100%; object-fit:contain;">`;
        } else {
            const vidId = r.payload.video_id;
            const video = STATE.allVideos.find(v => v.id === vidId);
            if (!video) {
                mediaContainer.innerHTML = `<div style="font-size:11px; color:var(--text-muted);">Vídeo não encontrado</div>`;
                return;
            }
            let src = video.proxy_path || video.filepath;
            const isRemote = src.startsWith("http") || src.startsWith("/proxies/") || src.startsWith("/");
            if (!isRemote) {
                src = `/originals/${video.filename}`;
            }
            
            const videoEl = document.createElement("video");
            videoEl.src = src;
            videoEl.style.width = "100%";
            videoEl.style.height = "100%";
            videoEl.style.objectFit = "contain";
            videoEl.muted = true;
            videoEl.playsInline = true;
            
            const startTime = r.payload.start_time || 0.0;
            const endTime = r.payload.end_time || (startTime + 5.0);
            
            videoEl.addEventListener("loadedmetadata", () => {
                videoEl.currentTime = startTime;
                videoEl.play().catch(e => console.warn("Erro ao reproduzir preview:", e));
            });
            
            videoEl.addEventListener("timeupdate", () => {
                if (videoEl.currentTime >= endTime || videoEl.currentTime >= startTime + 5.0) {
                    videoEl.currentTime = startTime;
                }
            });
            
            mediaContainer.innerHTML = "";
            mediaContainer.appendChild(videoEl);
        }
    }, 400);
}

function hideSearchResultPreview() {
    if (searchPreviewTimeout) clearTimeout(searchPreviewTimeout);
    const popover = document.getElementById("search-result-context-popover");
    if (popover) {
        popover.style.display = "none";
        popover.innerHTML = "";
    }
}

function updatePlaylistUI() {
    const controlsDiv = document.querySelector(".search-playlist-controls");
    if (!controlsDiv) return;
    
    const statusDiv = controlsDiv.querySelector("#search-playlist-status");
    const btnPlaySeq = controlsDiv.querySelector("#btn-search-play-seq");
    
    // Remover classes ativas antigas
    SEARCH_STATE.playlistItems.forEach(item => {
        if (item.cardElement) {
            item.cardElement.classList.remove("active-playlist-item");
        }
    });
    
    if (SEARCH_STATE.playlistIndex >= 0 && SEARCH_STATE.playlistIndex < SEARCH_STATE.playlistItems.length) {
        const current = SEARCH_STATE.playlistItems[SEARCH_STATE.playlistIndex];
        if (current.cardElement) {
            current.cardElement.classList.add("active-playlist-item");
        }
        if (statusDiv) {
            statusDiv.textContent = `${SEARCH_STATE.playlistIndex + 1} de ${SEARCH_STATE.playlistItems.length}`;
        }
    } else {
        if (statusDiv) {
            statusDiv.textContent = `0 de ${SEARCH_STATE.playlistItems.length}`;
        }
    }
    
    if (btnPlaySeq) {
        if (SEARCH_STATE.autoplaySeq) {
            btnPlaySeq.innerHTML = `<i class="fa-solid fa-pause"></i> Parar`;
            btnPlaySeq.style.borderColor = "var(--color-rose)";
            btnPlaySeq.style.color = "var(--color-rose)";
        } else {
            btnPlaySeq.innerHTML = `<i class="fa-solid fa-play"></i> Autoplay`;
            btnPlaySeq.style.borderColor = "var(--border-glass)";
            btnPlaySeq.style.color = "var(--text-secondary)";
        }
    }
}

function playSearchPlaylistItem(index) {
    if (SEARCH_STATE.photoTimer) clearTimeout(SEARCH_STATE.photoTimer);
    SEARCH_STATE.playbackActiveItemStarted = false;
    
    if (index < 0 || index >= SEARCH_STATE.playlistItems.length) {
        SEARCH_STATE.autoplaySeq = false;
        SEARCH_STATE.playlistIndex = -1;
        updatePlaylistUI();
        return;
    }
    
    SEARCH_STATE.playlistIndex = index;
    updatePlaylistUI();
    
    const item = SEARCH_STATE.playlistItems[index];
    
    if (item.cardElement) {
        item.cardElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    
    if (item.media_type === "photo") {
        const photo = STATE.allPhotos.find(p => p.id === item.photo_id);
        if (photo) {
            if (SEARCH_STATE.autoplaySeq || STATE.openPhotosInPlayer) {
                if (window.libraryManager && window.libraryManager.lightbox) {
                    window.libraryManager.closeLightbox();
                }
                STATE.activePhoto = photo;
            } else {
                STATE.currentPhotoList = STATE.allPhotos;
                STATE.currentPhotoIndex = STATE.allPhotos.indexOf(photo);
                const btnTabPhotos = document.querySelector('[data-tab="tab-photos"]');
                if (btnTabPhotos) btnTabPhotos.click();
                if (window.libraryManager) {
                    window.libraryManager.openLightbox(photo);
                }
            }
        }
        
        if (SEARCH_STATE.autoplaySeq) {
            SEARCH_STATE.photoTimer = setTimeout(() => {
                playNextSearchItem();
            }, 4000);
        }
    } else {
        if (window.libraryManager && window.libraryManager.lightbox) {
            window.libraryManager.closeLightbox();
        }
        
        const targetVid = STATE.allVideos.find(v => v.id === item.video_id);
        if (targetVid) {
            STATE.activeVideo = targetVid;
            setTimeout(() => {
                const playerEl = document.getElementById("source-video");
                if (playerEl) {
                    playerEl.currentTime = item.start_time || 0;
                    playerEl.play().catch(err => console.warn("Autoplay block:", err));
                }
            }, 350);
        }
    }
}

function playNextSearchItem() {
    playSearchPlaylistItem(SEARCH_STATE.playlistIndex + 1);
}

function playPrevSearchItem() {
    playSearchPlaylistItem(SEARCH_STATE.playlistIndex - 1);
}

function extractContextFilters() {
    const speakers = new Set();
    const tags = new Set();
    SEARCH_STATE.loadedResults.forEach(r => {
        const payload = r.payload;
        if (payload.speaker_id) {
            speakers.add(payload.speaker_id);
        }
        if (payload.tags && Array.isArray(payload.tags)) {
            payload.tags.forEach(t => tags.add(t));
        }
    });
    return { speakers: Array.from(speakers), tags: Array.from(tags) };
}

function updateContextPills() {
    const container = document.querySelector(".context-filters-container");
    if (!container) return;
    
    container.innerHTML = "";
    
    // Se temos categorias da IA, renderizar as categorias da IA
    if (SEARCH_STATE.aiCategories && SEARCH_STATE.aiCategories.categories) {
        const categories = SEARCH_STATE.aiCategories.categories;
        const limit = 7;
        const hasMoreCats = categories.length > limit;
        const visibleCats = SEARCH_STATE.showAllTags ? categories : categories.slice(0, limit);

        visibleCats.forEach(cat => {
            const isActive = SEARCH_STATE.activeAiCategory === cat.name;
            const pill = document.createElement("div");
            pill.className = `context-pill ${isActive ? 'active' : ''}`;
            pill.style.borderColor = "rgba(139, 92, 246, 0.4)"; // Lilás para IA
            pill.innerHTML = `<i class="fa-solid fa-lightbulb"></i> ${cat.name}`;
            pill.addEventListener("click", () => {
                if (SEARCH_STATE.activeAiCategory === cat.name) {
                    SEARCH_STATE.activeAiCategory = null;
                } else {
                    SEARCH_STATE.activeAiCategory = cat.name;
                    // Limpar filtros de tags tradicionais para não conflitar
                    SEARCH_STATE.activeContextFilters.clear();
                }
                updateContextPills();
                applyFiltersAndRenderCards();
            });
            container.appendChild(pill);
        });

        // Botão de toggle Mais/Menos para IA
        if (hasMoreCats) {
            const togglePill = document.createElement("div");
            togglePill.className = "context-pill";
            togglePill.style.borderColor = "#c084fc";
            togglePill.style.color = "#c084fc";
            togglePill.style.fontWeight = "600";
            if (SEARCH_STATE.showAllTags) {
                togglePill.innerHTML = `<i class="fa-solid fa-minus"></i> Menos`;
            } else {
                togglePill.innerHTML = `<i class="fa-solid fa-plus"></i> Mais (${categories.length - limit})`;
            }
            togglePill.addEventListener("click", () => {
                SEARCH_STATE.showAllTags = !SEARCH_STATE.showAllTags;
                updateContextPills();
            });
            container.appendChild(togglePill);
        }
        
        // Adicionar botão de limpar categorização IA
        const clearPill = document.createElement("div");
        clearPill.className = "context-pill";
        clearPill.innerHTML = `<i class="fa-solid fa-xmark"></i> Limpar IA`;
        clearPill.addEventListener("click", () => {
            SEARCH_STATE.aiCategories = null;
            SEARCH_STATE.activeAiCategory = null;
            SEARCH_STATE.showAllTags = false;
            updateContextPills();
            applyFiltersAndRenderCards();
        });
        container.appendChild(clearPill);
        
    } else {
        // Renderizar tags e falantes tradicionais
        const { speakers, tags } = extractContextFilters();
        
        // Unir falantes e tags em uma lista unificada
        const items = [];
        speakers.forEach(sp => {
            items.push({ type: "speaker", value: sp });
        });
        tags.forEach(tg => {
            items.push({ type: "tag", value: tg });
        });
        
        const limit = 7;
        const hasMoreTags = items.length > limit;
        const visibleItems = SEARCH_STATE.showAllTags ? items : items.slice(0, limit);
        
        visibleItems.forEach(item => {
            const pill = document.createElement("div");
            if (item.type === "speaker") {
                const isActive = SEARCH_STATE.activeContextFilters.has(item.value);
                pill.className = `context-pill ${isActive ? 'active' : ''}`;
                pill.innerHTML = `<i class="fa-solid fa-user"></i> ${item.value}`;
                pill.addEventListener("click", () => {
                    if (SEARCH_STATE.activeContextFilters.has(item.value)) {
                        SEARCH_STATE.activeContextFilters.delete(item.value);
                    } else {
                        SEARCH_STATE.activeContextFilters.add(item.value);
                    }
                    updateContextPills();
                    applyFiltersAndRenderCards();
                });
            } else {
                const isActive = SEARCH_STATE.activeContextFilters.has(item.value);
                pill.className = `context-pill ${isActive ? 'active' : ''}`;
                pill.innerHTML = `<i class="fa-solid fa-tag"></i> ${item.value}`;
                pill.addEventListener("click", () => {
                    if (SEARCH_STATE.activeContextFilters.has(item.value)) {
                        SEARCH_STATE.activeContextFilters.delete(item.value);
                    } else {
                        SEARCH_STATE.activeContextFilters.add(item.value);
                    }
                    updateContextPills();
                    applyFiltersAndRenderCards();
                });
            }
            container.appendChild(pill);
        });
        
        // Botão de toggle Mais/Menos
        if (hasMoreTags) {
            const togglePill = document.createElement("div");
            togglePill.className = "context-pill";
            togglePill.style.borderColor = "var(--color-cyan)";
            togglePill.style.color = "var(--color-cyan)";
            togglePill.style.fontWeight = "600";
            if (SEARCH_STATE.showAllTags) {
                togglePill.innerHTML = `<i class="fa-solid fa-minus"></i> Menos`;
            } else {
                togglePill.innerHTML = `<i class="fa-solid fa-plus"></i> Mais (${items.length - limit})`;
            }
            togglePill.addEventListener("click", () => {
                SEARCH_STATE.showAllTags = !SEARCH_STATE.showAllTags;
                updateContextPills();
            });
            container.appendChild(togglePill);
        }
        
        // Adicionar botão "Agrupar com IA" se tivermos resultados
        if (SEARCH_STATE.loadedResults.length > 0) {
            const aiBtn = document.createElement("button");
            aiBtn.className = "btn-ai-categorize";
            aiBtn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Agrupar com IA`;
            aiBtn.addEventListener("click", runAiCategorization);
            container.appendChild(aiBtn);
        }
    }
}

async function runAiCategorization() {
    const btn = document.querySelector(".btn-ai-categorize");
    if (!btn || SEARCH_STATE.isLoading || SEARCH_STATE.loadedResults.length === 0) return;
    
    btn.classList.add("loading");
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Agrupando...`;
    
    try {
        const itemsToCategorize = SEARCH_STATE.loadedResults.map(r => ({
            id: r.id,
            media_type: r.payload.media_type || "interview",
            text: r.payload.text || ""
        }));
        
        const data = await CapIAuAPI.categorizeSearchResults(SEARCH_STATE.query, itemsToCategorize);
        if (data && data.categories && data.categories.length > 0) {
            SEARCH_STATE.aiCategories = data;
            updateContextPills();
        } else {
            alert("Não foi possível gerar categorias com IA. Verifique as configurações da API.");
        }
    } catch (err) {
        console.error("Erro na categorização IA:", err);
        alert("Erro na categorização IA: " + err.message);
    } finally {
        btn.classList.remove("loading");
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Agrupar com IA`;
    }
}

function applyFiltersAndRenderCards() {
    const searchContainer = getActiveElement("search-container");
    if (!searchContainer) return;
    
    const resultsList = searchContainer.querySelector(".search-results-list");
    if (!resultsList) return;
    
    resultsList.innerHTML = "";
    
    // 1. Limpar a playlist de busca
    SEARCH_STATE.playlistItems = [];
    
    // Filtragem
    let filtered = SEARCH_STATE.loadedResults;
    
    // 1. Filtro por Tipo de Mídia
    if (SEARCH_STATE.activeMediaFilter) {
        filtered = filtered.filter(r => {
            let mType = r.payload.media_type || "interview";
            if (mType === "video") mType = "interview";
            return mType === SEARCH_STATE.activeMediaFilter;
        });
    }
    
    // 2. Filtro por Categoria IA
    if (SEARCH_STATE.activeAiCategory && SEARCH_STATE.aiCategories) {
        const catObj = SEARCH_STATE.aiCategories.categories.find(c => c.name === SEARCH_STATE.activeAiCategory);
        if (catObj) {
            filtered = filtered.filter(r => catObj.result_ids.includes(r.id));
        }
    }
    
    // 3. Filtros Contextuais Tradicionais
    if (SEARCH_STATE.activeContextFilters.size > 0) {
        filtered = filtered.filter(r => {
            const payload = r.payload;
            const speaker = payload.speaker_id;
            const itemTags = payload.tags || [];
            
            if (speaker && SEARCH_STATE.activeContextFilters.has(speaker)) {
                return true;
            }
            return itemTags.some(t => SEARCH_STATE.activeContextFilters.has(t));
        });
    }
    
    if (filtered.length === 0) {
        resultsList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-filter-circle-xmark"></i>
                <p>Nenhum resultado corresponde aos filtros selecionados.</p>
            </div>
        `;
        const controlsDiv = searchContainer.querySelector(".search-playlist-controls");
        if (controlsDiv) controlsDiv.style.display = "none";
        return;
    }
    
    filtered.forEach(r => {
        const card = document.createElement("div");
        let mediaType = r.payload.media_type || "interview";
        if (mediaType === "video") mediaType = "interview";
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
        const explanationTooltip = r.explanation ? `data-tooltip="${escapeHtml(r.explanation)}"` : '';
        const scoreBadge = `<span class="match-badge ${scoreClass}" ${explanationTooltip}><i class="fa-solid fa-fire"></i> ${scorePercent}% Match</span>`;
        
        // Match highlights
        const highlightedText = highlightTerms(r.payload.text || "", SEARCH_STATE.query);
        
        if (isPhoto) {
            const photoId = r.payload.photo_id;
            const filename = r.payload.filename || `foto_set_${photoId}.jpg`;
            const src = r.payload.proxy_path || (r.payload.filepath && (r.payload.filepath.startsWith('http') || r.payload.filepath.startsWith('/'))
                ? r.payload.filepath
                : `/originals/${filename}`);
                
            card.innerHTML = `
                <div class="search-result-layout">
                    <div style="position: relative; flex-shrink: 0;">
                        <img class="search-result-thumb" src="${src}" alt="Thumb" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px; margin-right: 8px;">
                        <button class="btn-select-similar-item" data-tooltip="Selecionar para busca por similaridade" style="position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border: none; background: rgba(0,0,0,0.65); color: var(--text-muted); font-size: 10px; cursor: pointer; display: none; align-items: center; justify-content: center; border-radius: 3px; z-index: 10;">
                            <i class="fa-regular fa-square"></i>
                        </button>
                    </div>
                    <div class="search-result-content" style="flex: 1; min-width: 0;">
                        <div class="bubble-meta" style="margin-bottom: 3px; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
                            <span class="speaker-name" style="color:#f59e0b; font-weight:600; font-size:10px;"><i class="fa-solid fa-image"></i> Foto de Set</span>
                            ${scoreBadge}
                        </div>
                        <div class="bubble-text" style="font-size:11px; line-height:1.3;">${highlightedText}</div>
                        <div style="font-size:9px; color:var(--text-muted); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" data-tooltip="Arquivo: ${escapeHtml(filename)}">Arquivo: ${filename}</div>
                    </div>
                </div>
            `;
            
            const selectBtn = card.querySelector(".btn-select-similar-item");
            if (selectBtn) {
                selectBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.toggleSelectSimilarItem("photo", photoId, filename, card);
                });
            }
 
            const isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => item.kind === "photo" && item.id === photoId);
            if (isSelected) {
                card.classList.add("selected-for-similar");
                const selectIcon = selectBtn ? selectBtn.querySelector("i") : null;
                if (selectIcon) {
                    selectIcon.className = "fa-solid fa-square-check";
                    selectIcon.style.color = "var(--color-cyan)";
                }
            }
            
            // Adicionar à playlist
            const playlistItem = {
                id: r.id,
                media_type: mediaType,
                video_id: null,
                photo_id: photoId,
                start_time: 0.0,
                end_time: 0.0,
                text: r.payload.text || "",
                filename: filename,
                score: r.score,
                cardElement: card
            };
            SEARCH_STATE.playlistItems.push(playlistItem);
            
            card.addEventListener("click", () => {
                const idx = SEARCH_STATE.playlistItems.findIndex(item => item.id === r.id);
                if (idx !== -1) {
                    playSearchPlaylistItem(idx);
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
            let videoDisplayTitle = "Vídeo";
            const foundVid = STATE.allVideos.find(v => v.id === vidId);
            if (foundVid) {
                videoFilename = foundVid.filename;
                videoDisplayTitle = foundVid.title || foundVid.filename;
            }
            
            card.innerHTML = `
                <div class="bubble-meta" style="margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                    <span class="speaker-name" style="color:${color}; font-weight:600; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:120px;" data-tooltip="${escapeHtml(title)}"><i class="fa-solid ${icon}"></i> ${title}</span>
                    <div style="display:flex; align-items:center; gap:6px; flex-shrink: 0;">
                        <span style="font-weight:600; font-size:10px; color:var(--color-cyan); display:flex; align-items:center; gap:3px;">
                            <i class="fa-solid fa-circle-play"></i> ${timecode}
                        </span>
                        ${scoreBadge}
                    </div>
                </div>
                <div class="bubble-text" style="font-size:11px; line-height:1.3;">${highlightedText}</div>
                <div style="font-size:9px; color:var(--text-muted); margin-top:3px; display:flex; justify-content:space-between; align-items:center; width:100%; gap:6px;">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;" data-tooltip="Vídeo: ${escapeHtml(videoDisplayTitle)} (${((r.payload.end_time || 0) - (r.payload.start_time || 0)).toFixed(1)}s)">Vídeo: ${videoDisplayTitle} (${((r.payload.end_time || 0) - (r.payload.start_time || 0)).toFixed(1)}s)</span>
                    <div style="display:flex; gap:2px; align-items:center; flex-shrink:0;">
                        <button class="btn-select-similar-item" data-tooltip="Selecionar para busca por similaridade" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:2px; font-size:10px; display:none; align-items:center; justify-content:center; border-radius:50%; width:20px; height:20px;">
                            <i class="fa-regular fa-square"></i>
                        </button>
                        <button class="view-context-btn" data-tooltip="Ver no Contexto" style="background:none; border:none; color:var(--color-cyan); cursor:pointer; padding:2px; font-size:11px; display:flex; align-items:center; justify-content:center; border-radius:50%; width:20px; height:20px;">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>
            `;
            
            const selectBtn = card.querySelector(".btn-select-similar-item");
            if (selectBtn) {
                selectBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.toggleSelectSimilarItem("video", vidId, videoDisplayTitle, card, r.payload.start_time, r.payload.media_type || null);
                });
            }
 
            const isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => 
                item.kind === "video" && item.id === vidId && item.timestamp === r.payload.start_time
            );
            if (isSelected) {
                card.classList.add("selected-for-similar");
                const selectIcon = selectBtn ? selectBtn.querySelector("i") : null;
                if (selectIcon) {
                    selectIcon.className = "fa-solid fa-square-check";
                    selectIcon.style.color = "var(--color-cyan)";
                }
            }
            
            // Adicionar à playlist
            const playlistItem = {
                id: r.id,
                media_type: mediaType,
                video_id: vidId,
                photo_id: null,
                start_time: r.payload.start_time || 0.0,
                end_time: r.payload.end_time || 0.0,
                text: r.payload.text || "",
                filename: videoFilename,
                score: r.score,
                cardElement: card
            };
            SEARCH_STATE.playlistItems.push(playlistItem);
            
            card.addEventListener("click", () => {
                const idx = SEARCH_STATE.playlistItems.findIndex(item => item.id === r.id);
                if (idx !== -1) {
                    playSearchPlaylistItem(idx);
                }
            });
            
            const viewBtn = card.querySelector(".view-context-btn");
            if (viewBtn) {
                viewBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const targetVid = STATE.allVideos.find(v => v.id === vidId);
                    if (targetVid) {
                        STATE.activeVideo = targetVid;
                        highlightAndScrollToDialogue(r.payload.start_time);
                    }
                });
            }

            // Outras ocorrências
            if (r.other_occurrences && r.other_occurrences.length > 0) {
                const occWrapper = document.createElement("div");
                occWrapper.className = "occurrences-toggle-wrapper";
                occWrapper.style.marginTop = "8px";
                occWrapper.style.borderTop = "1px dashed rgba(255,255,255,0.08)";
                occWrapper.style.paddingTop = "6px";
                
                occWrapper.innerHTML = `
                    <button class="btn-toggle-occurrences" style="background: none; border: none; color: var(--color-cyan); font-size: 10px; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 2px 0; outline: none; font-weight: 600;">
                        <i class="fa-solid fa-chevron-down"></i> Ver mais ocorrências (${r.other_occurrences.length})
                    </button>
                    <div class="occurrences-list" style="display: none; flex-direction: column; gap: 6px; margin-top: 6px; padding-left: 8px; border-left: 2px solid rgba(6, 182, 212, 0.25);">
                    </div>
                `;
                
                const toggleBtn = occWrapper.querySelector(".btn-toggle-occurrences");
                const listDiv = occWrapper.querySelector(".occurrences-list");
                
                toggleBtn.addEventListener("click", (e) => {
                    e.stopPropagation(); // Evitar disparar o play do card principal
                    const isHidden = listDiv.style.display === "none";
                    listDiv.style.display = isHidden ? "flex" : "none";
                    
                    if (isHidden) {
                        toggleBtn.innerHTML = `<i class="fa-solid fa-chevron-up"></i> Ocultar ocorrências (${r.other_occurrences.length})`;
                    } else {
                        toggleBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> Ver mais ocorrências (${r.other_occurrences.length})`;
                    }
                });
                
                r.other_occurrences.forEach(occ => {
                    const subCard = document.createElement("div");
                    subCard.className = "occurrence-subcard";
                    subCard.style.background = "rgba(255,255,255,0.01)";
                    subCard.style.border = "1px solid rgba(255,255,255,0.03)";
                    subCard.style.borderRadius = "4px";
                    subCard.style.padding = "4px 6px";
                    subCard.style.fontSize = "10px";
                    subCard.style.cursor = "pointer";
                    subCard.style.transition = "background 0.2s";
                    
                    let subScoreClass = "low";
                    if (occ.score >= 0.8) {
                        subScoreClass = "high";
                    } else if (occ.score >= 0.5) {
                        subScoreClass = "medium";
                    }
                    
                    subCard.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="color: var(--color-cyan); font-weight: 600; font-size: 10px; display: flex; align-items: center; gap: 4px;">
                                <i class="fa-solid fa-circle-play"></i> ${formatTimecode(occ.start_time)}
                            </span>
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <span class="match-badge ${subScoreClass}" style="font-size: 8px; padding: 1px 4px; line-height: 1;"><i class="fa-solid fa-fire"></i> ${(occ.score * 100).toFixed(0)}%</span>
                                <button class="view-occ-context-btn" data-tooltip="Ver no Contexto" style="background:none; border:none; color:var(--color-cyan); cursor:pointer; font-size:10px; padding:2px; display:flex; align-items:center; justify-content:center;">
                                    <i class="fa-solid fa-eye"></i>
                                </button>
                            </div>
                        </div>
                        <div style="color: var(--text-secondary); line-height: 1.3;">${highlightTerms(occ.text || "", SEARCH_STATE.query)}</div>
                    `;
                    
                    // Adicionar à playlist
                    const subPlaylistItem = {
                        id: occ.id,
                        media_type: mediaType,
                        video_id: vidId,
                        photo_id: null,
                        start_time: occ.start_time || 0.0,
                        end_time: occ.end_time || 0.0,
                        text: occ.text || "",
                        filename: videoFilename,
                        score: occ.score,
                        cardElement: subCard
                    };
                    SEARCH_STATE.playlistItems.push(subPlaylistItem);
                    
                    subCard.addEventListener("click", (e) => {
                        e.stopPropagation(); // Evitar disparar o play do card principal
                        const idx = SEARCH_STATE.playlistItems.findIndex(item => item.id === occ.id);
                        if (idx !== -1) {
                            playSearchPlaylistItem(idx);
                        }
                    });
                    
                    subCard.addEventListener("mouseenter", () => {
                        subCard.style.background = "rgba(255,255,255,0.04)";
                        const tempResult = {
                            payload: {
                                media_type: mediaType,
                                video_id: vidId,
                                start_time: occ.start_time,
                                end_time: occ.end_time,
                                filename: videoFilename
                            }
                        };
                        showSearchResultPreview(tempResult, subCard);
                    });
                    subCard.addEventListener("mouseleave", () => {
                        subCard.style.background = "rgba(255,255,255,0.01)";
                        hideSearchResultPreview();
                    });
                    
                    const viewOccBtn = subCard.querySelector(".view-occ-context-btn");
                    if (viewOccBtn) {
                        viewOccBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            const idx = SEARCH_STATE.playlistItems.findIndex(item => item.id === occ.id);
                            if (idx !== -1) {
                                SEARCH_STATE.playlistIndex = idx;
                                updatePlaylistUI();
                            }
                            
                            const targetVid = STATE.allVideos.find(v => v.id === vidId);
                            if (targetVid) {
                                STATE.activeVideo = targetVid;
                                highlightAndScrollToDialogue(occ.start_time);
                            }
                        });
                    }
                    
                    listDiv.appendChild(subCard);
                });
                
                card.appendChild(occWrapper);
            }
        }
        
        // Hover previews para os cards principais
        card.addEventListener("mouseenter", () => {
            showSearchResultPreview(r, card);
        });
        card.addEventListener("mouseleave", () => {
            hideSearchResultPreview();
        });
        
        resultsList.appendChild(card);
    });
    
    // Atualizar UI dos controles de playlist
    const controlsDiv = searchContainer.querySelector(".search-playlist-controls");
    const optionsDiv = searchContainer.querySelector(".search-playlist-options");
    if (controlsDiv) {
        if (SEARCH_STATE.playlistItems.length > 0) {
            controlsDiv.style.display = "flex";
            if (optionsDiv) optionsDiv.style.display = "flex";
            updatePlaylistUI();
        } else {
            controlsDiv.style.display = "none";
            if (optionsDiv) optionsDiv.style.display = "none";
        }
    }
}

async function loadMoreResults() {
    SEARCH_STATE.isLoading = true;
    const loader = document.querySelector(".search-loading-more");
    if (loader) loader.style.display = "block";
    
    SEARCH_STATE.offset += SEARCH_STATE.limit;
    
    try {
        const data = await CapIAuAPI.search(
            SEARCH_STATE.query,
            STATE.currentProjectId,
            SEARCH_STATE.activeMediaFilter,
            SEARCH_STATE.limit,
            SEARCH_STATE.offset
        );
        
        const results = data.results || [];
        if (results.length < SEARCH_STATE.limit) {
            SEARCH_STATE.hasMore = false;
        }
        
        SEARCH_STATE.loadedResults = SEARCH_STATE.loadedResults.concat(results);
        
        applyFiltersAndRenderCards();
        updateContextPills();
    } catch (err) {
        console.error("Erro ao carregar mais resultados:", err);
    } finally {
        SEARCH_STATE.isLoading = false;
        if (loader) loader.style.display = "none";
    }
}

function renderSearchResults(query) {
    const searchContainer = getActiveElement("search-container");
    if (!searchContainer) return;

    searchContainer.innerHTML = `
        <div class="transcription-actions" style="border:none; padding: 6px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0;">
            <h4 style="font-size:11px; color:var(--color-cyan); display: flex; align-items: center; gap: 4px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" data-tooltip="Resultados para: &quot;${escapeHtml(query)}&quot;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> "${query}"
            </h4>
            <div class="search-type-tabs" style="margin: 0; padding: 0; border: none; gap: 4px; display: flex; align-items: center; flex-shrink: 0;">
                <div class="search-type-tab ${SEARCH_STATE.activeMediaFilter === '' ? 'active' : ''}" data-type="" data-tooltip="Todas as Mídias" style="width: 24px; height: 24px; font-size: 11px;"><i class="fa-solid fa-border-all"></i></div>
                <div class="search-type-tab ${SEARCH_STATE.activeMediaFilter === 'interview' ? 'active' : ''}" data-type="interview" data-tooltip="Entrevistas (ASR)" style="width: 24px; height: 24px; font-size: 11px;"><i class="fa-solid fa-microphone-lines"></i></div>
                <div class="search-type-tab ${SEARCH_STATE.activeMediaFilter === 'broll' ? 'active' : ''}" data-type="broll" data-tooltip="Bastidores (B-roll)" style="width: 24px; height: 24px; font-size: 11px;"><i class="fa-solid fa-video"></i></div>
                <div class="search-type-tab ${SEARCH_STATE.activeMediaFilter === 'photo' ? 'active' : ''}" data-type="photo" data-tooltip="Fotos de Set" style="width: 24px; height: 24px; font-size: 11px;"><i class="fa-solid fa-camera"></i></div>
            </div>
        </div>

        <div class="search-playlist-controls" style="display: none; align-items: center; justify-content: space-between; background: transparent; border: none; margin: 0 12px 6px 12px; padding: 0; font-size: 11px; flex-shrink: 0; flex-wrap: wrap; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 4px;">
                <button id="btn-search-prev" class="flat-sidebar-btn" style="padding: 2px 4px; font-size: 9px; height: 20px; width: 20px; display: flex; align-items: center; justify-content: center;" data-tooltip="Resultado Anterior">
                    <i class="fa-solid fa-step-backward"></i>
                </button>
                <button id="btn-search-play-seq" class="flat-sidebar-btn" style="padding: 2px 6px; font-size: 10px; height: 20px; display: flex; align-items: center; justify-content: center; gap: 3px; font-weight:600;" data-tooltip="Iniciar Reprodução Automática Sequencial">
                    <i class="fa-solid fa-play"></i> Autoplay
                </button>
                <button id="btn-search-next" class="flat-sidebar-btn" style="padding: 2px 4px; font-size: 9px; height: 20px; width: 20px; display: flex; align-items: center; justify-content: center;" data-tooltip="Próximo Resultado">
                    <i class="fa-solid fa-step-forward"></i>
                </button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div id="search-playlist-status" style="color: var(--text-muted); font-size: 10px; font-weight: 600;">
                    Nenhum selecionado
                </div>
                <div class="search-playlist-options" style="display: none; align-items: center; margin: 0; padding: 0;">
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-secondary); cursor: pointer; user-select: none;" data-tooltip="Abrir fotos no player de vídeo">
                        <input type="checkbox" id="chk-search-photos-in-player" style="cursor: pointer; width: 11px; height: 11px; accent-color: var(--color-cyan);">
                        <span>Abrir fotos</span>
                    </label>
                </div>
            </div>
        </div>

        <div class="context-filters-container">
            <!-- Pílulas contextuais e IA injetadas dinamicamente -->
        </div>

        <div class="search-results-list scrollable" style="flex: 1; overflow-y: auto; padding: 0 12px 10px 12px; min-height: 0;"></div>
        
        <div class="search-loading-more" style="display:none; text-align:center; padding: 10px; font-size:11px; color:var(--text-muted); flex-shrink: 0;">
            <i class="fa-solid fa-spinner fa-spin"></i> Carregando mais resultados...
        </div>
    `;

    const btnPrev = searchContainer.querySelector("#btn-search-prev");
    const btnNext = searchContainer.querySelector("#btn-search-next");
    const btnPlaySeq = searchContainer.querySelector("#btn-search-play-seq");
    
    if (btnPrev) btnPrev.addEventListener("click", playPrevSearchItem);
    if (btnNext) btnNext.addEventListener("click", playNextSearchItem);
    if (btnPlaySeq) {
        btnPlaySeq.addEventListener("click", () => {
            SEARCH_STATE.autoplaySeq = !SEARCH_STATE.autoplaySeq;
            if (SEARCH_STATE.autoplaySeq) {
                const targetIdx = SEARCH_STATE.playlistIndex === -1 ? 0 : SEARCH_STATE.playlistIndex;
                playSearchPlaylistItem(targetIdx);
            } else {
                if (SEARCH_STATE.photoTimer) clearTimeout(SEARCH_STATE.photoTimer);
                const playerEl = document.getElementById("source-video");
                if (playerEl) playerEl.pause();
                updatePlaylistUI();
            }
        });
    }

    const chkSearch = searchContainer.querySelector("#chk-search-photos-in-player");
    if (chkSearch) {
        chkSearch.checked = STATE.openPhotosInPlayer;
        chkSearch.addEventListener("change", (e) => {
            STATE.openPhotosInPlayer = e.target.checked;
        });
    }

    const tabs = searchContainer.querySelectorAll(".search-type-tab");
    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            tabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            
            const selectedType = tab.getAttribute("data-type");
            SEARCH_STATE.activeMediaFilter = selectedType;

            SEARCH_STATE.activeContextFilters.clear();
            SEARCH_STATE.activeAiCategory = null;
            SEARCH_STATE.showAllTags = false;

            // Resultado de busca em lote: a aba re-consulta a rota similar-batch
            // com o filtro de tipo (substitui o antigo dropdown de destino)
            if (SEARCH_STATE.similarBatchContext) {
                await runSimilarBatch(selectedType || null);
                return;
            }

            // Fazer uma nova busca no backend com o novo tipo de mídia selecionado
            SEARCH_STATE.offset = 0;
            SEARCH_STATE.hasMore = true;
            SEARCH_STATE.loadedResults = [];
            
            const resultsList = searchContainer.querySelector(".search-results-list");
            if (resultsList) {
                resultsList.innerHTML = "<div class='loading' style='padding: 15px;'>Filtrando mídias...</div>";
            }
            
            try {
                const data = await CapIAuAPI.search(
                    SEARCH_STATE.query,
                    STATE.currentProjectId,
                    SEARCH_STATE.activeMediaFilter,
                    SEARCH_STATE.limit,
                    SEARCH_STATE.offset
                );
                const results = data.results || [];
                SEARCH_STATE.loadedResults = results;
                if (results.length < SEARCH_STATE.limit) {
                    SEARCH_STATE.hasMore = false;
                }
                updateContextPills();
                applyFiltersAndRenderCards();
            } catch (err) {
                console.error("Erro ao filtrar busca:", err);
                if (resultsList) {
                    resultsList.innerHTML = `<div class='error' style='padding: 15px;'>Erro: ${err.message}</div>`;
                }
            }
        });
    });

    updateContextPills();
    applyFiltersAndRenderCards();
}

async function runSemanticSearch() {
    const searchInput = document.getElementById("semantic-search-input");
    const filterSelect = document.getElementById("search-filter");
    if (!searchInput) return;

    const query = searchInput.value.trim();
    if (!query) return;
    
    const filter = filterSelect ? filterSelect.value : "";
    const searchContainer = getActiveElement("search-container");
    if (searchContainer) {
        searchContainer.innerHTML = "<div class='loading' style='padding: 15px;'>Buscando conceitos na biblioteca...</div>";
    }
    
    STATE.currentRightTab = "search";

    SEARCH_STATE.query = query;
    SEARCH_STATE.similarBatchContext = null; // sai do modo lote: abas voltam à busca normal
    SEARCH_STATE.offset = 0;
    SEARCH_STATE.hasMore = true;
    SEARCH_STATE.isLoading = false;
    SEARCH_STATE.loadedResults = [];
    SEARCH_STATE.activeMediaFilter = filter;
    SEARCH_STATE.activeContextFilters.clear();
    SEARCH_STATE.aiCategories = null;
    SEARCH_STATE.activeAiCategory = null;
    SEARCH_STATE.showAllTags = false;

    try {
        const data = await CapIAuAPI.search(query, STATE.currentProjectId, filter, SEARCH_STATE.limit, SEARCH_STATE.offset);
        const results = data.results || [];
        SEARCH_STATE.loadedResults = results;
        if (results.length < SEARCH_STATE.limit) {
            SEARCH_STATE.hasMore = false;
        }
        
        renderSearchResults(query);
    } catch (err) {
        console.error("Erro na busca semântica:", err);
        if (searchContainer) {
            searchContainer.innerHTML = `<div class='error' style='padding: 15px;'>Erro na busca semântica: ${err.message}</div>`;
        }
    }
}
window.runSemanticSearch = runSemanticSearch;

/**
 * Busca visual "Encontrar similares" (E2.B6): mostra no painel de busca as mídias
 * visualmente próximas de uma foto ou de um momento de vídeo, via CLIP local.
 * @param {"photo"|"video"} kind
 * @param {number} id - photo_id ou video_id
 * @param {{timestamp?: number, label?: string}} opts
 */
async function showSimilarMedia(kind, id, opts = {}) {
    const searchContainer = getActiveElement("search-container");
    if (searchContainer) {
        searchContainer.innerHTML = "<div class='loading' style='padding: 15px;'>Buscando mídias visualmente similares (CLIP local)...</div>";
    }
    STATE.currentRightTab = "search";

    SEARCH_STATE.query = "";
    SEARCH_STATE.similarBatchContext = null; // sai do modo lote: abas voltam à busca normal
    SEARCH_STATE.offset = 0;
    SEARCH_STATE.hasMore = false; // resultado fechado: sem paginação/infinite scroll
    SEARCH_STATE.isLoading = false;
    SEARCH_STATE.loadedResults = [];
    SEARCH_STATE.activeMediaFilter = "";
    SEARCH_STATE.activeContextFilters.clear();
    SEARCH_STATE.aiCategories = null;
    SEARCH_STATE.activeAiCategory = null;
    SEARCH_STATE.showAllTags = false;

    try {
        const params = new URLSearchParams({ project_id: STATE.currentProjectId });
        if (kind === "video" && opts.timestamp != null) params.set("timestamp", opts.timestamp.toFixed(2));
        const data = await CapIAuAPI.request(`/api/media/${kind}/${id}/similar?${params}`);
        SEARCH_STATE.loadedResults = data.results || [];
        renderSearchResults(opts.label ? `Similares a: ${opts.label}` : "Similares (visual)");
    } catch (err) {
        console.error("Erro na busca de similares:", err);
        if (searchContainer) {
            searchContainer.innerHTML = `<div class='error' style='padding: 15px;'>Erro ao buscar similares: ${err.message}</div>`;
        }
    }
}
window.showSimilarMedia = showSimilarMedia;

window.selectedSimilarItems = [];

window.toggleSelectSimilarItem = function(kind, id, title, cardEl, timestamp = null, mediaType = null) {
    if (!window.selectedSimilarItems) {
        window.selectedSimilarItems = [];
    }
    const idx = window.selectedSimilarItems.findIndex(item =>
        item.kind === kind &&
        item.id === id &&
        (kind !== "video" || item.timestamp === timestamp)
    );

    if (idx >= 0) {
        window.selectedSimilarItems.splice(idx, 1);
        cardEl.classList.remove("selected-for-similar");
        const icon = cardEl.querySelector(".btn-select-similar-item i");
        if (icon) {
            icon.className = "fa-regular fa-square";
            icon.style.color = "var(--text-muted)";
        }
    } else {
        window.selectedSimilarItems.push({ kind, id, title, timestamp, mediaType });
        cardEl.classList.add("selected-for-similar");
        const icon = cardEl.querySelector(".btn-select-similar-item i");
        if (icon) {
            icon.className = "fa-solid fa-square-check";
            icon.style.color = "var(--color-cyan)";
        }
    }
    
    window.updateSimilarSelectionUI();
};

window.updateSimilarSelectionUI = function() {
    const count = window.selectedSimilarItems ? window.selectedSimilarItems.length : 0;
    
    const searchBtn = document.getElementById("btn-search-similar-selected");
    const clearBtn = document.getElementById("btn-clear-similar-selected");
    const countSpan = document.getElementById("similar-selected-count");
    
    if (searchBtn) {
        searchBtn.style.display = count > 0 ? "inline-flex" : "none";
    }
    if (clearBtn) {
        clearBtn.style.display = count > 0 ? "inline-flex" : "none";
    }
    if (countSpan) {
        countSpan.textContent = count;
    }
    
    document.querySelectorAll(".media-card, .photo-card, .search-result-card").forEach(el => {
        const vidId = el.getAttribute("data-video-id");
        const photoId = el.getAttribute("data-photo-id");
        
        let isSelected = false;
        if (vidId) {
            isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => item.kind === "video" && item.id == vidId && item.timestamp === null);
        } else if (photoId) {
            isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => item.kind === "photo" && item.id == photoId);
        }
        
        const selectBtn = el.querySelector(".btn-select-similar-item");
        const icon = selectBtn ? selectBtn.querySelector("i") : null;
        
        const isSearchResult = el.classList.contains("search-result-card");
        if (isSearchResult) {
            const isVideo = el.classList.contains("type-interview") || el.classList.contains("type-broll");
            if (isVideo) {
                const foundItem = SEARCH_STATE.playlistItems.find(item => item.cardElement === el);
                if (foundItem) {
                    isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => 
                        item.kind === "video" && item.id == foundItem.video_id && item.timestamp === foundItem.start_time
                    );
                }
            } else {
                const foundItem = SEARCH_STATE.playlistItems.find(item => item.cardElement === el);
                if (foundItem) {
                    isSelected = window.selectedSimilarItems && window.selectedSimilarItems.some(item => 
                        item.kind === "photo" && item.id == foundItem.photo_id
                    );
                }
            }
        }
        
        if (isSelected) {
            el.classList.add("selected-for-similar");
            if (icon) {
                icon.className = "fa-solid fa-square-check";
                icon.style.color = "var(--color-cyan)";
            }
        } else {
            el.classList.remove("selected-for-similar");
            if (icon) {
                icon.className = "fa-regular fa-square";
                icon.style.color = "var(--text-muted)";
            }
        }
    });
};

window.clearSimilarSelection = function() {
    window.selectedSimilarItems = [];
    document.querySelectorAll(".selected-for-similar").forEach(el => {
        el.classList.remove("selected-for-similar");
        const icon = el.querySelector(".btn-select-similar-item i");
        if (icon) {
            icon.className = "fa-regular fa-square";
            icon.style.color = "var(--text-muted)";
        }
    });
    window.updateSimilarSelectionUI();
};

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
window.escapeHtml = escapeHtml;

/** Traduz os códigos de warning do backend para frases didáticas. */
function describeSimilarWarnings(warnings = []) {
    const out = [];
    let semIndice = 0;
    warnings.forEach(w => {
        if (w === "photos_use_descriptions") {
            out.push("fotos não têm fala — usando as descrições geradas pela análise");
        } else if (String(w).startsWith("item_sem_indice:")) {
            semIndice++;
        }
    });
    if (semIndice > 0) {
        out.push(semIndice === 1
            ? "1 item foi ignorado (ainda não analisado/indexado)"
            : `${semIndice} itens foram ignorados (ainda não analisados/indexados)`);
    }
    return out;
}

/** Cabeçalho-receita: mostra COMO a busca em lote foi montada (didática). */
function injectSimilarRecipeHeader(data) {
    const ctx = SEARCH_STATE.similarBatchContext;
    const searchContainer = getActiveElement("search-container");
    if (!ctx || !searchContainer) return;

    const n = ctx.items.length;
    const cohesionPct = Math.round((data.cohesion || 0) * 100);
    const modeLine = data.mode_used === "uniao"
        ? `<i class="fa-solid fa-arrows-split-up-and-left"></i> Seleção variada (coesão ${cohesionPct}%) — buscando parecidos com <strong>qualquer um</strong> dos ${n} itens`
        : `<i class="fa-solid fa-arrows-to-circle"></i> Buscando o <strong>tema comum</strong> entre ${n === 1 ? "o item selecionado" : `os ${n} itens`} (coesão da seleção: ${cohesionPct}%)`;
    const criteriaLine = ctx.searchType === "visual"
        ? "Critério: aparência visual (CLIP) — cores, enquadramento e composição"
        : "Critério: assunto e contexto (embeddings de texto) — o que é falado ou descrito";
    const sourcesLine = ctx.titles.map(t => escapeHtml(t)).join(", ");
    const warningsHtml = describeSimilarWarnings(data.warnings)
        .map(w => `<div class="similar-recipe-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(w)}</div>`)
        .join("");

    const header = document.createElement("div");
    header.className = "similar-recipe-header";
    header.innerHTML = `
        <div class="recipe-mode">${modeLine}</div>
        <div class="recipe-sources">${escapeHtml(criteriaLine)}</div>
        <div class="recipe-sources">Itens de origem: ${sourcesLine}</div>
        ${warningsHtml}
    `;
    const titleDiv = searchContainer.querySelector(".transcription-actions");
    if (titleDiv) titleDiv.insertAdjacentElement("afterend", header);
    else searchContainer.prepend(header);
}

/** Executa/re-executa a busca em lote (as abas de tipo re-consultam com filtro). */
async function runSimilarBatch(mediaTypeFilter = null) {
    const ctx = SEARCH_STATE.similarBatchContext;
    if (!ctx) return;

    const searchContainer = getActiveElement("search-container");
    if (searchContainer) {
        const loadingMsg = ctx.searchType === "visual"
            ? "Buscando mídias com aparência parecida (CLIP local)..."
            : "Buscando mídias sobre o mesmo assunto (busca semântica local)...";
        searchContainer.innerHTML = `<div class='loading' style='padding: 15px;'>${loadingMsg}</div>`;
    }

    SEARCH_STATE.query = "";
    SEARCH_STATE.offset = 0;
    SEARCH_STATE.hasMore = false;
    SEARCH_STATE.isLoading = false;
    SEARCH_STATE.loadedResults = [];
    SEARCH_STATE.activeMediaFilter = mediaTypeFilter || "";
    SEARCH_STATE.activeContextFilters.clear();
    SEARCH_STATE.aiCategories = null;
    SEARCH_STATE.activeAiCategory = null;
    SEARCH_STATE.showAllTags = false;

    try {
        const data = await CapIAuAPI.request("/api/media/similar-batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: STATE.currentProjectId,
                items: ctx.items,
                search_type: ctx.searchType,
                media_type_filter: mediaTypeFilter || "all",
                limit: 20
            })
        });

        SEARCH_STATE.loadedResults = data.results || [];
        const criteriaName = ctx.searchType === "visual" ? "aparência visual" : "assunto em comum";
        renderSearchResults(`Similares (${criteriaName}) a ${ctx.items.length} ${ctx.items.length === 1 ? "item" : "itens"}`);
        injectSimilarRecipeHeader(data);
    } catch (err) {
        console.error("Erro na busca de similares em lote:", err);
        if (searchContainer) {
            searchContainer.innerHTML = `<div class='error' style='padding: 15px;'>Erro ao buscar similares: ${escapeHtml(err.message)}</div>`;
        }
    }
}

/** Pré-sugere o critério conforme a seleção (só fotos -> visual; só entrevistas -> textual). */
function applySimilarCriteriaSuggestion() {
    const sel = window.selectedSimilarItems || [];
    const hint = document.getElementById("similar-criteria-hint");
    const types = sel.map(i => i.kind === "photo" ? "photo" : (i.mediaType || "video"));

    let suggested = null;
    if (sel.length > 0 && types.every(t => t === "photo")) suggested = "visual";
    else if (sel.length > 0 && types.every(t => t === "interview")) suggested = "textual";

    const target = suggested || localStorage.getItem("similar_search_type_last") || "visual";
    const radio = document.querySelector(`input[name='similar-search-type'][value='${target}']`);
    if (radio) radio.checked = true;

    if (hint) {
        if (suggested === "visual") {
            hint.style.display = "block";
            hint.textContent = "Sugerido para sua seleção (só fotos): comparar a aparência costuma funcionar melhor.";
        } else if (suggested === "textual") {
            hint.style.display = "block";
            hint.textContent = "Sugerido para sua seleção (só entrevistas): comparar o assunto das falas costuma funcionar melhor.";
        } else {
            hint.style.display = "none";
        }
    }
}

window.searchSimilarMultiple = async function() {
    if (!window.selectedSimilarItems || window.selectedSimilarItems.length === 0) return;

    const checkedRadio = document.querySelector("input[name='similar-search-type']:checked");
    const searchType = checkedRadio ? checkedRadio.value : "visual";
    localStorage.setItem("similar_search_type_last", searchType);

    SEARCH_STATE.similarBatchContext = {
        items: window.selectedSimilarItems.map(item => ({
            kind: item.kind, id: item.id, timestamp: item.timestamp
        })),
        titles: window.selectedSimilarItems.map(item => item.title || `${item.kind} ${item.id}`),
        searchType
    };

    STATE.currentRightTab = "search";
    const searchTabBtn = document.querySelector(`.tab-btn[data-tab="tab-search"]`);
    if (searchTabBtn) searchTabBtn.click();

    const similarDropdown = document.getElementById("library-similar-settings-dropdown");
    if (similarDropdown) similarDropdown.style.display = "none";

    await runSimilarBatch(null);
};

// updateActionsRowVisibility removed as actions are now persistent inside each panel container

// Inicialização da Aplicação
window.addEventListener("DOMContentLoaded", () => {
    console.log("CapIAu-Talho: Inicializando os módulos...");

    // Event listeners para busca de similares em lote
    const searchSimilarBtn = document.getElementById("btn-search-similar-selected");
    const clearSimilarBtn = document.getElementById("btn-clear-similar-selected");
    const triggerSimilarBtn = document.getElementById("btn-trigger-similar-search");
    const similarDropdown = document.getElementById("library-similar-settings-dropdown");
    
    if (searchSimilarBtn) {
        searchSimilarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (similarDropdown) {
                if (similarDropdown.style.display === "none") {
                    applySimilarCriteriaSuggestion();
                    similarDropdown.style.display = "flex";
                } else {
                    similarDropdown.style.display = "none";
                }
            }
        });
    }
    
    if (clearSimilarBtn) {
        clearSimilarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.clearSimilarSelection();
        });
    }
    
    if (triggerSimilarBtn) {
        triggerSimilarBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.searchSimilarMultiple();
        });
    }
    
    // Close similar settings popover when clicking outside
    document.addEventListener("click", (e) => {
        if (similarDropdown && similarDropdown.style.display === "flex") {
            if (!similarDropdown.contains(e.target) && e.target !== searchSimilarBtn && !searchSimilarBtn.contains(e.target)) {
                similarDropdown.style.display = "none";
            }
        }
    });

    // Inicializa a customização de abas (Drag & Drop e Visibilidade)
    initTabsCustomization();

    // Auto-converter de title para data-tooltip para tooltips premium unificadas
    const convertTitleToTooltip = (root = document) => {
        root.querySelectorAll("[title]").forEach(el => {
            const title = el.getAttribute("title");
            if (title && !el.hasAttribute("data-tooltip")) {
                el.setAttribute("data-tooltip", title);
                el.removeAttribute("title");
            }
        });
    };
    convertTitleToTooltip();
    
    // Configura um MutationObserver para lidar com elementos criados dinamicamente
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.hasAttribute("title")) {
                        const title = node.getAttribute("title");
                        node.setAttribute("data-tooltip", title);
                        node.removeAttribute("title");
                    }
                    node.querySelectorAll("[title]").forEach(el => {
                        const title = el.getAttribute("title");
                        el.setAttribute("data-tooltip", title);
                        el.removeAttribute("title");
                    });
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Criar elemento global de tooltip
    const globalTooltip = document.createElement("div");
    globalTooltip.id = "global-tooltip";
    document.body.appendChild(globalTooltip);

    // Eventos mouseover/mouseout delegados para exibir e posicionar a tooltip global
    document.body.addEventListener("mouseover", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (!target) return;

        const text = target.getAttribute("data-tooltip");
        if (!text) return;

        globalTooltip.textContent = text;
        globalTooltip.classList.add("visible");

        // Calcula a posição da tooltip
        const rect = target.getBoundingClientRect();
        const tooltipRect = globalTooltip.getBoundingClientRect();

        // Posição padrão: acima do elemento
        let top = rect.top - tooltipRect.height - 8;
        let left = rect.left + (rect.width - tooltipRect.width) / 2;

        // Se sair do topo da tela, coloca abaixo do elemento
        if (top < 8) {
            top = rect.bottom + 8;
        }

        // Garante que não ultrapasse as bordas laterais da tela
        const screenMargin = 8;
        if (left < screenMargin) {
            left = screenMargin;
        } else if (left + tooltipRect.width > window.innerWidth - screenMargin) {
            left = window.innerWidth - tooltipRect.width - screenMargin;
        }

        globalTooltip.style.top = `${top}px`;
        globalTooltip.style.left = `${left}px`;
    });

    document.body.addEventListener("mouseout", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (!target) return;
        globalTooltip.classList.remove("visible");
    });

    // Instanciando os gerenciadores
    const workspace = new WorkspaceManager();
    window.workspaceManager = workspace;
    const player = new VideoPlayer();
    window.player = player;
    const library = new LibraryManager();
    window.libraryManager = library;
    const panels = new PanelsManager();
    window.panelsManager = panels;
    const chat = new ChatManager();
    const projects = new ProjectsManager();
    window.FaceManager = FaceManager;
    FaceManager.init();
    const settingsPanel = new SettingsPanelManager();
    window.settingsPanel = settingsPanel;
    
    // Inicializa o sistema de auto-salvamento local
    initAutosave();

    // -- Open Photos in Player Configuration --
    const btnLibrary = document.getElementById("btn-library-photos-in-player");
    function updatePhotoPlayerBtnStyle(btn, active) {
        if (!btn) return;
        if (active) {
            btn.style.color = "var(--color-cyan)";
            btn.style.borderColor = "rgba(6,182,212,0.4)";
        } else {
            btn.style.color = "var(--text-muted)";
            btn.style.borderColor = "rgba(100,100,120,0.25)";
        }
    }
    if (btnLibrary) {
        btnLibrary.addEventListener("click", () => {
            STATE.openPhotosInPlayer = !STATE.openPhotosInPlayer;
        });
        updatePhotoPlayerBtnStyle(btnLibrary, STATE.openPhotosInPlayer);
    }

    STATE.on("openPhotosInPlayerChanged", (openInPlayer) => {
        const btnL = document.getElementById("btn-library-photos-in-player");
        updatePhotoPlayerBtnStyle(btnL, openInPlayer);
        
        const chkS = document.getElementById("chk-search-photos-in-player");
        if (chkS) chkS.checked = openInPlayer;
    });

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
            // Se o inspetor estiver aberto, fecha primeiro para restaurar players
            if (window.libraryManager && window.libraryManager.mediaInspectorActive) {
                window.libraryManager.closeMediaInspector();
            }
            sidebarLeft.classList.add("collapsed");
            reopenLeft.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        } else if (side === "right" && sidebarRight && reopenRight) {
            sidebarRight.classList.add("collapsed");
            reopenRight.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        } else if (side === "timeline" && timelinePanel && reopenTimeline) {
            timelinePanel.classList.add("collapsed");
            reopenTimeline.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        }
    };
    
    const expandSidebar = (side) => {
        if (side === "left" && sidebarLeft && reopenLeft) {
            sidebarLeft.classList.remove("collapsed");
            reopenLeft.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        } else if (side === "right" && sidebarRight && reopenRight) {
            sidebarRight.classList.remove("collapsed");
            reopenRight.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        } else if (side === "timeline" && timelinePanel && reopenTimeline) {
            timelinePanel.classList.remove("collapsed");
            reopenTimeline.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        }
    };

    if (toggleLeft) toggleLeft.addEventListener("click", () => collapseSidebar("left"));
    if (toggleRight) toggleRight.addEventListener("click", () => collapseSidebar("right"));
    if (toggleTimeline) toggleTimeline.addEventListener("click", () => collapseSidebar("timeline"));
    
    if (reopenLeft) reopenLeft.addEventListener("click", () => expandSidebar("left"));
    if (reopenRight) reopenRight.addEventListener("click", () => expandSidebar("right"));
    if (reopenTimeline) reopenTimeline.addEventListener("click", () => expandSidebar("timeline"));

    // ── CONFIGURAÇÃO DE RETRAÇÃO DO NOVO TOOLBAR E CABEÇALHOS DA TIMELINE ──
    const timelineActionsSidebar = document.getElementById("timeline-actions-sidebar");
    const timelineHeadersSidebar = document.getElementById("timeline-headers-sidebar");
    const btnToggleToolbar = document.getElementById("btn-toggle-toolbar");
    const btnToggleHeaders = document.getElementById("btn-toggle-headers");
    const reopenToolbar = document.getElementById("reopen-toolbar");
    const reopenHeaders = document.getElementById("reopen-headers");
    const btnCycleColumns = document.getElementById("btn-cycle-columns");

    if (btnToggleToolbar && timelineActionsSidebar && reopenToolbar) {
        btnToggleToolbar.addEventListener("click", () => {
            timelineActionsSidebar.classList.add("collapsed");
            reopenToolbar.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        });
    }

    if (reopenToolbar && timelineActionsSidebar) {
        reopenToolbar.addEventListener("click", () => {
            timelineActionsSidebar.classList.remove("collapsed");
            reopenToolbar.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        });
    }

    if (btnToggleHeaders && timelineHeadersSidebar && reopenHeaders) {
        btnToggleHeaders.addEventListener("click", () => {
            timelineHeadersSidebar.classList.add("collapsed");
            reopenHeaders.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        });
    }

    if (reopenHeaders && timelineHeadersSidebar) {
        reopenHeaders.addEventListener("click", () => {
            timelineHeadersSidebar.classList.remove("collapsed");
            reopenHeaders.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        });
    }

    // Alternar colunas do toolbar vertical (1 ou 2 colunas de botões)
    if (btnCycleColumns && timelineActionsSidebar) {
        btnCycleColumns.addEventListener("click", () => {
            if (timelineActionsSidebar.classList.contains("cols-1")) {
                timelineActionsSidebar.classList.remove("cols-1");
                timelineActionsSidebar.classList.add("cols-2");
            } else {
                timelineActionsSidebar.classList.remove("cols-2");
                timelineActionsSidebar.classList.add("cols-1");
            }
            window.dispatchEvent(new Event("resize"));
        });
    }

    // ── GATILHO E SINCRONIZAÇÃO DE RENOMEAR TIMELINE ──
    const btnRenameTimeline = document.getElementById("btn-rename-timeline");
    const timelineNameInput = document.getElementById("timeline-name-input");
    if (btnRenameTimeline && timelineNameInput) {
        btnRenameTimeline.addEventListener("click", () => {
            const currentName = timelineNameInput.value || "Versão sem nome";
            const newName = prompt("Renomear a timeline atual:", currentName);
            if (newName !== null && newName.trim() !== "") {
                timelineNameInput.value = newName.trim();
                btnRenameTimeline.setAttribute("data-tooltip", `Renomear Timeline (Atual: ${newName.trim()})`);
                timelineNameInput.dispatchEvent(new Event("change"));
            }
        });
        
        if (timelineNameInput.value) {
            btnRenameTimeline.setAttribute("data-tooltip", `Renomear Timeline (Atual: ${timelineNameInput.value})`);
        }
    }

    // ── DROPDOWN DE OPÇÕES DE VISUALIZAÇÃO DA TIMELINE ──
    const btnViewOptions = document.getElementById("btn-timeline-view-options");
    const viewOptionsDropdown = document.getElementById("timeline-view-options-dropdown");
    if (btnViewOptions && viewOptionsDropdown) {
        btnViewOptions.addEventListener("click", (e) => {
            e.stopPropagation();
            const visible = viewOptionsDropdown.style.display === "flex";
            viewOptionsDropdown.style.display = visible ? "none" : "flex";
        });

        // Esconde ao clicar fora
        document.addEventListener("click", (e) => {
            if (!viewOptionsDropdown.contains(e.target) && e.target !== btnViewOptions && !btnViewOptions.contains(e.target)) {
                viewOptionsDropdown.style.display = "none";
            }
        });

        // Configura estados iniciais no DOM a partir de TIMELINE_STATE
        const chkHover = document.getElementById("chk-timeline-hover-preview");
        if (chkHover) {
            chkHover.checked = !!TIMELINE_STATE.hoverPreviewEnabled;
            chkHover.addEventListener("change", (e) => {
                TIMELINE_STATE.toggleHoverPreview(e.target.checked);
            });
        }

        const chkMuteHidden = document.getElementById("chk-timeline-mute-hidden");
        if (chkMuteHidden) {
            chkMuteHidden.checked = !!TIMELINE_STATE.muteHiddenTracksPlayback;
            chkMuteHidden.addEventListener("change", (e) => {
                TIMELINE_STATE.setMuteHiddenTracksPlayback(e.target.checked);
            });
        }

        const selectDensity = document.getElementById("select-timeline-thumbs-density");
        if (selectDensity) {
            selectDensity.value = String(TIMELINE_STATE.globalThumbnailsInterval);
            selectDensity.addEventListener("change", (e) => {
                TIMELINE_STATE.setGlobalThumbnailsInterval(parseFloat(e.target.value));
            });
        }
    }

    // Alternar filtros/abas da biblioteca de mídias (hide/show)
    const btnToggleFilters = document.getElementById("btn-toggle-library-filters");
    if (btnToggleFilters && sidebarLeft) {
        btnToggleFilters.addEventListener("click", (e) => {
            e.stopPropagation();
            const isHidden = sidebarLeft.classList.toggle("filters-collapsed");
            const icon = btnToggleFilters.querySelector("i");
            if (icon) {
                if (isHidden) {
                    icon.className = "fa-solid fa-eye-slash";
                    btnToggleFilters.title = "Mostrar Filtros/Abas";
                } else {
                    icon.className = "fa-solid fa-eye";
                    btnToggleFilters.title = "Ocultar Filtros/Abas";
                }
            }
            window.dispatchEvent(new Event("resize"));
        });
    }

    // ── CONFIGURAÇÃO DO CABEÇALHO RETRÁTIL ──
    const appContainer = document.querySelector(".app-container");
    const btnCollapseHeader = document.getElementById("btn-collapse-header");
    const headerRestoreTrigger = document.getElementById("header-restore-trigger");

    if (btnCollapseHeader && headerRestoreTrigger && appContainer) {
        btnCollapseHeader.addEventListener("click", () => {
            appContainer.classList.add("header-collapsed");
            headerRestoreTrigger.style.display = "block";
            window.dispatchEvent(new Event("resize"));
        });

        headerRestoreTrigger.addEventListener("click", () => {
            appContainer.classList.remove("header-collapsed");
            headerRestoreTrigger.style.display = "none";
            window.dispatchEvent(new Event("resize"));
        });
    }

    // ── TABS NATIVAS DA ESQUERDA (BIBLIOTECA) ──
    document.querySelectorAll(".sidebar-left .tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const doc = btn.ownerDocument;
            doc.querySelectorAll(".sidebar-left .tab-btn").forEach(b => b.classList.remove("active"));
            doc.querySelectorAll(".sidebar-left .tab-content").forEach(c => c.classList.remove("active"));
            
            btn.classList.add("active");
            const targetContent = doc.getElementById(btn.dataset.tab);
            if (targetContent) {
                targetContent.classList.add("active");
            }
            // Salva no localStorage
            localStorage.setItem("active-left-tab", btn.dataset.tab);
            STATE.emit("leftTabChanged", btn.dataset.tab);
            
            // Dispatch input event to apply search filter immediately to the active tab
            const searchInput = doc.getElementById("library-search-input");
            if (searchInput) {
                searchInput.dispatchEvent(new Event("input"));
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
        logs: document.getElementById("logs-container"),
        search: document.getElementById("search-container"),
    };

    rightTabs.forEach(btn => {
        btn.addEventListener("click", () => {
            rightTabs.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            
            const tab = btn.dataset.rightTab;
            STATE.currentRightTab = tab;
            // Salva no localStorage
            localStorage.setItem("active-right-tab", tab);
        });
    });

    // Restaurar abas do localStorage na inicialização
    const savedLeftTab = localStorage.getItem("active-left-tab");
    if (savedLeftTab) {
        const btn = document.querySelector(`.sidebar-left .tab-btn[data-tab="${savedLeftTab}"]`);
        if (btn && btn.style.display !== "none") btn.click();
    }
    const savedRightTab = localStorage.getItem("active-right-tab");
    if (savedRightTab) {
        const btn = document.querySelector(`#right-tabs .tab-btn[data-right-tab="${savedRightTab}"]`);
        if (btn && btn.style.display !== "none") btn.click();
    }

    STATE.on("rightTabChanged", (tab) => {
        // Ocultar todos os containers
        Object.values(rightContainers).forEach(c => {
            if (c) c.style.display = "none";
        });
        
        // Exibir container ativo.
        // "transcript" É flex-row (lista de falas + inspetor lado a lado) e "chat" é flex-column —
        // ambos PRECISAM de flex. Usar "block" aqui quebrava o inspetor (empurrado p/ baixo e cortado
        // pelo overflow:hidden), fazendo parecer que ele "não abre" após trocar de aba.
        const activeContainer = rightContainers[tab];
        if (activeContainer) {
            activeContainer.style.display = (tab === "chat" || tab === "transcript" || tab === "logs" || tab === "vision" || tab === "tasks" || tab === "search") ? "flex" : "block";
        }
        
        // Manter destaque no botão ativo
        rightTabs.forEach(btn => {
            if (btn.dataset.rightTab === tab) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    });

    // Ocultar ou mostrar botão de visão baseado no tipo do vídeo ativo
    STATE.on("activeVideoChanged", (video) => {
        const btnTabVision = document.getElementById("btn-tab-vision");
        if (!btnTabVision) return;

        // Verifica se a visão foi desativada explicitamente pelo usuário
        const savedVisibility = localStorage.getItem("right-tabs-visibility");
        const visibility = savedVisibility ? JSON.parse(savedVisibility) : {};
        if (visibility["vision"] === false) {
            btnTabVision.style.display = "none";
            return;
        }

        if (!video) {
            btnTabVision.style.display = "none";
            return;
        }

        if (video.video_type === "broll") {
            btnTabVision.style.display = ""; // deixa o CSS controlar o display (inline-flex)
        } else {
            btnTabVision.style.display = "none";
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

    // Ouvinte de rolagem infinita no container pai da barra lateral direita (garante escopo correto à direita)
    const sidebarContent = document.querySelector("#sidebar-right .sidebar-content.scrollable");
    if (sidebarContent) {
        sidebarContent.addEventListener("scroll", async () => {
            if (STATE.currentRightTab !== "search") return;
            const threshold = 100; // pixels antes do final da rolagem
            if (sidebarContent.scrollHeight - sidebarContent.scrollTop - sidebarContent.clientHeight < threshold) {
                if (SEARCH_STATE.hasMore && !SEARCH_STATE.isLoading) {
                    await loadMoreResults();
                }
            }
        });
    }

    // Carregar projetos iniciais
    projects.loadProjectsList().then(() => {
        console.log("Projetos iniciais carregados e configurados.");
    });

    // -- AWS S3 Status and Backup Integration --
    const s3Indicator = document.getElementById("s3-status-indicator");
    
    async function updateS3Status() {
        if (!s3Indicator) return;
        try {
            const status = await CapIAuAPI.fetchS3Status();
            if (status.enabled) {
                if (status.cost_limit_reached) {
                    s3Indicator.style.color = "var(--color-rose)";
                    s3Indicator.title = `S3 Bloqueado: Limite Financeiro Atingido (${status.total_size_gb.toFixed(2)} GB / 150 GB)`;
                    s3Indicator.className = "btn-icon warning";
                } else {
                    s3Indicator.style.color = "var(--color-emerald)"; // Green
                    s3Indicator.title = `S3 Ativo (${status.total_size_gb.toFixed(2)} GB / 150 GB) - Clique para backup do banco de dados`;
                    s3Indicator.className = "btn-icon online";
                }
            } else {
                s3Indicator.style.color = "var(--text-muted)";
                s3Indicator.title = "S3 Inativo ou Desconfigurado no .env";
                s3Indicator.className = "btn-icon offline";
            }
        } catch (err) {
            console.error("Falha ao obter status S3:", err);
            s3Indicator.style.color = "var(--text-muted)";
            s3Indicator.title = "S3 Indisponível (Erro de Conexão)";
            s3Indicator.className = "btn-icon offline";
        }
    }

    if (s3Indicator) {
        s3Indicator.addEventListener("click", async () => {
            let status;
            try {
                status = await CapIAuAPI.fetchS3Status();
            } catch (err) {
                alert("Falha de conexão com o servidor backend.");
                return;
            }
            if (!status.enabled) {
                alert("O serviço S3 não está ativo ou não foi configurado no seu arquivo .env.");
                return;
            }
            if (status.cost_limit_reached) {
                alert(`Backup cancelado por segurança de custos! O limite de 150 GB foi atingido no bucket S3 (${status.total_size_gb.toFixed(2)} GB).`);
                return;
            }
            if (confirm("Deseja realizar o backup manual do banco de dados relacional (capiau.db) para o Amazon S3?")) {
                s3Indicator.style.color = "var(--color-cyan)";
                s3Indicator.title = "Realizando backup do banco de dados...";
                try {
                    const res = await CapIAuAPI.backupDatabase();
                    alert(res.message || "Backup realizado com sucesso!");
                } catch (err) {
                    alert(`Falha ao realizar backup: ${err.message || err}`);
                } finally {
                    updateS3Status();
                }
            }
        });
    }

    // -- Autoplay event listeners on main-video --
    const mainVideoEl = document.getElementById("source-video");
    if (mainVideoEl) {
        mainVideoEl.addEventListener("timeupdate", () => {
            if (!SEARCH_STATE.autoplaySeq) return;
            if (SEARCH_STATE.playlistIndex < 0 || SEARCH_STATE.playlistIndex >= SEARCH_STATE.playlistItems.length) return;
            
            const currentItem = SEARCH_STATE.playlistItems[SEARCH_STATE.playlistIndex];
            if (!currentItem || currentItem.media_type === "photo") return;
            
            // Check if player has loaded the correct video and seeked to near start_time
            if (Math.abs(mainVideoEl.currentTime - currentItem.start_time) < 2.0) {
                SEARCH_STATE.playbackActiveItemStarted = true;
            }
            
            if (!SEARCH_STATE.playbackActiveItemStarted) return;
            
            const targetEndTime = currentItem.end_time || (currentItem.start_time + 5.0);
            if (mainVideoEl.currentTime >= targetEndTime) {
                SEARCH_STATE.playbackActiveItemStarted = false;
                console.log(`Autoplay: segment ended at ${mainVideoEl.currentTime} (target: ${targetEndTime}). Advancing.`);
                playNextSearchItem();
            }
        });

        mainVideoEl.addEventListener("ended", () => {
            if (!SEARCH_STATE.autoplaySeq) return;
            console.log("Autoplay: video ended. Advancing.");
            playNextSearchItem();
        });
    }

    // ── CONFIGURAÇÕES DA SEQUÊNCIA (FASE 2) ──
    const openSequenceSettings = () => {
        const timelineState = window.TIMELINE_STATE;
        if (!timelineState) return;

        timelineState.selectedClipId = null;

        if (window.workspaceManager && window.workspaceManager.timelinePanel && window.workspaceManager.timelinePanel.timelineInteraction) {
            const interaction = window.workspaceManager.timelinePanel.timelineInteraction;
            interaction.refreshClipInspector();

            const tabBtn = document.querySelector('.sidebar-left .tab-btn[data-tab="tab-adjustments"]');
            if (tabBtn) {
                if (tabBtn.style.display === "none") {
                    setTabVisibility("tab-adjustments", true);
                }
                if (!tabBtn.classList.contains("active")) {
                    tabBtn.click();
                }
            }
        }
    };

    const btnSeqSettingsProgram = document.getElementById("btn-seq-settings-program");
    if (btnSeqSettingsProgram) {
        btnSeqSettingsProgram.addEventListener("click", openSequenceSettings);
    }
    const btnSeqSettingsTimeline = document.getElementById("btn-seq-settings-timeline");
    if (btnSeqSettingsTimeline) {
        btnSeqSettingsTimeline.addEventListener("click", openSequenceSettings);
    }

    // ── CONTROLE DE ZOOM DO PREVIEW (FASE 3) ──
    const previewZoomSelect = document.getElementById("program-preview-zoom");
    if (previewZoomSelect) {
        previewZoomSelect.addEventListener("change", () => {
            const val = previewZoomSelect.value;
            const parsedZoom = val === "fit" ? "fit" : parseFloat(val);
            TIMELINE_STATE.previewZoom = parsedZoom;
            STATE.emit("previewZoomChanged", parsedZoom);
            triggerAutosave();
        });

        STATE.on("previewZoomChanged", (newZoom) => {
            const selectVal = newZoom === "fit" ? "fit" : String(newZoom);
            previewZoomSelect.value = selectVal;
        });

        if (TIMELINE_STATE.previewZoom !== undefined) {
            previewZoomSelect.value = TIMELINE_STATE.previewZoom === "fit" ? "fit" : String(TIMELINE_STATE.previewZoom);
        }
    }

    // Inicializa status S3 e atualiza a cada 60 segundos
    updateS3Status();
    setInterval(updateS3Status, 60000);
});
