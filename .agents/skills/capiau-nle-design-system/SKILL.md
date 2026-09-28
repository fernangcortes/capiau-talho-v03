---
name: capiau-nle-design-system
description: Diretrizes do design system flat, layout sem espaços (seamless), sidebars adaptativas, selects premium, controles numéricos, retração universal por duplo clique, contêineres de painéis (recolher, setas e troca de lugar em pilhas, faixas e janelas) e motor global de tooltips para a interface clássica NLE do CapIAu.
---

# Design System Flat & Seamless NLE - CapIAu

Este guia orienta futuros agentes de IA e desenvolvedores a manterem e expandirem a consistência visual, usabilidade e aproveitamento máximo de tela na interface clássica de edição de vídeo (NLE) do **CapIAu**.

---

## I. Estrutura de Layout e Workspace (Layout & Workspace)

### 1. Visual Sem Espaços (Seamless Layout)
* **Objetivo:** Aproveitar 100% da área da tela eliminando gaps, paddings desnecessários, rodapés estáticos e bordas duplicadas.
* **Diretrizes:**
  * Painéis e seções contíguos na grade principal devem ter `border-radius: 0;` e `border: none;` (encostados uns nos outros).
  * A separação entre painéis deve ser feita unicamente por splitters sutis de redimensionamento (`.panel-splitter` de 4px) ou bordas de vidro discretas (`1px solid var(--border-glass)`).
  * O workspace principal (`.workspace`) deve usar `padding: 0; gap: 0;` e preencher toda a altura disponível.
  * **Eliminação de Rodapés Inúteis:** Evitar barras de status estáticas ou avisos no rodapé (como "Pronto.") que consomem espaço vertical sem agregar valor funcional. O espaço inferior dos painéis deve ser inteiramente reservado ao conteúdo scrollável.

### 2. Linhas Restauradoras para Painéis Retráteis (Restore Lines)
* **Objetivo:** Oferecer um mecanismo de reabertura não-invasivo, fino e integrado ao layout flex para qualquer painel, sidebar, aba ou janela que possua funcionalidade de show/hide (retração). A linha deve ser sempre visível e acessível sem sobrepor o conteúdo principal.
* **Padrão Visual:**
  * Quando um painel retrátil é colapsado (largura ou altura vai para `0px`), uma **linha finíssima de 4px** aparece exatamente no local onde o painel ficava, inserida diretamente no fluxo flexbox (nunca com `position: absolute`).
  * A linha usa cores temáticas translúcidas de acordo com o grupo funcional do painel:
    * **Violeta/Roxo** (`rgba(139, 92, 246, ...)`) — para barras de ferramentas e toolbars.
    * **Ciano** (`rgba(6, 182, 212, ...)`) — para cabeçalhos de pistas, headers e abas de navegação.
    * **Rose** (`rgba(244, 63, 94, ...)`) — para painéis de configuração ou elementos destrutivos.
    * **Emerald** (`rgba(16, 185, 129, ...)`) — para painéis de mídia ou saída.
  * A linha possui `data-tooltip` explicando sua função (ex: "Expandir Barra de Ferramentas").
* **Regra Crítica — Largura Fixa (Anti-Flicker):**
  * A largura da linha **NUNCA deve mudar no hover**. Alterar a largura de um elemento no fluxo flex causa layout shifts que disparam `ResizeObserver` em canvas e redimensionam painéis adjacentes, gerando um efeito de "piscar" (flicker) visível ao usuário.
  * No hover, apenas propriedades **visuais** devem mudar: `background` (mais opaco) e `box-shadow` (glow). A propriedade `width` deve ser omitida da `transition`.
* **CSS de Referência:**
  ```css
  .restore-line {
      width: 4px;
      height: 100%;
      background: rgba(COR_TEMATICA, 0.15);
      border-right: 1px solid rgba(COR_TEMATICA, 0.3);
      cursor: pointer;
      z-index: 100;
      transition: background 0.2s, box-shadow 0.2s;  /* SEM width */
      flex-shrink: 0;
  }
  .restore-line:hover {
      background: rgba(COR_TEMATICA, 0.85);
      box-shadow: 0 0 10px rgba(COR_TEMATICA, 0.6);
  }
  ```
* **HTML de Referência:**
  ```html
  <!-- Inserir DENTRO do contêiner flex, na posição exata onde o painel ficava -->
  <div id="reopen-NOME" class="NOME-restore-line" data-tooltip="Expandir NOME_DO_PAINEL" style="display: none;"></div>
  ```
* **JavaScript de Referência:**
  ```javascript
  // Ao colapsar o painel:
  painel.classList.add("collapsed");
  linhaRestauradora.style.display = "block";
  window.dispatchEvent(new Event("resize"));

  // Ao clicar na linha para restaurar:
  linhaRestauradora.addEventListener("click", () => {
      painel.classList.remove("collapsed");
      linhaRestauradora.style.display = "none";
      window.dispatchEvent(new Event("resize"));
  });
  ```
* **Posicionamento no DOM:**
  * A linha restauradora deve ser um **irmão direto** no mesmo contêiner flex do painel colapsado, posicionada **do lado para onde o painel recolhe** (antes dele se recolhe para a esquerda/cima, depois se recolhe para a direita/baixo). Painéis dentro de pilhas, faixas e janelas com vários painéis seguem a Seção IX.
  * **Nunca usar `position: absolute`** — isso causa sobreposições, problemas de z-index e inacessibilidade quando múltiplos painéis estão colapsados simultaneamente.
  * O painel colapsado deve usar `width: 0px !important; opacity: 0; pointer-events: none;` com transição suave.

