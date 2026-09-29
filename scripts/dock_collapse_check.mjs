// Diagnóstico: botões de recolher (Ajustes & Efeitos, Transcrição & Falas) e Numpad 5/6 em vários
// layouts (workspaces prontos, painel empilhado, posições da Timeline, abas movidas de menu).
// Editor sem backend (/api responde vazio), Chromium headless. Saída: por layout, se o botão está
// clicável ("acerta") e se o painel recolheu (collapsed/largura).
// Execução: node scripts/dock_collapse_check.mjs — requer Playwright (global) e /opt/pw-browsers/chromium.
import { createServer } from "node:http"; import { readFile } from "node:fs/promises"; import { createRequire } from "node:module"; import { execSync } from "node:child_process"; import path from "node:path"; import { fileURLToPath } from "node:url";
const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui"); const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => { const p = new URL(req.url, "http://x").pathname; if (p.startsWith("/api")) { res.writeHead(200, {"Content-Type":"application/json"}).end("[]"); return; } try { res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }).end(await readFile(path.join(uiDir, p === "/" ? "/index.html" : p))); } catch { res.writeHead(404).end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const { chromium } = createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = []; page.on("pageerror", e => { if (!/no supported sources/.test(e.message)) errors.push(e.message); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`); await page.waitForFunction(() => window.tabPanels); await page.waitForTimeout(2500);
const st = () => page.evaluate(() => ["inspector-panel", "sidebar-right"].map(id => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return `${id}: collapsed=${el.classList.contains("collapsed")} w=${Math.round(r.width)} parent=${el.parentElement?.className?.slice(0,30)}`; }).join(" | ") + ` | reopen-insp=${document.getElementById("reopen-inspector").style.display} reopen-right=${document.getElementById("reopen-right").style.display}`);
const reset = () => page.evaluate(() => { for (const id of ["inspector-panel","sidebar-right"]) { const el = document.getElementById(id); if (el.classList.contains("collapsed")) document.getElementById(id === "sidebar-right" ? "reopen-right" : "reopen-inspector").click(); } });
const probe = async (label) => {
  await reset(); await page.waitForTimeout(300);
  const out = [];
  for (const [btn, id] of [["toggle-inspector", "inspector-panel"], ["toggle-right", "sidebar-right"]]) {
    const info = await page.evaluate((btn) => { const b = document.getElementById(btn); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { vis: r.width > 0 && r.height > 0, hit: top === b || b.contains(top), topId: top?.id || top?.className?.toString().slice(0, 30), x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, btn);
    let res = "invisivel";
    if (info.vis) { await page.mouse.click(info.x, info.y); await page.waitForTimeout(400); res = await page.evaluate((id) => { const el = document.getElementById(id); return el.classList.contains("collapsed") + "/w=" + Math.round(el.getBoundingClientRect().width); }, id); }
    out.push(btn + ": acerta=" + info.hit + (info.hit ? "" : "(" + info.topId + ")") + " -> " + res);
  }
  await reset(); await page.waitForTimeout(300);
  for (const [code, id] of [["Numpad5", "inspector-panel"], ["Numpad6", "sidebar-right"]]) {
    await page.mouse.click(800, 500); await page.keyboard.press(code); await page.waitForTimeout(400);
    out.push(code + " -> " + await page.evaluate((id) => { const el = document.getElementById(id); return el.classList.contains("collapsed") + "/w=" + Math.round(el.getBoundingClientRect().width); }, id));
  }
  console.log(label.padEnd(26), out.join(" | "));
};
await probe("padrao");
for (const ws of ["inspector-right", "decupagem", "montagem", "default"]) { await page.evaluate((ws) => window.workspaceManager.applyWorkspace(ws), ws); await page.waitForTimeout(800); await probe("ws " + ws); }
await page.evaluate(() => window.workspaceManager.setColumnLayout(["sidebar-left","inspector-panel","center-stage","sidebar-right"], [["sidebar-left","inspector-panel"]])); await page.waitForTimeout(800); await probe("Ajustes empilhado na Bibl.");
await page.evaluate(() => window.workspaceManager.setColumnLayout(["sidebar-left","center-stage","sidebar-right","inspector-panel"], [["sidebar-right","inspector-panel"]])); await page.waitForTimeout(800); await probe("Ajustes empilhado no Lat.");
await page.evaluate(() => window.workspaceManager.setColumnLayout(["sidebar-left","inspector-panel","center-stage","sidebar-right"], [])); await page.waitForTimeout(800);
for (const pos of ["bottom-full", "bottom-left", "bottom-right"]) { await page.evaluate((p) => window.workspaceManager.setTimelinePosition(p), pos); await page.waitForTimeout(800); await probe("timeline " + pos); }
await page.evaluate(() => window.workspaceManager.setTimelinePosition("center")); await page.waitForTimeout(600);
await page.evaluate(() => ["transcript","vision","chat","search","tasks","logs"].forEach(t => window.tabPanels.moveToStrip(t, "left"))); await page.waitForTimeout(800); await probe("todas abas dir. na Bibl.");
console.log("erros:", errors);
await browser.close(); server.close();
