// Painel de Configurações da IA: auto-gerado a partir do registry do backend.
// Modo Simples (presets + essenciais) e Profissional (todos os parâmetros),
// com escopo Global ou por Projeto e indicação da origem de cada valor.
import { STATE } from "./state.js";
import { CapIAuAPI } from "./api.js";

const MODE_STORAGE_KEY = "capiau_ai_settings_mode";

export class SettingsPanelManager {
    constructor() {
        this.modal = document.getElementById("settings-modal");
        this.navEl = document.getElementById("settings-nav");
        this.contentEl = document.getElementById("settings-content");
        this.presetsEl = document.getElementById("settings-presets");
        this.dirtyCountEl = document.getElementById("settings-dirty-count");
        this.btnSave = document.getElementById("btn-settings-save");
        this.btnDiscard = document.getElementById("btn-settings-discard");
        this.scopeSelector = document.getElementById("settings-scope-selector");
        this.modeSwitch = document.getElementById("settings-mode-switch");

        this.registry = null;      // lista de entradas do catálogo
        this.registryMap = {};     // key -> entrada
        this.categories = [];
        this.presetsMeta = {};
        this.data = { global: null, project: null, prompts: null };  // resposta do GET por escopo
        this.dirty = { global: new Map(), project: new Map(), prompts: new Map() };

        this.scope = "global";     // "global" | "project"
        this.mode = localStorage.getItem(MODE_STORAGE_KEY) === "pro" ? "pro" : "simple";
        this.activeCategory = null;
        this.isOpen = false;

        this.init();
    }

    init() {
        const btnOpen = document.getElementById("btn-open-settings");
        if (btnOpen) btnOpen.addEventListener("click", () => this.open());

        const linkFromChat = document.getElementById("link-open-settings-from-chat");
        if (linkFromChat) {
            linkFromChat.addEventListener("click", (e) => {
                e.preventDefault();
                this.open("models_keys");
            });
        }

        const btnClose = document.getElementById("btn-close-settings-modal");
        if (btnClose) btnClose.addEventListener("click", () => this.close());

        // Fechar clicando fora do conteúdo (com confirmação se houver alterações)
        if (this.modal) {
            this.modal.addEventListener("mousedown", (e) => {
                if (e.target === this.modal) this.close();
            });
        }

        if (this.scopeSelector) {
            this.scopeSelector.querySelectorAll(".scope-btn").forEach(btn => {
                btn.addEventListener("click", () => this.setScope(btn.dataset.scope));
            });
        }

        if (this.modeSwitch) {
            this.modeSwitch.querySelectorAll(".mode-btn").forEach(btn => {
                btn.addEventListener("click", () => this.setMode(btn.dataset.mode));
            });
        }

        if (this.btnSave) this.btnSave.addEventListener("click", () => this.save());
        if (this.btnDiscard) this.btnDiscard.addEventListener("click", () => this.discard());

        // Troca de projeto: alterações não salvas do escopo projeto perdem o contexto
        STATE.on("projectChanged", () => {
            this.dirty.project.clear();
            this.data.project = null;
            if (this.isOpen) {
                this.updateScopeLabels();
                if (this.scope === "project") {
                    this.refresh().catch(err => console.error("[Settings] Falha ao recarregar:", err));
                }
            }
        });
    }

    // ── Abertura / fechamento ────────────────────────────────────────────────

    async open(categoryId = null) {
        if (!this.modal) return;
        try {
            if (!this.registry) {
                const reg = await CapIAuAPI.fetchSettingsRegistry();
                this.registry = reg.settings;
                this.categories = reg.categories;
                this.presetsMeta = reg.presets;
                this.registryMap = {};
                this.registry.forEach(e => { this.registryMap[e.key] = e; });
            }
            await this.refresh();
        } catch (err) {
            console.error("[Settings] Falha ao carregar configurações:", err);
            alert("Não foi possível carregar as configurações da IA. Verifique se o servidor está atualizado e rodando.");
            return;
        }

        this.isOpen = true;
        if (categoryId) this.activeCategory = categoryId;
        this.updateScopeLabels();
        this.updateModeButtons();
        this.renderAll();
        this.modal.classList.add("active");
    }

    close() {
        if (this.hasDirty() && !confirm("Há alterações não salvas. Descartar e fechar?")) {
            return;
        }
        this.dirty.global.clear();
        this.dirty.project.clear();
        this.dirty.prompts.clear();
        this.isOpen = false;
        this.modal.classList.remove("active");
    }

