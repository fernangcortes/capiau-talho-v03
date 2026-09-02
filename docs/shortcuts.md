# 🎹 Cheat Sheet de Atalhos de Teclado, Perfis NLE e Manual

O **CapIAu-Talho** possui um **Sistema Central de Keymap e Perfis NLE** de alta performance, projetado para oferecer ergonomia de edição profissional tanto para quem utiliza o mapeamento nativo quanto para quem vem de outros softwares consagrados de mercado (*Kdenlive, Adobe Premiere Pro, DaVinci Resolve e Apple Final Cut Pro*).

---

## 🎛️ 1. Perfis NLE Integrados de Fábrica

Você pode alternar o perfil ativo a qualquer momento através do menu **Perfil** no cabeçalho do **Guia de Atalhos** (<kbd>⌨️</kbd> na barra de ferramentas da timeline):

| Perfil NLE | Foco & Ergonomia | Destaques de Mapeamento |
| :--- | :--- | :--- |
| 🎬 **CapIAu Padrão** | Híbrido moderno ultrarrápido para montagem documental e corte inteligente. | `Z` Split, `V` Seleção, `T` Faixa, `Q`/`W` Ripple Trims, `S` Snapping, `M` Marcador, `A` Alternativas IA. |
| 🐧 **Kdenlive** | Padrão clássico do ecossistema Open Source e Linux NLE. | `Shift+R` / `X` Razor Split, `S` Seleção, `M` / `Shift+M` Espaçador, `V` Inserção, `F10` Snapping, `J`/`K`/`L` Shuttle. |
| 🟣 **Adobe Premiere Pro** | Ergonomia familiar para editores acostumados ao ecossistema Adobe. | `Ctrl+K` / `C` Razor Split, `A` / `Shift+A` Seleção de Trilha, `V` Seleção, `S` Snapping, `Q`/`W` Ripple Trims. |
| 🟡 **DaVinci Resolve** | Padrão Blackmagic Design para ilhas de edição e pós-produção. | `Ctrl+\` / `B` Blade Split, `A` Seleção, `N` Snapping, `Shift+Backspace` Ripple Delete, `Alt+[` / `Alt+]` Trims. |
| 🍏 **Apple Final Cut Pro** | Ergonomia magnética e atalhos otimizados para fluxo contínuo. | `Cmd+B` / `B` Blade Split, `A` Seleção, `N` Snapping, `E` Append, `Shift+Delete` Ripple Delete. |
| ⚙️ **Personalizado (Custom)** | Mapeamento livre configurado pelo usuário. | Totalmente editável pela aba **Personalizar Atalhos & Tabela**, com persistência local e exportação JSON. |

---

## ⌨️ 2. Teclado Visual Esquemático 1:1 & Área de Teste em Tempo Real

No modal de atalhos (<kbd>⌨️</kbd> na timeline), a aba principal **Teclado Visual & Índice Esquemático** oferece uma experiência interativa completa:

* **Proporções Mecânicas 1:1 (ANSI TKL)**: Keycaps físicos proporcionais com pontos coloridos por categoria de função.
* **Destaque Bidirecional**:
  * Passar o mouse no **Teclado** ➔ Ilumina a linha correspondente nas 3 colunas esquemáticas abaixo e rola até ela.
  * Passar o mouse no **Índice** ➔ Ilumina a tecla correspondente no teclado virtual.
* **Camadas de Modificadores**: Alterne entre as camadas `Padrão`, `+ Shift`, `+ Ctrl` e `+ Alt` ou segure os modificadores no teclado físico para visualizar funções secundárias.
* **Live Testing HUD**: Digite qualquer tecla física com o modal aberto para testar atalhos ao vivo com feedback de iluminação neon e descrição instantânea.
* **Modo Tela Cheia (Fullscreen)**: Clique no botão <i class="fa-solid fa-expand"></i> para expandir o modal para `100vw × 100vh`, ocupando toda a tela com visibilidade total dos comandos.

---

## 🎬 3. Controles de Reprodução e Shuttle (Monitor Source & Program)

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`Espaço`** | **Play / Pause Geral** | Alterna entre tocar e pausar no player atualmente focado (*Source* ou *Program*). |
| **`Ctrl + L` / `Cmd + L`** | **Alternar Loop Contínuo** | Liga ou desliga a reprodução contínua em loop no intervalo marcado [In–Out]. |
| **`J`** | **Shuttle Reverso** | Pressione consecutivamente para acelerar a velocidade de retrocesso (-1x, -2x, -4x, -8x). |
| **`K`** | **Shuttle Parar** | Pausa a reprodução imediata ou redefine a velocidade normal. |
| **`L`** | **Shuttle Avanço** | Pressione consecutivamente para acelerar a velocidade de avanço (1.5x, 2x, 4x, 8x). |
| **`K + J`** | **Jog Recuar 1 Frame** | Pressione K mantendo pressionado J para recuar exatamente 1 frame. |
| **`K + L`** | **Jog Avançar 1 Frame** | Pressione K mantendo pressionado L para avançar exatamente 1 frame. |
| **`←` / `→`** | **Navegar Frames** | Retrocede ou avança exatamente 1 frame do vídeo para cortes cirúrgicos. |
| **`↑` / `↓`** | **Navegar Pontos de Corte (Edit Points)** | **Na Timeline:** Move a agulha para o corte anterior (↑) ou próximo (↓).<br>**No Source:** Pula para o ponto In/Início (↑) ou ponto Out/Fim (↓). |
| **`Shift + I`** | **Ir para Ponto IN** | Posiciona a agulha de reprodução exatamente no ponto de entrada marcado. |
| **`Shift + O`** | **Ir para Ponto OUT** | Posiciona a agulha de reprodução exatamente no ponto de saída marcado. |
| **`Duplo Clique` (Player)** | **Maximizar / Minimizar Player** | Expande o monitor ativo para tela cheia ou restaura o layout. |
| **`Duplo Clique` (Biblioteca)** | **Inserir Direto na Timeline** | Insere o arquivo de mídia diretamente na timeline na posição da agulha. |
| **`Shift + Roda` (Biblioteca)** | **Zoom Dinâmico de Cards** | Ajusta progressivamente o tamanho dos cards e miniaturas da biblioteca. |

---

## ✂️ 4. Marcação de Pontos, Inserção e Edição na Timeline

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`I`** | **Marcar Entrada (In)** | **No Source / Na Timeline:** Define o frame inicial do trecho ativo. |
| **`O`** | **Marcar Saída (Out)** | **No Source / Na Timeline:** Define o frame final do trecho ativo. |
| **`Alt + X`** | **Limpar In / Out** | Remove as marcações de entrada e saída ativas no monitor ou timeline. |
| **`;` (Ponto e Vírgula)** | **Lift (Extração com Gap)** | Remove o trecho entre [In–Out] mantendo o espaço vazio correspondente. |
| **`'` (Aspas Simples)** | **Extract (Extração com Ripple)** | Remove o trecho entre [In–Out] e fecha o espaço puxando os clipes à direita. |
| **`E`** | **Adicionar à Timeline (Append)** | Insere o trecho marcado [In-Out] na trilha de destino correspondente. |
| **`Shift + E`** | **Corte de Fala Rápido** | Insere o texto/diálogo selecionado na transcrição diretamente na trilha V1/A1. |
| **`Z`** *(ou `Shift+R`/`Ctrl+K`/`B`)* | **Dividir Clipe (Split)** | Corta o clipe na agulha (playhead). Se vinculado (A/V), divide áudio e vídeo juntos. |
| **`Q`** | **Ripple Delete até a Agulha (Head)** | Corta do início do clipe até a agulha e puxa os clipes posteriores nas pistas com Sync Lock. |
| **`W`** | **Ripple Delete da Agulha até o Fim (Tail)** | Corta da agulha até o fim do clipe e puxa os clipes posteriores nas pistas com Sync Lock. |
| **`Delete` / `Backspace`** | **Lift Delete / Deletar Gap / Ghost** | **Em clipe:** Apaga o clipe mantendo o Gap vazio.<br>**Em Gap:** Fecha o espaço vazio puxando os clipes.<br>**Em Ghost:** Rejeita sugestão de IA. |
| **`Shift + Delete`** | **Ripple Delete de Clipe** | Apaga o clipe selecionado e fecha o espaço vazio imediatamente. |
| **`Alt + Delete`** | **Apagar Faixa Única** | Apaga apenas o vídeo ou o áudio do clipe selecionado, desvinculando o par temporariamente. |
| **`U`** | **Desvincular / Vincular Par A/V** | Desvincula o par áudio/vídeo do clipe para possibilitar cortes L-Cut e J-Cut. |
| **`Ctrl + Arraste`** | **Ripple Insert** | Insere mídia abrindo espaço e empurrando os cortes à direita nas pistas sincronizadas. |
| **`Ctrl + Trim`** | **Ripple Trim** | Ajusta as bordas de entrada/saída compensando o tempo nas pistas sincronizadas. |

