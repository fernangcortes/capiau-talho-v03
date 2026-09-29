// Parte automática do Spike F0 (Chromium via Playwright, bloqueador de popups LIGADO).
// Execução: node src/ui/spikes/dock-f0/auto.mjs
// Não cobre o que exige o sistema operacional de verdade (arrastar entre janelas, soltar
// fora do navegador, vários monitores): isso fica no roteiro manual do README.md.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function loadPlaywright() {
    try {
        return await import("playwright");
    } catch (err) {
        const globalRoot = execSync("npm root -g").toString().trim();
        return createRequire(path.join(globalRoot, "noop.js"))("playwright");
    }
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
    const file = path.join(uiDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(uiDir)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
    } catch (err) {
        res.writeHead(404).end();
    }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/spikes/dock-f0/index.html`;

const { chromium } = await loadPlaywright();
const launchOpts = { ignoreDefaultArgs: ["--disable-popup-blocking"] };
const browser = await chromium.launch({ ...launchOpts, executablePath: "/opt/pw-browsers/chromium" })
    .catch(() => chromium.launch(launchOpts));
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", err => console.log("ERRO NA PÁGINA:", err.message));

const results = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__spike.results)));
const center = async (selector) => {
    const box = await page.locator(selector).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const dock = (id) => page.evaluate((pid) => window.__spike.dockBack(pid), id);

await page.goto(url);
await page.waitForFunction(() => window.__spike);

const rows = [];
const take = async (label, keys) => {
    const r = await results();
    for (const k of keys) if (r[k]) rows.push([`${label} · ${k}`, r[k].status, r[k].detail]);
};
const clear = () => page.evaluate(() => { for (const k in window.__spike.results) delete window.__spike.results[k]; });

// E1a: Pointer Events, soltando fora da área visível (sem forçar)
let h = await center("#p-pointer .handle");
await page.mouse.move(h.x, h.y);
await page.mouse.down();
await page.mouse.move(h.x + 200, h.y + 40, { steps: 5 });
await page.mouse.move(-40, h.y + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(1200);
await take("E1 soltando fora", ["E1.outside", "E1.activation", "E1.tearoff"]);
await dock("p-pointer");

// E1/E2 com o botão segurado por mais tempo: o gesto do mouse expira?
await page.check("#force-out");
for (const hold of [500, 2000, 4000, 6000]) {
    for (const [id, keys] of [["p-pointer", ["E1.activation", "E1.tearoff"]], ["p-html5", ["E2.activation", "E2.tearoff"]]]) {
        await clear();
        h = await center(`#${id} .handle`);
        await page.mouse.move(h.x, h.y);
        await page.mouse.down();
        await page.mouse.move(h.x + 20, h.y + 20, { steps: 3 });
        await page.mouse.move(640, 860, { steps: 6 });
        await page.waitForTimeout(hold);
        await page.mouse.move(650, 862, { steps: 2 });
        await page.mouse.up();
        await page.waitForTimeout(1200);
        await take(`segurando ${hold} ms`, keys);
        await dock(id);
    }
}
await page.uncheck("#force-out");

// E5: ida e volta de vídeo/canvas, com vídeo por stream e por arquivo, sem e com restauração
const roundTrip = async () => {
    await clear();
    await page.click("#btn-media-roundtrip");
    await page.waitForFunction(() => window.__spike.results["E5.resizeObserver"] || window.__spike.results["E5.open"]?.status === "fail", null, { timeout: 15000 });
    const r = await results();
    for (const k of Object.keys(r).filter(k => k.startsWith("E5."))) rows.push([k, r[k].status, r[k].detail]);
};
await roundTrip();
await page.check("#restore-media");
await roundTrip();
await page.uncheck("#restore-media");
await page.evaluate(() => window.__spike.makeFileVideo());
await roundTrip();
await page.check("#restore-media");
await roundTrip();
await page.uncheck("#restore-media");

// E8: validade do gesto, um por vez (window.open consome o gesto)
for (const d of [1000, 3000, 4500, 6000]) {
    await clear();
    await page.evaluate((delay) => {
        const b = document.querySelector(`button[data-delay="${delay}"]`) || Object.assign(document.createElement("button"), { textContent: "x" });
        if (!b.dataset.delay) { b.dataset.delay = String(delay); document.body.appendChild(b); }
    }, d);
    if (d === 4500) {
        // botão extra criado só para a medição automática; precisa do listener
        await page.evaluate(() => {
            const b = document.querySelector('button[data-delay="4500"]');
            b.addEventListener("click", () => setTimeout(() => {
                const act = navigator.userActivation?.isActive;
                const w = window.open("popup.html?panel=none", "spike_delay_4500", "popup=yes,width=320,height=200");
                window.__spike.results["E8.delay4500"] = { status: w ? "ok" : "fail", detail: `userActivation.isActive=${act}; ${w ? "abriu" : "bloqueado"}` };
                if (w) setTimeout(() => w.close(), 500);
            }, 4500));
        });
    }
    await page.click(`button[data-delay="${d}"]`);
    await page.waitForTimeout(d + 900);
    await take("sequencial", [`E8.delay${d}`]);
}

// E9: várias janelas num clique
await clear();
await page.click("#btn-open-three");
await page.waitForTimeout(600);
await take("um clique", ["E9.threeInOneClick"]);

// E6: disponibilidade das APIs
await clear();
await page.click("#btn-screens").catch(() => {});
await page.click("#btn-pip").catch(() => {});
await page.waitForTimeout(800);
await take("APIs", ["E6.screens", "E6.pip"]);

// E7: abrir janela sozinho ao carregar
await page.check("#auto-open");
await page.reload();
await page.waitForFunction(() => window.__spike);
await page.waitForTimeout(600);
await take("recarregar", ["E7.autoOpen"]);
await page.uncheck("#auto-open");

console.log("\n=== RESULTADOS (Chromium headless, bloqueador de popups ligado) ===");
console.log(browser.version());
for (const [k, st, d] of rows) console.log(`${k.padEnd(38)} ${st.padEnd(5)} ${d}`);

await browser.close();
server.close();
