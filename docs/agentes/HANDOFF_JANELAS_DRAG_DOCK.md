# Passagem: janelas drag & dock (F0–F5, P14, recolher, F2c partes 1, 2a, 2b e 2c) → próxima: F2c parte 2d (detalhes e pendências)

> **Ideia futura do usuário (28/09):** timeline "prédio", que começa em cima e continua em faixas
> abaixo (como linhas de texto), para monitores verticais e para vários editores. A timeline como
> coluna (parte 2a) é o primeiro passo: ela já ocupa a altura inteira ao lado dos monitores.

Branch: `talho-windows-drag-dock-6mtidh` (a partir de `main`). Até `02f2337` (fundo dos monitores
`#101010`, commit do usuário) está no remoto ou em commits; a F2c parte 2c (abas no editor) está na
cópia de trabalho, **sem commit** (perguntar).

Commits no nome do autor (`fernangcortes <escrevaprofernando@gmail.com>`), **sem assinatura de IA**
(sem `Co-Authored-By`/`Claude-Session`, sem branch `claude/...`). Atenção: o `git config --global
user.email` desta máquina está `fernangcortes@users.noreply.github.com`; os commits da branch usam o
gmail. Commitar com `GIT_AUTHOR_EMAIL` / `GIT_COMMITTER_EMAIL=escrevaprofernando@gmail.com` (sem mudar
a config) e mensagem por arquivo (`git commit -F`).

