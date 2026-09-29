// tituloRender.js — monta o elemento visual de um título (clipe de texto).
//
// Ponto ÚNICO usado pelo preview (playerTextOverlay) e pelo render do arquivo
// (render_titulos.html, fotografada por um navegador headless). Se os dois lados
// montassem o título cada um do seu jeito, o arquivo exportado divergiria da tela
// no primeiro detalhe de CSS.
//
// Unidades: tamanhos (fonte, espaçamento, padding, raio, sombras) são PIXELS DO QUADRO
// da sequência (1920×1080 por padrão), como em qualquer NLE. `escala` converte para o
// tamanho em que o quadro está sendo mostrado: 1 no render; largura do monitor ÷ largura
// da sequência no preview. Posição e largura máxima já são relativas (%).
import { evaluateClipTransform, evaluateClipProperty } from "./keyframeEngine.js";

/** Propriedades avaliadas do título num instante (serve também para detectar quadros iguais). */
export function estadoTitulo(clip, relTimeS) {
    const tf = evaluateClipTransform(clip, relTimeS);
    return {
        x: tf.x,
        y: tf.y,
        scale: tf.scale,
        rotation: tf.rotation,
        opacity: tf.opacity,
        fontSize: evaluateClipProperty(clip, "fontSize", relTimeS, clip.fontSize || 36),
        tracking: evaluateClipProperty(clip, "tracking", relTimeS, clip.tracking || 0)
    };
}

/** Peso da fonte do título ("100".."900"); sem valor ou inválido = 400 (títulos antigos). */
export function pesoTitulo(clip) {
    const p = String(clip.fontWeight ?? "").trim().toLowerCase();
    if (/^[1-9]00$/.test(p)) return p;
    if (p === "bold") return "700";
    return "400";
}

/** Estilo da fonte do título: "italic" ou "normal". */
export function estiloTitulo(clip) {
    return String(clip.fontStyle || "").trim().toLowerCase() === "italic" ? "italic" : "normal";
}

/** Desfoque do vídeo atrás da caixa (backdrop-filter), em pixels do quadro. O render
 *  do arquivo lê este valor para reproduzir o mesmo desfoque no ffmpeg. */
export const DESFOQUE_CAIXA_PX = 10;

/** O título tem caixa de fundo (com desfoque do vídeo atrás)? */
export function temCaixa(clip) {
    const bg = clip.backgroundColor;
    return !(!bg || bg === "transparent" || bg === "#00000000" || clip.bgMode === "transparent");
}

function _sombraEscalada(sombra, e) {
    // "0 2px 10px rgba(...)" -> px multiplicados pela escala
    return sombra.replace(/(-?\d*\.?\d+)px/g, (_, n) => `${Number(n) * e}px`);
}

/**
 * Cria o elemento do título para o instante `relTimeS` (segundos desde o início do clipe).
 * Sem handlers de interação: quem precisa (o preview) os acrescenta.
 */
export function montarElementoTitulo(doc, clip, relTimeS, escala = 1) {
    const e = (Number.isFinite(escala) && escala > 0) ? escala : 1;
    const st = estadoTitulo(clip, relTimeS);

    const el = doc.createElement("div");
    el.className = "player-text-rendered-item";
    el.dataset.clipId = String(clip.id);

    // Alinhamento horizontal
    const textAlign = clip.alignment || "center";
    const justifyVal = textAlign === "left" ? "flex-start" : (textAlign === "right" ? "flex-end" : "center");

    el.style.position = "absolute";
    el.style.left = `calc(50% + ${st.x}%)`;
    el.style.top = `calc(50% + ${st.y}%)`;
    el.style.transform = `translate(-50%, -50%) scale(${st.scale}) rotate(${st.rotation}deg)`;
    el.style.opacity = st.opacity;
    el.style.transformOrigin = "center center";
    el.style.fontFamily = clip.fontFamily ? `"${clip.fontFamily}", sans-serif` : "'Outfit', 'Inter', sans-serif";
    el.style.fontSize = `${st.fontSize * e}px`;
    el.style.fontWeight = pesoTitulo(clip);
    el.style.fontStyle = estiloTitulo(clip);
    el.style.letterSpacing = `${st.tracking * e}px`;
    el.style.color = clip.color || "#ffffff";
    el.style.textAlign = textAlign;
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.alignItems = justifyVal;
    el.style.userSelect = "none";
    el.style.whiteSpace = "pre-wrap";
    el.style.wordBreak = "break-word";
    el.style.maxWidth = "90%";
    el.style.lineHeight = String(clip.lineHeight || 1.2);

    const bgVal = clip.backgroundColor;

    if (temCaixa(clip)) {
        const pad = clip.boxPadding !== undefined ? clip.boxPadding : 8;
        const raio = clip.boxBorderRadius !== undefined ? clip.boxBorderRadius : 4;
        el.style.backgroundColor = bgVal;
        el.style.padding = `${pad * e}px ${14 * e}px`;
        el.style.borderRadius = `${raio * e}px`;
        el.style.boxShadow = _sombraEscalada("0 8px 32px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.08)", e);
        el.style.backdropFilter = `blur(${DESFOQUE_CAIXA_PX * e}px)`;
        el.style.webkitBackdropFilter = `blur(${DESFOQUE_CAIXA_PX * e}px)`;
        el.style.textShadow = _sombraEscalada("0 1px 4px rgba(0,0,0,0.6)", e);
    } else {
        el.style.backgroundColor = "transparent";
        el.style.padding = "0";
        el.style.borderRadius = "0";
        el.style.boxShadow = "none";
        el.style.backdropFilter = "none";
        el.style.webkitBackdropFilter = "none";
        el.style.textShadow = _sombraEscalada("0 2px 10px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.9)", e);
    }

    // Conteúdo principal e subtexto (Lower Third)
    const mainTextSpan = doc.createElement("span");
    mainTextSpan.className = "text-main-body";
    mainTextSpan.textContent = clip.text || "";
    el.appendChild(mainTextSpan);

    if (clip.subtext && clip.subtext.trim()) {
        const subSpan = doc.createElement("span");
        subSpan.className = "text-sub-body";
        subSpan.style.fontSize = `${Math.max(12, Math.round(st.fontSize * 0.55)) * e}px`;
        subSpan.style.opacity = "0.88";
        subSpan.style.marginTop = `${4 * e}px`;
        subSpan.style.fontWeight = "400";
        subSpan.textContent = clip.subtext;
        el.appendChild(subSpan);
    }

    return el;
}
