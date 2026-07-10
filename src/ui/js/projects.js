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
        this.modalNew = document.getElementById("new-project-modal");
        this.modalNewClose = this.modalNew ? this.modalNew.querySelector(".modal-close") : null;
        this.formNew = document.getElementById("new-project-form");
        
        // Sync / Import & Export
        this.btnSync = document.getElementById("btn-sync-project");
        this.modalSync = document.getElementById("sync-project-modal");
        this.formExport = document.getElementById("export-project-form");
        this.formImport = document.getElementById("import-project-form");

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
        if (this.formNew) this.formNew.addEventListener("submit", (e) => this.createNewProject(e));
        if (this.btnDelete) this.btnDelete.addEventListener("click", () => this.deleteActiveProject());

        // Sync modal listeners
        if (this.btnSync) this.btnSync.addEventListener("click", () => this.openSyncModal());
        if (this.modalSync) {
            const closeSync = this.modalSync.querySelector(".modal-close");
            if (closeSync) closeSync.addEventListener("click", () => this.closeSyncModal());
        }
        if (this.formExport) this.formExport.addEventListener("submit", (e) => this.exportProject(e));
        if (this.formImport) this.formImport.addEventListener("submit", (e) => this.importProject(e));

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
        if (this.modalNew) this.modalNew.style.display = "flex";
    }

    closeNewModal() {
        if (this.modalNew) this.modalNew.style.display = "none";
        if (this.formNew) this.formNew.reset();
    }

    async createNewProject(e) {
        e.preventDefault();
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
        if (this.modalSync) this.modalSync.style.display = "flex";
    }

    closeSyncModal() {
        if (this.modalSync) this.modalSync.style.display = "none";
    }

    async exportProject(e) {
        e.preventDefault();
        const incProxies = document.getElementById("export-include-proxies")?.checked || false;
        const incPhotos = document.getElementById("export-include-photos")?.checked || false;
        const incDocs = document.getElementById("export-include-docs")?.checked || false;

        // Dispara download do ZIP pelo formulário
        const queryParams = new URLSearchParams({
            include_metadata: "true",
            include_proxies: incProxies.toString(),
            include_photos: incPhotos.toString(),
            include_docs: incDocs.toString()
        });
        
        const exportUrl = `/api/project/${STATE.currentProjectId}/export`;
        
        // Criamos uma requisição fake post ou abrimos em blank
        try {
            this.closeSyncModal();
            alert("Sua exportação ZIP está sendo gerada. O download começará em breve.");
            
            // Formulário dinâmico para POST download
            const form = document.createElement("form");
            form.method = "POST";
            form.action = exportUrl;
            form.target = "_blank";
            
            const payload = {
                include_metadata: true,
                include_proxies: incProxies,
                include_photos: incPhotos,
                include_docs: incDocs
            };
            
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = "options";
            // O endpoint FastAPI aceita Pydantic JSON no Body, então precisamos enviar por JSON
            // Para fazer download POST em aba separada com form nativo, enviamos como JSON
            // Como form nativo envia multipart/urlencoded por padrão, em vez de form, usamos fetch com blob
            
            this.downloadZipViaFetch(exportUrl, payload);
        } catch (err) {
            alert("Erro ao disparar exportação.");
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
                
                // Tenta extrair filename dos headers
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
        e.preventDefault();
        const fileInput = document.getElementById("import-zip-file");
        if (!fileInput || fileInput.files.length === 0) return;
        
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append("file", file);
        
        this.closeSyncModal();
        alert("Importando projeto. Aguarde a conclusão da indexação relacional e vetorial...");
        
        try {
            const res = await fetch("/api/project/import", {
                method: "POST",
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                alert("Projeto importado e reindexado com sucesso!");
                await this.loadProjectsList();
                STATE.currentProjectId = data.project_id;
            } else {
                const text = await res.text();
                alert(`Falha ao importar: ${text}`);
            }
        } catch (err) {
            alert(`Erro na importação: ${err.message}`);
        }
    }
}
