// Verificação com mouse real da P14 do plano drag & dock: arrastar abas de um menu para o outro
// (Temas para o Painel Lateral, Falas para a Biblioteca), trocar de aba, desfazer/refazer, destacar
// a convidada numa janela e reacoplar, e recarregar a página.
// Chromium com janelas reais em Xvfb, mouse via xdotool; editor sem backend (/api responde vazio).
// Execução (Linux): node scripts/dock_strips_real_mouse_check.mjs — requer Xvfb, xdotool e Playwright (global).
import { spawn, execSync } from "node:child_process"; import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { createRequire } from "node:module"; import path from "node:path"; import { fileURLToPath } from "node:url";
const DISPLAY = ":94"; const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  // mão humana: pequenos tremores no alvo antes de soltar (o Chromium no X só atualiza o alvo com movimento)
  for (const d of [3, -3, 2, 0]) { X(`mousemove ${to.x + d} ${to.y}`); await sleep(120); }
  await sleep(300); X("mouseup 1"); await sleep(2500);
}
const mainPoint = async (sel) => { X("mousemove 300 300"); await sleep(60); X("mousemove 306 304"); await sleep(120); return page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); const c = window.dockDrag.calib; return { x: Math.round(r.left + r.width / 2 + window.screenX + c.bx), y: Math.round(r.top + r.height / 2 + window.screenY + c.by) }; }, sel); };
const st = () => page.evaluate(() => {
  const strip = (id) => [...document.querySelectorAll(`#${id} .tab-btn`)].filter(b => b.style.display !== "none").map(b => {
    const name = b.dataset.guestTab ? `+${b.dataset.guestTab}` : (b.dataset.tab ? b.dataset.tab.slice(4) : b.dataset.rightTab);
    return (b.classList.contains("active") || b.classList.contains("dock-guest-active")) ? `[${name}]` : name;
  }).join(" ");
  const vis = (sel) => { const el = document.querySelector(sel); if (!el) return "-"; const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 20 ? `${Math.round(r.width)}x${Math.round(r.height)}` : "oculto"; };
  const w = window.popoutWindows;
  return `esq: ${strip("left-tabs")} | dir: ${strip("right-tabs")} | temas ${vis("#tab-themes")} falas ${vis("#transcript-container")} midia ${vis("#tab-media")} | janelas: ${Object.keys(w).filter(k => w[k] && !w[k].closed).join(",") || "-"} | menus: ${JSON.stringify(window.tabPanels.getStrips())}`;
});
const bodyPoint = async (sel, dy = 0) => { const p = await mainPoint(sel); return { x: p.x, y: p.y + dy }; };
console.log("início →", await st());

// 1. Temas (Biblioteca) para a faixa do Painel Lateral, entre Falas e Visão
await drag(await mainPoint('#left-tabs .tab-btn[data-tab="tab-themes"]'), await mainPoint('#right-tabs .tab-btn[data-right-tab="vision"]'));
console.log("1 Temas → Painel Lateral →", await st());
// 2. Falas (Painel Lateral) para o corpo da Biblioteca
await drag(await mainPoint('#right-tabs .tab-btn[data-right-tab="transcript"]'), await bodyPoint("#sidebar-left .sidebar-content", 0));
console.log("2 Falas → Biblioteca →", await st());
// 3. trocar para Mídias e voltar para Falas por clique
X(`mousemove ${(await mainPoint('#left-tabs .tab-btn[data-tab="tab-media"]')).x} ${(await mainPoint('#left-tabs .tab-btn[data-tab="tab-media"]')).y}`); X("click 1"); await sleep(600);
console.log("3a clique Mídias →", await st());
const gp = await mainPoint('#left-tabs .tab-btn[data-guest-tab="transcript"]'); X(`mousemove ${gp.x} ${gp.y}`); X("click 1"); await sleep(600);
console.log("3b clique Falas (convidada) →", await st());
// 4. desfazer duas vezes, refazer uma
X("mousemove 650 500"); await sleep(200);
X("key ctrl+alt+z"); await sleep(900); console.log("4a Ctrl+Alt+Z →", await st());
X("key ctrl+alt+z"); await sleep(900); console.log("4b Ctrl+Alt+Z →", await st());
X("key ctrl+alt+shift+z"); await sleep(900); console.log("4c Ctrl+Alt+Shift+Z →", await st());
// 5. destacar a convidada Temas (arrastar para fora) e reacoplar
await drag(await mainPoint('#right-tabs .tab-btn[data-guest-tab="themes"]'), { x: 1600, y: 300 });
console.log("5a Temas (convidada) para fora →", await st());
await page.evaluate(() => window.workspaceManager.togglePopout("tabpanel-themes")); await sleep(1500);
console.log("5b reacoplar Temas →", await st());
// 6. recarregar: menus ficam
await page.reload(); await page.waitForFunction(() => window.tabPanels, null, { timeout: 20000 }); await sleep(2500);
console.log("6 recarregar →", await st());
// 7. Temas de volta à Biblioteca pelo menu da faixa (botão direito → "Mover Temas para a Biblioteca")
const tp = await mainPoint('#right-tabs .tab-btn[data-guest-tab="themes"]'); X(`mousemove ${tp.x} ${tp.y}`); X("click 3"); await sleep(500);
const item = await page.evaluate(() => [...document.querySelectorAll("#custom-tabs-context-menu .menu-item")].map(i => i.textContent).slice(0, 2).join(" / "));
console.log("7a menu da faixa:", item);
await page.evaluate(() => [...document.querySelectorAll("#custom-tabs-context-menu .menu-item")].find(i => i.textContent.startsWith("Mover"))?.click()); await sleep(800);
console.log("7b Temas volta à Biblioteca →", await st());
console.log("erros:", errors.length ? errors : "nenhum");
await browser.close(); server.close(); xvfb.kill();
