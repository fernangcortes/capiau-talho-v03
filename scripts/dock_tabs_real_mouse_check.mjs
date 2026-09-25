// Verificação com mouse real da F5 (abas viram painéis) do plano drag & dock: arrastar abas da
// Biblioteca para fora, juntar numa janela, reacoplar, destacar de novo e reordenar a faixa.
// Chromium com janelas reais em Xvfb, mouse via xdotool; editor sem backend (/api responde vazio).
// Execução (Linux): node scripts/dock_tabs_real_mouse_check.mjs — requer Xvfb, xdotool e Playwright (global).
import { spawn, execSync } from "node:child_process"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { createRequire } from "node:module"; import path from "node:path"; import { fileURLToPath } from "node:url";
const DISPLAY = ":93"; const sleep = ms => new Promise(r => setTimeout(r, ms));
const X = (cmd) => execSync(`xdotool ${cmd}`, { env: { ...process.env, DISPLAY } }).toString().trim();
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], { stdio: "ignore" }); await sleep(900);
const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui"); const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => { const p = new URL(req.url, "http://x").pathname; if (p.startsWith("/api")) { res.writeHead(200, {"Content-Type":"application/json"}).end("[]"); return; } try { res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }).end(await readFile(path.join(uiDir, p === "/" ? "/index.html" : p))); } catch { res.writeHead(404).end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const { chromium } = createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright");
const browser = await chromium.launch({ headless: false, executablePath: "/opt/pw-browsers/chromium", env: { ...process.env, DISPLAY } });
const ctx = await browser.newContext({ viewport: null }); const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push("main: " + e.message)); page.on("dialog", d => { errors.push("diálogo: " + d.message().slice(0, 50)); d.dismiss(); });
ctx.on("page", p => p.on("pageerror", e => errors.push("popup: " + e.message)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.tabPanels, null, { timeout: 20000 }); await sleep(1500);
X(`windowsize $(xdotool search --onlyvisible --name "CapIAu" | head -1) 1300 1000`.replace(/\$\(xdotool search --onlyvisible --name "CapIAu" \| head -1\)/, X('search --onlyvisible --name "CapIAu"').split("\n")[0]));
await sleep(1500); console.log("janela principal:", await page.evaluate(() => [innerWidth, innerHeight]));
async function drag(from, to) {
  X(`mousemove ${from.x} ${from.y}`); await sleep(150); X("mousedown 1"); await sleep(100);
  for (let i = 1; i <= 30; i++) { X(`mousemove ${Math.round(from.x + (to.x - from.x) * i / 30)} ${Math.round(from.y + (to.y - from.y) * i / 30)}`); await sleep(30); }
  await sleep(300); X("mouseup 1"); await sleep(2500);
}
const mainPoint = async (sel) => { X("mousemove 300 300"); await sleep(60); X("mousemove 306 304"); await sleep(120); return page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + r.width / 2 + window.screenX + c.bx), y: Math.round(r.top + r.height / 2 + window.screenY + c.by) }; }, sel); };
const st = () => page.evaluate(() => { const btns = [...document.querySelectorAll("#left-tabs .tab-btn")].map(b => `${b.dataset.tab.slice(4)}${b.style.display === "none" ? "(fora)" : ""}`).join(" "); const w = window.popoutWindows; return `faixa: ${btns} | janelas: ${Object.keys(w).filter(k => w[k] && !w[k].closed).join(",") || "-"} | grupo: ${localStorage.getItem("capiau_group_popout_panels") || "-"} | aviso=${document.querySelector(".dock-undo-toast").hidden ? "-" : document.querySelector(".dock-undo-text").textContent}`; });
// 1. arrastar a aba Rostos para fora do editor
await drag(await mainPoint('#left-tabs .tab-btn[data-tab="tab-faces"]'), { x: 1500, y: 300 });
console.log("Rostos arrastada para fora →", await st())
// 2. arrastar a aba Logs para cima da janela da Busca (borda de baixo)
const g = await page.evaluate(() => { const w = window.popoutWindows["tabpanel-faces"]; return w ? { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight } : null; });
if (g) { await drag(await mainPoint('#left-tabs .tab-btn[data-tab="tab-titles"]'), { x: g.x + g.w - 20, y: g.y + g.h / 2 }); console.log("Títulos sobre a janela dos Rostos →", await st()); }
// devolver e destacar de novo pelo menu (reaproveita o invólucro)
await page.evaluate(() => window.workspaceManager.restoreGroupPopout()); await sleep(1500);
console.log("reacoplar todos →", await st());
await page.evaluate(() => window.tabPanels.tearOff("faces")); await sleep(1500);
console.log("destacar Rostos de novo →", await st(), "| clusters na janela:", await page.evaluate(() => !!window.popoutWindows["tabpanel-faces"]?.document.getElementById("face-clusters-list")));
// 3. reordenar dentro da faixa continua funcionando
const a = await mainPoint('#left-tabs .tab-btn[data-tab="tab-docs"]'); const b2 = await mainPoint('#left-tabs .tab-btn[data-tab="tab-media"]');
await drag(a, { x: b2.x - 20, y: b2.y });
console.log("reordenar Docs na faixa →", await st());
console.log("erros:", errors.length ? errors : "nenhum");
await browser.close(); server.close(); xvfb.kill();
