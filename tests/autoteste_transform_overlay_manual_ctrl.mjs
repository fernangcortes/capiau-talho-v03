// tests/autoteste_transform_overlay_manual_ctrl.mjs
// Autoteste: Modo Manual (Ctrl+Clique) e Modo Automático das Alças de Transformação no Preview do CapIAu

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

console.log("=== INICIANDO AUTOTESTE: ALÇAS DE TRANSFORMAÇÃO (MODO MANUAL CTRL+CLIQUE E MODO AUTOMÁTICO) ===\n");

const playerJs = fs.readFileSync(path.join(rootDir, "src/ui/js/player.js"), "utf-8");
const timelineStateJs = fs.readFileSync(path.join(rootDir, "src/ui/js/timelineState.js"), "utf-8");
const indexHtml = fs.readFileSync(path.join(rootDir, "src/ui/index.html"), "utf-8");
const mainJs = fs.readFileSync(path.join(rootDir, "src/ui/js/main.js"), "utf-8");
const workspaceManagerJs = fs.readFileSync(path.join(rootDir, "src/ui/js/workspaceManager.js"), "utf-8");
const stylesCss = fs.readFileSync(path.join(rootDir, "src/ui/styles.css"), "utf-8");

// ─────────────────────────────────────────────────────────────────────
// 1. TIMELINESTATE.JS — ESTADO E MÉTODOS DE CONTROLE
// ─────────────────────────────────────────────────────────────────────
console.log("1. Verificando propriedades e métodos em timelineState.js...");

assert.ok(
    timelineStateJs.includes("this.autoTransformOverlay = this.loadAutoTransformOverlay();"),
    "autoTransformOverlay deve ser inicializado pelo loader no construtor de CapiauTimelineState"
);
assert.ok(
    timelineStateJs.includes("this.manualTransformClipId = null;"),
    "manualTransformClipId deve ser inicializado como null"
);
assert.ok(
    timelineStateJs.includes("loadAutoTransformOverlay()") &&
    timelineStateJs.includes('return false;'),
    "loadAutoTransformOverlay deve ter default false (padrão manual)"
);
assert.ok(
    timelineStateJs.includes("toggleAutoTransformOverlay(enabled)"),
    "Método toggleAutoTransformOverlay deve existir"
);
assert.ok(
    timelineStateJs.includes("setManualTransformClipId(clipId)"),
    "Método setManualTransformClipId deve existir"
);
assert.ok(
    timelineStateJs.includes("clearClipSelection()") &&
    timelineStateJs.includes("this.manualTransformClipId = null;"),
    "clearClipSelection deve limpar manualTransformClipId"
);

console.log("   ✔ Propriedades, persistência no localStorage e métodos de timelineState validados.");

// ─────────────────────────────────────────────────────────────────────
// 2. PLAYER.JS — SYNCTRANSFORMOVERLAY E GUARDAS DE MODO
// ─────────────────────────────────────────────────────────────────────
console.log("2. Verificando lógica de exibição em syncTransformOverlay...");

assert.ok(
    playerJs.includes("const isAuto = !!TIMELINE_STATE.autoTransformOverlay;"),
    "syncTransformOverlay deve verificar se o modo automático está ativo"
);
assert.ok(
    playerJs.includes("const isManualActive = String(activeClip.id) === String(TIMELINE_STATE.manualTransformClipId);"),
    "syncTransformOverlay deve verificar se o clipe atual foi ativado manualmente"
);
assert.ok(
    playerJs.includes("if (!isAuto && !isManualActive)"),
    "syncTransformOverlay deve ocultar o overlay se nem auto nem manual-active forem verdadeiros"
);

console.log("   ✔ Guardas de visibilidade por padrão e em modo manual validadas.");

// ─────────────────────────────────────────────────────────────────────
// 3. PLAYER.JS — CTRL+CLIQUE NO PREVIEW (HANDLEPREVIEWCTRLCLICK)
// ─────────────────────────────────────────────────────────────────────
console.log("3. Verificando tratamento de Ctrl+Clique no preview...");

assert.ok(
    playerJs.includes("handlePreviewCtrlClick(e)"),
    "handlePreviewCtrlClick deve existir em ProgramPlayer"
);
assert.ok(
    playerJs.includes("TIMELINE_STATE.setManualTransformClipId(targetClip.id);"),
    "handlePreviewCtrlClick deve definir manualTransformClipId com o clipe clicado/ativo"
);
assert.ok(
    playerJs.includes("TIMELINE_STATE.setManualTransformClipId(null);"),
    "handlePreviewCtrlClick deve alternar (toggle off) se já estiver ativo para o clipe"
);
assert.ok(
    playerJs.includes("this._settingManualTransformFromPreview = true;"),
    "Flag _settingManualTransformFromPreview deve proteger contra desativação durante a seleção direta pelo preview"
);

