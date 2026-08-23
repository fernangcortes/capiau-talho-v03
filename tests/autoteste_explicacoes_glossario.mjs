// Autoteste das explicacoes clicaveis (icones (i) / glossario N2) no painel de ajustes.
// Roda com dubles em node puro:  node tests/autoteste_explicacoes_glossario.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ───────────────────────────── dubles de DOM ─────────────────────────────
class FakeEl {
    constructor(tag, doc) {
        this.tagName = String(tag || "div").toUpperCase();
        this.children = [];
        this.dataset = {};
        this.attrs = {};
        this.style = {};
        this.listeners = {};
        this._html = "";
        this.className = "";
        this.type = "";
        this.ownerDocument = doc || null;
        this.parentNode = null;
        this.isConnected = false;
        this._stopProp = 0;
    }
    setAttribute(k, v) { if (k === "data-tooltip") this.dataset.tooltip = v; else this.attrs[k] = String(v); }
    getAttribute(k) { return k === "data-tooltip" ? this.dataset.tooltip : (k in this.attrs ? this.attrs[k] : null); }
    getBoundingClientRect() { return { top: 10, bottom: 30, left: 12, width: 200, height: 50 }; }
    appendChild(c) { c.parentNode = this; c.isConnected = true; this.children.push(c); return c; }
    replaceWith(novo) {
        this.isConnected = false;
        const pai = this.parentNode;
        if (!pai) return;
        const i = pai.children.indexOf(this);
        if (i >= 0) pai.children[i] = novo;
        novo.parentNode = pai;
        novo.isConnected = true;
    }
    remove() {
        this.isConnected = false;
        const pai = this.parentNode;
        if (!pai) return;
        const i = pai.children.indexOf(this);
        if (i >= 0) pai.children.splice(i, 1);
        this.parentNode = null;
    }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    querySelectorAll(sel) {
        const classes = (String(sel).match(/\.([A-Za-z0-9_-]+)/g) || []).map(s => s.slice(1));
        if (classes.length === 0) return [];
        return this.children.filter(c => classes.every(k => String(c.className || "").split(/\s+/).includes(k)));
    }
    _clique(alvo) {
        (this.listeners.click || []).slice().forEach((f) => f({
            target: alvo,
            stopPropagation: () => { this._stopProp += 1; },
        }));
    }
    set innerHTML(v) { this._html = String(v); }
    get innerHTML() { return this._html; }
}

class FakeDoc {
    constructor() {
        this.body = new FakeEl("body", this);
        this.body.isConnected = true;
        this.defaultView = { innerWidth: 600, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {} };
        this.porId = new Map();
    }
    createElement(tag) { return new FakeEl(tag, this); }
    getElementById(id) { return this.porId.get(id) || null; }
    addEventListener() {}
    removeEventListener() {}
}

// ─────────── carrega timelineInteraction.js como módulo avaliável ───────────
let codigo = readFileSync(path.join(raiz, "src/ui/js/timelineInteraction.js"), "utf8");
codigo = codigo.replace(/^import\s.*$/gm, "").replace(/^export\s+(?=(function|class|const|let|var))/gm, "");
codigo = `
const STATE = __d.state;
const TIMELINE_STATE = __d.timelineState;
const TIMELINE_HISTORY = { begin() {}, commit() {}, record(f) { f(); } };
const setTabVisibility = () => {};
const secondsToFrames = (s) => s;
const framesToSeconds = (f) => f;
const framesToTimecode = (f) => String(f);
const evaluateFadeCurve = () => 0;
const FADE_CURVE_PRESETS = {};
` + codigo;
codigo += "\nglobalThis.__exports = { CapiauTimelineInteraction };\n";

const stateStub = {
    activeTimelineCuts: [],
    allVideos: [],
    allPhotos: [],
    on: () => {},
    emit: () => {},
};

const timelineStub = {
    selectedClipId: null,
    trackKindOf: () => "audio",
};

const sandbox = {
    __d: { state: stateStub, timelineState: timelineStub },
    // dublê do window global: init pendura listeners direto nele
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    document: new FakeDoc(),
    console,
};
vm.createContext(sandbox);
vm.runInContext(codigo, sandbox, { filename: "timelineInteraction.js" });
const { CapiauTimelineInteraction } = sandbox.__exports;

