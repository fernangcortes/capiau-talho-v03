// Painel de Exportação de Vídeo — render da timeline para MP4 no backend (Pacote E).
//
// Este módulo é AUTO-LIGÁVEL: ele mesmo faz addEventListener no #btn-export-video e
// não depende de nenhum outro gerenciador da UI. O único acoplamento com main.js é
// uma chamada a initExportVideoPanel() depois dos managers. Nada em panels.js,
// player.js ou timelineState.js é tocado.
//
// ── MODO DE DEMONSTRAÇÃO ─────────────────────────────────────────────────────
// As rotas do motor de render (POST /api/timeline/{id}/render[/preflight] e
// GET /api/timeline/{id}/render/ultimo) são entregues pelo Pacote D. Enquanto elas
// não existem, o painel inteiro pode ser visto e testado SEM backend:
//
//     1. Abra src/ui/index.html no navegador (file:// ou servidor estático).
//     2. MODO_DEMONSTRACAO abaixo está `true`: preflight, render, progresso,
//        ETA e cancelamento são simulados com dados falsos (5 pistas com nomes
//        reais de produção, avisos de fidelidade com lista de clipes etc.).
//     3. Um selo âmbar "MODO DEMONSTRAÇÃO" fica visível no cabeçalho do modal
//        enquanto a constante estiver ligada — impossível confundir dado falso
//        com dado real.
//     4. Quando o Pacote D entregar as rotas, mude para `false`. Nada mais muda:
//        os mesmos caminhos de código são exercitados, só a origem dos dados muda
//        (e aí as respostas 404/503 caem na mensagem de motor indisponível).
//
// Parâmetros de URL (SÓ têm efeito com MODO_DEMONSTRACAO=true; servem para validar
// cada estado sem interação manual):
//     ?demo_export=1           abre o painel automaticamente
//     &demo_cenario=block      preflight com aviso "block" (botões desabilitados)
//     &demo_progress=1         rodapé já em estado de progresso, com Cancelar
//     &demo_close_ms=3000      fecha o modal após N ms (prova que o polling para)
//
// Sempre que uma rota real devolve 404/503/rede-caída, o painel mostra "o motor de
// render ainda não está instalado nesta versão" e continua utilizável — nenhuma
// exceção sobe e nenhum console.error é emitido por este módulo.
//
// Contratos usados (docs/PLANO_EXPORTACAO_VIDEO.md §5/§6/§7/§8):
//   POST /api/timeline/{id}/render/preflight  → { duracao_s, clipes, fps, largura,
//       altura, pistas[], midia{}, avisos[], saida{} }
//   POST /api/timeline/{id}/render            → { task_key, saida_prevista }
//   GET  /api/tasks                           → { "<task_key>": {percent,status,type,label} }
//       (fallback silencioso p/ GET /api/conversions — mesmo payload, é a rota que
//        hoje alimenta a aba Tarefas; cai fora quando a /api/tasks existir)
//   GET  /api/timeline/{id}/render/ultimo     → último render, se houver
//   POST /api/task/{task_key}/cancel          → cancelamento cooperativo

import { STATE } from "./state.js";
import { TIMELINE_STATE, framesToTimecode } from "./timelineState.js";

// ── CONSTANTES DE MÓDULO ─────────────────────────────────────────────────────

/** Ligue/desligue o modo de demonstração (instruções no cabeçalho deste arquivo). */
const MODO_DEMONSTRACAO = false;

const ROTAS = {
    timelines: (projectId) => `/api/timeline?project_id=${Number(projectId) || 1}`,
    preflight: (id) => `/api/timeline/${id}/render/preflight`,
    render:    (id) => `/api/timeline/${id}/render`,
    ultimo:    (id) => `/api/timeline/${id}/render/ultimo`,
    tasks:     ()   => "/api/tasks",
    tasksFallback: () => "/api/conversions",
    cancelar:  (key) => `/api/task/${encodeURIComponent(key)}/cancel`
};

// Chave de tarefa publicada pelo backend (Pedido.chave_tarefa). Serve para achar
// o nosso job dentro do dicionário de tarefas e para reabrir o painel com o
// progresso de um job que continuou rodando com o modal fechado.
const chaveTarefaRender = (timelineId) => `render_timeline_${timelineId}`;

// Presets enviados no campo "preset" do corpo. Os ids seguem o exemplo do §5
// ("youtube_1080"); se o Pacote C batizar diferente, basta ajustar este mapa —
// a UI não assume nada além destas strings.
// Ícones só do conjunto FREE do Font Awesome 6.4: fa-youtube é brand-only e não
// renderiza com fa-solid.
const PRESETS = [
    { id: "master_1080",   nome: "Master 1080p",      icone: "fa-crown",         dica: "Resolução da sequência, qualidade máxima." },
    { id: "youtube_1080",  nome: "YouTube",           icone: "fa-circle-play",   dica: "1080p H.264 + AAC, pronto para upload." },
    { id: "reels_916",     nome: "Reels/TikTok 9:16", icone: "fa-mobile-screen", dica: "Vertical 1080x1920 para redes sociais." },
    { id: "whatsapp_leve", nome: "WhatsApp leve",     icone: "fa-comment",       dica: "Arquivo pequeno para aprovação no celular." }
];

// Rótulos das categorias de escopo (§5 "categories"). A ordem é a de exibição.
const CATEGORIAS = [
    { id: "color",       nome: "Cor" },
    { id: "transitions", nome: "Transições" },
    { id: "motion",      nome: "Movimento e enquadramento" },
    { id: "audio_fx",    nome: "Ajustes de áudio" }
];

// Ícone por tipo de pista na lista "Incluir no render" (conjunto FREE do FA6:
// "waveform"/"waveform-lines" são Pro e ficariam em branco na tela).
const ICONE_KIND = { video: "fa-film", audio: "fa-music", ai: "fa-robot" };

const STORAGE_POST = (tlId) => `export-video-post_${tlId}`;
const INTERVALO_POLLING_MS = 1000;
const ATRASO_REPREFLIGHT_MS = 600;
// Batidas consecutivas sem a chave na lista antes de declarar falha: evita marcar
// "falha" por uma corrida entre o POST responder e o TASK_MANAGER publicar a chave.
const TICKS_TOLERANCIA_SEM_TAREFA = 3;

// Estado vivo do painel. Uma única instância: só existe um modal por página.
const _estado = {
    aberto: false,
    timelines: [],            // [{id,name,clip_count,created_at}] salvas no projeto
    timelineId: null,
    preflight: null,          // última resposta de preflight aplicada
    carregandoPreflight: false,
    timerRepreflight: null,
    // job
    taskKey: null,
    kindAtivo: null,          // "draft" | "master"
    inicioJobMs: 0,
    pollingTimer: null,
    pollingEmVoo: false,      // trava contra batidas sobrepostas
    pollsFeitos: 0,
    ticksSemTarefa: 0,
    faseJob: "idle"           // idle | enfileirado | rodando | concluido | falha | cancelado
};

let _el = {};                 // cache de elementos do modal

// ── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function _q(id) { return document.getElementById(id); }

function _esc(txt) {
    const d = document.createElement("div");
    d.textContent = String(txt ?? "");
    return d.innerHTML;
}

function _fmtDuracao(seg) {
    const s = Math.max(0, Number(seg) || 0);
    const m = Math.floor(s / 60);
    const resto = Math.round(s % 60);
    return `${m}:${String(resto).padStart(2, "0")}`;
}

function _fmtEta(ms) {
    if (!isFinite(ms) || ms <= 0) return "--:--";
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Fetch que NUNCA lança e NUNCA usa console.error: devolve { ok, status, data }.
 * O motivo é o requisito de degradação elegante: o polling roda a cada segundo e
 * um servidor fora do ar encheria o console de vermelho com o request() genérico
 * da casa. Falha de rede aqui é informação de estado, não exceção.
 */
async function _pedir(url, opcoes = {}) {
    try {
        const resp = await fetch(url, opcoes);
        let data = null;
        try { data = await resp.json(); } catch (_) { data = null; }
        return { ok: resp.ok, status: resp.status, data };
    } catch (_) {
        // TypeError de rede/DNS/servidor-morto cai aqui sem ruído.
        return { ok: false, status: 0, data: null };
    }
}

function _postJson(url, corpo) {
    return _pedir(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
    });
}

function _toast(msg, tipo) {
    if (window.showToast) window.showToast(msg, tipo);
}

/** Lê os parâmetros de validação (inertes fora do modo demonstração). */
function _paramDemo(nome) {
    if (!MODO_DEMONSTRACAO) return null;
    return new URLSearchParams(window.location.search).get(nome);
}

