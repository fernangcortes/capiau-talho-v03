// fontManager.js - Catálogo de Fontes Livres, Moods, Fontes Locais, FontFace e Brand Kit
import { STATE } from "./state.js";

export const FONT_MOODS = [
    { id: "all", label: "Todas as Fontes", icon: "fa-solid fa-border-all" },
    { id: "epic", label: "Cinema Épico / Clássico", icon: "fa-solid fa-landmark" },
    { id: "documentary", label: "Documentário / Histórico", icon: "fa-solid fa-book-open" },
    { id: "modern", label: "Moderno / Brutalista", icon: "fa-solid fa-cube" },
    { id: "neutral", label: "Design System / Neutro", icon: "fa-solid fa-layer-group" },
    { id: "poetic", label: "Lírico / Poético", icon: "fa-solid fa-feather" },
    { id: "script", label: "Roteiro / Arquivo", icon: "fa-solid fa-keyboard" },
    { id: "social", label: "Social / Dinâmico", icon: "fa-solid fa-bolt" }
];

export const CURATED_FONTS = [
    // Design System / Neutro
    { id: "Outfit", name: "Outfit", category: "sans-serif", mood: "neutral", weights: [300, 400, 600, 700, 900], isGoogle: true, specimen: "CapIAu Talho: A Arte do Corte" },
    { id: "Inter", name: "Inter", category: "sans-serif", mood: "neutral", weights: [300, 400, 500, 700], isGoogle: true, specimen: "Estrutura narrativa e precisão visual" },
    { id: "DM Sans", name: "DM Sans", category: "sans-serif", mood: "neutral", weights: [400, 500, 700], isGoogle: true, specimen: "Clareza contemporânea para diálogos" },
    { id: "Space Grotesk", name: "Space Grotesk", category: "sans-serif", mood: "neutral", weights: [400, 600, 700], isGoogle: true, specimen: "Geometria limpa e técnica" },

    // Cinema Épico / Clássico
    { id: "Cinzel", name: "Cinzel", category: "serif", mood: "epic", weights: [400, 600, 700, 900], isGoogle: true, specimen: "MEMÓRIAS DE UMA TERRA ESQUECIDA" },
    { id: "Cormorant Garamond", name: "Cormorant Garamond", category: "serif", mood: "epic", weights: [400, 600, 700], isGoogle: true, specimen: "O tempo que corre nas margens do rio" },
    { id: "Marcellus", name: "Marcellus", category: "serif", mood: "epic", weights: [400], isGoogle: true, specimen: "CRÔNICAS DE UMA VIDA INTEIRA" },
    { id: "Castoro Titling", name: "Castoro Titling", category: "serif", mood: "epic", weights: [400], isGoogle: true, specimen: "GRANDES FEITOS DO SÉCULO PASSADO" },

    // Documentário / Editorial
    { id: "Newsreader", name: "Newsreader", category: "serif", mood: "documentary", weights: [400, 500, 600, 700], isGoogle: true, specimen: "Depoimentos registrados no calor da hora" },
    { id: "Lora", name: "Lora", category: "serif", mood: "documentary", weights: [400, 500, 600, 700], isGoogle: true, specimen: "A história oral dos antigos moradores" },
    { id: "Fraunces", name: "Fraunces", category: "serif", mood: "documentary", weights: [400, 600, 700, 900], isGoogle: true, specimen: "Vozes autênticas do sertão e da serra" },
    { id: "Spectral", name: "Spectral", category: "serif", mood: "documentary", weights: [400, 600, 700], isGoogle: true, specimen: "Documentos e arquivos da comunidade" },

    // Moderno / Brutalista
    { id: "Syne", name: "Syne", category: "sans-serif", mood: "modern", weights: [500, 700, 800], isGoogle: true, specimen: "URBANO / CONTRASTE / MOVIMENTO" },
    { id: "Cabinet Grotesk", name: "Cabinet Grotesk", category: "sans-serif", mood: "modern", weights: [400, 700, 900], isGoogle: true, specimen: "RITMO VISUAL SEM COMPROMISSO" },
    { id: "Plus Jakarta Sans", name: "Plus Jakarta Sans", category: "sans-serif", mood: "modern", weights: [400, 600, 700, 800], isGoogle: true, specimen: "Inovação tecnológica em cada detalhe" },
    { id: "Unbounded", name: "Unbounded", category: "display", mood: "modern", weights: [400, 700, 900], isGoogle: true, specimen: "SEM LIMITES DE CRIAÇÃO" },

    // Lírico / Poético
    { id: "Playfair Display", name: "Playfair Display", category: "serif", mood: "poetic", weights: [400, 600, 700, 900], isGoogle: true, specimen: "Um instante de silêncio sob a luz do entardecer" },
    { id: "Bodoni Moda", name: "Bodoni Moda", category: "serif", mood: "poetic", weights: [400, 600, 700, 900], isGoogle: true, specimen: "A delicadeza dos gestos não ditos" },
    { id: "Prata", name: "Prata", category: "serif", mood: "poetic", weights: [400], isGoogle: true, specimen: "Elegância refinada em preto e branco" },
    { id: "Italiana", name: "Italiana", category: "serif", mood: "poetic", weights: [400], isGoogle: true, specimen: "A harmonia sutil das sombras" },

    // Roteiro / Arquivo
    { id: "Courier Prime", name: "Courier Prime", category: "monospace", mood: "script", weights: [400, 700], isGoogle: true, specimen: "EXT. FAZENDA - DIA (CENA 14)" },
    { id: "Special Elite", name: "Special Elite", category: "display", mood: "script", weights: [400], isGoogle: true, specimen: "RELATÓRIO CONFIDENCIAL DE 1974" },
    { id: "Space Mono", name: "Space Mono", category: "monospace", mood: "script", weights: [400, 700], isGoogle: true, specimen: "TC: 01:23:45:12 // LOG AUTOMÁTICO" },

    // Social / Dinâmico
    { id: "Montserrat", name: "Montserrat", category: "sans-serif", mood: "social", weights: [400, 600, 800, 900], isGoogle: true, specimen: "IMPACTO DIRETO NO FEED" },
    { id: "Oswald", name: "Oswald", category: "sans-serif", mood: "social", weights: [400, 600, 700], isGoogle: true, specimen: "DESTAQUE EM CAIXA ALTA" },
    { id: "Bebas Neue", name: "Bebas Neue", category: "display", mood: "social", weights: [400], isGoogle: true, specimen: "TÍTULO FORTE E CONDENSADO" },
    { id: "Anton", name: "Anton", category: "display", mood: "social", weights: [400], isGoogle: true, specimen: "MENSAGEM RÁPIDA E CLARA" }
];

