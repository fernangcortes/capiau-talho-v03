import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Polyfills mínimos para executar chat.js e timelineInteraction.js no Node
globalThis.window = globalThis;
globalThis.location = { origin: "http://127.0.0.1:8000" };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
const _storage = new Map();
globalThis.localStorage = {
    getItem: (k) => (_storage.has(k) ? _storage.get(k) : null),
    setItem: (k, v) => _storage.set(k, String(v)),
    removeItem: (k) => _storage.delete(k),
    clear: () => _storage.clear(),
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

function makeFakeElement(tag = "div") {
    const el = {
        tagName: tag.toUpperCase(),
        id: "",
        className: "",
        style: {},
        dataset: {},
        children: [],
        _innerHTML: "",
        _textContent: "",
        classList: {
            _set: new Set(),
            add(...cls) { cls.forEach((c) => this._set.add(c)); },
            remove(...cls) { cls.forEach((c) => this._set.delete(c)); },
            toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); },
            contains(c) { return this._set.has(c); },
        },
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        replaceWith() {},
        cloneNode() { return makeFakeElement(tag); },
        remove() {},
        contains: () => false,
        querySelector(sel) {
            if (sel === ".btn-play-card" || sel === ".btn-insert-card" || sel === ".btn-locate-card") {
                return makeFakeElement("button");
            }
            if (sel === "#btn-popup-accept" || sel === "#btn-popup-reject" || sel === ".btn-close-alts") {
                return makeFakeElement("button");
            }
            return null;
        },
        querySelectorAll: () => [],
        getContext: () => null,
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = String(v); },
        get textContent() { return this._textContent; },
        set textContent(v) { this._textContent = String(v); },
    };
    return el;
}