// ── CORPO DO PEDIDO (§5) ─────────────────────────────────────────────────────

function _lerPresetSelecionado() {
    const marcado = document.querySelector('input[name="ev-preset"]:checked');
    return marcado ? marcado.value : "master_1080";
}

function _lerRange() {
    const modoRadio = document.querySelector('input[name="ev-range"]:checked');
    const modo = modoRadio ? modoRadio.value : "full";
    if (modo !== "in_out") return { mode: "full" };
    const ini = Number((_el.rangeIni && _el.rangeIni.value) || 0) || 0;
    const fim = Number((_el.rangeFim && _el.rangeFim.value) || 0) || 0;
    return { mode: "in_out", start_s: ini, end_s: fim };
}

function _lerOverrides() {
    const numOuNulo = (chave, inteiro = false) => {
        const elv = _el[chave];
        if (!elv || String(elv.value).trim() === "") return null;
        const n = Number(elv.value);
        if (!isFinite(n)) return null;
        return inteiro ? Math.round(n) : n;
    };
    return {
        resolution: (_el.ovResolution && _el.ovResolution.value) || null,
        fps: numOuNulo("ovFps"),
        container: (_el.ovContainer && _el.ovContainer.value) || "mp4",
        codec: (_el.ovCodec && _el.ovCodec.value) || "h264",
        crf: numOuNulo("ovCrf", true),
        audio_bitrate: numOuNulo("ovAudioBitrate", true),
        mute_audio: !!(_el.ovMute && _el.ovMute.checked)
    };
}

function _lerScope() {
    const categories = {};
    CATEGORIAS.forEach(c => {
        const chk = _q(`ev-cat-${c.id}`);
        categories[c.id] = !chk || chk.checked; // ausente == ligado (contrato §5)
    });
    const tracks = {};
    (_estado.preflight && _estado.preflight.pistas || []).forEach(p => {
        const chk = _q(`ev-track-${p.id}`);
        tracks[p.id] = !chk || chk.checked;
    });
    return { categories, tracks };
}

function _lerPost() {
    return {
        open_folder: !!(_el.postAbrir && _el.postAbrir.checked),
        copy_path: !!(_el.postCopiar && _el.postCopiar.checked),
        save_as: !!(_el.postSalvar && _el.postSalvar.checked),
        ingest: !!(_el.postIngerir && _el.postIngerir.checked)
    };
}

function _corpoPedido(kind) {
    return {
        timeline_id: _estado.timelineId,
        kind,
        range: _lerRange(),
        preset: _lerPresetSelecionado(),
        overrides: _lerOverrides(),
        scope: _lerScope(),
        output: {
            dir: (_el.outDir && _el.outDir.value.trim()) || null,
            filename: (_el.outNome && _el.outNome.value.trim()) || null
        },
        post: _lerPost(),
        allow_proxy_fallback: !!(_el.proxyFallback && _el.proxyFallback.checked)
    };
}

// ── PERSISTÊNCIA DA PÓS-CONCLUSÃO (por timeline) ─────────────────────────────

function _carregarPostPersistido(tlId) {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(STORAGE_POST(tlId)) || "{}"); } catch (_) {}
    if (_el.postAbrir)   _el.postAbrir.checked   = prefs.open_folder !== false;
    if (_el.postCopiar)  _el.postCopiar.checked  = !!prefs.copy_path;
    if (_el.postSalvar)  _el.postSalvar.checked  = !!prefs.save_as;
    if (_el.postIngerir) _el.postIngerir.checked = !!prefs.ingest;
}

function _salvarPostPersistido() {
    if (!_estado.timelineId) return;
    try {
        localStorage.setItem(STORAGE_POST(_estado.timelineId), JSON.stringify(_lerPost()));
    } catch (_) { /* localStorage cheio/bloqueado: preferência é descartável */ }
}

// ── SIMULAÇÃO (MODO DE DEMONSTRAÇÃO) ─────────────────────────────────────────

// 5 pistas de nomes REAIS de produção — de propósito diferentes de V1/V2/A1/A2 —
// para provar que a lista de toggles é montada a partir do que o preflight mandar
// e nunca hardcodada. Uma oculta e uma mudada exercitam o estado inicial derivado.
const _PISTAS_FALSAS = [
    { id: "ENTREVISTA",    nome: "Entrevista Principal", kind: "video", muted: false, hidden: false, clipes: 14 },
    { id: "BROLL_COZINHA", nome: "B-Roll Cozinha",       kind: "video", muted: false, hidden: false, clipes: 22 },
    { id: "TITULOS",       nome: "Cartelas de Título",   kind: "video", muted: false, hidden: true,  clipes: 6 },
    { id: "LOCUCAO",       nome: "Locução Oficial",      kind: "audio", muted: false, hidden: false, clipes: 18 },
    { id: "TRILHA",        nome: "Trilha Sonora",        kind: "audio", muted: true,  hidden: false, clipes: 4 }
];

function _preflightFalso(cenario) {
    const avisosWarn = [
        {
            nivel: "warn", codigo: "joelho_compressor",
            titulo: "Joelho do compressor limitado a 8 dB",
            detalhe: "O compressor da tela tem joelho de 30 dB; o ffmpeg aceita no máximo 8 dB. Clipes com compressão forte podem soar mais duros no arquivo.",
            clipes: ["Entrevista_04.mp4 · 12,4s · pista Locução Oficial", "Entrevista_09.mp4 · 8,1s · pista Locução Oficial"]
        },
        {
            nivel: "warn", codigo: "midia_ausente",
            titulo: "1 mídia usada na timeline não foi encontrada no acervo",
            detalhe: "O trecho entra como lacuna preta, igualzinho ao preview.",
            clipes: ["broll_forno_02.mp4 (arquivo apagado da pasta de origem)"]
        }
    ];
    const avisoBlock = {
        nivel: "block", codigo: "original_indisponivel",
        titulo: "Original indisponível — HD F: desconectado",
        detalhe: "O master exige os arquivos originais. Reconecte o acervo ou autorize abaixo o fallback para proxy (qualidade reduzida, sufixo _proxy no nome).",
        clipes: ["entrevista_mestra_01.mov", "broll_graos_05.mov"]
    };

    const avisos = cenario === "block" ? [...avisosWarn, avisoBlock] : avisosWarn;
    return {
        duracao_s: 187.4,
        clipes: 64,
        fps: 24,
        largura: 1920,
        altura: 1080,
        pistas: JSON.parse(JSON.stringify(_PISTAS_FALSAS)),
        midia: {
            ausentes: ["broll_forno_02.mp4"],
            sem_original: cenario === "block" ? ["entrevista_mestra_01.mov", "broll_graos_05.mov"] : [],
            original_disponivel: cenario !== "block"
        },
        avisos,
        saida: {
            dir: "C:\\Users\\Programação\\Videos\\CapIAu\\renders",
            filename_sugerido: "Documentario_Talho_v3_2026-08-24_1530.mp4"
        }
    };
}

// Simulador de tarefa NO FORMATO DO TASK_MANAGER ({chave: {percent,status,...}}),
// consumido pelo MESMO código de polling que consome o backend real.
const _jobDemo = { ativo: false, percent: 0, status: "running", label: "[INIT] Na fila do render", timer: null };

function _demoIniciarJob(kind) {
    _jobDemo.ativo = true;
    _jobDemo.percent = 0;
    _jobDemo.status = "running";
    _jobDemo.label = kind === "master"
        ? "[INIT] Preparando grafo ffmpeg (master)"
        : "[INIT] Preparando grafo ffmpeg (rascunho)";
    const etapas = [
        [12, "[INIT] Resolvendo mídias (original/proxy)"],
        [28, "Decodificando fontes"],
        [55, "Renderizando segmento 2 de 5"],
        [78, "Renderizando segmento 4 de 5"],
        [92, "Codificando áudio AAC"],
        [100, "[FINISHED] Concatenando segmentos"]
    ];
    if (_jobDemo.timer) clearInterval(_jobDemo.timer);
    _jobDemo.timer = setInterval(() => {
        if (!_jobDemo.ativo) return;
        _jobDemo.percent = Math.min(100, _jobDemo.percent + 3 + Math.random() * 5);
        for (const [pct, label] of etapas) {
            if (_jobDemo.percent >= pct) _jobDemo.label = label;
        }
        if (_jobDemo.percent >= 100) {
            _jobDemo.status = "finished";
            _jobDemo.ativo = false;
            clearInterval(_jobDemo.timer);
            _jobDemo.timer = null;
        }
    }, 900);
}

