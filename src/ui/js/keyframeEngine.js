// Motor de Keyframes Paramétricos e Interpolação Temporal (CapIAu-Talho)
// Suporta animações em clipes de Texto, Vídeo, Foto e Áudio com curvas de easing profissionais.

/**
 * Catálogo de Funções Matemáticas de Easing (Interpolação de Curvas).
 * Todas recebem t no intervalo [0, 1] e retornam o progresso interpolado.
 */
export const EASING_FUNCTIONS = {
    linear: (t) => t,

    // Quadratic
    easeInQuad: (t) => t * t,
    easeOutQuad: (t) => t * (2 - t),
    easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

    // Cubic
    easeInCubic: (t) => t * t * t,
    easeOutCubic: (t) => (--t) * t * t + 1,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),

    // Sine (Suave / Orgânico)
    easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

    // Exponential (Rápido)
    easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
    easeOutExpo: (t) => (t === 1 ? 1 : -Math.pow(2, -10 * t) + 1),
    easeInOutExpo: (t) => {
        if (t === 0) return 0;
        if (t === 1) return 1;
        return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    },

    // Spring / Elastic (Leve overshoot elástico)
    spring: (t) => {
        if (t === 0) return 0;
        if (t === 1) return 1;
        const p = 0.3;
        const s = p / 4;
        return Math.pow(2, -10 * t) * Math.sin(((t - s) * (2 * Math.PI)) / p) + 1;
    },

    // Hold (Salto imediato no final)
    hold: (t) => (t >= 1.0 ? 1 : 0)
};

/**
 * Lista amigável de curvas de easing para exibição em menus de seleção.
 */
export const EASING_OPTIONS = [
    { id: "linear", label: "Linear (Constante)" },
    { id: "easeOutQuad", label: "Ease Out (Desaceleração Suave)" },
    { id: "easeInQuad", label: "Ease In (Aceleração Inicial)" },
    { id: "easeInOutCubic", label: "Ease In-Out (Suave Entrada e Saída)" },
    { id: "easeOutCubic", label: "Ease Out Forte (Cinemático)" },
    { id: "easeOutSine", label: "Seno Suave" },
    { id: "spring", label: "Mola / Elástico (Spring)" },
    { id: "hold", label: "Hold (Salto Instantâneo)" }
];

/**
 * Interpolação linear entre dois números com função de easing.
 */
export function lerp(v0, v1, t, easingName = "linear") {
    const clampedT = Math.max(0, Math.min(1, t));
    const easingFn = EASING_FUNCTIONS[easingName] || EASING_FUNCTIONS.linear;
    const progress = easingFn(clampedT);
    return v0 + (v1 - v0) * progress;
}

/**
 * Interpolação de cores Hex (#RRGGBB ou #RRGGBBAA).
 */
export function lerpColor(color0, color1, t, easingName = "linear") {
    if (!color0 || !color1) return color0 || color1 || "#ffffff";
    const parseHex = (hex) => {
        const clean = hex.replace("#", "");
        if (clean.length === 3) {
            return [
                parseInt(clean[0] + clean[0], 16),
                parseInt(clean[1] + clean[1], 16),
                parseInt(clean[2] + clean[2], 16),
                1.0
            ];
        }
        return [
            parseInt(clean.slice(0, 2), 16) || 0,
            parseInt(clean.slice(2, 4), 16) || 0,
            parseInt(clean.slice(4, 6), 16) || 0,
            clean.length >= 8 ? (parseInt(clean.slice(6, 8), 16) / 255) : 1.0
        ];
    };

    const [r0, g0, b0, a0] = parseHex(color0);
    const [r1, g1, b1, a1] = parseHex(color1);

    const r = Math.round(lerp(r0, r1, t, easingName));
    const g = Math.round(lerp(g0, g1, t, easingName));
    const b = Math.round(lerp(b0, b1, t, easingName));
    const a = lerp(a0, a1, t, easingName);

    const pad = (n) => n.toString(16).padStart(2, "0");
    if (a < 1.0) {
        const aByte = Math.round(a * 255);
        return `#${pad(r)}${pad(g)}${pad(b)}${pad(aByte)}`;
    }
    return `#${pad(r)}${pad(g)}${pad(b)}`;
}

