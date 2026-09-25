// Spike F0 do plano docs/PLANO_JANELAS_DRAG_DOCK.md.
// Responde, por navegador: (1) dá para abrir a janela ao soltar um arrasto fora do editor?
// (2) dá para arrastar da janela destacada de volta para a principal? (3) vídeo, canvas,
// listeners e ResizeObserver sobrevivem a ida e volta via adoptNode?
// Código descartável: não é importado pelo editor.

const MIME = "application/x-talho-panel";
const LABELS = {
    "E1.activation": "E1 · gesto ainda válido no pointerup",
    "E1.outside": "E1 · pointerup recebido fora da janela",
    "E1.tearoff": "E1 · abrir janela ao soltar (Pointer)",
    "E2.activation": "E2 · gesto ainda válido no dragend",
    "E2.outsideDetect": "E2 · detectar soltura fora da página",
    "E2.tearoff": "E2 · abrir janela ao soltar (HTML5)",
    "E3.crossDrop": "E3 · arrasto HTML5 da destacada para a principal",
    "E4.pointerBridge": "E4 · ponteiro da destacada mapeado na principal",
    "E5.open": "E5 · abrir janela pelo botão",
    "E5.video[stream]": "E5 · vídeo (stream) continua tocando",
    "E5.video[stream+restaura]": "E5 · vídeo (stream) com restauração",
    "E5.video[arquivo]": "E5 · vídeo (arquivo) continua tocando",
    "E5.video[arquivo+restaura]": "E5 · vídeo (arquivo) com restauração",
    "E5.canvas": "E5 · canvas mantém o desenho",
    "E5.listeners": "E5 · listeners continuam ativos",
    "E5.resizeObserver": "E5 · ResizeObserver da principal vê a destacada",
    "E6.screens": "E6 · Window Management API",
    "E6.lastScreen": "E6 · abrir janela no último monitor",
    "E6.pip": "E6 · Document Picture-in-Picture",
    "E7.autoOpen": "E7 · reabrir janela sem clique ao carregar",
    "E8.delay1000": "E8 · gesto vale após 1 s",
    "E8.delay3000": "E8 · gesto vale após 3 s",
    "E8.delay6000": "E8 · gesto vale após 6 s",
    "E9.threeInOneClick": "E9 · 3 janelas num único clique",
    "E10.open": "E10 · janela nasce ao cruzar a borda",
    "E10.attach": "E10 · painel entra na janela ao soltar",
    "E10.follow": "E10 · janela segue o cursor"
};

const results = {};
const popups = {};
const $ = (id) => document.getElementById(id);
const panels = { "p-pointer": $("p-pointer"), "p-html5": $("p-html5"), "p-media": $("p-media") };
const logEl = $("log");
const ghost = $("ghost");
const cross = $("cross");
const dockZone = $("dock-zone");
const forceOut = $("force-out");
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ms = (t0) => Math.round(performance.now() - t0);

function log(msg) {
    logEl.textContent += `[${(performance.now() / 1000).toFixed(2)}s] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log("[spike-f0]", msg);
}

function record(id, status, detail) {
    results[id] = { status, detail };
    log(`${id}: ${status} · ${detail}`);
    const body = $("results");
    body.innerHTML = "";
    Object.keys(results).sort().forEach(key => {
        const r = results[key];
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${LABELS[key] || key}</td><td class="${r.status}">${r.status}</td><td></td>`;
        tr.lastChild.textContent = r.detail;
        body.appendChild(tr);
    });
}

function activationOf(win) {
    const ua = win.navigator.userActivation;
    return ua ? ua.isActive : "n/d";
}

function isOutside(e, win) {
    return e.clientX < 0 || e.clientY < 0 || e.clientX > win.innerWidth || e.clientY > win.innerHeight;
}

// ── Mover painéis entre documentos (mesma técnica do WorkspaceManager) ──

