// Autoteste: títulos montados por UM código só (preview e render do arquivo).
// Execução: node tests/autoteste_titulo_render.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { montarElementoTitulo, estadoTitulo } = await import("../src/ui/js/tituloRender.js");
const { evaluateClipTransform } = await import("../src/ui/js/keyframeEngine.js");

let n = 0;
const ok = (msg) => console.log(`✔ Teste ${++n}: ${msg}`);

// DOM mínimo: o suficiente para montarElementoTitulo
const docFalso = {
    createElement(tag) {
        return { tag, style: {}, dataset: {}, children: [], className: "", textContent: "",
                 appendChild(c) { this.children.push(c); return c; } };
    }
};

const gc = {
    id: "gc", type: "text", text: "Fulana de Tal", subtext: "Diretora", fontFamily: "Cinzel",
    fontSize: 40, tracking: 2, color: "#ffffff", backgroundColor: "rgba(0,0,0,0.75)",
    boxPadding: 10, boxBorderRadius: 6, alignment: "left", posX: -25, posY: 34
};

// 1. Escala: tamanhos em pixels do QUADRO; posição relativa não muda
{
    const e1 = montarElementoTitulo(docFalso, gc, 1, 1);
    const e5 = montarElementoTitulo(docFalso, gc, 1, 0.5);
    assert.equal(e1.style.fontSize, "40px"); assert.equal(e5.style.fontSize, "20px");
    assert.equal(e1.style.letterSpacing, "2px"); assert.equal(e5.style.letterSpacing, "1px");
    assert.equal(e1.style.padding, "10px 14px"); assert.equal(e5.style.padding, "5px 7px");
    assert.equal(e1.style.borderRadius, "6px"); assert.equal(e5.style.borderRadius, "3px");
    assert.equal(e5.style.boxShadow, "0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(255,255,255,0.08)");
    assert.equal(e1.style.left, e5.style.left);
    assert.equal(e1.style.top, e5.style.top);
    assert.equal(e1.style.maxWidth, "90%");
    const sub1 = e1.children[1], sub5 = e5.children[1];
    assert.equal(sub1.style.fontSize, "22px"); assert.equal(sub5.style.fontSize, "11px");
    assert.equal(sub5.style.marginTop, "2px");
    ok("tamanhos escalam com o monitor; posição e largura máxima continuam relativas");
}

// 2. Keyframe com valor 0 é respeitado (antes `|| 1` fazia o fade começar opaco)
{
    const fade = { ...gc, keyframes: { opacity: [
        { time_offset_s: 0, value: 0 }, { time_offset_s: 0.4, value: 1, easing: "linear" },
        { time_offset_s: 4.1, value: 1 }, { time_offset_s: 4.5, value: 0 }] } };
    assert.equal(evaluateClipTransform(fade, 0).opacity, 0);
    assert.equal(evaluateClipTransform(fade, 0.2).opacity, 0.5);
    assert.equal(evaluateClipTransform(fade, 5).opacity, 0, "depois do último keyframe (0) fica 0");
    assert.equal(estadoTitulo(fade, 0).opacity, 0);
    const zoom = { ...gc, keyframes: { scale: [{ time_offset_s: 0, value: 0 }, { time_offset_s: 1, value: 1 }] } };
    assert.equal(evaluateClipTransform(zoom, 0).scale, 0);
    assert.equal(evaluateClipTransform({ ...gc, boxPadding: 0, boxBorderRadius: 0 }, 0).boxPadding, 0);
    assert.equal(evaluateClipTransform({ ...gc }, 0).opacity, 1, "sem keyframe continua 1");
    ok("opacidade 0, escala 0 e padding 0 são respeitados");
}

// 3. Preview e render usam o mesmo módulo
{
    const overlay = readFileSync(new URL("../src/ui/js/playerTextOverlay.js", import.meta.url), "utf8");
    const render = readFileSync(new URL("../src/ui/js/renderTitulos.js", import.meta.url), "utf8");
    assert.ok(/import \{ montarElementoTitulo[^}]*\} from "\.\/tituloRender\.js"/.test(overlay));
    assert.ok(overlay.includes("montarElementoTitulo(this.textLayer.ownerDocument || document, clip, relTimeS, escala)"));
    assert.ok(!/el\.style\.fontSize\s*=/.test(overlay), "o preview voltou a montar o estilo por conta própria");
    assert.ok(overlay.includes('STATE.on("programViewportResized"'), "título precisa redesenhar quando o monitor muda de tamanho");
    assert.ok(render.includes("montarElementoTitulo(document, clip, relTimeS, 1)"));
    const player = readFileSync(new URL("../src/ui/js/player.js", import.meta.url), "utf8");
    assert.ok(player.includes('STATE.emit("programViewportResized"'));
    ok("preview (escala do monitor) e render (escala 1) montam pelo mesmo tituloRender.js");
}

// 4. Peso e estilo do clipe chegam ao título (tela e arquivo); subtexto continua 400
{
    const { pesoTitulo, estiloTitulo } = await import("../src/ui/js/tituloRender.js");
    const negrito = montarElementoTitulo(docFalso, { ...gc, fontWeight: "700", fontStyle: "italic" }, 1, 1);
    assert.equal(negrito.style.fontWeight, "700");
    assert.equal(negrito.style.fontStyle, "italic");
    assert.equal(negrito.children[1].style.fontWeight, "400", "subtexto continua 400");
    const antigo = montarElementoTitulo(docFalso, gc, 1, 1);
    assert.equal(antigo.style.fontWeight, "400", "clipe sem fontWeight fica como antes");
    assert.equal(antigo.style.fontStyle, "normal");
    assert.equal(pesoTitulo({ fontWeight: 900 }), "900");
    assert.equal(pesoTitulo({ fontWeight: "bold" }), "700");
    assert.equal(pesoTitulo({ fontWeight: "950; color:red" }), "400", "valor estranho não vaza para o CSS");
    assert.equal(estiloTitulo({ fontStyle: "oblique" }), "normal");
    ok("fontWeight/fontStyle do clipe aplicados; subtexto 400; valores inválidos caem no padrão");
}

console.log(`\n=== ${n}/${n} TESTES APROVADOS ===`);