---

## 🎛️ 5. Ferramentas da Timeline e Ajustes de Precisão

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`V`** *(ou `S` no Kdenlive / `A` no Resolve)* | **Ferramenta de Seleção** | Retorna ao cursor padrão de seleção e arraste. |
| **`T`** *(ou `A` no Premiere)* | **Selecionar Faixa para Frente** | Seleciona todos os clipes à direita em todas as faixas ativas (*Shift = 1 faixa*). |
| **`Shift + T`** *(ou `Shift+A`)* | **Selecionar Faixa para Trás** | Seleciona todos os clipes à esquerda em todas as faixas ativas (*Shift = 1 faixa*). |
| **`S`** *(ou `F10` / `N`)* | **Alternar Snapping Magnético** | Liga ou desliga o magnetismo da timeline com guias visuais no Canvas. |
| **`←` / `→`** | **Deslocar Clipe (Nudge 1 Frame)** | Desloca o clipe selecionado 1 frame para a esquerda ou direita. |
| **`Alt + ←` / `Alt + →`** | **Ajustar Ponto IN (Trim In)** | Recua ou avança a borda esquerda do clipe selecionado em 1 frame. |
| **`Shift + ←` / `Shift + →`** | **Ajustar Ponto OUT (Trim Out)** | Recua ou avança a borda direita do clipe selecionado em 1 frame. |
| **`[` / `]`** | **Nudge Trim Rápido** | Ajusta borda esquerda (`[`) ou borda direita (`]`) em 1 frame. |