// Com "restaurar mídia" ligado, guarda tempo/estado de cada <video> antes de trocar de
// documento e reaplica depois: é o que a F3 fará se a troca reiniciar o vídeo.
function moveTo(panelId, container) {
    const el = panels[panelId];
    const media = Array.from(el.querySelectorAll("video, audio")).map(m => ({ m, time: m.currentTime, paused: m.paused }));
    if (el.ownerDocument !== container.ownerDocument) container.ownerDocument.adoptNode(el);
    container.appendChild(el);
    if ($("restore-media").checked) {
        media.forEach(({ m, time, paused }) => {
            // O navegador reinicia o elemento de forma assíncrona ao mudar de documento;
            // reaplica já e de novo quando os metadados voltam.
            const apply = () => {
                if (!m.srcObject && Number.isFinite(time)) m.currentTime = time;
                if (!paused) m.play().catch(err => log(`play() após mover falhou: ${err.message}`));
            };
            const onMeta = () => { m.removeEventListener("loadedmetadata", onMeta); apply(); };
            m.addEventListener("loadedmetadata", onMeta);
            setTimeout(() => m.removeEventListener("loadedmetadata", onMeta), 4000);
            apply();
        });
    }
}

function waitReady(win) {
    return new Promise(resolve => {
        const started = performance.now();
        const timer = setInterval(() => {
            let ready = false;
            try { ready = win.document.readyState === "complete" && !!win.document.getElementById("slot"); } catch (err) {}
            if (ready || win.closed || performance.now() - started > 5000) {
                clearInterval(timer);
                resolve(ready);
            }
        }, 30);
    });
}

function popupFeatures(screenX, screenY) {
    const left = Math.round((screenX || window.screenX + 80) - 60);
    const top = Math.round((screenY || window.screenY + 80) - 20);
    return `popup=yes,width=520,height=420,left=${left},top=${top}`;
}

async function openPopup(panelId, screenX, screenY, testId, t0) {
    const win = window.open(`popup.html?panel=${panelId}`, `spike_${panelId}`, popupFeatures(screenX, screenY));
    if (!win) {
        record(testId, "fail", `window.open bloqueado${t0 ? ` (${ms(t0)} ms após o início do gesto)` : ""}`);
        return null;
    }
    return attachPopup(panelId, win, testId, t0);
}

// Move o painel para uma janela já aberta (por openPopup ou pelo modo "nasce ao cruzar a borda").
async function attachPopup(panelId, win, testId, t0) {
    const when = t0 ? ` (${ms(t0)} ms após o início do gesto)` : "";
    popups[panelId] = win;
    if (!(await waitReady(win))) {
        record(testId, "fail", "a janela abriu, mas o documento não ficou pronto");
        return null;
    }
    moveTo(panelId, win.document.getElementById("slot"));
    win.document.addEventListener("pointermove", (e) => { popupCalib.set(win.document, { dx: e.screenX - e.clientX, dy: e.screenY - e.clientY }); });
    record(testId, "ok", `janela aberta${when}`);
    const timer = setInterval(() => {
        if (!win.closed) return;
        clearInterval(timer);
        if (popups[panelId] === win) dockBack(panelId);
    }, 400);
    return win;
}

function dockBack(panelId) {
    const win = popups[panelId];
    popups[panelId] = null;
    moveTo(panelId, $(`home-${panelId}`));
    if (win && !win.closed) win.close();
    log(`${panelId} re-acoplado na janela principal`);
}

window.addEventListener("beforeunload", () => {
    Object.values(popups).forEach(w => { try { w?.close(); } catch (err) {} });
});

// Contadores de clique: provam que listeners registrados na principal seguem vivos.
Object.values(panels).forEach(panel => {
    const counter = panel.querySelector(".clicks");
    const target = panel.id === "p-media" ? panel.querySelector("canvas") : panel.querySelector(".body");
    target.addEventListener("click", () => { counter.textContent = String(Number(counter.textContent) + 1); });
});

// ── Calibração de coordenadas para o E4 ──
// Cada evento de ponteiro na principal dá o deslocamento exato entre tela e página.

let calib = null;
const popupCalib = new WeakMap();

// Centro de um elemento em coordenadas de tela, usando a calibração do documento dele.
// Usado pelo teste com mouse real (xdnd.mjs) para saber onde clicar.
function screenPoint(panelId, selector) {
    const el = selector ? panels[panelId].querySelector(selector) : panels[panelId];
    const doc = el.ownerDocument;
    const o = doc === document ? calib : popupCalib.get(doc);
    if (!o) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2 + o.dx), y: Math.round(r.top + r.height / 2 + o.dy), inPopup: doc !== document };
}
document.addEventListener("pointermove", (e) => {
    calib = { dx: e.screenX - e.clientX, dy: e.screenY - e.clientY };
    $("calib").textContent = `Calibração: tela − página = (${calib.dx}, ${calib.dy})`;
});