### 3. Motor de Divisores (Splitters) e Redimensionamento Contínuo de Canvas (Anti-Flicker & Anti-Stretch)
* **Objetivo:** Permitir redimensionamento contínuo fluido (vertical e horizontal) de painéis e timelines sem que o canvas de edição pisque, suma ou sofra estiramento (stretch) bitmap.
* **Diretrizes Arquiteturais Mandatórias:**
  1. **Preservação de Escala 1:1 (Anti-Stretch):**
     * O buffer interno do `<canvas>` (`width` e `height`) deve sempre acompanhar rigorosamente os pixels físicos reais da viewport (`rect.width * dpr` e `rect.height * dpr`).
     * **PROIBIÇÃO ESTRITA:** Nunca congele o buffer do canvas durante o arrasto permitindo que o CSS o estique. Isso deforma textos, formas e descalibra a precisão temporal matemática de frames e réguas.
  2. **Redesenho Síncrono Imediato (Anti-Blank Frame):**
     * Como a especificação HTML5 do Canvas limpa imediatamente a memória da GPU para transparente ao reatribuir `width` ou `height`, o método `resize()` **DEVE chamar `this.draw()` de forma síncrona** logo após o `ctx.scale(dpr, dpr)`.
     * Nunca dependa apenas de `requestRedraw()` assíncrono durante redimensionamentos contínuos.
  3. **Guarda de Dimensões Reais:**
     * Antes de reatribuir `canvas.width` ou `canvas.height`, calcule `targetW = Math.round(rect.width * dpr)` e `targetH = Math.round(rect.height * dpr)`. Se forem idênticos aos atuais, **não toque no canvas**.
  4. **Throttling via `requestAnimationFrame` no Splitter:**
     * Ouvintes de `mousemove` em divisores arrastáveis devem coalescer atualizações dentro de um `requestAnimationFrame`, sincronizando o layout com a taxa nativa do monitor (60/120/144 Hz) e evitando layout thrashing.
  5. **Desacoplamento do `ResizeObserver`:**
     * O `ResizeObserver` deve monitorar unicamente o elemento pai direto (`.timeline-canvas-container`).
     * **NUNCA observar a própria tag `<canvas>`**, pois alterar seus atributos físicos dispara novos eventos de resize em cascata.
  6. **Adaptação Dinâmica Contínua de Monitores:**
     * Ao redimensionar a timeline, sidebars ou a janela, o modo automático (`monitorsLayout: "auto"`) deve continuar avaliando a proporção útil e alternando entre Lado a Lado e Empilhados em tempo real durante o arrasto.
     * Apenas o divisor interno entre os próprios monitores (`.splitter-players` / `.splitter-studio-players`) deve suspender a alternância enquanto estiver ativo sob o cursor.

---

## II. Diretrizes dos Menus Laterais (Sidebars)

### 4. Layout Adaptativo de 3 Níveis & Estabilidade Vertical
* **Objetivo:** Responder reativamente à largura horizontal das abas laterais mantendo a estabilidade vertical absoluta e evitando quebras de texto em múltiplas linhas.
* **Estados e Limites:**
  1. **Normal (Largura $\ge 320\text{px}$):** Exibe ícones e textos lado a lado. Sliders expandem-se de forma ampla (`width: 180px - 240px`).
  2. **Compacto ($320\text{px} >$ Largura $\ge 240\text{px}$):** Oculta textos de abas e botões secundários. Mantém rótulos dos efeitos visíveis à esquerda e ajusta sliders para tamanho médio (`width: 115px - 135px`).
  3. **Mínimo (Largura $< 240\text{px}$):** Oculta os textos dos cabeçalhos dos painéis e rótulos de sliders padrão (centralizando os controles). As transições mantêm rótulos visíveis.
* **Regra Crítica — Estabilidade Vertical (Anti-Vertical-Jump):**
  * O padding/margin **vertical** dos cabeçalhos (`.sidebar-header`), abas (`.media-tabs`) e barras de ferramentas deve permanecer **rigorosamente congelado e idêntico** em todos os 3 estados (ex: padding vertical de 8px e margens verticais de 8px/6px).
  * Ao redimensionar a sidebar horizontalmente, apenas as larguras e visibilidades horizontais se adaptam. Nenhum elemento ou linha deve "pular" ou mudar sua posição vertical.
* **Scrollbars Invisíveis nas Sidebars:**
  * As barras de rolagem visuais nas sidebars e painéis internos devem ser mantidas **invisíveis** para economizar espaço horizontal e garantir bordas limpas:
    ```css
    .sidebar-left, .sidebar-left .scrollable, .sidebar-left .tab-content {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
    }
    .sidebar-left::-webkit-scrollbar, .sidebar-left .scrollable::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
    }
    ```
  * A funcionalidade de rolagem via wheel, trackpad e touch permanece 100% funcional.

### 5. Abas Customizáveis dos Menus Laterais (Sidebar Tabs)
* **Objetivo:** Permitir ao usuário reordenar as abas livremente por arrasto (drag and drop) e controlar a visibilidade de cada uma (show/hide), mantendo a integridade da interface clássica de edição.
* **Diretrizes:**
  * **Visualização Baseada em Estados (3 Níveis):**
    * **Normal (Largura $\ge 320\text{px}$):** Exibe **apenas o texto** da aba. Os ícones devem ser ocultados com a regra:
      ```css
      .sidebar-normal .media-tabs .tab-btn i {
          display: none !important;
      }
      ```
    * **Compacto / Mínimo (Largura $< 320\text{px}$):** Exibe **apenas o ícone** da aba. Os textos são ocultados com `display: none !important`.
  * **Intercambialidade (Drag & Drop):**
    * Todos os botões de aba (`.tab-btn`) devem conter o atributo `draggable="true"`.
    * A reordenação deve ser processada dinamicamente no DOM no evento `dragover` do contêiner `.media-tabs` (`#left-tabs` e `#right-tabs`).
    * A ordenação deve ser persistida localmente com chaves `left-tabs-order` e `right-tabs-order`.
  * **Visibilidade Dinâmica (Show/Hide):**
    * O clique com o botão direito (`contextmenu`) na barra de abas deve abrir um menu de contexto customizado (`.custom-context-menu`) listando todas as abas com checkboxes.
    * A visibilidade deve ser persistida com chaves `left-tabs-visibility` e `right-tabs-visibility`.
    * **Troca de Foco:** Se o usuário desativar a visibilidade da aba que está ativa no momento, a aplicação deve selecionar reativamente a primeira aba visível restante no menu correspondente.