// ── INICIALIZAÇÃO E LIGAÇÃO DOS CONTROLES ────────────────────────────────────

export function initExportVideoPanel() {
    _mapearElementos();
    const btn = _q("btn-export-video");
    if (!btn) return; // HTML ausente: o app carrega normal sem o painel

    btn.addEventListener("click", abrirPainel);

    if (_el.btnClose) _el.btnClose.addEventListener("click", fecharModal);
    // Clique no overlay (fora do conteúdo) também fecha — padrão dos outros modais.
    if (_el.modal) {
        _el.modal.addEventListener("mousedown", (e) => {
            if (e.target === _el.modal) fecharModal();
        });
    }

    if (_el.presetWrap) {
        _el.presetWrap.addEventListener("change", () => _agendarRepreflight());
    }
    ["ev-range-full", "ev-range-inout"].forEach(id => {
        const r = _q(id);
        if (r) r.addEventListener("change", () => {
            _atualizarVisibilidadeFaixa();
            _agendarRepreflight();
        });
    });

    // Repreflight ao mudar o escopo: os avisos dependem do que entra no render
    // (desligar "ajustes de áudio" elimina o aviso do compressor, por exemplo).
    CATEGORIAS.forEach(c => {
        const chk = _q(`ev-cat-${c.id}`);
        if (chk) chk.addEventListener("change", () => _agendarRepreflight());
    });
    if (_el.tracksList) {
        _el.tracksList.addEventListener("change", (e) => {
            if (e.target && e.target.name === "ev-track-toggle") _agendarRepreflight();
        });
    }

    // Troca de timeline salva: recarrega preferências + preflight.
    if (_el.timelineSelect) {
        _el.timelineSelect.addEventListener("change", () => {
            _estado.timelineId = Number(_el.timelineSelect.value) || null;
            _aposTrocaDeTimeline();
        });
    }

    [_el.postAbrir, _el.postCopiar, _el.postSalvar, _el.postIngerir].forEach(chk => {
        if (chk) chk.addEventListener("change", _salvarPostPersistido);
    });

    if (_el.btnVerTarefas) _el.btnVerTarefas.addEventListener("click", () => {
        // Fecha ANTES de abrir a aba: o modal e overlay e cobria justamente o
        // painel que o usuario pediu para ver. Fechar nao cancela o job (regra
        // 8 do plano) -- ele segue na fila e o progresso continua na aba.
        fecharModal();
        if (window.openTasksDrawerAndSwitchTab) window.openTasksDrawerAndSwitchTab();
    });
    if (_el.btnAbrirPasta) _el.btnAbrirPasta.addEventListener("click", () => _abrirPastaDoRender(true));
    if (_el.btnCopiarCaminho) _el.btnCopiarCaminho.addEventListener("click", () => _copiarCaminhoDoRender(true));
    if (_el.btnSalvarTimeline) _el.btnSalvarTimeline.addEventListener("click", salvarTimelineDaTela);
    if (_el.btnCancelJob) _el.btnCancelJob.addEventListener("click", cancelarJob);
    if (_el.btnVoltarIdle) _el.btnVoltarIdle.addEventListener("click", _voltarAoIdle);
    if (_el.btnRascunho) _el.btnRascunho.addEventListener("click", () => exportar("draft"));
    if (_el.btnMaster) _el.btnMaster.addEventListener("click", () => exportar("master"));

    // Seções recolhíveis: MESMO padrão do inspetor (.adjustments-section-header +
    // chevron rotacionado), sem inventar um terceiro padrão na base.
    if (_el.modal) {
        _el.modal.querySelectorAll(".adjustments-section-header[data-ev-toggle]").forEach(header => {
            header.addEventListener("click", () => {
                const secao = header.closest(".adjustments-section");
                const corpo = secao ? secao.querySelector(".adjustments-section-body") : null;
                if (!corpo) return;
                const vaiAbrir = corpo.style.display === "none";
                corpo.style.display = vaiAbrir ? "" : "none";
                const chev = header.querySelector(".adj-collapse-chevron");
                if (chev) chev.classList.toggle("open", vaiAbrir);
            });
        });

        // Steppers minimalistas (SKILL.md §9): traços acima/abaixo ao lado do número
        // flat ciano. Delegação num único listener — os botões são HTML estático.
        _el.modal.querySelectorAll(".ev-step").forEach(b => {
            b.addEventListener("click", () => {
                const alvo = _q(b.dataset.target);
                if (!alvo) return;
                const delta = Number(b.dataset.delta) || 0;
                const atual = Number(alvo.value);
                let base;
                if (isFinite(atual)) {
                    base = atual;
                } else {
                    // Campo vazio: o primeiro clique parte do placeholder (o padrão
                    // do preset), caindo para o piso quando não há placeholder.
                    base = Number(alvo.placeholder);
                    if (!isFinite(base)) base = alvo.min !== "" ? Number(alvo.min) : 0;
                }
                const min = alvo.min !== "" ? Number(alvo.min) : -Infinity;
                const max = alvo.max !== "" ? Number(alvo.max) : Infinity;
                alvo.value = String(Math.min(max, Math.max(min, base + delta)));
                alvo.dispatchEvent(new Event("input", { bubbles: true }));
            });
        });
    }

    // Ganchos de validação automática (inertes fora do modo demonstração).
    if (_paramDemo("demo_export") === "1") {
        setTimeout(abrirPainel, 150);
    }
}

function _mapearElementos() {
    _el = {
        modal: _q("export-video-modal"),
        btnClose: _q("btn-close-export-video"),
        seloDemo: _q("ev-selo-demo"),
        timelineSelect: _q("export-video-timeline-select"),
        infoNome: _q("ev-info-nome"),
        infoDuracao: _q("ev-info-duracao"),
        infoFps: _q("ev-info-fps"),
        infoRes: _q("ev-info-res"),
        infoClipes: _q("ev-info-clipes"),
        presetWrap: _q("ev-presets"),
        engineMsg: _q("ev-engine-indisponivel"),
        banner: _q("ev-banner-fidelidade"),
        tracksList: _q("ev-tracks-list"),
        proxyFallbackWrap: _q("ev-proxy-fallback-wrap"),
        proxyFallback: _q("ev-proxy-fallback"),
        rangeInOutRadio: _q("ev-range-inout"),
        rangeCampos: _q("ev-range-campos"),
        rangeResumo: _q("ev-range-resumo"),
        rangeIni: _q("ev-range-ini"),
        rangeFim: _q("ev-range-fim"),
        ovResolution: _q("ev-ov-resolution"),
        ovFps: _q("ev-ov-fps"),
        ovContainer: _q("ev-ov-container"),
        ovCodec: _q("ev-ov-codec"),
        ovCrf: _q("ev-ov-crf"),
        ovAudioBitrate: _q("ev-ov-audio-bitrate"),
        ovMute: _q("ev-ov-mute"),
        outDir: _q("ev-out-dir"),
        outNome: _q("ev-out-nome"),
        ultimoHint: _q("ev-ultimo-hint"),
        postAbrir: _q("ev-post-abrir"),
        postCopiar: _q("ev-post-copiar"),
        postSalvar: _q("ev-post-salvar"),
        postIngerir: _q("ev-post-ingerir"),
        footerIdle: _q("ev-footer-idle"),
        footerJob: _q("ev-footer-job"),
        btnRascunho: _q("ev-btn-rascunho"),
        btnMaster: _q("ev-btn-master"),
        progBar: _q("ev-progress-fill"),
        progPct: _q("ev-progress-pct"),
        progEtapa: _q("ev-progress-etapa"),
        progEta: _q("ev-progress-eta"),
        btnCancelJob: _q("ev-btn-cancelar"),
        btnVerTarefas: _q("ev-btn-ver-tarefas"),
        btnAbrirPasta: _q("ev-btn-abrir-pasta"),
        btnCopiarCaminho: _q("ev-btn-copiar-caminho"),
        desatualizada: _q("ev-desatualizada"),
        desatualizadaDetalhe: _q("ev-desatualizada-detalhe"),
        btnSalvarTimeline: _q("ev-btn-salvar-timeline"),
        btnVoltarIdle: _q("ev-btn-voltar"),
        jobStatusLinha: _q("ev-job-status-linha")
    };
}