/**
 * Amostra o valor interpolado de uma lista de keyframes para um tempo relativo informado.
 * 
 * Cada keyframe é um objeto: { time_offset_s: number, value: number|string, easing: string }
 * 
 * @param {Array} keyframes - Lista de keyframes do canal.
 * @param {number} relativeTimeS - Tempo em segundos relativo ao início do clipe (início = 0.0s).
 * @param {any} defaultValue - Valor retornado caso não existam keyframes.
 * @returns {any} Valor interpolado no instante relativeTimeS.
 */
export function evaluateKeyframes(keyframes, relativeTimeS, defaultValue = 0) {
    if (!keyframes || !Array.isArray(keyframes) || keyframes.length === 0) {
        return defaultValue;
    }

    // Normaliza e ordena por tempo relativo crescente
    const sorted = [...keyframes].sort((a, b) => (a.time_offset_s ?? a.time ?? 0) - (b.time_offset_s ?? b.time ?? 0));

    const first = sorted[0];
    const firstTime = first.time_offset_s ?? first.time ?? 0;
    if (relativeTimeS <= firstTime) {
        return first.value;
    }

    const last = sorted[sorted.length - 1];
    const lastTime = last.time_offset_s ?? last.time ?? 0;
    if (relativeTimeS >= lastTime) {
        return last.value;
    }

    // Localiza o intervalo [k0, k1]
    for (let i = 0; i < sorted.length - 1; i++) {
        const k0 = sorted[i];
        const k1 = sorted[i + 1];
        const t0 = k0.time_offset_s ?? k0.time ?? 0;
        const t1 = k1.time_offset_s ?? k1.time ?? 0;

        if (relativeTimeS >= t0 && relativeTimeS <= t1) {
            if (t1 === t0) return k0.value;
            const progress = (relativeTimeS - t0) / (t1 - t0);
            const easing = k0.easing || "linear";

            if (typeof k0.value === "string" && k0.value.startsWith("#") && typeof k1.value === "string" && k1.value.startsWith("#")) {
                return lerpColor(k0.value, k1.value, progress, easing);
            }
            if (typeof k0.value === "number" && typeof k1.value === "number") {
                return lerp(k0.value, k1.value, progress, easing);
            }
            // Tipos não-numéricos (texto/strings): Hold até o próximo keyframe
            return progress >= 1.0 ? k1.value : k0.value;
        }
    }

    return last.value;
}

/**
 * Avalia uma propriedade de um clipe, retornando o valor animado por keyframes ou o valor estático.
 * 
 * @param {Object} clip - O objeto do clipe da timeline.
 * @param {string} propertyName - Nome da propriedade (ex: "opacity", "posY", "scale", "tracking").
 * @param {number} relativeTimeS - Tempo em segundos a partir do início do clipe.
 * @param {any} fallbackDefault - Valor padrão caso a propriedade não exista no clipe.
 * @returns {any} Valor resolvido da propriedade.
 */
export function evaluateClipProperty(clip, propertyName, relativeTimeS, fallbackDefault = null) {
    if (!clip) return fallbackDefault;

    // Normalização de chaves alternativas (ex: x/posX, y/posY)
    let keysToTry = [propertyName];
    if (propertyName === "x" || propertyName === "posX") keysToTry = ["x", "posX"];
    if (propertyName === "y" || propertyName === "posY") keysToTry = ["y", "posY"];

    let baseVal = fallbackDefault;
    for (const k of keysToTry) {
        if (clip[k] !== undefined && clip[k] !== null && !isNaN(Number(clip[k]))) {
            baseVal = clip[k];
            break;
        }
    }

    if (baseVal === fallbackDefault && Array.isArray(clip.effects)) {
        const tf = clip.effects.find(e => e.type === "transform");
        if (tf) {
            for (const k of keysToTry) {
                if (tf[k] !== undefined && tf[k] !== null && !isNaN(Number(tf[k]))) {
                    baseVal = tf[k];
                    break;
                }
            }
        }
    }

    if (clip.keyframes) {
        for (const k of keysToTry) {
            if (Array.isArray(clip.keyframes[k]) && clip.keyframes[k].length > 0) {
                return evaluateKeyframes(clip.keyframes[k], relativeTimeS, baseVal);
            }
        }
    }

    return baseVal !== null ? baseVal : fallbackDefault;
}