### 6. Botões de Ação Flat na Sidebar
* **Objetivo:** Manter a interface limpa e profissional nas barras laterais, removendo caixas (boxes) dos botões de ação e ferramentas.
* **Diretrizes:**
  * Botões de ação rápida nas sidebars (como os de Transcrição e Chat) e nos rodapés dos players (Play, IN/OUT, Inserir) não devem ter caixas sólidas, bordas ou preenchimentos opacos.
  * Devem usar fundo transparente (`background: transparent !important`) e borda nula (`border: none !important`).
  * **Hover Effects:** Sob hover, devem brilhar com suas respectivas cores temáticas:
    * **Controles de Seleção e Biblioteca:** Ciano (`var(--color-cyan)`) ou texto em branco com glow do ciano (`text-shadow: 0 0 8px var(--color-cyan)` para o botão *IN*).
    * **Ações de Edição e Timeline:** Violeta (`var(--color-violet)`) ou rosa (`var(--color-rose)` / glow rosa para o botão *OUT*).
    * **Efeito Hover Geral:** Aumentar ligeiramente o tamanho (`transform: scale(1.05)` ou `scale(1.1)`).

---

## III. Componentes de Controle & Ação (UI Controls & Behavior)

### 7. Caixas de Seleção Premium (Selects & Options)
* **Objetivo:** Evitar que o Windows ou navegadores renderizem menus suspensos brancos e boxy que contrastam com o tema dark/glassmorphic.
* **Diretrizes:**
  * Todos os `<select>` nativos ou com a classe `.nle-select` devem usar fundo escuro translúcido, bordas glass, fonte `Outfit` e um chevron de seta em SVG customizado integrado ao background (roxo por padrão, ciano para resolução).
  * **Elemento Option:** Estilizar obrigatoriamente a tag `select option` globalmente com fundo escuro (`background-color: #121218 !important`) e texto claro (`color: #e2e8f0 !important`).
  * **Selects Aninhados:** Elementos de seleção contidos dentro de outros wrappers glassmorphic (como as classes `.project-area`, `.search-area` ou `.dropdown-wrapper`) devem ser transparentes e sem borda para evitar caixas e contornos duplicados.

### 8. Motor de Tooltips Globais (JavaScript)
* **Objetivo:** Impedir que tooltips nativas do navegador (`title`) apareçam e garantir que tooltips customizadas nunca cortem nas laterais ou fiquem atrás de painéis com `overflow: hidden`.
* **Diretrizes:**
  * **Sem Pseudo-Elementos:** Não utilizar tooltips baseadas em CSS pseudo-elementos (`::after`) em elementos móveis, pois eles serão fisicamente cortados pelas bordas do painel pai.
  * **Motor Global:** Utilizar o elemento fixo `#global-tooltip` anexado à raiz do `body` e controlado por JavaScript.
  * **Prevenção de Colisões:**
    * **Vertical:** A tooltip se projeta acima do elemento por padrão. Caso passe do topo da janela (Y < 8px), ela se inverte automaticamente para baixo.
    * **Horizontal:** Caso atinja os cantos laterais esquerdo ou direito do navegador, o script limita seu valor horizontal em pixels para mantê-la visível na tela.
  * **Injeção Dinâmica, Sliders & Abas:** O `MutationObserver` em `main.js` intercepta qualquer injeção HTML dinâmica e converte automaticamente tags `title` em atributos `data-tooltip`. Para sliders de controle (`input[type="range"]`), a tooltip deve ser exibida **exclusivamente no estado mínimo** (largura $< 240\text{px}$) onde os nomes dos efeitos são ocultados. Para abas da biblioteca e sidebars (`.tab-btn`), as tooltips são mantidas **exclusivamente nos estágios compacto e mínimo** (onde são exibidos apenas os ícones de linha). No estágio normal (largura $\ge 320\text{px}$), onde os nomes das abas (ex: "Vídeos", "Fotos", "Temas") já são totalmente visíveis por extenso, as tooltips são dispensadas.

### 9. Sliders de Controle Proporcionais (Range Inputs)
* **Objetivo:** Oferecer precisão de ajuste proporcional à largura disponível do painel, garantindo responsividade sem sacrificar usabilidade.
* **Diretrizes de Dimensionamento:**
  * **Estado Normal ($\ge 320\text{px}$):** Sliders amplos com `width: 180px` a `240px` (`flex: 1`), aproveitando a largura expansiva do menu.
  * **Estado Compacto ($240\text{px} >$ Largura $\ge 240\text{px}$):** Sliders médios com `width: 115px` a `135px`, mantendo os rótulos de efeito visíveis à esquerda.
  * **Estado Mínimo (Largura $< 240\text{px}$):** Sliders compactos com `max-width: 120px` centralizados e rótulos ocultados.

### 10. Entradas Numéricas Flat & Steppers Minimalistas (Number Inputs)
* **Objetivo:** Eliminar caixas opacas e botões de incremento brancos do navegador, criando controles numéricos integrados ao tema dark.
* **Diretrizes:**
  * **Remoção de Spin-Buttons Nativos:** Ocultar obrigatoriamente os botões nativos dos navegadores:
    ```css
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button {
        -webkit-appearance: none !important;
        margin: 0 !important;
    }
    input[type="number"] {
        -moz-appearance: textfield !important;
    }
    ```
  * **Padrão Visual:** Renderizar o valor numérico em texto flat ciano sem caixa (`background: transparent; border: none`), seguido da unidade (ex: `s`, `%`, `px`), e acompanhado de traços minimalistas de incremento/decremento (`.btn-fade-step` com ícones `fa-chevron-up`/`down` translúcidos) posicionados **após a unidade**.