---

## 📍 6. Marcadores de Timeline e Clipe

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`M`** | **Adicionar / Editar Marcador** | Cria ou edita marcador na agulha sem pausar a reprodução. |
| **`Shift + M`** | **Pular para Próximo Marcador** | Move a agulha para o próximo marcador da timeline. |
| **`Alt + M`** | **Pular para Marcador Anterior** | Move a agulha para o marcador anterior da timeline. |
| **`Shift + Clique`** | **Seleção Múltipla de Marcadores** | Seleciona vários marcadores simultaneamente para edição ou exclusão em lote. |
| **`Tab` (no box do marcador)** | **Alternar Campos** | Navega entre Título, Comentário e Seletor de Cores. |
| **`Enter` / `Esc`** | **Salvar e Fechar Marcador** | Salva e fecha o popover de marcador instantaneamente. |

---

## 🤖 7. Inteligência Artificial, Inspetor e Comandos Globais

| Tecla / Combinação | Ação | Descrição |
| :--- | :--- | :--- |
| **`A`** | **Alternativas IA / Inspetor** | **Na Timeline:** Abre o carrossel de planos alternativos sugeridos pela IA.<br>**Na Biblioteca:** Abre o Inspetor de Metadados e Decupagem. |
| **`Enter` / `Y`** | **Aceitar Sugestão de IA** | Aceita e consolida o clipe fantasma (*ghost clip*) sugerido na timeline. |
| **`Del` (sobre Ghost)** | **Rejeitar Sugestão de IA** | Remove o clipe fantasma sugerido pela IA. |
| **`Ctrl + S`** | **Salvar Timeline / Projeto** | Salva a timeline ativa e persiste no banco SQLite/JSON. |
| **`Ctrl + Z`** | **Desfazer (Undo)** | Desfaz a última ação realizada na timeline. |
| **`Ctrl + Y`** *(ou `Ctrl+Shift+Z`)* | **Refazer (Redo)** | Refaz a ação desfeita. |
| **`Esc`** | **Fechar / Cancelar** | Fecha modais, limpa seleções e conclui edições de texto. |

---

## 🛡️ Prevenção Inteligente de Conflitos de Digitação

O sistema monitora automaticamente o foco de digitação:
* Ao focar em caixas de texto (Chatbot de IA, busca semântica, renomeação de mídias, edição de legendas/GCs), **todos os atalhos de playback e timeline são temporariamente suspensos**.
* Ao pressionar `Esc` ou clicar fora do campo, os atalhos de edição NLE são reativados instantaneamente.