function novaInstancia(doc) {
    doc.defaultView.addEventListener = () => {};
    const canvas = new FakeEl("canvas", doc);
    canvas.ownerDocument = doc;
    return new CapiauTimelineInteraction({ canvas, requestRedraw: () => {} });
}

let falhas = 0;
function verificar(cond, msg) {
    if (!cond) { falhas++; console.error("FALHOU:", msg); }
    else { console.log("ok -", msg); }
}

// Glossário na forma EXATA do contrato N2 (o que a rota devolve).
const CORPO_ROTA = {
    ok: true,
    total: 2,
    entradas: {
        lufs_i: {
            titulo: "Loudness (LUFS)",
            resumo: "O quanto o som fica alto na média.",
            detalhe: "Medido em LUFS.\nO alvo da casa é -16.",
            na_pratica: "Se o diagnóstico marcar longe do alvo, use um preset de tratamento.",
            secao: "diagnostico",
            relacionado: ["dbtp"],
        },
        dbtp: {
            titulo: "Pico real (dBTP)",
            resumo: "O quanto o som estoura num instante.",
            detalhe: "Pico verdadeiro, com overshoot.",
            na_pratica: "Deixe o teto em -1,5 dBTP para entrega em redes sociais.",
            secao: "diagnostico",
            relacionado: [],
        },
    },
};

// ───────────── T1: validação do contrato N2 (_validarGlossario) ─────────────
{
    const inst = novaInstancia(new FakeDoc());
    const mapa = inst._validarGlossario(JSON.parse(JSON.stringify(CORPO_ROTA)));
    verificar(!!mapa && Object.keys(mapa).length === 2, "T1: corpo do contrato vira mapa usável");
    verificar(mapa.lufs_i.detalhe.indexOf("\n") >= 0, "T1: detalhe preservado com quebra de linha");
    verificar(Array.isArray(mapa.dbtp.relacionado) && mapa.dbtp.relacionado.length === 0, "T1: relacionado ausente vira lista vazia");
    verificar(inst._validarGlossario({ ok: false }) === null, "T1: ok=false não vira glossário");
    verificar(inst._validarGlossario(null) === null, "T1: corpo nulo rejeitado");
    verificar(inst._validarGlossario({ ok: true }) === null, "T1: corpo sem entradas rejeitado");
    const parcial = inst._validarGlossario({ ok: true, entradas: { a: { titulo: "A" }, b: { resumo: "sem título" }, c: "lixo" } });
    verificar(!!parcial && Object.keys(parcial).length === 1 && !!parcial.a, "T1: entrada sem título é descartada, as boas ficam");
}

// ───────── T2/T7: consulta com DUBLÊ da rota + cache curto de sessão ─────────
{
    const doc = new FakeDoc();
    const inst = novaInstancia(doc);
    let chamadas = 0;
    let urlVista = "";
    inst._fetchGlossarioDuble = async (url) => {
        chamadas++;
        urlVista = url;
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(CORPO_ROTA)) };
    };

    const primeira = await inst._consultarGlossario();
    verificar(urlVista === "/api/audio/glossario", "T2: dublê consultado em GET /api/audio/glossario");
    verificar(!!primeira && !!primeira.lufs_i, "T2: conteúdo veio DO DUBLÊ DA ROTA (não vive no JavaScript)");
    await inst._consultarGlossario();
    await inst._consultarGlossario();
    verificar(chamadas === 1, "T2: cache curto de sessão - rota consultada uma única vez");

    // Conteúdo do painel nasce do cache da rota (mesma fonte do chat).
    inst._alternarExplica(doc.body, "lufs_i", null);
    // (sem ícone conectado o painel cai no canto; aqui só interessa o conteúdo)
    const painel = inst._explicaAberta && inst._explicaAberta.painel;
    verificar(!!painel && painel.innerHTML.indexOf("Loudness (LUFS)") >= 0, "T7: painel mostra o título vindo da rota");
    verificar(!!painel && painel.innerHTML.indexOf("alvo da casa é -16") >= 0, "T7: painel mostra o detalhe vindo da rota");
    verificar(!!painel && painel.innerHTML.indexOf("Na prática") >= 0 && painel.innerHTML.indexOf("preset de tratamento") >= 0, "T7: bloco 'Na prática' destacado presente");
    verificar(!!painel && painel.innerHTML.indexOf('data-explica-vai="dbtp"') >= 0, "T7: relacionado vira caminho direto para a explicação dele");
    painel.remove();
    inst._explicaAberta = null;
}

