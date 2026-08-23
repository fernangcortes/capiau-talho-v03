// Autoteste F4 (Etapa 3) - A/B da fonte de audio tratada no player.
// Roda com dubles em node puro:  node tests/autoteste_player_f4.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ───────────────────────────── dubles ─────────────────────────────
class FakeNo {
    constructor() {
        this.connections = [];
        this.gain = { value: 0 };
        this.frequency = { value: 0 };
        this.Q = { value: 0 };
        this.threshold = { value: 0 };
        this.ratio = { value: 0 };
    }
    connect(n) { this.connections.push(n); return n; }
    disconnect() { this.connections.length = 0; }
}

class FakeContexto {
    constructor() {
        this.state = "running";
        this.destination = new FakeNo();
        this.fontesCriadas = new Map(); // elemento -> qtde de createMediaElementSource
        this.workletModules = 0;
    }
    get audioWorklet() {
        return { addModule: () => { this.workletModules++; return Promise.resolve(); } };
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    createBiquadFilter() { return new FakeNo(); }
    createDynamicsCompressor() { return new FakeNo(); }
    createGain() { return new FakeNo(); }
    createMediaElementSource(el) {
        this.fontesCriadas.set(el, (this.fontesCriadas.get(el) || 0) + 1);
        return new FakeNo();
    }
}

class FakeErroMidia { constructor(code) { this.code = code; } }

let criados = [];
class FakeMedia {
    constructor(tag) {
        this.tagName = (tag || "audio").toUpperCase();
        this.dataset = {};
        this.listeners = {};
        this._src = "";
        this.currentTime = 0;
        this.playbackRate = 1.0;
        this.volume = 1.0;
        this.muted = false;
        this.paused = true;
        this.readyState = 0;
        this.seeking = false;
        this.error = null;
        this.preload = "";
        this.loadCalls = 0;
        this.playCalls = 0;
        this.pauseCalls = 0;
        criados.push(this);
    }
    getAttribute(k) { return k === "src" ? this._src : null; }
    setAttribute(k, v) { if (k === "src") this._src = v; }
    removeAttribute(k) { if (k === "src") this._src = ""; }
    get currentSrc() { return this._src; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) {
        const a = this.listeners[t];
        if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
    }
    _emitir(t) { (this.listeners[t] || []).slice().forEach(f => f({ target: this })); }
    load() {
        this.loadCalls++;
        this.seeking = false;
        this.readyState = 4; // HAVE_ENOUGH_DATA imediato (arquivo local)
        if (this._src.includes("/falha")) {
            // simula 404/rede: elemento sinaliza MediaError e dispara "error"
            this.error = new FakeErroMidia(2);
            queueMicrotask(() => this._emitir("error"));
        } else {
            this.error = null;
        }
    }
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
    pause() { this.pauseCalls++; this.paused = true; }
    remove() { /* sai do DOM */ }
}

const eventos = [];
const stateStub = {
    activeTimelineCuts: [],
    allVideos: [{ id: "6", proxy_path: "/proxies/v6.mp4", filepath: "F:/bruto.mp4", filename: "bruto.mp4" }],
    on() {},
    emit(nome, det) { eventos.push({ nome, det }); }
};

const TIMELINE_STATE = {
    fps: 24,
    playheadFrame: 48,
    muteHiddenTracksPlayback: false,
    tracks: [{ id: "t1", kind: "audio", volume: 1.0, muted: false }]
};

const porId = () => null;

const documento = {
    createElement: (tag) => new FakeMedia(tag),
    getElementById: () => null,
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {}
};
const janela = { AudioContext: FakeContexto, webkitAudioContext: undefined, STATE: stateStub };

// ─────────── carrega player.js como módulo avaliável, com imports dublês ───────────
let codigo = readFileSync(path.join(raiz, "src/ui/js/player.js"), "utf8");
codigo = codigo.replace(/^import\s.*$/gm, "").replace(/^export\s+(?=(function|class|const|let|var))/gm, "");
codigo = `
const STATE = __d.state;
const CapIAuAPI = {};
const FaceManager = {};
const TIMELINE_STATE = __d.timeline;
const TIMELINE_HISTORY = { begin() {}, commit() {} };
const getActiveElement = (id) => __d.porId(id);
` + codigo;
codigo += "\nglobalThis.__exports = { ProgramPlayer, SourcePlayer, formatTimecode };\n";

const sandbox = {
    __d: { state: stateStub, timeline: TIMELINE_STATE, porId },
    window: janela,
    document: documento,
    console,
    performance,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    fetch: () => Promise.resolve()
};
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: "player.js" });
const { ProgramPlayer } = sandbox.__exports;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// clipe base: pista t1, in=100 s do arquivo original, 10 s de duração, agulha em +2 s
function corteBase(effects) {
    return {
        id: "c1", track: "t1", video_id: "6",
        inFrame: 0, outFrame: 240, timelineStartFrame: 0, in: 100.0,
        effects: effects || []
    };
}
const ORIGINAL = "/proxies/v6.mp4";
const TRATADO = "/api/audio/tratado/6/a91c3f2e.wav";