/**
 * Avalia o conjunto completo de transformação e estilo de um clipe para renderização no player.
 */
export function evaluateClipTransform(clip, relativeTimeS) {
    if (!clip) return {};

    const xVal = Number(evaluateClipProperty(clip, "x", relativeTimeS, 0)) || 0;
    const yVal = Number(evaluateClipProperty(clip, "y", relativeTimeS, 0)) || 0;
    const scaleVal = Number(evaluateClipProperty(clip, "scale", relativeTimeS, 1.0)) || 1.0;
    const rotVal = Number(evaluateClipProperty(clip, "rotation", relativeTimeS, 0)) || 0;
    const opVal = Math.max(0, Math.min(1, Number(evaluateClipProperty(clip, "opacity", relativeTimeS, 1.0)) || 1.0));

    return {
        x: xVal,
        y: yVal,
        posX: xVal,
        posY: yVal,
        scale: scaleVal,
        rotation: rotVal,
        opacity: opVal,
        fontSize: Number(evaluateClipProperty(clip, "fontSize", relativeTimeS, 32)) || 32,
        tracking: Number(evaluateClipProperty(clip, "tracking", relativeTimeS, 0)) || 0,
        lineHeight: Number(evaluateClipProperty(clip, "lineHeight", relativeTimeS, 1.2)) || 1.2,
        color: evaluateClipProperty(clip, "color", relativeTimeS, "#ffffff"),
        backgroundColor: evaluateClipProperty(clip, "backgroundColor", relativeTimeS, "transparent"),
        boxPadding: Number(evaluateClipProperty(clip, "boxPadding", relativeTimeS, 8)) || 8,
        boxBorderRadius: Number(evaluateClipProperty(clip, "boxBorderRadius", relativeTimeS, 4)) || 4,
        blur: Number(evaluateClipProperty(clip, "blur", relativeTimeS, 0)) || 0
    };
}

/**
 * Verifica se uma propriedade de um clipe possui keyframes ativos.
 */
export function hasKeyframes(clip, propertyName) {
    return !!(clip && clip.keyframes && Array.isArray(clip.keyframes[propertyName]) && clip.keyframes[propertyName].length > 0);
}

/**
 * Retorna o keyframe exato (dentro de uma tolerância em segundos) em um determinado tempo.
 */
export function getKeyframeAt(clip, propertyName, relativeTimeS, toleranceS = 0.035) {
    if (!hasKeyframes(clip, propertyName)) return null;
    return clip.keyframes[propertyName].find(k => Math.abs((k.time_offset_s ?? k.time ?? 0) - relativeTimeS) <= toleranceS) || null;
}

/**
 * Adiciona ou atualiza um keyframe em uma propriedade de um clipe.
 */
export function addOrUpdateKeyframe(clip, propertyName, relativeTimeS, value, easing = "linear") {
    if (!clip) return null;
    if (!clip.keyframes) clip.keyframes = {};
    if (!clip.keyframes[propertyName]) clip.keyframes[propertyName] = [];

    const kfList = clip.keyframes[propertyName];
    const existing = kfList.find(k => Math.abs((k.time_offset_s ?? k.time ?? 0) - relativeTimeS) <= 0.035);

    if (existing) {
        existing.value = value;
        if (easing) existing.easing = easing;
        return existing;
    }

    const newKf = {
        time_offset_s: Math.max(0, Math.round(relativeTimeS * 1000) / 1000),
        value: value,
        easing: easing || "linear"
    };
    kfList.push(newKf);
    kfList.sort((a, b) => (a.time_offset_s ?? 0) - (b.time_offset_s ?? 0));
    return newKf;
}

