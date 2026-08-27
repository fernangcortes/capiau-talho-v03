import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";
import { CREDITS_NORMALIZER } from "./creditsNormalizer.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TYPE_LABELS = { person: "Pessoa", object: "Objeto", location: "Locação", other: "Outro" };
const REALM_LABELS = { production: "Produção", story: "Obra" };
const STATUS_LABELS = { suggested: "Sugerido", confirmed: "Confirmado", rejected: "Rejeitado" };
const TYPE_ICONS = { person: "fa-user", object: "fa-cube", location: "fa-location-dot", other: "fa-tag" };

/** Painel "Entidades do Projeto" (E-B): busca/filtra/edita pessoas, objetos e
 * locações (produção x obra), com fusão e vínculo personagem→ator. Molde
 * estrutural = names-manager-modal (FaceManager), mas com filtro client-side
 * sobre a lista já carregada em vez de refazer a busca a cada tecla — o
 * catálogo de entidades é pequeno (dezenas a poucas centenas por projeto). */
export class EntityManager {
    static allEntities = [];
    static faceClusters = [];
    static _mergeCandidateIds = [];

    static init() {
        const btnCredits = document.getElementById("btn-open-credits-normalizer");
        if (btnCredits) btnCredits.addEventListener("click", () => CREDITS_NORMALIZER.openModal());

        const btnOpen = document.getElementById("btn-open-entities-manager");
        if (btnOpen) btnOpen.addEventListener("click", () => this.openEntitiesModal());

        const btnClose = document.getElementById("btn-close-entities-manager");
        if (btnClose) btnClose.addEventListener("click", () => this.closeEntitiesModal());

        const search = document.getElementById("entities-manager-search");
        if (search) search.addEventListener("input", () => this.applyFilters());

        const typeFilter = document.getElementById("entities-filter-type");
        if (typeFilter) typeFilter.addEventListener("change", () => this.applyFilters());

        const realmFilter = document.getElementById("entities-filter-realm");
        if (realmFilter) realmFilter.addEventListener("change", () => this.applyFilters());

        const statusFilter = document.getElementById("entities-filter-status");
        if (statusFilter) statusFilter.addEventListener("change", () => this.applyFilters());

        const chkSelectAll = document.getElementById("chk-entities-select-all");
        if (chkSelectAll) {
            chkSelectAll.addEventListener("change", () => {
                document.querySelectorAll(".entity-select-checkbox").forEach(cb => cb.checked = chkSelectAll.checked);
                this.updateBulkActionsBar();
            });
        }

        const btnBulkConfirm = document.getElementById("btn-entities-bulk-confirm");
        if (btnBulkConfirm) btnBulkConfirm.addEventListener("click", () => this.handleBulkStatus("confirmed"));

        const btnBulkReject = document.getElementById("btn-entities-bulk-reject");
        if (btnBulkReject) btnBulkReject.addEventListener("click", () => this.handleBulkStatus("rejected"));

        const btnBulkMerge = document.getElementById("btn-entities-bulk-merge");
        if (btnBulkMerge) btnBulkMerge.addEventListener("click", () => this.openMergePanel());

        const btnConfirmMerge = document.getElementById("btn-entities-confirm-merge");
        if (btnConfirmMerge) btnConfirmMerge.addEventListener("click", () => this.confirmMerge());

        const btnCancelMerge = document.getElementById("btn-entities-cancel-merge");
        if (btnCancelMerge) btnCancelMerge.addEventListener("click", () => this.closeMergePanel());
    }

    /** @param {{status?:string, type?:string, realm?:string}} initialFilter */
    static async openEntitiesModal(initialFilter = {}) {
        const modal = document.getElementById("entities-manager-modal");
        if (!modal) return;
        modal.style.display = "flex";

        const search = document.getElementById("entities-manager-search");
        if (search) search.value = "";
        const typeFilter = document.getElementById("entities-filter-type");
        if (typeFilter) typeFilter.value = initialFilter.type || "";
        const realmFilter = document.getElementById("entities-filter-realm");
        if (realmFilter) realmFilter.value = initialFilter.realm || "";
        const statusFilter = document.getElementById("entities-filter-status");
        if (statusFilter) statusFilter.value = initialFilter.status || "";

        await this.loadEntities();
    }

    static closeEntitiesModal() {
        const modal = document.getElementById("entities-manager-modal");
        if (modal) modal.style.display = "none";
        this.closeMergePanel();
    }

