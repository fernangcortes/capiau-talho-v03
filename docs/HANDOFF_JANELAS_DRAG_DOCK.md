# Passagem: janelas drag & dock (F0–F5, P14, recolher, F2c parte 1) → próxima: F2c parte 2

Branch: `talho-windows-drag-dock-6mtidh` (a partir de `main`). Em 28/09 ficou **3 commits à frente do
remoto** (`34fd8a4` F2c parte 1, `0525ab6` correção do arrasto travado, e o commit desta passagem):
**não foi dado push**, confirmar com o usuário antes.

Commits no nome do autor (`fernangcortes <escrevaprofernando@gmail.com>`), **sem assinatura de IA**
(sem `Co-Authored-By`/`Claude-Session`, sem branch `claude/...`). Atenção: o `git config --global
user.email` desta máquina está `fernangcortes@users.noreply.github.com`; os commits da branch usam o
gmail. Commitar com `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL=escrevaprofernando@gmail.com` (sem mudar
a config) e mensagem por arquivo (`git commit -F`).

Plano completo, com decisões e animações: página "Talho Drag & Dock"
(https://claude.ai/artifact/SF8tDpe1VVSy4brs938X3V). O `docs/PLANO_JANELAS_DRAG_DOCK.md` é ignorado
pelo git e não existe em todas as máquinas: a página é a fonte do plano. **A página ainda não registra
a F2c parte 1**: atualizar a fase F2 (texto "F2c, próxima") e a linha "Feito:" no fim.

## Próxima sessão: F2c parte 2

O que falta das decisões da F2c (lista completa mais abaixo, "Decisões da F2c"). Ordem sugerida, do
mais usado para o mais raro, cada item com autotestes de modelo/operações antes da interface:

1. **Timeline em faixa ou coluna** (decisão 7). Caminho sugerido: a timeline vira membro de faixa
   como as laterais (`BAND_PANEL_IDS` = laterais + timeline em `normalizeBands`, hoje filtra só
   `COLUMN_IDS`), com `timelinePosition` novo `"band"` para o legado saber que ela saiu do centro.
   **Decidido (usuário, 28/09): converter** as posições antigas para faixa, mantendo o visual de hoje:
   `center` = timeline no centro (fora de faixa); `bottom-full` = faixa de baixo com os dois cantos
   `"band"`; `bottom-left` = faixa de baixo, `bl: "band"`, `br: "column"`; `bottom-right` = o espelho.
   Workspaces salvos e `capiau_timeline_position` com os valores antigos são convertidos na leitura.
   **Atalhos com o mesmo efeito de hoje:** Numpad2 = centro ↔ faixa de baixo (largura total);
   Numpad1/Numpad3 = alternar o canto esquerdo/direito da faixa da timeline ("expandir para a
   esquerda/direita"); com a timeline no centro, levam para a faixa já expandida daquele lado. O ciclo
   continua o de hoje (`toggleTimelineExpandLeft/Right`, `toggleTimelinePosition`), e os checkboxes/botões
   de expandir (modal e barra da timeline, `chk-timeline-*`, `btn-timeline-expand-*`) chamam as mesmas funções.
   **Decidido também: "coluna até o fim" vale para TODAS as colunas daquele lado do centro**, não só a
   da ponta (hoje, parte 1, `renderBands` puxa só a da ponta para `.dock-edge`). Assim "sob esquerda +
   centro" com centro, Ajustes, Painel Lateral deixa os dois em altura inteira, como hoje. Vale igual
   para as faixas de laterais da parte 1: ajustar `renderBands`/`edgeColumns` (célula da ponta com
   várias colunas e seus divisores), a prévia de `resolveSideEdgeTarget` e a Seção IX da skill.
   Cuidados: `setTimelinePosition` reposiciona a timeline sozinho (studioTop/compoundStage); o
   canvas precisa redimensionar sem piscar (Seção I.3 da skill); Numpad2/1/3 (`toggleTimeline*`).
2. **Monitores em bloco ou sozinhos** (decisão 6). A alça do bloco "Monitores" move os dois
   (lado a lado/empilhados automático continua); a alça de cada player move só ele, que vira painel
   comum (faixa, coluna, pilha?). Hoje `resolveMonitorTarget` só troca lado a lado/empilhados.
   Rever maximizar e Numpad7/9 com um monitor fora do bloco.
3. **O centro vira o que o usuário quiser** (decisão 4). Hoje `center-stage` é fixo (monitores +
   timeline). Com 1 e 2 prontos, o centro pode ficar vazio: definir o que ocupa o espaço (a coluna
   mais próxima? um lateral solto no centro?). Conversar com o usuário antes.
4. **Abas destacáveis (F5) em faixas** (decisão 2). Hoje só as três laterais entram em faixas;
   aba destacada ainda nem vira coluna no editor (pendência antiga).
5. Detalhes da parte 1: o modal "Configurar workspace" (cards de colunas) ainda mostra laterais que
   estão em faixa como colunas; teste com mouse real em Linux (`scripts/dock_bands_real_mouse_check.mjs`,
   no molde de `dock_strips_real_mouse_check.mjs`); a setinha do canto é recriada a cada
   `renderBands` (inofensivo, mas dá para reaproveitar como os divisores).

Onde mexer: `dockModel.js` (`normalizeBands`, `layoutFromLegacy`/`legacyFromLayout`), `dockOps.js`
(`moveToBand` aceita só `COLUMN_IDS`), `dockDrag.js` (`resolveTimelineTarget`, `resolveMonitorTarget`,
`resolveBandEdgeTarget`), `workspaceManager.js` (`renderBands`, `setTimelinePosition`,
`reinitSplitters`, `restorePanel` ramo da timeline/monitores).

**Regra aprendida nesta sessão:** nunca recolocar no DOM um painel que já está no lugar durante um
arrasto (a alça perde a captura do ponteiro e o arrasto trava). Usar `placeInOrder` e deixar
redesenhos para depois do soltar (`window.dockDrag.drag`).

## F2c parte 1 (28/09): faixas inteiras e cantos — feito

Laterais (Biblioteca, Ajustes, Painel Lateral) vão para uma **faixa inteira em cima e/ou embaixo**,
vários painéis por faixa, e cada canto entre coluna da ponta e faixa é escolhido no arrasto e pela seta.

| Entrega | Onde |
|---|---|
| Estado `bands { top, bottom }` + `bandCorners { tl, tr, bl, br: "band" \| "column" }` no legado; nós `role: "band"` e moldura `role: "frame"` (com `corners`) na árvore; ida e volta testada nas 4 posições da timeline. Membros de faixa ficam no fim de `columnOrder` e não ocupam coluna. | `dockModel.js` (`normalizeBands`, `hasBands`), `tests/autoteste_dock_model.mjs` 1.6 |
| Operações `moveToBand`, `moveBesideInBand`, `setCorner`; as antigas (`moveBeside`, `moveToEdge`, `stackWith`, `swapPanels`, `removeFromStack`) entendem faixas; troca coluna ↔ faixa. 186 mil estados testados. | `dockOps.js`, `tests/autoteste_dock_ops.mjs` 6–8 |
| Moldura `.dock-frame` (grade 3 × 3) em volta do `.workspace`, criada sempre (sem faixas = só o workspace, mesmo retângulo). `renderBands` roda no fim de `arrangeColumnsIntoContainer` e após destacar/voltar; leva membros para `.dock-band-row` e a coluna da ponta com canto `"column"` para `.dock-edge` (com divisor próprio). O renderizador legado (colunas, timeline, studioTop/compoundStage) não mudou. | `workspaceManager.js` (`renderBands`, `ensureDockFrame`, `edgeColumns`, `renderCornerToggles`, `setBandCorner`, `bind*Resizer`, `bindBandSplitter`) |
| Recolher na faixa (Seção IX): linha em pé no lugar, último visível ocupa o resto, divisores só entre visíveis; todos recolhidos = faixa encolhe e linhas deitam; seta esquerda/direita pela posição, sozinho na faixa = cima/baixo. | `panelPlacement` (`band`), `applyBandCollapse`, `collapseEdge` |
| Arrasto: bordas de cima/baixo do editor = faixa nova (largura inteira) ou vaga na faixa pela posição do cursor; bordas laterais com zonas na altura (ao lado da faixa = coluna até o fim; ao lado do centro = faixa passa); sobre painel de faixa: centro troca, metades põem ao lado. Timeline mede pelo `.workspace`. | `dockDrag.js` (`editorRect`, `resolveBandEdgeTarget`, `resolveSideEdgeTarget`, `bandRect`) |
| Setinha `.dock-corner-toggle` no rodapé/topo da coluna da ponta alterna o canto (desfazer + workspace). Workspaces salvos guardam `bands`/`bandCorners`; presets limpam as faixas. Tamanhos: `capiau_band_h_<edge>`, `capiau_band_w_<id>`. | `workspaceManager.js`, `styles.css` "DRAG & DOCK (F2c)" |
| Regra dos cantos registrada na Seção IX da skill do design system. | `.agents/skills/capiau-nle-design-system/SKILL.md` |
| **Correção: arrasto travado** (fantasma, sombra e rótulo presos até o F5). Causa: o painel da alça era recolocado no DOM no meio do arrasto (ex.: `renderBands` recolocava tudo sempre), a alça perdia a captura do ponteiro e o `pointerup` não chegava. Agora: `renderBands` só move o que está fora de ordem (`placeInOrder`) e espera o soltar para redesenhar; o arrasto trata `lostpointercapture` (recaptura ou segue pelo documento), ouve `pointerup` também na janela e, se o botão já estiver solto (`buttons === 0`), termina no próximo movimento. | `dockDrag.js` (`handleLostCapture`, `handleMove`), `workspaceManager.js` |

Verificado no navegador do app (estático, 1440×900): faixa embaixo e em cima, arrasto real para faixa
e troca na faixa, setinha do canto, zonas de canto na borda, recolher (um e todos), 4 posições da
timeline com faixa, recarregar, workspace salvo/padrão, destacar e voltar (janela simulada por iframe),
desfazer passo a passo até o padrão.

## F2c: decisões do usuário e como o editor era montado antes da parte 1

**Objetivo (do plano):** a animação 3 da página. Encostar um painel numa **borda do editor** cria uma
**área nova do lado inteiro** (faixa inteira embaixo/em cima, coluna na ponta), inclusive trazendo o
painel de uma janela destacada; e os **monitores podem sair do centro**. A página registra a F2 como
"F2a/F2b concluídas; em aberto: monitores fora do centro e faixa inteira nova".

### Como o editor era montado antes da parte 1 (continua valendo por baixo da moldura)

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

6. **Monitores: em bloco e sozinhos, o usuário escolhe.** Proposta de gesto: a alça do bloco
   "Monitores" (Source + Program juntos, mantendo lado a lado/empilhados automático) move os dois; a
   alça de cada player move só ele, que vira painel comum. Rever maximizar e Numpad7/9 quando um
   monitor estiver fora do bloco.
7. **Timeline pode ir para faixa ou coluna** (revoga a decisão antiga "Timeline sempre no centro ou em
   janela"). As posições atuais `bottom-left` / `bottom-right` / `bottom-full` passam a ser casos de
   faixa/canto; conferir o redimensionamento do canvas (Seção I.3 da skill) e o Numpad2/1/3.

Parte 1 seguiu esse caminho (estado primeiro, autotestes, depois interface); a parte 2 deve seguir igual.

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

## Sessão de 28/09 (manhã): recolher painéis e janela de grupo

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

Decisões do usuário que valem para o resto: Timeline pode ir para centro, faixa, coluna ou janela (desde a F2c); máx. 4 painéis
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