let falhas = 0;
function verificar(cond, msg) {
    if (!cond) { falhas++; console.error("FALHOU:", msg); }
    else { console.log("ok -", msg); }
}

async function rodar(player, corte, vezes = 1) {
    for (let i = 0; i < vezes; i++) {
        // Como na interface: o player sempre enxerga os cortes ativos da timeline
        // (definirFonteAudioTratada recompõe por essa mesma fonte ao mudar o A/B).
        stateStub.activeTimelineCuts = [corte];
        player.syncAudioTracks([corte], TIMELINE_STATE.playheadFrame);
        await dormir(70); // deixa o driver da troca atingir a janela de prontidão
    }
}

// ───────────────────────── T1: troca preserva tempo e estado ─────────────────────────
{
    criados = [];
    eventos.length = 0;
    const player = new ProgramPlayer();
    player.isPlaying = true;
    player.playbackSpeed = 1.0;
    const corte = corteBase();
    await rodar(player, corte, 1);

    const antigo = player.audioPool["t1"];
    verificar(!!antigo && !antigo.paused, "T1: elemento original tocando antes do A/B");
    verificar(antigo._src === ORIGINAL, "T1: src inicial é o original");
    verificar(antigo.loadCalls === 1, "T1: carga inicial única do elemento");
    antigo.currentTime = 102.0; // simula reprodução até +2 s do clipe

    player.definirFonteAudioTratada("c1", TRATADO);
    await rodar(player, corte, 2);

    const novo = player.audioPool["t1"];
    verificar(novo && novo !== antigo, "T1: virada promoveu o elemento par");
    verificar(novo.dataset.loadedSrc === TRATADO, "T1: par no ar com o WAV tratado");
    verificar(Math.abs(novo.currentTime - 2.0) <= 0.08, "T1: mesma posição da timeline (base 0 do WAV)");
    verificar(novo.paused === false, "T1: estado de reprodução preservado (seguindo tocando)");
    verificar(Math.abs(novo.volume - antigo.volume) < 1e-9, "T1: volume copiado na virada");
    verificar(novo.playbackRate === antigo.playbackRate, "T1: playbackRate copiado na virada");
    verificar(antigo.paused === true, "T1: elemento antigo pausado depois da virada");
    verificar(antigo.loadCalls === 1 && antigo._src === ORIGINAL,
        "T1: nada foi recarregado no elemento que estava no ar (zero silêncio)");
    verificar(Math.abs(antigo.currentTime - 102.0) < 0.5, "T1: sem salto de posição no elemento antigo");

    // volta ao original pelo mesmo caminho suave
    player.definirFonteAudioTratada("c1", null);
    await rodar(player, corte, 2);
    const restaurado = player.audioPool["t1"];
    verificar(restaurado === antigo, "T1: voltou a tocar no elemento original");
    verificar(restaurado._src === ORIGINAL && !restaurado.paused, "T1: original no ar, tocando");
    verificar(Math.abs(restaurado.currentTime - 102.0) <= 0.08,
        "T1: volta ao original preserva currentTime (mesmo trecho, mapa direto)");
    verificar(player.fonteAudioTratadaAtual("c1") === null, "T1: fonteAudioTratadaAtual(null apos voltar)");
}

