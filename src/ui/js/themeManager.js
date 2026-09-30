// Aparência da interface: tema (Neutro/Clássico/Personalizado), fonte, peso e tamanho do texto,
// cor de interação e cor das trilhas da timeline.
// Lê as chaves ui.* das Configurações (global com override por projeto), calcula as variáveis CSS e
// entrega ao js/themeBoot.js, que aplica e sincroniza as janelas destacadas. Plano: docs/PLANO_TEMA_NEUTRO.md.

export const THEME_DEFAULTS = {
    "ui.theme": "neutro",
    "ui.custom_base": 3.0,
    "ui.custom_step": 1.5,
    "ui.custom_lines": 0.06,
    "ui.custom_hue": 0,
    "ui.custom_saturation": 0,
    "ui.font_family": "padrao",
    "ui.font_weight": 400,
    "ui.font_scale": 1.0,
    "ui.accent": "padrao",
    "ui.track_mode": "coloridas",
    "ui.text_contrast": "padrao",
};

export const THEME_KEYS = Object.keys(THEME_DEFAULTS);

// null = mantém o par original (Inter no texto, Outfit nos títulos).
export const FONT_STACKS = {
    padrao: null,
    inter: "'Inter', sans-serif",
    plex_condensed: "'IBM Plex Sans Condensed', 'Inter', sans-serif",
    roboto_flex: "'Roboto Flex', 'Inter', sans-serif",
    barlow_semi_condensed: "'Barlow Semi Condensed', 'Inter', sans-serif",
};

// Cor de interação: aba ativa, agulha, clipe selecionado, foco. "padrao" = as cores de sempre.
// Fora da paleta: violeta (seleção da biblioteca), verde (ok) e rosa (erro), que já têm significado.
export const ACCENTS = {
    padrao: null,
    ciano: "#25d1f4",
    azul: "#5b9bff",
    verde_agua: "#2dd4bf",
    lima: "#a3e635",
    laranja: "#fb7a3c",
    gelo: "#e6e6ea",
};

// Tinta sobre a cor de interação (botão primário): escuro passa de 4,5:1 em toda a paleta; branco em nenhuma.
export const ACCENT_INK = "#0b0b0c";

// Texto secundário (--text-muted). "padrao" = o de sempre (#6E6C7A, 3,7:1 sobre #101010).
export const TEXT_CONTRASTS = {
    padrao: null,
    medio: "#7d7b88",   // 4,6:1
    alto: "#8c8a96",    // 5,6:1
};

// Cor das trilhas na timeline (js/trackColors.js aplica no canvas).
export const TRACK_MODES = ["coloridas", "dessaturadas", "mono"];

// Fundos prontos da janela de Aparência: tema + controles do Personalizado.
export const BACKGROUNDS = {
    neutro: { "ui.theme": "neutro" },
    grafite: { "ui.theme": "custom", "ui.custom_base": 3.5, "ui.custom_step": 1.5, "ui.custom_lines": 0.06, "ui.custom_hue": 215, "ui.custom_saturation": 14 },
    quente: { "ui.theme": "custom", "ui.custom_base": 3.5, "ui.custom_step": 1.5, "ui.custom_lines": 0.06, "ui.custom_hue": 30, "ui.custom_saturation": 12 },
    classico: { "ui.theme": "classico" },
};

/** Qual fundo pronto corresponde aos valores (null = Personalizado sob medida). */
export function backgroundOf(values) {
    const v = { ...THEME_DEFAULTS, ...values };
    for (const [name, preset] of Object.entries(BACKGROUNDS)) {
        if (Object.entries(preset).every(([k, x]) => String(v[k]) === String(x))) return name;
    }
    return null;
}

const STORAGE_KEY = "capiau.themeState";

const num = (v, def) => (typeof v === "number" && Number.isFinite(v) ? v : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : def));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** Paleta do Personalizado: os mesmos tokens do Neutro, derivados de 5 controles. */
export function customPalette(values) {
    const base = num(values["ui.custom_base"], THEME_DEFAULTS["ui.custom_base"]);
    const step = num(values["ui.custom_step"], THEME_DEFAULTS["ui.custom_step"]);
    const lines = num(values["ui.custom_lines"], THEME_DEFAULTS["ui.custom_lines"]);
    const hue = num(values["ui.custom_hue"], 0);
    const sat = num(values["ui.custom_saturation"], 0);
    const surf = i => `hsl(${hue}, ${sat}%, ${round(Math.min(100, base + i * step), 2)}%)`;
    // véus e linhas seguem a distância entre níveis (1.5 = valores do Neutro)
    const k = step / 1.5;
    const vars = {};
    for (let i = 0; i <= 4; i++) vars[`--t-surface-${i}`] = surf(i);
    vars["--t-tint-1"] = `rgba(255, 255, 255, ${round(0.025 * k)})`;
    vars["--t-tint-2"] = `rgba(255, 255, 255, ${round(0.05 * k)})`;
    vars["--t-tint-3"] = `rgba(255, 255, 255, ${round(0.09 * k)})`;
    vars["--t-line-weak"] = `rgba(255, 255, 255, ${round(lines)})`;
    vars["--t-line-strong"] = `rgba(255, 255, 255, ${round(Math.min(1, lines * 2))})`;
    vars["--t-glow"] = "transparent";
    vars["--bg-base"] = vars["--t-surface-0"];
    vars["--bg-glass"] = vars["--t-surface-2"];
    vars["--bg-glass-active"] = vars["--t-surface-3"];
    vars["--border-glass"] = vars["--t-line-weak"];
    vars["--border-glass-glow"] = vars["--t-line-strong"];
    return vars;
}

