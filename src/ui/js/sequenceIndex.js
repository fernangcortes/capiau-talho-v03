// Índice de Sequência (Sequence Index — Estágio 2A)
// Painel tabular somente-leitura sobre a fachada TIMELINE_STATE:
// lista clipes, mídias offline, flash frames (<= 5 frames), transições,
// trilhas mutadas / clipes desativados, dessincronia A/V e marcadores,
// com busca/filtros combinados, salto direto ao corte e exportação CSV.

import { STATE } from "./state.js";
import {
    TIMELINE_STATE,
    framesToTimecode,
    getClipSyncStatus,
    resolveClipColorLabel,
    CLIP_COLOR_LABELS
} from "./timelineState.js";

export const FLASH_FRAME_MAX_FRAMES = 5;

const TRANSITION_LABELS = {
    video_cross_dissolve: "Cross Dissolve",
    cross_dissolve: "Cross Dissolve",
    video_dip_black: "Dip to Black",
    dip_to_black: "Dip to Black",
    video_dip_white: "Dip to White",
    dip_to_white: "Dip to White",
    audio_crossfade: "Crossfade Áudio",
    constant_power: "Potência Constante",
    linear_crossfade: "Crossfade Linear"
};

const TYPE_SORT_PRIORITY = {
    clip: 0,
    transition: 1,
    marker: 2
};

