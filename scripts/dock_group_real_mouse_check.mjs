// Verificação com mouse real da F4 (juntar janelas destacadas, até 4 painéis) do plano drag & dock.
// Chromium com janelas reais em Xvfb, mouse via xdotool; editor sem backend (/api responde vazio).
// Execução (Linux): node scripts/dock_group_real_mouse_check.mjs — requer Xvfb, xdotool e Playwright (global).
import { spawn, execSync } from "node:child_process"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { createRequire } from "node:module"; import path from "node:path"; import os from "node:os"; import { fileURLToPath } from "node:url";
const SP = os.tmpdir();
const DISPLAY = ":95"; const sleep = ms => new Promise(r => setTimeout(r, ms));
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
await page.waitForFunction(() => window.workspaceManager && window.dockDrag, null, { timeout: 20000 }); await sleep(2500);
async function drag(from, to) {
  X(`mousemove ${from.x} ${from.y}`); await sleep(120); X("mousedown 1"); await sleep(80); X(`mousemove ${from.x + 12} ${from.y + 10}`); await sleep(60);
  for (let i = 1; i <= 25; i++) { X(`mousemove ${Math.round(from.x + (to.x - from.x) * i / 25)} ${Math.round(from.y + (to.y - from.y) * i / 25)}`); await sleep(25); }
  await sleep(300); X("mouseup 1"); await sleep(3000);
}
const calibMain = async () => { X("mousemove 300 300"); await sleep(60); X("mousemove 306 304"); await sleep(120); };
const mainPoint = async (sel) => { await calibMain(); return page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + r.width / 2 + window.screenX + c.bx), y: Math.round(r.top + r.height / 2 + window.screenY + c.by) }; }, sel); };
const groupPage = () => ctx.pages().find(p => p.url().includes("panel-group.html") || p.url().includes("panel.html"));
async function popupPoint(pop, sel) {
  await pop.waitForLoadState();
  await pop.evaluate(() => document.addEventListener("pointermove", (e) => { window.__cal = { dx: e.screenX - e.clientX, dy: e.screenY - e.clientY }; }));
  const g = await pop.evaluate(() => ({ x: screenX, y: screenY }));
  X(`mousemove ${g.x + 150} ${g.y + 150}`); await sleep(60); X(`mousemove ${g.x + 156} ${g.y + 154}`); await sleep(150);
  return pop.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const c = window.__cal; return { x: Math.round(r.left + r.width / 2 + c.dx), y: Math.round(r.top + r.height / 2 + c.dy) }; }, sel);
}
const win = () => page.evaluate(() => { const w = window.popoutWindows["timeline-panel"]; return { x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight }; });
const state = () => page.evaluate(() => {
  const w = window.popoutWindows; const open = (k) => w[k] && !w[k].closed;
  const slotted = (() => { const g = w["group"]; if (!open("group")) return "-"; try { return [...g.document.querySelectorAll("[data-group-slot]")].map(s => `${s.dataset.groupSlot}:${s.firstElementChild?.id === s.dataset.groupSlot ? "ok" : "vazio"}`).join(","); } catch (e) { return "?"; } })();
  return `grupo=${open("group") ? localStorage.getItem("capiau_group_popout_panels") + " [" + localStorage.getItem("capiau_group_popout_arrangement") + "]" : "não"} | espaços=${slotted} | simples=${Object.keys(w).filter(k => open(k) && k !== "group" && w[k] !== w["group"]).join(",") || "-"} | aviso=${document.querySelector(".dock-undo-toast").hidden ? "-" : document.querySelector(".dock-undo-text").textContent}`; });

await page.evaluate(() => window.workspaceManager.togglePopout("timeline-panel")); await sleep(2000);
await page.evaluate(() => { const w = window.popoutWindows["timeline-panel"]; w.moveTo(1000, 100); w.resizeTo(880, 700); }); await sleep(500);
console.log("preparação  →", await state());
let g = await win();
await drag(await mainPoint('.dock-handle[data-dock-panel="program-player-panel"]'), { x: g.x + g.w / 2, y: g.y + g.h - 30 });
console.log("T1 Program embaixo da Timeline →", await state());
g = await win();
await drag(await mainPoint('.dock-handle[data-dock-panel="inspector-panel"]'), { x: g.x + g.w - 20, y: g.y + g.h / 2 });
console.log("T2 Ajustes à direita →", await state());
g = await win();
await drag(await mainPoint('.dock-handle[data-dock-panel="sidebar-left"]'), { x: g.x + 20, y: g.y + g.h / 2 });
console.log("T3 Biblioteca (4º) →", await state());
let gp = groupPage(); await gp.waitForTimeout(800); await gp.screenshot({ path: `${SP}/f4b-grade.png` });
await gp.click('.group-btn[data-arrangement="main"]'); await sleep(600);
console.log("T4 disposição 'principal + coluna' →", await state());
await gp.screenshot({ path: `${SP}/f4b-principal.png` });
const ph = await popupPoint(gp, '.dock-handle[data-dock-panel="program-player-panel"]');
const mid = await page.evaluate(() => { const r = document.querySelector(".workspace").getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + r.width / 2 + window.screenX + c.bx), y: Math.round(r.top + 60 + window.screenY + c.by) }; });
await drag(ph, mid);
console.log("T5 Program de volta ao editor →", await state());
gp = groupPage(); await gp.click("#btn-group-reattach"); await sleep(2000);
console.log("T6 Reacoplar todos →", await state());
console.log("erros:", errors.length ? errors : "nenhum");
await browser.close(); server.close(); xvfb.kill();