function estimateOffset() {
    const border = (window.outerWidth - window.innerWidth) / 2;
    return { dx: window.screenX + border, dy: window.screenY + (window.outerHeight - window.innerHeight) - border };
}

function screenToClient(sx, sy) {
    const o = calib || estimateOffset();
    return { x: sx - o.dx, y: sy - o.dy };
}

function inDockZone(p) {
    const r = dockZone.getBoundingClientRect();
    return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

// ── E1 / E4: Pointer Events ──

(() => {
    const handle = panels["p-pointer"].querySelector(".handle");
    let drag = null;

    handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const win = handle.ownerDocument.defaultView;
        handle.setPointerCapture(e.pointerId);
        drag = { t0: performance.now(), win, inPopup: win !== window };
        e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (!drag.inPopup) {
            const out = isOutside(e, window);
            if ($("live-tearoff").checked) {
                // E10: a janela nasce ao cruzar a borda (gesto ainda válido) e segue o cursor.
                if (out && !drag.live && !drag.liveFailed) {
                    drag.live = window.open("popup.html?panel=p-pointer", "spike_p-pointer", popupFeatures(e.screenX, e.screenY));
                    drag.liveMoves = 0;
                    if (drag.live) record("E10.open", "ok", `janela nasceu ao cruzar a borda, ${ms(drag.t0)} ms após o início do gesto`);
                    else { drag.liveFailed = true; record("E10.open", "fail", `bloqueado ao cruzar a borda, ${ms(drag.t0)} ms após o início do gesto`); }
                } else if (drag.live && out) {
                    try { drag.live.moveTo(e.screenX - 60, e.screenY - 20); drag.liveMoves++; } catch (err) {}
                } else if (drag.live && !out) {
                    drag.live.close();
                    drag.live = null;
                    log("E10: cursor voltou para dentro; janela prévia fechada");
                }
                if (drag.live) { ghost.style.display = "none"; return; }
            }
            ghost.style.display = "block";
            ghost.style.left = `${e.clientX}px`;
            ghost.style.top = `${e.clientY}px`;
            ghost.classList.toggle("out", out);
            ghost.textContent = out ? "Solte para destacar" : "Painel Pointer";
        } else {
            const p = screenToClient(e.screenX, e.screenY);
            cross.style.display = "block";
            cross.style.left = `${p.x}px`;
            cross.style.top = `${p.y}px`;
            dockZone.classList.toggle("hot", inDockZone(p));
        }
    });

    const end = (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        ghost.style.display = "none";
        cross.style.display = "none";
        dockZone.classList.remove("hot");
        if (e.type === "pointercancel") { log("E1/E4: pointercancel"); return; }

        const act = activationOf(d.win);
        if (!d.inPopup && d.live) {
            const win = d.live;
            const expected = { x: e.screenX - 60, y: e.screenY - 20 };
            attachPopup("p-pointer", win, "E10.attach", d.t0).then(() => {
                const dx = Math.abs(win.screenX - expected.x), dy = Math.abs(win.screenY - expected.y);
                record("E10.follow", dx <= 12 && dy <= 12 ? "ok" : "fail",
                    `${d.liveMoves} movimentos da janela durante o arrasto; parou em (${win.screenX}, ${win.screenY}), cursor pedia (${expected.x}, ${expected.y})`);
            });
            return;
        }
        if (!d.inPopup) {
            record("E1.activation", act === true ? "ok" : act === false ? "fail" : "info", `userActivation.isActive=${act} após ${ms(d.t0)} ms`);
            const out = isOutside(e, window);
            if (out) record("E1.outside", "ok", `client(${e.clientX}, ${e.clientY}) screen(${e.screenX}, ${e.screenY})`);
            if (out || forceOut.checked) openPopup("p-pointer", e.screenX, e.screenY, "E1.tearoff", d.t0);
        } else {
            const p = screenToClient(e.screenX, e.screenY);
            const est = estimateOffset();
            const hit = inDockZone(p);
            record("E4.pointerBridge", hit ? "ok" : "info",
                `screen(${e.screenX}, ${e.screenY}) → principal(${Math.round(p.x)}, ${Math.round(p.y)}) por ${calib ? "calibração" : "estimativa"}; ` +
                `estimativa pura daria (${Math.round(e.screenX - est.dx)}, ${Math.round(e.screenY - est.dy)}); ${hit ? "dentro" : "fora"} da zona`);
            if (hit) dockBack("p-pointer");
        }
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
})();

