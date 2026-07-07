import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

export class FaceManager {
    static init() {
        const btnCluster = document.getElementById("btn-cluster-faces");
        if (btnCluster) {
            btnCluster.addEventListener("click", () => this.triggerClustering());
        }

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

        const originalText = btnCluster.innerHTML;
        btnCluster.disabled = true;
        btnCluster.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Agrupando...';

        try {
            const res = await CapIAuAPI.clusterFaces(STATE.currentProjectId);
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

            // Update global datalist for speakers autocompletion
            this.updateSpeakersDatalist(speakers);

            if (!clusters || clusters.length === 0) {
                container.innerHTML = '<div class="empty-state-text">Nenhum rosto agrupado ainda. Clique em "Agrupar Rostos" acima.</div>';
                return;
            }

            container.innerHTML = "";
            clusters.forEach(cluster => {
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

        } catch (e) {
            console.error("[FaceManager] Error loading face clusters:", e);
            container.innerHTML = '<div class="empty-state-text">Erro ao carregar os grupos de rostos.</div>';
        }
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
        
        if (!faces || faces.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-muted);">
                    <i class="fa-solid fa-circle-check fa-4x" style="color: var(--color-emerald); margin-bottom: 20px;"></i>
                    <h3 style="font-size: 18px; color: var(--text-primary); margin: 0 0 8px 0;">Tudo limpo!</h3>
                    <p style="margin: 0; font-size: 13px;">Todos os rostos detectados no projeto já foram identificados.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = "";
        faces.forEach(face => {
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
                            if (grid.children.length === 0) {
                                this.renderFullscreenFaces([]);
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
                                // If successfully resolved, let's remove card from fullscreen view
                                card.classList.add("fade-out");
                                setTimeout(() => {
                                    card.remove();
                                    if (grid.children.length === 0) {
                                        this.renderFullscreenFaces([]);
                                    }
                                }, 300);
                            }
                        }, 500);
                    } else {
                        // Success animation
                        card.classList.add("fade-out");
                        setTimeout(() => {
                            card.remove();
                            if (grid.children.length === 0) {
                                this.renderFullscreenFaces([]);
                            }
                        }, 300);
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

                this.updateBulkActionsBar();
            });

            // Hover para exibir contexto (imagem cheia ou clip de vídeo)
            let hoverTimeout;
            card.addEventListener("mouseenter", () => {
                hoverTimeout = setTimeout(() => {
                    FaceManager.showContextPreview(face, card);
                }, 400); // pequeno delay para não incomodar ao passar o mouse rápido
            });
            card.addEventListener("mouseleave", () => {
                clearTimeout(hoverTimeout);
                FaceManager.hideContextPreview();
            });

            grid.appendChild(card);
        });
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
                }
                successCount++;
                card.classList.add("fade-out");
                setTimeout(() => card.remove(), 300);
            } catch (err) {
                console.error("Erro ao aplicar nome no rosto:", faceId, err);
                errorCount++;
            }
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
            
            card.addEventListener("click", () => {
                card.classList.toggle("selected");
                const badge = card.querySelector(".group-manager-face-select-badge");
                const icon = badge.querySelector("i");
                if (card.classList.contains("selected")) {
                    icon.style.display = "block";
                } else {
                    icon.style.display = "none";
                }
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
}