/** Valores ui.* (parciais ou não) → estado aplicável { theme, vars }. Função pura. */
export function computeThemeState(values = {}) {
    const v = { ...THEME_DEFAULTS, ...values };
    const theme = ["neutro", "classico", "custom"].includes(v["ui.theme"]) ? v["ui.theme"] : "neutro";
    const vars = theme === "custom" ? customPalette(v) : {};

    const stack = FONT_STACKS[v["ui.font_family"]];
    if (stack) {
        vars["--font-body"] = stack;
        vars["--font-heading"] = stack;
    }
    const weight = Math.round(num(v["ui.font_weight"], 400) / 10) * 10;
    if (weight !== 400) vars["--font-weight-ui"] = String(Math.max(300, Math.min(500, weight)));
    const scale = round(num(v["ui.font_scale"], 1), 3);
    if (scale !== 1) vars["--font-scale"] = String(Math.max(0.9, Math.min(1.2, scale)));
    const accent = ACCENTS[v["ui.accent"]];
    if (accent) {
        vars["--accent"] = accent;      // CSS da UI
        vars["--t-accent"] = accent;    // canvas (themeTokens) e quem precisa saber se foi escolhida
        vars["--t-accent-ink"] = ACCENT_INK;
    }
    const muted = TEXT_CONTRASTS[v["ui.text_contrast"]];
    if (muted) vars["--text-muted"] = muted;
    if (TRACK_MODES.includes(v["ui.track_mode"]) && v["ui.track_mode"] !== "coloridas") {
        vars["--t-track-mode"] = v["ui.track_mode"];
    }
    return { theme, vars };
}

/** Extrai os valores ui.* da resposta de GET /api/settings. */
export function themeValuesFromSettings(data) {
    const out = {};
    const values = (data && data.values) || {};
    for (const key of THEME_KEYS) {
        if (values[key] && "value" in values[key]) out[key] = values[key].value;
    }
    return out;
}

/** De onde vem cada valor ui.* ("default" | "global" | "project"). */
export function themeOriginsFromSettings(data) {
    const out = {};
    const values = (data && data.values) || {};
    for (const key of THEME_KEYS) {
        if (values[key] && values[key].origin) out[key] = values[key].origin;
    }
    return out;
}

/** Chaves ui.* que o projeto sobrescreve. */
export function projectOverrides(origins) {
    return THEME_KEYS.filter(k => origins[k] === "project");
}

function applyState(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* sem storage: só esta janela */ }
    if (window.CapiauTheme) window.CapiauTheme.apply(state);
}

export class ThemeManager {
    constructor({ STATE, CapIAuAPI }) {
        this.STATE = STATE;
        this.api = CapIAuAPI;
        this.saved = { ...THEME_DEFAULTS };
        this.origins = {};
        STATE.on("settingsChanged", () => this.load());
        STATE.on("projectChanged", () => this.load());
        // Rascunho do painel (valores ui.* ainda não salvos): prévia ao vivo; {} volta ao salvo.
        STATE.on("appearanceDraft", (draft) => this.preview(draft || {}));
    }

    async load() {
        try {
            const data = await this.api.fetchSettings(this.STATE.currentProjectId || null);
            this.saved = { ...THEME_DEFAULTS, ...themeValuesFromSettings(data) };
            this.origins = themeOriginsFromSettings(data);
        } catch (err) {
            // Sem servidor: fica com o cache aplicado no boot.
            console.warn("[Tema] Não foi possível ler a aparência salva:", err);
            return;
        }
        applyState(computeThemeState(this.saved));
    }

    preview(draft) {
        applyState(computeThemeState({ ...this.saved, ...draft }));
    }

    /** Chaves ui.* que o projeto aberto sobrescreve (vencem o global). */
    get projectKeys() {
        return projectOverrides(this.origins);
    }

    /**
     * Grava valores ui.* e aplica (janela de Aparência). scope "global" vale para todos os projetos,
     * menos nas chaves que o projeto aberto sobrescreve; "project" grava só no projeto aberto.
     */
    async save(values, scope = "global") {
        const clean = Object.fromEntries(Object.entries(values).filter(([k]) => k in THEME_DEFAULTS));
        const pid = this.STATE.currentProjectId;
        const toProject = scope === "project" && pid;
        // No global, o que o projeto sobrescreve continua valendo nele: a prévia não pode mentir.
        const visible = toProject ? clean
            : Object.fromEntries(Object.entries(clean).filter(([k]) => this.origins[k] !== "project"));
        this.saved = { ...this.saved, ...visible };
        for (const k of Object.keys(clean)) {
            if (toProject) this.origins[k] = "project";
            else if (this.origins[k] !== "project") this.origins[k] = "global";
        }
        applyState(computeThemeState(this.saved));
        if (toProject) await this.api.updateProjectSettings(pid, clean);
        else await this.api.updateGlobalSettings(clean);
        this.STATE.emit("settingsChanged", { scope: toProject ? "project" : "global", source: "appearance" });
    }

    /** Tira a aparência própria do projeto aberto: ele volta a seguir o global. */
    async followGlobal() {
        const pid = this.STATE.currentProjectId;
        const keys = this.projectKeys;
        if (!pid || !keys.length) return;
        await this.api.resetSettings("project", pid, keys);
        this.STATE.emit("settingsChanged", { scope: "project", source: "appearance" });
        await this.load();
    }
}