export async function abrirPainel() {
    if (!_el.modal) _mapearElementos();
    if (!_el.modal) return;

    _estado.aberto = true;
    _estado.faseJob = "idle";
    _estado.taskKey = null;
    _estado.kindAtivo = null;
    _estado.pollsFeitos = 0;
    _estado.ticksSemTarefa = 0;
    _marcarPolling("ocioso");

    if (_el.seloDemo) _el.seloDemo.style.display = MODO_DEMONSTRACAO ? "" : "none";
    _mostrarEngineIndisponivel(null);          // limpa mensagem de uma abertura anterior
    _renderizarBanner([]);
    _limparPistas("Consultando o preflight…");
    _trocarFooter("idle");
    _setRotuloBotoes("Carregando…");

    _el.modal.classList.add("active");

    await _carregarTimelines();

    // Gancho de validação: rodapé direto em estado de progresso.
    if (_paramDemo("demo_progress") === "1" && _estado.faseJob === "idle") {
        _estado.taskKey = chaveTarefaRender(_estado.timelineId || 0);
        _estado.kindAtivo = "master";
        _estado.inicioJobMs = Date.now() - 42000; // simula job começou há 42s
        _jobDemo.percent = 47;
        _jobDemo.label = "Renderizando segmento 2 de 5";
        _jobDemo.status = "running";
        _jobDemo.ativo = true;
        _trocarFooter("job");
        _iniciarPolling(_estado.taskKey);
    }

    // Gancho de validação: fechar sozinho para provar que o polling morre junto.
    const fechaEm = Number(_paramDemo("demo_close_ms"));
    if (fechaEm && fechaEm > 500) {
        setTimeout(() => fecharModal(), fechaEm);
    }
}

function fecharModal() {
    if (!_el.modal || !_estado.aberto) return;
    // REGRA §8: fechar NÃO cancela. O job segue na fila e na aba Tarefas; aqui só
    // paramos O NOSSO relógio de resumo — um interval que sobrevivesse ao modal
    // seria um vazamento que aparece como lentidão inexplicável horas depois.
    pararPolling("modal fechado");
    if (_estado.timerRepreflight) {
        clearTimeout(_estado.timerRepreflight);
        _estado.timerRepreflight = null;
    }
    _estado.aberto = false;
    _el.modal.classList.remove("active");
}

function _voltarAoIdle() {
    if (_el.btnAbrirPasta) _el.btnAbrirPasta.style.display = "none";
    if (_el.btnCopiarCaminho) _el.btnCopiarCaminho.style.display = "none";
    // Após Concluído/Falha/Cancelado: volta o rodapé ao modo de edição sem fechar
    // o painel, permitindo disparar outro export (ex.: master depois do rascunho).
    _estado.taskKey = null;
    _estado.kindAtivo = null;
    _estado.faseJob = "idle";
    _marcarPolling("ocioso");
    _trocarFooter("idle");
    _reavaliarBotoes();
}

async function _carregarTimelines() {
    _estado.timelines = [];
    _estado.timelineId = null;

    if (MODO_DEMONSTRACAO) {
        await new Promise(r => setTimeout(r, 250)); // latência simulada
        _estado.timelines = [
            { id: 9001, name: "Documentário Talho — v3 (montagem final)", clip_count: 64, created_at: "2026-08-24T15:02" },
            { id: 8997, name: "Documentário Talho — v2 (corte bruto)",    clip_count: 71, created_at: "2026-08-23T10:44" }
        ];
    } else {
        // Fetch cru (não o request() genérico): servidor ausente NÃO pode virar
        // console.error aqui — vira mensagem de motor indisponível no painel.
        const r = await _pedir(ROTAS.timelines(STATE.currentProjectId));
        _estado.timelines = (r.ok && Array.isArray(r.data)) ? r.data : [];
    }

    if (_el.timelineSelect) {
        _el.timelineSelect.innerHTML = "";
        if (!_estado.timelines.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "Nenhuma timeline salva neste projeto";
            _el.timelineSelect.appendChild(opt);
            _el.timelineSelect.disabled = true;
        } else {
            _el.timelineSelect.disabled = false;
            // A listagem da API vem em id DESC (ProjectRepository.list_timelines):
            // a primeira é a versão mais recente, então é ela a seleção padrão.
            _estado.timelines.forEach((tl, idx) => {
                const opt = document.createElement("option");
                opt.value = String(tl.id);
                opt.textContent = `${tl.name || "(sem nome)"} · ${Number(tl.clip_count || 0)} clipes`;
                if (idx === 0) opt.selected = true;
                _el.timelineSelect.appendChild(opt);
            });
            _estado.timelineId = Number(_estado.timelines[0].id) || null;
        }
    }

    if (!_estado.timelineId) {
        _limparPistas("");
        if (_el.infoNome) _el.infoNome.textContent = "—";
        _setRotuloBotoes("Salve a timeline antes de exportar vídeo");
        _setBotaoExport(null, true, null, true);
        return;
    }

    await _aposTrocaDeTimeline();
}

async function _aposTrocaDeTimeline() {
    _carregarPostPersistido(_estado.timelineId);
    _restaurarUltimoRenderSeHouver(); // fire-and-forget: só enriquece o painel
    await executarPreflight();

    // Reabertura com job vivo: se esta timeline já tem render em andamento (começou
    // com o modal aberto, que depois foi fechado), retoma o resumo em vez de fingir
    // que nada roda (§8 — o job pertence à fila, não ao modal).
    if (!MODO_DEMONSTRACAO && _estado.faseJob === "idle" && _estado.taskKey === null && _estado.aberto) {
        const chave = chaveTarefaRender(_estado.timelineId);
        const tarefas = await _buscarTarefas();
        const t = tarefas[chave];
        if (t && ["running", "paused"].includes(String(t.status))) {
            _estado.taskKey = chave;
            _estado.faseJob = "rodando";
            _estado.inicioJobMs = Date.now();
            _trocarFooter("job");
            _iniciarPolling(chave);
        }
    }
}

// ── PREFLIGHT ────────────────────────────────────────────────────────────────

function _agendarRepreflight() {
    if (!_estado.aberto) return;
    if (_estado.timerRepreflight) clearTimeout(_estado.timerRepreflight);
    _estado.timerRepreflight = setTimeout(() => {
        _estado.timerRepreflight = null;
        executarPreflight();
    }, ATRASO_REPREFLIGHT_MS);
}

async function executarPreflight() {
    if (!_estado.aberto || !_estado.timelineId || _estado.carregandoPreflight) return;
    _estado.carregandoPreflight = true;
    if (_el.infoDuracao) _el.infoDuracao.textContent = "…";

    const corpo = _corpoPedido("master"); // o preflight usa a MESMA forma do render
    let resposta;

    if (MODO_DEMONSTRACAO) {
        await new Promise(r => setTimeout(r, 300));
        resposta = { ok: true, status: 200, data: _preflightFalso(_paramDemo("demo_cenario")) };
    } else {
        resposta = await _postJson(ROTAS.preflight(_estado.timelineId), corpo);
    }

    _estado.carregandoPreflight = false;

    if (!resposta.ok || !resposta.data) {
        // 404/503/rede-caída: mensagem clara, painel segue de pé, zero exceção.
        _mostrarEngineIndisponivel(resposta.status, resposta.data);
        _setRotuloBotoes("Motor indisponível");
        _setBotaoExport(null, true, null, true);
        return;
    }
    _mostrarEngineIndisponivel(null);
    _setRotuloBotoes(null); // restaura rótulos padrão dos botões
    aplicarPreflight(resposta.data);
}

/**
 * Achata a resposta do preflight no formato que o resto do painel consome.
 *
 * A rota devolve mais coisa do que o contrato original previa, e aninhada:
 * `resolucao.largura`, `fidelidade.avisos`, `clipes_total`. O painel foi escrito
 * contra o contrato plano (`largura`, `avisos`, `clipes`). Sem esta ponte o
 * cabeçalho mostra "undefined×undefined" — cosmético — e, o que é grave, o
 * banner de fidelidade NUNCA renderiza: `pf.avisos` sai undefined, nenhum aviso
 * aparece e o bloqueio por mídia ausente deixa de travar a exportação. O banner
 * é o mecanismo de honestidade do produto; ele falhar em silêncio é exatamente
 * o que este painel existe para impedir.
 *
 * Lê os dois formatos de propósito, para não quebrar se a rota for ajustada.
 */
function _normalizarPreflight(pf) {
    if (!pf || typeof pf !== "object") return pf;
    const res = pf.resolucao || {};
    const fid = pf.fidelidade || {};
    return Object.assign({}, pf, {
        largura: pf.largura != null ? pf.largura : res.largura,
        altura: pf.altura != null ? pf.altura : res.altura,
        clipes: pf.clipes != null ? pf.clipes
              : (pf.clipes_no_render != null ? pf.clipes_no_render : pf.clipes_total),
        avisos: Array.isArray(pf.avisos) ? pf.avisos
              : (Array.isArray(fid.avisos) ? fid.avisos : [])
    });
}

