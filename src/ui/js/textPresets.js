// textPresets.js - Biblioteca com os 15 Presets Visuais Paramétricos do CapIAu-Talho
import { ensureFontLoaded } from "./fontManager.js";

export const TEXT_PRESETS = [
    // ── 1. LOWER THIRDS (GCS) DE PERSONAGENS & ENTREVISTADOS ──
    {
        id: "gc_cinema_classic",
        name: "GC Cinema Clássico",
        category: "lower_third",
        description: "Linha elegante, fonte serif clássica com barra de acento âmbar e animação suave.",
        fontFamily: "Cinzel",
        fontSize: 34,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "rgba(10, 8, 16, 0.75)",
        boxPadding: 8,
        boxBorderRadius: 2,
        alignment: "left",
        posX: -25, posY: 34,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.5,
        defaultDurationS: 4.5,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.4, value: 1, easing: "linear" },
                { time_offset_s: 4.1, value: 1, easing: "linear" },
                { time_offset_s: 4.5, value: 0, easing: "easeInQuad" }
            ],
            posX: [
                { time_offset_s: 0, value: -32, easing: "easeOutCubic" },
                { time_offset_s: 0.5, value: -25, easing: "linear" }
            ]
        }
    },
    {
        id: "gc_modern_glass",
        name: "GC Moderno Glassmorphism",
        category: "lower_third",
        description: "Caixa escura translúcida com fonte Outfit e subtexto espaçado.",
        fontFamily: "Outfit",
        fontSize: 32,
        fontWeight: "600",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "rgba(20, 18, 26, 0.85)",
        boxPadding: 10,
        boxBorderRadius: 6,
        alignment: "left",
        posX: -28, posY: 33,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0.5,
        defaultDurationS: 4.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.35, value: 1, easing: "linear" },
                { time_offset_s: 3.65, value: 1, easing: "linear" },
                { time_offset_s: 4.0, value: 0, easing: "easeInQuad" }
            ],
            posY: [
                { time_offset_s: 0, value: 38, easing: "easeOutCubic" },
                { time_offset_s: 0.4, value: 33, easing: "linear" }
            ]
        }
    },
    {
        id: "gc_minimalist_clean",
        name: "GC Minimalista Clean",
        category: "lower_third",
        description: "Sem fundo de caixa, tipografia limpa Inter com tracking expandido.",
        fontFamily: "Inter",
        fontSize: 30,
        fontWeight: "500",
        fontStyle: "normal",
        color: "#f8fafc",
        backgroundColor: "transparent",
        boxPadding: 0,
        boxBorderRadius: 0,
        alignment: "left",
        posX: -28, posY: 35,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.0,
        defaultDurationS: 4.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.4, value: 1, easing: "linear" },
                { time_offset_s: 3.6, value: 1, easing: "linear" },
                { time_offset_s: 4.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "gc_bold_documentary",
        name: "GC Documentário Histórico",
        category: "lower_third",
        description: "Cartela retangular contrastante com fonte Newsreader, ideal para cinema e TV.",
        fontFamily: "Newsreader",
        fontSize: 36,
        fontWeight: "600",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "#09090b",
        boxPadding: 12,
        boxBorderRadius: 0,
        alignment: "left",
        posX: -26, posY: 32,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0,
        defaultDurationS: 5.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.5, value: 1, easing: "linear" },
                { time_offset_s: 4.5, value: 1, easing: "linear" },
                { time_offset_s: 5.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },

    // ── 2. LEGENDAS DINÂMICAS ESTILIZADAS & ASR ──
    {
        id: "subtitle_cinema_dialogue",
        name: "Legenda Cinema Clássico",
        category: "subtitle",
        description: "Centralizada na parte inferior (Title Safe), fonte limpa com sombra cinematográfica.",
        fontFamily: "Inter",
        fontSize: 28,
        fontWeight: "600",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "transparent",
        boxPadding: 0,
        boxBorderRadius: 0,
        alignment: "center",
        posX: 0, posY: 36,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0.5,
        defaultDurationS: 3.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.15, value: 1, easing: "linear" },
                { time_offset_s: 2.85, value: 1, easing: "linear" },
                { time_offset_s: 3.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "subtitle_social_punch",
        name: "Legenda Social Punch (Amarelo)",
        category: "subtitle",
        description: "Fonte Montserrat em caixa alta, amarela com alto contraste para redes.",
        fontFamily: "Montserrat",
        fontSize: 38,
        fontWeight: "900",
        fontStyle: "normal",
        color: "#facc15",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        boxPadding: 6,
        boxBorderRadius: 4,
        alignment: "center",
        posX: 0, posY: 28,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0.5,
        defaultDurationS: 2.5,
        keyframes: {
            scale: [
                { time_offset_s: 0, value: 0.9, easing: "spring" },
                { time_offset_s: 0.15, value: 1.05, easing: "easeOutQuad" },
                { time_offset_s: 0.3, value: 1.0, easing: "linear" }
            ],
            opacity: [
                { time_offset_s: 0, value: 0, easing: "linear" },
                { time_offset_s: 0.1, value: 1, easing: "linear" }
            ]
        }
    },
    {
        id: "subtitle_karaoke_highlight",
        name: "Legenda Bounce Dinâmico",
        category: "subtitle",
        description: "Palavras com bounce suave via keyframes elásticos de escala.",
        fontFamily: "Outfit",
        fontSize: 36,
        fontWeight: "800",
        fontStyle: "normal",
        color: "#06b6d4",
        backgroundColor: "rgba(10, 8, 16, 0.8)",
        boxPadding: 8,
        boxBorderRadius: 6,
        alignment: "center",
        posX: 0, posY: 30,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0,
        defaultDurationS: 2.5,
        keyframes: {
            scale: [
                { time_offset_s: 0, value: 0.85, easing: "spring" },
                { time_offset_s: 0.2, value: 1.08, easing: "easeOutCubic" },
                { time_offset_s: 0.35, value: 1.0, easing: "linear" }
            ]
        }
    },
    {
        id: "subtitle_news_ticker",
        name: "Tarja Ticker Informativo",
        category: "subtitle",
        description: "Tarja horizontal corrida com fundo preto e tipografia condensada Oswald.",
        fontFamily: "Oswald",
        fontSize: 26,
        fontWeight: "600",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "#000000",
        boxPadding: 8,
        boxBorderRadius: 0,
        alignment: "left",
        posX: 0, posY: 42,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.0,
        defaultDurationS: 4.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "linear" },
                { time_offset_s: 0.2, value: 1, easing: "linear" }
            ]
        }
    },

    // ── 3. CARTELAS DE CAPÍTULO & CITAÇÕES POÉTICAS ──
    {
        id: "chapter_cinematic_full",
        name: "Cartela Capítulo Cinema",
        category: "chapter",
        description: "Centralizada com respiração de escala lenta (Ken Burns) e tipografia lírica Playfair.",
        fontFamily: "Playfair Display",
        fontSize: 48,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        boxPadding: 24,
        boxBorderRadius: 4,
        alignment: "center",
        posX: 0, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 2.0,
        defaultDurationS: 5.0,
        keyframes: {
            scale: [
                { time_offset_s: 0, value: 0.98, easing: "linear" },
                { time_offset_s: 5.0, value: 1.05, easing: "linear" }
            ],
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.8, value: 1, easing: "linear" },
                { time_offset_s: 4.2, value: 1, easing: "linear" },
                { time_offset_s: 5.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "chapter_editorial_roman",
        name: "Cartela Editorial Romana",
        category: "chapter",
        description: "Tipografia Newsreader com numeração elegante e linhas discretas.",
        fontFamily: "Newsreader",
        fontSize: 44,
        fontWeight: "600",
        fontStyle: "normal",
        color: "#f1f5f9",
        backgroundColor: "#000000",
        boxPadding: 20,
        boxBorderRadius: 0,
        alignment: "center",
        posX: 0, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.0,
        defaultDurationS: 4.5,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.6, value: 1, easing: "linear" },
                { time_offset_s: 3.9, value: 1, easing: "linear" },
                { time_offset_s: 4.5, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "quote_poetic_italic",
        name: "Citação Poética Lírica",
        category: "quote",
        description: "Citação em itálico Cormorant Garamond com fade suave e presença silenciosa.",
        fontFamily: "Cormorant Garamond",
        fontSize: 38,
        fontWeight: "600",
        fontStyle: "italic",
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        boxPadding: 16,
        boxBorderRadius: 4,
        alignment: "center",
        posX: 0, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.2,
        defaultDurationS: 6.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 1.0, value: 1, easing: "linear" },
                { time_offset_s: 5.0, value: 1, easing: "linear" },
                { time_offset_s: 6.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "quote_manifesto_brutal",
        name: "Citação Manifesto Brutalista",
        category: "quote",
        description: "Tipografia expressiva Syne em caixa alta com alto impacto dramático.",
        fontFamily: "Syne",
        fontSize: 52,
        fontWeight: "800",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        boxPadding: 20,
        boxBorderRadius: 0,
        alignment: "left",
        posX: -15, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: -0.5,
        defaultDurationS: 5.0,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "linear" },
                { time_offset_s: 0.3, value: 1, easing: "linear" },
                { time_offset_s: 4.6, value: 1, easing: "linear" },
                { time_offset_s: 5.0, value: 0, easing: "easeInQuad" }
            ],
            posX: [
                { time_offset_s: 0, value: -22, easing: "easeOutCubic" },
                { time_offset_s: 0.5, value: -15, easing: "linear" }
            ]
        }
    },

    // ── 4. TÍTULOS LIVRES, ABERTURAS & ENCERRAMENTOS ──
    {
        id: "title_epic_slowzoom",
        name: "Título Épico Zoom Contínuo",
        category: "title",
        description: "Zoom lento de 1.0x para 1.12x ao longo de 5 segundos com Cinzel.",
        fontFamily: "Cinzel",
        fontSize: 54,
        fontWeight: "900",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "transparent",
        boxPadding: 0,
        boxBorderRadius: 0,
        alignment: "center",
        posX: 0, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 3.0,
        defaultDurationS: 5.0,
        keyframes: {
            scale: [
                { time_offset_s: 0, value: 1.0, easing: "linear" },
                { time_offset_s: 5.0, value: 1.12, easing: "linear" }
            ],
            opacity: [
                { time_offset_s: 0, value: 0, easing: "easeOutQuad" },
                { time_offset_s: 0.8, value: 1, easing: "linear" },
                { time_offset_s: 4.2, value: 1, easing: "linear" },
                { time_offset_s: 5.0, value: 0, easing: "easeInQuad" }
            ]
        }
    },
    {
        id: "title_typewriter",
        name: "Título Roteiro Typewriter",
        category: "title",
        description: "Tipografia Courier Prime estilo roteiro e máquina de escrever.",
        fontFamily: "Courier Prime",
        fontSize: 36,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#e2e8f0",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        boxPadding: 12,
        boxBorderRadius: 2,
        alignment: "left",
        posX: -20, posY: 0,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 0,
        defaultDurationS: 4.5,
        keyframes: {
            opacity: [
                { time_offset_s: 0, value: 0, easing: "linear" },
                { time_offset_s: 0.2, value: 1, easing: "linear" }
            ]
        }
    },
    {
        id: "title_credits_scroll",
        name: "Créditos Rolagem Vertical",
        category: "title",
        description: "Rolagem vertical contínua clássica de encerramento cinematográfico.",
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: "400",
        fontStyle: "normal",
        color: "#ffffff",
        backgroundColor: "transparent",
        boxPadding: 0,
        boxBorderRadius: 0,
        alignment: "center",
        posX: 0, posY: 60,
        scale: 1.0, rotation: 0, opacity: 1.0, tracking: 1.0,
        defaultDurationS: 10.0,
        keyframes: {
            posY: [
                { time_offset_s: 0, value: 60, easing: "linear" },
                { time_offset_s: 10.0, value: -60, easing: "linear" }
            ]
        }
    }
];

