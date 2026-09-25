// Verificação com mouse real da F3 (destacar arrastando e reacoplar) do plano de janelas drag & dock.
// Abre o editor (sem backend: /api responde vazio) num Chromium com janelas reais em Xvfb e move o
// mouse pelo sistema com xdotool. Execução (Linux): node scripts/dock_real_mouse_check.mjs
// Requer Xvfb, xdotool e Playwright (global). Capturas vão para o diretório temporário do sistema.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const SP = os.tmpdir();
const DISPLAY = ":97"; const sleep = ms => new Promise(r => setTimeout(r, ms));
const X = (cmd) => execSync(`xdotool ${cmd}`, { env: { ...process.env, DISPLAY } }).toString().trim();
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], { stdio: "ignore" }); await sleep(900);
const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui"); const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => { const p = new URL(req.url, "http://x").pathname; if (p.startsWith("/api")) { res.writeHead(200, {"Content-Type":"application/json"}).end("[]"); return; } try { res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }).end(await readFile(path.join(uiDir, p === "/" ? "/index.html" : p))); } catch { res.writeHead(404).end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const { chromium } = createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright");
const browser = await chromium.launch({ headless: false, executablePath: "/opt/pw-browsers/chromium", ignoreDefaultArgs: ["--disable-popup-blocking"], env: { ...process.env, DISPLAY } });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push("main: " + e.message)); page.on("dialog", d => d.dismiss());
ctx.on("page", p => p.on("pageerror", e => errors.push("popup: " + e.message)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
await page.waitForFunction(() => window.workspaceManager && window.dockDrag, null, { timeout: 20000 }); await sleep(2500);
const win = await page.evaluate(() => [screenX, screenY, outerWidth, outerHeight]); console.log("janela principal:", win);

async function drag(from, to, { holdBefore = 0, holdAfter = 0, back = null } = {}) {
  X(`mousemove ${from.x} ${from.y}`); await sleep(120); X("mousedown 1"); await sleep(80);
  X(`mousemove ${from.x + 12} ${from.y + 10}`); await sleep(60);
  if (holdBefore) await sleep(holdBefore);
  const steps = 25;
  for (let i = 1; i <= steps; i++) { X(`mousemove ${Math.round(from.x + (to.x - from.x) * i / steps)} ${Math.round(from.y + (to.y - from.y) * i / steps)}`); await sleep(25); }
  if (back) { for (let i = 1; i <= 10; i++) { X(`mousemove ${Math.round(to.x + (back.x - to.x) * i / 10)} ${Math.round(to.y + (back.y - to.y) * i / 10)}`); await sleep(25); } }
  if (holdAfter) { await sleep(holdAfter); const last = back || to; X(`mousemove ${last.x + 3} ${last.y + 2}`); await sleep(40); }
  X("mouseup 1"); await sleep(1800);
}
// ponto de tela de um elemento na página principal (usando a calibração do controlador)
const mainPoint = async (sel) => { X("mousemove 300 300"); await sleep(60); X("mousemove 306 304"); await sleep(120);
  return page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + r.width / 2 + window.screenX + c.bx), y: Math.round(r.top + r.height / 2 + window.screenY + c.by) }; }, sel); };
const state = () => page.evaluate(() => { const w = window.workspaceManager; const pw = window.popoutWindows["inspector-panel"]; const el = w.poppedElements["inspector-panel"] || document.getElementById("inspector-panel");
  return `ordem=${w.columnOrder.join(",")} | Ajustes em ${el && el.ownerDocument === document ? "principal" : "janela destacada"} | janela=${pw && !pw.closed ? `aberta em (${pw.screenX},${pw.screenY})` : "fechada"} | aviso=${document.querySelector(".dock-undo-toast").hidden ? "-" : document.querySelector(".dock-undo-text").textContent}`; });

// T1: arrancar Ajustes para fora e segurar 6 s do lado de fora
let h = await mainPoint('.dock-handle[data-dock-panel="inspector-panel"]');
await drag(h, { x: 1500, y: 420 }, { holdAfter: 6000 });
console.log("T1 destacar (segura 6 s fora) →", await state());
const pop = ctx.pages().find(p => p.url().includes("panel.html"));
if (pop) await pop.screenshot({ path: `${SP}/f3-popup.png` });

// T2: voltar arrastando a alça da janela destacada até a borda esquerda do editor
if (pop) {
  await pop.evaluate(() => document.addEventListener("pointermove", (e) => { window.__cal = { dx: e.screenX - e.clientX, dy: e.screenY - e.clientY }; }));
  const pw = await page.evaluate(() => { const p = window.popoutWindows["inspector-panel"]; return { x: p.screenX, y: p.screenY }; });
  X(`mousemove ${pw.x + 200} ${pw.y + 200}`); await sleep(60); X(`mousemove ${pw.x + 206} ${pw.y + 204}`); await sleep(150);
  const ph = await pop.evaluate(() => { const r = document.querySelector('.dock-handle[data-dock-panel="inspector-panel"]')?.getBoundingClientRect(); const c = window.__cal; return r && c ? { x: Math.round(r.left + r.width / 2 + c.dx), y: Math.round(r.top + r.height / 2 + c.dy), visible: r.width > 0 } : null; });
  console.log("alça na janela destacada:", JSON.stringify(ph));
  const ws = await page.evaluate(() => { const r = document.querySelector(".workspace").getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + 10 + window.screenX + c.bx), y: Math.round(r.top + r.height / 2 + window.screenY + c.by) }; });
  if (ph) { await drag(ph, ws); console.log("T2 voltar para a ponta esquerda →", await state()); }
}
// T3: arrancar e voltar para dentro antes de soltar (cancela)
h = await mainPoint('.dock-handle[data-dock-panel="inspector-panel"]');
await drag(h, { x: 1500, y: 420 }, { back: { x: h.x + 200, y: h.y + 300 } });
console.log("T3 sai e volta antes de soltar →", await state());
// T4: plano B — segura 6 s dentro antes de sair
h = await mainPoint('.dock-handle[data-dock-panel="inspector-panel"]');
await drag(h, { x: 1500, y: 420 }, { holdBefore: 6000 });
console.log("T4 segura 6 s dentro e sai →", await state());
await page.screenshot({ path: `${SP}/f3-planoB.png` });
const btn = await page.$(".dock-undo-btn");
if (btn && !(await page.evaluate(() => document.querySelector(".dock-undo-toast").hidden))) { await btn.click(); await sleep(2000); console.log("T4 clique em 'Abrir em janela' →", await state()); }
console.log("erros:", errors.length ? errors : "nenhum");
await browser.close(); server.close(); xvfb.kill();