function aplicarPreflight(pfBruto) {
    const pf = _normalizarPreflight(pfBruto);
    _estado.preflight = pf || null;
    if (!pf) return;

    // 1. Cabeçalho: propriedades da TIMELINE vindas do preflight (nunca "detectadas").
    const tl = _estado.timelines.find(t => Number(t.id) === Number(_estado.timelineId));
    if (_el.infoNome) _el.infoNome.textContent = (tl && tl.name) || "(sem nome)";
    if (_el.infoDuracao) _el.infoDuracao.textContent = _fmtDuracao(pf.duracao_s);
    if (_el.infoFps) _el.infoFps.textContent = `${pf.fps} fps`;
    if (_el.infoRes) _el.infoRes.textContent = `${pf.largura}×${pf.altura}`;
    if (_el.infoClipes) _el.infoClipes.textContent = `${pf.clipes} clipes`;

    // 2. Faixa IN–OUT pré-preenchida com o alcance completo (editável).
    if (_el.rangeIni && document.activeElement !== _el.rangeIni) _el.rangeIni.value = "0";
    if (_el.rangeFim && document.activeElement !== _el.rangeFim) {
        _el.rangeFim.value = String(Math.round((Number(pf.duracao_s) || 0) * 10) / 10);
    }
    _atualizarVisibilidadeFaixa();

    // 3. Pistas REAIS (§7.5) — SEMPRE do preflight; nada de V1/V2/A1/A2 fixo.
    montarListaPistas(pf.pistas || []);

    // 4. Fallback de proxy só aparece quando há original indisponível.
    const precisaFallback = Array.isArray(pf.midia && pf.midia.sem_original) && pf.midia.sem_original.length > 0;
    if (_el.proxyFallbackWrap) _el.proxyFallbackWrap.style.display = precisaFallback ? "" : "none";

    // 4b. Tela x banco: avisa quando o que esta na tela nao e o que sera exportado.
    _avaliarDesatualizacao(pf);

    // 5. Banner de fidelidade + habilitação dos botões.
    _renderizarBanner(pf.avisos || []);
    _reavaliarBotoes();

    // 6. Destino sugerido (editável só para este export).
    if (_el.outDir && pf.saida && pf.saida.dir) _el.outDir.value = pf.saida.dir;
    if (_el.outNome && pf.saida && pf.saida.filename_sugerido && document.activeElement !== _el.outNome) {
        _el.outNome.value = pf.saida.filename_sugerido;
    }
}

function _limparPistas(msg) {
    if (!_el.tracksList) return;
    _el.tracksList.innerHTML = msg
        ? `<p class="ev-pistas-vazio">${_esc(msg)}</p>`
        : "";
}

/**
 * Monta UMA LINHA POR PISTA REAL do preflight. Estado inicial derivado de
 * muted/hidden (regra P7 do contrato): pista oculta sai do render; pista de áudio
 * mudada idem — incluir uma fonte silenciada só adicionaria silêncio ao mix.
 * Desligar aqui é ESCOPO (escolha do editor): gera toggle, nunca aviso (§2).
 */
function montarListaPistas(pistas) {
    if (!_el.tracksList) return;
    _el.tracksList.innerHTML = "";

    if (!pistas.length) {
        _limparPistas("O preflight não devolveu pistas.");
        return;
    }

    pistas.forEach(p => {
        const inicialmenteFora = !!p.hidden || (!!p.muted && p.kind === "audio");
        const linha = document.createElement("label");
        linha.className = "ev-track-row";
        linha.setAttribute("data-tooltip",
            `${p.nome} — ${p.clipes} clipe(s)` +
            (p.hidden ? " · oculta na tela (desmarcada por padrão)" : "") +
            (p.muted ? " · mudada (desmarcada por padrão)" : ""));

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.name = "ev-track-toggle";
        chk.id = `ev-track-${p.id}`;
        chk.checked = !inicialmenteFora;
        chk.style.accentColor = "#10b981"; // esmeralda: tema de mídia/saída

        const icone = document.createElement("i");
        icone.className = `fa-solid ${ICONE_KIND[p.kind] || "fa-film"} ev-track-icone ev-track-icone--${p.kind}`;

        const textos = document.createElement("span");
        textos.className = "ev-track-textos";
        textos.innerHTML =
            `<span class="ev-track-nome">${_esc(p.nome)}</span>` +
            `<span class="ev-track-meta">${_esc(p.id)} · ${p.clipes} clipe(s)` +
            (p.muted ? ' · <em class="ev-tag-muted">mudada</em>' : "") +
            (p.hidden ? ' · <em class="ev-tag-hidden">oculta</em>' : "") + "</span>";

        linha.appendChild(chk);
        linha.appendChild(icone);
        linha.appendChild(textos);
        _el.tracksList.appendChild(linha);
    });
}

function _atualizarVisibilidadeFaixa() {
    const inOut = _el.rangeInOutRadio && _el.rangeInOutRadio.checked;
    if (_el.rangeCampos) _el.rangeCampos.style.display = inOut ? "" : "none";
    if (_el.rangeResumo) _el.rangeResumo.style.display = inOut ? "" : "none";
    if (inOut) _atualizarResumoFaixa();
}

function _atualizarResumoFaixa() {
    if (!_el.rangeResumo) return;
    const fps = Number(_estado.preflight && _estado.preflight.fps) || TIMELINE_STATE.fps || 24;
    const ini = Number(_el.rangeIni && _el.rangeIni.value) || 0;
    const fim = Number(_el.rangeFim && _el.rangeFim.value) || 0;
    _el.rangeResumo.textContent =
        `IN ${framesToTimecode(Math.round(ini * fps), fps)} → OUT ${framesToTimecode(Math.round(fim * fps), fps)}` +
        ` · duração ${_fmtDuracao(Math.max(0, fim - ini))}`;
}

// ── ÚLTIMO RENDER (rota "ultimo") ────────────────────────────────────────────

async function _restaurarUltimoRenderSeHouver() {
    if (!_el.ultimoHint) return;
    _el.ultimoHint.style.display = "none";
    if (MODO_DEMONSTRACAO) return; // nada a restaurar em demonstração

    const r = await _pedir(ROTAS.ultimo(_estado.timelineId));
    if (!r.ok || !r.data) return;
    const caminho = r.data.arquivo || r.data.output_path || (r.data.saida && r.data.saida.caminho);
    if (!caminho) return;
    _el.ultimoHint.innerHTML =
        `<i class="fa-solid fa-clock-rotate-left"></i> Último render desta timeline: ${_esc(caminho)}` +
        (r.data.tamanho_mb ? ` · ${_esc(r.data.tamanho_mb)} MB` : "");
    _el.ultimoHint.style.display = "";
}

// ── BANNER DE FIDELIDADE (§7.6) ──────────────────────────────────────────────

function _renderizarBanner(avisos) {
    if (!_el.banner) return;
    const lista = Array.isArray(avisos) ? avisos : [];
    if (!lista.length) {
        _el.banner.style.display = "none";
        _el.banner.innerHTML = "";
        return;
    }

    const temBlock = lista.some(a => a.nivel === "block");
    _el.banner.style.display = "";
    _el.banner.className = `ev-banner ${temBlock ? "ev-banner--block" : "ev-banner--warn"}`;

    const cabecalho = document.createElement("div");
    cabecalho.className = "ev-banner-titulo";
    cabecalho.innerHTML = temBlock
        ? '<i class="fa-solid fa-triangle-exclamation"></i> Exportação bloqueada pela fidelidade'
        : '<i class="fa-solid fa-circle-exclamation"></i> Avisos de fidelidade';

    _el.banner.innerHTML = "";
    _el.banner.appendChild(cabecalho);

    lista.forEach(a => {
        const item = document.createElement("div");
        item.className = `ev-aviso ev-aviso--${a.nivel === "block" ? "block" : "warn"}`;

        const titulo = document.createElement("div");
        titulo.className = "ev-aviso-titulo";
        titulo.innerHTML = `<strong>${_esc(a.titulo)}</strong>`;
        item.appendChild(titulo);

        if (a.detalhe) {
            const det = document.createElement("div");
            det.className = "ev-aviso-detalhe";
            det.textContent = a.detalhe;
            item.appendChild(det);
        }

        // Lista de clipes EXPANSÍVEL: “2 crossfades serão simplificados” sem dizer
        // QUAIS é inútil — mas 40 nomes abertos atrapalham a leitura do painel.
        const clipes = Array.isArray(a.clipes) ? a.clipes : [];
        if (clipes.length) {
            const btnLista = document.createElement("button");
            btnLista.type = "button";
            btnLista.className = "ev-aviso-ver-clipes";
            btnLista.setAttribute("data-tooltip", "Mostrar/ocultar os clipes afetados");
            btnLista.innerHTML = `<i class="fa-solid fa-chevron-right"></i> ${clipes.length} clipe(s) afetado(s)`;

            const ul = document.createElement("ul");
            ul.className = "ev-aviso-lista";
            ul.style.display = "none";
            clipes.forEach(c => {
                const li = document.createElement("li");
                li.textContent = c;
                ul.appendChild(li);
            });
            btnLista.addEventListener("click", () => {
                const vaiAbrir = ul.style.display === "none";
                ul.style.display = vaiAbrir ? "" : "none";
                btnLista.querySelector("i").className =
                    `fa-solid fa-chevron-right${vaiAbrir ? " ev-chevron-baixo" : ""}`;
            });
            item.appendChild(btnLista);
            item.appendChild(ul);
        }
        _el.banner.appendChild(item);
    });
}