---

## IV. Reprodutor de Vídeo (Video Player)

### 11. Players Limpos com Controles em Hover
* **Objetivo:** Sempre que um player de vídeo (`.player-panel`) for construído ou reaproveitado em um layout novo, ele deve priorizar a exibição do vídeo — cabeçalho e barra de controles não devem competir visualmente com a imagem quando o usuário não está interagindo com aquele player específico.
* **Diretrizes:**
  * O contêiner do player (`.player-panel`) precisa de `position: relative;` para servir de referência aos overlays.
  * `.player-header` e `.player-controls` tornam-se overlays absolutos (`position: absolute; left: 0; right: 0;`), um ancorado no topo (`top: 0`) e outro na base (`bottom: 0`), com `z-index` acima do vídeo.
  * Estado padrão: `opacity: 0; pointer-events: none;` — o vídeo ocupa 100% do painel sem faixas nem botões visíveis.
  * No hover do painel (`.player-panel:hover .player-header`, `.player-panel:hover .player-controls`): `opacity: 1; pointer-events: auto;`, com `transition: opacity 0.2s ease;` (sem transição de layout/altura, só opacidade).
  * Usar gradiente sutil por trás dos controles para garantir legibilidade sobre qualquer imagem, nunca um fundo opaco sólido: `linear-gradient(to bottom, rgba(0,0,0,.55), transparent)` no header e `linear-gradient(to top, rgba(0,0,0,.6), transparent)` nos controles.
  * Remover o cap de altura do vídeo (`max-height`) nesses contextos — o vídeo deve preencher todo o painel, já que não há mais cabeçalho/controles ocupando espaço fixo no fluxo.
* **Referência de implementação:** ver o layout "Estúdio" (`body.studio .player-panel/.player-header/.player-controls` em `styles.css`), que reaproveita esse padrão para os monitores Source/Program empilhados.

---

## V. Animações de Botão, Spinners & Notificações (Animations & Feedback)

### 12. Animação de Botões de Ação com Spinner em Linha & Toast NLE
* **Objetivo:** Fornecer feedback visual tátil instantâneo durante operações assíncronas (como definir miniatura, exportar, reprocessar ou salvar), transformando ícones flat de linha em spinners com transições suaves e avisos em estilo glassmorphism.
* **Diretrizes de Micro-Interação:**
  1. **Animação de Clique (Pulse):** Ao clicar no botão, ele aplica imediatamente uma animação sutil de compressão e expansão (`transform: scale(0.85)` → `scale(1)` em 250ms) via classe `.btn-thumb-click-pulse`.
  2. **Transformação do Ícone em Spinner:** O ícone original (ex: `<i class="fa-solid fa-camera"></i>`) é preservado na memória JS, o botão tem `disabled = true` e seu conteúdo interno é substituído pelo spinner em linha: `<i class="fa-solid fa-circle-notch fa-spin"></i>`.
  3. **Transição de Sucesso (Checkmark):** Assim que a promessa resolve com sucesso, o ícone muda temporariamente para o checkmark ciano: `<i class="fa-solid fa-check" style="color: var(--color-cyan);"></i>`.
  4. **Notificação Toast Glassmorphic (`window.showToast`):** Emite um toast flutuante no canto inferior direito com animação de slide-in, borda ciano/glass, efeito `backdrop-filter: blur(12px)` e auto-dismiss em 2.2s.
  5. **Restauração Automática:** Após 1.2 segundos da conclusão, o ícone original é restaurado e o botão é reabilitado.
* **CSS de Referência:**
  ```css
  @keyframes thumbClickPulse {
      0% { transform: scale(1); }
      40% { transform: scale(0.82); }
      100% { transform: scale(1); }
  }
  .btn-thumb-click-pulse {
      animation: thumbClickPulse 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .nle-toast {
      position: fixed;
      bottom: 24px; right: 24px;
      background: rgba(18, 18, 24, 0.95);
      color: #ffffff;
      border: 1px solid rgba(6, 182, 212, 0.4);
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 11px;
      font-family: 'Outfit', sans-serif;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      animation: nleToastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }
  ```
* **JavaScript de Referência (Substituição de Ícone em Linha):**
  ```javascript
  const origHtml = triggerBtn.innerHTML;
  triggerBtn.classList.add("btn-thumb-click-pulse");
  triggerBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  triggerBtn.disabled = true;

  try {
      const ok = await executaOperacao();
      if (ok) {
          triggerBtn.innerHTML = '<i class="fa-solid fa-check" style="color: var(--color-cyan);"></i>';
          window.showToast("Operação concluída com sucesso!", "success");
      }
  } finally {
      setTimeout(() => {
          triggerBtn.innerHTML = origHtml;
          triggerBtn.disabled = false;
          triggerBtn.classList.remove("btn-thumb-click-pulse");
      }, 1200);
  }
  ```

### 13. Motor Global de Tooltips & Rolagem Fluida sem Scrollbars Visíveis
* **Objetivo:** Garantir que tooltips nunca obstruam ferramentas de trabalho adjacentes e que sidebars e toolbars mantenham estética 100% clean sem barras de rolagem roubando pixels úteis.
* **Diretrizes de Posicionamento Contextual de Tooltips (`#global-tooltip`):**
  1. **Tool Strip Vertical da Timeline (`.timeline-actions-sidebar`):**
     * O tooltip **deve aparecer obrigatoriamente à direita de toda a barra** (`left = sidebarRect.right + 10px`), alinhado verticalmente ao centro do botão.
     * **Proibição Estrita:** O tooltip nunca deve se abrir centralizado sobre o botão ou à esquerda, pois isso encobre os botões da coluna adjacente (em modo 2 colunas) ou os botões vizinhos.
  2. **Tool Strip Horizontal (Acima da Timeline):**
     * O tooltip **deve abrir prioritariamente para cima** (`top = rect.top - height - 8px`), apontando em direção aos monitores superiores.
     * **Justificativa NLE:** Abaixo da barra horizontal residem a régua de timecode (`00:00`), marcadores IN/OUT, agulha de reprodução e clipes da timeline. Abrir para cima preserva 100% da área de trabalho visual e de precisão desimpedida.
  3. **Linhas Restauradoras de 4px (`.restore-line`):**
     * Abrir à direita da linha vertical (`left = rect.right + 10px`), centralizado verticalmente.