    static async loadEntities() {
        const tbody = document.getElementById("entities-manager-tbody");
        if (!tbody) return;
        const projectId = STATE.currentProjectId;
        if (!projectId) return;

        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Carregando entidades...</td></tr>`;

        try {
            const [entitiesResp, clusters] = await Promise.all([
                CapIAuAPI.fetchEntities(projectId),
                CapIAuAPI.fetchFaceClusters(projectId).catch(() => []),
            ]);
            this.allEntities = entitiesResp.entities || [];
            this.faceClusters = clusters || [];
            this.applyFilters();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:#ef4444;">Erro ao carregar entidades: ${esc(e.message)}</td></tr>`;
        }
    }

    static applyFilters() {
        const search = document.getElementById("entities-manager-search");
        const typeFilter = document.getElementById("entities-filter-type");
        const realmFilter = document.getElementById("entities-filter-realm");
        const statusFilter = document.getElementById("entities-filter-status");

        const q = search ? search.value.toLowerCase().trim() : "";
        const typeF = typeFilter ? typeFilter.value : "";
        const realmF = realmFilter ? realmFilter.value : "";
        const statusF = statusFilter ? statusFilter.value : "";

        const filtered = this.allEntities.filter(e => {
            if (typeF && e.entity_type !== typeF) return false;
            if (realmF && e.realm !== realmF) return false;
            if (statusF && e.status !== statusF) return false;
            if (q) {
                const haystack = [e.name, ...(e.aliases || [])].join(" ").toLowerCase();
                if (!haystack.includes(q)) return false;
            }
            return true;
        });
        this.renderEntitiesTable(filtered);
    }

    static renderThumb(entity) {
        const url = this.findFaceThumbUrl(entity);
        if (url) {
            return `<img src="${url}" alt="" style="width:28px; height:28px; border-radius:50%; object-fit:cover; display:block;" onerror="this.style.visibility='hidden'">`;
        }
        const icon = TYPE_ICONS[entity.entity_type] || "fa-tag";
        return `<div style="width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:11px;"><i class="fa-solid ${icon}"></i></div>`;
    }

    /** Miniatura = crop do rosto agrupado com o mesmo nome (person.profile_image_path
     * nunca é escrito por nenhum fluxo real — ver auditoria E-B; usar o cluster de
     * rosto já resolve a mesma necessidade sem depender de uma coluna morta). Para
     * personagem (story) vinculado, busca pelo rosto do ATOR vinculado, não do papel. */
    static findFaceThumbUrl(entity) {
        if (entity.entity_type !== "person" || !this.faceClusters.length) return null;
        const lookupName = (entity.realm === "story" && entity.linked_entity_name) ? entity.linked_entity_name : entity.name;
        const cluster = this.faceClusters.find(c => (c.name || "").toLowerCase() === lookupName.toLowerCase());
        return cluster ? `/api/faces/face/${cluster.rep_face_id}/thumbnail` : null;
    }

    static renderEntitiesTable(list) {
        const tbody = document.getElementById("entities-manager-tbody");
        if (!tbody) return;

        const chkSelectAll = document.getElementById("chk-entities-select-all");
        if (chkSelectAll) chkSelectAll.checked = false;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:var(--text-muted);">Nenhuma entidade encontrada.</td></tr>`;
            this.updateBulkActionsBar();
            return;
        }

        tbody.innerHTML = "";
        list.forEach(entity => {
            const tr = document.createElement("tr");
            tr.dataset.entityId = entity.id;
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.04)";

            const aliasesHtml = (entity.aliases && entity.aliases.length)
                ? `<div style="font-size:9px; color:var(--text-muted);">${esc(entity.aliases.join(", "))}</div>` : "";
            const statusColor = entity.status === "confirmed" ? "var(--color-emerald)" : entity.status === "rejected" ? "var(--color-rose)" : "var(--color-violet)";
            const linkText = entity.linked_entity_name ? `interpretado por ${esc(entity.linked_entity_name)}` : "—";
            const showLinkBtn = entity.entity_type === "person" && entity.realm === "story";

            tr.innerHTML = `
                <td style="padding: 8px 10px; text-align: center;"><input type="checkbox" class="entity-select-checkbox" data-entity-id="${entity.id}" style="cursor:pointer;"></td>
                <td style="padding: 8px 10px;">${this.renderThumb(entity)}</td>
                <td style="padding: 8px 10px; color:#fff;"><strong>${esc(entity.name)}</strong>${aliasesHtml}</td>
                <td style="padding: 8px 10px; color:var(--text-secondary);">${TYPE_LABELS[entity.entity_type] || entity.entity_type}</td>
                <td style="padding: 8px 10px; color:var(--text-secondary);">${REALM_LABELS[entity.realm] || entity.realm}</td>
                <td style="padding: 8px 10px; color:var(--text-secondary);">${esc(entity.role || "—")}</td>
                <td style="padding: 8px 10px; color:var(--text-secondary);">${linkText}</td>
                <td style="padding: 8px 10px; text-align:center; color:var(--text-secondary);">${entity.mention_count}</td>
                <td style="padding: 8px 10px; color:${statusColor}; font-weight:600;">${STATUS_LABELS[entity.status] || entity.status}</td>
                <td class="entity-actions-cell" style="padding: 8px 10px; text-align: right; white-space:nowrap;">
                    <button class="btn-flat-action cyan btn-entity-edit" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    ${showLinkBtn ? `<button class="btn-flat-action violet btn-entity-link" title="${entity.linked_entity_id ? "Desvincular" : "Vincular a pessoa real"}"><i class="fa-solid ${entity.linked_entity_id ? "fa-link-slash" : "fa-link"}"></i></button>` : ""}
                    ${entity.status !== "confirmed" ? `<button class="btn-flat-action btn-entity-confirm" style="color:var(--color-emerald);" title="Confirmar"><i class="fa-solid fa-check"></i></button>` : ""}
                    ${entity.status !== "rejected" ? `<button class="btn-flat-action rose btn-entity-reject" title="Rejeitar"><i class="fa-solid fa-ban"></i></button>` : ""}
                </td>
            `;

            tr.querySelector(".entity-select-checkbox").addEventListener("change", () => this.updateBulkActionsBar());
            tr.querySelector(".btn-entity-edit").addEventListener("click", () => this.toggleEditRow(tr, entity));

            const linkBtn = tr.querySelector(".btn-entity-link");
            if (linkBtn) linkBtn.addEventListener("click", () => this.handleLinkAction(tr, entity));

            const confirmBtn = tr.querySelector(".btn-entity-confirm");
            if (confirmBtn) confirmBtn.addEventListener("click", () => this.setStatusSingle(entity.id, "confirmed"));

            const rejectBtn = tr.querySelector(".btn-entity-reject");
            if (rejectBtn) rejectBtn.addEventListener("click", () => this.setStatusSingle(entity.id, "rejected"));

            tbody.appendChild(tr);
        });

        this.updateBulkActionsBar();
    }

    static updateBulkActionsBar() {
        const bar = document.getElementById("entities-bulk-actions-bar");
        const countSpan = document.getElementById("entities-bulk-select-count");
        const chkSelectAll = document.getElementById("chk-entities-select-all");
        if (!bar || !countSpan) return;

        const checked = document.querySelectorAll(".entity-select-checkbox:checked");
        const all = document.querySelectorAll(".entity-select-checkbox");

        countSpan.textContent = checked.length;
        bar.style.display = checked.length > 0 ? "flex" : "none";
        this.closeMergePanel();

        if (chkSelectAll && all.length > 0) {
            chkSelectAll.checked = checked.length === all.length;
        }
    }

    static async handleBulkStatus(status) {
        const checked = document.querySelectorAll(".entity-select-checkbox:checked");
        const ids = Array.from(checked).map(cb => Number(cb.dataset.entityId));
        if (ids.length === 0) return;
        try {
            await CapIAuAPI.bulkEntityStatus(STATE.currentProjectId, ids, status);
            await this.loadEntities();
        } catch (e) {
            alert("Erro ao atualizar entidades: " + e.message);
        }
    }

    static async setStatusSingle(entityId, status) {
        try {
            await CapIAuAPI.bulkEntityStatus(STATE.currentProjectId, [entityId], status);
            await this.loadEntities();
        } catch (e) {
            alert("Erro ao atualizar entidade: " + e.message);
        }
    }

    // ── Fusão em massa (2+ selecionadas → escolhe sobrevivente → preview → confirm) ──

    static openMergePanel() {
        const checked = document.querySelectorAll(".entity-select-checkbox:checked");
        const ids = Array.from(checked).map(cb => Number(cb.dataset.entityId));
        if (ids.length < 2) {
            alert("Selecione 2 ou mais entidades para fundir.");
            return;
        }
        const selected = this.allEntities.filter(e => ids.includes(e.id));
        this._mergeCandidateIds = ids;

        const defaultBar = document.getElementById("entities-bulk-actions-default");
        const panel = document.getElementById("entities-merge-panel");
        if (defaultBar) defaultBar.style.display = "none";
        if (panel) panel.style.display = "flex";

        const select = document.getElementById("entities-merge-survivor-select");
        select.innerHTML = selected.map(e => `<option value="${e.id}">${esc(e.name)} (${e.mention_count} menções)</option>`).join("");

        const warnEl = document.getElementById("entities-merge-warning");
        const updateWarning = () => {
            const survivorId = Number(select.value);
            const survivor = selected.find(e => e.id === survivorId);
            const mixed = selected.some(e => e.id !== survivorId && (e.entity_type !== survivor.entity_type || e.realm !== survivor.realm));
            warnEl.style.display = mixed ? "inline" : "none";
            warnEl.textContent = mixed ? "⚠ tipos/universos diferentes sendo fundidos — confirme que faz sentido" : "";
        };
        select.onchange = updateWarning;
        updateWarning();
    }

    static closeMergePanel() {
        const panel = document.getElementById("entities-merge-panel");
        const defaultBar = document.getElementById("entities-bulk-actions-default");
        if (panel) panel.style.display = "none";
        if (defaultBar) defaultBar.style.display = "flex";
    }

    static async confirmMerge() {
        const select = document.getElementById("entities-merge-survivor-select");
        const survivorId = Number(select.value);
        const ids = this._mergeCandidateIds || [];
        const others = ids.filter(id => id !== survivorId);
        if (others.length === 0) return;

        const survivor = this.allEntities.find(e => e.id === survivorId);
        const otherLabels = others.map(id => {
            const e = this.allEntities.find(x => x.id === id);
            return e ? `${e.name} (${e.mention_count} menções)` : id;
        }).join(", ");

        if (!confirm(`Fundir ${otherLabels} em "${survivor.name}"?\n\nOs nomes antigos viram aliases da sobrevivente e as menções são movidas para ela. Esta ação não pode ser desfeita.`)) {
            return;
        }

        try {
            const projectId = STATE.currentProjectId;
            let totalMoved = 0;
            for (const sourceId of others) {
                const res = await CapIAuAPI.mergeEntities(projectId, sourceId, survivorId);
                if (res && typeof res.mentions_moved === "number") totalMoved += res.mentions_moved;
            }
            alert(`Fusão concluída: ${others.length} entidade(s) fundidas em "${survivor.name}" (${totalMoved} menções movidas).`);
            this.closeMergePanel();
            await this.loadEntities();
        } catch (e) {
            alert("Erro ao fundir entidades: " + e.message);
        }
    }

    // ── Vínculo personagem → pessoa real (ator) ──

    static handleLinkAction(tr, entity) {
        if (entity.linked_entity_id) {
            if (!confirm(`Desvincular "${entity.name}" de "${entity.linked_entity_name}"?`)) return;
            CapIAuAPI.updateEntity(entity.id, { linked_entity_id: null })
                .then(() => this.loadEntities())
                .catch(e => alert("Erro ao desvincular: " + e.message));
            return;
        }

        const candidates = this.allEntities.filter(e => e.entity_type === "person" && e.realm === "production");
        const actionsCell = tr.querySelector(".entity-actions-cell");
        actionsCell.innerHTML = `
            <div style="display:flex; gap:6px; align-items:center; justify-content:flex-end;">
                <select class="link-target-select" style="min-width:140px;">
                    <option value="">Selecione...</option>
                    ${candidates.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
                </select>
                <button class="btn-flat-action cyan btn-confirm-link" title="Confirmar"><i class="fa-solid fa-check"></i></button>
                <button class="btn-flat-action rose btn-cancel-link" title="Cancelar"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;

        actionsCell.querySelector(".btn-cancel-link").addEventListener("click", () => this.applyFilters());
        actionsCell.querySelector(".btn-confirm-link").addEventListener("click", async () => {
            const targetId = Number(actionsCell.querySelector(".link-target-select").value);
            if (!targetId) { alert("Selecione uma pessoa."); return; }
            try {
                await CapIAuAPI.updateEntity(entity.id, { linked_entity_id: targetId });
                await this.loadEntities();
            } catch (e) {
                alert("Erro ao vincular: " + e.message);
            }
        });
    }

    // ── Edição inline (nome, descrição, função, universo) ──

    static toggleEditRow(tr, entity) {
        const existing = tr.nextElementSibling;
        if (existing && existing.classList.contains("entity-edit-row")) {
            existing.remove();
            return;
        }
        document.querySelectorAll(".entity-edit-row").forEach(el => el.remove());

        const editRow = document.createElement("tr");
        editRow.className = "entity-edit-row";
        editRow.innerHTML = `
            <td colspan="10" style="padding: 12px 14px; background: rgba(255,255,255,0.03);">
                <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
                    <div class="form-group" style="flex:1; min-width:140px;">
                        <label>Nome</label>
                        <input type="text" class="edit-name" value="${esc(entity.name)}" style="height:30px;">
                    </div>
                    <div class="form-group" style="flex:2; min-width:200px;">
                        <label>Descrição</label>
                        <input type="text" class="edit-description" value="${esc(entity.description || "")}" style="height:30px;">
                    </div>
                    <div class="form-group" style="flex:1; min-width:120px;">
                        <label>Função</label>
                        <input type="text" class="edit-role" value="${esc(entity.role || "")}" placeholder="Ator, Montador..." style="height:30px;">
                    </div>
                    <div class="form-group" style="min-width:110px;">
                        <label>Universo</label>
                        <select class="edit-realm">
                            <option value="production" ${entity.realm === "production" ? "selected" : ""}>Produção</option>
                            <option value="story" ${entity.realm === "story" ? "selected" : ""}>Obra</option>
                        </select>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-primary btn-save-entity-edit" style="height:30px; font-size:11px; padding:0 12px;">Salvar</button>
                        <button class="btn-secondary btn-cancel-entity-edit" style="height:30px; font-size:11px; padding:0 12px;">Cancelar</button>
                    </div>
                </div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:6px;"><i class="fa-solid fa-circle-info"></i> Alterar o nome reprocessa (re-enriquece) as descrições da mídia já associada a esta entidade.</div>
            </td>
        `;
        tr.insertAdjacentElement("afterend", editRow);

        editRow.querySelector(".btn-cancel-entity-edit").addEventListener("click", () => editRow.remove());
        editRow.querySelector(".btn-save-entity-edit").addEventListener("click", async () => {
            const values = {
                name: editRow.querySelector(".edit-name").value,
                description: editRow.querySelector(".edit-description").value,
                role: editRow.querySelector(".edit-role").value,
                realm: editRow.querySelector(".edit-realm").value,
            };
            await this.saveInlineEdit(entity, values);
        });
    }

    /** Nome de pessoa 'production' precisa ir pela rota de rename de faces (sincroniza
     * face+person+transcript+entity+Qdrant, e resolve colisão fundindo automaticamente
     * no servidor); os demais campos — e o nome de qualquer outra entidade — vão pelo
     * PATCH de entities. Se o rename colidiu e fundiu numa entidade já existente, o id
     * original pode ter deixado de existir — por isso sempre recarrega e reresolve pelo
     * nome novo antes de aplicar os campos restantes. */
    static async saveInlineEdit(entity, values) {
        const trimmedName = values.name.trim();
        if (!trimmedName) {
            alert("Nome não pode ser vazio.");
            return;
        }
        const nameChanged = trimmedName !== entity.name;
        const isProductionPerson = entity.entity_type === "person" && entity.realm === "production";
        const fieldPatch = { description: values.description, role: values.role || null, realm: values.realm };

        try {
            if (nameChanged && isProductionPerson) {
                const res = await CapIAuAPI.renameProjectName(STATE.currentProjectId, entity.name, trimmedName);
                if (!res || res.status !== "success") {
                    alert(res ? res.message : "Erro ao renomear.");
                    return;
                }
            } else if (nameChanged) {
                fieldPatch.name = trimmedName;
            }

            await this.loadEntities();
            const current = this.allEntities.find(e => e.name.toLowerCase() === trimmedName.toLowerCase());
            if (current) {
                await CapIAuAPI.updateEntity(current.id, fieldPatch);
                await this.loadEntities();
            }
        } catch (e) {
            alert("Erro ao salvar entidade: " + e.message);
        }
    }
}