function _temBloqueio() {
    const avisos = (_estado.preflight && _estado.preflight.avisos) || [];
    return avisos.some(a => a.nivel === "block");
}

function _reavaliarBotoes() {
    const bloqueado = _temBloqueio();
    const rodando = _estado.faseJob === "rodando" || _estado.faseJob === "enfileirado";
    const pronto = !!_estado.preflight && !_estado.carregandoPreflight;
    const desabilitar = bloqueado || rodando || !pronto;
    _setBotaoExport(null, desabilitar, null, true);

    if (_el.jobStatusLinha) {
        if (bloqueado && _estado.faseJob === "idle") {
            _el.jobStatusLinha.textContent = "Resolva os itens de bloqueio acima para liberar os botões.";
            _el.jobStatusLinha.style.display = "";
        } else {
            _el.jobStatusLinha.style.display = "none";
        }
    }
}

/** Troca só o texto do rótulo preservando os ícones; null = restaurar o padrão. */
function _setRotuloBotoes(texto) {
    [_el.btnRascunho, _el.btnMaster].forEach(b => {
        if (!b) return;
        const rotulo = b.querySelector(".ev-btn-rotulo");
        if (!rotulo) return;
        if (!b.dataset.rotuloPadrao) b.dataset.rotuloPadrao = rotulo.textContent;
        rotulo.textContent = texto === null || texto === undefined
            ? (b.dataset.rotuloPadrao || rotulo.textContent)
            : texto;
    });
}

function _setBotaoExport(botao, desabilitar, texto, forcarAmbos = false) {
    const alvos = forcarAmbos ? [_el.btnRascunho, _el.btnMaster].filter(Boolean) : [botao].filter(Boolean);
    alvos.forEach(b => {
        if (desabilitar !== null && desabilitar !== undefined) {
            b.disabled = !!desabilitar;
            b.classList.toggle("ev-btn-desabilitado", !!desabilitar);
        }
        if (texto !== null && texto !== undefined) {
            const spanRotulo = b.querySelector(".ev-btn-rotulo");
            if (spanRotulo) spanRotulo.textContent = texto;
        }
    });
}

// ── EXPORTAR (RASCUNHO / MASTER) ─────────────────────────────────────────────

async function exportar(kind) {
    if (_temBloqueio()) {
        _toast("Exportação bloqueada pelos avisos de fidelidade.", "error");
        return;
    }
    if (!_estado.timelineId) {
        _toast("Salve a timeline antes de exportar vídeo.", "error");
        return;
    }
    if (_estado.faseJob === "rodando" || _estado.faseJob === "enfileirado") {
        _toast("Já existe um render desta timeline na fila.", "info");
        return;
    }

    const botao = kind === "draft" ? _el.btnRascunho : _el.btnMaster;
    const htmlOriginal = botao ? botao.innerHTML : "";
    if (botao) {
        // Micro-interação da casa: pulse → spinner inline → checkmark (SKILL.md §11).
        botao.classList.remove("btn-thumb-click-pulse");
        void botao.offsetWidth; // reinicia a animação se reusado
        botao.classList.add("btn-thumb-click-pulse");
        botao.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        botao.disabled = true;
    }

    const corpo = _corpoPedido(kind);
    let resposta;
    if (MODO_DEMONSTRACAO) {
        await new Promise(r => setTimeout(r, 500));
        resposta = {
            ok: true, status: 200,
            data: { task_key: chaveTarefaRender(_estado.timelineId), saida_prevista: corpo.output.filename }
        };
        _demoIniciarJob(kind);
    } else {
        resposta = await _postJson(ROTAS.render(_estado.timelineId), corpo);
    }

    if (botao) {
        botao.innerHTML = '<i class="fa-solid fa-check" style="color:#34d399;"></i>';
        setTimeout(() => { botao.innerHTML = htmlOriginal; }, 1000);
    }

    if (!resposta.ok || !resposta.data || !resposta.data.task_key) {
        if (resposta.status === 404 || resposta.status === 503 || resposta.status === 0) {
            _mostrarEngineIndisponivel(resposta.status, resposta.data);
            _toast("Motor de render indisponível nesta versão.", "error");
        } else {
            _toast(`O render não foi enfileirado (HTTP ${resposta.status}).`, "error");
        }
        _reavaliarBotoes();
        return;
    }

    _estado.taskKey = resposta.data.task_key;
    // Caminho do arquivo, para as acoes de pos-conclusao e os botoes de abrir/copiar.
    _estado.saidaPrevista = resposta.data.saida_prevista
        || resposta.data.output_path_previsto || null;
    _estado.kindAtivo = kind;
    _estado.faseJob = "enfileirado";
    _estado.inicioJobMs = Date.now();
    _estado.ticksSemTarefa = 0;
    _trocarFooter("job");
    _iniciarPolling(_estado.taskKey);
    _toast(
        kind === "master"
            ? "Master enfileirado! O MP4 aparece na pasta escolhida ao concluir."
            : "Rascunho enfileirado!",
        "success"
    );
}

// ── POLLING DE PROGRESSO (GET /api/tasks) ────────────────────────────────────

function _marcarPolling(estadoStr) {
    // Atributo invisível ao usuário; serve de prova automatizada de que o timer
    // morre junto com o modal (validação pedida no briefing).
    if (_el.modal) _el.modal.setAttribute("data-ev-polling", estadoStr);
}

function _iniciarPolling(taskKey) {
    const jaTinhaTimer = !!_estado.pollingTimer;
    if (jaTinhaTimer) {
        clearInterval(_estado.pollingTimer);
        _estado.pollingTimer = null;
    }
    _estado.ticksSemTarefa = 0;
    _marcarPolling("ativo");
    console.log(`[ExportVideo] Polling INICIADO para ${taskKey} (intervalo ${INTERVALO_POLLING_MS} ms)`);
    _pollTick(); // primeira batida imediata
    _estado.pollingTimer = setInterval(_pollTick, INTERVALO_POLLING_MS);
}

function pararPolling(motivo) {
    if (_estado.pollingTimer) {
        clearInterval(_estado.pollingTimer);
        _estado.pollingTimer = null;
        console.log(`[ExportVideo] Polling PARADO (${motivo}) após ${_estado.pollsFeitos} consulta(s)`);
    }
    _marcarPolling("parado");
}

async function _buscarTarefas() {
    // A rota VIVA é /api/conversions; /api/tasks nunca existiu neste app. Tentar
    // a inexistente primeiro custava um 404 por segundo, enchendo o console do
    // usuário de vermelho durante todo o render — e foi exatamente esse ruído
    // que fez o log de uma exportação BEM-SUCEDIDA parecer um desastre.
    // A ordem está invertida de propósito: se um dia /api/tasks existir, ela
    // entra como fallback e a troca é de uma linha.
    let r = await _pedir(ROTAS.tasksFallback());
    if (r.status === 404) r = await _pedir(ROTAS.tasks());
    return (r.ok && r.data && typeof r.data === "object") ? r.data : {};
}

async function _pollTick() {
    if (!_estado.aberto || !_estado.taskKey) {
        pararPolling("modal fechado ou sem job");
        return;
    }
    if (_estado.pollingEmVoo) return; // resposta lenta: pula esta batida, sem empilhar
    _estado.pollingEmVoo = true;
    _estado.pollsFeitos += 1;

    let tarefa;
    if (MODO_DEMONSTRACAO) {
        tarefa = {
            percent: Math.round(_jobDemo.percent),
            status: _jobDemo.status,
            type: "render",
            label: _jobDemo.label
        };
    } else {
        const tarefas = await _buscarTarefas();
        tarefa = tarefas[_estado.taskKey];
    }
    _estado.pollingEmVoo = false;

    if (!tarefa) {
        _estado.ticksSemTarefa += 1;
        if (_estado.ticksSemTarefa >= TICKS_TOLERANCIA_SEM_TAREFA) {
            _aplicarProgresso({ percent: 0, status: "failed", type: "render", label: "A tarefa saiu da fila sem terminar (veja o log na aba Tarefas)." });
        }
        return; // dentro da tolerância: aguarda a próxima batida
    }
    _estado.ticksSemTarefa = 0;
    _aplicarProgresso(tarefa);
}