// ── E2 / E3: arrasto HTML5 ──

(() => {
    const handle = panels["p-html5"].querySelector(".handle");
    let drag = null;
    let lastDragOverInMain = 0;

    document.addEventListener("dragover", () => { lastDragOverInMain = performance.now(); });

    handle.addEventListener("dragstart", (e) => {
        const win = handle.ownerDocument.defaultView;
        drag = { t0: performance.now(), win, inPopup: win !== window, docked: false };
        e.dataTransfer.setData(MIME, "p-html5");
        e.dataTransfer.setData("text/plain", "p-html5");
        e.dataTransfer.effectAllowed = "move";
    });

    handle.addEventListener("dragend", (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        const act = activationOf(d.win);
        if (!d.inPopup) {
            record("E2.activation", act === true ? "ok" : act === false ? "fail" : "info", `userActivation.isActive=${act} após ${ms(d.t0)} ms`);
            const sinceOver = Math.round(performance.now() - lastDragOverInMain);
            const outside = e.dataTransfer.dropEffect === "none" && (sinceOver > 150 || isOutside(e, window));
            record("E2.outsideDetect", "info",
                `dropEffect=${e.dataTransfer.dropEffect}; último dragover na página há ${sinceOver} ms; ` +
                `client(${e.clientX}, ${e.clientY}) screen(${e.screenX}, ${e.screenY}) → ${outside ? "fora" : "dentro"}`);
            if (outside || forceOut.checked) openPopup("p-html5", e.screenX, e.screenY, "E2.tearoff", d.t0);
        } else if (!d.docked && results["E3.crossDrop"]?.status !== "ok") {
            record("E3.crossDrop", "info", `arrasto terminou sem drop na zona (dropEffect=${e.dataTransfer.dropEffect})`);
        }
    });

    const accepts = (e) => Array.from(e.dataTransfer.types || []).includes(MIME);
    dockZone.addEventListener("dragenter", (e) => { if (accepts(e)) { e.preventDefault(); dockZone.classList.add("hot"); } });
    dockZone.addEventListener("dragover", (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        dockZone.classList.add("hot");
    });
    dockZone.addEventListener("dragleave", () => dockZone.classList.remove("hot"));
    dockZone.addEventListener("drop", (e) => {
        dockZone.classList.remove("hot");
        if (!accepts(e)) return;
        e.preventDefault();
        const id = e.dataTransfer.getData(MIME);
        if (drag) drag.docked = true;
        const fromPopup = panels[id] && panels[id].ownerDocument !== document;
        if (fromPopup) {
            record("E3.crossDrop", "ok", `drop recebido com tipos [${Array.from(e.dataTransfer.types).join(", ")}]`);
            dockBack(id);
        } else {
            log(`drop de ${id || "?"} vindo da própria janela principal; nada a fazer`);
        }
    });
})();

// ── E5: vídeo, canvas, listeners e ResizeObserver ──

const vid = $("vid");
const tl = $("tl");
let roCount = 0;
let vidEvents = [];
["emptied", "abort", "loadstart", "loadedmetadata", "pause", "play", "playing"].forEach(type => {
    vid.addEventListener(type, () => vidEvents.push(type));
});
let frame = 0;

(() => {
    const src = document.createElement("canvas");
    src.width = 320;
    src.height = 180;
    const g = src.getContext("2d");
    setInterval(() => {
        frame++;
        g.fillStyle = "#101828";
        g.fillRect(0, 0, 320, 180);
        g.fillStyle = "#8b5cf6";
        g.fillRect((frame * 4) % 320, 70, 40, 40);
        g.fillStyle = "#fff";
        g.font = "16px monospace";
        g.fillText(`frame ${frame}`, 12, 24);
    }, 33);
    if (src.captureStream) {
        vid.srcObject = src.captureStream(30);
        vid.play().catch(err => log(`vídeo não iniciou: ${err.message}`));
    } else {
        log("captureStream indisponível: use uma URL de vídeo real no E5");
    }

    const c = tl.getContext("2d");
    ["#f5b544", "#38bdf8", "#4ade80", "#f472b6"].forEach((color, i) => { c.fillStyle = color; c.fillRect(i * 80, 0, 78, 60); });
    new ResizeObserver(() => { roCount++; }).observe(tl);

    // Vídeo de arquivo (WebM gravado aqui mesmo), para comparar com o vídeo por stream.
    $("btn-video-file").addEventListener("click", () => makeFileVideo());

    $("btn-video-url").addEventListener("click", () => {
        const url = $("video-url").value.trim();
        if (!url) return;
        vid.srcObject = null;
        vid.src = url;
        vid.play().then(() => log(`vídeo real tocando: ${url}`)).catch(err => log(`vídeo real falhou: ${err.message}`));
    });
})();

