// fontCatalogModal.js - Modal Visual de Catálogo de Fontes, Specimen por Clima e Brand Kit do Projeto
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";
import {
    FONT_MOODS,
    CURATED_FONTS,
    ensureFontLoaded,
    querySystemFonts,
    loadUserFontFile,
    getProjectBrandKit,
    saveProjectBrandKit,
    applyBrandKitToClip
} from "./fontManager.js";

export class FontCatalogModal {
    constructor() {
        this.isOpen = false;
        this.activeTab = "catalog"; // "catalog" | "brandkit"
        this.selectedMood = "all";
        this.searchQuery = "";
        this.previewSampleText = "CapIAu Talho: A Arte do Corte";
        this.targetClipId = null;
        this.systemFonts = [];
        this.modalEl = null;
    }

    open(targetClipId = null, initialTab = "catalog") {
        this.targetClipId = targetClipId;
        this.activeTab = initialTab;
        this.isOpen = true;
        this.render();
    }

    close() {
        this.isOpen = false;
        if (this.modalEl && this.modalEl.parentNode) {
            this.modalEl.parentNode.removeChild(this.modalEl);
        }
        this.modalEl = null;
    }

    async loadSystemFonts() {
        this.systemFonts = await querySystemFonts();
        this.render();
        if (typeof window !== "undefined" && typeof window.showToast === "function") {
            window.showToast(`${this.systemFonts.length} fontes locais do sistema carregadas!`, "success");
        }
    }