    async refresh() {
        // Escopo global lê a resolução SEM projeto (camada global pura);
        // escopo projeto lê com project_id (camadas completas + origem por chave).
        const [globalData, projectData, promptsData] = await Promise.all([
            CapIAuAPI.fetchSettings(null),
            CapIAuAPI.fetchSettings(STATE.currentProjectId),
            CapIAuAPI.fetchPrompts(this.scope === "project" ? STATE.currentProjectId : null)
        ]);
        this.data.global = globalData;
        this.data.project = projectData;
        this.data.prompts = promptsData.prompts;
    }

    hasDirty() {
        return this.dirty.global.size > 0 || this.dirty.project.size > 0 || this.dirty.prompts.size > 0;
    }

    // ── Escopo e modo ────────────────────────────────────────────────────────

    async setScope(scope) {
        if (scope === this.scope) return;
        this.scope = scope;
        this.scopeSelector.querySelectorAll(".scope-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.scope === scope));
        await this.refresh();
        this.renderAll();
    }

    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        localStorage.setItem(MODE_STORAGE_KEY, mode);
        this.updateModeButtons();
        // Categoria ativa pode não existir no novo modo
        this.activeCategory = null;
        this.renderAll();
    }

    updateModeButtons() {
        if (!this.modeSwitch) return;
        this.modeSwitch.querySelectorAll(".mode-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.mode === this.mode));
    }

    updateScopeLabels() {
        const btn = document.getElementById("settings-scope-project-btn");
        if (!btn) return;
        const project = (STATE.allProjects || []).find(p => p.id === STATE.currentProjectId);
        btn.textContent = project ? `Projeto: ${project.name}` : "Projeto atual";
    }

    // ── Filtragem por modo ───────────────────────────────────────────────────

    visibleEntries(categoryId) {
        return this.registry.filter(e => {
            if (e.category !== categoryId) return false;
            if (this.mode === "simple" && e.level !== "simple") return false;
            return true;
        });
    }

    visibleCategories() {
        return this.categories.filter(c => {
            if (c.pro_only && this.mode === "simple") return false;
            if (c.id === "prompts" && this.mode !== "pro") return false;
            if (c.id === "prompts") return true; // Prompts tab handles its own visibility checks
            return this.visibleEntries(c.id).length > 0;
        });
    }

    // ── Renderização ─────────────────────────────────────────────────────────

    renderAll() {
        const cats = this.visibleCategories();
        if (!cats.length) return;
        if (!this.activeCategory || !cats.some(c => c.id === this.activeCategory)) {
            this.activeCategory = cats[0].id;
        }
        this.renderNav(cats);
        this.renderCategory(this.activeCategory);
        this.renderPresets();
        this.updateFooter();
    }

    renderNav(cats) {
        this.navEl.innerHTML = "";
        const dirtyMap = this.dirty[this.scope];
        cats.forEach(cat => {
            const btn = document.createElement("button");
            btn.className = "settings-nav-item" + (cat.id === this.activeCategory ? " active" : "");
            const hasDirty = [...dirtyMap.keys()].some(k => (this.registryMap[k] || {}).category === cat.id) ||
                (cat.id === "prompts" && this.dirty.prompts.size > 0);
            btn.innerHTML = `<i class="fa-solid ${cat.icon}"></i><span>${cat.label}</span>` +
                (hasDirty ? `<span class="nav-dirty-dot"></span>` : "");
            btn.addEventListener("click", () => {
                this.activeCategory = cat.id;
                this.renderNav(this.visibleCategories());
                this.renderCategory(cat.id);
            });
            this.navEl.appendChild(btn);
        });
    }

    renderCategory(categoryId) {
        this.contentEl.innerHTML = "";
        const cat = this.categories.find(c => c.id === categoryId);

        const title = document.createElement("h3");
        title.className = "settings-category-title";
        title.innerHTML = `<i class="fa-solid ${cat.icon}" style="color: var(--color-cyan);"></i> ${cat.label}`;
        this.contentEl.appendChild(title);

        const hint = document.createElement("p");
        hint.className = "settings-scope-hint";
        hint.textContent = this.scope === "project"
            ? "Editando o PROJETO atual: valores definidos aqui sobrepõem os globais só neste projeto. Use ↺ para voltar ao global/padrão."
            : "Editando o padrão GLOBAL: vale para todos os projetos que não tiverem valor próprio. Use ↺ para voltar ao padrão do app.";
        this.contentEl.appendChild(hint);

        if (categoryId === "prompts") {
            this.renderPromptsTab();
            return;
        }

        const entries = this.visibleEntries(categoryId);

        if (!entries.length) {
            const empty = document.createElement("div");
            empty.className = "settings-empty-hint";
            empty.textContent = "Nenhuma configuração nesta categoria para o modo atual.";
            this.contentEl.appendChild(empty);
            return;
        }

        entries.forEach(entry => this.contentEl.appendChild(this.buildRow(entry)));
    }

    renderPromptsTab() {
        if (!this.data.prompts || !this.data.prompts.length) {
            const empty = document.createElement("div");
            empty.className = "settings-empty-hint";
            empty.textContent = "Nenhum prompt disponível.";
            this.contentEl.appendChild(empty);
            return;
        }

        this.data.prompts.forEach(prompt => {
            const group = document.createElement("div");
            group.className = "prompt-group";

            const header = document.createElement("div");
            header.className = "prompt-header";

            const title = document.createElement("div");
            title.className = "prompt-title";
            title.textContent = prompt.label;
            header.appendChild(title);

            const badges = document.createElement("div");
            badges.className = "prompt-badges";

            const isDirty = this.dirty.prompts.has(prompt.id);
            const badge = document.createElement("span");
            if (isDirty) {
                badge.className = "origin-badge origin-unsaved";
                badge.textContent = "não salvo";
            } else {
                badge.className = `origin-badge origin-${prompt.origin}`;
                badge.textContent = { default: "padrão", global: "global", project: "projeto" }[prompt.origin] || prompt.origin;
            }
            badges.appendChild(badge);
            header.appendChild(badges);
            group.appendChild(header);

            if (prompt.variables && Object.keys(prompt.variables).length > 0) {
                const vars = document.createElement("div");
                vars.className = "prompt-variables";
                Object.entries(prompt.variables).forEach(([vname, vdesc]) => {
                    const vrow = document.createElement("div");
                    vrow.innerHTML = `<span>{${vname}}</span> ${vdesc}`;
                    vars.appendChild(vrow);
                });
                group.appendChild(vars);
            }

            const wrapper = document.createElement("div");
            wrapper.className = "prompt-textarea-wrapper";
            const textarea = document.createElement("textarea");
            textarea.className = "settings-prompt-textarea";
            textarea.value = isDirty ? this.dirty.prompts.get(prompt.id) : prompt.value;

            textarea.addEventListener("input", () => {
                const val = textarea.value;
                if (val === prompt.value) {
                    this.dirty.prompts.delete(prompt.id);
                } else {
                    this.dirty.prompts.set(prompt.id, val);
                }
                this.renderNav(this.visibleCategories());
                this.updateFooter();

                const newIsDirty = this.dirty.prompts.has(prompt.id);
                if (newIsDirty) {
                    badge.className = "origin-badge origin-unsaved";
                    badge.textContent = "não salvo";
                } else {
                    badge.className = `origin-badge origin-${prompt.origin}`;
                    badge.textContent = { default: "padrão", global: "global", project: "projeto" }[prompt.origin] || prompt.origin;
                }
            });
            wrapper.appendChild(textarea);
            group.appendChild(wrapper);

            const hasOverride = prompt.origin !== "default";
            if (hasOverride || isDirty) {
                const actions = document.createElement("div");
                actions.className = "prompt-actions";
                const revertBtn = document.createElement("button");
                revertBtn.className = "prompt-btn btn-restore";
                revertBtn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Restaurar padrão`;
                revertBtn.addEventListener("click", async () => {
                    if (isDirty) {
                        this.dirty.prompts.delete(prompt.id);
                        this.renderAll();
                    } else {
                        if (confirm(`Remover personalização de "${prompt.label}" e voltar ao padrão?`)) {
                            try {
                                await CapIAuAPI.deletePromptOverride(prompt.id, this.scope, STATE.currentProjectId);
                                await this.refresh();
                                this.renderAll();
                            } catch (err) {
                                alert(`Erro ao restaurar prompt: ${err.message}`);
                            }
                        }
                    }
                });
                actions.appendChild(revertBtn);
                group.appendChild(actions);
            }

            this.contentEl.appendChild(group);
        });
    }

    resolvedFor(entry) {
        const data = this.scope === "project" ? this.data.project : this.data.global;
        return (data && data.values && data.values[entry.key]) ||
            { value: entry.default, origin: "default", has_global_override: false, has_project_override: false };
    }

    buildRow(entry) {
        const resolved = this.resolvedFor(entry);
        const dirtyMap = this.dirty[this.scope];
        const isDirty = dirtyMap.has(entry.key);
        const globalOnlyInProjectScope = this.scope === "project" && entry.scope === "global";

        const row = document.createElement("div");
        row.className = "setting-row" + (isDirty ? " dirty" : "");
        row.dataset.key = entry.key;

        // ── Coluna de informação ──
        const info = document.createElement("div");
        info.className = "setting-info";

        const label = document.createElement("div");
        label.className = "setting-label";
        label.textContent = entry.label;

        const badge = document.createElement("span");
        if (isDirty) {
            badge.className = "origin-badge origin-unsaved";
            badge.textContent = "não salvo";
        } else {
            badge.className = `origin-badge origin-${resolved.origin}`;
            badge.textContent = { default: "padrão", global: "global", project: "projeto" }[resolved.origin] || resolved.origin;
        }
        label.appendChild(badge);

        if (this.mode === "pro" && entry.help_tech) {
            const techIcon = document.createElement("i");
            techIcon.className = "fa-solid fa-circle-info";
            techIcon.style.cssText = "color: var(--text-muted); font-size: 11px; cursor: help;";
            techIcon.setAttribute("data-tooltip", entry.help_tech);
            label.appendChild(techIcon);
        }
        info.appendChild(label);

        const help = document.createElement("div");
        help.className = "setting-help";
        help.textContent = entry.help;
        info.appendChild(help);

        if (entry.requires_reprocess) {
            const note = document.createElement("div");
            note.className = "setting-reprocess-note";
            note.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Afeta apenas novas análises (mídias já processadas não mudam).`;
            info.appendChild(note);
        }
        if (globalOnlyInProjectScope) {
            const note = document.createElement("div");
            note.className = "setting-reprocess-note";
            note.innerHTML = `<i class="fa-solid fa-globe"></i> Configuração exclusivamente global (edite no escopo Global).`;
            info.appendChild(note);
        }
        row.appendChild(info);

        // ── Coluna de controle ──
        const control = document.createElement("div");
        control.className = "setting-control";
        const currentValue = isDirty ? dirtyMap.get(entry.key) : resolved.value;
        this.buildControl(entry, currentValue, control, globalOnlyInProjectScope);

        // Botão ↺ (remover override do escopo atual)
        const hasOverrideHere = this.scope === "project" ? resolved.has_project_override : resolved.has_global_override;
        if ((hasOverrideHere || isDirty) && !globalOnlyInProjectScope) {
            const revert = document.createElement("button");
            revert.className = "btn-setting-revert";
            revert.innerHTML = `<i class="fa-solid fa-rotate-left"></i>`;
            revert.setAttribute("data-tooltip", isDirty
                ? "Descartar a alteração não salva desta configuração."
                : (this.scope === "project"
                    ? "Remover o valor do projeto (volta a valer o global/padrão)."
                    : "Remover o valor global (volta ao padrão do app)."));
            revert.addEventListener("click", () => this.revertKey(entry.key, isDirty));
            control.appendChild(revert);
        }

        row.appendChild(control);
        return row;
    }

    buildControl(entry, value, container, disabled) {
        const onChange = (v) => this.markDirty(entry.key, v);

        if (entry.type === "bool") {
            const wrap = document.createElement("label");
            wrap.className = "toggle-switch";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = !!value;
            input.disabled = disabled;
            const track = document.createElement("span");
            track.className = "toggle-track";
            input.addEventListener("change", () => onChange(input.checked));
            wrap.appendChild(input);
            wrap.appendChild(track);
            container.appendChild(wrap);

        } else if (entry.type === "int" || entry.type === "float") {
            const range = document.createElement("input");
            range.type = "range";
            range.min = entry.min;
            range.max = entry.max;
            range.step = entry.step || (entry.type === "int" ? 1 : 0.01);
            range.value = value;
            range.disabled = disabled;

            const num = document.createElement("input");
            num.type = "number";
            num.min = entry.min;
            num.max = entry.max;
            num.step = entry.step || (entry.type === "int" ? 1 : 0.01);
            num.value = value;
            num.disabled = disabled;

            const parse = (raw) => {
                let v = entry.type === "int" ? parseInt(raw, 10) : parseFloat(raw);
                if (isNaN(v)) v = entry.default;
                if (entry.min !== undefined && entry.min !== null) v = Math.max(entry.min, v);
                if (entry.max !== undefined && entry.max !== null) v = Math.min(entry.max, v);
                return v;
            };
            range.addEventListener("input", () => { num.value = range.value; });
            range.addEventListener("change", () => onChange(parse(range.value)));
            range.addEventListener("dblclick", () => {
                if (disabled) return;
                const defVal = entry.default;
                range.value = defVal;
                num.value = defVal;
                onChange(defVal);
            });
            num.addEventListener("change", () => {
                const v = parse(num.value);
                num.value = v;
                range.value = v;
                onChange(v);
            });
            container.appendChild(range);
            container.appendChild(num);

        } else if (entry.type === "enum") {
            const select = document.createElement("select");
            select.className = "nle-select";
            select.disabled = disabled;
            (entry.enum || []).forEach(opt => {
                const o = document.createElement("option");
                o.value = opt;
                o.textContent = this.enumLabel(entry.key, opt);
                select.appendChild(o);
            });
            select.value = value;
            select.addEventListener("change", () => onChange(select.value));
            container.appendChild(select);

        } else if (entry.type === "secret") {
            const input = document.createElement("input");
            input.type = "password";
            input.autocomplete = "off";
            // O valor real nunca chega ao cliente: o GET retorna a máscara,
            // exibida como placeholder. Só é gravado se o usuário digitar algo.
            input.placeholder = value ? `${value} (salva — digite para trocar)` : "Não configurada (usando a do .env, se houver)";
            input.disabled = disabled;
            input.addEventListener("change", () => {
                const v = input.value.trim();
                if (v) onChange(v);
            });
            container.appendChild(input);

            const clearBtn = document.createElement("button");
            clearBtn.className = "btn-setting-revert";
            clearBtn.style.width = "auto";
            clearBtn.style.padding = "0 8px";
            clearBtn.style.fontSize = "10px";
            clearBtn.textContent = "Limpar";
            clearBtn.setAttribute("data-tooltip", "Apagar a chave salva no app e voltar a usar a do arquivo .env.");
            clearBtn.disabled = disabled;
            clearBtn.addEventListener("click", async () => {
                if (!confirm(`Apagar a chave salva de "${entry.label}" e voltar ao .env?`)) return;
                try {
                    await CapIAuAPI.resetSettings("global", null, [entry.key]);
                    this.dirty.global.delete(entry.key);
                    await this.refresh();
                    this.renderAll();
                } catch (err) {
                    alert(`Falha ao limpar a chave: ${err.message}`);
                }
            });
            container.appendChild(clearBtn);

        } else { // string
            const input = document.createElement("input");
            input.type = "text";
            input.value = value ?? "";
            input.disabled = disabled;
            input.addEventListener("change", () => onChange(input.value.trim()));
            container.appendChild(input);
        }
    }

    enumLabel(key, opt) {
        if (key === "asr.language") {
            return { pt: "Português", en: "Inglês", es: "Espanhol" }[opt] || opt;
        }
        if (key === "timeline.default_persona") {
            return {
                montadora: "Montadora", diretora: "Diretora",
                sound_designer: "Sound Designer", colorista: "Colorista"
            }[opt] || opt;
        }
        return opt;
    }

    // ── Dirty-state / salvar / descartar ─────────────────────────────────────

    markDirty(key, value) {
        const entry = this.registryMap[key];
        const resolved = this.resolvedFor(entry);
        const dirtyMap = this.dirty[this.scope];
        // Voltou ao valor exibido originalmente (não-secret): deixa de estar sujo
        if (entry.type !== "secret" && value === resolved.value) {
            dirtyMap.delete(key);
        } else {
            dirtyMap.set(key, value);
        }
        this.renderNav(this.visibleCategories());
        this.renderCategory(this.activeCategory);
        this.updateFooter();
    }

    async revertKey(key, isDirtyOnly) {
        const dirtyMap = this.dirty[this.scope];
        if (isDirtyOnly) {
            dirtyMap.delete(key);
            this.renderNav(this.visibleCategories());
            this.renderCategory(this.activeCategory);
            this.updateFooter();
            return;
        }
        try {
            await CapIAuAPI.resetSettings(this.scope, STATE.currentProjectId, [key]);
            dirtyMap.delete(key);
            await this.refresh();
            this.renderAll();
            STATE.emit("settingsChanged", { scope: this.scope });
        } catch (err) {
            alert(`Falha ao restaurar: ${err.message}`);
        }
    }

    async save() {
        const dirtyMap = this.dirty[this.scope];
        const hasSettingsChanges = dirtyMap.size > 0;
        const hasPromptsChanges = this.dirty.prompts.size > 0;

        if (!hasSettingsChanges && !hasPromptsChanges) return;

        this.btnSave.disabled = true;
        try {
            if (hasSettingsChanges) {
                const values = Object.fromEntries(dirtyMap.entries());
                if (this.scope === "project") {
                    await CapIAuAPI.updateProjectSettings(STATE.currentProjectId, values);
                } else {
                    await CapIAuAPI.updateGlobalSettings(values);
                }
                dirtyMap.clear();
            }

            if (hasPromptsChanges) {
                for (const [promptId, template] of this.dirty.prompts.entries()) {
                    await CapIAuAPI.updatePrompt(promptId, template, this.scope, STATE.currentProjectId);
                }
                this.dirty.prompts.clear();
            }

            await this.refresh();
            this.renderAll();
            STATE.emit("settingsChanged", { scope: this.scope });
        } catch (err) {
            alert(`Falha ao salvar configurações/prompts: ${err.message}`);
        } finally {
            this.btnSave.disabled = !this.hasDirty();
            this.updateFooter();
        }
    }

    discard() {
        this.dirty[this.scope].clear();
        this.dirty.prompts.clear();
        this.renderAll();
    }

    updateFooter() {
        const nSettings = this.dirty[this.scope].size;
        const nPrompts = this.dirty.prompts.size;
        const n = nSettings + nPrompts;
        this.dirtyCountEl.textContent = n
            ? `${n} alteração${n > 1 ? "ões" : ""} não salva${n > 1 ? "s" : ""} (${this.scope === "project" ? "projeto" : "global"})`
            : "";
        this.btnSave.disabled = !n;
        this.btnDiscard.disabled = !n;
    }

    // ── Presets ──────────────────────────────────────────────────────────────

    renderPresets() {
        this.presetsEl.innerHTML = "";
        const data = this.scope === "project" ? this.data.project : this.data.global;
        const active = data ? data.active_preset : null;

        const label = document.createElement("span");
        label.className = "settings-dirty-count";
        label.textContent = "Preset:";
        this.presetsEl.appendChild(label);

        Object.entries(this.presetsMeta).forEach(([pid, meta]) => {
            const chip = document.createElement("button");
            chip.className = "preset-chip" + (active === pid ? " active" : "");
            chip.textContent = meta.label;
            chip.setAttribute("data-tooltip", meta.description);
            chip.addEventListener("click", () => this.applyPreset(pid, meta.label));
            this.presetsEl.appendChild(chip);
        });

        if (active === "custom") {
            const chip = document.createElement("button");
            chip.className = "preset-chip preset-custom active";
            chip.textContent = "Personalizado";
            chip.setAttribute("data-tooltip", "Os valores atuais não correspondem a nenhum preset.");
            this.presetsEl.appendChild(chip);
        }
    }

    async applyPreset(presetId, presetLabel) {
        const scopeLabel = this.scope === "project" ? "no projeto atual" : "como padrão global";
        if (!confirm(`Aplicar o preset "${presetLabel}" ${scopeLabel}? Isso ajusta várias configurações de uma vez.`)) return;
        try {
            await CapIAuAPI.applySettingsPreset(
                presetId,
                this.scope,
                this.scope === "project" ? STATE.currentProjectId : null
            );
            // Alterações pendentes das chaves cobertas perdem sentido após o preset
            this.dirty[this.scope].clear();
            await this.refresh();
            this.renderAll();
            STATE.emit("settingsChanged", { scope: this.scope });
        } catch (err) {
            alert(`Falha ao aplicar preset: ${err.message}`);
        }
    }
}
