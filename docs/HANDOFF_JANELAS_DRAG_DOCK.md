# Passagem: janelas drag & dock (F0–F5 + P14) e próxima tarefa

Branch: `talho-windows-drag-dock-6mtidh` (a partir de `main`). Commits no nome do autor, **sem assinatura
de IA** (sem `Co-Authored-By`/`Claude-Session`, sem branch `claude/...`).
Plano completo, com decisões e animações: página do plano (artifact "talho-dock-plan", versão 14).
O arquivo `docs/PLANO_JANELAS_DRAG_DOCK.md` é ignorado pelo git (fica só local).

## Próxima tarefa (pedido do usuário)

> Os botões de recolher painel e os atalhos Numpad de **Ajustes & Efeitos** (Numpad5) e
> **Transcrição & Falas** (Numpad6) não estão funcionando.

### O que já se sabe (diagnóstico de 28/09)

`node scripts/dock_collapse_check.mjs` (headless, sem backend, localStorage limpo) testa os botões
`#toggle-inspector` / `#toggle-right` e as teclas Numpad5 / Numpad6 em vários layouts:

| Layout | Botões | Numpad5/6 |
|---|---|---|
| padrão, inspector-right, decupagem, montagem | recolhem | recolhem |
| Timeline bottom-full / bottom-left / bottom-right | recolhem | recolhem |
| todas as abas do Painel Lateral movidas para a Biblioteca (P14) | recolhem | recolhem |
| **Ajustes empilhado** sob a Biblioteca ou sob o Painel Lateral (F2b) | **`#toggle-inspector` coberto** (o clique cai no `.sidebar-header` do anfitrião) | recolhem |

Ou seja: **no estado limpo funciona**. O defeito do usuário depende do estado real dele. Próximos
passos sugeridos:
1. Pedir ao usuário, no navegador onde falha (F12 → Console):
   `JSON.stringify({ws: localStorage.capiau_active_workspace, cols: localStorage.capiau_column_order, stacks: localStorage.capiau_column_stacks, strips: localStorage.capiau_tab_strips, layout: localStorage.capiau_dock_layout})`,
   e se aparece algum erro vermelho ao clicar no botão ou apertar a tecla.
2. Perguntar: o painel não recolhe, recolhe e volta sozinho, ou recolhe mas o espaço não é
   reaproveitado? A tecla falha com o foco em algum campo (busca, player)? NumLock ligado?
3. Suspeitas para conferir no código:
   - **Pilha (F2b)**: `mountStackGuests` (`workspaceManager.js`) tira `collapsed` do convidado e o
     cabeçalho do convidado fica sob o do anfitrião. Recolher um painel empilhado nunca foi desenhado
     (o que deve acontecer: some da pilha? a pilha encolhe?).
   - **Painel em janela destacada**: `collapseSidebar`/`expandSidebar` (`main.js` ~1931) retornam cedo se
     `ownerDocument !== document`; o `toggle*` de `workspaceManager.js` (~5035/5068) também.
   - **Recolher automático do Painel Lateral (F5a/P14)**: `TabPanels.syncSidebarVisibility`
     (`tabPanels.js`) clica `#toggle-right`/`#reopen-right` quando a faixa fica vazia/volta a ter abas
     (flag `autoCollapsed`). Pode brigar com o recolher manual.
   - **Atalhos**: handler do Numpad em `workspaceManager.js` (~5395–5560; Numpad5 → `toggleInspector`,
     Numpad6 → `toggleRightSidebar`). Conferir se algum `keydown` em captura (ex.: `dockDrag.js` desfazer
     do aviso, `handleLayoutShortcut`) ou foco em input bloqueia antes.
   - `restore line` (`#reopen-inspector`, `#reopen-right`) depois de `arrangeTopColumns`/mudar ordem das
     colunas: se a linha ficar fora de lugar, o painel "recolhe" mas não dá para reabrir.
4. Corrigir, cobrir com autoteste (`tests/`) e rodar `scripts/dock_collapse_check.mjs` + regressões abaixo.

## O que a sessão entregou (resumo)

| Fase | Entrega |
|---|---|
| F0 | Spike (`src/ui/spikes/dock-f0/`): janelas same-origin via `adoptNode`; ativação do usuário ~5 s e 1 janela por gesto; vídeo reinicia ao trocar de documento (restaura tempo/play). |
| F1 | `dockModel.js`: layout em árvore ↔ estado legado, `LayoutHistory`. Ctrl+Alt+Z / Ctrl+Alt+Shift+Z, botão Restaurar layout (volta ao workspace carregado). |
| F2a/b | Alça no cabeçalho dos painéis, zonas de encaixe (trocar no centro, bordas), empilhar laterais numa coluna (`dockOps.js`, máx. 3). |
| F3 | Arrastar para fora destaca (janela nasce ao cruzar a borda e segue o cursor); arrastar de volta reacopla; restaurar janelas ao abrir (`popoutRestore.js`, aviso "Restaurar janelas (N)"). |
| F4a/b | Juntar janelas por arrasto; janela com até 4 painéis de qualquer tipo (`panel-group.html`, disposições linha/coluna/grade/principal). |
| F5a/b | Abas viram painéis (`tabPanels.js`): Falas+inspetor, Visão, Chat, Busca, Tarefas, Logs, Temas, Rostos, Títulos, Docs (Mídias fica). Busca própria em Temas/Rostos/Docs. |
| P14 | Aba muda entre Biblioteca e Painel Lateral (arrasto ou "Mover X para…" no botão direito); entra no desfazer, workspaces e Restaurar padrão. |

Decisões do usuário que valem para o resto: Timeline sempre no centro ou em janela; máx. 4 painéis
por janela; soltar no centro = trocar; Chrome principal mas funcionar nos outros; Source/Program
separados; arrastar pela alça; muda na hora com Ctrl+Z e restaurar padrão; janelas reabrem sozinhas
(bloqueadas vão para "Restaurar janelas").

Pendências conhecidas: F6 (escolher monitor via Window Management API, animações FLIP,
teclado/acessibilidade, Manual/Wiki cap. 03); F2c (monitores fora do centro, faixa inteira nova);
aba destacada virar coluna no editor; rolagem infinita da Busca destacada; só uma janela de grupo por
vez; título do Painel Lateral não muda quando Falas sai.

## Testes

- Autotestes (54): `for f in tests/autoteste_*.mjs; do node $f || echo FAIL $f; done`
  (drag & dock: `autoteste_dock_{model,ops,drag,tearoff,join,group,tabs}.mjs`).
- Mouse real (Linux, Xvfb + xdotool + Playwright global): `scripts/dock_real_mouse_check.mjs` (F3),
  `dock_group_real_mouse_check.mjs` (F4), `dock_tabs_real_mouse_check.mjs` (F5),
  `dock_strips_real_mouse_check.mjs` (P14).
- Headless: `scripts/dock_collapse_check.mjs` (recolher painéis / Numpad).
- Local (Windows): pasta `C:\Users\FGC\dev\capiau\talho`, rodar como de costume, http://localhost:8000,
  Ctrl+F5 após atualizar; permitir pop-ups de localhost:8000.