function _aplicarProgresso(tarefa) {
    const status = String(tarefa.status || "").toLowerCase();
    const pct = (tarefa.percent === null || tarefa.percent === undefined)
        ? null
        : Math.max(0, Math.min(100, Number(tarefa.percent)));

    if (_el.progEtapa) {
        _el.progEtapa.textContent = tarefa.label
            || (status === "queued" || status === "pending"
                ? "Na fila — a exportação começa assim que a anterior terminar."
                : "Renderizando…");
    }
    if (_el.progPct) _el.progPct.textContent = pct === null ? "—" : `${Math.round(pct)}%`;
    if (_el.progBar) _el.progBar.style.width = `${pct === null ? 0 : pct}%`;

    // ETA pela taxa observada (TASK_MANAGER não publica eta; derivar aqui evita
    // inventar contrato). Só faz sentido com progresso real medindo.
    if (_el.progEta) {
        let etaTxt = "--:--";
        if (pct !== null && pct >= 2 && _estado.inicioJobMs) {
            const decorrido = Date.now() - _estado.inicioJobMs;
            etaTxt = _fmtEta(decorrido * (100 - pct) / Math.max(pct, 0.1));
        }
        _el.progEta.textContent = etaTxt;
    }

    // Estados NAO-terminais. "queued" e publicado por execucao.py enquanto o job
    // espera a vez na fila sequencial, e ficava de fora desta lista: caia no
    // ramo terminal, nao casava com "finished"/"cancelled" e virava FALHA. O
    // render seguia rodando e terminava bem, mas o painel ja tinha anunciado
    // fracasso e parado o relogio. "pending" entra junto porque e o status que o
    // POST /render devolve no corpo, e um dia pode chegar aqui tambem.
    if (["running", "paused", "queued", "pending", ""].includes(status)) {
        if (_estado.faseJob !== "rodando") {
            _estado.faseJob = "rodando";
            _reavaliarBotoes(); // trava os botões de export enquanto roda
        }
        if (_el.btnCancelJob) {
            _el.btnCancelJob.style.display = "";
            _el.btnCancelJob.disabled = false;
            _el.btnCancelJob.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar';
        }
        return;
    }

    // Estados terminais: para o relógio AGORA, não na próxima batida.
    pararPolling(`tarefa ${status}`);
    _estado.faseJob = ["finished", "completed"].includes(status) ? "concluido"
        : status === "cancelled" ? "cancelado"
        : "falha";

    if (_estado.faseJob === "concluido") {
        if (_el.progBar) _el.progBar.style.width = "100%";
        if (_el.progPct) _el.progPct.textContent = "100%";
        if (_el.progEtapa) _el.progEtapa.textContent = "Concluído — arquivo gravado no destino.";
        _toast("Render de vídeo concluído!", "success");
        _executarPosConclusao();   // abre pasta / copia caminho conforme os checkboxes
    } else if (_estado.faseJob === "cancelado") {
        if (_el.progEtapa) _el.progEtapa.textContent = "Cancelado — parcial descartado.";
        _toast("Render cancelado.", "info");
    } else {
        if (_el.progEtapa) _el.progEtapa.textContent = tarefa.label || "Falha no render — veja o log na aba Tarefas.";
        _toast("Falha no render de vídeo.", "error");
    }

    if (_el.btnCancelJob) _el.btnCancelJob.style.display = "none";
    if (_el.btnVoltarIdle) _el.btnVoltarIdle.style.display = ""; // "Novo export"
    _reavaliarBotoes();
}

async function cancelarJob() {
    if (!_estado.taskKey) return;
    if (_el.btnCancelJob) {
        _el.btnCancelJob.disabled = true;
        _el.btnCancelJob.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cancelando…';
    }

    let ok = true;
    if (MODO_DEMONSTRACAO) {
        _jobDemo.ativo = false;
        _jobDemo.status = "cancelled";
        _jobDemo.label = "[CANCEL] Render cancelado pelo usuário.";
        await new Promise(r => setTimeout(r, 350));
    } else {
        const r = await _postJson(ROTAS.cancelar(_estado.taskKey), {});
        ok = r.ok;
    }

    if (ok) {
        _toast("Cancelamento solicitado — o ffmpeg é encerrado em segundos.", "info");
        // O próximo tick do polling reflete o status "cancelled"; se o modal fechar
        // antes, tanto faz: o cancelamento foi pedido ao servidor, não ao modal.
    } else {
        if (_el.btnCancelJob) {
            _el.btnCancelJob.disabled = false;
            _el.btnCancelJob.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar';
        }
        _toast("Não foi possível cancelar agora. Tente pela aba Tarefas.", "error");
    }
}

function _trocarFooter(modo) {
    if (_el.footerIdle) _el.footerIdle.style.display = modo === "idle" ? "" : "none";
    if (_el.footerJob) _el.footerJob.style.display = modo === "job" ? "" : "none";
    if (_el.btnVoltarIdle) _el.btnVoltarIdle.style.display = "none";
    if (modo === "job") {
        if (_el.btnCancelJob) {
            _el.btnCancelJob.style.display = "";
            _el.btnCancelJob.disabled = false;
            _el.btnCancelJob.innerHTML = '<i class="fa-solid fa-xmark"></i> Cancelar';
        }
        if (_el.jobStatusLinha) {
            // A dúvida nº 1 de quem usa NLE, respondida NA INTERFACE:
            _el.jobStatusLinha.textContent =
                "Fechar este painel NÃO cancela o render — ele segue na fila. Acompanhe pela aba Tarefas.";
            _el.jobStatusLinha.style.display = "";
        }
    }
}

// ── DEGRADAÇÃO ELEGANTE (rota ausente / servidor fora) ───────────────────────

/**
 * Mensagem de falha do preflight/render — separando MOTOR AUSENTE de PEDIDO RECUSADO.
 *
 * Antes, qualquer status não-ok virava "o motor não está instalado". Um 422
 * (corpo rejeitado pelo schema) aparecia com essa cara e mandava o usuário
 * procurar defeito na instalação, quando o defeito estava no pedido — aconteceu
 * de verdade em 24/08/2026, com `overrides.audio_bitrate: null`. Diagnóstico
 * errado é pior que diagnóstico nenhum: manda consertar a coisa errada.
 *
 * 404/501/503 => o motor realmente não está nesta versão.
 * 400/422     => o motor existe e recusou ESTE pedido; mostra o detalhe do servidor.
 * 0           => nem chegou ao servidor.
 */
function _mostrarEngineIndisponivel(statusHttp, detalhe) {
    if (!_el.engineMsg) return;
    if (statusHttp === null || statusHttp === undefined) {
        _el.engineMsg.style.display = "none";
        return;
    }

    const ausente = [404, 501, 503].indexOf(Number(statusHttp)) >= 0;
    const recusado = [400, 422].indexOf(Number(statusHttp)) >= 0;

    let html;
    if (statusHttp === 0) {
        html = '<i class="fa-solid fa-plug-circle-xmark"></i> ' +
            "<strong>Não consegui falar com o servidor.</strong><br>" +
            "Verifique se o CapIAu está rodando e tente de novo.";
    } else if (ausente) {
        html = '<i class="fa-solid fa-plug-circle-xmark"></i> ' +
            "<strong>O motor de render ainda não está instalado nesta versão.</strong><br>" +
            `O servidor respondeu HTTP ${_esc(String(statusHttp))}. ` +
            "A Exportar Timeline (.otio/.xml/.edl) continua funcionando normalmente.";
    } else if (recusado) {
        html = '<i class="fa-solid fa-triangle-exclamation"></i> ' +
            "<strong>O servidor recusou este pedido de exportação.</strong><br>" +
            `HTTP ${_esc(String(statusHttp))}. O motor está instalado; o problema é o ` +
            "pedido em si — normalmente um campo da seção Avançado." +
            (detalhe ? `<br><code>${_esc(_resumirDetalhe(detalhe))}</code>` : "");
    } else {
        html = '<i class="fa-solid fa-triangle-exclamation"></i> ' +
            `<strong>Falha na exportação (HTTP ${_esc(String(statusHttp))}).</strong>` +
            (detalhe ? `<br><code>${_esc(_resumirDetalhe(detalhe))}</code>` : "");
    }
    _el.engineMsg.innerHTML = html;
    _el.engineMsg.style.display = "";
}