* **Scrollbars Ocultas & Rolagem Fluida por Interpolação Lerp:**
  * Em barras de ferramentas e sidebars estreitas, a barra de rolagem visual deve ser ocultada (`scrollbar-width: none !important;` e `::-webkit-scrollbar { display: none !important; }`).
  * O ouvinte de evento `wheel` deve capturar o delta normalizado (`deltaMode === 1 ? delta * 22 : ...`) e interpolar suavemente via `requestAnimationFrame` (`current + diff * 0.22`), eliminando trancos secos de linha no Windows.

---

## VI. Padrão Obrigatório de Tarefas em Segundo Plano & Feedback em Tempo Real (Background Tasks Standard)

* **Princípio Fundamental:** Nenhuma operação assíncrona longa ou processamento em lote (geração de proxies, miniaturas, análise visual, transcrição ASR, geração/regeneração de títulos, enriquecimento semântico, clusterização) deve rodar de forma "invisível" para o usuário.
* **Diretrizes Arquiteturais:**
  1. **Registro no `TASK_MANAGER`:** Todo processo em lote no backend Python deve criar uma chave identificadora (ex: `f"titles_proj_{project_id}"`) e emitir progresso regular via `TASK_MANAGER.update_progress(task_key, percent, status, task_type, label, log_message)`.
  2. **Logs em Linha Estruturados:** As mensagens de log devem utilizar tags padrão que estilizam o terminal CMD da aba Tarefas:
     * `[INIT]` — Inicialização de processos (azul/ciano).
     * `[LLM]` — Chamadas a modelos de linguagem e visão (violeta/rosa).
     * `[SUCCESS]` ou `[FINISHED]` — Sucesso e conclusões de etapas (verde esmeralda).
     * `[WARN]` — Avisos não-fatais (amarelo âmbar).
     * `[ERROR]` ou `[FAIL]` — Falhas e erros de execução (vermelho rose).
     * `[CANCEL]` — Interrupção solicitada pelo usuário.
  3. **Cancelamento Responsivo:** Loops assíncronos no backend devem checar `TASK_MANAGER.is_cancelled(task_key)` a cada iteração para permitir que o editor cancele a tarefa pelo botão `X` da aba Tarefas a qualquer momento.
  4. **Feedback e Redirecionamento na UI:** Ao acionar qualquer processo em lote a partir de menus ou botões, a interface deve:
     * Emitir um toast com `window.showToast(...)`.
     * Alternar automaticamente para a aba de Tarefas (`window.openTasksDrawerAndSwitchTab()`) para que o editor veja imediatamente a barra de progresso viva e o streaming de logs.

---

## VII. Menus Flutuantes Desacoplados de Ferramentas (Tool Submenu Flyouts)

### 14. Padrão Arquitetural para Submenus Flutuantes de Botões na Barra de Ferramentas
* **Objetivo:** Permitir que ferramentas da toolbar vertical (ex: Seleção `V`, Lâmina `C`, Marquee, etc.) exponham submodos ou ferramentas secundárias em um flyout compacto sem sofrer cortes de layout.
* **Regra Crítica — Desacoplamento do DOM (Bypass de `overflow-x: hidden`):**
  * Barras de ferramentas verticais (como `.timeline-actions-sidebar`) possuem largura fixa estreita (36px) e `overflow-x: hidden !important;`.
  * **PROIBIÇÃO ESTRITA:** Submenus nunca devem ser inseridos com `position: absolute` aninhados dentro do botão ou do wrapper da sidebar. Eles serão fisicamente cortados pelo motor de renderização do navegador e permanecerão invisíveis.
  * **DIRETRIZ OBRIGATÓRIA:** O elemento do submenu (`.toolbar-submenu-flyout`) deve ser acoplado diretamente à raiz do documento (`document.body.appendChild(flyout)`), utilizando `position: fixed; z-index: 999999;`.
* **Cálculo de Coordenadas em Tempo Real:**
  * No evento de acionamento (`mouseenter` ou `contextmenu` do botão disparador), o script calcula as coordenadas absolutas via `button.getBoundingClientRect()`:
    ```javascript
    const rect = triggerBtn.getBoundingClientRect();
    flyout.style.top = `${rect.top}px`;
    flyout.style.left = `${rect.right + 6}px`;
    ```
* **Eventos de Disparo & Tolerância Suave (Debounce de Fechamento):**
  * **Hover:** Abre no `mouseenter` do botão disparador. Um `setTimeout` com debounce de 250ms evita que o menu feche enquanto o usuário move o cursor do botão para dentro do flyout.
  * **Hover no Flyout:** Ao entrar no flyout (`mouseenter`), o timer de fechamento é cancelado (`clearTimeout`). Ao sair (`mouseleave`), agenda o fechamento em 250ms.
  * **Clique com Botão Direito (`contextmenu`):** Alterna a visibilidade imediatamente (`toggle`) e previne o menu de contexto padrão do navegador (`e.preventDefault()`).
  * **Escape & Clique Externo:** Ouvintes globais em `window` fecham o flyout ao pressionar `Escape` ou ao clicar fora (`mousedown`).
