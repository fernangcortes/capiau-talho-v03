// Gerador das tabelas de atalhos a partir da fonte única: src/ui/js/keymapService.js
//
// Uso:
//   node scripts/gerar_atalhos.mjs            grava os arquivos
//   node scripts/gerar_atalhos.mjs --check    sai com código 1 se algum arquivo estiver desatualizado
//
// Escreve (somente ENTRE os marcadores) em:
//   docs/shortcuts.md                          todos os perfis
//   wiki/14.-Guia-Completo-de-Atalhos.md       perfil CapIAu completo + link para as demais
//   USER_MANUAL.md                             perfil CapIAu completo (se os marcadores existirem)
// E gera por completo: docs/atalhos/cartao-<perfil>.html (cartão A4 imprimível).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const INICIO = "<!-- GERADO:ATALHOS:INICIO -->";
const FIM = "<!-- GERADO:ATALHOS:FIM -->";
const URL_DOCS = "https://github.com/fernangcortes/capiau-talho-v03/blob/main/docs/shortcuts.md";

// ── Carregamento do módulo da UI (com mínimo de polyfills de DOM) ───────────
function prepararAmbiente() {
    const g = globalThis;
    g.window = g.window || g;
    g.addEventListener = g.addEventListener || (() => {});
    g.removeEventListener = g.removeEventListener || (() => {});
    g.requestAnimationFrame = g.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
    g.cancelAnimationFrame = g.cancelAnimationFrame || ((id) => clearTimeout(id));
    g.ResizeObserver = g.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
    g.localStorage = {
        _d: {},
        getItem(k) { return this._d[k] ?? null; },
        setItem(k, v) { this._d[k] = String(v); },
        removeItem(k) { delete this._d[k]; },
        clear() { this._d = {}; },
    };
    g.document = {
        defaultView: g,
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }),
        body: { appendChild() {} },
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}

prepararAmbiente();
const modUrl = new URL("../src/ui/js/keymapService.js", import.meta.url);
const { KEYMAP_PRESETS, COMMANDS_CATALOG, COMMAND_CATEGORIES, PRESET_NAMES } = await import(modUrl.href);

// Ordem e nomes reais dos perfis (o perfil "custom" não tem tabela fixa)
const PERFIS = ["capiau", "premiere", "resolve", "finalcut", "kdenlive"].filter((p) => KEYMAP_PRESETS[p]);