// ────────────── T2: WAV que falha (404/rede) volta automaticamente ao original ──────────────
{
    criados = [];
    eventos.length = 0;
    const player = new ProgramPlayer();
    player.isPlaying = true;
    player.playbackSpeed = 1.0;
    const corte = corteBase();
    await rodar(player, corte, 1);
    const originalEl = player.audioPool["t1"];
    originalEl.currentTime = 103.0; // deriva deliberada; o motor reconverge para 102 (in+offset)

    player.definirFonteAudioTratada("c1", TRATADO);
    await rodar(player, corte, 2);
    verificar(player.audioPool["t1"].dataset.loadedSrc === TRATADO, "T2: pré-requisito, tratado no ar");

    player.definirFonteAudioTratada("c1", "/api/audio/tratado/6/falha.wav");
    await rodar(player, corte, 3);

    const noAr = player.audioPool["t1"];
    verificar(noAr.dataset.loadedSrc === ORIGINAL, "T2: fallback automático tocou o original");
    verificar(noAr.paused === false, "T2: segue tocando após o fallback");
    verificar(Math.abs(noAr.currentTime - 102.0) <= 0.08, "T2: fallback sem salto de posição (in+offset)");
    const erro = player.erroFonteAudioTratada("c1");
    verificar(!!erro && /rede/.test(erro.motivo), "T2: falha consultável pela UI (erroFonteAudioTratada)");
    verificar(eventos.some(e => e.nome === "fonteAudioTratadaIndisponivel"),
        "T2: evento fonteAudioTratadaIndisponivel emitido");
    verificar(!criados.some(e => e._src.includes("/falha") && e === noAr),
        "T2: a URL que falhou jamais chegou ao elemento no ar");

    // nova tentativa da mesma URL falha de novo sem travar (falha memorizada nem carrega)
    player.definirFonteAudioTratada("c1", "/api/audio/tratado/6/falha.wav");
    await rodar(player, corte, 1);
    verificar(player.audioPool["t1"].dataset.loadedSrc === ORIGINAL,
        "T2: URL marcada como falha nem é tentada de novo (original direto)");
}

// ─────────── T3: sem registro (e sem efeito) o comportamento é exatamente o atual ───────────
{
    criados = [];
    eventos.length = 0;
    const player = new ProgramPlayer();
    player.isPlaying = true;
    player.playbackSpeed = 1.0;
    const corte = corteBase(); // sem effects
    await rodar(player, corte, 3);

    const el = player.audioPool["t1"];
    verificar(el._src === ORIGINAL, "T3: sem registro, src é o original");
    verificar(el.loadCalls === 1, "T3: nenhuma carga extra sem o A/B");
    verificar(!player._trocasAudio || !player._trocasAudio["t1"], "T3: nenhuma troca pendente");
    verificar(player.erroFonteAudioTratada("c1") === null, "T3: nenhum erro registrado");
    verificar(el.volume === 1.0 && el.muted === false, "T3: volume/mute intocados (pista a 1.0)");

    // efeito audio_render pronto presente, mas A/B não acionado: NADA muda (default)
    const corteRender = corteBase([{ type: "audio_render", engine: "local",
        ref: "data/audio_tratado/6/a91c3f2e.wav", status: "ready", chain: ["adeclip"] }]);
    await rodar(player, corteRender, 2);
    verificar(player.audioPool["t1"] === el && el._src === ORIGINAL,
        "T3: audio_render 'ready' sem A/B não altera a reprodução");

    // A/B com sentinela true usa o ref do próprio efeito
    player.definirFonteAudioTratada("c1", true);
    verificar(player.fonteAudioTratadaAtual("c1") === TRATADO,
        "T3: registro 'true' resolve o ref do efeito para a URL servível");
    await rodar(player, corteRender, 2);
    verificar(player.audioPool["t1"] !== el &&
        player.audioPool["t1"].dataset.loadedSrc === TRATADO,
        "T3: com A/B em 'tratado', o WAV derivado passa a tocar");
}

