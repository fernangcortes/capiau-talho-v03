// titlesTab.js - Painel de Biblioteca de Títulos, Presets Visuais e Sugestões da IA (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE } from "./timelineState.js";
import { TEXT_PRESETS, createTextClipFromPreset } from "./textPresets.js";
import { TEXT_AI_ENGINE } from "./textAIEngine.js";
import { FONT_MODAL } from "./fontCatalogModal.js";
import { CREDITS_NORMALIZER } from "./creditsNormalizer.js";

export class TitlesTabManager {
    constructor() {
        this.activeFilter = "all"; // "all" | "lower_third" | "subtitle" | "chapter" | "quote" | "title"
        this.containerEl = null;
    }

    init() {
        this.containerEl = document.getElementById("tab-titles");
        if (!this.containerEl) return;

        this.render();

        // Reage a mudanças de sugestão da IA no playhead
        TEXT_AI_ENGINE.onSuggestion(() => this.renderAISuggestionCard());
        STATE.on("textAIReactiveToggled", () => this.renderAISuggestionCard());
    }

    setFilter(category) {
        this.activeFilter = category;
        this.renderPresetsGrid();
    }

    render() {
        if (!this.containerEl) return;

        this.containerEl.innerHTML = `
            <div class="titles-panel-content" style="padding: 12px; display: flex; flex-direction: column; gap: 12px; height: 100%; box-sizing: border-box; overflow-y: auto;">
                
                <!-- Ações Rápidas: Fontes, Brand Kit e Ficha Técnica -->
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <button id="btn-tab-open-fonts" class="lib-action-btn" title="Explorar 24 fontes por clima / mood, fontes locais e upload" style="flex: 1; height: 28px; font-size: 10.5px; display: flex; align-items: center; justify-content: center; gap: 6px; color: #f59e0b; border-color: rgba(245,158,11,0.3); background: rgba(245,158,11,0.06);">
                        <i class="fa-solid fa-swatchbook"></i> Fontes & Moods
                    </button>
                    <button id="btn-tab-open-brandkit" class="lib-action-btn" title="Configurar regras visuais e padronização do projeto" style="flex: 1; height: 28px; font-size: 10.5px; display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--color-cyan); border-color: rgba(6,182,212,0.3); background: rgba(6,182,212,0.06);">
                        <i class="fa-solid fa-palette"></i> Brand Kit
                    </button>
                    <button id="btn-tab-open-credits" class="lib-action-btn" title="Gerenciar nomes oficiais e cargos da equipe e personagens" style="flex: 1; height: 28px; font-size: 10.5px; display: flex; align-items: center; justify-content: center; gap: 6px; color: #10b981; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.06);">
                        <i class="fa-solid fa-address-book"></i> Ficha Técnica
                    </button>
                </div>

                <!-- Card de Sugestão Reativa da IA (Playhead) -->
                <div id="text-ai-suggestion-box"></div>

                <!-- Botão Adicionar Texto Rápido -->
                <button id="btn-quick-add-default-text" class="btn-primary" style="height: 32px; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #f59e0b, #d97706); color: #000; border-radius: 4px; box-shadow: 0 4px 12px rgba(245,158,11,0.25);">
                    <i class="fa-solid fa-plus"></i> Inserir Título na Agulha (Ctrl+T)
                </button>

                <!-- Filtros da Biblioteca de Presets -->
                <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px;">Biblioteca de Presets (15)</span>
                    </div>

                    <div style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px;">
                        <button class="preset-filter-pill ${this.activeFilter === 'all' ? 'active' : ''}" data-filter="all" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'all' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'all' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'all' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Todos</button>
                        <button class="preset-filter-pill ${this.activeFilter === 'lower_third' ? 'active' : ''}" data-filter="lower_third" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'lower_third' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'lower_third' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'lower_third' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Lower Thirds (GC)</button>
                        <button class="preset-filter-pill ${this.activeFilter === 'subtitle' ? 'active' : ''}" data-filter="subtitle" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'subtitle' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'subtitle' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'subtitle' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Legendas</button>
                        <button class="preset-filter-pill ${this.activeFilter === 'chapter' ? 'active' : ''}" data-filter="chapter" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'chapter' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'chapter' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'chapter' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Capítulos</button>
                        <button class="preset-filter-pill ${this.activeFilter === 'quote' ? 'active' : ''}" data-filter="quote" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'quote' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'quote' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'quote' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Citações</button>
                        <button class="preset-filter-pill ${this.activeFilter === 'title' ? 'active' : ''}" data-filter="title" style="padding: 3px 8px; font-size: 10px; border-radius: 12px; border: 1px solid ${this.activeFilter === 'title' ? 'var(--color-cyan)' : 'var(--border-glass)'}; background: ${this.activeFilter === 'title' ? 'rgba(6,182,212,0.15)' : 'transparent'}; color: ${this.activeFilter === 'title' ? '#fff' : 'var(--text-secondary)'}; cursor: pointer; white-space: nowrap;">Títulos</button>
                    </div>
                </div>

                <!-- Grid de Presets Visuais -->
                <div id="titles-presets-grid" style="display: flex; flex-direction: column; gap: 8px;"></div>
            </div>
        `;

        this.bindEvents();
        this.renderAISuggestionCard();
        this.renderPresetsGrid();
    }

