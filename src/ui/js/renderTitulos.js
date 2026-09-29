// renderTitulos.js — lado navegador do render de títulos (render_titulos.html).
//
// O Python (src/export/video_render/titulos.py) abre esta página num navegador
// headless e chama as funções em window.RENDER_TITULOS. Tudo o que decide a aparência
// vem de tituloRender.js e keyframeEngine.js, os mesmos módulos do preview.
import { montarElementoTitulo, estadoTitulo, pesoTitulo, estiloTitulo, temCaixa, DESFOQUE_CAIXA_PX } from "./tituloRender.js";
import { ensureFontLoaded } from "./fontManager.js";

const palco = document.getElementById("palco");

function _familia(clip) {
    return clip.fontFamily ? String(clip.fontFamily).trim().replace(/['"]/g, "") : "Outfit";
}

/** Espera as folhas do Google Fonts injetadas por ensureFontLoaded terminarem de carregar. */
async function _esperarFolhas(limiteMs = 8000) {
    const folhas = [...document.querySelectorAll('link[rel="stylesheet"][href*="fonts.googleapis"]')];
    await Promise.all(folhas.map(l => (l.sheet ? Promise.resolve() : new Promise(res => {
        l.addEventListener("load", res, { once: true });
        l.addEventListener("error", res, { once: true });
        setTimeout(res, limiteMs);
    }))));
}

/**
 * A fonte está mesmo em uso? document.fonts.check devolve true quando NENHUMA face
 * corresponde (inclusive antes da folha do Google chegar), então mede o texto contra
 * duas famílias genéricas: se a largura muda, a família pedida foi usada. Vale também
 * para fontes instaladas no sistema, que não aparecem em document.fonts.
 */
function _fonteEmUso(familia, amostra, face = "400") {
    const ctx = document.createElement("canvas").getContext("2d");
    const medir = (pilha) => { ctx.font = `${face} 48px ${pilha}`; return ctx.measureText(amostra).width; };
    return ["monospace", "serif"].some(g => medir(`"${familia}", ${g}`) !== medir(g));
}

// Fontes enviadas para o projeto (servidas pelo Python na rota interna): url -> FontFace
const fontesRegistradas = new Map();

async function _registrarFonteDoProjeto(f) {
    if (fontesRegistradas.has(f.url)) return;
    const face = new FontFace(f.familia, `url("${f.url}")`);
    try {
        await face.load();
        document.fonts.add(face);
    } catch (_) { /* a medição em preparar() acusa o substituto */ }
    fontesRegistradas.set(f.url, face);
}

window.RENDER_TITULOS = {
    /**
     * Ajusta o palco ao quadro e garante a fonte do título carregada.
     * `fontes` = fontes enviadas para o projeto [{familia, url}]; a do título é registrada.
     * Devolve {fonte, fonteDisponivel}: false quando o navegador caiu num substituto
     * (fonte do Google sem internet, fonte que não está no projeto...).
     */
    async preparar(clip, largura, altura, fontes = []) {
        palco.style.width = `${largura}px`;
        palco.style.height = `${altura}px`;
        const familia = _familia(clip);
        const estilo = estiloTitulo(clip);
        // Faces que o título usa: texto no peso/estilo do clipe, subtexto 400 (herda o estilo)
        const face = `${estilo} ${pesoTitulo(clip)}`;
        const faces = [face, `${estilo} 400`];
        const propria = (fontes || []).find(f => f.familia.toLowerCase() === familia.toLowerCase());
        if (propria) await _registrarFonteDoProjeto(propria);
        ensureFontLoaded(familia, estilo);
        const amostra = `${clip.text || ""}${clip.subtext || ""}`.trim() || "Aa";
        await _esperarFolhas();
        try {
            await Promise.all(faces.map(f => document.fonts.load(`${f} 48px "${familia}"`, amostra)));
        } catch (_) { /* a medição abaixo diz se deu certo */ }
        await document.fonts.ready;
        return { fonte: familia, face, fonteDisponivel: _fonteEmUso(familia, amostra, face), caixa: temCaixa(clip), desfoquePx: DESFOQUE_CAIXA_PX };
    },

    /** Chave do estado visual em cada quadro [inicio, fim) relativo ao início do clipe. */
    estados(clip, fps, inicio, fim) {
        const chaves = [];
        for (let f = inicio; f < fim; f++) {
            chaves.push(JSON.stringify(estadoTitulo(clip, f / fps)));
        }
        return chaves;
    },

    /** Deixa no palco só o título no instante `relTimeS` (escala 1: pixels do quadro). */
    desenhar(clip, relTimeS) {
        palco.innerHTML = "";
        palco.appendChild(montarElementoTitulo(document, clip, relTimeS, 1));
        return true;
    },

    /**
     * Máscara da área que o backdrop-filter desfoca na tela: a caixa do título (mesma
     * posição, transformação, raio e opacidade), preenchida opaca, sem texto nem sombras.
     * O ffmpeg desfoca o vídeo composto e o recorta por ela antes de pôr a foto do título.
     */
    mascara(clip, relTimeS) {
        palco.innerHTML = "";
        const el = montarElementoTitulo(document, clip, relTimeS, 1);
        el.style.backgroundColor = "#ffffff";
        el.style.color = "transparent";
        el.style.textShadow = "none";
        el.style.boxShadow = "none";
        el.style.backdropFilter = "none";
        el.style.webkitBackdropFilter = "none";
        palco.appendChild(el);
        return true;
    }
};

window.RENDER_TITULOS_PRONTO = true;