// ─────────── T4: convivência com a Etapa 2 (grafo único por elemento, sem duplicar ganho) ───────────
{
    criados = [];
    eventos.length = 0;
    TIMELINE_STATE.tracks[0].volume = 0.8;
    const player = new ProgramPlayer();
    player.isPlaying = true;
    player.playbackSpeed = 1.0;
    const efeitos = [
        { type: "audio_eq", hpf: 80, low: 3, mid: -2, high: 1 },
        { type: "audio_dynamics", gate_db: -90, comp_ratio: 3, comp_thresh_db: -20, makeup_db: 2 }
    ];
    const corte = corteBase(efeitos);
    await rodar(player, corte, 1);

    const ctx = player._estadoAudioAoVivo().ctx;
    const primeiro = player.audioPool["t1"];
    let g = player._estadoAudioAoVivo().grafos.get(primeiro);
    verificar(!!g && g.topologia.includes("comp") && g.topologia.includes("makeup"),
        "T4: Etapa 2 roteia o elemento original (eq+dynamics)");
    verificar(ctx.fontesCriadas.get(primeiro) === 1, "T4: createMediaElementSource uma única vez");
    verificar(Math.abs(g.nos.makeup.gain.value - Math.pow(10, 2 / 20)) < 1e-9,
        "T4: makeup aplicado uma vez (ganho não duplicado)");
    verificar(Math.abs(primeiro.volume - 0.8) < 1e-9, "T4: lógica de volume da pista intacta sob o grafo");

    player.definirFonteAudioTratada("c1", TRATADO);
    await rodar(player, corte, 2);
    const segundo = player.audioPool["t1"];
    g = player._estadoAudioAoVivo().grafos.get(segundo);
    verificar(ctx.fontesCriadas.get(segundo) === 1, "T4: elemento novo recebe sua ÚNICA fonte WebAudio");
    verificar(!!g && g.topologia.includes("makeup"), "T4: grafo roteado ANTES de o tratado tocar");
    verificar(ctx.fontesCriadas.get(primeiro) === 1, "T4: elemento antigo nunca ganha segunda fonte");
    let gAntigo = player._estadoAudioAoVivo().grafos.get(primeiro);
    verificar(gAntigo.topologia === "fonte>destino",
        "T4: elemento que saiu do ar fica em passagem plana (sem som processado escondido)");

    player.definirFonteAudioTratada("c1", null);
    await rodar(player, corte, 2);
    const deVolta = player.audioPool["t1"];
    g = player._estadoAudioAoVivo().grafos.get(deVolta);
    verificar(deVolta === primeiro, "T4: A/B de volta reusa o elemento original");
    verificar(ctx.fontesCriadas.get(deVolta) === 1, "T4: nenhuma recriação de fonte após idas e vindas");
    verificar(!!g && g.topologia.includes("makeup"), "T4: cadeia ao vivo religada sobre o original");
    verificar(!deVolta.paused, "T4: reprodução segue após duas viradas");
    TIMELINE_STATE.tracks[0].volume = 1.0;
}

console.log(falhas === 0 ? "\nTODOS OS AUTOTESTES F4 PASSARAM" : `\n${falhas} VERIFICACOES FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