    renderAISuggestionCard() {
        const box = this.containerEl ? this.containerEl.querySelector("#text-ai-suggestion-box") : null;
        if (!box) return;

        const isReactive = TEXT_AI_ENGINE.reactiveEnabled;
        const suggestion = TEXT_AI_ENGINE.currentPlayheadSuggestion;

        if (!isReactive) {
            box.innerHTML = `
                <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-glass); border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 10.5px; color: var(--text-muted);"><i class="fa-solid fa-bolt" style="color: var(--text-muted);"></i> Reatividade da IA desativada</span>
                    <button id="btn-toggle-text-ai" class="btn-flat-action" style="font-size: 10px; color: var(--color-cyan); background: none; border: none; cursor: pointer; text-decoration: underline;">Ativar</button>
                </div>
            `;
            const btnTog = box.querySelector("#btn-toggle-text-ai");
            if (btnTog) btnTog.onclick = () => TEXT_AI_ENGINE.setReactiveEnabled(true);
            return;
        }

        if (suggestion) {
            box.innerHTML = `
                <div style="background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.35); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 15px rgba(245,158,11,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 10px; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Sugestão da IA (Playhead)
                        </span>
                        <button id="btn-toggle-text-ai" title="Desativar reatividade da IA" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px;"><i class="fa-solid fa-power-off"></i></button>
                    </div>
                    <div style="font-size: 11.5px; color: #fff; font-weight: 600;">
                        ${suggestion.title} <span style="font-size: 10.5px; color: var(--color-cyan); font-weight: 400;">(${suggestion.subtitle})</span>
                    </div>
                    <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.3;">
                        ${suggestion.reason}
                    </div>
                    <button id="btn-apply-ai-suggestion" class="btn-primary" style="height: 26px; font-size: 10.5px; font-weight: 700; padding: 0 10px; background: #f59e0b; color: #000; border-radius: 4px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <i class="fa-solid fa-check"></i> ${suggestion.actionLabel || 'Inserir na Timeline'}
                    </button>
                </div>
            `;

            const btnApply = box.querySelector("#btn-apply-ai-suggestion");
            if (btnApply) {
                btnApply.onclick = () => {
                    TEXT_AI_ENGINE.insertSuggestion(suggestion);
                };
            }

            const btnTog = box.querySelector("#btn-toggle-text-ai");
            if (btnTog) btnTog.onclick = () => TEXT_AI_ENGINE.setReactiveEnabled(false);

        } else {
            box.innerHTML = `
                <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-glass); border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 10.5px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-wand-magic" style="color: var(--color-cyan);"></i> IA ativa na agulha</span>
                    <button id="btn-toggle-text-ai" title="Pausar reatividade automática" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 11px;"><i class="fa-solid fa-toggle-on" style="color: var(--color-cyan);"></i></button>
                </div>
            `;
            const btnTog = box.querySelector("#btn-toggle-text-ai");
            if (btnTog) btnTog.onclick = () => TEXT_AI_ENGINE.setReactiveEnabled(false);
        }
    }

