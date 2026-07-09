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