let videoSource = "stream";
function makeFileVideo() {
    return new Promise((resolve, reject) => {
        const stream = vid.srcObject;
        if (!stream || !window.MediaRecorder) { log("sem stream ou MediaRecorder para gerar o arquivo"); reject(); return; }
        const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => {
            vid.srcObject = null;
            vid.src = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
            videoSource = "arquivo";
            vid.play().then(() => { log("vídeo de arquivo WebM tocando"); resolve(); }).catch(err => { log(`vídeo de arquivo falhou: ${err.message}`); reject(err); });
        };
        rec.start();
        log("gravando 4 s de vídeo WebM...");
        setTimeout(() => rec.stop(), 4000);
    });
}

function snapshot() {
    const counter = panels["p-media"].querySelector(".clicks");
    const before = Number(counter.textContent);
    const view = tl.ownerDocument.defaultView;
    tl.dispatchEvent(new view.MouseEvent("click", { bubbles: true }));
    return {
        doc: tl.ownerDocument === document ? "principal" : "destacada",
        paused: vid.paused,
        time: Number(vid.currentTime.toFixed(2)),
        pixel: Array.from(tl.getContext("2d").getImageData(100, 30, 1, 1).data).join(","),
        clickWorks: Number(counter.textContent) === before + 1,
        ro: roCount,
        width: Math.round(tl.getBoundingClientRect().width),
        events: vidEvents.splice(0).join(">") || "-"
    };
}

async function mediaRoundTrip() {
    const t0 = performance.now();
    await vid.play().catch(() => {});
    await sleep(1200);
    vidEvents = [];
    const a = snapshot();
    const win = await openPopup("p-media", 0, 0, "E5.open", t0);
    if (!win) return;
    await sleep(1500);
    const b = snapshot();
    dockBack("p-media");
    await sleep(1500);
    const c = snapshot();
    log(`E5 A=${JSON.stringify(a)}\nE5 B=${JSON.stringify(b)}\nE5 C=${JSON.stringify(c)}`);

    // O WebM de teste tem 4 s em loop: ali basta estar tocando e fora do zero.
    const playing = (x, y) => !y.paused && (y.time > x.time + 0.5 || (vid.loop && y.time > 0.1));
    const tag = `${videoSource}${$("restore-media").checked ? "+restaura" : ""}`;
    record(`E5.video[${tag}]`, playing(a, b) && playing(b, c) ? "ok" : "fail",
        `tempo ${a.time}s → ${b.time}s (destacada, pausado=${b.paused}) → ${c.time}s (de volta, pausado=${c.paused}); eventos ida: ${b.events}; volta: ${c.events}`);
    record("E5.canvas", a.pixel === b.pixel && b.pixel === c.pixel ? "ok" : "fail", `pixel ${a.pixel} → ${b.pixel} → ${c.pixel}`);
    record("E5.listeners", b.clickWorks && c.clickWorks ? "ok" : "fail", `clique na destacada=${b.clickWorks}, de volta=${c.clickWorks}`);
    const roStatus = b.ro > a.ro ? "ok" : (a.width === b.width ? "info" : "fail");
    record("E5.resizeObserver", roStatus, `chamadas ${a.ro} → ${b.ro} → ${c.ro}; largura ${a.width}px → ${b.width}px → ${c.width}px`);
}
$("btn-media-roundtrip").addEventListener("click", mediaRoundTrip);

// ── E6: monitores e Picture-in-Picture ──

let screenDetails = null;
$("btn-screens").addEventListener("click", async () => {
    if (!("getScreenDetails" in window)) { record("E6.screens", "info", "API indisponível neste navegador"); return; }
    try {
        screenDetails = await window.getScreenDetails();
        const list = screenDetails.screens.map(s => `${s.label || "tela"} ${s.width}×${s.height} em (${s.availLeft}, ${s.availTop})`);
        record("E6.screens", "ok", `${list.length} monitor(es): ${list.join(" | ")}`);
    } catch (err) {
        record("E6.screens", "fail", `permissão negada ou erro: ${err.message}`);
    }
});