* **Padrão Visual Glassmorphism:**
  * Fundo escuro translúcido com desfoque de alta fidelidade: `background: rgba(18, 18, 24, 0.95); backdrop-filter: blur(12px);`.
  * Borda sutil de 1px (`rgba(255, 255, 255, 0.08)` ou `rgba(6, 182, 212, 0.3)`).
  * Sombra pronunciada para destacar da timeline: `box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75);`.
  * Botões internos com ícones vetoriais SVG (line art 18x18px), glow ciano no estado `.active` e tooltips contextuais descritivos.
  * Indicador no botão pai: um pequeno triângulo sutil no canto inferior direito (`.flyout-indicator`) sinalizando ao usuário a existência de subopções.

---

## VIII. Gesto Universal de Duplo Clique para Retração Rápida (Double-Click Collapse Standard)

### 15. Padrão Obrigatório de Duplo Clique para Criação de Barras, Cabeçalhos e Abas
* **Princípio Fundamental:** Qualquer barra, cabeçalho de aplicação (`.header`), cabeçalho de painel/sidebar (`.sidebar-header`), cabeçalho de pistas (`.timeline-headers-sidebar`), barra de ferramentas (`.timeline-actions-sidebar`), barra superior da timeline (`#timeline-header-bar`), ou contêiner de abas (Biblioteca, Ajustes, Falas, etc.) **DEVE suportar o gesto universal de duplo clique no espaço vazio** para recolher (colapsar) a respectiva barra ou painel instantaneamente.
* **Pareamento Obrigatório com Linhas Restauradoras de 4px (`.restore-line`):**
  * Todo elemento que implementa retração por duplo clique DEVE possuir sua respectiva linha restauradora de 4px integrada ao fluxo flexbox (conforme Seção I, Item 2), garantindo que o usuário possa reabri-lo com um simples clique na borda luminosa.
* **Filtro Estrito de Exclusão (Interactive Element Guard):**
  * O ouvinte de evento `dblclick` **nunca deve disparar** caso o usuário tenha clicado sobre botões, inputs, selects, links, opções, abas ou controles de arraste.
  * O callback deve conter a cláusula de guarda imediata via `closest(...)`:
    ```javascript
    if (e.target.closest("button, input, select, option, label, a, .tab-btn, .media-tabs, .btn-icon, .btn-toggle-sidebar, .slider-control-item, .resize-handle")) {
        return;
    }
    ```
* **Proteção Anti-Seleção de Texto e Supressão de Dicionários/Pesquisa do Chrome (Anti-Selection Standard):**
  * **Problema Crítico:** Em navegadores Chromium/Chrome no Windows, múltiplos cliques rápidos sobre textos de cabeçalhos acionam a seleção automática de palavras inteiras e podem disparar popups intrusivos de tradução, pesquisa de texto no Google ou atalhos do sistema operacional, degradando a experiência do usuário NLE.
  * **Tríplice Camada Obrigatória de Proteção:**
    1. **CSS Obligatório (`user-select: none !important`):**
       Todos os cabeçalhos, barras, réguas e chrome devem ter seleção estritamente proibida:
       ```css
       .header, .header *:not(input):not(textarea),
       .sidebar-header, .sidebar-header *:not(input):not(textarea),
       .timeline-header-ruler, .timeline-header-ruler *,
       #timeline-header-bar, #timeline-header-bar *:not(input):not(textarea),
       #timeline-actions-sidebar, #timeline-actions-sidebar *,
       #timeline-headers-sidebar, #timeline-headers-sidebar *:not(input):not(textarea),
       #dual-popout-toolbar, #dual-popout-toolbar * {
           -webkit-user-select: none !important;
           -moz-user-select: none !important;
           -ms-user-select: none !important;
           user-select: none !important;
       }
       ```
    2. **Limpeza Imediata de Seleção no Handler de Duplo Clique:**
       No callback do `dblclick`, executar `e.preventDefault()` e expurgar qualquer range que o navegador tenha computado:
       ```javascript
       e.preventDefault();
       const sel = window.getSelection();
       if (sel && sel.rangeCount > 0) {
           sel.removeAllRanges();
       }
       ```
    3. **Interceptação Global na Fase de Captura de `mousedown` (`e.detail > 1`):**
       O navegador inicia a marcação de seleção já no segundo `mousedown` (antes mesmo do evento `dblclick` ser disparado). Para suprimir essa seleção na raiz, todo documento ou janela filha DEVE possuir o listener capture-phase:
       ```javascript
       document.addEventListener("mousedown", (e) => {
           if (e.detail > 1) {
               if (!e.target.closest("input:not([readonly]), textarea, [contenteditable='true'], .bubble-text, .transcript-line")) {
                   e.preventDefault();
                   window.getSelection()?.removeAllRanges();
               }
           }
       }, { capture: true });
       ```
* **Template JavaScript Universal para Novas Barras ou Abas:**
  Ao criar qualquer novo cabeçalho ou barra recolhível no projeto, adote o seguinte padrão:
  ```javascript
  /**
   * Configuração de retração por duplo clique para novo contêiner/cabeçalho
   * @param {HTMLElement} headerEl - Elemento do cabeçalho ou barra que recebe o duplo clique
   * @param {HTMLElement} toggleBtn - Botão de toggle correspondente
   * @param {Function} collapseFn - Função de callback opcional de retração
   */
  function setupHeaderDoubleClickCollapse(headerEl, toggleBtn, collapseFn) {
      if (!headerEl) return;
      headerEl.addEventListener("dblclick", (e) => {
          // 1. Ignora elementos interativos
          if (e.target.closest("button, input, select, option, label, a, .tab-btn, .media-tabs, .btn-icon, .btn-toggle-sidebar")) {
              return;
          }
          // 2. Previne seleção de texto residual
          e.preventDefault();
          window.getSelection()?.removeAllRanges();

          // 3. Executa a retração pelo botão ou callback direto
          if (toggleBtn) {
              toggleBtn.click();
          } else if (typeof collapseFn === "function") {
              collapseFn();
          }
      });
  }
  ```