Plano completo, com decisões e animações: página "Talho Drag & Dock"
(https://claude.ai/artifact/SF8tDpe1VVSy4brs938X3V). O `docs/PLANO_JANELAS_DRAG_DOCK.md` é ignorado
pelo git e não existe em todas as máquinas: a página é a fonte do plano.

Servidor estático de teste: `.claude/launch.json` (fora do git) → `ui-static`, script em scratchpad de
sessão. Se sumir, recriar: http que serve `src/ui`, `/api` responde `[]`, e **a raiz `/` e caminhos sem
extensão viram `index.html` com `text/html`** (antes a raiz saía como octet-stream e o navegador baixava).

## Próxima sessão: F2c parte 2d

As decisões da F2c estão todas implementadas. Falta acabamento:

1. **Falta de espaço**: colunas demais saem da tela (laterais não encolhem; só timeline, monitores e
   abas encolhem até 200 px) e duas faixas altas numa tela baixa espremem o editor até 0 px. Pensar
   num mínimo para o editor/centro e em laterais que encolhem, ou faixas que encolhem.
2. Numpad7/9 com monitor fora do bloco (`display: none` deixa divisor sobrando): tratar como recolher.
3. Modal "Configurar workspace" (cards): mostra laterais que estão em faixa como colunas; abas em
   coluna não têm card (`columnMetadata`).
4. Teste com mouse real em Linux (`scripts/dock_bands_real_mouse_check.mjs`, no molde de
   `dock_strips_real_mouse_check.mjs`): alças dos monitores, do bloco, das abas no editor e o arrasto
   HTML5 do botão da aba. Nesta máquina o navegador do app às vezes para de desenhar (verificar pelo
   motor, como nas partes 2b/2c).
5. Destacar e voltar monitor ou aba que está numa faixa/coluna (janela real) não foi verificado.
6. Menores: setinha do canto recriada a cada `renderBands`; seletor escondido
   `select-timeline-position` vazio com a timeline numa faixa sem nome antigo.

**Regra aprendida na parte 1:** nunca recolocar no DOM um painel que já está no lugar durante um
arrasto (a alça perde a captura do ponteiro e o arrasto trava). Usar `placeInOrder` e deixar
redesenhos para depois do soltar (`window.dockDrag.drag`).

## F2c parte 2c (28/09, noite): abas destacáveis no editor — feito

Decisões do usuário: aba vai para **faixa e coluna**; sai **arrastando o botão da aba** até o editor
(e pelo botão direito); volta pelo **botão devolver e soltando a alça sobre um menu**.

| Entrega | Onde |
|---|---|
| `TAB_NAMES`/`TAB_PANEL_IDS` no modelo (painéis opcionais: fora da árvore = no menu), `PLACED_ONLY_IDS` (centro + abas: só em `columnOrder` quando coluna). `BAND_PANEL_IDS` com as abas. `validateLayout` aceita abas sem exigi-las. Autoteste confere que a lista bate com o `tabPanels.js`. | `dockModel.js`, `tests/autoteste_dock_model.mjs` 1.9, `tests/autoteste_dock_tabs.mjs` 8 |
| Operações: `panelHome` (= `panelToCenter`, aba de volta ao menu), `swapPanels`/`finalize` com as regras do centro para abas. 18 mil estados com ida e volta no modelo. | `dockOps.js`, `tests/autoteste_dock_ops.mjs` 13–14 |
| `TabPanels.syncPlaced` (via `wm.onBeforeArrange`, no começo de cada arranjo): aba no editor sai do modo convidada, monta o invólucro (`.dock-tab-in-editor`) e o "devolver" leva ao menu (`sendHome`); aba que saiu do estado volta ao menu. Volta de janela: aba do editor volta para a vaga. Convidada (P14) no editor: botão some; menu dela continua guardado. | `tabPanels.js` (`placed`, `syncPlaced`, `sendHome`, `placeInEditor`, `mountSavedStrips`) |
| Arrasto do botão da aba (HTML5): `dragover`/`drop` na janela, fora dos menus = alvo do editor com sombra (`dockDrag.showExternalTarget`); sobre um menu, reordenar/P14 como antes. **Borda do editor vence menu** (`dockDrag.isEditorEdge`, também no P14). Botão direito da faixa: "Colocar X numa faixa embaixo / como coluna". | `tabPanels.js` (`bindEditorDrop`), `tabsCustomization.js` |
| Alça da aba no editor: bordas = faixa/coluna na ponta; sobre a Biblioteca/Painel Lateral = volta para aquele menu (alvo `tabHome`); sobre painéis e o centro = troca/ao lado (`resolveSlotTarget`, compartilhado com os monitores). Laterais e timeline aceitam abas como vizinhas. | `dockDrag.js` (`resolveTabTarget`, `resolveSlotTarget`, `applyTarget`) |
| CSS da aba como coluna (altura inteira, encolhe até 200 px); largura salva em `layout-dim-splitter-tabpanel-<aba>`, também na célula da ponta. Regra na Seção IX da skill. | `styles.css`, `bindEdgeResizer`, `SKILL.md` |

Verificado (28/09) no navegador do app (estático, 1440×900), pelo motor e por eventos de arrasto
sintéticos: Chat pelo botão direito na faixa de baixo (modo largo do Chat com quadro de mídias) e Temas
como coluna; botão da aba arrastado para a borda direita em cima do Painel Lateral (coluna na ponta, não
muda de menu), para a borda de baixo (faixa nova) e sobre uma aba da faixa (ao lado); alça de Temas
solta sobre o Painel Lateral (vai para lá como convidada); "devolver" do Chat; desfazer/refazer
(botão volta ao menu e some de novo); recarregar com quatro abas no editor. Sem erro de console do
layout. Janela destacada real não verificada.

## F2c parte 2b (28/09, noite): monitores em bloco ou sozinhos, centro que some — feito

Decisões do usuário nesta sessão: monitor sozinho vai para **faixa e coluna** (como a timeline);
quando o centro esvazia, o **vizinho mais perto cresce**; a alça do bloco é **uma segunda alça no
cabeçalho do Source** (do primeiro monitor que estiver no bloco).

| Entrega | Onde |
|---|---|
| `CENTER_PANEL_IDS` (timeline + monitores) e `BAND_PANEL_IDS` com os monitores. Monitor fora do bloco = numa faixa ou em `columnOrder` (nunca em pilha; faixa vence coluna). Árvore: nó `monitors` só com os que ficaram (pode ficar vazio e guarda a orientação); nó `center` pode ficar vazio. `legacyFromLayout` confere cada monitor num lugar só. | `dockModel.js`, `tests/autoteste_dock_model.mjs` 1.8 |
| Operações `panelToCenter` (timeline ou monitor de volta ao centro/bloco), `isPlaced`, `monitorsInBlock`, `centerContent`, `moveBlock` (centro muda de vaga nas colunas ou os monitores do bloco vão juntos para uma faixa). `swapPanels` vale para timeline e monitores (só fora do centro, sem pilha). 46 mil estados testados, com ida e volta no modelo. | `dockOps.js`, `tests/autoteste_dock_ops.mjs` 11–12 |
| `renderMonitorPlacement`: monitores do bloco voltam ao `.monitors-container` (Source antes de Program), sem a largura de coluna; sozinho no bloco ocupa tudo; fora do bloco `.dock-monitor-out` (desmaximiza). `refreshCenterContent`: `.center-no-monitors` (timeline ocupa a altura toda, sem o divisor monitores/timeline) e `.center-empty` (centro some). `body.layout-monitors-split` esconde maximizar/trocar. | `workspaceManager.js`, `styles.css` |
| Centro vazio: `growingColumn` escolhe a vizinha que cresce (`.dock-growing`; de conteúdo antes de lateral; empate, esquerda) e os divisores redimensionam para fora dela. Monitor como coluna: divisor próprio (`layout-dim-splitter-<id>`, padrão 480 px, mín. 200, encolhe). Altura da timeline ao sair de um centro sem monitores = a salva (não a do centro inteiro). | `reinitSplitters`, `currentTimelineHeight`, `bindEdgeResizer` |
| Arrasto do monitor: sobre o outro monitor do bloco = orientação (fora do bloco, volta assim); bordas = faixa/coluna na ponta (com cantos); fora do bloco sobre o centro = volta ao bloco; sobre painel de faixa ou coluna = troca (meio) ou ao lado (metades); no bloco sobre o centro = vira coluna ao lado. Laterais e timeline também vão ao lado de/trocam com monitor fora do bloco. | `dockDrag.js` (`resolveMonitorTarget`, `resolveColumnTarget`, `resolveTimelineTarget`) |
| Alça do bloco `.dock-handle-block` (ícone de colunas) logo depois da ⋮⋮ do primeiro monitor do bloco (`placeBlockHandle`, não mexe durante arrasto). Bordas de cima/embaixo = faixa; esquerda/direita = centro na ponta; sobre coluna = à esquerda/direita dela. Fora do editor não faz nada (o bloco não vira janela). | `dockDrag.js` (`injectHandles`, `resolveBlockTarget`), `styles.css` |
| Volta de janela destacada: painel de faixa (inclusive monitor) volta para a vaga dele. Cards do modal de colunas com Source/Program. Regra registrada na Seção IX da skill. | `restorePanel`, `columnMetadata`, `SKILL.md` |
| **Correção (pedido do usuário): Source destacado abria "Identificar Elemento" ao clicar.** Desenhar caixa no vídeo, arrastar a barra de tempo (Source e Program) e mover/redimensionar a imagem no Program ouviam `mousemove`/`mouseup` no `document` da janela principal; na janela destacada o soltar nunca chegava, a caixa ficava presa (tracejados) e esticava ao passar pela principal, virando "caixa desenhada". Agora ouvem no documento do clique (`ownerDocument`). Depois: com o vídeo tocando, clicar não pausava (a camada de rostos some nos quadros sem rosto e o clique cai no contêiner, cujo play/pause procurava vídeo e botão na janela principal); agora usa o documento do contêiner e ignora cliques da camada de rostos (antes, com ela visível, os dois alternavam e o clique se anulava). Verificado com o Source num iframe registrado como janela destacada. | `player.js` (`onMouseDown`/`onMouseUp` do Source, `startScrubberDrag` x2, arrasto do Program), `workspaceManager.js` (`setupPlayerClickHandlers`) |

Verificado (28/09) no **navegador do app** (estático, 1440×900), pelo motor do arrasto
(`dockDrag.resolveTarget` no ponto + `applyTarget`, o mesmo caminho do soltar; o painel parou de
desenhar e não deu para usar o mouse): Program para a borda direita (coluna), Source sobre a metade
esquerda do centro (coluna), Source de volta sobre o centro, Program sobre a borda de baixo do Source
(volta empilhado); bloco na ponta esquerda, à direita da Biblioteca e na faixa de baixo; desfazer passo
a passo; Source numa faixa + Program coluna + timeline numa faixa (centro vazio, vizinho cresce) e
recarregar. Sem erro de console do layout.

### Pendências da parte 2b

- Com duas faixas altas numa tela baixa, o `.workspace` pode ficar com 0 px de altura (faixas têm
  altura fixa). Pensar num mínimo para o editor ou em faixas que encolhem.
- Numpad7/9 escondem o monitor com `display: none` onde ele estiver; como coluna, o divisor ao lado
  fica sobrando. Tratar como recolher (linha no lugar) ou tirar o divisor.
- Destacar e voltar um monitor que está numa faixa/coluna não foi verificado na tela (o ramo do
  `restorePanel` é o mesmo das laterais).
- Arrasto real com mouse das alças dos monitores e do bloco não verificado (só pelo motor).

## F2c parte 2a (28/09, tarde): timeline em faixa ou coluna — feito

A timeline fica embaixo dos monitores, numa faixa (em cima ou embaixo, sozinha ou com laterais) ou
como coluna do editor (pedido do usuário, base da futura timeline "prédio").
As posições antigas viraram faixa de baixo + cantos, com o mesmo desenho e os mesmos atalhos.
"Coluna até o fim" passou a valer para todas as colunas daquele lado do centro.

| Entrega | Onde |
|---|---|
| Timeline entra em faixa (`BAND_PANEL_IDS` = laterais + timeline), nunca em `columnOrder`. `timelinePosition` agora é `"center"` \| `"band"` e sai das faixas (`storeBands`). `convertTimelinePosition` converte as antigas: `bottom-full` = faixa de baixo com `bl`/`br` `"band"`; `bottom-left` = `bl` `"band"`, `br` `"column"`; `bottom-right` = o espelho (timeline entra na frente de quem já estiver na faixa de baixo). Vale para `capiau_timeline_position` salvo, workspaces salvos, presets (Montagem) e histórico antigo (árvores com a timeline embaixo continuam sendo lidas). | `dockModel.js`, `tests/autoteste_dock_model.mjs` 1.1 e 1.7 |
| Operações `placeTimeline` (nomes antigos → faixa/cantos), `timelineToCenter`, `toggleTimelineSide` (Numpad1/3: mesmo ciclo de antes, testado posição a posição), `timelineExpanded`. A timeline não vai para a ponta, não fica ao lado de coluna, não troca com coluna nem empilha; dentro das faixas troca e fica ao lado normalmente. 270 mil estados testados. | `dockOps.js`, `tests/autoteste_dock_ops.mjs` 9–10 |
| Renderizador: `setTimelinePosition` aceita os nomes antigos e vira `placeTimeline` + `setColumnLayout`; `renderTimelinePlacement` põe a timeline embaixo dos monitores (na faixa quem a leva é o `renderBands`). **Removido o renderizador antigo** (`studioTop`/`compoundStage`, ramos `bottom-*` de `setTimelinePosition` e `reinitSplitters`). Classe `layout-timeline-band` + `layout-timeline-expanded` no body; `studio` não é mais posta (virava o editor em coluna). Larguras das laterais do lado por onde a timeline passa continuam nas chaves `studio-*`, como antes. | `workspaceManager.js` |
| Altura vai junto: faixa nova só com a timeline = altura dela + 5px do divisor; de volta ao centro, a altura salva de lá (`keepTimelineHeight`, `loadTimelinePosition`). Divisor da faixa redesenha o canvas a cada quadro (rAF, Seção I.3) e o duplo clique nele ajusta às pistas (`fitTimelineHeightToTracks` sabe mexer na faixa). Workspace salvo guarda `capiau_band_h_top/bottom`. | `bindBandResizer`, `fitTimelineHeightToTracks`, `captureCurrentState` |
| Coluna até o fim = **lado inteiro**: `sideColumns()` e a célula `.dock-edge` leva todas as colunas daquele lado, com `.dock-edge-splitter` entre elas (redimensiona a de fora; some se uma das duas estiver recolhida) e o `.dock-edge-resizer` na vizinha do centro. Setinha do canto na coluna da ponta ou, recolhida, na próxima aberta. | `renderBands`, `renderCornerToggles`, `bindEdgeResizer`, `refreshEdgeSplitters`, `styles.css` |
| Recolher a timeline numa faixa: `isPanelCollapsed("timeline-panel")` lê a classe dela; linha `#reopen-timeline` em pé no lugar (deitada quando todos da faixa estão recolhidos); `main.js` chama `applyAllCollapse` ao recolher/expandir a timeline. | `applyBandCollapse`, `applyAllCollapse`, `main.js`, `styles.css` |
| Arrasto da timeline: bordas de cima/embaixo da moldura = faixa (nova ou vaga), sobre lateral de faixa = trocar/ao lado; parte de baixo do editor = as posições de antes (sob os monitores, sob esquerda + centro, sob centro + direita). Laterais podem ir ao lado da timeline na faixa. Alvo `type: "timeline"` saiu: tudo é `type: "columns"`. | `dockDrag.js` (`resolveTimelineTarget`, `resolveColumnTarget`) |
| Volta da janela destacada: timeline volta para a vaga dela na faixa (a faixa some enquanto ela está fora). | `restorePanel` |
| **Timeline como coluna:** entra em `columnOrder` (nunca em pilha); `timelinePosition` `"column"`, derivado das faixas e de `columnOrder` (`deriveTimelinePosition`; faixa vence coluna). `moveToEdge`/`moveBeside` aceitam a timeline; `swapPanels` troca timeline com coluna ou faixa, mas não com membro de pilha nem estando ela embaixo dos monitores; `placeTimeline(state, "column")` = onde já está ou à direita do centro. 380 mil estados testados. | `dockModel.js`, `dockOps.js`, testes 1.7 e 9–10 |
| Coluna na tela: largura pelo divisor (`splitter-timeline-panel`, padrão 420 px), altura inteira, única coluna que encolhe (mín. 200 px; em 1424 px, 5 colunas com larguras padrão não cabem e a última sai da tela: é falta de espaço, mover laterais para faixas). Linha de expandir em pé; recolhida some. Vai para a célula da ponta com as laterais do lado dela. Ajustar às pistas não faz nada na coluna. Menu de posição ganhou "Timeline: Coluna"; card da timeline no modal de colunas. | `workspaceManager.js` (`reinitSplitters`, `renderTimelinePlacement`, `renderBands`), `styles.css` |
| Arrasto da timeline: bordas esquerda/direita = coluna na ponta (com zonas de canto); na parte de cima do editor, sobre coluna ou centro = coluna ao lado (metades) ou troca (meio da coluna). Laterais vão ao lado da timeline coluna ou trocam com ela. | `dockDrag.js` (`resolveTimelineTarget`, `resolveTimelineColumnTarget`) |
| Regras novas na Seção IX da skill (lado inteiro, timeline em faixa ou coluna, exceção do `isPanelCollapsed`). | `.agents/skills/capiau-nle-design-system/SKILL.md` |

Verificado (28/09) no **Chrome headless via DevTools Protocol** (o navegador do app negou `localhost`
nesta sessão): conversão de `bottom-left` salvo ao abrir; ciclo Numpad1/3/2 completo (formas, alturas
320/325 px, canvas = contêiner); arrasto real da timeline para a faixa de cima e de Ajustes para o
lado dela; recolher a timeline na faixa; desfazer passo a passo; arrastar o divisor da faixa (canvas
certo **no meio** do arrasto) e duplo clique; workspace salvo antigo (`bottom-right`), Montagem e
Padrão; salvar workspace; destacar e voltar (janela simulada por iframe); lado inteiro com Biblioteca
recolhida; sem erro de console do layout. Timeline como coluna: arrasto para a borda direita, Ajustes
para a faixa de baixo, Painel Lateral trocando com a timeline, recolher, canto `br` "column" (timeline +
Painel Lateral até embaixo), desfazer, arrastar de volta para baixo dos monitores (volta com 300 px),
recarregar e workspace salvo. Como repetir: servir `src/ui` estático (configuração
`ui-static` do `.claude/launch.json` aponta para um script de scratchpad de outra sessão; se sumir,
recriar: http que devolve `[]` em `/api`), abrir o Chrome com `--headless=new
--remote-debugging-port=9333 --user-data-dir=<pasta temporária>` e mandar `Page.navigate`,
`Runtime.evaluate` e `Input.dispatchMouseEvent` pelo WebSocket de `http://127.0.0.1:9333/json`.

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

Decisões do usuário que valem para o resto: Timeline pode ir para centro, faixa, coluna ou janela (desde a F2c; feito na parte 2a); máx. 4 painéis
por janela; soltar no centro = trocar; Chrome principal mas funcionar nos outros; Source/Program
separados; arrastar pela alça; muda na hora com Ctrl+Z e restaurar padrão; janelas reabrem sozinhas
(bloqueadas vão para "Restaurar janelas"); recolher é salvo mas não entra no Ctrl+Alt+Z.

Pendências conhecidas (além da F2c): F6 (escolher monitor via Window Management API, animações FLIP,
teclado/acessibilidade, Manual/Wiki cap. 03); aba destacada virar coluna no editor; rolagem infinita
da Busca destacada; só uma janela de grupo por vez; título do Painel Lateral não muda quando Falas sai.

## Testes

- Autotestes (55): `for f in tests/autoteste_*.mjs; do node $f || echo FAIL $f; done`
  (drag & dock: `autoteste_dock_{model,ops,drag,tearoff,join,group,tabs}.mjs`, `autoteste_panel_collapse.mjs`).
  **No Windows**, `autoteste_dock_group` falha por procurar trechos com `\n` em `panel.html` numa
  cópia de trabalho em CRLF (falso positivo, já falhava antes). Rodar numa cópia com LF (como o CI)
  para conferir de verdade. Em 28/09 à tarde todos os outros passaram.
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