// ── Formatação (espelha KeymapService.formatKeySingle) ──────────────────────
function teclaLegivel(k) {
    if (!k) return "";
    if (k.startsWith("Key")) return k.slice(3).toUpperCase();
    if (k.startsWith("Digit")) return k.slice(5);
    if (k.startsWith("Numpad")) {
        const m = { NumpadDecimal: "Num .", NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /", NumpadEnter: "Num Enter" };
        return m[k] || "Num " + k.slice(6);
    }
    const m = {
        ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Espaço", Escape: "Esc", Delete: "Del",
        BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Backslash: "\\", Slash: "/", Equal: "+ / =", Plus: "+ / =",
        Minus: "-", Underscore: "-",
    };
    return m[k] || k;
}
const comboLegivel = (c) => c.split("+").map(teclaLegivel).join(" + ");
const escMd = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const codigo = (s) => "`" + s.replace(/`/g, "'") + "`";

// ── Atalhos efetivos de um perfil (mesma regra de recalculateActiveBindings) ─
function bindingsDoPerfil(perfil) {
    const base = KEYMAP_PRESETS[perfil];
    const out = {};
    for (const cmd of COMMANDS_CATALOG) {
        const b = base[cmd.id] || KEYMAP_PRESETS.capiau[cmd.id] || [];
        out[cmd.id] = Array.isArray(b) ? [...b] : [b];
    }
    return out;
}

function conflitosDoPerfil(bind) {
    const porCombo = new Map();
    for (const cmd of COMMANDS_CATALOG) {
        for (const c of bind[cmd.id]) {
            if (!porCombo.has(c)) porCombo.set(c, []);
            porCombo.get(c).push(cmd);
        }
    }
    return porCombo;
}

function linhasDoPerfil(perfil) {
    const bind = bindingsDoPerfil(perfil);
    const porCombo = conflitosDoPerfil(bind);
    const categorias = Object.keys(COMMAND_CATEGORIES);
    const grupos = [];
    let repetidos = 0;
    for (const cat of categorias) {
        let cmds = COMMANDS_CATALOG.filter((c) => c.category === cat && bind[c.id].length > 0);
        // Agrupa comandos que dividem o primeiro combo, para ficarem lado a lado
        const ordem = [];
        const vistos = new Set();
        for (const c of cmds) {
            if (vistos.has(c.id)) continue;
            ordem.push(c);
            vistos.add(c.id);
            for (const combo of bind[c.id]) {
                for (const outro of porCombo.get(combo) || []) {
                    if (outro.category === cat && !vistos.has(outro.id) && bind[outro.id].length > 0) {
                        ordem.push(outro);
                        vistos.add(outro.id);
                    }
                }
            }
        }
        const linhas = ordem.map((c) => {
            const compart = new Map();
            for (const combo of bind[c.id]) {
                for (const outro of porCombo.get(combo) || []) {
                    if (outro.id !== c.id) {
                        if (!compart.has(outro.id)) compart.set(outro.id, { cmd: outro, combos: [] });
                        compart.get(outro.id).combos.push(combo);
                    }
                }
            }
            if (compart.size) repetidos++;
            return { cmd: c, combos: bind[c.id], compart: [...compart.values()] };
        });
        if (linhas.length) grupos.push({ cat, label: COMMAND_CATEGORIES[cat].label, linhas });
    }
    return { grupos, repetidos };
}

// ── Markdown ────────────────────────────────────────────────────────────────
function nomePerfil(p) {
    return PRESET_NAMES[p] || p;
}

function markdownPerfil(perfil, nivel = 3) {
    const h = "#".repeat(nivel);
    const h2 = "#".repeat(nivel + 1);
    const { grupos, repetidos } = linhasDoPerfil(perfil);
    const out = [];
    out.push(`${h} Perfil ${nomePerfil(perfil)}`, "");
    if (repetidos > 0) {
        out.push(
            "> Alguns atalhos aparecem em mais de uma ação neste perfil. Isso é intencional: a ação executada depende do contexto " +
                "(painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ou clipe fantasma ativo). " +
                "A coluna de observação indica com quais ações o atalho é compartilhado.",
            ""
        );
    }
    for (const g of grupos) {
        out.push(`${h2} ${g.label}`, "", "| Atalho | Ação | Contexto/observação |", "| :--- | :--- | :--- |");
        for (const l of g.linhas) {
            const atalho = l.combos.map((c) => codigo(comboLegivel(c))).join(" ou ");
            let obs = l.cmd.description || "";
            if (l.compart.length) {
                const nomes = l.compart.map((x) => `${x.cmd.label} (${x.combos.map(comboLegivel).join(", ")})`).join("; ");
                obs += (obs ? "<br>" : "") + `**Atalho compartilhado, depende do contexto:** ${nomes}.`;
            }
            out.push(`| ${escMd(atalho)} | ${escMd(l.cmd.label)} | ${escMd(obs)} |`);
        }
        out.push("");
    }
    return out.join("\n");
}

function blocoDocs() {
    const partes = [];
    for (const p of PERFIS) partes.push(markdownPerfil(p, 3));
    return partes.join("\n");
}

function blocoCapiau(nivel, rodape) {
    return markdownPerfil("capiau", nivel) + "\n" + rodape + "\n";
}

// ── Cartão A4 imprimível ────────────────────────────────────────────────────
function cartaoHtml(perfil) {
    const { grupos } = linhasDoPerfil(perfil);
    const secoes = grupos
        .map((g) => {
            const itens = g.linhas
                .map((l) => {
                    const teclas = l.combos.map((c) => `<kbd>${escHtml(comboLegivel(c))}</kbd>`).join(" ou ");
                    return `<li><span class="k">${teclas}</span><span class="a">${escHtml(l.cmd.label)}</span></li>`;
                })
                .join("\n");
            return `<section><h2>${escHtml(g.label)}</h2><ul>\n${itens}\n</ul></section>`;
        })
        .join("\n");
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartão de atalhos - ${escHtml(nomePerfil(perfil))}</title>
<!-- Arquivo gerado por scripts/gerar_atalhos.mjs. Não edite à mão. -->
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #111; background: #fff; font-size: 8pt; margin: 0; padding: 10mm; }
  @media print { body { padding: 0; } }
  header { border-bottom: 2px solid #111; margin-bottom: 4mm; padding-bottom: 2mm; }
  h1 { font-size: 14pt; margin: 0; }
  header p { margin: 1mm 0 0; color: #444; font-size: 7.5pt; }
  .colunas { column-count: 3; column-gap: 6mm; }
  section { break-inside: avoid-column; margin: 0 0 3mm; }
  h2 { font-size: 8.5pt; margin: 0 0 1mm; padding: 0.6mm 1.5mm; background: #e8e8e8; border-left: 2mm solid #111; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 2mm; padding: 0.4mm 0; border-bottom: 0.2mm dotted #bbb; break-inside: avoid; }
  .k { flex: 0 0 auto; max-width: 52%; text-align: left; }
  .a { text-align: right; flex: 1 1 auto; }
  kbd { font-family: Consolas, "DejaVu Sans Mono", monospace; font-size: 7.5pt; border: 0.2mm solid #666; border-radius: 1mm; padding: 0 1mm; background: #f6f6f6; white-space: nowrap; }
  footer { margin-top: 3mm; font-size: 7pt; color: #555; }
</style>
</head>
<body>
<header>
  <h1>CapIAu-Talho: atalhos do perfil ${escHtml(nomePerfil(perfil))}</h1>
  <p>Quando o mesmo atalho aparece em mais de uma ação, o resultado depende do contexto (painel em foco, ferramenta ativa, elemento sob o mouse, sugestão ativa).</p>
</header>
<div class="colunas">
${secoes}
</div>
<footer>Gerado a partir de src/ui/js/keymapService.js. Perfil ativo e personalização: botão de teclado na barra da timeline.</footer>
</body>
</html>
`;
}

// ── Escrita com marcadores ──────────────────────────────────────────────────
let desatualizados = [];

function lerSeExiste(rel) {
    const abs = path.join(RAIZ, rel);
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function substituirBloco(rel, conteudo, { obrigatorio }) {
    const texto = lerSeExiste(rel);
    if (texto === null) {
        if (obrigatorio) { desatualizados.push(`${rel} (arquivo ausente)`); }
        return;
    }
    const i = texto.indexOf(INICIO);
    const f = texto.indexOf(FIM);
    if (i < 0 || f < 0 || f < i) {
        if (obrigatorio) desatualizados.push(`${rel} (marcadores ausentes)`);
        else console.log(`  - ${rel}: marcadores ausentes, ignorado`);
        return;
    }
    const novo = texto.slice(0, i + INICIO.length) + "\n\n" + conteudo.trim() + "\n\n" + texto.slice(f);
    if (novo === texto) { console.log(`  = ${rel}: em dia`); return; }
    if (CHECK) { desatualizados.push(rel); return; }
    fs.writeFileSync(path.join(RAIZ, rel), novo, "utf8");
    console.log(`  + ${rel}: atualizado`);
}

function escreverArquivo(rel, conteudo) {
    const abs = path.join(RAIZ, rel);
    const atual = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (atual === conteudo) { console.log(`  = ${rel}: em dia`); return; }
    if (CHECK) { desatualizados.push(rel); return; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, conteudo, "utf8");
    console.log(`  + ${rel}: gerado`);
}

console.log(CHECK ? "Verificando atalhos gerados..." : "Gerando atalhos...");

substituirBloco("docs/shortcuts.md", blocoDocs(), { obrigatorio: true });

const rodapeWiki =
    `As tabelas dos demais perfis (${PERFIS.filter((p) => p !== "capiau").map(nomePerfil).join(", ")}) ficam em ` +
    `[docs/shortcuts.md](${URL_DOCS}).`;
substituirBloco("wiki/14.-Guia-Completo-de-Atalhos.md", blocoCapiau(3, rodapeWiki), { obrigatorio: true });
substituirBloco("USER_MANUAL.md", blocoCapiau(4, rodapeWiki), { obrigatorio: false });

for (const p of PERFIS) escreverArquivo(`docs/atalhos/cartao-${p}.html`, cartaoHtml(p));

if (CHECK) {
    if (desatualizados.length) {
        console.error("DESATUALIZADO (rode: node scripts/gerar_atalhos.mjs):");
        for (const d of desatualizados) console.error("  - " + d);
        process.exit(1);
    }
    console.log("OK: atalhos em dia.");
} else if (desatualizados.length) {
    console.error("Avisos:");
    for (const d of desatualizados) console.error("  - " + d);
    process.exit(1);
}