$("btn-open-last-screen").addEventListener("click", async () => {
    if (!screenDetails) { record("E6.lastScreen", "info", "rode 'Listar monitores' antes"); return; }
    const s = screenDetails.screens[screenDetails.screens.length - 1];
    const win = window.open("popup.html?panel=none", "spike_screen", `popup=yes,width=400,height=300,left=${s.availLeft + 100},top=${s.availTop + 100}`);
    if (!win) { record("E6.lastScreen", "fail", "window.open bloqueado"); return; }
    await sleep(800);
    const inside = win.screenX >= s.availLeft && win.screenX < s.availLeft + s.availWidth;
    record("E6.lastScreen", inside ? "ok" : "fail", `janela em (${win.screenX}, ${win.screenY}); monitor alvo começa em (${s.availLeft}, ${s.availTop})`);
    setTimeout(() => win.close(), 2500);
});

$("btn-pip").addEventListener("click", async () => {
    if (!("documentPictureInPicture" in window)) { record("E6.pip", "info", "API indisponível neste navegador"); return; }
    try {
        const pip = await window.documentPictureInPicture.requestWindow({ width: 320, height: 180 });
        pip.document.body.style.cssText = "margin:0;background:#0b0f19;color:#e6eaf5;font:14px system-ui;display:grid;place-items:center";
        pip.document.body.textContent = "Picture-in-Picture funcionando";
        record("E6.pip", "ok", "janela sempre por cima aberta");
    } catch (err) {
        record("E6.pip", "fail", err.message);
    }
});

// ── E7 / E8: bloqueador de popups ──

(() => {
    const box = $("auto-open");
    let enabled = false;
    try { enabled = localStorage.getItem("spike_f0_autoopen") === "true"; } catch (err) {}
    box.checked = enabled;
    box.addEventListener("change", () => {
        try { localStorage.setItem("spike_f0_autoopen", String(box.checked)); } catch (err) {}
    });
    if (enabled) {
        const win = window.open("popup.html?panel=none", "spike_auto", "popup=yes,width=360,height=240");
        record("E7.autoOpen", win ? "ok" : "fail", win ? "abriu sem clique" : "bloqueado sem clique; restauração automática precisa de popups permitidos para o site ou do aviso 'Restaurar janelas'");
        if (win) setTimeout(() => win.close(), 1500);
    }

    document.querySelectorAll("button[data-delay]").forEach(btn => {
        btn.addEventListener("click", () => {
            const delay = Number(btn.dataset.delay);
            setTimeout(() => {
                const act = activationOf(window);
                const win = window.open("popup.html?panel=none", `spike_delay_${delay}`, "popup=yes,width=320,height=200");
                record(`E8.delay${delay}`, win ? "ok" : "fail", `userActivation.isActive=${act}; ${win ? "abriu" : "bloqueado"}`);
                if (win) setTimeout(() => win.close(), 1000);
            }, delay);
        });
    });
})();

// E9: um clique, várias janelas (o "Restaurar janelas" precisa disso)
$("btn-open-three").addEventListener("click", () => {
    const opened = [1, 2, 3].map(i => window.open("popup.html?panel=none", `spike_three_${i}`, `popup=yes,width=300,height=200,left=${80 + i * 40},top=${80 + i * 40}`));
    const count = opened.filter(Boolean).length;
    record("E9.threeInOneClick", count === 3 ? "ok" : "fail", `${count} de 3 janelas abertas no mesmo clique`);
    setTimeout(() => opened.forEach(w => w && w.close()), 1200);
});

// ── Relatório ──

$("ua").textContent = `${navigator.userAgent} · userActivation: ${"userActivation" in navigator ? "sim" : "não"}`;
$("btn-copy").addEventListener("click", () => {
    const lines = [navigator.userAgent, ...Object.keys(results).sort().map(k => `${k}\t${results[k].status}\t${results[k].detail}`)];
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(() => log("resultados copiados")).catch(() => log(`copie manualmente:\n${text}`));
});

window.__spike = {
    results, openPopup, dockBack, mediaRoundTrip, snapshot, makeFileVideo, screenPoint,
    zonePoint: () => {
        if (!calib) return null;
        const r = dockZone.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2 + calib.dx), y: Math.round(r.top + r.height / 2 + calib.dy) };
    }
};
log("spike pronto");