/**
 * Remove um keyframe de uma propriedade de um clipe.
 */
export function removeKeyframe(clip, propertyName, relativeTimeS, toleranceS = 0.035) {
    if (!hasKeyframes(clip, propertyName)) return false;
    const initialLen = clip.keyframes[propertyName].length;
    clip.keyframes[propertyName] = clip.keyframes[propertyName].filter(
        k => Math.abs((k.time_offset_s ?? k.time ?? 0) - relativeTimeS) > toleranceS
    );
    return clip.keyframes[propertyName].length < initialLen;
}

/**
 * Retorna o tempo do keyframe anterior ao relativeTimeS informado.
 */
export function getPrevKeyframeTime(clip, propertyName, relativeTimeS, toleranceS = 0.035) {
    if (!hasKeyframes(clip, propertyName)) return null;
    const list = [...clip.keyframes[propertyName]].sort((a, b) => (a.time_offset_s ?? 0) - (b.time_offset_s ?? 0));
    const prevList = list.filter(k => (k.time_offset_s ?? 0) < relativeTimeS - toleranceS);
    if (prevList.length === 0) return null;
    return prevList[prevList.length - 1].time_offset_s;
}

/**
 * Retorna o tempo do próximo keyframe após o relativeTimeS informado.
 */
export function getNextKeyframeTime(clip, propertyName, relativeTimeS, toleranceS = 0.035) {
    if (!hasKeyframes(clip, propertyName)) return null;
    const list = [...clip.keyframes[propertyName]].sort((a, b) => (a.time_offset_s ?? 0) - (b.time_offset_s ?? 0));
    const next = list.find(k => (k.time_offset_s ?? 0) > relativeTimeS + toleranceS);
    return next ? next.time_offset_s : null;
}

/**
 * Alterna a ativação de keyframing para uma propriedade.
 * Se ativar: cria o primeiro keyframe no tempo relativo atual com o valor corrente.
 * Se desativar: limpa a lista de keyframes e fixa o valor atual no clipe.
 */
export function toggleKeyframing(clip, propertyName, currentValue, relativeTimeS = 0.0) {
    if (!clip) return false;
    if (!clip.keyframes) clip.keyframes = {};

    if (hasKeyframes(clip, propertyName)) {
        // Desativa: remove canal de keyframes
        delete clip.keyframes[propertyName];
        clip[propertyName] = currentValue;
        return false;
    } else {
        // Ativa: cria primeiro keyframe
        clip.keyframes[propertyName] = [{
            time_offset_s: Math.max(0, Math.round(relativeTimeS * 1000) / 1000),
            value: currentValue,
            easing: "easeOutQuad"
        }];
        return true;
    }
}

/**
 * Coleta todos os tempos absolutos na timeline (em frames) que possuem keyframes no clipe.
 */
export function getAllKeyframeTimelineFrames(clip, fps = 24) {
    if (!clip || !clip.keyframes) return [];

    const fpsVal = Number(fps) > 0 ? Number(fps) : 24;
    const clipStartFrame = clip.timelineStartFrame !== undefined 
        ? clip.timelineStartFrame 
        : Math.round((clip.timeline_start || 0) * fpsVal);

    const frameSet = new Set();
    Object.keys(clip.keyframes).forEach(prop => {
        const kfs = clip.keyframes[prop];
        if (Array.isArray(kfs)) {
            kfs.forEach(k => {
                const offsetS = k.time_offset_s ?? k.time ?? 0;
                const absFrame = clipStartFrame + Math.round(offsetS * fpsVal);
                frameSet.add(absFrame);
            });
        }
    });

    return Array.from(frameSet).sort((a, b) => a - b);
}