    render() {
        if (!this.modalEl) {
            this.modalEl = document.createElement("div");
            this.modalEl.id = "font-catalog-modal-overlay";
            this.modalEl.className = "nle-modal-overlay";
            this.modalEl.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;";
            document.body.appendChild(this.modalEl);
        }

        const brandKit = getProjectBrandKit();

        // Combina fontes curadas, customizadas e do sistema
        const customFonts = (STATE.projectData && STATE.projectData.custom_fonts) || [];
        const allAvailableFonts = [...CURATED_FONTS, ...customFonts, ...this.systemFonts];

        // Filtro por clima e busca
        const filteredFonts = allAvailableFonts.filter(font => {
            const matchesMood = this.selectedMood === "all" || font.mood === this.selectedMood || font.category === "local" || font.category === "custom";
            const matchesSearch = !this.searchQuery || font.name.toLowerCase().includes(this.searchQuery.toLowerCase()) || (font.mood && font.mood.toLowerCase().includes(this.searchQuery.toLowerCase()));
            return matchesMood && matchesSearch;
        });

        // Carrega fontes visíveis
        filteredFonts.slice(0, 15).forEach(f => {
            if (f.isGoogle) ensureFontLoaded(f.id);
        });

        this.modalEl.innerHTML = `
            <div class="nle-modal-container" style="background: var(--bg-glass-active, #181524); border: 1px solid var(--border-glass); border-radius: 8px; width: 900px; max-width: 95vw; height: 680px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: var(--shadow-premium); overflow: hidden;">
                <!-- Header -->
                <div style="padding: 14px 18px; border-bottom: 1px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fa-solid fa-font" style="color: #f59e0b; font-size: 16px;"></i>
                        <h2 style="font-size: 14px; font-weight: 700; color: #fff; margin: 0;">Tipografia, Moods & Brand Kit</h2>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div class="media-tabs" style="border: none; gap: 4px;">
                            <button id="btn-font-tab-catalog" class="tab-btn ${this.activeTab === 'catalog' ? 'active' : ''}" style="padding: 4px 12px; font-size: 11px;"><i class="fa-solid fa-swatchbook"></i> Catálogo & Moods</button>
                            <button id="btn-font-tab-brandkit" class="tab-btn ${this.activeTab === 'brandkit' ? 'active' : ''}" style="padding: 4px 12px; font-size: 11px;"><i class="fa-solid fa-palette"></i> Brand Kit do Projeto</button>
                        </div>
                        <button id="btn-close-font-modal" class="btn-flat-action" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px 8px; font-size: 14px;"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>

                <!-- Conteúdo da Aba: Catálogo & Moods -->
                <div id="font-tab-content-catalog" style="display: ${this.activeTab === 'catalog' ? 'flex' : 'none'}; flex: 1; flex-direction: column; overflow: hidden;">
                    <!-- Toolbar Superior: Moods, Busca e Upload -->
                    <div style="padding: 10px 18px; border-bottom: 1px solid var(--border-glass); display: flex; flex-direction: column; gap: 10px; background: rgba(0,0,0,0.12);">
                        <!-- Pílulas de Clima / Mood -->
                        <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;">
                            ${FONT_MOODS.map(m => `
                                <button class="mood-pill-btn ${this.selectedMood === m.id ? 'active' : ''}" data-mood="${m.id}" style="padding: 4px 10px; font-size: 10.5px; border-radius: 20px; border: 1px solid ${this.selectedMood === m.id ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.selectedMood === m.id ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.03)'}; color: ${this.selectedMood === m.id ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap; display: flex; align-items: center; gap: 6px; transition: all 0.15s;">
                                    <i class="${m.icon}" style="font-size: 9px; color: ${this.selectedMood === m.id ? 'var(--color-cyan)' : 'var(--text-muted)'};"></i>
                                    ${m.label}
                                </button>
                            `).join('')}
                        </div>

                        <!-- Barra de Ações Rápidas & Busca -->
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <div class="search-area glassmorphism" style="flex: 1; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px;">
                                <i class="fa-solid fa-magnifying-glass" style="color: var(--text-muted); font-size: 11px;"></i>
                                <input type="text" id="font-search-input" placeholder="Buscar por nome de fonte ou estilo..." value="${this.searchQuery}" style="flex: 1; background: transparent; border: none; outline: none; font-size: 11px; color: #fff;">
                            </div>
                            <input type="text" id="font-sample-input" placeholder="Texto de amostra..." value="${this.previewSampleText}" style="width: 220px; height: 30px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 4px; padding: 0 8px; font-size: 11px; color: #e2e8f0; outline: none;">
                            
                            <button id="btn-load-system-fonts" class="lib-action-btn" title="Detectar fontes instaladas no sistema operacional (queryLocalFonts)" style="display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; font-size: 10.5px; color: var(--color-cyan);">
                                <i class="fa-solid fa-desktop"></i> Fontes do PC
                            </button>
                            
                            <label class="lib-action-btn" title="Fazer upload de arquivo de fonte (.ttf, .otf, .woff2)" style="display: flex; align-items: center; gap: 6px; padding: 0 10px; height: 30px; font-size: 10.5px; color: var(--color-violet); cursor: pointer;">
                                <i class="fa-solid fa-file-arrow-up"></i> Upload (.ttf)
                                <input type="file" id="font-file-upload" accept=".ttf,.otf,.woff2,.woff" style="display: none;">
                            </label>
                        </div>
                    </div>

                    <!-- Grid de Specimens de Fontes -->
                    <div style="flex: 1; overflow-y: auto; padding: 16px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; align-content: flex-start;">
                        ${filteredFonts.length === 0 ? `
                            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted); font-size: 12px;">
                                Nenhuma fonte encontrada para o filtro selecionado.
                            </div>
                        ` : filteredFonts.map(font => `
                            <div class="font-specimen-card" data-font-id="${font.id}" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; cursor: pointer; transition: all 0.2s;">
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <span style="font-size: 12px; font-weight: 700; color: #fff;">${font.name}</span>
                                        <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-muted); text-transform: uppercase;">${font.category}</span>
                                    </div>
                                    <div style="font-family: '${font.id}', sans-serif; font-size: 18px; color: var(--text-primary); line-height: 1.3; min-height: 48px; word-break: break-word;">
                                        ${this.previewSampleText || font.specimen}
                                    </div>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-glass); padding-top: 8px; margin-top: 4px;">
                                    <span style="font-size: 9px; color: var(--text-muted);">${font.weights ? font.weights.length + ' pesos' : 'Normal'}</span>
                                    <div style="display: flex; gap: 6px;">
                                        <button class="btn-select-font-clip" data-font-id="${font.id}" title="Aplicar ao clipe selecionado" style="font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(6,182,212,0.4); background: rgba(6,182,212,0.1); color: var(--color-cyan); cursor: pointer;">
                                            Aplicar
                                        </button>
                                        <button class="btn-set-brandkit-font" data-font-id="${font.id}" title="Definir como fonte padrão no Brand Kit" style="font-size: 10px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-glass); background: transparent; color: var(--text-secondary); cursor: pointer;">
                                            <i class="fa-solid fa-star"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- Conteúdo da Aba: Brand Kit do Projeto -->
                <div id="font-tab-content-brandkit" style="display: ${this.activeTab === 'brandkit' ? 'flex' : 'none'}; flex: 1; flex-direction: column; overflow-y: auto; padding: 20px 24px; gap: 20px;">
                    <div style="background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.25); border-radius: 6px; padding: 12px 16px; font-size: 11.5px; color: #fde047; line-height: 1.5; display: flex; gap: 12px; align-items: center;">
                        <i class="fa-solid fa-wand-magic-sparkles" style="font-size: 18px; color: #f59e0b;"></i>
                        <div>
                            <strong>Guia Tipográfico & Visual do Projeto:</strong> As regras do Brand Kit guiam a Inteligência Artificial e a criação de novos títulos, mantendo a consistência visual em todo o corte. Você tem liberdade total para alterar qualquer elemento a qualquer momento.
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <!-- Coluna 1: Tipografia Oficial -->
                        <div style="display: flex; flex-direction: column; gap: 14px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-glass); border-radius: 6px; padding: 16px;">
                            <h3 style="font-size: 12px; font-weight: 700; color: var(--color-cyan); margin: 0; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fa-solid fa-font"></i> Tipografia Oficial</h3>
                            
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-size: 11px; color: var(--text-secondary);">Fonte de Títulos & Cartelas de Capítulo</label>
                                <select id="bk-title-font" class="nle-select" style="padding: 6px 8px; font-size: 11px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 4px; color: #fff;">
                                    ${CURATED_FONTS.map(f => `<option value="${f.id}" ${f.id === brandKit.titleFont ? 'selected' : ''}>${f.name} (${f.mood})</option>`).join('')}
                                </select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-size: 11px; color: var(--text-secondary);">Fonte de Corpo, Depoimentos & GCs</label>
                                <select id="bk-body-font" class="nle-select" style="padding: 6px 8px; font-size: 11px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 4px; color: #fff;">
                                    ${CURATED_FONTS.map(f => `<option value="${f.id}" ${f.id === brandKit.bodyFont ? 'selected' : ''}>${f.name} (${f.mood})</option>`).join('')}
                                </select>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                <label style="font-size: 11px; color: var(--text-secondary);">Alinhamento Padrão</label>
                                <select id="bk-alignment" class="nle-select" style="padding: 6px 8px; font-size: 11px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 4px; color: #fff;">
                                    <option value="left" ${brandKit.defaultAlignment === 'left' ? 'selected' : ''}>À Esquerda (Documentário / TV)</option>
                                    <option value="center" ${brandKit.defaultAlignment === 'center' ? 'selected' : ''}>Centralizado (Cinema / Clássico)</option>
                                    <option value="right" ${brandKit.defaultAlignment === 'right' ? 'selected' : ''}>À Direita</option>
                                </select>
                            </div>
                        </div>

                        <!-- Coluna 2: Paleta de Cores & Caixa -->
                        <div style="display: flex; flex-direction: column; gap: 14px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-glass); border-radius: 6px; padding: 16px;">
                            <h3 style="font-size: 12px; font-weight: 700; color: #f59e0b; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fa-solid fa-palette"></i> Cores & Caixa de Fundo</h3>

                            <div style="display: flex; gap: 12px; align-items: center;">
                                <label style="flex: 1; font-size: 11px; color: var(--text-secondary);">Cor Principal do Texto</label>
                                <input type="color" id="bk-color-text" value="${brandKit.textColor}" style="width: 32px; height: 32px; border: none; background: transparent; cursor: pointer;">
                            </div>

                            <div style="display: flex; gap: 12px; align-items: center;">
                                <label style="flex: 1; font-size: 11px; color: var(--text-secondary);">Cor de Destaque / Acentos</label>
                                <input type="color" id="bk-color-accent" value="${brandKit.accentColor}" style="width: 32px; height: 32px; border: none; background: transparent; cursor: pointer;">
                            </div>

                            <div style="display: flex; gap: 12px; align-items: center;">
                                <label style="flex: 1; font-size: 11px; color: var(--text-secondary);">Cor do Box de Fundo</label>
                                <input type="color" id="bk-color-bg" value="${brandKit.backgroundColor.startsWith('#') ? brandKit.backgroundColor : '#000000'}" style="width: 32px; height: 32px; border: none; background: transparent; cursor: pointer;">
                            </div>

                            <div style="display: flex; gap: 12px; align-items: center;">
                                <label style="flex: 1; font-size: 11px; color: var(--text-secondary);">Curva Easing de Animação</label>
                                <select id="bk-easing" class="nle-select" style="padding: 4px 6px; font-size: 10.5px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-glass); border-radius: 4px; color: #fff;">
                                    <option value="easeOutCubic" ${brandKit.defaultEasing === 'easeOutCubic' ? 'selected' : ''}>Suave (Ease Out Cubic)</option>
                                    <option value="easeInOutQuad" ${brandKit.defaultEasing === 'easeInOutQuad' ? 'selected' : ''}>Harmônico (Ease In Out)</option>
                                    <option value="spring" ${brandKit.defaultEasing === 'spring' ? 'selected' : ''}>Elástico / Mola (Spring)</option>
                                    <option value="linear" ${brandKit.defaultEasing === 'linear' ? 'selected' : ''}>Linear (Constante)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- Ações do Brand Kit -->
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-glass); padding-top: 16px; margin-top: auto;">
                        <button id="btn-apply-brandkit-all" class="btn-secondary" style="height: 32px; font-size: 11px; font-weight: 600; padding: 0 14px; border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.08); color: #f59e0b; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-wand-magic"></i> Padronizar Todos os Textos da Timeline
                        </button>
                        <button id="btn-save-brandkit" class="btn-primary" style="height: 32px; font-size: 11px; font-weight: 700; padding: 0 18px; border: none; background: var(--color-cyan); color: #000; cursor: pointer; border-radius: 4px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-check"></i> Salvar Brand Kit do Projeto
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        if (!this.modalEl) return;

        // Fechar Modal
        const btnClose = this.modalEl.querySelector("#btn-close-font-modal");
        if (btnClose) btnClose.onclick = () => this.close();

        this.modalEl.onclick = (e) => {
            if (e.target === this.modalEl) this.close();
        };

        // Troca de abas
        const tabCatalog = this.modalEl.querySelector("#btn-font-tab-catalog");
        const tabBrandkit = this.modalEl.querySelector("#btn-font-tab-brandkit");
        if (tabCatalog) tabCatalog.onclick = () => { this.activeTab = "catalog"; this.render(); };
        if (tabBrandkit) tabBrandkit.onclick = () => { this.activeTab = "brandkit"; this.render(); };

        // Filtro por Mood
        this.modalEl.querySelectorAll(".mood-pill-btn").forEach(btn => {
            btn.onclick = () => {
                this.selectedMood = btn.dataset.mood;
                this.render();
            };
        });

        // Campo de busca
        const searchInput = this.modalEl.querySelector("#font-search-input");
        if (searchInput) {
            searchInput.oninput = (e) => {
                this.searchQuery = e.target.value;
                this.render();
                const freshInput = this.modalEl.querySelector("#font-search-input");
                if (freshInput) {
                    freshInput.focus();
                    freshInput.selectionStart = freshInput.selectionEnd = freshInput.value.length;
                }
            };
        }

        // Campo de texto de amostra
        const sampleInput = this.modalEl.querySelector("#font-sample-input");
        if (sampleInput) {
            sampleInput.oninput = (e) => {
                this.previewSampleText = e.target.value;
                this.render();
            };
        }

        // Botão fontes do PC
        const btnSysFonts = this.modalEl.querySelector("#btn-load-system-fonts");
        if (btnSysFonts) {
            btnSysFonts.onclick = () => this.loadSystemFonts();
        }

        // Upload de fonte customizada
        const fileUpload = this.modalEl.querySelector("#font-file-upload");
        if (fileUpload) {
            fileUpload.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    try {
                        const loaded = await loadUserFontFile(file);
                        this.render();
                        if (typeof window !== "undefined" && typeof window.showToast === "function") {
                            window.showToast(`Fonte "${loaded.name}" instalada no projeto!`, "success");
                        }
                    } catch (err) {
                        alert("Não foi possível carregar o arquivo de fonte. Use .ttf, .otf ou .woff2.");
                    }
                }
            };
        }

        // Aplicar fonte ao clipe selecionado
        this.modalEl.querySelectorAll(".btn-select-font-clip").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const fontId = btn.dataset.fontId;
                ensureFontLoaded(fontId);

                const clipId = this.targetClipId || TIMELINE_STATE.selectedClipId;
                if (clipId) {
                    TIMELINE_HISTORY.begin();
                    const cuts = [...STATE.activeTimelineCuts];
                    const targetClip = cuts.find(c => c.id === clipId);
                    if (targetClip) {
                        targetClip.fontFamily = fontId;
                        STATE.activeTimelineCuts = cuts;
                        TIMELINE_HISTORY.commit();
                        STATE.emit("timelineCutsUpdated", cuts);
                        if (typeof window !== "undefined" && typeof window.showToast === "function") {
                            window.showToast(`Fonte "${fontId}" aplicada ao clipe!`, "success");
                        }
                    }
                }
                this.close();
            };
        });

        // Salvar Brand Kit
        const btnSaveBk = this.modalEl.querySelector("#btn-save-brandkit");
        if (btnSaveBk) {
            btnSaveBk.onclick = () => {
                const titleFont = this.modalEl.querySelector("#bk-title-font").value;
                const bodyFont = this.modalEl.querySelector("#bk-body-font").value;
                const alignment = this.modalEl.querySelector("#bk-alignment").value;
                const textColor = this.modalEl.querySelector("#bk-color-text").value;
                const accentColor = this.modalEl.querySelector("#bk-color-accent").value;
                const bgColor = this.modalEl.querySelector("#bk-color-bg").value;
                const easing = this.modalEl.querySelector("#bk-easing").value;

                saveProjectBrandKit({
                    titleFont,
                    bodyFont,
                    defaultAlignment: alignment,
                    textColor,
                    accentColor,
                    backgroundColor: bgColor,
                    defaultEasing: easing
                });

                if (typeof window !== "undefined" && typeof window.showToast === "function") {
                    window.showToast("Brand Kit do Projeto salvo com sucesso!", "success");
                }
                this.close();
            };
        }

        // Padronizar todos os textos da timeline
        const btnApplyAll = this.modalEl.querySelector("#btn-apply-brandkit-all");
        if (btnApplyAll) {
            btnApplyAll.onclick = () => {
                const bk = getProjectBrandKit();
                TIMELINE_HISTORY.begin();
                const cuts = [...STATE.activeTimelineCuts];
                let count = 0;

                cuts.forEach(c => {
                    if (c.type === "text") {
                        applyBrandKitToClip(c, c.textCategory || "lower_third");
                        count++;
                    }
                });

                STATE.activeTimelineCuts = cuts;
                TIMELINE_HISTORY.commit();
                STATE.emit("timelineCutsUpdated", cuts);

                if (typeof window !== "undefined" && typeof window.showToast === "function") {
                    window.showToast(`Brand Kit aplicado a ${count} texto(s) na timeline!`, "success");
                }
                this.close();
            };
        }
    }
}

// Instância singleton global
export const FONT_MODAL = new FontCatalogModal();