// ───────── T3: rota FALHANDO => nenhum ícone, painel segue inteiro ─────────
{
    const doc = new FakeDoc();
    const container = new FakeEl("div", doc);
    doc.porId.set("adjustments-panel-content", container);
    const slotBom = new FakeEl("span", doc);
    slotBom.className = "capiau-explica-slot";
    slotBom.dataset.explica = "lufs_i lufs";
    const slotOutro = new FakeEl("span", doc);
    slotOutro.className = "capiau-explica-slot";
    slotOutro.dataset.explica = "hpf autoeq";
    container.appendChild(slotBom);
    container.appendChild(slotOutro);

    const inst = novaInstancia(doc);
    inst._fetchGlossarioDuble = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const resultado = await inst._montarIconesExplica(container);

    verificar(resultado === null, "T3: rota falhando devolve null");
    verificar(inst._glossarioCache === null, "T3: falha NÃO envenena o cache");
    verificar(container.children.length === 0, "T3: nenhum ícone aparece quando a rota falha");
    verificar(typeof container.appendChild === "function" && !inst._explicaAberta, "T3: painel segue de pé e usável, sem painel fantasma");

    // Dublê que REJEITA (servidor fora do ar) também não pode criar ícone nem lançar.
    inst._fetchGlossarioDuble = async () => { throw new Error("rede caída"); };
    container.appendChild(slotBom);
    const r2 = await inst._montarIconesExplica(container);
    verificar(r2 === null && container.children.length === 0, "T3: erro de rede também fica sem ícones, sem exceção");
}

// ───────────── T4: montagem do ícone a partir das âncoras ─────────────
{
    const doc = new FakeDoc();
    const container = new FakeEl("div", doc);
    doc.porId.set("adjustments-panel-content", container);
    const mkSlot = (chaves) => {
        const s = new FakeEl("span", doc);
        s.className = "capiau-explica-slot";
        s.dataset.explica = chaves;
        container.appendChild(s);
        return s;
    };
    const slotMetrica = mkSlot("true_peak_db dbtp true_peak");   // 1ª candidata NÃO existe, a 2ª sim
    const slotApelido = mkSlot("nao_existe lufs_i");             // só a 2ª existe
    const slotSem = mkSlot("totalmente_fora");                   // nenhuma existe

    const inst = novaInstancia(doc);
    inst._fetchGlossarioDuble = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(CORPO_ROTA)) });
    await inst._montarIconesExplica(container);

    const icones = container.children.filter(c => c.className === "capiau-explica");
    verificar(icones.length === 2, "T4: dois ícones montados, âncora sem entrada sumiu");
    const icone = icones[0];
    verificar(slotMetrica.isConnected === false && icone.isConnected === true, "T4: ícone entrou NO LUGAR da âncora");
    verificar(icone.dataset.explicaChave === "dbtp", "T4: vence a 1ª candidata que EXISTE no glossário (fallback entre candidatas)");
    verificar(icone.getAttribute("aria-label").indexOf("Pico real") >= 0, "T4: aria-label com o título da entrada");
    verificar(String(icone.dataset.tooltip).indexOf("estoura num instante") >= 0, "T4: tooltip de hover traz o resumo curtinho");
    verificar(String(icone.innerHTML).indexOf("fa-circle-info") >= 0, "T4: ícone é o (i) de linha");
    verificar(icones[1].dataset.explicaChave === "lufs_i", "T4: candidata secundária é usada quando a 1ª não existe");
    verificar(!slotSem.isConnected, "T4: âncora sem entrada nenhuma foi removida");

    // Re-render do sub-bloco recria âncoras; remarca é idempotente no que já virou ícone.
    await inst._montarIconesExplica(container);
    verificar(container.children.filter(c => c.className === "capiau-explica").length === 2, "T4: remarcar não duplica ícones");
}