    renderPresetsGrid() {
        const grid = this.containerEl ? this.containerEl.querySelector("#titles-presets-grid") : null;
        if (!grid) return;

        const filtered = TEXT_PRESETS.filter(p => this.activeFilter === "all" || p.category === this.activeFilter);

        grid.innerHTML = filtered.map(preset => `
            <div class="preset-card-item" data-preset-id="${preset.id}" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-glass); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; transition: all 0.15s;" onmouseover="this.style.borderColor='rgba(6,182,212,0.4)'; this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.borderColor='var(--border-glass)'; this.style.background='rgba(255,255,255,0.02)'">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 11.5px; font-weight: 700; color: #fff;">${preset.name}</span>
                    <span style="font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(245,158,11,0.1); color: #f59e0b; text-transform: uppercase;">${preset.category}</span>
                </div>
                
                <!-- Amostra Visual do Preset -->
                <div style="background: #0a0810; border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; padding: 8px 10px; font-family: '${preset.fontFamily}', sans-serif; color: ${preset.color}; font-size: 13px; line-height: 1.2; text-align: ${preset.alignment}; letter-spacing: ${preset.tracking}px;">
                    <div>${preset.name}</div>
                    <div style="font-size: 9.5px; opacity: 0.7; margin-top: 2px;">Subtítulo & Função de Exemplo</div>
                </div>

                <div style="font-size: 9.5px; color: var(--text-muted); line-height: 1.3;">
                    ${preset.description}
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-glass); padding-top: 6px; margin-top: 2px;">
                    <span style="font-size: 9px; color: var(--text-muted);">${preset.fontFamily} &middot; ${preset.defaultDurationS}s</span>
                    <button class="btn-insert-preset-clip" data-preset-id="${preset.id}" style="font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 4px; border: 1px solid rgba(6,182,212,0.4); background: rgba(6,182,212,0.12); color: var(--color-cyan); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-plus"></i> Inserir
                    </button>
                </div>
            </div>
        `).join('');

        // Listeners de inserção de preset
        grid.querySelectorAll(".btn-insert-preset-clip").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const presetId = btn.dataset.presetId;
                TEXT_AI_ENGINE.insertSuggestion({
                    presetId: presetId,
                    title: "Novo Título",
                    subtitle: "Subtexto / Cargo",
                    startFrame: TIMELINE_STATE.playheadFrame || 0
                });
            };
        });
    }

    bindEvents() {
        if (!this.containerEl) return;

        // Filtros de preset
        this.containerEl.querySelectorAll(".preset-filter-pill").forEach(btn => {
            btn.onclick = () => {
                this.containerEl.querySelectorAll(".preset-filter-pill").forEach(b => {
                    b.classList.remove("active");
                    b.style.borderColor = "var(--border-glass)";
                    b.style.background = "transparent";
                    b.style.color = "var(--text-secondary)";
                });
                btn.classList.add("active");
                btn.style.borderColor = "var(--color-cyan)";
                btn.style.background = "rgba(6,182,212,0.15)";
                btn.style.color = "#fff";
                this.setFilter(btn.dataset.filter);
            };
        });

        // Botões de Ação Rápida
        const btnFonts = this.containerEl.querySelector("#btn-tab-open-fonts");
        if (btnFonts) btnFonts.onclick = () => FONT_MODAL.open(null, "catalog");

        const btnBrandKit = this.containerEl.querySelector("#btn-tab-open-brandkit");
        if (btnBrandKit) btnBrandKit.onclick = () => FONT_MODAL.open(null, "brandkit");

        const btnCredits = this.containerEl.querySelector("#btn-tab-open-credits");
        if (btnCredits) btnCredits.onclick = () => CREDITS_NORMALIZER.openModal();

        // Inserir Texto Padrão na Agulha
        const btnAddDefault = this.containerEl.querySelector("#btn-quick-add-default-text");
        if (btnAddDefault) {
            btnAddDefault.onclick = () => {
                TEXT_AI_ENGINE.insertSuggestion({
                    presetId: "gc_cinema_classic",
                    title: "Título / Nome",
                    subtitle: "Subtítulo / Função",
                    startFrame: TIMELINE_STATE.playheadFrame || 0
                });
            };
        }
    }
}

export const TITLES_TAB = new TitlesTabManager();
