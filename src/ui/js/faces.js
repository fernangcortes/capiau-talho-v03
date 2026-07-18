import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { parseQuery, evaluateAST } from "./searchParser.js";

export class FaceManager {
    static init() {
        const btnCluster = document.getElementById("btn-cluster-faces");
        if (btnCluster) {
            btnCluster.addEventListener("click", () => this.triggerClustering());
        }

        // Setup clustering settings toggle
        const toggle = document.getElementById("clustering-settings-toggle");
        const panel = document.getElementById("clustering-settings-panel");
        if (toggle && panel) {
            toggle.addEventListener("click", () => {
                const isOpen = panel.style.display === "flex";
                panel.style.display = isOpen ? "none" : "flex";
                const icon = toggle.querySelector(".toggle-icon");
                if (icon) {
                    icon.style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
                }
            });
        }

        // Setup slider value listener
        const epsInput = document.getElementById("input-clustering-eps");
        const epsVal = document.getElementById("val-clustering-eps");
        if (epsInput && epsVal) {
            epsInput.addEventListener("input", () => {
                epsVal.textContent = epsInput.value;
            });
            epsInput.addEventListener("dblclick", () => {
                epsInput.value = 0.38;
                epsVal.textContent = "0.38";
            });
        }

        const btnSyncEnrich = document.getElementById("btn-sync-enrich");
        if (btnSyncEnrich) {
            btnSyncEnrich.addEventListener("click", () => this.triggerManualEnrichment());
        }

        // Atalhos de teclado: busca rápida + Inspetor de Rosto (atalho 'a')
        document.addEventListener("keydown", (e) => {
            // Com o Inspetor aberto, ele captura a navegação — mesmo com foco num
            // input e independente do estado dos modais atrás dele.
            if (this.inspectorCard) {
                if (e.key === "Escape") { e.preventDefault(); this.closeInspector(); return; }
                if (e.key === "a" || e.key === "A") { e.preventDefault(); this.advanceInspector(); return; }
                if (e.key === "s" || e.key === "S") { e.preventDefault(); this.regressInspector(); return; }
                if (e.key === "ArrowLeft")  { e.preventDefault(); this.stepInspector(-1); return; }
                if (e.key === "ArrowRight") { e.preventDefault(); this.stepInspector(1);  return; }
                if (e.code === "Space" || e.key === " ") {
                    // Segurar espaço = modo mover (arraste). keyup limpa o modo.
                    e.preventDefault();
                    if (!this.fiSpace) {
                        this.fiSpace = true;
                        this._inspectorEl.querySelector(".fi-media").classList.add("space-mode");
                    }
                    return;
                }
                return; // enquanto inspeciona, o Inspetor consome as demais teclas
            }

            const fsModal = document.getElementById("fullscreen-faces-disambiguation");
            const diagModal = document.getElementById("face-disambiguation-modal");
            const isFsOpen = fsModal && fsModal.style.display !== "none";
            const isDiagOpen = diagModal && diagModal.style.display !== "none";

            if (!isFsOpen && !isDiagOpen) return;

            // Ignore if typing in an input/textarea
            if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") return;

            // Card alvo: o que está sob o mouse ou selecionado
            const targetCard = this.hoveredCard || document.querySelector(".fullscreen-face-card:hover, .disambiguation-item:hover, .fullscreen-face-card.selected, .disambiguation-item.selected");

            // Atalho 'a' / 'A': abre o Inspetor de Rosto no card alvo
            if (e.key === "a" || e.key === "A") {
                if (targetCard) {
                    e.preventDefault();
                    this.openInspector(targetCard);
                    return;
                }
            }

            const selected = document.querySelectorAll(".fullscreen-face-card.selected");
            if (selected.length > 0 && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== "a" && e.key !== "A") {
                const bulkInput = document.getElementById("bulk-face-input");
                if (bulkInput) {
                    bulkInput.focus();
                    bulkInput.value = e.key;
                    e.preventDefault(); // prevent double insertion of key
                    bulkInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });



        const btnFullscreen = document.getElementById("btn-fullscreen-faces");
        if (btnFullscreen) {
            btnFullscreen.addEventListener("click", () => this.openFullscreenDisambiguation());
        }

        const btnCloseFullscreen = document.getElementById("btn-close-fullscreen-faces");
        if (btnCloseFullscreen) {
            btnCloseFullscreen.addEventListener("click", () => this.closeFullscreenDisambiguation());
        }

        // Close disambiguation modal event
        const btnCloseDisambiguation = document.getElementById("btn-close-disambiguation");
        if (btnCloseDisambiguation) {
            btnCloseDisambiguation.addEventListener("click", () => this.closeDisambiguationModal());
        }

        // --- Group Manager Modal Bindings ---
        const btnCloseGroupManager = document.getElementById("btn-close-group-manager");
        if (btnCloseGroupManager) {
            btnCloseGroupManager.addEventListener("click", () => this.closeGroupManagerModal());
        }

        const btnGroupDissolveAll = document.getElementById("btn-group-dissolve-all");
        if (btnGroupDissolveAll) {
            btnGroupDissolveAll.addEventListener("click", () => this.dissolveGroup(this.activeGroupCluster));
        }

        const btnGroupBulkDissociate = document.getElementById("btn-group-bulk-dissociate");
        if (btnGroupBulkDissociate) {
            btnGroupBulkDissociate.addEventListener("click", () => this.dissociateSelectedFaces(this.activeGroupCluster));
        }

        const btnGroupBulkReassign = document.getElementById("btn-group-bulk-reassign");
        if (btnGroupBulkReassign) {
            btnGroupBulkReassign.addEventListener("click", () => this.reassignSelectedFaces(this.activeGroupCluster));
        }

        const btnGroupBulkReject = document.getElementById("btn-group-bulk-reject");
        if (btnGroupBulkReject) {
            btnGroupBulkReject.addEventListener("click", () => this.rejectSelectedFaces(this.activeGroupCluster));
        }

        // --- Reassign Modal Bindings ---
        const btnCloseReassign = document.getElementById("btn-close-reassign");
        if (btnCloseReassign) {
            btnCloseReassign.addEventListener("click", () => this.closeReassignModal());
        }
        const btnReassignCancel = document.getElementById("btn-reassign-cancel");
        if (btnReassignCancel) {
            btnReassignCancel.addEventListener("click", () => this.closeReassignModal());
        }
        const selectReassign = document.getElementById("reassign-name-select");
        const inputReassign = document.getElementById("reassign-name-input");
        if (selectReassign && inputReassign) {
            selectReassign.addEventListener("change", () => {
                if (selectReassign.value) {
                    inputReassign.value = selectReassign.value;
                }
            });
        }
        const btnReassignConfirm = document.getElementById("btn-reassign-confirm");
        if (btnReassignConfirm) {
            btnReassignConfirm.addEventListener("click", () => this.confirmReassignFaces());
        }

        // --- Names Manager Bindings ---
        const btnManageNames = document.getElementById("btn-manage-names");
        if (btnManageNames) {
            btnManageNames.addEventListener("click", () => this.openNamesManagerModal());
        }

        const btnCloseNamesManager = document.getElementById("btn-close-names-manager");
        if (btnCloseNamesManager) {
            btnCloseNamesManager.addEventListener("click", () => this.closeNamesManagerModal());
        }

        const searchNamesManager = document.getElementById("names-manager-search");
        if (searchNamesManager) {
            searchNamesManager.addEventListener("input", () => this.loadNamesManagerList());
        }

        const chkSelectAll = document.getElementById("chk-names-select-all");
        if (chkSelectAll) {
            chkSelectAll.addEventListener("change", () => {
                const checkboxes = document.querySelectorAll(".name-select-checkbox");
                checkboxes.forEach(cb => cb.checked = chkSelectAll.checked);
                this.updateNamesBulkActionsBar();
            });
        }

        const btnBulkDelete = document.getElementById("btn-names-bulk-delete");
        if (btnBulkDelete) {
            btnBulkDelete.addEventListener("click", () => this.handleNamesBulkDelete());
        }

        const btnBulkMerge = document.getElementById("btn-names-bulk-merge");
        if (btnBulkMerge) {
            btnBulkMerge.addEventListener("click", () => this.handleNamesBulkMerge());
        }

        // Listen for project change to load face clusters
        STATE.on("projectChanged", () => {
            this.loadFaceClusters();
            this.closeFullscreenDisambiguation();
            this.closeGroupManagerModal();
        });
        
        // Initial load
        this.loadFaceClusters();
    }


    static async triggerClustering() {
        const btnCluster = document.getElementById("btn-cluster-faces");
        if (!btnCluster) return;

        const epsInput = document.getElementById("input-clustering-eps");
        const minSamplesInput = document.getElementById("input-clustering-min-samples");

        const eps = epsInput ? parseFloat(epsInput.value) : 0.38;
        const minSamples = minSamplesInput ? parseInt(minSamplesInput.value) : 3;

        const originalText = btnCluster.innerHTML;
        btnCluster.disabled = true;
        btnCluster.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span class="btn-text">Agrupando...</span>';

        try {
            const res = await CapIAuAPI.clusterFaces(STATE.currentProjectId, eps, minSamples);
            console.log("[FaceManager] Clustering result:", res);
            alert(`Clustering concluído com sucesso!\nFaces total: ${res.total_faces}\nAgrupadas: ${res.clustered_faces}\nNovos grupos: ${res.clusters_created}\nRuídos: ${res.noise_faces}`);
            await this.loadFaceClusters();
        } catch (e) {
            console.error("[FaceManager] Error clustering faces:", e);
            alert("Erro ao executar o clustering de rostos.");
        } finally {
            btnCluster.disabled = false;
            btnCluster.innerHTML = originalText;
        }
    }

    static async triggerManualEnrichment() {
        const btnSync = document.getElementById("btn-sync-enrich");
        if (!btnSync) return;

        const projectId = STATE.currentProjectId;
        if (!projectId) {
            alert("Selecione um projeto ativo primeiro.");
            return;
        }

        const originalText = btnSync.innerHTML;
        btnSync.disabled = true;
        btnSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';

        try {
            const res = await CapIAuAPI.enrichProject(projectId);
            console.log("[FaceManager] Manual enrichment triggered:", res);
            alert("Sincronização iniciada com sucesso! Você pode acompanhar o progresso das descrições na aba 'Tarefas'.");
        } catch (e) {
            console.error("[FaceManager] Error triggering manual enrichment:", e);
            alert("Erro ao disparar a sincronização.");
        } finally {
            btnSync.disabled = false;
            btnSync.innerHTML = originalText;
        }
    }

    static async loadFaceClusters() {
        const container = document.getElementById("face-clusters-list");
        if (!container) return;

        container.innerHTML = '<div class="empty-state-text"><i class="fa-solid fa-spinner fa-spin"></i> Carregando grupos de rostos...</div>';

        try {
            const projectId = STATE.currentProjectId;
            if (!projectId) {
                container.innerHTML = '<div class="empty-state-text">Selecione um projeto ativo.</div>';
                return;
            }

            const [clusters, speakers] = await Promise.all([
                CapIAuAPI.fetchFaceClusters(projectId),
                CapIAuAPI.fetchProjectSpeakers(projectId).catch(() => [])
            ]);

            this.allClusters = clusters;
            this.allSpeakers = speakers;

            // Update global datalist for speakers autocompletion
            this.updateSpeakersDatalist(speakers);

            this.renderFaceClusters();
        } catch (e) {
            console.error("[FaceManager] Error loading face clusters:", e);
            container.innerHTML = '<div class="empty-state-text">Erro ao carregar os grupos de rostos.</div>';
        }
    }

    static renderFaceClusters() {
        const container = document.getElementById("face-clusters-list");
        if (!container) return;

        const clusters = this.allClusters || [];
        container.innerHTML = "";
        
        if (clusters.length === 0) {
            container.innerHTML = '<div class="empty-state-text">Nenhum rosto agrupado ainda. Clique em "Agrupar Rostos" acima.</div>';
            return;
        }

        const searchInput = document.getElementById("library-search-input");
        const query = searchInput ? searchInput.value.trim() : "";
        
        let filtered = clusters;
        if (query) {
            const ast = parseQuery(query);
            if (ast) {
                filtered = clusters.filter(cluster => evaluateAST(ast, cluster, "tab-faces"));
            }
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state-text">Nenhum grupo de rosto encontrado.</div>';
            return;
        }

        filtered.forEach(cluster => {
            const card = document.createElement("div");
            card.className = "face-cluster-card";
            card.dataset.clusterId = cluster.cluster_id;

            const thumbUrl = `/api/faces/face/${cluster.rep_face_id}/thumbnail`;
            const occurrencesText = cluster.occurrences === 1 ? "1 aparição" : `${cluster.occurrences} aparições`;

            // If name is the placeholder (e.g. Pessoa Desconhecida...), show empty input value or placeholder
            const isPlaceholder = cluster.name && cluster.name.startsWith("Pessoa Desconhecida");
            const inputValue = isPlaceholder ? "" : (cluster.name || "");
            const inputPlaceholder = isPlaceholder ? cluster.name : "Quem é esta pessoa?";

            card.innerHTML = `
                <img class="face-cluster-thumb" src="${thumbUrl}" alt="Crop do rosto" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect width=%2248%22 height=%2248%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 font-size=%2216%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22>?</text></svg>'">
                <div class="face-cluster-info">
                    <div class="face-cluster-meta">
                        <span class="face-cluster-id">Grupo ${cluster.cluster_id + 1}</span>
                        <span class="face-cluster-count">${occurrencesText}</span>
                    </div>
                    <input class="face-cluster-input" type="text" list="speakers-datalist" value="${inputValue}" placeholder="${inputPlaceholder}">
                </div>
            `;

            const inputEl = card.querySelector(".face-cluster-input");
            
            // Handle naming change
            let isChanging = false;
            const saveName = async () => {
                if (isChanging) return;
                const newName = inputEl.value.trim();
                const oldName = cluster.name;
                
                // Don't save if empty or same
                if (newName === (isPlaceholder ? "" : oldName)) return;

                isChanging = true;
                try {
                    const res = await CapIAuAPI.labelFace(cluster.rep_face_id, newName);
                    if (res && res.status === "conflict") {
                        // Revert input value before modal
                        inputEl.value = isPlaceholder ? "" : oldName;
                        
                        // Open Conflict / Disambiguation Modal
                        this.openDisambiguationModal({
                            faceId: cluster.rep_face_id,
                            currentClusterId: res.current_cluster_id,
                            existingClusterId: res.existing_cluster_id,
                            targetName: res.target_name
                        });
                    } else {
                        // Success, reload
                        await this.loadFaceClusters();
                    }
                } catch (e) {
                    console.error("[FaceManager] Error labeling face:", e);
                    alert("Erro ao salvar o nome.");
                } finally {
                    isChanging = false;
                }
            };

            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    inputEl.blur();
                }
            });
            inputEl.addEventListener("blur", saveName);

            // Click card (outside input) to manage/edit group
            card.addEventListener("click", (e) => {
                if (e.target.closest(".face-cluster-input")) return;
                this.openGroupManagerModal(cluster);
            });

            container.appendChild(card);
        });
    }

    static updateSpeakersDatalist(speakers) {
        let datalist = document.getElementById("speakers-datalist");
        if (!datalist) {
            datalist = document.createElement("datalist");
            datalist.id = "speakers-datalist";
            document.body.appendChild(datalist);
        }
        datalist.innerHTML = "";
        
        // Remove duplicates and placeholders
        const cleanSpeakers = Array.from(new Set(speakers))
            .filter(s => s && !s.startsWith("Pessoa Desconhecida") && !s.startsWith("SPEAKER_"));

        cleanSpeakers.forEach(speaker => {
            const option = document.createElement("option");
            option.value = speaker;
            datalist.appendChild(option);
        });
    }

    // Modal de Desambiguação
    static async openDisambiguationModal({ faceId, currentClusterId, existingClusterId, targetName }) {
        const modal = document.getElementById("face-disambiguation-modal");
        const grid = document.getElementById("disambiguation-faces-grid");
        const infoText = document.getElementById("disambiguation-info-text");
        
        if (!modal || !grid || !infoText) return;

        infoText.textContent = `O nome "${targetName}" já está associado a outro grupo de rostos (Grupo ${existingClusterId + 1}). Escolha os rostos do Grupo ${currentClusterId + 1} abaixo que pertencem a "${targetName}" para fazer a reassociação, ou clique em "Fusão Total" para unir os grupos por completo.`;
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Carregando rostos...</div>';
        
        modal.style.display = "flex";

        try {
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, currentClusterId);
            grid.innerHTML = "";

            if (!faces || faces.length === 0) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">Nenhum rosto encontrado no cluster.</div>';
                return;
            }

            faces.forEach(face => {
                const item = document.createElement("div");
                item.className = "disambiguation-item selected"; // selected by default
                item.dataset.faceId = face.id;

                const thumbUrl = `/api/faces/face/${face.id}/thumbnail`;
                
                // Meta description context (video filename or photo name + timestamp)
                let metaText = "";
                if (face.photo_id !== null) {
                    metaText = `Foto ID ${face.photo_id}`;
                } else if (face.video_id !== null) {
                    metaText = `Frame ${face.timestamp}s`;
                }

                item.innerHTML = `
                    <img src="${thumbUrl}" alt="Face Crop" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2290%22 height=%2290%22><rect width=%2290%22 height=%2290%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 font-size=%2224%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22>?</text></svg>'">
                    <div class="disambiguation-checkbox"><i class="fa-solid fa-check"></i></div>
                    <div class="disambiguation-item-meta">${metaText}</div>
                `;

                item.addEventListener("click", () => {
                    item.classList.toggle("selected");
                });

                item.addEventListener("mouseenter", () => { FaceManager.hoveredCard = item; });
                item.addEventListener("mouseleave", () => { if (FaceManager.hoveredCard === item) FaceManager.hoveredCard = null; });

                grid.appendChild(item);
            });


            // Bind action buttons
            const btnFuseAll = document.getElementById("btn-disambiguation-fuse-all");
            const btnApproveSelected = document.getElementById("btn-disambiguation-approve");

            // Remove existing listeners by replacing buttons
            const newBtnFuseAll = btnFuseAll.cloneNode(true);
            const newBtnApproveSelected = btnApproveSelected.cloneNode(true);

            btnFuseAll.parentNode.replaceChild(newBtnFuseAll, btnFuseAll);
            btnApproveSelected.parentNode.replaceChild(newBtnApproveSelected, btnApproveSelected);

            newBtnFuseAll.addEventListener("click", async () => {
                if (confirm(`Deseja realmente fundir TODOS os rostos do Grupo ${currentClusterId + 1} com o Grupo ${existingClusterId + 1} sob o nome "${targetName}"?`)) {
                    try {
                        await CapIAuAPI.mergeClusters(STATE.currentProjectId, currentClusterId, existingClusterId, targetName);
                        this.closeDisambiguationModal();
                        await this.loadFaceClusters();
                    } catch (e) {
                        console.error("[FaceManager] Error merging clusters:", e);
                        alert("Erro ao realizar fusão dos clusters.");
                    }
                }
            });

            newBtnApproveSelected.addEventListener("click", async () => {
                const selectedItems = grid.querySelectorAll(".disambiguation-item.selected");
                const faceIds = Array.from(selectedItems).map(item => parseInt(item.dataset.faceId));

                if (faceIds.length === 0) {
                    alert("Selecione pelo menos um rosto para reassociar, ou feche a tela.");
                    return;
                }

                try {
                    await CapIAuAPI.reassignFaces(STATE.currentProjectId, faceIds, existingClusterId, targetName);
                    this.closeDisambiguationModal();
                    await this.loadFaceClusters();
                } catch (e) {
                    console.error("[FaceManager] Error reassigning faces:", e);
                    alert("Erro ao reatribuir rostos selecionados.");
                }
            });

        } catch (e) {
            console.error("[FaceManager] Error loading cluster faces for disambiguation:", e);
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--color-red);">Erro ao carregar faces do grupo.</div>';
        }
    }

    static closeDisambiguationModal() {
        const modal = document.getElementById("face-disambiguation-modal");
        if (modal) modal.style.display = "none";
    }

    // Intercept responses from external files (like library.js)
    static async handleLabelResponse(res, faceId, successCallback) {
        if (res && res.status === "conflict") {
            this.openDisambiguationModal({
                faceId: faceId,
                currentClusterId: res.current_cluster_id,
                existingClusterId: res.existing_cluster_id,
                targetName: res.target_name
            });
            // We register a temporary event or callback when modal is closed/resolved
            const checkClose = setInterval(() => {
                const modal = document.getElementById("face-disambiguation-modal");
                if (modal && modal.style.display === "none") {
                    clearInterval(checkClose);
                    if (successCallback) successCallback();
                }
            }, 500);
        } else {
            if (successCallback) successCallback();
        }
    }

    static async openFullscreenDisambiguation() {
        const modal = document.getElementById("fullscreen-faces-disambiguation");
        const grid = document.getElementById("fullscreen-faces-grid");
        if (!modal || !grid) return;
        
        modal.style.display = "flex";
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Carregando rostos do projeto...</p></div>';
        
        // Oculta a barra de ações em massa inicialmente
        const bulkBar = document.getElementById("fullscreen-bulk-actions-bar");
        if (bulkBar) bulkBar.style.display = "none";
        
        if (!this.bulkEventsBound) {
            this.bulkEventsBound = true;
            const btnBulkApply = document.getElementById("btn-bulk-apply");
            if (btnBulkApply) {
                btnBulkApply.addEventListener("click", () => this.applyBulkLabel());
            }
            const btnBulkReject = document.getElementById("btn-bulk-reject");
            if (btnBulkReject) {
                btnBulkReject.addEventListener("click", () => this.applyBulkReject());
            }
            // Suporte para Enter no campo bulk
            const bulkInput = document.getElementById("bulk-face-input");
            if (bulkInput) {
                bulkInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        this.applyBulkLabel();
                    }
                });
            }
        }
        
        try {
            const projectId = STATE.currentProjectId;
            const faces = await CapIAuAPI.fetchUnlabeledFaces(projectId);
            this.renderFullscreenFaces(faces);
        } catch (e) {
            console.error("[FaceManager] Error fetching unlabeled faces:", e);
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-red);"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top:10px;">Erro ao carregar os rostos para desambiguação.</p></div>';
        }
    }

    static renderFullscreenFaces(faces) {
        const grid = document.getElementById("fullscreen-faces-grid");
        if (!grid) return;

        // Remove old load-more container if present
        const oldLoadMore = document.getElementById("fullscreen-load-more-container");
        if (oldLoadMore) oldLoadMore.remove();

        this.unlabeledFaces = faces || [];
        this.currentPage = 0;
        this.pageSize = 60;
        this.lastClickedFaceId = null; // Track for Shift+Click selection

        grid.innerHTML = "";
        this.renderNextPage();
    }

    static renderNextPage() {
        const grid = document.getElementById("fullscreen-faces-grid");
        if (!grid) return;

        // Remove old load-more button if it exists
        const oldLoadMore = document.getElementById("fullscreen-load-more-container");
        if (oldLoadMore) oldLoadMore.remove();

        const startIdx = this.currentPage * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const pageFaces = this.unlabeledFaces.slice(startIdx, endIdx);

        if (pageFaces.length === 0 && this.currentPage === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted);">
                    <i class="fa-solid fa-circle-check fa-4x" style="color: var(--color-emerald); margin-bottom: 20px;"></i>
                    <h3 style="font-size: 18px; color: var(--text-primary); margin: 0 0 8px 0;">Tudo limpo!</h3>
                    <p style="margin: 0; font-size: 13px;">Todos os rostos detectados no projeto já foram identificados.</p>
                </div>
            `;
            return;
        }

        pageFaces.forEach(face => {
            const card = document.createElement("div");
            card.className = "fullscreen-face-card";
            card.dataset.faceId = face.id;
            card.dataset.clusterId = face.cluster_id;

            const thumbUrl = `/api/faces/face/${face.id}/thumbnail`;
            
            let metaText = "Desconhecido";
            if (face.photo_id !== null) {
                metaText = `Foto ID ${face.photo_id}`;
            } else if (face.video_id !== null) {
                metaText = `Depoimento/B-Roll | Frame ${face.timestamp}s`;
            }

            const isPlaceholder = face.name && face.name.startsWith("Pessoa Desconhecida");
            const inputValue = isPlaceholder ? "" : (face.name || "");
            const inputPlaceholder = isPlaceholder ? face.name : "Quem é esta pessoa?";

            card.innerHTML = `
                <div class="fullscreen-face-select-badge">
                    <i class="fa-solid fa-check" style="color: #000; font-size: 10px; display: none;"></i>
                </div>
                <div class="fullscreen-face-thumb-container">
                    <img class="fullscreen-face-thumb" src="${thumbUrl}" alt="Rosto" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><rect width=%22120%22 height=%22120%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 font-size=%2224%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22>?</text></svg>'">
                </div>
                <div class="fullscreen-face-meta" title="${metaText}">${metaText}</div>
                <div class="fullscreen-face-input-wrapper" style="display:flex; gap:6px; margin-top:5px; width:100%;">
                    <input class="fullscreen-face-input" type="text" list="speakers-datalist" value="${inputValue}" placeholder="${inputPlaceholder}" style="flex:1;">
                    <button class="btn-reject-face" title="Não relevante / Não é rosto" style="background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.4); color:#ef4444; border-radius:6px; width:34px; height:32px; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s;">
                        <i class="fa-solid fa-ban"></i>
                    </button>
                </div>
            `;

            card.addEventListener("mouseenter", () => { FaceManager.hoveredCard = card; });
            card.addEventListener("mouseleave", () => { if (FaceManager.hoveredCard === card) FaceManager.hoveredCard = null; });

            const inputEl = card.querySelector(".fullscreen-face-input");

            const btnReject = card.querySelector(".btn-reject-face");
            
            let isChanging = false;

            btnReject.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (isChanging) return;
                
                const objectName = prompt("Esta detecção não é um rosto. Se for um objeto relevante (ex: Abajur, Cadeira, Microfone), digite o nome do objeto. Caso contrário, deixe em branco para marcar apenas como Não Relevante:\n(Clique em Cancelar para desistir)");
                if (objectName === null) return;
                
                isChanging = true;
                try {
                    const res = await CapIAuAPI.rejectFace(face.id, objectName.trim());
                    if (res && res.status === "success") {
                        card.classList.add("fade-out");
                        setTimeout(() => {
                            card.remove();
                            if (grid.querySelectorAll(".fullscreen-face-card").length === 0) {
                                if (this.currentPage * this.pageSize < this.unlabeledFaces.length) {
                                    this.renderNextPage();
                                } else {
                                    this.renderFullscreenFaces([]);
                                }
                            }
                        }, 300);
                        this.loadFaceClusters();
                        if (STATE.activeVideo) {
                            STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
                        }
                    }
                } catch (err) {
                    console.error("Erro ao rejeitar rosto:", err);
                    alert("Erro ao descartar detecção.");
                } finally {
                    isChanging = false;
                }
            });

            const saveName = async () => {
                if (isChanging) return;
                const newName = inputEl.value.trim();
                const oldName = face.name;

                if (newName === (isPlaceholder ? "" : oldName)) return;

                isChanging = true;
                try {
                    const res = await CapIAuAPI.labelFace(face.id, newName);
                    if (res && res.status === "conflict") {
                        inputEl.value = isPlaceholder ? "" : oldName;
                        
                        this.openDisambiguationModal({
                            faceId: face.id,
                            currentClusterId: res.current_cluster_id,
                            existingClusterId: res.existing_cluster_id,
                            targetName: res.target_name
                        });
                        
                        // Listen for modal resolution to potentially remove card
                        const checkClose = setInterval(() => {
                            const modal = document.getElementById("face-disambiguation-modal");
                            if (modal && modal.style.display === "none") {
                                clearInterval(checkClose);
                                if (face.cluster_id !== null && face.cluster_id !== undefined && face.cluster_id >= 0) {
                                    FaceManager.removeCardsByClusterId(face.cluster_id);
                                } else {
                                    card.classList.add("fade-out");
                                    setTimeout(() => {
                                        card.remove();
                                        if (grid.querySelectorAll(".fullscreen-face-card").length === 0) {
                                            if (this.currentPage * this.pageSize < this.unlabeledFaces.length) {
                                                this.renderNextPage();
                                            } else {
                                                this.renderFullscreenFaces([]);
                                            }
                                        }
                                    }, 300);
                                }
                            }
                        }, 500);
                    } else {
                        // Success animation
                        if (face.cluster_id !== null && face.cluster_id !== undefined && face.cluster_id >= 0) {
                            FaceManager.removeCardsByClusterId(face.cluster_id);
                        } else {
                            card.classList.add("fade-out");
                            setTimeout(() => {
                                card.remove();
                                if (grid.querySelectorAll(".fullscreen-face-card").length === 0) {
                                    if (this.currentPage * this.pageSize < this.unlabeledFaces.length) {
                                        this.renderNextPage();
                                    } else {
                                        this.renderFullscreenFaces([]);
                                    }
                                }
                            }, 300);
                        }
                    }
                } catch (e) {
                    console.error("[FaceManager] Error labeling face in fullscreen:", e);
                    alert("Erro ao salvar o nome.");
                } finally {
                    isChanging = false;
                }
            };

            inputEl.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    inputEl.blur();
                }
            });
            inputEl.addEventListener("blur", saveName);

            // Toggle seleção ao clicar no card (fora do input e do botão de banir)
            card.addEventListener("click", (e) => {
                if (e.target.closest(".fullscreen-face-input-wrapper")) return;

                const cards = Array.from(grid.querySelectorAll(".fullscreen-face-card"));
                const currentIdx = cards.indexOf(card);
                
                if (e.shiftKey && this.lastClickedFaceId !== null) {
                    const lastCard = cards.find(c => c.dataset.faceId == this.lastClickedFaceId);
                    const lastIdx = cards.indexOf(lastCard);
                    if (lastIdx !== -1 && currentIdx !== -1) {
                        const start = Math.min(lastIdx, currentIdx);
                        const end = Math.max(lastIdx, currentIdx);
                        const targetState = !card.classList.contains("selected");
                        
                        for (let i = start; i <= end; i++) {
                            const c = cards[i];
                            c.classList.toggle("selected", targetState);
                            const badge = c.querySelector(".fullscreen-face-select-badge");
                            const icon = badge.querySelector("i");
                            if (targetState) {
                                badge.style.background = "var(--color-cyan)";
                                badge.style.borderColor = "var(--color-cyan)";
                                icon.style.display = "block";
                                c.style.outline = "2px solid var(--color-cyan)";
                            } else {
                                badge.style.background = "rgba(0,0,0,0.6)";
                                badge.style.borderColor = "rgba(255,255,255,0.3)";
                                icon.style.display = "none";
                                c.style.outline = "none";
                            }
                        }
                    }
                } else {
                    card.classList.toggle("selected");
                    const selectBadge = card.querySelector(".fullscreen-face-select-badge");
                    const checkIcon = selectBadge.querySelector("i");
                    if (card.classList.contains("selected")) {
                        selectBadge.style.background = "var(--color-cyan)";
                        selectBadge.style.borderColor = "var(--color-cyan)";
                        checkIcon.style.display = "block";
                        card.style.outline = "2px solid var(--color-cyan)";
                    } else {
                        selectBadge.style.background = "rgba(0,0,0,0.6)";
                        selectBadge.style.borderColor = "rgba(255,255,255,0.3)";
                        checkIcon.style.display = "none";
                        card.style.outline = "none";
                    }
                }

                this.lastClickedFaceId = face.id;
                this.updateBulkActionsBar();
            });

            // Hover para exibir contexto (imagem cheia ou clip de vídeo)
            let hoverTimeout;
            card.addEventListener("mouseenter", () => {
                const selectEl = document.getElementById("select-hover-delay");
                const hoverDelay = selectEl ? parseInt(selectEl.value) : 2000;
                
                if (hoverDelay >= 999999) return; // Desativado
                // Não mostrar popover de hover enquanto o Inspetor ('a') estiver aberto
                if (FaceManager.inspectorCard) return;

                hoverTimeout = setTimeout(() => {
                    if (FaceManager.inspectorCard) return;
                    FaceManager.showContextPreview(face, card);
                }, hoverDelay);
            });
            card.addEventListener("mouseleave", () => {
                clearTimeout(hoverTimeout);
                FaceManager.hideContextPreview();
            });

            grid.appendChild(card);
        });

        this.currentPage++;

        // Add the "Load More" button if there are more faces
        if (endIdx < this.unlabeledFaces.length) {
            const container = document.createElement("div");
            container.id = "fullscreen-load-more-container";
            container.style.cssText = "grid-column: 1/-1; display: flex; justify-content: center; padding: 20px 0; margin-top: 10px;";
            
            const btn = document.createElement("button");
            btn.className = "btn-secondary";
            btn.style.cssText = "padding: 10px 24px; font-size: 13px; font-weight: 600; cursor: pointer; border-color: rgba(6, 182, 212, 0.3); color: var(--color-cyan);";
            btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Carregar Mais Rostos (${this.unlabeledFaces.length - endIdx} restantes)`;
            
            btn.addEventListener("click", () => this.renderNextPage());
            container.appendChild(btn);
            
            grid.appendChild(container);
        }
    }

    static removeCardsByClusterId(clusterId) {
        if (clusterId === null || clusterId === undefined || clusterId === "" || clusterId < 0) return;
        const grid = document.getElementById("fullscreen-faces-grid");
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll(".fullscreen-face-card"));
        const cardsToRemove = cards.filter(c => c.dataset.clusterId == clusterId);
        
        if (cardsToRemove.length === 0) return;
        
        cardsToRemove.forEach(c => c.classList.add("fade-out"));
        setTimeout(() => {
            cardsToRemove.forEach(c => c.remove());
            if (grid.querySelectorAll(".fullscreen-face-card").length === 0) {
                if (FaceManager.currentPage * FaceManager.pageSize < FaceManager.unlabeledFaces.length) {
                    FaceManager.renderNextPage();
                } else {
                    FaceManager.renderFullscreenFaces([]);
                }
            }
        }, 300);
    }

    static updateBulkActionsBar() {
        const selectedCards = document.querySelectorAll(".fullscreen-face-card.selected");
        const count = selectedCards.length;
        const bar = document.getElementById("fullscreen-bulk-actions-bar");
        const countEl = document.getElementById("bulk-select-count");
        
        if (!bar || !countEl) return;

        if (count > 0) {
            bar.style.display = "flex";
            countEl.textContent = `${count} ${count === 1 ? 'item selecionado' : 'itens selecionados'}`;
        } else {
            bar.style.display = "none";
        }
    }

    static async applyBulkLabel() {
        const newName = document.getElementById("bulk-face-input").value.trim();
        if (!newName) {
            alert("Por favor, digite o nome da pessoa/objeto.");
            return;
        }

        const selectedCards = Array.from(document.querySelectorAll(".fullscreen-face-card.selected"));
        if (selectedCards.length === 0) return;

        const btnApply = document.getElementById("btn-bulk-apply");
        btnApply.disabled = true;
        btnApply.textContent = "Aplicando...";

        const projectId = STATE.currentProjectId;
        let successCount = 0;
        let errorCount = 0;

        const processedClusters = new Set();
        for (const card of selectedCards) {
            const faceId = parseInt(card.dataset.faceId);
            const clusterId = parseInt(card.dataset.clusterId);
            try {
                const res = await CapIAuAPI.labelFace(faceId, newName);
                if (res && res.status === "conflict") {
                    // Se houver conflito, faz a mesclagem automática do cluster de origem com o destino
                    const srcCluster = res.current_cluster_id;
                    const destCluster = res.existing_cluster_id;
                    if (srcCluster !== null && destCluster !== null && srcCluster !== destCluster) {
                        await CapIAuAPI.mergeClusters(projectId, srcCluster, destCluster, newName);
                    }
                    if (srcCluster !== null && srcCluster !== undefined && srcCluster >= 0) {
                        processedClusters.add(srcCluster);
                    }
                } else {
                    if (clusterId !== null && clusterId !== undefined && clusterId >= 0) {
                        processedClusters.add(clusterId);
                    }
                }
                successCount++;
                card.classList.add("fade-out");
                setTimeout(() => card.remove(), 300);
            } catch (err) {
                console.error("Erro ao aplicar nome no rosto:", faceId, err);
                errorCount++;
            }
        }

        // Remove any other cards on the screen that belong to the processed clusters
        for (const cid of processedClusters) {
            FaceManager.removeCardsByClusterId(cid);
        }

        btnApply.disabled = false;
        btnApply.textContent = "Aplicar";
        document.getElementById("bulk-face-input").value = "";

        // Oculta a barra de ações em massa
        document.getElementById("fullscreen-bulk-actions-bar").style.display = "none";

        // Se sobrar nenhum card, exibe o empty state
        setTimeout(() => {
            const grid = document.getElementById("fullscreen-faces-grid");
            if (grid && grid.children.length === 0) {
                this.renderFullscreenFaces([]);
            }
        }, 350);

        // Recarregar os clusters no fundo para manter em sincronia
        this.loadFaceClusters();
        
        // Dispara evento global para que o player e visão também atualizem se estiverem exibindo este vídeo
        if (STATE.activeVideo) {
            STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
        }
    }

    static async applyBulkReject() {
        const selectedCards = Array.from(document.querySelectorAll(".fullscreen-face-card.selected"));
        if (selectedCards.length === 0) return;

        const objectName = prompt(`As ${selectedCards.length} detecções selecionadas não são rostos. Se forem o mesmo objeto relevante (ex: Abajur, Cadeira, Microfone), digite o nome do objeto. Caso contrário, deixe em branco para marcar todas como Não Relevante:\n(Clique em Cancelar para desistir)`);
        if (objectName === null) return;

        const btnReject = document.getElementById("btn-bulk-reject");
        btnReject.disabled = true;
        btnReject.textContent = "Descartando...";

        let successCount = 0;
        let errorCount = 0;

        for (const card of selectedCards) {
            const faceId = parseInt(card.dataset.faceId);
            try {
                const res = await CapIAuAPI.rejectFace(faceId, objectName.trim());
                if (res && res.status === "success") {
                    successCount++;
                    card.classList.add("fade-out");
                    setTimeout(() => card.remove(), 300);
                }
            } catch (err) {
                console.error("Erro ao rejeitar rosto em lote:", faceId, err);
                errorCount++;
            }
        }

        btnReject.disabled = false;
        btnReject.textContent = "Descartar";

        // Oculta a barra de ações em massa
        document.getElementById("fullscreen-bulk-actions-bar").style.display = "none";

        // Se sobrar nenhum card, exibe o empty state
        setTimeout(() => {
            const grid = document.getElementById("fullscreen-faces-grid");
            if (grid && grid.children.length === 0) {
                this.renderFullscreenFaces([]);
            }
        }, 350);

        this.loadFaceClusters();
        
        if (STATE.activeVideo) {
            STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
        }
    }

    static showContextPreview(face, card) {
        let popover = document.getElementById("fullscreen-face-context-popover");
        if (!popover) {
            popover = document.createElement("div");
            popover.id = "fullscreen-face-context-popover";
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
            popover.style.pointerEvents = "none"; // Evita interferir no mouseleave
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

        popover.innerHTML = `
            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; font-weight:600; display:flex; align-items:center; gap:5px;">
                <i class="fa-solid fa-eye" style="color:var(--color-cyan);"></i> Visualização do Contexto
            </div>
            <div id="popover-media-container" style="width:100%; height:180px; border-radius:6px; overflow:hidden; background:#000; position:relative; display:flex; align-items:center; justify-content:center;">
                <div class="loading-state-text" style="font-size:11px;">Carregando mídia...</div>
            </div>
            <div style="font-size:10px; color:var(--text-muted); text-align:center; font-style:italic;">
                ${face.photo_id ? 'Foto original completa' : `Vídeo no frame ${face.timestamp}s`}
            </div>
        `;

        const mediaContainer = popover.querySelector("#popover-media-container");

        if (face.photo_id) {
            let src = face.photo_proxy_path || face.photo_filepath;
            if (!src || (!src.startsWith("http") && !src.startsWith("/"))) {
                src = `/originals/${face.photo_filename}`;
            }
            mediaContainer.innerHTML = `
                <img src="${src}" style="width:100%; height:100%; object-fit:contain;">
            `;
        } else if (face.video_id) {
            let src = face.video_filepath;
            if (face.video_proxy_path) {
                src = face.video_proxy_path;
            } else {
                const isRemote = src && (src.startsWith("http") || src.startsWith("/proxies/") || src.startsWith("/"));
                if (!isRemote) {
                    src = `/originals/${face.video_filename}`;
                }
            }
            
            const videoEl = document.createElement("video");
            videoEl.src = src;
            videoEl.style.width = "100%";
            videoEl.style.height = "100%";
            videoEl.style.objectFit = "contain";
            videoEl.muted = true;
            videoEl.playsInline = true;
            
            const ts = parseFloat(face.timestamp) || 0.0;
            const startTime = Math.max(0.0, ts - 2.0);
            
            videoEl.addEventListener("loadedmetadata", () => {
                videoEl.currentTime = startTime;
                videoEl.play().catch(e => console.warn("Erro ao reproduzir preview:", e));
            });

            videoEl.addEventListener("timeupdate", () => {
                if (videoEl.currentTime >= ts + 3.0) {
                    videoEl.currentTime = startTime;
                }
            });

            mediaContainer.innerHTML = "";
            mediaContainer.appendChild(videoEl);
        }
    }

    static hideContextPreview() {
        const popover = document.getElementById("fullscreen-face-context-popover");
        if (popover) {
            popover.style.display = "none";
            popover.innerHTML = "";
        }
    }

    static closeFullscreenDisambiguation() {
        const modal = document.getElementById("fullscreen-faces-disambiguation");
        if (modal) modal.style.display = "none";
        this.loadFaceClusters();
    }

    // --- GERENCIADOR DE GRUPO DE ROSTOS ---
    static async openGroupManagerModal(cluster) {
        const modal = document.getElementById("face-group-manager-modal");
        const grid = document.getElementById("group-manager-faces-grid");
        const title = document.getElementById("group-manager-title");
        const countVal = document.getElementById("group-manager-count-val");
        const bulkBar = document.getElementById("group-manager-bulk-bar");
        
        if (!modal || !grid) return;
        
        modal.style.display = "flex";
        if (bulkBar) bulkBar.style.display = "none";
        
        this.lastClickedGroupFaceId = null; // Reset for Shift+Click selection
        
        const clusterNameDisplay = (cluster.name && !cluster.name.startsWith("Pessoa Desconhecida")) ? cluster.name : `Grupo ${cluster.cluster_id + 1}`;
        if (title) title.textContent = `Gerenciar Rostos: ${clusterNameDisplay}`;
        if (countVal) countVal.textContent = cluster.occurrences;
        
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Carregando rostos do grupo...</p></div>';
        
        this.activeGroupCluster = cluster;
        
        try {
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, cluster.cluster_id, cluster.name || "");
            this.renderGroupManagerFaces(faces, cluster);
        } catch (e) {
            console.error("Erro ao carregar faces do grupo:", e);
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--color-red);">Erro ao carregar faces do grupo.</div>';
        }
    }

    static closeGroupManagerModal() {
        const modal = document.getElementById("face-group-manager-modal");
        if (modal) modal.style.display = "none";
        this.activeGroupCluster = null;
        this.closeReassignModal();
    }

    static renderGroupManagerFaces(faces, cluster) {
        const grid = document.getElementById("group-manager-faces-grid");
        if (!grid) return;
        
        grid.innerHTML = "";
        
        if (!faces || faces.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Nenhum rosto neste grupo.</div>';
            return;
        }
        
        faces.forEach(face => {
            const card = document.createElement("div");
            card.className = "group-manager-face-card";
            card.dataset.faceId = face.id;
            
            const thumbUrl = `/api/faces/face/${face.id}/thumbnail`;
            
            let metaText = "Desconhecido";
            if (face.photo_id !== null) {
                metaText = `Foto ID ${face.photo_id}`;
            } else if (face.video_id !== null) {
                metaText = `Frame ${face.timestamp}s`;
            }
            
            card.innerHTML = `
                <div class="group-manager-face-select-badge">
                    <i class="fa-solid fa-check" style="display: none;"></i>
                </div>
                <div class="group-manager-face-thumb-container">
                    <img class="group-manager-face-thumb" src="${thumbUrl}" alt="Rosto" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22><rect width=%2280%22 height=%2280%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 font-size=%2216%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22>?</text></svg>'">
                </div>
                <div class="group-manager-face-meta" title="${metaText}">${metaText}</div>
            `;
            
            card.addEventListener("click", (e) => {
                const cards = Array.from(grid.querySelectorAll(".group-manager-face-card"));
                const currentIdx = cards.indexOf(card);
                
                if (e.shiftKey && this.lastClickedGroupFaceId !== null) {
                    const lastCard = cards.find(c => c.dataset.faceId == this.lastClickedGroupFaceId);
                    const lastIdx = cards.indexOf(lastCard);
                    if (lastIdx !== -1 && currentIdx !== -1) {
                        const start = Math.min(lastIdx, currentIdx);
                        const end = Math.max(lastIdx, currentIdx);
                        const targetState = !card.classList.contains("selected");
                        
                        for (let i = start; i <= end; i++) {
                            const c = cards[i];
                            c.classList.toggle("selected", targetState);
                            const badge = c.querySelector(".group-manager-face-select-badge");
                            const icon = badge.querySelector("i");
                            if (targetState) {
                                icon.style.display = "block";
                            } else {
                                icon.style.display = "none";
                            }
                        }
                    }
                } else {
                    card.classList.toggle("selected");
                    const badge = card.querySelector(".group-manager-face-select-badge");
                    const icon = badge.querySelector("i");
                    if (card.classList.contains("selected")) {
                        icon.style.display = "block";
                    } else {
                        icon.style.display = "none";
                    }
                }
                
                this.lastClickedGroupFaceId = face.id;
                this.updateGroupManagerBulkBar();
            });
            
            let hoverTimeout;
            card.addEventListener("mouseenter", () => {
                hoverTimeout = setTimeout(() => {
                    FaceManager.showContextPreview(face, card);
                }, 400);
            });
            card.addEventListener("mouseleave", () => {
                clearTimeout(hoverTimeout);
                FaceManager.hideContextPreview();
            });
            
            grid.appendChild(card);
        });
    }

    static updateGroupManagerBulkBar() {
        const selected = document.querySelectorAll(".group-manager-face-card.selected");
        const count = selected.length;
        const bar = document.getElementById("group-manager-bulk-bar");
        const countText = document.getElementById("group-manager-bulk-count");
        
        if (!bar) return;
        
        if (count > 0) {
            bar.style.display = "flex";
            if (countText) {
                countText.textContent = `${count} ${count === 1 ? 'item selecionado' : 'itens selecionados'}`;
            }
        } else {
            bar.style.display = "none";
            const panel = document.getElementById("group-manager-reassign-panel");
            if (panel) panel.style.display = "none";
        }
    }

    static async dissolveGroup(cluster) {
        if (!cluster) return;
        const msg = `Deseja realmente dissolver o grupo "${(cluster.name && !cluster.name.startsWith('Pessoa Desconhecida')) ? cluster.name : 'Grupo ' + (cluster.cluster_id + 1)}"? Todas as ${cluster.occurrences} aparições voltarão a ser consideradas "Pessoas Desconhecidas" na tela de desambiguação rápida.`;
        if (!confirm(msg)) return;
        
        try {
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, cluster.cluster_id, cluster.name || "");
            const faceIds = faces.map(f => f.id);
            
            if (faceIds.length === 0) {
                alert("Nenhum rosto encontrado neste grupo.");
                return;
            }
            
            await CapIAuAPI.dissociateFaces(STATE.currentProjectId, faceIds);
            this.closeGroupManagerModal();
            await this.loadFaceClusters();
            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
            alert("Grupo dissolvido com sucesso!");
        } catch (e) {
            console.error("Erro ao dissolver grupo:", e);
            alert("Erro ao dissolver o grupo de rostos.");
        }
    }

    static async dissociateSelectedFaces(cluster) {
        if (!cluster) return;
        const selected = document.querySelectorAll(".group-manager-face-card.selected");
        const faceIds = Array.from(selected).map(card => parseInt(card.dataset.faceId));
        if (faceIds.length === 0) return;
        
        if (!confirm(`Deseja desassociar as ${faceIds.length} faces selecionadas do nome atual? Elas voltarão para a desambiguação rápida.`)) return;
        
        try {
            await CapIAuAPI.dissociateFaces(STATE.currentProjectId, faceIds);
            
            // Recarregar os rostos no modal
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, cluster.cluster_id, cluster.name || "");
            this.renderGroupManagerFaces(faces, cluster);
            this.updateGroupManagerBulkBar();
            
            // Recarregar a barra lateral de grupos
            await this.loadFaceClusters();
            
            // Atualizar contagem no modal
            const countVal = document.getElementById("group-manager-count-val");
            if (countVal) countVal.textContent = faces.length;
            
            if (faces.length === 0) {
                this.closeGroupManagerModal();
            }
            
            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
            alert("Rostos desassociados com sucesso!");
        } catch (e) {
            console.error("Erro ao desassociar faces:", e);
            alert("Erro ao desassociar faces selecionadas.");
        }
    }

    static async reassignSelectedFaces(cluster) {
        if (!cluster) return;
        const selected = document.querySelectorAll(".group-manager-face-card.selected");
        const faceIds = Array.from(selected).map(card => parseInt(card.dataset.faceId));
        if (faceIds.length === 0) return;

        this.reassignCluster = cluster;
        this.reassignFaceIds = faceIds;

        const panel = document.getElementById("group-manager-reassign-panel");
        const selectEl = document.getElementById("reassign-name-select");
        const inputEl = document.getElementById("reassign-name-input");

        if (!panel) return;

        // Fetch existing speakers to populate the select dropdown
        try {
            const speakers = await CapIAuAPI.fetchProjectSpeakers(STATE.currentProjectId).catch(() => []);
            const cleanSpeakers = Array.from(new Set(speakers))
                .filter(s => s && !s.startsWith("Pessoa Desconhecida") && !s.startsWith("SPEAKER_"))
                .sort();

            selectEl.innerHTML = '<option value="" style="background: #111; color: var(--text-secondary);">Selecione existente...</option>';
            cleanSpeakers.forEach(sp => {
                const opt = document.createElement("option");
                opt.value = sp;
                opt.textContent = sp;
                opt.style.background = "#111";
                opt.style.color = "var(--text-primary)";
                selectEl.appendChild(opt);
            });
        } catch (e) {
            console.error("Erro ao carregar speakers para reatribuição:", e);
        }

        inputEl.value = "";
        panel.style.display = "flex";
    }

    static closeReassignModal() {
        const panel = document.getElementById("group-manager-reassign-panel");
        if (panel) panel.style.display = "none";
        const selectEl = document.getElementById("reassign-name-select");
        const inputEl = document.getElementById("reassign-name-input");
        if (selectEl) selectEl.value = "";
        if (inputEl) inputEl.value = "";
        this.reassignCluster = null;
        this.reassignFaceIds = null;
    }

    static async confirmReassignFaces() {
        const cluster = this.reassignCluster;
        const faceIds = this.reassignFaceIds;
        if (!cluster || !faceIds || faceIds.length === 0) return;

        const inputEl = document.getElementById("reassign-name-input");
        if (!inputEl) return;
        const newName = inputEl.value.trim();
        if (!newName) {
            alert("Nome inválido.");
            return;
        }

        try {
            await CapIAuAPI.reassignFaces(STATE.currentProjectId, faceIds, -1, newName);

            this.closeReassignModal();

            // Recarregar os rostos no modal
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, cluster.cluster_id, cluster.name || "");
            this.renderGroupManagerFaces(faces, cluster);
            this.updateGroupManagerBulkBar();

            // Recarregar a barra lateral de grupos
            await this.loadFaceClusters();

            const countVal = document.getElementById("group-manager-count-val");
            if (countVal) countVal.textContent = faces.length;

            if (faces.length === 0) {
                this.closeGroupManagerModal();
            }

            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
            alert("Rostos reatribuídos com sucesso!");
        } catch (e) {
            console.error("Erro ao reatribuir faces:", e);
            alert("Erro ao reatribuir faces selecionadas.");
        }
    }

    static async rejectSelectedFaces(cluster) {
        if (!cluster) return;
        const selected = document.querySelectorAll(".group-manager-face-card.selected");
        const faceIds = Array.from(selected).map(card => parseInt(card.dataset.faceId));
        if (faceIds.length === 0) return;
        
        const objectName = prompt(`As ${faceIds.length} detecções selecionadas não são rostos. Se forem o mesmo objeto relevante (ex: Abajur, Cadeira, Microfone), digite o nome do objeto. Caso contrário, deixe em branco para marcar todas como Não Relevante:\n(Clique em Cancelar para desistir)`);
        if (objectName === null) return;
        
        try {
            for (const fid of faceIds) {
                await CapIAuAPI.rejectFace(fid, objectName.trim());
            }
            
            // Recarregar os rostos no modal
            const faces = await CapIAuAPI.fetchClusterFaces(STATE.currentProjectId, cluster.cluster_id, cluster.name || "");
            this.renderGroupManagerFaces(faces, cluster);
            this.updateGroupManagerBulkBar();
            
            // Recarregar a barra lateral de grupos
            await this.loadFaceClusters();
            
            const countVal = document.getElementById("group-manager-count-val");
            if (countVal) countVal.textContent = faces.length;
            
            if (faces.length === 0) {
                this.closeGroupManagerModal();
            }
            
            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
            alert("Faces descartadas com sucesso!");
        } catch (e) {
            console.error("Erro ao rejeitar faces:", e);
            alert("Erro ao descartar faces selecionadas.");
        }
    }

    static async openNamesManagerModal() {
        const modal = document.getElementById("names-manager-modal");
        if (modal) {
            modal.style.display = "flex";
            const searchInput = document.getElementById("names-manager-search");
            if (searchInput) searchInput.value = "";
            await this.loadNamesManagerList();
        }
    }

    static closeNamesManagerModal() {
        const modal = document.getElementById("names-manager-modal");
        if (modal) {
            modal.style.display = "none";
        }
    }

    static async loadNamesManagerList() {
        const tbody = document.getElementById("names-manager-tbody");
        if (!tbody) return;

        // Reset check all and bulk actions bar
        const chkSelectAll = document.getElementById("chk-names-select-all");
        if (chkSelectAll) chkSelectAll.checked = false;
        this.updateNamesBulkActionsBar();

        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Carregando nomes...</td></tr>';

        try {
            const projectId = STATE.currentProjectId;
            if (!projectId) return;

            const speakers = await CapIAuAPI.fetchProjectSpeakers(projectId).catch(() => []);
            
            // Remove duplicates, empty values and default placeholders
            const cleanSpeakers = Array.from(new Set(speakers))
                .filter(s => s && !s.startsWith("Pessoa Desconhecida") && !s.startsWith("SPEAKER_"))
                .sort();

            const searchInput = document.getElementById("names-manager-search");
            const filterText = searchInput ? searchInput.value.toLowerCase().trim() : "";
            
            const filteredSpeakers = cleanSpeakers.filter(sp => sp.toLowerCase().includes(filterText));

            if (filteredSpeakers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhum nome encontrado.</td></tr>';
                return;
            }

            tbody.innerHTML = "";
            filteredSpeakers.forEach(sp => {
                const tr = document.createElement("tr");
                tr.style.borderBottom = "1px solid rgba(255,255,255,0.04)";
                
                tr.innerHTML = `
                    <td style="padding: 10px 12px; width: 40px; text-align: center;">
                        <input type="checkbox" class="name-select-checkbox" data-name="${sp}" style="cursor: pointer;">
                    </td>
                    <td style="padding: 10px 12px; font-weight: 500; color: #fff; font-size: 13px;">${sp}</td>
                    <td class="names-actions-cell" style="padding: 10px 12px; text-align: right; display: flex; gap: 8px; justify-content: flex-end; align-items: center; width: 280px;">
                        <button class="btn-flat-action cyan btn-rename" title="Renomear" style="background: transparent; border: none; padding: 4px 8px; font-size: 11px; cursor: pointer;">
                            <i class="fa-solid fa-user-pen"></i> Renomear
                        </button>
                        <button class="btn-flat-action violet btn-merge" title="Mesclar" style="background: transparent; border: none; padding: 4px 8px; font-size: 11px; cursor: pointer;">
                            <i class="fa-solid fa-code-merge"></i> Mesclar
                        </button>
                        <button class="btn-flat-action rose btn-delete" title="Deletar" style="background: transparent; border: none; padding: 4px 8px; font-size: 11px; cursor: pointer;">
                            <i class="fa-solid fa-trash"></i> Deletar
                        </button>
                    </td>
                `;

                // Checkbox binding
                tr.querySelector(".name-select-checkbox").addEventListener("change", () => this.updateNamesBulkActionsBar());

                // Individual bindings
                tr.querySelector(".btn-rename").addEventListener("click", () => this.handleNameRename(sp));
                tr.querySelector(".btn-delete").addEventListener("click", () => this.handleNameDelete(sp));
                
                // Inline Merge dropdown trigger
                tr.querySelector(".btn-merge").addEventListener("click", () => {
                    const actionsCell = tr.querySelector(".names-actions-cell");
                    actionsCell.innerHTML = `
                        <div style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; width: 100%;">
                            <span style="font-size: 11px; color: var(--text-secondary);">Mesclar em:</span>
                            <input type="text" list="speakers-datalist" class="merge-target-input" placeholder="Digite/Selecione..." style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-glass); background: rgba(0,0,0,0.3); color: #fff; font-size: 11px; width: 130px; outline: none;">
                            <button class="btn-flat-action cyan btn-confirm-merge-inline" style="font-size: 11px; padding: 4px 6px;" title="Confirmar"><i class="fa-solid fa-check"></i></button>
                            <button class="btn-flat-action rose btn-cancel-merge-inline" style="font-size: 11px; padding: 4px 6px;" title="Cancelar"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    `;

                    // Focus input
                    const mergeInput = actionsCell.querySelector(".merge-target-input");
                    mergeInput.focus();

                    // Confirm merge
                    actionsCell.querySelector(".btn-confirm-merge-inline").addEventListener("click", async () => {
                        const targetName = mergeInput.value.trim();
                        if (!targetName) {
                            alert("Nome de destino inválido.");
                            return;
                        }
                        if (targetName === sp) {
                            alert("Não é possível mesclar um nome nele mesmo.");
                            return;
                        }
                        if (!confirm(`Deseja realmente mesclar "${sp}" em "${targetName}"? Isso atualizará faces, falas e entidades.`)) {
                            return;
                        }
                        try {
                            const res = await CapIAuAPI.mergeProjectNames(projectId, sp, targetName);
                            if (res && res.status === "success") {
                                alert(`Fusão de "${sp}" para "${targetName}" realizada com sucesso!`);
                                await this.loadNamesManagerList();
                                await this.loadFaceClusters();
                                if (STATE.activeVideo) {
                                    STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
                                }
                            } else {
                                alert(res ? res.message : "Erro ao mesclar nomes.");
                            }
                        } catch (e) {
                            console.error("Erro ao mesclar:", e);
                            alert("Erro de comunicação ao mesclar.");
                        }
                    });

                    // Cancel merge
                    actionsCell.querySelector(".btn-cancel-merge-inline").addEventListener("click", () => {
                        this.loadNamesManagerList();
                    });
                });

                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error("[NamesManager] Error loading speakers:", e);
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#ef4444;">Erro ao carregar nomes.</td></tr>';
        }
    }

    static updateNamesBulkActionsBar() {
        const bar = document.getElementById("names-bulk-actions-bar");
        const countSpan = document.getElementById("names-bulk-select-count");
        const chkSelectAll = document.getElementById("chk-names-select-all");
        
        if (!bar || !countSpan) return;

        const checked = document.querySelectorAll(".name-select-checkbox:checked");
        const allCheckbox = document.querySelectorAll(".name-select-checkbox");

        countSpan.textContent = checked.length;
        bar.style.display = checked.length > 0 ? "flex" : "none";

        if (chkSelectAll && allCheckbox.length > 0) {
            chkSelectAll.checked = checked.length === allCheckbox.length;
        }
    }

    static async handleNamesBulkDelete() {
        const checked = document.querySelectorAll(".name-select-checkbox:checked");
        if (checked.length === 0) return;

        const names = Array.from(checked).map(cb => cb.dataset.name);
        if (!confirm(`Deseja realmente remover os ${names.length} nomes selecionados globalmente?\n\nOs rostos associados serão desassociados e as falas na transcrição voltarão a ser "Desconhecido".`)) {
            return;
        }

        try {
            const projectId = STATE.currentProjectId;
            let successCount = 0;
            for (const name of names) {
                const res = await CapIAuAPI.deleteProjectName(projectId, name).catch(() => null);
                if (res && res.status === "success") {
                    successCount++;
                }
            }
            alert(`Remoção concluída: ${successCount} de ${names.length} nomes removidos com sucesso!`);
            await this.loadNamesManagerList();
            await this.loadFaceClusters();
            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
        } catch (e) {
            console.error("Erro na exclusão em lote:", e);
            alert("Erro ao executar a exclusão em lote.");
        }
    }

    static async handleNamesBulkMerge() {
        const checked = document.querySelectorAll(".name-select-checkbox:checked");
        if (checked.length === 0) return;

        const names = Array.from(checked).map(cb => cb.dataset.name);
        const targetInput = document.getElementById("names-bulk-merge-target");
        const targetName = targetInput ? targetInput.value.trim() : "";

        if (!targetName) {
            alert("Por favor, digite ou selecione um nome de destino válido.");
            return;
        }

        if (names.includes(targetName)) {
            alert("O nome de destino não pode estar entre os nomes selecionados para serem mesclados.");
            return;
        }

        if (!confirm(`Deseja realmente mesclar os ${names.length} nomes selecionados no nome de destino "${targetName}"?\nEsta ação não poderá ser desfeita.`)) {
            return;
        }

        try {
            const projectId = STATE.currentProjectId;
            let successCount = 0;
            for (const name of names) {
                const res = await CapIAuAPI.mergeProjectNames(projectId, name, targetName).catch(() => null);
                if (res && res.status === "success") {
                    successCount++;
                }
            }
            alert(`Fusão concluída: ${successCount} de ${names.length} nomes mesclados em "${targetName}"!`);
            if (targetInput) targetInput.value = "";
            await this.loadNamesManagerList();
            await this.loadFaceClusters();
            if (STATE.activeVideo) {
                STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
            }
        } catch (e) {
            console.error("Erro na fusão em lote:", e);
            alert("Erro ao executar a fusão em lote.");
        }
    }

    static async handleNameRename(oldName) {
        const newName = prompt(`Digite o novo nome para substituir "${oldName}" globalmente:`, oldName);
        if (newName === null) return; // Cancelled
        const trimmed = newName.trim();
        if (!trimmed) {
            alert("O nome não pode ser vazio.");
            return;
        }
        if (trimmed === oldName) return;

        try {
            const projectId = STATE.currentProjectId;
            const res = await CapIAuAPI.renameProjectName(projectId, oldName, trimmed);
            if (res && res.status === "success") {
                alert(`Nome renomeado de "${oldName}" para "${trimmed}" com sucesso!`);
                await this.loadNamesManagerList();
                await this.loadFaceClusters();
                // Refresh active video transcript panel if any
                if (STATE.activeVideo) {
                    STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
                }
            } else {
                alert(res ? res.message : "Erro ao renomear nome.");
            }
        } catch (e) {
            console.error("Erro ao renomear nome:", e);
            alert("Erro de comunicação ao renomear nome.");
        }
    }

    static async handleNameDelete(name) {
        if (!confirm(`Deseja realmente remover o nome "${name}" globalmente?\n\nOs rostos associados serão desassociados e as falas na transcrição voltarão a ser "Desconhecido".`)) {
            return;
        }

        try {
            const projectId = STATE.currentProjectId;
            const res = await CapIAuAPI.deleteProjectName(projectId, name);
            if (res && res.status === "success") {
                alert(`Associação do nome "${name}" removida com sucesso!`);
                await this.loadNamesManagerList();
                await this.loadFaceClusters();
                if (STATE.activeVideo) {
                    STATE.emit("videoFacesUpdated", STATE.activeVideo.id);
                }
            } else {
                alert(res ? res.message : "Erro ao excluir nome.");
            }
        } catch (e) {
            console.error("Erro ao excluir nome:", e);
            alert("Erro de comunicação ao excluir nome.");
        }
    }

    // ======================================================================
    //  INSPETOR DE ROSTO — atalho 'a'
    //  Revela a face em 3 níveis: 1/3 Contexto · 2/3 Zoom · 3/3 Restauração HD.
    //  Navegação igual ao visualizador da Biblioteca:
    //    scroll = zoom no cursor · espaço+arraste = mover · minimapa
    //    ← → = rosto anterior/próximo · a = avançar · Esc/clique-fora = fechar
    // ======================================================================

    static ensureInspector() {
        let overlay = document.getElementById("face-inspector-overlay");
        if (overlay) { this._inspectorEl = overlay; return overlay; }

        overlay = document.createElement("div");
        overlay.id = "face-inspector-overlay";
        overlay.innerHTML = `
            <div class="fi-stage">
                <div class="fi-media"><div class="fi-wrap"></div></div>
                <div class="fi-minimap"><img class="fi-minimap-img" alt=""><div class="fi-minimap-rect"></div></div>
                <div class="fi-caption"></div>
                <div class="fi-badge"><span class="fi-dot"></span><span class="fi-badge-text"></span></div>
                <button class="fi-close" title="Fechar (Esc)"><i class="fa-solid fa-xmark"></i></button>
                <div class="fi-actions">
                    <button class="fi-edit-toggle" title="Ajustes de imagem (exposição, contraste, saturação)"><i class="fa-solid fa-sliders"></i></button>
                    <button class="fi-raw" title="Ver o RAW em resolução total, sem tratamento"><i class="fa-solid fa-camera"></i> RAW</button>
                    <button class="fi-redo" title="Gerar a restauração novamente"><i class="fa-solid fa-rotate"></i> Refazer</button>
                </div>
                <div class="fi-edit">
                    <label>Exposição<input type="range" class="fi-ed" data-k="b" min="0.4" max="2.2" step="0.02" value="1"></label>
                    <label>Contraste<input type="range" class="fi-ed" data-k="c" min="0.5" max="1.8" step="0.02" value="1"></label>
                    <label>Saturação<input type="range" class="fi-ed" data-k="s" min="0" max="2" step="0.02" value="1"></label>
                    <button class="fi-ed-reset" title="Restaurar ajustes">Reset</button>
                </div>
                <div class="fi-loading"><div class="fi-spin"></div><span>Restaurando rosto…</span></div>
                <div class="fi-controls">
                    <div class="fi-steps">
                        <span class="fi-step" data-step="1" title="1/3 · Contexto"></span>
                        <span class="fi-step" data-step="2" title="2/3 · Zoom no Rosto"></span>
                        <span class="fi-step" data-step="3" title="3/3 · Restauração HD"></span>
                    </div>
                    <div class="fi-hints">
                        <span><kbd>A</kbd>avançar</span>
                        <span><kbd>S</kbd>voltar</span>
                        <span><kbd>scroll</kbd>zoom</span>
                        <span><kbd>espaço</kbd>+arraste mover</span>
                        <span><kbd>←</kbd><kbd>→</kbd>trocar</span>
                        <span><kbd>Esc</kbd>fechar</span>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this._inspectorEl = overlay;
        const media = overlay.querySelector(".fi-media");

        // Clique nas pílulas de progresso para pular de estado
        overlay.querySelectorAll(".fi-step").forEach(stepEl => {
            stepEl.addEventListener("click", (e) => {
                e.stopPropagation();
                const targetStep = parseInt(stepEl.dataset.step);
                if (targetStep && targetStep !== this.inspectorState) {
                    this.goToInspectorStep(targetStep);
                }
            });
        });

        // Fechar / refazer
        overlay.addEventListener("click", (e) => { if (!e.target.closest(".fi-stage") && !e.target.closest(".fi-minimap")) this.closeInspector(); });
        overlay.querySelector(".fi-close").addEventListener("click", (e) => { e.stopPropagation(); this.closeInspector(); });
        overlay.querySelector(".fi-redo").addEventListener("click", (e) => { e.stopPropagation(); this.redoEnhance(); });
        overlay.querySelector(".fi-raw").addEventListener("click", (e) => {
            e.stopPropagation();
            const on = !this._rawPref();
            localStorage.setItem("fi_raw_full", on ? "1" : "0");
            this._enhCache = {}; // preferência global mudou → invalida o cache de restaurações
            overlay.querySelector(".fi-raw").classList.toggle("on", on);
            if (this.inspectorState === 3) this.redoEnhance();      // re-restaura o crop
            else if (this.inspectorState === 2) this._reapplyZoomSource(); // troca proxy↔RAW no zoom
        });

        // Ajustes de imagem (Exposição/Contraste/Saturação) — filtros CSS ao vivo
        overlay.querySelector(".fi-edit-toggle").addEventListener("click", (e) => {
            e.stopPropagation();
            const panel = overlay.querySelector(".fi-edit");
            const show = panel.style.display !== "flex";
            panel.style.display = show ? "flex" : "none";
            overlay.querySelector(".fi-edit-toggle").classList.toggle("on", show);
            if (show) this._fiSyncEditSliders();
        });
        overlay.querySelectorAll(".fi-ed").forEach(sl => {
            sl.addEventListener("input", (e) => {
                e.stopPropagation();
                this._fiEdits = this._fiEdits || this._fiLoadEdits();
                this._fiEdits[sl.dataset.k] = parseFloat(sl.value);
                this._fiSaveEdits();
                this._fiApplyEdits();
            });
            sl.addEventListener("mousedown", (e) => e.stopPropagation());
        });
        overlay.querySelector(".fi-ed-reset").addEventListener("click", (e) => {
            e.stopPropagation();
            this._fiEdits = { b: 1, c: 1, s: 1 };
            this._fiSaveEdits();
            this._fiSyncEditSliders();
            this._fiApplyEdits();
        });

        // Zoom com a roda do mouse, focado no cursor (1x–10x)
        media.addEventListener("wheel", (e) => {
            if (!this.inspectorCard) return;
            e.preventDefault();
            const factor = -e.deltaY > 0 ? 1.25 : 0.8;
            const target = Math.min(10, Math.max(1, (this.fiScale || 1) * factor));
            if (target <= 1.01) this._fiResetView(true);
            else this._fiZoomAtPoint(target, e.clientX, e.clientY, false);
        }, { passive: false });

        // Pan com arraste (espaço pressionado, botão do meio, ou já ampliado)
        media.addEventListener("mousedown", (e) => {
            if (!this.inspectorCard || e.target.closest(".fi-minimap")) return;
            const left = e.button === 0, mid = e.button === 1;
            if (this.fiSpace || mid || ((this.fiScale || 1) > 1.05 && left)) {
                this.fiPanning = true;
                this._panSX = e.clientX; this._panSY = e.clientY;
                this._panIX = this.fiPanX || 0; this._panIY = this.fiPanY || 0;
                media.classList.add("is-panning");
                e.preventDefault();
            }
        });
        window.addEventListener("mousemove", (e) => {
            if (!this.fiPanning) return;
            this.fiPanX = this._panIX + (e.clientX - this._panSX);
            this.fiPanY = this._panIY + (e.clientY - this._panSY);
            this._fiUpdateTransform(false);
        });
        window.addEventListener("mouseup", () => {
            if (this.fiPanning) { this.fiPanning = false; media.classList.remove("is-panning"); }
        });
        // Soltar espaço encerra o modo de arraste
        window.addEventListener("keyup", (e) => {
            if (e.code === "Space" || e.key === " ") {
                this.fiSpace = false; this.fiPanning = false;
                media.classList.remove("space-mode", "is-panning");
            }
        });

        // Minimapa: clicar/arrastar para navegar
        const mm = overlay.querySelector(".fi-minimap");
        const navMinimap = (e) => {
            const el = this._fiMediaEl();
            if (!el) return;
            const r = mm.getBoundingClientRect();
            const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
            this.fiPanX = -((nx - 0.5) * el.offsetWidth) * (this.fiScale || 1);
            this.fiPanY = -((ny - 0.5) * el.offsetHeight) * (this.fiScale || 1);
            this._fiUpdateTransform(false);
        };
        let mmDrag = false;
        mm.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); mmDrag = true; navMinimap(e); });
        window.addEventListener("mousemove", (e) => { if (mmDrag) navMinimap(e); });
        window.addEventListener("mouseup", () => { mmDrag = false; });

        return overlay;
    }

    static async openInspector(card) {
        if (!card) return;
        const faceId = card.dataset.faceId;
        if (!faceId) return;

        this.hideContextPreview();
        this.ensureInspector();

        this.inspectorCard = card;
        this.inspectorFaceId = faceId;
        this.inspectorDetail = null;
        this.inspectorState = 0;
        this._fiResetView(false);

        this._growStageFromCard(card);
        this._inspectorEl.classList.add("visible");
        await this.advanceInspector(); // Estado 1
    }

    // Anima o palco crescendo a partir do card (shared-element)
    static _growStageFromCard(card) {
        const stage = this._inspectorEl.querySelector(".fi-stage");
        stage.style.transition = "none";
        stage.style.transform = "none";
        const sr = stage.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        if (sr.width && cr.width) {
            const scale = Math.max(0.12, Math.min(0.6, cr.width / sr.width));
            const dx = (cr.left + cr.width / 2) - (sr.left + sr.width / 2);
            const dy = (cr.top + cr.height / 2) - (sr.top + sr.height / 2);
            stage.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
            void stage.offsetWidth;
            requestAnimationFrame(() => { stage.style.transition = ""; stage.style.transform = "none"; });
        } else {
            stage.style.transition = "";
        }
    }

    static async goToInspectorStep(step) {
        if (!this.inspectorCard) return;
        if (step < 1 || step > 3) return;
        
        const prev = this.inspectorState;
        this.inspectorState = step;
        this._syncInspectorChrome();

        if (step === 1) {
            return this._renderContext();
        } else if (step === 2) {
            if (prev === 3) {
                await this._renderContext();
            }
            return this._renderZoom();
        } else if (step === 3) {
            return this._renderEnhanced(false);
        }
    }

    static async advanceInspector() {
        if (!this.inspectorCard) return;
        const next = (this.inspectorState || 0) + 1;
        if (next > 3) { this.closeInspector(); return; }
        return this.goToInspectorStep(next);
    }

    static async regressInspector() {
        if (!this.inspectorCard) return;
        const prev = (this.inspectorState || 1) - 1;
        if (prev < 1) { this.closeInspector(); return; }
        return this.goToInspectorStep(prev);
    }

    static _syncInspectorChrome() {
        const overlay = this._inspectorEl;
        if (!overlay) return;
        const s = this.inspectorState;
        overlay.querySelectorAll(".fi-step").forEach(el => el.classList.toggle("on", parseInt(el.dataset.step) <= s));
        const labels = { 1: "1/3 · Contexto", 2: "2/3 · Zoom no rosto", 3: "3/3 · Restauração HD" };
        overlay.querySelector(".fi-badge-text").textContent = labels[s] || "";
        overlay.querySelector(".fi-badge").classList.toggle("is-hd", s === 3);

        // Ações: aparecem ao inspecionar de perto (Estados 2 e 3)
        const zoomed = (s === 2 || s === 3);
        overlay.querySelector(".fi-actions").style.display = zoomed ? "flex" : "none";
        overlay.querySelector(".fi-edit-toggle").style.display = zoomed ? "inline-flex" : "none";
        // RAW: Estados 2 e 3, apenas fotos RAW
        const rawBtn = overlay.querySelector(".fi-raw");
        const showRaw = zoomed && this._isRawPhoto();
        rawBtn.style.display = showRaw ? "inline-flex" : "none";
        if (showRaw) rawBtn.classList.toggle("on", this._rawPref());
        // Refazer: só no Estado 3 (é sobre o crop restaurado)
        overlay.querySelector(".fi-redo").style.display = (s === 3) ? "inline-flex" : "none";
        // Painel de ajustes some fora dos estados 2/3
        if (!zoomed) {
            overlay.querySelector(".fi-edit").style.display = "none";
            overlay.querySelector(".fi-edit-toggle").classList.remove("on");
        }
    }

    static _isRawPhoto() {
        const d = this.inspectorDetail;
        return !!(d && d.photo_id && d.photo_filename &&
            /\.(arw|cr2|cr3|nef|dng|pef|raf|orf|rw2|raw)$/i.test(d.photo_filename));
    }

    static _rawPref() {
        try { return localStorage.getItem("fi_raw_full") === "1"; } catch (e) { return false; }
    }

    // ---- Ajustes de imagem (filtros CSS ao vivo) -------------------------

    static _fiLoadEdits() {
        let e = { b: 1, c: 1, s: 1 };
        try { const j = JSON.parse(localStorage.getItem("fi_edits") || "null"); if (j) e = { ...e, ...j }; } catch (_) {}
        this._fiEdits = e;
        return e;
    }

    static _fiSaveEdits() {
        try { localStorage.setItem("fi_edits", JSON.stringify(this._fiEdits)); } catch (_) {}
    }

    static _fiApplyEdits() {
        const el = this._fiMediaEl();
        if (!el) return;
        const e = this._fiEdits || this._fiLoadEdits();
        el.style.filter = `brightness(${e.b}) contrast(${e.c}) saturate(${e.s})`;
    }

    static _fiSyncEditSliders() {
        const e = this._fiEdits || this._fiLoadEdits();
        this._inspectorEl.querySelectorAll(".fi-ed").forEach(sl => { sl.value = e[sl.dataset.k]; });
    }

    // Troca a fonte do zoom (Estado 2) entre proxy e RAW nativo em resolução total
    static _reapplyZoomSource() {
        const detail = this.inspectorDetail;
        const el = this._fiMediaEl();
        if (!detail || !detail.photo_id || !el || el.tagName !== "IMG") return;
        if (this._rawPref() && this._isRawPhoto()) {
            this._loadRawNative();
        } else {
            el.src = `/api/photo/${detail.photo_id}/file`;
            el.dataset.raw = "0";
        }
    }

    // Carrega o RAW nativo (resolução total, sem tratamento) mantendo o zoom atual
    static _loadRawNative() {
        const detail = this.inspectorDetail;
        const el = this._fiMediaEl();
        if (!detail || !detail.photo_id || !el || el.tagName !== "IMG") return;
        if (el.dataset.raw === "1") return;
        const badge = this._inspectorEl.querySelector(".fi-badge-text");
        const prev = badge.textContent;
        badge.textContent = "2/3 · Carregando RAW…";
        const faceId = this.inspectorFaceId;
        const rawUrl = `/api/photo/${detail.photo_id}/file?raw=true`;
        const probe = new Image();  // pré-carrega p/ trocar sem piscar
        probe.onload = () => {
            if (this.inspectorFaceId !== faceId || this.inspectorState !== 2) return;
            const cur = this._fiMediaEl();
            if (cur && cur.tagName === "IMG") { cur.src = rawUrl; cur.dataset.raw = "1"; }
            badge.textContent = "2/3 · Zoom no rosto (RAW)";
        };
        probe.onerror = () => { if (this.inspectorState === 2) badge.textContent = prev; };
        probe.src = rawUrl;
    }

    // ---- Modelo de zoom/pan (igual ao visualizador da Biblioteca) --------

    static _fiMediaEl() {
        const w = this._inspectorEl && this._inspectorEl.querySelector(".fi-wrap");
        return w ? w.querySelector("img, video") : null;
    }

    static _fiSetMedia(el, src) {
        const wrap = this._inspectorEl.querySelector(".fi-wrap");
        wrap.innerHTML = "";
        wrap.appendChild(el);
        // Minimapa reflete a mídia atual: imagem direta; vídeo via snapshot (lazy).
        const mmImg = this._inspectorEl.querySelector(".fi-minimap-img");
        if (el.tagName === "IMG") {
            if (mmImg) mmImg.src = src || el.src;
            this._fiMmReady = true;
        } else {
            if (mmImg) mmImg.removeAttribute("src");
            this._fiMmReady = false; // captura sob demanda ao ampliar
        }
        this._fiApplyEdits(); // reaplica exposição/contraste/saturação na nova mídia
    }

    // Garante uma fonte para o minimapa (imagem direta, ou snapshot do frame do vídeo)
    static _fiSyncMinimapSource() {
        const el = this._fiMediaEl();
        const mmImg = this._inspectorEl.querySelector(".fi-minimap-img");
        if (!el || !mmImg) return;
        if (el.tagName === "IMG") {
            if (mmImg.getAttribute("src") !== el.src) mmImg.src = el.src;
            this._fiMmReady = true;
            return;
        }
        if (el.tagName === "VIDEO" && el.videoWidth) {
            try {
                const c = document.createElement("canvas");
                c.width = el.videoWidth; c.height = el.videoHeight;
                c.getContext("2d").drawImage(el, 0, 0);
                mmImg.src = c.toDataURL("image/jpeg", 0.72);
                this._fiMmReady = true;
            } catch (e) { /* frame ainda indisponível */ }
        }
    }

    static _fiResetView(animate) {
        this.fiScale = 1; this.fiPanX = 0; this.fiPanY = 0;
        this._fiUpdateTransform(animate);
    }

    static _fiUpdateTransform(animate, dur) {
        const overlay = this._inspectorEl;
        const wrap = overlay && overlay.querySelector(".fi-wrap");
        if (!wrap) return;
        wrap.style.transition = animate ? `transform ${dur || 0.22}s cubic-bezier(0.22, 1, 0.36, 1)` : "none";
        wrap.style.transform = `translate3d(${this.fiPanX || 0}px, ${this.fiPanY || 0}px, 0) scale(${this.fiScale || 1})`;
        const zoomed = (this.fiScale || 1) > 1.05;
        overlay.querySelector(".fi-media").classList.toggle("zoomed", zoomed);
        const mm = overlay.querySelector(".fi-minimap");
        if (mm) {
            if (zoomed) {
                if (!this._fiMmReady) this._fiSyncMinimapSource();
                const hasSrc = !!overlay.querySelector(".fi-minimap-img").getAttribute("src");
                mm.style.display = hasSrc ? "block" : "none";
                if (hasSrc) this._fiUpdateMinimap();
            } else {
                mm.style.display = "none";
            }
        }
    }

    static _fiZoomAtPoint(target, clientX, clientY, animate) {
        const media = this._inspectorEl.querySelector(".fi-media");
        const scale = Math.min(10, Math.max(1, target));
        const r = media.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const mx = (clientX == null ? cx : clientX) - cx;
        const my = (clientY == null ? cy : clientY) - cy;
        const pX = (mx - (this.fiPanX || 0)) / (this.fiScale || 1);
        const pY = (my - (this.fiPanY || 0)) / (this.fiScale || 1);
        let nx = mx - pX * scale, ny = my - pY * scale;
        if (scale <= 1.01) { nx = 0; ny = 0; }
        this.fiScale = scale; this.fiPanX = nx; this.fiPanY = ny;
        this._fiUpdateTransform(animate);
    }

    // Enquadra o rosto (box normalizado) com um punch-in mais lento p/ ver o caminho
    static _fiFocusBox(box, tries) {
        const el = this._fiMediaEl();
        const media = this._inspectorEl.querySelector(".fi-media");
        if (!el || !media) return;
        const dispW = el.offsetWidth, dispH = el.offsetHeight;
        if (!dispW || !dispH) {
            // mídia ainda sem layout (ex.: vídeo sem metadados) — tenta de novo
            if ((tries || 0) < 20) requestAnimationFrame(() => this._fiFocusBox(box, (tries || 0) + 1));
            return;
        }
        const [bx, by, bw, bh] = box.map(Number);
        const cx = bx + bw / 2, cy = by + bh / 2;
        const Wv = media.clientWidth, Hv = media.clientHeight;
        const zH = 0.55 * Hv / Math.max(bh * dispH, 1);
        const zW = 0.80 * Wv / Math.max(bw * dispW, 1);
        const scale = Math.max(1.6, Math.min(9, Math.min(zH, zW)));
        this.fiScale = scale;
        this.fiPanX = -((cx - 0.5) * dispW) * scale;
        this.fiPanY = -((cy - 0.5) * dispH) * scale;
        this._fiUpdateTransform(true, 0.7); // ~1,5x mais lento que antes
    }

    static _fiUpdateMinimap() {
        const overlay = this._inspectorEl;
        const mm = overlay.querySelector(".fi-minimap");
        const rect = overlay.querySelector(".fi-minimap-rect");
        const el = this._fiMediaEl();
        const media = overlay.querySelector(".fi-media");
        if (!mm || !rect || !el || !media) return;
        const iw = el.offsetWidth, ih = el.offsetHeight;
        if (!iw || !ih) return;
        const vp = media.getBoundingClientRect();
        const mmR = mm.getBoundingClientRect();
        const scaledW = iw * this.fiScale, scaledH = ih * this.fiScale;
        const visFracW = Math.min(scaledW, vp.width) / scaledW;
        const visFracH = Math.min(scaledH, vp.height) / scaledH;
        const imgAspect = iw / ih, mmAspect = mmR.width / mmR.height;
        let mw, mh, mx, my;
        if (imgAspect > mmAspect) { mw = mmR.width; mh = mmR.width / imgAspect; mx = 0; my = (mmR.height - mh) / 2; }
        else { mh = mmR.height; mw = mmR.height * imgAspect; mx = (mmR.width - mw) / 2; my = 0; }
        const rectW = Math.max(8, Math.min(mw, visFracW * mw));
        const rectH = Math.max(8, Math.min(mh, visFracH * mh));
        const cxFrac = 0.5 + (-this.fiPanX / this.fiScale) / iw;
        const cyFrac = 0.5 + (-this.fiPanY / this.fiScale) / ih;
        rect.style.width = rectW + "px";
        rect.style.height = rectH + "px";
        rect.style.left = Math.max(mx, Math.min(mx + mw - rectW, mx + cxFrac * mw - rectW / 2)) + "px";
        rect.style.top = Math.max(my, Math.min(my + mh - rectH, my + cyFrac * mh - rectH / 2)) + "px";
    }

    // ---- Estados ---------------------------------------------------------

    // ESTADO 1 — foto/vídeo completo, centralizado (contexto da cena)
    static async _renderContext() {
        const overlay = this._inspectorEl;
        const caption = overlay.querySelector(".fi-caption");
        const faceId = this.inspectorFaceId;

        let detail = this.inspectorDetail;
        if (!detail) {
            try { detail = await CapIAuAPI.request(`/api/faces/face/${faceId}`); }
            catch (e) { console.error("[Inspector] erro ao buscar detalhe:", e); return; }
            if (this.inspectorFaceId !== faceId || !this.inspectorCard) return; // corrida
            this.inspectorDetail = detail;
        }

        this._fiResetView(false);

        if (detail.video_id) {
            const video = document.createElement("video");
            video.src = `/api/video/${detail.video_id}/stream`;
            video.muted = true; video.playsInline = true; video.preload = "auto";
            video.addEventListener("click", () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
            this._fiSetMedia(video);
            const ts = parseFloat(detail.timestamp) || 0;
            video.addEventListener("loadedmetadata", () => { try { video.currentTime = ts; } catch (e) {} }, { once: true });
            caption.textContent = `${detail.video_filename || "Vídeo"} · ${ts.toFixed(1)}s`;
        } else if (detail.photo_id) {
            const img = document.createElement("img");
            img.src = `/api/photo/${detail.photo_id}/file`;
            this._fiSetMedia(img, img.src);
            caption.textContent = detail.photo_filename || "Foto";
        } else {
            caption.textContent = "Mídia de origem indisponível";
        }
    }

    // ESTADO 2 — aproxima no rosto (punch-in lento) e libera zoom/pan livres
    static async _renderZoom() {
        const detail = this.inspectorDetail;
        const el = this._fiMediaEl();
        if (!el || !detail) return;
        let box = detail.bounding_box;
        if (typeof box === "string") { try { box = JSON.parse(box); } catch (e) {} }
        if (!Array.isArray(box) || box.length < 4) return; // sem caixa: mantém o contexto
        this._fiFocusBox(box, 0);
        // Modo RAW: carrega o RAW nativo (resolução total, sem tratamento) sobre o zoom
        if (this._isRawPhoto() && this._rawPref()) this._loadRawNative();
    }

    // ESTADO 3 — crop restaurado/realçado do rosto (elemento novo, sem zoom residual)
    static async _renderEnhanced(force) {
        const overlay = this._inspectorEl;
        const caption = overlay.querySelector(".fi-caption");
        const loading = overlay.querySelector(".fi-loading");
        const badge = overlay.querySelector(".fi-badge-text");
        const faceId = this.inspectorFaceId;

        this._fiResetView(false);
        this._enhCache = this._enhCache || {};

        let entry = force ? null : this._enhCache[faceId];
        if (!entry) {
            loading.classList.add("active");
            const useRaw = this._isRawPhoto() && this._rawPref();
            badge.textContent = useRaw ? "3/3 · Restaurando RAW…" : "3/3 · Restaurando…";
            try {
                const res = await CapIAuAPI.enhanceFace(faceId, useRaw);
                if (res && res.enhanced_url) {
                    // Sempre com cache-busting: o browser nunca reexibe uma restauração antiga/errada.
                    const u = `${res.enhanced_url}${res.enhanced_url.includes("?") ? "&" : "?"}t=${Date.now()}`;
                    entry = { url: u, method: res.method || "fast" };
                    this._enhCache[faceId] = entry;
                }
            } catch (e) {
                console.error("[Inspector] erro no aprimoramento:", e);
            }
            loading.classList.remove("active");
        }

        // corrida: fechou / trocou de rosto / recuou durante o await?
        if (this.inspectorFaceId !== faceId || this.inspectorState !== 3 || !this.inspectorCard) return;

        if (entry) {
            const img = document.createElement("img");
            img.src = entry.url;
            this._fiSetMedia(img, entry.url);
            badge.textContent = `3/3 · HD (${entry.method})`;
            caption.textContent = "Rosto restaurado";
        } else {
            // Falha: NÃO volta ao passo 2 (senão 'a' reprocessa). Mantém 3/3 com aviso.
            badge.textContent = "3/3 · HD (indisponível)";
            caption.textContent = "Não foi possível restaurar (arquivo de origem ausente?)";
        }
    }

    // Refazer restauração: regenera no servidor e recarrega sem cache
    static redoEnhance() {
        if (!this.inspectorCard) return;
        const btn = this._inspectorEl.querySelector(".fi-redo");
        if (btn && btn.classList.contains("busy")) return; // evita clique duplo
        if (btn) btn.classList.add("busy");
        if (this._enhCache) delete this._enhCache[this.inspectorFaceId];
        this.inspectorState = 3;
        this._syncInspectorChrome();
        Promise.resolve(this._renderEnhanced(true)).finally(() => { if (btn) btn.classList.remove("busy"); });
    }

    // Setas ← → : troca o inspetor para o rosto anterior/próximo do grid
    static stepInspector(dir) {
        const card = this.inspectorCard;
        if (!card) return;
        const container = card.parentElement;
        if (!container) return;
        const cards = Array.from(container.querySelectorAll(".fullscreen-face-card, .disambiguation-item"));
        const idx = cards.indexOf(card);
        if (idx === -1) return;
        let n = idx + dir;
        if (n < 0) n = cards.length - 1;
        if (n >= cards.length) n = 0;
        const nextCard = cards[n];
        if (!nextCard || nextCard === card) return;

        try { nextCard.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {}

        this.inspectorCard = nextCard;
        this.inspectorFaceId = nextCard.dataset.faceId;
        this.inspectorDetail = null;
        this.inspectorState = 0;
        this._fiResetView(false);
        this._syncInspectorChrome();
        this.advanceInspector();
    }

    static closeInspector() {
        const overlay = this._inspectorEl;
        const card = this.inspectorCard;
        this.inspectorCard = null;
        this.inspectorFaceId = null;
        this.inspectorDetail = null;
        this.inspectorState = 0;
        this.fiSpace = false; this.fiPanning = false;
        if (!overlay) return;

        const stage = overlay.querySelector(".fi-stage");
        const media = overlay.querySelector(".fi-media");
        const video = overlay.querySelector(".fi-wrap video");
        if (video) video.pause();
        media.classList.remove("is-panning", "space-mode");
        overlay.querySelector(".fi-loading").classList.remove("active");

        // Encolhe o palco de volta ao card de origem
        if (card && stage) {
            const sr = stage.getBoundingClientRect();
            const cr = card.getBoundingClientRect();
            if (sr.width && cr.width) {
                const scale = Math.max(0.12, Math.min(0.6, cr.width / sr.width));
                const dx = (cr.left + cr.width / 2) - (sr.left + sr.width / 2);
                const dy = (cr.top + cr.height / 2) - (sr.top + sr.height / 2);
                stage.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
            }
        }
        overlay.classList.remove("visible");

        // Limpa a mídia após o fade (só se ninguém reabriu nesse meio-tempo)
        setTimeout(() => {
            if (this.inspectorCard) return;
            const wrap = overlay.querySelector(".fi-wrap");
            if (wrap) wrap.innerHTML = "";
            this._fiResetView(false);
            overlay.querySelector(".fi-minimap").style.display = "none";
            stage.style.transition = "none";
            stage.style.transform = "none";
            void stage.offsetWidth;
            stage.style.transition = "";
            overlay.querySelector(".fi-badge-text").textContent = "";
            overlay.querySelector(".fi-caption").textContent = "";
        }, 300);
    }
}


