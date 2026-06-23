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

        // Listen for project change to load face clusters
        STATE.on("projectChanged", () => {
            this.loadFaceClusters();
            this.closeFullscreenDisambiguation();
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

                const thumbUrl = `/api/face/${cluster.rep_face_id}/thumbnail`;
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

                const thumbUrl = `/api/face/${face.id}/thumbnail`;
                
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

            const thumbUrl = `/api/face/${face.id}/thumbnail`;
            
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
                <div class="fullscreen-face-thumb-container">
                    <img class="fullscreen-face-thumb" src="${thumbUrl}" alt="Rosto" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><rect width=%22120%22 height=%22120%22 fill=%22%23222%22/><text x=%2250%%22 y=%2250%%22 font-size=%2224%22 text-anchor=%22middle%22 dy=%22.3em%22 fill=%22%23666%22>?</text></svg>'">
                </div>
                <div class="fullscreen-face-meta" title="${metaText}">${metaText}</div>
                <div class="fullscreen-face-input-wrapper">
                    <input class="fullscreen-face-input" type="text" list="speakers-datalist" value="${inputValue}" placeholder="${inputPlaceholder}">
                </div>
            `;

            const inputEl = card.querySelector(".fullscreen-face-input");
            
            let isChanging = false;
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

            grid.appendChild(card);
        });
    }

    static closeFullscreenDisambiguation() {
        const modal = document.getElementById("fullscreen-faces-disambiguation");
        if (modal) modal.style.display = "none";
        this.loadFaceClusters();
    }
}

