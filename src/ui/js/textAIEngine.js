// textAIEngine.js - Motor de IA Duplo para Geração de Textos, GCs, Citações e Legendas (CapIAu-Talho)
import { STATE } from "./state.js";
import { TIMELINE_STATE, TIMELINE_HISTORY } from "./timelineState.js";
import { CREDITS_NORMALIZER } from "./creditsNormalizer.js";
import { createTextClipFromPreset } from "./textPresets.js";
import { getProjectBrandKit, applyBrandKitToClip } from "./fontManager.js";

export class TextAIEngine {
    constructor() {
        this.reactiveEnabled = true;
        this.currentPlayheadSuggestion = null;
        this.allProjectSuggestions = [];
        this.suggestionListeners = [];
    }

    init() {
        // Escuta movimentação do playhead para modo reativo
        STATE.on("timelinePlayheadChanged", () => {
            if (this.reactiveEnabled) {
                this.evaluatePlayheadContext();
            }
        });

        STATE.on("timelineCutsUpdated", () => {
            if (this.reactiveEnabled) {
                this.evaluatePlayheadContext();
            }
        });
    }

    setReactiveEnabled(enabled) {
        this.reactiveEnabled = !!enabled;
        if (!this.reactiveEnabled) {
            this.currentPlayheadSuggestion = null;
            this.notifySuggestionChanged();
        } else {
            this.evaluatePlayheadContext();
        }
        STATE.emit("textAIReactiveToggled", this.reactiveEnabled);
    }

    onSuggestion(cb) {
        this.suggestionListeners.push(cb);
    }

    notifySuggestionChanged() {
        this.suggestionListeners.forEach(fn => fn(this.currentPlayheadSuggestion));
        STATE.emit("textAISuggestionChanged", this.currentPlayheadSuggestion);
    }

    /**
     * MODO 1: Avaliação Reativa no Playhead Atual
     */
    evaluatePlayheadContext() {
        const currentFrame = TIMELINE_STATE.playheadFrame || 0;
        const cuts = STATE.activeTimelineCuts || [];
        const fps = TIMELINE_STATE.fps || 24;
        const currentSec = currentFrame / fps;

        // Verifica se já existe um clipe de texto cobrindo este ponto
        const existingText = cuts.find(c =>
            c.type === "text" &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        if (existingText) {
            this.currentPlayheadSuggestion = null;
            this.notifySuggestionChanged();
            return;
        }

        // Localiza o corte de vídeo/depoimento no playhead
        const activeVideoCut = cuts.find(c =>
            c.type === "video" &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        if (!activeVideoCut) {
            this.currentPlayheadSuggestion = null;
            this.notifySuggestionChanged();
            return;
        }

        // Obtém metadados do vídeo (personagem, título, falas transcritas)
        const videoId = activeVideoCut.video_id;
        const video = (STATE.allVideos || []).find(v => v.id === videoId);

        let personName = "";
        let personRole = "";

        if (video) {
            // Tenta obter o nome do entrevistado/personagem do vídeo
            personName = video.person || video.character || video.speaker || "";
            personRole = video.role || video.profession || "";

            // Se não tiver no vídeo, cruza com a Ficha Técnica Oficial
            if (personName) {
                const match = CREDITS_NORMALIZER.findMatchingCredit(personName);
                if (match) {
                    personName = match.name;
                    if (match.role) personRole = match.role;
                }
            } else if (video.title) {
                const match = CREDITS_NORMALIZER.findMatchingCredit(video.title);
                if (match) {
                    personName = match.name;
                    if (match.role) personRole = match.role;
                }
            }
        }

        // Se encontrou uma pessoa identificada, sugere Lower Third (GC)
        if (personName) {
            this.currentPlayheadSuggestion = {
                type: "lower_third",
                presetId: "gc_cinema_classic",
                title: personName,
                subtitle: personRole || "Entrevistado(a)",
                startFrame: activeVideoCut.timelineStartFrame,
                reason: `Identificado: ${personName} em cena.`,
                actionLabel: `Inserir GC: ${personName}`
            };
            this.notifySuggestionChanged();
            return;
        }

        this.currentPlayheadSuggestion = null;
        this.notifySuggestionChanged();
    }

    /**
     * MODO 2: Geração de Sugestões de Texto sob Demanda para toda a Timeline
     */
    generateFullTimelineSuggestions() {
        const cuts = STATE.activeTimelineCuts || [];
        const fps = TIMELINE_STATE.fps || 24;
        const suggestions = [];
        const seenPeople = new Set();

        cuts.forEach(cut => {
            if (cut.type === "video") {
                const video = (STATE.allVideos || []).find(v => v.id === cut.video_id);
                if (video) {
                    let name = video.person || video.character || video.speaker || "";
                    let role = video.role || "";

                    const match = CREDITS_NORMALIZER.findMatchingCredit(name || video.title || "");
                    if (match) {
                        name = match.name;
                        role = match.role || role;
                    }

                    if (name && !seenPeople.has(name.toLowerCase())) {
                        seenPeople.add(name.toLowerCase());

                        // Verifica se já não tem GC naquele trecho
                        const hasText = cuts.some(c =>
                            c.type === "text" &&
                            c.timelineStartFrame >= cut.timelineStartFrame &&
                            c.timelineStartFrame < (cut.timelineStartFrame + (cut.outFrame - cut.inFrame))
                        );

                        if (!hasText) {
                            suggestions.push({
                                id: `sug_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                category: "lower_third",
                                presetId: "gc_cinema_classic",
                                title: name,
                                subtitle: role || "Entrevistado(a)",
                                startFrame: cut.timelineStartFrame,
                                durationFrames: Math.round(4.0 * fps),
                                description: `Primeira aparição de ${name} na timeline.`
                            });
                        }
                    }
                }
            }
        });

        this.allProjectSuggestions = suggestions;
        return suggestions;
    }

    /**
     * Insere a sugestão da IA diretamente na pista de texto T1 da timeline.
     */
    insertSuggestion(suggestion, trackId = "T1") {
        if (!suggestion) return null;
        const fps = TIMELINE_STATE.fps || 24;
        const startFrame = suggestion.startFrame !== undefined ? suggestion.startFrame : TIMELINE_STATE.playheadFrame;

        // Garante que existe uma pista de texto T1
        let textTracks = TIMELINE_STATE.getTextTracks ? TIMELINE_STATE.getTextTracks() : [];
        if (textTracks.length === 0) {
            TIMELINE_STATE.addTextTrack("Títulos & GCs");
            textTracks = TIMELINE_STATE.getTextTracks();
        }
        const targetTrack = textTracks[0]?.id || trackId;

        const presetId = suggestion.presetId || (suggestion.type === "lower_third" ? "gc_cinema_classic" : "chapter_cinematic_full");
        const clip = createTextClipFromPreset(presetId, suggestion.title, suggestion.subtitle || "", startFrame, targetTrack);

        // Aplica o Brand Kit do projeto
        applyBrandKitToClip(clip, clip.textCategory);

        TIMELINE_HISTORY.begin();
        const cuts = [...STATE.activeTimelineCuts, clip];
        STATE.activeTimelineCuts = cuts;
        TIMELINE_HISTORY.commit();
        STATE.emit("timelineCutsUpdated", cuts);

        this.currentPlayheadSuggestion = null;
        this.notifySuggestionChanged();

        if (typeof window !== "undefined" && typeof window.showToast === "function") {
            window.showToast(`Texto "${clip.text}" inserido na pista ${targetTrack}!`, "success");
        }

        return clip;
    }
}

export const TEXT_AI_ENGINE = new TextAIEngine();