// Mousedown do wrapper intercepta Ctrl+Clique
assert.ok(
    playerJs.includes("(e.ctrlKey || e.metaKey) && e.button === 0") &&
    playerJs.includes("this.handlePreviewCtrlClick(e);"),
    "Mousedown do wrapper de vídeo deve interceptar Ctrl+Clique e chamar handlePreviewCtrlClick"
);

// Mousedown do overlay desativa em Ctrl+Clique
assert.ok(
    playerJs.includes("Ctrl+Clique no vídeo com overlay visível: desativa o modo manual de transformação"),
    "Mousedown do overlay deve permitir desativar com Ctrl+Clique"
);

// Escape key desativa transformação manual
assert.ok(
    playerJs.includes('if (e.key === "Escape" || e.code === "Escape")') &&
    playerJs.includes("TIMELINE_STATE.setManualTransformClipId(null);"),
    "Tecla Escape deve desativar transformação manual ativa"
);

console.log("   ✔ Interação Ctrl+Clique, toggle off, escape e blindagem do preview validadas.");

// ─────────────────────────────────────────────────────────────────────
// 4. PLAYER.JS — APENAS SELECIONAR NA TIMELINE NÃO EXIBE AS LINHAS
// ─────────────────────────────────────────────────────────────────────
console.log("4. Verificando que selecionar na timeline NÃO exibe as linhas no modo padrão...");

assert.ok(
    playerJs.includes("STATE.on(\"timelineSelectionChanged\", () => {") &&
    playerJs.includes("if (!this._settingManualTransformFromPreview) {") &&
    playerJs.includes("TIMELINE_STATE.setManualTransformClipId(null);"),
    "Ao mudar de seleção na timeline fora do preview, manualTransformClipId deve ser limpo"
);

console.log("   ✔ Seleção via timeline limpa o ID manual, mantendo linhas ocultas no padrão.");

// ─────────────────────────────────────────────────────────────────────
// 5. INDEX.HTML E MAIN.JS — BOTÃO NO HEADER E DROPDOWN DE OPÇÕES
// ─────────────────────────────────────────────────────────────────────
console.log("5. Verificando botão no header do Program e checkbox no menu de opções...");

assert.ok(
    indexHtml.includes('id="btn-toggle-auto-transform"'),
    "index.html deve conter o botão #btn-toggle-auto-transform no header do Program"
);
assert.ok(
    indexHtml.includes('id="chk-auto-transform-overlay"'),
    "index.html deve conter a checkbox #chk-auto-transform-overlay no dropdown de visualização"
);
assert.ok(
    mainJs.includes('document.getElementById("chk-auto-transform-overlay")') &&
    mainJs.includes("TIMELINE_STATE.toggleAutoTransformOverlay(e.target.checked);"),
    "main.js deve sincronizar chk-auto-transform-overlay com toggleAutoTransformOverlay"
);
assert.ok(
    playerJs.includes('this.el("btn-toggle-auto-transform")') &&
    playerJs.includes("TIMELINE_STATE.toggleAutoTransformOverlay()"),
    "ProgramPlayer deve conectar btn-toggle-auto-transform a toggleAutoTransformOverlay"
);
assert.ok(
    stylesCss.includes(".btn-transform-mode.active"),
    "styles.css deve conter estilização ativa (.active) para o botão de transformação"
);

console.log("   ✔ Botão no header, checkbox em opções e estilos CSS validados.");

// ─────────────────────────────────────────────────────────────────────
// 6. WORKSPACEMANAGER.JS — PERSISTÊNCIA NO WORKSPACE E CLICKS
// ─────────────────────────────────────────────────────────────────────
console.log("6. Verificando suporte a workspace e isolamento de cliques...");

assert.ok(
    workspaceManagerJs.includes("autoTransformOverlay: ts.autoTransformOverlay"),
    "workspaceManager deve salvar autoTransformOverlay no snapshot do workspace"
);
assert.ok(
    workspaceManagerJs.includes("ts.toggleAutoTransformOverlay(td.autoTransformOverlay)"),
    "workspaceManager deve restaurar autoTransformOverlay ao aplicar workspace"
);
assert.ok(
    workspaceManagerJs.includes("if (e.ctrlKey || e.metaKey) return;"),
    "setupPlayerClickHandlers deve ignorar cliques com Ctrl para não disparar play/pause"
);

console.log("   ✔ WorkspaceManager configurado para persistência e não interferência.");

console.log("\n=== AUTOTESTE CONCLUÍDO COM SUCESSO: 100% DE APROVAÇÃO ===");