/**
 * Cria uma estrutura completa de clipe de texto a partir de um preset.
 */
export function createTextClipFromPreset(presetId, textContent = "Novo Texto", subtextContent = "", startFrame = 0, trackId = "T1") {
    const preset = TEXT_PRESETS.find(p => p.id === presetId) || TEXT_PRESETS[0];
    const fps = TIMELINE_STATE.fps || 24;
    const durationFrames = Math.round((preset.defaultDurationS || 4.0) * fps);

    ensureFontLoaded(preset.fontFamily);

    return {
        id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: "text",
        textCategory: preset.category,
        presetId: preset.id,
        text: textContent,
        subtext: subtextContent,
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        fontStyle: preset.fontStyle,
        color: preset.color,
        backgroundColor: preset.backgroundColor,
        boxPadding: preset.boxPadding,
        boxBorderRadius: preset.boxBorderRadius,
        alignment: preset.alignment,
        posX: preset.posX,
        posY: preset.posY,
        scale: preset.scale,
        rotation: preset.rotation,
        opacity: preset.opacity,
        tracking: preset.tracking,
        lineHeight: 1.2,
        keyframes: JSON.parse(JSON.stringify(preset.keyframes || {})),
        track: trackId,
        inFrame: 0,
        outFrame: durationFrames,
        in: 0,
        out: durationFrames / fps,
        timelineStartFrame: startFrame,
        timeline_start: startFrame / fps,
        link_id: null
    };
}
