// Gerenciador de Projetos, seleção, criação, deleção e sincronização ZIP.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { TIMELINE_STATE } from "./timelineState.js";

export class ProjectsManager {
    constructor() {
        this.selector = document.getElementById("project-selector");
        this.btnNew = document.getElementById("btn-new-project");
        this.btnDelete = document.getElementById("btn-delete-project");
        
        // Modals
        this.modalNew = document.getElementById("project-modal");
        this.modalNewClose = document.getElementById("btn-close-project-modal");
        this.btnCancelNew = document.getElementById("btn-cancel-project");
        this.btnSubmitNew = document.getElementById("btn-submit-project");
        
        // Sync / Import & Export
        this.btnSync = document.getElementById("btn-sync-project");
        this.modalSync = document.getElementById("sync-modal");
        this.btnCloseSyncModal = document.getElementById("btn-close-sync-modal");
        this.btnCloseSync = document.getElementById("btn-close-sync");
        this.btnRunExport = document.getElementById("btn-run-export");
        this.exportStatus = document.getElementById("export-status");

        this.init();
    }

    init() {
        if (this.selector) {
            this.selector.addEventListener("change", (e) => {
                const val = e.target.value;
                if (val) STATE.currentProjectId = Number(val);
            });
        }

        if (this.btnNew) this.btnNew.addEventListener("click", () => this.openNewModal());
        if (this.modalNewClose) this.modalNewClose.addEventListener("click", () => this.closeNewModal());
        if (this.btnCancelNew) this.btnCancelNew.addEventListener("click", () => this.closeNewModal());
        if (this.btnSubmitNew) this.btnSubmitNew.addEventListener("click", (e) => this.createNewProject(e));
        if (this.btnDelete) this.btnDelete.addEventListener("click", () => this.deleteActiveProject());

        // Sync modal listeners
        if (this.btnSync) this.btnSync.addEventListener("click", () => this.openSyncModal());
        if (this.btnCloseSyncModal) this.btnCloseSyncModal.addEventListener("click", () => this.closeSyncModal());
        if (this.btnCloseSync) this.btnCloseSync.addEventListener("click", () => this.closeSyncModal());
        
        if (this.btnRunExport) this.btnRunExport.addEventListener("click", (e) => this.exportProject(e));

        // Google Drive Link Listener
        const btnSaveDriveLink = document.getElementById("btn-save-drive-link");
        if (btnSaveDriveLink) {
            btnSaveDriveLink.addEventListener("click", async () => {
                const driveInput = document.getElementById("sync-drive-link");
                if (!driveInput) return;
                const driveLink = driveInput.value.trim();
                
                try {
                    await CapIAuAPI.updateDriveLink(STATE.currentProjectId, driveLink);
                    alert("Link do Google Drive salvo com sucesso!");
                    
                    // Update selector option dataset locally
                    const activeOption = this.selector?.options[this.selector.selectedIndex];
                    if (activeOption) {
                        activeOption.dataset.driveLink = driveLink;
                    }
                    
                    // Update open link button
                    const openDriveBtn = document.getElementById("lnk-open-drive");
                    if (openDriveBtn) {
                        if (driveLink) {
                            openDriveBtn.href = driveLink;
                            openDriveBtn.style.opacity = "1";
                            openDriveBtn.style.pointerEvents = "auto";
                        } else {
                            openDriveBtn.href = "#";
                            openDriveBtn.style.opacity = "0.5";
                            openDriveBtn.style.pointerEvents = "none";
                        }
                    }
                } catch (err) {
                    alert(`Erro ao salvar link: ${err.message}`);
                }
            });
        }

        // Drag and drop / file input for importing
        const importDropzone = document.getElementById("sync-import-dropzone");
        const importFileInput = document.getElementById("sync-import-file-input");

        if (importDropzone && importFileInput) {
            importDropzone.addEventListener("click", () => importFileInput.click());
            importFileInput.addEventListener("change", (e) => this.importProject(e));

            // Drag and drop visual feedback
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
                    importFileInput.files = e.dataTransfer.files;
                    this.importProject(e);
                }
            });
        }

        // Click outside modals to close
        if (this.modalNew) {
            this.modalNew.addEventListener("click", (e) => {
                if (e.target === this.modalNew) this.closeNewModal();
            });
        }
        if (this.modalSync) {
            this.modalSync.addEventListener("click", (e) => {
                if (e.target === this.modalSync) this.closeSyncModal();
            });
        }

        // Handle Enter key on inputs in the new project modal
        const nameInput = document.getElementById("project-name");
        const descInput = document.getElementById("project-desc");
        const handleEnterKey = (e) => {
            if (e.key === "Enter") {
                this.createNewProject(e);
            }
        };
        if (nameInput) nameInput.addEventListener("keydown", handleEnterKey);
        if (descInput) descInput.addEventListener("keydown", handleEnterKey);

        STATE.on("projectChanged", (projectId) => {
            if (this.selector && this.selector.value != projectId) {
                this.selector.value = projectId;
            }
            // Limpa chat, mídias ativas, cuts da timeline e sugestões fantasmas
            STATE.chatHistory = [];
            STATE.activeVideo = null;
            STATE.activeTimelineCuts = [];
            TIMELINE_STATE.ghostTrack = [];
            STATE.emit("timelineGhostUpdated", []);
        });
    }

    async loadProjectsList() {
        if (!this.selector) return;
        this.selector.innerHTML = "<option value=''>Carregando...</option>";
        try {
            const projects = await CapIAuAPI.fetchProjects();
            this.selector.innerHTML = "";
            
            if (projects.length > 0) {
                projects.forEach(p => {
                    const opt = document.createElement("option");
                    opt.value = p.id;
                    opt.textContent = p.name;
                    opt.dataset.driveLink = p.drive_link || "";
                    this.selector.appendChild(opt);
                });
                
                // Valida seleção ativa
                if (!projects.some(p => p.id === STATE.currentProjectId)) {
                    STATE.currentProjectId = projects[0].id;
                }
                this.selector.value = STATE.currentProjectId;
            } else {
                this.selector.innerHTML = "<option value=''>Nenhum projeto</option>";
            }
        } catch (e) {
            console.error("Falha ao obter lista de projetos:", e);
            this.selector.innerHTML = '<option value="1">Making Of MVP (Mock)</option>';
        }
    }

    openNewModal() {
        if (this.modalNew) {
            this.modalNew.classList.add("active");
            setTimeout(() => {
                const nameInput = document.getElementById("project-name");
                if (nameInput) nameInput.focus();
            }, 100);
        }
    }

    closeNewModal() {
        if (this.modalNew) this.modalNew.classList.remove("active");
        
        // Clear fields
        const nameInput = document.getElementById("project-name");
        const descInput = document.getElementById("project-desc");
        if (nameInput) nameInput.value = "";
        if (descInput) descInput.value = "";
    }

    async createNewProject(e) {
        if (e) e.preventDefault();
        const nameInput = document.getElementById("project-name");
        const descInput = document.getElementById("project-desc");
        if (!nameInput || !nameInput.value.trim()) return;

        try {
            const res = await CapIAuAPI.createProject(nameInput.value.trim(), descInput.value.trim());
            this.closeNewModal();
            
            // Recarrega seletor e foca no novo projeto
            await this.loadProjectsList();
            STATE.currentProjectId = res.project_id;
            alert("Projeto criado com sucesso!");
        } catch (err) {
            alert(`Falha ao criar projeto: ${err.message}`);
        }
    }

    async deleteActiveProject() {
        const activeName = this.selector.options[this.selector.selectedIndex]?.text || "projeto ativo";
        if (confirm(`ATENÇÃO: Deseja apagar o projeto "${activeName}" e deletar permanentemente TODAS as suas mídias, transcrições e timelines?`)) {
            try {
                await CapIAuAPI.deleteProject(STATE.currentProjectId);
                alert("Projeto removido física e logicamente do servidor.");
                
                // Reseta para o primeiro da lista
                STATE.currentProjectId = 1;
                await this.loadProjectsList();
            } catch (err) {
                alert("Falha ao remover projeto.");
            }
        }
    }

    openSyncModal() {
        if (this.modalSync) {
            this.modalSync.classList.add("active");
            
            // Load Google Drive link of the active project
            const activeOption = this.selector?.options[this.selector.selectedIndex];
            const driveLink = activeOption?.dataset.driveLink || "";
            
            const driveInput = document.getElementById("sync-drive-link");
            const openDriveBtn = document.getElementById("lnk-open-drive");
            
            if (driveInput) {
                driveInput.value = driveLink;
            }
            if (openDriveBtn) {
                if (driveLink) {
                    openDriveBtn.href = driveLink;
                    openDriveBtn.style.opacity = "1";
                    openDriveBtn.style.pointerEvents = "auto";
                } else {
                    openDriveBtn.href = "#";
                    openDriveBtn.style.opacity = "0.5";
                    openDriveBtn.style.pointerEvents = "none";
                }
            }
        }
    }

    closeSyncModal() {
        if (this.modalSync) this.modalSync.classList.remove("active");
        
        // Reset import progress and fields
        const progressContainer = document.getElementById("sync-import-progress-container");
        const fileInput = document.getElementById("sync-import-file-input");
        if (progressContainer) progressContainer.style.display = "none";
        if (fileInput) fileInput.value = "";
        
        // Reset export status
        if (this.exportStatus) this.exportStatus.style.display = "none";
    }

    async exportProject(e) {
        if (e) e.preventDefault();
        const incProxies = document.getElementById("chk-export-proxies")?.checked || false;
        const incPhotos = document.getElementById("chk-export-photos")?.checked || false;
        const incDocs = document.getElementById("chk-export-docs")?.checked || false;

        const exportUrl = `/api/project/${STATE.currentProjectId}/export`;
        
        try {
            if (this.exportStatus) {
                this.exportStatus.style.display = "block";
            }
            if (this.btnRunExport) {
                this.btnRunExport.disabled = true;
                this.btnRunExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Compactando...';
            }
            
            const payload = {
                include_metadata: true,
                include_proxies: incProxies,
                include_photos: incPhotos,
                include_docs: incDocs
            };
            
            await this.downloadZipViaFetch(exportUrl, payload);
        } catch (err) {
            alert(`Erro ao disparar exportação: ${err.message}`);
        } finally {
            if (this.exportStatus) {
                this.exportStatus.style.display = "none";
            }
            if (this.btnRunExport) {
                this.btnRunExport.disabled = false;
                this.btnRunExport.innerHTML = '<i class="fa-solid fa-file-zipper"></i> Gerar Pacote de Exportação e Baixar';
            }
        }
    }

    async downloadZipViaFetch(url, payload) {
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = downloadUrl;
                
                const contentDisposition = response.headers.get("Content-Disposition");
                let filename = `export_project_${STATE.currentProjectId}.zip`;
                if (contentDisposition && contentDisposition.includes("filename=")) {
                    filename = contentDisposition.split("filename=")[1].replace(/"/g, "");
                }
                
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);
            } else {
                const text = await response.text();
                alert(`Erro na geração do ZIP: ${text}`);
            }
        } catch (e) {
            alert(`Falha de conexão ao exportar: ${e.message}`);
        }
    }

    async importProject(e) {
        const fileInput = document.getElementById("sync-import-file-input");
        if (!fileInput || fileInput.files.length === 0) return;
        
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append("file", file);
        
        const progressContainer = document.getElementById("sync-import-progress-container");
        const statusText = document.getElementById("sync-import-status-text");
        const percentText = document.getElementById("sync-import-percent-text");
        const progressFill = document.getElementById("sync-import-progress-fill");
        
        if (progressContainer) progressContainer.style.display = "block";
        if (statusText) statusText.textContent = "Preparando upload...";
        if (percentText) percentText.textContent = "0%";
        if (progressFill) progressFill.style.width = "0%";

        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                if (statusText) statusText.textContent = "Fazendo upload do arquivo ZIP...";
                if (percentText) percentText.textContent = `${percent}%`;
                if (progressFill) progressFill.style.width = `${percent}%`;
            }
        });

        xhr.addEventListener("load", async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (statusText) statusText.textContent = "Processando e indexando metadados no servidor...";
                if (percentText) percentText.textContent = "100%";
                if (progressFill) progressFill.style.width = "100%";
                
                try {
                    const data = JSON.parse(xhr.responseText);
                    alert("Projeto importado e reindexado com sucesso!");
                    
                    this.closeSyncModal();
                    
                    await this.loadProjectsList();
                    if (data.project_id) {
                        STATE.currentProjectId = data.project_id;
                    }
                } catch (err) {
                    alert("Projeto importado, mas erro ao processar resposta do servidor.");
                }
            } else {
                alert(`Falha ao importar: ${xhr.responseText || xhr.statusText}`);
                if (progressContainer) progressContainer.style.display = "none";
            }
        });

        xhr.addEventListener("error", () => {
            alert("Erro de conexão ao enviar o arquivo.");
            if (progressContainer) progressContainer.style.display = "none";
        });

        xhr.addEventListener("abort", () => {
            alert("Upload cancelado pelo usuário.");
            if (progressContainer) progressContainer.style.display = "none";
        });

        xhr.open("POST", "/api/project/import");
        xhr.send(formData);
    }
}
