# 🎬 Plano Mestre de Implementação: Suíte Clássica de Ferramentas NLE no CapIAu-Talho

> **Status:** Planejamento Aprovado / Em Execução Modular  
> **Arquivo de Referência Permanente:** `docs/PLANO_SUITE_NLE_CLASSICO.md`  
> **Alvo:** Paridade operacional e ergonomia clássica de NLE (Premiere Pro, DaVinci Resolve, Final Cut Pro e Kdenlive).

---

## 📑 Sumário das 7 Sessões de Trabalho

1. [🛑 Protocolo Estrito de Desenvolvimento](#-protocolo-estrito-de-desenvolvimento)
2. [🧭 Matriz Geral das 26 Ferramentas](#-matriz-geral-das-26-ferramentas)
3. [📋 SESSÃO 0: Fundação & Arquitetura da Barra de Ferramentas](#-sessão-0-fundação--arquitetura-da-barra-de-ferramentas)
   - [Task 0: Limpeza, Desacoplamento & Arquitetura em 2 Zonas](#task-0-limpeza-desacoplamento--arquitetura-da-barra-de-ferramentas)
4. [📋 SESSÃO 1: Ferramentas de Cursor da Timeline (Manipulação Direta)](#-sessão-1-ferramentas-de-cursor-da-timeline-manipulação-direta)
   - [Task 1: Lâmina / Gilete (Razor / Blade Tool — `C`) & Global (`Shift+C`)](#task-1-ferramenta-lâmina--gilete-razor--blade-tool--tecla-c--lâmina-global-shiftc)
   - [Task 2: Seleção por Retângulo / Caixa (Marquee / Box Selection)](#task-2-ferramenta-de-seleção-por-retângulo--caixa-marquee--box-selection)
   - [Task 3: Deslizar Conteúdo Interno (Slip Tool — `Y`)](#task-3-ferramenta-deslizar-conteúdo-interno-slip-tool--tecla-y)
   - [Task 3.5: Prevenção de Sobreposição de Pistas & Modos de Movimentação (Bloqueio Físico, Sobrescrita e Ripple)](#task-35-prevenção-de-sobreposição-de-pistas--modos-de-movimentação-bloqueio-físico-sobrescrita-e-ripple)
   - [Task 3.6: Modo Inserção Ripple (`Ctrl`) com Rearrange Swap e Monitor 2-Up](#task-36-modo-inserção-ripple-ctrl-com-rearrange-swap-e-monitor-2-up)
   - [Task 4: Deslocamento com Compensação (Slide Tool — Tecla `U`)](#task-4-ferramenta-deslocamento-com-compensação-slide-tool--tecla-u)
   - [Task 5: Corte Contínuo Adjacente (Rolling Edit Tool — Tecla `N`)](#task-5-ferramenta-corte-contínuo-adjacente-rolling-edit-tool--tecla-n)
   - [Task 6: Navegação Livre: Mão / Pan (`H`) & Zoom Tool](#task-6-ferramentas-de-navegação-mão--pan-h--zoom-tool)
5. [📋 SESSÃO 2: Montagem de 3 e 4 Pontos & Navegação Rápida](#-sessão-2-montagem-de-3-e-4-pontos--navegação-rápida)
   - [Task 7: Inserção Ripple (`,`) & Sobrescrita (`.`)](#task-7-montagem-de-três-pontos-inserção-ripple--sobrescrita-)
   - [Task 8: Localizar Quadro Original na Fonte (Match Frame — `F`) & Reverse (`Shift+F`)](#task-8-localizar-quadro-original-na-fonte-match-frame--tecla-f--reverse-match-frame-shiftf)
   - [Task 9: Substituição de Clipe na Timeline (Replace Edit)](#task-9-substituição-de-clipe-na-timeline-replace-edit--ctrlshiftr--drag-com-alt)
   - [Task 10: Criação de Subclipes na Biblioteca a partir do Source (Subclips)](#task-10-criação-de-subclipes-na-biblioteca-a-partir-do-source-subclips)
   - [Task 11: Display de Timecode Interativo & Navegação Numérica (`+frames`, `-frames`)](#task-11-display-de-timecode-interativo--navegação-numérica-frames--frames)
6. [📋 SESSÃO 3: Tempo, Velocidade & Imagem Estática](#-sessão-3-tempo-velocidade--imagem-estática)
   - [Task 12: Congelar Quadro (Freeze Frame / Hold Frame — `Ctrl+Shift+F`)](#task-12-congelar-quadro-freeze-frame--hold-frame--ctrlshiftf)
   - [Task 13: Velocidade Individual do Clipe (Clip Speed / Duration) & Reverse](#task-13-velocidade-individual-do-clipe-clip-speed--duration--reverse)
   - [Task 14: Esticar / Comprimir Taxa (Rate Stretch Tool — `R`)](#task-14-ferramenta-esticar--comprimir-taxa-rate-stretch-tool--tecla-r)
7. [📋 SESSÃO 4: Transições de Junção, Camadas de Ajuste & Geradores](#-sessão-4-transições-de-junção-camadas-de-ajuste--geradores)
   - [Task 15: Crossfade de Áudio de Junção com Potência Constante (`Ctrl+Shift+D`)](#task-15-crossfade-de-áudio-de-junção-com-potência-constante-ctrlshiftd)
   - [Task 16: Transições de Vídeo (Cross Dissolve `Ctrl+D`, Dip to Black/White)](#task-16-transições-de-junção-de-vídeo-cross-dissolve-ctrld-dip-to-black--dip-to-white)
   - [Task 17: Camada de Ajuste (Adjustment Layer)](#task-17-camada-de-ajuste-adjustment-layer)
   - [Task 18: Geradores de Cor Sólida (Color Matte / Solid Color Slates)](#task-18-geradores-de-cor-sólida-color-matte--solid-color-slates)
8. [📋 SESSÃO 5: Medição, Automação & Áudio](#-sessão-5-medição-automação--áudio)
   - [Task 19: Medidor de Nível de Áudio Estéreo em Tempo Real (VU Meter / Peak Meter)](#task-19-medidor-de-nível-de-áudio-estéreo-em-tempo-real-vu-meter--peak-meter)
   - [Task 20: Borracha de Áudio & Keyframes na Timeline (Audio Rubberbanding)](#task-20-borracha-de-áudio--keyframes-na-timeline-audio-rubberbanding)
   - [Task 21: Atenuação Sonora Automática de Trilha (Auto-Ducking)](#task-21-atenuação-sonora-automática-de-trilha-auto-ducking)
9. [📋 SESSÃO 6: Organização Visual, Travas & Múltiplas Timelines](#-sessão-6-organização-visual-travas--múltiplas-timelines)
   - [Task 22: Rótulos de Cores Personalizados para Clipes (Color Labels)](#task-22-rótulos-de-cores-personalizados-para-clipes-color-labels)
   - [Task 23: Trava Total de Pista com Cadeado Físico (Track Lock)](#task-23-trava-total-de-pista-com-cadeado-físico-track-lock)
   - [Task 24: Margens de Segurança & Overlays de Aspecto no Player (Safe Margins)](#task-24-margens-de-segurança--overlays-de-aspecto-no-player-safe-margins)
   - [Task 25: Sistema de Múltiplas Timelines / Sequências em Abas (Multi-Sequence Tabs)](#task-25-sistema-de-múltiplas-timelines--sequências-em-abas-multi-sequence-tabs)
10. [🚦 Critérios de Aceitação Global do Projeto](#-critérios-de-aceitação-global-do-projeto)

---

## 🛑 Protocolo Estrito de Desenvolvimento

> [!IMPORTANT]
> **Regra de Ouro do Desenvolvimento:**
> Cada tarefa deste plano representa **uma ferramenta isolada e completa**. O desenvolvimento **NUNCA avançará para a próxima tarefa sem que a anterior tenha:**
> 1. Código completamente implementado e integrado sem quebrar o layout *seamless* nem o design system ([`SKILL.md`](../.agents/skills/capiau-nle-design-system/SKILL.md)).
> 2. Autoteste automatizado criado e executando com **100% de sucesso** (`node tests/autoteste_...mjs` ou `pytest`).
> 3. **Parada obrigatória** com notificação para o usuário realizar o teste manual guiado e dar a aprovação explícita para prosseguir.

### 🛡️ As 10 Diretrizes Arquiteturais Universais (Aprendizados das Sessões 0, 1 e 4)
1. **Retração Universal & Linhas Restauradoras Anti-Flicker:**
   - Todo e qualquer cabeçalho ou barra estrutural (horizontal ou vertical) deve possuir botão de retração para `0px` (`overflow: hidden; opacity: 0; pointer-events: none;`).
   - Quando colapsado, projeta obrigatoriamente uma **linha restauradora de 4px** inserida no fluxo flexbox (nunca `position: absolute`), com cor temático-funcional:
     - **Ciano** (`rgba(6, 182, 212, ...)`) — para cabeçalhos de pistas e cabeçalhos superiores de painéis/timelines.
     - **Violeta** (`rgba(139, 92, 246, ...)`) — para barras de ferramentas e toolbars.
   - **Regra Anti-Flicker:** A dimensão física da linha (largura na vertical ou altura na horizontal) **nunca deve variar no hover**, mudando apenas opacidade e glow para evitar layout shifts e repaints no canvas da timeline.
2. **Isolamento de Classes & Namespacing Estrito:**
   - Proibição absoluta de reutilizar classes genéricas de elementos internos legados (ex: `.panel-header`, `.sidebar-header`).
   - Todos os novos componentes das sessões futuras (Camadas de Ajuste, Color Matte, VU Meter, etc.) devem usar prefixos e classes dedicadas (ex: `.vumeter-panel`, `.color-matte-item`, `.adjustment-layer-clip`).
3. **Versionamento de Layout & Migração Segura no LocalStorage:**
   - Qualquer nova chave de preferência de layout persistida no `localStorage` deve ser acompanhada de uma flag de versão (ex: `capiau_nle_suite_toolbar_v1`) para limpar ou migrar automaticamente configurações obsoletas de sessões antigas que possam desalinhar a experiência do editor.
4. **Checklist de Cache-Busting em Ativos Estáticos (`?v=...`):**
   - Ao concluir qualquer tarefa que envolva mudanças no `index.html`, `styles.css` ou módulos raiz de JavaScript (`main.js`, `panels.js`), é **obrigatório incrementar o parâmetro de versão do cache-buster** (`?v=N+1`) para garantir que o navegador recarregue os novos ativos sem retenção de cache antigo.
5. **Paridade de Atalhos Multi-Preset & Sincronização Obrigatória com Teclado Virtual, Cheat Sheet e Editor:**
   - Toda e qualquer nova ferramenta, modo de cursor ou ação de edição introduzida deve ser obrigatoriamente cadastrada no catálogo central `COMMANDS_CATALOG` (`src/ui/js/keymapService.js`), com seu respectivo grupo funcional (`category`), rótulo (`label`) e descrição didática (`description`).
   - Deve possuir mapeamentos de teclas fiéis e ergonomicamente consistentes em **todos os 5 perfis da indústria** suportados pelo CapIAu (`KEYMAP_PRESETS`):
     - **CapIAu Padrão** (`capiau`)
     - **Adobe Premiere Pro** (`premiere`)
     - **DaVinci Resolve** (`resolve`)
     - **Apple Final Cut Pro** (`finalcut`)
     - **Kdenlive** (`kdenlive`)
   - O novo comando deve refletir dinamicamente e sem falhas em todas as 3 abas do diálogo de atalhos (`#modal-timeline-help` acionado por `#btn-timeline-help`):
     - **Aba 1 (Teclado Virtual Interativo):** Identificação visual e colorização de teclas na camada base e com modificadores (`Shift`, `Ctrl`, `Alt`).
     - **Aba 2 (Guia Rápido & Cheat Sheet):** Inclusão automática dos badges estilizados na respectiva seção temática (`#keymap-cheatsheet-content`).
     - **Aba 3 (Editor Completo & Conflitos):** Listagem, filtragem por busca e edição customizada de atalhos.
   - O autoteste automatizado de cada tarefa deve obrigatoriamente validar a presença do comando no catálogo, a validade das teclas em cada um dos 5 perfis e a integridade da renderização da Cheat Sheet.
6. **Compatibilidade com Motor de Workspaces Modulares e Janelas Destacadas (Popout):**
   - O CapIAu suporta arranjo flexível de colunas, redimensionamento dinâmico, auto-layout de monitores (Single vs 2-Up) e desacoplamento de painéis em popouts multi-monitor.
   - Qualquer nova funcionalidade que conecte monitores (Source/Program), timeline, inspetor ou biblioteca (como Inserção 3 Pontos, Match Frame, VU Meter, Safe Margins) deve operar via barramento de eventos do `STATE` e métodos do `TIMELINE_STATE`, nunca presumindo hierarquia DOM estática dentro de um único container de janela.
7. **Preservação de Atalhos do Cluster Speed Editing QWER / ASDF:**
   - O bloco ergonômico de mão esquerda no perfil `capiau` (`Q`, `W`, `E`, `R`, `A`, `S`, `D`, `Shift+D`, `F`, `N`, `Shift+N`) e o modo *Selection Follows Playhead* (`Ctrl+Alt+P`) são soberanos para edição ágil.
   - Novas ferramentas ou ações não devem sobrescrever esses atalhos no perfil `capiau`. Em ferramentas com teclas tradicionalmente coincidentes em outros NLEs (ex: Match Frame `F` no Premiere / Rate Stretch `R`), o perfil `capiau` deve utilizar atalhos secundários ergonômicos (ex: `Alt+F` e `Shift+R`), preservando a paridade nativa de cada preset nos demais perfis da indústria.
8. **Paridade Estrita Player vs. FFmpeg em Transições e Mesclagens:**
   - Toda transição de junção entre cortes adjacentes deve compartilhar um `transitionId` e ser emparelhada em ambas as pontas.
   - Folgas de mídia (handles) devem estender a cauda do clipe A até `corte + halfB` e recuar a cabeça do clipe B até `corte - halfA`.
   - Na falta de folga de mídia na fonte (`in_time == 0`) ou sob `hard_boundaries: true`, é obrigatório o congelamento estrito de borda com `tpad=clone` (`stop_mode=clone` para A e `start_mode=clone` para B), proibindo saltos ou quadros inventados.
   - Meio-fades (`halfA`, `halfB`) devem ser delimitados por `min(half, a.duracao_s, b.duracao_s)` prevenindo tempos negativos (`st < 0`) em `fade`.
   - Transições de dissolução cruzada (`cross_dissolve`) jamais devem cair para preto (Dip to Black espúrio): o clipe A permanece contínuo por baixo enquanto o clipe B dissolve progressivamente por cima.
9. **Ciclo de Vida de Decoders e Gestão Atômica de VRAM no Render Cache:**
   - Decodificadores do Player on-air durante transições ativas pertencem aos conjuntos protegidos `claimed` e `busy` e nunca devem sofrer ejeção ou `seek`/rewind inoportuno.
   - O clipe posterior em uma transição deve ser pré-aquecido no ponto antecipado `corte - halfA` para eliminar quedas de taxa de quadros e engasgos.
   - Cortes contíguos do mesmo arquivo (`video_id` idêntico) exigem alocação dual-buffer dedicada para sobreposição temporal contínua na junção.
   - No Chromium/Electron, toda instância de `ImageBitmap` e texturas offscreen GPU alocadas pelo Render Cache deve ser explicitamente destruída via `bitmap.close()` em qualquer invalidação de trecho (`invalidateRange`), descarte total (`invalidateAll`) ou substituição (`setFrame`), eliminando vazamentos de memória gráfica (VRAM leak).
   - Durante *Cache Hit*, o estado de `activeClipId` dos decoders deve ser preservado para evitar *cold-starts* ao cruzar as bordas do trecho verde.
10. **Bateria Obrigatória de Teste Composto Multipista em Cascata:**
    - É terminantemente proibido validar ferramentas e efeitos NLE exclusivamente em testes isolados de pista única ou clipe individual.
    - Toda funcionalidade ou correção deve ser validada contra o **Cenário Canônico Composto Multipista em Cascata**:
      - **Pista V2 (Superior):** Camada de Ajuste (Adjustment Layer) sobreposta à junção, com curva Bézier/S-Curve em Fade In e Fade Out, gradação de cor (brilho, contraste, saturação) e modo de mesclagem (`soft-light` ou `overlay`).
      - **Pista V1 (Inferior):** Dois clipes contíguos de vídeo com transição de junção Cross Dissolve ativa no ponto de corte e ajustes individuais de cor.
    - Ambas as suítes permanentes (`tests/autoteste_composicao_multipista_cascata.mjs` no frontend e `tests/test_render_composicao_multipista_cascata.py` no backend) devem passar com 100% de sucesso, garantindo que o desativamento (bypass) da camada superior restaura imediatamente a renderização pura do corte inferior sem efeitos colaterais.

---

## 🧭 Matriz Geral das 26 Ferramentas

| Sessão | Código | Ferramenta / Recurso | Atalho | Grupo / Zona | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Sessão 0** | **Task 0** | Nova Arquitetura em 2 Zonas (Header + Tool Strip) | — | Layout / Fundação | ✅ Concluída |
| **Sessão 1** | **Task 1** | Lâmina / Gilete (Blade Tool) & Lâmina Global | **`C`** / **`Shift+C`** | Tool Strip (Edição) | ✅ Concluída |
| **Sessão 1** | **Task 2** | Seleção por Retângulo / Caixa (Marquee) | Arraste livre | Tool Strip (Seleção) | ✅ Concluída |
| **Sessão 1** | **Task 3** | Deslizar Conteúdo Interno (Slip Tool) | **`Y`** | Tool Strip (Deslocamento) | ✅ Concluída |
| **Sessão 1** | **Task 3.5**| Prevenção de Sobreposição & Sobrescrita (Modos Clamp & Overwrite) | Submenu / **`Shift`** | Tool Strip (Seleção & Colisão) | ✅ Concluída |
| **Sessão 1** | **Task 3.6**| Modo Inserção Ripple com Rearrange Swap & Monitor 2-Up | Submenu / **`Ctrl`** | Tool Strip (Seleção & Colisão) | ✅ Concluída |
| **Sessão 1** | **Task 4** | Deslocamento com Compensação (Slide Tool) | **`U`** | Tool Strip (Deslocamento) | ✅ Concluída |
| **Sessão 1** | **Task 5** | Corte Contínuo Adjacente (Rolling Edit Tool) | **`Shift+N`** (CapIAu) / **`N`** | Tool Strip (Deslocamento) | ✅ Concluída |
| **Sessão 1** | **Task 6** | Mão / Pan & Zoom Tool (Zoom até Frames & Fit) | **`H`** / Lupa / **`\`** ou **`Shift+Z`** / **`+`** e **`-`** | Tool Strip (Navegação) | ✅ Concluída |
| **Sessão 2** | **Task 7** | Inserção Ripple (Insert) & Sobrescrita (Overwrite) | **`,`** / **`.`** | Source Player ➔ Timeline | ✅ Concluída |
| **Sessão 2** | **Task 8** | Localizar Quadro na Fonte (Match Frame & Reverse) | **`Alt+F`** (CapIAu) / **`F`** / **`Shift+F`** | Player / Timeline | ✅ Concluída |
| **Sessão 2** | **Task 9** | Substituição de Clipe (Replace Edit + trecho 9.1) | **`Ctrl+Shift+R`** / `Alt`+`Ctrl` | Timeline | ✅ Concluída |
| **Sessão 2** | **Task 10**| Subclipes Virtuais | **`Ctrl+U`** | Source ➔ Biblioteca | ✅ Concluída |
| **Sessão 2** | **Task 11**| Timecode Interativo & Navegação Numérica | Clique / Numpad / **`Ctrl+G`** | Header Timeline / Player | ✅ Concluída |
| **Sessão 3** | **Task 12**| Congelar Quadro (Freeze Frame / Hold Frame) | **`Ctrl+Shift+F`** | Timeline | ✅ Concluída |
| **Sessão 3** | **Task 13**| Velocidade por Clipe (Speed/Duration) & Reverse | **`Ctrl+R`** | Inspector / Timeline | ✅ Concluída |
| **Sessão 3** | **Task 14**| Esticar / Comprimir Taxa (Rate Stretch Tool) | **`Shift+R`** (CapIAu) / **`R`** | Tool Strip (Deslocamento) | ✅ Concluída |
| **Sessão 4** | **Task 15**| Crossfade de Áudio com Potência Constante | **`Ctrl+Shift+D`** | Pistas A1/A2 | ✅ Concluída |
| **Sessão 4** | **Task 16**| Transições de Vídeo (Cross Dissolve & Dips) | **`Ctrl+D`** | Pistas V1/V2 | ✅ Concluída |
| **Sessão 4** | **Task 17**| Camada de Ajuste (Adjustment Layer) | Nova Camada | Pistas V2/V3 | ✅ Concluída |
| **Sessão 4** | **Task 18**| Geradores de Cor Sólida (Color Matte) | Novo Item | Biblioteca ➔ Timeline | ✅ Concluída |
| **Sessão 5** | **Task 19**| VU Meter / Peak Meter Estéreo ao Vivo (L/R) | Ao vivo | Lateral do Program Player | 📋 Planejada |
| **Sessão 5** | **Task 20**| Borracha de Áudio & Keyframes na Timeline | **`Ctrl + Clique`** | Waveforms de Áudio | 📋 Planejada |
| **Sessão 5** | **Task 21**| Atenuação Sonora Automática (Auto-Ducking) | Toggle Pista | Pista A2 (Música) | 📋 Planejada |
| **Sessão 6** | **Task 22**| Rótulos de Cor para Clipes (Color Labels) | Menu Botão Direito | Timeline & Cards | 📋 Planejada |
| **Sessão 6** | **Task 23**| Trava Total de Pista (Track Lock com Cadeado) | Clique no Header / **`Shift+L`** / **`Ctrl+Alt+Shift+L`** | Cabeçalhos de Pistas | ✅ Concluída |
| **Sessão 6** | **Task 24**| Margens de Segurança & Overlays de Aspecto | Botão Header | Program Player | 📋 Planejada |
| **Sessão 6** | **Task 25**| Sistema de Múltiplas Timelines em Abas | Barra de Abas | Topo da Timeline | 📋 Planejada |

---

## 📋 SESSÃO 0: FUNDAÇÃO & ARQUITETURA DA BARRA DE FERRAMENTAS

---

### Task 0: Limpeza, Desacoplamento & Arquitetura da Barra de Ferramentas
> **Status:** Concluída e Validada com Sucesso (100% de Autoteste Automatizado e Teste Humano Aprovado)

#### 1. Diagnóstico do Problema Original
A barra vertical da timeline (`src/ui/index.html:L864-943`) misturava mais de 20 controles heterogêneos (Salvar, Exportar, Sliders de altura, Undo/Redo, IA Persona, janelas flutuantes e ferramentas de corte). Foi desacoplada com sucesso.

#### 2. Arquitetura Implementada em 2 Zonas Especializadas
* **Zona 1: Cabeçalho Superior da Timeline (`.timeline-header-bar`):**
  * Reservado exclusivamente para **Gestão do Projeto, Arquivo e Exibição**:
    * Nome da Sequência com renomeação rápida ao clicar (`#timeline-name-display`).
    * Configurações da Sequência (`⚙️`) e Opções de Visão (`👁️`).
    * Grupo de Arquivo: Salvar (`Ctrl+S`), Carregar, Importar e Exportar (.otio/.xml/MP4).
    * Desfazer (`Ctrl+Z`) e Refazer (`Ctrl+Y`).
    * Controle deslizante horizontal compacto de Altura de Pistas (`#track-height-slider`) e Zoom da Timeline (`#timeline-zoom-slider`).
    * Controles de layout de janela (colapsar painel inteiro, alternar 1/2 colunas, popout).
    * **Retração do Cabeçalho (`#btn-toggle-timeline-header`):** Recolhe o cabeçalho superior para ganho máximo de espaço vertical.
    * **Linha Restauradora `#reopen-timeline-header`:** Linha de 4px horizontal Ciano (`rgba(6, 182, 212, ...)`) integrada no fluxo flexbox com altura fixa anti-flicker no hover.
    * IA Persona e Sugestões concentradas em botão inteligente.
* **Zona 2: Tool Strip Vertical da Timeline (`.timeline-actions-sidebar`):**
  * Reservada **exclusivamente para Ferramentas de Edição e Cursores NLE**, posicionada na lateral esquerda da timeline, com 6 micro-grupos visuais:
    * **Grupo Seleção:** Seleção (`V`) | Seleção por Caixa (Marquee).
    * **Grupo Faixa:** Selecionar Faixa para Frente (`T`) | para Trás (`Shift+T`).
    * **Grupo Corte & Trims:** Lâmina / Blade (`C`) | Dividir no Playhead (`Z`) | Ripple Trim Head (`Q`) | Ripple Trim Tail (`W`).
    * **Grupo Deslocamento Dinâmico:** Slip (`Y`) | Slide | Rolling Edit (`N`) | Rate Stretch (`R`).
    * **Grupo Criação:** Inserir Título (`Ctrl+T`) | Marcador (`M`).
    * **Grupo Navegação:** Mão / Pan (`H`) | Zoom Tool.
  * Botão de retração `#btn-toggle-toolbar` com linha restauradora vertical de 4px Violeta (`#reopen-toolbar`).
* **Migração de Workspaces Legadas:** Flag `capiau_nle_suite_toolbar_v1` inserida em `main.js` para garantir que o Tool Strip abra por padrão na posição clássica vertical à esquerda, sanando heranças obsoletas do localStorage.

* **Ergonomia & Design System da Tool Strip Vertical:**
  * Encadeamento estrito de altura Flexbox (`.timeline-track-area`, `.timeline-canvas-wrapper` e `.timeline-actions-sidebar` com `flex: 1 1 0%; min-height: 0; height: 100%`) garantindo rolagem interna responsiva.
  * Rolagem amortecida via interpolação *lerp* no `requestAnimationFrame` (`diff * 0.22`) com normalização de `deltaMode` (elimina trancos de linha no Windows).
  * Barra de rolagem visual 100% oculta (`scrollbar-width: none;` e `::-webkit-scrollbar { display: none; }`) preservando os 36px limpos e sem poluição.
  * Ícones de alta definição em SVG inline para as ferramentas de corte/trim (`btn-ripple-trim-head`, `btn-ripple-trim-tail`, `btn-tool-slide`, `btn-tool-rolling`).
  * Posicionamento contextual de tooltips: sempre à **direita** na barra vertical (`left = sidebarRect.right + 10px`) sem encobrir botões vizinhos; e sempre **acima** na barra horizontal (`top = rect.top - height - 8px`) preservando a régua de tempo e agulha 100% livres.

#### 3. Arquivos Modificados
* `[MODIFY]` `src/ui/index.html`: Header `.timeline-header-bar`, Tool Strip `.timeline-actions-sidebar`, botão de recolhimento `#btn-toggle-timeline-header` e linha restauradora `#reopen-timeline-header`. Cache-buster atualizado para `?v=23`.
* `[MODIFY]` `src/ui/styles.css`: Classes flat, compact sliders, hover glows para as ferramentas NLE, encadeamento de alturas flexbox e ocultação de scrollbar na sidebar.
* `[MODIFY]` `src/ui/js/timelineState.js`: Suporte universal em `setTool()` para todas as 11 ferramentas NLE.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Binding e ativação reativa de todas as ferramentas de cursor.
* `[MODIFY]` `src/ui/js/main.js` e `src/ui/js/panels.js`: Sincronização de zoom, renomeação de timeline, handlers de retração/restauração, rolagem suave lerp e motor de tooltips contextuais.

#### 4. Testes Automatizados Executados
* `tests/autoteste_tool_blade.mjs`: 100% de aprovação (validação de DOM, CSS, catálogo, paridade dos 5 presets, Cheat Sheet, matemática de corte, links A/V, J/L-Cuts, travas de pista, corte global e reversibilidade total).
* `tests/autoteste_toolbar_structure.mjs`: 100% de aprovação (validação de 23 controles na Zona 1, 17 controles na Zona 2, ambas as linhas restauradoras `#reopen-toolbar` e `#reopen-timeline-header`, CSS rules e lógica em VM).
* `tests/autoteste_timeline_io.mjs`: 100% de aprovação (regressão zero).

---

## 📋 SESSÃO 1: FERRAMENTAS DE CURSOR DA TIMELINE (MANIPULAÇÃO DIRETA)

---

### Task 1: Ferramenta Lâmina / Gilete (Razor / Blade Tool — Tecla `C`) & Lâmina Global (`Shift+C`)
> **Status:** Concluída e Validada com Sucesso (100% de Autoteste Automatizado e Teste Humano Pronto)

#### 1. Objetivo & Especificação Funcional
* Ferramenta de cursor dedicada **Lâmina** (`blade`), acionável via atalho clássico conforme o perfil ativo e pelo botão `#btn-tool-blade`.
* Cursor do mouse vira estilete de precisão em SVG com guia vertical indicativa (`CURSOR_BLADE_SINGLE` e `CURSOR_BLADE_ALL`).
* Linha vertical tracejada âmbar acompanha o mouse na coordenada do frame exato (com snapping magnético se `S` ativo).
* Ações de corte:
  * **Clique simples:** Divide o clipe específico sob o cursor no frame clicado, cortando também o áudio vinculado se o link estiver ativo.
  * **`Shift + Clique`:** Corta todas as pistas destravadas naquele frame instantaneamente.
  * **`Alt + Clique` (J/L-Cut):** Corta APENAS a pista clicada (ignorando o link A/V), mantendo a parte esquerda unida ao parceiro original e desvinculando a parte direita gerada (`link_id: null`) para edição independente.
* Atalho Global de Corte na Agulha: divide todas as pistas destravadas na agulha instantaneamente.
* Mapeamento Multi-Preset Fiel em `keymapService.js`:
  * **CapIAu:** `tools.blade` (`KeyC`), `tools.blade_global` (`Shift+KeyC`).
  * **Premiere:** `tools.blade` (`KeyC`), `tools.blade_global` (`Ctrl+Shift+KeyK` / `Shift+KeyC`).
  * **DaVinci Resolve:** `tools.blade` (`KeyB`), `tools.blade_global` (`Ctrl+Shift+Backslash` / `Shift+KeyB`).
  * **Final Cut Pro:** `tools.blade` (`KeyB`), `tools.blade_global` (`Ctrl+Shift+KeyB` / `Shift+KeyB`).
  * **Kdenlive:** `tools.blade` (`KeyC` / `Shift+KeyR`), `tools.blade_global` (`Shift+KeyC`).
* Sincronização automática com a **Cheat Sheet & Guia de Atalhos** (`#container-keymap-cheatsheet`), **Teclado Virtual** (camada normal e Shift) e **Editor de Teclas**.
* Suporte a histórico total (`Ctrl+Z` une os segmentos de volta).
* Pressionar **`V`** retorna imediatamente para a Ferramenta de Seleção.

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/timelineState.js`: Métodos `splitClipAtFrame(clipId, frame, splitLinked)` e `splitAllTracksAtFrame(frame)`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização da guia tracejada âmbar (`bladeGuide`) com marcador superior.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Cursores SVG de lâmina (`CURSOR_BLADE_SINGLE` e `CURSOR_BLADE_ALL`), guia no `onMouseMove`, corte no `onMouseDown` e bindings.
* `[MODIFY]` `src/ui/js/keymapService.js`: Cadastro de `tools.blade` e `tools.blade_global` no `COMMANDS_CATALOG` e nos 5 perfis NLE.
* `[MODIFY]` `src/ui/index.html`: Incremento do cache-buster `?v=18`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_tool_blade.mjs`: Validar divisão exata em 2 clipes, par vinculado, trava de pistas, corte multitrilha, `undo()`, presença no `COMMANDS_CATALOG`, validação dos 5 presets de atalhos e integridade da renderização da Cheat Sheet.
* **Teste Manual:** Apertar `C` (ou atalho do preset selecionado), abrir o modal de atalhos (`#btn-timeline-help`) e conferir o atalho refletido na Cheat Sheet e Teclado Virtual, clicar no clipe para corte simples, testar `Shift+clique` cortando todas as faixas, desfazer com `Ctrl+Z` e voltar com `V`.

> [!CAUTION]
> **Checkpoint de Parada 1:** Aguardar aprovação do usuário antes da Task 2.

---

### Task 2: Ferramenta de Seleção por Retângulo / Caixa (Marquee / Box Selection)
> **Status:** Concluída e Validada com Sucesso (100% de Autoteste Automatizado e Teste Humano Aprovado)

#### 1. Objetivo & Especificação Funcional
* Clicar e arrastar em áreas livres da timeline projeta uma caixa pontilhada ciano translúcida.
* Todos os clipes e marcadores interceptados pela caixa entram em `TIMELINE_STATE.selectedClipIds`.
* Modificadores: arraste normal substitui seleção; `Shift + arraste` soma; `Alt + arraste` subtrai.
* Itens selecionados ganham contorno de seleção em bloco e podem ser movidos ou excluídos juntos (`Delete`).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Gerenciamento de `marqueeState` e hit-testing.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Desenho da caixa translúcida no canvas.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_marquee_selection.mjs`: 100% de aprovação (interseção matemática da caixa com clipes e marcadores, Shift/Alt modifiers e persistência).
* **Teste Manual:** Clicar e arrastar sobre clipes, ver a caixa ciano acompanhar o mouse, selecionar em lote, mover e excluir com `Delete`.

> [!NOTE]
> **Checkpoint de Parada 2:** Aprovado e validado com sucesso.

---

### Task 3: Ferramenta Deslizar Conteúdo Interno (Slip Tool — Tecla `Y`)
> **Status:** Concluída, Refinada (A/V Sync Offset com Alt) e Validada com Sucesso (100% de Autoteste Automatizado e Teste Humano Aprovado)

#### 1. Objetivo & Especificação Funcional
* Ferramenta **Slip** (`slip`) ativada por **`Y`** e botão `#btn-tool-slip`.
* Desliza os pontos `inFrame` e `outFrame` dentro da mídia bruta mantendo **a posição e a duração do clipe na timeline rigorosamente inalteradas**.
* Cursor com setas opostas e bordas travadas em SVG de alta definição (`CURSOR_SLIP`) e tooltip numérica de deslocamento em tempo real (ex: `Slip: +12f (+0.50s)`).
* Respeita limites da mídia original (clamping automático no frame 0 e na duração total da mídia).
* Sincronização A/V automática para pares vinculados (`link_id`), com suporte a J/L Slip independente segurando `Alt`.
* Suporte nativo a `syncOffset` no modelo de dados para que deslizes independentes com `Alt` mantenham as posições físicas (`timelineStartFrame`) de vídeo e áudio rigorosamente estáticas na régua.
* Detecção dinâmica da tecla `Alt` durante o arraste (`onMouseMove`) com indicação no tooltip (`Slip (Alt/J-L): +Xf`).
* Suporte a cancelamento por `Escape`, atalho `V` para retornar à seleção e reversibilidade total via `TIMELINE_HISTORY` (Undo/Redo).
* Paridade multi-preset estrita (CapIAu: `Y`, Premiere: `Y`, DaVinci: `Shift+Y`/`Y`, Final Cut: `Y`, Kdenlive: `Y`).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: Método `slipClip(clipId, deltaFrames, slipLinked, baseIn, baseOut, partnerBaseIn, partnerBaseOut)` com recálculo de `syncOffset` para slips desvinculados com `Alt`.
* `[MODIFY]` `src/ui/js/state.js`: Suporte a `syncOffset` na invariante de ancoragem A/V do setter `activeTimelineCuts`, eliminando qualquer deslocamento indesejado do bloco de áudio na timeline.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Constante `CURSOR_SLIP`, método `getSlipCursor()`, detecção dinâmica de `e.altKey`, drag handlers no modo slip, tooltips dinâmicos e cancelamento via `Escape`.
* `[MODIFY]` `src/ui/js/keymapService.js`: Cadastro de `tools.slip` no `COMMANDS_CATALOG` e nos 5 perfis NLE.
* `[MODIFY]` `src/ui/index.html`: Ícone SVG inline no botão `#btn-tool-slip` e incremento de cache-busters para `?v=26`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_tool_slip.mjs`: 100% de aprovação (validação de DOM, CSS, catálogo, paridade multi-preset, Cheat Sheet, matemática de slip, limites de mídia, sincronia A/V, J/L cuts com Alt e preservação de `timelineStartFrame`, travas de pista e reversibilidade via histórico).
* **Teste Manual:** Apertar `Y`, arrastar o miolo de um clipe, conferir o tooltip numérico em tempo real, verificar que o clipe não sai do lugar na régua e que o trecho interno e timecodes foram alterados. Testar `Alt + Arraste` confirmando que apenas a faixa arrastada desliza sem mover o áudio na timeline.

> [!NOTE]
> **Checkpoint de Parada 3:** Aprovado e validado com sucesso.

---

### Task 3.5: Prevenção de Sobreposição de Pistas & Modos de Movimentação (Bloqueio Físico, Sobrescrita e Ripple)
> **Status:** ✅ Concluída e Refinada com 100% de Aprovação em Autoteste (13 Testes Unitários e de Integração) e Regressão Zero

#### 1. Diagnóstico do Problema Herdado & Diretriz NLE
* **Problema:** O código legado permitia que um clipe entrasse dentro do outro na mesma pista durante arrastes e trims, gerando duplicidade visual e falhas de reprodução no player.
* **Diretriz NLE:** Uma pista é rigorosamente unidimensional no tempo. Clipes nunca coexistem ou penetram no mesmo intervalo de frames da mesma pista.
* **Modo Padrão — Bloqueio Físico (`clamp`):**
  * Clipes atuam como blocos sólidos.
  * `trimClipLeft` e `trimClipRight` colidem rigidamente com os vizinhos anterior e posterior e travam sem invadir.
  * `moveClip` não invade o vizinho: bate na borda do clipe adjacente. Ao cruzar o centro do vizinho, salta magneticamente para o próximo gap.
  * **Histerese Direcional (Anti-Flicker):** Uma vez que o clipe pula um obstáculo para a direita (`dragDirection >= 0`), um latch direcional impede que micro-movimentos ou snappings façam o clipe piscar de volta para a posição inicial. O clipe só retorna se o usuário conscientemente inverter a direção do mouse para a esquerda e recuar além do centro do obstáculo.
  * `drag-selection` (Task 2): movimentação em lote limitada pelas barreiras dos clipes fixos das pistas, com suporte a **mudança vertical de pistas** (`resolveGroupTargetTrack`) para subir ou descer a seleção entre pistas (ex: V1 para V2) para desviar de obstáculos.
* **Modos Alternativos com Teclas Modificadoras & Submenu:**
  * **Modo Sobrescrita (`overwrite`):** Selecionável pelo submenu ou segurando **`Shift`** no arraste. Não trava seleção no `onMouseDown`; ao arrastar com Shift, move-se livremente sobre os clipes e, ao soltar, fatia/apara/remove os clipes sob a nova posição sem sobreposição residual. Se o usuário der apenas um clique com Shift sem mover o mouse, alterna a seleção cumulativa.
  * **Modo Inserção Ripple (`ripple`):** Selecionável pelo submenu ou segurando **`Ctrl`** no arraste. Exibe guia/indicador de corte em tempo real no canvas sem mutar os clipes subsequentes durante o arraste (eliminando acúmulo exponencial de frames). Ao soltar o mouse (`onMouseUp`), empurra atomicamente todos os clipes subsequentes abrindo espaço magnético com uma única execução.
* **Submenu Flutuante Fixed na Tool Strip:** Mini flyout / seletor desacoplado do overflow da sidebar (anexado ao `document.body` com `position: fixed; z-index: 999999;`), posicionado via `getBoundingClientRect()`. Abre com hover ou clique com botão direito no botão da ferramenta de Seleção (`#btn-tool-select`), com 3 line icons SVG, glow ciano e tooltips contextuais.
* **Ingestão Segura pela Biblioteca & Localização Visual:**
  * Ao dar duplo clique em um item da biblioteca com agulha sobre faixas já ocupadas, `insertMedia` detecta a colisão e busca automaticamente uma faixa de vídeo livre alternativa (ex: V2).
  * Se todas as faixas estiverem ocupadas naquele ponto, busca o primeiro gap que comporte a duração do clipe ou posiciona no final da timeline, garantindo que clipes nunca caiam sobrepostos.
  * O clipe inserido é imediatamente selecionado, a agulha move-se para seu início, a timeline rola a viewport para deixá-lo no centro da tela (`ensureFrameVisible`) e um toast descritivo informa pista e timecode, garantindo que o usuário nunca perca de vista o clipe adicionado.
* **Compatibilidade com Tasks 2 e 3:**
  * Task 2: Arraste de seleção múltipla passa a respeitar a colisão em bloco (clamp) e permite troca de pistas em bloco.
  * Task 3: Mecânica de Slip mantida 100% isolada e preservação de `syncOffset` em cortes de sobrescrita.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: `dragCollisionMode`, `getTrackGaps(trackId, ignoredClipIds)`, `overwriteTimeRange()`, `rippleInsertTimeRange()`, prevenção de sobreposição em `insertMedia` e `addCut`, seleção automática e foco com `ensureFrameVisible`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Clamping e histerese direcional em `calculateClampedStart`, transição vertical de seleção em `resolveGroupTargetTrack`, remoção de mutação repetida de ripple em `moveClip`, execução atômica no `onMouseUp`, drag não-bloqueante com Shift e acoplamento seguro do flyout flutuante ao `document.body`.
* `[MODIFY]` `src/ui/index.html`: Submenu com 3 line icons SVG acoplado ao `#btn-tool-select`, cache-busters `?v=28`.
* `[MODIFY]` `src/ui/styles.css`: Estilização glassmorphism fixed de alta sobreposição (`z-index: 999999`).

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_clip_collision.mjs`: 13 testes cobrindo 100% dos requisitos (trim clamping, move clamping, pulo magnético de gap, modo overwrite, modo ripple não-cumulativo, histerese anti-flicker, troca de pistas de grupo, ingestão segura da biblioteca, seleção múltipla e histórico).
* **Regressão Zero:** 100% de aprovação em `autoteste_tool_slip.mjs`, `autoteste_marquee_selection.mjs`, `autoteste_tool_blade.mjs` e `autoteste_toolbar_structure.mjs`.
* **Retomada:** Concluída e aprovada esta task, o plano avança para a **Task 3.6 (Modo Inserção Ripple / Ctrl)**.

---

### Task 3.6: Modo Inserção Ripple (`Ctrl`) com Rearrange Swap e Monitor 2-Up
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Aprovação em Autoteste com 20 Testes Unitários/Integração, Correção de Reprodução de Áudio F4 e Commits Atômicos)

#### 1. Diagnóstico do Desafio & Solução Implementada
* **Modo Inserção Ripple (`simulateRipple`):** Enquanto o usuário segura `Ctrl` e move um clipe sobre a timeline, todos os clipes subsequentes da pista (e pistas vinculadas A/V) abrem espaço e se afastam dinamicamente em tempo real, visualizando a fenda de inserção.
* **Rearrange Swap em Fileira Unida:** Ao reordenar clipes colados (ex: arrastar o último clipe para entre o primeiro e o segundo), a simulação opera em duas fases atômicas:
  1. *Ripple Extract na Origem:* Fecha instantaneamente o espaço vazio deixado pela saída do clipe, recuando os clipes subsequentes.
  2. *Ripple Insert/Swap no Destino:* Insere o clipe no ponto alvo trocando as posições sem deixar buracos vazios e sem expandir a cauda da timeline ($Dur_{total} = const$).
* **Sincronia Estrita A/V com `splitLinkMap`:** Movimentações e cortes em Ripple afetam simultaneamente as pistas de vídeo e áudio vinculado, preservando rigorosamente o alinhamento labial e propagando os novos `link_id` compartilhados.
* **Monitor 2-Up Contextual:** Projeta no monitor duplo as emendas Outgoing (Tail) e Incoming (Head) com alta estabilidade contra jitter de ponteiro do mouse.
* **Cancelamento com `Escape` & Commit Atômico no `mouseup`:** Pressionar Escape reverte a timeline e fecha os monitores no mesmo instante; soltar o mouse consolida a operação em uma transação única no `TIMELINE_HISTORY` (Undo/Redo total com `Ctrl+Z` / `Ctrl+Y`).
* **Correção Estrutural de Áudio na Reprodução Contínua (Transições de Clipes):**
  - Eliminado loop de seek infinito em elementos `<audio>` durante trocas de clipe (`el.seeking`).
  - Preservada reprodução contínua direta em cortes contíguos do mesmo arquivo (`isContiguous`) sem recarga inútil de mídia.
  - Isolado o fluxo F4 A/B estritamente para o mesmo clipe.
  - Criado pré-carregamento antecipado de áudio (`_preloadUpcomingAudio`) com janela de 3s no elemento reserva para virada imperceptível de som.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: Algoritmo `simulateRipple`, fallbacks numéricos seguros para `inFrame`/`outFrame`, suporte a extração e inserção swap.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Handlers de arraste para modo `ripple`, ativação do monitor 2-Up contextual, cancelamento por `Escape` e commit no `onMouseUp`.
* `[MODIFY]` `src/ui/js/player.js`: Correções de seek-loop, reprodução contínua de cortes contíguos e pré-carregamento antecipado de áudio.
* `[MODIFY]` `src/ui/index.html`: Cache-busters atualizados para `?v=34`.

#### 3. Teste Automatizado & Manual
* `tests/autoteste_clip_collision.mjs`: Testes 17 a 20 cobrindo 100% dos requisitos de simulação Ripple, Rearrange Swap, 2-Up, sincronia A/V e cancelamento (20/20 testes aprovados).
* `tests/autoteste_player_f4.mjs`: Testes T5 e T6 cobrindo reprodução contínua sem silêncio entre cortes contíguos, jump cuts e troca de mídias (100% aprovados).
* **Retomada:** Concluída e aprovada a Task 3.6, o plano avançou para a **Task 4 (Slide Tool)**.

---

### Task 4: Ferramenta Deslocamento com Compensação (Slide Tool — Tecla `U`)
> **Status:** ✅ Concluída, Refinada e Validada com Sucesso (100% de Autoteste Automatizado com 7 Seções, Correção de Trim A/V e Transição de Cursores)

#### 1. Objetivo & Especificação Funcional
* Ferramenta **Slide** (`slide`), acionada por atalho e botão `#btn-tool-slide` na Tool Strip.
* Move a posição física de um clipe na timeline mantendo seu conteúdo interno (`inFrame`/`outFrame`) e sua duração rigorosamente intactos, compensando o movimento ajustando simultaneamente o ponto de saída (`outFrame`) do vizinho anterior ($Vizinho_L$) e o ponto de entrada (`inFrame` e `timelineStartFrame`) do vizinho posterior ($Vizinho_R$).
* Duração total da timeline e conteúdo do clipe central não se alteram ($Dur_L + Dur_{Mid} + Dur_R = const$).
* Clamping bidirecional seguro: limites físicos de timeline e limites de duração de arquivo bruto de mídia (`maxMediaFrames`).
* Monitor 2-Up contextual ao vivo exibindo Outgoing ($Vizinho_L.outFrame$) e Incoming ($Vizinho_R.inFrame$).
* Sincronia A/V de pares vinculados e modo independente com tecla `Alt`.
* Suporte a histórico (Undo/Redo no `TIMELINE_HISTORY`), cancelamento com `Escape`.
* Paridade multi-preset estrita (CapIAu, Premiere, DaVinci, Final Cut e Kdenlive com tecla **`U`** no `COMMANDS_CATALOG`).
* Correções complementares integradas:
  - Clamping estrito do Trim (V) à duração real da mídia física (`maxMediaFrames`), impedindo repetição estática do último frame.
  - Continuidade de arraste de A/V vinculado no Trim.
  - Resiliência do `EventEmitter` com isolamento `try/catch` em `state.js`, eliminando travamento do cursor `w-resize` e restaurando a transição fluida para o cursor mãozinha (`grab` / `grabbing`).
  - Cursores direcionais pintados para corte em clipes colados (`CURSOR_TRIM_LEFT` e `CURSOR_TRIM_RIGHT`).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: `getMaxMediaFrames(clip)` e método `slideClip(clipId, deltaFrames)` com metadados para o 2-Up.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Handlers de arraste para modo `slide`, monitor 2-Up, cursor SVG `CURSOR_SLIDE`, tooltips dinâmicos, correções de trim A/V e transição de cursores.
* `[MODIFY]` `src/ui/js/keymapService.js`: Comando `tools.slide` registrado no catálogo e tecla `U` nos 5 perfis NLE (resolvida colisão com unlink).
* `[MODIFY]` `src/ui/js/state.js` & `logManager.js`: Isolamento de falhas de listeners no `EventEmitter` e defensiva em logs.
* `[MODIFY]` `src/ui/index.html`: Ícone SVG inline em `#btn-tool-slide`, cursores direcionais e cache-busters `v=37`.

#### 3. Teste Automatizado & Manual
* `tests/autoteste_tool_slide.mjs`: 100% de aprovação em 7 baterias de testes (DOM, CSS, catálogo, perfis NLE, clamping de mídia, matemática de slide simétrico, par A/V, travas de pista e histórico).
* `tests/autoteste_trim_cursor_transition.mjs`: 100% de aprovação (resiliência de eventos, trim -> cursor grab/grabbing e setas direcionais pintadas).

> [!NOTE]
> **Checkpoint de Parada 4:** Concluído, testado e validado. O plano avança para a **Task 5 (Rolling Edit Tool)**.

---

### Task 5: Ferramenta Corte Contínuo Adjacente (Rolling Edit Tool — Tecla `N`)
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Autoteste Automatizado com 7 Seções, 2-Up Monitor, Clamping Quádruplo, J/L Cut, Interação Aprimorada Fora de Emenda e Regressão Zero)

#### 1. Objetivo & Especificação Funcional
* Ferramenta dedicada **Rolling Edit** (`rolling`), acionada pela tecla clássica **`N`** (ou `T` em perfis específicos) e pelo botão `#btn-tool-rolling` na Tool Strip.
* Ajuste de emenda entre dois clipes contíguos ($Clip_A$ à esquerda e $Clip_B$ à direita): arrastar a emenda estende a saída de $Clip_A$ e encurta a entrada de $Clip_B$ (ou vice-versa) no mesmo valor de frames.
* **Invariante Fundamental:** Conservação estrita da timeline ($\text{Dur}_A + \text{Dur}_B = \text{constante}$), sem criação de gaps e sem alterar o tempo total da sequência ou a posição dos demais clipes.
* **Clamping Quádruplo Rígido:** Limites de fim de mídia para $Clip_A$ (`maxMediaFrames`), início de mídia para $Clip_B$ (`inFrame >= 0`), e garantia de duração mínima de 1 frame para ambos.
* **Sincronia A/V Vinculada & J/L Rolling Cut:** Rolagem síncrona de pares vinculados e rolagem independente (J/L-Cut) com a tecla `Alt`.
* **Monitor 2-Up Contextual:** Projeção instantânea das emendas Outgoing (Tail de $Clip_A$) e Incoming (Head de $Clip_B$) no monitor duplo durante o arraste.
* **Guia Visual e Cursor Dedicados:** Linha dupla ciano com tabs superior/inferior renderizada no canvas (`renderer.rollingGuide`), cursor SVG de chaves duplas (`CURSOR_ROLLING`), e tooltip flutuante `#timeline-rolling-tooltip`.
* **Hit-Testing com Janela Confortável ($\pm 8\text{px}$):** Tolerância aumentada para $8\text{px}$ (16px de alvo total) para mira imediata e fluida em telas de alta densidade (High-DPI).
* **Interação Refinada Fora de Emendas (Seek, Seleção e Scrubbing):**
  * **Clique no Corpo do Clipe:** Reposiciona o playhead no frame clicado (`updatePlayhead`), seleciona o clipe e sincroniza o monitor Program e o inspetor.
  * **Clique em Gap / Área Vazia:** Reposiciona o playhead no frame clicado e limpa a seleção de clipes.
  * **Arraste Fora de Emenda (Scrubbing Direto):** Entra em modo de arraste de agulha (`dragState = "scrub"`) com cursor `CURSOR_PLAYHEAD`, atualizando o playhead e o vídeo suavemente sem precisar alternar para a ferramenta de seleção (`V`) ou subir até a régua superior.
  * **Soltura (`onMouseUp`):** Conclui o scrub mantendo o playhead no ponto e restaurando o cursor (`CURSOR_ROLLING` se solto sobre emenda ou `default`).
  * **Cancelamento por `Escape`:** Cancela imediatamente o scrub em andamento ou a operação de rolling edit.
* **Histórico e Cancelamento:** Suporte total a Undo/Redo no `TIMELINE_HISTORY` e cancelamento por `Escape`.
* **Paridade Multi-Preset Fiel:** Registrada no `COMMANDS_CATALOG` (`tools.rolling`) e configurada nos 5 perfis NLE sem conflitos de atalhos.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/index.html`: Ícone SVG com duas linhas verticais paralelas e setas opostas em `#btn-tool-rolling`, elemento `#timeline-rolling-tooltip` e cache-busters `v=39`.
* `[MODIFY]` `src/ui/styles.css`: Estilização de `#timeline-rolling-tooltip` com glow ciano e glassmorphism.
* `[MODIFY]` `src/ui/js/keymapService.js`: Comando `tools.rolling` registrado no catálogo e mapeado para `KeyN` nos 5 perfis NLE (resolvida colisão com snapping).
* `[MODIFY]` `src/ui/js/timelineState.js`: Método `rollingEdit(leftClipId, rightClipId, deltaFrames, syncLinkedAudio, rollingBase)`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização da guia dupla ciano `this.rollingGuide`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Cursor `CURSOR_ROLLING`, detecção de emendas `getRollingHit` com tolerância de 8px, interação fora de emendas (seek, seleção, scrubbing e escape), tooltip flutuante, 2-Up preview, drag handlers e cancelamento por `Escape`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_tool_rolling.mjs`: 100% de aprovação nas 7 baterias de teste (DOM/CSS, catálogo e atalhos multi-preset, matemática e clamping do `rollingEdit`, pares A/V e J/L Cut, travas e histórico, hit-testing a $\pm 8\text{px}$ e tooltips, comportamento fora de emenda na Seção 6.7, transição de ferramentas).
* **Regressão Zero:** Sucesso em `autoteste_tool_slide.mjs`, `autoteste_clip_collision.mjs` e `autoteste_trim_cursor_transition.mjs`.
* **Teste Manual:** Apertar `N`, posicionar o cursor sobre a costura entre dois clipes colados (cursor de chaves duplas aparece), arrastar para a esquerda e direita, conferir preview 2-Up e tooltip, testar com `Alt` para corte J/L independente, clicar no corpo do clipe para mover playhead/selecionar, arrastar pelo corpo para fazer scrub na timeline, desfazer com `Ctrl+Z` e retornar para seleção com `V`.

> [!NOTE]
> **Checkpoint de Parada 5:** Concluído, testado e validado. O plano avança para a **Task 6 (Ferramentas de Navegação: Mão / Pan & Zoom)**.

---

### Task 6: Ferramentas de Navegação: Mão / Pan (`H`), Zoom Tool, Zoom Microscópico até Frames & Zoom to Fit
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Aprovação em Autotestes de Zoom em Frames e Zoom to Fit, Paridade nos 5 Perfis NLE e Resolução de Conflitos de Teclas)

#### 1. Objetivo & Especificação Funcional Entregue
* **Ferramenta Mão / Pan (`hand` / Tecla `H`):**
  * Acionável pelo atalho `H`, pelo botão dedicado `#btn-tool-hand`, segurando a barra de `Espaço` ou com clique e arraste do **Botão do Meio do Mouse (Wheel Click)**.
  * Permite translação contínua horizontal e vertical do canvas (`dragState = "pan"`), navegando por sequências longas sem perigo de selecionar ou mover clipes.
* **Ferramenta Zoom / Lupa (`zoom` / Tecla `Z` em Perfis Clássicos):**
  * Acionável por clique simples para zoom in ($1.4\times$) e `Alt + clique` para zoom out ($0.7\times$), sempre centrado exatamente na coordenada do ponteiro do mouse.
  * Resolução de conflitos de atalho: no perfil CapIAu, o atalho `Z` foi isolado para Split na Agulha (`edit.split`), liberando a Lupa para o botão `#btn-tool-zoom` ou perfis dedicados.
* **Zoom Microscópico da Régua até Nível de Frames (0.01 a 80.0 px/frame):**
  * Expansão do teto de zoom no `TIMELINE_STATE` de 5.0 para 80.0 pixels por frame.
  * Grade adaptativa de timecode na régua desenhando células visuais para cada frame individual em zooms microscópicos, com suporte estrito a FPS fracionário (23.976 e 59.94 fps).
  * Mapeamento exponencial suave do slider horizontal (`#timeline-zoom-slider`).
  * Otimização com viewport culling de miniaturas e formas de onda.
  * Atalhos universais `+` e `-` ancorados na posição da agulha de reprodução, além de rolagem da roda do mouse diretamente sobre a régua (`isOverRuler`).
* **Ajustar Sequência na Tela (Zoom to Fit — `timeline.zoom_fit`):**
  * Enquadramento dinâmico inteligente com margem de respiro de 120px para visualização panorâmica da timeline.
  * Mecânica de Toggle NLE: o 2º acionamento restaura com precisão matemática o nível de zoom e deslocamento anteriores.
  * Botão de acesso rápido `#btn-timeline-zoom-fit` e atalhos em todos os 5 perfis NLE (`\` no Premiere/CapIAu, `Shift+Z` no DaVinci/Final Cut/CapIAu, `Ctrl+Shift+Espaço` no Kdenlive).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: `minZoom` (0.01), `maxZoom` (80.0), `zoomToFit()` com histórico de toggle e métodos de frames.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Régua adaptativa microscópica com células de frames, culling de miniaturas e ondas.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Modos `"hand"` e `"zoom"`, zoom com roda sobre a régua, atalhos `+`/`-` ancorados no playhead.
* `[MODIFY]` `src/ui/js/keymapService.js`: Comandos `tools.hand`, `tools.zoom`, `timeline.zoom_fit`, `timeline.zoom_in/out/reset` registrados no catálogo e nos 5 perfis NLE.
* `[MODIFY]` `src/ui/js/panels.js` & `index.html`: Botão `#btn-timeline-zoom-fit`, slider exponencial, botões `#btn-tool-hand` e `#btn-tool-zoom`.

#### 3. Testes Automatizados Executados
* `tests/autoteste_timeline_frame_zoom.mjs`: 100% de aprovação (limites de 0.01 a 80.0 px/frame, timecode da régua, FPS fracionário, slider exponencial).
* `tests/autoteste_timeline_zoom_fit.mjs`: 100% de aprovação (toggle de restauração, cálculo em sequência vazia/cheia, paridade nos 5 perfis NLE).

---

### Adendo Arquitetural da Sessão 1: Bloco de Speed Editing QWER / ASDF & Clipes Desativados
> **Status:** ✅ Concluído e Integrado (Commits `aa4a5b1` e `a217479`)

Durante a consolidação da Sessão 1, foi implementado o bloco ergonômico de edição rápida da mão esquerda, eliminando atritos de manipulação:
1. **Quick Split no Playhead (`E` e `Z`):** Fatiamento na agulha sem seleção prévia, priorizando a trilha ativa (`selectedTrack`), sincronizando o par A/V e suportando J/L-Cut com `Alt` (`tests/autoteste_split_playhead.mjs`).
2. **Speed Editing QWER / ASDF:**
   * `Q` / `W`: Ripple Trim Head e Tail.
   * `E`: Split no playhead / clipe selecionado.
   * `R`: Ripple Delete inteligente (clipe, gap ou sob a agulha).
   * `Alt+R` / `Delete`: Lift Delete (preserva gap).
   * `Backspace`: Ripple Delete direto.
   * `A` / `S`: Pular para corte anterior / próximo (*Edit Points*).
   * `D`: Selecionar clipe sob a agulha na trilha ativa (`TIMELINE_STATE.getClipAtPlayhead()`).
   * `Shift+D`: Multi-seleção cumulativa de clipes sob a agulha entre pistas (`TIMELINE_STATE.getAllClipsAtPlayhead()`).
   * `F`: Alternar ativação/desativação do clipe (Mute/Bypass).
   * `N` / `Shift+S`: Alternar Snapping magnético.
   * `Shift+N`: Ferramenta Rolling Edit.
3. **Modo "Seleção Acompanha a Agulha" (Selection Follows Playhead):**
   * Alternável por `Ctrl+Alt+P` e pelo botão `#btn-selection-follows-playhead`, sincronizando a seleção em tempo real com o movimento da agulha.
4. **Clipes Desativados (Disabled Clips):**
   * Suporte a `clip.disabled` com renderização visual escurecida com hachura diagonal (`drawDiagonalHatching`), áudio emudecido no preview e bypass no pipeline de exportação.
5. **Autoteste Dedicado:** `tests/autoteste_speed_editing_qwer_asdf.mjs` (100% de aprovação).

> [!NOTE]
> **Checkpoint de Parada da Sessão 1:** Concluída com 100% de sucesso. O plano avança oficialmente para a **Sessão 2: Montagem de 3 e 4 Pontos & Navegação Rápida (Task 7)**.

---

## 📋 SESSÃO 2: MONTAGEM DE 3 E 4 PONTOS & NAVEGAÇÃO RÁPIDA

---

### Task 7: Montagem de Três Pontos: Inserção Ripple (`,`) & Sobrescrita (`.`)
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Aprovação em Autoteste com 8 Seções, Paridade nos 5 Perfis NLE e Histórico Atômico)

#### 1. Objetivo & Especificação Funcional Entregue
* **Vírgula (`,` — Insert Edit / `edit.insert`):**
  * Insere o trecho delimitado por [IN–OUT] do Source Player exatamente na posição da agulha (`playheadFrame`) na pista ativa (`selectedTrack` ou `V1`/`A1`).
  * **Comportamento Ripple:** Se a agulha estiver sobre um clipe ou gap, fatia e afasta atomicamente todos os clipes subsequentes da pista (e pistas vinculadas), abrindo espaço exato para a nova mídia sem perdas nem colisões.
* **Ponto (`.` — Overwrite Edit / `edit.overwrite`):**
  * Insere o trecho delimitado por [IN–OUT] do Source Player na posição da agulha sobrescrevendo qualquer material sob o intervalo correspondente, mantendo a posição e o timecode de todos os demais clipes rigorosamente intactos.
* **Avanço Automático da Agulha (Continuous Storytelling Edit):**
  * Ao concluir a inserção (seja Ripple ou Overwrite), a agulha de reprodução avança automaticamente para o frame final do trecho inserido ($Playhead_{novo} = Playhead_{antigo} + Dur_{source}$), permitindo montagem contínua sequencial imediata.
* **Consumo das Novas Fundações Arquiteturais:**
  * Reutiliza métodos `rippleInsertTimeRange` e `overwriteTimeRange` com `splitLinkMap` para paridade A/V contínua.
  * Respeita a pista selecionada (`selectedTrack`), faixas travadas (`locked: true`) e pares A/V vinculados (`link_id`).
  * **Interoperabilidade Multi-Monitor & Popout (Diretriz 6):** Comunicação 100% orientada a eventos via `STATE` (`sourceInsertRequested`, `sourceOverwriteRequested`), funcionando de forma idêntica com o Source Player embutido no layout principal, em monitor secundário 2-Up ou destacado em janela externa (Popout).
* **Paridade de Atalhos Multi-Preset em `keymapService.js`:**
  * **CapIAu Padrão:** `edit.insert` (`Comma` / `,`), `edit.overwrite` (`Period` / `.`), `edit.toggle_source_audio` (`Ctrl+Alt+A`), `timeline.zoom_reset` (`Ctrl+1`).
  * **Adobe Premiere Pro:** `edit.insert` (`Comma`), `edit.overwrite` (`Period`), `edit.toggle_source_audio` (`Ctrl+Alt+A`).
  * **DaVinci Resolve:** `edit.insert` (`F9` / `Comma`), `edit.overwrite` (`F10` / `Period`), `edit.toggle_source_audio` (`Ctrl+Alt+A`).
  * **Final Cut Pro:** `edit.insert` (`KeyW` / `Comma`), `edit.overwrite` (`KeyD` / `Period`), `edit.toggle_source_audio` (`Ctrl+Alt+A`).
  * **Kdenlive:** `edit.insert` (`KeyV` / `Comma`), `edit.overwrite` (`KeyB` / `Period`), `edit.toggle_source_audio` (`Ctrl+Alt+A`).
* **Seletor de Canais de Três Estados & Áudio Opcional (AV / V / A):**
  * Na inserção/sobrescrita de vídeos, permite escolher os canais transferidos para a Timeline:
    * **`AV` (Áudio + Vídeo):** Cria o par de vídeo na pista ativa (ex: `V1`) e áudio na pista pareada (`A1`), vinculados por `link_id`.
    * **`V` (Somente Vídeo):** Insere unicamente a trilha de vídeo em `V1`, sem tocar ou empurrar as pistas de áudio.
    * **`A` (Somente Áudio):** Insere unicamente o fluxo de áudio em `A1`, sem tocar ou empurrar as pistas de vídeo. Clipes de foto em modo `A` são bloqueados preventivamente com toast informativo.
  * **Botão Cíclico & Atalho Central:** Botão dedicado `#btn-source-toggle-audio` com line icon dinâmico de 3 estados e mini badge (`AV`/`V`/`A`), alternável por clique ou pelo atalho `Ctrl+Alt+A`, persistido via `STATE.sourceStreamMode` no `localStorage`.
* **Histórico e Reversibilidade Atômica:**
  * Suporte a transação única no `TIMELINE_HISTORY`: `_capture()` e `_restore()` preservam com exatidão o `playheadFrame`. Pressionar `Ctrl+Z` desfaz a inserção e restaura a agulha ao frame anterior à operação; `Ctrl+Y` reaplica a inserção e o salto da agulha.
* **Interface & Botões de Ação Flat (Line Icons Puros):**
  * Botões `#btn-source-insert` (Inserir `,`), `#btn-source-overwrite` (Sobrescrever `.`) e `#btn-source-toggle-audio` (Canais de Inserção) na barra de controles do Source Player, desenhados como **line icons puros** (sem rótulos textuais redundantes) com SVG vetorial nítido e hover glow conforme o design system.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/state.js`: Propriedades reativas `sourceStreamMode` (`"av"|"v"|"a"`), `sourceAudioEnabled`, persistência no `localStorage` e método cíclico `cycleSourceStreamMode()`.
* `[MODIFY]` `src/ui/js/timelineState.js`: Métodos `insertSourceClipAtPlayhead(sourceData, isRipple)` e `overwriteSourceClipAtPlayhead(sourceData)`, com suporte completo a canais independentes (`streamMode`: `av`, `v`, `a`), inserção isolada em `A1` sem afetar `V1`, guarda para fotos e persistência de `playheadFrame` no `TimelineHistory`.
* `[MODIFY]` `src/ui/js/player.js`: Métodos `getSourceClipData()`, `insertAtPlayhead()`, `overwriteAtPlayhead()` e `updateStreamModeUI(mode)` em `SourcePlayer`, integração centralizada de atalhos em `PlayerController.handleGlobalKeyboard(e)` para `edit.insert`, `edit.overwrite` e `edit.toggle_source_audio`.
* `[MODIFY]` `src/ui/js/keymapService.js`: Cadastro e atualização de `edit.insert`, `edit.overwrite` e `edit.toggle_source_audio` ("Alternar Canais na Inserção AV / V / A") no catálogo central (`category: "edit"`) e mapeamento em todos os 5 presets NLE.
* `[MODIFY]` `src/ui/index.html`: Botões `#btn-source-toggle-audio` (line icon de 3 estados com badge), `#btn-source-insert` e `#btn-source-overwrite` (line icons puros) no Source Player e incremento dos cache-busters para `?v=45`.
* `[MODIFY]` `src/ui/styles.css`: Estilização flat glassmorphism e hover glows para `.btn-edit-insert`, `.btn-edit-overwrite` e `.btn-source-stream-mode` (com variantes `.mode-av`, `.mode-v` e `.mode-a`).

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_3point_editing.mjs`: 100% de aprovação em 10 baterias de testes:
  1. DOM e CSS (presença dos botões, line icons puros sem spans de texto, cache-buster v=45).
  2. Catálogo e atalhos multi-preset nos 5 perfis NLE da indústria (CapIAu, Premiere, Resolve, FCP, Kdenlive).
  3. Matemática e fatiamento do Ripple Insert (`,`).
  4. Sobrescrita limpa Overwrite (`.`) sem afastamento.
  5. Pares A/V vinculados (`link_id` compartilhado).
  6. Proteção estrita de pistas travadas (`locked: true`).
  7. Histórico atômico completo (Undo/Redo com restauração de `playheadFrame`).
  8. Integração com `SourcePlayer` e marcadores [IN-OUT].
  9. Seletor cíclico de canais de 3 estados (`AV` -> `V` -> `A` -> `AV`) e persistência.
  10. Inserção por canais específicos (`AV`, `V` exclusivo, `A` exclusivo e guarda de fotos).
* **Regressão Zero:** Sucesso de 100% em todas as 28 baterias de testes da suíte (`autoteste_*.mjs`).

> [!NOTE]
> **Checkpoint de Parada 7:** Concluído com 100% de sucesso e autoteste aprovado. O plano avança oficialmente para a **Task 8 (Localizar Quadro Original na Fonte — Match Frame `Alt+F` / `F` & Reverse `Shift+F`)**.

---

### Task 8: Localizar Quadro Original na Fonte (Match Frame — Tecla `Alt+F` / `F`) & Reverse Match Frame (`Shift+F`)

#### 1. Objetivo & Especificação Funcional
* **Match Frame (`edit.match_frame`):**
  * Com a agulha sobre um clipe na timeline, localiza o arquivo bruto na biblioteca e abre instantaneamente no Source Player no mesmo instante exato do corte:
    $$\text{sourceTime} = \frac{\text{inFrame} + (\text{playheadFrame} - \text{timelineStartFrame})}{\text{fps}}$$
  * Os pontos [IN–OUT] originais do clipe da timeline são automaticamente projetados no mini-slider do Source Player para conferência visual de sobras e handles.
* **Reverse Match Frame (`edit.reverse_match_frame` / `Shift+F`):**
  * Do Source Player, localiza onde o frame corrente foi utilizado na timeline ativa e salta a agulha da timeline diretamente para a coordenada correspondente.
* **Mapeamento Ergonômico de Atalhos (Diretriz 7):**
  * **CapIAu Padrão:** `edit.match_frame` (`Alt+KeyF` — preservando a tecla `F` para o Toggle Disable da suíte QWER/ASDF), `edit.reverse_match_frame` (`Shift+KeyF`).
  * **Adobe Premiere Pro:** `edit.match_frame` (`KeyF`), `edit.reverse_match_frame` (`Shift+KeyF`).
  * **DaVinci Resolve:** `edit.match_frame` (`KeyF`), `edit.reverse_match_frame` (`Shift+KeyF`).
  * **Final Cut Pro:** `edit.match_frame` (`Shift+KeyF`), `edit.reverse_match_frame` (`Alt+KeyF`).
  * **Kdenlive:** `edit.match_frame` (`Alt+KeyF`), `edit.reverse_match_frame` (`Shift+KeyF`).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/keymapService.js`:
  * Registro dos comandos `edit.match_frame` e `edit.reverse_match_frame` no catálogo (`COMMANDS_CATALOG`) sob categoria `"edit"`.
  * Mapeamento nos 5 perfis NLE (`capiau`, `premiere`, `resolve`, `finalcut`, `kdenlive`) com 100% de paridade e preservação da ergonomia (no preset `capiau`, `KeyF` preservado para `edit.toggle_clip_disable` e `Alt+KeyF` para Match Frame).
* `[MODIFY]` `src/ui/js/player.js`:
  * Implementação de `matchFrameFromTimeline()` e `reverseMatchFrameFromSource(direction = 1)` em `VideoPlayer`.
  * **Ciclo Contínuo Multi-Ocorrências:** Ao segurar `Shift` e apertar repetidamente `F`, cicla de forma sequencial e infinita por todas as ocorrências na timeline ($1 \to 2 \to 3 \to \dots \to 1$). Suporte a direção reversa (`direction = -1`).
  * **Deduplicação Inteligente de Pares A/V:** Cortes pareados de áudio e vídeo (`link_id`) pertencentes ao mesmo clipe na timeline são contabilizados apenas uma vez (priorizando a pista de vídeo e descartando o áudio parceiro redundante), garantindo que cada tomada corresponda a exatamente uma ocorrência no ciclo, no HUD e no badge.
  * **Mini-HUD Flutuante no Source Player:** Exibe pill minimalista (`#source-reverse-match-hud`) com line icons, tooltips nativos, contador mono (`1/3 · V1 · 00:01:20:00`) e auto-ocultação instantânea ao soltar a tecla `Shift` (`keyup`).
  * **Badge Contador & Popover Dropdown:** Badge ciano no botão `#btn-source-reverse-match` com o total de ocorrências e menu popover (`#popover-reverse-match-list`) permitindo salto direto pelo clique em qualquer instante listado.
  * Integração direta com os subplayers: `SourcePlayer.reverseMatchFrame()` e `ProgramPlayer.matchFrame()`.
  * Tratamento de hierarquia de pistas (respeita `selectedTrack` e desempata por prioridade de pista de vídeo superior V2 > V1 > A2 > A1).
  * Barramento multi-monitor e janelas popout (`STATE.emit("matchFramePerformed")` e `STATE.emit("reverseMatchFramePerformed")`).
  * Tratamento de fallbacks e avisos amigáveis via `showToast`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`:
  * Realce visual temporário (Glow/Pulse) com contorno ciano luminoso (`rgba(6, 182, 212, 0.95)`, `lineWidth: 2.5`, `shadowBlur: 8`) em todos os cortes coincidentes por ~1.8s (`flashMatchOccurrences`).
* `[MODIFY]` `src/ui/index.html` & `src/ui/styles.css`:
  * Botão de apoio no Source Player: `#btn-source-reverse-match` em container relativo com `#badge-source-reverse-match` e `#popover-reverse-match-list`.
  * Botão de apoio no Program Player: `#btn-match-frame` com mira crosshair.
  * Mini-HUD flutuante `#source-reverse-match-hud` com botões chevron, contador e botão lista.
  * Regras CSS dedicadas no design system flat com backdrop-blur e transições sutis.

#### 3. Teste Automatizado & Validação
* `[NEW]` `tests/autoteste_match_frame.mjs`: Suíte completa com 12 blocos cobrindo:
  1. Integridade do DOM, botões e SVGs em `index.html`.
  2. Catálogo de comandos e metadados.
  3. Paridade ergonômica multi-preset nos 5 perfis NLE.
  4. Badges e atalhos na Cheat Sheet.
  4.1 Isolamento de combinação exata no Teclado Virtual (hotfix).
  5. Matemática do Match Frame (conversão timeline ➔ source e projeção de marcadores IN/OUT).
  6. Hierarquia de pistas no Match Frame (`selectedTrack` e V2 > V1).
  7. Fallbacks para gap vazio e mídia ausente.
  8. Matemática do Reverse Match Frame (source ➔ timeline) e seleção de clipe.
  9. Desempate inteligente por proximidade quando a mídia é usada em múltiplos cortes.
  10. Fallbacks de Reverse Match Frame quando o quadro não está na timeline.
  11. Emissão de eventos para popouts e multi-monitor (`STATE.emit`).
  12. Múltiplas ocorrências, ciclo contínuo com Shift mantido, retorno cíclico $3 \to 1$, salto reverso, atualização de badge/HUD, popover dropdown, deduplicação de pares A/V vinculados (`link_id`) e sumiço instantâneo no keyup de Shift.
* **Regressão Zero:** Sucesso de 100% em todas as 31 baterias de testes da suíte (`tests/autoteste_*.mjs`).

> [!NOTE]
> **Checkpoint de Parada 8:** Concluído com 100% de sucesso e autoteste aprovado. O plano avança oficialmente para a **Task 9 (Substituição de Clipe na Timeline — Replace Edit `Ctrl+Shift+R` / Drag com `Alt`)**.

---

### Task 9: Substituição de Clipe na Timeline (Replace Edit — `Ctrl+Shift+R` / Drag com `Alt`)

#### 1. Objetivo & Especificação Funcional
* Substituir um clipe da timeline por outro trecho da biblioteca/Source **preservando automaticamente a duração exata, velocidade, cor e animações (Ken Burns) do clipe antigo**.
* Acionável com atalho `Ctrl+Shift+R` ou arrastando uma mídia segurando `Alt` e soltando sobre o clipe alvo.

#### 2. Modificações Realizadas (Padrão NLE Premiere Pro / DaVinci Resolve)
* `[MODIFY]` `src/ui/js/timelineState.js`: Método `replaceClip(targetClipId, newMediaId, alignMode = "in", options)` — modos `in` / `out`; preserva rigorosamente a duração exata na timeline ($Dur_{nova} = Dur_{antiga}$), velocidade, cor, efeitos (Ken Burns) e sincronia A/V de pares vinculados (com remoção segura de áudio ao substituir vídeo por foto); histórico em transação única de Undo/Redo.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Drop com `Alt` (`tryAltReplaceDrop`) — soltar uma mídia com Alt sobre qualquer clipe da timeline substitui o conteúdo atomicamente sem alterar a posição ou criar gaps. Indicador visual `renderReplaceDragIndicator` com contorno rosa/magenta de realce `[REPLACE]`. Toast instrutivo orientando o uso do **Slip Tool (`Y`)** caso o editor queira deslizar o trecho interno.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização nítida do indicador `[REPLACE]` com selo visual sobre o clipe alvo.
* `[MODIFY]` `src/ui/js/keymapService.js`: Comando `edit.replace_clip` no `COMMANDS_CATALOG` (`category: "edit"`) e mapeamento para **`Ctrl+Shift+KeyR`** nos 5 perfis NLE da indústria (CapIAu, Premiere, Resolve, Final Cut e Kdenlive), visível na Cheat Sheet e no Teclado Virtual.
* `[MODIFY]` `src/ui/js/player.js`: Método `replaceClipFromSource()` em `VideoPlayer` acionado via `Ctrl+Shift+R`, substituindo o clipe ativo na timeline a partir do quadro/marcador do Source Player.
* `[MODIFY]` `src/ui/js/library.js` e `workspaceManager.js`: Guardas `!e.ctrlKey && !e.metaKey` nos handlers de rotação de mídia (`KeyR`), eliminando conflito com `Ctrl+Shift+R`.

> [!NOTE]
> **Decisão Arquitetural & Ergonômica (Substituição da Task 9.1):**
> A tentativa experimental de alternar âncoras [IN–OUT] via `Ctrl` durante o arrasto nativo de arquivo com `Alt` foi descontinuada após constatação de sobrecarga cognitiva (duas mãos ocupadas no mouse e teclado), indução errônea ao uso de setas do teclado e suspensão de decodificação de vídeo do Chromium durante o laço modal `DoDragDrop` no Windows.
> Alinhado ao padrão de mercado (Premiere Pro e DaVinci Resolve), o Replace Edit atua de forma atômica e instantânea; para refinamento do trecho interno após a substituição, utiliza-se a ferramenta **Slip Tool (`Y`)** (Task 3), que projeta o monitor 2-Up com total fluidez a 60fps frame a frame.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_replace_edit.mjs`: Validação de 4 seções:
  1. Verificações estáticas de fiação nos fontes e guardas de rotação.
  2. Catálogo central, atalhos nos 5 perfis NLE da indústria, Cheat Sheet e Teclado Virtual.
  3. Matemática e lógica do `replaceClip` (preservação de duração, Ken Burns, pares A/V, foto vs vídeo, undo/redo atômico e rejeições de segurança).
  4. Interação em tempo real: dragover com Alt, indicador `[REPLACE]`, soltura atômica no alvo e emissão de toast orientativo para o Slip Tool (`Y`).
  * **100% de aprovação** em todos os testes e regressão zero na suíte completa de 36 arquivos (`autoteste_*.mjs`).
* **Teste Manual:**
  1. **Drop com Alt:** Arrastar uma mídia da biblioteca até um clipe da timeline (com efeitos/Ken Burns ou cor). Segurar `Alt` (o clipe se destaca com contorno rosa `[REPLACE]`) e soltar. Conferir substituição instantânea, duração rigorosamente intacta e efeitos preservados.
  2. **Refinamento com Slip (`Y`):** Pressionar `Y`, arrastar o miolo do clipe recém-substituído e conferir o monitor 2-Up respondendo em tempo real.
  3. **Atalho `Ctrl+Shift+R`:** Abrir uma mídia no Source Player, posicionar a agulha no quadro desejado. Clicar no clipe da timeline e apertar `Ctrl+Shift+R` para substituir a partir daquele quadro. Desfazer com `Ctrl+Z`.

> [!CAUTION]
> **Checkpoint de Parada 9:** Concluído, alinhado ao padrão clássico NLE, com 100% de autoteste e regressão zero. Aguardar teste manual do usuário antes da Task 10.

---

### Task 10: Criação de Subclipes na Biblioteca a partir do Source (Subclips — `Ctrl+U`)
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Aprovação em Autoteste com 10 Baterias, Paridade nos 5 Perfis NLE, Roteamento de IA ao Mestre e Limites Rígidos)

#### 1. Objetivo & Especificação Funcional Entregue
* **Criação de Subclipes Virtuais a partir de [IN–OUT] (`edit.create_subclip` / `Ctrl+U`):**
  * A partir de um intervalo delimitado no Source Player, aciona o modal minimalista glassmorphism (`#create-subclip-modal`) para criação instantânea de subclipe virtual.
  * Botão dedicado `#btn-source-create-subclip` na barra de ferramentas do Source Player com line icon nítido de tesoura e atalho universal `Ctrl+U`.
* **Múltiplos Títulos Gerados pelo CapIAu (Chips Interativos):**
  * O modal analisa dinamicamente todos os metadados gerados pelo ecossistema de IA do CapIAu e apresenta chips clicáveis (`.subclip-title-chip`) para escolha imediata do nome:
    1. **`IA Título Curto`:** Título sintetizado da mídia.
    2. **`IA Contextual`:** Título enriquecido com contexto cinematográfico.
    3. **`Fala no Trecho [IN-OUT]`:** Trecho exato da transcrição ASR das palavras faladas no intervalo selecionado.
    4. **`IA Resumo`:** Primeira frase do resumo executivo gerado por IA.
    5. **`IA Descrição`:** Descrição visual sintetizada pela visão multimodal.
    6. **`Padrão NLE`:** Nomenclatura sequencial clássica da indústria (`NomeMidia_sub01`, `_sub02`, etc.).
  * Clicar em qualquer chip preenche instantaneamente o campo de texto editável `#subclip-name-input`.
* **Análise de IA & Decupagem Habilitada em Subclipes (Roteamento Não-Destrutivo ao Mestre):**
  * Subclipes suportam todas as camadas de análise do CapIAu (Transcrição ASR, Visão Multimodal, Detecção Facial, Smart Bins e Metadados/Decupagem).
  * O menu de contexto de subclipes expõe as ações de IA e roteia o processamento automaticamente para `targetMediaId = item.parent_video_id || item.id`, executando sobre o arquivo original em disco sem duplicação de storage.
  * O menu de contexto também oferece *"Localizar Mestre na Biblioteca"*, *"Renomear Subclipe"* e *"Excluir Subclipe da Biblioteca"* (exclusão não-destrutiva sem tocar no disco).
* **Armazenamento e Modelo de Dados:**
  * Subclipes persistem em `localStorage` sob a chave `capiau_virtual_subclips_v1_${projectId}`.
  * O item possui flags `is_subclip: true`, `is_virtual: true`, `parent_video_id`, timecodes `in`/`out`, `duration`, `hard_boundaries` e metadados herdados do vídeo mestre.
* **Exibição na Biblioteca e Galeria:**
  * Cards no modo Grid recebem a classe `.subclip-item`, badge lilás `.badge-subclip` com ícone de tesoura `✂`, tempo útil do trecho e miniatura resolvida a partir de `parent_video_id`.
  * Cards no modo Galeria recebem `.subclip-gallery-item` e badge `.gallery-subclip-badge`.
  * Contador de mídias da biblioteca atualiza dinamicamente incluindo os subclipes virtuais.
* **Operações de Montagem (Drag & Drop e Inserção 3-Pontos):**
  * O payload do dragstart transporta `subclip_id`, `is_subclip: true`, `parent_video_id`, `name` e `hard_boundaries`.
  * Inserção na timeline via soltura direta ou atalhos de 3-pontos (`,` e `.`) preserva o nome customizado do subclipe, prefixo `✂ ` no cabeçalho do clipe e as coordenadas relativas do trecho.
* **Limites Rígidos (Hard Boundaries):**
  * Opção *"Bloquear limites rígidos do subclipe"* (`hard_boundaries: true`).
  * Quando ativada, impede que o editor faça trim além dos pontos [IN-OUT] de criação do subclipe (clamping estrito em `getMaxMediaFrames` e `trimClipLeft`), simulando o comportamento clássico de subclipes isolados do Avid Media Composer e Premiere Pro.
* **Paridade de Atalhos Multi-Preset:**
  * Mapeamento de `edit.create_subclip` para `Ctrl+KeyU` em todos os 5 perfis NLE (`capiau`, `premiere`, `resolve`, `finalcut`, `kdenlive`).

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/keymapService.js`: Comando `edit.create_subclip` cadastrado no catálogo (`category: "edit"`) e mapeado para `Ctrl+KeyU` nos 5 presets NLE.
* `[MODIFY]` `src/ui/index.html`: Botão `#btn-source-create-subclip` no Source Player e modal minimalista `#create-subclip-modal` com chips de sugestões da IA e displays de TC.
* `[MODIFY]` `src/ui/styles.css`: Classes `.badge-subclip`, `.subclip-title-chip`, `.btn-source-create-subclip`, `.subclip-item` e `.subclip-gallery-item`.
* `[MODIFY]` `src/ui/js/library.js`: Funções de persistência, `getCandidateTitlesForSubclip()`, `createSubclip()`, `deleteSubclip()`, `renameSubclip()`, renderização com badges e miniaturas no Grid e Galeria, e menu de contexto com roteamento de IA para `parent_video_id`.
* `[MODIFY]` `src/ui/js/player.js`: Integração com `SourcePlayer` (reprodução e abertura do modal via botão ou `Ctrl+U`), `VideoPlayer.createSubclip()` e listener global no `PlayerController`.
* `[MODIFY]` `src/ui/js/timelineState.js`: Suporte a metadados de subclipe no `insertMedia`, `insertSourceClipAtPlayhead`, `addCut` e clamping de `getMaxMediaFrames` para hard boundaries.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Suporte a subclipes no `onDrop` e restrição física em `trimClipLeft` com hard boundaries.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Exibição de `✂ ` e do nome do subclipe na faixa do clipe na timeline.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_subclips.mjs`: Suíte completa com 10 baterias cobrindo:
  1. Registro e paridade de atalhos NLE (`Ctrl+U` nos 5 perfis).
  2. Elementos DOM e estilos CSS do modal e Source Player.
  3. Geração de múltiplos títulos da IA (curto, contextual, fala ASR, resumo, descrição, sequencial).
  4. Criação e persistência não-destrutiva de subclipe em `localStorage`.
  5. Operações de CRUD (renomear e excluir sem afetar o mestre).
  6. Miniaturas e badges de subclipes na Biblioteca e Galeria.
  7. Reprodução de subclipes e criação no Source Player.
  8. Drag & drop transportando payload com `parent_video_id` e `is_subclip`.
  9. Inserção 3-Pontos na timeline com prefixo `✂ ` e nome customizado.
  10. Bloqueio de Hard Boundaries no Trim e roteamento transparente de camadas de IA.
  * **100% de aprovação (10 de 10 baterias)** e regressão zero comprovada nos testes de Replace Edit, Match Frame e 3-Point Editing.
* **Teste Manual:**
  1. Abrir um vídeo no Source Player, definir pontos IN (`I`) e OUT (`O`).
  2. Pressionar `Ctrl+U` ou clicar no botão de tesoura no Source Player.
  3. No modal, conferir os chips de títulos gerados pela IA (título curto, fala transcrita, resumo, sequencial `_sub01`). Clicar em um chip e conferir o preenchimento imediato.
  4. Marcar a caixa *"Bloquear limites rígidos do subclipe"* e clicar em *"Criar Subclipe"*.
  5. Localizar o novo card na biblioteca com a badge lilás `✂ Subclipe`.
  6. Clicar com o botão direito no subclipe e verificar que as ações de IA (ASR, Visão, Detecção) abrem normalmente apontando para a mídia mestre, além da opção *"Localizar Mestre na Biblioteca"*.
  7. Arrastar o subclipe para a timeline (ou usar `,` ou `.`) e conferir o nome com prefixo `✂ ` e a impossibilidade de esticar o clipe além dos pontos definidos quando hard boundaries estiver ativado.

> [!CAUTION]
> **Checkpoint de Parada 10:** Concluído com 100% de sucesso e autoteste aprovado. Aguardar validação do usuário antes de iniciar a Task 11 (Display de Timecode Interativo & Navegação Numérica `+frames`/`-frames`).

---

### Task 11: Display de Timecode Interativo & Navegação Numérica (`+frames`, `-frames`)
> **Status:** ✅ Concluída e Validada com Sucesso (100% de Aprovação em Autoteste com 17 Baterias, Paridade nos 5 Perfis NLE, Parsing Multi-Sintaxe e Sincronização Segura)

#### 1. Objetivo & Especificação Funcional Entregue
* **Display de Timecode Interativo nos 3 Pontos Neurálgicos:**
  * Displays de tempo do **Source Player** (`#source-current-time`), do **Program Player** (`#program-current-time`) e do **Cabeçalho da Timeline** (`#timeline-current-time` na Zona 1) transformados em elementos interativos (`.interactive-timecode`).
  * Hover sutil com realce ciano e cursor texto (`cursor: text`).
  * Ao clicar ou disparar o atalho, o display se transforma dinamicamente em um input inline estilizado (`.timecode-inline-input`), com seleção automática de texto para edição instantânea.
* **Atalho Global de Navegação para Timecode (`navigation.goto_timecode`):**
  * Acionado via teclado para abrir o foco de digitação direto no monitor ativo (ou na Timeline/Program se o foco estiver na régua ou timeline).
  * Paridade multi-preset em `keymapService.js`:
    * **CapIAu Padrão:** `Ctrl+KeyG`
    * **Adobe Premiere Pro:** `Ctrl+KeyG`
    * **DaVinci Resolve:** `Ctrl+KeyG`
    * **Apple Final Cut Pro:** `Ctrl+KeyP` (e `Ctrl+KeyG` secundário)
    * **Kdenlive:** `Ctrl+KeyG`
* **Motor Universal de Parsing Matemático (`parseTimecodeNavigation`):**
  * **Deslocamento Relativo em Frames:**
    * `+50` avança 50 frames ($F_{novo} = F_{atual} + 50$).
    * `-24` recua 24 frames ($F_{novo} = F_{atual} - 24$).
    * `+0` mantém a posição atual.
  * **Deslocamento Relativo em Segundos:**
    * `+2s` avança 2 segundos ($+2 \times \text{fps}$ frames).
    * `-1.5s` recua 1,5 segundos ($-1.5 \times \text{fps}$ frames).
  * **Notação por Pontos NLE (Shorthand Clássico):**
    * `1.` $\to$ 1 segundo (24 frames a 24fps).
    * `10.` $\to$ 10 segundos (240 frames).
    * `1..` $\to$ 1 minuto (1440 frames).
    * `+1.` / `-2.` $\to$ Deslocamento relativo em segundos via shorthand por pontos.
  * **Timecode SMPTE Absoluto e Relativo:**
    * Formatos completos e compactos: `00:01:23:12`, `01:23:12`, `01:23` (minutos:segundos).
    * Relativo com SMPTE: `+00:00:02:00` ou `-00:01:00:00`.
  * **Tempo Absoluto em Segundos e Frames:**
    * `83s` ou `1.5s` convertido com precisão de taxa de quadros.
    * `150f` salta diretamente para o frame 150.
  * **Shorthand Numérico Puro da Indústria:**
    * Digitação contínua sem pontuação (ex: `12312` $\to$ `01:23:12`, `1200` $\to$ `00:12:00`, `100` $\to$ `00:01:00`, `50` $\to$ 50 frames).
  * **Clamping Bidirecional Seguro:**
    * Limita rigorosamente entre frame 0 e o teto da sequência/mídia ($0 \le F \le \text{maxFrames}$).
  * **Tratamento de Entradas Inválidas e Fallbacks Seguros:**
    * Entradas corrompidas ou strings aleatórias disparam animação suave de *shake* visual (`@keyframes timecodeShake` e `.input-error`), cancelando sem alterar a agulha e sem gerar exceções no console.
* **Micro-Interação, Ergonomia e Sincronização em Tempo Real:**
  * Teclas de Controle no Input:
    * `Enter`: Confirma e salta a agulha instantaneamente.
    * `Escape`: Cancela e restaura a visualização anterior.
    * `ArrowUp` / `ArrowDown`: Ajuste fino frame a frame ($\pm 1$ frame, ou $\pm 10$ frames segurando `Shift`).
    * `blur`: Confirma a entrada se válida ou cancela se vazia.
  * **Guarda Anti-Sobrescrita (`_timecodeInputActive`):**
    * Bloqueia temporariamente os callbacks de `onTimeUpdate` e `timelinePlayheadChanged` no elemento enquanto o usuário estiver digitando, impedindo que a reprodução ou eventos assíncronos apaguem o que está sendo digitado.
  * **Guarda Anti-Colapso no Cabeçalho da Timeline:**
    * Protege cliques ou duplos-cliques na caixa `.timeline-timecode-box` para que o cabeçalho nunca seja recolhido acidentalmente durante a digitação.
  * **Sincronização Perfeita Program Player ➔ Timeline Header:**
    * O display `#timeline-current-time` e `#program-current-time` operam de forma bidirecional e coesa com o `TIMELINE_STATE.playheadFrame`.
  * **Aritmética Nominal de Taxas de Quadros Fracionárias (29.97 / 23.976 / 59.94 fps):**
    * Padrão profissional de timecode NDF (Non-Drop Frame): utiliza a base nominal inteira `fpsBase = Math.round(fps)` (30 para 29.97, 24 para 23.976, 60 para 59.94).
    * Elimina deriva de cálculo e quadros decimais fracionários (ex: frame 150 em 29.97fps é rigorosamente `00:00:05:00`, sem desvios para `149.85`).
    * Ajuste rigoroso da régua: eliminação de ticks duplicados (ex: `00:04:28`), sequenciando fluidamente `00:04:28` $\to$ `00:04:29` $\to$ `00:05:00`. A agulha vermelha e a marcação da régua coincidem com precisão de 100% dos pixels (offset zero).
    * Feedback textual transparente no toast indicando o cálculo em frames e tempo (ex: `+50f = 1s 20f` em 29.97fps).
  * **Histórico de Ações Completo (Undo / Redo — `Ctrl+Z` / `Ctrl+Y`):**
    * Todos os saltos e navegações numéricas registram transações atômicas no `TIMELINE_HISTORY.record()`, permitindo voltar e avançar posições da agulha livremente via `Ctrl+Z` e `Ctrl+Y`.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/keymapService.js`:
  * Adicionado comando `navigation.goto_timecode` ao catálogo `COMMANDS_CATALOG` (`category: "playback"`, rótulo didático e descrição).
  * Mapeamento nos 5 perfis da indústria: `Ctrl+KeyG` (CapIAu, Premiere, Resolve, Kdenlive) e `["Ctrl+KeyP", "Ctrl+KeyG"]` (Final Cut Pro).
* `[MODIFY]` `src/ui/js/player.js`:
  * Funções utilitárias exportadas: `parseTimecodeNavigation(inputStr, currentFrame, fps, maxFrames)` e `setupInteractiveTimecode(el, getContextFn, onCommitFn)`.
  * Tratamento de `Ctrl+KeyG` e `Ctrl+KeyP` dentro do input com `preventDefault()` e `stopPropagation()` para evitar o atalho nativo de busca do navegador (Chrome "Localizar próxima").
  * Interceptação de clique no `#timeline-timecode-box` para redirecionar o foco imediatamente para `#timeline-current-time`.
  * Suporte a histórico de agulha (`TIMELINE_HISTORY.record`) em `ProgramPlayer.jumpToFrame`.
  * Enriquecimento da mensagem de feedback com decomposição de frames para segundos/frames na taxa nominal da timeline.
* `[MODIFY]` `src/ui/js/timelineState.js`:
  * `framesToTimecode`, `formatRulerTimecode` e `timecodeToFrames` atualizados com base nominal `fpsBase = Math.max(1, Math.round(fpsVal))`.
  * Correção do clamp de segundos e eliminação de marcas duplicadas de régua em taxas NTSC fracionárias.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`:
  * Tratamento de `navigation.goto_timecode` na timeline para rotear o foco diretamente ao timecode da timeline.
* `[MODIFY]` `src/ui/index.html`:
  * Inserção do display `#timeline-current-time` dentro da `.timeline-timecode-box` no cabeçalho da timeline (Zona 1).
  * Adição de classes `.interactive-timecode` e tooltips didáticos em `#source-current-time`, `#program-current-time` e `#timeline-current-time`.
  * Incremento do cache-buster para `?v=50` em scripts e folhas de estilo.
* `[MODIFY]` `src/ui/styles.css`:
  * Estilização flat glassmorphism para `.interactive-timecode`, hover glows e estilo nítido de `.timecode-inline-input`.
  * Animação `@keyframes timecodeShake` para rejeição visual de entradas inválidas.
  * Estilização de `.timeline-timecode-box` alinhada aos padrões NLE.
* `[MODIFY]` `src/ui/js/main.js`:
  * Inclusão de `.timeline-timecode-box`, `.interactive-timecode` e `.timecode-inline-input` na guarda de duplo-clique do `#timeline-header-bar` para evitar retração involuntária.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_timecode_input.mjs`: Suíte completa com 17 baterias cobrindo:
  1. Atalho `navigation.goto_timecode` registrado e consistente nos 5 perfis NLE.
  2. Presença de elementos DOM, classes CSS e cache-buster `v=50`.
  3. Parsing de Deslocamento Relativo em Frames (`+50`, `-24`, `+48`, `+0`).
  4. Parsing de Deslocamento Relativo em Segundos (`+2s`, `-1.5s`).
  5. Parsing de Notação por Pontos NLE (`1.`, `10.`, `1..`, `+1.`, `-2.`).
  6. Parsing de Timecode Absoluto SMPTE (`00:01:23:12`, `01:23:12`, `01:23`).
  7. Parsing de Tempo Absoluto em Segundos e Frames (`83s`, `1.5s`, `150f`).
  8. Shorthand NLE Numérico Puro (`12312`, `1200`, `100`, `50`).
  9. Tratamento de Entradas Inválidas e Fallbacks Seguros sem quebra.
  10. Clamping de Limites (Frame $\ge 0$ e `maxFrames`).
  11. Micro-Interação Inline e Ciclo de Vida do Input (Enter/Commit/Cleanup).
  12. Cancelamento com Escape e Ajuste Fino com Setas ($\pm 1$ e $\pm 10$ com Shift).
  13. Sincronização entre Timeline Header e Program Player com guarda anti-colapso.
  14. Precisão Absoluta em Timelines 29.97 fps (NTSC / NDF Base 30, frames 150 e 1184 exatos, régua sem duplicatas).
  15. Aritmética de Deslocamento Relativo a 29.97 fps ($+50 \to 1\text{s } 20\text{f}$; $+50 \to 3\text{s } 10\text{f}$).
  16. Histórico de Ações (`Ctrl+Z` / Undo e `Ctrl+Y` / Redo) ao pular playhead via timecode.
  17. Interceptação e Ciclo de Vida do Atalho `Ctrl+G` e Estabilidade do Input (prevenção contra caixa nativa do Chrome).
  * **100% de aprovação (17 de 17 baterias)**.
* **Regressão Zero:** Sucesso comprovado na re-execução dos testes `autoteste_toolbar_structure.mjs`, `autoteste_subclips.mjs`, `autoteste_replace_edit.mjs`, `autoteste_match_frame.mjs` e `autoteste_3point_editing.mjs`.
* **Roteiro de Teste Manual (Checkpoint de Parada):**
  1. **Navegação Absoluta no Program Player / Timeline Header:**
     - Clicar no timecode do Program Player ou no cabeçalho da timeline (`00:00:00:00`).
     - O texto é selecionado com cursor de digitação.
     - Digitar `00:00:05:00` (ou `5.`) e dar `Enter`.
     - Em uma timeline de 29.97fps, o playhead salta com 100% de precisão de pixel exatamente para o frame 150 sobre a marca `00:05:00` da régua.
  2. **Navegação Relativa (`+` e `-`) e Entendimento da Aritmética:**
     - A partir do zero, abrir o timecode, digitar `+50` e pressionar `Enter`.
     - A agulha avança 50 frames para `00:00:01:20` (pois 50 frames a 30fps nominal = 1 segundo e 20 quadros) e o toast confirma: `Playhead: 00:00:01:20 (+50f = 1s 20f)`.
     - Digitar `+50` novamente $\to$ a agulha avança para `00:00:03:10` (100 frames = 3 segundos de 30f + 10 quadros).
  3. **Desfazer com `Ctrl+Z`:**
     - Pressionar `Ctrl+Z` $\to$ a agulha recua de volta para `00:00:01:20`.
     - Pressionar `Ctrl+Z` novamente $\to$ a agulha recua de volta para `00:00:00:00`.
     - Pressionar `Ctrl+Y` $\to$ a agulha refaz para `00:00:01:20`.
  4. **Atalho `Ctrl+G` sem Interrupção do Navegador:**
     - Pressionar `Ctrl+G` $\to$ o display abre o input diretamente sem interferência do Chrome (sem janela de "Buscar na página").
     - Pressionar `Ctrl+G` novamente $\to$ o input fecha e restaura o display limpo.
  5. **Cancelamento com Escape e Rejeição Segura:**
     - Clicar no timecode, digitar `abc` ou texto corrompido e pressionar `Enter` $\to$ o input vibra suavemente (*shake*) sem alterar a agulha.
     - Pressionar `Escape` $\to$ o input é cancelado e restaura o timecode original sem sobressaltos.
  6. **Navegação no Source Player:**
     - Abrir um clipe no Source Player, clicar no timecode `#source-current-time`.
     - Digitar `+2s` e dar `Enter` $\to$ o vídeo avança 2 segundos dentro da mídia fonte.

> [!NOTE]
> **Checkpoint de Parada 11:** Concluído e homologado com 100% de sucesso (17/17 baterias no autoteste). O plano avança oficialmente para a **Sessão 3 (Task 12: Congelar Quadro / Freeze Frame)**.

---

## 📋 SESSÃO 3: TEMPO, VELOCIDADE & IMAGEM ESTÁTICA

---

### Task 12: Congelar Quadro (Freeze Frame / Hold Frame — `Ctrl+Shift+F`)
> **Status:** ✅ Concluída e Validada com Sucesso (10/10 baterias no `autoteste_freeze_frame.mjs` e Homologação Manual Aprovada)

#### 1. Objetivo & Especificação Funcional
* Capturar o frame exato sob a agulha do clipe ativo e gerar um clipe estático (still) na timeline.
* Duração configurável (padrão 3s) inserida em modo Ripple ou Overwrite.
* Suporte completo a Undo/Redo (`Ctrl+Z` / `Ctrl+Y`) atômico.
* Miniaturas contínuas idênticas no Filmstrip da timeline e rótulo temático `❄ [Freeze 3.0s] <nome>`.
* Reprodução estática no Program Player mantendo o buffer de vídeo pausado no quadro congelado durante o Play, com retomada suave.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/timelineState.js`: Implementado método `createFreezeFrameCut(clipId, playheadFrame, durationSec, mode)`.
* `[MODIFY]` `src/ui/js/keymapService.js`: Cadastrado comando `edit.freeze_frame` e mapeado como `Ctrl+Shift+KeyF` nos 5 perfis NLE (`capiau`, `kdenlive`, `premiere`, `resolve`, `finalcut`).
* `[MODIFY]` `src/ui/js/player.js`: Suporte a reprodução de quadros congelados (`_targetSecondsFor` constante e pausa de buffer em `_prepareBuffer`) e atalho `Ctrl+Shift+F` via `freezeFrameAtPlayhead()`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização de miniaturas idênticas ao longo do clipe congelado, rótulo com ícone `❄` e faixa superior em azul glacial (`#38bdf8`).
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Ligação do botão `#btn-freeze-frame` na toolbar e inclusão da opção *"Congelar Quadro"* no menu de contexto do clipe.
* `[MODIFY]` `src/ui/index.html`: Inserido botão `#btn-freeze-frame` com ícone `fa-snowflake` no Grupo 3 da toolbar e atualizado cache-buster para `v=51`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_freeze_frame.mjs`: Validado com 10/10 baterias aprovadas (catálogo, 5 perfis NLE, ripple com áudio vinculado, overwrite, durações variáveis, undo/redo, miniaturas e playback).
* **Teste Manual:** Pausar vídeo em cena com movimento, apertar `Ctrl+Shift+F` (ou clicar no ícone de floco de neve na toolbar), dar Play (`Space`) e ver o congelamento de 3s e retomada suave no clipe seguinte.

> [!NOTE]
> **Checkpoint de Parada 12:** Concluído, testado e validado com sucesso. O plano avança oficialmente para a **Task 13 (Velocidade Individual do Clipe / Speed & Duration)**.

---

### Task 13: Velocidade Individual do Clipe (Clip Speed / Duration) & Reverse
> **Status:** ✅ Concluída e Validada com Sucesso (21/21 baterias no `autoteste_clip_speed.mjs`) — Parada Obrigatória para Teste Manual Guiado

#### 1. Objetivo & Especificação Funcional
* Diálogo flutuante profissional de velocidade e duração do clipe (`#clip-speed-modal` com `.floating-speed-dialog`), acionável via menu de contexto do clipe (*"Velocidade / Duração..."*) ou atalho `Ctrl+R`.
* **Janela Flutuante Não-Bloqueante & Móvel (Draggable):**
  * Não escurece e não desfoca o fundo da aplicação (`position: fixed; pointer-events: auto;`), permitindo edições contínuas e inspeção na timeline simultaneamente.
  * Arrastável pela barra de título (`#clip-speed-header`), adaptando-se a qualquer posição na tela.
  * Mantém o foco no **Program Player** durante o uso: ao pressionar a barra de espaço, reproduz imediatamente a agulha da timeline (em vez do Source Player).
* **Preenchimento Instantâneo de Lacunas na Pista (Fit to Gap — `Ctrl+Alt+R`):**
  * Opções contextuais no clique direito e atalho dedicado `edit.fit_to_gap` (`Ctrl+Alt+R` / `Cmd+Alt+R` nos 5 perfis NLE) executam o preenchimento de espaço vazio **automaticamente e de forma instantânea**, sem abrir o modal.
  * Detecta lacunas vazias na pista ao redor do clipe ativo:
    - **Para Trás**: estende a cabeça para trás até encostar no clipe anterior (ou frame 0), desacelerando proporcionalmente.
    - **Para Frente**: estende a cauda para frente até encostar no próximo clipe da pista, desacelerando proporcionalmente.
    - **Ambos os Lados / Auto**: estende simetricamente o clipe cobrindo ambas as lacunas sem deslocar a timeline.
  * Emissão de toast informativo com a velocidade resultante e recálculo da agulha na posição proporcional interna.
  * O modal flutuante (`#clip-speed-gap-container`) continua com botões de prévia para inspeção manual quando desejado.
* **Posição Relativa da Agulha (Playhead Tracking):**
  * Ao ajustar a velocidade ou preencher espaços, a agulha da timeline reposiciona-se dinamicamente para acompanhar a mesma posição proporcional interna do clipe ($\alpha = \Delta P / \text{oldDur}$), preservando o mesmo quadro visual e contexto narrativo no Program Player.
* **Persistência do Modo de Timeline:**
  * O modo selecionado ("Cortar" ou "Deslocar") é memorizado em `TIMELINE_STATE._lastClipSpeedMode`, não retornando automaticamente para "Deslocar" após aplicar alterações ou ao inspecionar outros clipes.
* **Duplo Clique no Slider para Reset a 100%:**
  * O slider contínuo de velocidade possui suporte a duplo clique para retornar instantaneamente a 100% (1.0x normal).
* **Vínculo Proporcional Bidirecional:**
  * Alterar a velocidade percentual recalcula a duração em timecode (`00:00:00:00`).
  * Alterar a duração recalcula a velocidade percentual de forma recíproca.
  * Botão de cadeado/trava (`#btn-clip-speed-lock`) para ativar ou desativar o vínculo proporcional.
  * Preservação da base de mídia original (`source_duration_frames`) para evitar desvios cumulativos de arredondamento em sucessivas conversões (ex: 100% $\to$ 50% $\to$ 200% $\to$ 100%).
* **Presets Rápidos e Slider Contínuo:**
  * Botões de 25% (0.25x), 50% (Câmera Lenta), 100% (Normal), 200% (2x Rápido) e 400% (4x Hiper).
  * Slider contínuo de 10% a 500% para ajuste fluido e instantâneo.
* **Comportamento na Timeline: Ripple vs Manter Tamanho (Cut):**
  * Opção **Deslocar (Ripple)** (`#rad-clip-speed-ripple`): empurra ou puxa clipes posteriores por `deltaFrames` em todas as pistas sincronizadas.
  * Opção **Cortar (Manter Tam.)** (`#rad-clip-speed-cut`): preserva rigorosamente a duração total da timeline. Ao desacelerar/expandir, corta a cabeça dos clipes posteriores que colidirem; ao acelerar/encolher, os clipes subsequentes mantêm sua posição exata na régua.
* **Reprodução Reversa (Reverse Clip):**
  * Checkbox *"Inverter reprodução (Reverse)"* (`reverse: true`).
  * Cálculo de tempo reverso em `_targetSecondsFor` no `ProgramPlayer` (da cauda `outSec` para a cabeça `inSec`).
  * Amostragem invertida no Filmstrip da timeline e faixa superior rose (`rgba(244, 63, 94, 0.95)`).
* **Badges em Vermelho no Canvas da Timeline:**
  * Porcentagem de velocidade e reverso renderizados em vermelho vibrante (`#ef4444`) no topo dos clipes: `⚡[50%]`, `⚡[200%]`, `◀◀[REV]`, `⚡[50% REV]`.
* **Preservação de Áudio & Sincronia A/V:**
  * Checkbox *"Manter afinação de áudio (Pitch Correction)"* acionando `el.preservesPitch = true`.
  * Sincronização automática de pares A/V vinculados (`link_id`) com deslocamento recíproco.
* **Undo / Redo Atômico:**
  * Reversão e reaplicação integral em um único passo via `TIMELINE_HISTORY`.
* **Paridade nos 5 Perfis NLE:**
  * Mapeamento de `edit.clip_speed` como `Ctrl+KeyR` e `edit.fit_to_gap` como `Ctrl+Alt+KeyR` nos 5 perfis (`capiau`, `kdenlive`, `premiere`, `resolve`, `finalcut`).
  * Intercepção mandatória com `e.preventDefault()` em `PlayerController.handleGlobalKeyboard` evitando atalhos nativos do navegador.

#### 2. Modificações Realizadas
* `[MODIFY]` `src/ui/js/keymapService.js`: Cadastrado comando `edit.clip_speed` (`Ctrl+R`) e `edit.fit_to_gap` (`Ctrl+Alt+R`) no catálogo central e mapeados com paridade nos 5 perfis NLE.
* `[MODIFY]` `src/ui/index.html`: Diálogo flutuante draggable `#clip-speed-modal` (`.floating-speed-dialog`), opções de rádio Ripple/Cut, container de preenchimento de lacunas (`#clip-speed-gap-container`), tooltips no slider e cache-buster atualizado para `v=61`.
* `[MODIFY]` `src/ui/styles.css`: Estilos `.floating-speed-dialog`, `.speed-preset-btn`, `.btn-speed-lock` e `.btn-gap-fill`.
* `[MODIFY]` `src/ui/js/timelineState.js`: Implementado método `changeClipSpeed(clipId, options)` e `fillTrackGap(clipId, direction)` com suporte a `mode: "ripple"` e `mode: "cut"`, `newTimelineStartFrame`, reposicionamento relativo da agulha `this.setPlayheadFrame()`, persistência de `_lastClipSpeedMode`, `source_duration_frames`, sincronia `link_id` e gravação atômica em `TIMELINE_HISTORY`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Adicionado item no menu de contexto (*"Velocidade / Duração... (Ctrl+R)"* e opções de *"Preencher Espaço na Trilha... (Ctrl+Alt+R)"* executadas diretamente sem abrir o modal), método `openClipSpeedDialog(clipId)`, duplo clique no slider para 100%, janela arrastável e foco no Program Player.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização de badges visuais em vermelho (`#ef4444`), faixa rose para clipes reversos e amostragem invertida no filmstrip.
* `[MODIFY]` `src/ui/js/player.js`:
  * Intercepção de `edit.clip_speed` (`Ctrl+R`) e `edit.fit_to_gap` (`Ctrl+Alt+R`) com `e.preventDefault()` em `handleGlobalKeyboard`.
  * Foco prioritário no `programPlayer` ao abrir o diálogo e ao pressionar Barra de Espaço.
  * Cálculo reverso e escalonado em `_targetSecondsFor`.
  * Controle de velocidade efetiva (`effectiveRate`) e pausa do buffer durante reprodução reversa em `_prepareBuffer`.
  * Ajuste de `targetSeconds`, `isHighSpeedOrReverse` e `el.preservesPitch` em `_syncAudioPool`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_clip_speed.mjs`: Validado com 21/21 baterias aprovadas (100% de sucesso).
* **Teste Manual Guiado:**
  1. **Preenchimento Automático Sem Modal (Botão Direito):** Clicar com botão direito em um clipe que tenha espaço vazio antes ou depois $\to$ clicar em *"⚡ Preencher Espaço na Trilha..."*. O espaço é preenchido instantaneamente, recalculando a velocidade e emitindo um toast explicativo sem abrir nenhum modal.
  2. **Atalho `Ctrl+Alt+R`:** Selecionar um clipe com espaço na pista e pressionar `Ctrl+Alt+R` $\to$ o clipe expande automaticamente para preencher o espaço disponível.
  3. **Abertura do Painel Flutuante:** Pressionar `Ctrl+R` ou clicar com botão direito $\to$ *"Velocidade / Duração..."*. A janela abre sem escurecer nem desfocar a tela e pode ser arrastada livremente.
  4. **Duplo Clique no Slider:** Mover o slider para qualquer valor e dar duplo clique nele $\to$ reseta na hora para 100%.
  5. **Posição Relativa da Agulha:** Posicionar a agulha no meio do clipe e alterar a velocidade $\to$ a agulha reposiciona-se exatamente na mesma posição temporal relativa da cena.
  6. **Persistência do Modo Cortar:** Selecionar *"Cortar (Manter Tam.)"* $\to$ a opção fica memorizada e não reverte para *"Deslocar"*.
  7. **Badges Vermelhos & Barra de Espaço:** As tags de velocidade são renderizadas em vermelho `#ef4444` e a Barra de Espaço reproduz a timeline.
  8. **Desfazer com `Ctrl+Z`:** Pressionar `Ctrl+Z` desfaz qualquer preenchimento ou alteração de velocidade e restaura a agulha em 1 passo atômico.

> [!CAUTION]
> **Checkpoint de Parada 13:** Concluído com 100% de sucesso e autoteste aprovado (21/21 baterias). Conforme a Regra de Ouro do desenvolvimento (Seção 1), o sistema para obrigatoriamente aqui para validação e aprovação do usuário antes de iniciar a Task 14 (Ferramenta Esticar / Comprimir Taxa — Rate Stretch Tool).

---

### Task 14: Ferramenta Esticar / Comprimir Taxa (Rate Stretch Tool — Tecla `Shift+R` / `R`)
> **Status:** ✅ Concluída e Validada com Sucesso (13/13 baterias no `autoteste_tool_rate_stretch.mjs` e Homologação Manual Aprovada)

#### 1. Objetivo & Especificação Funcional Implementada
* **Ferramenta Rate Stretch (`rate-stretch`) na Tool Strip:**
  * Botão `#btn-tool-rate-stretch` com ícone SVG vetorial inline representando relógio clássico e colchetes direcionais de taxa.
  * Ativação e transição fluida sem bloqueio de foco (`refocusTimeline`), com tooltip enriquecido via `data-tooltip`.
* **Mapeamento nos 5 Perfis NLE (Diretriz 5):**
  * `capiau`: `Shift+KeyR` e `KeyX` (preserva a tecla `KeyR` para o Ripple Delete Inteligente da suíte QWER/ASDF).
  * `premiere`: `KeyR`.
  * `resolve`: `KeyR` e `Shift+KeyR`.
  * `finalcut`: `KeyR`.
  * `kdenlive`: `Shift+KeyR`.
* **Manipulação Direta na Linha do Tempo & Feedback:**
  * Detecção inteligente de borda ao pairar ou clicar: metade esquerda ativa `rate-stretch-left`, metade direita ativa `rate-stretch-right`.
  * Cursores SVG direcionais de alta definição embutidos em base64 (`CURSOR_RATE_STRETCH_RIGHT` e `CURSOR_RATE_STRETCH_LEFT`).
  * Tooltip flutuante em tempo real `#timeline-rate-stretch-tooltip` exibindo taxa resultante em `%` (ex: `50.0%`), multiplicador (ex: `0.50x`), duração final em segundos e delta de quadros.
* **Cálculo Matemático e Sincronia de Áudio:**
  * Relação proporcional estrita: $\text{speed} = \frac{\mathbf{source\_duration\_frames}}{\text{newDurationFrames}}$.
  * **Esticamento (Câmera Lenta):** expande duração até 10% de velocidade (0.1x).
  * **Compressão (Aceleração / Fast Motion):** reduz duração até 1000% de velocidade (10.0x).
  * **Pares A/V Vinculados (`link_id`):** vídeo e áudio esticam juntos em sincronia perfeita com preservação de afinação (`preservesPitch = true`).
  * **Modo Desvinculado (`Alt + Arraste`):** estica ou comprime exclusivamente a trilha clicada sem alterar o parceiro vinculado.
  * **Clamping de Colisão & Snapping:** respeita vizinhos na mesma trilha (Fit to Gap manual) e se alinha magneticamente à agulha ou marcadores.
  * **Proteção de Pistas:** rejeita edição com aviso sonoro/toast caso a pista esteja travada com cadeado.
* **Reversibilidade & Cancelamento:**
  * Integração atômica com `TIMELINE_HISTORY`: `Ctrl+Z` (Undo) e `Ctrl+Y` (Redo) restauram precisamente velocidade, duração e início.
  * Tecla `Escape` cancela o arraste em andamento restaurando os parâmetros originais sem sujeira.
  * Tecla `V` retorna instantaneamente para a Ferramenta de Seleção.

#### 2. Modificações Efetuadas
* `[MODIFY]` `src/ui/js/keymapService.js`: Adicionado `tools.rate_stretch` ao `COMMANDS_CATALOG` e mapeado nos 5 perfis NLE; proteção contra `eventKey` indefinido.
* `[MODIFY]` `src/ui/index.html`: Botão `#btn-tool-rate-stretch` atualizado com SVG inline de alta fidelidade e cache-buster atualizado (`?v=65`).
* `[MODIFY]` `src/ui/styles.css`: Estilização premium com backdrop-filter para `#timeline-rate-stretch-tooltip`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Implementação completa do ciclo de vida da ferramenta (`onMouseDown`, `onMouseMove`, `onMouseUp`, `onKeyDown`, cursores SVG, tooltip flutuante e cancelamento por `Escape`).
* `[MODIFY]` `src/ui/js/timelineState.js`: Suporte à flag `updateLinked: false` em `changeClipSpeed` para permitir esticamento independente com tecla `Alt`.
* `[NEW]` `tests/autoteste_tool_rate_stretch.mjs`: Bateria com 13 testes cobrindo DOM, atalhos, 5 perfis, cursores, esticamento, compressão, A/V vinculado, Alt, cadeado, clampings, histórico e teclado.

#### 3. Roteiro de Teste Manual Guiado para o Usuário
1. Abra o CapIAu no navegador e carregue um clipe na timeline.
2. Pressione **`Shift+R`** (ou clique no botão do relógio com colchetes na Tool Strip vertical). Observe o cursor mudar para o ícone de Rate Stretch.
3. Posicione o cursor na **borda direita** do clipe e arraste para a **direita**:
   * O tooltip flutuante exibirá a taxa diminuindo (ex: `66.7%`, `50.0%`).
   * Ao soltar, o clipe dobra de tamanho e a reprodução fica em câmera lenta com áudio com tom corrigido.
4. Arraste a mesma borda para a **esquerda**:
   * O tooltip exibirá a velocidade aumentando (ex: `150%`, `200%`).
   * O clipe encolhe e o badge na timeline exibirá a porcentagem em vermelho.
5. Segure **`Alt`** e arraste apenas o clipe de vídeo:
   * Observe que apenas o vídeo é alterado de velocidade, mantendo o áudio fixo.
6. Pressione **`Ctrl+Z`** e confira a restauração exata do estado anterior. Pressione **`V`** para voltar à ferramenta Seleção.

> [!NOTE]
> **Checkpoint de Parada 14:** Concluído, testado e validado com sucesso. O plano avança oficialmente para a **Sessão 4 (Transições de Áudio e Vídeo)**.

---

## 📋 SESSÃO 4: TRANSIÇÕES DE JUNÇÃO, CAMADAS DE AJUSTE & GERADORES

---

### Task 15: Crossfade de Áudio de Junção com Potência Constante (`Ctrl+Shift+D`)
> **Status:** ✅ **Concluída e Homologada** (17/17 baterias aprovadas no `autoteste_audio_crossfade.mjs` + homologação manual)

#### 1. Objetivo & Especificação Funcional
* Transição de **Crossfade de Áudio** na emenda entre dois clipes contíguos de áudio.
* Curva de **Potência Constante** (*Equal-Power Crossfade*):
  $$\text{Gain}_{\text{out}}(t) = \cos\left(\frac{\pi t}{2}\right) = \sin\left(\frac{(1-t)\pi}{2}\right), \quad \text{Gain}_{\text{in}}(t) = \sin\left(\frac{\pi t}{2}\right)$$
  Elimina a queda de volume no meio do corte ($\text{Gain}_{\text{out}}^2 + \text{Gain}_{\text{in}}^2 = 1.0$).
* Representação visual no canvas com curvas cruzadas ciano/verde esmeralda sobre as waveforms e alças laterais táteis (Bracket Handles).
* Atalho universal `Ctrl+Shift+D` registrado nos 5 presets (`capiau`, `kdenlive`, `premiere`, `resolve`, `finalcut`).

#### 2. Refinamentos e Resolução de Feedback Manual Concluídos

##### A. Ciclo de Vida do Áudio e Pausa Instantânea no `player.js`
- Verificação de fonte e carregamento (`srcChanged`, `el.src = audioSrc`, `el.load()`, `el.dataset.activeClipId = String(cut.id)`) movidos para **antes** da parada condicional de `targetSeconds < 0`.
- Quando `targetSeconds < 0` (antes do corte para mídias sem head handles): o elemento secundário (`elTrans`) é mantido carregado com a URL do segundo clipe em buffer quente, pausado em `currentTime = 0` e com `volume = 0`.
- No ponto exato do corte, dispara reprodução instantaneamente a partir de 0s com volume modulado pela curva equal-power, garantindo zero atraso, zero engasgo e zero silêncio.
- Na saída da transição, `elTrans` é promovido sem recarga diretamente para `this.audioPool[track.id]`, preservando continuidade acústica total.
- **Pausa Total Imediata:** No método `ProgramPlayer.pause()`, foi implementada a pausa forçada de todos os elementos em `this.audioTransitionPool` e `this._paresAudio`, cessando instantaneamente qualquer áudio de transição secundário ao pausar com `Espaço`, `K`, `shuttleStop` ou seek.

##### B. Teto Mútuo Cruzado e Margem de Segurança Tátil
- **Teto Mútuo Cruzado ($\text{maxMutualCap}$):**
  - Em um corte entre clipes com durações diferentes (ex: Clipe A = 2s / 48 quadros e Clipe B = 30s / 720 quadros), nenhum dos lados pode expandir além da extensão física do clipe parceiro:
    $$\text{maxMutualCap} = \min(\text{durAClip} - \text{margin}, \text{durBClip} - \text{margin})$$
  - Impede que o Lado B adentre centenas de quadros além do comprimento total do clipe A (pois não há áudio existente de A para fade-out além de sua duração total).
- **Margem Tátil de Segurança (`safetyMargin`):**
  - Reserva dinâmica de 4 quadros (mínimo de 1 quadro para clipes ultracurtos) entre o limite da transição e a extremidade física do clipe.
  - Impede que a transição cole no pixel idêntico da borda do clipe, garantindo espaço livre e clicável para aparo (*trim*).

##### C. Discriminação de Hit-Testing e Cursor Dedicado (`CURSOR_TRANSITION_RESIZE`)
- **Tolerância Adaptativa por Zoom:** `getTransitionHit` ajusta a tolerância em frames conforme o nível de zoom da timeline ($\approx 6\text{px}$ na tela), evitando zonas de captura hipertrofiadas em zoom aberto.
- **Prioridade ao Trim do Clipe:** Quando o mouse se posiciona sobre a extremidade ou costura do clipe (`trimHit`) e a transição **não** está selecionada, o editor prioriza o aparo do clipe com `CURSOR_TRIM_LEFT`/`CURSOR_TRIM_RIGHT`.
- **Alças da Transição e Cursor SVG:** Quando a transição está selecionada ou o hover ocorre sobre suas alças laterais, exibe o cursor SVG dedicado `CURSOR_TRANSITION_RESIZE` com badge e setas de transição distintas.
- **Renderização Visual no Canvas (`drawTransitions`):**
  - Alças táteis em formato de colchete/bracket NLE com cor ciano/esmeralda sólida nas bordas.
  - Linha de feedback visual âmbar (`#f59e0b`) nas bordas quando o limite físico mútuo é atingido.
  - Badge pill translúcida escura (`rgba(10, 25, 47, 0.85)`) com o rótulo "Crossfade", "Potência Constante" ou "CF", legível por cima das formas de onda.

#### 3. Modificações Realizadas
* `[MODIFY]` `src/ui/js/player.js`: Pausa de `this.audioTransitionPool` e `this._paresAudio` em `ProgramPlayer.pause()`, buffer quente em `syncAudioTracks` e promoção contínua para `audioPool`.
* `[MODIFY]` `src/ui/js/timelineState.js`: Tolerância adaptativa em `getTransitionHit()`, teto mútuo cruzado e margem de segurança tátil em `getTransitionLimits()` e `addAudioCrossfade()`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Cursor SVG `CURSOR_TRANSITION_RESIZE`, discriminação de prioridade entre `trimHit` e alças de transição, arrasto clampado com tooltip de aviso.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Alças táteis de bracket em `drawTransitions()`, indicadores de limite âmbar e badge pill escurecido para legibilidade sobre waveforms.
* `[MODIFY]` `tests/autoteste_audio_crossfade.mjs`: Adicionada Bateria 17 validando pausa de áudio secundário, teto mútuo cruzado e prioridade de trim (17/17 baterias aprovadas).
* `[MODIFY]` `src/ui/index.html`: Cache-buster atualizado para `v=70`.

#### 4. Roteiro de Teste Manual Guiado (Checkpoint de Parada 15)
1. **Teste de Pausa Instantânea de Áudio:**
   - Na timeline, posicione a agulha 1 segundo antes de um crossfade entre dois clipes de áudio e dê Play (`Espaço`).
   - Durante a transição (enquanto ambos os clipes estão soando), pressione `Espaço` ou `K` para pausar.
   - **Resultado Esperado:** O áudio cessa imediatamente em 100% dos canais; nenhum elemento de áudio secundário continua tocando em segundo plano.
2. **Teste de Teto Mútuo Cruzado (Clipes Assimétricos):**
   - Una um clipe curto (ex: 2 segundos) e um clipe longo (ex: 30 segundos) na mesma pista de áudio.
   - Aplique o crossfade com **`Ctrl+Shift+D`**.
   - Segure **<kbd>Alt</kbd>** e tente esticar a borda direita (dentro do clipe longo) o máximo possível.
   - **Resultado Esperado:** O lado direito para de esticar ao atingir o teto correspondente à duração do clipe curto (menos a margem tátil). Não é mais possível expandir o lado direito além do tamanho do clipe curto parceiro.
3. **Teste de Discriminação entre Alça de Crossfade e Corte/Trim do Clipe:**
   - Com o crossfade expandido até o limite do clipe:
   - Passe o mouse sobre a extremidade externa do clipe: note que o cursor exibe a seta de corte de clipe (`CURSOR_TRIM_LEFT`/`CURSOR_TRIM_RIGHT`), permitindo arrastar a borda do clipe normalmente sem ativar a transição.
   - Clique na transição para selecioná-la: note o badge destacado e as alças laterais em bracket; agora o cursor exibe o ícone dedicado de transição (`CURSOR_TRANSITION_RESIZE`) e o arrasto redimensiona o crossfade.
4. **Desfazer com `Ctrl+Z`:**
   - Pressione **`Ctrl+Z`** e veja o crossfade retornar exatamente ao tamanho anterior. Pressione **`Ctrl+Z`** novamente para remover a transição.

> [!CAUTION]
> **Checkpoint de Parada 15:** Concluído com 100% de sucesso (16/16 baterias no autoteste). Conforme a Regra de Ouro do desenvolvimento (Seção 1), o sistema para obrigatoriamente aqui para validação e aprovação do usuário antes de iniciar a Task 16 (Transições de Junção de Vídeo: Cross Dissolve & Dips).

---

### Task 16: Transições de Junção de Vídeo: Cross Dissolve (`Ctrl+D`), Dip to Black & Dip to White
> **Status:** ✅ Concluída e Validada com Sucesso (16/16 baterias no `autoteste_video_transitions.mjs`, Paridade nos 5 Perfis NLE e Suporte no `grafo_video.py`)

#### 1. Objetivo & Especificação Funcional Entregue
* Transições de junção aplicadas na emenda de dois clipes de vídeo na mesma pista (centrado no corte, início no corte ou fim no corte).
* **Cross Dissolve (`Ctrl+D`):** Dissolução cruzada direta.
* **Dip to Black / Dip to White:** Fusão passando por preto ou branco absoluto com overlay dedicado.
* Duração ajustável arrastando as bordas da transição no canvas (simétrico e assimétrico via `Alt`).
* Alças táteis em colchete (`drawTransitions`), detecção sob a agulha e atalho registrado nos 5 perfis NLE.

#### 2. Modificações Entregues
* `[MODIFY]` `src/ui/js/timelineState.js`: Suporte a transições de vídeo no modelo de dados, cálculo de teto mútuo cruzado e histórico reversível (`Ctrl+Z`).
* `[MODIFY]` `src/ui/js/keymapService.js`: Atalho `Ctrl+D` e comando `edit.apply_video_transition` nos 5 perfis NLE.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Detecção de alças, discriminação corte vs transição e drag handlers.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Desenho no canvas com badges, linhas e estilo âmbar/ouro.
* `[MODIFY]` `src/ui/js/player.js`: Interpolação de opacidade dupla durante o playback do Program Player.
* `[MODIFY]` `src/export/video_render/grafo_video.py`: Suporte a transições de vídeo mantendo sincronia A/V.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_video_transitions.mjs`: 100% de aprovação nas 16 baterias de teste.
* **Teste Manual:** Colocar dois vídeos contíguos em V1, apertar `Ctrl+D`, dar Play e ver a fusão suave entre as imagens.

---

### Task 17: Camada de Ajuste (Adjustment Layer)
> **Status:** ✅ Concluída e Validada com Sucesso (9/9 baterias no `autoteste_adjustment_layer.mjs`, Propagação Cumulativa no Player via Filtros CSS Diretos sobre Superfícies Aceleradas e Suporte a Split/Overlay no FFmpeg)

#### 1. Objetivo & Especificação Funcional Entregue
* Clipe transparente especial inserível em pistas superiores (V2 ou V3) com `kind: "adjustment"`.
* Todos os efeitos (cor, brilho, contraste, saturação, matiz, LUT, crop, letterbox cinematográfico) aplicados à camada afetam em tempo real todas as pistas de vídeo abaixo dela.
* Aplicação direta e cumulativa de filtros CSS (`brightness`, `contrast`, `saturate`, `hue-rotate`, `sepia`, `grayscale`, `blur`, `opacity`, `clip-path`) diretamente em elementos de mídia (`<video>`, `<img>` e `#program-player-matte`), contornando limitações de `backdrop-filter` do Chromium em hardware acelerado por GPU.
* Sincronização ao vivo (`oninput`) ao arrastar sliders no Inspetor e omissão inteligente de seções de áudio.
* Renderização no canvas da timeline com badge `[Ajuste]` e faixa violeta temática.

#### 2. Modificações Entregues
* `[MODIFY]` `src/ui/js/timelineState.js`: Suporte a clipes com `kind: "adjustment"`, método `addAdjustmentCut()` e cálculo cumulativo `getCumulativeAdjustmentEffects()`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização de badges e faixas visuais no canvas.
* `[MODIFY]` `src/ui/js/player.js`: Aplicação de filtros CSS cumulativos em `applyMediaEffects` e `applyMatteSlot`; delegação de `syncVideoToPlayhead()` em `VideoPlayer`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Disparo imediato de sincronização de vídeo ao arrastar sliders no Inspetor e ajuste de ordem de seções.
* `[MODIFY]` `src/ui/js/keyframeEngine.js`: Avaliação estática e animada de propriedades de cor e crop em `evaluateClipProperty`.
* `[MODIFY]` `src/export/video_render/grafo_video.py` e `modelo.py`: Composição por split e overlay no FFmpeg.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_adjustment_layer.mjs`: 100% de aprovação nas 9 baterias de teste.
* `[MODIFY]` `tests/test_render_recursos_editor.py`: Teste de propagação de efeitos no render FFmpeg aprovado (18/18 testes no Pytest).
* **Teste Manual:** Inserir Camada de Ajuste em V2 sobre clipe em V1, ajustar brilho, saturação ou matiz no Inspetor e ver a imagem alterar instantaneamente em tempo real.

---

### Task 18: Geradores de Cor Sólida (Color Matte / Solid Color Slates)
> **Status:** ✅ Concluída e Validada com Sucesso (9/9 baterias no `autoteste_color_matte.mjs`, Modos de Mesclagem / Blend Modes, Pastas de Sistema / Virtuais, Criação na Biblioteca, Drag & Drop e Geração lavfi no FFmpeg)

#### 1. Objetivo & Especificação Funcional Entregue
* Botão na biblioteca: *"Novo Gerador de Cor..."* e modal interativo.
* Permite escolher uma cor sólida (Preto, Branco, Verde Chroma, Azul, cor hexadecimal personalizada).
* Suporte completo a **Modos de Mesclagem (Blend Modes)** no Inspetor, Player e Render FFmpeg: Normal, Multiplicação (`multiply`), Divisão / Tela (`screen`), Sobreposição (`overlay`), Escurecer (`darken`), Clarear (`lighten`), Luz Suave (`soft-light` / `softlight`) e Diferença (`difference`).
* Organização em **Pastas Virtuais e de Sistema na Biblioteca**: itens direcionados para `📁 Geradores`, `📁 Subclipes` e `📁 Títulos` por padrão, com herança da pasta aberta atualmente na árvore e suporte a Drag & Drop entre pastas.
* Renderização pura no Program Player (`applyMatteSlot`) com suporte a z-index, transformações, crop e opacidade.
* Geração procedural via filtro `color=c=...` do FFmpeg sem necessidade de arquivo em disco.

#### 2. Modificações Entregues
* `[MODIFY]` `src/ui/js/library.js`: Modal de criação, pastas de sistema automáticas e integração com `virtualFolderMap`.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Dropdown de Modos de Mesclagem na seção Composição/Transformação para todos os clipes visuais e método `setClipBlendMode`.
* `[MODIFY]` `src/ui/js/timelineState.js`: Método `addColorMatteCut()` com undo/redo e herança de `blend_mode`.
* `[MODIFY]` `src/ui/js/player.js`: Renderização da cor sólida com `mixBlendMode` no Program Player.
* `[MODIFY]` `src/ui/js/tituloRender.js`: Aplicação de `mixBlendMode` em overlays de títulos.
* `[MODIFY]` `src/export/video_render/grafo_video.py` e `modelo.py`: Composição por filtro `blend=all_mode=...` no FFmpeg.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_color_matte.mjs`: 100% de aprovação nas 9 baterias de teste.
* `[MODIFY]` `tests/test_render_recursos_editor.py`: 18/18 testes aprovados no Pytest (incluindo `test_blend_modes_color_matte_e_clipes`).
* **Teste Manual:** Criar um Color Matte na biblioteca, verificar inserção na pasta `📁 Geradores`, arrastar ou duplo clique para a timeline, selecionar modo de mesclagem (ex: Multiplicação ou Tela) e conferir a fusão sobre o clipe inferior.

> [!NOTE]
> **Checkpoint de Parada 18 (Fim do Bloco A):** Bloco A (Tasks 16, 17 e 18) concluído com 100% de aprovação técnica, testes unitários de UI, testes de persistência e testes de renderização de exportação FFmpeg. Avanço liberado para o próximo bloco.


---

## 📋 SESSÃO 5: MEDIÇÃO, AUTOMAÇÃO & ÁUDIO

---

### Task 19: Medidor de Nível de Áudio Estéreo em Tempo Real (VU Meter / Peak Meter)

#### 1. Objetivo & Especificação Funcional
* Barra vertical estéreo (L/R) acoplada ao lado direito do Program Player.
* Conectada via `Web Audio API` (`AnalyserNode`) ao áudio da timeline.
* Escala calibrada em decibéis de -60 dBFS a 0 dBFS (Verde, Amarelo e Vermelho) com indicador de **CLIP** persistente ao estourar.
* Funciona a 60 fps via `requestAnimationFrame` apenas durante o playback.

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/player.js`: Pipeline WebAudio do medidor.
* `[MODIFY]` `src/ui/index.html` e `src/ui/styles.css`: Estrutura `#program-audio-meter` sem quebras de layout.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_audio_meter.mjs`: Validar conversão logarítmica para dBFS e alerta de clipping.
* **Teste Manual:** Dar Play na timeline com áudio, ver as barras pulsando com as vozes, provocar volume alto e ver o LED de CLIP acender.

> [!CAUTION]
> **Checkpoint de Parada 19:** Aguardar aprovação do usuário antes da Task 20.

---

### Task 20: Borracha de Áudio & Keyframes na Timeline (Audio Rubberbanding)

#### 1. Objetivo & Especificação Funcional
* Linha de volume horizontal desenhada sobre a forma de onda do clipe na pista de áudio.
* Segurar `Ctrl + Clique` sobre a linha cria nós de keyframes de volume.
* Arrastar os nós para cima/baixo ajusta o ganho local, permitindo criar rampas de volume e ducking manual direto na pista.

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/timelineState.js`: Modelo de keyframes de áudio por clipe `audioKeyframes: [{ frame, gain }]`.
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Desenho da linha e nós no canvas.
* `[MODIFY]` `src/ui/js/player.js`: Modulação dinâmica de ganho por rampa no WebAudio.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_audio_rubberbanding.mjs`: Validar interpolação linear entre nós de ganho.
* **Teste Manual:** Dar `Ctrl+clique` na linha de áudio para criar 2 nós, puxar o segundo para baixo, dar Play e ouvir o fade manual perfeito.

> [!CAUTION]
> **Checkpoint de Parada 20:** Aguardar aprovação do usuário antes da Task 21.

---

### Task 21: Atenuação Sonora Automática de Trilha (Auto-Ducking)

#### 1. Objetivo & Especificação Funcional
* Recurso no cabeçalho da pista de música (A2): *"Auto-Ducking contra Diálogo (A1)"*.
* Ao ativar, a reprodução detecta presença de sinal de voz em A1 e abaixa o ganho da pista musical em -12 dB (com rampa suave de 0.3s antes e depois da fala).

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/player.js`: Laço de atenuação dinâmica de ganho no WebAudio baseado em cuts de A1.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_auto_ducking.mjs`: Validar cálculo de janelas de atenuação temporal.
* **Teste Manual:** Colocar música em A2 e entrevista em A1, ativar Auto-Ducking e ouvir a música baixar suavemente durante a fala e subir no silêncio.

> [!CAUTION]
> **Checkpoint de Parada 21:** Aguardar aprovação do usuário antes da Sessão 6.

---

## 📋 SESSÃO 6: ORGANIZAÇÃO VISUAL, TRAVAS & MÚLTIPLAS TIMELINES

---

### Task 22: Rótulos de Cores Personalizados para Clipes (Color Labels)

#### 1. Objetivo & Especificação Funcional
* Paleta clássica NLE de 8 cores para categorização temática de clipes na timeline e cards:
  * Violeta, Ciano, Rosa, Âmbar, Esmeralda, Azul Real, Amarelo Sol e Cinza Neutro.
* Menu de contexto de clique direito: *"Rotular Cor ➔"*. Suporta seleção múltipla.
* Renderizado no canvas e persistido no salvamento da timeline.

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Renderização da cor do clipe.
* `[MODIFY]` `src/ui/js/timelineState.js`: Método `setClipColorLabel(clipIds, colorCode)`.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_color_labels.mjs`: Validar atribuição em lote, persistência e `undo()`.
* **Teste Manual:** Selecionar dois clipes, mudar para Âmbar, ver a cor atualizar, salvar (`Ctrl+S`), recarregar (`F5`) e conferir a persistência.

> [!CAUTION]
> **Checkpoint de Parada 22:** Aguardar aprovação do usuário antes da Task 23.

---

### Task 23: Trava Total de Pista com Cadeado Físico (Track Lock)
> **Status:** ✅ Concluída e Validada com Sucesso (11/11 baterias aprovadas no `autoteste_track_lock.mjs`, Imunidade Total de Pista e Sincronia A/V contra Mutações/Ripple, Hachura Diagonal Neutra a 45° no Canvas e Atalhos nos 5 Perfis NLE)

#### 1. Objetivo & Especificação Funcional Entregue
* [x] Botão físico de cadeado (`.btn-track-lock`) em todos os cabeçalhos de pista não-IA (`V1`, `V2`, `A1`, `A2`, `T1` e pistas dinâmicas), estilizado com classes semânticas (`.locked` em `var(--color-rose)` e `.unlocked` discreto em `var(--text-muted)` com *hover glow* suave e tooltip reativo via `KEYMAP_SERVICE`).
* [x] Pista travada (`track.locked === true`):
  * [x] Exibe hachura diagonal sutil e neutra a 45° (`drawLockedTracksOverlay()`) sobre toda a extensão horizontal da pista no canvas, preservando 100% da cor semântica original dos clipes por baixo.
  * [x] Expurga instantaneamente seleções residuais de clipes, gaps e transições pertencentes à pista ao travá-la, com suporte atômico a `Undo` / `Redo` (`TIMELINE_HISTORY`).
  * [x] Imunidade absoluta: clipes, lacunas (gaps), fades, marcadores de clipe e transições na pista travada não podem ser selecionados (clique, multi-seleção, Marquee, Track Select Forward/Backward, Selection Follows Playhead), movidos, empurrados por Nudge, aparados (Trim / Q / W / J-L Cut), cortados (Blade `C`, Global Blade `Shift+C`, Split `S`, Freeze Frame `Ctrl+Shift+F`), deslizados (Slip `Y`, Slide `U`, Rolling `N`, Rate Stretch `Shift+R`), alterados em velocidade/rotação/desativação, deletados (Lift, Ripple Delete, Close Gap, In/Out Lift & Extract), substituídos (Replace Edit, alternativas ou Ghost IA), nem deslocados indiretamente por operações de Ripple em pistas destravadas (mesmo quando vinculados via `link_id`).
  * [x] Proteção estrutural de pista: bloqueia renomeação inline e remoção da pista travada (e impede que a exclusão de outra pista despeje clipes órfãos em uma pista travada).
* [x] Atalhos de teclado multi-preset registrados em `COMMANDS_CATALOG` (`category: "canvas_history"`), zero conflitos e preservação integral do cluster *Speed Editing* QWER/ASDF:
  * `timeline.toggle_track_lock`: **`Shift+L`** universal nos 5 perfis (`capiau`, `kdenlive`, `premiere`, `resolve`, `finalcut`), além de **`Ctrl+Shift+L`** primário em `premiere` e **`Alt+Shift+L`** primário em `resolve`.
  * `timeline.toggle_all_tracks_lock`: **`Ctrl+Alt+Shift+L`** nos 5 perfis para travar/destravar todas as pistas simultaneamente.

#### 2. Modificações Entregues
* `[MODIFY]` `src/ui/js/timelineState.js`: Métodos `isTrackLocked()`, `_purgeSelectionOnLockedTrack()`, `toggleTrackLock()`, `toggleActiveTrackLock()`, `toggleAllTracksLock()` e blindagem completa de seleção, corte, exclusão, trim, move, ripple indireto, transições, inserção 3-Point, Replace Edit, Ghost IA e remoção/renomeação de pistas.
* `[MODIFY]` `src/ui/js/timelineInteraction.js`: Guardas de cadeado em `onMouseDown` (Select, Blade, Slip, Slide, Rate Stretch, Rolling, fades, clip markers), `computeMarqueeIntersections`, `onContextMenu`, `resolveDropTrack`, `onDrop`, `moveClip`, `trimClipLeft/Right`, `nudgeTrim`, `resyncClip`, `linkClips` e disparo dos comandos `timeline.toggle_track_lock` e `timeline.toggle_all_tracks_lock`.
* `[MODIFY]` `src/ui/js/state.js`: Proteção de pistas travadas na invariante reativa de sincronia A/V (`set activeTimelineCuts`).
* `[MODIFY]` `src/ui/js/timelineRenderer.js`: Camada `drawLockedTracksOverlay()` com hachura diagonal a 45° (`rgba(255, 255, 255, 0.11)` sobre véu `rgba(8, 10, 16, 0.24)`) respeitando visibilidade e scroll das pistas.
* `[MODIFY]` `src/ui/js/panels.js` e `src/ui/styles.css`: Classes semânticas `.btn-track-lock.locked` / `.unlocked`, `.track-locked`, `.track-active`, seleção de pista ativa no clique do cabeçalho e bloqueio de remoção/renomeação inline quando travada.
* `[MODIFY]` `src/ui/js/keymapService.js` e `src/ui/index.html`: Registro dos comandos nos 5 presets NLE + Cheat Sheet e bump de cache-buster (`styles.css?v=93`, `js/main.js?v=80`).

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_track_lock.mjs`: 11/11 baterias aprovadas com 100% de sucesso + zero regressões nas suítes existentes e aprovação integral na bateria obrigatória multipista em cascata (`autoteste_composicao_multipista_cascata.mjs` 7/7 e `test_render_composicao_multipista_cascata.py` 5/5).
* **Teste Manual:** Travar a pista `A1` no cadeado (ou via `Shift+L`), conferir a hachura diagonal a 45° e o cadeado em tom rose, tentar selecionar, arrastar Marquee, cortar com a Lâmina `C`/`Shift+C` ou aplicar Ripple Delete em `V1` vinculada, e verificar que `A1` permanece 100% intacta e imóvel.

> [!NOTE]
> **Checkpoint de Parada 23:** Concluído e validado com sucesso (100% no autoteste `autoteste_track_lock.mjs` e teste manual aprovado). Avanço liberado para a Task 24.

---

### Task 24: Margens de Segurança & Overlays de Aspecto no Player (Safe Margins)

#### 1. Objetivo & Especificação Funcional
* Botão toggle `#btn-program-safe-margins` no cabeçalho do Program Player.
* Projeta sobre o vídeo: Action Safe (90%), Title Safe (80%), Cruz Central e Máscaras de Proporção (16:9, 9:16 vertical, 1:1 e 2.39:1 cinema).

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/player.js`: Overlay Canvas/SVG de latência zero com `pointer-events: none`.
* `[MODIFY]` `src/ui/index.html`: Botão de margens de segurança no player.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_safe_margins.mjs`: Validar cálculo geométrico das proporções.
* **Teste Manual:** Ativar o botão, conferir as guias de 80% e 90%, alternar para máscara 9:16 e ver o recorte vertical de redes sociais.

> [!CAUTION]
> **Checkpoint de Parada 24:** Aguardar aprovação do usuário antes da Task 25.

---

### Task 25: Sistema de Múltiplas Timelines / Sequências em Abas (Multi-Sequence Tabs)

#### 1. Objetivo & Especificação Funcional
* Barra de abas integrada diretamente na Zona 1 (`.timeline-header-bar`), permitindo ter múltiplas sequências abertas no mesmo projeto:
  * Ex.: *"Rough Cut"*, *"Cena 01"*, *"Selects Entrevistas"*, *"Montagem Final"*.
* Botão `+` para criar nova sequência vazia ou duplicar a atual.
* Trocar de aba altera a timeline ativa instantaneamente mantendo o estado de cada uma em memória (clipes, in/out, zoom, playhead).
* Totalmente compatível com a retração da barra (`#btn-toggle-timeline-header` e linha `#reopen-timeline-header`).
* Permite copiar clipes de uma aba (`Ctrl+C`) e colar em outra (`Ctrl+V`).

#### 2. Modificações Propostas
* `[MODIFY]` `src/ui/js/timelineState.js`: Gestor de múltiplas sequências `sequences: Map<id, sequenceData>` e sequência ativa.
* `[MODIFY]` `src/ui/index.html` e `src/ui/styles.css`: Barra de abas flat integrada à `.timeline-header-bar`, com fechamento de abas (`x`), scroll horizontal suave e visual ativo.
* `[MODIFY]` `src/ui/js/panels.js` e `src/ui/js/workspaceManager.js`: Renderização, persistência de abas abertas e troca dinâmica de sequências.

#### 3. Teste Automatizado & Manual
* `[NEW]` `tests/autoteste_multi_sequence.mjs`: Validar isolamento de estado entre sequências e cópia/cola entre elas.
* **Teste Manual:** Clicar em `+`, criar sequência "Selects", colar 2 clipes, voltar para a aba principal e verificar que a sequência principal permaneceu intacta.

> [!CAUTION]
> **Checkpoint de Parada 25:** Validação final e conclusão da Suíte NLE Profissional.

---

## 🚦 Critérios de Aceitação Global do Projeto

1. **Zero Regressão:** Nenhuma etapa pode quebrar J/L-cuts, Sync Lock, busca semântica, titler, diarização de áudio, render FFmpeg ou exportação OTIO.
2. **Conformidade Estrita com o Design System:** Respeito absoluto ao layout sem espaços, sidebars de 3 níveis, selects premium e motor de tooltips globais ([`SKILL.md`](../.agents/skills/capiau-nle-design-system/SKILL.md)).
3. **Persistência Confiável:** Todas as novas propriedades de corte, transição, velocidade e cor são salvas nos formatos nativos do projeto.
4. **Cadência Interativa:** Cada uma das 26 etapas termina com o relatório técnico dos autotestes e o convite guiado para o teste humano no navegador.
5. **Paridade Total de Teclado & Cheat Sheet Sincronizada:** Toda nova ferramenta ou ação introduzida deve estar registrada no catálogo e nos 5 perfis NLE (`capiau`, `premiere`, `resolve`, `finalcut`, `kdenlive`), refletindo dinamicamente no Teclado Virtual, no Guia/Cheat Sheet de Atalhos e no Editor de Teclas, validada em autoteste automatizado.
