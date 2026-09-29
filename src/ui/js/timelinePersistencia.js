/**
 * Ponte ÚNICA entre o clipe da tela (STATE.activeTimelineCuts) e o que vai para o
 * banco (POST /api/timeline) — e de volta.
 *
 * Antes cada botão montava o próprio objeto à mão com meia dúzia de campos
 * (panels.js e exportVideo.js salvando, panels.js carregando). Tudo o mais que o
 * editor guarda no clipe sumia no caminho: clipe desativado (F), rotação,
 * velocidade/reverso, freeze frame, subclipe, e o texto e o estilo dos títulos.
 * O render lê o BANCO, então exportava clipe desligado, velocidade errada e
 * título nenhum; e reabrir a timeline perdia o mesmo.
 *
 * Regra: vai o clipe inteiro, menos o que é DERIVADO (frames, refeitos pelo
 * conformCuts a partir dos segundos) e o que é estado interno (chave com "_").
 */

// Frames são derivados dos segundos na carga; gravar os dois cria duas verdades.
const CAMPOS_DERIVADOS = new Set(["in", "out", "inFrame", "outFrame", "timelineStartFrame"]);

function _copiaSerializavel(valor) {
    try {
        return JSON.parse(JSON.stringify(valor));
    } catch (_) {
        return undefined;
    }
}

/**
 * Clipe da tela -> item do corpo de POST /api/timeline.
 * Clipes desativados VÃO (com disabled:true): reabrir a timeline os mostra
 * desligados, e o render os pula (modelo._clipe).
 */
export function corteParaSalvar(c, fps) {
    const fpsVal = Number(fps) || 24;
    const extras = {};
    Object.keys(c || {}).forEach(chave => {
        if (CAMPOS_DERIVADOS.has(chave) || chave.startsWith("_")) return;
        const v = c[chave];
        if (v === undefined || typeof v === "function") return;
        const copia = _copiaSerializavel(v);
        if (copia !== undefined) extras[chave] = copia;
    });
    return {
        ...extras,
        id: String(c.id),
        type: c.type || "video",
        video_id: c.video_id ?? null,
        photo_id: c.photo_id ?? null,
        in_time: c.in,
        out_time: c.out,
        track: c.track,
        timeline_start: (c.timelineStartFrame || 0) / fpsVal,
        link_id: c.link_id || null,
        effects: c.effects || [],
        alternatives: c.alternatives || [],
        origin: c.origin || "user"
    };
}

export function cortesParaSalvar(cuts, fps) {
    return (cuts || []).map(c => corteParaSalvar(c, fps));
}

/**
 * Clipe do banco (sequence.clips) -> clipe da tela, antes do conformCuts.
 *
 * Velocidade: `in`/`out` guardam o trecho da FONTE; na timeline o clipe ocupa
 * (out - in) / speed. Sem refazer outFrame aqui, o conformCuts derivaria a
 * duração da fonte e um clipe a 200% voltaria com o dobro do tamanho.
 */
export function corteDoBanco(c, idx, fps) {
    const fpsVal = Number(fps) || 24;
    const corte = { ...c };
    corte.id = c.id || `cut_loaded_${idx}_${Date.now()}`;
    corte.type = c.type || "video";
    corte.video_id = c.video_id ?? null;
    corte.photo_id = c.photo_id ?? null;
    corte.track = c.track || "V1";
    corte.link_id = c.link_id || null;
    corte.effects = c.effects || [];
    corte.alternatives = c.alternatives || [];
    corte.origin = c.origin || "user";
    delete corte.timeline_start;
    if (c.timeline_start !== undefined && c.timeline_start !== null) {
        corte.timelineStartFrame = Math.round(Number(c.timeline_start) * fpsVal);
    }

    const speed = Number(c.speed);
    if (Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) > 1e-9) {
        const inFrame = Math.round((Number(c.in) || 0) * fpsVal);
        const durFonte = Math.max(0, (Number(c.out) || 0) - (Number(c.in) || 0));
        corte.inFrame = inFrame;
        corte.outFrame = inFrame + Math.max(1, Math.round(durFonte * fpsVal / speed));
    }
    return corte;
}

export function cortesDoBanco(clips, fps) {
    return (clips || []).map((c, idx) => corteDoBanco(c, idx, fps));
}