// ─── T5/T6/T8/T9: delegação, abrir/fechar no clique, um por vez, navegação ───
{
    const doc = new FakeDoc();
    const container = new FakeEl("div", doc);
    const inst = novaInstancia(doc);
    inst._glossarioCache = inst._validarGlossario(JSON.parse(JSON.stringify(CORPO_ROTA)));

    const iconeA = new FakeEl("button", doc);
    iconeA.className = "capiau-explica";
    iconeA.dataset.explicaChave = "lufs_i";
    iconeA.isConnected = true;
    const iconeB = new FakeEl("button", doc);
    iconeB.className = "capiau-explica";
    iconeB.dataset.explicaChave = "dbtp";
    iconeB.isConnected = true;

    inst._ligarDelegacaoExplica(container);
    inst._ligarDelegacaoExplica(container);
    verificar((container.listeners.click || []).length === 1, "T5: delegação única - religar o painel não empilha ouvinte");

    // clique fora de ícone: nada acontece
    container._clique({ closest: () => null });
    verificar(!inst._explicaAberta, "T5: clique fora dos (i) não abre nada");

    // abre A
    container._clique({ closest: (sel) => (sel === ".capiau-explica" ? iconeA : null) });
    verificar(container._stopProp >= 1, "T5: clique no (i) não vaza para os handlers de seção (stopPropagation)");
    let aberto = inst._explicaAberta;
    verificar(!!aberto && aberto.chave === "lufs_i" && aberto.painel.isConnected, "T5: clique no (i) ABRiu o painel detalhado");
    verificar(doc.body.children.length === 1, "T5: exatamente um painel no documento");
    const posTop = aberto.painel.style.top;
    const posLeft = aberto.painel.style.left;
    verificar(typeof posTop === "string" && typeof posLeft === "string" && aberto.painel.style.zIndex !== "", "T5: painel posicionado junto ao ícone");

    // abre B com A ainda aberto: UM painel aberto por vez
    container._clique({ closest: (sel) => (sel === ".capiau-explica" ? iconeB : null) });
    aberto = inst._explicaAberta;
    verificar(aberto.chave === "dbtp", "T6: abrir outro ícone fechou o anterior e abriu o novo");
    verificar(doc.body.children.length === 1, "T6: só UM painel aberto por vez (anterior removido do documento)");

    // navegação por relacionado dentro do MESMO painel (posição mantida)
    const painelB = aberto.painel;
    const botaoRel = { closest: (sel) => (sel === "[data-explica-vai]" ? { dataset: { explicaVai: "lufs_i" } } : null) };
    painelB._clique(botaoRel);
    verificar(inst._explicaAberta.chave === "lufs_i", "T8: clique no relacionado leva à explicação dele");
    verificar(inst._explicaAberta.painel === painelB, "T8: é o MESMO painel (não abre outro)");
    verificar(doc.body.children.length === 1, "T8: continua um único painel no documento");
    verificar(painelB.style.top === posTop && painelB.style.left === posLeft, "T8: posição mantida na navegação");
    verificar(painelB.innerHTML.indexOf("alvo da casa é -16") >= 0, "T8: conteúdo trocado para a entrada relacionada");

    // fechar pelo X
    painelB._clique({ closest: (sel) => (sel === ".capiau-explica-fechar" ? { dataset: {} } : null) });
    verificar(!inst._explicaAberta && doc.body.children.length === 0, "T9: botão fechar fecha o painel e limpa o estado");

    // toggle: segundo clique no MESMO ícone fecha
    container._clique({ closest: (sel) => (sel === ".capiau-explica" ? iconeA : null) });
    container._clique({ closest: (sel) => (sel === ".capiau-explica" ? iconeA : null) });
    verificar(!inst._explicaAberta && doc.body.children.length === 0, "T5b: clicar DE NOVO no mesmo ícone fecha");

    // entrada ausente no glossário nunca abre painel vazio
    iconeB.dataset.explicaChave = "fora_do_glossario";
    container._clique({ closest: (sel) => (sel === ".capiau-explica" ? iconeB : null) });
    verificar(!inst._explicaAberta && doc.body.children.length === 0, "T5c: chave sem entrada não abre painel vazio");
}

console.log(falhas === 0 ? "\nTUDO OK - autoteste das explicações passou" : `\n${falhas} verificação(ões) falharam`);
process.exit(falhas === 0 ? 0 : 1);
