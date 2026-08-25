// Teste de simulação do playhead (agulha) em sobreposição multipista com efeitos de volume/crossfade
import assert from "node:assert";

if (typeof globalThis.window === "undefined") {
    globalThis.window = globalThis;
}
if (typeof globalThis.localStorage === "undefined") {
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
}

const { evaluateFadeCurve } = await import("../src/ui/js/timelineState.js");

console.log("--- Executando autoteste de reprodução da agulha em sobreposição multipista ---");

// Mock de elemento HTMLMediaElement
class MockAudioElement {
    constructor(id) {
        this.id = id;
        this._volume = 1.0;
        this.currentTime = 0;
        this.playbackRate = 1.0;
        this.paused = true;
        this.muted = false;
        this.dataset = {};
    }
    get volume() { return this._volume; }
    set volume(val) {
        if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 1) {
            throw new TypeError(`Failed to set 'volume' property: The provided double value is non-finite or out of range: ${val}`);
        }
        this._volume = val;
    }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    load() {}
}

const tracks = [
    { id: "V1", kind: "video", volume: 1.0, muted: false },
    { id: "V2", kind: "video", volume: 1.0, muted: false },
    { id: "A1", kind: "audio", volume: 1.0, muted: false },
    { id: "A2", kind: "audio", volume: 1.0, muted: false }
];

const cuts = [
    // V1 / A1: 05:10:19 -> 06:06:09 (in: 310.81, out: 366.37, start: 618.36)
    {
        id: "cut_speech_25_v",
        track: "V1",
        type: "video",
        video_id: 6,
        in: 310.81,
        out: 366.37,
        timelineStartFrame: 14840,
        inFrame: 7460,
        outFrame: 8793,
        effects: []
    },
    {
        id: "cut_speech_25_a",
        track: "A1",
        type: "video",
        video_id: 6,
        in: 310.81,
        out: 366.37,
        timelineStartFrame: 14840,
        inFrame: 7460,
        outFrame: 8793,
        effects: [{ type: "crossfade", side: "in", duration_s: 0.2 }, { type: "crossfade", side: "out", duration_s: 0.3 }]
    },
    // V2 / A2: 00:30:00 -> 00:47:04 (in: 30.0, out: 47.187, start: 620.56)
    {
        id: "cut_broll_25_0_v",
        track: "V2",
        type: "video",
        video_id: 400,
        in: 30.0,
        out: 47.187,
        timelineStartFrame: 14893, // 620.56 * 24 = ~14893
        inFrame: 720,
        outFrame: 1132,
        effects: [{ type: "crossfade", side: "in", duration_s: 0.25 }, { type: "crossfade", side: "out", duration_s: 0.25 }]
    },
    {
        id: "cut_broll_25_0_a",
        track: "A2",
        type: "video",
        video_id: 400,
        in: 30.0,
        out: 47.187,
        timelineStartFrame: 14893,
        inFrame: 720,
        outFrame: 1132,
        effects: [
            { type: "volume", gain: 0.18 },
            { type: "crossfade", side: "in", duration_s: 0.4 },
            { type: "crossfade", side: "out", duration_s: 0.4 }
        ]
    }
];

const audioPool = {
    A1: new MockAudioElement("A1"),
    A2: new MockAudioElement("A2")
};

function simulateSyncAudio(currentFrame, fpsVal = 24) {
    tracks.filter(t => t.kind === "audio").forEach(track => {
        const el = audioPool[track.id];
        const cut = cuts.find(c =>
            c.track === track.id &&
            currentFrame >= c.timelineStartFrame &&
            currentFrame < (c.timelineStartFrame + (c.outFrame - c.inFrame))
        );

        if (!cut) {
            if (!el.paused) el.pause();
            return;
        }

        // Volume do clipe individual
        const clipVolEff = (cut.effects || []).find(e => e && e.type === "volume");
        let clipVol = 1.0;
        if (clipVolEff && !clipVolEff.disabled) {
            const rawVol = clipVolEff.level !== undefined ? clipVolEff.level : (clipVolEff.gain !== undefined ? clipVolEff.gain : 1.0);
            clipVol = (typeof rawVol === "number" && Number.isFinite(rawVol)) ? rawVol : 1.0;
        }

        // Audio Fade-in / Fade-out duration
        let fadeVol = 1.0;
        const durCut = Math.max(1, ((cut.outFrame || 0) - (cut.inFrame || 0)) || (Math.round(((cut.out || 0) - (cut.in || 0)) * fpsVal)));
        const tIn = (currentFrame - (cut.timelineStartFrame || 0)) / fpsVal;
        const tOut = ((cut.timelineStartFrame || 0) + durCut - currentFrame) / fpsVal;
        const effects = cut.effects || [];
        effects.filter(e => e && e.type === "crossfade").forEach(cf => {
            if (cf.disabled) return;
            const d = Math.max(0.05, cf.duration_s || 0.5);
            if (cf.side === "in" && tIn < d) {
                const p = Math.max(0, Math.min(1, tIn / d));
                const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                if (typeof factor === "number" && Number.isFinite(factor)) fadeVol = Math.min(fadeVol, factor);
            }
            if (cf.side === "out" && tOut < d) {
                const p = Math.max(0, Math.min(1, tOut / d));
                const factor = evaluateFadeCurve(p, cf.curve || "linear", cf.tension || 0);
                if (typeof factor === "number" && Number.isFinite(factor)) fadeVol = Math.min(fadeVol, factor);
            }
        });

        const vol = (track.volume !== undefined && typeof track.volume === "number" && Number.isFinite(track.volume)) ? track.volume : 1.0;
        const rawFinalVol = vol * clipVol * fadeVol;
        const finalVol = (typeof rawFinalVol === "number" && Number.isFinite(rawFinalVol)) ? Math.max(0, Math.min(1.0, rawFinalVol)) : 1.0;
        
        // Isso NÃO pode lançar TypeError
        el.volume = track.muted ? 0 : finalVol;
        if (el.paused) el.play();
    });
}

// 1. Simula playhead antes do corte b-roll (frame 14880 - 10m 20s)
simulateSyncAudio(14880);
assert.strictEqual(audioPool.A1.paused, false);
assert.strictEqual(audioPool.A2.paused, true);
console.log("OK: Frame 14880 (10:20.00) - A1 tocando, A2 pausado");

// 2. Simula playhead no exato momento que V2/A2 começa (frame 14893 - 10m 20.56s)
simulateSyncAudio(14893);
assert.strictEqual(audioPool.A1.paused, false);
assert.strictEqual(audioPool.A2.paused, false);
assert.ok(audioPool.A2.volume <= 0.18, `Volume de A2 deve ser atenuado pelo gain 0.18 + fade in (atual: ${audioPool.A2.volume})`);
console.log(`OK: Frame 14893 (10:20.56) - A1 e A2 tocando em paralelo, volume A2 = ${audioPool.A2.volume.toFixed(4)}`);

// 3. Simula playhead 1 segundo dentro da sobreposição (frame 14920)
simulateSyncAudio(14920);
assert.ok(Math.abs(audioPool.A2.volume - 0.18) < 0.001, `Após fade in, volume de A2 deve estabilizar em 0.18 (atual: ${audioPool.A2.volume})`);
console.log(`OK: Frame 14920 - A2 estabilizado em volume = ${audioPool.A2.volume}`);

console.log("\nTodos os testes de transição e sobreposição da agulha passaram com 100% de sucesso!");
