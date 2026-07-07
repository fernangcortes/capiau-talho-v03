// Gerenciador de Estado da Timeline em Frames Absolutos (CapIAu-Talho)
// v2: Multipista dinâmica — o usuário cria quantas pistas quiser + pista de IA dedicada.
import { STATE } from "./state.js";

// --- UTILITÁRIOS DE CONVERSÃO DE TEMPO ---

/**
 * Converte frames para segundos.
 * @param {number} frames - Número de frames.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Segundos (float).
 */
export function framesToSeconds(frames, fps = 24) {
    return frames / fps;
}

/**
 * Converte segundos para frames (arredondado para inteiro).
 * @param {number} seconds - Segundos.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Frames (inteiro).
 */
export function secondsToFrames(seconds, fps = 24) {
    return Math.round(seconds * fps);
}

/**
 * Converte frames para Timecode formatado (HH:MM:SS:FF).
 * @param {number} totalFrames - Total de frames.
 * @param {number} fps - Taxa de quadros.
 * @returns {string} Timecode formatado.
 */
export function framesToTimecode(totalFrames, fps = 24) {
    if (isNaN(totalFrames) || totalFrames < 0) return "00:00:00:00";

    const h = Math.floor(totalFrames / (3600 * fps));
    let remaining = totalFrames % (3600 * fps);

    const m = Math.floor(remaining / (60 * fps));
    remaining = remaining % (60 * fps);

    const s = Math.floor(remaining / fps);
    const f = Math.round(remaining % fps);

    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

/**
 * Converte um timecode formatado (HH:MM:SS:FF ou MM:SS) para frames.
 * @param {string} tc - String de timecode.
 * @param {number} fps - Taxa de quadros.
 * @returns {number} Frames.
 */
export function timecodeToFrames(tc, fps = 24) {
    if (!tc) return 0;
    const parts = tc.split(':').map(Number);
    if (parts.some(isNaN)) return 0;

    if (parts.length === 4) {
        // HH:MM:SS:FF
        const [h, m, s, f] = parts;
        return (h * 3600 + m * 60 + s) * fps + f;
    } else if (parts.length === 3) {
        // MM:SS:FF ou HH:MM:SS
        const [m, s, f] = parts;
        return (m * 60 + s) * fps + f;
    } else if (parts.length === 2) {
        // MM:SS
        const [m, s] = parts;
        return (m * 60 + s) * fps;
    }
    return 0;
}

// --- MODELO DE PISTAS ---

// Alturas por tipo de pista (px no canvas)
export const TRACK_HEIGHTS = { ai: 44, video: 72, audio: 48 };

/**
 * Pistas padrão (ordem do array = ordem visual de cima para baixo).
 * "AI" é a pista de sugestões: somente leitura, recebe os ghost clips.
 * "V1" é magnética (ripple) por padrão; "V2" é livre.
 * "A1"/"A2" são pistas de áudio reais: recebem o áudio vinculado (link_id)
 * dos clipes de vídeo, com trims independentes (L-cuts / J-cuts).
 */
function defaultTracks() {
    return [
        { id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, magnetic: false },
        { id: "V2", name: "B-Roll", kind: "video", volume: 1.0, muted: false, locked: false, magnetic: false },
        { id: "V1", name: "Falas", kind: "video", volume: 1.0, muted: false, locked: false, magnetic: true },
        { id: "A1", name: "Áudio Falas", kind: "audio", volume: 1.0, muted: false, locked: false, magnetic: false },
        { id: "A2", name: "Áudio B-Roll", kind: "audio", volume: 1.0, muted: false, locked: false, magnetic: false }
    ];
}

// --- CLASSE DE ESTADO DA TIMELINE ---

export class CapiauTimelineState {
    constructor() {
        this.fps = 24; // FPS padrão da timeline (conforme padrão do player)
        this.zoom = 0.5; // Pixels por frame (0.5px/frame = 12px/s em 24fps)
        this.scrollLeftFrame = 0; // Posição do scroll horizontal em frames
        this.scrollTop = 0; // Scroll vertical das pistas em pixels
        this.playheadFrame = 0; // Posição atual do cursor de reprodução em frames

        this.selectedClipId = null; // ID do clipe comum selecionado
        this.selectedTrack = "V1"; // Track focada ativa

        this.tracks = defaultTracks(); // Lista dinâmica de pistas (ordem visual)

        this.ghostTrack = []; // Lista de sugestões da IA (Ghost Clips)
        this.selectedGhostClipId = null; // ID da sugestão de IA ativa
        this.aiAnalysisRunning = false; // Flag de análise de IA em andamento
    }

    // ── PISTAS ──────────────────────────────────────────────────────────

    getTrack(id) {
        return this.tracks.find(t => t.id === id) || null;
    }

    /** Pistas de vídeo em ordem visual (de cima para baixo). */
    getVideoTracks() {
        return this.tracks.filter(t => t.kind === "video");
    }

    /** Pistas de áudio em ordem visual (de cima para baixo). */
    getAudioTracks() {
        return this.tracks.filter(t => t.kind === "audio");
    }

    getAiTrack() {
        return this.tracks.find(t => t.kind === "ai") || null;
    }

    /** Tipo (kind) da pista pelo id, com fallback "video" para pistas desconhecidas. */
    trackKindOf(trackId) {
        const t = this.getTrack(trackId);
        return t ? (t.kind || "video") : "video";
    }

    /**
     * Pista de áudio pareada de uma pista de vídeo (para onde vai o áudio vinculado):
     * V1→A1 por sufixo numérico; senão por índice (base→topo); senão a primeira de áudio.
     */
    pairedAudioTrackId(videoTrackId) {
        const audioTracks = this.getAudioTracks();
        if (!audioTracks.length) return null;
        const num = String(videoTrackId).replace(/\D/g, "");
        if (num) {
            const direct = audioTracks.find(t => t.id === `A${num}`);
            if (direct) return direct.id;
        }
        const videoTracks = this.getVideoTracks();
        const idxFromBottom = [...videoTracks].reverse().findIndex(t => t.id === videoTrackId);
        if (idxFromBottom >= 0 && idxFromBottom < audioTracks.length) return audioTracks[idxFromBottom].id;
        return audioTracks[0].id;
    }

    trackHeight(track) {
        return TRACK_HEIGHTS[track.kind] || TRACK_HEIGHTS.video;
    }

    /** Altura total ocupada por todas as pistas (px). */
    totalTracksHeight() {
        return this.tracks.reduce((sum, t) => sum + this.trackHeight(t), 0);
    }

    /** Substitui todo o conjunto de pistas (usado ao carregar timeline salva). */
    setTracks(tracks) {
        if (!Array.isArray(tracks) || tracks.length === 0) {
            this.tracks = defaultTracks();
        } else {
            // Normaliza e garante que exista uma pista de IA
            this.tracks = tracks.map(t => ({
                id: String(t.id),
                name: t.name || String(t.id),
                kind: t.kind || "video",
                volume: t.volume !== undefined ? Number(t.volume) : 1.0,
                muted: !!t.muted,
                locked: !!t.locked,
                magnetic: !!t.magnetic
            }));
            if (!this.tracks.some(t => t.kind === "ai")) {
                this.tracks.unshift({ id: "AI", name: "IA — Sugestões", kind: "ai", volume: 1.0, muted: false, locked: true, magnetic: false });
            }
        }
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    /** Adiciona uma nova pista de vídeo (logo abaixo da pista de IA). */
    addVideoTrack(name = null) {
        let n = 1;
        while (this.tracks.some(t => t.id === `V${n}`)) n++;
        const track = {
            id: `V${n}`,
            name: name || `V${n} Extra`,
            kind: "video",
            volume: 1.0,
            muted: false,
            locked: false,
            magnetic: false
        };
        TIMELINE_HISTORY.record(() => {
            // Insere abaixo da pista de IA (índice 1) para ficar no topo das pistas de vídeo
            const aiIdx = this.tracks.findIndex(t => t.kind === "ai");
            this.tracks.splice(aiIdx >= 0 ? aiIdx + 1 : 0, 0, track);
            STATE.emit("timelineTracksChanged", this.tracks);
        });
        return track;
    }

    /** Adiciona uma nova pista de áudio (sempre na base da timeline). */
    addAudioTrack(name = null) {
        let n = 1;
        while (this.tracks.some(t => t.id === `A${n}`)) n++;
        const track = {
            id: `A${n}`,
            name: name || `Áudio ${n}`,
            kind: "audio",
            volume: 1.0,
            muted: false,
            locked: false,
            magnetic: false
        };
        TIMELINE_HISTORY.record(() => {
            this.tracks.push(track);
            STATE.emit("timelineTracksChanged", this.tracks);
        });
        return track;
    }

    /** Remove uma pista (os clipes dela vão para a pista mais próxima do mesmo tipo). */
    removeTrack(trackId) {
        const idx = this.tracks.findIndex(t => t.id === trackId);
        if (idx === -1) return false;
        const track = this.tracks[idx];
        if (track.kind === "ai") return false; // pista de IA é permanente
        if (track.kind === "video" && this.getVideoTracks().length <= 1) return false; // sempre resta 1 pista de vídeo

        TIMELINE_HISTORY.record(() => {
            this.tracks.splice(idx, 1);
            const sameKind = this.tracks.filter(t => t.kind === track.kind);
            const fallback = sameKind.length ? sameKind[sameKind.length - 1] : null;

            let cuts = [...STATE.activeTimelineCuts];
            let changed = false;
            if (fallback) {
                // Move os clipes órfãos para outra pista do mesmo tipo
                cuts.forEach(c => {
                    if (c.track === trackId) {
                        c.track = fallback.id;
                        changed = true;
                    }
                });
            } else {
                // Última pista de áudio removida: clipes dela saem e os pares ficam desvinculados
                const removedLinks = new Set(cuts.filter(c => c.track === trackId && c.link_id).map(c => c.link_id));
                const before = cuts.length;
                cuts = cuts.filter(c => c.track !== trackId);
                changed = cuts.length !== before;
                cuts.forEach(c => {
                    if (c.link_id && removedLinks.has(c.link_id)) c.link_id = null;
                });
            }
            STATE.emit("timelineTracksChanged", this.tracks);
            if (changed) STATE.activeTimelineCuts = cuts;
            else STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
        });
        return true;
    }

    renameTrack(trackId, newName) {
        const track = this.getTrack(trackId);
        if (!track || !newName) return;
        TIMELINE_HISTORY.record(() => {
            track.name = newName.trim();
            STATE.emit("timelineTracksChanged", this.tracks);
        });
    }

    setTrackVolume(trackId, volume) {
        const track = this.getTrack(trackId);
        if (!track) return;
        track.volume = Math.max(0, Math.min(1, Number(volume)));
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackMute(trackId) {
        const track = this.getTrack(trackId);
        if (!track) return;
        track.muted = !track.muted;
        STATE.emit("timelineTracksChanged", this.tracks);
        STATE.emit("timelineCutsUpdated", STATE.activeTimelineCuts);
    }

    toggleTrackLock(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind === "ai") return;
        track.locked = !track.locked;
        STATE.emit("timelineTracksChanged", this.tracks);
    }

    toggleTrackMagnetic(trackId) {
        const track = this.getTrack(trackId);
        if (!track || track.kind !== "video") return; // ripple magnético só em pistas de vídeo
        TIMELINE_HISTORY.record(() => {
            track.magnetic = !track.magnetic;
            STATE.emit("timelineTracksChanged", this.tracks);
            // Reaplica o layout (o setter recalcula posições das pistas magnéticas)
            STATE.activeTimelineCuts = [...STATE.activeTimelineCuts];
        });
    }

    /** Serializa as pistas para persistência/API. */
    serializeTracks() {
        return this.tracks.map((t, idx) => ({
            id: t.id,
            name: t.name,
            kind: t.kind,
            order: idx,
            volume: t.volume,
            muted: t.muted,
            locked: t.locked,
            magnetic: t.magnetic
        }));
    }

    // ── SETTERS REATIVOS BÁSICOS ────────────────────────────────────────

    /**
     * Define o FPS do projeto/timeline.
     */
    setFps(val) {
        this.fps = Number(val) || 24;
        STATE.emit("timelineFpsChanged", this.fps);
    }

    /**
     * Define o nível de zoom.
     */
    setZoom(val) {
        // Limita o zoom entre 0.01 (100 frames por pixel) e 5.0 (5 pixels por frame)
        this.zoom = Math.max(0.01, Math.min(5.0, val));
        STATE.emit("timelineZoomChanged", this.zoom);
    }

    /**
     * Define o scroll horizontal em frames.
     */
    setScrollLeftFrame(val) {
        this.scrollLeftFrame = Math.max(0, Math.round(val));
        STATE.emit("timelineScrollChanged", this.scrollLeftFrame);
    }

    /**
     * Define o scroll vertical das pistas em pixels.
     */
    setScrollTop(val, viewportHeight = 0) {
        const maxScroll = Math.max(0, this.totalTracksHeight() - Math.max(0, viewportHeight));
        this.scrollTop = Math.max(0, Math.min(maxScroll, val));
        STATE.emit("timelineScrollChanged", this.scrollLeftFrame);
        STATE.emit("timelineVScrollChanged", this.scrollTop);
    }

    /**
     * Define a posição do playhead.
     */
    setPlayheadFrame(val) {
        this.playheadFrame = Math.max(0, val);
        STATE.emit("timelinePlayheadChanged", this.playheadFrame);
    }

    // ── CLIPES ──────────────────────────────────────────────────────────

    /**
     * Inicializa a lista de cortes com frames calculados se ainda não existirem.
     *
     * IMPORTANTE: frames de clipe são SEMPRE em fps da TIMELINE (não do vídeo fonte).
     * Misturar unidades fazia clipes de vídeos 30fps ocuparem mais timeline do que
     * têm de mídia (fim congelado) e desalinhava o playhead do Program.
     */
    conformCuts(cuts) {
        const fps = this.fps;
        return cuts.map((cut, index) => {
            const inFrame = cut.inFrame !== undefined ? cut.inFrame : secondsToFrames(cut.in, fps);
            const outFrame = cut.outFrame !== undefined ? cut.outFrame : secondsToFrames(cut.out, fps);

            return {
                ...cut,
                id: cut.id || `cut_${index}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                video_id: cut.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: cut.in !== undefined ? cut.in : framesToSeconds(inFrame, fps),
                out: cut.out !== undefined ? cut.out : framesToSeconds(outFrame, fps),
                track: cut.track || "V1",
                timelineStartFrame: cut.timelineStartFrame,
                link_id: cut.link_id || null
            };
        });
    }

    /**
     * Adiciona um novo corte à timeline de forma compatível e reativa.
     */
    addCut(videoId, inSec, outSec, track = null) {
        const video = STATE.allVideos.find(v => v.id === videoId);

        // Pista inexistente/travada vira roteamento automático
        if (track) {
            const t = this.getTrack(track);
            if (!t || t.kind !== "video") track = null;
        }

        // Sem pista definida: entrevistas vão para a pista magnética (falas);
        // b-rolls para a pista livre mais próxima da base (ex: V2, não uma V3 recém-criada no topo)
        if (!track) {
            const videoTracks = this.getVideoTracks();
            const magnetic = videoTracks.find(t => t.magnetic);
            const freeTracks = videoTracks.filter(t => !t.magnetic && !t.locked);
            const free = freeTracks.length ? freeTracks[freeTracks.length - 1] : null;
            if (video && video.video_type === "broll" && free) {
                track = free.id;
            } else {
                track = (magnetic || videoTracks[videoTracks.length - 1] || { id: "V1" }).id;
            }
        }

        const inFrame = secondsToFrames(inSec, this.fps);
        const outFrame = secondsToFrames(outSec, this.fps);
        const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Par A/V: o áudio nasce vinculado (link_id) na pista de áudio pareada
        const audioTrackId = this.pairedAudioTrackId(track);
        const linkId = audioTrackId ? `link_${stamp}` : null;

        const newCut = {
            id: `cut_${stamp}`,
            video_id: videoId,
            inFrame: inFrame,
            outFrame: outFrame,
            in: inSec,
            out: outSec,
            track: track,
            link_id: linkId
        };

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            currentCuts.push(newCut);
            if (audioTrackId) {
                currentCuts.push({
                    id: `cut_${stamp}_a`,
                    video_id: videoId,
                    inFrame: inFrame,
                    outFrame: outFrame,
                    in: inSec,
                    out: outSec,
                    track: audioTrackId,
                    link_id: linkId
                });
            }

            // Atualiza o estado global reativo
            STATE.activeTimelineCuts = currentCuts;
        });
        return newCut;
    }

    /**
     * Migração A/V: garante que existam pistas de áudio e cria clipes de áudio
     * vinculados para clipes de vídeo sem par (timelines antigas v1/v2 sem áudio).
     */
    migrateCutsToAV(cuts) {
        if (!this.getAudioTracks().length) {
            this.tracks.push(
                { id: "A1", name: "Áudio Falas", kind: "audio", volume: 1.0, muted: false, locked: false, magnetic: false },
                { id: "A2", name: "Áudio B-Roll", kind: "audio", volume: 1.0, muted: false, locked: false, magnetic: false }
            );
            STATE.emit("timelineTracksChanged", this.tracks);
        }

        const result = [...cuts];
        cuts.forEach((cut, idx) => {
            if (this.trackKindOf(cut.track) !== "video" || cut.link_id) return;
            const audioTrackId = this.pairedAudioTrackId(cut.track);
            if (!audioTrackId) return;
            const linkId = `link_migr_${idx}_${Date.now()}`;
            cut.link_id = linkId;
            result.push({
                ...cut,
                id: `${cut.id || `cut_migr_${idx}`}_a`,
                track: audioTrackId,
                link_id: linkId
            });
        });
        return result;
    }

    // ── SUGESTÕES DE IA (GHOST CLIPS) ───────────────────────────────────

    /**
     * Define as sugestões fantasma da IA (renderizadas na pista de IA).
     */
    setGhostSuggestions(suggestions) {
        const videoTracks = this.getVideoTracks();
        const fallbackTrack = videoTracks.length ? videoTracks[0].id : "V2";

        this.ghostTrack = suggestions.map((s, index) => {
            const fps = this.fps;
            const inFrame = s.inFrame !== undefined ? s.inFrame : secondsToFrames(s.in, fps);
            const outFrame = s.outFrame !== undefined ? s.outFrame : secondsToFrames(s.out, fps);

            return {
                id: s.id || `ghost_${index}_${Date.now()}`,
                video_id: s.video_id,
                inFrame: Math.round(inFrame),
                outFrame: Math.round(outFrame),
                in: s.in !== undefined ? s.in : framesToSeconds(inFrame, fps),
                out: s.out !== undefined ? s.out : framesToSeconds(outFrame, fps),
                // O backend envia timelineStartFrame: null + posição em segundos
                // (timeline_start ou timeline_start_s) — null NÃO pode virar frame 0
                timelineStartFrame: (s.timelineStartFrame !== undefined && s.timelineStartFrame !== null)
                    ? Math.round(s.timelineStartFrame)
                    : secondsToFrames(
                        (s.timeline_start_s !== undefined && s.timeline_start_s !== null)
                            ? s.timeline_start_s
                            : (s.timeline_start || 0),
                        fps
                    ),
                track: this.getTrack(s.track) ? s.track : fallbackTrack, // pista de DESTINO ao aceitar
                action: s.action || "INSERT", // "INSERT", "DELETE", "REPLACE"
                reason: s.reason || "Recomendação semântica da IA",
                persona: s.persona || null,
                targetClipId: s.targetClipId || s.target_clip_id || null, // Para exclusões ou substituições
                origin: s.origin || "ai",
                alternatives: s.alternatives || []
            };
        });
        STATE.emit("timelineGhostUpdated", this.ghostTrack);
    }

    /**
     * Aceita uma sugestão da IA e a integra como corte real na pista de destino.
     */
    acceptGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;

        const suggestion = this.ghostTrack[index];

        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            const stamp = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

            // Monta o par vídeo + áudio vinculado da sugestão
            const buildPair = (timelineStartFrame) => {
                const audioTrackId = this.pairedAudioTrackId(suggestion.track);
                const linkId = audioTrackId ? `link_${stamp}` : null;
                const base = {
                    video_id: suggestion.video_id,
                    inFrame: suggestion.inFrame,
                    outFrame: suggestion.outFrame,
                    in: suggestion.in,
                    out: suggestion.out,
                    link_id: linkId,
                    origin: suggestion.origin || "ai",
                    alternatives: suggestion.alternatives || []
                };
                const pair = [{ ...base, id: `cut_${stamp}`, track: suggestion.track, timelineStartFrame }];
                if (audioTrackId) {
                    pair.push({ ...base, id: `cut_${stamp}_a`, track: audioTrackId, timelineStartFrame });
                }
                return pair;
            };

            // Remove um clipe e o par vinculado a ele (mantendo a ordem dos demais)
            const removeWithPartner = (clipId) => {
                const target = currentCuts.find(c => c.id === clipId);
                if (!target) return;
                const removeIds = new Set([target.id]);
                if (target.link_id) {
                    currentCuts.forEach(c => { if (c.link_id === target.link_id) removeIds.add(c.id); });
                }
                for (let i = currentCuts.length - 1; i >= 0; i--) {
                    if (removeIds.has(currentCuts[i].id)) currentCuts.splice(i, 1);
                }
            };

            // REPLACE sem alvo válido degrada para INSERT na posição do ghost —
            // aceitar uma sugestão nunca pode ser um no-op silencioso
            let action = suggestion.action;
            if (action === "REPLACE" &&
                (!suggestion.targetClipId || !currentCuts.some(c => c.id === suggestion.targetClipId))) {
                console.warn(`[Timeline] REPLACE sem clipe alvo (${suggestion.targetClipId}); inserindo na posição sugerida.`);
                action = "INSERT";
            }

            if (action === "INSERT") {
                currentCuts.push(...buildPair(suggestion.timelineStartFrame));
            } else if (action === "DELETE" && suggestion.targetClipId) {
                removeWithPartner(suggestion.targetClipId);
            } else if (action === "REPLACE" && suggestion.targetClipId) {
                // Substitui no mesmo índice (preserva a ordem do ripple na pista magnética)
                const targetIdx = currentCuts.findIndex(c => c.id === suggestion.targetClipId);
                if (targetIdx !== -1) {
                    const old = currentCuts[targetIdx];
                    const pair = buildPair(old.timelineStartFrame);
                    currentCuts[targetIdx] = pair[0];
                    if (old.link_id) {
                        for (let i = currentCuts.length - 1; i >= 0; i--) {
                            const c = currentCuts[i];
                            if (c.link_id === old.link_id && c.id !== pair[0].id) currentCuts.splice(i, 1);
                        }
                    }
                    if (pair[1]) currentCuts.push(pair[1]);
                }
            }

            // Remove da lista de sugestões
            this.ghostTrack.splice(index, 1);

            // Ordena os cortes por início na timeline para que a inserção na pista magnética respeite a ordem cronológica
            currentCuts.sort((a, b) => {
                const startA = a.timelineStartFrame !== undefined ? a.timelineStartFrame : (a.timeline_start || 0) * this.fps;
                const startB = b.timelineStartFrame !== undefined ? b.timelineStartFrame : (b.timeline_start || 0) * this.fps;
                return startA - startB;
            });

            // Emite eventos
            STATE.activeTimelineCuts = currentCuts;
            STATE.emit("timelineGhostUpdated", this.ghostTrack);
        });
    }

    /**
     * Rejeita e descarta uma sugestão de IA.
     */
    rejectGhostSuggestion(ghostId) {
        const index = this.ghostTrack.findIndex(g => g.id === ghostId);
        if (index === -1) return;

        TIMELINE_HISTORY.record(() => {
            this.ghostTrack.splice(index, 1);
            STATE.emit("timelineGhostUpdated", this.ghostTrack);
        });
    }

    /**
     * Substitui a mídia de um clipe na timeline por uma candidata do carrossel de alternativas.
     */
    replaceClipWithAlternative(clipId, alternativeVideoId, newIn, newOut, useIdealDuration) {
        TIMELINE_HISTORY.record(() => {
            const currentCuts = this.conformCuts(STATE.activeTimelineCuts);
            const targetIdx = currentCuts.findIndex(c => c.id === clipId);
            if (targetIdx === -1) return;

            const targetVideoClip = currentCuts[targetIdx];
            const oldDuration = targetVideoClip.out - targetVideoClip.in;

            // Determinar nova duração do slot
            let newDuration = oldDuration;
            if (useIdealDuration) {
                newDuration = newOut - newIn;
            } else {
                newOut = newIn + oldDuration;
            }
            const delta = newDuration - oldDuration;

            // Encontrar parceiro de áudio
            const audioPartner = targetVideoClip.link_id
                ? currentCuts.find(c => c.link_id === targetVideoClip.link_id && c.id !== targetVideoClip.id)
                : null;

            // A mídia atual vira alternativa (a troca é reversível pelo carrossel)
            const alts = targetVideoClip.alternatives || [];
            if (!alts.some(a => a.video_id === targetVideoClip.video_id)) {
                alts.push({
                    video_id: targetVideoClip.video_id,
                    in_s: targetVideoClip.in,
                    out_s: targetVideoClip.out,
                    ideal_duration_s: oldDuration,
                    reason: "Escolha anterior neste slot"
                });
            }
            targetVideoClip.alternatives = alts;

            // Atualizar o vídeo original
            targetVideoClip.video_id = alternativeVideoId;
            targetVideoClip.in = newIn;
            targetVideoClip.out = newOut;
            targetVideoClip.inFrame = Math.round(newIn * this.fps);
            targetVideoClip.outFrame = Math.round(newOut * this.fps);

            // Atualizar o áudio parceiro
            if (audioPartner) {
                audioPartner.video_id = alternativeVideoId;
                audioPartner.in = newIn;
                audioPartner.out = newOut;
                audioPartner.inFrame = Math.round(newIn * this.fps);
                audioPartner.outFrame = Math.round(newOut * this.fps);
            }

            // Se for alteração de duração com ripple, empurra clipes seguintes da mesma trilha
            // (posições sempre derivadas de timelineStartFrame — timeline_start em segundos
            // pode estar obsoleto/ausente em clipes movidos manualmente)
            if (delta !== 0) {
                const trackId = targetVideoClip.track;
                const isMagnetic = this.getTrack(trackId)?.magnetic || false;

                if (!isMagnetic) {
                    const deltaFrames = Math.round(delta * this.fps);
                    const targetEndFrame = (targetVideoClip.timelineStartFrame || 0) + Math.round(oldDuration * this.fps);
                    currentCuts.forEach(c => {
                        if (c.track === trackId && c.id !== targetVideoClip.id &&
                            (c.timelineStartFrame || 0) >= targetEndFrame - 1) {
                            c.timelineStartFrame = Math.max(0, (c.timelineStartFrame || 0) + deltaFrames);
                            c.timeline_start = c.timelineStartFrame / this.fps;
                        }
                    });
                }
            }

            // Ordena os cortes por início na timeline para que a inserção na pista magnética respeite a ordem cronológica
            currentCuts.sort((a, b) => {
                const startA = a.timelineStartFrame !== undefined ? a.timelineStartFrame : (a.timeline_start || 0) * this.fps;
                const startB = b.timelineStartFrame !== undefined ? b.timelineStartFrame : (b.timeline_start || 0) * this.fps;
                return startA - startB;
            });

            // Atualiza os cortes
            STATE.activeTimelineCuts = currentCuts;
        });
    }

    /**
     * Divide um clipe em dois no frame especificado (playhead).
     */
    splitClip(clipId, splitFrame) {
        TIMELINE_HISTORY.record(() => {
            const currentCuts = [...STATE.activeTimelineCuts];
            const targetIdx = currentCuts.findIndex(c => c.id === clipId);
            if (targetIdx === -1) return;

            const clip = currentCuts[targetIdx];
            const fps = this.fps;

            // Verifica se o frame intersecta o clipe
            const startFrame = clip.timelineStartFrame || 0;
            const durationFrames = clip.outFrame - clip.inFrame;
            const endFrame = startFrame + durationFrames;

            if (splitFrame <= startFrame || splitFrame >= endFrame) {
                return; // Fora do clipe
            }

            // Descobrir se há clipe parceiro vinculado
            const partner = clip.link_id 
                ? currentCuts.find(c => c.link_id === clip.link_id && c.id !== clip.id)
                : null;

            const newLinkPartner = clip.link_id ? `link_${Date.now()}_${Math.floor(Math.random()*900+100)}` : null;

            const doSplit = (c, linkId) => {
                const cStart = c.timelineStartFrame || 0;
                const offsetFrames = splitFrame - cStart;
                
                // Criar o segundo clipe (parte direita)
                const secondClip = {
                    ...c,
                    id: `cut_${Date.now()}_${Math.floor(Math.random()*900+100)}_${c.id.endsWith("_a") ? "a" : "v"}`,
                    timelineStartFrame: splitFrame,
                    timeline_start: splitFrame / fps,
                    inFrame: c.inFrame + offsetFrames,
                    in: (c.inFrame + offsetFrames) / fps,
                    link_id: linkId
                };

                // Modificar o primeiro clipe (parte esquerda)
                c.outFrame = c.inFrame + offsetFrames;
                c.out = c.outFrame / fps;

                currentCuts.push(secondClip);
            };

            doSplit(clip, newLinkPartner);
            if (partner) {
                doSplit(partner, newLinkPartner);
            }

            STATE.activeTimelineCuts = currentCuts;
        });
    }
}

export const TIMELINE_STATE = new CapiauTimelineState();
window.TIMELINE_STATE = TIMELINE_STATE;

// --- HISTÓRICO DE UNDO/REDO (snapshots de clipes, pistas e sugestões) ---

class TimelineHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null; // snapshot pré-transação (para drags contínuos)
        this.limit = 100;
    }

    _capture() {
        return JSON.parse(JSON.stringify({
            cuts: STATE.activeTimelineCuts,
            tracks: TIMELINE_STATE.tracks,
            ghosts: TIMELINE_STATE.ghostTrack
        }));
    }

    /** Abre uma transação (ex: mousedown de um drag/trim). Idempotente. */
    begin() {
        if (!this.pending) this.pending = this._capture();
    }

    /** Fecha a transação: empilha o estado anterior somente se algo mudou. */
    commit() {
        if (!this.pending) return;
        const before = this.pending;
        this.pending = null;
        if (JSON.stringify(before) === JSON.stringify(this._capture())) return;
        this.undoStack.push(before);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        this.redoStack = [];
        this._notify();
    }

    /** Envolve uma operação pontual numa transação própria (ou adere à transação aberta). */
    record(fn) {
        if (this.pending) {
            fn();
            return;
        }
        this.begin();
        try {
            fn();
        } finally {
            this.commit();
        }
    }

    _restore(snap) {
        TIMELINE_STATE.selectedClipId = null;
        TIMELINE_STATE.selectedGhostClipId = null;
        TIMELINE_STATE.setTracks(snap.tracks);
        STATE.activeTimelineCuts = snap.cuts || [];
        TIMELINE_STATE.ghostTrack = snap.ghosts || [];
        STATE.emit("timelineGhostUpdated", TIMELINE_STATE.ghostTrack);
        this._notify();
    }

    undo() {
        if (!this.undoStack.length) return false;
        const current = this._capture();
        const snap = this.undoStack.pop();
        this.redoStack.push(current);
        this._restore(snap);
        return true;
    }

    redo() {
        if (!this.redoStack.length) return false;
        const current = this._capture();
        const snap = this.redoStack.pop();
        this.undoStack.push(current);
        this._restore(snap);
        return true;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
        this._notify();
    }

    _notify() {
        STATE.emit("timelineHistoryChanged", {
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0
        });
    }
}

export const TIMELINE_HISTORY = new TimelineHistory();
window.TIMELINE_HISTORY = TIMELINE_HISTORY;