* **Comportamento em Janelas Destacadas e Popouts (Multi-Window):**
  * Quando um painel é adotado em uma janela popout (`panel.html` ou popouts individuais), o evento de duplo clique no seu cabeçalho deve ser compatibilizado com o documento da janela hospedeira (`win.document`).
  * No contexto da nova janela, a limpeza de seleção deve referenciar o `getSelection` da janela correspondente (`(win.getSelection || window.getSelection)()?.removeAllRanges()`), garantindo isolamento de contexto e prevenindo erros entre janelas filhas.

---

## IX. Contêineres de Painéis: Recolher, Setas e Troca de Lugar (Multi-Panel Containers)

### 16. Padrão para qualquer lugar que tenha mais de um painel
Vale para colunas do editor, pilhas de coluna, faixas, janelas destacadas simples, Janela Dupla e janela de grupo, e para **qualquer contêiner novo** que junte painéis. Implementação de referência: `src/ui/js/panelCollapse.js` (funções puras), `WorkspaceManager` (`setPanelCollapsed`, `panelPlacement`, `applyPanelCollapse`, `applyStackCollapse`, `collapseEdge`, `swapGroupPanels`), `panel.html` e `panel-group.html`.

* **Estado único, desenho local:**
  * "Recolhido" é um estado do painel guardado num lugar só (um `Set` no `WorkspaceManager`, salvo no `localStorage`), não uma classe CSS solta. Cada contêiner apenas **desenha** esse estado do seu jeito.
  * Para saber se um painel está recolhido, use `isPanelCollapsed(id)`. **Nunca** `classList.contains("collapsed")`: dentro de pilha ou janela a classe pode não existir. (Exceção interna: a timeline recolhe pelo próprio botão e guarda o estado na classe; `isPanelCollapsed("timeline-panel")` lê essa classe, então continue usando `isPanelCollapsed`.)
  * Todo recolher/expandir passa por `setPanelCollapsed(id, bool)`, venha de botão, linha, duplo clique ou atalho.
  * Recolher feito pelo próprio sistema (ex.: menu que ficou sem abas) usa `{ auto: true }` e não vai para o estado salvo.
  * Recolher/expandir **não** entra no desfazer de layout (Ctrl+Alt+Z); fica salvo ao reabrir.
* **Onde o painel está (`panelPlacement`):** `column`, `stack`, `band` (faixa inteira em cima/embaixo, `applyBandCollapse`), `single`, `dual`, `group`. Contêiner novo = novo tipo aqui + seu desenho de recolhido. Ao mudar o painel de lugar, chame o reaplicar (`applyAllCollapse`) para ele aparecer recolhido/expandido no lugar novo.
* **Regra do espaço:**
  * O painel recolhido some; os vizinhos **ocupam todo o espaço** (o último visível do contêiner recebe `flex: 1 1 0% !important`).
  * Divisores só entre dois painéis visíveis. Havendo vários candidatos entre eles, fica o que encosta no visível seguinte (`visibleSplitters`). Arrastar um divisor redimensiona o **visível** anterior, pulando recolhidos.
* **Linha de expandir no lugar do painel:**
  * Fica exatamente na posição dele dentro do contêiner: acima se ele estava em cima, abaixo se estava embaixo, à esquerda/direita lado a lado.
  * Orientação perpendicular ao eixo do contêiner: contêiner em linha → linha em pé (4px de largura); contêiner em coluna → linha deitada (4px de altura, classe `.restore-line-h`).
  * Todos recolhidos: o contêiner encolhe e as linhas giram para a orientação do contêiner de fora (numa coluna do editor, a coluna some e as linhas ficam em pé onde ela estava).
* **Seta de recolher calculada pela posição, nunca fixa no HTML:**
  * `edgeInLine(eixo, índice, total)`: primeira metade recolhe para o começo (esquerda/cima), a outra para o fim (direita/baixo). Empilhado usa `fa-chevron-up`/`down`; lado a lado, `left`/`right`. Dica: "Recolher Painel (Cima/Baixo/Esquerda/Direita)".
  * Painel sozinho no seu contêiner (ex.: único painel de uma linha da grade) usa a posição do contêiner dentro do de fora.
  * Recalcular depois de **toda** reorganização: trocar, empilhar, destacar, juntar, mudar disposição, trocar de lugar.
* **Janelas destacadas:**
  * A página hospedeira expõe `window.capiauSetPanelCollapsed(id, bool)` (desenha) e `window.capiauPanelEdge(id)` (diz a direção).
  * Controles da própria página (botões, linhas) chamam o editor (`opener.workspaceManager.setPanelCollapsed`) e só mudam localmente se o editor não estiver acessível.
  * A janela repassa as teclas ao handler de atalhos do editor (`handleWorkspaceShortcut`), para os atalhos valerem com o foco nela.
* **Trocar de lugar dentro do contêiner:**
  * Todo contêiner com mais de um painel permite trocar dois painéis arrastando a **alça** de um sobre o outro. Prévia: moldura ciano sobre o painel alvo com "Trocar com X".
  * A troca move os invólucros (slots) com o painel dentro: **não** recarrega a janela nem re-adota o DOM (vídeo e rolagem continuam).
  * Entra no desfazer de layout. Soltar dentro do próprio contêiner, fora de outro painel, não faz nada.
  * Disposições com posição especial (ex.: painel sozinho na grade de 3) oferecem também escolha explícita na barra (seletor + botão), além do arrasto.
