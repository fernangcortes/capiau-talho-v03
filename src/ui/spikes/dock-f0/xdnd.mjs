// Parte "mouse real" do Spike F0: Chromium com janelas de verdade num X virtual (Xvfb),
// mouse movido pelo sistema (xdotool). Cobre o que o auto.mjs não alcança: soltar fora do
// navegador e arrastar da janela destacada de volta para a principal (roteiro M1–M5).
// Execução (Linux): node src/ui/spikes/dock-f0/xdnd.mjs   — requer Xvfb e xdotool.

import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DISPLAY = ":99";
const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const X = (cmd) => execSync(`xdotool ${cmd}`, { env: { ...process.env, DISPLAY } }).toString().trim();

async function loadPlaywright() {
    try {
        return await import("playwright");
    } catch (err) {
        const globalRoot = execSync("npm root -g").toString().trim();
        return createRequire(path.join(globalRoot, "noop.js"))("playwright");
    }
}

const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], { stdio: "ignore" });
await sleep(1000);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
    const file = path.join(uiDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(uiDir)) { res.writeHead(403).end(); return; }
    try {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(await readFile(file));
    } catch (err) {
        res.writeHead(404).end();
    }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));

const { chromium } = await loadPlaywright();
const opts = {
    headless: false,
    ignoreDefaultArgs: ["--disable-popup-blocking"],
    // Sem --window-position: esse argumento força toda janela nova para 0,0 e ignora left/top.
    env: { ...process.env, DISPLAY }
};
const browser = await chromium.launch({ ...opts, executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch(opts));
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
page.on("pageerror", err => console.log("ERRO NA PÁGINA:", err.message));
await page.goto(`http://127.0.0.1:${server.address().port}/spikes/dock-f0/index.html`);
await page.waitForFunction(() => window.__spike);

const results = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__spike.results)));
const clear = () => page.evaluate(() => { for (const k in window.__spike.results) delete window.__spike.results[k]; });
const rows = [];
const take = async (label, keys) => {
    const r = await results();
    for (const k of keys) rows.push([`${label} · ${k}`, r[k]?.status || "-", r[k]?.detail || "sem registro"]);
};

async function calibrateAt(x, y) {
    X(`mousemove ${x} ${y}`);
    await sleep(80);
    X(`mousemove ${x + 6} ${y + 4}`);
    await sleep(150);
}

async function drag(from, to, holdMs = 0, holdBeforeMs = 0) {
    X(`mousemove ${from.x} ${from.y}`);
    await sleep(120);
    X("mousedown 1");
    await sleep(80);
    if (holdBeforeMs) {
        X(`mousemove ${from.x + 30} ${from.y + 30}`);
        await sleep(holdBeforeMs);
    }
    const steps = 25;
    for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + (to.x - from.x) * i / steps);
        const y = Math.round(from.y + (to.y - from.y) * i / steps);
        X(`mousemove ${x} ${y}`);
        await sleep(25);
    }
    if (holdMs) {
        await sleep(holdMs);
        X(`mousemove ${to.x + 3} ${to.y + 2}`);
        await sleep(40);
    }
    X("mouseup 1");
    await sleep(1500);
}

const point = (panelId, sel) => page.evaluate(([p, s]) => window.__spike.screenPoint(p, s), [panelId, sel]);
const zone = () => page.evaluate(() => window.__spike.zonePoint());
const OUTSIDE = { x: 1400, y: 380 };

async function tearOff(panelId, label, keys, holdMs = 0, holdBeforeMs = 0) {
    await clear();
    await calibrateAt(300, 300);
    const from = await point(panelId, ".handle");
    await drag(from, OUTSIDE, holdMs, holdBeforeMs);
    await take(label, keys);
    return from;
}

async function popupGeometry() {
    const pop = context.pages().find(p => p.url().includes("popup.html"));
    if (!pop) return null;
    return pop.evaluate(() => ({ x: screenX, y: screenY, w: outerWidth, h: outerHeight, iw: innerWidth, ih: innerHeight }));
}

async function dockBackByMouse(panelId, label, key) {
    await clear();
    // calibra a janela destacada (aberta perto de OUTSIDE) e depois pega a zona na principal
    await calibrateAt(OUTSIDE.x + 150, OUTSIDE.y + 200);
    const from = await point(panelId, ".handle");
    await calibrateAt(300, 300);
    const to = await zone();
    if (!from?.inPopup || !to) {
        rows.push([`${label} · ${key}`, "-", `não foi possível localizar (${JSON.stringify(from)} → ${JSON.stringify(to)})`]);
        return;
    }
    await drag(from, to);
    await take(label, [key]);
    const docked = await page.evaluate((p) => document.getElementById(p).ownerDocument === document, panelId);
    rows.push([`${label} · painel de volta na principal`, docked ? "ok" : "fail", docked ? "sim" : "não"]);
}

// M1: Pointer Events, soltando fora do navegador; M5: voltar arrastando da destacada (ponte de coordenadas)
await tearOff("p-pointer", "M1 Pointer solto fora", ["E1.outside", "E1.activation", "E1.tearoff"]);
await dockBackByMouse("p-pointer", "M5 Pointer volta", "E4.pointerBridge");
await page.evaluate(() => window.__spike.dockBack("p-pointer"));

// M3: HTML5 solto fora; M4: voltar com arrasto HTML5 entre janelas
await tearOff("p-html5", "M3 HTML5 solto fora", ["E2.activation", "E2.outsideDetect", "E2.tearoff"]);
await dockBackByMouse("p-html5", "M4 HTML5 volta", "E3.crossDrop");
await page.evaluate(() => window.__spike.dockBack("p-html5"));

// M2: segurar 7 s antes de soltar fora
await tearOff("p-pointer", "M2 Pointer segurando 7 s", ["E1.activation", "E1.tearoff"], 7000);
await page.evaluate(() => window.__spike.dockBack("p-pointer"));
await tearOff("p-html5", "M3 HTML5 segurando 7 s", ["E2.activation", "E2.tearoff"], 7000);
await page.evaluate(() => window.__spike.dockBack("p-html5"));

// M6/M7: janela nasce ao cruzar a borda e segue o cursor (E10)
await page.check("#live-tearoff");
await tearOff("p-pointer", "M6 cruza rápido, segura 7 s fora", ["E10.open", "E10.attach", "E10.follow"], 7000);
await page.evaluate(() => window.__spike.dockBack("p-pointer"));
await tearOff("p-pointer", "M7 segura 6 s dentro, depois cruza", ["E10.open", "E1.tearoff"], 0, 6000);
await page.evaluate(() => window.__spike.dockBack("p-pointer"));
await page.uncheck("#live-tearoff");

console.log(`\n=== RESULTADOS (Chromium ${browser.version()} com janelas reais em Xvfb, mouse via xdotool) ===`);
for (const [k, st, d] of rows) console.log(`${k.padEnd(44)} ${st.padEnd(5)} ${d}`);

await browser.close();
server.close();
xvfb.kill();
