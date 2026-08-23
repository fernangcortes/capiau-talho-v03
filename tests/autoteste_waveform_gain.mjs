// Autoteste Waveform Gain & Clipping na Timeline
// Executa com node puro: node tests/autoteste_waveform_gain.mjs
import assert from "node:assert";

// Simulador dos métodos de timelineRenderer
function getClipEffectiveAudioGain(cut, track, customState = {}) {
    const TIMELINE_STATE = customState.TIMELINE_STATE || {
        getTrack: (tId) => (customState.tracks || []).find(t => t.id === tId) || null,
        muteHiddenTracksPlayback: customState.muteHiddenTracksPlayback || false
    };

    if (!track && typeof TIMELINE_STATE.getTrack === "function") {
        track = TIMELINE_STATE.getTrack(cut.track);
    }

    // 1. Mute ou volume da trilha
    if (track) {
        if (track.muted === true) {
            return 0;
        }
        if (track.hidden === true && TIMELINE_STATE.muteHiddenTracksPlayback) {
            return 0;
        }
    }
    const trackVol = (track && typeof track.volume === "number" && !isNaN(track.volume)) ? track.volume : 1.0;

    // 2. Volume do clipe
    const effects = Array.isArray(cut.effects) ? cut.effects : [];
    const volEff = effects.find(e => e && e.type === "volume");
    let clipVol = 1.0;
    if (volEff && volEff.disabled !== true) {
        clipVol = (typeof volEff.level === "number" && !isNaN(volEff.level)) ? volEff.level : 1.0;
    }

    // 3. Ganho da dinâmica (makeup_db)
    const dynEff = effects.find(e => e && e.type === "audio_dynamics");
    let dynGain = 1.0;
    if (dynEff && dynEff.disabled !== true && typeof dynEff.makeup_db === "number" && !isNaN(dynEff.makeup_db) && dynEff.makeup_db !== 0) {
        dynGain = Math.pow(10, dynEff.makeup_db / 20);
    }

    // 4. Tratamento de áudio (audio_render) se estiver ativo e conectado como tratado
    let renderGain = 1.0;
    const renderEff = effects.find(e => e && e.type === "audio_render");
    if (renderEff && renderEff.status === "ready" && renderEff.disabled !== true) {
        const usandoTratado = customState.usandoTratado !== undefined ? customState.usandoTratado : true;
        if (usandoTratado && renderEff.analysis_before && renderEff.analysis_after) {
            const lufsBefore = Number(renderEff.analysis_before.lufs);
            const lufsAfter = Number(renderEff.analysis_after.lufs);
            if (Number.isFinite(lufsBefore) && Number.isFinite(lufsAfter)) {
                const deltaLufs = lufsAfter - lufsBefore;
                const clampedDelta = Math.max(-30, Math.min(30, deltaLufs));
                renderGain = Math.pow(10, clampedDelta / 20);
            }
        }
    }

    const totalGain = trackVol * clipVol * dynGain * renderGain;
    return (typeof totalGain === "number" && !isNaN(totalGain)) ? Math.max(0, totalGain) : 1.0;
}

function simulateDrawWaveform(cut, width, clipHeight, track, customState = {}) {
    const totalGain = getClipEffectiveAudioGain(cut, track, customState);
    const centerY = clipHeight / 2;
    const maxAmplitude = (clipHeight - 16) / 2;

    if (totalGain <= 0.001) {
        return { mode: "flatline", totalGain, peaksDrawn: 0, clippingPoints: [] };
    }

    const numPoints = Math.max(10, Math.floor(width / 3));
    const seed = (cut.video_id || 0) * 100 + (cut.inFrame || 0);
    const random = (s) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
    };

    const clippingPoints = [];
    const amps = [];

    for (let i = 0; i < numPoints; i++) {
        const phase = (i / numPoints) * Math.PI * 8;
        let val = Math.abs(Math.sin(phase) * 0.4 + random(seed + i) * 0.3);
        if (i % 15 < 3) val = 0.02;

        const rawAmp = val * maxAmplitude * totalGain;
        const isClipped = rawAmp >= maxAmplitude;
        const amp = Math.min(rawAmp, maxAmplitude);
        amps.push(amp);

        if (isClipped) {
            clippingPoints.push({ i, rawAmp, amp });
        }
    }

    return { mode: "waveform", totalGain, peaksDrawn: numPoints, amps, clippingPoints };
}

console.log("--- Executando autoteste de waveform gain & clipping ---");

