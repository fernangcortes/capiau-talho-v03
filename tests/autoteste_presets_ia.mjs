// Autoteste N2 — presets de IA no bloco audio_render de timelineInteraction.js.
// Extrai as constantes medidas e os métodos puros do arquivo real e prova, com
// asserts, o que a tarefa exige. Rodar: node tests/autoteste_presets_ia.mjs
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const dir = path.dirname(url.fileURLToPath(import.meta.url));
const ALVO = path.join(dir, "..", "src", "ui", "js", "timelineInteraction.js");
const fonte = fs.readFileSync(ALVO, "utf8");

let falhas = 0, ok = 0;
function checar(nome, cond) {
    if (cond) { ok++; console.log(`[OK]   ${nome}`); }
    else { falhas++; console.error(`[FALHOU] ${nome}`); }
}

// --- Extração: constantes medidas -------------------------------------------
function valorConst(nome) {
    const m = fonte.match(new RegExp(`const ${nome} = ([0-9.]+);`));
    if (!m) throw new Error(`constante ${nome} não encontrada`);
    return Number(m[1]);
}
const VEL_FFMPEG = valorConst("VELOCIDADE_RENDER_FFMPEG_X_TEMPO_REAL");
const VEL_IA = valorConst("VELOCIDADE_RENDER_DENOISE_IA_X_TEMPO_REAL");
checar("constantes medidas existem e são positivas", VEL_FFMPEG > 0 && VEL_IA > 0);

// --- Extração: métodos por casamento de chaves ------------------------------
function extrairMetodo(nome) {
    const marco = fonte.indexOf(`\n    ${nome}(`);
    if (marco < 0) throw new Error(`método ${nome} não encontrado`);
    const abre = fonte.indexOf("{", fonte.indexOf(")", marco));
    let prof = 0;
    for (let i = abre; i < fonte.length; i++) {
        const c = fonte[i];
        if (c === "{") prof++;
        else if (c === "}") { prof--; if (prof === 0) return fonte.slice(marco + 1, i + 1).trim(); }
    }
    throw new Error(`chaves desbalanceadas em ${nome}`);
}

const nomes = [
    "_velocidadesRender", "_estimativaRenderTexto", "_presetEhDeIa",
    "_presetsAudioRender", "_presetDeOpcoesAudioRender", "_opcoesIguaisAudioRender",
    "_montarCadeiaLocal", "_montarCorpoRender", "_opcoesDeEfeitoAudioRender",
];
const sut = new Function(
    `const VELOCIDADE_RENDER_FFMPEG_X_TEMPO_REAL = ${VEL_FFMPEG};
     const VELOCIDADE_RENDER_DENOISE_IA_X_TEMPO_REAL = ${VEL_IA};
     return {\n${nomes.map(extrairMetodo).join(",\n")}\n};`,
)();

// --- 1) Presets de IA aparecem no seletor, com custo no rótulo ---------------
const espelho = sut._presetsAudioRender();
checar("espelho tem resgate_ia e voz_limpa_ia com ia:true",
    espelho.resgate_ia?.ia === true && espelho.voz_limpa_ia?.ia === true);
checar("espelho bate com PRESETS_CADEIA (denoise_ia_db 18 e 6)",
    espelho.resgate_ia.denoise_ia_db === 18 && espelho.voz_limpa_ia.denoise_ia_db === 6);
for (const [chave, pedaco] of [
    ["resgate_ia", 'optSel("resgate_ia", "Resgate estourado com IA (lento)"'],
    ["voz_limpa_ia", 'optSel("voz_limpa_ia", "Voz limpa com IA (lento)"'],
]) {
    checar(`seletor lista ${chave} com o custo "(lento)" no rótulo`, fonte.includes(pedaco));
}

// --- 2) Estimativa honesta para 1320 s (22 min) -------------------------------
const ffmpegTxt = sut._estimativaRenderTexto(1320, "local", "so_entrega");
const segFfmpeg = Number((ffmpegTxt.match(/≈ ([0-9.,]+) s/) || [])[1]?.replace(",", "."));
checar("ffmpeg: 1320 s dão DEZENAS de segundos (20–60 s)", segFfmpeg >= 20 && segFfmpeg <= 60);
checar("ffmpeg: texto não promete minutos", !/min/.test(ffmpegTxt));
checar("ffmpeg: velocidade usada é a medida (÷ " + VEL_FFMPEG + ")", ffmpegTxt.includes(`÷ ${VEL_FFMPEG} `));