/** Detalhe do FastAPI (string ou lista de erros de validação) em uma linha legível. */
function _resumirDetalhe(detalhe) {
    const d = (detalhe && detalhe.detail !== undefined) ? detalhe.detail : detalhe;
    if (typeof d === "string") return d.slice(0, 300);
    if (Array.isArray(d)) {
        return d.slice(0, 3).map(e => {
            const campo = Array.isArray(e.loc) ? e.loc.filter(x => x !== "body").join(".") : "";
            return `${campo}: ${e.msg || ""}`.trim();
        }).join(" · ").slice(0, 300);
    }
    try { return JSON.stringify(d).slice(0, 300); } catch (_) { return ""; }
}

// ── VERSÃO DA TELA × VERSÃO SALVA ────────────────────────────────────────────
//
// A exportação lê a timeline do BANCO. O autosave da timeline grava em
// localStorage (timelineAutosave.js) — só o "Salvar timeline" manda para o banco.
// Quem ajusta cor/transform e exporta sem salvar renderiza a versão ANTERIOR, e
// até 24/08/2026 isso acontecia em silêncio absoluto: o arquivo saía certo do
// ponto de vista do motor e errado do ponto de vista do editor.

/** Assinatura da timeline que está NA TELA, no mesmo formato do preflight. */
function _assinaturaDaTela() {
    const cortes = (STATE && STATE.activeTimelineCuts) || [];
    if (!Array.isArray(cortes) || !cortes.length) return null;
    const idsIA = new Set(
        ((TIMELINE_STATE && TIMELINE_STATE.tracks) || [])
            .filter(t => String(t.kind || "").toLowerCase() === "ai")
            .map(t => String(t.id))
    );
    const fps = Number((TIMELINE_STATE && TIMELINE_STATE.fps) || 24) || 24;
    let clipes = 0, efeitos = 0, duracao = 0;
    cortes.forEach(c => {
        if (idsIA.has(String(c.track))) return;         // P1: pista de IA nunca renderiza
        clipes += 1;
        efeitos += Array.isArray(c.effects) ? c.effects.length : 0;
        const dur = (c.outFrame !== undefined && c.inFrame !== undefined)
            ? (c.outFrame - c.inFrame) / fps
            : (Number(c.out) || 0) - (Number(c.in) || 0);
        duracao += Math.max(0, dur);
    });
    return { clipes, efeitos, duracao_total_s: Math.round(duracao * 100) / 100 };
}

/**
 * Compara tela × banco e mostra a faixa de aviso. Só compara quando a timeline
 * escolhida no modal é a MESMA que está aberta na tela — exportar uma versão
 * antiga de propósito é uso legítimo e não merece alarme.
 */
function _avaliarDesatualizacao(pf) {
    if (!_el.desatualizada) return;
    const salva = pf && pf.assinatura;
    const tela = _assinaturaDaTela();
    // O app nao registra em lugar nenhum QUAL timeline esta aberta na tela, entao
    // a comparacao e sempre contra a versao SELECIONADA no modal. Se o usuario
    // escolheu outra versao de proposito, o aviso continua verdadeiro: a tela tem
    // conteudo diferente do que vai ser exportado -- que e exatamente o fato que
    // ele precisa saber antes de apertar Exportar.
    if (!salva || !tela) {
        _el.desatualizada.style.display = "none";
        return;
    }

    const difs = [];
    if (tela.clipes !== salva.clipes) {
        difs.push(`${tela.clipes} clipe(s) na tela contra ${salva.clipes} salvo(s)`);
    }
    if (tela.efeitos !== salva.efeitos) {
        difs.push(`${tela.efeitos} ajuste(s) na tela contra ${salva.efeitos} salvo(s)`);
    }
    if (Math.abs(tela.duracao_total_s - salva.duracao_total_s) > 0.05) {
        difs.push(`${tela.duracao_total_s}s na tela contra ${salva.duracao_total_s}s salvos`);
    }

    if (!difs.length) {
        _el.desatualizada.style.display = "none";
        return;
    }
    if (_el.desatualizadaDetalhe) {
        _el.desatualizadaDetalhe.textContent =
            `A exportação usa a versão salva no banco: ${difs.join(" · ")}. ` +
            "Salve antes de exportar, ou o arquivo sai sem as alterações recentes.";
    }
    _el.desatualizada.style.display = "";
}

/** Salva a timeline da tela como nova versão e passa a exportar ela. */
async function salvarTimelineDaTela() {
    const btn = _el.btnSalvarTimeline;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Salvando…';
    }
    try {
        const { CapIAuAPI } = await import("./api.js");
        const base = (_estado.timelines.find(t => Number(t.id) === Number(_estado.timelineId)) || {}).name
            || (TIMELINE_STATE && TIMELINE_STATE.nome) || "Timeline";
        const carimbo = new Date().toISOString().slice(0, 16).replace("T", " ");
        const r = await CapIAuAPI.saveTimeline(
            STATE.currentProjectId, `${base} (export ${carimbo})`,
            "Versão salva pelo painel de exportação",
            STATE.activeTimelineCuts, TIMELINE_STATE.tracks,
            TIMELINE_STATE.fps, TIMELINE_STATE.width || 1920, TIMELINE_STATE.height || 1080
        );
        const novoId = r && (r.timeline_id || r.id);
        if (!novoId) throw new Error("o servidor não devolveu o id da timeline salva");
        _toast("Timeline salva. A exportação vai usar esta versão.", "success");
        // Recarrega a lista e seleciona a nova versão: o usuário pediu para
        // exportar o que está na tela, e agora ela existe no banco.
        await _carregarTimelines();
        _estado.timelineId = Number(novoId);
        if (_el.timelineSelect) _el.timelineSelect.value = String(novoId);
        await _aposTrocaDeTimeline();
    } catch (err) {
        _toast(`Não consegui salvar a timeline: ${err && err.message ? err.message : err}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar e usar esta versão';
        }
    }
}

// ── AÇÕES PÓS-RENDER ─────────────────────────────────────────────────────────
//
// Os checkboxes de "Após concluir" eram coletados, enviados no corpo do pedido e
// ignorados pelos dois lados — ficavam marcados e nada acontecia. Agora quem
// executa é o painel, que é quem sabe o momento exato em que o arquivo ficou
// pronto.

/** Caminho do arquivo do render corrente (o previsto pelo POST, ou o do log). */
function _caminhoDoRender() {
    return _estado.saidaPrevista || null;
}

async function _abrirPastaDoRender(avisar) {
    const caminho = _caminhoDoRender();
    if (!caminho) {
        if (avisar) _toast("Ainda não sei o caminho do arquivo renderizado.", "error");
        return;
    }
    const r = await _postJson("/api/render/revelar", { caminho });
    if (r.ok) {
        if (avisar) _toast("Pasta aberta com o arquivo selecionado.", "success");
    } else if (avisar) {
        const det = (r.data && (r.data.detail || r.data.message)) || `HTTP ${r.status}`;
        _toast(`Não consegui abrir a pasta: ${_resumirDetalhe(det)}`, "error");
    }
}

async function _copiarCaminhoDoRender(avisar) {
    const caminho = _caminhoDoRender();
    if (!caminho) {
        if (avisar) _toast("Ainda não sei o caminho do arquivo renderizado.", "error");
        return;
    }
    try {
        await navigator.clipboard.writeText(caminho);
        if (avisar) _toast("Caminho copiado.", "success");
    } catch (_) {
        // clipboard bloqueado (contexto não seguro): seleciona num campo temporário
        const ta = document.createElement("textarea");
        ta.value = caminho;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); if (avisar) _toast("Caminho copiado.", "success"); }
        catch (_e) { if (avisar) _toast("Não consegui copiar; o caminho está no log da aba Tarefas.", "error"); }
        document.body.removeChild(ta);
    }
}

/** Executa as preferências marcadas em "Após concluir". */
async function _executarPosConclusao() {
    if (_el.btnAbrirPasta) _el.btnAbrirPasta.style.display = "";
    if (_el.btnCopiarCaminho) _el.btnCopiarCaminho.style.display = "";
    if (_el.postAbrir && _el.postAbrir.checked) await _abrirPastaDoRender(false);
    if (_el.postCopiar && _el.postCopiar.checked) await _copiarCaminhoDoRender(false);
}