const _byId = new Map();
const fakeBody = makeFakeElement("body");
const fakeDoc = {
    defaultView: globalThis,
    body: fakeBody,
    getElementById: (id) => _byId.get(id) || null,
    querySelector: (sel) => (sel.startsWith("#") ? _byId.get(sel.slice(1)) || null : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeFakeElement(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
};
globalThis.document = fakeDoc;

const { STATE } = await import("../src/ui/js/state.js");
const { ChatManager, escapeHtml } = await import("../src/ui/js/chat.js");
const { CapiauTimelineInteraction } = await import("../src/ui/js/timelineInteraction.js");

console.log("=== AUTOTESTE SEC-03: SANITIZAÇÃO XSS (CHAT E TIMELINE INTERACTION) ===\n");

// 1. escapeHtml básico e idempotência
console.log("1. Testando escapeHtml...");
const rawPayload = `<script>alert("xss")</script> & <img src=x onerror='alert(1)'>`;
const escaped = escapeHtml(rawPayload);
assert.ok(!escaped.includes("<script>"));
assert.ok(!escaped.includes("<img"));
assert.ok(escaped.includes("&lt;script&gt;"));
assert.ok(escaped.includes("&quot;xss&quot;"));
assert.ok(escaped.includes("&#39;alert(1)&#39;"));
assert.equal(escapeHtml(escaped), escaped, "escapeHtml deve ser idempotente");
console.log("   ✔ escapeHtml neutraliza tags/aspas e é idempotente.");

// 2. ChatManager.formatMarkdownLinks e renderMarkdown
console.log("2. Testando formatMarkdownLinks + renderMarkdown no ChatManager...");
const chat = Object.create(ChatManager.prototype);

const xssMsg = `Veja **importante** *nota* <script>alert(1)</script> e <img src=x onerror=alert(2)> em [Take <img src=x onerror=alert(3)>](video_id: 2, start: 10.5, end: 20.0)`;
const withLinks = chat.formatMarkdownLinks(escapeHtml(xssMsg));
const rendered = chat.renderMarkdown(withLinks);

assert.ok(!rendered.includes("<script>"), "Tag <script> não pode passar para innerHTML");
assert.ok(!rendered.includes("<img"), "Tag <img onerror> não pode passar para innerHTML");
assert.ok(rendered.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
assert.ok(rendered.includes("<strong>importante</strong>"), "Markdown **negrito** deve continuar funcionando");
assert.ok(rendered.includes("<em>nota</em>"), "Markdown *itálico* deve continuar funcionando");
assert.ok(
    rendered.includes('<a href="#" class="chat-media-link" data-type="video" data-id="2" data-start="10.5" data-end="20.0"><i class="fa-solid fa-video"></i> Take &lt;img src=x onerror=alert(3)&gt;</a>'),
    "Link de mídia deve ser preservado com texto escapado"
);

// Chamada direta a renderMarkdown(raw) também deve neutralizar XSS e eventos forjados em <a>
const directXss = chat.renderMarkdown('<a href="#" class="chat-media-link" onclick="alert(9)">evil</a> <svg onload=alert(1)> **seguro**');
assert.ok(!directXss.includes("<svg"));
assert.ok(!directXss.includes('onclick="alert(9)"'));
assert.ok(directXss.includes("&lt;svg onload=alert(1)&gt;"));
assert.ok(directXss.includes("<strong>seguro</strong>"));
console.log("   ✔ formatMarkdownLinks e renderMarkdown preservam recursos e bloqueiam XSS.");

// 3. ChatManager.renderHistory e createMediaCardDOM
console.log("3. Testando renderHistory e createMediaCardDOM com payloads XSS...");
const msgContainer = makeFakeElement("div");
const gridContainer = makeFakeElement("div");
_byId.set("chat-messages", msgContainer);
_byId.set("chat-media-grid", gridContainer);

chat.scrollToBottom = () => {};
chat.renderHistory([
    {
        role: "assistant",
        indexWarning: `<img src=x onerror=alert("warn")>`,
        content: `Resumo [Entrevista <script>evil()</script>](video_id: 5, start: 1.0, end: 4.0)\n<iframe src="javascript:alert(1)"></iframe>`,
    },
]);

const bubble = msgContainer.children[0];
assert.ok(bubble, "Bolha do chat deve ser criada");
const warnHtml = bubble.children[1].innerHTML;
const textHtml = bubble.children[2].innerHTML;
assert.ok(!warnHtml.includes("<img"), "indexWarning não pode injetar tag <img>");
assert.ok(warnHtml.includes("&lt;img src=x onerror=alert(&quot;warn&quot;)&gt;"));
assert.ok(!textHtml.includes("<script>"), "Conteúdo do chat não pode injetar <script>");
assert.ok(!textHtml.includes("<iframe"), "Conteúdo do chat não pode injetar <iframe>");

const card = gridContainer.children[0];
assert.ok(card, "Card de mídia referenciada deve ser criado");
assert.ok(!card.innerHTML.includes("<script>"), "card-quote não pode injetar <script>");
assert.ok(card.innerHTML.includes("&lt;script&gt;evil()&lt;/script&gt;"));
console.log("   ✔ renderHistory e createMediaCardDOM escapam conteúdo malicioso.");

// 4. CapiauTimelineInteraction.showGhostActionsPopup & showAlternativesPopup
console.log("4. Testando showGhostActionsPopup e showAlternativesPopup em timelineInteraction.js...");
const ghostPopup = makeFakeElement("div");
ghostPopup.id = "ghost-action-popup";
_byId.set("ghost-action-popup", ghostPopup);

const altsBackdrop = makeFakeElement("div");
altsBackdrop.id = "timeline-alternatives-backdrop";
_byId.set("timeline-alternatives-backdrop", altsBackdrop);

const altsPopup = makeFakeElement("div");
altsPopup.id = "timeline-alternatives-popup";
_byId.set("timeline-alternatives-popup", altsPopup);

const interaction = Object.create(CapiauTimelineInteraction.prototype);
interaction.canvas = { ownerDocument: fakeDoc, id: "timeline-canvas" };
interaction._placeFixedPopup = () => {};

interaction.showGhostActionsPopup(100, 100, {
    id: "ghost_1",
    reason: `<img src=x onerror=alert('ghost')> Corte sugerido`,
});
assert.ok(!ghostPopup.innerHTML.includes("<img"), "showGhostActionsPopup não pode injetar <img>");
assert.ok(ghostPopup.innerHTML.includes("&lt;img src=x onerror=alert(&#39;ghost&#39;)&gt; Corte sugerido"));

STATE.allVideos = [
    {
        id: 77,
        filename: 'video" onerror="alert(1).mp4',
        proxy_path: null,
        filepath: null,
    },
];
interaction.showAlternativesPopup({
    id: "clip_1",
    video_id: 1,
    alternatives: [
        {
            video_id: 77,
            in_s: 1.0,
            out_s: 5.0,
            ideal_duration_s: 4.0,
            reason: `<script>alert('alt')</script> Melhor ângulo`,
        },
    ],
});
assert.ok(!altsPopup.innerHTML.includes("<script>"), "showAlternativesPopup não pode injetar <script>");
assert.ok(!altsPopup.innerHTML.includes('onerror="alert(1)'), "Atributo src não pode quebrar aspas");
assert.ok(altsPopup.innerHTML.includes("&lt;script&gt;alert(&#39;alt&#39;)&lt;/script&gt; Melhor ângulo"));
assert.ok(altsPopup.innerHTML.includes("&quot; onerror=&quot;alert(1).mp4"));
console.log("   ✔ Popups de IA da timeline escapam reason e targetSrc.");

// 5. Garantir que timelineInteraction.js continua importável sem window.escapeHtml prévio
const srcInteraction = fs.readFileSync(path.join(ROOT, "src/ui/js/timelineInteraction.js"), "utf8");
assert.ok(srcInteraction.includes("function escapeHtml("), "timelineInteraction.js deve definir escapeHtml");

console.log("\n✅ AUTOTESTE SEC-03 PASSOU COM SUCESSO!");
