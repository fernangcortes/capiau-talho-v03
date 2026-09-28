# Passagem: janelas drag & dock (F0–F5, P14, recolher) → próxima: F2c

Branch: `talho-windows-drag-dock-6mtidh` (a partir de `main`), em dia com o remoto em 28/09.
Commits no nome do autor (`fernangcortes <escrevaprofernando@gmail.com>`), **sem assinatura de IA**
(sem `Co-Authored-By`/`Claude-Session`, sem branch `claude/...`). Confirmar antes de dar push.

Plano completo, com decisões e animações: página "Talho Drag & Dock"
(https://claude.ai/artifact/SF8tDpe1VVSy4brs938X3V). O `docs/PLANO_JANELAS_DRAG_DOCK.md` é ignorado
pelo git e não existe em todas as máquinas: a página é a fonte do plano.

## Próxima sessão: F2c

**Objetivo (do plano):** a animação 3 da página. Encostar um painel numa **borda do editor** cria uma
**área nova do lado inteiro** (faixa inteira embaixo/em cima, coluna na ponta), inclusive trazendo o
painel de uma janela destacada; e os **monitores podem sair do centro**. A página registra a F2 como
"F2a/F2b concluídas; em aberto: monitores fora do centro e faixa inteira nova".

### Como o editor é montado hoje (o que a F2c mexe)

- O layout principal **não** é renderizado pela árvore. O estado real é o legado do `WorkspaceManager`:
  `columnOrder` (colunas + `center-stage`), `columnStacks` (F2b), `timelinePosition`
  (`center` | `bottom-left` | `bottom-right` | `bottom-full`) e `monitorsLayout`.
- Montagem no DOM: `arrangeColumnsIntoContainer` / `arrangeTopColumns` (colunas, linhas de expandir,
  pilhas) e `setTimelinePosition` (cria `studioTop` / `compoundStage` para a timeline embaixo).
- `dockModel.js` converte legado ↔ árvore (`layoutFromLegacy` / `legacyFromLayout`) para o histórico
  (Ctrl+Alt+Z) e para salvar. `legacyFromLayout` devolve `null` para qualquer árvore que o legado não
  representa: é exatamente o que a F2c precisa ampliar.
- Alvos do arrasto: `dockDrag.js` → `resolveTarget` → `resolveColumnTarget` (hoje as bordas do editor
  só mandam a coluna para a ponta esquerda/direita via `moveToEdge`), `resolveTimelineTarget`
  (as 4 posições da timeline) e `resolveMonitorTarget` (só lado a lado / empilhados).
- Operações puras em `dockOps.js` (`moveBeside`, `moveToEdge`, `stackWith`, `swapPanels`,
  `removeFromStack`), testadas em `tests/autoteste_dock_ops.mjs`.
- Recolher (esta sessão) já sabe desenhar linha deitada (`restore-line-h`) e seta cima/baixo:
  uma faixa nova deve reaproveitar `panelPlacement` / `applyPanelCollapse` / `collapseEdge`.

### Decisões da F2c (usuário, 28/09)

1. **Caminho técnico: incremental.** Faixas entram no estado legado (ex.: `bands: { top: [...], bottom: [...] }`),
   com papel próprio no `dockModel` e operações novas em `dockOps`; o renderizador atual continua.
2. **Vão para faixas: laterais e abas** (as abas destacáveis da F5). Monitores: ver "Em aberto".
3. **Faixa em cima e embaixo ao mesmo tempo; vários painéis na mesma faixa.** Seguir a Seção IX da skill
   `.agents/skills/capiau-nle-design-system` (criada nesta sessão): seta de recolher pela posição dentro
   da faixa, linha de expandir no lugar do painel, divisores só entre visíveis e **trocar de lugar dentro
   da faixa** arrastando a alça, como na janela de grupo.
4. **O centro vira o que o usuário quiser.**
5. **Coluna da ponta × faixa inteira: o usuário escolhe, no arrasto e depois.**
   - *No arrasto:* a borda esquerda/direita do editor tem duas zonas na altura. Soltando na parte de
     cima (ao lado do centro), a coluna fica só em cima e a faixa passa por baixo dela com a largura
     inteira ("faixa manda no canto"). Soltando na parte da borda que fica ao lado da faixa (o canto),
     a coluna desce até o fim e a faixa encurta ("coluna completa"). A sombra de prévia mostra o
     retângulo exato de cada caso enquanto o cursor anda. Vale igual para faixa em cima (canto de cima).
   - *Depois:* uma setinha no rodapé da coluna (e no topo, se houver faixa em cima) alterna entre
     "coluna completa" e "faixa manda no canto". Seta aponta para onde a coluna vai crescer/encolher;
     dica em texto ("Estender até embaixo" / "Deixar a faixa passar"). Entra no Ctrl+Alt+Z (é mudança
     de layout) e fica salvo no workspace.
   - Registrar a regra genérica (cantos disputados entre coluna e faixa) na Seção IX da skill do design
     system quando implementar.

### Em aberto (responder no começo da F2c)

- **Monitores** (explicado ao usuário em 28/09): (a) mover Source + Program juntos como um bloco
  "Monitores" para coluna/faixa; (b) cada monitor sozinho em qualquer lugar. Sugestão: (a) primeiro.
- **Item 4 × âncora da Timeline:** a decisão antiga era "Timeline sempre no centro ou em janela".
  "O centro vira o que o usuário quiser" libera a Timeline para faixa/coluna também? Confirmar.

### Pontos de partida no código

- `src/ui/js/dockModel.js`: `layoutFromLegacy` / `legacyFromLayout` / `validateLayout` (+
  `tests/autoteste_dock_model.mjs`, que testa todas as combinações do legado).
- `src/ui/js/dockOps.js`: operações novas de faixa (+ `tests/autoteste_dock_ops.mjs`).
- `src/ui/js/dockDrag.js`: `resolveColumnTarget` (bordas do editor, constante `EDGE`) e a volta
  de janela destacada (`dockBack`, `homeTarget`).
- `src/ui/js/workspaceManager.js`: `setColumnLayout`, `arrangeColumnsIntoContainer`,
  `setTimelinePosition`, `reinitSplitters`, `getLegacyLayoutState`, `applyDockLayout`,
  `captureCurrentState` / `applyWorkspace` (workspaces salvos) e `applyAllCollapse`.
- CSS: `styles.css` seções "DRAG & DOCK" (pilhas F2b) e regras `.workspace:has(...)` dos divisores.

## Esta sessão (28/09): recolher painéis e janela de grupo

| Entrega | Onde |
|---|---|
| Recolher central (`setPanelCollapsed` / `isPanelCollapsed` / `applyAllCollapse`), salvo em `capiau_collapsed_panels`; **fora** do Ctrl+Alt+Z (decisão do usuário). Recolher automático do Painel Lateral sem abas (`auto: true`) não é salvo. | `workspaceManager.js`, `main.js`, `tabPanels.js`, `library.js` |
| Pilha de coluna: recolhido some, os outros ocupam o espaço, linha deitada no lugar dele; anfitrião recolhido = `dock-stack-self-collapsed`; todos recolhidos = coluna some e as linhas ficam em pé. | `applyStackCollapse`, `styles.css` |
| Janelas destacadas (simples, Janela Dupla, grupo) recolhem pelo botão e pelo Numpad, com foco nelas também (`handleWorkspaceShortcut`). Páginas expõem `capiauSetPanelCollapsed` / `capiauPanelEdge`. | `panel.html`, `panel-group.html` |
| Seta de recolher pela posição (cima/baixo empilhado, esquerda/direita lado a lado), recalculada em toda reorganização; painel sozinho numa linha da grade usa a posição da linha. | `js/panelCollapse.js` (`edgeInLine`, `visibleSplitters`) |
| Janela de grupo: arrastar a alça de um painel sobre outro **na mesma janela** troca os dois (qualquer disposição, sem recarregar, entra no desfazer). Grade com 3: seletor "Sozinho: X" + botão em cima/embaixo (salvo em `capiau_group_grid_single`). | `dockDrag.js` (`findSwapInWindow`), `workspaceManager.js` (`swapGroupPanels`, `setGroupOrder`), `panel-group.html` |

Commits: `7823b45`, `b943b27`, `4fc6402` (depois de `079b0b4`).

### Pendências anotadas nesta sessão

- Workspaces prontos (Padrão, Montagem, Decupagem, Inspetor à Direita) têm um trecho antigo que tenta
  reabrir Biblioteca/Painel Lateral recolhidos mas clica no botão de **recolher** (`toggle-*`) em vez do
  de expandir: aplicar um workspace pronto não reabre painel recolhido (`applyWorkspace`, ramo dos presets).
- Trocar painéis por arrasto só na janela de grupo; na Janela Dupla, não.
- Numa linha com 3 painéis lado a lado, a seta do painel do meio aponta para a esquerda.
- Arrasto real dentro da janela de grupo (troca) e o recolher nas janelas foram verificados com janelas
  simuladas; o usuário testou no Chrome com janelas reais e aprovou a seta.

## O que as sessões anteriores entregaram

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
(bloqueadas vão para "Restaurar janelas"); recolher é salvo mas não entra no Ctrl+Alt+Z.

Pendências conhecidas (além da F2c): F6 (escolher monitor via Window Management API, animações FLIP,
teclado/acessibilidade, Manual/Wiki cap. 03); aba destacada virar coluna no editor; rolagem infinita
da Busca destacada; só uma janela de grupo por vez; título do Painel Lateral não muda quando Falas sai.

## Testes

- Autotestes (55): `for f in tests/autoteste_*.mjs; do node $f || echo FAIL $f; done`
  (drag & dock: `autoteste_dock_{model,ops,drag,tearoff,join,group,tabs}.mjs`, `autoteste_panel_collapse.mjs`).
  **No Windows**, `autoteste_dock_drag` e `autoteste_dock_group` falham por procurar trechos com `\n`
  numa cópia de trabalho em CRLF (falso positivo, já falhavam antes). Rodar numa cópia com LF
  (como o CI) para conferir de verdade.
- Mouse real (Linux, Xvfb + xdotool + Playwright global): `scripts/dock_real_mouse_check.mjs` (F3),
  `dock_group_real_mouse_check.mjs` (F4), `dock_tabs_real_mouse_check.mjs` (F5),
  `dock_strips_real_mouse_check.mjs` (P14). Headless: `scripts/dock_collapse_check.mjs`.
- **No Windows sem Playwright:** servir `src/ui` estático (sem backend, `/api` responde `[]`) e abrir no
  navegador do app. Ele não abre janelas reais; para testar janelas destacadas, trocar `window.open`
  por um iframe na mesma origem (devolver `iframe.contentWindow` e manter `w.opener = window`): o
  Talho funciona igual (mesmo `adoptNode` e `BroadcastChannel`). Cuidado: remover o iframe dispara o
  aviso de "fechei" da página e pode reacoplar painéis.
- Local (Windows): pasta `C:\Users\FGC\dev\capiau\talho`, rodar como de costume, http://localhost:8000,
  Ctrl+F5 após atualizar; permitir pop-ups de localhost:8000.