const loadedGoogleFonts = new Set(["Outfit", "Inter"]);

/**
 * Injeta a folha de estilos Google Fonts no documento caso ainda não tenha sido carregada.
 */
export function ensureFontLoaded(fontFamily) {
    if (!fontFamily) return;
    const cleanName = fontFamily.trim().replace(/['"]/g, '');

    if (loadedGoogleFonts.has(cleanName)) return;

    const fontObj = CURATED_FONTS.find(f => f.id.toLowerCase() === cleanName.toLowerCase());
    if (fontObj && fontObj.isGoogle) {
        const familyParam = cleanName.replace(/\s+/g, '+');
        const weightsParam = fontObj.weights.join(';');
        const url = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weightsParam}&display=swap`;

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        document.head.appendChild(link);
        loadedGoogleFonts.add(cleanName);
    }
}

/**
 * Consulta fontes instaladas no sistema operacional do usuário via Local Font Access API.
 */
export async function querySystemFonts() {
    if (typeof window !== "undefined" && "queryLocalFonts" in window) {
        try {
            const availableFonts = await window.queryLocalFonts();
            const uniqueFamilies = new Map();
            availableFonts.forEach(font => {
                if (!uniqueFamilies.has(font.family)) {
                    uniqueFamilies.set(font.family, {
                        id: font.family,
                        name: font.family,
                        category: "local",
                        mood: "all",
                        weights: [400],
                        isGoogle: false,
                        isLocal: true,
                        specimen: "Fonte local do seu sistema"
                    });
                }
            });
            return Array.from(uniqueFamilies.values()).sort((a, b) => a.name.localeCompare(b.name));
        } catch (err) {
            console.info("[fontManager] Acesso a fontes locais recusado ou não suportado:", err);
        }
    }
    return [];
}

/**
 * Carrega arquivo de fonte enviado pelo usuário (.ttf, .otf, .woff2) na sessão atual.
 */
export async function loadUserFontFile(file) {
    if (!file) return null;
    const fontName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_\s-]/g, "");
    try {
        const arrayBuffer = await file.arrayBuffer();
        const fontFace = new FontFace(fontName, arrayBuffer);
        await fontFace.load();
        document.fonts.add(fontFace);

        const customFont = {
            id: fontName,
            name: fontName,
            category: "custom",
            mood: "all",
            weights: [400],
            isGoogle: false,
            isCustom: true,
            specimen: "Fonte personalizada importada"
        };

        STATE.projectData = STATE.projectData || {};
        STATE.projectData.custom_fonts = STATE.projectData.custom_fonts || [];
        if (!STATE.projectData.custom_fonts.some(f => f.id === fontName)) {
            STATE.projectData.custom_fonts.push(customFont);
        }

        return customFont;
    } catch (err) {
        console.error("[fontManager] Erro ao carregar arquivo de fonte:", err);
        throw err;
    }
}

/**
 * Brand Kit do Projeto
 */
export const DEFAULT_BRAND_KIT = {
    titleFont: "Outfit",
    bodyFont: "Inter",
    accentColor: "#f59e0b", // Âmbar
    textColor: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    boxPadding: 8,
    boxBorderRadius: 4,
    defaultAlignment: "left",
    defaultEasing: "easeOutCubic",
    defaultDurationS: 4.0
};

export function getProjectBrandKit() {
    if (STATE.projectData && STATE.projectData.brand_kit) {
        return { ...DEFAULT_BRAND_KIT, ...STATE.projectData.brand_kit };
    }
    return { ...DEFAULT_BRAND_KIT };
}

export function saveProjectBrandKit(brandKit) {
    STATE.projectData = STATE.projectData || {};
    STATE.projectData.brand_kit = { ...DEFAULT_BRAND_KIT, ...brandKit };
    STATE.emit("brandKitUpdated", STATE.projectData.brand_kit);
}

export function applyBrandKitToClip(clip, category = "lower_third") {
    const bk = getProjectBrandKit();
    clip.fontFamily = category === "title" || category === "chapter" ? bk.titleFont : bk.bodyFont;
    clip.color = bk.textColor;
    clip.backgroundColor = bk.backgroundColor;
    clip.boxPadding = bk.boxPadding;
    clip.boxBorderRadius = bk.boxBorderRadius;
    clip.alignment = bk.defaultAlignment;
    ensureFontLoaded(clip.fontFamily);
    return clip;
}
