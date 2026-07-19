---
name: capiau-nle-design-system
description: Diretrizes do design system flat, layout sem espaços (seamless), sidebars adaptativas, selects premium, controles numéricos e motor global de tooltips para a interface clássica NLE do CapIAu.
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
  * A linha restauradora deve ser um **irmão direto** no mesmo contêiner flex do painel colapsado, posicionada logo após o painel no fluxo do DOM.
  * **Nunca usar `position: absolute`** — isso causa sobreposições, problemas de z-index e inacessibilidade quando múltiplos painéis estão colapsados simultaneamente.
  * O painel colapsado deve usar `width: 0px !important; opacity: 0; pointer-events: none;` com transição suave.

---

## II. Diretrizes dos Menus Laterais (Sidebars)

### 3. Layout Adaptativo de 3 Níveis & Estabilidade Vertical
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

### 4. Abas Customizáveis dos Menus Laterais (Sidebar Tabs)
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

### 5. Botões de Ação Flat na Sidebar
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

### 6. Caixas de Seleção Premium (Selects & Options)
* **Objetivo:** Evitar que o Windows ou navegadores renderizem menus suspensos brancos e boxy que contrastam com o tema dark/glassmorphic.
* **Diretrizes:**
  * Todos os `<select>` nativos ou com a classe `.nle-select` devem usar fundo escuro translúcido, bordas glass, fonte `Outfit` e um chevron de seta em SVG customizado integrado ao background (roxo por padrão, ciano para resolução).
  * **Elemento Option:** Estilizar obrigatoriamente a tag `select option` globalmente com fundo escuro (`background-color: #121218 !important`) e texto claro (`color: #e2e8f0 !important`).
  * **Selects Aninhados:** Elementos de seleção contidos dentro de outros wrappers glassmorphic (como as classes `.project-area`, `.search-area` ou `.dropdown-wrapper`) devem ser transparentes e sem borda para evitar caixas e contornos duplicados.

### 7. Motor de Tooltips Globais (JavaScript)
* **Objetivo:** Impedir que tooltips nativas do navegador (`title`) apareçam e garantir que tooltips customizadas nunca cortem nas laterais ou fiquem atrás de painéis com `overflow: hidden`.
* **Diretrizes:**
  * **Sem Pseudo-Elementos:** Não utilizar tooltips baseadas em CSS pseudo-elementos (`::after`) em elementos móveis, pois eles serão fisicamente cortados pelas bordas do painel pai.
  * **Motor Global:** Utilizar o elemento fixo `#global-tooltip` anexado à raiz do `body` e controlado por JavaScript.
  * **Prevenção de Colisões:**
    * **Vertical:** A tooltip se projeta acima do elemento por padrão. Caso passe do topo da janela (Y < 8px), ela se inverte automaticamente para baixo.
    * **Horizontal:** Caso atinja os cantos laterais esquerdo ou direito do navegador, o script limita seu valor horizontal em pixels para mantê-la visível na tela.
  * **Injeção Dinâmica & Feedback de Sliders:** O `MutationObserver` em `main.js` intercepta qualquer injeção HTML dinâmica e converte automaticamente tags `title` em atributos `data-tooltip`. Para sliders de controle (`input[type="range"]`), a tooltip deve ser exibida **exclusivamente no estado mínimo** (largura $< 240\text{px}$) onde os nomes dos efeitos são ocultados, incluindo o nome do parâmetro e o valor formatado (ex: `Brilho: +15%`). Nos estados normal e compacto (onde os rótulos permanecem visíveis à esquerda), a tooltip nos sliders é dispensada.

### 8. Sliders de Controle Proporcionais (Range Inputs)
* **Objetivo:** Oferecer precisão de ajuste proporcional à largura disponível do painel, garantindo responsividade sem sacrificar usabilidade.
* **Diretrizes de Dimensionamento:**
  * **Estado Normal ($\ge 320\text{px}$):** Sliders amplos com `width: 180px` a `240px` (`flex: 1`), aproveitando a largura expansiva do menu.
  * **Estado Compacto ($240\text{px} >$ Largura $\ge 240\text{px}$):** Sliders médios com `width: 115px` a `135px`, mantendo os rótulos de efeito visíveis à esquerda.
  * **Estado Mínimo (Largura $< 240\text{px}$):** Sliders compactos com `max-width: 120px` centralizados e rótulos ocultados.

### 9. Entradas Numéricas Flat & Steppers Minimalistas (Number Inputs)
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

### 10. Players Limpos com Controles em Hover
* **Objetivo:** Sempre que um player de vídeo (`.player-panel`) for construído ou reaproveitado em um layout novo, ele deve priorizar a exibição do vídeo — cabeçalho e barra de controles não devem competir visualmente com a imagem quando o usuário não está interagindo com aquele player específico.
* **Diretrizes:**
  * O contêiner do player (`.player-panel`) precisa de `position: relative;` para servir de referência aos overlays.
  * `.player-header` e `.player-controls` tornam-se overlays absolutos (`position: absolute; left: 0; right: 0;`), um ancorado no topo (`top: 0`) e outro na base (`bottom: 0`), com `z-index` acima do vídeo.
  * Estado padrão: `opacity: 0; pointer-events: none;` — o vídeo ocupa 100% do painel sem faixas nem botões visíveis.
  * No hover do painel (`.player-panel:hover .player-header`, `.player-panel:hover .player-controls`): `opacity: 1; pointer-events: auto;`, com `transition: opacity 0.2s ease;` (sem transição de layout/altura, só opacidade).
  * Usar gradiente sutil por trás dos controles para garantir legibilidade sobre qualquer imagem, nunca um fundo opaco sólido: `linear-gradient(to bottom, rgba(0,0,0,.55), transparent)` no header e `linear-gradient(to top, rgba(0,0,0,.6), transparent)` nos controles.
  * Remover o cap de altura do vídeo (`max-height`) nesses contextos — o vídeo deve preencher todo o painel, já que não há mais cabeçalho/controles ocupando espaço fixo no fluxo.
* **Referência de implementação:** ver o layout "Estúdio" (`body.studio .player-panel/.player-header/.player-controls` em `styles.css`), que reaproveita esse padrão para os monitores Source/Program empilhados.