// Teste 1: Volume Nominal Padrão (100% = 1.0)
{
    const cut = { id: "c1", track: "A1", effects: [] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 1.0, "Ganho padrão deve ser 1.0");
    const draw = simulateDrawWaveform(cut, 300, 60, track);
    assert.strictEqual(draw.mode, "waveform");
    assert.strictEqual(draw.clippingPoints.length, 0, "No volume nominal não deve haver clipping");
    console.log("OK 1: Volume nominal (100%) -> Ganho 1.0, sem clipping");
}

// Teste 2: Volume Reduzido (50% = 0.5)
{
    const cut = { id: "c2", track: "A1", effects: [{ type: "volume", level: 0.5 }] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 0.5, "Ganho com 50% deve ser 0.5");
    const draw = simulateDrawWaveform(cut, 300, 60, track);
    assert.strictEqual(draw.mode, "waveform");
    assert.strictEqual(draw.clippingPoints.length, 0);
    console.log("OK 2: Volume reduzido (50%) -> Ganho 0.5");
}

// Teste 3: Volume Zerado / Mudo -> Linha reta plana (Silêncio)
{
    const cut = { id: "c3", track: "A1", effects: [{ type: "volume", level: 0.0 }] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 0.0, "Ganho com 0% deve ser 0.0");
    const draw = simulateDrawWaveform(cut, 300, 60, track);
    assert.strictEqual(draw.mode, "flatline", "Volume 0 deve renderizar linha plana (flatline)");
    console.log("OK 3: Volume 0% -> Modo flatline (linha reta central)");
}

// Teste 4: Trilha Mutada -> Linha reta plana
{
    const cut = { id: "c4", track: "A1", effects: [{ type: "volume", level: 1.5 }] };
    const track = { id: "A1", volume: 1.0, muted: true };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 0, "Trilha mutada deve zerar ganho total");
    const draw = simulateDrawWaveform(cut, 300, 60, track);
    assert.strictEqual(draw.mode, "flatline");
    console.log("OK 4: Trilha mutada -> Ganho 0, modo flatline");
}

// Teste 5: Volume Aumentado (200% = 2.0) -> Clipping visual detectado
{
    const cut = { id: "c5", track: "A1", video_id: 10, inFrame: 0, effects: [{ type: "volume", level: 2.0 }] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 2.0, "Ganho com 200% deve ser 2.0");
    const draw = simulateDrawWaveform(cut, 300, 60, track);
    assert.strictEqual(draw.mode, "waveform");
    assert.ok(draw.clippingPoints.length > 0, "Volume 200% deve gerar picos de clipping");
    console.log(`OK 5: Volume 200% -> Ganho 2.0, ${draw.clippingPoints.length} picos em saturação (clipping)`);
}

// Teste 6: Bypass do Efeito de Volume
{
    const cut = { id: "c6", track: "A1", effects: [{ type: "volume", level: 2.0, disabled: true }] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    assert.strictEqual(gain, 1.0, "Volume em bypass deve ser ignorado (ganho 1.0)");
    console.log("OK 6: Bypass do efeito de volume -> Ganho ignorado e restaurado para 1.0");
}

// Teste 7: Ganho de Dinâmica (Makeup Gain)
{
    const cut = { id: "c7", track: "A1", effects: [{ type: "volume", level: 1.0 }, { type: "audio_dynamics", makeup_db: 6.0 }] };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track);
    const expected = Math.pow(10, 6.0 / 20); // ~1.995
    assert.ok(Math.abs(gain - expected) < 0.01, `Ganho de makeup +6dB deve ser ~1.995, obtido: ${gain}`);
    console.log(`OK 7: Dynamic Makeup Gain (+6 dB) -> Ganho linear ${gain.toFixed(3)}`);
}

// Teste 8: Tratamento Renderizado (Loudnorm delta)
{
    const cut = {
        id: "c8",
        track: "A1",
        effects: [{
            type: "audio_render",
            status: "ready",
            analysis_before: { lufs: -24.0 },
            analysis_after: { lufs: -16.0 } // +8 LUFS de aumento
        }]
    };
    const track = { id: "A1", volume: 1.0, muted: false };
    const gain = getClipEffectiveAudioGain(cut, track, { usandoTratado: true });
    const expected = Math.pow(10, 8.0 / 20); // ~2.51
    assert.ok(Math.abs(gain - expected) < 0.01, `Tratamento com +8 LUFS deve dar ganho ~2.51, obtido: ${gain}`);
    console.log(`OK 8: Tratamento de áudio (+8 LUFS) -> Ganho linear ${gain.toFixed(3)}`);
}

console.log("\nTodos os 8 testes unitários de modulação de waveform passaram com sucesso!");