function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function csvEscape(value) {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function sanitizeFilenameSlug(name) {
    const clean = normalizeText(name || "sequencia")
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return clean || "sequencia";
}

function resolveKindFallback(trackId, cutType = null) {
    const idUpper = String(trackId || "").toUpperCase();
    if (cutType === "audio" || idUpper.startsWith("A")) return "audio";
    if (cutType === "text" || idUpper.startsWith("T")) return "text";
    if (idUpper === "AI") return "ai";
    return "video";
}

function formatTransitionLabel(tr) {
    if (!tr) return "Transição";
    if (tr.name) return String(tr.name);
    const key = String(tr.type || "").toLowerCase();
    return TRANSITION_LABELS[key] || (tr.type ? String(tr.type) : "Transição");
}

/**
 * Determina se um clipe aponta para uma mídia ausente/offline.
 * Clipes sintéticos (texto, camada de ajuste, cor sólida) nunca são offline.
 */
export function isCutOffline(cut, mediaCatalog = STATE) {
    if (!cut || typeof cut !== "object") return false;
    if (cut.type === "text" || cut.kind === "adjustment" || cut.kind === "color_matte") {
        return false;
    }
    if (
        cut.offline === true ||
        cut.is_offline === true ||
        cut.source_available === false ||
        cut.media_missing === true
    ) {
        return true;
    }

    if (cut.type === "photo") {
        if (cut.photo_id === null || cut.photo_id === undefined || cut.photo_id === "") {
            return true;
        }
        const photos = Array.isArray(mediaCatalog?.allPhotos) ? mediaCatalog.allPhotos : [];
        if (photos.length > 0) {
            const photo = photos.find(p => p && String(p.id) === String(cut.photo_id));
            if (!photo) return true;
            if (photo.offline === true || photo.source_available === false || photo.missing === true) {
                return true;
            }
        }
        return false;
    }

    const hasVideoId = cut.video_id !== null && cut.video_id !== undefined && cut.video_id !== "";
    const hasParentId = cut.parent_video_id !== null && cut.parent_video_id !== undefined && cut.parent_video_id !== "";
    if (!hasVideoId && !hasParentId) {
        return true;
    }

    const videos = Array.isArray(mediaCatalog?.allVideos) ? mediaCatalog.allVideos : [];
    if (videos.length > 0) {
        const video = (hasVideoId ? videos.find(v => v && String(v.id) === String(cut.video_id)) : null)
            || (hasParentId ? videos.find(v => v && String(v.id) === String(cut.parent_video_id)) : null);
        if (!video) return true;
        if (
            video.offline === true ||
            video.source_available === false ||
            video.missing === true ||
            video.proxy_status === "missing"
        ) {
            return true;
        }
    }

    return false;
}

/**
 * Constrói as linhas normalizadas do Índice de Sequência a partir de TIMELINE_STATE (somente leitura).
 */
export function buildSequenceIndexRows(timelineState = TIMELINE_STATE, mediaCatalog = STATE) {
    if (!timelineState) return [];

    const fps = Number(timelineState.fps) > 0 ? Number(timelineState.fps) : 24;
    const tracks = Array.isArray(timelineState.tracks) ? timelineState.tracks : [];
    const cuts = Array.isArray(timelineState.cuts)
        ? timelineState.cuts
        : (Array.isArray(mediaCatalog?.activeTimelineCuts) ? mediaCatalog.activeTimelineCuts : []);
    const transitions = Array.isArray(timelineState.transitions) ? timelineState.transitions : [];
    const markers = typeof timelineState.getMarkersSorted === "function"
        ? timelineState.getMarkersSorted()
        : (Array.isArray(timelineState.markers) ? [...timelineState.markers] : []);

    const trackMap = new Map();
    const trackOrderMap = new Map();
    tracks.forEach((tr, idx) => {
        if (!tr || !tr.id) return;
        trackMap.set(tr.id, tr);
        trackOrderMap.set(tr.id, idx);
    });

    const resolveTrackKind = (trackId, cutType = null) => {
        const t = trackMap.get(trackId);
        if (t && t.kind) return t.kind;
        if (typeof timelineState.trackKindOf === "function") {
            return timelineState.trackKindOf(trackId);
        }
        return resolveKindFallback(trackId, cutType);
    };

    const syncSeqAdapter = typeof timelineState.trackKindOf === "function"
        ? timelineState
        : {
            tracks,
            cuts,
            trackKindOf: (tid) => resolveTrackKind(tid)
        };

    const videos = Array.isArray(mediaCatalog?.allVideos) ? mediaCatalog.allVideos : [];
    const photos = Array.isArray(mediaCatalog?.allPhotos) ? mediaCatalog.allPhotos : [];
    const videoById = new Map();
    videos.forEach(v => {
        if (v && v.id !== undefined && v.id !== null) videoById.set(String(v.id), v);
    });
    const photoById = new Map();
    photos.forEach(p => {
        if (p && p.id !== undefined && p.id !== null) photoById.set(String(p.id), p);
    });

    const cutById = new Map();
    const cutNameById = new Map();
    const rows = [];

    // 1. Clipes
    for (const cut of cuts) {
        if (!cut) continue;

        const inFrame = cut.inFrame !== undefined && cut.inFrame !== null
            ? Math.round(Number(cut.inFrame) || 0)
            : Math.round((Number(cut.in) || 0) * fps);
        const outFrame = cut.outFrame !== undefined && cut.outFrame !== null
            ? Math.round(Number(cut.outFrame) || 0)
            : Math.round((Number(cut.out) || 0) * fps);
        const durationFrames = Math.max(0, outFrame - inFrame);

        const timelineInFrame = cut.timelineStartFrame !== undefined && cut.timelineStartFrame !== null
            ? Math.max(0, Math.round(Number(cut.timelineStartFrame) || 0))
            : Math.max(0, Math.round((Number(cut.timeline_start) || 0) * fps));
        const timelineOutFrame = timelineInFrame + durationFrames;

        const trackId = cut.track || "V1";
        const trackObj = trackMap.get(trackId) || null;
        const trackName = trackObj?.name || trackId;
        const trackKind = resolveTrackKind(trackId, cut.type);

        let mediaKind = "video";
        if (cut.kind === "adjustment") mediaKind = "adjustment";
        else if (cut.kind === "color_matte") mediaKind = "color_matte";
        else if (cut.type === "text" || trackKind === "text") mediaKind = "text";
        else if (cut.type === "photo") mediaKind = "photo";
        else if (trackKind === "audio" || cut.type === "audio") mediaKind = "audio";

        const video = (mediaKind === "video" || mediaKind === "audio")
            ? (videoById.get(String(cut.video_id)) || (cut.parent_video_id ? videoById.get(String(cut.parent_video_id)) : null))
            : null;
        const photo = mediaKind === "photo" ? photoById.get(String(cut.photo_id)) : null;

        let name;
        if (mediaKind === "text") {
            name = cut.text || cut.name || "Texto";
        } else if (mediaKind === "adjustment") {
            name = cut.name || "Camada de Ajuste";
        } else if (mediaKind === "color_matte") {
            name = cut.name || cut.color_name || "Cor Sólida";
        } else if (mediaKind === "photo") {
            name = cut.name || photo?.title || photo?.filename || (cut.photo_id != null ? `Foto ${cut.photo_id}` : "Foto");
        } else {
            name = cut.name || video?.title || video?.filename || (cut.video_id != null ? `Vídeo ${cut.video_id}` : "Clipe");
        }

        const isSyntheticOrStill = mediaKind === "text" || mediaKind === "adjustment" || mediaKind === "color_matte" || mediaKind === "photo";
        let sourceInFrame = null;
        let sourceOutFrame = null;
        let sourceInTc = "—";
        let sourceOutTc = "—";
        if (!isSyntheticOrStill) {
            sourceInFrame = typeof cut.in === "number" && Number.isFinite(cut.in) ? Math.round(cut.in * fps) : inFrame;
            sourceOutFrame = typeof cut.out === "number" && Number.isFinite(cut.out) ? Math.round(cut.out * fps) : outFrame;
            sourceInTc = framesToTimecode(sourceInFrame, fps);
            sourceOutTc = framesToTimecode(sourceOutFrame, fps);
        }

        const colorLabel = resolveClipColorLabel(cut.colorLabel ?? cut.color_label);
        const colorHex = colorLabel ? colorLabel.hex : (mediaKind === "color_matte" && cut.color ? cut.color : null);

        const speed = typeof cut.speed === "number" && Number.isFinite(cut.speed) ? cut.speed : 1.0;
        const reverse = Boolean(cut.reverse);
        const isFreeze = Boolean(cut.is_freeze);

        const offline = isCutOffline(cut, mediaCatalog);
        const flashFrame = durationFrames >= 1 && durationFrames <= FLASH_FRAME_MAX_FRAMES;
        const mutedTrack = Boolean(trackObj && (trackObj.muted || trackObj.hidden));
        const disabledClip = cut.disabled === true;
        const mutedOrDisabled = mutedTrack || disabledClip;
        const syncInfo = getClipSyncStatus(cut, cuts, syncSeqAdapter);
        const outOfSync = Boolean(syncInfo && syncInfo.offset !== 0);
        const syncOffsetFrames = syncInfo ? syncInfo.offset : 0;
        const syncText = syncInfo ? syncInfo.text : "";
        const hasAlert = offline || flashFrame || mutedOrDisabled || outOfSync;

        const badges = [];
        if (offline) badges.push({ kind: "offline", text: "OFFLINE", tone: "rose" });
        if (flashFrame) badges.push({ kind: "flash", text: `FLASH ${durationFrames}f`, tone: "amber" });
        if (mutedTrack) badges.push({ kind: "muted", text: trackObj?.hidden ? "OCULTA" : "MUTADO", tone: "amber" });
        if (disabledClip) badges.push({ kind: "disabled", text: "DESAT.", tone: "amber" });
        if (outOfSync) badges.push({ kind: "sync", text: `SYNC ${syncText}f`, tone: "rose" });
        if (isFreeze) badges.push({ kind: "freeze", text: "FREEZE", tone: "info" });
        if (Math.abs(speed - 1.0) > 0.001) badges.push({ kind: "speed", text: `${Math.round(speed * 100)}%`, tone: "info" });
        if (reverse) badges.push({ kind: "reverse", text: "REV", tone: "info" });

        const noteParts = [];
        if (mediaKind === "text" && cut.subtext) noteParts.push(String(cut.subtext));
        if (isFreeze) noteParts.push("Quadro congelado");
        if (Math.abs(speed - 1.0) > 0.001) noteParts.push(`Velocidade ${Math.round(speed * 100)}%`);
        if (reverse) noteParts.push("Reverso");
        if (outOfSync) noteParts.push(`Dessincronia A/V (${syncText}f)`);

        const cutIdStr = String(cut.id);
        cutById.set(cutIdStr, cut);
        cutNameById.set(cutIdStr, name);

        rows.push({
            index: 0,
            id: `clip:${cutIdStr}`,
            targetId: cutIdStr,
            entryType: "clip",
            typeLabel: "Clipe",
            trackId,
            trackName,
            trackKind,
            mediaKind,
            name,
            timelineInFrame,
            timelineOutFrame,
            durationFrames,
            timelineInTc: framesToTimecode(timelineInFrame, fps),
            timelineOutTc: framesToTimecode(timelineOutFrame, fps),
            durationTc: framesToTimecode(durationFrames, fps),
            sourceInFrame,
            sourceOutFrame,
            sourceInTc,
            sourceOutTc,
            colorLabel,
            colorHex,
            colorName: colorLabel?.name || "",
            speed,
            reverse,
            isFreeze,
            flags: {
                offline,
                flashFrame,
                mutedTrack,
                disabledClip,
                mutedOrDisabled,
                outOfSync,
                syncOffsetFrames,
                syncText,
                hasAlert
            },
            badges,
            notes: noteParts.join(" · ")
        });
    }

    // 2. Transições
    for (const tr of transitions) {
        if (!tr) continue;
        const cutFrame = Math.max(0, Math.round(Number(tr.cutFrame) || 0));
        const rawDur = Number(tr.durationFrames);
        const halfA = Number.isFinite(Number(tr.halfAFrames))
            ? Math.max(0, Math.round(Number(tr.halfAFrames)))
            : Math.floor((Number.isFinite(rawDur) ? rawDur : 0) / 2);
        const halfB = Number.isFinite(Number(tr.halfBFrames))
            ? Math.max(0, Math.round(Number(tr.halfBFrames)))
            : Math.ceil((Number.isFinite(rawDur) ? rawDur : 0) / 2);
        const durationFrames = Number.isFinite(rawDur) && rawDur > 0 ? Math.round(rawDur) : (halfA + halfB);
        const timelineInFrame = Math.max(0, cutFrame - halfA);
        const timelineOutFrame = timelineInFrame + durationFrames;

        const trackId = tr.track || "V1";
        const trackObj = trackMap.get(trackId) || null;
        const trackName = trackObj?.name || trackId;
        const trackKind = resolveTrackKind(trackId, tr.kind);
        const mutedTrack = Boolean(trackObj && (trackObj.muted || trackObj.hidden));
        const mutedOrDisabled = mutedTrack;
        const hasAlert = mutedOrDisabled;

        const badges = [];
        if (mutedTrack) badges.push({ kind: "muted", text: trackObj?.hidden ? "OCULTA" : "MUTADO", tone: "amber" });

        const clipAName = tr.clipAId != null ? cutNameById.get(String(tr.clipAId)) : null;
        const clipBName = tr.clipBId != null ? cutNameById.get(String(tr.clipBId)) : null;
        const noteParts = [`Corte em ${framesToTimecode(cutFrame, fps)}`];
        if (clipAName || clipBName) {
            noteParts.push(`${clipAName || "?"} → ${clipBName || "?"}`);
        }
        if (tr.curve) noteParts.push(`curva ${tr.curve}`);

        const trIdStr = String(tr.id);
        rows.push({
            index: 0,
            id: `transition:${trIdStr}`,
            targetId: trIdStr,
            entryType: "transition",
            typeLabel: "Transição",
            trackId,
            trackName,
            trackKind,
            mediaKind: tr.kind === "audio" ? "audio_transition" : "video_transition",
            name: formatTransitionLabel(tr),
            cutFrame,
            timelineInFrame,
            timelineOutFrame,
            durationFrames,
            timelineInTc: framesToTimecode(timelineInFrame, fps),
            timelineOutTc: framesToTimecode(timelineOutFrame, fps),
            durationTc: framesToTimecode(durationFrames, fps),
            sourceInFrame: null,
            sourceOutFrame: null,
            sourceInTc: "—",
            sourceOutTc: "—",
            colorLabel: null,
            colorHex: null,
            colorName: "",
            speed: 1.0,
            reverse: false,
            isFreeze: false,
            flags: {
                offline: false,
                flashFrame: false,
                mutedTrack,
                disabledClip: false,
                mutedOrDisabled,
                outOfSync: false,
                syncOffsetFrames: 0,
                syncText: "",
                hasAlert
            },
            badges,
            notes: noteParts.join(" · ")
        });
    }

    // 3. Marcadores
    for (const m of markers) {
        if (!m) continue;
        const frame = Math.max(0, Math.round(Number(m.frame) || 0));
        const linkedCut = m.clipId ? cutById.get(String(m.clipId)) : null;
        const trackId = linkedCut?.track || "RÉGUA";
        const trackName = linkedCut ? (trackMap.get(linkedCut.track)?.name || linkedCut.track) : "Régua";
        const colorHex = m.color || "#06b6d4";
        const colorLabel = resolveClipColorLabel(colorHex);
        const comment = m.comment ? String(m.comment) : "";
        const linkedClipName = linkedCut ? cutNameById.get(String(linkedCut.id)) : "";
        const noteParts = [];
        if (comment) noteParts.push(comment);
        if (linkedClipName) noteParts.push(`Clipe: ${linkedClipName}`);

        const markerIdStr = String(m.id);
        const frameTc = framesToTimecode(frame, fps);

        rows.push({
            index: 0,
            id: `marker:${markerIdStr}`,
            targetId: markerIdStr,
            entryType: "marker",
            typeLabel: "Marcador",
            clipId: m.clipId || null,
            trackId,
            trackName,
            trackKind: "marker",
            mediaKind: linkedCut ? "clip_marker" : "ruler_marker",
            name: m.label || m.name || "Marcador",
            timelineInFrame: frame,
            timelineOutFrame: frame,
            durationFrames: 0,
            timelineInTc: frameTc,
            timelineOutTc: frameTc,
            durationTc: "00:00:00:00",
            sourceInFrame: null,
            sourceOutFrame: null,
            sourceInTc: "—",
            sourceOutTc: "—",
            colorLabel,
            colorHex,
            colorName: colorLabel?.name || colorHex,
            comment,
            speed: 1.0,
            reverse: false,
            isFreeze: false,
            flags: {
                offline: false,
                flashFrame: false,
                mutedTrack: false,
                disabledClip: false,
                mutedOrDisabled: false,
                outOfSync: false,
                syncOffsetFrames: 0,
                syncText: "",
                hasAlert: false
            },
            badges: [],
            notes: noteParts.join(" · ")
        });
    }

    rows.sort((a, b) => {
        if (a.timelineInFrame !== b.timelineInFrame) {
            return a.timelineInFrame - b.timelineInFrame;
        }
        const pa = TYPE_SORT_PRIORITY[a.entryType] ?? 9;
        const pb = TYPE_SORT_PRIORITY[b.entryType] ?? 9;
        if (pa !== pb) return pa - pb;
        const ta = trackOrderMap.has(a.trackId) ? trackOrderMap.get(a.trackId) : 999;
        const tb = trackOrderMap.has(b.trackId) ? trackOrderMap.get(b.trackId) : 999;
        if (ta !== tb) return ta - tb;
        return String(a.name).localeCompare(String(b.name));
    });

    rows.forEach((row, idx) => {
        row.index = idx + 1;
    });

    return rows;
}

/**
 * Calcula contadores agregados das linhas do Índice de Sequência.
 */
export function computeSequenceIndexSummary(rows = []) {
    const summary = {
        total: 0,
        clips: 0,
        transitions: 0,
        markers: 0,
        alerts: 0,
        offline: 0,
        flashFrames: 0,
        muted: 0,
        outOfSync: 0
    };

    for (const row of rows || []) {
        if (!row) continue;
        summary.total += 1;
        if (row.entryType === "clip") summary.clips += 1;
        else if (row.entryType === "transition") summary.transitions += 1;
        else if (row.entryType === "marker") summary.markers += 1;

        const flags = row.flags || {};
        if (flags.hasAlert) summary.alerts += 1;
        if (flags.offline) summary.offline += 1;
        if (flags.flashFrame) summary.flashFrames += 1;
        if (flags.mutedOrDisabled) summary.muted += 1;
        if (flags.outOfSync) summary.outOfSync += 1;
    }

    return summary;
}

/**
 * Filtra as linhas por categoria/diagnóstico, pista, rótulo de cor e busca textual.
 */
export function filterSequenceIndexRows(
    rows = [],
    { query = "", filter = "all", trackFilter = "all", colorFilter = "all" } = {}
) {
    const normQuery = normalizeText(query);
    const activeFilter = filter || "all";
    const activeTrack = trackFilter || "all";
    const activeColor = colorFilter || "all";

    return (rows || []).filter(row => {
        if (!row) return false;
        const flags = row.flags || {};

        if (activeFilter === "clips" && row.entryType !== "clip") return false;
        if (activeFilter === "transitions" && row.entryType !== "transition") return false;
        if (activeFilter === "markers" && row.entryType !== "marker") return false;
        if (activeFilter === "alerts" && !flags.hasAlert) return false;
        if (activeFilter === "offline" && !flags.offline) return false;
        if (activeFilter === "flash" && !flags.flashFrame) return false;
        if (activeFilter === "muted" && !flags.mutedOrDisabled) return false;
        if (activeFilter === "sync" && !flags.outOfSync) return false;

        if (activeTrack !== "all" && row.trackId !== activeTrack) return false;

        if (activeColor !== "all") {
            const rowColorId = row.colorLabel?.id || null;
            if (activeColor === "none") {
                if (rowColorId || row.colorHex) return false;
            } else if (rowColorId !== activeColor) {
                return false;
            }
        }

        if (normQuery) {
            const badgeText = (row.badges || []).map(b => b.text).join(" ");
            const haystack = normalizeText([
                row.name,
                row.typeLabel,
                row.trackId,
                row.trackName,
                row.timelineInTc,
                row.timelineOutTc,
                row.durationTc,
                row.sourceInTc,
                row.sourceOutTc,
                row.colorName,
                row.comment,
                row.notes,
                badgeText
            ].join(" "));
            if (!haystack.includes(normQuery)) return false;
        }

        return true;
    });
}

/**
 * Gera string CSV UTF-8 (com BOM) das linhas do Índice de Sequência.
 */
export function exportSequenceIndexToCSV(rows = [], sequenceMeta = {}) {
    const header = [
        "#",
        "Tipo",
        "Pista",
        "Nome",
        "Timeline IN",
        "Timeline OUT",
        "Duracao",
        "Frames",
        "Fonte IN",
        "Fonte OUT",
        "Cor",
        "Status",
        "Notas"
    ];

    const lines = [header.map(csvEscape).join(",")];
    for (const row of rows || []) {
        if (!row) continue;
        const badgeTexts = (row.badges || []).map(b => b.text);
        const status = badgeTexts.length > 0 ? badgeTexts.join(" | ") : "OK";
        const color = row.colorLabel?.name || row.colorHex || "";
        const cols = [
            row.index ?? "",
            row.typeLabel || row.entryType || "",
            row.trackId || "",
            row.name || "",
            row.timelineInTc || "",
            row.timelineOutTc || "",
            row.durationTc || "",
            row.durationFrames ?? 0,
            row.sourceInTc || "—",
            row.sourceOutTc || "—",
            color,
            status,
            row.notes || ""
        ];
        lines.push(cols.map(csvEscape).join(","));
    }

    return `\uFEFF${lines.join("\r\n")}`;
}

/**
 * Move o playhead para a linha escolhida e seleciona o item correspondente na timeline.
 */
export function jumpToSequenceIndexRow(row, timelineState = TIMELINE_STATE, options = {}) {
    if (!row || !timelineState) return false;

    const targetFrame = (row.entryType === "transition" && Number.isFinite(Number(row.cutFrame)))
        ? Math.max(0, Math.round(Number(row.cutFrame)))
        : Math.max(0, Math.round(Number(row.timelineInFrame) || 0));

    if (typeof timelineState.setPlayheadFrame === "function") {
        timelineState.setPlayheadFrame(targetFrame);
    } else {
        timelineState.playheadFrame = targetFrame;
    }

    if (row.entryType === "clip") {
        if (typeof timelineState.selectClip === "function") {
            timelineState.selectClip(row.targetId, false);
        }
    } else if (row.entryType === "marker") {
        if (typeof timelineState.selectMarker === "function") {
            timelineState.selectMarker(row.targetId, false);
        }
    } else if (row.entryType === "transition") {
        timelineState.selectedTransitionId = row.targetId;
        if (typeof timelineState._emit === "function") {
            timelineState._emit("timelineTransitionsChanged", timelineState.transitions || []);
        }
    }

    const interaction = options.interaction || (typeof window !== "undefined"
        ? (window.timelineInteraction || window.panelsManager?.timelineInteraction || window.TIMELINE_INTERACTION)
        : null);
    if (interaction && typeof interaction.ensureFrameVisible === "function") {
        interaction.ensureFrameVisible(targetFrame);
    }

    const renderer = options.renderer || interaction?.renderer || (typeof window !== "undefined"
        ? (window.TIMELINE_RENDERER || window.TIMELINE_INTERACTION?.renderer)
        : null);
    if (row.entryType === "clip" && renderer && typeof renderer.flashMatchOccurrences === "function") {
        renderer.flashMatchOccurrences([row.targetId], 1200);
    } else if (renderer && typeof renderer.requestRedraw === "function") {
        renderer.requestRedraw();
    }

    return true;
}

const FILTER_DEFS = [
    { id: "all", label: "Todos", countKey: "total" },
    { id: "clips", label: "Clipes", countKey: "clips" },
    { id: "transitions", label: "Transições", countKey: "transitions" },
    { id: "markers", label: "Marcadores", countKey: "markers" },
    { id: "alerts", label: "Alertas", countKey: "alerts", alertChip: true },
    { id: "offline", label: "Offline", countKey: "offline", alertChip: true },
    { id: "flash", label: "Flash ≤5f", countKey: "flashFrames", alertChip: true },
    { id: "muted", label: "Mutados", countKey: "muted", alertChip: true },
    { id: "sync", label: "Sync A/V", countKey: "outOfSync", alertChip: true }
];

export class SequenceIndex {
    constructor(containerId = "sequence-index-container") {
        this.containerId = containerId;
        this.container = typeof document !== "undefined" ? document.getElementById(containerId) : null;
        this.query = "";
        this.filter = "all";
        this.trackFilter = "all";
        this.colorFilter = "all";
        this.followPlayhead = true;
        this.selectedRowId = null;
        this._allRows = [];
        this._filteredRows = [];
        this._summary = computeSequenceIndexSummary([]);
        this._rafPending = false;
        this._dirty = true;
        this._listenersBound = false;

        if (this.container) {
            this._bindDom();
            this._bindStateEvents();
            this._syncFollowButton();
            this.render();
        }
    }

    _el(selector) {
        return this.container ? this.container.querySelector(selector) : null;
    }

    isVisible() {
        if (!this.container || !this.container.isConnected) return false;
        const doc = this.container.ownerDocument || (typeof document !== "undefined" ? document : null);
        const win = doc?.defaultView;
        if (win && typeof win.getComputedStyle === "function") {
            return win.getComputedStyle(this.container).display !== "none";
        }
        return this.container.style.display !== "none";
    }

    _bindDom() {
        const searchInput = this._el("#seq-index-search");
        const clearSearchBtn = this._el("#btn-seq-index-clear-search");
        const trackSelect = this._el("#seq-index-track-filter");
        const colorSelect = this._el("#seq-index-color-filter");
        const chipsBox = this._el("#seq-index-filter-chips");
        const followBtn = this._el("#btn-seq-index-follow");
        const refreshBtn = this._el("#btn-seq-index-refresh");
        const exportCsvBtn = this._el("#btn-seq-index-export-csv");
        const tableWrapper = this._el("#seq-index-table-wrapper");

        if (colorSelect && colorSelect.options.length <= 2) {
            colorSelect.innerHTML = [
                `<option value="all">Todas as cores</option>`,
                `<option value="none">Sem cor</option>`,
                ...CLIP_COLOR_LABELS.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
            ].join("");
        }

        if (searchInput) {
            ["keydown", "keyup", "keypress"].forEach(evtName => {
                searchInput.addEventListener(evtName, (e) => {
                    e.stopPropagation();
                    if (evtName === "keydown" && e.key === "Escape") {
                        if (searchInput.value) {
                            searchInput.value = "";
                            this.query = "";
                            this._syncClearSearchBtn();
                            this.render();
                        } else {
                            searchInput.blur();
                        }
                    }
                });
            });
            searchInput.addEventListener("input", () => {
                this.query = searchInput.value || "";
                this._syncClearSearchBtn();
                this.render();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener("click", () => {
                this.query = "";
                if (searchInput) searchInput.value = "";
                this._syncClearSearchBtn();
                this.render();
            });
        }

        if (trackSelect) {
            trackSelect.addEventListener("change", () => {
                this.trackFilter = trackSelect.value || "all";
                this.render();
            });
        }

        if (colorSelect) {
            colorSelect.addEventListener("change", () => {
                this.colorFilter = colorSelect.value || "all";
                this.render();
            });
        }

        if (chipsBox) {
            chipsBox.addEventListener("click", (e) => {
                const chip = e.target.closest("[data-seq-filter]");
                if (!chip) return;
                this.filter = chip.dataset.seqFilter || "all";
                this.render();
            });
        }

        if (followBtn) {
            followBtn.addEventListener("click", () => {
                this.followPlayhead = !this.followPlayhead;
                this._syncFollowButton();
                if (this.followPlayhead) {
                    this.updatePlayheadHighlight(TIMELINE_STATE.playheadFrame || 0, { scroll: true });
                }
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener("click", () => {
                this.render({ force: true });
            });
        }

        if (exportCsvBtn) {
            exportCsvBtn.addEventListener("click", () => {
                this.downloadCSV();
            });
        }

        if (tableWrapper) {
            tableWrapper.addEventListener("click", (e) => {
                const tr = e.target.closest("tr.seq-index-row");
                if (!tr) return;
                const rowId = tr.dataset.rowId;
                const row = this._filteredRows.find(r => r.id === rowId) || this._allRows.find(r => r.id === rowId);
                if (!row) return;
                this.selectedRowId = row.id;
                jumpToSequenceIndexRow(row, TIMELINE_STATE);
                this._syncSelectionClasses();
            });
        }
    }

    _bindStateEvents() {
        if (this._listenersBound || typeof STATE === "undefined" || !STATE || typeof STATE.on !== "function") {
            return;
        }
        this._listenersBound = true;

        const schedule = () => this.scheduleRefresh();
        [
            "timelineCutsUpdated",
            "timelineTracksChanged",
            "timelineMarkersChanged",
            "timelineTransitionsChanged",
            "timelineFpsChanged",
            "timelinePropertiesChanged",
            "timelineRestored",
            "activeSequenceChanged",
            "videosUpdated",
            "photosUpdated"
        ].forEach(evt => STATE.on(evt, schedule));

        STATE.on("timelineSelectionChanged", (selectedClipId) => {
            if (selectedClipId) {
                this.selectedRowId = `clip:${String(selectedClipId)}`;
            }
            this._syncSelectionClasses();
        });

        STATE.on("timelinePlayheadChanged", (frame) => {
            if (!this.isVisible()) return;
            this.updatePlayheadHighlight(frame, { scroll: this.followPlayhead });
        });

        STATE.on("rightTabChanged", (tab) => {
            if (tab === "index") {
                this.render({ force: true });
            }
        });
    }

    _syncClearSearchBtn() {
        const btn = this._el("#btn-seq-index-clear-search");
        if (btn) {
            btn.style.display = this.query ? "inline-flex" : "none";
        }
    }

    _syncFollowButton() {
        const btn = this._el("#btn-seq-index-follow");
        if (btn) {
            btn.classList.toggle("toggle-on", Boolean(this.followPlayhead));
        }
    }

    scheduleRefresh() {
        this._dirty = true;
        if (!this.isVisible()) return;
        if (this._rafPending) return;
        this._rafPending = true;
        const scheduleFn = typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb) => setTimeout(cb, 16);
        scheduleFn(() => {
            this._rafPending = false;
            if (this.isVisible()) {
                this.render({ force: true });
            }
        });
    }

    onPopoutReady(_win) {
        this.render({ force: true });
    }

    _syncTrackSelectOptions() {
        const trackSelect = this._el("#seq-index-track-filter");
        if (!trackSelect) return;

        const tracks = Array.isArray(TIMELINE_STATE?.tracks) ? TIMELINE_STATE.tracks : [];
        const options = [{ value: "all", label: "Todas as pistas" }];
        const seen = new Set(["all"]);

        for (const tr of tracks) {
            if (!tr || !tr.id || seen.has(tr.id)) continue;
            seen.add(tr.id);
            options.push({
                value: tr.id,
                label: tr.name && tr.name !== tr.id ? `${tr.id} · ${tr.name}` : tr.id
            });
        }

        const hasRulerMarker = this._allRows.some(r => r.trackId === "RÉGUA");
        if (hasRulerMarker && !seen.has("RÉGUA")) {
            seen.add("RÉGUA");
            options.push({ value: "RÉGUA", label: "RÉGUA · Marcadores" });
        }

        for (const row of this._allRows) {
            if (row.trackId && !seen.has(row.trackId)) {
                seen.add(row.trackId);
                options.push({ value: row.trackId, label: row.trackId });
            }
        }

        if (!seen.has(this.trackFilter)) {
            this.trackFilter = "all";
        }

        const signature = options.map(o => `${o.value}:${o.label}`).join("|");
        if (trackSelect.dataset.optionsSig !== signature) {
            trackSelect.innerHTML = options
                .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
                .join("");
            trackSelect.dataset.optionsSig = signature;
        }
        trackSelect.value = this.trackFilter;
    }

    _renderFilterChips() {
        const chipsBox = this._el("#seq-index-filter-chips");
        if (!chipsBox) return;

        chipsBox.innerHTML = FILTER_DEFS.map(def => {
            const count = this._summary[def.countKey] ?? 0;
            const isActive = this.filter === def.id;
            const hasAlertCount = Boolean(def.alertChip && count > 0);
            const cls = [
                "seq-index-chip",
                isActive ? "is-active" : "",
                hasAlertCount ? "has-alerts" : ""
            ].filter(Boolean).join(" ");
            return `<button type="button" class="${cls}" data-seq-filter="${escapeHtml(def.id)}">
                <span>${escapeHtml(def.label)}</span>
                <span class="seq-index-chip-count">${count}</span>
            </button>`;
        }).join("");
    }

    _renderMetaBar() {
        const metaEl = this._el("#seq-index-meta-bar");
        if (!metaEl) return;
        const seqName = TIMELINE_STATE?.name || "Sequência Principal";
        const fps = Number(TIMELINE_STATE?.fps) || 24;
        const shown = this._filteredRows.length;
        const total = this._allRows.length;
        const alerts = this._summary.alerts;

        metaEl.innerHTML = `
            <span class="seq-index-meta-seq" data-tooltip="${escapeHtml(seqName)}">${escapeHtml(seqName)} · ${fps} fps</span>
            <span class="seq-index-meta-counts">${shown} de ${total} ${total === 1 ? "item" : "itens"}${alerts > 0 ? ` · <span class="seq-index-meta-alert">${alerts} ${alerts === 1 ? "alerta" : "alertas"}</span>` : ""}</span>
        `;
    }

    _buildRowTooltip(row) {
        const parts = [
            `#${row.index} ${row.typeLabel}: ${row.name}`,
            `Pista: ${row.trackId} (${row.trackName})`,
            `Timeline: ${row.timelineInTc} → ${row.timelineOutTc} (${row.durationTc}, ${row.durationFrames}f)`
        ];
        if (row.sourceInTc && row.sourceInTc !== "—") {
            parts.push(`Fonte: ${row.sourceInTc} → ${row.sourceOutTc}`);
        }
        if (row.colorName) {
            parts.push(`Cor: ${row.colorName}`);
        }
        if (row.badges && row.badges.length > 0) {
            parts.push(`Status: ${row.badges.map(b => b.text).join(", ")}`);
        }
        if (row.notes) {
            parts.push(row.notes);
        }
        parts.push("Clique para saltar a agulha e selecionar");
        return parts.join(" | ");
    }

    _renderTable() {
        const wrapper = this._el("#seq-index-table-wrapper");
        if (!wrapper) return;

        if (this._allRows.length === 0) {
            wrapper.innerHTML = `
                <div class="empty-state seq-index-empty">
                    <i class="fa-solid fa-table-list"></i>
                    <p>Nenhum clipe, transição ou marcador na sequência atual.</p>
                </div>`;
            return;
        }

        if (this._filteredRows.length === 0) {
            wrapper.innerHTML = `
                <div class="empty-state seq-index-empty">
                    <i class="fa-solid fa-filter-circle-xmark"></i>
                    <p>Nenhum item corresponde aos filtros aplicados.</p>
                </div>`;
            return;
        }

        const playhead = Number(TIMELINE_STATE?.playheadFrame) || 0;
        const selectedClipId = TIMELINE_STATE?.selectedClipId ? String(TIMELINE_STATE.selectedClipId) : null;
        const selectedTransId = TIMELINE_STATE?.selectedTransitionId ? String(TIMELINE_STATE.selectedTransitionId) : null;
        const selectedMarkers = TIMELINE_STATE?.selectedMarkerIds;

        const rowsHtml = this._filteredRows.map(row => {
            const isSelected = (
                row.id === this.selectedRowId ||
                (row.entryType === "clip" && selectedClipId && row.targetId === selectedClipId) ||
                (row.entryType === "transition" && selectedTransId && row.targetId === selectedTransId) ||
                (row.entryType === "marker" && selectedMarkers && typeof selectedMarkers.has === "function" && selectedMarkers.has(row.targetId))
            );
            const atPlayhead = this._isFrameOnRow(playhead, row);
            const rowClasses = [
                "seq-index-row",
                `kind-${row.entryType}`,
                row.flags?.hasAlert ? "has-alert" : "",
                isSelected ? "is-selected" : "",
                atPlayhead ? "is-at-playhead" : ""
            ].filter(Boolean).join(" ");

            const swatchHtml = row.colorHex
                ? `<span class="seq-index-swatch" style="background-color: ${escapeHtml(row.colorHex)};"></span>`
                : `<span class="seq-index-swatch is-empty"></span>`;

            const trackToneClass = `track-${row.trackKind || "video"}`;
            const typeIcon = row.entryType === "marker"
                ? `<i class="fa-solid fa-bookmark seq-index-kind-icon"></i>`
                : (row.entryType === "transition"
                    ? `<i class="fa-solid fa-wand-sparkles seq-index-kind-icon"></i>`
                    : (row.mediaKind === "photo"
                        ? `<i class="fa-regular fa-image seq-index-kind-icon"></i>`
                        : (row.mediaKind === "text"
                            ? `<i class="fa-solid fa-font seq-index-kind-icon"></i>`
                            : (row.mediaKind === "audio"
                                ? `<i class="fa-solid fa-volume-high seq-index-kind-icon"></i>`
                                : `<i class="fa-solid fa-film seq-index-kind-icon"></i>`))));

            const badgesHtml = (row.badges || []).map(b =>
                `<span class="seq-index-badge is-${escapeHtml(b.kind)} tone-${escapeHtml(b.tone)}">${escapeHtml(b.text)}</span>`
            ).join("");

            const notesHtml = row.notes
                ? `<span class="seq-index-notes">${escapeHtml(row.notes)}</span>`
                : "";

            const durLabel = row.entryType === "marker"
                ? "0f"
                : `${row.durationFrames}f`;

            return `
                <tr class="${rowClasses}"
                    data-row-id="${escapeHtml(row.id)}"
                    data-entry-type="${escapeHtml(row.entryType)}"
                    data-in-frame="${row.timelineInFrame}"
                    data-out-frame="${row.timelineOutFrame}"
                    data-cut-frame="${row.cutFrame ?? row.timelineInFrame}"
                    data-tooltip="${escapeHtml(this._buildRowTooltip(row))}">
                    <td class="col-idx"><div class="seq-index-idx-cell">${swatchHtml}<span>${row.index}</span></div></td>
                    <td class="col-track"><span class="seq-index-track-pill ${trackToneClass}">${escapeHtml(row.trackId)}</span></td>
                    <td class="col-name">
                        <div class="seq-index-item-main">
                            ${typeIcon}
                            <span class="seq-index-item-title">${escapeHtml(row.name)}</span>
                        </div>
                        ${(badgesHtml || notesHtml) ? `<div class="seq-index-item-sub">${badgesHtml}${notesHtml}</div>` : ""}
                    </td>
                    <td class="col-in"><span class="seq-index-tc">${escapeHtml(row.timelineInTc)}</span></td>
                    <td class="col-out"><span class="seq-index-tc">${escapeHtml(row.timelineOutTc)}</span></td>
                    <td class="col-dur">
                        <span class="seq-index-tc">${escapeHtml(row.durationTc)}</span>
                        <span class="seq-index-frames">${escapeHtml(durLabel)}</span>
                    </td>
                    <td class="col-source"><span class="seq-index-tc">${escapeHtml(row.sourceInTc)} → ${escapeHtml(row.sourceOutTc)}</span></td>
                </tr>`;
        }).join("");

        wrapper.innerHTML = `
            <table class="seq-index-table">
                <thead>
                    <tr>
                        <th class="col-idx">#</th>
                        <th class="col-track">Pista</th>
                        <th class="col-name">Item</th>
                        <th class="col-in">IN</th>
                        <th class="col-out">OUT</th>
                        <th class="col-dur">Duração</th>
                        <th class="col-source">Fonte</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>`;
    }

    _isFrameOnRow(frame, row) {
        const f = Number(frame) || 0;
        if (row.entryType === "marker") {
            return f === row.timelineInFrame;
        }
        if (row.entryType === "transition") {
            return f >= row.timelineInFrame && f <= Math.max(row.timelineInFrame, row.timelineOutFrame);
        }
        return f >= row.timelineInFrame && f < Math.max(row.timelineInFrame + 1, row.timelineOutFrame);
    }

    _syncSelectionClasses() {
        const wrapper = this._el("#seq-index-table-wrapper");
        if (!wrapper) return;
        const selectedClipId = TIMELINE_STATE?.selectedClipId ? String(TIMELINE_STATE.selectedClipId) : null;
        const selectedTransId = TIMELINE_STATE?.selectedTransitionId ? String(TIMELINE_STATE.selectedTransitionId) : null;
        const selectedMarkers = TIMELINE_STATE?.selectedMarkerIds;

        wrapper.querySelectorAll("tr.seq-index-row").forEach(tr => {
            const rowId = tr.dataset.rowId || "";
            const [entryType, ...rest] = rowId.split(":");
            const targetId = rest.join(":");
            const active = (
                rowId === this.selectedRowId ||
                (entryType === "clip" && selectedClipId && targetId === selectedClipId) ||
                (entryType === "transition" && selectedTransId && targetId === selectedTransId) ||
                (entryType === "marker" && selectedMarkers && typeof selectedMarkers.has === "function" && selectedMarkers.has(targetId))
            );
            tr.classList.toggle("is-selected", Boolean(active));
        });
    }

    updatePlayheadHighlight(frame, { scroll = false } = {}) {
        const wrapper = this._el("#seq-index-table-wrapper");
        if (!wrapper) return;
        const f = Number(frame) || 0;
        let firstActive = null;

        wrapper.querySelectorAll("tr.seq-index-row").forEach(tr => {
            const entryType = tr.dataset.entryType || "clip";
            const inF = Number(tr.dataset.inFrame) || 0;
            const outF = Number(tr.dataset.outFrame) || 0;
            let active = false;
            if (entryType === "marker") active = f === inF;
            else if (entryType === "transition") active = f >= inF && f <= Math.max(inF, outF);
            else active = f >= inF && f < Math.max(inF + 1, outF);

            tr.classList.toggle("is-at-playhead", active);
            if (active && !firstActive) firstActive = tr;
        });

        if (scroll && firstActive && typeof firstActive.scrollIntoView === "function") {
            firstActive.scrollIntoView({ block: "nearest" });
        }
    }

    render({ force = false } = {}) {
        if (!this.container) return;
        if (!force && !this.isVisible() && !this._dirty) return;

        this._allRows = buildSequenceIndexRows(TIMELINE_STATE, STATE);
        this._summary = computeSequenceIndexSummary(this._allRows);
        this._syncTrackSelectOptions();
        this._filteredRows = filterSequenceIndexRows(this._allRows, {
            query: this.query,
            filter: this.filter,
            trackFilter: this.trackFilter,
            colorFilter: this.colorFilter
        });
        this._renderFilterChips();
        this._renderMetaBar();
        this._renderTable();
        this._dirty = false;
    }

    downloadCSV() {
        const rows = this._filteredRows.length > 0 || this.query || this.filter !== "all" || this.trackFilter !== "all" || this.colorFilter !== "all"
            ? this._filteredRows
            : this._allRows;
        const seqName = TIMELINE_STATE?.name || "Sequência Principal";
        const csvText = exportSequenceIndexToCSV(rows, { name: seqName, fps: TIMELINE_STATE?.fps || 24 });

        if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            const doc = this.container?.ownerDocument || (typeof document !== "undefined" ? document : null);
            if (doc && doc.body) {
                const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = doc.createElement("a");
                const stamp = new Date().toISOString().slice(0, 10);
                link.href = url;
                link.download = `indice_${sanitizeFilenameSlug(seqName)}_${stamp}.csv`;
                link.style.display = "none";
                doc.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        }

        if (typeof window !== "undefined" && typeof window.showToast === "function") {
            window.showToast(`CSV exportado (${rows.length} ${rows.length === 1 ? "item" : "itens"})`, "success");
        }
        return csvText;
    }
}

export function initSequenceIndex() {
    const instance = new SequenceIndex();
    if (typeof window !== "undefined") {
        window.SEQUENCE_INDEX = instance;
    }
    return instance;
}
