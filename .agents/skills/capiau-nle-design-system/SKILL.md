---
name: capiau-nle-design-system
description: Diretrizes do design system flat, layout sem espaços (seamless), sidebars adaptativas, selects premium e motor global de tooltips para a interface clássica NLE do CapIAu.
---

# Design System Flat & Seamless NLE - CapIAu

Este guia orienta futuros agentes de IA e desenvolvedores a manterem e expandirem a consistência visual, usabilidade e aproveitamento máximo de tela na interface clássica de edição de vídeo (NLE) do **CapIAu**.

---

## 1. Visual Sem Espaços (Seamless Layout)
* **Objetivo:** Aproveitar 100% da área da tela eliminando gaps, paddings desnecessários e bordas duplicadas.
* **Diretrizes:**
  * Painéis e seções contíguos na grade principal devem ter `border-radius: 0;` e `border: none;` (encostados uns nos outros).
  * A separação entre painéis deve ser feita unicamente por splitters sutis de redimensionamento (`.panel-splitter` de 4px) ou bordas de vidro discretas (`1px solid var(--border-glass)`).
  * O workspace principal (`.workspace`) deve usar `padding: 0; gap: 0;` e preencher toda a altura disponível.

---

## 2. Botões de Ação Flat (Visual Clássico NLE)
* **Objetivo:** Manter a interface limpa e profissional, removendo caixas (boxes) dos botões de ação e ferramentas.
* **Diretrizes:**
  * Botões de ação rápida nas sidebars (como os de Transcrição e Chat) e nos rodapés dos players (Play, IN/OUT, Inserir) não devem ter caixas sólidas, bordas ou preenchimentos opacos.
  * Devem usar fundo transparente (`background: transparent !important`) e borda nula (`border: none !important`).
  * **Hover Effects:** Sob hover, devem brilhar com suas respectivas cores temáticas:
    * **Controles de Seleção e Biblioteca:** Ciano (`var(--color-cyan)`) ou texto em branco com glow do ciano (`text-shadow: 0 0 8px var(--color-cyan)` para o botão *IN*).
    * **Ações de Edição e Timeline:** Violeta (`var(--color-violet)`) ou rosa (`var(--color-rose)` / glow rosa para o botão *OUT*).
    * **Efeito Hover Geral:** Aumentar ligeiramente o tamanho (`transform: scale(1.05)` ou `scale(1.1)`).

---

## 3. Layout Adaptativo de 3 Níveis (Sidebars)
* **Objetivo:** Responder reativamente à largura horizontal das abas laterais e evitar quebras de texto em múltiplas linhas.
* **Estados e Limites:**
  1. **Normal (Largura $\ge 320\text{px}$):** Exibe ícones e textos lado a lado.
  2. **Compacto ($320\text{px} >$ Largura $\ge 240\text{px}$):** Oculta os textos das abas (`display: none`), centralizando apenas os ícones de linha. Oculta o texto dos botões de ação no feed (ex: de "Clipe" para apenas o ícone).
  3. **Mínimo (Largura $< 240\text{px}$):** Oculta os textos dos cabeçalhos dos painéis e compacta paddings e margens. Os labels de controle de IA (como "Modelo IA" e "Chave API") reduzem sua largura e ocultam texto, exibindo apenas o robozinho e a chave com suas tooltips.

---

## 4. Caixas de Seleção Premium (Selects & Options)
* **Objetivo:** Evitar que o Windows ou navegadores renderizem menus suspensos brancos e boxy que contrastam com o tema dark/glassmorphic.
* **Diretrizes:**
  * Todos os `<select>` nativos ou com a classe `.nle-select` devem usar fundo escuro translúcido, bordas glass, fonte `Outfit` e um chevron de seta em SVG customizado integrado ao background (roxo por padrão, ciano para resolução).
  * **Elemento Option:** Estilizar obrigatoriamente a tag `select option` globalmente com fundo escuro (`background-color: #121218 !important`) e texto claro (`color: #e2e8f0 !important`).
  * **Selects Aninhados:** Elementos de seleção contidos dentro de outros wrappers glassmorphic (como as classes `.project-area`, `.search-area` ou `.dropdown-wrapper`) devem ser transparentes e sem borda para evitar caixas e contornos duplicados.

---

## 5. Motor de Tooltips Globais (JavaScript)
* **Objetivo:** Impedir que tooltips nativas do navegador (`title`) apareçam e garantir que tooltips customizadas nunca cortem nas laterais ou fiquem atrás de painéis com `overflow: hidden`.
* **Diretrizes:**
  * **Sem Pseudo-Elementos:** Não utilizar tooltips baseadas em CSS pseudo-elementos (`::after`) em elementos móveis, pois eles serão fisicamente cortados pelas bordas do painel pai.
  * **Motor Global:** Utilizar o elemento fixo `#global-tooltip` anexado à raiz do `body` e controlado por JavaScript.
  * **Prevenção de Colisões:**
    * **Vertical:** A tooltip se projeta acima do elemento por padrão. Caso passe do topo da janela (Y < 8px), ela se inverte automaticamente para baixo.
    * **Horizontal:** Caso atinja os cantos laterais esquerdo ou direito do navegador, o script limita seu valor horizontal em pixels para mantê-la visível na tela.
  * **Injeção Dinâmica:** O `MutationObserver` em `main.js` intercepta qualquer injeção HTML dinâmica e converte automaticamente tags `title` em atributos `data-tooltip`, integrando-as no motor global.

---

## 6. Linhas Restauradoras para Painéis Retráteis (Restore Lines)
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