const iaTxt = sut._estimativaRenderTexto(1320, "local", "resgate_ia");
const mIa = iaTxt.match(/≈ (\d+) min (\d+) s/);
const totMinIa = mIa ? Number(mIa[1]) + Number(mIa[2]) / 60 : NaN;
checar("IA: 1320 s dão POR VOLTA de 15 min (RTF 0,68 medido; entre 14 e 16)", totMinIa >= 14 && totMinIa <= 16);
checar("IA: estimativa NÃO é a dezena de segundos do ffmpeg", !(iaTxt.match(/≈ [0-9,.]+ s/) && !mIa));
checar("IA: texto diz que o passo de IA é dezenas de vezes mais lento",
    iaTxt.includes("dezenas de vezes mais lento"));

// --- 3) Aviso visível SÓ nos presets de IA ------------------------------------
checar("_presetEhDeIa: verdadeiro nos dois presets de IA",
    sut._presetEhDeIa("resgate_ia") === true && sut._presetEhDeIa("voz_limpa_ia") === true);
checar("_presetEhDeIa: falso em clássicos, custom e indefinido",
    !sut._presetEhDeIa("so_entrega") && !sut._presetEhDeIa("resgate_estourado")
    && !sut._presetEhDeIa("previa_rapida") && !sut._presetEhDeIa("custom")
    && !sut._presetEhDeIa(undefined));
checar("elemento do aviso existe e nasce escondido (não bloqueia)",
    fonte.includes('id="adj-ar-aviso-ia"') && /id="adj-ar-aviso-ia"[^\n]*display:none/.test(fonte)
    && fonte.includes("'Prever 15 s'"));

// --- 4) Corpo do POST leva o preset escolhido ---------------------------------
// Opções como _lerOpcoesAudioRender devolve com cada preset de IA no seletor
// (o dB do denoise_ia vem do espelho do preset).
const opResgateIa = { reparo: true, fala: false, loudnorm: true, lufs: -16, teto: -1.5, limitador: true, ia: true, denoise_ia_db: 18 };
const opVozLimpaIa = { reparo: false, fala: false, loudnorm: true, lufs: -16, teto: -1.5, limitador: false, ia: true, denoise_ia_db: 6 };
const corpoResgate = sut._montarCorpoRender(opResgateIa, 10, 1330, false);
checar("POST: opções do resgate de IA viram preset=resgate_ia", corpoResgate.preset === "resgate_ia");
checar("POST: corpo leva in/out/previa do contrato F2",
    corpoResgate.in === 10 && corpoResgate.out === 1330 && corpoResgate.previa === false
    && corpoResgate.cadeia === undefined);
checar("POST: opções da voz limpa de IA viram preset=voz_limpa_ia",
    sut._montarCorpoRender(opVozLimpaIa, 0, 60, true).preset === "voz_limpa_ia");
checar("POST: clássicos continuam virando preset clássico",
    sut._montarCorpoRender({ ...espelho.so_entrega }, 0, 100, false).preset === "so_entrega");
const corpoCustom = sut._montarCorpoRender({ ...opResgateIa, fala: true }, 0, 100, false);
checar("custom derivado de IA mantém o passo caro na cadeia explícita",
    corpoCustom.preset === undefined && Array.isArray(corpoCustom.cadeia)
    && corpoCustom.cadeia.includes("denoise_ia:18"));
// --- 5) Reabertura coerente: chain gravada com denoise_ia marca preset de IA --
const opReabertas = sut._opcoesDeEfeitoAudioRender({ chain: ["adeclip", "adeclick", "denoise_ia:18", "loudnorm:-16:-1.5", "alimiter:-1.5"] });
checar("chain gravada com denoise_ia reabre como resgate_ia",
    opReabertas.ia === true && sut._presetDeOpcoesAudioRender(opReabertas) === "resgate_ia");
const opReabertasClassico = sut._opcoesDeEfeitoAudioRender({ chain: ["adeclip", "adeclick", "speechnorm", "loudnorm:-16:-1.5", "alimiter:-1.5"] });
checar("chain antiga sem IA continua reabrindo como resgate_estourado",
    opReabertasClassico.ia === false && sut._presetDeOpcoesAudioRender(opReabertasClassico) === "resgate_estourado");

console.log(`\n${ok} passaram, ${falhas} falharam.`);
process.exit(falhas ? 1 : 0);