* **Cantos disputados entre coluna e faixa (F2c):**
  * Onde as colunas de um lado encontram uma faixa inteira, o canto é de um dos dois: `"band"` (a faixa passa com a largura inteira e as colunas param antes dela) ou `"column"` (**todas as colunas daquele lado do centro** vão até o fim, juntas, e a faixa encurta até o centro). Estado em `bandCorners` (`tl`, `tr`, `bl`, `br`), só para faixas que existem; faixa nova começa com `"band"`.
  * O usuário escolhe **no arrasto**: na borda esquerda/direita do editor, soltar na altura da faixa (o canto) = `"column"`; soltar ao lado do centro = `"band"`. A sombra de prévia mostra o retângulo exato.
  * E **depois**: setinha no rodapé da coluna (no topo, se a faixa é em cima), `.dock-corner-toggle`. A seta aponta para onde a coluna vai crescer/encolher; dica "Estender até embaixo/em cima" ou "Deixar a faixa passar". Entra no desfazer de layout e no workspace salvo.
  * Implementação: a moldura `.dock-frame` é uma grade 3 × 3 em volta do `.workspace`; as colunas do lado que fica com o canto saem para a célula `.dock-edge` daquele lado, na mesma ordem, com divisores entre elas (`.dock-edge-splitter`, redimensiona a de fora; só aparece entre duas abertas) e o divisor da célula (`.dock-edge-resizer`, redimensiona a vizinha do centro). A faixa ocupa só as colunas da grade que sobram. A setinha fica na coluna da ponta (recolhida, na próxima aberta). Vale para qualquer contêiner de borda novo.
* **Timeline em faixa ou coluna (F2c parte 2):**
  * A timeline fica em um lugar só: embaixo dos monitores, numa faixa ou como coluna do editor (em `columnOrder`, como as laterais, mas nunca em pilha). Faixas e colunas mandam: `timelinePosition` é `"band"`, `"column"` ou `"center"` conforme onde ela está (faixa vence coluna).
  * Como coluna: altura inteira, largura pelo divisor (`layout-dim-splitter-timeline-panel`, padrão 420 px) e é a única coluna que encolhe quando falta espaço (mín. 200 px). Recolhida some e a linha `.timeline-restore-line` fica em pé no lugar. Entra na célula da ponta com as laterais do lado dela. É a base da futura timeline "prédio" (monitor vertical).
  * As posições antigas são nomes de faixa de baixo + cantos: `bottom-full` = `bl`/`br` `"band"`; `bottom-left` = `bl` `"band"`, `br` `"column"`; `bottom-right` = o espelho. Numpad2 = centro ↔ largura total; Numpad1/Numpad3 alternam o canto esquerdo/direito da faixa dela (no centro, vão para a faixa já expandida para o lado; recolher o único lado expandido volta ao centro).
  * Mudar de lugar leva a altura junto (faixa nova só com ela = altura dela + divisor; de volta ao centro, a altura salva de lá). O divisor de altura da faixa redesenha o canvas a cada quadro (Seção I.3) e o duplo clique nele ajusta às pistas.
  * Recolhida numa faixa: linha de expandir (`.timeline-restore-line`) em pé no lugar dela; sozinha na faixa, a faixa encolhe e a linha deita.
* **Monitores em bloco ou sozinhos, e o centro que some (F2c parte 2b):**
  * Duas alças no cabeçalho do primeiro monitor do bloco: ⋮⋮ move só ele; a do bloco (`.dock-handle-block`, logo depois) move os monitores do bloco juntos. Sem monitor no bloco, a alça do bloco some.
  * Monitor sozinho segue as regras da timeline: um lugar só (no bloco, numa faixa ou como coluna em `columnOrder`, nunca em pilha); faixa vence coluna. Fora do bloco, solto sobre o centro ou sobre o monitor que ficou, volta para o bloco (sobre o outro monitor, a borda escolhe lado a lado ou empilhados). Maximizar e trocar são do bloco: somem quando ele se divide (`body.layout-monitors-split`).
  * O bloco: bordas de cima/embaixo = os monitores dele vão juntos para a faixa; bordas esquerda/direita e sobre uma coluna = o centro muda de vaga nas colunas.
  * **Centro que esvazia:** sem monitores, a timeline que estiver nele ocupa a altura toda (`.center-no-monitors`); sem nada, o centro some (`.center-empty`) e a coluna vizinha mais perto cresce no lugar dele (`.dock-growing`; entre duas, a de conteúdo, monitor ou timeline; empate, a da esquerda). Os divisores passam a redimensionar para fora de quem cresce. Qualquer painel novo que possa esvaziar um contêiner deve seguir essa regra: nunca deixar buraco.
* **Abas no editor (F2c parte 2c):**
  * Uma aba destacável (`tabpanel-<aba>`) mora no menu dela; no editor, fica numa faixa ou como coluna, com as mesmas regras da timeline e dos monitores (um lugar só, nunca em pilha, faixa vence coluna). Enquanto está no editor, o botão dela some do menu (o Painel Lateral sem abas se recolhe sozinho).
  * Sai arrastando o **botão da aba** até o editor (sombra de prévia; sobre um menu continua reordenando ou mudando de menu) ou pelo botão direito da faixa ("Colocar X numa faixa embaixo / como coluna"). Volta pelo botão "devolver" do cabeçalho ou soltando a alça sobre a Biblioteca ou o Painel Lateral (o menu onde soltar é onde ela entra).
  * **Borda do editor vence menu:** a faixa fina das bordas (26 px) sempre cria faixa ou coluna na ponta, mesmo que a coluna da ponta seja um menu. Vale para qualquer arrasto novo que também tenha o menu como alvo.
* **Checklist para um contêiner novo:**
  1. Registrar o tipo em `panelPlacement` e desenhar o recolhido (espaço, divisores, linha no lugar).
  2. Implementar a direção da seta (`edgeInLine`) e chamar o recálculo após reorganizar.
  3. Permitir trocar de lugar por arrasto (e escolha explícita onde houver posição especial).
  4. Se for outra janela: expor `capiauSetPanelCollapsed` / `capiauPanelEdge` e repassar teclas.
  5. Autoteste das regras puras em `tests/` (ver `tests/autoteste_panel_collapse.mjs`).
